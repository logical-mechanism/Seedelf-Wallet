// Seedelf Messaging in the worker (chunk 54's 54e): the conversations'
// records, reading the relay while unlocked, and sending. The protocol is
// seedelf-messaging's, through WebAssembly's stateless exports (54d): each
// takes the records it needs and gives back the ones it changed, so this
// service decides every write.
//
// One queue (protocol.md §4.2). Every operation on a conversation's state
// runs in it, one at a time: a receive, a send, an accept, a deletion, a
// stamp set. No two read the same state, so a message key is never used
// twice. Only what can't touch state runs outside it: the relay's pages, the
// scan (which answers indexes only), and solving proof of work.
//
// The records, sealed in the private store (private-store.ts) per network:
//
//   messaging.<network>              The inbox: the scan's cursor, the
//                                    requests and the tombstones (the
//                                    crate's own records), the registers
//                                    each of the wallet's Seedelfs has
//                                    held, and what each conversation shows.
//   conversation.<network>.<cid>     A conversation: its ratchet, its
//                                    outbox and its history together, so
//                                    one write moves them all.
//
// A conversation's record is written before the inbox that lists it, and
// deleted after the inbox that stops listing it: a stop between the two
// leaves a record nothing lists, which the next sync deletes. The inbox
// never lists a record that isn't there.
//
// Sending (§4.2): in the queue, the ratchet steps and the envelope goes into
// the record as pending; out of it, the relay's stamp is solved and the
// stored bytes posted; in the queue again, it's marked posted. A stopped
// worker posts every pending envelope again at its next sync, the same
// bytes, which the relay takes as already held.
//
// Receiving: a page is scanned out of the queue; each envelope that's the
// key's is received in it, and the record written; the cursor moves once the
// page is done. A stop between the two reads the page again, and every
// envelope already taken is refused as a duplicate (§5).
//
// Nothing reaches the relay while a network's Messages switch is off
// (preferences.ts `messaging`), and nothing is read while locked: there's no
// key then. Pages are read on unlock and every minute after, through
// `seedelf.messaging`'s alarm (sw.ts).

import { t } from "../i18n";
import type * as Wasm from "@seedelf/wasm";

import { NETWORKS, type NetworkName } from "../networks";
import {
  CONVERSATION_NAME_CHARS,
  type MessagingConversation,
  type MessagingEntry,
  type MessagingOverview,
  type MessagingRequest,
  type MessagingThread,
} from "../shared/rpc";
import type { RegisterHex } from "./chain";
import type { PreferencesService } from "./preferences";
import {
  conversationRecord,
  CONVERSATION_RECORDS,
  PRIVATE_PREFIX,
  type PrivateStore,
  UnreadableRecordError,
} from "./private-store";
import { type PostAnswer, type RelayClient, RelayDown, RelayNotAsked, type RelayPage } from "./relay";
import type { Area } from "./storage";
import { phrasePin, type PhrasePin, type Wallet, WalletLocked, WASM_BROKEN } from "./wallet";
import { isTrap } from "./wasm";

/** Envelopes scanned in one turn of the wallet's queue: about 0.2 s (protocol.md §8). */
export const SCAN_BATCH = 200;

/** Attempts in one slice of a stamp's search, with a turn of the event loop between: about 28 ms. */
export const STAMP_SLICE = 2 ** 16;

/**
 * The history's budget across every conversation on both networks (the owner's call 10, 2026-11-21): about 5 MB of
 * the extension's storage, counted as each record is stored (sealed, padded to a power of two, in base64). Past it,
 * the oldest messages go first, and their thread says how many.
 */
export const HISTORY_BUDGET_BYTES = 5 * 1024 * 1024;

/** Skipped keys and tombstones are expired at most this often. */
export const EXPIRE_EVERY_MS = 60 * 60_000;

/**
 * A post's price before any page has said one: the pool's base (protocol.md §17.4). A 402 names the right one, and
 * every page after carries it.
 */
export const RELAY_BASE_BITS: Record<NetworkName, number> = { mainnet: 18, preprod: 16 };

/** The plaintext's first byte: what it holds [choice, protocol.md §18]. Only text so far. */
export const KIND_TEXT = 0x01;

/** The inbox, `messaging.<network>`. */
export interface Inbox {
  v: 1;
  /** What to ask the relay from next; none before the first page. */
  cursor?: string;
  /** When a page last said envelopes after the cursor were gone (ms): messages sent then may never arrive. */
  gapAt?: number;
  /** The crate's requests' record, hex (protocol.md §16.5). */
  requests?: string;
  /** The crate's tombstones' record, hex. */
  tombstones?: string;
  /** Every register each of the wallet's Seedelfs is known to have held, by asset name (hex). */
  handles: Record<string, RegisterHex[]>;
  /** What each conversation shows, by cid, without opening its record. */
  conversations: Record<string, Meta>;
  /** Each request's messages not yet shown, by cid. */
  requestsUnread: Record<string, number>;
  /** When skipped keys and tombstones were last expired (ms). */
  expiredAt?: number;
  /**
   * Conversations this browser no longer has (protocol.md §6): a session message for a cid it doesn't hold, by cid,
   * when the last came and how many. At most LOST_KEPT, each until its envelopes can no longer be on the relay.
   */
  lost: Record<string, { at: number; count: number }>;
}

/** The conversations this browser no longer has that the inbox names at most. */
export const LOST_KEPT = 20;

/** How long a lost conversation is named after its last message: the relay's 36 hours, with a margin. */
export const LOST_FOR_MS = 48 * 3600_000;

/** What the inbox keeps of a conversation. */
export interface Meta {
  role: "initiator" | "responder";
  /** The Seedelf this wallet wrote to (asset name, hex), when it wrote first to one. */
  handle?: string;
  /** Which of this wallet's Seedelfs it was written to (asset name, hex), when the other side wrote first. */
  to?: string;
  /** What its `replaces` amounted to (protocol.md §6), when it names one. */
  continues?: { cid: string; verified: boolean };
  /** When it was started (ms). */
  startedAt: number;
  /** The last message, either way (ms). */
  lastAt: number;
  /** Messages received and not yet shown. */
  unread: number;
  /** Messages waiting to be posted, and texts waiting for the first-contact stamp. */
  outbox: number;
  /** What its record takes of the extension's storage (`storedBytes`). */
  bytes: number;
  /** Its oldest message kept (ms), which the budget deletes first. */
  oldestAt: number;
  /** The conversation this one was started again as. */
  restartedAs?: string;
  /** Written first, and a reply has come: its messages no longer carry F, and its 48 hours no longer matter. */
  answered?: boolean;
  /**
   * Messages refused as more than MAX_SKIP ahead (protocol.md §6): the ratchet can't reach them, and the conversation
   * may not continue.
   */
  unreachable?: number;
  /** Its last message kept, for the list (`lastOf`): which way, and the start of its text. */
  last?: { dir: "in" | "out"; text?: string };
  /** The user's own name for it, on this device only: never from a message, never sent (`rename`). */
  name?: string;
}

/** The longest name the user can give a conversation, in characters. */
export const NAME_CHARS = CONVERSATION_NAME_CHARS;

/** How much of a conversation's last message the inbox keeps for the list: its first characters. */
export const PREVIEW_CHARS = 120;

/** A conversation's own record, `conversation.<network>.<cid>`. */
export interface ConversationFile {
  v: 1;
  /** The crate's record, hex (protocol.md §16.5): the ratchet, with its secrets. */
  state: string;
  /** What the first-contact stamp is over, until it's set: the stamp is still being solved. */
  stampDigest?: string;
  /** The history, oldest first. */
  history: Entry[];
  /** The next entry's id. */
  next: number;
  /** Messages the budget has deleted, from the oldest. */
  trimmed: number;
}

/** One message of a conversation. */
export interface Entry {
  id: number;
  dir: "in" | "out";
  /** Received, or written (ms). */
  at: number;
  /** The text; absent for a kind this version can't show (`kind`). */
  text?: string;
  /** The plaintext's kind, when it isn't text. */
  kind?: number;
  /**
   * A sent message: `queued` until the first-contact stamp is set, then `pending` until the relay keeps it, then
   * `posted`; `refused`, bytes the relay will never take.
   */
  sent?: "queued" | "pending" | "posted" | "refused";
  /** A pending message's envelope, hex, dropped once it's posted. */
  envelope?: string;
  /** When the relay drops it (ms), once posted. */
  expires?: number;
}

export interface MessagingDeps {
  wasm: typeof Wasm;
  wallet: Wallet;
  store: PrivateStore;
  /** chrome.storage.local: where the orphan sweep finds conversation records nothing lists. */
  local: Area;
  preferences: Pick<PreferencesService, "get" | "set">;
  /** `seedelf.messaging`'s alarm, every minute while a switch is on and the wallet unlocked (sw.ts). */
  alarm?: { start(): Promise<void>; stop(): Promise<void> };
  /** Each network's relay (relay.ts). */
  relay: (network: NetworkName) => RelayClient;
  /**
   * The wallet's own Seedelfs on `network`, each with its register now. `read`: the contract read now, what's new in
   * it, which throws if it can't be; otherwise only the view the last reading kept, with no request (none, an empty
   * list).
   */
  ownSeedelfs: (network: NetworkName, read: boolean) => Promise<Array<{ name: string; register: RegisterHex }>>;
  /** The register of the Seedelf `name` (asset name, hex) on `network`, as Send's pay-by-name finds it. */
  seedelfRegister: (network: NetworkName, name: string) => Promise<RegisterHex>;
  now: () => number;
  /** A turn of the event loop between slices of work. */
  wait?: (ms: number) => Promise<void>;
  /** A call to a Chrome API now and then while a stamp is solved, so Chrome doesn't stop the worker partway. */
  keepAlive?: () => Promise<void>;
  /** Tells open pages a network's messages changed. */
  changed?: (network: NetworkName) => void;
  /**
   * The first-contact stamp's work, solved and asked, for tests only: the worker never sets it, and the protocol's 24
   * bits (`messagingConstants`) hold. A reader asking less takes cheaper first messages from strangers.
   */
  firstContactBits?: number;
  /** The history's budget, for tests: HISTORY_BUDGET_BYTES otherwise. */
  budgetBytes?: number;
}

/** A refusal the crate gives, as its code (54d). */
interface Refused {
  refused: string;
}
const isRefused = (answer: unknown): answer is Refused =>
  typeof answer === "object" && answer !== null && typeof (answer as Refused).refused === "string";

/** The message a refusal is said with, when a request of the user's is refused. */
export class MessagingRefused extends Error {
  constructor(readonly code: string) {
    super(t("worker.messaging.refused", { code }));
  }
}

const hexOf = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const bytesOf = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));

/** A text as the plaintext it's sent as: its kind, then its UTF-8. */
export function plaintextOf(text: string): string {
  const body = new TextEncoder().encode(text);
  const out = new Uint8Array(body.length + 1);
  out[0] = KIND_TEXT;
  out.set(body, 1);
  return hexOf(out);
}

/** A plaintext's text, or its kind when this version can't show it. */
export function textOf(plaintext: string): Pick<Entry, "text" | "kind"> {
  const bytes = bytesOf(plaintext);
  if (bytes[0] !== KIND_TEXT) return { kind: bytes[0] ?? 0 };
  return { text: new TextDecoder().decode(bytes.subarray(1)) };
}

/** A string's UTF-8 length: what the private store pads and seals, not its UTF-16 length. */
const utf8Length = (text: string) => new TextEncoder().encode(text).length;

/** What a record of `jsonLength` UTF-8 bytes takes of the extension's storage: sealed, padded, base64 (private-store.ts). */
export function storedBytes(jsonLength: number): number {
  let size = 1024;
  while (size < jsonLength) size *= 2;
  return Math.ceil(((size + 16) * 4) / 3);
}

const emptyInbox = (): Inbox => ({ v: 1, handles: {}, conversations: {}, requestsUnread: {}, lost: {} });

export class MessagingService {
  /** Every state change, one at a time (protocol.md §4.2). */
  private queue: Promise<unknown> = Promise.resolve();
  /** The sync running on each network, if one is, and whether another is asked for after it. */
  private syncs = new Map<NetworkName, { running: Promise<void>; again: boolean }>();
  /** The posting running on each network. */
  private posting = new Map<NetworkName, { running: Promise<void>; again: boolean }>();
  /** First-contact stamps being solved, by record name. */
  private solving = new Set<string>();
  /** The prices the last page said, by network: 512, 2,048, 8,192 and 32,768 bytes. */
  private prices = new Map<NetworkName, number[]>();
  /** No post before this (ms), by network: the relay asked the wallet to wait. */
  private postAfter = new Map<NetworkName, number>();
  /** The networks whose contract a sync has read fresh for a stranger's first message (`receive`): once a sync. */
  private freshRead = new Set<NetworkName>();
  /** The networks swept, each with the unlock it was swept in (`sweep`). */
  private swept = new Set<string>();
  /** The networks whose relay didn't answer their last read: the screens say messages wait (`overview`). */
  private offline = new Set<NetworkName>();
  private constants?: { firstContactStampBits: number; envelopeSizes: number[] };
  /** Switches, one at a time: a preference's write reads the others first (preferences.ts `set`). */
  private switching: Promise<unknown> = Promise.resolve();
  /** What runs in the background: stamps being solved, posts. */
  private background = new Set<Promise<unknown>>();

  constructor(private readonly deps: MessagingDeps) {}

  // -------------------------------------------------------------------------
  // What the screens ask
  // -------------------------------------------------------------------------

  /** Whether Messages is on for `network`. No key needed. */
  async isOn(network: NetworkName): Promise<boolean> {
    return (await this.deps.preferences.get()).messaging[network];
  }

  /**
   * Turns `network`'s Messages switch on or off (call 9). On, its pool is read at once and every minute while
   * unlocked; off, nothing more reaches the relay, and what the wallet holds stays.
   */
  async switch(network: NetworkName, on: boolean): Promise<void> {
    // This network's switch alone, one switch at a time: the other is kept as it is when written.
    const write = this.switching.then(() => this.deps.preferences.set({ messaging: { [network]: on } as never }));
    this.switching = write.catch(() => undefined);
    const switches = (await write).messaging;
    // Whatever the relay did before the switch, the next read says again.
    this.offline.delete(network);
    if (on) {
      await this.deps.alarm?.start();
      this.behind(this.sync(network));
    } else if (!Object.values(switches).some(Boolean)) {
      await this.deps.alarm?.stop();
    }
    this.deps.changed?.(network);
  }

  /** The conversations and requests on `network`, newest first. Throws if locked. */
  async overview(network: NetworkName): Promise<MessagingOverview> {
    const [on, inbox] = await Promise.all([this.isOn(network), this.inbox(network)]);
    const requests = inbox.requests ? this.requestsInfo(inbox.requests) : [];
    const now = this.deps.now();
    const conversations: MessagingConversation[] = Object.entries(inbox.conversations)
      .map(([cid, meta]) => this.summary(cid, meta, now))
      .sort((a, b) => b.lastAt - a.lastAt);
    return {
      on,
      conversations,
      requests: requests
        .map(
          (r): MessagingRequest => ({
            cid: r.cid,
            startedAt: r.t * 1000,
            to: r.to,
            ...(r.continues ? { continues: r.continues } : {}),
            messages: r.arrivals.length,
            lastAt: (r.arrivals.at(-1) ?? r.t) * 1000,
            unread: inbox.requestsUnread[r.cid] ?? 0,
          }),
        )
        .sort((a, b) => b.lastAt - a.lastAt),
      lost: Object.entries(inbox.lost)
        .filter(([, l]) => now - l.at <= LOST_FOR_MS)
        .map(([cid, l]) => ({ cid, lastAt: l.at, messages: l.count })),
      ...(inbox.gapAt !== undefined ? { gapAt: inbox.gapAt } : {}),
      ...(on && this.offline.has(network) ? { offline: true as const } : {}),
    };
  }

  /** A conversation's messages, which are then read. Throws if locked. */
  thread(network: NetworkName, cid: string): Promise<MessagingThread> {
    return this.serial(async () => {
      const inbox = await this.inbox(network);
      const meta = inbox.conversations[cid];
      if (!meta) throw new Error(t("worker.messaging.noConversation"));
      const file = await this.file(network, cid);
      if (!file) throw new Error(t("worker.messaging.noConversation"));
      const info = this.info(file.state);
      if (meta.unread) {
        meta.unread = 0;
        await this.writeInbox(network, inbox);
        // Read now: the top bar's count and Home's row change with it. Only then, so a page that reads the thread
        // again when told isn't told again.
        this.deps.changed?.(network);
      }
      return {
        conversation: this.summary(cid, meta, this.deps.now()),
        messages: file.history.map(entryView),
        trimmed: file.trimmed,
        missing: info.missing,
        maxTextBytes: Math.max(0, info.maxTextLen - 1),
      };
    });
  }

  /** A request's messages, decrypted to show them; nothing changes but that they're read. Throws if locked. */
  request(network: NetworkName, cid: string): Promise<MessagingEntry[]> {
    return this.serial(async () => {
      const inbox = await this.inbox(network);
      if (!inbox.requests) throw new Error(t("worker.messaging.noRequest"));
      const requests = inbox.requests;
      const read = await this.withKey((key) =>
        this.parse<{ messages: Array<{ at: number; plaintext?: string; refused?: string }> }>(
          this.deps.wasm.messagingReadRequest(key, JSON.stringify({ requests, cid })),
        ),
      );
      if (isRefused(read)) throw new Error(t("worker.messaging.noRequest"));
      if (inbox.requestsUnread[cid]) {
        delete inbox.requestsUnread[cid];
        await this.writeInbox(network, inbox);
        this.deps.changed?.(network);
      }
      return read.messages.map((m, i) =>
        entryView({ id: i, dir: "in", at: m.at * 1000, ...(m.plaintext !== undefined ? textOf(m.plaintext) : { kind: -1 }) }),
      );
    });
  }

  /**
   * Starts a conversation with the owner of the Seedelf `name` (asset name, hex), its first message `text`. The
   * first-contact stamp is then solved, about 7 s, and the message sealed and posted. Returns its cid.
   */
  async start(network: NetworkName, name: string, text: string, replacing?: string): Promise<string> {
    this.checkText(text);
    const register = await this.deps.seedelfRegister(network, name);
    const cid = await this.serial(async () => {
      const pin = phrasePin();
      const now = this.deps.now();
      const started = await this.withKey((key, keys) => {
        pin(keys);
        return this.parse<{ cid: string; conversation: string; digest: string }>(
          this.deps.wasm.messagingStart(key, JSON.stringify({ handle: register, to: name, now: Math.floor(now / 1000) })),
        );
      });
      if (isRefused(started)) {
        if (started.refused === "own_register") throw new Error(t("worker.messaging.ownSeedelf"));
        throw new MessagingRefused(started.refused);
      }
      this.checkLength(started.conversation, text);
      const file: ConversationFile = {
        v: 1,
        state: started.conversation,
        stampDigest: started.digest,
        history: [{ id: 0, dir: "out", at: now, text, sent: "queued" }],
        next: 1,
        trimmed: 0,
      };
      const inbox = await this.inbox(network);
      const bytes = await this.writeFile(network, started.cid, file);
      inbox.conversations[started.cid] = {
        role: "initiator",
        handle: name,
        startedAt: now,
        lastAt: now,
        unread: 0,
        outbox: 1,
        bytes,
        oldestAt: now,
        last: lastOf(file.history),
        // Started again to the same Seedelf: the user's name for it goes on.
        ...(replacing && inbox.conversations[replacing]?.name ? { name: inbox.conversations[replacing]!.name } : {}),
      };
      if (replacing && inbox.conversations[replacing]) inbox.conversations[replacing]!.restartedAs = started.cid;
      await this.writeInbox(network, inbox);
      return started.cid;
    });
    this.deps.changed?.(network);
    this.behind(this.stamp(network, cid));
    return cid;
  }

  /**
   * Starts a conversation again, to the same Seedelf, its first message `text`: for one whose first messages may
   * never be read (no reply after 48 hours, protocol.md §16.4). A new conversation; the old one says it was started
   * again as this one. Returns its cid.
   */
  async restart(network: NetworkName, cid: string, text: string): Promise<string> {
    const inbox = await this.inbox(network);
    const meta = inbox.conversations[cid];
    if (!meta?.handle) throw new Error(t("worker.messaging.cantRestart"));
    return this.start(network, meta.handle, text, cid);
  }

  /**
   * Continues a conversation in a new one, with its identities (protocol.md §6): for one that can't continue, when the
   * other side still has it. The reader shows it as continuing the old one. Returns its cid.
   */
  async continueIn(network: NetworkName, cid: string, text: string): Promise<string> {
    this.checkText(text);
    const next = await this.serial(async () => {
      const pin = phrasePin();
      const inbox = await this.inbox(network);
      const meta = inbox.conversations[cid];
      const old = meta && (await this.file(network, cid));
      if (!meta || !old) throw new Error(t("worker.messaging.noConversation"));
      const now = this.deps.now();
      const started = await this.withKey((key, keys) => {
        pin(keys);
        return this.parse<{ cid: string; conversation: string; digest: string }>(
          this.deps.wasm.messagingStartContinuing(key, JSON.stringify({ conversation: old.state, now: Math.floor(now / 1000) })),
        );
      });
      if (isRefused(started)) throw new MessagingRefused(started.refused);
      this.checkLength(started.conversation, text);
      const file: ConversationFile = {
        v: 1,
        state: started.conversation,
        stampDigest: started.digest,
        history: [{ id: 0, dir: "out", at: now, text, sent: "queued" }],
        next: 1,
        trimmed: 0,
      };
      const bytes = await this.writeFile(network, started.cid, file);
      inbox.conversations[started.cid] = {
        role: "initiator",
        ...(meta.handle ? { handle: meta.handle } : {}),
        ...(meta.to ? { to: meta.to } : {}),
        continues: { cid, verified: true },
        startedAt: now,
        lastAt: now,
        unread: 0,
        outbox: 1,
        bytes,
        oldestAt: now,
        last: lastOf(file.history),
        ...(meta.name ? { name: meta.name } : {}),
      };
      meta.restartedAs = started.cid;
      await this.writeInbox(network, inbox);
      return started.cid;
    });
    this.deps.changed?.(network);
    this.behind(this.stamp(network, next));
    return next;
  }

  /** Sends `text` in conversation `cid`: sealed now, posted at once. Throws if locked. */
  async send(network: NetworkName, cid: string, text: string): Promise<void> {
    this.checkText(text);
    await this.serial(async () => {
      const inbox = await this.inbox(network);
      const meta = inbox.conversations[cid];
      const file = meta && (await this.file(network, cid));
      if (!meta || !file) throw new Error(t("worker.messaging.noConversation"));
      this.checkLength(file.state, text);
      const now = this.deps.now();
      const entry: Entry = { id: file.next++, dir: "out", at: now, text, sent: "queued" };
      file.history.push(entry);
      // Before its stamp, a first-contact message waits: it's sealed with the others once the stamp is set.
      if (!file.stampDigest) this.seal(file, entry);
      meta.lastAt = now;
      await this.commit(network, inbox, cid, file);
    });
    this.deps.changed?.(network);
    this.behind(this.post(network));
  }

  /** Accepts a request: its conversation, with its messages, which the reply is then sent in. Throws if locked. */
  accept(network: NetworkName, cid: string): Promise<void> {
    return this.serial(async () => {
      const pin = phrasePin();
      const inbox = await this.inbox(network);
      const requests = inbox.requests;
      if (!requests) throw new Error(t("worker.messaging.noRequest"));
      const info = this.requestsInfo(requests).find((r) => r.cid === cid);
      if (!info) throw new Error(t("worker.messaging.noRequest"));
      const asked = JSON.stringify({ requests, cid });
      const [read, accepted] = await this.withKey((key, keys) => {
        pin(keys);
        return [
          this.parse<{ messages: Array<{ at: number; plaintext?: string }> }>(this.deps.wasm.messagingReadRequest(key, asked)),
          this.parse<{ conversation: string; requests: string; continues: { cid: string; verified: boolean } | null }>(
            this.deps.wasm.messagingAccept(key, asked),
          ),
        ] as const;
      });
      if (isRefused(accepted)) throw new MessagingRefused(accepted.refused);
      // Each message as it arrived; one that doesn't read now was refused when it came too, and isn't kept.
      const history: Entry[] = isRefused(read)
        ? []
        : read.messages.flatMap((m, i) => (m.plaintext === undefined ? [] : [{ id: i, dir: "in" as const, at: m.at * 1000, ...textOf(m.plaintext) }]));
      const next = isRefused(read) ? 0 : read.messages.length;
      const file: ConversationFile = { v: 1, state: accepted.conversation, history, next, trimmed: 0 };
      const bytes = await this.writeFile(network, cid, file);
      const now = this.deps.now();
      inbox.requests = accepted.requests;
      delete inbox.requestsUnread[cid];
      inbox.conversations[cid] = {
        role: "responder",
        ...(info.to ? { to: info.to } : {}),
        ...(accepted.continues ? { continues: accepted.continues } : {}),
        startedAt: info.t * 1000,
        lastAt: history.at(-1)?.at ?? now,
        unread: 0,
        outbox: 0,
        bytes,
        oldestAt: history[0]?.at ?? now,
        ...(history.length ? { last: lastOf(history) } : {}),
        // Continuing one this wallet holds, with the same keys (§6): the same other side, so the user's name for it
        // goes on. A continuation only claimed takes none.
        ...(accepted.continues?.verified && inbox.conversations[accepted.continues.cid]?.name
          ? { name: inbox.conversations[accepted.continues.cid]!.name }
          : {}),
      };
      await this.writeInbox(network, inbox);
      this.deps.changed?.(network);
    });
  }

  /**
   * Names a conversation as the user chooses, or takes its name away (empty): on this device only, never sent, and
   * shown as the user's, beside protocol.md §7's label, never in its place. Throws if locked.
   */
  rename(network: NetworkName, cid: string, name: string): Promise<void> {
    const named = typeof name === "string" ? name.trim() : "";
    if ([...named].length > NAME_CHARS) return Promise.reject(new Error(t("worker.messaging.nameTooLong", { max: NAME_CHARS })));
    return this.serial(async () => {
      const inbox = await this.inbox(network);
      const meta = inbox.conversations[cid];
      if (!meta) throw new Error(t("worker.messaging.noConversation"));
      if (named) meta.name = named;
      else delete meta.name;
      await this.writeInbox(network, inbox);
      this.deps.changed?.(network);
    });
  }

  /** Deletes a conversation or a request: its ID is kept as a tombstone until its `t` + 48 hours. Throws if locked. */
  remove(network: NetworkName, cid: string): Promise<void> {
    return this.serial(async () => {
      const inbox = await this.inbox(network);
      // A record that won't open is deleted all the same, with no tombstone: its F, and so its t, can't be read.
      const file = inbox.conversations[cid] ? await this.readable(network, cid) : undefined;
      const deleted = this.read<{ deleted: boolean; requests: string; tombstones: string }>(
        this.wasmCall(() =>
          this.deps.wasm.messagingDelete(
            JSON.stringify({
              cid,
              ...(file ? { conversation: file.state } : {}),
              ...(inbox.requests ? { requests: inbox.requests } : {}),
              ...(inbox.tombstones ? { tombstones: inbox.tombstones } : {}),
            }),
          ),
        ),
      );
      inbox.requests = deleted.requests;
      inbox.tombstones = deleted.tombstones;
      delete inbox.conversations[cid];
      delete inbox.requestsUnread[cid];
      for (const meta of Object.values(inbox.conversations)) if (meta.restartedAs === cid) delete meta.restartedAs;
      await this.writeInbox(network, inbox);
      await this.deps.store.remove(conversationRecord(network, cid));
      this.deps.changed?.(network);
    });
  }

  // -------------------------------------------------------------------------
  // Syncing
  // -------------------------------------------------------------------------

  /**
   * Reads `network`'s pool from the cursor, takes every envelope that's the key's, then posts what's waiting. One at
   * a time per network: asked during one, it runs once more after it. Nothing while the switch is off or the wallet
   * is locked. Returns whether it ran.
   */
  sync(network: NetworkName): Promise<void> {
    return this.once(this.syncs, network, () => this.syncNow(network));
  }

  /**
   * Syncs every network of `networks` whose switch is on: the alarm's run, and the unlock's. The alarm stops while
   * the wallet is locked or no switch is on, and the unlock starts it again.
   */
  async syncAll(networks: readonly NetworkName[]): Promise<void> {
    const switches = (await this.deps.preferences.get()).messaging;
    const on = networks.filter((n) => switches[n]);
    if (!on.length || (await this.deps.wallet.state()) !== "unlocked") {
      await this.deps.alarm?.stop();
      return;
    }
    await this.deps.alarm?.start();
    await Promise.all(on.map((n) => this.sync(n).catch(rethrowTrap)));
  }

  private async syncNow(network: NetworkName): Promise<void> {
    if (!(await this.isOn(network))) return;
    if ((await this.deps.wallet.state()) !== "unlocked") return;
    const pin = phrasePin();
    await this.sweep(network);
    // The registers the wallet's Seedelfs hold now, from the view it keeps, with no request: a Seedelf's datum can
    // change while a message to its old one is on its way.
    await this.serial(async () => {
      const kept = await this.inbox(network);
      if (this.noteHandles(kept, await this.deps.ownSeedelfs(network, false))) await this.writeInbox(network, kept);
    });
    const relay = this.deps.relay(network);
    this.freshRead.delete(network);
    let inbox = await this.inbox(network);
    let cursor = inbox.cursor;
    let received = false;
    for (;;) {
      let page: RelayPage;
      try {
        // Asked again before each page: a switch turned off, or a lock, mid-catch-up stops it there.
        page = await relay.page(cursor, () => this.mayAsk(network));
      } catch (e) {
        // A relay that didn't answer, not one the wallet chose not to ask: the screens say messages wait.
        if (e instanceof RelayDown && !(e instanceof RelayNotAsked) && !this.offline.has(network)) {
          this.offline.add(network);
          this.deps.changed?.(network);
        }
        if (e instanceof RelayDown) break;
        throw e;
      }
      // Answering again: said at once, not at the sync's end, which a later failure could keep from coming.
      if (this.offline.delete(network)) this.deps.changed?.(network);
      this.prices.set(network, page.prices);
      for (let at = 0; at < page.envelopes.length; at += SCAN_BATCH) {
        const batch = page.envelopes.slice(at, at + SCAN_BATCH);
        const found = await this.withKey((key, keys) => {
          pin(keys);
          return JSON.parse(this.deps.wasm.messagingScan(key, JSON.stringify(batch))) as number[];
        });
        for (const i of found) if (await this.receive(network, batch[i]!, pin)) received = true;
        await this.wait();
      }
      // The page is done: the cursor moves past it, and a gap is noted.
      const next = page.cursor;
      const gap = page.gap && cursor !== undefined;
      // A page that says more follows but moved nothing is a relay that isn't §17's: the loop stops there.
      const stuck = next === cursor && !page.envelopes.length;
      await this.serial(async () => {
        // The phrase the sync began under: one removed and another restored meanwhile gets no cursor of the first's.
        await this.withKey((_key, keys) => pin(keys));
        inbox = await this.inbox(network);
        inbox.cursor = next;
        if (gap) inbox.gapAt = this.deps.now();
        await this.writeInbox(network, inbox);
      });
      cursor = next;
      if (gap) received = true;
      if (!page.more || stuck) break;
    }
    if (received) this.deps.changed?.(network);
    await this.expire(network);
    this.resumeStamps(network, inbox);
    await this.post(network);
  }

  /**
   * Takes one envelope that's the key's, in the queue: a message of a held conversation, a request started or
   * joined, or nothing (a duplicate, a deleted conversation's, a stranger's without its work or proof, a forgery).
   * Returns whether anything arrived.
   */
  private receive(network: NetworkName, envelope: string, pin: PhrasePin): Promise<boolean> {
    return this.serial(async () => {
      const opened = await this.withKey((key, keys) => {
        pin(keys);
        return this.parse<{ cid: string; kind: string; to: string | null; replaces: string | null }>(
          this.deps.wasm.messagingOpen(key, envelope),
        );
      });
      if (isRefused(opened)) return false;
      const inbox = await this.inbox(network);
      const files = new Map<string, ConversationFile>();
      for (const cid of [opened.cid, opened.replaces]) {
        if (!cid || !inbox.conversations[cid]) continue;
        // A record that won't open is left as it is, and its messages refused: it never holds up the rest.
        const file = await this.readable(network, cid);
        if (file) files.set(cid, file);
      }
      // The wallet's Seedelfs, only for a stranger's first message to one: nothing else needs them.
      const held =
        inbox.conversations[opened.cid] !== undefined ||
        (inbox.requests !== undefined && this.requestsInfo(inbox.requests).some((r) => r.cid === opened.cid));
      const stranger = opened.kind === "first-contact" && !held && !!opened.to;
      let noted = false;
      const take = () => {
        const request = JSON.stringify({
          envelope,
          now: Math.floor(this.deps.now() / 1000),
          handles: stranger ? Object.entries(inbox.handles).map(([name, registers]) => ({ name, registers })) : [],
          conversations: [...files.values()].map((f) => f.state),
          ...(inbox.requests ? { requests: inbox.requests } : {}),
          ...(inbox.tombstones ? { tombstones: inbox.tombstones } : {}),
          ...(this.deps.firstContactBits !== undefined ? { firstContactBits: this.deps.firstContactBits } : {}),
        });
        return this.withKey((key, keys) => {
          pin(keys);
          return this.parse<
            | {
                received: { kind: "message"; cid: string; plaintext: string };
                conversation: string;
              }
            | {
                received: { kind: "request"; cid: string; plaintext: string; new: boolean; evicted: string[] };
                requests: string;
              }
          >(this.deps.wasm.messagingReceive(key, request));
        });
      };
      let result = await take();
      // A stranger's first message to a Seedelf the kept view doesn't have, or to a register it doesn't know the
      // Seedelf holds now: refused now, it would be lost for good. The contract is read fresh, once a sync, and the
      // message taken again; a read that fails throws, so the cursor holds and the next sync tries again.
      if (
        stranger &&
        isRefused(result) &&
        (result.refused === "unknown_handle" || result.refused === "invalid_base_proof") &&
        !this.freshRead.has(network)
      ) {
        this.freshRead.add(network);
        if (this.noteHandles(inbox, await this.deps.ownSeedelfs(network, true))) {
          noted = true;
          result = await take();
        }
      }
      const now = this.deps.now();
      if (isRefused(result)) {
        // A session message of a conversation this browser doesn't have: named, so the screens can say so (§6).
        const lost = opened.kind === "session" && result.refused === "unknown_conversation";
        // One the ratchet can't reach: the conversation may not continue (§6).
        const unreachable = result.refused === "too_far_ahead" ? inbox.conversations[opened.cid] : undefined;
        if (lost) this.noteLost(inbox, opened.cid, now);
        if (unreachable) unreachable.unreachable = (unreachable.unreachable ?? 0) + 1;
        // The registers read now are kept for the next, as is what was noted.
        if (noted || lost || unreachable) await this.writeInbox(network, inbox);
        // Both change what the screens show: a conversation this browser no longer has, one that may not continue.
        return lost || unreachable !== undefined;
      }
      if ("conversation" in result) {
        const cid = result.received.cid;
        const meta = inbox.conversations[cid];
        const file = files.get(cid);
        if (!meta || !file) return false;
        file.state = result.conversation;
        file.history.push({ id: file.next++, dir: "in", at: now, ...textOf(result.received.plaintext) });
        // Only the other side's reply decrypts in a conversation this wallet started: it's answered.
        meta.answered = true;
        meta.unread++;
        meta.lastAt = now;
        await this.commit(network, inbox, cid, file);
      } else {
        const cid = result.received.cid;
        inbox.requests = result.requests;
        inbox.requestsUnread[cid] = (inbox.requestsUnread[cid] ?? 0) + 1;
        for (const gone of result.received.evicted) delete inbox.requestsUnread[gone];
        await this.writeInbox(network, inbox);
      }
      return true;
    });
  }

  /**
   * Keeps every register of `own` the inbox doesn't hold yet, so a message written to a Seedelf's old datum still
   * opens; returns whether there was one.
   */
  private noteHandles(inbox: Inbox, own: Array<{ name: string; register: RegisterHex }>): boolean {
    let added = false;
    for (const { name, register } of own) {
      const kept = (inbox.handles[name] ??= []);
      if (kept.some((r) => r.generator === register.generator && r.publicValue === register.publicValue)) continue;
      kept.push(register);
      added = true;
    }
    return added;
  }

  /** Notes a session message for `cid`, a conversation this browser doesn't have, keeping the newest LOST_KEPT. */
  private noteLost(inbox: Inbox, cid: string, now: number): void {
    const was = inbox.lost[cid];
    inbox.lost[cid] = { at: now, count: (was?.count ?? 0) + 1 };
    const kept = Object.entries(inbox.lost)
      .filter(([, l]) => now - l.at <= LOST_FOR_MS)
      .sort(([, a], [, b]) => b.at - a.at)
      .slice(0, LOST_KEPT);
    inbox.lost = Object.fromEntries(kept);
  }

  /** Expires skipped keys and tombstones past their 48 hours, at most hourly. */
  private expire(network: NetworkName): Promise<void> {
    return this.serial(async () => {
      const inbox = await this.inbox(network);
      const now = this.deps.now();
      if (inbox.expiredAt !== undefined && now - inbox.expiredAt < EXPIRE_EVERY_MS) return;
      const secs = Math.floor(now / 1000);
      for (const cid of Object.keys(inbox.conversations)) {
        const file = await this.readable(network, cid);
        if (!file) continue;
        const expired = this.read<{ conversation: string }>(
          this.wasmCall(() => this.deps.wasm.messagingExpire(JSON.stringify({ now: secs, conversation: file.state }))),
        );
        if (expired.conversation !== file.state) {
          file.state = expired.conversation;
          await this.writeFile(network, cid, file);
        }
      }
      if (inbox.tombstones) {
        const tombstones = inbox.tombstones;
        inbox.tombstones = this.read<{ tombstones: string }>(
          this.wasmCall(() => this.deps.wasm.messagingExpire(JSON.stringify({ now: secs, tombstones }))),
        ).tombstones;
      }
      inbox.expiredAt = now;
      await this.writeInbox(network, inbox);
    });
  }

  /**
   * At a network's first sync of each unlock, and so of each worker's life: deletes conversation records the inbox
   * doesn't list (a stop between writing one and listing it, or between unlisting one and deleting it), and brings
   * what the inbox shows of each conversation back to its record (a stop or a lock between a record's write and the
   * inbox's, which would leave a pending message unposted, its outbox uncounted).
   */
  private async sweep(network: NetworkName): Promise<void> {
    const mark = `${network}:${await this.deps.wallet.unlockedAt().catch(() => 0)}`;
    if (this.swept.has(mark)) return;
    await this.serial(async () => {
      const inbox = await this.inbox(network);
      const prefix = PRIVATE_PREFIX + CONVERSATION_RECORDS + network + ".";
      for (const key of await this.deps.local.keys(prefix)) {
        const cid = key.slice(prefix.length);
        if (!inbox.conversations[cid]) await this.deps.store.remove(conversationRecord(network, cid));
      }
      let repaired = false;
      for (const [cid, meta] of Object.entries(inbox.conversations)) {
        let file: ConversationFile | undefined;
        try {
          file = await this.file(network, cid);
        } catch (e) {
          // One that won't open stays listed, as it is: what it holds may still come back.
          if (e instanceof UnreadableRecordError) continue;
          throw e;
        }
        if (!file) {
          delete inbox.conversations[cid];
          repaired = true;
          continue;
        }
        const now = measure(file, meta.lastAt);
        if (
          now.bytes !== meta.bytes ||
          now.outbox !== meta.outbox ||
          now.oldestAt !== meta.oldestAt ||
          now.last?.dir !== meta.last?.dir ||
          now.last?.text !== meta.last?.text
        ) {
          Object.assign(meta, now);
          repaired = true;
        }
      }
      if (repaired) await this.writeInbox(network, inbox);
    });
    this.swept.add(mark);
  }

  // -------------------------------------------------------------------------
  // Stamps and posting
  // -------------------------------------------------------------------------

  /** Solves the first-contact stamp of every conversation still waiting for one, each in the background. */
  private resumeStamps(network: NetworkName, inbox: Inbox): void {
    for (const [cid, meta] of Object.entries(inbox.conversations)) {
      if (meta.role === "initiator" && meta.outbox > 0) this.behind(this.stamp(network, cid));
    }
  }

  /**
   * Solves conversation `cid`'s first-contact stamp, about 7 s, in slices out of the queue, then sets it and seals
   * every text waiting for it, in the queue. Nothing secret is held outside a record meanwhile (54a′).
   */
  private async stamp(network: NetworkName, cid: string): Promise<void> {
    const name = conversationRecord(network, cid);
    if (this.solving.has(name)) return;
    this.solving.add(name);
    try {
      const file = await this.readable(network, cid);
      if (!file?.stampDigest) return;
      const nonce = await this.solve(file.stampDigest, this.deps.firstContactBits ?? this.constantsOf().firstContactStampBits);
      await this.serial(async () => {
        const inbox = await this.inbox(network);
        const kept = inbox.conversations[cid] && (await this.readable(network, cid));
        if (!kept?.stampDigest) return;
        const stamped = this.parse<{ conversation: string; bits: number }>(
          this.wasmCall(() => this.deps.wasm.messagingSetStamp(JSON.stringify({ conversation: kept.state, nonce }))),
        );
        if (isRefused(stamped)) throw new MessagingRefused(stamped.refused);
        kept.state = stamped.conversation;
        delete kept.stampDigest;
        for (const entry of kept.history) if (entry.sent === "queued") this.seal(kept, entry);
        await this.commit(network, inbox, cid, kept);
      });
      this.deps.changed?.(network);
      await this.post(network);
    } finally {
      this.solving.delete(name);
    }
  }

  /** Seals a queued text in its envelope, the ratchet stepping in `file`: pending, to be posted. */
  private seal(file: ConversationFile, entry: Entry): void {
    const sent = this.parse<{ conversation: string; envelope: string }>(
      this.wasmCall(() =>
        this.deps.wasm.messagingSend(JSON.stringify({ conversation: file.state, plaintext: plaintextOf(entry.text ?? "") })),
      ),
    );
    if (isRefused(sent)) {
      entry.sent = "refused";
      return;
    }
    file.state = sent.conversation;
    entry.sent = "pending";
    entry.envelope = sent.envelope;
  }

  /** Posts every pending envelope on `network`, one at a time per network. */
  post(network: NetworkName): Promise<void> {
    return this.once(this.posting, network, () => this.postNow(network));
  }

  private async postNow(network: NetworkName): Promise<void> {
    if (!(await this.isOn(network))) return;
    if ((this.postAfter.get(network) ?? 0) > this.deps.now()) return;
    const inbox = await this.inbox(network).catch((e: unknown) => {
      if (e instanceof WalletLocked) return undefined;
      throw e;
    });
    if (!inbox) return;
    const relay = this.deps.relay(network);
    const pool = NETWORKS[network].relay.pool;
    for (const [cid, meta] of Object.entries(inbox.conversations)) {
      if (!meta.outbox) continue;
      const file = await this.readable(network, cid);
      for (const entry of file?.history ?? []) {
        if (entry.sent !== "pending" || !entry.envelope) continue;
        // Deleted meanwhile: nothing of it is posted.
        if (!(await this.inbox(network)).conversations[cid]) break;
        const answer = await this.postOne(relay, network, pool, entry.envelope);
        if (!answer) return;
        if (answer.kind === "wait") {
          this.postAfter.set(network, this.deps.now() + answer.retryAfterMs);
          return;
        }
        await this.serial(async () => {
          const now = await this.inbox(network);
          const kept = now.conversations[cid] && (await this.readable(network, cid));
          const at = kept?.history.find((e) => e.id === entry.id);
          if (!kept || !at || at.sent !== "pending") return;
          if (answer.kind === "kept") {
            at.sent = "posted";
            at.expires = answer.expires;
          } else {
            at.sent = "refused";
          }
          delete at.envelope;
          await this.commit(network, now, cid, kept);
        });
        this.deps.changed?.(network);
      }
    }
  }

  /**
   * Posts one envelope: solved at the price the last page named for its size (the pool's base before any page),
   * again at the price a 402 names, for the same bytes. Undefined when the relay didn't answer.
   */
  private async postOne(
    relay: RelayClient,
    network: NetworkName,
    pool: string,
    envelope: string,
  ): Promise<Exclude<PostAnswer, { kind: "price" }> | undefined> {
    const size = envelope.length / 2;
    const index = this.constantsOf().envelopeSizes.indexOf(size);
    let bits = this.prices.get(network)?.[index] ?? RELAY_BASE_BITS[network];
    // 0: the relay would refuse this address's post now (§17.5): it waits for the next sync's page.
    if (bits === 0) return { kind: "wait", retryAfterMs: 60_000 };
    const digest = this.wasmCall(() => this.deps.wasm.messagingRelayDigest(pool, envelope));
    for (let tries = 0; tries < 4; tries++) {
      const nonce = await this.solve(digest, bits);
      const body = this.wasmCall(() => this.deps.wasm.messagingPostBody(JSON.stringify({ nonce, envelope })));
      let answer: PostAnswer;
      try {
        // Asked again right before it goes: a switch turned off, or a lock, while it was solved stops it.
        answer = await relay.post(body, () => this.mayAsk(network));
      } catch (e) {
        if (e instanceof RelayDown) return undefined;
        throw e;
      }
      if (answer.kind !== "price") return answer;
      bits = answer.bits;
    }
    return undefined;
  }

  /** A nonce whose work over `digest` is at least `bits`, found in slices with a turn of the event loop between. */
  private async solve(digest: string, bits: number): Promise<number> {
    let lastKept = this.deps.now();
    for (let from = 0; ; from += STAMP_SLICE) {
      const found = this.parse<{ nonce: number | null }>(
        this.wasmCall(() => this.deps.wasm.messagingFindStamp(JSON.stringify({ digest, bits, from, attempts: STAMP_SLICE }))),
      );
      if (isRefused(found)) throw new MessagingRefused(found.refused);
      if (found.nonce !== null) return found.nonce;
      await this.wait();
      if (this.deps.keepAlive && this.deps.now() - lastKept > 10_000) {
        lastKept = this.deps.now();
        await this.deps.keepAlive().catch(() => undefined);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Records
  // -------------------------------------------------------------------------

  private async inbox(network: NetworkName): Promise<Inbox> {
    const kept = await this.deps.store.get<Inbox>(`messaging.${network}`);
    return kept ? { ...emptyInbox(), ...kept } : emptyInbox();
  }

  private writeInbox(network: NetworkName, inbox: Inbox): Promise<void> {
    return this.deps.store.set(`messaging.${network}`, inbox);
  }

  private file(network: NetworkName, cid: string): Promise<ConversationFile | undefined> {
    return this.deps.store.get<ConversationFile>(conversationRecord(network, cid));
  }

  /** A conversation's record, or undefined when there's none or it won't open: for what runs by itself. */
  private async readable(network: NetworkName, cid: string): Promise<ConversationFile | undefined> {
    try {
      return await this.file(network, cid);
    } catch (e) {
      if (e instanceof UnreadableRecordError) return undefined;
      throw e;
    }
  }

  /** Whether `network`'s relay may be asked now: its switch on, and the wallet unlocked. */
  private async mayAsk(network: NetworkName): Promise<boolean> {
    return (await this.isOn(network)) && (await this.deps.wallet.state()) === "unlocked";
  }

  /** Writes a conversation's record; returns what it takes of the extension's storage. */
  private async writeFile(network: NetworkName, cid: string, file: ConversationFile): Promise<number> {
    await this.deps.store.set(conversationRecord(network, cid), file);
    return storedBytes(utf8Length(JSON.stringify(file)));
  }

  /** Writes a conversation's record, then the inbox with what it shows of it; then holds the history to its budget. */
  private async commit(network: NetworkName, inbox: Inbox, cid: string, file: ConversationFile): Promise<void> {
    const meta = inbox.conversations[cid]!;
    await this.writeFile(network, cid, file);
    Object.assign(meta, measure(file, meta.lastAt));
    await this.writeInbox(network, inbox);
    await this.budget(network, inbox);
  }

  /**
   * Holds every network's history to HISTORY_BUDGET_BYTES (call 10): past it, the oldest messages go first, from
   * whichever conversation holds the oldest, until it's under nine tenths of it. A message still to be posted stays.
   */
  private async budget(network: NetworkName, inbox: Inbox): Promise<void> {
    const inboxes = new Map<NetworkName, Inbox>([[network, inbox]]);
    for (const other of Object.keys(NETWORKS) as NetworkName[]) {
      if (other === network) continue;
      const kept = await this.deps.store.get<Inbox>(`messaging.${other}`).catch(() => undefined);
      if (kept) inboxes.set(other, { ...emptyInbox(), ...kept });
    }
    const total = () => [...inboxes.values()].reduce((sum, i) => sum + Object.values(i.conversations).reduce((s, m) => s + m.bytes, 0), 0);
    const budget = this.deps.budgetBytes ?? HISTORY_BUDGET_BYTES;
    if (total() <= budget) return;
    const target = budget * 0.9;
    // Conversations with nothing left to delete: passed over, never the end of it, or one emptied would stay the
    // oldest for good and the rest would never be trimmed.
    const spent = new Set<string>();
    while (total() > target) {
      let oldest: { network: NetworkName; cid: string; meta: Meta } | undefined;
      for (const [n, i] of inboxes) {
        for (const [cid, meta] of Object.entries(i.conversations)) {
          if (spent.has(`${n}.${cid}`)) continue;
          if (!oldest || meta.oldestAt < oldest.meta.oldestAt) oldest = { network: n, cid, meta };
        }
      }
      if (!oldest) return;
      const file = await this.readable(oldest.network, oldest.cid);
      if (!file) {
        spent.add(`${oldest.network}.${oldest.cid}`);
        continue;
      }
      const before = file.history.length;
      // Half the conversation's history at a time, oldest first: a record's size only moves by powers of two.
      let drop = Math.max(1, Math.ceil(file.history.length / 2));
      file.history = file.history.filter((e) => {
        if (drop > 0 && e.sent !== "queued" && e.sent !== "pending") {
          drop--;
          return false;
        }
        return true;
      });
      if (file.history.length === before) {
        spent.add(`${oldest.network}.${oldest.cid}`);
        continue;
      }
      file.trimmed += before - file.history.length;
      oldest.meta.bytes = await this.writeFile(oldest.network, oldest.cid, file);
      oldest.meta.oldestAt = file.history[0]?.at ?? oldest.meta.lastAt;
      // The list's last message, gone with the rest when the budget deleted every one.
      const last = lastOf(file.history);
      if (last) oldest.meta.last = last;
      else delete oldest.meta.last;
      await this.writeInbox(oldest.network, inboxes.get(oldest.network)!);
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private summary(cid: string, meta: Meta, now: number): MessagingConversation {
    const maxAge = (this.constantsOfOrDefault().firstContactMaxAge ?? 48 * 3600) * 1000;
    return {
      cid,
      role: meta.role,
      ...(meta.handle ? { handle: meta.handle } : {}),
      ...(meta.to ? { to: meta.to } : {}),
      ...(meta.continues ? { continues: meta.continues } : {}),
      startedAt: meta.startedAt,
      lastAt: meta.lastAt,
      unread: meta.unread,
      outbox: meta.outbox,
      // An initiator's conversation nobody has answered: its first messages carry its t, and past t + 48 hours a
      // reader that never took one refuses them all (protocol.md §16.4). It may need starting again.
      unanswered: meta.role === "initiator" && !meta.answered && now > meta.startedAt + maxAge,
      ...(meta.restartedAs ? { restartedAs: meta.restartedAs } : {}),
      ...(meta.unreachable ? { unreachable: meta.unreachable } : {}),
      ...(meta.last ? { last: meta.last } : {}),
      ...(meta.name ? { name: meta.name } : {}),
    };
  }

  /** A conversation's record read without its secrets. */
  private info(state: string): { missing: number; maxTextLen: number; sendsFirstContact: boolean } {
    return this.read(this.wasmCall(() => this.deps.wasm.messagingConversationInfo(state)));
  }

  private requestsInfo(requests: string): Array<{
    cid: string;
    t: number;
    to: string;
    continues: { cid: string; verified: boolean } | null;
    arrivals: number[];
  }> {
    return this.read(this.wasmCall(() => this.deps.wasm.messagingRequestsInfo(requests)));
  }

  private constantsOf(): { firstContactStampBits: number; envelopeSizes: number[]; firstContactMaxAge?: number } {
    this.constants ??= this.read(this.wasmCall(() => this.deps.wasm.messagingConstants()));
    return this.constants!;
  }

  private constantsOfOrDefault(): { firstContactMaxAge?: number } {
    try {
      return this.constantsOf();
    } catch {
      return {};
    }
  }

  /** Refuses a text the next message of `state` can't carry: its kind byte counts. */
  private checkLength(state: string, text: string): void {
    const { maxTextLen } = this.info(state);
    if (new TextEncoder().encode(text).length + 1 > maxTextLen) {
      throw new Error(t("worker.messaging.tooLong", { max: Math.max(0, maxTextLen - 1) }));
    }
  }

  private checkText(text: string): void {
    if (typeof text !== "string" || !text.trim()) throw new Error(t("worker.messaging.empty"));
  }

  /** `task` with the Seedelf key, in the wallet's queue: throws if locked. */
  private withKey<T>(task: (key: Wasm.SeedelfKey, keys: Parameters<PhrasePin>[0]) => T): Promise<T> {
    return this.deps.wallet.withKeys((keys) => task(keys.seedelf, keys));
  }

  /** A WebAssembly call outside the wallet's queue: one that traps locks the wallet, as one inside it does. */
  private wasmCall<T>(call: () => T): T {
    try {
      return call();
    } catch (e) {
      if (isTrap(e)) {
        void this.deps.wallet.trapped().catch(() => undefined);
        throw new WalletLocked(WASM_BROKEN());
      }
      throw e;
    }
  }

  /** An export's answer that may be a refusal. */
  private parse<T>(json: string): T | Refused {
    return JSON.parse(String(json)) as T | Refused;
  }

  /** An export's answer that's never a refusal: those that refuse nothing throw for a request that doesn't read. */
  private read<T>(json: string): T {
    return JSON.parse(String(json)) as T;
  }

  private wait(): Promise<void> {
    return (this.deps.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(0);
  }

  /** Runs `task` in the background, its failure its own: a stamp, a post. */
  private behind(task: Promise<unknown>): void {
    // Its failure is its own, but WebAssembly that trapped under it is broken for good: the wallet locks (runs.ts).
    const run = task.catch(async (e: unknown) => {
      if (isTrap(e)) await this.deps.wallet.trapped().catch(() => undefined);
    });
    this.background.add(run);
    void run.finally(() => this.background.delete(run));
  }

  /** Resolves once nothing runs in the background: for tests, and for a run that must finish what it started. */
  async whenIdle(): Promise<void> {
    while (this.background.size || this.syncs.size || this.posting.size) {
      await Promise.all([...this.background, ...[...this.syncs.values()].map((s) => s.running), ...[...this.posting.values()].map((p) => p.running)].map((p) => p.catch(() => undefined)));
    }
  }

  /** Runs `task` after every earlier state change. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** One run of `task` at a time per network; asked during one, it runs once more after it. */
  private once(runs: Map<NetworkName, { running: Promise<void>; again: boolean }>, network: NetworkName, task: () => Promise<void>) {
    const now = runs.get(network);
    if (now) {
      now.again = true;
      return now.running;
    }
    const state = { running: Promise.resolve(), again: false };
    state.running = (async () => {
      try {
        do {
          state.again = false;
          await task();
        } while (state.again);
      } finally {
        runs.delete(network);
      }
    })();
    runs.set(network, state);
    return state.running;
  }
}

/**
 * A trap ends a run, as runs.ts's does; any other failure is that network's alone. One `wasmCall` or the wallet's
 * queue caught has locked the wallet already.
 */
function rethrowTrap(e: unknown): void {
  if (isTrap(e)) throw e;
}

/** What the inbox shows of a conversation that its record decides: its storage, its outbox, its oldest message. */
function measure(file: ConversationFile, lastAt: number): Pick<Meta, "bytes" | "outbox" | "oldestAt" | "last"> {
  return {
    bytes: storedBytes(utf8Length(JSON.stringify(file))),
    outbox: file.history.filter((e) => e.sent === "queued" || e.sent === "pending").length,
    oldestAt: file.history[0]?.at ?? lastAt,
    last: lastOf(file.history),
  };
}

/**
 * What the list shows of a history's last message: which way, and its first PREVIEW_CHARS characters, whole code
 * points, so a cut never splits one. None once the budget has deleted every message.
 */
export function lastOf(history: readonly Entry[]): Meta["last"] {
  const entry = history.at(-1);
  if (!entry) return undefined;
  if (entry.text === undefined) return { dir: entry.dir };
  const chars = [...entry.text];
  return { dir: entry.dir, text: chars.length > PREVIEW_CHARS ? `${chars.slice(0, PREVIEW_CHARS).join("")}…` : entry.text };
}

function entryView(entry: Entry): MessagingEntry {
  return {
    id: entry.id,
    dir: entry.dir,
    at: entry.at,
    // A kind this version can't show, or a request's message that doesn't read now: said, never guessed at.
    ...(entry.text !== undefined ? { text: entry.text } : { unreadable: true }),
    ...(entry.sent ? { sent: entry.sent } : {}),
    ...(entry.expires !== undefined ? { expires: entry.expires } : {}),
  };
}
