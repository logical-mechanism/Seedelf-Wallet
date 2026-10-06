// Home's row for the wallet's other side (blind test §9.4): Home opens on Private, and 11 of 29 blind runs looked
// there first for an ordinary payment, an address to be paid at, staking or a vote, with nothing there to say a
// public side existed. Each tab now names the other, with its balance and what it's for. Rendered as the page shows
// it, with hidden balances the default (the settings not read yet), so an amount that shows through is caught.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import { AccountsContext } from "../src/ui/accounts";
import { PreferencesContext } from "../src/ui/preferences";
import { OtherSide } from "../src/ui/screens/Home";

/** A page's text, as a person reads it. */
const text = (element: ReactElement) =>
  renderToStaticMarkup(element)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** `element` with the balances shown: the settings read, Hide balances off. */
const shown = (element: ReactElement) =>
  createElement(
    PreferencesContext.Provider,
    { value: { prefs: { ...DEFAULT_PREFERENCES, hideBalances: false }, loaded: true, set: async () => undefined } },
    element,
  );

const row = (side: "seedelf" | "cardano", lovelace?: string) => createElement(OtherSide, { side, lovelace, onOpen: () => undefined });

describe("Home's row for the other side (blind test §9.4)", () => {
  it("on Private: the public account, its balance to the lovelace, and what it's for", () => {
    const line = text(shown(row("cardano", "10408014036")));
    expect(line).toBe("Public account 10,408.014036 ₳ Pay any address, get paid by any wallet, stake and vote");
  });

  it("on Public: the private balance, and that swaps and mixing are there", () => {
    expect(text(shown(row("seedelf", "28000000")))).toBe("Private balance 28 ₳ Pay and get paid privately, swap and mix");
  });

  it("is one button, which the tests and a screen reader find by its words", () => {
    const html = renderToStaticMarkup(shown(row("cardano", "0")));
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('data-testid="home-public-row"');
    expect(html).toContain('data-testid="home-public-row-lovelace"');
  });

  it("names the account as the Public tab's heading does, said to be public, once there's more than one (the owner, 2026-10-06)", () => {
    const several = createElement(
      AccountsContext.Provider,
      {
        value: {
          accounts: [{ index: 0 }, { index: 1, name: "Savings" }, { index: 2 }],
          active: 1,
          loaded: true,
          name: "Savings",
          several: true,
          reload: async () => undefined,
        },
      },
      shown(row("cardano", "1000000")),
    );
    expect(text(several)).toMatch(/^Public account · Savings 1 ₳ /);
    expect(text(shown(row("cardano", "1000000")))).toMatch(/^Public account 1 ₳ /);
  });

  it("keeps hidden balances hidden, and shows a dash before the first reading", () => {
    const hidden = text(row("cardano", "10408014036"));
    expect(hidden).toContain("•••• ₳");
    expect(hidden).not.toMatch(/\d/);
    expect(text(shown(row("seedelf")))).toContain("Private balance — ₳");
  });

  it("names no action the hero's buttons name, so neither is mistaken for the other", () => {
    // The e2e tests find Home's buttons by words such as "Receive", "Send" and "Make private".
    for (const side of ["seedelf", "cardano"] as const) {
      expect(text(shown(row(side, "1")))).not.toMatch(/receive|send|make (private|public)/i);
    }
  });
});
