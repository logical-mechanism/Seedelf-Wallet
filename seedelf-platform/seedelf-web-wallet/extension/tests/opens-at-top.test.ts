// Every screen opens at its top (blind test §9.10). The page is what scrolls and screens swap inside it, so each
// kept the last one's offset: "Review: stop staking" opened at its red button with its title above the view (T13).
// `Screen` resets it whenever it shows a page of its own, which `arrived` decides; the reset itself, and that it
// survives the browser's Back, are the e2e test's to see.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { arrived, Offsets, openAt, Screen } from "../src/ui/components/Screen";

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

// Back to a long list landed at its top, and the reader looked for their place again (pass two of the fix round):
// a page Back leads to opens where it was left, and only that way.
describe("where a screen opens", () => {
  const kept = new Map([["gov-actions\u0000Governance actions", 840]]);

  it("at its top, going forward, even to a page read before", () => {
    expect(openAt("gov-actions\u0000Governance actions", false, kept)).toBe(0);
  });

  it("where it was left, when Back leads to it", () => {
    expect(openAt("gov-actions\u0000Governance actions", true, kept)).toBe(840);
  });

  it("at its top when Back leads to a page it has no place for", () => {
    expect(openAt("settings-title\u0000Settings", true, kept)).toBe(0);
  });
});

// What's kept, as the pages follow each other (`Offsets`, which `useOpensAtTop` drives).
describe("where Back finds a page", () => {
  const list = "gov-actions\u0000Governance actions";
  const action = "gov-action-title\u0000Treasury withdrawal";
  const staking = "staking-title\u0000Staking and governance";
  const voting = "vote-title\u0000Delegate your vote";

  it("where the reader left it, a step or two down", () => {
    const o = new Offsets();
    o.view(false);
    expect(o.screen(staking, false)).toBe(0);
    o.note(300);
    expect(o.screen(list, false)).toBe(0);
    o.note(840);
    expect(o.screen(action, false)).toBe(0);
    o.note(1200);
    expect(o.screen(list, true)).toBe(840);
    expect(o.screen(staking, true)).toBe(300);
  });

  it("at its top when it wasn't shown since Home: a flow opened part-way in, after Home was scrolled", () => {
    const o = new Offsets();
    o.screen(staking, false);
    o.note(300);
    // Back to Home, which is scrolled down to "Delegate your vote": none of it goes under Staking's key.
    o.view(false);
    o.note(900);
    // Voting opens with Staking behind it, and its Back leads there.
    o.screen(voting, false);
    expect(o.screen(staking, true)).toBe(0);
  });

  it("not forgotten when the app's view opens with a page drawn inside it: Settings from the gear", () => {
    const o = new Offsets();
    const settings = "settings-title\u0000Settings";
    o.screen(settings, false);
    o.view(true);
    o.note(1500);
    o.screen("collateral-title\u0000Collateral", false);
    expect(o.screen(settings, true)).toBe(1500);
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

// Settings is about 2,000 px long, and its Back, its only way out, scrolled away with its header (blind test E05).
describe("a long page's header", () => {
  const screen = (headSticky?: boolean) =>
    renderToStaticMarkup(createElement(Screen, { title: "Settings", titleId: "t", headSticky, onBack: () => undefined, children: "Rows" }));

  it("stays in view where it's asked for, and nowhere else", () => {
    expect(screen(true)).toContain('<header class="screen__head screen__head--sticky">');
    expect(screen()).toContain('<header class="screen__head">');
    const css = readFileSync(new URL("../src/ui/styles.css", import.meta.url), "utf8");
    // Under the lock countdown, which keeps to the top too, and says how tall it is while it shows.
    expect(css).toMatch(/\.screen__head--sticky \{\s*position: sticky;\s*top: var\(--lock-countdown-h, 0px\);/);
    const countdown = readFileSync(new URL("../src/ui/components/LockCountdown.tsx", import.meta.url), "utf8");
    expect(countdown).toContain('setProperty("--lock-countdown-h"');
  });

  it("on Settings' own page", () => {
    const settings = readFileSync(new URL("../src/ui/screens/Settings.tsx", import.meta.url), "utf8");
    expect(settings).toMatch(/titleId="settings-title" onBack=\{onBack\} headSticky>/);
  });
});
