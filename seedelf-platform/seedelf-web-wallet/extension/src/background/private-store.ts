// Records this wallet keeps on the device that say something about its user
// (contacts, the Seedelf history, which UTxOs are locked, the sites
// connected to the public account, the private sessions, a payment that may
// still go through, who paid for each Seedelf, which public accounts the
// phrase has used and what they are called): sealed in
// chrome.storage.local with XChaCha20-Poly1305 under a key derived from the
// recovery phrase's entropy (Wallet.withStoreKey). They can't be read while
// the wallet is locked, or by anyone without the phrase, and removing the
// wallet deletes them, but for a payment, or a mix from the public account,
// that may still go through (`KEPT_ON_RESET`). Each is padded before it's
// sealed, so its size says
// little of what it holds: how many Lovejoin boxes, how long a history
// (privacy review §3.13). Whether a record exists still shows.

import { type I18nKey, t } from "../i18n";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/hashes/utils.js";

import { fromBase64, toBase64, type Area } from "./storage";
import type { Wallet } from "./wallet";

/** chrome.storage.local keys start with this, then the record's name. */
export const PRIVATE_PREFIX = "seedelf.private.";

/** Every record, so removing the wallet can delete them all. */
export const PRIVATE_RECORDS = [
  "accounts",
  "contacts",
  "history.preprod",
  "history.mainnet",
  "coins.preprod",
  "coins.mainnet",
  "dapps",
  "sessions.preprod",
  "sessions.mainnet",
  "lovejoin.preprod",
  "lovejoin.mainnet",
  "lovejoinMaybe.preprod",
  "lovejoinMaybe.mainnet",
  "maybeSent.preprod",
  "maybeSent.mainnet",
  "mintedBy.preprod",
  "mintedBy.mainnet",
] as const;
export type RecordName = (typeof PRIVATE_RECORDS)[number];

/**
 * What removing the wallet keeps: a payment that may still go through, which
 * is there only until it's settled. Sealed under the phrase's key, the same
 * phrase restored here puts its watch back, so nothing is paid beside it; a
 * wallet of another phrase can't open it, and deletes it when it's made
 * (pending.ts, independent review M2). So is a mix from the public account
 * stopped at a transaction that may have gone through: no other mix from
 * the account is built until it's settled (lovejoin.ts keepOnReset, final
 * review F1).
 */
export const KEPT_ON_RESET: readonly RecordName[] = [
  "maybeSent.preprod",
  "maybeSent.mainnet",
  "lovejoinMaybe.preprod",
  "lovejoinMaybe.mainnet",
];

interface Sealed {
  v: 1;
  nonce: string;
  data: string;
}

/** The smallest a sealed record's JSON is padded to; larger ones go to the next power of two. */
export const PAD_MIN_BYTES = 1024;

/**
 * `value` as JSON, padded with spaces to PAD_MIN_BYTES or the next power of
 * two: JSON.parse ignores them, so records sealed before padding, and after,
 * read the same.
 */
function padded(value: unknown): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(value));
  let size = PAD_MIN_BYTES;
  while (size < json.length) size *= 2;
  const plain = new Uint8Array(size).fill(0x20);
  plain.set(json);
  return plain;
}

/** The record's name is bound in as associated data, so records can't be swapped. */
const aad = (name: RecordName) => new TextEncoder().encode(PRIVATE_PREFIX + name);

/** What each record keeps, in the wallet's words. */
const WHAT: Record<RecordName, I18nKey> = {
  accounts: "worker.record.accounts",
  contacts: "worker.record.contacts",
  "history.preprod": "worker.record.history",
  "history.mainnet": "worker.record.history",
  "coins.preprod": "worker.record.coins",
  "coins.mainnet": "worker.record.coins",
  dapps: "worker.record.dapps",
  "sessions.preprod": "worker.record.sessions",
  "sessions.mainnet": "worker.record.sessions",
  "lovejoin.preprod": "worker.record.lovejoin",
  "lovejoin.mainnet": "worker.record.lovejoin",
  "lovejoinMaybe.preprod": "worker.record.lovejoinMaybe",
  "lovejoinMaybe.mainnet": "worker.record.lovejoinMaybe",
  "maybeSent.preprod": "worker.record.maybeSent",
  "maybeSent.mainnet": "worker.record.maybeSent",
  "mintedBy.preprod": "worker.record.mintedBy",
  "mintedBy.mainnet": "worker.record.mintedBy",
};

/**
 * A record that's there but won't open: another wallet's, damaged, or sealed
 * in a way this version can't read. It never reads as empty, so nothing is
 * written over it: what it holds may still come back (launch review #45).
 */
export class UnreadableRecordError extends Error {
  constructor(readonly record: RecordName) {
    super(t("worker.record.unreadable", { what: t(WHAT[record]) }));
  }
}

export class PrivateStore {
  constructor(private readonly deps: { wallet: Wallet; local: Area }) {}

  /**
   * The record, or undefined when there's none. Throws if locked, and
   * UnreadableRecordError when it's there but won't open.
   */
  async get<T>(name: RecordName): Promise<T | undefined> {
    const sealed = await this.deps.local.get<Sealed>(PRIVATE_PREFIX + name);
    return this.deps.wallet.withStoreKey((key) => {
      if (!sealed) return undefined;
      try {
        const plain = xchacha20poly1305(key, fromBase64(sealed.nonce), aad(name)).decrypt(fromBase64(sealed.data));
        return JSON.parse(new TextDecoder().decode(plain)) as T;
      } catch {
        throw new UnreadableRecordError(name);
      }
    });
  }

  /** Seals `value` (JSON, padded) under a fresh nonce. Throws if locked. */
  async set(name: RecordName, value: unknown): Promise<void> {
    const sealed = await this.deps.wallet.withStoreKey((key): Sealed => {
      const nonce = randomBytes(24);
      const plain = padded(value);
      const data = xchacha20poly1305(key, nonce, aad(name)).encrypt(plain);
      return { v: 1, nonce: toBase64(nonce), data: toBase64(data) };
    });
    await this.deps.local.set(PRIVATE_PREFIX + name, sealed);
  }

  /** Deletes the record. No key needed. */
  async remove(name: RecordName): Promise<void> {
    await this.deps.local.remove(PRIVATE_PREFIX + name);
  }

  /** The nonce the record was last sealed under, which names that one write; undefined when there's none. No key needed. */
  async sealedAs(name: RecordName): Promise<string | undefined> {
    return (await this.deps.local.get<Sealed>(PRIVATE_PREFIX + name))?.nonce;
  }

  /**
   * Deletes the record if it's still the write `nonce` names (`sealedAs`).
   * No key needed, so it works while locked: a payment refused after a lock
   * came mid-submit (pending.ts, independent review M1).
   */
  async removeIf(name: RecordName, nonce: string): Promise<void> {
    if ((await this.sealedAs(name)) === nonce) await this.deps.local.remove(PRIVATE_PREFIX + name);
  }
}
