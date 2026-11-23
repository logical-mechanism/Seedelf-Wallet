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
// scan (which answers a digit an envelope, as long as the batch whatever
// matched), and solving proof of work.
//
// The records, sealed in the private store (private-store.ts) per network:
//
//   messaging.<network>              The inbox: the requests (with what the
//                                    list shows of each) and the tombstones
//                                    (the crate's own records; a later
//                                    version's requests' record kept aside
//                                    as it came), which Seedelfs take first
//                                    messages, and what each conversation
//                                    shows, with its record's own ID.
//   messagingTake.<network>          The take record (the gate's finding 8):
//                                    where the next read goes on from, the
//                                    key's envelopes the reads found and the
//                                    take hasn't taken yet, and what of them
//                                    wasn't kept. Bounded (TAKE_BYTES).
//   conversation.<network>.<id>      A conversation: its ratchet, its
//                                    outbox and its history together, so
//                                    one write moves them all. `id` is 16
//                                    random bytes the inbox maps to the
//                                    conversation: nothing at rest names it.
//
// The crate's records and the envelopes waiting to be posted or taken are
// stored as base64; this service works with them in hex, as the exports take
// them.
//
// A conversation's record is written before the inbox that lists it, and
// deleted after the inbox that stops listing it: a stop between the two
// leaves a record nothing lists, which the next sync deletes. The inbox
// never lists a record that isn't there. What the inbox shows of each
// conversation is set right from its record at the first sync of each
// unlock (`sweep`), and, where an inbox write failed after its record's, at
// the take's next bookkeeping write (the gate's f4).
//
// One budget for what Messages keeps of conversations (the 1.10.0 gate's W7):
// both networks' inboxes and every conversation's record, as stored, within
// MESSAGES_BUDGET_BYTES. chrome.storage.local holds 10 MB for the whole
// wallet, and a write it refuses breaks payments' own records, so a write
// that would pass the budget makes room first, by deleting old messages, and
// isn't made at all when no deletion would make enough. Then that envelope
// isn't kept: it's counted (`dropped`), and the cursor moves past it, so
// nothing about it shows in what the wallet asks the relay (W11). Requests
// have a room of their own beside it, bounded by the crate. And no write of
// Messages that grows storage takes the whole area within RESERVE_BYTES of
// its quota (W11): what's left is payments' and the rest of the wallet's.
//
// Sending (§4.2): in the queue, the ratchet steps and the envelope goes into
// the record as pending; out of it, the relay's stamp is solved and the
// stored bytes posted; in the queue again, it's marked posted. A stopped
// worker posts every pending envelope again at its next sync, the same
// bytes, which the relay takes as already held.
//
// What an envelope holds never decides what the wallet sends, or when (the
// 1.10.0 gate's W1 to W4, W10): the relay, on mainnet the same server as the
// chain's reads, sees every request's time. So a sync has two phases.
//
//   The read: PAGES_A_SYNC pages at most, one after the other, whatever they
//   hold, and the scan of each, which costs the same for every envelope.
//   Nothing is opened or read from a record between two page requests, and
//   the one write, the scan's mark (below), is the same for every page. Then
//   one write of the take record (`messagingTake.<network>`, sealed; the
//   gate's finding 8): where the read ended, which the next read goes on from,
//   and the key's envelopes it found, for the take. It has a chain of its own,
//   never behind the take's work in the queue, so after a lock or a stop every
//   wallet's next read goes on from where its last read ended, whatever its
//   takes were doing. Then what's waiting is posted.
//   The take: in the queue, in the background, after any take still running,
//   each envelope the take record holds is opened and received, its records
//   written, and the read's envelopes go from the take record once all are
//   taken. It lets the event loop turn between envelopes, so a page of the
//   next read waits at most one envelope's work. A lock or a stop leaves what
//   isn't taken in the take record: the next take goes on from it, asking no
//   page again, and every envelope already taken is refused as a duplicate
//   (§5).
//
// No sync waits for a take, and none follows one: the next read comes at the
// next tick (the alarm's minute, or a wallet page's 10 s), from where the last
// read ended, whatever is still being taken. The take record is bounded
// (TAKES_BEHIND reads, TAKE_BYTES): past it the oldest read waiting is
// dropped, then the newest keeps what fits, unopened and counted: a read is
// never skipped or cut short for them, since how far behind the takes are
// depends on how many of the key's envelopes the pages held. No refusal of an
// envelope is kept, shown or acted on, and none starts a request, but the one
// the conversation's own ratchet authenticated: a message it can't reach (§6).
//
// The residual (W10): the take runs on the worker's one thread and in the
// wallet's key queue, so a page asked while it runs, or a post, can be late by
// one envelope's work, and the take record's write after a read is larger
// where the pages held the key's envelopes: a lock or a stop during it has the
// next read ask that read's pages again. A relay that times the requests and
// fills pages with envelopes it sealed to a register can test, statistically
// and over many syncs, whether that register is this wallet's.
//
// A step that traps (W9, W13). WebAssembly that traps locks the wallet, and
// the next unlock would read the same page again. So before each page's scan,
// and before each envelope's take, the step is noted in a sealed mark of its
// own (the scan's and the take's apart), cleared as it ends; a trap leaves it,
// with a flag beside it that needs no key and says which step it was. A
// network so stopped isn't synced by itself again: the overview says it, and
// Try again (`retry`) steps over the envelope that trapped, or scans that
// page's envelopes one at a time so the next one names it.
//
// The relay's off switch (W15): a 410 holds the network's Messages in session
// storage, asked again once an hour and at each unlock, with nothing posted or
// solved meanwhile. The device's clock is measured against the relay's where a
// fresh post's answer gives it, and only said (W14): every rule that runs on a
// clock runs on the device's, and every wait kept in memory on a monotonic one.
//
// Nothing reaches the relay while a network's Messages switch is off
// (preferences.ts `messaging`), and nothing is read while locked: there's no
// key then. Pages are read on unlock and every minute after, through
// `seedelf.messaging`'s alarm (sw.ts).
//
// A Seedelf takes first messages (W8) where this browser put it under a
// register when it minted it (minted-by.ts `mintedAt`), or where the user
// turned it on: never because it's merely under the key, since anyone can
// mint one under the sum of two of the wallet's registers, and answering at
// it, or showing it, would tell them the two are one wallet's.
//
// The verified reveal (protocol.md §19, 54f): the side that wrote first may
// show the other one of its Seedelfs, once answered, as a message of kind
// 0x02. Its reader checks the proof as the message is received, in the
// queue, with no request. Whether the chain gives the name that register now,
// as Send's pay-by-name finds a Seedelf, is read only when the user asks, in
// the thread (`checkReveals`): a read right after a reveal came would tell
// the server whom it was for. Only then does the conversation name it; a
// reveal that fails never shows its name.

import { t } from "../i18n";
import { sha256 } from "@noble/hashes/sha2.js";
import type * as Wasm from "@seedelf/wasm";

import { NETWORKS, type NetworkName } from "../networks";
import {
  CONVERSATION_NAME_CHARS,
  type MessagingConversation,
  type MessagingEntry,
  type MessagingOverview,
  type MessagingRequest,
  type MessagingSeedelf,
  type MessagingThread,
} from "../shared/rpc";
import { registerOf, type RegisterHex } from "./chain";
import type { ContractView } from "./contract-scan";
import { clearRemoved, mintedAt, mintedBy, rememberRegister, removedHere } from "./minted-by";
import type { PreferencesService } from "./preferences";
import {
  conversationRecord,
  CONVERSATION_RECORDS,
  newRecordId,
  PRIVATE_PREFIX,
  type PrivateStore,
  type RecordName,
  UnreadableRecordError,
} from "./private-store";
import {
  DAY_READ_MAX_MS,
  PAGES_A_SYNC,
  type PostAnswer,
  RelayBusy,
  type RelayClient,
  RELAY_HOLD_MS,
  RelayDayRead,
  RelayDown,
  RelayNotAsked,
  type RelayPage,
  RelayStopped,
  RelayUnknown,
} from "./relay";
import { fromBase64, toBase64, type Area } from "./storage";
import { phrasePin, type PhrasePin, type Wallet, WalletLocked, WASM_BROKEN } from "./wallet";
import { isTrap } from "./wasm";

/** Envelopes scanned in one turn of the wallet's queue: about 0.2 s (protocol.md §8). */
export const SCAN_BATCH = 200;

/** Attempts in one slice of a stamp's search, with a turn of the event loop between: about 28 ms. */
export const STAMP_SLICE = 2 ** 16;

/**
 * Everything Messages stores, on both networks (the owner's call 10, 2026-11-21; the 1.10.0 gate's W7): about 5 MB of
 * the extension's 10, counted as each record is stored (sealed, padded to a power of two, in base64), both inboxes and
 * every conversation's record. A write that would pass it makes room first, the oldest messages going, and isn't made
 * when nothing can.
 */
export const MESSAGES_BUDGET_BYTES = 5 * 1024 * 1024;

/**
 * What one conversation's record is trimmed to first, as stored, when a write of it would pass the budget (W7): a
 * flood from one counterpart, past its share, shortens its own conversation before any other. At or below its share
 * it's trimmed only as any record is, the largest first, so when the budget is tight a stranger's requests (their own
 * room, W11) or another conversation's growth can delete the user's oldest read messages. 1 MiB stored is 512 KiB of
 * JSON.
 */
export const CONVERSATION_SHARE_BYTES = 1024 * 1024;

/**
 * How many reads a network's takes may fall behind (W10): the take record holds at most five reads' envelopes. Past it
 * the oldest read still waiting is dropped, unopened and counted (`unopened`), in the write that drops it: a read is
 * never skipped or cut short for the takes, since how far behind they are depends on how many of the key's envelopes
 * the pages held, which the relay chooses.
 */
export const TAKES_BEHIND = 4;

/**
 * The most the take record holds (the 1.10.0 gate's finding 8), as its JSON: it pads to 512 KiB, about 683 KiB as
 * stored, some 380 KiB of the key's envelopes (about 700 short messages, or 180 first messages). Its own room beside the
 * budget, as the requests' is, and within the area's reserve (W11). Past it the oldest read waiting is dropped, then the
 * newest read keeps its first envelopes that fit, each one left out counted (`unopened`).
 */
export const TAKE_BYTES = 512 * 1024;

/**
 * How many times the take tries an envelope again, in place, after a read of storage failed under it (the 1.10.0
 * gate's f2), and how long it waits before each, out of the queue. What still fails is passed over without a word (W9).
 */
export const TAKE_RETRIES = 3;
export const TAKE_RETRY_MS = 500;

/** chrome.storage.local's quota for the whole extension (no unlimitedStorage): 10 MB. */
export const QUOTA_BYTES = 10_485_760;

/**
 * What no write of Messages that grows storage leaves less of free (W11): a payment's sealed write-ahead (up to about
 * 87 KB), a record of the wallet's own doubling (up to 1.4 MB), its caches. Requests and bookkeeping too: a write past
 * it isn't made.
 */
export const RESERVE_BYTES = 2 * 1024 * 1024;

/** How long a size waits when a page or a 402 prices it past the relay's ceiling: a page a minute on says again. */
export const CEILING_WAIT_MS = 60_000;

/** How often a network whose relay is stopped (a 410, W15) is asked again: once an hour, and at each unlock. */
export const PAUSED_ASK_MS = 3600_000;

/** Answers this version doesn't know, in a row, after which an envelope is set aside to send again (W15). */
export const UNKNOWN_ANSWERS = 3;

/** How far the device's clock may be off the relay's before the overview says so (W14): half the hour ahead §16.4 allows. */
export const CLOCK_OFF_MS = 30 * 60_000;

/**
 * A first message's t is rounded down to this (W14, clock#6): it hides a clock a few minutes off, which would link
 * one device's first messages, at the cost of up to 10 of the 48 hours a reader takes it in.
 */
export const T_STEP_S = 600;

/** Skipped keys and tombstones are expired at most this often, and at the first sync of each unlock. */
export const EXPIRE_EVERY_MS = 60 * 60_000;

/** How long Try again steps over an envelope that trapped: past the relay's 36 hours, it's gone (W9). */
export const SKIP_FOR_MS = 48 * 3600_000;

/**
 * A post's price before any page has said one: the pool's base (protocol.md §17.4). A 402 names the right one, and
 * every page after carries it.
 */
export const RELAY_BASE_BITS: Record<NetworkName, number> = { mainnet: 18, preprod: 16 };

/** The plaintext's first byte: what it holds [choice, protocol.md §18]. */
export const KIND_TEXT = 0x01;

/** A reveal: the writer's Seedelf and its proof (protocol.md §19). */
export const KIND_REVEAL = 0x02;

/** chrome.storage.session: when each network's skipped keys and tombstones were last expired. A lock clears it. */
export const SESSION_EXPIRED_AT = "seedelf.messaging.expiredAt";

/** chrome.storage.session: until when (ms) each network's relay is stopped and not asked (a 410, W15). A lock clears it. */
export const SESSION_PAUSED = "seedelf.messaging.paused";

/** chrome.storage.session: until when (ms) each network's pages wait for the day's reading (W16). A lock clears it. */
export const SESSION_READ_AFTER = "seedelf.messaging.readAfter";

/**
 * The inbox, `messaging.<network>`, as this service works with it: the crate's records in hex. Stored (`StoredInbox`)
 * with them in base64.
 */
export interface Inbox {
  v: 2;
  /**
   * Where builds before the take record (the 1.10.0 gate's finding 8) read on from: read only where no take record is
   * kept, and never written since. The take record's `cursor` is where the next read goes on from.
   */
  cursor?: string;
  /** When a page last said envelopes after the cursor were gone (ms), as builds before the take record kept it. */
  gapAt?: number;
  /** The crate's requests' record (protocol.md §16.5). */
  requests?: string;
  /**
   * What the list shows of each request, by cid, kept beside the record whenever a receive or an accept changes it:
   * neither an overview nor an envelope that isn't a request's has the module parse the record (W7).
   */
  requestsShown: Record<string, RequestShown>;
  /**
   * Requests' records a later version wrote, which this one doesn't read (W17, DESIGN-protocol §3.7): kept as they came,
   * never handed to the crate nor written over, for that version to read again. New requests start a record of their
   * own meanwhile.
   */
  requestsAside?: string[];
  /** The crate's tombstones' record. */
  tombstones?: string;
  /**
   * The registers each Seedelf takes first messages at now, by asset name (hex), as the crate takes them: set at each
   * take from what the wallet made, the user's choices and the kept view (`handlesNow`, W8).
   */
  handles: Record<string, RegisterHex[]>;
  /** The user's own choice for a Seedelf at a register (`answerAt`): on for one this browser didn't make, off for any. */
  answerAt?: Array<{ name: string; register: RegisterHex; on: boolean }>;
  /** The pairs this browser made that a kept view has shown at their register: one a later view doesn't is gone (W8). */
  seen?: string[];
  /**
   * The pairs a kept view dropped (W12's transition: shown at their register once, and no longer), for good (the 1.10.0
   * gate's f6): no view absent after a lock brings one back. Only the user's own turn-on lifts it.
   */
  gone?: string[];
  /** What each conversation shows, by cid, without opening its record. */
  conversations: Record<string, Meta>;
  /** Each request's messages not yet shown, by cid. */
  requestsUnread: Record<string, number>;
  /** Envelopes every read steps over, each by its SHA-256 (hex), until when (ms): one a step trapped on (`retry`, W9). */
  skip?: Array<{ envelope: string; until: number }>;
  /**
   * Messages not kept that the inbox counts: the requests a record the crate couldn't read listed (`asideRequests`), and
   * the key's envelopes builds before the take record counted here. The take record counts the rest (`noRoom`,
   * `unopened`).
   */
  dropped?: number;
  /**
   * The device's clock against the relay's, as the last fresh post's answer gave it (W14): `off` (ms) is how far this
   * device's clock is ahead (negative: behind), measured `at` (the device's ms). Said, never used as the time.
   */
  clock?: { at: number; off: number };
  /** The Seedelfs this browser minted before 1.10.0 kept their pairs (W12): adopted once, from the first kept view. */
  adopted?: true;
}

/** The inbox as stored: the crate's records in base64 (v 2); a v 1 inbox, from before the 1.10.0 gate, held them in hex. */
type StoredInbox = Omit<Inbox, "v" | "requestsShown"> & { v: 1 | 2; requestsShown?: Inbox["requestsShown"] };

/** The record versions this build reads (W15, versions-upgrade#5): another is a record that won't open, kept as it is. */
const READS_VERSIONS = new Set<unknown>([1, 2]);

/** What the list shows of a request (the bindings' `messagingRequestsInfo`, less its arrivals). */
export interface RequestShown {
  /** F's `t` (s). */
  t: number;
  /** The handle it was written to (asset name, hex); empty for a continuation. */
  to: string;
  continues?: { cid: string; verified: boolean };
  /** Its messages. */
  messages: number;
  /** When its last message arrived (s). */
  last: number;
}

/** What the inbox keeps of a conversation. */
export interface Meta {
  /** Its record's own ID (`conversation.<network>.<id>`, W7): none in an inbox from before the 1.10.0 gate. */
  id?: string;
  role: "initiator" | "responder";
  /** The Seedelf this wallet wrote to (asset name, hex), when it wrote first to one. */
  handle?: string;
  /** Which of this wallet's Seedelfs it was written to (asset name, hex), when the other side wrote first. */
  to?: string;
  /** What its `replaces` amounted to (protocol.md §6), when it names one. */
  continues?: { cid: string; verified: boolean };
  /**
   * The conversation's t (ms): when it was started, by the clock of the side that wrote first, rounded down to 10
   * minutes (W14). Another device's clock where the other side wrote first: never a time of this device's.
   */
  startedAt: number;
  /** The last message, either way (ms). */
  lastAt: number;
  /** Messages received and not yet shown. */
  unread: number;
  /**
   * The record's next entry when the thread was last shown: received entries from it on are unread, which `unread`
   * is counted again from at the first sync of each unlock (W9). None in an inbox from before the 1.10.0 gate.
   */
  readTo?: number;
  /** Messages waiting to be posted, and texts waiting for the first-contact stamp. */
  outbox: number;
  /**
   * Written first, and no reply yet: what's left of the writer's own share of first messages (W17, `shareOf`), as the
   * record's last write of a message left it. None once a reply has come, and where the other side wrote first.
   */
  firstContactLeft?: ShareLeft;
  /** What its record takes of the extension's storage (`storedBytes`). */
  bytes: number;
  /** Its oldest message kept (ms). */
  oldestAt: number;
  /** The conversation this one was started again as. */
  restartedAs?: string;
  /** Written first, and a reply has come: its messages no longer carry F, and its 48 hours no longer matter. */
  answered?: boolean;
  /**
   * A message of it the ratchet authenticated and can't reach, more than MAX_SKIP ahead (protocol.md §6): the
   * conversation may not continue. Gone once a later message of it decrypts. The one refusal the wallet acts on (W3):
   * the crate gives it only for a message that passed its envelope's checks (DESIGN-protocol §3.3). A flag: the same
   * envelope read again after a stop isn't counted twice. Builds before the 1.10.0 gate kept a count.
   */
  unreachable?: true | number;
  /** Its record won't open, or the crate can't read it: it can't be shown, and can be deleted (W9). */
  unreadable?: true;
  /** Its last message kept, for the list (`lastOf`): which way, and the start of its text, or that it's a reveal. */
  last?: { dir: "in" | "out"; text?: string; reveal?: true };
  /** The user's own name for it, on this device only: never from a message, never sent (`rename`). */
  name?: string;
  /**
   * The Seedelf the other side showed, verified (protocol.md §19): its proof, and the register a fresh read of the
   * contract gave its name when it was checked. The latest that verified, in the order they came, and when it came
   * (`at`, ms). Only where this wallet was written to. Set from the record (`revealsOf`).
   */
  revealed?: { name: string; at: number };
  /** A reveal whose proof verified waits for the user to have the chain checked (`checkReveals`). Set from the record. */
  unchecked?: true;
}

/** The longest name the user can give a conversation, in characters. */
export const NAME_CHARS = CONVERSATION_NAME_CHARS;

/** How much of a conversation's last message the inbox keeps for the list: its first characters. */
export const PREVIEW_CHARS = 120;

/**
 * A conversation's own record, `conversation.<network>.<id>`, as this service works with it: the crate's record and
 * each envelope in hex. Stored with them in base64 (`fileToStored`).
 */
export interface ConversationFile {
  v: 2;
  /** The crate's record (protocol.md §16.5): the ratchet, with its secrets. */
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
   * A content kind this version doesn't know (0x03 to 0x7F, protocol.md §18, W15): its body as it came (hex), kept
   * for a later version to show.
   */
  body?: string;
  /**
   * A sent message: `queued` until the first-contact stamp is set (or, past it, until the writer's own share of a
   * first message has room, W13), then `pending` until the relay keeps it, then `posted`; `refused` (`refusedBy`):
   * bytes the server refused (a 400 or a 413, or answers this version doesn't know three times in a row), kept so the
   * user can send them again (`resend`), or a message the wallet couldn't seal, with none.
   */
  sent?: "queued" | "pending" | "posted" | "refused";
  /** Who refused a `refused` one: the server (or something on the way), or the wallet's own crate, which sealed nothing. */
  refusedBy?: "server" | "wallet";
  /** A pending or refused message's envelope, dropped once it's posted. */
  envelope?: string;
  /**
   * When the relay drops it (ms), once posted: by this device's clock, `postedAt` and the relay's 36 hours, for one the
   * relay took new; the relay's own for one it already held (W14).
   */
  expires?: number;
  /** When the relay's answer that took it new came, by this device's clock (ms, W14). */
  postedAt?: number;
  /**
   * A reveal (`kind` KIND_REVEAL, protocol.md §19). Sent: the Seedelf this wallet showed. Received: `unchecked`, its
   * proof verified and the chain's register not yet compared (the user's press compares it, `checkReveals`), which the
   * name and register are kept for; `verified`; or `failed`, with nothing of the name kept. A received reveal with
   * none was never checked: one in a request's message, or a first-contact message's. Builds before the 1.10.0 gate
   * kept an unchecked one as `checking`, which reads as `unchecked`.
   */
  reveal?:
    | { dir: "out"; name: string }
    | { status: "unchecked"; name: string; register: RegisterHex }
    | { status: "verified"; name: string }
    | { status: "failed" };
}

/** A reveal the other side sent, as the history keeps it. */
type ReceivedReveal = Exclude<NonNullable<Entry["reveal"]>, { dir: "out" }>;

export interface MessagingDeps {
  wasm: typeof Wasm;
  wallet: Wallet;
  store: PrivateStore;
  /** chrome.storage.local: where the orphan sweep finds conversation records nothing lists. */
  local: Area;
  /** chrome.storage.session: when skipped keys and tombstones were last expired. Kept in memory without it. */
  session?: Area;
  preferences: Pick<PreferencesService, "get" | "set">;
  /** `seedelf.messaging`'s alarm, every minute while a switch is on and the wallet unlocked (sw.ts). */
  alarm?: { start(): Promise<void>; stop(): Promise<void> };
  /** Each network's relay (relay.ts). */
  relay: (network: NetworkName) => RelayClient;
  /**
   * The Seedelfs under the wallet's key on `network`, each with its register now. `read`: the contract read now,
   * what's new in it, which throws if it can't be; otherwise only the view the last reading kept, with no request,
   * undefined when none is kept. No sync ever reads (W1): only a press of the user's does (`reveal`).
   */
  ownSeedelfs: (network: NetworkName, read: boolean) => Promise<Array<{ name: string; register: RegisterHex }> | undefined>;
  /** The register of the Seedelf `name` (asset name, hex) on `network`, as Send's build pays one (`seedelfRegisterFrom`). */
  seedelfRegister: (network: NetworkName, name: string) => Promise<RegisterHex>;
  /**
   * The contract read now, as Send's pay-by-name reads it, and a lookup of the register it gives each Seedelf (asset
   * name, hex): undefined for no such Seedelf, or no register on it. A read that fails throws. It reads the whole
   * contract, never one Seedelf, so the server can't tell which a reveal named (`revealedRegistersFrom`). Only the
   * user's press makes it (`checkReveals`), never a sync.
   */
  revealedRegisters: (network: NetworkName) => Promise<(name: string) => RegisterHex | undefined>;
  /** The build's networks (networks.ts `enabledNetworks`): which others the overview says Messages are on for. */
  networks?: readonly NetworkName[];
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
  /** The budget, for tests: MESSAGES_BUDGET_BYTES otherwise. */
  budgetBytes?: number;
  /** A conversation's share of the budget, for tests: CONVERSATION_SHARE_BYTES otherwise. */
  shareBytes?: number;
  /** The take record's bound, for tests: TAKE_BYTES otherwise. */
  takeBytes?: number;
  /**
   * For tests only: told of each throw a take passes over without a word (W9; the 1.10.0 gate's f2), so a test meets
   * any it didn't mean to. The worker never sets it.
   */
  passedOver?: (e: unknown) => void;
  /**
   * What the whole storage area holds now (chrome.storage.local.getBytesInUse(null)): Messages' writes that grow it
   * leave RESERVE_BYTES of its quota free (W11). Without it, nothing is checked but the budget.
   */
  bytesInUse?: () => Promise<number>;
  /** The area's quota, for tests: QUOTA_BYTES otherwise. */
  quotaBytes?: number;
  /** What Messages leaves free of it, for tests: RESERVE_BYTES otherwise. */
  reserveBytes?: number;
  /**
   * A clock that never steps (ms), for the waits kept in memory (W14): performance.now() otherwise. A device clock set
   * back or forward stretches none of them.
   */
  monotonic?: () => number;
}

/**
 * `revealedRegisters` over a read of the contract as Send's pay-by-name reads it (contract-scan.ts
 * `readContractView`), whole and fresh: on the data layer's private index, every Seedelf's name and row at the tip
 * (`names`, the same answer for every wallet) and what changed since this wallet's own cursor (`since`); where it falls
 * to Koios (preprod; mainnet with Koios only or the index down), the whole contract read in full (`full`), never a
 * catch-up on a view kept from before, which would still give a Seedelf burned or moved out of the contract its old
 * register (reveal#5). Its cost, a request for every 1,000 UTxOs, is the user's press to spend.
 */
export function revealedRegistersFrom(
  read: (network: NetworkName, options: { full: boolean }) => Promise<Pick<ContractView, "seedelfs">>,
): MessagingDeps["revealedRegisters"] {
  return async (network) => {
    const { seedelfs } = await read(network, { full: true });
    return (name) => {
      const utxo = seedelfs[name];
      return utxo ? registerOf(utxo) : undefined;
    };
  };
}

/**
 * `seedelfRegister` over a read of the contract made now (contract-scan.ts `readContractView`), as Send's build reads
 * the Seedelfs it pays (transfer.ts `build`, which reads the contract whatever the view kept says): a first message
 * is sealed to the register the chain gives the Seedelf at the user's press, never to one a view kept from before it
 * moved still holds, which would reach its old holder (reactions#7). The read is the same whichever Seedelf is
 * written to: what's new in the contract, or all of it when due.
 */
export function seedelfRegisterFrom(read: (network: NetworkName) => Promise<Pick<ContractView, "seedelfs">>): MessagingDeps["seedelfRegister"] {
  return async (network, name) => {
    const utxo = (await read(network)).seedelfs[name];
    if (!utxo) throw new Error(t("worker.seedelf.notFound", { network }));
    const register = registerOf(utxo);
    if (!register) throw new Error(t("worker.messaging.notARegister"));
    return register;
  };
}

/** What `messagingOpen` names of an envelope: which records `messagingReceive` needs (54d). */
interface Opened {
  cid: string;
  kind: string;
  /** F's `t` (s), for a first-contact message. */
  t: number | null;
  to: string | null;
  replaces: string | null;
}

/** One read's worth of the key's envelopes, waiting for the take (W4), as the take record holds them. */
interface Batch {
  /** The envelopes the scan matched, in the order they came, each once, and none another read waiting holds. */
  envelopes: string[];
  /** The phrase the read was made under, or the take record was opened under: the take of another's writes nothing. */
  pin: PhrasePin;
}

/**
 * The take record, `messagingTake.<network>` (sealed; the 1.10.0 gate's finding 8), as this service works with it:
 * where the next read goes on from, what the reads found that isn't taken yet, and what of it wasn't kept. Written in a
 * chain of its own (`onTakes`): after each read, as each read's envelopes are taken, at a rewind. Stored
 * (`StoredTakes`) with the envelopes in base64.
 */
interface Takes {
  /** Where the next read goes on from: where the last read ended. None before the first page, and after a rewind. */
  cursor?: string;
  /** When a page last said envelopes after a cursor of the wallet's own were gone (ms): messages sent then may never arrive. */
  gapAt?: number;
  /** The key's envelopes the reads found and the take hasn't taken yet, read by read, oldest first. */
  batches: Batch[];
  /**
   * The key's envelopes dropped unopened (W10, the 1.10.0 gate's f5): a read's the takes fell more than TAKES_BEHIND
   * behind, and those TAKE_BYTES had no room for. Anyone may have sent them. Counted in the write that drops them.
   */
  unopened: number;
  /**
   * The key's envelopes not kept for want of room (W11): a message the budget and the area's reserve had none for,
   * counted as its read's envelopes go from the record (so a read taken again counts each once); and a read whose
   * envelopes the area's reserve, or the browser, had no room to keep for the take.
   */
  noRoom: number;
}

/** The take record as this service holds it: as it last read or wrote it, in which unlock and epoch. */
interface TakesHeld extends Takes {
  /** The unlock it was read or written in (`unlockedAt`): after another, another phrase's may be there. */
  at: number | undefined;
  /** The network's epoch then: a rewind, or Messages started again, has it read afresh. */
  epoch: number;
  /** Whether it's stored: where it isn't, an inbox from before it holds the cursor. */
  stored: boolean;
  /** What it takes as stored, as last read or written: a write's growth is counted from it (W11). */
  bytes: number;
}

/** The take record as stored: the envelopes in base64. */
interface StoredTakes {
  v: 1;
  cursor?: string;
  gapAt?: number;
  batches: Array<{ envelopes: string[] }>;
  unopened?: number;
  noRoom?: number;
}

const takeRecord = (network: NetworkName): RecordName => `messagingTake.${network}`;

/**
 * What a read's scan is working on while it runs (`messagingMark.<network>`, sealed, W9): the page being scanned, by
 * the cursor it was asked from and the one it ended at; or one of that page's envelopes, scanned alone after a trap, by
 * its SHA-256 (hex). Kept by a trap, so the next unlock knows what never ended.
 */
interface ScanMark {
  page?: PageSpan;
  envelope?: string;
}

/** What a take is working on (`messagingTakeMark.<network>`, sealed, W13): the envelope, by its SHA-256 (hex). */
interface TakeMark {
  envelope?: string;
}

/** The two steps a mark covers, each in a record of its own (W13): the read's scan, and the take. */
type MarkStep = "scan" | "take";

/** A page: the envelopes after cursor `from` (none: the pool's start) up to cursor `to`. */
interface PageSpan {
  from?: string;
  to: string;
}

/** A step a trap mark covers: whether one of its own WebAssembly calls trapped, as distinct from a lock it met. */
interface Step {
  trapped: boolean;
}

const markRecord = (network: NetworkName, step: MarkStep): RecordName =>
  step === "scan" ? `messagingMark.${network}` : `messagingTakeMark.${network}`;

/**
 * The trap's mark, `messagingTrap.<network>`: not sealed, since the trap has just locked the wallet. It holds which step
 * trapped, "scan" or "take" (W13), and nothing of what either worked on; builds before it wrote `true`.
 */
const trapKey = (network: NetworkName) => `${PRIVATE_PREFIX}messagingTrap.${network}`;

/** A refusal the crate gives, as its code (54d). */
interface Refused {
  refused: string;
}
const isRefused = (answer: unknown): answer is Refused =>
  typeof answer === "object" && answer !== null && typeof (answer as Refused).refused === "string";

/**
 * A record the crate doesn't read (W17, DESIGN-protocol §3.7): `unsupported_state_version` names the version its first
 * byte says, older than this build's for a development build's record, newer for a later version's; `invalid_state`
 * for one that doesn't parse.
 */
interface RecordRefused extends Refused {
  version?: number;
}

/**
 * Refusals that are about the records the crate was handed, not about the envelope: the take sets aside any record it
 * then can't read, and tries once more (`setAside`).
 */
const RECORD_REFUSALS = new Set(["invalid_state", "unsupported_state_version"]);
const isRecordRefusal = (answer: unknown) => isRefused(answer) && RECORD_REFUSALS.has(answer.refused);

/** The message a refusal is said with, when a request of the user's is refused. */
export class MessagingRefused extends Error {
  constructor(readonly code: string) {
    super(t("worker.messaging.refused", { code }));
  }
}

/**
 * What Messages stores can't take this write: the budget has no room nothing deleted could make, the storage area's
 * reserve would be crossed, or the browser refused the write (W7, W11). Nothing of it was written. Where the budget or
 * the reserve refused it, nothing was deleted for it either (the 1.10.0 gate's f3); where the browser refused it after
 * the room it needed was made, the oldest read messages that made the room are gone, as the budget would delete them
 * next.
 */
export class MessagingFull extends MessagingRefused {
  constructor() {
    super("full");
  }
}

/**
 * A read of chrome.storage that failed (the 1.10.0 gate's f2): the area answered with an error, not a record, nor one
 * that won't open. Nothing about the envelope being taken: the take tries it again, in place (TAKE_RETRIES).
 */
export class StorageFailed extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}

/** `e` as a read of Messages' records failed with it (f2): a read of the area that failed is StorageFailed. */
const failedRead = (e: unknown): unknown =>
  e instanceof UnreadableRecordError || e instanceof WalletLocked || e instanceof StorageFailed || isTrap(e) ? e : new StorageFailed(e);

/**
 * The writer's own share of first messages is used up (DESIGN-protocol §3.5, W17): what a reader keeps of a stranger's
 * before replying, 16 messages and 64 KiB, which the crate refuses past (`request_full`) before the chain moves.
 * Nothing of the text was kept; the next one waits for a reply. The wallet's own refusal, never the server's.
 */
export class ShareUsedUp extends MessagingRefused {
  constructor() {
    super("request_full");
    this.message = t("worker.messaging.waitForReply");
  }
}

/**
 * A write of Messages' own bookkeeping (the cursor, which Seedelfs take first messages, a mark) that would cross the
 * storage area's reserve, or that the browser refused (W11): it isn't made, and Messages stops taking until room is
 * made. Reads go on as ever.
 */
class ReserveReached extends MessagingFull {}

/** What a write of Messages is, for its room (W11): a message's, a request's (a room of their own), or bookkeeping. */
type WriteKind = "content" | "requests" | "bookkeeping";

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
const hexOf = (bytes: Uint8Array) => {
  let out = "";
  for (const b of bytes) out += HEX[b];
  return out;
};
const bytesOf = (hex: string) => {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
};
const base64OfHex = (hex: string) => toBase64(bytesOf(hex));
const hexOfBase64 = (base64: string) => hexOf(fromBase64(base64));

/** An envelope's SHA-256, hex: how a mark and the skip list name one without keeping it. */
const envelopeHash = (envelope: string) => hexOf(sha256(bytesOf(envelope)));

const sameRegister = (a: RegisterHex, b: RegisterHex) => a.generator === b.generator && a.publicValue === b.publicValue;
const pairKey = (name: string, register: RegisterHex) => `${name}:${register.generator}${register.publicValue}`;
const isRegister = (r: unknown): r is RegisterHex =>
  typeof r === "object" &&
  r !== null &&
  /^[0-9a-f]{96}$/.test(String((r as RegisterHex).generator)) &&
  /^[0-9a-f]{96}$/.test(String((r as RegisterHex).publicValue));

/** A text as the plaintext it's sent as: its kind, then its UTF-8. */
export function plaintextOf(text: string): string {
  const body = new TextEncoder().encode(text);
  const out = new Uint8Array(body.length + 1);
  out[0] = KIND_TEXT;
  out.set(body, 1);
  return hexOf(out);
}

/** A reveal (hex, protocol.md §19.3) as the plaintext it's sent as: its kind, then the reveal. */
export function revealPlaintextOf(reveal: string): string {
  return KIND_REVEAL.toString(16).padStart(2, "0") + reveal;
}

/** The first control kind (protocol.md §18, W15): 0x80 to 0xFF are read by the wallet, never shown as a message. */
export const KIND_CONTROL = 0x80;

/**
 * A plaintext as a message keeps it (protocol.md §18, W15): its text; a reveal's kind, which its own check names; a
 * content kind this version doesn't know (0x03 to 0x7F) with its body as it came, kept for a later version to show;
 * or nothing at all for a control kind it doesn't know (0x80 to 0xFF), which leaves no entry, no unread and no
 * preview.
 */
export function textOf(plaintext: string): Pick<Entry, "text" | "kind" | "body"> | undefined {
  const bytes = bytesOf(plaintext);
  const kind = bytes[0];
  if (kind === KIND_TEXT) return { text: new TextDecoder().decode(bytes.subarray(1)) };
  if (kind === KIND_REVEAL) return { kind };
  if (kind !== undefined && kind >= KIND_CONTROL) return undefined;
  return { kind: kind ?? 0, body: plaintext.slice(2) };
}

/** A string's UTF-8 length: what the private store pads and seals, not its UTF-16 length. */
const utf8Length = (text: string) => new TextEncoder().encode(text).length;

/** What a record of `jsonLength` UTF-8 bytes takes of the extension's storage: sealed, padded, base64 (private-store.ts). */
export function storedBytes(jsonLength: number): number {
  let size = 1024;
  while (size < jsonLength) size *= 2;
  return Math.ceil(((size + 16) * 4) / 3);
}

/** The least a sealed record takes as stored: its 1 KiB pad. */
const PAD_STORED = storedBytes(0);

/** What `stored` takes as stored. */
const sizeOf = (stored: unknown) => storedBytes(utf8Length(JSON.stringify(stored)));

/** A conversation's record as stored: the crate's record and every envelope in base64. */
export function fileToStored(file: ConversationFile): ConversationFile {
  return {
    ...file,
    v: 2,
    state: base64OfHex(file.state),
    history: file.history.map((e) => (e.envelope ? { ...e, envelope: base64OfHex(e.envelope) } : e)),
  };
}

/** A conversation's record as this service works with it, from what's stored. */
export function fileFromStored(stored: ConversationFile | (Omit<ConversationFile, "v"> & { v: 1 })): ConversationFile {
  if (stored.v !== 2) return { ...stored, v: 2 };
  return {
    ...stored,
    state: hexOfBase64(stored.state),
    history: stored.history.map((e) => (e.envelope ? { ...e, envelope: hexOfBase64(e.envelope) } : e)),
  };
}

function inboxToStored(inbox: Inbox): StoredInbox {
  const { requests, requestsAside, tombstones, ...rest } = inbox;
  return {
    ...rest,
    v: 2,
    ...(requests !== undefined ? { requests: base64OfHex(requests) } : {}),
    ...(requestsAside?.length ? { requestsAside: requestsAside.map(base64OfHex) } : {}),
    ...(tombstones !== undefined ? { tombstones: base64OfHex(tombstones) } : {}),
  };
}

const emptyInbox = (): Inbox => ({ v: 2, handles: {}, conversations: {}, requestsUnread: {}, requestsShown: {} });

/**
 * The inbox as the budget counts it (W11): without the requests, which have a room of their own beside it, bounded
 * by the crate (256 KiB a network as it holds them).
 */
const leanOf = (inbox: Inbox): Inbox => {
  const { requests: _requests, ...rest } = inbox;
  return { ...rest, requestsShown: {}, requestsUnread: {} };
};

/** The take record as stored (finding 8): its envelopes in base64, the counts only once there are some. */
function takesToStored(t: Takes): StoredTakes {
  return {
    v: 1,
    ...(t.cursor !== undefined ? { cursor: t.cursor } : {}),
    ...(t.gapAt !== undefined ? { gapAt: t.gapAt } : {}),
    batches: t.batches.map((b) => ({ envelopes: b.envelopes.map(base64OfHex) })),
    ...(t.unopened ? { unopened: t.unopened } : {}),
    ...(t.noRoom ? { noRoom: t.noRoom } : {}),
  };
}

/** The take record as this service works with it, from what's stored (none: no record), each batch under `pin`. */
function takesFromStored(stored: StoredTakes | undefined, pin: PhrasePin): Takes {
  const count = (n: unknown) => (typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : 0);
  return {
    ...(typeof stored?.cursor === "string" ? { cursor: stored.cursor } : {}),
    ...(typeof stored?.gapAt === "number" ? { gapAt: stored.gapAt } : {}),
    batches: (Array.isArray(stored?.batches) ? stored.batches : [])
      .map((b) => ({ envelopes: (Array.isArray(b?.envelopes) ? b.envelopes : []).filter((e) => typeof e === "string").map(hexOfBase64), pin }))
      .filter((b) => b.envelopes.length > 0),
    unopened: count(stored?.unopened),
    noRoom: count(stored?.noRoom),
  };
}

/** An envelope's share of the take record's JSON as stored: its base64, quoted. */
const envelopeJsonLength = (hex: string) => 4 * Math.ceil(hex.length / 2 / 3) + 2;

/** The take record's JSON length as stored, worked out without writing its envelopes out. */
function takesJsonLength(t: Takes): number {
  // `{"envelopes":[` and `]}`, each envelope, and the commas between.
  const batch = (b: Batch) => 16 + b.envelopes.reduce((n, e) => n + envelopeJsonLength(e), 0) + Math.max(0, b.envelopes.length - 1);
  return (
    utf8Length(JSON.stringify(takesToStored({ ...t, batches: [] }))) +
    t.batches.reduce((n, b) => n + batch(b), 0) +
    Math.max(0, t.batches.length - 1)
  );
}

/**
 * Holds `t` to the take record's bounds (W10, finding 8, f5): at most 1 + TAKES_BEHIND reads waiting, and `most` bytes
 * of JSON. Past either the oldest read waiting goes (never the first, which may be being taken), then the newest keeps
 * its first envelopes that fit: each envelope left out is counted (`unopened`), in the write this is for.
 */
function bounded(t: Takes, most: number): void {
  const drop = (at: number) => {
    const [gone] = t.batches.splice(at, 1);
    t.unopened += gone!.envelopes.length;
  };
  // A copy of the list, and of the newest read's, which may lose envelopes: the record held before stays as it was.
  t.batches = [...t.batches];
  while (t.batches.length > 1 + TAKES_BEHIND) drop(1);
  while (t.batches.length > 2 && takesJsonLength(t) > most) drop(1);
  let length = takesJsonLength(t);
  const last = t.batches.at(-1);
  if (!last || length <= most) return;
  const kept = { ...last, envelopes: [...last.envelopes] };
  t.batches[t.batches.length - 1] = kept;
  while (kept.envelopes.length && length > most) {
    const gone = kept.envelopes.pop()!;
    length -= envelopeJsonLength(gone) + (kept.envelopes.length ? 1 : 0);
    t.unopened++;
  }
  if (!kept.envelopes.length) t.batches.pop();
}

/** F's t for a first message written at `now` (ms): seconds, rounded down to T_STEP_S (W14). */
const tOf = (now: number) => Math.floor(now / 1000 / T_STEP_S) * T_STEP_S;

/** A key for what's kept in memory of one conversation: its network and its cid. */
const keyOf = (network: NetworkName, cid: string) => `${network}.${cid}`;

/**
 * What's left of the writer's share of first messages (protocol.md §3.1, DESIGN-protocol §3.5): `messages` more, and
 * the next one's text at most `bytes` (UTF-8, its kind byte aside); both 0 once it's used up.
 */
export interface ShareLeft {
  messages: number;
  bytes: number;
}

/** What the bindings say of the share, as `messagingConversationInfo` gives it (54d, W17): of what's sealed so far. */
interface ShareInfo {
  messages: number;
  /** Bytes of first-contact inner messages left: each takes its text, its kind byte and `perMessage` more. */
  bytes: number;
  /** What each first-contact message takes beside its text and kind byte: F's length and 97. */
  perMessage: number;
}

/**
 * What's left of the writer's share once the texts still queued are sealed too (W17): the crate counts only what it has
 * sealed, and a text waiting for the stamp, or for a reply, takes its part when it is. Undefined where the crate gives
 * no share: once a reply has come, and at the responder.
 */
function shareOf(left: ShareInfo | null | undefined, history: readonly Entry[]): ShareLeft | undefined {
  if (!left) return undefined;
  let messages = left.messages;
  let bytes = left.bytes;
  for (const entry of history) {
    if (entry.sent !== "queued") continue;
    messages--;
    bytes -= utf8Length(entry.text ?? "") + 1 + left.perMessage;
  }
  // The next one's own part: its kind byte, and what every first-contact message takes.
  const room = bytes - 1 - left.perMessage;
  return messages > 0 && room > 0 ? { messages, bytes: room } : { messages: 0, bytes: 0 };
}

const sameShare = (a: ShareLeft | undefined, b: ShareLeft | undefined) => a?.messages === b?.messages && a?.bytes === b?.bytes;

export class MessagingService {
  /** Every state change, one at a time (protocol.md §4.2). */
  private queue: Promise<unknown> = Promise.resolve();
  /** The sync running on each network, if one is: its read and its posts. One asked meanwhile is that one (`join`). */
  private syncs = new Map<NetworkName, Promise<void>>();
  /** The posting running on each network. */
  private posting = new Map<NetworkName, { running: Promise<void>; again: boolean }>();
  /** Each network's take record as this service last read or wrote it (finding 8): read once per unlock and epoch. */
  private takes = new Map<NetworkName, TakesHeld>();
  /** Each network's take record's writes, one after another, in a chain of their own: never behind the queue (`onTakes`). */
  private takeWrites = new Map<NetworkName, Promise<unknown>>();
  /** The networks a read moved on since their take last set which Seedelfs take first messages (`noteOwn`), with its phrase. */
  private ownDue = new Map<NetworkName, PhrasePin>();
  /** The networks whose take is running (`take`). */
  private taking = new Set<NetworkName>();
  /**
   * Conversations whose record was written and whose inbox write after it wasn't (the 1.10.0 gate's f4), by network:
   * true where a press of the user's wrote it, whose message the post reads whatever the inbox counts. Set right from
   * their records at the take's next bookkeeping write (`setRight`), or the sweep.
   */
  private inboxBehind = new Map<NetworkName, Map<string, boolean>>();
  /** First-contact stamps being solved, by conversation (`keyOf`). */
  private solving = new Set<string>();
  /** The prices the last page said, by network: 512, 2,048, 8,192 and 32,768 bytes. */
  private prices = new Map<NetworkName, number[]>();
  /** No post before this (`monotonic` ms), by network: the edge or the server asked every post to wait. */
  private postAfter = new Map<NetworkName, number>();
  /** No post of a size (bytes) before this (`monotonic` ms), by network: the relay asked that size to wait (§17.4). */
  private sizeAfter = new Map<NetworkName, Map<number, number>>();
  /** Answers this version doesn't know, in a row, by an envelope's stamp digest (W15). */
  private unknown = new Map<string, number>();
  /** Where each network's next posting run begins: after this message (`keyOf` and its id), one answered unknown (W15). */
  private postFrom = new Map<NetworkName, string>();
  /**
   * Each network's epoch: bumped where what's in memory of its reads must go (Messages started again, a Seedelf turned
   * on): a take under an older one stops, writing nothing more (W12, W13).
   */
  private epochs = new Map<NetworkName, number>();
  /**
   * Work found for an envelope's post, by its stamp's digest, until it's posted: a try the relay didn't answer, or
   * one it priced dearer, isn't worked for again from nothing (worker-net#4).
   */
  private solved = new Map<string, { bits: number; nonce: number }>();
  /**
   * Work being solved, by conversation (`keyOf`): the first-contact stamp (`entry` absent: every queued message waits
   * on it) or one message's post, at `bits`. The thread says about how long it takes.
   */
  private work = new Map<string, { entry?: number; bits: number }>();
  /** How long a stamp attempt takes here (ns), measured over the slices solved; §17.3's Chrome worker figure first. */
  private attemptNs = 440;
  /** The networks swept, each with the unlock it was swept in (`sweep`). */
  private swept = new Set<string>();
  /** The networks whose relay didn't answer their last read: the screens say messages wait (`overview`). */
  private offline = new Set<NetworkName>();
  /** The networks this service saw the relay stop (W15): the next page read tells open pages it answers again. */
  private paused = new Set<NetworkName>();
  private constants?: MessagingConstants;
  /** Reveal checks running, by conversation (`keyOf`): two presses are one check (`checkReveals`). */
  private checks = new Map<string, Promise<void>>();
  /** The conversations whose reveals the chain is being read for (`keyOf`): their thread says so. */
  private checking = new Set<string>();
  /** What runs in the background: stamps being solved, posts, takes. */
  private background = new Set<Promise<unknown>>();
  /**
   * The networks whose bookkeeping found no room (W11): a write that would cross the storage area's reserve, or that
   * the browser refused. Messages stops taking there until room is made; the overview says so.
   */
  private full = new Set<NetworkName>();
  /**
   * What each network's Messages records take as stored (W7, W11), as this service last read or wrote them, in the
   * unlock `sizesAt`: `inbox`, its inbox as stored; `lean`, its inbox as it would be without the requests, which have a
   * room of their own; `total`, the lean inbox and each conversation's record together, what the budget counts.
   */
  private sizes = new Map<NetworkName, { total: number; inbox: number; lean: number }>();
  private sizesAt?: number;
  /** Each mark record's writes, one after another (W9). */
  private markWrites = new Map<RecordName, Promise<void>>();
  /** Whether each mark record holds a step, as this service last wrote it; unknown before its first write. */
  private marked = new Map<RecordName, boolean>();
  /** The page whose envelopes the next read scans one at a time, by network: Try again after a scan trapped (W9). */
  private oneByOne = new Map<NetworkName, PageSpan>();
  /** Conversations deleted while this worker runs (`keyOf`): posting stops at one without reading the inbox again. */
  private removed = new Set<string>();
  /** When each network was last expired (ms), without session storage. */
  private expired = new Map<NetworkName, number>();
  /** The relay's holds (`hold`), without session storage. */
  private holds = new Map<string, Partial<Record<NetworkName, number>>>();

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
   * unlocked; off, nothing more reaches the relay, and what the wallet holds stays. Refused while locked, changing
   * nothing (cross-feature#11): the switch is the user's, asked from an unlocked wallet's page.
   */
  async switch(network: NetworkName, on: boolean): Promise<void> {
    if ((await this.deps.wallet.state()) !== "unlocked") throw new WalletLocked(t("worker.wallet.locked"));
    // This network's switch alone: the settings' writes are one at a time (preferences.ts `set`), the other kept.
    const switches = (await this.deps.preferences.set({ messaging: { [network]: on } as never })).messaging;
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
    const [switches, inbox, stopped, paused, resting, takes] = await Promise.all([
      this.deps.preferences.get().then((p) => p.messaging),
      this.inbox(network),
      this.isStopped(network),
      this.heldUntil(SESSION_PAUSED, network, PAUSED_ASK_MS),
      this.heldUntil(SESSION_READ_AFTER, network, DAY_READ_MAX_MS),
      this.takesNow(network),
    ]);
    const on = switches[network];
    // The build's other networks whose pools the worker reads too, whichever the wallet shows (call 9, docs-claims#3).
    const alsoOn = this.networks().filter((n) => n !== network && switches[n]);
    const now = this.deps.now();
    const conversations: MessagingConversation[] = Object.entries(inbox.conversations)
      .map(([cid, meta]) => this.summary(cid, meta, now))
      .sort((a, b) => b.lastAt - a.lastAt);
    // What the list shows of each request is kept with the record: nothing parses it (W7).
    const requests = Object.entries(inbox.requestsShown)
      .map(
        ([cid, r]): MessagingRequest => ({
          cid,
          startedAt: r.t * 1000,
          to: r.to,
          ...(r.continues ? { continues: r.continues } : {}),
          messages: r.messages,
          lastAt: r.last * 1000,
          unread: inbox.requestsUnread[cid] ?? 0,
        }),
      )
      .sort((a, b) => b.lastAt - a.lastAt);
    const seedelfs = await this.seedelfsOf(network, inbox);
    // What wasn't kept, apart (the 1.10.0 gate's f5): messages there was no room for, which deleting a conversation
    // makes room for; and the key's envelopes dropped unopened, which may be anyone's, and which nothing brings back.
    const dropped = (inbox.dropped ?? 0) + takes.noRoom;
    const gapAt = takes.gapAt ?? inbox.gapAt;
    // How far this device's clock is off the relay's, in hours, as the last fresh post measured it (W14): said only past
    // half an hour, where first messages start to go unread.
    const off = inbox.clock?.off;
    return {
      on,
      conversations,
      requests,
      ...(gapAt !== undefined ? { gapAt } : {}),
      ...(on && paused !== undefined ? { paused: true as const } : on && this.offline.has(network) ? { offline: true as const } : {}),
      // This address read its day's share of the pool (W16): no new messages are read until then; sending goes on.
      ...(on && paused === undefined && resting !== undefined ? { dayReadUntil: resting } : {}),
      ...(alsoOn.length ? { alsoOn } : {}),
      ...(seedelfs.length ? { seedelfs } : {}),
      ...(this.full.has(network) ? { full: true as const } : {}),
      ...(stopped ? { stopped: true as const } : {}),
      ...(dropped > 0 ? { dropped } : {}),
      ...(takes.unopened > 0 ? { droppedUnread: takes.unopened } : {}),
      ...(off !== undefined && Math.abs(off) > CLOCK_OFF_MS ? { clockOff: Math.round(off / 360_000) / 10 } : {}),
    };
  }

  /** A conversation's messages, which are then read. Throws if locked. */
  thread(network: NetworkName, cid: string): Promise<MessagingThread> {
    return this.serial(async () => {
      const inbox = await this.inbox(network);
      const meta = inbox.conversations[cid];
      if (!meta) throw new Error(t("worker.messaging.noConversation"));
      const file = await this.fileFor(network, inbox, meta);
      if (!file) throw new Error(t("worker.messaging.noConversation"));
      const info = await this.infoFor(network, inbox, meta, file.state);
      // It opens and reads: whatever kept it from that before is past.
      const wasUnreadable = !!meta.unreadable;
      delete meta.unreadable;
      // What's left of the writer's own share, from the record now (W17): one the inbox lost count of is set right.
      const share = shareOf(info.firstContactLeft, file.history);
      const shareMoved = !sameShare(share, meta.firstContactLeft);
      if (share) meta.firstContactLeft = share;
      else delete meta.firstContactLeft;
      if (meta.unread || unreadIn(file, meta.readTo) || wasUnreadable || shareMoved) {
        meta.unread = 0;
        meta.readTo = file.next;
        await this.writeInbox(network, inbox, { kind: "bookkeeping" });
        // Read now: the top bar's count and Home's row change with it. Only then, so a page that reads the thread
        // again when told isn't told again.
        this.deps.changed?.(network);
      }
      // Where this wallet wrote first and has a reply, the Seedelfs it can show (§19): those it made or the user turned
      // on (W8), from what the wallet holds, with no request.
      const seedelfs = meta.role === "initiator" && !info.sendsFirstContact ? (await this.handlesNow(network, inbox)).shown : undefined;
      const now = this.deps.now();
      const key = keyOf(network, cid);
      const work = this.work.get(key);
      const seconds = work && Math.max(1, Math.round((2 ** work.bits * this.attemptNs) / 1e9));
      // Each waiting message's next try: its size's wait, or every post's (W5), kept on the monotonic clock and said on
      // this device's (W14). The thread's is the soonest.
      const mono = this.mono();
      const tries = file.history.map((e) => {
        if (e.sent !== "pending" || !e.envelope) return undefined;
        const until = this.waitFor(network, e.envelope);
        return until > mono ? now + (until - mono) : undefined;
      });
      const soonest = tries.reduce<number | undefined>((min, at) => (at !== undefined && (min === undefined || at < min) ? at : min), undefined);
      const checking = this.checking.has(key);
      return {
        conversation: this.summary(cid, meta, now),
        messages: file.history.map((e, i) => {
          const view = entryView(e, { checking, nextTry: tries[i] });
          const solving = work && (work.entry === undefined ? e.sent === "queued" : work.entry === e.id && e.sent === "pending");
          return solving ? { ...view, working: { seconds: seconds! } } : view;
        }),
        ...(soonest !== undefined ? { nextTry: soonest } : {}),
        trimmed: file.trimmed,
        missing: info.missing,
        // The largest envelope's room, and before a reply the share's, the texts still waiting counted (W17).
        maxTextBytes: Math.min(Math.max(0, info.maxTextLen - 1), share?.bytes ?? Number.POSITIVE_INFINITY),
        ...(seedelfs?.length ? { seedelfs } : {}),
      };
    });
  }

  /** A request's messages, decrypted to show them; nothing changes but that they're read. Throws if locked. */
  request(network: NetworkName, cid: string): Promise<MessagingEntry[]> {
    return this.serial(async () => {
      const inbox = await this.inbox(network);
      if (!inbox.requests || !inbox.requestsShown[cid]) throw new Error(t("worker.messaging.noRequest"));
      const requests = inbox.requests;
      const read = await this.recordsCall(
        network,
        inbox,
        () =>
          this.withKey((key) =>
            this.parse<{ messages: Array<{ at: number; plaintext?: string; refused?: string }> }>(
              this.deps.wasm.messagingReadRequest(key, JSON.stringify({ requests, cid })),
            ),
          ),
        isRecordRefusal,
      );
      if (isRefused(read)) throw new Error(t("worker.messaging.noRequest"));
      if (inbox.requestsUnread[cid]) {
        delete inbox.requestsUnread[cid];
        await this.writeInbox(network, inbox, { kind: "bookkeeping" });
        this.deps.changed?.(network);
      }
      // A control kind this version doesn't know shows nothing (W15).
      return read.messages.flatMap((m, i) => {
        const shown = m.plaintext !== undefined ? textOf(m.plaintext) : { kind: -1 };
        return shown ? [entryView({ id: i, dir: "in", at: m.at * 1000, ...shown })] : [];
      });
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
      // F's t: this device's clock, rounded down (W14), never the relay's.
      const startT = tOf(now);
      const started = await this.withKey((key, keys) => {
        pin(keys);
        return this.parse<{ cid: string; conversation: string; digest: string }>(
          this.deps.wasm.messagingStart(key, JSON.stringify({ handle: register, to: name, now: startT })),
        );
      });
      if (isRefused(started)) {
        if (started.refused === "own_register") throw new Error(t("worker.messaging.ownSeedelf"));
        throw new MessagingRefused(started.refused);
      }
      this.checkLength(started.conversation, text);
      const file: ConversationFile = {
        v: 2,
        state: started.conversation,
        stampDigest: started.digest,
        history: [{ id: 0, dir: "out", at: now, text, sent: "queued" }],
        next: 1,
        trimmed: 0,
      };
      const inbox = await this.inbox(network);
      await this.addConversation(network, inbox, started.cid, file, {
        role: "initiator",
        handle: name,
        startedAt: startT * 1000,
        lastAt: now,
        unread: 0,
        readTo: 0,
        // Started again to the same Seedelf: the user's name for it goes on.
        ...(replacing && inbox.conversations[replacing]?.name ? { name: inbox.conversations[replacing]!.name } : {}),
      });
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
      const old = meta && (await this.fileFor(network, inbox, meta));
      if (!meta || !old) throw new Error(t("worker.messaging.noConversation"));
      const now = this.deps.now();
      const startT = tOf(now);
      const started = await this.withKey((key, keys) => {
        pin(keys);
        return this.parse<{ cid: string; conversation: string; digest: string }>(
          this.deps.wasm.messagingStartContinuing(key, JSON.stringify({ conversation: old.state, now: startT })),
        );
      });
      if (isRefused(started)) throw new MessagingRefused(started.refused);
      this.checkLength(started.conversation, text);
      const file: ConversationFile = {
        v: 2,
        state: started.conversation,
        stampDigest: started.digest,
        history: [{ id: 0, dir: "out", at: now, text, sent: "queued" }],
        next: 1,
        trimmed: 0,
      };
      await this.addConversation(network, inbox, started.cid, file, {
        role: "initiator",
        ...(meta.handle ? { handle: meta.handle } : {}),
        ...(meta.to ? { to: meta.to } : {}),
        continues: { cid, verified: true },
        startedAt: startT * 1000,
        lastAt: now,
        unread: 0,
        readTo: 0,
        ...(meta.name ? { name: meta.name } : {}),
      });
      meta.restartedAs = started.cid;
      await this.writeInbox(network, inbox);
      return started.cid;
    });
    this.deps.changed?.(network);
    this.behind(this.stamp(network, next));
    return next;
  }

  /**
   * Sends `text` in conversation `cid`: sealed now, posted at once. Written first and not yet answered, it's refused
   * before it's queued where the writer's own share of first messages has no room for it, the texts still queued
   * counted (W17): in words, and nothing of it kept. Throws if locked.
   */
  async send(network: NetworkName, cid: string, text: string): Promise<void> {
    this.checkText(text);
    await this.serial(async () => {
      const inbox = await this.inbox(network);
      const meta = inbox.conversations[cid];
      const file = meta && (await this.fileFor(network, inbox, meta));
      if (!meta || !file) throw new Error(t("worker.messaging.noConversation"));
      const { maxTextLen, firstContactLeft } = await this.infoFor(network, inbox, meta, file.state);
      // What a reader keeps of a stranger's before replying (DESIGN-protocol §3.5): used up, the next text waits for a
      // reply; with room, a text past it is too long, by what's left.
      const share = shareOf(firstContactLeft, file.history);
      if (share?.messages === 0) throw new ShareUsedUp();
      this.checkFits(share ? Math.min(maxTextLen, share.bytes + 1) : maxTextLen, text);
      const now = this.deps.now();
      const entry: Entry = { id: file.next++, dir: "out", at: now, text, sent: "queued" };
      file.history.push(entry);
      // Before its stamp, a first-contact message waits: it's sealed with the others once the stamp is set. After it,
      // it's sealed now, behind any text still queued from then (W13), in order.
      const refused = file.stampDigest ? undefined : this.sealQueued(file);
      // The crate's own word for the share used up: never the server's, and nothing of it is kept.
      if (refused === "request_full") throw new ShareUsedUp();
      meta.lastAt = now;
      // Kept once its record is written, which the post reads (f4): an inbox write refused after it refuses nothing.
      await this.commit(network, inbox, cid, file, "content", undefined, true);
    });
    this.deps.changed?.(network);
    this.behind(this.post(network));
  }

  /**
   * Sends message `id` of conversation `cid` again: the same bytes, which the server refused (a 400 or a 413, from the
   * relay or from something on the way, worker-net#8), posted once more. The ratchet doesn't step: it's the envelope
   * sealed the first time. Anything else (one posted meanwhile, one the wallet couldn't seal, with no bytes) is left
   * as it is. Throws if locked.
   */
  async resend(network: NetworkName, cid: string, id: number): Promise<void> {
    const again = await this.serial(async () => {
      const inbox = await this.inbox(network);
      const meta = inbox.conversations[cid];
      const file = meta && (await this.fileFor(network, inbox, meta));
      if (!meta || !file) throw new Error(t("worker.messaging.noConversation"));
      const entry = file.history.find((e) => e.id === id);
      if (entry?.sent !== "refused" || !entry.envelope) return false;
      entry.sent = "pending";
      await this.commit(network, inbox, cid, file, "bookkeeping", undefined, true);
      return true;
    });
    if (!again) return;
    this.deps.changed?.(network);
    this.behind(this.post(network));
  }

  /**
   * Shows the other side of conversation `cid` this wallet's Seedelf `name` (asset name, hex), in a message of its own
   * (protocol.md §19): only where this wallet wrote first, once a reply has come, and only a Seedelf this browser put
   * at the register a contract read finds it at now, or one the user turned on there (W8). That register is what the
   * reader's check compares, and the read names no Seedelf. Throws if locked.
   */
  async reveal(network: NetworkName, cid: string, name: string): Promise<void> {
    const own = await this.deps.ownSeedelfs(network, true);
    const register = own?.find((s) => s.name === name)?.register;
    if (!register) throw new Error(t("worker.messaging.notYourSeedelf"));
    // A pair, never a name alone: one the chain now shows under another register (a sum someone minted, or a chain
    // source that says so) isn't the one this browser put it under, nor one the user turned on.
    if (!(await this.showsAt(network, await this.inbox(network), name, register))) throw new Error(t("worker.messaging.notYourSeedelf"));
    await this.serial(async () => {
      const pin = phrasePin();
      const inbox = await this.inbox(network);
      const meta = inbox.conversations[cid];
      const file = meta && (await this.fileFor(network, inbox, meta));
      if (!meta || !file) throw new Error(t("worker.messaging.noConversation"));
      const made = await this.withKey((key, keys) => {
        pin(keys);
        return this.parse<{ reveal: string }>(
          this.deps.wasm.messagingReveal(key, JSON.stringify({ conversation: file.state, name, register })),
        );
      });
      if (isRefused(made)) {
        if (made.refused === "reveal_not_allowed") throw new Error(t("worker.messaging.cantRevealYet"));
        if (made.refused === "not_for_this_key") throw new Error(t("worker.messaging.notYourSeedelf"));
        throw new MessagingRefused(made.refused);
      }
      const now = this.deps.now();
      // Behind any text still queued (W13), in order.
      const earlier = this.sealQueued(file);
      if (earlier === "request_full") throw new ShareUsedUp();
      const entry: Entry = { id: file.next++, dir: "out", at: now, kind: KIND_REVEAL, reveal: { dir: "out", name }, sent: "queued" };
      file.history.push(entry);
      const refused = this.sealPlaintext(file, entry, revealPlaintextOf(made.reveal));
      if (refused === "request_full") throw new ShareUsedUp();
      meta.lastAt = now;
      await this.commit(network, inbox, cid, file, "content", undefined, true);
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
      const info = inbox.requestsShown[cid];
      if (!requests || !info) throw new Error(t("worker.messaging.noRequest"));
      const asked = JSON.stringify({ requests, cid });
      const [read, accepted] = await this.recordsCall(
        network,
        inbox,
        () =>
          this.withKey((key, keys) => {
            pin(keys);
            return [
              this.parse<{ messages: Array<{ at: number; plaintext?: string }> }>(this.deps.wasm.messagingReadRequest(key, asked)),
              this.parse<{ conversation: string; requests: string; continues: { cid: string; verified: boolean } | null }>(
                this.deps.wasm.messagingAccept(key, asked),
              ),
            ] as const;
          }),
        ([r, a]) => isRecordRefusal(r) || isRecordRefusal(a),
      );
      if (isRefused(accepted)) throw new MessagingRefused(accepted.refused);
      // Each message as it arrived; one that doesn't read now was refused when it came too, and isn't kept, nor is a
      // control kind this version doesn't know (W15).
      const history: Entry[] = isRefused(read)
        ? []
        : read.messages.flatMap((m, i) => {
            const shown = m.plaintext === undefined ? undefined : textOf(m.plaintext);
            return shown ? [{ id: i, dir: "in" as const, at: m.at * 1000, ...shown }] : [];
          });
      const next = isRefused(read) ? 0 : read.messages.length;
      const file: ConversationFile = { v: 2, state: accepted.conversation, history, next, trimmed: 0 };
      const now = this.deps.now();
      // The request goes as the conversation comes: the budget counts the inbox as it will be.
      inbox.requests = accepted.requests;
      delete inbox.requestsShown[cid];
      delete inbox.requestsUnread[cid];
      await this.addConversation(network, inbox, cid, file, {
        role: "responder",
        ...(info.to ? { to: info.to } : {}),
        ...(accepted.continues ? { continues: accepted.continues } : {}),
        startedAt: info.t * 1000,
        lastAt: history.at(-1)?.at ?? now,
        unread: 0,
        readTo: next,
        // Continuing one this wallet holds, with the same keys (§6): the same other side, so the user's name for it
        // goes on. A continuation only claimed takes none.
        ...(accepted.continues?.verified && inbox.conversations[accepted.continues.cid]?.name
          ? { name: inbox.conversations[accepted.continues.cid]!.name }
          : {}),
      });
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
      await this.writeInbox(network, inbox, { kind: "bookkeeping" });
      this.deps.changed?.(network);
    });
  }

  /**
   * Deletes a conversation or a request: its ID is kept as a tombstone until its `t` + 48 hours and 7 days. One whose
   * record won't open, or that the crate can't read (a development build's, a later version's), is deleted all the
   * same, with no tombstone: its F, and so its t, can't be read (W9, W17). Never refused for room: it only frees some.
   * Throws if locked.
   */
  remove(network: NetworkName, cid: string): Promise<void> {
    return this.serial(async () => {
      const inbox = await this.inbox(network);
      const meta = inbox.conversations[cid];
      const file = meta && !meta.unreadable ? await this.readable(network, meta) : undefined;
      const files = new Map<string, ConversationFile>(file ? [[cid, file]] : []);
      const ask = () =>
        JSON.stringify({
          cid,
          ...(files.has(cid) ? { conversation: files.get(cid)!.state } : {}),
          ...(inbox.requests ? { requests: inbox.requests } : {}),
          ...(inbox.tombstones ? { tombstones: inbox.tombstones } : {}),
        });
      /** The records after the deletion; none where the crate refused a record it was handed, or the bindings threw. */
      const del = () =>
        this.tryOr<{ requests?: string; tombstones?: string } | undefined>(() => {
          const answer = this.parse<{ deleted: boolean; requests: string; tombstones: string }>(
            this.wasmCall(() => this.deps.wasm.messagingDelete(ask())),
          );
          return isRefused(answer) ? undefined : answer;
        }, undefined);
      // A record the crate can't read (W9, W17): set aside, and deleted without it. With nothing to set aside, what's
      // held stays.
      const deleted = del() ?? (this.setAside(inbox, files, true) ? del() : undefined) ?? inbox;
      if (deleted.requests !== undefined) inbox.requests = deleted.requests;
      if (deleted.tombstones !== undefined) inbox.tombstones = deleted.tombstones;
      delete inbox.conversations[cid];
      delete inbox.requestsUnread[cid];
      delete inbox.requestsShown[cid];
      for (const other of Object.values(inbox.conversations)) if (other.restartedAs === cid) delete other.restartedAs;
      await this.writeInbox(network, inbox, { kind: "bookkeeping" });
      if (meta?.id) await this.deps.store.remove(conversationRecord(network, meta.id));
      this.removed.add(keyOf(network, cid));
      this.inboxBehind.get(network)?.delete(cid);
      // Room, maybe: the next take says again.
      this.full.delete(network);
      this.deps.changed?.(network);
    });
  }

  /**
   * Turns first messages at the Seedelf `name` under `register` on or off (W8): on for one this browser didn't make
   * (a wallet restored here, or one someone else minted under the key), as the kept view shows it now; off for any,
   * this browser's own included, which stops first messages to it while what already began there stays (requests
   * already written to it go on taking their writers' messages until deleted). No request. Turned on, the pool is read
   * again from its oldest (W12): the first messages to it still on the relay are taken, and every envelope taken before
   * is refused as a duplicate or by its tombstone. The relay sees a fresh read from this address, which says only that
   * the wallet started over. Returns the overview. Throws if locked.
   */
  async answerAt(network: NetworkName, name: string, register: RegisterHex, on: boolean): Promise<MessagingOverview> {
    if (!isRegister(register)) throw new Error(t("worker.messaging.notYourSeedelf"));
    const pair = { generator: register.generator, publicValue: register.publicValue };
    await this.serial(async () => {
      const inbox = await this.inbox(network);
      if (on) {
        // Only one the kept view has under the key, at that register: a stale page's press changes nothing.
        const view = await this.deps.ownSeedelfs(network, false);
        if (!view?.some((s) => s.name === name && sameRegister(s.register, pair))) throw new Error(t("worker.messaging.notYourSeedelf"));
        // The user's own press lifts a removal's mark (a Remove that never landed) and a pair a view dropped (f6).
        await clearRemoved(this.deps.store, network, name).catch((e: unknown) => {
          if (!(e instanceof UnreadableRecordError)) throw e;
        });
        if (inbox.gone) inbox.gone = inbox.gone.filter((k) => k !== pairKey(name, pair));
      }
      const was = (inbox.handles[name] ?? []).some((r) => sameRegister(r, pair));
      inbox.answerAt = [...(inbox.answerAt ?? []).filter((c) => !(c.name === name && sameRegister(c.register, pair))), { name, register: pair, on }];
      const { handles, seen, gone } = await this.handlesNow(network, inbox);
      inbox.handles = handles;
      inbox.seen = seen;
      if (gone.length) inbox.gone = gone;
      else delete inbox.gone;
      const reread = on && !was;
      if (reread) {
        // From the pool's oldest, before the choice is written (f1): the read rewound, and what's in memory of the reads
        // and any take running forgotten, in one step of the take record's chain, so a read begun before writes nothing
        // and one begun after reads from the oldest. The take of what it finds waits in the queue for the choice below.
        await this.rewind(network);
        // A cursor a build before the take record kept goes with it.
        delete inbox.cursor;
      }
      await this.writeInbox(network, inbox, { kind: "bookkeeping" });
    });
    this.deps.changed?.(network);
    return this.overview(network);
  }

  /**
   * Try again (W9): the sync of a network a trap stopped, with the envelope it trapped on stepped over (kept in the
   * sealed inbox's skip list for SKIP_FOR_MS), or, where a page's scan trapped, that page's envelopes scanned one at a
   * time, each under a mark of its own, so a trap among them names the one. So one bad envelope costs a lock by itself
   * and at most one more at the user's press. Throws if locked.
   */
  async retry(network: NetworkName): Promise<void> {
    if ((await this.deps.wallet.state()) !== "unlocked") throw new WalletLocked(t("worker.wallet.locked"));
    if (await this.isStopped(network)) {
      // Only the step that trapped (W13): a take that ran beside a scan that trapped is no part of it, nor the other way.
      const trapped = await this.deps.local.get<unknown>(trapKey(network));
      const markOf = <T>(step: MarkStep) =>
        this.deps.store.get<T>(markRecord(network, step)).catch((e: unknown) => {
          if (e instanceof UnreadableRecordError) return undefined;
          throw e;
        });
      // A flag from before W13 said `true`, not which: the take's, then the scan's, as then.
      const take = trapped === "scan" ? undefined : await markOf<TakeMark>("take");
      const scan = trapped === "take" ? undefined : await markOf<ScanMark>("scan");
      const envelope = take?.envelope ?? scan?.envelope;
      if (envelope) {
        await this.serial(async () => {
          const inbox = await this.inbox(network);
          const now = this.deps.now();
          inbox.skip = [...(inbox.skip ?? []).filter((s) => s.until > now && s.envelope !== envelope), { envelope, until: now + SKIP_FOR_MS }];
          await this.writeInbox(network, inbox, { kind: "bookkeeping" });
        });
      } else if (scan?.page) {
        this.oneByOne.set(network, scan.page);
      }
      for (const step of ["scan", "take"] as const) {
        await this.deps.store.set(markRecord(network, step), {});
        this.marked.set(markRecord(network, step), false);
      }
      await this.deps.local.remove(trapKey(network));
      this.deps.changed?.(network);
    }
    await this.sync(network);
  }

  /**
   * Starts `network`'s Messages again (W9): its inbox and every conversation's record deleted, with no key needed: for
   * an inbox that won't open, whose page asks first. What was being read or taken there is dropped, and a take running
   * stops before its next write (W13). Returns the overview. Throws if locked.
   */
  async clear(network: NetworkName): Promise<MessagingOverview> {
    if ((await this.deps.wallet.state()) !== "unlocked") throw new WalletLocked(t("worker.wallet.locked"));
    this.forget(network);
    await this.serial(async () => {
      const records = await this.deps.local.keys(PRIVATE_PREFIX + CONVERSATION_RECORDS + network + ".");
      await this.deps.local.remove(
        PRIVATE_PREFIX + `messaging.${network}`,
        PRIVATE_PREFIX + takeRecord(network),
        PRIVATE_PREFIX + markRecord(network, "scan"),
        PRIVATE_PREFIX + markRecord(network, "take"),
        trapKey(network),
        ...records,
      );
    });
    // And again in the take record's chain, after any write of it that began before the epoch moved: none outlives this.
    await this.onTakes(network, async () => {
      await this.deps.local.remove(PRIVATE_PREFIX + takeRecord(network));
      this.forget(network);
    });
    this.forget(network);
    this.full.delete(network);
    this.offline.delete(network);
    this.sizes.delete(network);
    this.inboxBehind.delete(network);
    for (const step of ["scan", "take"] as const) this.marked.set(markRecord(network, step), false);
    this.oneByOne.delete(network);
    this.deps.changed?.(network);
    return this.overview(network);
  }

  /**
   * Forgets what's in memory of `network`'s reads, and stops any take of it before its next write (its epoch moves, W12,
   * W13): the next read goes on from the cursor the take record keeps, and the next take from what it holds.
   */
  private forget(network: NetworkName): void {
    this.epochs.set(network, this.epochOf(network) + 1);
    this.takes.delete(network);
    this.ownDue.delete(network);
  }

  private epochOf(network: NetworkName): number {
    return this.epochs.get(network) ?? 0;
  }

  /**
   * Reads `network`'s pool again from its oldest (W12; the 1.10.0 gate's f1 and finding 8): the take record's cursor
   * and what it held for the take go, in one write in its chain, its counts staying; then what's in memory of the reads,
   * and any take running, go too (`forget`), in the same step. A read begun before writes nothing after it.
   */
  private rewind(network: NetworkName): Promise<void> {
    return this.onTakes(network, async () => {
      const held = await this.takesOf(network);
      const { cursor: _cursor, ...kept } = held;
      await this.writeTakes(network, held, { ...kept, batches: [] });
      this.forget(network);
    });
  }

  // -------------------------------------------------------------------------
  // Syncing
  // -------------------------------------------------------------------------

  /**
   * Reads `network`'s pool from where the last read ended, then posts what's waiting; what the read found is taken in
   * the background, after any take still running (`take`). One at a time per network: asked during one, it's that one,
   * and nothing runs again after it, so the next read comes at the next tick (W4). Nothing while the switch is off or
   * the wallet is locked, and nothing by itself once a step of the network trapped: only Try again (`retry`, W9).
   */
  sync(network: NetworkName): Promise<void> {
    return this.join(this.syncs, network, async () => {
      if (await this.isStopped(network)) return;
      await this.syncNow(network);
    });
  }

  /**
   * Syncs every network of `networks` whose switch is on: the alarm's run, and the unlock's. The alarm stops while
   * the wallet is locked or no switch is on, and the unlock starts it again. A network whose switch is off is tidied
   * with no request: what only a sync cleans up (skipped keys past their 48 hours, tombstones past their t + 48 hours
   * and 7 days, a record a stop left behind) goes all the same (worker-state#12).
   */
  async syncAll(networks: readonly NetworkName[]): Promise<void> {
    const switches = (await this.deps.preferences.get()).messaging;
    const unlocked = (await this.deps.wallet.state()) === "unlocked";
    const on = networks.filter((n) => switches[n]);
    if (!on.length || !unlocked) await this.deps.alarm?.stop();
    else {
      await this.deps.alarm?.start();
      // The reads first, at the tick: nothing local of another network's comes before them (W13).
      await Promise.all(on.map((n) => this.sync(n).catch(rethrowTrap)));
    }
    if (unlocked) {
      for (const n of networks) if (!switches[n]) await this.tidy(n).catch(rethrowTrap);
    }
  }

  /** A network whose Messages are off, where it holds anything: its sweep and its expiry, local work only. */
  private async tidy(network: NetworkName): Promise<void> {
    const inbox = (await this.deps.store.sealedAs(`messaging.${network}`)) !== undefined;
    const records = (await this.deps.local.keys(PRIVATE_PREFIX + CONVERSATION_RECORDS + network + ".")).length > 0;
    if (!inbox && !records) return;
    await this.sweep(network);
    // Expiring writes the inbox: a network that has none gains none.
    if (inbox) await this.expire(network);
  }

  private async syncNow(network: NetworkName): Promise<void> {
    if (!(await this.isOn(network))) return;
    if ((await this.deps.wallet.state()) !== "unlocked") return;
    // Bound to the phrase now, before anything is asked: a wallet removed and another restored while the first page
    // is on its way gets nothing of this one's (worker-state#8).
    const pin = phrasePin();
    await this.withKey((_key, keys) => pin(keys));
    // 1. The read: pages and the scan, nothing else. Not while the relay is stopped (W15) but once an hour, nor while
    // this address has read its day's share of the pool (W16).
    const paused = await this.heldUntil(SESSION_PAUSED, network, PAUSED_ASK_MS);
    const resting = await this.heldUntil(SESSION_READ_AFTER, network, DAY_READ_MAX_MS);
    if (paused === undefined && resting === undefined) await this.readPool(network, pin);
    try {
      // What the first sync of an unlock repairs, before the outbox is read: a message the inbox lost count of goes now.
      await this.sweep(network, pin);
      // 2. What's waiting, right after the read and before anything it found is taken: no request goes as a take ends.
      // While the relay is stopped nothing is solved or posted (W15).
      if ((await this.heldUntil(SESSION_PAUSED, network, PAUSED_ASK_MS)) === undefined) {
        this.resumeStamps(network, await this.inbox(network));
        await this.post(network);
      }
    } finally {
      // 3. The take, in the background, of whatever the take record holds: no sync waits for it, and none follows it.
      // Started whatever became of the posts, and whether or not this tick read: what a lock or a stop left in the record
      // is taken asking no page again (finding 8).
      this.take(network);
    }
    this.behind(this.expire(network));
  }

  /**
   * Until when (ms, this device's clock) a hold kept in session storage under `key` holds `network` (the relay stopped,
   * W15; the day's reading, W16), or undefined when none does. One further off than `most` is a clock set back since:
   * it holds no more. A lock clears them all.
   */
  private async heldUntil(key: string, network: NetworkName, most: number): Promise<number | undefined> {
    const session = this.deps.session;
    const kept = session ? await session.get<Partial<Record<NetworkName, number>>>(key).catch(() => undefined) : this.holds.get(key);
    const until = kept?.[network];
    const now = this.deps.now();
    return until !== undefined && until > now && until - now <= most ? until : undefined;
  }

  /** Holds `network` under `key` until `until` (ms), or lets it go (undefined): in session storage, else in memory. */
  private async hold(key: string, network: NetworkName, until: number | undefined): Promise<void> {
    const session = this.deps.session;
    const kept = (session ? await session.get<Partial<Record<NetworkName, number>>>(key).catch(() => undefined) : this.holds.get(key)) ?? {};
    if (until === undefined && kept[network] === undefined) return;
    const next = { ...kept };
    if (until === undefined) delete next[network];
    else next[network] = until;
    if (session) await session.set(key, next).catch(() => undefined);
    else this.holds.set(key, next);
  }

  /**
   * Reads `network`'s pool from where the last read ended (W4, W10): at most PAGES_A_SYNC pages, one after the other,
   * whatever they hold, and the scan of each, which costs the same for every envelope. The key's envelopes are kept
   * aside for the take, each once: nothing is opened or read from a record between two page requests. Before each
   * page's scan its mark is written, the same for every page (W9); envelopes Try again steps over are passed over
   * unscanned, and after a scan trapped, that page's are scanned one at a time. Stops where the pool says nothing
   * follows, at a page that moves nothing (a relay that isn't §17's), at a page that doesn't read (the pages before it
   * are taken all the same), or after PAGES_A_SYNC pages: with `more` still set, the rest is read at the next tick.
   * Never stopped, skipped or cut short by what the pages held, or by how far the takes are behind (TAKES_BEHIND).
   * Where the read ended, and what it found, go into the take record after the last page (`noteRead`, finding 8).
   */
  private async readPool(network: NetworkName, pin: PhrasePin): Promise<void> {
    // The epoch now: a rewind, or Messages started again, before this read's end is written has it write nothing (f1).
    const epoch = this.epochOf(network);
    // Read once, before the first page: what Try again steps over, and where the last read ended.
    const inbox = await this.inbox(network);
    const takes = await this.takesFor(network, pin);
    // On from where the last read ended, as the take record keeps it, whatever the takes did since (finding 8); before
    // there's one, from where an inbox from before it kept.
    const from = takes.stored ? takes.cursor : inbox.cursor;
    const now = this.deps.now();
    const skip = new Set((inbox.skip ?? []).filter((s) => s.until > now).map((s) => s.envelope));
    const relay = this.deps.relay(network);
    const step: Step = { trapped: false };
    /**
     * The key's envelopes, in the order they came: each envelope scanned is written at `kept`, which its digit moves on
     * past a match, so what's kept takes no branch on which matched (W17, scan-timing#1). One served twice is kept
     * twice, and taken once (`takeAll`).
     */
    const found: string[] = [];
    let kept = 0;
    let cursor = from;
    let gap = false;
    let marked = false;
    let alone = false;
    /** The scan's mark, before a scan; where the area has no room for it, the scan goes on without one (W11). */
    const mark = (part: ScanMark) =>
      this.setMark(network, "scan", part, pin).catch((e: unknown) => {
        if (!(e instanceof MessagingFull)) throw e;
      });
    try {
      for (let pages = 0; pages < PAGES_A_SYNC; pages++) {
        let page: RelayPage;
        try {
          // Asked again before each page: a switch turned off, or a lock, mid-catch-up stops it there.
          page = await relay.page(cursor, () => this.mayAsk(network));
        } catch (e) {
          await this.relayRefused(network, e);
          if (e instanceof RelayDown) break;
          throw e;
        }
        // Answering again, or again after a stop (W15): said at once, not at the take's end, which a later failure could
        // keep from coming.
        const answering = this.offline.delete(network);
        if (this.paused.delete(network) || answering) this.deps.changed?.(network);
        this.prices.set(network, page.prices);
        const asked = cursor;
        const envelopes = skip.size ? page.envelopes.filter((e) => !skip.has(envelopeHash(e))) : page.envelopes;
        if (envelopes.length && this.scansAlone(network, asked, page.cursor)) {
          // After a scan trapped here: each envelope alone, under a mark naming it, so a trap names the one (W9).
          alone = true;
          for (const envelope of envelopes) {
            marked = true;
            await mark({ envelope: envelopeHash(envelope) });
            const bits = await this.scan(step, pin, [envelope]);
            found[kept] = envelope;
            kept += bits.charCodeAt(0) - 48;
            await this.wait();
          }
        } else if (envelopes.length) {
          // The page's mark, before its scan: the same for every page that holds envelopes, whoever they are for.
          marked = true;
          await mark({ page: { ...(asked !== undefined ? { from: asked } : {}), to: page.cursor } });
          for (let at = 0; at < envelopes.length; at += SCAN_BATCH) {
            const batch = envelopes.slice(at, at + SCAN_BATCH);
            const bits = await this.scan(step, pin, batch);
            for (let i = 0; i < batch.length; i++) {
              found[kept] = batch[i]!;
              kept += bits.charCodeAt(i) - 48;
            }
            await this.wait();
          }
        }
        cursor = page.cursor;
        // A gap is envelopes lost after a cursor of the wallet's own (§17.5): a read that began with none had nothing of
        // the wallet's to lose (relay-server#7).
        if (page.gap && from !== undefined) gap = true;
        // A page that says more follows but moved nothing is a relay that isn't §17's: the read stops there.
        if (!page.more || page.cursor === asked) break;
      }
    } catch (e) {
      if (step.trapped) await this.noteTrap(network, "scan");
      throw e;
    } finally {
      if (!step.trapped) {
        // The one-at-a-time scan Try again asked for is done once a read has made it, or has gone past that page.
        const span = this.oneByOne.get(network);
        if (span && (alone || pastSpan(cursor, span))) this.oneByOne.delete(network);
        // The scan's mark goes with it, once the read has ended: never between two pages.
        if (marked) await this.setMark(network, "scan", undefined).catch(() => undefined);
      }
    }
    // What followed the last match was written over, or was none: gone.
    found.length = kept;
    // A read that moved nothing and found nothing writes nothing.
    if (cursor === undefined || (cursor === from && !found.length && !gap)) return;
    await this.noteRead(network, epoch, pin, found, cursor, gap);
  }

  /**
   * Where a read ended, and what it found for the take (finding 8): one write of the take record, in its chain, never
   * behind the queue, after the read's last page. The next read goes on from there whatever the takes do, a lock and a
   * stop included. Its envelopes go in as a read of their own, each once and none another read waiting holds (a read
   * made again after a stop finds them again); past TAKES_BEHIND reads or TAKE_BYTES, the oldest read waiting goes, then
   * the newest keeps what fits, each envelope left out counted (`unopened`, f5). Where the area's reserve or the browser
   * has no room for them, the cursor is written all the same, with that read's envelopes counted as not kept (`noRoom`),
   * and Messages stop taking until room is made (W11). A read begun before a rewind, or before Messages were started
   * again, writes nothing.
   */
  private noteRead(network: NetworkName, epoch: number, pin: PhrasePin, found: string[], cursor: string, gap: boolean): Promise<void> {
    return this.onTakes(network, async () => {
      if (this.epochOf(network) !== epoch) return;
      // The phrase the read began under: one removed and another restored meanwhile gets nothing of the first's.
      await this.withKey((_key, keys) => pin(keys));
      const held = await this.takesOf(network, pin);
      const waiting = new Set(held.batches.flatMap((b) => b.envelopes));
      const fresh = [...new Set(found)].filter((e) => !waiting.has(e));
      const moved: Takes = { ...held, cursor, ...(gap ? { gapAt: this.deps.now() } : {}) };
      const next: Takes = { ...moved, batches: [...held.batches] };
      if (fresh.length) {
        next.batches.push({ envelopes: fresh, pin });
        bounded(next, this.deps.takeBytes ?? TAKE_BYTES);
      }
      try {
        await this.writeTakes(network, held, next);
      } catch (e) {
        if (!(e instanceof MessagingFull)) throw e;
        // No room to keep them (W11; `put` has stopped the taking): the cursor goes on all the same, whatever they were.
        await this.writeTakes(network, held, { ...moved, noRoom: moved.noRoom + fresh.length });
      }
      // Which Seedelfs take first messages is set at the take's next look (`noteOwn`), whatever this read found.
      this.ownDue.set(network, pin);
    });
  }

  /**
   * What a relay that didn't give a page means (W5, W15, W16): its off switch holds the network an hour (a lock lets it
   * go); its day's reading holds this pool's pages as long as it says; the edge's busy answer, a second, says nothing;
   * any other is a relay that didn't answer, which the screens say. One the wallet chose not to ask is none of these.
   */
  private async relayRefused(network: NetworkName, e: unknown): Promise<void> {
    if (!(e instanceof RelayDown) || e instanceof RelayNotAsked || e instanceof RelayBusy) return;
    if (e instanceof RelayStopped) {
      await this.hold(SESSION_PAUSED, network, this.deps.now() + PAUSED_ASK_MS);
      this.paused.add(network);
      this.offline.delete(network);
      this.deps.changed?.(network);
      return;
    }
    if (e instanceof RelayDayRead) {
      await this.hold(SESSION_READ_AFTER, network, this.deps.now() + e.retryAfterMs);
      return;
    }
    if (!this.offline.has(network)) {
      this.offline.add(network);
      this.deps.changed?.(network);
    }
  }

  /**
   * Which of `batch`'s envelopes are the key's (`messagingScan`), under `pin`, a trap in it `step`'s: one digit an
   * envelope, in order, `1` for the key's, as long as the batch whatever matched (W17, scan-timing#1). Any other answer
   * is another build's module's (one before call 16 gave the matches' indexes, as JSON): nothing of it is kept, and the
   * read stops there.
   */
  private scan(step: Step, pin: PhrasePin, batch: string[]): Promise<string> {
    return this.withKey((key, keys) => {
      pin(keys);
      const bits = String(this.watch(step, () => this.deps.wasm.messagingScan(key, JSON.stringify(batch))));
      if (bits.length !== batch.length || !/^[01]*$/.test(bits)) {
        throw new Error("the scan didn't answer a digit an envelope: another build's WebAssembly module");
      }
      return bits;
    });
  }

  /** Whether the page of envelopes after `asked` up to `to` is one Try again scans one at a time (W9). */
  private scansAlone(network: NetworkName, asked: string | undefined, to: string): boolean {
    const span = this.oneByOne.get(network);
    if (!span) return false;
    try {
      const after = (c: string | undefined) => (c === undefined ? -1n : BigInt(c));
      return after(asked) < BigInt(span.to) && BigInt(to) > after(span.from);
    } catch {
      return asked === span.from;
    }
  }

  /** Takes what `network`'s take record holds, in order, in the background, after any take still running (W4). */
  private take(network: NetworkName): void {
    if (this.taking.has(network)) return;
    this.taking.add(network);
    this.behind(this.takeAll(network));
  }

  /**
   * Each read's envelopes the take record holds, in turn (finding 8): the registers the wallet's Seedelfs take first
   * messages at now (`noteOwn`, no request), every envelope in the queue, each under a mark naming it (W9), with a turn of
   * the event loop between them (W10), then that read's envelopes gone from the record, once. One envelope whose take
   * throws is passed over without a word (W3, W9), but a read of storage that failed under it, tried again in place
   * first (TAKE_RETRIES, f2); and one with no room is counted and passed over (`noRoom`, W11): the rest goes on. A lock,
   * another phrase, a trap, or a record that won't open stops it all: what isn't taken stays in the take record, for the
   * next take, and every envelope already taken is refused as a duplicate (§5). Bookkeeping with no room within the
   * area's reserve stops the taking until room is made (W11); a rewind, or Messages started again, stops it before its
   * next write (W13; each queued step looks at the epoch first, f1). Tells open pages once, at the end, when anything
   * they show changed.
   */
  private async takeAll(network: NetworkName): Promise<void> {
    let arrived = false;
    let trapped = false;
    const epoch = this.epochOf(network);
    /** Messages were started again meanwhile, or the pool is read again from its oldest: this take is no longer to be. */
    const stale = () => this.epochOf(network) !== epoch;
    try {
      // No room for bookkeeping when the take stopped (W11): taken again only once there's room for the inbox to grow.
      if (this.full.has(network)) {
        if (!(await this.reserveHolds(Math.max(this.sizes.get(network)?.inbox ?? 0, PAD_STORED)))) return;
        this.full.delete(network);
        arrived = true;
      }
      for (;;) {
        if (stale()) return;
        const held = await this.takesFor(network);
        const batch = held.batches[0];
        const due = this.ownDue.get(network);
        // All taken: the next read starts a take of its own.
        if (stale() || (!batch && !due)) return;
        this.ownDue.delete(network);
        // Which Seedelfs take first messages now (no request), and what Try again steps over since the read kept these.
        const skip = await this.noteOwn(network, batch?.pin ?? due!, epoch);
        if (!skip || !batch) continue;
        let noRoom = 0;
        for (const envelope of batch.envelopes) {
          if (stale()) break;
          if (skip.has(envelopeHash(envelope))) continue;
          const step: Step = { trapped: false };
          await this.setMark(network, "take", { envelope: envelopeHash(envelope) }, batch.pin);
          for (let tries = 0; ; tries++) {
            try {
              if (await this.receive(network, envelope, batch.pin, step, epoch)) arrived = true;
            } catch (e) {
              if (step.trapped) {
                trapped = true;
                await this.noteTrap(network, "take");
                throw e;
              }
              // Nothing can be taken now: no key, another phrase's, an inbox that won't open, no room for bookkeeping.
              if (e instanceof WalletLocked || e instanceof ReserveReached || e instanceof UnreadableRecordError) throw e;
              if (e instanceof MessagingFull) {
                // No room for this one's message (W11): not kept, and counted as its read goes from the record.
                noRoom++;
                arrived = true;
              } else if (e instanceof StorageFailed && tries < TAKE_RETRIES) {
                // A read of storage failed under it, nothing of the envelope's (f2): the same one again, in place, after a
                // pause out of the queue, which holds no page and no post. Never the cursor held for it.
                await this.pause(TAKE_RETRY_MS);
                if (!stale()) continue;
              } else {
                // This envelope's alone: passed over without a word, and the next taken (W9).
                this.deps.passedOver?.(e);
              }
            }
            break;
          }
          // A page of the next read waits at most one envelope's work (W10).
          await this.wait();
        }
        if (stale()) return;
        if (await this.batchTaken(network, epoch, batch, noRoom)) arrived = true;
        if (await this.setRight(network, epoch, batch.pin)) arrived = true;
      }
    } catch (e) {
      if (e instanceof ReserveReached) {
        // Bookkeeping found no room (W11): what's read stays in the take record, in order, and reads go on as ever. The
        // overview says Messages are full until room is made.
        arrived = true;
        return;
      }
      // What's in memory goes: the take record keeps what isn't taken, for the next take (finding 8).
      this.takes.delete(network);
      throw e;
    } finally {
      this.taking.delete(network);
      if (!trapped) await this.setMark(network, "take", undefined).catch(() => undefined);
      if (arrived) this.deps.changed?.(network);
    }
  }

  /**
   * Sets which Seedelfs take first messages now (`handlesNow`), from what the wallet holds, with no request: before
   * each read's envelopes are taken, in the queue, under the phrase its read was made under. At the first with a kept
   * view, the Seedelfs this browser minted before 1.10.0 are adopted (`adopt`, W12). In the same write, what the inbox
   * shows of a conversation whose inbox write failed after its record's is set right from the record (f4). What Try
   * again steps over (W9), by SHA-256; undefined when a rewind or Messages started again has made this take stale (f1).
   */
  private noteOwn(network: NetworkName, pin: PhrasePin, epoch: number): Promise<Set<string> | undefined> {
    return this.serial(async () => {
      if (this.epochOf(network) !== epoch) return undefined;
      await this.withKey((_key, keys) => pin(keys));
      const inbox = await this.inbox(network);
      const now = this.deps.now();
      const skip = new Set((inbox.skip ?? []).filter((s) => s.until > now).map((s) => s.envelope));
      const adopted = await this.adopt(network, inbox);
      const { handles, seen, gone } = await this.handlesNow(network, inbox);
      const noted = await this.setNotedRight(network, inbox);
      if (!adopted && !noted.changed && sameHandles(handles, inbox.handles) && sameList(seen, inbox.seen ?? []) && sameList(gone, inbox.gone ?? [])) {
        this.clearNoted(network, noted.cids);
        return skip;
      }
      inbox.handles = handles;
      inbox.seen = seen;
      if (gone.length) inbox.gone = gone;
      else delete inbox.gone;
      // Bookkeeping, never refused for the budget: what's taken after it is, where it doesn't fit.
      await this.writeInbox(network, inbox, { kind: "bookkeeping" });
      this.clearNoted(network, noted.cids);
      return skip;
    });
  }

  /**
   * At a read's end in the take (f4): what the inbox shows of each conversation whose inbox write failed after its
   * record's, set right from its record, in one bookkeeping write, in the queue after the receives and the posts. Whether
   * to tell open pages. Never the sweep's slot, which comes before the post: only the user's own press widens what the
   * post reads.
   */
  private async setRight(network: NetworkName, epoch: number, pin: PhrasePin): Promise<boolean> {
    if (!this.inboxBehind.get(network)?.size) return false;
    return this.serial(async () => {
      if (this.epochOf(network) !== epoch) return false;
      await this.withKey((_key, keys) => pin(keys));
      const inbox = await this.inbox(network);
      const noted = await this.setNotedRight(network, inbox);
      if (noted.changed) await this.writeInbox(network, inbox, { kind: "bookkeeping" });
      this.clearNoted(network, noted.cids);
      return noted.changed;
    });
  }

  /** The noted conversations of `inbox` (f4), set right from their records: which were looked at, and whether any moved. */
  private async setNotedRight(network: NetworkName, inbox: Inbox): Promise<{ cids: string[]; changed: boolean }> {
    const cids = [...(this.inboxBehind.get(network)?.keys() ?? [])];
    let changed = false;
    for (const cid of cids) {
      const meta = inbox.conversations[cid];
      if (meta && (await this.setEntryRight(network, inbox, cid, meta))) changed = true;
    }
    return { cids, changed };
  }

  /** Notes that conversation `cid`'s record holds more than its inbox entry says (f4): `press`, a press of the user's wrote it. */
  private noteBehind(network: NetworkName, cid: string, press: boolean): void {
    let noted = this.inboxBehind.get(network);
    if (!noted) this.inboxBehind.set(network, (noted = new Map()));
    noted.set(cid, (noted.get(cid) ?? false) || press);
  }

  /** The notes of `cids` done with: their entries now say what their records hold (f4). */
  private clearNoted(network: NetworkName, cids: readonly string[]): void {
    const noted = this.inboxBehind.get(network);
    for (const cid of cids) noted?.delete(cid);
  }

  /**
   * The Seedelfs this browser minted before 1.10.0 (W12, handles-lifecycle#4): their names are in `mintedBy.<network>`
   * (sealed, written only at this browser's own mints), and their registers weren't kept then. Once, at the first take
   * with a kept view, each such name the view holds is adopted at the register it shows, as a pair this browser made,
   * on. Never again after; and never a name with an entry in `mintedAt`, a pair or a removal's mark (f6): a mint since
   * keeps who paid only once its pair is kept (mint.ts), so one whose pair couldn't be written stays off, as its switch
   * says, and one removed here stays removed. Whether `inbox` changed.
   */
  private async adopt(network: NetworkName, inbox: Inbox): Promise<boolean> {
    if (inbox.adopted) return false;
    const view = await this.deps.ownSeedelfs(network, false);
    if (!view) return false;
    const [paid, made] = await Promise.all([mintedBy(this.deps.store, network), mintedAt(this.deps.store, network)]);
    for (const name of Object.keys(paid)) {
      if (made[name] !== undefined) continue;
      const at = view.find((s) => s.name === name);
      // One that couldn't be written now is left off, and isn't tried again: the user can turn it on.
      if (at) {
        await rememberRegister(this.deps.store, network, name, at.register).catch((e: unknown) => {
          if (e instanceof WalletLocked) throw e;
        });
      }
    }
    inbox.adopted = true;
    return true;
  }

  /**
   * The (name, register) pairs of the wallet's Seedelfs that messaging may use now (W8), by name: each pair this
   * browser minted a Seedelf under (minted-by.ts `mintedAt`), and each the user turned on; but none a kept view no
   * longer has at that register (one that read successfully: contract-scan.ts keeps no other), and what began there
   * stays. A pair this browser made that no view has shown yet (a mint still on its way) counts. `handles` take first
   * messages: those of them the user hasn't turned off. `shown` can be shown (§19), whatever the switch for first
   * messages says: a pair the wallet made is its own to show. No request. `seen` gains each made pair the view has, and
   * `gone` each pair a view dropped, for good (f6): no view absent after a lock brings one back. A Seedelf removed here
   * (`mintedAt`'s mark) takes none on a choice made before the removal. Only the user's own turn-on lifts either.
   */
  private async handlesNow(
    network: NetworkName,
    inbox: Inbox,
  ): Promise<{ handles: Record<string, RegisterHex[]>; shown: string[]; seen: string[]; gone: string[] }> {
    const [made, view] = await Promise.all([mintedAt(this.deps.store, network), this.deps.ownSeedelfs(network, false)]);
    const seen = new Set(inbox.seen ?? []);
    const gone = new Set(inbox.gone ?? []);
    const holds = (name: string, register: RegisterHex) => view?.some((s) => s.name === name && sameRegister(s.register, register)) ?? false;
    const handles: Record<string, RegisterHex[]> = {};
    const shown = new Set<string>();
    const add = (name: string, register: RegisterHex, takes: boolean) => {
      shown.add(name);
      if (!takes) return;
      const at = (handles[name] ??= []);
      if (!at.some((r) => sameRegister(r, register))) at.push({ generator: register.generator, publicValue: register.publicValue });
    };
    for (const [name, registers] of Object.entries(made)) {
      for (const register of registers) {
        const key = pairKey(name, register);
        if (gone.has(key)) continue;
        if (holds(name, register)) seen.add(key);
        // Gone: shown at that register once, and no longer. For good: a view absent after a lock brings it back no more.
        if (view && seen.has(key) && !holds(name, register)) {
          gone.add(key);
          continue;
        }
        add(name, register, choiceOf(inbox, name, register)?.on !== false);
      }
    }
    for (const choice of inbox.answerAt ?? []) {
      if (!choice.on || made[choice.name]?.some((r) => sameRegister(r, choice.register))) continue;
      // Removed here: no choice made before the Remove brings it back, whatever the view says.
      if (removedHere(made, choice.name)) continue;
      const key = pairKey(choice.name, choice.register);
      if (gone.has(key)) continue;
      // Turned on as the kept view showed it: gone once a view doesn't, for good.
      if (view && !holds(choice.name, choice.register)) {
        gone.add(key);
        continue;
      }
      add(choice.name, choice.register, true);
    }
    return { handles, shown: [...shown], seen: [...seen].sort(), gone: [...gone].sort() };
  }

  /**
   * Whether the Seedelf `name` at `register` is one messaging may show (W8): this browser put it there, or the user
   * turned it on, since any removal here or drop by a view (f6). Never a name alone.
   */
  private async showsAt(network: NetworkName, inbox: Inbox, name: string, register: RegisterHex): Promise<boolean> {
    const made = await mintedAt(this.deps.store, network);
    if (made[name]?.some((r) => sameRegister(r, register))) return true;
    if (removedHere(made, name) || (inbox.gone ?? []).includes(pairKey(name, register))) return false;
    return choiceOf(inbox, name, register)?.on === true;
  }

  /** Every Seedelf the kept view has under the key, and whether it takes first messages (W8): none without a view. */
  private async seedelfsOf(network: NetworkName, inbox: Inbox): Promise<MessagingSeedelf[]> {
    const view = await this.deps.ownSeedelfs(network, false);
    if (!view?.length) return [];
    const made = await mintedAt(this.deps.store, network);
    const gone = new Set(inbox.gone ?? []);
    return view.map(({ name, register }) => {
      const mine = made[name]?.some((r) => sameRegister(r, register)) ?? false;
      // Removed here, or dropped by a view (f6): off, whatever was chosen before; its switch turns it on again.
      const off = removedHere(made, name) || gone.has(pairKey(name, register));
      return { name, register, made: mine, on: !off && (choiceOf(inbox, name, register)?.on ?? mine) };
    });
  }

  /**
   * `batch`'s envelopes taken (finding 8): gone from the take record, in one write in its chain, with those of them
   * that had no room this time (`noRoom`, W11): counted as their read is done with, so a read taken again after a stop
   * counts each once, and one kept the second time not at all (f5). The cursor isn't this write's: it moved as the read
   * ended. Whether to tell open pages. Bookkeeping: never past the area's reserve. A stale take writes nothing (f1).
   */
  private batchTaken(network: NetworkName, epoch: number, batch: Batch, noRoom: number): Promise<boolean> {
    return this.onTakes(network, async () => {
      if (this.epochOf(network) !== epoch) return false;
      // The phrase the read began under: one removed and another restored meanwhile gets nothing of the first's.
      await this.withKey((_key, keys) => batch.pin(keys));
      const held = await this.takesOf(network, batch.pin);
      if (!held.batches.includes(batch) && !noRoom) return false;
      // Looked at again right before the write: Messages started again moves the epoch outside the queue (`clear`).
      if (this.epochOf(network) !== epoch) return false;
      await this.writeTakes(network, held, { ...held, batches: held.batches.filter((b) => b !== batch), noRoom: held.noRoom + noRoom });
      return noRoom > 0;
    });
  }

  /**
   * Takes one envelope the scan matched, in the queue: a message of a held conversation, a request started or joined,
   * or nothing. Every refusal is dropped without a word (W3): anyone can address an envelope to any register of the
   * key, so a refusal kept, shown or acted on would tell its sender which registers are this wallet's. A code this
   * version doesn't know is dropped too. But one: a message of a held conversation its own ratchet authenticated and
   * can't reach (`too_far_ahead`, which the crate gives only once the message and its envelope have checked out,
   * DESIGN-protocol §3.3): the conversation may not continue (§6), until a later message of it decrypts. No envelope
   * starts a request of any kind (W1). The requests' and tombstones' records go to the crate only for a first message
   * that isn't a held conversation's (W7). A record the crate can't read is set aside, and the envelope taken once more
   * without it (W9). A trap in any of its WebAssembly calls is `step`'s. A take of an older epoch (`epoch`: a rewind, or
   * Messages started again, since) takes nothing (f1). Returns whether anything the screens show changed.
   */
  private receive(network: NetworkName, envelope: string, pin: PhrasePin, step: Step, epoch: number): Promise<boolean> {
    return this.serial(async () => {
      if (this.epochOf(network) !== epoch) return false;
      const opened = await this.withKey((key, keys) => {
        pin(keys);
        return this.parse<Opened>(this.watch(step, () => this.deps.wasm.messagingOpen(key, envelope)));
      });
      if (isRefused(opened)) return false;
      const inbox = await this.inbox(network);
      // What's set right in the inbox whatever the envelope was: a record found unreadable, one set aside.
      let repaired = false;
      const files = new Map<string, ConversationFile>();
      for (const cid of [opened.cid, opened.replaces]) {
        const meta = cid ? inbox.conversations[cid] : undefined;
        if (!cid || !meta || meta.unreadable) continue;
        try {
          const file = await this.file(network, meta);
          if (file) files.set(cid, file);
        } catch (e) {
          // A record that won't open is left as it is, and its messages refused: it never holds up the rest.
          if (!(e instanceof UnreadableRecordError)) throw e;
          meta.unreadable = true;
          repaired = true;
        }
      }
      const first = opened.kind === "first-contact";
      // The wallet's Seedelfs, only for a stranger's first message to one: nothing else needs them. From what the
      // wallet holds already (`noteOwn`): a first message to one that takes none is dropped, never a read of the chain.
      const held = inbox.conversations[opened.cid] !== undefined || inbox.requestsShown[opened.cid] !== undefined;
      const stranger = first && !held && !!opened.to;
      const records = first && inbox.conversations[opened.cid] === undefined;
      const call = () => {
        const request = JSON.stringify({
          envelope,
          now: Math.floor(this.deps.now() / 1000),
          handles: stranger ? Object.entries(inbox.handles).map(([name, registers]) => ({ name, registers })) : [],
          conversations: [...files.values()].map((f) => f.state),
          ...(records && inbox.requests ? { requests: inbox.requests } : {}),
          ...(records && inbox.tombstones ? { tombstones: inbox.tombstones } : {}),
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
          >(this.watch(step, () => this.deps.wasm.messagingReceive(key, request)));
        });
      };
      let result: Awaited<ReturnType<typeof call>>;
      try {
        result = await call();
        if (isRefused(result) && RECORD_REFUSALS.has(result.refused) && this.setAside(inbox, files, records, step)) {
          repaired = true;
          result = await call();
        }
      } catch (e) {
        if (step.trapped || e instanceof WalletLocked) throw e;
        // The crate couldn't read a record it was handed: a later build's, or damaged. Set aside, and once more.
        if (!this.setAside(inbox, files, records, step)) throw e;
        repaired = true;
        result = await call();
      }
      if (isRefused(result)) {
        const meta = result.refused === "too_far_ahead" ? inbox.conversations[opened.cid] : undefined;
        const unreachable = !!meta && !meta.unreachable;
        if (unreachable) meta.unreachable = true;
        if (unreachable || repaired) await this.writeInbox(network, inbox, { kind: "bookkeeping" });
        return unreachable || repaired;
      }
      const now = this.deps.now();
      if ("conversation" in result) {
        const cid = result.received.cid;
        const meta = inbox.conversations[cid];
        const file = files.get(cid);
        if (!meta || !file) {
          if (repaired) await this.writeInbox(network, inbox, { kind: "bookkeeping" });
          return repaired;
        }
        file.state = result.conversation;
        const shown = textOf(result.received.plaintext);
        if (shown) {
          const entry: Entry = { id: file.next++, dir: "in", at: now, ...shown };
          if (entry.kind === KIND_REVEAL) {
            // §19.4's first three checks, now, with no request: a session message, at the side written to, whose proof
            // verifies. The chain's register waits for the user's press (`checkReveals`); commit marks the conversation.
            entry.reveal = this.checkReveal(opened.kind, result.conversation, result.received.plaintext, step);
          }
          file.history.push(entry);
          meta.unread++;
          meta.lastAt = now;
        }
        // A control kind this version doesn't know leaves nothing to see (W15), but its ratchet stepped: kept.
        // Only the other side's reply decrypts in a conversation this wallet started: it's answered, and its share
        // ends (W17).
        meta.answered = true;
        // A message the ratchet reached: the conversation goes on.
        delete meta.unreachable;
        // Answered: what waited queued for the writer's share (W13) is sealed now, to be posted at the next tick.
        if (!file.stampDigest) this.sealQueued(file);
        // Kept only if it fits; one that doesn't is counted where it's taken, and its ratchet's step is lost with it.
        await this.commit(network, inbox, cid, file, "content", shown ? file.next - 1 : undefined);
      } else {
        const { cid, evicted } = result.received;
        inbox.requests = result.requests;
        this.showRequest(inbox, opened, result.received, step);
        // A control kind this version doesn't know isn't counted as unread (W15).
        if (textOf(result.received.plaintext)) inbox.requestsUnread[cid] = (inbox.requestsUnread[cid] ?? 0) + 1;
        for (const gone of evicted) {
          delete inbox.requestsUnread[gone];
          delete inbox.requestsShown[gone];
        }
        // A room of their own (W11): bounded by the crate, never trimming a message nor counted in the budget.
        await this.writeInbox(network, inbox, { kind: "requests" });
      }
      return true;
    });
  }

  /**
   * Sets what the list shows of the request `received` just started or joined (W7): a join adds a message; a new one
   * is what its F says, and for a continuation what the crate judged it, from the record. Any it doesn't hold yet, the
   * record says all of.
   */
  private showRequest(inbox: Inbox, opened: Opened, received: { cid: string; new: boolean }, step: Step): void {
    const at = Math.floor(this.deps.now() / 1000);
    const shown = inbox.requestsShown[received.cid];
    if (shown && !received.new) {
      shown.messages++;
      shown.last = at;
      return;
    }
    if (!received.new || opened.replaces) {
      // A continuation's `verified` is the crate's to say, as is all of one this inbox lost count of. The record is the
      // crate's own answer, just given: one it refused is said from F, as a new one is.
      const listed = this.requestsInfo(inbox.requests!, step);
      const info = isRefused(listed) ? undefined : listed.find((r) => r.cid === received.cid);
      if (info) {
        inbox.requestsShown[received.cid] = shownOf(info);
        return;
      }
    }
    inbox.requestsShown[received.cid] = { t: opened.t ?? at, to: opened.to ?? "", messages: 1, last: at };
  }

  /**
   * Sets aside each record handed to the crate that it can't read (W9, W17): a conversation's is marked as one that
   * can't be opened, and kept as it is; the requests' is kept apart where a later version wrote it, and otherwise
   * dropped (`asideRequests`); the tombstones' is dropped. The last two hold no keys (a request waiting is lost, and a
   * deleted conversation's first message could come back as a request in its 48 hours). Whether it found one.
   */
  private setAside(inbox: Inbox, files: Map<string, ConversationFile>, records: boolean, step?: Step): boolean {
    let found = false;
    for (const [cid, file] of files) {
      if (this.reads(() => this.deps.wasm.messagingConversationInfo(file.state), step)) continue;
      files.delete(cid);
      const meta = inbox.conversations[cid];
      if (meta) meta.unreadable = true;
      found = true;
    }
    const requests = records && inbox.requests !== undefined ? this.refusalOf(() => this.deps.wasm.messagingRequestsInfo(inbox.requests!), step) : undefined;
    if (requests) {
      this.asideRequests(inbox, requests);
      found = true;
    }
    if (
      records &&
      inbox.tombstones !== undefined &&
      !this.reads(() => this.deps.wasm.messagingExpire(JSON.stringify({ now: 0, tombstones: inbox.tombstones })), step)
    ) {
      delete inbox.tombstones;
      found = true;
    }
    return found;
  }

  /**
   * The requests' record, which the crate refuses (W17, DESIGN-protocol §3.7): one a later version wrote, its first byte
   * past this build's `requestsVersion`, is kept apart as it is (`requestsAside`), never written over; a development
   * build's, older, or one that doesn't parse, is dropped, the messages the list showed of it counted (`dropped`).
   * Either way the list loses its requests, which can't be opened, and new ones start a record of their own.
   */
  private asideRequests(inbox: Inbox, refusal: RecordRefused): void {
    const requests = inbox.requests;
    if (requests === undefined) return;
    if (refusal.refused === "unsupported_state_version" && (refusal.version ?? 0) > this.constantsOf().requestsVersion) {
      inbox.requestsAside = [...(inbox.requestsAside ?? []), requests];
    } else {
      // What the list said of them; an inbox from before it kept a list, what was unread.
      const shown = Object.values(inbox.requestsShown).reduce((n, r) => n + r.messages, 0);
      const lost = shown || Object.values(inbox.requestsUnread).reduce((n, u) => n + u, 0);
      if (lost > 0) inbox.dropped = (inbox.dropped ?? 0) + lost;
    }
    delete inbox.requests;
    inbox.requestsShown = {};
    inbox.requestsUnread = {};
  }

  /** Whether a call that parses a record answers, and with no refusal: false where the bindings throw for it. */
  private reads(call: () => string, step?: Step): boolean {
    return this.refusalOf(call, step) === undefined;
  }

  /**
   * The refusal a call that parses a record answers with, as the crate gives it: none where the record reads, and
   * `invalid_state` where the bindings throw for it.
   */
  private refusalOf(call: () => string, step?: Step): RecordRefused | undefined {
    try {
      const answer: unknown = JSON.parse(String(this.wasmCall(() => this.watch(step, call))));
      return isRefused(answer) ? answer : undefined;
    } catch (e) {
      if (e instanceof WalletLocked) throw e;
      return { refused: "invalid_state" };
    }
  }

  /** `call`'s answer, or, where it throws for want of a record the crate can read, what's left once that's set aside. */
  private tryOr<T>(call: () => T, fallback: T): T {
    try {
      return call();
    } catch (e) {
      if (e instanceof WalletLocked) throw e;
      return fallback;
    }
  }

  /**
   * A call of the user's that takes the requests' record (`request`, `accept`): where the crate doesn't read it, its
   * answer refusing the record (`refused`) or the bindings throwing (W9, W17), the record is set aside or dropped
   * (`asideRequests`: it holds no keys), the inbox written so, and the request is no longer there.
   */
  private async recordsCall<T>(network: NetworkName, inbox: Inbox, call: () => Promise<T>, refused: (answer: T) => boolean): Promise<T> {
    let answer: { value: T } | undefined;
    try {
      answer = { value: await call() };
    } catch (e) {
      if (e instanceof WalletLocked) throw e;
    }
    if (answer && !refused(answer.value)) return answer.value;
    if (this.setAside(inbox, new Map(), true)) {
      await this.writeInbox(network, inbox, { kind: "bookkeeping" });
      this.deps.changed?.(network);
    }
    throw new Error(t("worker.messaging.noRequest"));
  }

  /**
   * A received reveal's proof, checked against its conversation's record as the message left it (protocol.md §19.4,
   * steps 1 to 3): taken only from a session message, never a first-contact message, and checked only where this wallet
   * was written to. Verified, its name and register wait for the user to have the chain checked (`checkReveals`);
   * otherwise it failed, and nothing of its name is kept.
   */
  private checkReveal(kind: string, conversation: string, plaintext: string, step?: Step): ReceivedReveal {
    if (kind !== "session") return { status: "failed" };
    const checked = this.parse<{ name: string; register: RegisterHex }>(
      this.wasmCall(() => this.watch(step, () => this.deps.wasm.messagingCheckReveal(JSON.stringify({ conversation, reveal: plaintext.slice(2) })))),
    );
    if (isRefused(checked)) return { status: "failed" };
    return { status: "unchecked", name: checked.name, register: checked.register };
  }

  /**
   * Has the chain checked for every reveal of conversation `cid` whose proof verified (protocol.md §19.4, step 4):
   * whether the contract gives its Seedelf's name that register now. Only the user asks, from the thread, never a sync
   * (W2): a read right after a reveal came would tell the server whom it was for. One read of the contract for all of
   * them, whole and fresh (`revealedRegistersFrom`), out of the queue; the outcomes written in it. The same, the other
   * side holds that Seedelf; otherwise it failed, and it isn't named. Refused while the network's Messages are off or
   * the wallet is locked, and stopped before its request if either comes meanwhile (reveal#6). A read that fails
   * throws, and the reveals wait for another press. Two presses at once are one check.
   */
  checkReveals(network: NetworkName, cid: string): Promise<void> {
    const key = keyOf(network, cid);
    const running = this.checks.get(key);
    if (running) return running;
    const run = this.checkNow(network, cid, key).finally(() => this.checks.delete(key));
    this.checks.set(key, run);
    return run;
  }

  private async checkNow(network: NetworkName, cid: string, key: string): Promise<void> {
    /** Throws unless the check may ask the chain now: the network's Messages on, the wallet unlocked. */
    const allowed = async () => {
      if (!(await this.isOn(network))) throw new Error(t("messages.noneOff"));
      if ((await this.deps.wallet.state()) !== "unlocked") throw new WalletLocked(t("worker.wallet.locked"));
    };
    await allowed();
    // The first look, in the queue (W13): a record found unreadable is marked on the inbox as it is then, never on a
    // copy something else has written since.
    const waits = await this.serial(async () => {
      const inbox = await this.inbox(network);
      const meta = inbox.conversations[cid];
      if (!meta) throw new Error(t("worker.messaging.noConversation"));
      const kept = await this.fileFor(network, inbox, meta);
      if (!kept) throw new Error(t("worker.messaging.noConversation"));
      if (kept.history.some(isUnchecked)) return true;
      // Nothing waits: what the inbox says of it is set right from its record, and nothing is asked.
      const now = revealsOf(kept, meta.revealed);
      if (now.unchecked === meta.unchecked && now.revealed?.name === meta.revealed?.name && now.revealed?.at === meta.revealed?.at) return false;
      Object.assign(meta, now);
      await this.writeInbox(network, inbox, { kind: "bookkeeping" });
      return false;
    });
    if (!waits) return;
    // Being read: the thread says so.
    this.checking.add(key);
    this.deps.changed?.(network);
    try {
      // Asked again right before the request: the switch turned off, or a lock, while the records were read stops it.
      await allowed();
      const lookup = await this.deps.revealedRegisters(network);
      await this.serial(async () => {
        const inbox = await this.inbox(network);
        const meta = inbox.conversations[cid];
        const kept = meta && (await this.readable(network, meta));
        if (!meta || !kept) return;
        let decided = false;
        for (const entry of kept.history) {
          if (!isUnchecked(entry)) continue;
          const { name, register } = entry.reveal;
          const found = lookup(name);
          const same = found?.generator === register.generator && found.publicValue === register.publicValue;
          const at: Entry = entry;
          at.reveal = same ? { status: "verified", name } : { status: "failed" };
          decided = true;
        }
        // commit sets `unchecked` and `revealed` from the record (`measure`).
        if (decided) await this.commit(network, inbox, cid, kept, "bookkeeping");
      });
    } finally {
      this.checking.delete(key);
      this.deps.changed?.(network);
    }
  }

  /**
   * Expires skipped keys past their 48 hours, and tombstones past their t + 48 hours and 7 days (the crate's margin, which
   * a clock set back can't undo, DESIGN-protocol §3.6): at the first sync of each unlock, and at most hourly after.
   * Writes only what changed, and keeps each record's count true (W7). A record the crate can't read is marked so. The
   * hour is looked at before the queue (W13), so a tick never waits behind a take for an expiry that isn't due; a last
   * expiry later than now is a clock set back since, and expiry runs at once (W14, clock#3).
   */
  private async expire(network: NetworkName): Promise<void> {
    const due = (now: number, last: number | undefined) => last === undefined || now < last || now - last >= EXPIRE_EVERY_MS;
    if (!due(this.deps.now(), await this.expiredAt(network))) return;
    return this.serial(async () => {
      const now = this.deps.now();
      if (!due(now, await this.expiredAt(network))) return;
      const inbox = await this.inbox(network);
      const secs = Math.floor(now / 1000);
      let changed = false;
      for (const meta of Object.values(inbox.conversations)) {
        if (meta.unreadable) continue;
        const file = await this.readable(network, meta);
        if (!file) continue;
        let expired: { conversation: string };
        try {
          expired = this.read<{ conversation: string }>(
            this.wasmCall(() => this.deps.wasm.messagingExpire(JSON.stringify({ now: secs, conversation: file.state }))),
          );
        } catch (e) {
          if (e instanceof WalletLocked) throw e;
          // The crate can't read it: it can't be shown, and can be deleted (W9). The rest expire all the same.
          meta.unreadable = true;
          changed = true;
          continue;
        }
        if (expired.conversation !== file.state) {
          file.state = expired.conversation;
          const stored = fileToStored(file);
          const bytes = sizeOf(stored);
          await this.put(network, conversationRecord(network, meta.id!), stored, "bookkeeping", bytes - meta.bytes);
          Object.assign(meta, measure(file, meta, bytes));
          changed = true;
        }
      }
      if (inbox.tombstones) {
        const tombstones = inbox.tombstones;
        try {
          const kept = this.read<{ tombstones: string }>(
            this.wasmCall(() => this.deps.wasm.messagingExpire(JSON.stringify({ now: secs, tombstones }))),
          ).tombstones;
          if (kept !== tombstones) {
            inbox.tombstones = kept;
            changed = true;
          }
        } catch (e) {
          if (e instanceof WalletLocked) throw e;
          delete inbox.tombstones;
          changed = true;
        }
      }
      if (changed) await this.writeInbox(network, inbox, { kind: "bookkeeping" });
      await this.noteExpired(network, now);
    });
  }

  /**
   * At a network's first sync of each unlock, and so of each worker's life: deletes conversation records the inbox
   * doesn't list (a stop between writing one and listing it, or between unlisting one and deleting it, and any named
   * the way builds before the 1.10.0 gate named them), and brings what the inbox shows of each conversation back to
   * its record: a stop or a lock between a record's write and the inbox's would otherwise leave a pending message
   * unposted, its outbox uncounted, or a reply uncounted and unanswered (W9). Under `pin`, when a sync asks it.
   */
  private async sweep(network: NetworkName, pin?: PhrasePin): Promise<void> {
    const mark = `${network}:${await this.deps.wallet.unlockedAt().catch(() => 0)}`;
    if (this.swept.has(mark)) return;
    await this.serial(async () => {
      if (pin) await this.withKey((_key, keys) => pin(keys));
      const inbox = await this.inbox(network);
      const prefix = PRIVATE_PREFIX + CONVERSATION_RECORDS + network + ".";
      const ids = new Set(Object.values(inbox.conversations).flatMap((m) => (m.id ? [m.id] : [])));
      for (const key of await this.deps.local.keys(prefix)) {
        const id = key.slice(prefix.length);
        if (!ids.has(id)) await this.deps.store.remove(conversationRecord(network, id));
      }
      let repaired = false;
      for (const [cid, meta] of Object.entries(inbox.conversations)) {
        if (await this.setEntryRight(network, inbox, cid, meta)) repaired = true;
      }
      if (repaired) await this.writeInbox(network, inbox, { kind: "bookkeeping" });
      // Every entry now says what its record holds: what a failed inbox write noted is done with (f4).
      this.inboxBehind.delete(network);
    });
    this.swept.add(mark);
  }

  /**
   * Sets what `inbox` shows of conversation `cid` right from its record (W9, f4): its storage, outbox, oldest and last
   * messages, reveals, whether it's answered, when its last message came and what's unread since the thread was last
   * shown. One whose record won't open is marked so, and stays listed: what it holds may still come back. One whose
   * record isn't there goes from the list. The inbox is the caller's to write. Whether anything changed.
   */
  private async setEntryRight(network: NetworkName, inbox: Inbox, cid: string, meta: Meta): Promise<boolean> {
    let file: ConversationFile | undefined;
    try {
      file = await this.file(network, meta);
    } catch (e) {
      if (!(e instanceof UnreadableRecordError)) throw e;
      if (meta.unreadable) return false;
      meta.unreadable = true;
      return true;
    }
    if (!file) {
      delete inbox.conversations[cid];
      return true;
    }
    let repaired = false;
    // One marked as unreadable that the crate reads now goes back to being shown.
    if (meta.unreadable && this.reads(() => this.deps.wasm.messagingConversationInfo(file!.state))) {
      delete meta.unreadable;
      repaired = true;
    }
    const now = { ...measure(file, meta, sizeOf(fileToStored(file))), ...countsOf(file, meta) };
    if (
      now.bytes !== meta.bytes ||
      now.outbox !== meta.outbox ||
      now.oldestAt !== meta.oldestAt ||
      now.last?.dir !== meta.last?.dir ||
      now.last?.text !== meta.last?.text ||
      now.last?.reveal !== meta.last?.reveal ||
      now.unchecked !== meta.unchecked ||
      now.revealed?.name !== meta.revealed?.name ||
      now.revealed?.at !== meta.revealed?.at ||
      now.answered !== meta.answered ||
      now.lastAt !== meta.lastAt ||
      now.unread !== meta.unread
    ) {
      Object.assign(meta, now);
      repaired = true;
    }
    // A reply the inbox lost count of ends the writer's share (W17); what's left of one goes on from the record's next
    // write, or its thread's next look.
    if (meta.answered && meta.firstContactLeft) {
      delete meta.firstContactLeft;
      repaired = true;
    }
    return repaired;
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
    const key = keyOf(network, cid);
    if (this.solving.has(key)) return;
    this.solving.add(key);
    // Whether this call put up the thread's "about N s": only then is it this call's to take down, never the work of a
    // post being solved meanwhile in the same conversation (worker-net#14).
    let shown = false;
    try {
      // Nothing is solved while the relay is stopped (W15): the next sync after it answers solves it.
      if ((await this.heldUntil(SESSION_PAUSED, network, PAUSED_ASK_MS)) !== undefined) return;
      const meta = (await this.inbox(network)).conversations[cid];
      const file = meta && (await this.readable(network, meta));
      if (!file?.stampDigest) return;
      const bits = this.deps.firstContactBits ?? this.constantsOf().firstContactStampBits;
      this.work.set(key, { bits });
      shown = true;
      this.deps.changed?.(network);
      const nonce = await this.solve(file.stampDigest, bits);
      await this.serial(async () => {
        const inbox = await this.inbox(network);
        const now = inbox.conversations[cid];
        const kept = now && (await this.readable(network, now));
        if (!kept?.stampDigest) return;
        const stamped = this.parse<{ conversation: string; bits: number }>(
          this.wasmCall(() => this.deps.wasm.messagingSetStamp(JSON.stringify({ conversation: kept.state, nonce }))),
        );
        if (isRefused(stamped)) throw new MessagingRefused(stamped.refused);
        kept.state = stamped.conversation;
        delete kept.stampDigest;
        // Every text queued for the stamp, in order; one the writer's own share has no room for, and every one after
        // it, waits queued for a reply (W13). None is ever the server's refusal.
        this.sealQueued(kept);
        await this.commit(network, inbox, cid, kept);
      });
      this.work.delete(key);
      shown = false;
      this.deps.changed?.(network);
      await this.post(network);
    } finally {
      this.solving.delete(key);
      if (shown) this.work.delete(key);
    }
  }

  /**
   * Seals every queued text of `file` in order, the ratchet stepping in it: each pending, to be posted (W13). One the
   * writer's own share of a first message has no room for (`request_full`) stays queued, with every one after it, and
   * that's returned: they wait for a reply. One the crate refuses for anything else is the wallet's refusal, with no
   * bytes, and the rest go on.
   */
  private sealQueued(file: ConversationFile): "request_full" | undefined {
    for (const entry of file.history) {
      if (entry.sent !== "queued") continue;
      if (this.sealPlaintext(file, entry, plaintextOf(entry.text ?? "")) === "request_full") {
        entry.sent = "queued";
        delete entry.refusedBy;
        return "request_full";
      }
    }
    return undefined;
  }

  /**
   * Seals `plaintext` (hex, its kind first) as `entry`'s envelope, the ratchet stepping in `file`. Returns the crate's
   * refusal, when it refused: the entry is then `refused` by the wallet (W13), with no bytes.
   */
  private sealPlaintext(file: ConversationFile, entry: Entry, plaintext: string): string | undefined {
    const sent = this.parse<{ conversation: string; envelope: string }>(
      this.wasmCall(() => this.deps.wasm.messagingSend(JSON.stringify({ conversation: file.state, plaintext }))),
    );
    if (isRefused(sent)) {
      entry.sent = "refused";
      entry.refusedBy = "wallet";
      return sent.refused;
    }
    file.state = sent.conversation;
    entry.sent = "pending";
    entry.envelope = sent.envelope;
    return undefined;
  }

  /** Posts every pending envelope on `network`, one at a time per network. */
  post(network: NetworkName): Promise<void> {
    return this.once(this.posting, network, () => this.postNow(network));
  }

  private async postNow(network: NetworkName): Promise<void> {
    if (!(await this.isOn(network))) return;
    if ((this.postAfter.get(network) ?? 0) > this.mono()) return;
    // Nothing is posted, nor solved for, while the relay is stopped (W15).
    if ((await this.heldUntil(SESSION_PAUSED, network, PAUSED_ASK_MS)) !== undefined) return;
    const inbox = await this.inbox(network).catch((e: unknown) => {
      if (e instanceof WalletLocked) return undefined;
      throw e;
    });
    if (!inbox) return;
    const relay = this.deps.relay(network);
    const pool = NETWORKS[network].relay.pool;
    // What's waiting, in order: every pending envelope of every conversation. One a press of the user's kept, whose inbox
    // write failed after its record's, is read whatever the inbox counts (f4): only a press widens what's read here.
    const pressed = this.inboxBehind.get(network);
    const waiting: Array<{ cid: string; id: number; envelope: string }> = [];
    for (const [cid, meta] of Object.entries(inbox.conversations)) {
      if ((!meta.outbox && !pressed?.get(cid)) || meta.unreadable) continue;
      const file = await this.readable(network, meta);
      for (const entry of file?.history ?? []) {
        if (entry.sent === "pending" && entry.envelope) waiting.push({ cid, id: entry.id, envelope: entry.envelope });
      }
    }
    // A run after one an answer this version doesn't know ended starts after that envelope (W15): one envelope the
    // server can't take never holds the rest.
    const after = this.postFrom.get(network);
    const at = after === undefined ? -1 : waiting.findIndex((w) => `${keyOf(network, w.cid)}:${w.id}` === after);
    const order = at < 0 ? waiting : [...waiting.slice(at + 1), ...waiting.slice(0, at + 1)];
    for (const { cid, id, envelope } of order) {
      // A size the relay asked to wait waits alone: the other sizes go on (§17.4 prices and refuses by size, W5).
      if (this.waitFor(network, envelope) > this.mono()) continue;
      // Deleted meanwhile: nothing of it is posted.
      if (this.removed.has(keyOf(network, cid))) continue;
      const key = keyOf(network, cid);
      let answer: Exclude<PostAnswer, { kind: "price" }> | "unknown" | undefined;
      try {
        answer = await this.postOne(relay, network, pool, envelope, (bits) => {
          this.work.set(key, { entry: id, bits });
          this.deps.changed?.(network);
        });
      } finally {
        this.work.delete(key);
      }
      if (!answer) return;
      // The device's time of the answer: what a fresh post's expiry and the clock's measure are of (W14).
      const answeredAt = this.deps.now();
      const digest = this.relayDigest(pool, envelope);
      if (answer === "unknown") {
        // Not one of §17.2's answers (W15). This one alone waits: the next run begins after it, and after three in a
        // row it's set aside with its bytes, for the user to send again.
        const times = (this.unknown.get(digest) ?? 0) + 1;
        this.unknown.set(digest, times);
        this.postFrom.set(network, `${key}:${id}`);
        if (times < UNKNOWN_ANSWERS) return;
        this.unknown.delete(digest);
        answer = { kind: "refused", status: 0 };
      } else {
        this.unknown.delete(digest);
      }
      if (answer.kind === "wait") {
        // On the monotonic clock: a device clock set back or forward meanwhile stretches nothing (W14).
        const until = this.mono() + answer.retryAfterMs;
        // The thread counts down to the next try.
        this.deps.changed?.(network);
        if (answer.scope === "network") {
          this.postAfter.set(network, until);
          return;
        }
        this.sizesOf(network).set(envelope.length / 2, until);
        continue;
      }
      const done = answer;
      await this.serial(async () => {
        const now = await this.inbox(network);
        const listed = now.conversations[cid];
        const kept = listed && (await this.readable(network, listed));
        const entry = kept?.history.find((e) => e.id === id);
        if (!kept || !entry || entry.sent !== "pending") return;
        if (done.kind === "kept") {
          entry.sent = "posted";
          delete entry.envelope;
          if (done.fresh) {
            // Taken new: the relay drops it 36 hours from its now, said on this device's clock from the answer, and the
            // device's clock measured against the relay's (W14). Only said: never the time anything runs on.
            entry.postedAt = answeredAt;
            entry.expires = answeredAt + RELAY_HOLD_MS;
            now.clock = { at: answeredAt, off: answeredAt - (done.expires - RELAY_HOLD_MS) };
          } else {
            // Already held: its first post's expiry, the relay's own, which says nothing of its clock now.
            entry.expires = done.expires;
          }
        } else {
          // Refused by the server, or by something on the way (worker-net#8), or answered unknown three times in a row
          // (W15): its bytes are kept, so the user can send them again (`resend`). It isn't posted again by itself.
          entry.sent = "refused";
          entry.refusedBy = "server";
        }
        await this.commit(network, now, cid, kept, "bookkeeping");
      });
      this.deps.changed?.(network);
    }
    this.postFrom.delete(network);
  }

  /** A post's stamp digest (`messagingRelayDigest`): what its solved work and its answers are kept by. */
  private relayDigest(pool: string, envelope: string): string {
    return this.wasmCall(() => this.deps.wasm.messagingRelayDigest(pool, envelope));
  }

  /**
   * Posts one envelope: solved at the price the last page named for its size (the pool's base before any page),
   * again at the price a 402 names, for the same bytes. A price past the ceiling is waited for, never worked for
   * (worker-net#4): the bindings' `priceCeilingBits` (W17), a page's for a minute, a 402's as long as it says. Undefined
   * when the relay didn't answer; "unknown" for an answer this version doesn't know (W15); and the relay's off switch
   * holds the network (W15).
   */
  private async postOne(
    relay: RelayClient,
    network: NetworkName,
    pool: string,
    envelope: string,
    /** Told the price before its work is solved. */
    onSolve?: (bits: number) => void,
  ): Promise<Exclude<PostAnswer, { kind: "price" }> | "unknown" | undefined> {
    const size = envelope.length / 2;
    const index = this.constantsOf().envelopeSizes.indexOf(size);
    const ceiling = this.constantsOf().priceCeilingBits;
    let bits = this.prices.get(network)?.[index] ?? RELAY_BASE_BITS[network];
    const digest = this.relayDigest(pool, envelope);
    for (let tries = 0; tries < 4; tries++) {
      // Past the ceiling no pool of §17.4 prices a post: that size waits for a page a minute on to say again.
      if (bits > ceiling) return { kind: "wait", scope: "size", retryAfterMs: CEILING_WAIT_MS };
      // 0: the relay would refuse this address's post now (§17.5). Posted with no work, it says for how long (a 429's
      // retry-after, counted before any work is checked), or names its price if that's passed meanwhile.
      const nonce = bits === 0 ? 0 : await this.workFor(digest, bits, onSolve);
      const body = this.wasmCall(() => this.deps.wasm.messagingPostBody(JSON.stringify({ nonce, envelope })));
      let answer: PostAnswer;
      try {
        // Asked again right before it goes: a switch turned off, or a lock, while it was solved stops it.
        answer = await relay.post(body, () => this.mayAsk(network));
      } catch (e) {
        if (e instanceof RelayStopped) {
          await this.hold(SESSION_PAUSED, network, this.deps.now() + PAUSED_ASK_MS);
          this.paused.add(network);
          this.deps.changed?.(network);
          return undefined;
        }
        if (e instanceof RelayUnknown) return "unknown";
        if (e instanceof RelayDown) return undefined;
        throw e;
      }
      if (answer.kind === "kept") this.solved.delete(digest);
      if (answer.kind !== "price") return answer;
      // Past the ceiling §17.4's relay refuses rather than prices: one that names more is waited for, as long as its
      // 402 says (a minute when it says nothing), never worked for.
      if (answer.bits > ceiling) return { kind: "wait", scope: "size", retryAfterMs: answer.retryAfterMs ?? CEILING_WAIT_MS };
      bits = answer.bits;
    }
    return undefined;
  }

  /**
   * A nonce with at least `bits` of work over a post's `digest`: the one found before for it when that had as many,
   * else searched for from where that one was found. Every nonce before it failed a lower price, so it fails this one.
   */
  private async workFor(digest: string, bits: number, onSolve?: (bits: number) => void): Promise<number> {
    const kept = this.solved.get(digest);
    if (kept && kept.bits >= bits) return kept.nonce;
    onSolve?.(bits);
    const nonce = await this.solve(digest, bits, kept?.nonce ?? 0);
    this.solved.set(digest, { bits, nonce });
    return nonce;
  }

  /**
   * A nonce from `start` on whose work over `digest` is at least `bits`, found in slices with a turn of the event loop
   * between.
   */
  private async solve(digest: string, bits: number, start = 0): Promise<number> {
    // On the monotonic clock (W14, clock#8): a device clock stepped back mid-solve never skips the keep-alive.
    let lastKept = this.mono();
    for (let from = start; ; from += STAMP_SLICE) {
      const began = performance.now();
      const found = this.parse<{ nonce: number | null }>(
        this.wasmCall(() => this.deps.wasm.messagingFindStamp(JSON.stringify({ digest, bits, from, attempts: STAMP_SLICE }))),
      );
      if (isRefused(found)) throw new MessagingRefused(found.refused);
      if (found.nonce !== null) return found.nonce;
      // A whole slice's time, smoothed: what "about N s" is worked out from.
      const ns = ((performance.now() - began) * 1e6) / STAMP_SLICE;
      if (ns > 0) this.attemptNs = 0.8 * this.attemptNs + 0.2 * ns;
      await this.wait();
      if (this.deps.keepAlive && this.mono() - lastKept > 10_000) {
        lastKept = this.mono();
        await this.deps.keepAlive().catch(() => undefined);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Marks of a step under way (W9)
  // -------------------------------------------------------------------------

  /** Whether a step of `network`'s trapped and wasn't tried again: its sync isn't started by itself. No key needed. */
  private async isStopped(network: NetworkName): Promise<boolean> {
    return (await this.deps.local.get(trapKey(network))) !== undefined;
  }

  /**
   * Writes `step`'s mark of `network` (W9, W13), `mark` undefined clearing it, after any write of that mark before,
   * under `pin` when given. Each step's is a record of its own, so a scan that traps while a take runs names only what
   * it scanned, and the other way. An emptied mark is written as an empty one, so the record keeps its room; one
   * nothing was written in is never written empty. Bookkeeping (W11): never refused for the budget, but never past the
   * area's reserve, which throws ReserveReached.
   */
  private setMark(network: NetworkName, step: MarkStep, mark: ScanMark | TakeMark | undefined, pin?: PhrasePin): Promise<void> {
    const name = markRecord(network, step);
    const value = mark ?? {};
    const empty = Object.keys(value).length === 0;
    const run = (this.markWrites.get(name) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        if (empty && this.marked.get(name) === false) return;
        if (pin) await this.withKey((_key, keys) => pin(keys));
        // The same size at every write but the first: a mark is a few words, inside the smallest pad.
        await this.put(network, name, value, "bookkeeping", this.marked.has(name) ? 0 : PAD_STORED);
        this.marked.set(name, !empty);
      });
    this.markWrites.set(name, run);
    return run;
  }

  /**
   * One of `step`'s own WebAssembly calls trapped, and the wallet locked: its mark stays, and beside it which step it
   * was (W13), which needs no key. The next unlock starts nothing of the network by itself (W9).
   */
  private async noteTrap(network: NetworkName, step: MarkStep): Promise<void> {
    await this.deps.local.set(trapKey(network), step);
    this.deps.changed?.(network);
  }

  /** `call`, a WebAssembly call of `step`'s: a trap in it is the step's own, whatever else it meets (W9). */
  private watch<T>(step: Step | undefined, call: () => T): T {
    try {
      return call();
    } catch (e) {
      if (step && isTrap(e)) step.trapped = true;
      throw e;
    }
  }

  // -------------------------------------------------------------------------
  // Records
  // -------------------------------------------------------------------------

  private async inbox(network: NetworkName): Promise<Inbox> {
    const kept = await this.got<StoredInbox & { lost?: unknown; expiredAt?: unknown }>(`messaging.${network}`);
    if (!kept) return emptyInbox();
    // Another build's version is an inbox that won't open (W15): what it holds is never misread, nor written over.
    if (!READS_VERSIONS.has(kept.v)) throw new UnreadableRecordError(`messaging.${network}`);
    // What builds before the 1.10.0 gate kept that this one doesn't: a count of conversations this browser doesn't
    // hold (W3), and when it last expired, which session storage now keeps.
    const { lost: _lost, expiredAt: _expiredAt, requestsShown, requests, requestsAside, tombstones, v, ...rest } = kept;
    const binary = (value: string | undefined) => (value === undefined ? undefined : v === 2 ? hexOfBase64(value) : value);
    const inbox: Inbox = {
      ...emptyInbox(),
      ...rest,
      v: 2,
      ...(requests !== undefined ? { requests: binary(requests)! } : {}),
      ...(requestsAside?.length ? { requestsAside: requestsAside.map((r) => binary(r)!) } : {}),
      ...(tombstones !== undefined ? { tombstones: binary(tombstones)! } : {}),
      requestsShown: requestsShown ?? {},
    };
    // An inbox from before the 1.10.0 gate kept no list of its requests: made once from the record, and written with
    // the inbox's next write. One the crate can't read is set aside or dropped (`asideRequests`).
    if (inbox.requests !== undefined && !requestsShown) {
      let listed: RequestInfo[] | RecordRefused;
      try {
        listed = this.requestsInfo(inbox.requests);
      } catch (e) {
        if (e instanceof WalletLocked) throw e;
        listed = { refused: "invalid_state" };
      }
      if (isRefused(listed)) this.asideRequests(inbox, listed);
      else for (const info of listed) inbox.requestsShown[info.cid] = shownOf(info);
    }
    return inbox;
  }

  /**
   * Writes `network`'s inbox (W7, W11). `content`, the default: within the budget where it grows, as the budget counts
   * it (without the requests), making room first, and throwing MessagingFull, writing nothing, when it can't.
   * `requests`: the requests' own room, bounded by the crate, never the budget. `bookkeeping` (the cursor, which Seedelfs
   * take first messages, what was read, a mark of what's unreadable, a name, what a record now holds): makes room best
   * effort, and is never refused for the budget. Whatever its kind, a write that grows storage never crosses the area's
   * reserve (`put`).
   */
  private async writeInbox(network: NetworkName, inbox: Inbox, { kind = "content" }: { kind?: WriteKind } = {}): Promise<void> {
    await this.sizesNow();
    const known = this.sizes.get(network);
    const was = known?.inbox ?? (await this.storedNow(`messaging.${network}`));
    let lean = sizeOf(inboxToStored(leanOf(inbox)));
    if (kind !== "requests" && (known === undefined || lean > known.lean)) {
      const over = (await this.totalWith(network, inbox, { lean })) - this.budget();
      if (over > 0) {
        try {
          // What this write grows the area by, for the reserve's look before any trim is written (f3).
          await this.makeRoom(network, inbox, undefined, over, sizeOf(inboxToStored(inbox)) - was);
        } catch (e) {
          // Bookkeeping never waits on room: written all the same, within the reserve.
          if (!(e instanceof MessagingFull) || kind === "content") throw e;
        }
        lean = sizeOf(inboxToStored(leanOf(inbox)));
      }
    }
    const stored = inboxToStored(inbox);
    const bytes = sizeOf(stored);
    await this.put(network, `messaging.${network}`, stored, kind, bytes - was);
    this.sizes.set(network, { inbox: bytes, lean, total: lean + conversationBytes(inbox) });
  }

  /**
   * A conversation's record, or undefined when the inbox names none, or it isn't there. Throws if it won't open, and
   * for another build's version (W15): it's then set aside, never misread or written over, and can be deleted.
   */
  private async file(network: NetworkName, meta: Meta): Promise<ConversationFile | undefined> {
    if (!meta.id) return undefined;
    const name = conversationRecord(network, meta.id);
    const stored = await this.got<ConversationFile>(name);
    if (stored && !READS_VERSIONS.has((stored as { v?: unknown }).v)) throw new UnreadableRecordError(name);
    return stored && fileFromStored(stored);
  }

  /** What a record takes now as it's stored (its sealed data's length), with no key: 0 when there's none. */
  private async storedNow(name: RecordName): Promise<number> {
    return (await this.area<{ data?: string }>(PRIVATE_PREFIX + name))?.data?.length ?? 0;
  }

  /**
   * A sealed record of Messages' (f2): undefined when there's none; UnreadableRecordError for one that won't open, and a
   * lock, as they are; a read of the storage area that fails, StorageFailed.
   */
  private async got<T>(name: RecordName): Promise<T | undefined> {
    try {
      return await this.deps.store.get<T>(name);
    } catch (e) {
      throw failedRead(e);
    }
  }

  /** chrome.storage.local's own read, of what Messages reads with no key (f2): a read that fails is StorageFailed. */
  private async area<T>(key: string): Promise<T | undefined> {
    try {
      return await this.deps.local.get<T>(key);
    } catch (e) {
      throw failedRead(e);
    }
  }

  /**
   * Runs `task` on `network`'s take record after every earlier one (finding 8): a chain of its own, so the write after a
   * read never waits behind the take's work in the queue, nor the queue behind it.
   */
  private onTakes<T>(network: NetworkName, task: () => Promise<T>): Promise<T> {
    const run = (this.takeWrites.get(network) ?? Promise.resolve()).catch(() => undefined).then(task);
    this.takeWrites.set(network, run);
    return run;
  }

  /** The unlock what's in memory belongs to (`unlockedAt`): undefined while locked. */
  private async unlockStamp(): Promise<number | undefined> {
    return this.deps.wallet.unlockedAt().catch(() => undefined);
  }

  /** `network`'s take record (finding 8): as this service holds it, or read in its chain, once per unlock and epoch. */
  private async takesFor(network: NetworkName, pin?: PhrasePin): Promise<TakesHeld> {
    const held = this.takes.get(network);
    if (held && held.epoch === this.epochOf(network) && held.at === (await this.unlockStamp())) return held;
    return this.onTakes(network, () => this.takesOf(network, pin));
  }

  /**
   * `network`'s take record, in its chain (`onTakes`): as held, or read from storage under the phrase `pin` binds (a fresh
   * one, bound now, without it). One that won't open holds nothing a read can't bring back: the next read goes from the
   * pool's oldest, and it's written over.
   */
  private async takesOf(network: NetworkName, pin?: PhrasePin): Promise<TakesHeld> {
    const at = await this.unlockStamp();
    const epoch = this.epochOf(network);
    const held = this.takes.get(network);
    if (held && held.at === at && held.epoch === epoch) return held;
    const opened = pin ?? phrasePin();
    await this.withKey((_key, keys) => opened(keys));
    let stored: StoredTakes | undefined;
    let there = false;
    try {
      stored = await this.got<StoredTakes>(takeRecord(network));
      there = stored !== undefined;
    } catch (e) {
      if (!(e instanceof UnreadableRecordError)) throw e;
      there = true;
    }
    const now: TakesHeld = { ...takesFromStored(stored, opened), at, epoch, stored: there, bytes: there ? await this.storedNow(takeRecord(network)) : 0 };
    this.takes.set(network, now);
    return now;
  }

  /** `network`'s take record as it stands, for what's shown: as held, or read from storage, keeping nothing. */
  private async takesNow(network: NetworkName): Promise<Takes> {
    const held = this.takes.get(network);
    if (held && held.epoch === this.epochOf(network) && held.at === (await this.unlockStamp())) return held;
    const stored = await this.got<StoredTakes>(takeRecord(network)).catch((e: unknown) => {
      if (e instanceof UnreadableRecordError) return undefined;
      throw e;
    });
    return takesFromStored(stored, phrasePin());
  }

  /**
   * Writes `network`'s take record as `next` (bookkeeping, W11: never refused for the budget, never past the area's
   * reserve, which throws ReserveReached and stops the taking), and holds it so, in `held`'s unlock and epoch.
   */
  private async writeTakes(network: NetworkName, held: TakesHeld, next: Takes): Promise<void> {
    const stored = takesToStored(next);
    const bytes = sizeOf(stored);
    await this.put(network, takeRecord(network), stored, "bookkeeping", held.stored ? bytes - held.bytes : bytes);
    this.takes.set(network, {
      cursor: next.cursor,
      gapAt: next.gapAt,
      batches: next.batches,
      unopened: next.unopened,
      noRoom: next.noRoom,
      at: held.at,
      epoch: held.epoch,
      stored: true,
      bytes,
    });
  }

  /** A conversation's record, or undefined when there's none or it won't open: for what runs by itself. */
  private async readable(network: NetworkName, meta: Meta): Promise<ConversationFile | undefined> {
    try {
      return await this.file(network, meta);
    } catch (e) {
      if (e instanceof UnreadableRecordError) return undefined;
      throw e;
    }
  }

  /** A conversation's record for a press of the user's: one that won't open is marked so (W9), and its error thrown. */
  private async fileFor(network: NetworkName, inbox: Inbox, meta: Meta): Promise<ConversationFile | undefined> {
    try {
      return await this.file(network, meta);
    } catch (e) {
      if (e instanceof UnreadableRecordError && !meta.unreadable) {
        meta.unreadable = true;
        await this.writeInbox(network, inbox, { kind: "bookkeeping" }).catch(() => undefined);
        this.deps.changed?.(network);
      }
      throw e;
    }
  }

  /**
   * A conversation's record read without its secrets, for a press of the user's: one the crate can't read is marked as
   * one that can't be opened (W9), and said as a record that won't open.
   */
  private async infoFor(network: NetworkName, inbox: Inbox, meta: Meta, state: string): Promise<ConversationInfo> {
    try {
      return this.info(state);
    } catch (e) {
      if (e instanceof WalletLocked) throw e;
      if (!meta.unreadable) {
        meta.unreadable = true;
        await this.writeInbox(network, inbox, { kind: "bookkeeping" }).catch(() => undefined);
        this.deps.changed?.(network);
      }
      throw new UnreadableRecordError(conversationRecord(network, meta.id ?? "-"));
    }
  }

  /** Whether `network`'s relay may be asked now: its switch on, and the wallet unlocked. */
  private async mayAsk(network: NetworkName): Promise<boolean> {
    return (await this.isOn(network)) && (await this.deps.wallet.state()) === "unlocked";
  }

  /**
   * When a post of `envelope`'s size may be tried again on `network` (`monotonic` ms, W14): every post's wait, or its
   * size's.
   */
  private waitFor(network: NetworkName, envelope: string): number {
    return Math.max(this.postAfter.get(network) ?? 0, this.sizeAfter.get(network)?.get(envelope.length / 2) ?? 0);
  }

  /** `network`'s waits by size. */
  private sizesOf(network: NetworkName): Map<number, number> {
    let sizes = this.sizeAfter.get(network);
    if (!sizes) this.sizeAfter.set(network, (sizes = new Map()));
    return sizes;
  }

  /** The build's networks. */
  private networks(): readonly NetworkName[] {
    return this.deps.networks ?? (Object.keys(NETWORKS) as NetworkName[]);
  }

  /**
   * Lists a new conversation in `inbox` and writes its record within the budget; the inbox is the caller's to write.
   * Nothing is listed when the record can't be written. The room the record needs is made only where the area's reserve
   * holds the record and the inbox that lists it together (f3).
   */
  private async addConversation(
    network: NetworkName,
    inbox: Inbox,
    cid: string,
    file: ConversationFile,
    meta: Omit<Meta, "id" | "outbox" | "bytes" | "oldestAt">,
  ): Promise<void> {
    inbox.conversations[cid] = { ...meta, id: newRecordId(), outbox: 0, bytes: 0, oldestAt: meta.startedAt };
    try {
      await this.sizesNow();
      const listed = sizeOf(inboxToStored(inbox)) - (this.sizes.get(network)?.inbox ?? (await this.storedNow(`messaging.${network}`)));
      await this.writeFile(network, inbox, cid, file, "content", undefined, listed);
    } catch (e) {
      delete inbox.conversations[cid];
      throw e;
    }
  }

  /**
   * Writes conversation `cid`'s record within the budget where it grows (W7), and sets what the inbox shows of it from
   * the record; the inbox is the caller's to write. Throws MessagingFull, writing nothing, when it can't fit (but for
   * bookkeeping, which makes room best effort and is never refused for the budget); and where the area's reserve can't
   * hold the write with the room made for it, nothing is deleted for it either (f3). A browser that refuses the record's
   * own write, or a stop, after the room was made leaves the oldest read messages that made it gone, as the budget would
   * delete them next. `keep`: the entry this write is for, which no trim of its own deletes: a message never pays for its
   * own room (W11). `alsoGrows`: what a write right after it grows the area by (the inbox that lists a new one).
   */
  private async writeFile(
    network: NetworkName,
    inbox: Inbox,
    cid: string,
    file: ConversationFile,
    kind: WriteKind = "content",
    keep?: number,
    alsoGrows = 0,
  ): Promise<void> {
    const meta = inbox.conversations[cid]!;
    let stored = fileToStored(file);
    let bytes = sizeOf(stored);
    if (bytes > meta.bytes) {
      await this.sizesNow();
      const over = (await this.totalWith(network, inbox, { cid, bytes })) - this.budget();
      if (over > 0) {
        try {
          await this.makeRoom(network, inbox, { cid, file, keep }, over, alsoGrows);
        } catch (e) {
          if (!(e instanceof MessagingFull) || kind !== "bookkeeping") throw e;
        }
        stored = fileToStored(file);
        bytes = sizeOf(stored);
      }
    }
    await this.put(network, conversationRecord(network, meta.id!), stored, kind, bytes - meta.bytes);
    Object.assign(meta, measure(file, meta, bytes));
    // What's left of the writer's share, as this write leaves it (W17): only a message written or taken moves it, and a
    // reply ends it.
    if (meta.role !== "initiator" || meta.answered) delete meta.firstContactLeft;
    else if (kind === "content") this.noteShare(meta, file);
  }

  /**
   * Sets what the inbox shows of the writer's share from `file` (W17, `shareOf`): an initiator's, before a reply. A
   * record the crate can't read says none.
   */
  private noteShare(meta: Meta, file: ConversationFile): void {
    let share: ShareLeft | undefined;
    try {
      share = shareOf(this.info(file.state).firstContactLeft, file.history);
    } catch (e) {
      if (e instanceof WalletLocked) throw e;
    }
    if (share) meta.firstContactLeft = share;
    else delete meta.firstContactLeft;
  }

  /**
   * Writes a conversation's record, then the inbox with what it shows of it: the record's write is `kind`'s (a message
   * made or taken: `content`; a post marked, bytes sent again, a check's outcome: `bookkeeping`), and the inbox's after
   * it bookkeeping, since it only says what the record now holds. `keep`: as `writeFile`'s. An inbox write that fails
   * after the record's is noted (f4), and the entry set right at the take's next bookkeeping write: it's thrown again,
   * but for a press of the user's (`press`) whose record now holds its message, which then succeeds, the post reading it
   * whatever the inbox counts; a lock or a trap is thrown all the same.
   */
  private async commit(
    network: NetworkName,
    inbox: Inbox,
    cid: string,
    file: ConversationFile,
    kind: WriteKind = "content",
    keep?: number,
    press = false,
  ): Promise<void> {
    await this.writeFile(network, inbox, cid, file, kind, keep);
    const noted = this.inboxBehind.get(network)?.has(cid);
    // One whose inbox write failed before: its entry set right from the record in hand, as the sweep would.
    const meta = inbox.conversations[cid];
    if (noted && meta) Object.assign(meta, countsOf(file, meta));
    try {
      await this.writeInbox(network, inbox, { kind: "bookkeeping" });
    } catch (e) {
      this.noteBehind(network, cid, press);
      if (press && !(e instanceof WalletLocked) && !isTrap(e)) return;
      throw e;
    }
    if (noted) this.clearNoted(network, [cid]);
  }

  /**
   * Seals a record of `network`'s (W7, W11). A write that grows storage by `growth` bytes leaves the area's reserve free
   * first. A write the reserve or the browser refuses (its quota, or otherwise) isn't made: MessagingFull for a
   * message's or a request's; for bookkeeping ReserveReached, and Messages stops taking until room is made.
   */
  private async put(network: NetworkName, name: RecordName, value: unknown, kind: WriteKind, growth: number): Promise<void> {
    if (growth > 0 && !(await this.reserveHolds(growth))) throw this.refusal(network, kind);
    try {
      await this.deps.store.set(name, value);
    } catch (e) {
      if (e instanceof WalletLocked || isTrap(e)) throw e;
      throw this.refusal(network, kind);
    }
  }

  /** A write of `kind` refused for room: bookkeeping's stops Messages taking on `network` (W11). */
  private refusal(network: NetworkName, kind: WriteKind): MessagingFull {
    if (kind !== "bookkeeping") return new MessagingFull();
    this.full.add(network);
    return new ReserveReached();
  }

  /**
   * Whether the storage area keeps its reserve free with `growth` bytes more (W11): chrome.storage.local's own count,
   * the wallet's other records and payments' included. True where it can't be counted.
   */
  private async reserveHolds(growth: number): Promise<boolean> {
    const used = await this.deps.bytesInUse?.().catch(() => undefined);
    if (used === undefined) return true;
    return used + growth <= (this.deps.quotaBytes ?? QUOTA_BYTES) - (this.deps.reserveBytes ?? RESERVE_BYTES);
  }

  private budget(): number {
    return this.deps.budgetBytes ?? MESSAGES_BUDGET_BYTES;
  }

  /** Forgets what records take, as kept, once the wallet has unlocked again: another phrase's may be there now. */
  private async sizesNow(): Promise<void> {
    const at = await this.deps.wallet.unlockedAt().catch(() => undefined);
    if (at === this.sizesAt) return;
    this.sizes.clear();
    this.sizesAt = at;
  }

  /**
   * What every Messages record of every network would take as stored, as the budget counts it (W7, W11): the inboxes
   * without their requests, which have a room of their own, and every conversation's record. `network`'s from `inbox`
   * as it is in memory, with its own lean size `lean` or conversation `cid`'s `bytes` in place of what's kept, and the
   * others' as they were last read or written.
   */
  private async totalWith(network: NetworkName, inbox: Inbox, given: { lean?: number; cid?: string; bytes?: number }): Promise<number> {
    let total = given.lean ?? sizeOf(inboxToStored(leanOf(inbox)));
    for (const [cid, meta] of Object.entries(inbox.conversations)) total += cid === given.cid ? given.bytes! : meta.bytes;
    for (const other of this.networks()) if (other !== network) total += await this.totalOf(other);
    return total;
  }

  /** What `network`'s Messages records take as the budget counts them, as last read or written: read once when not known. */
  private async totalOf(network: NetworkName): Promise<number> {
    const known = this.sizes.get(network);
    if (known) return known.total;
    let sizes: { total: number; inbox: number; lean: number };
    try {
      const inbox = await this.inbox(network);
      const stored = (await this.area(PRIVATE_PREFIX + `messaging.${network}`)) !== undefined;
      const lean = stored ? sizeOf(inboxToStored(leanOf(inbox))) : 0;
      sizes = { inbox: stored ? sizeOf(inboxToStored(inbox)) : 0, lean, total: lean + conversationBytes(inbox) };
    } catch (e) {
      if (!(e instanceof UnreadableRecordError)) throw e;
      // An inbox that won't open: what its records take as they're stored, by their sealed lengths.
      const keys = [PRIVATE_PREFIX + `messaging.${network}`, ...(await this.deps.local.keys(PRIVATE_PREFIX + CONVERSATION_RECORDS + network + "."))];
      let total = 0;
      for (const key of keys) total += (await this.area<{ data?: string }>(key))?.data?.length ?? 0;
      sizes = { inbox: 0, lean: 0, total };
    }
    this.sizes.set(network, sizes);
    return sizes.total;
  }

  /**
   * Frees at least `over` bytes of what Messages stores, by deleting old messages (W7): first `writing`'s own, down to
   * the conversation's share, then, again and again, the oldest of whichever record a trim frees the most from, read
   * messages before unread, over every conversation on every network. A message still to be posted stays, and nothing
   * is deleted for bytes no deletion frees (the crate's state with its skipped keys, the outbox, requests): a record's
   * size moves only by powers of two, so a trim that doesn't take it down one frees nothing and isn't made. When the
   * plan can't free `over`, nothing is deleted at all, and it throws MessagingFull; and so when the area's reserve can't
   * hold the caller's write with what the plan frees (f3), which is looked at before any trim is written: `grows`, what
   * the caller's write (the inbox's, where `writing` is none) or the one right after it grows the area by, beside
   * `writing`'s own growth as planned. `writing` is the caller's to write, and `inbox` too; every other record a trim
   * changes is written here.
   */
  private async makeRoom(
    network: NetworkName,
    inbox: Inbox,
    writing: { cid: string; file: ConversationFile; keep?: number } | undefined,
    over: number,
    grows = 0,
  ): Promise<void> {
    interface Plan {
      network: NetworkName;
      inbox: Inbox;
      cid: string;
      meta: Meta;
      file?: ConversationFile;
      /** What it takes as stored, as planned. */
      bytes: number;
      /** Entries planned away, by id. */
      drop: Set<number>;
      /** No trim of it frees anything more. */
      spent: boolean;
    }
    const inboxes = new Map<NetworkName, Inbox>([[network, inbox]]);
    for (const other of this.networks()) {
      if (other === network) continue;
      const kept = await this.inbox(other).catch((e: unknown) => {
        if (e instanceof UnreadableRecordError) return undefined;
        throw e;
      });
      if (kept) inboxes.set(other, kept);
    }
    const plans: Plan[] = [];
    for (const [n, i] of inboxes) {
      for (const [cid, meta] of Object.entries(i.conversations)) {
        if (!meta.id || meta.unreadable) continue;
        const own = n === network && writing?.cid === cid;
        plans.push({
          network: n,
          inbox: i,
          cid,
          meta,
          ...(own ? { file: writing.file } : {}),
          bytes: own ? sizeOf(fileToStored(writing.file)) : meta.bytes,
          drop: new Set(),
          spent: false,
        });
      }
    }
    let freed = 0;
    const share = this.deps.shareBytes ?? CONVERSATION_SHARE_BYTES;
    /** One trim of `plan`: its size down one power of two, or nothing. What it frees. */
    const trim = async (plan: Plan): Promise<number> => {
      plan.file ??= await this.readable(plan.network, plan.meta);
      // The entry being written is never what pays for its own room (W11): one that doesn't fit isn't kept instead.
      const keep = plan.network === network && plan.cid === writing?.cid ? writing.keep : undefined;
      const step = plan.file && trimStep(plan.file, plan.meta, plan.drop, keep);
      if (!step) {
        plan.spent = true;
        return 0;
      }
      for (const id of step.drop) plan.drop.add(id);
      const less = plan.bytes - step.bytes;
      plan.bytes = step.bytes;
      freed += less;
      return less;
    };
    // 1. The conversation being written, down to its own share: a flood shortens its own conversation first.
    const own = plans.find((p) => p.network === network && p.cid === writing?.cid);
    while (own && !own.spent && own.bytes > share && freed < over) await trim(own);
    // 2. Then whichever record a trim frees the most from: the largest, which is down a power of two the soonest.
    while (freed < over) {
      const next = plans.filter((p) => !p.spent).sort((a, b) => b.bytes - a.bytes || a.meta.oldestAt - b.meta.oldestAt)[0];
      if (!next) break;
      await trim(next);
    }
    if (freed < over) throw new MessagingFull();
    // The area's reserve, with the room the plan makes, before any trim is written (f3): the write this room is for, as
    // `put` will look at it, less what the other records' trims free. Where it wouldn't hold, nothing is deleted.
    const growth = Math.max(0, own ? own.bytes - own.meta.bytes : 0) + Math.max(0, grows);
    const frees = plans.reduce((sum, p) => (p === own || !p.drop.size ? sum : sum + Math.max(0, p.meta.bytes - p.bytes)), 0);
    if (growth > 0 && !(await this.reserveHolds(growth - frees))) throw new MessagingFull();
    // The plan frees enough: made.
    const touched = new Set<NetworkName>();
    for (const plan of plans) {
      if (!plan.drop.size || !plan.file) continue;
      const before = plan.file.history.length;
      const unread = unreadIds(plan.file, plan.meta);
      plan.file.history = plan.file.history.filter((e) => !plan.drop.has(e.id));
      plan.file.trimmed += before - plan.file.history.length;
      plan.meta.unread = Math.max(0, plan.meta.unread - [...plan.drop].filter((id) => unread.has(id)).length);
      if (plan.network === network && plan.cid === writing?.cid) continue;
      const stored = fileToStored(plan.file);
      const bytes = sizeOf(stored);
      // Smaller than it was: nothing for the reserve to hold.
      await this.put(plan.network, conversationRecord(plan.network, plan.meta.id!), stored, "bookkeeping", bytes - plan.meta.bytes);
      Object.assign(plan.meta, measure(plan.file, plan.meta, bytes));
      if (plan.network !== network) touched.add(plan.network);
    }
    for (const n of touched) await this.writeInbox(n, inboxes.get(n)!, { kind: "bookkeeping" });
  }

  /** When `network`'s skipped keys and tombstones were last expired (ms), this unlock. */
  private async expiredAt(network: NetworkName): Promise<number | undefined> {
    const session = this.deps.session;
    if (!session) return this.expired.get(network);
    const kept = await session.get<Partial<Record<NetworkName, number>>>(SESSION_EXPIRED_AT).catch(() => undefined);
    return kept?.[network];
  }

  private async noteExpired(network: NetworkName, at: number): Promise<void> {
    this.expired.set(network, at);
    const session = this.deps.session;
    if (!session) return;
    const kept = (await session.get<Partial<Record<NetworkName, number>>>(SESSION_EXPIRED_AT).catch(() => undefined)) ?? {};
    await session.set(SESSION_EXPIRED_AT, { ...kept, [network]: at }).catch(() => undefined);
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
      // What's left of the writer's own share of first messages, before a reply (W17).
      ...(meta.firstContactLeft && meta.role === "initiator" && !meta.answered ? { firstContactLeft: meta.firstContactLeft } : {}),
      ...(meta.restartedAs ? { restartedAs: meta.restartedAs } : {}),
      ...(meta.unreachable ? { unreachable: true as const } : {}),
      ...(meta.unreadable ? { unreadable: true as const } : {}),
      ...(meta.last ? { last: meta.last } : {}),
      ...(meta.name ? { name: meta.name } : {}),
      ...(meta.revealed ? { revealed: meta.revealed } : {}),
    };
  }

  /** A conversation's record read without its secrets. */
  private info(state: string): ConversationInfo {
    return this.read(this.wasmCall(() => this.deps.wasm.messagingConversationInfo(state)));
  }

  /** The requests a record holds, oldest first, or the crate's refusal of the record (W17): another version's, or damaged. */
  private requestsInfo(requests: string, step?: Step): RequestInfo[] | RecordRefused {
    return this.read(this.wasmCall(() => this.watch(step, () => this.deps.wasm.messagingRequestsInfo(requests))));
  }

  /**
   * The bindings' numbers (W17). A module that gives no price ceiling, or no version of the requests' record, is
   * another build's: nothing is solved for a post, and no record is set aside or dropped, by a guess at either.
   */
  private constantsOf(): MessagingConstants {
    if (!this.constants) {
      const given = this.read<MessagingConstants>(this.wasmCall(() => this.deps.wasm.messagingConstants()));
      if (!Number.isInteger(given.priceCeilingBits) || !Number.isInteger(given.requestsVersion)) {
        throw new Error("the WebAssembly module gives no price ceiling or requests' version: another build's");
      }
      this.constants = given;
    }
    return this.constants;
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
    this.checkFits(this.info(state).maxTextLen, text);
  }

  /** Refuses a text longer than `maxTextLen`, its kind byte counted. */
  private checkFits(maxTextLen: number, text: string): void {
    if (new TextEncoder().encode(text).length + 1 > maxTextLen) {
      throw new Error(t("worker.messaging.tooLong", { max: Math.max(0, maxTextLen - 1) }));
    }
  }

  private checkText(text: string): void {
    if (typeof text !== "string" || !text.trim()) throw new Error(t("worker.messaging.empty"));
  }

  /**
   * `task` with the Seedelf key, in the wallet's queue: throws if locked. A read of storage the wallet makes before the
   * task, of its session, fails as StorageFailed (f2); what the task throws is its own.
   */
  private async withKey<T>(task: (key: Wasm.SeedelfKey, keys: Parameters<PhrasePin>[0]) => T): Promise<T> {
    let ran = false;
    try {
      return await this.deps.wallet.withKeys((keys) => {
        ran = true;
        return task(keys.seedelf, keys);
      });
    } catch (e) {
      throw ran ? e : failedRead(e);
    }
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
    return this.pause(0);
  }

  /** A wait of `ms`, out of the queue: a timer. */
  private pause(ms: number): Promise<void> {
    return (this.deps.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(ms);
  }

  /** The monotonic clock (ms, W14): what every wait kept in memory runs on, never this device's clock. */
  private mono(): number {
    return this.deps.monotonic ? this.deps.monotonic() : performance.now();
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
    while (this.background.size || this.syncs.size || this.posting.size || this.checks.size) {
      await Promise.all(
        [...this.background, ...this.syncs.values(), ...[...this.posting.values()].map((p) => p.running), ...this.checks.values()].map((p) =>
          p.catch(() => undefined),
        ),
      );
    }
  }

  /** Runs `task` after every earlier state change. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * One run of `task` at a time per network; asked during one, it's that one, and nothing runs after it: a sync's next
   * read comes at the next tick, never as the last one's work ends (W4).
   */
  private join(runs: Map<NetworkName, Promise<void>>, network: NetworkName, task: () => Promise<void>): Promise<void> {
    const running = runs.get(network);
    if (running) return running;
    const run = (async () => {
      try {
        await task();
      } finally {
        runs.delete(network);
      }
    })();
    runs.set(network, run);
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
 * What the bindings' `messagingConstants` gives (54d, W17), so the worker holds no copy of them: the first-contact
 * stamp's bits, the four envelope sizes, how old a first message may be read (s), a request's share (16 messages and
 * 65,536 bytes, which `firstContactLeft` follows), the most keys a message past the skipped keys' bound is stepped, the
 * most work the wallet solves for a post (26 bits, protocol.md §20), and the requests' record's version this build
 * writes.
 */
interface MessagingConstants {
  firstContactStampBits: number;
  envelopeSizes: number[];
  firstContactMaxAge?: number;
  maxRequests?: number;
  maxRequestBytes?: number;
  maxRequestMessages?: number;
  maxOneRequestBytes?: number;
  maxAuthSteps?: number;
  priceCeilingBits: number;
  requestsVersion: number;
}

/** A conversation's record without its secrets, as `messagingConversationInfo` gives it (54d): what the worker reads. */
interface ConversationInfo {
  missing: number;
  /** The next message's room, its kind byte included: the largest envelope's, and before a reply the share's. */
  maxTextLen: number;
  sendsFirstContact: boolean;
  /** What's left of the writer's share while it sends first-contact messages; null after a reply, and at the responder. */
  firstContactLeft: ShareInfo | null;
}

/** A request as `messagingRequestsInfo` gives it. */
interface RequestInfo {
  cid: string;
  t: number;
  to: string;
  continues: { cid: string; verified: boolean } | null;
  arrivals: number[];
}

/** What the list shows of a request, from what the bindings say of it. */
function shownOf(info: RequestInfo): RequestShown {
  return {
    t: info.t,
    to: info.to,
    ...(info.continues ? { continues: info.continues } : {}),
    messages: info.arrivals.length,
    last: info.arrivals.at(-1) ?? info.t,
  };
}

/** The user's choice for the Seedelf `name` at `register`, if they made one (`answerAt`). */
function choiceOf(inbox: Inbox, name: string, register: RegisterHex): { on: boolean } | undefined {
  return inbox.answerAt?.find((c) => c.name === name && sameRegister(c.register, register));
}

function sameHandles(a: Record<string, RegisterHex[]>, b: Record<string, RegisterHex[]>): boolean {
  const keys = (h: Record<string, RegisterHex[]>) =>
    Object.entries(h)
      .flatMap(([name, registers]) => registers.map((r) => pairKey(name, r)))
      .sort();
  return sameList(keys(a), keys(b));
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Every conversation's record of `inbox`, as stored. */
const conversationBytes = (inbox: Inbox) => Object.values(inbox.conversations).reduce((sum, m) => sum + m.bytes, 0);

/** Whether a read that ended at `cursor` has gone past the page `span`. */
function pastSpan(cursor: string | undefined, span: PageSpan): boolean {
  try {
    return cursor !== undefined && BigInt(cursor) >= BigInt(span.to);
  } catch {
    return false;
  }
}

/** Received entries from `readTo` on: what's unread of a record, where the inbox says from where (W9). */
function unreadIn(file: ConversationFile, readTo: number | undefined): number {
  return readTo === undefined ? 0 : file.history.filter((e) => e.dir === "in" && e.id >= readTo).length;
}

/** The ids of a record's unread entries: received from `readTo` on, or, with none kept, its last `unread` received. */
function unreadIds(file: ConversationFile, meta: Pick<Meta, "readTo" | "unread">): Set<number> {
  const received = file.history.filter((e) => e.dir === "in");
  const unread = meta.readTo !== undefined ? received.filter((e) => e.id >= meta.readTo!) : received.slice(received.length - meta.unread);
  return new Set(unread.map((e) => e.id));
}

/**
 * The fewest of `file`'s oldest messages, read ones before unread, never one still to be posted, whose deletion takes
 * its stored size down one power of two, beside those `drop` already plans away; with that size. Undefined when no
 * deletion can (the record holds too little history, or is at the smallest size).
 */
function trimStep(file: ConversationFile, meta: Meta, drop: ReadonlySet<number>, keep?: number): { drop: number[]; bytes: number } | undefined {
  const kept = file.history.filter((e) => !drop.has(e.id));
  const planned = { ...file, history: kept, trimmed: file.trimmed + drop.size };
  const length = utf8Length(JSON.stringify(fileToStored(planned)));
  let size = 1024;
  while (size < length) size *= 2;
  if (size <= 1024) return undefined;
  const target = size / 2;
  const unread = unreadIds(file, meta);
  const deletable = kept.filter((e) => e.sent !== "queued" && e.sent !== "pending" && e.id !== keep);
  const order = [...deletable.filter((e) => !unread.has(e.id)), ...deletable.filter((e) => unread.has(e.id))];
  const stored = fileToStored({ ...planned, history: order });
  // Each entry's share of the record's JSON: its own and the comma before it.
  const weights = stored.history.map((e) => utf8Length(JSON.stringify(e)) + 1);
  const now = storedBytes(length);
  let left = length;
  const out: number[] = [];
  for (const [i, entry] of order.entries()) {
    out.push(entry.id);
    left -= weights[i]!;
    if (left > target) continue;
    // Worked out exactly, the count of what's deleted grown with it: one more where the estimate fell short.
    const after = { ...planned, history: kept.filter((e) => !out.includes(e.id)), trimmed: planned.trimmed + out.length };
    const bytes = sizeOf(fileToStored(after));
    if (bytes < now) return { drop: out, bytes };
  }
  return undefined;
}

/**
 * What a reveal's message shows: the Seedelf shown; one whose proof verified, not yet checked on the chain or being
 * checked now, never named; verified, with its name; or failed, never named.
 */
function revealView(entry: Entry, checking: boolean): NonNullable<MessagingEntry["reveal"]> {
  const reveal = entry.reveal;
  if (reveal && "dir" in reveal) return { status: "shown", name: reveal.name };
  if (reveal?.status === "verified") return { status: "verified", name: reveal.name };
  if (isUnchecked(entry)) return { status: checking ? "checking" : "unchecked" };
  return { status: "failed" };
}

/**
 * A trap ends a run, as runs.ts's does; any other failure is that network's alone. One `wasmCall` or the wallet's
 * queue caught has locked the wallet already.
 */
function rethrowTrap(e: unknown): void {
  if (isTrap(e)) throw e;
}

/**
 * What the inbox shows of a conversation that its record decides: its storage (`bytes`, as stored), its outbox, its
 * oldest message, its last, and its reveals.
 */
function measure(
  file: ConversationFile,
  meta: Pick<Meta, "lastAt" | "revealed">,
  bytes: number,
): Pick<Meta, "bytes" | "outbox" | "oldestAt" | "last" | "unchecked" | "revealed"> {
  return {
    bytes,
    outbox: file.history.filter((e) => e.sent === "queued" || e.sent === "pending").length,
    oldestAt: file.history[0]?.at ?? meta.lastAt,
    last: lastOf(file.history),
    ...revealsOf(file, meta.revealed),
  };
}

/**
 * What the inbox counts of a conversation, set right from its record (W9): answered once a reply is in it, its last
 * message's time, and, where the inbox says from where the thread was last shown, what's unread since.
 */
function countsOf(file: ConversationFile, meta: Meta): Pick<Meta, "answered" | "lastAt" | "unread"> {
  const answered = meta.answered || (meta.role === "initiator" && file.history.some((e) => e.dir === "in"));
  return {
    ...(answered ? { answered: true } : {}),
    lastAt: Math.max(meta.lastAt, file.history.at(-1)?.at ?? 0),
    unread: meta.readTo !== undefined ? unreadIn(file, meta.readTo) : meta.unread,
  };
}

/**
 * A received reveal whose proof verified and whose register the chain hasn't been asked about yet. `checking` is how
 * builds before the 1.10.0 gate kept one waiting for a sync's read: it reads as unchecked.
 */
function isUnchecked(entry: Entry): entry is Entry & { reveal: Extract<ReceivedReveal, { status: "unchecked" }> } {
  const status = entry.reveal && "status" in entry.reveal ? (entry.reveal.status as string) : undefined;
  return status === "unchecked" || status === "checking";
}

/**
 * What a conversation's record says of its reveals: whether one waits for the user's check, and the latest that
 * verified, in the order they came, with when it came. One the budget has deleted leaves `revealed` as it was.
 */
function revealsOf(file: ConversationFile, revealed: Meta["revealed"]): Pick<Meta, "unchecked" | "revealed"> {
  let latest: Meta["revealed"];
  for (const entry of file.history) {
    if (entry.reveal && "status" in entry.reveal && entry.reveal.status === "verified") latest = { name: entry.reveal.name, at: entry.at };
  }
  const named = latest ?? revealed;
  return { unchecked: file.history.some(isUnchecked) ? true : undefined, revealed: named };
}

/**
 * What the list shows of a history's last message: which way, and its first PREVIEW_CHARS characters, whole code
 * points, so a cut never splits one. None once the budget has deleted every message.
 */
export function lastOf(history: readonly Entry[]): Meta["last"] {
  const entry = history.at(-1);
  if (!entry) return undefined;
  if (entry.kind === KIND_REVEAL) return { dir: entry.dir, reveal: true };
  if (entry.text === undefined) return { dir: entry.dir };
  const chars = [...entry.text];
  return { dir: entry.dir, text: chars.length > PREVIEW_CHARS ? `${chars.slice(0, PREVIEW_CHARS).join("")}…` : entry.text };
}

/**
 * A message as the screens show it. `checking`: its conversation's reveals are being checked on the chain now.
 * `nextTry`: when a waiting message is tried again, where the relay asked it to wait.
 */
function entryView(entry: Entry, { checking = false, nextTry }: { checking?: boolean; nextTry?: number } = {}): MessagingEntry {
  return {
    id: entry.id,
    dir: entry.dir,
    at: entry.at,
    // A kind this version can't show, or a request's message that doesn't read now: said, never guessed at.
    ...(entry.kind === KIND_REVEAL
      ? { reveal: revealView(entry, checking) }
      : entry.text !== undefined
        ? { text: entry.text }
        : { unreadable: true }),
    ...(entry.sent ? { sent: entry.sent } : {}),
    // Who refused it (W13): the server, which the bytes kept say for one from before the field; or the wallet's own
    // crate, which sealed nothing. Never the server's for a text the wallet couldn't seal.
    ...(entry.sent === "refused" ? { refusedBy: entry.refusedBy ?? (entry.envelope ? "server" : "wallet") } : {}),
    ...(entry.expires !== undefined ? { expires: entry.expires } : {}),
    // Bytes the server refused, kept: the user can send them again (`resend`).
    ...(entry.sent === "refused" && entry.envelope ? { resend: true as const } : {}),
    ...(nextTry !== undefined ? { nextTry } : {}),
  };
}
