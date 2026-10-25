// Start a pool, 1.6.0's release review (round 2, lane S1, sc-lj-2). A start no look has found well after its block
// says it hasn't shown, and what that may mean, rather than that it's on its way for a day and then nothing
// (320-screens#0). The form's two amounts go through the wallet's amount guard, as every other amount field does:
// "1,125" typed is 1.125 there too, never 1,125, and a Spanish paste of it is said both ways (320-screens#1).
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// What the form hands each amount field, by its id: a page rendered once can't be typed into, so each field's own
// cleaning is taken here and typed into, keystroke by keystroke, as AmountField types into it. And the token the
// form's picker has: its first `useState` given ADA's key starts it.
const form = vi.hoisted(() => ({
  fields: new Map<string, (previous: string, typed: string) => { value: string; note?: string }>(),
  unit: undefined as string | undefined,
}));
vi.mock("../src/ui/components/AmountField", async (original) => {
  const react = await import("react");
  return {
    ...(await original<typeof import("../src/ui/components/AmountField")>()),
    AmountField: ({ id, clean }: { id?: string; clean: (previous: string, typed: string) => { value: string; note?: string } }) => {
      if (id) form.fields.set(id, clean);
      return react.createElement("input", { id });
    },
  };
});
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return { ...react, useState: (initial?: unknown) => react.useState(initial === "ada" && form.unit ? form.unit : initial) };
});

const { i18n, t: tr } = await import("../src/i18n/core");
const { parseQuantity } = await import("../src/ui/format");
const { NetworkContext } = await import("../src/ui/network");
const { StartedPools } = await import("../src/ui/screens/Lovejoin");
const { LovejoinLaunch } = await import("../src/ui/screens/LovejoinLaunch");

const MINUTE = 60_000;

/** A page's text, as a person reads it, on preprod. */
const text = (element: ReactElement) =>
  renderToStaticMarkup(createElement(NetworkContext.Provider, { value: "preprod" }, element))
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ")
    .trim();

describe("a pool the wallet started that no look has found (1.6.0's release review, 320-screens#0)", () => {
  const now = Date.UTC(2026, 9, 25, 12);
  const started = (minutes: number) => text(createElement(StartedPools, { started: [{ id: "a1", txHash: "aa".repeat(32), at: now - minutes * MINUTE }], now }));

  it("says it shows once found while its block may still be settling", () => {
    for (const minutes of [1, 10, 29]) {
      const said = started(minutes);
      expect(said, `${minutes} min`).toContain("shows here once a look finds it, about 10 minutes after its block.");
      expect(said, `${minutes} min`).not.toContain("hasn't shown");
    }
  });

  it("past that, says it hasn't shown, and what that may mean, never that it's on its way", () => {
    for (const minutes of [30, 120, 23 * 60]) {
      const said = started(minutes);
      expect(said, `${minutes} min`).not.toContain("about 10 minutes after its block");
      expect(said, `${minutes} min`).toContain("hasn't shown.");
      expect(said, `${minutes} min`).toContain(
        "Its start may not have gone through, or an earlier start of the same values did: then yours is a copy, never shown, and what it locked is gone for good.",
      );
    }
    // Each start its own line, when it was sent with it.
    const two = text(
      createElement(StartedPools, {
        started: [
          { id: "a1", txHash: "aa".repeat(32), at: now - 2 * 60 * MINUTE },
          { id: "b2", txHash: "bb".repeat(32), at: now - 5 * MINUTE },
        ],
        now,
      }),
    );
    expect(two.match(/hasn't shown/g)).toHaveLength(1);
    expect(two.match(/about 10 minutes after its block/g)).toHaveLength(1);
  });

  it("says nothing where it started none", () => {
    expect(text(createElement(StartedPools, { now }))).toBe("");
  });
});

describe("Start a pool's amounts, through the wallet's amount guard (1.6.0's release review, 320-screens#1)", () => {
  /** MIN on preprod's list: 6 decimal places. */
  const MIN = "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed72.4d494e";
  const nothing = () => undefined;
  /** The form with MIN picked, rendered once: what it hands its quantity's field and its box ADA's field. */
  function fields() {
    form.fields.clear();
    form.unit = MIN;
    try {
      text(
        createElement(LovejoinLaunch, {
          seedelf: { lovelace: "100000000", tokens: [] } as never,
          pools: [],
          holdings: [],
          onBack: nothing,
          onOpenPool: nothing,
          onSent: nothing,
        }),
      );
    } finally {
      form.unit = undefined;
    }
    return { quantity: form.fields.get("lovejoin-launch-quantity"), ada: form.fields.get("lovejoin-launch-ada") };
  }
  /** What a field holds once `keys` are typed into it one at a time. */
  const typed = (clean: (previous: string, typed: string) => { value: string }, keys: string) =>
    [...keys].reduce((value, key) => clean(value, value + key).value, "");

  it("reads '1,125' typed as 1.125 of the token, as Send, Swap and Make private do, in any language", async () => {
    const { quantity, ada } = fields();
    expect(quantity, "the quantity's field").toBeDefined();
    expect(ada, "the box ADA's field").toBeDefined();
    for (const language of ["en", "es", "ja"]) {
      await i18n.changeLanguage(language);
      try {
        expect(typed(quantity!, "1,125"), language).toBe("1.125");
        expect(parseQuantity(typed(quantity!, "1,125"), 6), language).toBe("1125000");
        expect(typed(ada!, "4,5"), language).toBe("4.5");
      } finally {
        await i18n.changeLanguage("en");
      }
    }
  });

  it("in Spanish, says both readings of a pasted '1,125' and changes nothing, for the token and the box's ADA", async () => {
    const { quantity, ada } = fields();
    await i18n.changeLanguage("es");
    try {
      const both = tr("format.warn.ambiguousComma", { typed: "1,125", thousands: "1125", decimal: "1.125" });
      expect(quantity!("", "1,125")).toEqual({ value: "", note: both });
      expect(ada!("", "1,125")).toEqual({ value: "", note: both });
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("says when it drops decimals past the token's, and keeps no more than one output holds", () => {
    const { quantity } = fields();
    expect(quantity!("", "1.1234567")).toEqual({ value: "1.123456", note: "MIN has at most 6 decimal places, so the extra digits were dropped." });
    // 2⁶⁴ − 1 a box at most (lovejoin-launch.ts MAX_QUANTITY): one more is refused, the amount before it kept.
    expect(quantity!("1", "18446744073709.551615").value).toBe("18,446,744,073,709.551615");
    expect(quantity!("1", "18446744073709.551616")).toEqual({ value: "1", note: "That's more MIN than there can be." });
  });
});
