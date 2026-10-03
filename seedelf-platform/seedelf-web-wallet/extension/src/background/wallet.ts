// Wallet state and the lock, owned by the service worker.
//
//   no-wallet ──create/restore──▶ unlocked ◀──unlock── locked
//                                    └──lock / auto-lock──▶┘
//
// While unlocked, the derived keys live in worker memory and the vault
// entropy is copied into chrome.storage.session (memory only, cleared when the
// browser closes). A restarted worker re-derives the keys from there instead
// of asking for the password again. See docs/architecture.md#service-worker.

import { t } from "../i18n";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import { passwordProblem } from "../shared/password";
import type { Account, UnlockResult, WalletState } from "../shared/rpc";
import { fromBase64, toBase64, type Area } from "./storage";
import { LOCAL_PREFERENCES } from "./preferences";
import { KEPT_ON_RESET, PRIVATE_PREFIX, PRIVATE_RECORDS } from "./private-store";
import { lastSpentAt } from "./spent";
import { openVault, sealVault, VAULT_KEY, WrongPasswordError, type VaultRecord } from "./vault";

/**
 * What chrome.storage.local caches beside the wallet, which Remove wallet
 * deletes too: the pool list (staking.ts LOCAL_POOLS_PREFIX), which says when
 * staking was last browsed, and ADA's price as it was kept before it moved to
 * session storage (prices.ts LOCAL_PRICES). Named here, not imported: those
 * modules import this one.
 */
export const LOCAL_CACHES = ["seedelf.pools.preprod", "seedelf.pools.mainnet", "seedelf.prices"] as const;
import { isTrap } from "./wasm";

/** HKDF salt of the key that seals private records on the device, v1. */
const STORE_SALT = new TextEncoder().encode("seedelf-web-wallet-private-store-v1");
const STORE_INFO = new TextEncoder().encode("records");

/** Lock after this long without UI activity, unless the settings say otherwise (`lockAfterMs`). */
export const AUTO_LOCK_MS = 15 * 60_000;

/**
 * How far the clock may step back after activity with the wallet staying
 * unlocked: a time service's usual correction. A step this size only puts
 * the lock off by as much.
 */
export const CLOCK_STEP_TOLERANCE_MS = 30_000;

/** chrome.storage.session: the vault entropy (base64) while unlocked. */
export const SESSION_ENTROPY = "seedelf.entropy";
/** chrome.storage.session: when the user last did something (ms since the epoch). */
export const SESSION_ACTIVITY = "seedelf.lastActivity";
/**
 * chrome.storage.session: when the wallet last unlocked, was created or
 * restored (ms since the epoch). A restarted worker keeps it; a lock or a
 * closed browser wipes it with the rest (`unlockedAt`).
 */
export const SESSION_UNLOCKED_AT = "seedelf.unlockedAt";
/**
 * chrome.storage.session: what the wallet knows of its own sends beyond what
 * it spent (spent.ts), which a lock wipes (KnownSends). The one thing a lock
 * keeps: two times, nothing of what was sent (`sends`).
 */
export const SESSION_SENDS = "seedelf.sends";
/**
 * What the wallet knows of its own sends beyond what it spent: its last send
 * before the last lock, or the last try of a payment let go since, whose
 * spent UTxOs were freed (`last`, noteSend); and when session storage began
 * (`since`), the browser's start or the extension's: a closed browser wipes
 * what it spent unseen, so a send before then may have been as late as then
 * (noteStart).
 */
interface KnownSends {
  last?: number;
  since?: number;
}

/**
 * Notes when session storage began, if nothing says what the wallet knows of
 * its sends yet: at every start of the worker (sw.ts), so its first after
 * the browser's, or the extension's, notes it before anything unlocks. A
 * lock keeps it. A send before then is forgotten, and may have been as late
 * as then (independent review M10).
 */
export async function noteStart(session: Area, now: number): Promise<void> {
  if ((await session.get(SESSION_SENDS)) === undefined) await session.set(SESSION_SENDS, { since: now });
}

/**
 * Notes a send at `at` that what the wallet spent no longer says: a
 * maybe-sent payment let go as unseen frees its UTxOs, while its last try
 * may still have reached a node (pending.ts). Lovejoin's withdraws keep away
 * from it all the same (`sends`, final review F8). Only ever later. Call it
 * while unlocked.
 */
export async function noteSend(session: Area, at: number): Promise<void> {
  const kept = (await session.get<KnownSends>(SESSION_SENDS)) ?? {};
  if ((kept.last ?? 0) < at) await session.set(SESSION_SENDS, { ...kept, last: at });
}
/**
 * chrome.storage.session: the last balance reading per network, e.g.
 * `seedelf.balances.preprod`. It says which contract UTxOs are the user's,
 * so it never goes to disk and it's wiped on lock.
 */
export const SESSION_BALANCES_PREFIX = "seedelf.balances.";
/**
 * chrome.storage.session: set while only the kept reading's private side is
 * behind, e.g. `seedelf.balancesPrivateStale.preprod`: a private spend
 * landed. The next reading reads the contract alone and keeps the account's
 * side (balances.ts), so Koios never sees the account read in the same
 * second as a private transaction lands (privacy review §2.9).
 */
export const SESSION_PRIVATE_STALE_PREFIX = "seedelf.balancesPrivateStale.";
/** chrome.storage.local: consecutive failed unlocks, kept across restarts. */
export const UNLOCK_FAILURES = "seedelf.unlockFailures";

/** What a request gets when WebAssembly trapped under it: the wallet locked itself (see `broken`). */
export const WASM_BROKEN = () => t("worker.wallet.trapped");

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
  /**
   * Which public account the wallet works on: the user's choice
   * (preferences.ts `AccountChoice`). Read at every key use, so a switch
   * needs nothing else — the next use re-derives (`load`). Account 0 without
   * one, which is every wallet from before chunk 18.
   */
  activeAccount?: () => Promise<number>;
}

export interface Keys {
  /**
   * The Seedelf key, always on account 0: one private balance for the whole
   * phrase, whichever public account is active (the owner, 2026-10-02).
   * Stealth addressing is what unlinks money moved in from different
   * accounts, so the key needs no index of its own.
   */
  seedelf: Wasm.SeedelfKey;
  /** The active public account's CIP-1852 keys (`account`). */
  cardano: Wasm.CardanoAccount;
  /** Which CIP-1852 account `cardano` is. */
  account: number;
  /** Private sessions' one-time accounts (account 24301'): never the public account's keys. */
  oneTime: Wasm.OneTimeAccounts;
}

export class Wallet {
  private keys: Keys | undefined;
  /**
   * Other public accounts' Cardano keys, derived on demand and kept while
   * unlocked: a site stays connected to the account it connected to, so the
   * connector signs with that account's keys whichever one is active
   * (`withAccount`). Freed with the rest on lock.
   */
  private others = new Map<number, Wasm.CardanoAccount>();
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
        throw new Error(t("worker.wallet.exists"));
      }
      const entropy = this.deps.wasm.phraseToEntropy(phrase);
      try {
        const record = await sealVault(entropy, password);
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
      if (state === "no-wallet") throw new Error(t("worker.wallet.none"));

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

  /**
   * When the wallet last unlocked (ms): its unlock, or its create or
   * restore. Throws if locked. Nothing goes out the moment it unlocks
   * (privacy review §3.1): what the worker sends by itself waits a fresh
   * draw from it, made by whichever run or page gets there first, not only
   * the unlock's own run (independent review L10, L11, L12). One unlocked
   * before it was kept counts from now.
   */
  unlockedAt(): Promise<number> {
    return this.serial(async () => {
      if ((await this.load()) !== "unlocked") throw new Error(t("worker.wallet.locked"));
      const at = await this.deps.session.get<number>(SESSION_UNLOCKED_AT);
      if (typeof at === "number") return at;
      const now = this.deps.now();
      await this.deps.session.set(SESSION_UNLOCKED_AT, now);
      return now;
    });
  }

  /**
   * When the wallet last sent something, on either network (`sent`): as what
   * it spent says (spent.ts), or the last send before a lock, which the lock
   * keeps (SESSION_SENDS), or the last try of a payment let go as unseen
   * (noteSend, final review F8). And until when it may have sent something it has
   * forgotten (`forgotten`): a closed browser wipes what it spent unseen, so
   * a send before the browser started again may have been as late as that
   * (noteStart). 0 for none. An unlock is neither: nothing was sent then.
   * Lovejoin's withdraws keep away from both (QUIET_AFTER_SEND_MS,
   * independent review M10). Throws if locked.
   */
  sends(): Promise<{ sent: number; forgotten: number }> {
    return this.serial(async () => {
      if ((await this.load()) !== "unlocked") throw new Error(t("worker.wallet.locked"));
      const { session, now } = this.deps;
      const kept = (await session.get<KnownSends>(SESSION_SENDS)) ?? {};
      const spent = (await lastSpentAt(session, now())) ?? 0;
      return { sent: Math.max(spent, kept.last ?? 0), forgotten: kept.since ?? 0 };
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
      if ((await this.load()) !== "unlocked") throw new Error(t("worker.wallet.locked"));
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
        // An older vault's creation time goes with it (vault.ts).
        await this.deps.local.set(VAULT_KEY, await sealVault(entropy, next));
      } finally {
        entropy.fill(0);
      }
    });
  }

  /**
   * Deletes the vault, the sealed records and the caches. Where the wallet
   * opens and which network it's on stay (the privacy policy says so), and
   * so does a payment that may still go through (`KEPT_ON_RESET`): the same
   * phrase restored watches it again, so it's never paid twice (independent
   * review M2). The UI asks for a typed confirmation first, and Remove wallet
   * says what's still open (handlers.ts).
   */
  reset(): Promise<void> {
    return this.serial(async () => {
      await this.wipe();
      const records = PRIVATE_RECORDS.filter((name) => !KEPT_ON_RESET.includes(name)).map((name) => PRIVATE_PREFIX + name);
      await this.deps.local.remove(VAULT_KEY, UNLOCK_FAILURES, LOCAL_PREFERENCES, ...records, ...LOCAL_CACHES);
      this.deps.changed();
    });
  }

  /** The unlocked wallet's public identifiers, for the account it is working on. */
  account(network: NetworkName): Promise<Account> {
    return this.withKeys(({ seedelf, cardano, account }) => {
      const net = network === "mainnet" ? this.deps.wasm.Network.Mainnet : this.deps.wasm.Network.Preprod;
      const base = seedelf.baseRegister();
      try {
        return {
          receiveAddress: cardano.receiveAddress(net, 0),
          stakeAddress: cardano.stakeAddress(net),
          seedelfPublicValue: base.publicValue,
          account,
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
      if ((await this.load()) !== "unlocked") throw new Error(t("worker.wallet.locked"));
      return task(this.keys!);
    });
  }

  /**
   * Runs `task` with the keys of public account `index`, whichever one is
   * active: how a connected site keeps talking to the account it connected
   * to (dapp.ts). A site that followed the active account would be handed a
   * second account's addresses and learn the two are one wallet's **without
   * the user choosing that** — which is the part that matters. A link the
   * user makes on purpose is their business (a payment between their own
   * accounts is allowed and merely said); one a site is handed behind their
   * back is not.
   *
   * `keys.seedelf` and `keys.oneTime` are the wallet's own either way — the
   * Seedelf key is on account 0 whichever public account is used. Derived
   * once and kept while unlocked; freed on lock with the rest.
   */
  withAccount<T>(index: number, task: (keys: Keys) => T | Promise<T>): Promise<T> {
    return this.serial(async () => {
      if ((await this.load()) !== "unlocked") throw new Error(t("worker.wallet.locked"));
      const keys = this.keys!;
      if (index === keys.account) return task(keys);
      let cardano = this.others.get(index);
      if (!cardano) {
        const entropy = fromBase64((await this.deps.session.get<string>(SESSION_ENTROPY))!);
        try {
          cardano = this.deps.wasm.CardanoAccount.fromEntropy(entropy, index);
        } finally {
          entropy.fill(0);
        }
        this.others.set(index, cardano);
      }
      return task({ ...keys, cardano, account: index });
    });
  }

  /**
   * Runs `task` with the key that seals this wallet's private records on the
   * device (private-store.ts): HKDF-SHA-256 of the vault's entropy, so it
   * exists only while unlocked. It's zeroed afterwards. Throws if locked.
   */
  withStoreKey<T>(task: (key: Uint8Array) => T | Promise<T>): Promise<T> {
    return this.serial(async () => {
      if ((await this.load()) !== "unlocked") throw new Error(t("worker.wallet.locked"));
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
        throw new Error(WASM_BROKEN());
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
      // Activity in the future means the clock moved back. A step past the
      // tolerance counts as expired, or the wallet would stay unlocked for
      // as long as it moved.
      if (idle >= -CLOCK_STEP_TOLERANCE_MS && idle < lockAfter) {
        // The active account is read here, not cached: a switch writes the
        // choice and nothing else, and the next key use re-derives. Every
        // one goes through this inside `serial`, so no request can sign with
        // the account the user just left.
        const account = await this.active();
        if (!this.keys || this.keys.account !== account) {
          const entropy = fromBase64(stored);
          try {
            const keys = this.derive(entropy, account);
            const left = this.keys;
            this.keys = keys;
            // A switch frees the account it left. Other accounts' keys stay:
            // a connected site still talks to the one it connected to.
            if (left) freeQuietly(left.seedelf, left.cardano, left.oneTime);
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
    this.keys = this.derive(entropy, await this.active());
    const now = this.deps.now();
    await this.deps.session.set(SESSION_ENTROPY, toBase64(entropy));
    await this.deps.session.set(SESSION_ACTIVITY, now);
    await this.deps.session.set(SESSION_UNLOCKED_AT, now);
    await this.deps.autoLock.start();
  }

  private derive(entropy: Uint8Array, account: number): Keys {
    const { wasm } = this.deps;
    const seedelf = wasm.SeedelfKey.fromEntropy(entropy, 0);
    let cardano: Wasm.CardanoAccount | undefined;
    try {
      cardano = wasm.CardanoAccount.fromEntropy(entropy, account);
      return { seedelf, cardano, account, oneTime: wasm.OneTimeAccounts.fromEntropy(entropy) };
    } catch (e) {
      freeQuietly(seedelf, cardano);
      throw e;
    }
  }

  /** The public account the wallet works on, as the user's choice has it now. */
  private active(): Promise<number> {
    return this.deps.activeAccount?.() ?? Promise.resolve(0);
  }

  /**
   * Lock: clear session storage, which holds unlocked state (the entropy,
   * balances, a built or pending transaction), stop the alarm, and drop the
   * keys from memory. Storage goes first and the keys go whatever happens,
   * so nothing WebAssembly does (a trapped instance, say) can keep the
   * wallet unlocked. What it knows of its own sends outlasts the lock, two
   * times and nothing of what was sent, so a Lovejoin box never goes back
   * minutes after a send the lock would have made it forget (SESSION_SENDS,
   * independent review M10).
   */
  private async wipe(): Promise<void> {
    try {
      const sends = await this.lockKeeps().catch(() => undefined);
      await this.deps.session.clear();
      if (sends) await this.deps.session.set(SESSION_SENDS, sends).catch(() => undefined);
      await this.deps.autoLock.stop();
    } finally {
      this.free();
    }
  }

  /** What a lock keeps of the wallet's sends (KnownSends): nothing when it knows of none. */
  private async lockKeeps(): Promise<KnownSends | undefined> {
    const { session, now } = this.deps;
    const kept = (await session.get<KnownSends>(SESSION_SENDS)) ?? {};
    const last = Math.max(kept.last ?? 0, (await lastSpentAt(session, now())) ?? 0);
    const sends: KnownSends = { ...(last ? { last } : {}), ...(kept.since !== undefined ? { since: kept.since } : {}) };
    return Object.keys(sends).length ? sends : undefined;
  }

  /** Drops the keys, freeing each one it can: never throws, and never keeps one. */
  private free(): void {
    const keys = this.keys;
    const others = [...this.others.values()];
    // Dropped first: a key whose free() failed can't be freed again (its
    // pointer is already gone), so it's never kept to try.
    this.keys = undefined;
    this.others.clear();
    freeQuietly(...others);
    if (keys) freeQuietly(keys.seedelf, keys.cardano, keys.oneTime);
  }

  /**
   * The vault's entropy, for an unlocked wallet that asks for its password
   * again. The caller zeroes it. Wrong passwords count, and wait, like unlock's.
   */
  private async openWithPassword(password: string): Promise<Uint8Array> {
    if ((await this.load()) !== "unlocked") throw new Error(t("worker.wallet.locked"));
    const wait = await this.remainingBackoff();
    if (wait > 0) throw new Error(t("worker.wallet.backoff", { seconds: Math.ceil(wait / 1000) }));
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
