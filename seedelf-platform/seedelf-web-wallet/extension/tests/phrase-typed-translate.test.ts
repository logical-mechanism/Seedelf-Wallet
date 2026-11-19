// Chunk 51, docs#1 and still#2. The privacy policy says Chrome's Translate never gets the recovery phrase (its
// Translate line, and the 18 November entry), and privacy.md that the phrase's words are kept out, but only the grid
// that shows them was marked (PhraseGrid.tsx, B9). Typing the phrase, in Restore, Settings' Check recovery phrase and
// Create's confirm step, lists the BIP39 words that start with what's typed, and after three or four letters the list
// is the phrase's own word: page text nothing marked, so a translated page sent it to Google with the rest. So B9
// covers every place the phrase's words show: the grid, each word's box, and the words suggested under it. The boxes'
// "Word 7" labels and the line under a word off the list still translate, as C22 has the rest of the wallet. React's
// server renderer can't focus a box, so the seam starts each box focused (and touched) and the word list loaded.
import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => ({
  /** The start of the BIP39 English list: what useWordlist holds once the worker has answered. */
  LIST: "abandon ability able about above absent absorb abstract absurd abuse access accident".split(" "),
}));

// WordBox's `focused` and `touched` start true, and useWordlist's list starts loaded.
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return {
    ...react,
    useState: (initial?: unknown) =>
      react.useState(initial === false ? true : Array.isArray(initial) && initial.length === 0 ? seam.LIST : initial),
  };
});

const { PhraseInput } = await import("../src/ui/components/PhraseInput");

const EN: Record<string, string> = JSON.parse(
  readFileSync(new URL("../src/i18n/translations/en.json", import.meta.url), "utf8"),
);
const VOID = new Set("area base br col embed hr img input link meta source track wbr".split(" "));

type Read = {
  /** The page's text Translate takes: every text outside an element marked translate="no". */
  translatable: string;
  /** Each suggestion (`<li role="option">`): its text, and whether it or an element around it is marked. */
  options: Array<{ text: string; marked: boolean }>;
  /** Each word's box (`<input>`): whether it or an element around it is marked. */
  boxes: boolean[];
};

/** The markup as Translate reads it. */
function read(markup: string): Read {
  const open: Array<{ tag: string; no: boolean; option?: { text: string; marked: boolean } }> = [];
  const out: Read = { translatable: "", options: [], boxes: [] };
  for (const m of markup.matchAll(/<(\/?)([a-zA-Z0-9]+)([^>]*?)(\/?)>|([^<]+)/g)) {
    const [, closing, tag, attrs = "", selfClosing, text] = m;
    const marked = open.some((e) => e.no);
    if (text !== undefined) {
      if (!marked) out.translatable += text;
      const inside = [...open].reverse().find((e) => e.option);
      if (inside?.option) inside.option.text += text;
      continue;
    }
    const name = tag!.toLowerCase();
    if (closing) {
      while (open.length && open.pop()!.tag !== name);
      continue;
    }
    const no = /\btranslate="no"/.test(attrs);
    if (name === "input") out.boxes.push(no || marked);
    if (selfClosing || VOID.has(name)) continue;
    const entry: (typeof open)[number] = { tag: name, no };
    if (name === "li" && /\brole="option"/.test(attrs)) {
      entry.option = { text: "", marked: no || marked };
      out.options.push(entry.option);
    }
    open.push(entry);
  }
  return out;
}

const noop = () => undefined;
const blank = () => Array<string>(24).fill("");

/** Restore and Settings' Check recovery phrase: a box a word, the first typed to "aba". */
function restore(): Read {
  const words = blank();
  words[0] = "aba";
  return read(renderToStaticMarkup(createElement(PhraseInput, { words, onChange: noop, onCountChange: noop })));
}

/** Create's confirm step: boxes for words 3, 7 and 11, word 3 off the list ("zzzz") and word 7 typed to "abl". */
function confirm(): Read {
  const words = blank();
  words[2] = "zzzz";
  words[6] = "abl";
  const props = { words, onChange: noop, positions: [3, 7, 11], wrong: [] };
  return read(renderToStaticMarkup(createElement(PhraseInput, props)));
}

describe("the recovery phrase as it's typed, under Chrome's Translate (chunk 51, docs#1 and still#2)", () => {
  it("is typed into PhraseInput's boxes on Restore, Create's confirm step and Settings' Check recovery phrase", () => {
    for (const screen of ["Restore.tsx", "Create.tsx", "Settings.tsx"]) {
      const source = readFileSync(new URL(`../src/ui/screens/${screen}`, import.meta.url), "utf8");
      expect(source, screen).toMatch(/<PhraseInput\b/);
    }
  });

  it("Restore and Check recovery phrase: the word suggested under a box is the phrase's own, and is kept out", () => {
    const page = restore();
    // Not vacuous: the list is on the page, and holds the person's own word.
    expect(page.options.map((o) => o.text)).toEqual(["abandon"]);
    expect(page.options.filter((o) => !o.marked)).toEqual([]);
    expect(page.translatable).not.toMatch(/aba/);
  });

  it("Create's confirm step: likewise for its boxes", () => {
    const page = confirm();
    expect(page.options.map((o) => o.text)).toEqual(["able"]);
    expect(page.options.filter((o) => !o.marked)).toEqual([]);
    expect(page.translatable).not.toMatch(/abl/);
  });

  it("each word's box is marked too, on both", () => {
    for (const page of [restore(), confirm()]) {
      expect(page.boxes.length).toBeGreaterThan(0);
      expect(page.boxes.filter((marked) => !marked)).toHaveLength(0);
    }
  });

  it("and the rest still translates: the confirm step's Word labels and the line under a word off the list", () => {
    const { translatable } = confirm();
    for (const n of [3, 7, 11]) {
      expect(translatable).toContain(EN["phrase.wordNumber"]!.replace("{{number}}", String(n)));
    }
    expect(translatable).toContain(EN["phrase.notOnList"]);
  });
});
