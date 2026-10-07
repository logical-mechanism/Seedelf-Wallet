// The DRep's screens, as the page renders them (chunk 21): the card on the
// Staking page in each standing, Become a DRep with its self-delegation on
// and every privacy note it owes, and the review of each DRep transaction.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { i18n } from "../src/i18n/core";
import { epochStart } from "../src/networks";
import type { OwnDrep, StakeInfo, StakingSummary } from "../src/shared/rpc";
import {
  anchorUrlProblem,
  BecomeDrep,
  DrepCard,
  type DrepFormView,
  DrepProfileEdit,
} from "../src/ui/screens/Governance";
import { StakingReview } from "../src/ui/screens/Staking";
import { pickOf, Voting } from "../src/ui/screens/Voting";
import { dayText, epochEnds } from "../src/ui/format";
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
/** An explanation behind an icon (components/Hint.tsx): in the icon's title, and not on the page until it's asked for. */
const behindIcon = (html: string, words: string) => {
  expect(html).toMatch(new RegExp(`class="hint" title="[^"]*${words.replaceAll("'", "&#x27;").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  expect(text(html)).not.toContain(words);
};

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
const cardHtml = (drep: OwnDrep | undefined, stake = staking) =>
  markup(
    createElement(DrepCard, {
      drep,
      staking: stake,
      onBecome: noop,
      onActions: noop,
      onProfile: noop,
      onRetire: noop,
      onDelegateOwn: noop,
    }),
  );
const card = (drep: OwnDrep | undefined, stake = staking) => text(cardHtml(drep, stake));

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("the DRep card", () => {
  it("not a DRep: what one is, the deposit and that it comes back, and Become a DRep", () => {
    const shown = card(none);
    expect(shown).toContain("Be your own DRep");
    // What a DRep is sits behind the heading's icon (chunk 23); the deposit stays on the page.
    behindIcon(cardHtml(none), "Become one to vote with your own stake, instead of delegating it.");
    expect(shown).toContain("Registering locks up 500 ₳, which comes back when you retire it.");
    expect(shown).toContain("Become a DRep");
    // Said once, in the Staking page's own privacy note, which said the same beside it (chunk 23's second review,
    // ST-7); Become a DRep keeps it.
    expect(shown).not.toContain("Private money has no voting power");
  });

  it("a DRep: until when it's active, its voting power, its ID, and Governance actions, Profile and Retire", () => {
    const shown = card(registered, { ...staking, drep: ID });
    expect(shown).toContain("Your DRep");
    // In the device's own time zone: epoch 341 starts at midnight UTC on 31 Jan 2027. The date first (ST-12).
    expect(shown).toContain(`Active until ${epochEnds("preprod", 340)} (epoch 340)`);
    // What staying active asks of it (GV-7).
    expect(shown).toContain("Your DRep must vote or update its profile now and then, or its voting power stops counting.");
    expect(epochEnds("preprod", 340)).toMatch(/^(30|31) Jan 2027, \d{2}:\d{2}$/);
    expect(shown).toContain("Voting power");
    expect(shown).toContain("Governance actions");
    expect(shown).toContain("Retire as a DRep");
    expect(shown).not.toContain("isn't behind your DRep's votes");
    expect(shown).not.toContain("Delegate your voting power to it");
  });

  it("says when an epoch ends to the minute, never late: voting closes then, part-way through a day", () => {
    // Mainnet's epoch 661 starts at 21:44:51 UTC, so 660's last vote is due then: in the device's own time zone, the
    // seconds dropped. A day alone read as through that day, and voting had closed hours before in Tokyo.
    const start = new Date(epochStart("mainnet", 661));
    expect(start.toISOString()).toBe("2026-10-11T21:44:51.000Z");
    const hhmm = [start.getHours(), start.getMinutes()].map((n) => String(n).padStart(2, "0")).join(":");
    expect(epochEnds("mainnet", 660)).toBe(`${dayText(start.getTime())}, ${hhmm}`);
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
    expect(shown).toContain(
      "Your voting power goes to Always abstain, so your own stake isn't behind your DRep's votes.",
    );
    expect(shown).toContain("Delegate your voting power to it");
    expect(shown).toContain("Your DRep is inactive");
    expect(shown).toContain("doesn't match the hash on chain");
  });

  it("is reading, then says why it couldn't, with Try again and the actions still there", () => {
    expect(card(undefined)).toContain("Reading your DRep…");
    const failed = markup(
      createElement(DrepCard, {
        error: "Koios is having trouble right now (500 for drep_info)",
        onRetry: noop,
        staking,
        onBecome: noop,
        onActions: noop,
        onProfile: noop,
        onRetire: noop,
        onDelegateOwn: noop,
      }),
    );
    // A registered DRep whose read failed was offered "Be your own DRep" (ST-10).
    expect(text(failed)).not.toContain("Be your own DRep");
    expect(text(failed)).toContain("Couldn't read your DRep just now.");
    expect(failed).toContain('data-testid="drep-read-failed"');
    expect(text(failed)).toContain("Try again");
    expect(text(failed)).toContain("Governance actions");
  });
});

describe("Become a DRep", () => {
  it("delegates the account's own vote by default, needs no profile, and says what's public", () => {
    const html = markup(
      createElement(BecomeDrep, { drep: none, staking, busy: false, onBack: noop, onReview: noop }),
    );
    expect(html).toContain('role="switch" class="switch" aria-checked="true"');
    const shown = text(html);
    expect(shown).toContain("Your own stake counts toward your DRep's votes, instead of going to Always abstain.");
    behindIcon(html, "A DRep needs no profile to vote.");
    expect(shown).toContain("Add a profile");
    expect(shown).toContain(
      "A DRep is public: anyone can tie it, and every vote it casts, to your public account.",
    );
    expect(shown).toContain("Private money has no voting power: what you make private stops counting toward your DRep's.");
    expect(shown).toContain("Your DRep must vote or update its profile now and then, or its voting power stops counting.");
  });

  it("says up front when the account can't pay the deposit, and holds Review back (GV-7)", () => {
    const become = (spendable: string) =>
      markup(createElement(BecomeDrep, { drep: none, staking, spendable, busy: false, onBack: noop, onReview: noop }));
    const short = become("230500000");
    expect(text(short)).toContain("You need over 501 ₳ spendable in your public account: 500 ₳ to lock up");
    // What the account holds is a balance: masked, as every balance is, until the preferences say it isn't hidden
    // (and in a render with none loaded).
    expect(text(short)).toContain("You have •••• ₳.");
    expect(short).toMatch(/<button[^>]*disabled=""[^>]*>Review<\/button>/);
    // Enough: no word of it, and Review can be pressed.
    expect(become("600000000")).not.toContain("drep-register-short");
    // The stake key's own deposit too, when the vote's delegation registers it.
    const unregistered = markup(
      createElement(BecomeDrep, {
        drep: none,
        staking: { ...staking, registered: false },
        spendable: "230500000",
        busy: false,
        onBack: noop,
        onReview: noop,
      }),
    );
    expect(text(unregistered)).toContain("You need over 503 ₳");
  });

  it("comes back from its review as it was left: the switch, the profile, its file and where it's published", () => {
    const url = "ipfs://bafkreigzvg5nbyngh2hfxrptxmh2jturifcsq5v2gbaz7hfg6ccvhlzgxu";
    const view: DrepFormView = {
      delegate: false,
      withProfile: true,
      form: {
        profile: { givenName: "Tester", objectives: "Keep fees low", doNotList: false },
        file: { file: "{}", hash: "ab".repeat(32) },
        stale: false,
        changed: false,
        url,
      },
    };
    const html = markup(
      createElement(BecomeDrep, { drep: none, staking, busy: false, view, onBack: noop, onReview: noop }),
    );
    // The switch stays off: it went back on, and a Review pressed unawares delegated the vote it had kept apart.
    expect(html).toContain('aria-checked="false" aria-labelledby="drep-delegate-label"');
    expect(text(html)).toContain("Your voting power stays with Always abstain, not your DRep.");
    // The profile, its file and the address it's published at: typed again a byte apart, the published file no
    // longer matched the registration's hash.
    expect(html).toMatch(/<input id="drep-name"[^>]*value="Tester"/);
    expect(html).toMatch(/<textarea id="drep-objectives"[^>]*>Keep fees low<\/textarea>/);
    expect(html).toContain('aria-checked="false" aria-labelledby="drep-do-not-list-label"');
    expect(html).toContain('data-testid="drep-profile-hash"');
    expect(html).toMatch(new RegExp(`<input id="drep-url"[^>]*value="${url}"`));
    expect(text(html)).toContain("Go without a profile");

    // Your DRep's profile keeps its own the same way.
    const edit = markup(
      createElement(DrepProfileEdit, { drep: registered, view: { form: view.form! }, onBack: noop, onReview: noop }),
    );
    expect(edit).toMatch(/<input id="drep-name"[^>]*value="Tester"/);
    expect(edit).toMatch(new RegExp(`<input id="drep-url"[^>]*value="${url}"`));

    // With nothing kept, each starts as it always did.
    const fresh = markup(createElement(BecomeDrep, { drep: none, staking, busy: false, onBack: noop, onReview: noop }));
    expect(fresh).toContain('aria-checked="true" aria-labelledby="drep-delegate-label"');
    expect(text(fresh)).toContain("Add a profile");
    expect(fresh).not.toContain("drep-profile-form");
  });

  it("says under Review why it can't be pressed, not in a tooltip alone (PY-9)", () => {
    const become = (over: Record<string, unknown> = {}) =>
      markup(createElement(BecomeDrep, { drep: none, staking, busy: false, onBack: noop, onReview: noop, ...over }));
    const why = (html: string, testId: string) =>
      new RegExp(`data-testid="${testId}">([^<]*)</p>`).exec(html)?.[1]?.replaceAll("&#x27;", "'");
    expect(why(become(), "drep-register-why")).toBeUndefined();
    // A transaction on its way, which nothing on the page said.
    expect(become({ blocked: "Wait for the last transaction to confirm" })).toContain(
      '<p class="note foot-note" data-testid="drep-register-why">Wait for the last transaction to confirm</p>',
    );
    // A profile asked for and not yet written and published.
    expect(why(become({ view: { withProfile: true } }), "drep-register-why")).toBe(
      "Write the profile and say where it's published first",
    );
    // Too little to pay is said above it once, not twice.
    expect(why(become({ spendable: "230500000" }), "drep-register-why")).toBeUndefined();

    // Your DRep's profile opens with Review greyed: it says why from the start, and Remove's reason too.
    const edit = (over: Record<string, unknown> = {}) =>
      markup(createElement(DrepProfileEdit, { drep: registered, onBack: noop, onReview: noop, ...over }));
    expect(why(edit(), "drep-update-why")).toBe("Write the profile and say where it's published first");
    const withProfile = { ...registered, profile: { url: "ipfs://bafy", hash: "ab".repeat(32), valid: true } };
    const blocked = "Wait for the last transaction to confirm";
    expect(why(edit({ drep: withProfile, blocked }), "drep-update-why")).toBe(blocked);
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
    const shown = review(summary({ kind: "drep-register", delegate: true }, { deposit: "500000000", drepDeposit: "500000000" }));
    // The title names the act, and so does the button (chunk 23's second review, ST-2).
    expect(shown).toContain("Review: become a DRep");
    expect(shown).toContain("Nothing is sent until you press Register as a DRep");
    expect(shown).toContain("Register as a DRep");
    expect(shown).not.toMatch(/\bSend\b/);
    expect(shown).toContain("Delegated to your DRep");
    expect(shown).toContain("DRep deposit 500 ₳");
    expect(shown).toContain("The deposit comes back when you retire your DRep.");
    // Nothing of the stake key's deposit, which comes back another way.
    expect(shown).not.toContain("comes back when you stop staking");
    expect(shown).not.toContain("Stake key deposit");
    expect(shown).toContain("anyone can tie it, and every vote it casts, to your public account.");
  });

  it("registering with the stake key too: each deposit apart, each with how it comes back", () => {
    const shown = review(summary({ kind: "drep-register", delegate: true }, { deposit: "502000000", drepDeposit: "500000000" }));
    expect(shown).toContain("DRep deposit 500 ₳");
    expect(shown).toContain("Stake key deposit 2 ₳");
    expect(shown).toContain("The deposit comes back when you retire your DRep.");
    expect(shown).toContain("The stake key deposit comes back when you stop staking.");
  });

  it("voting: the action, the vote, and that every vote is public and stays on chain, even one replaced", () => {
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
    expect(shown).toContain("Review: your vote");
    expect(shown).toContain("Cast No vote");
    // Which one, on the page: by its short ID, as its list row gives it, and not only in a tooltip (blind test T14).
    // Kept on one line by a word joiner: it broke after the ellipsis (the pass-two visual review).
    expect(shown).toContain("Governance action Treasury withdrawal · bbbbbbbb…\u2060#0");
    expect(shown).toContain("Your vote No");
    expect(shown).toContain("Your vote before Yes");
    // It said "public and permanent" beside "a new vote replaces it, until voting closes", which read as a
    // contradiction (GV-2): both are true, and it says how, and whose it is.
    expect(shown).toContain("Every vote is public and stays on chain for good, even one you replace. Anyone can tie it to your public account.");
    // Said once: the DRep's own note, beside it, said the account again (the copy trim).
    expect(shown).not.toContain("A DRep is public");
  });

  it("voting: an action with a title is named by it, and by its short ID too", () => {
    const shown = review(summary({ kind: "drep-vote", votes: [{ txHash: "53fbef38".padEnd(64, "0"), index: 2, vote: "yes" }] }), {
      govAction: {
        id: "gov_action1y",
        txHash: "53fbef38".padEnd(64, "0"),
        index: 2,
        type: "InfoAction",
        title: "Raise k to 1000?",
        proposedEpoch: 314,
        expiresEpoch: 321,
        deposit: "1000000000",
        anchor: null,
        anchorValid: null,
      },
    });
    expect(shown).toContain("Governance action Raise k to 1000? · 53fbef38…\u2060#2");
    expect(shown).not.toContain("Info action");
  });

  it("retiring: the deposit back, what ends, a danger button, and the account's own vote moving to Always abstain", () => {
    const html = markup(
      createElement(StakingReview, {
        // The move as the build found it, on its own fresh read (governance.test.ts): the page's could be older.
        summary: summary({ kind: "drep-retire" }, { refund: "500000000", ownVoteMoves: true }),
        busy: false,
        onBack: noop,
        onSend: noop,
      }),
    );
    const shown = text(html);
    expect(shown).toContain("Review: retire as a DRep");
    expect(shown).toContain("Deposit back");
    // What it ends, in a warning, and the act on a red button (ST-3).
    expect(html).toContain('data-testid="drep-retire-ends"');
    expect(shown).toContain("The 500 ₳ deposit comes back to your public account.");
    expect(shown).toContain("all voting power delegated to it stops counting.");
    expect(shown).toContain("You can become a DRep again later, with a new deposit.");
    expect(html).toMatch(/<button type="button" class="danger"[^>]*>Retire as a DRep<\/button>/);
    expect(shown).toContain("Retiring moves your own voting power to Always abstain, so your rewards stay withdrawable.");

    // The build moves nothing when the vote is elsewhere, and the review says nothing of a move.
    const elsewhere = markup(
      createElement(StakingReview, {
        summary: summary({ kind: "drep-retire" }, { refund: "500000000" }),
        busy: false,
        onBack: noop,
        onSend: noop,
      }),
    );
    expect(elsewhere).not.toContain("drep-retire-vote");
    expect(text(elsewhere)).not.toContain("Always abstain");
  });
});

describe("Voting power, for an account that may be its own DRep", () => {
  const voting = (current: string | null, own?: OwnDrep) =>
    markup(
      createElement(Voting, {
        current,
        registered: true,
        busy: false,
        onBack: noop,
        onVote: noop,
        onBecome: noop,
        ...(own ? { own } : {}),
      }),
    );

  it("offers Your own DRep beside the pinned two and A DRep, so the account never has to search for itself", () => {
    const html = voting("drep1ytah77nvma8someoneelse", registered);
    const shown = text(html);
    expect(shown).toContain("Your own DRep");
    expect(shown).toContain("Your stake behind your own DRep's votes.");
    // It sits between the pinned two and A DRep.
    expect(shown.indexOf("Always no confidence")).toBeLessThan(shown.indexOf("Your own DRep"));
    expect(shown.indexOf("Your own DRep")).toBeLessThan(shown.indexOf("A DRep Someone who votes for you"));
  });

  it("before the account is a DRep, says so under the option, and the foot opens Become a DRep (GV-3)", () => {
    const html = markup(
      createElement(Voting, {
        current: null,
        registered: true,
        busy: false,
        onBack: noop,
        onVote: noop,
        onBecome: noop,
        own: none,
        view: { pick: "own", query: "" },
      }),
    );
    const shown = text(html);
    expect(shown).toContain("This account isn't a DRep yet.");
    // Under its own option, before A DRep's, where it was after the list and below the fold.
    expect(shown.indexOf("This account isn't a DRep yet.")).toBeLessThan(shown.indexOf("A DRep Someone who votes for you"));
    expect(html).toMatch(/<button type="button" class="primary">Become a DRep<\/button>/);
    expect(html).not.toMatch(/>Review<\/button>/);
  });

  it("is the choice already made when the vote is on it, and says so", () => {
    expect(pickOf(ID, ID)).toBe("own");
    expect(pickOf(ID)).toBe("drep");
    expect(pickOf("drep_always_abstain", ID)).toBe("abstain");
    expect(pickOf(null, ID)).toBe("abstain");
    const html = voting(ID, registered);
    expect(text(html)).toContain("Now: Your own DRep");
    expect(html).toMatch(/aria-checked="true"[^>]*>(?:(?!<\/button>).)*Your own DRep/s);
    // Review can't be pressed for it, and says why under it, not in a tooltip alone (blind test T03's verifier).
    expect(html).toMatch(/<p class="note foot-note" data-testid="vote-why">Your voting power already goes there<\/p>/);
  });
});
