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
import { ALWAYS_NO_CONFIDENCE, type PoolDetails, type PoolRow, type StakingSummary } from "../src/shared/rpc";
import { NetworkContext } from "../src/ui/network";
import { readableUrl, rememberVote, sentVote } from "../src/ui/screens/Governance";
import { paysNothing, PoolListRow, sortPools } from "../src/ui/screens/Pools";
import { noFundsReason, oversaturation, poolWarnings, StakingReview } from "../src/ui/screens/Staking";

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
    expect(shown).toContain("Your balance stays the same, but for the fee: these rewards were already counted in it.");
  });

  it("stopping: what ends, what's lost, the deposit back, on a red Stop staking (ST-3)", () => {
    const html = review(summary({ kind: "stop" }, { withdrawal: "57475311", refund: "2000000" }));
    const shown = text(html);
    expect(shown).toContain("Review: stop staking");
    expect(html).toContain('data-testid="staking-stop-ends"');
    expect(shown).toContain("Your pool and your voting power's delegation end, and no more rewards come.");
    expect(shown).toContain("Your 57.475311 ₳ of rewards are withdrawn with it");
    expect(shown).toContain("hasn't paid out yet are lost");
    expect(shown).toContain("The 2 ₳ deposit comes back to your public account.");
    expect(shown).toContain("You can start staking again any time");
    expect(html).toMatch(/<button type="button" class="danger">Stop staking<\/button>/);
  });

  it("staking with another pool: its warnings stay on, and rewards don't stop meanwhile (ST-7, ST-8)", () => {
    const html = review(summary({ kind: "delegate", pool: LOGIC }, { pool: LOGIC }), { pool: details({}), switching: true });
    const shown = text(html);
    expect(shown).toContain("Review: change pool");
    expect(html).toMatch(/<button type="button" class="primary">Stake with TPREP<\/button>/);
    expect(shown).toContain("at about 4.6 times its limit: every delegator's rewards shrink to about 22% of what they'd be.");
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
    expect(pinned).toContain("A standing vote against the constitutional committee");
    expect(pinned).not.toContain("hasn't voted lately");
  });
});

describe("an oversaturated pool, in numbers (ST-8)", () => {
  it("says how many times its limit, and what share of a reward is left", () => {
    expect(oversaturation(458.39)).toEqual({ times: "4.6", share: "22%" });
    expect(oversaturation(125)).toEqual({ times: "1.3", share: "80%" });
    expect(poolWarnings(details({ saturation: 200 }))).toEqual([
      "This pool is oversaturated, at about 2.0 times its limit: every delegator's rewards shrink to about 50% of what they'd be.",
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
      "You need about 1\u00a0₳ of spendable ADA in your public account to pay a fee here: rewards can't pay it on their own.",
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
