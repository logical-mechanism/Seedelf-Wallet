// Test helper: the id of a signed Cardano transaction, blake2b-256 of its
// body (the first item of the transaction array). Used by the fake Koios to
// answer `submittx` as the real one does.
import { blake2b } from "@noble/hashes/blake2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** The end offset of the CBOR item that starts at `pos`. */
function skip(b: Uint8Array, pos: number): number {
  const major = b[pos]! >> 5;
  const info = b[pos]! & 0x1f;
  let p = pos + 1;
  let n = info;
  if (info === 24) n = b[p++]!;
  else if (info === 25) (n = (b[p]! << 8) | b[p + 1]!), (p += 2);
  else if (info === 26) (n = new DataView(b.buffer, b.byteOffset + p, 4).getUint32(0)), (p += 4);
  else if (info === 27) (n = Number(new DataView(b.buffer, b.byteOffset + p, 8).getBigUint64(0))), (p += 8);
  if (info === 31) {
    // Indefinite length: items until the 0xff break.
    while (b[p] !== 0xff) p = skip(b, p);
    return p + 1;
  }
  switch (major) {
    case 0:
    case 1:
    case 7:
      return p;
    case 2:
    case 3:
      return p + n;
    case 4:
      for (let i = 0; i < n; i++) p = skip(b, p);
      return p;
    case 5:
      for (let i = 0; i < 2 * n; i++) p = skip(b, p);
      return p;
    default: // 6: a tag, then its item
      return skip(b, p);
  }
}

export function txIdOf(tx: Uint8Array): string {
  if (tx[0] !== 0x84) throw new Error("not a 4-item transaction array");
  const body = tx.subarray(1, skip(tx, 1));
  return bytesToHex(blake2b(body, { dkLen: 32 }));
}
