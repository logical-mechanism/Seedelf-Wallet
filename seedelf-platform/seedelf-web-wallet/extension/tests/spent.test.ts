// What the wallet has spent (spent.ts): read from the transaction it
// submits, then kept out of every balance reading and every build, because a
// Koios backend can lag behind the one that confirmed it.
import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { SESSION_BUILT } from "../src/background/move-in";
import { SESSION_SPENT } from "../src/background/spent";
import { koiosPreprod, testBalances, transferPreprod, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const v = vectors("cardano_account.json").find((c) => c.account === 0 && c.phrase.split(" ").length === 12)!;
const hexBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!, (h) => Number.parseInt(h, 16));

describe("txInputs", () => {
  it("lists a transaction's inputs from its tagged set", () => {
    const tx = hexBytes(transferPreprod.draft.draftCbor);
    const expected = transferPreprod.draft.inputs.map((i) => `${i.txHash}#${i.txIndex}`);
    expect(txInputs(tx).sort()).toEqual(expected.sort());
  });

  it("refuses what isn't a transaction", () => {
    expect(() => txInputs(hexBytes("83010203"))).toThrow("not a 4-item transaction array");
  });
});

describe("spent UTxOs", () => {
  async function movedIn(sleep?: (ms: number) => Promise<void>) {
    const t = testBalances({ sleep });
    await t.wallet.create(v.phrase, PASSWORD);
    const before = await t.balances.get("preprod");
    const summary = await t.moveIn.build("preprod", "10000000", []);
    await t.moveIn.submit("preprod", summary.txHash);
    const spent = txInputs(t.koios.submitted[0]!);
    return { t, before, spent };
  }
  /** Reads of the account's UTxOs (by its payment keys, not the contract's). */
  const reads = (t: ReturnType<typeof testBalances>) =>
    t.koios.calls.filter(
      (c) => c.path === "credential_utxos" && !c.body._payment_credentials.includes(koiosPreprod.wallet_contract),
    ).length;
  const accountUtxos = koiosPreprod.accounts[v.preprod.stake]!.account_utxos;
  const valueOf = (outpoints: string[]) =>
    accountUtxos.filter((u) => outpoints.includes(`${u.tx_hash}#${u.tx_index}`)).reduce((n, u) => n + BigInt(u.value), 0n);

  it("remembers what a submitted transaction spends", async () => {
    const { t, spent } = await movedIn();
    expect(spent.length).toBeGreaterThan(0);
    expect(await t.session.get(SESSION_SPENT)).toEqual(spent);
  });

  it("reads again while Koios still lists them, and uses the first reading that doesn't", async () => {
    let waits = 0;
    const { t, spent } = await movedIn(async () => {
      // The lagging backend catches up after the first wait.
      waits++;
      for (const o of spent) t.koios.spent.add(o);
    });
    const readsBefore = reads(t);
    const after = await t.balances.get("preprod", true);
    expect(waits).toBe(1);
    expect(reads(t) - readsBefore).toBe(2);
    expect(after.cardano.utxos).toBe(accountUtxos.length - spent.length);
  });

  it("never counts them, even when Koios never catches up", async () => {
    const { t, before, spent } = await movedIn();
    const readsBefore = reads(t);
    const after = await t.balances.get("preprod", true);
    expect(reads(t) - readsBefore).toBe(4); // the reading, then three more
    expect(after.cardano.utxos).toBe(before.cardano.utxos - spent.length);
    expect(BigInt(after.cardano.lovelace)).toBe(BigInt(before.cardano.lovelace) - valueOf(spent));
  });

  it("never builds on them", async () => {
    // The move-in spent the account's big UTxO; 3 ₳ holding four tokens is
    // left, and Koios still lists the rest. Built on what's left, another
    // move-in doesn't fit.
    const { t, spent } = await movedIn();
    expect(spent).toContain(`${accountUtxos.find((u) => BigInt(u.value) > 10_000_000_000n)!.tx_hash}#1`);
    const readsBefore = reads(t);
    await expect(t.moveIn.build("preprod", "10000000", [])).rejects.toThrow("Not enough ADA");
    expect(reads(t) - readsBefore).toBe(4); // read again three times first
    expect(await t.session.get(SESSION_BUILT)).toBeUndefined();
  });

  it("builds on the first read that has caught up", async () => {
    const { t, spent } = await movedIn(async () => {
      for (const o of spent) t.koios.spent.add(o);
    });
    const readsBefore = reads(t);
    await expect(t.moveIn.build("preprod", "10000000", [])).rejects.toThrow("Not enough ADA");
    expect(reads(t) - readsBefore).toBe(2);
  });

  it("is forgotten on lock", async () => {
    const { t } = await movedIn();
    await t.wallet.lock();
    expect(t.session.data.has(SESSION_SPENT)).toBe(false);
  });
});
