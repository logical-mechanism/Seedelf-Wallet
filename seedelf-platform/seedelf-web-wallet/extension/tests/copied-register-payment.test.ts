// Chunk 51, gap-g1#1 (the trace verifier's test, and part (b)'s own case). The wallet's own Seedelf A sits in the
// contract under its register D, an inline datum anyone can read. Mallory, a stranger, pays the contract 40 ₳ under D
// byte for byte (d = 1): she needs nothing secret, only A's UTxO. The wallet's ownership check is g^x == u alone
// (balances.ts ownedUtxos, register.rs is_owned), so it counts her UTxO as its own, and the Seedelf history noted it as
// a payment received (activity.ts arrived and classOf: received:<tx>), as it notes Bob's 60 ₳, paid properly under a
// fresh re-randomization. Nothing compared her register with A's, though the kept view holds both.
//
// A stealth mint ranks received money first (core build.rs Purpose::Mint) and a session's funding does too
// (Purpose::Fund), each taking the smallest UTxO that pays alone. So both took Mallory's 40 ₳ ahead of Bob's 60 ₳. On
// chain each then spends an input whose datum is A's: anyone can see its spender holds A's key, so the new Seedelf
// (named after that input, too) and the swap's one-time account are tied to A, and through A's own mint to the public
// account that paid for it.
//
// Part (a): a UTxO under a register another of the wallet's own rows already has, matched by its parsed points, is
// never Received: it takes that row's history (Unknown by its transaction when that row is Received too), so these
// spends take it after a payment made properly. It catches only such an exact copy (d = 1), never a payer who reveals
// another d. Part (b), the owner's call (B15): no payer knows a box back from Lovejoin, so a stealth mint takes one that
// pays alone before money someone paid (core's Purpose::Mint: Lovejoin 0, Received 1). Driven through the worker's
// services with the real WebAssembly, as mint.test.ts and history-classes.test.ts are; (b)'s case needs the
// WebAssembly built with core's new ranks.

import { describe, expect, it } from "vitest";

import { CONTRACT_V1 } from "../src/background/balances";
import { txInputs } from "../src/background/cbor";
import type { KoiosUtxo } from "../src/background/koios";
import { SESSION_MINT } from "../src/background/mint";
import { SESSION_OUT } from "../src/background/sessions";
import { boxFrom, historiesNote, historyTags } from "../src/shared/histories";
import type { PendingTx } from "../src/shared/rpc";
import { loadTestWasm, minswapEstimate, ownedUtxos, testBalances, vectors, withdrawPreprod } from "./fakes";

const PASSWORD = "correct horse battery";
const inputsOf = (cbor: string) => txInputs(Uint8Array.from(Buffer.from(cbor, "hex")));

/** The 12-word wallet after its history's first reading, and a fresh re-randomization of its register. */
async function wallet() {
  const v = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
  const t = testBalances();
  await t.wallet.create(v.phrase, PASSWORD);
  // One spend: a funding that takes one UTxO alone (history-classes.test.ts, L41).
  const evaluation = withdrawPreprod.amount.evaluation as { result: unknown[] };
  t.koios.evaluation = { ...evaluation, result: evaluation.result.slice(0, 1) };
  // The history's first reading: the 25 ₳ and the 3 ₳ with tokens are already there (Unknown); a3 is Seedelf A.
  await t.balances.get("preprod");
  const wasm = loadTestWasm();
  const fresh = () => t.wallet.withKeys((keys) => Buffer.from(wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister()))).toString("hex"));
  const paid = (txHash: string, lovelace: string, inline_datum: KoiosUtxo["inline_datum"]): KoiosUtxo => ({
    ...ownedUtxos[0]!,
    tx_hash: txHash,
    tx_index: 0,
    value: lovelace,
    asset_list: [],
    inline_datum,
    block_height: 9_000_001,
  });
  return { t, fresh, paid };
}

describe("chunk 51, gap-g1#1: a stranger's payment under one of the wallet's Seedelfs' datum, as found", () => {
  it("is never what a stealth mint or a swap's funding takes first while a payment made properly pays alone", { timeout: 60_000 }, async () => {
    const { t, fresh, paid } = await wallet();
    const seedelfA = ownedUtxos.find((u) => (u.asset_list ?? []).some((a) => a.policy_id === CONTRACT_V1.seedelfPolicyId))!;
    // Bob pays A as any wallet does, under a fresh re-randomization; Mallory under A's datum as found.
    const bob = paid("b0".repeat(32), "60000000", { bytes: await fresh(), value: null });
    const mallory = paid("e7".repeat(32), "40000000", seedelfA.inline_datum);
    const M = `${mallory.tx_hash}#0`;
    const B = `${bob.tx_hash}#0`;
    t.koios.added.push(bob, mallory);
    t.clock.now += 60_000;
    await t.balances.get("preprod", true);

    // What holds today, and still would once fixed: anyone can read that her datum is A's, and both are the wallet's.
    expect(mallory.inline_datum!.bytes).toBe(seedelfA.inline_datum!.bytes);
    expect((seedelfA.asset_list ?? []).map((a) => a.asset_name)[0]).toMatch(/^5eed0e1f/);
    // As a spend reads them (script-spend.ts readContract): against every row of the wallet's view, A's too.
    const classes = await t.activity.classes("preprod", [bob, mallory], [...ownedUtxos, bob, mallory]);
    console.log("[r51 gap-g1#1] classes:", JSON.stringify(Object.fromEntries(classes)));
    expect(classes.get(B)).toEqual({ id: `received:${bob.tx_hash}`, origin: "received" });
    // The UTxOs screen (all the wallet's rows, A's included) never tags her copy Received either.
    const { seedelf: rows } = await t.coins.lists("preprod");
    const tagged = rows.find((u) => u.txHash === mallory.tx_hash)?.history;
    console.log("[r51 gap-g1#1] the UTxOs screen tags her copy", JSON.stringify(tagged && historyTags(tagged)));

    // 1. A stealth mint from the private balance.
    const minted = await t.mint.build("preprod", "", "seedelf");
    const mintInputs = inputsOf((await t.session.get<{ txCbor: string }>(SESSION_MINT))!.txCbor);
    console.log(
      "[r51 gap-g1#1] stealth mint spends",
      JSON.stringify(mintInputs.map((i) => (i === M ? "Mallory's 40 ₳ under A's datum" : i === B ? "Bob's 60 ₳" : i))),
      "named",
      minted.tokenName,
      "histories",
      JSON.stringify(minted.histories),
      "note",
      JSON.stringify(historiesNote(minted.histories) ?? null),
    );

    // 2. A private swap's funding, paying a new one-time account.
    const quote = await t.sessions.quote("preprod", minswapEstimate.ask);
    const out = await t.sessions.outBuild("preprod", quote);
    const outInputs = inputsOf((await t.session.get<{ txCbor: string }>(SESSION_OUT))!.txCbor);
    console.log(
      "[r51 gap-g1#1] swap funding pays",
      out.payments.map((p) => p.lovelace).join(" + "),
      "and spends",
      JSON.stringify(outInputs.map((i) => (i === M ? "Mallory's 40 ₳ under A's datum" : i === B ? "Bob's 60 ₳" : i))),
    );

    // Her copy is never money someone else paid: it's tied to A on chain.
    expect.soft(classes.get(M)?.origin, "her copy's class").not.toBe("received");
    expect.soft(tagged && historyTags(tagged), "her copy's tags on the UTxOs screen").not.toContain("Received");
    // Neither takes Mallory's copy of A's datum ahead of Bob's payment, which pays each alone.
    expect.soft(mintInputs, "the stealth mint's inputs").not.toContain(M);
    expect.soft(outInputs, "the swap funding's inputs").not.toContain(M);
  });

  it("matches a copy by its register's points, however its datum is spelled", { timeout: 60_000 }, async () => {
    const { t, paid } = await wallet();
    const seedelfA = ownedUtxos.find((u) => (u.asset_list ?? []).some((a) => a.policy_id === CONTRACT_V1.seedelfPolicyId))!;
    // A's datum, constructor 0's tag 121 with a definite pair, re-spelled in its general form, 102([0, [g, u]]), which
    // the node reads alike (chain.ts registerOf, r3a#1): other bytes, the same register.
    const bytes = seedelfA.inline_datum!.bytes!;
    expect(bytes.startsWith("d8799f") || bytes.startsWith("d87982")).toBe(true);
    const fields = bytes.startsWith("d8799f") ? `82${bytes.slice(6, -2)}` : bytes.slice(4);
    const respelled = paid("e8".repeat(32), "40000000", { bytes: `d8668200${fields}`, value: null });
    expect(respelled.inline_datum!.bytes).not.toBe(bytes);
    t.koios.added.push(respelled);
    t.clock.now += 60_000;
    await t.balances.get("preprod", true);
    expect((await t.coins.lists("preprod")).seedelf.some((u) => u.txHash === respelled.tx_hash)).toBe(true);
    const classes = await t.activity.classes("preprod", [respelled], [...ownedUtxos, respelled]);
    expect(classes.get(`${respelled.tx_hash}#0`)?.origin).not.toBe("received");
  });

  it("(b) takes a box back from Lovejoin that pays alone before a payment received, for a stealth mint", { timeout: 60_000 }, async () => {
    const { t, fresh, paid } = await wallet();
    // A box this wallet brought back (its withdraw, written at submit), and Bob's payment, made properly.
    const box = paid("bb".repeat(32), "4800000", { bytes: await fresh(), value: null });
    const back: PendingTx = { kind: "lovejoin-withdraw", network: "preprod", txHash: box.tx_hash, submittedAt: t.clock.now, confirmations: null };
    await t.activity.sent("preprod", back, { lovelace: box.value });
    const bob = paid("b0".repeat(32), "60000000", { bytes: await fresh(), value: null });
    t.koios.added.push(box, bob);
    t.clock.now += 60_000;
    await t.balances.get("preprod", true);
    const classes = await t.activity.classes("preprod", [box, bob]);
    expect(classes.get(`${box.tx_hash}#0`)).toEqual(boxFrom(box.tx_hash));
    expect(classes.get(`${bob.tx_hash}#0`)?.origin).toBe("received");

    await t.mint.build("preprod", "", "seedelf");
    const mintInputs = inputsOf((await t.session.get<{ txCbor: string }>(SESSION_MINT))!.txCbor);
    // No payer knows the box: the new Seedelf is tied to nothing Bob can see.
    expect(mintInputs).toEqual([`${box.tx_hash}#0`]);
  });
});
