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

/** The sessions over `lj`, the one-time key's signature and the direct reserve's export stood in for. */
function runner(t: T, lj: LovejoinService = pooled(t)): SessionService {
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
