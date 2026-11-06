// 1.8.0's release review, the chain lane (docs/plans/review-1.8.0/fix/chain.md).
// - O5: with no 5 ₳ pool shown, a return's tokens still go into their own v2 pools, with no ADA leg (acrossOf), as
//   they do under that pool's floor, and its ADA comes back with the return. It all comes back directly, saying no
//   5 ₳ pool, only where no token goes either.
// - critic#4: a swap approved on 1.7.2 priced its way back in the classic pool's 10 ₳ boxes, and its record names no
//   box. Coming back on 1.8.0 by itself, it takes no more of the 5 ₳ pool's boxes than that pricing counts for its ADA,
//   and the rest comes back at once. One approved on 1.8.0 records the box it was priced at, and takes all its ADA
//   pays for.
// With the real WebAssembly, Lovejoin v2's 5 ₳ pool (v2-pools.ts), PR #163's preprod token pool on v2's scripts, and a
// MIN pool the wallet's own start makes, as lovejoin-planner.test.ts makes it.
import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { chainBoxes, LovejoinService, type PoolRef } from "../src/background/lovejoin";
import { LovejoinLaunchService } from "../src/background/lovejoin-launch";
import { HOLDER, LOVEJOIN_NFT } from "../src/background/lovejoin-pools";
import { Minswap } from "../src/background/minswap";
import { SessionService } from "../src/background/sessions";
import { t as tr } from "../src/i18n";
import { NETWORKS } from "../src/networks";
import type { LovejoinDepth } from "../src/shared/preferences";
import tokenList from "../src/tokens/list.json";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { koiosPreprod, loadTestWasm, minswapEstimate, ownedUtxos, sessionSwap, testBalances, vectors } from "./fakes";
import { orderRow, SWAP_TX } from "./swap-session";
import { ADA, ADA_POOL, ADA_ROWS, adaStrangers } from "./v2-pools";

const PASSWORD = "correct horse battery";
const PHRASE = (vectors("cardano_account.json") as Array<{ account: number; phrase: string }>).find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
)!.phrase;

/** Real chains are built and measured in WebAssembly: seconds each, more on CI. */
const SLOW = { timeout: 300_000 };

/** 20 boxes from Lovejoin's classic preprod pool, as Koios lists them (2026-09-25): each box below is made from one. */
const POOL = (JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }).pool;

/** PR #163's token pool on preprod, launched on v2's scripts (wasm/tests/fixtures): 2 ₳ and LJTEST a box. */
const FOUND = JSON.parse(readFileSync(new URL("../../wasm/tests/fixtures/lovejoin-v2-token-pool-preprod.json", import.meta.url), "utf8")) as {
  seed: { txHash: string; txIndex: number };
  reference: KoiosUtxo;
  scripts: KoiosUtxo[];
};
const TOKEN_POOL: PoolRef = { reference: FOUND.reference, seed: FOUND.seed, scripts: FOUND.scripts };
const VIEW = JSON.parse(loadTestWasm().lovejoinVerifyPool(JSON.stringify({ network: "preprod", pool: TOKEN_POOL }))) as {
  id: string;
  mixBoxHash: string;
  token: { policyId: string; assetName: string; quantity: string };
};
const TOKEN = VIEW.id;
const Q = BigInt(VIEW.token.quantity);
const LJTEST = VIEW.token.policyId + VIEW.token.assetName;

/** MIN, on preprod's token list, which the recorded swap gets. */
const MIN = tokenList.preprod.find((x) => x.ticker === "MIN")!;
const MIN_UNIT = MIN.policy + MIN.name;
/** A MIN pool's box: 4.5 ₳ and 900 MIN, so the recorded swap's least (902.08 MIN) makes one. */
const MIN_Q = 900_000_000n;

/** Ogmios's answer when the network measures no more than a transaction declares. */
const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };

type T = ReturnType<typeof testBalances>;

async function wallet(): Promise<T> {
  const t = testBalances();
  await t.wallet.create(PHRASE, PASSWORD);
  t.koios.evaluation = AGREES;
  // A slot in preprod's Shelley era, for what the account signs (lovejoin-flows.test.ts).
  t.koios.tip = 110_000_000;
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  return t;
}

/** Lovejoin reading `pools`, giveme.my's witness stood in for. */
function pooled(t: T, pools: PoolRef[]): LovejoinService {
  const wasm = loadTestWasm();
  return new LovejoinService({
    ...t.deps,
    wasm: {
      ...wasm,
      finishLovejoinWithdraw: (request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    pools: async () => pools,
    random: () => 0.5,
  });
}

/** The sessions over `lj`, giveme.my and the one-time key's signatures stood in for. */
function runner(t: T, lj: LovejoinService): SessionService {
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
    lovejoin: lj,
    sleep: async () => undefined,
  });
}

const asset = (unit: string, quantity: bigint) => ({ policy_id: unit.slice(0, 56), asset_name: unit.slice(56), quantity: quantity.toString() });

/** A UTxO at session 0's account, as Koios lists it. */
function atSession(tx_hash: string, tx_index: number, value: string, assets: Array<ReturnType<typeof asset>> = []): KoiosUtxo {
  return {
    tx_hash,
    tx_index,
    address: sessionSwap.address,
    value,
    stake_address: null,
    payment_cred: sessionSwap.keyHash,
    epoch_no: 315,
    block_height: 5_000_000,
    block_time: 1_800_000_000,
    datum_hash: null,
    inline_datum: null,
    reference_script: null,
    is_spent: false,
    asset_list: assets.map((a) => ({ ...a, decimals: 0, fingerprint: "asset1test" })) as never,
  } as KoiosUtxo;
}

/** One of the recorded public account's UTxOs, made again as `tx`'s with `value`. */
function atAccount(tx: string, value: string): KoiosUtxo {
  const [first] = Object.values(koiosPreprod.accounts)[0]!.account_utxos.filter((u) => BigInt(u.value) > 1_000_000_000n);
  return { ...first!, tx_hash: tx.repeat(32), tx_index: 0, value, asset_list: [] };
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

/** `n` strangers' boxes at `mixBox`, each holding `lovelace` and `token`. */
function strangers(t: T, mixBox: string, n: number, first: number, lovelace: string, token?: ReturnType<typeof asset>): KoiosUtxo[] {
  const address = bech32("addr_test", Uint8Array.from([0x70, ...Buffer.from(mixBox, "hex")]));
  return Array.from({ length: n }, (_, i) => {
    const tx = (first + i).toString(16).padStart(2, "0").repeat(32);
    t.koios.txSpends.set(tx, [{ payment_addr: { bech32: address, cred: mixBox } }]);
    return {
      ...POOL[0]!,
      tx_hash: tx,
      tx_index: 0,
      address,
      payment_cred: mixBox,
      value: lovelace,
      datum_hash: null,
      inline_datum: { bytes: strangerDatum(first + i), value: {} },
      asset_list: token ? [{ ...token, decimals: 0, fingerprint: "asset1test" } as never] : [],
    } as KoiosUtxo;
  });
}

/**
 * A MIN pool, 4.5 ₳ and 900 MIN a box, as the wallet's own start from the public account makes it: its reference
 * UTxO and its two scripts at the holder, and its seed (lovejoin-planner.test.ts).
 */
async function minPool(t: T): Promise<{ ref: PoolRef; id: string; mixBox: string }> {
  const wasm = loadTestWasm();
  t.koios.addedToAccounts.push(atAccount("e1", "40000000"), atAccount("e5", "5000000"));
  let made: { txCbor: string; pool: { id: string; mixBoxHash: string; mixLogicHash: string; seed: { txHash: string; txIndex: number } }; locked: { mixBox: string } } | undefined;
  const launch = new LovejoinLaunchService({
    ...t.deps,
    wasm: {
      ...wasm,
      buildLovejoinLaunchFromAccount: (key: Parameters<typeof wasm.buildLovejoinLaunchFromAccount>[0], request: string) => {
        const out = wasm.buildLovejoinLaunchFromAccount(key, request);
        if ((JSON.parse(request) as { register: boolean }).register) made = JSON.parse(out) as typeof made;
        return out;
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    lovejoin: t.lovejoin,
    discovery: { known: async () => [], look: async () => undefined },
  });
  await launch.build("preprod", { from: "public", token: { policyId: MIN.policy, assetName: MIN.name }, quantity: MIN_Q.toString(), boxLovelace: "4500000" });
  const outs = JSON.parse(wasm.ogmiosUtxos(made!.txCbor)) as Array<{
    transaction: { id: string };
    index: number;
    address: string;
    value: { ada: { lovelace: number } } & Record<string, Record<string, number>>;
    datum?: string;
  }>;
  const row = (o: (typeof outs)[number], extra: Partial<KoiosUtxo>): KoiosUtxo =>
    ({
      ...POOL[0]!,
      tx_hash: o.transaction.id,
      tx_index: o.index,
      address: o.address,
      payment_cred: HOLDER,
      value: String(o.value.ada.lovelace),
      datum_hash: null,
      inline_datum: null,
      asset_list: [],
      ...extra,
    }) as KoiosUtxo;
  const atHolder = outs.filter((o) => o.address === outs.find((x) => x.value[made!.pool.id])!.address);
  const reference = atHolder.find((o) => o.value[made!.pool.id])!;
  const scripts = atHolder
    .filter((o) => o !== reference)
    .map((o) =>
      row(o, {
        reference_script: { hash: String(o.value.ada.lovelace) === made!.locked.mixBox ? made!.pool.mixBoxHash : made!.pool.mixLogicHash, type: "plutusV3" } as never,
      }),
    );
  const ref: PoolRef = {
    reference: row(reference, {
      inline_datum: { bytes: reference.datum!, value: {} } as never,
      asset_list: [{ policy_id: made!.pool.id, asset_name: LOVEJOIN_NFT, quantity: "1", decimals: 0, fingerprint: "" } as never],
    }),
    seed: made!.pool.seed,
    scripts,
  };
  return { ref, id: made!.pool.id, mixBox: made!.pool.mixBoxHash };
}

/** Session 0, a site's, its funding `OUT` its own transaction. */
const OUT = "ab".repeat(32);
async function siteSession(t: T): Promise<void> {
  await t.store.set("sessions.preprod", {
    next: 1,
    sessions: [
      { index: 0, ownStake: true, createdAt: t.clock.now, txs: [{ kind: "out", txHash: OUT, at: t.clock.now, confirmed: true }], site: { origin: "https://example.org" } },
    ],
  });
}

/** Each chain as the sealed schedule keeps it: its boxes and its own mixes, the collateral's apart. */
type Sealed = { chains: Array<{ session?: number; boxes: number; mixes: string[] }> };
const sealed = async (t: T) => (await t.store.get<Sealed>("lovejoin.preprod"))!;

/**
 * What 1.7.2's priced counted for `spare` lovelace of a return's ADA, `depth` deep, three a mix (6b70c1f8's
 * sessions.ts, priced): what each box more takes and what the chain takes besides, from the funding of one box and of
 * two in the classic pool (funding names no pool, as there), at most one chain's boxes, and their mixes.
 */
async function pricedOn172(lj: LovejoinService, spare: bigint, depth: LovejoinDepth) {
  const one = await lj.funding("preprod", 1, false, depth, undefined, 3);
  const two = await lj.funding("preprod", 2, false, depth, undefined, 3);
  const perBox = BigInt(two.lovelace) - BigInt(one.lovelace);
  const besides = BigInt(one.lovelace) - perBox;
  const boxes = Math.min(spare > besides ? Number((spare - besides) / perBox) : 0, chainBoxes(depth, 3));
  return { boxes, mixes: boxes * one.mixes, perBox };
}

/**
 * Session 0, a swap that runs itself, approved through Lovejoin `depth` deep: its approval as 1.7.2 recorded it
 * (6b70c1f8's AutoRecord and outBuild), its depth and wait and no box, since 1.7.2 priced every return's ADA in the
 * classic pool's 10 ₳ boxes. `fund`: the swap's own funding as approved; `swap`, what it trades; `txs`, its steps after
 * its funding; `auto`, how it's going, or the `lovejoin` an approval on 1.8.0 recorded.
 */
async function swapRecord(
  t: T,
  { depth, fund, swap = {}, txs = [], auto = {} }: { depth: LovejoinDepth; fund: string; swap?: object; txs?: object[]; auto?: object },
): Promise<void> {
  const now = t.clock.now;
  await t.store.set("sessions.preprod", {
    next: 1,
    sessions: [
      {
        index: 0,
        ownStake: true,
        createdAt: now,
        txs: [{ kind: "out", txHash: OUT, at: now, confirmed: true }, ...txs],
        swap: { ...minswapEstimate.ask, amountOut: "906594100", minAmountOut: "902083681", ...swap },
        auto: {
          approved: { minAmountOut: "902083681", fund: { lovelace: fund, tokens: [] }, aggregatorFee: "0" },
          direct: false,
          lovejoin: { depth, delay: "1-6" },
          ...auto,
        },
      },
    ],
  });
}

/** Its order placed and landed, and spent by now: its swap's transaction, as the session records it (swap-runner.test.ts). */
const PLACED = { kind: "swap", txHash: SWAP_TX, at: 1_800_000_000_000, confirmed: true, orders: [`${SWAP_TX}#0`], minAmountOut: "902083681" };

/** That order, at the DEX's contract and spent, and `arrived` at the account, the fill or the refund, beside its 5 ₳ collateral. */
function settled(t: T, arrived: KoiosUtxo[]): void {
  t.koios.addedToAccounts.push(orderRow(SWAP_TX, 0), atSession(OUT, 1, "5000000"), ...arrived);
  t.koios.spent.add(`${SWAP_TX}#0`);
}

describe("1.8.0's release review, critic#4: a swap approved on 1.7.2 comes back in no more boxes than it was priced for", SLOW, () => {
  it("stopped before its order, its 40 ₳ takes the three boxes 1.7.2 priced in 10 ₳ ones, not six of 5 ₳", async () => {
    const t = await wallet();
    // Settings since: two waves deep. Its approval's one wave stands (independent review L21).
    await t.deps.preferences.set({ lovejoinDepth: 2 });
    const lj = pooled(t, [ADA_POOL]);
    const sessions = runner(t, lj);
    await swapRecord(t, { depth: 1, fund: "40000000", auto: { stopping: t.clock.now } });
    t.koios.addedToAccounts.push(atSession(OUT, 0, "40000000"), atSession(OUT, 1, "5000000"), ...ADA_ROWS);
    // What its approval said its way back takes, stopped or refunded (ifStopped): the swap's 40 ₳ in 10 ₳ boxes.
    const approved = await pricedOn172(lj, 40_000_000n, 1);
    expect(approved.boxes).toBe(3);
    // The same ADA pays for six of the 5 ₳ pool's (5.95 ₳ each, one wave deep): what 1.8.0 took before this fix.
    const ada = await lj.adaPool("preprod");
    const fives = await lj.plan("preprod", 0, [atSession(OUT, 0, "40000000"), atSession(OUT, 1, "5000000")], atSession(OUT, 1, "5000000"), false, 1, ada);
    expect(fives.boxes).toBe(6);
    // The runner brings it back by itself, with no review: three boxes, three mixes, the rest back at once.
    const view = await sessions.advance("preprod", 0, true);
    expect(view.txs.map((x) => x.kind)).toContain("deposit");
    const chain = (await sealed(t)).chains.at(-1)!;
    expect(chain).toMatchObject({ session: 0, boxes: approved.boxes });
    expect(chain.mixes.length).toBeLessThanOrEqual(approved.mixes);
  });

  it("says in Stop's dialog the boxes its return takes: three of its 40 ₳, and their mix fees, never the 5 ₳ pool's six", async () => {
    const t = await wallet();
    const lj = pooled(t, [ADA_POOL]);
    const sessions = runner(t, lj);
    t.koios.addedToAccounts.push(atSession(OUT, 0, "40000000"), atSession(OUT, 1, "5000000"), ...ADA_ROWS);
    const approved = await pricedOn172(lj, 40_000_000n, 1);
    // Each box's mixes are the 5 ₳ pool's, where they go.
    const five = await lj.funding("preprod", 1, false, 1, await lj.adaPool("preprod"), 3);
    await swapRecord(t, { depth: 1, fund: "40000000" });
    expect(await sessions.stopCost("preprod", 0)).toMatchObject({
      boxes: approved.boxes,
      mixes: approved.mixes,
      mixFees: (BigInt(approved.boxes) * BigInt(five.mixFees)).toString(),
    });
    // Approved on 1.8.0, the same ADA: the six it pays for.
    await swapRecord(t, { depth: 1, fund: "40000000", auto: { lovejoin: { depth: 1, delay: "1-6", box: "5000000" } } });
    expect(await sessions.stopCost("preprod", 0)).toMatchObject({ boxes: 6 });
  });

  it("filled with ADA, its proceeds take no more boxes than 1.7.2 priced them in", async () => {
    const t = await wallet();
    const lj = pooled(t, [ADA_POOL]);
    const sessions = runner(t, lj);
    // Selling MIN for ADA, approved one wave deep; its order filled, its proceeds and its deposit back, 60 ₳, and the
    // swap's change, its margin, 2 ₳.
    await swapRecord(t, {
      depth: 1,
      fund: "4000000",
      swap: { tokenIn: MIN_UNIT, tokenOut: "lovelace", amount: "906594100", amountOut: "58000000", minAmountOut: "57000000" },
      txs: [PLACED],
    });
    const fill = "f1".repeat(32);
    settled(t, [atSession(fill, 0, "60000000")]);
    t.koios.addedToAccounts.push(atSession(SWAP_TX, 1, "2000000"), ...ADA_ROWS);
    // What its approval priced for its proceeds and its margin (priced's `spare`), as 1.7.2 did: five boxes, not nine.
    const approved = await pricedOn172(lj, 62_000_000n, 1);
    expect(approved.boxes).toBe(5);
    const view = await sessions.advance("preprod", 0, true);
    expect(view.auto).toMatchObject({ filled: true });
    const chain = (await sealed(t)).chains.at(-1)!;
    expect(chain).toMatchObject({ session: 0, boxes: approved.boxes });
    expect(chain.mixes.length).toBeLessThanOrEqual(approved.mixes);
  });

  it("refunded, two waves deep, its 40 ₳ back takes the two boxes 1.7.2 priced, not four", async () => {
    const t = await wallet();
    const lj = pooled(t, [ADA_POOL]);
    const sessions = runner(t, lj);
    // Buying MIN with 40 ₳, approved two waves deep; its order refunded the 40 ₳.
    await swapRecord(t, { depth: 2, fund: "40000000", txs: [PLACED] });
    settled(t, [atSession("aa".repeat(32), 0, "40000000")]);
    // Enough strangers in the 5 ₳ pool for four boxes two waves deep, eight draws each.
    t.koios.addedToAccounts.push(...adaStrangers(40));
    const approved = await pricedOn172(lj, 40_000_000n, 2);
    expect(approved.boxes).toBe(2);
    const view = await sessions.advance("preprod", 0, true);
    expect(view.auto).toMatchObject({ refunded: true });
    const chain = (await sealed(t)).chains.at(-1)!;
    expect(chain).toMatchObject({ session: 0, boxes: approved.boxes });
    expect(chain.mixes.length).toBeLessThanOrEqual(approved.mixes);
  });

  it("approved on 1.8.0, records the 5 ₳ box it was priced at, and its return takes all its ADA pays for", async () => {
    const t = await wallet();
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    const lj = pooled(t, [ADA_POOL]);
    const sessions = runner(t, lj);
    // The private balance pays for the swap.
    const wasm = loadTestWasm();
    const datum = await t.wallet.withKeys((keys) => Buffer.from(wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister()))).toString("hex"));
    t.koios.added.push({ ...ownedUtxos[0]!, tx_hash: "d1".repeat(32), tx_index: 0, value: "100000000", inline_datum: { bytes: datum, value: {} } } as KoiosUtxo);
    t.koios.addedToAccounts.push(...ADA_ROWS);
    const out = await sessions.outBuild("preprod", await sessions.quote("preprod", minswapEstimate.ask));
    await sessions.outSubmit("preprod", out.txHash);
    const book = (await t.store.get<{ sessions: Array<{ auto: { lovejoin?: Record<string, unknown> } }> }>("sessions.preprod"))!;
    const recorded = book.sessions[0]!.auto.lovejoin!;
    expect(recorded).toMatchObject({ depth: 1, box: "5000000" });
    // That approval, stopped before its order with 40 ₳ at its account: as many of the 5 ₳ pool's boxes as pay, six.
    const u = await wallet();
    const lu = pooled(u, [ADA_POOL]);
    await swapRecord(u, { depth: 1, fund: "40000000", auto: { stopping: u.clock.now, lovejoin: recorded } });
    u.koios.addedToAccounts.push(atSession(OUT, 0, "40000000"), atSession(OUT, 1, "5000000"), ...ADA_ROWS);
    await runner(u, lu).advance("preprod", 0, true);
    expect((await sealed(u)).chains.at(-1)).toMatchObject({ session: 0, boxes: 6 });
  });

  it("brings back at once what it leaves out, where a site's session with the same ADA takes the six boxes it pays for", async () => {
    // A site's session approved nothing: its 40 ₳ takes as many of the 5 ₳ pool's boxes as pay, one wave deep.
    const t = await wallet();
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    await siteSession(t);
    t.koios.addedToAccounts.push(atSession(OUT, 0, "40000000"), atSession(OUT, 1, "5000000"), ...ADA_ROWS);
    const site = await runner(t, pooled(t, [ADA_POOL])).backBuild("preprod", 0);
    expect(site.lovejoin).toMatchObject({ boxes: 6, mixes: 6 });
    // The 1.7.2 swap's, its review read: three, and the 5 ₳ of each box it leaves out comes back with the return.
    const u = await wallet();
    await swapRecord(u, { depth: 1, fund: "40000000", auto: { stopping: u.clock.now } });
    u.koios.addedToAccounts.push(atSession(OUT, 0, "40000000"), atSession(OUT, 1, "5000000"), ...ADA_ROWS);
    const swap = await runner(u, pooled(u, [ADA_POOL])).backBuild("preprod", 0);
    expect(swap.lovejoin).toMatchObject({ boxes: 3, mixes: 3 });
    expect(BigInt(swap.lovelace) - BigInt(site.lovelace)).toBeGreaterThanOrEqual(3n * 5_000_000n);
  });

  // Stop's dialog weighs D3's rule on the classic count too, as its return's chain does (priced's `leg`, the lead's at
  // the merge), which no test held. Uncapped, the dialog weighed the 5 ₳ pool's count four a mix against three's room,
  // fell back to three and said three's fees, where its return goes four wide; past a floor of 30 it named a box more than
  // its return makes as well. The cases that tell the widths apart, the collateral's two draws held in the pool as its
  // return holds them (1.8.0's review of its fixes, r2-tests#0 and r2-worker#0).
  const floor = NETWORKS.preprod.lovejoin!.poolFloor;
  afterEach(() => {
    NETWORKS.preprod.lovejoin!.poolFloor = floor;
  });
  for (const [fund, others, atLeast] of [
    ["40000000", 12, 0],
    ["60000000", 20, 0],
    ["80000000", 30, 30],
  ] as const) {
    const named = `${Number(fund) / 1e6} ₳ and ${others} strangers' boxes${atLeast ? `, past a floor of ${atLeast}` : ""}`;
    it(`approved four a mix, ${named}: Stop's dialog says its return's boxes four a mix, four's fees, and no fall-back`, async () => {
      NETWORKS.preprod.lovejoin!.poolFloor = atLeast;
      const t = await wallet();
      const lj = pooled(t, [ADA_POOL]);
      const sessions = runner(t, lj);
      const approved = { lovejoin: { depth: 1, delay: "1-6", width: 4 } };
      await swapRecord(t, { depth: 1, fund, auto: approved });
      t.koios.addedToAccounts.push(atSession(OUT, 0, fund), atSession(OUT, 1, "5000000"), ...adaStrangers(others));
      const stop = (await sessions.stopCost("preprod", 0))!;
      await swapRecord(t, { depth: 1, fund, auto: { ...approved, stopping: t.clock.now } });
      await sessions.advance("preprod", 0, true);
      const chain = (await t.store.get<{ chains: Array<{ boxes: number; width?: 4 }> }>("lovejoin.preprod"))!.chains.at(-1)!;
      expect(chain.width).toBe(4);
      expect({ boxes: stop.boxes, width: stop.width ?? 3, fellBack: stop.fellBack }).toEqual({ boxes: chain.boxes, width: 4, fellBack: undefined });
      const four = await lj.funding("preprod", 1, false, 1, await lj.adaPool("preprod"), 4);
      expect(stop.mixFees).toBe((BigInt(stop.boxes) * BigInt(four.mixFees)).toString());
    });
  }
});

describe("1.8.0's release review, O5: with no 5 ₳ pool shown, a return's tokens still go into their own pools", SLOW, () => {
  /** A site's session holding two boxes' worth of LJTEST, 40 ₳ and its collateral, with Lovejoin reading `pools`. */
  async function holdingLjtest(pools: PoolRef[], others = 40) {
    const t = await wallet();
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    const sessions = runner(t, pooled(t, pools));
    await siteSession(t);
    t.koios.addedToAccounts.push(
      atSession(OUT, 0, "3000000", [asset(LJTEST, 2n * Q)]),
      atSession(OUT, 1, "40000000"),
      atSession(OUT, 2, "5000000"),
      ...strangers(t, VIEW.mixBoxHash, others, 0x40, "2000000", asset(LJTEST, Q)),
    );
    return { t, sessions };
  }

  it("takes a site's LJTEST into its v2 pool, and brings its ADA back with the return (lows-a's and cross's case)", async () => {
    const { sessions } = await holdingLjtest([TOKEN_POOL]);
    const review = await sessions.backBuild("preprod", 0);
    // Both boxes of the token in its pool, as with the 5 ₳ pool shown; no ADA box, and no word of a pool missing.
    expect(review.lovejoinSkipped).toBeUndefined();
    expect(review.lovejoin?.parts).toEqual([{ pool: TOKEN, boxes: 2 }]);
    expect(review.lovejoin?.boxes).toBe(2);
    expect(review.lovejoin?.ways).toEqual([
      { policyId: VIEW.token.policyId, assetName: VIEW.token.assetName, pool: TOKEN, quantity: Q.toString(), boxes: 2, pools: [TOKEN] },
    ]);
    // Its ADA comes back with the return, its collateral too: no 5 ₳ pool to mix it in.
    expect(review.collateralTail).toBeUndefined();
    expect(BigInt(review.lovelace)).toBeGreaterThan(40_000_000n);
    expect(review.lovejoin?.values?.[ADA]).toBeUndefined();
  });

  it("brings it all back directly, saying no pool of 5 ₳ boxes, where no token goes either", async () => {
    // Its token's pool too short for a box: fewer others than its mix draws.
    const { sessions } = await holdingLjtest([TOKEN_POOL], 1);
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoin).toBeUndefined();
    expect(review.lovejoinSkipped).toBe(tr("sess.skip.warn.noAdaPool"));
    // And with ADA alone, as before.
    const t = await wallet();
    const alone = runner(t, pooled(t, [TOKEN_POOL]));
    await siteSession(t);
    t.koios.addedToAccounts.push(atSession(OUT, 0, "40000000"), atSession(OUT, 1, "5000000"));
    const plain = await alone.backBuild("preprod", 0);
    expect(plain.lovejoin).toBeUndefined();
    expect(plain.lovejoinSkipped).toBe(tr("sess.skip.warn.noAdaPool"));
  });

  it("takes a swap's MIN into the pool its approval showed, with only MIN's v2 pool shown (o-design's case)", async () => {
    const t = await wallet();
    const min = await minPool(t);
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    const sessions = runner(t, pooled(t, [min.ref]));
    const wasm = loadTestWasm();
    const datum = await t.wallet.withKeys((keys) => Buffer.from(wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister()))).toString("hex"));
    t.koios.added.push({ ...ownedUtxos[0]!, tx_hash: "d1".repeat(32), tx_index: 0, value: "100000000", inline_datum: { bytes: datum, value: {} } } as KoiosUtxo);
    t.koios.addedToAccounts.push(...strangers(t, min.mixBox, 8, 0x80, "4500000", asset(MIN_UNIT, MIN_Q)));
    // Its approval funds MIN's box and shows MIN going into its pool; only its ADA is said to come back directly.
    const out = await sessions.outBuild("preprod", await sessions.quote("preprod", minswapEstimate.ask));
    expect(out.lovejoin!.ways![0]).toMatchObject({ pool: min.id, boxes: 1 });
    expect(out.lovejoin!.skipped).toBe(tr("sess.skip.warn.noAdaPool"));
    await sessions.outSubmit("preprod", out.txHash);
    const book = (await t.store.get<{ sessions: Array<{ auto: { lovejoin?: object } }> }>("sessions.preprod"))!;
    const recorded = book.sessions[0]!.auto.lovejoin!;
    // Its order filled: 902.08 MIN, and what's left of its ADA.
    const fill = "f1".repeat(32);
    await swapRecord(t, { depth: 1, fund: "16000000", auto: { lovejoin: recorded, filled: t.clock.now, fills: [fill] } });
    t.koios.addedToAccounts.push(atSession(fill, 0, "2000000", [asset(MIN_UNIT, 902_083_681n)]), atSession(OUT, 0, "12000000"), atSession(OUT, 1, "5000000"));
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoinSkipped).toBeUndefined();
    expect(review.lovejoin?.parts).toEqual([{ pool: min.id, boxes: 1 }]);
    expect(review.lovejoin?.ways?.[0]).toMatchObject({ pool: min.id, boxes: 1 });
  });
});
