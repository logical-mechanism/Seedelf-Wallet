import { describe, expect, it } from "vitest";

import type { SwapQuote } from "../src/shared/rpc";
import { adaShort, halfOf, impactLevel, maxAdaIn, parseSlippage, rateOf, sameAsk } from "../src/ui/swap";

/** 10 ₳ for MIN: 6 ₳ of costs on top, and 5 ₳ of collateral. */
const quote: SwapQuote = {
  network: "preprod",
  ask: { amount: "10000000", tokenIn: "lovelace", tokenOut: "aa".repeat(28) + "4d494e", slippage: 1 },
  amountIn: "10000000",
  amountOut: "906594100",
  minAmountOut: "902083681",
  dexFee: "2000000",
  deposits: "2000000",
  aggregatorFee: "0",
  priceImpact: 0.34,
  route: ["MinswapV2"],
  fund: { lovelace: "16000000", tokens: [] },
  collateral: "5000000",
};

describe("the swap form", () => {
  it("leaves the costs, the collateral and room for the fee out of ADA's Max", () => {
    // 28 ₳, less the usual 6 ₳ of costs, 5 ₳ of collateral and 1 ₳ for the fee.
    expect(maxAdaIn("28000000")).toBe("16000000");
    // A quote's own costs: 7.5 ₳ this time.
    expect(maxAdaIn("28000000", { ...quote, fund: { lovelace: "17500000", tokens: [] } })).toBe("14500000");
    // A token's quote says nothing about an ADA swap's costs.
    expect(maxAdaIn("28000000", { ...quote, ask: { ...quote.ask, tokenIn: quote.ask.tokenOut, tokenOut: "lovelace" } })).toBe(
      "16000000",
    );
    expect(maxAdaIn("9000000")).toBe("0");
  });

  it("takes half, never past Max", () => {
    expect(halfOf("28000000", maxAdaIn("28000000"))).toBe("14000000");
    expect(halfOf("20000000", maxAdaIn("20000000"))).toBe("8000000");
    expect(halfOf("7")).toBe("3");
  });

  it("says what ADA is short for a quote's funding and collateral", () => {
    expect(adaShort("21000000", quote)).toBeUndefined();
    expect(adaShort("20000000", quote)).toBe("1000000");
    // Selling a token: the costs alone.
    expect(adaShort("11000000", { ...quote, fund: { lovelace: "6000000", tokens: [] } })).toBeUndefined();
  });

  it("writes the rate either way round, cut off", () => {
    expect(rateOf("10000000", 6, "906594100", 6)).toBe("90.6594");
    expect(rateOf("906594100", 6, "10000000", 6)).toBe("0.01103");
    expect(rateOf("1", 0, "123456789", 0)).toBe("123,456,789");
    expect(rateOf("3", 0, "1", 6)).toBe("0.0000003333");
    expect(rateOf("0", 6, "5", 6)).toBe("0");
    expect(rateOf("5", 6, "0", 6)).toBe("0");
  });

  it("grades the price impact", () => {
    expect(impactLevel(0.34)).toBe("ok");
    expect(impactLevel(3)).toBe("warn");
    expect(impactLevel(5)).toBe("high");
  });

  it("takes a slippage from 0.1% to 20%", () => {
    expect(parseSlippage("1.5")).toBe(1.5);
    expect(parseSlippage("2 %")).toBe(2);
    expect(parseSlippage(".5")).toBe(0.5);
    expect(parseSlippage("0.05")).toBeUndefined();
    expect(parseSlippage("25")).toBeUndefined();
    expect(parseSlippage("1.234")).toBeUndefined();
    expect(parseSlippage("abc")).toBeUndefined();
  });

  it("knows a quote for the same ask", () => {
    expect(sameAsk(quote.ask, { ...quote.ask })).toBe(true);
    expect(sameAsk(quote.ask, { ...quote.ask, slippage: 3 })).toBe(false);
  });
});
