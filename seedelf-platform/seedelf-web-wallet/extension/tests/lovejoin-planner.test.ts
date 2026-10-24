// Chunk 34's 34e in the worker: a return's tokens through their own pools
// beside its ADA's (§7, one deposit and one chain), Change on its review, a
// swap's fill and approval, the swap's funding for its token's boxes (the
// owner's call, 2026-10-18), and D3's four boxes a mix with its fallback to
// three. With the real WebAssembly, the classic pool's recorded preprod
// boxes, PR #163's preprod token pool (2 ₳ and LJTEST a box), and a MIN pool
// the wallet's own start makes, as any standard pool is made.
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { bodyOutpoints, txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import {
  CHAIN_WINDOW,
  CHAIN_WINDOW_FOUR,
  LovejoinService,
  poolChoice,
  pumpChain,
  SESSION_LOVEJOIN_SENDING,
  type ChainProgress,
  type PoolRef,
} from "../src/background/lovejoin";
import { LovejoinLaunchService } from "../src/background/lovejoin-launch";
import { HOLDER, LOVEJOIN_NFT } from "../src/background/lovejoin-pools";
import { Minswap } from "../src/background/minswap";
import { SESSION_BACK, SESSION_CHAIN_PREFIX, SessionService, wayOf } from "../src/background/sessions";
import { SESSION_SPENT } from "../src/background/spent";
import { t as tr } from "../src/i18n";
import { NETWORKS } from "../src/networks";
import tokenList from "../src/tokens/list.json";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { koiosPreprod, loadTestWasm, minswapEstimate, ownedUtxos, sessionSwap, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const PHRASE = (vectors("cardano_account.json") as Array<{ account: number; phrase: string }>).find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
)!.phrase;

/** Real chains are built and measured in WebAssembly: seconds each, more on CI. */
const SLOW = { timeout: 180_000 };

/** 20 boxes from Lovejoin's preprod pool, as Koios lists them (2026-09-25). */
const POOL = (JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }).pool;
const CLASSIC_BOXES = new Set(POOL.map((u) => `${u.tx_hash}#${u.tx_index}`));

/** PR #163's token pool on preprod, as Koios lists it (wasm/tests/fixtures). */
const FOUND = JSON.parse(readFileSync(new URL("../../wasm/tests/fixtures/lovejoin-token-pool-preprod.json", import.meta.url), "utf8")) as {
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

/** Lovejoin reading the classic pool and `pools`, giveme.my's witness stood in for; `extra`, deps beside them. */
function pooled(t: T, pools: PoolRef[], extra: Partial<ConstructorParameters<typeof LovejoinService>[0]> = {}): LovejoinService {
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
    ...extra,
  });
}

/** The sessions over `lj`, giveme.my and the one-time key's signatures stood in for; `extra`, WebAssembly's calls changed. */
function runner(t: T, lj: LovejoinService, extra: Partial<ReturnType<typeof loadTestWasm>> = {}): SessionService {
  const wasm = loadTestWasm();
  return new SessionService({
    ...t.deps,
    wasm: {
      ...wasm,
      signScriptSpend: (_key: unknown, request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
      ...extra,
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

/** Session 0, a site's, its funding `OUT` its own transaction. */
const OUT = "ab".repeat(32);
async function siteSession(t: T): Promise<void> {
  await t.store.set("sessions.preprod", {
    next: 1,
    sessions: [
      {
        index: 0,
        ownStake: true,
        createdAt: t.clock.now,
        txs: [{ kind: "out", txHash: OUT, at: t.clock.now, confirmed: true }],
        site: { origin: "https://example.org" },
      },
    ],
  });
}

/** A price of a byte at which a 4.5 ₳ MIN box still meets its minimum (3.87 ₳ at 11,000) but can't pay its own way back. */
const STUCK_MIN = "12300";

type Kept = { chain?: Array<{ kind: string; txCbor: string; txHash: string }> };
const kept = async (t: T) => (await t.wallet.withKeys(() => t.session.get<Kept>(SESSION_BACK)))!;

type Sealed = {
  chains: Array<{ id: string; pools?: Record<string, number>; leaves: Array<{ pool?: string }>; width?: 4 }>;
};
const sealed = async (t: T) => (await t.store.get<Sealed>("lovejoin.preprod"))!;

describe("a return's tokens through their own pools (chunk 34's §7)", SLOW, () => {
  it("deposits the token's boxes beside the ADA's in one transaction, and mixes each box in its own pool", async () => {
    const t = await wallet();
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    const lj = pooled(t, [TOKEN_POOL]);
    const sessions = runner(t, lj);
    await siteSession(t);
    // Its own funding left two boxes' worth of LJTEST, 40 ₳, and its collateral.
    t.koios.addedToAccounts.push(
      atSession(OUT, 0, "3000000", [asset(LJTEST, 2n * Q)]),
      atSession(OUT, 1, "40000000"),
      atSession(OUT, 2, "5000000"),
      ...POOL,
      ...strangers(t, VIEW.mixBoxHash, 6, 0x60, "2000000", asset(LJTEST, Q)),
    );
    const review = await sessions.backBuild("preprod", 0);
    // The token's two boxes first, paid for first, then the ADA's from what they leave.
    expect(review.lovejoin?.parts?.[0]).toEqual({ pool: TOKEN, boxes: 2 });
    expect(review.lovejoin?.parts?.[1]?.pool).toBeUndefined();
    expect(review.lovejoin!.parts![1]!.boxes).toBeGreaterThanOrEqual(1);
    expect(review.lovejoin!.boxes).toBe(2 + review.lovejoin!.parts![1]!.boxes);
    expect(review.lovejoin?.ways).toEqual([
      { policyId: VIEW.token.policyId, assetName: VIEW.token.assetName, pool: TOKEN, quantity: Q.toString(), boxes: 2, pools: [TOKEN] },
    ]);
    // One deposit spends the token; each mix spends its own pool's boxes alone.
    const chain = (await kept(t)).chain!;
    const [deposit, ...rest] = chain;
    expect(deposit!.kind).toBe("deposit");
    expect(txInputs(Buffer.from(deposit!.txCbor, "hex"))).toContain(`${OUT}#0`);
    const mixes = rest.filter((tx) => tx.kind === "mix");
    expect(mixes).toHaveLength(review.lovejoin!.boxes);
    const tokenBoxes = new Set(strangers(t, VIEW.mixBoxHash, 6, 0x60, "2000000").map((u) => `${u.tx_hash}#0`));
    const inPool = (tx: { txCbor: string }, boxes: Set<string>) => txInputs(Buffer.from(tx.txCbor, "hex")).filter((o) => boxes.has(o)).length;
    for (const [i, mix] of mixes.entries()) {
      // The token pool's two mixes first, each drawing two of its strangers; the classic pool's after.
      expect(inPool(mix, i < 2 ? tokenBoxes : CLASSIC_BOXES)).toBe(2);
      expect(inPool(mix, i < 2 ? CLASSIC_BOXES : tokenBoxes)).toBe(0);
    }
    // Sent, its record has each leaf in its pool, and the token pool's share.
    await sessions.backSubmit("preprod", review.txHash);
    const record = (await sealed(t)).chains.at(-1)!;
    expect(record.pools).toEqual({ [TOKEN]: 2 });
    expect(record.leaves.map((l) => l.pool)).toEqual([TOKEN, TOKEN, ...Array(review.lovejoin!.boxes - 2).fill(undefined)]);
  });

  it("brings a token back directly when Change says so, and leaves a stranger's token out of any pool", async () => {
    const t = await wallet();
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    const lj = pooled(t, [TOKEN_POOL]);
    const sessions = runner(t, lj);
    await siteSession(t);
    t.koios.addedToAccounts.push(
      atSession(OUT, 0, "3000000", [asset(LJTEST, 2n * Q)]),
      atSession(OUT, 1, "40000000"),
      atSession(OUT, 2, "5000000"),
      ...POOL,
      ...strangers(t, VIEW.mixBoxHash, 6, 0x60, "2000000", asset(LJTEST, Q)),
    );
    // Change: none of its pools. Its ADA still goes through the classic pool; the token comes back with the return.
    const direct = await sessions.backBuild("preprod", 0, false, { [LJTEST]: null });
    expect(direct.lovejoin?.parts).toBeUndefined();
    expect(direct.lovejoin?.pool).toBeUndefined();
    expect(direct.lovejoin?.ways).toEqual([
      { policyId: VIEW.token.policyId, assetName: VIEW.token.assetName, boxes: 0, direct: true, pools: [TOKEN] },
    ]);
    expect(direct.tokens).toContainEqual({ policyId: VIEW.token.policyId, assetName: VIEW.token.assetName, quantity: (2n * Q).toString() });

    // A stranger's LJTEST at the account (a transaction the session didn't make): never into a pool.
    const s = await wallet();
    await s.deps.preferences.set({ lovejoinDepth: 1 });
    const sessions2 = runner(s, pooled(s, [TOKEN_POOL]));
    await siteSession(s);
    s.koios.addedToAccounts.push(
      atSession("cd".repeat(32), 0, "3000000", [asset(LJTEST, 2n * Q)]),
      atSession(OUT, 1, "40000000"),
      atSession(OUT, 2, "5000000"),
      ...POOL,
      ...strangers(s, VIEW.mixBoxHash, 6, 0x60, "2000000", asset(LJTEST, Q)),
    );
    const theirs = await sessions2.backBuild("preprod", 0);
    expect(theirs.lovejoin?.parts).toBeUndefined();
    expect(theirs.lovejoin?.ways).toBeUndefined();
    expect(theirs.lovejoin?.boxes).toBeGreaterThanOrEqual(1);
  });

  it("follows an approved swap: its fill's token into the pool approved, and no token into a pool its review didn't show", () => {
    const swap = { tokenIn: "lovelace", tokenOut: MIN_UNIT, amount: "10000000", amountOut: "1", minAmountOut: "1", slippage: 0.5 };
    const approved = { minAmountOut: "1", fund: { lovelace: "1", tokens: [] } };
    type Record = Parameters<typeof wayOf>[0];
    const swapping = (lovejoin?: object, fills?: string[]) =>
      ({ index: 0, createdAt: 0, txs: [], swap, auto: { approved, ...(lovejoin ? { lovejoin } : {}), ...(fills ? { fills } : {}) } }) as unknown as Record;
    // Approved with MIN's pool, four wide: the fill's MIN goes there, and nothing else into a pool.
    expect(wayOf(swapping({ depth: 2, delay: "1-6", width: 4, tokens: { [MIN_UNIT]: "aa".repeat(28) } }, ["f1".repeat(32)]))).toEqual({
      width: 4,
      returns: { tokens: { [MIN_UNIT]: "aa".repeat(28) }, only: true, fills: ["f1".repeat(32)] },
    });
    // Approved before token pools: three wide, and its tokens back directly, as they came.
    expect(wayOf(swapping({ depth: 2, delay: "1-6" }))).toEqual({ width: 3 });
    // From before approvals kept a way: three wide, as 1.5.0 went, and no token pools (34e's review, 10).
    expect(wayOf(swapping())).toEqual({ width: 3 });
    // Approved for so many boxes of its token: no more go into the pool, whatever the fill brought (34e's review, 10).
    expect(wayOf(swapping({ depth: 2, delay: "1-6", tokens: { [MIN_UNIT]: "aa".repeat(28) }, tokenBoxes: { [MIN_UNIT]: 2 } }))).toEqual({
      width: 3,
      returns: { tokens: { [MIN_UNIT]: "aa".repeat(28) }, only: true, most: { [MIN_UNIT]: 2 } },
    });
    // Brought back by hand, Change's choice stands, and a token it doesn't name takes its most used pool.
    expect(wayOf(swapping({ depth: 2, delay: "1-6", tokens: { [MIN_UNIT]: null } }), { [MIN_UNIT]: "bb".repeat(28) })).toEqual({
      width: 3,
      returns: { tokens: { [MIN_UNIT]: "bb".repeat(28) }, only: false },
    });
    // A site's session: Settings' width, each token into its most used pool, or Change's.
    const site = { index: 0, createdAt: 0, txs: [], site: { origin: "https://example.org" } } as unknown as Record;
    expect(wayOf(site)).toEqual({ returns: {} });
    expect(wayOf(site, { [LJTEST]: null })).toEqual({ returns: { tokens: { [LJTEST]: null } } });
    // A mix session: its one pool, at the width it was funded at.
    expect(wayOf({ index: 0, createdAt: 0, txs: [], mix: { boxes: 1, width: 4 } } as unknown as Record)).toEqual({ width: 4 });
    expect(wayOf({ index: 0, createdAt: 0, txs: [], mix: { boxes: 1 } } as unknown as Record)).toEqual({ width: 3 });
  });

  it("takes a review's choice of pools only in the shape it has", () => {
    const pool = "cd".repeat(28);
    expect(poolChoice({ [LJTEST]: pool, [MIN_UNIT]: null })).toEqual({ [LJTEST]: pool, [MIN_UNIT]: null });
    expect(poolChoice({ [LJTEST]: "not a pool", nonsense: pool, [MIN_UNIT]: 3 })).toBeUndefined();
    expect(poolChoice([pool])).toBeUndefined();
    expect(poolChoice("x")).toBeUndefined();
    expect(poolChoice(undefined)).toBeUndefined();
  });
});

/**
 * A MIN pool, 4.5 ₳ and 900 MIN a box, as the wallet's own start from the public account makes it: its reference
 * UTxO and its two scripts at the holder (named by their hashes, as the data layer names them), and its seed.
 */
function minPool(t: T, boxLovelace = "4500000", account: [string, string] = ["e1", "e5"]): Promise<{ ref: PoolRef; id: string; mixBox: string }> {
  return launched(t, boxLovelace, account, { token: { policyId: MIN.policy, assetName: MIN.name }, quantity: MIN_Q.toString() });
}

/** An ADA pool of `boxLovelace` boxes, started as minPool's is: a 5 ₳ one takes a return's collateral (the owner, 2026-10-22). */
function adaPool(t: T, boxLovelace = "5000000", account: [string, string] = ["e2", "e6"]): Promise<{ ref: PoolRef; id: string; mixBox: string }> {
  return launched(t, boxLovelace, account, {});
}

/** A pool of `token` (none: an ADA pool) with `boxLovelace` a box, started from the public account's `account` UTxOs. */
async function launched(
  t: T,
  boxLovelace: string,
  account: [string, string],
  what: { token?: { policyId: string; assetName: string }; quantity?: string },
): Promise<{ ref: PoolRef; id: string; mixBox: string }> {
  const wasm = loadTestWasm();
  t.koios.addedToAccounts.push(atAccount(account[0], "40000000"), atAccount(account[1], "5000000"));
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
  await launch.build("preprod", { from: "public", ...what, boxLovelace });
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
  // Its two scripts' outputs, told apart by what each holds.
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

// The owner's call 34 (2026-10-19, asked in session 5): where the wallet picks a token's pool itself, a pool whose boxes
// can't pay their own way back under today's fees is picked as any pool, and the review says so beside the token.
describe("a token's pool whose boxes can't pay their own way back, picked as any (the owner's call 34)", SLOW, () => {
  it("is a return's token's pool, and its way says the boxes wait", async () => {
    const t = await wallet();
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    // A byte dearer than preprod's: a 2 ₳ LJTEST box still meets its minimum, but can't pay its own way back.
    t.koios.params = { coins_per_utxo_size: "4800" };
    const lj = pooled(t, [TOKEN_POOL]);
    const sessions = runner(t, lj);
    await siteSession(t);
    t.koios.addedToAccounts.push(
      atSession(OUT, 0, "3000000", [asset(LJTEST, 2n * Q)]),
      atSession(OUT, 1, "40000000"),
      atSession(OUT, 2, "5000000"),
      ...POOL,
      ...strangers(t, VIEW.mixBoxHash, 6, 0x60, "2000000", asset(LJTEST, Q)),
    );
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoin?.ways?.[0]).toMatchObject({ pool: TOKEN, boxes: 2, stuck: true });
  });

  it("is a swap's token's pool, and its way says the boxes wait", async () => {
    const t = await wallet();
    const min = await minPool(t);
    t.koios.params = { coins_per_utxo_size: STUCK_MIN };
    const lj = pooled(t, [min.ref]);
    const sessions = runner(t, lj);
    const wasm = loadTestWasm();
    const datum = await t.wallet.withKeys((keys) => Buffer.from(wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister()))).toString("hex"));
    t.koios.added.push({ ...ownedUtxos[0]!, tx_hash: "d1".repeat(32), tx_index: 0, value: "100000000", inline_datum: { bytes: datum, value: {} } } as KoiosUtxo);
    t.koios.addedToAccounts.push(...POOL, ...strangers(t, min.mixBox, 8, 0x80, "4500000", asset(MIN_UNIT, MIN_Q)));
    const quote = await sessions.quote("preprod", minswapEstimate.ask);
    const out = await sessions.outBuild("preprod", quote);
    expect(out.lovejoin!.ways![0]).toMatchObject({ pool: min.id, boxes: 1, stuck: true });
    // Under preprod's own fees, the same pool's way says nothing of it.
    t.koios.params = undefined;
    const fine = await runner(t, pooled(t, [min.ref])).outBuild("preprod", quote);
    expect(fine.lovejoin!.ways![0]!.stuck).toBeUndefined();
  });
});

describe("a swap that gets a token with a pool (chunk 34's 34e, the owner's call, 2026-10-18)", SLOW, () => {
  it("funds its token's boxes beside the swap, and keeps the pool its review showed", async () => {
    const t = await wallet();
    const min = await minPool(t);
    const lj = pooled(t, [min.ref]);
    const sessions = runner(t, lj);
    // The private balance holds enough for the swap and a box of MIN.
    const wasm = loadTestWasm();
    const datum = await t.wallet.withKeys((keys) => Buffer.from(wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister()))).toString("hex"));
    t.koios.added.push({ ...ownedUtxos[0]!, tx_hash: "d1".repeat(32), tx_index: 0, value: "100000000", inline_datum: { bytes: datum, value: {} } } as KoiosUtxo);
    // The pools: the classic pool's, and eight strangers' boxes of MIN's, enough for a box two waves deep.
    t.koios.addedToAccounts.push(...POOL, ...strangers(t, min.mixBox, 8, 0x80, "4500000", asset(MIN_UNIT, MIN_Q)));
    const quote = await sessions.quote("preprod", minswapEstimate.ask);
    const out = await sessions.outBuild("preprod", quote);
    const way = out.lovejoin!.ways![0]!;
    // The least the swap asks for, 902.08 MIN, makes one box of 900.
    expect(way).toMatchObject({ policyId: MIN.policy, assetName: MIN.name, pool: min.id, quantity: MIN_Q.toString(), boxes: 1, pools: [min.id] });
    expect(way.mixes).toBe(4);
    // What its box takes is funded too, beside the swap's own: the box's 4.5 ₳, its mixes and the deposit's reserve.
    const funded = (await lj.funding("preprod", 1, false, 2, min.id)).lovelace;
    expect(out.lovejoin!.fund).toBe(funded);
    expect(BigInt(out.payments[0]!.lovelace)).toBe(BigInt(quote.fund.lovelace) + BigInt(funded));
    // Sent, its approval keeps that pool for MIN, and the swap's own funding as it was quoted.
    await sessions.outSubmit("preprod", out.txHash);
    const book = (await t.store.get<{ sessions: Array<{ auto: { approved: { fund: { lovelace: string } }; lovejoin?: { tokens?: unknown } } }> }>("sessions.preprod"))!;
    expect(book.sessions[0]!.auto.lovejoin?.tokens).toEqual({ [MIN_UNIT]: min.id });
    expect(book.sessions[0]!.auto.approved.fund.lovelace).toBe(quote.fund.lovelace);

    // Change, none: nothing more is funded, and its approval says MIN comes back directly.
    const none = await sessions.outBuild("preprod", quote, undefined, { [MIN_UNIT]: null });
    expect(none.lovejoin?.fund).toBeUndefined();
    expect(none.lovejoin?.ways?.[0]).toMatchObject({ boxes: 0, direct: true });
    expect(BigInt(none.payments[0]!.lovelace)).toBe(BigInt(quote.fund.lovelace));
  });

  it("takes the fill's token into the pool approved, the rest back with the return", async () => {
    const t = await wallet();
    const min = await minPool(t);
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    const lj = pooled(t, [min.ref, TOKEN_POOL]);
    const sessions = runner(t, lj);
    const fill = "f1".repeat(32);
    // A swap approved with MIN's pool: its fill (a batcher's transaction) brought 902.08 MIN, and a stranger's LJTEST
    // came in the same transaction, which no review named.
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: t.clock.now,
          txs: [{ kind: "out", txHash: OUT, at: t.clock.now, confirmed: true }],
          swap: { ...minswapEstimate.ask, amountOut: "906594100", minAmountOut: "902083681" },
          auto: {
            approved: { minAmountOut: "902083681", fund: { lovelace: "16000000", tokens: [] } },
            direct: false,
            lovejoin: { depth: 1, delay: "1-6", tokens: { [MIN_UNIT]: min.id } },
            filled: t.clock.now,
            fills: [fill],
          },
        },
      ],
    });
    t.koios.addedToAccounts.push(
      atSession(fill, 0, "2000000", [asset(MIN_UNIT, 902_083_681n)]),
      atSession(fill, 1, "3000000", [asset(LJTEST, Q)]),
      atSession(OUT, 0, "12000000"),
      atSession(OUT, 1, "5000000"),
      ...POOL,
      ...strangers(t, min.mixBox, 2, 0x80, "4500000", asset(MIN_UNIT, MIN_Q)),
      ...strangers(t, VIEW.mixBoxHash, 2, 0x60, "2000000", asset(LJTEST, Q)),
    );
    const review = await sessions.backBuild("preprod", 0);
    // One box of MIN, in its pool; LJTEST, which its review never showed, comes back directly.
    expect(review.lovejoin?.parts?.[0]).toEqual({ pool: min.id, boxes: 1 });
    // Each told: MIN in its pool; LJTEST back directly, as its approval had none for it, though a pool of it takes a box.
    const ways = Object.fromEntries(review.lovejoin!.ways!.map((w) => [w.policyId + w.assetName, w]));
    expect(ways[MIN_UNIT]).toMatchObject({ pool: min.id, boxes: 1 });
    expect(ways[LJTEST]).toEqual({ policyId: VIEW.token.policyId, assetName: VIEW.token.assetName, boxes: 0, direct: true, pools: [TOKEN] });
    const tokens = Object.fromEntries(review.tokens.map((x) => [x.policyId + x.assetName, x.quantity]));
    expect(tokens[MIN_UNIT]).toBe((902_083_681n - MIN_Q).toString());
    expect(tokens[LJTEST]).toBe(Q.toString());
    const deposit = (await kept(t)).chain![0]!;
    expect(txInputs(Buffer.from(deposit.txCbor, "hex"))).toContain(`${fill}#0`);
    expect(txInputs(Buffer.from(deposit.txCbor, "hex"))).not.toContain(`${fill}#1`);
  });
});

describe("four boxes a mix (chunk 34's D3)", SLOW, () => {
  /** The public account, ready to mix: a large UTxO and its collateral. */
  const account = (t: T) => t.koios.addedToAccounts.push(atAccount("e1", "200000000"), atAccount("e5", "5000000"), ...POOL);

  it("mixes four at a time where Settings has it, two of them in flight at once", async () => {
    const t = await wallet();
    await t.deps.preferences.set({ lovejoinWidth: 4, lovejoinDepth: 1 });
    const lj = pooled(t, []);
    account(t);
    const summary = await lj.publicBuild("preprod", 2);
    expect(summary).toMatchObject({ boxes: 2, depth: 1, mixes: 2, txs: 3, width: 4 });
    expect(summary.fellBack).toBeUndefined();
    await lj.publicSubmit("preprod", summary.txHash);
    // Two of its three transactions sent, the deposit and a mix, and the rest waits for the window.
    expect(t.koios.submitted).toHaveLength(2);
    const sending = await t.wallet.withKeys(() => t.session.get<ChainProgress>(SESSION_LOVEJOIN_SENDING + "preprod"));
    expect(sending?.window).toBe(CHAIN_WINDOW_FOUR);
    expect(sending?.next).toBe(2);
    // Four boxes in its mix: the wallet's and three of the pool's.
    const mix = t.koios.submitted.find((tx) => txInputs(tx).some((o) => CLASSIC_BOXES.has(o)))!;
    expect(txInputs(mix).filter((o) => CLASSIC_BOXES.has(o))).toHaveLength(3);
    expect((await sealed(t)).chains.at(-1)!.width).toBe(4);
  });

  it("goes three at a time when the pool hasn't room for four, and says so", async () => {
    const t = await wallet();
    await t.deps.preferences.set({ lovejoinWidth: 4, lovejoinDepth: 2 });
    const lj = pooled(t, []);
    account(t);
    // Two boxes two waves deep: four a mix draws 30 of the pool's 20, three a mix 16.
    const summary = await lj.publicBuild("preprod", 2);
    expect(summary.width).toBeUndefined();
    expect(summary).toMatchObject({ boxes: 2, mixes: 8, fellBack: tr("lj.width.warn.short") });
    await lj.publicSubmit("preprod", summary.txHash);
    const sending = await t.wallet.withKeys(() => t.session.get<ChainProgress>(SESSION_LOVEJOIN_SENDING + "preprod"));
    expect(sending?.window).toBeUndefined();
    expect((await sealed(t)).chains.at(-1)!.width).toBeUndefined();
  });

  it("goes three at a time when four doesn't build, and says so", async () => {
    const t = await wallet();
    await t.deps.preferences.set({ lovejoinWidth: 4, lovejoinDepth: 1 });
    const wasm = loadTestWasm();
    const lj = new LovejoinService({
      ...t.deps,
      wasm: {
        ...wasm,
        buildLovejoinFromAccount: (account: Parameters<typeof wasm.buildLovejoinFromAccount>[0], key: Parameters<typeof wasm.buildLovejoinFromAccount>[1], request: string) => {
          if ((JSON.parse(request) as { width?: number }).width === 4) throw new Error("Mixing 4 boxes at once needs more computation than a transaction may use");
          return wasm.buildLovejoinFromAccount(account, key, request);
        },
      } as typeof wasm,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
      store: t.store,
      pools: async () => [],
      random: () => 0.5,
    });
    account(t);
    const summary = await lj.publicBuild("preprod", 1);
    expect(summary.width).toBeUndefined();
    expect(summary.fellBack).toBe(tr("lj.width.warn.refused"));
  });

  it("funds a mix from the private balance for four, and its chain goes four wide whatever Settings says since", async () => {
    const t = await wallet();
    await t.deps.preferences.set({ lovejoinWidth: 4, lovejoinDepth: 1 });
    const lj = pooled(t, []);
    const sessions = runner(t, lj);
    t.koios.addedToAccounts.push(...POOL);
    const out = await sessions.mixOutBuild("preprod", 1);
    expect(out.mix).toMatchObject({ boxes: 1, depth: 1, width: 4 });
    expect(out.mix.lovelace).toBe((1_500_000 + 10_000_000 + 1_350_000).toString());
    const { index } = await sessions.mixOutSubmit("preprod", out.txHash);
    const book = (await t.store.get<{ sessions: Array<{ mix?: { width?: number } }> }>("sessions.preprod"))!;
    expect(book.sessions[0]!.mix?.width).toBe(4);
    // Settings goes back to three; the funding lands, and the session runs.
    await t.deps.preferences.set({ lovejoinWidth: 3 });
    t.koios.addedToAccounts.push(atSession(out.txHash, 0, out.mix.lovelace), atSession(out.txHash, 1, "5000000"));
    t.koios.confirmations = 1;
    const before = t.koios.submitted.length;
    await sessions.advance("preprod", index, true);
    const mix = t.koios.submitted.slice(before).find((tx) => txInputs(tx).some((o) => CLASSIC_BOXES.has(o)))!;
    expect(txInputs(mix).filter((o) => CLASSIC_BOXES.has(o))).toHaveLength(3);
  });

  it("follows the form's Four boxes a mix switch over Settings, either way (the owner's test of 1.6.0)", async () => {
    const t = await wallet();
    await t.deps.preferences.set({ lovejoinWidth: 3, lovejoinDepth: 1 });
    const lj = pooled(t, []);
    const sessions = runner(t, lj);
    account(t);
    // Settings at three, the switch on: four.
    expect(await lj.fits("preprod", 1, undefined, 4)).toEqual({ width: 4 });
    expect((await sessions.mixOutBuild("preprod", 1, { width: 4 })).mix.width).toBe(4);
    expect((await lj.publicBuild("preprod", 1, { width: 4 })).width).toBe(4);
    // Settings at four, the switch off: three, with nothing to say of four.
    await t.deps.preferences.set({ lovejoinWidth: 4 });
    expect(await lj.fits("preprod", 1, undefined, 3)).toBeUndefined();
    const three = await lj.publicBuild("preprod", 1, { width: 3 });
    expect(three.width).toBeUndefined();
    expect(three.fellBack).toBeUndefined();
    // And the form's funding, priced at the switch's width, not capped at Settings'.
    await t.deps.preferences.set({ lovejoinWidth: 3 });
    expect((await lj.funding("preprod", 1, false, 1, undefined, 4)).width).toBe(4);
  });

  it("refuses no tile mix for the width: what four can't take, three does", async () => {
    const t = await wallet();
    await t.deps.preferences.set({ lovejoinWidth: 4, lovejoinDepth: 2 });
    const lj = pooled(t, []);
    t.koios.addedToAccounts.push(...POOL);
    // One box: four a mix takes 15 others; two: 30, more than the pool's 20, so three, which takes 16.
    expect(await lj.fits("preprod", 1)).toEqual({ width: 4 });
    expect(await lj.fits("preprod", 2)).toEqual({ width: 3, fellBack: tr("lj.width.warn.short") });
    // Three wide, as before: nothing to say.
    await t.deps.preferences.set({ lovejoinWidth: 3 });
    expect(await lj.fits("preprod", 2)).toBeUndefined();
    // The funding at four is dearer: five mixes a box, at four's estimate.
    expect((await lj.funding("preprod", 1, false, 2, undefined, 4)).lovelace).toBe((1_500_000 + 10_000_000 + 5 * 1_350_000).toString());
    expect((await lj.funding("preprod", 1, false, 2)).lovelace).toBe((1_500_000 + 10_000_000 + 4 * 950_000).toString());
  });

  it("keeps a four-wide chain's sends two in the mempool at once", async () => {
    const chain = (window?: number): ChainProgress => ({
      txs: Array.from({ length: 6 }, (_, i) => ({ kind: "mix" as const, txCbor: "", txHash: i.toString(16).repeat(64), fee: "0" })),
      next: 0,
      flying: [],
      ...(window ? { window } : {}),
    });
    for (const [window, sent] of [
      [undefined, CHAIN_WINDOW],
      [CHAIN_WINDOW_FOUR, 2],
    ] as const) {
      const c = chain(window);
      const io = { send: async () => undefined, onChain: async () => new Set<string>(), save: async () => undefined, sleep: async () => undefined, now: () => 0 };
      expect(await pumpChain(c, io, 0)).toBe(false);
      expect(c.next).toBe(sent);
      expect(c.flying).toHaveLength(sent);
    }
  });
});

describe("every pool's room in one read (chunk 34's 34e)", SLOW, () => {
  it("reads every pool the wallet reads at once, as any read does, and keeps it for a review", async () => {
    const t = await wallet();
    const lj = pooled(t, [TOKEN_POOL]);
    t.koios.addedToAccounts.push(...POOL, ...strangers(t, VIEW.mixBoxHash, 5, 0x60, "2000000", asset(LJTEST, Q)));
    const reads = () => t.koios.calls.filter((c) => c.path === "credential_utxos").length;
    const before = reads();
    expect(await lj.room("preprod", TOKEN)).toEqual({ others: 5, free: 5 });
    expect(await lj.room("preprod")).toEqual({ others: POOL.length, free: POOL.length });
    expect(reads() - before).toBe(1);
    const boxes = [NETWORKS.preprod.lovejoin!.mixBox, VIEW.mixBoxHash].sort();
    const read = t.koios.calls.filter((c) => c.path === "credential_utxos").at(-1)!;
    expect([...(read.body._payment_credentials as string[])].sort()).toEqual(boxes);
  });
});

/** Ogmios's answer when a script a transaction runs fails there: the network measures it differently. */
const REFUSED = {
  jsonrpc: "2.0",
  method: "evaluateTransaction",
  error: { code: 3010, message: "Some scripts of the transactions terminated with error(s).", data: [] },
};

/** A box of the wallet's own in the classic pool, which Koios says a mix made (what the wallet asks of a box no record accounts for). */
async function ownBox(t: T, tx: string): Promise<KoiosUtxo> {
  const wasm = loadTestWasm();
  const datum = await t.wallet.withKeys((keys) => Buffer.from(wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister()))).toString("hex"));
  t.koios.txSpends.set(tx.repeat(32), [{ payment_addr: { bech32: POOL[0]!.address, cred: NETWORKS.preprod.lovejoin!.mixBox } }]);
  return { ...POOL[0]!, tx_hash: tx.repeat(32), tx_index: 0, inline_datum: { bytes: datum, value: {} } } as KoiosUtxo;
}

/** Session 0, the recorded swap of ADA for MIN approved through Lovejoin as `lovejoin` has it; `auto`, more of its record. */
async function approvedSwap(t: T, lovejoin: object, auto: object = {}): Promise<void> {
  await t.store.set("sessions.preprod", {
    next: 1,
    sessions: [
      {
        index: 0,
        ownStake: true,
        createdAt: t.clock.now,
        txs: [{ kind: "out", txHash: OUT, at: t.clock.now, confirmed: true }],
        swap: { ...minswapEstimate.ask, amountOut: "906594100", minAmountOut: "902083681" },
        auto: { approved: { minAmountOut: "902083681", fund: { lovelace: "40000000", tokens: [] } }, direct: false, lovejoin, ...auto },
      },
    ],
  });
}

/** The wallet's private balance holding `lovelace` more, in one UTxO of its own. */
async function privately(t: T, lovelace: string): Promise<void> {
  const wasm = loadTestWasm();
  const datum = await t.wallet.withKeys((keys) => Buffer.from(wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister()))).toString("hex"));
  t.koios.added.push({ ...ownedUtxos[0]!, tx_hash: "d1".repeat(32), tx_index: 0, value: lovelace, inline_datum: { bytes: datum, value: {} } } as KoiosUtxo);
}

describe("34e's review findings, each with a test", SLOW, () => {
  it("mixes a return's ADA through the classic pool when its token's pool refuses the mix, and says why the token comes back (1)", async () => {
    const t = await wallet();
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    const sessions = runner(t, pooled(t, [TOKEN_POOL]));
    await siteSession(t);
    const tokenBoxes = strangers(t, VIEW.mixBoxHash, 6, 0x60, "2000000", asset(LJTEST, Q));
    t.koios.addedToAccounts.push(
      atSession(OUT, 0, "3000000", [asset(LJTEST, 2n * Q)]),
      atSession(OUT, 1, "40000000"),
      atSession(OUT, 2, "5000000"),
      ...POOL,
      ...tokenBoxes,
    );
    // The network refuses any mix in the token pool: it measures its scripts differently.
    const theirs = new Set(tokenBoxes.map((u) => `${u.tx_hash}#${u.tx_index}`));
    const draws = (cbor: string) => txInputs(Buffer.from(cbor, "hex")).some((o) => theirs.has(o));
    t.koios.evaluation = (body: { params: { transaction: { cbor: string } } }) => (draws(body.params.transaction.cbor) ? REFUSED : AGREES);
    const review = await sessions.backBuild("preprod", 0);
    // As 1.5.0 would have, the ADA still goes through Lovejoin, in the classic pool alone.
    expect(review.lovejoinSkipped).toBeUndefined();
    expect(review.lovejoin!.boxes).toBeGreaterThanOrEqual(1);
    expect(review.lovejoin?.parts).toBeUndefined();
    expect(review.lovejoin?.ways).toEqual([
      {
        policyId: VIEW.token.policyId,
        assetName: VIEW.token.assetName,
        pool: TOKEN,
        quantity: Q.toString(),
        boxes: 0,
        pools: [TOKEN],
        skipped: tr("lj.tokens.skip.warn.failed"),
      },
    ]);
    // The token comes back with the return; no transaction of the chain draws a box of its pool.
    expect(review.tokens).toContainEqual({ policyId: VIEW.token.policyId, assetName: VIEW.token.assetName, quantity: (2n * Q).toString() });
    for (const tx of (await kept(t)).chain!) expect(draws(tx.txCbor)).toBe(false);
  });

  it("brings a swap's token back directly when the private balance pays for the swap but not its boxes, rather than refuse the swap (2)", async () => {
    const t = await wallet();
    const min = await minPool(t);
    const sessions = runner(t, pooled(t, [min.ref]));
    t.koios.addedToAccounts.push(...POOL, ...strangers(t, min.mixBox, 8, 0x80, "4500000", asset(MIN_UNIT, MIN_Q)));
    // The private balance as the fakes have it, about 29.5 ₳: the swap, its collateral and the fee, as 1.5.0 funded
    // it, but not a box of MIN beside them, about 9.8 ₳ more.
    const quote = await sessions.quote("preprod", minswapEstimate.ask);
    const out = await sessions.outBuild("preprod", quote);
    expect(out.lovejoin?.fund).toBeUndefined();
    expect(BigInt(out.payments[0]!.lovelace)).toBe(BigInt(quote.fund.lovelace));
    expect(out.lovejoin!.ways![0]).toMatchObject({ pool: min.id, boxes: 0, mixes: 0, skipped: tr("lj.tokens.skip.warn.balance") });
    // Its approval has MIN come back directly, as the review said.
    await sessions.outSubmit("preprod", out.txHash);
    const book = (await t.store.get<{ sessions: Array<{ auto: { lovejoin?: { tokens?: unknown } } }> }>("sessions.preprod"))!;
    expect(book.sessions[0]!.auto.lovejoin?.tokens).toEqual({ [MIN_UNIT]: null });
  });

  it("mixes again four a mix with the boxes that fit at four, the rest for the next press (the owner's test of 1.6.0)", async () => {
    const t = await wallet();
    await t.deps.preferences.set({ lovejoinWidth: 4, lovejoinDepth: 2 });
    const sessions = runner(t, pooled(t, []));
    t.koios.addedToAccounts.push(...POOL, await ownBox(t, "d6"), await ownBox(t, "d7"));
    // Two boxes two waves deep: four a mix takes 15 of the pool's 20 for each, so one; three takes 8 each, so both.
    // Four went three, both boxes; four now goes, with one, and says three would take two.
    const out = await sessions.againBuild("preprod");
    expect(out.mix).toMatchObject({ boxes: 1, owned: 2, again: true, depth: 2, mixes: 5, width: 4, atThree: 2 });
    expect(out.mix.fellBack).toBeUndefined();
    // The review's switch turned to three: both, three a mix, as Settings' three would.
    const three = await sessions.againBuild("preprod", false, undefined, 3);
    expect(three.mix).toMatchObject({ boxes: 2, owned: 2, mixes: 8, lovelace: "9100000" });
    expect(three.mix.width).toBeUndefined();
    expect(three.mix.atThree).toBeUndefined();
  });

  it("funds Mix my boxes again at three where four takes none, whatever Settings says (4)", async () => {
    const t = await wallet();
    await t.deps.preferences.set({ lovejoinWidth: 4, lovejoinDepth: 2 });
    const sessions = runner(t, pooled(t, []));
    // Twelve in the pool: four a mix needs 15 for a box, three 8.
    t.koios.addedToAccounts.push(...POOL.slice(0, 12), await ownBox(t, "d6"), await ownBox(t, "d7"));
    const out = await sessions.againBuild("preprod");
    expect(out.mix).toMatchObject({ boxes: 1, owned: 2, again: true, depth: 2, mixes: 4, fellBack: tr("lj.width.warn.short") });
    expect(out.mix.width).toBeUndefined();
  });

  it("prices a swap's return at three where four can't take what three would, as the return goes (5)", async () => {
    // Stop: the 40 ₳ funded pays two boxes either way, and twelve of the pool's boxes have room for one at three, none at four.
    const t = await wallet();
    const sessions = runner(t, pooled(t, []));
    await approvedSwap(t, { depth: 2, delay: "1-6", width: 4 });
    t.koios.addedToAccounts.push(...POOL.slice(0, 12));
    const stop = (await sessions.stopCost("preprod", 0))!;
    expect(stop.skipped).toBeUndefined();
    expect(stop).toMatchObject({ boxes: 1, of: 2, mixes: 4, fellBack: tr("lj.width.warn.short") });
    expect(stop.width).toBeUndefined();

    // The review: a stop's 16 ₳ pays no box four a mix, one three a mix, which its return makes.
    const s = await wallet();
    await s.deps.preferences.set({ lovejoinWidth: 4 });
    const reviewing = runner(s, pooled(s, []));
    s.koios.addedToAccounts.push(...POOL);
    const quote = await reviewing.quote("preprod", minswapEstimate.ask);
    const out = await reviewing.outBuild("preprod", quote);
    expect(out.lovejoin?.ifStopped).toMatchObject({ boxes: 1, mixes: 4, fellBack: tr("lj.width.warn.cost") });
  });

  it("offers a return's collateral by what three a mix pays for, the width four falls back to (6)", async () => {
    const t = await wallet();
    await t.deps.preferences.set({ lovejoinWidth: 4 });
    const sessions = runner(t, pooled(t, []));
    await siteSession(t);
    // 16 ₳ and no 5 ₳ to put up: a box two waves deep takes 15.3 ₳ three a mix, 18.25 ₳ four.
    t.koios.addedToAccounts.push(atSession(OUT, 0, "16000000"), ...POOL);
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoinSkipped).toBe(tr("sess.skip.warn.noCollateral"));
  });

  it("goes three when neither width has room, so a refusal says what three needs (7)", async () => {
    const t = await wallet();
    await t.deps.preferences.set({ lovejoinWidth: 4, lovejoinDepth: 2 });
    const lj = pooled(t, []);
    // One box of the wallet's and seven others: a box two waves deep needs 8 others three a mix, 15 four.
    t.koios.addedToAccounts.push(...POOL.slice(0, 7), await ownBox(t, "d6"));
    await expect(lj.againBoxes("preprod")).rejects.toThrow(
      tr("lj.notEnough", { others: 7, count: 1, deep: tr("sess.skip.warn.deep", { count: 2 }), needed: 8 }),
    );
    // A session's return into the same pool says three's need too.
    const sessions = runner(t, lj);
    await siteSession(t);
    t.koios.addedToAccounts.push(atSession(OUT, 0, "40000000"), atSession(OUT, 1, "5000000"));
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoinSkipped).toBe(tr("lj.skip.warn.needsMore", { others: 7, needed: 8 }));
  });

  it("asks for no pool list as the user types a swap, nor for a return whose spare ADA pays for no box (9)", async () => {
    const t = await wallet();
    const min = await minPool(t);
    let listed = 0;
    const lj = pooled(t, [min.ref], {
      pools: async () => {
        listed++;
        return [min.ref];
      },
      known: async () => [min.ref],
    });
    const sessions = runner(t, lj);
    t.koios.addedToAccounts.push(...POOL, ...strangers(t, min.mixBox, 8, 0x80, "4500000", asset(MIN_UNIT, MIN_Q)));
    // As the user types, the token's pool is named from what the wallet holds already.
    const quote = await sessions.quote("preprod", minswapEstimate.ask);
    expect(quote.lovejoin?.ways?.[0]).toMatchObject({ pool: min.id, boxes: 1 });
    expect(listed).toBe(0);
    // A site's session holding a box's worth of MIN and no spare ADA: no list asked for, and no pool read.
    await siteSession(t);
    t.koios.addedToAccounts.push(atSession(OUT, 0, "2000000", [asset(MIN_UNIT, MIN_Q)]), atSession(OUT, 1, "5000000"));
    const poolReads = () => t.koios.calls.filter((c) => c.path === "credential_utxos" && c.body._payment_credentials.includes(min.mixBox)).length;
    const reads = poolReads();
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoin).toBeUndefined();
    expect(listed).toBe(0);
    expect(poolReads()).toBe(reads);
  });

  it("reads the parameters once at a swap's review: for its funding, and whether a pool of its token takes a box (9)", async () => {
    const t = await wallet();
    const min = await minPool(t);
    const sessions = runner(t, pooled(t, [min.ref]));
    await privately(t, "100000000");
    t.koios.addedToAccounts.push(...POOL, ...strangers(t, min.mixBox, 8, 0x80, "4500000", asset(MIN_UNIT, MIN_Q)));
    const quote = await sessions.quote("preprod", minswapEstimate.ask);
    const params = () => t.koios.calls.filter((c) => c.path === "epoch_params").length;
    const before = params();
    const out = await sessions.outBuild("preprod", quote);
    expect(out.lovejoin!.ways![0]).toMatchObject({ pool: min.id, boxes: 1 });
    expect(params() - before).toBe(1);
  });

  it("takes no more of a swap's token into its pool than its review showed, whatever its fill brought (10)", async () => {
    const t = await wallet();
    const min = await minPool(t);
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    const sessions = runner(t, pooled(t, [min.ref]));
    const fill = "f1".repeat(32);
    // Approved for one box of MIN; the fill brought two boxes' worth, and the ADA pays for both.
    await approvedSwap(
      t,
      { depth: 1, delay: "1-6", tokens: { [MIN_UNIT]: min.id }, tokenBoxes: { [MIN_UNIT]: 1 } },
      { filled: t.clock.now, fills: [fill] },
    );
    t.koios.addedToAccounts.push(
      atSession(fill, 0, "2000000", [asset(MIN_UNIT, 2n * MIN_Q)]),
      atSession(OUT, 0, "30000000"),
      atSession(OUT, 1, "5000000"),
      ...POOL,
      ...strangers(t, min.mixBox, 4, 0x80, "4500000", asset(MIN_UNIT, MIN_Q)),
    );
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoin?.parts?.[0]).toEqual({ pool: min.id, boxes: 1 });
    const tokens = Object.fromEntries(review.tokens.map((x) => [x.policyId + x.assetName, x.quantity]));
    expect(tokens[MIN_UNIT]).toBe(MIN_Q.toString());
  });
});

describe("34e's fixes' review, each with a test", SLOW, () => {
  it("brings a swap's token back directly when its boxes beside the swap can't be funded for any reason of Lovejoin's, and refuses a swap its balance can't pay (1)", async () => {
    const t = await wallet();
    const min = await minPool(t);
    let swap = "";
    const amounts = new Set<string>();
    const wasm = loadTestWasm();
    let why = "Spending 30 UTxOs at once needs more computation than a transaction may use";
    const sessions = runner(t, pooled(t, [min.ref]), {
      // The funding with the token's boxes beside the swap takes more of the private balance's UTxOs than its parts
      // can spend (a funding goes in parts since the owner's test of 1.6.0); the swap's own fits.
      buildWithdrawParts: (key: Parameters<typeof wasm.buildWithdrawParts>[0], request: string) => {
        const amount = (JSON.parse(request) as { payments: Array<{ lovelace: string }> }).payments[0]!.lovelace;
        amounts.add(amount);
        if (why.startsWith("Not enough") || BigInt(amount) > BigInt(swap)) throw new Error(why);
        return wasm.buildWithdrawParts(key, request);
      },
    });
    await privately(t, "100000000");
    t.koios.addedToAccounts.push(...POOL, ...strangers(t, min.mixBox, 8, 0x80, "4500000", asset(MIN_UNIT, MIN_Q)));
    const quote = await sessions.quote("preprod", minswapEstimate.ask);
    swap = quote.fund.lovelace;
    const out = await sessions.outBuild("preprod", quote);
    expect(out.lovejoin?.fund).toBeUndefined();
    expect(out.lovejoin!.ways![0]).toMatchObject({ pool: min.id, boxes: 0, skipped: tr("lj.tokens.skip.warn.balance") });
    expect(BigInt(out.payments[0]!.lovelace)).toBe(BigInt(swap));
    // The swap's own funding refused too: refused as before, its boxes tried first.
    why = "Not enough ADA in the Seedelf balance for this, its fee and the change";
    amounts.clear();
    await expect(sessions.outBuild("preprod", quote)).rejects.toThrow(tr("sess.notEnoughPrivate"));
    expect(amounts.size).toBe(2);
  });

  it("counts a swap's token boxes' ADA in what Stop brings back through Lovejoin (5)", async () => {
    const t = await wallet();
    const sessions = runner(t, pooled(t, []));
    // 40 ₳ for the swap and 15.3 ₳ for its token's boxes, one wave deep: 3 boxes of 10.95 ₳ without the boxes' ADA, 4 with it.
    await approvedSwap(t, { depth: 1, delay: "1-6", fund: "15300000" });
    t.koios.addedToAccounts.push(...POOL);
    expect((await sessions.stopCost("preprod", 0))!.boxes).toBe(4);
  });

  it("prices a funding named no pool, as a page may send it, in the classic pool (6)", async () => {
    const t = await wallet();
    const lj = pooled(t, []);
    expect(await lj.funding("preprod", 1, false, undefined, null as never)).toEqual(await lj.funding("preprod", 1));
  });

  it("looks for a box in a token's cheapest pool before reading the pools, as the most used may be any of them (7)", async () => {
    const t = await wallet();
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    // Two MIN pools: the first shown 8 ₳ a box, the other 4.5 ₳, used more.
    const dear = await minPool(t, "8000000");
    t.koios.addedToAccounts = t.koios.addedToAccounts.filter((u) => ![`e1`, `e5`].some((x) => u.tx_hash === x.repeat(32)));
    const cheap = await minPool(t, "4500000", ["e2", "e6"]);
    const sessions = runner(t, pooled(t, [dear.ref, cheap.ref]));
    await siteSession(t);
    // 900 MIN and 8 ₳: a box of the cheap pool (4.5 ₳ and a mix), none of the dear one's nor the classic pool's.
    t.koios.addedToAccounts.push(
      atSession(OUT, 0, "2000000", [asset(MIN_UNIT, MIN_Q)]),
      atSession(OUT, 1, "8000000"),
      atSession(OUT, 2, "5000000"),
      ...POOL,
      ...strangers(t, dear.mixBox, 2, 0x90, "8000000", asset(MIN_UNIT, MIN_Q)),
      ...strangers(t, cheap.mixBox, 3, 0x80, "4500000", asset(MIN_UNIT, MIN_Q)),
    );
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoin?.parts?.[0]).toEqual({ pool: cheap.id, boxes: 1 });
  });

  it("funds a tile's mix at the width the pool check chose, though Settings changes meanwhile (4)", async () => {
    const t = await wallet();
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    const lj = pooled(t, []);
    const sessions = runner(t, lj);
    t.koios.addedToAccounts.push(...POOL);
    // Settings goes to four just after the pool check found three: the funding is three's still.
    const fits = lj.fits.bind(lj);
    lj.fits = async (...args: Parameters<typeof lj.fits>) => {
      const way = await fits(...args);
      await t.deps.preferences.set({ lovejoinWidth: 4 });
      return way;
    };
    const out = await sessions.mixOutBuild("preprod", 1);
    expect(out.mix.width).toBeUndefined();
    expect(out.mix.lovelace).toBe((1_500_000 + 10_000_000 + 950_000).toString());
  });
});

describe("what the screens read of the planner (chunk 34's 34f)", SLOW, () => {
  it("builds a swap's funding with its switch off with no token boxes, and names each pool's box value when on", async () => {
    const t = await wallet();
    const min = await minPool(t);
    const sessions = runner(t, pooled(t, [min.ref]));
    const wasm = loadTestWasm();
    const datum = await t.wallet.withKeys((keys) => Buffer.from(wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister()))).toString("hex"));
    t.koios.added.push({ ...ownedUtxos[0]!, tx_hash: "d1".repeat(32), tx_index: 0, value: "100000000", inline_datum: { bytes: datum, value: {} } } as KoiosUtxo);
    t.koios.addedToAccounts.push(...POOL, ...strangers(t, min.mixBox, 8, 0x80, "4500000", asset(MIN_UNIT, MIN_Q)));
    const quote = await sessions.quote("preprod", minswapEstimate.ask);
    // On, as Settings has it: the pool's box value comes with it, for the approval's words and Change.
    const on = await sessions.outBuild("preprod", quote);
    expect(on.lovejoin?.on).toBe(true);
    expect(on.lovejoin?.values?.[min.id]).toEqual({ lovelace: "4500000", token: { policyId: MIN.policy, assetName: MIN.name, quantity: MIN_Q.toString() } });
    // The switch turned off, built again: nothing for the token's boxes, which would come back directly with the rest.
    const off = await sessions.outBuild("preprod", quote, undefined, undefined, false);
    expect(off.lovejoin?.on).toBe(false);
    expect(off.lovejoin?.fund).toBeUndefined();
    expect(off.lovejoin?.ways).toBeUndefined();
    expect(BigInt(off.payments[0]!.lovelace)).toBe(BigInt(quote.fund.lovelace));
    // And turned on again over Settings' off: funded as before.
    await t.deps.preferences.set({ lovejoinReturns: false });
    const again = await sessions.outBuild("preprod", quote, undefined, undefined, true);
    expect(again.lovejoin?.on).toBe(true);
    expect(again.lovejoin?.fund).toBe(on.lovejoin?.fund);
  });

  it("names the box value of each token pool a return's review shows", async () => {
    const t = await wallet();
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    const sessions = runner(t, pooled(t, [TOKEN_POOL]));
    await siteSession(t);
    t.koios.addedToAccounts.push(
      atSession(OUT, 0, "3000000", [asset(LJTEST, 2n * Q)]),
      atSession(OUT, 1, "40000000"),
      atSession(OUT, 2, "5000000"),
      ...POOL,
      ...strangers(t, VIEW.mixBoxHash, 6, 0x60, "2000000", asset(LJTEST, Q)),
    );
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoin?.parts?.[0]).toEqual({ pool: TOKEN, boxes: 2 });
    expect(review.lovejoin?.values).toEqual({ [TOKEN]: { lovelace: "2000000", token: VIEW.token } });
  });

  it("says a return whose only box would be a token's wants its collateral, as it does for an ADA box (34e, for 34f)", async () => {
    const t = await wallet();
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    const sessions = runner(t, pooled(t, [TOKEN_POOL]));
    await siteSession(t);
    // A box's worth of LJTEST and 6 ₳: a box of it (2 ₳, a mix and the deposit's reserve), never a 10 ₳ box; and no
    // 5 ₳ UTxO at the account for the mixes to put up.
    t.koios.addedToAccounts.push(
      atSession(OUT, 0, "3000000", [asset(LJTEST, Q)]),
      atSession(OUT, 1, "6000000"),
      ...POOL,
      ...strangers(t, VIEW.mixBoxHash, 6, 0x60, "2000000", asset(LJTEST, Q)),
    );
    const review = await sessions.backBuild("preprod", 0);
    // It comes back directly, and says it's for want of the collateral, which Put in 5 ₳ offers to fix.
    expect(review.lovejoin).toBeUndefined();
    expect(review.lovejoinSkipped).toBe(tr("sess.skip.warn.noCollateral"));
  });

  it("counts a swap's fill for that offer, in the pool its approval chose, and none its approval sent back (34f's review, 7)", async () => {
    const t = await wallet();
    const min = await minPool(t);
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    const sessions = runner(t, pooled(t, [min.ref]));
    const fill = "f1".repeat(32);
    const session = (tokens: Record<string, string | null>) => ({
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: t.clock.now,
          txs: [{ kind: "out", txHash: OUT, at: t.clock.now, confirmed: true }],
          swap: { ...minswapEstimate.ask, amountOut: "906594100", minAmountOut: "902083681" },
          auto: {
            approved: { minAmountOut: "902083681", fund: { lovelace: "16000000", tokens: [] } },
            direct: false,
            lovejoin: { depth: 1, delay: "1-6", tokens },
            filled: t.clock.now,
            fills: [fill],
          },
        },
      ],
    });
    // Its fill brought a box's worth of MIN; 8 ₳ at the account pays a MIN box (4.5 ₳, a mix and the reserve), not a
    // 10 ₳ one; and no 5 ₳ UTxO for the mixes.
    t.koios.addedToAccounts.push(
      atSession(fill, 0, "2000000", [asset(MIN_UNIT, 902_083_681n)]),
      atSession(OUT, 0, "8000000"),
      ...POOL,
      ...strangers(t, min.mixBox, 2, 0x80, "4500000", asset(MIN_UNIT, MIN_Q)),
    );
    await t.store.set("sessions.preprod", session({ [MIN_UNIT]: min.id }));
    expect((await sessions.backBuild("preprod", 0)).lovejoinSkipped).toBe(tr("sess.skip.warn.noCollateral"));
    // Approved to come back directly: no box of it is wanted, so no 5 ₳ for its mixes.
    await t.store.set("sessions.preprod", session({ [MIN_UNIT]: null }));
    expect((await sessions.backBuild("preprod", 0)).lovejoinSkipped).not.toBe(tr("sess.skip.warn.noCollateral"));
  });
});

// The owner's calls (2026-10-22 and 2026-10-23): a session's 5 ₳ collateral is mixed once on its way into a shown 5 ₳
// pool, rather than back with the rest under the session's history, wherever its return goes through Lovejoin. Its
// chain's mixes need it as collateral, so it goes last: a deposit puts it into a box, then one mix under giveme.my's
// collateral moves that box with two of other people's, once the deposit is on chain, and the return sweeps the rest.
describe("a return's 5 ₳ collateral mixed once into the 5 ₳ pool (the owner, 2026-10-23)", SLOW, () => {
  type Out = { index: number; address: string; value: { ada: { lovelace: number } }; datum?: string };
  type Step = { kind: string; txCbor: string; txHash: string; fee: string; tail?: true; giveme?: true };
  type TailRecord = {
    id: string;
    session?: number;
    leaves: Array<{ txHash: string; txIndex: number; pool?: string }>;
    tail?: { deposit: string; mix: string; pool: string; tries: number; scheduled?: true; over?: true; landed?: number };
    ended?: number;
  };
  type Schedule = {
    chains: TailRecord[];
    pools?: Record<string, { due: number[] }>;
    mixes?: Array<{ id: string; shares: Array<{ pool?: string; boxes: number }> }>;
  };
  /** What `txCbor` pays, each output as Ogmios has it. */
  const paid = (txCbor: string) => JSON.parse(loadTestWasm().ogmiosUtxos(txCbor)) as Out[];
  /** Pool `mixBox`'s address, where its boxes sit. */
  const boxAddress = (mixBox: string) => bech32("addr_test", Uint8Array.from([0x70, ...Buffer.from(mixBox, "hex")]));
  const schedule = async (t: T) => (await t.store.get<Schedule>("lovejoin.preprod"))!;
  const steps = async (t: T) => (await kept(t)).chain as Step[];
  const spent = (tx: { txCbor: string }) => txInputs(Buffer.from(tx.txCbor, "hex"));
  /** The box `step` made at `index` in pool `mixBox`, as Koios would list it there. */
  const listed = (step: Step, out: Out, mixBox: string): KoiosUtxo =>
    ({
      ...POOL[0]!,
      tx_hash: step.txHash,
      tx_index: out.index,
      address: out.address,
      payment_cred: mixBox,
      value: String(out.value.ada.lovelace),
      datum_hash: null,
      inline_datum: { bytes: out.datum!, value: {} },
      asset_list: [],
    }) as KoiosUtxo;

  /** A site's session holding `lovelace` and its 5 ₳ collateral, a 5 ₳ pool with two of other people's boxes. */
  async function setUp(lovelace = "40000000", others = 2) {
    const t = await wallet();
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    const five = await adaPool(t);
    const lj = pooled(t, [five.ref]);
    await siteSession(t);
    const theirs = strangers(t, five.mixBox, others, 0x81, "5000000");
    t.koios.addedToAccounts.push(atSession(OUT, 1, lovelace), atSession(OUT, 2, "5000000"), ...POOL, ...theirs);
    return { t, five, lj, theirs, sessions: runner(t, lj) };
  }

  it("goes last in a chain's return: its deposit, then its mix of two other people's boxes, then the return", async () => {
    const { t, five, theirs, sessions } = await setUp();
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoin!.boxes).toBeGreaterThanOrEqual(1);
    const chain = await steps(t);
    expect(chain.map((x) => x.kind)).toEqual(["deposit", ...Array(review.lovejoin!.mixes).fill("mix"), "deposit", "mix", "back"]);
    const [deposit, mix, back] = chain.slice(-3) as [Step, Step, Step];
    expect(deposit.tail && !deposit.giveme).toBe(true);
    expect(mix.tail && mix.giveme).toBe(true);
    expect(chain.slice(0, -3).some((x) => x.tail || x.giveme)).toBe(false);
    expect(review.collateralTail).toMatchObject({ box: { txHash: deposit.txHash }, leaf: { txHash: mix.txHash }, pool: five.id });
    // The deposit spends the session's 5 ₳ and pays it into a box alone at the 5 ₳ pool's mix_box.
    expect(spent(deposit)).toContain(`${OUT}#2`);
    const box = paid(deposit.txCbor).find((o) => o.index === review.collateralTail!.box.txIndex)!;
    expect(box.address).toBe(boxAddress(five.mixBox));
    expect(box.value.ada.lovelace).toBe(5_000_000);
    // The mix takes it and the two others; the return takes the mix's change and never the 5 ₳.
    expect(spent(mix)).toEqual(expect.arrayContaining([`${deposit.txHash}#${box.index}`, ...theirs.map((u) => `${u.tx_hash}#0`)]));
    expect(spent(back).some((o) => o.startsWith(mix.txHash))).toBe(true);
    expect(spent(back)).not.toContain(`${OUT}#2`);
    // Sent, the chain's record holds it, giveme.my not asked of anything while nothing is on chain.
    await sessions.backSubmit("preprod", review.txHash);
    const record = (await schedule(t)).chains.at(-1)!;
    expect(record.tail).toMatchObject({ deposit: deposit.txHash, mix: mix.txHash, pool: five.id, tries: 1 });
    expect(record.leaves).toContainEqual({ ...review.collateralTail!.leaf, pool: five.id });
    expect(t.collateral.asked).toEqual([]);
  });

  it("asks giveme.my for its mix once everything before it is on chain, then sends it and the return", async () => {
    // One box: its deposit, its mix and the collateral's deposit leave the mempool's window room for the mix.
    const { t, five, sessions } = await setUp("16000000");
    const review = await sessions.backBuild("preprod", 0);
    const chain = await steps(t);
    expect(chain.length).toBeLessThan(CHAIN_WINDOW + 2);
    const [deposit, mix, back] = chain.slice(-3) as [Step, Step, Step];
    await sessions.backSubmit("preprod", review.txHash);
    // Nothing on chain yet: the runner sends what goes before it, and never asks giveme.my.
    await sessions.runAll("preprod");
    expect(t.koios.submitted.map((b) => txIdOf(b))).toContain(deposit.txHash);
    expect(t.collateral.asked).toEqual([]);
    expect(t.koios.submitted.map((b) => txIdOf(b))).not.toContain(mix.txHash);
    // All of it on chain: the network measures the mix, giveme.my signs it once, and it goes, the return after it.
    t.koios.confirmations = 1;
    const evaluated = t.koios.calls.length;
    await sessions.runAll("preprod");
    expect(t.collateral.asked).toEqual([mix.txCbor]);
    expect(t.koios.calls.slice(evaluated).some((c) => c.path.includes("ogmios") && JSON.stringify(c.body).includes(mix.txCbor))).toBe(true);
    const sent = t.koios.submitted.map((b) => txIdOf(b));
    expect(sent).toContain(mix.txHash);
    expect(sent.indexOf(back.txHash)).toBeGreaterThan(sent.indexOf(mix.txHash));
    // Its leaf comes back by itself: a due time in the 5 ₳ pool, and a box out under its chain's mix in the list.
    const s = await schedule(t);
    const record = s.chains.at(-1)!;
    expect(record.tail).toMatchObject({ scheduled: true });
    expect(s.pools?.[five.id]?.due).toHaveLength(1);
    expect(s.mixes!.find((e) => e.id === record.id)!.shares).toContainEqual({ pool: five.id, boxes: 1 });
  });

  it("waits out giveme.my behind the chain, then stops, and the runner builds that mix again with fresh boxes", async () => {
    const { t, five, lj, sessions } = await setUp();
    const review = await sessions.backBuild("preprod", 0);
    const chain = await steps(t);
    const [deposit, mix] = chain.slice(-3) as [Step, Step, Step];
    await sessions.backSubmit("preprod", review.txHash);
    t.koios.confirmations = 1;
    // giveme.my refuses: its own read of the chain may be behind Koios's, so it's asked again later.
    t.collateral.answer = { status: 400, body: { error: "transaction fails validation" } };
    await sessions.runAll("preprod");
    expect(t.collateral.asked).toEqual([mix.txCbor]);
    expect((await schedule(t)).chains.at(-1)!.tail?.over).toBeUndefined();
    // Past that wait, a refusal stops the chain at its mix: nothing of the tail goes over to a direct return yet.
    t.clock.now += 3 * 60_000 + 1;
    await sessions.runAll("preprod");
    expect(t.koios.submitted.map((b) => txIdOf(b))).not.toContain(mix.txHash);
    const stopped = (await schedule(t)).chains.at(-1)!;
    expect(stopped.tail).toMatchObject({ tries: 1 });
    expect(stopped.tail?.scheduled).toBeUndefined();
    // On chain now: the box in its pool, the deposit's change at the account, what the chain spent gone.
    const box = paid(deposit.txCbor).find((o) => o.index === review.collateralTail!.box.txIndex)!;
    const change = paid(deposit.txCbor).find((o) => o.address === sessionSwap.address)!;
    t.koios.addedToAccounts.splice(0, 2);
    t.koios.addedToAccounts.push(listed(deposit, box, five.mixBox), atSession(deposit.txHash, change.index, String(change.value.ada.lovelace)));
    for (const tx of chain.slice(0, -2)) for (const o of spent(tx)) t.koios.spent.add(o);
    // Its chain stopped short of the mix: the box is the wallet's not mixed yet, as its record says, nobody asked.
    const calls = t.koios.calls.length;
    const pool = (await lj.status("preprod")).pools!.find((p) => p.id === five.id)!;
    expect(pool.notMixed).toContainEqual({ txHash: deposit.txHash, txIndex: box.index, pool: five.id });
    const asked = t.koios.calls.slice(calls).filter((c) => c.path.includes("tx_info") && JSON.stringify(c.body).includes(deposit.txHash));
    expect(asked).toEqual([]);
    // Built again: its mix takes the box, drawing afresh, and the return after it; giveme.my answers this time.
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    const again = await sessions.backBuild("preprod", 0);
    const resumed = await steps(t);
    expect(resumed.map((x) => x.kind)).toEqual(["mix", "back"]);
    expect(resumed[0]).toMatchObject({ tail: true, giveme: true });
    expect(spent(resumed[0]!)).toEqual(expect.arrayContaining([`${deposit.txHash}#${box.index}`, `${deposit.txHash}#${change.index}`]));
    expect(again.collateralTail).toMatchObject({ box: { txHash: deposit.txHash, txIndex: box.index }, pool: five.id });
    await sessions.backSubmit("preprod", again.txHash);
    const chains = (await schedule(t)).chains;
    expect(chains.find((c) => c.id === stopped.id)!.tail?.over).toBe(true);
    expect(chains.at(-1)!.tail).toMatchObject({ deposit: deposit.txHash, mix: resumed[0]!.txHash, tries: 2 });
    // Its day still runs from when that deposit was first known in, not from the mix built again.
    expect(stopped.tail?.landed).toBeDefined();
    expect(chains.at(-1)!.tail?.landed).toBe(stopped.tail!.landed);
  });

  /** setUp's return sent, stopped at its collateral's mix (giveme.my refused past its wait), all before it on chain. */
  async function stoppedAtMix() {
    const set = await setUp();
    const { t, five, sessions } = set;
    const review = await sessions.backBuild("preprod", 0);
    const chain = await steps(t);
    const deposit = chain.at(-3)!;
    await sessions.backSubmit("preprod", review.txHash);
    t.koios.confirmations = 1;
    t.collateral.answer = { status: 400, body: { error: "transaction fails validation" } };
    await sessions.runAll("preprod");
    t.clock.now += 3 * 60_000 + 1;
    await sessions.runAll("preprod");
    const box = paid(deposit.txCbor).find((o) => o.index === review.collateralTail!.box.txIndex)!;
    const change = paid(deposit.txCbor).find((o) => o.address === sessionSwap.address)!;
    t.koios.addedToAccounts.splice(0, 2);
    t.koios.addedToAccounts.push(listed(deposit, box, five.mixBox), atSession(deposit.txHash, change.index, String(change.value.ada.lovelace)));
    for (const tx of chain.slice(0, -2)) for (const o of spent(tx)) t.koios.spent.add(o);
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    const stopped = (await schedule(t)).chains.at(-1)!;
    expect(stopped.tail).toMatchObject({ tries: 1 });
    return { ...set, stopped };
  }

  it("keeps a stopped chain's collateral's mix to build again when the chain built in its place never starts", async () => {
    const { t, lj, sessions, stopped } = await stoppedAtMix();
    const again = await sessions.backBuild("preprod", 0);
    // Another of the wallet's chains reserved what this one spends since it was built: it's refused as it starts.
    await lj.reserve("preprod", "another", (await steps(t)) as Parameters<typeof lj.reserve>[2]);
    await expect(sessions.backSubmit("preprod", again.txHash)).rejects.toThrow();
    const chains = (await schedule(t)).chains;
    expect(chains.map((c) => c.id)).not.toContain(again.txHash);
    expect(chains.find((c) => c.id === stopped.id)!.tail?.over).toBeUndefined();
    // Once that's let go, its mix is built again, never a plain return that takes what pays for it.
    await lj.release("preprod", "another");
    const later = await sessions.backBuild("preprod", 0);
    expect((await steps(t)).map((x) => x.kind)).toEqual(["mix", "back"]);
    await sessions.backSubmit("preprod", later.txHash);
    expect((await schedule(t)).chains.at(-1)!.tail).toMatchObject({ tries: 2 });
  });

  it("asks again, rather than stop, while Koios's Ogmios doesn't know the outputs of its own deposit yet", async () => {
    const { t, sessions } = await setUp("16000000");
    const review = await sessions.backBuild("preprod", 0);
    const [deposit, mix, back] = (await steps(t)).slice(-3) as [Step, Step, Step];
    await sessions.backSubmit("preprod", review.txHash);
    // On chain as chainStatus reads it, but the evaluation lands on a backend a block behind.
    t.koios.confirmations = 1;
    const box = review.collateralTail!.box;
    const behind = {
      jsonrpc: "2.0",
      method: "evaluateTransaction",
      error: { code: 3117, message: "Unknown transaction input", data: { unknownOutputReferences: [{ transaction: { id: box.txHash }, index: box.txIndex }] } },
    };
    t.koios.evaluation = (body: unknown) => (JSON.stringify(body).includes(mix.txCbor) ? behind : AGREES);
    await sessions.runAll("preprod");
    expect(t.collateral.asked).toEqual([]);
    const waiting = (await schedule(t)).chains.at(-1)!;
    expect(waiting.tail?.tries).toBe(1);
    expect(waiting.ended).toBeUndefined();
    // Caught up, asked again a minute later: giveme.my signs it, and it goes, the return after it.
    t.koios.evaluation = AGREES;
    t.clock.now += 60_000;
    await sessions.runAll("preprod");
    expect(t.collateral.asked).toEqual([mix.txCbor]);
    const sent = t.koios.submitted.map((b) => txIdOf(b));
    expect(sent).toEqual(expect.arrayContaining([deposit.txHash, mix.txHash, back.txHash]));
  });

  it("holds what's left at the account while a lock cut its chain before the collateral's box is listed", async () => {
    const { t, five, sessions } = await setUp("16000000");
    const review = await sessions.backBuild("preprod", 0);
    const chain = await steps(t);
    const [deposit, mix] = chain.slice(-3) as [Step, Step, Step];
    await sessions.backSubmit("preprod", review.txHash);
    // Its deposit went, its mix waits on it; then a lock wipes where its chain waits. No page has asked Lovejoin
    // anything since (cuts): the return itself sees the chain was cut, never taking it for one still being sent.
    expect(t.koios.submitted.map((b) => txIdOf(b))).toContain(deposit.txHash);
    await t.wallet.withKeys(() => t.session.remove(`${SESSION_CHAIN_PREFIX}preprod.0`));
    // The deposit's change is listed at the account, but not its box in the pool, and the deposit isn't known on chain
    // yet (a listing a little behind another): a plain return now would take what pays for its mix, so nothing comes
    // back yet.
    const change = paid(deposit.txCbor).find((o) => o.address === sessionSwap.address)!;
    t.koios.missing.add(deposit.txHash);
    t.koios.addedToAccounts.push(atSession(deposit.txHash, change.index, String(change.value.ada.lovelace)));
    await expect(sessions.backBuild("preprod", 0)).rejects.toThrow(tr("lj.tail.waiting"));
    expect(t.koios.submitted.map((b) => txIdOf(b))).not.toContain(mix.txHash);
    // Its box listed now: the mix is built again, and its day still runs from when that deposit was first known in.
    t.koios.missing.delete(deposit.txHash);
    const box = paid(deposit.txCbor).find((o) => o.index === review.collateralTail!.box.txIndex)!;
    t.koios.addedToAccounts.splice(0, 2);
    t.koios.addedToAccounts.push(listed(deposit, box, five.mixBox));
    for (const tx of chain.slice(0, -2)) for (const o of spent(tx)) t.koios.spent.add(o);
    const again = await sessions.backBuild("preprod", 0);
    expect((await steps(t)).map((x) => x.kind)).toEqual(["mix", "back"]);
    const cut = (await schedule(t)).chains.at(-1)!;
    expect(cut.tail?.landed).toBe(t.clock.now);
    t.clock.now += 60_000;
    await sessions.backSubmit("preprod", again.txHash);
    expect((await schedule(t)).chains.at(-1)!.tail).toMatchObject({ tries: 2, landed: cut.tail!.landed });
  });

  it("stops waiting on a collateral's deposit that isn't on chain an hour after its chain stopped", async () => {
    const { t, sessions } = await setUp("16000000");
    const review = await sessions.backBuild("preprod", 0);
    const chain = await steps(t);
    const deposit = chain.at(-3)!;
    await sessions.backSubmit("preprod", review.txHash);
    // A lock cuts the chain, wiping where it waits and what the wallet's sends spent, and a node dropped its
    // collateral's deposit: what went before it landed, and what the deposit spends is still at the account.
    await t.wallet.withKeys(async () => {
      await t.session.remove(`${SESSION_CHAIN_PREFIX}preprod.0`);
      await t.session.remove(SESSION_SPENT);
    });
    for (const tx of chain.slice(0, -3)) for (const o of spent(tx)) t.koios.spent.add(o);
    const before = chain.at(-4)!;
    const change = paid(before.txCbor).find((o) => o.address === sessionSwap.address)!;
    t.koios.addedToAccounts.push(atSession(before.txHash, change.index, String(change.value.ada.lovelace)));
    t.koios.missing.add(deposit.txHash);
    await expect(sessions.backBuild("preprod", 0)).rejects.toThrow(tr("lj.tail.waiting"));
    const s = await schedule(t);
    const cut = s.chains.at(-1)!;
    expect(cut.tail?.over).toBeUndefined();
    // An hour on (its chain stopped that long ago: the wallet would lock first), the return goes rather than wait out
    // the day.
    cut.ended! -= 60 * 60_000 + 1;
    await t.store.set("lovejoin.preprod", s);
    const back = await sessions.backBuild("preprod", 0);
    expect(back.txHash).toBeDefined();
    expect((await schedule(t)).chains.find((c) => c.id === cut.id)!.tail?.over).toBe(true);
  });

  it("asks a busy giveme.my again after a minute, then two, then four", async () => {
    const { t, sessions } = await setUp("16000000");
    const review = await sessions.backBuild("preprod", 0);
    await sessions.backSubmit("preprod", review.txHash);
    t.koios.confirmations = 1;
    t.collateral.answer = { status: 503, body: { error: "busy" } };
    const asks = async (minutes: number) => {
      t.clock.now += minutes * 60_000;
      await sessions.runAll("preprod");
      return t.collateral.asked.length;
    };
    expect(await asks(0)).toBe(1);
    expect(await asks(0)).toBe(1);
    expect(await asks(1)).toBe(2);
    expect(await asks(1)).toBe(2);
    expect(await asks(1)).toBe(3);
    expect(await asks(3)).toBe(3);
    expect(await asks(1)).toBe(4);
    // Busy is never a refusal: the chain still waits for it, not stopped.
    expect((await schedule(t)).chains.at(-1)!.ended).toBeUndefined();
  });

  it("goes as a chain of its own with a return that comes back directly, its spare ADA paying for no 10 ₳ box", async () => {
    const { t, five, sessions } = await setUp("4000000");
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoin).toBeUndefined();
    const chain = await steps(t);
    expect(chain.map((x) => x.kind)).toEqual(["deposit", "mix", "back"]);
    expect(chain[1]).toMatchObject({ tail: true, giveme: true });
    expect(review.collateralTail).toMatchObject({ box: { txHash: chain[0]!.txHash }, pool: five.id });
    // What comes back at once leaves the box's 5 ₳ out, and every fee.
    expect(BigInt(review.lovelace)).toBe(9_000_000n - 5_000_000n - BigInt(review.fee));
    expect(review.lovejoinSkipped).toBe(tr("sess.skip.warn.noBox"));
    await sessions.backSubmit("preprod", review.txHash);
    expect((await schedule(t)).chains.at(-1)!.tail).toMatchObject({ deposit: chain[0]!.txHash, mix: chain[1]!.txHash });
    // Sent as a chain, it still says why its ADA comes back unmixed, as a direct return sent alone does.
    const book = (await t.store.get<{ sessions: Array<{ lovejoinSkipped?: string }> }>("sessions.preprod"))!;
    expect(book.sessions[0]!.lovejoinSkipped).toBe(tr("sess.skip.warn.noBox"));
  });

  it("reads no 5 ₳ pool for a return whose account holds no 5 ₳ to mix", async () => {
    const { t, lj, sessions } = await setUp();
    // A site's transaction spent the session's 5 ₳.
    t.koios.addedToAccounts.splice(
      t.koios.addedToAccounts.findIndex((u) => u.tx_hash === OUT && u.tx_index === 2),
      1,
    );
    const asked = vi.spyOn(lj, "collateralPool");
    expect((await sessions.backBuild("preprod", 0)).collateralTail).toBeUndefined();
    expect(asked).not.toHaveBeenCalled();
  });

  // The owner, 2026-10-23: a Bootstrap's chain is a deposit alone, which runs no script, so it's funded with no
  // collateral at all, nothing is reserved for a collateral's mix, and it comes back through its deposit with none.
  it("funds a Bootstrap with no collateral, and brings it back through its deposit with none put up", async () => {
    const { t, sessions } = await setUp();
    const reserve = loadTestWasm().lovejoinCollateralReserve();
    const mix = await sessions.mixOutBuild("preprod", 1);
    expect(mix.payments.at(-1)!.lovelace).toBe("5000000");
    expect(mix.collateralReserve).toBe(reserve);
    const bootstrap = await sessions.mixOutBuild("preprod", 1, { bootstrap: true });
    expect(bootstrap.payments).toHaveLength(1);
    expect(bootstrap.collateralReserve).toBeUndefined();
    // A mix session's Bootstrap, funded so: its ADA at the account, no 5 ₳.
    const book = (await t.store.get<{ next: number; sessions: Array<Record<string, unknown>> }>("sessions.preprod"))!;
    const { site: _site, ...session } = book.sessions[0]!;
    await t.store.set("sessions.preprod", { ...book, sessions: [{ ...session, mix: { boxes: 1, bootstrap: true } }] });
    t.koios.addedToAccounts.splice(
      t.koios.addedToAccounts.findIndex((u) => u.tx_hash === OUT && u.tx_index === 2),
      1,
    );
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoin).toMatchObject({ bootstrap: true, depth: 0, boxes: 1 });
    expect(review.lovejoinSkipped).toBeUndefined();
    expect(review.collateralTail).toBeUndefined();
    const chain = await steps(t);
    expect(chain.map((x) => x.kind)).toEqual(["deposit", "back"]);
    // Neither puts anything up: the deposit runs no script, and the return is a sweep.
    for (const tx of chain) expect(bodyOutpoints(Buffer.from(tx.txCbor, "hex"), 13) ?? []).toEqual([]);
  });

  // The owner, 2026-10-23: the box mixes with other people's, so it waits for the crowd a mix waits for.
  it("goes only once the 5 ₳ pool holds the network's floor of boxes that aren't the wallet's, two of them free", async () => {
    const lovejoin = NETWORKS.preprod.lovejoin!;
    const floor = lovejoin.poolFloor;
    lovejoin.poolFloor = 2;
    try {
      // Under it, as mainnet's first 5 ₳ pool would be: the collateral comes back with the rest.
      const short = await setUp("3000000", 1);
      const under = await short.sessions.backBuild("preprod", 0);
      expect(under.collateralTail).toBeUndefined();
      expect(BigInt(under.lovelace)).toBe(8_000_000n - BigInt(under.fee));
      // Two of other people's there, and it goes.
      const met = await setUp("4000000", 2);
      expect((await met.sessions.backBuild("preprod", 0)).collateralTail).toMatchObject({ pool: met.five.id });
    } finally {
      lovejoin.poolFloor = floor;
    }
  });

  it("comes back with the rest when Settings turns it off, the return goes directly, or no 5 ₳ pool is shown", async () => {
    const { t, sessions } = await setUp();
    // Brought back directly, by the review's switch.
    expect((await sessions.backBuild("preprod", 0, true)).collateralTail).toBeUndefined();
    // Settings' switch off.
    await t.deps.preferences.set({ lovejoinCollateral: false });
    const off = await sessions.backBuild("preprod", 0);
    expect(off.lovejoin).toBeDefined();
    expect(off.collateralTail).toBeUndefined();
    expect((await steps(t)).some((x) => x.tail)).toBe(false);
    // On, with no 5 ₳ pool shown (mainnet, until someone starts one).
    await t.deps.preferences.set({ lovejoinCollateral: true });
    expect((await runner(t, pooled(t, [])).backBuild("preprod", 0)).collateralTail).toBeUndefined();
    // And a pool of other boxes is no collateral's: a 25 ₳ ADA pool.
    const other = await adaPool(t, "25000000", ["e3", "e7"]);
    expect((await runner(t, pooled(t, [other.ref])).backBuild("preprod", 0)).collateralTail).toBeUndefined();
  });

  it("counts a return's boxes across pools after what its funding paid for its collateral's mix, as its chain does", async () => {
    const { t, five } = await setUp();
    const book = (await t.store.get<{ next: number; sessions: Array<Record<string, unknown>> }>("sessions.preprod"))!;
    await t.store.set("sessions.preprod", { ...book, sessions: [{ ...book.sessions[0]!, collateralReserve: true }] });
    t.koios.addedToAccounts.push(atSession(OUT, 0, "3000000", [asset(LJTEST, 2n * Q)]), ...strangers(t, VIEW.mixBoxHash, 6, 0x60, "2000000", asset(LJTEST, Q)));
    const wasm = loadTestWasm();
    const plans: Array<{ legs?: unknown[]; collateralReserve?: boolean }> = [];
    const planLovejoin = (keys: Parameters<typeof wasm.planLovejoin>[0], request: string) => {
      plans.push(JSON.parse(request) as (typeof plans)[number]);
      return wasm.planLovejoin(keys, request);
    };
    const review = await runner(t, pooled(t, [five.ref, TOKEN_POOL], { wasm: { ...wasm, planLovejoin } as typeof wasm })).backBuild("preprod", 0);
    expect(review.lovejoin?.parts?.[0]).toMatchObject({ pool: TOKEN });
    const across = plans.filter((p) => p.legs?.length);
    expect(across.length).toBeGreaterThan(0);
    expect(across.every((p) => p.collateralReserve === true)).toBe(true);
  });

  it("is paid for by a site's funding where a 5 ₳ pool would take it, and by none where it wouldn't", async () => {
    const { t, lj } = await setUp();
    const reserve = loadTestWasm().lovejoinCollateralReserve();
    const funded = await runner(t, lj).siteOutBuild("preprod", "https://example.org", "10000000", []);
    expect(funded.collateralReserve).toBe(reserve);
    expect(funded.payments[0]!.lovelace).toBe((10_000_000n + BigInt(reserve)).toString());
    expect(funded.payments[1]!.lovelace).toBe("5000000");
    // No 5 ₳ pool shown, or Settings' switch off: nothing more.
    expect((await runner(t, pooled(t, [])).siteOutBuild("preprod", "https://example.org", "10000000", [])).collateralReserve).toBeUndefined();
    await t.deps.preferences.set({ lovejoinCollateral: false });
    expect((await runner(t, lj).siteOutBuild("preprod", "https://example.org", "10000000", [])).collateralReserve).toBeUndefined();
  });
});
