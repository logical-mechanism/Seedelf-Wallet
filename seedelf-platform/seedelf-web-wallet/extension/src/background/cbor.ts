// Just enough CBOR to read a signed Cardano transaction: find where an item
// ends, list the inputs a transaction spends, and its id. Building and
// signing happen in WebAssembly; this only reads what the worker is about to
// submit, or what a dApp hands it.

import { t } from "../i18n";
import { blake2b } from "@noble/hashes/blake2.js";

interface Head {
  major: number;
  /** The length, count or value in the head. */
  n: number;
  /** Where the item's content starts. */
  p: number;
  indefinite: boolean;
}

// A dApp hands the worker bytes of its choosing (submitTx, signTx), so every
// read is checked against the end: bytes that run out, or a length or count
// longer than what's left, throw rather than read past it, where a missing
// byte would look like a 0 and a loop would never end.

const tooShort = () => new Error(t("worker.cbor.endsTooSoon"));

function head(b: Uint8Array, pos: number): Head {
  if (pos >= b.length) throw tooShort();
  const major = b[pos]! >> 5;
  const info = b[pos]! & 0x1f;
  let p = pos + 1;
  let n = info;
  const size = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : 0;
  if (info > 27 && info < 31) throw new Error(t("worker.cbor.notWellFormed"));
  if (p + size > b.length) throw tooShort();
  if (info === 24) n = b[p]!;
  else if (info === 25) n = (b[p]! << 8) | b[p + 1]!;
  else if (info === 26) n = new DataView(b.buffer, b.byteOffset + p, 4).getUint32(0);
  else if (info === 27) n = Number(new DataView(b.buffer, b.byteOffset + p, 8).getBigUint64(0));
  p += size;
  // Every item takes a byte at least, and a string its length.
  if ((major >= 2 && major <= 5 && info !== 31 && n > b.length - p)) throw tooShort();
  return { major, n, p, indefinite: info === 31 };
}

/**
 * How deep a dApp's CBOR may nest: each list, map and tag is a level, as the
 * WebAssembly counts them (cip30.rs refuses past 128 too). A real
 * transaction is a few levels deep; a site's could be thousands, and reading
 * it would run the worker's stack out.
 */
export const MAX_DEPTH = 128;

const tooDeep = () => new Error(t("worker.cbor.tooDeep", { max: MAX_DEPTH }));

/**
 * The end offset of the CBOR item that starts at `pos`, `depth` levels in.
 * `inside`: the CBOR a tag 24 wraps in a byte string (an inline datum, a
 * reference script) is read too, and its levels count.
 */
export function skip(b: Uint8Array, pos: number, depth = 0, inside = false): number {
  const { major, n, p, indefinite } = head(b, pos);
  if ((indefinite || major >= 4) && major !== 7 && depth >= MAX_DEPTH) throw tooDeep();
  if (indefinite) {
    // Items until the 0xff break.
    let q = p;
    while (b[q] !== 0xff) q = skip(b, q, depth + 1, inside);
    return q + 1;
  }
  switch (major) {
    case 0:
    case 1:
    case 7:
      return p;
    case 2:
    case 3:
      return p + n;
    case 4: {
      let q = p;
      for (let i = 0; i < n; i++) q = skip(b, q, depth + 1, inside);
      return q;
    }
    case 5: {
      let q = p;
      for (let i = 0; i < 2 * n; i++) q = skip(b, q, depth + 1, inside);
      return q;
    }
    default: {
      // 6: a tag, then its item.
      const end = skip(b, p, depth + 1, inside);
      const wrapped = head(b, p);
      if (inside && n === 24 && wrapped.major === 2 && !wrapped.indefinite) {
        const content = b.subarray(wrapped.p, end);
        if (skip(content, 0, depth + 2, true) !== content.length) throw new Error(t("worker.cbor.tag24"));
      }
      return end;
    }
  }
}

/**
 * Whether a whole transaction nests within `MAX_DEPTH` levels, the CBOR its
 * tags 24 wrap included, with nothing after it: safe to hand WebAssembly's
 * decoder, which reads nesting by recursion.
 */
export function nestsWithin(tx: Uint8Array): boolean {
  try {
    return skip(tx, 0, 0, true) === tx.length;
  } catch {
    return false;
  }
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** The inputs a transaction spends, as `txhash#index`: its body's key 0, a list or a tagged set. */
export function txInputs(tx: Uint8Array): string[] {
  const inputs = bodyOutpoints(tx, 0);
  if (!inputs) throw new Error(t("worker.cbor.noInputs"));
  return inputs;
}

/** Where the value under one key of a transaction's body starts, or undefined. */
function bodyField(tx: Uint8Array, field: number): number | undefined {
  if (tx[0] !== 0x84) throw new Error(t("worker.cbor.notFourItems"));
  const body = head(tx, 1);
  if (body.major !== 5 || body.indefinite) throw new Error(t("worker.cbor.bodyNotMap"));
  let p = body.p;
  for (let i = 0; i < body.n; i++) {
    // The body's fields are two levels in: the transaction, then the body.
    const key = head(tx, p);
    const value = skip(tx, p, 2);
    if (key.major === 0 && key.n === field) return value;
    p = skip(tx, value, 2);
  }
  return undefined;
}

/** The outpoints under one key of a transaction's body (0 the inputs, 13 the collateral), or undefined. */
export function bodyOutpoints(tx: Uint8Array, field: 0 | 13): string[] | undefined {
  const value = bodyField(tx, field);
  return value === undefined ? undefined : outpoints(tx, value);
}

/**
 * What each of a transaction's certificates is (its body's key 4, a list or
 * a tagged set): each one's first field, its kind as the ledger numbers them
 * (1 is the old-style stop of a stake key's staking). None without any.
 */
export function certificateKinds(tx: Uint8Array): number[] {
  const value = bodyField(tx, 4);
  if (value === undefined) return [];
  let set = head(tx, value);
  if (set.major === 6) set = head(tx, set.p); // tag 258: a set
  const kinds: number[] = [];
  let p = set.p;
  for (let i = 0; set.indefinite ? tx[p] !== 0xff : i < set.n; i++) {
    const certificate = head(tx, p);
    if (certificate.major !== 4) throw new Error(t("worker.cbor.certNotList"));
    const kind = head(tx, certificate.p);
    if (kind.major === 0) kinds.push(kind.n);
    p = skip(tx, p, 3);
  }
  return kinds;
}

function outpoints(b: Uint8Array, pos: number): string[] {
  let set = head(b, pos);
  if (set.major === 6) set = head(b, set.p); // tag 258: a set
  const found: string[] = [];
  let p = set.p;
  for (let i = 0; set.indefinite ? b[p] !== 0xff : i < set.n; i++) {
    const id = head(b, head(b, p).p);
    const index = head(b, id.p + id.n);
    found.push(`${hex(b.subarray(id.p, id.p + id.n))}#${index.n}`);
    p = index.p;
  }
  return found;
}

/** A transaction's id: the BLAKE2b-256 of its body, exactly as encoded. */
export function txId(tx: Uint8Array): string {
  if (tx[0] !== 0x84) throw new Error(t("worker.cbor.notFourItems"));
  return hex(blake2b(tx.subarray(1, skip(tx, 1, 1)), { dkLen: 32 }));
}
