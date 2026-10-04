// Sentences and lists put together the way each language does it. English and
// Spanish set a space between two sentences; Japanese sets none, and its list
// comma is 、. Both come from the bundles, so these hold the bundles to it too.
import { afterEach, describe, expect, it } from "vitest";

import { i18n, joinList, joinSentences, sentenceGap } from "../src/i18n/core";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("joinSentences", () => {
  it("puts a space between English sentences, and leaves the empty ones out", () => {
    expect(sentenceGap()).toBe(" ");
    expect(joinSentences(["One.", undefined, "", false, null, "Two."])).toBe("One. Two.");
  });

  it("keeps the space in Spanish", async () => {
    await i18n.changeLanguage("es");
    expect(joinSentences(["Uno.", "Dos."])).toBe("Uno. Dos.");
  });

  it("puts nothing between Japanese sentences", async () => {
    await i18n.changeLanguage("ja");
    expect(sentenceGap()).toBe("");
    expect(joinSentences(["一つ。", "二つ。"])).toBe("一つ。二つ。");
  });
});

describe("joinList", () => {
  it("uses each language's own comma", async () => {
    expect(joinList(["a", "b", "c"])).toBe("a, b, c");
    await i18n.changeLanguage("ja");
    expect(joinList(["a", "b", "c"])).toBe("a、b、c");
  });
});
