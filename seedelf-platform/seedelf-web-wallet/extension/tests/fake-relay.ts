// A Seedelf Messaging relay in memory (protocol.md §17), for the worker's
// tests: a pool per network, pages behind a cursor, the stamp checked with
// its own SHA-256 (noble's, not the WebAssembly's), already held before the
// price, and a price the test sets. It doesn't check points: the relay's own
// tests do (seedelf-data's api/src/messaging/).

import { sha256 } from "@noble/hashes/sha2.js";

import type { NetworkName } from "../src/networks";
import { RateLimit } from "../src/background/koios";
import { RelayClient } from "../src/background/relay";

const SIZES = [512, 2048, 8192, 32768];
const LABEL = new TextEncoder().encode("Seedelf-Messaging|v1|stamp|");
const HOLD_MS = 36 * 3600_000;

interface Held {
  number: bigint;
  bytes: Uint8Array;
  digest: string;
  came: number;
}

export interface FakeRelay {
  /** The fetch every client the relay makes goes through. */
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** A client of `pool`, as the worker makes one, with a rate limit of its own that never waits. */
  client(pool: NetworkName): RelayClient;
  pools: Map<string, { held: Held[]; next: bigint }>;
  /** The bits a post must show, for every size. */
  price: number;
  /** The most envelopes a page holds, so a test can make several. */
  pageCount: number;
  /** Every request, as `METHOD path?query`. */
  calls: string[];
  /** Off: every request fails as a lost connection would. */
  up: boolean;
  /** The next page says there's a gap. */
  gapOnce: boolean;
  /** Every page says another follows, whatever is left: a relay that isn't §17's. */
  alwaysMore: boolean;
  /** Answers the next post with this status (429 or 503) instead. */
  waitOnce?: number;
  /**
   * This address can't post now, for this many seconds, as the relay's own limits say: every page prices every size
   * at 0, and a post is refused with a 429 before its work is looked at (§17.5).
   */
  refusing?: number;
  now: () => number;
  /** Puts `envelope` (hex) in `pool` as if posted. */
  put(pool: NetworkName, envelope: string): void;
}

const hexOf = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const bytesOf = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));

export function stampDigest(pool: string, envelope: Uint8Array): Uint8Array {
  const name = new TextEncoder().encode(pool);
  const all = new Uint8Array(LABEL.length + 1 + name.length + envelope.length);
  all.set(LABEL);
  all[LABEL.length] = name.length;
  all.set(name, LABEL.length + 1);
  all.set(envelope, LABEL.length + 1 + name.length);
  return sha256(all);
}

export function work(digest: Uint8Array, nonce: Uint8Array): number {
  const hash = sha256(new Uint8Array([...digest, ...nonce]));
  let bits = 0;
  for (const byte of hash) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

export function fakeRelay(clock: { now: number } = { now: Date.now() }): FakeRelay {
  const relay: FakeRelay = {
    pools: new Map(),
    price: 4,
    pageCount: 1000,
    calls: [],
    up: true,
    gapOnce: false,
    alwaysMore: false,
    now: () => clock.now,
    client: (pool) =>
      new RelayClient({
        origin: "https://relay.test",
        pool,
        fetch: relay.fetch,
        limit: new RateLimit(1_000_000, 1000, () => clock.now, async () => undefined),
      }),
    put(pool, envelope) {
      keep(pool, bytesOf(envelope));
    },
    async fetch(url, init) {
      const u = new URL(url);
      relay.calls.push(`${init.method} ${u.pathname}${u.search}`);
      if (!relay.up) throw new TypeError("Failed to fetch");
      const match = /^\/messaging\/v1\/(mainnet|preprod)\/envelopes$/.exec(u.pathname);
      if (!match) return new Response("not found", { status: 404 });
      const pool = match[1]!;
      if (init.method === "GET") return page(pool, u.searchParams.get("after"));
      return post(pool, new Uint8Array(init.body as ArrayBuffer));
    },
  };

  const poolOf = (name: string) => {
    let pool = relay.pools.get(name);
    if (!pool) relay.pools.set(name, (pool = { held: [], next: 1_000_000n }));
    // What's had its 36 hours goes.
    pool.held = pool.held.filter((h) => relay.now() < h.came + HOLD_MS);
    return pool;
  };

  function keep(name: string, envelope: Uint8Array): Held {
    const pool = poolOf(name);
    const held = { number: pool.next++, bytes: envelope, digest: hexOf(stampDigest(name, envelope)), came: relay.now() };
    pool.held.push(held);
    return held;
  }

  function page(name: string, after: string | null): Response {
    const pool = poolOf(name);
    const from = after === null ? -1n : BigInt(after);
    const rest = pool.held.filter((h) => h.number > from);
    const taken = rest.slice(0, relay.pageCount);
    const more = rest.length > taken.length;
    // An empty page's cursor is the last number given out (§17.5).
    const cursor = taken.at(-1)?.number ?? pool.next - 1n;
    const size = 16 + taken.reduce((s, h) => s + 4 + h.bytes.length, 0);
    const out = new Uint8Array(size);
    const view = new DataView(out.buffer);
    out[0] = 1;
    out[1] = (more || relay.alwaysMore ? 1 : 0) | (relay.gapOnce && after !== null ? 2 : 0);
    relay.gapOnce = false;
    view.setBigUint64(2, cursor);
    const price = relay.refusing ? 0 : relay.price;
    out.set([price, price, price, price], 10);
    view.setUint16(14, taken.length);
    let at = 16;
    for (const h of taken) {
      view.setUint32(at, h.bytes.length);
      out.set(h.bytes, at + 4);
      at += 4 + h.bytes.length;
    }
    return new Response(out, { status: 200, headers: { "content-type": "application/octet-stream" } });
  }

  function post(name: string, body: Uint8Array): Response {
    const json = (status: number, value: unknown, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
    if (body.length < 8) return json(400, { error: "no nonce" });
    const nonce = body.subarray(0, 8);
    const envelope = body.slice(8);
    if (envelope[0] !== 1 || !SIZES.includes(envelope.length)) return json(400, { error: "shape" });
    const digest = stampDigest(name, envelope);
    const pool = poolOf(name);
    const held = pool.held.find((h) => h.digest === hexOf(digest));
    if (held) return json(200, { kept: "already", expires: Math.floor((held.came + HOLD_MS) / 1000) });
    if (relay.waitOnce) {
      const status = relay.waitOnce;
      relay.waitOnce = undefined;
      return json(status, { error: "wait" }, { "retry-after": "30" });
    }
    if (relay.refusing) return json(429, { error: "too many posts from this address for now" }, { "retry-after": String(relay.refusing) });
    if (work(digest, nonce) < relay.price) return json(402, { error: "more proof of work", price: relay.price });
    const kept = keep(name, envelope);
    return json(200, { kept: "new", expires: Math.floor((kept.came + HOLD_MS) / 1000) });
  }

  return relay;
}
