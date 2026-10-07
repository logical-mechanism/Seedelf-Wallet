// Minswap's aggregator API (https://docs.minswap.org/developer/aggregator-api),
// for swaps in private sessions: a quote, an unsigned swap for a sender, the
// sender's open orders, and an unsigned cancel. It routes across Cardano's
// DEXes; the orders it places are filled by each DEX's batchers.
//
// `build-tx` takes only a sender: it picks the sender's UTxOs from its own
// view of the chain, and the proceeds and any refund go back to the sender.
// That's why a swap runs from a session's one-time account (sessions.ts),
// funded and confirmed first. Minswap sees that account's address, the pair,
// the amounts and the IP address, which lets it group the swaps made from
// it. It's never given the private balance, though Max and Half, worked out
// from it, tell it roughly how much that holds (Swaps.tsx rounds them down
// to a whole unit, privacy review §2.13).
//
// It answers browsers with CORS headers, so the wallet needs no host
// permission for it (networks.ts).

import { t } from "../i18n";
import { blake2b } from "@noble/hashes/blake2.js";

import { skip } from "./cbor";
import { SERVICE_FETCH, type FetchLike } from "./koios";

/** "lovelace", or a token's policy ID and name in hex, run together. */
export type TokenId = string;

/** What a swap asks for. `amount` is in the input's smallest unit. */
export interface SwapAsk {
  amount: string;
  tokenIn: TokenId;
  tokenOut: TokenId;
  /** Percent, e.g. 0.5. */
  slippage: number;
}

/** One leg of a route, as `estimate` returns it. */
export interface RouteLeg {
  pool_id: string;
  protocol: string;
  token_in: TokenId;
  token_out: TokenId;
  amount_in: string;
  amount_out: string;
  min_amount_out: string;
  lp_fee: string;
  dex_fee: string;
  deposits: string;
  price_impact: number;
}

/** `estimate`'s answer (amounts in smallest units, as decimal strings). */
export interface Estimate {
  token_in: TokenId;
  token_out: TokenId;
  amount_in: string;
  amount_out: string;
  min_amount_out: string;
  total_lp_fee: string;
  total_dex_fee: string;
  /** ADA the orders lock and pay back with the proceeds. */
  deposits: string;
  avg_price_impact: number;
  paths: RouteLeg[][];
  aggregator_fee: string | null;
  aggregator_fee_percent: number | null;
}

export interface PendingOrder {
  owner_address: string;
  protocol: string;
  token_in: unknown;
  token_out: unknown;
  amount_in: string;
  min_amount_out: string;
  created_at: number;
  /** The order's UTxO, `txhash#index`. */
  tx_in: string;
  dex_fee: string;
  deposit: string;
}

export interface SwapToken {
  token_id: TokenId;
  ticker: string | null;
  project_name: string | null;
  decimals: number | null;
  is_verified: boolean | null;
}

/**
 * What went wrong at Minswap, for a page that says it in a few words (a
 * swap's retry line): it asked the wallet to slow down, didn't answer, or
 * hasn't seen the funding yet. Told where Minswap's answer is read, so the
 * page never reads the message, which is in the user's language.
 */
export type MinswapTrouble = "rate-limited" | "silent" | "funding-unseen";

export class MinswapError extends Error {
  constructor(
    message: string,
    readonly trouble?: MinswapTrouble,
  ) {
    super(message);
  }
}

/**
 * Minswap's own words, which stay English, for a build it refuses because it
 * doesn't see the money to build from yet: a funding not on its backend yet.
 */
const FUNDING_UNSEEN = /no wallet utxos|insufficient balance/i;

/**
 * DEXes that swap straight against their pools in the same transaction,
 * rather than taking an order for a batcher to fill: the transaction spends
 * the pools' UTxOs, runs their scripts, and brings someone else's collateral.
 * A session signs only transactions that spend nothing but its own UTxOs
 * (sessions.ts), so routing leaves these out. DanogoCLMMV1 was seen doing it
 * on preprod (2026-09-25); a bonding curve and Djed's minting work the same
 * way. The session's check stays: any other DEX that does it pauses the swap.
 */
export const DIRECT_PROTOCOLS = ["DanogoCLMMV1", "ChakraBondingCurve", "OpenDjedV1"];

/**
 * On preprod, Minswap builds Splash's orders with Splash's mainnet order
 * address (header 0x11, seen 2026-09-25), and a preprod node refuses an
 * output on another network. Mainnet's are fine.
 */
const PREPROD_BROKEN = ["Splash", "SplashStable"];

/**
 * The DEXes a mainnet swap goes through: those whose orders the session's
 * check (sessions.ts `checkOrder`) reads as the session's, by the order
 * details each DEX publishes. Each order names its owner's key as a 28-byte
 * field of its own (an address's payment part, or a signature's key), and
 * sits at a script with no staking part or the sender's:
 * - Minswap (V1) and MinswapStable: the sender's and the receiver's
 *   addresses. V1's passes on a real order Minswap built on preprod.
 * - MinswapV2: the canceller's key, and the refund and success receivers.
 * - SundaeSwap: the destination address.
 * - SundaeSwapV3: read exactly, at its order script (SUNDAE_V3): owned by
 *   the session's own stake key, which signs its cancel too, and paying the
 *   session's address (chunk 24). Only as a path of its own (outOfPlace).
 * - WingRiders, WingRidersV2 and WingRidersStableV2: the owner's and the
 *   beneficiary's addresses.
 * - Splash: the cancelling key and the redeemer's address. Spectrum: the
 *   reward key.
 * None was checked on a mainnet order yet: the owner's smoke test is one
 * small swap through each before launch. A route through any other is
 * refused before it's funded (quote), rather than pause once it is.
 */
export const MAINNET_PROTOCOLS: readonly string[] = [
  "Minswap",
  "MinswapV2",
  "MinswapStable",
  "SundaeSwap",
  "SundaeSwapV3",
  "WingRiders",
  "WingRidersV2",
  "WingRidersStableV2",
  "Splash",
  "Spectrum",
];

/**
 * DEXes Minswap routes through on mainnet whose orders the session's check
 * refuses, so routing leaves them out rather than have a funded swap pause,
 * or a quote be refused (final review sessions-4): VyFinance names its
 * owner as one 56-byte field, the key and the staking part together, and
 * MuesliSwap's orders are staked to its own key, not the sender's.
 *
 * SplashStable too: the only stable-pool validator Splash deployed was
 * drained on 2026-09-13, and its README says not to use it (chunk 24).
 *
 * SundaeSwapV3 was here (independent review M16) until chunk 24 built what
 * it needed: Minswap builds its orders under a fixed staking part that
 * isn't the sender's, owned by the sender's stake key, and they never
 * expire, so the check pins its order script and that staking part, and
 * Stop's cancel of one is signed by 0/i and 2/i, and by nothing else.
 */
const MAINNET_REFUSED = ["VyFinance", "MuesliSwap", "SplashStable"];

/**
 * SundaeSwap V3's order script, by network, and the staking part Minswap
 * builds every V3 order under there: the same for every sender (mainnet's
 * unregistered; seen on 25 open orders on mainnet and in a preprod build,
 * 2026-10-06). A single-leg order names the sender's stake key as its owner,
 * whose signature alone cancels it, and the sender's address as its
 * destination, with no datum; V3's pools pay the destination exactly, and
 * its orders never expire. sessions.ts `checkOrder` reads one exactly
 * (`sundaeV3Order`), and Stop's cancel of one is signed by the session's
 * stake key too.
 */
export const SUNDAE_V3: Readonly<Record<"preprod" | "mainnet", { order: string; stake: string }>> = {
  mainnet: {
    order: "fa6a58bbe2d0ff05534431c8e2f0ef2cbdc1602a8456e4b13c8f3077",
    stake: "f217f435f5f34dba69830d9ada013b5c290a4eee6078371cae55298b",
  },
  preprod: {
    order: "a989aa2fe6e3866688631162d8ccc830d39ce38b3f11acd3880c165f",
    stake: "c41401cdf24ad644ff8dd55b00cbb7f2e057c7ed0b79d82ef2e38377",
  },
};

/**
 * DEXes a route may go through only as a path of their own, one leg. As the
 * first of two legs, a SundaeSwap V3 order pays Minswap's adapter and is
 * owned by Minswap's key, so the session could never cancel it; as a later
 * leg, it's placed by the first leg's batcher, and the session never sees it.
 * Either way, an order nobody the wallet holds can cancel that never expires.
 */
const ONE_LEG_ONLY = ["SundaeSwapV3"];

/**
 * Danogo's concentrated-liquidity pools' script, by network: a DEX that
 * swaps against its pools in the swap itself, with no order (chunk 24). A
 * session's direct swap spends UTxOs at it and nothing else of anyone's but
 * a collateral signed already, recreates its pools there, and withdraws
 * zero from it and from each spent pool's staking script (sessions.ts
 * `directSpends`, `checkDirect`). Seen in swaps Minswap built, on mainnet and
 * on preprod, 2026-10-06.
 */
export const DANOGO_POOL: Readonly<Record<"preprod" | "mainnet", string>> = {
  mainnet: "d8b69fc53637bcfadbc4469083f706bc293f4d9d2296646c5ca167bb",
  preprod: "04041c3c6ba87b33f2c9eb7f7dbeae3b26003c3e199d438bb99932a2",
};

/**
 * DEXes that swap against their pools whose swaps a session reads: a route
 * through one goes through nothing else. Its proceeds come in the swap
 * itself, which the runner counts as the fill, and the session's check
 * holds a swap to its minimum by what it pays back; an order beside it would
 * be filled later, under a minimum the check never reads.
 */
const DIRECT_CHECKED = ["DanogoCLMMV1"];

/**
 * The DEXes of `est`'s route that sit where a session's check can't follow
 * them, to be asked for again without: one that may go only in a path of its
 * own, in a longer one (ONE_LEG_ONLY), and one that swaps against its pools
 * beside any other leg (DIRECT_CHECKED). Danogo split across two of its own
 * pools is one swap, and fine.
 */
export function outOfPlace(est: Pick<Estimate, "paths">): string[] {
  const legs = est.paths.flat().map((leg) => leg.protocol);
  const long = est.paths.filter((path) => path.length > 1).flatMap((path) => path.map((leg) => leg.protocol));
  const found = long.filter((p) => ONE_LEG_ONLY.includes(p) || DIRECT_CHECKED.includes(p));
  for (const p of DIRECT_CHECKED) if (legs.includes(p) && legs.some((q) => q !== p)) found.push(p);
  return [...new Set(found)];
}

/**
 * Every DEX Minswap's aggregator routes through, by the names its
 * `exclude_protocols` takes: any other, and it refuses the whole request.
 * Checked against the live API, not only its published list: an unknown
 * name's 400 answer names one allowed constant per DEX, 19 on 2026-09-27,
 * and each of these is taken (independent review M17). A DEX Minswap adds
 * after that isn't here, and routing can go through it (excludedProtocols).
 */
export const MINSWAP_PROTOCOLS: readonly string[] = [
  "MinswapV2",
  "Minswap",
  "MinswapStable",
  "MuesliSwap",
  "Splash",
  "SundaeSwapV3",
  "SundaeSwap",
  "SundaeSwapStable",
  "VyFinance",
  "CswapV1",
  "WingRidersV2",
  "WingRiders",
  "WingRidersStableV2",
  "WingRidersStableV1",
  "Spectrum",
  "SplashStable",
  "ChakraBondingCurve",
  "OpenDjedV1",
  "DanogoCLMMV1",
];

/**
 * What routing leaves out on `network`. On mainnet, every DEX Minswap
 * offers that isn't on MAINNET_PROTOCOLS (independent review M17): its
 * `exclude_protocols` is a list to leave out, and its `include_protocols`
 * isn't kept to (asked for MinswapV2 alone, it routed through Minswap V1
 * too), so the list the wallet checks is turned into one Minswap keeps.
 * build-tx routes again on Minswap's side with this list, so the order it
 * builds goes through the same DEXes as the estimate the runner checked
 * (uncheckedProtocols), except one Minswap adds after this list was
 * written: which DEX an order goes to is still Minswap's to build, as its
 * receivers and its minimum are (sessions.ts checkOrder).
 */
export function excludedProtocols(network: "preprod" | "mainnet"): string[] {
  if (network === "preprod") return [...DIRECT_PROTOCOLS, ...PREPROD_BROKEN];
  const unchecked = MINSWAP_PROTOCOLS.filter((p) => !MAINNET_PROTOCOLS.includes(p));
  return [...new Set([...DIRECT_PROTOCOLS, ...MAINNET_REFUSED, ...unchecked])];
}

/**
 * The DEXes of `est`'s route a swap on `network` doesn't go through: on
 * mainnet, any not on MAINNET_PROTOCOLS (CswapV1, whose orders the wallet
 * doesn't know, or one Minswap adds later); on either network, one where
 * the session's check can't follow it (`outOfPlace`). Otherwise none on
 * preprod, where only the check stands.
 */
export function uncheckedProtocols(network: "preprod" | "mainnet", est: Pick<Estimate, "paths">): string[] {
  const legged = outOfPlace(est);
  if (network !== "mainnet") return legged;
  const unknown = est.paths.flat().map((leg) => leg.protocol).filter((p) => !MAINNET_PROTOCOLS.includes(p));
  return [...new Set([...unknown, ...legged])];
}

const TIMEOUT_MS = 20_000;

export class Minswap {
  constructor(
    private readonly base: string,
    private readonly fetchFn: FetchLike = (url, init) => fetch(url, init),
    /** Protocols routing leaves out (`excludedProtocols`). */
    private readonly exclude: string[] = DIRECT_PROTOCOLS,
  ) {}

  /**
   * The best route for `ask` through DEXes that take orders, and what it's
   * expected to give; `avoid`, DEXes left out of this one too.
   */
  estimate(ask: SwapAsk, avoid: string[] = []): Promise<Estimate> {
    return this.post<Estimate>("estimate", { ...routed(ask, [...this.exclude, ...avoid]), amount_in_decimal: false });
  }

  /**
   * An unsigned swap from `sender`, for the ask quoted. Minswap quotes it
   * again and puts its own fresh minimum in the order, amount_out / (1 +
   * slippage%) rounded down, whatever `minAmountOut` is: that's only the
   * least it may be, and a build under it is refused, a 400 whose message
   * has the comparison backwards ("Minimum amount out is less than or equal
   * to the estimated minimum amount out", seen 2026-10-05 on mainnet).
   * `avoid`: what the estimate it's built from left out besides, as Minswap
   * routes it again.
   */
  async buildTx(sender: string, minAmountOut: string, ask: SwapAsk, avoid: string[] = []): Promise<string> {
    const { cbor } = await this.post<{ cbor: string }>("build-tx", {
      sender,
      min_amount_out: minAmountOut,
      estimate: routed(ask, [...this.exclude, ...avoid]),
      amount_in_decimal: false,
    });
    return cbor;
  }

  /** `owner`'s orders that aren't filled, cancelled or expired yet. */
  async pendingOrders(owner: string): Promise<PendingOrder[]> {
    const { orders } = await this.request<{ orders: PendingOrder[] }>(
      "GET",
      `pending-orders?owner_address=${encodeURIComponent(owner)}&amount_in_decimal=false`,
    );
    return orders;
  }

  /** An unsigned cancel of up to six of `sender`'s orders. */
  async cancelTx(sender: string, orders: Array<Pick<PendingOrder, "tx_in" | "protocol">>): Promise<string> {
    const { cbor } = await this.post<{ cbor: string }>("cancel-tx", {
      sender,
      orders: orders.map((o) => ({ tx_in: o.tx_in, protocol: o.protocol })),
    });
    return cbor;
  }

  /** Tokens by name, ticker or ID. */
  async tokens(query: string, onlyVerified = true): Promise<SwapToken[]> {
    const { tokens } = await this.post<{ tokens: SwapToken[] }>("tokens", { query, only_verified: onlyVerified });
    return tokens;
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.base}/${path}`, {
        ...SERVICE_FETCH,
        method,
        headers: method === "POST" ? { accept: "application/json", "content-type": "application/json" } : { accept: "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      const cause = e instanceof Error ? e.message : String(e);
      throw new MinswapError(t("minswap.unreachable", { cause }), "silent");
    }
    if (response.ok) return (await response.json()) as T;
    const text = await response.text().catch(() => "");
    if (response.status === 429) throw new MinswapError(t("minswap.rateLimited"), "rate-limited");
    let message = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as { message?: unknown; error?: unknown };
      message = String(parsed.message ?? parsed.error ?? message);
    } catch {
      // Not JSON: keep the text.
    }
    throw new MinswapError(
      t("minswap.refused", { status: response.status, why: message }),
      FUNDING_UNSEEN.test(message) ? "funding-unseen" : undefined,
    );
  }
}

/** An ask as Minswap's estimate takes it: the route through DEXes that take orders only. */
function routed(ask: SwapAsk, exclude: string[]) {
  return {
    amount: ask.amount,
    token_in: ask.tokenIn,
    token_out: ask.tokenOut,
    slippage: ask.slippage,
    exclude_protocols: [...new Set(exclude)],
  };
}

/** One output of a transaction Minswap built, as a session's checks read it. */
export interface BuiltOutput {
  /** Its address's bytes, hex. */
  address: string;
  lovelace: bigint;
  /** It carries tokens too. */
  tokens: boolean;
  /**
   * Its datum's CBOR, hex: inline, or the one the transaction carries for
   * its hash. Null when it has none, or names one the transaction doesn't
   * carry.
   */
  datum: string | null;
}

/**
 * Where a transaction Minswap built pays: each output's address, ADA and
 * datum. An order's datum is its details (who it's for, what it gives); a
 * DEX that keeps it by hash carries it in the witness set, as Minswap's V1
 * orders do. Throws on bytes it can't read.
 */
export function builtOutputs(tx: Uint8Array): BuiltOutput[] {
  if (tx[0] !== 0x84) throw new Error(t("worker.cbor.notFourItems"));
  const witnesses = skip(tx, 1);
  const carried = new Map<string, string>();
  for (const [key, at] of entries(tx, witnesses)) {
    if (key !== 4) continue;
    for (const d of items(tx, at)) {
      const datum = tx.subarray(d, skip(tx, d));
      carried.set(hex(blake2b(datum, { dkLen: 32 })), hex(datum));
    }
  }
  const outputs = entries(tx, 1).find(([key]) => key === 1);
  if (!outputs) throw new Error(t("minswap.cbor.noOutputs"));
  return items(tx, outputs[1]).map((o) => {
    const fields = new Map<number, number>();
    if (head(tx, o).major === 5) {
      for (const [key, at] of entries(tx, o)) fields.set(key, at);
    } else {
      items(tx, o).forEach((at, i) => fields.set(i, at));
    }
    const address = bytesAt(tx, fields.get(0));
    const value = fields.get(1);
    if (value === undefined) throw new Error(t("minswap.cbor.noValue"));
    const coin = head(tx, value);
    const [lovelace, tokens] =
      coin.major === 0 ? [coin.n, false] : [head(tx, items(tx, value)[0]!).n, head(tx, items(tx, value)[1]!).n > 0n];
    // A legacy output's third field is its datum's hash; a map's, `[0, hash]` or `[1, #6.24(datum)]`.
    let datum: string | null = null;
    const option = fields.get(2);
    if (option !== undefined && head(tx, o).major === 5) {
      const [which, inner] = items(tx, option);
      if (head(tx, which!).n === 1n) {
        const tag = head(tx, inner!);
        if (tag.major !== 6 || tag.n !== 24n) throw new Error(t("minswap.cbor.datumNotWrapped"));
        datum = hex(bytesAt(tx, tag.p));
      } else {
        datum = carried.get(hex(bytesAt(tx, inner))) ?? null;
      }
    } else if (option !== undefined) {
      datum = carried.get(hex(bytesAt(tx, option))) ?? null;
    }
    return { address: hex(address), lovelace, tokens, datum };
  });
}

/** What a SundaeSwap V3 order says, as far as a session's check reads it. */
export interface SundaeV3Order {
  /** The key whose signature alone cancels it, when its owner is one signature. */
  owner: string | null;
  /**
   * Where its scoop pays, when that's an address under a key, with no datum:
   * the key's hash, and its staking key's when it has one.
   */
  pays: { payment: string; stake: string | null } | null;
}

/**
 * Reads a SundaeSwap V3 (or Stableswaps) order's datum, `[pool, owner,
 * max_protocol_fee, destination, details, extension]` (sundae-contracts
 * `lib/types/order.ak`): its owner, a `MultisigScript`, and its destination,
 * `Fixed { address, datum }` or `Self`. Null when it isn't one.
 */
export function sundaeV3Order(datum: string): SundaeV3Order | null {
  try {
    const b = Uint8Array.from(datum.match(/../g) ?? [], (x) => Number.parseInt(x, 16));
    const order = constr(b, 0);
    if (order.index !== 0 || order.fields.length !== 6) return null;
    // Signature(key) is constructor 0 of MultisigScript, its one field the key's hash.
    const owner = constr(b, order.fields[1]!);
    const ownerKey = owner.index === 0 && owner.fields.length === 1 ? keyHashAt(b, owner.fields[0]!) : null;
    return { owner: ownerKey, pays: paysKey(b, order.fields[3]!) };
  } catch {
    return null;
  }
}

/** A V3 destination that's `Fixed` to a key's address with `NoDatum`, as `SundaeV3Order.pays`. */
function paysKey(b: Uint8Array, at: number): SundaeV3Order["pays"] {
  const destination = constr(b, at);
  if (destination.index !== 0 || destination.fields.length !== 2) return null;
  const [addressAt, datumAt] = destination.fields as [number, number];
  const datum = constr(b, datumAt);
  if (datum.index !== 0 || datum.fields.length !== 0) return null;
  // Address { payment_credential, stake_credential: Option<Inline(credential)> }; a key's credential is constructor 0.
  const address = constr(b, addressAt);
  if (address.index !== 0 || address.fields.length !== 2) return null;
  const payment = constr(b, address.fields[0]!);
  if (payment.index !== 0) return null;
  const staking = constr(b, address.fields[1]!);
  if (staking.index === 1) return { payment: keyHashAt(b, payment.fields[0]!), stake: null };
  if (staking.index !== 0) return null;
  const inline = constr(b, staking.fields[0]!);
  if (inline.index !== 0) return null;
  const stake = constr(b, inline.fields[0]!);
  if (stake.index !== 0) return null;
  return { payment: keyHashAt(b, payment.fields[0]!), stake: keyHashAt(b, stake.fields[0]!) };
}

/** What `sundaeV3Order`'s readers throw at a shape that isn't a V3 order's; never shown. */
class NotAnOrder extends Error {}

/** A Plutus constructor at `pos`, tags 121 to 127: its index, and where each field starts. */
function constr(b: Uint8Array, pos: number): { index: number; fields: number[] } {
  const tag = head(b, pos);
  if (tag.major !== 6 || tag.n < 121n || tag.n > 127n) throw new NotAnOrder();
  return { index: Number(tag.n - 121n), fields: items(b, tag.p) };
}

/** The 28-byte key hash at `pos`, hex. */
function keyHashAt(b: Uint8Array, pos: number): string {
  const key = bytesAt(b, pos);
  if (key.length !== 28) throw new NotAnOrder();
  return hex(key);
}

/**
 * The keys a transaction carries a signature of already, as key hashes (hex):
 * its witness set's vkey witnesses. A direct swap Minswap builds comes signed
 * by its collateral's owner.
 */
export function witnessedKeys(tx: Uint8Array): Set<string> {
  if (tx[0] !== 0x84) throw new Error(t("worker.cbor.notFourItems"));
  const found = new Set<string>();
  for (const [key, at] of entries(tx, skip(tx, 1))) {
    if (key !== 0) continue;
    for (const w of items(tx, at)) found.add(hex(blake2b(bytesAt(tx, items(tx, w)[0]), { dkLen: 28 })));
  }
  return found;
}

interface Head {
  major: number;
  n: bigint;
  /** Where the item's content starts. */
  p: number;
  indefinite: boolean;
}

function head(b: Uint8Array, pos: number): Head {
  if (pos >= b.length) throw new Error(t("worker.cbor.endsTooSoon"));
  const major = b[pos]! >> 5;
  const info = b[pos]! & 0x1f;
  const size = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : 0;
  if (info > 27 && info < 31) throw new Error(t("worker.cbor.notWellFormed"));
  if (pos + 1 + size > b.length) throw new Error(t("worker.cbor.endsTooSoon"));
  let n = BigInt(info);
  if (size) n = [...b.subarray(pos + 1, pos + 1 + size)].reduce((v, x) => (v << 8n) | BigInt(x), 0n);
  return { major, n, p: pos + 1 + size, indefinite: info === 31 };
}

/** The items of the array at `pos` (a tagged set's too), where each starts. */
function items(b: Uint8Array, pos: number): number[] {
  let h = head(b, pos);
  if (h.major === 6) h = head(b, h.p);
  if (h.major !== 4) throw new Error(t("minswap.cbor.mapForList"));
  const found: number[] = [];
  let p = h.p;
  for (let i = 0n; h.indefinite ? b[p] !== 0xff : i < h.n; i++) {
    found.push(p);
    p = skip(b, p);
  }
  return found;
}

/** The map at `pos`: each small-number key, and where its value starts. */
function entries(b: Uint8Array, pos: number): Array<[number, number]> {
  const h = head(b, pos);
  if (h.major !== 5) throw new Error(t("minswap.cbor.listForMap"));
  const found: Array<[number, number]> = [];
  let p = h.p;
  for (let i = 0n; h.indefinite ? b[p] !== 0xff : i < h.n; i++) {
    const key = head(b, p);
    const value = skip(b, p);
    found.push([key.major === 0 ? Number(key.n) : -1, value]);
    p = skip(b, value);
  }
  return found;
}

/** The byte string at `pos`. */
function bytesAt(b: Uint8Array, pos: number | undefined): Uint8Array {
  if (pos === undefined) throw new Error(t("minswap.cbor.noAddress"));
  const h = head(b, pos);
  if (h.major !== 2 || h.indefinite) throw new Error(t("minswap.cbor.notBytes"));
  if (h.n > BigInt(b.length - h.p)) throw new Error(t("worker.cbor.endsTooSoon"));
  return b.subarray(h.p, h.p + Number(h.n));
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
