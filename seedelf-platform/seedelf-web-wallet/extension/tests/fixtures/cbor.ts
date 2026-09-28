// Test helper: the id of a signed Cardano transaction, blake2b-256 of its
// body (the first item of the transaction array). Used by the fake Koios to
// answer `submittx` as the real one does.
import { blake2b } from "@noble/hashes/blake2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { skip } from "../../src/background/cbor";

export function txIdOf(tx: Uint8Array): string {
  if (tx[0] !== 0x84) throw new Error("not a 4-item transaction array");
  const body = tx.subarray(1, skip(tx, 1));
  return bytesToHex(blake2b(body, { dkLen: 32 }));
}

/** A number at `pos`: its head's value (a major type 0 item). */
function uintAt(b: Uint8Array, pos: number): number {
  const info = b[pos]! & 0x1f;
  const view = new DataView(b.buffer, b.byteOffset + pos + 1);
  if (info < 24) return info;
  if (info === 24) return view.getUint8(0);
  if (info === 25) return view.getUint16(0);
  if (info === 26) return view.getUint32(0);
  return Number(view.getBigUint64(0));
}

/** The slot a transaction stops being valid at, its body's key 3, or undefined without one. */
export function ttlOf(tx: Uint8Array): number | undefined {
  // The body is a map of fewer than 24 fields, each keyed by a one-byte number.
  if (tx[0] !== 0x84 || tx[1]! >> 5 !== 5) throw new Error("not a transaction with a map body");
  let p = 2;
  for (let i = 0; i < (tx[1]! & 0x1f); i++) {
    const key = tx[p]!;
    if (key === 3) return uintAt(tx, p + 1);
    p = skip(tx, p + 1);
  }
  return undefined;
}
