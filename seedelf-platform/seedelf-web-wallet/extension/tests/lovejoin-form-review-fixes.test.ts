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

const { AgainSwitch, MixList, MixMoves, PrivateReview, mixCosts, mixMost, publicMixAda, reviewHint, tailReserveOf, widthTurned } = LovejoinScreen;

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

describe("the Mix form's stepper keeps the collateral's reserve aside, and room for the fee and the change's least (1.6.0's release review, 323-worker#0)", () => {
  const side = (lovelace: bigint) => ({ lovelace: lovelace.toString(), tokens: [] });
  it("offers a box only where the funding, the 5 ₳, its fee and its change's least are held, the reserve too where it's paid for", () => {
    // 15.3 ₳ and the 5 ₳ kept aside, and about 1.7 ₳ for the funding's fee and the least its change holds today.
    expect(mixMost("private", side(22_300_000n), undefined, ONE, BOX, 10).adaMost).toBe(1);
    expect(mixMost("private", side(22_299_999n), undefined, ONE, BOX, 10).adaMost).toBe(0);
    expect(mixMost("private", side(23_799_999n), undefined, ONE, BOX, 10, 1_500_000n).adaMost).toBe(0);
    expect(mixMost("private", side(23_800_000n), undefined, ONE, BOX, 10, 1_500_000n).adaMost).toBe(1);
    // The public account puts up its own collateral and pays no reserve: nothing set aside there.
    expect(mixMost("public", side(15_300_000n), undefined, ONE, BOX, 10, 1_500_000n).adaMost).toBe(1);
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
    expect(publicMixAda(account, MIN)).toBe("27000000");
    // So one box of 10 ₳ at most, where Home's 63 ₳ (with 8 ₳ of rewards) offered four.
    const held = (lovelace: string) => mixMost("public", { lovelace, tokens: [] }, undefined, ONE, BOX, 10).adaMost;
    expect(held(publicMixAda(account))).toBe(1);
    expect(held("63000000")).toBe(4);
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

  it("say giveme.my backs and sees that mix, in its own short note, on a mix and on Mix my boxes again", () => {
    for (const mix of [{}, { again: true, owned: 2 }]) {
      const review = html(createElement(PrivateReview, { summary: summary({ collateralReserve: "1500000" }, mix) }));
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
    const tailed = hint({ collateralReserve: "1500000" });
    expect(tailed).toBe(t("lovejoin.review.privateNoteMixed"));
    expect(tailed).not.toMatch(/with the 5 ₳/);
    expect(hint({ collateralReserve: "1500000" }, { again: true })).toBe(t("lovejoin.review.againNoteMixed"));
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
  it("funds the least private balance the stepper offers a box at, its collateral's mix paid for, and the form's total is the review's", async () => {
    const lj = pooled(await wallet(ADA));
    const funding = await lj.funding("preprod", 1);
    // The reserve the form counts, by the page's own read of the 5 ₳ pool: what the worker adds at build.
    const pools = poolsOf(await lj.status("preprod"));
    const tail = tailReserveOf(funding, "private", pools);
    expect(tail).toBe(CHAIN);
    // The least private balance at which the stepper offers one box.
    const offers = (held: bigint) => mixMost("private", { lovelace: held.toString(), tokens: [] }, undefined, funding, BOX, 10, tail).adaMost >= 1;
    let [low, high] = [BigInt(funding.lovelace), BigInt(funding.lovelace) + 20n * ADA];
    while (low < high) {
      const mid = (low + high) / 2n;
      if (offers(mid)) high = mid;
      else low = mid + 1n;
    }
    const built = await runner(await wallet(low)).mixOutBuild("preprod", 1);
    // Built with its reserve, not left out for want of ADA (orWithoutReserve).
    expect(built.collateralReserve).toBe(CHAIN.toString());
    // The form's total, against the review's: apart only by the fee's estimate.
    const leaving = built.payments.reduce((sum, p) => sum + BigInt(p.lovelace), BigInt(built.fee.total));
    const form = mixCosts(funding, "private", BOX, tail).leaving;
    expect(form - leaving < 50_000n && leaving - form < 50_000n).toBe(true);
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
