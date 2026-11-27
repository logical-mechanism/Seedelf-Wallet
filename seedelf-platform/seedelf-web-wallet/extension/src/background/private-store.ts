// Records this wallet keeps on the device that say something about its user
// (contacts, the Seedelf history, which UTxOs are locked, the sites
// connected to the public account, the private sessions, a payment that may
// still go through, who paid for each Seedelf, which public accounts the
// phrase has used and what they are called, and which of the contract's
// UTxOs are its own as the private index last settled them, the register
// each Seedelf minted here was put under, and Seedelf Messaging's
// conversations, requests, scan and what its reads found): sealed in
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

import type { NetworkName } from "../networks";
import { fromBase64, toBase64, type Area } from "./storage";
import type { Admit, Wallet } from "./wallet";

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
  // The register each Seedelf minted here was put under (minted-by.ts `rememberRegister`): the Seedelfs that take
  // Seedelf Messaging's first messages by themselves (messaging.ts, the 1.10.0 gate's W8).
  "mintedAt.preprod",
  "mintedAt.mainnet",
  // The private index's settled view of this wallet (contract-scan.ts): mainnet only, as the data layer is.
  "contract.mainnet",
  // Seedelf Messaging's inbox on each network (messaging.ts): which Seedelfs take first messages, what each
  // conversation and request shows, and the tombstones. Each conversation's own record is one of `CONVERSATION_RECORDS`.
  "messaging.preprod",
  "messaging.mainnet",
  // The crate's requests record, out of the inbox (the 1.10.0 gate's round 5): read only by a first message's take and
  // the user's presses on a request.
  "messagingRequests.preprod",
  "messagingRequests.mainnet",
  // Where each network's next read of the relay goes on from, with what Try again steps over and what a stop could lose
  // (messaging.ts `ReadHeld`): one 1 KiB pad, written once at the end of each run of requests.
  "messagingRead.preprod",
  "messagingRead.mainnet",
  // The user's own envelopes waiting to be posted, copied from their conversations' records (messaging.ts `postNow`).
  "messagingOutbox.preprod",
  "messagingOutbox.mainnet",
  // What a messaging step is working on while it runs (messaging.ts `setMark`), each step in a record of its own: the
  // read whose page is scanned, and the envelope being taken.
  "messagingMark.preprod",
  "messagingMark.mainnet",
  "messagingTakeMark.preprod",
  "messagingTakeMark.mainnet",
  // What each network's reads found that isn't taken yet (messaging.ts, the 1.10.0 gate's finding 8 and round 5):
  // written only by the background runner, never between two requests.
  "messagingTake.preprod",
  "messagingTake.mainnet",
  // The relay's list of certificates as this wallet last read it, behind its cursor, with the wallet's own certificates
  // waiting to be posted (messaging.ts `ListHeld`, chunk 55's 55e): within a room of its own, apart from Messages' budget.
  "messagingList.preprod",
  "messagingList.mainnet",
  // Not sealed, and no record: a mark that withdrawals of the wallet's own certificates may wait to be posted
  // (messaging.ts `markWithdrawals`), so a run finds them with Messages off and no key. Listed so Remove wallet deletes it.
  "messagingWithdraw.preprod",
  "messagingWithdraw.mainnet",
  // Not sealed, and no record: a mark of which messaging step's WebAssembly trapped ("scan" or "take"), written with no
  // key since the trap has just locked the wallet (messaging.ts `noteTrap`). Listed so Remove wallet deletes it.
  "messagingTrap.preprod",
  "messagingTrap.mainnet",
] as const;

/**
 * A Seedelf Messaging conversation's record (messaging.ts): its ratchet, its outbox and its history together, so one
 * write moves them all (protocol.md §4.2). A family, one record a conversation, named by the network and an ID of the
 * record's own, 16 random bytes that the sealed inbox maps to its conversation: the conversation's ID, which the other
 * side's browser holds too, is in no name (the 1.10.0 gate's W7). Removing the wallet finds them by this prefix, with
 * no key.
 */
export const CONVERSATION_RECORDS = "conversation.";
export type ConversationRecord = `conversation.${NetworkName}.${string}`;

/** A conversation's record name, by the record's own ID (`newRecordId`). */
export const conversationRecord = (network: NetworkName, id: string): ConversationRecord =>
  `${CONVERSATION_RECORDS}${network}.${id}`;

/** A new conversation record's ID: 16 random bytes, hex. */
export function newRecordId(): string {
  return Array.from(randomBytes(16), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type RecordName = (typeof PRIVATE_RECORDS)[number] | ConversationRecord;

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
const WHAT: Record<(typeof PRIVATE_RECORDS)[number], I18nKey> = {
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
  "mintedAt.preprod": "worker.record.mintedBy",
  "mintedAt.mainnet": "worker.record.mintedBy",
  "contract.mainnet": "worker.record.contract",
  "messaging.preprod": "worker.record.messaging",
  "messaging.mainnet": "worker.record.messaging",
  "messagingRequests.preprod": "worker.record.messaging",
  "messagingRequests.mainnet": "worker.record.messaging",
  "messagingRead.preprod": "worker.record.messaging",
  "messagingRead.mainnet": "worker.record.messaging",
  "messagingOutbox.preprod": "worker.record.messaging",
  "messagingOutbox.mainnet": "worker.record.messaging",
  "messagingMark.preprod": "worker.record.messaging",
  "messagingMark.mainnet": "worker.record.messaging",
  "messagingTakeMark.preprod": "worker.record.messaging",
  "messagingTakeMark.mainnet": "worker.record.messaging",
  "messagingTake.preprod": "worker.record.messaging",
  "messagingTake.mainnet": "worker.record.messaging",
  "messagingList.preprod": "worker.record.messaging",
  "messagingList.mainnet": "worker.record.messaging",
  "messagingWithdraw.preprod": "worker.record.messaging",
  "messagingWithdraw.mainnet": "worker.record.messaging",
  "messagingTrap.preprod": "worker.record.messaging",
  "messagingTrap.mainnet": "worker.record.messaging",
};

const what = (name: RecordName): I18nKey =>
  name.startsWith(CONVERSATION_RECORDS) ? "worker.record.conversation" : WHAT[name as (typeof PRIVATE_RECORDS)[number]];

/**
 * A record that's there but won't open: another wallet's, damaged, or sealed
 * in a way this version can't read. It never reads as empty, so nothing is
 * written over it: what it holds may still come back (launch review #45).
 * Its words are named `.warn.`: when Lovejoin's record won't open as a
 * session's chain is built, they are the reason the return's warning gives
 * (sessions.ts leftOut).
 */
export class UnreadableRecordError extends Error {
  constructor(readonly record: RecordName) {
    super(t("worker.record.warn.unreadable", { what: t(what(record)) }));
  }
}

export class PrivateStore {
  /** The nonce each record was last sealed under by this store, while the worker lives (`lastSealed`). */
  private readonly nonces = new Map<RecordName, string>();

  constructor(private readonly deps: { wallet: Wallet; local: Area }) {}

  /**
   * The record, or undefined when there's none. Throws if locked, and
   * UnreadableRecordError when it's there but won't open. `admit`: the
   * unseal's own check as its turn in the wallet's queue comes
   * (`Wallet.withStoreKey`): false, and NotAdmitted, nothing unsealed.
   */
  async get<T>(name: RecordName, admit?: Admit): Promise<T | undefined> {
    return this.open<T>(name, await this.sealed(name), admit);
  }

  /**
   * The record as the area holds it, still sealed, with no key: `get`'s read of the area, apart from its unseal, so a
   * caller can wait between the two (messaging.ts keeps its background work off its runs of requests).
   */
  async sealed(name: RecordName): Promise<unknown> {
    return this.deps.local.get<Sealed>(PRIVATE_PREFIX + name);
  }

  /**
   * What `sealed` gave for `name`, unsealed: `get`'s second half, in the wallet's queue. Throws as `get` does; `admit`
   * as `get`'s.
   */
  async open<T>(name: RecordName, stored: unknown, admit?: Admit): Promise<T | undefined> {
    const sealed = stored as Sealed | undefined;
    return this.deps.wallet.withStoreKey((key) => {
      if (!sealed) return undefined;
      try {
        const plain = xchacha20poly1305(key, fromBase64(sealed.nonce), aad(name)).decrypt(fromBase64(sealed.data));
        return JSON.parse(new TextDecoder().decode(plain)) as T;
      } catch {
        throw new UnreadableRecordError(name);
      }
    }, admit);
  }

  /**
   * Seals `value` (JSON, padded) under a fresh nonce. Throws if locked. `admit`: the seal's own check as its turn in the
   * wallet's queue comes: false, and NotAdmitted, nothing sealed or written.
   */
  async set(name: RecordName, value: unknown, admit?: Admit): Promise<void> {
    const sealed = await this.deps.wallet.withStoreKey((key): Sealed => {
      const nonce = randomBytes(24);
      const plain = padded(value);
      const data = xchacha20poly1305(key, nonce, aad(name)).encrypt(plain);
      return { v: 1, nonce: toBase64(nonce), data: toBase64(data) };
    }, admit);
    await this.deps.local.set(PRIVATE_PREFIX + name, sealed);
    this.nonces.set(name, sealed.nonce);
  }

  /**
   * The nonce this store last sealed the record under, as `sealedAs` would read it back, with no read of the area:
   * undefined where it hasn't written it while the worker lives, or it was deleted since.
   */
  lastSealed(name: RecordName): string | undefined {
    return this.nonces.get(name);
  }

  /** Deletes the record. No key needed. */
  async remove(name: RecordName): Promise<void> {
    this.nonces.delete(name);
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
