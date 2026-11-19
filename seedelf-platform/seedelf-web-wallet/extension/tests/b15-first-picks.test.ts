// Chunk 51, the owner's calls round, round two: what a stealth mint, a pool's start from the private balance and a
// private session's funding take first (B15, the owner's answers of 2026-11-18). Core's Purpose::Mint takes first a box
// the wallet recorded a mix moving (answer 4), then money others paid, and Purpose::Fund takes money others paid
// first. So everything here is about the classes the worker seals and reads (shared/histories.ts):
//
// - A box's way back is classed by what put the box there when no mix moved it since: a private session's deposit (a
//   Bootstrap's too) is that session's money, as a public account's deposit is that account's (PRIV-3); a box whose
//   maker the wallet can't tell is Unknown; a box a mix moved, by the wallet's records or Koios's answer, is marked so,
//   and only it goes first for a stealth mint (time#1, still#1, own#4, money#3).
// - A stranger's copy (d = 1) of a register already on chain never takes a box's class (money#1, own#2).
// - What a spend of the wallet's own leaves is tied to that spend in the open: a part naming it, `change:<tx>`, or the
//   account's for a Make public to one of the user's own accounts, so a stealth mint and a funding take money others
//   paid first (money#2, own#1, the owner's answer 2).
//
// Driven through the worker's services with the real WebAssembly. The cases marked so need it built with core's ranks
// of this round (Origin::Mixed): the package from before reads a `mixed` origin as no origin at all.
import { describe, expect, it } from "vitest";

import { CONTRACT_V1 } from "../src/background/balances";
import { txInputs } from "../src/background/cbor";
import type { KoiosUtxo } from "../src/background/koios";
import { CHAIN_CUT, LovejoinService } from "../src/background/lovejoin";
import { SESSION_MINT } from "../src/background/mint";
import { SESSION_OUT } from "../src/background/sessions";
import { rememberSpent } from "../src/background/spent";
import { SESSION_TRANSFER } from "../src/background/transfer";
import { SESSION_REMOVE, SESSION_WITHDRAW } from "../src/background/withdraw";
import { Collateral } from "../src/background/collateral";
import { historyTags, type HistoryClass } from "../src/shared/histories";
import type { PendingTx } from "../src/shared/rpc";
import { CHAINS, HOUR, withSession, type Tested } from "./chain-fixtures";
import { preprodAddress } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, minswapEstimate, ownedUtxos, testBalances, transferPreprod, vectors, withdrawPreprod } from "./fakes";
import { ADA, ADA_POOL, adaBox, madeByAdaMix, ownDatum } from "./v2-pools";

const PASSWORD = "correct horse battery";
const hash = (h: string) => (h.length === 64 ? h : h.repeat(32));
const inputsOf = (cbor: string) => txInputs(Uint8Array.from(Buffer.from(cbor, "hex")));
/** Box `txHash#index` of the 5 ₳ pool, as the worker names it. */
const inAda = (txHash: string, txIndex = 0) => ({ txHash, txIndex, pool: ADA });
/** A deposit's inputs, as tx_info lists them: one UTxO at an address of payment key `cred`. */
const paidBy = (cred: string) => [{ payment_addr: { bech32: preprodAddress(cred), cred } }];
/** A box a mix moved, as the worker marks its way back (shared/histories.ts `mixedBox`). */
const mixed = (txHash: string): HistoryClass => ({ id: `box:${txHash}`, origin: "mixed" as HistoryClass["origin"] });

type Entry = { txHash: string; kind: string; lovelace: string; origin?: HistoryClass };
/** The private history's entry for `txHash`. */
const entryOf = async (t: Tested, txHash: string) =>
  (await t.store.get<{ entries: Entry[] }>("history.preprod"))!.entries.find((e) => e.txHash === txHash);

/** A UTxO of the wallet's at the Seedelf contract, `txHash#index`, under a fresh re-randomization of its register. */
async function privateRow(t: Tested, txHash: string, lovelace: string, index = 0): Promise<KoiosUtxo> {
  const wasm = loadTestWasm();
  const bytes = await t.wallet.withKeys((keys) => Buffer.from(wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister()))).toString("hex"));
  return { ...ownedUtxos[0]!, tx_hash: txHash, tx_index: index, value: lovelace, asset_list: [], inline_datum: { bytes, value: null }, block_height: 9_000_001 };
}

/** Lovejoin on `t`'s fakes, reading the 5 ₳ pool, giveme.my's witness stood in for (its recorded answer is another transaction's). */
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
    ...extra,
  });
}

/** Brings box `tx#0` of the 5 ₳ pool back (`anyway`, where it isn't mixed), and the private UTxO its way back makes. */
async function bringBack(t: Tested, lj: LovejoinService, tx: string, anyway = true) {
  await lj.status("preprod");
  const back = await lj.withdrawNow("preprod", inAda(tx), anyway);
  const entry = (await entryOf(t, back.txHash))!;
  return { back, entry, row: await privateRow(t, back.txHash, entry.lovelace) };
}

/** `rows` land in the private balance; then what a stealth mint from it spends. */
async function stealthMint(t: Tested, rows: KoiosUtxo[]): Promise<string[]> {
  t.koios.added.push(...rows);
  t.clock.now += 60_000;
  await t.balances.get("preprod", true);
  await t.mint.build("preprod", "", "seedelf");
  return inputsOf((await t.session.get<{ txCbor: string }>(SESSION_MINT))!.txCbor);
}

/** The 5 ₳ pool's boxes not mixed yet, as a status has them. */
const notMixed = async (lj: LovejoinService) => (await lj.status("preprod")).pools!.find((p) => p.id === ADA)!.notMixed ?? [];

describe("a box's way back, classed by what put the box there (chunk 51, time#1, still#1, own#4, money#3)", CHAINS, () => {
  it("one a private session deposited, its chain cut, is that session's money: a stealth mint takes a payment first", async () => {
    const { t } = await withSession("40000000");
    await t.balances.get("preprod");
    const [D, M, R] = [hash("96"), hash("97"), hash("98")];
    const cut = {
      id: R, session: 2, progress: "seedelf.lovejoin.test", deposit: D, mixes: [M], leaves: [inAda(M)], boxes: 1, pools: { [ADA]: 1 },
      total: 3, sent: 1, at: t.clock.now - 2 * HOUR, scheduled: true, stopped: CHAIN_CUT(), cut: true, ended: t.clock.now - 2 * HOUR,
    };
    t.koios.addedToAccounts.push(adaBox(D, await ownDatum(t.wallet), t.clock.now));
    await t.store.set("lovejoin.preprod", { due: [], chains: [cut] });
    const lj = witnessed(t);
    expect(await notMixed(lj)).toEqual([inAda(D)]);
    const { back, entry, row } = await bringBack(t, lj, D);
    // Anyone can follow it from the deposit to that session and what funded it: its money, never a box a mix brought back.
    expect.soft(entry.origin).toEqual({ id: `box:${back.txHash}+session:2`, origin: "session" });
    const bob = await privateRow(t, hash("b0"), "60000000");
    expect(await stealthMint(t, [row, bob])).toEqual([`${bob.tx_hash}#0`]);
  });

  it("one a session's collateral deposited, its mix never gone, is that session's money", async () => {
    const { t } = await withSession("40000000");
    const T = hash("d6");
    const chain = {
      id: hash("d8"), session: 0, progress: "seedelf.session.chain.preprod.0", deposit: hash("d1"), mixes: [hash("d2")],
      leaves: [inAda(hash("d2")), inAda(hash("d7"))],
      tail: { deposit: T, mix: hash("d7"), pool: ADA, box: inAda(T), leaf: inAda(hash("d7")), tries: 2, landed: t.clock.now - 30 * HOUR, over: true },
      boxes: 1, pools: { [ADA]: 2 }, total: 5, sent: 3, at: t.clock.now - 30 * HOUR, scheduled: true, stopped: CHAIN_CUT(), cut: true,
      ended: t.clock.now - 29 * HOUR,
    };
    t.koios.addedToAccounts.push(adaBox(T, await ownDatum(t.wallet), t.clock.now));
    await t.store.set("lovejoin.preprod", { due: [], chains: [chain] });
    const lj = witnessed(t);
    expect(await notMixed(lj)).toEqual([inAda(T)]);
    const { back, entry } = await bringBack(t, lj, T);
    expect(entry.origin).toEqual({ id: `box:${back.txHash}+session:0`, origin: "session" });
  });

  it("one a private Bootstrap holds is its session's money", async () => {
    const { t } = await withSession("40000000");
    const [D, R] = [hash("e3"), hash("e4")];
    const at = t.clock.now - 30 * HOUR;
    const chain = {
      id: R, session: 4, progress: "seedelf.lovejoin.test", deposit: D, mixes: [], leaves: [inAda(D)], boxes: 1, pools: { [ADA]: 1 },
      bootstrap: true, total: 2, sent: 2, done: true, at, scheduled: true, ended: at, found: true,
    };
    const entry = { id: R, deposit: D, at, session: 4, bootstrap: true, found: true, shares: [{ pool: ADA, boxes: 1 }] };
    t.koios.addedToAccounts.push(adaBox(D, await ownDatum(t.wallet), t.clock.now));
    await t.store.set("lovejoin.preprod", { due: [], chains: [chain], mixes: [entry] });
    const lj = witnessed(t);
    const { back, entry: written } = await bringBack(t, lj, D, false);
    expect(written.origin).toEqual({ id: `box:${back.txHash}+session:4`, origin: "session" });
  });

  it("after a restore, one a deposit of one of the phrase's one-time keys put in is that key's session's money", async () => {
    const { t } = await withSession("40000000");
    const A = hash("a7");
    const key = await t.wallet.withKeys((k) => k.oneTime.keyHash(3));
    t.koios.addedToAccounts.push(adaBox(A, await ownDatum(t.wallet), t.clock.now));
    t.koios.txSpends.set(A, paidBy(key));
    const lj = witnessed(t, { sessionIndices: async () => [0] });
    expect(await notMixed(lj)).toEqual([inAda(A)]);
    const { back, entry } = await bringBack(t, lj, A);
    expect(entry.origin).toEqual({ id: `box:${back.txHash}+session:3`, origin: "session" });
  });

  it("one whose making the wallet can't tell, brought back anyway, is Unknown", async () => {
    const { t } = await withSession("40000000");
    const C = hash("c7");
    t.koios.addedToAccounts.push(adaBox(C, await ownDatum(t.wallet), t.clock.now));
    t.koios.txSpends.set(C, paidBy("ee".repeat(28)));
    const fetch = t.koios.fetch;
    t.koios.fetch = async (url, init) => (url.includes("/tx_info") ? new Response("upstream", { status: 500 }) : fetch(url, init));
    const lj = witnessed(t);
    expect((await lj.status("preprod")).pools!.find((p) => p.id === ADA)!.unsure).toEqual([inAda(C)]);
    const { back, entry } = await bringBack(t, lj, C);
    expect(entry.origin).toEqual({ id: `unknown:${back.txHash}`, origin: "unknown" });
  });

  it("one a chain's last mix left is marked as a box a mix moved", async () => {
    const { t } = await withSession("40000000");
    const [D, M, R] = [hash("a1"), hash("a2"), hash("a3")];
    const at = t.clock.now - 30 * HOUR;
    const done = {
      id: R, session: 1, progress: "seedelf.lovejoin.test", deposit: D, mixes: [M], leaves: [inAda(M)], boxes: 1, pools: { [ADA]: 1 },
      total: 3, sent: 3, done: true, at, scheduled: true, ended: at, found: true, landed: true,
    };
    t.koios.addedToAccounts.push(adaBox(M, await ownDatum(t.wallet), t.clock.now));
    await t.store.set("lovejoin.preprod", { due: [], chains: [done] });
    const lj = witnessed(t);
    const { back, entry } = await bringBack(t, lj, M, false);
    expect(entry.origin).toEqual(mixed(back.txHash));
  });

  it("one Koios says a mix made, with no record of the wallet's, is marked as a box a mix moved", async () => {
    const { t } = await withSession("40000000");
    const X = hash("f3");
    t.koios.addedToAccounts.push(adaBox(X, await ownDatum(t.wallet), t.clock.now));
    madeByAdaMix(t.koios, X);
    const lj = witnessed(t);
    const { back, entry } = await bringBack(t, lj, X, false);
    expect(entry.origin).toEqual(mixed(back.txHash));
  });

  it("one a chain's own mix made short of its last mixes is a box with no such mark, as PRIV-3 has a mix's output", async () => {
    const { t } = await withSession("40000000");
    const [D, M1, M2, R] = [hash("b1"), hash("b2"), hash("b3"), hash("b4")];
    const cut = {
      id: R, session: 1, progress: "seedelf.lovejoin.test", deposit: D, mixes: [M1, M2], leaves: [inAda(M2)], boxes: 1, pools: { [ADA]: 1 },
      total: 4, sent: 2, at: t.clock.now - 2 * HOUR, scheduled: true, stopped: CHAIN_CUT(), cut: true, ended: t.clock.now - 2 * HOUR,
    };
    t.koios.addedToAccounts.push(adaBox(M1, await ownDatum(t.wallet), t.clock.now));
    await t.store.set("lovejoin.preprod", { due: [], chains: [cut] });
    const lj = witnessed(t);
    expect(await notMixed(lj)).toEqual([inAda(M1)]);
    const { entry } = await bringBack(t, lj, M1);
    expect(entry.origin).toBeUndefined();
  });
});

/** The 12-word wallet after its history's first reading (the fixture's rows are Unknown), and two private rows. */
async function wallet() {
  const v = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
  const t = testBalances();
  await t.wallet.create(v.phrase, PASSWORD);
  // One spend: a funding that takes one UTxO alone (history-classes.test.ts, L41).
  const evaluation = withdrawPreprod.amount.evaluation as { result: unknown[] };
  t.koios.evaluation = { ...evaluation, result: evaluation.result.slice(0, 1) };
  await t.balances.get("preprod");
  return t;
}

/** A box back from Lovejoin the wallet brought back, as its withdraw's entry has it: `origin` as written, none before this round. */
async function boxBack(t: Tested, lovelace: string, txHash: string, origin?: HistoryClass): Promise<KoiosUtxo> {
  const back: PendingTx = { kind: "lovejoin-withdraw", network: "preprod", txHash, submittedAt: t.clock.now, confirmations: null };
  await t.activity.sent("preprod", back, { lovelace, ...(origin ? { origin } : {}) });
  return privateRow(t, txHash, lovelace);
}

/**
 * What `kind`'s build kept for its submit (`key`), sent as its submit records it: its inputs spent (script-spend.ts
 * `send`), and its entry in the history (pending.ts).
 */
async function sent(t: Tested, key: string, kind: PendingTx["kind"]): Promise<{ txHash: string; origin?: HistoryClass }> {
  const kept = (await t.session.get<{ txHash: string; txCbor: string; origin?: HistoryClass }>(key))!;
  await t.wallet.withKeys(() => rememberSpent(t.session, "preprod", Uint8Array.from(Buffer.from(kept.txCbor, "hex")), t.clock.now));
  await t.activity.sent("preprod", { kind, network: "preprod", txHash: kept.txHash, submittedAt: t.clock.now, confirmations: null }, kept);
  return kept;
}

describe("a stranger's copy of a register already on chain (chunk 51, money#1, own#2)", () => {
  it("never takes a box's class: a Seedelf minted from a box, copied, is Unknown, and the stealth mint takes a box [needs the rebuild]", { timeout: 60_000 }, async () => {
    const t = await wallet();
    const seedelfA = ownedUtxos.find((u) => (u.asset_list ?? []).some((a) => a.policy_id === CONTRACT_V1.seedelfPolicyId))!;
    // Seedelf A was minted from box B before this round: its mint's history is the box's alone (mint.ts).
    const mint: PendingTx = { kind: "mint", network: "preprod", txHash: seedelfA.tx_hash, submittedAt: t.clock.now, confirmations: null };
    await t.activity.sent("preprod", mint, { lovelace: seedelfA.value, label: "", origin: { id: `box:${hash("bb")}`, origin: "lovejoin" } });
    const boxC = await boxBack(t, "4800000", hash("cc"), mixed(hash("cc")));
    const boxD = await boxBack(t, "4800000", hash("cd"), mixed(hash("cd")));
    const bob = await privateRow(t, hash("b0"), "60000000");
    // Mallory pays under A's datum byte for byte, less than any box.
    const mallory = { ...(await privateRow(t, hash("e7"), "4500000")), inline_datum: seedelfA.inline_datum };
    const M = `${mallory.tx_hash}#0`;
    t.koios.added.push(boxC, boxD, bob, mallory);
    t.clock.now += 60_000;
    await t.balances.get("preprod", true);
    const classes = await t.activity.classes("preprod", [boxC, boxD, bob, mallory], [...ownedUtxos, boxC, boxD, bob, mallory]);
    expect.soft(classes.get(M)).toEqual({ id: `unknown:${mallory.tx_hash}`, origin: "unknown" });
    const { seedelf: rows } = await t.coins.lists("preprod");
    const tagged = rows.find((u) => u.txHash === mallory.tx_hash)?.history;
    expect.soft(tagged && historyTags(tagged)).toEqual(["Unknown"]);
    await t.mint.build("preprod", "", "seedelf");
    const spent = inputsOf((await t.session.get<{ txCbor: string }>(SESSION_MINT))!.txCbor);
    expect([[`${boxC.tx_hash}#0`], [`${boxD.tx_hash}#0`]]).toContainEqual(spent);
  });

  it("a copy of a box's own way back is Unknown too, never that box", { timeout: 60_000 }, async () => {
    const t = await wallet();
    const boxC = await boxBack(t, "4800000", hash("cc"), mixed(hash("cc")));
    const copy = { ...(await privateRow(t, hash("e8"), "4000000")), inline_datum: boxC.inline_datum };
    t.koios.added.push(boxC, copy);
    t.clock.now += 60_000;
    await t.balances.get("preprod", true);
    const classes = await t.activity.classes("preprod", [boxC, copy]);
    expect(classes.get(`${copy.tx_hash}#0`)).toEqual({ id: `unknown:${copy.tx_hash}`, origin: "unknown" });
  });
});

describe("what a spend of the wallet's own leaves (chunk 51, money#2, own#1, the owner's answer 2)", () => {
  it("a stealth mint's change names the mint: the next stealth mint takes a payment received first", { timeout: 60_000 }, async () => {
    const t = await wallet();
    const bob = await privateRow(t, hash("b0"), "20000000");
    const carol = await privateRow(t, hash("c0"), "30000000");
    expect(await stealthMint(t, [bob, carol])).toEqual([`${bob.tx_hash}#0`]);
    const first = await sent(t, SESSION_MINT, "mint");
    expect.soft(first.origin).toEqual({ id: `change:${first.txHash}+received:${bob.tx_hash}`, origin: "session" });
    // It lands: Bob's payment spent, the mint's change (about 18 ₳) in its place.
    t.koios.added.splice(t.koios.added.indexOf(bob), 1);
    t.koios.spent.add(`${bob.tx_hash}#0`);
    const change = await privateRow(t, first.txHash, "18000000", 1);
    expect(await stealthMint(t, [change])).toEqual([`${carol.tx_hash}#0`]);
  });

  it("after a stealth mint from a box a mix brought back, the next takes another such box, then a payment, never its change [needs the rebuild]", { timeout: 60_000 }, async () => {
    const t = await wallet();
    const b1 = await boxBack(t, "9710000", hash("b1"), mixed(hash("b1")));
    const carol = await privateRow(t, hash("c0"), "30000000");
    expect(await stealthMint(t, [b1, carol])).toEqual([`${b1.tx_hash}#0`]);
    const first = await sent(t, SESSION_MINT, "mint");
    expect.soft(first.origin).toEqual({ id: `box:${b1.tx_hash}+change:${first.txHash}`, origin: "session" });
    t.koios.added.splice(t.koios.added.indexOf(b1), 1);
    t.koios.spent.add(`${b1.tx_hash}#0`);
    const change = await privateRow(t, first.txHash, "7700000", 1);
    const b2 = await boxBack(t, "9710000", hash("b2"), mixed(hash("b2")));
    expect(await stealthMint(t, [change, b2])).toEqual([`${b2.tx_hash}#0`]);
    await sent(t, SESSION_MINT, "mint");
    t.koios.added.splice(t.koios.added.indexOf(b2), 1);
    t.koios.spent.add(`${b2.tx_hash}#0`);
    expect(await stealthMint(t, [])).toEqual([`${carol.tx_hash}#0`]);
  });

  it("a Make public to the user's own account leaves that account's money: a funding takes a payment received first", { timeout: 60_000 }, async () => {
    const t = await wallet();
    const bob = await privateRow(t, hash("b0"), "60000000");
    const carol = await privateRow(t, hash("c0"), "50000000");
    t.koios.added.push(bob, carol);
    t.clock.now += 60_000;
    await t.balances.get("preprod", true);
    const own = await t.wallet.withKeys((keys) => keys.cardano.receiveAddress(loadTestWasm().Network.Preprod, 0));
    await t.withdraw.build("preprod", [{ to: own, lovelace: "20000000", tokens: [] }]);
    const made = await sent(t, SESSION_WITHDRAW, "withdraw");
    expect.soft(made.origin).toEqual({ id: `public:0+received:${carol.tx_hash}`, origin: "own" });
    // It lands: Carol's payment spent, its change (about 30 ₳) in its place.
    t.koios.added.splice(t.koios.added.indexOf(carol), 1);
    t.koios.spent.add(`${carol.tx_hash}#0`);
    t.koios.added.push(await privateRow(t, made.txHash, "29800000", 1));
    t.clock.now += 60_000;
    await t.balances.get("preprod", true);
    const quote = await t.sessions.quote("preprod", minswapEstimate.ask);
    await t.sessions.outBuild("preprod", quote);
    expect(inputsOf((await t.session.get<{ txCbor: string }>(SESSION_OUT))!.txCbor)).toEqual([`${bob.tx_hash}#0`]);
  });

  it("a Make public to someone else's address, and a private Send, leave change naming their spend", { timeout: 60_000 }, async () => {
    const t = await wallet();
    const bob = await privateRow(t, hash("b0"), "60000000");
    t.koios.added.push(bob);
    t.clock.now += 60_000;
    await t.balances.get("preprod", true);
    await t.withdraw.build("preprod", [{ to: preprodAddress("ee".repeat(28)), lovelace: "10000000", tokens: [] }]);
    const made = (await t.session.get<{ txHash: string; origin?: HistoryClass }>(SESSION_WITHDRAW))!;
    expect.soft(made.origin).toEqual({ id: `change:${made.txHash}+received:${bob.tx_hash}`, origin: "session" });
    await t.transfer.build("preprod", [{ to: transferPreprod.to, lovelace: "10000000", tokens: [] }]);
    const paid = (await t.session.get<{ txHash: string; origin?: HistoryClass }>(SESSION_TRANSFER))!;
    expect(paid.origin).toEqual({ id: `change:${paid.txHash}+received:${bob.tx_hash}`, origin: "session" });
  });

  it("a Seedelf removed into the private balance leaves what it held naming the removal", { timeout: 60_000 }, async () => {
    const t = await wallet();
    const seedelfA = ownedUtxos.find((u) => (u.asset_list ?? []).some((a) => a.policy_id === CONTRACT_V1.seedelfPolicyId))!;
    // A Seedelf of the wallet's holding enough to come back into the contract, minted from a payment Bob made.
    const name = `5eed0e1f${"42".repeat(28)}`;
    const token = { ...seedelfA.asset_list![0]!, asset_name: name, quantity: "1" };
    const seedelf = { ...(await privateRow(t, hash("5e"), "10000000")), asset_list: [token] };
    const minted: PendingTx = { kind: "mint", network: "preprod", txHash: seedelf.tx_hash, submittedAt: t.clock.now, confirmations: null };
    await t.activity.sent("preprod", minted, { lovelace: seedelf.value, label: "", origin: { id: `received:${hash("b0")}`, origin: "received" } });
    t.koios.added.push(seedelf);
    t.clock.now += 60_000;
    await t.balances.get("preprod", true);
    await t.withdraw.buildRemove("preprod", name, "seedelf");
    const removed = (await t.session.get<{ txHash: string; origin?: HistoryClass }>(SESSION_REMOVE))!;
    expect(removed.origin).toEqual({ id: `change:${removed.txHash}+received:${hash("b0")}`, origin: "session" });
  });
});

describe("a box the wallet has no record of a mix moving (chunk 51, the owner's answer 4)", () => {
  it("brought back before this round, it goes after a payment received for a stealth mint [needs the rebuild]", { timeout: 60_000 }, async () => {
    const t = await wallet();
    const old = await boxBack(t, "4800000", hash("bb"));
    const bob = await privateRow(t, hash("b0"), "60000000");
    expect(await stealthMint(t, [old, bob])).toEqual([`${bob.tx_hash}#0`]);
  });
});
