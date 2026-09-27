// A swap shaped like the one Minswap's aggregator builds, from private
// session 0's funding (session-swap.json): what the fake aggregator answers
// build-tx with, in the unit tests (tests/sessions.test.ts) and end to end
// (e2e/support.ts). Plain TypeScript, with no WebAssembly, so Playwright's
// loader takes it too.
import { readFileSync } from "node:fs";

import { blake2b } from "@noble/hashes/blake2.js";

import { builtOutputs } from "../../src/background/minswap";
import { bech32Bytes } from "./bech32";

export const hex = (b: ArrayLike<number>) => Buffer.from(Uint8Array.from(b)).toString("hex");
export const bytes = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));

const sessionSwap = JSON.parse(readFileSync(new URL("session-swap.json", import.meta.url), "utf8")) as {
  address: string;
  keyHash: string;
  utxo: { tx_hash: string; tx_index: number };
};

/**
 * Just enough CBOR to write a transaction: numbers, bytes, lists, maps with
 * number keys, tags, simple values, and items written already (`raw`, hex).
 */
export type Cbor = number | bigint | Uint8Array | Cbor[] | Map<number, Cbor> | { tag: number; of: Cbor } | { raw: string } | boolean | null;
export function cbor(v: Cbor): number[] {
  const head = (major: number, n: number | bigint): number[] => {
    const x = BigInt(n);
    const size = x < 24n ? 0 : x < 0x100n ? 1 : x < 0x10000n ? 2 : x < 0x100000000n ? 4 : 8;
    const info = [0, 24, 25, 0, 26, 0, 0, 0, 27][size]!;
    return [(major << 5) | (size ? info : Number(x)), ...Array.from({ length: size }, (_, i) => Number((x >> BigInt(8 * (size - 1 - i))) & 0xffn))];
  };
  if (v === null) return [0xf6];
  if (typeof v === "boolean") return [v ? 0xf5 : 0xf4];
  if (typeof v === "number" || typeof v === "bigint") return head(0, v);
  if (v instanceof Uint8Array) return [...head(2, v.length), ...v];
  if (Array.isArray(v)) return [...head(4, v.length), ...v.flatMap(cbor)];
  if (v instanceof Map) return [...head(5, v.size), ...[...v].flatMap(([k, x]) => [...cbor(k), ...cbor(x)])];
  if ("raw" in v) return [...bytes(v.raw)];
  return [...head(6, v.tag), ...cbor(v.of)];
}

/** Session 0's address, and the recorded swap's order contract's under its staking part, as bytes (hex). */
export const SESSION_ADDRESS = hex(bech32Bytes(sessionSwap.address));
export const ORDER_ADDRESS = `10${"a6".repeat(28)}${SESSION_ADDRESS.slice(58)}`;

/** The swap Minswap's aggregator really built on preprod (a Minswap V1 order kept by its hash), and its sender as bytes (hex). */
export const recordedSwap = JSON.parse(
  readFileSync(new URL("../../../wasm/tests/fixtures/minswap-swap-preprod.json", import.meta.url), "utf8"),
) as { sender: string; cbor: string };
export const SENDER = hex(bech32Bytes(recordedSwap.sender));

/**
 * The details of that real order, made out to session 0: its key and
 * staking part in place of the recorded sender's.
 */
export const ORDER_DATUM = builtOutputs(bytes(recordedSwap.cbor))[0]!
  .datum!.replaceAll(SENDER.slice(2, 58), sessionSwap.keyHash)
  .replaceAll(SENDER.slice(58), SESSION_ADDRESS.slice(58));

/**
 * A swap shaped like the one Minswap's aggregator built on preprod, from
 * session 0's funding (the recorded one, session-swap.json, with its order's
 * details carried): the order at a DEX's contract, kept by its datum's hash,
 * and the change back. `outputs` in their place, each `[address, lovelace,
 * datum]`; `donation` to the treasury.
 */
export function swapTx({
  datum = ORDER_DATUM,
  outputs,
  donation,
}: { datum?: string; outputs?: Array<[string, number, string?]>; donation?: number } = {}): string {
  const hashOf = (d: string) => blake2b(bytes(d), { dkLen: 32 });
  const paid = outputs ?? [
    [ORDER_ADDRESS, 14_000_000, datum],
    [SESSION_ADDRESS, 131_585_414],
  ];
  const body = new Map<number, Cbor>([
    [0, { tag: 258, of: [[bytes(sessionSwap.utxo.tx_hash), sessionSwap.utxo.tx_index]] }],
    [
      1,
      paid.map(([address, lovelace, d]) => {
        const out = new Map<number, Cbor>([
          [0, bytes(address)],
          [1, lovelace],
        ]);
        if (d) out.set(2, [0, hashOf(d)]);
        return out;
      }),
    ],
    [2, 205_189],
    [3, 134_639_865],
  ]);
  if (donation) body.set(22, donation);
  // The datums its orders name by hash, carried in the witness set, as Minswap's are.
  const datums = paid.flatMap(([, , d]) => (d ? [{ raw: d }] : []));
  const witnesses = new Map<number, Cbor>(datums.length ? [[4, { tag: 258, of: datums }]] : []);
  return hex(cbor([body, witnesses, true, null]));
}
