// CIP-14 fingerprints, for the worker and the pages alike: the worker gives
// one to a token in a private index row (private-index.ts), as Koios gives one
// in every asset_list; the pages to a token a site's transaction or Activity
// names by policy and name alone (ui/tokens.ts).

import { blake2b } from "@noble/hashes/blake2.js";

import type { TokenRef } from "./rpc";

/**
 * CIP-14: a token's fingerprint, `asset1…`, the bech32 of the blake2b-160
 * of its policy ID and asset name. Koios gives it for held tokens; a site's
 * transaction and Activity carry only the policy and name.
 */
export function assetFingerprint(t: TokenRef): string {
  const bytes = Uint8Array.from(`${t.policyId}${t.assetName}`.match(/../g) ?? [], (h) => Number.parseInt(h, 16));
  return bech32("asset", blake2b(bytes, { dkLen: 20 }));
}

const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

/** BIP-173 bech32 of `data`, under `prefix`. */
function bech32(prefix: string, data: Uint8Array): string {
  const words: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const byte of data) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      words.push((acc >> bits) & 31);
    }
  }
  if (bits > 0) words.push((acc << (5 - bits)) & 31);
  const polymod = (values: number[]) => {
    const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let chk = 1;
    for (const v of values) {
      const top = chk >>> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ v;
      for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i]!;
    }
    return chk;
  };
  const expanded = [...[...prefix].map((c) => c.charCodeAt(0) >> 5), 0, ...[...prefix].map((c) => c.charCodeAt(0) & 31)];
  const mod = polymod([...expanded, ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
  return `${prefix}1${[...words, ...checksum].map((w) => BECH32[w]).join("")}`;
}
