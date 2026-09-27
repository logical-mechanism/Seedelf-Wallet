// Smaller safety points on the wallet's screens, rendered as the page shows
// them: a banner's detail line has a style of its own, and the To field asks
// for the network's own addresses.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DestinationField } from "../src/ui/components/Destination";
import { TxBanner } from "../src/ui/components/TxBanner";
import { NetworkContext } from "../src/ui/network";

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

describe("the To field", () => {
  it("asks for the network's own addresses: addr1… on mainnet, addr_test1… on preprod (launch review #58)", () => {
    const field = (network: "mainnet" | "preprod", seedelfs: boolean) =>
      renderToStaticMarkup(
        createElement(
          NetworkContext.Provider,
          { value: network },
          createElement(DestinationField, { id: "to", value: "", onChange: () => undefined, read: { state: "idle" }, seedelfs }),
        ),
      ).match(/placeholder="([^"]*)"/)![1];
    expect(field("mainnet", false)).toBe("addr1… or $handle");
    expect(field("mainnet", true)).toBe("addr1…, $handle or 5eed0e1f…");
    expect(field("preprod", false)).toBe("addr_test1… or $handle");
  });
});
