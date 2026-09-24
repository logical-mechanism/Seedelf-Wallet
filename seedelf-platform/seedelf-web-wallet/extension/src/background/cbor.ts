// Just enough CBOR to read a signed Cardano transaction: find where an item
// ends, and list the inputs a transaction spends. Building and signing
// happen in WebAssembly; this only reads what the worker is about to submit.

interface Head {
  major: number;
  /** The length, count or value in the head. */
  n: number;
  /** Where the item's content starts. */
  p: number;
  indefinite: boolean;
}

function head(b: Uint8Array, pos: number): Head {
  const major = b[pos]! >> 5;
  const info = b[pos]! & 0x1f;
  let p = pos + 1;
  let n = info;
  if (info === 24) n = b[p++]!;
  else if (info === 25) (n = (b[p]! << 8) | b[p + 1]!), (p += 2);
  else if (info === 26) (n = new DataView(b.buffer, b.byteOffset + p, 4).getUint32(0)), (p += 4);
  else if (info === 27) (n = Number(new DataView(b.buffer, b.byteOffset + p, 8).getBigUint64(0))), (p += 8);
  return { major, n, p, indefinite: info === 31 };
}

/** The end offset of the CBOR item that starts at `pos`. */
export function skip(b: Uint8Array, pos: number): number {
  const { major, n, p, indefinite } = head(b, pos);
  if (indefinite) {
    // Items until the 0xff break.
    let q = p;
    while (b[q] !== 0xff) q = skip(b, q);
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
      for (let i = 0; i < n; i++) q = skip(b, q);
      return q;
    }
    case 5: {
      let q = p;
      for (let i = 0; i < 2 * n; i++) q = skip(b, q);
      return q;
    }
    default: // 6: a tag, then its item
      return skip(b, p);
  }
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** The inputs a transaction spends, as `txhash#index`: its body's key 0, a list or a tagged set. */
export function txInputs(tx: Uint8Array): string[] {
  const inputs = bodyOutpoints(tx, 0);
  if (!inputs) throw new Error("the transaction has no inputs");
  return inputs;
}

/** The outpoints under one key of a transaction's body (0 the inputs, 13 the collateral), or undefined. */
export function bodyOutpoints(tx: Uint8Array, field: 0 | 13): string[] | undefined {
  if (tx[0] !== 0x84) throw new Error("not a 4-item transaction array");
  const body = head(tx, 1);
  if (body.major !== 5 || body.indefinite) throw new Error("the transaction body isn't a map");
  let p = body.p;
  for (let i = 0; i < body.n; i++) {
    const key = head(tx, p);
    const value = skip(tx, p);
    if (key.major === 0 && key.n === field) return outpoints(tx, value);
    p = skip(tx, value);
  }
  return undefined;
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
