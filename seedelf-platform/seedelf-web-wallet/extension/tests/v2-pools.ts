// Lovejoin v2's 5 ₳ ADA pool for the worker's tests (chunk 44): the pool a
// return's spare ADA and its session's collateral go into from 1.8.0, where
// the classic pool, retired, takes no new box. Its launch is
// wasm/tests/fixtures/lovejoin-v2-ada-pool-preprod.json, never on chain; its
// boxes are made here, a stranger's or the wallet's, as the token pools'
// tests make theirs, from the classic pool's recorded rows.
import { readFileSync } from "node:fs";

import type { KoiosUtxo } from "../src/background/koios";
import type { PoolRef } from "../src/background/lovejoin";
import type { PrivateStore } from "../src/background/private-store";
import type { Wallet } from "../src/background/wallet";
import { bech32 } from "./fixtures/bech32";
import { loadTestWasm, type FakeKoios } from "./fakes";

const FOUND = JSON.parse(readFileSync(new URL("../../wasm/tests/fixtures/lovejoin-v2-ada-pool-preprod.json", import.meta.url), "utf8")) as {
  seed: { txHash: string; txIndex: number };
  reference: KoiosUtxo;
  scripts: KoiosUtxo[];
};

/** The pool as discovery hands it to the worker (`pools`). */
export const ADA_POOL: PoolRef = { reference: FOUND.reference, seed: FOUND.seed, scripts: FOUND.scripts };

/** WebAssembly's view of it: v2's, 5 ₳ a box, no token. */
export const ADA_VIEW = JSON.parse(loadTestWasm().lovejoinVerifyPool(JSON.stringify({ network: "preprod", pool: ADA_POOL }))) as {
  id: string;
  version: string;
  boxLovelace: string;
  mixBoxHash: string;
};

/** Its id, as records and requests name it. */
export const ADA = ADA_VIEW.id;

/** Where its boxes sit. */
export const ADA_ADDRESS = bech32("addr_test", Uint8Array.from([0x70, ...Buffer.from(ADA_VIEW.mixBoxHash, "hex")]));

/** What every box of it holds. */
export const ADA_BOX = 5_000_000n;

/** A row of the classic pool's, as Koios listed it (2026-09-25): every box here is made from it. */
const TEMPLATE = (
  JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }
).pool[0]!;

/** A stranger's register datum, rerandomized afresh each time. */
export function strangerDatum(): string {
  const wasm = loadTestWasm();
  const stranger = wasm.SeedelfKey.fromHex("01".repeat(32));
  const bytes = Buffer.from(wasm.registerToDatum(wasm.rerandomize(stranger.baseRegister()))).toString("hex");
  stranger.free();
  return bytes;
}

/** One of the wallet's register datums, rerandomized afresh: a box of its own. */
export function ownDatum(wallet: Wallet): Promise<string> {
  const wasm = loadTestWasm();
  return wallet.withKeys((keys) => Buffer.from(wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister()))).toString("hex"));
}

/** Transactions that spent a box of the pool: what a mix there made, as Koios says (tx_info's inputs). */
export function madeByAdaMix(koios: Pick<FakeKoios, "txSpends">, ...txs: string[]): void {
  for (const tx of txs) koios.txSpends.set(tx, [{ payment_addr: { bech32: ADA_ADDRESS, cred: ADA_VIEW.mixBoxHash } }]);
}

/** The test clock's start (fakes.ts testWallet), when a box's age is counted from by default. */
const START = 1_800_000_000_000;

/**
 * A box of the pool as Koios lists it: `tx` (one byte of hex, repeated, or a whole hash), output `index`, holding
 * `datum`, made `hours` before `now` (ms). A box of the wallet's is told made by a mix there with madeByAdaMix, as
 * Koios is asked what made the wallet's boxes alone.
 */
export function adaBox(tx: string, datum: string, now = START, hours = 5, index = 0): KoiosUtxo {
  return {
    ...TEMPLATE,
    tx_hash: tx.length === 64 ? tx : tx.repeat(32),
    tx_index: index,
    address: ADA_ADDRESS,
    payment_cred: ADA_VIEW.mixBoxHash,
    value: ADA_BOX.toString(),
    block_time: Math.floor(now / 1000) - hours * 3600,
    datum_hash: null,
    inline_datum: { bytes: datum, value: {} },
    asset_list: [],
  } as KoiosUtxo;
}

/**
 * `n` strangers' boxes in the pool, one a transaction, numbered from `first`: their hashes are `5a5e` and the number, eight
 * times over, which no test's own byte repeated makes.
 */
export function adaStrangers(n: number, first = 0, now = START): KoiosUtxo[] {
  return Array.from({ length: n }, (_, i) => adaBox(`5a5e${(first + i).toString(16).padStart(4, "0")}`.repeat(8), strangerDatum(), now));
}

/** 20 strangers' boxes in the pool, as the classic pool's recorded rows were 20: what a test's mixes draw from. */
export const ADA_ROWS = adaStrangers(20);

/**
 * Marks `network`'s Lovejoin record retired already (lovejoin.ts retireOnce, chunk 44): the first run that finds the
 * wallet's boxes in a retired pool brings them all back, so a test of the classic pool's own scheduled returns marks it
 * first, as a wallet past its first 1.8.0 run is.
 */
export async function retiredAlready(store: PrivateStore, network: "preprod" | "mainnet" = "preprod", at = START): Promise<void> {
  const name = `lovejoin.${network}` as const;
  const s = (await store.get<Record<string, unknown>>(name)) ?? { due: [], chains: [] };
  await store.set(name, { ...s, retired: at });
}
