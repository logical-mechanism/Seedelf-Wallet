// The swap form's arithmetic (screens/Swaps.tsx): how much Max and Half take,
// in whole units, the rate between the two sides, how loud a price impact
// is, and the slippage a user types. Amounts are raw integer strings, as
// Minswap's. And what a private session's transactions after its funding are
// expected to cost, which a swap's review, Lovejoin's page and a site's
// session all say before anything is built (blind test §9.8).

import type { SwapAsk, SwapQuote } from "../shared/rpc";
import { formatAda, formatQuantity } from "./format";

/**
 * About what one of a private session's own transactions costs, for those
 * nothing has built yet when the user decides: a swap's order and return, a
 * site session's way back, a Lovejoin chain's deposit (blind test §9.8: the
 * reviews gave a figure for the first fee only). Nothing in the worker
 * prices them ahead; each is measured once it's built. A fixed figure, from
 * what they measure: Minswap's real preprod order 0.205189 ₳
 * (wasm/tests/fixtures/minswap-swap-preprod.json), a return merged into the
 * funding's private UTxO 0.23009 ₳ and one into new UTxOs 0.172145 ₳ (the
 * real WebAssembly at preprod's parameters, tests/sessions.test.ts, which
 * holds them under it). A Seedelf spend is the dearest of them, and measured
 * 0.23–0.26 ₳ live on preprod.
 */
export const SESSION_FEE_ESTIMATE = 250_000n;

/**
 * About what a swap against a DEX's pools costs, in place of an order's
 * SESSION_FEE_ESTIMATE (chunk 24): it runs the pools' scripts, so it's
 * dearer, and dearer the more pools it spends. Swaps Minswap built against
 * Danogo's pools, 2026-10-06: six on mainnet, 0.48 ₳ for one pool to 0.92 ₳
 * for four, and a preprod build 0.64 ₳ for two.
 */
export const POOL_SWAP_FEE_ESTIMATE = 750_000n;

/**
 * About what bringing one Lovejoin box back costs, paid from the box: the
 * worker's own figure (sessions.ts LOVEJOIN_WITHDRAW_ESTIMATE, a 1-box
 * withdraw measured 0.2897 ₳ on mainnet), which a swap's Lovejoin quote
 * carries as `withdrawFees`; tests/swap-form.test.ts keeps the two equal.
 */
export const BOX_BACK_ESTIMATE = 300_000n;

/**
 * An estimate in ₳, to the cent: "about 2.73 ₳" rather than "about
 * 2.733208 ₳", whose last digits would claim a precision an estimate hasn't
 * got. Exact figures keep their six places.
 */
export function aboutAda(lovelace: bigint): string {
  return formatAda(toCents(lovelace));
}

/** An estimate's lovelace, rounded to the cent (aboutAda), for `adaText`: "2.73 ₳". */
export function toCents(lovelace: bigint): string {
  return (lovelace > 0n ? ((lovelace + 5_000n) / 10_000n) * 10_000n : 0n).toString();
}

/**
 * What a swap takes, all told, as its review says it (blind test §9.8, T10:
 * the tester added up Transaction details to find what left). `paid`: what
 * the funding pays the session's account (the swap and its costs, and the 5 ₳
 * kept aside); `fee`: its own network fee, exact. `lovejoin`: the return's
 * mixes and the boxes' way back, when it goes through Lovejoin and takes a
 * box.
 *
 * - `leaving`: the ADA the funding takes from the private balance now.
 * - `networkFees`: the funding's fee, and SESSION_FEE_ESTIMATE for each
 *   transaction after it (`later`): the order and the return, and Lovejoin's
 *   deposit when it takes a box; POOL_SWAP_FEE_ESTIMATE for a swap against a
 *   DEX's pools in place of the order. The later ones come out of the room
 *   for network fees (sessions.ts SWAP_MARGIN), whose rest comes back.
 * - `cost`: what's used up: the network fees, the DEX's fee, Minswap's, and
 *   Lovejoin's. The ADA swapped isn't a cost: it buys what's received.
 * - `back`: the ADA that comes back into the private balance: the 5 ₳ kept
 *   aside, the order's deposit, the room's rest and, from a token→ADA swap,
 *   the proceeds as quoted.
 */
export function swapCosts(
  quote: SwapQuote,
  funding: { paid: bigint; fee: bigint },
  lovejoin?: { mixFees: string; withdrawFees: string },
): { leaving: bigint; networkFees: bigint; later: number; lovejoin: bigint; cost: bigint; back: bigint } {
  const leaving = funding.paid + funding.fee;
  const later = lovejoin ? 3 : 2;
  const swap = quote.againstPools ? POOL_SWAP_FEE_ESTIMATE : SESSION_FEE_ESTIMATE;
  const networkFees = funding.fee + swap + BigInt(later - 1) * SESSION_FEE_ESTIMATE;
  const mixing = lovejoin ? BigInt(lovejoin.mixFees) + BigInt(lovejoin.withdrawFees) : 0n;
  const cost = networkFees + BigInt(quote.dexFee) + BigInt(quote.aggregatorFee) + mixing;
  const swapped = quote.ask.tokenIn === "lovelace" ? BigInt(quote.ask.amount) : 0n;
  const proceeds = quote.ask.tokenOut === "lovelace" ? BigInt(quote.amountOut) : 0n;
  const back = leaving - swapped - cost + proceeds;
  return { leaving, networkFees, later, lovejoin: mixing, cost, back: back > 0n ? back : 0n };
}

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
 * `quantity` rounded down to a whole unit of its token (`decimals`: 6 for
 * ADA, a whole ₳). Max and Half fill the form with it, so the amount Minswap
 * is asked about looks typed, and doesn't give the private balance away to
 * its last digit (privacy review §2.13). What's left out, less than a unit,
 * stays in the private balance.
 */
export function wholeUnits(quantity: string, decimals: number): string {
  const unit = 10n ** BigInt(decimals);
  return ((BigInt(quantity) / unit) * unit).toString();
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
/**
 * From here a slippage is warned of on the form and the review, not only in
 * its dialog, and its chip turns amber (chunk 23's second review, DX-4).
 */
export const SLIPPAGE_HIGH = 5;

/**
 * What a swap's funding pays for, line by line, so the review's rows add up
 * to "For the swap" (chunk 23's second review, DX-3): the ADA swapped (none
 * when a token is), the DEX's fee, Minswap's, the order's deposit, and the
 * room left for the order's fee (sessions.ts SWAP_MARGIN). Undefined when
 * they don't add up to `funded`, which only a quote from before could do.
 */
export function fundParts(
  quote: SwapQuote,
  funded: string,
): { swapped: string; dexFee: string; aggregatorFee: string; deposits: string; room: string } | undefined {
  const swapped = quote.ask.tokenIn === "lovelace" ? BigInt(quote.ask.amount) : 0n;
  const room = BigInt(funded) - swapped - BigInt(quote.dexFee) - BigInt(quote.aggregatorFee) - BigInt(quote.deposits);
  if (room < 0n) return undefined;
  return {
    swapped: swapped.toString(),
    dexFee: quote.dexFee,
    aggregatorFee: quote.aggregatorFee,
    deposits: quote.deposits,
    room: room.toString(),
  };
}

/** A slippage typed in percent ("1.5", "2%"), if it's one the wallet takes: 0.1% to 20%, two places at most. */
export function parseSlippage(text: string): number | undefined {
  const t = text.trim().replace(/\s*%$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t) && !/^\.\d{1,2}$/.test(t)) return undefined;
  const n = Number(t);
  return n >= SLIPPAGE_MIN && n <= SLIPPAGE_MAX ? n : undefined;
}
