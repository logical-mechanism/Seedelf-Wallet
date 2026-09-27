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
import { HandleWarning } from "../src/ui/components/HandleWarning";
import { PendingBanner, validUntil } from "../src/ui/components/PendingBanner";
import { ReturnLeftOut } from "../src/ui/components/SessionLeft";
import { NetworkContext } from "../src/ui/network";
import { InLovejoin, PublicMixHolding } from "../src/ui/screens/Home";
import { ClaimCard } from "../src/ui/screens/Dapps";
import { Chains, detailOf as lovejoinDetail, NotMixed, subOf as lovejoinSub } from "../src/ui/screens/Lovejoin";
import { attachedTo, disconnectWait, SiteRow, SiteSession } from "../src/ui/screens/SiteSessions";
import {
  isRunningSwap,
  LovejoinCost,
  pairOf,
  pauseText,
  Plan,
  Session,
  SwapRow,
  TokenSelect,
  Unverified,
} from "../src/ui/screens/Swaps";

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

  it("stays among the swaps in progress, Home's too, as needing the user, until it's looked for or forgotten", () => {
    expect(isRunningSwap(failed)).toBe(true);
    expect(isRunningSwap({ ...failed, unsent: true })).toBe(false);
    const row = text(createElement(SwapRow, { session: failed, onOpen: () => undefined }));
    expect(row).toContain("Not seen");
    expect(row).toContain("Its funding hasn't shown up yet");
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

// ---------------------------------------------------------------------------
// A site's private session, and the dApps page
// ---------------------------------------------------------------------------

/** A site's private session, funded, holding nothing. */
function siteSession(over: Partial<SessionView> = {}): SessionView {
  return {
    index: 4,
    network: "preprod",
    address: "addr_test1" + "s".repeat(50),
    createdAt: 0,
    stage: "open",
    txs: [{ kind: "out", txHash: "ef".repeat(32), at: 0, confirmed: true }],
    holding: { lovelace: "0", tokens: [], utxos: 0 },
    site: { origin: "https://app.example" },
    ...over,
  };
}

describe("a site's private session (launch review H7, #43, H6, #23, #56)", () => {
  const seedelf = { lovelace: "0", tokens: [], utxos: 0, seedelfs: [], locked: { lovelace: "0", tokens: [], utxos: 0 } };
  const markup = (s: SessionView, attached?: boolean) =>
    renderToStaticMarkup(
      createElement(
        NetworkContext.Provider,
        { value: "preprod" },
        createElement(SiteSession, {
          session: s,
          attached,
          seedelf,
          reading: false,
          onRefresh: () => undefined,
          onBack: () => undefined,
          onPending: () => undefined,
          onDisconnected: () => undefined,
        }),
      ),
    );
  const disconnect = (html: string) => html.match(/<button[^>]*data-testid="site-disconnect"[^>]*>/)![0];

  it("keeps Disconnect off while its funding, its return or its chain is on its way, and says why", () => {
    expect(disconnectWait(siteSession({ stage: "funding", holding: null }))).toBe("Its funding is on its way: wait for it to land");
    expect(disconnectWait(siteSession({ stage: "returning" }))).toBe("Its return is on its way: wait for it to land");
    // Every transaction on chain but the chain's tail: still going.
    const chain = { total: 5, sent: 5, confirmed: 3, cut: false };
    expect(disconnectWait(siteSession({ chain }))).toBe("Its return is on its way: wait for it to land");
    expect(disconnectWait(siteSession({ chain: { ...chain, confirmed: 5 } }))).toBeUndefined();
    expect(disconnectWait(siteSession({ holding: { lovelace: "3000000", tokens: [], utxos: 1 } }))).toBe("Bring everything back first");
    const html = markup(siteSession({ stage: "funding", holding: null }), true);
    expect(disconnect(html)).toContain("disabled");
    expect(html).toContain('data-testid="site-session-wait"');
    // Empty, and nothing on its way: it can go, once asked.
    expect(disconnect(markup(siteSession(), true))).not.toContain("disabled");
  });

  it("says when its site talks to something else, and offers Bring it back", () => {
    const funded = siteSession({ holding: { lovelace: "25000000", tokens: [], utxos: 1 } });
    const sites = [{ origin: "https://app.example", connectedAt: 0 }];
    expect(attachedTo(funded, sites)).toBe(false);
    expect(attachedTo(funded, [{ ...sites[0]!, session: 4 }])).toBe(true);
    expect(attachedTo(funded, undefined)).toBeUndefined();
    const html = markup(funded, false);
    expect(html).toContain('data-testid="site-session-detached"');
    const line = text(createElement(SiteRow, { session: funded, attached: false, onOpen: () => undefined }));
    expect(line).toContain("Not connected");
    expect(markup(funded, true)).not.toContain("site-session-detached");
  });

  it("lists what stays, says why Lovejoin was left out, and keeps hidden balances hidden", () => {
    const html = markup(
      siteSession({
        holding: { lovelace: "25000000", tokens: [], utxos: 1 },
        lovejoinSkipped: "the wallet couldn't build its chain: too few boxes.",
        leftBehind: [{ txHash: "12".repeat(32), txIndex: 0, reason: "fee", lovelace: "900000" }],
      }),
      true,
    );
    const line = html.replace(/<[^>]+>/g, " ").replaceAll("&#x27;", "'").replace(/\s+/g, " ");
    expect(line).toContain("Lovejoin was left out of its return: the wallet couldn't build its chain: too few boxes. So it comes back directly");
    expect(line).toContain("is too little, with what else is left there, to pay for its own way back");
    expect(line).toContain("It holds •••• ₳");
    expect(line).not.toContain("25 ₳");
  });

  it("says a funding the chain hasn't shown may still land, and one turned away never went out", () => {
    const failed = siteSession({ stage: "failed", holding: { lovelace: "0", tokens: [], utxos: 0 } });
    expect(markup(failed, true)).toContain("it may still land");
    expect(markup({ ...failed, unsent: true }, true)).toContain("Its funding never reached the chain");
  });

  it("hides what the sessions hold on the dApps page while balances are hidden", () => {
    const line = text(createElement(ClaimCard, { sessions: [siteSession({ holding: { lovelace: "25000000", tokens: [], utxos: 1 } })], onOpen: () => undefined }));
    expect(line).toContain("•••• ₳");
    expect(line).not.toContain("25 ₳");
  });
});

describe("Bring everything back's review (launch review #57, H6, #23)", () => {
  it("warns before an ADA Handle comes back into the private balance", () => {
    const handle = { policyId: "f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a", assetName: "000de140" + hex("alice") };
    const line = text(createElement(HandleWarning, { tokens: [handle], returning: true }));
    expect(line).toContain("$alice is an ADA Handle, and this return brings it into your private balance.");
    expect(line).toContain("Once it's back, make it public to your public account.");
    // Elsewhere it says what it said.
    expect(text(createElement(HandleWarning, { tokens: [handle] }))).toContain("Keep handles in a public account.");
  });

  it("says what a return leaves for the next one, by session", () => {
    const line = text(
      createElement(ReturnLeftOut, {
        name: "private session 3",
        leftOut: [
          { txHash: "34".repeat(32), txIndex: 2, reason: "tokens" },
          { txHash: "56".repeat(32), txIndex: 0, reason: "script" },
        ],
      }),
    );
    expect(line).toContain("Private session 3's return leaves 2 UTxOs at its account:");
    expect(line).toContain("#2 comes back with the next return");
    expect(line).toContain("#0 holds a reference script the wallet can't spend, so it stays there");
    expect(line).toContain("Once this return lands, bring the session back again for the rest.");
  });
});

// ---------------------------------------------------------------------------
// Lovejoin's page
// ---------------------------------------------------------------------------

describe("Lovejoin's page (launch review H2)", () => {
  it("says boxes not mixed yet never come back by themselves, and offers to bring one back anyway", () => {
    const line = text(createElement(NotMixed, { count: 3, busy: false, onAnyway: () => undefined }));
    expect(line).toContain("3 of your boxes aren't mixed yet: a chain stopped before mixing them.");
    expect(line).toContain("They never come back by themselves, since each still shows where it went in. Mix my boxes again takes them first.");
    expect(line).toContain("Bring one back anyway");
    expect(renderToStaticMarkup(createElement(NotMixed, { count: 0, busy: false, onAnyway: () => undefined }))).toBe("");
  });

  it("lists a chain being sent, which holds withdraws, and one stopped partway, with why", () => {
    const line = text(
      createElement(Chains, {
        chains: [
          { session: 1, boxes: 3, total: 13, sent: 5, at: 1 },
          { boxes: 2, total: 9, sent: 4, at: 2, stopped: "The wallet locked, or the browser closed, while its chain was being sent." },
        ],
      }),
    );
    expect(line).toContain("Private session 2, 3 boxes Sending 5 of 13 transactions sent Withdraws wait until it's all sent.");
    expect(line).toContain(
      "From your public account, 2 boxes Stopped Stopped after 4 of 9 transactions Why it stopped: The wallet locked, or the browser closed, while its chain was being sent. The boxes it didn't mix wait, not mixed yet, for Mix my boxes again.",
    );
  });
});

describe("a mix from the private balance (launch review H2, H8, #11)", () => {
  const mix = (over: Partial<SessionView>): SessionView => ({
    index: 7,
    network: "mainnet",
    address: "addr1" + "m".repeat(50),
    createdAt: 0,
    stage: "closed",
    txs: [{ kind: "out", txHash: "aa".repeat(32), at: 0, confirmed: true }],
    holding: null,
    mix: { boxes: 2 },
    auto: { step: "done", stopping: false, filled: false, approvedMinOut: "0" },
    ...over,
  });

  it("says in full why Lovejoin was left out: the pool below its floor", () => {
    const skipped = mix({
      mix: {
        boxes: 2,
        skipped: "Lovejoin's pool holds 12 boxes that aren't yours, and the wallet mixes only once it holds 30, so yours hide among enough others",
      },
    });
    expect(lovejoinSub(skipped, 0)).toBe("Came back without going into Lovejoin");
    expect(lovejoinDetail(skipped)).toBe(
      "Lovejoin was left out: Lovejoin's pool holds 12 boxes that aren't yours, and the wallet mixes only once it holds 30, so yours hide among enough others.",
    );
  });

  it("says a funding the chain hasn't shown may still land, and one turned away didn't go through", () => {
    const failed = mix({ stage: "failed", auto: { step: "funding", stopping: false, filled: false, approvedMinOut: "0" } });
    expect(lovejoinSub(failed, 0)).toBe("The chain hasn't shown its funding yet");
    expect(lovejoinDetail(failed)).toContain("it may still land: Try again looks for it again");
    expect(lovejoinSub({ ...failed, unsent: true }, 0)).toBe("Its funding didn't go through");
    expect(lovejoinDetail({ ...failed, unsent: true })).toBeUndefined();
  });
});
