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
import { BRING_FAILED_RUNS, LovejoinService, type PoolRef } from "../src/background/lovejoin";
import { NETWORKS } from "../src/networks";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, testBalances, vectors } from "./fakes";

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

/** Lovejoin reading the classic pool and the token pool, giveme.my's witness stood in for. */
function pooled(t: T) {
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

    // The next run finds nothing left: it's over, and Home's figures say so at once.
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
    expect((await sealed(t)).bringing).toEqual({ at: expect.any(Number), back: 0 });
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
    // Over: the token pool's figures go, the classic pool's box keeps its due time, hours away.
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
