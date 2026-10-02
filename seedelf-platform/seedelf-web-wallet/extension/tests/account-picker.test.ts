// The account picker and Settings → Public accounts, rendered as the pages
// render them (chunk 18).
//
// The picker is hidden with one account, so a wallet that never had a second
// looks exactly as it did; with more, it names the account and the screens
// say which one they are showing.
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { Account, KnownAccount } from "../src/shared/rpc";
import { AccountsContext, accountName, nameOf } from "../src/ui/accounts";
import { AccountPicker } from "../src/ui/components/AccountPicker";
import { PreferencesContext } from "../src/ui/preferences";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";

let Receive: typeof import("../src/ui/screens/Receive");

beforeAll(async () => {
  vi.stubGlobal("location", { search: "?view=tab", hash: "" });
  Receive = await import("../src/ui/screens/Receive");
});

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/&#x27;/g, "'").trim();

/** The pages' context, as the provider fills it. */
const ctx = (accounts: KnownAccount[], active = 0) => ({
  accounts,
  active,
  loaded: true,
  name: nameOf(accounts, active),
  several: accounts.length > 1,
  reload: async () => undefined,
});

const within = (accounts: KnownAccount[], active: number, child: ReactNode) =>
  createElement(
    AccountsContext.Provider,
    { value: ctx(accounts, active) },
    createElement(PreferencesContext.Provider, { value: { prefs: DEFAULT_PREFERENCES, loaded: true, set: async () => undefined } }, child),
  );

describe("the account picker", () => {
  it("is not there with one account", () => {
    expect(renderToStaticMarkup(within([{ index: 0 }], 0, createElement(AccountPicker)))).toBe("");
  });

  it("lists every account it knows, with the one it is on selected", () => {
    const html = renderToStaticMarkup(within([{ index: 0 }, { index: 1, name: "Exchange" }, { index: 3 }], 1, createElement(AccountPicker)));
    expect(html).toContain('aria-label="Public account"');
    expect(html).toContain("Working on Exchange");
    // Numbered from 1 where a person reads them, whatever the derivation index.
    expect(text(html)).toContain("Account 1");
    expect(text(html)).toContain("Exchange");
    expect(text(html)).toContain("Account 4");
    expect(html).toMatch(/<option[^>]*selected[^>]*value="1"|value="1"[^>]*selected/);
  });
});

describe("a name for an account", () => {
  it("is its own, or its number as a person counts", () => {
    expect(accountName({ index: 0 })).toBe("Account 1");
    expect(accountName({ index: 7 })).toBe("Account 8");
    expect(accountName({ index: 1, name: "Savings" })).toBe("Savings");
    expect(accountName({ index: 1, name: "   " })).toBe("Account 2");
    // One the list doesn't hold is still named, so a message about it reads right.
    expect(nameOf([{ index: 0 }], 4)).toBe("Account 5");
  });
});

describe("Receive", () => {
  const account: Account = {
    receiveAddress: "addr_test1qexample",
    stakeAddress: "stake_test1uexample",
    seedelfPublicValue: "ab".repeat(48),
    account: 0,
  };
  const render = (accounts: KnownAccount[], active: number) =>
    text(renderToStaticMarkup(within(accounts, active, createElement(Receive.Receive, { account, handles: [], onBack: () => undefined }))));

  it("says which account the address is, once there is more than one", () => {
    expect(render([{ index: 0 }], 0)).toContain("Into your public account");
    expect(render([{ index: 0 }, { index: 1 }], 1)).toContain("Into Account 2, your public account");
    expect(render([{ index: 0 }, { index: 1, name: "Exchange" }], 1)).toContain("Into Exchange, your public account");
  });
});
