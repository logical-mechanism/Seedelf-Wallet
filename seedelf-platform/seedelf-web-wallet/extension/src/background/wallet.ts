// Wallet state and the lock, owned by the service worker.
//
//   no-wallet ──create/restore──▶ unlocked ◀──unlock── locked
//                                    └──lock / auto-lock──▶┘
//
// While unlocked, the derived keys live in worker memory and the vault
// entropy is copied into chrome.storage.session (memory only, cleared when the
// browser closes). A restarted worker re-derives the keys from there instead
// of asking for the password again. See docs/architecture.md#service-worker.

import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import { passwordProblem } from "../shared/password";
import type { Account, UnlockResult, WalletState } from "../shared/rpc";
import { fromBase64, toBase64, type Area } from "./storage";
import { LOCAL_PREFERENCES } from "./preferences";
import { PRIVATE_PREFIX, PRIVATE_RECORDS } from "./private-store";
import { openVault, sealVault, VAULT_KEY, WrongPasswordError, type VaultRecord } from "./vault";
import { isTrap } from "./wasm";

/** HKDF salt of the key that seals private records on the device, v1. */
const STORE_SALT = new TextEncoder().encode("seedelf-web-wallet-private-store-v1");
const STORE_INFO = new TextEncoder().encode("records");

/** Lock after this long without UI activity, unless the settings say otherwise (`lockAfterMs`). */
export const AUTO_LOCK_MS = 15 * 60_000;

/** chrome.storage.session: the vault entropy (base64) while unlocked. */
export const SESSION_ENTROPY = "seedelf.entropy";
/** chrome.storage.session: when the user last did something (ms since the epoch). */
export const SESSION_ACTIVITY = "seedelf.lastActivity";
/**
 * chrome.storage.session: the last balance reading per network, e.g.
 * `seedelf.balances.preprod`. It says which contract UTxOs are the user's,
 * so it never goes to disk and it's wiped on lock.
 */
export const SESSION_BALANCES_PREFIX = "seedelf.balances.";
/** chrome.storage.local: consecutive failed unlocks, kept across restarts. */
export const UNLOCK_FAILURES = "seedelf.unlockFailures";

/** What a request gets when WebAssembly trapped under it: the wallet locked itself (see `broken`). */
export const WASM_BROKEN = "The wallet's core stopped working, so the wallet locked itself. Unlock it to carry on.";

/**
 * Whether session storage holds an unlocked wallet's entropy. Without it
 * there's nothing to lock, so the auto-lock alarm stops without starting
 * WebAssembly (sw.ts): a browser restart drops session storage but keeps
 * the alarm.
 */
export async function hasEntropy(session: Area): Promise<boolean> {
  return (await session.get<string>(SESSION_ENTROPY)) !== undefined;
}

interface UnlockFailures {
  count: number;
  lastFailureAt: number;
}

/**
 * Wait after `failedAttempts` consecutive wrong passwords: 0, then 1 s, 2 s,
 * 4 s … capped at 60 s. Lace's values (authentication-prompt
 * unlock-backoff.ts), but enforced here in the worker, not only in the UI.
 */
export function unlockBackoffMs(failedAttempts: number): number {
  return failedAttempts <= 0 ? 0 : Math.min(1000 * 2 ** (failedAttempts - 1), 60_000);
}

export interface WalletDeps {
  wasm: typeof Wasm;
  /** chrome.storage.local */
  local: Area;
  /** chrome.storage.session */
  session: Area;
  now: () => number;
  /** Starts and stops the periodic auto-lock check (chrome.alarms). */
  autoLock: { start(): Promise<void>; stop(): Promise<void> };
  /** How long without activity before it locks: the user's setting. [`AUTO_LOCK_MS`] without one. */
  lockAfterMs?: () => Promise<number>;
  /** Tells open UI pages the state changed. */
  changed: () => void;
  /** Replaces a WebAssembly instance that trapped with a fresh one (wasm.ts `freshWasm`). */
  fresh?: () => void;
}

export interface Keys {
  seedelf: Wasm.SeedelfKey;
  cardano: Wasm.CardanoAccount;
  /** Private sessions' one-time accounts (account 24301'): never the public account's keys. */
  oneTime: Wasm.OneTimeAccounts;
}

export class Wallet {
  private keys: Keys | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  /**
   * Why the wallet last locked itself, while this worker lives: its
   * WebAssembly trapped (`broken`). Unlocking, or a lock of the user's,
   * clears it. The Unlock screen says so (Status `lockedBy`).
   */
  private lockedBy: "trap" | undefined;

  constructor(private readonly deps: WalletDeps) {}

  /** The current state. Also applies auto-lock, so the alarm just calls this. */
  state(): Promise<WalletState> {
    return this.serial(() => this.load());
  }

  /** Why the wallet locked itself, if it did: "trap", its WebAssembly stopped working. */
  lockReason(): "trap" | undefined {
    return this.lockedBy;
  }

  /** How long before the next unlock attempt is allowed, in ms. */
  retryAfterMs(): Promise<number> {
    return this.serial(() => this.remainingBackoff());
  }

  /**
   * Seals the phrase's entropy under `password` and unlocks. Create and
   * restore both end here; the phrase is only ever written as entropy.
   */
  create(phrase: string, password: string): Promise<void> {
    return this.serial(async () => {
      const problem = passwordProblem(password);
      if (problem) throw new Error(problem);
      if (await this.deps.local.get(VAULT_KEY)) {
        throw new Error("A wallet already exists. Reset it before creating or restoring another.");
      }
      const entropy = this.deps.wasm.phraseToEntropy(phrase);
      try {
        const record = await sealVault(entropy, password, this.deps.now());
        await this.deps.local.set(VAULT_KEY, record);
        await this.deps.local.remove(UNLOCK_FAILURES);
        await this.open(entropy);
      } finally {
        entropy.fill(0);
      }
      this.deps.changed();
    });
  }

  unlock(password: string): Promise<UnlockResult> {
    return this.serial(async () => {
      const state = await this.load();
      if (state === "unlocked") return { unlocked: true };
      if (state === "no-wallet") throw new Error("There is no wallet to unlock.");

      const wait = await this.remainingBackoff();
      if (wait > 0) return { unlocked: false, wrongPassword: false, retryAfterMs: wait };

      const record = (await this.deps.local.get<VaultRecord>(VAULT_KEY))!;
      let entropy: Uint8Array;
      try {
        entropy = await openVault(record, password);
      } catch (e) {
        if (!(e instanceof WrongPasswordError)) throw e;
        const failures = await this.failures();
        const next: UnlockFailures = { count: failures.count + 1, lastFailureAt: this.deps.now() };
        await this.deps.local.set(UNLOCK_FAILURES, next);
        return { unlocked: false, wrongPassword: true, retryAfterMs: unlockBackoffMs(next.count) };
      }
      try {
        await this.deps.local.remove(UNLOCK_FAILURES);
        await this.open(entropy);
      } finally {
        entropy.fill(0);
      }
      this.deps.changed();
      return { unlocked: true };
    });
  }

  lock(): Promise<void> {
    return this.serial(async () => {
      const wasUnlocked = (await this.load()) === "unlocked";
      await this.wipe();
      if (wasUnlocked) {
        this.lockedBy = undefined;
        this.deps.changed();
      }
    });
  }

  /** Records user activity, which pushes auto-lock back. */
  touch(): Promise<void> {
    return this.serial(async () => {
      if ((await this.load()) === "unlocked") {
        await this.deps.session.set(SESSION_ACTIVITY, this.deps.now());
      }
    });
  }

  /**
   * When auto-lock locks the wallet, null when it isn't unlocked, and how
   * long it waits without activity: for the countdown in its last minutes.
   * Asking isn't activity, and past the deadline it locks, as the alarm would.
   */
  lockDeadline(): Promise<{ at: number | null; lockAfterMs: number }> {
    return this.serial(async () => {
      const lockAfterMs = (await this.deps.lockAfterMs?.()) ?? AUTO_LOCK_MS;
      if ((await this.load()) !== "unlocked") return { at: null, lockAfterMs };
      const last = (await this.deps.session.get<number>(SESSION_ACTIVITY)) ?? 0;
      return { at: last + lockAfterMs, lockAfterMs };
    });
  }

  /**
   * The recovery phrase, for Settings: only with the password, even while
   * unlocked, and a wrong one counts towards the unlock back-off.
   */
  revealPhrase(password: string): Promise<string[]> {
    return this.serial(async () => {
      const entropy = await this.openWithPassword(password);
      try {
        return this.deps.wasm.entropyToPhrase(entropy).split(" ");
      } finally {
        entropy.fill(0);
      }
    });
  }

  /**
   * Checks an unlocked wallet's password, before a site's signature
   * (dapp.ts). A wrong one counts towards the unlock back-off, as the
   * phrase's does.
   */
  checkPassword(password: string): Promise<void> {
    return this.serial(async () => {
      (await this.openWithPassword(password)).fill(0);
    });
  }

  /**
   * Whether `phrase` is this wallet's recovery phrase, for Settings' check of
   * a written copy. It says only yes or no, never which words differ, so it
   * tells nobody at an unlocked browser more than a whole phrase they
   * already have; no password is needed. A phrase that isn't one (a word off
   * the list, a bad checksum) fails with the reason, as restore's does.
   */
  checkPhrase(phrase: string): Promise<boolean> {
    return this.serial(async () => {
      if ((await this.load()) !== "unlocked") throw new Error("The wallet is locked.");
      const typed = this.deps.wasm.phraseToEntropy(phrase);
      const kept = fromBase64((await this.deps.session.get<string>(SESSION_ENTROPY))!);
      try {
        let differ = typed.length ^ kept.length;
        for (let i = 0; i < Math.max(typed.length, kept.length); i++) differ |= (typed[i] ?? 0) ^ (kept[i] ?? 0);
        return differ === 0;
      } finally {
        typed.fill(0);
        kept.fill(0);
      }
    });
  }

  /** Seals the vault under a new password; the current one proves who's asking. */
  changePassword(current: string, next: string): Promise<void> {
    return this.serial(async () => {
      const problem = passwordProblem(next);
      if (problem) throw new Error(problem);
      const entropy = await this.openWithPassword(current);
      try {
        const record = (await this.deps.local.get<VaultRecord>(VAULT_KEY))!;
        const sealed = await sealVault(entropy, next, record.createdAt);
        await this.deps.local.set(VAULT_KEY, sealed);
      } finally {
        entropy.fill(0);
      }
    });
  }

  /** Deletes the vault. The UI asks for a typed confirmation first. */
  reset(): Promise<void> {
    return this.serial(async () => {
      await this.wipe();
      const records = PRIVATE_RECORDS.map((name) => PRIVATE_PREFIX + name);
      await this.deps.local.remove(VAULT_KEY, UNLOCK_FAILURES, LOCAL_PREFERENCES, ...records);
      this.deps.changed();
    });
  }

  /** The unlocked wallet's public identifiers. */
  account(network: NetworkName): Promise<Account> {
    return this.withKeys(({ seedelf, cardano }) => {
      const net = network === "mainnet" ? this.deps.wasm.Network.Mainnet : this.deps.wasm.Network.Preprod;
      const base = seedelf.baseRegister();
      try {
        return {
          receiveAddress: cardano.receiveAddress(net, 0),
          stakeAddress: cardano.stakeAddress(net),
          seedelfPublicValue: base.publicValue,
        };
      } finally {
        base.free();
      }
    });
  }

  /**
   * Runs `task` with the unlocked keys, in turn with every other wallet
   * operation, so a lock can't happen halfway through. Throws if locked.
   * Keep tasks short and never await the network inside one.
   */
  withKeys<T>(task: (keys: Keys) => T | Promise<T>): Promise<T> {
    return this.serial(async () => {
      if ((await this.load()) !== "unlocked") throw new Error("The wallet is locked.");
      return task(this.keys!);
    });
  }

  /**
   * Runs `task` with the key that seals this wallet's private records on the
   * device (private-store.ts): HKDF-SHA-256 of the vault's entropy, so it
   * exists only while unlocked. It's zeroed afterwards. Throws if locked.
   */
  withStoreKey<T>(task: (key: Uint8Array) => T | Promise<T>): Promise<T> {
    return this.serial(async () => {
      if ((await this.load()) !== "unlocked") throw new Error("The wallet is locked.");
      const entropy = fromBase64((await this.deps.session.get<string>(SESSION_ENTROPY))!);
      const key = hkdf(sha256, entropy, STORE_SALT, STORE_INFO, 32);
      entropy.fill(0);
      try {
        return await task(key);
      } finally {
        key.fill(0);
      }
    });
  }

  /**
   * A WebAssembly call outside the wallet's queue trapped (sw.ts): lock, as a
   * trap inside it does. Its keys lived in the broken instance.
   */
  trapped(): Promise<void> {
    return this.serial(() => this.broken());
  }

  /**
   * Runs `task` after every earlier one, so unlocks, locks and resets never
   * interleave. WebAssembly that traps under it locks the wallet.
   */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const guarded = async () => {
      try {
        return await task();
      } catch (e) {
        if (!isTrap(e)) throw e;
        await this.broken();
        throw new Error(WASM_BROKEN);
      }
    };
    const run = this.queue.then(guarded, guarded);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * WebAssembly trapped. Lock: clear session storage first, so the entropy
   * can't outlive it, then free what can still be freed and start a fresh
   * instance. The key objects went with the old one, so unlocking again is
   * the only way on.
   */
  private async broken(): Promise<void> {
    this.lockedBy = "trap";
    try {
      await this.wipe();
    } finally {
      try {
        this.deps.fresh?.();
      } finally {
        this.deps.changed();
      }
    }
  }

  /**
   * Brings worker memory in line with storage: after a restart, re-derive the
   * keys from session storage; past the auto-lock deadline, lock instead.
   */
  private async load(): Promise<WalletState> {
    const { session, local, now } = this.deps;
    const stored = await session.get<string>(SESSION_ENTROPY);
    if (stored) {
      const last = (await session.get<number>(SESSION_ACTIVITY)) ?? 0;
      const lockAfter = (await this.deps.lockAfterMs?.()) ?? AUTO_LOCK_MS;
      const idle = now() - last;
      // Activity in the future means the clock moved back: that counts as
      // expired, or the wallet would stay unlocked for as long as it moved.
      if (idle >= 0 && idle < lockAfter) {
        if (!this.keys) {
          const entropy = fromBase64(stored);
          try {
            this.keys = this.derive(entropy);
          } finally {
            entropy.fill(0);
          }
        }
        return "unlocked";
      }
      await this.wipe();
      this.deps.changed();
    } else {
      // Session storage was cleared under us (a browser restart, say): treat
      // it as a lock, and stop the alarm, which Chrome keeps.
      this.free();
      await this.deps.autoLock.stop();
    }
    return (await local.get(VAULT_KEY)) ? "locked" : "no-wallet";
  }

  private async open(entropy: Uint8Array): Promise<void> {
    this.lockedBy = undefined;
    this.free();
    this.keys = this.derive(entropy);
    await this.deps.session.set(SESSION_ENTROPY, toBase64(entropy));
    await this.deps.session.set(SESSION_ACTIVITY, this.deps.now());
    await this.deps.autoLock.start();
  }

  private derive(entropy: Uint8Array): Keys {
    const { wasm } = this.deps;
    const seedelf = wasm.SeedelfKey.fromEntropy(entropy, 0);
    let cardano: Wasm.CardanoAccount | undefined;
    try {
      cardano = wasm.CardanoAccount.fromEntropy(entropy, 0);
      return { seedelf, cardano, oneTime: wasm.OneTimeAccounts.fromEntropy(entropy) };
    } catch (e) {
      freeQuietly(seedelf, cardano);
      throw e;
    }
  }

  /**
   * Lock: clear session storage, which only ever holds unlocked state (the
   * entropy, balances, a built or pending transaction), stop the alarm, and
   * drop the keys from memory. Storage goes first and the keys go whatever
   * happens, so nothing WebAssembly does (a trapped instance, say) can keep
   * the wallet unlocked.
   */
  private async wipe(): Promise<void> {
    try {
      await this.deps.session.clear();
      await this.deps.autoLock.stop();
    } finally {
      this.free();
    }
  }

  /** Drops the keys, freeing each one it can: never throws, and never keeps one. */
  private free(): void {
    const keys = this.keys;
    // Dropped first: a key whose free() failed can't be freed again (its
    // pointer is already gone), so it's never kept to try.
    this.keys = undefined;
    if (keys) freeQuietly(keys.seedelf, keys.cardano, keys.oneTime);
  }

  /**
   * The vault's entropy, for an unlocked wallet that asks for its password
   * again. The caller zeroes it. Wrong passwords count, and wait, like unlock's.
   */
  private async openWithPassword(password: string): Promise<Uint8Array> {
    if ((await this.load()) !== "unlocked") throw new Error("The wallet is locked.");
    const wait = await this.remainingBackoff();
    if (wait > 0) throw new Error(`Too many wrong passwords. Try again in ${Math.ceil(wait / 1000)} s.`);
    const record = (await this.deps.local.get<VaultRecord>(VAULT_KEY))!;
    try {
      const entropy = await openVault(record, password);
      await this.deps.local.remove(UNLOCK_FAILURES);
      return entropy;
    } catch (e) {
      if (!(e instanceof WrongPasswordError)) throw e;
      const failures = await this.failures();
      await this.deps.local.set(UNLOCK_FAILURES, { count: failures.count + 1, lastFailureAt: this.deps.now() });
      throw e;
    }
  }

  private async failures(): Promise<UnlockFailures> {
    return (await this.deps.local.get<UnlockFailures>(UNLOCK_FAILURES)) ?? { count: 0, lastFailureAt: 0 };
  }

  private async remainingBackoff(): Promise<number> {
    const { count, lastFailureAt } = await this.failures();
    const backoff = unlockBackoffMs(count);
    const elapsed = this.deps.now() - lastFailureAt;
    // A clock that moved backwards never shortens the wait below zero or past the cap.
    return Math.max(0, Math.min(backoff, backoff - elapsed));
  }
}

/**
 * Frees each of `objects` in its own try: free() overwrites the secrets
 * inside WebAssembly before releasing them, and an instance that trapped
 * refuses it, for one object or for all.
 */
function freeQuietly(...objects: Array<{ free(): void } | undefined>): void {
  for (const object of objects) {
    try {
      object?.free();
    } catch {
      // Its instance is broken: freshWasm drops it, memory and all.
    }
  }
}
