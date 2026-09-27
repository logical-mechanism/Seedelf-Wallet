// What the dApp screens and Home say now that the worker says more (launch
// review stage 3): a payment that may have gone through, Lovejoin's boxes not
// mixed yet and its chains, a swap's quote, a session's leftovers and why a
// return left Lovejoin out. Rendered as the pages show them, with hidden
// balances as the default (the settings not read yet), so an amount that
// shows through is caught.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { LovejoinHeld, PendingTx } from "../src/shared/rpc";
import { PendingBanner, validUntil } from "../src/ui/components/PendingBanner";
import { NetworkContext } from "../src/ui/network";
import { InLovejoin, PublicMixHolding } from "../src/ui/screens/Home";

/** A page's text, as a person reads it. */
function text(element: ReactElement, network: "preprod" | "mainnet" = "preprod"): string {
  return renderToStaticMarkup(createElement(NetworkContext.Provider, { value: network }, element))
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();
}

describe("Home's banner for a payment Koios didn't answer (launch review #10)", () => {
  const at = new Date(2026, 8, 27, 14, 5).getTime();
  const sent: PendingTx = { kind: "send", network: "preprod", txHash: "ab".repeat(32), submittedAt: at, confirmations: null };
  const banner = (pending: PendingTx, watching: boolean) =>
    text(createElement(PendingBanner, { pending, watching, onDismiss: () => undefined }));

  it("says until when one from the public account can land, and that new payments wait for it", () => {
    const pub = { ...sent, maybeSent: true, invalidHereafter: 123_456 };
    expect(validUntil(pub)).toBe("16:05");
    const line = banner(pub, true);
    expect(line).toContain("Payment may have gone through. Waiting for the network…");
    expect(line).toContain("New payments wait until it lands, or until it can't any more: it can land until about 16:05");
    expect(line).not.toContain("Dismiss");
  });

  it("says a private one is let go 20 minutes on, since it carries no slot", () => {
    const priv = { ...sent, kind: "transfer" as const, maybeSent: true };
    expect(validUntil(priv)).toBeUndefined();
    expect(banner(priv, true)).toContain("if the network still hasn't shown it 20 minutes after it was sent, the wallet lets it go");
  });

  it("says one from the public account can still land for about two hours, once it no longer holds payments back", () => {
    const line = banner({ ...sent, invalidHereafter: 123_456 }, false);
    expect(line).toContain("Payment not confirmed yet");
    expect(line).toContain("It can land until about 16:05, and the wallet keeps watching: if it hasn't landed by then, nothing was sent");
    expect(line).toContain("Dismiss");
    // A private one Koios took says nothing more.
    expect(banner({ ...sent, kind: "transfer" }, false)).not.toContain("It can land");
  });
});

describe("Home's Lovejoin row (launch review H2)", () => {
  const held: LovejoinHeld = { boxes: 2, lovelace: "20000000", next: null, notMixed: 0, stopped: 0 };
  const row = (h: LovejoinHeld) => text(createElement(InLovejoin, { held: h, now: 0, onOpen: () => undefined }));

  it("says how many boxes aren't mixed yet, and that a mix stopped, and sends the user to Lovejoin", () => {
    expect(row(held)).not.toContain("not mixed yet");
    const line = row({ ...held, notMixed: 3, stopped: 1 });
    expect(line).toContain("3 not mixed yet, and a mix stopped partway: open Lovejoin to see what to do.");
    expect(row({ ...held, stopped: 2 })).toContain("2 mixes stopped partway");
  });

  it("shows boxes not mixed yet when none is on its way back", () => {
    const line = row({ ...held, boxes: 0, lovelace: "0", notMixed: 2 });
    expect(line).toContain("2 boxes of 10 ₳");
    expect(line).toContain("Not on their way back");
  });

  it("keeps hidden balances hidden", () => {
    const line = row(held);
    expect(line).toContain("•••• ₳");
    expect(line).not.toContain("20 ₳");
  });
});

describe("the public account while a mix from it is sent (launch review #47)", () => {
  it("says the mix holds what it spends and its change, so the balance doesn't look as if it vanished", () => {
    const line = text(createElement(PublicMixHolding, { progress: { total: 13, sent: 4 }, onOpen: () => undefined }));
    expect(line).toContain("A mix through Lovejoin is being sent from this account: 4 of 13 transactions so far.");
    expect(line).toContain("held by the mix, and left out of this balance until it's all sent");
  });
});
