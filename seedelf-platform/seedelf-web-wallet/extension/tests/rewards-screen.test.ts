// Rewards history (chunk 30), as the page renders it from the recorded preprod
// account's 87 rewards: what's been paid in all, next epoch's apart, each
// year's total, 50 rows at first, every amount hidden with the balances, and
// where Staking offers it.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { epochStart } from "../src/networks";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import type { RewardKind, RewardRow, StakeInfo } from "../src/shared/rpc";
import { NetworkContext } from "../src/ui/network";
import { PreferencesContext } from "../src/ui/preferences";
import { firstRows, REWARDS_SHOWN, RewardList, rewardsView } from "../src/ui/screens/Rewards";
import { Staking } from "../src/ui/screens/Staking";
import { rewardsPreprod } from "./fakes";

const LOGIC = "pool1rccstu3l9ty3k0a5cd06fl3szsss9r34dcg5j38fqgq9kvng0tg";

/** The recorded rewards as the worker hands them over, LOGIC named as the session knows it. */
const recorded: RewardRow[] = rewardsPreprod.account_reward_history.map((r) => ({
  epoch: r.spendable_epoch,
  earned: r.earned_epoch,
  amount: r.amount,
  kind: r.type as RewardKind,
  pool: r.pool_id_bech32 === LOGIC ? { id: LOGIC, ticker: "LOGIC" } : { id: r.pool_id_bech32! },
}));
const ALL = 663_653_619n;
const NEXT = 6_906_754n;
/** A day into epoch 318: epoch 319's reward is listed, and not paid yet. */
const IN_318 = epochStart("preprod", 318) + 86_400_000;

const markup = (element: ReactElement, hideBalances = false) =>
  renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      { value: "preprod" },
      createElement(
        PreferencesContext.Provider,
        { value: { prefs: { ...DEFAULT_PREFERENCES, hideBalances }, loaded: true, set: async () => undefined } },
        element,
      ),
    ),
  );
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ")
    .trim();
const list = (rows: RewardRow[], now = IN_318, hide = false) => markup(createElement(RewardList, { rows, now }), hide);

describe("what the history adds up to", () => {
  it("keeps next epoch's apart, and every year's paid rewards under it, newest first", () => {
    const view = rewardsView(recorded, "preprod", IN_318);
    expect(view.coming.map((r) => r.epoch)).toEqual([319]);
    expect(view.paid).toBe(ALL - NEXT);
    expect(view.years.map((y) => y.year)).toEqual([...view.years.map((y) => y.year)].sort().reverse());
    expect(view.years.reduce((sum, y) => sum + y.total, 0n)).toBe(view.paid);
    expect(view.years.reduce((n, y) => n + y.rows.length, 0)).toBe(86);
    // Each in the year its epoch began, on this device's calendar.
    for (const y of view.years) {
      for (const r of y.rows) expect(new Date(epochStart("preprod", r.epoch)).getFullYear()).toBe(y.year);
    }
    // Once epoch 319 starts, it's paid too.
    const later = rewardsView(recorded, "preprod", epochStart("preprod", 319));
    expect(later.coming).toEqual([]);
    expect(later.paid).toBe(ALL);
  });

  it("shows the first rows across the years, a year past the cut not at all", () => {
    const years = [
      { year: 2026, total: 3n, rows: recorded.slice(1, 4) },
      { year: 2025, total: 2n, rows: recorded.slice(4, 6) },
      { year: 2024, total: 1n, rows: recorded.slice(6, 7) },
    ];
    expect(firstRows(years, 4).map((y) => [y.year, y.rows.length])).toEqual([
      [2026, 3],
      [2025, 1],
    ]);
    expect(firstRows(years, 3).map((y) => y.year)).toEqual([2026]);
    expect(firstRows(years, 10)).toEqual(years);
  });
});

describe("the page", () => {
  it("says what's been paid, next epoch's, then each year with its total, 50 rows at first", () => {
    const html = list(recorded);
    const shown = text(html);
    expect(shown).toContain("Paid in all 656.746865 ₳");
    // Next epoch's: the day it's paid, its epoch, and the pool by its ticker.
    const coming = /data-testid="rewards-coming">(.*?)<\/ul>/.exec(html)![1]!;
    expect(text(coming)).toMatch(/^\d{1,2} \w{3,4} 2026 Epoch 319 · LOGIC 6\.906754 ₳$/);
    expect(shown).toContain("Next epoch");
    const view = rewardsView(recorded, "preprod", IN_318);
    const first = view.years[0]!;
    expect(html).toContain(`<h2 id="rewards-${first.year}">${first.year}<span class="section__count"> · `);
    expect(html.match(/class="list__row"/g)).toHaveLength(1 + REWARDS_SHOWN);
    expect(shown).toContain("Show more");
    // Each pool's whole ID on hover: a ticker is anyone's to choose.
    expect(html).toContain(`title="${LOGIC}"`);
  });

  it("shows every row with nothing more to show, and Show more only past 50", () => {
    const few = recorded.slice(0, 20);
    expect(list(few).match(/class="list__row"/g)).toHaveLength(20);
    expect(text(list(few))).not.toContain("Show more");
  });

  it("names who paid each, by the pool or the pot it came from", () => {
    const at = (kind: RewardKind, pool?: RewardRow["pool"]): RewardRow => ({ epoch: 300, earned: 298, amount: "1000000", kind, ...(pool ? { pool } : {}) });
    const logic = { id: LOGIC, ticker: "LOGIC" };
    const shown = text(
      list([
        at("member", logic),
        at("leader", logic),
        at("refund", logic),
        at("reserves"),
        at("treasury"),
        at("proposal_refund"),
        at("other"),
        at("member", { id: "pool1nmfr5j5rnqndprtazre802glpc3h865sy50mxdny65kfgf3e5eh" }),
      ]),
    );
    for (const said of [
      "Epoch 300 · LOGIC 1 ₳",
      "Epoch 300 · LOGIC, as its operator",
      "Epoch 300 · LOGIC's deposit back",
      "Epoch 300 · From the reserves",
      "Epoch 300 · From the treasury",
      "Epoch 300 · A governance action's deposit back",
      "Epoch 300 · Other",
      "Epoch 300 · pool1nmfr5j5rnqn…f3e5eh",
    ]) {
      expect(shown).toContain(said);
    }
  });

  it("hides every amount with the balances, the years' totals too", () => {
    const shown = text(list(recorded, IN_318, true));
    expect(shown).toContain("Paid in all •••• ₳");
    expect(shown).not.toMatch(/\d\.\d{6} ₳/);
    expect(shown).toMatch(/20\d\d · •••• ₳/);
  });

  it("says when there's nothing yet", () => {
    const html = list([]);
    expect(html).toContain('data-testid="rewards-none"');
    expect(text(html)).toBe("No rewards yet");
  });
});

describe("where Staking offers it", () => {
  const staking: StakeInfo = {
    registered: true,
    pool: { id: LOGIC, ticker: "LOGIC" },
    drep: "drep_always_abstain",
    rewards: "57475311",
    deposit: "2000000",
    rewarded: true,
  };
  const page = (stake: StakeInfo) => text(markup(createElement(Staking, { staking: stake, spendRewards: true, onBack: () => undefined, onSent: () => undefined })));
  const stopped: StakeInfo = { registered: false, pool: null, drep: null, rewards: "0", deposit: "0" };

  it("under the rewards while staking, and under Not staking for a key that was paid", () => {
    expect(page(staking)).toMatch(/Withdraw rewards Rewards history/);
    expect(page({ ...stopped, rewarded: true })).toMatch(/Choose a pool Rewards history/);
  });

  it("not for a key never paid", () => {
    expect(page(stopped)).not.toContain("Rewards history");
  });
});
