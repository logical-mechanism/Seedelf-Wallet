// Lovejoin's page with several public accounts (release review C01, C41).
// Mix again from my public account takes the active account's boxes alone,
// and a note says which account put the others in, by the name the picker
// shows; the callout of boxes not mixed yet never says a button here takes
// those. The public reviews say what leaves the account, all told, naming it
// with several, rather than the chain's change, which read as what's left.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import type { KnownAccount, LovejoinPublicSummary } from "../src/shared/rpc";
import { AccountsContext, nameOf } from "../src/ui/accounts";
import { NetworkContext } from "../src/ui/network";
import { PreferencesContext } from "../src/ui/preferences";
import { NotMixed, OtherAccounts, PublicReview, publicBoxesOf } from "../src/ui/screens/Lovejoin";

/** `element` as a person reads it, on `accounts` with `active` on, the balances shown. */
function text(element: ReactElement, accounts: KnownAccount[] = [{ index: 0 }], active = 0): string {
  const value = { accounts, active, loaded: true, name: nameOf(accounts, active), several: accounts.length > 1, reload: async () => undefined };
  const prefs = { prefs: { ...DEFAULT_PREFERENCES, hideBalances: false }, loaded: true, set: async () => undefined };
  const tree = createElement(
    NetworkContext.Provider,
    { value: "preprod" },
    createElement(AccountsContext.Provider, { value }, createElement(PreferencesContext.Provider, { value: prefs }, element)),
  );
  return renderToStaticMarkup(tree)
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ")
    .trim();
}

const box = (tag: string, txIndex = 0) => ({ txHash: tag.repeat(32), txIndex });

describe("the public side's boxes, by the account whose mix put them in (release review C01)", () => {
  it("leaves every account's out of the private balance, and gives Mix again from my public account the active one's alone", () => {
    const status = {
      fromPublic: [box("a0"), box("a1"), box("b0"), box("c0")],
      otherAccounts: [
        { ...box("b0"), account: 2 },
        { ...box("c0"), account: 1 },
      ],
    };
    const { all, mine, accounts } = publicBoxesOf(status);
    expect(all.size).toBe(4);
    expect([...mine]).toEqual([`${"a0".repeat(32)}#0`, `${"a1".repeat(32)}#0`]);
    expect(accounts).toEqual([1, 2]);
    // A worker from before had no other accounts: every public box is the active one's.
    expect(publicBoxesOf({ fromPublic: [box("a0")] })).toMatchObject({ accounts: [] });
    expect(publicBoxesOf({ fromPublic: [box("a0")] }).mine.size).toBe(1);
  });

  it("says which account put the others in, by the name the picker shows, and to switch to it", () => {
    const accounts = [{ index: 0 }, { index: 1, name: "Savings" }, { index: 2 }];
    expect(text(createElement(OtherAccounts, { accounts: [1, 2] }), accounts)).toBe(
      "Some of your boxes came from a mix from Public account · Savings. Switch to it on the Public tab to mix them again. " +
        "Some of your boxes came from a mix from Public account 3. Switch to it on the Public tab to mix them again.",
    );
    // One the wallet hasn't found yet (a restore's look still running) is named by its number.
    expect(text(createElement(OtherAccounts, { accounts: [4] }), accounts)).toContain("a mix from Public account 5.");
    expect(text(createElement(OtherAccounts, { accounts: [] }), accounts)).toBe("");
  });

  const notMixed = (count: number, fromPublic: number, elsewhere: number) =>
    text(createElement(NotMixed, { count, fromPublic, elsewhere, busy: false, onAnyway: () => undefined }));

  it("never says a button here takes boxes not mixed yet that another account's mix put in", () => {
    const all = notMixed(2, 0, 2);
    expect(all).toContain("2 of your boxes aren't mixed yet");
    expect(all).not.toContain("Mix my boxes again takes");
    expect(all).not.toContain("Mix again from my public account");
    // The rest are said as before: this account's own, and those a private mix put in.
    expect(notMixed(2, 1, 1)).toContain("It came from your public account: Mix again from my public account takes it first, and ties nothing new.");
    expect(notMixed(3, 1, 1)).toContain("Mix again from my public account takes those it put in; Mix my boxes again takes the rest.");
    expect(notMixed(2, 0, 1)).toContain("Mix my boxes again takes it first.");
    expect(notMixed(2, 2, 0)).toContain("They came from your public account: Mix again from my public account takes them first");
  });
});

describe("what a public review says leaves the account (release review C41)", () => {
  const mix: LovejoinPublicSummary = {
    network: "preprod",
    txHash: "ab".repeat(32),
    entry: "11".repeat(32),
    boxes: 2,
    depth: 2,
    delay: "1-6",
    mixes: 8,
    txs: 9,
    fees: "6600000",
    change: "40000000",
  };

  it("is the boxes and every fee, not the chain's change, which read as what would be left", () => {
    const line = text(createElement(PublicReview, { summary: mix }));
    expect(line).toContain("Total leaving your public account 26.6 ₳");
    expect(line).not.toContain("Stays in your public account");
    expect(line).not.toContain("40 ₳");
    // A seed's deposit is the boxes and its fee; mixing its own boxes again, the fees alone.
    expect(text(createElement(PublicReview, { summary: { ...mix, seed: true, boxes: 3, mixes: 0, txs: 1, fees: "300000" } }))).toContain(
      "Total leaving your public account 30.3 ₳",
    );
    expect(text(createElement(PublicReview, { summary: { ...mix, again: true, txs: 8 } }))).toContain(
      "Total leaving your public account 6.6 ₳",
    );
  });

  it("names the account that pays once there are several", () => {
    const accounts = [{ index: 0 }, { index: 1 }];
    expect(text(createElement(PublicReview, { summary: mix }), accounts, 1)).toContain("Total leaving Public account 2 26.6 ₳");
    expect(text(createElement(PublicReview, { summary: { ...mix, again: true } }), accounts, 1)).toContain(
      "Total leaving Public account 2 6.6 ₳",
    );
  });
});
