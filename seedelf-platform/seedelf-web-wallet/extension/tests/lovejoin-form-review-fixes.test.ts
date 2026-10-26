// 1.6.0's release review, fix round 2's Lovejoin screens (fixer sc-lj-1). The Mix form counts what a mix from the
// private balance pays for its collateral's mix, in its figures and its stepper, and says the collateral comes back
// later as a box (320-screens#2, 321-lj-screens#3, 321-lj-screens#4, 323-worker#0's form half, 323-worker#6 and
// gap-3#2's Lovejoin part); the public side's cap counts only what its chain spends (321-lj-screens#1); Mix my boxes
// again's switch shows the width its review is at (320-screens#4, 321-lj-screens#2); the private mix reviews say
// giveme.my sees the collateral's mix (x-privacy#1); and a Bootstrap of one box is said in the singular
// (x-i18n-es#2). Each rendered as the page shows it, or, where the page's state decides it, the rule it follows; the
// stepper's count against the real WebAssembly's funding. Each failed before its fix.
import { readFileSync } from "node:fs";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService, type PoolRef } from "../src/background/lovejoin";
import { Minswap } from "../src/background/minswap";
import { SessionService } from "../src/background/sessions";
import { t } from "../src/i18n";
import { i18n } from "../src/i18n/core";
import bundled from "../src/lovejoin-pools.json";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import type { LovejoinFunding, LovejoinMixView, LovejoinPublicSummary, SessionOutSummary, UtxoInfo } from "../src/shared/rpc";
import { poolsOf, type ShownPool } from "../src/ui/lovejoin-pools";
import { NetworkContext } from "../src/ui/network";
import { PreferencesContext } from "../src/ui/preferences";
import * as LovejoinScreen from "../src/ui/screens/Lovejoin";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, ownedUtxos, testBalances, vectors } from "./fakes";

const {
  AgainSwitch,
  CollateralIfLeft,
  MixList,
  MixMoves,
  PrivateReview,
  mixCosts,
  mixMost,
  mixOffer,
  publicMixAda,
  publicSideOf,
  reviewHint,
  tailReserveOf,
  widthTurned,
} = LovejoinScreen;

/** Markup's text, as a person reads it. */
const words = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();

/** A page's markup on preprod, its balances shown unless `hidden`. */
const html = (element: ReactElement, hidden = false) =>
  renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      { value: "preprod" },
      createElement(
        PreferencesContext.Provider,
        { value: { prefs: { ...DEFAULT_PREFERENCES, hideBalances: hidden }, loaded: true, set: async () => undefined } },
        element,
      ),
    ),
  );
const text = (element: ReactElement, hidden = false) => words(html(element, hidden));

const ADA = 1_000_000n;
/** The classic pool's box. */
const BOX = 10_000_000n;
/** One box of the classic pool, two waves deep: the box, four mixes at 0.95 ₳ and the 1.5 ₳ reserve. */
const ONE = { boxes: 1, lovelace: "15300000", mixFees: "3800000" };
/** Preprod's 5 ₳ pool, as the page's read has it. */
const FIVE_ID = "18c4df7733af269d30354df99544697dae3311cebacd48d751b89fed";
const five = (extra: Partial<ShownPool> = {}): ShownPool => ({
  id: FIVE_ID,
  box: { lovelace: "5000000" },
  others: 2,
  free: 2,
  floor: 0,
  boxes: [],
  lovelace: "0",
  due: [],
  notMixed: [],
  fromPublic: [],
  ...extra,
});
/** What lovejoin-funding names for a mix from the private balance where that pool would take its collateral. */
const TAILED = { collateralReserve: "1500000", collateralPool: FIVE_ID };

describe("the Mix form counts what a mix from the private balance pays for its collateral's mix (1.6.0's release review, 320-screens#2, 321-lj-screens#3)", () => {
  it("while the 5 ₳ pool it names holds its floor, two of its boxes free, and takes new boxes, as the worker builds it", () => {
    expect(tailReserveOf(TAILED, "private", [five()])).toBe(1_500_000n);
    // Under the network's floor, with fewer than two boxes to draw, or a pool that takes no new box: the worker
    // funds no reserve (collateralPool), so the form counts none.
    expect(tailReserveOf(TAILED, "private", [five({ others: 29, free: 29, floor: 30 })])).toBe(0n);
    expect(tailReserveOf(TAILED, "private", [five({ free: 1 })])).toBe(0n);
    expect(tailReserveOf(TAILED, "private", [five({ unusable: { why: "superseded" } })])).toBe(0n);
    expect(tailReserveOf(TAILED, "private", [])).toBe(0n);
    // From the public account, which puts up its own collateral; or with none named (a Bootstrap, the switch off).
    expect(tailReserveOf(TAILED, "public", [five()])).toBe(0n);
    expect(tailReserveOf({}, "private", [five()])).toBe(0n);
    expect(tailReserveOf(undefined, "private", [five()])).toBe(0n);
  });

  it("in what leaves, and the 5 ₳ back later as a box of its own rather than once it's mixed (321-lj-screens#4), the rows adding up", () => {
    const tailed = mixCosts(ONE, "private", BOX, 1_500_000n);
    // 15.3 ₳, its 1.5 ₳ reserve, the 5 ₳ kept aside and this payment's fee: 22.05 ₳, as the review's total counts it.
    expect(tailed.leaving).toBe(22_050_000n);
    // The collateral's mix uses its deposit's fee, its one mix and its box's way back: about 1.5 ₳, a cost.
    expect(tailed.tailFees).toBe(1_500_000n);
    expect(tailed.cost).toBe(mixCosts(ONE, "private").cost + 1_500_000n);
    // The 5 ₳ comes back later as a box, less its way back; once the box is mixed, what the reserves leave.
    expect(tailed.tailBack).toBe(4_700_000n);
    expect(tailed.soon).toBe(1_300_000n);
    expect(tailed.cost + tailed.soon + tailed.later + tailed.tailBack).toBe(tailed.leaving);
    // None paid for: as before, the 5 ₳ back once it's mixed (the classic pool with no 5 ₳ pool shown).
    expect(mixCosts(ONE, "private", BOX, 0n)).toEqual(mixCosts(ONE, "private"));
    expect(mixCosts(ONE, "private")).toMatchObject({ leaving: 20_550_000n, soon: 6_000_000n, tailFees: 0n, tailBack: 0n });
    // From the public account none is counted.
    expect(mixCosts(ONE, "public", BOX, 1_500_000n)).toEqual(mixCosts(ONE, "public"));
  });

  it("on the form's rows: the reserve beside the boxes, the total, and the collateral's own row under Back later", () => {
    const funding: LovejoinFunding = { ...ONE, mixes: 4, depth: 2, delay: "1-6", ...TAILED };
    const rows = (tail: bigint) => text(createElement(MixMoves, { source: "private", funding, costs: mixCosts(funding, "private", BOX, tail) }));
    const tailed = rows(1_500_000n);
    expect(tailed).toContain(`${t("lovejoin.mix.intoOneTime")} 16.8 ₳`);
    expect(tailed).toContain(`${t("lovejoin.collateralReserve.label")} ${t("lovejoin.collateralReserve.value", { ada: "1.5" })}`);
    expect(tailed).toContain(`${t("lovejoin.mix.totalPrivate")} 22.05 ₳`);
    expect(tailed).toContain(`${t("lovejoin.mix.backSoon")} 1.3 ₳`);
    expect(tailed).toContain(`${t("lovejoin.collateralBox.label")} The box, about 4.7 ₳ once brought back, after 1 to 6 hours`);
    // None: the rows as they were, byte for byte.
    const before = rows(0n);
    expect(before).toContain(`${t("lovejoin.mix.intoOneTime")} 15.3 ₳`);
    expect(before).not.toContain(t("lovejoin.collateralReserve.label"));
    expect(before).toContain(`${t("lovejoin.mix.totalPrivate")} 20.55 ₳`);
    expect(before).toContain(`${t("lovejoin.mix.backSoon")} 6 ₳`);
    expect(before).not.toContain(t("lovejoin.collateralBox.label"));
  });
});

describe("the Mix form's stepper keeps room for the fee and the change's least (1.6.0's release review, 323-worker#0)", () => {
  const side = (lovelace: bigint) => ({ lovelace: lovelace.toString(), tokens: [] });
  it("counts a box only where the funding, the 5 ₳, its fee and its change's least are held, and the reserve too where it's kept aside", () => {
    // 15.3 ₳ and the 5 ₳ kept aside, and about 1.7 ₳ for the funding's fee and the least its change holds today.
    expect(mixMost("private", side(22_300_000n), undefined, ONE, BOX, 10).adaMost).toBe(1);
    expect(mixMost("private", side(22_299_999n), undefined, ONE, BOX, 10).adaMost).toBe(0);
    // With the collateral's reserve kept aside too: what decides whether the form's figures count it, never its cap
    // (mixOffer; 1.6.0's review of the fixes, R3-7).
    expect(mixMost("private", side(23_799_999n), undefined, ONE, BOX, 10, 1_500_000n).adaMost).toBe(0);
    expect(mixMost("private", side(23_800_000n), undefined, ONE, BOX, 10, 1_500_000n).adaMost).toBe(1);
    // The public account puts up its own collateral and pays no reserve: nothing set aside there.
    expect(mixMost("public", side(15_300_000n), undefined, ONE, BOX, 10, 1_500_000n).adaMost).toBe(1);
  });
});

describe("the Mix form never caps or refuses on its collateral's reserve, and counts it where the count leaves room for it (1.6.0's review of the fixes, R3-7)", () => {
  const side = (lovelace: bigint) => ({ lovelace: lovelace.toString(), tokens: [] });
  /** The form at `boxes` boxes of the classic pool, its balance `held`, a 5 ₳ pool taking its collateral (1.5 ₳). */
  const offer = (held: bigint, boxes = 1, asked = 1_500_000n) => mixOffer("private", side(held), undefined, ONE, BOX, 10, boxes, asked);

  it("offers the box the balance pays without the reserve, counting none in its figures and saying so; the reserve where it fits", () => {
    // 15.3 ₳, the 5 ₳ and the fee's room: the box goes, as the worker funds it without the reserve (orWithoutReserve).
    expect(offer(22_300_000n)).toMatchObject({ adaMost: 1, most: 1, tail: 0n, tailShort: true });
    expect(offer(23_799_999n)).toMatchObject({ adaMost: 1, most: 1, tail: 0n, tailShort: true });
    // The reserve too: counted in the figures, as the worker builds it, and nothing said.
    expect(offer(23_800_000n)).toMatchObject({ adaMost: 1, most: 1, tail: 1_500_000n, tailShort: false });
    // Short of one box without it: refused as before, the reserve never what's short.
    expect(offer(22_299_999n)).toMatchObject({ adaMost: 0, most: 0, tail: 0n, tailShort: false });
  });

  it("stops the stepper where the balance stops without the reserve, and counts it at each count that leaves room for it", () => {
    // Two boxes, 13.8 ₳ each beside the 1.5 ₳: the stepper goes to two without the reserve.
    expect(offer(36_100_000n, 2)).toMatchObject({ adaMost: 2, most: 2, tail: 0n, tailShort: true });
    // At one box of those, the reserve fits.
    expect(offer(36_100_000n, 1)).toMatchObject({ most: 2, tail: 1_500_000n, tailShort: false });
    expect(offer(37_600_000n, 2)).toMatchObject({ most: 2, tail: 1_500_000n, tailShort: false });
  });

  it("is the form as before where nothing is asked: no 5 ₳ pool takes the collateral, or the public account pays", () => {
    expect(offer(22_300_000n, 1, 0n)).toMatchObject({ most: 1, tail: 0n, tailShort: false });
    expect(mixOffer("public", side(15_300_000n), undefined, ONE, BOX, 10, 1)).toMatchObject({ most: 1, tail: 0n, tailShort: false });
  });

  it("says so in one line under the stepper, which nothing else says where it's paid or not asked", () => {
    expect(text(createElement(CollateralIfLeft, { shown: true }))).toBe("At this many, its 5 ₳ collateral is mixed only if enough is left when it comes back.");
    expect(html(createElement(CollateralIfLeft, { shown: false }))).toBe("");
  });
});

describe("the public Mix form's cap counts only the ADA its chain spends (1.6.0's release review, 321-lj-screens#1)", () => {
  const utxo = (lovelace: string, extra: Partial<UtxoInfo> = {}): UtxoInfo => ({ txHash: "aa".repeat(32), index: 0, lovelace, tokens: [], locked: false, ...extra });
  const NFT = { policyId: "bb".repeat(28), assetName: "4e4654", quantity: "1", fingerprint: "asset1nft", decimals: 0 };
  const MIN = { policyId: "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed72", assetName: "4d494e" };
  const account = [
    // 25 ₳ of ADA alone.
    utxo("20000000"),
    utxo("5000000"),
    // 30 ₳ held with an NFT, its collateral, a UTxO kept out of payments, and one holding a reference script.
    utxo("30000000", { tokens: [NFT] }),
    utxo("5000000", { collateral: true, locked: true }),
    utxo("7000000", { locked: true }),
    utxo("3000000", { unspendable: "script" }),
    // 2 ₳ with the MIN pool's token.
    utxo("2000000", { tokens: [{ ...MIN, quantity: "500000000", fingerprint: "asset1min", decimals: 6 }] }),
  ];

  it("its ADA alone, and in a token pool the UTxOs holding its token: never rewards, the collateral, or ADA held with other tokens", () => {
    expect(publicMixAda(account)).toBe("25000000");
    // In the MIN pool (100 MIN a box), the 500 MIN's 2 ₳ too, less the least of the output the boxes' rest goes back
    // in: 1.15939 ₳ for 400 MIN (R3-14, below). Five boxes take it all, and nothing goes back.
    const MIN_BOX = { ...MIN, quantity: "100000000" };
    expect(publicMixAda(account, MIN_BOX)).toBe("25840610");
    expect(publicMixAda(account, MIN_BOX, 5)).toBe("27000000");
    // So one box of 10 ₳ at most, where Home's 63 ₳ (with 8 ₳ of rewards) offered four.
    const held = (lovelace: string) => mixMost("public", { lovelace, tokens: [] }, undefined, ONE, BOX, 10).adaMost;
    expect(held(publicMixAda(account))).toBe(1);
    expect(held("63000000")).toBe(4);
  });
});

describe("the public Mix form's cap in a token pool counts what its chain picks, count by count (1.6.0's review of the fixes, R3-14)", () => {
  const utxo = (lovelace: string, extra: Partial<UtxoInfo> = {}): UtxoInfo => ({ txHash: "aa".repeat(32), index: 0, lovelace, tokens: [], locked: false, ...extra });
  /** A pool of 2 ₳ and 100 of a token a box, its name six bytes, as PR #163's LJTEST pool names its own. */
  const TOK = { policyId: "cc".repeat(28), assetName: "4c4a54455354", quantity: "100" };
  const tok = (quantity: string) => ({ ...TOK, quantity, fingerprint: "asset1tok", decimals: 0 });
  /**
   * The least ADA of the output to the account's own base address that gives back 24 to 255 of the token alone, as
   * core prices it (minimum_address_payment): 160 bytes and its own 109 at 4,310 lovelace a byte. The output is a map of
   * the 57-byte address and its value, 5 ₳ staged and the one token: 68 bytes, and 41 for the token.
   */
  const LEAST = (160n + 109n) * 4_310n;
  /** One box of the pool, one wave deep: its 2 ₳, its one mix at 0.95 ₳, and the 1.5 ₳ reserve. */
  const ONE_TOK = { boxes: 1, lovelace: "4450000", mixFees: "950000" };
  const BOX_TOK = 2_000_000n;

  it("takes the fewest UTxOs holding the token that hold the boxes' worth, the most first, less the least ADA of the output its rest goes back in", () => {
    const account = [
      utxo("9000000"),
      // Three boxes' worth, and half a box's beside 20 ₳: the latter isn't picked while the first holds enough.
      utxo("5400000", { txHash: "a1".repeat(32), tokens: [tok("300")] }),
      utxo("20000000", { txHash: "a2".repeat(32), tokens: [tok("50")] }),
      utxo("5000000", { collateral: true, locked: true }),
    ];
    // One or two boxes: the 300's UTxO, 200 or 100 back in an output of its own.
    expect(publicMixAda(account, TOK, 1)).toBe((9_000_000n + 5_400_000n - LEAST).toString());
    expect(publicMixAda(account, TOK, 2)).toBe((9_000_000n + 5_400_000n - LEAST).toString());
    // Three take it all: nothing goes back.
    expect(publicMixAda(account, TOK, 3)).toBe("14400000");
  });

  it("gives back the other tokens the UTxOs it picks hold too, in the same output", () => {
    const NFT = { policyId: "dd".repeat(28), assetName: "4e4654", quantity: "1", fingerprint: "asset1nft", decimals: 0 };
    const account = [utxo("9000000"), utxo("5400000", { tokens: [tok("100"), NFT] })];
    // One box takes all 100: the NFT goes back alone, an output of 68 bytes and 37 for it (a three-byte name, one of it).
    expect(publicMixAda(account, TOK, 1)).toBe((14_400_000n - (160n + 105n) * 4_310n).toString());
  });

  it("stops the stepper below the first count the pick can't pay, at whatever count it stands", () => {
    const account = [
      utxo("5000000"),
      // Two boxes' worth beside 1.2 ₳, picked first, and one box's beside 10 ₳, picked only for a third.
      utxo("1200000", { txHash: "a1".repeat(32), tokens: [tok("200")] }),
      utxo("10000000", { txHash: "a2".repeat(32), tokens: [tok("100")] }),
    ];
    /** The form at `boxes` boxes, its figure the pick's for that many (publicSideOf), as the page has it. */
    const at = (utxos: UtxoInfo[], boxes: number) =>
      mixOffer("public", publicSideOf({ lovelace: "0", tokens: [tok("300")] }, utxos, TOK, boxes).side, TOK, ONE_TOK, BOX_TOK, 10, boxes, 0n, utxos);
    // One box: 5 ₳ and 1.2 ₳, less the 100 that goes back, pays 4.45 ₳. Two: exactly the 200, 6.2 ₳, short of 7.4 ₳.
    // Three take both, 16.2 ₳, past 10.35 ₳: one box at most all the same, since two can't go, where three's figure
    // alone would offer three, and two the build refuses.
    expect(at(account, 1)).toMatchObject({ adaMost: 1, most: 1 });
    expect(at(account, 3)).toMatchObject({ adaMost: 1, most: 1 });
    // Once two can go it goes on, to three, where one box's figure alone stopped at one: four is more of the token.
    const richer = [utxo("6200000"), ...account.slice(1)];
    expect(at(richer, 1)).toMatchObject({ adaMost: 3, most: 3 });
    // None of the token's UTxOs holds enough for one box: none.
    expect(at([utxo("50000000"), utxo("1500000", { tokens: [tok("50")] })], 1).adaMost).toBe(0);
    // The classic pool, ADA alone, needs no pick: as before.
    expect(mixOffer("public", { lovelace: "25000000", tokens: [] }, undefined, ONE, BOX, 10, 1, 0n, [utxo("25000000")]).most).toBe(1);
  });
});

describe("Mix my boxes again's switch shows the width its review is at (1.6.0's release review, 320-screens#4, 321-lj-screens#2)", () => {
  const summary = (mix: Partial<LovejoinFunding>) =>
    ({ index: 0, address: "addr", payments: [], fee: { total: "200000" }, mix: { boxes: 2, lovelace: "9100000", mixes: 8, mixFees: "7600000", depth: 2, delay: "1-6", again: true, owned: 3, ...mix } }) as unknown as SessionOutSummary & { mix: LovejoinFunding };
  const publicAgain = (extra: Partial<LovejoinPublicSummary>) =>
    ({ network: "preprod", txHash: "ab".repeat(32), entry: "cd".repeat(32), boxes: 2, depth: 2, delay: "1-6", mixes: 8, txs: 8, fees: "7600000", change: "0", again: true, ...extra }) as LovejoinPublicSummary;
  const checked = (markup: string) => markup.match(/aria-checked="(true|false)"[^>]*data-testid="lovejoin-again-four-switch"/)?.[1];
  const nothing = () => undefined;

  it("four only on a review built four wide, whatever was asked of it", () => {
    const of = (review: Parameters<typeof AgainSwitch>[0]["review"]) => html(createElement(AgainSwitch, { review, busy: false, onFour: nothing }));
    expect(checked(of({ source: "private", summary: summary({ width: 4, atThree: 2 }) }))).toBe("true");
    expect(checked(of({ source: "private", summary: summary({}) }))).toBe("false");
    // Four asked, and it went three: the switch says three, as the rows and Send's build are.
    expect(checked(of({ source: "private", summary: summary({ fellBack: t("lj.width.warn.long") }) }))).toBe("false");
    expect(checked(of({ source: "public", summary: publicAgain({ width: 4 }) }))).toBe("true");
    expect(checked(of({ source: "public", summary: publicAgain({}) }))).toBe("false");
    // Not on a mix's review.
    expect(of({ source: "private", summary: summary({ again: undefined }) })).toBe("");
  });

  it("takes the new width only once the review built at it is in, never after that build fails", async () => {
    const taken: boolean[] = [];
    const asked: number[] = [];
    await expect(
      widthTurned(
        true,
        async (w) => {
          asked.push(w);
          throw new Error("Lovejoin's pool changed while the wallet read it");
        },
        (four) => taken.push(four),
      ),
    ).rejects.toThrow("pool changed");
    expect(asked).toEqual([4]);
    expect(taken).toEqual([]);
    await widthTurned(false, async (w) => void asked.push(w), (four) => taken.push(four));
    expect(asked).toEqual([4, 3]);
    expect(taken).toEqual([false]);
  });
});

describe("a private mix's reviews where its funding pays for its collateral's mix (1.6.0's release review, x-privacy#1, 323-worker#6, gap-3#2)", () => {
  const summary = (extra: Partial<SessionOutSummary> = {}, mix: Partial<LovejoinFunding> = {}) =>
    ({
      network: "preprod",
      txHash: "ab".repeat(32),
      index: 0,
      address: "addr_test1" + "q".repeat(50),
      payments: [
        { address: "a", own: false, lovelace: "16800000", minimum: null, tokens: [] },
        { address: "a", own: false, lovelace: "5000000", minimum: null, tokens: [] },
      ],
      max: false,
      fee: { size: "0", compute: "0", scriptReference: "0", total: "233208" },
      changeLovelace: "0",
      changeTokens: 0,
      changeOutputs: 1,
      changeMinimum: "0",
      inputs: 1,
      left: 0,
      ...extra,
      mix: { ...ONE, mixes: 4, depth: 2, delay: "1-6", ...mix },
    }) as unknown as SessionOutSummary & { mix: LovejoinFunding };
  const NOTE = 'data-testid="lovejoin-collateral-mix-note"';

  // Where it pays for that mix the worker says it's mixed, which its chain keeps the reserve for (fx-promise).
  it("say giveme.my backs and sees that mix, in its own short note, on a mix and on Mix my boxes again", () => {
    for (const mix of [{}, { again: true, owned: 2 }]) {
      const review = html(createElement(PrivateReview, { summary: summary({ collateralReserve: "1500000", collateralMix: "mixed" }, mix) }));
      expect(review).toContain(NOTE);
      expect(words(review)).toContain(words(t("swaps.review.privacy.collateralMix")));
      // Where nothing pays for that mix: as before, byte for byte.
      const plain = html(createElement(PrivateReview, { summary: summary({}, mix) }));
      expect(plain).not.toContain(NOTE);
    }
  });

  it("no longer say the 5 ₳ comes back with what isn't used: it comes back later, mixed once", () => {
    const hint = (extra: Partial<SessionOutSummary>, mix: Partial<LovejoinFunding> = {}) =>
      reviewHint({ source: "private", summary: summary(extra, mix) } as Parameters<typeof reviewHint>[0]);
    const tailed = hint({ collateralReserve: "1500000", collateralMix: "mixed" });
    expect(tailed).toBe(t("lovejoin.review.privateNoteMixed"));
    expect(tailed).not.toMatch(/with the 5 ₳/);
    expect(hint({ collateralReserve: "1500000", collateralMix: "mixed" }, { again: true })).toBe(t("lovejoin.review.againNoteMixed"));
    // Nothing paid for it: the 5 ₳ comes back with the rest, as the notes have said (Session 10's call 2).
    expect(hint({})).toBe(t("lovejoin.review.privateNote"));
    expect(hint({}, { again: true })).toBe(t("lovejoin.review.againNote"));
  });
});

describe("a Bootstrap of one box is said in the singular, in English and Spanish (1.6.0's release review, x-i18n-es#2)", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });
  const bootstrap = (boxes: number, released = false): LovejoinMixView => ({
    id: `b${boxes}${released}`,
    at: Date.now(),
    account: 0,
    bootstrap: true,
    ...(released ? { released: true } : {}),
    shares: [{ boxes, back: 0, moved: 0 }],
  });
  const list = (entries: LovejoinMixView[], hidden = false) =>
    text(createElement(MixList, { entries, sessions: [], chains: [], pools: poolsOf(undefined), busy: false, onRetry: () => undefined, onStop: () => undefined }), hidden);

  it("held, and coming back by itself, for one box; their plural for two, and while balances are hidden", async () => {
    expect(list([bootstrap(1)])).toContain("held until you bring it back");
    expect(list([bootstrap(1, true)])).toContain("coming back by itself");
    expect(list([bootstrap(2)])).toContain("held until you bring them back");
    expect(list([bootstrap(2, true)])).toContain("coming back by themselves");
    // Hidden, the count isn't shown, so neither is it said by the singular.
    expect(list([bootstrap(1)], true)).toContain("held until you bring them back");
    await i18n.changeLanguage("es");
    expect(list([bootstrap(1)])).toContain("retenida hasta que la traigas de vuelta");
    expect(list([bootstrap(1, true)])).toContain("volviendo por sí sola");
    expect(list([bootstrap(2)])).toContain("retenidas hasta que las traigas de vuelta");
  });
});

// The stepper's count against the real WebAssembly: session 0 of the 12-word phrase, Lovejoin one wave deep, the
// classic pool's recorded boxes, and preprod's 5 ₳ pool as lovejoin-pools.json bundles it with other people's boxes.

const PASSWORD = "correct horse battery";
const PHRASE = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase;
/** Real fundings are built and measured in WebAssembly: seconds each, more on CI. */
const SLOW = { timeout: 300_000 };
/** Ogmios's answer when the network measures no more than a transaction declares. */
const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };
/** 20 boxes from Lovejoin's classic preprod pool, as Koios lists them (2026-09-25). */
const POOL = (JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }).pool;
const FIVE = bundled.preprod.pools.find((p) => p.boxLovelace === "5000000")! as unknown as { id: string; ref: PoolRef };
const FIVE_BOX = (JSON.parse(loadTestWasm().lovejoinVerifyPool(JSON.stringify({ network: "preprod", pool: FIVE.ref }))) as { mixBoxHash: string })
  .mixBoxHash;
/** The chain's reserve, as WebAssembly has it: what a mix's funding adds. */
const CHAIN = BigInt(loadTestWasm().lovejoinCollateralReserve());

type T = ReturnType<typeof testBalances>;

/** `n` of other people's boxes in the 5 ₳ pool. */
function strangers(t: T, n: number): KoiosUtxo[] {
  const wasm = loadTestWasm();
  const address = bech32("addr_test", Uint8Array.from([0x70, ...Buffer.from(FIVE_BOX, "hex")]));
  return Array.from({ length: n }, (_, i) => {
    const tx = (0x81 + i).toString(16).padStart(2, "0").repeat(32);
    t.koios.txSpends.set(tx, [{ payment_addr: { bech32: address, cred: FIVE_BOX } }]);
    // A canonical scalar whichever way its bytes are read: 0x01 at both ends.
    const stranger = wasm.SeedelfKey.fromHex(`01${(0x81 + i).toString(16).padStart(2, "0")}${"01".repeat(30)}`);
    const datum = Buffer.from(wasm.registerToDatum(wasm.rerandomize(stranger.baseRegister()))).toString("hex");
    stranger.free();
    return {
      ...POOL[0]!,
      tx_hash: tx,
      tx_index: 0,
      address,
      payment_cred: FIVE_BOX,
      value: "5000000",
      datum_hash: null,
      inline_datum: { bytes: datum, value: {} },
      asset_list: [],
    } as KoiosUtxo;
  });
}

/** The wallet, its private balance one UTxO of `lovelace`, Lovejoin one wave deep, `others` boxes in the 5 ₳ pool. */
async function wallet(lovelace: bigint, others = 2): Promise<T> {
  const t = testBalances({ owned: false });
  await t.wallet.create(PHRASE, PASSWORD);
  t.koios.evaluation = AGREES;
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  await t.deps.preferences.set({ lovejoinDepth: 1 });
  t.koios.added.push({ ...ownedUtxos[0]!, tx_hash: "d1".repeat(32), tx_index: 0, value: lovelace.toString() } as KoiosUtxo);
  t.koios.addedToAccounts.push(...POOL, ...strangers(t, others));
  return t;
}

/** Lovejoin reading the classic pool and the 5 ₳ pool. */
const pooled = (t: T) =>
  new LovejoinService({
    ...t.deps,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    pools: async () => [FIVE.ref],
    random: () => 0.5,
  });

/** The sessions over Lovejoin, the one-time key's signature stood in for. */
function runner(t: T): SessionService {
  const wasm = loadTestWasm();
  return new SessionService({
    ...t.deps,
    wasm: {
      ...wasm,
      signScriptSpend: (_key: unknown, request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
    lovejoin: pooled(t),
    sleep: async () => undefined,
    alarm: { start: async () => undefined },
  });
}

describe("the Mix form's count is one its funding builds, with the reserve the review then shows (1.6.0's release review, 323-worker#0, 320-screens#2)", SLOW, () => {
  it("funds the least balance the stepper offers a box at without the reserve, and the least its figures count it at with it, the form's total the review's at both (R3-7)", async () => {
    const lj = pooled(await wallet(ADA));
    const funding = await lj.funding("preprod", 1);
    // The reserve the form asks, by the page's own read of the 5 ₳ pool: what the worker adds at build where it's paid.
    const pools = poolsOf(await lj.status("preprod"));
    const asked = tailReserveOf(funding, "private", pools);
    expect(asked).toBe(CHAIN);
    const offer = (held: bigint) => mixOffer("private", { lovelace: held.toString(), tokens: [] }, undefined, funding, BOX, 10, 1, asked);
    /** The least private balance at which `holds` is true of the form at one box. */
    const least = (holds: (o: ReturnType<typeof offer>) => boolean) => {
      let [low, high] = [BigInt(funding.lovelace), BigInt(funding.lovelace) + 20n * ADA];
      while (low < high) {
        const mid = (low + high) / 2n;
        if (holds(offer(mid))) high = mid;
        else low = mid + 1n;
      }
      return low;
    };
    // The least balance the stepper offers the box at: funded without the reserve (orWithoutReserve), as the form's
    // figures and its line say. Nothing refuses it.
    const bare = least((o) => o.most >= 1);
    expect(offer(bare)).toMatchObject({ tail: 0n, tailShort: true });
    const without = await runner(await wallet(bare)).mixOutBuild("preprod", 1);
    expect(without.collateralReserve).toBeUndefined();
    // The least balance the figures count the reserve at: funded with it.
    const paid = least((o) => o.tail > 0n);
    expect(paid > bare).toBe(true);
    const withIt = await runner(await wallet(paid)).mixOutBuild("preprod", 1);
    expect(withIt.collateralReserve).toBe(CHAIN.toString());
    // The form's total, against the review's at both: apart only by the fee's estimate.
    for (const [built, held] of [
      [without, bare],
      [withIt, paid],
    ] as const) {
      const leaving = built.payments.reduce((sum, p) => sum + BigInt(p.lovelace), BigInt(built.fee.total));
      const form = mixCosts(funding, "private", BOX, offer(held).tail).leaving;
      expect(form - leaving < 50_000n && leaving - form < 50_000n).toBe(true);
    }
  });

  it("counts none where the 5 ₳ pool has too few boxes to draw, as the worker then funds none", async () => {
    const t = await wallet(40n * ADA, 1);
    const lj = pooled(t);
    const funding = await lj.funding("preprod", 1);
    // lovejoin-funding names the reserve without a pool read; the page's read says the pool can't take the collateral.
    expect(funding.collateralReserve).toBe(CHAIN.toString());
    expect(tailReserveOf(funding, "private", poolsOf(await lj.status("preprod")))).toBe(0n);
    expect((await runner(t).mixOutBuild("preprod", 1)).collateralReserve).toBeUndefined();
  });
});
