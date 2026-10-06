// The Staking page's fixes from chunk 23's second usability review, as the
// page renders them: each review's button says its act and the line under its
// title names that button (ST-2), Stop staking's review says what ends on a
// danger button (ST-3), the pool list's rows keep their terms and tags whole
// (ST-4) and sort pools that pay nothing last (ST-5), a withdrawal says the
// balance stays the same (ST-6), changing pools says rewards don't stop
// (ST-7), an oversaturated pool says by how much (ST-8), and an account with
// nothing to pay a fee with is caught before a build (ST-9). Governance's:
// an action's text opens in a tab (GV-2), and a vote sent is on its way until
// Koios lists it (GV-6).
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { withdrawalsOf } from "../src/background/governance";
import { IPFS_GATEWAY } from "../src/networks";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import {
  ALWAYS_NO_CONFIDENCE,
  type GovAction,
  type GovernanceView,
  type GovVote,
  type OwnDrep,
  type PoolDetails,
  type PoolRow,
  type StakeInfo,
  type StakingSummary,
} from "../src/shared/rpc";
import { NetworkContext } from "../src/ui/network";
import { PreferencesContext } from "../src/ui/preferences";
import {
  forgetUnlisted,
  GovActions,
  readableUrl,
  rememberVote,
  sentVote,
  votesOut,
} from "../src/ui/screens/Governance";
import { paysNothing, PoolListRow, sortPools } from "../src/ui/screens/Pools";
import { noFundsReason, oversaturation, poolWarnings, Staking, StakingReview } from "../src/ui/screens/Staking";

const markup = (element: ReactElement) =>
  renderToStaticMarkup(createElement(NetworkContext.Provider, { value: "preprod" }, element));
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replace(/\s+/g, " ")
    .trim();
const noop = () => undefined;

const LOGIC = "pool1rccstu3l9ty3k0a5cd06fl3szsss9r34dcg5j38fqgq9kvng0tg";
const row = (over: Partial<PoolRow>): PoolRow => ({
  id: LOGIC,
  ticker: "LOGIC",
  margin: 0.02,
  cost: "340000000",
  pledge: "1000000000",
  stake: "5000000000000",
  saturation: 18.81,
  ...over,
});
const details = (over: Partial<PoolDetails>): PoolDetails => ({
  id: LOGIC,
  ticker: "TPREP",
  margin: 0.01,
  cost: "340000000",
  pledge: "0",
  livePledge: "0",
  stake: "1",
  saturation: 458.39,
  delegators: 3,
  blocks: 10,
  status: "registered",
  retiringEpoch: null,
  ...over,
});
const summary = (action: StakingSummary["action"], over: Partial<StakingSummary> = {}): StakingSummary => ({
  network: "preprod",
  txHash: "aa".repeat(32),
  action,
  pool: null,
  drep: null,
  fee: "172673",
  deposit: "0",
  refund: "0",
  withdrawal: "0",
  changeLovelace: "1000000",
  changeTokens: 0,
  inputs: 1,
  ...over,
});
const review = (s: StakingSummary, chosen: Record<string, unknown> = {}) =>
  markup(createElement(StakingReview, { summary: s, busy: false, onBack: noop, onSend: noop, total: "10465475311", ...chosen }));

describe("a staking review's button says the act (ST-2)", () => {
  it("withdrawing: the amount on the button, the aside naming it, and the balance staying the same (ST-6)", () => {
    const html = review(summary({ kind: "withdraw" }, { withdrawal: "57475311" }));
    const shown = text(html);
    expect(shown).toContain("Review: withdraw rewards");
    expect(shown).toContain("Nothing is sent until you press Withdraw 57.475311 ₳");
    expect(html).toMatch(/<button type="button" class="primary">Withdraw 57\.475311\u00a0₳<\/button>/);
    expect(shown).not.toMatch(/\bSend\b/);
    expect(shown).toContain("Your balance stays the same, but for the fee.");
    // What withdrawing does that matters, since the balance doesn't change (blind test §4 entry 19, E04).
    expect(shown).toContain("Once withdrawn, payments spend them whatever Settings says, and sites see them.");
  });

  it("stopping: what ends, what's lost, the deposit back, on a red Stop staking (ST-3)", () => {
    const html = review(summary({ kind: "stop" }, { withdrawal: "57475311", refund: "2000000" }));
    const shown = text(html);
    expect(shown).toContain("Review: stop staking");
    expect(html).toContain('data-testid="staking-stop-ends"');
    expect(shown).toContain("Your pool and voting power delegations end, and rewards stop.");
    expect(shown).toContain("Your 57.475311 ₳ of rewards are withdrawn too.");
    expect(shown).toContain("Rewards not yet paid out, from the last epoch or two, are lost.");
    expect(shown).toContain("The 2 ₳ deposit comes back to your public account.");
    expect(shown).toContain("You can start staking again any time");
    expect(html).toMatch(/<button type="button" class="danger">Stop staking<\/button>/);
  });

  it("staking with another pool: its warnings stay on, and rewards don't stop meanwhile (ST-7, ST-8)", () => {
    const html = review(summary({ kind: "delegate", pool: LOGIC }, { pool: LOGIC }), { pool: details({}), switching: true });
    const shown = text(html);
    expect(shown).toContain("Review: change pool");
    expect(html).toMatch(/<button type="button" class="primary">Stake with TPREP<\/button>/);
    expect(shown).toContain("about 4.6 times its limit: delegators earn about 22% of normal rewards.");
    // Behind the title's icon: the switch's own words, not the first stake's.
    expect(html).toContain("so there&#x27;s no gap");
    const first = review(summary({ kind: "delegate", pool: LOGIC }, { pool: LOGIC }), { pool: details({ saturation: 50 }) });
    expect(text(first)).toContain("Review: start staking");
    expect(first).toContain("Rewards start after about 15 to 20 days");
    expect(text(first)).not.toContain("oversaturated");
  });

  it("delegating the vote: the act, an inactive DRep's warning kept, and what always no confidence stands for", () => {
    const inactive = text(review(summary({ kind: "vote", drep: LOGIC }, { drep: "drep1xyz" }), { drepInactive: true }));
    expect(inactive).toContain("Review: who votes for you");
    expect(inactive).toContain("Delegate your vote");
    expect(inactive).toContain("This DRep hasn't voted lately");
    const pinned = text(review(summary({ kind: "vote", drep: ALWAYS_NO_CONFIDENCE }, { drep: ALWAYS_NO_CONFIDENCE })));
    expect(pinned).toContain("Your stake votes Yes on every motion of no confidence in the committee");
    expect(pinned).not.toContain("hasn't voted lately");
  });
});

describe("an oversaturated pool, in numbers (ST-8)", () => {
  it("says how many times its limit, and what share of a reward is left", () => {
    expect(oversaturation(458.39)).toEqual({ times: "4.6", share: "22%" });
    expect(oversaturation(125)).toEqual({ times: "1.3", share: "80%" });
    expect(poolWarnings(details({ saturation: 200 }))).toEqual([
      "This pool is oversaturated, about 2.0 times its limit: delegators earn about 50% of normal rewards.",
    ]);
    expect(poolWarnings(details({ saturation: 99 }))).toEqual([]);
  });
});

describe("the pool list (ST-4, ST-5)", () => {
  it("sinks pools that pay nothing to the end of every sort", () => {
    const keeper = row({ id: "pool1keeper", ticker: "AAA", margin: 1, pledge: "9000000000000", saturation: 5 });
    const empty = row({ id: "pool1empty", ticker: "AAB", stake: "0", saturation: 0 });
    const fine = row({ id: "pool1fine", ticker: "ZZZ", saturation: 40 });
    expect(paysNothing(keeper)).toBe(true);
    expect(paysNothing(empty)).toBe(true);
    expect(paysNothing(fine)).toBe(false);
    for (const by of ["ticker", "saturation", "margin", "cost", "pledge"] as const) {
      expect(sortPools([keeper, empty, fine], by)[0]!.id, by).toBe("pool1fine");
    }
  });

  it("gives a row's terms and tags lines of their own, apart from the name, and the pledge when sorted by it", () => {
    const html = markup(
      createElement(PoolListRow, {
        pool: row({ margin: 1, saturation: 120.04 }),
        current: true,
        shared: false,
        sort: "pledge",
        onOpen: noop,
      }),
    );
    // The name alone on its line: "LOGICYours" was the name and a tag run together.
    expect(html).toContain('<span class="token-row__label">LOGIC</span>');
    expect(html).toMatch(/<span class="token-row__terms">100% margin · 340\u00a0₳ cost · 1,000\u00a0₳ pledge<\/span>/);
    expect(html).toContain(
      '<span class="token-row__tags"><span class="utxo-tag">Yours</span><span class="utxo-tag utxo-tag--warn">Keeps all rewards</span>',
    );
    // One rounding for saturation, here and on a pool's page.
    expect(text(html)).toContain("120% saturated");
    const plain = markup(createElement(PoolListRow, { pool: row({}), current: false, shared: false, onOpen: noop }));
    expect(plain).not.toContain("token-row__tags");
    expect(plain).not.toContain("pledge");
  });
});

describe("an account with nothing to pay a fee with (ST-9)", () => {
  const side = (utxos: number, locked: number) => ({ utxos, locked: { lovelace: "0", tokens: [], utxos: locked } });
  it("is caught before a build, saying what's needed", () => {
    expect(noFundsReason(undefined)).toBeUndefined();
    expect(noFundsReason(side(2, 1))).toBeUndefined();
    expect(noFundsReason(side(0, 0))).toBe(
      "You need about 1\u00a0₳ of spendable ADA in your public account for the fee. Rewards can't pay it.",
    );
    expect(noFundsReason(side(3, 3))).toContain("Everything in your public account is locked");
  });
});

describe("a governance action's text and a vote sent (GV-2, GV-6)", () => {
  it("opens an IPFS text through the one gateway, and any other address not at all: it's the anchor's, to copy", () => {
    const cid = "bafkreigzvg5nbyngh2hfxrptxmh2jturifcsq5v2gbaz7hfg6ccvhlzgxu";
    expect(readableUrl(`ipfs://${cid}`)).toBe(`${IPFS_GATEWAY}/ipfs/${cid}`);
    expect(readableUrl("ipfs://Qmb62wdJUruTNffcC28jCVgrfa3ENLM5E675nLb3D3vYWZ")).toBe(
      `${IPFS_GATEWAY}/ipfs/Qmb62wdJUruTNffcC28jCVgrfa3ENLM5E675nLb3D3vYWZ`,
    );
    // Another gateway's address for a CID goes through the wallet's own, never the host the proposer named.
    expect(readableUrl(`https://ipfs.io/ipfs/${cid}/text.md`)).toBe(`${IPFS_GATEWAY}/ipfs/${cid}/text.md`);
    expect(readableUrl(`https://${cid}.ipfs.dweb.link/a/../b`)).toBe(`${IPFS_GATEWAY}/ipfs/${cid}/a/b`);
    // A host the proposer chose is copied, not opened (chunk 23's second review: as an NFT's image elsewhere is).
    expect(readableUrl("https://example.com/a.jsonld")).toBeUndefined();
    expect(readableUrl("http://example.com/a.jsonld")).toBeUndefined();
    expect(readableUrl("https://user:pw@example.com/ipfs/" + cid)).toBeUndefined();
    expect(readableUrl("javascript:alert(1)")).toBeUndefined();
    expect(readableUrl("ipfs://not-a-cid")).toBeUndefined();
  });

  it("reads a treasury withdrawal's payments as Koios lists them, and nothing else", () => {
    const to = "stake_test1ups2mn0y23vsm0l9jd0chs5kr8lxprtum433tqxv0zm8wccewjn92";
    expect(withdrawalsOf([{ stake_address: to, amount: "1000000" }])).toEqual([{ to, amount: "1000000" }]);
    expect(withdrawalsOf(null)).toEqual([]);
    // One payment on its own, as Koios can give it (chunk 23's second review, fix round).
    expect(withdrawalsOf({ stake_address: to, amount: "1000000" })).toEqual([{ to, amount: "1000000" }]);
    expect(withdrawalsOf([{ stake_address: "addr1x", amount: "1" }, { stake_address: to, amount: "-1" }, null])).toEqual([]);
  });

  it("says a vote sent is on its way until a list from Koios shows it", () => {
    rememberVote("preprod", 0, "gov_action1test", "yes");
    expect(sentVote("preprod", 0, "gov_action1test")).toBe("yes");
    expect(sentVote("preprod", 0, "gov_action1test", "no")).toBe("yes");
    expect(sentVote("preprod", 0, "gov_action1test", "yes")).toBeUndefined();
    expect(sentVote("mainnet", 0, "gov_action1test")).toBeUndefined();
    // Another public account is another DRep: account 0's vote isn't its own.
    expect(sentVote("preprod", 1, "gov_action1test")).toBeUndefined();
  });
});

describe("a vote sent, once Home stops watching it (GV-6)", () => {
  const action: GovAction = {
    id: "gov_action1landing",
    txHash: "cc".repeat(32),
    index: 0,
    type: "InfoAction",
    proposedEpoch: 314,
    expiresEpoch: 100_000,
    deposit: "100000000000",
    anchor: null,
    anchorValid: null,
  };
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
  const view = (votes: Record<string, GovVote> = {}): GovernanceView => ({
    list: { actions: [action], updatedAt: 0 },
    drep,
    votes,
  });
  // The action open after its Yes was sent from it; nothing blocked, as once Home's watch has ended.
  const page = (over: Record<string, unknown>) =>
    markup(
      createElement(GovActions, {
        onBack: noop,
        onBecome: noop,
        onVote: noop,
        onView: noop,
        onOpen: noop,
        open: action,
        sent: { id: action.id, vote: "yes" },
        ...over,
      }),
    );
  const buttons = (html: string) => /data-testid="gov-vote-buttons">(.*?)<\/div>/.exec(html)![1]!;
  rememberVote("preprod", 0, action.id, "yes");

  it("stays on its way while the list is read again, every vote held back", () => {
    // The list kept from before the vote says nothing of it: it said "Not voted" here, under "Your Yes vote is on its
    // way", with Yes live again for a second fee and a second vote on chain.
    const html = page({ view: view(), waiting: true });
    expect(text(html)).toContain("Your vote Yes, on its way");
    expect(html).toContain('data-testid="gov-vote-sent"');
    expect(buttons(html).match(/disabled=""/g)).toHaveLength(3);
  });

  it("then says what the list says: the vote, or no vote and no word of one on its way", () => {
    const landed = page({ view: view({ [action.id]: "yes" }), waiting: false });
    expect(text(landed)).toContain("Your vote Yes");
    expect(text(landed)).not.toContain("on its way");
    expect(buttons(landed)).toMatch(/class="secondary" disabled=""[^>]*>Yes<\/button>/);
    // Not on chain (dropped): the sent line went with it, where it sat over "Not voted".
    const dropped = page({ view: view(), waiting: false });
    expect(text(dropped)).toContain("Your vote Not voted");
    expect(dropped).not.toContain('data-testid="gov-vote-sent"');
    expect(text(dropped)).not.toContain("on its way");
  });

  it("knows a vote the list doesn't show yet, which the page reads again for, and forgets it once read again", () => {
    rememberVote("preprod", 3, "gov_action1a", "yes");
    rememberVote("preprod", 3, "gov_action1b", "no");
    expect(votesOut("preprod", 3, {})).toBe(true);
    // A vote replaced is out until the list has the new one.
    expect(votesOut("preprod", 3, { gov_action1a: "no", gov_action1b: "no" })).toBe(true);
    expect(votesOut("preprod", 3, { gov_action1a: "yes", gov_action1b: "no" })).toBe(false);
    // Another account's, or another network's, is nothing to read again for.
    expect(votesOut("preprod", 4, {})).toBe(false);
    expect(votesOut("mainnet", 3, {})).toBe(false);
    // Read again after its watch ended and still not listed: no longer said to be on its way, in a later watch either.
    forgetUnlisted("preprod", 3, { gov_action1a: "yes" });
    expect(sentVote("preprod", 3, "gov_action1b")).toBeUndefined();
    expect(sentVote("preprod", 3, "gov_action1a")).toBe("yes");
    expect(votesOut("preprod", 3, { gov_action1a: "yes" })).toBe(false);
  });
});

describe("the rewards' switch, beside the note it decides (blind test §9.9, E04)", () => {
  const staking: StakeInfo = {
    registered: true,
    pool: { id: LOGIC, ticker: "LOGIC" },
    drep: "drep_always_abstain",
    rewards: "57475311",
    deposit: "2000000",
  };
  const page = (spendRewards: boolean, stake = staking) =>
    markup(
      createElement(
        PreferencesContext.Provider,
        { value: { prefs: { ...DEFAULT_PREFERENCES, spendRewards, hideBalances: false }, loaded: true, set: async () => undefined } },
        createElement(Staking, { staking: stake, spendRewards, onBack: noop, onSent: noop }),
      ),
    );
  const theSwitch = (html: string) => /<button[^>]*role="switch"[^>]*aria-labelledby="staking-spend-rewards-label"[^>]*>/.exec(html)?.[0];

  it("is Settings' own switch, in Settings' words, then says when withdrawing by hand matters, either way", () => {
    const on = page(true);
    expect(theSwitch(on)).toContain('aria-checked="true"');
    // The note named the setting "in Settings" and gave no way there (blind test §9.9): the switch is here now, and
    // explained as Settings explains it, not in words of its own (the pass-two visual review).
    expect(text(on)).toContain(
      "Use staking rewards when spending Each payment from your public account also withdraws your rewards.",
    );
    expect(text(on)).toContain("Already in your balance. Withdraw them only for a site, which can't see them until then.");
    expect(text(on)).not.toContain("in Settings");
    const off = page(false);
    expect(theSwitch(off)).toContain('aria-checked="false"');
    expect(text(off)).toContain("Rewards wait until you withdraw them");
    expect(text(off)).toContain("Payments and sites can use them once withdrawn.");
  });

  it("gives way, with its note, to the warning while the rewards are locked", () => {
    const locked = page(true, { ...staking, drep: null });
    expect(theSwitch(locked)).toBeUndefined();
    expect(locked).not.toContain("staking-rewards-note");
  });
});
