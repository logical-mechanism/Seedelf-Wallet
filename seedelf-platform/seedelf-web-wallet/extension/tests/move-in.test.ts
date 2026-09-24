// The move-in service: build through WebAssembly on the recorded preprod
// account, keep the signed transaction until confirmed, submit exactly it,
// then watch it.
import { describe, expect, it } from "vitest";

import { SESSION_BUILT } from "../src/background/move-in";
import { SESSION_PENDING } from "../src/background/pending";
import { SESSION_BALANCES_PREFIX } from "../src/background/wallet";
import { txIdOf } from "./fixtures/cbor";
import { testBalances, vectors } from "./fakes";

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
    const summary = await t.moveIn.build("preprod", "25000000", [TUSDM]);
    expect(summary).toMatchObject({
      network: "preprod",
      lovelace: "25000000",
      tokens: [{ ...TUSDM, quantity: "3000000000" }],
      depositOutputs: 1,
    });
    expect(Number(summary.fee)).toBeGreaterThan(150_000);
    expect(t.koios.submitted).toHaveLength(0);
    expect(t.koios.calls.map((c) => c.path).sort()).toEqual(["account_addresses", "account_utxos", "epoch_params"]);

    // The signed transaction waits in session storage, and it is the one summarized.
    const built = await t.session.get<{ txCbor: string; txHash: string }>(SESSION_BUILT);
    expect(built!.txHash).toBe(summary.txHash);
    expect(txIdOf(Uint8Array.from(Buffer.from(built!.txCbor, "hex")))).toBe(summary.txHash);
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
    expect(pending).toEqual({ kind: "move-in", network: "preprod", txHash: summary.txHash, submittedAt: t.clock.now, confirmations: null });
    expect(t.koios.submitted).toHaveLength(1);
    expect(txIdOf(t.koios.submitted[0]!)).toBe(summary.txHash);
    expect(await t.session.get(SESSION_BUILT)).toBeUndefined();

    // Not on chain yet: still watching.
    expect(await t.pending.pending()).toMatchObject({ txHash: summary.txHash, confirmations: null });
    expect(await t.session.get(SESSION_PENDING)).toBeDefined();

    // Confirmed: stop watching and drop the stale balances.
    await t.session.set(`${SESSION_BALANCES_PREFIX}preprod`, { stale: true });
    t.koios.confirmations = 1;
    expect(await t.pending.pending()).toMatchObject({ confirmations: 1 });
    expect(await t.session.get(SESSION_PENDING)).toBeUndefined();
    expect(await t.session.get(`${SESSION_BALANCES_PREFIX}preprod`)).toBeUndefined();
    expect(await t.pending.pending()).toBeNull();
  });

  it("stops watching after 10 minutes", async () => {
    const t = await unlocked();
    const summary = await t.moveIn.build("preprod", "5000000", []);
    await t.moveIn.submit("preprod", summary.txHash);
    t.clock.now += 11 * 60_000;
    expect(await t.pending.pending()).toMatchObject({ confirmations: null });
    expect(await t.pending.pending()).toBeNull();
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
    expect(await t.session.get(SESSION_PENDING)).toBeUndefined();
  });

  it("explains an impossible move and needs the wallet unlocked", async () => {
    const t = await unlocked();
    await expect(t.moveIn.build("preprod", "999999999999999", [])).rejects.toThrow("Not enough ADA");
    await expect(t.moveIn.build("preprod", "500000", [])).rejects.toThrow("needs at least");
    await t.moveIn.build("preprod", "5000000", []);
    await t.wallet.lock();
    expect(await t.session.get(SESSION_BUILT)).toBeUndefined();
    await expect(t.moveIn.build("preprod", "5000000", [])).rejects.toThrow("locked");
    await expect(t.pending.pending()).rejects.toThrow("locked");
  });
});
