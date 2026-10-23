// The owner's test of 1.6.0 (2026-10-19), in the MIN pool: "I just keep clicking the up button for more but dont
// really see how much I can put in nor does it limit my box count by that amount either". The Mix form now shows
// what the side that pays holds beside the boxes' count (its ADA, and a token pool's token, none of it too), and so
// does Bootstrap's; the stepper is held to the public account's ADA as it was to the private balance's; and where not
// one box fits, it shows one, not the count it had.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { t } from "../src/i18n";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import { formatAda } from "../src/ui/format";
import type { ShownPool } from "../src/ui/lovejoin-pools";
import { NetworkContext } from "../src/ui/network";
import { PreferencesContext } from "../src/ui/preferences";
import * as LovejoinScreen from "../src/ui/screens/Lovejoin";
import { tokenAmountText } from "../src/ui/tokens";

vi.mock("../src/i18n", async (original) => {
  const real = await original<typeof import("../src/i18n")>();
  return { ...real, useT: () => real.t };
});

const { HeldOnSide, boxesShown, mixMost } = LovejoinScreen;
const PoolPage = (LovejoinScreen as unknown as { PoolPage: (props: Record<string, unknown>) => ReactElement }).PoolPage;

/** Markup's text, as a person reads it. */
const words = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();

/** What the held amounts `testId` names say: the icon, where they are (for a screen reader), then the amounts. */
const said = (markup: string, testId: string) =>
  words(markup.match(new RegExp(`data-testid="${testId}"[^>]*>(.*?<span class="sr-only">[^<]*</span>[^<]*)</span>`))?.[1] ?? "");

const html = (element: ReactElement, hideBalances = false) =>
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

/** MIN, on preprod's token list, 100 a box with 4.5 ₳, as Claude's preprod pool dfa1f845… has it. */
const MIN = { policyId: "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed72", assetName: "4d494e" };
const Q = { ...MIN, quantity: "100000000" };
const BOX = 4_500_000n;
const minHeld = (quantity: string) => ({ ...MIN, quantity, fingerprint: "", decimals: 6 });
/** One box's funding in that pool: its 4.5 ₳, 3.8 ₳ of mixes and the 1.5 ₳ reserve. */
const ONE = { boxes: 1, lovelace: "9800000", mixFees: "3800000" };

describe("the stepper holds to what the side that pays has", () => {
  it("the public account's ADA too, which it never did", () => {
    // 30 ₳ and plenty of MIN: 1.5 ₳ of reserve, then 8.3 ₳ a box, so three.
    const side = { lovelace: "30000000", tokens: [minHeld("10000000000")] };
    expect(mixMost("public", side, Q, ONE, BOX, 10)).toMatchObject({ adaMost: 3, most: 3 });
    // From the private balance the one-time account's 5 ₳ and the fee's room come off as well: two.
    expect(mixMost("private", side, Q, ONE, BOX, 10)).toMatchObject({ adaMost: 2, most: 2 });
  });

  it("the token held, and the pool's room, and ten at most", () => {
    const rich = "1000000000";
    expect(mixMost("private", { lovelace: rich, tokens: [minHeld("450000000")] }, Q, ONE, BOX, 10)).toMatchObject({ tokenMost: 4, most: 4 });
    expect(mixMost("public", { lovelace: rich, tokens: [] }, Q, ONE, BOX, 10)).toMatchObject({ tokenMost: 0, most: 0 });
    expect(mixMost("private", { lovelace: rich, tokens: [minHeld("10000000000")] }, Q, ONE, BOX, 2).most).toBe(2);
    expect(mixMost("private", { lovelace: rich, tokens: [minHeld("10000000000")] }, Q, ONE, BOX, 10).most).toBe(10);
    // An ADA pool asks for no token.
    expect(mixMost("public", { lovelace: rich, tokens: [] }, undefined, ONE, 10_000_000n, 10).most).toBe(10);
  });

  it("holds nothing back on ADA before the funding is priced", () => {
    expect(mixMost("public", { lovelace: "0", tokens: [] }, undefined, undefined, BOX, 10).adaMost).toBe(10);
  });

  it("shows one where none fits, not the count it had", () => {
    expect(boxesShown(4, 0)).toBe(1);
    expect(boxesShown(4, 3)).toBe(3);
    expect(boxesShown(2, 10)).toBe(2);
    expect(boxesShown(1, 0)).toBe(1);
  });
});

describe("the form says what the side that pays holds", () => {
  const network = "preprod" as const;

  it("its ADA and the pool's token, with where it is for a screen reader", () => {
    const page = html(createElement(HeldOnSide, { source: "private", side: { lovelace: "180000000", tokens: [minHeld("450000000")] }, token: Q, testId: "held" }));
    expect(said(page, "held")).toBe(`${t("lovejoin.mix.inPrivate")} ${formatAda("180000000")} ₳ · ${tokenAmountText(network, minHeld("450000000"))}`);
    expect(page).toContain(`title="${t("lovejoin.mix.inPrivate")}"`);
  });

  it("none of the token, said as none, from the public account", () => {
    const page = html(createElement(HeldOnSide, { source: "public", side: { lovelace: "300000000", tokens: [] }, token: Q, testId: "held" }));
    expect(said(page, "held")).toBe(`${t("lovejoin.mix.inPublic")} ${formatAda("300000000")} ₳ · ${tokenAmountText(network, { ...Q, quantity: "0" })}`);
  });

  it("its ADA alone in an ADA pool, and nothing while balances are hidden", () => {
    const ada = html(createElement(HeldOnSide, { source: "private", side: { lovelace: "180000000", tokens: [minHeld("450000000")] }, testId: "held" }));
    expect(said(ada, "held")).toBe(`${t("lovejoin.mix.inPrivate")} ${formatAda("180000000")} ₳`);
    const hidden = html(
      createElement(HeldOnSide, { source: "private", side: { lovelace: "180000000", tokens: [minHeld("450000000")] }, token: Q, testId: "held" }),
      true,
    );
    expect(said(hidden, "held")).not.toMatch(/180|450/);
  });

  const pool = (extra: Partial<ShownPool> = {}): ShownPool => ({
    id: "a1".repeat(28),
    box: { lovelace: "4500000", token: Q },
    others: 40,
    free: 40,
    floor: 30,
    boxes: [],
    lovelace: "0",
    due: [],
    notMixed: [],
    fromPublic: [],
    ...extra,
  });
  const page = (p: ShownPool) =>
    html(
      createElement(PoolPage, {
        pool: p,
        seedelf: { lovelace: "180000000", tokens: [minHeld("450000000")], utxos: 3, seedelfs: [], locked: { lovelace: "0", tokens: [], utxos: 0 } },
        reading: false,
        readFailed: false,
        mixingAgain: false,
        sending: null,
        onSendingPublic: () => undefined,
        onSending: () => undefined,
        onRefresh: async () => undefined,
        onBack: () => undefined,
        onPending: () => undefined,
      }),
    );

  it("on a pool's page, in Mix, and in Bootstrap below the floor", () => {
    const mix = page(pool());
    expect(said(mix, "lovejoin-held-balance")).toContain(tokenAmountText(network, minHeld("450000000")));
    const short = page(pool({ others: 3, free: 3 }));
    expect(said(short, "lovejoin-bootstrap-held-balance")).toContain(tokenAmountText(network, minHeld("450000000")));
  });

  it("in the classic pool's form too: the owner asked for ADA pools as well (backward compatibility 7, by call)", () => {
    const classic = page(pool({ id: undefined, box: { lovelace: "10000000" }, others: 41, free: 41 }));
    expect(said(classic, "lovejoin-held-balance")).toBe(`${t("lovejoin.mix.inPrivate")} ${formatAda("180000000")} ₳`);
  });
});
