// Lovejoin's token pools in the worker's records (chunk 34, 34a′): every pool
// the wallet reads, its own due times, its boxes coming back through it, the
// list of mixes followed until each box is back, and Bootstrap's boxes held.
// With the real WebAssembly, the classic pool's recorded preprod boxes, and
// PR #163's preprod token pool (2 ₳ and LJTEST a box), as Koios lists it.
// The classic pool's own records are 1.5.0's gate's (lovejoin-1-5-0.test.ts).
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { DataParts } from "../src/background/data-layer";
import { privateIndexClient, type IndexRow } from "../src/background/private-index";
import { fakeIndex, indexRowOf, type FakeIndex } from "./fake-index";
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService, type PoolRef } from "../src/background/lovejoin";
import { SESSION_UNLOCKED_AT } from "../src/background/wallet";
import { NETWORKS } from "../src/networks";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, testBalances, vectors } from "./fakes";
import { t as t_ } from "../src/i18n";

const PASSWORD = "correct horse battery";
const HOUR = 3_600_000;
const PHRASE = (vectors("cardano_account.json") as Array<{ account: number; phrase: string }>).find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
)!.phrase;

/** Real withdraws are built and measured in WebAssembly: seconds each, more on CI. */
const SLOW = { timeout: 60_000 };

/** 20 boxes from Lovejoin's preprod pool, as Koios lists them (2026-09-25). */
const POOL = (JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }).pool;
const CLASSIC_BOX = NETWORKS.preprod.lovejoin!.mixBox;

/** PR #163's token pool on preprod, as Koios lists it (wasm/tests/fixtures). */
const FOUND = JSON.parse(readFileSync(new URL("../../wasm/tests/fixtures/lovejoin-token-pool-preprod.json", import.meta.url), "utf8")) as {
  seed: { txHash: string; txIndex: number };
  reference: KoiosUtxo;
  scripts: KoiosUtxo[];
};
const TOKEN_POOL: PoolRef = { reference: FOUND.reference, seed: FOUND.seed, scripts: FOUND.scripts };
const VIEW = JSON.parse(loadTestWasm().lovejoinVerifyPool(JSON.stringify({ network: "preprod", pool: TOKEN_POOL }))) as {
  id: string;
  mixBoxHash: string;
  token: { policyId: string; assetName: string; quantity: string };
};
const TOKEN = VIEW.id;
/** Its mix_box's address: a script's, with no stake part. */
const TOKEN_ADDRESS = bech32("addr_test", Uint8Array.from([0x70, ...Buffer.from(VIEW.mixBoxHash, "hex")]));

/** Ogmios's answer when the network measures no more than a transaction declares. */
const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };

type T = ReturnType<typeof testBalances>;

/**
 * Lovejoin reading the classic pool and `pools` (the token pool), with
 * giveme.my's witness stood in for; on the data layer's private index too,
 * when one's given (pointed at preprod's fixtures: its client is the same on
 * any network).
 */
function pooled(
  t: T,
  pools: () => PoolRef[] = () => [TOKEN_POOL],
  index?: { fetch: FakeIndex["fetch"]; parts: DataParts },
  extra: Partial<ConstructorParameters<typeof LovejoinService>[0]> = {},
) {
  const wasm = loadTestWasm();
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  return new LovejoinService({
    ...t.deps,
    ...(index
      ? { index: privateIndexClient({ koiosOnly: async () => false, parts: index.parts, fetch: index.fetch, limits: {} }, () => "https://data.test") }
      : {}),
    wasm: {
      ...wasm,
      finishLovejoinWithdraw: (request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    pools: async () => pools(),
    random: () => 0.5,
    ...extra,
  });
}

/** A wallet, unlocked an hour ago with the first run after it done (independent review L10). */
async function wallet(): Promise<T> {
  const t = testBalances();
  await t.wallet.create(PHRASE, PASSWORD);
  t.koios.evaluation = AGREES;
  return t;
}

async function unlockedAnHourAgo(t: T): Promise<void> {
  const at = t.clock.now - HOUR;
  await t.wallet.withKeys(() => t.session.set(SESSION_UNLOCKED_AT, at));
  const kept = await t.store.get<object>("lovejoin.preprod");
  if (kept) await t.store.set("lovejoin.preprod", { ...kept, unlock: at });
}

/** A register datum: the wallet's, or a stranger's. */
async function datum(t: T, ours: boolean): Promise<string> {
  const wasm = loadTestWasm();
  if (ours) return t.wallet.withKeys((keys) => Buffer.from(wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister()))).toString("hex"));
  const stranger = wasm.SeedelfKey.fromHex("01".repeat(32));
  const bytes = Buffer.from(wasm.registerToDatum(wasm.rerandomize(stranger.baseRegister()))).toString("hex");
  stranger.free();
  return bytes;
}

/**
 * A box in the token pool, as Koios lists it: 2 ₳ and its LJTEST, the
 * wallet's or a stranger's, a mix having moved it `hours` ago (Koios says a
 * mix in that pool made it).
 */
async function tokenBox(t: T, tx: string, ours = true, hours = 5): Promise<KoiosUtxo> {
  t.koios.txSpends.set(tx.repeat(32), [{ payment_addr: { bech32: TOKEN_ADDRESS, cred: VIEW.mixBoxHash } }]);
  return {
    ...POOL[0]!,
    tx_hash: tx.repeat(32),
    tx_index: 0,
    address: TOKEN_ADDRESS,
    payment_cred: VIEW.mixBoxHash,
    value: "2000000",
    block_time: Math.floor(t.clock.now / 1000) - hours * 3600,
    datum_hash: null,
    inline_datum: { bytes: await datum(t, ours), value: {} },
    asset_list: [{ policy_id: VIEW.token.policyId, asset_name: VIEW.token.assetName, quantity: VIEW.token.quantity, decimals: 0, fingerprint: "asset1ljtest" } as never],
  } as KoiosUtxo;
}

/** A box of the wallet's in the classic pool, a mix having moved it `hours` ago. */
async function classicBox(t: T, tx: string, hours = 5): Promise<KoiosUtxo> {
  t.koios.txSpends.set(tx.repeat(32), [{ payment_addr: { bech32: POOL[0]!.address, cred: CLASSIC_BOX } }]);
  return {
    ...POOL[0]!,
    tx_hash: tx.repeat(32),
    tx_index: 0,
    block_time: Math.floor(t.clock.now / 1000) - hours * 3600,
    inline_datum: { bytes: await datum(t, true), value: {} },
  } as KoiosUtxo;
}

/** Ten strangers' boxes in the token pool. */
async function strangers(t: T): Promise<KoiosUtxo[]> {
  return Promise.all(Array.from({ length: 10 }, (_, i) => tokenBox(t, (0x60 + i).toString(16), false)));
}

/** What the withdraws giveme.my was asked about spend. */
const withdrawn = (t: T) => t.collateral.asked.flatMap((tx) => txInputs(Uint8Array.from(Buffer.from(tx, "hex"))));

type Sealed = {
  due: number[];
  pools?: Record<string, { due: number[]; notMixed?: number; unsure?: number }>;
  withdrawing?: { pool?: string; token?: { quantity: string } };
  mixes?: Array<{ id: string; bootstrap?: true; released?: true; shares: Array<{ pool?: string; boxes: number; back?: number; moved?: number }> }>;
  chains: Array<{ id: string; pools?: Record<string, number> }>;
  origins?: Record<string, { mixed: boolean; mixedIn?: string[] }>;
};
const sealed = async (t: T) => (await t.store.get<Sealed>("lovejoin.preprod"))!;

/** A chain recorded and sent whole, synthetic: a deposit and `mixes` mixes, its leaves in each pool. */
async function sentChain(
  lj: LovejoinService,
  id: string,
  { pools, leaves, again = false, bootstrap = false }: { pools?: Record<string, number>; leaves: Array<{ txHash: string; txIndex: number; pool?: string }>; again?: boolean; bootstrap?: boolean },
) {
  const txs = [
    ...(again ? [] : [{ kind: "deposit" as const, txCbor: "", txHash: `${id}0`.padEnd(64, "0"), fee: "0" }]),
    ...(bootstrap ? [] : [{ kind: "mix" as const, txCbor: "", txHash: id.repeat(32), fee: "0" }]),
  ];
  const boxes = leaves.length;
  await lj.recordChain("preprod", { progress: `test.${id}`, txs, leaves, boxes, ...(pools ? { pools } : {}), again, bootstrap, account: 0 });
  for (const i of txs.keys()) await lj.chainSent("preprod", txs.at(-1)!.txHash, i);
  await lj.chainEnded("preprod", txs.at(-1)!.txHash);
  return txs;
}

describe("the pools the wallet reads (chunk 34, 34a′)", SLOW, () => {
  it("reads a token pool discovery hands it beside the classic pool, in one request, and lists its boxes apart", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1"), await tokenBox(t, "f1"), await tokenBox(t, "f2"), ...(await strangers(t)));
    const status = await lj.status("preprod");
    // The classic pool's figures where 1.5.0 had them.
    expect(status).toMatchObject({ available: true, boxes: [{ txHash: "c1".repeat(32), txIndex: 0 }], others: 20, lovelace: "10000000" });
    // The token pool's own, each box named by the pool, its token counted.
    expect(status.pools).toHaveLength(1);
    expect(status.pools![0]).toMatchObject({
      id: TOKEN,
      box: { lovelace: "2000000", token: { policyId: VIEW.token.policyId, assetName: VIEW.token.assetName, quantity: VIEW.token.quantity } },
      boxes: [
        { txHash: "f1".repeat(32), txIndex: 0, pool: TOKEN },
        { txHash: "f2".repeat(32), txIndex: 0, pool: TOKEN },
      ],
      others: 10,
      lovelace: "4000000",
      token: { quantity: (2n * BigInt(VIEW.token.quantity)).toString() },
    });
    // One read for every pool, the same for every wallet: nothing names a pool of the wallet's.
    const reads = t.koios.calls.filter((c) => c.path === "credential_utxos");
    expect(reads).toHaveLength(1);
    expect(reads[0]!.body._payment_credentials).toEqual([CLASSIC_BOX, VIEW.mixBoxHash]);
    // The boxes found with no due time get one each, in their own pool.
    const kept = await sealed(t);
    expect(kept.due).toHaveLength(1);
    expect(kept.pools?.[TOKEN]?.due).toHaveLength(2);
  });

  it("leaves out a pool that doesn't verify, or the classic pool's own mix_box named again", async () => {
    const t = await wallet();
    const forged: PoolRef = { ...TOKEN_POOL, seed: { ...TOKEN_POOL.seed, txIndex: 0 } };
    const lj = pooled(t, () => [forged]);
    t.koios.addedToAccounts.push(...POOL, await tokenBox(t, "f1"));
    const status = await lj.status("preprod");
    expect(status.pools).toBeUndefined();
    // And the classic pool alone is read, as ever.
    expect(t.koios.calls.filter((c) => c.path === "credential_utxos")[0]!.body._payment_credentials).toEqual([CLASSIC_BOX]);
  });

  it("keeps a token pool's due times apart, valued as its boxes are, and Home's classic figures as they were", async () => {
    const t = await wallet();
    const lj = pooled(t);
    await lj.schedule("preprod", 2, TOKEN);
    await lj.schedule("preprod", 1);
    const held = await lj.held("preprod");
    expect(held).toMatchObject({ boxes: 1, lovelace: "10000000", notMixed: 0, stopped: 0 });
    expect(held.pools).toEqual([
      {
        id: TOKEN,
        boxes: 2,
        lovelace: "4000000",
        token: { ...VIEW.token, quantity: (2n * BigInt(VIEW.token.quantity)).toString() },
        next: expect.any(Number),
        notMixed: 0,
        // What each box holds, for Home's row (34f).
        box: { lovelace: "2000000", token: VIEW.token },
      },
    ]);
    expect(await lj.returning("preprod")).toBe(true);
  });

  it("brings a token box back by itself through its own pool, its token with it, and counts it against its mix", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await tokenBox(t, "f1"), ...(await strangers(t)));
    await sentChain(lj, "a1", { pools: { [TOKEN]: 1 }, leaves: [{ txHash: "f1".repeat(32), txIndex: 0, pool: TOKEN }] });
    // Due a while ago, and the wallet open since: the alarm's run takes it.
    const kept = await sealed(t);
    expect(kept.due).toEqual([]);
    expect(kept.pools?.[TOKEN]?.due).toHaveLength(1);
    expect(kept.mixes).toEqual([expect.objectContaining({ id: "a1".repeat(32), shares: [{ pool: TOKEN, boxes: 1 }] })]);
    await t.store.set("lovejoin.preprod", { ...kept, pools: { [TOKEN]: { due: [t.clock.now - HOUR] } } });
    await unlockedAnHourAgo(t);
    const [sent] = await lj.withdrawDue("preprod");
    expect(sent).toMatchObject({ kind: "lovejoin-withdraw" });
    // Built against the token pool's own scripts: it spends the token box, and its output carries the token.
    expect(withdrawn(t)).toEqual([`${"f1".repeat(32)}#0`]);
    const outs = JSON.parse(loadTestWasm().ogmiosUtxos(Buffer.from(t.koios.submitted.at(-1)!).toString("hex"))) as Array<{
      value: Record<string, Record<string, number>>;
    }>;
    expect(outs[0]!.value[VIEW.token.policyId]).toBeDefined();
    // The private history has it come in with its token.
    const entry = (await t.activity.seedelf("preprod")).find((e) => e.txHash === sent!.txHash);
    expect(entry).toMatchObject({ kind: "lovejoin-withdraw", direction: "in", assets: [{ policyId: VIEW.token.policyId, assetName: VIEW.token.assetName, quantity: VIEW.token.quantity }] });
    // Its due time went with it, and its mix in the list is over.
    const after = await sealed(t);
    expect(after.pools).toBeUndefined();
    expect(after.mixes).toEqual([]);
  });

  it("brings back one box a run whichever pool it's in, the others each a fresh delay later", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1"), await tokenBox(t, "f1"), ...(await strangers(t)));
    await t.store.set("lovejoin.preprod", { due: [t.clock.now - HOUR], chains: [], pools: { [TOKEN]: { due: [t.clock.now - 2 * HOUR] } } });
    await unlockedAnHourAgo(t);
    expect(await lj.withdrawDue("preprod")).toHaveLength(1);
    // The earliest first: the token pool's.
    expect(withdrawn(t)).toEqual([`${"f1".repeat(32)}#0`]);
    const kept = await sealed(t);
    expect(kept.due).toHaveLength(1);
    expect(kept.due[0]).toBeGreaterThan(t.clock.now);
  });

  it("never drops a token pool's due times on a read that didn't cover it", async () => {
    const t = await wallet();
    let pools: PoolRef[] = [TOKEN_POOL];
    const lj = pooled(t, () => pools);
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1"), await tokenBox(t, "f1"), ...(await strangers(t)));
    await lj.status("preprod");
    expect((await sealed(t)).pools?.[TOKEN]?.due).toHaveLength(1);
    // Discovery has nothing to hand over for a while: the classic pool alone is read, and the token box keeps its time,
    // though the run that reads the classic pool counts its due times against its boxes, and sends its box back.
    pools = [];
    await lj.status("preprod");
    const tokenDue = (await sealed(t)).pools?.[TOKEN]?.due;
    expect(tokenDue).toHaveLength(1);
    await t.store.set("lovejoin.preprod", { ...(await sealed(t)), due: [t.clock.now - HOUR] });
    await unlockedAnHourAgo(t);
    expect(await lj.withdrawDue("preprod")).toHaveLength(1);
    expect(withdrawn(t)).toEqual([`${"c1".repeat(32)}#0`]);
    expect((await sealed(t)).pools?.[TOKEN]?.due).toEqual(tokenDue);
  });
});

describe("the list of mixes, followed until each box is back (session 1, 5)", SLOW, () => {
  it("keeps a chain spanning pools as one mix, draws each pool's due times, and counts each box back in its pool", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1"), await tokenBox(t, "f1"), await tokenBox(t, "f2"), ...(await strangers(t)));
    await sentChain(lj, "a2", {
      pools: { [TOKEN]: 2 },
      leaves: [
        { txHash: "c1".repeat(32), txIndex: 0 },
        { txHash: "f1".repeat(32), txIndex: 0, pool: TOKEN },
        { txHash: "f2".repeat(32), txIndex: 0, pool: TOKEN },
      ],
    });
    const kept = await sealed(t);
    expect(kept.chains[0]).toMatchObject({ boxes: 3, pools: { [TOKEN]: 2 } });
    expect(kept.due).toHaveLength(1);
    expect(kept.pools?.[TOKEN]?.due).toHaveLength(2);
    expect(kept.mixes![0]!.shares).toEqual([{ boxes: 1 }, { pool: TOKEN, boxes: 2 }]);
    // Every box due now: one a run, the earliest first, each counted against the mix in its own pool.
    await t.store.set("lovejoin.preprod", { ...kept, due: [t.clock.now - HOUR], pools: { [TOKEN]: { due: [t.clock.now - 3 * HOUR, t.clock.now - 2 * HOUR] } } });
    await unlockedAnHourAgo(t);
    await lj.withdrawDue("preprod");
    expect((await sealed(t)).mixes![0]!.shares).toEqual([{ boxes: 1 }, { pool: TOKEN, boxes: 2, back: 1 }]);
  });

  describe("a return across pools stopped partway (1.6.0's release review, 319-worker#3)", () => {
    // A session's return across the token pool and the classic pool, one wave deep: its deposit puts two boxes in each
    // (the token's at #0 and #1, the classic pool's at #2 and #3), each box's own mix makes its leaf, the token leg
    // first, then the classic leg, then the return.
    const [dep, tm1, tm2, cm1, cm2, back] = ["d0", "a1", "a2", "c5", "c6", "b0"].map((x) => x.repeat(32)) as [string, string, string, string, string, string];
    const txs = [
      { kind: "deposit" as const, txCbor: "", txHash: dep, fee: "0" },
      ...[tm1, tm2, cm1, cm2].map((txHash) => ({ kind: "mix" as const, txCbor: "", txHash, fee: "0" })),
      { kind: "back" as const, txCbor: "", txHash: back, fee: "0" },
    ];
    const leaves = [{ txHash: tm1, txIndex: 0, pool: TOKEN }, { txHash: tm2, txIndex: 0, pool: TOKEN }, { txHash: cm1, txIndex: 0 }, { txHash: cm2, txIndex: 0 }];
    type Chain = { id: string; cut?: true; unscheduled?: number; unscheduledIn?: Record<string, number> };
    const chainOf = async (t: T) => (await sealed(t)).chains.find((c) => c.id === back) as Chain;
    /** Recorded, and its first `sent` transactions sent: its deposit draws each pool's due times. */
    const sending = async (lj: LovejoinService, sent: number) => {
      await lj.recordChain("preprod", { session: 0, progress: "test.across", txs, leaves, boxes: 4, pools: { [TOKEN]: 2 } });
      for (let i = 0; i < sent; i++) await lj.chainSent("preprod", back, i);
    };
    /** A box of the wallet's where its deposit put it, not mixed yet: in the token pool, its LJTEST with it. */
    const deposited = async (t: T, index: number, token = false) =>
      ({ ...(token ? await tokenBox(t, "d0") : await classicBox(t, "d0")), tx_hash: dep, tx_index: index }) as KoiosUtxo;

    it("drops the classic leg's due times alone, once a lock cuts it after the token leg, and holds its boxes as not mixed", async () => {
      const t = await wallet();
      const lj = pooled(t);
      await sending(lj, 3);
      expect((await sealed(t)).due).toHaveLength(2);
      expect((await sealed(t)).pools?.[TOKEN]?.due).toHaveLength(2);
      // Its progress gone, as a lock or a closed browser wipes it: the next look stops it as cut.
      await lj.cuts("preprod");
      expect(await chainOf(t)).toMatchObject({ cut: true, unscheduled: 2 });
      expect((await chainOf(t)).unscheduledIn).toBeUndefined();
      // The classic leg's boxes never come back by themselves, tying the session's deposit to the private balance; the
      // token leg's, mixed, still do.
      expect((await sealed(t)).due).toEqual([]);
      expect((await sealed(t)).pools?.[TOKEN]?.due).toHaveLength(2);
      // A read finds the classic leg's boxes where the deposit put them, held as not mixed yet, and counts nothing twice.
      t.koios.addedToAccounts.push(...POOL, ...(await strangers(t)), await deposited(t, 2), await deposited(t, 3), await tokenBox(t, "a1"), await tokenBox(t, "a2"));
      const status = await lj.status("preprod");
      expect(status.notMixed).toEqual([
        { txHash: dep, txIndex: 2 },
        { txHash: dep, txIndex: 3 },
      ]);
      expect(status.pools![0]!.notMixed).toEqual([]);
      expect((await sealed(t)).due).toEqual([]);
      expect((await sealed(t)).pools?.[TOKEN]?.due).toHaveLength(2);
      // Due, a token leaf goes back by itself; never a box the deposit put in the classic pool.
      await t.store.set("lovejoin.preprod", { ...(await sealed(t)), pools: { [TOKEN]: { due: [t.clock.now - 2 * HOUR, t.clock.now - HOUR] } } });
      await unlockedAnHourAgo(t);
      expect(await lj.withdrawDue("preprod")).toHaveLength(1);
      expect(withdrawn(t)).toHaveLength(1);
      expect([`${tm1}#0`, `${tm2}#0`]).toContain(withdrawn(t)[0]);
    });

    it("drops each pool's unmixed boxes' due times in its own pool, once it stops in the token leg", async () => {
      const t = await wallet();
      const lj = pooled(t);
      // Its deposit and the token leg's first mix went; the network refused the next.
      await sending(lj, 2);
      await lj.chainEnded("preprod", back, "refused");
      expect(await chainOf(t)).toMatchObject({ unscheduled: 2, unscheduledIn: { [TOKEN]: 1 } });
      expect((await sealed(t)).due).toEqual([]);
      expect((await sealed(t)).pools?.[TOKEN]?.due).toHaveLength(1);
      // The token pool's box its first mix didn't reach is held there, not mixed yet, beside the classic leg's two.
      t.koios.addedToAccounts.push(
        ...POOL,
        ...(await strangers(t)),
        await deposited(t, 1, true),
        await deposited(t, 2),
        await deposited(t, 3),
        await tokenBox(t, "a1"),
      );
      const status = await lj.status("preprod");
      expect(status.notMixed).toEqual([
        { txHash: dep, txIndex: 2 },
        { txHash: dep, txIndex: 3 },
      ]);
      expect(status.pools![0]!.notMixed).toEqual([{ txHash: dep, txIndex: 1, pool: TOKEN }]);
      expect((await sealed(t)).pools?.[TOKEN]?.due).toHaveLength(1);
      expect((await sealed(t)).due).toEqual([]);
    });
  });

  it("squares the list up with the pool when a box came back elsewhere, the oldest mix first", async () => {
    const t = await wallet();
    const lj = pooled(t);
    const [one, two] = [await classicBox(t, "c1"), await classicBox(t, "c2")];
    t.koios.addedToAccounts.push(...POOL, one, two);
    await sentChain(lj, "b1", { leaves: [{ txHash: "c1".repeat(32), txIndex: 0 }] });
    t.clock.now += 60_000;
    await sentChain(lj, "b2", { leaves: [{ txHash: "c2".repeat(32), txIndex: 0 }] });
    // Another device brought one of them back. A read soon after may be behind, and squares nothing up.
    t.koios.addedToAccounts = t.koios.addedToAccounts.filter((u) => u !== one);
    await lj.status("preprod");
    expect((await sealed(t)).mixes!.map((e) => e.id)).toEqual(["b1".repeat(32), "b2".repeat(32)]);
    // Hours on, the chains' records gone: the oldest mix is over.
    t.clock.now += 4 * HOUR;
    await t.wallet.unlock(PASSWORD);
    await lj.status("preprod");
    expect((await sealed(t)).chains).toEqual([]);
    expect((await sealed(t)).mixes!.map((e) => e.id)).toEqual(["b2".repeat(32)]);
  });

  it("never closes a Bootstrap a read that's behind doesn't show the boxes of yet", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, ...(await strangers(t)));
    const deposit = "b2".repeat(32);
    const leaves = [0, 1].map((i) => ({ txHash: deposit, txIndex: i, pool: TOKEN }));
    await lj.recordChain("preprod", { progress: "test.b2", txs: [{ kind: "deposit", txCbor: "", txHash: deposit, fee: "0" }], leaves, boxes: 2, pools: { [TOKEN]: 2 }, bootstrap: true, account: 0 });
    await lj.chainSent("preprod", deposit, 0);
    await lj.chainEnded("preprod", deposit);
    await lj.status("preprod");
    expect((await sealed(t)).mixes).toEqual([expect.objectContaining({ bootstrap: true, shares: [{ pool: TOKEN, boxes: 2 }] })]);
  });

  it("hands mixing again's boxes over from the mixes they were out from", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1"), await classicBox(t, "c2"));
    await sentChain(lj, "d1", { leaves: [{ txHash: "c1".repeat(32), txIndex: 0 }, { txHash: "c2".repeat(32), txIndex: 0 }] });
    t.clock.now += 60_000;
    await sentChain(lj, "d2", { again: true, leaves: [{ txHash: "c1".repeat(32), txIndex: 0 }] });
    const mixes = (await sealed(t)).mixes!;
    expect(mixes.find((e) => e.id === "d1".repeat(32))!.shares).toEqual([{ boxes: 2, moved: 1 }]);
    expect(mixes.find((e) => e.id === "d2".repeat(32))!.shares).toEqual([{ boxes: 1 }]);
  });

  it("makes 1.5.0's chains their entries at the first change, and never again once one's over", async () => {
    const t = await wallet();
    const lj = pooled(t, () => []);
    // A record as 1.5.0 kept it: a chain all sent an hour ago, its box due, no list of mixes.
    const box = await classicBox(t, "c1", 2);
    const chain = { id: "e1".repeat(32), progress: "p", deposit: "e0".repeat(32), mixes: ["e1".repeat(32)], leaves: [{ txHash: "c1".repeat(32), txIndex: 0 }], boxes: 1, total: 2, sent: 2, at: t.clock.now - HOUR, scheduled: true, done: true, ended: t.clock.now - HOUR };
    await t.store.set("lovejoin.preprod", { due: [t.clock.now - 60_000], chains: [chain], unlock: t.clock.now - HOUR });
    t.koios.addedToAccounts.push(...POOL, box);
    await lj.status("preprod");
    // With its chain's deposit, where a Bootstrap's held boxes are looked for (34g's rehearsal).
    expect((await sealed(t)).mixes).toEqual([{ id: chain.id, deposit: chain.deposit, at: chain.at, account: 0, shares: [{ boxes: 1 }] }]);
    // Its box comes back, and its mix is over, while the chain's record is still kept: no entry is made of it again.
    await unlockedAnHourAgo(t);
    expect(await lj.withdrawDue("preprod")).toHaveLength(1);
    const kept = await sealed(t);
    expect(kept.chains.map((c) => c.id)).toEqual([chain.id]);
    expect(kept.mixes).toEqual([]);
    await lj.status("preprod");
    expect((await sealed(t)).mixes).toEqual([]);
  });
});

describe("Bootstrap's boxes (session 1, 6 and 18)", SLOW, () => {
  it("holds them in the pool, with no due time, and brings one back only by hand, counted against its Bootstrap", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, ...(await strangers(t)));
    // A Bootstrap's deposit: two boxes where it put them.
    const deposit = "b0".repeat(32);
    const boxes = await Promise.all([0, 1].map(async (i) => ({ ...(await tokenBox(t, "b0", true, 1)), tx_index: i })));
    t.koios.addedToAccounts.push(...boxes);
    const leaves = boxes.map((b) => ({ txHash: deposit, txIndex: b.tx_index, pool: TOKEN }));
    await lj.recordChain("preprod", { progress: "test.b0", txs: [{ kind: "deposit", txCbor: "", txHash: deposit, fee: "0" }], leaves, boxes: 2, pools: { [TOKEN]: 2 }, bootstrap: true, account: 0 });
    await lj.chainSent("preprod", deposit, 0);
    await lj.chainEnded("preprod", deposit);
    const status = await lj.status("preprod");
    expect(status.pools![0]!.bootstrap).toEqual(leaves);
    expect(status.pools![0]!.due).toEqual([]);
    expect(status.pools![0]!.notMixed).toEqual([]);
    // Days on, still there: none comes back by itself.
    t.clock.now += 48 * HOUR;
    await t.wallet.unlock(PASSWORD);
    await unlockedAnHourAgo(t);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect(t.collateral.asked).toEqual([]);
    // Brought back by hand: one, counted against the Bootstrap.
    await lj.withdrawNow("preprod", leaves[0]!);
    expect(withdrawn(t)).toEqual([`${deposit}#0`]);
    expect((await sealed(t)).mixes).toEqual([expect.objectContaining({ bootstrap: true, shares: [{ pool: TOKEN, boxes: 2, back: 1 }] })]);
  });

  it("lets them come back by themselves, one a run, once brought back all at once", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, ...(await strangers(t)));
    const deposit = "b1".repeat(32);
    const boxes = await Promise.all([0, 1].map(async (i) => ({ ...(await tokenBox(t, "b1", true, 2)), tx_index: i })));
    t.koios.addedToAccounts.push(...boxes);
    const leaves = boxes.map((b) => ({ txHash: deposit, txIndex: b.tx_index, pool: TOKEN }));
    await lj.recordChain("preprod", { progress: "test.b1", txs: [{ kind: "deposit", txCbor: "", txHash: deposit, fee: "0" }], leaves, boxes: 2, pools: { [TOKEN]: 2 }, bootstrap: true, account: 0 });
    await lj.chainSent("preprod", deposit, 0);
    await lj.chainEnded("preprod", deposit);
    await lj.releaseBootstrap("preprod", TOKEN);
    await lj.status("preprod");
    expect((await sealed(t)).pools?.[TOKEN]?.due).toHaveLength(2);
  });
});

describe("Bootstrap's hold, against what else comes back (34a′'s review)", SLOW, () => {
  /** A Bootstrap of two boxes in the token pool, its deposit in, still where it put them. */
  async function bootstrapped(t: T, lj: LovejoinService, { sent = true } = {}) {
    const deposit = "b0".repeat(32);
    const boxes = await Promise.all([0, 1].map(async (i) => ({ ...(await tokenBox(t, "b0", true, 5)), tx_index: i })));
    t.koios.addedToAccounts.push(...boxes);
    const leaves = boxes.map((b) => ({ txHash: deposit, txIndex: b.tx_index, pool: TOKEN }));
    const txs = [{ kind: "deposit" as const, txCbor: "", txHash: deposit, fee: "0" }];
    await lj.recordChain("preprod", { progress: "test.b0", txs, leaves, boxes: 2, pools: { [TOKEN]: 2 }, bootstrap: true, session: 0 });
    if (sent) await lj.chainSent("preprod", deposit, 0);
    await lj.chainEnded("preprod", deposit, sent ? undefined : "Koios didn't answer.");
    return leaves;
  }

  it("never counts a box with no mix of its own against a Bootstrap still holding its boxes", async () => {
    const t = await wallet();
    const lj = pooled(t);
    // A box no record accounts for (a restore's, another device's), then a Bootstrap.
    t.koios.addedToAccounts.push(...POOL, await tokenBox(t, "f1"), ...(await strangers(t)));
    await lj.status("preprod");
    const leaves = await bootstrapped(t, lj);
    await lj.status("preprod");
    // The first box comes back by itself.
    await t.store.set("lovejoin.preprod", { ...(await sealed(t)), pools: { [TOKEN]: { due: [t.clock.now - HOUR] } } });
    await unlockedAnHourAgo(t);
    expect(await lj.withdrawDue("preprod")).toHaveLength(1);
    expect(withdrawn(t)).toEqual([`${"f1".repeat(32)}#0`]);
    t.koios.addedToAccounts = t.koios.addedToAccounts.filter((u) => u.tx_hash !== "f1".repeat(32));
    // The Bootstrap holds both its boxes still, neither with a due time, and none of them comes back by itself.
    expect((await sealed(t)).mixes).toEqual([expect.objectContaining({ bootstrap: true, shares: [{ pool: TOKEN, boxes: 2 }] })]);
    const status = await lj.status("preprod");
    expect(status.pools![0]).toMatchObject({ bootstrap: leaves, due: [] });
  });

  it("keeps holding a Bootstrap whose deposit Koios never answered for but went in, after its record goes too", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, ...(await strangers(t)));
    const leaves = await bootstrapped(t, lj, { sent: false });
    expect((await lj.status("preprod")).pools![0]).toMatchObject({ bootstrap: leaves, due: [] });
    t.clock.now += 4 * HOUR;
    await t.wallet.unlock(PASSWORD);
    expect((await lj.status("preprod")).pools![0]).toMatchObject({ bootstrap: leaves, due: [] });
    expect((await sealed(t)).mixes).toEqual([expect.objectContaining({ bootstrap: true, shares: [{ pool: TOKEN, boxes: 2 }] })]);
  });

  it("closes the mix of a chain that never went, once its record goes with none of its boxes listed, not an older one", async () => {
    const t = await wallet();
    const lj = pooled(t);
    // An older mix whose box is still out.
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1"));
    await sentChain(lj, "d1", { leaves: [{ txHash: "c1".repeat(32), txIndex: 0 }] });
    t.clock.now += 60_000;
    await lj.recordChain("preprod", {
      progress: "test.n0",
      txs: [{ kind: "deposit", txCbor: "", txHash: "a0".repeat(32), fee: "0" }],
      leaves: [{ txHash: "a0".repeat(32), txIndex: 0 }],
      boxes: 1,
      session: 0,
    });
    await lj.chainEnded("preprod", "a0".repeat(32), "The network rejected the transaction.");
    await lj.status("preprod");
    expect((await sealed(t)).mixes).toHaveLength(2);
    t.clock.now += 4 * HOUR;
    await t.wallet.unlock(PASSWORD);
    await lj.status("preprod");
    expect((await sealed(t)).mixes!.map((e) => e.id)).toEqual(["d1".repeat(32)]);
  });
});

describe("what made a token pool's box, after a restore (independent review M14)", SLOW, () => {
  it("is said of the pools the read found, though discovery fails to answer meanwhile", async () => {
    const t = await wallet();
    let calls = 0;
    const lj = pooled(t, () => {
      if (++calls > 1) throw new Error("discovery isn't answering");
      return [TOKEN_POOL];
    });
    t.koios.addedToAccounts.push(...POOL, await tokenBox(t, "f1"), ...(await strangers(t)));
    await lj.status("preprod");
    expect(calls).toBeGreaterThan(1);
    expect((await sealed(t)).origins?.["f1".repeat(32)]).toMatchObject({ mixed: false, mixedIn: [TOKEN] });
  });

  it("is a mix in that pool, said apart from the classic pool's, and the box comes back", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await tokenBox(t, "f1"), ...(await strangers(t)));
    await lj.status("preprod");
    const kept = await sealed(t);
    expect(kept.origins?.["f1".repeat(32)]).toMatchObject({ mixed: false, mixedIn: [TOKEN] });
    expect(kept.pools?.[TOKEN]?.due).toHaveLength(1);
    expect(kept.pools?.[TOKEN]?.notMixed).toBeUndefined();
  });
});

describe("the token pools on the data layer (chunk 34's 34c)", SLOW, () => {
  /** The index listing the classic pool and the token pool, each box with what made it. */
  async function onIndex(t: T) {
    const index = fakeIndex();
    const at = index.tip - 100_000;
    const made = (cred: string): IndexRow["made_by"] => ({ mixed: true, inputs: [[cred, null]] });
    index.pool = [...POOL, await classicBox(t, "c1")].map((u) => ({ row: { ...indexRowOf(u, at), made_by: made(CLASSIC_BOX) } }));
    index.tokens = [await tokenBox(t, "f1"), await tokenBox(t, "f2"), ...(await strangers(t))].map((u) => ({
      row: { ...indexRowOf(u, at), made_by: made(VIEW.mixBoxHash) },
    }));
    index.tokenPools = [VIEW.mixBoxHash];
    // What Koios would list, were it asked: the token pool's boxes, and the classic pool's.
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1"), await tokenBox(t, "f1"), await tokenBox(t, "f2"), ...(await strangers(t)));
    t.koios.calls.length = 0;
    return { index, parts: new DataParts(t.session, () => t.clock.now) };
  }

  const mixBoxReads = (t: T) =>
    t.koios.calls.filter((c) => c.path === "credential_utxos").map((c) => c.body._payment_credentials as string[]);

  it("reads a token pool's boxes from the combined feed, each with what made it: Koios is asked about neither", async () => {
    const t = await wallet();
    const { index, parts } = await onIndex(t);
    const status = await pooled(t, undefined, { fetch: index.fetch, parts }).status("preprod");
    expect(status.pools![0]).toMatchObject({
      id: TOKEN,
      boxes: [
        { txHash: "f1".repeat(32), txIndex: 0, pool: TOKEN },
        { txHash: "f2".repeat(32), txIndex: 0, pool: TOKEN },
      ],
      others: 10,
    });
    expect(index.calls.filter((c) => c.startsWith("lovejoin/"))).toEqual([
      "lovejoin/pool",
      expect.stringMatching(/^lovejoin\/since\//),
      "lovejoin/tokens",
      expect.stringMatching(/^lovejoin\/tokens\/since\//),
    ]);
    // No pool listed by Koios, and nobody asked what made a box: the feed said, as the classic pool's does.
    expect(mixBoxReads(t)).toEqual([]);
    expect(t.koios.calls.filter((c) => c.path === "tx_info")).toEqual([]);
    const origins = (await sealed(t)).origins ?? {};
    expect(origins["f1".repeat(32)]).toMatchObject({ mixed: false, mixedIn: [TOKEN] });
  });

  it("reads the token pools from Koios while the feed can't answer, the classic pool from the index, the part kept up", async () => {
    const t = await wallet();
    const { index, parts } = await onIndex(t);
    index.tokensFail = Response.json({ error: "behind" }, { status: 503 });
    const status = await pooled(t, undefined, { fetch: index.fetch, parts }).status("preprod");
    expect(status.pools![0]!.boxes).toHaveLength(2);
    expect(mixBoxReads(t)).toEqual([[VIEW.mixBoxHash]]);
    expect(await parts.up("private")).toBe(true);
    // A token box's making is Koios's to say now; the classic pool's box's still the index's.
    const asked = t.koios.calls.filter((c) => c.path === "tx_info").flatMap((c) => c.body._tx_hashes as string[]);
    expect(asked).toEqual(expect.arrayContaining(["f1".repeat(32), "f2".repeat(32)]));
    expect(asked).not.toContain("c1".repeat(32));
  });

  it("reads from Koios a shown pool the feed doesn't cover yet", async () => {
    const t = await wallet();
    const { index, parts } = await onIndex(t);
    index.tokenPools = [];
    index.tokens = [];
    const status = await pooled(t, undefined, { fetch: index.fetch, parts }).status("preprod");
    expect(status.pools![0]!.boxes).toHaveLength(2);
    expect(mixBoxReads(t)).toEqual([[VIEW.mixBoxHash]]);
  });
});

describe("what the Lovejoin hub reads of each pool (chunk 34's 34f)", SLOW, () => {
  it("says each pool's crowd and launch, whether this wallet started it, and the starts no look has found yet", async () => {
    const t = await wallet();
    const launch = "ab".repeat(32);
    const lj = pooled(t, undefined, undefined, {
      facts: async () => ({
        launches: new Map([[TOKEN, launch]]),
        crowds: new Map([
          ["classic", { boxes: 21, deposits: 7, mixed: 15 }],
          [TOKEN, { boxes: 11, deposits: 2, mixed: 0 }],
        ]),
      }),
    });
    t.koios.addedToAccounts.push(...POOL, await tokenBox(t, "f1"), ...(await strangers(t)));
    await lj.recordLaunch("preprod", { id: TOKEN, txHash: launch, from: "private" });
    await lj.recordLaunch("preprod", { id: "ee".repeat(28), txHash: "cd".repeat(32), from: "public", account: 0 });
    const status = await lj.status("preprod");
    expect(status.crowd).toEqual({ boxes: 21, deposits: 7, mixed: 15 });
    expect(status.pools![0]).toMatchObject({ id: TOKEN, crowd: { boxes: 11, deposits: 2, mixed: 0 }, launch, mine: true });
    // The start not found yet is the hub's note; the one found is a pool like any other.
    expect(status.started).toEqual([{ id: "ee".repeat(28), txHash: "cd".repeat(32), at: expect.any(Number) }]);
  });

  it("names no crowd, launch or start where discovery has none to say, as on Koios", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await tokenBox(t, "f1"), ...(await strangers(t)));
    const status = await lj.status("preprod");
    expect(status.crowd).toBeUndefined();
    expect(status.started).toBeUndefined();
    expect(status.pools![0]!.crowd).toBeUndefined();
    expect(status.pools![0]!.launch).toBeUndefined();
    expect(status.pools![0]!.mine).toBeUndefined();
  });

  it("brings back one of a pool's own boxes from its page, never another pool's that waited longer", async () => {
    const t = await wallet();
    const lj = pooled(t);
    // The classic pool's box moved an hour longer ago than the token pool's: any pool's, it would come first.
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1", 9), await tokenBox(t, "f1", true, 5), ...(await strangers(t)));
    await lj.status("preprod");
    await unlockedAnHourAgo(t);
    await lj.withdrawNow("preprod", undefined, false, false, TOKEN);
    expect(withdrawn(t)).toEqual([`${"f1".repeat(32)}#0`]);
  });

  it("brings back one of the classic pool's boxes from its page, by its name", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1", 5), await tokenBox(t, "f1", true, 9), ...(await strangers(t)));
    await lj.status("preprod");
    await unlockedAnHourAgo(t);
    await lj.withdrawNow("preprod", undefined, false, false, "classic");
    expect(withdrawn(t)).toEqual([`${"c1".repeat(32)}#0`]);
  });

  it("tells a pool's page of its own boxes alone when none can come back (34f's review, 6)", async () => {
    const t = await wallet();
    const lj = pooled(t);
    // The token pool's box is held by a Bootstrap, where its deposit put it (a Bootstrap holds nothing in its place
    // before its deposit is in: 1.6.0's release review, 316#0); the classic pool's isn't mixed yet: Koios says a
    // deposit made it (its input sits at a key's address, not the pool's), as after a restore.
    const deposited = await classicBox(t, "c1", 5);
    t.koios.txSpends.set("c1".repeat(32), [{ payment_addr: { bech32: TOKEN_ADDRESS.replace("addr_test1w", "addr_test1v"), cred: "ab".repeat(28) } }]);
    const deposit = "b10".padEnd(64, "0");
    t.koios.addedToAccounts.push(...POOL, deposited, { ...(await tokenBox(t, "f1")), tx_hash: deposit }, ...(await strangers(t)));
    await sentChain(lj, "b1", { pools: { [TOKEN]: 1 }, leaves: [{ txHash: deposit, txIndex: 0, pool: TOKEN }], bootstrap: true });
    const status = await lj.status("preprod");
    expect(status.notMixed).toEqual([{ txHash: "c1".repeat(32), txIndex: 0 }]);
    await unlockedAnHourAgo(t);
    // The token pool's page: none of its boxes comes back now, said as its own, never the classic pool's unmixed one:
    // a Bootstrap holds its only box, which "none of your boxes" denied (1.6.0's release review, UI-5).
    await expect(lj.withdrawNow("preprod", undefined, false, false, TOKEN)).rejects.toThrow(t_("lj.bootstrapHolds"));
  });

  it("says a start no look has found for a day no more (34f's review, 11)", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await tokenBox(t, "f1"), ...(await strangers(t)));
    await lj.recordLaunch("preprod", { id: "ee".repeat(28), txHash: "cd".repeat(32), from: "private" });
    expect((await lj.status("preprod")).started).toHaveLength(1);
    // Sent 25 hours ago (moving the clock would lock the wallet).
    const kept = (await t.store.get<{ launches: Array<{ at: number }> }>("lovejoin.preprod"))!;
    await t.store.set("lovejoin.preprod", { ...kept, launches: kept.launches.map((l) => ({ ...l, at: t.clock.now - 25 * HOUR })) });
    expect((await lj.status("preprod")).started).toBeUndefined();
  });

  it("lists each token pool's box value with Home's figures, for its row", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await tokenBox(t, "f1"), ...(await strangers(t)));
    await lj.status("preprod");
    const held = await lj.held("preprod");
    expect(held.pools?.[0]?.box).toEqual({ lovelace: "2000000", token: VIEW.token });
  });
});
