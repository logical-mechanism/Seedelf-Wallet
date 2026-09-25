// Activity: the Seedelf history (no requests, sealed on the device) and the
// Cardano account's pages from Koios (two requests a page, one to catch up).
import { describe, expect, it } from "vitest";

import { SESSION_ACCOUNT_ADDRESSES_PREFIX, type AccountAddresses } from "../src/background/activity";
import type { KoiosUtxo } from "../src/background/koios";
import { activityPreprod, ownedUtxos, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const TUSDM = { policyId: "e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9", assetName: "0014df10745553444d" };

async function unlocked() {
  const v = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
  const t = testBalances();
  await t.wallet.create(v.phrase, PASSWORD);
  return t;
}

const paths = (t: Awaited<ReturnType<typeof unlocked>>) => t.koios.calls.map((c) => c.path);

describe("Seedelf activity", () => {
  it("notes what arrived when the balance is read, asking Koios nothing more", async () => {
    const t = await unlocked();
    await t.balances.get("preprod");
    const calls = t.koios.calls.length;
    const entries = await t.activity.seedelf("preprod");
    // The two spendable UTxOs; the one holding a seedelf is a name, not a payment.
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.kind === "received" && e.direction === "in")).toBe(true);
    expect(entries.map((e) => e.lovelace).sort()).toEqual(["25000000", "3000000"]);
    expect(t.koios.calls).toHaveLength(calls);

    // Read again: nothing is noted twice.
    t.clock.now += 60_000;
    await t.balances.get("preprod", true);
    expect(await t.activity.seedelf("preprod")).toHaveLength(2);
  });

  it("writes a move-in down when it's sent, and never counts its deposit as an arrival", async () => {
    const t = await unlocked();
    await t.balances.get("preprod");
    const summary = await t.moveIn.build("preprod", "25000000", [{ ...TUSDM, quantity: "1000" }]);
    await t.moveIn.submit("preprod", summary.txHash);
    const [latest] = await t.activity.seedelf("preprod");
    expect(latest).toMatchObject({
      txHash: summary.txHash,
      kind: "move-in",
      direction: "in",
      lovelace: "25000000",
      tokens: 1,
      fee: summary.fee,
    });

    // The deposit shows up on chain: it's the move-in's, not a new arrival.
    const deposit: KoiosUtxo = { ...ownedUtxos[0]!, tx_hash: summary.txHash, tx_index: 0, block_height: 5_300_000 };
    t.koios.added.push(deposit);
    t.clock.now += 60_000;
    await t.balances.get("preprod", true);
    const entries = await t.activity.seedelf("preprod");
    expect(entries.filter((e) => e.txHash === summary.txHash)).toHaveLength(1);
    expect(entries).toHaveLength(3);
  });

  it("names who a payment to several went to: the first, and how many more", async () => {
    const t = await unlocked();
    const pending = { kind: "transfer" as const, network: "preprod" as const, txHash: "ab".repeat(32), submittedAt: 1, confirmations: null };
    const summary = {
      fee: { total: "300000" },
      payments: [
        { to: "5eed0e1f" + "11".repeat(28), label: "alice", lovelace: "5000000", tokens: [{ ...TUSDM, quantity: "1" }] },
        { to: "5eed0e1f" + "22".repeat(28), lovelace: "2000000", tokens: [{ ...TUSDM, quantity: "2" }] },
        { to: "5eed0e1f" + "33".repeat(28), lovelace: "1000000", tokens: [] },
      ],
    };
    await t.activity.sent("preprod", pending, summary);
    const [entry] = await t.activity.seedelf("preprod");
    expect(entry).toMatchObject({ kind: "transfer", direction: "out", lovelace: "8000000", tokens: 1, fee: "300000", detail: "alice and 2 more" });
  });

  it("is sealed on the device, and can't be read while locked", async () => {
    const t = await unlocked();
    await t.balances.get("preprod");
    expect(JSON.stringify([...t.local.data])).not.toContain(ownedUtxos[0]!.tx_hash);
    await t.wallet.lock();
    await expect(t.activity.seedelf("preprod")).rejects.toThrow("locked");
  });
});

describe("Cardano account activity", () => {
  it("costs two requests a page, and one to catch up", async () => {
    const t = await unlocked();
    await t.balances.get("preprod");
    const before = t.koios.calls.length;

    const first = await t.activity.cardano("preprod");
    expect(first.entries).toHaveLength(20);
    expect(first.more).toBe(true);
    expect(paths(t).slice(before)).toEqual(["account_txs", "tx_info"]);
    expect(t.koios.calls.at(-2)!.query).toContain("order=block_height.desc");
    expect(t.koios.calls.at(-1)!.body).toMatchObject({ _inputs: true, _metadata: false, _scripts: false });

    // Opening it again asks only for what's newer than the newest read.
    const again = await t.activity.cardano("preprod");
    expect(again.entries).toEqual(first.entries);
    expect(paths(t).slice(before)).toEqual(["account_txs", "tx_info", "account_txs"]);
    expect(t.koios.calls.at(-1)!.body).toMatchObject({ _after_block_height: activityPreprod.account_txs[0]!.block_height });

    // Load more: the next page, then the last, short one.
    const second = await t.activity.cardano("preprod", true);
    expect(second.entries).toHaveLength(40);
    const third = await t.activity.cardano("preprod", true);
    expect(third.entries).toHaveLength(45);
    expect(third.more).toBe(false);
    expect(new Set(third.entries.map((e) => e.txHash)).size).toBe(45);
  });

  it("works out what each transaction did to the account's own addresses", async () => {
    const t = await unlocked();
    await t.balances.get("preprod");
    const { entries } = await t.activity.cardano("preprod");
    const ours = new Set((await t.session.get<AccountAddresses>(`${SESSION_ACCOUNT_ADDRESSES_PREFIX}preprod`))!.addresses);

    for (const e of entries) {
      const tx = activityPreprod.tx_info.find((x) => x.tx_hash === e.txHash) as unknown as {
        inputs: Array<{ payment_addr: { bech32: string }; value: string }>;
        outputs: Array<{ payment_addr: { bech32: string }; value: string }>;
      };
      const sum = (rows: typeof tx.inputs) =>
        rows.filter((r) => ours.has(r.payment_addr.bech32)).reduce((n, r) => n + BigInt(r.value), 0n);
      const net = sum(tx.outputs) - sum(tx.inputs);
      expect(e.direction, e.txHash).toBe(net > 0n ? "in" : net < 0n ? "out" : "none");
      expect(e.lovelace, e.txHash).toBe((net < 0n ? -net : net).toString());
      // A payment in from elsewhere pays no fee of ours.
      if (e.kind === "received") expect(e.fee).toBeUndefined();
    }
    expect(entries.map((e) => e.at)).toEqual([...entries.map((e) => e.at)].sort((a, b) => b - a));
  });

  it("needs a balance reading first, for the account's addresses", async () => {
    const t = await unlocked();
    await expect(t.activity.cardano("preprod")).rejects.toThrow("Read the balances first");
  });
});
