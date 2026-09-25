// The swap form's arithmetic (screens/Swaps.tsx): how much Max and Half take,
// the rate between the two sides, how loud a price impact is, and the
// slippage a user types. Amounts are raw integer strings, as Minswap's.

import type { SwapAsk, SwapQuote } from "../shared/rpc";
import { formatQuantity } from "./format";

/**
 * A swap's ADA costs before there's a quote to say: Minswap's usual DEX fee
 * and order deposit (2 ₳ each), and the wallet's margin (sessions.ts
 * SWAP_MARGIN). A quote replaces it with the real ones.
 */
const USUAL_COSTS = 6_000_000n;
/** The one-time account's collateral (sessions.ts SESSION_COLLATERAL); a quote carries the real one. */
const USUAL_COLLATERAL = 5_000_000n;
/** Left over by Max for the funding's network fee. */
const FEE_ROOM = 1_000_000n;

/** Whether two asks are the same swap. */
export function sameAsk(a: SwapAsk, b: SwapAsk): boolean {
  return a.amount === b.amount && a.tokenIn === b.tokenIn && a.tokenOut === b.tokenOut && a.slippage === b.slippage;
}

/**
 * The most ADA a swap can take from `held` lovelace: what's left after its
 * costs, the one-time account's collateral and room for the network fee. The
 * costs are `quote`'s when it's an ADA swap's, else the usual ones.
 */
export function maxAdaIn(held: string, quote?: SwapQuote): string {
  const priced = quote?.ask.tokenIn === "lovelace";
  const costs = priced ? BigInt(quote.fund.lovelace) - BigInt(quote.ask.amount) : USUAL_COSTS;
  const collateral = priced ? BigInt(quote.collateral) : USUAL_COLLATERAL;
  const max = BigInt(held) - costs - collateral - FEE_ROOM;
  return (max > 0n ? max : 0n).toString();
}

/** Half of what's held, and never more than `max` (ADA's Max, which leaves its costs). */
export function halfOf(held: string, max = held): string {
  const half = BigInt(held) / 2n;
  return (half < BigInt(max) ? half : BigInt(max)).toString();
}

/**
 * The lovelace the private balance lacks for `quote`, if any: the funding
 * (the swap when it's ADA, and its costs) and the account's collateral. The
 * network fee comes on top; the funding's build says if that's what's short.
 */
export function adaShort(held: string, quote: SwapQuote): string | undefined {
  const short = BigInt(quote.fund.lovelace) + BigInt(quote.collateral) - BigInt(held);
  return short > 0n ? short.toString() : undefined;
}

/** Places kept past the point: a rate from 1 up shows 4, one under 1 shows its first 4 digits. */
const RATE_SCALE = 18;
const RATE_DIGITS = 4;

/**
 * How much of the output one unit of the input gets, from two raw amounts
 * and their decimals: "90.6594", "0.01103". Cut off, not rounded.
 */
export function rateOf(amountIn: string, inDecimals: number, amountOut: string, outDecimals: number): string {
  const den = BigInt(amountIn) * 10n ** BigInt(outDecimals);
  if (den === 0n) return "0";
  const scaled = (BigInt(amountOut) * 10n ** BigInt(inDecimals + RATE_SCALE)) / den;
  if (scaled === 0n) return "0";
  const whole = scaled / 10n ** BigInt(RATE_SCALE);
  const zeros = whole > 0n ? 0 : RATE_SCALE - scaled.toString().length;
  const places = Math.min(zeros + RATE_DIGITS, RATE_SCALE);
  return formatQuantity((scaled / 10n ** BigInt(RATE_SCALE - places)).toString(), places);
}

/** How a price impact reads: fine, worth a look (3% or more), or high (5% or more). */
export function impactLevel(percent: number): "ok" | "warn" | "high" {
  return percent >= 5 ? "high" : percent >= 3 ? "warn" : "ok";
}

/** The least and most slippage the wallet takes, in percent (sessions.ts checkAsk). */
export const SLIPPAGE_MIN = 0.1;
export const SLIPPAGE_MAX = 20;

/** A slippage typed in percent ("1.5", "2%"), if it's one the wallet takes: 0.1% to 20%, two places at most. */
export function parseSlippage(text: string): number | undefined {
  const t = text.trim().replace(/\s*%$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t) && !/^\.\d{1,2}$/.test(t)) return undefined;
  const n = Number(t);
  return n >= SLIPPAGE_MIN && n <= SLIPPAGE_MAX ? n : undefined;
}
