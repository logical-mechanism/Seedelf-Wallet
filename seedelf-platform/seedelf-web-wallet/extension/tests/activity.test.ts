// Activity: the Seedelf history (no requests, sealed on the device) and the
// Cardano account's pages from Koios, by its payment keys (two requests a page,
// one to catch up).
import { describe, expect, it } from "vitest";

import {
  accountMatcher,
  describe as describeTxs,
  noteOf,
  PAGE,
  SESSION_ACCOUNT_ACTIVITY_PREFIX,
  SESSION_ACCOUNT_ADDRESSES_PREFIX,
  takePage,
  type AccountAddresses,
} from "../src/background/activity";
import type { KoiosTxInfo, KoiosUtxo } from "../src/background/koios";
import { pendingKey } from "../src/background/pending";
import { LOCAL_POOLS_PREFIX } from "../src/background/staking";
import { NETWORKS } from "../src/networks";
import type { ActivityEntry, PendingTx } from "../src/shared/rpc";
import { txInputs } from "../src/background/cbor";
import { forgetSpent } from "../src/background/spent";
import { activityAmount, activityCsv, activityDetail, activityTitle, csvCell, signedQuantity, tokenMoved } from "../src/ui/activity";
import { formatAda } from "../src/ui/format";
import { assetFingerprint } from "../src/ui/tokens";
import { activityPreprod, koiosPreprod, ownedUtxos, testBalances, vectors } from "./fakes";

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

  // E01: the same token read "1,234.56" on Home and "+1,234,560,000" in Activity, which kept no decimals.
  it("gives a token the decimals the balance reading has from Koios, as Home shows it", async () => {
    const t = await unlocked();
    const b = await t.balances.get("preprod");
    const held = b.seedelf.tokens[0]!;
    expect(held.decimals).toBe(6);
    const arrived = (await t.activity.seedelf("preprod")).find((e) => e.assets?.length)!;
    expect(arrived.assets![0]).toMatchObject({ policyId: held.policyId, assetName: held.assetName, decimals: 6 });
    expect(signedQuantity("preprod", arrived.assets![0]!)).toBe("+1,234.56");
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
    // Kept as data, the first and how many more, and said in the page's words.
    expect(entry).toMatchObject({ kind: "transfer", direction: "out", lovelace: "8000000", tokens: 1, fee: "300000", detail: "alice", more: 2 });
    expect(activityDetail(entry!)).toBe("alice and 2 more");
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

  it("says where each private UTxO came from, by the transaction that made it (privacy review §2.3)", async () => {
    const t = await unlocked();
    // The private history started before this money arrived: its first reading found none (independent review L38).
    await t.activity.arrived("preprod", []);
    const at = (hex: string, index = 0) => ({ ...ownedUtxos[0]!, tx_hash: hex.repeat(32), tx_index: index });
    const sent = (kind: PendingTx["kind"], hex: string, summary: object) =>
      t.activity.sent("preprod", { kind, network: "preprod", txHash: hex.repeat(32), submittedAt: 1, confirmations: null }, summary);
    await sent("move-in", "01", { lovelace: "25000000" });
    await sent("lovejoin-withdraw", "02", { lovelace: "9710000" });
    await sent("session-out", "03", { index: 2, payments: [{ lovelace: "6000000" }] });
    await sent("session-back", "04", { index: 2, lovelace: "4000000" });
    // A payment's change has the history its review worked out from its inputs.
    const mixed = { id: "box:02+public:0", origin: "own" };
    await sent("transfer", "05", { payments: [{ to: "5eed0e1f", lovelace: "2000000" }], origin: mixed });
    await sent("withdraw", "06", { payments: [{ address: "addr_test1", lovelace: "2000000" }] });
    await t.activity.arrived("preprod", [at("07"), at("07", 1)]);

    const asked = t.koios.calls.length;
    const classes = await t.activity.classes("preprod", ["01", "02", "03", "04", "05", "06", "07", "08"].map((h) => at(h)).concat(at("07", 1)));
    expect(t.koios.calls).toHaveLength(asked);
    expect(Object.fromEntries([...classes].map(([k, c]) => [k.slice(0, 2) + k.slice(-2), c]))).toEqual({
      "01#0": { id: "public:0", origin: "own" },
      "02#0": { id: `box:${"02".repeat(32)}`, origin: "lovejoin" },
      "03#0": { id: "session:2", origin: "session" },
      "04#0": { id: "session:2", origin: "session" },
      "05#0": mixed,
      // A payment written down without it: its inputs aren't known. Kept apart by its transaction while
      // others' histories are known (independent review L40).
      "06#0": { id: `unknown:${"06".repeat(32)}`, origin: "unknown" },
      // Someone's payment is one history, whichever of its outputs.
      "07#0": { id: `received:${"07".repeat(32)}`, origin: "received" },
      "07#1": { id: `received:${"07".repeat(32)}`, origin: "received" },
      // Nothing on the device about it.
      "08#0": { id: `unknown:${"08".repeat(32)}`, origin: "unknown" },
    });
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
    expect(paths(t).slice(before)).toEqual(["credential_txs", "tx_info"]);
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
    expect(paths(t).slice(before)).toEqual(["credential_txs", "tx_info", "credential_txs"]);
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
        fee: string;
        inputs: Array<{ payment_addr: { bech32: string }; value: string }>;
        outputs: Array<{ payment_addr: { bech32: string }; value: string }>;
        withdrawals?: Array<{ amount: string; stake_addr: string }> | null;
      };
      const sum = (rows: typeof tx.inputs) =>
        rows.filter((r) => ours.has(r.payment_addr.bech32)).reduce((n, r) => n + BigInt(r.value), 0n);
      // Less the rewards withdrawn, which the balance counted already, and with the fee it paid said apart.
      const rewards = (tx.withdrawals ?? []).filter((w) => w.stake_addr === activityPreprod.stake).reduce((n, w) => n + BigInt(w.amount), 0n);
      const paid = tx.inputs.some((r) => ours.has(r.payment_addr.bech32));
      const net = sum(tx.outputs) - sum(tx.inputs) - rewards + (paid ? BigInt(tx.fee) : 0n);
      expect(e.direction, e.txHash).toBe(net > 0n ? "in" : net < 0n ? "out" : "none");
      expect(e.lovelace, e.txHash).toBe((net < 0n ? -net : net).toString());
      // A payment in from elsewhere pays no fee of ours.
      if (e.kind === "received") expect(e.fee).toBeUndefined();
    }
    expect(entries.map((e) => e.at)).toEqual([...entries.map((e) => e.at)].sort((a, b) => b - a));
  });

  // Read from the chain, a payment this device didn't make still says who: the addresses it paid, or that paid
  // it, from the transaction already read, with no request (chunk 23's review, A-1).
  it("names who a payment from elsewhere paid, or who paid it, from the transaction already read", async () => {
    const t = await unlocked();
    await t.balances.get("preprod");
    const before = t.koios.calls.length;
    const { entries } = await t.activity.cardano("preprod");
    expect(paths(t).slice(before)).toEqual(["credential_txs", "tx_info"]);
    const ours = new Set((await t.session.get<AccountAddresses>(`${SESSION_ACCOUNT_ADDRESSES_PREFIX}preprod`))!.addresses);
    const named = entries.filter((e) => e.kind === "sent" || e.kind === "received");
    expect(named.length).toBeGreaterThan(0);
    for (const e of named) {
      const tx = activityPreprod.tx_info.find((x) => x.tx_hash === e.txHash) as unknown as {
        inputs: Array<{ payment_addr: { bech32: string } }>;
        outputs: Array<{ payment_addr: { bech32: string } }>;
      };
      const others = [...new Set((e.kind === "sent" ? tx.outputs : tx.inputs).map((r) => r.payment_addr.bech32))].filter(
        (a) => !ours.has(a),
      );
      expect(e.detail, e.txHash).toBe(others[0]);
      expect(e.more ?? 0, e.txHash).toBe(Math.max(0, others.length - 1));
    }
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
  const read = (t: KoiosTxInfo) => describeTxs([t], accountMatcher({ addresses: [ME], keys: [] }), new Map(), STAKE)[0]!;
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
    // The deposit is what left, the fee apart.
    expect(staked).toMatchObject({
      kind: "stake",
      direction: "out",
      lovelace: "2000000",
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
    expect(paths(t).slice(before)).toEqual(["credential_txs", "tx_info"]);
  });
});

describe("what's the Cardano account's in its activity", () => {
  const STAKE = activityPreprod.stake;
  const MY_KEY = "11".repeat(28);
  const THEIR_KEY = "22".repeat(28);
  const mine = accountMatcher({ addresses: ["addr_test1_my_base"], keys: [MY_KEY] });
  const out = (bech32: string, cred: string, value: string) => ({ payment_addr: { bech32, cred }, value, asset_list: [] });
  const tx = (inputs: KoiosTxInfo["inputs"], outputs: KoiosTxInfo["outputs"], extra: Partial<KoiosTxInfo> = {}): KoiosTxInfo => ({
    tx_hash: "ef".repeat(32),
    block_height: 1,
    tx_timestamp: 1_800_000_000,
    fee: "200000",
    inputs,
    outputs,
    ...extra,
  });

  it("is what's under its payment keys, whatever the staking part, as the balance counts it", () => {
    // Paid to the account's own key at an address with no staking part: received.
    const enterprise = tx(
      [out("addr_test1_them", THEIR_KEY, "12000000")],
      [out("addr_test1v_my_key", MY_KEY, "5000000"), out("addr_test1_them", THEIR_KEY, "6800000")],
    );
    expect(describeTxs([enterprise], mine, new Map(), STAKE)).toMatchObject([{ kind: "received", direction: "in", lovelace: "5000000" }]);
  });

  it("leaves out someone paying their own key under the account's stake key, and their note", () => {
    const franken = tx(
      [out("addr_test1_them", THEIR_KEY, "12000000")],
      [out("addr_test1_their_key_our_stake", THEIR_KEY, "11800000")],
      { metadata: { "674": { msg: ["Your wallet is at risk: visit evil.example"] } } },
    );
    expect(describeTxs([franken], mine, new Map(), STAKE)).toEqual([]);
    // Staking the account's key is the account's, whatever the outputs.
    const staked = { ...franken, certificates: [{ index: 0, type: "vote_delegation", info: { stake_address: STAKE, drep_id: "drep1xyz" } }] };
    expect(describeTxs([staked], mine, new Map(), STAKE)).toMatchObject([{ kind: "vote" }]);
  });

  it("reads the account's keys from the balance reading", async () => {
    const t = await unlocked();
    await t.balances.get("preprod");
    const account = (await t.session.get<AccountAddresses>(`${SESSION_ACCOUNT_ADDRESSES_PREFIX}preprod`))!;
    const held = koiosPreprod.accounts[STAKE]!.account_utxos.map((u) => u.payment_cred).filter((c) => c !== null);
    expect(held.length).toBeGreaterThan(0);
    for (const key of held) expect(account.keys).toContain(key);

    // The newest transaction, as someone paying their own key under our stake key would make it.
    const [first] = activityPreprod.account_txs;
    t.koios.txExtras.set(first!.tx_hash, {
      inputs: [out("addr_test1_them", THEIR_KEY, "12000000")],
      outputs: [out("addr_test1_their_key_our_stake", THEIR_KEY, "11800000")],
    });
    const { entries } = await t.activity.cardano("preprod");
    expect(entries.map((e) => e.txHash)).not.toContain(first!.tx_hash);
    expect(entries).toHaveLength(19);
  });
});

// O7: Public activity listed by the stake key while the balance counts by payment key, so a payment to an
// enterprise address of the account, or to its key under someone else's stake key, was spent but never listed.
describe("what Public activity lists is what the balance counts (O7)", () => {
  const ADDRESSES = `${SESSION_ACCOUNT_ADDRESSES_PREFIX}preprod`;
  const RECORDED = new Set(koiosPreprod.accounts[activityPreprod.stake]!.account_utxos.flatMap((u) => u.payment_cred ?? []));
  const THEIRS = "addr_test1_them";
  const THEIR_KEY = "22".repeat(28);
  const out = (bech32: string, cred: string, value: string) => ({ payment_addr: { bech32, cred }, value, asset_list: [] });
  type Row = { tx_hash: string; block_height: number; block_time: number };
  /** `value` paid to `key` at `address` by someone else, in `row`'s block, as Koios lists it under the key and reads it. */
  function paid(t: Awaited<ReturnType<typeof unlocked>>, key: string, row: Row, address: string, value: string) {
    t.koios.credentialTxs.set(key, [...(t.koios.credentialTxs.get(key) ?? []), row]);
    t.koios.txRows.set(row.tx_hash, {
      tx_hash: row.tx_hash,
      block_height: row.block_height,
      tx_timestamp: row.block_time,
      fee: "170000",
      inputs: [out(THEIRS, THEIR_KEY, "50000000")],
      outputs: [out(address, key, value), out(THEIRS, THEIR_KEY, (50_000_000n - 170_000n - BigInt(value)).toString())],
    });
  }
  const read = async (t: Awaited<ReturnType<typeof unlocked>>) => {
    await t.balances.get("preprod");
    return (await t.session.get<AccountAddresses>(ADDRESSES))!;
  };

  it("asks by the payment keys the balance reading asked about", async () => {
    const t = await unlocked();
    const { keys } = await read(t);
    const reading = t.koios.calls.find((c) => c.path === "credential_utxos" && c.body._payment_credentials.includes(keys[0]));
    expect(reading!.body._payment_credentials).toEqual(keys);
    const before = t.koios.calls.length;
    await t.activity.cardano("preprod");
    expect(t.koios.calls[before]).toMatchObject({ path: "credential_txs", body: { _payment_credentials: keys } });
    expect(t.koios.calls[before]!.query).toContain("offset=0&limit=20");
  });

  it("lists a payment to an enterprise address of the account, and to its key under someone else's stake key", async () => {
    const t = await unlocked();
    const { keys } = await read(t);
    // Keys in range that hold nothing in the recordings: what account_txs, by the stake key, never listed.
    const [a, b] = keys.filter((k) => !RECORDED.has(k));
    const top = activityPreprod.account_txs[0]!;
    paid(t, a!, { tx_hash: "e1".repeat(32), block_height: top.block_height + 2, block_time: top.block_time + 60 }, "addr_test1v_enterprise", "5000000");
    paid(t, b!, { tx_hash: "e2".repeat(32), block_height: top.block_height + 1, block_time: top.block_time + 30 }, "addr_test1q_their_stake", "7000000");

    const { entries } = await t.activity.cardano("preprod");
    expect(entries).toHaveLength(20);
    expect(entries.slice(0, 2)).toMatchObject([
      { txHash: "e1".repeat(32), kind: "received", direction: "in", lovelace: "5000000", detail: THEIRS },
      { txHash: "e2".repeat(32), kind: "received", direction: "in", lovelace: "7000000", detail: THEIRS },
    ]);
    // And in the CSV.
    expect(activityCsv("preprod", entries)).toContain(`,Received,in,5,,,${THEIRS},`);
  });

  it("asks in groups of 75 past that, paged as one list: none skipped, none listed twice", async () => {
    const t = await unlocked();
    const account = await read(t);
    // 60 keys more, as an account with many addresses used has: two groups, the second of the last 27.
    const more = Array.from({ length: 60 }, (_, i) => `${"ab".repeat(26)}${i.toString(16).padStart(4, "0")}`);
    const keys = [...account.keys, ...more];
    expect(keys.length).toBeGreaterThan(75);
    await t.wallet.withKeys(() => t.session.set(ADDRESSES, { ...account, keys }));
    const late = keys.slice(75);
    // Ten payments under the second group's keys, each in the block of a recorded transaction, and one recorded
    // transaction under a key of each group.
    const added: Row[] = [3, 8, 13, 18, 23, 28, 33, 38, 41, 44].map((j, n) => {
      const r = activityPreprod.account_txs[j]!;
      return { tx_hash: `f${n}`.padEnd(64, "f"), block_height: r.block_height, block_time: r.block_time };
    });
    added.forEach((row, n) => paid(t, late[n % late.length]!, row, "addr_test1v_enterprise", "1000000"));
    t.koios.credentialTxs.set(late[0]!, [...t.koios.credentialTxs.get(late[0]!)!, activityPreprod.account_txs[10]!]);

    const order = (x: Row, y: Row) => y.block_height - x.block_height || (x.tx_hash < y.tx_hash ? -1 : 1);
    const all = [...activityPreprod.account_txs, ...added].sort(order).map((r) => r.tx_hash);
    const before = t.koios.calls.length;
    const pages = [await t.activity.cardano("preprod")];
    while (pages.at(-1)!.more) pages.push(await t.activity.cardano("preprod", true));
    const asked = t.koios.calls.slice(before).filter((c) => c.path === "credential_txs");
    // Two requests a page, the groups in order: the first 75 keys, then the rest.
    expect(asked).toHaveLength(pages.length * 2);
    expect(asked.map((c) => c.body._payment_credentials.length).slice(0, 2)).toEqual([75, keys.length - 75]);
    // Each page the newest 20 not listed yet, across both groups.
    for (const [i, page] of pages.entries()) {
      expect(new Set(page.entries.map((e) => e.txHash)), `page ${i + 1}`).toEqual(new Set(all.slice(0, Math.min(all.length, 20 * (i + 1)))));
    }
    expect(pages.at(-1)!.entries.map((e) => e.txHash).sort()).toEqual([...all].sort());
    expect(all).toHaveLength(55);
  });

  it("starts the pages again when a reading finds other keys", async () => {
    const t = await unlocked();
    const account = await read(t);
    await t.activity.cardano("preprod");
    expect((await t.activity.cardano("preprod", true)).entries).toHaveLength(40);
    // An address used past the range: the next reading asks about a key more, and the offsets read by the old
    // keys say nothing of the new.
    const keys = [...account.keys, "ab".repeat(28)];
    await t.wallet.withKeys(() => t.session.set(ADDRESSES, { ...account, keys }));
    const before = t.koios.calls.length;
    const again = await t.activity.cardano("preprod");
    expect(again.entries).toHaveLength(20);
    expect(t.koios.calls[before]).toMatchObject({ path: "credential_txs", body: { _payment_credentials: keys } });
    expect(t.koios.calls[before]!.query).toContain("offset=0&limit=20");
  });
});

describe("pages from several groups of keys (takePage)", () => {
  const row = (n: number, height: number) => ({ tx_hash: n.toString(16).padStart(64, "0"), block_height: height, block_time: height * 20 });

  it("are the newest 20 of all, none skipped or taken twice, however the groups overlap", () => {
    // 130 transactions, three to a block, newest first; each under one group's keys, or two.
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const txs = Array.from({ length: 130 }, (_, n) => row(n, 1000 - Math.floor(n / 3)));
    const of = txs.map(() => {
      const g = Math.floor(random() * 3);
      return new Set([g, random() < 0.3 ? (g + 1) % 3 : g]);
    });
    const full = [0, 1, 2].map((g) => txs.filter((_, i) => of[i]!.has(g)));
    expect(of.some((g) => g.size === 2)).toBe(true);

    let offsets = [0, 0, 0];
    const listed = new Set<string>();
    const pages: string[][] = [];
    for (let guard = 0; guard < 50; guard++) {
      const lists = full.map((g, i) => g.slice(offsets[i], offsets[i]! + PAGE));
      const { rows, read, more } = takePage(lists, listed);
      for (const r of rows) listed.add(r.tx_hash);
      pages.push(rows.map((r) => r.tx_hash));
      offsets = offsets.map((o, i) => o + read[i]!);
      if (!more) break;
    }
    expect(pages.flat()).toEqual(txs.map((t) => t.tx_hash));
    expect(pages.every((p) => p.length <= PAGE)).toBe(true);
  });

  it("with one group, is its page as it came", () => {
    const list = Array.from({ length: PAGE }, (_, n) => row(n, 50 - n));
    expect(takePage([list], new Set())).toEqual({ rows: list, read: [PAGE], more: true });
    expect(takePage([list.slice(0, 7)], new Set())).toEqual({ rows: list.slice(0, 7), read: [7], more: false });
  });
});

// Chunk 16's Not done: a mix from the public account listed its deposit and every mix as plain Sent, since an
// account transaction's kind came only from the private history. They're named from the mix box now.
describe("a public mix's transactions (O7)", () => {
  const STAKE = activityPreprod.stake;
  const MIX_BOX = NETWORKS.preprod.lovejoin!.mixBox;
  const ME = "addr_test1_me";
  const MY_KEY = "11".repeat(28);
  const ours = accountMatcher({ addresses: [ME], keys: [MY_KEY] });
  const out = (bech32: string, cred: string, value: string) => ({ payment_addr: { bech32, cred }, value, asset_list: [] });
  const me = (value: string) => out(ME, MY_KEY, value);
  const box = () => out("addr_test1w_mix_box", MIX_BOX, "10000000");
  const tx = (n: number, inputs: KoiosTxInfo["inputs"], outputs: KoiosTxInfo["outputs"]): KoiosTxInfo => ({
    tx_hash: `${n}`.repeat(64),
    block_height: 10 - n,
    tx_timestamp: 1_800_000_000 - n,
    fee: "200000",
    inputs,
    outputs,
  });
  const deposit = tx(1, [me("50000000")], [box(), box(), box(), me("19800000")]);
  const mix = tx(2, [me("19800000"), box(), box()], [box(), box(), me("19600000")]);
  const back = tx(3, [box()], [me("9800000")]);

  it("names a deposit, each mix and a box back from the mix box alone", () => {
    const [d, m, b] = describeTxs([deposit, mix, back], ours, new Map(), STAKE, undefined, MIX_BOX);
    // The deposit is what went into the boxes; a mix pays the account its change back, so it's the fee alone.
    expect(d).toMatchObject({ kind: "lovejoin-deposit", direction: "out", lovelace: "30000000", fee: "200000" });
    expect(d!.detail).toBeUndefined();
    expect(m).toMatchObject({ kind: "lovejoin-round", direction: "none", lovelace: "0", fee: "200000" });
    expect(b).toMatchObject({ kind: "lovejoin-withdraw", direction: "in", lovelace: "9800000" });
    expect(b!.fee).toBeUndefined();
    expect([d!, m!, b!].map(activityTitle)).toEqual(["Into Lovejoin", "Lovejoin mix", "Back from Lovejoin"]);
    expect(activityAmount(m!)).toBe("−0.2 ₳");
    const csv = activityCsv("preprod", [d!, m!, b!]);
    expect(csv).toContain(",Into Lovejoin,out,-30,0.2,");
    expect(csv).toContain(",Lovejoin mix,none,0,0.2,");
    expect(csv).toContain(",Back from Lovejoin,in,9.8,,");
  });

  it("leaves the private history's own entry first, and a seed is a deposit too", () => {
    const own = new Map([[deposit.tx_hash, { txHash: deposit.tx_hash, at: 0, kind: "move-in", direction: "in", lovelace: "0", tokens: 0 } as ActivityEntry]]);
    expect(describeTxs([deposit], ours, own, STAKE, undefined, MIX_BOX)).toMatchObject([{ kind: "move-in" }]);
    // A seed: boxes in, no mixes after.
    const seed = tx(4, [me("30500000")], [box(), box(), box(), me("300000")]);
    expect(describeTxs([seed], ours, new Map(), STAKE, undefined, MIX_BOX)).toMatchObject([{ kind: "lovejoin-deposit", lovelace: "30000000" }]);
    // Someone else's mix that moves boxes alone isn't the account's.
    expect(describeTxs([tx(5, [box(), box()], [box(), box()])], ours, new Map(), STAKE, undefined, MIX_BOX)).toEqual([]);
  });

  it("is named in Public activity on the network it's read on", async () => {
    const t = await unlocked();
    await t.balances.get("preprod");
    const { keys } = (await t.session.get<AccountAddresses>(`${SESSION_ACCOUNT_ADDRESSES_PREFIX}preprod`))!;
    const top = activityPreprod.account_txs[0]!;
    const row = { tx_hash: "d1".repeat(32), block_height: top.block_height + 1, block_time: top.block_time + 60 };
    t.koios.credentialTxs.set(keys[0]!, [row]);
    t.koios.txRows.set(row.tx_hash, {
      ...deposit,
      tx_hash: row.tx_hash,
      block_height: row.block_height,
      tx_timestamp: row.block_time,
      inputs: [out("addr_test1_mine", keys[0]!, "50000000")],
      outputs: [box(), box(), box(), out("addr_test1_mine", keys[0]!, "19800000")],
    });
    const { entries } = await t.activity.cardano("preprod");
    expect(entries[0]).toMatchObject({ txHash: row.tx_hash, kind: "lovejoin-deposit", direction: "out", lovelace: "30000000" });
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
      entry({ kind: "stake", direction: "out", lovelace: "2000000", fee: "170000", staking: { pool: "pool1x", ticker: "LOGIC", deposit: "2000000" } }),
      entry({ kind: "received", direction: "in", lovelace: "5000000" }),
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    const [head, sent, staked, received] = csv.slice(1).trimEnd().split("\r\n");
    expect(head).toBe(
      "Date (UTC),Type,Direction,ADA,Network fee (ADA),Tokens,To or from,Note,Pool,Vote,Deposit (ADA),Deposit back (ADA),Rewards withdrawn (ADA),Transaction",
    );
    // TUSDM here is a stranger's token named like the listed tUSDM: its whole fingerprint names it, and says so.
    const fake = assetFingerprint(TUSDM);
    expect(sent).toBe(
      `2026-09-25T12:30:00.000Z,Sent,out,-1234.56789,0.17,"${fake} (not on the wallet's list: it calls itself tUSDM, but it isn't the listed tUSDM): -1500000",,"rent, September",,,,,,${"cd".repeat(32)}`,
    );
    expect(staked).toContain(",Staked,out,-2,0.17,,,,LOGIC pool1x,,2,,,");
    expect(received).toContain(",Received,in,5,");
  });

  it("names a listed token by its ticker, in its units, and marks any other (launch review #18)", () => {
    const listed = { policyId: "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde", assetName: "0014df10745553444d" };
    const foo = { policyId: TUSDM.policyId, assetName: "464f4f" };
    const csv = activityCsv("preprod", [entry({ assets: [{ ...listed, quantity: "-1500000" }, { ...foo, quantity: "7" }] })]);
    expect(csv).toContain(`"tUSDM: -1.5; FOO (not on the wallet's list, ${assetFingerprint(foo)}): +7"`);
    expect(tokenMoved("preprod", { ...listed, quantity: "2500000" })).toBe("+2.5 tUSDM");
    expect(tokenMoved("preprod", { ...foo, quantity: "-3" })).toMatch(/^−3 FOO \(not on the wallet's list, asset1\w{4}…\w{6}\)$/);
    expect(tokenMoved("preprod", { ...TUSDM, quantity: "5" })).toMatch(/^\+5 asset1\w{4}…\w{6} \(not on the wallet's list: it calls itself tUSDM, but it isn't the listed tUSDM\)$/);
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

// T08: 25 ₳ paid from the public account, its 57.475311 ₳ of rewards collected into the change: one 3 ₳ coin in,
// 25 ₳ to the recipient and 35.300614 ₳ back, a 0.174697 ₳ fee. Activity listed it "Sent +32.300614 ₳", the change
// less the coin, and its details "Amount +32.300614 ₳" (blind test §9.1); T04's 12 ₳ would have read "+45.300614 ₳".
describe("a payment that collected the staking rewards (blind test §9.1, T08)", () => {
  const STAKE = activityPreprod.stake;
  const ME = "addr_test1_me";
  const MY_KEY = "11".repeat(28);
  const ours = accountMatcher({ addresses: [ME], keys: [MY_KEY] });
  type Out = KoiosTxInfo["outputs"][number];
  const at = (bech32: string, cred: string, value: string, asset_list: Out["asset_list"] = []): Out =>
    ({ payment_addr: { bech32, cred }, value, asset_list }) as Out;
  const mine = (value: string, assets: Out["asset_list"] = []) => at(ME, MY_KEY, value, assets);
  const theirs = (n: number, value: string, assets: Out["asset_list"] = []) => at(`addr_test1_them${n}`, `2${n}`.repeat(28), value, assets);
  const tx = (outputs: Out[], extra: Partial<KoiosTxInfo> = {}): KoiosTxInfo => ({
    tx_hash: "ab".repeat(32),
    block_height: 1,
    tx_timestamp: 1_800_000_000,
    fee: "174697",
    inputs: [mine("3000000")],
    outputs,
    withdrawals: [{ amount: "57475311", stake_addr: STAKE }],
    ...extra,
  });
  const read = (t: KoiosTxInfo, own: ReadonlyMap<string, ActivityEntry> = new Map()) => describeTxs([t], ours, own, STAKE)[0]!;

  it("lists what was paid, never with a plus, the fee and the rewards collected apart", () => {
    const sent = read(tx([theirs(1, "25000000"), mine("35300614")]));
    expect(sent).toMatchObject({
      kind: "sent",
      direction: "out",
      lovelace: "25000000",
      fee: "174697",
      detail: "addr_test1_them1",
      staking: { rewards: "57475311" },
    });
    expect(activityAmount(sent)).toBe("−25 ₳");
    // T04's 12 ₳: its change held 48.300614 ₳.
    expect(read(tx([theirs(1, "12000000"), mine("48300614")]))).toMatchObject({ kind: "sent", direction: "out", lovelace: "12000000" });
  });

  it("adds up several recipients, says the first and how many more, and the tokens that went", () => {
    const token = (quantity: string) => [{ policy_id: TUSDM.policyId, asset_name: TUSDM.assetName, quantity, decimals: 0, fingerprint: "" }];
    const t = tx([theirs(1, "5000000"), theirs(2, "1500000", token("4")), mine("53800614", token("6"))], {
      inputs: [mine("3000000", token("10"))],
    });
    expect(read(t)).toMatchObject({
      kind: "sent",
      direction: "out",
      lovelace: "6500000",
      detail: "addr_test1_them1",
      more: 1,
      assets: [{ ...TUSDM, quantity: "-4" }],
    });
  });

  it("counts a payment to another of the user's own accounts or Seedelfs as paid: it left this account", () => {
    // Another account's key, and the wallet contract: neither is this account's.
    const other = at("addr_test1_my_other_account", "33".repeat(28), "25000000");
    expect(read(tx([other, mine("35300614")]))).toMatchObject({ kind: "sent", direction: "out", lovelace: "25000000" });
    const seedelf = at("addr_test1_contract", "94bca9c099e84ffd90d150316bb44c31a78702239076a0a80ea4a469", "25000000");
    expect(read(tx([seedelf, mine("35300614")]))).toMatchObject({ kind: "sent", direction: "out", lovelace: "25000000" });
  });

  // T07: 20 ₳ made private from the account, rewards collected: 40.296962 ₳ back from one 3 ₳ coin, a 0.178349 ₳ fee.
  it("lists a Make private as what went into the private balance (T07)", () => {
    const madePrivate: ActivityEntry = { txHash: "ab".repeat(32), at: 1, kind: "move-in", direction: "in", lovelace: "20000000", tokens: 0 };
    const contract = at("addr_test1_contract", "94bca9c099e84ffd90d150316bb44c31a78702239076a0a80ea4a469", "20000000");
    const e = read(tx([contract, mine("40296962")], { fee: "178349" }), new Map([[madePrivate.txHash, madePrivate]]));
    expect(e).toMatchObject({ kind: "move-in", direction: "out", lovelace: "20000000", fee: "178349", staking: { rewards: "57475311" } });
    expect(activityAmount(e)).toBe("−20 ₳");
  });

  // E04 and T13: what the reviews said, "Your balance stays the same, but for the fee", and the deposit back.
  it("keeps a withdrawal and a stop right: the fee alone, and the deposit back", () => {
    const withdrew = read(tx([mine("15173929")], { fee: "171749", withdrawals: [{ amount: "12345678", stake_addr: STAKE }] }));
    expect(withdrew).toMatchObject({ kind: "withdraw-rewards", direction: "none", lovelace: "0", fee: "171749", staking: { rewards: "12345678" } });
    expect(activityAmount(withdrew)).toBe("−0.171749 ₳");
    const stopped = read(
      tx([mine("62301626")], {
        fee: "173685",
        certificates: [{ index: 0, type: "stake_deregistration", info: { stake_address: STAKE, refund: "2000000" } }],
      }),
    );
    expect(stopped).toMatchObject({ kind: "unstake", direction: "in", lovelace: "2000000", staking: { stopped: true, refund: "2000000", rewards: "57475311" } });
    expect(activityAmount(stopped)).toBe("+2 ₳");
  });

  it("calls one that left the account better off received, though it spent a coin to", () => {
    // A site's payout: 100 ₳ from its script, the account's 3 ₳ coin for the fee, no rewards.
    const payout = tx([mine("102825303")], { inputs: [mine("3000000"), theirs(9, "100000000")], withdrawals: [] });
    expect(read(payout)).toMatchObject({ kind: "received", direction: "in", lovelace: "100000000", fee: "174697" });
  });

  it("writes the CSV so ADA less the fee is what the balance did, the rewards in their own column", () => {
    const [, row] = activityCsv("preprod", [read(tx([theirs(1, "25000000"), mine("35300614")]))]).slice(1).trimEnd().split("\r\n");
    expect(row).toContain(",Sent,out,-25,0.174697,,addr_test1_them1,,,,,,57.475311,");
  });
});

describe("Public activity's payment on its way (blind test §9.3, T08)", () => {
  const THEIRS = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 15)!.preprod.receive_0 as string;
  /** On a chain tip like preprod's, so the fee is T08's, and the device's real clock, by which a send is kept. */
  const onPreprod = async () => {
    const v = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
    const t = testBalances();
    t.koios.tip = 106_000_000;
    t.clock.now = Date.now();
    await t.wallet.create(v.phrase, PASSWORD);
    return t;
  };

  it("lists the payment the wallet sent before Koios does, pending, from what the device keeps", async () => {
    const t = await onPreprod();
    await t.balances.get("preprod");
    const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "25000000", tokens: [] }]);
    await t.send.submit("preprod", summary.txHash);
    const before = t.koios.calls.length;
    const { entries } = await t.activity.cardano("preprod");
    // Koios is asked what it always is, and nothing more.
    expect(paths(t).slice(before)).toEqual(["credential_txs", "tx_info"]);
    expect(entries[0]).toMatchObject({
      txHash: summary.txHash,
      pending: true,
      kind: "sent",
      direction: "out",
      lovelace: "25000000",
      fee: "174697",
      detail: THEIRS,
      staking: { rewards: "57475311" },
    });
    expect(activityAmount(entries[0]!)).toBe("−25 ₳");
    // Not in the CSV: it isn't on chain yet.
    expect(activityCsv("preprod", entries)).not.toContain(summary.txHash);

    // Refused or let go, its coins freed: it never went out, and it goes.
    await t.wallet.withKeys(() => forgetSpent(t.session, txInputs(t.koios.submitted[0]!)));
    expect((await t.activity.cardano("preprod")).entries.some((e) => e.pending)).toBe(false);
  });

  it("gives way to the entry Koios lists, once it's in a block", async () => {
    const t = await onPreprod();
    await t.balances.get("preprod");
    const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "25000000", tokens: [] }]);
    await t.send.submit("preprod", summary.txHash);
    const account = (await t.session.get<AccountAddresses>(`${SESSION_ACCOUNT_ADDRESSES_PREFIX}preprod`))!;
    const spent = koiosPreprod.accounts[activityPreprod.stake]!.account_utxos.find((u) => txInputs(t.koios.submitted[0]!).includes(`${u.tx_hash}#${u.tx_index}`))!;
    const top = activityPreprod.account_txs[0]!;
    const row = { tx_hash: summary.txHash, block_height: top.block_height + 1, block_time: top.block_time + 60 };
    const info = {
      tx_hash: summary.txHash,
      block_height: row.block_height,
      tx_timestamp: row.block_time,
      fee: "174697",
      inputs: [{ payment_addr: { bech32: spent.address, cred: spent.payment_cred }, value: spent.value, asset_list: [] }],
      outputs: [
        { payment_addr: { bech32: THEIRS, cred: "44".repeat(28) }, value: "25000000", asset_list: [] },
        { payment_addr: { bech32: spent.address, cred: account.keys[0] }, value: "35300614", asset_list: [] },
      ],
      withdrawals: [{ amount: "57475311", stake_addr: activityPreprod.stake }],
    };
    activityPreprod.account_txs.unshift(row);
    (activityPreprod.tx_info as unknown[]).push(info);
    try {
      const { entries } = await t.activity.cardano("preprod");
      const listed = entries.filter((e) => e.txHash === summary.txHash);
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ kind: "sent", direction: "out", lovelace: "25000000", fee: "174697" });
      expect(listed[0]!.pending).toBeUndefined();
    } finally {
      activityPreprod.account_txs.shift();
      (activityPreprod.tx_info as unknown[]).pop();
    }
  });

  it("lists a Make private as made private, pending, on the public side too", async () => {
    const t = await onPreprod();
    await t.balances.get("preprod");
    const summary = await t.moveIn.build("preprod", "20000000", []);
    await t.moveIn.submit("preprod", summary.txHash);
    const { entries } = await t.activity.cardano("preprod");
    expect(entries[0]).toMatchObject({ txHash: summary.txHash, pending: true, kind: "move-in", direction: "out", lovelace: "20000000", fee: "178349" });
  });

  // To the chain it's a payment to itself, which read "Sent" once Koios listed it (post-release-roadmap.md's Kept in mind).
  it("names a collateral payment Set collateral, on its way and in a block, from its record, after a reclaim too", async () => {
    const t = await onPreprod();
    await t.balances.get("preprod");
    const summary = await t.send.buildCollateral("preprod");
    await t.send.submitCollateral("preprod", summary.txHash);
    // Not from the watch, which follows only the network's newest.
    await t.session.remove(pendingKey("preprod"));
    const pending = (await t.activity.cardano("preprod")).entries[0]!;
    expect(pending).toMatchObject({ txHash: summary.txHash, pending: true, kind: "collateral", direction: "none", lovelace: "0", fee: summary.fee });
    expect(activityTitle(pending)).toBe("Set collateral");

    // In a block: its 5 ₳ and its change back to the account, the rewards collected as in every account payment.
    const account = (await t.session.get<AccountAddresses>(`${SESSION_ACCOUNT_ADDRESSES_PREFIX}preprod`))!;
    const inputs = txInputs(t.koios.submitted[0]!);
    const spent = koiosPreprod.accounts[activityPreprod.stake]!.account_utxos.filter((u) => inputs.includes(`${u.tx_hash}#${u.tx_index}`));
    expect(spent).toHaveLength(inputs.length);
    const top = activityPreprod.account_txs[0]!;
    const row = { tx_hash: summary.txHash, block_height: top.block_height + 1, block_time: top.block_time + 60 };
    const home = { bech32: summary.payments[0]!.address, cred: account.keys[0] };
    const info = {
      tx_hash: summary.txHash,
      block_height: row.block_height,
      tx_timestamp: row.block_time,
      fee: summary.fee,
      inputs: spent.map((u) => ({ payment_addr: { bech32: u.address, cred: u.payment_cred }, value: u.value, asset_list: [] })),
      outputs: [
        { payment_addr: home, value: "5000000", asset_list: [] },
        { payment_addr: home, value: summary.changeLovelace, asset_list: [] },
      ],
      withdrawals: summary.withdrawal ? [{ amount: summary.withdrawal, stake_addr: activityPreprod.stake }] : [],
    };
    activityPreprod.account_txs.unshift(row);
    (activityPreprod.tx_info as unknown[]).push(info);
    try {
      const listed = (await t.activity.cardano("preprod")).entries.filter((e) => e.txHash === summary.txHash);
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ kind: "collateral", direction: "none", lovelace: "0", fee: summary.fee });
      expect(listed[0]!.pending).toBeUndefined();
      expect(listed[0]!.detail).toBeUndefined();
      expect(activityAmount(listed[0]!)).toBe(`−${formatAda(summary.fee)} ₳`);
      expect(activityCsv("preprod", listed)).toContain(`,Set collateral,none,0,${formatAda(summary.fee)},`);

      // Reclaimed, then read afresh (a new session's pages): still the collateral payment it was.
      await t.coins.reclaim("preprod");
      await t.session.remove(`${SESSION_ACCOUNT_ACTIVITY_PREFIX}preprod`);
      const again = (await t.activity.cardano("preprod")).entries.find((e) => e.txHash === summary.txHash);
      expect(again).toMatchObject({ kind: "collateral" });
    } finally {
      activityPreprod.account_txs.shift();
      (activityPreprod.tx_info as unknown[]).pop();
    }
  });
});
