// Staking and voting delegation from the Cardano account, on the recorded
// preprod account (registered, staking with LOGIC, always abstaining, with
// rewards): what each screen asks Koios, the pool list kept for a day, the
// builds signed through WebAssembly, and the rewards spent along with a
// payment, or not.
import { describe, expect, it, vi } from "vitest";

import {
  Koios,
  type FetchLike,
  type KoiosAccountUpdate,
  type KoiosPoolEpoch,
  type KoiosReward,
  type KoiosTxInfo,
} from "../src/background/koios";
import { pendingKey } from "../src/background/pending";
import { LOCAL_POOLS_PREFIX, NAMED_TXS, POOLS_TTL_MS, SESSION_STAKE, drepName, saturation, takesDeposit } from "../src/background/staking";
import { txIdOf } from "./fixtures/cbor";
import { delegationsPreprod, poolHistoryFixture, rewardsPreprod, stakingPreprod, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find(
    (v) => v.account === 0 && v.phrase.split(" ").length === words && (words !== 24 || v.phrase.endsWith(" art")),
  )!;
const LOGIC = "pool1rccstu3l9ty3k0a5cd06fl3szsss9r34dcg5j38fqgq9kvng0tg";
const TPREP = "pool1sh4cddrln788xmnjnsqhdwj9e7th3c3ck3zjk7ny9znwj44t8he";
const LOGIC_DREP = "drep1ydmraa6kv8cvmry059v608tehl50nfmg0z764lmsqkvwurs40sw2z";
const REWARDS = "57475311";
const THEIRS = account(15).preprod.receive_0 as string;

async function unlocked(words = 12) {
  const t = testBalances();
  await t.wallet.create(account(words).phrase, PASSWORD);
  return t;
}

const paths = (t: ReturnType<typeof testBalances>) => t.koios.calls.map((c) => c.path).sort();

describe("the stake key in the balances", () => {
  it("shows the pool by its ticker, the vote and the rewards", async () => {
    const t = await unlocked();
    const b = await t.balances.get("preprod");
    expect(b.cardano.staking).toEqual({
      registered: true,
      pool: { id: LOGIC, ticker: "LOGIC", name: "Logical Mechanism" },
      drep: "drep_always_abstain",
      rewards: REWARDS,
      deposit: "2000000",
      // Paid rewards, so it has a history (chunk 30).
      rewarded: true,
    });
    // `lovelace` is the UTxOs' only; the rewards are apart.
    const utxos = stakingPreprod.account_info[0]!;
    expect(b.cardano.lovelace).not.toBe(utxos.rewards_available);
  });

  it("takes the ticker from the pool list on the device, with no pool_info", async () => {
    const t = await unlocked();
    await t.staking.pools("preprod");
    t.koios.calls.length = 0;
    const b = await t.balances.get("preprod");
    expect(b.cardano.staking.pool).toEqual({ id: LOGIC, ticker: "LOGIC" });
    expect(paths(t)).not.toContain("pool_info");
  });

  it("never waits for a ticker: the reading shows the pool's ID, and the next one its ticker (chunk 26b)", async () => {
    // A pool nobody had looked at in 10 minutes held Home up to 3 s on the data layer, for its live stake.
    const t = await unlocked();
    let answer!: () => void;
    const slow = new Promise<void>((r) => (answer = r));
    const waiting: FetchLike = async (url, init) => {
      if (url.includes("pool_info")) await slow;
      return t.koios.fetch(url, init);
    };
    const deps = { ...t.deps, koios: () => new Koios("https://preprod.koios.rest/api/v1", waiting, async () => undefined) };
    const { BalanceService } = await import("../src/background/balances");
    const balances = new BalanceService(deps);
    const first = await balances.get("preprod", true);
    expect(first.cardano.staking.pool).toEqual({ id: LOGIC });
    answer();
    await vi.waitFor(async () =>
      expect((await balances.get("preprod")).cardano.staking.pool).toEqual({ id: LOGIC, ticker: "LOGIC", name: "Logical Mechanism" }),
    );
    // Asked once, and remembered for the session.
    await balances.get("preprod", true);
    expect(paths(t).filter((p) => p === "pool_info")).toHaveLength(1);
  });

  it("reads a key that was never registered as not staking", async () => {
    const t = await unlocked(15);
    const b = await t.balances.get("preprod");
    expect(b.cardano.staking).toEqual({ registered: false, pool: null, drep: null, rewards: "0", deposit: "0" });
    expect(paths(t)).not.toContain("pool_info");
  });

  it("says a key that stopped staking was paid rewards, so its history stays on the page (chunk 30)", async () => {
    const t = await unlocked(15);
    const stake = account(15).preprod.stake as string;
    const stopped = { stake_address: stake, status: "not registered", delegated_pool: null, delegated_drep: null, deposit: "0" } as const;
    t.koios.stakes.set(stake, { ...stopped, rewards_available: "0", withdrawals: "12345678" });
    expect((await t.balances.get("preprod", true)).cardano.staking).toEqual({
      registered: false,
      pool: null,
      drep: null,
      rewards: "0",
      deposit: "0",
      rewarded: true,
    });
    // Never paid, or Koios's sums aren't numbers: nothing to show.
    for (const sums of [
      { rewards_available: "0", withdrawals: "0" },
      { rewards_available: "0" },
      { rewards_available: "lots", withdrawals: "-1" },
    ]) {
      t.koios.stakes.set(stake, { ...stopped, ...sums });
      expect((await t.balances.get("preprod", true)).cardano.staking.rewarded).toBeUndefined();
    }
  });

  it("never lets a failed ticker lookup break a reading", async () => {
    const t = await unlocked();
    const failing: FetchLike = async (url, init) =>
      url.includes("pool_info") ? new Response("nope", { status: 404 }) : t.koios.fetch(url, init);
    const deps = { ...t.deps, koios: () => new Koios("https://preprod.koios.rest/api/v1", failing, async () => undefined) };
    const { BalanceService } = await import("../src/background/balances");
    const b = await new BalanceService(deps).get("preprod", true);
    expect(b.cardano.staking.pool).toEqual({ id: LOGIC });
  });
});

describe("rewards history (chunk 30)", () => {
  const GRADA = "pool1nmfr5j5rnqndprtazre802glpc3h865sy50mxdny65kfgf3e5eh";

  it("reads every reward, newest first, in one request, naming pools from the device alone", async () => {
    const t = await unlocked();
    const rows = await t.staking.rewardHistory("preprod");
    expect(paths(t)).toEqual(["account_reward_history"]);
    const [asked] = t.koios.calls;
    expect(asked!.body).toEqual({ _stake_addresses: [rewardsPreprod.stake] });
    // Asked oldest first, so what db-sync adds while it's read lands on the last page; shown newest first.
    expect(Object.fromEntries(new URLSearchParams(asked!.query))).toEqual({
      select: "earned_epoch,spendable_epoch,amount,type,pool_id_bech32",
      order: "spendable_epoch.asc,earned_epoch.asc,type.asc,pool_id_bech32.asc,amount.asc",
      offset: "0",
      limit: "1000",
    });
    expect(rows).toHaveLength(87);
    expect(rows[0]).toEqual({ epoch: 319, earned: 317, amount: "6906754", kind: "member", pool: { id: LOGIC } });
    expect(rows.at(-1)).toEqual({ epoch: 223, earned: 221, amount: "8053609", kind: "member", pool: { id: GRADA } });
    expect(rows.reduce((sum, r) => sum + BigInt(r.amount), 0n)).toBe(663_653_619n);

    // Once the device knows them, each pool by its ticker: LOGIC from the session, GRADA from the pool list. Still
    // the one request, and no pool_info.
    await t.staking.pool("preprod", LOGIC);
    await t.staking.pools("preprod");
    t.koios.calls.length = 0;
    const named = await t.staking.rewardHistory("preprod");
    expect(paths(t)).toEqual(["account_reward_history"]);
    expect(named[0]!.pool).toEqual({ id: LOGIC, ticker: "LOGIC", name: "Logical Mechanism" });
    expect(named.at(-1)!.pool).toEqual({ id: GRADA, ticker: "GRADA" });
  });

  it("reads past 1,000 a page, and leaves out a row that isn't a reward", async () => {
    const t = await unlocked();
    const row = (epoch: number, type = "leader", pool: string | null = LOGIC, amount = "1000000") => ({
      earned_epoch: epoch - 2,
      spendable_epoch: epoch,
      amount,
      type,
      pool_id_bech32: pool,
    });
    t.koios.rewards.set(rewardsPreprod.stake, [
      ...Array.from({ length: 1000 }, (_, i) => row(5000 - i)),
      row(300, "reserves", null),
      row(299, "treasury", null),
      row(298, "proposal_refund", null),
      row(297, "refund"),
      row(296, "something new", null),
      // Not rewards: an amount that isn't lovelace, an epoch that isn't whole.
      row(295, "member", LOGIC, "-5"),
      row(294, "member", LOGIC, "1.5"),
      { ...row(293), spendable_epoch: 293.5 },
      // A pool ID that isn't one: the reward is kept, with no pool (the page says Other).
      row(292, "member", "addr1x"),
    ]);
    const rows = await t.staking.rewardHistory("preprod");
    const asked = t.koios.calls.filter((c) => c.path === "account_reward_history");
    expect(asked.map((c) => new URLSearchParams(c.query).get("offset"))).toEqual(["0", "1000"]);
    expect(rows).toHaveLength(1006);
    expect(rows[0]).toMatchObject({ epoch: 5000, kind: "leader", pool: { id: LOGIC } });
    expect(rows.slice(1000).map((r) => [r.epoch, r.kind, r.pool?.id])).toEqual([
      [300, "reserves", undefined],
      [299, "treasury", undefined],
      [298, "proposal_refund", undefined],
      [297, "refund", LOGIC],
      [296, "other", undefined],
      [292, "member", undefined],
    ]);
  });

  // A reward account several pools pay: 15 pools' rewards for 100 epochs, two pages. db-sync changes an account's
  // newest rows while it's read: next epoch's as they're worked out, a stopped key's deleted at an epoch's start.
  const leader = (epoch: number, pool: number, amount = "1000000"): KoiosReward => ({
    earned_epoch: epoch - 2,
    spendable_epoch: epoch,
    amount,
    type: "leader",
    pool_id_bech32: `pool1p${pool}`,
  });
  const fifteenPools = () => Array.from({ length: 1500 }, (_, i) => leader(600 - Math.floor(i / 15), i % 15));
  /** The history read while db-sync changes `table` once the first page has been served. */
  async function readWhile(table: KoiosReward[], change: () => void) {
    const t = await unlocked();
    t.koios.rewards.set(rewardsPreprod.stake, table);
    const real = t.koios.fetch;
    let served = 0;
    t.koios.fetch = async (url, init) => {
      const answer = await real(url, init);
      if (url.includes("/account_reward_history") && served++ === 0) change();
      return answer;
    };
    return (await t.staking.rewardHistory("preprod")).map((r) => `${r.epoch}.${r.pool?.id}`);
  }

  it("reads oldest first, so next epoch's worked out between pages is on top, and no row twice (1.5.0's release review, C24)", async () => {
    const table = fifteenPools();
    const rows = await readWhile(table, () => table.push(...Array.from({ length: 13 }, (_, p) => leader(601, p, "340000000"))));
    expect(rows).toHaveLength(1513);
    expect(new Set(rows).size).toBe(1513);
    expect(rows.slice(0, 13).every((r) => r.startsWith("601."))).toBe(true);
    // Newest first, each epoch's in the order the page always read: by kind, then pool, then amount.
    expect(rows.slice(13, 16)).toEqual(["600.pool1p0", "600.pool1p1", "600.pool1p10"]);
  });

  it("skips no row when a stopped key's newest are deleted between pages", async () => {
    const table = fifteenPools();
    const rows = await readWhile(table, () => table.splice(0, 15));
    expect(rows.sort()).toEqual(table.map((r) => `${r.spendable_epoch}.${r.pool_id_bech32}`).sort());
  });

  it("keeps rewards alike in every column: each was paid, as two governance deposits back in one epoch were", async () => {
    const t = await unlocked();
    const refund = { earned_epoch: 580, spendable_epoch: 581, amount: "100000000000", type: "proposal_refund", pool_id_bech32: null };
    t.koios.rewards.set(rewardsPreprod.stake, [refund, { ...refund }]);
    const back = { epoch: 581, earned: 580, amount: "100000000000", kind: "proposal_refund" };
    expect(await t.staking.rewardHistory("preprod")).toEqual([back, back]);
  });

  it("is the public account the wallet is on's", async () => {
    // The 24-word phrase has accounts 0 and 1 recorded, as accounts.test.ts uses it.
    const both = (index: 0 | 1) =>
      vectors("cardano_account.json").find((v) => v.account === index && v.phrase.split(" ").length === 24)!;
    const t = testBalances();
    await t.wallet.create(both(0).phrase, PASSWORD);
    await t.accounts.recordFirst();
    t.koios.usedStakes.add(both(1).preprod.stake as string);
    await t.accounts.discover("preprod");
    await t.accounts.use(1, ["preprod"]);
    t.koios.calls.length = 0;
    expect(await t.staking.rewardHistory("preprod")).toEqual([]);
    expect(t.koios.calls.map((c) => c.body)).toEqual([{ _stake_addresses: [both(1).preprod.stake] }]);
  });
});

describe("delegation history (chunk 36)", () => {
  const GRADA = "pool1nmfr5j5rnqndprtazre802glpc3h865sy50mxdny65kfgf3e5eh";
  const OWN_DREP = "drep1y2e20afmrjh8wz02w92880qwdqephacyqlahqyp5n6rgnhg2egjc8";
  const hash = (n: number) => n.toString(16).padStart(64, "0");

  it("reads every certificate but a withdrawal, newest first, and what each names from its transaction: two requests", async () => {
    const t = await unlocked();
    const rows = await t.staking.delegationHistory("preprod");
    expect(paths(t)).toEqual(["account_update_history", "tx_info"]);
    const [asked, txs] = t.koios.calls;
    expect(asked!.body).toEqual({ _stake_addresses: [delegationsPreprod.stake] });
    // Asked oldest first, so a certificate landing while it's read is on the last page; shown newest first.
    expect(Object.fromEntries(new URLSearchParams(asked!.query))).toEqual({
      select: "action_type,tx_hash,epoch_no,absolute_slot,block_time",
      action_type: "neq.withdrawal",
      order: "absolute_slot.asc,tx_hash.asc,action_type.asc",
      offset: "0",
      limit: "1000",
    });
    // Each transaction once, as Activity asks for it.
    expect(txs!.body._tx_hashes).toHaveLength(7);
    expect(txs!.body._certs).toBe(true);

    expect(rows.map((r) => [r.epoch, r.kind, r.pool?.id ?? r.drep ?? r.deposit])).toEqual([
      [317, "vote", OWN_DREP],
      [315, "vote", "drep1ytah77nvma8thq037ynn9sqf59rpsjfpnq2a0rtltfnyvjchvqhux"],
      // Registered again, staked and the vote delegated in one transaction: in that order.
      [300, "registration", "2000000"],
      [300, "pool", LOGIC],
      [300, "vote", "drep_always_abstain"],
      // Stopped: the 2 ₳ its registration took back, which Koios's certificate doesn't say.
      [300, "deregistration", "2000000"],
      [300, "pool", LOGIC],
      [300, "vote", "drep_always_abstain"],
      [221, "pool", LOGIC],
      [219, "registration", "2000000"],
      [219, "pool", GRADA],
      [219, "vote", "drep_always_abstain"],
    ]);
    expect(rows[0]).toEqual({
      kind: "vote",
      txHash: "938adb0946b58e82b3e1607515e0d847b0ee280268f307f87bf5a0e11134ea86",
      at: 1_791_143_131_000,
      epoch: 317,
      drep: OWN_DREP,
      // The account's own DRep, from its key: nobody asked.
      ownDrep: true,
    });
    expect(rows.filter((r) => r.ownDrep)).toHaveLength(1);

    // Once the device knows them, each pool by its ticker: LOGIC from the session, GRADA from the pool list. Still
    // the two requests, and no pool_info.
    await t.staking.pool("preprod", LOGIC);
    await t.staking.pools("preprod");
    t.koios.calls.length = 0;
    const named = await t.staking.delegationHistory("preprod");
    expect(paths(t)).toEqual(["account_update_history", "tx_info"]);
    expect(named[3]!.pool).toEqual({ id: LOGIC, ticker: "LOGIC", name: "Logical Mechanism" });
    expect(named[10]!.pool).toEqual({ id: GRADA, ticker: "GRADA" });
  });

  it("reads past 1,000 a page and 20 transactions a request, and leaves out a row that isn't a certificate", async () => {
    const t = await unlocked();
    const stake = delegationsPreprod.stake;
    const row = (n: number, action_type = "delegation_pool"): KoiosAccountUpdate => ({
      action_type,
      tx_hash: hash(n),
      epoch_no: 400,
      absolute_slot: n,
      block_time: 1_800_000_000 + n,
    });
    // 1,000 delegations to one pool in 25 transactions, then the odd ones.
    t.koios.delegations.set(stake, [
      ...Array.from({ length: 1000 }, (_, i) => ({ ...row(i + 1), tx_hash: hash(Math.floor(i / 40) + 1) })),
      row(2001, "something new"),
      { ...row(2002), tx_hash: "not a hash" },
      { ...row(2003), epoch_no: 400.5 },
      { ...row(2004), block_time: -1 },
      row(2005, "deregistration"),
    ]);
    const rows = await t.staking.delegationHistory("preprod");
    const asked = t.koios.calls.filter((c) => c.path === "account_update_history");
    expect(asked.map((c) => new URLSearchParams(c.query).get("offset"))).toEqual(["0", "1000"]);
    // 26 transactions: two requests.
    expect(t.koios.calls.filter((c) => c.path === "tx_info").map((c) => c.body._tx_hashes.length)).toEqual([20, 6]);
    expect(rows).toHaveLength(1001);
    // The server had none of these transactions: each says only what it did.
    expect(rows[0]).toEqual({ kind: "deregistration", txHash: hash(2005), at: (1_800_000_000 + 2005) * 1000, epoch: 400 });
    expect(rows[1]).toEqual({ kind: "pool", txHash: hash(25), at: (1_800_000_000 + 1000) * 1000, epoch: 400 });
  });

  it("names the newest 200 transactions' alone: an account that re-delegates all day costs 10 requests, not 65", async () => {
    const t = await unlocked();
    const stake = delegationsPreprod.stake;
    t.koios.delegations.set(
      stake,
      Array.from({ length: 250 }, (_, i) => ({
        action_type: "delegation_pool",
        tx_hash: hash(i + 1),
        epoch_no: 400,
        absolute_slot: i + 1,
        block_time: i + 1,
      })),
    );
    for (let i = 1; i <= 250; i++) {
      t.koios.txRows.set(hash(i), {
        tx_hash: hash(i),
        block_height: i,
        tx_timestamp: i,
        fee: "170000",
        inputs: [],
        outputs: [],
        certificates: [{ index: 0, type: "pool_delegation", info: { stake_address: stake, pool_id_bech32: LOGIC } }],
      });
    }
    const rows = await t.staking.delegationHistory("preprod");
    const asked = t.koios.calls.filter((c) => c.path === "tx_info").flatMap((c) => c.body._tx_hashes as string[]);
    expect(asked).toHaveLength(NAMED_TXS);
    expect(asked[0]).toBe(hash(250));
    expect(rows).toHaveLength(250);
    expect(rows[NAMED_TXS - 1]!.pool).toEqual({ id: LOGIC });
    // Older: what it did, not who it named.
    expect(rows[NAMED_TXS]).toEqual({ kind: "pool", txHash: hash(50), at: 50_000, epoch: 400 });
  });

  it("takes a pool and a DRep from the certificate naming its key alone, and a pool ID only as one", async () => {
    const t = await unlocked();
    const stake = delegationsPreprod.stake;
    const someone = "stake_test1uzrvw62pn24xw0yk8ksyuj6m4ezg6jgw9n4vjqktstjd5aspv59nv";
    const cert = (type: string, info: Record<string, unknown>, index = 0) => ({ index, type, info });
    t.koios.delegations.set(stake, [
      { action_type: "delegation_pool", tx_hash: hash(1), epoch_no: 400, absolute_slot: 1, block_time: 1 },
      { action_type: "delegation_drep", tx_hash: hash(1), epoch_no: 400, absolute_slot: 1, block_time: 1 },
      { action_type: "delegation_pool", tx_hash: hash(2), epoch_no: 401, absolute_slot: 2, block_time: 2 },
    ]);
    const tx = (n: number, certificates: KoiosTxInfo["certificates"]): KoiosTxInfo => ({
      tx_hash: hash(n),
      block_height: n,
      tx_timestamp: n,
      fee: "170000",
      inputs: [],
      outputs: [],
      certificates,
    });
    // Someone else's key staked and voting beside ours in one transaction: only ours is read.
    t.koios.txRows.set(
      hash(1),
      tx(1, [
        cert("pool_delegation", { stake_address: someone, pool_id_bech32: GRADA }, 0),
        cert("pool_delegation", { stake_address: stake, pool_id_bech32: LOGIC }, 1),
        cert("vote_delegation", { stake_address: someone, drep_id: "drep_always_no_confidence" }, 2),
        cert("vote_delegation", { stake_address: stake, drep_id: LOGIC_DREP }, 3),
      ]),
    );
    t.koios.txRows.set(hash(2), tx(2, [cert("pool_delegation", { stake_address: stake, pool_id_bech32: "addr1x" })]));
    const rows = await t.staking.delegationHistory("preprod");
    expect(rows.map((r) => [r.kind, r.pool?.id, r.drep])).toEqual([
      ["pool", undefined, undefined],
      ["pool", LOGIC, undefined],
      ["vote", undefined, LOGIC_DREP],
    ]);
  });

  it("gives a stop the deposit its own registration took, and none when it never saw one", async () => {
    const t = await unlocked();
    const stake = delegationsPreprod.stake;
    const at = (n: number, action_type: string): KoiosAccountUpdate => ({
      action_type,
      tx_hash: hash(n),
      epoch_no: 400 + n,
      absolute_slot: n,
      block_time: n,
    });
    t.koios.delegations.set(stake, [at(1, "deregistration"), at(2, "registration"), at(3, "deregistration"), at(4, "registration")]);
    const registered = (n: number, deposit: string): KoiosTxInfo => ({
      tx_hash: hash(n),
      block_height: n,
      tx_timestamp: n,
      fee: "170000",
      inputs: [],
      outputs: [],
      certificates: [{ index: 0, type: "stake_registration", info: { stake_address: stake, deposit } }],
    });
    t.koios.txRows.set(hash(2), registered(2, "2000000"));
    t.koios.txRows.set(hash(4), registered(4, "3000000"));
    const rows = await t.staking.delegationHistory("preprod");
    expect(rows.map((r) => [r.kind, r.deposit])).toEqual([
      ["registration", "3000000"],
      ["deregistration", "2000000"],
      ["registration", "2000000"],
      ["deregistration", undefined],
    ]);
  });

  it("is the public account the wallet is on's", async () => {
    const both = (index: 0 | 1) =>
      vectors("cardano_account.json").find((v) => v.account === index && v.phrase.split(" ").length === 24)!;
    const t = testBalances();
    await t.wallet.create(both(0).phrase, PASSWORD);
    await t.accounts.recordFirst();
    t.koios.usedStakes.add(both(1).preprod.stake as string);
    await t.accounts.discover("preprod");
    await t.accounts.use(1, ["preprod"]);
    t.koios.calls.length = 0;
    // Nothing to name: no tx_info.
    expect(await t.staking.delegationHistory("preprod")).toEqual([]);
    expect(t.koios.calls.map((c) => [c.path, c.body])).toEqual([["account_update_history", { _stake_addresses: [both(1).preprod.stake] }]]);
  });
});

describe("pools", () => {
  it("lists every live pool with its saturation, kept on the device for a day", async () => {
    const t = await unlocked();
    const list = await t.staking.pools("preprod");
    expect(list.pools).toHaveLength(stakingPreprod.pool_list.length);
    expect(list.updatedAt).toBe(t.clock.now);
    // One page on preprod, and the supply and optimal_pool_count for saturation.
    expect(paths(t)).toEqual(["epoch_params", "pool_list", "totals"]);
    expect(t.koios.calls.find((c) => c.path === "pool_list")!.query).toContain("pool_status=eq.registered");

    const logic = list.pools.find((p) => p.id === LOGIC)!;
    expect(logic).toMatchObject({ ticker: "LOGIC", margin: 0.02, cost: "170000000", pledge: "5500000000000" });
    // Active stake against the supply over 500 pools: close to pool_info's live figure.
    const live = stakingPreprod.pool_info.find((p) => p.pool_id_bech32 === LOGIC)!.live_saturation!;
    expect(Math.abs(logic.saturation - live)).toBeLessThan(1);
    expect(list.pools.find((p) => p.id === TPREP)!.saturation).toBeGreaterThan(100);

    // Kept: no requests within the day, even locked; after it, read again.
    t.koios.calls.length = 0;
    await t.wallet.lock();
    expect(await t.staking.pools("preprod")).toEqual(list);
    expect(t.koios.calls).toHaveLength(0);
    expect(t.local.data.has(`${LOCAL_POOLS_PREFIX}preprod`)).toBe(true);
    t.clock.now += POOLS_TTL_MS;
    expect((await t.staking.pools("preprod")).updatedAt).toBe(t.clock.now);
    expect(t.koios.calls).toHaveLength(3);
    await t.staking.pools("preprod", true);
    expect(t.koios.calls).toHaveLength(6);
  });

  it("reads one pool's details, fresh, by bech32 or hex", async () => {
    const t = await unlocked();
    const details = await t.staking.pool("preprod", LOGIC);
    expect(details).toMatchObject({
      id: LOGIC,
      ticker: "LOGIC",
      name: "Logical Mechanism",
      homepage: "https://www.logicalmechanism.io/",
      margin: 0.02,
      status: "registered",
      retiringEpoch: null,
    });
    expect(BigInt(details.livePledge)).toBeGreaterThanOrEqual(BigInt(details.pledge));
    expect(paths(t)).toEqual(["pool_info"]);
    expect(await t.staking.pool("preprod", "1e3105f23f2ac91b3fb4c35fa4fe301421028e356e114944e902005b")).toEqual(details);
    await expect(t.staking.pool("preprod", LOGIC_DREP)).rejects.toThrow("stake pool ID");
    // One picked from the list can be one that retired since: "check its ID" was no help (chunk 23's second review,
    // ST-10).
    await expect(t.staking.pool("preprod", "pool1547tew8vmuj0g6vj3k5jfddudextcw6hsk2hwgg6pkhk7lwphe6")).rejects.toThrow(
      "has no details for this pool right now: it may have retired",
    );
  });

  it("works saturation out as the ledger does", () => {
    expect(saturation(12_063_859_426_304n, 32_087_426_319_532_351n, 500)).toBe(18.79);
    expect(saturation(1n, 0n, 500)).toBe(0);
  });
});

describe("a pool's return on stake (chunk 37)", () => {
  /** What an ADA staked through every epoch Koios gave rewards for grew by, a year of epochs over: a percentage. */
  const compounded = (rows: KoiosPoolEpoch[]) => {
    const paid = rows.filter((r) => r.deleg_rewards !== null && BigInt(r.active_stake!) > 0n);
    const grown = paid.reduce((g, r) => g * (1 + Number(r.deleg_rewards) / Number(r.active_stake)), 1);
    return (grown ** (73 / paid.length) - 1) * 100;
  };

  it("reads a pool's newest 18 epochs in one request, and its return over those Koios gave rewards for", async () => {
    const t = await unlocked();
    const recorded = poolHistoryFixture.preprod[LOGIC]!;
    const history = await t.staking.poolHistory("preprod", LOGIC);
    expect(paths(t)).toEqual(["pool_history"]);
    expect([...new URLSearchParams(t.koios.calls[0]!.query)]).toEqual([
      ["_pool_bech32", LOGIC],
      ["select", "epoch_no,active_stake,block_cnt,deleg_rewards"],
      ["order", "epoch_no.desc"],
      ["limit", "18"],
    ]);
    expect(history.id).toBe(LOGIC);
    expect(history.epochs.map((e) => e.epoch)).toEqual(recorded.map((r) => r.epoch_no));
    expect(history.epochs.map((e) => e.blocks)).toEqual(recorded.map((r) => r.block_cnt));
    // Koios's own `epoch_ros` for epoch 317, which the wallet doesn't ask for: the same yearly rate.
    expect(history.epochs[0]!.ros).toBeCloseTo(5.276072341, 6);
    // An epoch with no blocks paid nothing, and that's known; one Koios gave no rewards for isn't.
    const at = (epoch: number) => history.epochs.find((e) => e.epoch === epoch)!;
    expect(at(312)).toEqual({ epoch: 312, blocks: 0, ros: 0 });
    for (const row of recorded.filter((r) => r.deleg_rewards === null)) {
      expect(at(row.epoch_no)).toEqual({ epoch: row.epoch_no, blocks: row.block_cnt });
    }
    expect(history.ros).toBeCloseTo(compounded(recorded), 9);
    // Those left out aren't counted as paying nothing, which would read as a pool paying a fraction of what it did.
    const asZero = recorded.map((r) => ({ ...r, deleg_rewards: r.deleg_rewards ?? "0" }));
    expect(history.ros! - compounded(asZero)).toBeGreaterThan(1);
  });

  it("isn't halved by mainnet Koios leaving out every other epoch's rewards", async () => {
    const t = await unlocked();
    const [[octas, recorded]] = Object.entries(poolHistoryFixture.mainnet) as [[string, KoiosPoolEpoch[]]];
    t.koios.poolHistory.set(octas, recorded);
    const history = await t.staking.poolHistory("preprod", octas);
    const known = recorded.filter((r) => r.deleg_rewards !== null);
    expect(known.length).toBeLessThan(recorded.length);
    expect(history.epochs.filter((e) => e.ros !== undefined)).toHaveLength(known.length);
    expect(history.ros).toBeCloseTo(compounded(recorded), 9);
    // Each epoch it gave paid about the same: the return is theirs, not half of it.
    const each = history.epochs.flatMap((e) => (e.ros === undefined ? [] : [e.ros]));
    expect(history.ros).toBeGreaterThan(Math.min(...each));
    expect(history.ros).toBeLessThan(Math.max(...each));
  });

  it("takes the pool's ID as hex too, and refuses one that isn't a pool's", async () => {
    const t = await unlocked();
    const history = await t.staking.poolHistory("preprod", LOGIC);
    expect(await t.staking.poolHistory("preprod", "1e3105f23f2ac91b3fb4c35fa4fe301421028e356e114944e902005b")).toEqual(history);
    await expect(t.staking.poolHistory("preprod", LOGIC_DREP)).rejects.toThrow("stake pool ID");
    expect(paths(t)).toEqual(["pool_history", "pool_history"]);
  });

  it("leaves out a row that isn't an epoch, takes each epoch once, newest first, and none past 18", async () => {
    const t = await unlocked();
    const row = (epoch_no: number, over: Partial<KoiosPoolEpoch> = {}): KoiosPoolEpoch => ({
      epoch_no,
      active_stake: "1000000000000",
      block_cnt: 2,
      deleg_rewards: "100000000",
      ...over,
    });
    t.koios.poolHistory.set(LOGIC, [
      row(400),
      row(402),
      row(401, { deleg_rewards: "1.2e+8" }),
      // Twice: the first one counts.
      row(402, { deleg_rewards: "0" }),
      row(-1),
      row(399.5),
      row(398, { active_stake: "1e12" }),
      row(397, { active_stake: null }),
      row(396, { block_cnt: null }),
      row(395, { deleg_rewards: "-5" }),
      // No stake: no rate, and it's not a row to leave out.
      row(394, { active_stake: "0", block_cnt: 0, deleg_rewards: "0" }),
      ...Array.from({ length: 20 }, (_, i) => row(370 + i)),
    ]);
    // Koios's 18 rows, newest first, of which these are epochs.
    const history = await t.staking.poolHistory("preprod", LOGIC);
    expect(history.epochs.map((e) => e.epoch)).toEqual([402, 401, 400, 395, 394, 389, 388, 387, 386, 385, 384, 383, 382]);
    expect(history.epochs[0]!.ros).toBeCloseTo(history.epochs[2]!.ros!, 9);
    expect(history.epochs[1]!.ros).toBeGreaterThan(history.epochs[0]!.ros!);
    expect(history.epochs.find((e) => e.epoch === 395)).toEqual({ epoch: 395, blocks: 2 });
    expect(history.epochs.find((e) => e.epoch === 394)).toEqual({ epoch: 394, blocks: 0 });
    expect(Number.isFinite(history.ros)).toBe(true);

    // A server giving more than it was asked for, out of order: the newest 18 alone.
    const many: FetchLike = async (url, init) =>
      url.includes("pool_history") ? Response.json(Array.from({ length: 30 }, (_, i) => row(370 + i))) : t.koios.fetch(url, init);
    const { StakingService } = await import("../src/background/staking");
    const staking = new StakingService({
      ...t.deps,
      koios: () => new Koios("https://preprod.koios.rest/api/v1", many, async () => undefined),
      collateral: () => {
        throw new Error("a pool's history needs no collateral");
      },
    });
    expect((await staking.poolHistory("preprod", LOGIC)).epochs.map((e) => e.epoch)).toEqual(
      Array.from({ length: 18 }, (_, i) => 399 - i),
    );
  });

  it("gives no return when no epoch's rewards are known, and an empty history for a pool with none", async () => {
    const t = await unlocked();
    t.koios.poolHistory.set(LOGIC, poolHistoryFixture.preprod[LOGIC]!.map((r) => ({ ...r, deleg_rewards: null })));
    const unknown = await t.staking.poolHistory("preprod", LOGIC);
    expect(unknown.epochs).toHaveLength(18);
    expect(unknown).not.toHaveProperty("ros");
    t.koios.poolHistory.set(LOGIC, []);
    expect(await t.staking.poolHistory("preprod", LOGIC)).toEqual({ id: LOGIC, epochs: [] });
  });
});

describe("DReps", () => {
  it("reads a DRep's standing and name, in two requests", async () => {
    const t = await unlocked();
    expect(await t.staking.drep("preprod", LOGIC_DREP)).toEqual({
      id: LOGIC_DREP,
      name: "Logical Mechanism dRep",
      status: "registered",
      active: false,
      expiresEpoch: 189,
      votingPower: "5914902920642",
      delegators: 5,
    });
    expect(paths(t)).toEqual(["drep_info", "drep_metadata"]);
    // Only the name is asked for: no images, which would be fetched from anywhere.
    const query = t.koios.calls.find((c) => c.path === "drep_metadata")!.query;
    expect(decodeURIComponent(query)).toBe("select=drep_id,meta_json->body->givenName");
  });

  it("keeps Koios's word for a DRep that has retired or never registered", async () => {
    const t = await unlocked();
    const id = "drep1y2jmg4g450lced7q9n34rq6d5vjwkm0ugx6h0894u6ur92s9txn3a";
    const row = { drep_id: id, active: false, expires_epoch_no: null, amount: "0", live_delegator_count: 0, deposit: null, meta_url: null, meta_hash: null };
    for (const status of ["deregistered", "not_registered"] as const) {
      t.koios.dreps.set(id, { ...row, drep_status: status });
      expect(await t.staking.drep("preprod", id)).toMatchObject({ id, status, active: false });
    }
  });

  it("explains an ID it can't use", async () => {
    const t = await unlocked();
    await expect(t.staking.drep("preprod", LOGIC)).rejects.toThrow("DRep ID");
    await expect(t.staking.drep("preprod", "drep_always_abstain")).rejects.toThrow("pinned choices");
    await expect(t.staking.drep("preprod", "drep1ygucyyfvzezxu5993n0ls25tfp5f5lvfxavmcl3s58jwsmgkgwmff")).rejects.toThrow();
  });

  it("reads a name however its author wrote it", () => {
    expect(drepName(" Alice ")).toBe("Alice");
    expect(drepName({ "@value": "Bob" })).toBe("Bob");
    expect(drepName("x".repeat(100))).toHaveLength(64);
    expect(drepName("\u0007")).toBeUndefined();
    expect(drepName(42)).toBeUndefined();
    expect(drepName(null)).toBeUndefined();
  });
});

describe("staking transactions", () => {
  it("delegates a first time with the deposit, signed at review, and submits exactly that", async () => {
    const t = await unlocked();
    t.koios.stakes.clear();
    const summary = await t.staking.build("preprod", { kind: "delegate", pool: LOGIC });
    expect(summary).toMatchObject({
      network: "preprod",
      action: { kind: "delegate", pool: LOGIC },
      pool: LOGIC,
      drep: null,
      deposit: "2000000",
      refund: "0",
      withdrawal: "0",
    });
    expect(paths(t)).toEqual(["account_addresses", "account_info", "credential_utxos", "epoch_params", "tip"]);
    expect(t.koios.submitted).toHaveLength(0);

    const pending = await t.staking.submit("preprod", summary.txHash);
    expect(pending).toMatchObject({ kind: "stake", txHash: summary.txHash });
    expect(txIdOf(t.koios.submitted[0]!)).toBe(summary.txHash);
    expect(await t.session.get(SESSION_STAKE)).toBeUndefined();
    expect(await t.session.get(pendingKey("preprod"))).toMatchObject({ kind: "stake" });
    // Nothing of it goes into the Seedelf history, or to giveme.my.
    expect(await t.activity.seedelf("preprod")).toEqual([]);
    expect(t.collateral.asked).toHaveLength(0);
  });

  it("changes pool, delegates the vote, withdraws and stops, each its own pending kind", async () => {
    const t = await unlocked();
    const change = await t.staking.build("preprod", { kind: "delegate", pool: TPREP });
    expect(change).toMatchObject({ deposit: "0", withdrawal: "0" });
    const vote = await t.staking.build("preprod", { kind: "vote", drep: LOGIC_DREP });
    expect(vote).toMatchObject({ drep: LOGIC_DREP, deposit: "0" });
    expect((await t.staking.submit("preprod", vote.txHash)).kind).toBe("vote");

    const withdraw = await t.staking.build("preprod", { kind: "withdraw" });
    expect(withdraw.withdrawal).toBe(REWARDS);
    expect((await t.staking.submit("preprod", withdraw.txHash)).kind).toBe("withdraw-rewards");

    // Koios still reports the rewards the withdrawal on its way takes: neither it again, nor a stop, which withdraws
    // them too, until it lands (the fix round's review of blind test §9.1).
    await expect(t.staking.build("preprod", { kind: "withdraw" })).rejects.toThrow("collected these rewards and isn't confirmed yet");
    await expect(t.staking.build("preprod", { kind: "stop" })).rejects.toThrow("collected these rewards and isn't confirmed yet");
    const info = stakingPreprod.account_info[0]!;
    t.koios.stakes.set(info.stake_address, { ...info, rewards_available: "0" });

    const stop = await t.staking.build("preprod", { kind: "stop" });
    expect(stop).toMatchObject({ refund: "2000000", withdrawal: "0" });
    expect((await t.staking.submit("preprod", stop.txHash)).kind).toBe("unstake");
  });

  it("says what an empty account lacks: the fee alone, or a deposit too (chunk 23's second review, ST-9)", async () => {
    // The 15-word phrase's account has no recorded UTxOs, and a stake key Koios doesn't know.
    const t = await unlocked(15);
    // A withdrawal, a retirement or a vote pays a fee and locks up nothing: no deposit is named.
    await expect(t.staking.build("preprod", { kind: "withdraw" })).rejects.toThrow("no ADA for the fee, about 1");
    await expect(t.staking.build("preprod", { kind: "delegate", pool: LOGIC })).rejects.toThrow("no ADA for the deposit and fee");
    expect(takesDeposit({ kind: "drep-retire" }, true)).toBe(false);
    expect(takesDeposit({ kind: "drep-vote", votes: [] }, true)).toBe(false);
    expect(takesDeposit({ kind: "vote", drep: LOGIC_DREP }, true)).toBe(false);
    expect(takesDeposit({ kind: "vote", drep: LOGIC_DREP }, false)).toBe(true);
    expect(takesDeposit({ kind: "drep-register", delegate: false }, true)).toBe(true);
  });

  it("refuses the same choice again, locked rewards, and what's gone stale", async () => {
    const t = await unlocked();
    await expect(t.staking.build("preprod", { kind: "delegate", pool: LOGIC })).rejects.toThrow("already staking with this pool");
    await expect(t.staking.build("preprod", { kind: "vote", drep: "drep_always_abstain" })).rejects.toThrow("already delegated");

    const info = stakingPreprod.account_info[0]!;
    t.koios.stakes.set(info.stake_address, { ...info, delegated_drep: null });
    await expect(t.staking.build("preprod", { kind: "withdraw" })).rejects.toThrow("voting power");
    await expect(t.staking.build("preprod", { kind: "stop" })).rejects.toThrow("voting power");

    // An epoch paid more between Review and Send: the ledger refuses the old amount.
    t.koios.stakes.set(info.stake_address, info);
    const withdraw = await t.staking.build("preprod", { kind: "withdraw" });
    t.koios.rejectSubmit = '{"contents":{"contents":{"contents":{"era":"ShelleyBasedEraConway","error":["ConwayWdrlNotDelegatedToDRep","WithdrawalsNotInRewardsCERTS"]}}}}';
    await expect(t.staking.submit("preprod", withdraw.txHash)).rejects.toThrow("changed since you reviewed");

    t.koios.rejectSubmit = '{"error":["ConwayDelegFailure (DelegateeStakePoolNotRegisteredDELEG (KeyHash {}))"]}';
    const moved = await t.staking.build("preprod", { kind: "delegate", pool: TPREP });
    await expect(t.staking.submit("preprod", moved.txHash)).rejects.toThrow("isn't registered any more");

    await t.wallet.lock();
    await expect(t.staking.build("preprod", { kind: "withdraw" })).rejects.toThrow("locked");
  });
});

describe("spending rewards", () => {
  it("rides along with a send when on, and waits when off", async () => {
    const t = await unlocked();
    expect(await t.preferences.get()).toMatchObject({ spendRewards: true });
    const on = await t.send.build("preprod", [{ to: THEIRS, lovelace: "3000000", tokens: [] }]);
    expect(on.withdrawal).toBe(REWARDS);

    expect(await t.preferences.set({ spendRewards: false })).toMatchObject({ spendRewards: false });
    t.koios.calls.length = 0;
    const off = await t.send.build("preprod", [{ to: THEIRS, lovelace: "3000000", tokens: [] }]);
    expect(off.withdrawal).toBe("0");
    // Off, the stake key isn't even read.
    expect(paths(t)).toEqual(["account_addresses", "credential_utxos", "epoch_params", "tip"]);
  });

  it("waits, and the payment goes ahead, while the vote isn't delegated", async () => {
    const t = await unlocked();
    const info = stakingPreprod.account_info[0]!;
    t.koios.stakes.set(info.stake_address, { ...info, delegated_drep: null });
    const summary = await t.moveIn.build("preprod", "5000000", []);
    expect(summary.withdrawal).toBe("0");
  });

  it("is a setting that removing the wallet forgets", async () => {
    const t = await unlocked();
    await t.preferences.set({ spendRewards: false });
    await t.preferences.set({ nonsense: 1 } as never);
    expect(await t.preferences.get()).toEqual({
      spendRewards: false,
      hideBalances: false,
      lockAfterMinutes: 15,
      currency: "usd",
      dappConnector: false,
      dappPassword: true,
      dappAccount: 0,
      lovejoinReturns: true,
      lovejoinDepth: 2,
      lovejoinDelay: "1-6",
      lovejoinWidth: 3,
      koiosOnly: false,
    });
    await t.wallet.reset();
    expect(await t.preferences.get()).toMatchObject({ spendRewards: true });
  });
});
