// The payment forms and their reviews after chunk 23's second usability
// review: why a disabled Review waits (PY-9), what a refused review's foot
// says while it builds again and once the new one is in (PY-1), a raised
// amount said on its own row (PY-4), and a total that counts the tokens
// leaving with the ADA (PY-5). Rendered as the pages show them.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { amountText } from "../src/ui/components/AdaInput";
import { ReviewWait, waitingFor } from "../src/ui/components/Recipients";
import { TotalRows } from "../src/ui/components/ReviewTotals";
import { RenewedNote, StaleFoot } from "../src/ui/components/StaleReview";

/** A page's text, as a person reads it: no-break spaces kept, since where ₳ goes is what's checked. */
const text = (element: ReactElement) =>
  renderToStaticMarkup(element)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/[ \t\n]+/g, " ")
    .trim();

describe("why Review waits (PY-9)", () => {
  const ready = { to: "ok" as const, amount: "5", tokensPicked: false, tokensOk: true };

  it("names the first thing missing, in the form's own order", () => {
    expect(waitingFor(ready)).toBeUndefined();
    expect(waitingFor({ ...ready, to: "empty" })).toBe("review.why.to");
    expect(waitingFor({ ...ready, to: "empty", emptyTo: "review.why.seedelf" })).toBe("review.why.seedelf");
    expect(waitingFor({ ...ready, to: "bad" })).toBe("review.why.toCheck");
    // Being read: the field's own note says so, and it's over in a moment.
    expect(waitingFor({ ...ready, to: "reading" })).toBeUndefined();
    expect(waitingFor({ ...ready, amount: "" })).toBe("review.why.amount");
    expect(waitingFor({ ...ready, amount: "0" })).toBe("review.why.amount");
    // Kept as typed, and not an amount: Review used to stay on with the number typed over.
    expect(waitingFor({ ...ready, amount: "12a" })).toBe("review.why.amountNumber");
    // A token picked lets the ADA stay empty; its own empty box is what's missing.
    expect(waitingFor({ ...ready, amount: "", tokensPicked: true, tokensOk: false })).toBe("review.why.tokens");
    expect(waitingFor({ ...ready, amount: "", max: true })).toBeUndefined();
  });

  it("says it under the button, naming the recipient when there are several", () => {
    expect(text(createElement(ReviewWait, { reasons: ["review.why.amount"], busy: false }))).toBe("Enter an amount.");
    expect(text(createElement(ReviewWait, { reasons: [undefined, "review.why.amount"], busy: false }))).toBe(
      "Recipient 2: Enter an amount.",
    );
    expect(text(createElement(ReviewWait, { reasons: [undefined], tooMuch: true, busy: false }))).toBe(
      "That's more than there is to send.",
    );
    expect(text(createElement(ReviewWait, { reasons: [undefined], busy: false }))).toBe("");
    expect(text(createElement(ReviewWait, { reasons: ["review.why.amount"], busy: true }))).toBe("");
  });
});

describe("a refused review built again (PY-1)", () => {
  const foot = (busy: boolean) =>
    text(createElement(StaleFoot, { detail: "giveme.my refused it", busy, onAgain: () => undefined }));

  it("says it's building a new review, never that it's sending", () => {
    expect(foot(false)).toContain("Refresh and review again");
    expect(foot(true)).toContain("Building a new review…");
    expect(foot(true)).not.toContain("Sending");
    // The refusal stays on screen while it builds.
    expect(foot(true)).toContain("Nothing was sent.");
  });

  it("says the review is new once it's in", () => {
    expect(text(createElement(RenewedNote, { renewed: true }))).toBe("Review updated just now. Check it again.");
    expect(text(createElement(RenewedNote, { renewed: false }))).toBe("");
  });
});

describe("a review's amounts (PY-4, PY-5, V-7)", () => {
  it("marks an amount raised to the network's least on its own row, and keeps ₳ beside its number", () => {
    expect(amountText("978370", "978370", "500000")).toBe("0.97837 ₳, raised from 0.5 ₳");
    // Asked for nothing (tokens alone): the least, not raised from anything.
    expect(amountText("1170000", "1170000", "0")).toBe("1.17 ₳");
    expect(amountText("5000000", "978370", "5000000")).toBe("5 ₳");
  });

  it("counts the tokens leaving in the total", () => {
    const total = (tokens?: number) => text(createElement(TotalRows, { side: "public", leaving: 5_195_025n, tokens }));
    expect(total()).toBe("Total leaving your public account 5.195025 ₳");
    // The words around the count are the translation's: \s takes the no-break space a sweep of them puts in.
    expect(total(2)).toMatch(/^Total leaving your public account 5\.195025\s₳ and 2 tokens$/);
  });
});
