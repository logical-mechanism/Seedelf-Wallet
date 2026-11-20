// Send privately's line for more than it can pay names its figure as Make public's does: what's available where some
// of the private balance is locked, what's in it otherwise (chunk 51, l3still#4's Transfer half, r2screens#1's class).
// It said "in your private balance" of the unlocked side Home hands the form, with nothing of the lock its aside shows:
// 100 ₳ with 60 ₳ of it locked read "That's more than the 40 ₳ in your private balance."
//
// The form is rendered with React's server renderer, which can't type, so its recipients start as one with an amount
// typed: the first state of the render that starts as a list.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => ({ drafts: undefined as unknown, used: false }));
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return {
    ...react,
    useState: (initial?: unknown) => {
      if (!seam.used && seam.drafts !== undefined && Array.isArray(initial)) {
        seam.used = true;
        return react.useState(seam.drafts);
      }
      return react.useState(initial);
    },
  };
});
// Nothing the form shows is asked of the worker while it renders: any request stays unanswered.
vi.mock("../src/ui/background", async (original) => {
  const pending = { then: () => pending, catch: () => pending, finally: () => pending };
  return { ...(await original<typeof import("../src/ui/background")>()), call: () => pending };
});

const { t } = await import("../src/i18n");
const { DEFAULT_PREFERENCES } = await import("../src/shared/preferences");
const { NetworkContext } = await import("../src/ui/network");
const { PreferencesContext } = await import("../src/ui/preferences");
const { Transfer } = await import("../src/ui/screens/Transfer");
const { formatAda, unlocked } = await import("../src/ui/format");

const noop = () => undefined;
/** What a person reads of markup. */
const words = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replace(/\s+/g, " ").trim();
const nothing = { lovelace: "0", tokens: [], utxos: 0 };

/** Send privately's form, from `seedelf` as Home hands it (its unlocked side), one recipient's amount typed. */
function form(seedelf: Parameters<typeof Transfer>[0]["seedelf"], amount: string): string {
  seam.used = false;
  seam.drafts = [{ id: 0, to: "", amount, tokens: {} }];
  const html = renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      { value: "preprod" },
      createElement(
        PreferencesContext.Provider,
        { value: { prefs: DEFAULT_PREFERENCES, loaded: true, set: async () => undefined } },
        createElement(Transfer, { seedelf, onCancel: noop, onSent: noop }),
      ),
    ),
  );
  expect(seam.used, "Transfer's recipients weren't the render's first list").toBe(true);
  return words(html.match(/data-testid="transfer-too-much">(.*?)<\/p>/)?.[1] ?? "");
}

describe("Send privately's line for more than it can pay (chunk 51, l3still#4)", () => {
  it("says what's available where some of the private balance is locked, what's in it otherwise", () => {
    // 100 ₳, 60 ₳ of it locked: the form gets the unlocked 40 ₳, and 50 ₳ is typed.
    const locked = unlocked({ lovelace: "100000000", tokens: [], utxos: 3, seedelfs: [], locked: { ...nothing, lovelace: "60000000", utxos: 1 } });
    const said = form(locked, "50");
    expect(said).toBe(words(t("withdraw.tooMuch", { amount: formatAda("40000000"), available: t("withdraw.available") })));
    expect(said).not.toMatch(/in your private balance/);
    // Nothing locked: the 40 ₳ is all the private balance holds, and the line says so, as it did.
    const whole = form({ lovelace: "40000000", tokens: [], utxos: 2, seedelfs: [], locked: nothing }, "50");
    expect(whole).toBe(words(t("withdraw.tooMuch", { amount: formatAda("40000000"), available: t("withdraw.inPrivate") })));
    expect(whole).toMatch(/^That's more than the 40\s₳ in your private balance\.$/);
  });
});
