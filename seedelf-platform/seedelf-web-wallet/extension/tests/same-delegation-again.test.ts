// Chunk 51, e7b#1: delegating again to the pool, or the vote again to the DRep, that Koios's `account_info` names,
// and the class's other two members: a DRep's vote cast again, and an update from a DRep with no profile.
//
// The ledger takes all four. Conway's DELEG asks only that the key and the delegatee be registered, so a
// StakeDelegation or a VoteDeleg to where the key is delegated already is a fee-only no-op, which core builds
// (staking.rs `Staking::of`). A DRep's vote replaces its vote before, the same one too, and an UpdateDRep's anchor is
// optional; both keep the DRep active. Koios's word can also be older than the ledger's: a pool's retirement
// (POOLREAP), or a DRep's from protocol 10, drops the delegations to it with no certificate saying so, which is why
// core's own DRep registration delegates again (release review C35). The owner's rule (2026-10-19): the wallet refuses
// only what the ledger or the contracts refuse. Each case failed on the worker's `samePool` / `sameDrep`, Pools'
// `yours`, Voting's `same`, the action's `v === mine` or the profile page's anchor gate, and the same pool's review
// was titled "change pool" with the switching hint.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DrepDetails, GovAction, GovernanceView, OwnDrep, PoolDetails, PoolRow, StakingSummary } from "../src/shared/rpc";
import { DrepProfileEdit, GovActions } from "../src/ui/screens/Governance";
import { NetworkContext } from "../src/ui/network";
import { Pools } from "../src/ui/screens/Pools";
import { poolChosen, StakingReview } from "../src/ui/screens/Staking";
import { Voting } from "../src/ui/screens/Voting";
import { stakingPreprod, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find(
    (v) => v.account === 0 && v.phrase.split(" ").length === words && (words !== 24 || v.phrase.endsWith(" art")),
  )!;
// The recorded preprod account: registered, staking with LOGIC, its vote on always abstain.
const LOGIC = "pool1rccstu3l9ty3k0a5cd06fl3szsss9r34dcg5j38fqgq9kvng0tg";
const TPREP = "pool1sh4cddrln788xmnjnsqhdwj9e7th3c3ck3zjk7ny9znwj44t8he";
const LOGIC_DREP = "drep1ydmraa6kv8cvmry059v608tehl50nfmg0z764lmsqkvwurs40sw2z";

async function unlocked() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  return t;
}

const markup = (element: ReactElement) =>
  renderToStaticMarkup(createElement(NetworkContext.Provider, { value: "preprod" }, element));
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ")
    .trim();
const noop = () => undefined;

const row: PoolRow = {
  id: LOGIC,
  ticker: "LOGIC",
  margin: 0.02,
  cost: "170000000",
  pledge: "5500000000000",
  stake: "12063859426304",
  saturation: 18.8,
};
const details: PoolDetails = {
  ...row,
  livePledge: "5885295989137",
  delegators: 103,
  blocks: 138553,
  status: "registered",
  retiringEpoch: null,
};

const summary = (action: StakingSummary["action"], over: Partial<StakingSummary> = {}): StakingSummary => ({
  network: "preprod",
  txHash: "aa".repeat(32),
  action,
  pool: action.kind === "delegate" ? action.pool : null,
  drep: action.kind === "vote" ? action.drep : null,
  fee: "175000",
  deposit: "0",
  refund: "0",
  withdrawal: "0",
  changeLovelace: "1000000",
  changeTokens: 0,
  inputs: 1,
  ...over,
});
const review = (s: StakingSummary, chosen: Record<string, unknown> = {}) =>
  markup(createElement(StakingReview, { summary: s, busy: false, onBack: noop, onSend: noop, ...chosen }));
/** The review's own foot button, by its words. */
const sendButton = (html: string) => /<div class="screen__foot">.*?<button[^>]*>([^<]*)<\/button>/s.exec(html)?.[1];

describe("chunk 51, e7b#1: the same delegation again, which the ledger takes", () => {
  it("builds a stake delegation to the pool Koios says the key is with", async () => {
    const t = await unlocked();
    const built = await t.staking.build("preprod", { kind: "delegate", pool: LOGIC });
    // A StakeDelegation for a registered key: no deposit, no refund, nothing withdrawn, only the fee.
    expect(built).toMatchObject({
      action: { kind: "delegate", pool: LOGIC },
      pool: LOGIC,
      deposit: "0",
      refund: "0",
      withdrawal: "0",
    });
  });

  it("builds a vote delegation to where Koios says the vote goes", async () => {
    const t = await unlocked();
    expect(await t.staking.build("preprod", { kind: "vote", drep: "drep_always_abstain" })).toMatchObject({
      drep: "drep_always_abstain",
      deposit: "0",
    });
    // A DRep that retired and registered again: the ledger dropped the delegation at the retirement, and Koios's
    // account_info still names the DRep, whose drep_info says registered (the fixture's).
    const info = stakingPreprod.account_info[0]!;
    t.koios.stakes.set(info.stake_address, { ...info, delegated_drep: LOGIC_DREP });
    expect(await t.staking.build("preprod", { kind: "vote", drep: LOGIC_DREP })).toMatchObject({
      drep: LOGIC_DREP,
      deposit: "0",
    });
  });

  it("offers Stake on the page of the pool the key is with, and says it's the pool", () => {
    const page = (current?: string) =>
      markup(
        createElement(Pools, {
          current,
          registered: true,
          busy: false,
          view: { query: "", sort: "ticker", open: row, details },
          onView: noop,
          onHistory: noop,
          onBack: noop,
          onStake: noop,
        }),
      );
    const html = page(LOGIC);
    const stake = /<button type="button" class="primary"([^>]*)>Stake with LOGIC<\/button>/.exec(html);
    expect(stake, "a Stake with LOGIC button on the current pool's page").not.toBeNull();
    expect(stake![1]).not.toContain("disabled");
    // Said under it, as a note: the label that took the button's place.
    expect(html).toMatch(/<p class="note foot-note" data-testid="pool-yours">You(?:'|&#x27;)re staking with this pool<\/p>/);
    // Another pool's page says nothing of the sort.
    expect(page(TPREP)).not.toContain('data-testid="pool-yours"');
  });

  it("offers Review on Voting power for where the vote goes, and says it goes there", () => {
    const drep: DrepDetails = {
      id: LOGIC_DREP,
      status: "registered",
      active: true,
      expiresEpoch: 400,
      votingPower: "5914902920642",
      delegators: 5,
    };
    for (const [current, view] of [
      ["drep_always_abstain", { pick: "abstain", query: "" }],
      [LOGIC_DREP, { pick: "drep", query: LOGIC_DREP, drep }],
    ] as const) {
      const html = markup(
        createElement(Voting, { current, registered: true, busy: false, onBack: noop, onVote: noop, onBecome: noop, view }),
      );
      const button = /<button type="button" class="primary"([^>]*)>Review<\/button>/.exec(html);
      expect(button, `a Review button for ${current}`).not.toBeNull();
      expect(button![1], `Review for ${current}`).not.toContain("disabled");
      // Not a reason it can't be pressed: a note that the vote goes there already.
      expect(html).not.toContain('data-testid="vote-why"');
      expect(html).toMatch(/<p class="note foot-note" data-testid="vote-already">Your voting power already goes there<\/p>/);
    }
    // Picked elsewhere, no such note.
    const elsewhere = markup(
      createElement(Voting, {
        current: "drep_always_abstain",
        registered: true,
        busy: false,
        onBack: noop,
        onVote: noop,
        onBecome: noop,
        view: { pick: "no-confidence", query: "" },
      }),
    );
    expect(elsewhere).not.toContain('data-testid="vote-already"');
  });

  it("reviews the same pool as itself: not a change of pool, and says it's the pool", () => {
    const logic = { id: LOGIC, ticker: "LOGIC" };
    // The page's pool against the pool picked: a change of pool, the same pool again, or a first stake.
    expect(poolChosen(logic, details, 1)).toMatchObject({ pool: details, shared: 1, switching: false, already: true });
    expect(poolChosen({ id: TPREP, ticker: "TPREP" }, details, 1)).toMatchObject({ switching: true, already: false });
    expect(poolChosen(null, details, 1)).toMatchObject({ switching: false, already: false });

    const same = review(summary({ kind: "delegate", pool: LOGIC }), { ...poolChosen(logic, details, 1) });
    expect(text(same)).not.toContain("Review: change pool");
    expect(text(same)).toContain("Review: start staking");
    expect(same).not.toContain("so there's no gap");
    expect(same).toMatch(/<p class="note" data-testid="staking-review-already">You(?:'|&#x27;)re staking with this pool<\/p>/);
    expect(sendButton(same)).toBe("Stake with LOGIC");
    // Changing pools is still said as that, with no such note.
    const change = review(summary({ kind: "delegate", pool: TPREP }), {
      ...poolChosen(logic, { ...details, id: TPREP, ticker: "TPREP" }, 1),
    });
    expect(text(change)).toContain("Review: change pool");
    expect(change).not.toContain('data-testid="staking-review-already"');
  });

  it("reviews a vote to where it goes already, and says so", () => {
    const again = review(summary({ kind: "vote", drep: "drep_always_abstain" }), { already: true });
    expect(again).toMatch(/<p class="note" data-testid="staking-review-already">Your voting power already goes there<\/p>/);
    expect(review(summary({ kind: "vote", drep: "drep_always_abstain" }))).not.toContain(
      'data-testid="staking-review-already"',
    );
  });
});

describe("chunk 51, e7b#1's class: a DRep's own transactions the ledger takes", () => {
  const drep: OwnDrep = {
    id: "drep1y2jmg4g450lced7q9n34rq6d5vjwkm0ugx6h0894u6ur92s9txn3a",
    status: "registered",
    deposit: "500000000",
    active: true,
    expiresEpoch: 340,
    votingPower: "61211118",
    delegators: 1,
    profile: null,
  };

  it("casts the vote it cast already again: its button stays live, and says it's the vote", () => {
    const action: GovAction = {
      id: "gov_action1again",
      txHash: "dd".repeat(32),
      index: 0,
      type: "InfoAction",
      proposedEpoch: 314,
      expiresEpoch: 100_000,
      deposit: "100000000000",
      anchor: null,
      anchorValid: null,
    };
    const view: GovernanceView = { list: { actions: [action], updatedAt: 0 }, drep, votes: { [action.id]: "yes" } };
    const html = markup(
      createElement(GovActions, { onBack: noop, onBecome: noop, onVote: noop, onView: noop, onOpen: noop, open: action, view }),
    );
    const buttons = /data-testid="gov-vote-buttons">(.*?)<\/div>/s.exec(html)![1]!;
    // The vote cast already: marked as that, and live, as Yes is for any other DRep's vote again.
    const yes = /<button type="button" class="secondary"([^>]*)>Yes<\/button>/.exec(buttons);
    expect(yes, "the Yes it cast, marked").not.toBeNull();
    expect(yes![1]).not.toContain("disabled");
    expect(yes![1]).toContain('title="That&#x27;s your vote already"');
    expect(buttons).not.toContain("disabled");
  });

  it("sends an update with no profile from a DRep that has none, which keeps it active", () => {
    const edit = (d: OwnDrep) =>
      markup(createElement(DrepProfileEdit, { drep: d, onBack: noop, onReview: noop }));
    // No profile: the update without one is offered, as Remove the profile is for a DRep that has one.
    const none = edit(drep);
    const go = /<button type="button" class="secondary"([^>]*)>Go without a profile<\/button>/.exec(none);
    expect(go, "Go without a profile, for a DRep with none").not.toBeNull();
    expect(go![1]).not.toContain("disabled");
    expect(none).not.toContain(">Remove the profile<");
    const withProfile = edit({ ...drep, profile: { url: "ipfs://bafy", hash: "ab".repeat(32), valid: true } });
    expect(withProfile).toMatch(/<button type="button" class="secondary">Remove the profile<\/button>/);
    expect(withProfile).not.toContain(">Go without a profile<");

    // Its review: an update, not a removal, from a DRep that had nothing to remove.
    const update = summary({ kind: "drep-update" }, { drep: drep.id });
    expect(sendButton(review(update, { noProfile: true }))).toBe("Update the profile");
    expect(sendButton(review(update))).toBe("Remove the profile");
  });
});
