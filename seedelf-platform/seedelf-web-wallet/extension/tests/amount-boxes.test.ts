// An amount box shows its own figure: Max's "Max, up to …" was 3 px past its box at the side panel's width, and a
// token's box after Max cut "1,234,567,890,123" to "1,234,567,8" with nothing to say so (chunk 51, gap-g10#4). Max's
// text goes a step smaller once it's long and is whole in the box's title; a token's box takes the row's room
// (styles.css `.token-amount__row input`), which only a look at the page shows.
import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AdaInput } from "../src/ui/components/AdaInput";

const box = (shown: string) =>
  renderToStaticMarkup(createElement(AdaInput, { id: "amount", value: "", onChange: () => {}, disabled: true, shown }));

describe("Max's amount box (chunk 51, gap-g10#4)", () => {
  it("is a step smaller once it's long, and whole in its title", () => {
    const long = box("Max, up to 10,408.014036");
    expect(long).toContain('class="amount-box__shown amount-box__shown--long"');
    expect(long).toContain('title="Max, up to 10,408.014036"');
    // A short one stays the size it was.
    expect(box("Max, up to 5")).toContain('class="amount-box__shown"');
  });

  it("is sized so in the stylesheet, as a token's box takes its row's room", () => {
    const css = readFileSync(new URL("../src/ui/styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.amount-box input\.amount-box__shown--long \{\s*font-size: var\(--text-sm\);/);
    const row = css.match(/\.token-amount__row input \{([^}]*)\}/)![1]!;
    expect(row).toContain("flex: 1 1 9em;");
    expect(row).not.toMatch(/(^|\s)width: 9em;/);
  });
});
