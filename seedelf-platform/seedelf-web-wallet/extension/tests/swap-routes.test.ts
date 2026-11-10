// Which DEXes a mainnet swap goes through (independent review M16, M17): the
// ones whose orders the session's check reads, left to Minswap to route
// through, and every other DEX Minswap offers left out.
import { describe, expect, it, vi } from "vitest";

import type { KoiosUtxo } from "../src/background/koios";
import {
  DIRECT_PROTOCOLS,
  excludedProtocols,
  MAINNET_PROTOCOLS,
  Minswap,
  MinswapError,
  MINSWAP_PROTOCOLS,
  type Estimate,
} from "../src/background/minswap";
import { bech32 } from "./fixtures/bech32";
import { bytes, ORDER_DATUM, ORDER_SCRIPT, SESSION_ADDRESS, swapTx } from "./fixtures/swap-tx";
import { minswapEstimate, sessionSwap } from "./fakes";
import { ASK, atSession, MIN, funded, signing, started, unlocked, type T } from "./swap-session";

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
    // Beside another leg its order is Minswap's to cancel, and never expires: refused if Minswap still routes so, in
    // words that don't call DEXes the wallet checks ones it can't (release review C34).
    t.minswap.estimate = { ...minswapEstimate.estimate, paths: [[{ ...leg, protocol: "MinswapV2" }, { ...leg, protocol: "SundaeSwapV3" }]] };
    const refused = t.sessions.quote("mainnet", selling);
    await expect(refused).rejects.toThrow(
      "Minswap routes this swap through MinswapV2 and SundaeSwapV3 in a way the wallet's check can't follow, so it won't swap this way",
    );
    await expect(refused).rejects.not.toThrow(/can't check yet/);
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

  it("knows the 19 DEXes Minswap's live API took on 2026-11-09, WingRidersStableV1 included", () => {
    // Its 400 answer to an unknown name allowed 23 constants, without naming them. WingRidersStableV1, left off at
    // first, stayed routable.
    expect(MINSWAP_PROTOCOLS).toContain("WingRidersStableV1");
    expect(new Set(MINSWAP_PROTOCOLS).size).toBe(19);
    expect(MAINNET_PROTOCOLS).not.toContain("WingRidersStableV1");
  });

  it("never sends ChakraBondingCurve: Minswap stopped taking the name, and one name it refuses fails every quote", () => {
    for (const network of ["preprod", "mainnet"] as const) expect(excludedProtocols(network)).not.toContain("ChakraBondingCurve");
    expect(MINSWAP_PROTOCOLS).not.toContain("ChakraBondingCurve");
  });

  it("routes through SundaeSwap V4 on mainnet, whose orders the wallet reads and cancels, and leaves it out of preprod, which has no V4 to pin (chunk 47)", () => {
    expect(MAINNET_PROTOCOLS).toContain("SundaeSwapV4");
    expect(excludedProtocols("mainnet")).not.toContain("SundaeSwapV4");
    expect(excludedProtocols("preprod")).toContain("SundaeSwapV4");
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

describe("a route through a DEX the wallet doesn't know (2026-11-09)", () => {
  /** Minswap's answer, as its router's: through `dex` until it's asked to leave that out, then through MinswapV2. */
  const routesThrough = (t: Awaited<ReturnType<typeof unlocked>>, dex: string) =>
    Object.defineProperty(t.minswap, "estimate", {
      get: () => {
        const { body } = t.minswap.calls.at(-1)!;
        return via((body.exclude_protocols ?? body.estimate.exclude_protocols).includes(dex) ? "MinswapV2" : dex);
      },
    });

  it("is asked for again without it on mainnet, and quoted, so a DEX Minswap adds doesn't cost the swap its quote", async () => {
    const t = await unlocked();
    routesThrough(t, "SomeNewDex");
    await expect(t.sessions.quote("mainnet", selling)).resolves.toMatchObject({ route: ["MinswapV2"] });
    const asked = t.minswap.calls.filter((c) => c.path === "estimate");
    expect(asked).toHaveLength(2);
    expect(asked[0]!.body.exclude_protocols).not.toContain("SomeNewDex");
    expect(asked[1]!.body.exclude_protocols).toContain("SomeNewDex");
  });

  it("is left out of the runner's build too, so the order goes through the route that was checked", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    rule.mainnet = true;
    try {
      await started(sessions);
      funded(t);
      routesThrough(t, "CswapV1");
      const view = await sessions.advance("preprod", 0, true);
      expect(view.auto!.paused).toBeUndefined();
      const built = t.minswap.calls.filter((c) => c.path === "build-tx");
      expect(built).toHaveLength(1);
      expect(built[0]!.body.estimate.exclude_protocols).toContain("CswapV1");
      expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap"]);
    } finally {
      rule.mainnet = false;
    }
  });

  it("isn't asked for again on preprod, where only the check stands", async () => {
    const t = await unlocked();
    t.minswap.estimate = via("CswapV1");
    await expect(t.sessions.quote("preprod", selling)).resolves.toMatchObject({ route: ["CswapV1"] });
    expect(t.minswap.calls.filter((c) => c.path === "estimate")).toHaveLength(1);
  });

  /** Session 0's address on mainnet (hex): its own payment key and stake key. */
  const MAINNET_SESSION = `01${SESSION_ADDRESS.slice(2)}`;

  /**
   * Session 0 on mainnet, its funding confirmed and its swap not placed yet: the fakes serve any network, and the book
   * is a store key per network (order-cancel-check.test.ts). Minswap builds its Minswap V1 order there, at the same
   * script as preprod's.
   */
  async function fundedOnMainnet(t: T) {
    const now = t.clock.now;
    await t.store.set("sessions.mainnet", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: now,
          txs: [{ kind: "out", txHash: sessionSwap.utxo.tx_hash, at: now, confirmed: true }],
          swap: { ...ASK, amountOut: "906594100", minAmountOut: "902083681" },
          auto: { approved: { minAmountOut: "902083681", fund: { lovelace: "16000000", tokens: [] } } },
        },
      ],
    });
    t.koios.confirmations = 1;
    t.koios.addedToAccounts.push({
      ...atSession(sessionSwap.utxo.tx_hash, sessionSwap.utxo.tx_index, sessionSwap.utxo.value),
      address: bech32("addr", bytes(MAINNET_SESSION)),
    } as KoiosUtxo);
    t.minswap.swapCbor = swapTx({
      outputs: [
        [`11${ORDER_SCRIPT}${SESSION_ADDRESS.slice(58)}`, 14_000_000, ORDER_DATUM],
        [MAINNET_SESSION, 131_585_414],
      ],
    });
  }

  it("is asked for again on mainnet by Review it myself and the runner's order too, and built without it (1.9.0's release review, mutants#4)", async () => {
    // routeOf is given the session's own network at each: asked as preprod, neither would ask again.
    const t = await unlocked();
    const sessions = signing(t);
    await fundedOnMainnet(t);
    routesThrough(t, "SomeNewDex");
    const leftOut = (body: any): string[] => body.exclude_protocols ?? body.estimate.exclude_protocols;
    const asked = () => t.minswap.calls.map((c) => [c.path, leftOut(c.body).includes("SomeNewDex")]);
    await expect(sessions.swapBuild("mainnet", 0)).resolves.toMatchObject({ kind: "swap" });
    expect(asked()).toEqual([
      ["estimate", false],
      ["estimate", true],
      ["build-tx", true],
    ]);
    t.minswap.calls.length = 0;
    const view = await sessions.advance("mainnet", 0, true);
    expect(view.auto!.paused).toBeUndefined();
    expect(view.auto!.retry).toBeUndefined();
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap"]);
    expect(asked()).toEqual([
      ["estimate", false],
      ["estimate", true],
      ["build-tx", true],
    ]);
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
      // MinswapV2 is a DEX the wallet checks: the words say it's the way through it (release review C34).
      const refused = t.sessions.quote(network, selling);
      await expect(refused).rejects.toThrow(
        "Minswap routes this swap through MinswapV2 in a way the wallet's check can't follow, so it won't swap this way. Try another amount or pair.",
      );
      await expect(refused).rejects.not.toThrow(/can't check yet/);
    }
  });

  it("pauses a funded swap Minswap still routes so, in those words, and Review it myself says the same: neither builds", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await started(sessions);
    funded(t);
    t.minswap.estimate = hops;
    const view = await sessions.advance("preprod", 0, true);
    expect(view.auto!.paused).toMatchObject({
      why: "refused",
      detail: "Minswap now routes it through MinswapV2 in a way the wallet's check can't follow.",
    });
    await expect(sessions.swapBuild("preprod", 0)).rejects.toThrow(
      "Minswap now routes this swap through MinswapV2 in a way the wallet's check can't follow, so it won't swap this way. Try again later, or Stop to bring it back.",
    );
    expect(t.minswap.calls.map((c) => c.path)).not.toContain("build-tx");
    expect(t.koios.submitted).toHaveLength(1);
  });

  it("is refused through a DEX the wallet doesn't know in that DEX's words first, on mainnet, legs or not", async () => {
    const t = await unlocked();
    t.minswap.estimate = { ...minswapEstimate.estimate, paths: [[{ ...leg, protocol: "MinswapV2" }, { ...leg, protocol: "CswapV1" }]] };
    await expect(t.sessions.quote("mainnet", selling)).rejects.toThrow(
      "Minswap routes this swap through CswapV1, which the wallet can't check yet, so it won't swap this way.",
    );
    // On preprod, where only the check stands, it's the route's way that's refused.
    await expect(t.sessions.quote("preprod", selling)).rejects.toThrow(
      "Minswap routes this swap through MinswapV2 and CswapV1 in a way the wallet's check can't follow",
    );
  });
});

describe("a second ask Minswap refuses (1.9.0's release review, routes#1)", () => {
  /** Minswap's live answer to a DEX name its validator doesn't take (2026-11-09): 23 names allowed, then anyOf's. */
  const nameRefused = (at: number) =>
    Response.json(
      {
        statusCode: 400,
        code: "FST_ERR_VALIDATION",
        error: "Bad Request",
        message: [
          ...Array<string>(23).fill(`body/exclude_protocols/${at} must be equal to constant`),
          `body/exclude_protocols/${at} must match a schema in anyOf`,
        ].join(", "),
      },
      { status: 400 },
    );
  /** Minswap's live answer when what's left out leaves it no route (2026-11-09). */
  const noRoute = () => Response.json({ error: "QuoteNotFoundError", message: "Quote not found." }, { status: 404 });

  /**
   * Minswap's router: `route` until it's asked to leave `dex` out; then `refused`'s answer (told where `dex` is in
   * that list), or, where it gives none, a route around it through MinswapV2.
   */
  function leavingOut(t: T, dex: string, route: Pick<Estimate, "paths">, refused: (at: number) => Response | undefined) {
    const answer = t.minswap.fetch;
    t.minswap.fetch = async (url, init) => {
      const body = init.body ? JSON.parse(String(init.body)) : {};
      const left: string[] = body.exclude_protocols ?? body.estimate?.exclude_protocols ?? [];
      const refusal = left.includes(dex) ? refused(left.indexOf(dex)) : undefined;
      if (refusal) {
        t.minswap.calls.push({ path: new URL(url).pathname.split("/").pop()!, body });
        return refusal;
      }
      const now = left.includes(dex) ? via("MinswapV2") : route;
      t.minswap.estimate = { ...minswapEstimate.estimate, paths: now.paths };
      return answer(url, init);
    };
  }
  const paths = (t: T) => t.minswap.calls.map((c) => c.path);

  it("tells these two refusals by Minswap's own words and status, and nothing else", async () => {
    const troubleOf = (status: number, said: object) => {
      const minswap = new Minswap("https://minswap.test/aggregator", async () => Response.json(said, { status }));
      return minswap.estimate(selling, ["SomeNewDex"]).then(
        () => "answered",
        (e: unknown) => (e instanceof MinswapError ? e.trouble : "not Minswap's"),
      );
    };
    const constant = { message: "body/exclude_protocols/1 must be equal to constant" };
    const notFound = { error: "QuoteNotFoundError", message: "Quote not found." };
    expect(await troubleOf(400, await nameRefused(1).json())).toBe("name-refused");
    expect(await troubleOf(404, await noRoute().json())).toBe("no-route");
    // The same words under another status, and another 404, are any other refusal.
    expect(await troubleOf(500, constant)).toBeUndefined();
    expect(await troubleOf(500, notFound)).toBeUndefined();
    expect(await troubleOf(404, { message: "Route not found" })).toBeUndefined();
  });

  // A DEX the wallet doesn't check, on mainnet: one whose name Minswap's validator won't take (as it stopped taking
  // ChakraBondingCurve's), and one it takes with nothing else to route through.
  const unchecked = [
    { dex: "ChakraBondingCurve", refused: nameRefused },
    { dex: "SomeNewDex", refused: noRoute },
  ];

  it.each(unchecked)("keeps the first answer through $dex, so the quote is refused in the wallet's words, not Minswap's", async ({ dex, refused }) => {
    const t = await unlocked();
    leavingOut(t, dex, via(dex), refused);
    await expect(t.sessions.quote("mainnet", selling)).rejects.toThrow(
      `Minswap routes this swap through ${dex}, which the wallet can't check yet, so it won't swap this way. Try another amount or pair.`,
    );
    expect(paths(t)).toEqual(["estimate", "estimate"]);
  });

  it.each(unchecked)("pauses a funded swap through $dex in those words, as Review it myself refuses it: neither builds, and Stop brings it back", async ({ dex, refused }) => {
    const t = await unlocked();
    const sessions = signing(t);
    rule.mainnet = true;
    try {
      await started(sessions);
      funded(t);
      leavingOut(t, dex, via(dex), refused);
      let view = await sessions.advance("preprod", 0, true);
      const detail = `Minswap now routes it through ${dex}, whose orders the wallet can't check yet.`;
      expect(view.auto!.paused).toMatchObject({ why: "refused", detail });
      expect(view.auto!.retry).toBeUndefined();
      await expect(sessions.swapBuild("preprod", 0)).rejects.toThrow(
        `Minswap now routes this swap through ${dex}, which the wallet can't check yet, so it won't swap this way. Try again later, or Stop to bring it back.`,
      );
      expect(paths(t)).not.toContain("build-tx");
      expect(t.koios.submitted).toHaveLength(1);
      view = await sessions.stop("preprod", 0);
      expect(view.txs.map((x) => x.kind)).toEqual(["out", "back"]);
    } finally {
      rule.mainnet = false;
    }
  });

  // Asked again for a route the session's check can't follow (outOfPlace): a path of two legs, or Danogo beside another
  // DEX. The first answer stands for these too, refused in the words for its way, on either network: nothing is built
  // through a leg the session couldn't check or cancel.
  const legs = { paths: [[{ ...leg, protocol: "MinswapV2" }, { ...leg, protocol: "SundaeSwapV3" }]] };
  const outOfPlace = [
    { shape: "a path of two legs", dex: "SundaeSwapV3", route: legs, named: "MinswapV2 and SundaeSwapV3" },
    { shape: "Danogo beside another DEX", dex: "DanogoCLMMV1", route: via("DanogoCLMMV1", "MinswapV2"), named: "DanogoCLMMV1" },
  ].flatMap((c) => [
    { ...c, why: "no route", refused: noRoute },
    { ...c, why: "a name", refused: nameRefused },
  ]);

  it.each(outOfPlace)("keeps the first answer as $shape ($why refused), so the quote is refused for its way, on either network", async ({ dex, route, named, refused }) => {
    for (const network of ["preprod", "mainnet"] as const) {
      const t = await unlocked();
      leavingOut(t, dex, route, refused);
      const quoted = t.sessions.quote(network, selling);
      await expect(quoted, network).rejects.toThrow(
        `Minswap routes this swap through ${named} in a way the wallet's check can't follow, so it won't swap this way. Try another amount or pair.`,
      );
      expect(paths(t), network).toEqual(["estimate", "estimate"]);
    }
  });

  it.each(outOfPlace)("pauses a funded swap Minswap routes as $shape ($why refused) in those words, as Review it myself refuses it: nothing is built", async ({ dex, route, named, refused }) => {
    const t = await unlocked();
    const sessions = signing(t);
    await started(sessions);
    funded(t);
    leavingOut(t, dex, route, refused);
    const view = await sessions.advance("preprod", 0, true);
    const detail = `Minswap now routes it through ${named} in a way the wallet's check can't follow.`;
    expect(view.auto!.paused).toMatchObject({ why: "refused", detail });
    expect(view.auto!.retry).toBeUndefined();
    await expect(sessions.swapBuild("preprod", 0)).rejects.toThrow(
      `Minswap now routes this swap through ${named} in a way the wallet's check can't follow, so it won't swap this way. Try again later, or Stop to bring it back.`,
    );
    // Only the funding went: no order through a leg the session's check never read.
    expect(paths(t)).not.toContain("build-tx");
    expect(t.koios.submitted).toHaveLength(1);
  });

  it("still throws on a limit or an outage, as any ask does: the quote fails, and the runner tries again, then places the swap once Minswap answers", async () => {
    for (const [refusal, said] of [
      [() => new Response("", { status: 429 }), "Minswap is limiting requests from your connection. Wait a minute and try again."],
      [() => new Response("upstream down", { status: 503 }), "Minswap refused it (503): upstream down"],
    ] as const) {
      const t = await unlocked();
      leavingOut(t, "SomeNewDex", via("SomeNewDex"), refusal);
      await expect(t.sessions.quote("mainnet", selling)).rejects.toThrow(said);
    }
    const t = await unlocked();
    const sessions = signing(t);
    rule.mainnet = true;
    try {
      await started(sessions);
      funded(t);
      let refusal: (() => Response) | undefined = () => new Response("", { status: 429 });
      leavingOut(t, "CswapV1", via("CswapV1"), () => refusal?.());
      let view = await sessions.advance("preprod", 0, true);
      expect(view.auto!.paused).toBeUndefined();
      expect(view.auto!.retry).toMatchObject({ reason: "minswap-rate-limited" });
      refusal = () => new Response("upstream down", { status: 503 });
      view = await sessions.advance("preprod", 0, true);
      expect(view.auto!.paused).toBeUndefined();
      expect(view.auto!.retry).toMatchObject({ reason: "other", error: "Minswap refused it (503): upstream down" });
      expect(paths(t)).not.toContain("build-tx");
      refusal = undefined;
      view = await sessions.advance("preprod", 0, true);
      expect(view.auto!.paused).toBeUndefined();
      expect(view.auto!.retry).toBeUndefined();
      expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap"]);
    } finally {
      rule.mainnet = false;
    }
    // Two quotes and a runner's three steps, each unlocking a wallet: room on a loaded runner (1.9.0's review of its
    // fixes, r2-tests#3).
  }, 20_000);

  // Anywhere but routeOf's second ask, either refusal is like any other. A first ask refused (a name on the wallet's
  // own list, as ChakraBondingCurve was on 2026-11-09, or a pair with no route left) is retried in Minswap's words,
  // never paused (1.9.0's review of its fixes, r2-tests#2).
  it.each([
    { why: "a name on the wallet's own list", refused: () => nameRefused(0), said: "Minswap refused it (400): body/exclude_protocols/0 must be equal to constant" },
    { why: "no route", refused: noRoute, said: "Minswap refused it (404): Quote not found." },
  ])("retries a funded swap whose first ask is refused for $why, in Minswap's words", async ({ refused, said }) => {
    const t = await unlocked();
    const sessions = signing(t);
    await started(sessions);
    funded(t);
    const answer = t.minswap.fetch;
    t.minswap.fetch = async (url, init) => {
      if (!new URL(url).pathname.endsWith("/estimate")) return answer(url, init);
      t.minswap.calls.push({ path: "estimate", body: init.body ? JSON.parse(String(init.body)) : {} });
      return refused();
    };
    const before = t.minswap.calls.length;
    const view = await sessions.advance("preprod", 0, true);
    expect(view.auto!.paused).toBeUndefined();
    expect(view.auto!.retry).toMatchObject({ reason: "other" });
    expect(view.auto!.retry!.error).toContain(said);
    // The first ask alone: nothing asked again, nothing built, only the funding sent.
    expect(paths(t).slice(before)).toEqual(["estimate"]);
    expect(t.koios.submitted).toHaveLength(1);
  });
});
