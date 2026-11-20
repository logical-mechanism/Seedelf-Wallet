// Another profile's spend that a review's read took in for good, then a lock before the next balance reading (chunk
// 51, own#5, on gap-g9#1's fix). The private index names who spent each of the wallet's own rows only until a read
// moves the sealed cursor past that spend, and any read of the contract does: a private review's, Lovejoin's due
// withdraw's. gap-g9#1 kept the spenders in the session's copy of the view for the balance reading's `arrived`, but a
// lock wipes that copy: the change profile B's funding left (C) was then read as a payment received, which the stealth
// mint and the fundings take first (C, 394.6 ₳, before someone's 400 ₳ payment R), and Activity, the CSV and the UTxOs
// screen called it Received. Now the read that takes the spend in notes what arrived itself, so nothing about the
// spenders is kept, and a lock loses nothing.
import { describe, expect, it } from "vitest";

import { BalanceService } from "../src/background/balances";
import { txInputs } from "../src/background/cbor";
import { registerOf } from "../src/background/chain";
import { SESSION_CONTRACT_PREFIX } from "../src/background/contract-scan";
import { DataParts } from "../src/background/data-layer";
import type { KoiosUtxo } from "../src/background/koios";
import { SESSION_MINT } from "../src/background/mint";
import { privateIndexClient } from "../src/background/private-index";
import { readContract, type ScriptSpendDeps } from "../src/background/script-spend";
import { historyTags, madePrivate } from "../src/shared/histories";
import type { PendingTx } from "../src/shared/rpc";
import { activityTitle } from "../src/ui/activity";
import { fakeIndex, indexRowOf } from "./fake-index";
import { ownedUtxos, testBalances, vectors, withdrawPreprod } from "./fakes";

const PASSWORD = "correct horse battery";
const PHRASE = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase as string;
const hexOf = (b: Uint8Array) => Buffer.from(b).toString("hex");
const [M1, FB, RX] = ["a5", "fb", "e3"].map((h) => h.repeat(32)) as [string, string, string];
const SLOW = { timeout: 180_000 };

/**
 * Profile A: 500 ₳ made private (U), read. Profile B, the same phrase, funds a session from U (F_B), its change C;
 * someone pays A 400 ₳ (R). A private review here reads the contract once the index's stable cursor is past F_B, and
 * `lock`: the wallet locks and unlocks before the balance reading. Then a stealth mint from the private balance.
 */
async function profileA(lock: boolean) {
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
  const began = Math.floor(t.clock.now / 1000);
  const row = (txHash: string, txIndex: number, lovelace: string, height: number, time: number): KoiosUtxo => ({
    ...ownedUtxos[0]!,
    tx_hash: txHash,
    tx_index: txIndex,
    value: lovelace,
    asset_list: [],
    inline_datum: { bytes: hexOf(wasm.registerToDatum(wasm.rerandomize(new wasm.Register(base.generator, base.publicValue)))), value: null },
    block_height: height,
    block_time: time,
  });
  const moved: PendingTx = { kind: "move-in", network: "preprod", txHash: M1, submittedAt: t.clock.now, confirmations: null };
  await t.activity.sent("preprod", moved, { lovelace: "500000000", origin: madePrivate(0) });
  const U = row(M1, 0, "500000000", 9_000_001, began + 20);
  index.contract.push({ row: indexRowOf(U, index.tip - 100_000) });
  t.koios.added.push(U);
  await reads.get("preprod");

  const C = row(FB, 2, "394600000", 9_000_010, began + 900);
  const R = row(RX, 0, "400000000", 9_000_011, began + 960);
  index.contract.find((r) => r.row.ref === `${M1}#0`)!.spent = { slot: index.tip - 10, by: FB };
  index.contract.push({ row: indexRowOf(C, index.tip - 10) }, { row: indexRowOf(R, index.tip - 8) });
  t.koios.spent.add(`${M1}#0`);
  t.koios.added.push(C, R);
  // Past the stable cursor: the review's read is the last whose answer names F_B. No balance reading.
  index.advance(400);
  t.clock.now += 5 * 60_000;
  await t.wallet.touch();
  const review: ScriptSpendDeps = {
    ...deps,
    collateral: () => {
      throw new Error("not asked");
    },
  };
  const { view } = await readContract(review, "preprod", {});
  const named = view.spentBy?.[FB];
  const kept = await t.wallet.withKeys(() => t.session.get<{ spentBy?: unknown }>(SESSION_CONTRACT_PREFIX + "preprod"));
  if (lock) {
    await t.wallet.lock();
    await t.wallet.unlock(PASSWORD);
  }
  t.clock.now += 60_000;
  await t.wallet.touch();
  await reads.get("preprod", true);

  const entry = (await t.activity.seedelf("preprod")).find((e) => e.txHash === FB);
  const cClass = (await t.activity.classes("preprod", [C, R])).get(`${FB}#2`);
  const { seedelf: rows } = await t.coins.lists("preprod");
  const cRow = rows.find((u) => u.txHash === FB && u.index === 2);
  const evaluation = withdrawPreprod.amount.evaluation as { result: unknown[] };
  t.koios.evaluation = { ...evaluation, result: evaluation.result.slice(0, 1) };
  await t.mint.build("preprod", "", "seedelf");
  const mint = txInputs(Uint8Array.from(Buffer.from((await t.session.get<{ txCbor: string }>(SESSION_MINT))!.txCbor, "hex")));
  return { named, kept, entry, cClass, cRow, mint };
}

describe("another profile's spend a review's read took in, then a lock before the balance reading (chunk 51, own#5)", () => {
  it("control: with no lock, its change is the phrase's own, and the stealth mint takes the payment received", SLOW, async () => {
    const a = await profileA(false);
    expect(a.named).toEqual([`${M1}#0`]);
    expect(a.entry && activityTitle(a.entry)).toBe("Already in your private balance");
    expect(a.cClass?.origin).toBe("session");
    expect(a.mint).toEqual([`${RX}#0`]);
  });

  it("still knows who made the change after the lock, and keeps no record of who spent the wallet's rows", SLOW, async () => {
    const a = await profileA(true);
    expect(a.named, "the review's read names F_B as the spender").toEqual([`${M1}#0`]);
    expect.soft(a.kept?.spentBy, "nothing about the spenders is kept in the session's copy of the view").toBeUndefined();
    expect.soft(a.entry && activityTitle(a.entry), "Activity (and the CSV) doesn't call it a payment received").toBe(
      "Already in your private balance",
    );
    expect.soft(a.cClass?.origin, "C is ranked as another session's money, never as money someone else paid").toBe("session");
    expect.soft(a.cRow?.history && historyTags(a.cRow.history), "the UTxOs screen doesn't tag it Received").not.toContain("Received");
    expect.soft(a.mint, "the stealth mint takes the payment received, not the other profile's session change").toEqual([`${RX}#0`]);
  });
});
