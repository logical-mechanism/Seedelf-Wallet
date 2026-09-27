// Records this wallet keeps on the device that say something about its user
// (contacts, the Seedelf history, which UTxOs are locked, the sites
// connected to the public account, the private sessions, a payment that may
// still go through, who paid for each Seedelf): sealed in
// chrome.storage.local with XChaCha20-Poly1305 under a key derived from the
// recovery phrase's entropy (Wallet.withStoreKey). They can't be read while
// the wallet is locked, or by anyone without the phrase, and removing the
// wallet deletes them.

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/hashes/utils.js";

import { fromBase64, toBase64, type Area } from "./storage";
import type { Wallet } from "./wallet";

/** chrome.storage.local keys start with this, then the record's name. */
export const PRIVATE_PREFIX = "seedelf.private.";

/** Every record, so removing the wallet can delete them all. */
export const PRIVATE_RECORDS = [
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
  "maybeSent.preprod",
  "maybeSent.mainnet",
  "mintedBy.preprod",
  "mintedBy.mainnet",
] as const;
export type RecordName = (typeof PRIVATE_RECORDS)[number];

interface Sealed {
  v: 1;
  nonce: string;
  data: string;
}

/** The record's name is bound in as associated data, so records can't be swapped. */
const aad = (name: RecordName) => new TextEncoder().encode(PRIVATE_PREFIX + name);

/** What each record keeps, in the wallet's words. */
const WHAT: Record<RecordName, string> = {
  contacts: "your contacts",
  "history.preprod": "your private history",
  "history.mainnet": "your private history",
  "coins.preprod": "your locked UTxOs",
  "coins.mainnet": "your locked UTxOs",
  dapps: "your connected sites",
  "sessions.preprod": "your private sessions",
  "sessions.mainnet": "your private sessions",
  "lovejoin.preprod": "your Lovejoin boxes",
  "lovejoin.mainnet": "your Lovejoin boxes",
  "maybeSent.preprod": "a payment that may still go through",
  "maybeSent.mainnet": "a payment that may still go through",
  "mintedBy.preprod": "who paid for your Seedelfs",
  "mintedBy.mainnet": "who paid for your Seedelfs",
};

/**
 * A record that's there but won't open: another wallet's, damaged, or sealed
 * in a way this version can't read. It never reads as empty, so nothing is
 * written over it: what it holds may still come back (launch review #45).
 */
export class UnreadableRecordError extends Error {
  constructor(readonly record: RecordName) {
    super(`Seedelf Wallet couldn't open its record of ${WHAT[record]} on this device, so it won't write over it.`);
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

  /** Seals `value` (JSON) under a fresh nonce. Throws if locked. */
  async set(name: RecordName, value: unknown): Promise<void> {
    const sealed = await this.deps.wallet.withStoreKey((key): Sealed => {
      const nonce = randomBytes(24);
      const plain = new TextEncoder().encode(JSON.stringify(value));
      const data = xchacha20poly1305(key, nonce, aad(name)).encrypt(plain);
      return { v: 1, nonce: toBase64(nonce), data: toBase64(data) };
    });
    await this.deps.local.set(PRIVATE_PREFIX + name, sealed);
  }
}
