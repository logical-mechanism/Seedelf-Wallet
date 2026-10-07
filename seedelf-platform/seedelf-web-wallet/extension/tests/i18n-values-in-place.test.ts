// A value put in a sentence stays in its own slot (release review C29). i18next fills `{{x}}` by replacing the first
// copy of that text in the sentence, and a value put in before it can carry one: a token named "ADA {{real}}" took
// the wallet's own "ADA" into its name, and left the clause that says it isn't ADA with no object. Anyone can name a
// token, and a site picks its own title, so `t()` (i18n/core.ts) keeps a value with a brace out of i18next's reach.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { t } from "../src/i18n";
import { i18n } from "../src/i18n/core";
import { Site } from "../src/ui/screens/DappApprovals";
import { tokenAmountText, tokenMark, tokenText } from "../src/ui/tokens";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

const STRANGER = "e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9";
const named = (name: string) => ({ policyId: STRANGER, assetName: Buffer.from(name, "utf8").toString("hex") });

describe("a value with a placeholder's text in it", () => {
  it("never takes a later value out of its slot", () => {
    expect(t("tokens.mark.posesAs", { own: "ADA {{real}}", real: "ADA" })).toBe(
      "not on the wallet's list: it calls itself ADA {{real}}, but it isn't ADA",
    );
    expect(t("tokens.withMark", { amount: "1 {{mark}}", mark: "listed" })).toBe("1 {{mark}} (listed)");
    // Unescaped, a stray brace, a replacement pattern, or the stand-in t() uses itself: each comes back as it went in.
    for (const own of ["{{- real}}", "{", "x{", "{{", "{$&}", "\uFDD00\uFDD0", "{{real}}\uFDD01\uFDD0"]) {
      const said = t("tokens.mark.posesAs", { own, real: "ADA" });
      expect(said, own).toBe(`not on the wallet's list: it calls itself ${own}, but it isn't ADA`);
    }
  });

  it("leaves what isn't a value as it was: a plural's count, and a language asked for", async () => {
    expect(t("tokens.count", { count: 1 })).toBe("1 token");
    await i18n.changeLanguage("ja");
    expect(t("tokens.mark.posesAs", { own: "{{real}}", real: "ADA", lng: "en" })).toBe(
      "not on the wallet's list: it calls itself {{real}}, but it isn't ADA",
    );
  });

  for (const code of ["en", "es", "ja"] as const) {
    it(`keeps a token named "ADA {{real}}" from moving the wallet's "ADA" into its name, in ${code}`, async () => {
      await i18n.changeLanguage(code);
      const text = tokenText("preprod", named("ADA {{real}}"));
      expect(text).toMatchObject({ posesAs: "ADA", own: "ADA {{real}}" });
      const mark = tokenMark(text)!;
      expect(mark).toBe(t("tokens.mark.posesAs", { own: "ADA {{real}}", real: "ADA" }));
      // Its own name once, the wallet's "ADA" at the end, where the sentence puts it.
      expect(mark.split("{{real}}")).toHaveLength(2);
      expect(mark).not.toContain("ADA ADA");
      expect(mark).toMatch(code === "ja" ? /ADA ではありません$/ : /ADA$/);
    });
  }

  it("keeps a mark in its brackets after a name that carries {{mark}}", () => {
    const token = named("SNEK {{mark}}");
    const text = tokenText("preprod", token);
    expect(tokenAmountText("preprod", { ...token, quantity: "1000" })).toBe(
      `1,000 SNEK {{mark}} (not on the wallet's list, ${text.id})`,
    );
  });

  it("keeps a site's own title before its origin in a signing window", () => {
    const html = renderToStaticMarkup(createElement(Site, { origin: "https://evil.example", title: "{{origin}}" }));
    expect(html).toContain("<strong>evil.example</strong>");
    expect(html).toContain("{{origin}} · https://evil.example");
  });
});
