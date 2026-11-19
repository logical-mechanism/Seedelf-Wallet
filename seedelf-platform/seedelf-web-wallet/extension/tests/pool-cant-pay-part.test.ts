// Chunk 51, gap-g5#1 (the verifier's trace test, its assertion made the fix's): a standard pool with its box under S0d's
// least, which a start may now make (the owner's call, gap-g8#6), is found, listed and picked as any pool (the owner's
// call 34: "Treat it like any pool", with the review saying so). What comes back from each box can't pay part of itself
// without other money, which ties the two at the first payment of part of one. Before, nothing said so: discovery
// keeps such a pool (lovejoin-pools.ts verified/listedValue), usableNow refuses only a box under the network's minimum,
// and cantComeBack measures the withdraw alone, so the hub listed it with no flag and a swap's token went into it with
// nothing beside it. Now WebAssembly measures S0d's own steps at the pool's box value beside its way back, once an
// epoch, and the hub's row, the swap's way into it and Change's values say so (`cantPayPart`).
//
// With the real WebAssembly: a 3 ₳ MIN pool (900 MIN a box) started by the wallet's own launch from the public account,
// as a launcher's tool would make it (the reference UTxO and both scripts at the holder, L registered by the launch).
// Found by Koios's holder, as preprod reads it; then the 5 ₳ pool beside it, as the planner's tests have them, and the
// recorded preprod swap that gets 902.08 MIN. Needs WebAssembly built with this change (`lovejoinUsable`'s `alone`).
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { Koios, type KoiosLaunch, type KoiosUtxo } from "../src/background/koios";
import { LovejoinService, type PoolRef } from "../src/background/lovejoin";
import { LovejoinLaunchService } from "../src/background/lovejoin-launch";
import { HOLDER, LOVEJOIN_NFT, PoolDiscovery } from "../src/background/lovejoin-pools";
import { Minswap } from "../src/background/minswap";
import { SessionService } from "../src/background/sessions";
import tokenList from "../src/tokens/list.json";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { koiosPreprod, loadTestWasm, memoryArea, minswapEstimate, ownedUtxos, testBalances, vectors } from "./fakes";
import { ADA, ADA_POOL, ADA_ROWS } from "./v2-pools";

const PASSWORD = "correct horse battery";
const PHRASE = (vectors("cardano_account.json") as Array<{ account: number; phrase: string }>).find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
)!.phrase;

/** A launch, a pool read and a swap's review, built and measured in WebAssembly. */
const SLOW = { timeout: 300_000 };

/** 20 boxes from Lovejoin's classic preprod pool, as Koios lists them (2026-09-25): rows below are made from one. */
const POOL = (JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }).pool;

/** MIN, on preprod's token list, which the recorded swap gets. */
const MIN = tokenList.preprod.find((x) => x.ticker === "MIN")!;
const MIN_UNIT = MIN.policy + MIN.name;
/** 900 MIN a box, so the recorded swap's least (902.08 MIN) makes one, as the planner's MIN pool has it. */
const MIN_Q = 900_000_000n;
/** The launcher's box: 3 ₳, the figure chunk 34's call 2 records as one that can't pay part of its token back alone. */
const BOX = "3000000";

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

/** Lovejoin reading the classic pool and `pools`, giveme.my's witness stood in for. */
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

/** The sessions over `lj`, the one-time key's signatures stood in for. */
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

/** One of the recorded public account's UTxOs, made again as `tx`'s with `value`. */
function atAccount(tx: string, value: string): KoiosUtxo {
  const [first] = Object.values(koiosPreprod.accounts)[0]!.account_utxos.filter((u) => BigInt(u.value) > 1_000_000_000n);
  return { ...first!, tx_hash: tx.repeat(32), tx_index: 0, value, asset_list: [] };
}

/** A stranger's register datum. */
function strangerDatum(n: number): string {
  const wasm = loadTestWasm();
  const stranger = wasm.SeedelfKey.fromHex(`01${n.toString(16).padStart(2, "0")}${"01".repeat(30)}`);
  const bytes = Buffer.from(wasm.registerToDatum(wasm.rerandomize(stranger.baseRegister()))).toString("hex");
  stranger.free();
  return bytes;
}

/** `n` strangers' boxes at `mixBox`, each holding `lovelace` and `token`. */
function strangers(t: T, mixBox: string, n: number, first: number, lovelace: string, token: ReturnType<typeof asset>): KoiosUtxo[] {
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
      asset_list: [{ ...token, decimals: 0, fingerprint: "asset1test" } as never],
    } as KoiosUtxo;
  });
}

type Made = {
  txCbor: string;
  pool: { id: string; mixBoxHash: string; mixLogicHash: string; seed: { txHash: string; txIndex: number } };
  locked: { mixBox: string };
};

/**
 * A MIN pool of `boxLovelace` boxes, started by the wallet's own launch from the public account: under S0d's least,
 * built, and its review saying so (gap-g8#6). Its rows at the holder as Koios lists them, and its launch as tx_info gives
 * it.
 */
async function launched(t: T, boxLovelace: string): Promise<{ id: string; mixBox: string; holder: KoiosUtxo[]; launch: KoiosLaunch; least?: string }> {
  const wasm = loadTestWasm();
  t.koios.addedToAccounts.push(atAccount("e1", "40000000"), atAccount("e5", "5000000"));
  let made: Made | undefined;
  const launch = new LovejoinLaunchService({
    ...t.deps,
    wasm: {
      ...wasm,
      buildLovejoinLaunchFromAccount: (key: Parameters<typeof wasm.buildLovejoinLaunchFromAccount>[0], request: string) => {
        const out = wasm.buildLovejoinLaunchFromAccount(key, request);
        if ((JSON.parse(request) as { register: boolean }).register) made = JSON.parse(out) as Made;
        return out;
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    lovejoin: t.lovejoin,
    discovery: { known: async () => [], look: async () => undefined },
  });
  const summary = await launch.build("preprod", { from: "public", token: { policyId: MIN.policy, assetName: MIN.name }, quantity: MIN_Q.toString(), boxLovelace });
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
      reference_script: null,
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
  const referenceRow = row(reference, {
    inline_datum: { bytes: reference.datum!, value: {} } as never,
    asset_list: [{ policy_id: made!.pool.id, asset_name: LOVEJOIN_NFT, quantity: "1", decimals: 0, fingerprint: "" } as never],
  });
  // L's reward account, which the launch registered (its certificate 0).
  const { mixLogicStake } = JSON.parse(
    wasm.lovejoinLaunchCheck(JSON.stringify({ network: "preprod", reference: referenceRow, inputs: [made!.pool.seed], scripts })),
  ) as { mixLogicStake: string };
  return {
    id: made!.pool.id,
    mixBox: made!.pool.mixBoxHash,
    holder: [referenceRow, ...scripts],
    launch: {
      tx_hash: referenceRow.tx_hash,
      block_height: referenceRow.block_height!,
      tx_block_index: 0,
      tx_timestamp: referenceRow.block_time!,
      inputs: [
        { tx_hash: "e1".repeat(32), tx_index: 0 },
        { tx_hash: made!.pool.seed.txHash, tx_index: made!.pool.seed.txIndex },
      ],
      certificates: [{ type: "stake_registration", info: { stake_address: mixLogicStake } }],
    },
    ...(summary.least ? { least: summary.least } : {}),
  };
}

/** Koios answering a look at the holder: `holder`'s rows, and `launches` as tx_info. */
function holderKoios(holder: KoiosUtxo[], launches: KoiosLaunch[]): Koios {
  const fetch = async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname.split("/").pop()!;
    const body = JSON.parse(String(init.body)) as { _payment_credentials?: string[]; _tx_hashes?: string[] };
    if (path === "credential_utxos") return Response.json(holder.filter((r) => body._payment_credentials?.includes(r.payment_cred ?? "")));
    if (path === "tx_info") return Response.json(launches.filter((l) => body._tx_hashes?.includes(l.tx_hash)));
    return Response.json([]);
  };
  return new Koios("https://preprod.koios.rest/api/v1", fetch, async () => undefined);
}

describe("a standard pool with its box under S0d's least (chunk 51, gap-g5#1)", SLOW, () => {
  it("is used as any pool, and the hub, the swap's way into it and Change say what its boxes can't do", async () => {
    const t = await wallet();
    const wasm = loadTestWasm();
    const params = (await t.deps.koios().epochParams()) as Record<string, unknown>;
    // S0d's least for 900 MIN a box under preprod's parameters.
    const { least } = JSON.parse(
      wasm.lovejoinBoxValue(JSON.stringify({ network: "preprod", params, token: { policyId: MIN.policy, assetName: MIN.name, quantity: MIN_Q.toString() } })),
    ) as { least: string };
    expect(BigInt(BOX), `S0d's least is ${least}`).toBeLessThan(BigInt(least));

    // The wallet's own start makes it, saying S0d's least on its review (gap-g8#6).
    const made = await launched(t, BOX);
    expect(made.least).toBe(least);
    const found = new PoolDiscovery({
      local: memoryArea(),
      wasm,
      koios: () => holderKoios(made.holder, [made.launch]),
      now: () => t.clock.now,
      headStart: () => ({ height: 0, pools: [] }),
    });
    await found.scan("preprod");
    const kept = (await found.known("preprod")).find((p) => p.id === made.id);
    expect(kept, "shown, as any standard pool is").toBeDefined();

    // The hub's row for it, with strangers' boxes there: listed, takes boxes, and says so.
    const lj = pooled(t, [ADA_POOL, kept!.ref]);
    t.koios.addedToAccounts.push(...ADA_ROWS, ...strangers(t, made.mixBox, 8, 0x80, BOX, asset(MIN_UNIT, MIN_Q)));
    const pools = (await lj.status("preprod")).pools ?? [];
    const row = pools.find((p) => p.id === made.id);
    expect(row).toMatchObject({ cantPayPart: true });
    expect(row?.cantComeBack).toBeUndefined();
    expect(row?.unusable).toBeUndefined();
    // The 5 ₳ pool's boxes pay part of themselves on their own: nothing said.
    expect(pools.find((p) => p.id === ADA)?.cantPayPart).toBeUndefined();

    // The swap that buys MIN, Bring it back through Lovejoin on as by default: picked as any pool, and said.
    const sessions = runner(t, lj);
    const datum = await t.wallet.withKeys((keys) => Buffer.from(wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister()))).toString("hex"));
    t.koios.added.push({ ...ownedUtxos[0]!, tx_hash: "d1".repeat(32), tx_index: 0, value: "100000000", inline_datum: { bytes: datum, value: {} } } as KoiosUtxo);
    const quote = await sessions.quote("preprod", minswapEstimate.ask);
    const out = await sessions.outBuild("preprod", quote);
    const way = out.lovejoin?.ways?.find((w) => w.policyId === MIN.policy && w.assetName === MIN.name);
    expect(way).toMatchObject({ pool: made.id, cantPayPart: true });
    expect(way!.boxes).toBeGreaterThan(0);
    expect(way!.stuck).toBeUndefined();
    // Change's list says it beside the pool.
    expect(out.lovejoin?.values?.[made.id]).toMatchObject({ cantPayPart: true });
  });
});
