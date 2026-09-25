// Activity: the Seedelf history (no requests, sealed on the device) and the
// Cardano account's pages from Koios (two requests a page, one to catch up).
import { describe, expect, it } from "vitest";

import { describe as describeTxs, noteOf, SESSION_ACCOUNT_ADDRESSES_PREFIX, type AccountAddresses } from "../src/background/activity";
import type { KoiosTxInfo, KoiosUtxo } from "../src/background/koios";
import { LOCAL_POOLS_PREFIX } from "../src/background/staking";
import type { ActivityEntry } from "../src/shared/rpc";
import { activityCsv, csvCell } from "../src/ui/activity";
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
    // Each token once, with what left in all: out, so negative.
    expect(entry!.assets).toEqual([{ ...TUSDM, quantity: "-3" }]);
  });

  it("keeps the tokens that arrived, and what a move-in brought in", async () => {
    const t = await unlocked();
    await t.balances.get("preprod");
    const arrived = (await t.activity.seedelf("preprod")).filter((e) => e.tokens > 0);
    for (const e of arrived) {
      expect(e.assets!.length).toBe(e.tokens);
      expect(e.assets!.every((a) => BigInt(a.quantity) > 0n)).toBe(true);
    }
    const summary = await t.moveIn.build("preprod", "25000000", [{ ...TUSDM, quantity: "1000" }]);
    await t.moveIn.submit("preprod", summary.txHash);
    const [latest] = await t.activity.seedelf("preprod");
    expect(latest!.assets).toEqual([{ ...TUSDM, quantity: "1000" }]);
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
    // Notes and staking come in the same request.
    expect(t.koios.calls.at(-1)!.body).toMatchObject({
      _inputs: true,
      _metadata: true,
      _withdrawals: true,
      _certs: true,
      _scripts: false,
    });

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

describe("the Cardano account's staking and notes", () => {
  const STAKE = activityPreprod.stake;
  const ME = "addr_test1_me";
  const tx = (extra: Partial<KoiosTxInfo>, outputsElsewhere = false): KoiosTxInfo => ({
    tx_hash: "ab".repeat(32),
    block_height: 1,
    tx_timestamp: 1_800_000_000,
    fee: "200000",
    inputs: [{ payment_addr: { bech32: ME }, value: "10000000", asset_list: [] }],
    outputs: [{ payment_addr: { bech32: outputsElsewhere ? "addr_test1_them" : ME }, value: "7800000", asset_list: [] }],
    ...extra,
  });
  const read = (t: KoiosTxInfo) => describeTxs([t], new Set([ME]), new Map(), STAKE)[0]!;
  const cert = (type: string, info: Record<string, unknown>) => ({ index: 0, type, info: { stake_address: STAKE, ...info } });

  it("names a registration and delegation, a vote, stopping, and a withdrawal alone", () => {
    const staked = read(
      tx({
        certificates: [
          cert("stake_registration", { deposit: "2000000" }),
          cert("pool_delegation", { pool_id_bech32: "pool1logic" }),
          cert("vote_delegation", { drep_id: "drep_always_abstain" }),
        ],
      }),
    );
    expect(staked).toMatchObject({
      kind: "stake",
      direction: "out",
      lovelace: "2200000",
      fee: "200000",
      staking: { deposit: "2000000", pool: "pool1logic", drep: "drep_always_abstain" },
    });

    expect(read(tx({ certificates: [cert("vote_delegation", { drep_id: "drep1xyz" })] }))).toMatchObject({
      kind: "vote",
      staking: { drep: "drep1xyz" },
    });
    expect(
      read(
        tx({
          certificates: [cert("stake_deregistration", { refund: "2000000" })],
          withdrawals: [{ amount: "5000000", stake_addr: STAKE }],
        }),
      ),
    ).toMatchObject({ kind: "unstake", staking: { stopped: true, refund: "2000000", rewards: "5000000" } });
    // Only the rewards, back to the account.
    expect(read(tx({ withdrawals: [{ amount: "5000000", stake_addr: STAKE }] }))).toMatchObject({
      kind: "withdraw-rewards",
      staking: { rewards: "5000000" },
    });
  });

  it("keeps a payment that spent the rewards a payment, and ignores others' certificates", () => {
    const paid = read(tx({ withdrawals: [{ amount: "5000000", stake_addr: STAKE }] }, true));
    expect(paid).toMatchObject({ kind: "sent", staking: { rewards: "5000000" } });
    const theirs = read(
      tx({
        certificates: [{ index: 0, type: "pool_delegation", info: { stake_address: "stake_test1other", pool_id_bech32: "pool1x" } }],
        withdrawals: [{ amount: "1", stake_addr: "stake_test1other" }],
      }),
    );
    expect(theirs.staking).toBeUndefined();
    expect(theirs.kind).toBe("sent");
  });

  it("reads a note as its lines joined, and only CIP-20's", () => {
    expect(noteOf({ "674": { msg: ["Invoice 42", "September"] } })).toBe("Invoice 42 September");
    expect(noteOf({ "674": { msg: "one line" } })).toBe("one line");
    expect(noteOf({ "721": { msg: ["an NFT's"] } })).toBeUndefined();
    expect(noteOf({ "674": { msg: [1, { a: 2 }] } })).toBeUndefined();
    expect(noteOf(null)).toBeUndefined();
    expect(noteOf({ "674": { msg: ["x".repeat(600)] } })).toBe(`${"x".repeat(500)}…`);
    expect(read(tx({ metadata: { "674": { msg: ["rent"] } } })).note).toBe("rent");
  });

  it("finds a pool's ticker on the device, asking no one", async () => {
    const t = await unlocked();
    await t.balances.get("preprod");
    const [first] = activityPreprod.account_txs;
    t.koios.txExtras.set(first!.tx_hash, {
      certificates: [{ index: 0, type: "pool_delegation", info: { stake_address: STAKE, pool_id_bech32: "pool1logic" } }],
    });
    await t.local.set(`${LOCAL_POOLS_PREFIX}preprod`, { updatedAt: 0, pools: [{ id: "pool1logic", ticker: "LOGIC" }] });
    const before = t.koios.calls.length;
    const { entries } = await t.activity.cardano("preprod");
    expect(entries.find((e) => e.txHash === first!.tx_hash)).toMatchObject({
      kind: "stake",
      staking: { pool: "pool1logic", ticker: "LOGIC" },
    });
    expect(paths(t).slice(before)).toEqual(["account_txs", "tx_info"]);
  });
});

describe("the CSV export", () => {
  const entry = (e: Partial<ActivityEntry>): ActivityEntry => ({
    txHash: "cd".repeat(32),
    at: Date.UTC(2026, 8, 25, 12, 30),
    kind: "sent",
    direction: "out",
    lovelace: "1234567890",
    tokens: 0,
    ...e,
  });

  it("writes one row an entry, signed amounts in ADA, and the transaction", () => {
    const csv = activityCsv("preprod", [
      entry({ fee: "170000", assets: [{ ...TUSDM, quantity: "-1500000" }], note: "rent, September" }),
      entry({ kind: "stake", direction: "out", lovelace: "2170000", staking: { pool: "pool1x", ticker: "LOGIC", deposit: "2000000" } }),
      entry({ kind: "received", direction: "in", lovelace: "5000000" }),
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    const [head, sent, staked, received] = csv.slice(1).trimEnd().split("\r\n");
    expect(head).toBe(
      "Date (UTC),Type,Direction,ADA,Network fee (ADA),Tokens,To or from,Note,Pool,Vote,Deposit (ADA),Deposit back (ADA),Rewards withdrawn (ADA),Transaction",
    );
    expect(sent).toBe(`2026-09-25T12:30:00.000Z,Sent,out,-1234.56789,0.17,tUSDM: -1500000,,"rent, September",,,,,,${"cd".repeat(32)}`);
    expect(staked).toContain(",Staked,out,-2.17,,,,,LOGIC pool1x,,2,,,");
    expect(received).toContain(",Received,in,5,");
  });

  it("never lets someone else's words run as a spreadsheet formula", () => {
    expect(csvCell("=HYPERLINK(1)", true)).toBe("'=HYPERLINK(1)");
    expect(csvCell("+1", true)).toBe("'+1");
    expect(csvCell('say "hi"', true)).toBe('"say ""hi"""');
    // Amounts are ours, and keep their sign.
    expect(csvCell("-5")).toBe("-5");
    const csv = activityCsv("preprod", [entry({ note: "=cmd|' /C calc'!A0", detail: "@SUM(A1)" })]);
    expect(csv).toContain(",'@SUM(A1),'=cmd|' /C calc'!A0,");
  });
});
