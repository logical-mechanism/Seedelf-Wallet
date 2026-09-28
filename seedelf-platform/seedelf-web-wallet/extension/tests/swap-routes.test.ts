// Which DEXes a mainnet swap goes through (independent review M16, M17): the
// ones whose orders the session's check reads, left to Minswap to route
// through, and every other DEX Minswap offers left out.
import { describe, expect, it, vi } from "vitest";

import { DIRECT_PROTOCOLS, excludedProtocols, MAINNET_PROTOCOLS, MINSWAP_PROTOCOLS } from "../src/background/minswap";
import { minswapEstimate } from "./fakes";
import { MIN, funded, signing, started, unlocked } from "./swap-session";

// The fixtures are preprod's: the runner's route check reads a route as mainnet's while `rule.mainnet` is set.
const rule = vi.hoisted(() => ({ mainnet: false }));
vi.mock("../src/background/minswap", async (original) => {
  const real = await original<typeof import("../src/background/minswap")>();
  return {
    ...real,
    uncheckedProtocols: (network: "preprod" | "mainnet", est: Parameters<typeof real.uncheckedProtocols>[1]) =>
      real.uncheckedProtocols(rule.mainnet ? "mainnet" : network, est),
  };
});

const leg = minswapEstimate.estimate.paths[0]![0]!;
const selling = { ...minswapEstimate.ask, tokenIn: MIN, tokenOut: "lovelace", amount: "500" };
const via = (...protocols: string[]) => ({ ...minswapEstimate.estimate, paths: protocols.map((protocol) => [{ ...leg, protocol }]) });

describe("SundaeSwapV3 on mainnet (independent review M16)", () => {
  it("is left out of routing, and a quote through it is refused before anything is funded", async () => {
    // Minswap builds its orders under a fixed staking part that isn't the sender's, which the check refuses.
    expect(MAINNET_PROTOCOLS).not.toContain("SundaeSwapV3");
    expect(excludedProtocols("mainnet")).toContain("SundaeSwapV3");
    // SundaeSwap's own first version stays: its orders name the destination, at a script staked to the sender.
    expect(MAINNET_PROTOCOLS).toContain("SundaeSwap");
    expect(excludedProtocols("mainnet")).not.toContain("SundaeSwap");

    const t = await unlocked();
    t.minswap.estimate = via("SundaeSwapV3");
    await expect(t.sessions.quote("mainnet", selling)).rejects.toThrow(
      "Minswap routes this swap through SundaeSwapV3, whose orders the wallet can't check yet",
    );
  });
});

describe("a mainnet swap's route (independent review M17)", () => {
  it("asks Minswap to leave out every DEX it offers that the wallet doesn't check, by the names Minswap takes", () => {
    const left = excludedProtocols("mainnet");
    // Every one Minswap offers is either checked or left out.
    for (const p of MINSWAP_PROTOCOLS) expect(MAINNET_PROTOCOLS.includes(p) !== left.includes(p)).toBe(true);
    expect(left).toEqual(expect.arrayContaining(["CswapV1", "SundaeSwapStable", "VyFinance", "MuesliSwap", ...DIRECT_PROTOCOLS]));
    // Minswap refuses a request naming a DEX it doesn't know: the list holds only its own names.
    for (const p of left) expect(MINSWAP_PROTOCOLS).toContain(p);
    expect(new Set(left).size).toBe(left.length);
  });

  it("pauses a funded swap whose fresh route goes through a DEX the wallet can't check, and places it once the route is back", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    rule.mainnet = true;
    try {
      await started(sessions);
      funded(t);
      // By the time the funding lands, Minswap's best route goes through CswapV1.
      t.minswap.estimate = via("MinswapV2", "CswapV1");
      let view = await sessions.advance("preprod", 0, true);
      expect(view.auto!.paused).toMatchObject({ why: "refused", detail: expect.stringContaining("CswapV1") });
      // Minswap wasn't asked to build it, and nothing was signed: only the funding went.
      expect(t.minswap.calls.map((c) => c.path)).not.toContain("build-tx");
      expect(t.koios.submitted).toHaveLength(1);
      // Nor does Review it myself build one.
      await expect(sessions.swapBuild("preprod", 0)).rejects.toThrow("Minswap now routes this swap through CswapV1");
      expect(t.minswap.calls.map((c) => c.path)).not.toContain("build-tx");

      // Try again, once the route is through DEXes it checks: the order goes.
      t.minswap.estimate = via("MinswapV2");
      view = await sessions.resume("preprod", 0);
      expect(view.auto!.paused).toBeUndefined();
      expect(t.minswap.calls.at(-1)!.path).toBe("build-tx");
      expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap"]);
    } finally {
      rule.mainnet = false;
    }
  });
});
