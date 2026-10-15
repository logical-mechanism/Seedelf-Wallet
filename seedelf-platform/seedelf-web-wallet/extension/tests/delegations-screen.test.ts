// Delegation history (chunk 36), as the page renders it from the recorded
// preprod account's 12 certificates: by year, newest first, what each did
// (the pool by its ticker, the vote in words, the account's own DRep said so),
// the deposit taken and given back, 50 rows at first, every amount hidden with
// the balances, and where Staking offers it.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import type { DelegationRow, StakeInfo } from "../src/shared/rpc";
import { NetworkContext } from "../src/ui/network";
import { PreferencesContext } from "../src/ui/preferences";
import { DELEGATIONS_SHOWN, DelegationList, delegationYears, firstDelegations } from "../src/ui/screens/Delegations";
import { Staking } from "../src/ui/screens/Staking";
import { delegationsPreprod } from "./fakes";

const LOGIC = "pool1rccstu3l9ty3k0a5cd06fl3szsss9r34dcg5j38fqgq9kvng0tg";
const GRADA = "pool1nmfr5j5rnqndprtazre802glpc3h865sy50mxdny65kfgf3e5eh";
const OWN_DREP = "drep1y2e20afmrjh8wz02w92880qwdqephacyqlahqyp5n6rgnhg2egjc8";
const COGNO = "drep1ytah77nvma8thq037ynn9sqf59rpsjfpnq2a0rtltfnyvjchvqhux";

/** The recorded history as the worker hands it over (staking.test.ts checks that), LOGIC named as the session knows it. */
function recorded(): DelegationRow[] {
  const tx = (prefix: string) => delegationsPreprod.account_update_history.find((r) => r.tx_hash.startsWith(prefix))!;
  const row = (prefix: string, rest: Omit<DelegationRow, "txHash" | "at" | "epoch">): DelegationRow => {
    const r = tx(prefix);
    return { txHash: r.tx_hash, at: r.block_time * 1000, epoch: r.epoch_no, ...rest };
  };
  const logic = { id: LOGIC, ticker: "LOGIC" };
  return [
    row("938adb09", { kind: "vote", drep: OWN_DREP, ownDrep: true }),
    row("4060cae2", { kind: "vote", drep: COGNO }),
    row("0bbe2af8", { kind: "registration", deposit: "2000000" }),
    row("0bbe2af8", { kind: "pool", pool: logic }),
    row("0bbe2af8", { kind: "vote", drep: "drep_always_abstain" }),
    row("e446fde4", { kind: "deregistration", deposit: "2000000" }),
    row("b6dd2866", { kind: "pool", pool: logic }),
    row("b6dd2866", { kind: "vote", drep: "drep_always_abstain" }),
    row("12968105", { kind: "pool", pool: logic }),
    row("f3338de1", { kind: "registration", deposit: "2000000" }),
    row("f3338de1", { kind: "pool", pool: { id: GRADA } }),
    row("f3338de1", { kind: "vote", drep: "drep_always_abstain" }),
  ];
}

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
const list = (rows: DelegationRow[], hide = false) => markup(createElement(DelegationList, { rows }), hide);
/** Each row's words, in order. */
const rowTexts = (html: string) => [...html.matchAll(/<button type="button" class="token-row".*?<\/button>/g)].map((m) => text(m[0]));

describe("the years", () => {
  it("groups the rows by the year each was made in, on this device's calendar, in the order given", () => {
    const years = delegationYears(recorded());
    expect(years.map((y) => [y.year, y.rows.length])).toEqual([
      [2026, 8],
      [2025, 4],
    ]);
    for (const y of years) for (const r of y.rows) expect(new Date(r.at).getFullYear()).toBe(y.year);
  });

  it("shows the first rows across the years, a year past the cut not at all", () => {
    const years = delegationYears(recorded());
    expect(firstDelegations(years, 9).map((y) => [y.year, y.rows.length])).toEqual([
      [2026, 8],
      [2025, 1],
    ]);
    expect(firstDelegations(years, 8).map((y) => y.year)).toEqual([2026]);
    expect(firstDelegations(years, 50)).toEqual(years);
  });
});

describe("the page", () => {
  it("says what each did, newest first, by year, with the day and the epoch", () => {
    const html = list(recorded());
    expect(html).toContain('<h2 id="delegations-2026">2026</h2>');
    expect(html).toContain('<h2 id="delegations-2025">2025</h2>');
    const rows = rowTexts(html);
    expect(rows).toHaveLength(12);
    const said = [
      "Voting power to your own DRep",
      "Voting power to cogno drep",
      "Stake key registered −2 ₳",
      "Staked with LOGIC",
      "Voting power to Always abstain",
      "Stopped staking +2 ₳",
      "Staked with LOGIC",
      "Voting power to Always abstain",
      "Staked with LOGIC",
      "Stake key registered −2 ₳",
      `Staked with ${GRADA.slice(0, 16)}…${GRADA.slice(-6)}`,
      "Voting power to Always abstain",
    ];
    rows.forEach((row, i) => expect(row).toMatch(new RegExp(`^${said[i]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\d{1,2} \\w{3,4} 20\\d\\d · Epoch \\d{3}$`)));
    expect(rows[0]).toMatch(/· Epoch 317$/);
    expect(rows.at(-1)).toMatch(/2025 · Epoch 219$/);
    // The whole ID on hover: a ticker or a name is anyone's to choose.
    expect(html).toContain(`title="${LOGIC}"`);
    expect(html).toContain(`title="${COGNO}"`);
  });

  it("says what it did when the server didn't say what it named", () => {
    const at = { txHash: "ab".repeat(32), at: Date.UTC(2026, 5, 1), epoch: 400 };
    const rows = rowTexts(
      list([
        { ...at, kind: "pool" },
        { ...at, kind: "vote" },
        { ...at, kind: "registration" },
        { ...at, kind: "deregistration" },
      ]),
    );
    expect(rows.map((r) => r.replace(/ \d{1,2} \w{3,4} 2026 · Epoch 400$/, ""))).toEqual([
      "Staked with a pool",
      "Voting power delegated",
      "Stake key registered",
      "Stopped staking",
    ]);
  });

  it("hides every amount with the balances", () => {
    const shown = text(list(recorded(), true));
    expect(shown).toContain("Stake key registered −•••• ₳");
    expect(shown).toContain("Stopped staking +•••• ₳");
    expect(shown).not.toMatch(/\d ₳/);
  });

  it("shows 50 rows at first, with Show more past them", () => {
    const many = Array.from({ length: 60 }, (_, i): DelegationRow => ({
      kind: "pool",
      txHash: i.toString(16).padStart(64, "0"),
      at: Date.UTC(2026, 0, 1) - i * 86_400_000,
      epoch: 500 - i,
      pool: { id: LOGIC, ticker: "LOGIC" },
    }));
    expect(rowTexts(list(many))).toHaveLength(DELEGATIONS_SHOWN);
    expect(text(list(many))).toContain("Show more");
    expect(text(list(recorded()))).not.toContain("Show more");
  });

  it("says when there's nothing yet", () => {
    const html = list([]);
    expect(html).toContain('data-testid="delegations-none"');
    expect(text(html)).toBe("No staking changes yet");
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
  const page = (s: StakeInfo) => text(markup(createElement(Staking, { staking: s, spendRewards: true, onBack: () => undefined, onSent: () => undefined })));
  const stopped: StakeInfo = { registered: false, pool: null, drep: null, rewards: "0", deposit: "0" };

  it("above Stop staking while the key is registered, pool or not", () => {
    expect(page(staking)).toMatch(/Delegation history Stop staking/);
    expect(page({ ...staking, pool: null, rewarded: undefined })).toMatch(/Delegation history Stop staking/);
  });

  it("alone for a key that stopped and was paid, and not for one never paid", () => {
    const paid = page({ ...stopped, rewarded: true });
    expect(paid).toContain("Delegation history");
    expect(paid).not.toContain("Stop staking");
    expect(page(stopped)).not.toContain("Delegation history");
  });
});
