// Where each private UTxO's money came from, as the sealed history says
// (independent review): what a restored wallet's history finds already there
// is Unknown, not a payment received (L38); money still held never ages out
// of the history, and Unknown money is kept apart by its transaction (L40); a
// session's funding change and return carry what paid for the session, and
// all of a session's money is one history (L41).
import { describe, expect, it } from "vitest";

import type { KoiosUtxo } from "../src/background/koios";
import { classesOf, spentHistories } from "../src/background/script-spend";
import { SESSION_OUT } from "../src/background/sessions";
import { boxFrom, historiesNote, historyTags, unknownIn, type HistoryClass } from "../src/shared/histories";
import type { PendingTx } from "../src/shared/rpc";
import { activityTitle } from "../src/ui/activity";
import { busyFor, minswapEstimate, ownedUtxos, testBalances, vectors, withdrawPreprod } from "./fakes";

const PASSWORD = "correct horse battery";

async function unlocked(options?: { owned?: boolean }) {
  const v = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
  const t = testBalances(options);
  await t.wallet.create(v.phrase, PASSWORD);
  return t;
}

/** One of the wallet's contract UTxOs, made by the transaction `hex` repeated. */
const at = (hex: string, index = 0): KoiosUtxo => ({ ...ownedUtxos[0]!, tx_hash: hex.repeat(32), tx_index: index, block_height: 9_000_001 });
const [a1, a2] = [ownedUtxos[0]!, ownedUtxos[1]!];

describe("a private history this device starts (independent review L38)", () => {
  it("notes what its first reading finds as already there, from no one known, and what arrives after as received", async () => {
    const t = await unlocked();
    // A restore: the private balance holds money from before.
    await t.balances.get("preprod");
    const found = await t.activity.seedelf("preprod");
    expect(found).toHaveLength(2);
    expect(found.every((e) => e.kind === "received" && e.origin?.origin === "unknown")).toBe(true);
    expect(found.map(activityTitle)).toEqual(["Already in your private balance", "Already in your private balance"]);
    const before = await t.activity.classes("preprod", [a1, a2]);
    expect([...before.values()].map((c) => c.origin)).toEqual(["unknown", "unknown"]);
    // The UTxOs screen says Unknown, never Received.
    const { seedelf } = await t.coins.lists("preprod");
    const tags = seedelf.filter((u) => u.history).map((u) => historyTags(u.history!));
    expect(tags).toEqual([["Unknown"], ["Unknown"]]);

    // Someone pays after it started: that's a payment received.
    const paid = at("77");
    t.koios.added.push(paid);
    t.clock.now += 60_000;
    await t.balances.get("preprod", true);
    const [latest] = await t.activity.seedelf("preprod");
    expect(latest).toMatchObject({ txHash: paid.tx_hash, kind: "received" });
    expect(latest!.origin).toBeUndefined();
    expect(activityTitle(latest!)).toBe("Received");
    const after = await t.activity.classes("preprod", [paid]);
    expect([...after.values()]).toEqual([{ id: `received:${paid.tx_hash}`, origin: "received" }]);
  });

  it("changes nothing for a brand-new wallet: its first reading finds nothing, and every arrival is received", async () => {
    const t = await unlocked({ owned: false });
    await t.balances.get("preprod");
    expect(await t.activity.seedelf("preprod")).toEqual([]);
    const paid = at("78");
    t.koios.added.push(paid);
    t.clock.now += 60_000;
    await t.balances.get("preprod", true);
    const entries = await t.activity.seedelf("preprod");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "received" });
    expect(entries[0]!.origin).toBeUndefined();
  });

  it("keeps what the wallet sent before its first reading, and the rest was there before it", async () => {
    const t = await unlocked();
    const moved: PendingTx = { kind: "move-in", network: "preprod", txHash: a2.tx_hash, submittedAt: 1, confirmations: null };
    await t.activity.sent("preprod", moved, { lovelace: a2.value });
    await t.balances.get("preprod");
    const classes = await t.activity.classes("preprod", [a1, a2]);
    expect(classes.get(`${a2.tx_hash}#0`)).toEqual({ id: "public", origin: "own" });
    expect(classes.get(`${a1.tx_hash}#0`)?.origin).toBe("unknown");
  });

  it("takes what the first reading finds made well after the history began for a payment received", async () => {
    // A brand-new wallet whose readings failed until after its first transaction, a stealth mint, started the
    // history; then someone paid the new Seedelf.
    const t = await unlocked({ owned: false });
    const minted: PendingTx = { kind: "mint", network: "preprod", txHash: "7b".repeat(32), submittedAt: t.clock.now, confirmations: null };
    await t.activity.sent("preprod", minted, { label: "new" });
    const began = t.clock.now / 1000;
    // A minute after, within what the clocks may differ by, and two hours after.
    const soon = { ...at("7c"), block_time: began + 60 };
    const later = { ...at("7d"), block_time: began + 2 * 3600 };
    t.koios.added.push(soon, later);
    await busyFor(t, 3 * 3600_000);
    await t.balances.get("preprod");
    const entries = await t.activity.seedelf("preprod");
    const paid = entries.find((e) => e.txHash === later.tx_hash)!;
    expect(paid).toMatchObject({ kind: "received" });
    expect(paid.origin).toBeUndefined();
    expect(activityTitle(paid)).toBe("Received");
    // The safe side: it may have been there before.
    expect(entries.find((e) => e.txHash === soon.tx_hash)?.origin?.origin).toBe("unknown");
    const classes = await t.activity.classes("preprod", [later]);
    expect([...classes.values()]).toEqual([{ id: `received:${later.tx_hash}`, origin: "received" }]);
  });

  it("leaves a history kept from before as it was: what arrives is received", async () => {
    const t = await unlocked();
    // Written by a build without the first-reading mark.
    await t.deps.store.set("history.preprod", { entries: [], seen: [] });
    await t.balances.get("preprod");
    const entries = await t.activity.seedelf("preprod");
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.kind === "received" && e.origin === undefined)).toBe(true);
  });

  it("names an account's transaction by what the account did, never by what the private side noted arriving", async () => {
    // Where one of the account's own transactions paid the private balance (a move-in from before a
    // restore, or from another profile), the private side noted it arriving.
    const plain = await unlocked();
    await plain.balances.get("preprod");
    const { entries } = await plain.activity.cardano("preprod");
    const sent = entries.find((e) => e.kind === "sent")!;
    expect(sent).toBeDefined();

    const t = await unlocked();
    await t.balances.get("preprod");
    await t.activity.arrived("preprod", [{ ...at("79"), tx_hash: sent.txHash }]);
    expect((await t.activity.seedelf("preprod")).some((e) => e.txHash === sent.txHash && e.kind === "received")).toBe(true);
    const account = await t.activity.cardano("preprod");
    expect(account.entries.find((e) => e.txHash === sent.txHash)).toMatchObject({ kind: "sent", direction: sent.direction });
  });
});

describe("money whose history the wallet keeps apart (independent review L40)", () => {
  const withdraw = (hex: string): PendingTx => ({
    kind: "lovejoin-withdraw",
    network: "preprod",
    txHash: hex.repeat(32),
    submittedAt: 1,
    confirmations: null,
  });

  it("never lets a box still held age out of the history, however much comes after", async () => {
    const t = await unlocked({ owned: false });
    await t.activity.arrived("preprod", []);
    // Two boxes back from Lovejoin, the oldest entries.
    await t.activity.sent("preprod", withdraw("0a"), { lovelace: "9710000" });
    await t.activity.sent("preprod", withdraw("0b"), { lovelace: "9710000" });
    const boxes = [at("0a"), at("0b")];
    // Then 500 payments, since spent, and one more arriving now.
    const hex = (i: number) => i.toString(16).padStart(4, "0").repeat(16);
    const payments = Array.from({ length: 500 }, (_, i) => ({ ...at("00"), tx_hash: hex(i + 1), block_time: 1_800_000_000 + i }));
    await t.activity.arrived("preprod", [...boxes, ...payments]);
    await t.activity.arrived("preprod", [...boxes, { ...at("0c"), block_time: 1_900_000_000 }]);
    // 500 kept: the two boxes, oldest of all, among them.
    const entries = await t.activity.seedelf("preprod");
    expect(entries).toHaveLength(500);
    expect(entries.slice(-2).map((e) => e.kind)).toEqual(["lovejoin-withdraw", "lovejoin-withdraw"]);
    const classes = await t.activity.classes("preprod", boxes);
    expect([...classes.values()]).toEqual([
      { id: `box:${"0a".repeat(32)}`, origin: "lovejoin" },
      { id: `box:${"0b".repeat(32)}`, origin: "lovejoin" },
    ]);
    // Once spent, they're trimmed like the rest, the oldest first.
    await t.activity.arrived("preprod", [
      { ...at("0d"), block_time: 1_900_000_001 },
      { ...at("0e"), block_time: 1_900_000_002 },
    ]);
    const left = await t.activity.seedelf("preprod");
    expect(left).toHaveLength(500);
    expect(left.some((e) => e.kind === "lovejoin-withdraw")).toBe(false);
  });

  it("gives Unknown money a class per transaction while anything else's is known, and one Unknown when nothing is", async () => {
    const t = await unlocked({ owned: false });
    await t.activity.arrived("preprod", []);
    await t.activity.sent("preprod", withdraw("0a"), { lovelace: "9710000" });
    const known = await t.activity.classes("preprod", [at("0a"), at("e1"), at("e1", 1), at("e2")]);
    expect([...known.values()]).toEqual([
      { id: `box:${"0a".repeat(32)}`, origin: "lovejoin" },
      unknownIn("e1".repeat(32)),
      unknownIn("e1".repeat(32)),
      unknownIn("e2".repeat(32)),
    ]);
    // Nothing known: one Unknown, so selection picks as the CLI does.
    const blind = await t.activity.classes("preprod", [at("e1"), at("e2")]);
    expect([...blind.values()]).toEqual([
      { id: "unknown", origin: "unknown" },
      { id: "unknown", origin: "unknown" },
    ]);

    // WebAssembly is given the ones kept apart, and never a plain Unknown.
    const deps = { activity: t.activity };
    const given = await classesOf(deps, "preprod", [at("0a"), at("e1"), at("e2")]);
    expect(Object.keys(given).sort()).toEqual([`${"0a".repeat(32)}#0`, `${"e1".repeat(32)}#0`, `${"e2".repeat(32)}#0`]);
    expect(await classesOf(deps, "preprod", [at("e1"), at("e2")])).toEqual({});
  });

  it("says so when a spend merges Unknown money of two transactions", () => {
    const a = unknownIn("e1".repeat(32));
    const b = unknownIn("e2".repeat(32));
    const classes = { [`${"e1".repeat(32)}#0`]: a, [`${"e2".repeat(32)}#0`]: b };
    const inputs = [
      { txHash: "e1".repeat(32), txIndex: 0 },
      { txHash: "e2".repeat(32), txIndex: 0 },
    ];
    const spent = spentHistories(classes, inputs, [a.id, b.id]);
    expect(spent).toEqual([a, b]);
    expect(historiesNote(spent)).toBe(
      "This spends money from 2 transactions the wallet has no history for together. Anyone can see they're one owner's, which ties them to each other.",
    );
    expect(historyTags(a)).toEqual(["Unknown"]);
    // With nothing known, WebAssembly merges nothing it can name, and nothing is said.
    expect(spentHistories({}, inputs, [])).toBeUndefined();
  });
});

describe("a session's funding change and return (independent review L41)", () => {
  const sent = (kind: PendingTx["kind"], txHash: string): PendingTx => ({ kind, network: "preprod", txHash, submittedAt: 1, confirmations: null });

  it("carry the box that paid for the session, so a later review counts it", async () => {
    const t = await unlocked();
    // One spend: the funding takes the 25 ₳ UTxO alone, a box back from Lovejoin.
    const evaluation = withdrawPreprod.amount.evaluation as { result: unknown[] };
    t.koios.evaluation = { ...evaluation, result: evaluation.result.slice(0, 1) };
    await t.activity.arrived("preprod", []);
    await t.activity.sent("preprod", sent("lovejoin-withdraw", a1.tx_hash), { lovelace: a1.value });
    await t.balances.get("preprod");
    const quote = await t.sessions.quote("preprod", minswapEstimate.ask);
    const out = await t.sessions.outBuild("preprod", quote);
    expect(out.inputs).toBe(1);

    // Kept for Send with what its change carries: the box's history and the session's.
    const kept = (await t.session.get<Record<string, unknown> & { origin: HistoryClass; index: number }>(SESSION_OUT))!;
    const change: HistoryClass = { id: `${boxFrom(a1.tx_hash).id}+session:${kept.index}`, origin: "session" };
    expect(kept.origin).toEqual(change);
    // Sent (pending.ts writes the kept summary down), its change is classed so.
    const { txCbor: _txCbor, seed: _seed, builtAt: _builtAt, ...summary } = kept;
    await t.activity.sent("preprod", sent("session-out", out.txHash), summary);
    const changeUtxo = { ...at("00"), tx_hash: out.txHash, tx_index: 1 };
    const returned = at("5b");
    const otherBox = at("5c");
    await t.activity.sent("preprod", sent("lovejoin-withdraw", otherBox.tx_hash), { lovelace: "9710000" });

    // Its return, written without a history of its own, carries the same: one history with the change.
    await t.activity.sent("preprod", sent("session-back", returned.tx_hash), { index: kept.index, lovelace: "4000000" });
    const classes = await t.activity.classes("preprod", [changeUtxo, returned, otherBox]);
    expect(classes.get(`${out.txHash}#1`)).toEqual(change);
    expect(classes.get(`${returned.tx_hash}#0`)).toEqual(change);

    // Spending the change with another box ties two boxes, and the note says so.
    const n = kept.index + 1;
    expect(historiesNote([change, boxFrom(otherBox.tx_hash)])).toBe(
      `This spends 2 boxes back from Lovejoin and money from Private session ${n} together. Anyone can see they're one owner's, which ties them to each other, and undoes some of what Lovejoin did for the boxes.`,
    );
    // The change and the return together tie nothing new: one history, no note.
    const byOutpoint = Object.fromEntries(classes);
    const both = [
      { txHash: out.txHash, txIndex: 1 },
      { txHash: returned.tx_hash, txIndex: 0 },
    ];
    expect(historiesNote(spentHistories(byOutpoint, both, []))).toBeUndefined();
    expect(historyTags(change)).toEqual(["Back from Lovejoin", `Private session ${n}`]);
  });

  it("are one history with a top-up's change and the return, however each was paid for", async () => {
    const t = await unlocked({ owned: false });
    await t.activity.arrived("preprod", []);
    const [boxTx, paidTx, fundTx, topUpTx, backTx, ownTx] = ["aa", "bb", "f1", "f2", "5b", "01"].map((h) => h.repeat(32));
    // Session 3 (the fourth): its funding took box aa alone, its top-up a payment received in bb. Each
    // funding's change is written with what paid for it (sessions.ts buildFunding).
    await t.activity.sent("preprod", sent("lovejoin-withdraw", boxTx!), { lovelace: "9710000" });
    await t.activity.sent("preprod", sent("session-out", fundTx!), {
      index: 3,
      lovelace: "2000000",
      origin: { id: `box:${boxTx}+session:3`, origin: "session" },
    });
    await t.activity.sent("preprod", sent("session-out", topUpTx!), {
      index: 3,
      lovelace: "2000000",
      origin: { id: `received:${paidTx}+session:3`, origin: "session" },
    });
    await t.activity.sent("preprod", sent("move-in", ownTx!), { lovelace: "10000000" });
    const c1 = { ...at("f1"), tx_index: 1 };
    const c2 = { ...at("f2"), tx_index: 1 };
    const own = at("01");

    // Both changes are one class: on chain, both fundings paid the session's account.
    const session: HistoryClass = { id: `box:${boxTx}+received:${paidTx}+session:3`, origin: "session" };
    let classes = await t.activity.classes("preprod", [c1, c2, own]);
    expect(classes.get(`${fundTx}#1`)).toEqual(session);
    expect(classes.get(`${topUpTx}#1`)).toEqual(session);
    expect(classes.get(`${ownTx}#0`)).toEqual({ id: "public", origin: "own" });
    // So spending the two together is noted as nothing, and never counted as a merge.
    const byOutpoint = () => Object.fromEntries(classes);
    const changes = [
      { txHash: fundTx!, txIndex: 1 },
      { txHash: topUpTx!, txIndex: 1 },
    ];
    expect(spentHistories(byOutpoint(), changes, [])).toEqual([session]);
    expect(historiesNote(spentHistories(byOutpoint(), changes, []))).toBeUndefined();
    expect(historyTags(session)).toEqual(["Back from Lovejoin", "Received", "Private session 4"]);

    // Its return, even one written with only the session's class, is the same history.
    await t.activity.sent("preprod", sent("session-back", backTx!), {
      index: 3,
      lovelace: "3000000",
      origin: { id: "session:3", origin: "session" },
    });
    const back = at("5b");
    classes = await t.activity.classes("preprod", [c1, c2, back]);
    expect(new Set(classes.values())).toEqual(new Set([session]));
    const withBack = [...changes, { txHash: backTx!, txIndex: 0 }];
    expect(historiesNote(spentHistories(byOutpoint(), withBack, []))).toBeUndefined();

    // Another session's money stays apart.
    const otherTx = "f3".repeat(32);
    await t.activity.sent("preprod", sent("session-out", otherTx), { index: 4, lovelace: "2000000" });
    classes = await t.activity.classes("preprod", [c1, { ...at("f3"), tx_index: 1 }]);
    expect(classes.get(`${otherTx}#1`)).toEqual({ id: "session:4", origin: "session" });
    expect(classes.get(`${fundTx}#1`)).toEqual(session);
  });
});
