// Chunk 51, gap-g9#1 (its trace verifier's test, read through the private index). The phrase is open in two Chrome
// profiles, as privacy.md's "A separate Chrome profile keeps cookies apart" suggests for sites. Profile A (this one)
// made 500 ₳ (U) and 60 ₳ (O) private from public account 0. Profile B, with no history of A's, funds a private
// session from U: its funding F_B pays the one-time account and returns its change C (394.6 ₳) to the contract under a
// fresh register. Meanwhile someone paid A 400 ₳ (R). On B, C is that session's money. On A, the next reading finds U
// gone and C new; F_B isn't in A's sealed history, so `arrived` noted C as a payment received and `classes` gave it
// received:<F_B>: Activity titled it Received (Save as CSV too), the UTxOs screen tagged it Received, and a new
// session's funding (Purpose::Fund, received money first) and a stealth mint (Purpose::Mint) took C, the smallest
// received UTxO that pays alone, ahead of R: tying the new session, or Seedelf, to B's session on chain, with no note.
//
// The private index's answer names each spent row's spender: F_B spent U, one of A's own rows, which only this phrase's
// key could. So C is this phrase's own spend made elsewhere: never Received, with the history of what F_B spent (U's,
// made private from account 0), ranked as another session's money: a funding takes it last, a stealth mint after
// received money. Koios gives no spender, which privacy.md says (docs only). One device holding both, whose history
// has F_B as its own session's funding, classes C as that session's money and takes R too: the control.
import { describe, expect, it } from "vitest";

import { BalanceService } from "../src/background/balances";
import { txInputs } from "../src/background/cbor";
import { registerOf } from "../src/background/chain";
import { readContractView } from "../src/background/contract-scan";
import { DataParts } from "../src/background/data-layer";
import type { KoiosUtxo } from "../src/background/koios";
import { SESSION_MINT } from "../src/background/mint";
import { privateIndexClient } from "../src/background/private-index";
import { SESSION_OUT } from "../src/background/sessions";
import { historiesNote, historyTags, madePrivate, merged, sessionClass, spentElsewhere } from "../src/shared/histories";
import type { PendingTx } from "../src/shared/rpc";
import { activityTitle } from "../src/ui/activity";
import { fakeIndex, indexRowOf } from "./fake-index";
import { minswapEstimate, ownedUtxos, testBalances, vectors, withdrawPreprod } from "./fakes";

const PASSWORD = "correct horse battery";
const PHRASE = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase as string;
const hexOf = (b: Uint8Array) => Buffer.from(b).toString("hex");
const [M1, M2, FB, RX] = ["a5", "a6", "fb", "e3"].map((h) => h.repeat(32)) as [string, string, string, string];
/** The other profile's session, as its own book numbers it. */
const B_SESSION = 7;
const SLOW = { timeout: 180_000 };

/**
 * Profile A's view after the other profile's funding F_B, read through the private index (pointed at preprod here, as
 * the fake index allows): U (M1#0) spent by F_B, its change C (FB#2) and someone's payment R (RX#0) new, O (M2#0)
 * untouched. Then a private swap's funding and a stealth mint built here. `sentHere`: F_B is in this profile's
 * history, as on one device.
 */
async function profileA(sentHere: boolean) {
  const t = testBalances({ owned: false });
  await t.wallet.create(PHRASE, PASSWORD);
  const { wasm } = t.deps;
  const index = fakeIndex();
  const reads = new BalanceService({
    ...t.deps,
    index: privateIndexClient(
      { koiosOnly: async () => false, parts: new DataParts(t.session, () => t.clock.now), fetch: index.fetch, limits: {} },
      (n) => (n === "preprod" ? "https://data.test" : undefined),
    ),
  });
  // Every output of the wallet goes under a fresh re-randomization of its register, in either profile.
  const base = registerOf(ownedUtxos[0]!)!;
  const fresh = () => hexOf(wasm.registerToDatum(wasm.rerandomize(new wasm.Register(base.generator, base.publicValue))));
  const row = (txHash: string, txIndex: number, lovelace: string, height: number, time: number): KoiosUtxo => ({
    ...ownedUtxos[0]!,
    tx_hash: txHash,
    tx_index: txIndex,
    value: lovelace,
    asset_list: [],
    inline_datum: { bytes: fresh(), value: null },
    block_height: height,
    block_time: time,
  });
  const sent = (kind: PendingTx["kind"], txHash: string): PendingTx => ({ kind, network: "preprod", txHash, submittedAt: t.clock.now, confirmations: null });

  // 500 ₳ and 60 ₳ made private from public account 0: this profile's history has both move-ins.
  await t.activity.sent("preprod", sent("move-in", M1), { lovelace: "500000000", origin: madePrivate(0) });
  await t.activity.sent("preprod", sent("move-in", M2), { lovelace: "60000000", origin: madePrivate(0) });
  const began = Math.floor(t.clock.now / 1000);
  const U = row(M1, 0, "500000000", 9_000_001, began + 20);
  const O = row(M2, 0, "60000000", 9_000_002, began + 40);
  // On chain: in the index, made long before its tip; and at Koios, which the sessions' and the mint's reads ask.
  index.contract.push({ row: indexRowOf(U, index.tip - 100_000) }, { row: indexRowOf(O, index.tip - 100_000) });
  t.koios.added.push(U, O);
  await reads.get("preprod");
  const own = await t.activity.classes("preprod", [U, O]);
  expect([...own.values()]).toEqual([madePrivate(0), madePrivate(0)]);

  // F_B funds a site's private session from U and returns its change C to the contract. One device that sent it
  // wrote it down as that session's funding (sessions.ts buildFunding's summary: its change carries U's history).
  if (sentHere) {
    await t.activity.sent("preprod", sent("session-out", FB), {
      index: B_SESSION,
      lovelace: "105000000",
      origin: merged([madePrivate(0), sessionClass(B_SESSION)]),
    });
  }
  // The next reading: F_B spent U and made C, a few blocks under the index's tip; R was paid in the same blocks.
  const C = row(FB, 2, "394600000", 9_000_010, began + 900);
  const R = row(RX, 0, "400000000", 9_000_011, began + 960);
  index.contract.find((r) => r.row.ref === `${M1}#0`)!.spent = { slot: index.tip - 10, by: FB };
  index.contract.push({ row: indexRowOf(C, index.tip - 10) }, { row: indexRowOf(R, index.tip - 8) });
  t.koios.spent.add(`${M1}#0`);
  t.koios.added.push(C, R);
  t.clock.now += 3 * 60_000;
  await t.wallet.touch();
  await reads.get("preprod", true);
  const { seedelf: rows } = await t.coins.lists("preprod");
  expect(rows.some((u) => u.txHash === M1)).toBe(false);
  expect(rows.some((u) => u.txHash === M2 && u.index === 0)).toBe(true);
  const cRow = rows.find((u) => u.txHash === FB && u.index === 2);
  expect(cRow).toBeDefined();
  const entry = (await t.activity.seedelf("preprod")).find((e) => e.txHash === FB);
  const cClass = (await t.activity.classes("preprod", [O, C, R])).get(`${FB}#2`);

  // A private swap here: a new session's funding (Purpose::Fund), which one UTxO pays alone.
  const evaluation = withdrawPreprod.amount.evaluation as { result: unknown[] };
  t.koios.evaluation = { ...evaluation, result: evaluation.result.slice(0, 1) };
  const quote = await t.sessions.quote("preprod", minswapEstimate.ask);
  const out = await t.sessions.outBuild("preprod", quote);
  const kept = (await t.session.get<{ txCbor: string }>(SESSION_OUT))!;
  const funding = txInputs(Uint8Array.from(Buffer.from(kept.txCbor, "hex")));
  // As the swap's review shows it (Swaps.tsx HistoriesNote).
  const note = historiesNote(out.histories, { session: out.index });
  // A stealth mint from the private balance (Purpose::Mint).
  await t.mint.build("preprod", "", "seedelf");
  const mint = txInputs(Uint8Array.from(Buffer.from((await t.session.get<{ txCbor: string }>(SESSION_MINT))!.txCbor, "hex")));
  const label = sentHere ? "one device" : "profile A";
  console.log(
    `[r51 gap-g9#1] ${label}: F_B in Activity ${JSON.stringify(entry && { kind: entry.kind, title: activityTitle(entry) })}; ` +
      `C classed ${JSON.stringify(cClass)}, tagged ${JSON.stringify(cRow?.history && historyTags(cRow.history))}; ` +
      `the funding spends ${JSON.stringify(funding)}, note ${JSON.stringify(note)}; the mint spends ${JSON.stringify(mint)}`,
  );
  return { entry, cClass, cRow, funding, mint, note };
}

describe("money another profile's spend left, as the screens say it (chunk 51, gap-g9#1)", () => {
  it("is ranked as a session's money, tagged Unknown, and counted as money of no history, never a session with no number", () => {
    const c = merged([madePrivate(0), spentElsewhere(FB)]);
    expect(c).toEqual({ id: `elsewhere:${FB}+public:0`, origin: "session" });
    expect(historyTags(c).sort()).toEqual(["Made private", "Unknown"]);
    expect(historiesNote([madePrivate(0), c])).toBe(
      "This spends money you made private and money the wallet has no history for together. Anyone can see they're one owner's, which ties them to each other.",
    );
    // A funding names only the sessions it can number.
    expect(historiesNote([c], { session: 3 })).toBeUndefined();
  });
});

describe("the phrase open in a second profile (chunk 51, gap-g9#1)", () => {
  it("never reads that profile's own session change as a payment received, nor spends it ahead of one", SLOW, async () => {
    // The control: one device holding the same UTxOs, which sent F_B itself, spends R for both.
    const oneDevice = await profileA(true);
    expect(oneDevice.cClass).toEqual({ id: `public:0+session:${B_SESSION}`, origin: "session" });
    expect(oneDevice.funding).toEqual([`${RX}#0`]);
    expect(oneDevice.mint).toEqual([`${RX}#0`]);

    const here = await profileA(false);
    // C is no one else's payment: the phrase's own change, sent from the other profile.
    expect.soft(here.entry && activityTitle(here.entry), "Activity (and the CSV) doesn't call it a payment received").toBe(
      "Already in your private balance",
    );
    expect.soft(here.cClass?.origin, "C is ranked as another session's money, never as money someone else paid").toBe("session");
    expect.soft(here.cClass?.id.split("+"), "C carries what F_B spent: U's history").toContain("public:0");
    expect.soft(here.cRow?.history && historyTags(here.cRow.history).sort(), "the UTxOs screen doesn't tag it Received").toEqual([
      "Made private",
      "Unknown",
    ]);
    // So neither the funding nor the stealth mint takes C ahead of R, which pays each alone: as the one device does.
    expect.soft(here.funding, "the funding takes the payment received, not C").toEqual([`${RX}#0`]);
    expect.soft(here.mint, "the stealth mint takes the payment received, not C").toEqual([`${RX}#0`]);
  });

  it("still knows who made the change when another read folded the spend in before the balance reading", SLOW, async () => {
    const t = testBalances({ owned: false });
    await t.wallet.create(PHRASE, PASSWORD);
    const { wasm } = t.deps;
    const index = fakeIndex();
    const deps = {
      ...t.deps,
      index: privateIndexClient(
        { koiosOnly: async () => false, parts: new DataParts(t.session, () => t.clock.now), fetch: index.fetch, limits: {} },
        (n) => (n === "preprod" ? "https://data.test" : undefined),
      ),
    };
    const reads = new BalanceService(deps);
    const base = registerOf(ownedUtxos[0]!)!;
    const row = (txHash: string, txIndex: number, lovelace: string): KoiosUtxo => ({
      ...ownedUtxos[0]!,
      tx_hash: txHash,
      tx_index: txIndex,
      value: lovelace,
      asset_list: [],
      inline_datum: { bytes: hexOf(wasm.registerToDatum(wasm.rerandomize(new wasm.Register(base.generator, base.publicValue)))), value: null },
    });
    const moved: PendingTx = { kind: "move-in", network: "preprod", txHash: M1, submittedAt: t.clock.now, confirmations: null };
    await t.activity.sent("preprod", moved, { lovelace: "500000000", origin: madePrivate(0) });
    const U = row(M1, 0, "500000000");
    index.contract.push({ row: indexRowOf(U, index.tip - 100_000) });
    await reads.get("preprod");

    // F_B spends U and makes C. A spend's own read of the contract (readContract, say Lovejoin's withdraw at its due
    // time) gets that answer first, and a later one, once the index's stable cursor passes F_B, folds it in: the
    // balance reading's own answer no longer names F_B.
    const C = row(FB, 2, "394600000");
    index.contract.find((r) => r.row.ref === `${M1}#0`)!.spent = { slot: index.tip - 10, by: FB };
    index.contract.push({ row: indexRowOf(C, index.tip - 10) });
    await readContractView(deps, "preprod");
    index.advance(400);
    await readContractView(deps, "preprod");
    t.clock.now += 60_000;
    await reads.get("preprod", true);

    const entry = (await t.activity.seedelf("preprod")).find((e) => e.txHash === FB);
    expect(entry && activityTitle(entry)).toBe("Already in your private balance");
    expect((await t.activity.classes("preprod", [C])).get(`${FB}#2`)?.origin).toBe("session");
  });
});
