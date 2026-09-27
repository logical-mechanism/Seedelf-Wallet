// What the dApp screens and Home say now that the worker says more (launch
// review stage 3): a payment that may have gone through, Lovejoin's boxes not
// mixed yet and its chains, a swap's quote, a session's leftovers and why a
// return left Lovejoin out. Rendered as the pages show them, with hidden
// balances as the default (the settings not read yet), so an amount that
// shows through is caught.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { LovejoinHeld, PendingTx, SessionView } from "../src/shared/rpc";
import { PendingBanner, validUntil } from "../src/ui/components/PendingBanner";
import { NetworkContext } from "../src/ui/network";
import { InLovejoin, PublicMixHolding } from "../src/ui/screens/Home";
import { LovejoinCost, pairOf, pauseText, Plan, Session, TokenSelect, Unverified } from "../src/ui/screens/Swaps";

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

// ---------------------------------------------------------------------------
// Swaps
// ---------------------------------------------------------------------------

const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");
const TUSDM = "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde" + "0014df10745553444d";
const STRANGER = "e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9";

/** A swap that runs itself, funded and ordering: what the Minswap page shows. */
function swapSession(over: Partial<SessionView> = {}): SessionView {
  return {
    index: 2,
    network: "preprod",
    address: "addr_test1" + "q".repeat(50),
    createdAt: 0,
    stage: "open",
    txs: [{ kind: "out", txHash: "ab".repeat(32), at: 0, confirmed: true }],
    swap: {
      amount: "10000000",
      tokenIn: "lovelace",
      tokenOut: TUSDM,
      slippage: 1,
      amountOut: "4200000",
      minAmountOut: "4158000",
      display: { in: { label: "₳", decimals: 6 }, out: { label: "tUSDM", decimals: 6 } },
    },
    holding: { lovelace: "17000000", tokens: [], utxos: 1 },
    auto: { step: "ordering", stopping: false, filled: false, approvedMinOut: "4158000" },
    ...over,
  };
}

describe("a swap's tokens (launch review #18, #20)", () => {
  it("tells ADA by its ID: a token that calls itself ₳ never reads as ADA", () => {
    const fake = STRANGER + hex("₳");
    const s = swapSession({
      swap: { ...swapSession().swap!, tokenIn: fake, amount: "1000", display: { in: { label: "₳", decimals: 0 }, out: { label: "tUSDM", decimals: 6 } } },
    });
    const pair = pairOf(s, "preprod");
    expect(pair).toMatch(/^1,000 asset1\w{4}…\w{6} → tUSDM$/);
    expect(pair).not.toContain("₳");
    expect(pairOf(swapSession(), "preprod")).toBe("10 ₳ → tUSDM");
  });

  it("lists held tokens that aren't listed or verified apart, after Minswap's, on the You receive side only", () => {
    const seedelf = {
      lovelace: "50000000",
      utxos: 2,
      seedelfs: [],
      locked: { lovelace: "0", tokens: [], utxos: 0 },
      tokens: [
        { policyId: TUSDM.slice(0, 56), assetName: TUSDM.slice(56), quantity: "5000000", decimals: 6, fingerprint: "" },
        { policyId: STRANGER, assetName: hex("SNEAK"), quantity: "700", decimals: 0, fingerprint: "" },
      ],
    };
    const picker = (which: "pay" | "get") =>
      renderToStaticMarkup(
        createElement(
          NetworkContext.Provider,
          { value: "preprod" },
          createElement(TokenSelect, { which, seedelf, onPick: () => undefined, onClose: () => undefined }),
        ),
      );
    const get = picker("get");
    const own = get.slice(get.indexOf('data-testid="swap-own-tokens"'), get.indexOf("On Minswap"));
    expect(own).toContain("tUSDM");
    expect(own).not.toContain("SNEAK");
    const apart = get.slice(get.indexOf("Also in your private balance"));
    expect(get.indexOf("Also in your private balance")).toBeGreaterThan(get.indexOf("On Minswap"));
    expect(apart).toContain("SNEAK");
    expect(apart).toContain("Not on the wallet&#x27;s list, asset1");
    // What's paid is what's held, all in one list.
    const pay = picker("pay");
    expect(pay).not.toContain("Also in your private balance");
    expect(pay.slice(pay.indexOf('data-testid="swap-own-tokens"'))).toContain("SNEAK");
  });

  it("says a quote's token isn't verified by Minswap, with its fingerprint", () => {
    const id = STRANGER + hex("SNEK");
    const line = text(createElement(Unverified, { pick: { id, side: { label: "SNEK", decimals: 0 } } }));
    expect(line).toContain("Not verified by Minswap");
    expect(line).toContain("the wallet won't swap into it: anyone can give a token a known token's name");
    expect(line).toMatch(/asset1\w{38}/);
  });
});

describe("a swap's approval (launch review #21, #26)", () => {
  it("says the least is what the wallet asks Minswap for, and Minswap builds the order", () => {
    const plan = text(createElement(Plan, { least: "4.158 tUSDM", lovejoin: false, adaOut: false }));
    expect(plan).toContain("Minswap builds it, asked for at least 4.158 tUSDM");
    expect(plan).toContain("The proceeds and everything left");
  });

  it("no longer says a token→ADA swap's proceeds come back at once when Lovejoin takes them", () => {
    expect(text(createElement(Plan, { least: "1 ₳", lovejoin: true, adaOut: true }))).toContain(
      "The proceeds and spare ADA through Lovejoin first, in boxes that come back later; the rest at once",
    );
    expect(text(createElement(Plan, { least: "1 MIN", lovejoin: true, adaOut: false }))).toContain(
      "Spare ADA through Lovejoin first, in boxes that come back later; the proceeds and the rest at once",
    );
  });

  it("shows what bringing it back through Lovejoin is expected to cost, and that Lovejoin has had no audit", () => {
    const lovejoin = { boxes: 4, depth: 2, mixes: 16, mixFees: "15200000", withdrawFees: "1200000", delay: "1-6" };
    const line = text(createElement(LovejoinCost, { lovejoin, adaOut: true }));
    expect(line).toContain("Boxes of 10 ₳ About 4, at most");
    expect(line).toContain("Mix fees, about 15.2 ₳");
    expect(line).toContain("Bringing them back, about 1.2 ₳");
    expect(line).toContain("the proceeds and ADA to spare go through Lovejoin first: about 4 boxes of 10 ₳ (at most");
    expect(line).toContain("Lovejoin hasn't had a third-party audit");
  });

  it("says which check what Minswap built failed", () => {
    expect(pauseText({ at: 0, why: "refused", detail: "it places no order." }, "1", undefined)).toBe(
      "The wallet won't sign what Minswap built: it places no order. Try again asks Minswap to build it afresh.",
    );
  });
});

describe("a swap whose funding the chain hasn't shown (launch review #11)", () => {
  const page = (s: SessionView) =>
    text(
      createElement(Session, {
        session: s,
        reading: false,
        onRefresh: () => undefined,
        onBack: () => undefined,
        onChanged: () => undefined,
      }),
    );
  const failed = swapSession({ stage: "failed", holding: null, auto: { ...swapSession().auto!, step: "funding" } });

  it("offers Try again beside Forget it, and doesn't say it never reached the chain", () => {
    const line = page(failed);
    expect(line).toContain("Try again");
    expect(line).toContain("Forget it");
    expect(line).toContain("The chain hasn't shown it yet");
    expect(line).not.toContain("never reached the chain");
  });

  it("says it never reached the chain once it was turned away, and offers only Forget it", () => {
    const line = page({ ...failed, unsent: true });
    expect(line).toContain("It never reached the chain");
    expect(line).not.toContain("Try again");
  });
});

describe("a swap's page (launch review #23, H6, #56)", () => {
  const page = (s: SessionView) =>
    text(
      createElement(Session, { session: s, reading: false, onRefresh: () => undefined, onBack: () => undefined, onChanged: () => undefined }),
    );

  it("says its return left Lovejoin out, and why", () => {
    const done = swapSession({
      stage: "closed",
      auto: { ...swapSession().auto!, step: "done", filled: true },
      lovejoinSkipped: "Lovejoin's pool holds 12 boxes that aren't yours, and the wallet mixes only once it holds 30, so yours hide among enough others",
    });
    const line = page(done);
    expect(line).toContain("Directly: Lovejoin was left out");
    expect(line).toContain(
      "Lovejoin was left out of its return: Lovejoin's pool holds 12 boxes that aren't yours, and the wallet mixes only once it holds 30, so yours hide among enough others. So it comes back directly",
    );
  });

  it("lists what stays at its account, and keeps hidden balances hidden", () => {
    const line = page(
      swapSession({ leftBehind: [{ txHash: "cd".repeat(32), txIndex: 1, reason: "script", lovelace: "1500000" }] }),
    );
    expect(line).toContain("One UTxO stays at the session's account: no return takes it, and it doesn't keep the session open.");
    expect(line).toContain("holds a reference script the wallet can't price");
    expect(line).toContain("It holds •••• ₳");
    expect(line).not.toContain("17 ₳");
  });
});
