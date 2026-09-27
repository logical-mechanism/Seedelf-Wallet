// Smaller safety points on the wallet's screens, rendered as the page shows
// them: a banner's detail line has a style of its own.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TxBanner } from "../src/ui/components/TxBanner";

describe("a transaction's banner", () => {
  it("gives what it means a line of its own, quieter than the title", () => {
    const html = renderToStaticMarkup(
      createElement(TxBanner, {
        state: "waiting",
        title: "Payment may have gone through",
        detail: "Koios didn't answer.",
        network: "preprod",
        txHash: "ab".repeat(32),
        testId: "pending-tx",
      }),
    );
    expect(html).toContain('<span class="tx-banner__detail" data-testid="pending-tx-detail">Koios didn&#x27;t answer.</span>');
  });
});
