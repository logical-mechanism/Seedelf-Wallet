// 1.6.0's release review, which mix a box back is counted against, and what its way back ties. Two Bootstraps in one
// pool: a box brought back by hand counts against the Bootstrap that held it, never the oldest by age, whose own boxes
// would stop being held and come back by themselves, unmixed (316#0). A public deposit's box keeps its tie to the
// account once its chain's record and its mix are gone (316#1). A chain with no box of its own, a return's collateral
// mixed on its way into the 5 ₳ pool, is followed as a mix of its own (316#3). And a stuck pool's Bring one back paid
// from the private balance ties no other account where it can (x-privacy#0). With the real WebAssembly, the classic
// pool's recorded preprod boxes, and PR #163's preprod token pool (2 ₳ and LJTEST a box).
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { BRING_RUN_MS, LovejoinService, type PoolRef } from "../src/background/lovejoin";
import { LOCAL_LOVEJOIN_POOLS_PREFIX, PoolDiscovery, serviceDeps, type FoundPool } from "../src/background/lovejoin-pools";
import { IndexDown, type PrivateIndex } from "../src/background/private-index";
import { SESSION_SPENT, SPENT_KEEP_MS } from "../src/background/spent";
import { SESSION_UNLOCKED_AT } from "../src/background/wallet";
import { boxFrom, madePrivate, merged, type HistoryClass } from "../src/shared/histories";
import { heldRequest } from "../src/ui/screens/Lovejoin";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { busyFor, koiosPreprod, loadTestWasm, madeByMix, memoryArea, ownedUtxos, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const HOUR = 3_600_000;
const PHRASE = (vectors("cardano_account.json") as Array<{ account: number; phrase: string }>).find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
)!.phrase;

/** Real withdraws are built and measured in WebAssembly: seconds each, more on CI. */
const SLOW = { timeout: 120_000 };

/** 20 boxes from Lovejoin's preprod pool, as Koios lists them (2026-09-25). */
const POOL = (JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }).pool;

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
const TOKEN_ADDRESS = bech32("addr_test", Uint8Array.from([0x70, ...Buffer.from(VIEW.mixBoxHash, "hex")]));

/** Ogmios's answer when the network measures no more than a transaction declares. */
const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };

type T = ReturnType<typeof testBalances>;

type Deps = ConstructorParameters<typeof LovejoinService>[0];

/** Lovejoin reading the classic pool and `pools` (the token pool), giveme.my's witness stood in for; `extra`, a test's own. */
function pooled(t: T, pools: PoolRef[] = [TOKEN_POOL], extra: Partial<Deps> = {}): LovejoinService {
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
    pools: async () => pools,
    random: () => 0.5,
    ...extra,
  });
}

async function wallet(): Promise<T> {
  const t = testBalances();
  await t.wallet.create(PHRASE, PASSWORD);
  t.koios.evaluation = AGREES;
  t.koios.tip = 110_000_000;
  return t;
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

/** A box in the token pool, the wallet's or a stranger's, made `hours` ago: by a mix there, as Koios would say. */
async function tokenBox(t: T, tx: string, ours = true, hours = 5, index = 0): Promise<KoiosUtxo> {
  t.koios.txSpends.set(tx.repeat(32), [{ payment_addr: { bech32: TOKEN_ADDRESS, cred: VIEW.mixBoxHash } }]);
  return {
    ...POOL[0]!,
    tx_hash: tx.repeat(32),
    tx_index: index,
    address: TOKEN_ADDRESS,
    payment_cred: VIEW.mixBoxHash,
    value: "2000000",
    block_time: Math.floor(t.clock.now / 1000) - hours * 3600,
    datum_hash: null,
    inline_datum: { bytes: await datum(t, ours), value: {} },
    asset_list: [{ policy_id: VIEW.token.policyId, asset_name: VIEW.token.assetName, quantity: VIEW.token.quantity, decimals: 0, fingerprint: "asset1ljtest" } as never],
  } as KoiosUtxo;
}

/** `count` boxes of the wallet's where deposit `tx` put them in the token pool, `hours` ago: a deposit made them. */
async function depositBoxes(t: T, tx: string, count: number, hours = 7): Promise<KoiosUtxo[]> {
  const boxes = await Promise.all(Array.from({ length: count }, (_, i) => tokenBox(t, tx, true, hours, i)));
  t.koios.txSpends.delete(tx.repeat(32));
  return boxes;
}

/** Twelve strangers' boxes in the token pool. */
const strangers = (t: T) => Promise.all(Array.from({ length: 12 }, (_, i) => tokenBox(t, (0x60 + i).toString(16), false)));

type Sealed = {
  due: number[];
  pools?: Record<string, { due: number[] }>;
  chains: Array<{ id: string }>;
  leaves?: Record<string, string>;
  origins?: Record<string, { mixed: boolean; public?: true; account?: number }>;
  mixes?: Array<{ id: string; session?: number; bootstrap?: true; released?: true; shares: Array<{ pool?: string; boxes: number; back?: number; moved?: number }> }>;
};
const sealed = async (t: T) => (await t.store.get<Sealed>("lovejoin.preprod"))!;

/** Each open mix's id and shares, oldest first, as the record keeps them. */
const shares = async (t: T) => ((await sealed(t)).mixes ?? []).map((e) => [e.id, e.shares]);

/** The private history's entry for `txHash`. */
const historyOf = async (t: T, txHash: string) =>
  (await t.store.get<{ entries: Array<{ txHash: string; origin?: { id: string; origin: string } }> }>("history.preprod"))!.entries.find(
    (e) => e.txHash === txHash,
  );

/** What the withdraws giveme.my was asked about spend. */
const withdrawn = (t: T) => t.collateral.asked.flatMap((tx) => txInputs(Uint8Array.from(Buffer.from(tx, "hex"))));

/** The wallet unlocked an hour ago, that unlock's draws made: a run then reads the pool as the alarm's does. */
async function unlockedAnHourAgo(t: T): Promise<void> {
  const at = t.clock.now - HOUR;
  await t.wallet.withKeys(() => t.session.set(SESSION_UNLOCKED_AT, at));
  const kept = await t.store.get<object>("lovejoin.preprod");
  if (kept) await t.store.set("lovejoin.preprod", { ...kept, unlock: at });
}

/** `hours` on, unlocked again, with the alarm's run after a pool read: what comes back by itself does, and lands. */
async function later(t: T, lj: LovejoinService, hours: number): Promise<void> {
  t.clock.now += hours * HOUR;
  await t.wallet.unlock(PASSWORD);
  await unlockedAnHourAgo(t);
  await lj.status("preprod");
  await lj.withdrawDue("preprod");
  land(t);
}

/** Every withdraw sent is on chain: its box is no longer listed. */
function land(t: T): void {
  const spent = new Set(withdrawn(t));
  t.koios.addedToAccounts = t.koios.addedToAccounts.filter((u) => !spent.has(`${u.tx_hash}#${u.tx_index}`));
}

/** A Bootstrap from public account `account` recorded and all sent: `boxes` in the token pool at `deposit`. */
async function bootstrapped(lj: LovejoinService, deposit: string, boxes: number, account = 0): Promise<void> {
  const leaves = Array.from({ length: boxes }, (_, i) => ({ txHash: deposit, txIndex: i, pool: TOKEN }));
  await lj.recordChain("preprod", {
    progress: `test.${deposit.slice(0, 4)}`,
    txs: [{ kind: "deposit", txCbor: "", txHash: deposit, fee: "0" }],
    leaves,
    boxes,
    pools: { [TOKEN]: boxes },
    bootstrap: true,
    account,
  });
  await lj.chainSent("preprod", deposit, 0);
  await lj.chainEnded("preprod", deposit);
}

/** Bring one back on the pool's page, as the page picks the box (heldRequest), and the withdraw landing. */
async function bringOneBack(t: T, lj: LovejoinService): Promise<{ box: { txHash: string; txIndex: number }; txHash: string }> {
  const request = heldRequest((await lj.status("preprod")).pools![0]!);
  expect(request, "a box the page offers to bring back").toBeDefined();
  const { box } = request!;
  const pending = await lj.withdrawNow("preprod", box);
  t.koios.addedToAccounts = t.koios.addedToAccounts.filter((u) => !(u.tx_hash === box.txHash && u.tx_index === box.txIndex));
  return { box, txHash: pending.txHash };
}

const at = (tx: string, i: number) => ({ txHash: tx, txIndex: i, pool: TOKEN });

/** One of the recorded account's UTxOs, made again as `tx`'s with `value`. */
function atAccount(tx: string, value: string): KoiosUtxo {
  const [first] = Object.values(koiosPreprod.accounts)[0]!.account_utxos.filter((u) => BigInt(u.value) > 1_000_000_000n);
  return { ...first!, tx_hash: tx.repeat(32), tx_index: 0, value, asset_list: [] };
}

/** A box of the wallet's in the classic pool at `tx`#`index`, made `hours` ago. */
async function classicBox(t: T, tx: string, index: number, hours: number): Promise<KoiosUtxo> {
  return { ...POOL[0]!, tx_hash: tx, tx_index: index, block_time: Math.floor(t.clock.now / 1000) - hours * 3600, inline_datum: { bytes: await datum(t, true), value: {} } } as KoiosUtxo;
}

/** Runs `hours` apart until `count` boxes came back by themselves, or twenty runs. */
async function untilBack(t: T, lj: LovejoinService, count: number, hours = 3): Promise<void> {
  for (let run = 0; run < 20 && withdrawn(t).length < count; run++) await later(t, lj, hours);
  expect(withdrawn(t)).toHaveLength(count);
}

/** The private history's origin for the withdraw that spent `box`, among those sent. */
async function originOf(t: T, box: string) {
  const tx = t.koios.submitted.find((bytes) => txInputs(bytes).includes(box));
  expect(tx, `a withdraw of ${box}`).toBeDefined();
  const hash = txIdOf(tx!);
  return { hash, origin: (await historyOf(t, hash))?.origin };
}

describe("two Bootstraps in one pool (1.6.0's release review, 316#0)", SLOW, () => {
  const [b1, b2] = ["b1".repeat(32), "b2".repeat(32)];

  it("counts a box brought back by hand against the Bootstrap whose deposit put it there: the older one keeps holding its own", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, ...(await depositBoxes(t, "b1", 2)), ...(await depositBoxes(t, "b2", 2)), ...(await strangers(t)));
    await bootstrapped(lj, b1, 2);
    t.clock.now += 60_000;
    await bootstrapped(lj, b2, 2);
    expect((await lj.status("preprod")).pools![0]!.bootstrap).toEqual([at(b1, 0), at(b1, 1), at(b2, 0), at(b2, 1)]);
    // Hours on, both chains' records gone: the page brings back the box listed last, twice, B2's both times.
    t.clock.now += 24 * HOUR;
    await t.wallet.unlock(PASSWORD);
    const first = await bringOneBack(t, lj);
    const second = await bringOneBack(t, lj);
    expect([first.box, second.box]).toEqual([at(b2, 1), at(b2, 0)]);
    // Each from where B2's public deposit put it: tied to the account.
    for (const { txHash } of [first, second]) expect((await historyOf(t, txHash))?.origin).toEqual({ id: `box:${txHash}+public:0`, origin: "own" });
    // B2's mix is over; B1 still has both its boxes out, and holds them.
    expect(await shares(t)).toEqual([[b1, [{ pool: TOKEN, boxes: 2 }]]]);
    const status = await lj.status("preprod");
    expect(status.pools![0]!.bootstrap).toEqual([at(b1, 0), at(b1, 1)]);
    expect(status.pools![0]!.due).toEqual([]);
    expect((await lj.held("preprod")).pools).toEqual([expect.objectContaining({ id: TOKEN, boxes: 0, bootstrap: 2 })]);
    // And neither comes back by itself.
    await later(t, lj, 10);
    await later(t, lj, 24);
    expect(withdrawn(t)).toEqual([`${b2}#1`, `${b2}#0`]);
  });

  it("counts a box someone else's mix moved against the Bootstrap it was moved from, not the oldest", async () => {
    const t = await wallet();
    const lj = pooled(t);
    // B2's second box was moved by a stranger's mix: the wallet's box at that mix's output now.
    const [b2box] = await depositBoxes(t, "b2", 1);
    const moved = await tokenBox(t, "f9", true, 7);
    t.koios.addedToAccounts.push(...POOL, ...(await depositBoxes(t, "b1", 2)), b2box!, moved, ...(await strangers(t)));
    await bootstrapped(lj, b1, 2);
    t.clock.now += 60_000;
    await bootstrapped(lj, b2, 2);
    expect((await lj.status("preprod")).pools![0]!.bootstrap).toEqual([at(b1, 0), at(b1, 1), at(b2, 0), at("f9".repeat(32), 0)]);
    t.clock.now += 24 * HOUR;
    await t.wallet.unlock(PASSWORD);
    // The moved box first (listed last), then B2's own, then one of B1's.
    const picks = [];
    for (let i = 0; i < 3; i++) picks.push((await bringOneBack(t, lj)).box);
    expect(picks).toEqual([at("f9".repeat(32), 0), at(b2, 0), at(b1, 1)]);
    // B1 has one box out, still where its deposit put it, and holds it.
    expect(await shares(t)).toEqual([[b1, [{ pool: TOKEN, boxes: 2, back: 1 }]]]);
    expect((await lj.status("preprod")).pools![0]!.bootstrap).toEqual([at(b1, 0)]);
    await later(t, lj, 10);
    await later(t, lj, 24);
    expect(withdrawn(t)).not.toContain(`${b1}#0`);
  });

  it("counts each box Bring every box back now takes against the Bootstrap that held it, though the run stops partway", async () => {
    const t = await wallet();
    const lj = pooled(t);
    // B2's second box was moved by a stranger's mix, and is listed first: the run takes it first.
    const moved = await tokenBox(t, "f9", true, 7);
    const [b2box] = await depositBoxes(t, "b2", 1);
    t.koios.addedToAccounts.push(...POOL, moved, ...(await depositBoxes(t, "b1", 2)), b2box!, ...(await strangers(t)));
    await bootstrapped(lj, b1, 2);
    t.clock.now += 60_000;
    await bootstrapped(lj, b2, 2);
    await lj.status("preprod");
    t.clock.now += 24 * HOUR;
    await t.wallet.unlock(PASSWORD);
    await unlockedAnHourAgo(t);
    // Out of time once the first is sent, and stopped from the pool's page then.
    const answer = t.collateral.fetch;
    t.collateral.fetch = async (url, init) => {
      const witness = await answer(url, init);
      t.clock.now += BRING_RUN_MS;
      return witness;
    };
    await lj.bringAllBack("preprod", TOKEN);
    await lj.withdrawDue("preprod");
    await lj.stopBringingAllBack("preprod");
    expect(withdrawn(t)).toEqual([`${"f9".repeat(32)}#0`]);
    expect(await shares(t)).toEqual([
      [b1, [{ pool: TOKEN, boxes: 2 }]],
      [b2, [{ pool: TOKEN, boxes: 2, back: 1 }]],
    ]);
  });

  it("counts a box back by itself from where a Bootstrap brought back all at once put it against that Bootstrap, not another mix", async () => {
    const t = await wallet();
    const lj = pooled(t);
    // A mix from the public account, its box where its last mix put it, minutes ago; then a Bootstrap, its boxes in
    // for hours, let go.
    const mixed = await tokenBox(t, "a1", true, 0.1);
    t.koios.addedToAccounts.push(...POOL, ...(await depositBoxes(t, "b1", 2, 30)), mixed, ...(await strangers(t)));
    const mix = [
      { kind: "deposit" as const, txCbor: "", txHash: "a0".repeat(32), fee: "0" },
      { kind: "mix" as const, txCbor: "", txHash: "a1".repeat(32), fee: "0" },
    ];
    await lj.recordChain("preprod", { progress: "test.a1", txs: mix, leaves: [at("a1".repeat(32), 0)], boxes: 1, pools: { [TOKEN]: 1 }, account: 0 });
    for (const i of mix.keys()) await lj.chainSent("preprod", mix.at(-1)!.txHash, i);
    await lj.chainEnded("preprod", mix.at(-1)!.txHash);
    await bootstrapped(lj, b1, 2);
    await lj.releaseBootstrap("preprod", TOKEN);
    await lj.status("preprod");
    // One due now: the box that has sat longest comes back, the Bootstrap's.
    const kept = await sealed(t);
    await t.store.set("lovejoin.preprod", { ...kept, pools: { [TOKEN]: { due: [t.clock.now - HOUR, ...kept.pools![TOKEN]!.due.slice(1)] } } });
    await unlockedAnHourAgo(t);
    expect(await lj.withdrawDue("preprod")).toHaveLength(1);
    expect(withdrawn(t)).toEqual([`${b1}#0`]);
    expect(await shares(t)).toEqual([
      ["a1".repeat(32), [{ pool: TOKEN, boxes: 1 }]],
      [b1, [{ pool: TOKEN, boxes: 2, back: 1 }]],
    ]);
  });

  it("squares up a box another device brought back against the Bootstrap whose deposit no longer lists it", async () => {
    const t = await wallet();
    const lj = pooled(t);
    const theirs = await depositBoxes(t, "b2", 2);
    t.koios.addedToAccounts.push(...POOL, ...(await depositBoxes(t, "b1", 2)), ...theirs, ...(await strangers(t)));
    await bootstrapped(lj, b1, 2);
    t.clock.now += 60_000;
    await bootstrapped(lj, b2, 2);
    await lj.status("preprod");
    // Another device brought B2's boxes back.
    t.koios.addedToAccounts = t.koios.addedToAccounts.filter((u) => !theirs.includes(u));
    await later(t, lj, 4);
    expect(await shares(t)).toEqual([[b1, [{ pool: TOKEN, boxes: 2 }]]]);
    expect((await lj.status("preprod")).pools![0]!.bootstrap).toEqual([at(b1, 0), at(b1, 1)]);
    await later(t, lj, 10);
    await later(t, lj, 24);
    expect(withdrawn(t)).toEqual([]);
  });

  it("holds nothing in a Bootstrap's place before its deposit is listed: the wallet's other box comes back as any", async () => {
    const t = await wallet();
    const lj = pooled(t);
    // A box of the wallet's no record accounts for: a mix made it. Then a Bootstrap whose deposit no read lists yet.
    const f1 = await tokenBox(t, "f1");
    t.koios.addedToAccounts.push(...POOL, f1, ...(await strangers(t)));
    await lj.status("preprod");
    await bootstrapped(lj, b1, 2);
    const status = await lj.status("preprod");
    expect(status.pools![0]!.bootstrap ?? []).toEqual([]);
    expect(status.pools![0]!.due).toHaveLength(1);
    // Its deposit lands: its own boxes are held, and the other box still isn't.
    t.koios.addedToAccounts.push(...(await depositBoxes(t, "b1", 2, 0)));
    const landed = await lj.status("preprod");
    expect(landed.pools![0]!.bootstrap).toEqual([at(b1, 0), at(b1, 1)]);
    expect(landed.pools![0]!.due).toHaveLength(1);
  });
});

describe("a public deposit's box, its chain's record and its mix gone (1.6.0's release review, 316#1)", SLOW, () => {
  it("records every box of a public Bootstrap let go as the account's, though another box closed its mix's count first", async () => {
    const t = await wallet();
    const lj = pooled(t, []);
    t.koios.addedToAccounts.push(atAccount("e1", "40000000"), atAccount("e5", "5000000"), ...POOL);
    const summary = await lj.publicBuild("preprod", 2, { bootstrap: true });
    await lj.publicSubmit("preprod", summary.txHash);
    t.koios.confirmations = 1;
    await lj.pumpPublic("preprod");
    // Its boxes where its deposit put them, hours ago; and a box of the wallet's no record accounts for, a mix made it.
    const other = "f1".repeat(32);
    madeByMix(t.koios, other);
    t.koios.addedToAccounts.push(await classicBox(t, summary.entry, 0, 7), await classicBox(t, summary.entry, 1, 7), await classicBox(t, other, 0, 8));
    // A read hours on drops its chain's record; then Bring them all back.
    await later(t, lj, 4);
    expect((await sealed(t)).chains).toEqual([]);
    await lj.releaseBootstrap("preprod", "classic");
    // Each comes back by itself, one a run, the other box first: counted against the Bootstrap, whose count then
    // closes with its last box still out.
    await untilBack(t, lj, 3);
    expect(withdrawn(t)[0]).toBe(`${other}#0`);
    for (const i of [0, 1]) {
      const { hash, origin } = await originOf(t, `${summary.entry}#${i}`);
      expect(origin, `box ${i}`).toEqual({ id: `box:${hash}+public:0`, origin: "own" });
    }
    expect((await originOf(t, `${other}#0`)).origin).toBeUndefined();
  });

  it("records both boxes of a 1.5.0 public seed as the account's, though an older box closed its mix's count first", async () => {
    const t = await wallet();
    const lj = pooled(t, []);
    const [seed, old] = ["5e".repeat(32), "0e".repeat(32)];
    t.koios.addedToAccounts.push(...POOL, await classicBox(t, seed, 0, 2), await classicBox(t, seed, 1, 2), await classicBox(t, old, 0, 9));
    // As 1.5.0 kept it: a public seed of two boxes, all sent two hours ago; and an older box whose chain's record
    // went, a session's, due first.
    const chain = { id: seed, progress: "p", deposit: seed, mixes: [], leaves: [0, 1].map((i) => ({ txHash: seed, txIndex: i })), boxes: 2, seed: true, total: 1, sent: 1, at: t.clock.now - 2 * HOUR, done: true, ended: t.clock.now - 2 * HOUR };
    await t.store.set("lovejoin.preprod", {
      due: [t.clock.now - 60_000, t.clock.now + 4 * HOUR, t.clock.now + 5 * HOUR],
      chains: [chain],
      leaves: { [`${old}#0`]: "session.0" },
      notMixed: 0,
      unlock: t.clock.now - HOUR,
    });
    await unlockedAnHourAgo(t);
    await lj.withdrawDue("preprod");
    expect(withdrawn(t)).toEqual([`${old}#0`]);
    land(t);
    await untilBack(t, lj, 3);
    for (const i of [0, 1]) {
      const { hash, origin } = await originOf(t, `${seed}#${i}`);
      expect(origin, `box ${i}`).toEqual({ id: `box:${hash}+public:0`, origin: "own" });
    }
  });

  // The review of the fixes asked whether that tie, gone RECORD_KEEP_MS after no read listed a box there, goes too where
  // no read covers the pool for that long: a worker restarted while discovery is down. Discovery hands over the pools it
  // keeps on the device whether or not the data layer answers (lovejoin-pools.ts serviceDeps), so the read still covers
  // the token pool, and the tie stays.
  it("keeps whose deposit it was through worker restarts with the data layer down, as discovery hands over the pools it kept", async () => {
    const t = await wallet();
    const b1 = "b1".repeat(32);
    t.koios.addedToAccounts.push(...POOL, ...(await depositBoxes(t, "b1", 2)), ...(await strangers(t)));
    // A public Bootstrap's: its chain's record and its entry gone, its two boxes still at its deposit.
    await t.store.set("lovejoin.preprod", { due: [], chains: [], depositors: { [b1]: { account: 0, seen: t.clock.now } } });
    // What discovery keeps on the device: the token pool, as found once.
    const local = memoryArea();
    const view = VIEW as typeof VIEW & { boxLovelace: string };
    const kept: FoundPool = { id: TOKEN, boxLovelace: view.boxLovelace, token: VIEW.token, ref: TOKEN_POOL, launch: { block: 1, index: 0, tx: FOUND.reference.tx_hash } };
    await local.set(`${LOCAL_LOVEJOIN_POOLS_PREFIX}preprod`, { height: 0, pools: [kept] });
    const down = { pools: async () => Promise.reject(new IndexDown("the data layer isn't answering")) } as unknown as PrivateIndex;
    for (let read = 0; read < 3; read++) {
      // A worker restarted: a new discovery and a new Lovejoin, nothing handed over yet in either.
      const discovery = new PoolDiscovery({
        local,
        wasm: loadTestWasm(),
        koios: t.deps.koios,
        index: async () => down,
        wallet: t.wallet,
        now: () => t.clock.now,
        listed: () => new Set([VIEW.token.policyId + VIEW.token.assetName]),
        headStart: () => ({ height: 0, pools: [] }),
      });
      await pooled(t, [], serviceDeps(discovery)).status("preprod");
      await busyFor(t, 2 * HOUR);
    }
    expect(((await sealed(t)) as Sealed & { depositors?: Record<string, { account: number }> }).depositors?.[b1]).toMatchObject({ account: 0 });
  });
});

describe("a chain with no box of its own (1.6.0's release review, 316#3)", SLOW, () => {
  it("follows a return's collateral mixed on its way into the pool as a mix of its own, until its box is back", async () => {
    const t = await wallet();
    const lj = pooled(t);
    // A return that came back directly, its collateral's deposit and mix sent before it (sessions.ts sendChain's record):
    // no box of its own. The token pool stands in for the 5 ₳ pool.
    const [deposit, mix, back] = ["d0".repeat(32), "d1".repeat(32), "d2".repeat(32)] as const;
    t.koios.addedToAccounts.push(...POOL, await tokenBox(t, "d1", true, 5), ...(await strangers(t)));
    await lj.recordChain("preprod", {
      session: 0,
      progress: "test.d2",
      txs: [
        { kind: "deposit", txCbor: "", txHash: deposit, fee: "0", tail: true },
        { kind: "mix", txCbor: "", txHash: mix, fee: "0", tail: true },
        { kind: "back", txCbor: "", txHash: back, fee: "0" },
      ],
      leaves: [],
      boxes: 0,
      tail: { pool: TOKEN, box: { txHash: deposit, txIndex: 0 }, leaf: { txHash: mix, txIndex: 0 } },
    });
    for (const i of [0, 1, 2]) await lj.chainSent("preprod", back, i);
    await lj.chainEnded("preprod", back);
    expect(await lj.mixes("preprod")).toEqual([expect.objectContaining({ id: back, session: 0, shares: [{ pool: TOKEN, boxes: 1, back: 0, moved: 0 }] })]);
    // Its box comes back by itself, counted against it: it's over.
    const kept = await sealed(t);
    expect(kept.pools?.[TOKEN]?.due).toHaveLength(1);
    await t.store.set("lovejoin.preprod", { ...kept, pools: { [TOKEN]: { due: [t.clock.now - HOUR] } } });
    await unlockedAnHourAgo(t);
    expect(await lj.withdrawDue("preprod")).toHaveLength(1);
    expect(withdrawn(t)).toEqual([`${mix}#0`]);
    expect(await lj.mixes("preprod")).toEqual([]);
  });
});

describe("a stuck pool's box paid back from the private balance (1.6.0's release review, x-privacy#0)", SLOW, () => {
  /** A Seedelf UTxO of ADA alone at the contract, the wallet's: `value` lovelace. */
  async function privateUtxo(t: T, tx: string, value: string): Promise<KoiosUtxo> {
    return { ...ownedUtxos[0]!, tx_hash: tx.repeat(32), tx_index: 0, value, inline_datum: { bytes: await datum(t, true), value: {} }, asset_list: [] } as KoiosUtxo;
  }

  it("pays with one that names no public account but the box's own where one pays, never the smallest that ties another", async () => {
    // None of the fixture's own contract UTxOs: the private balance holds what the test gives it.
    const t = testBalances({ owned: false });
    await t.wallet.create(PHRASE, PASSWORD);
    t.koios.evaluation = AGREES;
    t.koios.tip = 110_000_000;
    // The token pool's boxes can't pay their own way back.
    t.koios.params = { coins_per_utxo_size: "4800" };
    const b1 = "b1".repeat(32);
    t.koios.addedToAccounts.push(...POOL, ...(await depositBoxes(t, "b1", 1)), ...(await strangers(t)));
    // The smaller made private from public account 1; the larger from account 0, whose Bootstrap put the box in.
    t.koios.added.push(await privateUtxo(t, "d1", "50000000"), await privateUtxo(t, "d2", "3000000"));
    const classes = new Map<string, HistoryClass>([
      [`${"d1".repeat(32)}#0`, madePrivate(0)],
      [`${"d2".repeat(32)}#0`, madePrivate(1)],
    ]);
    const written: Array<{ origin?: HistoryClass }> = [];
    const wasm = loadTestWasm();
    const lj = pooled(t, [TOKEN_POOL], {
      wasm: {
        ...wasm,
        finishLovejoinWithdraw: (request: string) => {
          const { txCbor } = JSON.parse(request) as { txCbor: string };
          return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
        },
        signScriptSpend: (_key: unknown, request: string) => {
          const { txCbor } = JSON.parse(request) as { txCbor: string };
          return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
        },
      } as typeof wasm,
      activity: {
        classes: async () => classes,
        sent: async (_n: unknown, _p: unknown, summary: { origin?: HistoryClass }) => {
          written.push(summary);
        },
      } as unknown as Deps["activity"],
    });
    await bootstrapped(lj, b1, 1);
    const [box] = (await lj.status("preprod")).pools![0]!.bootstrap!;
    const pending = await lj.withdrawNow("preprod", box!, false, "private");
    expect(txInputs(t.koios.submitted.at(-1)!).sort()).toEqual([`${b1}#0`, `${"d1".repeat(32)}#0`].sort());
    // Its history names account 0 alone: no two accounts are tied.
    expect(written[0]!.origin).toEqual(merged([boxFrom(pending.txHash), madePrivate(0)]));
  });

  /**
   * A wallet on account 0 whose token pool's boxes can't pay their own way back, its private balance two UTxOs of ADA
   * alone, `d1` and `d2` of `values`, made private from the public accounts `from` names; what each withdraw it pays for
   * leaves in the history, kept.
   */
  async function stuckPool(values: [string, string], from: [number, number]) {
    const t = testBalances({ owned: false });
    await t.wallet.create(PHRASE, PASSWORD);
    t.koios.evaluation = AGREES;
    t.koios.tip = 110_000_000;
    t.koios.params = { coins_per_utxo_size: "4800" };
    t.koios.added.push(await privateUtxo(t, "d1", values[0]), await privateUtxo(t, "d2", values[1]));
    const classes = new Map<string, HistoryClass>([
      [`${"d1".repeat(32)}#0`, madePrivate(from[0])],
      [`${"d2".repeat(32)}#0`, madePrivate(from[1])],
    ]);
    const written: Array<{ origin?: HistoryClass }> = [];
    const wasm = loadTestWasm();
    const signed = (request: string) => {
      const { txCbor } = JSON.parse(request) as { txCbor: string };
      return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
    };
    const lj = pooled(t, [TOKEN_POOL], {
      wasm: { ...wasm, finishLovejoinWithdraw: signed, signScriptSpend: (_key: unknown, request: string) => signed(request) } as typeof wasm,
      activity: {
        classes: async () => classes,
        sent: async (_n: unknown, _p: unknown, summary: { origin?: HistoryClass }) => {
          written.push(summary);
        },
      } as unknown as Deps["activity"],
    });
    return { t, lj, written };
  }

  /**
   * A mix from public account `account` into the token pool, recorded: deposit `deposit`, then `mixes`, its one box at
   * the last's output. The first `sent` of them sent; all of them, and over, unless fewer: then a lock cut it.
   */
  async function publicMix(lj: LovejoinService, account: number, deposit: string, mixes: string[], sent = 1 + mixes.length): Promise<void> {
    const txs = [
      { kind: "deposit" as const, txCbor: "", txHash: deposit, fee: "0" },
      ...mixes.map((txHash) => ({ kind: "mix" as const, txCbor: "", txHash, fee: "0" })),
    ];
    const id = txs.at(-1)!.txHash;
    await lj.recordChain("preprod", { progress: `test.${id.slice(0, 4)}`, txs, leaves: [at(id, 0)], boxes: 1, pools: { [TOKEN]: 1 }, account });
    for (let i = 0; i < sent; i++) await lj.chainSent("preprod", id, i);
    if (sent === txs.length) await lj.chainEnded("preprod", id);
  }

  const [a0, a1, c0, c1, c2] = ["a0", "a1", "c0", "c1", "c2"].map((x) => x.repeat(32)) as [string, string, string, string, string];

  it("pays for a box a public mix stopped short of mixing with one that names no other account where one pays, as its question says (R3-2)", async () => {
    // The larger made private from account 0, the smaller from account 1.
    const { t, lj, written } = await stuckPool(["50000000", "3000000"], [0, 1]);
    t.koios.addedToAccounts.push(...POOL, await tokenBox(t, "c1"), ...(await strangers(t)));
    // Account 0's mix, two waves deep: its deposit and first mix went, then a lock cut it. Its box from that mix.
    await publicMix(lj, 0, c0, [c1, c2], 2);
    const pool = (await lj.status("preprod")).pools![0]!;
    expect(pool.notMixed).toEqual([at(c1, 0)]);
    expect(pool.fromPublic).toEqual([at(c1, 0)]);
    const pending = await lj.withdrawNow("preprod", at(c1, 0), true, "private");
    expect(txInputs(t.koios.submitted.at(-1)!).sort()).toEqual([`${c1}#0`, `${"d1".repeat(32)}#0`].sort());
    // A box a mix made is a box back from Lovejoin by where it sits (PRIV-3): its history names the payer's account alone.
    expect(written[0]!.origin).toEqual(merged([boxFrom(pending.txHash), madePrivate(0)]));
  });

  it("brings back, naming no box, the account on screen's own before another account's, with its money first (R3-3)", async () => {
    // The smaller made private from account 1, the larger from account 0.
    const { t, lj } = await stuckPool(["3000000", "50000000"], [1, 0]);
    // Account 1's mix's box has sat in the pool longer than account 0's.
    t.koios.addedToAccounts.push(...POOL, await tokenBox(t, "a1", true, 9), await tokenBox(t, "c1", true, 5), ...(await strangers(t)));
    await publicMix(lj, 1, a0, [a1]);
    await publicMix(lj, 0, c0, [c1]);
    expect((await lj.status("preprod")).pools![0]!.otherAccounts).toEqual([{ ...at(a1, 0), account: 1 }]);
    await lj.withdrawNow("preprod", undefined, false, "private", TOKEN);
    expect(txInputs(t.koios.submitted.at(-1)!).sort()).toEqual([`${c1}#0`, `${"d2".repeat(32)}#0`].sort());
  });

  it("pays for another account's box, the only one it can take, with that account's money first (R3-3)", async () => {
    // The larger made private from account 1, whose box it is; the smaller from account 0, the one on screen.
    const { t, lj, written } = await stuckPool(["50000000", "3000000"], [1, 0]);
    t.koios.addedToAccounts.push(...POOL, await tokenBox(t, "a1", true, 9), ...(await strangers(t)));
    await publicMix(lj, 1, a0, [a1]);
    const pending = await lj.withdrawNow("preprod", undefined, false, "private", TOKEN);
    expect(txInputs(t.koios.submitted.at(-1)!).sort()).toEqual([`${a1}#0`, `${"d1".repeat(32)}#0`].sort());
    expect(written[0]!.origin).toEqual(merged([boxFrom(pending.txHash), madePrivate(1)]));
  });
});

// A held box Bring every box back now's withdraw went for is counted back against its Bootstrap then, and kept counted
// (`counted`), so a node dropping that withdraw never counts it twice. Stopped there, the box is free two hours on, and
// the Bootstrap still held it by count, letting another of its own boxes come back by itself, counted against nothing:
// it never closed, and held a box of the wallet's in its place for good (1.6.0's release review, R3-5).
describe("a Bootstrap's box whose withdraw of Bring every box back now a node dropped, then Stop (1.6.0's release review, R3-5)", SLOW, () => {
  const [b1, b2, f9] = ["b1".repeat(32), "b2".repeat(32), "f9".repeat(32)];

  /**
   * SPENT_KEEP_MS on, the wallet holds `outpoint` as spent no longer. The listing reads the marks against the device's
   * clock, which a test's runs years before: the mark goes instead (lovejoin-bring-review-fixes.test.ts, `lapsed`).
   */
  async function lapsed(t: T, outpoint: string): Promise<void> {
    const spent = (await t.session.get<Record<string, number>>(SESSION_SPENT)) ?? {};
    delete spent[outpoint];
    await t.session.set(SESSION_SPENT, spent);
  }

  /**
   * Bring every box back now in the token pool sends `box`'s withdraw, is out of time then, and is stopped. A node drops
   * that withdraw: two hours on the wallet holds the box as spent no longer, and Stop's one read goes.
   */
  async function droppedThenStopped(t: T, lj: LovejoinService, box: string): Promise<void> {
    await unlockedAnHourAgo(t);
    const answer = t.collateral.fetch;
    t.collateral.fetch = async (url, init) => {
      const witness = await answer(url, init);
      t.clock.now += BRING_RUN_MS;
      return witness;
    };
    await lj.bringAllBack("preprod", TOKEN);
    await lj.withdrawDue("preprod");
    t.collateral.fetch = answer;
    await lj.stopBringingAllBack("preprod");
    expect(withdrawn(t)).toEqual([box]);
    await busyFor(t, SPENT_KEEP_MS);
    await lapsed(t, box);
    expect(await lj.withdrawDue("preprod")).toEqual([]);
  }

  /** Runs an hour apart, the wallet in use, until `box` was withdrawn `times` times, a day of them at most: then it's on chain. */
  async function untilSent(t: T, lj: LovejoinService, box: string, times: number): Promise<void> {
    for (let run = 0; run < 24 && withdrawn(t).filter((b) => b === box).length < times; run++) {
      await busyFor(t, HOUR);
      await lj.withdrawDue("preprod");
    }
    expect(withdrawn(t).filter((b) => b === box)).toHaveLength(times);
    t.koios.addedToAccounts = t.koios.addedToAccounts.filter((u) => `${u.tx_hash}#${u.tx_index}` !== box);
  }

  for (const moved of [false, true]) {
    it(`holds the boxes it still has out, never the one counted back, which comes back by itself, counted once${moved ? ": one of them moved by someone else's mix" : ""}`, async () => {
      const t = await wallet();
      const lj = pooled(t);
      // B1's three boxes; moved: its third at the wallet's box a stranger's mix made, f9, which no record accounts for.
      const listed = [...(await depositBoxes(t, "b1", moved ? 2 : 3)), ...(moved ? [await tokenBox(t, "f9", true, 7)] : [])];
      t.koios.addedToAccounts.push(...POOL, ...listed, ...(await strangers(t)));
      await bootstrapped(lj, b1, 3);
      const held = listed.map((u) => at(u.tx_hash, u.tx_index));
      expect((await lj.status("preprod")).pools![0]!.bootstrap).toEqual(held);
      await droppedThenStopped(t, lj, `${b1}#0`);
      // b1#0 was counted back as its withdraw went: B1 holds the two it still has out, and b1#0, free, has a due time.
      expect(await shares(t)).toEqual([[b1, [{ pool: TOKEN, boxes: 3, back: 1 }]]]);
      const after = (await lj.status("preprod")).pools![0]!;
      expect(after.bootstrap).toEqual(held.slice(1));
      expect(after.due).toHaveLength(1);
      // It comes back by itself, counted back once.
      await untilSent(t, lj, `${b1}#0`, 2);
      expect(await shares(t)).toEqual([[b1, [{ pool: TOKEN, boxes: 3, back: 1 }]]]);
      // The two held, brought back by hand: B1 is over, and holds no box of the wallet's in its place.
      for (const box of held.slice(1).reverse()) expect((await bringOneBack(t, lj)).box).toEqual(box);
      expect(await shares(t)).toEqual([]);
      t.koios.addedToAccounts.push(await tokenBox(t, "f8", true, 7));
      expect((await lj.status("preprod")).pools![0]!.bootstrap ?? []).toEqual([]);
    });
  }

  it("counts a box someone else's mix moved, brought back by hand, against the Bootstrap it was moved from, a box of that one counted back still listed", async () => {
    const t = await wallet();
    const lj = pooled(t);
    // B1, older, its two boxes at its deposit. B2's first two at its deposit, its third at the wallet's box a stranger's
    // mix made, f9; B2's listed first, so the run takes b2#0 first.
    t.koios.addedToAccounts.push(
      ...POOL,
      ...(await depositBoxes(t, "b2", 2)),
      await tokenBox(t, "f9", true, 7),
      ...(await depositBoxes(t, "b1", 2)),
      ...(await strangers(t)),
    );
    await bootstrapped(lj, b1, 2);
    t.clock.now += 60_000;
    await bootstrapped(lj, b2, 3);
    await lj.status("preprod");
    await droppedThenStopped(t, lj, `${b2}#0`);
    // The page offers the moved box, held for B2, which it counts against: B1 still holds both of its own.
    expect((await bringOneBack(t, lj)).box).toEqual(at(f9, 0));
    expect(await shares(t)).toEqual([
      [b1, [{ pool: TOKEN, boxes: 2 }]],
      [b2, [{ pool: TOKEN, boxes: 3, back: 2 }]],
    ]);
    expect((await lj.status("preprod")).pools![0]!.bootstrap).toEqual([at(b2, 1), at(b1, 0), at(b1, 1)]);
  });
});
