// A swap's page in words, as the 1.3.0 release review found them (C10, C13,
// C15, C24, and its cross-area review's X04, X05): a swap against a DEX's
// pools (Danogo's, chunk 24) has no order, fills as it lands, and has no Stop
// once it's sent, so its page never says an order is on its way, would give
// less, waits to fill or is cancelled, nor Review it myself that the pools'
// reserves are the session's; and a cancel the wallet builds itself (chunk 24
// Step 3), when it's refused, is never said to be Minswap's. Rendered as the
// page shows them, in English.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DappTxSummary, SessionAuto, SessionTxReview, SessionView } from "../src/shared/rpc";
import { NetworkContext } from "../src/ui/network";
import {
  lateStopOf,
  nowLine,
  Session,
  SessionTxReviewScreen,
  StoppedLate,
  stopReading,
  SwapRow,
} from "../src/ui/screens/Swaps";
import { minswapEstimate } from "./fakes";
import { atSession, FUNDING, funded, MIN, orderRow, signing, started, SWAP_TX, unlocked } from "./swap-session";

/** A page's text, as a person reads it. */
function text(element: ReactElement): string {
  return renderToStaticMarkup(createElement(NetworkContext.Provider, { value: "preprod" }, element))
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();
}

const page = (s: SessionView) =>
  text(createElement(Session, { session: s, reading: false, onRefresh: () => undefined, onBack: () => undefined, onChanged: () => undefined }));
const row = (s: SessionView) => text(createElement(SwapRow, { session: s, onOpen: () => undefined }));
/** Stop's button, as the page offers it. */
const stopButton = (s: SessionView) =>
  renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      { value: "preprod" },
      createElement(Session, { session: s, reading: false, onRefresh: () => undefined, onBack: () => undefined, onChanged: () => undefined }),
    ),
  ).match(/>Stop<\/button>/);

const OUT = { kind: "out" as const, txHash: "ab".repeat(32), at: 0, confirmed: true };
const SENT = { kind: "swap" as const, txHash: "cd".repeat(32), at: 0 };
const LANDED = { ...SENT, confirmed: true };

/**
 * 10 ₳ for MIN, a swap that runs itself, against Danogo's pools: sent, not on
 * chain yet, as the worker's view has it (autoView: `againstPools` from the
 * swap recorded).
 */
function poolSwap(over: Partial<SessionView> = {}, auto: Partial<SessionAuto> = {}): SessionView {
  return {
    index: 0,
    network: "preprod",
    address: "addr_test1" + "q".repeat(50),
    createdAt: 0,
    stage: "open",
    txs: [OUT, SENT],
    swap: {
      amount: "10000000",
      tokenIn: "lovelace",
      tokenOut: MIN,
      slippage: 0.5,
      amountOut: "906594100",
      minAmountOut: "902083681",
      display: { in: { label: "₳", decimals: 6 }, out: { label: "MIN", decimals: 6 } },
    },
    holding: { lovelace: "134340603", tokens: [], utxos: 1 },
    auto: {
      step: "ordering",
      stopping: false,
      filled: false,
      approvedMinOut: "902083681",
      againstPools: true,
      placedMinOut: "902083681",
      ...auto,
    },
    ...over,
  };
}

/** The same swap through an order, at a DEX's contract. */
const orderSwap = (over: Partial<SessionView> = {}, auto: Partial<SessionAuto> = {}): SessionView => {
  const s = poolSwap(over, auto);
  const { againstPools: _againstPools, ...rest } = s.auto!;
  return { ...s, auto: rest };
};

const SWAP_ON_ITS_WAY = "The swap is on its way: waiting for the network to confirm it.";
const COMING_BACK = "It all comes back to your private balance next, by itself.";

describe("a swap against the DEX's pools, on its page as it goes out and lands (release review C13)", () => {
  it("says the swap is on its way, not an order", () => {
    const sent = poolSwap();
    expect(nowLine(sent)).toBe(SWAP_ON_ITS_WAY);
    const line = page(sent);
    expect(line).toContain("Swapped against the DEX's pools");
    expect(line).toContain(SWAP_ON_ITS_WAY);
    expect(line).not.toContain("order is on its way");
    expect(row(sent)).toContain("Swapping");
  });

  it("once it's landed, says everything comes back, never that it waits for a fill or that Stop cancels it", () => {
    // Landed, before the runner reads its proceeds (Koios doesn't list them yet), and after, while an unlock's wait
    // holds its return.
    for (const filled of [false, true]) {
      const landed = poolSwap({ txs: [OUT, LANDED] }, { step: "filling", filled });
      expect(nowLine(landed), `filled: ${filled}`).toBe(COMING_BACK);
      const line = page(landed);
      expect(line).not.toContain("Stop cancels it");
      expect(line).not.toContain("Waiting for the order");
      expect(stopButton(landed)).toBeNull();
      const listed = row(landed);
      expect(listed).toContain("Filled");
      expect(listed).not.toContain("Waiting for the fill");
    }
  });

  it("says the same of an order filled while an unlock's wait holds its return, and an order still open reads as before", () => {
    const filled = orderSwap({ txs: [OUT, LANDED] }, { step: "filling", filled: true });
    expect(nowLine(filled)).toBe(COMING_BACK);
    expect(row(filled)).toContain("Filled");
    const open = orderSwap({ txs: [OUT, LANDED] }, { step: "filling" });
    expect(nowLine(open)).toBe("Waiting for the order to fill. Then it all comes back by itself; Stop cancels it.");
    expect(row(open)).toContain("Waiting for the fill");
    expect(nowLine(orderSwap())).toBe("The order is on its way: waiting for the network to confirm it.");
  });
});

describe("a swap approved against the DEX's pools, before it's sent (release review C13)", () => {
  /** Approved against the pools, nothing sent yet, as the worker's view has it (autoView: `approvedPools`, from the approval). */
  const approved = (step: "funding" | "ordering", auto: Partial<SessionAuto> = {}): SessionView => {
    const s = poolSwap({ txs: [OUT] }, { step, approvedPools: true, ...auto });
    const { againstPools: _againstPools, placedMinOut: _placedMinOut, ...rest } = s.auto!;
    return { ...s, auto: rest };
  };

  it("says it swaps against the pools, filled in the swap itself, never that an order is placed and a DEX fills it", () => {
    for (const s of [approved("funding"), approved("ordering"), approved("ordering", { retry: { at: 0, error: "x", reason: "minswap-silent" } })]) {
      const line = page(s);
      expect(line, s.auto!.step).toContain("Swapped against the DEX's pools");
      expect(line, s.auto!.step).toContain("In the swap itself: no order to wait for");
      expect(line, s.auto!.step).not.toContain("Order placed");
      expect(line, s.auto!.step).not.toContain("By a DEX, usually within a few blocks");
    }
  });

  it("keeps Stop until the swap goes out: the approval's flag is words alone", () => {
    expect(stopButton(approved("ordering"))).not.toBeNull();
    expect(stopReading(approved("ordering"))).toEqual({ over: false, placed: false });
  });

  it("reads as an order's for a swap approved as one, before and after it's placed", () => {
    for (const s of [orderSwap({ txs: [OUT] }, { step: "ordering" }), orderSwap()]) {
      const line = page(s);
      expect(line).toContain("Order placed");
      expect(line).not.toContain("Swapped against the DEX's pools");
    }
  });

  it("says a price pause would give less by swapping now, never by an order, and an order's pause still says an order (cross-area review X05)", () => {
    const paused = { at: 0, why: "price" as const, amountOut: "900000000" };
    const pools = page(approved("ordering", { paused }));
    expect(pools).toContain("The price moved: swapping now would give about 900 MIN, under the 902.083681 MIN minimum you approved.");
    expect(pools).not.toContain("an order now");
    expect(pools).toContain("Swapped against the DEX's pools");
    const order = page(orderSwap({ txs: [OUT] }, { step: "ordering", paused }));
    expect(order).toContain("The price moved: an order now would give about 900 MIN, under the 902.083681 MIN minimum you approved.");
    expect(order).not.toContain("swapping now");
  });

  it("pauses so on the worker: approved through Danogo's pools, the price under the minimum before it's sent (cross-area review X05)", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const leg = minswapEstimate.estimate.paths[0]![0]!;
    const danogo = {
      ...minswapEstimate.estimate,
      total_dex_fee: "100000",
      deposits: "0",
      aggregator_fee: "850000",
      paths: [[{ ...leg, dex_fee: "100000", deposits: "0", protocol: "DanogoCLMMV1" }]],
    };
    t.minswap.estimate = danogo;
    await started(sessions);
    funded(t);
    // The fresh route is still the pools', but the price fell under the approved minimum.
    t.minswap.estimate = { ...danogo, amount_out: "900000000", min_amount_out: "895522388" };
    const view = await sessions.advance("preprod", 0, true);
    expect(view.auto).toMatchObject({ step: "ordering", approvedPools: true, paused: { why: "price" } });
    const line = page(view);
    expect(line).toContain("The price moved: swapping now would give about");
    expect(line).not.toContain("an order now");
  });
});

describe("Stop pressed as a swap against the DEX's pools went out (release review C24)", () => {
  it("says the swap is on its way, never that an order is cancelled", () => {
    const stopped = poolSwap({}, { stopping: true });
    const line = page(stopped);
    expect(line).not.toContain("Cancelled");
    expect(line).not.toContain("The order's funds back at the account");
    expect(line).not.toContain("Stopping: bringing it all back");
    expect(line).toContain("In the swap itself: no order to wait for");
    expect(nowLine(stopped)).toBe(SWAP_ON_ITS_WAY);
    const listed = row(stopped);
    expect(listed).toContain("Swapping");
    expect(listed).not.toContain("Coming back");
  });

  it("once it's landed, says it filled and everything comes back, never that it's cancelling", () => {
    for (const filled of [false, true]) {
      const landed = poolSwap({ txs: [OUT, LANDED] }, { step: "cancelling", stopping: true, filled });
      const line = page(landed);
      expect(line, `filled: ${filled}`).not.toContain("Cancelled");
      expect(line).not.toContain("Cancelling the order");
      expect(line).toContain("Filled");
      expect(nowLine(landed)).toBe(COMING_BACK);
      const listed = row(landed);
      expect(listed).not.toContain("Cancelling");
      expect(listed).toContain("Filled");
    }
  });

  it("reads as before for an order stopped as it went out: the wallet cancels it", () => {
    const stopped = orderSwap({}, { stopping: true });
    expect(page(stopped)).toContain("Cancelled The order's funds back at the account");
    expect(nowLine(stopped)).toBe("Stopping: bringing it all back.");
    const cancelling = orderSwap({ txs: [OUT, LANDED] }, { step: "cancelling", stopping: true });
    expect(nowLine(cancelling)).toBe("Cancelling the order. Once that's confirmed, it all comes back.");
    expect(row(cancelling)).toContain("Cancelling");
  });
});

describe("a refused cancel, which the wallet built itself (release review C15)", () => {
  const NO_COLLATERAL = "this session's account holds no UTxO of ADA alone to put up as collateral for cancelling the order.";
  const refused = (stopping: boolean) =>
    orderSwap(
      { txs: [OUT, LANDED] },
      { step: stopping ? "cancelling" : "ordering", stopping, paused: { at: 0, why: "refused", detail: NO_COLLATERAL } },
    );

  it("says the wallet couldn't cancel the order, and that Try again builds the cancel afresh, never that Minswap built it", () => {
    const line = page(refused(true));
    expect(line).toContain(`The wallet couldn't cancel the order: ${NO_COLLATERAL} Try again builds the cancel afresh.`);
    expect(line).not.toContain("Minswap built");
    expect(line).not.toContain("asks Minswap");
    const listed = row(refused(true));
    expect(listed).toContain("Couldn't cancel its order");
    expect(listed).not.toContain("Minswap");
  });

  it("still says a swap refused before Stop is Minswap's build, which Try again asks for afresh", () => {
    const detail = "it places no order.";
    const s = orderSwap({}, { paused: { at: 0, why: "refused", detail } });
    expect(page(s)).toContain(`The wallet won't sign what Minswap built: ${detail} Try again asks Minswap to build it afresh.`);
    expect(row(s)).toContain("Refused Minswap's build");
  });

  it("pauses so on the worker, Stop set, when it can't build the cancel, and asks Minswap for nothing", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await started(sessions);
    funded(t);
    await sessions.advance("preprod", 0);
    // The order lands at the DEX, and the account's change holds a token: no UTxO of ADA alone to put up as collateral.
    t.koios.spent.add(FUNDING);
    t.koios.addedToAccounts.push(atSession(SWAP_TX, 1, "2000000", [[MIN, "5"]]), orderRow(SWAP_TX));
    const before = t.minswap.calls.length;
    const view = await sessions.stop("preprod", 0);
    expect(view.auto).toMatchObject({ stopping: true, paused: { why: "refused", detail: NO_COLLATERAL } });
    expect(t.minswap.calls.slice(before)).toEqual([]);
    expect(page(view)).toContain(`The wallet couldn't cancel the order: ${NO_COLLATERAL} Try again builds the cancel afresh.`);
    expect(row(view)).toContain("Couldn't cancel its order");
  });
});

describe("Stop's late warning and its dialog, for a swap against the DEX's pools (release review C24)", () => {
  it("says a swap against the pools that went out before Stop can't be cancelled, and comes back either way", () => {
    expect(lateStopOf(true, false, poolSwap({}, { stopping: true }))).toBe("pools");
    expect(lateStopOf(true, false, orderSwap({}, { stopping: true }))).toBe("order");
    // The dialog said one had gone out, or none had: nothing went out late.
    expect(lateStopOf(true, true, poolSwap({}, { stopping: true }))).toBeUndefined();
    expect(lateStopOf(false, false, orderSwap({ txs: [OUT] }, { stopping: true }))).toBeUndefined();
    const pools = text(createElement(StoppedLate, { late: "pools" }));
    expect(pools).toBe(
      "The swap went out before Stop took effect, and can't be cancelled: if it lands, it's swapped. Either way, everything comes back to your private balance.",
    );
    expect(pools).not.toContain("cancels it");
    expect(text(createElement(StoppedLate, { late: "order" }))).toBe(
      "An order went out before Stop took effect. The wallet cancels it, unless it fills first, then brings everything back to your private balance.",
    );
  });

  it("goes by Stop's answer when the swap that went out was given up, so the page doesn't show it (cross-area review X04)", () => {
    const back = { kind: "back" as const, txHash: "ef".repeat(32), at: 0 };
    const stopped = orderSwap({ txs: [OUT, back] }, { step: "returning", stopping: true });
    expect(lateStopOf(true, false, stopped, true)).toBe("pools");
    // An order given up may still land: the wallet cancels it.
    expect(lateStopOf(true, false, stopped, false)).toBe("order");
    expect(lateStopOf(true, false, stopped)).toBe("order");
  });

  it("closes its dialog when the record says there's nothing left to stop: a swap against the pools gone out", () => {
    expect(stopReading(poolSwap())).toEqual({ over: true, placed: true });
    // An order filled meanwhile, or Stop pressed elsewhere: everything comes back anyway.
    expect(stopReading(orderSwap({ txs: [OUT, LANDED] }, { step: "filling", filled: true }))).toMatchObject({ over: true });
    expect(stopReading(orderSwap({}, { stopping: true }))).toMatchObject({ over: true });
    // An order on its way: the dialog says it's cancelled unless it fills first.
    expect(stopReading(orderSwap())).toEqual({ over: false, placed: true });
    expect(stopReading(orderSwap({ txs: [OUT] }, { step: "funding" }))).toEqual({ over: false, placed: false });
    expect(stopReading(undefined)).toEqual({ over: false, placed: false });
  });
});

// ---------------------------------------------------------------------------
// Review it myself, and a cancel's review
// ---------------------------------------------------------------------------

const MIN_TOKEN = { policyId: MIN.slice(0, 56), assetName: MIN.slice(56) };
type Paid = DappTxSummary["paid"][number];
const paidOut = (address: string, lovelace: string, script: boolean, tokens: Paid["tokens"] = []): Paid => ({
  address,
  lovelace,
  tokens,
  datum: script ? "inline" : null,
  script,
  seedelf: null,
  ownPaymentKey: false,
});
const POOL_OUT = paidOut("addr_test1xqpool", "2010000000", true, [{ ...MIN_TOKEN, quantity: "99093405900" }]);
const MINSWAP_FEE_OUT = paidOut("addr_test1vzfee", "850000", false);

/** What WebAssembly read of a transaction, as inspectSessionTx gives it: the parts a review shows, the rest empty. */
function summaryOf(over: Partial<DappTxSummary>): DappTxSummary {
  return {
    txHash: "c2".repeat(32),
    fee: "600000",
    netLovelace: "0",
    netTokens: [],
    spentLovelace: "0",
    returnedLovelace: "0",
    stakingLovelace: "0",
    ownInputs: 1,
    paid: [],
    ownOutputs: [],
    mint: [],
    certificates: [],
    withdrawals: [],
    collateral: null,
    scripts: false,
    referenceInputs: 0,
    votes: 0,
    proposals: 0,
    donation: null,
    note: null,
    metadata: false,
    validFrom: null,
    validUntil: null,
    signs: ["0/0"],
    unknownInputs: [],
    othersSign: 0,
    complete: true,
    ...over,
  };
}

/**
 * Review it myself on tests/direct-swaps.test.ts's swap of 10 ₳ for MIN
 * through Danogo, as the worker's swapBuild gives it (its summary is the real
 * WebAssembly's): the pool recreated holds its 2,000 ₳ of reserves and the
 * session's 10 ₳, Minswap's fee is 0.85 ₳, and its collateral is Minswap's.
 */
const POOL_REVIEW: SessionTxReview = {
  network: "preprod",
  index: 0,
  kind: "swap",
  txHash: "c2".repeat(32),
  summary: summaryOf({
    netLovelace: "-11450000",
    netTokens: [{ ...MIN_TOKEN, quantity: "906594100" }],
    spentLovelace: "145790603",
    returnedLovelace: "134340603",
    paid: [POOL_OUT, MINSWAP_FEE_OUT],
    collateral: { own: 0, lovelace: "0", total: null, returnedLovelace: null, atRisk: "0" },
    scripts: true,
    referenceInputs: 1,
    othersSign: 1,
    complete: false,
  }),
  quote: {
    network: "preprod",
    ask: { amount: "10000000", tokenIn: "lovelace", tokenOut: MIN, slippage: 0.5 },
    amountIn: "10000000",
    amountOut: "906594100",
    minAmountOut: "902083681",
    dexFee: "2000000",
    deposits: "0",
    aggregatorFee: "850000",
    priceImpact: 0.34,
    route: ["DanogoCLMMV1"],
    againstPools: true,
    fund: { lovelace: "14850000", tokens: [] },
    collateral: "5000000",
  },
  againstPools: true,
};

const review = (r: SessionTxReview, s: SessionView = poolSwap({ txs: [OUT] }, { paused: { at: 0, why: "price", amountOut: "900000000" } })) =>
  text(
    createElement(SessionTxReviewScreen, { review: r, s, busy: false, onBack: () => undefined, onSend: () => undefined }),
  );

describe("Review it myself on a swap against the DEX's pools (release review C10)", () => {
  it("says what the session puts into the pools, never their reserves, nor an order, a fill or a Stop", () => {
    const line = review(POOL_REVIEW);
    expect(line).toContain("Review the swap");
    expect(line).toContain("You get about 906.5941 MIN");
    expect(line).toContain("Asked for at least 902.083681 MIN");
    expect(line).toContain("Into the DEX's pools 10 ₳");
    expect(line).toContain("To 0.85 ₳");
    expect(line).toContain("Network fee 0.6 ₳");
    expect(line).toContain("Back to the session 134.340603 ₳");
    expect(line).not.toContain("2,010");
    expect(line).not.toContain("Into the order");
    expect(line).not.toContain("Review the order");
    expect(line).toContain(
      "It swaps against the DEX's pools as it lands, then it all comes back by itself. No order waits to fill, and once it's sent there's no Stop.",
    );
    expect(line).not.toContain("Stop cancels it");
    // It carries the collateral owner's signature already, and the session puts up no collateral of its own.
    expect(line).toContain("Built by Minswap, read by the wallet, signed by this session's key and by its collateral's owner");
    expect(line).not.toContain("signed only by");
    expect(line).not.toContain("Collateral at risk");
  });

  it("names what a swap for ADA puts in by its token, in the decimals it was approved with", () => {
    const sold: SessionTxReview = {
      ...POOL_REVIEW,
      summary: summaryOf({
        ...POOL_REVIEW.summary,
        netLovelace: "8350000",
        netTokens: [{ ...MIN_TOKEN, quantity: "-906594100" }],
      }),
      quote: { ...POOL_REVIEW.quote!, ask: { ...POOL_REVIEW.quote!.ask, tokenIn: MIN, tokenOut: "lovelace" }, amountOut: "9800000", minAmountOut: "9751000" },
    };
    const s = poolSwap({
      txs: [OUT],
      swap: {
        ...poolSwap().swap!,
        tokenIn: MIN,
        tokenOut: "lovelace",
        amount: "906594100",
        display: { in: { label: "MIN", decimals: 6 }, out: { label: "₳", decimals: 6 } },
      },
    });
    const line = review(sold, s);
    expect(line).toContain("Into the DEX's pools 906.5941 MIN");
    expect(line).not.toContain("Into the DEX's pools 0");
  });

  it("says it pays this session, with no Stop to speak of, for a session from before swaps ran themselves", () => {
    const line = review(POOL_REVIEW, { ...poolSwap({ txs: [OUT] }), auto: undefined });
    expect(line).toContain(
      "It swaps against the DEX's pools as it lands, and pays this session. No order waits to fill, and once it's sent it can't be cancelled.",
    );
    expect(line).not.toContain("comes back by itself");
  });

  it("reads as before for an order: its order, its fill and Stop", () => {
    const order: SessionTxReview = {
      ...POOL_REVIEW,
      summary: summaryOf({
        netLovelace: "-14600000",
        spentLovelace: "145790603",
        returnedLovelace: "131190603",
        paid: [paidOut("addr_test1wzorder", "14000000", true)],
      }),
      quote: { ...POOL_REVIEW.quote!, route: ["MinswapV2"], againstPools: undefined },
      againstPools: undefined,
    };
    const line = review(order, orderSwap({ txs: [OUT] }));
    expect(line).toContain("Review the order");
    expect(line).toContain("Into the order 14 ₳");
    expect(line).toContain("Built by Minswap, read by the wallet, signed only by this session's key");
    expect(line).toContain("A DEX fills the order and it all comes back by itself. If the price moves past your slippage, it waits: Stop cancels it.");
    expect(line).not.toContain("Into the DEX's pools");
  });
});

describe("a cancel's review (release review C15)", () => {
  it("says the wallet built the cancel, never Minswap, and what of the session's collateral is at risk", () => {
    const cancel: SessionTxReview = {
      network: "preprod",
      index: 0,
      kind: "cancel",
      txHash: "c3".repeat(32),
      summary: summaryOf({
        netLovelace: "13800000",
        returnedLovelace: "13800000",
        collateral: { own: 1, lovelace: "5000000", total: null, returnedLovelace: null, atRisk: "5000000" },
        scripts: true,
      }),
      orders: 1,
    };
    const line = review(cancel, { ...orderSwap({ txs: [OUT, LANDED] }), auto: undefined });
    expect(line).toContain("Review the cancel");
    expect(line).toContain("Built and read by the wallet, signed only by this session's keys");
    expect(line).not.toContain("Minswap");
    expect(line).toContain("Collateral at risk 5 ₳");
  });
});
