// Settings' sections, rendered as the page renders them: Lovejoin's, on each
// network it's on, with what a mix costs there and that it has had no
// third-party audit.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

let Settings: typeof import("../src/ui/screens/Settings");

beforeAll(async () => {
  // The page's view (ui/view.ts) is read from its URL when the module loads.
  vi.stubGlobal("location", { search: "?view=tab", hash: "" });
  Settings = await import("../src/ui/screens/Settings");
});

/** The text a person reads, without the markup. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/&#x27;/g, "'");

describe("Settings' Lovejoin section", () => {
  it("prices each depth at what a mix measured on that network", () => {
    expect([1, 2, 3].map((d) => Settings.depthCost("preprod", d as 1 | 2 | 3))).toEqual([
      "1 mix, about 0.9 ₳",
      "4 mixes, about 3.5 ₳",
      "13 mixes, about 11.4 ₳",
    ]);
    expect([1, 2, 3].map((d) => Settings.depthCost("mainnet", d as 1 | 2 | 3))).toEqual([
      "1 mix, about 0.8 ₳",
      "4 mixes, about 3.3 ₳",
      "13 mixes, about 10.7 ₳",
    ]);
  });

  it("says on both networks that Lovejoin has had no third-party audit, and on mainnet that it waits for its pool's floor", () => {
    const mainnet = text(renderToStaticMarkup(createElement(Settings.LovejoinSettings, { network: "mainnet" })));
    const preprod = text(renderToStaticMarkup(createElement(Settings.LovejoinSettings, { network: "preprod" })));
    for (const shown of [mainnet, preprod]) {
      expect(shown).toContain("Lovejoin hasn't had a third-party audit");
      expect(shown).not.toMatch(/\baudited\b/);
    }
    expect(mainnet).toContain("The wallet mixes only once Lovejoin's pool holds 30 boxes that aren't yours");
    expect(mainnet).toContain("about 3.3 ₳");
    expect(preprod).not.toContain("pool holds");
    expect(preprod).toContain("about 3.5 ₳");
  });
});
