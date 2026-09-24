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
