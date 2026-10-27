// Bring every box back now's waits, 1.6.0's release review (Lane L, wlj-2). A chain of the wallet's all sent whose
// boxes aren't in their pools yet holds the run's end, those boxes keeping their due times, and the run takes them once
// a read lists them (321-lj-worker#0), as a box's own run keeps them too. What the run waits for is said in a word
// (321-lj-worker#1). A stuck pool's box comes back paid from the private balance in the same run as a classic box
// paying its own way (321-lj-worker#2). A wait for its withdraws to land that goes past BRING_LATE_MS says so
// (321-lj-worker#4). A session's collateral's mix waiting for giveme.my holds no box of any pool back
// (x-scenarios-lj#1). With the real WebAssembly, the classic pool's recorded preprod boxes, and PR #163's preprod token
// pool.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { BRING_FAILED_RUNS, BRING_LATE_MS, LANDING_MS, LovejoinService, TAIL_KEEP_MS, type LovejoinDeps, type PoolRef } from "../src/background/lovejoin";
import { pendingKey } from "../src/background/pending";
import { SPENT_KEEP_MS } from "../src/background/spent";
import { t as tr } from "../src/i18n";
import { NETWORKS } from "../src/networks";
import { doneOf } from "../src/ui/components/BringAllBack";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { busyFor, koiosPreprod, loadTestWasm, ownedUtxos, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const HOUR = 3_600_000;
const PHRASE = (vectors("cardano_account.json") as Array<{ account: number; phrase: string }>).find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
)!.phrase;
/** Somewhere a payment can go: another phrase's first receiving address. */
const ELSEWHERE = (vectors("cardano_account.json") as Array<{ account: number; phrase: string; preprod: { receive_0: string } }>).find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 15,
)!.preprod.receive_0;

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

const C1 = "c1".repeat(32);
const D0 = "d0".repeat(32);
const D1 = "d1".repeat(32);

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
      // The one-time key's signature on a withdraw the private balance pays, as giveme.my's is stood in for.
      signScriptSpend: (_key: unknown, request: string) => {
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

/** A wallet just unlocked. `owned`: the fixtures' own contract UTxOs in its private balance. */
async function wallet(owned = true): Promise<T> {
  const t = testBalances({ owned });
  await t.wallet.create(PHRASE, PASSWORD);
  t.koios.evaluation = AGREES;
  // A slot in preprod's Shelley era, for what the account signs (lovejoin-flows.test.ts).
  t.koios.tip = 110_000_000;
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
  pools?: Record<string, { due: number[] }>;
  chains: Array<{ id: string; ended?: number; landed?: true }>;
  bringing?: { at: number; back: number; left?: number; why?: string; waiting?: string; late?: true; held?: true };
  mixes?: Array<{ id: string; shares: Array<{ pool?: string; boxes: number; back?: number }> }>;
};
const sealed = async (t: T) => (await t.store.get<Sealed>("lovejoin.preprod"))!;

/**
 * A mix from the public account, deposit `d0` and mix `d1`, recorded and its deposit sent: one box, in the classic pool,
 * at `d1#0`, being sent (its progress where it waits, as cuts looks for it). `ended`: its mix sent too, and all of it
 * sent, its mix not in a block yet.
 */
async function publicMix(t: T, lj: LovejoinService, ended = true): Promise<void> {
  const txs = [
    { kind: "deposit" as const, txCbor: "", txHash: D0, fee: "0" },
    { kind: "mix" as const, txCbor: "", txHash: D1, fee: "0" },
  ];
  await lj.recordChain("preprod", { progress: "test.d0", txs, leaves: [{ txHash: D1, txIndex: 0 }], boxes: 1, account: 0 });
  await t.wallet.withKeys(() => t.session.set("test.d0", { txs: [{ txHash: D0 }, { txHash: D1 }] }));
  await lj.chainSent("preprod", D1, 0);
  if (!ended) return;
  await lj.chainSent("preprod", D1, 1);
  await lj.chainEnded("preprod", D1);
}

describe("Bring every box back now and a chain of the wallet's just sent (1.6.0's release review, 321-lj-worker#0)", SLOW, () => {
  it("waits for a chain it waited on to land once all sent, keeping its due time and Home's count, then takes its box", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, ...(await strangers(t)));
    // The user mixes one box from the public account, then presses Bring every box back now while it's sent.
    await publicMix(t, lj, false);
    expect((await sealed(t)).due).toHaveLength(1);
    await busyFor(t, 60_000);
    await lj.bringAllBack("preprod");
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await sealed(t)).bringing).toBeDefined();
    // All sent: the run after it, with its mix still in the mempool, so no read lists its box. Not over, nor saying
    // nothing was left: it waits for the box, which keeps its due time, and Home counts it.
    await lj.chainSent("preprod", D1, 1);
    await lj.chainEnded("preprod", D1);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await sealed(t)).bringing).toBeDefined();
    expect((await sealed(t)).due).toHaveLength(1);
    const held = await lj.held("preprod");
    expect(held.boxes).toBe(1);
    expect(doneOf({ back: 0 }, held)).toBeUndefined();
    expect(held.bringing).toEqual({ back: 0, waiting: "landing" });
    expect(await lj.returning("preprod")).toBe(true);
    expect(t.collateral.asked).toEqual([]);
    // In a block: listed, and taken.
    t.koios.addedToAccounts.push(await classicBox(t, "d1", 0));
    await busyFor(t, 60_000);
    expect(await lj.withdrawDue("preprod")).toHaveLength(1);
    expect(withdrawn(t)).toEqual([`${D1}#0`]);
    expect((await lj.held("preprod")).bringing).toEqual({ back: 1, left: 0 });
    // On chain: over, with it back.
    t.koios.spent.add(`${D1}#0`);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await sealed(t)).bringing).toBeUndefined();
    expect((await lj.held("preprod")).boxes).toBe(0);
  });

  it("keeps the due time of a mix sent after it was asked until that mix's box is listed, then ends with it kept", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1", 30), ...(await strangers(t)));
    await lj.status("preprod");
    await lj.bringAllBack("preprod");
    expect(await lj.withdrawDue("preprod")).toHaveLength(1);
    expect(withdrawn(t)).toEqual([`${C1}#0`]);
    // A minute on, the user mixes from the public account: all sent, its mix not in a block yet. Then c1's withdraw
    // lands.
    await busyFor(t, 60_000);
    await publicMix(t, lj);
    t.koios.spent.add(`${C1}#0`);
    expect((await sealed(t)).due).toHaveLength(1);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await sealed(t)).bringing).toBeDefined();
    expect((await sealed(t)).due).toHaveLength(1);
    // Its box in a block: over, that box keeping the wait its chain drew, hours away, and Done says the one it sent.
    t.koios.addedToAccounts.push(await classicBox(t, "d1", 0));
    await busyFor(t, 60_000);
    const before = (await sealed(t)).bringing!;
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    const after = await sealed(t);
    expect(after.bringing).toBeUndefined();
    expect(after.due).toHaveLength(1);
    expect(after.due[0]! - t.clock.now).toBeGreaterThan(HOUR);
    expect(doneOf({ back: before.back }, await lj.held("preprod"))).toBe(1);
    expect(withdrawn(t)).toEqual([`${C1}#0`]);
  });

  it(`waits no longer than ${LANDING_MS / 60_000} minutes for a chain all sent whose box never shows: a node may drop a chain's last mix`, async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, ...(await strangers(t)));
    await publicMix(t, lj);
    await busyFor(t, 60_000);
    await lj.bringAllBack("preprod");
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await sealed(t)).bringing).toMatchObject({ waiting: "landing" });
    await busyFor(t, LANDING_MS - 2 * 60_000);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await sealed(t)).bringing).toMatchObject({ waiting: "landing" });
    // Past it: over, as the pool reads, the due time with no box gone, and nothing keeps the alarm going.
    await busyFor(t, 2 * 60_000);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await sealed(t)).bringing).toBeUndefined();
    expect((await sealed(t)).due).toEqual([]);
    expect(await lj.returning("preprod")).toBe(false);
  });

  it("ends once a watch saw a Bootstrap's deposit land, though someone else's mix moved its box before any read listed it", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, ...(await strangers(t)));
    const E0 = "e0".repeat(32);
    const txs = [{ kind: "deposit" as const, txCbor: "", txHash: E0, fee: "0" }];
    await lj.recordChain("preprod", { progress: "test.e0", txs, leaves: [{ txHash: E0, txIndex: 0 }], boxes: 1, bootstrap: true, account: 0 });
    await lj.chainSent("preprod", E0, 0);
    await lj.chainEnded("preprod", E0);
    // Home's watch saw its deposit land (pending.ts depositLanded); by the first read, someone else's mix had moved it.
    await lj.landedDeposit("preprod", E0);
    t.koios.addedToAccounts.push(await classicBox(t, "f9", 30));
    await busyFor(t, 60_000);
    await lj.bringAllBack("preprod");
    expect(await lj.withdrawDue("preprod")).toHaveLength(1);
    expect(withdrawn(t)).toEqual([`${"f9".repeat(32)}#0`]);
    // On chain: over at once, nothing more on its way.
    t.koios.spent.add(`${"f9".repeat(32)}#0`);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await sealed(t)).bringing).toBeUndefined();
  });

  it("keeps a chain's due time in a box's own run while that chain lands, and sends the box due once it's in", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1", 300), ...(await strangers(t)));
    await lj.status("preprod");
    expect(await lj.withdrawDue("preprod", true)).toEqual([]);
    // c1 comes due; then a mix from the public account is all sent, its mix not in a block yet.
    await busyFor(t, 4 * HOUR);
    await publicMix(t, lj);
    expect((await sealed(t)).due).toHaveLength(2);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await sealed(t)).due).toHaveLength(2);
    expect(t.collateral.asked).toEqual([]);
    // Its box in a block: c1 goes, and the mix's box keeps its wait.
    t.koios.addedToAccounts.push(await classicBox(t, "d1", 0));
    await busyFor(t, 60_000);
    expect(await lj.withdrawDue("preprod")).toHaveLength(1);
    expect(withdrawn(t)).toEqual([`${C1}#0`]);
    const { due } = await sealed(t);
    expect(due).toHaveLength(1);
    expect(due[0]! - t.clock.now).toBeGreaterThan(HOUR);
  });
});

describe("what Bring every box back now waits for, said (1.6.0's release review, 321-lj-worker#1)", SLOW, () => {
  it("says it waits for Mix my boxes again, then a chain being sent, in place of an older run's reason, and nothing once it goes", async () => {
    const t = await wallet();
    let again = false;
    const lj = pooled(t, { mixingAgain: async () => again });
    // Moved long before the mix sent below, so never taken for its box (madeSince).
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1", 30), ...(await strangers(t)));
    await lj.status("preprod");
    await lj.bringAllBack("preprod");
    // giveme.my doesn't answer: the run says why.
    t.collateral.answer = { status: 503, body: { error: "busy" } };
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await lj.held("preprod")).bringing).toMatchObject({ back: 0, left: 1, why: expect.any(String) });
    // Mix my boxes again runs: what it waits for now, said in place of that reason.
    again = true;
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await lj.held("preprod")).bringing).toEqual({ back: 0, left: 1, waiting: "again" });
    // Then a chain being sent, a mix from the public account a minute on.
    again = false;
    await busyFor(t, 60_000);
    await publicMix(t, lj, false);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await lj.held("preprod")).bringing).toEqual({ back: 0, left: 1, waiting: "chain" });
    // All sent, and its box in a block: the run takes what was there, and says no wait.
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    await lj.chainSent("preprod", D1, 1);
    await lj.chainEnded("preprod", D1);
    t.koios.addedToAccounts.push(await classicBox(t, "d1", 0));
    expect(await lj.withdrawDue("preprod")).toHaveLength(1);
    expect(t.koios.submitted.map((tx) => txInputs(tx))).toEqual([[`${C1}#0`]]);
    expect((await lj.held("preprod")).bringing).toEqual({ back: 1, left: 0 });
  });

  it("says it waits for a withdraw Koios didn't answer, looked for first", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1"), await tokenBox(t, "f1"), ...(await strangers(t)));
    await lj.status("preprod");
    await lj.bringAllBack("preprod");
    const real = t.koios.fetch;
    let left = 1;
    t.koios.fetch = async (url, init) => {
      const answer = await real(url, init);
      if (String(url).endsWith("/submittx") && left-- > 0) throw new DOMException("signal timed out", "TimeoutError");
      return answer;
    };
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    t.koios.fetch = real;
    await busyFor(t, 60_000);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await lj.held("preprod")).bringing).toEqual({ back: 0, left: 2, waiting: "withdraw" });
  });

  it("says it waits for a payment that may still go through, rather than end the run with an error", async () => {
    const t = await wallet();
    const lj = pooled(t);
    const [first] = Object.values(koiosPreprod.accounts)[0]!.account_utxos.filter((u) => BigInt(u.value) > 1_000_000_000n);
    const keyHash = await t.wallet.withKeys((keys) => keys.cardano.paymentKeyHash(0, 0));
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1"), ...(await strangers(t)), {
      ...first!,
      tx_hash: "e6".repeat(32),
      tx_index: 0,
      value: "30000000",
      payment_cred: keyHash,
      asset_list: [],
    });
    await lj.status("preprod");
    // A payment Koios doesn't answer: it may still go through.
    const payment = await t.send.build("preprod", [{ to: ELSEWHERE, lovelace: "2000000", tokens: [] }]);
    const fetch = t.koios.fetch;
    t.koios.fetch = async (url, init) => {
      const answer = await fetch(url, init);
      if (!String(url).endsWith("/submittx")) return answer;
      t.koios.fetch = fetch;
      throw new DOMException("signal timed out", "TimeoutError");
    };
    expect(await t.send.submit("preprod", payment.txHash)).toMatchObject({ maybeSent: true });
    expect(await t.wallet.withKeys(() => t.session.get(pendingKey("preprod")))).toBeDefined();
    await lj.bringAllBack("preprod");
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await lj.held("preprod")).bringing).toEqual({ back: 0, waiting: "payment" });
    expect(t.collateral.asked).toEqual([]);
  });
});

describe("Bring every box back now in a pool whose boxes can't pay their own way back (1.6.0's release review, 321-lj-worker#2)", SLOW, () => {
  it("brings that pool's box back paid from the private balance, and the classic pool's paying its own way, in one run", async () => {
    // None of the fixture's own contract UTxOs: the private balance holds what the test gives it.
    const t = await wallet(false);
    // A byte dearer than preprod's: a 2 ₳ LJTEST box still meets its minimum, but can't pay its own way back.
    t.koios.params = { coins_per_utxo_size: "4800" };
    const lj = pooled(t);
    // Two UTxOs of ADA alone in the private balance: enough to pay for both boxes, were both paid so.
    const privately = async (tx: string, value: string) =>
      ({ ...ownedUtxos[0]!, tx_hash: tx.repeat(32), tx_index: 0, value, inline_datum: { bytes: await datum(t, true), value: {} }, asset_list: [] }) as KoiosUtxo;
    t.koios.added.push(await privately("a9", "50000000"), await privately("a8", "30000000"));
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1"), await tokenBox(t, "f1"), ...(await strangers(t)));
    await lj.status("preprod");
    await lj.bringAllBack("preprod");
    expect(await lj.withdrawDue("preprod")).toHaveLength(2);
    const [classic, token] = t.koios.submitted.map((tx) => txInputs(tx).sort());
    // The classic pool's first, its box alone: it pays its own way back, tying nothing to it.
    expect(classic).toEqual([`${C1}#0`]);
    // The stuck pool's box beside the smallest UTxO of the private balance that pays for its way back.
    expect(token).toEqual([`${"a8".repeat(32)}#0`, `${"f1".repeat(32)}#0`].sort());
    expect((await sealed(t)).bringing).toMatchObject({ back: 2, left: 0 });
    expect((await sealed(t)).bringing?.why).toBeUndefined();
  });
});

describe("Bring every box back now waiting for its withdraws to land (1.6.0's release review, 321-lj-worker#4)", SLOW, () => {
  it(`says it's late once a withdraw it sent isn't in a block ${BRING_LATE_MS / 60_000} minutes on, and Stop still stops it`, async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1"), ...(await strangers(t)));
    await lj.status("preprod");
    await lj.bringAllBack("preprod");
    expect(await lj.withdrawDue("preprod")).toHaveLength(1);
    // A node drops it: its box stays listed, and the wallet holds it as spent (spent.ts) for two hours.
    await busyFor(t, 60_000);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await lj.held("preprod")).bringing).toEqual({ back: 1, left: 0, confirming: 1 });
    await busyFor(t, BRING_LATE_MS - 60_000 - 1);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await lj.held("preprod")).bringing?.late).toBeUndefined();
    await busyFor(t, 1);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await lj.held("preprod")).bringing).toEqual({ back: 1, left: 0, confirming: 1, late: true });
    expect(await lj.returning("preprod")).toBe(true);
    // The page offers Stop then: the worker takes it, as it always does.
    await lj.stopBringingAllBack("preprod");
    expect((await lj.held("preprod")).bringing).toBeUndefined();
  });

  it("is late no longer once the late withdraw is in, while a later one isn't yet", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1"), ...(await strangers(t)));
    await lj.status("preprod");
    await lj.bringAllBack("preprod");
    expect(await lj.withdrawDue("preprod")).toHaveLength(1);
    // A box a lagging listing hadn't shown, there since before it was asked, is taken a run later.
    await busyFor(t, BRING_LATE_MS - 60_000);
    t.koios.addedToAccounts.push(await classicBox(t, "c2", 60));
    expect(await lj.withdrawDue("preprod")).toHaveLength(1);
    await busyFor(t, 60_000);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await lj.held("preprod")).bringing).toEqual({ back: 2, left: 0, confirming: 2, late: true });
    // c1's lands: c2's, sent a minute after, isn't late.
    t.koios.spent.add(`${C1}#0`);
    await busyFor(t, 60_000);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await lj.held("preprod")).bringing).toEqual({ back: 2, left: 0, confirming: 1 });
  });
});

describe("a session's collateral's mix waiting for giveme.my (1.6.0's release review, x-scenarios-lj#1)", SLOW, () => {
  const R0 = "f0".repeat(32);
  const T0 = "e0".repeat(32);
  const T1 = "e1".repeat(32);

  /**
   * Session 0's return through Lovejoin, recorded and sent up to its collateral's mix: its deposit `d0` and mix `d1`
   * (one box, at `d1#0` in the classic pool), its collateral's deposit `e0` (its box at `e0#0`, in the token pool here),
   * all in, and its collateral's mix `e1` waiting for giveme.my's signature (Tail `landed`, as witnessTail sets it), then
   * its return `f0`. Its reservation holds the collateral's box and the two boxes its mix drew.
   */
  async function waitingTail(t: T, lj: LovejoinService): Promise<void> {
    const txs = [
      { kind: "deposit" as const, txCbor: "", txHash: D0, fee: "0" },
      { kind: "mix" as const, txCbor: "", txHash: D1, fee: "0" },
      { kind: "deposit" as const, txCbor: "", txHash: T0, fee: "0", tail: true as const },
      { kind: "mix" as const, txCbor: "", txHash: T1, fee: "0", tail: true as const, giveme: true as const },
      { kind: "back" as const, txCbor: "", txHash: R0, fee: "0" },
    ];
    await lj.recordChain("preprod", {
      session: 0,
      progress: "test.f0",
      txs,
      leaves: [{ txHash: D1, txIndex: 0 }],
      boxes: 1,
      tail: { pool: TOKEN, box: { txHash: T0, txIndex: 0 }, leaf: { txHash: T1, txIndex: 0 } },
    });
    await t.wallet.withKeys(async () => {
      await t.session.set("test.f0", { txs: txs.map(({ txHash }) => ({ txHash })) });
      await t.session.set("seedelf.reserved.preprod", {
        "session.0": { inputs: [`${T0}#0`, `${"60".repeat(32)}#0`, `${"61".repeat(32)}#0`], collateral: [] },
      });
    });
    for (const i of [0, 1, 2]) await lj.chainSent("preprod", R0, i);
    await lj.tailLanded("preprod", R0);
  }

  it("sends a box due meanwhile, its chain still being sent for the lock countdown and Remove wallet", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "d1", 300), await tokenBox(t, "e0", true, 300), ...(await strangers(t)));
    await waitingTail(t, lj);
    await lj.status("preprod");
    expect(await lj.withdrawDue("preprod", true)).toEqual([]);
    // Its box's wait is over, and giveme.my is still busy for its collateral's mix.
    await busyFor(t, 4 * HOUR);
    expect(await lj.withdrawDue("preprod")).toHaveLength(1);
    expect(withdrawn(t)).toEqual([`${D1}#0`]);
    expect(await lj.chainsSending("preprod")).toBe(true);
    // Its collateral's mix goes: the chain mixes again, and the withdraws wait for it, as for any chain being sent.
    await lj.chainSent("preprod", R0, 3);
    await expect(lj.withdrawNow("preprod")).rejects.toThrow(tr("lj.chainSending"));
  });

  it("brings one back now meanwhile, and Bring every box back now takes the rest, saying the collateral's box waits for its mix", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "d1", 300), await classicBox(t, "c1", 300), await tokenBox(t, "e0", true, 300), ...(await strangers(t)));
    await waitingTail(t, lj);
    await lj.status("preprod");
    expect((await lj.withdrawNow("preprod", { txHash: C1, txIndex: 0 })).kind).toBe("lovejoin-withdraw");
    // Not the collateral's box, which its mix will spend.
    await expect(lj.withdrawNow("preprod", { txHash: T0, txIndex: 0, pool: TOKEN }, true)).rejects.toThrow(tr("lj.boxReserved"));
    await busyFor(t, 60_000);
    await lj.bringAllBack("preprod");
    expect(await lj.withdrawDue("preprod")).toHaveLength(1);
    expect(withdrawn(t)).toEqual([`${C1}#0`, `${D1}#0`]);
    // What's left is the collateral's box: said so, in place of a kept review's hold, while it waits, a day at most.
    await busyFor(t, 60_000);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await lj.held("preprod")).bringing).toEqual({ back: 1, left: 1, waiting: "collateral" });
    expect(await lj.returning("preprod")).toBe(true);
  });

  // Its transactions before the collateral's mix are in a block, as tx_status said (witnessTail), while the pool's
  // listing, another of Koios's backends, doesn't show their boxes yet: such a chain is taken to be landing, as one all
  // sent is, LANDING_MS at most (1.6.0's release review, R3-6).
  it("waits for its boxes while the listing lags, never saying nothing was left, and takes them once listed (R3-6)", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, ...(await strangers(t)));
    await waitingTail(t, lj);
    await busyFor(t, 60_000);
    await lj.bringAllBack("preprod");
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await sealed(t)).bringing).toMatchObject({ waiting: "landing" });
    expect((await sealed(t)).due).toHaveLength(1);
    expect(doneOf({ back: 0 }, await lj.held("preprod"))).toBeUndefined();
    // Listed: the run takes the chain's box, the collateral's left to its mix.
    t.koios.addedToAccounts.push(await classicBox(t, "d1", 0), await tokenBox(t, "e0", true, 0));
    await busyFor(t, 60_000);
    expect(await lj.withdrawDue("preprod")).toHaveLength(1);
    expect(withdrawn(t)).toEqual([`${D1}#0`]);
  });

  it("keeps its boxes' due times in a box's own run while they may be landing, and sends the box due after (R3-6)", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1", 300), ...(await strangers(t)));
    await lj.status("preprod");
    expect(await lj.withdrawDue("preprod", true)).toEqual([]);
    // c1 comes due; then the return waits at its collateral's mix, its boxes not listed yet.
    await busyFor(t, 4 * HOUR);
    await waitingTail(t, lj);
    expect((await sealed(t)).due).toHaveLength(2);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await sealed(t)).due).toHaveLength(2);
    expect(t.collateral.asked).toEqual([]);
    // Listed, and LANDING_MS on: c1 goes, and the chain's box keeps its wait.
    t.koios.addedToAccounts.push(await classicBox(t, "d1", 0), await tokenBox(t, "e0", true, 0));
    await busyFor(t, LANDING_MS);
    expect(await lj.withdrawDue("preprod")).toHaveLength(1);
    expect(withdrawn(t)).toEqual([`${C1}#0`]);
    const { due } = await sealed(t);
    expect(due).toHaveLength(1);
    expect(due[0]! - t.clock.now).toBeGreaterThan(HOUR);
  });

  // A lock cut that chain at its collateral's mix: its return may build the mix again, with fresh boxes (tailOf). The run
  // leaves the box to it, as it does while the mix waits, a day at most, rather than bring it back unmixed, which ties
  // the session's tail deposit to the private balance (private by default; 1.6.0's release review, the review's
  // questions).
  it("leaves the collateral's box to its mix once a lock cut its chain, while its return may build that mix again, a day at most", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "d1", 300), await tokenBox(t, "e0", true, 300), ...(await strangers(t)));
    await waitingTail(t, lj);
    // The lock wipes where the chain waits and what it reserved.
    await t.wallet.withKeys(async () => {
      await t.session.remove("test.f0");
      await t.session.remove("seedelf.reserved.preprod");
    });
    await busyFor(t, 60_000);
    await lj.bringAllBack("preprod");
    expect(await lj.withdrawDue("preprod")).toHaveLength(1);
    expect(withdrawn(t)).toEqual([`${D1}#0`]);
    await busyFor(t, 60_000);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await lj.held("preprod")).bringing).toEqual({ back: 1, left: 1, waiting: "collateral" });
    expect(await lj.tailOf("preprod", 0)).toMatchObject({ id: R0 });
    // A day after its deposit went in, that mix is never built again: the run brings the box back, not mixed.
    const kept = (await t.store.get<{ chains: Array<{ tail?: { landed?: number } }> }>("lovejoin.preprod"))!;
    kept.chains.at(-1)!.tail!.landed! -= TAIL_KEEP_MS;
    await t.store.set("lovejoin.preprod", kept);
    await busyFor(t, 60_000);
    expect(await lj.withdrawDue("preprod")).toHaveLength(1);
    expect(withdrawn(t)).toEqual([`${D1}#0`, `${T0}#0`]);
  });
});

// Two slips wlj-2 found and left, both since a withdraw a node drops leaves its box listed, held as spent for
// SPENT_KEEP_MS (spent.ts), then free: the run takes it again. That counted it back a second time, Settings' count and
// the list of mixes both, and took a second due time for it, another box's. And after Stop, offered once the run is late,
// the box came back with no due time, so nothing brought it back until a read gave it one. The box is free once the
// clock has moved SPENT_KEEP_MS on: the pool's listing reads the spent marks on the wallet's own clock, as they're
// written (1.6.0's release review, L4).
describe("a withdraw of Bring every box back now that a node dropped (1.6.0's release review, wlj-2's notes)", SLOW, () => {
  const A1 = "a1".repeat(32);
  const C2 = "c2".repeat(32);

  /** Chain `id` of the wallet's in the classic pool, recorded and sent whole: its deposit, and its mix, which made its one box at `id#0`. */
  async function mixedOnce(lj: LovejoinService, id: string, delay?: "6-24"): Promise<void> {
    const txs = [
      { kind: "deposit" as const, txCbor: "", txHash: `${id}0`.padEnd(64, "0"), fee: "0" },
      { kind: "mix" as const, txCbor: "", txHash: id.repeat(32), fee: "0" },
    ];
    await lj.recordChain("preprod", { progress: `test.${id}`, txs, leaves: [{ txHash: id.repeat(32), txIndex: 0 }], boxes: 1, account: 0, ...(delay ? { delay } : {}) });
    for (const i of txs.keys()) await lj.chainSent("preprod", txs.at(-1)!.txHash, i);
    await lj.chainEnded("preprod", txs.at(-1)!.txHash);
  }

  /** The wallet's box a1 from its mix, the run asked for, then mix c2 sent since, whose box keeps its wait (6 to 24 hours). */
  async function asked(t: T, lj: LovejoinService): Promise<void> {
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "a1", 60), ...(await strangers(t)));
    await mixedOnce(lj, "a1");
    await busyFor(t, 60_000);
    await lj.bringAllBack("preprod");
    await busyFor(t, 60_000);
    t.koios.addedToAccounts.push(await classicBox(t, "c2", 0));
    await mixedOnce(lj, "c2", "6-24");
    expect(await lj.withdrawDue("preprod")).toHaveLength(1);
    expect(withdrawn(t)).toEqual([`${A1}#0`]);
    expect((await sealed(t)).mixes).toEqual([expect.objectContaining({ id: C2, shares: [{ boxes: 1 }] })]);
    expect((await sealed(t)).due).toHaveLength(1);
  }

  it("counts a box it takes again back once, and takes no second due time for it", async () => {
    const t = await wallet();
    const lj = pooled(t);
    await asked(t, lj);
    // A node drops it: a1 stays listed, held as spent for two hours, then free, and the run takes it again.
    await busyFor(t, 60_000);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    await busyFor(t, SPENT_KEEP_MS);
    expect(await lj.withdrawDue("preprod")).toHaveLength(1);
    expect(withdrawn(t)).toEqual([`${A1}#0`, `${A1}#0`]);
    // One box back, as Settings says it; c2's mix still open, its box still out; and c2's box keeps its due time.
    expect((await lj.held("preprod")).bringing).toMatchObject({ back: 1 });
    expect((await sealed(t)).mixes).toEqual([expect.objectContaining({ id: C2, shares: [{ boxes: 1 }] })]);
    expect((await sealed(t)).due).toHaveLength(1);
    // On chain at last: a read no longer lists it, and the record of it counted goes.
    const counted = async () => ((await sealed(t)) as { counted?: Record<string, unknown> }).counted;
    expect(Object.keys((await counted()) ?? {})).toEqual([`${A1}#0`]);
    t.koios.spent.add(`${A1}#0`);
    await lj.status("preprod");
    expect(await counted()).toBeUndefined();
  });

  it("gives the box its due time back after Stop, once it's free, and it comes back by itself, counted back once", async () => {
    const t = await wallet();
    const lj = pooled(t);
    await asked(t, lj);
    // A node drops it; the run is late, and the page offers Stop.
    await busyFor(t, BRING_LATE_MS);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await lj.held("preprod")).bringing).toMatchObject({ late: true });
    await lj.stopBringingAllBack("preprod");
    expect(await lj.returning("preprod")).toBe(true);
    // Free two hours after its withdraw: a read then finds it, with no due time, and gives it one, as any box found.
    await busyFor(t, SPENT_KEEP_MS);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await sealed(t)).due).toHaveLength(2);
    // It comes back by itself at its time, counted back once: c2's mix stays open, its box still out.
    for (let i = 0; i < 12 && withdrawn(t).length < 2; i++) {
      await busyFor(t, HOUR);
      await lj.withdrawDue("preprod");
    }
    expect(withdrawn(t)).toEqual([`${A1}#0`, `${A1}#0`]);
    expect((await sealed(t)).mixes).toEqual([expect.objectContaining({ id: C2, shares: [{ boxes: 1 }] })]);
  });

  it("gives the box its due time back once the run stopped itself too, as Stop does", async () => {
    const t = await wallet();
    const lj = pooled(t);
    await asked(t, lj);
    // A node drops it, and the pools can't be read: run after run sends nothing, and it stops, saying why.
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) =>
      new URL(String(url)).pathname.endsWith("/credential_utxos") ? new Response("down", { status: 500 }) : real(url, init);
    for (let i = 0; i < BRING_FAILED_RUNS; i++) {
      await busyFor(t, 60_000);
      expect(await lj.withdrawDue("preprod")).toEqual([]);
    }
    t.koios.fetch = real;
    expect((await lj.held("preprod")).bringing).toMatchObject({ back: 1, stopped: expect.any(String) });
    await busyFor(t, SPENT_KEEP_MS);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
    expect((await sealed(t)).due).toHaveLength(2);
  });
});

// Round 3b, L2: Stop deleted the run's record as its end does, so every page that saw it go, but the one that pressed
// Stop, said Done. The worker marks the stop, with how many it sent, sealed, until it's asked again (Schedule
// `bringStopped`), and the page says Stopped (tests/lovejoin-bring-screen-review-fixes.test.ts).
describe("Bring every box back now stopped by Stop (1.6.0's release review, L2)", SLOW, () => {
  it("marks the stop with how many it sent and its pool, kept sealed through a restart, until it's asked again", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1", 60), await classicBox(t, "c2", 60), ...(await strangers(t)));
    await lj.status("preprod");
    await lj.bringAllBack("preprod", "classic");
    expect(await lj.withdrawDue("preprod")).toHaveLength(2);
    await lj.stopBringingAllBack("preprod");
    expect((await lj.held("preprod")).bringing).toBeUndefined();
    expect((await lj.held("preprod")).bringStopped).toEqual({ back: 2, pool: "classic" });
    // A worker started afresh reads it from the sealed record.
    expect((await pooled(t).held("preprod")).bringStopped).toEqual({ back: 2, pool: "classic" });
    // Asked again: the stop is said no more.
    await lj.bringAllBack("preprod");
    expect((await lj.held("preprod")).bringStopped).toBeUndefined();
    expect((await lj.held("preprod")).bringing).toMatchObject({ back: 0 });
  });

  it("marks no stop for a run that stopped by itself, whose stop Settings says already", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, "c1", 60), ...(await strangers(t)));
    await lj.bringAllBack("preprod");
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) =>
      new URL(String(url)).pathname.endsWith("/credential_utxos") ? new Response("down", { status: 500 }) : real(url, init);
    for (let i = 0; i < BRING_FAILED_RUNS; i++) {
      await busyFor(t, 60_000);
      expect(await lj.withdrawDue("preprod")).toEqual([]);
    }
    t.koios.fetch = real;
    expect((await lj.held("preprod")).bringing).toMatchObject({ back: 0, stopped: expect.any(String) });
    await lj.stopBringingAllBack("preprod");
    expect((await lj.held("preprod")).bringing).toBeUndefined();
    expect((await lj.held("preprod")).bringStopped).toBeUndefined();
  });
});
