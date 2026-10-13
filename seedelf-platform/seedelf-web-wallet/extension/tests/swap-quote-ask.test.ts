// Minswap's quote is held to what was asked (the usability review's DX-8):
// the amount typed, whole, between the tokens chosen. A quote for another
// amount would have the user approve the minimum that amount gets, then pay
// what they typed. Live, Minswap gives the amount back as asked, so nothing
// it answers right is refused (nine mainnet quotes, 2026-10-11).
import { describe, expect, it } from "vitest";

import { quotesTheAsk } from "../src/background/sessions";
import { minswapEstimate } from "./fakes";
import { ASK, MIN, funded, signing, started, unlocked, type T } from "./swap-session";

const REFUSED = "Minswap's quote was for a different amount or pair from the one asked, so the wallet won't swap on it.";
const est = minswapEstimate.estimate;
const leg = est.paths[0]![0]!;

/**
 * Minswap's best for the ask puts V3 after another leg, where the session's
 * check can't follow it (`outOfPlace`), and asked again without V3 it quotes
 * 1 ₳. The estimate held to the ask must be the one asked for again, which
 * the order is built on, not the first (1.5.0's release review, C40). Each
 * estimate asked for, and whether it left V3 out.
 */
function reasked(t: T) {
  const legged = { ...est, paths: [["MinswapV2", "SundaeSwapV3"].map((protocol) => ({ ...leg, protocol }))] };
  const other = { ...est, amount_in: "1000000", paths: [[{ ...leg, protocol: "MinswapV2", amount_in: "1000000" }]] };
  t.minswap.echo = false;
  const answer = t.minswap.fetch;
  t.minswap.fetch = async (url, init) => {
    const body = init.body ? JSON.parse(String(init.body)) : {};
    t.minswap.estimate = (body.exclude_protocols ?? []).includes("SundaeSwapV3") ? other : legged;
    return answer(url, init);
  };
  return () => t.minswap.calls.map((c) => [c.path, (c.body?.exclude_protocols ?? []).includes("SundaeSwapV3")]);
}

describe("quotesTheAsk", () => {
  it("takes the recorded quote for what it was asked, and one split over two DEXes that adds up", () => {
    expect(quotesTheAsk(ASK, est)).toBe(true);
    const split = { ...est, paths: [[{ ...leg, amount_in: "8600000" }], [{ ...leg, protocol: "MinswapV2", amount_in: "1400000" }]] };
    expect(quotesTheAsk(ASK, split)).toBe(true);
  });

  it("refuses another amount, another pair, paths that don't add up or don't end on the tokens, and none", () => {
    expect(quotesTheAsk({ ...ASK, amount: "500000000" }, est)).toBe(false);
    expect(quotesTheAsk({ ...ASK, amount: "10000001" }, est)).toBe(false);
    expect(quotesTheAsk(ASK, { ...est, token_out: "lovelace" })).toBe(false);
    expect(quotesTheAsk({ ...ASK, tokenIn: MIN, tokenOut: "lovelace" }, est)).toBe(false);
    expect(quotesTheAsk(ASK, { ...est, paths: [[{ ...leg, amount_in: "1000000" }]] })).toBe(false);
    expect(quotesTheAsk(ASK, { ...est, paths: [[leg], [{ ...leg, amount_in: "1" }]] })).toBe(false);
    expect(quotesTheAsk(ASK, { ...est, paths: [[{ ...leg, token_out: "lovelace" }]] })).toBe(false);
    expect(quotesTheAsk(ASK, { ...est, paths: [] })).toBe(false);
    expect(quotesTheAsk(ASK, { ...est, paths: [[{ ...leg, amount_in: "10 ADA" }]] })).toBe(false);
  });
});

describe("a quote for another amount", () => {
  it("is refused before anything is shown, and the same ask quoted right goes", async () => {
    const t = await unlocked();
    // The recorded 10 ₳ quote, whatever was asked: the fake as it was, and DX-8's "906.5941 for 1 ₳ and 500".
    t.minswap.echo = false;
    await expect(t.sessions.quote("preprod", { ...ASK, amount: "500000000" })).rejects.toThrow(REFUSED);
    await expect(t.sessions.quote("preprod", ASK)).resolves.toMatchObject({ amountIn: "10000000" });
    t.minswap.echo = true;
    await expect(t.sessions.quote("preprod", { ...ASK, amount: "500000000" })).resolves.toMatchObject({ amountIn: "500000000" });
  });

  it("builds no order for a funded swap, nor Review it myself, until Minswap quotes what was asked", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await started(sessions);
    funded(t);
    t.minswap.echo = false;
    t.minswap.estimate = { ...est, amount_in: "1000000", paths: [[{ ...leg, amount_in: "1000000" }]] };
    const view = await sessions.advance("preprod", 0, true);
    expect(t.minswap.calls.map((c) => c.path)).not.toContain("build-tx");
    expect(t.koios.submitted).toHaveLength(1);
    expect(view.txs.map((x) => x.kind)).toEqual(["out"]);
    await expect(sessions.swapBuild("preprod", 0)).rejects.toThrow(REFUSED);
    expect(t.minswap.calls.map((c) => c.path)).not.toContain("build-tx");

    // Minswap quotes the swap again: the order goes.
    t.minswap.estimate = est;
    const placed = await sessions.resume("preprod", 0);
    expect(t.minswap.calls.at(-1)!.path).toBe("build-tx");
    expect(placed.txs.map((x) => x.kind)).toEqual(["out", "swap"]);
  });

  it("is refused when it's the estimate asked for again without a DEX, the first quoting the ask (C40)", async () => {
    const t = await unlocked();
    const asked = reasked(t);
    await expect(t.sessions.quote("preprod", ASK)).rejects.toThrow(REFUSED);
    expect(asked()).toEqual([
      ["estimate", false],
      ["estimate", true],
    ]);
  });

  it("builds no Review it myself on an estimate asked for again for another amount (C40)", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await started(sessions);
    funded(t);
    const asked = reasked(t);
    t.minswap.calls.length = 0;
    await expect(sessions.swapBuild("preprod", 0)).rejects.toThrow(REFUSED);
    expect(asked()).toEqual([
      ["estimate", false],
      ["estimate", true],
    ]);
  });
});
