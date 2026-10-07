// The warnings about paying one of the user's own public accounts named it by
// number alone ("This is your own Account 2"), while the account picker, Settings
// and Your accounts show a renamed account by its name alone: with a few
// accounts, a renamed one's number was nowhere on screen. They now name it as
// the connector's windows do, its number and then its name ("Account 2 ·
// Savings"); an unnamed one reads exactly as before. Remove a Seedelf's own
// warnings are in minted-by.test.ts.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { KnownAccount } from "../src/shared/rpc";
import { AccountsContext } from "../src/ui/accounts";
import { ownAccountNumber } from "../src/ui/components/AccountRecipients";
import { OtherAccountNote } from "../src/ui/screens/CardanoSend";
import { OwnWarning } from "../src/ui/screens/Withdraw";

const KNOWN: KnownAccount[] = [{ index: 0, name: "Main" }, { index: 1, name: "  Savings " }, { index: 2 }];

const shown = (element: ReactElement, accounts = KNOWN) =>
  renderToStaticMarkup(
    createElement(
      AccountsContext.Provider,
      { value: { accounts, active: 0, loaded: true, name: "", several: accounts.length > 1, reload: async () => {} } },
      element,
    ),
  )
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ")
    .trim();

describe("an own account in a warning", () => {
  it("goes by its number, and by its name too once it has one", () => {
    expect(ownAccountNumber(KNOWN, 1)).toBe("2 · Savings");
    expect(ownAccountNumber(KNOWN, 2)).toBe("3");
    // One the list doesn't hold yet, by its number.
    expect(ownAccountNumber(KNOWN, 7)).toBe("8");
    expect(ownAccountNumber([{ index: 3, name: "   " }], 3)).toBe("4");
  });

  it("is named so on Make public, alone and as a recipient of several", () => {
    expect(shown(createElement(OwnWarning, { account: 1 }))).toBe(
      "This is your own Account 2 · Savings: anyone can link it to this money and to whoever made it private.",
    );
    expect(shown(createElement(OwnWarning, { account: 1, nth: 3 }))).toContain(
      "Recipient 3 is your own Account 2 · Savings:",
    );
    expect(shown(createElement(OwnWarning, { account: 2 }))).toContain("This is your own Account 3:");
    // With one account there's nothing to tell apart: the public account, as before.
    expect(shown(createElement(OwnWarning, { account: 0 }), [{ index: 0, name: "Main" }])).toContain(
      "This is your own public account:",
    );
  });

  it("is named so on the public Send", () => {
    expect(shown(createElement(OtherAccountNote, { index: 1 }))).toContain("This is your own Account 2 · Savings.");
    expect(shown(createElement(OtherAccountNote, { index: 2 }))).toContain("This is your own Account 3.");
  });
});
