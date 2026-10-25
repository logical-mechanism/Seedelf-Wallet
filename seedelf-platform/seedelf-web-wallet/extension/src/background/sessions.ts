// Private sessions (roadmap chunk 15, step 2): a one-time account funded from
// the private balance, used for a swap through Minswap's aggregator, and
// brought back into the private balance. The public account isn't in any of
// its transactions, though the funding's own inputs lead back to it when they
// were money the user made private (privacy review §2.12).
//
// out     a Seedelf spend (Make public's builder, giveme.my's collateral)
//         pays the session's account twice: the swap with its costs, and
//         5 ₳ as the account's own collateral. The session is recorded
//         before it's sent, so this device never uses its index twice, and
//         the chain is asked first whether another browser used it since.
// swap    once that's on chain, Minswap builds the swap for the account
//         (its aggregator takes only a sender); WebAssembly reads it against
//         the session's key alone, and the key signs it. The DEX's batchers
//         fill the order, paying the account.
// cancel  after Stop, an order that isn't filled is cancelled by the
//         wallet's own cancel (WebAssembly's buildOrderCancel, chunk 24),
//         read the same way and signed by the session's key, and by its
//         stake key too for a SundaeSwap V3 order; the refund comes back to
//         the account.
// back    everything at the account moves into the private balance under
//         fresh registers (the CLI's external sweep), signed by the key.
//
// A swap runs itself (chunk 15b). Sending the funding is the one approval;
// after it, `advance` takes whatever step comes next, from the record and the
// chain, so calling it again is always safe. The session's page calls it, an
// alarm calls it every minute while a swap runs and the wallet is unlocked,
// and unlocking calls it, so an interrupted swap carries on where it was. It
// signs only within the approval: the session's UTxOs (a swap against
// Danogo's pools also spends the pools' and a collateral Minswap signed
// already), its key alone, no more paid out than was funded (against the
// pools, no more spent, net), paid only to the session, to an order the
// wallet can cancel itself (checkOrder, whose own cancel the wallet builds
// and runs first) or the pools it spends, and to Minswap's quoted fee. The
// order's minimum is what the wallet asks Minswap for, at least the least
// approved; Minswap builds the order, and its minimum isn't read back.
// Anything else pauses for the user. Stop is the user's alone: an order that
// waits is cancelled (a swap against the pools gone out has none), then
// everything comes back. The approval also says how it comes back: through
// Lovejoin (as Settings starts it, the pool read once at Review) or
// directly, kept with the swap (`auto.direct`); Stop can make it direct
// (privacy review §2.7, §2.8, §4.1).
// Every transaction is recorded before it's submitted.
//
// A site's private session (chunk 15c, private CIP-30) is the same account,
// connected to a site instead of used for a swap: the connector (dapp.ts)
// funds it from its window, the site uses it as an ordinary wallet, and
// Top up and Bring it back work from the wallet. Nothing runs by itself, and
// its return doesn't end it: what's still open at the site may pay the
// account later. Disconnecting ends it, once the account is empty.
//
// The accounts are account 24301', payment key 0/index and stake key 2/index,
// both the session's own, so no two sessions share a key (WebAssembly's
// OneTimeAccounts). Sessions recorded before that have the shared Seedelf
// staking part, and keep it: that's where their money is. The list
// of sessions is a sealed private record per network. The wallet reads a
// session's account only while a swap runs or when asked: one Koios request
// for all the open ones, and one tx_status for what's waiting.

import { t } from "../i18n";
import { NETWORKS, type NetworkName } from "../networks";
import type {
  AtStake,
  DappTxSummary,
  LeftBehindUtxo,
  LeftOutUtxo,
  LovejoinFunding,
  Paid,
  PendingTx,
  RetryReason,
  SessionAuto,
  SessionBackSummary,
  SessionOrder,
  SessionOutSummary,
  SessionPause,
  SessionScan,
  SessionTx,
  SessionTxReview,
  SessionView,
  SwapAsk,
  SwapLovejoin,
  SwapQuote,
  SwapSide,
  SwapTokenInfo,
  TokenQuantity,
  UnsentWhy,
} from "../shared/rpc";
import { merged, sessionClass, type HistoryClass } from "../shared/histories";
import { DEFAULT_PREFERENCES, type LovejoinDelay, type LovejoinDepth, type LovejoinWidth } from "../shared/preferences";
import tokenList from "../tokens/list.json";
import { bodyOutpoints, txId, txInputs, txWithdrawals } from "./cbor";
import { CollateralError, CollateralRefusedError, StaleReviewError } from "./collateral";
import {
  KoiosBusyError,
  KoiosError,
  measurable,
  SpentInputError,
  type KoiosAccountTx,
  type KoiosTrouble,
  type KoiosUtxo,
} from "./koios";
import {
  builtOutputs,
  againstPools,
  DANOGO_POOL,
  MinswapError,
  outOfPlace,
  SUNDAE_V3,
  uncheckedProtocols,
  witnessedKeys,
  type BuiltOutput,
  type Estimate,
  type Minswap,
  type MinswapTrouble,
  type RouteLeg,
} from "./minswap";
import {
  CHAIN_CUT,
  CHAIN_PUMP_MS,
  chainBoxes,
  ChainGone,
  chainOwner,
  chainWindow,
  chainRetryMs,
  checkBoxes,
  mostBootstrap,
  MAX_MIX_BOXES,
  MAX_TOKEN_DEPOSIT_BOXES,
  LovejoinSkipped,
  firstTries,
  mayBeIn,
  mixesPerBox,
  pumpChain,
  secureRandom,
  sentAlready,
  SpentUnread,
  TAIL_KEEP_MS,
  tailWaiting,
  UNLOCK_WAIT_MS,
  unlockWait,
  valuesOf,
  wayOver,
  type ChainProgress,
  type ChainWay,
  type CollateralTail,
  type LovejoinChain,
  type LovejoinPool,
  type LovejoinService,
} from "./lovejoin";
import { GIVEME_BEHIND_MS, holdWaiting, partsOf, reviewParts, splitParts, unsplit, type Waiting } from "./parts";
import { pendingKey } from "./pending";
import { UnreadableRecordError, type PrivateStore } from "./private-store";
import { CONTRACT_V1, ownedUtxos } from "./balances";
import { forgetContractView, readContractView } from "./contract-scan";
import { chainStatus, type Feed, type Watching } from "./feed";
import {
  carried,
  changeHistory,
  keep,
  keepParts,
  measureLocally,
  nothingToSpend,
  partKey,
  PARTS_RESERVED,
  readContract,
  send,
  spendable,
  spentHistories,
  whole,
  type Classes,
  type Kept,
  type OutRef,
  type ScriptSpendDeps,
  type SpendWhat,
} from "./script-spend";
import { forgetSpent, outpoint, readFresh, rememberSpent, reservedSet, spentSet, unspent } from "./spent";
import { SESSION_PRIVATE_STALE_PREFIX, WalletLocked, WASM_BROKEN, type Keys } from "./wallet";
import { isTrap } from "./wasm";

/** chrome.storage.session: a session's funding payment, built and waiting for Send. */
export const SESSION_OUT = "seedelf.session.out";
/** chrome.storage.session: a swap Minswap built, or the wallet's own cancel, read and waiting for Send. */
export const SESSION_TX = "seedelf.session.tx";
/** chrome.storage.session: a session's return, signed and waiting for Send. */
export const SESSION_BACK = "seedelf.session.back";
/** chrome.storage.session: a site's private session's funding, built and waiting for Send in the connector's window. */
export const SESSION_SITE_OUT = "seedelf.session.site-out";
/** chrome.storage.session: a top-up of a site's private session, built and waiting for Send. */
export const SESSION_TOP_UP = "seedelf.session.top-up";
/** chrome.storage.session: Bring everything back's returns, one per session, built and waiting for Send. */
export const SESSION_CLAIM = "seedelf.session.claim";
/** chrome.storage.session: a mix session's funding (the Lovejoin tile, from the private balance), built and waiting for Send. */
export const SESSION_MIX_OUT = "seedelf.session.mix-out";
/** chrome.storage.session: a return's chain through Lovejoin still being sent, per session: `seedelf.session.chain.<network>.<index>`. */
export const SESSION_CHAIN_PREFIX = "seedelf.session.chain.";

/** Each session's own collateral, as the public account's. */
export const SESSION_COLLATERAL = 5_000_000n;
/**
 * Room in the funding for the swap's fee and the change it leaves: it all comes back. Where the swap comes back
 * directly, what's left of it beside the collateral's reserve pays for that collateral's mix and the sweep after it,
 * which is why a swap takes the chain's reserve (tailReserve; 1.6.0's release review, 323-rust#1).
 */
export const SWAP_MARGIN = 2_000_000n;

/** The pool a swap's review takes the token it gets into (SessionService tokenPool), and those it could. */
interface TokenChoice {
  unit: string;
  works: LovejoinPool[];
  named: string | null | undefined;
  chosen?: LovejoinPool;
  rooms?: Map<string, { others: number; free: number }>;
  /** The chosen pool's boxes can't pay their own way back today: chosen as any pool, and said (the owner's call 34). */
  stuck?: true;
}
/** About what bringing one Lovejoin box back costs, paid from the box: a 1-box withdraw measured 0.2897 ₳ on mainnet. */
export const LOVEJOIN_WITHDRAW_ESTIMATE = 300_000n;
/** A funding payment the chain doesn't have after this long never reached it. */
const FAILED_AFTER_MS = 20 * 60_000;
/** A built transaction is only sent within this long; after that, build again. */
const BUILT_TTL_MS = 10 * 60_000;
/** A step's transaction that Koios never took is built again after this long, if the chain hasn't got it. */
const RESEND_AFTER_MS = 2 * 60_000;
/** So is one the chain still hasn't got after this long. */
const LOST_AFTER_MS = 15 * 60_000;
/** A step's copy built again after it went unseen is looked for this long: Koios may have taken it all the same. */
const REPLACED_WATCH_MS = 2 * 60 * 60_000;
/** The runner reads a session's chain at most this often, unless the user asks. */
export const READ_EVERY_MS = 15_000;
/**
 * How many fills back what's at a spent Splash order's address is followed
 * to the session's own order (liveOrders): fills in parts between two reads,
 * one Koios request each.
 */
const REMNANT_HOPS = 8;

/**
 * Who takes a session's step: the user (`asked`: now, whatever the last
 * reading), the alarm or a page watching it (`run`), or the run as the
 * wallet unlocks (`unlock`), which sends nothing (waits).
 */
type Run = "asked" | "run" | "unlock";

/**
 * How long to wait after `tries` failures in a row: 30 s, doubling, and never
 * more than five minutes. Minswap's rate limit clears within a minute, and a
 * funding Minswap hasn't seen yet shows up within a block or two.
 */
/**
 * How many one-time accounts a probe for a new session's index asks Koios about once the next is used (freshIndex),
 * and the restore scan's at a time, whose run of them all unused ends it (scan).
 */
export const INDEX_PROBE = 20;

/** The most one-time accounts the restore scan walks: a bound far past any wallet's use, 100 requests. */
const SCAN_MOST = 2_000;

export const retryAfterMs = (tries: number) => Math.min(30_000 * 2 ** (tries - 1), 5 * 60_000);

const MINSWAP_REASON: Record<MinswapTrouble, RetryReason> = {
  "rate-limited": "minswap-rate-limited",
  silent: "minswap-silent",
  "funding-unseen": "funding-unseen",
  "build-failed": "minswap-build-failed",
};
const KOIOS_REASON: Record<KoiosTrouble, RetryReason> = { "rate-limited": "koios-rate-limited", silent: "koios-silent" };

/**
 * Why a swap's step failed, as the code its retry line is worded from
 * (Swaps.tsx): from what failed, never from what it said, which is in the
 * language the worker had then, and the page may be in another by now.
 */
function retryReasonOf(e: unknown): RetryReason {
  if (e instanceof MinswapError && e.trouble) return MINSWAP_REASON[e.trouble];
  if (e instanceof KoiosError && e.trouble) return KOIOS_REASON[e.trouble];
  return "other";
}

type RecordedTx = SessionTx & {
  /** Koios never took it: turned away, or never sent. One Koios didn't answer may have gone, and isn't marked. */
  unsent?: boolean;
  /**
   * Why a funding or a top-up was turned away, as a code the page words
   * (unsentWhyOf): a failed session gives its reason (chunk 23's second
   * review, DX-5). None when it wasn't known.
   */
  why?: UnsentWhy;
  /** Recorded, and on its way to Koios. */
  sending?: boolean;
  /**
   * A part of a funding in parts that never landed: turned away, never sent after one before it was, or not seen in
   * time. Its session's funding is short, and it holds nothing back: what did land waits to be brought back (the
   * owner's call, 2026-10-21). One that lands after all is the funding's again (`confirmed`), and the session goes on.
   */
  missed?: boolean;
  /**
   * A part of a funding in parts held to go once the part before it is in a block (parts.ts), not sent yet: neither
   * late nor missed while the parts' record has it still to go (`stillWaiting`). Its clock (`at`) starts as it goes
   * (partsMayGo); one a lock wiped from that record never goes, and its clock is the record's.
   */
  waits?: boolean;
  /**
   * The chain didn't show it in time, and its step is built again. It may
   * still land (Koios didn't answer, or took it late), so it's still looked
   * for: if it lands, it's the step, and the copy built after it can't land.
   */
  replaced?: boolean;
  /**
   * What it spends (`txhash#index`), when Koios didn't answer it: counted as
   * spent meanwhile, and freed once its step is built again or it's dropped
   * (act), so the next copy, or a return, can take them. The ledger lets only
   * one of the two land.
   */
  inputs?: string[];
  /**
   * What a cancel, or a swap against the pools, that Koios took spends
   * (`txhash#index`), or that one sent again and refused as spent spends
   * while an earlier copy may be on its way (sendRecorded, cross-area review
   * X01): freed as `inputs` are once it's given up and its step
   * is built again (act), since it may never land though Koios took it (the
   * batcher's fill beat the cancel to the order, someone else's swap took the
   * pool first). Left counted spent, the cancel's would hold the swap's change
   * back for good, and the swap built again would read as spending what isn't
   * the session's (release review C03). An order swap's and a return's stay
   * counted spent until the spent set lets them go, as they always did.
   */
  held?: string[];
  /** A swap's orders: its outputs to the DEXes' contracts (`txhash#index`), recorded before it's sent. */
  orders?: string[];
  /**
   * A swap against a DEX's pools (Danogo's, chunk 24), with no order. Its
   * proceeds come in itself, so once it lands it's the fill.
   */
  againstPools?: boolean;
  /**
   * A return whose private history isn't written yet: what its review said,
   * recorded with it before it's sent, and gone once its history is. One
   * Koios didn't answer, or that a lock or a restart cut off, is written
   * once the chain shows it (noteLanded), as the wallet's watch does for its
   * own (independent review M7).
   */
  summary?: Pick<SessionBackSummary, "index" | "lovelace" | "tokens" | "fee">;
  /**
   * What a funding or a top-up pays the session's account (`txhash#index`),
   * recorded before it's sent: the session ends only once Koios shows each
   * spent (ownGone, independent review M4). None on one from before. A
   * session the restore scan found has on its funding what the scan read at
   * its account, whatever paid it there (1.5.0's release review, C02).
   */
  outs?: string[];
  /**
   * A top-up's: a listing of its account has shown what it pays there
   * (listNow), so it reached the account, whatever spent it since. tx_status
   * confirming it doesn't say so: that can come before any listing does,
   * and a top-up taken for gone then would let a second 5 ₳ go (1.5.0's
   * release review, C04).
   */
  listed?: boolean;
  /** A swap's: the least its order asks for, recorded before it's sent (independent review L24). */
  minAmountOut?: string;
};

/** A return's transactions: directly, or through Lovejoin, a chain. */
const RETURNS: ReadonlySet<SessionTx["kind"]> = new Set(["back", "deposit", "mix"]);

/** The steps whose transaction is built again when it goes unseen (a chain's own are sent again as they are). */
const REBUILT: ReadonlySet<SessionTx["kind"]> = new Set(["swap", "cancel", "back"]);

/** A swap that runs itself: what the user approved with the funding, and how it's going. */
interface AutoRecord {
  /**
   * `aggregatorFee`: Minswap's, as quoted; none on sessions from before, which pay it no fee. `againstPools`: the
   * quote approved went through a DEX's pools (Danogo's), so its review didn't say the wallet relies on Minswap for
   * the minimum: the runner places it against the pools or not at all (order, release review C09). None on one
   * approved as an order, or from before: either goes.
   */
  approved: { minAmountOut: string; fund: SwapQuote["fund"]; aggregatorFee?: string; againstPools?: boolean };
  paused?: SessionPause;
  /**
   * The last failure, and why as a code (retryReasonOf): none on one recorded before the codes, whose words are
   * English. `cbor`: what a build Minswap couldn't run came with (MinswapError), the next failure's replacing it.
   */
  retry?: { at: number; error: string; reason?: RetryReason; tries: number; cbor?: string };
  /** When the user pressed Stop. */
  stopping?: number;
  /** When the runner saw the order filled (`partly`: part of it, the rest refunded). */
  filled?: number;
  partly?: boolean;
  /** When the runner saw the order refunded: nothing of it filled (independent review M18). */
  refunded?: number;
  /** When the runner found the funding never reached the chain. */
  failed?: number;
  /**
   * When the runner first found it stopped and waiting on an order of the
   * swap that isn't spent and that Koios can't find yet, so the wallet can't
   * cancel it yet: what's left waits at the account (independent review
   * L16). Only the page reads it. Cleared once that's over: the order is
   * spent, or found and cancelled (chunk 24, Step 3). Before Step 3 the
   * runner wrote it for an order Minswap didn't list.
   */
  orderOpen?: number;
  /**
   * Its next step, found as the wallet unlocked, waits until then (ms): a
   * fresh draw inside the stretch the unlock keeps the wallet open, so it
   * doesn't go out the moment the wallet unlocks (privacy review §3.1). Kept
   * if a lock comes first: a later unlock doesn't draw it again, and it goes
   * at the next run after that unlock's, so it never waits for good.
   */
  unlockWait?: number;
  /**
   * The unlock (the wallet's `unlockedAt`) that drew its wait: whichever
   * run or page finds its step first after an unlock draws it, not only the
   * unlock's own run, and only once (waits, independent review L10, L12).
   */
  unlockDrawn?: number;
  /**
   * How it comes back, as approved (privacy review §4.1): true, directly;
   * false, through Lovejoin, whatever Settings says since. Stop can make it
   * direct. None on a swap from before: as Settings has it.
   */
  direct?: boolean;
  /**
   * Through Lovejoin, how deep and how long, as its approval showed them:
   * Settings changes swaps started later (independent review L21). None on
   * a swap from before, or one that comes back directly: as Settings has it.
   * `width`: four boxes a mix, as approved (chunk 34's D3); none, three.
   * `tokens`: the pool approved for each token, by its unit, a null for one
   * approved to come back directly (chunk 34's 34e): its return never takes
   * a token into another pool than its review showed. None, from before: its
   * tokens come back directly, as they did. `tokenBoxes`: how many boxes of
   * each its review showed, by the token's unit, which its return takes no
   * more of, whatever the fill brought (34e's review, 10).
   */
  lovejoin?: {
    depth: LovejoinDepth;
    delay: LovejoinDelay;
    width?: 4;
    tokens?: Record<string, string | null>;
    tokenBoxes?: Record<string, number>;
    /** What its funding added for those boxes, in lovelace, beside the swap's own (`approved.fund`, which withinFunding holds the swap to). */
    fund?: string;
  };
  /**
   * The transactions the runner took for its order's fill or refund (outcomeOf): a batcher's, not the session's
   * own, which its return may take into a token's pool all the same, since the proceeds are the user's (chunk 34's
   * 34e). None from before.
   */
  fills?: string[];
}

interface SessionRecord {
  index: number;
  /**
   * Its address has its own stake key, `2/index` (chunk 15b). Sessions from
   * before have the shared Seedelf staking part, and keep it.
   */
  ownStake?: boolean;
  createdAt: number;
  txs: RecordedTx[];
  /**
   * Its funding went as this many transactions, the first `parts` of `txs` (fundingOf), when one couldn't spend
   * enough UTxOs (the owner's test of 1.6.0: selling a token spread over more UTxOs than one spends). It's funded
   * only once every one has landed: "if it requires y parts but y-k come in then its not complete and is basically
   * equal to the one time account being not funded" (the owner, 2026-10-21). None: one, as every funding before.
   */
  parts?: number;
  swap?: SessionView["swap"];
  /** Set on sessions started since swaps run themselves. */
  auto?: AutoRecord;
  /**
   * Its swap's orders, from a session from before each copy of a swap kept
   * its own (RecordedTx `orders`): those of the copy sent last.
   */
  orders?: string[];
  /** A site's private session (private CIP-30), rather than a swap. */
  site?: { origin: string };
  /**
   * A funding of it paid COLLATERAL_TAIL_RESERVE beside its collateral, for that collateral to be mixed on its way
   * into a 5 ₳ pool when it comes back (the owner, 2026-10-23, tailReserve): its boxes are counted on what's left
   * after it (ChainWay `collateralReserve`).
   */
  collateralReserve?: true;
  /**
   * A mix from the Lovejoin tile, rather than a swap: once funded, its boxes
   * go through Lovejoin and the rest comes back, one chain, run by itself.
   * `again`: the wallet's boxes in the pool, mixed again with no deposit;
   * `publicToo`, those a mix from the public account put in too (the user
   * asked). `skipped`: why Lovejoin was left out, when it was. `seed`: a
   * deposit with no mixes, from before chunk 34; `bootstrap`, one since,
   * whose boxes are held in the pool until brought back by hand. `pool`: the
   * token pool it goes into, by its id (none: the classic pool), whose token
   * its funding paid with the ADA.
   */
  mix?: {
    boxes: number;
    again?: boolean;
    publicToo?: boolean;
    seed?: boolean;
    bootstrap?: boolean;
    pool?: string;
    skipped?: string;
    /** Funded for four boxes a mix (chunk 34's D3): its chain goes four wide, or three if four can't. None: three. */
    width?: 4;
    /** Cleared from Lovejoin's Your mixes (the owner's test of 1.6.0): the hub's list alone reads it. */
    cleared?: true;
    /**
     * A Bootstrap funded with no collateral and its way back's reserve in its place (1.6.0's release review,
     * 318-rust#0): its return puts none up, so 5 ₳ of ADA alone at its account, its own funding in a pool whose boxes
     * make it so, stays a coin its deposit spends (323-worker#4). None: a Bootstrap funded with its 5 ₳ (before
     * 62162483), whose return puts that up and merges; or with neither (62162483 until that review).
     */
    noCollateral?: true;
  };
  /**
   * The latest return through Lovejoin: how many transactions its chain has,
   * the return last (`last`), and when it began to be sent (`at`), recorded
   * before the first is sent, so its progress shows as they're sent and
   * confirmed. `stopped`: why a transaction of it couldn't be sent, when one
   * couldn't. `from`: a collateral's mix built again (tailChain), when the
   * chain it goes on with began, whose transactions went in (chainSoFar).
   */
  chain?: { total: number; last: string; at: number; stopped?: string; from?: number };
  /**
   * Why its latest return left Lovejoin out, though its spare ADA would have
   * paid for a box (a mix's is `mix.skipped`): set when that return is sent,
   * cleared when one goes through Lovejoin.
   */
  lovejoinSkipped?: string;
  /** What's at its account that no return takes (SessionView's). It doesn't hold the session open. */
  leftBehind?: LeftBehindUtxo[];
  /**
   * When a return last found nothing at its account that pays for its own
   * way back (all of it left behind), the session's own money among it: a
   * mix of the boxes again then has no chain to send, so Lovejoin may bring
   * them back meanwhile (independent review H1). Cleared once a return is
   * built again.
   */
  nothingBack?: number;
  /**
   * What a site's own transactions, signed for its private session, pay the
   * session's account (`txhash#index`), recorded before the site has the
   * signature (siteSigned, independent review M4): the newest SITE_OUTS_KEPT.
   */
  siteOuts?: string[];
  /**
   * What its latest return brings back at once, as that return's review said
   * (a chain's boxes come later): kept past its history's summary, so a
   * finished swap can say what it got (chunk 23's second review, DX-5).
   */
  received?: Pick<SessionBackSummary, "lovelace" | "tokens">;
  /**
   * What's at a spent Splash order's address that reads as the session's
   * order, by the transaction that put it there (liveOrders, release review
   * C02): `from`, a fill of the swap's own order, or of what one left, so
   * what it left there is the session's order still; `not`, anyone else's,
   * however its datum reads. Each is asked of Koios once.
   */
  remnants?: { from: string[]; not: string[] };
  /**
   * Found by the restore scan (O5, chunk 27), not started on this device:
   * when (`at`), and what its key signed or this phrase's private balance
   * paid it beside its funding (`own`: a funding's other parts, a top-up),
   * whose outputs at the account its return takes as the session's own, as
   * a site's (siteOuts).
   * Its record holds its funding (its first transaction, with what the scan
   * read at the account as its `outs`) and the swaps that placed orders the
   * account can cancel. What it was for isn't known: it has no swap, site or
   * mix, and comes back by hand. Until this device sends something for it, it
   * also ends once nothing at its account would come back (listNow): when
   * its record holds a swap, only once that has held since a refresh at
   * least LOST_AFTER_MS before, the first refresh to find it so (`quietAt`),
   * since its order's end pays the account in the transaction that spends it
   * (cross-area review X01).
   */
  recovered?: { at: number; own: string[]; quietAt?: number };
  closedAt?: number;
}

/** The sealed record: every session on a network, and the next index to use. */
interface Book {
  next: number;
  sessions: SessionRecord[];
  /**
   * A restore's scan hasn't finished on this network (1.5.0's release review,
   * C19): a restore marks every network before its scan starts, and the first
   * scan that finishes here clears it, the restore's own or Find leftovers'.
   * A read that fails, a lock or a worker stop leaves it, and so does the
   * other network, whose one-time accounts a restore doesn't look at. Sealed
   * with the book, so the lock that cuts a scan off keeps it, and every other
   * write of the book keeps it too: a new session's funding as much as any
   * (cross-area review X02).
   */
  unscanned?: true;
}

/** A later part of a funding in parts, kept for Send with its own figures (keepFunding). */
type FundingPart = SessionOutSummary & { origin: HistoryClass; txCbor: string; seed: string };

/**
 * A funding built for Send (buildFunding): the review's `summary`, its parts added up; the first part's transaction;
 * its own figures (`first`) when there are more; and the parts after it (`later`).
 */
interface Funding {
  summary: SessionOutSummary & { origin: HistoryClass };
  txCbor: string;
  seed: string;
  first?: SessionOutSummary & { origin: HistoryClass };
  later: FundingPart[];
}

interface KeptOut {
  network: NetworkName;
  txHash: string;
  txCbor: string;
  seed: string;
  index: number;
  swap: SessionView["swap"];
  approved: AutoRecord["approved"];
  /** How deep and how long its return through Lovejoin goes, as the approval showed them. */
  lovejoin?: AutoRecord["lovejoin"];
  /** Its funding pays for its collateral's mix too (SessionRecord `collateralReserve`). */
  tailReserved?: true;
  builtAt: number;
}

/** A site's private session's funding, or a top-up of one. */
interface KeptFunding extends SessionOutSummary {
  txCbor: string;
  seed: string;
  /** The site a new session is for; a top-up has none. */
  site?: { origin: string };
  /** It pays for its session's collateral's mix too (SessionRecord `collateralReserve`). */
  tailReserved?: true;
  builtAt: number;
  /** Signed as sent, once a submit went unanswered: Send sends it again as it is (pending.ts writeAhead). */
  sentCbor?: string;
}

interface KeptTx {
  network: NetworkName;
  index: number;
  kind: "swap" | "cancel";
  txHash: string;
  txCbor: string;
  /** The request WebAssembly read it with, to sign it the same way. */
  request: string;
  quote?: SwapQuote;
  /** A swap's orders: its outputs to the DEXes' contracts (`txhash#index`). */
  orders?: string[];
  /** A swap against a DEX's pools, with no order, its proceeds paid in itself (chunk 24). */
  againstPools?: boolean;
  builtAt: number;
}

/** A mix session's funding. */
interface KeptMix extends SessionOutSummary {
  txCbor: string;
  seed: string;
  mix: LovejoinFunding;
  /** Its funding pays for its collateral's mix too (SessionRecord `collateralReserve`). */
  tailReserved?: true;
  /** A Bootstrap's: its funding pays its way back's reserve, and no collateral (SessionRecord `mix.noCollateral`). */
  backReserved?: true;
  builtAt: number;
}

interface KeptBack extends SessionBackSummary {
  txCbor: string;
  builtAt: number;
  /** Through Lovejoin: the whole chain, in order, the return last (`txCbor`, `txHash`). */
  chain?: LovejoinChain["txs"];
  /** And where its boxes end up, mixed all the way. */
  leaves?: LovejoinChain["leaves"];
  /**
   * Its collateral's tail as the chain's record keeps it (recordChain): how long its leaf waits, as the session's
   * approval or Settings has it; and, its mix built again (tailChain), the deposit an earlier chain sent, the chain
   * whose tail this takes over, how many times its mix has been built, and when that deposit was first known in.
   */
  tailOf?: { delay?: LovejoinDelay; deposit?: string; resumes?: string; tries?: number; landed?: number };
}

/** A return's chain through Lovejoin being sent, a window at a time, between the runner's steps. */
interface PendingChain extends ChainProgress {
  index: number;
  /** Where the return was kept for Send, cleared once a transaction of it is sent. */
  kept: string;
  /** The return, for the private history once it's all sent. */
  summary: SessionBackSummary;
  /**
   * Its collateral's mix not signed yet (giveme.my busy or out of reach, Koios behind): not asked again before
   * `witnessAfter` (ms), each wait twice the one before (`witnessWait`), TAIL_WITNESS_WAIT_MS up to its most.
   */
  witnessAfter?: number;
  witnessWait?: number;
}

/** A collateral's mix not signed yet is asked again after a minute, then two, four and so on, 30 minutes at most. */
const TAIL_WITNESS_WAIT_MS = [60_000, 30 * 60_000] as const;

export interface SessionDeps extends ScriptSpendDeps {
  store: PrivateStore;
  minswap: (network: NetworkName) => Minswap;
  /**
   * Wakes the runner every minute while a swap runs (chrome.alarms). Only the
   * worker's run stops it, once for every network (runs.ts).
   */
  alarm?: { start(): Promise<void> };
  /** Where a return's spare ADA goes first, when it pays for a box. */
  lovejoin?: LovejoinService;
  /** In [0, 1): the wait's draw after an unlock, secureRandom unless a test pins it. */
  random?: () => number;
}

/**
 * What Minswap built (`of` a swap), or the wallet's own cancel of a DEX order
 * (`of` a cancel: chunk 24, Step 3), failed a check: the swap pauses for the
 * user instead of trying again. `detail` says which check, and a paused
 * swap's warning shows it, as the review's alert shows the whole message:
 * Minswap's build, or the wallet's own cancel, never one for the other
 * (release review C19). The worker writes both, where the critical-set
 * deriver can't see, so each is named `sess.refuse.warn.*`: the name is what
 * keeps them checked (tests/i18n-worker-reasons.test.ts).
 */
export class Refused extends Error {
  constructor(
    readonly detail: string,
    readonly of: "swap" | "cancel" = "swap",
  ) {
    super(of === "cancel" ? t("sess.refuse.warn.cancelRefused", { detail }) : t("sess.refuse.warn.wontSign", { detail }));
  }
}

/** Nothing at a session's account can come back (its `leftBehind` says what's there), so no return is built. */
export class NothingComesBack extends Error {}

/** The fresh quote expects less than the least approved, so the order couldn't fill. */
class PriceMoved extends Error {
  constructor(readonly amountOut: string) {
    super(t("sess.priceMoved"));
  }
}

const PENDING_KIND = {
  out: "session-out",
  swap: "session-swap",
  cancel: "session-cancel",
  back: "session-back",
  deposit: "session-back",
  mix: "session-back",
} as const satisfies Record<SessionTx["kind"], PendingTx["kind"]>;

/** Why a return leaves Lovejoin out when its account's collateral is gone (privacy review §2.15). */
const NO_COLLATERAL = () => t("sess.skip.warn.noCollateral");

/** Why it does while 5 ₳ put in for that collateral is on its way, not there yet (cross-area review X20). */
const COLLATERAL_COMING = () => t("sess.skip.warn.collateralComing");

/** Why a return leaves Lovejoin out while its last chain's rest, sent back directly, isn't on chain (independent review L17). */
const REST_NOT_BACK = () => t("sess.skip.warn.restNotBack");

/** The most funding changes one return merges into (WebAssembly's MAX_MERGE). */
const MAX_MERGE = 4;

/**
 * The most outputs of a site's own transactions a session keeps (siteOuts),
 * the newest: few enough that, with its fundings' and top-ups', one
 * utxo_info request, so one backend, usually answers for them all. Older
 * ones matter less: a backend lags minutes, and one still unspent that long
 * is listed at the account.
 */
const SITE_OUTS_KEPT = 40;

/** The most a cancel's fee may be: the wallet's own cancel of several orders, each a script spend, costs well under it. */
const MAX_CANCEL_FEE = 3_000_000n;

/**
 * The most of a swap against the pools' network fee counted with ADA it buys (checkProceeds): Minswap's measured
 * 0.48 ₳ for one of Danogo's pools to 0.92 ₳ for four, on mainnet (chunk 24). More, and it's taken from the proceeds
 * (release review C08).
 */
const MAX_DIRECT_FEE = 3_000_000n;

const hexBytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));

/** Minswap's token IDs are the policy and the name run together. */
function tokenOf(id: string): Omit<TokenQuantity, "quantity"> {
  return { policyId: id.slice(0, 56), assetName: id.slice(56) };
}

/** The tokens the wallet knows by name (src/tokens/list.json, the registry's list), by Minswap's ID. */
const LISTED: Record<NetworkName, ReadonlySet<string>> = {
  preprod: new Set(tokenList.preprod.map((t) => t.policy + t.name)),
  mainnet: new Set(tokenList.mainnet.map((t) => t.policy + t.name)),
};

/** Why a swap into a token that isn't verified isn't funded. */
const UNVERIFIED = () => t("sess.unverified");

/** An ask as the user typed it, checked before Minswap sees it. */
export function checkAsk(ask: SwapAsk): SwapAsk {
  const token = (id: string) => id === "lovelace" || /^[0-9a-f]{56}([0-9a-f]{2}){0,32}$/.test(id);
  if (!/^[1-9][0-9]*$/.test(ask.amount)) throw new Error(t("sess.enterAmount"));
  if (!token(ask.tokenIn) || !token(ask.tokenOut)) throw new Error(t("sess.notSwappable"));
  if (ask.tokenIn === ask.tokenOut) throw new Error(t("sess.twoDifferent"));
  if (!(ask.slippage >= 0.1 && ask.slippage <= 20)) throw new Error(t("sess.slippageRange"));
  return { amount: ask.amount, tokenIn: ask.tokenIn, tokenOut: ask.tokenOut, slippage: ask.slippage };
}

/**
 * The most slippage, in percent to four places, that leaves Minswap's
 * minimum for a quote of `amountOut`, amountOut / (1 + slippage%), at
 * `least` or more: a step of 0.0001% under the exact bound, so Minswap's
 * rounding never takes it below. 0 when the quote is barely above `least`.
 */
export function slippageKeeping(amountOut: bigint, least: bigint): number {
  const room = amountOut - least - 1n;
  if (room <= 0n) return 0;
  const steps = (room * 1_000_000n) / (least + 1n) - 1n;
  return steps > 0n ? Number(steps) / 10_000 : 0;
}

/**
 * Whether Minswap's estimate is for `ask`: the amount typed, whole, from and
 * to the tokens chosen, each path starting and ending on them, and their
 * amounts adding up to it. One for another amount (the usability review's
 * DX-8) would have the user approve the minimum that amount gets, then pay
 * the amount typed. Minswap gives `amount_in` back as asked, its paths
 * summing to it to the unit, split or not (nine mainnet quotes on
 * 2026-10-11, from 7 lovelace to 250,000 ₳ over two DEXes and 98,765 ₳ over
 * seven), so holding it to that refuses nothing Minswap answers right.
 */
export function quotesTheAsk(ask: SwapAsk, est: Estimate): boolean {
  if (est.token_in !== ask.tokenIn || est.token_out !== ask.tokenOut || est.amount_in !== ask.amount) return false;
  const ends = (path: RouteLeg[]) => path[0]?.token_in === ask.tokenIn && path.at(-1)?.token_out === ask.tokenOut;
  if (!est.paths.length || !est.paths.every(ends)) return false;
  try {
    return est.paths.reduce((sum, path) => sum + BigInt(path[0]!.amount_in), 0n) === BigInt(ask.amount);
  } catch {
    return false;
  }
}

/**
 * Minswap's route for `ask`, and what it was asked to leave out besides the
 * usual, for the build that follows (`avoid`): a route that puts a DEX
 * where the session's check can't follow it (`outOfPlace`: any DEX in a
 * path of more than one leg, Danogo beside anything else) is asked for
 * again without that DEX, rather than refused (chunk 24). An estimate for
 * anything but `ask` is refused (`quotesTheAsk`), wherever it's asked for:
 * a quote, Review it myself, and the runner's order, which tries again later.
 */
export async function routeOf(minswap: Minswap, ask: SwapAsk): Promise<{ est: Estimate; avoid: string[] }> {
  const first = await minswap.estimate(ask);
  const avoid = outOfPlace(first);
  const est = avoid.length ? await minswap.estimate(ask, avoid) : first;
  if (!quotesTheAsk(ask, est)) throw new Error(t("sess.otherQuote"));
  return { est, avoid };
}

/** A quote from Minswap's estimate, with what a session for it is funded with. */
export function quoteOf(network: NetworkName, ask: SwapAsk, est: Estimate): SwapQuote {
  const costs = BigInt(est.total_dex_fee) + BigInt(est.deposits) + BigInt(est.aggregator_fee ?? "0") + SWAP_MARGIN;
  const fund =
    ask.tokenIn === "lovelace"
      ? { lovelace: (BigInt(ask.amount) + costs).toString(), tokens: [] }
      : { lovelace: costs.toString(), tokens: [{ ...tokenOf(ask.tokenIn), quantity: ask.amount }] };
  return {
    network,
    ask,
    amountIn: est.amount_in,
    amountOut: est.amount_out,
    minAmountOut: est.min_amount_out,
    dexFee: est.total_dex_fee,
    deposits: est.deposits,
    aggregatorFee: est.aggregator_fee ?? "0",
    priceImpact: est.avg_price_impact,
    route: [...new Set(est.paths.flat().map((leg) => leg.protocol))],
    ...(againstPools(est) ? { againstPools: true } : {}),
    fund,
    collateral: SESSION_COLLATERAL.toString(),
  };
}

/** What a session's UTxOs hold, together. */
function holdingOf(utxos: KoiosUtxo[]): NonNullable<SessionView["holding"]> {
  const tokens = new Map<string, bigint>();
  let lovelace = 0n;
  for (const u of utxos) {
    lovelace += BigInt(u.value);
    for (const a of u.asset_list ?? []) {
      const key = a.policy_id + a.asset_name;
      tokens.set(key, (tokens.get(key) ?? 0n) + BigInt(a.quantity));
    }
  }
  return {
    lovelace: lovelace.toString(),
    tokens: [...tokens].map(([id, q]) => ({ ...tokenOf(id), quantity: q.toString() })),
    utxos: utxos.length,
  };
}

/** `rows` less what no return takes (the record's `leftBehind`): what can come back, and holds the session open. */
function returnable(s: SessionRecord, rows: KoiosUtxo[]): KoiosUtxo[] {
  const behind = new Set((s.leftBehind ?? []).map((b) => `${b.txHash}#${b.txIndex}`));
  return behind.size ? rows.filter((u) => !behind.has(outpoint(u))) : rows;
}

/**
 * The outputs of transaction `txCbor` (hex) that pay the account of payment
 * key `keyHash` (`txhash#index`), whatever their staking part. Undefined when
 * the wallet can't read it: then none are recorded, as before.
 */
function paysAccount(txCbor: string, txHash: string, keyHash: string): string[] | undefined {
  try {
    return builtOutputs(hexBytes(txCbor)).flatMap((o, i) => {
      // The header's high four bits: 0 to 7 are Shelley addresses, an even one paid to a key, whose hash follows.
      const type = Number.parseInt(o.address.charAt(0), 16);
      return type <= 7 && type % 2 === 0 && o.address.slice(2, 58) === keyHash ? [`${txHash}#${i}`] : [];
    });
  } catch {
    return undefined;
  }
}

/**
 * What session `s`'s own transactions paid its account (`outs`), of those
 * that may have gone out, and what its site's signed ones pay it (`siteOuts`).
 */
function ownOuts(s: SessionRecord): string[] {
  return [...new Set([...s.txs.flatMap((t) => (t.unsent ? [] : (t.outs ?? []))), ...(s.siteOuts ?? [])])];
}

/**
 * Whether Koios shows what session `s`'s own transactions paid its account
 * gone from it (independent review M4): each output recorded with them
 * (`outs`) known to Koios and spent (`known`: whether each is, by outpoint,
 * from `utxo_info`), or still at the account as read (`listed`: what no
 * return takes, left behind). An empty read of the account proves nothing
 * alone: Koios's gateway balances several backends, and one behind the
 * session's funding lists the account empty (spent.ts). An output Koios
 * doesn't know is fine only when the chain never showed its transaction,
 * and no longer may (awaitsLanding, `now`): it never landed. Until then, a
 * backend behind it, or a transaction that waits long in a mempool, reads
 * the same as one never sent, and nothing read since may have seen it land
 * (final review F13). A session from before outputs were recorded has none.
 * What its site's signed transactions pay it (`siteOuts`) counts the same
 * once Koios knows it; one it doesn't is fine, since the site may never
 * have sent it: a backend that shows the money it spent gone knows it.
 */
function ownGone(s: SessionRecord, known: ReadonlyMap<string, boolean>, listed: ReadonlySet<string>, now: number): boolean {
  const gone = (o: string, unknown: boolean) => {
    const spent = known.get(o);
    return spent === undefined ? unknown : spent || listed.has(o);
  };
  return (
    s.txs.every((t) => t.unsent || !t.outs || t.outs.every((o) => gone(o, !t.confirmed && !awaitsLanding(t, now)))) &&
    (s.siteOuts ?? []).every((o) => gone(o, true))
  );
}

/** Why a session doesn't end on a read of its empty account that Koios doesn't back up (ownGone). */
const NOT_CAUGHT_UP = () => t("sess.notCaughtUp");

/** Why a site's session doesn't end while a funding or a top-up Koios knows nothing of may still land (ownGone, final review F13). */
const FUNDING_UNSEEN = () => t("sess.fundingUnseen");

/**
 * WebAssembly couldn't build a return because what it takes doesn't pay for
 * its own deposit and fee: the session's own too little, or nothing but a
 * stranger's tokens that don't pay their way (api::NOTHING_PAYS).
 */
const TOO_LITTLE = /deposit of these tokens needs at least|insufficient lovelace|Not Enough Lovelace|pays for its own way back/i;

/** WebAssembly couldn't fund a payment from the private balance: core's `NotEnough` (build.rs), in its fixed English. */
const NOT_ENOUGH_PRIVATE = /Not enough ADA in the Seedelf balance/;

/** More UTxOs than one transaction spends: core's `TooMany` (build.rs), in its fixed English. */
const TOO_MANY = /needs more computation than a transaction may use/;

/** The private balance doesn't pay for a funding (buildFunding), in the user's words: told apart by its type, never its words. */
class NotEnoughPrivate extends Error {
  constructor() {
    super(t("sess.notEnoughPrivate"));
  }
}

/** A mix session whose chain is a deposit alone (a Bootstrap, or a seed before it): it runs no script, so it needs no collateral. */
function depositOnly(s: SessionRecord | undefined): boolean {
  return !!(s?.mix?.bootstrap || s?.mix?.seed);
}

/**
 * A UTxO at a session's account its return's chain can put up as collateral
 * (privacy review §2.15): exactly 5 ₳ of ADA alone, as its funding pays one,
 * and nothing WebAssembly's evaluator refuses (eval::refusal): no reference
 * script, and no datum, inline or by hash, which the session's own never
 * has. A stranger's 5 ₳ with a datum too deep to read would stop the chain
 * (independent review L20).
 */
function collateralFits(u: KoiosUtxo): boolean {
  return BigInt(u.value) === SESSION_COLLATERAL && !u.asset_list?.length && !u.reference_script && !u.inline_datum && !u.datum_hash;
}

/** A UTxO of ADA alone: no tokens, no datum, no script. A cancel's fee and collateral come from these (cancelOf). */
function plainAda(u: KoiosUtxo): boolean {
  return !u.asset_list?.length && !u.reference_script && !u.inline_datum && !u.datum_hash;
}

/**
 * Whether a cancel's collateral is among `rows` (cancelOf): its own 5 ₳, or
 * a UTxO of ADA alone of 5 ₳ or more. A smaller one may not cover the fee
 * and come back, so it doesn't count: 5 ₳ put in for the cancel
 * (cancelCollateralBuild) is what the cancel takes then.
 */
function holdsCancelCollateral(rows: KoiosUtxo[]): boolean {
  return rows.some((u) => plainAda(u) && BigInt(u.value) >= SESSION_COLLATERAL);
}

/** A session's funding: its first transaction, or its first `parts` when it went in parts. */
function fundingOf(s: SessionRecord): RecordedTx[] {
  return s.txs.slice(0, s.parts ?? 1);
}

/** Everything after a session's funding: its top-ups and its steps. */
function afterFunding(s: SessionRecord): RecordedTx[] {
  return s.txs.slice(s.parts ?? 1);
}

/**
 * Where a session's funding is, and how many of its parts landed: `landed` once every part is on chain (`confirmed`)
 * or what it paid is listed at the account (`rows`); `short` once some landed and every other was missed (`missed`,
 * or turned away); `never` once none landed and every one was turned away, or (`failed`) the runner found none on
 * chain in time; `funding` while any may still land. A session nothing runs (a site's) has no runner to mark a part
 * missed: one not seen FAILED_AFTER_MS after it was sent is, at `now`. A part still waiting for the one before it
 * (`waiting`, stillWaiting) is neither. One transaction's funding is `landed` once anything is at its account, as it
 * always was.
 */
function fundingState(
  s: SessionRecord,
  rows?: KoiosUtxo[],
  {
    failed = !!s.auto?.failed,
    now,
    waiting = NONE_WAITING,
  }: { failed?: boolean; now?: number; waiting?: ReadonlySet<string> } = {},
): { state: "landed" | "funding" | "short" | "never"; landed: number; total: number } {
  const parts = fundingOf(s);
  const there = new Set((rows ?? []).map((u) => u.tx_hash));
  const total = parts.length;
  if (total === 1) {
    const out = parts[0]!;
    if (out.confirmed || !!rows?.length) return { state: "landed", landed: 1, total };
    return { state: out.unsent || failed ? "never" : "funding", landed: 0, total };
  }
  const arrived = (t: RecordedTx) => t.confirmed || there.has(t.txHash);
  const landed = parts.filter(arrived).length;
  if (landed === total) return { state: "landed", landed, total };
  const missed = (t: RecordedTx) =>
    t.missed || t.unsent || (now !== undefined && !waiting.has(t.txHash) && now - t.at > FAILED_AFTER_MS);
  const gone = parts.filter((t) => !arrived(t) && missed(t)).length;
  if (landed + gone < total && !failed) return { state: "funding", landed, total };
  return { state: landed ? "short" : "never", landed, total };
}

/** No part of a funding waits for the one before it. */
const NONE_WAITING: ReadonlySet<string> = new Set();

/**
 * Pauses session `s`, whose funding in parts is short (fundingState), for the user to bring back what came: a funding
 * every part of which was missed never started, and fails as one transaction's does. Its swap or mix never runs. One
 * the user stopped isn't paused: what came is brought back, as Stop said, and nothing would step it again.
 */
function short(s: SessionRecord, at: number): void {
  const { state, landed, total } = fundingState(s);
  if (state === "never") {
    s.auto!.failed ??= at;
    return;
  }
  if (s.auto!.stopping) return;
  if (state !== "short" || (s.auto!.paused?.why === "short" && s.auto!.paused.landed === landed)) return;
  s.auto!.paused = { at, why: "short", landed, total };
  delete s.auto!.retry;
}

/**
 * Whether top-up `t` of a session (anything it was paid after its funding)
 * may still reach its account: sent, not turned away, less than
 * REPLACED_WATCH_MS ago, and no listing of the account has shown it there
 * yet (`listed`). One that never lands lets another go after that, as a
 * site's Disconnect waits for one (final review F13); one that landed isn't
 * coming again, whatever spent it since (1.5.0's release review, C04). The
 * builds of 5 ₳ for a session brought back by hand ask it (topUpComing), and
 * their Send asks it again, in the queue (topUpSubmit, C29).
 */
function topUpOnItsWay(t: RecordedTx, now: number): boolean {
  return t.kind === "out" && !t.unsent && !t.listed && now - t.at < REPLACED_WATCH_MS;
}

/** Whether a top-up of session `s` is on its way (topUpOnItsWay), what it pays the account not among `rows` yet. */
function topUpComing(s: SessionRecord, rows: KoiosUtxo[], now: number): boolean {
  const there = new Set(rows.map(outpoint));
  return afterFunding(s).some((t) => topUpOnItsWay(t, now) && !(t.outs ?? []).some((o) => there.has(o)));
}

/**
 * Marks session `s`'s top-ups of which Koios lists an output at its account
 * (`listed`, what this wallet spent included) as there: they reached it
 * (topUpOnItsWay). Returns whether it marked any.
 */
function markListed(s: SessionRecord, listed: KoiosUtxo[]): boolean {
  const there = new Set(listed.map((u) => u.tx_hash));
  const reached = afterFunding(s).filter((t) => t.kind === "out" && !t.listed && there.has(t.txHash));
  for (const t of reached) t.listed = true;
  return reached.length > 0;
}

/**
 * A cancel of session `s` sent and not on chain yet. It may land, and what it
 * spends counts as spent that long (SPENT_KEEP_MS): 5 ₳ put in for it too,
 * when it took its fee from them (a Splash order's cancel, whose refund is
 * the whole order), while the order reads open until it lands. No 5 ₳ goes
 * in for the session meanwhile, and its page says the cancel is on its way
 * (1.5.0's release review, C04).
 */
function cancelling(s: SessionRecord, now: number): boolean {
  return s.txs.some((t) => t.kind === "cancel" && !t.confirmed && !t.unsent && !t.replaced && now - t.at < REPLACED_WATCH_MS);
}

/**
 * A UTxO of 5 ₳ of ADA alone at a session's account (`address`, payment key
 * `keyHash`), at an outpoint no transaction has: the 5 ₳ a session would put
 * in for its cancel, which that cancel is run on before they're built
 * (cancelCollateralBuild), as core's stand-ins are for a swap's own cancels
 * (orders.rs `stand_in`).
 */
function collateralStandIn(address: string, keyHash: string): KoiosUtxo {
  const row = {
    tx_hash: "00".repeat(32),
    tx_index: 0,
    address,
    value: SESSION_COLLATERAL.toString(),
    stake_address: null,
    payment_cred: keyHash,
    block_height: 0,
    inline_datum: null,
    datum_hash: null,
    asset_list: [],
    reference_script: null,
    // WebAssembly's row has these too; nothing reads them.
    epoch_no: 0,
    block_time: 0,
    is_spent: false,
  };
  return row;
}

/**
 * `classes` with what session `index`'s own transactions (`own`, by hash)
 * made among `utxos` classed as its money: its class added to what's known
 * of each, as the history of the device that made them says. A top-up then
 * takes them first (core's `Purpose::Fund`), and spending them ties nothing
 * new (1.5.0's release review, C36).
 */
function ownClassed(classes: Classes, utxos: KoiosUtxo[], own: ReadonlySet<string>, index: number): Classes {
  const session = sessionClass(index);
  const mine = utxos
    .filter((u) => own.has(u.tx_hash))
    .map((u) => {
      const known = classes[outpoint(u)];
      return [outpoint(u), known && known.origin !== "unknown" ? merged([known, session]) : session] as const;
    });
  return { ...classes, ...Object.fromEntries(mine) };
}

/** A session brought back by hand: no swap that runs itself, no site's, no mix. A session the restore scan found is one. */
function byHand(s: SessionRecord): boolean {
  return !s.auto && !s.site && !s.mix;
}

/**
 * A session the restore scan found that this device has sent nothing for:
 * its record holds the funding and the swaps the scan found, and nothing but
 * what Koios turned away, which never went out. Once a cancel, a top-up or a
 * return goes from here, only its own return ends it, as any session's: a
 * cancel's refund records no `outs` that would hold an end back (1.5.0's
 * release review, C02).
 */
function foundUntouched(s: SessionRecord): boolean {
  return !!s.recovered && byHand(s) && afterFunding(s).every((t) => t.unsent || s.recovered!.own.includes(t.txHash));
}

/** A swap that runs itself and has something left to do without the user. */
function running(s: SessionRecord): boolean {
  return !!s.auto && !s.closedAt && !s.auto.paused && !s.auto.failed;
}

/**
 * A mix of the wallet's boxes again whose chain may still spend them: from
 * its funding on (unless that never went) until its return is sent, and not
 * while nothing at its account can come back (`nothingBack`): no chain goes
 * then, so its boxes aren't held for one (independent review H1).
 */
function mixingAgain(s: SessionRecord): boolean {
  return (
    !!s.mix?.again &&
    !s.closedAt &&
    !s.auto?.failed &&
    s.nothingBack === undefined &&
    !s.txs[0]?.unsent &&
    !s.txs.some((t) => t.kind === "back" && !t.unsent)
  );
}

/**
 * Session `record`'s latest chain through Lovejoin, as its return reads it
 * (buildBack): the transactions of it that may have gone (`sent`), and
 * whether it went in partly (`started`), so that what's left comes back
 * directly. One whose return was sent finished, and so did a session's whose
 * rest came back directly, that return on chain; not a mix's, though:
 * another chain would mix the wallet's boxes again, which nothing holds for
 * it anymore (mixingAgain), so what reaches its account after comes back
 * directly too. A collateral's mix built again went in with the chain it goes
 * on with (`from`), though it stopped before any of its own was sent: its
 * next return is a plain one, never a chain built afresh, whose reason a mix
 * would keep as why it never went in (1.6.0's release review, 323-worker#8).
 */
function chainSoFar(record: SessionRecord | undefined): { sent: RecordedTx[]; started: boolean } {
  const chain = record?.chain;
  const since = (at?: number) => (record?.txs ?? []).filter((t) => !t.unsent && (at === undefined || t.at >= at));
  const sent = since(chain?.at);
  const finished =
    !!chain &&
    sent.some((t) => t.txHash === chain.last || (!record?.mix && t.kind === "back" && t.confirmed && !t.replaced));
  const went = chain?.from !== undefined ? since(chain.from) : sent;
  return { sent, started: !finished && went.some((t) => t.kind === "deposit" || t.kind === "mix") };
}

/** Whether a session's record holds `txHash`, not turned away: it went out, or may have. */
function sentIn(book: Book, txHash: string): boolean {
  return book.sessions.some((s) => s.txs.some((x) => x.txHash === txHash && !x.unsent));
}

/**
 * Refuses, in the words `started` names, the funding `txHash` once it started
 * a session: one's record holds it, or `built`, the review kept for it on
 * `network`, was sent and its record has gone since. Asked before whether the
 * review is still kept or too old: a funding that went out isn't kept any
 * more (pending.ts takes it), and called stale, its page would build it again
 * and fund a second session (chunk 23's second review, fix round). A funding
 * turned away counts too: its index is never used again. A review never sent,
 * whose index another funding took since (a swap's in the side panel, a
 * site's in the connector), is only stale: built again, on the next unused
 * account (DX-1).
 */
function refuseStarted(
  book: Book,
  txHash: string,
  built: { network: NetworkName; txHash: string; index: number; sentCbor?: string } | undefined,
  network: NetworkName,
  started: "sess.alreadyStarted" | "sess.mixStarted",
): void {
  if (book.sessions.some((s) => s.txs.some((x) => x.kind === "out" && x.txHash === txHash))) {
    throw new Error(t(started));
  }
  if (built?.txHash !== txHash || built.network !== network || built.index >= book.next) return;
  // Sent once, it may have gone out whatever became of its record since (Forget, Disconnect).
  if (built.sentCbor !== undefined) throw new Error(t(started));
  throw new StaleReviewError(t("sess.indexTaken"));
}

/** A step's transaction that's gone: Koios never took it, or the chain never saw it. */
function lost(t: RecordedTx, now: number): boolean {
  return ((t.unsent || t.sending) && now - t.at >= RESEND_AFTER_MS) || now - t.at >= LOST_AFTER_MS;
}

/**
 * The feed a session's transaction shows in once it's on chain (feed.ts):
 * its way out spends Seedelf UTxOs and its way back pays them, a return
 * through Lovejoin pays and spends boxes, and a swap or a cancel is on none.
 */
function sessionFeed(kind: SessionTx["kind"]): Feed | undefined {
  if (kind === "out" || kind === "back") return "contract";
  if (kind === "deposit" || kind === "mix") return "lovejoin";
  return undefined;
}

/**
 * Whether a submit that failed may have gone through all the same: Koios
 * didn't answer it (a timeout, a lost connection, a 5xx). A 429 its gateway
 * turned it away with, a refusal, or one that never went out didn't.
 */
function maybeSent(e: unknown): boolean {
  return e instanceof KoiosBusyError && e.maybeSent;
}

/**
 * Why a funding or a top-up was turned away (`e`), as a code: told from what
 * failed, never from its message, which is in the language the worker had
 * then. Something it spends changed since the review (the device knew it
 * spent, or the node said so); giveme.my answered and didn't lend its
 * collateral, which says who, not why (blind test §9.5); the collateral
 * service out of reach; the network busy; or the network refusing it
 * otherwise.
 */
function unsentWhyOf(e: unknown): UnsentWhy | undefined {
  // An outage or a limit of giveme.my's is kept apart, so the page says wait, not that it was turned down.
  if (e instanceof CollateralRefusedError) return e.busy ? "givemeBusy" : "refused";
  if (e instanceof StaleReviewError || e instanceof SpentInputError) return "changed";
  if (e instanceof CollateralError) return "unreachable";
  if (e instanceof KoiosBusyError) return "busy";
  if (e instanceof KoiosError) return "network";
  return undefined;
}

/**
 * Marks `r`'s transactions the chain has (`on`) confirmed. A step built
 * again after it went unseen has copies: the replaced ones, then the one
 * after them, if one was built. Once one of them lands, the others can't
 * (they spend the same), so they go, and the one that landed is the step,
 * even a replaced one alone. Returns whether anything changed.
 */
function settle(r: SessionRecord, on: ReadonlySet<string>): boolean {
  let changed = false;
  for (const t of r.txs) {
    if (t.confirmed || !on.has(t.txHash)) continue;
    t.confirmed = true;
    delete t.unsent;
    delete t.why;
    delete t.sending;
    changed = true;
  }
  const gone = new Set<string>();
  for (const kind of REBUILT) {
    let copies: RecordedTx[] = [];
    for (const t of r.txs.filter((x) => x.kind === kind)) {
      copies.push(t);
      if (t.replaced) continue;
      changed = landed(copies, gone) || changed;
      copies = [];
    }
    changed = landed(copies, gone) || changed;
  }
  if (!gone.size) return changed;
  r.txs = r.txs.filter((t) => !gone.has(t.txHash));
  return true;
}

/**
 * One step's copies: once one has landed, it's the step and the rest go
 * (settle). A replaced copy that lands with none built after it is the step
 * too: its swap's order waits at the DEX, or its return is in (final review
 * sessions-2). Returns whether it changed anything.
 */
function landed(copies: RecordedTx[], gone: Set<string>): boolean {
  const step = copies.find((t) => t.confirmed);
  if (!step) return false;
  const was = !!step.replaced;
  delete step.replaced;
  for (const t of copies) if (t !== step) gone.add(t.txHash);
  return was;
}

/**
 * Whether a copy of a step built again may still land: the chain hasn't
 * shown it, and it's still looked for (REPLACED_WATCH_MS). The session isn't
 * over while one may: its order, or its return, would come to an account
 * nothing reads again.
 */
function mayStillLand(s: SessionRecord, now: number): boolean {
  return s.txs.some((t) => t.replaced && !t.confirmed && now - t.at < REPLACED_WATCH_MS);
}

/**
 * A return whose history isn't written yet (`summary`), that Koios may have
 * taken and the chain hasn't shown: looked for as long as a copy built
 * again is (REPLACED_WATCH_MS), since a lagging Koios may show it late
 * (independent review M7).
 */
function awaitsHistory(t: RecordedTx, now: number): boolean {
  return !!t.summary && !t.confirmed && !t.unsent && now - t.at < REPLACED_WATCH_MS;
}

/**
 * A funding or a top-up the chain hasn't shown yet, and that may still land:
 * looked for as long as a copy built again is (REPLACED_WATCH_MS), since
 * Koios may have taken it late. Once seen, it's confirmed, and only Koios
 * showing what it paid spent ends its session, never a read that's behind
 * it (ownGone, final review F13).
 */
function awaitsLanding(t: RecordedTx, now: number): boolean {
  return t.kind === "out" && !t.confirmed && !t.unsent && now - t.at < REPLACED_WATCH_MS;
}

/**
 * Session `s`'s fundings and top-ups the chain hasn't shown yet of which
 * Koios lists an output at its account (`listed`): they landed, whatever
 * tx_status says (final review F13).
 */
function fundingsListed(s: SessionRecord, listed: KoiosUtxo[]): Set<string> {
  const there = new Set(listed.map((u) => u.tx_hash));
  return new Set(s.txs.filter((t) => t.kind === "out" && !t.confirmed && there.has(t.txHash)).map((t) => t.txHash));
}

export class SessionService {
  /** One step at a time, the runner's and the user's alike. */
  private queue: Promise<unknown> = Promise.resolve();
  /** When the runner last read each session's chain, by `network:index`. */
  private readAt = new Map<string, number>();
  /** What each session's account held then. */
  private seen = new Map<string, KoiosUtxo[]>();
  /** Tokens Minswap's verified list was found to have, by `network:id`. */
  private verifiedIds = new Set<string>();
  /**
   * The reference UTxOs DEX order scripts are read from, as Koios's
   * `utxo_info` gives them with their scripts, by network and `txhash#index`:
   * what a swap's dry-run cancels read (referenceRows, release review C05).
   */
  private references = new Map<NetworkName, Map<string, KoiosUtxo>>();
  /** The restore scan under way, by network: a restore's and Find leftovers' share one. */
  private scanning = new Map<NetworkName, Promise<SessionScan>>();
  /**
   * Networks a restore is making the wallet on, until its scan is under way
   * there (restoringOn): the wallet's creation opens Home in every page at
   * once, before the restore marks the networks and starts the scan, and a
   * Home that asked then must hear a scan coming, not one over.
   */
  private restoring = new Set<NetworkName>();

  constructor(private readonly deps: SessionDeps) {}

  /**
   * The wallet is removed: what this service holds in memory of its sessions
   * goes with it (1.5.0's release review, C16). A scan under way is let go:
   * the next phrase's restore starts one of its own rather than share it, and
   * it writes nothing into that phrase's book (scanNow). So are what the
   * accounts held at the last reading, and when the runner read them.
   */
  reset(): void {
    this.scanning.clear();
    this.restoring.clear();
    this.seen.clear();
    this.readAt.clear();
  }

  /**
   * A restore is making the wallet on `network`: its scan counts as under
   * way from now, before the wallet exists, until the restore has started it
   * (scan), or failed. Returns the release, for the restore to call then
   * (the release PR's e2e: a Home its state change opened asked first, heard
   * "none due, none running" and never asked again).
   */
  restoringOn(network: NetworkName): () => void {
    this.restoring.add(network);
    return () => {
      this.restoring.delete(network);
    };
  }

  /**
   * This network's sessions, newest first. `refresh` reads their accounts and
   * what's waiting, in turn with every other step. Without it, it only reads
   * the record, so it doesn't wait behind a reading that waits for Koios to
   * catch up (Home's running swaps, a page's first look).
   */
  list(network: NetworkName, refresh = false): Promise<SessionView[]> {
    return refresh ? this.serial(() => this.listNow(network, true)) : this.listNow(network, false);
  }

  /** Forgets a session whose funding never reached the chain. Its index isn't used again. */
  forget(network: NetworkName, index: number): Promise<SessionView[]> {
    return this.serial(async () => {
      const views = await this.listNow(network, true);
      const view = views.find((v) => v.index === index);
      if (!view) throw new Error(t("sess.noSuchSession"));
      if (view.stage !== "failed") throw new Error(t("sess.onlyFailedForgotten"));
      const book = await this.book(network);
      const record = book.sessions.find((s) => s.index === index)!;
      // One the wallet is still sending may land yet, into a session no one reads (final review sessions-6).
      if (await this.stillWatched(network, record)) {
        throw new Error(t("sess.stillSendingFunding"));
      }
      // One Koios knows an output of landed, whatever tx_status and the account's read said: a backend behind
      // them doesn't show it (independent review M4). Unspent, it's the session's money, so the session stays,
      // and goes on as the list does when the funding shows up after all. All of them spent, the account's
      // empty read stands: nothing is left of it, and a swap resumed there would wait for good.
      const known = await this.spentStates(network, ownOuts(record));
      if ([...known.values()].some((spent) => !spent)) {
        const landed = new Set([...known.keys()].map((o) => o.split("#")[0]!));
        await this.update(network, index, (r) => {
          settle(r, landed);
          delete r.auto?.failed;
        });
        if (record.auto) await this.deps.alarm?.start();
        throw new Error(t("sess.fundingLanded"));
      }
      await this.save(network, { ...book, sessions: book.sessions.filter((s) => s.index !== index) });
      return this.listNow(network);
    });
  }

  /** Tokens on Minswap's list matching `query`, verified ones only, 20 at most. */
  async tokens(network: NetworkName, query: string): Promise<SwapTokenInfo[]> {
    const q = query.trim();
    if (!q) return [];
    const found = await this.deps.minswap(network).tokens(q, true);
    return found.slice(0, 20).map((t) => ({
      id: t.token_id,
      ticker: t.ticker,
      name: t.project_name,
      decimals: t.decimals ?? 0,
      verified: !!t.is_verified,
    }));
  }

  /**
   * Minswap's quote for `ask`, whether the token it gets is verified, and
   * what its return through Lovejoin is expected to take. A route through a
   * DEX whose orders the wallet can't check (minswap.ts MAINNET_PROTOCOLS) is
   * refused here, before anything is funded (final review sessions-4), and so
   * is one that, asked again, still puts a DEX where the session's check
   * can't follow it (`outOfPlace`), in words of its own: its DEXes are ones
   * the wallet checks (release review C34).
   */
  async quote(network: NetworkName, ask: SwapAsk): Promise<SwapQuote> {
    const checked = checkAsk(ask);
    const { est } = await routeOf(this.deps.minswap(network), checked);
    const unchecked = uncheckedProtocols(network, est);
    if (unchecked.length) {
      throw new Error(t("sess.routesThrough", { protocols: unchecked.join(t("histories.list.and")) }));
    }
    const legged = outOfPlace(est);
    if (legged.length) {
      throw new Error(t("sess.routesOutOfPlace", { protocols: legged.join(t("histories.list.and")) }));
    }
    const quote = quoteOf(network, checked, est);
    // Worked out here, without the pool: that's read once, at Review (outBuild).
    const lovejoin = await this.lovejoinCost(network, quote);
    return { ...quote, verified: await this.verified(network, checked.tokenOut), ...(lovejoin ? { lovejoin } : {}) };
  }

  /**
   * What bringing a swap's session back through Lovejoin is expected to
   * take, where Lovejoin is on, whichever way Settings has it (`on`: the
   * approval's switch starts there): the boxes its spare ADA pays for at the
   * set depth, the proceeds' too when they're ADA (with the deposit back,
   * and the room left over), their mixes and their withdraws (priced). And,
   * when it's more, what the funding's ADA takes instead, if the swap is
   * stopped or its order refunded (`ifStopped`, privacy review §2.8).
   * `pool`: at Review, as Lovejoin's pool has room for now, or why it has
   * none (§2.7); read only when the return would go through it. `params`:
   * the protocol parameters the review read. `short`: why the token's boxes
   * aren't funded after all (34e's review, 2). `through`: the approval's
   * switch as the review was built, over Settings' (chunk 34's 34f): off, no
   * token's boxes are funded, as it all comes back directly.
   */
  private async lovejoinCost(
    network: NetworkName,
    quote: SwapQuote,
    pool = false,
    pools?: Record<string, string | null>,
    { params, short, through }: { params?: unknown; short?: string; through?: boolean } = {},
  ): Promise<SwapLovejoin | undefined> {
    if (!this.deps.lovejoin?.available(network)) return undefined;
    const on = through ?? (await this.throughLovejoin());
    const { price, at, skipped, depth, delay, asked } = await this.priced(network, pool && on);
    // A token's proceeds go through a pool of it, their boxes' ADA funded beside the swap's (chunk 34's 34e): what
    // it adds is the boxes' alone, so the ADA's boxes below are as before. Only where the return goes through Lovejoin.
    const choice = on ? await this.tokenPool(network, quote, depth, pool && on, pools, params) : undefined;
    const three = choice && (await this.tokenAt(network, quote, choice, depth, 3, short));
    const four = choice && asked === 4 ? await this.tokenAt(network, quote, choice, depth, 4, short) : undefined;
    // An ADA's proceeds come back with its deposit, and are spare.
    const proceeds = quote.ask.tokenOut === "lovelace" ? BigInt(quote.amountOut) + BigInt(quote.deposits) : 0n;
    const spare = proceeds + SWAP_MARGIN;
    // One width for its return, as one chain goes, the token's boxes and the ADA's alike: four where asked and, in
    // each pool, it takes all it pays for or as many as three would; three otherwise, and why, which its approval
    // keeps (wayOver, 34e's review, 5). Nothing paid for or room for at either width: as asked, for its return to
    // decide, with no reason to say beside why nothing goes (1.6.0's release review, 319-worker#0).
    const way = at[4]
      ? wayOver([...(four?.leg ? [four.leg] : []), at[4].leg(spare)], [...(three?.leg ? [three.leg] : []), at[3].leg(spare)])
      : undefined;
    const width: LovejoinWidth = way?.fellBack ? 3 : asked;
    const token = width === 4 ? four : three;
    const filled = (width === 4 ? at[4]! : at[3]).price(spare);
    // Stopped, cancelled or refunded: the funding comes back instead, its boxes' ADA with it, at the width its return
    // would go at from the approved one. A token's carries the token, which no pool was approved for.
    const funded = token ? BigInt(token.fund) : 0n;
    const stopped = price((quote.ask.tokenIn === "lovelace" ? BigInt(quote.fund.lovelace) : 0n) + funded, width);
    const more = (stopped.of ?? stopped.boxes) > (filled.of ?? filled.boxes);
    return {
      ...filled,
      depth,
      delay,
      on,
      ...(width === 4 ? { width } : {}),
      ...(way?.fellBack ? { fellBack: way.fellBack } : {}),
      ...(skipped ? { skipped } : {}),
      ...(more ? { ifStopped: stopped } : {}),
      ...(token ? { ways: [token.way], ...(funded > 0n ? { fund: token.fund } : {}) } : {}),
      // What a box holds in each pool the token could go into, for the approval's names and Change (34f).
      ...(choice?.works.length || choice?.chosen ? { values: valuesOf([...choice.works, ...(choice.chosen ? [choice.chosen] : [])]) } : {}),
    };
  }

  /**
   * The pool the token swap `quote` gets goes through (chunk 34's 34e), or undefined when no pool the wallet shows
   * holds it: the pool chosen in `pools` (Change, by the token's unit; null, none), else its most used pool that
   * takes a box now, as the review read the pools (`pool`: their room, once, at Review, and whether a box of each
   * comes back under `params`; as the user types, the first shown, as discovery last kept them, asking nobody).
   */
  private async tokenPool(
    network: NetworkName,
    quote: SwapQuote,
    depth: number,
    pool: boolean,
    pools?: Record<string, string | null>,
    params?: unknown,
  ): Promise<TokenChoice | undefined> {
    const lovejoin = this.deps.lovejoin!;
    const unit = quote.ask.tokenOut;
    // As the user types, no request at all, not even the data layer's list (34e's review, 9).
    const candidates = await lovejoin.poolsOf(network, unit, !pool);
    if (!candidates.length) return undefined;
    const rooms = pool ? await lovejoin.rooms(network) : undefined;
    const floor = NETWORKS[network].lovejoin?.poolFloor ?? 0;
    const works = (pool ? await lovejoin.usable(network, candidates, params) : candidates).filter((p) => {
      const room = rooms?.get(p.id);
      return !rooms || (!!room && room.others >= floor && room.free >= mixesPerBox(depth) * 2);
    });
    if (rooms) works.sort((a, b) => (rooms.get(b.id)?.others ?? 0) - (rooms.get(a.id)?.others ?? 0));
    const named = pools?.[unit];
    const chosen = named === null ? undefined : named === undefined ? works[0] : works.find((p) => p.id === named);
    const stuck = pool && chosen && (await lovejoin.stuck(network, chosen, params));
    return { unit, works, named, chosen, rooms, ...(stuck ? { stuck: true as const } : {}) };
  }

  /**
   * The way back of `choice`'s token, `width` a mix and `depth` deep: as many boxes as the least the swap asks for
   * makes, at most what one deposit holds, one chain takes and the pool has room for; `fund`, what its boxes take,
   * their ADA and every mix; and `leg`, what D3's rule weighs for its pool (wayOver): its boxes are funded, so it
   * pays for all its token makes. `short`: why its boxes aren't funded after all, said for the token, which then
   * comes back directly (34e's review, 2).
   */
  private async tokenAt(
    network: NetworkName,
    quote: SwapQuote,
    { unit, works, named, chosen, rooms, stuck }: TokenChoice,
    depth: number,
    width: LovejoinWidth,
    short?: string,
  ): Promise<{ way: NonNullable<SwapLovejoin["ways"]>[number]; fund: string; leg?: { pays: number; fits: number; room: number } }> {
    const perBox = mixesPerBox(depth, width) * (width - 1);
    const room = chosen && rooms ? Math.floor((rooms.get(chosen.id)?.free ?? 0) / perBox) : Infinity;
    const tokens = chosen ? Math.min(Number(BigInt(quote.minAmountOut) / BigInt(chosen.token!.quantity)), MAX_TOKEN_DEPOSIT_BOXES) : 0;
    const boxes = chosen && !short ? Math.min(tokens, chainBoxes(depth, width), room) : 0;
    const skipped = chosen
      ? short && tokens >= 1
        ? short
        : undefined
      : named === null
        ? undefined
        : named === undefined
          ? t("lj.tokens.skip.warn.noPool")
          : t("lj.tokens.skip.warn.poolCant");
    const funding = chosen && boxes >= 1 ? await this.deps.lovejoin!.funding(network, boxes, false, depth as LovejoinDepth, chosen, width) : undefined;
    return {
      way: {
        policyId: unit.slice(0, 56),
        assetName: unit.slice(56),
        ...(chosen ? { pool: chosen.id, quantity: chosen.token!.quantity } : {}),
        boxes: funding ? boxes : 0,
        ...(named === null ? { direct: true as const } : {}),
        pools: works.map((p) => p.id),
        ...(skipped ? { skipped } : {}),
        ...(stuck ? { stuck } : {}),
        mixes: funding?.mixes ?? 0,
        mixFees: funding?.mixFees ?? "0",
        withdrawFees: ((funding ? BigInt(boxes) : 0n) * LOVEJOIN_WITHDRAW_ESTIMATE).toString(),
      },
      fund: funding?.lovelace ?? "0",
      ...(chosen && !short ? { leg: { pays: tokens, fits: boxes, room } } : {}),
    };
  }

  /**
   * What spare ADA at a session's account pays for through Lovejoin at the
   * set depth (`price`): its boxes, at most what one chain takes
   * (chainBoxes: MAX_CHAIN_MIXES, and what one deposit makes), their mixes
   * (WebAssembly's MIX_FEE_ESTIMATE each) and about what bringing them back
   * takes. `pool`: also as Lovejoin's pool has room for now (room, a read
   * kept five minutes), `of` the boxes the ADA pays for when that's fewer,
   * and `skipped`, why it has none. `fixed`: a swap's approved depth and
   * wait, rather than Settings' now.
   *
   * Four boxes a mix as approved, or as Settings has it (chunk 34's D3), or
   * `width`; and three where four can't take what three would, as its
   * return goes (wayOver, 34e's review, 5): `price` from a width down, with
   * the width it went at and why; `at` each width's own, and what D3's rule
   * weighs (`leg`). `skipped` is three's: four falls back to it.
   */
  private async priced(network: NetworkName, pool: boolean, fixed?: AutoRecord["lovejoin"], width?: LovejoinWidth) {
    const lovejoin = this.deps.lovejoin!;
    const asked: LovejoinWidth = width ?? (fixed ? (fixed.width ?? 3) : (await lovejoin.settings()).width);
    const room = pool ? await lovejoin.room(network) : undefined;
    const at = async (w: LovejoinWidth) => {
      // What each box more takes, and what the chain takes besides: the deposit and its change.
      const [one, two] = await Promise.all([
        lovejoin.funding(network, 1, false, fixed?.depth, undefined, w),
        lovejoin.funding(network, 2, false, fixed?.depth, undefined, w),
      ]);
      const perBox = BigInt(two.lovelace) - BigInt(one.lovelace);
      const besides = BigInt(one.lovelace) - perBox;
      const fits = !room ? Infinity : poolShort(network, room, one.depth, w) ? 0 : Math.floor(room.free / (mixesPerBox(one.depth, w) * (w - 1)));
      const affordable = (spare: bigint) => (spare > besides ? Number((spare - besides) / perBox) : 0);
      const price = (spare: bigint) => {
        const pays = Math.min(affordable(spare), chainBoxes(one.depth, w));
        const boxes = Math.min(pays, fits);
        return {
          boxes,
          mixes: boxes * one.mixes,
          mixFees: (BigInt(boxes) * BigInt(one.mixFees)).toString(),
          withdrawFees: (BigInt(boxes) * LOVEJOIN_WITHDRAW_ESTIMATE).toString(),
          ...(boxes < pays ? { of: pays } : {}),
        };
      };
      const leg = (spare: bigint) => ({ pays: affordable(spare), fits: Math.min(affordable(spare), chainBoxes(one.depth, w), fits), room: fits });
      return { one, price, leg };
    };
    const three = await at(3);
    const four = asked === 4 ? await at(4) : undefined;
    const price = (spare: bigint, upTo: LovejoinWidth = asked) => {
      if (upTo === 3 || !four) return three.price(spare);
      const way = wayOver([four.leg(spare)], [three.leg(spare)]);
      if (way.width === 4) return { ...four.price(spare), width: 4 as const };
      return { ...three.price(spare), ...(way.fellBack ? { fellBack: way.fellBack } : {}) };
    };
    const skipped = room && poolShort(network, room, three.one.depth);
    return { price, at: { 3: three, 4: four }, skipped, depth: three.one.depth, delay: fixed?.delay ?? three.one.delay, asked };
  }

  /**
   * Whether the wallet swaps into `id`: ADA, a token on the wallet's own
   * list, or one Minswap's verified list has, found by its exact ID. Anyone
   * can put a token named like a known one in a private balance, and the
   * picker offers what's held. Asking Minswap about the one token tells it
   * nothing its quote doesn't.
   */
  private async verified(network: NetworkName, id: string): Promise<boolean> {
    if (id === "lovelace" || LISTED[network].has(id) || this.verifiedIds.has(`${network}:${id}`)) return true;
    const found = await this.deps.minswap(network).tokens(id, true);
    const verified = found.some((t) => t.token_id === id && t.is_verified !== false);
    if (verified) this.verifiedIds.add(`${network}:${id}`);
    return verified;
  }

  /**
   * Builds the payment that funds a new session for `quote`: the swap and its costs, and the account's collateral.
   * `through`: the approval's switch, when the user moved it (chunk 34's 34f); none, Settings'.
   */
  async outBuild(
    network: NetworkName,
    quote: SwapQuote,
    display?: { in: SwapSide; out: SwapSide },
    pools?: Record<string, string | null>,
    through?: boolean,
  ): Promise<SessionOutSummary & { lovejoin?: SwapLovejoin }> {
    const ask = checkAsk(quote.ask);
    if (!(await this.verified(network, ask.tokenOut))) throw new Error(UNVERIFIED());
    const index = await this.freshIndex(network);
    const address = (await this.accounts(network, [{ index, ownStake: true }])).get(index)!.address;
    // The parameters, once: for the funding, and whether a pool of the token it gets takes a box (34e's review, 9).
    const params = await this.deps.koios(network).epochParams();
    // Once, at Review, never as the user types: whether Lovejoin's pools take the boxes now (privacy review §2.7).
    // A token it gets through a pool of it has its boxes' ADA funded beside the swap's (chunk 34's 34e).
    let lovejoin = await this.lovejoinCost(network, quote, true, pools, { params, through });
    // Its collateral, mixed on its way into a 5 ₳ pool as it comes back, paid for too (tailReserve): the chain's
    // figure, as its margin comes back beside it.
    const asked = await this.tailReserve(network, through ?? (await this.throughLovejoin()), { params });
    const fund = (l: SwapLovejoin | undefined, reserve: bigint) =>
      this.buildFunding(
        network,
        index,
        address,
        [
          {
            to: address,
            lovelace: (BigInt(quote.fund.lovelace) + BigInt(l?.fund ?? "0") + reserve).toString(),
            tokens: quote.fund.tokens,
          },
          { to: address, lovelace: SESSION_COLLATERAL.toString(), tokens: [] },
        ],
        t("sess.emptySwap"),
        undefined,
        params,
      );
    // Without the collateral's reserve before without its token's boxes (323-worker#0): the boxes hide what the swap
    // gets, the reserve only the 5 ₳ collateral, which may still be mixed with what's left when the session comes back.
    const funded = (l?: SwapLovejoin) => this.orWithoutReserve(asked, (reserve) => fund(l, reserve));
    let made: Awaited<ReturnType<typeof funded>>;
    try {
      made = await funded(lovejoin);
    } catch (e) {
      // The private balance pays for the swap, as 1.5.0 funded it, but not its token's boxes as well: too little ADA
      // (NotEnoughPrivate), or more of its UTxOs than one transaction can spend. The token comes back directly, and
      // says why, rather than the swap be refused (34e's review, 2, and its fixes' review, 1). What another try may
      // mend is thrown as it is, and so is the swap's own funding failing too.
      const mendable = e instanceof WalletLocked || e instanceof KoiosError || e instanceof CollateralError || e instanceof StaleReviewError || isTrap(e);
      if (!lovejoin?.fund || mendable) throw e;
      lovejoin = await this.lovejoinCost(network, quote, true, pools, { params, short: t("lj.tokens.skip.warn.balance"), through });
      made = await funded(lovejoin);
    }
    const {
      built: { summary, txCbor, seed, first, later },
      reserve,
    } = made;
    const swap = { ...ask, amountOut: quote.amountOut, minAmountOut: quote.minAmountOut, ...(display ? { display } : {}) };
    // Sending this is the approval: the swap runs itself within it. Through the pools, as its review said, and
    // not as an order, whose minimum it didn't say the wallet relies on Minswap for (release review C09).
    const approved: AutoRecord["approved"] = {
      minAmountOut: quote.minAmountOut,
      fund: quote.fund,
      aggregatorFee: quote.aggregatorFee,
      ...(quote.againstPools ? { againstPools: true } : {}),
    };
    // Its depth, wait and width, as this review shows them, are the ones its return takes (independent review L21),
    // and the pool it shows for the token it gets the one its token goes into, or none (chunk 34's 34e).
    // How many boxes of each, which its return takes no more of (34e's review, 10).
    const ways = lovejoin?.ways ?? [];
    const boxed = ways.filter((w) => w.boxes >= 1);
    const tokens = ways.length
      ? {
          tokens: Object.fromEntries(ways.map((w) => [w.policyId + w.assetName, w.boxes ? w.pool! : null])),
          ...(boxed.length ? { tokenBoxes: Object.fromEntries(boxed.map((w) => [w.policyId + w.assetName, w.boxes])) } : {}),
        }
      : {};
    const way = lovejoin
      ? {
          lovejoin: {
            depth: lovejoin.depth as LovejoinDepth,
            delay: lovejoin.delay as LovejoinDelay,
            ...(lovejoin.width === 4 ? { width: 4 as const } : {}),
            ...tokens,
            ...(lovejoin.fund ? { fund: lovejoin.fund } : {}),
          },
        }
      : {};
    const kept: Omit<KeptOut, "builtAt"> & SessionOutSummary = {
      ...(first ?? summary),
      txCbor,
      seed,
      index,
      swap,
      approved,
      ...way,
      ...(reserve ? { tailReserved: true as const } : {}),
    };
    await this.keepFunding(SESSION_OUT, kept, later);
    return { ...summary, ...(lovejoin ? { lovejoin } : {}), ...(reserve ? { collateralReserve: reserve.toString() } : {}) };
  }

  /**
   * Builds the payment that funds a new private session for a site (private
   * CIP-30): `lovelace` and `tokens` for it, and the account's own collateral.
   */
  async siteOutBuild(network: NetworkName, origin: string, lovelace: string, tokens: TokenQuantity[]): Promise<SessionOutSummary> {
    const index = await this.freshIndex(network);
    const address = (await this.accounts(network, [{ index, ownStake: true }])).get(index)!.address;
    // Its collateral, mixed on its way into a 5 ₳ pool as it comes back, paid for too (tailReserve): what that takes
    // with nothing else left, since a site may spend all but the reserve. Without it where it isn't paid for too.
    const asked = await this.tailReserve(network, await this.throughLovejoin(), { direct: true });
    const {
      built: { summary, txCbor, seed, first, later },
      reserve,
    } = await this.orWithoutReserve(asked, (reserve) =>
      this.buildFunding(
        network,
        index,
        address,
        [
          { to: address, lovelace: (BigInt(lovelace) + reserve).toString(), tokens },
          { to: address, lovelace: SESSION_COLLATERAL.toString(), tokens: [] },
        ],
        t("sess.emptySession"),
      ),
    );
    const kept: Omit<KeptFunding, "builtAt"> = {
      ...(first ?? summary),
      txCbor,
      seed,
      site: { origin },
      ...(reserve ? { tailReserved: true as const } : {}),
    };
    await this.keepFunding(SESSION_SITE_OUT, kept, later);
    return { ...summary, ...(reserve ? { collateralReserve: reserve.toString() } : {}) };
  }

  /** Records the site's private session, then sends its funding. The connector waits for it to arrive. */
  siteOutSubmit(network: NetworkName, txHash: string, origin: string): Promise<{ index: number; pending: PendingTx }> {
    return this.serial(async () => {
      const { wallet, session, now } = this.deps;
      const built = await wallet.withKeys(() => session.get<KeptFunding>(SESSION_SITE_OUT));
      const book = await this.book(network);
      refuseStarted(book, txHash, built, network, "sess.alreadyStarted");
      if (!built || built.txHash !== txHash || built.network !== network || built.site?.origin !== origin) {
        throw new StaleReviewError(t("sess.outNotReady"));
      }
      if (now() - built.builtAt > BUILT_TTL_MS) {
        throw new StaleReviewError(t("sess.outTooOld"));
      }
      await this.stillUnused(network, built.index);
      // Recorded before it's sent: whatever happens next, this index is never used again.
      const record: SessionRecord = {
        index: built.index,
        ownStake: true,
        createdAt: now(),
        ...(await this.fundingRecords(network, built.index, SESSION_SITE_OUT, built)),
        site: { origin },
        ...(built.tailReserved ? { collateralReserve: true as const } : {}),
      };
      await this.save(network, { ...book, next: built.index + 1, sessions: [...book.sessions, record] });
      // The runs look for it until it lands, whether or not a page is open (runAll, final review F13).
      await this.deps.alarm?.start().catch(() => undefined);
      return { index: built.index, pending: await this.sendFunding(network, record, SESSION_SITE_OUT, "payment") };
    });
  }

  /**
   * Builds the funding of a new one-time account that mixes `boxes` boxes
   * (the Lovejoin tile, from the private balance): what the boxes and their
   * chain take, and the account's own collateral. Checked against the pool
   * first, so a mix that's sent can go through.
   */
  async mixOutBuild(
    network: NetworkName,
    boxes: number,
    { pool, bootstrap = false, width }: { pool?: string; bootstrap?: boolean; width?: LovejoinWidth } = {},
  ): Promise<SessionOutSummary & { mix: LovejoinFunding }> {
    const lovejoin = this.deps.lovejoin;
    if (!lovejoin?.available(network)) throw new Error(t("lj.notOnNetwork"));
    // A Bootstrap makes no mixes, so it draws nothing from the pool: the floor
    // doesn't apply, and it takes as many boxes as one deposit holds, and as
    // its funding's reserves pay the deposit and its sweep back for: past that,
    // the session would be funded, then come back without a box, its fees
    // spent (chunk 34's 34d review, 3; 1.6.0's release review, 318-rust#0).
    // Its funding is still a Seedelf spend, with giveme.my's collateral as any
    // is.
    checkBoxes(boxes, bootstrap ? mostBootstrap(pool) : MAX_MIX_BOXES);
    // The parameters, once: for the Bootstrap's cap or whether the pool takes a box, the collateral's reserve, and the
    // funding, as a swap's review reads them (1.6.0's release review, 318-worker#3).
    const params = await this.deps.koios(network).epochParams();
    if (bootstrap) checkBoxes(boxes, await lovejoin.privateBootstrapMost(network, pool, params), true);
    // Four boxes a mix where the form's switch (else Settings) has it and the pool has room for it, funded for that
    // (chunk 34's D3; the switch since the owner's test of 1.6.0).
    const way = bootstrap ? undefined : await lovejoin.fits(network, boxes, pool, width, params);
    // None to say is three: the width fits chose, never Settings read again (34e's review, 4).
    const { seed: _seed, ...funding } = await lovejoin.funding(network, boxes, false, bootstrap ? 0 : undefined, pool, way?.width ?? 3);
    // No mixes is a Bootstrap since chunk 34's 34d: its boxes are held in the pool until brought back by hand.
    if (bootstrap) return this.mixFunding(network, { ...funding, bootstrap: true }, params);
    return this.mixFunding(network, way?.fellBack ? { ...funding, fellBack: way.fellBack } : funding, params);
  }

  /**
   * Mix my boxes again: the funding of a new one-time account that pays for
   * every box of the wallet's in the pool to be fanned out again (as many as
   * the pool has others for), with no deposit, and its own collateral. One at
   * a time: two would spend the same boxes. The boxes a mix from the public
   * account put in only when asked `anyway`: paid from here, they tie the
   * private balance to the account (lovejoin.ts againBoxes).
   */
  async againBuild(
    network: NetworkName,
    anyway = false,
    pool?: string,
    asked?: LovejoinWidth,
  ): Promise<SessionOutSummary & { mix: LovejoinFunding }> {
    const lovejoin = this.deps.lovejoin;
    if (!lovejoin?.available(network)) throw new Error(t("lj.notOnNetwork"));
    if (await this.mixingAgain(network)) throw new Error(t("sess.mixingAgain"));
    // The parameters, once, as a new mix's review reads them (318-worker#3).
    const params = await this.deps.koios(network).epochParams();
    const { boxes, owned, width, fellBack, atThree } = await lovejoin.againBoxes(network, anyway, pool, asked, params);
    // At the width againBoxes chose, three when it names none: never Settings' read again, which a fallback to three
    // would over-fund (34e's review, 4).
    const funding = await lovejoin.funding(network, boxes, true, undefined, pool, width ?? 3);
    return this.mixFunding(
      network,
      {
        ...funding,
        owned,
        ...(anyway ? { publicToo: true } : {}),
        ...(fellBack ? { fellBack } : {}),
        ...(atThree ? { atThree } : {}),
      },
      params,
    );
  }

  /** Whether a mix of the wallet's boxes again may still spend them: Lovejoin withdraws none meanwhile. */
  async mixingAgain(network: NetworkName): Promise<boolean> {
    return (await this.book(network)).sessions.some(mixingAgain);
  }

  /** A mix session's funding, built and kept for Send. `params`: the protocol parameters its review read (318-worker#3). */
  private async mixFunding(
    network: NetworkName,
    funding: LovejoinFunding,
    params: Record<string, unknown>,
  ): Promise<SessionOutSummary & { mix: LovejoinFunding }> {
    // What the form counts of the collateral's mix (lovejoin-funding) stays out of what the review and the record keep
    // of the mix: the reserve this builds with is the summary's own, measured now.
    const { collateralReserve: _form, collateralPool: _pool, ...mix } = funding;
    const index = await this.freshIndex(network);
    const address = (await this.accounts(network, [{ index, ownStake: true }])).get(index)!.address;
    // Its collateral, mixed on its way into a 5 ₳ pool as it comes back, paid for too (tailReserve): in the one UTxO
    // that pays the mixes, whose change pays that mix too, and its chain's deposit's reserve the sweep after it. Not a
    // Bootstrap's, which puts up no collateral (buildBack).
    const asked = mix.bootstrap ? 0n : await this.tailReserve(network, true, { params });
    // A Bootstrap's way back in its place (1.6.0's release review, 318-rust#0): with no collateral its return is a
    // sweep of the deposit's change alone, whose Seedelf output must hold its least after the sweep's fee, and the
    // deposit's reserve leaves too little for that. WebAssembly's figure, the one privateBootstrapMost builds its cap
    // with; never added to `reserve`, which would count the boxes on 1.5 ₳ less (collateralReserve), nor left out with
    // it (orWithoutReserve).
    const back = mix.bootstrap ? BigInt(this.deps.wasm.lovejoinBootstrapReserve()) : 0n;
    const {
      built: { summary, txCbor, seed, first, later },
      reserve,
    } = await this.orWithoutReserve(asked, (reserve) =>
      this.buildFunding(
        network,
        index,
        address,
        [
          // A token pool's boxes take its token too, paid with their ADA in one UTxO, which the deposit spends.
          { to: address, lovelace: (BigInt(mix.lovelace) + reserve + back).toString(), tokens: mix.token ? [mix.token] : [] },
          // Its mixes' collateral. None for a Bootstrap: its deposit alone runs no script (the owner, 2026-10-23).
          ...(mix.bootstrap ? [] : [{ to: address, lovelace: SESSION_COLLATERAL.toString(), tokens: [] }]),
        ],
        t(mix.again ? "sess.emptyMixPay" : "sess.emptyMix"),
        undefined,
        params,
        // Mixing again pays its mixes from the account's largest UTxO (WebAssembly's plan): its funding stays one
        // transaction, so it's one UTxO. A deposit spends everything at the account, so a new mix's may go in parts;
        // not a Bootstrap's, whose cap is what a deposit of one funding UTxO leaves room for (mostBootstrap,
        // privateBootstrapMost): each part's output more in its deposit costs fee, and near the cap the deposit
        // couldn't pay, so it came back with no box and its fees spent (1.6.0's review). As one, it goes or is refused
        // before anything does, in the user's words: fewer boxes take fewer UTxOs.
        { inParts: !mix.again && !mix.bootstrap },
      ).catch((e: unknown) => {
        if (mix.bootstrap && e instanceof Error && TOO_MANY.test(e.message)) throw new Error(t("sess.bootstrapTooMany"));
        throw e;
      }),
    );
    const kept: Omit<KeptMix, "builtAt"> = {
      ...(first ?? summary),
      txCbor,
      seed,
      mix,
      ...(reserve ? { tailReserved: true as const } : {}),
      ...(back ? { backReserved: true as const } : {}),
    };
    await this.keepFunding(SESSION_MIX_OUT, kept, later);
    return {
      ...summary,
      mix,
      ...(reserve ? { collateralReserve: reserve.toString() } : {}),
      ...(back ? { bootstrapReserve: back.toString() } : {}),
    };
  }

  /** Records the mix session, then sends its funding. From here it runs itself. */
  mixOutSubmit(network: NetworkName, txHash: string): Promise<{ index: number; pending: PendingTx }> {
    return this.serial(async () => {
      const { wallet, session, now } = this.deps;
      const built = await wallet.withKeys(() => session.get<KeptMix>(SESSION_MIX_OUT));
      const book = await this.book(network);
      refuseStarted(book, txHash, built, network, "sess.mixStarted");
      if (!built || built.txHash !== txHash || built.network !== network) {
        throw new StaleReviewError(t("lj.mixNotReady"));
      }
      if (now() - built.builtAt > BUILT_TTL_MS) throw new StaleReviewError(t("lj.mixTooOld"));
      if (built.mix.again && book.sessions.some(mixingAgain)) throw new Error(t("sess.mixingAgain"));
      await this.stillUnused(network, built.index);
      // Recorded before it's sent: whatever happens next, this index is never used again.
      const record: SessionRecord = {
        index: built.index,
        ownStake: true,
        createdAt: now(),
        ...(await this.fundingRecords(network, built.index, SESSION_MIX_OUT, built)),
        mix: {
          boxes: built.mix.boxes,
          ...(built.mix.again ? { again: true } : {}),
          ...(built.mix.publicToo ? { publicToo: true } : {}),
          ...(built.mix.bootstrap ? { bootstrap: true } : {}),
          ...(built.backReserved ? { noCollateral: true as const } : {}),
          ...(built.mix.pool ? { pool: built.mix.pool } : {}),
          ...(built.mix.width === 4 ? { width: 4 as const } : {}),
        },
        auto: { approved: { minAmountOut: "0", fund: { lovelace: built.mix.lovelace, tokens: [] } } },
        ...(built.tailReserved ? { collateralReserve: true as const } : {}),
      };
      await this.save(network, { ...book, next: built.index + 1, sessions: [...book.sessions, record] });
      const pending = await this.sendFunding(network, record, SESSION_MIX_OUT, "mix");
      await this.deps.alarm?.start();
      return { index: built.index, pending };
    });
  }

  /**
   * Builds another payment into a site's private session: `lovelace` and
   * `tokens`, from the private balance, and a new 5 ₳ collateral when the
   * account holds none it can put up (independent review M9). A return takes
   * everything at the account, its collateral too, and a site's transaction
   * may spend it: without one the site has none for its contracts, and the
   * next return can't go through Lovejoin. One a return's chain being sent
   * will spend doesn't count.
   */
  async topUpBuild(network: NetworkName, index: number, lovelace: string, tokens: TokenQuantity[]): Promise<SessionOutSummary> {
    const s = await this.live(network, index);
    if (!s.site) throw new Error(t("sess.onlySiteTopUp"));
    const { address, keyHash } = (await this.accounts(network, [s])).get(index)!;
    const held = await this.accountUtxos(network, keyHash);
    // A new collateral, and, where it would be mixed on its way into a 5 ₳ pool as the session comes back, what that
    // mix takes with nothing else left, as a site's funding has it (tailReserve). Without it where it isn't paid for
    // too.
    const fresh = !held.some(collateralFits);
    const asked = fresh ? await this.tailReserve(network, await this.throughLovejoin(s), { direct: true }) : 0n;
    const payments = (reserve: bigint) =>
      fresh
        ? [
            { to: address, lovelace: (BigInt(lovelace) + reserve).toString(), tokens },
            { to: address, lovelace: SESSION_COLLATERAL.toString(), tokens: [] },
          ]
        : [{ to: address, lovelace, tokens }];
    // One transaction, as a top-up always was: its record is one top-up (topUpSubmit).
    const {
      built: { summary, txCbor, seed },
      reserve,
    } = await this.orWithoutReserve(asked, (reserve) =>
      this.buildFunding(network, index, address, payments(reserve), t("sess.emptyTopUp"), undefined, undefined, { inParts: false }),
    );
    const kept: Omit<KeptFunding, "builtAt"> = { ...summary, txCbor, seed, ...(reserve ? { tailReserved: true as const } : {}) };
    await keep(this.deps, SESSION_TOP_UP, kept);
    return { ...summary, ...(reserve ? { collateralReserve: reserve.toString() } : {}) };
  }

  /** Records the top-up built last in its session, then sends it. */
  topUpSubmit(network: NetworkName, txHash: string): Promise<PendingTx> {
    return this.serial(async () => {
      const { wallet, session, now } = this.deps;
      const built = await wallet.withKeys(() => session.get<KeptFunding>(SESSION_TOP_UP));
      const ours = !!built && built.txHash === txHash && built.network === network;
      // Sent already, by its session's record (and not turned away), before whether it's kept or too old: one that
      // went out isn't kept any more, and called stale, its page would build a second top-up (chunk 23's second
      // review, fix round). Unless Send's copy says it may have gone (`sentCbor`): Send sends those bytes again,
      // however old, as script-spend.ts's send does, and the network takes them once.
      const again = ours && built.sentCbor !== undefined;
      if (!again && sentIn(await this.book(network), txHash)) throw new Error(t("worker.spend.sentAlready"));
      if (!ours) throw new StaleReviewError(t("sess.topUpNotReady"));
      if (!again && now() - built.builtAt > BUILT_TTL_MS) {
        throw new StaleReviewError(t("sess.topUpTooOld"));
      }
      const s = await this.live(network, built.index);
      // A session brought back by hand takes one 5 ₳ at a time, and none while a cancel of it is on its way. Its
      // builds check outside the queue, on the record as they read it before Koios answered, so another window's
      // may have missed this one's top-up: asked again here, by the same rules, before anything is recorded
      // (1.5.0's release review, C29).
      if (!again && byHand(s)) {
        if (cancelling(s, now())) throw new Error(t("sess.cancelCollateral.cancelling"));
        if (afterFunding(s).some((x) => x.txHash !== txHash && topUpOnItsWay(x, now()))) throw new Error(t("sess.topUpOnItsWay"));
      }
      const out = await this.outRecord(network, built.index, txHash, built.txCbor);
      await this.update(network, built.index, (s) => {
        // Once in the record: a try turned away gives way to this one, and one that may have gone stays as it was.
        s.txs = s.txs.filter((x) => x.txHash !== txHash || !x.unsent);
        if (!s.txs.some((x) => x.txHash === txHash)) s.txs.push(out);
        if (built.tailReserved) s.collateralReserve = true;
      });
      // Looked for until it lands, as a funding is (runAll, final review F13).
      await this.deps.alarm?.start().catch(() => undefined);
      try {
        return await send(this.deps, network, txHash, SESSION_TOP_UP, "session-out", "topUp");
      } catch (e) {
        // Sent again, an earlier try may have gone and the watch still sends it: whatever this one met (a 429, a
        // node down), it stays on its way, and Disconnect waits for it (sendRecorded's `unanswered`).
        if (!again) await this.markUnsent(network, built.index, txHash, e);
        throw e;
      }
    });
  }

  /**
   * Builds 5 ₳ into a session brought back by hand, from the private
   * balance, for the cancel of its open order: the cancel puts up a UTxO of
   * ADA alone at the account as collateral (cancelOf), and a session the
   * restore scan found may hold none, its return from before chunk 24 having
   * taken everything while the order waited. Only while an order of it is
   * open and no cancel of it is on its way (cancelling), the account holds no
   * collateral the cancel can put up, and none is on its way. Kept as a
   * top-up is, and sent by topUpSubmit.
   */
  async cancelCollateralBuild(network: NetworkName, index: number): Promise<SessionOutSummary> {
    const s = await this.live(network, index);
    if (!byHand(s)) throw new Error(t("sess.cancelCollateral.byHand"));
    if (cancelling(s, this.deps.now())) throw new Error(t("sess.cancelCollateral.cancelling"));
    const { address, keyHash } = (await this.accounts(network, [s])).get(index)!;
    const orders = await this.liveOrders(network, s, address);
    if (!orders.length) throw new Error(t("sess.noOrderWaiting"));
    const rows = await this.utxosOf(network, keyHash);
    if (holdsCancelCollateral(rows)) throw new Error(t("sess.cancelCollateral.there"));
    if (topUpComing(s, rows, this.deps.now())) throw new Error(t("sess.cancelCollateral.coming"));
    // The cancel it's for, run first on a stand-in for it, as a swap's own cancels are before it's signed (release
    // review C05): 5 ₳ put in for a cancel the order's script refuses would wait at the account with the order, which
    // no return takes while it's open. Refused in the cancel's own words (1.5.0's release review, C30).
    await this.cancelOf(network, address, [...rows, collateralStandIn(address, keyHash)], orders);
    return this.collateralTopUp(network, s, address);
  }

  /**
   * Builds 5 ₳ into a session brought back by hand, from the private
   * balance, for its return through Lovejoin: the mixes put up a UTxO of
   * exactly 5 ₳ of ADA alone at the account as collateral (buildBack), and a
   * session the restore scan found may hold none, a return having taken it
   * before money reached the account again. Only while no order of it waits
   * and no cancel of it is on its way, and while its return would go through
   * Lovejoin but for that collateral alone, as the return itself decides
   * (lovejoinWantsCollateral), none of it at the account or on its way. Kept
   * as a top-up is, and sent by topUpSubmit (1.5.0's release review, C53).
   */
  async backCollateralBuild(network: NetworkName, index: number): Promise<SessionOutSummary> {
    const s = await this.live(network, index);
    if (!byHand(s)) throw new Error(t("sess.backCollateral.byHand"));
    if (cancelling(s, this.deps.now())) throw new Error(t("sess.cancelCollateral.cancelling"));
    const { address, keyHash } = (await this.accounts(network, [s])).get(index)!;
    if (s.txs.some((x) => x.kind === "swap") && (await this.liveOrders(network, s, address)).length) {
      throw new Error(t("sess.orderWaitingBack"));
    }
    const rows = await this.utxosOf(network, keyHash);
    if (rows.some(collateralFits)) throw new Error(t("sess.backCollateral.there"));
    if (!(await this.lovejoinWantsCollateral(network, s, rows))) throw new Error(t("sess.backCollateral.notNeeded"));
    if (topUpComing(s, rows, this.deps.now())) throw new Error(t("sess.backCollateral.coming"));
    return this.collateralTopUp(network, s, address);
  }

  /**
   * 5 ₳ from the private balance to session `s`'s account alone, for a
   * session brought back by hand (cancelCollateralBuild,
   * backCollateralBuild): built with a top-up's rules and kept as one, for
   * topUpSubmit. The session's own private money goes first: what its
   * fundings and top-ups left, those the restore scan found too, and what a
   * transaction its key signed paid there (`recovered.own`). It's tied to the
   * session on chain already, though after a restore no history says so
   * (1.5.0's release review, C36).
   */
  private async collateralTopUp(network: NetworkName, s: SessionRecord, address: string): Promise<SessionOutSummary> {
    const payments = [{ to: address, lovelace: SESSION_COLLATERAL.toString(), tokens: [] }];
    const own = new Set([...s.txs.filter((x) => x.kind === "out" && !x.unsent).map((x) => x.txHash), ...(s.recovered?.own ?? [])]);
    const { summary, txCbor, seed } = await this.buildFunding(network, s.index, address, payments, t("sess.emptyTopUp"), own, undefined, {
      inParts: false,
    });
    const kept: Omit<KeptFunding, "builtAt"> = { ...summary, txCbor, seed };
    await keep(this.deps, SESSION_TOP_UP, kept);
    return summary;
  }

  /**
   * Ends a site's private session, once nothing more is on its way to its
   * account or from it, and the account is empty. Nothing reads a closed
   * session again, so it waits for its return's chain, and for every
   * transaction of its that may still land (tx_status): a funding, a top-up,
   * a return. One the chain hasn't shown in FAILED_AFTER_MS never reached it
   * (a funding that never landed can be disconnected), unless the wallet's
   * watch (pending.ts) still sends it, or took it within that long: then
   * the cutoff counts from then (final review sessions-6). The account is
   * read as Koios lists it, what this wallet spent included: a return that
   * never lands leaves its inputs there. What no return takes doesn't count.
   * An empty read isn't enough alone: Koios must show what the session's
   * fundings and top-ups paid the account spent, and what its site's signed
   * transactions pay it, those it knows (ownGone, independent review M4).
   * This is the check that matters: Settings disconnects a site with no
   * other. Its index isn't used again, and its record, with the site's
   * origin, goes (unless something is left behind at its account).
   */
  disconnect(network: NetworkName, index: number): Promise<void> {
    return this.serial(async () => {
      const { wallet, session, now } = this.deps;
      let s = await this.live(network, index);
      if (!s.site) throw new Error(t("sess.notSite"));
      if (await this.pendingChain(network, index)) {
        throw new Error(t("sess.chainSendingDisconnect"));
      }
      const koios = this.deps.koios(network);
      const waiting = s.txs.filter((t) => !t.confirmed && !t.unsent);
      if (waiting.length) {
        const statuses = await this.landed(network, waiting);
        const on = new Set(waiting.filter((t) => statuses.get(t.txHash) != null).map((t) => t.txHash));
        if (on.size) s = await this.noteLanded(network, await this.update(network, index, (r) => void settle(r, on)));
        const recent = s.txs.some((t) => !t.confirmed && !t.unsent && now() - t.at <= FAILED_AFTER_MS);
        if (recent || (await this.stillWatched(network, s))) {
          throw new Error(t("sess.lastTxWaiting"));
        }
      }
      // A return seen on chain earlier, whose history's write failed then: written now, before its record goes
      // and takes the summary with it (independent review M7).
      s = await this.noteLanded(network, s);
      const { keyHash } = (await this.accounts(network, [s])).get(index)!;
      const spent = await wallet.withKeys(() => spentSet(session));
      const rows = await readFresh(spent, () => koios.credentialUtxos([keyHash]), (r) => r, this.deps.sleep);
      // A funding or a top-up this read shows at the account landed: kept so, for every read after this one,
      // however far behind it (final review F13).
      const seen = fundingsListed(s, rows);
      if (seen.size) s = await this.update(network, index, (r) => void settle(r, seen));
      if (returnable(s, rows).length) {
        throw new Error(t("sess.accountHolds"));
      }
      // An empty read proves nothing alone: a Koios backend behind the funding, a top-up or the site's own
      // transaction reads the account empty. What they paid it must show spent (independent review M4).
      const listed = new Set(rows.map(outpoint));
      const known = await this.spentStates(network, ownOuts(s));
      if (!ownGone(s, known, listed, now())) {
        // A funding or a top-up Koios knows nothing of, that may still land, waits its time out (final review F13).
        const unseen = s.txs.some((t) => awaitsLanding(t, now()) && t.outs?.some((o) => !known.has(o)));
        throw new Error(unseen ? FUNDING_UNSEEN() : NOT_CAUGHT_UP());
      }
      // What's left behind, as far as the account still has it (independent review L19): one a transaction
      // took since (the site's, or a later return) points to nothing, and keeps no record, nor the site's
      // origin. A read that's behind may miss one still there: the session's own were checked with Koios
      // above, and a stranger's no return takes anyway.
      const left = (s.leftBehind ?? []).filter((b) => listed.has(`${b.txHash}#${b.txIndex}`));
      // Closed, nothing shows a site's session again (the dApps page and
      // Bring everything back take open ones), and which site had one says
      // something about the user: its record goes, `next` keeping its index
      // from being used again (privacy review §3.12). One with something no
      // return takes still at its account (`leftBehind`) stays, closed, to
      // point to it.
      const book = await this.book(network);
      const closing = book.sessions.find((r) => r.index === index)!;
      if (left.length) {
        closing.leftBehind = left;
        closing.closedAt = now();
      }
      await this.save(network, {
        ...book,
        sessions: left.length ? book.sessions : book.sessions.filter((r) => r !== closing),
      });
    });
  }

  /**
   * Whether a transaction of session `s` the chain hasn't shown (a funding
   * or a top-up) is one the wallet's watch (pending.ts) still has: maybe
   * sent, and sent again now and then, or taken again within
   * FAILED_AFTER_MS. Such a one may land after the session's own 20 minutes.
   * Read from the watch and its sealed copy, with no Koios call. A lock wipes
   * the watch until the sealed copy is put back, so this only ever adds a
   * refusal, never proves one dead.
   */
  private async stillWatched(network: NetworkName, s: SessionRecord): Promise<boolean> {
    const { wallet, session, store, now } = this.deps;
    const waiting = new Map(s.txs.filter((t) => !t.confirmed && !t.unsent).map((t) => [t.txHash, t]));
    if (!waiting.size) return false;
    type Watched = PendingTx & { resentAt?: number };
    const watched = await wallet.withKeys(() => session.get<Watched>(pendingKey(network)));
    const sealed = await store.get<Watched | null>(`maybeSent.${network}`).catch((e: unknown) => {
      // One that won't open can't be put back, as pending.ts reads it.
      if (e instanceof UnreadableRecordError) return undefined;
      throw e;
    });
    return [watched, sealed].some((w) => {
      if (!w || w.network !== network || w.confirmations !== null || w.dropped) return false;
      const t = waiting.get(w.txHash);
      if (!t) return false;
      // Maybe sent: sent again now and then, until the chain shows it or the watch lets it go.
      if (w.maybeSent) return true;
      return now() - Math.max(t.at, w.submittedAt, w.resentAt ?? 0) <= FAILED_AFTER_MS;
    });
  }

  /** A site's private session, for the connector: its address, reward address and payment key hash. */
  async siteAccount(network: NetworkName, index: number): Promise<{ address: string; reward: string; keyHash: string }> {
    const s = await this.live(network, index);
    if (!s.site) throw new Error(t("sess.notSite"));
    const { address, keyHash } = (await this.accounts(network, [s])).get(index)!;
    const { wasm, wallet } = this.deps;
    const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;
    const reward = await wallet.withKeys((keys) => keys.oneTime.rewardAddress(net, index));
    return { address, reward, keyHash };
  }

  /**
   * Records what a site's transaction, signed for its private session, pays
   * the session's account (`siteOuts`), before the site has the signature
   * (independent review M4): Disconnect then waits, as for a funding, until
   * Koios shows each spent that it knows. By payment key, whatever the
   * staking part, as Koios lists the account; as WebAssembly read the
   * transaction (`summary`) when its bytes can't be read here. A session
   * that's over, or gone, meanwhile throws, and the site gets no signature.
   */
  siteSigned(
    network: NetworkName,
    index: number,
    txCbor: string,
    summary: Pick<DappTxSummary, "txHash" | "ownOutputs">,
  ): Promise<void> {
    return this.serial(async () => {
      const s = await this.live(network, index);
      if (!s.site) throw new Error(t("sess.notSite"));
      const { keyHash } = (await this.accounts(network, [s])).get(index)!;
      const outs =
        paysAccount(txCbor, summary.txHash, keyHash) ?? summary.ownOutputs.map((o) => `${summary.txHash}#${o.txIndex}`);
      if (!outs.length) return;
      await this.update(network, index, (r) => {
        r.siteOuts = [...new Set([...(r.siteOuts ?? []), ...outs])].slice(-SITE_OUTS_KEPT);
      });
    });
  }

  /**
   * What the connector read at a site's private session's account while it
   * waited for the funding (dapp.ts watchFunding): a funding or a top-up
   * with an output there landed, and is marked so, whatever tx_status says.
   * From then on only Koios showing what it paid spent ends the session,
   * never a read that's behind it (ownGone, final review F13). Returns where
   * its funding is (fundingState): one in parts has landed only once every
   * part has, and a site's `enable()` waits for that (the owner's call,
   * 2026-10-21).
   */
  fundingSeen(network: NetworkName, index: number, rows: KoiosUtxo[]): Promise<"landed" | "funding" | "short" | "never"> {
    return this.serial(async () => {
      let s = (await this.book(network)).sessions.find((r) => r.index === index);
      // No record to read, or over: what's there is all it ever was, as before funding in parts.
      if (!s || s.closedAt) return "landed";
      const seen = fundingsListed(s, rows);
      if (seen.size) s = await this.update(network, index, (r) => void settle(r, seen));
      return fundingState(s, rows, s.auto ? {} : { now: this.deps.now(), waiting: await this.stillWaiting(network, s) }).state;
    });
  }

  /**
   * Where a site's private session's funding is, for the connector to answer the site's `enable()` and its reads
   * (dapp.ts), whichever page asks: one in parts that hasn't all landed, read at its account (fundingSeen). Any other
   * is the site's as it always was, with no read.
   */
  async siteFunding(network: NetworkName, index: number): Promise<"landed" | "funding" | "short" | "never"> {
    const s = (await this.book(network)).sessions.find((r) => r.index === index);
    if (!s || s.closedAt || !s.parts || fundingOf(s).every((t) => t.confirmed)) return "landed";
    const { keyHash } = (await this.accounts(network, [s])).get(index)!;
    return this.fundingSeen(network, index, await this.accountUtxos(network, keyHash));
  }

  /**
   * Every private session index this wallet has used on `network`, as far as
   * its book knows: every one up to the next, and each it holds. The
   * connector says so in a site's prompt when its transaction pays one of
   * them (dapp.ts, independent review M12).
   */
  async indices(network: NetworkName): Promise<number[]> {
    const book = await this.book(network);
    return [...new Set([...Array.from({ length: book.next }, (_, i) => i), ...book.sessions.map((s) => s.index)])];
  }

  /**
   * The restore scan (O5, chunk 27; keys-and-accounts.md, Accounts). The
   * book is sealed on one device, so after a restore, or with the same
   * phrase in another browser, it has none of its sessions, and what their
   * one-time accounts hold doesn't show (independent review M5). This finds
   * the accounts the phrase used that the book doesn't know, and adds each
   * that holds something, or has an order open, as a session found
   * (`recovered`), brought back by hand. Every used index moves the book's
   * `next` past it. It runs at a restore and from Find leftovers, never as
   * the wallet opens: the server sees every account it's asked about
   * together, from one IP address. One at a time on a network. A restore's
   * waits for its look for public accounts first (`after`), under way all
   * the same: Find leftovers meanwhile shares it, and the two never ask
   * together.
   */
  scan(network: NetworkName, after?: Promise<unknown>): Promise<SessionScan> {
    // However the look ends, the scan goes on: it found what it found.
    const looked = (after ?? Promise.resolve()).catch(() => undefined);
    const running = this.scanning.get(network);
    if (running) return running;
    const run: Promise<SessionScan> = looked
      .then(() => this.scanNow(network))
      .finally(() => {
        // Its own only: Remove wallet lets it go, and the next phrase's may have started since (reset).
        if (this.scanning.get(network) === run) this.scanning.delete(network);
      });
    this.scanning.set(network, run);
    return run;
  }

  /**
   * A restore made this wallet: `network`'s book is marked as not scanned
   * since (Book `unscanned`), before its scan starts, so a scan that doesn't
   * finish, and the network a restore doesn't look at, say so.
   */
  markUnscanned(network: NetworkName): Promise<void> {
    return this.serial(async () => {
      const book = await this.book(network);
      if (!book.unscanned) await this.save(network, { ...book, unscanned: true });
    });
  }

  /**
   * Whether a restore's scan hasn't finished on `network` since the restore
   * (`due`: Book `unscanned`), and whether a scan runs there now, the
   * restore's from its look for public accounts on (`scanning`): the dApps
   * page points to Find leftovers while one is due and none runs. The
   * device's record alone, no Koios request.
   */
  async scanDue(network: NetworkName): Promise<{ due: boolean; scanning: boolean }> {
    // A restore still making the wallet: its scan is coming, and there's no wallet yet to read the record with.
    if (this.restoring.has(network)) return { due: true, scanning: true };
    return { due: !!(await this.book(network)).unscanned, scanning: this.scanning.has(network) };
  }

  /**
   * The scan: each one-time stake key (`2/i`), INDEX_PROBE at a time
   * (`account_addresses`), until a run of them is all unused, as BIP44's gap
   * (sessions take their index from one sequence, freshIndex, and only a
   * funding never sent leaves one unused); then, for the used ones the book
   * doesn't know, what they hold (`credential_utxos`, 75 a request) and
   * their orders still open (recoveredRecords, liveOrders). Nothing is
   * written until it's all read, and then into the book as it is by then:
   * a session started meanwhile keeps its index. A server behind the one
   * that showed an account used fails it, rather than say nothing's there.
   * Only the phrase it started on is read for, and written for: the wallet
   * removed and another phrase restored meanwhile ends it, as a lock does.
   */
  private async scanNow(network: NetworkName): Promise<SessionScan> {
    const { wasm, wallet, session } = this.deps;
    const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;
    const koios = this.deps.koios(network);
    // The phrase the run reads for, by its first one-time key, from the first read on: a key read or the merge under
    // another, the wallet removed and another phrase restored meanwhile, throws as a lock does, so nothing of this run
    // goes into that phrase's book (1.5.0's release review, C16).
    let phrase: string | undefined;
    const pin = (keys: Keys) => {
      const id = keys.oneTime.keyHash(0);
      if ((phrase ??= id) !== id) throw new WalletLocked(t("worker.wallet.locked"));
    };
    const used: number[] = [];
    for (let first = 0; first < SCAN_MOST; first += INDEX_PROBE) {
      const probe = await wallet.withKeys((keys) => {
        pin(keys);
        return Array.from({ length: INDEX_PROBE }, (_, i) => ({
          index: first + i,
          reward: keys.oneTime.rewardAddress(net, first + i),
        }));
      });
      const seen = await koios.usedStakeAddresses(probe.map((p) => p.reward));
      const hits = probe.filter((p) => seen.has(p.reward)).map((p) => p.index);
      if (!hits.length) break;
      used.push(...hits);
    }
    const known = new Set((await this.book(network)).sessions.map((s) => s.index));
    const lost = used.filter((i) => !known.has(i));
    const found: Array<{ record: SessionRecord; held: KoiosUtxo[] }> = [];
    if (lost.length) {
      // Every session since chunk 15b has its own stake key: none from before (preprod's alone) is found.
      const accounts = await this.accounts(network, lost.map((index) => ({ index, ownStake: true })));
      const spent = await wallet.withKeys((keys) => {
        pin(keys);
        return spentSet(session);
      });
      const held = unspent(await koios.credentialUtxos(lost.map((i) => accounts.get(i)!.keyHash)), spent);
      const { records, read } = await this.recoveredRecords(network, lost, accounts, pin);
      // Money at an account the server shows no transaction of yet: a backend behind the one that listed it. Said so,
      // with nothing written, never "nothing found"; Find leftovers asks again (1.5.0's release review, C14).
      const listed = new Set(records.map((r) => accounts.get(r.index)!.keyHash));
      if (held.some((u) => !listed.has(u.payment_cred ?? ""))) throw new KoiosError(NOT_CAUGHT_UP(), "silent");
      for (const record of records) {
        const { address, keyHash } = accounts.get(record.index)!;
        const rows = held.filter((u) => u.payment_cred === keyHash);
        // What the scan read there, kept with its funding: nothing ends the session before Koios shows each spent, or
        // still there and left behind, never an empty read alone (ownGone, independent review M4; 1.5.0's release
        // review, C02).
        if (rows.length) record.txs[0]!.outs = rows.map(outpoint);
        // Its orders as recoveredRecords read them, spent or not: never asked again (1.5.0's release review, C15).
        const open = rows.length ? [] : await this.liveOrders(network, record, address, false, read);
        if (rows.length || open.length) found.push({ record, held: rows });
      }
    }
    const added = await this.serial(async () => {
      // Never into another phrase's book (above).
      await wallet.withKeys(pin);
      const book = await this.book(network);
      const have = new Set(book.sessions.map((s) => s.index));
      const fresh = found.filter((f) => !have.has(f.record.index));
      const next = Math.max(book.next, ...used.map((i) => i + 1));
      // Written anew, the restore's mark that no scan has finished here goes with it (Book `unscanned`).
      if (fresh.length || next !== book.next || book.unscanned) {
        await this.save(network, { next, sessions: [...book.sessions, ...fresh.map((f) => f.record)] });
      }
      return fresh;
    });
    // What each holds, as read: the list shows it before its first refresh.
    for (const f of added) this.seen.set(`${network}:${f.record.index}`, f.held);
    return { used: used.length, found: added.map((f) => f.record.index) };
  }

  /**
   * One-time accounts `lost` as sessions the restore scan found: each one's
   * transactions (`account_txs`, one request an account, up to 1,000), what
   * they spent and paid (`tx_info`, 20 a request), its funding (its first),
   * and its own beside it: every one its key signed (that spent from it),
   * and every other that spent a UTxO of this phrase's private balance (a
   * funding's other parts, a top-up), each register checked (`utxo_info`,
   * spent or not, asked with the orders' rows). Its orders are
   * found through the swap that placed them, never by address (a SundaeSwap
   * V3 order sits under Minswap's staking part): each output the key's
   * transactions paid to a DEX order script the wallet can cancel at, read
   * (`utxo_info`, and `datum_info` for a datum kept by hash, 60 a request)
   * as the account's own, spent or not: whether it's still open is
   * liveOrders', off those same rows (`read`), whatever came after it, since
   * a return from before chunk 24 checked only Minswap's list. An account the
   * server shows no transaction of yet (a backend behind the one that showed
   * it used) is left out: scanNow fails the scan when it holds something. A
   * transaction listed that `tx_info` has no row of fails it here: what it
   * spent and placed isn't known yet, an order among it. So does a UTxO one
   * spent at the wallet contract that `utxo_info` has no row of. `pin`: keys
   * of the phrase the scan started on, as scanNow's.
   */
  private async recoveredRecords(
    network: NetworkName,
    lost: number[],
    accounts: Map<number, { address: string; keyHash: string }>,
    pin: (keys: Keys) => void,
  ): Promise<{ records: SessionRecord[]; read: Map<string, KoiosUtxo & { is_spent?: boolean }> }> {
    const { wasm, wallet, now, contract = CONTRACT_V1 } = this.deps;
    const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;
    const koios = this.deps.koios(network);
    const rewards = await wallet.withKeys((keys) => {
      pin(keys);
      return lost.map((index) => keys.oneTime.rewardAddress(net, index));
    });
    const txsOf = new Map<number, KoiosAccountTx[]>();
    for (const [i, index] of lost.entries()) txsOf.set(index, await koios.accountTxs(rewards[i]!, { after: 0 }));
    const hashes = [...new Set([...txsOf.values()].flat().map((t) => t.tx_hash))];
    const info = new Map((await koios.txSpends(hashes)).map((r) => [r.tx_hash, r]));
    // Koios has a row for every transaction it lists: one missing is from a backend behind the one that listed it
    // (1.5.0's release review, C14).
    if (hashes.some((h) => !info.has(h))) throw new KoiosError(NOT_CAUGHT_UP(), "silent");
    // How WebAssembly reads an output for the account at `address`; one it can't read isn't an order.
    const read = (hex: string, datum: string, address: string, form?: { inline?: boolean; scriptRef?: boolean }) => {
      try {
        return dexOrderAt(wasm, network, hex, datum, address, form);
      } catch (e) {
        if (isTrap(e)) throw e;
        return undefined;
      }
    };
    const hexOf = (bech32: string) => {
      try {
        return wasm.cip30Address(bech32);
      } catch (e) {
        if (isTrap(e)) throw e;
        return undefined;
      }
    };
    // The outputs its key's transactions paid to an order script (`known`), by outpoint: whose, and which swap.
    const candidates = new Map<string, { index: number; tx: string }>();
    const signed = new Map<number, KoiosAccountTx[]>();
    // Each transaction its key didn't sign, but the funding the record takes (its oldest), that spent a UTxO at the
    // wallet contract, by the first it spent there: a funding in parts is a transaction a part, and a top-up one more,
    // each a Seedelf spend, which its key never signs (1.6.0's release review, x-scenarios-sessions#0). Every UTxO a
    // Seedelf spend of this phrase's takes is its own, so the first says whose the transaction is.
    const paid = new Map<number, Array<{ tx: KoiosAccountTx; input: string }>>();
    for (const index of lost) {
      const { address, keyHash } = accounts.get(index)!;
      const own = txsOf.get(index)!.filter((t) => info.get(t.tx_hash)?.inputs?.some((i) => i.payment_addr.cred === keyHash));
      signed.set(index, own);
      const unsigned = txsOf.get(index)!.filter((t) => !own.includes(t));
      paid.set(
        index,
        unsigned.slice(0, -1).flatMap((tx) => {
          const input = (info.get(tx.tx_hash)?.inputs ?? []).find(
            (i) => i.payment_addr.cred === contract.walletContractHash && i.tx_hash && i.tx_index != null,
          );
          return input ? [{ tx, input: `${input.tx_hash}#${input.tx_index}` }] : [];
        }),
      );
      for (const t of own) {
        for (const o of info.get(t.tx_hash)?.outputs ?? []) {
          if (o.tx_index == null || o.payment_addr.cred === keyHash) continue;
          const hex = hexOf(o.payment_addr.bech32);
          if (hex && read(hex, "", address)?.known) candidates.set(`${t.tx_hash}#${o.tx_index}`, { index, tx: t.tx_hash });
        }
      }
    }
    type Read = KoiosUtxo & { is_spent?: boolean };
    // Asked of Koios together with the order outputs: what each of those transactions spent first at the contract.
    const spends = [...new Set([...paid.values()].flat().map((p) => p.input))];
    const asked = [...candidates.keys(), ...spends];
    const answered = (asked.length ? await koios.utxoInfo(asked) : []) as Read[];
    const rows = answered.filter((r) => candidates.has(outpoint(r)));
    // Koios knows every output a transaction it lists spent: one without a row is from a backend behind (C14).
    const spentRows = new Map(answered.filter((r) => !candidates.has(outpoint(r))).map((r) => [outpoint(r), r]));
    if (spends.some((o) => !spentRows.has(o))) throw new KoiosError(NOT_CAUGHT_UP(), "silent");
    // Anyone can pay the account, from their own Seedelf UTxOs too, and the session's ADA never pays for a stranger's
    // tokens (final review F4): only a transaction that spent a UTxO at the wallet contract under this phrase's
    // register is its own, since nothing but this phrase's key proves one of those spent.
    const mine = new Set(
      spends.length
        ? await wallet.withKeys((keys) => {
            pin(keys);
            const there = [...spentRows.values()].filter((r) => r.payment_cred === contract.walletContractHash);
            return ownedUtxos(wasm, keys, there).map(outpoint);
          })
        : [],
    );
    const byHash = [...new Set(rows.filter((r) => !r.inline_datum && r.datum_hash).map((r) => r.datum_hash!))];
    const datums = byHash.length ? await koios.datumInfo(byHash) : new Map<string, string>();
    const orders = new Map<string, string[]>();
    for (const r of rows) {
      const c = candidates.get(outpoint(r));
      const datum = r.inline_datum?.bytes ?? (r.datum_hash ? datums.get(r.datum_hash) : undefined);
      const hex = r.address ? hexOf(r.address) : undefined;
      if (!c || !datum || !hex) continue;
      const form = { inline: !!r.inline_datum, scriptRef: !!r.reference_script };
      if (read(hex, datum, accounts.get(c.index)!.address, form)?.ours) orders.set(c.tx, [...(orders.get(c.tx) ?? []), outpoint(r)]);
    }
    const at = now();
    const records = lost.flatMap((index) => {
      // Newest first: the funding is the oldest its key didn't sign (a swap can share its block, sorted by hash).
      const own = new Set((signed.get(index) ?? []).map((t) => t.tx_hash));
      const txs = txsOf.get(index)!;
      const funding = txs.filter((t) => !own.has(t.tx_hash)).at(-1) ?? txs.at(-1);
      if (!funding) return [];
      const swaps = (signed.get(index) ?? []).filter((t) => orders.has(t.tx_hash) && t !== funding).reverse();
      const record: SessionRecord = {
        index,
        ownStake: true,
        createdAt: funding.block_time * 1000,
        txs: [
          { kind: "out", txHash: funding.tx_hash, at: funding.block_time * 1000, confirmed: true },
          ...swaps.map((t) => ({
            kind: "swap" as const,
            txHash: t.tx_hash,
            at: t.block_time * 1000,
            confirmed: true,
            orders: orders.get(t.tx_hash)!,
          })),
        ],
        recovered: {
          at,
          own: [
            ...(signed.get(index) ?? []).map((t) => t.tx_hash),
            ...(paid.get(index) ?? []).filter((p) => mine.has(p.input)).map((p) => p.tx.tx_hash),
          ],
        },
      };
      return [record];
    });
    return { records, read: new Map(rows.map((r) => [outpoint(r), r])) };
  }

  /**
   * What a session's account holds now, fresh from Koios, less what this
   * wallet has spent, and less what a return's chain being sent will spend
   * (its change to come, its collateral): a site connected to it never
   * spends those from under the chain.
   */
  async accountUtxos(network: NetworkName, keyHash: string): Promise<KoiosUtxo[]> {
    const { wallet, session } = this.deps;
    const [rows, reserved] = await Promise.all([
      this.utxosOf(network, keyHash),
      wallet.withKeys(() => reservedSet(session, network, { sending: true })),
    ]);
    return rows.filter((u) => !reserved.inputs.has(outpoint(u)) && !reserved.collateral.has(outpoint(u)));
  }

  /**
   * Marks a funding or a top-up whose submit failed (`e`) as never sent, so
   * its session shows as failed at once, unless Koios didn't answer: then it
   * may be on its way, and it's looked for (tx_status, the account) before
   * it counts as failed.
   */
  private async markUnsent(network: NetworkName, index: number, txHash: string, e: unknown): Promise<void> {
    // A lock may come after Koios took it (pending.ts take, whose own withKeys refuses), and an unlock before
    // this reads the record: never marked unsent then, as one that went out would be. It's looked for instead,
    // and counts as failed only once the chain hasn't shown it in time (chunk 23's second review, fix round).
    if (maybeSent(e) || e instanceof WalletLocked) return;
    const why = unsentWhyOf(e);
    await this.update(network, index, (s) => {
      const t = s.txs.find((r) => r.txHash === txHash);
      if (!t) return;
      t.unsent = true;
      if (why) t.why = why;
    });
  }

  /**
   * A funding payment into `address` from the private balance (Make public's
   * builder), measured and ready for Send. It takes received money, or a box
   * back from Lovejoin that pays alone, first, and money another session
   * left last; session `index`'s own (a top-up's) first of all (privacy
   * review §2.3). `own`: the transactions whose outputs in the private
   * balance are the session's whatever their history says, which a restore
   * doesn't know (collateralTopUp, 1.5.0's release review, C36). `known`: the
   * protocol parameters, when its caller read them already.
   */
  private async buildFunding(
    network: NetworkName,
    index: number,
    address: string,
    payments: Array<{ to: string; lovelace: string; tokens: TokenQuantity[] }>,
    empty: string,
    own?: ReadonlySet<string>,
    known?: Record<string, unknown>,
    { inParts = true }: { inParts?: boolean } = {},
  ): Promise<Funding> {
    const { wasm } = this.deps;
    const { view, utxos, params, returning, waiting, classes: read } = await readContract(this.deps, network, known);
    if (!utxos.length) throw nothingToSpend(this.deps, view, empty, returning, waiting);
    const classes = own ? ownClassed(read, utxos, own, index) : read;
    type Finished = Omit<SessionOutSummary, "network" | "payments" | "inputs" | "index" | "address" | "histories" | "parts"> & {
      txCbor: string;
      seed: string;
      payments: Array<Paid & { to: string }>;
      inputs: OutRef[];
      classesMixed: string[];
    };
    const request = { network, params, utxos, payments, classes, funding: { session: sessionClass(index).id } };
    // In as many transactions as the UTxOs it spends need, each spending its own (the owner's test of 1.6.0: a token
    // spread over more UTxOs than one transaction spends, sold privately); the account's collateral in the first. A
    // top-up goes as one, as ever.
    const parts = await (inParts
      ? measureLocally<{ parts: Finished[] }>(this.deps, request, (keys, r) => wasm.buildWithdrawParts(keys.seedelf, r)).then(
          (built) => built.parts,
        )
      : measureLocally<Finished>(this.deps, request, (keys, r) => wasm.buildWithdraw(keys.seedelf, r)).then((one) => [one])
    ).catch((e: unknown) => {
      // Core's own words name the balance the screens call the private balance, and are English whatever the
      // language: said in the user's words (chunk 23's second review, LJ-6). Core's text is fixed, never translated.
      if (e instanceof Error && NOT_ENOUGH_PRIVATE.test(e.message)) throw new NotEnoughPrivate();
      throw e;
    });
    // A chained part's carry has the history of what the part before it spent (script-spend.ts `carried`).
    const seen = carried(classes, parts);
    const summaryOf = (finished: Finished): SessionOutSummary & { origin: HistoryClass } => {
      const { txCbor: _txCbor, seed: _seed, inputs, payments: paid, classesMixed, ...rest } = finished;
      const histories = spentHistories(seen, inputs, classesMixed);
      // Its change carries what paid for it, and is this session's from now on (activity.ts): selection still takes
      // it as the session's, and a later review counts the boxes in it (independent review L41).
      const origin = merged([changeHistory(seen, inputs), sessionClass(index)]);
      return {
        ...rest,
        network,
        index,
        address,
        payments: paid.map(({ to, ...p }) => ({ address: to, own: false, ...p })),
        inputs: inputs.length,
        ...(histories ? { histories } : {}),
        origin,
      };
    };
    const [first, ...rest] = parts;
    // The review's: the parts added up, the histories they tie between them, the account's collateral as the first
    // part pays it (payments after its first).
    const all = whole(parts, { classes: seen, utxos });
    const summary = summaryOf(parts.length > 1 ? { ...all, payments: [...all.payments, ...first!.payments.slice(1)] } : all);
    return {
      summary: parts.length > 1 ? { ...summary, parts: reviewParts(parts) } : summary,
      txCbor: first!.txCbor,
      seed: first!.seed,
      // Each later part kept with its own figures, for the Seedelf history once it's sent; the first's are the review's
      // when it's alone, its own otherwise (`firstOwn`).
      later: rest.map((p) => ({ ...summaryOf(p), txCbor: p.txCbor, seed: p.seed })),
      ...(parts.length > 1 ? { first: summaryOf(first!) } : {}),
    };
  }

  /**
   * Keeps a funding for Send under `key`: `kept`, its first part, with the session's own fields, and the parts after
   * it (keepParts), each under its own key. One part is kept as a funding always was.
   */
  private keepFunding(key: string, kept: Omit<Kept, "builtAt" | "account"> & object, later: FundingPart[]): Promise<void> {
    return keepParts(this.deps, key, [kept, ...later]);
  }

  /**
   * Records the session, then sends its funding payment. From here the swap
   * runs itself. `direct`: the approval's choice to bring it back without
   * Lovejoin, or (false) through it; Settings' when there's none. Kept with
   * it: what was approved stands (privacy review §4.1).
   */
  outSubmit(network: NetworkName, txHash: string, direct?: boolean): Promise<PendingTx> {
    return this.serial(async () => {
      const { wallet, session, now } = this.deps;
      const built = await wallet.withKeys(() => session.get<KeptOut>(SESSION_OUT));
      // What a new review fixes crosses as a stale review: the page offers to build it again, on the next unused
      // account, rather than a Send that can't go (chunk 23's second review, DX-1), and so does an account another
      // funding took meanwhile. "Started already" doesn't: that try may have gone out, and the page reads the
      // record to tell. It's asked first (`refuseStarted`).
      const book = await this.book(network);
      refuseStarted(book, txHash, built, network, "sess.alreadyStarted");
      if (!built || built.txHash !== txHash || built.network !== network) {
        throw new StaleReviewError(t("sess.outNotReady"));
      }
      if (now() - built.builtAt > BUILT_TTL_MS) {
        throw new StaleReviewError(t("sess.outTooOld"));
      }
      await this.stillUnused(network, built.index);
      // Where Lovejoin is, how it comes back is kept with it: through it, as deep and as long as approved.
      const back: Pick<AutoRecord, "direct" | "lovejoin"> = {};
      if (this.deps.lovejoin?.available(network)) {
        back.direct = direct ?? !(await this.throughLovejoin());
        if (!back.direct && built.lovejoin) back.lovejoin = built.lovejoin;
      }
      // Recorded before it's sent: whatever happens next, this index is never used again.
      const record: SessionRecord = {
        index: built.index,
        ownStake: true,
        createdAt: now(),
        ...(await this.fundingRecords(network, built.index, SESSION_OUT, built)),
        swap: built.swap,
        auto: { approved: built.approved, ...back },
        ...(built.tailReserved ? { collateralReserve: true as const } : {}),
      };
      await this.save(network, { ...book, next: built.index + 1, sessions: [...book.sessions, record] });
      const pending = await this.sendFunding(network, record, SESSION_OUT, "payment");
      await this.deps.alarm?.start();
      return pending;
    });
  }

  /** Has Minswap build the session's swap, freshly quoted, and reads it against the session's key. */
  async swapBuild(network: NetworkName, index: number): Promise<SessionTxReview> {
    const s = await this.live(network, index);
    if (!s.swap) throw new Error(t("sess.notSwap"));
    // A copy sent is the swap, unless it was given up and what it spends was freed (`inputs`, `held`): then one is
    // built again past it, by the user as by the runner (act), from the same funding, so the ledger lets only one of
    // the two land. One whose inputs still count as spent stays the swap (cross-area review X04).
    const sent = s.txs.filter((t) => t.kind === "swap" && !t.unsent);
    if (sent.some((t) => !t.replaced || !(t.inputs ?? t.held))) throw new Error(t("sess.swapSent"));
    const { address, keyHash } = (await this.accounts(network, [s])).get(index)!;
    const { listed, rows } = await this.listing(network, keyHash);
    if (!rows.length) throw new Error(t("sess.accountEmptyYet"));
    // Nor once a copy given up may have landed, as the runner looks before it builds one again: the chain shows it,
    // Koios knows an order of it, spent or not (placed), or lists its own output at the account.
    if (sent.length) {
      const ids = new Set(sent.map((x) => x.txHash));
      const statuses = await this.deps.koios(network).txStatus([...ids]);
      const landed =
        [...ids].some((h) => statuses.get(h) != null) ||
        listed.some((u) => ids.has(u.tx_hash)) ||
        (await this.placed(network, s, sent)).length > 0;
      if (landed) throw new Error(t("sess.swapSent"));
    }
    const minswap = this.deps.minswap(network);
    const ask = checkAsk(s.swap);
    const { est, avoid } = await routeOf(minswap, ask);
    // Its route now, as the runner's order checks it (independent review M17, release review C34).
    const unchecked = uncheckedProtocols(network, est);
    if (unchecked.length) {
      throw new Error(t("sess.nowRoutesThrough", { protocols: unchecked.join(t("histories.list.and")) }));
    }
    const legged = outOfPlace(est);
    if (legged.length) {
      throw new Error(t("sess.nowRoutesOutOfPlace", { protocols: legged.join(t("histories.list.and")) }));
    }
    const txCbor = await minswap.buildTx(address, est.min_amount_out, ask, avoid);
    return this.review(network, s, "swap", txCbor, rows, { quote: quoteOf(network, ask, est) });
  }

  /** The session's orders that aren't filled yet, read from chain (`liveOrders`). */
  async orders(network: NetworkName, index: number): Promise<SessionOrder[]> {
    const s = (await this.book(network)).sessions.find((r) => r.index === index);
    if (!s) throw new Error(t("sess.noSuchSession"));
    const { address } = (await this.accounts(network, [s])).get(index)!;
    const orders = await this.liveOrders(network, s, address);
    const protocol = (o: KoiosUtxo) => {
      try {
        return dexOrder(this.deps.wasm, network, o, address).protocol ?? "";
      } catch (e) {
        if (isTrap(e)) throw e;
        return "";
      }
    };
    return orders.map((o) => ({ protocol: protocol(o), txIn: outpoint(o), createdAt: (o.block_time ?? 0) * 1000 }));
  }

  /**
   * Builds the wallet's own cancel of the session's open orders (chunk 24, Step 3), and reads it: one it can't
   * build or won't sign is said as its own (Refused `of` a cancel), never as what Minswap built (release review C19).
   */
  async cancelBuild(network: NetworkName, index: number): Promise<SessionTxReview> {
    const s = await this.live(network, index);
    const { address, keyHash } = (await this.accounts(network, [s])).get(index)!;
    const orders = await this.liveOrders(network, s, address);
    if (!orders.length) throw new Error(t("sess.noOrderWaiting"));
    const rows = await this.utxosOf(network, keyHash);
    const { txCbor, covers } = await this.cancelOf(network, address, rows, orders);
    return this.review(network, s, "cancel", txCbor, rows, { orders: covers.length });
  }

  /** Signs the swap or cancel reviewed last with the session's key, puts the signature in, and submits it. */
  txSubmit(network: NetworkName, txHash: string, kind: "swap" | "cancel"): Promise<PendingTx> {
    return this.serial(async () => {
      const { wallet, session, now } = this.deps;
      const built = await wallet.withKeys(() => session.get<KeptTx>(SESSION_TX));
      if (!built || built.txHash !== txHash || built.network !== network || built.kind !== kind) {
        throw new Error(t(kind === "swap" ? "sess.swap.notReady" : "sess.cancel.notReady"));
      }
      if (now() - built.builtAt > BUILT_TTL_MS) {
        throw new Error(t(kind === "swap" ? "sess.swap.tooOld" : "sess.cancel.tooOld"));
      }
      return this.signAndSend(network, built);
    });
  }

  /** Builds and signs the return of everything at the session's account into the private balance. */
  backBuild(network: NetworkName, index: number, direct = false, pools?: Record<string, string | null>): Promise<SessionBackSummary> {
    // In turn with the sends and the runner: it may mark the session's record, and
    // a save it overlapped would be lost.
    return this.serial(() => this.backBuildNow(network, index, direct, pools));
  }

  private async backBuildNow(
    network: NetworkName,
    index: number,
    direct: boolean,
    pools?: Record<string, string | null>,
  ): Promise<SessionBackSummary> {
    const { wallet, session } = this.deps;
    const s = await this.live(network, index);
    const { address, keyHash } = (await this.accounts(network, [s])).get(index)!;
    // Money that arrives after the return would need another one.
    if (s.txs.some((t) => t.kind === "swap") && (await this.liveOrders(network, s, address, true)).length) {
      throw new Error(t("sess.orderWaitingBack"));
    }
    const rows = await this.utxosOf(network, keyHash);
    if (!rows.length) throw new Error(t("sess.accountEmptyBack"));
    const built = await this.buildBack(network, index, rows, undefined, direct, pools);
    await wallet.withKeys(() => session.set(SESSION_BACK, built));
    const { txCbor: _txCbor, builtAt: _builtAt, chain: _chain, leaves: _leaves, tailOf: _tailOf, ...summary } = built;
    return summary;
  }

  /** Sends the return built last. */
  backSubmit(network: NetworkName, txHash: string): Promise<PendingTx> {
    return this.serial(async () => {
      const { wallet, session, now } = this.deps;
      const built = await wallet.withKeys(() => session.get<KeptBack>(SESSION_BACK));
      if (!built || built.txHash !== txHash || built.network !== network) {
        throw new Error(t("sess.backNotReady"));
      }
      if (now() - built.builtAt > BUILT_TTL_MS) throw new Error(t("sess.backTooOld"));
      return this.sendBack(network, built);
    });
  }

  /**
   * Bring everything back: a return for each of `indexes` that holds
   * something and has nothing on its way, each its own transaction signed by
   * its own key, never one spending several sessions' UTxOs together: that
   * would show on chain that they share an owner. A swap that runs itself
   * comes back by itself, so it's left out. Kept for Send.
   */
  claimBuild(
    network: NetworkName,
    indexes: number[],
    direct = false,
  ): Promise<{ returns: SessionBackSummary[]; skipped: Array<{ index: number; reason: string }> }> {
    // In turn, as backBuild.
    return this.serial(() => this.claimBuildNow(network, indexes, direct));
  }

  private async claimBuildNow(
    network: NetworkName,
    indexes: number[],
    direct: boolean,
  ): Promise<{ returns: SessionBackSummary[]; skipped: Array<{ index: number; reason: string }> }> {
    const { wallet, session } = this.deps;
    const params = await this.deps.koios(network).epochParams();
    const returns: KeptBack[] = [];
    const skipped: Array<{ index: number; reason: string }> = [];
    for (const index of [...new Set(indexes)]) {
      try {
        const s = await this.live(network, index);
        if (s.auto) throw new Error(t(s.mix ? "sess.mixComesBack" : "sess.autoComesBack"));
        const { address, keyHash } = (await this.accounts(network, [s])).get(index)!;
        if (s.txs.some((t) => t.kind === "swap") && (await this.liveOrders(network, s, address, true)).length) {
          throw new Error(t("sess.orderWaiting"));
        }
        const rows = await this.utxosOf(network, keyHash);
        if (!rows.length) throw new Error(t("sess.holdsNothing"));
        returns.push(await this.buildBack(network, index, rows, params, direct));
      } catch (e) {
        // WebAssembly that trapped outside the wallet's queue (a chain's cross-check) is broken for good: no other
        // session is built on it, and the request locks the wallet as it's answered (sw.ts answerUi), as Send's
        // return does. Listed as left out, it would show the trap's raw word, and nothing would lock.
        if (isTrap(e)) throw e;
        skipped.push({ index, reason: (e as Error).message });
      }
    }
    await wallet.withKeys(() => session.set(SESSION_CLAIM, returns));
    return {
      returns: returns.map(({ txCbor: _txCbor, builtAt: _builtAt, chain: _chain, leaves: _leaves, tailOf: _tailOf, ...summary }) => summary),
      skipped,
    };
  }

  /** Sends the returns Bring everything back built, those chosen, one after another. One that fails doesn't stop the rest. */
  claimSubmit(
    network: NetworkName,
    txHashes: string[],
  ): Promise<{ sent: Array<{ index: number; txHash: string }>; failed: Array<{ index: number; error: string }> }> {
    return this.serial(async () => {
      const { wallet, session, now } = this.deps;
      const kept = (await wallet.withKeys(() => session.get<KeptBack[]>(SESSION_CLAIM))) ?? [];
      const chosen = txHashes.map((h) => kept.find((k) => k.txHash === h && k.network === network));
      if (!chosen.length || chosen.some((c) => !c)) throw new Error(t("sess.claimNotReady"));
      if (chosen.some((c) => now() - c!.builtAt > BUILT_TTL_MS)) {
        throw new Error(t("sess.claimTooOld"));
      }
      const sent: Array<{ index: number; txHash: string }> = [];
      const failed: Array<{ index: number; error: string }> = [];
      for (const built of chosen as KeptBack[]) {
        try {
          await this.sendBack(network, built, SESSION_CLAIM);
          sent.push({ index: built.index, txHash: built.txHash });
        } catch (e) {
          failed.push({ index: built.index, error: (e as Error).message });
        }
      }
      await wallet.withKeys(() => session.remove(SESSION_CLAIM));
      return { sent, failed };
    });
  }

  // -------------------------------------------------------------------------
  // The runner

  /** The session's next step, if it's time (`now`: whatever the last reading), and how it is after. */
  advance(network: NetworkName, index: number, now = false): Promise<SessionView> {
    return this.serial(async () => {
      await this.step(network, index, now ? "asked" : "run");
      return this.one(network, index);
    });
  }

  /**
   * Stop, the user's alone: an order that waits is cancelled, then
   * everything comes back. `direct`: not through Lovejoin, whatever was
   * approved (privacy review §4.1). `ordered`: an order had gone out (or
   * may have) when it took effect. Stop waits for a step already under way,
   * so an order the runner was placing as the user pressed it goes first,
   * whatever the page showed (independent review L22). `orderedPools`: the
   * latest swap it counts went against a DEX's pools, one given up too,
   * which the page doesn't show, so its words don't call it an order the
   * wallet cancels (cross-area review X04).
   */
  stop(network: NetworkName, index: number, direct = false): Promise<SessionView & { ordered?: boolean; orderedPools?: boolean }> {
    return this.serial(async () => {
      const sent = (await this.automatic(network, index)).txs.filter((t) => t.kind === "swap" && !t.unsent);
      const ordered = sent.length > 0;
      const orderedPools = !!sent.at(-1)?.againstPools;
      await this.update(network, index, (s) => {
        s.auto!.stopping ??= this.deps.now();
        if (direct) s.auto!.direct = true;
        delete s.auto!.paused;
        delete s.auto!.retry;
        // A funding in parts found never funded, part of which landed since: what came is brought back.
        if (s.auto!.failed && s.parts && fundingState(s).state === "short") delete s.auto!.failed;
      });
      await this.deps.alarm?.start();
      await this.step(network, index, "asked");
      return { ...(await this.one(network, index)), ordered, ...(orderedPools ? { orderedPools } : {}) };
    });
  }

  /**
   * What Stop brings back through Lovejoin, for its dialog (privacy review
   * §2.8): the boxes the ADA at the session's account pays for, as its last
   * reading found it, and until its order fills, its funding's ADA too (a
   * cancel or a refund brings that back), all as Lovejoin's pool has room
   * for now (a read kept five minutes). Null when it comes back directly:
   * approved that way, or where Lovejoin isn't.
   */
  async stopCost(network: NetworkName, index: number): Promise<SwapLovejoin | null> {
    const s = await this.automatic(network, index);
    if (s.mix || !this.deps.lovejoin?.available(network) || !(await this.throughLovejoin(s))) return null;
    const rows = this.seen.get(`${network}:${index}`);
    const held = rows ? spareOf(returnable(s, rows)) : 0n;
    // Its token's boxes' ADA too, funded beside the swap's, which comes back with it (its fixes' review, 5).
    const funded = s.auto!.filled
      ? 0n
      : (s.swap?.tokenIn === "lovelace" ? BigInt(s.auto!.approved.fund.lovelace) : 0n) + BigInt(s.auto!.lovejoin?.fund ?? "0");
    // As deep and as long as the swap was approved (independent review L21), and as wide: three for a swap from
    // before approvals kept a way, as its return goes (wayOf).
    const { price, skipped, depth, delay } = await this.priced(network, true, s.auto!.lovejoin, s.auto!.lovejoin ? undefined : 3);
    return { ...price(held > funded ? held : funded), depth, delay, on: true, ...(skipped ? { skipped } : {}) };
  }

  /**
   * Goes on after a pause or a failure: the step is tried again now. A
   * funding found failed is looked for again, and goes on if it's there.
   */
  resume(network: NetworkName, index: number): Promise<SessionView> {
    return this.serial(async () => {
      await this.automatic(network, index);
      await this.update(network, index, (s) => {
        delete s.auto!.paused;
        delete s.auto!.retry;
        delete s.auto!.failed;
      });
      await this.deps.alarm?.start();
      await this.step(network, index, "asked");
      return this.one(network, index);
    });
  }

  /**
   * Every running swap's next step, and more of every return's chain still
   * being sent (a site's session, a hand-run swap), for the alarm and for
   * unlocking (`unlock`: a step found then waits, see `waits`). Returns
   * whether something still runs on `network`. It never stops the alarm: the
   * worker runs every network in turn, and decides once after all of them
   * (runs.ts), so one network's quiet never stops another's work, or a swap
   * sent while the others ran.
   */
  async runAll(network: NetworkName, unlock = false): Promise<boolean> {
    const book = await this.book(network);
    // A chain a lock or a closed browser cut says so now, not only once it's brought back.
    await this.serial(() => this.markCut(network)).catch(() => undefined);
    const run: Run = unlock ? "unlock" : "run";
    for (const s of book.sessions.filter(running)) await this.serial(() => this.step(network, s.index, run)).catch(() => undefined);
    for (const s of book.sessions.filter((r) => !running(r) && !r.closedAt)) {
      if (await this.pendingChain(network, s.index)) await this.serial(() => this.pump(network, s.index)).catch(() => undefined);
    }
    // A return whose history isn't written yet, of a session nothing steps (a site's, a hand-run swap, a paused
    // one): looked for, and written once on chain, as act does for a running one (independent review M7). And a
    // funding or a top-up of one that doesn't run itself (a site's), which nothing else looks for when no page
    // is open: marked once it lands, so no read behind it takes it for one never sent (final review F13).
    const at = this.deps.now();
    const waits = (r: SessionRecord) => r.txs.some((t) => t.summary || (!r.auto && awaitsLanding(t, at)));
    for (const s of book.sessions.filter((r) => !running(r) && !r.closedAt && waits(r))) {
      await this.serial(() => this.settleReturns(network, s.index)).catch(() => undefined);
    }
    const now = this.deps.now();
    const after = await this.book(network);
    const looked = (r: SessionRecord, t: RecordedTx) => awaitsHistory(t, now) || (!r.auto && awaitsLanding(t, now));
    let still = after.sessions.some((r) => running(r) || (!r.closedAt && r.txs.some((t) => looked(r, t))));
    for (const s of book.sessions.filter((r) => !r.closedAt)) still ||= !!(await this.pendingChain(network, s.index));
    return still;
  }

  /**
   * Session `index`'s returns whose history isn't written yet, when nothing
   * steps it: looked for on chain (settled) while they may still land, and
   * written once there (noteLanded), so a balance reading doesn't note what
   * came back as money received (independent review M7). A site's funding
   * or top-up too, while it may still land: marked once on chain, so a read
   * behind it never ends the session over its money (final review F13).
   * Reads only.
   */
  private async settleReturns(network: NetworkName, index: number): Promise<void> {
    const { wallet, session, now } = this.deps;
    let s = (await this.book(network)).sessions.find((r) => r.index === index);
    if (!s || s.closedAt || running(s)) return;
    let returned = false;
    const auto = !!s.auto;
    if (s.txs.some((t) => awaitsHistory(t, now()) || (!auto && awaitsLanding(t, now())))) {
      const waiting = s.txs.filter((t) => !t.confirmed && !t.unsent);
      const statuses = await this.landed(network, waiting);
      const on = new Set(waiting.filter((t) => statuses.get(t.txHash) != null).map((t) => t.txHash));
      if (on.size) {
        returned = waiting.some((t) => t.kind === "back" && on.has(t.txHash));
        s = await this.update(network, index, (r) => void settle(r, on));
      }
    }
    await this.noteLanded(network, s);
    // The private balance has new UTxOs: the next reading reads its side
    // again, and leaves the account's as it was (independent review M8).
    if (returned) await wallet.withKeys(() => session.set(SESSION_PRIVATE_STALE_PREFIX + network, true));
  }

  /**
   * Marks each open session's chain that nothing is sending anymore (its
   * progress was wiped), whose return wasn't sent, as stopped (CHAIN_CUT):
   * one that went in partly, and one none of which went, cut between its
   * record and its first send by a lock or a closed browser, which kept
   * sendChain from saying so. Unmarked, that one would read as on its way for
   * good, and a session brought back by hand would offer no return
   * (cross-area review X03). Its record stays: only the latest chain's
   * transactions count (chainSoFar), and with it gone an earlier chain's
   * would read as one that went in partly. It runs in the queue, as every
   * send of a chain does, so never between a chain's record and its progress
   * saved.
   */
  private async markCut(network: NetworkName): Promise<void> {
    for (const s of (await this.book(network)).sessions) {
      const chain = s.chain;
      if (s.closedAt || !chain || chain.stopped) continue;
      const sent = new Set(s.txs.filter((t) => !t.unsent).map((t) => t.txHash));
      if (sent.has(chain.last) || (await this.pendingChain(network, s.index))) continue;
      await this.update(network, s.index, (r) => {
        r.chain!.stopped = CHAIN_CUT();
      });
    }
  }

  /** Takes the session's next step, if it's time. A failure waits and tries again; a failed check pauses. */
  private async step(network: NetworkName, index: number, run: Run): Promise<void> {
    const at = this.deps.now();
    const s = (await this.book(network)).sessions.find((r) => r.index === index);
    if (!s || !running(s)) return;
    const key = `${network}:${index}`;
    if (run !== "asked" && ((s.auto!.retry && at < s.auto!.retry.at) || at - (this.readAt.get(key) ?? 0) < READ_EVERY_MS)) return;
    this.readAt.set(key, at);
    try {
      await this.act(network, s, run);
      if (s.auto!.retry) {
        await this.update(network, index, (r) => {
          delete r.auto!.retry;
        });
      }
    } catch (e) {
      // WebAssembly that trapped outside the wallet's queue (a chain's cross-check) is broken for good: lock, as a
      // page's request does (sw.ts answerUi), rather than try again on it every 30 s with the wallet open and the
      // trap's raw word for the reason. Before the record is touched, which a locked wallet can't write; the next
      // unlock's run takes the step afresh, on a new instance. A page that asked for the step hears why.
      if (isTrap(e)) {
        await this.deps.wallet.trapped();
        throw new WalletLocked(WASM_BROKEN());
      }
      await this.update(network, index, (r) => {
        const auto = r.auto!;
        if (e instanceof PriceMoved) {
          auto.paused = { at, why: "price", amountOut: e.amountOut };
          delete auto.retry;
        } else if (e instanceof Refused) {
          auto.paused = { at, why: "refused", detail: e.detail };
          delete auto.retry;
        } else {
          const tries = (auto.retry?.tries ?? 0) + 1;
          const error = e instanceof Error ? e.message : String(e);
          const cbor = e instanceof MinswapError ? e.cbor : undefined;
          auto.retry = { at: at + retryAfterMs(tries), error, reason: retryReasonOf(e), tries, ...(cbor ? { cbor } : {}) };
        }
      });
    }
  }

  /**
   * Whatever comes next for a swap that runs itself, from its record and the
   * chain. What it sends waits, as the wallet unlocks (waits); what it reads
   * doesn't.
   */
  private async act(network: NetworkName, record: SessionRecord, run: Run): Promise<void> {
    const { wallet, session, now } = this.deps;
    // A return's chain still being sent: more of it, and nothing else meanwhile.
    if (await this.pendingChain(network, record.index)) return this.pump(network, record.index);
    let s = record;
    // What was sent and isn't on chain yet: wait for it.
    const waiting = s.txs.filter((t) => !t.confirmed);
    if (waiting.length) {
      const statuses = await this.landed(network, waiting);
      const on = new Set(waiting.filter((t) => statuses.get(t.txHash) != null).map((t) => t.txHash));
      // A swap's copy tx_status doesn't show, whose order is on chain, landed all the same: looked for
      // before it's taken for one never placed, and while it's still looked for. Never a second order,
      // or a return that leaves its order at the DEX (independent review L15).
      const unseen = waiting.filter((t) => t.kind === "swap" && !t.unsent && !on.has(t.txHash) && (t.replaced || lost(t, now())));
      for (const h of await this.placed(network, s, unseen)) on.add(h);
      // Never taken, or never seen: its step is built again. It spends the session's
      // UTxOs, so the ledger lets only one of the two land, and one Koios may have
      // taken is still looked for (replaced).
      const gone = new Set(
        waiting.filter((t) => t.kind !== "out" && !t.replaced && !on.has(t.txHash) && lost(t, now())).map((t) => t.txHash),
      );
      const stale = waiting.filter((t) => t.replaced && !on.has(t.txHash) && now() - t.at >= REPLACED_WATCH_MS);
      // A funding may have reached the chain though Koios didn't answer, or tx_status doesn't know it yet:
      // what it paid the account is looked for before it counts as failed. Each part of one in parts too: one
      // that didn't land in time is missed, and a funding that's short of one isn't funded (the owner's call,
      // 2026-10-21). One that waits for the part before it isn't sent yet, so isn't late (stillWaiting).
      const held = await this.stillWaiting(network, s);
      const late = fundingOf(s).filter(
        (t) =>
          !t.confirmed &&
          !t.missed &&
          !on.has(t.txHash) &&
          !held.has(t.txHash) &&
          now() - t.at > (t.unsent ? RESEND_AFTER_MS : FAILED_AFTER_MS),
      );
      const missed = new Set<string>();
      if (late.length) {
        const { keyHash } = (await this.accounts(network, [s])).get(s.index)!;
        const there = new Set((await this.utxosOf(network, keyHash)).map((u) => u.tx_hash));
        for (const t of late) (there.has(t.txHash) ? on : missed).add(t.txHash);
      }
      const neverFunded = !s.parts && missed.size > 0;
      if (on.size || gone.size || stale.length || missed.size) {
        let freed: string[] = [];
        s = await this.update(network, s.index, (r) => {
          settle(r, on);
          // What the copies going unseen now spent, as far as Koios didn't answer them, or took a cancel or a
          // swap against the pools (`held`, release review C03): exactly these, now, before their step is built
          // again (and its copy counts them as spent again), never later.
          freed = r.txs.filter((t) => gone.has(t.txHash)).flatMap((t) => t.inputs ?? t.held ?? []);
          r.txs = r.txs.filter(
            (t) => !stale.some((x) => x.txHash === t.txHash) && !(gone.has(t.txHash) && (t.unsent || !REBUILT.has(t.kind))),
          );
          for (const t of r.txs) {
            if (!gone.has(t.txHash)) continue;
            t.replaced = true;
            delete t.sending;
          }
          if (neverFunded) r.auto!.failed = now();
          else if (missed.size) {
            for (const t of fundingOf(r)) if (missed.has(t.txHash)) t.missed = true;
            short(r, now());
          }
        });
        // Free again: the step built again spends them, or a return takes them, and the ledger lets only one
        // of it and the unseen copy land (final review sessions-1).
        if (freed.length) await wallet.withKeys(() => forgetSpent(session, freed));
        if (waiting.some((t) => t.kind === "back" && on.has(t.txHash))) {
          // The private balance has new UTxOs: the next reading reads its side again, not the account's
          // (independent review M8).
          await wallet.withKeys(() => session.set(SESSION_PRIVATE_STALE_PREFIX + network, true));
        }
      }
    }
    // A return Koios didn't answer, on chain now: its history (independent review M7).
    s = await this.noteLanded(network, s);
    if (s.txs.some((t) => !t.confirmed && !t.replaced && !t.missed)) return;
    // A funding short of a part is paused for the user, unless they stopped it: what came is brought back, never
    // swapped or mixed. A Try again finds it short again, and one none of whose parts landed failed again: nothing
    // would come of running on.
    const funding = s.parts ? fundingState(s).state : undefined;
    if (funding === "never" || (!s.auto?.stopping && funding === "short")) {
      s = await this.update(network, s.index, (r) => short(r, now()));
      return;
    }

    const { address, keyHash } = (await this.accounts(network, [s])).get(s.index)!;
    const { listed, rows } = await this.listing(network, keyHash);
    this.seen.set(`${network}:${s.index}`, rows);
    // A swap copy whose own output (its change) Koios lists at the account is on chain, whatever tx_status and
    // utxo_info say yet: it's the step, never one to build again or to bring back before its order is done.
    // This is the listing an order or a return is built on, so the two can't disagree (independent review L15).
    const shown = new Set(
      s.txs.filter((t) => t.kind === "swap" && !t.confirmed && listed.some((u) => u.tx_hash === t.txHash)).map((t) => t.txHash),
    );
    if (shown.size) {
      s = await this.update(network, s.index, (r) => {
        settle(r, shown);
      });
    }
    // A copy that went unseen isn't a step taken: its step is taken again.
    const taken = s.txs.filter((t) => !t.replaced);
    const kinds = new Set(taken.map((t) => t.kind));
    // What no return takes stays, and holds nothing open.
    const active = returnable(s, rows);
    // Brought back, and nothing has arrived since: it's over. The account as
    // Koios lists it, what this wallet spent included: a step that never
    // lands leaves its inputs there. And not while a copy of a step built
    // again may still land (final review sessions-1, sessions-2), nor before
    // Koios shows its funding spent: a backend behind it reads the account
    // empty too (independent review M4). The next run looks again.
    if (taken.at(-1)!.kind === "back" && !returnable(s, listed).length && !mayStillLand(s, now())) {
      if (!ownGone(s, await this.spentStates(network, ownOuts(s)), new Set(listed.map(outpoint)), now())) return;
      // Nor while an order of its swap may still pay the account (independent review L15, D2).
      if (await this.ordersOpen(network, s, address, true)) return;
      await this.update(network, s.index, (r) => {
        r.closedAt = now();
      });
      return;
    }
    // Koios doesn't list what's there yet.
    if (!active.length) return;
    // What it sends waits, as the wallet unlocks; what it reads doesn't.
    const go = async (send: () => Promise<void>) => {
      if (!(await this.waits(network, s, run))) await send();
    };
    // A mix: once funded, its boxes go through Lovejoin and the rest comes back, one chain.
    // Stopped, it comes back directly: the way out of a mix whose chain can't go.
    if (s.mix) return go(() => this.bringBack(network, s.index, rows, !!s.auto?.stopping));
    // A return through Lovejoin that stopped partway (a transaction Koios
    // never took, a closed browser): what's at the account now came from the
    // chain itself, so nothing "arrives" from outside. What's left comes back
    // (directly: its deposit is in).
    if (kinds.has("deposit") || kinds.has("mix")) return go(() => this.bringBack(network, s.index, rows));
    const auto = s.auto!;
    // The latest step paid the account in itself (a swap against the pools its proceeds, a cancel its orders'
    // funds), and Koios doesn't list that yet: the listing is behind the chain. A return now would take the 5 ₳
    // collateral alone, and the rest would come back later without it, so never through Lovejoin: none goes
    // until it's listed (release review C12), for as long as a step is looked for (LOST_AFTER_MS), since one a
    // fork dropped never shows.
    const last = taken.at(-1)!;
    const unlisted =
      (last.kind === "cancel" || (last.kind === "swap" && !!last.againstPools)) &&
      !listed.some((u) => u.tx_hash === last.txHash) &&
      now() - last.at < LOST_AFTER_MS;
    // No order yet: place it, unless the user stopped, or brought the session back by hand.
    if (!kinds.has("swap")) {
      // A swap that went unseen may have landed after all: never a second order, or a return, while one of its
      // orders is open. After Stop, it's cancelled first, as one the runner saw land is (final review sessions-2).
      if (s.txs.some((t) => t.kind === "swap")) {
        const orders = await this.liveOrders(network, s, address, true);
        if (orders.length) return auto.stopping ? go(() => this.cancel(network, s, address, rows, orders)) : undefined;
      }
      if (auto.stopping || kinds.has("back")) return unlisted ? undefined : go(() => this.bringBack(network, s.index, rows));
      return go(() => this.order(network, s, address, rows));
    }

    // Its orders still open, from chain: Minswap's list doesn't hold every order (chunk 24, Step 3).
    const orders = await this.liveOrders(network, s, address, true);
    if (orders.length) {
      s = await this.noteOrderOpen(network, s, false);
      // Waiting for a batcher to fill it, unless the user stopped it: then the wallet cancels it itself.
      if (auto.stopping) await go(() => this.cancel(network, s, address, rows, orders));
      return;
    }
    // A direct swap paid its proceeds in itself (chunk 24): landed, it's the fill, with no order to wait on, once
    // Koios lists them.
    if (!kinds.has("cancel") && s.txs.some((t) => t.kind === "swap" && t.confirmed && !t.replaced && t.againstPools)) {
      if (unlisted) return;
      if (!auto.filled) {
        s = await this.update(network, s.index, (r) => {
          r.auto!.filled = now();
        });
      }
      s = await this.noteOrderOpen(network, s, false);
      return go(() => this.bringBack(network, s.index, rows));
    }
    // No order of the swap is open on chain (liveOrders). A fill or a refund spends it, and comes
    // in a transaction the session didn't make; a cancel's refund in its own.
    if (!kinds.has("cancel")) {
      const own = new Set(s.txs.map((t) => t.txHash));
      const arrived = active.filter((r) => !own.has(r.tx_hash));
      // Nothing's here yet: one of them is behind. Unless the outcome is known and a return is in: then what's
      // left is the session's own that the return didn't take (the swap's change, counted spent then by a cancel
      // given up), and it comes back too, rather than hold the session open for good (release review C03).
      if (!arrived.length && !(kinds.has("back") && (auto.filled || auto.refunded))) return;
      // Anyone can pay the account, and Koios may not show a new order yet: what
      // arrived is the fill only once the order itself is spent. Stopped, one Koios
      // can't find yet can't be cancelled yet: the page says what it waits on (independent review L16).
      if (!(await this.ordersSpent(network, s))) {
        if (auto.stopping) await this.noteOrderOpen(network, s, true);
        return;
      }
      if (!auto.filled && !auto.refunded) {
        // A fill or a refund, told apart by what arrived (independent review M18), read again now that every
        // order is known spent: a split route's legs are paid in different blocks, and one may have come since
        // the reading above. What either reading holds counts.
        const since = returnable(s, (await this.listing(network, keyHash)).rows).filter(
          (r) => !own.has(r.tx_hash) && !arrived.some((a) => outpoint(a) === outpoint(r)),
        );
        const outcome = outcomeOf(s, [...arrived, ...since]);
        // What arrived is the fill or the refund: its token may go into the pool approved for it (chunk 34's 34e).
        const fills = fillsOf(s, [...arrived, ...since]);
        await this.update(network, s.index, (r) => {
          if (outcome === "refunded") r.auto!.refunded = now();
          else r.auto!.filled = now();
          if (outcome === "partly") r.auto!.partly = true;
          if (fills.length) r.auto!.fills = fills;
        });
      }
    } else if (!(await this.ordersSpent(network, s))) {
      // Cancelled: every order of the swap is spent too, as a fill's are. One Koios can't find yet isn't
      // cancelled, and still pays the account; meanwhile what's there stays, so a cancel of it can still
      // be paid for once Koios finds it (independent review L16). The page says so plainly.
      await this.noteOrderOpen(network, s, true);
      return;
    }
    // Every order of the swap is spent: nothing is open any more. After a cancel, it all comes back once Koios
    // lists what the cancel paid.
    s = await this.noteOrderOpen(network, s, false);
    if (unlisted) return;
    await go(() => this.bringBack(network, s.index, rows));
  }

  /**
   * Records that the stopped swap waits on an order Koios can't find yet
   * (`open`), from the first time the runner finds it so, or that it no
   * longer does. It writes only when that changes, and nothing but the page
   * reads it (independent review L16).
   */
  private async noteOrderOpen(network: NetworkName, s: SessionRecord, open: boolean): Promise<SessionRecord> {
    if ((s.auto?.orderOpen !== undefined) === open) return s;
    return this.update(network, s.index, (r) => {
      if (open) r.auto!.orderOpen ??= this.deps.now();
      else delete r.auto!.orderOpen;
    });
  }

  /**
   * Whether a step about to be sent waits (privacy review §3.1): nothing
   * goes out the moment the wallet unlocks, when the user is about to act,
   * and a site connected to the account sees it. Found then, it waits a
   * fresh draw inside the stretch the unlock keeps the wallet open
   * (lovejoin.ts unlockWait), and the alarm takes it after. One drawn at an
   * unlock before, whose wallet locked before it went, isn't drawn again:
   * it goes at the next run. The user's own ask (Refresh, Stop, Try now)
   * goes at once.
   *
   * Found by the unlock's run, or by any run or page before this unlock drew
   * its wait, while the stretch an unlock's wait can reach isn't over: the
   * unlock's run may not have got to it first (a read that failed, a retry
   * still waiting, a page opened first, or a run under way across a lock),
   * and correctness doesn't hang on it (independent review L10, L11, L12).
   * A session started since the unlock was the user's own doing, and isn't
   * held back; nor is one the user asked of since, which takes the unlock's
   * draw with it: its next step goes when it comes.
   */
  private async waits(network: NetworkName, s: SessionRecord, run: Run): Promise<boolean> {
    const until = s.auto?.unlockWait;
    const unlocked = await this.deps.wallet.unlockedAt();
    if (run !== "asked") {
      const now = this.deps.now();
      const found = run === "unlock" || (s.createdAt < unlocked && now - unlocked < UNLOCK_WAIT_MS[1]);
      if (found && s.auto?.unlockDrawn !== unlocked) {
        const lockAfter = (await this.deps.preferences?.lockAfterMs()) ?? DEFAULT_PREFERENCES.lockAfterMinutes * 60_000;
        const at = until ?? now + unlockWait(lockAfter, this.deps.random ?? secureRandom);
        await this.update(network, s.index, (r) => {
          r.auto!.unlockWait = at;
          r.auto!.unlockDrawn = unlocked;
        });
        return true;
      }
      if (run === "unlock") return true;
      if (until !== undefined && now < until) return true;
    }
    const asked = run === "asked" && s.auto?.unlockDrawn !== unlocked;
    if (until !== undefined || asked) {
      await this.update(network, s.index, (r) => {
        delete r.auto!.unlockWait;
        if (asked) r.auto!.unlockDrawn = unlocked;
      });
    }
    return false;
  }

  /**
   * Whether every order the swap that landed placed is spent, by its fill or
   * its refund (Koios `utxo_info`, which lists spent UTxOs too): that copy's
   * own orders, recorded before it was sent, whichever copy it is (final
   * review sessions-3). A session from before each copy kept its own has
   * those of the copy sent last, which count only if that's the one that
   * landed. Orders it doesn't know: whatever arrives counts, as it did.
   */
  private async ordersSpent(network: NetworkName, s: SessionRecord): Promise<boolean> {
    const swap = s.txs.find((t) => t.kind === "swap" && t.confirmed && !t.replaced);
    if (!swap) return true;
    const orders = swap.orders ?? s.orders?.filter((o) => o.startsWith(`${swap.txHash}#`));
    if (!orders?.length) return true;
    const rows = (await this.deps.koios(network).utxoInfo(orders)) as Array<KoiosUtxo & { is_spent?: boolean }>;
    return orders.every((o) => rows.some((r) => outpoint(r) === o && r.is_spent));
  }

  /**
   * Which of swap copies `copies` landed, by their orders (recorded before
   * each was sent): Koios's `utxo_info` knows an order, spent or not, only
   * once its transaction is in a block, whatever tx_status says yet
   * (independent review L15).
   */
  private async placed(network: NetworkName, s: SessionRecord, copies: RecordedTx[]): Promise<string[]> {
    const of = new Map<string, string>();
    for (const t of copies) {
      for (const o of t.orders ?? s.orders?.filter((x) => x.startsWith(`${t.txHash}#`)) ?? []) of.set(o, t.txHash);
    }
    if (!of.size) return [];
    const rows = await this.deps.koios(network).utxoInfo([...of.keys()]);
    return [...new Set(rows.flatMap((r) => of.get(outpoint(r)) ?? []))];
  }

  /**
   * Whether an order of session `s`'s swap may still pay its account: one
   * of the landed copy's orders isn't spent (ordersSpent), or one is open
   * from chain, though a DEX made it (a remainder of a partial fill:
   * `liveOrders`). Nothing reads a closed session's account again, so it
   * isn't closed meanwhile (independent review L15, D2). `keep`: as
   * liveOrders'.
   */
  private async ordersOpen(network: NetworkName, s: SessionRecord, address: string, keep = false): Promise<boolean> {
    if (!s.txs.some((t) => t.kind === "swap" && !t.unsent)) return false;
    if (!(await this.ordersSpent(network, s))) return true;
    return (await this.liveOrders(network, s, address, keep)).length > 0;
  }

  /**
   * The session's orders still open, read from chain and never from
   * Minswap's list, which doesn't hold every order (chunk 24, Step 3): each
   * order a sent copy of its swap placed, recorded before it was sent, that
   * isn't spent; and what a fill in parts of one left at the same address,
   * under the session's own stake key (Splash fills an order in parts). Of
   * what's there, only what reads as the session's order, holds no
   * reference script (no cancel the wallet builds can spend one), and a fill
   * of the session's own order left (remnantsFrom): anyone can pay that
   * address an output whose datum names the session, and one no cancel can
   * spend would hold Stop, the return and the close for good (release
   * review C02). Each as Koios lists it, with its datum. `keep`: where what's
   * there came from is kept with the session, for a caller in the queue (a
   * write from outside it could undo another's). `given`: the orders as the
   * restore scan read them just before, spent or not, so they aren't asked
   * again (recoveredRecords, 1.5.0's release review, C15).
   */
  private async liveOrders(
    network: NetworkName,
    s: SessionRecord,
    address: string,
    keep = false,
    given?: ReadonlyMap<string, KoiosUtxo & { is_spent?: boolean }>,
  ): Promise<KoiosUtxo[]> {
    const recorded = [
      ...new Set(
        s.txs
          .filter((t) => t.kind === "swap" && !t.unsent)
          .flatMap((t) => t.orders ?? s.orders?.filter((o) => o.startsWith(`${t.txHash}#`)) ?? []),
      ),
    ];
    if (!recorded.length) return [];
    const koios = this.deps.koios(network);
    const rows =
      given && recorded.every((o) => given.has(o))
        ? recorded.map((o) => given.get(o)!)
        : ((await koios.utxoInfo(recorded)) as Array<KoiosUtxo & { is_spent?: boolean }>);
    const live: KoiosUtxo[] = rows.filter((r) => !r.is_spent);
    // How WebAssembly reads it, as an order: one whose datum it can't read isn't one.
    const read = (r: KoiosUtxo) => {
      if (!r.address || !r.inline_datum) return undefined;
      try {
        return dexOrder(this.deps.wasm, network, r, address);
      } catch (e) {
        if (isTrap(e)) throw e;
        return undefined;
      }
    };
    // A fill in parts spends the order and leaves the rest as a new one where it sat: looked for only where a
    // spent order Koios describes was Splash's (no other DEX the wallet routes fills in parts).
    const parted = [...new Set(rows.filter((r) => r.is_spent && read(r)?.protocol === "Splash").map((r) => r.address))];
    if (!parted.length) return live;
    const known = new Set(live.map(outpoint));
    const found = (await koios.addressUtxos(parted)).filter((r) => !known.has(outpoint(r)) && !r.reference_script && read(r)?.ours);
    if (!found.length) return live;
    const from = await this.remnantsFrom(network, s, recorded, found, keep);
    return [...live, ...found.filter((r) => from.has(r.tx_hash))];
  }

  /**
   * Which of the transactions that put `found` at a spent Splash order's
   * address are fills of the session's own order (release review C02): each
   * spent one of the swap's orders (`recorded`), or what such a fill left
   * there, followed back through that address for up to REMNANT_HOPS fills
   * the reads may have missed in between (Koios `tx_info`, its inputs alone,
   * one request a hop). Any other is a stranger's, however its outputs'
   * datums read. Each is asked of Koios once: what's found is kept with the
   * session (`remnants`) when `keep`, here too (`s`), as a refresh saves its
   * own copy of the record after. One Koios doesn't know yet (a backend
   * behind the one that listed it), or whose inputs it doesn't say, is
   * neither: the read fails, and the next asks again.
   */
  private async remnantsFrom(
    network: NetworkName,
    s: SessionRecord,
    recorded: string[],
    found: KoiosUtxo[],
    keep: boolean,
  ): Promise<Set<string>> {
    const from = new Set(s.remnants?.from ?? []);
    const not = new Set(s.remnants?.not ?? []);
    const where = new Map(found.map((r) => [r.tx_hash, r.address]));
    // Each transaction still to tell, and those it's followed back through: at first, itself.
    let ask = new Map([...where.keys()].filter((h) => !from.has(h) && !not.has(h)).map((h) => [h, [h]]));
    if (!ask.size) return from;
    const orders = new Set(recorded);
    let unknown = false;
    for (let hop = 0; ask.size && hop < REMNANT_HOPS; hop++) {
      const looked = [...new Set([...ask.values()].flat())];
      const spent = new Map((await this.deps.koios(network).txSpends(looked)).map((r) => [r.tx_hash, r.inputs ?? []]));
      const next = new Map<string, string[]>();
      for (const [h, via] of ask) {
        const inputs = via.flatMap((x) => spent.get(x) ?? []);
        if (via.some((x) => !spent.get(x)?.length) || inputs.some((i) => i.tx_hash === undefined || i.tx_index === undefined)) {
          unknown = true;
          continue;
        }
        // What it spent at the order's address: the session's order itself, what a fill of it left, or what
        // the fill before left, looked at next, unless that's a stranger's already.
        const there = inputs.filter((i) => i.payment_addr.bech32 === where.get(h)).map((i) => i.tx_hash!);
        const before = [...new Set(there.filter((x) => !not.has(x)))];
        if (inputs.some((i) => orders.has(`${i.tx_hash}#${i.tx_index}`)) || there.some((x) => from.has(x))) from.add(h);
        else if (before.length) next.set(h, before);
        else not.add(h);
      }
      ask = next;
    }
    // Followed back as far as it goes without reaching the session's order: not its.
    for (const h of ask.keys()) not.add(h);
    if (keep && (from.size !== (s.remnants?.from.length ?? 0) || not.size !== (s.remnants?.not.length ?? 0))) {
      const remnants = { from: [...from], not: [...not] };
      s.remnants = remnants;
      await this.update(network, s.index, (r) => {
        r.remnants = remnants;
      });
    }
    if (unknown) throw new KoiosError(NOT_CAUGHT_UP(), "silent");
    return from;
  }

  /** Places the order: a fresh quote, Minswap's swap for the account, the checks, and the key's signature. */
  private async order(network: NetworkName, s: SessionRecord, address: string, rows: KoiosUtxo[]): Promise<void> {
    if (!s.swap) throw new Refused(t("sess.refuse.warn.notSwap"));
    const approved = s.auto!.approved;
    const minswap = this.deps.minswap(network);
    const ask = checkAsk(s.swap);
    const { est, avoid } = await routeOf(minswap, ask);
    // Routed afresh: never through a DEX whose orders the wallet can't check, whatever the quote went
    // through, nor where the session's check can't follow it. It pauses, as the quote would have refused it
    // (independent review M17, release review C34).
    const unchecked = uncheckedProtocols(network, est);
    if (unchecked.length) {
      throw new Refused(t("sess.refuse.warn.nowRoutes", { protocols: unchecked.join(t("histories.list.and")) }));
    }
    const legged = outOfPlace(est);
    if (legged.length) {
      throw new Refused(t("sess.refuse.warn.nowOutOfPlace", { protocols: legged.join(t("histories.list.and")) }));
    }
    // Approved against the pools, its review didn't say the wallet relies on Minswap for an order's minimum: routed
    // to an order now, it pauses before anything's built (release review C09). Approved as an order, a swap
    // against the pools goes: the wallet reads what that gives itself.
    if (approved.againstPools && !againstPools(est)) throw new Refused(t("sess.refuse.warn.nowOrder"));
    const least = BigInt(approved.minAmountOut);
    if (BigInt(est.amount_out) < least) throw new PriceMoved(est.amount_out);
    // Minswap puts its own fresh minimum in the order, amount_out / (1 + slippage%), whatever it's asked for, and
    // won't build one under the minimum it's given (Minswap.buildTx). After a dip the quote is still above the
    // approved minimum, but the approved slippage puts Minswap's under it, and every build is refused until the
    // price comes back: asked with only the slippage that keeps it at the approved minimum (seen on mainnet, 1.1.0).
    const dipped = BigInt(est.min_amount_out) < least;
    const asked = dipped ? { ...ask, slippage: slippageKeeping(BigInt(est.amount_out), least) } : ask;
    // At least what the user approved, or more when the price has moved their way.
    const min = dipped ? approved.minAmountOut : est.min_amount_out;
    const txCbor = await minswap.buildTx(address, min, asked, avoid);
    // Minswap's fee is bounded by what was approved, not by what it quotes now.
    const quote = { ...quoteOf(network, asked, est), minAmountOut: min, aggregatorFee: approved.aggregatorFee ?? "0" };
    const built = await this.inspect(network, s, "swap", txCbor, rows, quote);
    // build-tx routes again on Minswap's side: what it built is what counts.
    if (approved.againstPools && !built.againstPools) throw new Refused(t("sess.refuse.warn.nowOrder"));
    // A swap against the pools was held to the funding as it was read (inspect's withinNet), as by hand.
    if (!built.againstPools) withinFunding(paidOut(built.summary, address), built.summary.fee, approved.fund);
    await this.signAndSend(network, built);
  }

  /**
   * Cancels the session's orders, after Stop: the wallet's own cancel, with
   * the session's own keys and collateral (chunk 24, Step 3; Minswap's
   * `cancel-tx` is gone), checked as any session transaction is, and signed.
   * One transaction cancels the orders that can share it; the next step the
   * rest.
   */
  private async cancel(
    network: NetworkName,
    s: SessionRecord,
    address: string,
    rows: KoiosUtxo[],
    orders: KoiosUtxo[],
  ): Promise<void> {
    const { txCbor } = await this.cancelOf(network, address, rows, orders);
    const built = await this.inspect(network, s, "cancel", txCbor, rows);
    // A cancel only brings the orders' funds back to the session: it pays nothing out but its fee, and that's small.
    if (paidOut(built.summary, address).length) throw new Refused(t("sess.refuse.warn.cancelPaysOther"), "cancel");
    if (BigInt(built.summary.fee) > MAX_CANCEL_FEE) throw new Refused(t("sess.refuse.warn.cancelFee"), "cancel");
    await this.signAndSend(network, built);
  }

  /**
   * Builds the cancel of `orders`, the session's own, in WebAssembly
   * (`buildOrderCancel`): each order's datum (the bytes its hash names, from
   * Koios, for one kept by hash), the reference UTxOs its script is read
   * from, the session's own UTxOs for the fee, and one of its 5 ₳ UTxOs as
   * collateral. Unsigned. What it can't build pauses the swap and says why.
   */
  private async cancelOf(
    network: NetworkName,
    address: string,
    rows: KoiosUtxo[],
    orders: KoiosUtxo[],
  ): Promise<{ txCbor: string; covers: string[] }> {
    const { wasm } = this.deps;
    const koios = this.deps.koios(network);
    // Its 5 ₳ collateral, as its funding paid one; or, if a cancel before spent it, its largest UTxO of ADA alone
    // (WebAssembly checks it covers the cancel). Its other UTxOs of ADA alone help pay the fee with the orders' own
    // ADA; one holding tokens or a datum (a stranger's) waits for the return.
    const plain = rows.filter(plainAda).sort((a, b) => (BigInt(b.value) > BigInt(a.value) ? 1 : -1));
    const collateral = rows.find(collateralFits) ?? plain[0];
    if (!collateral) throw new Refused(t("sess.refuse.warn.noCollateral"), "cancel");
    const byHash = orders.filter((o) => !o.inline_datum && o.datum_hash).map((o) => o.datum_hash!);
    const datums = byHash.length ? await koios.datumInfo([...new Set(byHash)]) : new Map<string, string>();
    const refs = [
      ...new Set(orders.flatMap((o) => dexOrder(wasm, network, o, address).reference ?? [])),
    ];
    const references = refs.length ? await koios.utxoInfo(refs) : [];
    const request = JSON.stringify({
      network,
      params: await koios.epochParams(),
      session: address,
      orders: orders.map((o) => ({
        utxo: o,
        datum: o.inline_datum?.bytes ?? (o.datum_hash ? (datums.get(o.datum_hash) ?? "") : ""),
      })),
      funds: plain,
      collateral,
      references,
    });
    try {
      return JSON.parse(wasm.buildOrderCancel(request)) as { txCbor: string; covers: string[] };
    } catch (e) {
      if (isTrap(e)) throw e;
      throw new Refused(clauseOf(e instanceof Error ? e.message : String(e)), "cancel");
    }
  }

  /**
   * Before the session's key signs a swap that places orders, WebAssembly
   * builds the wallet's own cancel of each (`orders`, its output indexes) and
   * runs the order's real script on it (`checkOrderCancels`, release review
   * C05): with stand-in funds and collateral of ADA alone at the session's
   * address, each order alone, each script read from its reference UTxO
   * (referenceRows) or, a Plutus V1 one's, carried. The reader alone vouches
   * only for who cancels an order and whom it pays: an order no cancel could
   * spend (its datum held inline at a Plutus V1 script, a script on it,
   * details its script can't decode), or whose cancel costs more than Stop's
   * may pay (MAX_CANCEL_FEE), would keep the swap's money where Stop can't
   * bring it back, so it's refused. `reads`: each order's, its reference
   * among them. The runner's and Review it myself's alike (inspect).
   */
  private async cancelsChecked(
    network: NetworkName,
    txCbor: string,
    orders: number[],
    reads: DexOrderRead[],
    session: string,
  ): Promise<void> {
    const { wasm } = this.deps;
    const references = await this.referenceRows(network, [...new Set(reads.flatMap((r) => r.reference ?? []))]);
    const request = JSON.stringify({
      network,
      params: await this.deps.koios(network).epochParams(),
      session,
      txCbor,
      orders,
      references,
    });
    let checked: Array<{ cancels: boolean; fee: string | null }>;
    try {
      checked = (JSON.parse(wasm.checkOrderCancels(request)) as { orders: typeof checked }).orders;
    } catch (e) {
      // A swap or a session WebAssembly can't read for it won't read any better later: pause, as inspect does.
      if (isTrap(e)) throw e;
      throw new Refused(clauseOf(e instanceof Error ? e.message : String(e)));
    }
    // Each order asked for, cancelled within what Stop's own cancel may pay (cancel).
    const cancels = (c: (typeof checked)[number]) => c.cancels && c.fee !== null && BigInt(c.fee) <= MAX_CANCEL_FEE;
    if (checked.length !== orders.length || !checked.every(cancels)) {
      throw new Refused(t("sess.refuse.warn.notCancellable"));
    }
  }

  /**
   * The reference UTxOs `refs` (`txhash#index`) the dry run of a swap's
   * cancels reads its orders' scripts from (cancelsChecked), as Koios's
   * `utxo_info` lists them with their scripts. Each is pinned in orders.json,
   * so it's asked for once a worker's life and kept by network: one spent
   * since still gives its script, which WebAssembly checks against the pinned
   * hash, and the dry run builds alike either way. Stop's own cancel reads
   * them afresh (cancelOf): whether one is spent decides whether its script
   * is read from it there or carried. One Koios doesn't give, or gives
   * without its script, fails the step, which is tried again: never a dry
   * run without it, which would call an order the wallet can cancel one it
   * can't (release review C05).
   */
  private async referenceRows(network: NetworkName, refs: string[]): Promise<KoiosUtxo[]> {
    const kept = this.references.get(network) ?? new Map<string, KoiosUtxo>();
    this.references.set(network, kept);
    const asked = refs.filter((r) => !kept.has(r));
    if (asked.length) {
      for (const row of await this.deps.koios(network).utxoInfo(asked)) {
        if (asked.includes(outpoint(row)) && row.reference_script?.bytes) kept.set(outpoint(row), row);
      }
    }
    if (refs.some((r) => !kept.has(r))) throw new KoiosError(NOT_CAUGHT_UP(), "silent");
    return refs.map((r) => kept.get(r)!);
  }

  /**
   * Brings everything at the session's account back into the private
   * balance (`direct`: not through Lovejoin). What can't come back stays,
   * recorded as left behind, and the session closes without it.
   */
  private async bringBack(network: NetworkName, index: number, rows: KoiosUtxo[], direct = false): Promise<void> {
    let built: KeptBack;
    try {
      built = await this.buildBack(network, index, rows, undefined, direct);
    } catch (e) {
      if (e instanceof NothingComesBack) return;
      throw e;
    }
    // The runner's step sends the chain's first block's worth; its next steps the rest.
    await this.sendBack(network, built, SESSION_BACK, CHAIN_PUMP_MS);
  }

  // -------------------------------------------------------------------------

  /**
   * Reads a swap Minswap built, or the wallet's own cancel of the session's
   * orders (chunk 24, Step 3), against the session's key: what it spends,
   * what its key never signs, and, a swap's, where it pays (`checkOrder`,
   * with Minswap's fee as `quote` has it) and that the wallet's own cancel of
   * each order it places can spend it (`cancelsChecked`, release review C05).
   * A swap against the pools is read by what it spends, pays and gives back,
   * and held to what was funded for it as approved (`withinNet`), whether
   * the runner places it or the user reviews it (release review C10). What
   * it refuses is said of the kind it reads (Refused `of`).
   */
  private async inspect(
    network: NetworkName,
    s: SessionRecord,
    kind: "swap" | "cancel",
    txCbor: string,
    rows: KoiosUtxo[],
    quote?: SwapQuote,
  ): Promise<KeptTx & { summary: DappTxSummary }> {
    const { wasm, wallet, now } = this.deps;
    const { index } = s;
    let bytes: Uint8Array;
    let spends: string[];
    let collateral: string[];
    let outputs: BuiltOutput[];
    try {
      bytes = hexBytes(txCbor);
      spends = bodyOutpoints(bytes, 0) ?? [];
      collateral = bodyOutpoints(bytes, 13) ?? [];
      outputs = builtOutputs(bytes);
    } catch {
      throw new Error(kind === "cancel" ? t("sess.cannotReadCancel") : t("sess.cannotRead"));
    }
    const refs = [...new Set([...spends, ...collateral])];
    const own = new Map(rows.map((r) => [outpoint(r), r]));
    const others = refs.filter((r) => !own.has(r));
    const foreign = others.length ? await this.deps.koios(network).utxoInfo(others) : [];
    // A swap spends only the session's UTxOs, bar a direct one (Danogo's): its pools', and a collateral its owner
    // signed already (chunk 24). A cancel also spends its orders, at the DEXes' contracts.
    const direct = kind === "swap" && others.length > 0;
    const { signed, pools } = direct
      ? directSpends(network, bytes, { spends, collateral, others, foreign }, this.deps.wasm)
      : { signed: 0, pools: [] };
    const request = JSON.stringify({
      network,
      txCbor,
      keys: [{ role: 0, index }],
      // Its own stake key: what pays its address back is its own (a session from before has the shared one).
      stakeIndex: s.ownStake ? index : 0,
      inputs: [...refs.flatMap((r) => own.get(r) ?? []), ...foreign],
      // A direct swap needs its collateral owner's signature too, which it carries already.
      partialSign: direct,
    });
    let summary: DappTxSummary;
    try {
      summary = await wallet.withKeys((keys) => JSON.parse(wasm.inspectSessionTx(keys.oneTime, request)) as DappTxSummary);
    } catch (e) {
      // A lock is tried again once unlocked, never a pause: told by its type, as its words are the user's language.
      if (e instanceof WalletLocked) throw e;
      const message = e instanceof Error ? e.message : String(e);
      // What WebAssembly won't read (an output on another network, say) won't read any better later: pause.
      throw new Refused(clauseOf(message), kind);
    }
    // A cancel of a SundaeSwap V3 or Stableswaps order needs its owner's signature too: the session's own stake
    // key (chunk 24), as the spent order itself says.
    const ownStake = s.ownStake === true;
    const { address: bech32 } = (await this.accounts(network, [s])).get(index)!;
    const stake = kind === "cancel" && ownStake && foreign.some((r) => dexOrder(wasm, network, r, bech32).stakeSigns);
    refuseOddities(summary, index, { stake, ...(direct ? { direct: { signed } } : {}) }, kind);
    let orders: string[] | undefined;
    if (kind === "swap") {
      const { address, keyHash } = (await this.accounts(network, [s])).get(index)!;
      const session = { address: wasm.cip30Address(address), keyHash, ownStake };
      const fee = BigInt(quote?.aggregatorFee ?? "0");
      if (direct) {
        const paid = checkDirect(outputs, session, pools, fee);
        if (quote) {
          checkProceeds(summary, quote, paid);
          // As approved; a session from before, as its quote has it.
          withinNet(summary, s.auto?.approved.fund ?? quote.fund, quote.ask, paid);
        }
        orders = [];
      } else {
        // Each output as it stands, its datum's form and any script on it too: no Plutus V1 script spends an
        // inline datum, and no cancel the wallet builds spends an output carrying a script (release review C05).
        const read = (o: BuiltOutput) => dexOrderAt(wasm, network, o.address, o.datum ?? "", address, o);
        const placed = checkOrder(outputs, session, fee, read);
        await this.cancelsChecked(network, txCbor, placed, placed.map((i) => read(outputs[i]!)), address);
        orders = placed.map((i) => `${summary.txHash}#${i}`);
      }
    }
    return {
      network,
      index,
      kind,
      txHash: summary.txHash,
      txCbor,
      request,
      quote,
      orders,
      ...(direct ? { againstPools: true } : {}),
      builtAt: now(),
      summary,
    };
  }

  /**
   * Reads a swap Minswap built, or the wallet's own cancel (inspect), and
   * keeps it for the user's Send. A swap against the pools says so
   * (`againstPools`), from the transaction itself: build-tx routes again on
   * Minswap's side, so the quote's route may not be what's signed (release
   * review C10).
   */
  private async review(
    network: NetworkName,
    s: SessionRecord,
    kind: "swap" | "cancel",
    txCbor: string,
    rows: KoiosUtxo[],
    extra: { quote?: SwapQuote; orders?: number },
  ): Promise<SessionTxReview> {
    const { summary, builtAt: _builtAt, ...kept } = await this.inspect(network, s, kind, txCbor, rows, extra.quote);
    await keep(this.deps, SESSION_TX, kept);
    return {
      network,
      index: s.index,
      kind,
      txHash: summary.txHash,
      summary,
      ...extra,
      ...(kept.againstPools ? { againstPools: true } : {}),
    };
  }

  /** Signs a swap or cancel with the session's key alone, puts the signature in byte for byte, and sends it. */
  private async signAndSend(network: NetworkName, built: KeptTx): Promise<PendingTx> {
    const { wasm, wallet } = this.deps;
    const whole = await wallet.withKeys((keys) => {
      const signed = JSON.parse(wasm.signSessionTx(keys.oneTime, built.request)) as { witnessSet: string; summary: DappTxSummary };
      if (signed.summary.txHash !== built.txHash) throw new Error(t("worker.spend.signingChanged"));
      return wasm.attachWitnesses(built.txCbor, signed.witnessSet);
    });
    const bytes = hexBytes(whole);
    if (txId(bytes) !== built.txHash) throw new Error(t("sess.witnessChanged"));
    return this.sendRecorded(network, built.index, built.kind, built.txHash, bytes, SESSION_TX, {
      // Recorded with it, before it's sent: whichever copy of the swap lands, its own orders are the ones looked
      // at, and its own minimum the one shown.
      orders: built.kind === "swap" ? built.orders : undefined,
      againstPools: built.againstPools,
      minAmountOut: built.kind === "swap" ? built.quote?.minAmountOut : undefined,
      after: (s) => {
        if (built.kind === "swap" && built.quote && s.swap) {
          s.swap = { ...s.swap, amountOut: built.quote.amountOut, minAmountOut: built.quote.minAmountOut };
        }
      },
    });
  }

  /**
   * The return of everything at the session's account, built and signed by
   * the session's key. Unless `direct`, spare ADA that pays for a Lovejoin
   * box goes through Lovejoin first: the whole chain is built here, the
   * return last, and the boxes come back later, each on its own.
   */
  private async buildBack(
    network: NetworkName,
    index: number,
    held: KoiosUtxo[],
    known?: unknown,
    direct = false,
    pools?: Record<string, string | null>,
  ): Promise<KeptBack> {
    const { wasm, wallet, now } = this.deps;
    if (await this.pendingChain(network, index)) {
      throw new Error(t("sess.chainSending"));
    }
    // A reference script the wallet can't measure: no transaction of its takes that UTxO, ever.
    const unpriced = held.filter((u) => !measurable(u));
    if (unpriced.length) await this.leaveBehind(network, index, unpriced, "script");
    const rows = held.filter(measurable);
    if (!rows.length) {
      await this.nothingBack(network, index, held);
      throw new NothingComesBack(t("sess.scriptStays"));
    }
    const params = known ?? (await this.deps.koios(network).epochParams());
    const merge = await this.fundingChange(network, index);
    const record = (await this.book(network)).sessions.find((r) => r.index === index);
    // A chain that went in partly already: what's left comes back directly, rather than go in again.
    // One that finished (its return sent), or whose rest came back directly (that return on chain), doesn't
    // hold a later return back (a site's session is paid again). Only the latest chain's own transactions
    // count, never an earlier one's (independent review L17); a session from before chains were recorded
    // counts them all, as it did. A session the restore scan found records none of its key's deposits or
    // mixes (they're in `recovered.own` alone), so what another browser's chain left at its account goes
    // through Lovejoin as any other session's would, in a chain of its own that never draws the wallet's
    // boxes; its review's switch brings it back directly (1.5.0's release review, C51). The offer of 5 ₳ for a
    // return's collateral reads it the same way (chainSoFar, lovejoinWantsCollateral).
    const { sent, started } = chainSoFar(record);
    if (started && record?.chain && !record.chain.stopped) {
      // Nothing is sending the rest: the wallet locked, or the browser closed, partway.
      await this.update(network, index, (r) => {
        r.chain!.stopped = CHAIN_CUT();
      });
    }
    // What the session's own transactions left at the account comes back first when not everything can at once:
    // the wallet's, and a site's own that the session's key signed (siteOuts), whose tokens the session's ADA
    // pays the deposit of, as it did before H1. A stranger's is only what neither asked the key to sign: its
    // tokens come back only when they pay their own way (final review F4).
    const siteTxs = (record?.siteOuts ?? []).map((o) => o.split("#")[0]!);
    // A session the restore scan found: everything its key signed, and what this phrase's private balance paid it
    // beside its funding (a funding's other parts, a top-up), as far as the scan saw (1.6.0's release review,
    // x-scenarios-sessions#0).
    const own = [...new Set([...(record?.txs.map((t) => t.txHash) ?? []), ...siteTxs, ...(record?.recovered?.own ?? [])])];
    const lovejoin = this.deps.lovejoin;
    // Why Lovejoin is left out, which the return's warning shows (lovejoinSkipped): each reason is named
    // `.skip.warn.`, as the name is what keeps it checked (tests/i18n-worker-reasons.test.ts).
    let skipped: string | undefined;
    // What that chain left was sent back directly, and isn't on chain yet: this return comes back directly too,
    // and says why when it would have gone through Lovejoin (independent review L17).
    const restOnItsWay = started && sent.some((t) => t.kind === "back" && !t.confirmed && !t.replaced);
    if (!direct && restOnItsWay && lovejoin?.available(network) && (await this.throughLovejoin(record))) skipped = REST_NOT_BACK();
    // The session's 5 ₳ collateral is mixed once on its way into the 5 ₳ pool, rather than back with the rest under
    // the session's history, wherever its return goes through Lovejoin, a chain's or one that comes back directly, and
    // Settings keeps it on (the owner, 2026-10-22 and 2026-10-23): its deposit and its mix go before the return. Read
    // as it's built, as Settings' Lovejoin is for any session but a swap. WebAssembly brings it back with the rest
    // where what's left can't pay for that. Nor is the pool read where the account holds no 5 ₳ to mix. Never a
    // Bootstrap's, nor a seed's: their chain is a deposit alone, which runs no script, so their collateral was never
    // put up, and it comes back with the rest (the owner, 2026-10-23).
    const intoPool =
      !direct &&
      !depositOnly(record) &&
      rows.some(collateralFits) &&
      lovejoin?.available(network) &&
      (await this.throughLovejoin(record)) &&
      (await this.collateralIntoPool())
        ? await lovejoin.collateralPool(network, params, chainOwner(index))
        : undefined;
    // Its deposit and its mix: two of the return's transactions.
    const tailIn = (tail?: CollateralTail) => (tail && intoPool ? { collateralTail: { ...tail, pool: intoPool.pool.id, txs: 2 } } : {});
    // How long its leaf waits: as the swap was approved, else Settings' as it's sent.
    const delay = record?.auto?.lovejoin?.delay;
    // The collateral's mix its chain left (a lock cut it, giveme.my refused it, a box it drew went), built again with
    // two boxes drawn afresh, and the return after it: what's left comes back once that box is mixed (tailChain).
    if (started && !direct && lovejoin) {
      const resumed = await lovejoin.tailChain(network, index, rows, params, own);
      // Not yet: what's at the account pays for that mix, so nothing comes back before it, as it says with how long
      // that may last (TailWait; 1.6.0's release review, 323-worker#2).
      if (typeof resumed === "string") throw new Error(tailWaiting(resumed));
      if (resumed) {
        const { chain, tail, resumes } = resumed;
        await this.leftBy(network, index, rows, chain.leftOut);
        const back = chain.txs.at(-1)!;
        return {
          network,
          index,
          txHash: back.txHash,
          txCbor: back.txCbor,
          fee: chain.fees,
          lovelace: chain.returned,
          tokens: chain.tokens,
          depositOutputs: 1,
          inputs: rows.length - chain.leftOut.length,
          merged: 0,
          leftOut: chain.leftOut,
          chain: chain.txs,
          leaves: [],
          collateralTail: { ...chain.collateralTail!, pool: tail.pool, txs: 1 },
          tailOf: {
            deposit: tail.deposit,
            resumes,
            tries: tail.tries + 1,
            ...(tail.landed !== undefined ? { landed: tail.landed } : {}),
            ...(delay ? { delay } : {}),
          },
          builtAt: now(),
        };
      }
    }
    if (!direct && !started && lovejoin?.available(network) && (await this.throughLovejoin(record))) {
      // Its own collateral, the one its funding paid, else any 5 ₳ of ADA alone at the account (privacy review
      // §2.15). Never a stranger's 5 ₳ carrying a reference script or a datum: the mixes can't put it up. None for a
      // Bootstrap funded with none: taken, 5 ₳ of ADA alone, its own funding in a pool whose boxes make it so, would be
      // set apart from the coins that pay its boxes, and it would come back without going in (1.6.0's release review,
      // 323-worker#4).
      const funding = record?.txs[0]?.txHash;
      const collateral = record?.mix?.noCollateral
        ? undefined
        : (rows.find((u) => collateralFits(u) && u.tx_hash === funding) ?? rows.find(collateralFits));
      let chain: LovejoinChain | undefined;
      // A Bootstrap's (or a seed's) chain is its deposit alone, which runs no script: it goes without one, and its
      // funding pays none (the owner, 2026-10-23).
      if (!collateral && !depositOnly(record)) {
        // Something the account signed spent it (a site's transaction, or a return before this one, which takes
        // it; a top-up puts one back, and a session brought back by hand is offered 5 ₳ for it): no mix can go, so
        // it comes back directly, and says so when its spare ADA would have paid for a box. A session brought back
        // by hand whose 5 ₳ is on its way says that instead: every top-up of one is 5 ₳ the mixes can put up, and
        // it isn't gone, only not there yet (cross-area review X20).
        if (await this.collateralWanted(network, record, rows)) {
          skipped = record && byHand(record) && topUpComing(record, rows, now()) ? COLLATERAL_COMING() : NO_COLLATERAL();
        }
      } else {
        try {
          // A Bootstrap funded with neither a collateral nor its way back's reserve (62162483 until 1.6.0's release
          // review): what its funding paid leaves the deposit's change too little to sweep back, so one box fewer goes
          // in, that box's ADA paying for it, and a one-box Bootstrap comes back directly (318-rust#0). One funded with
          // its 5 ₳ puts that up instead.
          let boxes = record?.mix?.boxes;
          if (boxes && record?.mix?.bootstrap && !record.mix.noCollateral && !collateral) {
            const paid = rows.filter((u) => u.tx_hash === funding).reduce((sum, u) => sum + BigInt(u.value), 0n);
            const boxesOnly = await lovejoin.funding(network, boxes, false, 0, record.mix.pool);
            if (paid < BigInt(boxesOnly.lovelace) + BigInt(wasm.lovejoinBootstrapReserve())) boxes -= 1;
          }
          chain = await lovejoin.chain(
            network,
            index,
            rows,
            collateral,
            params,
            merge,
            boxes,
            record?.mix?.again,
            own,
            record?.mix?.publicToo,
            // A swap's, as deep as it was approved (independent review L21);
            // a Bootstrap's is 0 (a seed's was), so its chain is the deposit alone.
            record?.mix?.seed || record?.mix?.bootstrap ? 0 : record?.auto?.lovejoin?.depth,
            // The pool its mix was funded for: a token pool's token went with its ADA.
            record?.mix?.pool,
            // Its width, a return's tokens' pools (chunk 34's 34e), and its collateral's, which a funding may have
            // paid for (tailReserve).
            {
              ...wayOf(record, pools),
              ...(intoPool ? { collateralPool: intoPool, ...(record?.collateralReserve ? { collateralReserve: true } : {}) } : {}),
            },
          );
        } catch (e) {
          skipped = leftOut(e);
        }
      }
      // A mix that can't pay for its boxes anymore (the fees went up) says so too; and anything else whose spare ADA
      // pays for no box (a swap's, as its review said), which comes back directly with nothing said otherwise. A
      // short pool throws, and says so above (leftOut).
      if (!chain && !skipped) skipped = t(record?.mix ? "sess.skip.warn.mixCannotPay" : "sess.skip.warn.noBox");
      if (skipped && record?.mix) {
        await this.update(network, index, (r) => {
          r.mix!.skipped = skipped;
        });
      }
      if (chain) {
        await this.leftBy(network, index, rows, chain.leftOut);
        const back = chain.txs[chain.txs.length - 1]!;
        const chainDelay = delay ?? (await lovejoin.settings()).delay;
        return {
          network,
          index,
          txHash: back.txHash,
          txCbor: back.txCbor,
          fee: chain.fees,
          lovelace: chain.returned,
          tokens: chain.tokens,
          depositOutputs: 1,
          // The chain takes every UTxO at the account, its deposit or its return, but what it leaves out.
          inputs: rows.length - chain.leftOut.length,
          merged: chain.merged,
          leftOut: chain.leftOut,
          lovejoin: {
            boxes: chain.boxes,
            depth: chain.depth,
            mixes: chain.txs.filter((t) => t.kind === "mix" && !t.tail).length,
            fees: chain.fees,
            txs: chain.txs.length,
            delay: chainDelay,
            ...(record?.mix?.again ? { again: true } : {}),
            ...(record?.mix?.bootstrap ? { bootstrap: true } : {}),
            ...(chain.pool ? { pool: chain.pool } : {}),
            ...(chain.parts ? { parts: chain.parts } : {}),
            ...(chain.ways ? { ways: chain.ways } : {}),
            ...(chain.width ? { width: chain.width } : {}),
            ...(chain.fellBack ? { fellBack: chain.fellBack } : {}),
            ...(chain.values && chain.ways?.length ? { values: chain.values } : {}),
            // The deposit, which the review shows: `txHash` above is the return,
            // the last of the chain, which spends what nothing has sent yet.
            entry: chain.txs[0]!.txHash,
          },
          chain: chain.txs,
          leaves: chain.leaves,
          ...tailIn(chain.collateralTail),
          builtAt: now(),
        };
      }
    }
    // A mix stopped before its boxes went in: it's all coming back, unmixed.
    if (direct && !started && record?.mix && !record.mix.skipped) {
      skipped = t("sess.skip.warn.mixStopped");
      await this.update(network, index, (r) => {
        r.mix!.skipped = skipped;
      });
    }
    // No chain this time: a chain built for it before won't be sent, so nothing stays reserved for it.
    await lovejoin?.release(network, chainOwner(index));
    let result: Omit<SessionBackSummary, "network" | "index"> & { txCbor: string; tail?: CollateralTail & { txs: LovejoinChain["txs"] } };
    try {
      result = await wallet.withKeys(
        (keys) =>
          JSON.parse(
            wasm.buildSessionReturn(
              keys.oneTime,
              keys.seedelf,
              JSON.stringify({
                network,
                params,
                index,
                utxos: rows,
                merge,
                own,
                ...(intoPool?.pool.ref ? { collateralPool: intoPool.pool.ref, collateralBoxes: intoPool.rows } : {}),
              }),
            ),
          ) as typeof result,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (e instanceof WalletLocked || !TOO_LITTLE.test(message)) throw e;
      // Even the session's own doesn't pay its way back (WebAssembly takes a stranger's token only when it pays
      // its own): it stays, rather than be tried for ever, and is tried again once more arrives (act, a top-up).
      await this.leaveBehind(network, index, rows, "fee");
      await this.nothingBack(network, index, rows);
      throw new NothingComesBack(t("sess.tooLittleBack"));
    }
    await this.leftBy(network, index, rows, result.leftOut);
    const { tail, ...back } = result;
    const said = skipped ? { lovejoinSkipped: skipped } : {};
    if (!tail || !intoPool) return { ...back, network, index, ...said, builtAt: now() };
    // Its collateral mixed on its way into the 5 ₳ pool: the deposit, the mix, then the return, sent as a chain.
    const { txs, ...made } = tail;
    return {
      ...back,
      network,
      index,
      fee: (BigInt(back.fee) + BigInt(made.fee)).toString(),
      ...said,
      chain: [...txs, { kind: "back", txCbor: back.txCbor, txHash: back.txHash, fee: back.fee }],
      leaves: [],
      ...tailIn(made),
      ...(delay ? { tailOf: { delay } } : {}),
      builtAt: now(),
    };
  }

  /** Whether Settings has a session's collateral go into the 5 ₳ pool (`lovejoinCollateral`), on by default. */
  private async collateralIntoPool(): Promise<boolean> {
    return (await this.deps.preferences?.get())?.lovejoinCollateral ?? DEFAULT_PREFERENCES.lovejoinCollateral;
  }

  /**
   * What a funding that pays a session its collateral adds for that collateral to be mixed on its way into a 5 ₳
   * pool as the session comes back (the owner, 2026-10-23), where its return goes `through` Lovejoin, Settings has the
   * collateral go in, and a 5 ₳ pool would take it now (collateralPool); nothing otherwise. What its mix doesn't spend
   * comes back with the change. COLLATERAL_TAIL_RESERVE (1.5 ₳) pays for the collateral's deposit and its mix; the
   * sweep after them needs more, which a mix's chain leaves from its deposit's reserve, and a swap from its margin less
   * the order's fee (SWAP_MARGIN), its fill carrying the sweep's least. `direct`: a session whose return may come back
   * directly with nothing else left, a site's or its top-up's, takes what that needs, priced from the parameters
   * (1.6.0's release review, 323-rust#1; 2.8 ₳ today).
   */
  private async tailReserve(
    network: NetworkName,
    through: boolean,
    { params, direct = false }: { params?: unknown; direct?: boolean } = {},
  ): Promise<bigint> {
    const lovejoin = this.deps.lovejoin;
    if (!through || !lovejoin?.available(network) || !(await this.collateralIntoPool())) return 0n;
    const read = params ?? (await this.deps.koios(network).epochParams());
    const pool = await lovejoin.collateralPool(network, read).catch(() => undefined);
    if (!pool) return 0n;
    const { wasm } = this.deps;
    return BigInt(direct ? wasm.lovejoinDirectCollateralReserve(JSON.stringify(read)) : wasm.lovejoinCollateralReserve());
  }

  /**
   * `build` with `reserve`, what tailReserve added for the session's collateral's mix, or with none where the private
   * balance doesn't pay for that too (NotEnoughPrivate): no form that decides what can be funded counts it, so it's
   * never what refuses a funding (1.6.0's release review, 323-worker#0). Without it, the collateral is mixed as the
   * session comes back if what's left there pays for it, and comes back with the rest otherwise. With the reserve it
   * was built with.
   */
  private async orWithoutReserve<T>(reserve: bigint, build: (reserve: bigint) => Promise<T>): Promise<{ built: T; reserve: bigint }> {
    try {
      return { built: await build(reserve), reserve };
    } catch (e) {
      if (!reserve || !(e instanceof NotEnoughPrivate)) throw e;
      return { built: await build(0n), reserve: 0n };
    }
  }

  /**
   * Whether session `s`'s return goes through Lovejoin, as the user has it
   * (privacy review §4.1): a mix from the Lovejoin tile always does; a swap
   * as approved (`auto.direct`, which Stop can make direct); any other as
   * Settings has it now (`lovejoinReturns`). Off, it comes back directly,
   * and nothing says Lovejoin was left out: the user left it out.
   */
  private async throughLovejoin(s?: SessionRecord): Promise<boolean> {
    if (s?.mix) return true;
    if (s?.auto?.direct !== undefined) return !s.auto.direct;
    return (await this.deps.preferences?.get())?.lovejoinReturns ?? DEFAULT_PREFERENCES.lovejoinReturns;
  }

  /**
   * With none of `rows` at a session's account one its chain can put up as
   * collateral (collateralFits), whether its return through Lovejoin leaves
   * Lovejoin out for that (NO_COLLATERAL) rather than for want of a box
   * (noBox): a mix's always does, and anything else's whose spare ADA pays
   * for a box.
   */
  private async collateralWanted(network: NetworkName, s: SessionRecord | undefined, rows: KoiosUtxo[]): Promise<boolean> {
    if (rows.some(collateralFits)) return false;
    if (s?.mix) return !depositOnly(s);
    // A box three a mix: four falls back to three where it costs more than the spare pays (34e's review, 6).
    const lovejoin = this.deps.lovejoin!;
    const spare = spareOf(rows);
    if (spare >= BigInt((await lovejoin.funding(network, 1, false, undefined, undefined, 3)).lovelace)) return true;
    // Or a box of a token the session's own UTxOs (or its swap's fill) hold, in a pool of it its return may use, which
    // its spare ADA pays for (chunk 34's 34e, for 34f): its box's ADA and its mixes, as acrossOf counts them (wayOf:
    // an approved swap's token in its approved pool only). The pools as discovery kept them, asking nobody.
    const returns = s ? wayOf(s).returns : undefined;
    if (!s || !returns) return false;
    const own = new Set([...s.txs.map((t) => t.txHash), ...(returns.fills ?? [])]);
    const held = new Map<string, bigint>();
    for (const u of rows) {
      if (!own.has(u.tx_hash)) continue;
      for (const a of u.asset_list ?? []) held.set(a.policy_id + a.asset_name, (held.get(a.policy_id + a.asset_name) ?? 0n) + BigInt(a.quantity));
    }
    for (const [unit, quantity] of held) {
      const named = returns.tokens && unit in returns.tokens ? returns.tokens[unit] : returns.only ? null : undefined;
      if (named === null) continue;
      for (const pool of await lovejoin.poolsOf(network, unit, true)) {
        if (named !== undefined && pool.id !== named) continue;
        if (quantity < BigInt(pool.token!.quantity)) continue;
        if (spare >= BigInt((await lovejoin.funding(network, 1, false, undefined, pool, 3)).lovelace)) return true;
      }
    }
    return false;
  }

  /**
   * Whether session `s`'s return of `rows`, its account as read, would go
   * through Lovejoin but for the collateral its mixes put up, as buildBack
   * decides it: Lovejoin is here, the return goes through it
   * (throughLovejoin: Settings', for a session brought back by hand), no
   * chain of it went in partly (chainSoFar), and it wants that collateral
   * alone (collateralWanted). The offer of 5 ₳ for it asks the same, so the
   * two agree (1.5.0's release review, C53).
   */
  private async lovejoinWantsCollateral(network: NetworkName, s: SessionRecord, rows: KoiosUtxo[]): Promise<boolean> {
    if (!this.deps.lovejoin?.available(network) || chainSoFar(s).started || !(await this.throughLovejoin(s))) return false;
    // buildBack's own rows, so the two read the same. It changes nothing here: every UTxO WebAssembly can't measure
    // carries a reference script, which neither collateralFits nor spareOf counts (cross-area review X15).
    return this.collateralWanted(network, s, rows.filter(measurable));
  }

  /**
   * Records that nothing of `rows` at session `index`'s account pays for its
   * own way back (`nothingBack`), when the session's own money is among them.
   * Only a stranger's there says nothing of the session's own: Koios may not
   * list its funding yet, and a mix of the boxes again keeps holding them for
   * the chain that goes once it does (independent review H1).
   */
  private async nothingBack(network: NetworkName, index: number, rows: KoiosUtxo[]): Promise<void> {
    const record = (await this.book(network)).sessions.find((r) => r.index === index);
    const own = new Set(record?.txs.map((t) => t.txHash));
    if (!rows.some((u) => own.has(u.tx_hash))) return;
    await this.update(network, index, (r) => {
      r.nothingBack ??= this.deps.now();
    });
  }

  /** Records `rows` at session `index`'s account as left behind, for `reason`: no return takes them. */
  private async leaveBehind(network: NetworkName, index: number, rows: KoiosUtxo[], reason: LeftBehindUtxo["reason"]): Promise<void> {
    const found = new Set(rows.map(outpoint));
    await this.update(network, index, (r) => {
      r.leftBehind = [
        ...(r.leftBehind ?? []).filter((b) => !found.has(`${b.txHash}#${b.txIndex}`)),
        ...rows.map((u) => ({ txHash: u.tx_hash, txIndex: u.tx_index, reason, lovelace: u.value })),
      ];
    });
  }

  /**
   * After a return of `rows` is built (independent review H1, H2): only
   * what WebAssembly left out because it doesn't pay its own way back
   * (`cost`, a stranger's tokens) is left behind, never the rest; what was
   * left behind for its fee and comes back now, or waits for the next return
   * (`size`, `tokens`), isn't anymore; and a return is found again
   * (`nothingBack`).
   */
  private async leftBy(network: NetworkName, index: number, rows: KoiosUtxo[], leftOut: LeftOutUtxo[] = []): Promise<void> {
    const key = (u: { txHash: string; txIndex: number }) => `${u.txHash}#${u.txIndex}`;
    const cost = new Set(leftOut.filter((l) => l.reason === "cost").map(key));
    const stays = rows.filter((u) => cost.has(outpoint(u)));
    // Left behind for its fee before, and now taken or only waiting for room: a later return takes it, so it
    // holds the session open again, rather than be left at the account when the session closes.
    const back = new Set(rows.map(outpoint).filter((o) => !cost.has(o)));
    const record = (await this.book(network)).sessions.find((r) => r.index === index);
    const cleared = (record?.leftBehind ?? []).some((b) => b.reason === "fee" && back.has(key(b)));
    if (!stays.length && !cleared && record?.nothingBack === undefined) return;
    await this.update(network, index, (r) => {
      r.leftBehind = (r.leftBehind ?? []).filter((b) => !(b.reason === "fee" && back.has(key(b))));
      delete r.nothingBack;
    });
    if (stays.length) await this.leaveBehind(network, index, stays, "fee");
  }

  /**
   * The Seedelf UTxOs session `index`'s funding made (its change), still in
   * the private balance and not locked: a return merges into them rather
   * than making new ones, since they're linked to the session on chain
   * already. None when they've been spent (or the contract can't be read:
   * the return then makes new ones, as it always did). Nor what another
   * chain being sent will spend (spent.ts reservations): a payment's parts
   * still to go would be refused once the return took one (1.6.0's review).
   * The session's own, left from a chain that stopped, its return replaces.
   */
  private async fundingChange(network: NetworkName, index: number): Promise<KoiosUtxo[]> {
    const s = (await this.book(network)).sessions.find((r) => r.index === index);
    const outs = new Set(s?.txs.filter((t) => t.kind === "out" && !t.unsent).map((t) => t.txHash) ?? []);
    if (!outs.size) return [];
    try {
      const view = await readContractView(this.deps, network);
      const { wallet, session, now } = this.deps;
      const reserved = await wallet.withKeys(() =>
        reservedSet(session, network, { sending: true, now: now(), except: chainOwner(index) }),
      );
      const mine = await this.deps.coins.seedelf(network, spendable(this.deps, view));
      return mine
        .filter((u) => outs.has(u.tx_hash) && !reserved.inputs.has(outpoint(u)))
        .sort((a, b) => (BigInt(b.value) > BigInt(a.value) ? 1 : -1))
        .slice(0, MAX_MERGE);
    } catch {
      return [];
    }
  }

  /**
   * Sends a return, and puts it in the private history. `kept`: where it was
   * kept for Send, cleared once it's sent. A chain through Lovejoin sends its
   * first window and looks for blocks for up to `budgetMs` (none for a Send
   * the user waits on); the runner's steps and the alarm send the rest.
   */
  private async sendBack(network: NetworkName, built: KeptBack, kept = SESSION_BACK, budgetMs = 0): Promise<PendingTx> {
    if (built.chain) return this.sendChain(network, built, kept, budgetMs);
    // Lovejoin was left out: the session says so, a swap that ran itself too.
    const skipped = built.lovejoinSkipped;
    const pending = await this.sendRecorded(network, built.index, "back", built.txHash, hexBytes(built.txCbor), kept, {
      after: (s) => {
        if (skipped && !s.mix) s.lovejoinSkipped = skipped;
      },
      summary: { index: built.index, lovelace: built.lovelace, tokens: built.tokens, fee: built.fee },
    });
    const written = await (this.deps.activity?.sent(network, pending, built) ?? Promise.resolve()).then(
      () => true,
      () => false,
    );
    if (written) {
      // Its history is written: nothing is left to write once it lands (RecordedTx `summary`).
      await this.update(network, built.index, (s) => {
        const t = s.txs.find((x) => x.txHash === built.txHash);
        if (t) delete t.summary;
      }).catch(() => undefined);
    } else {
      // Written once it's seen on chain (noteLanded), which the runs look for (independent review M7).
      await this.deps.alarm?.start();
    }
    return pending;
  }

  /**
   * Writes the private history of each of `s`'s returns whose history isn't
   * written yet (Koios didn't answer, or a lock or a restart cut the send
   * off), once the chain has it (settled: confirmed), or a copy of it built
   * again, from the summary kept with it (independent review M7). Without
   * it, what it brought back would read as money received, which a funding
   * or a mint takes first, tying the sessions together. Written before the
   * summary goes: a second write only writes it again. Returns the record as
   * saved.
   */
  private async noteLanded(network: NetworkName, s: SessionRecord): Promise<SessionRecord> {
    const written = new Set<string>();
    for (const t of s.txs) {
      if (!t.confirmed || !t.summary) continue;
      const pending: PendingTx = { kind: "session-back", network, txHash: t.txHash, submittedAt: t.at, confirmations: null };
      try {
        await this.deps.activity?.sent(network, pending, t.summary);
        written.add(t.txHash);
      } catch {
        // Tried again at the next reading.
      }
    }
    if (!written.size) return s;
    return this.update(network, s.index, (r) => {
      for (const t of r.txs) if (written.has(t.txHash)) delete t.summary;
    });
  }

  /**
   * Sends a chain through Lovejoin in order, each transaction on the one
   * before's outputs before any is on chain, a window at a time (pumpChain):
   * no more than a few wait in the mempool, since a block takes only three
   * mixes and a submit past what the mempool holds waits longer than Koios
   * answers. This call sends for about a block; the runner's steps and the
   * alarm send the rest (pump), and nothing else happens to the session
   * meanwhile. The chain waits in chrome.storage.session between them.
   * `budgetMs`: how long this call looks for blocks after the first window.
   */
  private async sendChain(network: NetworkName, built: KeptBack, kept: string, budgetMs: number): Promise<PendingTx> {
    const { chain: txs, leaves, txCbor: _txCbor, builtAt: _builtAt, tailOf, ...summary } = built;
    // Another return of the session kept for Send (its page's, Bring everything back's) never takes the place
    // of a chain on its way: its progress, its reservation and its record stay as they are (final review lovejoin-4).
    if (await this.pendingChain(network, built.index)) {
      throw new Error(t("sess.chainSending"));
    }
    // Something it spends went out in another of the wallet's transactions since it was reviewed (a private
    // spend sent meanwhile took the funding change its last transaction merges into): it would stop at that one,
    // after the rest went in, so nothing of it goes, and a new review leaves that out (independent review L18).
    const spent = await this.deps.wallet.withKeys(() => spentSet(this.deps.session));
    if (txs!.some((t) => txInputs(hexBytes(t.txCbor)).some((o) => spent.has(o)))) {
      throw new Error(t("sess.spentSince"));
    }
    let was: Pick<SessionRecord, "chain" | "lovejoinSkipped"> = {};
    await this.update(network, built.index, (s) => {
      was = { ...(s.chain ? { chain: s.chain } : {}), ...(s.lovejoinSkipped ? { lovejoinSkipped: s.lovejoinSkipped } : {}) };
      // A collateral's mix built again goes on with the chain that stopped short of it, which went in (chainSoFar).
      const from = tailOf?.resumes && s.chain ? (s.chain.from ?? s.chain.at) : undefined;
      s.chain = { total: txs!.length, last: txs!.at(-1)!.txHash, at: this.deps.now(), ...(from !== undefined ? { from } : {}) };
      delete s.lovejoinSkipped;
      // A return that comes back directly, its collateral's mix before it: why Lovejoin was left out, as sendBack says.
      if (summary.lovejoinSkipped && !s.mix) s.lovejoinSkipped = summary.lovejoinSkipped;
    });
    const lovejoin = this.deps.lovejoin;
    const start = async () => {
      // Being sent: its change to come and its collateral are the chain's too.
      await lovejoin?.reserve(network, chainOwner(built.index), txs!);
      try {
        // Four boxes a mix go fewer at a time (chainWindow).
        const window = summary.lovejoin?.width === 4 ? { window: chainWindow(4) } : {};
        await this.savePending(network, { txs: txs!, next: 0, flying: [], index: built.index, kept, summary, ...window });
      } catch (e) {
        await lovejoin?.release(network, chainOwner(built.index)).catch(() => undefined);
        throw e;
      }
    };
    // Recorded, sealed, before any of it is sent, and before its progress is where the runner sends it from
    // (independent review L28): what it deposits, mixes and leaves.
    const record = {
      session: built.index,
      progress: this.pendingKey(network, built.index),
      txs: txs!,
      leaves: leaves ?? [],
      boxes: summary.lovejoin?.boxes ?? 0,
      again: !!summary.lovejoin?.again,
      // A Bootstrap (depth 0) makes no mixes: its boxes stay in the pool for other
      // people, held, with no due time, until the user brings them back. A seed
      // from before chunk 34 is depth 0 too, its boxes coming back by themselves.
      ...(summary.lovejoin?.bootstrap ? { bootstrap: true } : summary.lovejoin?.depth === 0 ? { seed: true } : {}),
      // A token pool's boxes, all of them, each leaf named by its pool already; across pools, each token pool's.
      ...(summary.lovejoin?.pool ? { pools: { [summary.lovejoin.pool]: summary.lovejoin.boxes } } : {}),
      ...(summary.lovejoin?.parts ? { pools: tokenShares(summary.lovejoin.parts) } : {}),
      ...(summary.lovejoin?.width === 4 ? { width: 4 as const } : {}),
      // Its boxes wait as long as the return said: a swap's as approved (independent review L21).
      ...(summary.lovejoin?.delay ? { delay: summary.lovejoin.delay as LovejoinDelay } : tailOf?.delay ? { delay: tailOf.delay } : {}),
      // Its collateral's deposit and mix (ChainRecord `tail`).
      ...(summary.collateralTail
        ? {
            tail: {
              pool: summary.collateralTail.pool,
              box: summary.collateralTail.box,
              leaf: summary.collateralTail.leaf,
              ...(tailOf?.deposit ? { deposit: tailOf.deposit } : {}),
              ...(tailOf?.resumes ? { resumes: tailOf.resumes } : {}),
              ...(tailOf?.tries ? { tries: tailOf.tries } : {}),
              ...(tailOf?.landed !== undefined ? { landed: tailOf.landed } : {}),
            },
          }
        : {}),
    };
    try {
      await (lovejoin ? lovejoin.recordChain(network, record, start) : start());
    } catch (e) {
      // It never started: the session says what it said before, not that this chain is on its way.
      await this.update(network, built.index, (s) => {
        if (s.chain?.last !== record.txs.at(-1)!.txHash) return;
        delete s.chain;
        delete s.lovejoinSkipped;
        Object.assign(s, was);
      }).catch(() => undefined);
      throw e;
    }
    await this.deps.alarm?.start();
    await this.pump(network, built.index, budgetMs);
    return {
      kind: "session-back",
      network,
      txHash: built.txHash,
      submittedAt: this.deps.now(),
      confirmations: null,
      chain: { first: txs![0]!.txHash, total: txs!.length },
    };
  }

  /**
   * More of session `index`'s chain, for about a block: sends while fewer
   * than a few wait in the mempool, and marks what's on chain. Once all of it
   * is sent, the return is in the private history. A transaction that can't
   * be sent stops the chain, and says why on the session.
   */
  private async pump(network: NetworkName, index: number, budgetMs = CHAIN_PUMP_MS): Promise<void> {
    const pending = await this.pendingChain(network, index);
    if (!pending) return;
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const id = pending.txs.at(-1)!.txHash;
    let done: boolean;
    try {
      done = await pumpChain(
        pending,
        {
          send: (i, maybeSent) => this.sendStep(network, pending, i, maybeSent),
          // A return through Lovejoin: its deposit and mixes pay or spend boxes, so they're on its pools' feeds
          // (feed.ts), a token pool's on the token pools' feed, as its record names them (watchOf, 1.6.0's release
          // review, DATA-1). Its last transaction pays the private balance and spends no box: never asked here,
          // since pumpChain is done once it's sent, and `landed` watches it on the contract's feed (the release review).
          onChain: async (hashes) => {
            const tried = firstTries(pending, hashes);
            const at = tried?.length ? Math.min(...tried) : undefined;
            const how = await this.watchOf(network, hashes);
            const watched = hashes.map((txHash) => ({ txHash, ...how.get(txHash), ...(at !== undefined ? { sentAt: at } : {}) }));
            const { statuses } = await chainStatus(this.deps, network, watched);
            const on = new Set(hashes.filter((h) => statuses.get(h) != null));
            if (on.size) {
              await this.update(network, index, (s) => {
                for (const t of s.txs) {
                  if (!on.has(t.txHash)) continue;
                  t.confirmed = true;
                  delete t.unsent;
                  delete t.sending;
                }
              });
            }
            // Marked so here, its deposit never reaches `landed`: told here instead (MERGED-5).
            for (const t of pending.txs) {
              if (t.kind === "deposit" && on.has(t.txHash)) await this.deps.lovejoin?.landedDeposit(network, t.txHash).catch(() => undefined);
            }
            return on;
          },
          save: () => this.keepPending(network, pending),
          sleep,
          now: this.deps.now,
          witness: (i) => this.witnessTail(network, pending, i),
        },
        budgetMs,
      );
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      // Said on the session, where its page shows it in full: here, once the chain has stopped, not when one
      // send gave up, which pumpChain may yet get past (independent review L25).
      await this.update(network, index, (s) => {
        if (s.chain) s.chain.stopped = why;
      }).catch(() => undefined);
      // Recorded as stopped before its progress goes: never taken for one a lock cut, unless one did (ChainGone).
      await this.deps.lovejoin?.chainEnded(network, id, why, undefined, e instanceof ChainGone).catch(() => undefined);
      await this.dropPending(network, index);
      await this.deps.lovejoin?.release(network, chainOwner(index)).catch(() => undefined);
      throw e;
    }
    if (!done) return;
    await this.deps.lovejoin?.chainEnded(network, id);
    await this.dropPending(network, index);
    await this.deps.lovejoin?.release(network, chainOwner(index));
    const last: PendingTx = {
      kind: "session-back",
      network,
      txHash: pending.txs.at(-1)!.txHash,
      submittedAt: this.deps.now(),
      confirmations: null,
    };
    const written = await (this.deps.activity?.sent(network, last, pending.summary) ?? Promise.resolve()).then(
      () => true,
      () => false,
    );
    // Written: nothing is left to write once it lands. Otherwise its summary stays with it, and it's written
    // once the chain shows it (noteLanded, final review F3), as a direct return's is.
    if (written) {
      await this.update(network, index, (s) => {
        const t = s.txs.find((x) => x.txHash === last.txHash);
        if (t) delete t.summary;
      }).catch(() => undefined);
    } else {
      await this.deps.alarm?.start();
    }
  }

  /**
   * Sends a chain's transaction `i`, trying again when Koios didn't answer or
   * hasn't caught up (chainRetryMs), and tells Lovejoin, which sets the
   * boxes' withdraws once the deposit is in (boxes mixed again wait afresh
   * once their first mix is in). `maybeSent`: it may be in the mempool
   * already (pumpChain).
   */
  private async sendStep(network: NetworkName, pending: PendingChain, i: number, maybeSent = false): Promise<void> {
    const step = pending.txs[i]!;
    const bytes = hexBytes(step.txCbor);
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const tries = { busy: 0, spent: 0, maybeSent };
    // The return, the chain's last, carries its summary, as a direct return does: a lock, a closed browser or
    // retries that ran out may stop the chain before pump writes its history, and it may land all the same.
    // It's written once the chain shows it (noteLanded, final review F3).
    const back = i === pending.txs.length - 1 ? pending.summary : undefined;
    const summary = back && { index: back.index, lovelace: back.lovelace, tokens: back.tokens, fee: back.fee };
    for (;;) {
      try {
        // What was kept for Send is the chain, under its return's hash.
        await this.sendRecorded(network, pending.index, step.kind, step.txHash, bytes, pending.kept, {
          keptHash: pending.txs.at(-1)!.txHash,
          summary,
        });
        break;
      } catch (e) {
        // Refused while Koios couldn't say whether it's on chain, and it may be: looked for again (final review lovejoin-6).
        if (mayBeIn(tries, e)) break;
        const wait = chainRetryMs(i, tries, e);
        // The chain's stop is said on the session by pump, if it does stop.
        if (wait === undefined) throw e;
        await sleep(wait);
        // Never after a lock and an unlock while it waited: the lock stopped the chain (independent review L14).
        await this.deps.wallet.withKeys(() => this.pendingHere(network, pending));
      }
    }
    await this.deps.lovejoin?.chainSent(network, pending.txs.at(-1)!.txHash, i);
  }

  /**
   * giveme.my's signature on chain `pending`'s collateral's mix, `i`, now that every transaction before it is on chain
   * (pumpChain): false while giveme.my can't give it yet, to be asked again later, each wait twice the one before
   * (TAIL_WITNESS_WAIT_MS): busy or out of reach, or, for GIVEME_BEHIND_MS after the collateral's deposit was found
   * in, behind the chain. A refusal after that, a box it drew that's gone, a network that measures it higher, or
   * TAIL_KEEP_MS gone by stops the chain there; the runner then builds that mix again with fresh boxes, if it may
   * (buildBack's tailChain), or brings the rest back.
   */
  private async witnessTail(network: NetworkName, pending: PendingChain, i: number): Promise<boolean> {
    const lovejoin = this.deps.lovejoin;
    if (!lovejoin) throw new Error(t("lj.notOnNetwork"));
    if (pending.witnessAfter !== undefined && this.deps.now() < pending.witnessAfter) return false;
    const landed = await lovejoin.tailLanded(network, pending.txs.at(-1)!.txHash);
    const waited = this.deps.now() - landed;
    if (waited > TAIL_KEEP_MS) throw new Error(t("lj.tail.tooLong"));
    // What it spends that the wallet sent, all of it on chain by now: the chain's own before it, and its box's deposit
    // (an earlier chain's, where its mix is built again). An Ogmios that doesn't know those yet is only behind.
    const box = pending.summary.collateralTail?.box.txHash;
    const ours = new Set([...pending.txs.slice(0, i).map((x) => x.txHash), ...(box ? [box] : [])]);
    try {
      const finished = await lovejoin.tailWitness(network, pending.txs[i]!.txCbor, ours);
      pending.txs[i] = { ...pending.txs[i]!, txCbor: finished.txCbor, witnessed: true };
      delete pending.witnessAfter;
      delete pending.witnessWait;
      await this.keepPending(network, pending);
      return true;
    } catch (e) {
      if (e instanceof CollateralRefusedError && !e.busy && waited >= GIVEME_BEHIND_MS) throw new Error(t("lj.tail.refused"));
      if (!(e instanceof CollateralError || e instanceof KoiosError)) throw e;
      const [first, most] = TAIL_WITNESS_WAIT_MS;
      pending.witnessWait = pending.witnessWait === undefined ? first : Math.min(pending.witnessWait * 2, most);
      pending.witnessAfter = this.deps.now() + pending.witnessWait;
      await this.keepPending(network, pending);
      return false;
    }
  }

  /** Where session `index`'s chain waits while it's sent. */
  private pendingKey(network: NetworkName, index: number): string {
    return `${SESSION_CHAIN_PREFIX}${network}.${index}`;
  }

  private pendingChain(network: NetworkName, index: number): Promise<PendingChain | undefined> {
    return this.deps.wallet.withKeys(() => this.deps.session.get<PendingChain>(this.pendingKey(network, index)));
  }

  private savePending(network: NetworkName, pending: PendingChain): Promise<void> {
    return this.deps.wallet.withKeys(() => this.deps.session.set(this.pendingKey(network, pending.index), pending));
  }

  /**
   * Keeps session `index`'s chain's progress as it's sent, while it's still
   * where it waits: a lock wiped it (the wallet may be unlocked since), and
   * nothing of it is written back (independent review L14).
   */
  private keepPending(network: NetworkName, pending: PendingChain): Promise<void> {
    return this.deps.wallet.withKeys(async () => {
      await this.pendingHere(network, pending);
      await this.deps.session.set(this.pendingKey(network, pending.index), pending);
    });
  }

  /** Throws ChainGone when `pending` isn't where its session's chain waits anymore. Call it while unlocked. */
  private async pendingHere(network: NetworkName, pending: PendingChain): Promise<void> {
    const kept = await this.deps.session.get<PendingChain>(this.pendingKey(network, pending.index));
    if (kept?.txs?.at(-1)?.txHash !== pending.txs.at(-1)!.txHash) throw new ChainGone();
  }

  private dropPending(network: NetworkName, index: number): Promise<void> {
    return this.deps.wallet.withKeys(() => this.deps.session.remove(this.pendingKey(network, index)));
  }

  /**
   * Records a session's transaction, then submits it, so the record always
   * knows what may be on its way. Its page watches it, not Home's banner.
   * `kept`: where it was kept for Send, cleared once it's sent if that still
   * holds `keptHash` (this transaction, or the chain it's part of). `orders`
   * and `minAmountOut`: a swap's, recorded with it. `after`: what else the
   * record gains once it's sent. `summary`: a return's, recorded with it
   * until its history is written (RecordedTx `summary`).
   */
  private async sendRecorded(
    network: NetworkName,
    index: number,
    kind: SessionTx["kind"],
    txHash: string,
    bytes: Uint8Array<ArrayBuffer>,
    kept: string,
    {
      after,
      keptHash = txHash,
      orders,
      againstPools,
      summary,
      minAmountOut,
    }: {
      after?: (s: SessionRecord) => void;
      keptHash?: string;
      orders?: string[];
      againstPools?: boolean;
      summary?: RecordedTx["summary"];
      minAmountOut?: string;
    } = {},
  ): Promise<PendingTx> {
    const { wallet, session, now } = this.deps;
    const mine = (s: SessionRecord) => s.txs.find((t) => t.txHash === txHash);
    let sentBefore = false;
    // Sent before, and that copy may be on its way: a try Koios didn't answer (its `inputs` recorded then), a cancel
    // or a swap against the pools Koios took (`held`), or a copy given up (`replaced`), which Koios took or a worker
    // stop cut off after the node had it. Read before `replaced` goes, just below (cross-area review X01).
    let unanswered = false;
    await this.update(network, index, (s) => {
      // What this return brings back at once, kept for the finished page (chunk 23's second review, DX-5).
      if (kind === "back" && summary) s.received = { lovelace: summary.lovelace, tokens: summary.tokens };
      const again = mine(s);
      if (again) {
        sentBefore = !again.unsent;
        unanswered = sentBefore && (!!again.inputs || !!again.held || !!again.replaced);
        delete again.unsent;
        again.sending = true;
        // A copy given up, built again byte for byte (the wallet's own cancel has no validity interval): sent again,
        // it's the step's live copy, looked for from now as a copy with a new id would be. Left replaced, it held
        // nothing back, and the runner sent a second cancel beside it (release review C32).
        if (again.replaced) {
          delete again.replaced;
          again.at = now();
        }
        if (summary) again.summary = summary;
      } else {
        // A return's summary goes with it before it's sent: a lock or a restart may cut the send off, and it may
        // land all the same (independent review M7).
        s.txs.push({
          kind,
          txHash,
          at: now(),
          sending: true,
          ...(orders ? { orders } : {}),
          ...(againstPools ? { againstPools } : {}),
          ...(minAmountOut ? { minAmountOut } : {}),
          ...(summary ? { summary } : {}),
        });
      }
    });
    try {
      await this.submit(network, bytes, txHash);
    } catch (e) {
      // Koios didn't answer: it may be on its way, so it's looked for as one Koios took is (lost), and
      // what it spends counts as spent meanwhile, recorded with it to be freed if its step is built again.
      const maybe = maybeSent(e);
      // Sent before, and refused as spending what's spent while Koios couldn't say whether it's on chain: it may
      // be (final review lovejoin-6). And sent before by a try that may be on its way (`unanswered`: Koios didn't
      // answer it, took it, or it was given up): this try failing says nothing of that one. Refused as spent, it
      // may be that very transaction, landed or in a mempool (as the network refuses one it has); turned away (a
      // 429, a node Koios couldn't reach), this one never left. Either way it stays maybe sent, as the wallet's
      // watch keeps a payment (pending.ts, independent review L1): its inputs held (the unanswered try's, kept),
      // its orders looked for, its history written once it lands (final review F11). A copy of its step is built
      // again once it goes unseen (act), as for any it may have sent.
      const unread = (sentBefore && e instanceof SpentUnread) || unanswered;
      await this.update(network, index, (s) => {
        const t = mine(s);
        if (!t) return;
        delete t.sending;
        if (maybe) t.inputs = txInputs(bytes);
        else if (!unread) t.unsent = true;
        // Kept maybe sent, what it spends counts as spent (below). A cancel's, or a swap against the pools', is freed
        // if it's given up again, as for one Koios took (`held`), since it may never land: the fill beat the cancel
        // to the order. A copy a worker stop cut off had nothing recorded to free (cross-area review X01).
        else if (!t.inputs && (kind === "cancel" || t.againstPools)) t.held ??= txInputs(bytes);
      });
      if (maybe || unread) await wallet.withKeys(() => rememberSpent(session, network, bytes));
      // It may land: its history is written once it's seen (noteLanded), which the runs look for, a site's
      // session's too (runAll).
      if ((maybe || unread) && summary) await this.deps.alarm?.start();
      // A return merged into the funding's change, which was spent elsewhere: the kept view of the contract is behind, so read it in full next time.
      if (kind === "back" && e instanceof SpentInputError) await forgetContractView(this.deps, network).catch(() => undefined);
      throw e;
    }
    await this.update(network, index, (s) => {
      const t = mine(s);
      if (t) delete t.sending;
      // Taken, it may still never land: a cancel the fill beats, a swap whose pool someone else's took. What it
      // spends is freed if it's given up (RecordedTx `held`, release review C03).
      if (t && (kind === "cancel" || t.againstPools)) t.held = txInputs(bytes);
      // A step taken, by the user or the runner: the swap goes on from here.
      if (s.auto) delete s.auto.paused;
      after?.(s);
    });
    await wallet.withKeys(async () => {
      await rememberSpent(session, network, bytes);
      await clearKept(session, kept, keptHash);
      // A return spends the funding's change it merges into: the private side is read again. A swap, a
      // cancel or a chain's mix spends only the session's own account, which no balance reading holds.
      // Neither reads the public account again (independent review M8).
      if (kind === "back") await session.set(SESSION_PRIVATE_STALE_PREFIX + network, true);
    });
    return { kind: PENDING_KIND[kind], network, txHash, submittedAt: now(), confirmations: null };
  }

  /** Submits through Koios; a transaction that's on chain already counts as sent. */
  private async submit(network: NetworkName, bytes: Uint8Array<ArrayBuffer>, txHash: string): Promise<void> {
    const koios = this.deps.koios(network);
    try {
      const submitted = await koios.submitTx(bytes);
      // Something went out, and what isn't known: maybe sent, never unsent, as pending.ts keeps a payment so answered.
      if (submitted !== txHash) throw new KoiosBusyError(t("sess.otherTxId", { id: submitted }), true);
    } catch (e) {
      if (!(e instanceof SpentInputError)) throw e;
      await sentAlready(koios, txHash, e);
    }
  }

  private async listNow(network: NetworkName, refresh = false): Promise<SessionView[]> {
    const { wallet, session, now } = this.deps;
    // A chain a lock or a closed browser cut says so at a refresh too, not only at the runs' (cross-area review X03).
    // In the queue, as a refresh is, and before the book is read: it writes the book.
    if (refresh) await this.markCut(network).catch(() => undefined);
    const book = await this.book(network);
    const live = book.sessions.filter((s) => !s.closedAt);
    const keys = await this.accounts(network, book.sessions);
    let holdings: Map<number, KoiosUtxo[]> | undefined;
    if (refresh && live.length) {
      const koios = this.deps.koios(network);
      const spent = await wallet.withKeys(() => spentSet(session));
      const creds = live.map((s) => keys.get(s.index)!.keyHash);
      // As Koios lists them, what this wallet spent included (the close reads that), and less it (shown, built on).
      const listed = await readFresh(spent, () => koios.credentialUtxos(creds), (r) => r, this.deps.sleep);
      const rows = unspent(listed, spent);
      const of = (all: KoiosUtxo[], index: number) => all.filter((r) => r.payment_cred === keys.get(index)!.keyHash);
      holdings = new Map(live.map((s) => [s.index, of(rows, s.index)]));
      for (const [index, held] of holdings) this.seen.set(`${network}:${index}`, held);
      let changed = false;
      let returned = false;
      let resumed = false;
      const waiting = live.flatMap((s) => s.txs.filter((t) => !t.confirmed));
      if (waiting.length) {
        const statuses = await this.landed(network, waiting);
        const on = new Set(waiting.filter((t) => statuses.get(t.txHash) != null).map((t) => t.txHash));
        for (const s of live) {
          returned ||= s.txs.some((t) => t.kind === "back" && !t.confirmed && on.has(t.txHash));
          changed = settle(s, on) || changed;
        }
      }
      // Sessions the restore scan found that end with nothing left: their records go (below).
      const gone = new Set<SessionRecord>();
      for (const s of live) {
        // What the funding, or a top-up, paid is at the account, whatever tx_status knows: it landed. As Koios
        // lists it, what this wallet has spent since included (final review F13).
        const seen = fundingsListed(s, of(listed, s.index));
        if (seen.size) changed = settle(s, seen) || changed;
        // So is a top-up's, and it's never on its way again, whatever spends it next; tx_status's word alone isn't
        // that (1.5.0's release review, C04).
        changed = markListed(s, of(listed, s.index)) || changed;
        // A swap or a mix that was found never funded, or short of a part, whose funding is here after all, runs
        // again: every part of it.
        const arrived = fundingOf(s).every((t) => t.confirmed);
        if (s.auto?.failed && arrived) {
          delete s.auto.failed;
          changed = resumed = true;
        }
        if (s.auto?.paused?.why === "short" && arrived) {
          delete s.auto.paused;
          changed = resumed = true;
        }
        // One in parts found never funded, some of which landed after all, is short: paused as one found short is,
        // for the user to bring back what came, and Stop brings it back (1.6.0's review).
        if (s.auto?.failed && s.parts && !arrived && fundingState(s).state === "short") {
          delete s.auto.failed;
          short(s, now());
          changed = resumed = true;
        }
        for (const t of fundingOf(s)) {
          if (t.missed && t.confirmed) {
            delete t.missed;
            changed = true;
          }
        }
        const last = s.txs.filter((t) => !t.replaced).at(-1)!;
        // Nothing of it to come back: the account as Koios lists it, no copy of
        // a step that may still land (final review sessions-1), Koios showing
        // its funding spent (independent review M4), and no order of its swap
        // that may still pay it, as far as it can tell (independent review
        // L15, D2). A reading that fails leaves it to the next.
        const over = async () =>
          !returnable(s, of(listed, s.index)).length &&
          !mayStillLand(s, now()) &&
          (await this.spentStates(network, ownOuts(s)).then(
            (known) => ownGone(s, known, new Set(of(listed, s.index).map(outpoint)), now()),
            () => false,
          )) &&
          !(await this.ordersOpen(network, s, keys.get(s.index)!.address, true).catch(() => true));
        // Asked once a refresh, whichever end asks: a found session's wait (below) reads the answer it ends on.
        let ends: Promise<boolean> | undefined;
        const isOver = () => (ends ??= over());
        // Brought back, and nothing has arrived since: the session is over, as
        // act closes it. A site's goes on until it's disconnected: the site may
        // pay it later.
        if (!s.site && last.kind === "back" && last.confirmed && (await isOver())) {
          s.closedAt = now();
          changed = true;
        } else if (foundUntouched(s)) {
          // Found by the restore scan, with nothing sent for it from here: emptied elsewhere (the same phrase in
          // another browser), or holding only what a return found no return takes, it's over as its own return would
          // end it. What the scan read there is its funding's `outs`, so Koios must show each spent, or still there
          // and left behind. With nothing left its record goes, as a site's does at Disconnect, and Find leftovers
          // finds the account again if anything reaches it; with something left behind it stays, closed, to point to
          // it (1.5.0's release review, C02).
          // An order of its swap pays the account in the very transaction that spends it (a fill, a refund, another
          // browser's cancel), and a refresh reads the account before the order: a block landing in between, or a
          // Koios backend behind another, reads the account empty and the order spent, and the scan read nothing there
          // to hold the end back. So one whose record holds a swap ends only once its end has held since a refresh
          // LOST_AFTER_MS or more before (`quietAt`, the first to find it so, sealed with it), and any refresh where it
          // doesn't hold starts that again (cross-area review X01). One with no swap waits for nothing that pays it.
          const quiet = s.recovered!.quietAt;
          const ordered = s.txs.some((t) => t.kind === "swap" && !t.unsent);
          if (!(await isOver())) {
            if (quiet !== undefined) {
              delete s.recovered!.quietAt;
              changed = true;
            }
          } else if (ordered && (quiet === undefined || now() - quiet < LOST_AFTER_MS)) {
            if (quiet === undefined) {
              s.recovered!.quietAt = now();
              changed = true;
            }
          } else {
            const there = new Set(of(listed, s.index).map(outpoint));
            const left = (s.leftBehind ?? []).filter((b) => there.has(`${b.txHash}#${b.txIndex}`));
            if (left.length) {
              s.leftBehind = left;
              s.closedAt = now();
            } else gone.add(s);
            changed = true;
          }
        }
      }
      if (gone.size) {
        book.sessions = book.sessions.filter((s) => !gone.has(s));
        for (const s of gone) this.seen.delete(`${network}:${s.index}`);
      }
      if (changed) await this.save(network, book);
      for (const s of live) if (s.txs.some((t) => t.confirmed && t.summary)) await this.noteLanded(network, s);
      // What came back is in the private balance: its side is read again, not the account's (independent review M8).
      if (returned) await wallet.withKeys(() => session.set(SESSION_PRIVATE_STALE_PREFIX + network, true));
      if (resumed) await this.deps.alarm?.start();
    }
    const views: SessionView[] = [];
    for (const s of [...book.sessions].reverse()) {
      const utxos = holdings?.get(s.index) ?? this.seen.get(`${network}:${s.index}`);
      const held = await this.stillWaiting(network, s);
      views.push(this.view(network, s, keys.get(s.index)!.address, utxos, await this.backWantsCollateral(network, s, utxos), held));
    }
    return views;
  }

  /**
   * Whether session `s`, brought back by hand and not over, is offered 5 ₳
   * for its return's collateral (backCollateralBuild), by what its account
   * held when last read (`utxos`): its return would go through Lovejoin but
   * for it (1.5.0's release review, C53). Read from the device alone.
   */
  private async backWantsCollateral(network: NetworkName, s: SessionRecord, utxos?: KoiosUtxo[]): Promise<boolean> {
    return !s.closedAt && byHand(s) && !!utxos && (await this.lovejoinWantsCollateral(network, s, utxos));
  }

  /** One session as it is now, with what its account held at the last reading. */
  private async one(network: NetworkName, index: number): Promise<SessionView> {
    const s = (await this.book(network)).sessions.find((r) => r.index === index);
    if (!s) throw new Error(t("sess.noSuchSession"));
    const { address } = (await this.accounts(network, [s])).get(index)!;
    return this.view(network, s, address, this.seen.get(`${network}:${index}`), false, await this.stillWaiting(network, s));
  }

  /**
   * `backCollateral`: its return would go through Lovejoin but for 5 ₳ at its account (backWantsCollateral). `waiting`:
   * its funding's parts still to go (stillWaiting).
   */
  private view(
    network: NetworkName,
    s: SessionRecord,
    address: string,
    utxos?: KoiosUtxo[],
    backCollateral = false,
    waiting = NONE_WAITING,
  ): SessionView {
    const now = this.deps.now();
    // A step's transaction Koios never took isn't shown, nor one that went unseen: it's built again.
    const txs = s.txs.filter((t) => (t.kind === "out" || !t.unsent) && !t.replaced);
    const out = txs[0]!;
    const last = txs.at(-1)!;
    // A funding in parts is funded only once every part landed (the owner's call, 2026-10-21); short of one, what
    // came waits at the account to be brought back, its page says so, and nothing of it runs.
    const parts = s.parts ? fundingState(s, utxos, s.auto ? {} : { now, waiting }) : undefined;
    const funded = parts ? parts.state === "landed" || parts.state === "short" : out.confirmed || !!utxos?.length;
    const neverFunded = parts
      ? parts.state === "never"
      : s.auto
        ? !!out.unsent || !!s.auto.failed
        : !!out.unsent || now - out.at > FAILED_AFTER_MS;
    const cancel = byHand(s) && cancelling(s, now);
    const stage: SessionView["stage"] = s.closedAt
      ? "closed"
      : !funded
        ? neverFunded
          ? "failed"
          : "funding"
        : last.kind === "back" && !last.confirmed
          ? "returning"
          : "open";
    return {
      index: s.index,
      network,
      address,
      createdAt: s.createdAt,
      stage,
      txs: txs.map(
        ({
          unsent: _unsent,
          why: _why,
          sending: _sending,
          replaced: _replaced,
          inputs: _inputs,
          held: _held,
          orders: _orders,
          summary: _summary,
          outs: _outs,
          listed: _listed,
          minAmountOut: _min,
          missed: _missed,
          waits: _waits,
          ...t
        }) => t,
      ),
      ...(parts ? { parts: { landed: parts.landed, total: parts.total, ...(parts.state === "short" ? { short: true as const } : {}) } } : {}),
      ...(s.swap ? { swap: s.swap } : {}),
      holding: utxos ? holdingOf(returnable(s, utxos)) : null,
      ...(s.auto ? { auto: autoView(s.auto, txs, stage, !!s.mix, s.swap) } : {}),
      ...(s.site ? { site: s.site } : {}),
      ...(s.mix ? { mix: s.mix } : {}),
      ...(s.chain ? { chain: chainView(s.chain, txs) } : {}),
      ...(s.lovejoinSkipped ? { lovejoinSkipped: s.lovejoinSkipped } : {}),
      ...leftBehindView(s, utxos),
      // A funding turned away never went out: only then does the page say it never reached the chain, and why,
      // when that's known (chunk 23's second review, DX-5).
      ...(stage === "failed" && out.unsent ? { unsent: true, ...(out.why ? { unsentWhy: out.why } : {}) } : {}),
      // What its return brought back, once it's over (DX-5).
      ...(stage === "closed" && s.received ? { received: s.received } : {}),
      ...(s.recovered ? { recovered: true as const } : {}),
      // Found, with nothing sent for it from here, and waiting to end by itself (`quietAt`, cross-area review X01): its
      // page says so, rather than to bring back what a refresh didn't find (the last review, L4). A mark kept from
      // before this device sent something for it is no wait: only its own return ends it, and no refresh clears it.
      ...(stage === "open" && foundUntouched(s) && s.recovered!.quietAt !== undefined
        ? { settling: true as const }
        : {}),
      // Its page offers 5 ₳ for its cancel's collateral while an order of it is open (cancelCollateralBuild), and
      // none while a cancel of it is on its way, which it says instead (1.5.0's release review, C04); and 5 ₳ for its
      // return's while none waits (backCollateralBuild, C53).
      ...(stage === "open" && cancel ? { cancelling: true as const } : {}),
      ...(stage === "open" && byHand(s) && !cancel && utxos && !holdsCancelCollateral(utxos)
        ? { cancelCollateral: topUpComing(s, utxos, now) ? ("coming" as const) : ("missing" as const) }
        : {}),
      ...(stage === "open" && byHand(s) && !cancel && utxos && backCollateral
        ? { backCollateral: topUpComing(s, utxos, now) ? ("coming" as const) : ("missing" as const) }
        : {}),
    };
  }

  /** A session that isn't over, or why not. */
  private async live(network: NetworkName, index: number): Promise<SessionRecord> {
    const s = (await this.book(network)).sessions.find((r) => r.index === index);
    if (!s) throw new Error(t("sess.noSuchSession"));
    if (s.closedAt) throw new Error(t("sess.sessionOver"));
    return s;
  }

  /** A session that isn't over and runs itself, or why not. */
  private async automatic(network: NetworkName, index: number): Promise<SessionRecord> {
    const s = await this.live(network, index);
    if (!s.auto) throw new Error(t("sess.notAutomatic"));
    return s;
  }

  /** The session's account's UTxOs, fresh, less what this wallet has spent. */
  private async utxosOf(network: NetworkName, keyHash: string): Promise<KoiosUtxo[]> {
    return (await this.listing(network, keyHash)).rows;
  }

  /**
   * The session's account, fresh: as Koios lists it (`listed`, what this
   * wallet spent included), and less what this wallet has spent (`rows`),
   * what's built on and shown.
   */
  private async listing(network: NetworkName, keyHash: string): Promise<{ listed: KoiosUtxo[]; rows: KoiosUtxo[] }> {
    const { wallet, session } = this.deps;
    const koios = this.deps.koios(network);
    const spent = await wallet.withKeys(() => spentSet(session));
    const listed = await readFresh(spent, () => koios.credentialUtxos([keyHash]), (r) => r, this.deps.sleep);
    return { listed, rows: unspent(listed, spent) };
  }

  /**
   * Which of `refs` (`txhash#index`) Koios knows, and whether each is spent
   * (`utxo_info`, which lists spent UTxOs too). No request when there are none.
   */
  private async spentStates(network: NetworkName, refs: string[]): Promise<Map<string, boolean>> {
    if (!refs.length) return new Map();
    const rows = (await this.deps.koios(network).utxoInfo(refs)) as Array<KoiosUtxo & { is_spent?: boolean }>;
    return new Map(rows.map((r) => [outpoint(r), !!r.is_spent]));
  }

  /**
   * Which of a session's transactions `txs` are on chain: its way out and
   * back, and a return through Lovejoin, on the private index's feeds, which
   * name no transaction; a swap or a cancel, which touch only the session's
   * key and the DEX, through tx_status (feed.ts).
   */
  private async landed(network: NetworkName, txs: Array<Pick<SessionTx, "kind" | "txHash" | "at">>): Promise<Map<string, number | null>> {
    // A deposit's and a mix's feeds are their pools' (watchOf): a token pool's never shows in the classic pool's (DATA-1).
    const how = await this.watchOf(network, txs.filter((t) => sessionFeed(t.kind) === "lovejoin").map((t) => t.txHash));
    const watched = txs.map((t) => {
      const feed = sessionFeed(t.kind);
      return { txHash: t.txHash, sentAt: t.at, ...(feed ? { feed } : {}), ...how.get(t.txHash) };
    });
    const { statuses } = await chainStatus(this.deps, network, watched);
    // A deposit on chain went in: a private Bootstrap's then never counts as never landed, whatever a later pool read
    // lists there (lovejoin.ts landedDeposit; the merged fixes' review, MERGED-5). Telling it is never the read's failure.
    for (const t of txs) {
      if (t.kind === "deposit" && statuses.get(t.txHash) != null) await this.deps.lovejoin?.landedDeposit(network, t.txHash).catch(() => undefined);
    }
    return statuses;
  }

  /**
   * How each of `hashes`, a chain's deposits and mixes, is looked for: on the feeds of the pools its chain's
   * record names (lovejoin.ts watchOf); the classic pool's where there's no Lovejoin to ask, as before.
   */
  private async watchOf(network: NetworkName, hashes: string[]): Promise<Map<string, Pick<Watching, "feed" | "pools">>> {
    if (!hashes.length || !this.deps.lovejoin) return new Map(hashes.map((h) => [h, { feed: "lovejoin" as const }]));
    return this.deps.lovejoin.watchOf(network, hashes);
  }

  /**
   * A new session's funding kept under `key` (keepFunding), `first` its first part: a record of each part, before any
   * is sent, and how many there are when there's more than one (`parts`). A part missing from Send's keeping is a
   * stale review, as a funding missing is.
   */
  private async fundingRecords(network: NetworkName, index: number, key: string, first: Kept): Promise<Pick<SessionRecord, "txs" | "parts">> {
    const hashes = first.partHashes?.length ? first.partHashes : [first.txHash];
    const txs: RecordedTx[] = [];
    for (const [i, hash] of hashes.entries()) {
      const kept = i === 0 ? first : await this.deps.wallet.withKeys(() => this.deps.session.get<Kept>(partKey(key, i)));
      if (!kept || kept.txHash !== hash || kept.network !== network) throw new StaleReviewError(t("sess.outNotReady"));
      txs.push(await this.outRecord(network, index, hash, kept.txCbor));
    }
    return { txs, ...(hashes.length > 1 ? { parts: hashes.length } : {}) };
  }

  /**
   * Sends session `record`'s funding, kept under `key`, one part after another, each as Send sends one (script-spend.ts
   * `send`), the last named in Home's banner by the first (`PendingTx.chain`). One turned away is marked unsent, and
   * so is every part after it, which never goes: before the first went, the session never started, as one
   * transaction's funding; after, what went may land, and the runner finds the funding short, for the user to bring
   * back (the owner's call, 2026-10-21). One Koios didn't answer may have gone: the rest wait for nothing, and go
   * unsent too. A part that spends what the one before carried forward, and every part after it, goes once that one
   * is in a block (parts.ts); one of those that won't go is marked unsent then (`partsStopped`).
   */
  private async sendFunding(network: NetworkName, record: SessionRecord, key: string, what: SpendWhat): Promise<PendingTx> {
    const hashes = fundingOf(record).map((t) => t.txHash);
    const total = hashes.length;
    const notSent = (rest: string[]) =>
      rest.length
        ? this.update(network, record.index, (s) => {
            for (const t of fundingOf(s)) {
              if (!rest.includes(t.txHash)) continue;
              t.unsent = true;
              delete t.waits;
            }
          })
        : undefined;
    const split = await splitParts(this.deps, network, key, hashes, "session-out", what, record.index);
    const { goNow } = split;
    // Those held aren't sent yet: no clock runs for them until they go (stillWaiting, partsMayGo, which asks in the
    // queue, so after this). Unmarked, they'd only count from their record, as before.
    const held = hashes.slice(goNow);
    if (held.length) {
      await this.update(network, record.index, (s) => {
        for (const t of fundingOf(s)) if (held.includes(t.txHash)) t.waits = true;
      }).catch(() => undefined);
    }
    let sent: PendingTx | undefined;
    for (const [i, hash] of hashes.slice(0, goNow).entries()) {
      const chain = total > 1 && i === goNow - 1 ? { chain: { first: hashes[0]!, total } } : {};
      // The review's age is checked once, for the whole funding, as Send sends the first (1.6.0's review): a later part
      // goes however long since, as one that waited does.
      const after = i > 0 ? { waited: PARTS_RESERVED + hashes[0]! } : {};
      // With parts still to wait after it, how far the funding went is written ahead and sealed with it (pending.ts), as
      // Send's own parts are: a lock while Koios is asked, which takes what waits, never has Home call the session funded
      // once it lands (1.6.0's release review, 321-parts-worker#0).
      const more = i === goNow - 1 && goNow < total ? { parts: { sent: goNow, total } } : {};
      try {
        sent = await send(this.deps, network, hash, partKey(key, i), "session-out", what, { ...chain, ...after, ...more });
      } catch (e) {
        await unsplit(this.deps, network, split);
        await this.markUnsent(network, record.index, hash, e);
        await notSent(hashes.slice(i + 1));
        if (i === 0 || isTrap(e)) throw e;
        throw new Error(t("worker.parts.fundingPartly", { sent: i, total, why: e instanceof Error ? e.message : String(e) }));
      }
      // The last that goes now may be maybe sent: what waits for it waits for the chain to show it anyway.
      if (sent.maybeSent && i < goNow - 1) {
        await unsplit(this.deps, network, split);
        await notSent(hashes.slice(i + 1));
        throw new Error(t("worker.parts.fundingPartlyMaybe", { sent: i + 1, total }));
      }
    }
    if (goNow === total) return sent!;
    await holdWaiting(this.deps, network, key, split, "session-out", what, record.index);
    return { ...sent!, parts: { sent: goNow, total } };
  }

  /**
   * A session's funding whose parts that waited for the one before won't all go (parts.ts: one turned away, the one
   * before never showed, or the session said no: partsMayGo): those not sent are marked unsent, so its funding is
   * short at once (fundingState) and its page offers to bring back what came, rather than once the runner misses
   * them; a stopped one brings it back. In the queue, as every write of the book is: Home's poll pumps the parts beside
   * it, and of two saves that overlap, one would be lost (1.6.0's review).
   */
  partsStopped(network: NetworkName, w: Waiting): Promise<void> {
    const index = w.session;
    if (index === undefined) return Promise.resolve();
    const rest = w.hashes.slice(w.sent);
    return this.serial(async () => {
      await this.update(network, index, (s) => {
        for (const t of fundingOf(s)) {
          if (!rest.includes(t.txHash)) continue;
          t.unsent = true;
          delete t.waits;
        }
      });
    });
  }

  /**
   * Whether the part of `w` whose turn it is may go (parts.ts asks before it sends each that waited). Not for a session
   * whose funding it is that the user stopped, that's over or failed, or whose return is built or on its way: what came
   * is brought back, and the rest would only need another return, and their fees (1.6.0's review). parts.ts stops them
   * then, and tells the session (partsStopped). Nor for one the wallet no longer keeps: nothing would read its account.
   * A session's goes otherwise, its clock starting as it goes (`waits`). A Send's parts always go, asking nothing of the
   * sessions: a book that won't open, or a step that holds the queue, never holds them (the merged fixes' review).
   */
  partsMayGo(network: NetworkName, w: Waiting): Promise<boolean> {
    if (w.session === undefined) return Promise.resolve(true);
    return this.serial(async () => {
      const first = w.hashes[0];
      const s = (await this.book(network)).sessions.find((r) => fundingOf(r).some((t) => t.txHash === first));
      if (!s) return false;
      if (s.closedAt || s.auto?.stopping || s.auto?.failed || (await this.returning(network, s))) return false;
      const going = w.hashes[w.sent];
      await this.update(network, s.index, (r) => {
        const t = fundingOf(r).find((x) => x.txHash === going);
        if (!t) return;
        t.at = this.deps.now();
        delete t.waits;
      });
      return true;
    });
  }

  /**
   * Whether session `s` has a return on its way (sent, or its chain being sent), or built and still sendable: a site's
   * Bring it back, Bring everything back.
   */
  private async returning(network: NetworkName, s: SessionRecord): Promise<boolean> {
    if (s.chain || afterFunding(s).some((t) => RETURNS.has(t.kind) && !t.unsent)) return true;
    if (await this.pendingChain(network, s.index)) return true;
    const { wallet, session, now } = this.deps;
    const [back, claim] = await wallet.withKeys(() =>
      Promise.all([session.get<KeptBack>(SESSION_BACK), session.get<KeptBack[]>(SESSION_CLAIM)]),
    );
    const sendable = (k: KeptBack | undefined) => !!k && k.network === network && k.index === s.index && now() - k.builtAt <= BUILT_TTL_MS;
    return sendable(back) || (claim ?? []).some(sendable);
  }

  /**
   * Session `s`'s funding parts that wait for the one before them to be in a block, by hash: held (`waits`), and still
   * to go as the parts' record has them (parts.ts `partsOf`). Not sent yet, they're neither late nor missed. One the
   * record no longer has (a lock wiped it, and nothing sends it) is none.
   */
  private async stillWaiting(network: NetworkName, s: SessionRecord): Promise<ReadonlySet<string>> {
    const funding = fundingOf(s);
    if (!s.parts || !funding.some((t) => t.waits)) return NONE_WAITING;
    const parts = await partsOf(this.deps, network, funding[0]!.txHash);
    if (!parts || parts.stopped) return NONE_WAITING;
    return new Set(funding.slice(parts.sent).filter((t) => t.waits && !t.unsent).map((t) => t.txHash));
  }

  /**
   * A new session's funding, or a top-up, as its record has it before it's
   * sent: with what it pays account `index` (`outs`, independent review M4).
   */
  private async outRecord(network: NetworkName, index: number, txHash: string, txCbor: string): Promise<RecordedTx> {
    const { keyHash } = (await this.accounts(network, [{ index }])).get(index)!;
    const outs = paysAccount(txCbor, txHash, keyHash);
    return { kind: "out", txHash, at: this.deps.now(), ...(outs ? { outs } : {}) };
  }

  /**
   * Each session's address and payment key hash: its own stake key's address,
   * or, for a session from before, the shared staking part's. Koios is asked
   * by the payment key hash, which finds both.
   */
  private accounts(
    network: NetworkName,
    sessions: Array<Pick<SessionRecord, "index" | "ownStake">>,
  ): Promise<Map<number, { address: string; keyHash: string }>> {
    const { wasm, wallet } = this.deps;
    const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;
    return wallet.withKeys(
      (keys) =>
        new Map(
          sessions.map(({ index, ownStake }) => [
            index,
            {
              address: ownStake ? keys.oneTime.address(net, index) : keys.oneTime.sharedStakeAddress(net, index),
              keyHash: keys.oneTime.keyHash(index),
            },
          ]),
        ),
    );
  }

  /**
   * The index for a new session: the book's next, moved past any the chain
   * has seen used. The book is only on this device, so a restored wallet, one
   * removed and restored, or the same phrase in another browser starts again
   * at 0; taking its index blindly would put two sessions on one key and link
   * them on chain. Every session since chunk 15b has its own stake key (2/i),
   * and any payment to its address carries it, so an `account_addresses`
   * request says whether an index was ever paid. (Sessions from before then
   * used a shared stake part: a few on preprod, from before any release.)
   *
   * `next` is asked about alone: the one stake address its funding is about
   * to put on chain anyway. A window of them would show Koios the stake keys
   * of sessions to come, and successive windows overlap, tying every session
   * the wallet opens together, whatever the IP address.
   * Only once `next` turns out used does it ask about INDEX_PROBE more at a
   * time. It's asked again just before the funding is sent (stillUnused).
   */
  private async freshIndex(network: NetworkName): Promise<number> {
    const { wasm, wallet } = this.deps;
    const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;
    for (let first = (await this.book(network)).next, size = 1; ; first += size, size = INDEX_PROBE) {
      const probe = await wallet.withKeys((keys) =>
        Array.from({ length: size }, (_, i) => ({ index: first + i, reward: keys.oneTime.rewardAddress(net, first + i) })),
      );
      const used = await this.deps.koios(network).usedStakeAddresses(probe.map((p) => p.reward));
      const fresh = probe.find((p) => !used.has(p.reward));
      if (fresh) return fresh.index;
    }
  }

  /**
   * Asks the chain again, just before a new session's funding is recorded
   * and sent, whether one-time account `index` is still unused (independent
   * review M13): its stake key on any address (`account_addresses`, as
   * freshIndex asks), and anything at its payment key. Review found it
   * unused, but its funding may wait up to 10 minutes for Send, and
   * meanwhile the same phrase in another browser, or a wallet removed and
   * restored, may have funded a session of its own there. A new review
   * takes the next unused one: a used one moves the record's `next` past
   * it, since freshIndex asks only about its stake key, and would otherwise
   * give it again when only its payment key shows it. Only what's on chain,
   * as Koios has it, shows: two browsers funding sessions at about the same
   * time can still share an account.
   */
  private async stillUnused(network: NetworkName, index: number): Promise<void> {
    const { wasm, wallet } = this.deps;
    const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;
    const { reward, keyHash } = await wallet.withKeys((keys) => ({
      reward: keys.oneTime.rewardAddress(net, index),
      keyHash: keys.oneTime.keyHash(index),
    }));
    const koios = this.deps.koios(network);
    if ((await koios.usedStakeAddresses([reward])).has(reward) || (await koios.credentialUtxos([keyHash])).length) {
      // Used on chain, so skipping it is always safe. The record as it is now, after Koios answered.
      const book = await this.book(network);
      if (book.next <= index) await this.save(network, { ...book, next: index + 1 });
      throw new StaleReviewError(t("sess.indexUsed"));
    }
  }

  private async book(network: NetworkName): Promise<Book> {
    return (await this.deps.store.get<Book>(`sessions.${network}`)) ?? { next: 0, sessions: [] };
  }

  private save(network: NetworkName, book: Book): Promise<void> {
    return this.deps.store.set(`sessions.${network}`, book);
  }

  /** Changes one session's record, and returns it as saved. */
  private async update(network: NetworkName, index: number, change: (s: SessionRecord) => void): Promise<SessionRecord> {
    const book = await this.book(network);
    const s = book.sessions.find((r) => r.index === index);
    if (!s) throw new Error(t("sess.noSuchSession"));
    change(s);
    await this.save(network, book);
    return s;
  }

  /**
   * What removing the wallet would leave at this network's one-time
   * accounts, from the sealed book alone (no Koios request): each session
   * not closed, unless its funding was turned away, and each closed one with
   * something no return takes left at its account (independent review M5).
   * A restore's scan finds their money again, but not what each was for: a
   * swap's approval, a site's connection, a mix's chain.
   */
  async atStake(network: NetworkName): Promise<AtStake["sessions"]> {
    const book = await this.book(network);
    return book.sessions
      .filter((s) => (s.closedAt ? !!s.leftBehind?.length : !s.txs[0]?.unsent))
      .map((s) => ({
        index: s.index,
        kind: s.site ? "site" : s.mix ? "mix" : s.recovered ? "found" : "swap",
        ...(s.site ? { origin: s.site.origin } : {}),
        ...(s.closedAt ? { leftBehind: true } : {}),
      }));
  }

  /**
   * Clears mix sessions `indexes` from Lovejoin's Your mixes (the owner's test of 1.6.0): a mark on each record, which
   * the hub's list alone reads. Only one that's over, closed or its funding turned away: one still running, or whose
   * funding may yet land, keeps its card.
   */
  clearMixes(network: NetworkName, indexes: number[]): Promise<void> {
    return this.serial(async () => {
      if (!indexes.length) return;
      const asked = new Set(indexes);
      const book = await this.book(network);
      let changed = false;
      for (const s of book.sessions) {
        if (!s.mix || s.mix.cleared || !asked.has(s.index) || !(s.closedAt || s.txs[0]?.unsent)) continue;
        s.mix = { ...s.mix, cleared: true };
        changed = true;
      }
      if (changed) await this.save(network, book);
    });
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

/**
 * Clears `key`, where a transaction was kept for Send, only while it still
 * holds `txHash` (or, Bring everything back's list, the entry that does):
 * the runner's return of one session, or the rest of a chain being sent,
 * never clears a return the user is reviewing for another. Call it while
 * unlocked.
 */
async function clearKept(session: ScriptSpendDeps["session"], key: string, txHash: string): Promise<void> {
  const held = await session.get<{ txHash?: string } | Array<{ txHash: string }>>(key);
  if (Array.isArray(held)) {
    const rest = held.filter((k) => k.txHash !== txHash);
    if (rest.length === held.length) return;
    await (rest.length ? session.set(key, rest) : session.remove(key));
  } else if (held?.txHash === txHash) {
    await session.remove(key);
  }
}

/**
 * Why a return leaves Lovejoin out, after its chain failed: any failure of
 * Lovejoin's own (the pool, the build, the network's measure) sends the rest
 * back directly, so no return is ever stuck on it. What another try may
 * mend is thrown as it is: Koios not answering, or behind (a stale pool
 * read), and a lock. So is WebAssembly that trapped outside the wallet's
 * queue, which its caller turns into a lock: a page's request as it's
 * answered (sw.ts answerUi), Send's return and Bring everything back alike,
 * and a swap or a mix that runs itself in `step`. Each is told by its type:
 * a lock's words are the user's language, and taken for a failure it would
 * send the session's ADA back unmixed.
 */
function leftOut(e: unknown): string {
  if (e instanceof LovejoinSkipped) return e.reason;
  if (e instanceof KoiosError || e instanceof WalletLocked || isTrap(e)) throw e;
  const message = e instanceof Error ? e.message : String(e);
  return t("sess.skip.warn.chainFailed", { reason: clauseOf(message, true) });
}

/** Names that keep their capital wherever they stand: the glossary's never-translated words, and the browser. */
const NAMED = /^(Seedelf|Lovejoin|Koios|Cardanoscan|Cardano|Minswap|Ogmios|Preprod|Chrome|ADA|UTxO|DRep|CIP-30)/;

/**
 * A message made a clause of another sentence: a chain's failure inside
 * sess.skip.warn.chainFailed, or what WebAssembly wouldn't read inside a
 * pause. Where the language starts a clause in lowercase, as
 * sess.skip.warn.chainFailed itself does in English and Spanish, the
 * message's capital goes; Japanese has none to lose, and a name that starts
 * its sentence (Seedelf Wallet, Koios, Lovejoin) keeps its own in every
 * language. `end`: its full stop goes too, a "." or a "。", for a sentence
 * that ends with one of its own. Exported for its test.
 */
export function clauseOf(message: string, end = false): string {
  const text = end ? message.replace(/[.。]$/, "") : message;
  const start = t("sess.skip.warn.chainFailed", { reason: "" }).charAt(0);
  if (start === start.toUpperCase() || NAMED.test(text)) return text;
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

/**
 * Why a chain can't draw from Lovejoin's pool as a swap's review read it
 * (`room`), at `depth`, in the review's words: under the network's floor, or
 * too few boxes free to mix with. Undefined when it can.
 */
function poolShort(network: NetworkName, room: { others: number; free: number }, depth: number, width: LovejoinWidth = 3): string | undefined {
  const floor = NETWORKS[network].lovejoin?.poolFloor ?? 0;
  if (room.others < floor) return t("sess.skip.warn.poolFloor", { count: room.others, floor });
  const needs = mixesPerBox(depth, width) * (width - 1);
  if (room.free < needs) {
    return t("sess.skip.warn.poolFree", { count: room.free, deep: t("sess.skip.warn.deep", { count: depth }), needs });
  }
  return undefined;
}

/**
 * The spare ADA among a session's UTxOs, as a return through Lovejoin
 * counts it: ADA alone, less its collateral (one of exactly 5 ₳). A token's
 * UTxO, or one carrying a reference script, comes back as it is.
 */
function spareOf(rows: KoiosUtxo[]): bigint {
  const ada = rows.filter((u) => !u.asset_list?.length && !u.reference_script);
  const total = ada.reduce((sum, u) => sum + BigInt(u.value), 0n);
  return ada.some((u) => BigInt(u.value) === SESSION_COLLATERAL) ? total - SESSION_COLLATERAL : total;
}

/**
 * How session `s`'s chain goes (lovejoin.ts ChainWay, chunk 34's 34e): a mix's as wide as it was funded, into its one
 * pool; a swap's as approved, its tokens only into the pools approved (none approved, from before: none); any other
 * return at Settings' width, each token into its most used pool, or `pools`, the pools its review chose (Change).
 * Exported for its test.
 */
export function wayOf(s: SessionRecord | undefined, pools?: Record<string, string | null>): ChainWay {
  if (s?.mix) return { width: s.mix.width ?? 3 };
  const fills = s?.auto?.fills?.length ? { fills: s.auto.fills } : {};
  const approved = s?.auto?.lovejoin;
  if (s?.swap && s.auto) {
    // From before approvals kept a way: three wide, as 1.5.0 went, its tokens back directly (34e's review, 10).
    if (!approved) return { width: 3 };
    const tokens = pools ?? approved.tokens;
    // Its approval followed: no more boxes of a token than its review showed, whatever the fill brought.
    const most = !pools && approved.tokenBoxes ? { most: approved.tokenBoxes } : {};
    return { width: approved.width ?? 3, ...(tokens ? { returns: { tokens, only: !pools, ...fills, ...most } } : {}) };
  }
  return { returns: { ...(pools ? { tokens: pools } : {}), ...fills } };
}

/**
 * The transactions among `arrived` that paid session `s` its swap's fill or refund, which its return may take into a
 * token's pool (chunk 34's 34e): each whose every UTxO at the account holds ADA and the swap's own tokens alone. A
 * stranger's holding any other token beside them is none, so that token never rides into a deposit on the user's
 * ADA, nor past a transaction's size (34e's review, 3).
 */
function fillsOf(s: SessionRecord, arrived: KoiosUtxo[]): string[] {
  const swapped = new Set([s.swap?.tokenIn, s.swap?.tokenOut]);
  const odd = new Set(arrived.filter((u) => (u.asset_list ?? []).some((a) => !swapped.has(a.policy_id + a.asset_name))).map((u) => u.tx_hash));
  return [...new Set(arrived.map((u) => u.tx_hash))].filter((h) => !odd.has(h));
}

/** A chain's token pools' shares of its boxes, by pool (ChainRecord `pools`): the classic pool's are the rest. */
function tokenShares(parts: Array<{ pool?: string; boxes: number }>): Record<string, number> {
  return Object.fromEntries(parts.filter((p) => p.pool).map((p) => [p.pool!, p.boxes]));
}

/** What's left behind at a session's account, as far as the last reading (`utxos`) still has it. */
function leftBehindView(s: SessionRecord, utxos?: KoiosUtxo[]): Pick<SessionView, "leftBehind"> {
  const there = utxos && new Set(utxos.map(outpoint));
  const left = (s.leftBehind ?? []).filter((b) => !there || there.has(`${b.txHash}#${b.txIndex}`));
  return left.length ? { leftBehind: left } : {};
}

/**
 * How far a return's chain through Lovejoin has got: its transactions sent
 * and confirmed, and whether it stopped partway (what was left came back
 * directly, in a return of its own).
 */
function chainView(chain: NonNullable<SessionRecord["chain"]>, txs: RecordedTx[]): NonNullable<SessionView["chain"]> {
  const since = txs.filter((t) => t.at >= chain.at);
  const own = since.filter((t) => t.kind === "deposit" || t.kind === "mix" || t.txHash === chain.last);
  return {
    total: chain.total,
    sent: own.length,
    confirmed: own.filter((t) => t.confirmed).length,
    cut: !own.some((t) => t.txHash === chain.last) && since.some((t) => t.kind === "back"),
    ...(chain.stopped ? { stopped: chain.stopped } : {}),
  };
}

/**
 * Where a swap or a mix that runs itself is at, for its timeline. A mix's
 * chain is its return. `txs`: those shown. The least its order asks for,
 * once one is placed: that copy's own (Review it myself, or a fresh quote,
 * can ask for other than was approved), or, recorded before each kept its
 * own, the swap's as last sent (independent review L24).
 */
function autoView(auto: AutoRecord, txs: RecordedTx[], stage: SessionView["stage"], mix: boolean, swap?: SessionView["swap"]): SessionAuto {
  const has = (kind: SessionTx["kind"], confirmed = false) => txs.some((t) => t.kind === kind && (!confirmed || t.confirmed));
  const order = txs.findLast((t) => t.kind === "swap");
  const placedMinOut = order ? (order.minAmountOut ?? swap?.minAmountOut) : undefined;
  const step: SessionAuto["step"] =
    stage === "closed"
      ? "done"
      : stage === "funding" || stage === "failed" || auto.paused?.why === "short"
        ? "funding"
        : mix || has("back") || has("deposit")
          ? "returning"
          : has("swap", true)
            ? auto.stopping || has("cancel")
              ? "cancelling"
              : "filling"
            : "ordering";
  return {
    step,
    stopping: !!auto.stopping,
    filled: !!auto.filled,
    ...(auto.partly ? { partly: true } : {}),
    ...(auto.refunded ? { refunded: true } : {}),
    // Only while it's still stopping: never on a return, or once it's over (independent review L16).
    ...(auto.orderOpen !== undefined && step === "cancelling" ? { orderOpen: auto.orderOpen } : {}),
    approvedMinOut: auto.approved.minAmountOut,
    ...(order?.againstPools ? { againstPools: true } : {}),
    // Approved against the pools, and no swap shown yet: the timeline's words for it, before it's sent (release
    // review C13). Never Stop's: Stop stays until the swap goes out (`againstPools`, from the swap sent).
    ...(auto.approved.againstPools && !order ? { approvedPools: true } : {}),
    ...(placedMinOut ? { placedMinOut } : {}),
    ...(auto.paused ? { paused: auto.paused } : {}),
    ...(auto.retry
      ? {
          retry: {
            at: auto.retry.at,
            error: auto.retry.error,
            ...(auto.retry.reason ? { reason: auto.retry.reason } : {}),
            ...(auto.retry.cbor ? { cbor: auto.retry.cbor } : {}),
          },
        }
      : {}),
    ...(auto.unlockWait !== undefined ? { waitsUntil: auto.unlockWait } : {}),
    ...(auto.direct !== undefined ? { direct: auto.direct } : {}),
  };
}

/**
 * What a swap's order did, once it's spent, by what arrived at the account
 * from transactions the session didn't make (`arrived`, independent review
 * M18). For a token: filled when it came, at least what the order asked
 * for, and none of what it gave came back; refunded when none of it came;
 * partly, between the two: a route split between DEXes whose orders went
 * different ways. For ADA, which every order's deposit brings back filled
 * or not, by what it gave instead: filled when none came back, refunded
 * when all of it did, partly between. The least asked for is the landed
 * copy's own, else the swap's as last sent.
 */
function outcomeOf(s: SessionRecord, arrived: KoiosUtxo[]): "filled" | "partly" | "refunded" {
  const swap = s.swap;
  if (!swap) return "filled";
  const got = (id: string) =>
    arrived
      .flatMap((u) => u.asset_list ?? [])
      .filter((a) => a.policy_id + a.asset_name === id)
      .reduce((sum, a) => sum + BigInt(a.quantity), 0n);
  const back = swap.tokenIn === "lovelace" ? 0n : got(swap.tokenIn);
  if (swap.tokenOut !== "lovelace") {
    const out = got(swap.tokenOut);
    if (out === 0n) return "refunded";
    const landed = s.txs.find((t) => t.kind === "swap" && t.confirmed && !t.replaced);
    return out < BigInt(landed?.minAmountOut ?? swap.minAmountOut) || back > 0n ? "partly" : "filled";
  }
  if (back === 0n) return "filled";
  return back >= BigInt(swap.amount) ? "refunded" : "partly";
}

/** What a transaction pays anyone but the session: a session from before's own address reads as paid (its stake part is the shared one). */
function paidOut(s: DappTxSummary, address: string): DappTxSummary["paid"] {
  return s.paid.filter((p) => p.address !== address);
}

/**
 * The runner's limit on what Minswap built: what leaves the session's
 * account (`paid`), its fee included, is no more than was funded for the
 * swap. A gift to the treasury is refused before (refuseOddities).
 */
function withinFunding(paid: DappTxSummary["paid"], fee: string, fund: SwapQuote["fund"]): void {
  let lovelace = BigInt(fee);
  const tokens = new Map<string, bigint>();
  for (const p of paid) {
    lovelace += BigInt(p.lovelace);
    for (const t of p.tokens) tokens.set(t.policyId + t.assetName, (tokens.get(t.policyId + t.assetName) ?? 0n) + BigInt(t.quantity));
  }
  if (lovelace > BigInt(fund.lovelace)) throw new Refused(t("sess.refuse.warn.moreAda"));
  for (const [id, quantity] of tokens) {
    const funded = fund.tokens.find((t) => t.policyId + t.assetName === id);
    if (!funded || quantity > BigInt(funded.quantity)) throw new Refused(t("sess.refuse.warn.moreTokens"));
  }
}

/**
 * What WebAssembly reads of an output at a contract (`readDexOrder`, chunk
 * 24 Step 3): whether it's at a DEX order script the wallet can cancel at
 * (`known`), which DEX's, the session's own or not, whether its cancel is
 * signed by the session's stake key too, and where its script is read from.
 * `ours` holds only in a form its script can spend, as far as the read was
 * told it (`form`): never with a script on it, nor a Plutus V1 order's datum
 * held inline (release review C05). `why`: why it can't be the session's
 * whatever its datum says (its form), or why its datum couldn't be read.
 */
export interface DexOrderRead {
  known: boolean;
  protocol: string | null;
  ours: boolean;
  stakeSigns: boolean;
  reference: string | null;
  why: string | null;
}

/**
 * Reads the output at `address` (hex) holding `datum` (CBOR, hex) for the
 * session at `session` (bech32). `form`: whether it holds the datum inline,
 * and carries a script; neither, when not said.
 */
export function dexOrderAt(
  wasm: { readDexOrder(request: string): string },
  network: NetworkName,
  address: string,
  datum: string,
  session: string,
  form: { inline?: boolean; scriptRef?: boolean } = {},
): DexOrderRead {
  const request = { network, address, datum, session, inline: !!form.inline, scriptRef: !!form.scriptRef };
  return JSON.parse(wasm.readDexOrder(JSON.stringify(request))) as DexOrderRead;
}

/** `dexOrderAt` for a UTxO as Koios lists it, in the form it's in. */
function dexOrder(
  wasm: { readDexOrder(request: string): string; cip30Address(address: string): string },
  network: NetworkName,
  row: KoiosUtxo,
  session: string,
): DexOrderRead {
  const form = { inline: !!row.inline_datum, scriptRef: !!row.reference_script };
  return dexOrderAt(wasm, network, wasm.cip30Address(row.address), row.inline_datum?.bytes ?? "", session, form);
}

/**
 * Where a swap Minswap built pays, before the session's key signs it (the
 * runner, or the user's review), from its bytes (`builtOutputs`):
 * - back to the session's own address;
 * - an order: an output at a DEX order script the wallet can cancel at
 *   (`read`, WebAssembly's `readDexOrder` over seedelf-core's `orders.json`,
 *   chunk 24 Step 3): cancelled by the session's own key (its stake key's
 *   for SundaeSwap V3 and Stableswaps, which a session from before each had
 *   its own, `ownStake`, hasn't got), paying the session's address alone, in
 *   a form its script can spend, and under the session's staking part or
 *   none (a V3 order Minswap builds, under Minswap's there: SUNDAE_V3). One
 *   at least;
 * - at most one other output, Minswap's fee, wherever it goes: ADA alone,
 *   and no more than `aggregatorFee` quoted (none on preprod).
 * Anything else is refused, any other contract above all: every order the
 * session places is one the wallet can cancel itself, so Stop always brings
 * the money back. The reader vouches for who cancels an order and whom it
 * pays, not for the rest of its datum: inspect then runs each order's cancel
 * in WebAssembly (`cancelsChecked`, release review C05). An order it can't
 * read, or whose form no script spends (`why`), is one the wallet couldn't
 * cancel, whoever it's for. Which DEX routes it is Minswap's to choose: on
 * mainnet, Minswap is asked to leave out every DEX the wallet doesn't check,
 * and the estimate the order is built from is checked (excludedProtocols,
 * uncheckedProtocols, independent review M17). Nor is an order's minimum
 * read back: it's what the wallet asks Minswap for, and Minswap builds it.
 * Returns the orders' output indexes.
 */
export function checkOrder(
  outputs: BuiltOutput[],
  session: { address: string; keyHash: string; ownStake?: boolean },
  aggregatorFee: bigint,
  read: (o: BuiltOutput) => DexOrderRead,
): number[] {
  // A base address's staking part: bytes 29 to 57, after the header and the payment part.
  const stake = session.address.slice(58, 114);
  // The header's low four bits are its network: 1 is mainnet's.
  const sundae = SUNDAE_V3[session.address.charAt(1) === "1" ? "mainnet" : "preprod"];
  const orders: number[] = [];
  let fee = false;
  outputs.forEach((o, i) => {
    if (o.address === session.address) return;
    // The header's high four bits: 0 to 7 are Shelley addresses, an odd one paying a script.
    const type = Number.parseInt(o.address.charAt(0), 16);
    const script = type <= 7 && type % 2 === 1;
    if (!script && o.address.slice(2, 58) === session.keyHash) {
      throw new Refused(t("sess.refuse.warn.otherStake"));
    }
    const order = script && o.datum ? read(o) : undefined;
    if (order?.known) {
      // Not the session's: read, it's someone else's; unread, or in a form no script spends (`why`), it's one the
      // wallet couldn't cancel, whoever it's for (release review C05).
      if (!order.ours && order.why) throw new Refused(t("sess.refuse.warn.notCancellable"));
      if (!order.ours) {
        throw new Refused(t(order.stakeSigns ? "sess.refuse.warn.sundaeNotOurs" : "sess.refuse.warn.orderNotOurs"));
      }
      // Its cancel is signed by the session's own stake key: the shared one never signs.
      if (order.stakeSigns && !session.ownStake) throw new Refused(t("sess.refuse.warn.sundaeNotOurs"));
      const part = o.address.slice(58, 114);
      const minswaps = o.address.slice(2, 58) === sundae.order && part === sundae.stake;
      if (!(type === 7 || (type === 1 && (part === stake || minswaps)))) {
        throw new Refused(t("sess.refuse.warn.contractOtherStake"));
      }
      orders.push(i);
      return;
    }
    if (!fee && !o.tokens && o.lovelace <= aggregatorFee) {
      fee = true;
      return;
    }
    if (!script) throw new Refused(t("sess.refuse.warn.otherAddress"));
    // A contract the wallet can't cancel an order at: Stop couldn't bring it back.
    throw new Refused(t("sess.refuse.warn.notCancellable"));
  });
  if (!orders.length) throw new Refused(t("sess.refuse.warn.noOrder"));
  return orders;
}

/**
 * What a direct swap spends of anyone else's, before the session's key signs
 * it (chunk 24): its inputs at Danogo's pool script, and a collateral whose
 * owner's key has signed it already, as Minswap's comes, never the
 * session's own (release review C21); and its withdrawals, zero, from that
 * script or a spent pool's staking script. Anything else is refused.
 * Returns how many keys of others signed it, and the spent pools' addresses
 * (hex), one for each pool spent: where `checkDirect` takes them recreated.
 */
function directSpends(
  network: NetworkName,
  tx: Uint8Array,
  at: { spends: string[]; collateral: string[]; others: string[]; foreign: KoiosUtxo[] },
  wasm: { cip30Address(address: string): string },
): { signed: number; pools: string[] } {
  const pool = DANOGO_POOL[network];
  const rows = new Map(at.foreign.map((r) => [outpoint(r), r]));
  // One Koios doesn't know can't be shown to be a pool's.
  if (at.others.some((r) => !rows.has(r))) throw new Refused(t("sess.refuse.warn.spendsOther"));
  // A collateral that's not anyone else's is the session's own: at stake on scripts the wallet never runs, which
  // whoever holds the signed swap could send failing, and the runner's step shows no one.
  if (at.collateral.some((r) => !at.others.includes(r))) throw new Refused(t("sess.refuse.warn.ownCollateral"));
  const witnessed = witnessedKeys(tx);
  // Who may be withdrawn from: the pools' script, and each spent pool's own staking script.
  const stakes = new Set([pool]);
  const signers = new Set<string>();
  const pools: string[] = [];
  for (const ref of at.others) {
    const address = wasm.cip30Address(rows.get(ref)!.address);
    // The header's high four bits: an odd one up to 7 pays a script; 3 is a script under a script's staking part.
    const type = Number.parseInt(address.charAt(0), 16);
    const script = type <= 7 && type % 2 === 1;
    const payment = address.slice(2, 58);
    if (at.spends.includes(ref)) {
      if (!script || payment !== pool) throw new Refused(t("sess.refuse.warn.spendsOther"));
      if (type === 3) stakes.add(address.slice(58, 114));
      pools.push(address);
    }
    if (at.collateral.includes(ref)) {
      if (script || !witnessed.has(payment)) throw new Refused(t("sess.refuse.warn.otherSignature"));
      signers.add(payment);
    }
  }
  for (const w of txWithdrawals(tx)) {
    // A script's reward address starts 0xf0 (a test network) or 0xf1.
    if (w.lovelace !== 0n || w.account.charAt(0) !== "f" || !stakes.has(w.account.slice(2))) {
      throw new Refused(t("sess.refuse.warn.staking"));
    }
  }
  return { signed: signers.size, pools };
}

/**
 * Where a direct swap pays, before the session's key signs it (chunk 24):
 * - back to the session's own address, its proceeds and change;
 * - Danogo's pools, each recreated where it was spent from: `pools`, the
 *   spent pools' addresses (hex), one output for each (release review C22);
 * - at most one other output, Minswap's fee: ADA alone, and no more than
 *   `aggregatorFee` quoted.
 * No order: a route that puts one beside it isn't taken (minswap.ts
 * `outOfPlace`). Anything else is refused. Returns what it pays Minswap.
 */
export function checkDirect(
  outputs: BuiltOutput[],
  session: { address: string; keyHash: string },
  pools: string[],
  aggregatorFee: bigint,
): bigint {
  const left = new Map<string, number>();
  for (const p of pools) left.set(p, (left.get(p) ?? 0) + 1);
  let fee: bigint | undefined;
  for (const o of outputs) {
    if (o.address === session.address) continue;
    const type = Number.parseInt(o.address.charAt(0), 16);
    const script = type <= 7 && type % 2 === 1;
    const recreates = left.get(o.address) ?? 0;
    if (recreates > 0) {
      left.set(o.address, recreates - 1);
      continue;
    }
    if (!script && o.address.slice(2, 58) === session.keyHash) throw new Refused(t("sess.refuse.warn.otherStake"));
    if (fee === undefined && !o.tokens && o.lovelace <= aggregatorFee) {
      fee = o.lovelace;
      continue;
    }
    throw new Refused(t(script ? "sess.refuse.warn.notPool" : "sess.refuse.warn.otherAddress"));
  }
  return fee ?? 0n;
}

/**
 * What a direct swap gives the session, read from the session's own change
 * (chunk 24): at least the approved minimum of what it buys. No batcher
 * holds it to a minimum, so this does. ADA bought comes in less the
 * transaction's fee and Minswap's (`paid`), which the minimum doesn't count:
 * the fee no more than MAX_DIRECT_FEE of it, so one that eats the proceeds
 * reads as what it is (release review C08).
 */
export function checkProceeds(summary: DappTxSummary, quote: Pick<SwapQuote, "ask" | "minAmountOut">, paid: bigint): void {
  const out = quote.ask.tokenOut;
  const fee = BigInt(summary.fee) < MAX_DIRECT_FEE ? BigInt(summary.fee) : MAX_DIRECT_FEE;
  const got =
    out === "lovelace"
      ? BigInt(summary.netLovelace) + fee + paid
      : BigInt(summary.netTokens.find((x) => x.policyId + x.assetName === out)?.quantity ?? "0");
  if (got < BigInt(quote.minAmountOut)) throw new Refused(t("sess.refuse.warn.tooLittle"));
}

/**
 * The limit on a direct swap (chunk 24), the runner's and the user's own
 * review's alike (release review C10): what leaves the session's account,
 * net, its fee included, is no more than was funded (`fund`, as approved for
 * `ask`); its network fee and Minswap's (`paid`) come out of the funded
 * costs, never out of what it swaps or what it gets (release review C08);
 * and no more of a token leaves than was funded. The pools' outputs aren't
 * counted as an order's are: they hold the pools' own.
 */
function withinNet(summary: DappTxSummary, fund: SwapQuote["fund"], ask: Pick<SwapAsk, "amount" | "tokenIn">, paid: bigint): void {
  if (-BigInt(summary.netLovelace) > BigInt(fund.lovelace)) throw new Refused(t("sess.refuse.warn.moreAda"));
  const costs = BigInt(fund.lovelace) - (ask.tokenIn === "lovelace" ? BigInt(ask.amount) : 0n);
  if (BigInt(summary.fee) + paid > costs) throw new Refused(t("sess.refuse.warn.moreAda"));
  for (const x of summary.netTokens) {
    const out = -BigInt(x.quantity);
    if (out <= 0n) continue;
    const funded = fund.tokens.find((f) => f.policyId + f.assetName === x.policyId + x.assetName);
    if (!funded || out > BigInt(funded.quantity)) throw new Refused(t("sess.refuse.warn.moreTokens"));
  }
}

/**
 * What a session's key never signs, whatever Minswap sent or the wallet's
 * own cancel holds (`of`): anything that needs another key, staking or
 * governance (bar a direct swap's collateral, its owner's signature in it
 * already, and its zero withdrawals: `direct`, from directSpends), minting,
 * a spend the wallet can't see, or a gift to the treasury, which no output
 * shows and withinFunding wouldn't count.
 * `stakeSigns`: a cancel of a SundaeSwap V3 order, which the session's stake
 * key signs too, as the order's owner (chunk 24); then both sign, or it's
 * refused, as the cancel couldn't work without it. With certificates,
 * withdrawals and votes refused, its signature only meets a required signer.
 */
function refuseOddities(
  s: DappTxSummary,
  index: number,
  allow: { stake?: boolean; direct?: { signed: number } } = {},
  of: Refused["of"] = "swap",
): void {
  // A direct swap's collateral owner's signature, there already (directSpends), is all else it needs.
  const others = allow.direct?.signed ?? 0;
  if (s.unknownInputs.length || s.othersSign !== others || (!others && !s.complete)) {
    throw new Refused(t("sess.refuse.warn.otherSignature"), of);
  }
  const keys = allow.stake ? [`0/${index}`, "stake"] : [`0/${index}`];
  if (s.signs.length !== keys.length || s.signs.some((k, i) => k !== keys[i])) {
    throw new Refused(t(allow.stake ? "sess.refuse.warn.sundaeCancelKeys" : "sess.refuse.warn.notOnlyKey"), of);
  }
  if (s.unknownInputs.length) throw new Refused(t("sess.refuse.warn.unknownInputs"), of);
  // A direct swap's zero withdrawals, from its DEX's scripts, are checked with its spends (directSpends).
  if (s.certificates.length || (s.withdrawals.length && !allow.direct) || s.votes || s.proposals) {
    throw new Refused(t("sess.refuse.warn.staking"), of);
  }
  if (s.mint.length) throw new Refused(t("sess.refuse.warn.mints"), of);
  if (s.donation && BigInt(s.donation) > 0n) throw new Refused(t("sess.refuse.warn.treasury"), of);
}
