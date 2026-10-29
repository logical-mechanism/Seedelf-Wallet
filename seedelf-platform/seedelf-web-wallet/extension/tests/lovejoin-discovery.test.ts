// Finding Lovejoin's token pools (chunk 34's 34c): the shown-pool rule's last
// step against the scenarios the data layer is held to too; a look at Koios's
// holder, from Lovejoin's own preprod pool as its launch would have been had
// it put its scripts at the holder; and the data layer's list, each pool
// verified here again. With the real WebAssembly.
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { DataParts } from "../src/background/data-layer";
import { Koios, type KoiosLaunch, type KoiosUtxo } from "../src/background/koios";
import {
  HOLDER,
  PoolDiscovery,
  REFRESH_MS,
  SETTLE_MS,
  serviceDeps,
  shown,
  type DiscoveryDeps,
  type FoundPool,
  type Kept,
} from "../src/background/lovejoin-pools";
import { privateIndexClient } from "../src/background/private-index";
import { fakeIndex, indexRowOf } from "./fake-index";
import { loadTestWasm, memoryArea, type MemoryArea } from "./fakes";

/** PR #163's token pool on preprod, as Koios lists it: its scripts at a key address. */
const FOUND = JSON.parse(readFileSync(new URL("../../wasm/tests/fixtures/lovejoin-token-pool-preprod.json", import.meta.url), "utf8")) as {
  seed: { txHash: string; txIndex: number };
  reference: KoiosUtxo;
  scripts: KoiosUtxo[];
};
const SCENARIOS = JSON.parse(readFileSync(new URL("./fixtures/lovejoin-shown.json", import.meta.url), "utf8")) as {
  scenarios: Array<{ about: string; pools: Array<{ id: string; boxLovelace: string; token: { policy: string; name: string; quantity: string } | null; launch: { block: number; index: number } }>; shown: string[] }>;
};

const ID = "c5852bb700034b0b259c9e237e58ffc5d022ce8f67600fbf32736e69";
const LJTEST = "02d597331203e9e2ec8b954b26a33503f044578c836407bf125f31fa" + Buffer.from("LJTEST").toString("hex");
const MIX_BOX = "b51f7e0331d32c706c0657a9ae28e5900e651d569d922b7093b52ea4";
const MIX_LOGIC = "ada2c293ad286873fb2d265b4a8597edc5271e927e13dc0496e7b953";
const LAUNCH = FOUND.reference.tx_hash;
const BLOCK = FOUND.reference.block_height!;

/** Its two scripts as its launch would have put them at the holder, outputs 1 and 2 of the same transaction. */
const SCRIPTS: KoiosUtxo[] = FOUND.scripts.map((s, i) => ({
  ...s,
  tx_hash: LAUNCH,
  tx_index: i + 1,
  address: FOUND.reference.address,
  payment_cred: HOLDER,
  stake_address: null,
  block_height: BLOCK,
}));

const wasm = loadTestWasm();

/** L's reward account: what a standard launch registers. */
const L_STAKE = (
  JSON.parse(
    wasm.lovejoinLaunchCheck(JSON.stringify({ network: "preprod", reference: FOUND.reference, inputs: [FOUND.seed], scripts: SCRIPTS })),
  ) as { mixLogicStake: string }
).mixLogicStake;

/** Its launch's transaction as Koios's tx_info gives it: the seed among its inputs, L registered. */
function launch(certificates: KoiosLaunch["certificates"] = [{ type: "stake_registration", info: { stake_address: L_STAKE } }]): KoiosLaunch {
  return {
    tx_hash: LAUNCH,
    block_height: BLOCK,
    tx_block_index: 3,
    tx_timestamp: FOUND.reference.block_time!,
    inputs: [
      { tx_hash: "00".repeat(32), tx_index: 0 },
      { tx_hash: FOUND.seed.txHash, tx_index: FOUND.seed.txIndex },
    ],
    certificates,
  };
}

/** Koios, answering the holder's outputs, utxo_info, tx_info and account_update_history from what a test gives it. */
function koiosOf(holder: KoiosUtxo[], launches: KoiosLaunch[], registrations: Array<{ stake_address: string; block_time: number }> = []) {
  const calls: Array<{ path: string; query: string; body: any }> = [];
  const fake = {
    calls,
    fail: undefined as Response | undefined,
    /** The chain's outputs, for utxo_info: the pool's reference UTxO and its two scripts at the holder. */
    chain: [FOUND.reference, ...SCRIPTS],
    /** What tx_info waits for before it answers, when set: a Koios hung, timing out and trying again. */
    hold: undefined as Promise<void> | undefined,
    koios: undefined as unknown as Koios,
    fetch: async (url: string, init: RequestInit) => {
      const u = new URL(url);
      const path = u.pathname.split("/").pop()!;
      const body = JSON.parse(String(init.body));
      calls.push({ path, query: u.searchParams.toString(), body });
      if (fake.fail) return fake.fail.clone();
      if (path === "credential_utxos") {
        const after = /^gt\.(\d+)$/.exec(u.searchParams.get("block_height") ?? "");
        return Response.json(holder.filter((r) => body._payment_credentials.includes(r.payment_cred) && (!after || (r.block_height ?? 0) > Number(after[1]))));
      }
      if (path === "utxo_info") return Response.json(fake.chain.filter((r) => body._utxo_refs.includes(`${r.tx_hash}#${r.tx_index}`)));
      if (path === "tx_info") {
        await fake.hold;
        return Response.json(launches.filter((l) => body._tx_hashes.includes(l.tx_hash)));
      }
      if (path === "account_update_history") return Response.json(registrations.filter((r) => body._stake_addresses.includes(r.stake_address)));
      return Response.json([]);
    },
  };
  fake.koios = new Koios("https://preprod.koios.rest/api/v1", fake.fetch, async () => undefined);
  return fake;
}

function discovery(
  k: ReturnType<typeof koiosOf>,
  {
    listed = new Set([LJTEST]),
    index,
    head = () => ({ height: 0, pools: [] }),
    local = memoryArea(),
    wasm: module = wasm,
  }: { listed?: ReadonlySet<string>; index?: ReturnType<typeof onIndex>; head?: () => Kept; local?: MemoryArea; wasm?: DiscoveryDeps["wasm"] } = {},
) {
  const clock = { now: 1_800_000_000_000 };
  // The wallet's lock, for WebAssembly that trapped under a check no request waits for (sw.ts: wallet.trapped).
  let traps = 0;
  const found = new PoolDiscovery({
    local,
    wasm: module,
    koios: () => k.koios,
    ...(index ? { index: index.client } : {}),
    wallet: { trapped: async () => void traps++ },
    now: () => clock.now,
    listed: () => listed,
    // From the holder's start: the bundled head start moves at each release.
    headStart: head,
  });
  return { found, local, clock, traps: () => traps };
}

const asked = (k: ReturnType<typeof koiosOf>, path: string) => k.calls.filter((c) => c.path === path);

describe("the shown-pool rule's last step", () => {
  it("shows the earliest launched of each value, in launch order, as the data layer does", () => {
    expect(SCENARIOS.scenarios.length).toBeGreaterThanOrEqual(10);
    for (const s of SCENARIOS.scenarios) {
      const pools: FoundPool[] = s.pools.map((p) => ({
        id: p.id,
        boxLovelace: p.boxLovelace,
        ...(p.token ? { token: { policyId: p.token.policy, assetName: p.token.name, quantity: p.token.quantity } } : {}),
        ref: { reference: FOUND.reference, seed: FOUND.seed },
        launch: { ...p.launch, tx: "aa".repeat(32) },
      }));
      expect(shown(pools).map((p) => p.id), s.about).toEqual(s.shown);
    }
  });
});

describe("looking at Koios's holder", () => {
  it("finds a standard launch from its own transaction, and reads on from where it stopped", async () => {
    const k = koiosOf([FOUND.reference, ...SCRIPTS], [launch()]);
    const { found, local } = discovery(k);
    await found.scan("preprod");
    const [pool, ...more] = await found.known("preprod");
    expect(more).toEqual([]);
    expect(pool).toMatchObject({ id: ID, boxLovelace: "2000000", launch: { block: BLOCK, index: 3, tx: LAUNCH } });
    expect(pool!.token).toMatchObject({ quantity: "10000000000000000" });
    // Kept with its scripts named by their hashes alone: WebAssembly fills in the bytes it derives.
    expect(pool!.ref.scripts!.map((s) => [s.reference_script?.hash, s.reference_script?.bytes])).toEqual([
      [MIX_BOX, null],
      [MIX_LOGIC, null],
    ]);
    const view = JSON.parse(wasm.lovejoinVerifyPool(JSON.stringify({ network: "preprod", pool: pool!.ref }))) as { scriptsInline: number };
    expect(view.scriptsInline).toBe(0);
    expect((await local.get<{ height: number }>("seedelf.lovejoinPools.preprod"))!.height).toBe(BLOCK);
    // One holder read, one tx_info. The next look reads the last blocks again and asks about nothing it knows.
    expect([asked(k, "credential_utxos").length, asked(k, "tx_info").length]).toEqual([1, 1]);
    expect(asked(k, "credential_utxos")[0]!.body._payment_credentials).toEqual([HOLDER]);
    await found.scan("preprod");
    expect(asked(k, "credential_utxos")[1]!.query).toContain(`block_height=gt.${BLOCK - 20}`);
    expect(asked(k, "tx_info")).toHaveLength(1);
  });

  it("asks nothing about Lovejoin's own launch, whose scripts went to a key address, nor an unlisted token's", async () => {
    const own = koiosOf([FOUND.reference], [launch()]);
    await discovery(own).found.scan("preprod");
    const unlisted = koiosOf([FOUND.reference, ...SCRIPTS], [launch()]);
    const d = discovery(unlisted, { listed: new Set() });
    await d.found.scan("preprod");
    for (const k of [own, unlisted]) expect(asked(k, "tx_info")).toEqual([]);
    expect(await d.found.known("preprod")).toEqual([]);
    // Looked past, all the same: the next look starts from there.
    expect((await d.local.get<{ height: number }>("seedelf.lovejoinPools.preprod"))!.height).toBe(BLOCK);
  });

  it("takes a launch that didn't register L only if an earlier block did", async () => {
    const at = FOUND.reference.block_time!;
    for (const [registered, standard] of [
      [at - 600, true],
      [at, false],
      [at + 600, false],
      [undefined, false],
    ] as const) {
      const k = koiosOf([FOUND.reference, ...SCRIPTS], [launch([])], registered === undefined ? [] : [{ stake_address: L_STAKE, block_time: registered }]);
      const { found } = discovery(k);
      await found.scan("preprod");
      expect((await found.known("preprod")).length, `registered at ${registered}`).toBe(standard ? 1 : 0);
      expect(asked(k, "account_update_history")[0]!.body._stake_addresses).toEqual([L_STAKE]);
    }
  });

  it("looks again for a launch Koios doesn't know yet, and keeps nothing of a look that failed", async () => {
    const launches: KoiosLaunch[] = [];
    const k = koiosOf([FOUND.reference, ...SCRIPTS], launches);
    const { found, local } = discovery(k);
    await found.scan("preprod");
    expect(await found.known("preprod")).toEqual([]);
    expect((await local.get<{ height: number }>("seedelf.lovejoinPools.preprod"))!.height).toBe(BLOCK - 1);
    k.fail = new Response("down", { status: 500 });
    await expect(found.scan("preprod")).rejects.toThrow();
    expect((await local.get<{ height: number }>("seedelf.lovejoinPools.preprod"))!.height).toBe(BLOCK - 1);
    k.fail = undefined;
    launches.push(launch());
    await found.scan("preprod");
    expect((await found.known("preprod")).map((p) => p.id)).toEqual([ID]);
  });

  it("takes a launch only once it has settled, from a look that starts short of its block", async () => {
    const k = koiosOf([FOUND.reference, ...SCRIPTS], [launch()]);
    const { found, local, clock } = discovery(k);
    clock.now = FOUND.reference.block_time! * 1000 + 60_000;
    await found.scan("preprod");
    expect(await found.known("preprod")).toEqual([]);
    expect(asked(k, "tx_info")).toEqual([]);
    expect((await local.get<{ height: number }>("seedelf.lovejoinPools.preprod"))!.height).toBe(BLOCK - 1);
    clock.now += SETTLE_MS;
    await found.scan("preprod");
    expect((await found.known("preprod")).map((p) => p.id)).toEqual([ID]);
  });

  it("starts from the bundled head start's height and pools", async () => {
    const k = koiosOf([FOUND.reference, ...SCRIPTS], [launch()]);
    const local = memoryArea();
    const found = new PoolDiscovery({
      local,
      wasm,
      koios: () => k.koios,
      wallet: { trapped: async () => undefined },
      now: () => 1_800_000_000_000,
      listed: () => new Set([LJTEST]),
      headStart: () => ({ height: BLOCK + 100, pools: [] }),
    });
    await found.scan("preprod");
    expect(asked(k, "credential_utxos")[0]!.query).toContain(`block_height=gt.${BLOCK + 80}`);
    expect(await found.known("preprod")).toEqual([]);
  });

  it("knows the earliest of each value, a copy launched later never", async () => {
    const k = koiosOf([], []);
    const { found, local } = discovery(k);
    const pool = (id: string, block: number): FoundPool => ({
      id,
      boxLovelace: "4500000",
      token: { policyId: LJTEST.slice(0, 56), assetName: LJTEST.slice(56), quantity: "100" },
      ref: { reference: { ...FOUND.reference, tx_hash: id.slice(0, 2).repeat(32) }, seed: FOUND.seed },
      launch: { block, index: 0, tx: id.slice(0, 2).repeat(32) },
    });
    await local.set("seedelf.lovejoinPools.preprod", { height: 10, pools: [pool("bb".repeat(28), 20), pool("aa".repeat(28), 10)] });
    expect((await found.known("preprod")).map((p) => p.id)).toEqual(["aa".repeat(28)]);
  });
});

/** The data layer's private index, pointed at preprod's fixtures (its client is the same on any network). */
function onIndex() {
  const index = fakeIndex();
  const session = memoryArea();
  const parts = new DataParts(session, () => 1_800_000_000_000);
  return { index, parts, client: privateIndexClient({ koiosOnly: async () => false, parts, fetch: index.fetch, limits: {} }, () => "https://data.test") };
}

/** Lovejoin's preprod pool as the data layer's `lovejoin/pools` lists it, its scripts at the holder. */
function listed(seed = `${FOUND.seed.txHash}#${FOUND.seed.txIndex}`) {
  const slot = 100_000_000;
  return {
    network: "mainnet",
    cursor: `${slot}.${"0".repeat(64)}`,
    classic: { crowd: { boxes: 80, deposits: 12, mixed: 70 } },
    pools: [
      {
        id: ID,
        seed,
        reference: indexRowOf(FOUND.reference, slot),
        scripts: SCRIPTS.map((s, i) => ({ ...indexRowOf(s, slot), script: true, script_hash: [MIX_BOX, MIX_LOGIC][i] })),
        launch: { tx: LAUNCH, block: BLOCK, index: 3, slot, time: slot + 1_591_566_291 },
        crowd: { boxes: 30, deposits: 1, mixed: 0 },
      },
    ],
  };
}

describe("the data layer's list", () => {
  it("is verified here, kept, and asked for at most every REFRESH_MS, the same for every wallet", async () => {
    const on = onIndex();
    on.index.poolList = listed();
    const k = koiosOf([], [launch()]);
    const { found, clock } = discovery(k, { index: on });
    await found.refresh("preprod");
    await found.refresh("preprod");
    // Kept once Koios's check of it ends, which a look waits for and no pool read does (1.7.0's release review).
    await found.look("preprod");
    const [pool] = await found.known("preprod");
    expect(pool).toMatchObject({ id: ID, launch: { block: BLOCK, index: 3, tx: LAUNCH } });
    const view = JSON.parse(wasm.lovejoinVerifyPool(JSON.stringify({ network: "preprod", pool: pool!.ref }))) as { scriptsInline: number };
    expect(view.scriptsInline).toBe(0);
    expect(found.crowdsOf("preprod")?.get(ID)).toEqual({ boxes: 30, deposits: 1, mixed: 0 });
    expect(found.crowdsOf("preprod")?.get("classic")).toEqual({ boxes: 80, deposits: 12, mixed: 70 });
    expect(on.index.calls).toEqual(["lovejoin/pools"]);
    clock.now += REFRESH_MS;
    await found.look("preprod");
    expect(on.index.calls).toEqual(["lovejoin/pools", "lovejoin/pools"]);
    // Koios was asked about the new pool once, its rows and its launch (1.7.0), and nothing of the holder; a pool kept
    // isn't asked about again.
    expect(k.calls.map((c) => c.path)).toEqual(["utxo_info", "tx_info"]);
  });

  it("leaves out a pool that doesn't verify: the server can leave a pool out, never pass off other scripts as a pool's", async () => {
    const on = onIndex();
    on.index.poolList = listed(`${FOUND.seed.txHash}#0`);
    const { found } = discovery(koiosOf([], []), { index: on });
    await found.refresh("preprod");
    expect(await found.known("preprod")).toEqual([]);
  });

  it("leaves out a pool whose launch, or a script of it, isn't its reference UTxO's own transaction (1.6.0's release review, 317-wallet#0)", async () => {
    // A launch puts its reference UTxO and both scripts at the holder in one transaction, the one listed as its
    // launch: a list that says otherwise contradicts itself, and nothing is asked of Koios about it. That a pool is on
    // chain as listed, Koios says before it's kept (below).
    const other = "ab".repeat(32);
    const launchedElsewhere = listed();
    launchedElsewhere.pools[0]!.launch.tx = other;
    const scriptElsewhere = listed();
    scriptElsewhere.pools[0]!.scripts[1]!.ref = `${other}#2`;
    for (const list of [launchedElsewhere, scriptElsewhere]) {
      const on = onIndex();
      on.index.poolList = list;
      // Koios knows the launch, so only the check here leaves the pool out (1.7.0's review of the fixes, tests#2).
      const k = koiosOf([], [launch()]);
      const { found } = discovery(k, { index: on });
      await found.look("preprod");
      expect(await found.known("preprod")).toEqual([]);
      expect(k.calls.map((c) => c.path)).toEqual([]);
    }
    // As a launch lists it, it's kept.
    const on = onIndex();
    on.index.poolList = listed();
    const { found } = discovery(koiosOf([], [launch()]), { index: on });
    await found.look("preprod");
    expect((await found.known("preprod")).map((p) => p.id)).toEqual([ID]);
  });

  it("keeps nothing while the token routes refuse or can't be read, and the private index stays up", async () => {
    // db-sync behind; a server older than the routes, deployed back (404); an answer that isn't one.
    for (const fail of [
      Response.json({ error: "behind" }, { status: 503 }),
      Response.json({ error: "not found" }, { status: 404 }),
      new Response("<html>", { status: 200 }),
      Response.json({ cursor: "no" }),
    ]) {
      const on = onIndex();
      on.index.tokensFail = fail;
      const { found } = discovery(koiosOf([], []), { index: on });
      await found.refresh("preprod");
      expect(await found.known("preprod")).toEqual([]);
      expect(await on.parts.up("private"), String(fail.status)).toBe(true);
    }
  });

  it("holds the part back on the shared limit's 429, as any route's does", async () => {
    const on = onIndex();
    on.index.tokensFail = new Response("{}", { status: 429, headers: { "retry-after": "30" } });
    const { found } = discovery(koiosOf([], []), { index: on });
    await found.refresh("preprod");
    expect(await on.parts.up("private")).toBe(false);
  });

  it("is where a look reads, and Koios's holder only where the data layer doesn't answer", async () => {
    const on = onIndex();
    on.index.poolList = listed();
    const k = koiosOf([FOUND.reference, ...SCRIPTS], [launch()]);
    const { found } = discovery(k, { index: on });
    await found.look("preprod");
    // The new pool's rows and launch confirmed (1.7.0), the holder not read.
    expect(k.calls.map((c) => c.path)).toEqual(["utxo_info", "tx_info"]);
    expect((await found.known("preprod")).map((p) => p.id)).toEqual([ID]);
    const alone = koiosOf([FOUND.reference, ...SCRIPTS], [launch()]);
    const koiosOnly = discovery(alone);
    await koiosOnly.found.look("preprod");
    expect(asked(alone, "credential_utxos")).toHaveLength(1);
    expect((await koiosOnly.found.known("preprod")).map((p) => p.id)).toEqual([ID]);
  });
});

describe("a pool the data layer lists, confirmed from Koios before it's kept (1.6.0's release review, pool-exists, docs-small#1; 1.7.0)", () => {
  it("leaves out a pool whose launch Koios doesn't know, and keeps it once Koios does", async () => {
    // Offline it verifies as well as any: a seed no launch spent, a launch a deep rollback took back, or a server that
    // lied. Kept, it would stay in the read set for good.
    const on = onIndex();
    on.index.poolList = listed();
    const launches: KoiosLaunch[] = [];
    const k = koiosOf([], launches);
    const { found, clock } = discovery(k, { index: on });
    await found.look("preprod");
    expect(await found.known("preprod")).toEqual([]);
    expect(asked(k, "tx_info")).toHaveLength(1);
    // At the next list it's on chain: kept.
    launches.push(launch());
    clock.now += REFRESH_MS;
    await found.look("preprod");
    expect((await found.known("preprod")).map((p) => p.id)).toEqual([ID]);
  });

  it("leaves out a pool whose L its launch didn't register, nor an earlier block: it never paid to be finished", async () => {
    const on = onIndex();
    on.index.poolList = listed();
    // Registered after its launch: no more standard than never.
    const k = koiosOf([], [launch([])], [{ stake_address: L_STAKE, block_time: FOUND.reference.block_time! + 60 }]);
    const { found } = discovery(k, { index: on });
    await found.look("preprod");
    expect(await found.known("preprod")).toEqual([]);
    expect(asked(k, "account_update_history")).toHaveLength(1);
    // Registered by an earlier block, as the holder's look takes it: kept.
    const earlier = koiosOf([], [launch([])], [{ stake_address: L_STAKE, block_time: FOUND.reference.block_time! - 60 }]);
    const again = onIndex();
    again.index.poolList = listed();
    const ok = discovery(earlier, { index: again });
    await ok.found.look("preprod");
    expect((await ok.found.known("preprod")).map((p) => p.id)).toEqual([ID]);
  });

  it("keeps nothing new while Koios can't answer, and every pool it kept before", async () => {
    const on = onIndex();
    on.index.poolList = listed();
    const k = koiosOf([], [launch()]);
    k.fail = Response.json({ error: "down" }, { status: 503 });
    const { found, clock } = discovery(k, { index: on, head: () => ({ height: 0, pools: [] }) });
    await found.look("preprod");
    expect(await found.known("preprod")).toEqual([]);
    // Koios back: the next list's pool is confirmed and kept; one Koios down after it takes nothing away.
    k.fail = undefined;
    clock.now += REFRESH_MS;
    await found.look("preprod");
    expect((await found.known("preprod")).map((p) => p.id)).toEqual([ID]);
    k.fail = Response.json({ error: "down" }, { status: 503 });
    clock.now += REFRESH_MS;
    await found.look("preprod");
    expect((await found.known("preprod")).map((p) => p.id)).toEqual([ID]);
  });

  it("keeps a new pool as Koios's chain data has it, never as the list says: its datum, its scripts and its launch's place (1.7.0's release review, pr336#0)", async () => {
    // A server that lied: 3 ₳ a box where the chain's datum says 2 ₳, and its launch first in block 1. Offline it
    // verifies all the same, as a pool's scripts come from its seed alone.
    const forged = listed();
    const pool = forged.pools[0]!;
    pool.reference = { ...pool.reference, datum: pool.reference.datum!.replace("1a001e8480", "1a002dc6c0") };
    pool.launch = { ...pool.launch, block: 1, index: 0 };
    const on = onIndex();
    on.index.poolList = forged;
    const k = koiosOf([], [launch()]);
    const { found } = discovery(k, { index: on });
    await found.look("preprod");
    const [kept, ...more] = await found.known("preprod");
    expect(more).toEqual([]);
    expect(kept).toMatchObject({ id: ID, boxLovelace: "2000000", launch: { block: BLOCK, index: 3, tx: LAUNCH } });
    expect(kept!.ref.reference.inline_datum?.bytes).toBe(FOUND.reference.inline_datum!.bytes);
    // Its reference UTxO and both scripts, in one request beside its launch's.
    expect(asked(k, "utxo_info").map((c) => c.body._utxo_refs)).toEqual([[`${LAUNCH}#0`, `${LAUNCH}#1`, `${LAUNCH}#2`]]);
    // A script the list places at another output of its launch, where the chain has none: not kept.
    const moved = listed();
    moved.pools[0]!.scripts[1]!.ref = `${LAUNCH}#4`;
    const again = onIndex();
    again.index.poolList = moved;
    const elsewhere = discovery(koiosOf([], [launch()]), { index: again });
    await elsewhere.found.look("preprod");
    expect(await elsewhere.found.known("preprod")).toEqual([]);
  });

  it("holds no pool read while Koios checks a pool new to the device: the pools kept before are read till it's kept (1.7.0's release review, pr336#1, x-priv#2)", async () => {
    // A pool the device holds already, of other values: its head start's.
    const held: FoundPool = {
      id: "bb".repeat(28),
      boxLovelace: "4500000",
      token: { policyId: LJTEST.slice(0, 56), assetName: LJTEST.slice(56), quantity: "100" },
      ref: { reference: { ...FOUND.reference, tx_hash: "bb".repeat(32) }, seed: FOUND.seed },
      launch: { block: 20, index: 0, tx: "bb".repeat(32) },
    };
    const on = onIndex();
    on.index.poolList = listed();
    // Koios hung: each read timing out after 45 s and tried again, or a 429's hold, for as long as it lasts.
    const k = koiosOf([], [launch()]);
    let answer!: () => void;
    k.hold = new Promise<void>((done) => (answer = done));
    const { found } = discovery(k, { index: on, head: () => ({ height: 0, pools: [held] }) });
    const read = serviceDeps(found).pools("preprod");
    expect(await Promise.race([read, new Promise((done) => setTimeout(() => done("held up"), 1_000))])).toEqual([held.ref]);
    await vi.waitFor(() => expect(asked(k, "tx_info")).toHaveLength(1));
    // Koios answers: the pool is kept, and read from the next pool read on.
    answer();
    await found.look("preprod");
    const refs = await serviceDeps(found).pools("preprod");
    expect(refs.map((r) => ("copy" in r ? r.copy : r).reference.tx_hash)).toEqual(["bb".repeat(32), LAUNCH]);
  });

  it("asks for the list and Koios once on a device with no record yet, however many pool reads come while Koios checks (1.7.0's release review, pr336#2)", async () => {
    const on = onIndex();
    on.index.poolList = listed();
    const k = koiosOf([], [launch()]);
    let answer!: () => void;
    k.hold = new Promise<void>((done) => (answer = done));
    // A new install, or a wallet restored after Remove wallet deleted the record.
    const { found, clock } = discovery(k, { index: on });
    const reads = serviceDeps(found);
    void reads.pools("preprod");
    await vi.waitFor(() => expect(asked(k, "tx_info")).toHaveLength(1));
    // A Refresh, the Lovejoin page opened again, a swap's review: pool reads while Koios hasn't answered.
    void reads.pools("preprod");
    void reads.pools("preprod");
    await new Promise((done) => setTimeout(done, 50));
    expect(on.index.calls).toEqual(["lovejoin/pools"]);
    expect(asked(k, "tx_info")).toHaveLength(1);
    // The next list, five minutes on, with Koios still not answering: no second check of the same pool beside it.
    clock.now += REFRESH_MS;
    await reads.pools("preprod");
    await new Promise((done) => setTimeout(done, 50));
    expect(on.index.calls).toEqual(["lovejoin/pools", "lovejoin/pools"]);
    expect([asked(k, "utxo_info").length, asked(k, "tx_info").length]).toEqual([1, 1]);
    answer();
    await found.look("preprod");
    expect((await found.known("preprod")).map((p) => p.id)).toEqual([ID]);
  });

  it("locks the wallet when WebAssembly traps under the check, never taking the trap for Koios down (1.7.0's release review, pr336#4, x-mut-ts#0)", async () => {
    const on = onIndex();
    on.index.poolList = listed();
    const k = koiosOf([], [launch()]);
    const trapping: DiscoveryDeps["wasm"] = {
      lovejoinCandidate: (request) => wasm.lovejoinCandidate(request),
      lovejoinVerifyPool: (request) => wasm.lovejoinVerifyPool(request),
      lovejoinLaunchCheck: () => {
        throw new WebAssembly.RuntimeError("unreachable");
      },
    };
    const { found, traps } = discovery(k, { index: on, wasm: trapping });
    // No pool read waits for the check, so none hears its trap: the wallet locks itself, as under a request (sw.ts).
    expect(await serviceDeps(found).pools("preprod")).toEqual([]);
    await found.look("preprod");
    expect(asked(k, "tx_info")).toHaveLength(1);
    expect(traps()).toBe(1);
    expect(await found.known("preprod")).toEqual([]);
  });

  it("holds the data layer's last list for a launch's copy check, pools Koios hasn't confirmed among it, and hands over none of those (1.7.0's release review, x-merge#0)", async () => {
    const on = onIndex();
    on.index.poolList = listed();
    // Koios down, refusing this IP, or behind: the pool isn't kept.
    const k = koiosOf([], [launch()]);
    k.fail = Response.json({ error: "down" }, { status: 503 });
    const { found, clock } = discovery(k, { index: on });
    await found.look("preprod");
    expect(await found.known("preprod")).toEqual([]);
    expect(found.lastListed("preprod").map((p) => p.id)).toEqual([ID]);
    // The data layer down since (or Settings' Koios-only on): the last list holds till the next one replaces it.
    on.index.tokensFail = Response.json({ error: "behind" }, { status: 503 });
    clock.now += REFRESH_MS;
    await found.refresh("preprod");
    expect(found.lastListed("preprod").map((p) => p.id)).toEqual([ID]);
    expect(found.lastListed("mainnet")).toEqual([]);
  });
});

describe("what a device keeps of what it found (1.6.0's release review)", () => {
  const KEY = "seedelf.lovejoinPools.preprod";
  /** A pool of LJTEST's values, launched at `block`, named by `tx`. */
  const poolAt = (tx: string, block: number, of?: FoundPool): FoundPool => ({
    id: tx.repeat(28),
    boxLovelace: of?.boxLovelace ?? "4500000",
    token: of?.token ?? { policyId: LJTEST.slice(0, 56), assetName: LJTEST.slice(56), quantity: "100" },
    ref: { reference: { ...FOUND.reference, tx_hash: tx.repeat(32) }, seed: FOUND.seed },
    launch: { block, index: 0, tx: tx.repeat(32) },
  });
  /** An output at the holder that's no candidate, in a later block: a look's height moves past the pool's. */
  const LATER: KoiosUtxo = { ...SCRIPTS[0]!, tx_hash: "cc".repeat(32), tx_index: 0, block_height: BLOCK + 100 };

  it("never takes a pool it handed over out of the read set when an earlier launch of its values turns up (STATE-2)", async () => {
    const on = onIndex();
    on.index.poolList = listed();
    const { found, local } = discovery(koiosOf([], [launch()]), { index: on });
    await found.look("preprod");
    const [read] = await found.known("preprod");
    expect(read!.id).toBe(ID);
    // A later look keeps an earlier launch of the same values: one the data layer had left out, or whose launch
    // Koios didn't know yet. The wallet may hold boxes in the pool it read: that one stays, beside the rule's.
    const was = (await local.get<Kept>(KEY))!;
    await local.set(KEY, { ...was, pools: [...was.pools, poolAt("aa", BLOCK - 10, read)] });
    expect((await found.known("preprod")).map((p) => p.id)).toEqual(["aa".repeat(28), ID]);
  });

  it("keeps a pool a head start showed when a later release's head start names an earlier launch of its values instead", async () => {
    let head: Kept = { height: 0, pools: [poolAt("bb", 20)] };
    const { found } = discovery(koiosOf([], []), { head: () => head });
    expect((await found.known("preprod")).map((p) => p.id)).toEqual(["bb".repeat(28)]);
    head = { height: 0, pools: [poolAt("aa", 10)] };
    expect((await found.known("preprod")).map((p) => p.id)).toEqual(["aa".repeat(28), "bb".repeat(28)]);
  });

  it("looks at the holder again from the head start once the token list lists more (STATE-4)", async () => {
    const k = koiosOf([FOUND.reference, ...SCRIPTS, LATER], [launch()]);
    const list = new Set<string>();
    const { found, local } = discovery(k, { listed: list });
    await found.scan("preprod");
    expect(await found.known("preprod")).toEqual([]);
    expect((await local.get<Kept>(KEY))!.height).toBe(BLOCK + 100);
    // A release lists the token: its pool, refused before and looked past, is found from the head start's height.
    list.add(LJTEST);
    await found.scan("preprod");
    expect(asked(k, "credential_utxos")[1]!.query).toContain("block_height=gt.0");
    expect((await found.known("preprod")).map((p) => p.id)).toEqual([ID]);
    // Then each look reads on from where the last stopped, as before.
    await found.scan("preprod");
    expect(asked(k, "credential_utxos")[2]!.query).toContain(`block_height=gt.${BLOCK + 80}`);
    expect(asked(k, "tx_info")).toHaveLength(1);
  });

  it("asks the data layer again once Remove wallet has deleted what it kept, not five minutes later", async () => {
    const on = onIndex();
    on.index.poolList = listed();
    // A head start's pool beside the data layer's: a quiet read hands it over, and keeps that.
    const { found, local } = discovery(koiosOf([], [launch()]), { index: on, head: () => ({ height: 0, pools: [poolAt("bb", 20)] }) });
    await found.look("preprod");
    // wallet.ts' reset deletes LOCAL_CACHES; the wallet is restored at once, and a quiet read (a swap's quote) may
    // come first.
    await local.remove(KEY);
    expect((await found.known("preprod")).map((p) => p.id)).toEqual(["bb".repeat(28)]);
    expect(await local.get(KEY)).toBeDefined();
    await found.refresh("preprod");
    expect(on.index.calls).toEqual(["lovejoin/pools", "lovejoin/pools"]);
    // Kept again once Koios confirms it, which a look waits for.
    await found.look("preprod");
    expect(on.index.calls).toEqual(["lovejoin/pools", "lovejoin/pools"]);
    expect((await found.known("preprod")).map((p) => p.id)).toEqual(["bb".repeat(28), ID]);
    // While the routes refuse, the five minutes hold as before: one request, however many reads.
    const down = onIndex();
    down.index.tokensFail = Response.json({ error: "behind" }, { status: 503 });
    const d = discovery(koiosOf([], []), { index: down });
    await d.found.refresh("preprod");
    await d.found.refresh("preprod");
    expect(down.index.calls).toEqual(["lovejoin/pools"]);
  });

  it("keeps what a refresh and a look found at the same time, neither writing over the other", async () => {
    const on = onIndex();
    on.index.poolList = listed();
    const area = memoryArea();
    // A write that takes a while, as chrome.storage's can: the other's read lands in between.
    const slow: MemoryArea = {
      ...area,
      set: async (key, value) => {
        await new Promise((r) => setTimeout(r, 20));
        await area.set(key, value);
      },
    };
    const { found } = discovery(koiosOf([LATER], [launch()]), { index: on, local: slow });
    await Promise.all([found.refresh("preprod"), found.scan("preprod")]);
    // And Koios's check of the listed pool, which keeps it as it ends.
    await found.look("preprod");
    expect((await found.known("preprod")).map((p) => p.id)).toEqual([ID]);
    expect((await slow.get<Kept>(KEY))!.height).toBe(BLOCK + 100);
  });
});
