// Finding Lovejoin's token pools (chunk 34's 34c): the shown-pool rule's last
// step against the scenarios the data layer is held to too; a look at Koios's
// holder, from Lovejoin's own preprod pool as its launch would have been had
// it put its scripts at the holder; and the data layer's list, each pool
// verified here again. With the real WebAssembly.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DataParts } from "../src/background/data-layer";
import { Koios, type KoiosLaunch, type KoiosUtxo } from "../src/background/koios";
import { HOLDER, PoolDiscovery, REFRESH_MS, SETTLE_MS, shown, type FoundPool, type Kept } from "../src/background/lovejoin-pools";
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

/** Koios, answering the holder's outputs, tx_info and account_update_history from what a test gives it. */
function koiosOf(holder: KoiosUtxo[], launches: KoiosLaunch[], registrations: Array<{ stake_address: string; block_time: number }> = []) {
  const calls: Array<{ path: string; query: string; body: any }> = [];
  const fake = {
    calls,
    fail: undefined as Response | undefined,
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
      if (path === "tx_info") return Response.json(launches.filter((l) => body._tx_hashes.includes(l.tx_hash)));
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
  }: { listed?: ReadonlySet<string>; index?: ReturnType<typeof onIndex>; head?: () => Kept; local?: MemoryArea } = {},
) {
  const clock = { now: 1_800_000_000_000 };
  const found = new PoolDiscovery({
    local,
    wasm,
    koios: () => k.koios,
    ...(index ? { index: index.client } : {}),
    now: () => clock.now,
    listed: () => listed,
    // From the holder's start: the bundled head start moves at each release.
    headStart: head,
  });
  return { found, local, clock };
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
    const found = new PoolDiscovery({ local, wasm, koios: () => k.koios, now: () => 1_800_000_000_000, listed: () => new Set([LJTEST]), headStart: () => ({ height: BLOCK + 100, pools: [] }) });
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
    const k = koiosOf([], []);
    const { found, clock } = discovery(k, { index: on });
    await found.refresh("preprod");
    await found.refresh("preprod");
    const [pool] = await found.known("preprod");
    expect(pool).toMatchObject({ id: ID, launch: { block: BLOCK, index: 3, tx: LAUNCH } });
    const view = JSON.parse(wasm.lovejoinVerifyPool(JSON.stringify({ network: "preprod", pool: pool!.ref }))) as { scriptsInline: number };
    expect(view.scriptsInline).toBe(0);
    expect(found.crowdsOf("preprod")?.get(ID)).toEqual({ boxes: 30, deposits: 1, mixed: 0 });
    expect(found.crowdsOf("preprod")?.get("classic")).toEqual({ boxes: 80, deposits: 12, mixed: 70 });
    expect(on.index.calls).toEqual(["lovejoin/pools"]);
    clock.now += REFRESH_MS;
    await found.refresh("preprod");
    expect(on.index.calls).toEqual(["lovejoin/pools", "lovejoin/pools"]);
    // Koios wasn't asked anything.
    expect(k.calls).toEqual([]);
  });

  it("leaves out a pool that doesn't verify: the server can leave a pool out, never make one look real", async () => {
    const on = onIndex();
    on.index.poolList = listed(`${FOUND.seed.txHash}#0`);
    const { found } = discovery(koiosOf([], []), { index: on });
    await found.refresh("preprod");
    expect(await found.known("preprod")).toEqual([]);
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
    expect(k.calls).toEqual([]);
    expect((await found.known("preprod")).map((p) => p.id)).toEqual([ID]);
    const alone = koiosOf([FOUND.reference, ...SCRIPTS], [launch()]);
    const koiosOnly = discovery(alone);
    await koiosOnly.found.look("preprod");
    expect(asked(alone, "credential_utxos")).toHaveLength(1);
    expect((await koiosOnly.found.known("preprod")).map((p) => p.id)).toEqual([ID]);
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
    const { found, local } = discovery(koiosOf([], []), { index: on });
    await found.refresh("preprod");
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
    const { found, local } = discovery(koiosOf([], []), { index: on, head: () => ({ height: 0, pools: [poolAt("bb", 20)] }) });
    await found.refresh("preprod");
    // wallet.ts' reset deletes LOCAL_CACHES; the wallet is restored at once, and a quiet read (a swap's quote) may
    // come first.
    await local.remove(KEY);
    expect((await found.known("preprod")).map((p) => p.id)).toEqual(["bb".repeat(28)]);
    expect(await local.get(KEY)).toBeDefined();
    await found.refresh("preprod");
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
    const { found } = discovery(koiosOf([LATER], []), { index: on, local: slow });
    await Promise.all([found.refresh("preprod"), found.scan("preprod")]);
    expect((await found.known("preprod")).map((p) => p.id)).toEqual([ID]);
    expect((await slow.get<Kept>(KEY))!.height).toBe(BLOCK + 100);
  });
});
