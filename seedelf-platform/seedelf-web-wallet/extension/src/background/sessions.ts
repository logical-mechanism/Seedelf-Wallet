// Private sessions (roadmap chunk 15, step 2): a one-time account funded from
// the private balance, used for a swap through Minswap's aggregator, and
// brought back into the private balance. The public account never appears.
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
// paid out than was funded, and an order for at least the least approved.
// Anything else pauses for the user. Stop is the user's alone: an order that
// waits is cancelled, then everything comes back. Every transaction is
// recorded before it's submitted.
//
// The accounts are account 24301', payment key 0/index and stake key 2/index,
// both the session's own, so no two sessions share a key (WebAssembly's
// OneTimeAccounts). Sessions recorded before that have the shared Seedelf
// staking part, and keep it: that's where their money is. The list
// of sessions is a sealed private record per network. The wallet reads a
// session's account only while a swap runs or when asked: one Koios request
// for all the open ones, and one tx_status for what's waiting.

import type { NetworkName } from "../networks";
import type {
  DappTxSummary,
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
  SwapQuote,
  SwapSide,
  SwapTokenInfo,
  TokenQuantity,
} from "../shared/rpc";
import { bodyOutpoints, txId } from "./cbor";
import { SpentInputError, type KoiosUtxo } from "./koios";
import type { Estimate, Minswap, PendingOrder } from "./minswap";
import type { PrivateStore } from "./private-store";
import { keep, measure, nothingToSpend, readContract, send, type ScriptSpendDeps } from "./script-spend";
import { outpoint, readFresh, rememberSpent, spentSet, unspent } from "./spent";
import { SESSION_BALANCES_PREFIX } from "./wallet";

/** chrome.storage.session: a session's funding payment, built and waiting for Send. */
export const SESSION_OUT = "seedelf.session.out";
/** chrome.storage.session: a swap or a cancel Minswap built, read and waiting for Send. */
export const SESSION_TX = "seedelf.session.tx";
/** chrome.storage.session: a session's return, signed and waiting for Send. */
export const SESSION_BACK = "seedelf.session.back";

/** Each session's own collateral, as the public account's. */
export const SESSION_COLLATERAL = 5_000_000n;
/** Room in the funding for the swap's fee and the change it leaves: it all comes back. */
export const SWAP_MARGIN = 2_000_000n;
/** A funding payment the chain doesn't have after this long never reached it. */
const FAILED_AFTER_MS = 20 * 60_000;
/** A built transaction is only sent within this long; after that, build again. */
const BUILT_TTL_MS = 10 * 60_000;
/** A step's transaction that Koios never took is built again after this long, if the chain hasn't got it. */
const RESEND_AFTER_MS = 2 * 60_000;
/** So is one the chain still hasn't got after this long. */
const LOST_AFTER_MS = 15 * 60_000;
/** The runner reads a session's chain at most this often, unless the user asks. */
export const READ_EVERY_MS = 15_000;

/**
 * How long to wait after `tries` failures in a row: 30 s, doubling, and never
 * more than five minutes. Minswap's rate limit clears within a minute, and a
 * funding Minswap hasn't seen yet shows up within a block or two.
 */
export const retryAfterMs = (tries: number) => Math.min(30_000 * 2 ** (tries - 1), 5 * 60_000);

type RecordedTx = SessionTx & {
  /** Koios never took it. */
  unsent?: boolean;
  /** Recorded, and on its way to Koios. */
  sending?: boolean;
};

/** A swap that runs itself: what the user approved with the funding, and how it's going. */
interface AutoRecord {
  approved: { minAmountOut: string; fund: SwapQuote["fund"] };
  paused?: SessionPause;
  retry?: { at: number; error: string; tries: number };
  /** When the user pressed Stop. */
  stopping?: number;
  /** When the runner saw the order filled. */
  filled?: number;
  /** When the runner found the funding never reached the chain. */
  failed?: number;
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

interface KeptTx {
  network: NetworkName;
  index: number;
  kind: "swap" | "cancel";
  txHash: string;
  txCbor: string;
  /** The request WebAssembly read it with, to sign it the same way. */
  request: string;
  quote?: SwapQuote;
  builtAt: number;
}

interface KeptBack extends SessionBackSummary {
  txCbor: string;
  builtAt: number;
}

export interface SessionDeps extends ScriptSpendDeps {
  store: PrivateStore;
  minswap: (network: NetworkName) => Minswap;
  /** Wakes the runner every minute while a swap runs (chrome.alarms). */
  alarm?: { start(): Promise<void>; stop(): Promise<void> };
}

/** What Minswap built failed a check: the swap pauses for the user instead of trying again. */
export class Refused extends Error {
  constructor(readonly detail: string) {
    super(`The wallet won't sign what Minswap built: ${detail}`);
  }
}

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
} as const satisfies Record<SessionTx["kind"], PendingTx["kind"]>;

const hexBytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));

/** Minswap's token IDs are the policy and the name run together. */
function tokenOf(id: string): Omit<TokenQuantity, "quantity"> {
  return { policyId: id.slice(0, 56), assetName: id.slice(56) };
}

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

/** A swap that runs itself and has something left to do without the user. */
function running(s: SessionRecord): boolean {
  return !!s.auto && !s.closedAt && !s.auto.paused && !s.auto.failed;
}

/** A step's transaction that's gone: Koios never took it, or the chain never saw it. */
function lost(t: RecordedTx, now: number): boolean {
  return ((t.unsent || t.sending) && now - t.at >= RESEND_AFTER_MS) || now - t.at >= LOST_AFTER_MS;
}

export class SessionService {
  /** One step at a time, the runner's and the user's alike. */
  private queue: Promise<unknown> = Promise.resolve();
  /** When the runner last read each session's chain, by `network:index`. */
  private readAt = new Map<string, number>();
  /** What each session's account held then. */
  private seen = new Map<string, KoiosUtxo[]>();

  constructor(private readonly deps: SessionDeps) {}

  /** This network's sessions, newest first. `refresh` reads their accounts and what's waiting. */
  list(network: NetworkName, refresh = false): Promise<SessionView[]> {
    return this.serial(() => this.listNow(network, refresh));
  }

  /** Forgets a session whose funding never reached the chain. Its index isn't used again. */
  forget(network: NetworkName, index: number): Promise<SessionView[]> {
    return this.serial(async () => {
      const views = await this.listNow(network, true);
      const view = views.find((v) => v.index === index);
      if (!view) throw new Error("There's no such session.");
      if (view.stage !== "failed") throw new Error("Only a session whose funding never reached the chain can be forgotten.");
      const book = await this.book(network);
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

  /** Minswap's quote for `ask`. */
  async quote(network: NetworkName, ask: SwapAsk): Promise<SwapQuote> {
    const checked = checkAsk(ask);
    return quoteOf(network, checked, await this.deps.minswap(network).estimate(checked));
  }

  /** Builds the payment that funds a new session for `quote`: the swap and its costs, and the account's collateral. */
  async outBuild(
    network: NetworkName,
    quote: SwapQuote,
    display?: { in: SwapSide; out: SwapSide },
  ): Promise<SessionOutSummary> {
    const { wasm } = this.deps;
    const ask = checkAsk(quote.ask);
    const index = (await this.book(network)).next;
    const address = (await this.accounts(network, [{ index, ownStake: true }])).get(index)!.address;
    const { view, utxos, params } = await readContract(this.deps, network);
    if (!utxos.length) {
      throw nothingToSpend(this.deps, view, "Your private balance is empty, so there's nothing to swap from.");
    }
    const request = {
      network,
      params,
      utxos,
      payments: [
        { to: address, lovelace: quote.fund.lovelace, tokens: quote.fund.tokens },
        { to: address, lovelace: SESSION_COLLATERAL.toString(), tokens: [] },
      ],
    };
    type Finished = Omit<SessionOutSummary, "network" | "payments" | "inputs" | "index" | "address"> & {
      txCbor: string;
      seed: string;
      payments: Array<Paid & { to: string }>;
      inputs: unknown[];
    };
    const finished = await measure<Finished>(
      this.deps,
      network,
      request,
      (keys, r) => wasm.draftWithdraw(keys.seedelf, r),
      (keys, r) => wasm.finishWithdraw(keys.seedelf, r),
    );
    const { txCbor, seed, inputs, payments, ...rest } = finished;
    const summary: SessionOutSummary = {
      ...rest,
      network,
      index,
      address,
      payments: payments.map(({ to, ...p }) => ({ address: to, own: false, ...p })),
      inputs: inputs.length,
    };
    const swap = { ...ask, amountOut: quote.amountOut, minAmountOut: quote.minAmountOut, ...(display ? { display } : {}) };
    // Sending this is the approval: the swap runs itself within it.
    const approved = { minAmountOut: quote.minAmountOut, fund: quote.fund };
    const kept: Omit<KeptOut, "builtAt"> & SessionOutSummary = { ...summary, txCbor, seed, index, swap, approved };
    await keep(this.deps, SESSION_OUT, kept);
    return summary;
  }

  /** Records the session, then sends its funding payment. From here the swap runs itself. */
  outSubmit(network: NetworkName, txHash: string): Promise<PendingTx> {
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
      // Recorded before it's sent: whatever happens next, this index is never used again.
      const record: SessionRecord = {
        index: built.index,
        ownStake: true,
        createdAt: now(),
        txs: [{ kind: "out", txHash, at: now() }],
        swap: built.swap,
        auto: { approved: built.approved },
      };
      await this.save(network, { next: built.index + 1, sessions: [...book.sessions, record] });
      let pending: PendingTx;
      try {
        pending = await send(this.deps, network, txHash, SESSION_OUT, "session-out", "payment");
      } catch (e) {
        await this.update(network, built.index, (s) => {
          s.txs[0]!.unsent = true;
        });
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
    return this.review(network, index, "swap", txCbor, rows, { quote: quoteOf(network, ask, est) });
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
    return this.review(network, index, "cancel", txCbor, rows, { orders: orders.length });
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
  async backBuild(network: NetworkName, index: number): Promise<SessionBackSummary> {
    const { wallet, session } = this.deps;
    const s = await this.live(network, index);
    const { address, keyHash } = (await this.accounts(network, [s])).get(index)!;
    // Money that arrives after the return would need another one.
    if (s.txs.some((t) => t.kind === "swap") && (await this.deps.minswap(network).pendingOrders(address)).length) {
      throw new Error("An order of this session is still waiting. Cancel it, or wait for it to fill, then bring the session back.");
    }
    const rows = await this.utxosOf(network, keyHash);
    if (!rows.length) throw new Error("The session's account is empty, so there's nothing to bring back.");
    const built = await this.buildBack(network, index, rows);
    await wallet.withKeys(() => session.set(SESSION_BACK, built));
    const { txCbor: _txCbor, builtAt: _builtAt, ...summary } = built;
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

  // -------------------------------------------------------------------------
  // The runner

  /** The session's next step, if it's time (`now`: whatever the last reading), and how it is after. */
  advance(network: NetworkName, index: number, now = false): Promise<SessionView> {
    return this.serial(async () => {
      await this.step(network, index, now);
      return this.one(network, index);
    });
  }

  /** Stop, the user's alone: an order that waits is cancelled, then everything comes back. */
  stop(network: NetworkName, index: number): Promise<SessionView> {
    return this.serial(async () => {
      await this.automatic(network, index);
      await this.update(network, index, (s) => {
        s.auto!.stopping ??= this.deps.now();
        delete s.auto!.paused;
        delete s.auto!.retry;
      });
      await this.deps.alarm?.start();
      await this.step(network, index, true);
      return this.one(network, index);
    });
  }

  /** Goes on after a pause or a failure: the step is tried again now. */
  resume(network: NetworkName, index: number): Promise<SessionView> {
    return this.serial(async () => {
      await this.automatic(network, index);
      await this.update(network, index, (s) => {
        delete s.auto!.paused;
        delete s.auto!.retry;
      });
      await this.deps.alarm?.start();
      await this.step(network, index, true);
      return this.one(network, index);
    });
  }

  /** Every running swap's next step, for the alarm and for unlocking. The alarm stops once none runs. */
  async runAll(network: NetworkName): Promise<void> {
    const due = (await this.book(network)).sessions.filter(running);
    for (const s of due) await this.serial(() => this.step(network, s.index, false)).catch(() => undefined);
    const still = (await this.book(network)).sessions.some(running);
    await (still ? this.deps.alarm?.start() : this.deps.alarm?.stop());
  }

  /** Takes the session's next step, if it's time. A failure waits and tries again; a failed check pauses. */
  private async step(network: NetworkName, index: number, now: boolean): Promise<void> {
    const at = this.deps.now();
    const s = (await this.book(network)).sessions.find((r) => r.index === index);
    if (!s || !running(s)) return;
    const key = `${network}:${index}`;
    if (!now && ((s.auto!.retry && at < s.auto!.retry.at) || at - (this.readAt.get(key) ?? 0) < READ_EVERY_MS)) return;
    this.readAt.set(key, at);
    try {
      await this.act(network, s);
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

  /** Whatever comes next for a swap that runs itself, from its record and the chain. */
  private async act(network: NetworkName, record: SessionRecord): Promise<void> {
    const { wallet, session, now } = this.deps;
    let s = record;
    // What was sent and isn't on chain yet: wait for it.
    const waiting = s.txs.filter((t) => !t.confirmed);
    if (waiting.length) {
      const statuses = await this.deps.koios(network).txStatus(waiting.map((t) => t.txHash));
      const on = new Set(waiting.filter((t) => statuses.get(t.txHash) != null).map((t) => t.txHash));
      // Never taken, or never seen: its step is built again. It spends the session's
      // UTxOs, so the ledger lets only one of the two land.
      const gone = new Set(waiting.filter((t) => t.kind !== "out" && !on.has(t.txHash) && lost(t, now())).map((t) => t.txHash));
      // A funding Koios didn't take may still have reached the chain: it's looked up before it counts as failed.
      const out = s.txs[0]!;
      const neverFunded =
        !out.confirmed && !on.has(out.txHash) && now() - out.at > (out.unsent ? RESEND_AFTER_MS : FAILED_AFTER_MS);
      if (on.size || gone.size || neverFunded) {
        s = await this.update(network, s.index, (r) => {
          for (const t of r.txs) {
            if (!on.has(t.txHash)) continue;
            t.confirmed = true;
            delete t.unsent;
            delete t.sending;
          }
          r.txs = r.txs.filter((t) => !gone.has(t.txHash));
          if (neverFunded) r.auto!.failed = now();
        });
        if (waiting.some((t) => t.kind === "back" && on.has(t.txHash))) {
          // The private balance has new UTxOs: the next reading should see them.
          await wallet.withKeys(() => session.remove(SESSION_BALANCES_PREFIX + network));
        }
      }
      if (s.txs.some((t) => !t.confirmed)) return;
    }

    const { address, keyHash } = (await this.accounts(network, [s])).get(s.index)!;
    const rows = await this.utxosOf(network, keyHash);
    this.seen.set(`${network}:${s.index}`, rows);
    const kinds = new Set(s.txs.map((t) => t.kind));
    // Brought back, and nothing has arrived since: it's over.
    if (s.txs.at(-1)!.kind === "back" && !rows.length) {
      await this.update(network, s.index, (r) => {
        r.closedAt = now();
      });
      return;
    }
    // Koios doesn't list what's there yet.
    if (!rows.length) return;
    const auto = s.auto!;
    // No order yet: place it, unless the user stopped, or brought the session back by hand.
    if (!kinds.has("swap")) {
      return auto.stopping || kinds.has("back") ? this.bringBack(network, s.index, rows) : this.order(network, s, address, rows);
    }

    const orders = await this.deps.minswap(network).pendingOrders(address);
    if (orders.length) {
      // Waiting for a batcher to fill it, unless the user stopped it.
      if (auto.stopping) await this.cancel(network, s.index, address, rows, orders);
      return;
    }
    // A fill or a refund comes in a transaction the session didn't make; a cancel's refund in its own.
    const own = new Set(s.txs.map((t) => t.txHash));
    const arrived = rows.some((r) => !own.has(r.tx_hash));
    // Minswap no longer lists the order, and nothing's here yet: one of them is behind.
    if (!arrived && !kinds.has("cancel")) return;
    if (arrived && !kinds.has("cancel") && !auto.filled) {
      await this.update(network, s.index, (r) => {
        r.auto!.filled = now();
      });
    }
    await this.bringBack(network, s.index, rows);
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
    const built = await this.inspect(network, s.index, "swap", txCbor, rows, { ...quoteOf(network, ask, est), minAmountOut: min });
    withinFunding(built.summary, approved.fund);
    await this.signAndSend(network, built);
  }

  /** Cancels the session's orders, after Stop: Minswap's cancel, checked, and the key's signature. */
  private async cancel(
    network: NetworkName,
    index: number,
    address: string,
    rows: KoiosUtxo[],
    orders: PendingOrder[],
  ): Promise<void> {
    const txCbor = await this.deps.minswap(network).cancelTx(address, orders.slice(0, 6));
    const built = await this.inspect(network, index, "cancel", txCbor, rows);
    // A cancel only brings the orders' funds back to the session: it pays nothing out but its fee.
    if (built.summary.paid.length) throw new Refused("its cancel pays someone other than this session.");
    await this.signAndSend(network, built);
  }

  /** Brings everything at the session's account back into the private balance. */
  private async bringBack(network: NetworkName, index: number, rows: KoiosUtxo[]): Promise<void> {
    await this.sendBack(network, await this.buildBack(network, index, rows));
  }

  // -------------------------------------------------------------------------

  /** Reads a transaction Minswap built against the session's key: what it spends, and what its key never signs. */
  private async inspect(
    network: NetworkName,
    index: number,
    kind: "swap" | "cancel",
    txCbor: string,
    rows: KoiosUtxo[],
    quote?: SwapQuote,
  ): Promise<KeptTx & { summary: DappTxSummary }> {
    const { wasm, wallet, now } = this.deps;
    let refs: string[];
    try {
      const bytes = hexBytes(txCbor);
      refs = [...new Set([...(bodyOutpoints(bytes, 0) ?? []), ...(bodyOutpoints(bytes, 13) ?? [])])];
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
    return { network, index, kind, txHash: summary.txHash, txCbor, request, quote, builtAt: now(), summary };
  }

  /** Reads a transaction Minswap built, and keeps it for the user's Send. */
  private async review(
    network: NetworkName,
    index: number,
    kind: "swap" | "cancel",
    txCbor: string,
    rows: KoiosUtxo[],
    extra: { quote?: SwapQuote; orders?: number },
  ): Promise<SessionTxReview> {
    const { summary, builtAt: _builtAt, ...kept } = await this.inspect(network, index, kind, txCbor, rows, extra.quote);
    await keep(this.deps, SESSION_TX, kept);
    return { network, index, kind, txHash: summary.txHash, summary, ...extra };
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
    return this.sendRecorded(network, built.index, built.kind, built.txHash, bytes, SESSION_TX, (s) => {
      if (built.kind === "swap" && built.quote && s.swap) {
        s.swap = { ...s.swap, amountOut: built.quote.amountOut, minAmountOut: built.quote.minAmountOut };
      }
    });
  }

  /** The return of everything at the session's account, built and signed by the session's key. */
  private async buildBack(network: NetworkName, index: number, rows: KoiosUtxo[]): Promise<KeptBack> {
    const { wasm, wallet, now } = this.deps;
    const params = await this.deps.koios(network).epochParams();
    const result = await wallet.withKeys(
      (keys) =>
        JSON.parse(
          wasm.buildSessionReturn(keys.oneTime, keys.seedelf, JSON.stringify({ network, params, index, utxos: rows })),
        ) as Omit<SessionBackSummary, "network" | "index"> & { txCbor: string },
    );
    return { ...result, network, index, builtAt: now() };
  }

  /** Sends a return, and puts it in the private history. */
  private async sendBack(network: NetworkName, built: KeptBack): Promise<PendingTx> {
    const pending = await this.sendRecorded(network, built.index, "back", built.txHash, hexBytes(built.txCbor), SESSION_BACK);
    await this.deps.activity?.sent(network, pending, built).catch(() => undefined);
    return pending;
  }

  /**
   * Records a session's transaction, then submits it, so the record always
   * knows what may be on its way. Its page watches it, not Home's banner.
   */
  private async sendRecorded(
    network: NetworkName,
    index: number,
    kind: SessionTx["kind"],
    txHash: string,
    bytes: Uint8Array<ArrayBuffer>,
    kept: string,
    after?: (s: SessionRecord) => void,
  ): Promise<PendingTx> {
    const { wallet, session, now } = this.deps;
    const mine = (s: SessionRecord) => s.txs.find((t) => t.txHash === txHash);
    await this.update(network, index, (s) => {
      const again = mine(s);
      if (again) {
        delete again.unsent;
        again.sending = true;
      } else {
        s.txs.push({ kind, txHash, at: now(), sending: true });
      }
    });
    try {
      await this.submit(network, bytes, txHash);
    } catch (e) {
      await this.update(network, index, (s) => {
        const t = mine(s);
        if (!t) return;
        delete t.sending;
        t.unsent = true;
      });
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
      await rememberSpent(session, bytes);
      await session.remove(kept);
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
      const status = e instanceof SpentInputError ? await koios.txStatus([txHash]).catch(() => undefined) : undefined;
      if (status?.get(txHash) == null) throw e;
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
      const rows = unspent(await readFresh(spent, () => koios.credentialUtxos(creds), (r) => r, this.deps.sleep), spent);
      holdings = new Map(live.map((s) => [s.index, rows.filter((r) => r.payment_cred === keys.get(s.index)!.keyHash)]));
      for (const [index, held] of holdings) this.seen.set(`${network}:${index}`, held);
      let changed = false;
      let returned = false;
      const waiting = live.flatMap((s) => s.txs.filter((t) => !t.confirmed).map((t) => t.txHash));
      if (waiting.length) {
        const statuses = await koios.txStatus(waiting);
        for (const t of live.flatMap((s) => s.txs)) {
          if (!t.confirmed && statuses.get(t.txHash) != null) {
            t.confirmed = true;
            delete t.unsent;
            delete t.sending;
            changed = true;
            returned ||= t.kind === "back";
          }
        }
      }
      for (const s of live) {
        const last = s.txs.at(-1)!;
        // Brought back, and nothing has arrived since: the session is over.
        if (last.kind === "back" && last.confirmed && !holdings.get(s.index)!.length) {
          s.closedAt = now();
          changed = true;
        }
      }
      if (changed) await this.save(network, book);
      if (returned) await wallet.withKeys(() => session.remove(SESSION_BALANCES_PREFIX + network));
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
    // A step's transaction Koios never took isn't shown: it's built again.
    const txs = s.txs.filter((t) => t.kind === "out" || !t.unsent);
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
      txs: txs.map(({ unsent: _unsent, sending: _sending, ...t }) => t),
      ...(s.swap ? { swap: s.swap } : {}),
      holding: utxos ? holdingOf(utxos) : null,
      ...(s.auto ? { auto: autoView(s.auto, txs, stage) } : {}),
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
    const { wallet, session } = this.deps;
    const koios = this.deps.koios(network);
    const spent = await wallet.withKeys(() => spentSet(session));
    return unspent(await readFresh(spent, () => koios.credentialUtxos([keyHash]), (r) => r, this.deps.sleep), spent);
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

/** Where a swap that runs itself is at, for its timeline. */
function autoView(auto: AutoRecord, txs: RecordedTx[], stage: SessionView["stage"]): SessionAuto {
  const has = (kind: SessionTx["kind"], confirmed = false) => txs.some((t) => t.kind === kind && (!confirmed || t.confirmed));
  const step: SessionAuto["step"] =
    stage === "closed"
      ? "done"
      : stage === "funding" || stage === "failed"
        ? "funding"
        : has("back")
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
  };
}

/**
 * The runner's limit on what Minswap built: what leaves the session's
 * account, its fee included, is no more than was funded for the swap.
 */
function withinFunding(s: DappTxSummary, fund: SwapQuote["fund"]): void {
  let lovelace = BigInt(s.fee);
  const tokens = new Map<string, bigint>();
  for (const p of s.paid) {
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
 * What a session's key never signs, whatever Minswap sent: anything that needs
 * another key, staking or governance, minting, or a spend the wallet can't see.
 */
function refuseOddities(s: DappTxSummary, index: number): void {
  if (!s.complete || s.othersSign) throw new Refused("it needs someone else's signature too.");
  if (s.signs.length !== 1 || s.signs[0] !== `0/${index}`) throw new Refused("it isn't signed by this session's key alone.");
  if (s.unknownInputs.length) throw new Refused("it spends UTxOs the wallet couldn't find.");
  if (s.certificates.length || s.withdrawals.length || s.votes || s.proposals) {
    throw new Refused("it does something with staking or governance.");
  }
  if (s.mint.length) throw new Refused("it mints or burns tokens.");
}
