// Every screen opens at its top (blind test §9.10). The page is what scrolls and screens swap inside it, so each
// kept the last one's offset: "Review: stop staking" opened at its red button with its title above the view (T13).
// `Screen` resets it whenever it shows a page of its own, which `arrived` decides; the reset itself, and that it
// survives the browser's Back, are the e2e test's to see.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { arrived, Screen } from "../src/ui/components/Screen";

/** A `Screen`'s page as it keys it: the title's id, then the title. */
const page = (titleId: string, title: string, language = "en") => ({ page: `${titleId}\u0000${title}`, language });

describe("when a screen opens at its top", () => {
  it("on its first showing", () => {
    expect(arrived(undefined, page("staking-review-title", "Review: stop staking"))).toBe(true);
  });

  it("when it turns into another page: a form into its review, one step into the next", () => {
    expect(arrived(page("send-title", "Send"), page("send-review", "Review the payment"))).toBe(true);
    // Create keeps one id for its three steps, so the title tells them apart.
    expect(arrived(page("create-title", "Your recovery phrase"), page("create-title", "Confirm your phrase"))).toBe(true);
  });

  it("not while it stays the same page, as it draws again", () => {
    const review = page("staking-review-title", "Review: stop staking");
    expect(arrived(review, { ...review })).toBe(false);
  });

  it("not when the language changes under the reader, which renames the page in place", () => {
    const english = page("staking-review-title", "Review: stop staking");
    expect(arrived(english, page("staking-review-title", "Revisión: dejar el staking", "es"))).toBe(false);
  });
});

// At 360×480 the send review's Send, kept in view, sat over "Total leaving …" and "… after" (blind test T04). In a
// short window a review's foot follows its rows; every other screen keeps its foot, an error in it among them, in view.
describe("a review's foot in a short window", () => {
  const screen = (review?: boolean) =>
    renderToStaticMarkup(createElement(Screen, { title: "Review the payment", titleId: "t", review, foot: "Send", children: "Rows" }));

  it("is marked on a review only", () => {
    expect(screen(true)).toMatch(/^<section class="screen screen--review"/);
    expect(screen()).toMatch(/^<section class="screen"/);
  });

  it("follows the rows by that mark, not by what the body holds", () => {
    const css = readFileSync(new URL("../src/ui/styles.css", import.meta.url), "utf8");
    const rule = css.slice(css.indexOf("@media (max-height: 600px)"));
    expect(rule).toMatch(/^@media \(max-height: 600px\) \{\s*\.screen--review > \.screen__foot \{\s*position: static;/);
    expect(css).not.toContain(":has(> .screen__body .review)");
  });
});
