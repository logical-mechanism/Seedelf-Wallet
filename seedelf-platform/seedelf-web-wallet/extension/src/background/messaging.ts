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
// matched), the posts, and solving proof of work.
//
// The records, sealed in the private store (private-store.ts) per network:
//
//   messaging.<network>              The inbox: which Seedelfs take first
//                                    messages, what each conversation shows
//                                    with its record's own ID, what the list
//                                    shows of each request, the tombstones
//                                    (the crate's own record), and what
//                                    wasn't kept.
//   messagingRequests.<network>      The crate's requests record (and a later
//                                    version's, kept aside as it came): read
//                                    only by a first message's take and the
//                                    user's presses on a request.
//   messagingRead.<network>          Where the next read goes on from, a gap
//                                    the relay said, what Try again steps
//                                    over, the device's clock against the
//                                    relay's, and how many of the key's
//                                    envelopes a stop could lose (`owed`).
//                                    Always within its 1 KiB pad.
//   messagingOutbox.<network>        The user's envelopes waiting to be
//                                    posted, copied from their records, which
//                                    stay the truth.
//   messagingTake.<network>          The key's envelopes the reads found and
//                                    the take hasn't taken yet, read by read,
//                                    in a room of its own (TAKE_ROOM_BYTES),
//                                    with what of them wasn't kept.
//   conversation.<network>.<id>      A conversation: its ratchet, its
//                                    outbox and its history together, so
//                                    one write moves them all. `id` is 16
//                                    random bytes the inbox maps to the
//                                    conversation: nothing at rest names it.
//
// The crate's records and the envelopes are stored as base64; this service
// works with them in hex, as the exports take them.
//
// A conversation's record is written before the inbox that lists it, and
// deleted after the inbox that stops listing it: a stop between the two
// leaves a record nothing lists, which the sweep deletes. The inbox never
// lists a record that isn't there. What the inbox shows of each conversation
// is set right from its record once each unlock (`sweep`), and, where an
// inbox write failed after its record's, at the take's next bookkeeping write
// (the gate's f4).
//
// One budget for what Messages keeps of conversations (the 1.10.0 gate's W7):
// both networks' inboxes and every conversation's record, as stored, within
// MESSAGES_BUDGET_BYTES, and no conversation's record past its share. A write
// that would pass either makes room first, by deleting old messages, and isn't
// made at all when no deletion would make enough. Then that envelope isn't
// kept: it's counted (`noRoom`), and nothing about it shows in what the
// wallet asks the relay (W11). Requests and the take have rooms of their own
// beside it. And no write of Messages that grows storage takes the whole area
// within RESERVE_BYTES of its quota, those rooms counted as taken (W11, the
// gate's round 5): what's left is payments' and the rest of the wallet's.
//
// THE RULE (W1 to W4, W10, and the gate's round 5): nothing about whether an
// envelope is the wallet's, and nothing it holds, changes which requests the
// wallet makes to any server, with what content, or when. The relay, on
// mainnet the same server as the chain's reads, sees every request's time.
//
//   A lane is every run of the wallet's requests to the relay: a sync's pages,
//   at most PAGES_A_SYNC, and then its posts; and every posting run a press
//   starts. In a lane the service reads and writes only records whose size no
//   envelope sets (messagingRead, the scan's mark, the user's own outbox, and
//   session storage's copies of what the relay answered: its stop, the posting
//   runs' waits and strikes), opens nothing, and tells the screens nothing.
//   The read keeps the key's envelopes aside in memory, and messagingRead is
//   written once at the lane's end, after the posts, at its one size: never
//   refused for room.
//   The runner does everything else, one step at a time across both
//   networks, between lanes: the posts' bookkeeping, saving what the reads
//   found to the take record and taking it (each envelope opened, received,
//   its records written), the sweep, expiry. Before each of its calls into
//   the wallet's queue a step waits until no lane runs and more than
//   TAKE_MARGIN_MS remain before every tick the worker expects: both alarms'
//   next minute, and the next tick of the pages' 10-second grid, the
//   worker's own, which every page shown polls on, so pages at a tick join
//   one lane and their margins don't add up. The call looks again as its
//   turn in the wallet's queue comes, which another feature's long task can
//   hold meanwhile: where a lane has started or a tick come near, it gives
//   the queue back without running and waits again. Screen reads, presses
//   and the screens' change notices wait the same way; the overview answers
//   from memory. So the grids' requests go at the same moment after the same
//   work whatever was taken.
//
// No sync waits for a take, and none follows one: the next read comes at the
// next tick, from where the last one ended, whatever is still being taken. A
// lock or a stop leaves what isn't taken in the take record, or, past its
// room, counted as lost (`owed`, then `unopened`). No refusal of an envelope
// is kept, shown or acted on, and none starts a request, but the one the
// conversation's own ratchet authenticated: a message it can't reach (§6).
//
// The residual (W10): a request off those grids (a page's own sync as it's
// shown or comes into view, a connected site's call, the wallet's other
// reads) can still meet one step's call into the wallet's queue, which a
// conversation's share and the requests' room bound: one already running when
// it's made, or, for a request that isn't a lane (a site's call, a read of the
// chain), one queued just ahead of it; a page's own sync is a lane, so a call
// queued ahead of it gives way (`admit`). Or it can come between two of another
// feature's requests. A relay that times the requests and
// fills pages with envelopes it sealed to a register could test that,
// statistically and over many syncs. What a wallet whose reads matched holds
// in memory until it's taken isn't measured.
//
// A step that traps (W9, W13). WebAssembly that traps locks the wallet, and
// the next unlock would read the same page again. So before each page's scan,
// and before each envelope's take, the step is noted in a sealed mark of its
// own (the scan's and the take's apart), cleared as it ends; a trap leaves it,
// with a flag beside it that needs no key and says which step it was. A
// network so stopped isn't synced by itself again: the overview says it, and
// Try again (`retry`) steps over the envelope that trapped, in the reads and
// the take alike, or scans that page's envelopes one at a time so the next
// one names it.
//
// The relay's off switch (W15; the gate's round 5, the freeze's fix A): a 410
// stops the network's Messages until the relay answers again, with nothing
// posted or solved meanwhile. Only an answer of its own ends it, never a
// timer: an hour after each 410 the next sync asks one page, the one it asks
// anyway, from the same cursor (a failed fetch, a time-out or a proxy's 5xx is
// no answer, and the next sync asks again). A lock ends it too, and the
// unlock's first sync asks. It's kept in memory and in session storage, for a
// worker Chrome starts again, as are the posting runs' waits and strikes (fix
// D). The device's clock is measured against the relay's where a fresh post's
// answer gives it, and only said (W14): every rule that runs on a clock runs
// on the device's, and every wait kept in memory on a monotonic one.
//
// Nothing reaches the relay while a network's Messages switch is off
// (preferences.ts `messaging`), and nothing is read while locked: there's no
// key then. Pages are read on unlock and every minute after, through
// `seedelf.messaging`'s alarm (sw.ts), and every 10 seconds while a wallet
// page is on screen.
//
// A Seedelf takes first messages (W8) where this browser put it under a
// register when it minted it (minted-by.ts `mintedAt`), or where the user
// turned it on: never because it's merely under the key, since anyone can
// mint one under the sum of two of the wallet's registers, and answering at
// it, or showing it, would tell them the two are one wallet's.
//
// The verified reveal (protocol.md §19, 54f): the side that wrote first may
// show the other one of its Seedelfs, once answered, as a message of kind
// 0x02. Its reader checks the proof as the message is received, with no
// request. Whether the chain gives the name that register now, as Send's
// pay-by-name finds a Seedelf, is read only when the user asks, in the thread
// (`checkReveals`): a read right after a reveal came would tell the server
// whom it was for. Only then does the conversation name it; a reveal that
// fails never shows its name.

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
  MESSAGING_SYNC_EVERY_MS,
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
  POST_WAIT_MAX_MS,
  type PostAnswer,
  relayAnswered,
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
import { type Admit, NotAdmitted, phrasePin, type PhrasePin, SESSION_UNLOCKED_AT, type Wallet, WalletLocked, WASM_BROKEN } from "./wallet";
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
 * The most one conversation's record takes as stored (the 1.10.0 gate's round 5, O2): 512 KiB of JSON, sealed and in
 * base64. Every write of it trims its own oldest messages down to this, whatever the budget, so one step of the take,
 * one thread shown or one post's bookkeeping handles at most this much. The user's own waiting messages, and those the
 * server refused whose bytes are kept to send again, are never trimmed for it: a take's message that can't fit beside
 * them is dropped and counted; a press's write goes through.
 * When the budget is tight, a stranger's requests (their own room, W11) or another conversation's growth can delete the
 * user's oldest read messages too.
 */
export const CONVERSATION_SHARE_BYTES = 699_072;

/**
 * How many reads a network's takes may fall behind in memory (W10): five reads' envelopes at most. Past it the oldest
 * read still waiting is dropped, unopened and counted (`unopened`): a read is never skipped or cut short for the takes,
 * since how far behind they are depends on how many of the key's envelopes the pages held, which the relay chooses.
 */
export const TAKES_BEHIND = 4;

/**
 * The take record's room (the 1.10.0 gate's round 5, O5): 128 KiB of JSON a network, 174,784 bytes as stored, about 47
 * envelopes of 2 KiB, 190 of 512 bytes or 2 of 32 KiB. A read's envelopes past what's left of it aren't saved, and are
 * taken from memory: a stop before they're taken loses them, counted (`owed`). Counted as taken in every look at the
 * area's reserve, whether it's used or not.
 */
export const TAKE_ROOM_BYTES = 128 * 1024;

/**
 * The requests record's room as stored: the crate's 256 KiB of requests, in base64 and sealed, 512 KiB of JSON. Counted
 * as taken in every look at the area's reserve (O5), so strangers' requests never decide whether the user's write fits.
 */
export const REQUESTS_ROOM_STORED = 699_072;

/**
 * How long before each tick the worker expects (each alarm's next minute, the pages' grid's next poll) the runner and the
 * screens' storage work keep out of the wallet's queue (the 1.10.0 gate's round 5, O3). It must exceed Messages' longest
 * single call into the wallet's queue on a slow laptop: a first message's receive with the requests' record at its
 * bound, about 1.5 s at most with the CPU six times slower, 2.9 s at ten times. Each call looks again as its turn in the
 * queue comes, behind whatever another feature queued before it, and runs only with more than this left before every
 * tick (`admitted`): so a call that starts ends before the tick, and no read on a grid meets one.
 */
export const TAKE_MARGIN_MS = 3000;

/** How long past an expected tick its run is waited for before the runner goes on without it. */
export const TICK_GRACE_MS = 2000;

/**
 * How early a page's poll may come before the pages' grid's tick and still serve it (`notePage`): a timer the page set
 * from the worker's answer (`pollIn`) never fires sooner than asked, but for its rounding.
 */
export const GRID_EARLY_MS = 250;

/** How many envelopes Try again steps over at once (`messagingRead`'s skip list): the oldest goes past it. */
export const SKIP_KEPT = 6;

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

/**
 * How long after a 410 (W15) a stopped network's next sync asks one page, the probe, to see whether the relay answers
 * again (the freeze's fix A): an hour. Only an answer of its own ends the stop; a probe with no answer leaves it due,
 * and a lock ends the stop too.
 */
export const PAUSED_ASK_MS = 3600_000;

/**
 * Answers this version doesn't know, in a row, after which an envelope is set aside to send again (W15): a 402 whose
 * price its work already meets among them (fix F), never a post with no answer (fix C).
 */
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

/**
 * chrome.storage.session: each network whose relay is stopped (a 410, W15), with when the next sync asks it again (ms,
 * the device's clock): only an answer of the relay's own lets it go (the freeze's fix A). A lock clears it.
 */
export const SESSION_PAUSED = "seedelf.messaging.paused";

/**
 * chrome.storage.session: what each network's posting runs keep between them (the freeze's fix D): the waits the relay
 * asked for (ms, the device's clock), the strikes and where the next run starts, by stamp digest. A lock clears it.
 */
export const SESSION_POSTS = "seedelf.messaging.posts";

/** chrome.storage.session: until when (ms) each network's pages wait for the day's reading (W16). A lock clears it. */
export const SESSION_READ_AFTER = "seedelf.messaging.readAfter";

/**
 * The inbox, `messaging.<network>`, as this service works with it: the tombstones in hex. Stored (`StoredInbox`) with
 * them in base64. Since the 1.10.0 gate's round 5 it holds nothing a read of the relay needs: where the next read goes on
 * from is `messagingRead`'s, and the crate's requests record is `messagingRequests`'s.
 */
export interface Inbox {
  v: 2;
  /**
   * The nonce `messagingRequests.<network>` was last sealed under, as this inbox last knew it (private-store.ts
   * `sealedAs`): where the record's differs, a stop came between the two writes, and the sweep sets the list right from
   * the record. None while there's no record.
   */
  requestsAs?: string;
  /**
   * A request an Accept may have left in `messagingRequests.<network>` beside its conversation (1.10.0's second
   * review): set in the write that lists the conversation, before the record is written without the request. Stored,
   * so a worker Chrome stops loses nothing of it; and no write of the record unsets it, whatever nonce that write
   * notes: only the repair, once it has read the record (`repairRequests`), and the accept that set it, once its own
   * write of the record went through with no earlier mark standing. None in an inbox a build before it wrote.
   */
  requestLeft?: true;
  /**
   * What the list shows of each request, by cid, kept beside the record whenever a receive or an accept changes it:
   * neither an overview nor an envelope that isn't a request's has the module parse the record (W7).
   */
  requestsShown: Record<string, RequestShown>;
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
  /**
   * Messages not kept that the inbox counts: the requests a record the crate couldn't read listed (`asideRequests`), and
   * the key's envelopes builds before the take record counted here. The take record counts the rest (`noRoom`,
   * `unopened`).
   */
  dropped?: number;
  /** The Seedelfs this browser minted before 1.10.0 kept their pairs (W12): adopted once, from the first kept view. */
  adopted?: true;
  /**
   * What an inbox a development build before round 5 wrote kept of the requests, in hex (O6): moved into their own
   * record by the first unlock's sweep, and written back as they came until then, so nothing of them is lost.
   */
  legacy?: { requests?: string; aside?: string[] };
}

/**
 * The inbox as stored: the tombstones in base64 (v 2); a v 1 inbox, from before the 1.10.0 gate, held its records in
 * hex. One a build before round 5 wrote also holds the requests' records, its read cursor and the rest it then kept.
 */
type StoredInbox = Omit<Inbox, "v" | "requestsShown" | "legacy"> & {
  v: 1 | 2;
  requestsShown?: Inbox["requestsShown"];
  requests?: string;
  requestsAside?: string[];
  cursor?: string;
  gapAt?: number;
  skip?: unknown;
  clock?: unknown;
};

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
  /**
   * Its last message kept, for the list (`lastOf`): which way, and the start of its text, or that it's a reveal.
   * `unsent`: what the list's row must say of the user's own messages that the count of the outbox doesn't (the
   * 1.10.0 gate's blind reading): `refused`, the last message is the user's and wasn't sent, by the server or by the
   * wallet; `reply`, every message still waiting waits for a reply, none for its stamp or its post.
   */
  last?: { dir: "in" | "out"; text?: string; reveal?: true; unsent?: "refused" | "reply" };
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
  /**
   * The writer's share of first messages as the crate counted it when a reply the thread doesn't show came (a control
   * kind, the 1.10.0 gate's round 5, O4), lowered as the crate would by each message sealed since: what the share still
   * is until a reply the thread shows comes. The crate's own count at that moment, so no trim of the history moves it.
   */
  held?: ShareInfo;
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
   * A sent message: `queued` until the first-contact stamp is set (or, where the crate refused it for the writer's own
   * share at the stamp's turn, which send's count makes unreachable, until the user's next press in its conversation:
   * relay-oracle fix item 2), then `pending` until the relay keeps it, then `posted`; `refused` (`refusedBy`):
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
  preferences: Pick<PreferencesService, "get" | "set" | "messagingOpen">;
  /** `seedelf.messaging`'s alarm, every minute while a switch is on and the wallet unlocked (sw.ts). */
  alarm?: { start(): Promise<void>; stop(): Promise<void> };
  /** Each network's relay (relay.ts). */
  relay: (network: NetworkName) => RelayClient;
  /**
   * The Seedelfs under the wallet's key on `network`, each with its register now. `read`: the contract read now,
   * what's new in it, which throws if it can't be; otherwise only the view the last reading kept, with no request,
   * undefined when none is kept. No sync ever reads (W1): only a press of the user's does (`reveal`). `admit`: the kept
   * view's call into the wallet's queue takes it as `Wallet.withKeys`'s (round 5).
   */
  ownSeedelfs: (network: NetworkName, read: boolean, admit?: Admit) => Promise<Array<{ name: string; register: RegisterHex }> | undefined>;
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
  /**
   * A call to a Chrome API that does nothing else, made between a solve's slices at most every 10 seconds, so Chrome
   * doesn't stop the worker partway through the work (`solve`). Only while a solve runs: never on a timer of its own.
   */
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
  /** The take record's room, as its JSON, for tests: TAKE_ROOM_BYTES otherwise. */
  takeRoomBytes?: number;
  /**
   * For tests only: told of each throw a take passes over without a word (W9; the 1.10.0 gate's f2), so a test meets
   * any it didn't mean to. The worker never sets it.
   */
  passedOver?: (e: unknown) => void;
  /**
   * For tests only: told as the worker reaches a branch its own count of the writer's share makes unreachable (the crate
   * refusing a text for the share at a seal, relay-oracle fix item 2), so a test meets any it didn't mean to. The worker
   * never sets it.
   */
  unreachable?: (where: "sealQueued" | "reveal") => void;
  /**
   * What the whole storage area holds now (chrome.storage.local.getBytesInUse(null)): Messages' writes that grow it
   * leave RESERVE_BYTES of its quota free (W11). Without it, nothing is checked but the budget.
   */
  bytesInUse?: () => Promise<number>;
  /**
   * What one key of the area holds, by the same count with no value read (chrome.storage.local.getBytesInUse(key)): the
   * rooms' sizes, for the reserve (the 1.10.0 gate's round 5). Without it, a record's sealed length is read.
   */
  bytesOf?: (key: string) => Promise<number>;
  /** The area's quota, for tests: QUOTA_BYTES otherwise. */
  quotaBytes?: number;
  /** What Messages leaves free of it, for tests: RESERVE_BYTES otherwise. */
  reserveBytes?: number;
  /**
   * A clock that never steps (ms), for the waits kept in memory (W14): performance.now() otherwise. A device clock set
   * back or forward stretches none of them.
   */
  monotonic?: () => number;
  /**
   * The ticks of the worker's own alarms (sw.ts): each one's next run, by the device's clock (ms), and whether a lane of
   * Messages' own serves it (Messages' alarm) or another feature's run (the sessions' alarm). The runner and the screens'
   * storage work keep off them (the 1.10.0 gate's round 5). Without it, only the open pages' polls are kept off.
   */
  ticks?: () => Promise<Array<{ at: number; lane: boolean }>>;
  /** TAKE_MARGIN_MS, for tests. */
  takeMarginMs?: number;
  /** A wait of `ms` (monotonic) for the gate, for tests: a timer otherwise. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * For tests only: told as each lane starts and ends, as each run of `syncAll` starts and ends (the alarm's, an
   * unlock's), as each runner step starts and ends, as the gate lets a call into the wallet's queue through, and as a
   * call its admit check turned away gives the queue back (`yield`). The worker never sets it.
   */
  observe?: (
    event: "lane-start" | "lane-end" | "run-start" | "run-end" | "step-start" | "step-end" | "gate" | "yield",
    network?: NetworkName,
  ) => void;
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

/** One read's worth of the key's envelopes, waiting for the take (W4), as the runner holds them in memory. */
interface Batch {
  /** Where the read that found them ended: what tells one saved in the take record from the same held in memory. */
  to?: string;
  /** The envelopes the scan matched, in the order they came: one served twice is here twice, and taken once. */
  envelopes: string[];
  /** The phrase the read was made under, or the take record was opened under: the take of another's writes nothing. */
  pin: PhrasePin;
  /** It's in the take record: its take's end drops it from there. */
  saved: boolean;
  /** How many of its envelopes `owed` counts for it, until it's saved or taken. */
  owed: number;
  /** The network's epoch when it was read: a rewind, or Messages started again, since makes it stale (f1). */
  epoch: number;
  /** All its envelopes are taken: only its end's bookkeeping is left, and TAKES_BEHIND no longer counts it. */
  done?: boolean;
}

/**
 * The take record, `messagingTake.<network>` (sealed; the 1.10.0 gate's finding 8 and round 5), as this service works
 * with it: the reads' envelopes not taken yet, read by read, and what of them wasn't kept. Written by the runner (one
 * append as a read's envelopes are saved, one rewrite as they're taken, never a write an envelope), by a rewind, and by
 * the user's press that they've seen the count of what was dropped (`seenDropped`). Stored (`StoredTakes`) with the
 * envelopes in base64.
 */
interface Takes {
  batches: Array<{ to?: string; envelopes: string[] }>;
  /**
   * The key's envelopes dropped unopened (W10, the 1.10.0 gate's f5): a read's the takes fell more than TAKES_BEHIND
   * behind, and what a stop lost before it was saved (`owed`, moved here at a worker's or an unlock's first window).
   * Anyone may have sent them.
   */
  unopened: number;
  /**
   * The key's envelopes not kept for want of room (W11): a message the budget, its conversation's share and the area's
   * reserve had none for, counted as its read's envelopes go from the record (so a read taken again counts each once).
   */
  noRoom: number;
  /**
   * How many of `unopened` the user has seen counted (round 4's review, #6; `seenDropped`): the overview says only the
   * rest, so "N messages were dropped before they could be read" goes once it's been seen, until more are dropped.
   */
  seen: number;
}

/** The take record as this service last read or wrote it. */
interface TakesHeld extends Takes {
  /** The unlock it was read or written in (`unlockedAt`). */
  at: number | undefined;
  /** Whether it's stored. */
  stored: boolean;
  /** What it takes as stored, as last read or written: its write's growth is counted from it (W11). */
  bytes: number;
}

/** The take record as stored: the envelopes in base64. Round 4's (v 1) also held the read's cursor, which goes (O6). */
interface StoredTakes {
  v: 1 | 2;
  batches?: Array<{ to?: string; envelopes?: string[] }>;
  unopened?: number;
  noRoom?: number;
  seen?: number;
}

const takeRecord = (network: NetworkName): RecordName => `messagingTake.${network}`;

/**
 * The read record, `messagingRead.<network>` (sealed; the 1.10.0 gate's round 5), as this service works with it: what a
 * lane needs of the relay's pool, and nothing a match sizes. Always within its 1 KiB pad, 1,388 bytes as stored.
 * Written once at a lane's end, after the posts, only where the pages moved it, on a chain of its own: never refused
 * for room, never holding the take back. The runner writes it too where its bookkeeping moves a field.
 */
interface ReadState {
  /** Where the next read goes on from: where the last one ended. None before the first page, and after a rewind. */
  cursor?: string;
  /** When a page last said envelopes after a cursor of the wallet's own were gone (ms): messages sent then may never arrive. */
  gapAt?: number;
  /** Envelopes every read and take steps over, each by its SHA-256 (hex), until when (ms): one a step trapped on (W9). */
  skip: Array<{ envelope: string; until: number }>;
  /**
   * The device's clock against the relay's, as the last fresh post's answer gave it (W14): `off` (ms) is how far this
   * device's clock is ahead (negative: behind), measured `at` (the device's ms). Said, never used as the time.
   */
  clock?: { at: number; off: number };
  /**
   * How many of the key's envelopes the reads found that are neither saved in the take record nor taken (O5): what a
   * stop would lose. Moved into the take record's `unopened` at a worker's or an unlock's first window.
   */
  owed: number;
}

/** The read record as this service holds it. */
interface ReadHeld extends ReadState {
  /** The unlock it was read or written in (`unlockedAt`): after another, it's read again, unless a write of it failed. */
  at: number | undefined;
  /** The phrase it's sealed under (`phrasePin`'s ID): another's is never used. */
  phrase: string;
  /** Changed in memory since it was last written: a write the browser refused is made again at the next chance. */
  dirty: boolean;
}

interface StoredRead {
  v: 1;
  cursor?: string;
  gapAt?: number;
  skip?: Array<{ envelope: string; until: number }>;
  clock?: { at: number; off: number };
  owed?: number;
}

const readRecord = (network: NetworkName): RecordName => `messagingRead.${network}`;

/** The outbox record, `messagingOutbox.<network>` (sealed): the user's envelopes waiting to be posted, in base64. */
interface StoredOutbox {
  v: 1;
  waiting: Array<{ cid: string; id: number; envelope: string }>;
}

/** An envelope waiting to be posted, in hex: its conversation and its entry, whose record stays the truth (§4.2). */
interface Waiting {
  cid: string;
  id: number;
  envelope: string;
}

const outboxRecord = (network: NetworkName): RecordName => `messagingOutbox.${network}`;

/** The requests record, `messagingRequests.<network>` (sealed): the crate's requests, and a later version's kept aside. */
interface StoredRequests {
  v: 1;
  requests?: string;
  aside?: string[];
}

/** The requests' records as this service works with them: in hex. */
interface Requests {
  requests?: string;
  aside?: string[];
}

const requestsRecord = (network: NetworkName): RecordName => `messagingRequests.${network}`;

/** What a posting run's answer was for one envelope, for the runner's bookkeeping after the lane. */
interface Posted {
  cid: string;
  id: number;
  answer: { kind: "kept"; fresh: boolean; expires: number } | { kind: "refused" };
  /** When the answer came, by this device's clock (W14). */
  at: number;
  /** The phrase the posting run began under: another's marks nothing. */
  pin: PhrasePin;
}

/** A tick the worker expects (`ticks`): when (monotonic ms), and whether a lane of Messages' own serves it. */
interface Tick {
  at: number;
  lane: boolean;
}

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
  e instanceof UnreadableRecordError || e instanceof WalletLocked || e instanceof StorageFailed || e instanceof NotAdmitted || isTrap(e)
    ? e
    : new StorageFailed(e);

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
 * A write of Messages' own bookkeeping (which Seedelfs take first messages, what a record now holds) that would cross
 * the storage area's reserve, or that the browser refused (W11): it isn't made. Where the take made it, the take stops
 * (`full`) until the next one tries again. Reads and posts go on as ever: nothing in a lane is bookkeeping (round 5).
 */
class ReserveReached extends MessagingFull {}

/** A solve that met the relay's off switch between two of its slices, and gave up (the freeze's fix A). */
class StopMet extends Error {}

/** What a network's posting runs keep between them (the freeze's fixes C and D), in the unlock `at`. */
interface PostRuns {
  at: number | undefined;
  /** Answers this version doesn't know in a row, by stamp digest. */
  strikes: Map<string, number>;
  /** The stamp digest of the envelope after which the next run begins. */
  from?: string;
}

/** The same in session storage (SESSION_POSTS), with the waits on the device's clock (ms): nothing names a conversation. */
interface StoredPostRuns {
  from?: string;
  strikes?: Record<string, number>;
  after?: number;
  sizes?: Record<string, number>;
}

/**
 * What a write of Messages is, for its room (W11, round 5): a message's; a request's or the take record's (rooms of
 * their own, counted as taken); bookkeeping; or `fixed`, a write of a size no envelope sets that a lane makes (the read
 * record, a mark, an outbox that only shrinks), never looked at against the area's reserve.
 */
type WriteKind = "content" | "requests" | "take" | "bookkeeping" | "fixed";

// Every record and envelope goes through these at its full size (the 1.10.0 gate's round 5, fix item 5.3): hex is
// written as ASCII bytes and decoded once, and read back by each character's code, with the same results as before.
const HEX_CODES = new TextEncoder().encode("0123456789abcdef");
const ASCII = new TextDecoder();
export const hexOf = (bytes: Uint8Array): string => {
  const out = new Uint8Array(bytes.length * 2);
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    out[2 * i] = HEX_CODES[b >> 4]!;
    out[2 * i + 1] = HEX_CODES[b & 15]!;
  }
  return ASCII.decode(out);
};
/** Each hex digit's value by its character code, lower or upper case. */
const NIBBLE = (() => {
  const table = new Uint8Array(128);
  for (let i = 0; i < 10; i++) table[48 + i] = i;
  for (let i = 0; i < 6; i++) table[97 + i] = table[65 + i] = 10 + i;
  return table;
})();
export const bytesOf = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0, j = 0; i < out.length; i++, j += 2) out[i] = (NIBBLE[hex.charCodeAt(j)]! << 4) | NIBBLE[hex.charCodeAt(j + 1)]!;
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

/**
 * What a record of `jsonLength` UTF-8 bytes takes of the extension's storage: sealed, padded, base64 (private-store.ts),
 * its padding characters counted: 1,388 for the smallest pad.
 */
export function storedBytes(jsonLength: number): number {
  let size = 1024;
  while (size < jsonLength) size *= 2;
  return 4 * Math.ceil((size + 16) / 3);
}

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
  const { tombstones, legacy, ...rest } = inbox;
  return {
    ...rest,
    v: 2,
    ...(tombstones !== undefined ? { tombstones: base64OfHex(tombstones) } : {}),
    // A development build's requests, written back as they came until the sweep moves them (O6).
    ...(legacy?.requests !== undefined ? { requests: base64OfHex(legacy.requests) } : {}),
    ...(legacy?.aside?.length ? { requestsAside: legacy.aside.map(base64OfHex) } : {}),
  };
}

const emptyInbox = (): Inbox => ({ v: 2, handles: {}, conversations: {}, requestsUnread: {}, requestsShown: {} });

/** The inbox as the budget counts it (W11): without what the take sizes, which the area's reserve counts at its most. */
const leanOf = (inbox: Inbox): Inbox => {
  const { legacy: _legacy, ...rest } = inbox;
  return { ...rest, requestsShown: {}, requestsUnread: {} };
};

/** The take record as stored: its envelopes in base64, the counts only once there are some. */
function takesToStored(t: Takes): StoredTakes {
  return {
    v: 2,
    batches: t.batches.map((b) => ({ ...(b.to !== undefined ? { to: b.to } : {}), envelopes: b.envelopes.map(base64OfHex) })),
    ...(t.unopened ? { unopened: t.unopened } : {}),
    ...(t.noRoom ? { noRoom: t.noRoom } : {}),
    ...(t.seen ? { seen: t.seen } : {}),
  };
}

/** A count as stored: a whole number, or none. */
const countOf = (n: unknown) => (typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : 0);

/** The take record as this service works with it, from what's stored (none: no record). Round 4's cursor goes (O6). */
function takesFromStored(stored: StoredTakes | undefined): Takes {
  return {
    batches: (Array.isArray(stored?.batches) ? stored.batches : [])
      .map((b) => ({
        ...(typeof b?.to === "string" ? { to: b.to } : {}),
        envelopes: (Array.isArray(b?.envelopes) ? b.envelopes : []).filter((e) => typeof e === "string").map(hexOfBase64),
      }))
      .filter((b) => b.envelopes.length > 0),
    unopened: countOf(stored?.unopened),
    noRoom: countOf(stored?.noRoom),
    seen: countOf(stored?.seen),
  };
}

/** The read record as stored. */
function readToStored(r: ReadState): StoredRead {
  return {
    v: 1,
    ...(r.cursor !== undefined ? { cursor: r.cursor } : {}),
    ...(r.gapAt !== undefined ? { gapAt: r.gapAt } : {}),
    ...(r.skip.length ? { skip: r.skip } : {}),
    ...(r.clock ? { clock: r.clock } : {}),
    ...(r.owed ? { owed: r.owed } : {}),
  };
}

/** The read record as this service works with it, from what's stored (none: no record, or one that won't open). */
function readFromStored(stored: StoredRead | undefined): ReadState {
  const skip = Array.isArray(stored?.skip)
    ? stored.skip.filter((e) => typeof e?.envelope === "string" && typeof e.until === "number").slice(-SKIP_KEPT)
    : [];
  const clock = stored?.clock;
  return {
    ...(typeof stored?.cursor === "string" && /^\d{1,20}$/.test(stored.cursor) ? { cursor: stored.cursor } : {}),
    ...(typeof stored?.gapAt === "number" ? { gapAt: stored.gapAt } : {}),
    skip,
    ...(clock && typeof clock.at === "number" && typeof clock.off === "number" ? { clock: { at: clock.at, off: clock.off } } : {}),
    owed: countOf(stored?.owed),
  };
}

/** The take record's JSON length as stored, worked out without writing its envelopes out. */
function takesJsonLength(t: Takes): number {
  // An envelope's share: its base64, quoted, and the comma after all but the last.
  const envelope = (hex: string) => 4 * Math.ceil(hex.length / 2 / 3) + 2;
  // `{"to":"…",` where there's one, `"envelopes":[` and `]}`, each envelope, and the commas between.
  const batch = (b: Takes["batches"][number]) =>
    16 + (b.to !== undefined ? b.to.length + 8 : 0) + b.envelopes.reduce((n, e) => n + envelope(e), 0) + Math.max(0, b.envelopes.length - 1);
  return utf8Length(JSON.stringify(takesToStored({ ...t, batches: [] }))) + t.batches.reduce((n, b) => n + batch(b), 0) + Math.max(0, t.batches.length - 1);
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

/**
 * What `shareOf` counts from (W17): the crate's own count while it gives one; where it gives none because a reply the
 * thread doesn't show came (the 1.10.0 gate's round 5, O4), the one held then, until a reply the thread shows comes.
 */
function shareInfoOf(info: Pick<ConversationInfo, "firstContactLeft">, meta: Pick<Meta, "answered">, file: Pick<ConversationFile, "held">): ShareInfo | null {
  return info.firstContactLeft ?? (!meta.answered && file.held ? file.held : null);
}

const sameShare = (a: ShareLeft | undefined, b: ShareLeft | undefined) => a?.messages === b?.messages && a?.bytes === b?.bytes;

/** What a lane's read leaves for its end (`laneDone`): what it found, where it ended, whether a step trapped. */
interface ReadOut {
  found: string[];
  from?: string;
  cursor?: string;
  gap: boolean;
  /**
   * A page of the read held envelopes, whoever they are for (1.10.0's second review, F2): with the cursor and a gap,
   * what decides whether the lane writes the read record. Never what the scan matched.
   */
  envelopes: boolean;
  /** The scan's mark was written: it's cleared at the lane's end. */
  marked: boolean;
  trapped: boolean;
  /** The read threw: its end writes nothing. */
  failed?: boolean;
}

/** Where a network's take is in the batch it's on (`takeStep`). */
interface TakeAt {
  batch: Batch;
  /** The next envelope of it. */
  index: number;
  /** Which Seedelfs take first messages was set for it (`noteOwn`). */
  noted: boolean;
  /** Its envelopes with no room this time (W11). */
  noRoom: number;
  /** Anything the screens show changed. */
  arrived: boolean;
  /** Tries of the envelope at `index` after a read of storage failed under it (f2). */
  tries: number;
  /** Envelopes of it taken: one served twice is taken once. */
  seen: Set<string>;
}

/** The requests' records as a call holds them: `changed`, set aside or dropped since they were read, to be written. */
interface RequestsHeld extends Requests {
  changed?: boolean;
}

/** What a write leaves its own room's record at, for the area's reserve (`roomsHeld`). */
interface RoomsAfter {
  network: NetworkName;
  requests?: number;
  takes?: number;
  inbox?: { bytes: number; largest: number };
}

/** A sealed record's wrapper as chrome.storage.local counts it, beside its data: `{"v":1,"nonce":"…","data":"…"}`. */
const SEALED_WRAPPER = 60;

/** A write of `kind` refused for room: bookkeeping's stops the take where the take made it (W11). */
const refusedFor = (kind: WriteKind): MessagingFull => (kind === "bookkeeping" ? new ReserveReached() : new MessagingFull());

/** The outbox record as stored: its envelopes in base64. */
const outboxToStored = (waiting: readonly Waiting[]): StoredOutbox => ({
  v: 1,
  waiting: waiting.map((w) => ({ cid: w.cid, id: w.id, envelope: base64OfHex(w.envelope) })),
});

/** The outbox record as this service works with it, from what's stored (none: nothing waiting). */
function outboxFromStored(stored: StoredOutbox | undefined): Waiting[] {
  return (Array.isArray(stored?.waiting) ? stored.waiting : [])
    .filter((w) => typeof w?.cid === "string" && Number.isSafeInteger(w.id) && typeof w.envelope === "string")
    .map((w) => ({ cid: w.cid, id: w.id, envelope: hexOfBase64(w.envelope) }));
}

/** The requests record as stored: in base64. */
const requestsToStored = (held: Requests): StoredRequests => ({
  v: 1,
  ...(held.requests !== undefined ? { requests: base64OfHex(held.requests) } : {}),
  ...(held.aside?.length ? { aside: held.aside.map(base64OfHex) } : {}),
});

/** The requests record as this service works with it, from what's stored. */
function requestsFromStored(stored: StoredRequests | undefined): RequestsHeld {
  return {
    ...(typeof stored?.requests === "string" ? { requests: hexOfBase64(stored.requests) } : {}),
    ...(Array.isArray(stored?.aside) && stored.aside.length ? { aside: stored.aside.filter((r) => typeof r === "string").map(hexOfBase64) } : {}),
  };
}

/** The ids of `file`'s entries waiting to be posted. */
const pendingIds = (file: ConversationFile) => new Set(file.history.flatMap((e) => (e.sent === "pending" ? [e.id] : [])));

/** `file`'s entries waiting to be posted that weren't before (`before`, `pendingIds`): what its next commit appends. */
const newlyPending = (file: ConversationFile, before: ReadonlySet<number>) => file.history.filter((e) => e.sent === "pending" && !before.has(e.id));

/** Whether a read the take record holds is `batch`: by where its read ended, or, with none, by its envelopes. */
function sameBatch(a: { to?: string; envelopes: readonly string[] }, b: { to?: string; envelopes: readonly string[] }): boolean {
  if (a.to !== undefined && b.to !== undefined) return a.to === b.to;
  return a.envelopes.length === b.envelopes.length && a.envelopes.every((e, i) => e === b.envelopes[i]);
}

/**
 * Trims `file`'s own oldest messages (read before unread, never one still to be posted, nor one refused whose bytes are
 * kept, nor `keep`) until it takes at most `share` as stored, or nothing more can go (O2). What it takes after.
 * `meta`'s unread count follows.
 */
function trimToShare(file: ConversationFile, meta: Meta, keep: number | undefined, share: number): number {
  let bytes = sizeOf(fileToStored(file));
  const drop = new Set<number>();
  while (bytes > share) {
    const step = trimStep(file, meta, drop, keep);
    if (!step) break;
    for (const id of step.drop) drop.add(id);
    bytes = step.bytes;
  }
  if (!drop.size) return bytes;
  const unread = unreadIds(file, meta);
  const before = file.history.length;
  file.history = file.history.filter((e) => !drop.has(e.id));
  file.trimmed += before - file.history.length;
  meta.unread = Math.max(0, meta.unread - [...drop].filter((id) => unread.has(id)).length);
  return sizeOf(fileToStored(file));
}

export class MessagingService {
  /** Every state change, one at a time (protocol.md §4.2). */
  private queue: Promise<unknown> = Promise.resolve();
  /**
   * The unlock the call running in the queue was asked under (`serial`): the wallet's count of its opens as it was
   * asked. Everything it reads and writes belongs to that unlock alone (`admitted`). None between calls.
   */
  private task?: { opened: number | undefined };
  /** The sync running on each network, if one is: its read and its posts. One asked meanwhile is that one (`join`). */
  private syncs = new Map<NetworkName, Promise<void>>();
  /** The posting running on each network. */
  private posting = new Map<NetworkName, { running: Promise<void>; again: boolean }>();
  /**
   * Each network's lanes running now (the 1.10.0 gate's round 5): a sync's, from before its first await to its read
   * record's write, and each posting run's. While any runs, nothing but the lanes' own fixed records is read or written.
   */
  private lanes = new Map<NetworkName, number>();
  /** Told as the last lane running ends, and as the next one starts. */
  private laneEnds: Array<() => void> = [];
  private laneStarts: Array<() => void> = [];
  /**
   * The runs of `syncAll` under way (the alarm's, an unlock's), each from before its first await to its lanes' end
   * (1.10.0's second review, F3): a lane, for the gate, the admit check and the held notices.
   */
  private runs = 0;
  /** When the alarm's own run last began (monotonic ms): what serves an alarm's tick, and nothing else does (`live`). */
  private alarmRunAt = Number.NEGATIVE_INFINITY;
  /** Each open page, by its ID, and when it was last heard from (monotonic ms, `notePage`). */
  private pages = new Map<string, number>();
  /**
   * The pages' one grid (`notePage`, round 5): its first tick (monotonic ms), set by the first page heard while none is
   * heard from, every page polling at its ticks every MESSAGING_SYNC_EVERY_MS; and the latest of them a page's poll
   * served, by its index (the first tick is the first page's own sync).
   */
  private grid?: { at: number; served: number };
  /** The alarms' next ticks (monotonic ms) as last read (`ticks`), and when they were read. */
  private alarmTicks?: { ticks: Tick[]; read: number };
  /** Change notices held while a lane runs or a tick is near (`notify`), by network: sent once the gate opens. */
  private heldChanged = new Set<NetworkName>();
  private flushing?: Promise<void>;
  /** Each network's read record as this service holds it (`readFor`). */
  private readRecords = new Map<NetworkName, ReadHeld>();
  /** Each network's read record's writes, one after another, in a chain of their own. */
  private readWrites = new Map<NetworkName, Promise<unknown>>();
  /** Each network's take record as this service last read or wrote it (`takesOf`). */
  private takes = new Map<NetworkName, TakesHeld>();
  /** Each network's take record's writes, one after another. */
  private takeWrites = new Map<NetworkName, Promise<unknown>>();
  /** Each network's outbox record's writes, one after another: a press's append, a posting run's shrink. */
  private outboxWrites = new Map<NetworkName, Promise<unknown>>();
  /**
   * What a press couldn't append to the outbox record, by network (f4): posted all the same, from memory. Each with the
   * phrase it was noted under (`phrasePin`'s ID; 1.10.0's second review): a posting run uses only the unlocked phrase's
   * (`outboxNow`), so a wallet removed and another restored in the same worker posts nothing of the first's.
   */
  private outboxNoted = new Map<NetworkName, Array<Waiting & { phrase: string }>>();
  /** What this worker posted or the relay refused, by `keyOf` and the entry's id: never posted again, nor put back. */
  private postedHere = new Set<string>();
  /** The reads' envelopes in memory, by network, oldest first, waiting for the runner to save and take them. */
  private batches = new Map<NetworkName, Batch[]>();
  /** Reads dropped past TAKES_BEHIND at a lane's end, by network, for the runner to count (`unopened`) and forget. */
  private dropped = new Map<NetworkName, Batch[]>();
  /** What the runner owes each network after its lanes (`firstPhase`): the posts to mark, the batches to save. */
  private due = new Map<NetworkName, { posted: Posted[]; batches: Batch[]; own?: PhrasePin }>();
  /** The batch each network's take is on, and where in it. */
  private takingNow = new Map<NetworkName, TakeAt>();
  /**
   * The networks whose inbox this service found won't open (W9): no lane reads their pool, and no take runs, until it
   * opens again or Messages are started again (`clear`). Found by whatever reads the inbox first: the page's overview,
   * which comes before its first sync, or the runner.
   */
  private unopenable = new Set<NetworkName>();
  /** The networks whose requests' list is behind their record (a refused inbox write after it): set right at the next take. */
  private requestsBehind = new Set<NetworkName>();
  /** The networks whose take stopped for room, until the next lane's first phase tries again (W11). */
  private blocked = new Set<NetworkName>();
  /** Posts whose bookkeeping found no room, by network: marked after the next lane (W11). */
  private postedLater = new Map<NetworkName, Posted[]>();
  /** The networks whose first window of this unlock has run (`firstWindow`), each with that unlock. */
  private windows = new Set<string>();
  /** The networks whose rest of the sweep, expiry or tidy is due, with what's due. */
  private rest = new Map<NetworkName, { sweep: boolean; expire: boolean }>();
  /** The runner, while it runs, and whether more was asked of it meanwhile. */
  private runner?: Promise<void>;
  private runAgain = false;
  /** The inbox the service last read or wrote, by network, with its unlock: what the overview answers from (O8). */
  private shown = new Map<NetworkName, { inbox: Inbox; at: number }>();
  /** The networks a read moved on since their take last set which Seedelfs take first messages (`noteOwn`). */
  private ownDue = new Map<NetworkName, PhrasePin>();
  /**
   * Conversations whose record was written and whose inbox write after it wasn't (the 1.10.0 gate's f4), by network:
   * set right from their records at the take's next bookkeeping write (`setRight`), or the sweep.
   */
  private inboxBehind = new Map<NetworkName, Map<string, boolean>>();
  /** First-contact stamps being solved, by conversation (`keyOf`). */
  private solving = new Set<string>();
  /** The prices the last page said, by network: 512, 2,048, 8,192 and 32,768 bytes. */
  private prices = new Map<NetworkName, number[]>();
  /**
   * No post before this (`monotonic` ms), by network: the edge or the server asked every post to wait. Copied to session
   * storage at each posting run's end, for a worker Chrome starts again (the freeze's fix D, `postRunsOf`).
   */
  private postAfter = new Map<NetworkName, number>();
  /** No post of a size (bytes) before this (`monotonic` ms), by network: the relay asked that size to wait (§17.4). Copied too. */
  private sizeAfter = new Map<NetworkName, Map<number, number>>();
  /**
   * What each network's posting runs keep between them (W15; the freeze's fixes C and D, `postRunsOf`): the answers
   * this version doesn't know in a row, by each envelope's stamp digest, and the envelope, by its digest, after which the
   * next run begins. Copied to session storage at each run's end: never a cid, nor anything that names a conversation.
   */
  private postRuns = new Map<NetworkName, PostRuns>();
  /**
   * Each network's epoch: bumped where what's in memory of its reads must go (Messages started again, a Seedelf turned
   * on): a take under an older one stops, writing nothing more (W12, W13), and a lane under one writes no cursor.
   */
  private epochs = new Map<NetworkName, number>();
  /** The networks whose rewind is being written (`rewind`): a lane that ends meanwhile writes nothing (f1). */
  private rewinding = new Map<NetworkName, number>();
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
  /**
   * Each network's relay off switch as this service holds it (W15; the freeze's fix A, `stopOf`): stopped, the next
   * probe's time (monotonic ms), and the unlock it's of. `stopped` false: known not to be, in that unlock.
   */
  private stops = new Map<NetworkName, { stopped: boolean; probe: number; at: number | undefined }>();
  private constants?: MessagingConstants;
  /** Reveal checks running, by conversation (`keyOf`): two presses are one check (`checkReveals`). */
  private checks = new Map<string, Promise<void>>();
  /** The conversations whose reveals the chain is being read for (`keyOf`): their thread says so. */
  private checking = new Set<string>();
  /** What runs in the background: stamps being solved, posts, the runner, held notices. */
  private background = new Set<Promise<unknown>>();
  /**
   * The networks whose take stopped for room (W11): a write of the take's own bookkeeping that would cross the storage
   * area's reserve, or that the browser refused. The next take tries again; the overview says so. Nothing in a lane
   * sets it.
   */
  private full = new Set<NetworkName>();
  /**
   * What each network's Messages records take as stored (W7, W11), as this service last read or wrote them, in the
   * unlock `sizesAt`: `inbox`, its inbox as stored; `lean`, its inbox as the budget counts it; `total`, the lean inbox
   * and each conversation's record together, what the budget counts; `largest`, its inbox as stored with every field a
   * take sets at its most (`inboxLargest`), what the area's reserve counts.
   */
  private sizes = new Map<NetworkName, { total: number; inbox: number; lean: number; largest?: number }>();
  /** What each network's requests record takes as stored, as last written in the unlock `sizesAt`. */
  private requestsBytes = new Map<NetworkName, number>();
  private sizesAt?: number;
  /** Each mark record's writes, one after another (W9). */
  private markWrites = new Map<RecordName, Promise<void>>();
  /** Whether each mark record holds a step, as this service last wrote it; unknown before its first write. */
  private marked = new Map<RecordName, boolean>();
  /** The page whose envelopes the next read scans one at a time, by network: Try again after a scan trapped (W9). */
  private oneByOne = new Map<NetworkName, PageSpan>();
  /** Conversations deleted while this worker runs (`keyOf`): posting stops at one without reading anything again. */
  private removed = new Set<string>();
  /** When each network was last expired (ms), without session storage. */
  private expired = new Map<NetworkName, number>();
  /** The relay's holds (`hold`), without session storage. */
  private holds = new Map<string, Partial<Record<NetworkName, number>>>();
  /**
   * The private store as minted-by.ts reads and writes it outside a lane: each call admitted (`admitted`), so the
   * runner's and the presses' calls into the wallet's queue keep off the lanes and the ticks (round 5).
   */
  private readonly gatedStore: PrivateStore;

  constructor(private readonly deps: MessagingDeps) {
    const store = deps.store;
    this.gatedStore = {
      get: <T>(name: RecordName) =>
        this.admitted(
          (admit, sealed) => store.open<T>(name, sealed, admit),
          () => store.sealed(name),
        ),
      set: (name: RecordName, value: unknown) => this.admitted((admit) => store.set(name, value, admit)),
    } as unknown as PrivateStore;
  }

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
    // A network Messages isn't open on (networks.ts `MESSAGING_NETWORKS`): refused in words, changing nothing. The
    // settings would write it off all the same (preferences.ts). Turning one off is always the user's.
    if (on && !this.deps.preferences.messagingOpen(network)) {
      throw new Error(t("worker.messaging.notOpenHere", { network: NETWORKS[network].label }));
    }
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
    this.notify(network);
  }

  /**
   * The conversations and requests on `network`, newest first. Throws if locked. Answered from what the service last
   * read or wrote, while unlocked (O8), so a list shows at once, even while a sync runs: what else it reads (the
   * settings, the trap's flag, the session's holds, which Seedelfs this browser made, the kept contract view) is the
   * wallet's own and the same size whatever any envelope held. Only where nothing is held yet is the inbox read, once
   * no lane runs and no tick is near.
   */
  async overview(network: NetworkName): Promise<MessagingOverview> {
    const at = await this.unlockStamp();
    if (at === undefined) throw new WalletLocked(t("worker.wallet.locked"));
    const [switches, inbox, stopped, paused, resting, takes, read] = await Promise.all([
      this.deps.preferences.get().then((p) => p.messaging),
      this.shownInbox(network, at),
      this.isStopped(network),
      this.stopOf(network),
      this.heldUntil(SESSION_READ_AFTER, network, DAY_READ_MAX_MS),
      this.takesShown(network, at),
      this.readShown(network, at),
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
    // The key's envelopes dropped unopened, less what the user has seen counted (round 4's review, #6).
    const droppedUnread = Math.max(0, takes.unopened + this.pendingUnopened(network) - takes.seen);
    const gapAt = read.gapAt;
    // How far this device's clock is off the relay's, in hours, as the last fresh post measured it (W14): said only past
    // half an hour, where first messages start to go unread.
    const off = read.clock?.off;
    return {
      on,
      conversations,
      requests,
      ...(gapAt !== undefined ? { gapAt } : {}),
      // The relay's off switch (fix A): stopped until it answers; the next sync from `pausedAskAt` asks it once.
      ...(on && paused !== undefined
        ? { paused: true as const, pausedAskAt: Math.max(now, now + (paused.probe - this.mono())) }
        : on && this.offline.has(network)
          ? { offline: true as const }
          : {}),
      // This address read its day's share of the pool (W16): no new messages are read until then; sending goes on.
      ...(on && paused === undefined && resting !== undefined ? { dayReadUntil: resting } : {}),
      ...(alsoOn.length ? { alsoOn } : {}),
      ...(seedelfs.length ? { seedelfs } : {}),
      ...(this.full.has(network) ? { full: true as const } : {}),
      ...(stopped ? { stopped: true as const } : {}),
      ...(dropped > 0 ? { dropped } : {}),
      ...(droppedUnread > 0 ? { droppedUnread } : {}),
      ...(off !== undefined && Math.abs(off) > CLOCK_OFF_MS ? { clockOff: Math.round(off / 360_000) / 10 } : {}),
    };
  }

  /** The inbox for what's shown: as last read or written in unlock `at`, or read once the gate opens. */
  private async shownInbox(network: NetworkName, at: number): Promise<Inbox> {
    const held = this.shown.get(network);
    if (held && held.at === at) return held.inbox;
    await this.gate();
    return this.inbox(network);
  }

  /** The take record's counts for what's shown: as held, or read once the gate opens, keeping nothing. */
  private async takesShown(network: NetworkName, at: number): Promise<Takes> {
    const held = this.takes.get(network);
    if (held && held.at === at) return held;
    await this.gate();
    const stored = await this.got<StoredTakes>(takeRecord(network)).catch((e: unknown) => {
      if (e instanceof UnreadableRecordError) return undefined;
      throw e;
    });
    return takesFromStored(stored);
  }

  /** The read record for what's shown (a gap, the clock): as held, or read once the gate opens, keeping nothing. */
  private async readShown(network: NetworkName, at: number): Promise<ReadState> {
    const held = this.readRecords.get(network);
    if (held && held.at === at) return held;
    await this.gate();
    const stored = await this.got<StoredRead>(readRecord(network)).catch((e: unknown) => {
      if (e instanceof UnreadableRecordError) return undefined;
      throw e;
    });
    return readFromStored(stored);
  }

  /** Reads a lane's end dropped past TAKES_BEHIND on `network` that the runner hasn't counted in the take record yet. */
  private pendingUnopened(network: NetworkName): number {
    const epoch = this.epochOf(network);
    return (this.dropped.get(network) ?? []).filter((b) => b.epoch === epoch).reduce((n, b) => n + new Set(b.envelopes).size, 0);
  }

  /**
   * The user has seen that `count` of `network`'s messages were dropped before they could be read (the overview's
   * `droppedUnread`; round 4's review, #6): the overview says no more of them, only those dropped since. No request; a
   * write of the take record's counts alone, in its chain. Returns the overview. Throws if locked.
   */
  async seenDropped(network: NetworkName, count: number): Promise<MessagingOverview> {
    if (Number.isSafeInteger(count) && count > 0) {
      await this.serial(async () => {
        const pin = phrasePin();
        await this.withKey((_key, keys) => pin(keys));
        await this.gate();
        await this.onChain(this.takeWrites, network, async () => {
          const held = await this.takesOf(network, pin);
          // Only what the record has counted: reads dropped in memory and not counted yet are said again once they are.
          const seen = Math.min(held.unopened, held.seen + count);
          if (seen > held.seen) await this.writeTakes(network, held, { ...held, seen });
        });
      });
      this.notify(network);
    }
    return this.overview(network);
  }

  /** A conversation's messages, which are then read. Throws if locked. Waits while a lane runs or a tick is near (O8). */
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
      // What's left of the writer's own share, from the record now (W17), or as held for a reply the thread doesn't
      // show (O4): one the inbox lost count of is set right.
      const share = shareOf(shareInfoOf(info, meta, file), file.history);
      const shareMoved = !sameShare(share, meta.firstContactLeft);
      if (share) meta.firstContactLeft = share;
      else delete meta.firstContactLeft;
      if (meta.unread || unreadIn(file, meta.readTo) || wasUnreadable || shareMoved) {
        meta.unread = 0;
        meta.readTo = file.next;
        await this.writeInbox(network, inbox, { kind: "bookkeeping" });
        // Read now: the top bar's count and Home's row change with it. Only then, so a page that reads the thread
        // again when told isn't told again.
        this.notify(network);
      }
      // Where this wallet wrote first and has a reply the thread shows (O4), the Seedelfs it can show (§19): those it
      // made or the user turned on (W8), from what the wallet holds, with no request.
      const seedelfs = meta.role === "initiator" && meta.answered && !info.sendsFirstContact ? (await this.handlesNow(network, inbox)).shown : undefined;
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

  /**
   * A request's messages, decrypted to show them; nothing changes but that they're read. Throws if locked. Waits while a
   * lane runs or a tick is near (O8): it reads the requests record, whose size strangers set.
   */
  request(network: NetworkName, cid: string): Promise<MessagingEntry[]> {
    return this.serial(async () => {
      const inbox = await this.inbox(network);
      if (!inbox.requestsShown[cid]) throw new Error(t("worker.messaging.noRequest"));
      const held = await this.requestsOf(network, inbox);
      const requests = held.requests;
      if (!requests) throw new Error(t("worker.messaging.noRequest"));
      const read = await this.recordsCall(
        network,
        inbox,
        held,
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
        this.notify(network);
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
    // Before the chain read: on a network Messages isn't open on, no server is asked anything for it.
    this.openHere(network);
    this.checkText(text);
    // The press's own chain read: its request, at once.
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
      // An ID the wallet holds already: refused before anything of this one is written, stamped or sealed (`refuseHeld`).
      this.refuseHeld(inbox, started.cid, started.conversation);
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
    this.notify(network);
    this.behind(this.stamp(network, cid));
    return cid;
  }

  /**
   * Starts a conversation again, to the same Seedelf, its first message `text`: for one whose first messages may
   * never be read (no reply after 48 hours, protocol.md §16.4). A new conversation; the old one says it was started
   * again as this one. Returns its cid.
   */
  async restart(network: NetworkName, cid: string, text: string): Promise<string> {
    this.openHere(network);
    await this.gate();
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
    this.openHere(network);
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
      // An ID the wallet holds already: refused before anything of this one is written, stamped or sealed (`refuseHeld`).
      this.refuseHeld(inbox, started.cid, started.conversation);
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
    this.notify(network);
    this.behind(this.stamp(network, next));
    return next;
  }

  /**
   * Sends `text` in conversation `cid`: sealed now, posted at once. Written first and not yet answered, it's refused
   * before it's queued where the writer's own share of first messages has no room for it, the texts still queued
   * counted (W17): in words, and nothing of it kept. Throws if locked.
   */
  async send(network: NetworkName, cid: string, text: string): Promise<void> {
    this.openHere(network);
    this.checkText(text);
    await this.serial(async () => {
      const inbox = await this.inbox(network);
      const meta = inbox.conversations[cid];
      const file = meta && (await this.fileFor(network, inbox, meta));
      if (!meta || !file) throw new Error(t("worker.messaging.noConversation"));
      const info = await this.infoFor(network, inbox, meta, file.state);
      const { maxTextLen } = info;
      // What a reader keeps of a stranger's before replying (DESIGN-protocol §3.5), or what's held of it for a reply the
      // thread doesn't show (O4): used up, the next text waits for a reply; with room, a text past it is too long, by
      // what's left.
      const share = shareOf(shareInfoOf(info, meta, file), file.history);
      if (share?.messages === 0) throw new ShareUsedUp();
      this.checkFits(share ? Math.min(maxTextLen, share.bytes + 1) : maxTextLen, text);
      const now = this.deps.now();
      const before = pendingIds(file);
      const entry: Entry = { id: file.next++, dir: "out", at: now, text, sent: "queued" };
      file.history.push(entry);
      // Before its stamp, a first-contact message waits: it's sealed with the others once the stamp is set. After it,
      // it's sealed now, behind any text still queued from then (W13), in order.
      const refused = file.stampDigest ? undefined : this.sealQueued(file);
      // The crate's own word for the share used up: never the server's, and nothing of it is kept. Unreachable while
      // the worker's count matches the crate's, which refused the text above (`sealQueued` tells the test hook).
      if (refused === "request_full") throw new ShareUsedUp();
      meta.lastAt = now;
      // Kept once its record is written, which the post reads (f4): an inbox write refused after it refuses nothing.
      await this.commit(network, inbox, cid, file, "content", undefined, true, newlyPending(file, before));
    });
    this.notify(network);
    this.behind(this.post(network));
  }

  /**
   * Sends message `id` of conversation `cid` again: the same bytes, which the server refused (a 400 or a 413, from the
   * relay or from something on the way, worker-net#8), posted once more. The ratchet doesn't step: it's the envelope
   * sealed the first time. Anything else (one posted meanwhile, one the wallet couldn't seal, with no bytes) is left
   * as it is. Throws if locked.
   */
  async resend(network: NetworkName, cid: string, id: number): Promise<void> {
    this.openHere(network);
    const again = await this.serial(async () => {
      const inbox = await this.inbox(network);
      const meta = inbox.conversations[cid];
      const file = meta && (await this.fileFor(network, inbox, meta));
      if (!meta || !file) throw new Error(t("worker.messaging.noConversation"));
      const entry = file.history.find((e) => e.id === id);
      if (entry?.sent !== "refused" || !entry.envelope) return false;
      entry.sent = "pending";
      // Posted again by this worker too: what it posted before is no longer what it holds back.
      this.postedHere.delete(`${keyOf(network, cid)}:${id}`);
      await this.commit(network, inbox, cid, file, "bookkeeping", undefined, true, [entry]);
      return true;
    });
    if (!again) return;
    this.notify(network);
    this.behind(this.post(network));
  }

  /**
   * Shows the other side of conversation `cid` this wallet's Seedelf `name` (asset name, hex), in a message of its own
   * (protocol.md §19): only where this wallet wrote first, once a reply has come, and only a Seedelf this browser put
   * at the register a contract read finds it at now, or one the user turned on there (W8). That register is what the
   * reader's check compares, and the read names no Seedelf. Throws if locked.
   */
  async reveal(network: NetworkName, cid: string, name: string): Promise<void> {
    // Before the chain read: on a network Messages isn't open on, no server is asked anything for it.
    this.openHere(network);
    // The press's own chain read: its request, at once.
    const own = await this.deps.ownSeedelfs(network, true);
    const register = own?.find((s) => s.name === name)?.register;
    if (!register) throw new Error(t("worker.messaging.notYourSeedelf"));
    await this.gate();
    // A pair, never a name alone: one the chain now shows under another register (a sum someone minted, or a chain
    // source that says so) isn't the one this browser put it under, nor one the user turned on.
    if (!(await this.showsAt(network, await this.inbox(network), name, register))) throw new Error(t("worker.messaging.notYourSeedelf"));
    await this.serial(async () => {
      const pin = phrasePin();
      const inbox = await this.inbox(network);
      const meta = inbox.conversations[cid];
      const file = meta && (await this.fileFor(network, inbox, meta));
      if (!meta || !file) throw new Error(t("worker.messaging.noConversation"));
      // Only once a reply the thread shows has come (O4): the crate allows a reveal after any reply that decrypts, a
      // control kind's too, and what the user can do here changes only with what the thread shows.
      if (!meta.answered) throw new Error(t("worker.messaging.cantRevealYet"));
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
      const before = pendingIds(file);
      // Behind any text still queued (W13), in order.
      const earlier = this.sealQueued(file);
      if (earlier === "request_full") throw new ShareUsedUp();
      const entry: Entry = { id: file.next++, dir: "out", at: now, kind: KIND_REVEAL, reveal: { dir: "out", name }, sent: "queued" };
      file.history.push(entry);
      const refused = this.sealPlaintext(file, entry, revealPlaintextOf(made.reveal));
      if (refused === "request_full") {
        // Unreachable: a reveal is sealed only once answered, when the crate counts no share (relay-oracle fix item 2).
        this.deps.unreachable?.("reveal");
        throw new ShareUsedUp();
      }
      meta.lastAt = now;
      await this.commit(network, inbox, cid, file, "content", undefined, true, newlyPending(file, before));
    });
    this.notify(network);
    this.behind(this.post(network));
  }

  /**
   * Accepts a request: its conversation, with its messages, which the reply is then sent in. Throws if locked.
   *
   * Its writes, in order (1.10.0's second review): the conversation's record; the inbox, which lists the conversation,
   * no longer lists the request, marks it as left in its record (`requestLeft`) and no longer notes the requests'
   * record's nonce (`requestsAs`); the requests' record without the request; the inbox again, with that record's new
   * nonce and, where no earlier accept's mark stood, without the mark. So the request stays in its record until its
   * conversation is listed, and a stop or a lock between any two leaves the first message readable:
   *   - after the conversation's record alone: a record nothing lists, which the sweep deletes, and the request as it
   *     was, in its record and in the list, to accept again;
   *   - after the first inbox: the conversation, listed, and the request still in its record, which nothing lists. The
   *     mark has the repair read that record (`repairRequests`), which drops from it a request whose conversation is
   *     held, and never lists one: at a worker's or an unlock's first window, and before a take hands the crate the
   *     record or anything is deleted (`settled`). Whatever writes the record meanwhile (Accept another, Delete a
   *     request, a stranger's first message) notes its nonce, and leaves the mark;
   *   - after the requests' record: all but the nonce and the mark, which the same repair sets right.
   * A third or fourth write the browser refuses is the same stop, and accepted all the same. Chrome stops the worker
   * about 30 seconds after its last activity, the wallet still unlocked: nothing of this waits in memory.
   *
   * A request whose conversation's ID a tombstone holds is refused (`deleted`), with nothing written: one left in its
   * record by a stop above, listed again after its conversation was deleted, is never accepted a second time.
   */
  async accept(network: NetworkName, cid: string): Promise<void> {
    this.openHere(network);
    await this.serial(async () => {
      const pin = phrasePin();
      const inbox = await this.inbox(network);
      const info = inbox.requestsShown[cid];
      if (!info) throw new Error(t("worker.messaging.noRequest"));
      const held = await this.requestsOf(network, inbox);
      const requests = held.requests;
      if (!requests) throw new Error(t("worker.messaging.noRequest"));
      const asked = JSON.stringify({ requests, cid });
      const [read, accepted] = await this.recordsCall(
        network,
        inbox,
        held,
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
      // One whose conversation was deleted here, its tombstone standing (1.10.0's second review): a request an Accept
      // left in its record can be listed again once that conversation is deleted. Accepted, it would be a conversation
      // neither side's messages reach; and under a random source that repeats, the first accept's own keys again, its
      // first reply sealed under the first's key and nonce. Refused in the crate's word for a tombstone, before
      // anything is listed or written: the request stays as it is, to be deleted.
      if (this.tombstoned(inbox, cid, accepted.conversation)) throw new MessagingRefused("deleted");
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
      // The conversation is listed before the request leaves its record (above): a stop between the two loses neither.
      // Until the record is written without it, the inbox marks it, in the very write that lists the conversation, and
      // notes no nonce for the record: the repair reads it, whatever else writes the record first.
      const marked = inbox.requestLeft;
      inbox.requestLeft = true;
      delete inbox.requestsAs;
      await this.writeInbox(network, inbox);
      try {
        await this.writeRequests(network, inbox, { ...held, requests: accepted.requests });
        // The record as just written holds no accepted request, unless an earlier accept left one: its mark stands.
        if (!marked) delete inbox.requestLeft;
        await this.writeInbox(network, inbox, { kind: "bookkeeping" });
      } catch (e) {
        // Accepted all the same: its conversation is listed, and what's left is the repair's. A write the browser
        // refuses, or a read of storage that fails, refuses nothing here; a lock or a trap is thrown as ever.
        if (!(e instanceof MessagingFull) && !(e instanceof StorageFailed)) throw e;
      }
      this.notify(network);
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
      this.notify(network);
    });
  }

  /**
   * Deletes a conversation or a request: its ID is kept as a tombstone until its `t` + 48 hours and 7 days. One whose
   * record won't open, or that the crate can't read (a development build's, a later version's), is deleted all the
   * same, with no tombstone: its F, and so its t, can't be read (W9, W17). Never refused for room: it only frees some.
   * Throws if locked.
   *
   * What a conversation has waiting to be posted goes first (1.10.0's second review): from the outbox record, which a
   * posting run reads alone, and from what presses noted in memory; then the inbox stops listing it; then its record
   * goes. From that first write no posting run of this worker posts it (`removed`). So a stop or a lock mid-deletion
   * leaves it whole (still listed, its message still waiting, the outbox record written again from its record at the
   * next first window: the user sees it, and deletes again) or gone with nothing to post. A write that fails before
   * the inbox stops listing it is a deletion that failed: the press says so, the conversation stays, and what was
   * dropped is noted in memory again, under the phrase unlocked now, so this worker posts it as it would have. But for
   * a lock, which notes nothing: the next unlock's first window writes the outbox again from the records, and nothing
   * noted can outlive its phrase.
   */
  remove(network: NetworkName, cid: string): Promise<void> {
    return this.serial(async () => {
      // A request an Accept left in its record leaves it first: its conversation deleted, it would be listed again.
      const inbox = await this.settled(network);
      const meta = inbox.conversations[cid];
      // A request's deletion hands the crate the requests record; a conversation's never does (round 5).
      const request = !meta && inbox.requestsShown[cid] !== undefined;
      const held = request ? await this.requestsOf(network, inbox) : undefined;
      const file = meta && !meta.unreadable ? await this.readable(network, meta) : undefined;
      const files = new Map<string, ConversationFile>(file ? [[cid, file]] : []);
      const ask = () =>
        JSON.stringify({
          cid,
          ...(files.has(cid) ? { conversation: files.get(cid)!.state } : {}),
          ...(held?.requests ? { requests: held.requests } : {}),
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
      const deleted = del() ?? (this.setAside(inbox, files, { requests: held, tombstones: true }) ? del() : undefined) ?? {};
      if (deleted.tombstones !== undefined) inbox.tombstones = deleted.tombstones;
      delete inbox.conversations[cid];
      delete inbox.requestsUnread[cid];
      delete inbox.requestsShown[cid];
      for (const other of Object.values(inbox.conversations)) if (other.restartedAs === cid) delete other.restartedAs;
      // Nothing of it is posted, now or after a restart: held back from this worker's posting runs, and out of the
      // outbox before anything stops listing it.
      const key = keyOf(network, cid);
      const holding = !this.removed.has(key);
      this.removed.add(key);
      let dropped: Waiting[] = [];
      try {
        if (meta) dropped = await this.dropFromOutbox(network, (w) => w.cid === cid);
        if (held && (deleted.requests !== undefined || held.changed)) {
          await this.writeRequests(network, inbox, { ...held, ...(deleted.requests !== undefined ? { requests: deleted.requests } : {}) });
        }
        await this.writeInbox(network, inbox, { kind: "bookkeeping" });
      } catch (e) {
        // Not deleted: as it was before the press, what it had waiting noted in memory, each once (`noteWaiting`). Not
        // at a lock: the first window after the unlock writes the outbox again from the records (`repairOutbox`). And
        // noting asks for the phrase unlocked then, a question that waits while a tick is near: whoever unlocked in
        // that wait would answer it, another phrase restored included, and its posting run would send these.
        if (holding) this.removed.delete(key);
        if (!(e instanceof WalletLocked)) await this.noteWaiting(network, dropped);
        throw e;
      }
      // Unlisted from here: the record nothing lists goes now, or at the next sweep.
      if (meta?.id) await this.deps.store.remove(conversationRecord(network, meta.id));
      this.inboxBehind.get(network)?.delete(cid);
      // Room, maybe: the next take says again.
      this.full.delete(network);
      this.blocked.delete(network);
      this.notify(network);
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
        const view = await this.keptView(network);
        if (!view?.some((s) => s.name === name && sameRegister(s.register, pair))) throw new Error(t("worker.messaging.notYourSeedelf"));
        // The user's own press lifts a removal's mark (a Remove that never landed) and a pair a view dropped (f6).
        await clearRemoved(this.gatedStore, network, name).catch((e: unknown) => {
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
      // From the pool's oldest, before the choice is written (f1): the read record's cursor cleared and written, then
      // what's in memory of the reads, and any take running, forgotten, and the take record's reads dropped. A lane
      // begun before writes no cursor at its end; one begun after reads from the oldest. The take of what it finds
      // waits in the runner for the choice below.
      if (on && !was) await this.rewind(network);
      await this.writeInbox(network, inbox, { kind: "bookkeeping" });
    });
    this.notify(network);
    return this.overview(network);
  }

  /**
   * Try again (W9): the sync of a network a trap stopped, with the envelope it trapped on stepped over (kept in the
   * read record's skip list for SKIP_FOR_MS), in the reads and the take alike, or, where a page's scan trapped, that
   * page's envelopes scanned one at a time, each under a mark of its own, so a trap among them names the one. So one bad
   * envelope costs a lock by itself and at most one more at the user's press. Throws if locked.
   */
  async retry(network: NetworkName): Promise<void> {
    if ((await this.deps.wallet.state()) !== "unlocked") throw new WalletLocked(t("worker.wallet.locked"));
    if (await this.isStopped(network)) {
      await this.gate();
      // Only the step that trapped (W13): a take that ran beside a scan that trapped is no part of it, nor the other way.
      const trapped = await this.deps.local.get<unknown>(trapKey(network));
      const markOf = <T>(step: MarkStep) =>
        this.got<T>(markRecord(network, step)).catch((e: unknown) => {
          if (e instanceof UnreadableRecordError) return undefined;
          throw e;
        });
      // A flag from before W13 said `true`, not which: the take's, then the scan's, as then.
      const take = trapped === "scan" ? undefined : await markOf<TakeMark>("take");
      const scan = trapped === "take" ? undefined : await markOf<ScanMark>("scan");
      const envelope = take?.envelope ?? scan?.envelope;
      if (envelope) {
        const pin = phrasePin();
        const held = await this.readHeld(network, pin);
        const now = this.deps.now();
        held.skip = [...held.skip.filter((s) => s.until > now && s.envelope !== envelope), { envelope, until: now + SKIP_FOR_MS }].slice(-SKIP_KEPT);
        held.dirty = true;
        await this.writeRead(network, held, true);
      } else if (scan?.page) {
        this.oneByOne.set(network, scan.page);
      }
      for (const step of ["scan", "take"] as const) {
        await this.admitted((admit) => this.deps.store.set(markRecord(network, step), {}, admit));
        this.marked.set(markRecord(network, step), false);
      }
      await this.deps.local.remove(trapKey(network));
      this.notify(network);
    }
    await this.sync(network);
  }

  /**
   * Starts `network`'s Messages again (W9): its inbox and every record deleted, with no key needed: for an inbox that
   * won't open, whose page asks first. What was being read or taken there is dropped, and a take running stops before
   * its next write (W13). Returns the overview. Throws if locked.
   */
  async clear(network: NetworkName): Promise<MessagingOverview> {
    if ((await this.deps.wallet.state()) !== "unlocked") throw new WalletLocked(t("worker.wallet.locked"));
    this.forget(network);
    this.readRecords.delete(network);
    const names = [
      `messaging.${network}`,
      takeRecord(network),
      readRecord(network),
      outboxRecord(network),
      requestsRecord(network),
      markRecord(network, "scan"),
      markRecord(network, "take"),
    ];
    await this.serial(async () => {
      // Asked of this unlock's Messages: never another's, restored while it waited here (`mine`).
      this.mine();
      const records = await this.deps.local.keys(PRIVATE_PREFIX + CONVERSATION_RECORDS + network + ".");
      await this.deps.local.remove(...names.map((n) => PRIVATE_PREFIX + n), trapKey(network), ...records);
    });
    // And again in each record's chain, after any write of it that began before the epoch moved: none outlives this.
    const removeIn = (chain: Map<NetworkName, Promise<unknown>>, name: RecordName) =>
      this.onChain(chain, network, async () => {
        await this.deps.local.remove(PRIVATE_PREFIX + name);
      });
    // The marks' chains too (round 4's review, #5): a take's mark being written as Messages start again lands, and goes.
    const removeMark = (step: MarkStep) => {
      const name = markRecord(network, step);
      const run = (this.markWrites.get(name) ?? Promise.resolve()).catch(() => undefined).then(async () => {
        await this.deps.local.remove(PRIVATE_PREFIX + name);
        this.marked.set(name, false);
      });
      this.markWrites.set(name, run);
      return run;
    };
    await Promise.all([
      removeIn(this.takeWrites, takeRecord(network)),
      removeIn(this.readWrites, readRecord(network)),
      removeIn(this.outboxWrites, outboxRecord(network)),
      removeMark("scan"),
      removeMark("take"),
    ]);
    this.forget(network);
    this.readRecords.delete(network);
    this.unopenable.delete(network);
    this.full.delete(network);
    this.blocked.delete(network);
    this.offline.delete(network);
    this.sizes.delete(network);
    this.shown.delete(network);
    this.inboxBehind.delete(network);
    this.outboxNoted.delete(network);
    for (const step of ["scan", "take"] as const) this.marked.set(markRecord(network, step), false);
    this.oneByOne.delete(network);
    this.notify(network);
    return this.overview(network);
  }

  /**
   * Forgets what's in memory of `network`'s reads, and stops any take of it before its next write (its epoch moves, W12,
   * W13): a lane running now writes no cursor at its end, and the next take goes on from what the take record holds.
   */
  private forget(network: NetworkName): void {
    this.epochs.set(network, this.epochOf(network) + 1);
    this.takes.delete(network);
    this.batches.delete(network);
    this.dropped.delete(network);
    this.takingNow.delete(network);
    this.due.get(network)?.batches.splice(0);
    this.ownDue.delete(network);
  }

  private epochOf(network: NetworkName): number {
    return this.epochs.get(network) ?? 0;
  }

  /**
   * Reads `network`'s pool again from its oldest (W12; the 1.10.0 gate's f1, finding 8 and round 5): the read record's
   * cursor cleared and written first, with nothing owed, since the read from the oldest finds it all again; then what's
   * in memory of the reads, and any take running, go (`forget`); then the take record's reads, its counts staying.
   */
  private async rewind(network: NetworkName): Promise<void> {
    const pin = phrasePin();
    const held = await this.readHeld(network, pin);
    this.rewinding.set(network, (this.rewinding.get(network) ?? 0) + 1);
    try {
      delete held.cursor;
      held.owed = 0;
      held.dirty = true;
      await this.writeRead(network, held, true);
      this.forget(network);
    } finally {
      const left = (this.rewinding.get(network) ?? 1) - 1;
      if (left > 0) this.rewinding.set(network, left);
      else this.rewinding.delete(network);
    }
    await this.gate();
    await this.onChain(this.takeWrites, network, async () => {
      const kept = await this.takesOf(network, pin);
      if (kept.stored && kept.batches.length) await this.writeTakes(network, kept, { ...kept, batches: [] });
    });
  }

  // -------------------------------------------------------------------------
  // Lanes: the wallet's requests to the relay
  // -------------------------------------------------------------------------

  /**
   * Reads `network`'s pool from where the last read ended, then posts what's waiting: one lane (round 5). What the read
   * found is saved and taken by the runner after it. One at a time per network: asked during one, it's that one, and
   * nothing runs again after it, so the next read comes at the next tick (W4). Nothing while the switch is off or the
   * wallet is locked, and nothing by itself once a step of the network trapped: only Try again (`retry`, W9). `from`: the
   * page that asked, with its poll (`notePage`).
   */
  sync(network: NetworkName, from?: { page?: unknown; kind?: unknown }): Promise<void> {
    this.notePage(from);
    const running = this.syncs.get(network);
    if (running) return running;
    // The lane starts here, before the first await: a screen's read that comes after a page's sync waits for it.
    this.laneStart(network);
    const run = (async () => {
      try {
        if (await this.isStopped(network)) return;
        await this.syncNow(network);
      } finally {
        this.syncs.delete(network);
        this.laneEnd(network);
      }
    })();
    this.syncs.set(network, run);
    return run;
  }

  /**
   * Syncs every network of `networks` whose switch is on: the alarm's run, and the unlock's. The alarm stops while
   * the wallet is locked or no switch is on, and the unlock starts it again. A network whose switch is off is tidied
   * by the runner with no request: what only a sync cleans up (skipped keys past their 48 hours, tombstones past their
   * t + 48 hours and 7 days, a record a stop left behind) goes all the same (worker-state#12).
   *
   * The run is marked as it begins, before its first await (`runStart`; 1.10.0's second review, F3): it reads the
   * settings and the wallet's state before any lane of its starts, and that state's read waits its turn in the wallet's
   * queue, behind another feature's long task where there is one. Marked, nothing gated is admitted meanwhile, however
   * long that takes. `from.alarm`: the alarm's own run (sw.ts), which alone serves the alarm's tick (`live`, F1); an
   * unlock's run serves none. The mark goes as the run ends, whatever it found to read.
   */
  async syncAll(networks: readonly NetworkName[], from: { alarm?: boolean } = {}): Promise<void> {
    this.runStart(from.alarm === true);
    try {
      const switches = (await this.deps.preferences.get()).messaging;
      const unlocked = (await this.deps.wallet.state()) === "unlocked";
      const on = networks.filter((n) => switches[n]);
      if (!on.length || !unlocked) await this.deps.alarm?.stop();
      else {
        await this.deps.alarm?.start();
        // The reads first, at the tick, each network's lane marked before its first await, so the runner and the
        // screens' work keep off them: nothing of another network's comes before them but its own lane's fixed reads
        // (W13, round 5).
        await Promise.all(on.map((n) => this.sync(n).catch(rethrowTrap)));
      }
      if (unlocked) for (const n of networks) if (!switches[n]) this.dueRest(n, { sweep: true, expire: true });
    } finally {
      // The run's end wakes the runner, as a lane's end does: its lanes' own ends didn't, the run still marked.
      this.runEnd();
    }
  }

  /**
   * One sync's lane (round 5): the phrase pin; the read record, from memory or one fixed read; the pool's pages, their
   * scans and the scan's mark (while the relay is stopped, the probe's one page once it's due, fix A); the posts, from
   * the outbox record; then the mark cleared and the read record written.
   * Nothing else is read or written, nothing is opened, and nothing is told to the screens until it ends. What it found
   * and posted goes to the runner, which saves, takes and marks it after the lane.
   */
  private async syncNow(network: NetworkName): Promise<void> {
    if (!(await this.isOn(network))) return;
    if ((await this.deps.wallet.state()) !== "unlocked") return;
    // An inbox this service found won't open: nothing is read until Messages are started again (W9, cross-feature#8).
    if (this.unopenable.has(network)) return;
    // Bound to the phrase now, before anything is asked: a wallet removed and another restored while the first page
    // is on its way gets nothing of this one's (worker-state#8).
    const pin = phrasePin();
    await this.laneKey((_key, keys) => pin(keys));
    const epoch = this.epochOf(network);
    const out: ReadOut = { found: [], gap: false, envelopes: false, marked: false, trapped: false };
    const held = await this.readFor(network, pin);
    out.from = held.cursor;
    try {
      // 1. The read: pages and the scan, nothing else. Not while this address has read its day's share of the pool
      // (W16). While the relay is stopped (W15; the freeze's fix A), one page alone, the probe, once it's due (an hour
      // after the last 410), the day's reading held or not: only an answer of the relay's own ends the stop.
      const stop = await this.stopOf(network);
      const resting = await this.heldUntil(SESSION_READ_AFTER, network, DAY_READ_MAX_MS);
      if (stop) {
        if (stop.probe <= this.mono()) await this.readPool(network, pin, held, out, 1);
      } else if (resting === undefined) {
        await this.readPool(network, pin, held, out);
      }
      // 2. What's waiting, right after the read, from the outbox record alone. While the relay is stopped nothing is
      // solved or posted (W15).
      if (!(await this.stopOf(network))) await this.post(network);
    } finally {
      // 3. The lane's end: the scan's mark cleared (never between two pages, nor before the posts), and the read record
      // written once, where the pages moved it. What the read found goes to the runner.
      await this.laneDone(network, epoch, pin, held, out);
    }
  }

  /**
   * The end of a sync's lane: the scan's mark cleared where the read made one and nothing trapped; then, unless a
   * rewind or Messages started again since the lane began (its epoch moved), the read record moved to where the pages
   * ended, with what the read found owed, and written, where the pages moved it: whether it's written depends on the
   * pages alone (the cursor moved, a page held envelopes, or a gap), never on whether the scan matched (1.10.0's second
   * review, F2: a relay that isn't §17's can serve envelopes and leave the cursor where it was, and a write made only
   * for a match would then say which wallet they were for). The batch, and that the take should look at the Seedelfs
   * again, go to the runner. A lane overtaken by a rewind drops its batch and writes no cursor.
   */
  private async laneDone(network: NetworkName, epoch: number, pin: PhrasePin, held: ReadHeld, out: ReadOut): Promise<void> {
    if (out.marked && !out.trapped) await this.setMark(network, "scan", undefined, undefined, true).catch(() => undefined);
    if (out.trapped || out.failed) return;
    // A rewind since the lane began, or one being written now: this lane's read goes, and the next reads from the oldest.
    const fresh = this.epochOf(network) === epoch && this.readRecords.get(network) === held && !this.rewinding.has(network);
    if (!fresh) return;
    const moved = out.cursor !== undefined && (out.cursor !== out.from || out.envelopes || out.gap);
    if (moved) {
      held.cursor = out.cursor;
      held.owed += out.found.length;
      held.dirty = true;
      // A gap the relay said: open pages are told, once the gate opens, as of any change (round 4's review).
      if (out.gap) {
        held.gapAt = this.deps.now();
        this.notify(network);
      }
    }
    // Only where the pages moved it: a change the runner or a press made (what's owed lowered by a take, say) is theirs
    // to write, once the gate opens (`writeRead`, gated), never the lane's (the 1.10.0 gate's round 5).
    if (moved) await this.writeRead(network, held, false);
    const due = this.dueOf(network);
    due.own = pin;
    if (!out.found.length) return;
    const batch: Batch = { to: out.cursor, envelopes: out.found, pin, saved: false, owed: out.found.length, epoch };
    due.batches.push(batch);
    const waiting = this.batchesOf(network);
    waiting.push(batch);
    this.batches.set(network, waiting);
    // Too far behind (W10): the oldest read waiting goes, never the one being taken, in memory alone; the runner counts
    // it (`unopened`), and what it owed stays owed until then, so a stop counts it too. A few objects, whatever matched.
    const taking = this.takingNow.get(network)?.batch;
    while (waiting.filter((b) => !b.done).length > 1 + TAKES_BEHIND) {
      const at = waiting.findIndex((b) => !b.done && b !== taking);
      const [gone] = waiting.splice(at, 1);
      this.droppedOf(network).push(gone!);
    }
  }

  /** The reads dropped past TAKES_BEHIND on `network`, waiting for the runner to count them. */
  private droppedOf(network: NetworkName): Batch[] {
    let dropped = this.dropped.get(network);
    if (!dropped) this.dropped.set(network, (dropped = []));
    return dropped;
  }

  /**
   * Until when (ms, this device's clock) a hold kept in session storage under `key` holds `network` (the day's reading,
   * W16), or undefined when none does. One further off than `most` is a clock set back since: it holds no more. A lock
   * clears them all.
   */
  private async heldUntil(key: string, network: NetworkName, most: number): Promise<number | undefined> {
    const session = this.deps.session;
    const kept = session ? await session.get<Partial<Record<NetworkName, number>>>(key).catch(() => undefined) : this.holds.get(key);
    const until = kept?.[network];
    const now = this.deps.now();
    return until !== undefined && until > now && until - now <= most ? until : undefined;
  }

  /**
   * Holds `network` under `key` until `until` (ms), or lets it go (undefined): in session storage, else in memory. A read
   * of it that fails writes nothing, so the other network's entry is never written away (the freeze's fix A); a write
   * that fails is let go.
   */
  private async hold(key: string, network: NetworkName, until: number | undefined): Promise<void> {
    const session = this.deps.session;
    let kept: Partial<Record<NetworkName, number>> | undefined;
    try {
      kept = session ? await session.get<Partial<Record<NetworkName, number>>>(key) : this.holds.get(key);
    } catch {
      return;
    }
    kept ??= {};
    if (until === undefined && kept[network] === undefined) return;
    const next = { ...kept };
    if (until === undefined) delete next[network];
    else next[network] = until;
    if (session) await session.set(key, next).catch(() => undefined);
    else this.holds.set(key, next);
  }

  /**
   * `network`'s relay off switch, where it's on (W15; the 1.10.0 gate's round 5, the freeze's fix A): set by a 410, a
   * page's or a post's, and ended by an answer of the relay's own alone (`relayAnswered`), never by a timer. `probe`:
   * when a sync next asks a page to see whether it answers (monotonic ms). Held in memory for this unlock, as `sizesNow`
   * ties sizes to one: a lock ends it. Where memory holds nothing of this unlock (a worker Chrome started since), the
   * session's copy, its probe's time on the device's clock within PAUSED_ASK_MS (further off: a clock set back since,
   * and it's due now). A read of the copy that fails says nothing is known, and keeps nothing.
   */
  private async stopOf(network: NetworkName, outside = false): Promise<{ probe: number } | undefined> {
    const at = await (outside ? this.stampNow() : this.unlockStamp());
    const held = this.stops.get(network);
    if (held && held.at === at) return held.stopped ? held : undefined;
    this.stops.delete(network);
    const session = this.deps.session;
    if (!session) return undefined;
    let kept: Partial<Record<NetworkName, number>> | undefined;
    try {
      kept = await session.get<Partial<Record<NetworkName, number>>>(SESSION_PAUSED);
    } catch {
      return undefined;
    }
    const until = kept?.[network];
    const stop =
      typeof until === "number" && Number.isFinite(until)
        ? (() => {
            const left = until - this.deps.now();
            return { stopped: true, probe: this.mono() + (left > 0 && left <= PAUSED_ASK_MS ? left : 0), at };
          })()
        : { stopped: false, probe: 0, at };
    if (at !== undefined) this.stops.set(network, stop);
    return stop.stopped ? stop : undefined;
  }

  /**
   * A 410 (fix A): `network` stopped, its probe an hour on, in memory and in the session's copy; a copy that can't be
   * written leaves memory's. Open pages are told.
   */
  private async setStop(network: NetworkName): Promise<void> {
    this.stops.set(network, { stopped: true, probe: this.mono() + PAUSED_ASK_MS, at: await this.unlockStamp() });
    await this.hold(SESSION_PAUSED, network, this.deps.now() + PAUSED_ASK_MS);
    this.offline.delete(network);
    this.notify(network);
  }

  /** An answer of the relay's own (fix A): any stop of `network` ends. Whether there was one, for open pages to be told. */
  private async endStop(network: NetworkName): Promise<boolean> {
    const held = this.stops.get(network);
    // Known not stopped: only this service writes the copy, so memory has been told of any stop since.
    if (held && !held.stopped) return false;
    if (!(await this.stopOf(network))) return false;
    this.stops.set(network, { stopped: false, probe: 0, at: await this.unlockStamp() });
    await this.hold(SESSION_PAUSED, network, undefined);
    return true;
  }

  /** Whether memory holds `network` stopped now, with no read: what a solve looks at between its slices (fix A). */
  private stoppedNow(network: NetworkName): boolean {
    return this.stops.get(network)?.stopped === true;
  }

  /**
   * The read record for a lane (round 5): as held, under this phrase, in this unlock; otherwise one read of it, its one
   * fixed size, after which memory's copy is still the one kept where a write of it failed or was never made, in any
   * unlock of this phrase (F4). Nothing else a read needs is read.
   * `outside`: a press's or the runner's (`readHeld`), each of its calls into the wallet's queue admitted.
   */
  private async readFor(network: NetworkName, pin: PhrasePin, outside = false): Promise<ReadHeld> {
    const phrase = await (outside ? this.withKey((_key, keys) => pin(keys)) : this.laneKey((_key, keys) => pin(keys)));
    const at = await (outside ? this.stampNow() : this.unlockStamp());
    const held = this.readRecords.get(network);
    if (held && held.phrase === phrase && held.at === at) return held;
    let stored: StoredRead | undefined;
    try {
      stored = await (outside ? this.got<StoredRead>(readRecord(network)) : this.rawGot<StoredRead>(readRecord(network)));
    } catch (e) {
      // One that won't open holds nothing a read can't bring back: the read goes from the pool's oldest.
      if (!(e instanceof UnreadableRecordError)) throw e;
    }
    // Memory's copy from an earlier unlock with a write still to make (what's owed lowered as a lock came, or a write
    // the browser refused): the newer of the two, so it's kept. The sealed read above was made all the same (1.10.0's
    // second review, F4): only a wallet that was taking something lowers what's owed, so a lane that skipped its
    // record's read after such a lock would say so.
    if (held && held.dirty && held.phrase === phrase && this.readRecords.get(network) === held) {
      held.at = at;
      return held;
    }
    const now: ReadHeld = { ...readFromStored(stored), at, phrase, dirty: false };
    this.readRecords.set(network, now);
    return now;
  }

  /** The read record for a press's or the runner's bookkeeping: as held, or read admitted (`admitted`). */
  private async readHeld(network: NetworkName, pin: PhrasePin): Promise<ReadHeld> {
    const held = this.readRecords.get(network);
    if (held) {
      const phrase = await this.withKey((_key, keys) => pin(keys));
      if (held.phrase === phrase) return held;
    }
    return this.readFor(network, pin, true);
  }

  /**
   * Writes `network`'s read record as `held` stands, in its chain (round 5): a fixed write, never looked at against the
   * area's reserve and never `full`. One the browser refuses leaves it to write again at the next chance; the lane goes
   * on from memory. `gated`: a press's or the runner's, which joins the chain once the gate opens, each of its calls
   * admitted, and leaves it, to join again, where one is turned away (`chained`).
   */
  private async writeRead(network: NetworkName, held: ReadHeld, gated: boolean): Promise<void> {
    const write = async (admit?: Admit) => {
      if (this.readRecords.get(network) !== held || !held.dirty) return;
      // Only under the phrase it was read under: a wallet removed and another restored meanwhile gets nothing of it.
      if ((await this.laneKey((_key, keys) => phrasePin()(keys), admit)) !== held.phrase) return;
      held.dirty = false;
      try {
        await this.deps.store.set(readRecord(network), readToStored(held), admit);
      } catch (e) {
        held.dirty = true;
        if (e instanceof WalletLocked || e instanceof NotAdmitted || isTrap(e)) throw e;
      }
    };
    if (gated) await this.chained(this.readWrites, network, write);
    else await this.onChain(this.readWrites, network, () => write());
  }

  /**
   * Reads `network`'s pool from where the last read ended (W4, W10): at most PAGES_A_SYNC pages, one after the other,
   * whatever they hold, and the scan of each, which costs the same for every envelope. The key's envelopes are kept
   * aside in memory (`out.found`) for the runner, in the order they came: nothing is opened, nothing read from a record
   * and nothing written between two page requests but the scan's mark, the same for every page (W9). Envelopes Try
   * again steps over are passed over unscanned, and after a scan trapped, that page's are scanned one at a time. Stops
   * where the pool says nothing follows, at a page that moves nothing (a relay that isn't §17's), at a page that doesn't
   * read (the pages before it are taken all the same), or after PAGES_A_SYNC pages: with `more` still set, the rest is
   * read at the next tick. Never stopped, skipped or cut short by what the pages held, or by how far the takes are
   * behind. Its end does nothing in proportion to the matches.
   */
  private async readPool(network: NetworkName, pin: PhrasePin, held: ReadHeld, out: ReadOut, most = PAGES_A_SYNC): Promise<void> {
    const from = held.cursor;
    const now = this.deps.now();
    const skip = new Set(held.skip.filter((s) => s.until > now).map((s) => s.envelope));
    const relay = this.deps.relay(network);
    const step: Step = { trapped: false };
    /**
     * The key's envelopes, in the order they came: each envelope scanned is written at `kept`, which its digit moves on
     * past a match, so what's kept takes no branch on which matched (W17, scan-timing#1). One served twice is kept
     * twice, and taken once.
     */
    const found = out.found;
    let kept = 0;
    let cursor = from;
    let alone = false;
    /** The scan's mark, before a scan: fixed, never refused for room; one the browser refuses, the scan goes on without. */
    const mark = (part: ScanMark) => this.setMark(network, "scan", part, pin, true).catch(() => undefined);
    try {
      for (let pages = 0; pages < most; pages++) {
        let page: RelayPage;
        try {
          // Asked again before each page: a switch turned off, or a lock, mid-catch-up stops it there.
          page = await relay.page(cursor, () => this.mayAsk(network));
        } catch (e) {
          await this.relayRefused(network, e);
          if (e instanceof RelayDown) break;
          throw e;
        }
        // Answering again, or again after a stop (W15, fix A: a page that reads ends it): said once the lane ends, which a
        // later failure can't keep back.
        const answering = this.offline.delete(network);
        if ((await this.endStop(network)) || answering) this.notify(network);
        this.prices.set(network, page.prices);
        // What the page held, before anything is stepped over or scanned: the page's alone (F2).
        if (page.envelopes.length) out.envelopes = true;
        const asked = cursor;
        const envelopes = skip.size ? page.envelopes.filter((e) => !skip.has(envelopeHash(e))) : page.envelopes;
        if (envelopes.length && this.scansAlone(network, asked, page.cursor)) {
          // After a scan trapped here: each envelope alone, under a mark naming it, so a trap names the one (W9).
          alone = true;
          for (const envelope of envelopes) {
            out.marked = true;
            await mark({ envelope: envelopeHash(envelope) });
            const bits = await this.scan(step, pin, [envelope]);
            found[kept] = envelope;
            kept += bits.charCodeAt(0) - 48;
            await this.wait();
          }
        } else if (envelopes.length) {
          // The page's mark, before its scan: the same for every page that holds envelopes, whoever they are for.
          out.marked = true;
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
        out.cursor = cursor;
        // A gap is envelopes lost after a cursor of the wallet's own (§17.5): a read that began with none had nothing of
        // the wallet's to lose (relay-server#7).
        if (page.gap && from !== undefined) out.gap = true;
        // A page that says more follows but moved nothing is a relay that isn't §17's: the read stops there.
        if (!page.more || page.cursor === asked) break;
      }
    } catch (e) {
      // A read that threw writes nothing at its lane's end: the next one asks the same pages again.
      out.failed = true;
      if (step.trapped) {
        out.trapped = true;
        await this.noteTrap(network, "scan");
      }
      throw e;
    } finally {
      // What followed the last match was written over, or was none: gone. A reference, never a copy.
      found.length = kept;
      if (!step.trapped) {
        // The one-at-a-time scan Try again asked for is done once a read has made it, or has gone past that page.
        const span = this.oneByOne.get(network);
        if (span && (alone || pastSpan(cursor, span))) this.oneByOne.delete(network);
      }
    }
  }

  /**
   * What a relay that didn't give a page means (W5, W15, W16): its off switch stops the network until the relay answers
   * (a lock ends it too, fix A); any other answer of its own ends such a stop; its day's reading holds this pool's pages
   * as long as it says; the edge's busy answer, a second, says nothing more; any other is a relay that didn't answer,
   * which the screens say. One the wallet chose not to ask is none of these.
   */
  private async relayRefused(network: NetworkName, e: unknown): Promise<void> {
    if (!(e instanceof RelayDown) || e instanceof RelayNotAsked) return;
    if (e instanceof RelayStopped) {
      await this.setStop(network);
      return;
    }
    // An answer, even a refusal: the relay answers again (fix A). A failed fetch, a time-out or a proxy's 5xx is none.
    if (relayAnswered(e) && (await this.endStop(network))) this.notify(network);
    if (e instanceof RelayBusy) return;
    if (e instanceof RelayDayRead) {
      await this.hold(SESSION_READ_AFTER, network, this.deps.now() + e.retryAfterMs);
      // The overview says the day's hold (W16): open pages are told, once the gate opens (round 4's review).
      this.notify(network);
      return;
    }
    if (!this.offline.has(network)) {
      this.offline.add(network);
      this.notify(network);
    }
  }

  /**
   * Which of `batch`'s envelopes are the key's (`messagingScan`), under `pin`, a trap in it `step`'s: one digit an
   * envelope, in order, `1` for the key's, as long as the batch whatever matched (W17, scan-timing#1). Any other answer
   * is another build's module's (one before call 16 gave the matches' indexes, as JSON): nothing of it is kept, and the
   * read stops there. A lane's: in the wallet's queue at once.
   */
  private scan(step: Step, pin: PhrasePin, batch: string[]): Promise<string> {
    return this.laneKey((key, keys) => {
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

  /**
   * Posts every envelope waiting on `network`, one at a time per network: a lane of its own (round 5), or part of a
   * sync's. Asked during one, it runs once more after it, in the same lane.
   */
  post(network: NetworkName): Promise<void> {
    const now = this.posting.get(network);
    if (now) {
      now.again = true;
      return now.running;
    }
    this.laneStart(network);
    const state = { running: Promise.resolve(), again: false };
    state.running = (async () => {
      try {
        do {
          state.again = false;
          await this.postNow(network);
        } while (state.again);
      } finally {
        this.posting.delete(network);
        this.laneEnd(network);
      }
    })();
    this.posting.set(network, state);
    return state.running;
  }

  /**
   * One posting run, in a lane (round 5): what the outbox record lists, and what a press noted in memory where its
   * append failed (f4), in order; each answer kept in memory, and the outbox record shrunk once at the run's end by what
   * was posted or refused, a write that never grows it. Between two posts nothing is read or written: marking each
   * conversation's entry, and the inbox's counts, is the runner's, after the lane. What the runs keep between them (the
   * waits the relay asked for, the strikes, where the next run starts) is read from the session's copy at the run's
   * start, where this worker holds none of this unlock, and written back at its end (`postRunsOf`, the freeze's fix D).
   */
  private async postNow(network: NetworkName): Promise<void> {
    if (!(await this.isOn(network))) return;
    // Nothing is posted, nor solved for, while the relay is stopped (W15, fix A).
    if (await this.stopOf(network)) return;
    const runs = await this.postRunsOf(network);
    if ((this.postAfter.get(network) ?? 0) > this.mono()) return;
    // Bound to the phrase now: what it posted is marked, and its outbox written, only under this one (worker-state#8).
    const pin = phrasePin();
    let waiting: Waiting[];
    try {
      await this.laneKey((_key, keys) => pin(keys));
      waiting = await this.outboxNow(network);
    } catch (e) {
      if (e instanceof WalletLocked) return;
      throw e;
    }
    if (!waiting.length) return;
    const relay = this.deps.relay(network);
    const pool = NETWORKS[network].relay.pool;
    // A run after one an envelope ended starts after that envelope, by its stamp digest (W15; the freeze's fixes C and
    // D): one envelope the server can't take, or doesn't answer, never holds the rest.
    const listed = waiting.map((w) => ({ ...w, digest: this.relayDigest(pool, w.envelope) }));
    const at = runs.from === undefined ? -1 : listed.findIndex((w) => w.digest === runs.from);
    const order = at < 0 ? listed : [...listed.slice(at + 1), ...listed.slice(0, at + 1)];
    const done: Posted[] = [];
    try {
      for (const { cid, id, envelope, digest } of order) {
        // A size the relay asked to wait waits alone: the other sizes go on (§17.4 prices and refuses by size, W5).
        if (this.waitFor(network, envelope) > this.mono()) continue;
        const key = keyOf(network, cid);
        // Deleted meanwhile, or posted by this worker already: nothing of it is posted again.
        if (this.removed.has(key) || this.postedHere.has(`${key}:${id}`)) continue;
        let answer: Exclude<PostAnswer, { kind: "price" }> | "unknown" | "stopped" | undefined;
        try {
          answer = await this.postOne(relay, network, envelope, digest, pin, (bits) => {
            this.work.set(key, { entry: id, bits });
            this.notify(network);
          });
        } finally {
          this.work.delete(key);
        }
        // The relay's off switch, or a request not made (a lock, the switch turned off, a stop met while solving): the
        // run ends there, and nothing moves.
        if (answer === "stopped") return;
        if (answer === undefined) {
          // No answer (fix C): a request that failed or timed out, a body cut off or past its bound, a proxy's 5xx, a
          // run's fourth 402. Nothing is counted against it; the next run starts after it, and this one ends here.
          runs.from = digest;
          return;
        }
        // The device's time of the answer: what a fresh post's expiry and the clock's measure are of (W14).
        const answeredAt = this.deps.now();
        if (answer === "unknown") {
          // Not one of §17.2's answers (W15), or a 402 the work already met (fix F). This one alone waits: the next run
          // begins after it, and after three in a row it's set aside with its bytes, for the user to send again.
          const times = (runs.strikes.get(digest) ?? 0) + 1;
          runs.strikes.set(digest, times);
          runs.from = digest;
          if (times < UNKNOWN_ANSWERS) return;
          runs.strikes.delete(digest);
          answer = { kind: "refused", status: 0 };
        } else {
          runs.strikes.delete(digest);
        }
        if (answer.kind === "wait") {
          // On the monotonic clock: a device clock set back or forward meanwhile stretches nothing (W14).
          const until = this.mono() + answer.retryAfterMs;
          // The thread counts down to the next try.
          this.notify(network);
          if (answer.scope === "network") {
            this.postAfter.set(network, until);
            return;
          }
          this.sizesOf(network).set(envelope.length / 2, until);
          continue;
        }
        this.postedHere.add(`${key}:${id}`);
        done.push({
          cid,
          id,
          answer: answer.kind === "kept" ? { kind: "kept", fresh: answer.fresh, expires: answer.expires } : { kind: "refused" },
          at: answeredAt,
          pin,
        });
        this.notify(network);
      }
      runs.from = undefined;
    } finally {
      // What the runs keep between them, for a worker started later in this unlock (fix D): a fixed-shape write of the
      // relay's answers to the wallet's own posts, naming no conversation.
      await this.savePostRuns(network, runs);
      if (done.length) {
        this.dueOf(network).posted.push(...done);
        // The outbox record shrinks by what went, once, at the run's end: a write that never grows it.
        const gone = new Set(done.map((d) => `${d.cid}:${d.id}`));
        const noted = this.outboxNoted.get(network);
        if (noted) this.outboxNoted.set(network, noted.filter((w) => !gone.has(`${w.cid}:${w.id}`)));
        await this.shrinkOutbox(network, (w) => gone.has(`${w.cid}:${w.id}`), pin).catch((e: unknown) => {
          if (isTrap(e)) throw e;
        });
      }
    }
  }

  /**
   * What `network`'s posting runs keep between them (the freeze's fix D): as held for this unlock, or, where this worker
   * holds none of it (a worker Chrome started since, or a new unlock), the session's copy, which a lock clears. Its
   * waits are kept on the device's clock there, each within POST_WAIT_MAX_MS (further off: a clock set back since, and
   * it holds no more), and join memory's monotonic ones, the later of each.
   */
  private async postRunsOf(network: NetworkName): Promise<PostRuns> {
    const at = await this.unlockStamp();
    const held = this.postRuns.get(network);
    if (held && held.at === at) return held;
    const kept = (await this.deps.session?.get<Partial<Record<NetworkName, StoredPostRuns>>>(SESSION_POSTS).catch(() => undefined))?.[network];
    const strikes = new Map<string, number>();
    for (const [digest, n] of Object.entries(kept?.strikes ?? {})) if (/^[0-9a-f]{64}$/.test(digest) && countOf(n) > 0) strikes.set(digest, countOf(n));
    const runs: PostRuns = { at, strikes, ...(typeof kept?.from === "string" && /^[0-9a-f]{64}$/.test(kept.from) ? { from: kept.from } : {}) };
    const now = this.deps.now();
    const mono = this.mono();
    /** A wait the copy holds, on the monotonic clock: none past, or further off than the longest the relay asks. */
    const restored = (until: unknown) => {
      const left = typeof until === "number" ? until - now : 0;
      return left > 0 && left <= POST_WAIT_MAX_MS ? mono + left : undefined;
    };
    const after = restored(kept?.after);
    if (after !== undefined && after > (this.postAfter.get(network) ?? 0)) this.postAfter.set(network, after);
    for (const [size, until] of Object.entries(kept?.sizes ?? {})) {
      const wait = restored(until);
      const sizes = this.sizesOf(network);
      if (wait !== undefined && wait > (sizes.get(Number(size)) ?? 0)) sizes.set(Number(size), wait);
    }
    this.postRuns.set(network, runs);
    return runs;
  }

  /**
   * Writes what `network`'s runs keep to the session's copy (fix D), the other network's left as it is: the strikes and
   * where the next run starts, by stamp digest, and the waits still to run, on the device's clock. A read of the copy
   * that fails writes nothing; a write that fails is let go, memory keeping it all.
   */
  private async savePostRuns(network: NetworkName, runs: PostRuns): Promise<void> {
    const session = this.deps.session;
    if (!session) return;
    // Only into the unlock the runs were kept under: a run that outlived it (a lock, the wallet removed and another
    // restored) leaves the session's copy, the next unlock's by then, as it is.
    if ((await this.unlockStamp()) !== runs.at) return;
    let kept: Partial<Record<NetworkName, StoredPostRuns>> | undefined;
    try {
      kept = await session.get<Partial<Record<NetworkName, StoredPostRuns>>>(SESSION_POSTS);
    } catch {
      return;
    }
    const now = this.deps.now();
    const mono = this.mono();
    const after = this.postAfter.get(network) ?? 0;
    const sizes = [...(this.sizeAfter.get(network) ?? new Map<number, number>())].filter(([, until]) => until > mono);
    const mine: StoredPostRuns = {
      ...(runs.from !== undefined ? { from: runs.from } : {}),
      ...(runs.strikes.size ? { strikes: Object.fromEntries(runs.strikes) } : {}),
      ...(after > mono ? { after: now + (after - mono) } : {}),
      ...(sizes.length ? { sizes: Object.fromEntries(sizes.map(([size, until]) => [String(size), now + (until - mono)])) } : {}),
    };
    const next = { ...kept };
    if (Object.keys(mine).length) next[network] = mine;
    else delete next[network];
    if (JSON.stringify(next) === JSON.stringify(kept ?? {})) return;
    await session.set(SESSION_POSTS, next).catch(() => undefined);
  }

  /** A post's stamp digest (`messagingRelayDigest`): what its solved work and its answers are kept by. */
  private relayDigest(pool: string, envelope: string): string {
    return this.wasmCall(() => this.deps.wasm.messagingRelayDigest(pool, envelope));
  }

  /**
   * Posts one envelope, `digest` its stamp's: solved at the price the last page named for its size (the pool's base
   * before any page), again at the price a 402 names, for the same bytes. A price past the ceiling is waited for, never
   * worked for (worker-net#4): the bindings' `priceCeilingBits` (W17), a page's for a minute, a 402's as long as it
   * says. Undefined when the relay didn't answer (fix C: a proxy's 5xx too); "unknown" for an answer this version
   * doesn't know (W15), or a 402 whose price the work already meets (fix F); "stopped" for the relay's off switch, which
   * stops the network (fix A), or for a request not made. Any other answer of the relay's own ends a stop.
   */
  private async postOne(
    relay: RelayClient,
    network: NetworkName,
    envelope: string,
    digest: string,
    /** The run's phrase (`postNow`): the post goes only while that phrase is the one unlocked (`mayAsk`). */
    pin: PhrasePin,
    /** Told the price before its work is solved. */
    onSolve?: (bits: number) => void,
  ): Promise<Exclude<PostAnswer, { kind: "price" }> | "unknown" | "stopped" | undefined> {
    const size = envelope.length / 2;
    const index = this.constantsOf().envelopeSizes.indexOf(size);
    const ceiling = this.constantsOf().priceCeilingBits;
    let bits = this.prices.get(network)?.[index] ?? RELAY_BASE_BITS[network];
    for (let tries = 0; tries < 4; tries++) {
      // Past the ceiling no pool of §17.4 prices a post: that size waits for a page a minute on to say again.
      if (bits > ceiling) return { kind: "wait", scope: "size", retryAfterMs: CEILING_WAIT_MS };
      // 0: the relay would refuse this address's post now (§17.5). Posted with no work, it says for how long (a 429's
      // retry-after, counted before any work is checked), or names its price if that's passed meanwhile.
      let nonce: number;
      try {
        nonce = bits === 0 ? 0 : await this.workFor(digest, bits, network, () => this.mayAsk(network, pin), onSolve);
      } catch (e) {
        // The relay stopped while it was solved (fix A): given up, the message still waiting.
        if (e instanceof StopMet) return "stopped";
        throw e;
      }
      // What the work shows: at least what it was solved at, more where an earlier solve for it found more.
      const shows = bits === 0 ? 0 : Math.max(bits, this.solved.get(digest)?.bits ?? 0);
      const body = this.wasmCall(() => this.deps.wasm.messagingPostBody(JSON.stringify({ nonce, envelope })));
      let answer: PostAnswer;
      try {
        // Asked again right before it goes: a switch turned off, a lock or the relay's stop while it was solved stops
        // it, and so does another phrase unlocked meanwhile (the wallet removed, another restored, its switch turned on).
        answer = await relay.post(body, async () => (await this.mayAsk(network, pin)) && !(await this.stopOf(network)));
      } catch (e) {
        if (e instanceof RelayStopped) {
          await this.setStop(network);
          return "stopped";
        }
        if (e instanceof RelayNotAsked) return "stopped";
        // An answer, though not one §17.2 gives: the relay answers again (fix A).
        if (relayAnswered(e) && (await this.endStop(network))) this.notify(network);
        if (e instanceof RelayUnknown) return "unknown";
        if (e instanceof RelayDown) return undefined;
        throw e;
      }
      if (await this.endStop(network)) this.notify(network);
      if (answer.kind === "kept") this.solved.delete(digest);
      if (answer.kind !== "price") return answer;
      // Past the ceiling §17.4's relay refuses rather than prices: one that names more is waited for, as long as its
      // 402 says (a minute when it says nothing), never worked for.
      if (answer.bits > ceiling) return { kind: "wait", scope: "size", retryAfterMs: answer.retryAfterMs ?? CEILING_WAIT_MS };
      // A price the post's work already meets (fix F): the relay doesn't price as §17.4 does. A strike, and the next run
      // starts past it, never the same bytes again in this run.
      if (answer.bits <= shows) return "unknown";
      bits = answer.bits;
    }
    return undefined;
  }

  /**
   * A nonce with at least `bits` of work over a post's `digest`: the one found before for it when that had as many,
   * else searched for from where that one was found. Every nonce before it failed a lower price, so it fails this one.
   */
  private async workFor(
    digest: string,
    bits: number,
    network: NetworkName,
    /** Whether the post may still go (`mayAsk`): asked while its work is solved (`solve`). */
    wanted: () => Promise<boolean>,
    onSolve?: (bits: number) => void,
  ): Promise<number> {
    const kept = this.solved.get(digest);
    if (kept && kept.bits >= bits) return kept.nonce;
    onSolve?.(bits);
    const nonce = await this.solve(digest, bits, kept?.nonce ?? 0, network, wanted);
    this.solved.set(digest, { bits, nonce });
    return nonce;
  }

  /**
   * A nonce from `start` on whose work over `digest` is at least `bits`, found in slices with a turn of the event loop
   * between. For `network`'s relay: memory's copy of its stop is looked at between slices, and one met gives up
   * (StopMet, fix A).
   *
   * The worker is kept alive while this runs, and only then (1.10.0's second review). Chrome stops a worker 30 seconds
   * after its last event or call to an extension API, and a solve makes neither: a post's work, 26 bits at most, runs
   * about 30 seconds on average, a first message's 24 bits about 7, and one stopped partway starts again from nothing.
   * So between slices, at most every 10 seconds, one call that does nothing else is made (`keepAlive`): the pattern
   * Chrome's guide gives for a bounded task ("Keep a service worker alive until a long-running operation is
   * finished"). It's no timer of its own: this loop makes the call, so every way out of the loop ends it, a nonce
   * found, the crate's refusal, a throw, the relay's stop. And `wanted` is asked right before each call: a lock, the
   * wallet removed, or for a post its switch turned off or another phrase unlocked, gives the work up there (StopMet),
   * within 10 seconds and a slice. Nothing keeps the worker alive between solves: the continuous keep-alive is
   * allowed on managed devices only, and not used (sw.ts).
   */
  private async solve(digest: string, bits: number, start = 0, network?: NetworkName, wanted?: () => Promise<boolean>): Promise<number> {
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
      if (network && this.stoppedNow(network)) throw new StopMet();
      if (this.mono() - lastKept > 10_000) {
        lastKept = this.mono();
        // No longer wanted: given up, and no call made for it. A look that fails says nothing, and the work goes on.
        if (wanted && !(await wanted().catch(() => true))) throw new StopMet();
        await this.deps.keepAlive?.().catch(() => undefined);
      }
    }
  }

  /**
   * Whether a wallet is unlocked now, by the stamp an unlock leaves in session storage and a lock clears: no turn of
   * the wallet's queue, so a first message's solve, outside a lane, asks it between slices (`solve`'s `wanted`). True
   * where it can't be read.
   */
  private async unlockedNow(): Promise<boolean> {
    const session = this.deps.session;
    if (!session) return true;
    return typeof (await session.get<unknown>(SESSION_UNLOCKED_AT)) === "number";
  }

  /**
   * What's waiting to be posted, for a posting run: the outbox record, one read in the lane (the user's own envelopes,
   * whose size nothing a match sets), and what a press noted in memory where its append failed, each once, in order.
   * Of what's noted, only the unlocked phrase's (1.10.0's second review): another's is dropped here, unposted, so a
   * wallet removed and another restored while the worker lives posts nothing of the first's. Where nothing is noted,
   * which is nearly always, the keys aren't asked for.
   */
  private async outboxNow(network: NetworkName): Promise<Waiting[]> {
    let stored: StoredOutbox | undefined;
    try {
      stored = await this.rawGot<StoredOutbox>(outboxRecord(network));
    } catch (e) {
      // One that won't open: what's in it is still in the conversations' records, and the sweep writes it again.
      if (!(e instanceof UnreadableRecordError)) throw e;
    }
    const waiting = outboxFromStored(stored);
    if (!this.outboxNoted.get(network)?.length) return waiting;
    const phrase = await this.laneKey((_key, keys) => phrasePin()(keys));
    const mine = (this.outboxNoted.get(network) ?? []).filter((w) => w.phrase === phrase);
    if (mine.length) this.outboxNoted.set(network, mine);
    else this.outboxNoted.delete(network);
    const have = new Set(waiting.map((w) => `${w.cid}:${w.id}`));
    for (const { cid, id, envelope } of mine) if (!have.has(`${cid}:${id}`)) waiting.push({ cid, id, envelope });
    return waiting;
  }

  /**
   * Adds `adding` to `network`'s outbox record, in its chain: a press's (or a take's) envelopes, after their record's
   * write and before the inbox's. A write of the user's own, looked at against the area's reserve as any content is.
   */
  private async appendOutbox(network: NetworkName, adding: Waiting[]): Promise<void> {
    if (!adding.length) return;
    const merged = (kept: Waiting[]) => {
      const have = new Set(kept.map((w) => `${w.cid}:${w.id}`));
      return [...kept, ...adding.filter((w) => !have.has(`${w.cid}:${w.id}`))];
    };
    // The area's reserve, looked at before the chain, since nothing in a chain a lane joins waits for the gate
    // (`chained`): appends come one at a time (a press's, or a stamp's turn), and a lane only shrinks the record, so what
    // the write grows the area by in the chain is no more than looked at here.
    const before = await this.outboxStored(network, (name) => this.got<StoredOutbox>(name));
    const growth = sizeOf(outboxToStored(merged(before.waiting))) - before.bytes;
    if (growth > 0 && !(await this.reserveHolds(growth))) throw refusedFor("content");
    await this.chained(this.outboxWrites, network, async (admit) => {
      const kept = await this.outboxStored(network, (name) => this.rawGot<StoredOutbox>(name, admit));
      const stored = outboxToStored(merged(kept.waiting));
      await this.rawPut(network, outboxRecord(network), stored, "content", sizeOf(stored) - kept.bytes, undefined, true, admit);
    });
  }

  /**
   * Drops what `gone` picks from `network`'s outbox record, in its chain: a write that only shrinks it, a lane's; under
   * `pin` where given, nothing at all once another phrase's keys are there.
   */
  private async shrinkOutbox(network: NetworkName, gone: (w: Waiting) => boolean, pin?: PhrasePin): Promise<void> {
    await this.onChain(this.outboxWrites, network, () => this.shrunk(network, gone, pin));
  }

  /** `shrinkOutbox`'s write, in the outbox's chain: at once, or, `admit` given, each call admitted (`chained`). */
  private async shrunk(network: NetworkName, gone: (w: Waiting) => boolean, pin?: PhrasePin, admit?: Admit): Promise<void> {
    if (pin) await this.laneKey((_key, keys) => pin(keys), admit);
    const kept = await this.outboxStored(network, (name) => this.rawGot<StoredOutbox>(name, admit));
    const next = kept.waiting.filter((w) => !gone(w));
    if (next.length === kept.waiting.length) return;
    if (!next.length) {
      // A removal needs no key: outside a lane, the look a seal makes in its own turn is made here (`admitted`).
      if (admit && !admit()) throw new NotAdmitted();
      await this.deps.store.remove(outboxRecord(network));
      return;
    }
    await this.rawPut(network, outboxRecord(network), outboxToStored(next), "fixed", 0, undefined, false, admit);
  }

  /**
   * Drops what `gone` picks from the outbox record and from what presses noted: a deletion's first write, which holds
   * across a restart. Returns what it dropped, from either, each once. A write of it that fails throws, with what was
   * noted back in its place: nothing is half-dropped (1.10.0's second review).
   */
  private async dropFromOutbox(network: NetworkName, gone: (w: Waiting) => boolean): Promise<Waiting[]> {
    const noted = this.outboxNoted.get(network) ?? [];
    const fromNoted = noted.filter(gone);
    if (fromNoted.length) this.outboxNoted.set(network, noted.filter((w) => !gone(w)));
    try {
      const fromRecord = await this.chained(this.outboxWrites, network, async (admit) => {
        const kept = await this.outboxStored(network, (name) => this.rawGot<StoredOutbox>(name, admit));
        await this.shrunk(network, gone, undefined, admit);
        return kept.waiting.filter(gone);
      });
      const have = new Set(fromRecord.map((w) => `${w.cid}:${w.id}`));
      return [...fromRecord, ...fromNoted.filter((w) => !have.has(`${w.cid}:${w.id}`))];
    } catch (e) {
      if (fromNoted.length) this.outboxNoted.set(network, [...(this.outboxNoted.get(network) ?? []), ...fromNoted]);
      throw e;
    }
  }

  /**
   * Notes `waiting` in memory beside what presses couldn't append to the outbox record (`outboxNoted`), each once, under
   * the phrase unlocked now (1.10.0's second review): a posting run posts them from there, and only under that phrase
   * (`outboxNow`). Locked, or the keys not to be had: nothing is noted, and the next first window writes the outbox
   * again from the records (`repairOutbox`), so nothing is lost.
   */
  private async noteWaiting(network: NetworkName, waiting: readonly Waiting[]): Promise<void> {
    if (!waiting.length) return;
    const phrase = await this.withKey((_key, keys) => phrasePin()(keys)).catch(() => undefined);
    if (phrase === undefined) return;
    const noted = this.outboxNoted.get(network) ?? [];
    const have = new Set(noted.map((w) => `${w.cid}:${w.id}`));
    const fresh = waiting.filter((w) => !have.has(`${w.cid}:${w.id}`));
    const tagged = fresh.map(({ cid, id, envelope }) => ({ cid, id, envelope, phrase }));
    if (tagged.length) this.outboxNoted.set(network, [...noted, ...tagged]);
  }

  /**
   * The outbox record as stored, and its size: an empty one where there's none or it won't open. `read`: how it's read,
   * a lane's at once by default.
   */
  private async outboxStored(
    network: NetworkName,
    read: (name: RecordName) => Promise<StoredOutbox | undefined> = (name) => this.rawGot<StoredOutbox>(name),
  ): Promise<{ waiting: Waiting[]; bytes: number }> {
    try {
      const stored = await read(outboxRecord(network));
      return { waiting: outboxFromStored(stored), bytes: stored ? sizeOf(stored) : 0 };
    } catch (e) {
      if (!(e instanceof UnreadableRecordError)) throw e;
      return { waiting: [], bytes: await this.storedSize(outboxRecord(network)) };
    }
  }

  // -------------------------------------------------------------------------
  // The gate: when anything but a lane may use the wallet's queue (round 5)
  // -------------------------------------------------------------------------

  /** Whether any network's lane runs, or a run of `syncAll` on its way to its lanes. */
  private laneRunning(): boolean {
    if (this.runs > 0) return true;
    for (const n of this.lanes.values()) if (n > 0) return true;
    return false;
  }

  private laneStart(network: NetworkName): void {
    this.deps.observe?.("lane-start", network);
    this.lanes.set(network, (this.lanes.get(network) ?? 0) + 1);
    const told = this.laneStarts.splice(0);
    for (const r of told) r();
  }

  /**
   * A run of `syncAll` begins (1.10.0's second review, F3): marked before its first await, as a lane is before its own,
   * so nothing gated is admitted while it reads the settings and the wallet's state on its way to its lanes, however
   * long another feature's task holds the wallet's queue meanwhile. `alarm`: the alarm's own run, which alone serves
   * the alarm's tick (`live`).
   */
  private runStart(alarm: boolean): void {
    this.deps.observe?.("run-start");
    this.runs++;
    if (alarm) this.alarmRunAt = this.mono();
    const told = this.laneStarts.splice(0);
    for (const r of told) r();
  }

  /**
   * The run ended, whatever it found to read (nothing, where every switch is off, the wallet is locked or its network
   * stopped): as a lane's end, so no mark of it is left to hold the gate shut.
   */
  private runEnd(): void {
    this.runs--;
    this.deps.observe?.("run-end");
    if (this.laneRunning()) return;
    const told = this.laneEnds.splice(0);
    for (const r of told) r();
    this.wake();
    this.flushSoon();
  }

  /** A lane ended: once none runs, what waited for the gate looks again, the runner runs, and held notices go. */
  private laneEnd(network: NetworkName): void {
    const left = (this.lanes.get(network) ?? 1) - 1;
    if (left > 0) this.lanes.set(network, left);
    else this.lanes.delete(network);
    this.deps.observe?.("lane-end", network);
    if (this.laneRunning()) return;
    const told = this.laneEnds.splice(0);
    for (const r of told) r();
    this.wake();
    this.flushSoon();
  }

  /** Resolves once no lane runs. */
  private lanesEnded(): Promise<void> {
    if (!this.laneRunning()) return Promise.resolve();
    return new Promise((r) => this.laneEnds.push(r));
  }

  private margin(): number {
    return this.deps.takeMarginMs ?? TAKE_MARGIN_MS;
  }

  /**
   * Notes a page's sync (`sync`'s `from`, round 5): every page shown polls on one grid, the worker's, so the margins
   * before its ticks don't multiply with pages, and pages polling at the same tick join one lane (`sync`). The first page
   * heard while none is starts it, at its sync; it holds while any page is heard from, and the next page starts it again
   * once none is. A page's poll at one of its ticks (`grid`: within GRID_EARLY_MS before it and TICK_GRACE_MS after)
   * serves that tick; one as the page is shown or comes into view (`view`), or a poll off every tick, serves none.
   */
  private notePage(from?: { page?: unknown; kind?: unknown }): void {
    const page = from?.page;
    if (typeof page !== "string" || !page || page.length > 64) return;
    const now = this.mono();
    this.livePages(now);
    const grid = this.grid;
    if (!grid) {
      this.grid = { at: now, served: 0 };
    } else if (from!.kind === "grid") {
      const k = Math.round((now - grid.at) / MESSAGING_SYNC_EVERY_MS);
      const at = grid.at + k * MESSAGING_SYNC_EVERY_MS;
      if (k > grid.served && now >= at - GRID_EARLY_MS && now <= at + TICK_GRACE_MS) grid.served = k;
    }
    this.pages.set(page, now);
  }

  /** Forgets each page not heard from for two periods and TICK_GRACE_MS (gone, or hidden), and the grid with the last. */
  private livePages(now: number): void {
    for (const [page, heard] of this.pages) if (now - heard > 2 * MESSAGING_SYNC_EVERY_MS + TICK_GRACE_MS) this.pages.delete(page);
    if (!this.pages.size) this.grid = undefined;
  }

  /**
   * How long until the pages' grid's next tick (ms), for the page whose sync just ended (`messaging-sync`'s answer): from
   * the grid and the clock alone, never from anything the runner holds, takes or owes, nor from whether a lane runs.
   * MESSAGING_SYNC_EVERY_MS where no page is heard from.
   */
  pollIn(): number {
    const now = this.mono();
    this.livePages(now);
    const grid = this.grid;
    if (!grid) return MESSAGING_SYNC_EVERY_MS;
    const k = Math.floor((now - grid.at) / MESSAGING_SYNC_EVERY_MS) + 1;
    return grid.at + k * MESSAGING_SYNC_EVERY_MS - now;
  }

  /**
   * The ticks the worker expects next (monotonic ms): the pages' grid's next poll, while a page is heard from, and both
   * alarms' next minute. Messages' alarm's tick is served by the alarm's own run alone (`live`), and the grid's by a
   * page's poll at it (`notePage`); one TICK_GRACE_MS past isn't waited for.
   */
  private async expected(): Promise<Tick[]> {
    const out = this.pageTicks();
    out.push(...(await this.alarmsNow()));
    return out;
  }

  /** The pages' grid's next tick, while a page is heard from: the soonest no page's poll served, nor TICK_GRACE_MS past. */
  private pageTicks(): Tick[] {
    const now = this.mono();
    this.livePages(now);
    const grid = this.grid;
    if (!grid) return [];
    const k = Math.max(grid.served + 1, Math.floor((now - TICK_GRACE_MS - grid.at) / MESSAGING_SYNC_EVERY_MS) + 1);
    return [{ at: grid.at + k * MESSAGING_SYNC_EVERY_MS, lane: true }];
  }

  /**
   * Whether a tick of the alarms is still to be waited for: not served, nor TICK_GRACE_MS past. A tick is served only by
   * the run made for it (THE RULE; 1.10.0's second review, F1): Messages' alarm's by the alarm's own run (`syncAll`
   * told so, `alarmRunAt`), begun no earlier than GRID_EARLY_MS before it, as the pages' grid's is by a grid poll at it
   * (`notePage`). A lane of any other kind (a page's own sync as it's shown, a press's posts, another tick's read) that
   * starts inside the margin before a tick serves nothing: the gate, the admit check and the held notices stay shut
   * across that tick until its own run has come and ended, or it is TICK_GRACE_MS past with no run. The sessions'
   * alarm's tick is no run of Messages' (`lane` false): only its grace ends it.
   */
  private live(t: Tick, now: number): boolean {
    return t.at + TICK_GRACE_MS > now && !(t.lane && this.alarmRunAt >= t.at - GRID_EARLY_MS);
  }

  /** The alarms' next ticks, as Chrome schedules them: read again once one has passed or been served, and now and then. */
  private async alarmsNow(): Promise<Tick[]> {
    const read = this.deps.ticks;
    if (!read) return [];
    const now = this.mono();
    const cached = this.alarmTicks;
    // An empty list too goes stale after a second, as one holding a tick that's passed: `every` holds on it, and an
    // alarm Chrome starts meanwhile would go unseen for 30 s (round 5's lanes-e).
    const stale =
      !cached || now - cached.read >= 30_000 || (now - cached.read >= 1000 && (!cached.ticks.length || !cached.ticks.every((t) => this.live(t, now))));
    if (!stale) return cached.ticks.filter((t) => this.live(t, now));
    let ticks: Tick[] = [];
    try {
      const wall = this.deps.now();
      ticks = (await read()).map((t) => ({ at: now + (t.at - wall), lane: t.lane }));
    } catch {
      ticks = [];
    }
    // A tick read before that's still to be waited for stays: Chrome moves an alarm's schedule on as it fires, before
    // its run's requests, or its grace, are over.
    const kept = (cached?.ticks ?? []).filter((t) => this.live(t, now) && !ticks.some((f) => Math.abs(f.at - t.at) < 1000));
    ticks = [...kept, ...ticks];
    this.alarmTicks = { ticks, read: now };
    return ticks.filter((t) => this.live(t, this.mono()));
  }

  /** Whether a tick is near by what's known now, with no read: for a notice, which can't wait for one. */
  private tickNear(): boolean {
    const now = this.mono();
    const near = (t: Tick) => t.at - now <= this.margin();
    return this.pageTicks().some(near) || (this.alarmTicks?.ticks ?? []).some((t) => this.live(t, now) && near(t));
  }

  /**
   * Resolves once no lane runs and more than TAKE_MARGIN_MS remain before every tick the worker expects (O3): each
   * runner step waits for it before each of its calls into the wallet's queue, and so do the screens' reads, the
   * presses' storage work and the screens' held notices (O8). Within the margin of a tick it waits for that tick's lane
   * to come and end, or for the tick and TICK_GRACE_MS when none comes. Never awaited inside a lane.
   */
  private async gate(): Promise<void> {
    for (;;) {
      if (this.laneRunning()) {
        await this.lanesEnded();
        continue;
      }
      const ticks = await this.expected();
      if (this.laneRunning()) continue;
      const now = this.mono();
      const near = ticks.filter((t) => t.at - now <= this.margin());
      if (!near.length) {
        this.deps.observe?.("gate");
        return;
      }
      const until = Math.min(...near.map((t) => t.at)) + TICK_GRACE_MS;
      await this.sleepUntil(until);
    }
  }

  /** Until `until` (monotonic ms), or until a lane starts, whichever comes first. */
  private async sleepUntil(until: number): Promise<void> {
    let started = false;
    const starts = new Promise<void>((r) => this.laneStarts.push(r)).then(() => void (started = true));
    void starts;
    // At least one real wait: the gate never turns in microtasks alone.
    do {
      const left = Math.max(1, until - this.mono());
      await (this.deps.sleep ? this.deps.sleep(Math.min(left, 100)) : this.pause(Math.min(left, 100)));
    } while (!started && this.mono() < until);
  }

  /**
   * Tells open pages `network`'s messages changed: at once where no lane runs and no tick is near, otherwise held and
   * sent once the gate opens, once a network (round 5): a page's reloads never land in a lane or just before a tick.
   */
  private notify(network: NetworkName): void {
    if (!this.deps.changed) return;
    if (!this.laneRunning() && !this.tickNear() && !this.heldChanged.size) {
      this.deps.changed(network);
      return;
    }
    this.heldChanged.add(network);
    this.flushSoon();
  }

  private flushSoon(): void {
    if (this.flushing || !this.heldChanged.size) return;
    const run = (async () => {
      await this.gate();
      const held = [...this.heldChanged];
      this.heldChanged.clear();
      for (const n of held) this.deps.changed?.(n);
    })().finally(() => {
      this.flushing = undefined;
      if (this.heldChanged.size) this.flushSoon();
    });
    this.flushing = run;
    this.behind(run);
  }

  // -------------------------------------------------------------------------
  // The runner: everything that isn't a request or a press, between lanes
  // -------------------------------------------------------------------------

  /** What the runner owes `network` after its lanes. */
  private dueOf(network: NetworkName): { posted: Posted[]; batches: Batch[]; own?: PhrasePin } {
    let due = this.due.get(network);
    if (!due) this.due.set(network, (due = { posted: [], batches: [] }));
    return due;
  }

  /** Asks the runner for `network`'s rest of the sweep, or its expiry, or both. */
  private dueRest(network: NetworkName, what: { sweep?: boolean; expire?: boolean }): void {
    const rest = this.rest.get(network) ?? { sweep: false, expire: false };
    this.rest.set(network, { sweep: rest.sweep || !!what.sweep, expire: rest.expire || !!what.expire });
  }

  /** Starts the runner, or has it look again once it's through. */
  private wake(): void {
    if (this.runner) {
      this.runAgain = true;
      return;
    }
    const run = (async () => {
      do {
        this.runAgain = false;
        await this.runAll();
      } while (this.runAgain);
    })().finally(() => {
      this.runner = undefined;
    });
    this.runner = run;
    this.behind(run);
  }

  /**
   * The runner (round 5): one step at a time across both networks, between lanes. After every lane, its first phase
   * (`firstPhase`) before any take step; then each network's take, envelope by envelope; then the rest of the sweep,
   * expiry and tidy. A lock stops it, keeping what's in memory; the next lane starts it again. A trap's step locks the
   * wallet (`behind`).
   */
  private async runAll(): Promise<void> {
    let failed = 0;
    for (;;) {
      if ((await this.admitted((admit) => this.deps.wallet.state(admit), undefined, true)) !== "unlocked") return;
      try {
        if (await this.firstPhases()) continue;
        let took = false;
        for (const network of this.networks()) {
          if (await this.takeStep(network)) {
            took = true;
            break;
          }
        }
        if (took) continue;
        if (await this.restStep()) continue;
        return;
      } catch (e) {
        if (isTrap(e)) throw e;
        // A lock, or a record that won't open: what's in memory stays for the next lane's runner.
        if (e instanceof WalletLocked) return;
        // A read of storage that failed under a step (f2): the step again, after a pause out of the queue, a few times.
        if (e instanceof StorageFailed && failed++ < TAKE_RETRIES) {
          await this.pause(TAKE_RETRY_MS);
          continue;
        }
        throw e;
      } finally {
        await this.wait();
      }
    }
  }

  /**
   * Each network's first phase after its lanes, before any take step: the posts' bookkeeping, each post a step; at a
   * worker's or an unlock's first window, the take record read back, what a stop lost counted, and the sweep's outbox
   * and requests repairs; the first-contact stamps still to solve; then each read's envelopes saved in the take record,
   * a read a step. Whether one ran to its end.
   *
   * A network whose inbox won't open (W9) is held (1.10.0's second review): its first phase isn't run, and what its
   * lanes left (the posts to mark, the reads' envelopes, in memory) waits for the inbox to open, or for Messages to be
   * started again (`clear`). That drops the reads' envelopes with the read's cursor (`forget`), so the pool is read
   * again from its oldest; the posts to mark stay, and the next first phase marks nothing for them, their conversations
   * gone with the inbox (`markPosted`). It doesn't grow meanwhile: no lane reads that pool once the inbox is found
   * (`syncNow`), and a worker that stops leaves the envelopes counted (`owed`). A first phase that throws for such a
   * record didn't run: the runner goes on to the other network's phase, the takes and the tidy-up, and never round
   * again for it alone.
   */
  private async firstPhases(): Promise<boolean> {
    let ran = false;
    for (const network of this.networks()) {
      const due = this.due.get(network);
      if (!due || (!due.posted.length && !due.batches.length && !due.own)) continue;
      if (this.unopenable.has(network)) continue;
      try {
        await this.firstPhase(network, due);
        ran = true;
      } catch (e) {
        // An inbox found unopenable now: held from here, as above.
        if (!(e instanceof UnreadableRecordError)) throw e;
      }
    }
    return ran;
  }

  /** `network`'s first phase after its lanes (`firstPhases`). */
  private async firstPhase(network: NetworkName, due: { posted: Posted[]; batches: Batch[]; own?: PhrasePin }): Promise<void> {
    // Room, maybe: at each take `full` is let go and tried again, after every lane (W11, round 5).
    this.blocked.delete(network);
    this.full.delete(network);
    // A post's bookkeeping that found no room tries again after the next lane, as the take does.
    due.posted.unshift(...(this.postedLater.get(network) ?? []));
    this.postedLater.delete(network);
    const later: Posted[] = [];
    try {
      while (due.posted.length) {
        // Still due until it's marked or put off: a throw past here (an inbox that won't open, a lock) leaves it, and
        // the posts after it, to be marked once the phase runs again (1.10.0's second review).
        const done = due.posted[0]!;
        try {
          await this.markPosted(network, done);
        } catch (e) {
          // No room for its bookkeeping, or a read of storage that failed under it: marked after the next lane.
          if (!(e instanceof MessagingFull) && !(e instanceof StorageFailed)) throw e;
          later.push(done);
        }
        due.posted.shift();
      }
    } finally {
      // What was put off is kept whatever ended the loop.
      if (later.length) this.postedLater.set(network, later);
    }
    const pin = due.own ?? due.batches[0]?.pin;
    if (pin) {
      await this.firstWindow(network, pin);
      await this.resumeStamps(network);
    }
    await this.countDropped(network);
    while (due.batches.length) await this.saveBatch(network, due.batches.shift()!);
    if (due.own) {
      this.ownDue.set(network, due.own);
      delete due.own;
    }
    this.dueRest(network, { expire: true });
  }

  /**
   * One post's bookkeeping (a step): its conversation's entry marked posted, with when the relay drops it, or refused by
   * the server with its bytes kept (worker-net#8); the inbox's counts with it; the device's clock against the relay's
   * from a fresh answer (W14), into the read record. Never between two posts.
   */
  private async markPosted(network: NetworkName, done: Posted): Promise<void> {
    // Another phrase's keys there now (a wallet removed and another restored): nothing of the post is this wallet's.
    if (await this.anotherPhrase(done.pin)) return;
    const clock = await this.step(async () => {
      const now = await this.inbox(network);
      const listed = now.conversations[done.cid];
      const kept = listed && (await this.readable(network, listed));
      const entry = kept?.history.find((e) => e.id === done.id);
      if (!kept || !entry || entry.sent !== "pending") return undefined;
      let clock: ReadState["clock"];
      if (done.answer.kind === "kept") {
        entry.sent = "posted";
        delete entry.envelope;
        if (done.answer.fresh) {
          // Taken new: the relay drops it 36 hours from its now, said on this device's clock from the answer, and the
          // device's clock measured against the relay's (W14). Only said: never the time anything runs on.
          entry.postedAt = done.at;
          entry.expires = done.at + RELAY_HOLD_MS;
          clock = { at: done.at, off: done.at - (done.answer.expires - RELAY_HOLD_MS) };
        } else {
          // Already held: its first post's expiry, the relay's own, which says nothing of its clock now.
          entry.expires = done.answer.expires;
        }
      } else {
        // Refused by the server, or by something on the way (worker-net#8), or answered unknown three times in a row
        // (W15): its bytes are kept, so the user can send them again (`resend`). It isn't posted again by itself.
        entry.sent = "refused";
        entry.refusedBy = "server";
      }
      await this.commit(network, now, done.cid, kept, "bookkeeping");
      return clock;
    });
    if (clock) {
      const held = this.readRecords.get(network);
      if (held) {
        held.clock = clock;
        held.dirty = true;
        await this.writeRead(network, held, true);
      }
    }
    this.notify(network);
  }

  /**
   * A worker's or an unlock's first window on `network`, once, after its first lane: the take record read back, its
   * reads ahead of those in memory, each once by where it ended; what the read record owes beyond what memory holds,
   * lost with a worker or an unlock that came between, counted as dropped before it could be read (O5); the outbox
   * record built again from the conversations' records, leaving out what this worker posted; and the requests' list set
   * right from their record where a stop came between the two writes, or moved out of an old inbox (O6). Each a step.
   */
  private async firstWindow(network: NetworkName, pin: PhrasePin): Promise<void> {
    const at = await this.stampNow();
    const mark = `${network}:${at}`;
    if (this.windows.has(mark)) return;
    this.windows.add(mark);
    const epoch = this.epochOf(network);
    // 1. The take record's reads, ahead of memory's.
    const held = await this.step(() => this.takesOf(network, pin));
    const memory = this.batchesOf(network);
    const known = new Set(memory.flatMap((b) => (b.to !== undefined ? [b.to] : [])));
    const saved = held.batches
      .filter((b) => b.to === undefined || !known.has(b.to))
      .map((b): Batch => ({ ...(b.to !== undefined ? { to: b.to } : {}), envelopes: b.envelopes, pin, saved: true, owed: 0, epoch }));
    if (saved.length) {
      const all = [...saved, ...memory];
      // Past TAKES_BEHIND with what memory holds: the oldest go, counted by the runner (W10).
      while (all.filter((b) => !b.done).length > 1 + TAKES_BEHIND) {
        const taking = this.takingNow.get(network)?.batch;
        const i = all.findIndex((b) => !b.done && b !== taking);
        this.droppedOf(network).push(all.splice(i, 1)[0]!);
      }
      this.batches.set(network, all);
    }
    // 2. What a stop lost.
    const read = this.readRecords.get(network);
    if (read) {
      // What memory still holds of it: the reads waiting (the lane's own among them), and those dropped and not counted.
      const inMemory = [...this.batchesOf(network), ...(this.dropped.get(network) ?? [])].reduce((n, b) => n + b.owed, 0);
      const lost = Math.max(0, read.owed - inMemory);
      if (lost > 0) {
        await this.step(() =>
          this.onChain(this.takeWrites, network, async () => {
            const now = await this.takesOf(network, pin);
            await this.writeTakes(network, now, { ...now, unopened: now.unopened + lost });
          }),
        );
        read.owed -= lost;
        read.dirty = true;
        await this.writeRead(network, read, true);
      }
    }
    // 3. The outbox record, from the records, which stay the truth. 4. The requests' list, from their record. Where
    // there's no room for either, the next unlock's first window tries again (W11).
    const roomless = (e: unknown) => {
      if (!(e instanceof MessagingFull)) throw e;
    };
    await this.repairOutbox(network).catch(roomless);
    await this.step(() => this.repairRequests(network)).catch(roomless);
    this.dueRest(network, { sweep: true });
  }

  /** The outbox record built again from every conversation's record (a step each), leaving out what this worker posted. */
  private async repairOutbox(network: NetworkName): Promise<void> {
    const inbox = await this.step(() => this.inbox(network));
    const waiting: Waiting[] = [];
    for (const [cid, meta] of Object.entries(inbox.conversations)) {
      if (meta.unreadable || !meta.id) continue;
      const file = await this.step(() => this.readable(network, meta));
      for (const entry of file?.history ?? []) {
        if (entry.sent !== "pending" || !entry.envelope) continue;
        if (this.postedHere.has(`${keyOf(network, cid)}:${entry.id}`) || this.removed.has(keyOf(network, cid))) continue;
        waiting.push({ cid, id: entry.id, envelope: entry.envelope });
      }
    }
    // One step, so no press's append comes between the look and the write. The outbox's chain is the lanes' too, so the
    // write joins it once the gate opens, admitted (`chained`), and leaves out what a lane posted while it waited.
    await this.step(async () => {
      const kept = await this.outboxStored(network, (name) => this.got<StoredOutbox>(name));
      const same = kept.waiting.length === waiting.length && kept.waiting.every((w, i) => w.cid === waiting[i]!.cid && w.id === waiting[i]!.id);
      if (same) return;
      if (!waiting.length) {
        await this.onChain(this.outboxWrites, network, async () => {
          this.mine();
          await this.deps.store.remove(outboxRecord(network));
        });
        return;
      }
      const growth = sizeOf(outboxToStored(waiting)) - kept.bytes;
      // No room for it: the presses noted what they couldn't append, and the next window tries again.
      if (growth > 0 && !(await this.reserveHolds(growth))) return;
      await this.chained(this.outboxWrites, network, async (admit) => {
        const left = waiting.filter((w) => !this.postedHere.has(`${keyOf(network, w.cid)}:${w.id}`) && !this.removed.has(keyOf(network, w.cid)));
        if (!left.length) {
          if (!admit()) throw new NotAdmitted();
          await this.deps.store.remove(outboxRecord(network));
          return;
        }
        await this.rawPut(network, outboxRecord(network), outboxToStored(left), "fixed", 0, undefined, false, admit);
      }).catch((e: unknown) => {
        if (!(e instanceof MessagingFull)) throw e;
      });
    });
  }

  /**
   * The requests' list set right from their record (W7, round 5): where the inbox's note of the record's nonce isn't the
   * record's own, a stop came between the record's write and the inbox's, and the list is made again from the record;
   * and an inbox a development build wrote has its requests moved into their own record (O6). No unseal otherwise.
   * A request whose conversation the inbox holds is one an Accept left in the record (1.10.0's second review: a stop
   * after the inbox listed the conversation, before the record was written without the request): it's never listed
   * beside its conversation, and goes from the record here, with no key and no tombstone, since its conversation lives.
   * The inbox's mark of one (`requestLeft`) has the record read whatever the nonces say: a write of the record that came
   * before this (a press, a stranger's first message) noted its own nonce and settled nothing. The mark is unset here,
   * the record read, and nowhere else but in the accept that set it.
   */
  private async repairRequests(network: NetworkName): Promise<void> {
    const inbox = await this.inbox(network);
    if (inbox.legacy) {
      const { legacy } = inbox;
      delete inbox.legacy;
      await this.writeRequests(network, inbox, { ...(legacy.requests !== undefined ? { requests: legacy.requests } : {}), ...(legacy.aside?.length ? { aside: legacy.aside } : {}) });
      await this.writeInbox(network, inbox, { kind: "requests" });
      return;
    }
    const nonce = await this.deps.store.sealedAs(requestsRecord(network));
    if (nonce === inbox.requestsAs && !inbox.requestLeft) return;
    const held = await this.requestsOf(network, inbox);
    const shown: Record<string, RequestShown> = {};
    let rewritten = false;
    if (held.requests !== undefined) {
      let listed: RequestInfo[] | RecordRefused;
      try {
        listed = this.requestsInfo(held.requests);
      } catch (e) {
        if (e instanceof WalletLocked) throw e;
        listed = { refused: "invalid_state" };
      }
      if (isRefused(listed)) {
        this.asideRequests(inbox, held, listed);
        await this.writeRequests(network, inbox, held);
        await this.writeInbox(network, inbox, { kind: "requests" });
        return;
      }
      let record = held.requests;
      for (const info of listed) {
        if (inbox.conversations[info.cid] === undefined) {
          shown[info.cid] = inbox.requestsShown[info.cid]?.messages === info.arrivals.length ? inbox.requestsShown[info.cid]! : shownOf(info);
          continue;
        }
        // Accepted already: out of the record. The crate's answer names a tombstone too, which isn't kept.
        const asked = JSON.stringify({ cid: info.cid, requests: record });
        const without = this.tryOr(() => {
          const answer = this.parse<{ requests: string }>(this.wasmCall(() => this.deps.wasm.messagingDelete(asked)));
          return isRefused(answer) ? undefined : answer.requests;
        }, undefined);
        if (without !== undefined) record = without;
      }
      if (record !== held.requests) {
        // Written before the inbox, as ever; it notes its own nonce on the inbox.
        await this.writeRequests(network, inbox, { ...held, requests: record });
        rewritten = true;
      }
    }
    inbox.requestsShown = shown;
    for (const cid of Object.keys(inbox.requestsUnread)) if (!shown[cid]) delete inbox.requestsUnread[cid];
    delete inbox.requestLeft;
    if (!rewritten) {
      if (nonce === undefined) delete inbox.requestsAs;
      else inbox.requestsAs = nonce;
    }
    await this.writeInbox(network, inbox, { kind: "requests" });
  }

  /**
   * `network`'s inbox, the requests' record set right first where the inbox marks a request an Accept left in it
   * (`requestLeft`, 1.10.0's second review): before a take hands the crate that record beside the conversation's (the
   * crate refuses one ID in both, and the other side's continuation was passed over), and before a deletion (its
   * conversation gone, the request would be listed again). The mark is stored, so a worker stopped since the accept
   * changes nothing; unmarked, one read of the inbox and no more. Where there's no room for the repair's writes, or
   * storage fails under it, the inbox as it is, still marked: the next asks again. No request, no read of the chain.
   */
  private async settled(network: NetworkName): Promise<Inbox> {
    const inbox = await this.inbox(network);
    if (!inbox.requestLeft) return inbox;
    try {
      await this.repairRequests(network);
    } catch (e) {
      if (!(e instanceof MessagingFull) && !(e instanceof StorageFailed)) throw e;
    }
    return this.inbox(network);
  }

  /** Solves the first-contact stamp of every conversation still waiting for one, each in the background (a step). */
  private async resumeStamps(network: NetworkName): Promise<void> {
    const inbox = await this.step(() => this.inbox(network));
    // Nothing is solved while the relay is stopped (W15, fix A).
    if (await this.stopOf(network, true)) return;
    for (const [cid, meta] of Object.entries(inbox.conversations)) {
      if (meta.role === "initiator" && meta.outbox > 0) this.behind(this.stamp(network, cid));
    }
  }

  /**
   * The reads a lane's end dropped past TAKES_BEHIND (W10, f5), counted (a step): in one write of the take record, their
   * envelopes counted unopened and those saved gone from it; what the read record owed for the others goes, since the
   * take record counts them now.
   */
  private async countDropped(network: NetworkName): Promise<void> {
    const dropped = this.dropped.get(network);
    if (!dropped?.length) return;
    this.dropped.delete(network);
    const epoch = this.epochOf(network);
    const mine = dropped.filter((b) => b.epoch === epoch);
    if (!mine.length) return;
    let lowered = 0;
    const pin = mine[0]!.pin;
    if (await this.anotherPhrase(pin)) return;
    await this.step(() =>
      this.onChain(this.takeWrites, network, async () => {
        const held = await this.takesOf(network, pin);
        const unopened = mine.reduce((n, b) => n + new Set(b.envelopes).size, 0);
        const batches = held.batches.filter((s) => !mine.some((b) => b.saved && sameBatch(s, b)));
        await this.writeTakes(network, held, { ...held, batches, unopened: held.unopened + unopened });
        for (const b of mine) {
          lowered += b.owed;
          b.owed = 0;
        }
      }),
    ).catch((e: unknown) => {
      // Refused by the browser: they stay owed, and a stop counts them (O5).
      if (!(e instanceof MessagingFull)) throw e;
    });
    if (lowered) await this.lowerOwed(network, lowered);
  }

  /**
   * A lane's read saved in the take record (a step; finding 8, round 5): its envelopes each once, and none an earlier
   * read waiting holds, in one append, before any earlier read is taken. Past what's left of TAKE_ROOM_BYTES, or where
   * the browser refuses the write, it's kept in memory alone, its envelopes owed until it's taken: nothing about it
   * holds a request back, nor sets `full`. Saved, what the read record owes for it goes.
   */
  private async saveBatch(network: NetworkName, batch: Batch): Promise<void> {
    if (batch.epoch !== this.epochOf(network)) return;
    const waiting = this.batchesOf(network);
    const at = waiting.indexOf(batch);
    // Dropped past TAKES_BEHIND meanwhile: counted, never saved.
    if (at < 0) return;
    // Read under another phrase than the keys there now: nothing of it is this wallet's (worker-state#8).
    if (await this.anotherPhrase(batch.pin)) {
      this.dropBatch(network, batch);
      return;
    }
    const seen = new Set(waiting.slice(0, at).flatMap((b) => b.envelopes));
    const fresh = [...new Set(batch.envelopes)].filter((e) => !seen.has(e));
    batch.envelopes = fresh;
    if (!fresh.length) {
      this.dropBatch(network, batch);
      const owed = batch.owed;
      batch.owed = 0;
      await this.lowerOwed(network, owed);
      return;
    }
    let lowered = 0;
    await this.step(() =>
      this.onChain(this.takeWrites, network, async () => {
        if (batch.epoch !== this.epochOf(network)) return;
        const held = await this.takesOf(network, batch.pin);
        const appended: Takes = { ...held, batches: [...held.batches, { ...(batch.to !== undefined ? { to: batch.to } : {}), envelopes: fresh }] };
        // Within the room with both counts at their most digits (round 4's review, #3): the writes after this one only
        // drop reads or add to a count, so none pads the record past its room while this read is still in it.
        const most = { ...appended, unopened: Number.MAX_SAFE_INTEGER, noRoom: Number.MAX_SAFE_INTEGER, seen: Number.MAX_SAFE_INTEGER };
        if (takesJsonLength(most) > (this.deps.takeRoomBytes ?? TAKE_ROOM_BYTES)) return;
        try {
          await this.writeTakes(network, held, appended);
        } catch (e) {
          if (e instanceof WalletLocked || isTrap(e)) throw e;
          // Refused: only the browser refuses it, it holds nothing back, and it never sets `full`. Taken from memory.
          return;
        }
        batch.saved = true;
        lowered = batch.owed;
        batch.owed = 0;
      }),
    );
    if (lowered) await this.lowerOwed(network, lowered);
  }

  /** `n` fewer of the key's envelopes owed (saved, or taken): the read record written again by the runner. */
  private async lowerOwed(network: NetworkName, n: number): Promise<void> {
    const held = this.readRecords.get(network);
    if (!held || n <= 0) return;
    held.owed = Math.max(0, held.owed - n);
    held.dirty = true;
    await this.writeRead(network, held, true);
  }

  /** The reads' envelopes waiting in memory on `network`. */
  private batchesOf(network: NetworkName): Batch[] {
    return this.batches.get(network) ?? [];
  }

  /**
   * The next step of `network`'s take (round 5): which Seedelfs take first messages, before each read's envelopes and
   * after any lane (`noteOwn`); then one envelope; then the read's end. Each a step of its own. One stopped for room
   * waits for the next lane's first phase. Whether there was one.
   */
  private async takeStep(network: NetworkName): Promise<boolean> {
    if (this.blocked.has(network) || this.unopenable.has(network)) return false;
    // A step of it trapped: nothing of it is taken by itself again, only after Try again (W9).
    if (await this.isStopped(network)) return false;
    let at = this.takingNow.get(network);
    if (!at) {
      const batch = this.batchesOf(network)[0];
      const due = this.ownDue.get(network);
      if (!batch && !due) return false;
      if (!batch) {
        // A read with none of the key's envelopes: the Seedelfs looked at again all the same, whatever it found.
        this.ownDue.delete(network);
        await this.noteOwn(network, due!, this.epochOf(network));
        return true;
      }
      // At each take, `full` is let go and tried again: a write that doesn't fit sets it again (W11, round 5).
      this.full.delete(network);
      at = { batch, index: 0, noted: false, noRoom: 0, arrived: false, tries: 0, seen: new Set() };
      this.takingNow.set(network, at);
    }
    const { batch } = at;
    /** The take stopped for good: what's in memory goes, the take record keeps what's saved. */
    const stale = () => batch.epoch !== this.epochOf(network) || this.takingNow.get(network) !== at;
    if (stale()) {
      this.dropBatch(network, batch);
      this.takingNow.delete(network);
      return true;
    }
    try {
      if (!at.noted) {
        this.ownDue.delete(network);
        const skip = await this.noteOwn(network, batch.pin, batch.epoch);
        if (!skip) {
          this.dropBatch(network, batch);
          return true;
        }
        at.noted = true;
        return true;
      }
      if (at.index < batch.envelopes.length) {
        const envelope = batch.envelopes[at.index]!;
        const hash = envelopeHash(envelope);
        // What Try again steps over, in the take as in the reads (W9, round 5); and one served twice, taken once.
        if (this.skipping(network).has(hash) || at.seen.has(envelope)) {
          at.index++;
          return true;
        }
        await this.takeOne(network, at, envelope, hash);
        return true;
      }
      await this.batchDone(network, at);
      return true;
    } catch (e) {
      if (e instanceof ReserveReached) {
        // The take's own bookkeeping found no room (W11): taking stops here, what's read stays, and the next lane's first
        // phase tries again, its first step first (where a request's list left behind is set right). Nothing of it
        // shows in what the wallet asks.
        if (this.requestsBehind.has(network)) at.noted = false;
        this.full.add(network);
        this.blocked.add(network);
        this.notify(network);
        return true;
      }
      throw e;
    }
  }

  /** Whether the keys there now are another phrase's than `pin`'s: false while locked. The runner's: admitted. */
  private async anotherPhrase(pin: PhrasePin): Promise<boolean> {
    // Of the keys as they are now (`admitted`'s `now`): a lock and an unlock of the same phrase since isn't another's.
    try {
      await this.admitted((admit) => this.laneKey((_key, keys) => pin(keys), admit), undefined, true);
      return false;
    } catch {
      return (await this.admitted((admit) => this.deps.wallet.state(admit), undefined, true)) === "unlocked";
    }
  }

  /** What Try again steps over now, by SHA-256: the read record's skip list, not yet past its time. */
  private skipping(network: NetworkName): Set<string> {
    const now = this.deps.now();
    return new Set((this.readRecords.get(network)?.skip ?? []).filter((s) => s.until > now).map((s) => s.envelope));
  }

  /**
   * One envelope taken (a step), under the take's mark naming it (W9): received, its records written. One whose take
   * throws is passed over without a word (W3, W9), but a read of storage that failed under it, which is tried again in
   * place first (TAKE_RETRIES, f2), its pause a timer out of the queue; and one with no room is counted and passed over
   * (`noRoom`, W11). A lock, another phrase, a trap or an inbox that won't open stops the take: what isn't taken stays.
   */
  private async takeOne(network: NetworkName, at: TakeAt, envelope: string, hash: string): Promise<void> {
    const { batch } = at;
    const step: Step = { trapped: false };
    // Where the browser refuses the mark, the take goes on without one (W11).
    await this.setMark(network, "take", { envelope: hash }, batch.pin).catch((e: unknown) => {
      if (!(e instanceof MessagingFull)) throw e;
    });
    try {
      // A step of its own: `receive` runs in the service's queue.
      if (await this.receive(network, envelope, batch.pin, step, batch.epoch)) at.arrived = true;
    } catch (e) {
      if (step.trapped) {
        await this.noteTrap(network, "take");
        throw e;
      }
      if (e instanceof WalletLocked) {
        // A lock keeps the batch for the next lane's runner; one another phrase's keys can't take goes.
        if (await this.anotherPhrase(batch.pin)) this.dropBatch(network, batch);
        throw e;
      }
      if (e instanceof ReserveReached || e instanceof UnreadableRecordError) throw e;
      if (e instanceof MessagingFull) {
        // No room for this one's message (W11): not kept, and counted as its read goes.
        at.noRoom++;
        at.arrived = true;
      } else if (e instanceof StorageFailed && at.tries < TAKE_RETRIES) {
        // A read of storage failed under it, nothing of the envelope's (f2): the same one again, as a step of its own,
        // after a pause out of the queue, which holds no page and no post.
        at.tries++;
        await this.pause(TAKE_RETRY_MS);
        return;
      } else {
        // This envelope's alone: passed over without a word, and the next taken (W9).
        this.deps.passedOver?.(e);
      }
    }
    at.tries = 0;
    at.index++;
    at.seen.add(envelope);
  }

  /**
   * A read's envelopes taken (round 5): gone from the take record in one rewrite where it was saved, or from what's
   * owed where it wasn't; with those of them that had no room this time (`noRoom`, W11), counted as their read is done
   * with, so a read taken again after a stop counts each once (f5). Then what the inbox shows of a conversation whose
   * inbox write failed after its record's set right (f4), and the screens told where anything they show changed.
   */
  private async batchDone(network: NetworkName, at: TakeAt): Promise<void> {
    const { batch } = at;
    batch.done = true;
    await this.setMark(network, "take", undefined).catch((e: unknown) => {
      if (!(e instanceof MessagingFull)) throw e;
    });
    if (batch.saved || at.noRoom) {
      const wrote = await this.step(() =>
        this.onChain(this.takeWrites, network, async () => {
          if (batch.epoch !== this.epochOf(network)) return false;
          const held = await this.takesOf(network, batch.pin);
          const batches = batch.saved ? held.batches.filter((b) => !sameBatch(b, batch)) : held.batches;
          if (batches.length === held.batches.length && !at.noRoom) return false;
          try {
            await this.writeTakes(network, held, { ...held, batches, noRoom: held.noRoom + at.noRoom });
          } catch (e) {
            // The take's own bookkeeping with no room (W11): it stops, and the next take, after the next lane, takes the
            // read again from its first envelope, every one taken already refused as a duplicate (§5).
            if (!(e instanceof MessagingFull)) throw e;
            batch.done = false;
            this.takingNow.delete(network);
            throw new ReserveReached();
          }
          return true;
        }),
      );
      if (wrote && at.noRoom) at.arrived = true;
    }
    if (batch.owed) {
      const owed = batch.owed;
      batch.owed = 0;
      await this.lowerOwed(network, owed);
    }
    if (await this.setRight(network, batch.epoch, batch.pin)) at.arrived = true;
    this.dropBatch(network, batch);
    if (at.arrived) this.notify(network);
  }

  /** `batch` done with, or no longer to be taken: gone from memory. */
  private dropBatch(network: NetworkName, batch: Batch): void {
    this.batches.set(
      network,
      this.batchesOf(network).filter((b) => b !== batch),
    );
    if (this.takingNow.get(network)?.batch === batch) this.takingNow.delete(network);
  }

  /** The rest of a network's work, a step at a time: the sweep's, then expiry's. Whether there was one. */
  private async restStep(): Promise<boolean> {
    for (const network of this.networks()) {
      const rest = this.rest.get(network);
      if (!rest) continue;
      // Bookkeeping with no room is left for the next unlock's sweep, or the next hour's expiry (W11); an inbox that
      // won't open, for it to open (W9).
      const roomless = (e: unknown) => {
        if (!(e instanceof MessagingFull) && !(e instanceof UnreadableRecordError)) throw e;
      };
      if (rest.sweep) {
        rest.sweep = false;
        await this.sweep(network).catch(roomless);
        return true;
      }
      if (rest.expire) {
        rest.expire = false;
        await this.expire(network).catch(roomless);
        return true;
      }
      this.rest.delete(network);
    }
    return false;
  }

  /**
   * One step of the runner's (round 5): `task` in the service's queue, after every earlier state change, with the gate
   * before each of its calls into the wallet's queue (`got`, `put`, `withKey`, the gated store), so one that overruns
   * yields to the next lane or tick at its next call.
   */
  private step<T>(task: () => Promise<T>): Promise<T> {
    return this.serial(async () => {
      this.deps.observe?.("step-start");
      try {
        return await task();
      } finally {
        this.deps.observe?.("step-end");
      }
    });
  }

  /**
   * Sets which Seedelfs take first messages now (`handlesNow`), from what the wallet holds, with no request: a step,
   * before each read's envelopes are taken, under the phrase its read was made under. At the first with a kept view,
   * the Seedelfs this browser minted before 1.10.0 are adopted (`adopt`, W12). In the same write, what the inbox shows of
   * a conversation whose inbox write failed after its record's is set right from the record (f4). Undefined when a
   * rewind or Messages started again has made this take stale (f1).
   */
  private noteOwn(network: NetworkName, pin: PhrasePin, epoch: number): Promise<true | undefined> {
    return this.step(async () => {
      if (this.epochOf(network) !== epoch) return undefined;
      await this.withKey((_key, keys) => pin(keys));
      // A request kept in its record whose list's write was refused: the list set right first.
      if (this.requestsBehind.has(network)) {
        await this.repairRequests(network);
        this.requestsBehind.delete(network);
      }
      const inbox = await this.inbox(network);
      const adopted = await this.adopt(network, inbox);
      const { handles, seen, gone } = await this.handlesNow(network, inbox);
      const noted = await this.setNotedRight(network, inbox);
      if (!adopted && !noted.changed && sameHandles(handles, inbox.handles) && sameList(seen, inbox.seen ?? []) && sameList(gone, inbox.gone ?? [])) {
        this.clearNoted(network, noted.cids);
        return true;
      }
      inbox.handles = handles;
      inbox.seen = seen;
      if (gone.length) inbox.gone = gone;
      else delete inbox.gone;
      // Bookkeeping, never refused for the budget: what's taken after it is, where it doesn't fit.
      await this.writeInbox(network, inbox, { kind: "bookkeeping" });
      this.clearNoted(network, noted.cids);
      return true;
    });
  }

  /**
   * At a read's end in the take (f4): what the inbox shows of each conversation whose inbox write failed after its
   * record's, set right from its record, in one bookkeeping write, a step of the runner's. Whether to tell open pages.
   */
  private async setRight(network: NetworkName, epoch: number, pin: PhrasePin): Promise<boolean> {
    if (!this.inboxBehind.get(network)?.size) return false;
    return this.step(async () => {
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
    const view = await this.keptView(network);
    if (!view) return false;
    const [paid, made] = await Promise.all([mintedBy(this.gatedStore, network), mintedAt(this.gatedStore, network)]);
    for (const name of Object.keys(paid)) {
      if (made[name] !== undefined) continue;
      const at = view.find((s) => s.name === name);
      // One that couldn't be written now is left off, and isn't tried again: the user can turn it on.
      if (at) {
        await rememberRegister(this.gatedStore, network, name, at.register).catch((e: unknown) => {
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
    const [made, view] = await Promise.all([mintedAt(this.gatedStore, network), this.keptView(network)]);
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
    const made = await mintedAt(this.gatedStore, network);
    if (made[name]?.some((r) => sameRegister(r, register))) return true;
    if (removedHere(made, name) || (inbox.gone ?? []).includes(pairKey(name, register))) return false;
    return choiceOf(inbox, name, register)?.on === true;
  }

  /**
   * Every Seedelf the kept view has under the key, and whether it takes first messages (W8): none without a view. For
   * the overview, which reads these at once: the wallet's own records, the same size whatever any envelope held.
   */
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

  /** The kept contract view's Seedelfs under the key, for the runner and the presses: admitted (`admitted`). No request. */
  private async keptView(network: NetworkName): Promise<Array<{ name: string; register: RegisterHex }> | undefined> {
    return this.admitted((admit) => this.deps.ownSeedelfs(network, false, admit));
  }

  /**
   * Takes one envelope the scan matched, in the queue: a message of a held conversation, a request started or joined,
   * or nothing. Every refusal is dropped without a word (W3): anyone can address an envelope to any register of the
   * key, so a refusal kept, shown or acted on would tell its sender which registers are this wallet's. A code this
   * version doesn't know is dropped too. But one: a message of a held conversation its own ratchet authenticated and
   * can't reach (`too_far_ahead`, which the crate gives only once the message and its envelope have checked out,
   * DESIGN-protocol §3.3): the conversation may not continue (§6), until a later message of it decrypts. No envelope
   * starts a request of any kind (W1). A first message that isn't a held conversation's, nor a request's the list shows,
   * is received first with the tombstones alone (round 5): the crate checks everything it would before the requests
   * record, and only one it takes as a new request is received again with the record, which is read then, and that
   * answer kept; both calls at the same `now`. A join, one whose request the list shows, is received once, with the
   * record. A record the crate can't read is set aside, and the envelope taken once more without it (W9). A trap in any
   * of its WebAssembly calls is `step`'s. A take of an older epoch (`epoch`: a rewind, or Messages started again, since)
   * takes nothing (f1). A reply the thread doesn't show, in a conversation this wallet started and nobody has answered,
   * answers nothing: the share is held as the crate counted it before (O4). Nothing a take does seals or posts a message
   * (fix item 2). Returns whether anything the screens show changed.
   */
  private receive(network: NetworkName, envelope: string, pin: PhrasePin, step: Step, epoch: number): Promise<boolean> {
    return this.step(async () => {
      if (this.epochOf(network) !== epoch) return false;
      const opened = await this.withKey((key, keys) => {
        pin(keys);
        return this.parse<Opened>(this.watch(step, () => this.deps.wasm.messagingOpen(key, envelope)));
      });
      if (isRefused(opened)) return false;
      // A request an Accept left in its record leaves it before the crate is handed that record (`settled`).
      const inbox = await this.settled(network);
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
      const listed = inbox.requestsShown[opened.cid] !== undefined;
      // The wallet's Seedelfs, only for a stranger's first message to one: nothing else needs them. From what the
      // wallet holds already (`noteOwn`): a first message to one that takes none is dropped, never a read of the chain.
      const held = inbox.conversations[opened.cid] !== undefined || listed;
      const stranger = first && !held && !!opened.to;
      const records = first && inbox.conversations[opened.cid] === undefined;
      // One `now` for both of a first message's calls.
      const now = Math.floor(this.deps.now() / 1000);
      /** The requests record, read only where the crate needs it (round 5). */
      let requests: RequestsHeld | undefined;
      type Received =
        | { received: { kind: "message"; cid: string; plaintext: string }; conversation: string }
        | { received: { kind: "request"; cid: string; plaintext: string; new: boolean; evicted: string[] }; requests: string };
      const call = (withRequests: boolean) => {
        const record = withRequests ? requests?.requests : undefined;
        const request = JSON.stringify({
          envelope,
          now,
          handles: stranger ? Object.entries(inbox.handles).map(([name, registers]) => ({ name, registers })) : [],
          conversations: [...files.values()].map((f) => f.state),
          ...(records && record !== undefined ? { requests: record } : {}),
          ...(records && inbox.tombstones ? { tombstones: inbox.tombstones } : {}),
          ...(this.deps.firstContactBits !== undefined ? { firstContactBits: this.deps.firstContactBits } : {}),
        });
        return this.withKey((key, keys) => {
          pin(keys);
          return this.parse<Received>(this.watch(step, () => this.deps.wasm.messagingReceive(key, request)));
        });
      };
      /** The crate's answer: a record it can't read set aside, and the call made once more without it (W9, W17). */
      const answer = async (withRequests: boolean) => {
        const aside = () => this.setAside(inbox, files, records ? { requests: withRequests ? requests : undefined, tombstones: true } : undefined, step);
        let result: Received | Refused;
        try {
          result = await call(withRequests);
          if (isRefused(result) && RECORD_REFUSALS.has(result.refused) && aside()) {
            repaired = true;
            result = await call(withRequests);
          }
        } catch (e) {
          if (step.trapped || e instanceof WalletLocked) throw e;
          // The crate couldn't read a record it was handed: a later build's, or damaged. Set aside, and once more.
          if (!aside()) throw e;
          repaired = true;
          result = await call(withRequests);
        }
        return result;
      };
      let result: Received | Refused;
      if (records && !listed) {
        result = await answer(false);
        if (!isRefused(result) && "requests" in result && result.received.new) {
          requests = await this.requestsOf(network, inbox);
          if (requests.changed) repaired = true;
          result = await answer(true);
        }
      } else {
        if (records) {
          requests = await this.requestsOf(network, inbox);
          if (requests.changed) repaired = true;
        }
        result = await answer(true);
      }
      if (isRefused(result)) {
        const meta = result.refused === "too_far_ahead" ? inbox.conversations[opened.cid] : undefined;
        const unreachable = !!meta && !meta.unreachable;
        if (unreachable) meta.unreachable = true;
        if (requests?.changed) await this.writeRequests(network, inbox, requests);
        if (unreachable || repaired) await this.writeInbox(network, inbox, { kind: "bookkeeping" });
        return unreachable || repaired;
      }
      const at = this.deps.now();
      if ("conversation" in result) {
        const cid = result.received.cid;
        const meta = inbox.conversations[cid];
        const file = files.get(cid);
        if (!meta || !file) {
          if (repaired) await this.writeInbox(network, inbox, { kind: "bookkeeping" });
          return repaired;
        }
        const shown = textOf(result.received.plaintext);
        // A reply the thread doesn't show (a control kind this version doesn't know, W15) in a conversation this wallet
        // started and nobody has answered yet (the 1.10.0 gate's round 5, O4): what the user can do there changes with
        // nothing they can see. The crate's own count of the writer's share, as the state was before it (no trim moves
        // it), is held in the record, and the share, Show my Seedelf and the restart prompt stay as they were.
        if (!shown && meta.role === "initiator" && !meta.answered && !file.held) {
          const before = file.state;
          const info = () => this.read<ConversationInfo>(this.wasmCall(() => this.watch(step, () => this.deps.wasm.messagingConversationInfo(before))));
          const left = this.tryOr(() => info().firstContactLeft, null);
          if (left) file.held = { messages: left.messages, bytes: left.bytes, perMessage: left.perMessage };
        }
        file.state = result.conversation;
        if (shown) {
          const entry: Entry = { id: file.next++, dir: "in", at, ...shown };
          if (entry.kind === KIND_REVEAL) {
            // §19.4's first three checks, now, with no request: a session message, at the side written to, whose proof
            // verifies. The chain's register waits for the user's press (`checkReveals`); commit marks the conversation.
            entry.reveal = this.checkReveal(opened.kind, result.conversation, result.received.plaintext, step);
          }
          file.history.push(entry);
          meta.unread++;
          meta.lastAt = at;
          // Only the other side's reply decrypts in a conversation this wallet started, and this one the thread shows:
          // it's answered, and its share ends (W17), a share held for a reply it didn't show with it.
          meta.answered = true;
          delete file.held;
        }
        // A control kind this version doesn't know leaves nothing to see (W15), but its ratchet stepped: kept.
        // A message the ratchet reached: the conversation goes on.
        delete meta.unreachable;
        // Nothing a take does seals or posts a message (relay-oracle fix item 2): a text still queued waits for the
        // user's next press in its conversation, which seals it first. Kept only if it fits; one that doesn't is counted
        // where it's taken, and its ratchet's step is lost with it.
        await this.commit(network, inbox, cid, file, "content", shown ? file.next - 1 : undefined, false, [], true);
      } else {
        const { cid, evicted } = result.received;
        const record: RequestsHeld = { ...(requests ?? {}), requests: result.requests };
        this.showRequest(inbox, opened, result.received, step, result.requests);
        // A control kind this version doesn't know isn't counted as unread (W15).
        if (textOf(result.received.plaintext)) inbox.requestsUnread[cid] = (inbox.requestsUnread[cid] ?? 0) + 1;
        for (const gone of evicted) {
          delete inbox.requestsUnread[gone];
          delete inbox.requestsShown[gone];
        }
        // A room of their own (W11): bounded by the crate, never trimming a message nor counted in the budget. The
        // record before the inbox that lists it.
        await this.writeRequests(network, inbox, record);
        try {
          await this.writeInbox(network, inbox, { kind: "requests" });
        } catch (e) {
          if (!(e instanceof MessagingFull)) throw e;
          // The request is kept in its record, and the list behind it: the take's own bookkeeping, so the take stops for
          // room, and its next first step sets the list right from the record.
          this.requestsBehind.add(network);
          throw new ReserveReached();
        }
      }
      return true;
    });
  }

  /**
   * Sets what the list shows of the request `received` just started or joined (W7): a join adds a message; a new one
   * is what its F says, and for a continuation what the crate judged it, from the record (`requests`, the crate's own
   * answer, just given). Any it doesn't hold yet, the record says all of.
   */
  private showRequest(inbox: Inbox, opened: Opened, received: { cid: string; new: boolean }, step: Step, requests: string): void {
    const at = Math.floor(this.deps.now() / 1000);
    const shown = inbox.requestsShown[received.cid];
    if (shown && !received.new) {
      shown.messages++;
      shown.last = at;
      return;
    }
    if (!received.new || opened.replaces) {
      // A continuation's `verified` is the crate's to say, as is all of one this inbox lost count of. One the crate
      // refused is said from F, as a new one is.
      const listed = this.requestsInfo(requests, step);
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
   * can't be opened, and kept as it is; the requests' (`records.requests`, where it was handed) is kept apart where a
   * later version wrote it, and otherwise dropped (`asideRequests`); the tombstones' (where `records.tombstones`) is
   * dropped. The last two hold no keys (a request waiting is lost, and a deleted conversation's first message could come
   * back as a request in its 48 hours). Whether it found one.
   */
  private setAside(
    inbox: Inbox,
    files: Map<string, ConversationFile>,
    records: { requests?: RequestsHeld; tombstones: boolean } | undefined,
    step?: Step,
  ): boolean {
    let found = false;
    for (const [cid, file] of files) {
      if (this.reads(() => this.deps.wasm.messagingConversationInfo(file.state), step)) continue;
      files.delete(cid);
      const meta = inbox.conversations[cid];
      if (meta) meta.unreadable = true;
      found = true;
    }
    const held = records?.requests;
    const refusal = held?.requests !== undefined ? this.refusalOf(() => this.deps.wasm.messagingRequestsInfo(held.requests!), step) : undefined;
    if (held && refusal) {
      this.asideRequests(inbox, held, refusal);
      found = true;
    }
    if (
      records?.tombstones &&
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
   * past this build's `requestsVersion`, is kept apart as it is (`aside`), never written over; a development build's,
   * older, or one that doesn't parse, is dropped, the messages the list showed of it counted (`dropped`). Either way the
   * list loses its requests, which can't be opened, and new ones start a record of their own. `held` changes with it,
   * for its caller to write before the inbox.
   */
  private asideRequests(inbox: Inbox, held: RequestsHeld, refusal: RecordRefused): void {
    const requests = held.requests;
    if (requests === undefined) return;
    if (refusal.refused === "unsupported_state_version" && (refusal.version ?? 0) > this.constantsOf().requestsVersion) {
      held.aside = [...(held.aside ?? []), requests];
    } else {
      // What the list said of them; an inbox from before it kept a list, what was unread.
      const shown = Object.values(inbox.requestsShown).reduce((n, r) => n + r.messages, 0);
      const lost = shown || Object.values(inbox.requestsUnread).reduce((n, u) => n + u, 0);
      if (lost > 0) inbox.dropped = (inbox.dropped ?? 0) + lost;
    }
    delete held.requests;
    held.changed = true;
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
   * (`asideRequests`: it holds no keys), the records written so, and the request is no longer there.
   */
  private async recordsCall<T>(
    network: NetworkName,
    inbox: Inbox,
    held: RequestsHeld,
    call: () => Promise<T>,
    refused: (answer: T) => boolean,
  ): Promise<T> {
    let answer: { value: T } | undefined;
    try {
      answer = { value: await call() };
    } catch (e) {
      if (e instanceof WalletLocked) throw e;
    }
    if (answer && !refused(answer.value)) return answer.value;
    if (this.setAside(inbox, new Map(), { requests: held, tombstones: true })) {
      if (held.changed) await this.writeRequests(network, inbox, held);
      await this.writeInbox(network, inbox, { kind: "bookkeeping" });
      this.notify(network);
    }
    throw new Error(t("worker.messaging.noRequest"));
  }

  /**
   * The requests' records (round 5): an old inbox's, until the sweep moves them (O6); else `messagingRequests`, read
   * now. One that won't open holds no keys: what the list showed of it is counted as lost and the list cleared on
   * `inbox` (`changed`, for the caller to write), and a new record starts (W9).
   */
  private async requestsOf(network: NetworkName, inbox: Inbox): Promise<RequestsHeld> {
    if (inbox.legacy) return { ...inbox.legacy };
    try {
      return requestsFromStored(await this.got<StoredRequests>(requestsRecord(network)));
    } catch (e) {
      if (!(e instanceof UnreadableRecordError)) throw e;
      const lost = Object.values(inbox.requestsShown).reduce((n, r) => n + r.messages, 0);
      if (lost > 0) inbox.dropped = (inbox.dropped ?? 0) + lost;
      inbox.requestsShown = {};
      inbox.requestsUnread = {};
      return { changed: true };
    }
  }

  /**
   * Writes `network`'s requests record as `held` says, before the inbox that lists it (round 5), and notes on `inbox`
   * the nonce it was sealed under, which the sweep compares (`repairRequests`). Its own room (W11): never the budget.
   * Nothing left in it deletes it. It never unsets the inbox's mark of a request an Accept left (`requestLeft`): the
   * nonce it notes says the list is this record's, not that the record holds no accepted request.
   */
  private async writeRequests(network: NetworkName, inbox: Inbox, held: Requests): Promise<void> {
    const name = requestsRecord(network);
    delete inbox.legacy;
    await this.sizesNow();
    if (held.requests === undefined && !held.aside?.length) {
      this.mine();
      await this.deps.store.remove(name);
      delete inbox.requestsAs;
      this.requestsBytes.set(network, 0);
      return;
    }
    const stored = requestsToStored(held);
    const bytes = sizeOf(stored);
    const was = this.requestsBytes.get(network) ?? (await this.storedSize(name));
    await this.put(network, name, stored, "requests", bytes - was, { network, requests: bytes });
    this.requestsBytes.set(network, bytes);
    const nonce = this.deps.store.lastSealed(name) ?? (await this.deps.store.sealedAs(name));
    if (nonce === undefined) delete inbox.requestsAs;
    else inbox.requestsAs = nonce;
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
    this.notify(network);
    try {
      // Asked again right before the request: the switch turned off, or a lock, while the records were read stops it.
      await allowed();
      // The press's own chain read: its request, at once.
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
      this.notify(network);
    }
  }

  /**
   * Expires skipped keys past their 48 hours, and tombstones past their t + 48 hours and 7 days (the crate's margin, which
   * a clock set back can't undo, DESIGN-protocol §3.6): at the first runner pass of each unlock, and at most hourly
   * after, one record a step (round 5). Writes only what changed, and keeps each record's count true (W7). A record the
   * crate can't read is marked so. A last expiry later than now is a clock set back since, and expiry runs at once (W14,
   * clock#3).
   */
  private async expire(network: NetworkName): Promise<void> {
    const due = (now: number, last: number | undefined) => last === undefined || now < last || now - last >= EXPIRE_EVERY_MS;
    if (!due(this.deps.now(), await this.expiredAt(network))) return;
    const secs = Math.floor(this.deps.now() / 1000);
    const cids = Object.keys((await this.step(() => this.inbox(network))).conversations);
    for (const cid of cids) {
      await this.step(async () => {
        const inbox = await this.inbox(network);
        const meta = inbox.conversations[cid];
        if (!meta || meta.unreadable) return;
        const file = await this.readable(network, meta);
        if (!file) return;
        let expired: { conversation: string };
        try {
          expired = this.read<{ conversation: string }>(
            this.wasmCall(() => this.deps.wasm.messagingExpire(JSON.stringify({ now: secs, conversation: file.state }))),
          );
        } catch (e) {
          if (e instanceof WalletLocked) throw e;
          // The crate can't read it: it can't be shown, and can be deleted (W9). The rest expire all the same.
          meta.unreadable = true;
          await this.writeInbox(network, inbox, { kind: "bookkeeping" });
          return;
        }
        if (expired.conversation === file.state) return;
        file.state = expired.conversation;
        const stored = fileToStored(file);
        const bytes = sizeOf(stored);
        await this.put(network, conversationRecord(network, meta.id!), stored, "bookkeeping", bytes - meta.bytes);
        Object.assign(meta, measure(file, meta, bytes));
        await this.writeInbox(network, inbox, { kind: "bookkeeping" });
      });
    }
    await this.step(async () => {
      const inbox = await this.inbox(network);
      if (inbox.tombstones) {
        const tombstones = inbox.tombstones;
        let changed = false;
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
        if (changed) await this.writeInbox(network, inbox, { kind: "bookkeeping" });
      }
      await this.noteExpired(network, this.deps.now());
    });
  }

  /**
   * Once each unlock, and so each worker's life, after the first window's repairs: deletes conversation records the
   * inbox doesn't list (a stop between writing one and listing it, or between unlisting one and deleting it, and any
   * named the way builds before the 1.10.0 gate named them), in one step; then brings what the inbox shows of each
   * conversation back to its record, one record a step: a stop or a lock between a record's write and the inbox's would
   * otherwise leave its outbox uncounted, or a reply uncounted and unanswered (W9).
   */
  private async sweep(network: NetworkName): Promise<void> {
    const mark = `${network}:${(await this.stampNow()) ?? 0}`;
    if (this.swept.has(mark)) return;
    const cids = await this.step(async () => {
      const inbox = await this.inbox(network);
      const prefix = PRIVATE_PREFIX + CONVERSATION_RECORDS + network + ".";
      const ids = new Set(Object.values(inbox.conversations).flatMap((m) => (m.id ? [m.id] : [])));
      for (const key of await this.deps.local.keys(prefix)) {
        const id = key.slice(prefix.length);
        if (ids.has(id)) continue;
        // Unlisted by the inbox this step read: only while that's still the wallet's (`mine`).
        this.mine();
        await this.deps.store.remove(conversationRecord(network, id));
      }
      return Object.keys(inbox.conversations);
    });
    for (const cid of cids) {
      await this.step(async () => {
        const inbox = await this.inbox(network);
        const meta = inbox.conversations[cid];
        if (meta && (await this.setEntryRight(network, inbox, cid, meta))) await this.writeInbox(network, inbox, { kind: "bookkeeping" });
        this.inboxBehind.get(network)?.delete(cid);
      });
    }
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
      now.last?.unsent !== meta.last?.unsent ||
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
  // Stamps
  // -------------------------------------------------------------------------

  /**
   * Solves conversation `cid`'s first-contact stamp, about 7 s, in slices out of the queue, then sets it and seals
   * every text waiting for it, in the queue, and posts them in a lane of their own. Nothing secret is held outside a
   * record meanwhile (54a′).
   */
  private async stamp(network: NetworkName, cid: string): Promise<void> {
    const key = keyOf(network, cid);
    if (this.solving.has(key)) return;
    this.solving.add(key);
    // Whether this call put up the thread's "about N s": only then is it this call's to take down, never the work of a
    // post being solved meanwhile in the same conversation (worker-net#14).
    let shown = false;
    try {
      // Nothing is solved while the relay is stopped (W15, fix A): the first lane after it answers solves it.
      if (await this.stopOf(network, true)) return;
      const meta = (await this.inbox(network)).conversations[cid];
      const file = meta && (await this.readable(network, meta));
      if (!file?.stampDigest) return;
      const bits = this.deps.firstContactBits ?? this.constantsOf().firstContactStampBits;
      this.work.set(key, { bits });
      shown = true;
      this.notify(network);
      let nonce: number;
      try {
        nonce = await this.solve(file.stampDigest, bits, 0, network, () => this.unlockedNow());
      } catch (e) {
        // The relay stopped while it was solved (fix A), or the wallet locked or was removed: given up, its messages
        // still queued for the next first window's stamp.
        if (e instanceof StopMet) return;
        throw e;
      }
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
        // Every text queued for the stamp, in order (W13): send counted each against the writer's own share before it
        // queued it, so all seal; one the crate refused all the same, and every one after it, would wait queued for the
        // user's next press there (`sealQueued`). None is ever the server's refusal.
        const before = pendingIds(kept);
        this.sealQueued(kept);
        await this.commit(network, inbox, cid, kept, "content", undefined, false, newlyPending(kept, before));
      });
      this.work.delete(key);
      shown = false;
      this.notify(network);
      await this.post(network);
    } finally {
      this.solving.delete(key);
      if (shown) this.work.delete(key);
    }
  }

  /**
   * Seals every queued text of `file` in order, the ratchet stepping in it: each pending, to be posted (W13). Only a
   * press calls it, or the stamp's turn a press started: nothing a take does seals or posts a message (relay-oracle fix
   * item 2). Send refuses a text past the writer's own share of first messages before it's queued (`shareOf`), so at
   * the stamp's turn every queued text seals. Defensively, one the crate still refuses for the share (`request_full`)
   * stays queued, with every one after it, and that's returned: they wait for the user's next press in the conversation,
   * which seals them first, and the thread shows them queued. That branch tells the test hook (`unreachable`), as does
   * send's and reveal's. One the crate refuses for anything else is the wallet's refusal, with no bytes, and the rest
   * go on.
   */
  private sealQueued(file: ConversationFile): "request_full" | undefined {
    for (const entry of file.history) {
      if (entry.sent !== "queued") continue;
      if (this.sealPlaintext(file, entry, plaintextOf(entry.text ?? "")) === "request_full") {
        entry.sent = "queued";
        delete entry.refusedBy;
        this.deps.unreachable?.("sealQueued");
        return "request_full";
      }
    }
    return undefined;
  }

  /**
   * Seals `plaintext` (hex, its kind first) as `entry`'s envelope, the ratchet stepping in `file`. Returns the crate's
   * refusal, when it refused: the entry is then `refused` by the wallet (W13), with no bytes. Where a share is held for a
   * reply the thread doesn't show (O4), it's lowered as the crate would count a first message: one message, and the
   * plaintext and `perMessage`.
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
    if (file.held) {
      const { messages, bytes, perMessage } = file.held;
      file.held = { messages: Math.max(0, messages - 1), bytes: Math.max(0, bytes - plaintext.length / 2 - perMessage), perMessage };
    }
    return undefined;
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
   * nothing was written in is never written empty. A fixed write (round 5): a mark is a few words inside the smallest
   * pad, never looked at against the area's reserve and never `full`; one the browser refuses throws MessagingFull, and
   * the step goes on without it. `lane`: the scan's, in a lane; any other waits for the gate before it joins the chain.
   */
  private async setMark(network: NetworkName, step: MarkStep, mark: ScanMark | TakeMark | undefined, pin?: PhrasePin, lane = false): Promise<void> {
    const name = markRecord(network, step);
    const value = mark ?? {};
    const empty = Object.keys(value).length === 0;
    // The take's mark, outside a lane: each of its calls into the wallet's queue admitted (`admitted`), in its chain,
    // which is its own, so nothing in a lane ever waits on it, and its writes keep their order.
    const queued = <T>(call: (admit?: Admit) => Promise<T>) => (lane ? call() : this.admitted(call));
    const run = (this.markWrites.get(name) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        if (empty && this.marked.get(name) === false) return;
        if (pin) await queued((admit) => this.laneKey((_key, keys) => pin(keys), admit));
        await queued((admit) => this.rawPut(network, name, value, "fixed", 0, undefined, false, admit));
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
    this.notify(network);
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

  /**
   * `network`'s inbox, read now (outside a lane: `got` waits for the gate), and held for the overview as read (O8). One a
   * development build before round 5 wrote keeps its requests as `legacy` until the sweep moves them (O6); its read
   * cursor, gap, skip list and clock go.
   */
  private async inbox(network: NetworkName): Promise<Inbox> {
    let kept: (StoredInbox & { lost?: unknown; expiredAt?: unknown }) | undefined;
    try {
      kept = await this.got<StoredInbox & { lost?: unknown; expiredAt?: unknown }>(`messaging.${network}`);
      if (kept && !READS_VERSIONS.has(kept.v)) throw new UnreadableRecordError(`messaging.${network}`);
    } catch (e) {
      if (e instanceof UnreadableRecordError) this.unopenable.add(network);
      throw e;
    }
    this.unopenable.delete(network);
    const at = await this.stampNow();
    if (!kept) {
      const empty = emptyInbox();
      this.keepShown(network, empty, at);
      return empty;
    }
    // Another build's version is an inbox that won't open (W15), as above: what it holds is never misread, nor
    // written over. What builds before kept that this one doesn't: a count of conversations this browser doesn't hold (W3), when it
    // last expired (session storage keeps it), and what a read needs, which the read record keeps now (O6).
    const {
      lost: _lost,
      expiredAt: _expiredAt,
      cursor: _cursor,
      gapAt: _gapAt,
      skip: _skip,
      clock: _clock,
      requestsShown,
      requests,
      requestsAside,
      tombstones,
      v,
      ...rest
    } = kept;
    const binary = (value: string) => (v === 2 ? hexOfBase64(value) : value);
    const legacy =
      requests !== undefined || requestsAside?.length
        ? { ...(requests !== undefined ? { requests: binary(requests) } : {}), ...(requestsAside?.length ? { aside: requestsAside.map(binary) } : {}) }
        : undefined;
    const inbox: Inbox = {
      ...emptyInbox(),
      ...rest,
      v: 2,
      ...(tombstones !== undefined ? { tombstones: binary(tombstones) } : {}),
      requestsShown: requestsShown ?? {},
      ...(legacy ? { legacy } : {}),
    };
    // An inbox from before the 1.10.0 gate kept no list of its requests: made once from the record, and written with
    // the inbox's next write. One the crate can't read is set aside or dropped (`asideRequests`).
    if (legacy?.requests !== undefined && !requestsShown) {
      let listed: RequestInfo[] | RecordRefused;
      try {
        listed = this.requestsInfo(legacy.requests);
      } catch (e) {
        if (e instanceof WalletLocked) throw e;
        listed = { refused: "invalid_state" };
      }
      if (isRefused(listed)) {
        const held: RequestsHeld = { ...legacy };
        this.asideRequests(inbox, held, listed);
        if (held.requests === undefined && !held.aside?.length) delete inbox.legacy;
        else inbox.legacy = { ...(held.requests !== undefined ? { requests: held.requests } : {}), ...(held.aside?.length ? { aside: held.aside } : {}) };
      } else for (const info of listed) inbox.requestsShown[info.cid] = shownOf(info);
    }
    this.keepShown(network, inbox, at);
    return inbox;
  }

  /** Holds a copy of `inbox` as read or written in unlock `at`, for the overview (O8). */
  private keepShown(network: NetworkName, inbox: Inbox, at: number | undefined): void {
    if (at === undefined) return;
    this.shown.set(network, { inbox: structuredClone(inbox), at });
  }

  /**
   * Writes `network`'s inbox (W7, W11). `content`, the default: within the budget where it grows, as the budget counts
   * it, making room first, and throwing MessagingFull, writing nothing, when it can't. `requests`: a request's list,
   * never the budget. `bookkeeping` (which Seedelfs take first messages, what was read, a mark of what's unreadable, a
   * name, what a record now holds): makes room best effort, and is never refused for the budget. Whatever its kind, a
   * write that grows storage never crosses the area's reserve, the rooms counted as taken (`put`).
   */
  private async writeInbox(network: NetworkName, inbox: Inbox, { kind = "content" }: { kind?: WriteKind } = {}): Promise<void> {
    await this.sizesNow();
    const known = this.sizes.get(network);
    const was = known?.inbox ?? (await this.storedSize(`messaging.${network}`));
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
    const largest = this.inboxLargest(inbox);
    await this.put(network, `messaging.${network}`, stored, kind, bytes - was, { network, inbox: { bytes, largest } });
    this.noteSize(network, { inbox: bytes, lean, total: lean + conversationBytes(inbox), largest });
    this.keepShown(network, inbox, await this.stampNow());
  }

  /**
   * What `inbox` would take as stored with every field a take sets at its most (O5): the request listing at the crate's
   * most requests, each at its longest; each conversation's preview at PREVIEW_CHARS code points that escape at their
   * longest, its counts at their most digits, and its flags set. The area's reserve counts the inbox at this, so what
   * strangers and the other sides send never decides whether the user's write fits.
   */
  private inboxLargest(inbox: Inbox): number {
    const most = this.constantsOfOrDefault().maxRequests ?? 50;
    const hex64 = "f".repeat(64);
    const digits = Number.MAX_SAFE_INTEGER;
    const longest: RequestShown = { t: digits, to: hex64, continues: { cid: hex64, verified: false }, messages: digits, last: digits };
    const requestsShown: Record<string, RequestShown> = {};
    const requestsUnread: Record<string, number> = {};
    for (let i = 0; i < most; i++) {
      const cid = i.toString(16).padStart(64, "f");
      requestsShown[cid] = longest;
      requestsUnread[cid] = digits;
    }
    // A control character escapes to six bytes in JSON: the longest a code point can take.
    const text = `${"\u0001".repeat(PREVIEW_CHARS)}…`;
    const conversations = Object.fromEntries(
      Object.entries(inbox.conversations).map(([cid, meta]) => [
        cid,
        {
          ...meta,
          unread: digits,
          lastAt: digits,
          oldestAt: digits,
          bytes: digits,
          answered: true,
          unreachable: true,
          unreadable: true,
          unchecked: true,
          last: { dir: "out", text, unsent: "refused" },
          revealed: { name: hex64, at: digits },
        },
      ]),
    );
    const largest = { ...inboxToStored(inbox), requestsShown, requestsUnread, conversations, dropped: digits };
    return sizeOf(largest);
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

  /**
   * What a record takes now as it's stored (its sealed data's length), with no key: 0 when there's none. By
   * chrome.storage.local's own count, which reads no value (round 5), where it's given; else its sealed data's length.
   */
  private async storedSize(name: RecordName): Promise<number> {
    const key = PRIVATE_PREFIX + name;
    const count = this.deps.bytesOf ? await this.deps.bytesOf(key).catch(() => undefined) : undefined;
    if (count !== undefined) return count > 0 ? Math.max(0, count - key.length - SEALED_WRAPPER) : 0;
    return (await this.area<{ data?: string }>(key))?.data?.length ?? 0;
  }

  /**
   * A sealed record of Messages' (f2), once the gate opens: undefined when there's none; UnreadableRecordError for one
   * that won't open, and a lock, as they are; a read of the storage area that fails, StorageFailed.
   */
  private async got<T>(name: RecordName): Promise<T | undefined> {
    try {
      // The gate first, then the area's read, then the unseal in the wallet's queue, admitted (`admitted`; 1.10.0's
      // second review, F5): a lane that starts while the area answers, or while the unseal waits its turn, comes first.
      // Turned away, the area is read again, a lane may have written it meanwhile, but only once the gate has opened.
      return await this.admitted(
        (admit, sealed) => this.deps.store.open<T>(name, sealed, admit),
        () => this.deps.store.sealed(name),
      );
    } catch (e) {
      throw failedRead(e);
    }
  }

  /**
   * A sealed record read at once: a lane's own (its read record, its outbox), or inside a record's chain. `admit`: a
   * chain's own read outside a lane (`chained`).
   */
  private async rawGot<T>(name: RecordName, admit?: Admit): Promise<T | undefined> {
    try {
      return await this.deps.store.get<T>(name, admit);
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
   * Runs `task` on one of `network`'s records after every earlier one of that chain: the read record's, the outbox's,
   * the take record's. Each has its own, so no write of one waits behind another's. A lane joins the read record's and
   * the outbox's at once, so nothing in those two chains ever waits for the gate: what's not a lane's waits before it
   * joins.
   */
  private onChain<T>(chain: Map<NetworkName, Promise<unknown>>, network: NetworkName, task: () => Promise<T>): Promise<T> {
    const run = (chain.get(network) ?? Promise.resolve()).catch(() => undefined).then(task);
    chain.set(network, run);
    return run;
  }

  /**
   * The unlock what's in memory belongs to (`unlockedAt`): undefined while locked. At once: a lane's, or the overview's
   * (O8); `admit`, as `stampNow` gives it.
   */
  private async unlockStamp(admit?: Admit): Promise<number | undefined> {
    return this.deps.wallet.unlockedAt(admit).catch((e: unknown) => {
      if (e instanceof NotAdmitted) throw e;
      return undefined;
    });
  }

  /** `unlockStamp` for anything but a lane: admitted (`admitted`, round 5). */
  private stampNow(): Promise<number | undefined> {
    return this.admitted((admit) => this.unlockStamp(admit), undefined, true);
  }

  /**
   * `network`'s take record (finding 8, round 5): as held in this unlock, or read once the gate opens, under the phrase
   * `pin` binds. One that won't open holds nothing a read can't bring back, and is written over.
   */
  private async takesOf(network: NetworkName, pin: PhrasePin): Promise<TakesHeld> {
    const at = await this.stampNow();
    const held = this.takes.get(network);
    if (held && held.at === at) return held;
    await this.withKey((_key, keys) => pin(keys));
    let stored: StoredTakes | undefined;
    let there = false;
    try {
      stored = await this.got<StoredTakes>(takeRecord(network));
      there = stored !== undefined;
    } catch (e) {
      if (!(e instanceof UnreadableRecordError)) throw e;
      there = true;
    }
    const now: TakesHeld = { ...takesFromStored(stored), at, stored: there, bytes: there ? await this.storedSize(takeRecord(network)) : 0 };
    this.takes.set(network, now);
    return now;
  }

  /**
   * Writes `network`'s take record as `next`, once the gate opens, within its own room (O5), which the area's reserve
   * counts as taken: the browser alone can refuse it, as MessagingFull, which never sets `full`.
   */
  private async writeTakes(network: NetworkName, held: TakesHeld, next: Takes): Promise<void> {
    const stored = takesToStored(next);
    const bytes = sizeOf(stored);
    await this.put(network, takeRecord(network), stored, "take", held.stored ? bytes - held.bytes : bytes, { network, takes: bytes });
    this.takes.set(network, { batches: next.batches, unopened: next.unopened, noRoom: next.noRoom, seen: next.seen, at: held.at, stored: true, bytes });
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
        this.notify(network);
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
        this.notify(network);
      }
      throw new UnreadableRecordError(conversationRecord(network, meta.id ?? "-"));
    }
  }

  /**
   * Whether `network`'s relay may be asked now: its switch on, and the wallet unlocked. `pin`, a posting run's: unlocked
   * under the phrase the run began under (1.10.0's second review). The run reads what's waiting once, and a post's work
   * can take a minute: a wallet removed and another restored meanwhile, its switch turned on, is unlocked and on, and
   * the first wallet's envelopes would go out under it. A lane's look at the keys, at once: never the gate.
   */
  private async mayAsk(network: NetworkName, pin?: PhrasePin): Promise<boolean> {
    if (!(await this.isOn(network))) return false;
    if (!pin) return (await this.deps.wallet.state()) === "unlocked";
    return this.laneKey((_key, keys) => pin(keys)).then(
      () => true,
      () => false,
    );
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
   *
   * Never in a held conversation's place, nor over a record that's there (1.10.0's second review): an ID the inbox
   * already lists as a conversation, or a record's own ID that is taken (a conversation's the inbox lists, or a
   * record stored under it that nothing lists yet), is refused before anything is listed or written, in the crate's
   * word for an ID its inbox holds (`invalid_state`). Both IDs are drawn, so only a random source that repeats gets
   * here; what was there stays as it was.
   */
  private async addConversation(
    network: NetworkName,
    inbox: Inbox,
    cid: string,
    file: ConversationFile,
    meta: Omit<Meta, "id" | "outbox" | "bytes" | "oldestAt">,
  ): Promise<void> {
    const id = newRecordId();
    const taken =
      Object.values(inbox.conversations).some((held) => held.id === id) ||
      (await this.area<unknown>(PRIVATE_PREFIX + conversationRecord(network, id))) !== undefined;
    if (inbox.conversations[cid] !== undefined || taken) throw new MessagingRefused("invalid_state");
    inbox.conversations[cid] = { ...meta, id, outbox: 0, bytes: 0, oldestAt: meta.startedAt };
    try {
      await this.sizesNow();
      const listed = sizeOf(inboxToStored(inbox)) - (this.sizes.get(network)?.inbox ?? (await this.storedSize(`messaging.${network}`)));
      await this.writeFile(network, inbox, cid, file, "content", undefined, listed);
    } catch (e) {
      delete inbox.conversations[cid];
      throw e;
    }
  }

  /**
   * Writes conversation `cid`'s record within its share (O2) and the budget where it grows (W7), and sets what the inbox
   * shows of it from the record; the inbox is the caller's to write. Every write first trims the conversation's own
   * oldest messages down to CONVERSATION_SHARE_BYTES, whatever the budget, sparing the user's own waiting ones and
   * `keep`; where those alone keep it above, a take's write (`take`) is refused, its message dropped and counted, and a
   * press's goes through. Throws MessagingFull, writing nothing, when it can't fit the budget (but for bookkeeping, which
   * makes room best effort and is never refused for the budget); and where the area's reserve can't hold the write with
   * the room made for it, nothing is deleted for it either (f3). A browser that refuses the record's own write, or a
   * stop, after the room was made leaves the oldest read messages that made it gone, as the budget would delete them
   * next. `keep`: the entry this write is for, which no trim of its own deletes: a message never pays for its own room
   * (W11). `alsoGrows`: what a write right after it grows the area by (the inbox that lists a new one).
   */
  private async writeFile(
    network: NetworkName,
    inbox: Inbox,
    cid: string,
    file: ConversationFile,
    kind: WriteKind = "content",
    keep?: number,
    alsoGrows = 0,
    take = false,
  ): Promise<void> {
    const meta = inbox.conversations[cid]!;
    let stored = fileToStored(file);
    let bytes = sizeOf(stored);
    const share = this.deps.shareBytes ?? CONVERSATION_SHARE_BYTES;
    if (bytes > share) {
      bytes = trimToShare(file, meta, keep, share);
      stored = fileToStored(file);
      if (bytes > share && take) throw new MessagingFull();
    }
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
   * Sets what the inbox shows of the writer's share from `file` (W17, `shareOf`): an initiator's, before a reply the
   * thread shows (a share held for one it doesn't, O4). A record the crate can't read says none.
   */
  private noteShare(meta: Meta, file: ConversationFile): void {
    let share: ShareLeft | undefined;
    try {
      share = shareOf(shareInfoOf(this.info(file.state), meta, file), file.history);
    } catch (e) {
      if (e instanceof WalletLocked) throw e;
    }
    if (share) meta.firstContactLeft = share;
    else delete meta.firstContactLeft;
  }

  /**
   * Writes a conversation's record, then the outbox record with what this write made pending (`added`, round 5), then
   * the inbox with what it shows of it: the record's write is `kind`'s (a message made or taken: `content`; a post
   * marked, bytes sent again, a check's outcome: `bookkeeping`), and the inbox's after it bookkeeping, since it only
   * says what the record now holds. `keep`, `take`: as `writeFile`'s. An outbox append that fails is noted in memory
   * and posted from there (f4). An inbox write that fails after the record's is noted (f4), and the entry set right at
   * the take's next bookkeeping write: it's thrown again, but for a press of the user's (`press`) whose record now holds
   * its message, which then succeeds; a lock or a trap is thrown all the same.
   */
  private async commit(
    network: NetworkName,
    inbox: Inbox,
    cid: string,
    file: ConversationFile,
    kind: WriteKind = "content",
    keep?: number,
    press = false,
    added: readonly Entry[] = [],
    take = false,
  ): Promise<void> {
    await this.writeFile(network, inbox, cid, file, kind, keep, 0, take);
    const adding = added.filter((e) => e.sent === "pending" && e.envelope).map((e) => ({ cid, id: e.id, envelope: e.envelope! }));
    if (adding.length) {
      try {
        await this.appendOutbox(network, adding);
      } catch (e) {
        if (e instanceof WalletLocked || isTrap(e)) throw e;
        // No room for it there: posted from memory all the same, under this phrase alone (`noteWaiting`), and the next
        // first window writes it again.
        await this.noteWaiting(network, adding);
      }
    }
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
   * Seals a record of `network`'s (W7, W11): the area's reserve looked at first, then the seal in the wallet's queue,
   * admitted (`admitted`, round 5), as `rawPut` does at once. Turned away, the reserve is looked at again.
   */
  private async put(network: NetworkName, name: RecordName, value: unknown, kind: WriteKind, growth: number, after?: RoomsAfter): Promise<void> {
    return this.admitted(
      (admit) => this.rawPut(network, name, value, kind, growth, after, true, admit),
      async () => {
        if (kind !== "fixed" && growth > 0 && !(await this.reserveHolds(growth, after))) throw refusedFor(kind);
      },
    );
  }

  /**
   * Seals a record of `network`'s (W7, W11), at once. A write that grows storage by `growth` bytes leaves the area's
   * reserve free first, the rooms counted as taken (O5; `after`: what this write leaves its own room's record at). A
   * write the reserve or the browser refuses (its quota, or otherwise) isn't made: ReserveReached for bookkeeping, which
   * stops the take where the take made it; MessagingFull otherwise. A `fixed` write (the read record, a mark, an outbox
   * that only shrinks) is never looked at against the reserve. `checked`: its caller looked already (`put`). `admit`: the
   * seal's own check, outside a lane (`admitted`, `chained`): NotAdmitted as it is.
   */
  private async rawPut(
    network: NetworkName,
    name: RecordName,
    value: unknown,
    kind: WriteKind,
    growth: number,
    after?: RoomsAfter,
    checked = false,
    admit?: Admit,
  ): Promise<void> {
    void network;
    if (!checked && kind !== "fixed" && growth > 0 && !(await this.reserveHolds(growth, after))) throw refusedFor(kind);
    try {
      await this.deps.store.set(name, value, admit);
    } catch (e) {
      if (e instanceof WalletLocked || e instanceof NotAdmitted || isTrap(e)) throw e;
      throw refusedFor(kind);
    }
  }

  /**
   * Whether the storage area keeps its reserve free with `growth` bytes more (W11): chrome.storage.local's own count, the
   * wallet's other records and payments' included, and the rooms counted as taken (O5, `roomsHeld`). True where it
   * can't be counted.
   */
  private async reserveHolds(growth: number, after?: RoomsAfter): Promise<boolean> {
    const used = await this.deps.bytesInUse?.().catch(() => undefined);
    if (used === undefined) return true;
    const held = await this.roomsHeld(after);
    return used + growth + held <= (this.deps.quotaBytes ?? QUOTA_BYTES) - (this.deps.reserveBytes ?? RESERVE_BYTES);
  }

  /**
   * What the rooms hold back that they don't hold yet (O5), for each network whose Messages is on: the requests' room
   * (REQUESTS_ROOM_STORED) and the take room (TAKE_ROOM_BYTES, as stored) less what their records take now, and the
   * inbox's take-sized part at its most (`inboxLargest`) less what it takes now. Sizes from what this service last wrote,
   * or chrome.storage.local's count of each key, never a read of a value; an inbox not yet read this unlock is read once.
   * `after`: the sizes a write leaves its own record at.
   */
  private async roomsHeld(after?: RoomsAfter): Promise<number> {
    const switches = (await this.deps.preferences.get()).messaging;
    const takeRoom = storedBytes(this.deps.takeRoomBytes ?? TAKE_ROOM_BYTES);
    let held = 0;
    for (const n of this.networks()) {
      if (!switches[n]) continue;
      const mine = after?.network === n ? after : undefined;
      const requests = mine?.requests ?? this.requestsBytes.get(n) ?? (await this.storedSize(requestsRecord(n)));
      const takes = mine?.takes ?? (this.takes.get(n)?.stored ? this.takes.get(n)!.bytes : await this.storedSize(takeRecord(n)));
      const inbox = mine?.inbox ?? (await this.inboxSizes(n));
      held += Math.max(0, REQUESTS_ROOM_STORED - requests) + Math.max(0, takeRoom - takes) + Math.max(0, inbox.largest - inbox.bytes);
    }
    return held;
  }

  /** `network`'s inbox as stored and at its most (`inboxLargest`): as last read or written, else read once. */
  private async inboxSizes(network: NetworkName): Promise<{ bytes: number; largest: number }> {
    await this.sizesNow();
    let known = this.sizes.get(network);
    if (known?.largest === undefined) {
      await this.totalOf(network, true);
      known = this.sizes.get(network);
    }
    return { bytes: known?.inbox ?? 0, largest: known?.largest ?? 0 };
  }

  private budget(): number {
    return this.deps.budgetBytes ?? MESSAGES_BUDGET_BYTES;
  }

  /** Forgets what records take, as kept, once the wallet has unlocked again: another phrase's may be there now. */
  private async sizesNow(): Promise<void> {
    const at = await this.stampNow();
    if (at === this.sizesAt) return;
    this.sizes.clear();
    this.requestsBytes.clear();
    this.sizesAt = at;
  }

  /** Notes what `network`'s inbox takes now, as just written: kept only once the whole of it is known (`totalOf`). */
  private noteSize(network: NetworkName, part: { total: number; inbox: number; lean: number; largest: number }): void {
    const known = this.sizes.get(network);
    if (known) Object.assign(known, part);
    else this.sizes.set(network, { ...part });
  }

  /**
   * What every Messages record of every network would take as stored, as the budget counts it (W7, W11): the inboxes,
   * lean, and every conversation's record. `network`'s from `inbox` as it is in memory, with its own lean size `lean` or
   * conversation `cid`'s `bytes` in place of what's kept, and the others' as they were last read or written.
   */
  private async totalWith(network: NetworkName, inbox: Inbox, given: { lean?: number; cid?: string; bytes?: number }): Promise<number> {
    let total = given.lean ?? sizeOf(inboxToStored(leanOf(inbox)));
    for (const [cid, meta] of Object.entries(inbox.conversations)) total += cid === given.cid ? given.bytes! : meta.bytes;
    for (const other of this.networks()) if (other !== network) total += await this.totalOf(other);
    return total;
  }

  /**
   * What `network`'s Messages records take as the budget counts them, as last read or written: read once when not known
   * (or, `largest`, when its inbox at its most isn't known either).
   */
  private async totalOf(network: NetworkName, largest = false): Promise<number> {
    const known = this.sizes.get(network);
    if (known && (!largest || known.largest !== undefined)) return known.total;
    let sizes: { total: number; inbox: number; lean: number; largest?: number };
    try {
      const inbox = await this.inbox(network);
      const stored = (await this.storedSize(`messaging.${network}`)) > 0;
      const lean = stored ? sizeOf(inboxToStored(leanOf(inbox))) : 0;
      const bytes = stored ? sizeOf(inboxToStored(inbox)) : 0;
      sizes = { inbox: bytes, lean, total: lean + conversationBytes(inbox), largest: stored ? this.inboxLargest(inbox) : this.inboxLargest(emptyInbox()) };
    } catch (e) {
      if (!(e instanceof UnreadableRecordError)) throw e;
      // An inbox that won't open: what its records take as they're stored, by their sealed lengths.
      const keys = [`messaging.${network}` as RecordName, ...(await this.deps.local.keys(PRIVATE_PREFIX + CONVERSATION_RECORDS + network + ".")).map((k) => k.slice(PRIVATE_PREFIX.length) as RecordName)];
      let total = 0;
      for (const key of keys) total += await this.storedSize(key);
      sizes = { inbox: 0, lean: 0, total, largest: 0 };
    }
    this.sizes.set(network, sizes);
    return sizes.total;
  }

  /**
   * Frees at least `over` bytes of what Messages stores, by deleting old messages (W7): first `writing`'s own, down to
   * the conversation's share, then, again and again, the oldest of whichever record a trim frees the most from, read
   * messages before unread, over every conversation on every network. A message still to be posted stays, as does one
   * the server refused whose bytes are kept to send again (fix item 9), and nothing is deleted for bytes no deletion
   * frees (the crate's state with its skipped keys, the outbox, those kept bytes, requests): a record's
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

  private constantsOfOrDefault(): { firstContactMaxAge?: number; maxRequests?: number } {
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
   * Refuses a press that would write, seal or solve on a network Messages isn't open on (networks.ts
   * `MESSAGING_NETWORKS`; 1.10.0's second review): start, start again, continue, send, send again, Show my Seedelf and
   * accept, in the switch's own words, before anything else, so no chain is read for it, no record is touched and no
   * stamp is solved there, whoever asks. What a development build left on such a network is still read, named and
   * deleted. A network that's open with its switch off is as it was: what's written waits.
   */
  private openHere(network: NetworkName): void {
    if (this.deps.preferences.messagingOpen(network)) return;
    throw new Error(t("worker.messaging.notOpenHere", { network: NETWORKS[network].label }));
  }

  /**
   * Refuses a conversation just made (a start's, a continuation's) whose ID the wallet already holds on its network
   * (1.10.0's second review): as a conversation, as a request the inbox lists, or as a tombstone, one deleted here
   * that the inbox still remembers. A new conversation's ID, its keys and its first message's salt are all drawn, its
   * t is rounded down to ten minutes and its stamp is searched from 0: a random source that repeats (stuck, or a
   * snapshot restored twice) hands a second press in the same ten minutes the first one's conversation, and its first
   * message would be sealed under the first's key and nonce with another text. So the press is refused before anything
   * of the new one is listed, written, stamped, sealed or shown, in the crate's own words: `invalid_state`, its
   * inbox's for an ID it holds (`Inbox::insert`), and `deleted`, a tombstone's. What the wallet held is untouched.
   * `conversation`: the new one's record (hex), which the tombstones are asked with.
   */
  private refuseHeld(inbox: Inbox, cid: string, conversation: string): void {
    if (inbox.conversations[cid] !== undefined || inbox.requestsShown[cid] !== undefined) throw new MessagingRefused("invalid_state");
    if (this.tombstoned(inbox, cid, conversation)) throw new MessagingRefused("deleted");
  }

  /**
   * Whether `inbox`'s tombstones hold `cid`, the ID of `conversation` (a record just made, hex). Asked of the crate,
   * which keeps each ID once: deleting the new conversation from an inbox of it and the tombstones alone adds its ID
   * where it isn't held, and their record grows by one; where it is, the record keeps its length. Nothing of the
   * answer is kept. False where it can't be known: no tombstones, or a record the crate doesn't read (dropped where
   * the take or a deletion next meets it, `setAside`).
   */
  private tombstoned(inbox: Inbox, cid: string, conversation: string): boolean {
    const tombstones = inbox.tombstones;
    if (tombstones === undefined) return false;
    const asked = JSON.stringify({ cid, conversation, tombstones });
    const after = this.tryOr(() => {
      const answer = this.parse<{ deleted: boolean; tombstones: string }>(this.wasmCall(() => this.deps.wasm.messagingDelete(asked)));
      return isRefused(answer) || !answer.deleted ? undefined : answer.tombstones;
    }, undefined);
    return after !== undefined && after.length === tombstones.length;
  }

  /**
   * `task` with the Seedelf key, in the wallet's queue, admitted (`admitted`, round 5): throws if locked. A read of
   * storage the wallet makes before the task, of its session, fails as StorageFailed (f2); what the task throws is its
   * own.
   */
  private async withKey<T>(task: (key: Wasm.SeedelfKey, keys: Parameters<PhrasePin>[0]) => T): Promise<T> {
    return this.admitted((admit) => this.laneKey(task, admit));
  }

  /**
   * `task` with the Seedelf key, in the wallet's queue at once: a lane's (its phrase pin, its scan). `admit`: a chain's
   * own call outside a lane (`chained`), turned away as its turn comes while a lane runs or a tick is near.
   */
  private async laneKey<T>(task: (key: Wasm.SeedelfKey, keys: Parameters<PhrasePin>[0]) => T, admit?: Admit): Promise<T> {
    let ran = false;
    try {
      return await this.deps.wallet.withKeys((keys) => {
        ran = true;
        return task(keys.seedelf, keys);
      }, admit);
    } catch (e) {
      throw ran ? e : failedRead(e);
    }
  }

  /**
   * `call` into the wallet's queue for anything but a lane (round 5): the runner's, a press's, a screen's. Once the gate
   * opens, and with the admit check (`admit`), which the wallet looks at as the call's turn in its queue comes, and again
   * after its state's reads, right before the call runs (`Wallet.withKeys`). Where a lane has started, or a tick come
   * within TAKE_MARGIN_MS, while it waited there (behind another feature's long task, say), it gives the queue back
   * without running and waits at the gate again. So no such call runs in a lane, or just before a tick, whatever was
   * queued before it: only one already running as a lane starts off the grids can meet it. `prepare`: what the call
   * needs made ready (the area's read a `got` unseals, the reserve a `put` looks at), its answer `call`'s: after each
   * pass of the gate, never before it (1.10.0's second review, F5), so a call turned away waits at the gate again
   * before it prepares again, and no record whose size an envelope sets is read from the area, or counted, from a tick
   * to its lane's end. Never awaited inside a lane, nor inside a chain a lane joins (`chained`).
   *
   * And it belongs to the unlock it was asked under (1.10.0's second review, round 7): the one its call in the queue
   * was asked under (`serial`), or, outside one, the one there as it began, by the wallet's count of its opens
   * (`Wallet.opened`, read with no turn of its queue). The wait at the gate can be long, a slow relay's whole run of
   * requests: the wallet locked, removed and another phrase restored inside it, a write that went on would seal one
   * wallet's record under the next one's key, in its storage. So the count is looked at after each pass of the gate,
   * before anything is prepared, and again inside the call's own turn of the wallet's queue, right before it runs
   * (`admit`): another count, a lock and an unlock of the same phrase included, and the call is refused as a locked
   * wallet refuses, nothing read, unsealed or written for it. `now`: a question of the wallet as it is now, which
   * writes nothing (which unlock, whose keys, locked or not): never refused for an unlock that ended.
   */
  private async admitted<T, P = undefined>(call: (admit: Admit, prepared: P) => Promise<T>, prepare?: () => Promise<P>, now = false): Promise<T> {
    const began = this.task ? this.task.opened : this.opened();
    const ended = () => !now && this.opened() !== began;
    for (;;) {
      await this.gate();
      if (ended()) throw new WalletLocked(t("worker.wallet.locked"));
      const prepared = (prepare ? await prepare() : undefined) as P;
      // Turned away in its own turn for the unlock, not for a lane: it never comes back to the gate.
      let over = false;
      try {
        return await call(() => !(over = ended()) && this.admit(), prepared);
      } catch (e) {
        if (over) throw new WalletLocked(t("worker.wallet.locked"));
        if (!(e instanceof NotAdmitted)) throw e;
        this.deps.observe?.("yield");
      }
    }
  }

  /** The wallet's count of its opens now (`Wallet.opened`): undefined for a wallet that keeps none. */
  private opened(): number | undefined {
    return (this.deps.wallet as { opened?: number }).opened;
  }

  /**
   * Throws as a lock does where the call running in the queue was asked under an unlock that has ended (`task`):
   * `admitted`'s look, for what a call removes with no key, which no turn of the wallet's queue guards.
   */
  private mine(): void {
    if (this.task && this.opened() !== this.task.opened) throw new WalletLocked(t("worker.wallet.locked"));
  }

  /** The admit check of everything but a lane's calls into the wallet's queue (`admitted`): no lane runs, no tick is near. */
  private readonly admit: Admit = () => !this.laneRunning() && !this.tickNear();

  /**
   * `task` in a chain a lane joins too (the read record's, the outbox's), for anything but a lane: once the gate opens,
   * and with the admit check, looked at as its turn in the chain comes and passed on to each of its calls into the
   * wallet's queue. Turned away, it leaves the chain at once (NotAdmitted), so a lane's write behind it never waits for
   * the gate, and joins it again once the gate opens: `task` must be one that can run again from its start, and nothing
   * in it waits for the gate.
   */
  private chained<T>(chain: Map<NetworkName, Promise<unknown>>, network: NetworkName, task: (admit: Admit) => Promise<T>): Promise<T> {
    return this.admitted((admit) =>
      this.onChain(chain, network, async () => {
        if (!admit()) throw new NotAdmitted();
        return task(admit);
      }),
    );
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

  /** Runs `task` in the background, its failure its own: a stamp, a post, the runner. */
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

  /**
   * Runs `task` after every earlier state change, once the gate opens (round 5): the presses', the screens' reads and
   * the runner's steps. Never a lane's.
   */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    // The unlock it's asked under, as it's asked, with no read: what waits here for the queue and the gate is still
    // that unlock's when its turn comes, or it reads and writes nothing (`admitted`).
    const asked = { opened: this.opened() };
    const gated = async () => {
      await this.gate();
      this.task = asked;
      try {
        return await task();
      } finally {
        this.task = undefined;
      }
    };
    const run = this.queue.then(gated, gated);
    this.queue = run.catch(() => undefined);
    return run;
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
 * The fewest of `file`'s oldest messages, read ones before unread, never one still to be posted, nor one the server
 * refused whose bytes are kept for the user to send again (relay-oracle fix item 9), whose deletion takes its stored
 * size down one power of two, beside those `drop` already plans away; with that size. Undefined when no deletion can
 * (the record holds too little else, or is at the smallest size).
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
  // The user's own bytes: waiting to be sealed or posted, or refused by the server and kept to send again (`resend`).
  const deletable = kept.filter((e) => e.sent !== "queued" && e.sent !== "pending" && !(e.sent === "refused" && e.envelope) && e.id !== keep);
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
 * points, so a cut never splits one; and what its row must say of the user's own messages (`unsentOf`). None once the
 * budget has deleted every message.
 */
export function lastOf(history: readonly Entry[]): Meta["last"] {
  const entry = history.at(-1);
  if (!entry) return undefined;
  const unsent = unsentOf(history);
  const state = unsent ? { unsent } : {};
  if (entry.kind === KIND_REVEAL) return { dir: entry.dir, reveal: true, ...state };
  if (entry.text === undefined) return { dir: entry.dir, ...state };
  const chars = [...entry.text];
  return { dir: entry.dir, text: chars.length > PREVIEW_CHARS ? `${chars.slice(0, PREVIEW_CHARS).join("")}…` : entry.text, ...state };
}

/**
 * What a conversation's row says of the user's own messages where its last message's text, or "Sending…", would say
 * otherwise (the 1.10.0 gate's blind reading: a refused message's row read "You: …", as if it went).
 *
 * `refused`: the last message is the user's and ended unsent, refused by the server or by the wallet's own crate
 * (`Entry.sent`). One the other side's message came after is in the thread, and the row says that message.
 *
 * `reply`: there are messages waiting, and every one waits for a reply: queued behind a message already past its
 * stamp, with none being posted. The thread says "waiting for a reply" of each by the same rule (Messages.tsx
 * `MessageList`): one still queued after a message of the user's that isn't.
 */
function unsentOf(history: readonly Entry[]): NonNullable<Meta["last"]>["unsent"] {
  const last = history.at(-1);
  if (last?.dir === "out" && last.sent === "refused") return "refused";
  const waiting = history.filter((e) => e.dir === "out" && (e.sent === "queued" || e.sent === "pending"));
  if (!waiting.length || waiting.some((e) => e.sent === "pending")) return undefined;
  const first = history.indexOf(waiting[0]!);
  const sealed = history.slice(0, first).some((e) => e.dir === "out" && e.sent !== undefined && e.sent !== "queued");
  return sealed ? "reply" : undefined;
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
