// 1.6.0's release review, the approvals, the swap form and the swaps page (fixer sc-o-1): 323-worker#1, a swap's and a
// site's costs counting the collateral's mix their funding pays for; 323-worker#6 and gap-3#2, where those reviews say
// that 5 ₳ goes; x-privacy#1, giveme.my seeing that mix on a swap that then runs itself; 319-worker#0's screens, one
// true line where Lovejoin's pool takes nothing; 320-screens#3, Building… while a review is built again; 322#0 and
// 322#1, the transaction under a retry's Details. Rendered as the pages show them, in English. Each failed before its
// fix.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { t } from "../src/i18n";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import type { LovejoinFunding, SessionOutSummary, SessionView, SwapLovejoin, SwapQuote } from "../src/shared/rpc";
import { SendButton } from "../src/ui/components/SendButton";
import { NetworkContext } from "../src/ui/network";
import { PreferencesContext } from "../src/ui/preferences";
import { FundingWayBack } from "../src/ui/screens/DappApprovals";
import { PrivateReview, reviewHint } from "../src/ui/screens/Lovejoin";
import { TopUpCollateralNote } from "../src/ui/screens/SiteSessions";
import { Session, StopDialog, SwapApproval } from "../src/ui/screens/Swaps";
import { swapCosts } from "../src/ui/swap";

/** A page's markup, balances shown, on preprod. */
const markup = (element: ReactElement) =>
  renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      { value: "preprod" },
      createElement(
        PreferencesContext.Provider,
        { value: { prefs: { ...DEFAULT_PREFERENCES, hideBalances: false }, loaded: true, set: async () => undefined } },
        element,
      ),
    ),
  );

/** What a person reads of it. */
const text = (element: ReactElement) =>
  markup(element)
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();

/** MIN, on preprod's token list. */
const MIN = { policyId: "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed72", assetName: "4d494e" };
const MIN_UNIT = MIN.policyId + MIN.assetName;

/** The recorded preprod swap: 10 ₳ for MIN, 6 ₳ of costs on top, 5 ₳ kept aside. */
const quote: SwapQuote = {
  network: "preprod",
  ask: { amount: "10000000", tokenIn: "lovelace", tokenOut: MIN_UNIT, slippage: 1 },
  amountIn: "10000000",
  amountOut: "906594100",
  minAmountOut: "902083681",
  dexFee: "2000000",
  deposits: "2000000",
  aggregatorFee: "0",
  priceImpact: 0.34,
  route: ["MinswapV2"],
  fund: { lovelace: "16000000", tokens: [] },
  collateral: "5000000",
  verified: true,
};

/** Its funding, as the worker built it (323-worker#1's reproduction): with the chain's 1.5 ₳ for the collateral's mix, or none. */
const funding = (reserve: boolean): SessionOutSummary => ({
  network: "preprod",
  txHash: "ab".repeat(32),
  index: 2,
  address: "addr_test1" + "q".repeat(50),
  payments: [
    { address: "addr_test1" + "q".repeat(50), own: false, lovelace: reserve ? "17500000" : "16000000", minimum: null, tokens: [] },
    { address: "addr_test1" + "q".repeat(50), own: false, lovelace: "5000000", minimum: null, tokens: [] },
  ],
  max: false,
  fee: { size: "0", compute: "0", scriptReference: "0", total: "233208" },
  changeLovelace: "0",
  changeTokens: 0,
  changeOutputs: 1,
  changeMinimum: "0",
  inputs: 1,
  left: 0,
  ...(reserve ? { collateralReserve: "1500000" } : {}),
});
/**
 * Its funding with the reserve where the worker says its return keeps it for that mix, so the approval says it's mixed
 * (CollateralMix; 1.6.0's review of the fixes, fx-promise): an ADA fill's, or a token's with boxes of its own.
 */
const mixedFunding = (): SessionOutSummary => ({ ...funding(true), collateralMix: "mixed" });
/** A site's funding or top-up with the reserve: what the site leaves decides that mix, so only if enough is left (fx-promise). */
const siteFunding = (): SessionOutSummary => ({ ...funding(true), collateralMix: "ifLeft" });

/** Its spare ADA pays for no 10 ₳ box (the reproduction's): it comes back directly, and its collateral's mix still goes. */
const noBox: SwapLovejoin = { boxes: 0, depth: 1, mixes: 0, mixFees: "0", withdrawFees: "0", delay: "1-6", on: true };

const approval = (summary: SessionOutSummary, lovejoin: SwapLovejoin | undefined = noBox, through = true) =>
  text(
    createElement(SwapApproval, {
      summary,
      quote,
      lovejoin,
      pay: { id: "lovelace", side: { label: "₳", decimals: 6 } },
      get: { id: MIN_UNIT, side: { label: "MIN", decimals: 6 } },
      through,
      onThrough: () => undefined,
      busy: false,
    }),
  );

describe("1.6.0's release review: a swap's costs count the collateral's mix its funding pays for (323-worker#1)", () => {
  it("adds that mix's deposit, the mix and its box's way back to what it costs, and takes them out of what comes back", () => {
    const leaving = { paid: 22_500_000n, fee: 233_208n };
    const without = swapCosts(quote, leaving);
    // About 0.25 ₳ for its deposit, 0.95 ₳ for the mix under giveme.my's collateral, 0.3 ₳ for its box's way back.
    const mixed = swapCosts(quote, leaving, undefined, 1_500_000n);
    expect(mixed.collateral).toBe(1_500_000n);
    expect(mixed.cost - without.cost).toBe(1_500_000n);
    expect(without.back - mixed.back).toBe(1_500_000n);
    // What leaves is what leaves, and the parts still add up to it.
    expect(mixed.leaving).toBe(without.leaving);
    expect(mixed.leaving - 10_000_000n - mixed.cost).toBe(mixed.back);
    expect(swapCosts(quote, leaving).collateral).toBe(0n);
  });

  it("says so on the approval: in the total, as a part of it, and not as coming back", () => {
    const line = approval(funding(true));
    // 2.733208 ₳ as before, and about 1.5 ₳ for the collateral's mix: about 4.23 ₳. Back: 22.733208 − 10 − 4.233208.
    expect(line).toContain(
      "Costs in all, about 4.23 ₳ DEX fee 2 ₳ Network fees, about 0.73 ₳ Its collateral's mix, about 1.5 ₳ Comes back, about 906.5941 MIN and 8.5 ₳",
    );
    // A funding that pays nothing for it: as before, no such part.
    const plain = approval(funding(false));
    expect(plain).toContain("Costs in all, about 2.73 ₳ DEX fee 2 ₳ Network fees, about 0.73 ₳ Comes back, about 906.5941 MIN and 8.5 ₳");
    expect(plain).not.toContain("Its collateral's mix");
  });
});

describe("1.6.0's release review: a site's funding review counts the collateral's mix in the way back (323-worker#1)", () => {
  const wayBack = (reserve: boolean) => text(createElement(FundingWayBack, { fee: "233208", lovejoin: true, perBox: "4.1", summary: funding(reserve) }));

  it("as a part of the network fees both ways", () => {
    const mixed = wayBack(true);
    expect(mixed).toContain("Its collateral's mix, about 1.5 ₳");
    // 0.233208 + 2 × about 0.25 + about 1.5: about 2.23 ₳.
    expect(mixed).toContain("Network fees both ways, about 2.23 ₳");
    // None paid for: as before.
    const plain = wayBack(false);
    expect(plain).not.toContain("Its collateral's mix");
    expect(plain).toContain("Network fees both ways, about 0.73 ₳");
  });
});

describe("1.6.0's release review: where the reviews that pay for the collateral's mix say its 5 ₳ goes (323-worker#6, gap-3#2)", () => {
  it("a site's funding review never says the 5 ₳ comes back at once", () => {
    // Mixed only if enough is left, since 1.6.0's review of the fixes (fx-promise): what the site leaves decides.
    const mixed = text(createElement(FundingWayBack, { fee: "233208", lovejoin: true, perBox: "4.1", summary: siteFunding() }));
    expect(mixed).not.toContain("the 5 ₳ come back at once");
    expect(mixed).toContain("Lovejoin mixes the spare ADA in 10 ₳ boxes, and the 5 ₳ once, in a box of its own, only if enough is left");
    expect(mixed).toContain("The rest comes back at once.");
    // Paid nothing for, as before: the 5 ₳ comes back with the rest.
    expect(text(createElement(FundingWayBack, { fee: "233208", lovejoin: true, perBox: "4.1", summary: funding(false) }))).toContain(
      "The rest and the 5 ₳ come back at once.",
    );
  });

  it("a site's top-up never says its new 5 ₳ comes back with the next return", () => {
    const mixed = text(createElement(TopUpCollateralNote, { summary: siteFunding() }));
    expect(mixed).not.toContain("comes back with the next return");
    expect(mixed).toContain(
      "At the next return it's mixed once, in a box of its own, only if enough is left, then comes back by itself; if not, it comes back with that return.",
    );
    expect(text(createElement(TopUpCollateralNote, { summary: funding(false) }))).toContain("It comes back with the next return.");
  });

  it("a swap's approval never says everything left comes back at once or directly, its 5 ₳ included", () => {
    const mixed = approval(mixedFunding());
    expect(mixed).not.toContain("The proceeds and everything left, directly");
    expect(mixed).not.toContain("so it all comes back at once");
    expect(mixed).toContain("The proceeds and the rest directly; its 5 ₳ collateral in a Lovejoin box, later");
    expect(mixed).toContain("Too little spare ADA for a Lovejoin box, so all but its 5 ₳ collateral comes back at once.");
    // Paid nothing for: as before.
    const plain = approval(funding(false));
    expect(plain).toContain("The proceeds and everything left, directly");
    expect(plain).toContain("Too little spare ADA for a Lovejoin box, so it all comes back at once.");
  });

  it("each of the Plan's ways back, with its 5 ₳ in a box of its own", () => {
    // Its spare ADA in a box too: an ADA→token swap's Plan.
    const boxed: SwapLovejoin = { ...noBox, boxes: 1, mixes: 1, mixFees: "950000", withdrawFees: "300000" };
    expect(approval(mixedFunding(), boxed)).toContain("The proceeds and the rest at once; spare ADA and its 5 ₳ collateral in Lovejoin boxes, later");
    expect(approval(funding(false), boxed)).toContain("The proceeds and the rest at once; spare ADA in Lovejoin boxes, later");
  });
});

describe("1.6.0's release review: a swap's approval says giveme.my sees its collateral's mix (x-privacy#1)", () => {
  it("where its funding pays for that mix, beside what giveme.my sees of the payment", () => {
    const mixed = approval(mixedFunding());
    expect(mixed).toContain("giveme.my backs its collateral's mix too, so it sees that mix.");
    expect(mixed).toContain("If that mix can't go, its 5 ₳ box waits unmixed, tied to this session.");
    expect(approval(funding(false))).not.toContain("giveme.my backs its collateral's mix");
  });
});

describe("1.6.0's release review: where Lovejoin's pool takes nothing, the swap's screens say only that (319-worker#0)", () => {
  // Four asked, and the classic pool short at both widths, as the worker said it before wlj-4's fix: the reason four
  // goes three beside why nothing goes at all.
  const short: SwapLovejoin = {
    ...noBox,
    of: 3,
    width: 4,
    skipped: "Right now Lovejoin's pool holds 12 boxes that aren't yours, under the 30 it needs",
    fellBack: t("lj.width.warn.short"),
  };

  it("on the approval: its ADA comes back directly, never also that it mixes three at a time", () => {
    const line = approval(funding(false), short);
    expect(line).toContain("so as things are, this swap's ADA comes back directly");
    expect(line).not.toContain("three at a time");
  });

  it("and Stop's dialog, likewise", () => {
    const dialog = text(
      createElement(StopDialog, { placed: false, cost: short, through: true, onThrough: () => undefined, busy: false, onStop: () => undefined, onClose: () => undefined }),
    );
    // Its ADA, which the line says since 1.6.0's review of the fixes (last-3c, 5).
    expect(dialog).toContain("so its ADA would come back directly");
    expect(dialog).not.toContain("three at a time");
  });

  it("but says why four went three where something goes through Lovejoin", () => {
    const mixing: SwapLovejoin = { ...noBox, boxes: 1, mixes: 1, mixFees: "950000", withdrawFees: "300000", fellBack: t("lj.width.warn.short") };
    expect(approval(funding(false), mixing)).toContain("so this mixes three at a time");
  });
});

describe("1.6.0's release review: a review built again by its switch or Change says Building…, never Sending… (320-screens#3)", () => {
  const button = (props: Partial<Parameters<typeof SendButton>[0]>) =>
    text(createElement(SendButton, { label: "Start swap", busy: false, onClick: () => undefined, ...props }));

  it("names the act while nothing runs, Building… while it's built again, and its sending words only while it's sent", () => {
    expect(button({})).toBe("Start swap");
    expect(button({ busy: true, rebuilding: true })).toBe("Building…");
    expect(button({ busy: true, rebuilding: true, sending: "Sending 4 of 5 transactions…" })).toBe("Building…");
    expect(button({ busy: true })).toBe("Sending…");
    expect(button({ busy: true, sending: "Sending 4 of 5 transactions…" })).toBe("Sending 4 of 5 transactions…");
  });

  it("is pressed once: it waits while anything runs", () => {
    expect(markup(createElement(SendButton, { label: "Send", busy: true, rebuilding: true, onClick: () => undefined }))).toMatch(/<button[^>]*disabled/);
  });
});

describe("1.6.0's release review: the transaction under a retry's Details (322#0, 322#1)", () => {
  const CBOR = "84a4" + "00".repeat(400);
  /** 10 ₳ for MIN, a swap that runs itself, whose order Minswap built and couldn't run, on its side. */
  const failing: SessionView = {
    index: 0,
    network: "preprod",
    address: "addr_test1" + "q".repeat(50),
    createdAt: 0,
    stage: "open",
    txs: [{ kind: "out", txHash: "ab".repeat(32), at: 0, confirmed: true }],
    swap: {
      amount: "10000000",
      tokenIn: "lovelace",
      tokenOut: MIN_UNIT,
      slippage: 0.5,
      amountOut: "906594100",
      minAmountOut: "902083681",
      display: { in: { label: "₳", decimals: 6 }, out: { label: "MIN", decimals: 6 } },
    },
    holding: { lovelace: "21000000", tokens: [], utxos: 2 },
    auto: {
      step: "ordering",
      stopping: false,
      filled: false,
      approvedMinOut: "902083681",
      retry: { at: Date.now() + 60_000, error: "Minswap refused it (500): failed", reason: "minswap-build-failed", cbor: CBOR },
    },
  };
  const page = () => markup(createElement(Session, { session: failing, reading: false, onRefresh: () => undefined, onBack: () => undefined, onChanged: () => undefined }));

  it("says, beside Copy, that it ties whoever sends it to the swap's one-time account (322#0)", () => {
    const html = page();
    const details = html.slice(html.indexOf("<details"), html.indexOf("</details>"));
    const words = details.replace(/<[^>]+>/g, " ").replaceAll("&#x27;", "'").replace(/\s+/g, " ");
    expect(words).toContain("for a report to Minswap");
    expect(words).toContain("Whoever you send it to can tie this swap's one-time account, and the private UTxOs that funded it, to you.");
  });

  it("keeps it out of the line read aloud as the retry changes (322#1)", () => {
    // Every element open around the transaction's <pre>, as the markup nests them: none of them is a live region.
    const html = page();
    const open: string[] = [];
    let around: string[] | undefined;
    for (const tag of html.matchAll(/<(\/?)([a-z0-9]+)([^>]*?)(\/?)>/g)) {
      const [, closing, name, attrs, selfClosing] = tag;
      if (closing) {
        open.pop();
        continue;
      }
      if (name === "pre" && attrs!.includes('data-testid="session-retry-cbor"')) around = [...open];
      if (!selfClosing && !["br", "img", "input", "meta", "hr"].includes(name!)) open.push(attrs!);
    }
    expect(around, "the transaction's <pre> wasn't on the page").toBeDefined();
    expect(around!.filter((attrs) => /aria-live="(polite|assertive)"/.test(attrs))).toEqual([]);
    // The words around it still are: why, and when it tries again.
    expect(html).toMatch(/aria-live="polite"[^>]*>[^<]*<p>The swap Minswap built failed when Minswap ran it/);
  });
});

// Round 3b (fixer fx-reserve-1): what a review says of the collateral's mix follows what the return will do, from the
// summary the worker built (R3-1, R3-9), and Stop's dialog says it too (L1). A funding the private balance couldn't
// also pay the reserve for keeps saying a 5 ₳ pool takes the collateral, which the return mixes where what's left pays
// for that: since 1.6.0's review of the fixes (fx-promise), mixed only if enough is left (`collateralMix`).
describe("1.6.0's release review, round 3b: the reviews' collateral words follow what the return does (R3-1, R3-9, L1)", () => {
  /** A funding with its reserve (a pool takes the collateral), funded without it while a pool takes it, or with neither. */
  const paid = (): SessionOutSummary => ({ ...funding(false), collateralReserve: "2800000", collateralMix: "ifLeft" });
  const fallback = (): SessionOutSummary => ({ ...funding(false), collateralMix: "ifLeft" });
  const plain = () => funding(false);
  const wayBack = (summary: SessionOutSummary) => text(createElement(FundingWayBack, { fee: "233208", lovejoin: true, perBox: "4.1", summary }));
  const MIXED_ONCE = "Lovejoin mixes the spare ADA in 10 ₳ boxes, and the 5 ₳ once, in a box of its own, only if enough is left";

  it("a site's funding review counts the mix only where its reserve is paid, and says the 5 ₳ is mixed wherever a pool takes it (R3-1, R3-9)", () => {
    const reserved = wayBack(paid());
    expect(reserved).toContain("Its collateral's mix, about 1.5 ₳");
    expect(reserved).toContain("Network fees both ways, about 2.23 ₳");
    expect(reserved).toContain(MIXED_ONCE);
    // Funded without the reserve, a pool taking the collateral all the same: mixed where what's left pays, and no cost
    // row for what it didn't pay.
    const without = wayBack(fallback());
    expect(without).toContain(MIXED_ONCE);
    expect(without).not.toContain("the 5 ₳ come back at once");
    expect(without).not.toContain("Its collateral's mix");
    expect(without).toContain("Network fees both ways, about 0.73 ₳");
    // No pool takes it: as before.
    expect(wayBack(plain())).toContain("The rest and the 5 ₳ come back at once.");
  });

  it("a site's top-up says its new 5 ₳ is mixed wherever a pool takes it, its reserve paid or not (R3-1, R3-9)", () => {
    const note = (summary: SessionOutSummary) => text(createElement(TopUpCollateralNote, { summary }));
    const mixedOnce = "At the next return it's mixed once, in a box of its own, only if enough is left, then comes back by itself;";
    expect(note(paid())).toContain(mixedOnce);
    expect(note(fallback())).toContain(mixedOnce);
    expect(note(plain())).toContain("It comes back with the next return.");
  });

  /** MIN sold for about 9.8 ₳, the MIN and about 6 ₳ of costs funded: a swap whose fill is ADA. */
  const sale: SwapQuote = {
    ...quote,
    ask: { amount: "906594100", tokenIn: MIN_UNIT, tokenOut: "lovelace", slippage: 1 },
    amountIn: "906594100",
    amountOut: "9800000",
    minAmountOut: "9702000",
    fund: { lovelace: "6000000", tokens: [{ ...MIN, quantity: "906594100" }] },
  };
  /** Its funding, without the reserve: the MIN and its costs, and the 5 ₳. */
  const sold = (summary: SessionOutSummary): SessionOutSummary => ({
    ...summary,
    payments: [{ ...summary.payments[0]!, lovelace: "6000000", tokens: [{ ...MIN, quantity: "906594100" }] }, summary.payments[1]!],
  });
  const selling = (summary: SessionOutSummary) =>
    text(
      createElement(SwapApproval, {
        summary: sold(summary),
        quote: sale,
        lovejoin: noBox,
        pay: { id: MIN_UNIT, side: { label: "MIN", decimals: 6 } },
        get: { id: "lovelace", side: { label: "₳", decimals: 6 } },
        through: true,
        onThrough: () => undefined,
        busy: false,
      }),
    );

  it("a swap's approval funded without the reserve: mixed only if enough is left, its fill ADA or a token, never said mixed (R3-9; fx-promise)", () => {
    // MIN for ADA: its fill is ADA alone, which may pay for that mix as it comes back, or not, after its boxes and fees.
    // As text() reads it: its no-break space before ₳ is whitespace there.
    const ifLeft = t("lovejoin.collateralMix.privacy.ifLeft").replace(/\s+/g, " ");
    const out = selling(fallback());
    expect(out).toContain("Too little spare ADA for a Lovejoin box, so it all comes back at once.");
    expect(out).toContain("The proceeds and everything left, directly");
    expect(out).toContain(ifLeft);
    expect(out).not.toContain("giveme.my backs its collateral's mix too");
    // Nothing paid for it beside the swap: no cost row for it, the cost comes from what comes back.
    expect(out).not.toContain("Its collateral's mix, about");
    // No pool takes it: as before.
    expect(selling(plain())).toContain("The proceeds and everything left, directly");
    expect(selling(plain())).not.toContain(ifLeft);
    // ADA for MIN: a stop or a refund may leave enough for it, so the same words.
    const into = approval(fallback());
    expect(into).toContain("The proceeds and everything left, directly");
    expect(into).toContain(ifLeft);
    expect(into).not.toContain("giveme.my backs its collateral's mix too");
    expect(into).not.toContain("Its collateral's mix, about");
  });

  it("Stop's dialog says the collateral is mixed under giveme.my's collateral wherever its return goes through Lovejoin (L1)", () => {
    const boxed: SwapLovejoin = { ...noBox, boxes: 1, mixes: 1, mixFees: "950000", withdrawFees: "300000" };
    const dialog = (cost: SwapLovejoin, through = true) =>
      text(createElement(StopDialog, { placed: false, cost, through, onThrough: () => undefined, busy: false, onStop: () => undefined, onClose: () => undefined }));
    // In its own words, without the approval's "too" (the last look, LW-1, below).
    expect(dialog({ ...boxed, collateralMix: "mixed" })).toContain("giveme.my backs its collateral's mix, so it sees that mix.");
    // Its spare pays no box, and Stop still brings it back through Lovejoin, its collateral mixed first.
    expect(dialog({ ...noBox, collateralMix: "mixed" })).toContain("giveme.my backs its collateral's mix, so it sees that mix.");
    // Brought back directly, or no pool takes the collateral: nothing of it.
    expect(dialog({ ...boxed, collateralMix: "mixed" }, false)).not.toContain("giveme.my backs");
    expect(dialog(boxed)).not.toContain("giveme.my backs");
  });
});

// Round 3b's last look (fixer fx-last), LW-1: Stop's dialog where its return mixes the collateral and Stop isn't direct
// (no box, so no switch) said everything came back for the return's fee alone, then that the collateral was mixed. It
// says what the approval says: all but the 5 ₳ collateral comes back, and that 5 ₳ later, mixed. Its giveme.my line drops
// the approval's "too", which points at GivemeNote there, a note this dialog doesn't have.
describe("1.6.0's review of the fixes, the last look: Stop's dialog says where its 5 ₳ goes where it's mixed (LW-1)", () => {
  const boxed: SwapLovejoin = { ...noBox, boxes: 1, mixes: 1, mixFees: "950000", withdrawFees: "300000" };
  const dialog = (cost: SwapLovejoin, { placed = false, pools = false, through = true } = {}) =>
    text(createElement(StopDialog, { placed, pools, cost, through, onThrough: () => undefined, busy: false, onStop: () => undefined, onClose: () => undefined }));
  const MIXED = "everything but its 5 ₳ collateral comes back to your private balance, less network fees; the 5 ₳ comes back later, mixed once.";

  it("with no box, never says everything comes back for one fee: all but its 5 ₳, which comes back later, mixed", () => {
    for (const [placed, pools, lead] of [
      [false, false, "If no order has gone out yet, none will, and "],
      [false, true, "If the swap hasn't gone out yet, it won't, and "],
      [true, false, "The order is cancelled, unless it fills first, and "],
    ] as const) {
      const said = dialog({ ...noBox, collateralMix: "mixed" }, { placed, pools });
      expect(said, lead).toContain(lead + MIXED);
      expect(said, lead).not.toContain("everything comes back to your private balance");
      expect(said, lead).not.toContain("less the return's network fee");
      expect(said, lead).not.toContain("The cancel and the return each cost a network fee.");
    }
    // Lovejoin's pool short: the same, and why its ADA comes back directly.
    const short = dialog({ ...noBox, of: 1, skipped: "Right now Lovejoin's pool holds 12 boxes that aren't yours, under the 30 it needs", collateralMix: "mixed" });
    expect(short).toContain(MIXED);
    expect(short).toContain("under the 30 it needs, so its ADA would come back directly");
  });

  it("says giveme.my backs that mix in its own words, without the approval's \"too\"", () => {
    for (const cost of [{ ...noBox, collateralMix: "mixed" as const }, { ...boxed, collateralMix: "mixed" as const }]) {
      const said = dialog(cost);
      expect(said).toContain("giveme.my backs its collateral's mix, so it sees that mix. If that mix can't go, its 5 ₳ box waits unmixed, tied to this session.");
      expect(said).not.toContain("mix too");
    }
  });

  it("is as before where the collateral isn't mixed, or Stop brings it back directly", () => {
    expect(dialog(noBox)).toContain("everything comes back to your private balance, less the return's network fee.");
    expect(dialog(noBox, { placed: true })).toContain("The cancel and the return each cost a network fee.");
    // A box and the switch off: Stop goes directly, its collateral with the rest, as the switch's note says.
    const direct = dialog({ ...boxed, collateralMix: "mixed" }, { through: false });
    expect(direct).toContain("everything comes back to your private balance, less the return's network fee.");
    expect(direct).not.toContain(MIXED);
    expect(direct).not.toContain("giveme.my");
    // Through Lovejoin with a box: its boxes' words, as before.
    const through = dialog({ ...boxed, collateralMix: "mixed" });
    expect(through).toContain("Its ADA goes through Lovejoin first");
    expect(through).not.toContain(MIXED);
  });
});

// The collateral's mix by one rule (fixer fx-promise, after the last look at round 3c's fixes, review/last-3c.md). Each
// screen says it one of three ways, from what the worker decided (`collateralMix`): mixed, in its definite words with
// giveme.my's line, where its funding paid the reserve and the return keeps it for that mix; mixed only if enough is
// left, giveme.my's part said so it holds either way, wherever else a 5 ₳ pool may take it; nothing where no mix can go.
// What each counts as a cost follows the reserve paid, never the words.
describe("1.6.0's review of the fixes, fx-promise: each screen says the collateral's mix one of three ways (last-3c)", () => {
  const DEFINITE = "giveme.my backs its collateral's mix too, so it sees that mix.";
  const STOP_DEFINITE = "giveme.my backs its collateral's mix, so it sees that mix.";
  // As text() reads it: its no-break space before ₳ is whitespace there.
  const IF_LEFT = () => t("lovejoin.collateralMix.privacy.ifLeft").replace(/\s+/g, " ");
  const COST = "Its collateral's mix, about 1.5 ₳";
  const boxed: SwapLovejoin = { ...noBox, boxes: 1, mixes: 1, mixFees: "950000", withdrawFees: "300000" };
  /** The swap's funding, its reserve paid or not, the worker's word for the collateral's mix. */
  const summaryOf = (reserve: boolean, mix?: "mixed" | "ifLeft"): SessionOutSummary => ({ ...funding(reserve), ...(mix ? { collateralMix: mix } : {}) });

  it("the swap approval: mixed, only if enough is left, or nothing, its cost row on the reserve alone", () => {
    for (const l of [noBox, boxed]) {
      const box = l.boxes ? "a box" : "no box";
      const mixed = approval(summaryOf(true, "mixed"), l);
      expect(mixed, box).toContain(DEFINITE);
      expect(mixed, box).toContain("its 5 ₳ collateral in");
      expect(mixed, box).not.toContain(IF_LEFT());
      expect(mixed, box).toContain(COST);
      // Paid for, its fill not keeping the reserve for that mix (a token's, which may come against the pools): only if
      // enough is left, its cost still counted, never the definite words.
      const paid = approval(summaryOf(true, "ifLeft"), l);
      expect(paid, box).not.toContain(DEFINITE);
      expect(paid, box).not.toContain("its 5 ₳ collateral in");
      expect(paid, box).toContain(IF_LEFT());
      expect(paid, box).toContain(COST);
      // Not paid for, a pool taking it: the same words, no cost row.
      const short = approval(summaryOf(false, "ifLeft"), l);
      expect(short, box).toContain(IF_LEFT());
      expect(short, box).not.toContain(DEFINITE);
      expect(short, box).not.toContain("Its collateral's mix");
      // No mix can go: nothing of it.
      const plain = approval(summaryOf(false), l);
      expect(plain, box).not.toContain(IF_LEFT());
      expect(plain, box).not.toContain("giveme.my backs its collateral's mix");
      expect(plain, box).not.toContain("its 5 ₳ collateral in");
    }
    // No box: where it's mixed all but the 5 ₳ comes back at once; otherwise it all does, the line saying when it may not.
    expect(approval(summaryOf(true, "mixed"))).toContain("so all but its 5 ₳ collateral comes back at once.");
    expect(approval(summaryOf(false, "ifLeft"))).toContain("so it all comes back at once.");
  });

  const dialog = (cost: SwapLovejoin, { placed = false, pools = false, through = true } = {}) =>
    text(createElement(StopDialog, { placed, pools, cost, through, onThrough: () => undefined, busy: false, onStop: () => undefined, onClose: () => undefined }));

  it("Stop's dialog: mixed, only if enough is left, or nothing, and nothing where Stop brings it back directly", () => {
    // No box, so no switch: mixed, all but its 5 ₳ comes back and the 5 ₳ later; only if enough is left, everything
    // comes back, no fee named for it alone; nothing, everything for the return's fee.
    for (const [placed, pools, lead] of [
      [false, false, "If no order has gone out yet, none will, and "],
      [false, true, "If the swap hasn't gone out yet, it won't, and "],
      [true, false, "The order is cancelled, unless it fills first, and "],
    ] as const) {
      const mixed = dialog({ ...noBox, collateralMix: "mixed" }, { placed, pools });
      expect(mixed, lead).toContain(lead + "everything but its 5 ₳ collateral comes back to your private balance, less network fees; the 5 ₳ comes back later, mixed once.");
      expect(mixed, lead).toContain(STOP_DEFINITE);
      expect(mixed, lead).not.toContain(IF_LEFT());
      const ifLeft = dialog({ ...noBox, collateralMix: "ifLeft" }, { placed, pools });
      expect(ifLeft, lead).toContain(lead + "everything comes back to your private balance.");
      expect(ifLeft, lead).not.toContain("less the return's network fee");
      expect(ifLeft, lead).not.toContain("everything but its 5 ₳");
      expect(ifLeft, lead).not.toContain(STOP_DEFINITE);
      expect(ifLeft, lead).toContain(IF_LEFT());
      const plain = dialog(noBox, { placed, pools });
      expect(plain, lead).not.toContain(IF_LEFT());
      expect(plain, lead).not.toContain("giveme.my backs");
    }
    expect(dialog({ ...noBox, collateralMix: "ifLeft" }, { placed: true })).toContain("The cancel costs a network fee too.");
    expect(dialog(noBox)).toContain("everything comes back to your private balance, less the return's network fee.");
    // A box, through Lovejoin: its boxes' words, and the collateral's line by the rule; directly, none.
    expect(dialog({ ...boxed, collateralMix: "mixed" })).toContain(STOP_DEFINITE);
    const ifLeft = dialog({ ...boxed, collateralMix: "ifLeft" });
    expect(ifLeft).toContain("Its ADA goes through Lovejoin first");
    expect(ifLeft).toContain(IF_LEFT());
    expect(ifLeft).not.toContain(STOP_DEFINITE);
    for (const collateralMix of ["mixed", "ifLeft"] as const) {
      const direct = dialog({ ...boxed, collateralMix }, { through: false });
      expect(direct, collateralMix).not.toContain(IF_LEFT());
      expect(direct, collateralMix).not.toContain("giveme.my");
    }
  });

  it("Stop's dialog: with Lovejoin's pool short, its ADA comes back directly, never the 5 ₳ said mixed just before it (last-3c, 5)", () => {
    const short = dialog({ ...noBox, of: 1, skipped: "Right now Lovejoin's pool holds 12 boxes that aren't yours, under the 30 it needs", collateralMix: "mixed" });
    expect(short).toContain("the 5 ₳ comes back later, mixed once.");
    expect(short).toContain("under the 30 it needs, so its ADA would come back directly, tied to this session on chain.");
  });

  it("a site's funding review and its top-up: only if enough is left wherever a pool may take it, never mixed, its cost row on the reserve alone", () => {
    const wayBack = (summary: SessionOutSummary, lovejoin = true) => text(createElement(FundingWayBack, { fee: "233208", lovejoin, perBox: "4.1", summary }));
    const note = (summary: SessionOutSummary) => text(createElement(TopUpCollateralNote, { summary }));
    // What the site leaves decides whether that mix goes, its reserve paid or not, so a worker's "mixed" would say no more.
    for (const [summary, cost] of [
      [summaryOf(true, "ifLeft"), true],
      [summaryOf(false, "ifLeft"), false],
      [summaryOf(true, "mixed"), true],
    ] as const) {
      const what = `${summary.collateralReserve ?? "no reserve"} ${summary.collateralMix}`;
      const back = wayBack(summary);
      expect(back, what).toContain("and the 5 ₳ once, in a box of its own, only if enough is left");
      expect(back, what).not.toContain("the 5 ₳ come back at once");
      expect(back.includes("Its collateral's mix, about 1.5 ₳"), what).toBe(cost);
      const topUp = note(summary);
      expect(topUp, what).toContain("At the next return it's mixed once, in a box of its own, only if enough is left");
      expect(topUp, what).not.toContain("It comes back with the next return.");
    }
    // No mix can go: back with the rest, as before.
    expect(wayBack(summaryOf(false))).toContain("The rest and the 5 ₳ come back at once.");
    expect(wayBack(summaryOf(false), false)).toContain("straight into your private balance, the 5 ₳ kept aside too.");
    expect(note(summaryOf(false))).toContain("It comes back with the next return.");
    expect(note(summaryOf(false))).not.toContain("only if enough is left");
  });

  it("a mix's review: mixed, only if enough is left, or nothing, on a mix and on Mix my boxes again", () => {
    const mixOf = (mix?: "mixed" | "ifLeft", again = false) =>
      ({
        ...funding(mix === "mixed"),
        ...(mix ? { collateralMix: mix } : {}),
        mix: { boxes: 1, lovelace: "15300000", mixes: 4, mixFees: "3800000", depth: 2, delay: "1-6", ...(again ? { again: true, owned: 1 } : {}) },
      }) as unknown as SessionOutSummary & { mix: LovejoinFunding };
    const hint = (summary: SessionOutSummary & { mix: LovejoinFunding }) => reviewHint({ source: "private", summary });
    for (const again of [false, true]) {
      const which = again ? "again" : "a mix";
      const mixed = text(createElement(PrivateReview, { summary: mixOf("mixed", again) }));
      expect(mixed, which).toContain(DEFINITE);
      expect(mixed, which).not.toContain(IF_LEFT());
      expect(hint(mixOf("mixed", again)), which).toBe(t(again ? "lovejoin.review.againNoteMixed" : "lovejoin.review.privateNoteMixed"));
      const ifLeft = text(createElement(PrivateReview, { summary: mixOf("ifLeft", again) }));
      expect(ifLeft, which).toContain(IF_LEFT());
      expect(ifLeft, which).not.toContain(DEFINITE);
      expect(hint(mixOf("ifLeft", again)), which).toBe(t(again ? "lovejoin.review.againNote" : "lovejoin.review.privateNote"));
      const plain = text(createElement(PrivateReview, { summary: mixOf(undefined, again) }));
      expect(plain, which).not.toContain(IF_LEFT());
      expect(plain, which).not.toContain("giveme.my backs its collateral's mix");
    }
  });
});
