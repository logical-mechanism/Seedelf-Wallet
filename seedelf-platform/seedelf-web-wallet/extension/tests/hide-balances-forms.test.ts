// Hide balances hides a form's lines about the balance too (chunk 23's second
// review, HM-9), so a screen being shared doesn't show them. Create a Seedelf's
// line under its title still showed the whole balance that pays, and the
// connect window's private-session amount showed the whole private balance in
// its note and in its too-much error. Remove a Seedelf's line is checked in
// minted-by.test.ts.
import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import type { Balances } from "../src/shared/rpc";
import { PreferencesContext } from "../src/ui/preferences";
import { CreateSeedelf } from "../src/ui/screens/CreateSeedelf";

const none = { lovelace: "0", tokens: [], utxos: 0 };

/** 10,408 ₳ in the public account and 28 ₳ in the private balance; or the private balance alone. */
const balances = (account = true): Balances => ({
  network: "preprod",
  updatedAt: 1,
  seedelf: { lovelace: "28000000", tokens: [], utxos: 1, seedelfs: [], locked: none },
  cardano: {
    lovelace: account ? "10408000000" : "0",
    tokens: [],
    utxos: account ? 1 : 0,
    addressesUsed: 1,
    locked: none,
    staking: { registered: false, pool: null, drep: null, rewards: "0", deposit: "0" },
  },
});

/** The line under Create a Seedelf's title, with the balances hidden or not, once the settings are read. */
const aside = (b: Balances, hideBalances: boolean) =>
  /<p class="screen__aside">([^<]*)<\/p>/.exec(
    renderToStaticMarkup(
      createElement(
        PreferencesContext.Provider,
        { value: { prefs: { ...DEFAULT_PREFERENCES, hideBalances }, loaded: true, set: async () => undefined } },
        createElement(CreateSeedelf, { balances: b, onCancel: () => undefined, onSent: () => undefined }),
      ),
    ),
  )![1];

describe("hidden balances on a form", () => {
  it("hide what pays for a Seedelf, the public account's or the private balance's", () => {
    expect(aside(balances(), true)).toBe("•••• ₳ in your public account");
    expect(aside(balances(false), true)).toBe("•••• ₳ in your private balance");
    expect(aside(balances(), false)).toBe("10,408 ₳ in your public account");
    expect(aside(balances(false), false)).toBe("28 ₳ in your private balance");
  });

  it("hide the private balance under a private session's amount, as a top-up's do", () => {
    // The form shows once a private session is chosen, which a page rendered once can't do: its lines are read here.
    const source = readFileSync(new URL("../src/ui/screens/DappApprovals.tsx", import.meta.url), "utf8");
    expect(source).toContain('tr("dappUi.heldAndCollateral", { ada: amounts.ada(seedelf.lovelace) })');
    expect(source).toContain('tr("sites.topUp.tooMuch", { held: amounts.ada(seedelf.lovelace) })');
    expect(source).not.toMatch(/formatAda\(seedelf\.lovelace\)/);
  });
});
