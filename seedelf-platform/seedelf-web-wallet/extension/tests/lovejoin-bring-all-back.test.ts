// Bring every box back now, from Settings → Lovejoin (the owner's test of 1.6.0, 2026-10-20: "a user has no way to do
// an emergency like get everything out of lovejoin"): every box of the wallet's in every pool comes back, one withdraw
// after another, each sent as soon as the last was taken, with none of a box's waits; a Bootstrap's held boxes and
// those not mixed yet too. Only what's there: it waits for a chain being sent, and blocks nothing else (the owner).
// With the real WebAssembly, the classic pool's recorded preprod boxes, and PR #163's preprod token pool.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { BRING_FAILED_RUNS, BRING_RUN_MS, LovejoinService, type LovejoinDeps, type PoolRef } from "../src/background/lovejoin";
import { NETWORKS } from "../src/networks";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { busyFor, loadTestWasm, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const PHRASE = (vectors("cardano_account.json") as Array<{ account: number; phrase: string }>).find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
)!.phrase;

/** Real withdraws are built and measured in WebAssembly: seconds each, more on CI. */
const SLOW = { timeout: 180_000 };

const POOL = (JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }).pool;
const CLASSIC_BOX = NETWORKS.preprod.lovejoin!.mixBox;
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
const TOKEN_ADDRESS = bech32("addr_test", Uint8Array.from([0x70, ...Buffer.from(VIEW.mixBoxHash, "hex")]));
const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };

type T = ReturnType<typeof testBalances>;

/** Lovejoin reading the classic pool and the token pool, giveme.my's witness stood in for; `extra`, deps of a test's own. */
function pooled(t: T, extra: Partial<LovejoinDeps> = {}) {
  const wasm = loadTestWasm();
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  return new LovejoinService({
    ...t.deps,
    wasm: {
      ...wasm,
      finishLovejoinWithdraw: (request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    pools: async () => [TOKEN_POOL],
    random: () => 0.5,
    ...extra,
  });
}

/** A wallet just unlocked: the moment a box's own run never sends anything (privacy review §3.1). */
async function wallet(): Promise<T> {
  const t = testBalances();
  await t.wallet.create(PHRASE, PASSWORD);
  t.koios.evaluation = AGREES;
  return t;
}

async function datum(t: T, ours: boolean): Promise<string> {
  const wasm = loadTestWasm();
  if (ours) return t.wallet.withKeys((keys) => Buffer.from(wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister()))).toString("hex"));
  const stranger = wasm.SeedelfKey.fromHex("01".repeat(32));
  const bytes = Buffer.from(wasm.registerToDatum(wasm.rerandomize(stranger.baseRegister()))).toString("hex");
  stranger.free();
  return bytes;
}

/** A box in the token pool (2 ₳ and its LJTEST), the wallet's or a stranger's, a mix having moved it `minutes` ago. */
async function tokenBox(t: T, tx: string, ours = true, minutes = 5): Promise<KoiosUtxo> {
  t.koios.txSpends.set(tx.repeat(32), [{ payment_addr: { bech32: TOKEN_ADDRESS, cred: VIEW.mixBoxHash } }]);
  return {
    ...POOL[0]!,
    tx_hash: tx.repeat(32),
    tx_index: 0,
    address: TOKEN_ADDRESS,
    payment_cred: VIEW.mixBoxHash,
    value: "2000000",
    block_time: Math.floor(t.clock.now / 1000) - minutes * 60,
    datum_hash: null,
    inline_datum: { bytes: await datum(t, ours), value: {} },
    asset_list: [{ policy_id: VIEW.token.policyId, asset_name: VIEW.token.assetName, quantity: VIEW.token.quantity, decimals: 0, fingerprint: "asset1ljtest" } as never],
  } as KoiosUtxo;
}

/** A box of the wallet's in the classic pool, a mix having moved it `minutes` ago. */
async function classicBox(t: T, tx: string, minutes = 5): Promise<KoiosUtxo> {
  t.koios.txSpends.set(tx.repeat(32), [{ payment_addr: { bech32: POOL[0]!.address, cred: CLASSIC_BOX } }]);
  return { ...POOL[0]!, tx_hash: tx.repeat(32), tx_index: 0, block_time: Math.floor(t.clock.now / 1000) - minutes * 60, inline_datum: { bytes: await datum(t, true), value: {} } } as KoiosUtxo;
}

async function strangers(t: T): Promise<KoiosUtxo[]> {
  return Promise.all(Array.from({ length: 10 }, (_, i) => tokenBox(t, (0x60 + i).toString(16), false)));
}

/** The boxes the withdraws giveme.my was asked about spend, `txhash#index`. */
const withdrawn = (t: T) => t.collateral.asked.flatMap((tx) => txInputs(Uint8Array.from(Buffer.from(tx, "hex"))));

type Sealed = {
  due: number[];
  notMixed?: number;
  pools?: Record<string, { due: number[] }>;
  mixes?: Array<{ bootstrap?: true; shares: Array<{ pool?: string; boxes: number; back?: number }> }>;
  bringing?: { back: number; left?: number; why?: string; fails?: number; stopped?: true };
  withdrawing?: { txHash: string };
};
const sealed = async (t: T) => (await t.store.get<Sealed>("lovejoin.preprod"))!;

/** A Bootstrap of two boxes in the token pool, its deposit in, still where it put them: held, never mixed. */
async function bootstrapped(t: T, lj: LovejoinService): Promise<string[]> {
  const deposit = "b0".repeat(32);
  const boxes = await Promise.all([0, 1].map(async (i) => ({ ...(await tokenBox(t, "b0", true, 5)), tx_index: i })));
  t.koios.addedToAccounts.push(...boxes);
  const leaves = boxes.map((b) => ({ txHash: deposit, txIndex: b.tx_index, pool: TOKEN }));
  await lj.recordChain("preprod", { progress: "test.b0", txs: [{ kind: "deposit", txCbor: "", txHash: deposit, fee: "0" }], leaves, boxes: 2, pools: { [TOKEN]: 2 }, bootstrap: true, account: 0 });
  await lj.chainSent("preprod", deposit, 0);
  await lj.chainEnded("preprod", deposit);
  return leaves.map((l) => `${l.txHash}#${l.txIndex}`);
}

describe("Bring every box back now (the owner's test of 1.6.0)", SLOW, () => {
  it("brings back every box in every pool in one run, one after another, a Bootstrap's held ones too, even in the unlock's run", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1"), await tokenBox(t, "f1"), ...(await strangers(t)));
    const held = await bootstrapped(t, lj);
    // A pool read gives the mixed boxes their due times, hours away; the Bootstrap's hold its two.
    await lj.status("preprod");
    expect((await sealed(t)).due).toHaveLength(1);
    expect(await lj.held("preprod")).toMatchObject({ boxes: 1, pools: [expect.objectContaining({ id: TOKEN, boxes: 1, bootstrap: 2 })] });
    // Nothing is due, and the wallet unlocked this minute: a box's own run would send nothing.
    expect(await lj.withdrawDue("preprod", true)).toEqual([]);
    expect(t.collateral.asked).toEqual([]);

    await lj.bringAllBack("preprod");
    expect(await lj.returning("preprod")).toBe(true);
    expect((await lj.held("preprod")).bringing).toEqual({ back: 0 });
    // Counted box by box as it goes, what's left said from the start: Settings and the pool's page follow it.
    const counts: Array<[number, number | undefined]> = [];
    const set = t.store.set.bind(t.store);
    t.store.set = (async (key: string, value: unknown) => {
      const b = key === "lovejoin.preprod" ? (value as Sealed).bringing : undefined;
      if (b) counts.push([b.back, b.left]);
      return set(key as never, value as never);
    }) as typeof t.store.set;
    const sent = await lj.withdrawDue("preprod", true);
    t.store.set = set;
    expect(sent).toHaveLength(4);
    expect(counts.filter(([, left]) => left !== undefined)).toEqual(expect.arrayContaining([[0, 4], [1, 3], [2, 2], [3, 1], [4, 0]]));
    // The classic pool's first, then the token pool's: the mixed box and the Bootstrap's two, which it never mixed.
    expect(withdrawn(t)[0]).toBe(`${"c1".repeat(32)}#0`);
    expect(new Set(withdrawn(t))).toEqual(new Set([`${"c1".repeat(32)}#0`, `${"f1".repeat(32)}#0`, ...held]));
    expect(t.koios.submitted).toHaveLength(4);
    expect((await sealed(t)).bringing).toEqual({ at: expect.any(Number), back: 4, left: 0 });

    // The next run finds none left to send, but the pools still list them: their withdraws aren't on chain yet.
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await sealed(t)).bringing).toEqual({ at: expect.any(Number), back: 4, left: 0, confirming: 4 });
    expect((await lj.held("preprod")).bringing).toEqual({ back: 4, left: 0, confirming: 4 });
    expect(await lj.returning("preprod")).toBe(true);
    // On chain: it's over, and Home's figures say so at once.
    for (const box of withdrawn(t)) t.koios.spent.add(box);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    const after = await sealed(t);
    expect(after.bringing).toBeUndefined();
    expect(after.due).toEqual([]);
    expect(after.pools?.[TOKEN]).toBeUndefined();
    // The Bootstrap counted its two back, so its entry is over too.
    expect(after.mixes ?? []).toEqual([]);
    const home = await lj.held("preprod");
    expect(home).toMatchObject({ boxes: 0, notMixed: 0 });
    expect(home.bootstrap).toBeUndefined();
    expect(home.pools ?? []).toEqual([]);
    expect(home.bringing).toBeUndefined();
    expect(await lj.returning("preprod")).toBe(false);
    expect(t.koios.submitted).toHaveLength(4);
  });

  it("waits while a chain of the wallet's is being sent, and keeps the alarm going", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1"), ...(await strangers(t)));
    await lj.recordChain("preprod", {
      progress: "test.e0",
      txs: [{ kind: "deposit", txCbor: "", txHash: "e0".repeat(32), fee: "0" }],
      leaves: [{ txHash: "e0".repeat(32), txIndex: 0 }],
      boxes: 1,
      account: 0,
    });
    // Its progress where it waits, as a chain being sent has it (cuts).
    await t.wallet.withKeys(() => t.session.set("test.e0", { txs: [{ txHash: "e0".repeat(32) }] }));
    await lj.bringAllBack("preprod");
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect(t.collateral.asked).toEqual([]);
    // Said, in a word (1.6.0's release review, 321-lj-worker#1).
    expect((await sealed(t)).bringing).toEqual({ at: expect.any(Number), back: 0, waiting: "chain" });
    expect(await lj.returning("preprod")).toBe(true);
    // Once it's sent, the run goes on.
    await lj.chainSent("preprod", "e0".repeat(32), 0);
    await lj.chainEnded("preprod", "e0".repeat(32));
    expect(await lj.withdrawDue("preprod")).toHaveLength(1);
    expect(withdrawn(t)).toEqual([`${"c1".repeat(32)}#0`]);
  });

  it(`passes over a box that doesn't go, and stops after ${BRING_FAILED_RUNS} runs that sent nothing, saying why, until asked again`, async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1"), ...(await strangers(t)));
    await lj.status("preprod");
    await lj.bringAllBack("preprod");
    // giveme.my won't put up its collateral.
    t.collateral.answer = { status: 503, body: { error: "busy" } };
    for (let run = 1; run <= BRING_FAILED_RUNS; run++) {
      expect(await lj.withdrawDue("preprod")).toEqual([]);
      expect((await sealed(t)).bringing).toMatchObject({ back: 0, left: 1, fails: run, why: expect.any(String) });
    }
    const stopped = await sealed(t);
    expect(stopped.bringing?.stopped).toBe(true);
    expect((await lj.held("preprod")).bringing).toEqual({ back: 0, left: 1, stopped: stopped.bringing!.why });
    expect(t.koios.submitted).toEqual([]);
    // Stopped, the box keeps its own due time, hours away, and a run brings nothing back before it.
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    expect((await sealed(t)).due).toHaveLength(1);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect(t.koios.submitted).toEqual([]);
    // Asked again, it starts afresh, and goes.
    await lj.bringAllBack("preprod");
    expect((await sealed(t)).bringing).toEqual({ at: expect.any(Number), back: 0 });
    expect(await lj.withdrawDue("preprod")).toHaveLength(1);
  });

  it("counts a pool read that failed as a run that sent nothing, saying why, and goes on once it reads", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1"), ...(await strangers(t)));
    await lj.bringAllBack("preprod");
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) =>
      String(url).includes("credential_utxos") ? Response.json({ message: "Koios is down." }, { status: 400 }) : real(url, init);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await sealed(t)).bringing).toMatchObject({ back: 0, fails: 1, why: expect.any(String) });
    expect((await sealed(t)).bringing?.left).toBeUndefined();
    t.koios.fetch = real;
    expect(await lj.withdrawDue("preprod")).toHaveLength(1);
    expect((await sealed(t)).bringing).toEqual({ at: expect.any(Number), back: 1, left: 0 });
  });

  it("from a pool's page brings back that pool's boxes alone: the other pools' keep their waits", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1"), await tokenBox(t, "f1"), ...(await strangers(t)));
    await lj.status("preprod");
    await lj.bringAllBack("preprod", TOKEN);
    expect((await lj.held("preprod")).bringing).toEqual({ back: 0, pool: TOKEN });
    expect(await lj.withdrawDue("preprod")).toHaveLength(1);
    expect(withdrawn(t)).toEqual([`${"f1".repeat(32)}#0`]);
    expect((await sealed(t)).bringing).toEqual({ at: expect.any(Number), back: 1, pool: TOKEN, left: 0 });
    // On chain, and over: the token pool's figures go, the classic pool's box keeps its due time, hours away. The
    // classic pool's box, listed and unspent, isn't this run's to wait for.
    for (const box of withdrawn(t)) t.koios.spent.add(box);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    const after = await sealed(t);
    expect(after.bringing).toBeUndefined();
    expect(after.pools?.[TOKEN]).toBeUndefined();
    expect(after.due).toHaveLength(1);
    expect(withdrawn(t)).toHaveLength(1);
  });

  it("widens one pool's to every pool's when Settings asks, and refuses another pool's while one goes", async () => {
    const t = await wallet();
    const lj = pooled(t);
    await lj.bringAllBack("preprod", TOKEN);
    await expect(lj.bringAllBack("preprod", "classic")).rejects.toThrow("Another pool's boxes are coming back now.");
    // The same pool's again changes nothing.
    await lj.bringAllBack("preprod", TOKEN);
    expect((await sealed(t)).bringing).toEqual({ at: expect.any(Number), back: 0, pool: TOKEN });
    // Every pool's, from Settings: the same run, for every pool; a pool's is in it already.
    await lj.bringAllBack("preprod");
    expect((await sealed(t)).bringing).toEqual({ at: expect.any(Number), back: 0 });
    await lj.bringAllBack("preprod", "classic");
    expect((await sealed(t)).bringing).toEqual({ at: expect.any(Number), back: 0 });
  });

  it("stops when asked from Settings: the boxes left come back as before, each after its own wait", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1"), ...(await strangers(t)));
    await lj.status("preprod");
    await lj.bringAllBack("preprod");
    await lj.stopBringingAllBack("preprod");
    expect((await sealed(t)).bringing).toBeUndefined();
    expect((await lj.held("preprod")).bringing).toBeUndefined();
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect(t.collateral.asked).toEqual([]);
    expect((await sealed(t)).due).toHaveLength(1);
  });
});

/** A mix from the public account, deposit `d0` and mix `d1`, recorded and sent: one box, in the classic pool, at `d1#0`. */
async function publicMix(lj: LovejoinService, ended = true): Promise<void> {
  const txs = [
    { kind: "deposit" as const, txCbor: "", txHash: "d0".repeat(32), fee: "0" },
    { kind: "mix" as const, txCbor: "", txHash: "d1".repeat(32), fee: "0" },
  ];
  await lj.recordChain("preprod", { progress: "test.d0", txs, leaves: [{ txHash: "d1".repeat(32), txIndex: 0 }], boxes: 1, account: 0 });
  await lj.chainSent("preprod", "d1".repeat(32), 0);
  if (!ended) return;
  await lj.chainSent("preprod", "d1".repeat(32), 1);
  await lj.chainEnded("preprod", "d1".repeat(32));
}

describe("Bring every box back now: only what's there, and its waits (1.6.0's review)", SLOW, () => {
  it("takes only the boxes there when it was asked: a mix sent since keeps its waits, and its due time once it's over", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1", 30), ...(await strangers(t)));
    await lj.status("preprod");
    await lj.bringAllBack("preprod");
    // A minute on, the user mixes from the public account, and its box is listed a minute after its mix. So is one
    // someone else's mix moved since, which may be that mix's box as well as one that was there (ripeAt).
    await busyFor(t, 60_000);
    await publicMix(lj);
    t.koios.addedToAccounts.push(await classicBox(t, "d1", 1), await classicBox(t, "d2", 0));
    expect((await sealed(t)).due).toHaveLength(2);
    expect(await lj.withdrawDue("preprod")).toHaveLength(1);
    expect(withdrawn(t)).toEqual([`${"c1".repeat(32)}#0`]);
    expect((await sealed(t)).bringing).toMatchObject({ back: 1, left: 0 });
    // On chain: it's over, and the mix's box keeps the due time its chain drew, hours away.
    t.koios.spent.add(`${"c1".repeat(32)}#0`);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    const after = await sealed(t);
    expect(after.bringing).toBeUndefined();
    expect(after.due).toHaveLength(1);
    expect(after.due[0]! - t.clock.now).toBeGreaterThan(3_600_000);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect(withdrawn(t)).toHaveLength(1);
  });

  it("waits for the boxes a review it kept holds, keeping their due times, and takes them once it lapses", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1"), await classicBox(t, "c2"), ...(await strangers(t)));
    await lj.status("preprod");
    expect((await sealed(t)).due).toHaveLength(2);
    // A public Mix my boxes again built and kept for Send reserves both for ten minutes (BUILT_TTL_MS).
    const boxes = [`${"c1".repeat(32)}#0`, `${"c2".repeat(32)}#0`];
    await t.wallet.withKeys(() => t.session.set("seedelf.reserved.preprod", { public: { inputs: boxes, collateral: [], until: t.clock.now + 10 * 60_000 } }));
    await lj.bringAllBack("preprod");
    // They were there when it was asked: not over, and Settings says they're left, and what holds them.
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await sealed(t)).bringing).toEqual({ at: expect.any(Number), back: 0, left: 2, held: true });
    expect((await sealed(t)).due).toHaveLength(2);
    expect(t.collateral.asked).toEqual([]);
    // The review is never sent: once it lapses, the next run takes them.
    await busyFor(t, 11 * 60_000);
    expect(await lj.withdrawDue("preprod")).toHaveLength(2);
    expect(new Set(withdrawn(t))).toEqual(new Set(boxes));
  });

  it("says a mix built and not sent holds what's left, in place of an older run's reason, until the run waits for something else", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1"), ...(await strangers(t)));
    await lj.status("preprod");
    await lj.bringAllBack("preprod");
    // giveme.my doesn't answer: the run says why.
    t.collateral.answer = { status: 503, body: { error: "busy" } };
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await lj.held("preprod")).bringing).toMatchObject({ back: 0, left: 1, why: expect.any(String) });
    // Then a public Mix my boxes again is built and kept for Send: it holds the box, and that's what's said.
    const box = `${"c1".repeat(32)}#0`;
    await t.wallet.withKeys(() => t.session.set("seedelf.reserved.preprod", { public: { inputs: [box], collateral: [], until: t.clock.now + 10 * 60_000 } }));
    await busyFor(t, 60_000);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await lj.held("preprod")).bringing).toEqual({ back: 0, left: 1, held: true });
    // It's sent: the run waits for the chain being sent now, and says that, no longer that the mix holds them.
    await publicMix(lj, false);
    await t.wallet.withKeys(() => t.session.set("test.d0", { txs: [{ txHash: "d0".repeat(32) }, { txHash: "d1".repeat(32) }] }));
    await busyFor(t, 60_000);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await lj.held("preprod")).bringing).toEqual({ back: 0, left: 1, waiting: "chain" });
  });

  it("says nothing of none left when a mix built while it waited is sent: that mix's boxes stay, each after its wait", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1"), await classicBox(t, "c2"), ...(await strangers(t)));
    await lj.status("preprod");
    const boxes = [`${"c1".repeat(32)}#0`, `${"c2".repeat(32)}#0`];
    await t.wallet.withKeys(() => t.session.set("seedelf.reserved.preprod", { public: { inputs: boxes, collateral: [], until: t.clock.now + 10 * 60_000 } }));
    await lj.bringAllBack("preprod");
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    // The user sends that mix: its chain spends both, and its box is in the pool.
    await busyFor(t, 60_000);
    await t.wallet.withKeys(() => t.session.set("seedelf.reserved.preprod", {}));
    for (const b of boxes) t.koios.spent.add(b);
    await publicMix(lj);
    t.koios.addedToAccounts.push(await classicBox(t, "d1", 1));
    await busyFor(t, 60_000);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    // Over, having sent none, while the mix's box waits its turn: Settings and the pool's page say nothing of none left.
    expect((await sealed(t)).bringing).toBeUndefined();
    const held = await lj.held("preprod");
    expect(held.boxes).toBe(1);
    const { doneOf } = await import("../src/ui/components/BringAllBack");
    expect(doneOf({ back: 0 }, held)).toBeUndefined();
    expect(doneOf({ back: 0, pool: "classic" }, held)).toBeUndefined();
    expect(t.collateral.asked).toEqual([]);
  });

  it("leaves its end to a later run when a chain of the wallet's went out while it read the pools, keeping that chain's due times", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, ...(await strangers(t)));
    await lj.bringAllBack("preprod");
    await busyFor(t, 60_000);
    const real = t.koios.fetch;
    let once = false;
    t.koios.fetch = async (url, init) => {
      if (!once && String(url).includes("credential_utxos")) {
        once = true;
        // A public mix the user sent meanwhile: recorded, its deposit in, its box's due time set (chainSent).
        await publicMix(lj, false);
        await t.wallet.withKeys(() => t.session.set("test.d0", { txs: [{ txHash: "d0".repeat(32) }, { txHash: "d1".repeat(32) }] }));
      }
      return real(url, init);
    };
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    t.koios.fetch = real;
    expect((await sealed(t)).bringing).toBeDefined();
    expect((await sealed(t)).due).toHaveLength(1);
    // Sent, and its box listed: a later run ends it, the box keeping its wait.
    await lj.chainSent("preprod", "d1".repeat(32), 1);
    await lj.chainEnded("preprod", "d1".repeat(32));
    t.koios.addedToAccounts.push(await classicBox(t, "d1", 1));
    await busyFor(t, 60_000);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await sealed(t)).bringing).toBeUndefined();
    expect((await sealed(t)).due).toHaveLength(1);
    expect(t.collateral.asked).toEqual([]);
  });

  it("sends nothing while Mix my boxes again runs, whose chain will spend the boxes", async () => {
    const t = await wallet();
    const lj = pooled(t, { mixingAgain: async () => true });
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1"), ...(await strangers(t)));
    await lj.status("preprod");
    await lj.bringAllBack("preprod");
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect(t.collateral.asked).toEqual([]);
    expect(t.koios.submitted).toEqual([]);
    expect((await sealed(t)).bringing).toEqual({ at: expect.any(Number), back: 0, waiting: "again" });
  });

  it("looks for a withdraw Koios didn't answer before taking the next box, and its box's way back lands in the history", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1"), await tokenBox(t, "f1"), ...(await strangers(t)));
    await lj.status("preprod");
    await lj.bringAllBack("preprod");
    // Koios passes the first withdraw on, and doesn't answer.
    const real = t.koios.fetch;
    let left = 1;
    t.koios.fetch = async (url, init) => {
      const answer = await real(url, init);
      if (String(url).endsWith("/submittx") && left-- > 0) throw new DOMException("signal timed out", "TimeoutError");
      return answer;
    };
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    t.koios.fetch = real;
    const first = (await sealed(t)).withdrawing!.txHash;
    expect(t.koios.submitted.map((b) => txIdOf(b))).toEqual([first]);
    // The next run, a minute on: it isn't on chain yet, so the next box waits, and it's still looked for.
    await busyFor(t, 60_000);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await sealed(t)).withdrawing?.txHash).toBe(first);
    expect(t.koios.submitted).toHaveLength(1);
    // It lands: its box's way back is in the Seedelf history, and the run goes on with the next box.
    t.koios.confirmations = 1;
    await busyFor(t, 60_000);
    expect(await lj.withdrawDue("preprod")).toHaveLength(1);
    expect((await t.activity.seedelf("preprod")).map((e) => e.txHash)).toContain(first);
    expect(withdrawn(t).at(-1)).toBe(`${"f1".repeat(32)}#0`);
  });

  it(`sends for ${BRING_RUN_MS / 60_000} minutes a run at most, and the next run goes on`, async () => {
    const t = await wallet();
    const lj = pooled(t);
    const mine = await Promise.all(Array.from({ length: 5 }, (_, i) => classicBox(t, (0xa0 + i).toString(16))));
    t.koios.addedToAccounts.push(...POOL, ...mine, ...(await strangers(t)));
    await lj.status("preprod");
    await lj.bringAllBack("preprod");
    // Each withdraw takes giveme.my and Koios 50 seconds: three go in two minutes.
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => {
      if (String(url).endsWith("/submittx")) t.clock.now += 50_000;
      return real(url, init);
    };
    expect(await lj.withdrawDue("preprod")).toHaveLength(3);
    expect((await sealed(t)).bringing).toMatchObject({ back: 3, left: 2 });
    await t.wallet.touch();
    expect(await lj.withdrawDue("preprod")).toHaveLength(2);
    expect(new Set(withdrawn(t))).toEqual(new Set(mine.map((b) => `${b.tx_hash}#0`)));
  });
});
