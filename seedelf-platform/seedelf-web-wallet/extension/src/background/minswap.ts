// Minswap's aggregator API (https://docs.minswap.org/developer/aggregator-api),
// for swaps in private sessions: a quote, an unsigned swap for a sender, and
// its token search. It routes across Cardano's DEXes; the orders it places
// are filled by each DEX's batchers. A session's orders are read from chain
// and cancelled by the wallet itself (sessions.ts `liveOrders`, seedelf-core's
// orders.rs), never through Minswap (chunk 24).
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
 * Routing leaves these out: a bonding curve and Djed's minting. Danogo's
 * (DanogoCLMMV1, seen doing it on preprod, 2026-09-25) is routed since
 * chunk 24, whose checks read its swaps (DANOGO_POOL, sessions.ts
 * `directSpends`). The session's check stays: any other DEX that does it
 * pauses the swap.
 */
export const DIRECT_PROTOCOLS = ["ChakraBondingCurve", "OpenDjedV1"];

/**
 * On preprod, Minswap builds Splash's orders with Splash's mainnet order
 * address (header 0x11, seen 2026-09-25), and a preprod node refuses an
 * output on another network. Mainnet's are fine.
 */
const PREPROD_BROKEN = ["Splash", "SplashStable"];

/**
 * The DEXes a mainnet swap goes through: those whose orders the wallet can
 * cancel itself (chunk 24, Step 3). Each order script is pinned, with its
 * cancel, in seedelf-core's `orders.json`, and WebAssembly reads each order
 * (`readDexOrder`, which sessions.ts `checkOrder` asks): cancelled by the
 * session's own key, paying the session's address alone, in a form its
 * script can spend; then it builds each order's cancel and runs the order's
 * script on it before the swap is signed (`checkOrderCancels`, release
 * review C05). So Stop brings the money back whatever Minswap lists, from
 * any of them:
 * - Minswap (V1), MinswapV2 and MinswapStable (one order script a pool);
 * - SundaeSwap (V1) and SundaeSwapV3, the latter owned by the session's own
 *   stake key, which signs its cancel too, and only as a path of its own
 *   (outOfPlace);
 * - WingRiders, WingRidersV2 and WingRidersStableV2;
 * - Splash and Spectrum: both are Splash's limit order as Minswap builds them;
 * - DanogoCLMMV1: no order, a swap against its pools (DANOGO_POOL), read by
 *   what it spends, pays and gives back (chunk 24). Only on its own.
 * A route through any other is refused before it's funded (quote), rather
 * than pause once it is.
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
  "DanogoCLMMV1",
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
 * its orders never expire. WebAssembly reads one's owner and destination
 * (`readDexOrder`, seedelf-core orders.rs), and runs its cancel through V3's
 * own script before the swap is signed (`checkOrderCancels`), and Stop's own
 * cancel of one is signed by the session's stake key too.
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
 * Danogo's concentrated-liquidity pools' script, by network: a DEX that
 * swaps against its pools in the swap itself, with no order (chunk 24). A
 * session's direct swap spends UTxOs at it and nothing else of anyone's but
 * a collateral signed already, recreates each pool it spends where that
 * pool was, once, and withdraws zero from it and from each spent pool's
 * staking script (sessions.ts `directSpends`, `checkDirect`). Seen in swaps
 * Minswap built, on mainnet and on preprod, 2026-10-06.
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

/** Whether `est`'s route swaps against a DEX's pools, with no order: Danogo's, on its own (outOfPlace). */
export function againstPools(est: Pick<Estimate, "paths">): boolean {
  return est.paths.flat().some((leg) => DIRECT_CHECKED.includes(leg.protocol));
}

/**
 * The DEXes of `est`'s route that sit where a session's check can't follow
 * them, to be asked for again without: any in a path of more than one leg,
 * and one that swaps against its pools beside any other leg (DIRECT_CHECKED).
 * Danogo split across two of its own pools is one swap, and fine.
 *
 * Routes are asked for direct (`routed`), so a longer path is Minswap not
 * keeping to that. Its later legs' orders are placed by the leg before's
 * batcher, and the session's check never sees them; and its first leg pays
 * the next leg's order or Minswap's adapter, not the session. A SundaeSwap
 * V3 first leg paying the adapter is owned by Minswap's key too, so the
 * session could never cancel it, and it never expires (seen on mainnet,
 * 2026-10-06).
 */
export function outOfPlace(est: Pick<Estimate, "paths">): string[] {
  const legs = est.paths.flat().map((leg) => leg.protocol);
  const found = est.paths.filter((path) => path.length > 1).flatMap((path) => path.map((leg) => leg.protocol));
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
 * The DEXes of `est`'s route a mainnet swap doesn't go through because the
 * wallet doesn't check them: any not on MAINNET_PROTOCOLS (CswapV1, whose
 * orders the wallet doesn't know, or one Minswap adds later). None on
 * preprod, where only the check stands. A route that puts DEXes the wallet
 * checks where the session's check can't follow them is `outOfPlace`'s, and
 * refused in words of its own (sessions.ts, release review C34).
 */
export function uncheckedProtocols(network: "preprod" | "mainnet", est: Pick<Estimate, "paths">): string[] {
  if (network !== "mainnet") return [];
  return [...new Set(est.paths.flat().map((leg) => leg.protocol).filter((p) => !MAINNET_PROTOCOLS.includes(p)))];
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

/**
 * An ask as Minswap's estimate takes it: the route through DEXes that take
 * orders only, and direct, one leg a path (`outOfPlace`). Minswap routes
 * direct unless asked otherwise (seen on both networks, 2026-10-06), but its
 * documentation gives no default, so it's asked.
 */
function routed(ask: SwapAsk, exclude: string[]) {
  return {
    amount: ask.amount,
    token_in: ask.tokenIn,
    token_out: ask.tokenOut,
    slippage: ask.slippage,
    exclude_protocols: [...new Set(exclude)],
    allow_multi_hops: false,
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
  /**
   * It holds its datum inline (`[1, #6.24(datum)]`), not by hash: a Plutus
   * V1 order script can never spend such an output (release review C05).
   */
  inline: boolean;
  /** It carries a script (an output map's key 3): no cancel the wallet builds can spend such an order. */
  scriptRef: boolean;
}

/**
 * Where a transaction Minswap built pays: each output's address, ADA and
 * datum, and the form it's in. An order's datum is its details (who it's
 * for, what it gives); a DEX that keeps it by hash carries it in the
 * witness set, as Minswap's V1 orders do. Throws on bytes it can't read.
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
    // A map output (Babbage's) may hold its datum inline, and a script; a legacy one, neither.
    const map = head(tx, o).major === 5;
    if (map) {
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
    let inline = false;
    const option = fields.get(2);
    if (option !== undefined && map) {
      const [which, inner] = items(tx, option);
      if (head(tx, which!).n === 1n) {
        const tag = head(tx, inner!);
        if (tag.major !== 6 || tag.n !== 24n) throw new Error(t("minswap.cbor.datumNotWrapped"));
        datum = hex(bytesAt(tx, tag.p));
        inline = true;
      } else {
        datum = carried.get(hex(bytesAt(tx, inner))) ?? null;
      }
    } else if (option !== undefined) {
      datum = carried.get(hex(bytesAt(tx, option))) ?? null;
    }
    return { address: hex(address), lovelace, tokens, datum, inline, scriptRef: map && fields.has(3) };
  });
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
