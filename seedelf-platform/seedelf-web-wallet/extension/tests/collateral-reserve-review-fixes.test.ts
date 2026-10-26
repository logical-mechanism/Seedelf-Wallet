// 1.6.0's release review, the collateral's mix reserve (fixer `reserve`): 323-worker#0, each funding that pays for a
// session's collateral to be mixed is built again without that reserve where the private balance doesn't pay for it
// too; 323-rust#1's worker half, a site's session and its top-up taking what a return that comes back directly needs,
// a swap and a mix the chain's 1.5 ₳; and the worker half of 320-screens#2 and 321-lj-screens#3, lovejoin-funding
// naming what a mix from the private balance adds. Session 0 of the 12-word phrase, the real WebAssembly, preprod's
// 5 ₳ pool as lovejoin-pools.json bundles it with two of other people's boxes in it, and the classic pool's recorded
// boxes. The direct reserve's export is stood in for (DIRECT): these tests run on the WebAssembly built before it, and
// its own test is wasm's a_direct_returns_collateral_tail_is_paid_by_its_reserve_alone.
import { readFileSync } from "node:fs";

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService, type PoolRef } from "../src/background/lovejoin";
import { Minswap } from "../src/background/minswap";
import { SessionService, SWAP_MARGIN } from "../src/background/sessions";
import { t as tr } from "../src/i18n";
import bundled from "../src/lovejoin-pools.json";
import { NETWORKS } from "../src/networks";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import type { LovejoinFunding, SessionOutSummary, SwapAsk, SwapLovejoin, SwapQuote } from "../src/shared/rpc";
import { NetworkContext } from "../src/ui/network";
import { PreferencesContext } from "../src/ui/preferences";
import { FundingWayBack } from "../src/ui/screens/DappApprovals";
import { PrivateReview } from "../src/ui/screens/Lovejoin";
import { TopUpCollateralNote } from "../src/ui/screens/SiteSessions";
import { StopDialog, SwapApproval } from "../src/ui/screens/Swaps";
import { followMax, maxAdaIn, wholeUnits } from "../src/ui/swap";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, minswapEstimate, ownedUtxos, sessionSwap, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const PHRASE = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase;

/** Real fundings are built and measured in WebAssembly: seconds each, more on CI. */
const SLOW = { timeout: 300_000 };

/** Ogmios's answer when the network measures no more than a transaction declares. */
const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };

/** What the direct reserve's export answers here: 2.8 ₳, as it prices preprod's parameters. */
const DIRECT = "2800000";

const ADA = 1_000_000n;

/** 20 boxes from Lovejoin's classic preprod pool, as Koios lists them (2026-09-25). */
const POOL = (JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }).pool;

type Bundled = { id: string; ref: PoolRef; token?: { policyId: string; assetName: string; quantity: string } };
const mixBoxOf = (pool: Bundled) =>
  (JSON.parse(loadTestWasm().lovejoinVerifyPool(JSON.stringify({ network: "preprod", pool: pool.ref }))) as { mixBoxHash: string }).mixBoxHash;

/** Preprod's 5 ₳ pool, as the wallet bundles it: the one a session's collateral goes into. */
const FIVE = bundled.preprod.pools.find((p) => p.boxLovelace === "5000000")! as unknown as Bundled;
const FIVE_BOX = mixBoxOf(FIVE);

/** Preprod's MIN pool, as the wallet bundles it (4.5 ₳ and 100 MIN a box): the recorded swap's token's. */
const MIN_POOL = bundled.preprod.pools.find((p) => p.boxLovelace === "4500000")! as unknown as Bundled;

type T = ReturnType<typeof testBalances>;

/** The wallet, its private balance one UTxO of `lovelace`, Lovejoin one wave deep. */
async function wallet(lovelace: bigint): Promise<T> {
  const t = testBalances({ owned: false });
  await t.wallet.create(PHRASE, PASSWORD);
  t.koios.evaluation = AGREES;
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  await t.deps.preferences.set({ lovejoinDepth: 1 });
  t.koios.added.push({ ...ownedUtxos[0]!, tx_hash: "d1".repeat(32), tx_index: 0, value: lovelace.toString() } as KoiosUtxo);
  t.koios.addedToAccounts.push(...POOL, ...strangers(t, 2));
  return t;
}

/** A stranger's register datum. */
function strangerDatum(n: number): string {
  const wasm = loadTestWasm();
  // A canonical scalar whichever way its bytes are read: 0x01 at both ends.
  const stranger = wasm.SeedelfKey.fromHex(`01${n.toString(16).padStart(2, "0")}${"01".repeat(30)}`);
  const bytes = Buffer.from(wasm.registerToDatum(wasm.rerandomize(stranger.baseRegister()))).toString("hex");
  stranger.free();
  return bytes;
}

/** `n` of other people's boxes in the 5 ₳ pool, or in `pool`, their transactions' hashes from `first`. */
function strangers(t: T, n: number, pool: Bundled = FIVE, first = 0x81, lovelace = "5000000"): KoiosUtxo[] {
  const box = pool === FIVE ? FIVE_BOX : mixBoxOf(pool);
  const address = bech32("addr_test", Uint8Array.from([0x70, ...Buffer.from(box, "hex")]));
  const token = pool.token;
  return Array.from({ length: n }, (_, i) => {
    const tx = (first + i).toString(16).padStart(2, "0").repeat(32);
    t.koios.txSpends.set(tx, [{ payment_addr: { bech32: address, cred: box } }]);
    return {
      ...POOL[0]!,
      tx_hash: tx,
      tx_index: 0,
      address,
      payment_cred: box,
      value: lovelace,
      datum_hash: null,
      inline_datum: { bytes: strangerDatum(first + i), value: {} },
      asset_list: token ? [{ policy_id: token.policyId, asset_name: token.assetName, quantity: token.quantity, decimals: 0, fingerprint: "asset1test" } as never] : [],
    } as KoiosUtxo;
  });
}

/** Lovejoin reading the classic pool and `pools`. */
function pooled(t: T, pools: PoolRef[] = [FIVE.ref]): LovejoinService {
  return new LovejoinService({
    ...t.deps,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    pools: async () => pools,
    random: () => 0.5,
  });
}

/** The sessions over `lj`, the one-time key's signature and the direct reserve's export stood in for, and `over`'s. */
function runner(t: T, lj: LovejoinService = pooled(t), over: Partial<ReturnType<typeof loadTestWasm>> = {}): SessionService {
  const wasm = loadTestWasm();
  return new SessionService({
    ...t.deps,
    wasm: {
      ...wasm,
      signScriptSpend: (_key: unknown, request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
      lovejoinDirectCollateralReserve: () => DIRECT,
      ...over,
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
    lovejoin: lj,
    sleep: async () => undefined,
    alarm: { start: async () => undefined },
  });
}

/** The chain's reserve, as WebAssembly has it: a mix's and a swap's. */
const CHAIN = BigInt(loadTestWasm().lovejoinCollateralReserve());

/** The session records, as the sealed book holds them. */
const sessionsOf = async (t: T) => (await t.store.get<{ sessions: Array<{ index: number; collateralReserve?: true }> }>("sessions.preprod"))!.sessions;

/** Session 0, a site's, its funding on chain, its account holding 3 ₳ and no 5 ₳ to put up. */
async function siteSession(t: T): Promise<void> {
  const out = "ab".repeat(32);
  await t.store.set("sessions.preprod", {
    next: 1,
    sessions: [
      { index: 0, ownStake: true, createdAt: t.clock.now, txs: [{ kind: "out", txHash: out, at: t.clock.now, confirmed: true }], site: { origin: "https://example.org" } },
    ],
  });
  t.koios.addedToAccounts.push({ ...POOL[0]!, tx_hash: out, tx_index: 1, address: sessionSwap.address, payment_cred: sessionSwap.keyHash, value: "3000000", datum_hash: null, inline_datum: null, asset_list: [] } as KoiosUtxo);
}

describe("1.6.0's release review: the collateral's mix reserve (323-worker#0, 323-rust#1)", SLOW, () => {
  it("funds a site's session with what a return back directly takes for its collateral's mix, else without it (323-worker#0)", async () => {
    const site = (t: T) => runner(t).siteOutBuild("preprod", "https://example.org", (10n * ADA).toString(), []);
    // Its 10 ₳, the 5 ₳ collateral, and what a direct return's tail takes, with room for the fee and the change.
    const paid = await site(await wallet(15n * ADA + BigInt(DIRECT) + 3n * ADA));
    expect(paid.collateralReserve).toBe(DIRECT);
    expect(paid.payments.map((p) => p.lovelace)).toEqual([(10n * ADA + BigInt(DIRECT)).toString(), "5000000"]);
    // Enough for the session, not for its reserve too: funded without it, and its record says nothing was paid for the
    // collateral's mix, so its chain never counts its boxes on less (SessionRecord `collateralReserve`).
    const t = await wallet(15n * ADA + 3n * ADA);
    const sessions = runner(t);
    const short = await sessions.siteOutBuild("preprod", "https://example.org", (10n * ADA).toString(), []);
    expect(short.collateralReserve).toBeUndefined();
    expect(short.payments.map((p) => p.lovelace)).toEqual([(10n * ADA).toString(), "5000000"]);
    await sessions.siteOutSubmit("preprod", short.txHash, "https://example.org");
    expect((await sessionsOf(t)).at(-1)!.collateralReserve).toBeUndefined();
    // Not enough for the session itself: refused, as ever.
    await expect(site(await wallet(15n * ADA + ADA / 2n))).rejects.toThrow(tr("sess.notEnoughPrivate"));
  });

  it("tops a site's session up with a new collateral and its direct reserve, else without the reserve (323-worker#0)", async () => {
    const topUp = async (lovelace: bigint) => {
      const t = await wallet(lovelace);
      await siteSession(t);
      return runner(t).topUpBuild("preprod", 0, (3n * ADA).toString(), []);
    };
    const paid = await topUp(8n * ADA + BigInt(DIRECT) + 3n * ADA);
    expect(paid.collateralReserve).toBe(DIRECT);
    expect(paid.payments.map((p) => p.lovelace)).toEqual([(3n * ADA + BigInt(DIRECT)).toString(), "5000000"]);
    const short = await topUp(8n * ADA + 3n * ADA);
    expect(short.collateralReserve).toBeUndefined();
    expect(short.payments.map((p) => p.lovelace)).toEqual([(3n * ADA).toString(), "5000000"]);
  });

  it("funds a mix with the chain's reserve, else without it, its record unmarked (323-worker#0)", async () => {
    const boxes = BigInt((await pooled(await wallet(ADA)).funding("preprod", 1)).lovelace);
    const paid = await runner(await wallet(boxes + 5n * ADA + CHAIN + 3n * ADA)).mixOutBuild("preprod", 1);
    expect(paid.collateralReserve).toBe(CHAIN.toString());
    expect(paid.payments[0]!.lovelace).toBe((boxes + CHAIN).toString());
    const t = await wallet(boxes + 5n * ADA + 2n * ADA + ADA / 2n);
    const sessions = runner(t);
    const short = await sessions.mixOutBuild("preprod", 1);
    expect(short.collateralReserve).toBeUndefined();
    expect(short.payments.map((p) => p.lovelace)).toEqual([boxes.toString(), "5000000"]);
    // The form's figures stay out of what its review and record keep of the mix (lovejoin-funding's own).
    expect(short.mix.collateralReserve).toBeUndefined();
    expect(short.mix.collateralPool).toBeUndefined();
    await sessions.mixOutSubmit("preprod", short.txHash);
    expect((await sessionsOf(t)).at(-1)!.collateralReserve).toBeUndefined();
  });

  it("funds a swap with the chain's reserve, its margin and fill paying the rest, else without it (323-worker#0, 323-rust#1)", async () => {
    const quote = await runner(await wallet(ADA)).quote("preprod", minswapEstimate.ask);
    const fund = BigInt(quote.fund.lovelace);
    const paid = await runner(await wallet(fund + 5n * ADA + CHAIN + 3n * ADA)).outBuild("preprod", quote);
    expect(paid.collateralReserve).toBe(CHAIN.toString());
    expect(paid.payments[0]!.lovelace).toBe((fund + CHAIN).toString());
    const short = await runner(await wallet(fund + 5n * ADA + 2n * ADA + ADA / 2n)).outBuild("preprod", quote);
    expect(short.collateralReserve).toBeUndefined();
    expect(short.payments.map((p) => p.lovelace)).toEqual([fund.toString(), "5000000"]);
  });

  // The boxes hide what the swap gets, the reserve only the 5 ₳ collateral, which may still be mixed with what's left.
  it("leaves the collateral's reserve out before a swap's token's boxes (323-worker#0)", async () => {
    const withMin = async (lovelace: bigint) => {
      const t = await wallet(lovelace);
      t.koios.addedToAccounts.push(...strangers(t, 20, MIN_POOL, 0x40, "4500000"));
      return runner(t, pooled(t, [FIVE.ref, MIN_POOL.ref]));
    };
    const quote = await (await withMin(ADA)).quote("preprod", minswapEstimate.ask);
    const fund = BigInt(quote.fund.lovelace);
    const all = await (await withMin(1_000n * ADA)).outBuild("preprod", quote);
    const boxes = BigInt(all.lovejoin!.fund!);
    expect(all.collateralReserve).toBe(CHAIN.toString());
    // Room for the swap, its token's boxes and the collateral, not the reserve too.
    const short = await (await withMin(fund + boxes + 5n * ADA + 2n * ADA + ADA / 2n)).outBuild("preprod", quote);
    expect(short.lovejoin?.fund).toBe(boxes.toString());
    expect(short.collateralReserve).toBeUndefined();
    expect(short.payments[0]!.lovelace).toBe((fund + boxes).toString());
  });

  // 320-screens#2 and 321-lj-screens#3's worker half: the Mix form prices a mix from lovejoin-funding, asking nobody.
  it("names what a mix from the private balance adds for its collateral's mix, and the 5 ₳ pool it goes into", async () => {
    const t = await wallet(ADA);
    const lj = pooled(t);
    expect(await lj.funding("preprod", 1)).toMatchObject({ collateralReserve: CHAIN.toString(), collateralPool: FIVE.id });
    const asked = t.koios.calls.length;
    await lj.funding("preprod", 2);
    expect(t.koios.calls.length).toBe(asked);
    // A Bootstrap's deposit puts up no collateral.
    const bootstrap = await lj.funding("preprod", 1, false, 0);
    expect(bootstrap.collateralReserve).toBeUndefined();
    expect(bootstrap.collateralPool).toBeUndefined();
    // Nor with no 5 ₳ pool shown, or Settings' switch off.
    expect((await pooled(t, []).funding("preprod", 1)).collateralReserve).toBeUndefined();
    await t.deps.preferences.set({ lovejoinCollateral: false });
    expect((await lj.funding("preprod", 1)).collateralReserve).toBeUndefined();
  });
});

// 323-worker#0's form half (fixer sc-o-1): a swap's quote names what its funding adds for its collateral's mix, asking
// nobody as the user types, and the swap form's Max keeps it aside, with room for the funding's fee and its change's
// least, so the amount Max gives is funded, with that mix where a 5 ₳ pool would take it.
describe("1.6.0's release review: the swap form's Max and the collateral's mix (323-worker#0)", SLOW, () => {
  it("names in a swap's quote what its funding would add for its collateral's mix where a 5 ₳ pool is shown, asking nobody", async () => {
    const t = await wallet(ADA);
    const quoted = async (sessions: SessionService) => {
      const before = t.koios.calls.length;
      const quote = await sessions.quote("preprod", minswapEstimate.ask);
      return { quote, calls: t.koios.calls.length - before };
    };
    const shown = await quoted(runner(t));
    expect(shown.quote.collateralReserve).toBe(CHAIN.toString());
    // No 5 ₳ pool shown, Settings' collateral switch off, or sessions coming back directly: none.
    expect((await quoted(runner(t, pooled(t, [])))).quote.collateralReserve).toBeUndefined();
    await t.deps.preferences.set({ lovejoinCollateral: false });
    const off = await quoted(runner(t));
    expect(off.quote.collateralReserve).toBeUndefined();
    // Looking for the pool asked nobody: as many requests as a quote that never looked.
    expect(shown.calls).toBe(off.calls);
    await t.deps.preferences.set({ lovejoinCollateral: true, lovejoinReturns: false });
    expect((await quoted(runner(t))).quote.collateralReserve).toBeUndefined();
  });

  it("funds the ADA amount Max gives, with the collateral's mix where a 5 ₳ pool would take it", async () => {
    for (const [pools, reserve] of [
      [[FIVE.ref], CHAIN],
      [[], 0n],
    ] as const) {
      // A balance whose Max is whole ₳ to the lovelace, so rounding it leaves nothing over: the swap's 10 ₳ and its 6 ₳
      // of costs, the 5 ₳ kept aside, the reserve where it's added, and the form's room for the fee and the change.
      const held = 10n * ADA + 6n * ADA + 5n * ADA + reserve + 2n * ADA;
      const t = await wallet(held);
      const sessions = runner(t, pooled(t, [...pools]));
      const first = await sessions.quote("preprod", minswapEstimate.ask);
      const max = wholeUnits(maxAdaIn(held.toString(), first), 6);
      const built = await sessions.outBuild("preprod", await sessions.quote("preprod", { ...minswapEstimate.ask, amount: max }));
      expect(built.collateralReserve, `${pools.length} pools`).toBe(reserve ? reserve.toString() : undefined);
      expect(max).toBe((10n * ADA).toString());
    }
  });
});

// Round 3b (fixer fx-reserve-1): the collateral's mix on the swap and site paths, the worker's half. R3-9, a funding the
// private balance couldn't also pay the reserve for still says a 5 ₳ pool takes the collateral (`collateralMix`, since
// fx-promise), as its return mixes it where what's left pays; R3-10, a swap against the pools whose return comes back directly with its
// token takes no reserve, since that return can't build the mix; R3-11, a quote's reserve decided by what the wallet
// last read of the 5 ₳ pool, asking nobody, and named as a maybe where nothing read lately says; R3-12, the amount Max
// set before any quote, followed down once a quote names the reserve; L1, Stop's dialog pricing its boxes as
// WebAssembly's chain counts them, the reserve set aside first, and saying the collateral is mixed.
describe("1.6.0's release review, round 3b: the collateral's mix on the swap and site paths (R3-9, R3-10, R3-11, R3-12, L1)", SLOW, () => {
  /** MIN's unit: the recorded swap's token. */
  const MIN_UNIT = minswapEstimate.ask.tokenOut;
  /** The recorded swap routed against Danogo's pools: one pool, 0.1 ₳ its fee, no deposit, and Minswap's fee. */
  const leg = minswapEstimate.estimate.paths[0]![0]!;
  const DANOGO = {
    ...minswapEstimate.estimate,
    total_dex_fee: "100000",
    deposits: "0",
    aggregator_fee: "850000",
    paths: [[{ ...leg, dex_fee: "100000", deposits: "0", protocol: "DanogoCLMMV1" }]],
  };

  it("keeps on a funding without the reserve that a 5 ₳ pool would take its collateral (R3-9)", async () => {
    const quote = await runner(await wallet(ADA)).quote("preprod", minswapEstimate.ask);
    const fund = BigInt(quote.fund.lovelace);
    // A token's fill with no box of its own: mixed only if enough is left, its reserve paid or not (fx-promise, below).
    const paid = await runner(await wallet(fund + 5n * ADA + CHAIN + 3n * ADA)).outBuild("preprod", quote);
    expect(paid).toMatchObject({ collateralReserve: CHAIN.toString(), collateralMix: "ifLeft" });
    // Short of the reserve: funded without it, a 5 ₳ pool taking its collateral all the same.
    const short = await runner(await wallet(fund + 5n * ADA + 2n * ADA + ADA / 2n)).outBuild("preprod", quote);
    expect(short.collateralReserve).toBeUndefined();
    expect(short.collateralMix).toBe("ifLeft");
    // No 5 ₳ pool shown: neither.
    const none = await wallet(1_000n * ADA);
    const plain = await runner(none, pooled(none, [])).outBuild("preprod", quote);
    expect(plain.collateralReserve).toBeUndefined();
    expect(plain.collateralMix).toBeUndefined();
    // A site's funding, and a top-up that puts a new collateral back, alike.
    const site = await runner(await wallet(15n * ADA + 3n * ADA)).siteOutBuild("preprod", "https://example.org", (10n * ADA).toString(), []);
    expect(site.collateralReserve).toBeUndefined();
    expect(site.collateralMix).toBe("ifLeft");
    const t = await wallet(8n * ADA + 3n * ADA);
    await siteSession(t);
    const topUp = await runner(t).topUpBuild("preprod", 0, (3n * ADA).toString(), []);
    expect(topUp.collateralReserve).toBeUndefined();
    expect(topUp.collateralMix).toBe("ifLeft");
  });

  it("takes no reserve for a swap against the pools whose return comes back directly with its token, nor names one (R3-10)", async () => {
    const t = await wallet(1_000n * ADA);
    t.minswap.estimate = DANOGO;
    const sessions = runner(t);
    const quote = await sessions.quote("preprod", minswapEstimate.ask);
    expect(quote.againstPools).toBe(true);
    // Its swap pays the session one output, MIN and all the ADA left: a return that comes back directly finds no UTxO of
    // ADA alone there to pay for the collateral's mix, so none is kept aside or paid for.
    expect(quote.collateralReserve).toBeUndefined();
    const out = await sessions.outBuild("preprod", quote);
    expect(out.collateralReserve).toBeUndefined();
    expect(out.collateralMix).toBeUndefined();
    expect(out.payments[0]!.lovelace).toBe(quote.fund.lovelace);
    // Its MIN into a pool of its own: a chain, whose change pays for the mix, so the reserve, as any swap's.
    const m = await wallet(1_000n * ADA);
    m.minswap.estimate = DANOGO;
    m.koios.addedToAccounts.push(...strangers(m, 20, MIN_POOL, 0x40, "4500000"));
    const boxed = await runner(m, pooled(m, [FIVE.ref, MIN_POOL.ref])).outBuild("preprod", quote);
    expect(boxed.lovejoin?.fund).toBeDefined();
    expect(boxed.collateralReserve).toBe(CHAIN.toString());
    // MIN sold for ADA against the pools: its fill is ADA alone, which pays for the mix.
    const selling = await sessions.quote("preprod", { ...minswapEstimate.ask, tokenIn: MIN_UNIT, tokenOut: "lovelace", amount: "500" });
    expect(selling.againstPools).toBe(true);
    expect(selling.collateralReserve).toBe(CHAIN.toString());
  });

  it("names a quote's reserve by what the wallet last read of the 5 ₳ pool, asking nobody, a maybe where nothing read lately says (R3-11)", async () => {
    const t = await wallet(40n * ADA);
    // One of other people's boxes in it, where its collateral's mix draws two.
    t.koios.addedToAccounts = t.koios.addedToAccounts.filter((u) => u.tx_hash !== "82".repeat(32));
    const lj = pooled(t);
    const sessions = runner(t, lj);
    const quoted = async () => {
      const before = t.koios.calls.length;
      const quote = await sessions.quote("preprod", minswapEstimate.ask);
      return { quote, calls: t.koios.calls.length - before };
    };
    // Nothing read of it yet: kept aside all the same, the private default, and named as what the mix may take.
    const unread = await quoted();
    expect(unread.quote.collateralReserve).toBe(CHAIN.toString());
    expect(unread.quote.collateralMaybe).toBe(true);
    // Read as a review reads it: one box free, so it takes no collateral, and nothing is kept aside for it.
    await lj.rooms("preprod");
    const read = await quoted();
    expect(read.quote.collateralReserve).toBeUndefined();
    expect(read.quote.collateralMaybe).toBeUndefined();
    expect(BigInt(maxAdaIn("40000000", read.quote)) - BigInt(maxAdaIn("40000000", unread.quote))).toBe(CHAIN);
    // Asking nobody: as many requests as the quote that knew nothing of it.
    expect(read.calls).toBe(unread.calls);
    // Two free, read again: kept aside, and named plainly.
    t.koios.addedToAccounts.push(...strangers(t, 1, FIVE, 0x82));
    t.clock.now += 6 * 60_000;
    await t.wallet.touch();
    await lj.rooms("preprod");
    const two = await quoted();
    expect(two.quote.collateralReserve).toBe(CHAIN.toString());
    expect(two.quote.collateralMaybe).toBeUndefined();
  });

  it("names none where the data layer's last count of the 5 ₳ pool is under the network's floor (R3-11)", async () => {
    const preprod = NETWORKS.preprod.lovejoin!;
    const floor = preprod.poolFloor;
    preprod.poolFloor = 3;
    try {
      const counted = async (boxes: number) => {
        const t = await wallet(40n * ADA);
        const lj = new LovejoinService({
          ...t.deps,
          collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
          store: t.store,
          pools: async () => [FIVE.ref],
          random: () => 0.5,
          facts: async () => ({ launches: new Map(), crowds: new Map([[FIVE.id, { boxes, deposits: boxes, mixed: 0 }]]) }),
        });
        return runner(t, lj).quote("preprod", minswapEstimate.ask);
      };
      // Two boxes in it, everyone's, under the floor of three: it takes no collateral, so none is kept aside.
      const under = await counted(2);
      expect(under.collateralReserve).toBeUndefined();
      expect(under.collateralMaybe).toBeUndefined();
      // Five: no pool read lately says how many are other people's, or free, so kept aside, as a maybe.
      expect(await counted(5)).toMatchObject({ collateralReserve: CHAIN.toString(), collateralMaybe: true });
    } finally {
      preprod.poolFloor = floor;
    }
  });

  it("funds the amount Max set before any quote, followed down once the quote names the reserve (R3-12)", async () => {
    const held = 24_500_000n;
    const t = await wallet(held);
    const sessions = runner(t);
    // Pressed before any quote: Max on the usual costs, nothing kept aside for the mix: 11 ₳.
    const first = wholeUnits(maxAdaIn(held.toString()), 6);
    expect(first).toBe((11n * ADA).toString());
    const quoted = await sessions.quote("preprod", { ...minswapEstimate.ask, amount: first });
    expect(quoted.collateralReserve).toBe(CHAIN.toString());
    // That quote's Max keeps the reserve aside, 10 ₳, and the amount Max set follows it down.
    const max = wholeUnits(maxAdaIn(held.toString(), quoted), 6);
    expect(max).toBe((10n * ADA).toString());
    const amount = followMax(true, "lovelace", first, max) ?? first;
    const built = await sessions.outBuild("preprod", await sessions.quote("preprod", { ...minswapEstimate.ask, amount }));
    expect(built.collateralReserve).toBe(CHAIN.toString());
    // Typed rather than set by Max, or a token's amount: as it is. Nor ever up.
    expect(followMax(false, "lovelace", first, max)).toBeUndefined();
    expect(followMax(true, MIN_UNIT, first, max)).toBeUndefined();
    expect(followMax(true, "lovelace", max, first)).toBeUndefined();
  });

  it("prices Stop's boxes on what's left once its reserve is set aside, as WebAssembly's chain does, and says its collateral is mixed (L1)", async () => {
    // What each box more takes through the classic pool one wave deep, and what the chain takes besides, as Stop prices it.
    const priced = pooled(await wallet(ADA));
    const one = BigInt((await priced.funding("preprod", 1)).lovelace);
    const perBox = BigInt((await priced.funding("preprod", 2)).lovelace) - one;
    const besides = one - perBox;
    // Its approved funding pays for one box; with the reserve beside it, two.
    const fund = besides + 2n * perBox - ADA;
    const stopped = async (reserved: boolean, prefs: object = {}) => {
      const t = await wallet(ADA);
      await t.deps.preferences.set(prefs);
      const out = "ab".repeat(32);
      await t.store.set("sessions.preprod", {
        next: 1,
        sessions: [
          {
            index: 0,
            ownStake: true,
            createdAt: t.clock.now,
            txs: [{ kind: "out", txHash: out, at: t.clock.now, confirmed: true }],
            swap: { ...minswapEstimate.ask, amountOut: "906594100", minAmountOut: "902083681" },
            auto: { approved: { minAmountOut: "902083681", fund: { lovelace: fund.toString(), tokens: [] } }, direct: false, lovejoin: { depth: 1, delay: "1-6" } },
            ...(reserved ? { collateralReserve: true } : {}),
          },
        ],
      });
      const at = (tx_index: number, value: bigint) =>
        ({ ...POOL[0]!, tx_hash: out, tx_index, address: sessionSwap.address, payment_cred: sessionSwap.keyHash, value: value.toString(), datum_hash: null, inline_datum: null, asset_list: [] }) as KoiosUtxo;
      t.koios.addedToAccounts.push(at(0, fund + CHAIN), at(1, 5n * ADA));
      const sessions = runner(t);
      await sessions.list("preprod", true);
      return { sessions, cost: (await sessions.stopCost("preprod", 0))! };
    };
    const reserved = await stopped(true);
    expect(reserved.cost).toMatchObject({ boxes: 1, collateralMix: "mixed" });
    // The chain WebAssembly builds for it: one box, the collateral mixed first, out of its reserve.
    const back = await reserved.sessions.backBuild("preprod", 0);
    expect(back.lovejoin?.boxes).toBe(1);
    expect(back.collateralTail).toBeDefined();
    // Funded without the reserve, the same ADA there: the chain counts its boxes on all of it, two, and leaves 0.5 ₳ after
    // them, short of the 1.5 ₳ that mix takes, and the chain WebAssembly builds has none: never said mixed, only if enough
    // is left (1.6.0's review of the fixes, fx-promise, below).
    const unreserved = await stopped(false);
    expect(unreserved.cost.boxes).toBe(2);
    expect(unreserved.cost.collateralMix).toBe("ifLeft");
    const plain = await unreserved.sessions.backBuild("preprod", 0);
    expect(plain.lovejoin?.boxes).toBe(2);
    expect(plain.collateralTail).toBeUndefined();
    // Settings keeps the collateral out of the pool: nothing set aside, nothing said.
    const off = (await stopped(true, { lovejoinCollateral: false })).cost;
    expect(off.boxes).toBe(2);
    expect(off.collateralMix).toBeUndefined();
  });
});

describe("1.6.0's review of the fixes, R3-8: a funding of one transaction the reserve alone takes past what one spends", SLOW, () => {
  /** The wallet, its private balance `n` UTxOs of `lovelace` each, as Lovejoin's boxes come back: one UTxO each. */
  async function spread(n: number, lovelace: bigint): Promise<T> {
    const t = testBalances({ owned: false });
    await t.wallet.create(PHRASE, PASSWORD);
    t.koios.evaluation = AGREES;
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    t.koios.added.push(
      ...Array.from({ length: n }, (_, i) => ({ ...ownedUtxos[0]!, tx_hash: (0x200 + i).toString(16).padStart(64, "0"), tx_index: 0, value: lovelace.toString() }) as KoiosUtxo),
    );
    t.koios.addedToAccounts.push(...POOL, ...strangers(t, 2));
    return t;
  }

  it("tops a site's session up without its direct reserve, as with too little ADA for it, where the reserve takes more UTxOs than one transaction spends", async () => {
    const t = await spread(40, 1_500_000n);
    await siteSession(t);
    // 24 ₳ and the new 5 ₳ take 20 of these UTxOs; the 2.8 ₳ reserve too, 23: past one transaction's computation.
    const built = await runner(t).topUpBuild("preprod", 0, (24n * ADA).toString(), []);
    expect(built.collateralReserve).toBeUndefined();
    expect(built.payments.map((p) => p.lovelace)).toEqual([(24n * ADA).toString(), "5000000"]);
    // Its note still says a 5 ₳ pool takes the new collateral: mixed at the return only if enough is left (R3-9; fx-promise).
    expect(built.collateralMix).toBe("ifLeft");
  });

  it("goes without it too where the funding with it is past one transaction's size, core's words read as core writes them", async () => {
    const t = await wallet(40n * ADA);
    await siteSession(t);
    const wasm = loadTestWasm();
    const withReserve = (3n * ADA + BigInt(DIRECT)).toString();
    // Core's TooLarge (build.rs), both of its sentences, for the funding that carries the reserve: stood in for, since
    // the reserve adds ADA, not tokens, and a real one needs a transaction of 16 KiB.
    for (const said of [
      "This transaction would be 16590 bytes, over the network's limit of 16384. Send fewer tokens, or pay fewer recipients, at once",
      "One output would hold 5012 bytes of tokens, over the network's limit of 5000. Send fewer tokens at once",
    ]) {
      const sessions = runner(t, pooled(t), {
        buildWithdraw: (key: Parameters<typeof wasm.buildWithdraw>[0], request: string) => {
          const { payments } = JSON.parse(request) as { payments: Array<{ lovelace: string }> };
          if (payments[0]!.lovelace === withReserve) throw new Error(said);
          return wasm.buildWithdraw(key, request);
        },
      });
      const built = await sessions.topUpBuild("preprod", 0, (3n * ADA).toString(), []);
      expect(built.collateralReserve).toBeUndefined();
      expect(built.payments.map((p) => p.lovelace)).toEqual([(3n * ADA).toString(), "5000000"]);
    }
  });

  it("still says a Bootstrap past one transaction's UTxOs in its own words: it pays no reserve to go without", async () => {
    const t = await spread(40, 1_500_000n);
    await expect(runner(t).mixOutBuild("preprod", 3, { bootstrap: true })).rejects.toThrow(tr("sess.bootstrapTooMany"));
  });
});

// Round 3b's last look (fixer fx-last): LM-2, the amount Max set before any quote is never followed down to nothing.
// Its LM-1 tests, what Stop's dialog and a swap's approval said of the collateral's mix by what the return's boxes left
// (tailPaid), gave way to one rule (fixer fx-promise, at the end of this file): mixed only where the reserve is paid and
// the return keeps it, only if enough is left wherever else a 5 ₳ pool may take it.
describe("1.6.0's review of the fixes, the last look: Max never followed to nothing (LM-2)", SLOW, () => {
  it("keeps the amount Max set where the quote's reserve takes Max to nothing, and funds it without the reserve (LM-2)", async () => {
    const held = 14_000_000n;
    const t = await wallet(held);
    const sessions = runner(t);
    // Pressed before any quote: 14 ₳ less the usual 6 ₳ of costs, the 5 ₳ collateral and 2 ₳ of room, 1 ₳.
    const first = wholeUnits(maxAdaIn(held.toString()), 6);
    expect(first).toBe(ADA.toString());
    // Nothing read of the 5 ₳ pool lately: the quote keeps its reserve aside, as a maybe, and Max with it is nothing.
    const quoted = await sessions.quote("preprod", { ...minswapEstimate.ask, amount: first });
    expect(quoted).toMatchObject({ collateralReserve: CHAIN.toString(), collateralMaybe: true });
    const max = wholeUnits(maxAdaIn(held.toString(), quoted), 6);
    expect(max).toBe("0");
    // The amount stays Max's, never emptied, and goes without the reserve, as an amount typed past Max does.
    expect(followMax(true, "lovelace", first, max)).toBeUndefined();
    const built = await sessions.outBuild("preprod", quoted);
    expect(built.collateralReserve).toBeUndefined();
    expect(built.payments.map((p) => p.lovelace)).toEqual([quoted.fund.lovelace, "5000000"]);
  });
});

// The collateral's mix by one rule (fixer fx-promise, after the last look at round 3c's fixes, review/last-3c.md): a
// review or Stop's dialog says the collateral is mixed only where its funding paid that mix's reserve and its return's
// way keeps it for that mix; "mixed only if enough is left", giveme.my's part said so it holds either way, wherever
// else a 5 ₳ pool may take it; nothing where no mix can happen. What's counted follows the money: Stop's boxes, with an
// order out, on what its cancel brings back. Each review is rendered as it shows, in English, from what the worker built.
describe("1.6.0's review of the fixes, fx-promise: the collateral's mix said by one rule, and Stop's boxes counted on what its return will hold (last-3c)", SLOW, () => {
  const MIN_UNIT = minswapEstimate.ask.tokenOut;
  const MIN = { policyId: MIN_UNIT.slice(0, 56), assetName: MIN_UNIT.slice(56) };
  const SELL: SwapAsk = { ...minswapEstimate.ask, tokenIn: MIN_UNIT, tokenOut: "lovelace", amount: "500" };
  /** 500 MIN at a session's account, as Koios lists a token. */
  const MIN500 = [{ policy_id: MIN.policyId, asset_name: MIN.assetName, quantity: "500", decimals: 0, fingerprint: "asset1min" }];
  /** An order's network fee: the least any transaction pays here (last-3c's account). */
  const ORDER_FEE = 155_381n;
  /** A real Minswap cancel's network fee (seedelf-core's cancel_integrity.json). */
  const CANCEL_FEE = 237_697n;
  const OUT = "ab".repeat(32);
  const ORDER = "cd".repeat(32);
  const CANCEL = "ef".repeat(32);
  /** The recorded swap routed against Danogo's pools: one pool, 0.1 ₳ its fee, no deposit, and Minswap's fee. */
  const leg = minswapEstimate.estimate.paths[0]![0]!;
  const DANOGO = {
    ...minswapEstimate.estimate,
    total_dex_fee: "100000",
    deposits: "0",
    aggregator_fee: "850000",
    paths: [[{ ...leg, dex_fee: "100000", deposits: "0", protocol: "DanogoCLMMV1" }]],
  };
  const DEFINITE = "giveme.my backs its collateral's mix too, so it sees that mix.";
  const IF_LEFT = () => words(tr("lovejoin.collateralMix.privacy.ifLeft"));

  /** What a person reads of markup, on preprod, balances shown. */
  const words = (markup: string) =>
    markup
      .replace(/<[^>]+>/g, " ")
      .replaceAll("&#x27;", "'")
      .replaceAll("&quot;", '"')
      .replaceAll("&amp;", "&")
      .replace(/\s+/g, " ")
      .trim();
  const read = (element: ReactElement) =>
    words(
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
      ),
    );
  /** A swap's approval, as the worker built its funding. */
  const approval = (summary: SessionOutSummary & { lovejoin?: SwapQuote["lovejoin"] }, quote: SwapQuote) =>
    read(
      createElement(SwapApproval, {
        summary,
        quote,
        lovejoin: summary.lovejoin,
        pay: quote.ask.tokenIn === "lovelace" ? { id: "lovelace", side: { label: "₳", decimals: 6 } } : { id: MIN_UNIT, side: { label: "MIN", decimals: 6 } },
        get: quote.ask.tokenOut === "lovelace" ? { id: "lovelace", side: { label: "₳", decimals: 6 } } : { id: MIN_UNIT, side: { label: "MIN", decimals: 6 } },
        through: true,
        onThrough: () => undefined,
        busy: false,
      }),
    );

  /** What each box more takes through the classic pool `depth` waves deep, and what the chain takes besides, as Stop and a review price them. */
  async function boxPrice(depth = 1): Promise<{ perBox: bigint; besides: bigint }> {
    const priced = pooled(await wallet(ADA));
    const one = BigInt((await priced.funding("preprod", 1, false, depth as 1)).lovelace);
    const perBox = BigInt((await priced.funding("preprod", 2, false, depth as 1)).lovelace) - one;
    return { perBox, besides: one - perBox };
  }

  /** A UTxO at session 0's account. */
  const at = (tx: string, tx_index: number, value: bigint, assets: unknown[] = []) =>
    ({ ...POOL[0]!, tx_hash: tx, tx_index, address: sessionSwap.address, payment_cred: sessionSwap.keyHash, value: value.toString(), datum_hash: null, inline_datum: null, asset_list: assets }) as KoiosUtxo;

  /**
   * Session 0, a swap that runs itself and comes back through Lovejoin `depth` waves deep: ADA for MIN, or 500 MIN for
   * ADA (`sell`), approved to fund `fund` lovelace, funded with the collateral's mix reserve or not (`reserved`), its order
   * out and on chain (`ordered`), or sent and not seen yet (`sent`), and `filled`, its account holding `rows` and its 5 ₳
   * collateral; or its funding still on its way (`landing`), nothing at its account yet. Stop's cost, the sessions, and
   * the wallet's fakes.
   */
  async function stopped(o: {
    fund: bigint;
    rows: KoiosUtxo[];
    reserved?: boolean;
    sell?: boolean;
    ordered?: boolean;
    sent?: boolean;
    filled?: boolean;
    landing?: boolean;
    /** Its funding confirmed, and nothing of it at its account yet: Koios behind the chain. */
    unlisted?: boolean;
    depth?: number;
    prefs?: object;
    strangers?: number;
  }) {
    const t = await wallet(ADA);
    await t.deps.preferences.set({ lovejoinDepth: (o.depth ?? 1) as 1, ...o.prefs });
    // One of other people's boxes in the 5 ₳ pool, where its mix draws two: that pool takes no collateral.
    if (o.strangers === 1) t.koios.addedToAccounts = t.koios.addedToAccounts.filter((u) => u.tx_hash !== "82".repeat(32));
    const ask = o.sell ? SELL : minswapEstimate.ask;
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: t.clock.now,
          txs: [
            { kind: "out", txHash: OUT, at: t.clock.now, ...(o.landing ? {} : { confirmed: true }) },
            ...(o.ordered || o.sent ? [{ kind: "swap", txHash: ORDER, at: t.clock.now, ...(o.ordered ? { confirmed: true } : {}), orders: [`${ORDER}#0`] }] : []),
          ],
          swap: { ...ask, amountOut: o.sell ? "4000000" : "906594100", minAmountOut: o.sell ? "3960000" : "902083681" },
          auto: {
            approved: {
              minAmountOut: o.sell ? "3960000" : "902083681",
              fund: { lovelace: o.fund.toString(), tokens: o.sell ? [{ ...MIN, quantity: "500" }] : [] },
              aggregatorFee: "0",
            },
            direct: false,
            lovejoin: { depth: o.depth ?? 1, delay: "1-6" },
            ...(o.filled ? { filled: t.clock.now } : {}),
          },
          ...(o.reserved ? { collateralReserve: true } : {}),
        },
      ],
    });
    if (!o.landing && !o.unlisted) t.koios.addedToAccounts.push(...o.rows, at(OUT, 1, 5n * ADA));
    const sessions = runner(t);
    await sessions.list("preprod", true);
    return { sessions, cost: (await sessions.stopCost("preprod", 0))!, t };
  }

  it("Stop: mixed where its funding paid the reserve and the return keeps it, only if enough is left otherwise, nothing where no mix can go", async () => {
    const { perBox, besides } = await boxPrice();
    // Not paid for: only if enough is left, whatever its boxes leave. 0.5 ₳ after two boxes, and none is built; 1.5 ₳ after
    // one, and it is: the words hold either way.
    for (const [ada, boxes, tail] of [
      [besides + 2n * perBox + ADA / 2n, 2, false],
      [besides + perBox + CHAIN, 1, true],
    ] as const) {
      const { sessions, cost } = await stopped({ fund: ada, rows: [at(OUT, 0, ada)] });
      expect(cost, `${ada}`).toMatchObject({ boxes, collateralMix: "ifLeft" });
      expect(!!(await sessions.backBuild("preprod", 0)).collateralTail, `${ada}`).toBe(tail);
    }
    // Paid for, its order not out: one box, the reserve set aside before it, and the chain WebAssembly builds mixes it.
    const fund = besides + perBox + ADA / 2n;
    const paid = await stopped({ reserved: true, fund, rows: [at(OUT, 0, fund + CHAIN)] });
    expect(paid.cost).toMatchObject({ boxes: 1, collateralMix: "mixed" });
    expect((await paid.sessions.backBuild("preprod", 0)).collateralTail).toBeDefined();
    // Paid for, no box: it comes back directly, the funding's ADA alone paying, and that mix is built.
    const small = await stopped({ reserved: true, fund: 8n * ADA, rows: [at(OUT, 0, 8n * ADA + CHAIN)] });
    expect(small.cost).toMatchObject({ boxes: 0, collateralMix: "mixed" });
    expect((await small.sessions.backBuild("preprod", 0)).collateralTail).toBeDefined();
    // No mix can go: Settings keeps the collateral out, the 5 ₳ pool takes none (one of other people's boxes there, by the
    // read Stop's dialog makes), or the account holds no 5 ₳ to put in.
    for (const o of [{ prefs: { lovejoinCollateral: false } }, { strangers: 1 }]) {
      const { cost } = await stopped({ reserved: true, fund, rows: [at(OUT, 0, fund + CHAIN)], ...o });
      expect(cost.collateralMix, JSON.stringify(o)).toBeUndefined();
    }
  });

  it("Stop: a token sold through an order that's out is mixed only if enough is left, since its cancel gives the token back beside all its ADA (last-3c, 1)", async () => {
    // 500 MIN for ADA, funded with the reserve: the deposit back and the 2 ₳ margin. Its order is out, and its change is
    // at the account: the margin less the order's fee, and the reserve, ADA alone.
    const fund = 4n * ADA;
    const change = SWAP_MARGIN - ORDER_FEE + CHAIN;
    const out = await stopped({ reserved: true, sell: true, ordered: true, fund, rows: [at(ORDER, 1, change)] });
    expect(out.cost.boxes).toBe(0);
    expect(out.cost.collateralMix).toBe("ifLeft");
    // What the cancel leaves (cancel_orders): the MIN and every lovelace in one output, less its fee, beside the 5 ₳. No
    // UTxO of ADA alone pays for that mix, so the return built on it brings the 5 ₳ back at once.
    const cancelled = await stopped({ reserved: true, sell: true, fund, rows: [at(CANCEL, 0, fund - SWAP_MARGIN + change - CANCEL_FEE, MIN500)] });
    expect((await cancelled.sessions.backBuild("preprod", 0)).collateralTail).toBeUndefined();
    // Sent and not seen yet, its funding's MIN still all there is, with no ADA alone: it may yet fill first and bring ADA
    // that pays for that mix, so never nothing said while it's out; only if enough is left.
    const sent = await stopped({ reserved: true, sell: true, sent: true, fund, rows: [at(OUT, 0, fund + CHAIN, MIN500)] });
    expect(sent.cost.collateralMix).toBe("ifLeft");
    // Not sent: that funding comes back as it is, with nothing of ADA alone to pay for that mix, so nothing is said.
    const kept = await stopped({ reserved: true, sell: true, fund, rows: [at(OUT, 0, fund + CHAIN, MIN500)] });
    expect(kept.cost.collateralMix).toBeUndefined();
    // Filled before Stop: its ADA comes back alone, beside the change and its reserve, and that mix goes: mixed, as before.
    const filled = await stopped({ reserved: true, sell: true, ordered: true, filled: true, fund, rows: [at(ORDER, 1, change), at("aa".repeat(32), 0, 4n * ADA)] });
    expect(filled.cost.collateralMix).toBe("mixed");
    expect((await filled.sessions.backBuild("preprod", 0)).collateralTail).toBeDefined();
  });

  it("Stop: says that mix may go, giveme.my's part with it, where a default depth's box leaves too little for the rule of thumb and the return still mixes it (last-3c, 2)", async () => {
    // Settings' default, two waves deep: one box, 0.9 ₳ after it, no reserve. The chain WebAssembly builds mixes the
    // collateral from what that box leaves.
    const { perBox, besides } = await boxPrice(2);
    const held = besides + perBox + 900_000n;
    const { sessions, cost } = await stopped({ fund: held, rows: [at(OUT, 0, held)], depth: 2 });
    expect(cost.boxes).toBe(1);
    expect(cost.collateralMix).toBe("ifLeft");
    const back = await sessions.backBuild("preprod", 0);
    expect(back.lovejoin?.boxes).toBe(1);
    expect(back.collateralTail).toBeDefined();
  });

  it("Stop: counts its boxes, with an order of ADA out, on what its cancel brings back, the order's fee and the cancel's left out (last-3c, 4)", async () => {
    const { perBox, besides } = await boxPrice();
    // Its approved funding pays for one box with 0.3 ₳ over. Out as an order, the order's fee paid, then cancelled: less.
    const fund = besides + perBox + 300_000n;
    const change = SWAP_MARGIN - ORDER_FEE;
    const out = await stopped({ fund, ordered: true, rows: [at(ORDER, 1, change)] });
    expect(out.cost.boxes).toBe(0);
    // The return WebAssembly builds on what that cancel leaves, a real Minswap cancel's fee off: no box either.
    const cancelled = await stopped({ fund, rows: [at(CANCEL, 0, fund - SWAP_MARGIN + change - CANCEL_FEE)] });
    expect((await cancelled.sessions.backBuild("preprod", 0)).lovejoin?.boxes ?? 0).toBe(0);
    // Its order not out yet, the funding at the account: one box, as before, and its return makes it.
    const before = await stopped({ fund, rows: [at(OUT, 0, fund)] });
    expect(before.cost.boxes).toBe(1);
    expect((await before.sessions.backBuild("preprod", 0)).lovejoin?.boxes).toBe(1);
  });

  /** 500 MIN sold for `out` lovelace, against Danogo's pools or as an order: the quote, and a wallet holding the MIN. */
  async function selling(out: bigint, pools: boolean, lovelace: (quote: SwapQuote) => bigint) {
    const asked = await wallet(ADA);
    const estimate = pools ? DANOGO : minswapEstimate.estimate;
    asked.minswap.estimate = { ...estimate, amount_out: out.toString(), min_amount_out: ((out * 99n) / 100n).toString() };
    const quote = await runner(asked).quote("preprod", SELL);
    const t = await wallet(lovelace(quote));
    t.minswap.estimate = asked.minswap.estimate;
    t.koios.added.push({
      ...ownedUtxos[0]!,
      tx_hash: "d2".repeat(32),
      tx_index: 0,
      value: "2000000",
      asset_list: [{ policy_id: MIN.policyId, asset_name: MIN.assetName, quantity: "500", decimals: 0, fingerprint: "asset1min" } as never],
    } as KoiosUtxo);
    return { quote, built: await runner(t).outBuild("preprod", quote) };
  }

  it("the approval: an ADA fill against the pools its funding paid no reserve for may be mixed, said with giveme.my's part, never that it's mixed (last-3c, 3)", async () => {
    const { perBox, besides } = await boxPrice();
    // 1.6 ₳ of its fill left after one box, as the review expects it: the swap's own fee against the pools then comes out
    // of the room, which last-3c found leaves the chain too little for that mix.
    const out = besides + perBox + 1_600_000n - SWAP_MARGIN;
    const { quote, built } = await selling(out, true, (q) => BigInt(q.fund.lovelace) + 5n * ADA + ADA / 2n);
    expect(quote.againstPools).toBe(true);
    expect(built.collateralReserve).toBeUndefined();
    expect(built.lovejoin?.boxes).toBe(1);
    const said = approval(built, quote);
    expect(said).not.toContain(DEFINITE);
    expect(said).not.toContain("its 5 ₳ collateral in Lovejoin boxes");
    expect(said).toContain(IF_LEFT());
    expect(built.collateralMix).toBe("ifLeft");
    // Paid for: its fill is ADA alone, which keeps the reserve for that mix whichever way it goes: mixed.
    const paid = await selling(out, true, (q) => BigInt(q.fund.lovelace) + 5n * ADA + CHAIN + 3n * ADA);
    expect(paid.built.collateralReserve).toBe(CHAIN.toString());
    expect(paid.built.collateralMix).toBe("mixed");
    const definite = approval(paid.built, paid.quote);
    expect(definite).toContain(DEFINITE);
    expect(definite).not.toContain(IF_LEFT());
  });

  it("the approval: a token's fill with no box of its own is mixed only if enough is left, its reserve paid or not, since Minswap may still route it to the pools; none where its return can't build it", async () => {
    const quote = await runner(await wallet(ADA)).quote("preprod", minswapEstimate.ask);
    const fund = BigInt(quote.fund.lovelace);
    // Paid for, as an order: its change keeps the reserve as ADA alone, but Minswap may build it against the pools, which
    // pays the session MIN beside all the ADA left, as R3-10's return can't pay that mix from.
    const paid = await runner(await wallet(fund + 5n * ADA + CHAIN + 3n * ADA)).outBuild("preprod", quote);
    expect(paid.collateralReserve).toBe(CHAIN.toString());
    const saidPaid = approval(paid, quote);
    expect(saidPaid).not.toContain(DEFINITE);
    expect(saidPaid).toContain(IF_LEFT());
    expect(paid.collateralMix).toBe("ifLeft");
    // Its cost still counted: the reserve was paid.
    expect(saidPaid).toContain("Its collateral's mix, about");
    // Not paid for, a 5 ₳ pool taking it: a stop or a refund may leave enough, so only if enough is left, never nothing.
    const short = await runner(await wallet(fund + 5n * ADA + 2n * ADA + ADA / 2n)).outBuild("preprod", quote);
    expect(short.collateralReserve).toBeUndefined();
    const saidShort = approval(short, quote);
    expect(saidShort).toContain(IF_LEFT());
    expect(short.collateralMix).toBe("ifLeft");
    expect(saidShort).not.toContain("Its collateral's mix, about");
    // Its MIN into a pool of its own: a chain, whose change keeps the reserve (tail_reserve sets it aside): mixed.
    const m = await wallet(1_000n * ADA);
    m.koios.addedToAccounts.push(...strangers(m, 20, MIN_POOL, 0x40, "4500000"));
    const boxed = await runner(m, pooled(m, [FIVE.ref, MIN_POOL.ref])).outBuild("preprod", quote);
    expect(boxed.lovejoin?.ways?.[0]?.boxes).toBeGreaterThan(0);
    expect(boxed.collateralMix).toBe("mixed");
    expect(approval(boxed, quote)).toContain(DEFINITE);
    // Against the pools with no box (R3-10), or no 5 ₳ pool: no mix can go, so nothing is said.
    const d = await wallet(1_000n * ADA);
    d.minswap.estimate = DANOGO;
    const danogo = runner(d);
    const poolsQuote = await danogo.quote("preprod", minswapEstimate.ask);
    const pools = await danogo.outBuild("preprod", poolsQuote);
    expect(pools.collateralMix).toBeUndefined();
    const none = await wallet(1_000n * ADA);
    const plain = await runner(none, pooled(none, [])).outBuild("preprod", quote);
    expect(plain.collateralMix).toBeUndefined();
    for (const said of [approval(pools, poolsQuote), approval(plain, quote)]) {
      expect(said).not.toContain(DEFINITE);
      expect(said).not.toContain(IF_LEFT());
    }
  });

  it("the quote: Max's note follows the same rule, mixed only where that pool takes it and the fill keeps the reserve", async () => {
    const t = await wallet(40n * ADA);
    const lj = pooled(t);
    const sessions = runner(t, lj);
    // Nothing read of the pool lately: kept aside, mixed only if enough is left.
    expect(await sessions.quote("preprod", minswapEstimate.ask)).toMatchObject({ collateralReserve: CHAIN.toString(), collateralMix: "ifLeft" });
    // Read, and it takes it: MIN with no box of its own may come against the pools, so still only if enough is left; an
    // ADA fill, mixed.
    await lj.rooms("preprod");
    expect((await sessions.quote("preprod", minswapEstimate.ask)).collateralMix).toBe("ifLeft");
    expect((await sessions.quote("preprod", SELL)).collateralMix).toBe("mixed");
    // No 5 ₳ pool shown: nothing kept aside, nothing said.
    expect((await runner(t, pooled(t, [])).quote("preprod", minswapEstimate.ask)).collateralMix).toBeUndefined();
  });

  it("a site's funding and its top-up never say the collateral is mixed: what the site leaves decides, so only if enough is left, its reserve paid or not", async () => {
    const funded = (lovelace: bigint) => async () =>
      runner(await wallet(lovelace)).siteOutBuild("preprod", "https://example.org", (10n * ADA).toString(), []);
    const topped = (lovelace: bigint) => async () => {
      const t = await wallet(lovelace);
      await siteSession(t);
      return runner(t).topUpBuild("preprod", 0, (3n * ADA).toString(), []);
    };
    for (const [what, build, reserve] of [
      ["funding, paid", funded(15n * ADA + BigInt(DIRECT) + 3n * ADA), DIRECT],
      ["funding, short", funded(15n * ADA + 3n * ADA), undefined],
      ["top-up, paid", topped(8n * ADA + BigInt(DIRECT) + 3n * ADA), DIRECT],
      ["top-up, short", topped(8n * ADA + 3n * ADA), undefined],
    ] as const) {
      const summary = await build();
      expect(summary.collateralReserve, what).toBe(reserve);
      const said = what.startsWith("funding")
        ? read(createElement(FundingWayBack, { fee: summary.fee.total, lovejoin: true, perBox: "4.1", summary }))
        : read(createElement(TopUpCollateralNote, { summary }));
      expect(said, what).toContain("only if enough is left");
      expect(said, what).not.toContain("the 5 ₳ come back at once");
      expect(summary.collateralMix, what).toBe("ifLeft");
    }
    // No 5 ₳ pool shown: nothing said of that mix.
    const none = await wallet(15n * ADA + 3n * ADA);
    const plain = await runner(none, pooled(none, [])).siteOutBuild("preprod", "https://example.org", (10n * ADA).toString(), []);
    expect(plain.collateralMix).toBeUndefined();
    expect(read(createElement(FundingWayBack, { fee: plain.fee.total, lovejoin: true, perBox: "4.1", summary: plain }))).not.toContain("only if enough is left");
  });

  it("a mix's review: mixed where its funding paid the reserve, which its chain sets aside; only if enough is left where it didn't; nothing with no 5 ₳ pool", async () => {
    const boxes = BigInt((await pooled(await wallet(ADA)).funding("preprod", 1)).lovelace);
    const review = (summary: SessionOutSummary & { mix: LovejoinFunding }) => read(createElement(PrivateReview, { summary }));
    const short = await runner(await wallet(boxes + 5n * ADA + 2n * ADA + ADA / 2n)).mixOutBuild("preprod", 1);
    expect(short.collateralReserve).toBeUndefined();
    const saidShort = review(short);
    expect(saidShort).toContain(IF_LEFT());
    expect(saidShort).not.toContain(DEFINITE);
    expect(short.collateralMix).toBe("ifLeft");
    const paid = await runner(await wallet(boxes + 5n * ADA + CHAIN + 3n * ADA)).mixOutBuild("preprod", 1);
    expect(review(paid)).toContain(DEFINITE);
    expect(paid.collateralMix).toBe("mixed");
    const none = await wallet(boxes + 5n * ADA + CHAIN + 3n * ADA);
    const plain = await runner(none, pooled(none, [])).mixOutBuild("preprod", 1);
    expect(plain.collateralMix).toBeUndefined();
    expect(review(plain)).not.toContain(IF_LEFT());
  });

  // Fixer fx-may (review/last-3d.md): the two states where the rule was never asked. Stop pressed while its funding is
  // still on its way, the account counted as that funding will leave it; and a review whose read of the 5 ₳ pool fails,
  // funded without the reserve, though that pool may take the collateral as the session comes back, as the quote and
  // Stop have it. No new words: each screen says what it says of the same word.
  const STOP_DEFINITE = "giveme.my backs its collateral's mix, so it sees that mix.";
  /** Stop's dialog as it opens on `cost`: nothing placed, through Lovejoin. */
  const dialog = (cost: SwapLovejoin) =>
    read(createElement(StopDialog, { placed: false, cost, through: true, onThrough: () => undefined, busy: false, onStop: () => undefined, onClose: () => undefined }));

  it("Stop, pressed while its funding is on its way: says its collateral's mix as once that funding lands, the account counted as it will leave it (fx-may; last-3d, 1)", async () => {
    const { perBox, besides } = await boxPrice();
    // Funded with the reserve, nothing at the account yet, no box (8 ₳) or two: mixed, the boxes counted on the funding
    // less its reserve, as once it lands; and the return WebAssembly builds then mixes the 5 ₳.
    for (const [fund, boxes] of [
      [8n * ADA, 0],
      [besides + 2n * perBox + ADA / 2n, 2],
    ] as const) {
      const on = await stopped({ reserved: true, landing: true, fund, rows: [] });
      expect(on.cost, `${fund}`).toMatchObject({ boxes, collateralMix: "mixed" });
      const said = dialog(on.cost);
      expect(said, `${fund}`).toContain(STOP_DEFINITE);
      expect(said, `${fund}`).not.toContain("less the return's network fee");
      on.t.koios.addedToAccounts.push(at(OUT, 0, fund + CHAIN), at(OUT, 1, 5n * ADA));
      await on.sessions.list("preprod", true);
      expect(await on.sessions.stopCost("preprod", 0), `${fund}, landed`).toMatchObject({ boxes, collateralMix: "mixed" });
      expect((await on.sessions.backBuild("preprod", 0)).collateralTail, `${fund}, landed`).toBeDefined();
    }
    // Funded without it: mixed only if enough is left, as once it lands.
    const unreserved = await stopped({ landing: true, fund: 8n * ADA, rows: [] });
    expect(unreserved.cost.collateralMix).toBe("ifLeft");
    expect(dialog(unreserved.cost)).toContain(IF_LEFT());
    // A token sold for ADA: its funding is the token beside all the ADA, nothing of ADA alone to pay for that mix, so
    // nothing is said, as once it lands.
    expect((await stopped({ reserved: true, sell: true, landing: true, fund: 4n * ADA, rows: [] })).cost.collateralMix).toBeUndefined();
    // No mix can go: Settings keeps the collateral out, or the 5 ₳ pool takes none (one of other people's boxes there).
    for (const o of [{ prefs: { lovejoinCollateral: false } }, { strangers: 1 }]) {
      const { cost } = await stopped({ reserved: true, landing: true, fund: 8n * ADA, rows: [], ...o });
      expect(cost.collateralMix, JSON.stringify(o)).toBeUndefined();
    }
  });

  it("Stop, pressed once its funding is confirmed but before the reading lists it, or by a worker started again before its first read: says its collateral's mix as once it's listed (the last look at fx-may, 1)", async () => {
    // Confirmed, the account's reading behind the chain (the runner waits on that too): mixed, as on its way and as
    // once listed, never the 'less the return's network fee' LW-1 took out.
    const on = await stopped({ reserved: true, unlisted: true, fund: 8n * ADA, rows: [] });
    expect(on.cost).toMatchObject({ boxes: 0, collateralMix: "mixed" });
    expect(dialog(on.cost)).toContain(STOP_DEFINITE);
    expect(dialog(on.cost)).not.toContain("less the return's network fee");
    // A worker started again, nothing read since: the same.
    expect(await runner(on.t).stopCost("preprod", 0)).toMatchObject({ boxes: 0, collateralMix: "mixed" });
    // Funded without the reserve: only if enough is left, as on its way.
    expect((await stopped({ unlisted: true, fund: 8n * ADA, rows: [] })).cost.collateralMix).toBe("ifLeft");
    // Once listed, what's there decides, as before.
    on.t.koios.addedToAccounts.push(at(OUT, 0, 8n * ADA + CHAIN), at(OUT, 1, 5n * ADA));
    await on.sessions.list("preprod", true);
    expect(await on.sessions.stopCost("preprod", 0)).toMatchObject({ boxes: 0, collateralMix: "mixed" });
  });

  it("Stop, on a funding in parts found short with its collateral's part missed: says nothing of that mix, which that collateral never came for (the last look at fx-may, 2)", async () => {
    const t = await wallet(ADA);
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    const [first, second] = ["e1".repeat(32), "e2".repeat(32)];
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: t.clock.now,
          parts: 2,
          // The part that paid the 5 ₳ never landed; the other did, and is listed.
          txs: [
            { kind: "out", txHash: first, at: t.clock.now, missed: true },
            { kind: "out", txHash: second, at: t.clock.now, confirmed: true },
          ],
          swap: { ...minswapEstimate.ask, amountOut: "906594100", minAmountOut: "902083681" },
          auto: {
            approved: { minAmountOut: "902083681", fund: { lovelace: (10n * ADA).toString(), tokens: [] }, aggregatorFee: "0" },
            direct: false,
            lovejoin: { depth: 1, delay: "1-6" },
            paused: { at: t.clock.now, why: "short", landed: 1, total: 2 },
          },
          collateralReserve: true,
        },
      ],
    });
    t.koios.addedToAccounts.push(at(second, 0, 10n * ADA));
    const sessions = runner(t);
    await sessions.list("preprod", true);
    expect((await sessions.stopCost("preprod", 0))!.collateralMix).toBeUndefined();
  });

  /** Koios failing every read of the 5 ₳ pool's boxes, as it times out (504), while `down` says so. */
  function fiveDown(t: T, down: () => boolean = () => true): void {
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => {
      const asked = init?.body ? (JSON.parse(String(init.body)) as { _payment_credentials?: string[] }) : undefined;
      if (down() && String(url).includes("/credential_utxos") && asked?._payment_credentials?.includes(FIVE_BOX)) {
        return new Response("gateway timeout", { status: 504 });
      }
      return real(url, init);
    };
  }

  it("a swap's review whose read of the 5 ₳ pool fails: funded without the reserve, its collateral mixed only if enough is left, as its quote and Stop have it (fx-may; last-3d, 2)", async () => {
    // 500 MIN sold for 6 ₳, the private balance paying all, the reserve too; at Review Koios times out on the pools' read.
    const t = await wallet(40n * ADA);
    t.minswap.estimate = { ...minswapEstimate.estimate, amount_out: (6n * ADA).toString(), min_amount_out: ((6n * ADA * 99n) / 100n).toString() };
    t.koios.added.push({ ...ownedUtxos[0]!, tx_hash: "d2".repeat(32), tx_index: 0, value: "2000000", asset_list: MIN500 as never } as KoiosUtxo);
    fiveDown(t);
    const sessions = runner(t);
    const quote = await sessions.quote("preprod", SELL);
    expect(quote).toMatchObject({ collateralReserve: CHAIN.toString(), collateralMix: "ifLeft", collateralMaybe: true });
    const built = await sessions.outBuild("preprod", quote);
    expect(built.collateralReserve).toBeUndefined();
    const said = approval(built, quote);
    expect(said).toContain(IF_LEFT());
    expect(said).not.toContain(DEFINITE);
    expect(said).not.toContain("Its collateral's mix, about");
    expect(built.collateralMix).toBe("ifLeft");
    // Its return after the fill reads that pool again, and mixes the 5 ₳ from the fill's ADA and the order's change.
    const filled = await stopped({ sell: true, ordered: true, filled: true, fund: 4n * ADA, rows: [at(ORDER, 1, SWAP_MARGIN - ORDER_FEE), at("aa".repeat(32), 0, 6n * ADA)] });
    expect((await filled.sessions.backBuild("preprod", 0)).collateralTail).toBeDefined();
    // ADA for MIN alike.
    const a = await wallet(40n * ADA);
    fiveDown(a);
    const buying = runner(a);
    const into = await buying.outBuild("preprod", await buying.quote("preprod", minswapEstimate.ask));
    expect(into.collateralReserve).toBeUndefined();
    expect(into.collateralMix).toBe("ifLeft");
    // Read last as taking none (one of other people's boxes there), or against the pools with no box of MIN's own,
    // whose return can't build that mix (R3-10): nothing said, the read failing or not.
    const one = await wallet(40n * ADA);
    one.koios.addedToAccounts = one.koios.addedToAccounts.filter((u) => u.tx_hash !== "82".repeat(32));
    const lj = pooled(one);
    await lj.rooms("preprod");
    fiveDown(one);
    const refused = runner(one, lj);
    expect((await refused.outBuild("preprod", await refused.quote("preprod", minswapEstimate.ask))).collateralMix).toBeUndefined();
    const d = await wallet(40n * ADA);
    d.minswap.estimate = DANOGO;
    fiveDown(d);
    const danogo = runner(d);
    expect((await danogo.outBuild("preprod", await danogo.quote("preprod", minswapEstimate.ask))).collateralMix).toBeUndefined();
    // Settings keeps the collateral out: no read, nothing said.
    const off = await wallet(40n * ADA);
    await off.deps.preferences.set({ lovejoinCollateral: false });
    fiveDown(off);
    const kept = runner(off);
    expect((await kept.outBuild("preprod", await kept.quote("preprod", minswapEstimate.ask))).collateralMix).toBeUndefined();
  });

  it("a mix's, a site's funding's and a top-up's review whose read of the 5 ₳ pool fails: funded without the reserve, mixed only if enough is left (fx-may; last-3d, 2)", async () => {
    // A mix: only its collateral's look fails, the mix's own read of its pool having gone, as Koios answers one request
    // and times out on the next.
    const boxes = BigInt((await pooled(await wallet(ADA)).funding("preprod", 1)).lovelace);
    const m = await wallet(boxes + 5n * ADA + CHAIN + 3n * ADA);
    const lj = pooled(m);
    let down = false;
    fiveDown(m, () => down);
    const look = lj.collateralPool.bind(lj);
    vi.spyOn(lj, "collateralPool").mockImplementation(async (...args) => {
      down = true;
      try {
        return await look(...args);
      } finally {
        down = false;
      }
    });
    const mixed = await runner(m, lj).mixOutBuild("preprod", 1);
    expect(mixed.collateralReserve).toBeUndefined();
    const review = read(createElement(PrivateReview, { summary: mixed }));
    expect(review).toContain(IF_LEFT());
    expect(review).not.toContain(DEFINITE);
    expect(mixed.collateralMix).toBe("ifLeft");
    // A site's funding, and a top-up that puts a new collateral back: the private balance pays the direct reserve too.
    const s = await wallet(15n * ADA + BigInt(DIRECT) + 3n * ADA);
    fiveDown(s);
    const site = await runner(s).siteOutBuild("preprod", "https://example.org", (10n * ADA).toString(), []);
    expect(site.collateralReserve).toBeUndefined();
    expect(read(createElement(FundingWayBack, { fee: site.fee.total, lovejoin: true, perBox: "4.1", summary: site }))).toContain("only if enough is left");
    expect(site.collateralMix).toBe("ifLeft");
    const u = await wallet(8n * ADA + BigInt(DIRECT) + 3n * ADA);
    await siteSession(u);
    fiveDown(u);
    const topUp = await runner(u).topUpBuild("preprod", 0, (3n * ADA).toString(), []);
    expect(topUp.collateralReserve).toBeUndefined();
    expect(read(createElement(TopUpCollateralNote, { summary: topUp }))).toContain("only if enough is left");
    expect(topUp.collateralMix).toBe("ifLeft");
  });
});
