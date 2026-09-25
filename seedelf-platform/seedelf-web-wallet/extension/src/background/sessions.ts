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
//         the session's key alone, the user reviews it, and the key signs it.
//         The DEX's batchers fill the order, paying the account.
// cancel  an order that isn't filled is cancelled the same way; the refund
//         comes back to the account.
// back    everything at the account moves into the private balance under
//         fresh registers (the CLI's external sweep), signed by the key.
//
// The accounts are account 24301', payment key 0/index, at an address with
// the shared Seedelf staking part (WebAssembly's OneTimeAccounts). The list
// of sessions is a sealed private record per network. The wallet reads a
// session's account only when asked, never in the background: one Koios
// request for all the open ones, and one tx_status for what's waiting.

import type { NetworkName } from "../networks";
import type {
  DappTxSummary,
  Paid,
  PendingTx,
  SessionBackSummary,
  SessionOrder,
  SessionOutSummary,
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
import type { Estimate, Minswap } from "./minswap";
import { SESSION_PENDING } from "./pending";
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

interface SessionRecord {
  index: number;
  createdAt: number;
  txs: Array<SessionTx & { unsent?: boolean }>;
  swap?: SessionView["swap"];
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
}

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

export class SessionService {
  constructor(private readonly deps: SessionDeps) {}

  /** This network's sessions, newest first. `refresh` reads their accounts and what's waiting. */
  async list(network: NetworkName, refresh = false): Promise<SessionView[]> {
    const { wallet, session, now } = this.deps;
    const book = await this.book(network);
    const live = book.sessions.filter((s) => !s.closedAt);
    const keys = await this.accounts(network, book.sessions.map((s) => s.index));
    let holdings: Map<number, KoiosUtxo[]> | undefined;
    if (refresh && live.length) {
      const koios = this.deps.koios(network);
      const spent = await wallet.withKeys(() => spentSet(session));
      const creds = live.map((s) => keys.get(s.index)!.keyHash);
      const rows = unspent(await readFresh(spent, () => koios.credentialUtxos(creds), (r) => r, this.deps.sleep), spent);
      holdings = new Map(live.map((s) => [s.index, rows.filter((r) => r.payment_cred === keys.get(s.index)!.keyHash)]));
      let changed = false;
      const waiting = live.flatMap((s) => s.txs.filter((t) => !t.confirmed).map((t) => t.txHash));
      if (waiting.length) {
        const statuses = await koios.txStatus(waiting);
        for (const t of live.flatMap((s) => s.txs)) {
          if (!t.confirmed && statuses.get(t.txHash) != null) {
            t.confirmed = true;
            delete t.unsent;
            changed = true;
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
    }
    return [...book.sessions]
      .reverse()
      .map((s) => this.view(network, s, keys.get(s.index)!.address, holdings?.get(s.index)));
  }

  /** Forgets a session whose funding never reached the chain. Its index isn't used again. */
  async forget(network: NetworkName, index: number): Promise<SessionView[]> {
    const views = await this.list(network, true);
    const view = views.find((v) => v.index === index);
    if (!view) throw new Error("There's no such session.");
    if (view.stage !== "failed") throw new Error("Only a session whose funding never reached the chain can be forgotten.");
    const book = await this.book(network);
    await this.save(network, { ...book, sessions: book.sessions.filter((s) => s.index !== index) });
    return this.list(network);
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
    const address = (await this.accounts(network, [index])).get(index)!.address;
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
    const kept: Omit<KeptOut, "builtAt"> & SessionOutSummary = { ...summary, txCbor, seed, index, swap };
    await keep(this.deps, SESSION_OUT, kept);
    return summary;
  }

  /** Records the session, then sends its funding payment. */
  async outSubmit(network: NetworkName, txHash: string): Promise<PendingTx> {
    const { wallet, session, now } = this.deps;
    const built = await wallet.withKeys(() => session.get<KeptOut>(SESSION_OUT));
    if (!built || built.txHash !== txHash || built.network !== network) {
      throw new Error("That payment isn't ready to send. Review it again.");
    }
    if (now() - built.builtAt > BUILT_TTL_MS) throw new Error("That payment was built more than 10 minutes ago. Review it again.");
    const book = await this.book(network);
    if (built.index < book.next) throw new Error("That session was started already. Start a new one.");
    // Recorded before it's sent: whatever happens next, this index is never used again.
    const record: SessionRecord = {
      index: built.index,
      createdAt: now(),
      txs: [{ kind: "out", txHash, at: now() }],
      swap: built.swap,
    };
    await this.save(network, { next: built.index + 1, sessions: [...book.sessions, record] });
    try {
      return await send(this.deps, network, txHash, SESSION_OUT, "session-out", "payment");
    } catch (e) {
      await this.update(network, built.index, (s) => {
        s.txs[0]!.unsent = true;
      });
      throw e;
    }
  }

  /** Has Minswap build the session's swap, freshly quoted, and reads it against the session's key. */
  async swapBuild(network: NetworkName, index: number): Promise<SessionTxReview> {
    const s = await this.live(network, index);
    if (!s.swap) throw new Error("This session isn't for a swap.");
    if (s.txs.some((t) => t.kind === "swap")) throw new Error("This session's swap was sent already.");
    const { address, keyHash } = (await this.accounts(network, [index])).get(index)!;
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
    const { address } = (await this.accounts(network, [index])).get(index)!;
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
    await this.live(network, index);
    const { address, keyHash } = (await this.accounts(network, [index])).get(index)!;
    const minswap = this.deps.minswap(network);
    const orders = (await minswap.pendingOrders(address)).slice(0, 6);
    if (!orders.length) throw new Error("No order of this session is waiting: it was filled, or cancelled already.");
    const txCbor = await minswap.cancelTx(address, orders);
    const rows = await this.utxosOf(network, keyHash);
    return this.review(network, index, "cancel", txCbor, rows, { orders: orders.length });
  }

  /** Signs the swap or cancel built last with the session's key, puts the signature in, and submits it. */
  async txSubmit(network: NetworkName, txHash: string, kind: "swap" | "cancel"): Promise<PendingTx> {
    const { wasm, wallet, session, now } = this.deps;
    const built = await wallet.withKeys(() => session.get<KeptTx>(SESSION_TX));
    const what = kind === "swap" ? "swap" : "cancel";
    if (!built || built.txHash !== txHash || built.network !== network || built.kind !== kind) {
      throw new Error(`That ${what} isn't ready to send. Review it again.`);
    }
    if (now() - built.builtAt > BUILT_TTL_MS) throw new Error(`That ${what} was built more than 10 minutes ago. Review it again.`);
    const whole = await wallet.withKeys((keys) => {
      const signed = JSON.parse(wasm.signSessionTx(keys.oneTime, built.request)) as { witnessSet: string; summary: DappTxSummary };
      if (signed.summary.txHash !== txHash) throw new Error("Signing changed the transaction, so it wasn't sent.");
      return wasm.attachWitnesses(built.txCbor, signed.witnessSet);
    });
    const bytes = hexBytes(whole);
    if (txId(bytes) !== txHash) throw new Error("Putting the signature in changed the transaction, so it wasn't sent.");
    await this.submit(network, bytes, txHash);
    await this.update(network, built.index, (s) => {
      s.txs.push({ kind, txHash, at: now() });
      if (kind === "swap" && built.quote && s.swap) {
        s.swap = { ...s.swap, amountOut: built.quote.amountOut, minAmountOut: built.quote.minAmountOut };
      }
    });
    return this.watch(network, txHash, kind === "swap" ? "session-swap" : "session-cancel", SESSION_TX, bytes);
  }

  /** Builds and signs the return of everything at the session's account into the private balance. */
  async backBuild(network: NetworkName, index: number): Promise<SessionBackSummary> {
    const { wasm, wallet, session, now } = this.deps;
    const s = await this.live(network, index);
    const { address, keyHash } = (await this.accounts(network, [index])).get(index)!;
    // Money that arrives after the return would need another one.
    if (s.txs.some((t) => t.kind === "swap") && (await this.deps.minswap(network).pendingOrders(address)).length) {
      throw new Error("An order of this session is still waiting. Cancel it, or wait for it to fill, then bring the session back.");
    }
    const rows = await this.utxosOf(network, keyHash);
    if (!rows.length) throw new Error("The session's account is empty, so there's nothing to bring back.");
    const params = await this.deps.koios(network).epochParams();
    const result = await wallet.withKeys(
      (keys) =>
        JSON.parse(
          wasm.buildSessionReturn(keys.oneTime, keys.seedelf, JSON.stringify({ network, params, index, utxos: rows })),
        ) as Omit<SessionBackSummary, "network" | "index"> & { txCbor: string },
    );
    const { txCbor, ...rest } = result;
    const summary: SessionBackSummary = { ...rest, network, index };
    await wallet.withKeys(() => session.set(SESSION_BACK, { ...summary, txCbor, builtAt: now() } satisfies KeptBack));
    return summary;
  }

  /** Sends the return built last. */
  async backSubmit(network: NetworkName, txHash: string): Promise<PendingTx> {
    const { wallet, session, now } = this.deps;
    const built = await wallet.withKeys(() => session.get<KeptBack>(SESSION_BACK));
    if (!built || built.txHash !== txHash || built.network !== network) {
      throw new Error("That return isn't ready to send. Review it again.");
    }
    if (now() - built.builtAt > BUILT_TTL_MS) throw new Error("That return was built more than 10 minutes ago. Review it again.");
    const bytes = hexBytes(built.txCbor);
    await this.submit(network, bytes, txHash);
    await this.update(network, built.index, (s) => {
      s.txs.push({ kind: "back", txHash, at: now() });
    });
    const pending = await this.watch(network, txHash, "session-back", SESSION_BACK, bytes);
    await this.deps.activity?.sent(network, pending, built).catch(() => undefined);
    return pending;
  }

  // -------------------------------------------------------------------------

  /** Reads a transaction Minswap built against the session's key, and keeps it for Send. */
  private async review(
    network: NetworkName,
    index: number,
    kind: "swap" | "cancel",
    txCbor: string,
    rows: KoiosUtxo[],
    extra: { quote?: SwapQuote; orders?: number },
  ): Promise<SessionTxReview> {
    const { wasm, wallet } = this.deps;
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
    if (kind === "swap" && others.length) {
      throw new Error("Minswap's swap spends something that isn't this session's, so the wallet won't sign it.");
    }
    const foreign = others.length ? await this.deps.koios(network).utxoInfo(others) : [];
    const request = JSON.stringify({
      network,
      txCbor,
      keys: [{ role: 0, index }],
      inputs: [...refs.flatMap((r) => own.get(r) ?? []), ...foreign],
      partialSign: false,
    });
    const summary = await wallet.withKeys((keys) => JSON.parse(wasm.inspectSessionTx(keys.oneTime, request)) as DappTxSummary);
    refuseOddities(summary, index);
    const kept: Omit<KeptTx, "builtAt"> = { network, index, kind, txHash: summary.txHash, txCbor, request, quote: extra.quote };
    await keep(this.deps, SESSION_TX, kept);
    return { network, index, kind, txHash: summary.txHash, summary, ...extra };
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

  /** Hands a submitted transaction to the pending watch, and drops what was kept for it. */
  private async watch(
    network: NetworkName,
    txHash: string,
    kind: PendingTx["kind"],
    kept: string,
    bytes: Uint8Array,
  ): Promise<PendingTx> {
    const { wallet, session, now } = this.deps;
    const pending: PendingTx = { kind, network, txHash, submittedAt: now(), confirmations: null };
    await wallet.withKeys(async () => {
      await rememberSpent(session, bytes);
      await session.remove(kept);
      await session.set(SESSION_PENDING, pending);
      await session.remove(SESSION_BALANCES_PREFIX + network);
    });
    return pending;
  }

  private view(network: NetworkName, s: SessionRecord, address: string, utxos?: KoiosUtxo[]): SessionView {
    const out = s.txs[0]!;
    const last = s.txs.at(-1)!;
    const funded = out.confirmed || !!utxos?.length;
    const stage: SessionView["stage"] = s.closedAt
      ? "closed"
      : !funded
        ? out.unsent || this.deps.now() - out.at > FAILED_AFTER_MS
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
      txs: s.txs.map(({ unsent: _unsent, ...t }) => t),
      ...(s.swap ? { swap: s.swap } : {}),
      holding: utxos ? holdingOf(utxos) : null,
    };
  }

  /** A session that isn't over, or why not. */
  private async live(network: NetworkName, index: number): Promise<SessionRecord> {
    const s = (await this.book(network)).sessions.find((r) => r.index === index);
    if (!s) throw new Error("There's no such session.");
    if (s.closedAt) throw new Error("That session is over: everything in it came back.");
    return s;
  }

  /** The session's account's UTxOs, fresh, less what this wallet has spent. */
  private async utxosOf(network: NetworkName, keyHash: string): Promise<KoiosUtxo[]> {
    const { wallet, session } = this.deps;
    const koios = this.deps.koios(network);
    const spent = await wallet.withKeys(() => spentSet(session));
    return unspent(await readFresh(spent, () => koios.credentialUtxos([keyHash]), (r) => r, this.deps.sleep), spent);
  }

  /** Each index's address and payment key hash. */
  private accounts(network: NetworkName, indexes: number[]): Promise<Map<number, { address: string; keyHash: string }>> {
    const { wasm, wallet } = this.deps;
    const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;
    return wallet.withKeys(
      (keys) =>
        new Map(indexes.map((i) => [i, { address: keys.oneTime.address(net, i), keyHash: keys.oneTime.keyHash(i) }])),
    );
  }

  private async book(network: NetworkName): Promise<Book> {
    return (await this.deps.store.get<Book>(`sessions.${network}`)) ?? { next: 0, sessions: [] };
  }

  private save(network: NetworkName, book: Book): Promise<void> {
    return this.deps.store.set(`sessions.${network}`, book);
  }

  private async update(network: NetworkName, index: number, change: (s: SessionRecord) => void): Promise<void> {
    const book = await this.book(network);
    const s = book.sessions.find((r) => r.index === index);
    if (!s) return;
    change(s);
    await this.save(network, book);
  }
}

/**
 * What a session's key never signs, whatever Minswap sent: anything that needs
 * another key, staking or governance, minting, or a spend the wallet can't see.
 */
function refuseOddities(s: DappTxSummary, index: number): void {
  const refuse = (why: string) => {
    throw new Error(`The wallet won't sign what Minswap built: ${why}`);
  };
  if (!s.complete || s.othersSign) refuse("it needs someone else's signature too.");
  if (s.signs.length !== 1 || s.signs[0] !== `0/${index}`) refuse("it isn't signed by this session's key alone.");
  if (s.unknownInputs.length) refuse("it spends UTxOs the wallet couldn't find.");
  if (s.certificates.length || s.withdrawals.length || s.votes || s.proposals) refuse("it does something with staking or governance.");
  if (s.mint.length) refuse("it mints or burns tokens.");
}
