// A private session's funding review (the connect window) and its Top up
// review list each token that goes with its amount and name, as the other
// reviews do, never just how many (independent review L37).
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PaidRows } from "../src/ui/components/PaidRows";
import { ReviewRows } from "../src/ui/components/ReviewRows";
import { NetworkContext } from "../src/ui/network";

const hex = (text: string) => Buffer.from(text, "utf8").toString("hex");
const STRANGER = "e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9";
const TUSDM = { policyId: "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde", assetName: "0014df10745553444d" };

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const render = (paid: Parameters<typeof PaidRows>[0]["paid"]) =>
  renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      { value: "preprod" },
      createElement(ReviewRows, { testId: "review", children: createElement(PaidRows, { label: "For the site", paid }) }),
    ),
  );

describe("a payment's rows in a review", () => {
  it("give its ADA, then each token's amount in its units and its name", () => {
    const page = text(
      render({
        lovelace: "5000000",
        tokens: [
          { ...TUSDM, quantity: "1000000000" },
          { policyId: STRANGER, assetName: hex("FOO"), quantity: "7" },
        ],
      }),
    );
    expect(page).toMatch(/For the site\s+5 ₳/);
    expect(page).toContain("1,000 tUSDM");
    expect(page).toMatch(/7 FOO Not on the wallet's list/);
    expect(page).not.toContain("2 tokens");
  });

  it("are the ADA alone when no token goes", () => {
    const page = text(render({ lovelace: "15000000", tokens: [] }));
    expect(page.trim()).toBe("For the site 15 ₳");
  });

  it("are what the funding and Top up reviews show, not a count of tokens", () => {
    for (const screen of ["DappApprovals", "SiteSessions"]) {
      const source = readFileSync(new URL(`../src/ui/screens/${screen}.tsx`, import.meta.url), "utf8");
      expect(source).toContain("<PaidRows");
      expect(source).not.toMatch(/plural\(\w+\??\.tokens\.length, "token"\)/);
    }
  });
});
