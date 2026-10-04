// The public account as its own DRep (chunk 21), on the recorded preprod
// account and the live governance actions recorded from both networks: what
// each screen asks Koios, the list kept for an hour, the DRep's votes, the
// builds signed through WebAssembly with the DRep key, and Activity naming
// what the DRep did.
import { describe, expect, it } from "vitest";

import { stakingOf } from "../src/background/activity";
import { GOV_ACTIONS_TTL_MS, LOCAL_GOV_ACTIONS_PREFIX, shownText } from "../src/background/governance";
import type { KoiosDrepStanding, KoiosTxInfo } from "../src/background/koios";
import { epochAt, epochStart } from "../src/networks";
import type { StakingAction } from "../src/shared/rpc";
import { governanceFixture, koiosPreprod, loadTestWasm, stakingPreprod, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const phrase = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!
  .phrase as string;
/** The 12-word account's own DRep (CIP-105's key 3/0), never registered on preprod. */
const wasm = loadTestWasm();
const OWN = (JSON.parse(wasm.CardanoAccount.fromPhrase(phrase, 0).drepOf()) as { id: string }).id;
const STAKE = stakingPreprod.stake;

async function unlocked() {
  const t = testBalances();
  await t.wallet.create(phrase, PASSWORD);
  return t;
}

const paths = (t: ReturnType<typeof testBalances>) => t.koios.calls.map((c) => c.path).sort();

/** The account's own DRep, registered, as Koios's drep_info would answer. */
function registered(over: Partial<KoiosDrepStanding> = {}): KoiosDrepStanding {
  return {
    drep_id: OWN,
    drep_status: "registered",
    active: true,
    expires_epoch_no: 340,
    amount: "61211118",
    live_delegator_count: 1,
    deposit: "500000000",
    meta_url: null,
    meta_hash: null,
    ...over,
  };
}

/** 600 ADA more at the account's receive address 0/0, for a DRep's 500 ADA deposit. */
function rich(t: ReturnType<typeof testBalances>) {
  const [some] = koiosPreprod.accounts[STAKE]!.account_utxos;
  t.koios.addedToAccounts.push({ ...some!, tx_hash: "77".repeat(32), tx_index: 0, value: "600000000", asset_list: [] });
}

describe("the account's own DRep", () => {
  it("is the key Lace derives, named as Koios names it", () => {
    expect(OWN).toMatch(/^drep1y/);
    const vector = wasm.CardanoAccount.fromPhrase("test walk nut penalty hip pave soap entry language right filter choice", 0);
    expect(JSON.parse(vector.drepOf()).id).toBe("drep1y2jmg4g450lced7q9n34rq6d5vjwkm0ugx6h0894u6ur92s9txn3a");
  });

  it("never registered: one drep_info, and what registering costs now", async () => {
    const t = await unlocked();
    expect(await t.staking.ownDrep("preprod")).toEqual({
      id: OWN,
      status: "none",
      deposit: "0",
      depositNow: "500000000",
      active: false,
      expiresEpoch: null,
      votingPower: "0",
      delegators: 0,
      profile: null,
    });
    expect(paths(t)).toEqual(["drep_info", "epoch_params"]);
    const query = decodeURIComponent(t.koios.calls.find((c) => c.path === "drep_info")!.query);
    expect(query).toBe(
      "select=drep_id,drep_status,active,expires_epoch_no,amount,live_delegator_count,deposit,meta_url,meta_hash",
    );
  });

  it("registered with a profile: what Koios found there, never the file itself", async () => {
    const t = await unlocked();
    const url = "ipfs://bafkreigzvg5nbyngh2hfxrptxmh2jturifcsq5v2gbaz7hfg6ccvhlzgxu";
    t.koios.dreps.set(OWN, registered({ meta_url: url, meta_hash: "ab".repeat(32) }));
    t.koios.drepProfiles.set(OWN, { drep_id: OWN, is_valid: false, givenName: { "@value": " Tester " } });
    expect(await t.staking.ownDrep("preprod")).toMatchObject({
      status: "registered",
      deposit: "500000000",
      active: true,
      expiresEpoch: 340,
      profile: { url, hash: "ab".repeat(32), name: "Tester", valid: false },
    });
    expect(paths(t)).toEqual(["drep_info", "drep_metadata"]);
    expect(decodeURIComponent(t.koios.calls.find((c) => c.path === "drep_metadata")!.query)).toBe(
      "select=drep_id,is_valid,meta_json->body->givenName",
    );
  });

  it("is read while unlocked only: the ID comes from its key", async () => {
    const t = await unlocked();
    await t.wallet.lock();
    await expect(t.staking.ownDrep("preprod")).rejects.toThrow("locked");
    expect(t.koios.calls).toHaveLength(0);
  });
});

describe("governance actions", () => {
  it("are read once an hour, and a DRep's votes with them", async () => {
    const t = await unlocked();
    const view = await t.staking.governance("preprod");
    expect(view.list.actions).toHaveLength(governanceFixture.proposal_list.preprod.length);
    expect(view.drep.status).toBe("none");
    expect(view.votes).toEqual({});
    // Not a DRep: no vote_list, and drep_info alone, without the deposit's epoch_params.
    expect(paths(t)).toEqual(["drep_info", "proposal_list"]);
    const query = decodeURIComponent(t.koios.calls.find((c) => c.path === "proposal_list")!.query);
    expect(query).toContain("ratified_epoch=is.null&enacted_epoch=is.null&dropped_epoch=is.null&expired_epoch=is.null");
    expect(query).toContain("title:meta_json->body->>title,abstract:meta_json->body->>abstract");
    expect(await t.local.get(LOCAL_GOV_ACTIONS_PREFIX + "preprod")).toMatchObject({ updatedAt: t.clock.now });

    // Within the hour, from the device; a refresh, or an hour on, asks again.
    t.koios.calls.length = 0;
    await t.staking.governance("preprod");
    expect(paths(t)).toEqual(["drep_info"]);
    await t.staking.governance("preprod", true);
    expect(paths(t)).toContain("proposal_list");
    // An hour old (aged on the device, since an hour of the clock would lock the wallet).
    const key = LOCAL_GOV_ACTIONS_PREFIX + "preprod";
    const kept = (await t.local.get<{ updatedAt: number }>(key))!;
    await t.local.set(key, { ...kept, updatedAt: kept.updatedAt - GOV_ACTIONS_TTL_MS });
    t.koios.calls.length = 0;
    await t.staking.governance("preprod");
    expect(paths(t)).toEqual(["drep_info", "proposal_list"]);

    // A DRep: its newest vote on each action counts.
    const [a, b] = governanceFixture.proposal_list.preprod;
    t.koios.dreps.set(OWN, registered());
    t.koios.votes.push(
      { voter_id: OWN, proposal_id: a!.proposal_id, vote: "No", block_time: 1 },
      { voter_id: OWN, proposal_id: a!.proposal_id, vote: "Yes", block_time: 2 },
      { voter_id: OWN, proposal_id: b!.proposal_id, vote: "Abstain", block_time: 1 },
      { voter_id: "drep1someoneelse", proposal_id: b!.proposal_id, vote: "No", block_time: 3 },
    );
    t.koios.calls.length = 0;
    const voted = await t.staking.governance("preprod");
    expect(voted.votes).toEqual({ [a!.proposal_id]: "yes", [b!.proposal_id]: "abstain" });
    expect(paths(t)).toEqual(["drep_info", "vote_list"]);
  });

  it("show an action's own words as Koios read them, and nothing that rewrites a line", async () => {
    const t = await unlocked();
    t.koios.proposals = governanceFixture.proposal_list.mainnet;
    const { list } = await t.staking.governance("mainnet");
    const treasury = list.actions.find((a) => a.type === "TreasuryWithdrawals")!;
    expect(treasury.title).toMatch(/OpenZeppelin/);
    expect(treasury.abstract!.length).toBeLessThanOrEqual(2_001);
    expect(treasury.anchor).toMatchObject({ url: expect.stringMatching(/^ipfs:\/\//) });
    expect(list.actions.some((a) => a.anchorValid === false)).toBe(true);

    expect(shownText("Vote ‮on‬ this​", 200)).toBe("Vote  on  this");
    expect(shownText("line one\nline two\u0007", 200, { lines: true })).toBe("line one\nline two");
    expect(shownText("x".repeat(300), 200)).toHaveLength(201);
    expect(shownText("   ", 200)).toBeUndefined();
    expect(shownText(42, 200)).toBeUndefined();
  });

  it("close when their epoch ends, counted with no request", () => {
    // Preprod's epoch 317 began on 2026-10-03; mainnet's 659 on 2026-10-01 at 21:44:51.
    expect(new Date(epochStart("preprod", 317)).toISOString()).toBe("2026-10-03T00:00:00.000Z");
    expect(new Date(epochStart("mainnet", 659)).toISOString()).toBe("2026-10-01T21:44:51.000Z");
    expect(epochAt("mainnet", Date.UTC(2026, 9, 4))).toBe(659);
    expect(epochAt("preprod", epochStart("preprod", 317) - 1)).toBe(316);
  });
});

describe("the DRep's transactions", () => {
  it("registers with the deposit and the account's own vote, signed at review, its own pending kind", async () => {
    const t = await unlocked();
    rich(t);
    const summary = await t.staking.build("preprod", { kind: "drep-register", delegate: true });
    expect(summary).toMatchObject({
      action: { kind: "drep-register", delegate: true },
      drep: OWN,
      deposit: "500000000",
      refund: "0",
    });
    expect(paths(t)).toEqual(["account_addresses", "account_info", "credential_utxos", "drep_info", "epoch_params", "tip"]);
    expect((await t.staking.submit("preprod", summary.txHash)).kind).toBe("drep-register");
  });

  it("votes, updates and retires only as a DRep, and registers only once", async () => {
    const t = await unlocked();
    rich(t);
    const [action] = governanceFixture.proposal_list.preprod;
    const vote: StakingAction = {
      kind: "drep-vote",
      votes: [{ txHash: action!.proposal_tx_hash, index: action!.proposal_index, vote: "no" }],
    };
    await expect(t.staking.build("preprod", vote)).rejects.toThrow("isn't a DRep");
    await expect(t.staking.build("preprod", { kind: "drep-retire" })).rejects.toThrow("isn't a DRep");
    await expect(t.staking.build("preprod", { kind: "drep-update" })).rejects.toThrow("isn't a DRep");

    t.koios.dreps.set(OWN, registered());
    await expect(t.staking.build("preprod", { kind: "drep-register", delegate: true })).rejects.toThrow("a DRep already");
    const voted = await t.staking.build("preprod", vote);
    expect(voted).toMatchObject({ deposit: "0", refund: "0", drep: OWN });
    expect((await t.staking.submit("preprod", voted.txHash)).kind).toBe("drep-vote");

    const update = await t.staking.build("preprod", {
      kind: "drep-update",
      anchor: { url: "https://example.com/drep.jsonld", hash: "ab".repeat(32) },
    });
    expect((await t.staking.submit("preprod", update.txHash)).kind).toBe("drep-update");

    const retire = await t.staking.build("preprod", { kind: "drep-retire" });
    expect(retire.refund).toBe("500000000");
    expect((await t.staking.submit("preprod", retire.txHash)).kind).toBe("drep-retire");
  });

  it("writes a profile in WebAssembly, asking no one", async () => {
    const t = await unlocked();
    const file = t.staking.drepProfile({ givenName: "Tester", doNotList: true });
    expect(JSON.parse(file.file).body).toEqual({ givenName: "Tester", doNotList: true });
    expect(file.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.koios.calls).toHaveLength(0);
  });
});

describe("Activity", () => {
  const tx = (over: Partial<KoiosTxInfo>): KoiosTxInfo => ({
    tx_hash: "aa".repeat(32),
    block_height: 1,
    tx_timestamp: 1,
    fee: "200000",
    inputs: [],
    outputs: [],
    ...over,
  });

  it("names the account's own DRep's certificates and votes, and nobody else's", () => {
    const registration = tx({
      certificates: [
        { index: 0, type: "drep_registration", info: { drep_id: OWN, deposit: "500000000" } },
        { index: 1, type: "vote_delegation", info: { stake_address: STAKE, drep_id: OWN } },
      ],
    });
    expect(stakingOf(registration, STAKE, OWN)).toEqual({ drepAction: "register", deposit: "500000000", drep: OWN });
    expect(stakingOf(tx({ certificates: [{ index: 0, type: "drep_retire", info: { drep_id: OWN } }] }), STAKE, OWN)).toEqual({
      drepAction: "retire",
    });
    const votes = tx({
      voting_procedures: [
        { vote: "Yes", voter: OWN, voter_role: "DRep" },
        { vote: "No", voter: OWN, voter_role: "DRep" },
        { vote: "No", voter: "drep1someoneelse", voter_role: "DRep" },
      ],
    });
    expect(stakingOf(votes, STAKE, OWN)).toEqual({ drepAction: "vote", votes: 2 });
    // Another DRep's registration isn't the account's.
    const theirs = tx({ certificates: [{ index: 0, type: "drep_registration", info: { drep_id: "drep1someoneelse", deposit: "500000000" } }] });
    expect(stakingOf(theirs, STAKE, OWN)).toBeUndefined();
    expect(stakingOf(votes, STAKE)).toBeUndefined();
  });

  it("asks for the votes in the same tx_info as everything else", async () => {
    const t = await unlocked();
    await t.balances.get("preprod");
    await t.activity.cardano("preprod");
    expect(t.koios.calls.find((c) => c.path === "tx_info")!.body).toMatchObject({ _certs: true, _governance: true });
  });
});
