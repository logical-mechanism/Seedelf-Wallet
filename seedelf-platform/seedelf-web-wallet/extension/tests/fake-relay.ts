// A Seedelf Messaging relay in memory (protocol.md §17), for the worker's
// tests: a pool per network, pages behind a cursor, the stamp checked with
// its own SHA-256 (noble's, not the WebAssembly's), already held before the
// price, and a price the test sets, for every size or for each (§17.4 prices
// and refuses by size: a larger envelope is more units of an address's
// window). It doesn't check an envelope's points: the relay's own tests do
// (seedelf-data's api/src/messaging/).
//
// Beside each pool, its certificate list (chunk 55, §21.7): a post's checks in
// §21.7's order (a nonce, the shape, already held, the price and the
// address's window, the stamp over the listing digest, the room, then the
// points and the proof, through `checkCertificate` where a test gives one, as
// the harness does with the WebAssembly's own check, then the chain, through
// `chain` where a test gives one), the list's sequence behind a cursor, pages
// of kind entries with the price a post is asked, and removals in a
// certificate's place. A kept answer names the listing digest of the
// certificate the list holds (F10): an `already`'s may be another posting's
// bytes. Check 3″ holds at most 32 withdrawn digests for one Seedelf and
// register (128 now). A path spelled with a percent-encoding is a 400, and a
// body past its route's longest a 413, as the edge's. The list's cap counts
// its removals and withdrawn digests too. A cursor below `forgotten`, or past
// the last number given, is a gap; `renumberList` gives every entry a new
// number above it, as a compaction or an unclean restore does. And its
// withdrawals (§21.7): their checks in order (the length, the shape, a
// certificate held under the digest, else a 404, the price and window, the
// stamp over the unlisting digest, then the proof, through
// `checkWithdrawal` where a test gives one), a removal in the withdrawn
// certificate's place.

import { sha256 } from "@noble/hashes/sha2.js";

import type { NetworkName } from "../src/networks";
import { RateLimit } from "../src/background/koios";
import { PAGE_MAX_BYTES, RelayClient } from "../src/background/relay";

const SIZES = [512, 2048, 8192, 32768];
const LABEL = new TextEncoder().encode("Seedelf-Messaging|v1|stamp|");
const LISTING_LABEL = new TextEncoder().encode("Seedelf-Messaging|v1|listing-stamp|");
const UNLISTING_LABEL = new TextEncoder().encode("Seedelf-Messaging|v1|unlisting-stamp|");
/** BLS12-381's group order: a withdrawal's c and z are below it. */
const Q = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;
const HOLD_MS = 36 * 3600_000;

/** Variant 1's Seedelf policy, the same on both networks (seedelf-core's constants.rs): what a certificate must name. */
export const SEEDELF_POLICY = "84967d911e1a10d5b4a38441879f374a07f340945bcf9e7697485255";
/** A certificate's network byte (§21.2). */
const NETWORK_BYTE: Record<string, number> = { preprod: 0x00, mainnet: 0x01 };
/** The most a list page holds (§21.7): 64 KiB of entries. */
const LIST_PAGE_BYTES = 64 * 1024;

/** One entry of a pool's certificate list, in its sequence: a certificate (kind 1), or a removal (kind 2). */
interface ListEntry {
  number: bigint;
  kind: 1 | 2;
  bytes: Uint8Array;
}

interface Held {
  number: bigint;
  bytes: Uint8Array;
  digest: string;
  came: number;
}

export interface FakeRelay {
  /** The fetch every client the relay makes goes through. */
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /**
   * A client of `pool`, as the worker makes one, with a rate limit of its own that never waits on the test's clock: a
   * hold (a 429's) passes on a clock of the limit's own, at once. `seen` is told each of its requests, as `calls` names
   * them (with what it sends), before the relay answers.
   */
  client(pool: NetworkName, seen?: (call: string, init: RequestInit) => void): RelayClient;
  pools: Map<string, { held: Held[]; next: bigint }>;
  /** The bits a post must show, for every size. */
  price: number;
  /** The bits a post of each size must show (512, 2,048, 8,192, 32,768), where a test sets them apart: `price` otherwise. */
  prices?: [number, number, number, number];
  /**
   * The sizes this address can't post now, each for this many seconds, as its window says (§17.4): the page prices
   * each of them 0, and a post of one is a 429 with that Retry-After before its work is looked at. The rest go on.
   */
  refusingSizes?: Partial<Record<number, number>>;
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
  /**
   * Each pool's certificate list (§21.7), in the order it took its entries, its next number, and the listing digests a
   * withdrawal took down (check 3′: those bytes are never listed again).
   */
  lists: Map<string, { entries: ListEntry[]; next: bigint; forgotten: bigint; withdrawn: Set<string>; withdrawnAt: Map<string, number> }>;
  /** Check 3″'s bound: the most withdrawn digests held for one (N, register), 128 as the relay's. */
  withdrawnMost: number;
  /**
   * Renumbers every entry of `pool`'s list above a new `forgotten`, as the relay's compaction and an unclean restore do:
   * a reader with an older cursor gets one gap, starts again from the oldest and reads forward.
   */
  renumberList(pool: NetworkName): void;
  /**
   * §21.7's check 7, the points and the proof: false, a 400. Without one, every certificate whose shape reads is taken,
   * as an envelope's points aren't checked here. The harness gives the WebAssembly's own (`messagingCheckCertificate`).
   */
  checkCertificate?: (pool: string, certificate: string) => boolean;
  /**
   * §21.7's check 8, the chain: whether (g_S, u_S) is the datum register of the contract UTxO that holds N now, as the
   * relay's view of the chain says; false, a 409 `not this Seedelf's register now`; "down", a 503 `can't check the
   * chain now`. Without one, every certificate passes it.
   */
  chain?: (pool: string, name: string, register: { generator: string; publicValue: string }) => boolean | "down";
  /** What the list holds at most, its certificates' bytes (§21.7's cap): past it, a 503. */
  listCap: number;
  /**
   * A withdrawal's proof (§21.7's withdrawals, check 6), against the certificate the list holds under its digest:
   * false, a 400. Without one, every withdrawal whose shape reads and whose digest the list holds is taken.
   */
  checkWithdrawal?: (pool: string, certificate: string, withdrawal: string) => boolean;
  /** The most entries a list page holds, so a test can make several. */
  listPageCount: number;
  /** The next list page asked from a cursor says there's a gap, and starts from the oldest entry held. */
  listGapOnce: boolean;
  /** Puts `certificate` (hex) in `pool`'s list as if posted, whatever its checks. */
  putCertificate(pool: NetworkName, certificate: string): void;
  /** Takes `certificate` (hex) off `pool`'s list, a removal in its place, as for a Seedelf no longer at its register. */
  removeCertificate(pool: NetworkName, certificate: string): void;
  /** The certificates `pool`'s list holds now (hex), in its order. */
  certificatesIn(pool: NetworkName): string[];
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

/** A certificate's listing digest (§21.7): what its post's stamp is over, and what a removal names it by. */
export function listingDigest(pool: string, certificate: Uint8Array): Uint8Array {
  const name = new TextEncoder().encode(pool);
  const all = new Uint8Array(LISTING_LABEL.length + 1 + name.length + certificate.length);
  all.set(LISTING_LABEL);
  all[LISTING_LABEL.length] = name.length;
  all.set(name, LISTING_LABEL.length + 1);
  all.set(certificate, LISTING_LABEL.length + 1 + name.length);
  return sha256(all);
}

/**
 * A certificate's shape (§21.4's check 1, §21.7's check 2): its length, version, network, generation and policy; and
 * what it names, the Seedelf (its name and register) and its m_S, as hex.
 */
function shapeOf(
  pool: string,
  c: Uint8Array,
): { seedelf: string; messaging: string; name: string; register: { generator: string; publicValue: string } } | undefined {
  if (c.length < 273 || c.length > 304) return undefined;
  const n = c[31]!;
  if (c[0] !== 1 || c[1] !== NETWORK_BYTE[pool] || c[2] !== 0 || hexOf(c.subarray(3, 31)) !== SEEDELF_POLICY) return undefined;
  if (n < 1 || n > 32 || c.length !== 272 + n) return undefined;
  return {
    seedelf: hexOf(c.subarray(31, 32 + n + 96)),
    messaging: hexOf(c.subarray(32 + n + 96, 32 + n + 144)),
    name: hexOf(c.subarray(32, 32 + n)),
    register: { generator: hexOf(c.subarray(32 + n, 32 + n + 48)), publicValue: hexOf(c.subarray(32 + n + 48, 32 + n + 96)) },
  };
}

/** A withdrawal's stamp digest (§21.7): what its post's work is over. */
export function unlistingDigest(pool: string, withdrawal: Uint8Array): Uint8Array {
  const name = new TextEncoder().encode(pool);
  const all = new Uint8Array(UNLISTING_LABEL.length + 1 + name.length + withdrawal.length);
  all.set(UNLISTING_LABEL);
  all[UNLISTING_LABEL.length] = name.length;
  all.set(name, UNLISTING_LABEL.length + 1);
  all.set(withdrawal, UNLISTING_LABEL.length + 1 + name.length);
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
    lists: new Map(),
    listCap: 8 * 1024 * 1024,
    withdrawnMost: 128,
    listPageCount: 1000,
    listGapOnce: false,
    now: () => clock.now,
    client: (pool, seen) => {
      // What the limit has slept, on top of the test's clock: a sleep that returned at once with the clock where it was
      // would spin for ever on a hold.
      let slept = 0;
      return new RelayClient({
        origin: "https://relay.test",
        pool,
        // Read at each request: a test may put its own `fetch` in the relay's place.
        fetch: (url, init) => {
          const u = new URL(url);
          seen?.(`${init.method} ${u.pathname}${u.search}`, init);
          return relay.fetch(url, init);
        },
        limit: new RateLimit(
          1_000_000,
          1000,
          () => clock.now + slept,
          async (ms) => {
            slept += ms;
          },
        ),
      });
    },
    put(pool, envelope) {
      keep(pool, bytesOf(envelope));
    },
    putCertificate(pool, certificate) {
      list(pool).push(bytesOf(certificate));
    },
    removeCertificate(pool, certificate) {
      list(pool).remove(bytesOf(certificate));
    },
    renumberList(pool) {
      const { at } = list(pool);
      at.next += 1000n;
      at.forgotten = at.next - 1n;
      for (const e of at.entries) e.number = at.next++;
    },
    certificatesIn(pool) {
      return list(pool)
        .held()
        .map((e) => hexOf(e.bytes));
    },
    async fetch(url, init) {
      const u = new URL(url);
      relay.calls.push(`${init.method} ${u.pathname}${u.search}`);
      if (!relay.up) throw new TypeError("Failed to fetch");
      // The routes decode a pool's name: a path spelled with a percent-encoding is refused (§21.7's off switch note).
      if (u.pathname.startsWith("/messaging/") && u.pathname.includes("%")) {
        return new Response(JSON.stringify({ error: "encoded paths aren't taken here" }), { status: 400, headers: { "content-type": "application/json" } });
      }
      const match = /^\/messaging\/v1\/(mainnet|preprod)\/(envelopes|certificates|withdrawals)$/.exec(u.pathname);
      if (!match) return new Response("not found", { status: 404 });
      const pool = match[1]!;
      // The edge: a body past its route's longest (a nonce and the largest envelope, the longest certificate, or a
      // withdrawal) is a 413, before the relay looks.
      if (init.method === "POST") {
        const most = match[2] === "envelopes" ? 8 + 32768 : match[2] === "certificates" ? 8 + 304 : 8 + 98;
        if (new Uint8Array(init.body as ArrayBuffer).length > most) {
          return new Response(JSON.stringify({ error: "the body is too long" }), { status: 413, headers: { "content-type": "application/json" } });
        }
      }
      if (match[2] === "certificates") {
        if (init.method === "GET") return listPage(pool, u.searchParams.get("after"));
        return postCertificate(pool, new Uint8Array(init.body as ArrayBuffer));
      }
      if (match[2] === "withdrawals") {
        if (init.method !== "POST") return new Response("not found", { status: 404 });
        return postWithdrawal(pool, new Uint8Array(init.body as ArrayBuffer));
      }
      if (init.method === "GET") return page(pool, u.searchParams.get("after"));
      return post(pool, new Uint8Array(init.body as ArrayBuffer));
    },
  };

  /** What a post of `size` bytes is asked now: 0 while this address is refused, at every size or at this one. */
  const priceOf = (size: number) =>
    relay.refusing || relay.refusingSizes?.[size] ? 0 : (relay.prices?.[SIZES.indexOf(size)] ?? relay.price);

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
    // At most `pageCount` envelopes, and 256 KiB of them (§17.5), as the client holds a page to.
    const taken: Held[] = [];
    let bytes = 0;
    for (const h of rest.slice(0, relay.pageCount)) {
      if (bytes + h.bytes.length > PAGE_MAX_BYTES) break;
      bytes += h.bytes.length;
      taken.push(h);
    }
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
    out.set(SIZES.map(priceOf), 10);
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
    const sized = relay.refusingSizes?.[envelope.length];
    if (sized) return json(429, { error: "this address's share of the pool is full for now" }, { "retry-after": String(sized) });
    const price = priceOf(envelope.length);
    if (work(digest, nonce) < price) return json(402, { error: "more proof of work", price });
    const kept = keep(name, envelope);
    return json(200, { kept: "new", expires: Math.floor((kept.came + HOLD_MS) / 1000) });
  }

  /** `name`'s certificate list: what it holds, a certificate taken, one taken off with a removal in its place. */
  function list(name: string) {
    let pool = relay.lists.get(name);
    if (!pool) relay.lists.set(name, (pool = { entries: [], next: 5_000_000n, forgotten: 4_999_999n, withdrawn: new Set(), withdrawnAt: new Map() }));
    const at = pool;
    return {
      held: () => at.entries.filter((e) => e.kind === 1),
      push(certificate: Uint8Array) {
        at.entries.push({ number: at.next++, kind: 1, bytes: certificate });
      },
      remove(certificate: Uint8Array) {
        const digest = hexOf(listingDigest(name, certificate));
        const i = at.entries.findIndex((e) => e.kind === 1 && hexOf(listingDigest(name, e.bytes)) === digest);
        if (i < 0) return;
        at.entries.splice(i, 1);
        at.entries.push({ number: at.next++, kind: 2, bytes: bytesOf(digest) });
      },
      at,
    };
  }

  /** A page of `name`'s list after `after` (§21.7): kind entries, at most 64 KiB of them, and the price a post is asked. */
  function listPage(name: string, after: string | null): Response {
    const { at } = list(name);
    // A cursor this list didn't give, or one that may have missed entries (below `forgotten`): a gap, as the relay's.
    const asked = after === null ? undefined : BigInt(after);
    const gap = (relay.listGapOnce && after !== null) || (asked !== undefined && (asked > at.next - 1n || asked < at.forgotten));
    relay.listGapOnce = false;
    // After a gap, the page starts from the oldest entry held.
    const from = after === null || gap ? -1n : BigInt(after);
    const rest = at.entries.filter((e) => e.number > from);
    const taken: ListEntry[] = [];
    let bytes = 0;
    for (const e of rest.slice(0, relay.listPageCount)) {
      if (bytes + e.bytes.length > LIST_PAGE_BYTES) break;
      bytes += e.bytes.length;
      taken.push(e);
    }
    const more = rest.length > taken.length;
    const cursor = taken.at(-1)?.number ?? at.next - 1n;
    const out = new Uint8Array(13 + taken.reduce((n, e) => n + 3 + e.bytes.length, 0));
    const view = new DataView(out.buffer);
    out[0] = 1;
    out[1] = (more ? 1 : 0) | (gap ? 2 : 0);
    view.setBigUint64(2, cursor);
    // A certificate is priced as a 512-byte envelope from the same address.
    out[10] = priceOf(512);
    view.setUint16(11, taken.length);
    let i = 13;
    for (const e of taken) {
      out[i] = e.kind;
      view.setUint16(i + 1, e.bytes.length);
      out.set(e.bytes, i + 3);
      i += 3 + e.bytes.length;
    }
    return new Response(out, { status: 200, headers: { "content-type": "application/octet-stream" } });
  }

  /** A certificate's post (§21.7): its checks in order, cheapest first, the first that fails answering. */
  function postCertificate(name: string, body: Uint8Array): Response {
    const json = (status: number, value: unknown, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
    // 1. A nonce.
    if (body.length < 8) return json(400, { error: "no nonce" });
    const nonce = body.subarray(0, 8);
    const certificate = body.slice(8);
    // 2. The shape.
    const shape = shapeOf(name, certificate);
    if (!shape) return json(400, { error: "not a certificate" });
    const pool = list(name);
    const entries = pool.held();
    const held = entries.map((e) => shapeOf(name, e.bytes)!);
    // 3. Already held: a certificate for the same Seedelf, register and m_S, whatever the stamp; the answer names the
    // listing digest of the one held, which may be another posting's bytes (F10).
    const same = held.findIndex((h) => h.seedelf === shape.seedelf && h.messaging === shape.messaging);
    if (same >= 0) return json(200, { kept: "already", digest: hexOf(listingDigest(name, entries[same]!.bytes)) });
    // 3′. Not withdrawn: bytes a withdrawal took down are never listed again.
    if (pool.at.withdrawn.has(hexOf(listingDigest(name, certificate)))) return json(409, { error: "withdrawn" });
    // 3″. Not withdrawn too often: fewer than 32 withdrawn digests held for its Seedelf and register.
    if ((pool.at.withdrawnAt.get(shape.seedelf) ?? 0) >= relay.withdrawnMost) {
      return json(409, { error: "this Seedelf was withdrawn too often at this register: move it to list it again" });
    }
    // 4. The price and the address's window, as a 512-byte envelope's.
    if (relay.waitOnce) {
      const status = relay.waitOnce;
      relay.waitOnce = undefined;
      return json(status, { error: "wait" }, { "retry-after": "30" });
    }
    if (relay.refusing) return json(429, { error: "too many posts from this address for now" }, { "retry-after": String(relay.refusing) });
    const sized = relay.refusingSizes?.[512];
    if (sized) return json(429, { error: "this address's share of the pool is full for now" }, { "retry-after": String(sized) });
    // 5. The stamp, over the listing digest.
    const price = priceOf(512);
    if (work(listingDigest(name, certificate), nonce) < price) return json(402, { error: "more proof of work", price });
    // 6. Room: fewer than two m_S held for its Seedelf, and the list under its cap.
    if (new Set(held.filter((h) => h.seedelf === shape.seedelf).map((h) => h.messaging)).size >= 2) {
      return json(409, { error: "two certificates for this Seedelf already" });
    }
    // The cap counts every entry's bytes, removals included, and the withdrawn digests, 32 bytes each.
    const used = pool.at.entries.reduce((n, e) => n + e.bytes.length, 0) + 32 * pool.at.withdrawn.size;
    if (used + certificate.length > relay.listCap) return json(503, { error: "the list is full" });
    // 7. The points and the proof.
    if (relay.checkCertificate && !relay.checkCertificate(name, hexOf(certificate))) return json(400, { error: "the certificate doesn't check" });
    // 8. The chain: its register the datum of the contract UTxO that holds its Seedelf now.
    const chain = relay.chain?.(name, shape.name, shape.register) ?? true;
    if (chain === "down") return json(503, { error: "can't check the chain now" }, { "retry-after": "60" });
    if (!chain) return json(409, { error: "not this Seedelf's register now" });
    pool.push(certificate);
    return json(200, { kept: "new", digest: hexOf(listingDigest(name, certificate)) });
  }

  /** A withdrawal's post (§21.7): its checks in order, cheapest first, the first that fails answering. */
  function postWithdrawal(name: string, body: Uint8Array): Response {
    const json = (status: number, value: unknown, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
    // 1. The length: a nonce and 98 bytes.
    if (body.length !== 106) return json(400, { error: "not a withdrawal" });
    const nonce = body.subarray(0, 8);
    const withdrawal = body.slice(8);
    // 2. The shape: version 1, the pool's network, c and z below q.
    const below = (at: number) => BigInt(`0x${hexOf(withdrawal.subarray(at, at + 32))}`) < Q;
    if (withdrawal[0] !== 1 || withdrawal[1] !== NETWORK_BYTE[name] || !below(34) || !below(66)) return json(400, { error: "not a withdrawal" });
    // 3. A certificate the list holds under its digest.
    const pool = list(name);
    const digest = hexOf(withdrawal.subarray(2, 34));
    const held = pool.held().find((e) => hexOf(listingDigest(name, e.bytes)) === digest);
    if (!held) return json(404, { error: "no such certificate" });
    // 4. The price and window, as a 512-byte envelope's.
    if (relay.waitOnce) {
      const status = relay.waitOnce;
      relay.waitOnce = undefined;
      return json(status, { error: "wait" }, { "retry-after": "30" });
    }
    if (relay.refusing) return json(429, { error: "too many posts from this address for now" }, { "retry-after": String(relay.refusing) });
    const sized = relay.refusingSizes?.[512];
    if (sized) return json(429, { error: "this address's share of the pool is full for now" }, { "retry-after": String(sized) });
    // 5. The stamp, over the unlisting digest.
    const price = priceOf(512);
    if (work(unlistingDigest(name, withdrawal), nonce) < price) return json(402, { error: "more proof of work", price });
    // 6. The proof, against the held certificate's messaging register.
    if (relay.checkWithdrawal && !relay.checkWithdrawal(name, hexOf(held.bytes), hexOf(withdrawal))) return json(400, { error: "the withdrawal doesn't check" });
    pool.remove(held.bytes);
    pool.at.withdrawn.add(digest);
    const seedelf = shapeOf(name, held.bytes)!.seedelf;
    pool.at.withdrawnAt.set(seedelf, (pool.at.withdrawnAt.get(seedelf) ?? 0) + 1);
    return json(200, { withdrawn: true });
  }

  return relay;
}
