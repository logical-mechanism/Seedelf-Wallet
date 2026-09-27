// Smaller safety points on the wallet's screens, rendered as the page shows
// them: a banner's detail line has a style of its own, the To field asks for
// the network's own addresses, and Max and the UTxOs screen say what no
// payment takes.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DestinationField } from "../src/ui/components/Destination";
import { LeftOutNote } from "../src/ui/components/LeftOut";
import { TxBanner } from "../src/ui/components/TxBanner";
import { NetworkContext } from "../src/ui/network";
import { UtxoDetails, utxoTag } from "../src/ui/screens/Utxos";

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

describe("Max's review", () => {
  it("lists each UTxO it left out, and why (launch review H6, #12)", () => {
    const html = renderToStaticMarkup(
      createElement(LeftOutNote, {
        testId: "send-left-out",
        leftOut: [
          { txHash: "a1".repeat(32), txIndex: 0, reason: "tokens" },
          { txHash: "b2".repeat(32), txIndex: 3, reason: "script" },
        ],
      }),
    );
    const text = html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");
    expect(text).toContain("Max leaves 2 UTxOs where they are:");
    expect(text).toContain(`${"a1".repeat(4)}…a1a1#0 comes with a later payment`);
    expect(text).toContain(`${"b2".repeat(4)}…b2b2#3 holds a reference script the wallet can't spend`);
    expect(text).toContain("would add up to more with the rest than one output can hold");
    expect(renderToStaticMarkup(createElement(LeftOutNote, { testId: "x", leftOut: [] }))).toBe("");
  });
});

describe("the UTxOs screen", () => {
  const utxo = { txHash: "c3".repeat(32), index: 1, lovelace: "3000000", tokens: [], locked: false };
  it("marks a UTxO no payment can take, and says why on each side", () => {
    expect(utxoTag({ ...utxo, unspendable: "script" })).toBe("Can't spend");
    expect(utxoTag({ ...utxo, locked: true })).toBe("Locked");
    const details = (of: "seedelf" | "cardano") =>
      renderToStaticMarkup(
        createElement(UtxoDetails, { of, utxo: { ...utxo, unspendable: "script" }, busy: false, onLock: () => undefined, onClose: () => undefined }),
      );
    const priv = details("seedelf");
    expect(priv).toContain('data-testid="utxo-unspendable"');
    expect(priv).toContain("it isn&#x27;t counted in your private balance");
    // No Lock for it: there's nothing to keep it out of.
    expect(priv).not.toContain(">Lock<");
    expect(details("cardano")).toContain("Koios doesn&#x27;t give the wallet");
  });
});
