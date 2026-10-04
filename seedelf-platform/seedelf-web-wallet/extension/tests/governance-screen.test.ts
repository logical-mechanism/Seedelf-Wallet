// The DRep's screens, as the page renders them (chunk 21): the card on the
// Staking page in each standing, Become a DRep with its self-delegation on
// and every privacy note it owes, and the review of each DRep transaction.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { i18n } from "../src/i18n/core";
import type { OwnDrep, StakeInfo, StakingSummary } from "../src/shared/rpc";
import { anchorUrlProblem, BecomeDrep, DrepCard } from "../src/ui/screens/Governance";
import { StakingReview } from "../src/ui/screens/Staking";
import { epochEnds } from "../src/ui/format";
import { NetworkContext } from "../src/ui/network";

const markup = (element: ReactElement) =>
  renderToStaticMarkup(createElement(NetworkContext.Provider, { value: "preprod" }, element));
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ")
    .trim();
const noop = () => undefined;

const ID = "drep1y2jmg4g450lced7q9n34rq6d5vjwkm0ugx6h0894u6ur92s9txn3a";
const staking: StakeInfo = { registered: true, pool: null, drep: "drep_always_abstain", rewards: "0", deposit: "2000000" };
const none: OwnDrep = {
  id: ID,
  status: "none",
  deposit: "0",
  depositNow: "500000000",
  active: false,
  expiresEpoch: null,
  votingPower: "0",
  delegators: 0,
  profile: null,
};
const registered: OwnDrep = {
  ...none,
  status: "registered",
  deposit: "500000000",
  depositNow: undefined,
  active: true,
  expiresEpoch: 340,
  votingPower: "61211118",
  delegators: 1,
};
const card = (drep: OwnDrep | undefined, stake = staking) =>
  text(
    markup(
      createElement(DrepCard, {
        drep,
        staking: stake,
        busy: false,
        onBecome: noop,
        onActions: noop,
        onProfile: noop,
        onRetire: noop,
      }),
    ),
  );

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("the DRep card", () => {
  it("not a DRep: what one is, the deposit and that it comes back, and Become a DRep", () => {
    const shown = card(none);
    expect(shown).toContain("Be your own DRep");
    expect(shown).toContain("you vote with your own stake, instead of delegating it to someone else.");
    expect(shown).toContain("Registering locks up 500 ₳, which comes back when you retire it.");
    expect(shown).toContain("Become a DRep");
    expect(shown).toContain("Private money has no stake key, so it carries no voting power");
  });

  it("a DRep: until when it's active, its voting power, its ID, and Governance actions, Profile and Retire", () => {
    const shown = card(registered, { ...staking, drep: ID });
    expect(shown).toContain("Your DRep");
    // In the device's own time zone: epoch 341 starts at midnight UTC on 31 Jan 2027.
    expect(shown).toContain(`Active until epoch 340, which ends ${epochEnds("preprod", 340)}`);
    expect(epochEnds("preprod", 340)).toMatch(/^(30|31) Jan 2027$/);
    expect(shown).toContain("Voting power");
    expect(shown).toContain("Governance actions");
    expect(shown).toContain("Retire as a DRep");
    expect(shown).not.toContain("not to its DRep");
  });

  it("says when the account's own vote isn't behind its DRep, and when the DRep is inactive or its profile invalid", () => {
    const shown = card(
      {
        ...registered,
        active: false,
        profile: { url: "ipfs://bafy", hash: "ab".repeat(32), valid: false },
      },
      staking,
    );
    expect(shown).toContain("This account's own voting power goes to Always abstain, not to its DRep.");
    expect(shown).toContain("Your DRep is inactive");
    expect(shown).toContain("doesn't match the hash on chain");
  });

  it("is reading, then says why it couldn't", () => {
    expect(card(undefined)).toContain("Reading your DRep…");
  });
});

describe("Become a DRep", () => {
  it("delegates the account's own vote by default, needs no profile, and says what's public", () => {
    const html = markup(
      createElement(BecomeDrep, { drep: none, staking, busy: false, onBack: noop, onReview: noop }),
    );
    expect(html).toContain('role="switch" class="switch" aria-checked="true"');
    const shown = text(html);
    expect(shown).toContain("It goes to your DRep instead of Always abstain.");
    expect(shown).toContain("A DRep needs no profile to vote.");
    expect(shown).toContain("Add a profile");
    expect(shown).toContain(
      "A DRep is public, and it's paid for from your public account, so anyone can tie the DRep, and every vote it casts, to that account.",
    );
  });

  it("takes a profile's address the ledger takes, and nothing else", () => {
    expect(anchorUrlProblem("ipfs://bafkreigzvg5nbyngh2hfxrptxmh2jturifcsq5v2gbaz7hfg6ccvhlzgxu")).toBeUndefined();
    expect(anchorUrlProblem("https://example.com/drep.jsonld")).toBeUndefined();
    expect(anchorUrlProblem(" ")).toBe("drep.form.urlNeeded");
    expect(anchorUrlProblem("https://example.com/a b")).toBe("drep.form.urlSpaces");
    expect(anchorUrlProblem(`https://example.com/${"a".repeat(120)}`)).toBe("drep.form.urlTooLong");
    // Bytes, not characters: 40 three-byte characters are 120 bytes and more.
    expect(anchorUrlProblem(`https://e.com/${"あ".repeat(40)}`)).toBe("drep.form.urlTooLong");
    expect(anchorUrlProblem("example.com/drep.jsonld")).toBe("drep.form.urlScheme");
  });
});

describe("a DRep transaction's review", () => {
  const summary = (action: StakingSummary["action"], over: Partial<StakingSummary> = {}): StakingSummary => ({
    network: "preprod",
    txHash: "aa".repeat(32),
    action,
    pool: null,
    drep: ID,
    fee: "200000",
    deposit: "0",
    refund: "0",
    withdrawal: "0",
    changeLovelace: "1000000",
    changeTokens: 0,
    inputs: 1,
    ...over,
  });
  const review = (s: StakingSummary, chosen: Record<string, unknown> = {}) =>
    text(markup(createElement(StakingReview, { summary: s, busy: false, onBack: noop, onSend: noop, ...chosen })));

  it("registering: the deposit, where the account's vote goes, and that it's public", () => {
    const shown = review(summary({ kind: "drep-register", delegate: true }, { deposit: "500000000" }));
    expect(shown).toContain("Review becoming a DRep");
    expect(shown).toContain("Delegated to your DRep");
    expect(shown).toContain("500 ₳");
    expect(shown).toContain("The deposit comes back when you retire your DRep.");
    expect(shown).toContain("so anyone can tie the DRep, and every vote it casts, to that account.");
  });

  it("voting: the action, the vote, and that every vote is public and permanent", () => {
    const shown = review(summary({ kind: "drep-vote", votes: [{ txHash: "bb".repeat(32), index: 0, vote: "no" }] }), {
      govAction: {
        id: "gov_action1x",
        txHash: "bb".repeat(32),
        index: 0,
        type: "TreasuryWithdrawals",
        proposedEpoch: 314,
        expiresEpoch: 321,
        deposit: "1000000000",
        anchor: null,
        anchorValid: null,
      },
      before: "yes",
    });
    expect(shown).toContain("Review your vote");
    expect(shown).toContain("Treasury withdrawal");
    expect(shown).toContain("Your vote No");
    expect(shown).toContain("Your vote before Yes");
    expect(shown).toContain("Every vote is public and permanent");
  });

  it("retiring: the deposit back, and the account's own vote moving to Always abstain", () => {
    const shown = review(summary({ kind: "drep-retire" }, { refund: "500000000" }), { ownVoteMoves: true });
    expect(shown).toContain("Review retiring");
    expect(shown).toContain("Deposit back");
    expect(shown).toContain("retiring moves it to Always abstain, and your rewards stay withdrawable.");
  });
});
