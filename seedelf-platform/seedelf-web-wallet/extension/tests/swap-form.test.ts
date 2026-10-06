import { describe, expect, it } from "vitest";

import { LOVEJOIN_WITHDRAW_ESTIMATE, SWAP_MARGIN } from "../src/background/sessions";
import type { SwapQuote } from "../src/shared/rpc";
import {
  aboutAda,
  adaShort,
  BOX_BACK_ESTIMATE,
  fundParts,
  halfOf,
  impactLevel,
  maxAdaIn,
  parseSlippage,
  rateOf,
  sameAsk,
  SESSION_FEE_ESTIMATE,
  swapCosts,
  wholeUnits,
} from "../src/ui/swap";

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

  it("rounds Max and Half down to a whole unit, so the amount Minswap sees doesn't give the private balance away (privacy review §2.13)", () => {
    // 123.456789 ₳ held: Max, less the usual 12 ₳, is 111 ₳, not 111.456789.
    expect(wholeUnits(maxAdaIn("123456789"), 6)).toBe("111000000");
    expect(wholeUnits(halfOf("123456789", maxAdaIn("123456789")), 6)).toBe("61000000");
    // A token's whole units; one that comes in whole units is left as it is.
    expect(wholeUnits("906594100", 6)).toBe("906000000");
    expect(wholeUnits("700", 0)).toBe("700");
    expect(wholeUnits("999999", 6)).toBe("0");
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

describe("what a swap's funding pays for (chunk 23's second review, DX-3)", () => {
  it("adds up to the swap and its costs: the ADA swapped, the fees, the order's deposit and the room left", () => {
    const parts = fundParts(quote, quote.fund.lovelace)!;
    expect(parts).toEqual({ swapped: "10000000", dexFee: "2000000", aggregatorFee: "0", deposits: "2000000", room: "2000000" });
    const sum = Object.values(parts).reduce((a, b) => a + BigInt(b), 0n);
    expect(sum.toString()).toBe(quote.fund.lovelace);
  });

  it("swaps no ADA when a token is paid, and says nothing when the parts don't add up", () => {
    const token = { ...quote, ask: { ...quote.ask, tokenIn: quote.ask.tokenOut, tokenOut: "lovelace" } };
    expect(fundParts(token, "6000000")).toMatchObject({ swapped: "0", room: "2000000" });
    expect(fundParts(quote, "13000000")).toBeUndefined();
  });
});

describe("what a swap takes, all told (blind test §9.8, T10)", () => {
  // T10's funding: 16 ₳ for the swap and its costs, 5 ₳ kept aside, and a 0.233208 ₳ fee.
  const funding = { paid: 21_000_000n, fee: 233_208n };

  it("says what leaves now, what's used up and what comes back, and they add up", () => {
    const costs = swapCosts(quote, funding);
    expect(costs.leaving).toBe(21_233_208n);
    // This payment's fee, and the order's and the return's at the estimate.
    expect(costs).toMatchObject({ later: 2, networkFees: 733_208n, lovejoin: 0n });
    // The DEX's 2 ₳ and the network fees; the 10 ₳ swapped buys the MIN, and isn't a cost.
    expect(costs.cost).toBe(2_733_208n);
    // Back: the 5 ₳ kept aside, the 2 ₳ deposit and the 2 ₳ room less the two later fees.
    expect(costs.back).toBe(5_000_000n + 2_000_000n + (SWAP_MARGIN - 2n * SESSION_FEE_ESTIMATE));
    expect(costs.leaving - 10_000_000n - costs.cost).toBe(costs.back);
    expect(aboutAda(costs.cost)).toBe("2.73");
    expect(aboutAda(costs.back)).toBe("8.5");
  });

  it("counts Minswap's fee, Lovejoin's mixes and the boxes' way back, and the deposit as a fourth fee", () => {
    const costs = swapCosts({ ...quote, aggregatorFee: "500000" }, funding, { mixFees: "3800000", withdrawFees: "300000" });
    expect(costs).toMatchObject({ later: 3, networkFees: 983_208n, lovejoin: 4_100_000n });
    expect(costs.cost).toBe(983_208n + 2_000_000n + 500_000n + 4_100_000n);
  });

  it("brings a token→ADA swap's proceeds back with the rest", () => {
    const token: SwapQuote = {
      ...quote,
      ask: { ...quote.ask, amount: "906594100", tokenIn: quote.ask.tokenOut, tokenOut: "lovelace" },
      amountOut: "9800000",
      fund: { lovelace: "6000000", tokens: [] },
    };
    const costs = swapCosts(token, { paid: 11_000_000n, fee: 233_208n });
    // No ADA swapped: 11.233208 leave, 2.733208 is used up, and the 9.8 ₳ quoted comes back with the rest.
    expect(costs.back).toBe(11_233_208n - 2_733_208n + 9_800_000n);
  });

  it("rounds an estimate to the cent, and prices a box's way back as the worker does", () => {
    expect(aboutAda(733_208n)).toBe("0.73");
    expect(aboutAda(735_000n)).toBe("0.74");
    expect(aboutAda(0n)).toBe("0");
    // The page and the worker's Lovejoin quote say one figure.
    expect(BOX_BACK_ESTIMATE).toBe(LOVEJOIN_WITHDRAW_ESTIMATE);
  });
});
