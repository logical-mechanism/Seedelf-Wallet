// The slippage a swap takes: one range for the form (ui/swap.ts parseSlippage) and the worker (sessions.ts checkAsk),
// so the two can't drift (chunk 51, gap-g8#7). A DEX's order takes any minimum, and Minswap's estimate took 0.05% and
// 25% alike, each order's minimum amount_out / (1 + slippage%) (mainnet, 2026-11-18). So the wallet takes anything
// between none and all of it, two places at most as the form types it, and warns of a high one (ui/swap.ts).

/** The least and most slippage the wallet takes, in percent: more than none, less than all, at two places. */
export const SLIPPAGE_MIN = 0.01;
export const SLIPPAGE_MAX = 99.99;

/** Whether `percent` is a slippage the wallet takes. */
export function slippageTaken(percent: number): boolean {
  return percent >= SLIPPAGE_MIN && percent <= SLIPPAGE_MAX;
}

/**
 * How much less than the quote an order at `percent` slippage may fill for, in percent: Minswap's minimum is
 * amount_out / (1 + percent%), so 1 - 1 / (1 + percent%) of the quote, a little under `percent` itself (5% allows
 * 4.76% less, 20% allows 16.67%).
 */
export function slippageLoss(percent: number): number {
  return (100 * percent) / (100 + percent);
}
