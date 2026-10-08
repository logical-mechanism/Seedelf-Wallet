// The dApp connector (CIP-30) in the worker, for the public account or a
// site's private session. The content scripts (shared/dapp.ts) bring each
// site's calls here, with the site's origin as Chrome reports it.
//
// Connecting  A site calls `enable()`; the connector's window asks the user
//             (unlocking first if need be). Connected sites are a sealed
//             private record (`dapps`), per network: which sites you use
//             says something about you. With each, the page's title as it
//             asked, the site's own words, shown after its address as the
//             window shows them (blind test E03). The dApps page and Settings
//             list them, to disconnect. A disconnected site's next call is
//             refused (CIP-30's Refused, which is how CIP-30 says a wallet
//             disconnected): CIP-30 has no event to tell an open page sooner,
//             so the lists say such a page may still look connected.
// Networks    Each call is on the network the wallet is on as it's made
//             (Settings switches it): `getNetworkId` says which, and a site
//             connected on one isn't on the other. What sites were asking
//             on the network the wallet left is declined (`networkChanged`).
//             So is a signature waiting when Settings chooses another dApp
//             account, with CIP-30's AccountChange: it was checked for the
//             account it left (`dappAccountChanged`, chunk 25).
// Locked      Nothing a site hears changes at the moment of an unlock unless
//             it asked for it (privacy review §2.11). `isEnabled()` answers
//             whether it's connected, as last read. Which sites are is
//             sealed, so a read is refused at once as a stranger's is ("call
//             enable()"), and never opens the window: a site that isn't
//             connected learns nothing, and can't bring the window up by
//             reading. `enable()`, a signature and a send open the window to
//             unlock first, which names the sites waiting. Closing it without
//             unlocking declines them, and that site's signatures and sends
//             are refused without asking for a while (`REFUSE_MS`), so a dApp
//             that asks again and again doesn't keep opening it: in the words
//             a site that isn't connected hears unlocked, so they say nothing
//             of the lock (independent review L36).
//             A site that isn't connected asks to connect once at a time:
//             another of its pages' `enable()` has that one's answer. Once
//             the user says no, or closes the window on it, its `enable()` is
//             declined unasked for a while, locked or not, in words that say
//             when it can ask again: 10 s the first time, so a user who
//             cancelled by mistake isn't shut out, and longer each time after
//             (chunk 23's second review, CW-3). The wallet's pages say it too:
//             the connect question says how long Decline turns the site away
//             (`declineWaitMs`), and the dApps page and Connected sites list
//             the sites waiting it out (`declined`), whether they asked again
//             meanwhile, with Let it ask now (`letAsk`), which only the user
//             can press (blind test §9.2, T17r). The refusals outlast the
//             worker, which Chrome stops when idle: they're kept in session
//             storage (`SESSION_DAPP_REFUSED`). Each site has at
//             most 5 requests waiting at once, of the window's 20
//             (independent review L35); its pages' `enable()` calls waiting
//             for the unlock count once, as they'll share one question.
// Reading     The account as `readAccountUtxos` finds it (two Koios
//             requests), kept 30 s under the dApp account it is, so a change
//             in Settings never answers a site from the one it left: less
//             what the user locked on that account and its collateral
//             (`getCollateral` gives that one), plus what it gets back from
//             dApp transactions it sent that aren't on chain yet, less what
//             they spent.
// Signing     `signTx` reads what the transaction does in WebAssembly
//             (`inspectDappTx`) and shows it; only an approval signs, with
//             the account's keys that it needs. With `dappPassword` on (the
//             default), Sign needs the password too, even while unlocked
//             and even right after an unlock: a wrong one leaves the request
//             waiting and counts towards the unlock back-off. WebAssembly
//             won't have a payment key sign over an input nobody can find,
//             so the outputs of every transaction it signs are kept (the
//             account's for the last 32, every one for 20 minutes), and of
//             each a site sends through it, for that site; and the wallet's
//             own sends' on that network (sent-txs.ts) that pay the site's
//             account: a dApp can build its next transaction on them before
//             they're on chain. Nothing else the wallet sent is answered
//             from what it kept: that would tell a site it was the wallet's.
//             What the user locked, and the collateral, stay out of a site's
//             transaction as out of the wallet's own: one that uses them is
//             refused (`keptApart`), and so is one that uses what the site's
//             own account's Lovejoin chain still being sent needs
//             (`heldForLovejoin`): the public account's, or the session's.
//             Another's is left to the stranger's path, never named.
//             `signData` is CIP-8, with the address's key.
// Governance  CIP-95 (chunk 21): a site asks for it in `enable()`, and the
//             window says what it gives before the user agrees: the dApp
//             account's DRep key, to register its DRep and vote with it.
//             Granted, it's on the site's record (`cip95`): `getPubDRepKey`,
//             the stake key's public key (registered or not, one
//             `account_info`), and the DRep key signing the account's own
//             DRep certificates and votes, and data for the DRep. A site
//             without it is never told the DRep key, and WebAssembly treats
//             that key as a stranger's for it. A private session has no DRep.
// Sending     `submitTx` goes through Koios, as the wallet's own sends do,
//             and what it spends is remembered (spent.ts), apart from what
//             the wallet spent itself. One already on chain, sent again, is
//             a success, and leaves nothing behind. One Koios didn't answer
//             for may land: it's kept as sent, looked for and sent again a
//             few times, and the site hears its id, never that it failed;
//             and its id again when it sends it once more, meanwhile or
//             while the wallet keeps it as sent.
// Limits      What a site asks for without the user costs the wallet little:
//             calls at the same time share one reading of the account; a
//             site gets a few fresh readings, UTxO lookups and submits a
//             minute (`PER_MINUTE`) and 32 calls running at once; and a
//             transaction or data over 64 KiB, an amount over 8 KiB or an
//             address longer than any Cardano's is refused unread. Its
//             transactions are read one at a time, a few a minute that the
//             user is never asked about, and none while the window's queue is
//             full: WebAssembly's reading takes up to half a second, in the
//             wallet's one queue, which the user's own requests and Lock wait on.
//             WebAssembly that traps under a site's call, or as the user
//             approves it, locks the wallet (`answerSite`, `answer`), as
//             under the wallet's own pages.
// Private     A site can connect to a private session instead (chunk 15c,
//             private CIP-30): a one-time account funded from the private
//             balance (sessions.ts), chosen in the window. The funding is
//             built and sent from the window, and `enable()` answers once
//             Koios sees the money. Every call then reads and signs that
//             account, with the session's keys (its stake key `2/i` too):
//             the site sees an ordinary wallet, and never the public account.
//
// What sites wait for is kept in memory: a restarted worker has dropped the
// sites' ports too, so there's nothing to answer. The bridge's pings keep the
// worker running while the user reads a prompt. Disconnecting a site
// declines what it waits for, and turning the connector off, or removing the
// wallet, declines everything; an approval checks again that the site is
// still connected to the account it asked of, and what Lovejoin and the
// user's locks keep apart (independent review L33).

import { t } from "../i18n";
import type { NetworkName } from "../networks";
import {
  APIError,
  DataSignError,
  READ_METHODS,
  TxSendError,
  TxSignError,
  type DappFailure,
  type DappMethod,
} from "../shared/dapp";
import type {
  DappApproval,
  DappAsk,
  DappDeclined,
  DappSite,
  DappTxSummary,
  RefusedBy,
  ReplyCode,
  SessionOutSummary,
  TokenQuantity,
} from "../shared/rpc";
import { readAccountUtxos, type AccountDeps, type KeyPath, type PathedUtxo } from "./account";
import { SESSION_ACCOUNT_ADDRESSES_PREFIX, type AccountAddresses } from "./activity";
import { bodyOutpoints, certificateKinds, nestsWithin, txId } from "./cbor";
import { GAP_LIMIT } from "./chain";
import type { CoinControlService } from "./coin-control";
import { CollateralRefusedError, refusedBy, StaleReviewError } from "./collateral";
import { KoiosBusyError, KoiosError, SpentInputError, type Koios, type KoiosUtxo } from "./koios";
import { chainOwner } from "./lovejoin";
import type { PreferencesService } from "./preferences";
import type { PrivateStore } from "./private-store";
import { recentlySent, SENT_KEEP_MS } from "./sent-txs";
import { SESSION_COLLATERAL, type SessionService } from "./sessions";
import { outpoint, rememberSiteSpent, reservedSet, SPENT_KEEP_MS, spentSet, wait } from "./spent";
import { SESSION_BALANCES_PREFIX, SESSION_DAPP_REFUSED, SESSION_PRIVATE_STALE_PREFIX, WASM_BROKEN, type Keys } from "./wallet";
import { isTrap } from "./wasm";

/** chrome.storage.session, per network: the account as the connector last read it. */
export const SESSION_DAPP_VIEW = "seedelf.dapp.view.";
/** chrome.storage.session, per network: the account's outputs of the transactions it signed for sites. */
export const SESSION_DAPP_SIGNED = "seedelf.dapp.signed.";

/** How long a reading of the account answers sites. */
const VIEW_MS = 30_000;
/** How many signed transactions' outputs are kept for chaining (Lace keeps 32). */
const KEEP_SIGNED = 32;
/** A submitted transaction's outputs count in the balance until they're on chain, or this long. */
const INFLIGHT_MS = 10 * 60_000;
/** A signed transaction's outputs can be spent by the site's next one for this long, as the wallet's own sends' (sent-txs.ts). */
const CHAIN_MS = SENT_KEEP_MS;
/** Of a signed transaction's outputs, this many are kept for that. */
const MAX_CHAINED = 64;
/**
 * After the window is closed while locked, a site's signatures and sends are
 * refused for this long, unasked; and after the user declines a site's
 * connect, or closes the window on it, its `enable()` is. The first refusal
 * is short: a flat minute left a user who cancelled by mistake clicking
 * Connect on a site that silently did nothing (chunk 23's second review,
 * CW-3). Each one after it, within `REFUSE_RESET_MS` of the last, is longer,
 * so a dApp that asks again the moment it's refused still can't keep the
 * window coming back (independent review L35).
 */
const REFUSE_MS = [10_000, 60_000, 5 * 60_000] as const;
/** A site not refused for this long since its last refusal ended starts again at the first, shortest one. */
const REFUSE_RESET_MS = 10 * 60_000;
/** At most this many calls from sites wait for the user at once. */
const MAX_WAITING = 20;
/** Of those, at most this many from one site: one can't fill the window's queue for the rest. */
const MAX_SITE_WAITING = 5;
/** How often a private session's funding is looked for, once it's sent. */
const FUNDING_POLL_MS = 10_000;
/** A funding Koios hasn't seen after this long never reached the chain. */
const FUNDING_WAIT_MS = 20 * 60_000;
/** CIP-30 caps collateral at 5 ₳. */
const MAX_COLLATERAL = 5_000_000n;
/**
 * The most of a site's bytes the wallet reads: a transaction to sign or send,
 * or data to sign. Four times Cardano's 16 KiB transaction limit, room for a
 * raise, as the WebAssembly's own check.
 */
const MAX_SITE_BYTES = 65_536;
/**
 * The longest amount a site may ask `getUtxos` or `getCollateral` to cover,
 * in hex: a CIP-30 Value naming far more tokens than any balance holds.
 * Reading a longer one could run WebAssembly out of memory (independent
 * review M15), so it's refused unread, as a transaction over 64 KiB is.
 */
const MAX_AMOUNT_HEX = 16_384;
/** The longest address a site may ask `signData` to sign for: a Cardano address is under 128 bytes. */
const MAX_ADDRESS_CHARS = 512;
/** At most this many of one site's calls run at once, all its pages together; more are refused. */
const MAX_SITE_CALLS = 32;
/**
 * What one site may make the worker ask Koios for, per minute, with nobody
 * asked: a fresh reading of the account (a transaction spends a UTxO the kept
 * one hasn't got), a lookup of UTxOs the account doesn't hold, a submit. A
 * site asking for more would use up the wallet's own share of Koios. And how
 * many of its transactions WebAssembly reads that are refused without asking
 * the user (`unprompted`: nothing to sign, or unreadable): each can take half
 * a second of the wallet's queue. Those put in front of the user never count.
 */
const PER_MINUTE = { fresh: 4, lookup: 6, submit: 10, unprompted: 20 } as const;
/**
 * A site's transaction Koios didn't answer for may be on its way: it's
 * looked for, and sent again, this many times, this far apart, before the
 * site hears its id (`submitTx`).
 */
const SUBMIT_CHECKS = 3;
const SUBMIT_CHECK_MS = 5_000;
/**
 * Words for a site's error, in either language: English (`lng` "en") is what
 * the site hears, whatever language the wallet is in, as bridge.ts's own
 * words are. CIP-30's `info` is for the dApp's developer, and in the user's
 * language it would tell any https page, connected or not, which one the
 * wallet is set to (the release review). Without `lng`, the user's language,
 * for the connector's window when it shows the same error.
 */
type Words = (lng?: "en") => string;

/** What a site hears when the window's queue is full. */
const BUSY: Words = (lng) => t("dapp.busy", { lng });

/** A CIP-30 error: `failure` as the site hears it, and `shown`, its words in the user's language for the window. */
export class DappError extends Error {
  constructor(
    readonly failure: DappFailure,
    shown?: string,
  ) {
    super(shown ?? ("info" in failure ? failure.info : t("dapp.pageOutOfRange", { max: failure.maxSize })));
  }
}

/** An error with CIP-30's `code`, in English for the site and in the user's language for the window. */
const siteError = (code: number, words: Words) => new DappError({ code, info: words("en") }, words());
const refused = (words: Words) => siteError(APIError.Refused, words);
const invalid = (words: Words) => siteError(APIError.InvalidRequest, words);

/** A site's page, as its port reached the worker. */
export interface DappSession {
  id: string;
  origin: string;
  title?: string;
}

/** The connector's window: shown when a site needs the user. */
export interface ApprovalWindow {
  show(): Promise<void>;
  /** Whether it's still open. */
  isOpen(): Promise<boolean>;
  /** Closes it, if it's open. */
  close(): Promise<void>;
}

export interface DappDeps extends AccountDeps {
  coins: CoinControlService;
  preferences: PreferencesService;
  store: PrivateStore;
  /** Private sessions: a site connected to one reads and signs its account. */
  sessions: SessionService;
  /** The public accounts the wallet knows (accounts.ts): a session's signing prompt matches every one (`ties`). */
  knownAccounts?: () => Promise<number[]>;
  /** How often a private session's funding is looked for (tests: at once). */
  fundingPollMs?: number;
  /** The network the wallet is on now: the user's choice (Settings), read for each call. */
  network: () => NetworkName | Promise<NetworkName>;
  /**
   * Which public account the wallet works on (accounts.ts). Never what a site
   * is served or checked with: that's the dApp account (`dappAccount`), its
   * locks and collateral too.
   */
  activeAccount?: () => number | Promise<number>;
  now: () => number;
  window: ApprovalWindow;
  /** Tells the connector's window that what's waiting changed. */
  changed: () => void;
}

/** A site's private session: its one-time account, instead of the public account. */
interface SessionAccount {
  index: number;
  address: string;
  reward: string;
  keyHash: string;
}

/** Who a connected site talks to: the public account (none), or its private session. */
type Holder = SessionAccount | undefined;

/** Another of the wallet's accounts a site's transaction touches: the public account, or a private session by index. */
type Tie = "account" | number;

/** A connected site, as the sealed record keeps it. */
type Connected = DappSite & { network: NetworkName };

/** What the window answers beside Approve: for a connect that asked for it, whether governance goes with it. */
interface Answer {
  governance?: boolean;
}

/** A CIP-30 extension, as `enable()` and `getExtensions()` name it. */
type DappExtension = { cip: number };

/** Whether `params`, `enable()`'s argument, asks for CIP-95: CIP-30's `{ extensions: [{ cip: 95 }] }`. */
export function wantsGovernance(params: unknown): boolean {
  const extensions = (params as { extensions?: unknown } | null | undefined)?.extensions;
  return Array.isArray(extensions) && extensions.some((e) => (e as { cip?: unknown } | null)?.cip === 95);
}

/** Whether a site was given governance (CIP-95): only ever on the public account. */
const governed = (site: DappSite) => site.cip95 === true && site.session === undefined;

/** The extensions a site was given, as `getExtensions()` answers. */
const extensionsOf = (site: DappSite): DappExtension[] => (governed(site) ? [{ cip: 95 }] : []);

/** The account as the connector read it. */
interface View {
  keys: KeyPath[];
  utxos: PathedUtxo[];
  usedAddresses: string[];
  stake: string;
  readAt: number;
  /** Which public account it is: the dApp account it was read for. None for a private session's (`ofAccount`). */
  account?: number;
}

/**
 * A signed transaction's outputs, for chaining; or those of one a site sent
 * through the wallet that the wallet didn't sign (`origin`).
 */
interface Signed {
  txHash: string;
  /** Its outputs to the account: what the site may spend (`getUtxos`) until they're on chain. */
  outputs: PathedUtxo[];
  /** Every output, to the account or not, to read a transaction built on it while `signedAt` is recent. */
  every?: KoiosUtxo[];
  /** When it was signed, or, for one the wallet didn't sign, sent. */
  signedAt?: number;
  /** When a site sent it through the wallet. */
  submittedAt?: number;
  /** The site that sent it, when the wallet didn't sign it: only that site builds on it. */
  origin?: string;
  /**
   * The public account that signed it: only that account's sites are offered
   * its outputs, or build on it, once the dApp account changes. None for a
   * session's, or one kept before there were several (`ofAccount`).
   */
  account?: number;
}

interface Waiting {
  approval: DappApproval;
  session: DappSession;
  /** The network it was asked on: declined once the wallet moves to another (`networkChanged`). */
  network: NetworkName;
  /**
   * A public-side signature's: the dApp account its transaction or address
   * was read and checked for (`View.account`). Declined once Settings chooses
   * another (`dappAccountChanged`), and refused if approved after: the new
   * account's keys would sign what was inspected for the old one. None for a
   * connect, which no account is read for, or a private session's.
   */
  account?: number;
  /** Runs on Approve, with what the window chose beside it: governance for a connect (CIP-95). */
  approve: (answer: Answer) => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: DappError) => void;
  /** What the site hears when the user says no. */
  declined: DappFailure;
  /** Its page went away before the user answered (`gone`). */
  gone?: boolean;
  /**
   * A signature's transaction, hex: what the transaction view reads while the
   * user decides (tx-view.ts). Only here, never kept: closing the window drops
   * it with the request.
   */
  txCbor?: string;
  /**
   * How it ended, for another page of the same site asking to connect
   * meanwhile (`enable`): answered (undefined), what the site heard, or
   * "gone", when its page went away first.
   */
  settled?: Promise<DappError | "gone" | undefined>;
}

interface Unlocking {
  session: DappSession;
  /** An `enable()`: a site's take one place in the window's queue together (`unlockPlaces`). */
  enable: boolean;
  resolve: () => void;
  reject: (error: DappError) => void;
}

type SignedTx = { witnessSet: string; summary: DappTxSummary };

/**
 * A site refused unasked (`refuseFor`): until when, how many refusals in a
 * row, the network it was declined on (the lists show it there only), the
 * page's title as it asked, and whether it asked again meanwhile, which the
 * wallet's pages say once (`askedAgain`).
 */
interface Refusal {
  until: number;
  count: number;
  network?: NetworkName;
  title?: string;
  retried?: boolean;
}

/**
 * The sites refused unasked are kept in chrome.storage.session
 * (`SESSION_DAPP_REFUSED`, wallet.ts), by origin, with their waits, counts
 * and networks, never a page's title (`keepRefusals`). Chrome stops an idle
 * worker after about 30 s, and a refusal kept only in its memory went with
 * it: a minute's or five minutes' wait, which the wallet now states in
 * numbers, lasted until then, and the next decline started again at 10 s
 * (the blind test's cross-area review). Session storage is memory only and
 * kept from content scripts (storage-access.ts); a lock keeps them, as it
 * keeps the wallet's sends.
 */
export { SESSION_DAPP_REFUSED };

/**
 * A page's title as the wallet keeps it with its site: the site's own words,
 * so they're shown after its address, never instead of it; one line, 80
 * characters at most. With no direction or invisible format characters, as
 * governance.ts's `shownText`: one starting with U+202E reversed the origin
 * the windows show after it (the release review).
 */
function siteTitle(title?: string): string | undefined {
  const line = title
    ?.replace(/[\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
    .replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, " ")
    .trim();
  if (!line) return undefined;
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

const ALREADY_CONNECTED = () => t("dapp.connectedMeanwhile");
/** What a site that isn't connected hears, and, while the wallet is locked, every site that reads. */
const NOT_CONNECTED: Words = (lng) => t("dapp.notConnected", { lng });
/** What a site hears while the connector is off, and what it was waiting for hears once it's turned off. */
const OFF: Words = (lng) => t("dapp.connectorOff", { lng });
/** What a site's request hears once the site is disconnected while it waited. */
const DISCONNECTED: Words = (lng) => t("dapp.disconnected", { lng });
/** What a site hears when the user says no, or closed the window on it. */
const DECLINED: Words = (lng) => t("dapp.userDeclined", { lng });
/** What a site's call ends with once its page is gone: nobody hears it. */
const PAGE_GONE: Words = (lng) => t("dapp.pageGone", { lng });
/** What a site asking on the network the wallet left hears, and the window says. */
const NETWORK_LEFT: Words = (lng) => t("dapp.networkMoved", { lng });
/** What a site hears when the dApp account changed while its signature waited: CIP-30's AccountChange. */
const ACCOUNT_MOVED: Words = (lng) => t("dapp.accountMoved", { lng });
/** What a site that wasn't given governance hears when it asks for CIP-95's keys. */
const NO_GOVERNANCE: Words = (lng) => t("dapp.noGovernance", { lng });
/** What a site on a private session hears: a session has no DRep, so there's nothing to ask for. */
const NO_GOVERNANCE_SESSION: Words = (lng) => t("dapp.noGovernanceSession", { lng });
/** "the public account's" or "this private session's", for a sentence about whose keys sign. */
const whoseKeys = (holder: Holder, lng?: "en") => t(holder ? "dapp.whose.session" : "dapp.whose.account", { lng });

export class DappService {
  private readonly waiting: Waiting[] = [];
  private readonly unlocking: Unlocking[] = [];
  /**
   * Sites refused unasked until `until` (`refuseFor`), after the user declined
   * them or closed the window on them; `count`, the refusals in a row so far.
   */
  private readonly refusedUntil = new Map<string, Refusal>();
  /** The refusals an earlier worker kept, read once, before anything here uses them (`readRefusals`). */
  private refusalsRead?: Promise<void>;
  /** The last write of the refusals, which the next waits for, so the newest is the one kept. */
  private refusalsKept: Promise<unknown> = Promise.resolve();
  /** How many of each site's calls are running. */
  private readonly running = new Map<string, number>();
  /** When each site made the worker ask Koios, by what for (`PER_MINUTE`): the last minute's. */
  private readonly asked = new Map<string, number[]>();
  /** Readings of an account under way, by its storage key: calls at the same time share one. */
  private readonly reading = new Map<string, Promise<View>>();
  /** Each site's last transaction being read (`readInTurn`), which its next waits for. */
  private readonly txReads = new Map<string, Promise<unknown>>();
  /** Sites' transactions being sent (`submitTx`), by network, site and transaction id. */
  private readonly submitting = new Map<string, Promise<string>>();
  /** The last change to the `dapps` record, which the next waits for (`changeSites`). */
  private sitesQueue: Promise<unknown> = Promise.resolve();
  /** The worker is closing the connector's window (`closeWindow`), not the user. */
  private closing = false;
  /**
   * How many of each page's calls are running, by its session id; and the
   * pages that went away (`gone`) with some still running, until the last
   * of them ends. Nothing more is asked for those: one was reading a
   * transaction, say, or waiting on another page's connect question
   * (independent review L31, L35).
   */
  private readonly pageCalls = new Map<string, number>();
  private readonly gonePages = new Set<string>();
  /**
   * The sites connected on each network, as this worker last read or wrote
   * the sealed `dapps` record: in memory only, never stored. `isEnabled`
   * answers from it while the wallet is locked, when the record can't be
   * read. A worker started since has none.
   */
  private readonly lastSites = new Map<NetworkName, Set<string>>();

  constructor(private readonly deps: DappDeps) {}

  /** A site's call. Throws a `DappError` for the site. */
  async call(session: DappSession, method: DappMethod, args: unknown[]): Promise<unknown> {
    const { origin } = session;
    const running = this.running.get(origin) ?? 0;
    if (running >= MAX_SITE_CALLS) throw refused(BUSY);
    this.running.set(origin, running + 1);
    this.pageCalls.set(session.id, (this.pageCalls.get(session.id) ?? 0) + 1);
    try {
      await this.readRefusals();
      return await this.run(session, method, args);
    } finally {
      const left = (this.running.get(origin) ?? 1) - 1;
      if (left > 0) this.running.set(origin, left);
      else this.running.delete(origin);
      const page = (this.pageCalls.get(session.id) ?? 1) - 1;
      if (page > 0) {
        this.pageCalls.set(session.id, page);
      } else {
        this.pageCalls.delete(session.id);
        this.gonePages.delete(session.id);
      }
    }
  }

  private async run(session: DappSession, method: DappMethod, args: unknown[]): Promise<unknown> {
    const on = (await this.deps.preferences.get()).dappConnector;
    const { origin } = session;
    if (method === "isEnabled" && !on) return false;
    if (!on) throw refused(OFF);
    if (method === "isEnabled") return this.isEnabled(origin);
    if ((await this.deps.wallet.state()) !== "unlocked") {
      // Which sites are connected is sealed while locked: a read is refused
      // at once, as a stranger's is, and never opens the window. A connected
      // dApp hears to call enable(), which unlocks in the window.
      if (READ_METHODS.has(method)) throw refused(NOT_CONNECTED);
      await this.unlocked(session, method);
    }
    // The network the wallet is on as this call goes on: a site connected on
    // one isn't on the other, and what it asks is answered, and signed, there.
    const network = await this.deps.network();
    if (method === "enable") return this.enable(session, network, args[0]);
    const site = await this.site(network, origin);
    if (!site) throw refused(NOT_CONNECTED);
    const holder = await this.holder(network, site);
    const governance = governed(site);
    switch (method) {
      case "getNetworkId":
        return network === "mainnet" ? 1 : 0;
      case "getExtensions":
        return extensionsOf(site);
      case "getPubDRepKey":
        return this.drepKey(holder, governance);
      case "getRegisteredPubStakeKeys":
        return this.stakeKeys(origin, network, holder, governance, true);
      case "getUnregisteredPubStakeKeys":
        return this.stakeKeys(origin, network, holder, governance, false);
      case "getBalance":
        return this.balance(network, holder);
      case "getUtxos":
        return this.utxos(network, holder, args[0], args[1]);
      case "getCollateral":
        return this.collateral(network, holder, args[0]);
      case "getUsedAddresses":
        return paginate(await this.usedAddresses(network, holder), args[0]);
      case "getUnusedAddresses":
        return holder ? [] : this.unusedAddresses(network);
      case "getChangeAddress":
        return this.hexAddress(holder ? holder.address : await this.receiveAddress(network, 0));
      case "getRewardAddresses":
        return [this.hexAddress(holder ? holder.reward : (await this.view(network, undefined)).stake)];
      case "signTx":
        return this.signTx(session, network, holder, args[0], args[1] === true, await this.needsPassword(), governance);
      case "signData":
        return this.signData(session, network, holder, args[0], args[1], await this.needsPassword(), governance);
      case "submitTx":
        return this.submitTx(origin, network, holder, args[0]);
    }
    throw invalid((lng) => t("dapp.unknownMethod", { lng }));
  }

  // --- The user --------------------------------------------------------------

  /**
   * What sites wait for, oldest first. A connect question says how long
   * Decline, or closing the window, would turn its site away (`declineWaitMs`),
   * so the window can say it before either is done (blind test §9.2, T17).
   */
  approvals(): DappApproval[] {
    return this.waiting.map(({ approval: a, session }) =>
      a.kind === "connect" && !a.connected && !a.funding ? { ...a, declineWaitMs: this.nextRefusal(session.origin).ms } : a,
    );
  }

  /**
   * The user's answer to one; an approved one that fails says why, to the site
   * too. A signature that needs the password is checked first: a wrong or
   * missing one leaves it waiting, and the site hears nothing. `code`: a
   * private session's funding refused as stale, which the window builds
   * again (`fundPrivate`). `waitMs`: a connect declined, how long its site is
   * turned away, which the window says once it's answered (blind test T17).
   */
  async answer(
    id: string,
    approve: boolean,
    password?: string,
    fund?: { txHash: string },
    governance?: boolean,
  ): Promise<{ error?: string; code?: ReplyCode; by?: RefusedBy; waitMs?: number }> {
    const asked = this.waiting.find((w) => w.approval.id === id);
    if (!asked) return { error: t("dapp.stoppedWaiting") };
    // Turned off while it waited: nothing is connected, funded or signed (independent review L33).
    if (approve && !(await this.deps.preferences.get()).dappConnector) {
      this.connectorOff();
      return { error: OFF() };
    }
    const { approval } = asked;
    if (approval.kind === "connect" && approval.funding) return { error: t("dapp.alreadyFunded") };
    // Asked on the network the wallet has left: never signed or connected on the one it's on.
    if (asked.network !== (await this.deps.network())) {
      await this.networkChanged();
      return { error: NETWORK_LEFT() };
    }
    // Read for the dApp account Settings has since left: never signed with the one it's on (chunk 25).
    if (asked.account !== undefined && asked.account !== (await this.dappAccount())) {
      await this.dappAccountChanged();
      return { error: ACCOUNT_MOVED() };
    }
    // A signature, or a private session's funding, needs the password when the setting says so.
    const guarded = approval.kind === "connect" ? !!fund : true;
    if (approve && guarded && approval.password) {
      if (!password) return { error: t(approval.kind === "connect" ? "dapp.passwordToSend" : "dapp.passwordToSign") };
      try {
        await this.deps.wallet.checkPassword(password);
      } catch (e) {
        return { error: (e as Error).message };
      }
    }
    if (approve && fund && approval.kind === "connect") return this.fundPrivate(asked, fund.txHash);
    // The site may have gone while the password was checked.
    const i = this.waiting.indexOf(asked);
    if (i < 0) return { error: t("dapp.stoppedWaiting") };
    const [w] = this.waiting.splice(i, 1);
    this.deps.changed();
    if (!approve) {
      // A connected site the user won't give governance stays connected, and isn't asked again.
      if (approval.kind === "connect" && approval.connected) {
        await this.declineGovernance(w!.network, approval.origin);
        w!.resolve(true);
        return {};
      }
      // A site the user won't connect doesn't ask again for a while (independent review L35).
      const waitMs = approval.kind === "connect" ? this.refuseFor(approval.origin, approval.title, asked.network) : undefined;
      w!.reject(new DappError(w!.declined));
      return waitMs === undefined ? {} : { waitMs };
    }
    try {
      w!.resolve(await w!.approve({ governance: governance === true }));
      return {};
    } catch (e) {
      // WebAssembly that trapped under it outside the wallet's queue (reading
      // what a signed transaction pays, say) is broken, not refusing: the
      // wallet locks, as under a site's call (`answerSite`), and the site
      // hears only that it wasn't answered (independent review M15).
      if (isTrap(e)) {
        w!.reject(new DappError({ code: APIError.InternalError, info: SITE_TRAPPED("en") }));
        await this.deps.wallet.trapped();
        return { error: WASM_BROKEN() };
      }
      const error = e instanceof DappError ? e : failed(w!.approval, e);
      w!.reject(error);
      return { error: error.message };
    }
  }

  /**
   * The wallet's state changed: an unlock lets the waiting calls on. A removed
   * wallet's sites are forgotten, the ones it declined too. A lock keeps those
   * (`Wallet.wipe` carries them across), so it doesn't let a declined site ask
   * at once, even a lock in a worker that hasn't read them yet.
   */
  async stateChanged(): Promise<void> {
    const state = await this.deps.wallet.state();
    if (state === "no-wallet") {
      this.lastSites.clear();
      this.refusedUntil.clear();
      // The wallet was removed, and the connector with it: nothing waits on it (independent review L33).
      this.connectorOff();
    }
    if (!this.unlocking.length || state !== "unlocked") return;
    for (const u of this.unlocking.splice(0)) u.resolve();
    this.deps.changed();
  }

  /** The sites waiting for the wallet to be unlocked, by origin, oldest first: the connector's window names them. */
  unlockingSites(): string[] {
    return [...new Set(this.unlocking.map((u) => u.session.origin))];
  }

  /**
   * The connector's window has nothing left to show: the worker closes it,
   * unless something came in since it looked (false: it shows that). The
   * worker decides, as only it knows what's waiting this moment.
   */
  async closeWindow(): Promise<boolean> {
    if (this.waiting.length || this.unlocking.length) return false;
    this.closing = true;
    try {
      await this.deps.window.close();
    } catch (e) {
      this.closing = false;
      throw e;
    }
    return true;
  }

  /**
   * A window closed. If the user closed the connector's, everything waiting
   * is declined. If the worker did (`closeWindow`), what came in as it
   * closed is shown in a new one: a request is never declined unseen.
   */
  async windowClosed(): Promise<void> {
    if (!this.waiting.length && !this.unlocking.length) {
      if (this.closing && !(await this.deps.window.isOpen())) this.closing = false;
      return;
    }
    if (await this.deps.window.isOpen()) return;
    if (this.closing) {
      this.closing = false;
      try {
        await this.deps.window.show();
        return;
      } catch {
        // No window to show them in: they're declined, as if closed.
      }
    }
    const unlocking = this.unlocking.splice(0);
    // A private session's funding is sent: it isn't undone, and the site connects once it arrives.
    const closed = this.waiting.filter((x) => !funding(x));
    // What waited for the unlock, and a connect the window closed on, isn't asked again for a while either
    // (independent review L35, L36): refused before anything is answered, so no site asks again in between,
    // and once per site, however many of its requests waited: counted per request, three tabs' would have
    // gone straight to the longest refusal (`REFUSE_MS`).
    const connects = closed.filter((w) => w.approval.kind === "connect" && !w.approval.connected);
    // What waited for the unlock was asked on the network the wallet is on.
    const network = await this.deps.network();
    const turnedAway = new Map<string, { title?: string; network: NetworkName }>();
    for (const u of unlocking) turnedAway.set(u.session.origin, { title: u.session.title, network });
    for (const w of connects) turnedAway.set(w.session.origin, { title: w.session.title, network: w.network });
    for (const [origin, r] of turnedAway) this.refuseFor(origin, r.title, r.network);
    // As a declined request is: nothing more about the wallet.
    for (const u of unlocking) u.reject(refused(DECLINED));
    for (const w of closed) {
      remove(this.waiting, (x) => x === w);
      // Governance asked of a connected site, closed on: declined, and the site keeps its connection.
      if (w.approval.kind === "connect" && w.approval.connected) {
        await this.declineGovernance(w.network, w.session.origin).catch(() => undefined);
        w.resolve(true);
        continue;
      }
      w.reject(new DappError(w.declined));
    }
    // The dApps page and Connected sites list the sites now turned away (blind test §9.2).
    if (turnedAway.size) this.deps.changed();
  }

  /**
   * The wallet moved to another network (Settings): what sites asked on the
   * network it left is declined, as if the user had said no. A private
   * session's funding that's sent isn't undone: its site connects on the
   * network it was sent on, once it arrives, as when the window closes.
   */
  async networkChanged(): Promise<void> {
    const network = await this.deps.network();
    const left = this.waiting.filter((w) => w.network !== network && !funding(w));
    if (!left.length) return;
    for (const w of left) {
      remove(this.waiting, (x) => x === w);
      w.reject(new DappError({ ...w.declined, info: NETWORK_LEFT("en") }));
    }
    this.deps.changed();
  }

  /**
   * Settings chose another dApp account: a public-side signature waiting was
   * read and checked for the one it left, so it's declined with CIP-30's
   * AccountChange, which asks the site to `enable()` again; on its approval
   * the new account's keys would have signed it (chunk 25). A connect waits
   * on, as no account is read for it, and a private session's has its own.
   */
  async dappAccountChanged(): Promise<void> {
    const account = await this.dappAccount();
    this.decline((w) => w.account !== undefined && w.account !== account, ACCOUNT_MOVED, APIError.AccountChange);
  }

  /**
   * The connector was turned off (Settings, Chrome's access to sites taken
   * away, or the wallet removed): everything sites wait for is declined, a
   * private session's funding waiting for the chain too, whose money stays
   * on the dApps page (independent review L33).
   */
  connectorOff(): void {
    const unlocking = this.unlocking.splice(0);
    for (const u of unlocking) u.reject(refused(OFF));
    if (!this.decline(() => true, OFF) && unlocking.length) this.deps.changed();
  }

  /**
   * Declines what `which` picks of what's waiting, with `info`, as the user
   * saying no would, or with `code` in place of that; whether any was.
   */
  private decline(which: (w: Waiting) => boolean, info: Words, code?: number): boolean {
    const out = this.waiting.filter(which);
    if (!out.length) return false;
    remove(this.waiting, (w) => out.includes(w));
    for (const w of out) w.reject(new DappError({ ...w.declined, ...(code === undefined ? {} : { code }), info: info("en") }));
    this.deps.changed();
    return true;
  }

  /**
   * A site's page went away: nothing it asked for waits any more. Each is
   * settled, though nobody hears it, so its call ends and gives back its
   * share of the site's calls (`MAX_SITE_CALLS`): left waiting forever, 32
   * of them would lock the site out (independent review L31). Its calls
   * still on their way ask nothing more (`gonePages`). A private session's
   * funding already sent isn't undone: the site finds itself connected next
   * time.
   */
  gone(session: DappSession): void {
    if (this.pageCalls.has(session.id)) this.gonePages.add(session.id);
    const waiting = this.waiting.filter((w) => w.session.id === session.id);
    const unlocking = this.unlocking.filter((u) => u.session.id === session.id);
    if (!waiting.length && !unlocking.length) return;
    remove(this.waiting, (w) => waiting.includes(w));
    remove(this.unlocking, (u) => unlocking.includes(u));
    for (const w of waiting) {
      w.gone = true;
      w.reject(refused(PAGE_GONE));
    }
    for (const u of unlocking) u.reject(refused(PAGE_GONE));
    this.deps.changed();
  }

  /** The sites connected on the network the wallet is on, each with its private session if it has one. Throws if locked. */
  async sites(): Promise<DappSite[]> {
    return this.sitesOn(await this.deps.network());
  }

  /** The sites connected on `network`. */
  private async sitesOn(network: NetworkName): Promise<DappSite[]> {
    const all = (await this.deps.store.get<Connected[]>("dapps")) ?? [];
    this.keepSites(all);
    return all
      .filter((s) => s.network === network)
      .map(({ origin, connectedAt, title, session, cip95, cip95Declined }) => ({
        origin,
        connectedAt,
        // Read as it's kept now: one kept before its direction characters were left out is shown without them.
        ...(siteTitle(title) ? { title: siteTitle(title) } : {}),
        ...(session === undefined ? {} : { session }),
        ...(cip95 === true && session === undefined ? { cip95 } : {}),
        ...(cip95Declined === true && session === undefined && cip95 !== true ? { cip95Declined } : {}),
      }))
      .sort((a, b) => a.origin.localeCompare(b.origin));
  }

  /**
   * Disconnects a site: its calls are refused until it connects again. A
   * site's private session ends with it, and only once its account is empty.
   */
  async forget(origin: string): Promise<DappSite[]> {
    const network = await this.deps.network();
    const site = await this.site(network, origin);
    if (site?.session !== undefined) await this.deps.sessions.disconnect(network, site.session);
    await this.changeSites((all) => all.filter((s) => !(s.origin === origin && s.network === network)));
    // What it asked for and the user hasn't answered goes with it (independent review L33).
    this.decline((w) => w.session.origin === origin && w.network === network, DISCONNECTED);
    return this.sitesOn(network);
  }

  /**
   * Ends a site's private session, once its account is empty, and disconnects
   * whichever site has it. From the dApps page: a session whose funding never
   * reached the chain has no connected site to disconnect.
   */
  async disconnectSession(index: number): Promise<void> {
    const network = await this.deps.network();
    // Read first, so what its site waits for can be declined once it's gone (independent review L33).
    const origins = await this.sitesOn(network).then(
      (all) => all.filter((s) => s.session === index).map((s) => s.origin),
      (): string[] => [],
    );
    await this.deps.sessions.disconnect(network, index);
    await this.changeSites((all) => all.filter((s) => !(s.session === index && s.network === network)));
    this.decline((w) => origins.includes(w.session.origin) && w.network === network, DISCONNECTED);
  }

  /**
   * Builds the funding of a private session for the site a waiting connect is
   * from: `lovelace` and `tokens` for it, and its collateral. `answer` with
   * the funding's hash sends it.
   */
  async privateBuild(id: string, lovelace: string, tokens: TokenQuantity[]): Promise<SessionOutSummary> {
    const w = this.waiting.find((x) => x.approval.id === id);
    if (!w || w.approval.kind !== "connect") throw new Error(t("dapp.stoppedWaiting"));
    if (w.approval.funding) throw new Error(t("dapp.alreadyFunded"));
    if (w.network !== (await this.deps.network())) throw new Error(NETWORK_LEFT());
    if (await this.connected(w.network, w.session.origin)) throw new Error(ALREADY_CONNECTED());
    return this.deps.sessions.siteOutBuild(w.network, w.session.origin, lovelace, tokens);
  }

  private async site(network: NetworkName, origin: string): Promise<DappSite | undefined> {
    return (await this.sitesOn(network)).find((s) => s.origin === origin);
  }

  private async connected(network: NetworkName, origin: string): Promise<boolean> {
    return (await this.site(network, origin)) !== undefined;
  }

  /**
   * Records a site as connected on `network`, to `session` if given; with
   * governance (`cip95`) when it asked and the user switched it on, or its
   * refusal kept (`cip95Declined`) when they left it off: never for a
   * session. False when it's connected already. `title`: its page's, as it
   * asked, which the lists show after its address (blind test E03).
   */
  private async connect(
    network: NetworkName,
    origin: string,
    session?: number,
    governance?: "granted" | "declined",
    title?: string,
  ): Promise<boolean> {
    let added = false;
    const named = siteTitle(title);
    await this.changeSites((all) => {
      if (all.some((s) => s.origin === origin && s.network === network)) return all;
      added = true;
      const site: Connected = { origin, network, connectedAt: this.deps.now(), ...(named ? { title: named } : {}) };
      // No account is recorded on a site: every public-account connection is
      // to the one dApp account, which Settings chooses (`dappAccount`).
      if (session !== undefined) return [...all, { ...site, session }];
      if (governance === "granted") return [...all, { ...site, cip95: true }];
      if (governance === "declined") return [...all, { ...site, cip95Declined: true }];
      return [...all, site];
    });
    return added;
  }

  /** Gives a site connected to the public account governance (CIP-95), when the user agreed to it. */
  private async grantGovernance(network: NetworkName, origin: string): Promise<void> {
    await this.changeSites((all) => {
      const i = all.findIndex((s) => s.origin === origin && s.network === network && s.session === undefined);
      if (i < 0 || all[i]!.cip95) return all;
      return all.map((s, j) => {
        if (j !== i) return s;
        const { cip95Declined: _declined, ...rest } = s;
        return { ...rest, cip95: true as const };
      });
    });
  }

  /**
   * Keeps that the user declined governance for a connected site: it stays
   * connected without it, and isn't asked again until it's disconnected and
   * connects anew.
   */
  private async declineGovernance(network: NetworkName, origin: string): Promise<void> {
    await this.changeSites((all) => {
      const i = all.findIndex((s) => s.origin === origin && s.network === network && s.session === undefined);
      if (i < 0 || all[i]!.cip95 || all[i]!.cip95Declined) return all;
      return all.map((s, j) => (j === i ? { ...s, cip95Declined: true as const } : s));
    });
  }

  /**
   * Changes the `dapps` record after every change before it: a connect and a
   * disconnect at once would otherwise each write over the other's.
   */
  private changeSites(change: (all: Connected[]) => Connected[]): Promise<void> {
    const run = this.sitesQueue.then(async () => {
      const all = (await this.deps.store.get<Connected[]>("dapps")) ?? [];
      const next = change(all);
      if (next !== all) await this.deps.store.set("dapps", next);
      this.keepSites(next);
      // Home's dApps row and the dApps page list the sites: they read again (blind test §9.2).
      if (next !== all) this.deps.changed();
    });
    this.sitesQueue = run.catch(() => undefined);
    return run;
  }

  /** Keeps which sites are connected, in memory, for `isEnabled` while locked. */
  private keepSites(all: Connected[]): void {
    this.lastSites.clear();
    for (const { network, origin } of all) {
      const sites = this.lastSites.get(network) ?? new Set<string>();
      this.lastSites.set(network, sites.add(origin));
    }
  }

  /**
   * `enable()`, unlocked: true once the site is connected, which the user is
   * asked. One question per site at a time (independent review L35):
   * another of its pages asking meanwhile has that one's answer, and asks
   * itself only if that page went away first. A site the user declined, or
   * closed the window on, isn't asked again for a while (`REFUSE_MS`).
   */
  /**
   * Connects `origin`, asking the user, with governance (CIP-95) when it
   * asks for it (`params`, CIP-30's `{ extensions: [{ cip: 95 }] }`) and the
   * user agrees. A site connected already that asks for governance now is
   * asked about that alone. What it was given, `getExtensions()` says.
   */
  private async enable(session: DappSession, network: NetworkName, params: unknown): Promise<true> {
    const { origin } = session;
    const password = await this.needsPassword();
    const wants = wantsGovernance(params);
    const site = await this.site(network, origin);
    // A private session has no DRep: governance isn't asked about for one. Nor is it asked again once declined.
    if (site && (!wants || governed(site) || site.session !== undefined || site.cip95Declined)) return true;
    // Nothing is awaited from here until it's asked, so two pages can't both ask.
    const asking = this.waiting.find((w) => w.approval.kind === "connect" && w.session.origin === origin && w.network === network);
    if (asking) {
      const settled = await asking.settled;
      // This page went away too: nothing is asked for it.
      if (this.gonePages.has(session.id)) throw refused(PAGE_GONE);
      if (settled === "gone") return this.run(session, "enable", [params]) as Promise<true>;
      if (settled) throw settled;
      // Answered for another of its pages, which may not have asked for governance: this one asks for it then.
      const now = await this.site(network, origin);
      if (now && wants && !governed(now) && now.session === undefined && !now.cip95Declined) {
        return this.run(session, "enable", [params]) as Promise<true>;
      }
      return true;
    }
    if (this.refusing(origin)) {
      this.askedAgain(origin);
      throw refused(this.declinedWait(origin));
    }
    const ask: DappAsk = { kind: "connect", password, ...(wants ? { governance: true } : {}), ...(site ? { connected: true } : {}) };
    await this.ask(session, network, ask, APIError.Refused, async ({ governance }) => {
      if (site) await this.grantGovernance(network, origin);
      // Asked for, governance goes with the connection only when the window's switch says so (off by default).
      else await this.connect(network, origin, undefined, wants ? (governance ? "granted" : "declined") : undefined, session.title);
    });
    // Connected: the refusals before it don't count against it any more.
    if (this.refusedUntil.delete(origin)) this.keepRefusals();
    return true;
  }

  /** The refusal declining `origin` now would start: how many in a row, and how long (`REFUSE_MS`). */
  private nextRefusal(origin: string): { count: number; ms: number } {
    const last = this.refusedUntil.get(origin);
    const count = last && this.deps.now() - last.until < REFUSE_RESET_MS ? last.count + 1 : 1;
    return { count, ms: REFUSE_MS[Math.min(count, REFUSE_MS.length) - 1]! };
  }

  /**
   * The user declined `origin`, or closed the window on it: refused unasked
   * for a while, longer for each refusal in a row (`REFUSE_MS`). Returns how
   * long. `title`: its page's, for the wallet's own list of them; `network`,
   * the one it asked on, where the list shows it.
   */
  private refuseFor(origin: string, title?: string, network?: NetworkName): number {
    const { count, ms } = this.nextRefusal(origin);
    const named = siteTitle(title) ?? this.refusedUntil.get(origin)?.title;
    this.refusedUntil.set(origin, {
      until: this.deps.now() + ms,
      count,
      ...(network ? { network } : {}),
      ...(named ? { title: named } : {}),
    });
    this.keepRefusals();
    return ms;
  }

  /** Reads back, once, the refusals a worker before this one kept (`SESSION_DAPP_REFUSED`). Never throws. */
  private readRefusals(): Promise<void> {
    this.refusalsRead ??= this.deps.session.get<Record<string, Refusal>>(SESSION_DAPP_REFUSED).then(
      (kept) => {
        for (const [origin, r] of Object.entries(kept ?? {})) {
          // One this worker set since it started is newer.
          if (this.refusedUntil.has(origin) || typeof r?.until !== "number" || typeof r.count !== "number") continue;
          this.refusedUntil.set(origin, {
            until: r.until,
            count: r.count,
            ...(r.network ? { network: r.network } : {}),
            ...(r.retried ? { retried: true } : {}),
          });
        }
      },
      () => undefined,
    );
    return this.refusalsRead;
  }

  /**
   * Keeps the refusals in session storage for the next worker: origins,
   * waits, counts and networks, not titles. One whose wait ended more than
   * `REFUSE_RESET_MS` ago counts for nothing any more, so it goes.
   */
  private keepRefusals(): void {
    const now = this.deps.now();
    for (const [origin, r] of this.refusedUntil) if (now - r.until >= REFUSE_RESET_MS) this.refusedUntil.delete(origin);
    const kept = Object.fromEntries(
      [...this.refusedUntil].map(([origin, { until, count, network, retried }]) => [
        origin,
        { until, count, ...(network ? { network } : {}), ...(retried ? { retried } : {}) },
      ]),
    );
    const { session } = this.deps;
    this.refusalsKept = this.refusalsKept
      .then(() => (Object.keys(kept).length ? session.set(SESSION_DAPP_REFUSED, kept) : session.remove(SESSION_DAPP_REFUSED)))
      .catch(() => undefined);
  }

  /**
   * `origin` asked to connect again while it's turned away: the wallet's
   * pages say so, once a refusal, so a page asking again and again can't make
   * them read again and again (blind test T17r: only the site said anything).
   */
  private askedAgain(origin: string): void {
    const refusal = this.refusedUntil.get(origin);
    if (!refusal || refusal.retried) return;
    refusal.retried = true;
    this.keepRefusals();
    this.deps.changed();
  }

  /**
   * The sites turned away unasked now, the soonest to ask again first: the
   * dApps page and Connected sites list them, with how long is left (blind
   * test §9.2, T17r). Only those declined on the network the wallet is on,
   * none that's connected (a connected site's signatures are turned away the
   * same way once the unlock window is closed on them, independent review
   * L36, but it wasn't declined), and none while the connector is off.
   * Throws if locked: which sites are connected is sealed.
   */
  async declined(): Promise<DappDeclined[]> {
    await this.readRefusals();
    if (!(await this.deps.preferences.get()).dappConnector) return [];
    const network = await this.deps.network();
    const connected = new Set((await this.sitesOn(network)).map((s) => s.origin));
    const now = this.deps.now();
    return [...this.refusedUntil]
      .filter(([origin, r]) => r.until > now && (r.network ?? network) === network && !connected.has(origin))
      .map(([origin, r]) => ({ origin, until: r.until, ...(r.title ? { title: r.title } : {}), ...(r.retried ? { retried: true as const } : {}) }))
      .sort((a, b) => a.until - b.until || a.origin.localeCompare(b.origin));
  }

  /**
   * The user lets a site they declined ask again now (Let it ask now). Only
   * the wallet's own pages can, so a site still can't bring the window back
   * by asking. A decline after it still counts as one in a row.
   */
  async letAsk(origin: string): Promise<DappDeclined[]> {
    await this.readRefusals();
    const refusal = this.refusedUntil.get(origin);
    if (refusal && refusal.until > this.deps.now()) {
      const { retried: _retried, ...rest } = refusal;
      this.refusedUntil.set(origin, { ...rest, until: this.deps.now() });
      this.keepRefusals();
      this.deps.changed();
    }
    return this.declined();
  }

  /** Whether `origin` is refused unasked now (`refuseFor`). */
  private refusing(origin: string): boolean {
    return this.deps.now() < (this.refusedUntil.get(origin)?.until ?? 0);
  }

  /**
   * What a refused `enable()` hears: that the user declined it, and when it
   * can ask again, which a dApp can show (CIP-30's `info`). "The user
   * declined." alone, with nothing in the wallet either, left a user who
   * cancelled by mistake clicking Connect on a site that did nothing (chunk
   * 23's second review, CW-3). The same words locked or not, so they say
   * nothing of the lock (independent review L36).
   */
  private declinedWait(origin: string): Words {
    const left = (this.refusedUntil.get(origin)?.until ?? 0) - this.deps.now();
    const seconds = Math.max(1, Math.ceil(left / 1000));
    return (lng) => t("dapp.declinedWait", { seconds, lng });
  }

  /**
   * How many of `origin`'s requests wait for the user: in the window, or for
   * the unlock, where its pages' `enable()` calls count once together.
   */
  private waitingFrom(origin: string): number {
    const from = (x: { session: DappSession }) => x.session.origin === origin;
    return this.waiting.filter(from).length + unlockPlaces(this.unlocking.filter(from));
  }

  /** How many requests wait for the user, every site's, counted as `waitingFrom` does. */
  private queued(): number {
    return this.waiting.length + unlockPlaces(this.unlocking);
  }

  /**
   * Whether `origin` is connected on the network the wallet is on, locked or
   * not: an answer that changed at an unlock would tell a site polling it
   * when the wallet is in use. While locked, the sealed record can't be
   * read: the answer is what this worker last read of it. One started since
   * the lock says false, as for a site that isn't connected.
   */
  private async isEnabled(origin: string): Promise<boolean> {
    const [state, network] = await Promise.all([this.deps.wallet.state(), this.deps.network()]);
    if (state === "unlocked") return this.connected(network, origin);
    return state === "locked" && !!this.lastSites.get(network)?.has(origin);
  }

  /**
   * Which public account connected sites use: the **dApp account**, chosen in
   * Settings, not the one the picker is on (Eternl's model; the owner,
   * 2026-10-02).
   */
  private async dappAccount(): Promise<number> {
    return (await this.deps.preferences.get()).dappAccount;
  }

  /**
   * The keys a request is read and signed with: a private session's are the
   * wallet's own one-time accounts, and everything else is the **dApp
   * account's**, whichever account the wallet is working on.
   *
   * That is the whole point of having one: a site always talks to the same
   * account, so switching accounts can never hand it a second account's
   * addresses, and it is never refused for being on the "wrong" one. Changing
   * which account that is, is a deliberate act in Settings.
   */
  private async withDappKeys<T>(holder: Holder, task: (keys: Keys) => T | Promise<T>): Promise<T> {
    const { wallet } = this.deps;
    return holder ? wallet.withKeys(task) : wallet.withAccount(await this.dappAccount(), task);
  }

  /**
   * Who a connected site talks to: its private session's account, or
   * (`undefined`) the public side, which is always the one dApp account
   * Settings chooses (`withDappKeys`), whichever account the wallet is on.
   *
   * Following the active account instead would hand a site that had already
   * seen Account 1's addresses Account 2's as well, and teach it the two are
   * one wallet's **without the user choosing that**. A link the user makes
   * themselves is their business — a payment between their own accounts is
   * allowed, and only said, and so is changing the dApp account in Settings
   * — but one a site is handed behind their back is not (chunk 18, Eternl's
   * model).
   */
  private async holder(network: NetworkName, site: DappSite): Promise<Holder> {
    if (site.session === undefined) return undefined;
    try {
      return { index: site.session, ...(await this.deps.sessions.siteAccount(network, site.session)) };
    } catch {
      throw refused((lng) => t("dapp.sessionOver", { lng }));
    }
  }

  /**
   * Refuses unless the connector is still on and `origin` still connected on
   * `network`, to `holder`, and, on the public side, the dApp account still
   * `account`: what a request was read for. Checked as it's approved, after
   * the password (independent review L33). A dApp account changed in
   * Settings meanwhile is CIP-30's AccountChange, which asks the site to
   * `enable()` again (Lace refuses a signData so; chunk 25).
   */
  private async stillConnected(network: NetworkName, origin: string, holder: Holder, account?: number): Promise<void> {
    if (!(await this.deps.preferences.get()).dappConnector) throw refused(OFF);
    const site = await this.site(network, origin);
    if (!site || site.session !== holder?.index) throw refused(DISCONNECTED);
    if (!holder && account !== undefined && account !== (await this.dappAccount())) {
      throw siteError(APIError.AccountChange, ACCOUNT_MOVED);
    }
  }

  /**
   * Sends a private session's funding for a waiting connect, records the site
   * as connected to it, and waits for the money to arrive before the site's
   * `enable()` answers. The window shows it waiting.
   */
  private async fundPrivate(w: Waiting, txHash: string): Promise<{ error?: string; code?: ReplyCode; by?: RefusedBy }> {
    // The network it was asked on, which `answer` checked the wallet is still on.
    const network = w.network;
    // Another of its requests connected it meanwhile (two tabs, or enable() twice):
    // the session wouldn't be the one the site talks to, so it isn't funded.
    if (await this.connected(network, w.session.origin)) return { error: ALREADY_CONNECTED() };
    let index: number;
    try {
      ({ index } = await this.deps.sessions.siteOutSubmit(network, txHash, w.session.origin));
    } catch (e) {
      // Its session was recorded before it was sent, so Send again only met "That session was started already".
      // The window builds it again instead, or, when it may have gone out all the same, says where to look: a
      // stale review by this code, the rest by the session's record (SessionRefused.tsx; chunk 23's second
      // review, DX-1).
      const stale = e instanceof StaleReviewError || e instanceof CollateralRefusedError;
      // And who refused it, where that's giveme.my: the window names it (blind test §9.5, T16).
      const by = refusedBy(e);
      return { error: (e as Error).message, ...(stale ? { code: "stale" as const } : {}), ...(by ? { by } : {}) };
    }
    if (!(await this.connect(network, w.session.origin, index, undefined, w.session.title))) {
      // Connected while the funding was sent: the site talks to that, so its
      // enable() has its answer, and the session's money waits on the dApps page.
      remove(this.waiting, (x) => x === w);
      w.resolve(true);
      this.deps.changed();
      return {
        error: t("dapp.fundedButConnected", { number: index + 1 }),
      };
    }
    w.approval = { ...w.approval, funding: { index, txHash } } as DappApproval;
    this.deps.changed();
    void this.watchFunding(w, index);
    return {};
  }

  /** Looks for a private session's funding every 10 s; once it's there, the site's `enable()` answers. */
  private async watchFunding(w: Waiting, index: number): Promise<void> {
    const { sessions, now } = this.deps;
    const network = w.network;
    const started = now();
    const pause = this.deps.fundingPollMs ?? FUNDING_POLL_MS;
    const done = (settle: () => void) => {
      if (!this.waiting.includes(w)) return;
      remove(this.waiting, (x) => x === w);
      settle();
      this.deps.changed();
    };
    try {
      const { keyHash } = await sessions.siteAccount(network, index);
      // The site went away meanwhile: it finds itself connected next time.
      while (this.waiting.includes(w)) {
        const rows = await sessions.accountUtxos(network, keyHash).catch(() => []);
        if (rows.length) {
          // Seen landed, and recorded so: no read behind it later takes it for one never sent (final review F13).
          void sessions.fundingSeen(network, index, rows).catch(() => undefined);
          return done(() => w.resolve(true));
        }
        if (now() - started > FUNDING_WAIT_MS) {
          return done(() => w.reject(refused((lng) => t("dapp.fundingNeverLanded", { lng }))));
        }
        await new Promise((r) => setTimeout(r, pause));
      }
    } catch {
      // Why may be in the user's language (another service's words): the site hears only that it went wrong.
      done(() => w.reject(siteError(APIError.InternalError, SITE_TRAPPED)));
    }
  }

  /** Whether a site's signature asks for the password: the setting. */
  private async needsPassword(): Promise<boolean> {
    return (await this.deps.preferences.get()).dappPassword;
  }

  /** Waits for the wallet to be unlocked, in the connector's window. */
  private async unlocked(session: DappSession, method: DappMethod): Promise<void> {
    if ((await this.deps.wallet.state()) === "unlocked") return;
    const { origin } = session;
    // Refused unasked in the words the site would hear unlocked, never that
    // the wallet is locked (independent review L36): a signature or a send
    // hears what a site that isn't connected does; `enable()` from one, that
    // it was declined. A connected site's `enable()` still opens the window.
    const known = !!this.lastSites.get(await this.deps.network())?.has(origin);
    if (this.refusing(origin) && (method !== "enable" || !known)) {
      if (method === "enable") this.askedAgain(origin);
      throw refused(method === "enable" ? this.declinedWait(origin) : NOT_CONNECTED);
    }
    // Its page went away while this call was on its way: nobody would answer it (independent review L31).
    if (this.gonePages.has(session.id)) throw refused(PAGE_GONE);
    // Another of its pages' `enable()` waits already: this one shares its
    // place, as it will its connect question, so a site open in several tabs
    // is never refused for it (independent review L35).
    const enable = method === "enable";
    const shares = enable && this.unlocking.some((u) => u.enable && u.session.origin === origin);
    if (!shares && (this.queued() >= MAX_WAITING || this.waitingFrom(origin) >= MAX_SITE_WAITING)) {
      throw refused(enable || known ? BUSY : NOT_CONNECTED);
    }
    let waiter: Unlocking | undefined;
    const unlocked = new Promise<void>((resolve, reject) => this.unlocking.push((waiter = { session, enable, resolve, reject })));
    try {
      await this.deps.window.show();
    } catch (e) {
      // No window to unlock in: nothing waits for one.
      remove(this.unlocking, (u) => u === waiter);
      throw e;
    }
    this.deps.changed();
    return unlocked;
  }

  /** Puts a request in front of the user; `approve` runs if they say yes. */
  private ask<T>(
    session: DappSession,
    network: NetworkName,
    request: DappAsk,
    declined: number,
    approve: (answer: Answer) => Promise<T>,
    /** A signature's transaction, hex, for the transaction view. */
    txCbor?: string,
    /** A public-side signature's dApp account, as its request was read (`Waiting.account`). */
    account?: number,
  ): Promise<T> {
    // Its page went away while it was read: nobody would answer it (independent review L31).
    if (this.gonePages.has(session.id)) throw refused(PAGE_GONE);
    if (this.waiting.length >= MAX_WAITING || this.waitingFrom(session.origin) >= MAX_SITE_WAITING) throw refused(BUSY);
    // Random, not a count: a count starts again when the worker restarts, and a
    // window still showing an older request would then answer a new one.
    // The title capped as the lists keep it: it's the site's own, and the window shows it whole (the cross-area review).
    const approval = { ...request, id: crypto.randomUUID(), origin: session.origin, title: siteTitle(session.title) } as DappApproval;
    const failure: DappFailure = { code: declined, info: DECLINED("en") };
    let entry!: Waiting;
    const answered = new Promise<T>((resolve, reject) => {
      entry = {
        approval,
        session,
        network,
        approve,
        resolve: resolve as (value: unknown) => void,
        reject,
        declined: failure,
        ...(txCbor === undefined ? {} : { txCbor }),
        ...(account === undefined ? {} : { account }),
      };
      this.waiting.push(entry);
    });
    entry.settled = answered.then(
      () => undefined,
      (e: unknown) => (entry.gone ? "gone" : e instanceof DappError ? e : new DappError({ code: APIError.InternalError, info: String(e) })),
    );
    this.deps.changed();
    this.deps.window.show().catch((e: unknown) => {
      // No window to answer in: the site hears why, rather than waiting.
      const i = this.waiting.findIndex((w) => w.approval === approval);
      if (i >= 0) this.waiting.splice(i, 1)[0]!.reject(new DappError({ code: APIError.InternalError, info: String(e) }));
    });
    return answered;
  }

  // --- Reading ---------------------------------------------------------------

  /**
   * The account, read at most every 30 s (or now, with `fresh`), less what
   * this wallet has spent since. Calls while it's being read wait for that
   * reading, so a site asking many things at once costs one.
   */
  private async view(network: NetworkName, holder: Holder, fresh = false): Promise<View> {
    const { wallet, session, now } = this.deps;
    // The public side's is the dApp account's, read once here: kept, and shared while it's read, under that account
    // alone. Keyed by network only, a change in Settings answered every site, new ones too, with the account it left
    // for 30 s, beside the new one's addresses (the release review).
    const account = holder ? undefined : await this.dappAccount();
    const key = SESSION_DAPP_VIEW + network + suffix(holder, account);
    const [kept, spent] = await wallet.withKeys(async () => [await session.get<View>(key), await spentSet(session)] as const);
    if (kept && !fresh && now() - kept.readAt < VIEW_MS && kept.account === account) {
      return { ...kept, utxos: kept.utxos.filter((p) => !spent.has(outpoint(p.utxo))) };
    }
    let reading = this.reading.get(key);
    if (!reading) {
      reading = this.read(network, holder, key, spent, account).finally(() => this.reading.delete(key));
      this.reading.set(key, reading);
    }
    return reading;
  }

  private async read(
    network: NetworkName,
    holder: Holder,
    key: string,
    spent: ReadonlySet<string>,
    account?: number,
  ): Promise<View> {
    const { wallet, session, now } = this.deps;
    let view: View;
    if (holder) {
      // The session's one account: its one address, its key `0/i`, its own stake key.
      const rows = await this.deps.sessions.accountUtxos(network, holder.keyHash);
      view = {
        keys: [{ role: 0, index: holder.index }],
        utxos: rows.map((utxo) => ({ role: 0, index: holder.index, utxo })),
        usedAddresses: [holder.address],
        stake: holder.reward,
        readAt: now(),
      };
    } else {
      const found = await readAccountUtxos(this.deps, network, spent, { account });
      view = {
        keys: [...found.account.paths.values()],
        utxos: found.utxos,
        usedAddresses: found.account.usedAddresses,
        stake: found.account.stake,
        readAt: now(),
        account,
      };
    }
    await wallet.withKeys(() => session.set(key, view));
    return view;
  }

  private async signed(network: NetworkName, holder: Holder): Promise<Signed[]> {
    const key = SESSION_DAPP_SIGNED + network + suffix(holder);
    return (await this.deps.wallet.withKeys(() => this.deps.session.get<Signed[]>(key))) ?? [];
  }

  /**
   * What a site may spend: the account less what's locked and the
   * collateral, plus what sent transactions return that isn't on chain yet:
   * the dApp account's own locks and collateral, and its own transactions'.
   */
  private async available(network: NetworkName, holder: Holder): Promise<{ utxos: PathedUtxo[]; collateral?: PathedUtxo }> {
    const view = await this.view(network, holder);
    const { spendable, collateral } = holder
      ? sessionCollateral(view.utxos)
      : await this.deps.coins.account(network, view.utxos, view.account ?? 0);
    const [signed, spent] = await Promise.all([
      this.signed(network, holder),
      this.deps.wallet.withKeys(() => spentSet(this.deps.session)),
    ]);
    const seen = new Set(view.utxos.map((p) => outpoint(p.utxo)));
    const since = this.deps.now() - INFLIGHT_MS;
    const inflight = signed
      .filter((s) => s.submittedAt !== undefined && s.submittedAt > since && ofAccount(s, view))
      .flatMap((s) => s.outputs)
      .filter((p) => !seen.has(outpoint(p.utxo)) && !spent.has(outpoint(p.utxo)));
    return { utxos: [...spendable, ...inflight], collateral };
  }

  private async balance(network: NetworkName, holder: Holder): Promise<string> {
    const { utxos } = await this.available(network, holder);
    let lovelace = 0n;
    const tokens = new Map<string, bigint>();
    for (const { utxo } of utxos) {
      lovelace += BigInt(utxo.value);
      for (const a of utxo.asset_list ?? []) {
        const key = `${a.policy_id}.${a.asset_name}`;
        tokens.set(key, (tokens.get(key) ?? 0n) + BigInt(a.quantity));
      }
    }
    const list = [...tokens].map(([key, quantity]) => {
      const [policyId, assetName] = key.split(".") as [string, string];
      return { policyId, assetName, quantity: quantity.toString() };
    });
    return this.deps.wasm.cip30Value(lovelace.toString(), JSON.stringify(list));
  }

  private encode(utxos: PathedUtxo[]): string[] {
    return this.deps.wasm.cip30Utxos(JSON.stringify(utxos.map((p) => p.utxo)));
  }

  private async utxos(network: NetworkName, holder: Holder, amount: unknown, page: unknown): Promise<string[] | null> {
    const { utxos } = await this.available(network, holder);
    if (amount === undefined || amount === null) return paginate(this.encode(largestFirst(utxos)), page);
    const wanted = this.readAmount(amount);
    const picked = cover(utxos, wanted);
    return picked ? paginate(this.encode(picked), page) : null;
  }

  private async collateral(network: NetworkName, holder: Holder, params: unknown): Promise<string[] | null> {
    const { collateral } = await this.available(network, holder);
    if (!collateral) return null;
    // While the account's own Lovejoin chain is being sent, its collateral
    // backs the chain's mixes, and a site's transaction whose contract fails
    // would take it: none is offered then (`heldForLovejoin`).
    if (await this.chainHolds(network, holder, outpoint(collateral.utxo))) return null;
    const amount = (params as { amount?: unknown } | null | undefined)?.amount;
    if (amount !== undefined && amount !== null) {
      const { lovelace } = this.readAmount(amount);
      if (lovelace > MAX_COLLATERAL || lovelace > BigInt(collateral.utxo.value)) return null;
    }
    return this.encode([collateral]);
  }

  private readAmount(amount: unknown): Wanted {
    // CIP-30 passes CBOR; some dApps pass a plain number of lovelace.
    const text = typeof amount === "number" || typeof amount === "bigint" ? cborUint(BigInt(amount)) : amount;
    if (typeof text !== "string") throw invalid((lng) => t("dapp.amountNotCbor", { lng }));
    if (text.length > MAX_AMOUNT_HEX) throw invalid((lng) => t("dapp.amountTooLong", { lng }));
    try {
      const read = JSON.parse(this.deps.wasm.cip30ReadValue(text)) as { lovelace: string; tokens: Wanted["tokens"] };
      return { lovelace: BigInt(read.lovelace), tokens: read.tokens };
    } catch (e) {
      // WebAssembly that trapped is broken, not refusing: the worker locks the wallet (sw.ts).
      if (isTrap(e)) throw e;
      // WebAssembly's own words, which are English.
      throw invalid(() => (e as Error).message);
    }
  }

  private hexAddress(bech32: string): string {
    return this.deps.wasm.cip30Address(bech32);
  }

  private async receiveAddress(network: NetworkName, index: number): Promise<string> {
    const net = network === "mainnet" ? this.deps.wasm.Network.Mainnet : this.deps.wasm.Network.Preprod;
    return this.withDappKeys(undefined, ({ cardano }) => cardano.receiveAddress(net, index));
  }

  /** The used addresses, `0/0` first: it's the one the wallet shows, and where every change goes. A session has one. */
  private async usedAddresses(network: NetworkName, holder: Holder): Promise<string[]> {
    if (holder) return [this.hexAddress(holder.address)];
    const first = await this.receiveAddress(network, 0);
    const view = await this.view(network, undefined);
    return [first, ...view.usedAddresses.filter((a) => a !== first)].map((a) => this.hexAddress(a));
  }

  /** The first receive address after `0/0` that's never been used. */
  private async unusedAddresses(network: NetworkName): Promise<string[]> {
    const used = new Set((await this.view(network, undefined)).usedAddresses);
    for (let i = 1; i < 20; i++) {
      const address = await this.receiveAddress(network, i);
      if (!used.has(address)) return [this.hexAddress(address)];
    }
    return [];
  }

  // --- Signing and sending ---------------------------------------------------

  /**
   * The UTxOs a transaction spends, as far as the wallet can find them: the
   * account's, the outputs of transactions the site's account signed or sent
   * for sites (`SESSION_DAPP_SIGNED`), and those that pay the account of
   * transactions the wallet sent itself on this network in the last few
   * minutes (sent-txs.ts: a Send's change, a session's funding or top-up),
   * none of which Koios lists before they're on chain; then the account read
   * again if one is missing, and Koios for the rest (one request). The
   * WebAssembly won't have a payment key sign over one it can't find. A site
   * gets a few fresh readings and lookups a minute (`PER_MINUTE`): past them,
   * the kept reading does, and a lookup is refused. Whatever isn't its own
   * account's, or its sites', goes that way, as a stranger's does.
   */
  private async resolve(
    network: NetworkName,
    holder: Holder,
    origin: string,
    refs: string[],
  ): Promise<{ view: View; rows: KoiosUtxo[] }> {
    const since = this.deps.now() - CHAIN_MS;
    const kept = await this.signed(network, holder);
    let view = await this.view(network, holder);
    const sent = await this.sentOutputs(network, holder, view, refs);
    const find = (view: View) => {
      // What the wallet signed for this account (a dApp account changed since keeps its own), and this site's own sends.
      const signed = kept
        .filter((s) => (s.origin === undefined ? ofAccount(s, view) : s.origin === origin))
        .flatMap((s) => [...(s.signedAt !== undefined && s.signedAt > since ? (s.every ?? []) : []), ...s.outputs.map((p) => p.utxo)]);
      // What Koios lists wins over what the wallet kept.
      const known = new Map([...sent, ...signed, ...view.utxos.map((p) => p.utxo)].map((u) => [outpoint(u), u]));
      return { found: refs.flatMap((r) => known.get(r) ?? []), missing: refs.filter((r) => !known.has(r)) };
    };
    let { found, missing } = find(view);
    if (missing.length && this.allow(origin, "fresh")) {
      view = await this.view(network, holder, true);
      ({ found, missing } = find(view));
    }
    if (missing.length && !this.allow(origin, "lookup")) {
      throw refused((lng) => t("dapp.tooManyUtxoLookups", { lng }));
    }
    const others = missing.length ? await this.deps.koios(network).utxoInfo(missing) : [];
    return { view, rows: [...found, ...others] };
  }

  /**
   * What the user keeps out of payments stays out of a site's too. On the
   * public account, a transaction that spends a UTxO the user locked, puts
   * one up as collateral, or spends the collateral as an ordinary input is
   * refused: the lock was put there on purpose, and a spend ties that UTxO's
   * history to the rest for good. Unlocking it, or reclaiming the
   * collateral, is how the user means it. A session has no locks, and
   * nothing in it is kept from its site: its collateral spent as an input is
   * named in the prompt instead (the answer). The locks and the collateral
   * are those of the account the view is, the dApp account, never the one
   * on screen: picked from the wrong one, a lock made on the dApp account
   * stopped applying once the picker moved (the release review).
   */
  private async keptApart(
    network: NetworkName,
    holder: Holder,
    view: View,
    inputs: string[],
    collateral: string[],
  ): Promise<boolean> {
    if (holder) {
      const kept = sessionCollateral(view.utxos).collateral;
      return !!kept && inputs.includes(outpoint(kept.utxo));
    }
    const account = view.account ?? 0;
    const [choices, { collateral: kept }] = await Promise.all([
      this.deps.coins.choices(network, account),
      this.deps.coins.account(network, view.utxos, account),
    ]);
    const locked = new Set(choices.cardano);
    const used = [...new Set([...inputs, ...collateral])].filter((o) => locked.has(o));
    if (used.length) {
      const [first] = used;
      const one = used.length === 1;
      throw siteError(TxSignError.ProofGeneration, (lng) =>
        t("dapp.usesLocked", {
          what: t(one ? "dapp.lockedOne" : "dapp.lockedMany", { first, count: used.length, more: used.length - 1, lng }),
          them: t(one ? "dapp.it" : "dapp.them", { lng }),
          lng,
        }),
      );
    }
    if (kept && inputs.includes(outpoint(kept.utxo))) {
      throw siteError(TxSignError.ProofGeneration, (lng) => t("dapp.spendsCollateral", { utxo: outpoint(kept.utxo), lng }));
    }
    return false;
  }

  /**
   * What the holder's own Lovejoin chain still being sent needs stays out of
   * its site's transaction (spent.ts's reservations, by `chainOwner`): the
   * public account's mix for a site on the account, the session's return or
   * mix for a site on a session. Its next step would be refused as a double
   * spend, and the chain would stop partway, its boxes less mixed. The view
   * leaves those UTxOs out already, but a site can still name one it read
   * before, or found elsewhere. Nor is the chain's collateral put up as a
   * site's collateral (`getCollateral` offers none meanwhile): a site that
   * flips a signed transaction's validity flag has the network take it, and
   * the chain stops with it (independent review L32). A chain built and kept
   * for Send holds nothing here, and one that's done or stopped lets go, but
   * for what a transaction a public mix stopped at, which may have gone
   * through, spends, until that's settled; never its collateral (lovejoin.ts
   * holdOnly, final review F2). Refused before anything is looked up.
   *
   * Only the holder's own chain: another's UTxOs aren't this holder's to sign
   * anyway (another account's key, a Seedelf UTxO's proof, a Lovejoin box's),
   * and refusing them here, by name and count, would tell a site which UTxOs
   * the wallet's other accounts, or its private balance, are moving, and so
   * tie its account to them (privacy review §2.1). One of those goes the way
   * a stranger's does.
   */
  private async heldForLovejoin(network: NetworkName, holder: Holder, inputs: string[], collateral: string[]): Promise<void> {
    const held = await this.chainHeld(network, holder);
    const used = [...new Set([...inputs, ...collateral].filter((o) => held.inputs.has(o) || held.collateral.has(o)))];
    if (!used.length) return;
    const [first] = used;
    throw siteError(TxSignError.ProofGeneration, (lng) =>
      t("dapp.usesChainHeld", {
        what: t(used.length === 1 ? "dapp.utxoOne" : "dapp.utxoMany", { first, count: used.length, more: used.length - 1, lng }),
        lng,
      }),
    );
  }

  /** What the holder's own Lovejoin chain being sent will spend and put up (spent.ts's reservations). */
  private chainHeld(network: NetworkName, holder: Holder): Promise<{ inputs: Set<string>; collateral: Set<string> }> {
    const { wallet, session } = this.deps;
    return wallet.withKeys(() => reservedSet(session, network, { sending: true, only: chainOwner(holder?.index) }));
  }

  /** Whether the holder's own Lovejoin chain being sent needs `o`. */
  private async chainHolds(network: NetworkName, holder: Holder, o: string): Promise<boolean> {
    const held = await this.chainHeld(network, holder);
    return held.inputs.has(o) || held.collateral.has(o);
  }

  /**
   * The outputs among `refs` of transactions the wallet sent on `network` in
   * the last few minutes that pay the site's own account: the session's key,
   * or the public account's keys or stake key. What a site builds on before
   * it's on chain is those (a Send's change, a session's funding or top-up),
   * and it sees them anyway. Every other output of the wallet's is left to
   * the site's lookups and Koios, as a stranger's is: answered from here, with
   * neither, it would tell a site that a transaction was the wallet's, from
   * another of its accounts or its private balance, and so tie them to the
   * site's (privacy review §2.2). A site's own submits are chained on from its
   * account's `SESSION_DAPP_SIGNED` instead. Never the other network's: the
   * account's keys are the same on both, so its UTxO there would be signed
   * for as the account's.
   */
  private async sentOutputs(network: NetworkName, holder: Holder, view: View, refs: string[]): Promise<KoiosUtxo[]> {
    const { wallet, session, wasm } = this.deps;
    const hashes = new Set(refs.map((r) => r.slice(0, r.indexOf("#"))));
    const sent = (await wallet.withKeys(() => recentlySent(session, network))).filter((s) => hashes.has(s.txHash));
    if (!sent.length) return [];
    const pays = await this.paysHolder(holder, view);
    // WebAssembly's decoder reads one only if it isn't nested too deep.
    return sent.flatMap((s) => (nestsWithin(hexBytes(s.txCbor)) ? outputsOf(wasm, s.txCbor).filter((u) => pays(u.address)) : []));
  }

  /**
   * Whether an address pays the site's account: for a session, its payment
   * key; for the public account, one of its payment keys in range (the
   * view's), or its stake key, as every address it shows carries.
   */
  private async paysHolder(holder: Holder, view: View): Promise<(address: string) => boolean> {
    const { wasm } = this.deps;
    if (holder) return (address) => keysOf(wasm, address).payment === holder.keyHash;
    const stake = keysOf(wasm, view.stake).stake;
    const payment = new Set(
      await this.withDappKeys(holder, ({ cardano }) => view.keys.map((k) => cardano.paymentKeyHash(k.role, k.index))),
    );
    return (address) => {
      const keys = keysOf(wasm, address);
      return (keys.payment !== undefined && payment.has(keys.payment)) || (stake !== undefined && keys.stake === stake);
    };
  }

  /** Whether a site may make the worker ask Koios for `what` now, and counts it if so. */
  private allow(origin: string, what: keyof typeof PER_MINUTE): boolean {
    const recent = this.lastMinute(origin, what);
    const allowed = recent.length < PER_MINUTE[what];
    if (allowed) recent.push(this.deps.now());
    return allowed;
  }

  /** When a site made the worker do `what` in the last minute (`PER_MINUTE`), kept to count more. */
  private lastMinute(origin: string, what: keyof typeof PER_MINUTE): number[] {
    const key = `${what} ${origin}`;
    const now = this.deps.now();
    const recent = (this.asked.get(key) ?? []).filter((t) => now - t < 60_000);
    this.asked.set(key, recent);
    return recent;
  }

  /**
   * The deposit the public account's stake key was registered with, for a
   * transaction that stops its staking with an old-style certificate (kind
   * 1), which doesn't say what comes back: the ledger refunds the deposit
   * recorded at registration, which Koios's `account_info` has (as Staking
   * reads it). Looked up only for such a transaction, as one of the site's
   * lookups (`PER_MINUTE`). None if it can't be read: WebAssembly then won't
   * sign the certificate, as it can't show where the deposit goes.
   */
  private async stakeDeposit(origin: string, network: NetworkName, stake: string, bytes: Uint8Array): Promise<string | undefined> {
    let kinds: number[];
    try {
      kinds = certificateKinds(bytes);
    } catch {
      // WebAssembly says what's wrong with it.
      return undefined;
    }
    if (!kinds.includes(1)) return undefined;
    if (!this.allow(origin, "lookup")) throw refused((lng) => t("dapp.tooManyLookups", { lng }));
    const info = await this.deps.koios(network).accountInfo(stake).catch(() => undefined);
    return info?.status === "registered" && /^\d+$/.test(info.deposit ?? "") ? info.deposit : undefined;
  }

  /**
   * Runs `read` once the site's transaction before this one has been read:
   * however many it sends at once, the wallet's queue holds one of its
   * readings at a time, so the user's own requests and Lock wait for one at most.
   */
  private readInTurn<T>(origin: string, read: () => Promise<T>): Promise<T> {
    const run = (this.txReads.get(origin) ?? Promise.resolve()).then(read, read);
    const done = run.then(
      () => undefined,
      () => undefined,
    );
    this.txReads.set(origin, done);
    void done.then(() => {
      if (this.txReads.get(origin) === done) this.txReads.delete(origin);
    });
    return run;
  }

  /**
   * Reads a site's transaction in WebAssembly, for the user to be asked: one
   * nothing of the wallet's signs, or that it can't read, is refused here.
   * Nothing is read while the window's queue is full (`ask` would refuse it
   * anyway), and a site that has had too many refused this minute has no more
   * read (`PER_MINUTE`), before any Koios request.
   */
  private async readTx(
    origin: string,
    network: NetworkName,
    holder: Holder,
    tx: unknown,
    bytes: Uint8Array,
    inputs: string[],
    collateral: string[],
    partialSign: boolean,
    governance = false,
  ): Promise<{ request: string; summary: DappTxSummary; collateralSpent: boolean; view: View; rows: KoiosUtxo[] }> {
    if (this.waiting.length >= MAX_WAITING || this.waitingFrom(origin) >= MAX_SITE_WAITING) throw refused(BUSY);
    if (this.lastMinute(origin, "unprompted").length >= PER_MINUTE.unprompted) {
      throw refused((lng) => t("dapp.tooManyRefusedSignatures", { lng }));
    }
    const { view, rows } = await this.resolve(network, holder, origin, [...new Set([...inputs, ...collateral])]);
    const collateralSpent = await this.keptApart(network, holder, view, inputs, collateral);
    // A session's stake key is never registered: nothing comes back to it.
    const stakeDeposit = holder ? undefined : await this.stakeDeposit(origin, network, view.stake, bytes);
    const request = JSON.stringify({
      network,
      txCbor: tx,
      keys: view.keys,
      inputs: rows,
      partialSign,
      stakeIndex: holder?.index ?? 0,
      ...(stakeDeposit === undefined ? {} : { stakeDeposit }),
      // The DRep key signs only for a site given governance, and never a session's.
      governance: governance && !holder,
    });
    const { wasm } = this.deps;
    const refuse = (code: number, words: Words) => {
      // Read, and refused without asking the user: it counts.
      this.lastMinute(origin, "unprompted").push(this.deps.now());
      return siteError(code, words);
    };
    let summary: DappTxSummary;
    try {
      summary = await this.withDappKeys(
        holder,
        ({ cardano, oneTime }) =>
          JSON.parse(holder ? wasm.inspectSessionTx(oneTime, request) : wasm.inspectDappTx(cardano, request)) as DappTxSummary,
      );
    } catch (e) {
      // WebAssembly's own message, which the wallet doesn't translate: these two
      // prefixes are Rust's, not keys, and classify the failure for the site.
      const info = (e as Error).message;
      const unreadable = info.startsWith("The wallet can't read") || info.startsWith("bad request");
      throw refuse(unreadable ? APIError.InvalidRequest : TxSignError.ProofGeneration, () => info);
    }
    if (!summary.signs.length) {
      throw refuse(TxSignError.ProofGeneration, (lng) => t("dapp.nothingToSign", { whose: whoseKeys(holder, lng), lng }));
    }
    if (!partialSign && !summary.complete) {
      throw refuse(TxSignError.ProofGeneration, (lng) => t("dapp.needsOtherKeys", { whose: whoseKeys(holder, lng), lng }));
    }
    // A session's stake key is never registered (privacy.md): its return and
    // Disconnect read UTxOs only, so a deposit or rewards under it would be
    // left behind for good. Stopping it stays possible.
    if (holder && summary.certificates.some((c) => c.own && c.kind !== "unregister")) {
      throw refuse(TxSignError.ProofGeneration, (lng) => t("dapp.sessionStakeKey", { lng }));
    }
    return { request, summary, collateralSpent, view, rows };
  }

  /** CIP-95's `getPubDRepKey`: the dApp account's DRep key, its public key in hex, for a site given governance. */
  private async drepKey(holder: Holder, governance: boolean): Promise<string> {
    if (holder) throw refused(NO_GOVERNANCE_SESSION);
    if (!governance) throw refused(NO_GOVERNANCE);
    return this.withDappKeys(holder, ({ cardano }) => (JSON.parse(cardano.drepOf()) as { publicKey: string }).publicKey);
  }

  /**
   * CIP-95's `getRegisteredPubStakeKeys` (`registered`) and
   * `getUnregisteredPubStakeKeys`: the dApp account's one stake key, in the
   * list its standing puts it in (one `account_info`, counted as a lookup).
   */
  private async stakeKeys(origin: string, network: NetworkName, holder: Holder, governance: boolean, registered: boolean): Promise<string[]> {
    if (holder) throw refused(NO_GOVERNANCE_SESSION);
    if (!governance) throw refused(NO_GOVERNANCE);
    if (!this.allow(origin, "lookup")) throw refused((lng) => t("dapp.tooManyLookups", { lng }));
    const { key, stake } = await this.withDappKeys(holder, ({ cardano }) => ({
      key: cardano.stakePublicKey(),
      stake: cardano.stakeAddress(network === "mainnet" ? this.deps.wasm.Network.Mainnet : this.deps.wasm.Network.Preprod),
    }));
    const info = await this.deps.koios(network).accountInfo(stake);
    return (info?.status === "registered") === registered ? [key] : [];
  }

  private async signTx(
    session: DappSession,
    network: NetworkName,
    holder: Holder,
    tx: unknown,
    partialSign: boolean,
    password: boolean,
    governance = false,
  ): Promise<string> {
    const bytes = txBytes(tx);
    let inputs: string[];
    let collateral: string[];
    try {
      inputs = bodyOutpoints(bytes, 0) ?? [];
      collateral = bodyOutpoints(bytes, 13) ?? [];
    } catch {
      throw invalid((lng) => t("dapp.cannotReadTx", { lng }));
    }
    await this.heldForLovejoin(network, holder, inputs, collateral);
    const { request, summary, collateralSpent, view, rows } = await this.readInTurn(session.origin, () =>
      this.readTx(session.origin, network, holder, tx, bytes, inputs, collateral, partialSign, governance),
    );
    const { wasm } = this.deps;
    // For the prompt alone: never refused for it, which would tell the site.
    // Unchecked, the prompt promises nothing (independent review M12).
    const ties = await this.ties(network, holder, summary, rows).catch((e: unknown) => {
      if (isTrap(e)) throw e;
      return undefined;
    });
    const ask: DappAsk = {
      kind: "sign-tx",
      partial: partialSign,
      summary: ties ? { ...summary, paid: summary.paid.map((p, i) => (ties.paid[i] === undefined ? p : { ...p, yours: ties.paid[i] })) } : summary,
      password,
      ...sessionOf(holder),
      ...(collateralSpent ? { collateralSpent } : {}),
      ...(ties ? { ties: ties.all } : {}),
    };
    return this.ask(
      session,
      network,
      ask,
      TxSignError.UserDeclined,
      async () => {
        // Checked again as it's approved (independent review L33): while it
        // waited, the site may have been disconnected or moved to another
        // account, a Lovejoin chain started that needs what it uses, or the
        // user locked a UTxO it spends.
        await this.stillConnected(network, session.origin, holder, view.account);
        await this.heldForLovejoin(network, holder, inputs, collateral);
        await this.keptApart(network, holder, view, inputs, collateral);
        // And which public account's keys signed it, which its outputs are kept as (`ofAccount`).
        const { account, ...signed } = await this.withDappKeys(holder, ({ cardano, oneTime, account }) => ({
          ...(JSON.parse(holder ? wasm.signSessionTx(oneTime, request) : wasm.signDappTx(cardano, request)) as SignedTx),
          account,
        }));
        // What it pays the session's account, recorded before the site has the signature (independent review M4).
        if (holder) await this.deps.sessions.siteSigned(network, holder.index, (tx as string).trim(), signed.summary);
        await this.remember(network, holder, signed.summary, (tx as string).trim(), holder ? undefined : account);
        return signed.witnessSet;
      },
      (tx as string).trim(),
      view.account,
    );
  }

  /**
   * The bytes of a signature a site is waiting for, by the transaction's hash,
   * for the transaction view (tx-view.ts): the site's own transaction, which
   * the wallet did not build, read while the user decides. Nothing else of a
   * waiting request is handed out, and a hash no request is waiting on has no
   * answer.
   */
  waitingCbor(txHash: string): string | undefined {
    const wanted = txHash.trim().toLowerCase();
    return this.waiting.find(
      (w) => w.txCbor !== undefined && w.approval.kind === "sign-tx" && w.approval.summary.txHash.toLowerCase() === wanted,
    )?.txCbor;
  }

  /**
   * Which of the wallet's other accounts a site's transaction pays, or
   * spends from (the inputs the wallet found), which signing ties on chain
   * to the account the site sees: for a site on a private session, every
   * public account the wallet knows, not only the one on screen (their stake
   * keys, and their payment keys in range, as Make public counts them:
   * destination.ts), and the other sessions; for a site on the public
   * account, the sessions. By each paid output, and all together, the public
   * account first. Nothing is asked of anyone for it (independent review
   * M12). Checking the account on screen alone, a payment to another said
   * that no public account was in it (the release review); with the accounts
   * unread, this throws, and the prompt promises nothing.
   */
  private async ties(
    network: NetworkName,
    holder: Holder,
    summary: DappTxSummary,
    rows: KoiosUtxo[],
  ): Promise<{ paid: Array<Tie | undefined>; all: Tie[] }> {
    const { wasm, wallet, sessions } = this.deps;
    const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;
    const indices = (await sessions.indices(network)).filter((i) => i !== holder?.index);
    const account = holder ? await this.publicKeys(network) : undefined;
    const others = await wallet.withKeys(({ oneTime }) =>
      indices.map((index) => ({
        index,
        payment: oneTime.keyHash(index),
        stake: keysOf(wasm, oneTime.rewardAddress(net, index)).stake,
      })),
    );
    const whose = (address: string): Tie | undefined => {
      const { payment, stake } = keysOf(wasm, address);
      if (account && ((payment !== undefined && account.payment.has(payment)) || (stake !== undefined && account.stake.has(stake)))) {
        return "account";
      }
      return others.find((s) => (payment !== undefined && payment === s.payment) || (stake !== undefined && stake === s.stake))?.index;
    };
    const paid = summary.paid.map((p) => whose(p.address));
    const all = [...new Set([...paid, ...rows.map((r) => whose(r.address))].filter((t): t is Tie => t !== undefined))];
    return { paid, all: all.sort((a, b) => (a === "account" ? -1 : b === "account" ? 1 : a - b)) };
  }

  /**
   * The payment keys in range (both chains, as balances count them) and the
   * stake keys of every public account the wallet knows: the one on screen,
   * with those its last balance reading found past the first 20
   * (destination.ts), the dApp account and every other recorded. Derived on
   * the device, asking nobody, as tx-view.ts does. Throws when the accounts
   * can't be read: a check of some of them can't say none is in it.
   */
  private async publicKeys(network: NetworkName): Promise<{ payment: Set<string>; stake: Set<string> }> {
    const { wasm, wallet, session } = this.deps;
    const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;
    const known = (await this.deps.knownAccounts?.()) ?? [];
    const payment = new Set<string>();
    const stake = new Set<string>();
    const add = (cardano: Keys["cardano"]) => {
      for (let i = 0; i < GAP_LIMIT; i++) payment.add(cardano.paymentKeyHash(0, i)).add(cardano.paymentKeyHash(1, i));
      const key = keysOf(wasm, cardano.stakeAddress(net)).stake;
      if (key) stake.add(key);
    };
    const active = await wallet.withKeys(async ({ cardano, account }) => {
      add(cardano);
      const found = await session.get<AccountAddresses>(SESSION_ACCOUNT_ADDRESSES_PREFIX + network);
      for (const k of found?.keys ?? []) payment.add(k);
      return account;
    });
    for (const index of new Set([await this.dappAccount(), ...known])) {
      if (index !== active) await wallet.withAccount(index, ({ cardano }) => add(cardano));
    }
    return { payment, stake };
  }

  /**
   * Keeps a signed transaction's outputs for the site's next transaction:
   * those to the account for it to spend, and every one (the first 64) for a
   * while, so one built on it can be read before it's on chain. `account`:
   * the public account that signed it.
   */
  private async remember(
    network: NetworkName,
    holder: Holder,
    summary: DappTxSummary,
    txCbor: string,
    account?: number,
  ): Promise<void> {
    const outputs: PathedUtxo[] = summary.ownOutputs.map((o) => ({
      role: o.role as 0 | 1,
      index: o.index,
      utxo: {
        tx_hash: summary.txHash,
        tx_index: o.txIndex,
        address: o.address,
        value: o.lovelace,
        stake_address: null,
        payment_cred: null,
        block_height: null,
        inline_datum: o.inlineDatum ? { bytes: o.inlineDatum, value: null } : null,
        datum_hash: o.datumHash,
        asset_list: o.tokens.map((t) => ({
          policy_id: t.policyId,
          asset_name: t.assetName,
          quantity: t.quantity,
          decimals: 0,
          fingerprint: "",
        })),
      },
    }));
    const { wallet, session, wasm, now } = this.deps;
    // WebAssembly has read it already, so it isn't nested too deep.
    const every = outputsOf(wasm, txCbor).slice(0, MAX_CHAINED);
    await wallet.withKeys(async () => {
      const key = SESSION_DAPP_SIGNED + network + suffix(holder);
      const kept = (await session.get<Signed[]>(key)) ?? [];
      const since = now() - CHAIN_MS;
      const next: Signed[] = [
        // Older ones' outputs to others go once they can't be chained on.
        ...kept
          .filter((s) => s.txHash !== summary.txHash)
          .map(({ every: all, ...s }) => (s.signedAt !== undefined && s.signedAt > since ? { ...s, every: all } : s)),
        { txHash: summary.txHash, outputs, every, signedAt: now(), ...(account === undefined ? {} : { account }) },
      ];
      await session.set(key, next.slice(-KEEP_SIGNED));
    });
  }

  private async signData(
    session: DappSession,
    network: NetworkName,
    holder: Holder,
    address: unknown,
    payload: unknown,
    password: boolean,
    governance = false,
  ): Promise<unknown> {
    if (typeof address !== "string") throw invalid((lng) => t("dapp.signerNotString", { lng }));
    // Refused unread, as a transaction over 64 KiB is (independent review M15).
    if (address.length > MAX_ADDRESS_CHARS) throw invalid((lng) => t("dapp.signerTooLong", { lng }));
    if (typeof payload === "string" && payload.length > 2 * MAX_SITE_BYTES) {
      throw invalid((lng) => t("dapp.dataTooLong", { lng }));
    }
    const hex = typeof payload === "string" ? payload.trim() : "";
    if (!/^([0-9a-fA-F]{2})*$/.test(hex)) throw invalid((lng) => t("dapp.dataNotHex", { lng }));
    const { wasm } = this.deps;
    const view = await this.view(network, holder);
    const request = JSON.stringify({
      network,
      keys: view.keys,
      address,
      payload: hex,
      stakeIndex: holder?.index ?? 0,
      governance: governance && !holder,
    });
    let signer: { address: string; key: "payment" | "stake" | "drep" } | null;
    try {
      signer = await this.withDappKeys(
        holder,
        ({ cardano, oneTime }) =>
          JSON.parse(holder ? wasm.sessionDataSigner(oneTime, request) : wasm.dataSigner(cardano, request)) as typeof signer,
      );
    } catch (e) {
      // WebAssembly's own words, which are English.
      throw new DappError({ code: DataSignError.AddressNotPK, info: (e as Error).message });
    }
    if (!signer) {
      throw siteError(DataSignError.ProofGeneration, (lng) => t("dapp.addressNotOurs", { whose: whoseKeys(holder, lng), lng }));
    }
    const text = readableText(hex);
    return this.ask(
      session,
      network,
      {
        kind: "sign-data",
        address: signer.address,
        key: signer.key,
        payload: hex,
        ...(text === undefined ? {} : { text }),
        password,
        ...sessionOf(holder),
      },
      DataSignError.UserDeclined,
      async () => {
        // Still connected, to the same account, as it's approved (independent review L33).
        await this.stillConnected(network, session.origin, holder, view.account);
        return this.withDappKeys(
          holder,
          ({ cardano, oneTime }) =>
            JSON.parse(holder ? wasm.signSessionData(oneTime, request) : wasm.signDappData(cardano, request)) as unknown,
        );
      },
      undefined,
      view.account,
    );
  }

  private async submitTx(origin: string, network: NetworkName, holder: Holder, tx: unknown): Promise<string> {
    const bytes = txBytes(tx);
    let id: string;
    try {
      id = txId(bytes);
    } catch {
      throw invalid((lng) => t("dapp.cannotReadTx", { lng }));
    }
    // The site sends it again while the wallet is still sending it (its own
    // timeout, or Submit pressed twice): that call has the first one's
    // answer. Sent on its own, it would be refused as spending what the
    // first just spent, and heard as a failure (independent review M3).
    const key = `${network} ${origin} ${id}`;
    const sending = this.submitting.get(key);
    if (sending) return sending;
    if (!this.allow(origin, "submit")) {
      // One the wallet keeps as sent for this site is sent already: it hears
      // its id, and Koios isn't asked (final review F12).
      if (await this.sentFor(origin, network, holder, id)) return id;
      throw siteError(TxSendError.Refused, (lng) => t("dapp.tooManySubmits", { lng }));
    }
    const run = this.send(origin, network, holder, bytes, id).finally(() => this.submitting.delete(key));
    this.submitting.set(key, run);
    return run;
  }

  /** Sends a site's transaction through Koios: its id, or what the site hears. */
  private async send(origin: string, network: NetworkName, holder: Holder, bytes: Uint8Array<ArrayBuffer>, id: string): Promise<string> {
    const koios = this.deps.koios(network);
    try {
      await koios.submitTx(bytes);
    } catch (e) {
      if (e instanceof KoiosBusyError && e.maybeSent) {
        // Koios didn't answer, or failed on its side, with the transaction
        // sent: the node may have taken it (independent review M3). Told it
        // failed, a site would build the payment again from other UTxOs, and
        // both could land. So it's kept as sent, what it spends as spent,
        // and it's looked for and sent again a few times; the site then
        // hears its id, as for any submit, and follows it on chain.
        await this.keepSent(origin, network, holder, bytes, id);
        await this.settle(koios, bytes, id);
        return id;
      }
      // One the wallet sent for this site and still keeps as sent is a
      // success, whatever Koios answers it again: in a mempool, it's
      // refused as spending what it spends itself, though tx_status doesn't
      // know it yet; a 429, a node Koios couldn't reach, or another
      // refusal, says nothing of the try the wallet kept. Told it failed,
      // the site would build the payment again from other UTxOs, and both
      // could land (independent review M3, final review F12). Nothing new
      // went out, so nothing more is kept of it.
      if (await this.sentFor(origin, network, holder, id)) return id;
      // Sent already, by the site itself or an earlier call: that's a
      // success. Nothing new went out, so nothing is kept of it: a site
      // resending old transactions can't fill the wallet's memory of what
      // it spent (independent review L7).
      if (e instanceof SpentInputError) {
        const status = await koios.txStatus([id]).catch(() => undefined);
        if (status?.get(id) != null) return id;
      }
      throw new DappError({ code: TxSendError.Failure, info: notSent(e) }, (e as Error).message);
    }
    await this.keepSent(origin, network, holder, bytes, id);
    return id;
  }

  /**
   * Whether the wallet sent `id` for this site's account itself, and keeps
   * it as sent (`keepSent`): for as long as what it spends is held as spent
   * (spent.ts). One the wallet signed counts for any site on this account;
   * one it didn't sign (a site's own) only for the site that sent it, as for
   * building on it (`resolve`). No when that can't be read (locked).
   */
  private async sentFor(origin: string, network: NetworkName, holder: Holder, id: string): Promise<boolean> {
    const since = this.deps.now() - SPENT_KEEP_MS;
    const signed = await this.signed(network, holder).catch((): Signed[] => []);
    return signed.some(
      (s) => s.txHash === id && s.submittedAt !== undefined && s.submittedAt > since && (s.origin === undefined || s.origin === origin),
    );
  }

  /**
   * Keeps a site's transaction as sent: what it spends, and its outputs for
   * the site's next transaction to build on. Once it's gone out, the site
   * hears its id whatever happens here: a wallet locked meanwhile has
   * nothing to keep it in, and telling the site it failed could have it
   * paid twice.
   */
  private async keepSent(origin: string, network: NetworkName, holder: Holder, bytes: Uint8Array, id: string): Promise<void> {
    const { wallet, session, wasm, now } = this.deps;
    const keep = async () => {
      // Apart from what the wallet spent itself, under a cap of its own (spent.ts).
      await rememberSiteSpent(session, bytes);
      const key = SESSION_DAPP_SIGNED + network + suffix(holder);
      const kept = (await session.get<Signed[]>(key)) ?? [];
      // One the wallet didn't sign is kept here too, for this site's next
      // transaction to build on: the wallet's own list of what it sent
      // answers a site only with what pays its account (`sentOutputs`).
      const own: Signed[] = kept.some((s) => s.txHash === id)
        ? kept.map((s) => (s.txHash === id ? { ...s, submittedAt: now() } : s))
        : [
            ...kept,
            {
              txHash: id,
              outputs: [],
              every: nestsWithin(bytes) ? outputsOf(wasm, hexOfBytes(bytes)).slice(0, MAX_CHAINED) : [],
              signedAt: now(),
              submittedAt: now(),
              origin,
            },
          ];
      await session.set(key, own.slice(-KEEP_SIGNED));
      // Home reads the account again, to show what the site did. A private
      // session's site spends only the session's account: the account isn't
      // read again for it, only the private side, which its transaction may
      // pay (independent review M8).
      if (holder) await session.set(SESSION_PRIVATE_STALE_PREFIX + network, true);
      else await session.remove(SESSION_BALANCES_PREFIX + network);
    };
    await wallet.withKeys(keep).catch(() => undefined);
  }

  /**
   * Looks for a site's transaction Koios didn't answer for, and sends it
   * again, a few times, 5 s apart, until the chain shows it or a submit is
   * taken. Sending it again is safe: the ledger takes a transaction once. A
   * refusal says nothing either way (one in a mempool already is refused as
   * spending what's spent), so the site hears its id whatever this finds.
   */
  private async settle(koios: Koios, bytes: Uint8Array<ArrayBuffer>, id: string): Promise<void> {
    const sleep = this.deps.sleep ?? wait;
    for (let i = 0; i < SUBMIT_CHECKS; i++) {
      await sleep(SUBMIT_CHECK_MS);
      const status = await koios.txStatus([id]).catch(() => undefined);
      if (status?.get(id) != null) return;
      try {
        await koios.submitTx(bytes);
        return;
      } catch {
        // In a mempool already, refused, or Koios still not answering: looked for again.
      }
    }
  }
}

/**
 * What a site hears when WebAssembly trapped under its request: nothing of the lock that follows. And when anything
 * else went wrong in words that aren't the connector's, which may be in the user's language (`Words`).
 */
export const SITE_TRAPPED: Words = (lng) => t("dapp.couldNotAnswer", { lng });

/**
 * A site's call, as the worker answers it (sw.ts). WebAssembly that trapped
 * under it outside the wallet's queue is broken for good (wasm.ts): the
 * wallet locks, as it does for a trap under one of its own pages' requests
 * (independent review M15), and the site hears only that it wasn't answered.
 */
export async function answerSite(
  dapp: DappService,
  wallet: { trapped: () => Promise<void> },
  session: DappSession,
  method: DappMethod,
  args: unknown[],
): Promise<unknown> {
  try {
    return await dapp.call(session, method, args);
  } catch (e) {
    if (!isTrap(e)) throw e;
    await wallet.trapped();
    throw new DappError({ code: APIError.InternalError, info: SITE_TRAPPED("en") });
  }
}

/**
 * What an approved request that failed tells the site, and the window: why, which the window shows, may be in the
 * user's language (another service's words), so the site hears only that it went wrong (`Words`).
 */
function failed(approval: DappApproval, e: unknown): DappError {
  const code =
    approval.kind === "sign-tx"
      ? TxSignError.ProofGeneration
      : approval.kind === "sign-data"
        ? DataSignError.ProofGeneration
        : APIError.InternalError;
  return new DappError({ code, info: SITE_TRAPPED("en") }, e instanceof Error ? e.message : String(e));
}

/**
 * Why a site's transaction wasn't sent, in English (`Words`): Koios's own words are in the user's language, so the
 * site hears the kind of refusal it can act on, and otherwise that it wasn't sent.
 */
function notSent(e: unknown): string {
  if (e instanceof SpentInputError) return t("koios.spentInput", { lng: "en" });
  if (e instanceof KoiosError && e.trouble === "rate-limited") return t("koios.rateLimited", { lng: "en" });
  return t("dapp.notSent", { lng: "en" });
}

/** A private session's funding, sent and waiting for Koios to see it. */
const funding = (w: Waiting) => w.approval.kind === "connect" && !!w.approval.funding;

/**
 * The session-storage key's ending for whose reading or signed outputs it is: a private session's, or, for a
 * reading, the public account other than 0 it is (account 0 keeps the key it always had).
 */
const suffix = (holder: Holder, account?: number) => (holder ? `:${holder.index}` : account ? `@${account}` : "");

/**
 * Whether a transaction the wallet kept is the reading's account's: a session's list is its own, and on the public
 * side, the dApp account's that signed it. One kept before several accounts, or signed for none, is account 0's. The
 * list itself stays one per network, so a site resending one sent before a change still hears its id (`sentFor`).
 */
const ofAccount = (s: Signed, view: View) => (s.account ?? 0) === (view.account ?? 0);

/** A request's `session`, for a site connected to one. */
const sessionOf = (holder: Holder) => (holder ? { session: holder.index } : {});

/**
 * A private session's collateral: the funding's 5 ₳ of pure ADA, kept out of
 * what a site may spend, as the public account's is.
 */
function sessionCollateral(utxos: PathedUtxo[]): { spendable: PathedUtxo[]; collateral?: PathedUtxo } {
  const collateral = utxos.find((p) => BigInt(p.utxo.value) === SESSION_COLLATERAL && !p.utxo.asset_list?.length);
  return { spendable: utxos.filter((p) => p !== collateral), ...(collateral ? { collateral } : {}) };
}

function remove<T>(list: T[], drop: (item: T) => boolean): void {
  for (let i = list.length - 1; i >= 0; i--) if (drop(list[i]!)) list.splice(i, 1);
}

/**
 * The places in the window's queue those waiting for the unlock take: one
 * each, but a site's `enable()` calls one together, as they share one
 * connect question once it's unlocked (independent review L35).
 */
function unlockPlaces(unlocking: Unlocking[]): number {
  const enabling = new Set(unlocking.filter((u) => u.enable).map((u) => u.session.origin));
  return unlocking.filter((u) => !u.enable).length + enabling.size;
}

/** A transaction's output, as WebAssembly's `ogmiosUtxos` gives it (Ogmios v6). */
interface OgmiosUtxo {
  transaction: { id: string };
  index: number;
  address: string;
  /** `ada.lovelace`, and each policy's tokens by name. */
  value: Record<string, Record<string, number | string>>;
  datum?: string;
  datumHash?: string;
}

/** A transaction's outputs, as Koios lists UTxOs; none if it can't be read. */
function outputsOf(wasm: AccountDeps["wasm"], txCbor: string): KoiosUtxo[] {
  let rows: OgmiosUtxo[];
  try {
    // Amounts past 2^53 would lose digits as JSON numbers: read as text.
    rows = JSON.parse(wasm.ogmiosUtxos(txCbor).replace(/:(\d{16,})([,}])/g, ':"$1"$2')) as OgmiosUtxo[];
  } catch (e) {
    if (isTrap(e)) throw e;
    return [];
  }
  return rows.map(({ transaction, index, address, value, datum, datumHash }) => ({
    tx_hash: transaction.id,
    tx_index: index,
    address,
    value: String(value.ada?.lovelace ?? 0),
    stake_address: null,
    payment_cred: null,
    block_height: null,
    inline_datum: datum ? { bytes: datum, value: null } : null,
    datum_hash: datumHash ?? null,
    asset_list: Object.entries(value)
      .filter(([policy]) => policy !== "ada")
      .flatMap(([policy, names]) =>
        Object.entries(names).map(([name, quantity]) => ({
          policy_id: policy,
          asset_name: name,
          quantity: String(quantity),
          decimals: 0,
          fingerprint: "",
        })),
      ),
  }));
}

const hexBytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));
const hexOfBytes = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * An address's payment key hash and stake key hash (hex), where it has them
 * (CIP-19's header): a base address both, an enterprise or pointer address
 * its payment key, a reward address its stake key. Script hashes aren't
 * keys: none. Nothing for one that can't be read.
 */
function keysOf(wasm: AccountDeps["wasm"], address: string): { payment?: string; stake?: string } {
  let hex: string;
  try {
    hex = wasm.cip30Address(address);
  } catch (e) {
    if (isTrap(e)) throw e;
    return {};
  }
  const kind = Number.parseInt(hex.slice(0, 1), 16);
  const payment = kind < 8 && kind % 2 === 0 ? hex.slice(2, 58) : undefined;
  const stake = kind === 0 || kind === 1 ? hex.slice(58, 114) : kind === 14 ? hex.slice(2, 58) : undefined;
  return { ...(payment?.length === 56 ? { payment } : {}), ...(stake?.length === 56 ? { stake } : {}) };
}

function hexOf(value: unknown, problem: Words): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string" || !/^([0-9a-fA-F]{2})+$/.test(value.trim())) throw invalid(problem);
  return Uint8Array.from(value.trim().match(/../g)!, (h) => Number.parseInt(h, 16));
}

/**
 * A site's transaction, refused by its length before any of it is read: one
 * over 64 KiB is nothing Cardano would take, and reading it would only cost
 * the worker time and memory.
 */
function txBytes(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value === "string" && value.length > 2 * MAX_SITE_BYTES) {
    throw invalid((lng) => t("dapp.txTooLarge", { lng }));
  }
  return hexOf(value, (lng) => t("dapp.txNotHex", { lng }));
}

/** A whole number as CBOR, hex. */
function cborUint(n: bigint): string {
  if (n < 0n) throw invalid((lng) => t("dapp.amountNegative", { lng }));
  const hex = (width: number) => n.toString(16).padStart(width, "0");
  if (n < 24n) return hex(2);
  if (n < 0x100n) return `18${hex(2)}`;
  if (n < 0x10000n) return `19${hex(4)}`;
  if (n < 0x100000000n) return `1a${hex(8)}`;
  return `1b${hex(16)}`;
}

/** The payload as text, when it's UTF-8 with nothing unprintable but line breaks and tabs. */
function readableText(hex: string): string | undefined {
  const bytes = Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) ? undefined : text;
  } catch {
    return undefined;
  }
}

/** What a site asked `getUtxos` to cover. */
interface Wanted {
  lovelace: bigint;
  tokens: Array<{ policyId: string; assetName: string; quantity: string }>;
}

const largestFirst = (utxos: PathedUtxo[]) => [...utxos].sort((a, b) => Number(BigInt(b.utxo.value) - BigInt(a.utxo.value)));

/**
 * Enough UTxOs to cover `wanted`, or null: those holding each token first
 * (the most of it first), then ADA, largest first.
 */
export function cover(utxos: PathedUtxo[], wanted: Wanted): PathedUtxo[] | null {
  const picked = new Set<PathedUtxo>();
  const held = (p: PathedUtxo, t: Wanted["tokens"][number]) =>
    BigInt(p.utxo.asset_list?.find((a) => a.policy_id === t.policyId && a.asset_name === t.assetName)?.quantity ?? "0");
  for (const t of wanted.tokens) {
    let need = BigInt(t.quantity);
    for (const p of [...picked]) need -= held(p, t);
    const holders = utxos.filter((p) => !picked.has(p) && held(p, t) > 0n).sort((a, b) => Number(held(b, t) - held(a, t)));
    for (const p of holders) {
      if (need <= 0n) break;
      picked.add(p);
      need -= held(p, t);
    }
    if (need > 0n) return null;
  }
  let lovelace = wanted.lovelace;
  for (const p of picked) lovelace -= BigInt(p.utxo.value);
  for (const p of largestFirst(utxos.filter((u) => !picked.has(u)))) {
    if (lovelace <= 0n) break;
    picked.add(p);
    lovelace -= BigInt(p.utxo.value);
  }
  return lovelace > 0n ? null : [...picked];
}

/** CIP-30's `paginate`: `{ page, limit }`, pages from 0; past the end, a paginate error with how many there are. */
export function paginate<T>(items: T[], page: unknown): T[] {
  if (page === undefined || page === null) return items;
  const { page: n, limit } = page as { page?: unknown; limit?: unknown };
  if (!Number.isInteger(n) || !Number.isInteger(limit) || (n as number) < 0 || (limit as number) < 1) {
    throw invalid((lng) => t("dapp.paginate", { lng }));
  }
  const start = (n as number) * (limit as number);
  if (start > 0 && start >= items.length) throw new DappError({ maxSize: items.length });
  return items.slice(start, start + (limit as number));
}
