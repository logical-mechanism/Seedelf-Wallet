// 1.8.0's review of its fixes, round two, the sessions lane (docs/plans/review-1.8.0/fix2/sessions.md).
// - r2-worker#0: Stop's dialog counts its boxes as its return builds them. Where the session's collateral goes into the
//   5 ₳ pool its spare ADA goes into, the return's chain leaves that collateral's mix its two draws there (holdTail,
//   roomLeavingTail), and D3's rule picks its width on those counts. The dialog counted the pool's room without them: where
//   the room binds it named a box more than the return makes, with that box's mixes and fees, and at four a mix the wrong
//   width, a fall-back that doesn't happen, or its collateral "mixed" where the return builds no tail.
// - r2-worker#1: one listing of the pools a review. A site's funding review and a swap's Review read every pool's boxes
//   once, the collateral's look answered from that read (collateralRoom); a mix's review keeps its own fresh read of what
//   its draws leave; a read kept from before the pool was found reads it afresh.
// - r2-worker#2: a site's connect window's card reads the kept room alone, asking nobody even where that read lapses.
// Discovery is wired as sw.ts wires it (serviceDeps, lookForPools: discovery.look), and so is the data layer's index,
// which sw.ts hands the Lovejoin service too (its spends), from a head start that holds no pool on v2's scripts, as
// lovejoin-found-later.test.ts has it. Koios's holder is a counting fake; the pool's boxes come from the chain's fake, or
// on mainnet from the data layer's token feed where it covers the pool. With the real WebAssembly.
import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { DataParts } from "../src/background/data-layer";
import { Koios, type KoiosLaunch, type KoiosUtxo } from "../src/background/koios";
import { LovejoinService, POOL_ROOM_MS } from "../src/background/lovejoin";
import { HOLDER, PoolDiscovery, serviceDeps, type Kept } from "../src/background/lovejoin-pools";
import { Minswap } from "../src/background/minswap";
import { privateIndexClient } from "../src/background/private-index";
import { SessionService } from "../src/background/sessions";
import { i18n, t as tr } from "../src/i18n/core";
import bundled from "../src/lovejoin-pools.json";
import { NETWORKS, type NetworkName } from "../src/networks";
import { account, AGREES, atSession, PASSWORD } from "./chain-fixtures";
import { fakeIndex, indexRowOf } from "./fake-index";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, memoryArea, minswapEstimate, ownedUtxos, testBalances } from "./fakes";
import { ADA, ADA_ROWS, ADA_VIEW, adaStrangers } from "./v2-pools";

/** Real chains are built and measured in WebAssembly: seconds each, more on CI. */
const SLOW = { timeout: 300_000 };
const wasm = loadTestWasm();
/** The test clock's start (fakes.ts testWallet). */
const START = 1_800_000_000_000;
type T = ReturnType<typeof testBalances>;

const floors = { preprod: NETWORKS.preprod.lovejoin!.poolFloor, mainnet: NETWORKS.mainnet.lovejoin!.poolFloor };
afterEach(async () => {
  NETWORKS.preprod.lovejoin!.poolFloor = floors.preprod;
  NETWORKS.mainnet.lovejoin!.poolFloor = floors.mainnet;
  await i18n.changeLanguage("en");
});

/** Lovejoin v2's 5 ₳ pool's launch (a WebAssembly fixture, never on chain): ADA's pool here, launched after the head start. */
const FOUND = JSON.parse(readFileSync(new URL("../../wasm/tests/fixtures/lovejoin-v2-ada-pool-preprod.json", import.meta.url), "utf8")) as {
  seed: { txHash: string; txIndex: number };
  reference: KoiosUtxo;
  scripts: KoiosUtxo[];
};

/** The release's head start, less every pool on v2's scripts: the retired pools a device keeps, and the height read to. */
const HEAD = Object.fromEntries(
  (["preprod", "mainnet"] as const).map((n) => {
    const kept = (bundled as unknown as Record<NetworkName, Kept>)[n];
    return [n, { ...kept, pools: kept.pools.filter((p) => p.version !== "v2") }];
  }),
) as Record<NetworkName, Kept>;

/** The holder's address on `network`: on mainnet the fixture's rows are re-addressed, as the e2e's fiveAt does. */
const holderAt = (network: NetworkName) =>
  network === "mainnet" ? bech32("addr", Uint8Array.from([0x71, ...Buffer.from(HOLDER, "hex")])) : FOUND.reference.address;

/** An hour before the test clock starts: settled. */
const SETTLED = Math.floor(START / 1000) - 3600;

/** The launch's outputs at the holder, in the block after `network`'s head start, settled. */
const launchRows = (network: NetworkName): KoiosUtxo[] =>
  [FOUND.reference, ...FOUND.scripts].map((r) => ({ ...r, address: holderAt(network), block_height: HEAD[network].height + 1, block_time: SETTLED }));

/** The launch as tx_info gives it: its seed among the inputs, L registered. */
function launchOf(network: NetworkName): KoiosLaunch {
  const check = { network, reference: launchRows(network)[0], inputs: [FOUND.seed], scripts: launchRows(network).slice(1) };
  const { mixLogicStake } = JSON.parse(wasm.lovejoinLaunchCheck(JSON.stringify(check))) as { mixLogicStake: string };
  return {
    tx_hash: FOUND.reference.tx_hash,
    block_height: HEAD[network].height + 1,
    tx_block_index: 0,
    tx_timestamp: SETTLED,
    inputs: [{ tx_hash: FOUND.seed.txHash, tx_index: FOUND.seed.txIndex }],
    certificates: [{ type: "stake_registration", info: { stake_address: mixLogicStake } }],
  };
}

/** Koios as discovery reads it on `network`: the holder's outputs above `gt.`, and the launch's tx_info. */
function holderKoios(network: NetworkName): Koios {
  const holder = launchRows(network);
  return new Koios(
    network === "mainnet" ? "https://api.koios.rest/api/v1" : "https://preprod.koios.rest/api/v1",
    async (url: string, init: RequestInit) => {
      const u = new URL(url);
      const path = u.pathname.split("/").pop()!;
      const body = JSON.parse(String(init.body)) as Record<string, string[]>;
      if (path === "credential_utxos") {
        const after = /^gt\.(\d+)$/.exec(u.searchParams.get("block_height") ?? "");
        return Response.json(holder.filter((r) => body._payment_credentials!.includes(r.payment_cred!) && (!after || (r.block_height ?? 0) > Number(after[1]))));
      }
      if (path === "tx_info") return Response.json([launchOf(network)].filter((l) => body._tx_hashes!.includes(l.tx_hash)));
      return Response.json([]);
    },
    async () => undefined,
  );
}

/** The data layer's lovejoin/pools on mainnet, listing the pool, its crowd past the floor. */
function listing() {
  const slot = 100_000_000;
  return {
    network: "mainnet",
    cursor: `${slot}.${"0".repeat(64)}`,
    classic: { crowd: { boxes: 0, deposits: 0, mixed: 0 } },
    pools: [
      {
        id: ADA,
        seed: `${FOUND.seed.txHash}#${FOUND.seed.txIndex}`,
        reference: indexRowOf(launchRows("mainnet")[0]!, slot),
        scripts: launchRows("mainnet")
          .slice(1)
          .map((s) => ({ ...indexRowOf(s, slot), script: true, script_hash: s.reference_script!.hash })),
        launch: { tx: FOUND.reference.tx_hash, block: HEAD.mainnet.height + 1, index: 0, slot, time: slot + 1_591_566_291 },
        crowd: { boxes: 40, deposits: 0, mixed: 40 },
      },
    ],
  };
}

interface DeviceOptions {
  /** Mainnet's data layer: up (the default), or Settings' Koios only on. Preprod has none. */
  koiosOnly?: boolean;
  /** The data layer's token feed covers the 5 ₳ pool, its boxes `strangers`: mainnet's pool reads go there, not to Koios. */
  covered?: boolean;
  /** The pool's boxes that aren't the wallet's. */
  strangers?: KoiosUtxo[];
  /** The wallet's private balance, for a funding. */
  privateLovelace?: bigint;
}

/** A device as sw.ts wires it, with nothing kept of v2's 5 ₳ pool, nor read of any pool's room. */
async function device(o: DeviceOptions = {}) {
  const t = testBalances({ owned: false });
  await t.wallet.create(account(12).phrase, PASSWORD);
  t.koios.evaluation = AGREES;
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  if (o.privateLovelace !== undefined) {
    t.koios.added.push({ ...ownedUtxos[0]!, tx_hash: "d1".repeat(32), tx_index: 0, value: o.privateLovelace.toString() } as KoiosUtxo);
  }
  const strangers = o.strangers ?? ADA_ROWS;
  t.koios.addedToAccounts.push(...strangers);
  const idx = fakeIndex();
  idx.poolList = listing();
  if (o.covered) {
    idx.tokenPools = [ADA_VIEW.mixBoxHash];
    idx.tokens = strangers.map((u) => ({ row: indexRowOf(u, 1000) }));
  }
  const parts = new DataParts(memoryArea(), () => t.clock.now);
  // The data layer's origin as dataOrigin has it: mainnet's alone.
  const index = privateIndexClient(
    { koiosOnly: async () => !!o.koiosOnly, parts, fetch: idx.fetch, limits: {} },
    (n) => (n === "mainnet" ? "https://data.test" : undefined),
  );
  const discovery = new PoolDiscovery({ local: memoryArea(), wasm, koios: holderKoios, index, now: () => t.clock.now, headStart: (n) => HEAD[n] });
  const lovejoin = new LovejoinService({
    ...t.deps,
    index,
    wasm: {
      ...wasm,
      finishLovejoinWithdraw: (request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    ...serviceDeps(discovery),
    lookForPools: (n) => discovery.look(n),
    facts: async (n) => ({ launches: await discovery.launches(n), crowds: discovery.crowdsOf(n) }),
    random: () => 0.5,
  });
  const sessions = new SessionService({
    ...t.deps,
    wasm: {
      ...wasm,
      signScriptSpend: (_key: unknown, request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
    lovejoin,
    sleep: async () => undefined,
    alarm: { start: async () => undefined },
  });
  return { t, idx, lovejoin, sessions };
}
type Device = Awaited<ReturnType<typeof device>>;

/** The wallet's own Koios reads of the pools' boxes: a listing that names the 5 ₳ pool's mix_box (discovery's holder apart). */
const poolListings = (t: T) =>
  t.koios.calls.filter(
    (c) => c.path === "credential_utxos" && (c.body as { _payment_credentials?: string[] } | null)?._payment_credentials?.includes(ADA_VIEW.mixBoxHash),
  ).length;

/** The data layer's reads of the token pools' boxes (lovejoin/tokens, each listing's first). */
const tokenListings = (d: Device) => d.idx.calls.filter((c) => c === "lovejoin/tokens").length;

const ORIGIN = "https://example.org";
/** What a site's funding sets aside for its collateral's mix with nothing else left (tailReserve's `direct`; 2.8 ₳). */
const DIRECT = "2800000";
/** What a swap's funding sets aside for it (lovejoinCollateralReserve; 1.5 ₳). */
const CHAIN = wasm.lovejoinCollateralReserve();

/** Each chain as the sealed schedule keeps it: its boxes, its own mixes, its width, and its collateral's tail. */
type Sealed = { chains: Array<{ session?: number; boxes: number; mixes: string[]; width?: 4; tail?: { pool: string } }> };

/**
 * Session 0, a swap that runs itself, approved on 1.8.0 through Lovejoin `depth` deep at `width` (its record names the
 * 5 ₳ box it was priced at), its funding of `fund` and its collateral's reserve at its account beside its 5 ₳ collateral,
 * nothing of it sent yet: Stop brings that back.
 */
async function swapApproved(d: Device, { depth = 1, width = 3, fund = "40000000" }: { depth?: number; width?: 3 | 4; fund?: string } = {}) {
  const now = d.t.clock.now;
  await d.t.store.set("sessions.preprod", {
    next: 1,
    sessions: [
      {
        index: 0,
        ownStake: true,
        createdAt: now,
        txs: [{ kind: "out", txHash: "ab".repeat(32), at: now, confirmed: true }],
        swap: { ...minswapEstimate.ask, amountOut: "906594100", minAmountOut: "902083681" },
        collateralReserve: true,
        auto: {
          approved: { minAmountOut: "902083681", fund: { lovelace: fund, tokens: [] }, aggregatorFee: "0" },
          direct: false,
          lovejoin: { depth, delay: "1-6", ...(width === 4 ? { width: 4 } : {}), box: "5000000" },
        },
      },
    ],
  });
  d.t.koios.addedToAccounts.push(atSession("c1".repeat(32), 0, (BigInt(fund) + BigInt(CHAIN)).toString()), atSession("c2".repeat(32), 1, "5000000"));
  d.t.koios.confirmations = 1;
}

/** Stop's dialog, as the session's page reads it once its list has read the account, then the return Stop sends. */
async function stopThenBack(d: Device) {
  await d.sessions.list("preprod", true);
  const cost = (await d.sessions.stopCost("preprod", 0))!;
  await d.sessions.stop("preprod", 0);
  const chain = (await d.t.store.get<Sealed>("lovejoin.preprod"))!.chains.at(-1)!;
  return { cost, chain };
}

/** What `boxes` boxes of the 5 ₳ pool's, `depth` deep and `width` a mix, pay in mix fees: WebAssembly's estimate, per box. */
async function mixFeesOf(d: Device, boxes: number, depth: number, width: 3 | 4) {
  const one = await d.lovejoin.funding("preprod", 1, false, depth as 1 | 2 | 3, await d.lovejoin.adaPool("preprod"), width);
  return (BigInt(boxes) * BigInt(one.mixFees)).toString();
}

// ---------------------------------------------------------------------------
// r2-worker#0: Stop's dialog, beside the return it sends
// ---------------------------------------------------------------------------

describe("Stop's dialog counts its boxes as its return's chain builds them, the collateral's two draws held (r2-worker#0)", SLOW, () => {
  it("two waves deep with 16 strangers' boxes, on a device that kept nothing: one box, its four mixes and their fees, as its return", async () => {
    // Its 40 ₳ pays for more than the pool has room for. Each box draws 8: 16 fit two, but two leave its collateral's
    // mix none, so the chain makes one and keeps that mix its two (roomLeavingTail).
    const d = await device({ strangers: adaStrangers(16) });
    await swapApproved(d, { depth: 2 });
    const { cost, chain } = await stopThenBack(d);
    expect(chain).toMatchObject({ session: 0, boxes: 1 });
    expect(chain.tail).toBeDefined();
    expect(chain.mixes).toHaveLength(4);
    expect(cost).toMatchObject({ boxes: 1, mixes: 4, mixFees: await mixFeesOf(d, 1, 2, 3), collateralMix: "mixed" });
    expect(cost.mixFees).toBe("3800000");
  });

  it("four a mix, one wave deep, 4 strangers' boxes: its one box four a mix, as its return, and its collateral mixed only if enough is left", async () => {
    // Held, three makes one box as four does, so four goes (wayOver); that box draws three of the four, leaving the
    // collateral's mix one: the chain builds no tail. Counted unheld, the dialog said two boxes three a mix, a fall-back
    // that doesn't happen, and the collateral mixed.
    const d = await device({ strangers: adaStrangers(4) });
    await swapApproved(d, { width: 4 });
    const { cost, chain } = await stopThenBack(d);
    expect({ boxes: chain.boxes, width: chain.width, tail: chain.tail }).toEqual({ boxes: 1, width: 4, tail: undefined });
    expect({ boxes: cost.boxes, width: cost.width, fellBack: cost.fellBack, collateralMix: cost.collateralMix }).toEqual({
      boxes: 1,
      width: 4,
      fellBack: undefined,
      collateralMix: "ifLeft",
    });
    expect(cost.mixes).toBe(chain.mixes.length);
    expect(cost.mixFees).toBe(await mixFeesOf(d, 1, 1, 4));
  });

  it("four a mix, one wave deep, 6 strangers' boxes and 15 ₳: three a mix, as its return goes, and why", async () => {
    // Its 15 ₳ pays for two. Held, four has room for one where three has room for both: the chain goes three. Counted
    // unheld, the dialog said four a mix, and four's fees.
    const d = await device({ strangers: adaStrangers(6) });
    await swapApproved(d, { width: 4, fund: "15000000" });
    const { cost, chain } = await stopThenBack(d);
    expect({ boxes: chain.boxes, width: chain.width }).toEqual({ boxes: 2, width: undefined });
    expect({ boxes: cost.boxes, width: cost.width, fellBack: cost.fellBack }).toEqual({ boxes: 2, width: undefined, fellBack: tr("lj.width.warn.short") });
    expect(cost.mixFees).toBe(await mixFeesOf(d, 2, 1, 3));
  });

  it("holds those draws only where its collateral goes into the pool: 6 strangers' boxes, two boxes and the tail; Settings' collateral off, three", async () => {
    // The pool kept already (Lovejoin's page found it): the dialog's own read is the room's first.
    const on = await device({ strangers: adaStrangers(6) });
    expect(await on.lovejoin.lookForPools("preprod")).toEqual({ grew: true });
    await swapApproved(on);
    const held = await stopThenBack(on);
    expect(held.chain.boxes).toBe(2);
    expect(held.chain.tail).toBeDefined();
    expect(held.cost).toMatchObject({ boxes: 2, mixes: held.chain.mixes.length, collateralMix: "mixed" });
    // Its collateral comes back with the rest: nothing is held, and the room's three go.
    const off = await device({ strangers: adaStrangers(6) });
    await off.t.deps.preferences.set({ lovejoinCollateral: false });
    await swapApproved(off);
    const all = await stopThenBack(off);
    expect(all.chain.boxes).toBe(3);
    expect(all.chain.tail).toBeUndefined();
    expect(all.cost.boxes).toBe(3);
    expect(all.cost.collateralMix).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// r2-worker#1: one listing of the pools a review
// ---------------------------------------------------------------------------

describe("a review lists the pools once, its collateral's look answered from that read (r2-worker#1)", SLOW, () => {
  it("preprod, the pool kept: a site's funding review and a swap's Review each read every pool's boxes once", async () => {
    const d = await device({ privateLovelace: 1_000_000_000n });
    expect(await d.lovejoin.lookForPools("preprod")).toEqual({ grew: true });
    const before = poolListings(d.t);
    const site = await d.sessions.siteOutBuild("preprod", ORIGIN, "40000000", []);
    expect(site).toMatchObject({ collateralReserve: DIRECT, collateralMix: "ifLeft", lovejoinRoom: true });
    expect(poolListings(d.t) - before).toBe(1);
    // A swap's Review once the read the funding review made has lapsed: its price, its token's pools and its
    // collateral's look, on one read.
    d.t.clock.now += POOL_ROOM_MS;
    const quote = await d.sessions.quote("preprod", minswapEstimate.ask);
    const asked = poolListings(d.t);
    const review = await d.sessions.outBuild("preprod", quote);
    expect(review.collateralReserve).toBe(CHAIN);
    expect(review.lovejoin?.skipped).toBeUndefined();
    expect(poolListings(d.t) - asked).toBe(1);
  });

  it("mainnet, the data layer up and its token feed covering the pool: a site's funding review asks it once, and Koios not", async () => {
    const d = await device({ covered: true, strangers: adaStrangers(32), privateLovelace: 1_000_000_000n });
    expect(await d.lovejoin.lookForPools("mainnet")).toEqual({ grew: true });
    const tokens = tokenListings(d);
    const koios = poolListings(d.t);
    const site = await d.sessions.siteOutBuild("mainnet", ORIGIN, "40000000", []);
    expect(site).toMatchObject({ collateralReserve: DIRECT, lovejoinRoom: true });
    expect(tokenListings(d) - tokens).toBe(1);
    expect(poolListings(d.t) - koios).toBe(0);
  });

  it("a mix's review weighs its own draws against its own fresh read, never a kept one the wallet's chains have drawn on since", async () => {
    // 6 strangers' boxes read; then another chain of the wallet's reserves 3. The tile's Mix of one box, one wave deep,
    // draws 2 of the 3 left, leaving the collateral's mix one: mixed only if enough is left (1.8.0's release review, P1).
    const six = adaStrangers(6);
    const d = await device({ strangers: six, privateLovelace: 1_000_000_000n });
    await d.t.deps.preferences.set({ lovejoinDepth: 1 });
    expect(await d.lovejoin.lookForPools("preprod")).toEqual({ grew: true });
    expect((await d.lovejoin.room("preprod", ADA))?.free).toBe(6);
    d.t.clock.now += 60_000;
    await d.t.session.set("seedelf.reserved.preprod", { "chain-x": { inputs: six.slice(0, 3).map((u) => `${u.tx_hash}#${u.tx_index}`), collateral: [] } });
    const mix = await d.sessions.mixOutBuild("preprod", 1, { pool: ADA });
    expect(mix.collateralReserve).toBe(CHAIN);
    expect(mix.collateralMix).toBe("ifLeft");
  });

  it("a read kept from before the pool was found is read afresh for it: a site's funding review still reserves its collateral's mix", async () => {
    // The pools read while no 5 ₳ pool was kept (a token's review, say), then Lovejoin's page found it: the read that's
    // kept has no room for it, which is no read that failed.
    const d = await device({ privateLovelace: 1_000_000_000n });
    expect(await d.lovejoin.rooms("preprod")).toBeDefined();
    expect(await d.lovejoin.room("preprod", ADA)).toBeUndefined();
    expect(await d.lovejoin.lookForPools("preprod")).toEqual({ grew: true });
    const site = await d.sessions.siteOutBuild("preprod", ORIGIN, "40000000", []);
    expect(site.collateralReserve).toBe(DIRECT);
  });

  it("mainnet, the pool's last count under its floor and every read of it failing: a site's funding review says nothing of its collateral's mix", async () => {
    // A look that fails is a maybe, unless what the wallet last read of that pool says it won't take the collateral
    // (tailReserve's collateralPoolTakes; fx-may). A review's look is its one read of the pools (collateralRoom), so it
    // fails only where that read does, never on a read kept: here the data layer's last count of the pool's boxes is
    // under the floor, its token feed is down, and Koios fails for those boxes (1.8.0's release review, last-code#2).
    const d = await device({ covered: true, strangers: adaStrangers(32), privateLovelace: 1_000_000_000n });
    (d.idx.poolList as { pools: Array<{ crowd: unknown }> }).pools[0]!.crowd = { boxes: 20, deposits: 0, mixed: 20 };
    expect(await d.lovejoin.lookForPools("mainnet")).toEqual({ grew: true });
    expect(await d.lovejoin.collateralPoolTakes("mainnet")).toBe("no");
    d.idx.tokensFail = new Response("db-sync is down", { status: 503 });
    const real = d.t.koios.fetch;
    d.t.koios.fetch = async (url, init) =>
      String(url).includes("/credential_utxos") && String(init?.body ?? "").includes(ADA_VIEW.mixBoxHash)
        ? new Response("down", { status: 500 })
        : real(url, init);
    const site = await d.sessions.siteOutBuild("mainnet", ORIGIN, "40000000", []);
    expect(site.collateralReserve).toBeUndefined();
    expect(site.collateralMix).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// r2-worker#2: the connect window's card asks nobody
// ---------------------------------------------------------------------------

describe("a site's connect window's card reads the kept room alone (r2-worker#2)", SLOW, () => {
  it("asks nobody where the kept read lapses between its two looks at it, the clock a millisecond on at each read", async () => {
    const d = await device();
    expect(await d.lovejoin.lookForPools("preprod")).toEqual({ grew: true });
    const clock = d.t.clock;
    let base = clock.now;
    let reads = 0;
    let marked = 0;
    for (let k = 1; k <= 30; k++) {
      // A fresh read of the pools, the user busy so the wallet stays unlocked, then the card asked k ms before that read
      // lapses, the clock moving on at each look.
      base += 2 * POOL_ROOM_MS;
      Object.defineProperty(clock, "now", { configurable: true, writable: true, value: base });
      await d.t.wallet.touch();
      await d.lovejoin.rooms("preprod");
      let tick = base + POOL_ROOM_MS - k;
      Object.defineProperty(clock, "now", { configurable: true, get: () => tick++, set: (v: number) => (tick = v) });
      const before = poolListings(d.t);
      if (await d.sessions.lovejoinRoomKept("preprod")) marked++;
      reads += poolListings(d.t) - before;
      Object.defineProperty(clock, "now", { configurable: true, writable: true, value: tick });
    }
    expect(reads).toBe(0);
    // The kept read said yes where it hadn't lapsed.
    expect(marked).toBeGreaterThan(0);
  });
});
