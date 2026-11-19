// Chunk 51, gap-g8#7: a swap refused a slippage outside 0.1% to 20%, the form (ui/swap.ts parseSlippage) and the
// worker (sessions.ts checkAsk) each by its own copy of the range, though a DEX's order takes any minimum. Minswap's
// estimate took 0.05% and 25% alike, on mainnet (2026-11-18, 10 ₳ to MIN), each minimum amount_out / (1 + slippage%):
// 631,210,104 and 505,220,568 of a 631,525,710 quote. So both take anything between none and all of it, from one
// range (shared/slippage.ts), and a high one is warned of: how much less than the quote it may fill for, which is
// 1 - 1 / (1 + slippage%), never the slippage itself (20% allows 16.67% less), and past 20% why that's rarely wise.
// The verifier's cases (verify/gap-g8-7.md) first; its control, the runner's own ask under 0.1% after a dip, passed
// on 1.9.1 too.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { checkAsk, slippageKeeping } from "../src/background/sessions";
import { SlippageWarning } from "../src/ui/screens/Swaps";
import { parseSlippage, SLIPPAGE_HIGH, SLIPPAGE_MAX, SLIPPAGE_MIN } from "../src/ui/swap";

const ASK = { amount: "10000000", tokenIn: "lovelace", tokenOut: "ab".repeat(28), slippage: 1 };

/** A warning's text, as a person reads it. */
const text = (element: ReactElement) =>
  renderToStaticMarkup(element)
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ")
    .trim();

describe("a slippage the order takes (chunk 51, gap-g8#7)", () => {
  it("is one the wallet's own runner asks Minswap with, under 0.1%, after a dip", () => {
    // A quote 0.0501% above the approved minimum: the runner asks build-tx with 0.0499% (sessions.ts order).
    const asked = slippageKeeping(1_000_501_001n, 1_000_000_000n);
    expect(asked).toBe(0.0499);
    expect(asked).toBeLessThan(0.1);
  });

  it("is taken by the form's field: 25% and 0.05%", () => {
    expect(parseSlippage("25")).toBe(25);
    expect(parseSlippage("0.05")).toBe(0.05);
    // Still warned of, from 5%, on the form, the dialog and the review.
    expect(25 >= SLIPPAGE_HIGH).toBe(true);
  });

  it("is taken by the worker's checkAsk: 25% and 0.05%", () => {
    expect(() => checkAsk({ ...ASK, slippage: 25 })).not.toThrow();
    expect(checkAsk({ ...ASK, slippage: 25 }).slippage).toBe(25);
    expect(() => checkAsk({ ...ASK, slippage: 0.05 })).not.toThrow();
    expect(checkAsk({ ...ASK, slippage: 0.05 }).slippage).toBe(0.05);
  });

  it("is one range, the form's and the worker's: over none and under all of it", () => {
    expect([SLIPPAGE_MIN, SLIPPAGE_MAX]).toEqual([0.01, 99.99]);
    for (const s of [SLIPPAGE_MIN, 1, 20, 50, SLIPPAGE_MAX]) {
      expect(parseSlippage(String(s))).toBe(s);
      expect(checkAsk({ ...ASK, slippage: s }).slippage).toBe(s);
    }
    for (const s of [0, 100]) {
      expect(parseSlippage(String(s))).toBeUndefined();
      expect(() => checkAsk({ ...ASK, slippage: s })).toThrow("Slippage is between 0.01% and 99.99%.");
    }
  });

  it("is warned of by what the order may lose: 1 - 1 / (1 + slippage%), and past 20% why that's rarely wise", () => {
    const warning = (slippage: number) => text(createElement(SlippageWarning, { slippage, testId: "w" }));
    expect(warning(4.99)).toBe("");
    expect(warning(5)).toBe(
      "High slippage: the order can fill for up to 4.76% less than the quote. Use it only for a price that moves fast.",
    );
    // 20% allows 16.67% less, and is the last one with no second line.
    expect(warning(20)).toBe(
      "High slippage: the order can fill for up to 16.67% less than the quote. Use it only for a price that moves fast.",
    );
    expect(warning(25)).toBe(
      "High slippage: the order can fill for up to 20% less than the quote. Use it only for a price that moves fast. " +
        "Over 20%, someone who trades just before your swap can leave you near its minimum.",
    );
  });
});
