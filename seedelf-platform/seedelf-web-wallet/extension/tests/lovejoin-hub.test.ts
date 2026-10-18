// Lovejoin's screens for token pools (chunk 34's 34f), rendered as the pages
// show them: the hub's boxes, its pools grouped by token, every mix followed
// to the end, a return's tokens with Change, the swap approval that funds a
// token's boxes (34e's fixes' review, 2, a release blocker until here), Home's
// row per pool and Settings' four boxes a mix. Hidden balances are the
// default (the settings not read yet), so a count that shows through is caught.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { DEFAULT_PREFERENCES, type Preferences } from "../src/shared/preferences";
import type {
  LovejoinBoxValue,
  LovejoinChainView,
  LovejoinHeld,
  LovejoinMixView,
  LovejoinStatus,
  LovejoinTokenWay,
  SessionBackSummary,
  SessionOutSummary,
  SessionView,
  SwapLovejoin,
  SwapQuote,
  TokenAmount,
} from "../src/shared/rpc";
import { partsText, TokenWays } from "../src/ui/components/LovejoinReturn";
import { bootstrapProgress, boxText, crowdText, groupPools, poolsOf, searchGroups, type ShownPool } from "../src/ui/lovejoin-pools";
import { NetworkContext } from "../src/ui/network";
import { PreferencesContext } from "../src/ui/preferences";
import { InLovejoin, inLovejoinShown } from "../src/ui/screens/Home";
import { MixList, mixItems, PoolGroupList, PrivateReview, PublicReview, YourBoxes } from "../src/ui/screens/Lovejoin";
import { Plan, SwapApproval } from "../src/ui/screens/Swaps";
import { t } from "../src/i18n";

// Settings reads the page's address as it loads (ui/view.ts): there's none under Node.
let Settings: typeof import("../src/ui/screens/Settings");
beforeAll(async () => {
  vi.stubGlobal("location", { search: "?view=tab", hash: "" });
  Settings = await import("../src/ui/screens/Settings");
});

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

/** `element` with the balances shown, or with other settings. */
const shown = (element: ReactElement, prefs: Partial<Preferences> = {}) =>
  createElement(
    PreferencesContext.Provider,
    { value: { prefs: { ...DEFAULT_PREFERENCES, hideBalances: false, ...prefs }, loaded: true, set: async () => undefined } },
    element,
  );

/** MIN and tUSDM, on preprod's token list. */
const MIN = { policyId: "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed72", assetName: "4d494e" };
const USDM = { policyId: "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde", assetName: "0014df10745553444d" };
const A = "a1".repeat(28);
const B = "b2".repeat(28);
const U = "c3".repeat(28);
const D = "d4".repeat(28);
const box = (i: number, pool?: string) => ({ txHash: `${i}`.padStart(64, "0"), txIndex: 0, ...(pool ? { pool } : {}) });

/** A token pool as the worker reads it: `mine` of the wallet's boxes, `others` not. */
function pool(id: string, value: LovejoinBoxValue, others: number, mine = 0, extra: Partial<ShownPool> = {}) {
  return {
    id,
    box: value,
    others,
    free: others,
    floor: 30,
    boxes: Array.from({ length: mine }, (_, i) => box(100 + i, id)),
    lovelace: (BigInt(value.lovelace) * BigInt(mine)).toString(),
    due: mine ? [Date.now() + 3_600_000] : [],
    notMixed: [],
    fromPublic: [],
    ...(value.token && mine ? { token: { ...value.token, quantity: (BigInt(value.token.quantity) * BigInt(mine)).toString() } } : {}),
    ...extra,
  };
}

const MIN_100 = { lovelace: "4500000", token: { ...MIN, quantity: "100000000" } };
const MIN_1000 = { lovelace: "4500000", token: { ...MIN, quantity: "1000000000" } };
const USDM_10 = { lovelace: "5000000", token: { ...USDM, quantity: "10000000" } };

/** A classic-only read: the pool 1.5.0 read, with three of the wallet's boxes in it. */
const classicOnly: LovejoinStatus = {
  available: true,
  others: 41,
  free: 41,
  floor: 30,
  boxes: [box(1), box(2), box(3)],
  lovelace: "30000000",
  due: [Date.now() + 3_600_000],
  notMixed: [],
  fromPublic: [],
  chains: [],
};

const withPools: LovejoinStatus = {
  ...classicOnly,
  crowd: { boxes: 44, deposits: 12, mixed: 30 },
  pools: [
    pool(A, MIN_100, 34, 2, { crowd: { boxes: 36, deposits: 5, mixed: 20 }, launch: "1".repeat(64), mine: true }),
    pool(B, MIN_1000, 12, 0, { crowd: { boxes: 12, deposits: 1, mixed: 0 } }),
    pool(U, USDM_10, 50, 1, { cantComeBack: { has: "4512000", needs: "4630000" } }),
    pool(D, { lovelace: "25000000" }, 31),
  ],
};

describe("a box's value in words (chunk 34's 34f)", () => {
  it("says the classic pool's as every string said it, and a token pool's token in its own units with its ADA", () => {
    expect(boxText("preprod", { lovelace: "10000000" })).toBe("10 ₳");
    expect(boxText("preprod", { lovelace: "25000000" })).toBe("25 ₳");
    expect(boxText("preprod", MIN_100)).toBe("100 MIN + 4.5 ₳");
    expect(boxText("preprod", USDM_10)).toBe("10 tUSDM + 5 ₳");
  });

  it("names a return's boxes in each pool, the classic pool's alone as before", () => {
    const base = { boxes: 3, depth: 2, mixes: 12, fees: "1", txs: 14, delay: "1-6", entry: "e" };
    expect(partsText("preprod", base)).toBe("3 boxes of 10 ₳");
    expect(
      partsText("preprod", { ...base, parts: [{ pool: A, boxes: 2 }, { boxes: 1 }], values: { [A]: MIN_100 } }),
    ).toBe("2 boxes of 100 MIN + 4.5 ₳, 1 box of 10 ₳");
  });
});

describe("the hub's pools, grouped by token (session 1, 13)", () => {
  const pools = poolsOf(withPools);
  const held: TokenAmount[] = [{ ...USDM, quantity: "5", fingerprint: "", decimals: 6 }];

  it("puts ADA's pools first, then the tokens held, then the most used, each group's busiest pool first", () => {
    const groups = groupPools(pools, held);
    expect(groups.map((g) => g.key)).toEqual(["ada", `${USDM.policyId}.${USDM.assetName}`, `${MIN.policyId}.${MIN.assetName}`]);
    // ADA's: the classic pool, with more boxes not the wallet's than the 25 ₳ pool.
    expect(groups[0]!.pools.map((p) => p.id)).toEqual([undefined, D]);
    expect(groups[2]!.pools.map((p) => p.id)).toEqual([A, B]);
    // Holding none of either token, the busier group first.
    expect(groupPools(pools, []).map((g) => g.key)).toEqual(["ada", `${USDM.policyId}.${USDM.assetName}`, `${MIN.policyId}.${MIN.assetName}`]);
  });

  it("finds a token's pools by ticker, by policy ID from four characters, and ADA's by its name", () => {
    const groups = groupPools(pools, held);
    expect(searchGroups("preprod", groups, "min").map((g) => g.key)).toEqual([`${MIN.policyId}.${MIN.assetName}`]);
    expect(searchGroups("preprod", groups, "16a5").map((g) => g.key)).toEqual([`${USDM.policyId}.${USDM.assetName}`]);
    expect(searchGroups("preprod", groups, "16a")).toEqual([]);
    expect(searchGroups("preprod", groups, "ada").map((g) => g.key)).toEqual(["ada"]);
    expect(searchGroups("preprod", groups, "  ")).toHaveLength(3);
  });

  it("states a crowd as boxes not yours, with the deposits where the server counted them, and none mixed yet", () => {
    expect(crowdText({ others: 34 })).toBe("34 boxes not yours");
    expect(crowdText({ others: 34, crowd: { boxes: 36, deposits: 5, mixed: 20 } })).toBe("34 boxes not yours · 5 deposits");
    expect(crowdText({ others: 1, crowd: { boxes: 1, deposits: 1, mixed: 0 } })).toBe("1 box not yours · 1 deposit · none mixed yet");
    expect(bootstrapProgress({ others: 12, floor: 30 })).toEqual({ have: 12, floor: 30, percent: 40 });
    expect(bootstrapProgress({ others: 31, floor: 30 })).toBeUndefined();
    expect(bootstrapProgress({ others: 0, floor: 0 })).toBeUndefined();
  });

  it("lists each pool with its value, its crowd, the wallet's boxes, and what its page has to say", () => {
    const [ada, , min] = groupPools(pools, held);
    const minRows = text(shown(createElement(PoolGroupList, { group: min!, onOpen: () => undefined })));
    expect(minRows).toMatch(/^MIN .*100 MIN \+ 4\.5 ₳ 2 boxes 34 boxes not yours · 5 deposits You started it/);
    expect(minRows).toContain("1,000 MIN + 4.5 ₳ 12 boxes not yours · 1 deposit · none mixed yet Being started: 12 of 30 boxes");
    const usdm = text(shown(createElement(PoolGroupList, { group: groupPools(pools, held)[1]!, onOpen: () => undefined })));
    expect(usdm).toContain("This pool's boxes can't pay their own way back now");
    expect(text(shown(createElement(PoolGroupList, { group: ada!, onOpen: () => undefined })))).toContain("10 ₳ 3 boxes 41 boxes not yours · 12 deposits");
    // While balances are hidden, how many boxes is hidden too (privacy review §2.16).
    expect(text(createElement(PoolGroupList, { group: min!, onOpen: () => undefined }))).not.toContain("₳ 2 boxes");
  });
});

describe("the hub's first rows: the wallet's boxes (backward compatibility 7)", () => {
  it("says what Lovejoin's page said when they're all in the classic pool", () => {
    const rows = text(shown(createElement(YourBoxes, { pools: poolsOf(classicOnly) })));
    expect(rows).toMatch(/^Your boxes in the pool 3 boxes, 30 ₳ Next one back /);
    // With token pools read but none of the wallet's boxes in them: the same words.
    const noTokenBoxes: LovejoinStatus = { ...classicOnly, pools: [pool(B, MIN_1000, 12)] };
    expect(text(shown(createElement(YourBoxes, { pools: poolsOf(noTokenBoxes) })))).toMatch(/^Your boxes in the pool 3 boxes, 30 ₳/);
  });

  it("counts them across pools, each pool's under the total, a token pool's token with its ADA", () => {
    const rows = text(shown(createElement(YourBoxes, { pools: poolsOf(withPools) })));
    expect(rows).toContain("Your boxes in Lovejoin 6 boxes");
    expect(rows).toContain("10 ₳ 3 boxes, 30 ₳");
    expect(rows).toContain("100 MIN + 4.5 ₳ 2 boxes, 200 MIN + 9 ₳");
    expect(rows).toContain("10 tUSDM + 5 ₳ 1 box, 10 tUSDM + 5 ₳");
    const hidden = text(createElement(YourBoxes, { pools: poolsOf(withPools) }));
    expect(hidden).not.toContain("6 boxes");
    expect(hidden).not.toContain("200 MIN");
  });
});

describe("Your mixes: every mix, followed until its last box is back (session 1, 5)", () => {
  const now = Date.now();
  const entries: LovejoinMixView[] = [
    { id: "e1", at: now - 1000, session: 2, shares: [{ pool: A, boxes: 2, back: 0, moved: 0 }], chain: { total: 4, sent: 4, done: true } },
    { id: "e2", at: now - 2000, account: 0, shares: [{ boxes: 3, back: 1, moved: 0 }], chain: { total: 5, sent: 5, done: true, width: 4 } },
    { id: "e3", at: now - 3000, session: 0, shares: [{ boxes: 2, back: 1, moved: 0 }, { pool: A, boxes: 1, back: 0, moved: 0 }] },
    { id: "e4", at: now - 4000, account: 0, bootstrap: true, shares: [{ pool: B, boxes: 12, back: 0, moved: 0 }] },
    { id: "e5", at: now - 5000, account: 0, bootstrap: true, released: true, shares: [{ boxes: 2, back: 0, moved: 0 }] },
  ];
  const session = (index: number, at: number, stage: SessionView["stage"], extra: Partial<SessionView> = {}) =>
    ({ index, createdAt: at, stage, txs: [], mix: { boxes: 1 }, address: "addr", holding: null, ...extra }) as unknown as SessionView;
  const sessions = [
    session(2, now - 1500, "closed", { mix: { boxes: 2, pool: A } }),
    session(4, now, "funding", { auto: {} as never }),
    ...Array.from({ length: 6 }, (_, i) => session(10 + i, now - 100_000 - i, "closed")),
  ];

  it("lists each mix, newest first, a private mix's session beside its entry, the last few over after them", () => {
    const items = mixItems(entries, sessions);
    // The funding on its way, then each entry, then the sessions over with their boxes back, as many as leave five.
    expect(items.map((i) => i.key)).toEqual(["session.4", "e1", "e2", "e3", "e4", "e5", "session.10", "session.11", "session.12", "session.13"]);
    expect(items[1]!.session?.index).toBe(2);
  });

  it("says what went in and where, who paid, how many are back, and Bootstrap's hold", () => {
    const list = text(shown(createElement(MixList, { entries, sessions: [], chains: [], pools: poolsOf(withPools), busy: false, onRetry: () => undefined, onStop: () => undefined })));
    expect(list).toContain("2 boxes of 100 MIN + 4.5 ₳ Coming back Return of private session 3, 0 of 2 back");
    expect(list).toContain("3 boxes of 10 ₳ Coming back From your public account, 1 of 3 back, four boxes a mix");
    expect(list).toContain("2 boxes of 10 ₳, 1 box of 100 MIN + 4.5 ₳ Coming back Return of private session 1, 1 of 3 back");
    expect(list).toContain("Bootstrap: 12 boxes of 1,000 MIN + 4.5 ₳ Held From your public account, held until you bring them back");
    expect(list).toContain("Bootstrap: 2 boxes of 10 ₳ Coming back From your public account, coming back by themselves");
    // How many are back is a count of boxes too: hidden with the balances.
    const hidden = text(createElement(MixList, { entries, sessions: [], chains: [], pools: poolsOf(withPools), busy: false, onRetry: () => undefined, onStop: () => undefined }));
    expect(hidden).not.toContain("of 2 back");
    expect(hidden).not.toContain("12 boxes");
  });

  it("names a private mix by its session, with its stage and Stop while it runs", () => {
    const running = session(4, now, "funding", { auto: {} as never });
    const list = text(shown(createElement(MixList, { entries: [], sessions: [running], chains: [], pools: poolsOf(classicOnly), busy: false, onRetry: () => undefined, onStop: () => undefined })));
    expect(list).toContain("1 box of 10 ₳ Running Its one-time account is being funded Stop");
    const named = text(
      shown(createElement(MixList, { entries: [entries[0]!], sessions: [session(2, now - 1500, "closed", { mix: { boxes: 2, pool: A } })], chains: [], pools: poolsOf(withPools), busy: false, onRetry: () => undefined, onStop: () => undefined })),
    );
    expect(named).toContain("Private session 3, 0 of 2 back");
  });

  it("says a chain stopped, and why, once it's gone from Chains", () => {
    const stopped: LovejoinMixView = { id: "s1", at: now, account: 0, shares: [{ boxes: 1, back: 0, moved: 0 }], chain: { total: 5, sent: 1, stopped: "The network rejected the transaction" } };
    const row: LovejoinChainView = { boxes: 1, total: 5, sent: 1, at: now, stopped: "The network rejected the transaction" };
    const listed = (chains: LovejoinChainView[]) =>
      text(shown(createElement(MixList, { entries: [stopped], sessions: [], chains, pools: poolsOf(classicOnly), busy: false, onRetry: () => undefined, onStop: () => undefined })));
    expect(listed([row])).toContain("Stopped");
    expect(listed([row])).not.toContain("Why it stopped");
    expect(listed([])).toContain("Why it stopped: The network rejected the transaction.");
  });
});

describe("a return's tokens, each through its own pool or back directly (chunk 34's 34e, Change)", () => {
  const unit = `${MIN.policyId}${MIN.assetName}`;
  const ways: LovejoinTokenWay[] = [
    { ...MIN, pool: A, quantity: MIN_100.token.quantity, boxes: 2, pools: [A, B] },
    { ...USDM, boxes: 0, pools: [], skipped: t("lj.tokens.skip.warn.noPool") },
  ];
  const values = { [A]: MIN_100, [B]: MIN_1000 };

  it("says where each goes, and why one comes back directly, with Change where there's a choice", () => {
    const html = renderToStaticMarkup(
      createElement(NetworkContext.Provider, { value: "preprod" }, createElement(TokenWays, { ways, values, busy: false, onChange: () => undefined })),
    );
    const line = text(createElement(TokenWays, { ways, values, busy: false, onChange: () => undefined }));
    expect(line).toContain("MIN Change Through Lovejoin: 2 boxes of 100 MIN + 4.5 ₳");
    expect(line).toContain("tUSDM Comes back directly: none of its pools can take a box now.");
    // One Change: the token with no pool to take it has nothing to choose.
    expect(html.match(/lovejoin-token-way-change/g)).toHaveLength(1);
    // Chosen directly, it says so, and can go into a pool again.
    const direct = text(createElement(TokenWays, { ways: [{ ...MIN, boxes: 0, direct: true, pools: [A, B] }], values, busy: false, onChange: () => undefined }));
    expect(direct).toContain("MIN Change Comes back directly, as you chose");
    // Without a way to change it (a review that can't be built again), no Change.
    expect(text(createElement(TokenWays, { ways, values, busy: false }))).not.toContain("Change");
    expect(unit).toHaveLength(62);
  });
});

describe("a swap that funds its token's boxes, on its approval (34e's fixes' review, 2)", () => {
  const unit = `${MIN.policyId}${MIN.assetName}`;
  const quote: SwapQuote = {
    network: "preprod",
    ask: { amount: "10000000", tokenIn: "lovelace", tokenOut: unit, slippage: 1 },
    amountIn: "10000000",
    amountOut: "906594100",
    minAmountOut: "897528159",
    dexFee: "2000000",
    deposits: "2000000",
    aggregatorFee: "0",
    priceImpact: 0.4,
    route: ["MinswapV2"],
    fund: { lovelace: "16000000", tokens: [] },
    collateral: "5000000",
    verified: true,
  };
  // The token's eight boxes: 36 ₳ of box ADA, 30.4 ₳ of mixes and a 1.5 ₳ reserve, funded beside the swap's 16 ₳.
  const lovejoin: SwapLovejoin = {
    boxes: 0,
    depth: 2,
    mixes: 0,
    mixFees: "0",
    withdrawFees: "0",
    delay: "1-6",
    on: true,
    ifStopped: { boxes: 2, mixes: 8, mixFees: "7600000", withdrawFees: "600000" },
    ways: [{ ...MIN, pool: A, quantity: "100000000", boxes: 8, pools: [A, B], mixes: 32, mixFees: "30400000", withdrawFees: "2400000" }],
    fund: "67900000",
    values: { [A]: MIN_100, [B]: MIN_1000 },
  };
  const summary: SessionOutSummary = {
    network: "preprod",
    txHash: "ab".repeat(32),
    index: 6,
    address: "addr_test1" + "q".repeat(50),
    payments: [
      { address: "addr_test1" + "q".repeat(50), own: false, lovelace: "83900000", minimum: null, tokens: [] },
      { address: "addr_test1" + "q".repeat(50), own: false, lovelace: "5000000", minimum: null, tokens: [] },
    ],
    max: false,
    fee: { size: "0", compute: "0", scriptReference: "0", total: "312000" },
    changeLovelace: "0",
    changeTokens: 0,
    changeOutputs: 1,
    changeMinimum: "0",
    inputs: 2,
    left: 0,
  };
  const pay = { id: "lovelace", side: { label: "₳", decimals: 6 } };
  const get = { id: unit, side: { label: "MIN", decimals: 6 } };
  const approval = (l: SwapLovejoin, through = true) =>
    text(shown(createElement(SwapApproval, { summary, quote, lovejoin: l, pay, get, through, onThrough: () => undefined, onPool: () => undefined, busy: false })));

  it("sets the token's boxes apart from the swap, so the swap's parts add up to its own funding", () => {
    const line = approval(lovejoin);
    // The swap's 16 ₳, made of the 10 ₳ swapped, the DEX's 2 ₳, the 2 ₳ deposit and 2 ₳ of room: not 69.9 ₳ of room.
    expect(line).toContain("The swap and its costs 16 ₳ The swap 10 ₳ DEX fee 2 ₳ Order deposit 2 ₳, back with the proceeds Room for network fees 2 ₳, what's left comes back");
    expect(line).toContain("For MIN's Lovejoin boxes 67.9 ₳ The boxes' ADA 36 ₳, comes back Their mixes and fees 31.9 ₳, what's left comes back");
  });

  it("counts the token's mixes and their way back among the costs, and says the proceeds come back in boxes", () => {
    const line = approval(lovejoin);
    expect(line).toContain("Through Lovejoin, about 32.8 ₳");
    expect(line).toContain("The proceeds in Lovejoin boxes, later; the rest at once");
    expect(line).not.toContain("The proceeds and the rest at once");
    expect(line).toMatch(/What you get, on the way back (MI )?MIN Change Through Lovejoin: 8 boxes of 100 MIN \+ 4\.5 ₳, funded now/);
  });

  it("offers the switch though the swap's spare ADA pays for no box of its own", () => {
    const line = approval(lovejoin);
    expect(line).toContain("Bring it back through Lovejoin");
    expect(line).toContain("What you get goes into that token's own pool in whole boxes");
    expect(line).not.toContain("Too little spare ADA for a Lovejoin box");
  });

  it("quotes what a stop brings back as the whole funding, the token's boxes' share with it", () => {
    expect(approval(lovejoin)).toContain("If you stop it or the order is refunded, its 83.9 ₳ come back through Lovejoin instead");
  });

  it("says what of the token is less than a box comes back directly, beside its boxes (34f's review, 3)", () => {
    // 906.5941 MIN expected, 8 boxes of 100: about 106.5941 MIN isn't a box.
    expect(approval(lovejoin)).toContain("About 106.5941 MIN, less than a box, stays out of the pool: it comes back directly with the session's other money, tied to this session.");
    // A whole number of boxes: nothing more said.
    const exact = text(
      shown(
        createElement(SwapApproval, { summary, quote: { ...quote, amountOut: "800000000" }, lovejoin, pay, get, through: true, onThrough: () => undefined, busy: false }),
      ),
    );
    expect(exact).not.toContain("less than a box");
  });

  it("prices a token swap's stop on its boxes' share alone, as the worker does (34f's review, 8)", () => {
    const tokenIn = { ...quote, ask: { ...quote.ask, tokenIn: `${USDM.policyId}${USDM.assetName}` }, fund: { lovelace: "6000000", tokens: [{ ...USDM, quantity: "10000000" }] } };
    const line = text(
      shown(createElement(SwapApproval, { summary, quote: tokenIn, lovejoin, pay: { id: tokenIn.ask.tokenIn, side: { label: "tUSDM", decimals: 6 } }, get, through: true, onThrough: () => undefined, busy: false })),
    );
    expect(line).toContain("its 67.9 ₳ come back through Lovejoin instead");
  });

  it("still says the token's boxes' costs when the classic pool can't take the spare ADA's", () => {
    const line = approval({ ...lovejoin, skipped: "Lovejoin's pool holds 12 boxes not yours, and the wallet mixes only from 30" });
    expect(line).toContain("On the way back, through Lovejoin");
    expect(line).toContain("Mix fees, about 30.4 ₳");
    expect(line).toContain("so as things are, this swap's ADA comes back directly");
  });

  it("built with its switch off, funds no boxes, says it all comes back at once, and keeps the switch to turn back on", () => {
    const offWay = { ...lovejoin, on: false, ways: undefined, fund: undefined, values: undefined, ifStopped: undefined };
    const turnedOff = text(
      shown(createElement(SwapApproval, { summary, quote, lovejoin: offWay, pay, get, through: false, onThrough: () => undefined, turnedOff: true, busy: false })),
    );
    expect(turnedOff).not.toContain("Lovejoin boxes");
    expect(turnedOff).toContain("The proceeds and everything left, directly");
    expect(turnedOff).toContain("It all comes back at once");
    // Only the token's boxes went through Lovejoin: turned off here, the switch is still there to turn back on.
    expect(turnedOff).toContain("Bring it back through Lovejoin");
    expect(turnedOff).not.toContain("Too little spare ADA for a Lovejoin box");
    // Off from Settings, with nothing Lovejoin would take: as before, no switch (34f's review, 4).
    expect(approval(offWay, false)).not.toContain("Bring it back through Lovejoin");
  });

  it("offers no switch where the token gets no box and nothing else goes, rather than say its ADA is mixed", () => {
    const none = approval({ ...lovejoin, ifStopped: undefined, fund: undefined, ways: [{ ...MIN, pool: A, quantity: "100000000", boxes: 0, pools: [A, B], mixes: 0, mixFees: "0", withdrawFees: "0" }] });
    expect(none).not.toContain("Bring it back through Lovejoin");
    expect(none).not.toContain("Its spare ADA is mixed");
    expect(none).toMatch(/What you get, on the way back (MI )?MIN Comes back directly/);
  });

  it("says why four boxes a mix goes three", () => {
    expect(approval({ ...lovejoin, fellBack: t("lj.width.warn.short") })).toContain(t("lj.width.warn.short"));
    expect(approval(lovejoin)).not.toContain(t("lj.width.warn.short"));
  });

  it("plans the return's last step by what goes into boxes", () => {
    const plan = (props: Parameters<typeof Plan>[0]) => text(createElement(Plan, props));
    expect(plan({ lovejoin: false, adaOut: false, tokenBoxes: true })).toContain("The proceeds in Lovejoin boxes, later; the rest at once");
    expect(plan({ lovejoin: true, adaOut: false, tokenBoxes: true })).toContain("The proceeds and spare ADA in Lovejoin boxes, later; the rest at once");
    expect(plan({ lovejoin: true, adaOut: false })).toContain("The proceeds and the rest at once; spare ADA in Lovejoin boxes, later");
  });
});

describe("a mix's reviews in a token pool, and four boxes a mix", () => {
  it("names the pool's box value, its token leaving with the ADA, and four wide", () => {
    const summary = {
      network: "preprod",
      txHash: "ab".repeat(32),
      index: 0,
      address: "addr_test1" + "q".repeat(50),
      payments: [
        { address: "a", own: false, lovelace: "9800000", minimum: null, tokens: [{ ...MIN, quantity: "100000000" }] },
        { address: "a", own: false, lovelace: "5000000", minimum: null, tokens: [] },
      ],
      max: false,
      fee: { size: "0", compute: "0", scriptReference: "0", total: "300000" },
      changeLovelace: "0",
      changeTokens: 0,
      changeOutputs: 1,
      changeMinimum: "0",
      inputs: 1,
      left: 0,
      mix: { boxes: 1, lovelace: "9800000", mixes: 5, mixFees: "6750000", depth: 2, delay: "1-6", pool: A, token: { ...MIN, quantity: "100000000" }, width: 4 },
    } as unknown as SessionOutSummary & { mix: never };
    const review = text(shown(createElement(PrivateReview, { summary, box: MIN_100 })));
    expect(review).toContain("For the boxes, their mixes and network fees 9.8 ₳ and 100 MIN");
    expect(review).toContain("Into Lovejoin 1 box of 100 MIN + 4.5 ₳");
    expect(review).toContain("Mixed 2 waves deep, 5 mixes, about 6.75 ₳, four boxes a mix");
    expect(review).toContain("Yours is one of up to 16 boxes at 2 waves deep");
    expect(review).toContain("and 1 token");
    // The classic pool's, as it said before.
    const classic = text(shown(createElement(PrivateReview, { summary: { ...summary, payments: [{ ...summary.payments[0]!, tokens: [] }, summary.payments[1]!], mix: { boxes: 1, lovelace: "12450000", mixes: 4, mixFees: "3800000", depth: 2, delay: "1-6" } } as never })));
    expect(classic).toContain("Into Lovejoin 1 box of 10 ₳");
    expect(classic).toContain("Mixed 2 waves deep, 4 mixes, about 3.8 ₳");
    expect(classic).not.toContain("four boxes a mix");
  });

  it("says a public mix's token leaves the account with its ADA, and why four went three", () => {
    const summary = {
      network: "preprod",
      txHash: "ab".repeat(32),
      entry: "cd".repeat(32),
      boxes: 2,
      depth: 1,
      delay: "1-6",
      mixes: 2,
      txs: 3,
      fees: "2000000",
      change: "0",
      pool: A,
      token: { ...MIN, quantity: "200000000" },
      fellBack: t("lj.width.warn.short"),
    } as never;
    const review = text(shown(createElement(PublicReview, { summary, box: MIN_100 })));
    expect(review).toContain("Into Lovejoin 2 boxes of 100 MIN + 4.5 ₳");
    expect(review).toContain("11 ₳ and 1 token");
    expect(review).toContain(t("lj.width.warn.short"));
  });
});

describe("Home's In Lovejoin, a row per pool with something there", () => {
  it("lists the classic pool as before, then each token pool, by what its boxes hold", () => {
    const held: LovejoinHeld = {
      boxes: 2,
      lovelace: "20000000",
      next: Date.now() + 3_600_000,
      notMixed: 0,
      stopped: 0,
      pools: [{ id: A, boxes: 1, lovelace: "4500000", token: { ...MIN, quantity: "100000000" }, next: Date.now() + 7_200_000, notMixed: 1, box: MIN_100 }],
    };
    const row = text(shown(createElement(InLovejoin, { held, now: Date.now(), onOpen: () => undefined })));
    expect(row).toContain("2 boxes of 10 ₳ 20 ₳");
    expect(row).toContain("1 box of 100 MIN + 4.5 ₳ 4.5 ₳");
    expect(row).toContain("1 not mixed yet: open Lovejoin to see what to do.");
    // Only the token pool has boxes: it still lists the classic pool's row first only when that has something.
    const tokenOnly = text(shown(createElement(InLovejoin, { held: { ...held, boxes: 0, lovelace: "0", next: null }, now: Date.now(), onOpen: () => undefined })));
    expect(tokenOnly).not.toContain("of 10 ₳");
    expect(tokenOnly).toContain("1 box of 100 MIN + 4.5 ₳");
  });

  it("shows the row for a token pool's boxes alone (34f's review, 1)", () => {
    const empty: LovejoinHeld = { boxes: 0, lovelace: "0", next: null, notMixed: 0, stopped: 0 };
    expect(inLovejoinShown(empty)).toBe(false);
    expect(inLovejoinShown({ ...empty, pools: [{ id: A, boxes: 1, lovelace: "4500000", next: null, notMixed: 0, box: MIN_100 }] })).toBe(true);
    expect(inLovejoinShown({ ...empty, pools: [{ id: A, boxes: 0, lovelace: "0", next: null, notMixed: 2 }] })).toBe(true);
    expect(inLovejoinShown({ ...empty, stopped: 1 })).toBe(true);
  });

  it("names a pool by its id where it wasn't read this time, never as boxes of 0 ₳ (34f's review, 9)", () => {
    const held: LovejoinHeld = { boxes: 0, lovelace: "0", next: null, notMixed: 0, stopped: 0, pools: [{ id: A, boxes: 2, lovelace: "0", next: Date.now() + 1000, notMixed: 0 }] };
    const row = text(shown(createElement(InLovejoin, { held, now: Date.now(), onOpen: () => undefined })));
    expect(row).toContain("2 boxes in pool a1a1a1a1…a1a1");
    expect(row).not.toContain("0 ₳");
  });
});

describe("Settings' four boxes a mix (chunk 34's D3)", () => {
  it("is a switch, three by default, and prices each depth at the width chosen", () => {
    const three = renderToStaticMarkup(shown(createElement(Settings.LovejoinSettings, { network: "preprod" })));
    expect(three).toMatch(/data-testid="lovejoin-four-switch"[^>]*|aria-checked="false"[^>]*data-testid="lovejoin-four-switch"/);
    expect(text(shown(createElement(Settings.LovejoinSettings, { network: "preprod" })))).toContain("Each mix puts a box with two others");
    const four = text(shown(createElement(Settings.LovejoinSettings, { network: "preprod" }), { lovejoinWidth: 4 }));
    expect(four).toContain("Each mix puts a box with three others, not two");
    expect(four).toContain("2 waves deep: 5 mixes, about 6.75 ₳");
    expect(four).toContain("Yours is one of up to 16 boxes at 2 waves deep");
    expect(Settings.depthCost("preprod", 2)).toMatch(/^4 mixes, about 3\.8\s₳$/);
    expect(Settings.depthCost("preprod", 2, 4)).toMatch(/^5 mixes, about 6\.75\s₳$/);
  });
});

// Unused type imports are what the fixtures above are built against.
export type _Fixtures = SessionBackSummary;
