// What the dApp screens and Home say now that the worker says more (launch
// review stage 3): a payment that may have gone through, Lovejoin's boxes not
// mixed yet and its chains, a swap's quote, a session's leftovers and why a
// return left Lovejoin out. Rendered as the pages show them, with hidden
// balances as the default (the settings not read yet), so an amount that
// shows through is caught.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import type {
  LovejoinHeld,
  PendingTx,
  SessionBackSummary,
  SessionOutSummary,
  SessionView,
  SwapLovejoin,
  SwapQuote,
} from "../src/shared/rpc";
import { HandleWarning } from "../src/ui/components/HandleWarning";
import { LovejoinNote, LovejoinSwitch } from "../src/ui/components/LovejoinReturn";
import { PendingBanner, validUntil } from "../src/ui/components/PendingBanner";
import { ReturnLeftOut } from "../src/ui/components/SessionLeft";
import { SessionRefusedFoot } from "../src/ui/components/SessionRefused";
import { NetworkContext } from "../src/ui/network";
import { PreferencesContext } from "../src/ui/preferences";
import { InLovejoin, PublicMixHolding } from "../src/ui/screens/Home";
import { ClaimReview } from "../src/ui/screens/ClaimAll";
import { ClaimCard, Dapps } from "../src/ui/screens/Dapps";
import {
  boxesAffordable,
  Chains,
  detailOf as lovejoinDetail,
  mixCosts,
  NotMixed,
  poolRoom,
  PrivateReview,
  PublicReview,
  subOf as lovejoinSub,
  WayBack,
} from "../src/ui/screens/Lovejoin";
import { attachedTo, DisconnectSession, disconnectWait, SiteRow, SiteSession, siteConnected } from "../src/ui/screens/SiteSessions";
import {
  isRunningSwap,
  localMatches,
  LovejoinChoice,
  LovejoinCost,
  NewSwap,
  pairOf,
  pauseText,
  Plan,
  Session,
  StopDialog,
  SwapApproval,
  SwapRow,
  Swaps,
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

/** `element` with the balances shown: the settings read, Hide balances off. */
const shown = (element: ReactElement) =>
  createElement(
    PreferencesContext.Provider,
    { value: { prefs: { ...DEFAULT_PREFERENCES, hideBalances: false }, loaded: true, set: async () => undefined } },
    element,
  );

describe("Home's banner for a payment Koios didn't answer (launch review #10)", () => {
  // Today, so the time it can land until needs no date.
  const day = new Date();
  const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 5).getTime();
  const sent: PendingTx = { kind: "send", network: "preprod", txHash: "ab".repeat(32), submittedAt: at, confirmations: null };
  const banner = (pending: PendingTx, watching: boolean, onCheck?: () => void) =>
    text(createElement(PendingBanner, { pending, watching, onDismiss: () => undefined, onCheck }));

  it("says until when one from the public account can land, and that new payments wait for it", () => {
    const pub = { ...sent, maybeSent: true, invalidHereafter: 123_456 };
    expect(validUntil(pub)).toBe("11:05");
    const line = banner(pub, true);
    expect(line).toContain("New payments wait for it. It can land until about 11:05");
    expect(line).not.toContain("Dismiss");
  });

  it("leads with not paying again, offers Check now, and keeps how long it can land for under Details (chunk 23's second review, HM-4)", () => {
    const pub = { ...sent, maybeSent: true, invalidHereafter: 123_456 };
    const line = banner(pub, true, () => undefined);
    expect(line).toMatch(/^Payment not confirmed yet: don't pay it again Koios didn't answer, so it may have gone through\./);
    expect(line).toContain("Check now Details New payments wait for it");
    // Without a way to ask, no button.
    expect(banner(pub, true)).not.toContain("Check now");
  });

  it("gives a time past midnight its date: said at 23:17, 01:17 read as hours ago", () => {
    const late = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 17).getTime();
    const tomorrow = new Date(late + 2 * 60 * 60_000).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const pub = { ...sent, submittedAt: late, maybeSent: true, invalidHereafter: 123_456 };
    expect(validUntil(pub, late)).toBe(`${tomorrow}, 01:17`);
    expect(banner(pub, true)).toContain(`It can land until about ${tomorrow}, 01:17`);
  });

  it("names a chain's first transaction, the one its review showed, until its last lands (O3)", () => {
    const chain = { ...sent, kind: "lovejoin-mix" as const, txHash: "ee".repeat(32), chain: { first: "11".repeat(32), total: 14 } };
    const waiting = renderToStaticMarkup(createElement(PendingBanner, { pending: chain, watching: true, onDismiss: () => undefined }));
    expect(waiting).toContain(`/transaction/${"11".repeat(32)}`);
    expect(waiting).not.toContain("ee".repeat(32));
    expect(banner(chain, true)).toContain("on Cardanoscan, the first of 14");
    // Landed: the last, which brought it in, with no count.
    const done = renderToStaticMarkup(createElement(PendingBanner, { pending: { ...chain, confirmations: 1 }, watching: false, onDismiss: () => undefined }));
    expect(done).toContain(`/transaction/${"ee".repeat(32)}`);
    expect(banner({ ...chain, confirmations: 1 }, false)).not.toContain("the first of");
  });

  it("says a private one is let go 20 minutes on, since it carries no slot", () => {
    const priv = { ...sent, kind: "transfer" as const, maybeSent: true };
    expect(validUntil(priv)).toBeUndefined();
    expect(banner(priv, true)).toContain("If the network hasn't seen it 20 minutes after sending, the wallet lets it go");
  });

  it("says one from the public account can still land for about two hours, once it no longer holds payments back", () => {
    const line = banner({ ...sent, invalidHereafter: 123_456 }, false);
    expect(line).toContain("Payment not confirmed yet");
    expect(line).toContain("It can land until about 11:05. If it hasn't by then, nothing was sent");
    expect(line).toContain("Dismiss");
    // A private one Koios took says nothing more.
    expect(banner({ ...sent, kind: "transfer" }, false)).not.toContain("It can land");
  });
});

describe("Home's Lovejoin row (launch review H2)", () => {
  const held: LovejoinHeld = { boxes: 2, lovelace: "20000000", next: null, notMixed: 0, stopped: 0 };
  const element = (h: LovejoinHeld) => createElement(InLovejoin, { held: h, now: 0, onOpen: () => undefined });
  const row = (h: LovejoinHeld) => text(shown(element(h)));

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

  it("keeps hidden balances hidden, and how many boxes, each of 10 ₳ (privacy review §2.16)", () => {
    const line = text(element({ ...held, notMixed: 3, stopped: 2 }));
    expect(line).toContain("•••• ₳");
    expect(line).not.toContain("20 ₳");
    expect(line).toContain("•••• boxes of 10 ₳");
    expect(line).toContain("Some not mixed yet, and 2 mixes stopped partway");
    expect(line).not.toMatch(/\d+ box|\d+ not mixed/);
  });

  it("says a box that's due comes back in a few minutes, not at the next unlock (privacy review §3.1)", () => {
    const line = row({ ...held, next: -1 });
    expect(line).toContain("Next back in a few minutes");
    expect(line).not.toContain("unlock");
  });
});

describe("the public account while a mix from it is sent (launch review #47)", () => {
  it("says the mix holds what it spends and its change, so the balance doesn't look as if it vanished", () => {
    const line = text(createElement(PublicMixHolding, { progress: { total: 13, sent: 4 }, onOpen: () => undefined }));
    expect(line).toContain("Sending a Lovejoin mix: 4 of 13 transactions.");
    expect(line).toContain("Until it's all sent, what it spends and its change are left out of this balance.");
  });
});

// ---------------------------------------------------------------------------
// Swaps
// ---------------------------------------------------------------------------

const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");
const TUSDM = "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde" + "0014df10745553444d";
const MIN_PREPROD = "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed72" + "4d494e";
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
    expect(pairOf(swapSession(), "preprod")).toBe("10\u00a0₳ → tUSDM");
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

  it("finds the wallet's own list on the device, and asks Minswap only when nothing here matches (privacy review §3.11)", () => {
    const seedelf = {
      lovelace: "50000000",
      utxos: 1,
      seedelfs: [],
      locked: { lovelace: "0", tokens: [], utxos: 0 },
      tokens: [{ policyId: TUSDM.slice(0, 56), assetName: TUSDM.slice(56), quantity: "5000000", decimals: 6, fingerprint: "" }],
    };
    const html = renderToStaticMarkup(
      createElement(
        NetworkContext.Provider,
        { value: "preprod" },
        createElement(TokenSelect, { which: "get", seedelf, onPick: () => undefined, onClose: () => undefined }),
      ),
    );
    // Preprod's list: tUSDM is held, so MIN is the one offered from it, before anything is asked.
    const listed = html.slice(html.indexOf("On the wallet&#x27;s list"), html.indexOf("On Minswap"));
    expect(listed).toContain("MIN");
    expect(listed).toContain("Minswap (preprod)");
    expect(listed).not.toContain("tUSDM");
    expect(html).toContain("Minswap is asked only if nothing here matches or you search it, and then sees what you typed.");
    // Matched here: no need to ask Minswap. Only a query nothing here matches goes to it.
    const own = [{ id: "lovelace", side: { label: "₳", decimals: 6 }, sub: "Cardano", held: "50000000", listed: true }];
    expect(localMatches("preprod", own, "min", "get").listed.map((p) => p.id)).toEqual([MIN_PREPROD]);
    expect(localMatches("preprod", own, "Minswap", "get").listed).toHaveLength(1);
    const none = localMatches("preprod", own, "SNEK", "get");
    expect(none.held.length + none.listed.length).toBe(0);
    // What's paid is what's held: the list isn't offered there.
    expect(localMatches("preprod", own, "", "pay").listed).toEqual([]);
  });

  it("says a quote's token isn't verified by Minswap, with its fingerprint", () => {
    const id = STRANGER + hex("SNEK");
    const line = text(createElement(Unverified, { pick: { id, side: { label: "SNEK", decimals: 0 } } }));
    expect(line).toContain("Not verified by Minswap");
    expect(line).toContain("Minswap doesn't verify its ID, so the wallet won't swap into it. Anyone can copy a known token's name.");
    expect(line).toMatch(/asset1\w{38}/);
  });
});

describe("the swap form's privacy note (privacy review §2.13)", () => {
  it("says Half and Max tell Minswap roughly what the private balance holds, and Max leaves what's under 1 ₳", () => {
    const seedelf = { lovelace: "123456789", utxos: 1, seedelfs: [], locked: { lovelace: "0", tokens: [], utxos: 0 }, tokens: [] };
    const form = createElement(NewSwap, { seedelf, onCancel: () => undefined, onStarted: () => undefined });
    const html = renderToStaticMarkup(createElement(NetworkContext.Provider, { value: "preprod" }, form));
    const line = text(form);
    expect(line).toContain("Minswap sees the pair, amount and your IP address as you type, never your public account");
    expect(line).toContain("Half and Max hint at your private balance");
    expect(line).not.toContain("never your private balance");
    expect(html).toContain("title=\"All but what&#x27;s under 1\u00a0₳, less the swap&#x27;s costs and the collateral\"");
  });
});

describe("a swap's approval (launch review #21, #26)", () => {
  it("says Minswap builds the order; the least it asks for is the summary's, said once", () => {
    const plan = text(createElement(Plan, { lovejoin: false, adaOut: false }));
    expect(plan).toContain("Order placed Built by Minswap");
    expect(plan).not.toContain("at least");
    expect(plan).toContain("The proceeds and everything left, directly");
  });

  it("no longer says a token→ADA swap's proceeds come back at once when Lovejoin takes them", () => {
    expect(text(createElement(Plan, { lovejoin: true, adaOut: true }))).toContain(
      "The proceeds and spare ADA in Lovejoin boxes, later; the rest at once",
    );
    expect(text(createElement(Plan, { lovejoin: true, adaOut: false }))).toContain(
      "The proceeds and the rest at once; spare ADA in Lovejoin boxes, later",
    );
  });

  it("shows what bringing it back through Lovejoin is expected to cost, and that Lovejoin has had no audit", () => {
    const lovejoin = { boxes: 4, depth: 2, mixes: 16, mixFees: "15200000", withdrawFees: "1200000", delay: "1-6", on: true };
    const line = text(createElement(LovejoinCost, { lovejoin }));
    expect(line).toContain("Boxes of 10 ₳ About 4, at most");
    expect(line).toContain("Mix fees, about 15.2 ₳");
    expect(line).toContain("Bringing them back, about 1.2 ₳");
    // When each box comes back is its row; which money goes in is the Plan's last step: the note doesn't repeat them.
    expect(line).toContain("Back later Each box on its own, after 1 to 6 hours");
    expect(line).not.toContain("go through Lovejoin first");
    // This swap keeps its Lovejoin whatever Settings says later (independent review L21); Stop's switch can still
    // bring it back directly.
    expect(line).toContain("Changing Lovejoin in Settings won't change this swap.");
    expect(line).toContain("Yours is one of up to 9 boxes at 2 waves deep");
    expect(line).toContain("Lovejoin has had no third-party audit");
    // As many as the pool has room for at Review (privacy review §2.7).
    const capped = text(createElement(LovejoinCost, { lovejoin: { ...lovejoin, boxes: 2, of: 4 } }));
    expect(capped).toContain("Boxes of 10 ₳ About 2 of 4, as the pool is now");
  });

  it("says which check what Minswap built failed", () => {
    expect(pauseText({ at: 0, why: "refused", detail: "it places no order." }, "1", undefined)).toBe(
      "The wallet won't sign what Minswap built: it places no order. Try again asks Minswap to build it afresh.",
    );
  });
});

describe("a swap's way back, on its approval and at Stop (privacy review §2.7, §2.8, §4.1)", () => {
  const through: SwapLovejoin = { boxes: 3, depth: 2, mixes: 12, mixFees: "11400000", withdrawFees: "900000", delay: "1-6", on: true };
  const quote: SwapQuote = {
    network: "preprod",
    ask: { amount: "10000000", tokenIn: "lovelace", tokenOut: TUSDM, slippage: 1 },
    amountIn: "10000000",
    amountOut: "4200000",
    minAmountOut: "4158000",
    dexFee: "2000000",
    deposits: "2000000",
    aggregatorFee: "0",
    priceImpact: 0.3,
    route: ["MinswapV2"],
    fund: { lovelace: "16000000", tokens: [] },
    collateral: "5000000",
    verified: true,
  };
  const summary: SessionOutSummary = {
    network: "preprod",
    txHash: "ab".repeat(32),
    index: 2,
    address: "addr_test1" + "q".repeat(50),
    payments: [
      { address: "addr_test1" + "q".repeat(50), own: false, lovelace: "16000000", minimum: null, tokens: [] },
      { address: "addr_test1" + "q".repeat(50), own: false, lovelace: "5000000", minimum: null, tokens: [] },
    ],
    max: false,
    fee: { size: "0", compute: "0", scriptReference: "0", total: "400000" },
    changeLovelace: "3600000",
    changeTokens: 0,
    changeOutputs: 1,
    changeMinimum: "0",
    inputs: 1,
    left: 0,
  };
  const pay = { id: "lovelace", side: { label: "₳", decimals: 6 } };
  const get = { id: TUSDM, side: { label: "tUSDM", decimals: 6 } };
  const approval = (lovejoin: SwapLovejoin | undefined, on = true) =>
    text(createElement(SwapApproval, { summary, quote, lovejoin, pay, get, through: on, onThrough: () => undefined, busy: false }));
  const choice = (lovejoin: SwapLovejoin, on = true) =>
    renderToStaticMarkup(
      createElement(LovejoinChoice, { lovejoin, funded: "16000000", through: on, onThrough: () => undefined, busy: false }),
    );

  it("has a switch to bring it back directly, on as Settings has it, and says what each way costs", () => {
    const on = choice(through);
    expect(on).toMatch(/role="switch"[^>]*aria-checked="true"/);
    expect(on).toContain("Bring it back through Lovejoin");
    expect(choice(through, false)).toMatch(/role="switch"[^>]*aria-checked="false"/);
    const line = approval(through);
    expect(line).toContain("On the way back, through Lovejoin");
    expect(line).toContain("spare ADA in Lovejoin boxes, later");
    // Off: it all comes back at once, and it says what that ties.
    const off = approval(through, false);
    expect(off).not.toContain("On the way back, through Lovejoin");
    expect(off).toContain("It all comes back at once: anyone can tie it on chain to this session and its funding");
    expect(off).toContain("The proceeds and everything left, directly");
    expect(off).not.toContain("third-party audit");
  });

  it("says a stop or a refund brings an ADA swap's funding back through Lovejoin, and that Lovejoin has had no audit", () => {
    const line = approval({ ...through, boxes: 0, mixes: 0, mixFees: "0", withdrawFees: "0", ifStopped: { boxes: 1, mixes: 4, mixFees: "3800000", withdrawFees: "300000" } });
    expect(line).toContain("Bring it back through Lovejoin");
    expect(line).toContain(
      "If you stop it or the order is refunded, its 16 ₳ come back through Lovejoin instead: at most 1 box of 10 ₳, about 3.8 ₳ in mix fees and 0.3 ₳ to bring them back",
    );
    expect(line).toContain("Lovejoin has had no third-party audit");
    expect(line).not.toContain("Too little spare ADA for a Lovejoin box");
  });

  it("doesn't say it relies on Minswap for the minimum of a swap against Danogo's pools, whose minimum it checks, nor speak of an order (chunk 24)", () => {
    const pools = text(
      createElement(SwapApproval, {
        summary,
        // Danogo's estimate has no deposits: nothing is locked in an order.
        quote: { ...quote, deposits: "0", againstPools: true },
        lovejoin: through,
        pay,
        get,
        through: true,
        onThrough: () => undefined,
        busy: false,
      }),
    );
    expect(pools).not.toContain("The wallet relies on Minswap for the minimum");
    expect(pools).toContain("Stop works until the swap goes out.");
    expect(pools).toContain("Swapped against the DEX's pools");
    expect(pools).not.toContain("Order placed");
    // No order deposit row, and the parts still add up: the room takes what the deposit would have.
    expect(pools).not.toContain("Order deposit");
    expect(pools).toContain("The swap and its costs 16 ₳ The swap 10 ₳ DEX fee 2 ₳ Room for network fees 4 ₳, what's left comes back");
    // Its network fees: the swap runs the pools' scripts, about 0.75 ₳, and the note names no order.
    expect(pools).toContain(
      "Network fees: this payment's, then about 0.75 ₳ for the swap against the DEX's pools and 0.25 ₳ each for Lovejoin's deposit and the return",
    );
    expect(pools).not.toContain("for the order");
  });

  it("says the slippage, that it relies on Minswap for the minimum, and what the swap and its costs pay for (chunk 23's second review, DX-2, DX-3)", () => {
    const line = approval(through);
    expect(line).toContain("Asks for at least 4.158 tUSDM · 1% slippage · 0.3% price impact");
    expect(line).toContain(
      "The wallet relies on Minswap for the minimum of 4.158 tUSDM: it can't check it in the order Minswap builds.",
    );
    expect(line).toContain(
      "The swap and its costs 16 ₳ The swap 10 ₳ DEX fee 2 ₳ Order deposit 2 ₳, back with the proceeds Room for network fees 2 ₳, what's left comes back",
    );
    // The approval's own words no longer bury the minimum, and its button is the act.
    expect(line).not.toContain("the order's own minimum it can't read");
    expect(line).toContain("Start swap approves every step. The wallet pauses if the price moves too far, and Stop works until the order fills.");
    // The least is said in the summary and the warning, not again in the steps or this note.
    expect(line.split("4.158 tUSDM").length - 1).toBe(2);
    expect(line).not.toContain("High slippage");
    const high = text(
      createElement(SwapApproval, {
        summary,
        quote: { ...quote, ask: { ...quote.ask, slippage: 12 } },
        lovejoin: through,
        pay,
        get,
        through: true,
        onThrough: () => undefined,
        busy: false,
      }),
    );
    expect(high).toContain("High slippage: the order can fill for up to 12% less than the quote.");
  });

  it("says the pool takes nothing now, and doesn't promise Lovejoin", () => {
    const line = approval({
      ...through,
      boxes: 0,
      of: 3,
      mixes: 0,
      skipped: "Right now Lovejoin's pool holds 12 boxes that aren't yours, under the 30 it needs",
    });
    expect(line).toContain(
      "Right now Lovejoin's pool holds 12 boxes that aren't yours, under the 30 it needs, so as things are, this swap's ADA comes back directly, tied to this session on chain.",
    );
    expect(line).not.toContain("On the way back, through Lovejoin");
    expect(line).toContain("The proceeds and everything left, directly");
    // The switch, on, says it applies only if the pool has room by then (chunk 23's second review, DX-3); the warning
    // under it says it has none now.
    expect(line).toContain("Only if Lovejoin's pool has room when it comes back.");
  });

  it("says what leaves now, what it all costs and what comes back, adding up (blind test §9.8, T10)", () => {
    // T10's swap: 10 ₳ for tUSDM, 16 ₳ for it and its costs and 5 ₳ kept aside, a 0.233208 ₳ fee, from 28 ₳.
    const t10: SessionOutSummary = { ...summary, fee: { ...summary.fee, total: "233208" }, changeLovelace: "3766792" };
    const review = (lovejoin: SwapLovejoin | undefined, on = true) =>
      text(
        shown(
          createElement(SwapApproval, { summary: t10, quote, lovejoin, pay, get, through: on, onThrough: () => undefined, busy: false, before: "28000000" }),
        ),
      );
    const line = review({ ...through, boxes: 0, mixes: 0, mixFees: "0", withdrawFees: "0" });
    // What leaves, as every review says it: 16 + 5 + 0.233208, and the balance after, not the change.
    expect(line).toContain("Network fee 0.233208 ₳ Total leaving your private balance 21.233208 ₳ Private balance after 6.766792 ₳");
    expect(line).not.toContain("Change, back to your private balance");
    // "The swap and its costs" isn't bold: the total is.
    expect(line).not.toContain("For the swap");
    // The whole swap: the DEX's 2 ₳, and three network fees, this one's exact, about 0.25 ₳ each for the order and the
    // return: 2 + 0.233208 + 0.5 = 2.733208, about 2.73 ₳. What comes back: 21.233208 − 10 swapped − 2.733208 = 8.5 ₳,
    // the 5 ₳ kept aside, the 2 ₳ deposit and what the fees leave of the 2 ₳ room.
    expect(line).toContain("Costs in all, about 2.73 ₳ DEX fee 2 ₳ Network fees, about 0.73 ₳ Comes back, about 4.2 tUSDM and 8.5 ₳");
    // This payment's own fee is its row, above; the note names the later two, paid from the room for them.
    expect(line).toContain("Network fees: this payment's, then about 0.25 ₳ each for the order and the return, from the room for them.");
    expect(line).not.toContain("The collateral, the order's deposit");
    // Through Lovejoin, with a box: its mixes and the box's way back are costs too, and the deposit a fourth fee.
    const mixed = review({ ...through, boxes: 1, mixes: 4, mixFees: "3800000", withdrawFees: "300000" });
    expect(mixed).toContain("Costs in all, about 7.08 ₳ DEX fee 2 ₳ Network fees, about 0.98 ₳ Through Lovejoin, about 4.1 ₳");
    expect(mixed).toContain("about 0.25 ₳ each for the order, Lovejoin's deposit and the return");
    // Turned off, it comes back directly, as the switch says: Lovejoin's costs go.
    expect(review({ ...through, boxes: 1, mixes: 4, mixFees: "3800000", withdrawFees: "300000" }, false)).toContain("Costs in all, about 2.73 ₳");
  });

  it("offers Stop through Lovejoin, with what it takes, or directly, by the approval's switch", () => {
    const dialog = (cost: SwapLovejoin | null | undefined, placed = false, through = true) =>
      createElement(StopDialog, { placed, cost, through, onThrough: () => undefined, busy: false, onStop: () => undefined, onClose: () => undefined });
    const cost = { ...through, boxes: 1, mixes: 4, mixFees: "3800000", withdrawFees: "300000" };
    // The switch comes first, on as approved, where it can't be missed (the owner missed the link it was, 2026-10-05).
    const html = renderToStaticMarkup(dialog(cost));
    expect(html.indexOf('role="switch"')).toBeLessThan(html.indexOf('data-testid="session-stop-what"'));
    expect(html).toContain('aria-checked="true"');
    const mixes = text(dialog(cost));
    expect(mixes).toContain("Bring it back through Lovejoin");
    expect(mixes).toContain("Stop, through Lovejoin");
    expect(mixes).toContain(
      "Its ADA goes through Lovejoin first: at most 1 box of 10 ₳, about 3.8 ₳ in mix fees and 0.3 ₳ to bring them back, each after 1 to 6 hours",
    );
    // Off: Stop says it comes back directly, for one fee, and what that ties.
    const off = text(dialog(cost, false, false));
    expect(off).toContain("Stop and bring it back directly");
    expect(off).not.toContain("Stop, through Lovejoin");
    expect(off).not.toContain("Its ADA goes through Lovejoin first");
    expect(off).toContain("less the return's network fee");
    expect(off).toContain("anyone can tie it on chain to this session and its funding");
    expect(text(dialog(cost, true, false))).toContain("The cancel and the return each cost a network fee.");
    // Directly: as it always said.
    const direct = text(dialog(null));
    expect(direct).toContain("Stop the swap");
    expect(direct).not.toContain("Bring it back through Lovejoin");
    expect(direct).toContain(
      "If no order has gone out yet, none will, and everything comes back to your private balance, less the return's network fee. If one is being placed right now, it's cancelled unless it fills first.",
    );
    const short = text(dialog({ ...through, boxes: 0, skipped: "Right now Lovejoin's pool holds 3 boxes that aren't yours, under the 30 it needs" }, true));
    expect(short).toContain("Stop the swap");
    expect(short).toContain("under the 30 it needs, so it would come back directly");
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
      lovejoinSkipped: "Lovejoin's pool holds 12 boxes that aren't yours, and the wallet mixes only once it holds 30, so there's enough to mix with",
    });
    const line = page(done);
    expect(line).toContain("Directly: Lovejoin was left out");
    expect(line).toContain(
      "Lovejoin was left out of its return: Lovejoin's pool holds 12 boxes that aren't yours, and the wallet mixes only once it holds 30, so there's enough to mix with. So it comes back directly",
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

describe("what the swap and session screens say sites and chain watchers see (privacy review §2.6, §2.12)", () => {
  const seedelf = { lovelace: "0", tokens: [], utxos: 0, seedelfs: [], locked: { lovelace: "0", tokens: [], utxos: 0 } };

  it("never says the public account never appears, and says where the money leads", () => {
    const swaps = text(createElement(Swaps, { seedelf, onBack: () => undefined, onPending: () => undefined }));
    expect(swaps).toContain("your public account isn't in its transactions. Anyone can follow its money");
    expect(swaps).toContain("money you made private leads back to your public account");
    expect(swaps).not.toContain("never appears");
    const dapps = text(createElement(Dapps, { seedelf, onBack: () => undefined, onPending: () => undefined }));
    expect(dapps).toContain("Each use runs from a new one-time account, funded from your private balance.");
    expect(dapps).toContain("money you made private leads back to your public account");
    expect(dapps).not.toContain("never sees");
    const site = text(
      createElement(SiteSession, {
        session: siteSession(),
        seedelf,
        reading: false,
        onRefresh: () => undefined,
        onBack: () => undefined,
        onPending: () => undefined,
        onDisconnected: () => undefined,
      }),
    );
    expect(site).toContain("The site gets only this account.");
    expect(site).toContain("A site that saw your public account in this browser can tell it's yours.");
    expect(site).not.toContain("The site sees only this account");
  });

  it("says a return through Lovejoin is harder to tie to the session, not untied, and how far a box hides", () => {
    const back: SessionBackSummary = {
      network: "preprod",
      index: 4,
      txHash: "cd".repeat(32),
      fee: "8300000",
      lovelace: "5200000",
      tokens: [],
      depositOutputs: 1,
      inputs: 2,
      lovejoin: { boxes: 2, depth: 2, mixes: 8, fees: "8000000", txs: 10, delay: "1-6", entry: "11".repeat(32) },
    };
    const line = text(createElement(LovejoinNote, { back }));
    // What going through Lovejoin is for is the switch's, above the rows; the note under them says who pays and how far a
    // box hides (copy-trim pass: each said once on the screen).
    const way = text(createElement(LovejoinSwitch, { back, through: true, busy: false, onThrough: () => undefined }));
    expect(way).toContain("harder to tie to this session");
    for (const said of [way, line]) expect(said).not.toContain("isn't tied");
    expect(line).toContain("This session pays every mix: 8 ₳ over 10 transactions.");
    expect(line).toContain("Yours is one of up to 9 boxes at 2 waves deep, fewer while few people use Lovejoin");
    expect(line).toContain("Spending returned boxes together, or with the session's change, narrows it.");
  });

  it("offers the way back directly as a switch, on through Lovejoin, never a link (blind test §9.8; 5289dcf)", () => {
    const back: SessionBackSummary = {
      network: "preprod",
      index: 4,
      txHash: "cd".repeat(32),
      fee: "8300000",
      lovelace: "5200000",
      tokens: [],
      depositOutputs: 1,
      inputs: 2,
      lovejoin: { boxes: 2, depth: 2, mixes: 8, fees: "8000000", txs: 10, delay: "1-6", entry: "11".repeat(32) },
    };
    const sw = (b: SessionBackSummary, through: boolean) =>
      renderToStaticMarkup(createElement(LovejoinSwitch, { back: b, through, busy: false, onThrough: () => undefined }));
    const on = sw(back, true);
    expect(on).toMatch(/role="switch"[^>]*aria-checked="true"/);
    expect(on).toContain("Bring it back through Lovejoin");
    expect(on).toContain("harder to tie to this session");
    // Built directly, it stays, off, saying what that ties: the user can turn it back on.
    const { lovejoin: _, ...direct } = back;
    const off = sw(direct, false);
    expect(off).toMatch(/role="switch"[^>]*aria-checked="false"/);
    expect(off).toContain("anyone can tie it on chain to this session and its funding");
    // With nothing for Lovejoin to take, there's no choice to make.
    expect(sw(direct, true)).toBe("");
    // And the note under the rows no longer carries a way out of its own.
    expect(renderToStaticMarkup(createElement(LovejoinNote, { back }))).not.toContain('class="link"');
  });
});

describe("a site's private session (launch review H7, #43, H6, #23, #56)", () => {
  const seedelf = { lovelace: "0", tokens: [], utxos: 0, seedelfs: [], locked: { lovelace: "0", tokens: [], utxos: 0 } };
  const markup = (s: SessionView, attached?: boolean, connected?: boolean) =>
    renderToStaticMarkup(
      createElement(
        NetworkContext.Provider,
        { value: "preprod" },
        createElement(SiteSession, {
          session: s,
          attached,
          connected,
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

  it("says why each action it can't take is off, under the buttons (chunk 23's second review, CW-6)", () => {
    const why = (html: string) => (html.match(/data-testid="site-session-why"[^>]*>([^<]*)</) ?? [])[1]?.replaceAll("&#x27;", "'");
    expect(why(markup(siteSession(), true))).toBe("Nothing to bring back: the account is empty.");
    // Unread: one sentence for both actions that wait on it.
    expect(why(markup(siteSession({ holding: null }), true))).toBe("Refresh to read what it holds first.");
    const funded = siteSession({ holding: { lovelace: "25000000", tokens: [], utxos: 1 } });
    expect(why(markup(funded, true))).toBe("Disconnect waits until everything in it is brought back.");
    // Its site doesn't use it: Top up is off too, and says so.
    expect(why(markup(funded, false, false))).toBe(
      "Top up is off: app.example doesn't use this session. Disconnect waits until everything in it is brought back.",
    );
  });

  it("never says a site connected to nothing stays connected, or that another request connected it (CW-6)", () => {
    const funded = siteSession({ holding: { lovelace: "25000000", tokens: [], utxos: 1 } });
    expect(siteConnected(funded, [])).toBe(false);
    expect(siteConnected(funded, [{ origin: "https://app.example", connectedAt: 0 }])).toBe(true);
    const nowhere = markup(funded, false, false).replace(/<[^>]+>/g, " ").replaceAll("&#x27;", "'");
    expect(nowhere).toContain("app.example isn't connected to this session and won't use it.");
    expect(nowhere).not.toMatch(/another request/i);
    const elsewhere = markup(funded, false, true).replace(/<[^>]+>/g, " ").replaceAll("&#x27;", "'");
    expect(elsewhere).toContain("Another request from app.example connected the site elsewhere");
    const dialog = (connected?: boolean) =>
      text(createElement(DisconnectSession, { session: funded, attached: false, connected, busy: false, onKeep: () => undefined, onDisconnect: () => undefined }));
    expect(dialog(false)).toContain("Private session 5 ends. app.example isn't connected to it, so nothing changes for the site.");
    expect(dialog(false)).not.toContain("stays connected");
    expect(dialog(true)).toContain("stays connected as it is now");
  });

  it("hides what the sessions hold on the dApps page while balances are hidden", () => {
    const line = text(createElement(ClaimCard, { sessions: [siteSession({ holding: { lovelace: "25000000", tokens: [], utxos: 1 } })], onOpen: () => undefined }));
    expect(line).toContain("•••• ₳");
    expect(line).not.toContain("25 ₳");
  });
});

describe("Bring everything back's review (launch review #57, H6, #23)", () => {
  const back = (over: Partial<SessionBackSummary> = {}): SessionBackSummary => ({
    network: "preprod",
    index: 4,
    txHash: "cd".repeat(32),
    fee: "300000",
    lovelace: "5200000",
    tokens: [],
    depositOutputs: 1,
    inputs: 2,
    ...over,
  });
  const review = (returns: SessionBackSummary[], direct = false) =>
    text(
      createElement(ClaimReview, {
        built: { returns, skipped: [] },
        chosen: new Set(returns.map((r) => r.index)),
        sessions: [siteSession({ holding: { lovelace: "25000000", tokens: [], utxos: 2 } })],
        direct,
        busy: false,
        onToggle: () => undefined,
        onDirect: () => undefined,
      }),
    );

  it("offers bringing them back directly as a switch, first, never a link (blind test §9.8; 5289dcf)", () => {
    const chain = { boxes: 2, depth: 2, mixes: 8, fees: "8000000", txs: 10, delay: "1-6", entry: "11".repeat(32) };
    const markup = (returns: SessionBackSummary[], direct: boolean) =>
      renderToStaticMarkup(
        createElement(ClaimReview, {
          built: { returns, skipped: [] },
          chosen: new Set(returns.map((r) => r.index)),
          sessions: [siteSession({ holding: { lovelace: "25000000", tokens: [], utxos: 2 } })],
          direct,
          busy: false,
          onToggle: () => undefined,
          onDirect: () => undefined,
        }),
      );
    const through = markup([back({ lovejoin: chain })], false);
    expect(through).toMatch(/role="switch"[^>]*aria-checked="true"/);
    expect(through.indexOf('role="switch"')).toBeLessThan(through.indexOf('data-testid="claim-returns"'));
    expect(through).toContain("Bring them back through Lovejoin");
    expect(through).not.toContain('class="link"');
    // Built directly, it stays, off, saying what that ties.
    const direct = markup([back()], true);
    expect(direct).toMatch(/role="switch"[^>]*aria-checked="false"/);
    expect(direct).toContain("anyone can tie each on chain to its session and its funding");
    // Nothing through Lovejoin, and nothing turned off: no switch.
    expect(markup([back()], false)).not.toContain('role="switch"');
  });

  it("names which transaction of a chain it shows, and it's the deposit", () => {
    const chain = { boxes: 2, depth: 2, mixes: 8, fees: "8000000", txs: 10, delay: "1-6", entry: "11".repeat(32) };
    // One return through Lovejoin: ten transactions, and the one shown is named.
    const one = review([back({ lovejoin: chain })]);
    expect(one).toContain("The deposit's transaction");
    expect(one).not.toContain("Transaction details");
    // Mixing its own boxes again puts nothing in, so it begins at the first mix.
    expect(review([back({ lovejoin: { ...chain, again: true } })])).toContain("The first mix's transaction");
    // Several, and each says whose it is.
    const two = review([back({ lovejoin: chain }), back({ index: 5, lovejoin: chain })]);
    expect(two).toContain("Private session 5's deposit");
    expect(two).toContain("Private session 6's deposit");
    expect(two).not.toContain("deposit's transaction");
    // Coming back directly is one transaction, so the button's own words do.
    expect(review([back({})])).toContain("Transaction details");
  });

  it("offers to bring them back directly when some go through Lovejoin, and says it has had no audit (privacy review §4.1)", () => {
    const line = review([back({ lovejoin: { boxes: 2, depth: 2, mixes: 8, fees: "8000000", txs: 10, delay: "1-6", entry: "11".repeat(32) } })]);
    expect(line).toContain("Through Lovejoin 2 boxes of 10 ₳, each back after 1 to 6 hours");
    // By its switch, now, not a link (blind test §9.8).
    expect(line).toContain("Bring them back through Lovejoin");
    expect(line).toContain("Lovejoin has had no third-party audit");
    // Sent together, their deposits and mixes share blocks (privacy review §6).
    expect(line).toContain("Their Lovejoin deposits and mixes land in the same blocks");
    expect(line).toContain("Bringing each back from its own page, hours apart, avoids both.");
    expect(line).not.toContain("so those don't land together");
    // Built again directly: the switch, off, and it says what that ties.
    const direct = review([back()], true);
    expect(direct).toContain("Bring them back through Lovejoin");
    expect(direct).not.toContain("third-party audit");
    // Said once, by the switch: the privacy callout under the totals doesn't repeat it.
    const tied = "They come back directly: anyone can tie each on chain to its session and its funding.";
    expect(direct.split(tied).length - 1).toBe(1);
  });

  it("warns before an ADA Handle comes back into the private balance", () => {
    const handle = { policyId: "f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a", assetName: "000de140" + hex("alice") };
    const line = text(createElement(HandleWarning, { tokens: [handle], returning: true }));
    expect(line).toContain("$alice is an ADA Handle, and this return brings it into your private balance, where anyone can take payments to it.");
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
    const line = text(shown(createElement(NotMixed, { count: 3, busy: false, onAnyway: () => undefined })));
    expect(line).toContain("3 of your boxes aren't mixed yet: a chain stopped before mixing them.");
    expect(line).toContain("They never come back by themselves, since each still shows where it went in. Mix my boxes again takes them first.");
    expect(line).toContain("Bring one back anyway");
    expect(renderToStaticMarkup(createElement(NotMixed, { count: 0, busy: false, onAnyway: () => undefined }))).toBe("");
  });

  const chains = createElement(Chains, {
    chains: [
      { session: 1, boxes: 3, total: 13, sent: 5, at: 1 },
      { boxes: 2, total: 9, sent: 4, at: 2, stopped: "The wallet locked, or the browser closed, while its chain was being sent." },
    ],
  });

  it("lists a chain being sent, which holds withdraws, and one stopped partway, with why", () => {
    const line = text(shown(chains));
    expect(line).toContain("Private session 2, 3 boxes Sending 5 of 13 transactions sent No box comes back until it's all sent.");
    expect(line).toContain(
      "From your public account, 2 boxes Stopped Stopped after 4 of 9 transactions Why it stopped: The wallet locked, or the browser closed, while its chain was being sent. Mix my boxes again mixes the boxes it didn't.",
    );
  });

  it("lists a chain's transactions while it's being sent, each by what it is and where it is, each opening its details (O3)", () => {
    const html = renderToStaticMarkup(
      createElement(
        NetworkContext.Provider,
        { value: "preprod" },
        shown(
          createElement(Chains, {
            chains: [
              {
                session: 1,
                boxes: 2,
                total: 4,
                sent: 2,
                at: 1,
                txs: [
                  { txHash: "a1".repeat(32), kind: "deposit", state: "landed" },
                  { txHash: "a2".repeat(32), kind: "mix", state: "sent" },
                  { txHash: "a3".repeat(32), kind: "mix", state: "waiting" },
                  { txHash: "a4".repeat(32), kind: "back", state: "waiting" },
                ],
              },
            ],
          }),
        ),
      ),
    );
    const line = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(line).toContain("Its transactions");
    expect(line).toContain("Deposit On chain Mix 1 Sent, not on chain yet Mix 2 Not sent yet Return Not sent yet");
    // Under a disclosure, so the row reads as before until it's opened.
    expect(html).toContain('<details class="disclosure chain-txs"');
    expect(html).toContain('data-testid="lovejoin-chain-tx-3-open"');
    // None while it isn't being sent: stopped, its transactions aren't held.
    expect(text(shown(chains))).not.toContain("Its transactions");
  });

  it("hides how many boxes with the balances, each being 10 ₳, but not how far a chain has got (privacy review §2.16)", () => {
    const line = text(chains);
    expect(line).toContain("Private session 2, •••• boxes Sending 5 of 13 transactions sent");
    expect(line).not.toMatch(/\d+ box/);
    const callout = text(createElement(NotMixed, { count: 1, busy: false, onAnyway: () => undefined }));
    expect(callout).toContain("Some of your boxes aren't mixed yet: a chain stopped before mixing them. They never come back by themselves");
    expect(text(shown(createElement(NotMixed, { count: 1, busy: false, onAnyway: () => undefined })))).toContain(
      "One of your boxes isn't mixed yet: a chain stopped before mixing it. It never comes back by itself",
    );
  });
});

describe("mixing a public mix's boxes again (privacy review §2.10)", () => {
  const notMixed = (count: number, fromPublic: number) =>
    text(shown(createElement(NotMixed, { count, fromPublic, busy: false, onAnyway: () => undefined })));

  it("sends boxes a mix from the public account left to Mix again from my public account, which ties nothing new", () => {
    expect(notMixed(2, 2)).toContain(
      "They came from your public account: Mix again from my public account takes them first, and ties nothing new.",
    );
    expect(notMixed(3, 1)).toContain(
      "Mix again from my public account takes those it put in; Mix my boxes again takes the rest.",
    );
    expect(notMixed(2, 0)).toContain("Mix my boxes again takes them first.");
  });

  const payments = [
    { to: "addr_test1", lovelace: "9100000", tokens: [] },
    { to: "addr_test1", lovelace: "5000000", tokens: [] },
  ];
  const funding = { boxes: 2, again: true, owned: 2, lovelace: "9100000", mixes: 8, mixFees: "6600000", depth: 2, delay: "1-6" };

  it("says what paying from the private balance anyway ties, on its review", () => {
    const summary = { index: 4, address: "addr_test1" + "q".repeat(50), payments, fee: { total: "200000" }, changeLovelace: "1000000" };
    const review = (publicToo: boolean) =>
      text(createElement(PrivateReview, { summary: { ...summary, mix: { ...funding, ...(publicToo ? { publicToo } : {}) } } as never }));
    expect(review(true)).toContain(
      "Some of these boxes came from your public account, so this ties the private UTxOs it spends to that account.",
    );
    // No box came from the public account: nothing says this ties to it on chain. (The giveme.my note names the
    // public account for another reason: Koios sees the payment from the IP address that reads it.)
    expect(review(false)).not.toContain("came from your public account");
    expect(review(false)).not.toContain("ties the private UTxOs it spends to that account");
  });

  it("reviews mixing them again from the public account: no deposit, and nothing new tied", () => {
    const line = text(
      createElement(PublicReview, {
        summary: { network: "preprod", txHash: "ab".repeat(32), entry: "11".repeat(32), boxes: 2, depth: 2, delay: "1-6", mixes: 8, txs: 8, fees: "6600000", change: "40000000", again: true },
      }),
    );
    expect(line).toContain("Mixed again 2 boxes your public account put in");
    // What leaves the account, the fees alone, not the chain's change (release review C41).
    expect(line).toContain("Total leaving your public account 6.6 ₳");
    expect(line).toContain("paying their mixes from it ties nothing new. Your private balance stays out of it");
    expect(line).not.toContain("Into Lovejoin");
  });
});

describe("what Lovejoin's page says a box's way back hides (privacy review §2.4, §2.6, §5.3)", () => {
  const payments = [
    { to: "addr_test1", lovelace: "20400000", tokens: [] },
    { to: "addr_test1", lovelace: "5000000", tokens: [] },
  ];
  const summary = { index: 4, address: "addr_test1" + "q".repeat(50), payments, fee: { total: "200000" }, changeLovelace: "1000000" };
  const funding = { boxes: 2, lovelace: "20400000", mixes: 8, mixFees: "6600000", depth: 2, delay: "1-6" };
  const publicMix = { network: "preprod", txHash: "ab".repeat(32), entry: "11".repeat(32), boxes: 2, depth: 2, delay: "1-6", mixes: 8, txs: 9, fees: "6600000", change: "40000000" } as const;

  it("says nothing on a box's way back names a session or an account, and that Koios and giveme.my see both ends", () => {
    const line = text(createElement(WayBack));
    expect(line).toContain("with nothing naming a session or account");
    expect(line).toContain("not from Koios or giveme.my, which see your device send both ends");
    expect(line).not.toContain("nothing ties it");
  });

  it("says what a mix's funding takes from the private balance, and what it holds after, not its change (blind test §9.8)", () => {
    const line = text(shown(createElement(PrivateReview, { summary: { ...summary, mix: funding } as never, before: "28000000" })));
    // 20.4 + 5 + 0.2 leave the 28 ₳.
    expect(line).toContain("For the boxes, their mixes and network fees 20.4 ₳ Kept aside for contracts 5 ₳, comes back Network fee 0.2 ₳");
    expect(line).toContain("Total leaving your private balance 25.6 ₳ Private balance after 2.4 ₳");
    expect(line).not.toContain("Change, back to your private balance");
  });

  it("says how far a box hides on a mix's review, never that the mixes hide which boxes are yours", () => {
    const reviews = [
      text(createElement(PrivateReview, { summary: { ...summary, mix: funding } as never })),
      text(createElement(PrivateReview, { summary: { ...summary, mix: { ...funding, again: true, owned: 2 } } as never })),
    ];
    for (const line of reviews) {
      expect(line).toContain("Yours is one of up to 9 boxes at 2 waves deep, fewer while few people use Lovejoin");
      expect(line).not.toContain("hide which boxes");
    }
    for (const again of [false, true]) {
      const line = text(createElement(PublicReview, { summary: { ...publicMix, ...(again ? { again } : {}) } }));
      expect(line).toContain(
        "while few people bring Lovejoin boxes into a Seedelf, yours can be picked out among those your account's mixes made",
      );
      expect(line).not.toContain("hide which boxes");
    }
    expect(text(createElement(PublicReview, { summary: publicMix }))).toContain("Anyone can see your public account paid this deposit and its mixes");
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

  it("says a mix found as the wallet unlocked goes on a few minutes after, not at once (privacy review §3.1)", () => {
    const waiting = mix({ stage: "open", auto: { step: "returning", stopping: false, filled: false, approvedMinOut: "0", waitsUntil: 60_000 } });
    expect(lovejoinSub(waiting, 0)).toBe("Funded: it goes on within 20 minutes of the unlock");
    // Past it, it's under way.
    expect(lovejoinSub(waiting, 120_000)).toBe("Funded: the mixes are built and sent next");
  });

  it("says in full why Lovejoin was left out: the pool below its floor", () => {
    const skipped = mix({
      mix: {
        boxes: 2,
        skipped: "Lovejoin's pool holds 12 boxes that aren't yours, and the wallet mixes only once it holds 30, so there's enough to mix with",
      },
    });
    expect(lovejoinSub(skipped, 0)).toBe("Came back without going into Lovejoin");
    expect(lovejoinDetail(skipped)).toBe(
      "Lovejoin was left out: Lovejoin's pool holds 12 boxes that aren't yours, and the wallet mixes only once it holds 30, so there's enough to mix with.",
    );
  });

  it("says a funding the chain hasn't shown may still land, and one turned away didn't go through", () => {
    const failed = mix({ stage: "failed", auto: { step: "funding", stopping: false, filled: false, approvedMinOut: "0" } });
    expect(lovejoinSub(failed, 0)).toBe("The chain hasn't shown its funding yet");
    expect(lovejoinDetail(failed)).toContain("It may still land: Try again looks for it.");
    expect(lovejoinSub({ ...failed, unsent: true }, 0)).toBe("Its funding didn't go through");
    expect(lovejoinDetail({ ...failed, unsent: true })).toBeUndefined();
  });
});

describe("Lovejoin's page before Review (chunk 23's second review, LJ-1, LJ-3)", () => {
  it("says whether the pool has others enough for a mix, and whether one wave deep would do", () => {
    // One box two waves deep: four mixes, two others each.
    expect(poolRoom({ others: 20, free: 20, floor: 0 }, 1, 2)).toEqual({ have: 20, need: 8, floorShort: false, fits: 2, shallower: true });
    // What a chain of the wallet's holds isn't drawn on.
    expect(poolRoom({ others: 20, free: 6, floor: 0 }, 1, 2)).toMatchObject({ have: 6, fits: 0, shallower: true });
    expect(poolRoom({ others: 1, free: 1, floor: 0 }, 1, 2)).toMatchObject({ fits: 0, shallower: false });
    // Under mainnet's floor, nothing mixes, whatever the room.
    expect(poolRoom({ others: 12, floor: 30 }, 1, 1)).toMatchObject({ floorShort: true, have: 12 });
  });

  it("says what a mix takes, all told, and the rows add up (blind test §9.8, T11)", () => {
    // One box two waves deep from the private balance: WebAssembly's 15.3 ₳ is the 10 ₳ box, its four mixes at 0.95 ₳
    // and a 1.5 ₳ reserve for the deposit's fee and the change.
    const one = mixCosts({ boxes: 1, lovelace: "15300000", mixFees: "3800000" }, "private");
    expect(one).toMatchObject({ boxes: 10_000_000n, mixFees: 3_800_000n, reserve: 1_500_000n, txs: 3 });
    // Used up: the mixes, three network fees (this payment, the deposit, the return) at about 0.25 ₳, and 0.3 ₳ to
    // bring the box back: 4.85 ₳, 48.5% of the 10 ₳.
    expect(one.cost).toBe(3_800_000n + 750_000n + 300_000n);
    // Leaving now: 15.3 + 5 kept aside + this payment's fee, about 20.55 ₳. Back once it's mixed: the 5 ₳ and what the
    // reserve leaves (1.5 − 0.5), 6 ₳; back later: the box, less its way back, 9.7 ₳.
    expect(one.leaving).toBe(20_550_000n);
    expect(one.soon).toBe(6_000_000n);
    expect(one.later).toBe(9_700_000n);
    expect(one.cost + one.soon + one.later).toBe(one.leaving);
    // From the public account: the box, its mixes and the deposit's fee leave; nothing comes back but the box.
    const pub = mixCosts({ boxes: 1, lovelace: "15300000", mixFees: "3800000" }, "public");
    expect(pub).toMatchObject({ txs: 1, cost: 4_350_000n, leaving: 14_050_000n, soon: 0n, later: 9_700_000n });
    expect(pub.cost + pub.later).toBe(pub.leaving);
    // Two boxes: 29.1 ₳ planned, every figure per box but the reserve and the fees.
    const two = mixCosts({ boxes: 2, lovelace: "29100000", mixFees: "7600000" }, "private");
    expect(two).toMatchObject({ reserve: 1_500_000n, cost: 8_950_000n, leaving: 34_350_000n, soon: 6_000_000n, later: 19_400_000n });
  });

  it("offers no more boxes than the private balance pays for, with the collateral and the fee aside", () => {
    // One box two waves deep takes 15.3 ₳: 13.8 ₳ a box, and 1.5 ₳ besides.
    const one = { boxes: 1, lovelace: "15300000", mixFees: "3800000" };
    expect(boxesAffordable("28000000", one)).toBe(1);
    expect(boxesAffordable("21000000", one)).toBe(0);
    expect(boxesAffordable("50000000", one)).toBe(3);
    // Worked out the same from a funding for three.
    expect(boxesAffordable("50000000", { boxes: 3, lovelace: "42900000", mixFees: "11400000" })).toBe(3);
  });
});

describe("a session's funding refused at Send (chunk 23's second review, DX-1)", () => {
  const foot = (refusal: Parameters<typeof SessionRefusedFoot>[0]["refusal"], onWatch?: () => void) =>
    text(createElement(SessionRefusedFoot, { refusal, busy: false, onAgain: () => undefined, onWatch }));

  it("gives way to building it again, with no service named up front and its words under Details", () => {
    const detail = "giveme.my, which lends the collateral, refused this transaction: Transaction Fails Validation.";
    const changed = foot({ kind: "again", changed: true, detail });
    expect(changed).toMatch(/^Nothing was sent: something it spends may have changed since you reviewed it\./);
    expect(changed).toContain("Details " + detail);
    expect(changed).toContain("Build it again");
    expect(foot({ kind: "again", detail })).toContain("Nothing was sent, and this review can't go again");
  });

  it("names giveme.my when it refused, says the money didn't move, and what to try if it does again (blind test §9.5)", () => {
    const detail = "giveme.my, which lends the collateral, refused this transaction: Transaction Fails Validation.";
    const refused = foot({ kind: "again", by: "giveme", detail });
    expect(refused).toMatch(/^Nothing was sent, so none of your money moved: giveme\.my, which lends the collateral, turned it down\./);
    expect(refused).toContain("Build it again, and if it's turned down again, wait a few minutes.");
    expect(refused).not.toContain("something it spends");
    expect(refused).toContain("Details " + detail);
    expect(refused).toContain("Build it again");
    expect(foot({ kind: "again", by: "givemeBusy", detail })).toContain("couldn't take it just now. Wait a few minutes, then build it again");
  });

  it("isn't built again when it may have gone out: its page watches for it", () => {
    const watch = foot({ kind: "watch", detail: "Koios didn't answer." }, () => undefined);
    expect(watch).toContain("It may have gone out all the same, so it isn't built again");
    expect(watch).toContain("See where it is");
    expect(watch).not.toContain("Build it again");
    expect(foot({ kind: "watch", detail: "x" })).not.toContain("See where it is");
  });
});
