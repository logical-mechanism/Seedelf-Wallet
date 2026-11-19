// With Chrome's Translate on, in a language the wallet doesn't speak, Chrome sent the recovery phrase's words to
// Google with the rest of the page and showed them translated: a backup copied from Settings' Show recovery phrase,
// which has no confirm step, was then the wrong words, and the privacy policy's own line that the phrase is never sent
// anywhere was false. The phrase's words are marked not to translate, wherever they show: the grid here, and the boxes
// it's typed into with the words suggested under them (phrase-typed-translate.test.ts; chunk 51, docs#1 and still#2).
// The rest of the wallet translates, disclosed, as the owner's call of 2026-10-06 (C22) has it. B9 (a), the owner,
// 2026-11-18, reverses that call for the phrase's words only (chunk 51, the recovery phrase and Chrome Translate).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PhraseGrid } from "../src/ui/components/PhraseGrid";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORDS = Array.from({ length: 24 }, (_, i) => `word${i + 1}`);

/** Every file under `dir`, by its path from the extension's folder. */
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [relative(ROOT, path)];
  });

describe("the recovery phrase under Chrome's Translate (chunk 51, B9)", () => {
  it("is kept out: the grid of its words is marked not to translate, shown or dotted out", () => {
    for (const revealed of [true, false]) {
      const html = renderToStaticMarkup(createElement(PhraseGrid, { words: WORDS, revealed }));
      expect(html).toMatch(/^<ol [^>]*translate="no"/);
      expect(html.match(/<ol [^>]*>/g)).toHaveLength(1);
    }
  });

  it("is the grid both places that show the words use: Create's first step and Settings' Show recovery phrase", () => {
    for (const screen of ["src/ui/screens/Create.tsx", "src/ui/screens/Settings.tsx"]) {
      expect(readFileSync(join(ROOT, screen), "utf8"), screen).toMatch(/<PhraseGrid words=\{/);
    }
  });

  it("and the rest of the wallet translates: only the phrase's grid and boxes are marked, never the page", () => {
    const marked = [...files(join(ROOT, "src")), "index.html"]
      .filter((path) => /\.(tsx?|html)$/.test(path))
      .filter((path) => /\btranslate=|notranslate/.test(readFileSync(join(ROOT, path), "utf8")));
    expect(marked).toEqual(["src/ui/components/PhraseGrid.tsx", "src/ui/components/PhraseInput.tsx"]);
    // In PhraseInput, on each box and on the words suggested under it, never on the list of boxes: that would keep the
    // confirm step's "Word 7" labels, and the line under a word off the list, in English.
    const input = readFileSync(join(ROOT, "src/ui/components/PhraseInput.tsx"), "utf8");
    expect(input.match(/translate="no"/g)).toHaveLength(2);
    expect(input).toMatch(/<ul\s+className="suggestions"[^>]*translate="no"/);
    expect(input).not.toMatch(/<ol [^>]*translate=/);
  });
});
