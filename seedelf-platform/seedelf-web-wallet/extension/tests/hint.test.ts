// An explanation behind an icon (components/Hint.tsx), as chunk 23 put a
// screen's, a section's and a field's paragraphs behind one: the text is the
// icon's title, so hovering shows it and a screen reader reads it, and it's on
// the page only once asked for. The screen stays labelled by its title alone.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Hinted } from "../src/ui/components/Hint";
import { Screen } from "../src/ui/components/Screen";

const WORDS = "Collateral is 5 ₳ of your public account set aside.";

describe("a screen's explanation", () => {
  it("sits behind an icon beside the title, outside the heading, and isn't on the page until asked for", () => {
    const html = renderToStaticMarkup(
      createElement(Screen, { title: "Collateral", titleId: "t", hint: WORDS, hintTestId: "note", children: "Body" }),
    );
    expect(html).toContain(`<h1 id="t" class="screen__title">Collateral</h1>`);
    expect(html).toMatch(/<button type="button" class="hint" title="Collateral is 5 ₳[^"]*" aria-label="What this means" aria-expanded="false" data-testid="note-hint">/);
    expect(html).not.toContain('data-testid="note"');
    expect(html).not.toContain("aria-controls");
  });

  it("leaves a screen without one as it was", () => {
    const html = renderToStaticMarkup(createElement(Screen, { title: "Collateral", titleId: "t", children: "Body" }));
    expect(html).not.toContain("screen__title-row");
    expect(html).not.toContain('class="hint"');
  });
});

describe("a heading's or a label's explanation", () => {
  it("puts the icon beside it, and the text nowhere yet", () => {
    const html = renderToStaticMarkup(createElement(Hinted, { text: WORDS, testId: "x", children: createElement("h2", null, "Staking") }));
    expect(html).toMatch(/^<div class="hinted"><h2>Staking<\/h2><button type="button" class="hint" title="Collateral is 5 ₳/);
    expect(html).toContain('data-testid="x-hint"');
    expect(html).not.toContain('data-testid="x"');
  });
});
