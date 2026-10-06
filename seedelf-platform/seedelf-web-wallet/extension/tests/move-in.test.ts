// The move-in service: build through WebAssembly on the recorded preprod
// account, keep the signed transaction until confirmed, submit exactly it,
// then watch it.
import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { SESSION_BUILT } from "../src/background/move-in";
import { pendingKey } from "../src/background/pending";
import { keptAsSent } from "../src/background/sent-txs";
import { spentSet } from "../src/background/spent";
import { SESSION_BALANCES_PREFIX } from "../src/background/wallet";
import { ttlOf, txIdOf } from "./fixtures/cbor";
import { busyFor, deepRow, koiosPreprod, testBalances, vectors, withRawRows } from "./fakes";

const PASSWORD = "correct horse battery";
const TUSDM = { policyId: "e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9", assetName: "0014df10745553444d" };

async function unlocked() {
  const v = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
  const t = testBalances();
  await t.wallet.create(v.phrase, PASSWORD);
  return t;
}

describe("move-in", () => {
  it("builds and signs a move-in without sending it", async () => {
    const t = await unlocked();
    const summary = await t.moveIn.build("preprod", "25000000", [{ ...TUSDM, quantity: "3000000000" }]);
    expect(summary).toMatchObject({
      network: "preprod",
      lovelace: "25000000",
      tokens: [{ ...TUSDM, quantity: "3000000000" }],
      depositOutputs: 1,
    });
    expect(Number(summary.fee)).toBeGreaterThan(150_000);
    expect(t.koios.submitted).toHaveLength(0);
    expect(t.koios.calls.map((c) => c.path).sort()).toEqual([
      "account_addresses",
      "account_info",
      "credential_utxos",
      "epoch_params",
      "tip",
    ]);
    // The account's staking rewards go in too (preferences.ts).
    expect(summary.withdrawal).toBe("57475311");

    // The signed transaction waits in session storage, and it is the one summarized.
    const built = await t.session.get<{ txCbor: string; txHash: string }>(SESSION_BUILT);
    expect(built!.txHash).toBe(summary.txHash);
    expect(txIdOf(Uint8Array.from(Buffer.from(built!.txCbor, "hex")))).toBe(summary.txHash);
  });

  it("moves part of a token, and the rest stays in the account", async () => {
    const t = await unlocked();
    const summary = await t.moveIn.build("preprod", "25000000", [{ ...TUSDM, quantity: "1250000000" }]);
    expect(summary.tokens).toEqual([{ ...TUSDM, quantity: "1250000000" }]);
    const whole = await t.moveIn.build("preprod", "25000000", [{ ...TUSDM, quantity: "3000000000" }]);
    expect(summary.changeTokens).toBe(whole.changeTokens + 1);
    await expect(t.moveIn.build("preprod", "25000000", [{ ...TUSDM, quantity: "3000000001" }])).rejects.toThrow(
      "holds only 3000000000",
    );
  });

  it("moves the most possible with Max", async () => {
    const t = await unlocked();
    const max = await t.moveIn.build("preprod", null, []);
    expect(max.inputs).toBe(6);
    expect(max.changeTokens).toBeGreaterThan(0); // the unpicked tokens go back
    expect(BigInt(max.lovelace)).toBeGreaterThan(10_000_000_000n);
  });

  it("submits exactly the built transaction, then watches it", async () => {
    const t = await unlocked();
    const summary = await t.moveIn.build("preprod", "5000000", []);
    const pending = await t.moveIn.submit("preprod", summary.txHash);
    expect(pending).toEqual({
      kind: "move-in",
      network: "preprod",
      txHash: summary.txHash,
      submittedAt: t.clock.now,
      confirmations: null,
      // The slot it stops being valid at, which it's watched until.
      invalidHereafter: ttlOf(t.koios.submitted[0]!),
    });
    expect(t.koios.submitted).toHaveLength(1);
    expect(txIdOf(t.koios.submitted[0]!)).toBe(summary.txHash);
    expect(await t.session.get(SESSION_BUILT)).toBeUndefined();
    // Send again from a page that missed the answer: sent already, never "review it again", which would make a
    // second payment private (chunk 23's second review, fix round).
    await expect(t.moveIn.submit("preprod", summary.txHash)).rejects.toThrow("That was sent already");
    expect(t.koios.submitted).toHaveLength(1);

    // Not on chain yet: still watching.
    expect(await t.pending.pending("preprod")).toMatchObject({ txHash: summary.txHash, confirmations: null });
    expect(await t.session.get(pendingKey("preprod"))).toBeDefined();

    // Confirmed: stop watching and drop the stale balances.
    await t.session.set(`${SESSION_BALANCES_PREFIX}preprod`, { stale: true });
    t.koios.confirmations = 1;
    expect(await t.pending.pending("preprod")).toMatchObject({ confirmations: 1 });
    expect(await t.session.get(pendingKey("preprod"))).toBeUndefined();
    expect(await t.session.get(`${SESSION_BALANCES_PREFIX}preprod`)).toBeUndefined();
    expect(await t.pending.pending("preprod")).toBeNull();
  });

  it("watches until the chain passes its slot, then says it expired and frees its UTxOs", async () => {
    const t = await unlocked();
    const summary = await t.moveIn.build("preprod", "5000000", []);
    const { invalidHereafter } = await t.moveIn.submit("preprod", summary.txHash);
    const inputs = txInputs(t.koios.submitted[0]!);
    const tips = () => t.koios.calls.filter((c) => c.path === "tip").length;
    const built = tips();
    await busyFor(t, 11 * 60_000);
    expect(await t.pending.pending("preprod")).toMatchObject({ confirmations: null });
    expect(await t.pending.pending("preprod")).toMatchObject({ confirmations: null });
    expect(tips()).toBe(built); // the device's clock says it can't have expired

    // Two hours on, the chain is past its slot, but not by enough to trust a Koios backend's tx_status.
    await busyFor(t, 2 * 60 * 60_000);
    t.koios.tip = invalidHereafter! + 60;
    expect(await t.pending.pending("preprod")).toMatchObject({ confirmations: null });
    expect(await spentSet(t.session)).toEqual(new Set(inputs));
    t.koios.tip = invalidHereafter! + 31 * 60;
    await t.session.set(`${SESSION_BALANCES_PREFIX}preprod`, { stale: true });
    const keptSent = () => t.wallet.withKeys(() => keptAsSent(t.session, "preprod", summary.txHash));
    expect(await keptSent()).toBe(true);
    expect(await t.pending.pending("preprod")).toMatchObject({ txHash: summary.txHash, confirmations: null, dropped: "expired" });
    expect(await spentSet(t.session)).toEqual(new Set());
    // Past its slot it can't land: it's no longer kept as sent, so nothing counts its outputs on their way, and a
    // payment built again on what it spent counts alone (chunk 23's second review, fix round).
    expect(await keptSent()).toBe(false);
    expect(await t.session.get(`${SESSION_BALANCES_PREFIX}preprod`)).toBeUndefined();
    expect(await t.pending.pending("preprod")).toBeNull();
  });

  it("stops watching a private payment, which has no slot, after 10 minutes", async () => {
    const t = await unlocked();
    await t.session.set(pendingKey("preprod"), { kind: "withdraw", network: "preprod", txHash: "ab".repeat(32), submittedAt: t.clock.now, confirmations: null });
    t.clock.now += 11 * 60_000;
    expect(await t.pending.pending("preprod")).toMatchObject({ confirmations: null });
    expect(await t.pending.pending("preprod")).toBeNull();
  });

  it("refuses to send anything but the reviewed transaction", async () => {
    const t = await unlocked();
    await expect(t.moveIn.submit("preprod", "00".repeat(32))).rejects.toThrow("isn't ready to send");
    const summary = await t.moveIn.build("preprod", "5000000", []);
    await expect(t.moveIn.submit("preprod", "11".repeat(32))).rejects.toThrow("isn't ready to send");
    t.clock.now += 11 * 60_000;
    await expect(t.moveIn.submit("preprod", summary.txHash)).rejects.toThrow("more than 10 minutes ago");
    expect(t.koios.submitted).toHaveLength(0);
  });

  it("shows why the network rejected it, and keeps the built transaction", async () => {
    const t = await unlocked();
    const summary = await t.moveIn.build("preprod", "5000000", []);
    t.koios.rejectSubmit = "ValueNotConservedUTxO";
    await expect(t.moveIn.submit("preprod", summary.txHash)).rejects.toThrow("The network rejected the transaction: ValueNotConservedUTxO");
    expect(await t.session.get(SESSION_BUILT)).toBeDefined();
    expect(await t.session.get(pendingKey("preprod"))).toBeUndefined();
  });

  it("isn't stopped by a stranger's UTxO nested thousands of levels deep in the account (launch review H4)", async () => {
    const t = await unlocked();
    const v = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
    const [ours] = koiosPreprod.accounts[v.preprod.stake as string]!.account_utxos;
    // Paid to the account's own address: one with a deep datum, one with a deep native reference script.
    withRawRows(t.koios, ours!.payment_cred!, [
      deepRow(ours!, 5_000, { txHash: "e1".repeat(32) }),
      deepRow(ours!, 5_000, { txHash: "e2".repeat(32), script: true }),
    ]);
    const before = testBalances();
    await before.wallet.create(v.phrase, PASSWORD);
    const plain = await before.balances.get("preprod");

    const b = await t.balances.get("preprod");
    expect(BigInt(b.cardano.lovelace)).toBe(BigInt(plain.cardano.lovelace) + 6_000_000n);
    // Max spends the one with the datum; the one with a script it can't measure stays, and says why.
    const max = await t.moveIn.build("preprod", null, []);
    expect(max.inputs).toBe(7);
    expect((max as { leftOut?: unknown }).leftOut).toEqual([{ txHash: "e2".repeat(32), txIndex: 0, reason: "script" }]);
    const built = await t.session.get<{ txCbor: string }>(SESSION_BUILT);
    expect(txInputs(Uint8Array.from(Buffer.from(built!.txCbor, "hex")))).toContain(`${"e1".repeat(32)}#0`);
  });

  it("raises a short amount to the least the deposit needs", async () => {
    const t = await unlocked();
    const short = await t.moveIn.build("preprod", "500000", []);
    expect(short.lovelace).toBe(short.minimum);
    expect(BigInt(short.minimum!)).toBeGreaterThan(500_000n);
    // Only a token: the ADA it needs, and no more.
    const token = await t.moveIn.build("preprod", "0", [{ ...TUSDM, quantity: "1" }]);
    expect(token.lovelace).toBe(token.minimum);
    expect(BigInt(token.minimum!)).toBeGreaterThan(BigInt(short.minimum!));
    const max = await t.moveIn.build("preprod", null, []);
    expect(max.minimum).toBeNull();
  });

  it("explains an impossible move and needs the wallet unlocked", async () => {
    const t = await unlocked();
    // In the wallet's words, with what Max would make private: core said "Cardano account" and "the change"
    // (chunk 23's second review, PY-10).
    const most = await t.moveIn.build("preprod", null, []);
    const ada = (lovelace: string) => (Number(BigInt(lovelace)) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 });
    await expect(t.moveIn.build("preprod", "999999999999999", [])).rejects.toThrow(
      `Not enough ADA: with the fee, your public account can make up to ${ada(most.lovelace)} ₳ private. Use Max to make all of it private.`,
    );
    await t.moveIn.build("preprod", "5000000", []);
    await t.wallet.lock();
    expect(await t.session.get(SESSION_BUILT)).toBeUndefined();
    await t.wallet.unlock(PASSWORD);
    // The account's ADA alone: half an ADA under Max fits, and what's left can't stay. Max makes more private than
    // that, so "up to" it would be false: what stays is said instead (chunk 23's second review, fix round).
    await t.balances.get("preprod");
    for (const u of (await t.coins.lists("preprod")).cardano) {
      if (u.tokens.length) await t.coins.setLocked("preprod", "cardano", `${u.txHash}#${u.index}`, true);
    }
    const all = BigInt((await t.moveIn.build("preprod", null, [])).lovelace);
    const left = t.moveIn.build("preprod", (all - 500_000n).toString(), []);
    await expect(left).rejects.toThrow(
      "Not enough ADA: what stays in your public account would be under the network's minimum. Use Max to make all of it private, or make less private.",
    );
    await expect(left).rejects.not.toThrow("up to");
    await t.wallet.lock();
    await expect(t.moveIn.build("preprod", "5000000", [])).rejects.toThrow("locked");
    await expect(t.pending.pending("preprod")).rejects.toThrow("locked");
  });
});
