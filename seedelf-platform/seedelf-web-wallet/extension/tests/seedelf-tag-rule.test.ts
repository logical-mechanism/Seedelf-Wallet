// Chunk 51, gap-g8#1: Create Seedelf refuses a tag outside printable ASCII, which the deployed policy takes.
//
// The deployed policy (5b82530: validators/seedelf.ak, lib/token_name.ak) reads its redeemer as any ByteArray, and the
// kernel-checked Seedelf.Every.policy_accepts_iff puts no rule on the tag's bytes. The owner kept the wallet's rule
// (2026-11-18, B1 = (b)): it was decided with them in chunk 8, so a tag reads back as typed, since Seedelf Wallet
// shows a tag's printable-ASCII characters alone (chain.ts `seedelfLabel`). What changed is the words: the form's
// rule and its refusal said a tag can't hold such a character, as if the chain couldn't. They say now that it's
// Seedelf Wallet that can't show one, in every language the wallet speaks.
import { afterEach, describe, expect, it } from "vitest";

import { i18n, t } from "../src/i18n/core";
import { LABEL_MAX, labelProblem } from "../src/shared/label";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("chunk 51, gap-g8#1: a tag outside printable ASCII", () => {
  it("is still refused, by the wallet's rule the owner kept", () => {
    expect(labelProblem("Jose")).toBeUndefined();
    expect(labelProblem("José")).toBeDefined();
    expect(labelProblem("さくら")).toBeDefined();
    expect(labelProblem("tab\there")).toBeDefined();
  });

  it("is refused as one Seedelf Wallet can't show, not one a tag can't hold", () => {
    expect(labelProblem("José")).toBe(
      "Seedelf Wallet can't show “é” in a tag. Use plain letters (no accents), digits, spaces and punctuation.",
    );
    expect(t("mint.tagRules", { max: LABEL_MAX })).toBe(". Up to 15 plain characters, no accents, so Seedelf Wallet shows the tag as typed.");
  });

  it.each(["es", "ja"])("in %s too: the wallet is the one named, and the character", async (language) => {
    await i18n.changeLanguage(language);
    const refused = labelProblem("José")!;
    expect(refused).toContain("Seedelf Wallet");
    expect(refused).toContain("é");
    expect(t("mint.tagRules", { max: LABEL_MAX })).toContain("Seedelf Wallet");
    expect(t("mint.tagRules", { max: LABEL_MAX })).toContain("15");
  });
});
