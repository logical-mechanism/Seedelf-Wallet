// 1.6.0's release review, the screens' findings (UI-3, UI-4, UI-6, UI-7, UI-9, UI-11, UI-12) and the preprod
// rehearsal's (R1, R3, R4, R6, R7): each rendered as the page shows it, or, where a page's state decides it, the rule
// it follows. Each failed before its fix.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { t } from "../src/i18n";
import { DataParts } from "../src/background/data-layer";
import { PoolDiscovery, REFRESH_MS } from "../src/background/lovejoin-pools";
import { privateIndexClient } from "../src/background/private-index";
import { DEFAULT_PREFERENCES, type Preferences } from "../src/shared/preferences";
import type { LovejoinMixView, LovejoinPublicSummary, PendingTx, SessionBackSummary, SessionOutSummary, SessionView, SwapLovejoin, SwapQuote } from "../src/shared/rpc";
import { CollateralReserveRow, CollateralTailNote, CollateralTailRow, LovejoinNote, LovejoinSwitch } from "../src/ui/components/LovejoinReturn";
import { SENT, PendingBanner } from "../src/ui/components/PendingBanner";
import { poolsOf } from "../src/ui/lovejoin-pools";
import { NetworkContext } from "../src/ui/network";
import { PreferencesContext } from "../src/ui/preferences";
import { ClaimReview } from "../src/ui/screens/ClaimAll";
import * as LovejoinScreen from "../src/ui/screens/Lovejoin";
import { LaunchBootstrapNote } from "../src/ui/screens/LovejoinLaunch";
import { SwapApproval } from "../src/ui/screens/Swaps";
import { fakeIndex } from "./fake-index";
import { memoryArea } from "./fakes";

const { MixList, PrivateReview, PublicReview, formRoom, poolRoom, publicNeedsText } = LovejoinScreen;

/** A page's text, as a person reads it, on `network`. */
function text(element: ReactElement, network: "preprod" | "mainnet" = "preprod"): string {
  return renderToStaticMarkup(createElement(NetworkContext.Provider, { value: network }, element))
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** `element` with the balances shown. */
const shown = (element: ReactElement, prefs: Partial<Preferences> = {}) =>
  createElement(
    PreferencesContext.Provider,
    { value: { prefs: { ...DEFAULT_PREFERENCES, hideBalances: false, ...prefs }, loaded: true, set: async () => undefined } },
    element,
  );

/** MIN, on preprod's token list. */
const MIN = { policyId: "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed72", assetName: "4d494e" };
const A = "a1".repeat(28);
const MIN_100 = { lovelace: "4500000", token: { ...MIN, quantity: "100000000" } };

describe("the pending banner names a pool's start as a noun, as every other kind (R1)", () => {
  it("reads 'A Lovejoin pool's start sent', not 'Starts a Lovejoin pool sent'", () => {
    expect(t(SENT["lovejoin-launch"])).toBe("A Lovejoin pool's start");
    const pending = { network: "preprod", txHash: "ab".repeat(32), kind: "lovejoin-launch", submittedAt: Date.now(), confirmations: null } as PendingTx;
    const banner = text(createElement(PendingBanner, { pending, watching: true, onDismiss: () => undefined }));
    expect(banner).toContain("A Lovejoin pool's start sent. Waiting for the network");
  });
});

describe("a private Bootstrap's review (R3, R4)", () => {
  // 40 boxes of 100 MIN + 4.5 ₳ from the private balance, as the rehearsal reviewed it.
  const summary = {
    network: "preprod",
    txHash: "ab".repeat(32),
    index: 1,
    address: "addr_test1" + "q".repeat(50),
    payments: [
      { address: "a", own: false, lovelace: "181500000", minimum: null, tokens: [{ ...MIN, quantity: "4000000000" }] },
      { address: "a", own: false, lovelace: "5000000", minimum: null, tokens: [] },
    ],
    max: false,
    fee: { size: "0", compute: "0", scriptReference: "0", total: "236778" },
    changeLovelace: "0",
    changeTokens: 0,
    changeOutputs: 1,
    changeMinimum: "0",
    inputs: 1,
    left: 0,
    mix: { boxes: 40, lovelace: "181500000", mixes: 0, mixFees: "0", depth: 0, delay: "1-6", bootstrap: true, pool: A, token: { ...MIN, quantity: "4000000000" } },
  } as unknown as SessionOutSummary & { mix: never };

  it("names the token in its total, as the row above does (R3)", () => {
    const review = text(shown(createElement(PrivateReview, { summary, box: MIN_100 })));
    expect(review).toContain("Total leaving your private balance 186.736778 ₳ and 4,000 MIN");
    expect(review).not.toContain("and 1 token");
  });

  it("says what the funding is for without mixes, since a Bootstrap has none (R4)", () => {
    const review = text(shown(createElement(PrivateReview, { summary, box: MIN_100 })));
    expect(review).toContain("For the boxes and network fees 181.5 ₳ and 4,000 MIN");
    expect(review).not.toContain("their mixes");
    // A mix's review says its mixes, as before.
    const mix = { ...summary, mix: { ...(summary.mix as object), bootstrap: undefined, depth: 2, mixes: 160, mixFees: "152000000" } } as typeof summary;
    expect(text(shown(createElement(PrivateReview, { summary: mix, box: MIN_100 })))).toContain("For the boxes, their mixes and network fees");
  });
});

describe("a public mix's review into a token pool names its token in the total (R3)", () => {
  it("reads '15.852214 ₳ and 200 MIN', the token known and named above", () => {
    const summary = {
      network: "preprod",
      txHash: "ab".repeat(32),
      entry: "cd".repeat(32),
      boxes: 2,
      depth: 2,
      delay: "1-6",
      mixes: 8,
      txs: 9,
      fees: "6852214",
      change: "0",
      pool: A,
      token: { ...MIN, quantity: "200000000" },
    } as LovejoinPublicSummary;
    const review = text(shown(createElement(PublicReview, { summary, box: MIN_100 })));
    expect(review).toContain("Total leaving your public account 15.852214 ₳ and 200 MIN");
    expect(review).not.toContain("and 1 token");
    // The classic pool's, as it read before: no token.
    const classic = text(shown(createElement(PublicReview, { summary: { ...summary, pool: undefined, token: undefined } })));
    expect(classic).toContain("Total leaving your public account 26.852214 ₳");
  });
});

describe("a pool's start's review says Bootstrap comes next, on every network (R7)", () => {
  it("offers Bootstrap where the network has no floor, and says the floor where it has one", () => {
    expect(text(createElement(LaunchBootstrapNote), "preprod")).toContain("Bootstrap it from its page");
    expect(text(createElement(LaunchBootstrapNote), "mainnet")).toContain("once it holds 30 boxes not yours");
  });
});

describe("the swap approval says what of the token goes into no box (UI-3)", () => {
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
  const lovejoin = (boxes: number): SwapLovejoin => ({
    boxes: 0,
    depth: 2,
    mixes: 0,
    mixFees: "0",
    withdrawFees: "0",
    delay: "1-6",
    on: true,
    ways: [{ ...MIN, pool: A, quantity: "100000000", boxes, pools: [A], mixes: boxes * 4, mixFees: "30400000", withdrawFees: "2400000" }],
    fund: "67900000",
    values: { [A]: MIN_100 },
  });
  const summary = {
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
  } as SessionOutSummary;
  const approval = (boxes: number) =>
    text(
      shown(
        createElement(SwapApproval, {
          summary,
          quote,
          lovejoin: lovejoin(boxes),
          pay: { id: "lovelace", side: { label: "₳", decimals: 6 } },
          get: { id: unit, side: { label: "MIN", decimals: 6 } },
          through: true,
          onThrough: () => undefined,
          busy: false,
        }),
      ),
    );

  it("never calls a box's worth or more 'less than a box'", () => {
    // The boxes capped at 7 by the pool's room or a chain: about 206.5941 MIN, two boxes' worth, comes back directly.
    const capped = approval(7);
    expect(capped).toContain("About 206.5941 MIN isn't put in a box, so it stays out of the pool");
    expect(capped).not.toContain("less than a box");
    // Less than a box: the same words, still true.
    expect(approval(9)).toContain("About 6.5941 MIN isn't put in a box, so it stays out of the pool");
  });
});

describe("a return's review says why four boxes a mix went three (UI-4)", () => {
  const back = (fellBack?: string): SessionBackSummary => ({
    network: "preprod",
    index: 3,
    txHash: "ab".repeat(32),
    fee: "300000",
    lovelace: "5200000",
    tokens: [],
    depositOutputs: 1,
    inputs: 2,
    lovejoin: { boxes: 2, depth: 2, mixes: 8, fees: "8000000", txs: 10, delay: "1-6", entry: "11".repeat(32), ...(fellBack ? { fellBack } : {}) },
  });

  it("on a swap's or a site's return review (LovejoinNote)", () => {
    expect(text(createElement(LovejoinNote, { back: back(t("lj.width.warn.cost")) }))).toContain(t("lj.width.warn.cost"));
    expect(text(createElement(LovejoinNote, { back: back() }))).not.toContain("three at a time");
  });

  it("on Bring everything back's review, each reason once", () => {
    const review = (returns: SessionBackSummary[]) =>
      text(
        createElement(ClaimReview, {
          built: { returns, skipped: [] },
          chosen: new Set(returns.map((r) => r.index)),
          sessions: [],
          direct: false,
          busy: false,
          onToggle: () => undefined,
          onDirect: () => undefined,
        }),
      );
    const two = review([back(t("lj.width.warn.short")), { ...back(t("lj.width.warn.short")), index: 4 }]);
    expect(two.split(t("lj.width.warn.short")).length - 1).toBe(1);
    expect(review([back()])).not.toContain("three at a time");
  });
});

// The owner's calls (2026-10-22 and 2026-10-23): a return that mixes its session's 5 ₳ collateral once on its way into
// a pool of 5 ₳ boxes says so, and what that mix costs; a funding that pays for it says what it pays.
describe("a return's review names the collateral's mix", () => {
  const back = (boxed: boolean, index = 3): SessionBackSummary => ({
    network: "preprod",
    index,
    txHash: "ab".repeat(32),
    fee: "300000",
    lovelace: "5200000",
    tokens: [],
    depositOutputs: 1,
    inputs: 2,
    ...(boxed
      ? {
          collateralTail: {
            box: { txHash: "ef".repeat(32), txIndex: 0 },
            leaf: { txHash: "01".repeat(32), txIndex: 2 },
            fee: "1100000",
            pool: "cd".repeat(28),
            txs: 2,
          },
        }
      : {}),
  });

  it("on a swap's or a site's return review, and nothing where the collateral comes back with the rest", () => {
    const row = text(createElement(CollateralTailRow, { back: back(true) }));
    expect(row).toContain("Its 5 ₳ collateral");
    expect(row).toContain("Mixed once in Lovejoin's pool of 5 ₳ boxes, for 1.1 ₳");
    const note = text(createElement(CollateralTailNote, { back: back(true) }));
    expect(note).toContain("is mixed there once, with two other people's boxes");
    expect(note).toContain("giveme.my backs that mix");
    expect(note).toContain("anyone can tie it to this session");
    expect(text(createElement(CollateralTailRow, { back: back(false) }))).toBe("");
    expect(text(createElement(CollateralTailNote, { back: back(false) }))).toBe("");
  });

  it("on a funding's review, what it pays for that mix, and nothing where it pays nothing", () => {
    const row = text(createElement(CollateralReserveRow, { reserve: "1500000" }));
    expect(row).toContain("For its collateral's mix");
    expect(row).toContain("1.5 ₳, and what it doesn't use comes back");
    expect(text(createElement(CollateralReserveRow, {}))).toBe("");
  });

  it("on Bring everything back's, counted across the sessions", () => {
    const review = text(
      createElement(ClaimReview, {
        built: { returns: [back(true), back(true, 4), back(false, 5)], skipped: [] },
        chosen: new Set([3, 4, 5]),
        sessions: [],
        direct: false,
        busy: false,
        onToggle: () => undefined,
        onDirect: () => undefined,
      }),
    );
    expect(review).toContain("2 boxes in Lovejoin's pool of 5 ₳ boxes, each mixed once");
    expect(review).toContain("Each session's 5 ₳ collateral becomes a box");
    expect(review).toContain("giveme.my backs each of those mixes");
    // Each that comes back directly sends its collateral's deposit and mix before its return: 3, 3 and 1.
    expect(review).toContain(`${t("claim.transactions")} 7`);
  });
});

describe("Your mixes when the pool read failed (UI-6)", () => {
  const now = Date.now();

  it("names a classic mix's boxes as the classic pool's, never by an empty id", () => {
    const entries: LovejoinMixView[] = [{ id: "e1", at: now, account: 0, shares: [{ boxes: 2, back: 0, moved: 0 }] }];
    const list = text(shown(createElement(MixList, { entries, sessions: [], chains: [], pools: poolsOf(undefined), busy: false, onRetry: () => undefined, onStop: () => undefined })));
    expect(list).toContain("2 boxes of 10 ₳");
    expect(list).not.toContain("in pool");
  });

  it("names a token pool's mix session not read this time by its pool's id, never as the classic pool's boxes", () => {
    const session = { index: 4, createdAt: now, stage: "funding", txs: [], mix: { boxes: 2, pool: A }, address: "addr", holding: null, auto: {} } as unknown as SessionView;
    const list = text(shown(createElement(MixList, { entries: [], sessions: [session], chains: [], pools: poolsOf(undefined), busy: false, onRetry: () => undefined, onStop: () => undefined })));
    expect(list).not.toContain("of 10 ₳");
    expect(list).toContain("2 boxes in pool a1a1a1a1…a1a1");
  });
});

describe("the Mix form's Four boxes a mix switch: four takes what fits at four, and says what three would (the owner's test of 1.6.0)", () => {
  const pool = (free: number) => ({ others: free, free, floor: 0 });
  const room = (width: number, depth: number, free: number) =>
    formRoom(width, depth, poolRoom(pool(free), 1, depth, width), width === 4 ? poolRoom(pool(free), 1, depth, 3) : undefined);

  it("stops at four's room where the pool is short for four, and names three's", () => {
    // The MIN pool as the owner tested it: 39 boxes not theirs, two waves deep. Four a mix needs 15 a box, three 8.
    expect(room(4, 2, 39)).toEqual({ most: 2, three: 4 });
    // None at four: the stepper offers none, and three's room is said.
    expect(room(4, 2, 10)).toEqual({ most: 0, three: 1 });
    // Three a mix: its own room, nothing more to say.
    expect(room(3, 2, 39)).toEqual({ most: 4 });
  });

  it("stops at one chain's length at four, and at ten either way", () => {
    // Three waves deep, a box is 21 mixes four wide: six boxes make 126 of a chain's 130; three wide, ten make 130.
    expect(room(4, 3, 10_000)).toEqual({ most: 6, three: 10, chain: true });
    expect(room(4, 1, 10_000)).toEqual({ most: 10 });
    expect(room(3, 3, 10_000)).toEqual({ most: 10 });
  });

  it("says which caps four: one chain's length, or the pool's room where it caps first or as soon (1.6.0's review)", () => {
    // 10,000 free: the chain, which the pool doesn't cap, is the reason.
    expect(t("lovejoin.mix.capFourChain", { count: 6, three: 10 })).toBe("At four boxes a mix one chain this deep takes 6 boxes; at three, 10.");
    // 378 free: the pool has room for six at four, as the chain does: its room is said, as before.
    expect(room(4, 3, 378)).toEqual({ most: 6, three: 10 });
    // 300 free: the pool's room, four at four, caps first.
    expect(room(4, 3, 300)).toEqual({ most: 4, three: 10 });
  });

  it("says the switch in Settings' words, with what three would take on a review that went four, and starts as Settings has it", () => {
    const { FourSwitch } = LovejoinScreen;
    const PoolPage = (LovejoinScreen as unknown as { PoolPage: (props: Record<string, unknown>) => ReactElement }).PoolPage;
    const nothing = () => undefined;
    const off = text(shown(createElement(FourSwitch, { four: false, busy: false, onFour: nothing, testId: "x" })));
    expect(off).toBe(`${t("settings.lovejoin.four")} ${t("settings.lovejoin.privacy.fourOff")}`);
    const on = text(shown(createElement(FourSwitch, { four: true, busy: false, onFour: nothing, atThree: 2, testId: "x" })));
    expect(on).toContain(t("settings.lovejoin.privacy.fourOn"));
    expect(on).toContain("Three boxes a mix would take 2 of your boxes now.");
    // The Mix form's, from Settings until it's turned.
    const form = (width: 3 | 4) =>
      renderToStaticMarkup(
        createElement(
          NetworkContext.Provider,
          { value: "preprod" },
          shown(
            createElement(PoolPage, {
              pool: { id: A, box: MIN_100, others: 40, free: 40, floor: 0, boxes: [], lovelace: "0", due: [], notMixed: [], fromPublic: [] },
              seedelf: { lovelace: "500000000", tokens: [], utxos: 1, seedelfs: [], locked: { lovelace: "0", tokens: [], utxos: 0 } },
              reading: false,
              readFailed: false,
              mixingAgain: false,
              sending: null,
              onSendingPublic: nothing,
              onSending: nothing,
              onRefresh: async () => undefined,
              onBack: nothing,
              onPending: nothing,
            }),
            { lovejoinWidth: width },
          ),
        ),
      );
    expect(form(4)).toMatch(/aria-checked="true"[^>]*data-testid="lovejoin-mix-four-switch"/);
    expect(form(3)).toMatch(/aria-checked="false"[^>]*data-testid="lovejoin-mix-four-switch"/);
  });

  it("holds nothing back below the floor, which Review says itself", () => {
    expect(formRoom(4, 2, { ...poolRoom(pool(5), 1, 2, 4), floorShort: true }, { ...poolRoom(pool(5), 1, 2, 3), floorShort: true })).toEqual({ most: 10 });
  });
});

describe("a token pool's public Mix row (UI-11)", () => {
  it("names the token it needs, and not ADA alone", () => {
    const funding = { lovelace: "9800000", token: { ...MIN, quantity: "100000000" } };
    const line = publicNeedsText("preprod", funding);
    expect(line).toContain("100 MIN");
    expect(line).not.toContain("in ADA alone");
    // The classic pool's, as before.
    expect(publicNeedsText("preprod", { lovelace: "15300000" }).replace(/\s+/g, " ")).toBe(
      "Needs 15.3 ₳ in ADA alone, plus collateral for the mixes; what isn't used stays",
    );
  });
});

describe("a return whose only boxes are a token pool's never says its spare ADA is mixed (UI-12)", () => {
  const back = (lovejoin: Partial<NonNullable<SessionBackSummary["lovejoin"]>>): SessionBackSummary => ({
    network: "preprod",
    index: 3,
    txHash: "ab".repeat(32),
    fee: "300000",
    lovelace: "5200000",
    tokens: [],
    depositOutputs: 1,
    inputs: 2,
    lovejoin: { boxes: 2, depth: 2, mixes: 8, fees: "8000000", txs: 10, delay: "1-6", entry: "11".repeat(32), ...lovejoin },
  });
  const note = (b: SessionBackSummary) => text(createElement(LovejoinSwitch, { back: b, through: true, busy: false, onThrough: () => undefined }));

  it("says its tokens go into their own pools", () => {
    for (const tokenOnly of [back({ parts: [{ pool: A, boxes: 2 }] }), back({ pool: A })]) {
      expect(note(tokenOnly)).not.toContain("Its spare ADA is mixed");
      expect(note(tokenOnly)).toContain("Its tokens go into their own pools in whole boxes");
    }
    // With the classic pool's boxes beside them, or alone: its spare ADA is mixed, as before.
    expect(note(back({ parts: [{ pool: A, boxes: 1 }, { boxes: 1 }] }))).toContain("Its spare ADA is mixed");
    expect(note(back({}))).toContain("Its spare ADA is mixed");
  });
});

describe("the data layer's crowds go with the data layer (UI-9)", () => {
  /** Discovery over a data layer whose Koios-only switch the test holds, its list counting the classic pool's crowd. */
  function setup() {
    const index = fakeIndex();
    index.poolList = { network: "mainnet", cursor: `100000000.${"0".repeat(64)}`, classic: { crowd: { boxes: 80, deposits: 12, mixed: 70 } }, pools: [] };
    const switches = { koiosOnly: false };
    const parts = new DataParts(memoryArea(), () => 1_800_000_000_000);
    const client = privateIndexClient({ koiosOnly: async () => switches.koiosOnly, parts, fetch: index.fetch, limits: {} }, () => "https://data.test");
    const clock = { now: 1_800_000_000_000 };
    const found = new PoolDiscovery({
      local: memoryArea(),
      wasm: {} as never,
      koios: () => undefined as never,
      index: client,
      now: () => clock.now,
      listed: () => new Set(),
      headStart: () => ({ height: 0, pools: [] }),
    });
    return { index, switches, clock, found };
  }

  it("says none once Settings' Koios-only is on, at the next read, however soon", async () => {
    const { switches, found } = setup();
    await found.refresh("preprod");
    expect(found.crowdsOf("preprod")?.get("classic")).toEqual({ boxes: 80, deposits: 12, mixed: 70 });
    switches.koiosOnly = true;
    await found.refresh("preprod");
    expect(found.crowdsOf("preprod")).toBeUndefined();
  });

  it("says none once the data layer can't answer", async () => {
    const { index, clock, found } = setup();
    await found.refresh("preprod");
    expect(found.crowdsOf("preprod")).toBeDefined();
    index.tokensFail = Response.json({ error: "behind" }, { status: 503 });
    clock.now += REFRESH_MS;
    await found.refresh("preprod");
    expect(found.crowdsOf("preprod")).toBeUndefined();
  });
});

describe("a pool's page reads the collateral again from each new reading Home hands it (R6)", () => {
  it("tells a new reading of the public account from the same one handed down again", () => {
    const { readingOf } = LovejoinScreen;
    const kept = { lovelace: "100000000", utxos: 2, incoming: { lovelace: "94800000", tokens: [], utxos: 2 } };
    // The collateral's payment landed and Home read the account again: its outputs are UTxOs now, not on their way.
    const read = { lovelace: "194800000", utxos: 4 };
    expect(readingOf(kept)).not.toBe(readingOf(read));
    // Home re-renders every few seconds with the same reading: no read for that.
    expect(readingOf({ ...kept })).toBe(readingOf(kept));
    expect(readingOf(undefined)).toBe("");
  });
});
