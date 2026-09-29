// Bech32 (BIP 173), for tests that need an address the wallet doesn't make
// itself (an enterprise address, or our payment key with someone else's
// stake key), or an address's bytes without the WebAssembly.

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i]!;
  }
  return chk;
}

const hrpExpand = (hrp: string) => [
  ...[...hrp].map((c) => c.charCodeAt(0) >>> 5),
  0,
  ...[...hrp].map((c) => c.charCodeAt(0) & 31),
];

/** 8-bit bytes as 5-bit groups, padded. */
function toWords(bytes: Uint8Array): number[] {
  const words: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      words.push((acc >>> bits) & 31);
    }
  }
  if (bits > 0) words.push((acc << (5 - bits)) & 31);
  return words;
}

export function bech32(hrp: string, bytes: Uint8Array): string {
  const data = toWords(bytes);
  const mod = polymod([...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...data, ...checksum].map((d) => CHARSET[d]).join("")}`;
}

const hexBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!, (h) => Number.parseInt(h, 16));

/** A preprod address for payment key hash `payment`: enterprise without `stake`, base with it (a key hash). */
export function preprodAddress(payment: string, stake?: string): string {
  const header = stake ? "00" : "60";
  return bech32("addr_test", hexBytes(header + payment + (stake ?? "")));
}

/** A bech32 string's bytes, its checksum checked: an address's, as `cip30Address` gives them. */
export function bech32Bytes(text: string): Uint8Array {
  const at = text.lastIndexOf("1");
  const hrp = text.slice(0, at);
  const data = [...text.slice(at + 1)].map((c) => CHARSET.indexOf(c));
  if (at < 1 || data.length < 6 || data.includes(-1) || polymod([...hrpExpand(hrp), ...data]) !== 1) {
    throw new Error(`not bech32: ${text}`);
  }
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const d of data.slice(0, -6)) {
    acc = ((acc << 5) | d) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >>> bits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}
