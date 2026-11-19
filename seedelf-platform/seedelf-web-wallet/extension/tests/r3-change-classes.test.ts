// Chunk 51, the owner's calls round, round three: a spend's change and the copies of a register already on chain (the
// owner's answers of 2026-11-18).
//
// - A spend's change names the spend, `change:<tx>`, from now on; change kept before this release gets the same part
//   when the history is read (activity.ts classOf), asking nothing and keeping nothing new, for the spends that leave
//   change in the private balance, never where the kept history names a public account (l2time#2).
// - "Earlier change first": a stealth mint, a pool's start from the private balance and a private session's funding
//   that nothing fresher pays (a box a mix moved, money others paid) take an earlier private spend's change before money
//   the user made private; change whose history names a public account stays after that money (l2rank#6). Its class
//   reads `change` to selection (core Origin::Change).
// - A copy of a register already on chain never takes a box: what it takes of the row it copies is that row's history
//   less any box, with its own Unknown in the box's place (l2rank#4).
// - The review's note names a spend's change as such (l2rank#5).
//
// Driven through the worker's services with the real WebAssembly. The cases marked so need it built with core's ranks
// of this round (Origin::Change): the package from before refuses a `change` origin.
import { describe, expect, it } from "vitest";

import { CONTRACT_V1 } from "../src/background/balances";
import { txInputs } from "../src/background/cbor";
import type { KoiosUtxo } from "../src/background/koios";
import { SESSION_MINT } from "../src/background/mint";
import { SESSION_OUT } from "../src/background/sessions";
import { rememberSpent } from "../src/background/spent";
import {
  boxFrom,
  historiesNote,
  historyTags,
  isHistoryClass,
  leftBy,
  madePrivate,
  merged,
  mixedBox,
  receivedIn,
  sessionClass,
  spentElsewhere,
  unknownIn,
  UNKNOWN,
  type HistoryClass,
} from "../src/shared/histories";
import type { PendingTx } from "../src/shared/rpc";
import type { Tested } from "./chain-fixtures";
import { loadTestWasm, minswapEstimate, ownedUtxos, testBalances, vectors, withdrawPreprod } from "./fakes";

const PASSWORD = "correct horse battery";
const hash = (h: string) => (h.length === 64 ? h : h.repeat(32));
const inputsOf = (cbor: string) => txInputs(Uint8Array.from(Buffer.from(cbor, "hex")));

/** A UTxO of the wallet's at the Seedelf contract, `txHash#index`, under a fresh re-randomization of its register. */
async function privateRow(t: Tested, txHash: string, lovelace: string, index = 0): Promise<KoiosUtxo> {
  const wasm = loadTestWasm();
  const bytes = await t.wallet.withKeys((keys) => Buffer.from(wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister()))).toString("hex"));
  return { ...ownedUtxos[0]!, tx_hash: txHash, tx_index: index, value: lovelace, asset_list: [], inline_datum: { bytes, value: null }, block_height: 9_000_001 };
}

/** The 12-word wallet after its history's first reading; `owned`: with the fixture's rows (Unknown), or none. */
async function wallet(owned = true) {
  const v = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
  const t = testBalances({ owned });
  await t.wallet.create(v.phrase, PASSWORD);
  // One spend: a funding that takes one UTxO alone (history-classes.test.ts, L41).
  const evaluation = withdrawPreprod.amount.evaluation as { result: unknown[] };
  t.koios.evaluation = { ...evaluation, result: evaluation.result.slice(0, 1) };
  await t.balances.get("preprod");
  return t;
}

/** A spend of the wallet's own, `kind`, as an entry of the history keeps it: `origin` as it was written. */
async function spent(t: Tested, kind: PendingTx["kind"], txHash: string, origin: HistoryClass, extra: object = {}) {
  const pending: PendingTx = { kind, network: "preprod", txHash, submittedAt: t.clock.now, confirmations: null };
  await t.activity.sent("preprod", pending, { lovelace: "10000000", origin, ...extra });
}

/** `rows` land in the private balance. */
async function land(t: Tested, rows: KoiosUtxo[]) {
  t.koios.added.push(...rows);
  t.clock.now += 60_000;
  await t.balances.get("preprod", true);
}

/** What `kind`'s build kept for its submit (`key`), sent as its submit records it. */
async function sentKept(t: Tested, key: string, kind: PendingTx["kind"]): Promise<{ txHash: string; origin?: HistoryClass }> {
  const kept = (await t.session.get<{ txHash: string; txCbor: string; origin?: HistoryClass }>(key))!;
  await t.wallet.withKeys(() => rememberSpent(t.session, "preprod", Uint8Array.from(Buffer.from(kept.txCbor, "hex")), t.clock.now));
  await t.activity.sent("preprod", { kind, network: "preprod", txHash: kept.txHash, submittedAt: t.clock.now, confirmations: null }, kept);
  return kept;
}

/** `rows` land in the private balance; then what a stealth mint from it spends. */
async function stealthMint(t: Tested, rows: KoiosUtxo[]): Promise<string[]> {
  await land(t, rows);
  await t.mint.build("preprod", "", "seedelf");
  return inputsOf((await t.session.get<{ txCbor: string }>(SESSION_MINT))!.txCbor);
}

/** What a private session's funding of the swap fixture spends. */
async function funding(t: Tested): Promise<string[]> {
  await t.sessions.outBuild("preprod", await t.sessions.quote("preprod", minswapEstimate.ask));
  return inputsOf((await t.session.get<{ txCbor: string }>(SESSION_OUT))!.txCbor);
}

const R0 = hash("c0");
const paidByR0 = receivedIn(R0);

describe("change a private spend left before this release reads its spend's part (chunk 51, l2time#2)", () => {
  it.each([
    ["a private Send", "transfer" as const, { payments: [{ to: "addr_test1", lovelace: "10000000", tokens: [] }] }],
    ["a Make public to someone else", "withdraw" as const, { payments: [{ address: "addr_test1", lovelace: "10000000", tokens: [] }] }],
    ["a stealth mint", "mint" as const, { label: "" }],
    ["a removal into the private balance", "remove" as const, { label: "", name: "5eed0e1f" }],
    ["a pool's start from the private balance", "lovejoin-launch" as const, { from: "private" }],
  ])("%s, kept with its inputs' history alone, is tied to that spend: tagged Change, ranked as change", { timeout: 60_000 }, async (_, kind, extra) => {
    const t = await wallet();
    const S = hash("51");
    await spent(t, kind, S, paidByR0, extra);
    const c1 = await privateRow(t, S, "29800000", 1);
    await land(t, [c1]);
    const c = (await t.activity.classes("preprod", [c1])).get(`${S}#1`)!;
    expect.soft(c).toEqual({ id: `change:${S}+received:${R0}`, origin: "change" });
    expect(historyTags(c)).toEqual(["Change", "Received"]);
  });

  it("never where the history kept names a public account: a Make public to the user's own, an account-paid mint", { timeout: 60_000 }, async () => {
    const t = await wallet();
    const [W, M] = [hash("52"), hash("53")];
    await spent(t, "withdraw", W, merged([madePrivate(0), paidByR0]), { payments: [{ address: "addr_test1", lovelace: "10000000", tokens: [] }] });
    await spent(t, "mint", M, madePrivate(1), { label: "" });
    const [w, m] = [await privateRow(t, W, "29800000", 1), await privateRow(t, M, "1800000")];
    await land(t, [w, m]);
    const classes = await t.activity.classes("preprod", [w, m]);
    expect(classes.get(`${W}#1`)).toEqual({ id: `public:0+received:${R0}`, origin: "own" });
    expect(classes.get(`${M}#0`)).toEqual({ id: "public:1", origin: "own" });
  });

  it("nor a session's funding: its history names its own tie, the session's", { timeout: 60_000 }, async () => {
    const t = await wallet();
    const O = hash("54");
    await spent(t, "session-out", O, merged([paidByR0, sessionClass(2)]), { index: 2 });
    const o = await privateRow(t, O, "29800000", 1);
    await land(t, [o]);
    const classes = await t.activity.classes("preprod", [o]);
    expect(classes.get(`${O}#1`)).toEqual({ id: `received:${R0}+session:2`, origin: "session" });
  });

  it("a funding takes Bob's payment before an old Send's change [needs the rebuild]", { timeout: 60_000 }, async () => {
    const t = await wallet();
    const S = hash("51");
    await spent(t, "transfer", S, paidByR0, { payments: [{ to: "addr_test1", lovelace: "10000000", tokens: [] }] });
    const bob = await privateRow(t, hash("b0"), "60000000");
    await land(t, [bob, await privateRow(t, S, "29800000", 1)]);
    expect(await funding(t)).toEqual([`${bob.tx_hash}#0`]);
  });

  it("a stealth mint takes Carol's payment before an old stealth mint's change [needs the rebuild]", { timeout: 60_000 }, async () => {
    const t = await wallet();
    const M = hash("4d");
    await spent(t, "mint", M, paidByR0, { label: "" });
    const carol = await privateRow(t, hash("ca"), "30000000");
    expect(await stealthMint(t, [await privateRow(t, M, "18000000", 1), carol])).toEqual([`${carol.tx_hash}#0`]);
  });
});

describe("earlier change first, when nothing fresher pays (chunk 51, l2rank#6, the owner's answer of 2026-11-18)", () => {
  /** No money of no history: 50 ₳ made private from account 0, Bob's 10 ₳, and a first stealth mint from Bob's. */
  async function afterAFirstMint() {
    const t = await wallet(false);
    const movedIn: PendingTx = { kind: "move-in", network: "preprod", txHash: hash("a0"), submittedAt: t.clock.now, confirmations: null };
    await t.activity.sent("preprod", movedIn, { lovelace: "50000000", origin: madePrivate(0) });
    const own = await privateRow(t, hash("a0"), "50000000");
    const bob = await privateRow(t, hash("b0"), "10000000");
    expect(await stealthMint(t, [own, bob])).toEqual([`${bob.tx_hash}#0`]);
    const first = await sentKept(t, SESSION_MINT, "mint");
    expect.soft(first.origin).toEqual({ id: `change:${first.txHash}+received:${bob.tx_hash}`, origin: "change" });
    // It lands: Bob's payment spent, the mint's change in its place.
    t.koios.added.splice(t.koios.added.indexOf(bob), 1);
    t.koios.spent.add(`${bob.tx_hash}#0`);
    return { t, own, first, change: await privateRow(t, first.txHash, "7700000", 1) };
  }

  it("a second stealth mint takes the first one's change, which names no public account, before money made private [needs the rebuild]", { timeout: 60_000 }, async () => {
    const { t, change } = await afterAFirstMint();
    expect(await stealthMint(t, [change])).toEqual([`${change.tx_hash}#1`]);
  });

  it("change whose history names a public account stays after the money made private (a control) [needs the rebuild]", { timeout: 60_000 }, async () => {
    const t = await wallet(false);
    const movedIn: PendingTx = { kind: "move-in", network: "preprod", txHash: hash("a0"), submittedAt: t.clock.now, confirmations: null };
    await t.activity.sent("preprod", movedIn, { lovelace: "50000000", origin: madePrivate(0) });
    const S = hash("51");
    await spent(t, "transfer", S, merged([madePrivate(0), leftBy(S)]), { payments: [{ to: "addr_test1", lovelace: "10000000", tokens: [] }] });
    const own = await privateRow(t, hash("a0"), "50000000");
    const change = await privateRow(t, S, "7700000", 1);
    expect(await stealthMint(t, [own, change])).toEqual([`${own.tx_hash}#0`]);
  });

  it("a private session's funding takes an earlier Send's change before money made private [needs the rebuild]", { timeout: 60_000 }, async () => {
    const t = await wallet(false);
    const movedIn: PendingTx = { kind: "move-in", network: "preprod", txHash: hash("a0"), submittedAt: t.clock.now, confirmations: null };
    await t.activity.sent("preprod", movedIn, { lovelace: "50000000", origin: madePrivate(0) });
    const S = hash("51");
    await spent(t, "transfer", S, merged([paidByR0, leftBy(S)]), { payments: [{ to: "addr_test1", lovelace: "10000000", tokens: [] }] });
    const change = await privateRow(t, S, "29800000", 1);
    await land(t, [await privateRow(t, hash("a0"), "50000000"), change]);
    expect(await funding(t)).toEqual([`${S}#1`]);
  });
});

describe("a stranger's copy of a register already on chain never takes a box (chunk 51, l2rank#4)", () => {
  /** Seedelf S1 created through the stealth mint from a box a mix moved, and Mallory's 4 ₳ under S1's datum as found. */
  async function copiedSeedelf(t: Tested, besides: KoiosUtxo[] = []) {
    const b1 = await privateRow(t, hash("b1"), "9710000");
    const back: PendingTx = { kind: "lovejoin-withdraw", network: "preprod", txHash: b1.tx_hash, submittedAt: t.clock.now, confirmations: null };
    await t.activity.sent("preprod", back, { lovelace: b1.value, origin: mixedBox(b1.tx_hash) });
    expect(await stealthMint(t, [b1, ...besides])).toEqual([`${b1.tx_hash}#0`]);
    const { tokenName } = (await t.session.get<{ tokenName: string }>(SESSION_MINT))!;
    const first = await sentKept(t, SESSION_MINT, "mint");
    expect.soft(first.origin).toEqual({ id: `box:${b1.tx_hash}+change:${first.txHash}`, origin: "change" });
    t.koios.added.splice(t.koios.added.indexOf(b1), 1);
    t.koios.spent.add(`${b1.tx_hash}#0`);
    const token = { policy_id: CONTRACT_V1.seedelfPolicyId, asset_name: tokenName, quantity: "1", decimals: 0, fingerprint: "asset1l2rank4" };
    const s1 = { ...(await privateRow(t, first.txHash, "1750000", 0)), asset_list: [token] } as KoiosUtxo;
    const change = await privateRow(t, first.txHash, "7700000", 1);
    const mallory = { ...(await privateRow(t, hash("e7"), "4000000")), inline_datum: s1.inline_datum };
    return { s1, change, mallory, first, M: `${mallory.tx_hash}#0` };
  }

  it("a Seedelf created this round from a box, copied: no box part, tagged Change and Unknown, and no Lovejoin in a review", { timeout: 60_000 }, async () => {
    const t = await wallet();
    const carol = await privateRow(t, hash("c0"), "30000000");
    const { s1, change, mallory, first, M } = await copiedSeedelf(t, [carol]);
    await land(t, [s1, change, mallory]);
    const entries = (await t.store.get<{ entries: Array<{ txHash: string; kind: string }> }>("history.preprod"))!.entries;
    expect(entries.find((e) => e.txHash === mallory.tx_hash)?.kind).toBe("received");
    const classes = await t.activity.classes("preprod", [carol, change, mallory], [...ownedUtxos, s1, carol, change, mallory]);
    expect.soft(classes.get(M)).toEqual({ id: `change:${first.txHash}+unknown:${mallory.tx_hash}`, origin: "change" });
    const { seedelf: rows } = await t.coins.lists("preprod");
    const tagged = rows.find((u) => u.txHash === mallory.tx_hash)?.history;
    expect.soft(tagged && historyTags(tagged)).toEqual(["Change", "Unknown"]);
    expect(historiesNote([tagged!, receivedIn(carol.tx_hash)])).not.toMatch(/Lovejoin/);
  });

  it("still ranks as the tie it carries: the next stealth mint takes money of no history before it [needs the rebuild]", { timeout: 60_000 }, async () => {
    const t = await wallet();
    const { s1, change, mallory, M } = await copiedSeedelf(t);
    const a1 = ownedUtxos.find((u) => u.value === "25000000")!;
    const picked = await stealthMint(t, [s1, change, mallory]);
    expect(picked).not.toContain(M);
    expect(picked).toEqual([`${a1.tx_hash}#0`]);
  });

  it("a copy of a session's never-mixed way back carries the session, never the box", { timeout: 60_000 }, async () => {
    const t = await wallet();
    const W = hash("d9");
    const way = await privateRow(t, W, "4700000");
    const back: PendingTx = { kind: "lovejoin-withdraw", network: "preprod", txHash: W, submittedAt: t.clock.now, confirmations: null };
    await t.activity.sent("preprod", back, { lovelace: way.value, origin: merged([boxFrom(W), sessionClass(2)]) });
    const copy = { ...(await privateRow(t, hash("e9"), "4000000")), inline_datum: way.inline_datum };
    await land(t, [way, copy]);
    const c = (await t.activity.classes("preprod", [way, copy])).get(`${copy.tx_hash}#0`)!;
    expect.soft(c).toEqual({ id: `session:2+unknown:${copy.tx_hash}`, origin: "session" });
    expect(historyTags(c)).toEqual(["Private session 3", "Unknown"]);
  });
});

describe("the review's note names a spend's change (chunk 51, l2rank#5)", () => {
  const [A, B, X, M, W, V] = ["a1", "b1", "c1", "d1", "e1", "f1"].map(hash) as [string, string, string, string, string, string];

  it("two removals' money of no other history, spent together: change from 2 earlier spends, never an empty list", () => {
    const note = historiesNote([leftBy(A), leftBy(B)]);
    expect(note).toBe("This spends change from 2 earlier spends together. Anyone can see they're one owner's, which ties them to each other.");
    expect(historiesNote([leftBy(A), leftBy(B)], { max: true })).not.toMatch(/^Sending everything spends\s+together/);
  });

  it("a payment and a spend's change: both named", () => {
    expect(historiesNote([receivedIn(X), leftBy(A)])).toBe(
      "This spends a payment you received and change from an earlier spend together. Anyone can see they're one owner's, which ties them to each other.",
    );
  });

  it("a stealth mint's change that spent a box, beside a payment: change, never a box back from Lovejoin, and nothing undone", () => {
    const note = historiesNote([receivedIn(X), merged([boxFrom(B), leftBy(M)])]);
    expect(note).not.toBe(historiesNote([receivedIn(X), boxFrom(B)]));
    expect(note).toContain("change from an earlier spend");
    expect(note).not.toMatch(/Lovejoin/);
  });

  it("a box of unknown making counts as a box alone: its own Unknown part is no other money", () => {
    const note = historiesNote([merged([boxFrom(W), unknownIn(W)]), merged([boxFrom(V), unknownIn(V)])]);
    expect(note).toBe(
      "This spends 2 boxes back from Lovejoin together. Anyone can see they're one owner's, which ties them to each other, and undoes some of what Lovejoin did for the boxes.",
    );
    expect(historiesNote([merged([boxFrom(W), unknownIn(W)]), unknownIn(X)])).toContain("a box back from Lovejoin and money the wallet has no history for");
  });

  it("no two classes give an empty list of what's spent", () => {
    const shapes = [
      leftBy(A), leftBy(B), receivedIn(X), boxFrom(B), mixedBox(V), madePrivate(0), madePrivate(2), sessionClass(1), UNKNOWN, unknownIn(M), spentElsewhere(W),
      merged([boxFrom(B), leftBy(M)]), merged([boxFrom(W), unknownIn(W)]), merged([leftBy(A), madePrivate(0)]), merged([boxFrom(W), sessionClass(3)]),
    ];
    for (const a of shapes) for (const b of shapes) {
      if (a.id === b.id) continue;
      const note = historiesNote([a, b]) ?? "";
      expect(note, `${a.id} with ${b.id}`).not.toMatch(/^This spends\s+together/);
    }
  });
});

describe("a spend's change reads `change` to selection (chunk 51, l2rank#6)", () => {
  const [A, B, X] = ["a1", "b1", "c1"].map(hash) as [string, string, string];

  it("change that names no public account, no session and nothing made elsewhere", () => {
    expect(leftBy(A)).toEqual({ id: `change:${A}`, origin: "change" });
    expect(merged([receivedIn(X), leftBy(A)]).origin).toBe("change");
    expect(merged([boxFrom(B), leftBy(A)]).origin).toBe("change");
    expect(merged([mixedBox(B), leftBy(A)]).origin).toBe("change");
    expect(merged([UNKNOWN, leftBy(A)]).origin).toBe("change");
    expect(merged([leftBy(A), leftBy(B), receivedIn(X)]).origin).toBe("change");
    expect(isHistoryClass({ id: `change:${A}`, origin: "change" })).toBe(true);
  });

  it("stays with the money it names otherwise: after money made private, as a session's", () => {
    expect(merged([madePrivate(0), leftBy(A)]).origin).toBe("session");
    expect(merged([sessionClass(1), leftBy(A)]).origin).toBe("session");
    expect(merged([spentElsewhere(B), leftBy(A)]).origin).toBe("session");
    expect(merged([madePrivate(0), receivedIn(X)]).origin).toBe("own");
  });

  it("is tagged Change, beside what it names", () => {
    expect(historyTags(merged([receivedIn(X), leftBy(A)]))).toEqual(["Change", "Received"]);
  });
});
