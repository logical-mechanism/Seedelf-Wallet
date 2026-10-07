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

describe("SundaeSwapV3 on mainnet (independent review M16, chunk 24)", () => {
  it("is routed through as a path of its own, once the check reads its orders and Stop can cancel one", async () => {
    // Minswap builds its orders under a fixed staking part, owned by the sender's stake key: the check pins both.
    expect(MAINNET_PROTOCOLS).toContain("SundaeSwapV3");
    expect(excludedProtocols("mainnet")).not.toContain("SundaeSwapV3");
    expect(MAINNET_PROTOCOLS).toContain("SundaeSwap");

    const t = await unlocked();
    t.minswap.estimate = via("SundaeSwapV3");
    await expect(t.sessions.quote("mainnet", selling)).resolves.toMatchObject({ route: ["SundaeSwapV3"] });
    // Beside another leg its order is Minswap's to cancel, and never expires: refused if Minswap still routes so.
    t.minswap.estimate = { ...minswapEstimate.estimate, paths: [[{ ...leg, protocol: "MinswapV2" }, { ...leg, protocol: "SundaeSwapV3" }]] };
    await expect(t.sessions.quote("mainnet", selling)).rejects.toThrow(
      "Minswap routes this swap through MinswapV2 and SundaeSwapV3, which the wallet can't check yet, so it won't swap this way",
    );
  });
});

describe("a mainnet swap's route (independent review M17)", () => {
  it("asks Minswap to leave out every DEX it offers that the wallet doesn't check, by the names Minswap takes", () => {
    const left = excludedProtocols("mainnet");
    // Every one Minswap offers is either checked or left out.
    for (const p of MINSWAP_PROTOCOLS) expect(MAINNET_PROTOCOLS.includes(p) !== left.includes(p)).toBe(true);
    expect(left).toEqual(
      expect.arrayContaining(["CswapV1", "SundaeSwapStable", "SplashStable", "WingRidersStableV1", "VyFinance", "MuesliSwap", ...DIRECT_PROTOCOLS]),
    );
    // Minswap refuses a request naming a DEX it doesn't know: the list holds only its own names.
    for (const p of left) expect(MINSWAP_PROTOCOLS).toContain(p);
    expect(new Set(left).size).toBe(left.length);
  });

  it("knows every DEX Minswap's live API named on 2026-09-27, WingRidersStableV1 included", () => {
    // Its 400 answer to an unknown name allowed 19 constants. WingRidersStableV1, left off at first, stayed routable.
    expect(MINSWAP_PROTOCOLS).toContain("WingRidersStableV1");
    expect(new Set(MINSWAP_PROTOCOLS).size).toBe(19);
    expect(MAINNET_PROTOCOLS).not.toContain("WingRidersStableV1");
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

describe("a route of more than one leg (chunk 24)", () => {
  // MIN → ADA → iUSD: two Minswap V2 pools, one after the other.
  const hops = { ...minswapEstimate.estimate, paths: [[{ ...leg, protocol: "MinswapV2" }, { ...leg, protocol: "MinswapV2" }]] };

  it("is never asked for: every estimate and build asks Minswap for a direct route", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await sessions.quote("preprod", selling);
    await started(sessions);
    funded(t);
    await sessions.advance("preprod", 0, true);
    expect(t.minswap.calls.map((c) => c.path)).toContain("build-tx");
    for (const c of t.minswap.calls.filter((c) => c.path === "estimate")) expect(c.body).toMatchObject({ allow_multi_hops: false });
    for (const c of t.minswap.calls.filter((c) => c.path === "build-tx")) expect(c.body).toMatchObject({ estimate: { allow_multi_hops: false } });
  });

  it("is refused if Minswap routes so anyway, whichever DEXes, on either network: the check never sees a later leg's order", async () => {
    const t = await unlocked();
    t.minswap.estimate = hops;
    for (const network of ["preprod", "mainnet"] as const) {
      await expect(t.sessions.quote(network, selling)).rejects.toThrow(
        "Minswap routes this swap through MinswapV2, which the wallet can't check yet, so it won't swap this way",
      );
    }
  });
});
