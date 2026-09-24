// Staking and voting delegation from the Cardano account, on the recorded
// preprod account (registered, staking with LOGIC, always abstaining, with
// rewards): what each screen asks Koios, the pool list kept for a day, the
// builds signed through WebAssembly, and the rewards spent along with a
// payment, or not.
import { describe, expect, it } from "vitest";

import { Koios, type FetchLike } from "../src/background/koios";
import { SESSION_PENDING } from "../src/background/pending";
import { LOCAL_POOLS_PREFIX, POOLS_TTL_MS, SESSION_STAKE, drepName, saturation } from "../src/background/staking";
import { txIdOf } from "./fixtures/cbor";
import { stakingPreprod, testBalances, vectors } from "./fakes";

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

  it("reads a key that was never registered as not staking", async () => {
    const t = await unlocked(15);
    const b = await t.balances.get("preprod");
    expect(b.cardano.staking).toEqual({ registered: false, pool: null, drep: null, rewards: "0", deposit: "0" });
    expect(paths(t)).not.toContain("pool_info");
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
    await expect(t.staking.pool("preprod", "pool1547tew8vmuj0g6vj3k5jfddudextcw6hsk2hwgg6pkhk7lwphe6")).rejects.toThrow(
      "doesn't know that pool",
    );
  });

  it("works saturation out as the ledger does", () => {
    expect(saturation(12_063_859_426_304n, 32_087_426_319_532_351n, 500)).toBe(18.79);
    expect(saturation(1n, 0n, 500)).toBe(0);
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
    expect(paths(t)).toEqual(["account_addresses", "account_info", "credential_utxos", "epoch_params"]);
    expect(t.koios.submitted).toHaveLength(0);

    const pending = await t.staking.submit("preprod", summary.txHash);
    expect(pending).toMatchObject({ kind: "stake", txHash: summary.txHash });
    expect(txIdOf(t.koios.submitted[0]!)).toBe(summary.txHash);
    expect(await t.session.get(SESSION_STAKE)).toBeUndefined();
    expect(await t.session.get(SESSION_PENDING)).toMatchObject({ kind: "stake" });
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

    const stop = await t.staking.build("preprod", { kind: "stop" });
    expect(stop).toMatchObject({ refund: "2000000", withdrawal: REWARDS });
    expect((await t.staking.submit("preprod", stop.txHash)).kind).toBe("unstake");
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
    expect(await t.preferences.get()).toEqual({ spendRewards: true });
    const on = await t.send.build("preprod", THEIRS, "3000000", []);
    expect(on.withdrawal).toBe(REWARDS);

    expect(await t.preferences.set({ spendRewards: false })).toEqual({ spendRewards: false });
    t.koios.calls.length = 0;
    const off = await t.send.build("preprod", THEIRS, "3000000", []);
    expect(off.withdrawal).toBe("0");
    // Off, the stake key isn't even read.
    expect(paths(t)).toEqual(["account_addresses", "credential_utxos", "epoch_params"]);
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
    expect(await t.preferences.get()).toEqual({ spendRewards: false });
    await t.wallet.reset();
    expect(await t.preferences.get()).toEqual({ spendRewards: true });
  });
});
