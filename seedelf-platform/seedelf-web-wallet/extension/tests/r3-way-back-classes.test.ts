// Chunk 51, the owner's calls round, round three: a box's way back is classed by what the wallet knows, and nothing new
// is asked of anyone for it (the owner's answers of 2026-11-18, e1a#1's approved design). A box the wallet knows is
// mixed is marked so, `mixed`, and a stealth mint takes it first; a deposit's own box never is, a Bootstrap's or a
// seed's, however its mix's count closed and whatever records are gone (l2rank#3, l2still#2). A box the user's own
// session deposited is that session's money, a public account's deposit ties that account (PRIV-3). Anything else, a
// box someone else put in (a register copied as found, d = 1, included), an unsure box, one whose making the wallet
// can't tell, a retired pool's box nobody asked about, comes back as a box of unknown making, `box:<w>+unknown:<w>`,
// origin lovejoin: a stealth mint and a funding take money others paid before it, selection still takes it last and one
// at a time, the UTxOs screen tags it Back from Lovejoin and Unknown, and a review counts it as a box (l2rank#1,
// l2time#1, l2time#3, l2still#1).
//
// Driven through the worker's services with the real WebAssembly, the classes it's sent all ones it already reads.
import { describe, expect, it } from "vitest";

import { CONTRACT_V1 } from "../src/background/balances";
import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService } from "../src/background/lovejoin";
import { SESSION_MINT } from "../src/background/mint";
import { SESSION_TRANSFER } from "../src/background/transfer";
import { historiesNote, historyTags, type HistoryClass } from "../src/shared/histories";
import { account, AGREES, CHAINS, HOUR, PASSWORD, POOL, withSession, type Tested } from "./chain-fixtures";
import { preprodAddress } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, ownedUtxos, testBalances, transferPreprod } from "./fakes";
import { ADA, ADA_POOL, ADA_ROWS, adaBox, madeByAdaMix, ownDatum } from "./v2-pools";

const hash = (h: string) => (h.length === 64 ? h : h.repeat(32));
const inputsOf = (cbor: string) => txInputs(Uint8Array.from(Buffer.from(cbor, "hex")));
const ref = (b: { txHash: string; txIndex: number }) => `${b.txHash}#${b.txIndex}`;
/** Box `txHash#index` of the 5 ₳ pool, and of the classic pool (retired), as the worker names them. */
const inAda = (txHash: string, txIndex = 0) => ({ txHash, txIndex, pool: ADA });
const inClassic = (txHash: string) => ({ txHash, txIndex: 0 });
/** A deposit's inputs, as tx_info lists them: one UTxO at an address of payment key `cred`. */
const paidBy = (cred: string) => [{ payment_addr: { bech32: preprodAddress(cred), cred } }];
/** What a box whose making the wallet can't place comes back as, withdraw `w` (chunk 51, round three's rule 1 (d)). */
const unplaced = (w: string): HistoryClass => ({ id: `box:${w}+unknown:${w}`, origin: "lovejoin" });
const mixed = (w: string): HistoryClass => ({ id: `box:${w}`, origin: "mixed" });
/** How often Koios was asked what made one of `txs` (tx_info). */
const askedOf = (t: Tested, txs: string[]) =>
  t.koios.calls.filter((c) => c.path === "tx_info" && txs.some((x) => JSON.stringify(c.body ?? "").includes(x))).length;

type Entry = { txHash: string; kind: string; lovelace: string; origin?: HistoryClass };
const entryOf = async (t: Tested, txHash: string) =>
  (await t.store.get<{ entries: Entry[] }>("history.preprod"))!.entries.find((e) => e.txHash === txHash);
type Kept = { chains: Array<{ id: string }>; mixes?: Array<{ id: string }>; leaves?: Record<string, string>; depositors?: Record<string, unknown> };
const schedule = async (t: Tested) => (await t.store.get<Kept>("lovejoin.preprod"))!;

/** A UTxO of the wallet's at the Seedelf contract, `txHash#index`, under a fresh re-randomization of its register. */
async function privateRow(t: Tested, txHash: string, lovelace: string, index = 0): Promise<KoiosUtxo> {
  const wasm = loadTestWasm();
  const bytes = await t.wallet.withKeys((keys) => Buffer.from(wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister()))).toString("hex"));
  return { ...ownedUtxos[0]!, tx_hash: txHash, tx_index: index, value: lovelace, asset_list: [], inline_datum: { bytes, value: null }, block_height: 9_000_001 };
}

/** Lovejoin on `t`'s fakes, reading the 5 ₳ pool (and the classic pool), giveme.my's witness stood in for. */
function witnessed(t: Tested, extra: Partial<ConstructorParameters<typeof LovejoinService>[0]> = {}) {
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
    pools: async () => [ADA_POOL],
    sessionIndices: async () => [0],
    ...extra,
  });
}

/** `rows` land in the private balance; then what a stealth mint from it spends. */
async function stealthMint(t: Tested, rows: KoiosUtxo[]): Promise<string[]> {
  t.koios.added.push(...rows);
  t.clock.now += 60_000;
  await t.balances.get("preprod", true);
  await t.mint.build("preprod", "", "seedelf");
  return inputsOf((await t.session.get<{ txCbor: string }>(SESSION_MINT))!.txCbor);
}

/** Brings box `tx#0` of the 5 ₳ pool back (`anyway` where it isn't mixed), and the private UTxO its way back makes. */
async function bringBack(t: Tested, lj: LovejoinService, tx: string, anyway = false) {
  await lj.status("preprod");
  const back = await lj.withdrawNow("preprod", inAda(tx), anyway);
  const entry = (await entryOf(t, back.txHash))!;
  return { back, entry, row: await privateRow(t, back.txHash, entry.lovelace) };
}

/** Mallory's 5 ₳ box under Seedelf S1's register as found (d = 1), paid from her own key: someone else's to the wallet. */
async function planted(tx: string) {
  const { t } = await withSession("40000000");
  await t.balances.get("preprod");
  const s1 = ownedUtxos.find((u) => (u.asset_list ?? []).some((a) => a.policy_id === CONTRACT_V1.seedelfPolicyId))!;
  const C = hash(tx);
  t.koios.addedToAccounts.push(adaBox(C, s1.inline_datum!.bytes, t.clock.now));
  t.koios.txSpends.set(C, paidBy("ee".repeat(28)));
  const lj = witnessed(t);
  const pool = (await lj.status("preprod")).pools!.find((p) => p.id === ADA)!;
  expect((pool.someoneElse ?? []).map(ref)).toEqual([ref(inAda(C))]);
  return { t, lj, C };
}

/** The way back `back` made, Bob's 20 ₳ payment beside it, and what the next stealth mint spends. */
async function mintAfter(t: Tested, back: { txHash: string }, C: string) {
  const entry = (await entryOf(t, back.txHash))!;
  // Anyone reading S1's name sees its register in the box this withdraw spent.
  const withdraw = t.koios.submitted.find((bytes) => txIdOf(bytes) === back.txHash)!;
  expect(txInputs(withdraw)).toContain(`${C}#0`);
  const w = await privateRow(t, back.txHash, entry.lovelace);
  const bob = await privateRow(t, hash("b0"), "20000000");
  return { entry, bob, spent: await stealthMint(t, [w, bob]) };
}

describe("a box someone else put in under the wallet's key comes back as a box of unknown making (chunk 51, l2rank#1)", CHAINS, () => {
  it("Bring every box back now: never ranked with payments, so the next stealth mint takes Bob's 20 ₳", async () => {
    const { t, lj, C } = await planted("c9");
    await lj.bringAllBack("preprod");
    const sent = await lj.withdrawDue("preprod");
    expect(sent).toHaveLength(1);
    const { entry, bob, spent } = await mintAfter(t, sent[0]!, C);
    expect.soft(entry.origin).toEqual(unplaced(sent[0]!.txHash));
    expect(spent, "the way back of a box carrying S1's register byte for byte").toEqual([`${bob.tx_hash}#0`]);
  });

  it("Bring one back anyway: the same", async () => {
    const { t, lj, C } = await planted("ca");
    const back = await lj.withdrawNow("preprod", inAda(C), true);
    const { entry, bob, spent } = await mintAfter(t, back, C);
    expect.soft(entry.origin).toEqual(unplaced(back.txHash));
    expect(spent).toEqual([`${bob.tx_hash}#0`]);
  });

  it("another device's session past the book's indices: its deposit's way back is never money received", async () => {
    const { t } = await withSession("40000000");
    await t.balances.get("preprod");
    const A = hash("a9");
    t.koios.addedToAccounts.push(adaBox(A, await ownDatum(t.wallet), t.clock.now));
    // Session 25's one-time account paid it: this device's book knows session 0 alone.
    t.koios.txSpends.set(A, paidBy(await t.wallet.withKeys((k) => k.oneTime.keyHash(25))));
    const lj = witnessed(t);
    expect(((await lj.status("preprod")).pools!.find((p) => p.id === ADA)!.someoneElse ?? []).map(ref)).toEqual([ref(inAda(A))]);
    const back = await lj.withdrawNow("preprod", inAda(A), true);
    expect((await entryOf(t, back.txHash))?.origin).toEqual(unplaced(back.txHash));
  });
});

/**
 * The steady state: a done chain's leaves, each with a due time, other people's mixes having moved each to `xs[i]#0`
 * (Koios would say a mix made it). Nothing asks Koios of them: one due time each (found, M14).
 */
async function steady(t: Tested, xs: string[], dueIn: number) {
  const [D, M, R] = [hash("a1"), hash("a2"), hash("a3")];
  const at = t.clock.now - 30 * HOUR;
  const done = {
    id: R, session: 1, progress: "seedelf.lovejoin.test", deposit: D, mixes: [M], leaves: xs.map((_, i) => inAda(M, i)), boxes: xs.length,
    pools: { [ADA]: xs.length }, total: 3, sent: 3, done: true, at, scheduled: true, ended: at, found: true, landed: true,
  };
  for (const x of xs) t.koios.addedToAccounts.push(adaBox(x, await ownDatum(t.wallet), t.clock.now, 7));
  madeByAdaMix(t.koios, ...xs);
  await t.store.set("lovejoin.preprod", {
    due: [], chains: [done], pools: { [ADA]: { due: xs.map((_, i) => t.clock.now + dueIn + i * 60_000) } }, unlock: await t.wallet.unlockedAt(),
  });
}

describe("a box nobody asked about, brought back by Bring every box back now, stays a box (chunk 51, l2time#1)", CHAINS, () => {
  it("asks nothing, and each way back is a box of unknown making: tagged as both, kept apart, and counted as a box", async () => {
    const { t } = await withSession("40000000");
    await t.balances.get("preprod");
    const [X1, X2] = [hash("f3"), hash("f4")];
    await steady(t, [X1, X2], 3 * HOUR);
    const lj = witnessed(t);
    await lj.status("preprod");
    await lj.bringAllBack("preprod");
    const sent = await lj.withdrawDue("preprod");
    expect(sent).toHaveLength(2);
    // Nothing new asked of anyone (the owner's rule): Koios was never asked what made either box.
    expect(askedOf(t, [X1, X2])).toBe(0);
    const entries = await Promise.all(sent.map((p) => entryOf(t, p.txHash)));
    for (const [i, p] of sent.entries()) expect.soft(entries[i]?.origin).toEqual(unplaced(p.txHash));
    const rows = await Promise.all(sent.map((p, i) => privateRow(t, p.txHash, entries[i]!.lovelace)));
    t.koios.added.push(...rows);
    t.clock.now += 60_000;
    await t.balances.get("preprod", true);
    const classes = await t.activity.classes("preprod", rows);
    const read = rows.map((r) => classes.get(`${r.tx_hash}#0`)!);
    for (const c of read) expect.soft(historyTags(c)).toEqual(["Back from Lovejoin", "Unknown"]);
    const note = historiesNote(read) ?? "";
    expect.soft(note).toContain("2 boxes back from Lovejoin");
    expect.soft(note).not.toContain("no history");
    expect(note).toContain("undoes some of what Lovejoin did for the boxes");
  });

  it("left to come back by itself, the same box is asked about once and marked as one a mix moved (a pin)", async () => {
    const { t } = await withSession("40000000");
    await t.balances.get("preprod");
    const X = hash("f5");
    // Its due time is past.
    await steady(t, [X], -60_000);
    const lj = witnessed(t);
    await lj.status("preprod");
    expect(askedOf(t, [X])).toBe(0);
    const sent = await lj.withdrawDue("preprod");
    expect(sent).toHaveLength(1);
    expect(askedOf(t, [X])).toBeGreaterThan(0);
    expect((await entryOf(t, sent[0]!.txHash))?.origin).toEqual(mixed(sent[0]!.txHash));
  });
});

describe("a retired pool's box whose 1.9.1 answer kept no inputs (chunk 51, l2time#3)", CHAINS, () => {
  it("comes back as a box of unknown making, never as money received, and asks nothing", async () => {
    const { t } = await withSession("40000000");
    await t.balances.get("preprod");
    const D = hash("d9");
    const key = await t.wallet.withKeys((k) => k.oneTime.keyHash(0));
    t.koios.txSpends.set(D, paidBy(key));
    const box = { ...POOL[0]!, tx_hash: D, tx_index: 0, block_time: Math.floor(t.clock.now / 1000) - 10 * 3600, inline_datum: { bytes: await ownDatum(t.wallet), value: {} } } as KoiosUtxo;
    t.koios.addedToAccounts.push(...POOL, box);
    // As 1.9.1 kept it after a restore: a deposit made it, no account named, nothing that says whose deposit.
    await t.store.set("lovejoin.preprod", { due: [], chains: [], origins: { [D]: { mixed: false, seen: t.clock.now } } });
    const lj = witnessed(t);
    await lj.status("preprod");
    const back = await lj.withdrawNow("preprod", inClassic(D));
    const entry = (await entryOf(t, back.txHash))!;
    expect(askedOf(t, [D])).toBe(0);
    expect.soft(entry.origin).toEqual(unplaced(back.txHash));
    expect.soft(entry.origin && historyTags(entry.origin)).toEqual(["Back from Lovejoin", "Unknown"]);
    const row = await privateRow(t, back.txHash, entry.lovelace);
    const bob = await privateRow(t, hash("b0"), "60000000");
    expect(await stealthMint(t, [row, bob]), "the stealth mint's inputs").toEqual([`${bob.tx_hash}#0`]);
  });
});

/** Restored: the first reading finds 4 ₳ (Unknown); two boxes Koios can't say the making of come back anyway, and land. */
async function restoredWithTwoUntoldBoxesBack() {
  const t = testBalances({ owned: false, pools: [ADA_POOL] });
  await t.wallet.create(account(12).phrase, PASSWORD);
  t.koios.addedToAccounts.push(...ADA_ROWS);
  t.koios.evaluation = AGREES;
  const before = await privateRow(t, hash("a0"), "4000000");
  t.koios.added.push(before);
  await t.balances.get("preprod");
  const [C1, C2] = [hash("c7"), hash("c8")];
  const datum = await ownDatum(t.wallet);
  t.koios.addedToAccounts.push(adaBox(C1, datum, t.clock.now), adaBox(C2, datum, t.clock.now));
  t.koios.txSpends.set(C1, paidBy("ee".repeat(28)));
  t.koios.txSpends.set(C2, paidBy("ee".repeat(28)));
  const fetch = t.koios.fetch;
  t.koios.fetch = async (url, init) => (url.includes("/tx_info") ? new Response("upstream", { status: 500 }) : fetch(url, init));
  const lj = witnessed(t);
  expect((await lj.status("preprod")).pools!.find((p) => p.id === ADA)!.unsure).toHaveLength(2);
  const w1 = await lj.withdrawNow("preprod", inAda(C1), true);
  const w2 = await lj.withdrawNow("preprod", inAda(C2), true);
  t.koios.fetch = fetch;
  const [e1, e2] = [(await entryOf(t, w1.txHash))!, (await entryOf(t, w2.txHash))!];
  const [r1, r2] = [await privateRow(t, w1.txHash, e1.lovelace), await privateRow(t, w2.txHash, e2.lovelace)];
  t.koios.added.push(r1, r2);
  t.clock.now += 60_000;
  await t.balances.get("preprod", true);
  return { t, before, e1, r1, r2 };
}

describe("a box whose making the wallet can't tell, brought back anyway, stays a box to selection (chunk 51, l2still#1)", () => {
  it("its way back keeps a box's class beside Unknown", CHAINS, async () => {
    const { t, e1, r1 } = await restoredWithTwoUntoldBoxesBack();
    expect.soft(e1.origin).toEqual(unplaced(r1.tx_hash));
    const classes = await t.activity.classes("preprod", [r1]);
    expect(classes.get(`${r1.tx_hash}#0`)).toEqual(unplaced(r1.tx_hash));
  });

  it("a Send that one box and the money found at the restore pay takes one box, not two together", CHAINS, async () => {
    const { t, before, r1, r2 } = await restoredWithTwoUntoldBoxesBack();
    expect(BigInt(before.value) < BigInt(r1.value)).toBe(true);
    const summary = await t.transfer.build("preprod", [{ to: transferPreprod.to, lovelace: (BigInt(r1.value) + 100_000n).toString(), tokens: [] }]);
    const spent = inputsOf((await t.session.get<{ txCbor: string }>(SESSION_TRANSFER))!.txCbor);
    const boxes = spent.filter((o) => o === `${r1.tx_hash}#0` || o === `${r2.tx_hash}#0`);
    expect(boxes, `spent ${JSON.stringify(spent)}, the review said ${JSON.stringify(historiesNote(summary.histories))}`).toHaveLength(1);
    expect(historiesNote(summary.histories)).toMatch(/a box back from Lovejoin/);
  });

  it("with a payment received since, a Send past it takes the payment, the money found at the restore and one box", CHAINS, async () => {
    const { t, before, r1, r2 } = await restoredWithTwoUntoldBoxesBack();
    const bob = await privateRow(t, hash("b0"), "10000000");
    t.koios.added.push(bob);
    t.clock.now += 60_000;
    await t.balances.get("preprod", true);
    const lovelace = (BigInt(bob.value) + BigInt(r1.value) + 300_000n).toString();
    const summary = await t.transfer.build("preprod", [{ to: transferPreprod.to, lovelace, tokens: [] }]);
    const spent = inputsOf((await t.session.get<{ txCbor: string }>(SESSION_TRANSFER))!.txCbor);
    const note = historiesNote(summary.histories);
    expect.soft(spent).toContain(`${bob.tx_hash}#0`);
    expect.soft(spent).toContain(`${before.tx_hash}#0`);
    expect.soft(spent.filter((o) => o === `${r1.tx_hash}#0` || o === `${r2.tx_hash}#0`), `spent ${JSON.stringify(spent)}`).toHaveLength(1);
    expect(note, note).toMatch(/Lovejoin/);
  });
});

/** A private Bootstrap of session 4 that ended `hoursAgo`: its chain is its deposit alone, its leaves its deposit's boxes. */
function privateBootstrap(t: Tested, D: string, R: string, hoursAgo = 30) {
  const at = t.clock.now - hoursAgo * HOUR;
  const chain = {
    id: R, session: 4, progress: "seedelf.lovejoin.test", deposit: D, mixes: [], leaves: [inAda(D)], boxes: 1, pools: { [ADA]: 1 },
    bootstrap: true, total: 2, sent: 2, done: true, at, scheduled: true, ended: at, found: true,
  };
  const entry = { id: R, deposit: D, at, session: 4, bootstrap: true, found: true, shares: [{ pool: ADA, boxes: 1 }] };
  return { chain, entry };
}

describe("a deposit's own box is never one a mix moved, whatever records are gone (chunk 51, l2rank#3, l2still#2)", CHAINS, () => {
  it("a private Bootstrap's box, its record gone and its entry closed by another box counted first, is its session's money", async () => {
    const { t } = await withSession("40000000");
    await t.balances.get("preprod");
    const [D, R, X] = [hash("e3"), hash("e4"), hash("f6")];
    const { chain, entry } = privateBootstrap(t, D, R);
    const datum = await ownDatum(t.wallet);
    t.koios.addedToAccounts.push(adaBox(D, datum, t.clock.now), adaBox(X, datum, t.clock.now));
    madeByAdaMix(t.koios, X);
    await t.store.set("lovejoin.preprod", { due: [], chains: [chain], mixes: [entry] });
    const lj = witnessed(t);
    await lj.status("preprod");
    const after = await schedule(t);
    expect(after.chains).toEqual([]);
    expect(after.leaves?.[`${D}#0`]).toBe("session.4");
    await lj.releaseBootstrap("preprod", ADA);
    await bringBack(t, lj, X);
    // Closed by count: the box another mix moved was counted against the released Bootstrap.
    expect((await schedule(t)).mixes ?? []).toEqual([]);
    const { back, entry: written, row } = await bringBack(t, lj, D);
    expect.soft(written.origin).toEqual({ id: `box:${back.txHash}+session:4`, origin: "session" });
    const bob = await privateRow(t, hash("b0"), "60000000");
    expect(await stealthMint(t, [row, bob])).toEqual([`${bob.tx_hash}#0`]);
  });

  it("as an update finds it, 1.9.1 having dropped the record with the entry still open, it's its session's money all the same", async () => {
    const { t } = await withSession("40000000");
    await t.balances.get("preprod");
    const [D, R, X] = [hash("e5"), hash("e6"), hash("f7")];
    const { entry } = privateBootstrap(t, D, R);
    const datum = await ownDatum(t.wallet);
    t.koios.addedToAccounts.push(adaBox(D, datum, t.clock.now, 30), adaBox(X, datum, t.clock.now));
    madeByAdaMix(t.koios, X);
    await t.store.set("lovejoin.preprod", { due: [], chains: [], mixes: [entry], leaves: { [`${D}#0`]: "session.4" } });
    const lj = witnessed(t);
    await lj.status("preprod");
    await lj.releaseBootstrap("preprod", ADA);
    await bringBack(t, lj, X);
    expect((await schedule(t)).mixes ?? []).toEqual([]);
    const { back, entry: written } = await bringBack(t, lj, D);
    expect(written.origin).toEqual({ id: `box:${back.txHash}+session:4`, origin: "session" });
  });

  it("a leaf kept from before, no record or entry left to say whose deposit made it, is never marked mixed", async () => {
    const { t } = await withSession("40000000");
    await t.balances.get("preprod");
    const D = hash("e7");
    t.koios.addedToAccounts.push(adaBox(D, await ownDatum(t.wallet), t.clock.now));
    await t.store.set("lovejoin.preprod", { due: [], chains: [], leaves: { [`${D}#0`]: "session.4" } });
    const lj = witnessed(t);
    const { back, entry, row } = await bringBack(t, lj, D);
    expect(askedOf(t, [D])).toBe(0);
    expect.soft(entry.origin).toEqual(unplaced(back.txHash));
    const bob = await privateRow(t, hash("b0"), "60000000");
    expect(await stealthMint(t, [row, bob])).toEqual([`${bob.tx_hash}#0`]);
  });

  it("a leaf a chain's last mix left, kept once its record went, is still marked as one a mix moved (a pin)", async () => {
    const { t } = await withSession("40000000");
    await t.balances.get("preprod");
    const [D, M, R] = [hash("a4"), hash("a5"), hash("a6")];
    const at = t.clock.now - 30 * HOUR;
    const done = {
      id: R, session: 1, progress: "seedelf.lovejoin.test", deposit: D, mixes: [M], leaves: [inAda(M)], boxes: 1, pools: { [ADA]: 1 },
      total: 3, sent: 3, done: true, at, scheduled: true, ended: at, found: true, landed: true,
    };
    t.koios.addedToAccounts.push(adaBox(M, await ownDatum(t.wallet), t.clock.now));
    await t.store.set("lovejoin.preprod", { due: [], chains: [done] });
    const lj = witnessed(t);
    await lj.status("preprod");
    expect((await schedule(t)).chains).toEqual([]);
    expect((await schedule(t)).leaves?.[`${M}#0`]).toBe("session.1");
    const { back, entry } = await bringBack(t, lj, M);
    expect(entry.origin).toEqual(mixed(back.txHash));
  });
});
