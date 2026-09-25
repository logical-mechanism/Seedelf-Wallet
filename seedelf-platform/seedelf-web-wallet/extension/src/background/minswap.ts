// Minswap's aggregator API (https://docs.minswap.org/developer/aggregator-api),
// for swaps in private sessions: a quote, an unsigned swap for a sender, the
// sender's open orders, and an unsigned cancel. It routes across Cardano's
// DEXes; the orders it places are filled by each DEX's batchers.
//
// `build-tx` takes only a sender: it picks the sender's UTxOs from its own
// view of the chain, and the proceeds and any refund go back to the sender.
// That's why a swap runs from a session's one-time account (sessions.ts),
// funded and confirmed first. Minswap sees that account's address, the pair,
// the amounts and the IP address; it never sees the private balance.
//
// It answers browsers with CORS headers, so the wallet needs no host
// permission for it (networks.ts).

import type { FetchLike } from "./koios";

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

export class MinswapError extends Error {}

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

const TIMEOUT_MS = 20_000;

export class Minswap {
  constructor(
    private readonly base: string,
    private readonly fetchFn: FetchLike = (url, init) => fetch(url, init),
  ) {}

  /** The best route for `ask` through DEXes that take orders, and what it's expected to give. */
  estimate(ask: SwapAsk): Promise<Estimate> {
    return this.post<Estimate>("estimate", { ...routed(ask), amount_in_decimal: false });
  }

  /** An unsigned swap from `sender`, for the ask quoted; it gives at least `minAmountOut` or is refunded. */
  async buildTx(sender: string, minAmountOut: string, ask: SwapAsk): Promise<string> {
    const { cbor } = await this.post<{ cbor: string }>("build-tx", {
      sender,
      min_amount_out: minAmountOut,
      estimate: routed(ask),
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
        method,
        headers: method === "POST" ? { accept: "application/json", "content-type": "application/json" } : { accept: "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      const cause = e instanceof Error ? e.message : String(e);
      throw new MinswapError(`Couldn't reach Minswap (${cause}). Check your connection and try again.`);
    }
    if (response.ok) return (await response.json()) as T;
    const text = await response.text().catch(() => "");
    if (response.status === 429) throw new MinswapError("Minswap is limiting requests from your connection. Wait a minute and try again.");
    let message = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as { message?: unknown; error?: unknown };
      message = String(parsed.message ?? parsed.error ?? message);
    } catch {
      // Not JSON: keep the text.
    }
    throw new MinswapError(`Minswap refused it (${response.status}): ${message}`);
  }
}

/** An ask as Minswap's estimate takes it: the route through DEXes that take orders only. */
function routed(ask: SwapAsk) {
  return {
    amount: ask.amount,
    token_in: ask.tokenIn,
    token_out: ask.tokenOut,
    slippage: ask.slippage,
    exclude_protocols: DIRECT_PROTOCOLS,
  };
}
