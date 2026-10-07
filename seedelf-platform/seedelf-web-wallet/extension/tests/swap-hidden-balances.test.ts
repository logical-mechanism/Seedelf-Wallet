// Hide balances on the swap form (release review C23, HM-9): what the private balance holds of the side received,
// the too-much line, and the token picker's amounts are masked as the side paid already was. What's typed isn't.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The form as a person leaves it once they've picked what to receive and typed more than they hold. A page rendered
// once can't be typed into, so NewSwap's first states (what's paid, what's received, the amount) are set here: the
// first `useState` given the ADA side starts them.
const form = vi.hoisted(() => ({ seed: undefined as unknown[] | undefined, left: [] as unknown[] }));
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return {
    ...react,
    useState: (initial?: unknown) => {
      const [value, set] = react.useState(initial);
      if (form.seed && (initial as { id?: unknown } | undefined)?.id === "lovelace") {
        form.left = form.seed;
        form.seed = undefined;
      }
      return form.left.length ? [form.left.shift(), set] : [value, set];
    },
  };
});

const { DEFAULT_PREFERENCES } = await import("../src/shared/preferences");
const { NetworkContext } = await import("../src/ui/network");
const { PreferencesContext } = await import("../src/ui/preferences");
const { NewSwap, TokenSelect } = await import("../src/ui/screens/Swaps");

const TUSDM = { policyId: "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde", assetName: "0014df10745553444d" };
const seedelf = {
  lovelace: "28000000",
  utxos: 2,
  seedelfs: [],
  locked: { lovelace: "0", tokens: [], utxos: 0 },
  tokens: [{ ...TUSDM, quantity: "1234560000", decimals: 6, fingerprint: "" }],
};
const noop = () => undefined;

/** `element`'s markup, with balances hidden or not. */
const markup = (element: ReactElement, hidden: boolean) =>
  renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      { value: "preprod" },
      createElement(
        PreferencesContext.Provider,
        { value: { prefs: { ...DEFAULT_PREFERENCES, hideBalances: hidden }, loaded: true, set: async () => undefined } },
        element,
      ),
    ),
  );

/** What a person reads of it. */
const words = (html: string) => html.replace(/<[^>]+>/g, " ").replaceAll("&#x27;", "'").replace(/\s+/g, " ");
const read = (element: ReactElement, hidden: boolean) => words(markup(element, hidden));

/** The form paying 100 ₳ for tUSDM, from 28 ₳ and 1,234.56 tUSDM. */
function filledIn(hidden: boolean) {
  const ada = { id: "lovelace", side: { label: "₳", decimals: 6 } };
  const tusdm = { id: TUSDM.policyId + TUSDM.assetName, side: { label: "tUSDM", decimals: 6 } };
  form.seed = [ada, tusdm, "100"];
  const html = markup(createElement(NewSwap, { seedelf, onCancel: noop, onStarted: noop }), hidden);
  expect(form.seed, "NewSwap's states weren't set: its first three changed").toBeUndefined();
  // What's typed is still shown: it's read before it's sent.
  expect(html).toContain('value="100"');
  return words(html);
}

describe("the swap form with balances hidden", () => {
  it("masks what's held of the side received, and the too-much line's balance", () => {
    const shown = filledIn(false);
    expect(shown).toContain("That's more than the 28 ₳ in your private balance.");
    expect(shown).toContain("1,234.56");
    const hidden = filledIn(true);
    expect(hidden).toContain("That's more than the •••• ₳ in your private balance.");
    expect(hidden).not.toContain("1,234.56");
    expect(hidden).not.toMatch(/\b28\b/);
  });

  it("masks what's held in the token picker", () => {
    for (const which of ["pay", "get"] as const) {
      const picker = createElement(TokenSelect, { which, seedelf, onPick: noop, onClose: noop });
      expect(read(picker, false), which).toContain("1,234.56");
      const hidden = read(picker, true);
      expect(hidden, which).not.toContain("1,234.56");
      expect(hidden, which).not.toMatch(/\b28\b/);
      expect(hidden, which).toContain("••••");
    }
  });
});
