// 1.6.0's release review, the collateral's mix reserve (fixer `reserve`): 323-worker#0, each funding that pays for a
// session's collateral to be mixed is built again without that reserve where the private balance doesn't pay for it
// too; 323-rust#1's worker half, a site's session and its top-up taking what a return that comes back directly needs,
// a swap and a mix the chain's 1.5 ₳; and the worker half of 320-screens#2 and 321-lj-screens#3, lovejoin-funding
// naming what a mix from the private balance adds. Session 0 of the 12-word phrase, the real WebAssembly, preprod's
// 5 ₳ pool as lovejoin-pools.json bundles it with two of other people's boxes in it, and the classic pool's recorded
// boxes. The direct reserve's export is stood in for (DIRECT): these tests run on the WebAssembly built before it, and
// its own test is wasm's a_direct_returns_collateral_tail_is_paid_by_its_reserve_alone.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService, type PoolRef } from "../src/background/lovejoin";
import { Minswap } from "../src/background/minswap";
import { SessionService } from "../src/background/sessions";
import { t as tr } from "../src/i18n";
import bundled from "../src/lovejoin-pools.json";
import { NETWORKS } from "../src/networks";
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
// private balance couldn't also pay the reserve for still says a 5 ₳ pool takes the collateral (`collateralPool`), as
// its return mixes it where what's left pays; R3-10, a swap against the pools whose return comes back directly with its
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
    const paid = await runner(await wallet(fund + 5n * ADA + CHAIN + 3n * ADA)).outBuild("preprod", quote);
    expect(paid).toMatchObject({ collateralReserve: CHAIN.toString(), collateralPool: true });
    // Short of the reserve: funded without it, and still says the pool takes the collateral, which its return mixes
    // where what's left pays for that.
    const short = await runner(await wallet(fund + 5n * ADA + 2n * ADA + ADA / 2n)).outBuild("preprod", quote);
    expect(short.collateralReserve).toBeUndefined();
    expect(short.collateralPool).toBe(true);
    // No 5 ₳ pool shown: neither.
    const none = await wallet(1_000n * ADA);
    const plain = await runner(none, pooled(none, [])).outBuild("preprod", quote);
    expect(plain.collateralReserve).toBeUndefined();
    expect(plain.collateralPool).toBeUndefined();
    // A site's funding, and a top-up that puts a new collateral back, alike.
    const site = await runner(await wallet(15n * ADA + 3n * ADA)).siteOutBuild("preprod", "https://example.org", (10n * ADA).toString(), []);
    expect(site.collateralReserve).toBeUndefined();
    expect(site.collateralPool).toBe(true);
    const t = await wallet(8n * ADA + 3n * ADA);
    await siteSession(t);
    const topUp = await runner(t).topUpBuild("preprod", 0, (3n * ADA).toString(), []);
    expect(topUp.collateralReserve).toBeUndefined();
    expect(topUp.collateralPool).toBe(true);
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
    expect(out.collateralPool).toBeUndefined();
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
    expect(reserved.cost).toMatchObject({ boxes: 1, collateralMix: true });
    // The chain WebAssembly builds for it: one box, the collateral mixed first, out of its reserve.
    const back = await reserved.sessions.backBuild("preprod", 0);
    expect(back.lovejoin?.boxes).toBe(1);
    expect(back.collateralTail).toBeDefined();
    // Funded without the reserve, the same ADA there: the chain counts its boxes on all of it, the collateral still mixed.
    expect((await stopped(false)).cost).toMatchObject({ boxes: 2, collateralMix: true });
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
    // Its note still says a 5 ₳ pool takes the new collateral: it's mixed at the return if what's left pays (R3-9).
    expect(built.collateralPool).toBe(true);
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
