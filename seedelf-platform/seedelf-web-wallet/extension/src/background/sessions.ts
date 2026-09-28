// Private sessions (roadmap chunk 15, step 2): a one-time account funded from
// the private balance, used for a swap through Minswap's aggregator, and
// brought back into the private balance. The public account isn't in any of
// its transactions, though the funding's own inputs lead back to it when they
// were money the user made private (privacy review §2.12).
//
// out     a Seedelf spend (Make public's builder, giveme.my's collateral)
//         pays the session's account twice: the swap with its costs, and
//         5 ₳ as the account's own collateral. The session is recorded
//         before it's sent, so its index is never used twice.
// swap    once that's on chain, Minswap builds the swap for the account
//         (its aggregator takes only a sender); WebAssembly reads it against
//         the session's key alone, and the key signs it. The DEX's batchers
//         fill the order, paying the account.
// cancel  an order that isn't filled is cancelled the same way; the refund
//         comes back to the account.
// back    everything at the account moves into the private balance under
//         fresh registers (the CLI's external sweep), signed by the key.
//
// A swap runs itself (chunk 15b). Sending the funding is the one approval;
// after it, `advance` takes whatever step comes next, from the record and the
// chain, so calling it again is always safe. The session's page calls it, an
// alarm calls it every minute while a swap runs and the wallet is unlocked,
// and unlocking calls it, so an interrupted swap carries on where it was. It
// signs only within the approval: the session's UTxOs, its key alone, no more
// paid out than was funded, paid only to the session, to a script whose datum
// names its key (an order), and to Minswap's quoted fee. The order's minimum
// is what the wallet asks Minswap for, at least the least approved; Minswap
// builds the order, and its minimum isn't read back. Anything else pauses for
// the user. Stop is the user's alone: an order that waits is cancelled, then
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

import { NETWORKS, type NetworkName } from "../networks";
import type {
  DappTxSummary,
  LeftBehindUtxo,
  LeftOutUtxo,
  LovejoinFunding,
  Paid,
  PendingTx,
  SessionAuto,
  SessionBackSummary,
  SessionOrder,
  SessionOutSummary,
  SessionPause,
  SessionTx,
  SessionTxReview,
  SessionView,
  SwapAsk,
  SwapLovejoin,
  SwapQuote,
  SwapSide,
  SwapTokenInfo,
  TokenQuantity,
} from "../shared/rpc";
import { sessionClass } from "../shared/histories";
import { DEFAULT_PREFERENCES } from "../shared/preferences";
import tokenList from "../tokens/list.json";
import { bodyOutpoints, txId, txInputs } from "./cbor";
import { KoiosBusyError, KoiosError, measurable, SpentInputError, type KoiosUtxo } from "./koios";
import { builtOutputs, uncheckedProtocols, type BuiltOutput, type Estimate, type Minswap, type PendingOrder } from "./minswap";
import {
  CHAIN_CUT,
  CHAIN_PUMP_MS,
  chainBoxes,
  chainOwner,
  chainRetryMs,
  checkBoxes,
  LovejoinSkipped,
  mayBeIn,
  mixesPerBox,
  pumpChain,
  secureRandom,
  sentAlready,
  SpentUnread,
  unlockWait,
  type ChainProgress,
  type LovejoinChain,
  type LovejoinService,
} from "./lovejoin";
import { pendingKey } from "./pending";
import { UnreadableRecordError, type PrivateStore } from "./private-store";
import { forgetContractView, readContractView } from "./contract-scan";
import {
  keep,
  measureLocally,
  nothingToSpend,
  readContract,
  send,
  spendable,
  spentHistories,
  type OutRef,
  type ScriptSpendDeps,
} from "./script-spend";
import { forgetSpent, outpoint, readFresh, rememberSpent, reservedSet, spentSet, unspent } from "./spent";
import { SESSION_BALANCES_PREFIX } from "./wallet";

/** chrome.storage.session: a session's funding payment, built and waiting for Send. */
export const SESSION_OUT = "seedelf.session.out";
/** chrome.storage.session: a swap or a cancel Minswap built, read and waiting for Send. */
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
/** Room in the funding for the swap's fee and the change it leaves: it all comes back. */
export const SWAP_MARGIN = 2_000_000n;
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
/** How many one-time accounts a probe for a new session's index asks Koios about once the next is used (freshIndex). */
export const INDEX_PROBE = 20;

export const retryAfterMs = (tries: number) => Math.min(30_000 * 2 ** (tries - 1), 5 * 60_000);

type RecordedTx = SessionTx & {
  /** Koios never took it: turned away, or never sent. One Koios didn't answer may have gone, and isn't marked. */
  unsent?: boolean;
  /** Recorded, and on its way to Koios. */
  sending?: boolean;
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
  /** A swap's orders: its outputs to the DEXes' contracts (`txhash#index`), recorded before it's sent. */
  orders?: string[];
};

/** The steps whose transaction is built again when it goes unseen (a chain's own are sent again as they are). */
const REBUILT: ReadonlySet<SessionTx["kind"]> = new Set(["swap", "cancel", "back"]);

/** A swap that runs itself: what the user approved with the funding, and how it's going. */
interface AutoRecord {
  /** `aggregatorFee`: Minswap's, as quoted; none on sessions from before, which pay it no fee. */
  approved: { minAmountOut: string; fund: SwapQuote["fund"]; aggregatorFee?: string };
  paused?: SessionPause;
  retry?: { at: number; error: string; tries: number };
  /** When the user pressed Stop. */
  stopping?: number;
  /** When the runner saw the order filled. */
  filled?: number;
  /** When the runner found the funding never reached the chain. */
  failed?: number;
  /**
   * Its next step, found as the wallet unlocked, waits until then (ms): a
   * fresh draw inside the stretch the unlock keeps the wallet open, so it
   * doesn't go out the moment the wallet unlocks (privacy review §3.1). Kept
   * if a lock comes first: a later unlock doesn't draw it again, and it goes
   * at the next run after that unlock's, so it never waits for good.
   */
  unlockWait?: number;
  /**
   * How it comes back, as approved (privacy review §4.1): true, directly;
   * false, through Lovejoin, whatever Settings says since. Stop can make it
   * direct. None on a swap from before: as Settings has it.
   */
  direct?: boolean;
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
   * A mix from the Lovejoin tile, rather than a swap: once funded, its boxes
   * go through Lovejoin and the rest comes back, one chain, run by itself.
   * `again`: the wallet's boxes in the pool, mixed again with no deposit;
   * `publicToo`, those a mix from the public account put in too (the user
   * asked). `skipped`: why Lovejoin was left out, when it was.
   */
  mix?: { boxes: number; again?: boolean; publicToo?: boolean; skipped?: string };
  /**
   * The latest return through Lovejoin: how many transactions its chain has,
   * the return last (`last`), and when it began to be sent (`at`), recorded
   * before the first is sent, so its progress shows as they're sent and
   * confirmed. `stopped`: why a transaction of it couldn't be sent, when one
   * couldn't.
   */
  chain?: { total: number; last: string; at: number; stopped?: string };
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
   * way back (all of it left behind): a mix of the boxes again then has no
   * chain to send, so Lovejoin may bring them back meanwhile (independent
   * review H1). Cleared once a return is built again.
   */
  nothingBack?: number;
  closedAt?: number;
}

/** The sealed record: every session on a network, and the next index to use. */
interface Book {
  next: number;
  sessions: SessionRecord[];
}

interface KeptOut {
  network: NetworkName;
  txHash: string;
  txCbor: string;
  seed: string;
  index: number;
  swap: SessionView["swap"];
  approved: AutoRecord["approved"];
  builtAt: number;
}

/** A site's private session's funding, or a top-up of one. */
interface KeptFunding extends SessionOutSummary {
  txCbor: string;
  seed: string;
  /** The site a new session is for; a top-up has none. */
  site?: { origin: string };
  builtAt: number;
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
  builtAt: number;
}

/** A mix session's funding. */
interface KeptMix extends SessionOutSummary {
  txCbor: string;
  seed: string;
  mix: LovejoinFunding;
  builtAt: number;
}

interface KeptBack extends SessionBackSummary {
  txCbor: string;
  builtAt: number;
  /** Through Lovejoin: the whole chain, in order, the return last (`txCbor`, `txHash`). */
  chain?: LovejoinChain["txs"];
  /** And where its boxes end up, mixed all the way. */
  leaves?: LovejoinChain["leaves"];
}

/** A return's chain through Lovejoin being sent, a window at a time, between the runner's steps. */
interface PendingChain extends ChainProgress {
  index: number;
  /** Where the return was kept for Send, cleared once a transaction of it is sent. */
  kept: string;
  /** The return, for the private history once it's all sent. */
  summary: SessionBackSummary;
}

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

/** What Minswap built failed a check: the swap pauses for the user instead of trying again. */
export class Refused extends Error {
  constructor(readonly detail: string) {
    super(`The wallet won't sign what Minswap built: ${detail}`);
  }
}

/** Nothing at a session's account can come back (its `leftBehind` says what's there), so no return is built. */
export class NothingComesBack extends Error {}

/** The fresh quote expects less than the least approved, so the order couldn't fill. */
class PriceMoved extends Error {
  constructor(readonly amountOut: string) {
    super("The price moved past what was approved.");
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
const NO_COLLATERAL = "its 5 ₳ collateral isn't at its account anymore, and the mixes need it";

/** The most funding changes one return merges into (WebAssembly's MAX_MERGE). */
const MAX_MERGE = 4;

/** The most a cancel's fee may be: Minswap's cancel of six orders, each a script spend, costs well under it. */
const MAX_CANCEL_FEE = 3_000_000n;

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
const UNVERIFIED =
  "The token you'd get isn't on the wallet's list or verified by Minswap, so the wallet won't swap into it: anyone can give a token a known token's name.";

/** An ask as the user typed it, checked before Minswap sees it. */
export function checkAsk(ask: SwapAsk): SwapAsk {
  const token = (id: string) => id === "lovelace" || /^[0-9a-f]{56}([0-9a-f]{2}){0,32}$/.test(id);
  if (!/^[1-9][0-9]*$/.test(ask.amount)) throw new Error("Enter an amount to swap.");
  if (!token(ask.tokenIn) || !token(ask.tokenOut)) throw new Error("That isn't a token the wallet can swap.");
  if (ask.tokenIn === ask.tokenOut) throw new Error("Choose two different tokens.");
  if (!(ask.slippage >= 0.1 && ask.slippage <= 20)) throw new Error("Slippage is between 0.1% and 20%.");
  return { amount: ask.amount, tokenIn: ask.tokenIn, tokenOut: ask.tokenOut, slippage: ask.slippage };
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
 * WebAssembly couldn't build a return because what it takes doesn't pay for
 * its own deposit and fee: the session's own too little, or nothing but a
 * stranger's tokens that don't pay their way (api::NOTHING_PAYS).
 */
const TOO_LITTLE = /deposit of these tokens needs at least|insufficient lovelace|Not Enough Lovelace|pays for its own way back/i;

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

/** A step's transaction that's gone: Koios never took it, or the chain never saw it. */
function lost(t: RecordedTx, now: number): boolean {
  return ((t.unsent || t.sending) && now - t.at >= RESEND_AFTER_MS) || now - t.at >= LOST_AFTER_MS;
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

export class SessionService {
  /** One step at a time, the runner's and the user's alike. */
  private queue: Promise<unknown> = Promise.resolve();
  /** When the runner last read each session's chain, by `network:index`. */
  private readAt = new Map<string, number>();
  /** What each session's account held then. */
  private seen = new Map<string, KoiosUtxo[]>();
  /** Tokens Minswap's verified list was found to have, by `network:id`. */
  private verifiedIds = new Set<string>();

  constructor(private readonly deps: SessionDeps) {}

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
      if (!view) throw new Error("There's no such session.");
      if (view.stage !== "failed") throw new Error("Only a session whose funding never reached the chain can be forgotten.");
      const book = await this.book(network);
      // One the wallet is still sending may land yet, into a session no one reads (final review sessions-6).
      if (await this.stillWatched(network, book.sessions.find((s) => s.index === index)!)) {
        throw new Error("Its funding may still reach the chain: the wallet is still sending it. Wait for it, then forget the session.");
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
   * refused here, before anything is funded (final review sessions-4).
   */
  async quote(network: NetworkName, ask: SwapAsk): Promise<SwapQuote> {
    const checked = checkAsk(ask);
    const est = await this.deps.minswap(network).estimate(checked);
    const unchecked = uncheckedProtocols(network, est);
    if (unchecked.length) {
      throw new Error(
        `Minswap routes this swap through ${unchecked.join(" and ")}, whose orders the wallet can't check yet, so it won't swap this way. Try another amount or pair.`,
      );
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
   * none (§2.7); read only when the return would go through it.
   */
  private async lovejoinCost(network: NetworkName, quote: SwapQuote, pool = false): Promise<SwapLovejoin | undefined> {
    if (!this.deps.lovejoin?.available(network)) return undefined;
    const on = await this.throughLovejoin();
    const { price, skipped, depth, delay } = await this.priced(network, pool && on);
    // A token's proceeds come back with its deposit, and aren't spare: tokens never go in.
    const proceeds = quote.ask.tokenOut === "lovelace" ? BigInt(quote.amountOut) + BigInt(quote.deposits) : 0n;
    const filled = price(proceeds + SWAP_MARGIN);
    // Stopped, cancelled or refunded: the funding comes back instead. A token's carries the token, so none of it goes in.
    const stopped = price(quote.ask.tokenIn === "lovelace" ? BigInt(quote.fund.lovelace) : 0n);
    const more = (stopped.of ?? stopped.boxes) > (filled.of ?? filled.boxes);
    return { ...filled, depth, delay, on, ...(skipped ? { skipped } : {}), ...(more ? { ifStopped: stopped } : {}) };
  }

  /**
   * What spare ADA at a session's account pays for through Lovejoin at the
   * set depth (`price`): its boxes, at most what one chain takes
   * (chainBoxes: MAX_CHAIN_MIXES, and what one deposit makes), their mixes
   * (WebAssembly's MIX_FEE_ESTIMATE each) and about what bringing them back
   * takes. `pool`: also as Lovejoin's pool has room for now (room, a read
   * kept five minutes), `of` the boxes the ADA pays for when that's fewer,
   * and `skipped`, why it has none.
   */
  private async priced(network: NetworkName, pool: boolean) {
    const lovejoin = this.deps.lovejoin!;
    // What each box more takes, and what the chain takes besides: the deposit and its change.
    const [one, two] = await Promise.all([lovejoin.funding(network, 1), lovejoin.funding(network, 2)]);
    const perBox = BigInt(two.lovelace) - BigInt(one.lovelace);
    const besides = BigInt(one.lovelace) - perBox;
    const room = pool ? await lovejoin.room(network) : undefined;
    const skipped = room && poolShort(network, room, one.depth);
    const fits = !room ? Infinity : skipped ? 0 : Math.floor(room.free / (mixesPerBox(one.depth) * 2));
    const price = (spare: bigint) => {
      const affordable = spare > besides ? Number((spare - besides) / perBox) : 0;
      const pays = Math.min(affordable, chainBoxes(one.depth));
      const boxes = Math.min(pays, fits);
      return {
        boxes,
        mixes: boxes * one.mixes,
        mixFees: (BigInt(boxes) * BigInt(one.mixFees)).toString(),
        withdrawFees: (BigInt(boxes) * LOVEJOIN_WITHDRAW_ESTIMATE).toString(),
        ...(boxes < pays ? { of: pays } : {}),
      };
    };
    return { price, skipped, depth: one.depth, delay: one.delay };
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

  /** Builds the payment that funds a new session for `quote`: the swap and its costs, and the account's collateral. */
  async outBuild(
    network: NetworkName,
    quote: SwapQuote,
    display?: { in: SwapSide; out: SwapSide },
  ): Promise<SessionOutSummary & { lovejoin?: SwapLovejoin }> {
    const ask = checkAsk(quote.ask);
    if (!(await this.verified(network, ask.tokenOut))) throw new Error(UNVERIFIED);
    const index = await this.freshIndex(network);
    const address = (await this.accounts(network, [{ index, ownStake: true }])).get(index)!.address;
    const { summary, txCbor, seed } = await this.buildFunding(
      network,
      index,
      address,
      [
        { to: address, lovelace: quote.fund.lovelace, tokens: quote.fund.tokens },
        { to: address, lovelace: SESSION_COLLATERAL.toString(), tokens: [] },
      ],
      "Your private balance is empty, so there's nothing to swap from.",
    );
    const swap = { ...ask, amountOut: quote.amountOut, minAmountOut: quote.minAmountOut, ...(display ? { display } : {}) };
    // Sending this is the approval: the swap runs itself within it.
    const approved = { minAmountOut: quote.minAmountOut, fund: quote.fund, aggregatorFee: quote.aggregatorFee };
    const kept: Omit<KeptOut, "builtAt"> & SessionOutSummary = { ...summary, txCbor, seed, index, swap, approved };
    await keep(this.deps, SESSION_OUT, kept);
    // Once, at Review, never as the user types: whether Lovejoin's pool takes the boxes now (privacy review §2.7).
    const lovejoin = await this.lovejoinCost(network, quote, true);
    return { ...summary, ...(lovejoin ? { lovejoin } : {}) };
  }

  /**
   * Builds the payment that funds a new private session for a site (private
   * CIP-30): `lovelace` and `tokens` for it, and the account's own collateral.
   */
  async siteOutBuild(network: NetworkName, origin: string, lovelace: string, tokens: TokenQuantity[]): Promise<SessionOutSummary> {
    const index = await this.freshIndex(network);
    const address = (await this.accounts(network, [{ index, ownStake: true }])).get(index)!.address;
    const { summary, txCbor, seed } = await this.buildFunding(
      network,
      index,
      address,
      [
        { to: address, lovelace, tokens },
        { to: address, lovelace: SESSION_COLLATERAL.toString(), tokens: [] },
      ],
      "Your private balance is empty, so there's nothing to put in a private session.",
    );
    const kept: Omit<KeptFunding, "builtAt"> = { ...summary, txCbor, seed, site: { origin } };
    await keep(this.deps, SESSION_SITE_OUT, kept);
    return summary;
  }

  /** Records the site's private session, then sends its funding. The connector waits for it to arrive. */
  siteOutSubmit(network: NetworkName, txHash: string, origin: string): Promise<{ index: number; pending: PendingTx }> {
    return this.serial(async () => {
      const { wallet, session, now } = this.deps;
      const built = await wallet.withKeys(() => session.get<KeptFunding>(SESSION_SITE_OUT));
      if (!built || built.txHash !== txHash || built.network !== network || built.site?.origin !== origin) {
        throw new Error("That payment isn't ready to send. Review it again.");
      }
      if (now() - built.builtAt > BUILT_TTL_MS) {
        throw new Error("That payment was built more than 10 minutes ago. Review it again.");
      }
      const book = await this.book(network);
      if (built.index < book.next) throw new Error("That session was started already. Start a new one.");
      // Recorded before it's sent: whatever happens next, this index is never used again.
      const record: SessionRecord = {
        index: built.index,
        ownStake: true,
        createdAt: now(),
        txs: [{ kind: "out", txHash, at: now() }],
        site: { origin },
      };
      await this.save(network, { next: built.index + 1, sessions: [...book.sessions, record] });
      try {
        return { index: built.index, pending: await send(this.deps, network, txHash, SESSION_SITE_OUT, "session-out", "payment") };
      } catch (e) {
        await this.markUnsent(network, built.index, txHash, e);
        throw e;
      }
    });
  }

  /**
   * Builds the funding of a new one-time account that mixes `boxes` boxes
   * (the Lovejoin tile, from the private balance): what the boxes and their
   * chain take, and the account's own collateral. Checked against the pool
   * first, so a mix that's sent can go through.
   */
  async mixOutBuild(network: NetworkName, boxes: number): Promise<SessionOutSummary & { mix: LovejoinFunding }> {
    const lovejoin = this.deps.lovejoin;
    if (!lovejoin?.available(network)) throw new Error("Lovejoin isn't on this network yet.");
    checkBoxes(boxes);
    await lovejoin.fits(network, boxes);
    return this.mixFunding(network, await lovejoin.funding(network, boxes));
  }

  /**
   * Mix my boxes again: the funding of a new one-time account that pays for
   * every box of the wallet's in the pool to be fanned out again (as many as
   * the pool has others for), with no deposit, and its own collateral. One at
   * a time: two would spend the same boxes. The boxes a mix from the public
   * account put in only when asked `anyway`: paid from here, they tie the
   * private balance to the account (lovejoin.ts againBoxes).
   */
  async againBuild(network: NetworkName, anyway = false): Promise<SessionOutSummary & { mix: LovejoinFunding }> {
    const lovejoin = this.deps.lovejoin;
    if (!lovejoin?.available(network)) throw new Error("Lovejoin isn't on this network yet.");
    if (await this.mixingAgain(network)) throw new Error("Your boxes are being mixed again already.");
    const { boxes, owned } = await lovejoin.againBoxes(network, anyway);
    return this.mixFunding(network, { ...(await lovejoin.funding(network, boxes, true)), owned, ...(anyway ? { publicToo: true } : {}) });
  }

  /** Whether a mix of the wallet's boxes again may still spend them: Lovejoin withdraws none meanwhile. */
  async mixingAgain(network: NetworkName): Promise<boolean> {
    return (await this.book(network)).sessions.some(mixingAgain);
  }

  /** A mix session's funding, built and kept for Send. */
  private async mixFunding(network: NetworkName, mix: LovejoinFunding): Promise<SessionOutSummary & { mix: LovejoinFunding }> {
    const index = await this.freshIndex(network);
    const address = (await this.accounts(network, [{ index, ownStake: true }])).get(index)!.address;
    const { summary, txCbor, seed } = await this.buildFunding(
      network,
      index,
      address,
      [
        { to: address, lovelace: mix.lovelace, tokens: [] },
        { to: address, lovelace: SESSION_COLLATERAL.toString(), tokens: [] },
      ],
      mix.again ? "Your private balance is empty, so there's nothing to pay for the mixes with." : "Your private balance is empty, so there's nothing to mix.",
    );
    const kept: Omit<KeptMix, "builtAt"> = { ...summary, txCbor, seed, mix };
    await keep(this.deps, SESSION_MIX_OUT, kept);
    return { ...summary, mix };
  }

  /** Records the mix session, then sends its funding. From here it runs itself. */
  mixOutSubmit(network: NetworkName, txHash: string): Promise<{ index: number; pending: PendingTx }> {
    return this.serial(async () => {
      const { wallet, session, now } = this.deps;
      const built = await wallet.withKeys(() => session.get<KeptMix>(SESSION_MIX_OUT));
      if (!built || built.txHash !== txHash || built.network !== network) {
        throw new Error("That mix isn't ready to send. Review it again.");
      }
      if (now() - built.builtAt > BUILT_TTL_MS) throw new Error("That mix was built more than 10 minutes ago. Review it again.");
      const book = await this.book(network);
      if (built.index < book.next) throw new Error("That mix was started already. Start a new one.");
      if (built.mix.again && book.sessions.some(mixingAgain)) throw new Error("Your boxes are being mixed again already.");
      // Recorded before it's sent: whatever happens next, this index is never used again.
      const record: SessionRecord = {
        index: built.index,
        ownStake: true,
        createdAt: now(),
        txs: [{ kind: "out", txHash, at: now() }],
        mix: { boxes: built.mix.boxes, ...(built.mix.again ? { again: true } : {}), ...(built.mix.publicToo ? { publicToo: true } : {}) },
        auto: { approved: { minAmountOut: "0", fund: { lovelace: built.mix.lovelace, tokens: [] } } },
      };
      await this.save(network, { next: built.index + 1, sessions: [...book.sessions, record] });
      let pending: PendingTx;
      try {
        pending = await send(this.deps, network, txHash, SESSION_MIX_OUT, "session-out", "mix");
      } catch (e) {
        await this.markUnsent(network, built.index, txHash, e);
        throw e;
      }
      await this.deps.alarm?.start();
      return { index: built.index, pending };
    });
  }

  /** Builds another payment into a site's private session: `lovelace` and `tokens`, from the private balance. */
  async topUpBuild(network: NetworkName, index: number, lovelace: string, tokens: TokenQuantity[]): Promise<SessionOutSummary> {
    const s = await this.live(network, index);
    if (!s.site) throw new Error("Only a site's private session takes a top-up.");
    const { address } = (await this.accounts(network, [s])).get(index)!;
    const { summary, txCbor, seed } = await this.buildFunding(
      network,
      index,
      address,
      [{ to: address, lovelace, tokens }],
      "Your private balance is empty, so there's nothing to top up with.",
    );
    const kept: Omit<KeptFunding, "builtAt"> = { ...summary, txCbor, seed };
    await keep(this.deps, SESSION_TOP_UP, kept);
    return summary;
  }

  /** Records the top-up built last in its session, then sends it. */
  topUpSubmit(network: NetworkName, txHash: string): Promise<PendingTx> {
    return this.serial(async () => {
      const { wallet, session, now } = this.deps;
      const built = await wallet.withKeys(() => session.get<KeptFunding>(SESSION_TOP_UP));
      if (!built || built.txHash !== txHash || built.network !== network) {
        throw new Error("That top-up isn't ready to send. Review it again.");
      }
      if (now() - built.builtAt > BUILT_TTL_MS) {
        throw new Error("That top-up was built more than 10 minutes ago. Review it again.");
      }
      await this.live(network, built.index);
      await this.update(network, built.index, (s) => {
        s.txs.push({ kind: "out", txHash, at: now() });
      });
      try {
        return await send(this.deps, network, txHash, SESSION_TOP_UP, "session-out", "top-up");
      } catch (e) {
        await this.markUnsent(network, built.index, txHash, e);
        throw e;
      }
    });
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
   * This is the check that matters: Settings disconnects a site with no
   * other. Its index isn't used again, and its record, with the site's
   * origin, goes (unless something is left behind at its account).
   */
  disconnect(network: NetworkName, index: number): Promise<void> {
    return this.serial(async () => {
      const { wallet, session, now } = this.deps;
      let s = await this.live(network, index);
      if (!s.site) throw new Error("This session isn't a site's.");
      if (await this.pendingChain(network, index)) {
        throw new Error("Its return through Lovejoin is still being sent. Wait for it to finish, then disconnect.");
      }
      const koios = this.deps.koios(network);
      const waiting = s.txs.filter((t) => !t.confirmed && !t.unsent);
      if (waiting.length) {
        const statuses = await koios.txStatus(waiting.map((t) => t.txHash));
        const on = new Set(waiting.filter((t) => statuses.get(t.txHash) != null).map((t) => t.txHash));
        if (on.size) s = await this.update(network, index, (r) => void settle(r, on));
        const recent = s.txs.some((t) => !t.confirmed && !t.unsent && now() - t.at <= FAILED_AFTER_MS);
        if (recent || (await this.stillWatched(network, s))) {
          throw new Error("Its last transaction hasn't reached the chain yet. Wait for it, then disconnect.");
        }
      }
      const { keyHash } = (await this.accounts(network, [s])).get(index)!;
      const spent = await wallet.withKeys(() => spentSet(session));
      const rows = await readFresh(spent, () => koios.credentialUtxos([keyHash]), (r) => r, this.deps.sleep);
      if (returnable(s, rows).length) {
        throw new Error("The session's account still holds something. Bring it back first, then disconnect.");
      }
      // Closed, nothing shows a site's session again (the dApps page and
      // Bring everything back take open ones), and which site had one says
      // something about the user: its record goes, `next` keeping its index
      // from being used again (privacy review §3.12). One with something no
      // return takes left at its account (`leftBehind`) stays, closed, to
      // point to it.
      const book = await this.book(network);
      const closing = book.sessions.find((r) => r.index === index)!;
      if (closing.leftBehind?.length) closing.closedAt = now();
      await this.save(network, {
        ...book,
        sessions: closing.leftBehind?.length ? book.sessions : book.sessions.filter((r) => r !== closing),
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
    if (!s.site) throw new Error("This session isn't a site's.");
    const { address, keyHash } = (await this.accounts(network, [s])).get(index)!;
    const { wasm, wallet } = this.deps;
    const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;
    const reward = await wallet.withKeys((keys) => keys.oneTime.rewardAddress(net, index));
    return { address, reward, keyHash };
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
    if (maybeSent(e)) return;
    await this.update(network, index, (s) => {
      const t = s.txs.find((r) => r.txHash === txHash);
      if (t) t.unsent = true;
    });
  }

  /**
   * A funding payment into `address` from the private balance (Make public's
   * builder), measured and ready for Send. It takes received money, or a box
   * back from Lovejoin that pays alone, first, and money another session
   * left last; session `index`'s own (a top-up's) first of all (privacy
   * review §2.3).
   */
  private async buildFunding(
    network: NetworkName,
    index: number,
    address: string,
    payments: Array<{ to: string; lovelace: string; tokens: TokenQuantity[] }>,
    empty: string,
  ): Promise<{ summary: SessionOutSummary; txCbor: string; seed: string }> {
    const { wasm } = this.deps;
    const { view, utxos, params, returning, classes } = await readContract(this.deps, network);
    if (!utxos.length) throw nothingToSpend(this.deps, view, empty, returning);
    type Finished = Omit<SessionOutSummary, "network" | "payments" | "inputs" | "index" | "address" | "histories"> & {
      txCbor: string;
      seed: string;
      payments: Array<Paid & { to: string }>;
      inputs: OutRef[];
      classesMixed: string[];
    };
    const request = { network, params, utxos, payments, classes, funding: { session: sessionClass(index).id } };
    const finished = await measureLocally<Finished>(this.deps, request, (keys, r) => wasm.buildWithdraw(keys.seedelf, r));
    const { txCbor, seed, inputs, payments: paid, classesMixed, ...rest } = finished;
    const histories = spentHistories(classes, inputs, classesMixed);
    // Its change is this session's from now on (activity.ts), whatever paid for it.
    const summary: SessionOutSummary = {
      ...rest,
      network,
      index,
      address,
      payments: paid.map(({ to, ...p }) => ({ address: to, own: false, ...p })),
      inputs: inputs.length,
      ...(histories ? { histories } : {}),
    };
    return { summary, txCbor, seed };
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
      if (!built || built.txHash !== txHash || built.network !== network) {
        throw new Error("That payment isn't ready to send. Review it again.");
      }
      if (now() - built.builtAt > BUILT_TTL_MS) {
        throw new Error("That payment was built more than 10 minutes ago. Review it again.");
      }
      const book = await this.book(network);
      if (built.index < book.next) throw new Error("That session was started already. Start a new one.");
      // Where Lovejoin is, how it comes back is kept with it.
      const back = this.deps.lovejoin?.available(network) ? { direct: direct ?? !(await this.throughLovejoin()) } : {};
      // Recorded before it's sent: whatever happens next, this index is never used again.
      const record: SessionRecord = {
        index: built.index,
        ownStake: true,
        createdAt: now(),
        txs: [{ kind: "out", txHash, at: now() }],
        swap: built.swap,
        auto: { approved: built.approved, ...back },
      };
      await this.save(network, { next: built.index + 1, sessions: [...book.sessions, record] });
      let pending: PendingTx;
      try {
        pending = await send(this.deps, network, txHash, SESSION_OUT, "session-out", "payment");
      } catch (e) {
        await this.markUnsent(network, built.index, txHash, e);
        throw e;
      }
      await this.deps.alarm?.start();
      return pending;
    });
  }

  /** Has Minswap build the session's swap, freshly quoted, and reads it against the session's key. */
  async swapBuild(network: NetworkName, index: number): Promise<SessionTxReview> {
    const s = await this.live(network, index);
    if (!s.swap) throw new Error("This session isn't for a swap.");
    if (s.txs.some((t) => t.kind === "swap" && !t.unsent)) throw new Error("This session's swap was sent already.");
    const { address, keyHash } = (await this.accounts(network, [s])).get(index)!;
    const rows = await this.utxosOf(network, keyHash);
    if (!rows.length) throw new Error("The session's account holds nothing yet: wait for its funding to confirm.");
    const minswap = this.deps.minswap(network);
    const ask = checkAsk(s.swap);
    const est = await minswap.estimate(ask);
    const txCbor = await minswap.buildTx(address, est.min_amount_out, ask);
    return this.review(network, s, "swap", txCbor, rows, { quote: quoteOf(network, ask, est) });
  }

  /** The session's orders that aren't filled yet. */
  async orders(network: NetworkName, index: number): Promise<SessionOrder[]> {
    const s = (await this.book(network)).sessions.find((r) => r.index === index);
    if (!s) throw new Error("There's no such session.");
    const { address } = (await this.accounts(network, [s])).get(index)!;
    const orders = await this.deps.minswap(network).pendingOrders(address);
    return orders.map((o) => ({
      protocol: o.protocol,
      txIn: o.tx_in,
      amountIn: o.amount_in,
      minAmountOut: o.min_amount_out,
      createdAt: o.created_at,
    }));
  }

  /** Has Minswap build a cancel of the session's open orders (six at most), and reads it. */
  async cancelBuild(network: NetworkName, index: number): Promise<SessionTxReview> {
    const s = await this.live(network, index);
    const { address, keyHash } = (await this.accounts(network, [s])).get(index)!;
    const minswap = this.deps.minswap(network);
    const orders = (await minswap.pendingOrders(address)).slice(0, 6);
    if (!orders.length) throw new Error("No order of this session is waiting: it was filled, or cancelled already.");
    const txCbor = await minswap.cancelTx(address, orders);
    const rows = await this.utxosOf(network, keyHash);
    return this.review(network, s, "cancel", txCbor, rows, { orders: orders.length });
  }

  /** Signs the swap or cancel reviewed last with the session's key, puts the signature in, and submits it. */
  txSubmit(network: NetworkName, txHash: string, kind: "swap" | "cancel"): Promise<PendingTx> {
    return this.serial(async () => {
      const { wallet, session, now } = this.deps;
      const built = await wallet.withKeys(() => session.get<KeptTx>(SESSION_TX));
      const what = kind === "swap" ? "swap" : "cancel";
      if (!built || built.txHash !== txHash || built.network !== network || built.kind !== kind) {
        throw new Error(`That ${what} isn't ready to send. Review it again.`);
      }
      if (now() - built.builtAt > BUILT_TTL_MS) {
        throw new Error(`That ${what} was built more than 10 minutes ago. Review it again.`);
      }
      return this.signAndSend(network, built);
    });
  }

  /** Builds and signs the return of everything at the session's account into the private balance. */
  backBuild(network: NetworkName, index: number, direct = false): Promise<SessionBackSummary> {
    // In turn with the sends and the runner: it may mark the session's record, and
    // a save it overlapped would be lost.
    return this.serial(() => this.backBuildNow(network, index, direct));
  }

  private async backBuildNow(network: NetworkName, index: number, direct: boolean): Promise<SessionBackSummary> {
    const { wallet, session } = this.deps;
    const s = await this.live(network, index);
    const { address, keyHash } = (await this.accounts(network, [s])).get(index)!;
    // Money that arrives after the return would need another one.
    if (s.txs.some((t) => t.kind === "swap") && (await this.deps.minswap(network).pendingOrders(address)).length) {
      throw new Error("An order of this session is still waiting. Cancel it, or wait for it to fill, then bring the session back.");
    }
    const rows = await this.utxosOf(network, keyHash);
    if (!rows.length) throw new Error("The session's account is empty, so there's nothing to bring back.");
    const built = await this.buildBack(network, index, rows, undefined, direct);
    await wallet.withKeys(() => session.set(SESSION_BACK, built));
    const { txCbor: _txCbor, builtAt: _builtAt, chain: _chain, leaves: _leaves, ...summary } = built;
    return summary;
  }

  /** Sends the return built last. */
  backSubmit(network: NetworkName, txHash: string): Promise<PendingTx> {
    return this.serial(async () => {
      const { wallet, session, now } = this.deps;
      const built = await wallet.withKeys(() => session.get<KeptBack>(SESSION_BACK));
      if (!built || built.txHash !== txHash || built.network !== network) {
        throw new Error("That return isn't ready to send. Review it again.");
      }
      if (now() - built.builtAt > BUILT_TTL_MS) throw new Error("That return was built more than 10 minutes ago. Review it again.");
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
        if (s.auto) throw new Error(s.mix ? "A mix comes back by itself." : "A swap that runs itself comes back by itself.");
        const { address, keyHash } = (await this.accounts(network, [s])).get(index)!;
        if (s.txs.some((t) => t.kind === "swap") && (await this.deps.minswap(network).pendingOrders(address)).length) {
          throw new Error("An order of this session is still waiting.");
        }
        const rows = await this.utxosOf(network, keyHash);
        if (!rows.length) throw new Error("It holds nothing.");
        returns.push(await this.buildBack(network, index, rows, params, direct));
      } catch (e) {
        skipped.push({ index, reason: (e as Error).message });
      }
    }
    await wallet.withKeys(() => session.set(SESSION_CLAIM, returns));
    return {
      returns: returns.map(({ txCbor: _txCbor, builtAt: _builtAt, chain: _chain, leaves: _leaves, ...summary }) => summary),
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
      if (!chosen.length || chosen.some((c) => !c)) throw new Error("Those returns aren't ready to send. Review them again.");
      if (chosen.some((c) => now() - c!.builtAt > BUILT_TTL_MS)) {
        throw new Error("Those returns were built more than 10 minutes ago. Review them again.");
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
   * approved (privacy review §4.1).
   */
  stop(network: NetworkName, index: number, direct = false): Promise<SessionView> {
    return this.serial(async () => {
      await this.automatic(network, index);
      await this.update(network, index, (s) => {
        s.auto!.stopping ??= this.deps.now();
        if (direct) s.auto!.direct = true;
        delete s.auto!.paused;
        delete s.auto!.retry;
      });
      await this.deps.alarm?.start();
      await this.step(network, index, "asked");
      return this.one(network, index);
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
    const funded = s.swap?.tokenIn === "lovelace" && !s.auto!.filled ? BigInt(s.auto!.approved.fund.lovelace) : 0n;
    const { price, skipped, depth, delay } = await this.priced(network, true);
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
    let still = (await this.book(network)).sessions.some(running);
    for (const s of book.sessions.filter((r) => !r.closedAt)) still ||= !!(await this.pendingChain(network, s.index));
    return still;
  }

  /**
   * Marks each open session's chain that went in partly, and that nothing is
   * sending anymore (its progress was wiped), as stopped (CHAIN_CUT).
   */
  private async markCut(network: NetworkName): Promise<void> {
    for (const s of (await this.book(network)).sessions) {
      const chain = s.chain;
      if (s.closedAt || !chain || chain.stopped) continue;
      const sent = new Set(s.txs.filter((t) => !t.unsent).map((t) => t.txHash));
      const started = s.txs.some((t) => t.at >= chain.at && (t.kind === "deposit" || t.kind === "mix") && sent.has(t.txHash));
      if (!started || sent.has(chain.last) || (await this.pendingChain(network, s.index))) continue;
      await this.update(network, s.index, (r) => {
        r.chain!.stopped = CHAIN_CUT;
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
          auto.retry = { at: at + retryAfterMs(tries), error: e instanceof Error ? e.message : String(e), tries };
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
      const statuses = await this.deps.koios(network).txStatus(waiting.map((t) => t.txHash));
      const on = new Set(waiting.filter((t) => statuses.get(t.txHash) != null).map((t) => t.txHash));
      // Never taken, or never seen: its step is built again. It spends the session's
      // UTxOs, so the ledger lets only one of the two land, and one Koios may have
      // taken is still looked for (replaced).
      const gone = new Set(
        waiting.filter((t) => t.kind !== "out" && !t.replaced && !on.has(t.txHash) && lost(t, now())).map((t) => t.txHash),
      );
      const stale = waiting.filter((t) => t.replaced && !on.has(t.txHash) && now() - t.at >= REPLACED_WATCH_MS);
      // A funding may have reached the chain though Koios didn't answer, or tx_status doesn't know it yet:
      // what it paid the account is looked for before it counts as failed.
      const out = s.txs[0]!;
      let neverFunded =
        !out.confirmed && !on.has(out.txHash) && now() - out.at > (out.unsent ? RESEND_AFTER_MS : FAILED_AFTER_MS);
      if (neverFunded) {
        const { keyHash } = (await this.accounts(network, [s])).get(s.index)!;
        if ((await this.utxosOf(network, keyHash)).some((u) => u.tx_hash === out.txHash)) {
          on.add(out.txHash);
          neverFunded = false;
        }
      }
      if (on.size || gone.size || stale.length || neverFunded) {
        let freed: string[] = [];
        s = await this.update(network, s.index, (r) => {
          settle(r, on);
          // What the copies going unseen now spent, as far as Koios didn't answer them: exactly these, now,
          // before their step is built again (and its copy counts them as spent again), never later.
          freed = r.txs.filter((t) => gone.has(t.txHash)).flatMap((t) => t.inputs ?? []);
          r.txs = r.txs.filter(
            (t) => !stale.some((x) => x.txHash === t.txHash) && !(gone.has(t.txHash) && (t.unsent || !REBUILT.has(t.kind))),
          );
          for (const t of r.txs) {
            if (!gone.has(t.txHash)) continue;
            t.replaced = true;
            delete t.sending;
          }
          if (neverFunded) r.auto!.failed = now();
        });
        // Free again: the step built again spends them, or a return takes them, and the ledger lets only one
        // of it and the unseen copy land (final review sessions-1).
        if (freed.length) await wallet.withKeys(() => forgetSpent(session, freed));
        if (waiting.some((t) => t.kind === "back" && on.has(t.txHash))) {
          // The private balance has new UTxOs: the next reading should see them.
          await wallet.withKeys(() => session.remove(SESSION_BALANCES_PREFIX + network));
        }
      }
      if (s.txs.some((t) => !t.confirmed && !t.replaced)) return;
    }

    const { address, keyHash } = (await this.accounts(network, [s])).get(s.index)!;
    const { listed, rows } = await this.listing(network, keyHash);
    this.seen.set(`${network}:${s.index}`, rows);
    // A copy that went unseen isn't a step taken: its step is taken again.
    const taken = s.txs.filter((t) => !t.replaced);
    const kinds = new Set(taken.map((t) => t.kind));
    // What no return takes stays, and holds nothing open.
    const active = returnable(s, rows);
    // Brought back, and nothing has arrived since: it's over. The account as
    // Koios lists it, what this wallet spent included: a step that never
    // lands leaves its inputs there. And not while a copy of a step built
    // again may still land (final review sessions-1, sessions-2).
    if (taken.at(-1)!.kind === "back" && !returnable(s, listed).length && !mayStillLand(s, now())) {
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
    // (directly: its deposit is in), whatever Minswap lists.
    if (kinds.has("deposit") || kinds.has("mix")) return go(() => this.bringBack(network, s.index, rows));
    const auto = s.auto!;
    // No order yet: place it, unless the user stopped, or brought the session back by hand.
    if (!kinds.has("swap")) {
      // A swap that went unseen may have landed after all: never a second order, or a return, while Minswap
      // lists one. After Stop, it's cancelled first, as one the runner saw land is (final review sessions-2).
      if (s.txs.some((t) => t.kind === "swap")) {
        const orders = await this.deps.minswap(network).pendingOrders(address);
        if (orders.length) return auto.stopping ? go(() => this.cancel(network, s, address, rows, orders)) : undefined;
      }
      if (auto.stopping || kinds.has("back")) return go(() => this.bringBack(network, s.index, rows));
      return go(() => this.order(network, s, address, rows));
    }

    const orders = await this.deps.minswap(network).pendingOrders(address);
    if (orders.length) {
      // Waiting for a batcher to fill it, unless the user stopped it.
      if (auto.stopping) await go(() => this.cancel(network, s, address, rows, orders));
      return;
    }
    // Minswap no longer lists the order. A fill or a refund spends it, and comes
    // in a transaction the session didn't make; a cancel's refund in its own.
    if (!kinds.has("cancel")) {
      const own = new Set(s.txs.map((t) => t.txHash));
      // Nothing's here yet: one of them is behind.
      if (!active.some((r) => !own.has(r.tx_hash))) return;
      // Anyone can pay the account, and Minswap may not list a new order yet: what
      // arrived is the fill only once the order itself is spent.
      if (!(await this.ordersSpent(network, s))) return;
      if (!auto.filled) {
        await this.update(network, s.index, (r) => {
          r.auto!.filled = now();
        });
      }
    }
    await go(() => this.bringBack(network, s.index, rows));
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
   */
  private async waits(network: NetworkName, s: SessionRecord, run: Run): Promise<boolean> {
    const until = s.auto?.unlockWait;
    if (run === "unlock") {
      if (until === undefined) {
        const lockAfter = (await this.deps.preferences?.lockAfterMs()) ?? DEFAULT_PREFERENCES.lockAfterMinutes * 60_000;
        const at = this.deps.now() + unlockWait(lockAfter, this.deps.random ?? secureRandom);
        await this.update(network, s.index, (r) => {
          r.auto!.unlockWait = at;
        });
      }
      return true;
    }
    if (run === "run" && until !== undefined && this.deps.now() < until) return true;
    if (until !== undefined) {
      await this.update(network, s.index, (r) => {
        delete r.auto!.unlockWait;
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

  /** Places the order: a fresh quote, Minswap's swap for the account, the checks, and the key's signature. */
  private async order(network: NetworkName, s: SessionRecord, address: string, rows: KoiosUtxo[]): Promise<void> {
    if (!s.swap) throw new Refused("this session isn't for a swap.");
    const approved = s.auto!.approved;
    const minswap = this.deps.minswap(network);
    const ask = checkAsk(s.swap);
    const est = await minswap.estimate(ask);
    const least = BigInt(approved.minAmountOut);
    if (BigInt(est.amount_out) < least) throw new PriceMoved(est.amount_out);
    // At least what the user approved, or more when the price has moved their way.
    const min = BigInt(est.min_amount_out) > least ? est.min_amount_out : approved.minAmountOut;
    const txCbor = await minswap.buildTx(address, min, ask);
    // Minswap's fee is bounded by what was approved, not by what it quotes now.
    const quote = { ...quoteOf(network, ask, est), minAmountOut: min, aggregatorFee: approved.aggregatorFee ?? "0" };
    const built = await this.inspect(network, s, "swap", txCbor, rows, quote);
    withinFunding(paidOut(built.summary, address), built.summary.fee, approved.fund);
    await this.signAndSend(network, built);
  }

  /** Cancels the session's orders, after Stop: Minswap's cancel, checked, and the key's signature. */
  private async cancel(
    network: NetworkName,
    s: SessionRecord,
    address: string,
    rows: KoiosUtxo[],
    orders: PendingOrder[],
  ): Promise<void> {
    const txCbor = await this.deps.minswap(network).cancelTx(address, orders.slice(0, 6));
    const built = await this.inspect(network, s, "cancel", txCbor, rows);
    // A cancel only brings the orders' funds back to the session: it pays nothing out but its fee, and that's small.
    if (paidOut(built.summary, address).length) throw new Refused("its cancel pays someone other than this session.");
    if (BigInt(built.summary.fee) > MAX_CANCEL_FEE) throw new Refused("its cancel's fee is more than a cancel takes.");
    await this.signAndSend(network, built);
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
   * Reads a transaction Minswap built against the session's key: what it
   * spends, what its key never signs, and, a swap's, where it pays
   * (`checkOrder`, with Minswap's fee as `quote` has it).
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
    let refs: string[];
    let outputs: BuiltOutput[];
    try {
      const bytes = hexBytes(txCbor);
      refs = [...new Set([...(bodyOutpoints(bytes, 0) ?? []), ...(bodyOutpoints(bytes, 13) ?? [])])];
      outputs = builtOutputs(bytes);
    } catch {
      throw new Error("The wallet can't read the transaction Minswap built.");
    }
    const own = new Map(rows.map((r) => [outpoint(r), r]));
    const others = refs.filter((r) => !own.has(r));
    // A swap spends only the session's UTxOs; a cancel also spends its orders, at the DEXes' contracts.
    if (kind === "swap" && others.length) throw new Refused("it spends something that isn't this session's.");
    const foreign = others.length ? await this.deps.koios(network).utxoInfo(others) : [];
    const request = JSON.stringify({
      network,
      txCbor,
      keys: [{ role: 0, index }],
      // Its own stake key: what pays its address back is its own (a session from before has the shared one).
      stakeIndex: s.ownStake ? index : 0,
      inputs: [...refs.flatMap((r) => own.get(r) ?? []), ...foreign],
      partialSign: false,
    });
    let summary: DappTxSummary;
    try {
      summary = await wallet.withKeys((keys) => JSON.parse(wasm.inspectSessionTx(keys.oneTime, request)) as DappTxSummary);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (/locked/i.test(message)) throw e;
      // What WebAssembly won't read (an output on another network, say) won't read any better later: pause.
      throw new Refused(message.charAt(0).toLowerCase() + message.slice(1));
    }
    refuseOddities(summary, index);
    let orders: string[] | undefined;
    if (kind === "swap") {
      const { address, keyHash } = (await this.accounts(network, [s])).get(index)!;
      const at = checkOrder(outputs, { address: wasm.cip30Address(address), keyHash }, BigInt(quote?.aggregatorFee ?? "0"));
      orders = at.map((i) => `${summary.txHash}#${i}`);
    }
    return { network, index, kind, txHash: summary.txHash, txCbor, request, quote, orders, builtAt: now(), summary };
  }

  /** Reads a transaction Minswap built, and keeps it for the user's Send. */
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
    return { network, index: s.index, kind, txHash: summary.txHash, summary, ...extra };
  }

  /** Signs a swap or cancel with the session's key alone, puts the signature in byte for byte, and sends it. */
  private async signAndSend(network: NetworkName, built: KeptTx): Promise<PendingTx> {
    const { wasm, wallet } = this.deps;
    const whole = await wallet.withKeys((keys) => {
      const signed = JSON.parse(wasm.signSessionTx(keys.oneTime, built.request)) as { witnessSet: string; summary: DappTxSummary };
      if (signed.summary.txHash !== built.txHash) throw new Error("Signing changed the transaction, so it wasn't sent.");
      return wasm.attachWitnesses(built.txCbor, signed.witnessSet);
    });
    const bytes = hexBytes(whole);
    if (txId(bytes) !== built.txHash) throw new Error("Putting the signature in changed the transaction, so it wasn't sent.");
    return this.sendRecorded(network, built.index, built.kind, built.txHash, bytes, SESSION_TX, {
      // Recorded with it, before it's sent: whichever copy of the swap lands, its own orders are the ones looked at.
      orders: built.kind === "swap" ? built.orders : undefined,
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
  ): Promise<KeptBack> {
    const { wasm, wallet, now } = this.deps;
    if (await this.pendingChain(network, index)) {
      throw new Error("Its return through Lovejoin is still being sent. Wait for it to finish.");
    }
    // A reference script the wallet can't measure: no transaction of its takes that UTxO, ever.
    const unpriced = held.filter((u) => !measurable(u));
    if (unpriced.length) await this.leaveBehind(network, index, unpriced, "script");
    const rows = held.filter(measurable);
    if (!rows.length) {
      await this.update(network, index, (r) => {
        r.nothingBack ??= now();
      });
      throw new NothingComesBack(
        "What's at the session's account holds a reference script the wallet can't price, so no return can take it. It stays there.",
      );
    }
    const params = known ?? (await this.deps.koios(network).epochParams());
    const merge = await this.fundingChange(network, index);
    const record = (await this.book(network)).sessions.find((r) => r.index === index);
    // A chain that went in partly already: what's left comes back directly, rather than go in again.
    // One that finished (its return sent) doesn't hold a later return back (a site's session is paid again).
    const finished = !!record?.chain && record.txs.some((t) => t.txHash === record.chain!.last && !t.unsent);
    const started = !finished && record?.txs.some((t) => (t.kind === "deposit" || t.kind === "mix") && !t.unsent);
    if (started && record?.chain && !record.chain.stopped) {
      // Nothing is sending the rest: the wallet locked, or the browser closed, partway.
      await this.update(network, index, (r) => {
        r.chain!.stopped = CHAIN_CUT;
      });
    }
    // What the session's own transactions left at the account comes back first when not everything can at once.
    const own = record?.txs.map((t) => t.txHash) ?? [];
    const lovejoin = this.deps.lovejoin;
    let skipped: string | undefined;
    if (!direct && !started && lovejoin?.available(network) && (await this.throughLovejoin(record))) {
      // Its own collateral, the one its funding paid, else any 5 ₳ of ADA alone at the account (privacy review
      // §2.15). Never a stranger's 5 ₳ carrying a reference script: the mixes can't put it up.
      const fits = (u: KoiosUtxo) => BigInt(u.value) === SESSION_COLLATERAL && !u.asset_list?.length && !u.reference_script;
      const funding = record?.txs[0]?.txHash;
      const collateral = rows.find((u) => fits(u) && u.tx_hash === funding) ?? rows.find(fits);
      let chain: LovejoinChain | undefined;
      if (!collateral) {
        // Something the account signed spent it (a site's transaction, say): no mix can go, so it comes back
        // directly, and says so when its spare ADA would have paid for a box.
        if (record?.mix || spareOf(rows) >= BigInt((await lovejoin.funding(network, 1)).lovelace)) skipped = NO_COLLATERAL;
      } else {
        try {
          chain = await lovejoin.chain(
            network,
            index,
            rows,
            collateral,
            params,
            merge,
            record?.mix?.boxes,
            record?.mix?.again,
            own,
            record?.mix?.publicToo,
          );
        } catch (e) {
          skipped = leftOut(e);
        }
      }
      // A mix that can't pay for its boxes anymore (the fees went up) says so too.
      if (!chain && !skipped && record?.mix) skipped = "its ADA doesn't pay for a box and its mixes anymore";
      if (skipped && record?.mix) {
        await this.update(network, index, (r) => {
          r.mix!.skipped = skipped;
        });
      }
      if (chain) {
        await this.leftBy(network, index, rows, chain.leftOut);
        const back = chain.txs[chain.txs.length - 1]!;
        const { delay } = await lovejoin.settings();
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
            mixes: chain.txs.filter((t) => t.kind === "mix").length,
            fees: chain.fees,
            txs: chain.txs.length,
            delay,
            ...(record?.mix?.again ? { again: true } : {}),
          },
          chain: chain.txs,
          leaves: chain.leaves,
          builtAt: now(),
        };
      }
    }
    // A mix stopped before its boxes went in: it's all coming back, unmixed.
    if (direct && !started && record?.mix && !record.mix.skipped) {
      skipped = "you stopped it before its boxes went in";
      await this.update(network, index, (r) => {
        r.mix!.skipped = skipped;
      });
    }
    // No chain this time: a chain built for it before won't be sent, so nothing stays reserved for it.
    await lovejoin?.release(network, chainOwner(index));
    let result: Omit<SessionBackSummary, "network" | "index"> & { txCbor: string };
    try {
      result = await wallet.withKeys(
        (keys) =>
          JSON.parse(
            wasm.buildSessionReturn(keys.oneTime, keys.seedelf, JSON.stringify({ network, params, index, utxos: rows, merge, own })),
          ) as typeof result,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (/locked/i.test(message) || !TOO_LITTLE.test(message)) throw e;
      // Even the session's own doesn't pay its way back (WebAssembly takes a stranger's token only when it pays
      // its own): it stays, rather than be tried for ever, and is tried again once more arrives (act, a top-up).
      await this.leaveBehind(network, index, rows, "fee");
      await this.update(network, index, (r) => {
        r.nothingBack ??= now();
      });
      throw new NothingComesBack("What's left at the session's account is too little to pay for its own way back, so it stays there.");
    }
    await this.leftBy(network, index, rows, result.leftOut);
    return { ...result, network, index, ...(skipped ? { lovejoinSkipped: skipped } : {}), builtAt: now() };
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
   * left behind for its fee and comes back now isn't anymore; and a return
   * is found again (`nothingBack`).
   */
  private async leftBy(network: NetworkName, index: number, rows: KoiosUtxo[], leftOut: LeftOutUtxo[] = []): Promise<void> {
    const key = (u: { txHash: string; txIndex: number }) => `${u.txHash}#${u.txIndex}`;
    const left = new Set(leftOut.map(key));
    const stays = rows.filter((u) => leftOut.some((l) => l.reason === "cost" && key(l) === outpoint(u)));
    const back = new Set(rows.map(outpoint).filter((o) => !left.has(o)));
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
   * the return then makes new ones, as it always did).
   */
  private async fundingChange(network: NetworkName, index: number): Promise<KoiosUtxo[]> {
    const s = (await this.book(network)).sessions.find((r) => r.index === index);
    const outs = new Set(s?.txs.filter((t) => t.kind === "out" && !t.unsent).map((t) => t.txHash) ?? []);
    if (!outs.size) return [];
    try {
      const view = await readContractView(this.deps, network);
      const mine = await this.deps.coins.seedelf(network, spendable(this.deps, view));
      return mine
        .filter((u) => outs.has(u.tx_hash))
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
    });
    await this.deps.activity?.sent(network, pending, built).catch(() => undefined);
    return pending;
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
    const { chain: txs, leaves, txCbor: _txCbor, builtAt: _builtAt, ...summary } = built;
    // Another return of the session kept for Send (its page's, Bring everything back's) never takes the place
    // of a chain on its way: its progress, its reservation and its record stay as they are (final review lovejoin-4).
    if (await this.pendingChain(network, built.index)) {
      throw new Error("Its return through Lovejoin is still being sent. Wait for it to finish.");
    }
    await this.update(network, built.index, (s) => {
      s.chain = { total: txs!.length, last: txs!.at(-1)!.txHash, at: this.deps.now() };
      delete s.lovejoinSkipped;
    });
    await this.savePending(network, { txs: txs!, next: 0, flying: [], index: built.index, kept, summary });
    // Being sent: its change to come and its collateral are the chain's too.
    await this.deps.lovejoin?.reserve(network, chainOwner(built.index), txs!);
    // Recorded, sealed, before any of it is sent: what it deposits, mixes and leaves.
    await this.deps.lovejoin?.recordChain(network, {
      session: built.index,
      progress: this.pendingKey(network, built.index),
      txs: txs!,
      leaves: leaves ?? [],
      boxes: summary.lovejoin?.boxes ?? 0,
      again: !!summary.lovejoin?.again,
    });
    await this.deps.alarm?.start();
    await this.pump(network, built.index, budgetMs);
    return { kind: "session-back", network, txHash: built.txHash, submittedAt: this.deps.now(), confirmations: null };
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
    const koios = this.deps.koios(network);
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const id = pending.txs.at(-1)!.txHash;
    let done: boolean;
    try {
      done = await pumpChain(
        pending,
        {
          send: (i, maybeSent) => this.sendStep(network, pending, i, maybeSent),
          onChain: async (hashes) => {
            const statuses = await koios.txStatus(hashes);
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
            return on;
          },
          save: () => this.savePending(network, pending),
          sleep,
          now: this.deps.now,
        },
        budgetMs,
      );
    } catch (e) {
      // Recorded as stopped before its progress goes: never taken for one a lock cut.
      await this.deps.lovejoin?.chainEnded(network, id, e instanceof Error ? e.message : String(e)).catch(() => undefined);
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
    await this.deps.activity?.sent(network, last, pending.summary).catch(() => undefined);
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
    for (;;) {
      try {
        // What was kept for Send is the chain, under its return's hash.
        await this.sendRecorded(network, pending.index, step.kind, step.txHash, bytes, pending.kept, { keptHash: pending.txs.at(-1)!.txHash });
        break;
      } catch (e) {
        // Refused while Koios couldn't say whether it's on chain, and it may be: looked for again (final review lovejoin-6).
        if (mayBeIn(tries, e)) break;
        const wait = chainRetryMs(i, tries, e);
        if (wait === undefined) {
          // Said on the session, where its page shows it in full.
          const why = e instanceof Error ? e.message : String(e);
          await this.update(network, pending.index, (s) => {
            if (s.chain) s.chain.stopped = why;
          }).catch(() => undefined);
          throw e;
        }
        await sleep(wait);
      }
    }
    await this.deps.lovejoin?.chainSent(network, pending.txs.at(-1)!.txHash, i);
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

  private dropPending(network: NetworkName, index: number): Promise<void> {
    return this.deps.wallet.withKeys(() => this.deps.session.remove(this.pendingKey(network, index)));
  }

  /**
   * Records a session's transaction, then submits it, so the record always
   * knows what may be on its way. Its page watches it, not Home's banner.
   * `kept`: where it was kept for Send, cleared once it's sent if that still
   * holds `keptHash` (this transaction, or the chain it's part of). `orders`:
   * a swap's, recorded with it. `after`: what else the record gains once
   * it's sent.
   */
  private async sendRecorded(
    network: NetworkName,
    index: number,
    kind: SessionTx["kind"],
    txHash: string,
    bytes: Uint8Array<ArrayBuffer>,
    kept: string,
    { after, keptHash = txHash, orders }: { after?: (s: SessionRecord) => void; keptHash?: string; orders?: string[] } = {},
  ): Promise<PendingTx> {
    const { wallet, session, now } = this.deps;
    const mine = (s: SessionRecord) => s.txs.find((t) => t.txHash === txHash);
    let sentBefore = false;
    await this.update(network, index, (s) => {
      const again = mine(s);
      if (again) {
        sentBefore = !again.unsent;
        delete again.unsent;
        again.sending = true;
      } else {
        s.txs.push({ kind, txHash, at: now(), sending: true, ...(orders ? { orders } : {}) });
      }
    });
    try {
      await this.submit(network, bytes, txHash);
    } catch (e) {
      // Koios didn't answer: it may be on its way, so it's looked for as one Koios took is (lost), and
      // what it spends counts as spent meanwhile, recorded with it to be freed if its step is built again.
      const maybe = maybeSent(e);
      // Sent before, and refused while Koios couldn't say whether it's on chain: it may be (final review lovejoin-6).
      const unread = sentBefore && e instanceof SpentUnread;
      await this.update(network, index, (s) => {
        const t = mine(s);
        if (!t) return;
        delete t.sending;
        if (maybe) t.inputs = txInputs(bytes);
        else if (!unread) t.unsent = true;
      });
      if (maybe || unread) await wallet.withKeys(() => rememberSpent(session, network, bytes));
      // A return merged into the funding's change, which was spent elsewhere: the kept view of the contract is behind, so read it in full next time.
      if (kind === "back" && e instanceof SpentInputError) await forgetContractView(this.deps, network).catch(() => undefined);
      throw e;
    }
    await this.update(network, index, (s) => {
      const t = mine(s);
      if (t) delete t.sending;
      // A step taken, by the user or the runner: the swap goes on from here.
      if (s.auto) delete s.auto.paused;
      after?.(s);
    });
    await wallet.withKeys(async () => {
      await rememberSpent(session, network, bytes);
      await clearKept(session, kept, keptHash);
      await session.remove(SESSION_BALANCES_PREFIX + network);
    });
    return { kind: PENDING_KIND[kind], network, txHash, submittedAt: now(), confirmations: null };
  }

  /** Submits through Koios; a transaction that's on chain already counts as sent. */
  private async submit(network: NetworkName, bytes: Uint8Array<ArrayBuffer>, txHash: string): Promise<void> {
    const koios = this.deps.koios(network);
    try {
      const submitted = await koios.submitTx(bytes);
      if (submitted !== txHash) throw new Error(`Koios answered with another transaction id (${submitted}).`);
    } catch (e) {
      if (!(e instanceof SpentInputError)) throw e;
      await sentAlready(koios, txHash, e);
    }
  }

  private async listNow(network: NetworkName, refresh = false): Promise<SessionView[]> {
    const { wallet, session, now } = this.deps;
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
      const waiting = live.flatMap((s) => s.txs.filter((t) => !t.confirmed).map((t) => t.txHash));
      if (waiting.length) {
        const statuses = await koios.txStatus(waiting);
        const on = new Set(waiting.filter((h) => statuses.get(h) != null));
        for (const s of live) {
          returned ||= s.txs.some((t) => t.kind === "back" && !t.confirmed && on.has(t.txHash));
          changed = settle(s, on) || changed;
        }
      }
      for (const s of live) {
        const held = holdings.get(s.index)!;
        const out = s.txs[0]!;
        // What the funding paid is at the account, whatever tx_status knows: it landed.
        if (!out.confirmed && held.some((u) => u.tx_hash === out.txHash)) {
          changed = settle(s, new Set([out.txHash])) || changed;
        }
        // A swap or a mix that was found never funded, whose funding is here after all, runs again.
        if (s.auto?.failed && out.confirmed) {
          delete s.auto.failed;
          changed = resumed = true;
        }
        const last = s.txs.filter((t) => !t.replaced).at(-1)!;
        // Brought back, and nothing has arrived since: the session is over. A
        // site's goes on until it's disconnected: the site may pay it later.
        // As act closes it: the account as Koios lists it, and no copy of a
        // step that may still land (final review sessions-1).
        if (
          !s.site &&
          last.kind === "back" &&
          last.confirmed &&
          !returnable(s, of(listed, s.index)).length &&
          !mayStillLand(s, now())
        ) {
          s.closedAt = now();
          changed = true;
        }
      }
      if (changed) await this.save(network, book);
      if (returned) await wallet.withKeys(() => session.remove(SESSION_BALANCES_PREFIX + network));
      if (resumed) await this.deps.alarm?.start();
    }
    return [...book.sessions]
      .reverse()
      .map((s) =>
        this.view(network, s, keys.get(s.index)!.address, holdings?.get(s.index) ?? this.seen.get(`${network}:${s.index}`)),
      );
  }

  /** One session as it is now, with what its account held at the last reading. */
  private async one(network: NetworkName, index: number): Promise<SessionView> {
    const s = (await this.book(network)).sessions.find((r) => r.index === index);
    if (!s) throw new Error("There's no such session.");
    const { address } = (await this.accounts(network, [s])).get(index)!;
    return this.view(network, s, address, this.seen.get(`${network}:${index}`));
  }

  private view(network: NetworkName, s: SessionRecord, address: string, utxos?: KoiosUtxo[]): SessionView {
    // A step's transaction Koios never took isn't shown, nor one that went unseen: it's built again.
    const txs = s.txs.filter((t) => (t.kind === "out" || !t.unsent) && !t.replaced);
    const out = txs[0]!;
    const last = txs.at(-1)!;
    const funded = out.confirmed || !!utxos?.length;
    const neverFunded = s.auto ? !!out.unsent || !!s.auto.failed : !!out.unsent || this.deps.now() - out.at > FAILED_AFTER_MS;
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
      txs: txs.map(({ unsent: _unsent, sending: _sending, replaced: _replaced, inputs: _inputs, orders: _orders, ...t }) => t),
      ...(s.swap ? { swap: s.swap } : {}),
      holding: utxos ? holdingOf(returnable(s, utxos)) : null,
      ...(s.auto ? { auto: autoView(s.auto, txs, stage, !!s.mix) } : {}),
      ...(s.site ? { site: s.site } : {}),
      ...(s.mix ? { mix: s.mix } : {}),
      ...(s.chain ? { chain: chainView(s.chain, txs) } : {}),
      ...(s.lovejoinSkipped ? { lovejoinSkipped: s.lovejoinSkipped } : {}),
      ...leftBehindView(s, utxos),
      // A funding turned away never went out: only then does the page say it never reached the chain.
      ...(stage === "failed" && out.unsent ? { unsent: true } : {}),
    };
  }

  /** A session that isn't over, or why not. */
  private async live(network: NetworkName, index: number): Promise<SessionRecord> {
    const s = (await this.book(network)).sessions.find((r) => r.index === index);
    if (!s) throw new Error("There's no such session.");
    if (s.closedAt) throw new Error("That session is over: everything in it came back.");
    return s;
  }

  /** A session that isn't over and runs itself, or why not. */
  private async automatic(network: NetworkName, index: number): Promise<SessionRecord> {
    const s = await this.live(network, index);
    if (!s.auto) throw new Error("This swap doesn't run by itself: take its steps with its buttons.");
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
   * time.
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
    if (!s) throw new Error("There's no such session.");
    change(s);
    await this.save(network, book);
    return s;
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
 * read), and a lock.
 */
function leftOut(e: unknown): string {
  if (e instanceof LovejoinSkipped) return e.reason;
  const message = e instanceof Error ? e.message : String(e);
  if (e instanceof KoiosError || /locked/i.test(message)) throw e;
  return `the wallet couldn't build its chain: ${message.charAt(0).toLowerCase()}${message.slice(1).replace(/\.$/, "")}`;
}

/**
 * Why a chain can't draw from Lovejoin's pool as a swap's review read it
 * (`room`), at `depth`, in the review's words: under the network's floor, or
 * too few boxes free to mix with. Undefined when it can.
 */
function poolShort(network: NetworkName, room: { others: number; free: number }, depth: number): string | undefined {
  const floor = NETWORKS[network].lovejoin?.poolFloor ?? 0;
  const boxes = (n: number) => `${n} ${n === 1 ? "box" : "boxes"}`;
  if (room.others < floor) return `Right now Lovejoin's pool holds ${boxes(room.others)} that aren't yours, under the ${floor} it needs`;
  const needs = mixesPerBox(depth) * 2;
  if (room.free < needs) {
    return `Right now Lovejoin's pool has ${boxes(room.free)} to mix with, and a box ${depth} ${depth === 1 ? "wave" : "waves"} deep needs ${needs}`;
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

/** Where a swap or a mix that runs itself is at, for its timeline. A mix's chain is its return. */
function autoView(auto: AutoRecord, txs: RecordedTx[], stage: SessionView["stage"], mix: boolean): SessionAuto {
  const has = (kind: SessionTx["kind"], confirmed = false) => txs.some((t) => t.kind === kind && (!confirmed || t.confirmed));
  const step: SessionAuto["step"] =
    stage === "closed"
      ? "done"
      : stage === "funding" || stage === "failed"
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
    approvedMinOut: auto.approved.minAmountOut,
    ...(auto.paused ? { paused: auto.paused } : {}),
    ...(auto.retry ? { retry: { at: auto.retry.at, error: auto.retry.error } } : {}),
    ...(auto.unlockWait !== undefined ? { waitsUntil: auto.unlockWait } : {}),
    ...(auto.direct !== undefined ? { direct: auto.direct } : {}),
  };
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
  if (lovelace > BigInt(fund.lovelace)) throw new Refused("it pays out more ADA than was funded for the swap.");
  for (const [id, quantity] of tokens) {
    const funded = fund.tokens.find((t) => t.policyId + t.assetName === id);
    if (!funded || quantity > BigInt(funded.quantity)) throw new Refused("it pays out tokens that weren't funded for the swap.");
  }
}

/**
 * Where a swap Minswap built pays, before the session's key signs it (the
 * runner, or the user's review), from its bytes (`builtOutputs`):
 * - back to the session's own address;
 * - an output at a script, staked with the session's stake key or none,
 *   whose datum (inline, or carried for its hash) names the session's key:
 *   a real order names its owner, who gets the proceeds or the refund.
 *   There's one at least;
 * - at most one other output, Minswap's fee, wherever it goes: ADA alone,
 *   and no more than `aggregatorFee` quoted (none on preprod).
 * Anything else is refused. Which script an order goes to isn't checked:
 * no DEX's order contract is pinned, so that's Minswap's to build, as the
 * order's receivers are. Nor is its minimum read back: it's what the wallet
 * asks Minswap for, and Minswap builds the order. Returns the orders' output
 * indexes.
 */
export function checkOrder(outputs: BuiltOutput[], session: { address: string; keyHash: string }, aggregatorFee: bigint): number[] {
  // A base address's staking part: bytes 29 to 57, after the header and the payment part.
  const stake = session.address.slice(58, 114);
  const orders: number[] = [];
  let fee = false;
  outputs.forEach((o, i) => {
    if (o.address === session.address) return;
    // The header's high four bits: 0 to 7 are Shelley addresses, an odd one paying a script.
    const type = Number.parseInt(o.address.charAt(0), 16);
    const script = type <= 7 && type % 2 === 1;
    if (!script && o.address.slice(2, 58) === session.keyHash) {
      throw new Refused("it pays this session's key under someone else's staking part.");
    }
    const staked = type === 1 ? o.address.slice(58, 114) === stake : type === 7;
    if (script && staked && o.datum && names(o.datum, session.keyHash)) {
      orders.push(i);
      return;
    }
    if (!fee && !o.tokens && o.lovelace <= aggregatorFee) {
      fee = true;
      return;
    }
    if (!script) throw new Refused("it pays an address that isn't this session's.");
    if (!staked) throw new Refused("it pays a contract under someone else's staking part.");
    if (!o.datum) throw new Refused("it pays a contract without saying who the order is for.");
    throw new Refused("its order isn't for this session.");
  });
  if (!orders.length) throw new Refused("it places no order.");
  return orders;
}

/** Whether CBOR (hex) holds `keyHash` as a byte string of its own. */
function names(cbor: string, keyHash: string): boolean {
  const needle = `581c${keyHash}`;
  for (let at = cbor.indexOf(needle); at >= 0; at = cbor.indexOf(needle, at + 1)) if (at % 2 === 0) return true;
  return false;
}

/**
 * What a session's key never signs, whatever Minswap sent: anything that needs
 * another key, staking or governance, minting, a spend the wallet can't see,
 * or a gift to the treasury, which no output shows and withinFunding
 * wouldn't count.
 */
function refuseOddities(s: DappTxSummary, index: number): void {
  if (!s.complete || s.othersSign) throw new Refused("it needs someone else's signature too.");
  if (s.signs.length !== 1 || s.signs[0] !== `0/${index}`) throw new Refused("it isn't signed by this session's key alone.");
  if (s.unknownInputs.length) throw new Refused("it spends UTxOs the wallet couldn't find.");
  if (s.certificates.length || s.withdrawals.length || s.votes || s.proposals) {
    throw new Refused("it does something with staking or governance.");
  }
  if (s.mint.length) throw new Refused("it mints or burns tokens.");
  if (s.donation && BigInt(s.donation) > 0n) throw new Refused("it gives ADA to the treasury.");
}
