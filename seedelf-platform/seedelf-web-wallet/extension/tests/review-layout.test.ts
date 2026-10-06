// Pass two of the blind task test's fix round, on reviews, returns and the UTxOs list. A review with several
// recipients puts what leaves first (its totals sat under the Send kept in view); a return through Lovejoin says what
// bringing each box back costs; the UTxOs list says what's on its way back to it (T08). Rendered as the pages show them.
import { readFileSync } from "node:fs";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import type { Incoming, SessionBackSummary } from "../src/shared/rpc";
import { boxesBackCost, LovejoinRows } from "../src/ui/components/LovejoinReturn";
import { ReviewRecipients } from "../src/ui/components/Recipients";
import { isShortenedId, Row } from "../src/ui/components/ReviewRows";
import { RewardsRow, TotalRows } from "../src/ui/components/ReviewTotals";
import { IncomingHere } from "../src/ui/screens/Utxos";
import { PreferencesContext } from "../src/ui/preferences";
import { BOX_BACK_ESTIMATE } from "../src/ui/swap";

/** A page's text, as a person reads it: no-break spaces kept, since where ₳ goes is what's checked. */
const text = (element: ReactElement) =>
  renderToStaticMarkup(element)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/[ \t\n]+/g, " ")
    .trim();

describe("a review's recipients", () => {
  const paid = (lovelace: string) => ({ lovelace, minimum: null, tokens: [] });
  const review = (payments: ReturnType<typeof paid>[]) =>
    text(
      createElement(ReviewRecipients, {
        testId: "send-review",
        payments,
        rows: (i: number) => createElement(Row, { label: "To", value: `addr${i + 1}` }),
        children: createElement(TotalRows, { side: "public", leaving: 8_200_000n, before: "100000000" }),
      }),
    );

  it("with several, what leaves comes before each recipient's box", () => {
    const shown = review([paid("3000000"), paid("5000000")]);
    expect(shown.indexOf("Total leaving your public account")).toBeLessThan(shown.indexOf("Recipient 1"));
    expect(shown.indexOf("Public account after")).toBeLessThan(shown.indexOf("Recipient 1"));
    expect(shown.indexOf("Recipient 1")).toBeLessThan(shown.indexOf("Recipient 2"));
    expect(shown).toMatch(/^To all recipients 8\s₳/);
  });

  it("with one, as every review has read: where it goes, then the totals", () => {
    const shown = review([paid("8000000")]);
    expect(shown.indexOf("addr1")).toBeLessThan(shown.indexOf("Total leaving your public account"));
    expect(shown).not.toContain("Recipient 1");
  });
});

describe("a return through Lovejoin", () => {
  const back = (boxes: number): SessionBackSummary => ({
    network: "preprod",
    index: 0,
    txHash: "aa",
    fee: "1500000",
    lovelace: "7000000",
    tokens: [],
    depositOutputs: 1,
    inputs: 2,
    lovejoin: { boxes, depth: 2, mixes: 8, fees: "1500000", txs: 10, delay: "1-6", entry: "bb" },
  });

  it("says what bringing the boxes back costs, about, from the figure the worker uses", () => {
    expect(boxesBackCost(2)).toBe(2n * BOX_BACK_ESTIMATE);
    expect(text(createElement(LovejoinRows, { back: back(2) }))).toMatch(/Bringing them back, about 0\.6 ₳/);
    expect(text(createElement(LovejoinRows, { back: back(1) }))).toMatch(/Bringing it back, about 0\.3 ₳/);
  });

  it("and nothing when it comes back directly", () => {
    expect(text(createElement(LovejoinRows, { back: { ...back(1), lovejoin: undefined } }))).toBe("");
  });
});

describe("the UTxOs list while a transaction is on its way (T08)", () => {
  /** As the page shows it once the settings are read, its amounts shown or hidden as they say. */
  const shownWith = (incoming?: Incoming, hideBalances = false) =>
    text(
      createElement(
        PreferencesContext.Provider,
        { value: { prefs: { ...DEFAULT_PREFERENCES, hideBalances }, loaded: true, set: async () => undefined } },
        createElement(IncomingHere, { incoming }),
      ),
    );

  it("says what's coming back to it, and that what was spent is gone", () => {
    const shown = shownWith({ lovelace: "35300614", tokens: [], utxos: 1 });
    expect(shown).toContain("35.300614\u00a0₳ on its way here, in 1 UTxO, listed once it's in a block.");
    expect(shown).toContain("What was spent from here is already off the list.");
  });

  it("names the tokens with the ADA, and the UTxOs by their number", () => {
    const token = { policyId: "ab", assetName: "cd", quantity: "5" };
    const shown = shownWith({ lovelace: "2000000", tokens: [token as never, token as never], utxos: 2 });
    expect(shown).toContain("2\u00a0₳ and 2\u00a0tokens on its way here, in 2 UTxOs, listed once they're in a block");
  });

  it("keeps the amount hidden when the balances are", () => {
    expect(shownWith({ lovelace: "35300614", tokens: [], utxos: 1 }, true)).not.toContain("35.300614");
  });

  it("says nothing with nothing on its way", () => {
    expect(shownWith()).toBe("");
    expect(shownWith({ lovelace: "0", tokens: [], utxos: 0 })).toBe("");
  });
});

// What the visual review of pass two found at 360×640: "3.174697" over "₳" on every review's total, the rewards row's
// sentence in three right-aligned lines, and an on Max that greyed under the pointer.
describe("a review's rows as they wrap", () => {
  const css = readFileSync(new URL("../src/ui/styles.css", import.meta.url), "utf8");
  /** A rule's declarations, by its exact selector. */
  const rule = (selector: string) => {
    const at = css.indexOf(`\n${selector} {`);
    expect(at, selector).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf("}", at));
  };

  it("keeps a value's words whole, so ₳ stays with its amount, and lets the label wrap first", () => {
    const value = rule(".review__row dd");
    expect(value).toContain("overflow-wrap: break-word;");
    expect(value).not.toContain("anywhere");
    expect(value).toContain("min-width: 0;");
    // Up to 65% of the row, the label taking the rest: a label held at 40% split short values beside one word.
    expect(value).toContain("max-width: 65%;");
    expect(rule(".review__row dt")).toContain("flex: 1 1 0;");
    expect(rule(".review__row--id dd")).toContain("white-space: nowrap;");
    // An address or a Seedelf's name still breaks anywhere, under its label.
    expect(css).toMatch(/\.review__row--whole\.review__row--strong dd \{[^}]*word-break: break-all;/);
  });

  it("gives the rewards row its amount as the value, and what it means across the row under it", () => {
    const html = renderToStaticMarkup(createElement(RewardsRow, { withdrawal: "57475311" }));
    expect(html).toContain("<dd>57.475311\u00a0₳</dd>");
    expect(html).toContain('<dd class="note review__hint">Already in your public account&#x27;s balance: nothing extra leaves.</dd>');
    expect(renderToStaticMarkup(createElement(RewardsRow, { withdrawal: "0" }))).toBe("");
  });

  it("keeps an on Max on under the pointer", () => {
    expect(rule('.chip[aria-pressed="true"]:not(:disabled):hover')).toContain("background: var(--accent-hover);");
  });
});

describe("a shortened ID in a review's row", () => {
  it("is one word with its \u2026, kept on one line", () => {
    for (const id of ["drep1y2e20afmrjh\u20262egjc8", "addr_test1qr3xfa\u2026cs00h9ax", "53fbef38\u2026#0"]) {
      expect(isShortenedId(id), id).toBe(true);
      expect(renderToStaticMarkup(createElement(Row, { label: "Account", value: id }))).toContain('class="review__row review__row--id"');
    }
  });

  it("but not a sentence, an amount, or a whole address", () => {
    for (const v of ["Info action \u00b7 53fbef38\u2026#0", "Sending 4 of 10\u2026", "3.174697\u00a0\u20b3", "No"]) expect(isShortenedId(v), v).toBe(false);
    const whole = renderToStaticMarkup(createElement(Row, { label: "To", value: "addr\u2026xyz", whole: true }));
    expect(whole).not.toContain("review__row--id");
  });
});
