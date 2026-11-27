// C2's first page (the 1.10.0 gate's round 5, ported from the verifiers'
// verify2-c2-first-page, which reproduced it at 48480cf8): every sync's first
// page used to wait for the whole inbox's unseal, and a stranger's first
// messages made that inbox large. Since round 5 a lane reads nothing before its
// first page but the read record, and that once a worker (fix item 4).
//
// Paired worlds: one relay, one pool. W (Carol) writes first messages to A's
// (Alice's) Seedelf, which A minted here, so it takes them (W8). A and B (Bob)
// read the same pages at the same cursors. At syncs with nothing new, what each
// reads from its sealed records before its first page request, and when that
// request goes, A against B, at N = 0, 1, 4, 8 of W's first messages and past
// the crate's bound. The records are asserted the same for both; the times are
// logged, and asserted only within a margin far past what load moves.
import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

import { PRIVATE_PREFIX } from "../src/background/private-store";
import { fromBase64 } from "../src/background/storage";
import {
  ALICE_SEEDELF,
  another,
  BOB_SEEDELF,
  CAROL_SEEDELF,
  clock,
  type Directory,
  fakeRelay,
  type FakeRelay,
  listed,
  loadTestWasm,
  party,
  type Party,
  synced,
  turnOn,
} from "./messaging-harness";

const INBOX = "messaging.preprod";
const SERVER = /^(GET|POST) |^chain /;

interface Seen {
  what: string;
  at: number;
  /** For a sealed record's read: its sealed data's length (base64) as it was then. */
  bytes?: number;
}

interface Watch {
  log: Seen[];
  /** Exact sizes parse each record read (slow): only where the time isn't measured. */
  exact: boolean;
}

/** Every entry the harness traces for `p` (requests, WebAssembly calls, sealed records' reads), with its time. */
function watch(p: Party): Watch {
  const w: Watch = { log: [], exact: true };
  const push = Array.prototype.push;
  p.trace.push = function (this: string[], ...items: string[]) {
    const at = performance.now();
    for (const what of items) {
      const got = /^get (.+)$/.exec(what);
      if (got) {
        const raw = p.local.data.get(PRIVATE_PREFIX + got[1]) as string | undefined;
        // `{"v":1,"nonce":"<32>","data":"<data>"}`: the sealed JSON is the data and 60 characters.
        const bytes = raw === undefined ? 0 : w.exact ? (JSON.parse(raw) as { data: string }).data.length : raw.length - 60;
        w.log.push({ what, at, bytes });
      } else w.log.push({ what, at });
    }
    return push.apply(this, items);
  } as typeof p.trace.push;
  return w;
}

/** A sealed record's data as stored now, its base64 length: what an unseal of it decrypts. */
const storedOf = (p: Party, name: string) => {
  const raw = p.local.data.get(PRIVATE_PREFIX + name) as string | undefined;
  return raw === undefined ? 0 : (JSON.parse(raw) as { data: string }).data.length;
};

const keptNew = () =>
  new Response(JSON.stringify({ kept: "new", expires: Math.floor((clock.now + 36 * 3600_000) / 1000) }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

interface World {
  relay: FakeRelay;
  directory: Directory;
  w: Party;
  a: Party;
  b: Party;
  wa: Watch;
  wb: Watch;
  /** Set while W writes: only W's posts reach the pool. A's and B's are answered by the test and kept nowhere. */
  writing: boolean;
  /** How many of W's first messages have reached A's Seedelf. */
  n: number;
  maxText: number;
}

async function world(): Promise<World> {
  const relay = fakeRelay(clock);
  const directory: Directory = new Map();
  const w = await party(15, relay, directory, CAROL_SEEDELF);
  const a = await party(12, relay, directory, ALICE_SEEDELF);
  const b = await party(24, relay, directory, BOB_SEEDELF);
  await turnOn(w, a, b);
  const x: World = { relay, directory, w, a, b, wa: watch(a), wb: watch(b), writing: false, n: 0, maxText: 0 };
  const real = relay.fetch;
  relay.fetch = async (url, init) => (init.method === "POST" && !x.writing ? keptNew() : real(url, init));
  // The longest text a first message carries: the crate's own bound, as the worker says it (messaging.ts checkLength).
  try {
    await w.messaging.start("preprod", ALICE_SEEDELF, "x".repeat(70_000));
    throw new Error("a 70,000-byte first message wasn't refused");
  } catch (e) {
    const m = /at most ([\d,]+) bytes/.exec((e as Error).message);
    if (!m) throw e;
    x.maxText = Number(m[1]!.replace(/,/g, ""));
  }
  return x;
}

/** W writes `k` first messages to A's Seedelf, each a conversation of its own, each its text at the most it can be. */
async function firstMessages(x: World, k: number): Promise<number[]> {
  const pool = () => x.relay.pools.get("preprod")?.held ?? [];
  const before = pool().length;
  x.writing = true;
  try {
    for (let i = 0; i < k; i++) {
      await x.w.messaging.start("preprod", ALICE_SEEDELF, `first message ${x.n + i} `.padEnd(x.maxText, "x"));
      await x.w.messaging.whenIdle();
    }
  } finally {
    x.writing = false;
  }
  x.n += k;
  const sizes = pool()
    .slice(before)
    .map((h) => h.bytes.length);
  expect(sizes).toHaveLength(k);
  return sizes;
}

interface Quiet {
  /** From sync() to the first page request (ms). */
  firstGetMs: number;
  /** From sync() to its end (ms). */
  syncMs: number;
  /** The sealed records read before the first page request, each with its sealed bytes. */
  before: Array<[string, number]>;
  /** What was asked of any server, in order. */
  asked: string[];
  /** Every sealed record read in the whole sync, with its bytes. */
  reads: Array<[string, number]>;
  /** The records read in the lane: from sync() to its last request. */
  lane: Array<[string, number]>;
}

/** One sync of `p` with nothing new, and what it did. */
async function quiet(p: Party, w: Watch): Promise<Quiet> {
  w.log.length = 0;
  const t0 = performance.now();
  await p.messaging.sync("preprod");
  const t1 = performance.now();
  await p.messaging.whenIdle();
  const first = w.log.findIndex((s) => s.what.startsWith("GET "));
  const last = w.log.map((s) => SERVER.test(s.what)).lastIndexOf(true);
  const gets = (from: Seen[]) => from.filter((s) => s.what.startsWith("get ")).map((s) => [s.what.slice(4), s.bytes!] as [string, number]);
  return {
    firstGetMs: first < 0 ? Number.NaN : w.log[first]!.at - t0,
    syncMs: t1 - t0,
    before: gets(w.log.slice(0, Math.max(0, first))),
    asked: w.log.filter((s) => SERVER.test(s.what)).map((s) => s.what),
    reads: gets(w.log),
    lane: gets(w.log.slice(0, last + 1)),
  };
}

interface Stats {
  n: number;
  min: number;
  p10: number;
  median: number;
  p90: number;
  max: number;
}
function stats(xs: number[]): Stats {
  const s = [...xs].sort((p, q) => p - q);
  const q = (f: number) => s[Math.min(s.length - 1, Math.max(0, Math.round(f * (s.length - 1))))]!;
  const r = (v: number) => Math.round(v * 100) / 100;
  return { n: s.length, min: r(s[0]!), p10: r(q(0.1)), median: r(q(0.5)), p90: r(q(0.9)), max: r(s.at(-1)!) };
}

/** Interleaved syncs with nothing new, A then B, then B then A: the same load on both. Every pair asks the same. */
async function timed(x: World, runs: number) {
  x.wa.exact = false;
  x.wb.exact = false;
  const a: Quiet[] = [];
  const b: Quiet[] = [];
  try {
    for (let i = 0; i < runs; i++) {
      if (i % 2 === 0) {
        a.push(await quiet(x.a, x.wa));
        b.push(await quiet(x.b, x.wb));
      } else {
        b.push(await quiet(x.b, x.wb));
        a.push(await quiet(x.a, x.wa));
      }
      expect(a.at(-1)!.asked).toEqual(b.at(-1)!.asked);
    }
  } finally {
    x.wa.exact = true;
    x.wb.exact = true;
  }
  const first = { a: stats(a.map((q) => q.firstGetMs)), b: stats(b.map((q) => q.firstGetMs)) };
  const whole = { a: stats(a.map((q) => q.syncMs)), b: stats(b.map((q) => q.syncMs)) };
  return { first, whole, ratio: Math.round((first.a.median / first.b.median) * 10) / 10 };
}

const RUNS = 25;
let x: World;
const table: Array<Record<string, unknown>> = [];

/** What A and B hold and read at N, deterministic; then the timing. */
async function stage(add: number) {
  if (add > 0) {
    await firstMessages(x, add);
    await synced(x.a);
    await synced(x.b);
  }
  const requestsA = (await x.a.messaging.overview("preprod")).requests.length;
  const requestsB = (await x.b.messaging.overview("preprod")).requests.length;
  const storedA = storedOf(x.a, INBOX);
  const storedB = storedOf(x.b, INBOX);
  // Deterministic: one sync each, nothing new.
  const qa = await quiet(x.a, x.wa);
  const qb = await quiet(x.b, x.wb);
  expect(qa.asked).toEqual(qb.asked);
  expect(qa.asked).toHaveLength(1);
  expect(qa.asked[0]).toMatch(/^GET \/messaging\/v1\/preprod\/envelopes\?after=\d+$/);
  // Before the first page nothing at all, for either: the read record is held since this worker's first lane (round 5).
  expect(qa.before).toEqual([]);
  expect(qb.before).toEqual([]);
  // And in the whole sync's lane only the lane's own records, at the same lengths for A as for B.
  expect(qa.lane).toEqual(qb.lane);
  const t = await timed(x, RUNS);
  const row = {
    N: x.n,
    requestsA,
    requestsB,
    storedA,
    storedB,
    unsealedBeforeFirstPage: { a: qa.before, b: qb.before },
    unsealedWholeSync: { a: qa.reads, b: qb.reads },
    asked: qa.asked,
    firstGetMs: t.first,
    ratioOfMedians: t.ratio,
    syncMs: t.whole,
  };
  table.push(row);
  console.log(`[c2 first page] ${JSON.stringify(row)}`);
  return { row, t, storedA, storedB, requestsA, requestsB };
}

describe("C2: the first page waits for nothing a stranger sized (round 5; the verifiers' verify2-c2)", { timeout: 300_000 }, () => {
  it("N = 0: A and B alike (control)", async () => {
    x = await world();
    const constants = JSON.parse(loadTestWasm().messagingConstants()) as Record<string, unknown>;
    console.log(`[c2 first page] crate bounds ${JSON.stringify(constants)}; longest first-message text ${x.maxText} bytes`);
    const s = await stage(0);
    expect(s.requestsA).toBe(0);
    expect(s.requestsB).toBe(0);
    expect(s.storedA).toBe(s.storedB);
  });

  it("N = 1: one first message, about 32 KB", async () => {
    const s = await stage(1);
    expect(s.requestsA).toBe(1);
    expect(s.requestsB).toBe(0);
    // The request is in its own record (round 5), which no lane reads.
    expect(storedOf(x.a, "messagingRequests.preprod")).toBeGreaterThan(storedOf(x.b, "messagingRequests.preprod"));
  });

  it("N = 4", async () => {
    const s = await stage(3);
    expect(s.requestsA).toBe(4);
    expect(storedOf(x.a, "messagingRequests.preprod")).toBeGreaterThan(87_000);
  });

  it("N = 8: the crate's 256 KiB of requests, about full", async () => {
    const s = await stage(4);
    expect(s.requestsA).toBe(8);
    expect(s.requestsB).toBe(0);
    // The requests are in their own record since round 5, 512 KiB of JSON sealed; the inbox keeps what the list shows.
    expect(storedOf(x.a, "messagingRequests.preprod")).toBe(699_072);
    expect(storedOf(x.b, "messagingRequests.preprod")).toBe(0);
    expect(s.storedA).toBeLessThan(10_000);
    // The time: A's first page as B's, within a margin far past what load moves (at 48480cf8 A's median was 82 ms).
    expect(s.t.first.a.median).toBeLessThan(s.t.first.b.median + 20);
  });

  it("N = 10: past the bound, the oldest requests go and the requests record stays at the most a stranger can make it", async () => {
    const s = await stage(2);
    expect(s.requestsA).toBe(8);
    expect(storedOf(x.a, "messagingRequests.preprod")).toBe(699_072);
    expect(s.t.first.a.median).toBeLessThan(s.t.first.b.median + 20);
    // What A's inbox holds, field by field, as stored (JSON characters before sealing): no requests' record in it.
    const stored = (await x.a.store.get<Record<string, unknown>>(INBOX))!;
    const fields = Object.fromEntries(Object.entries(stored).map(([k, v]) => [k, JSON.stringify(v).length]));
    const storedB = (await x.b.store.get<Record<string, unknown>>(INBOX))!;
    const fieldsB = Object.fromEntries(Object.entries(storedB).map(([k, v]) => [k, JSON.stringify(v).length]));
    console.log(`[c2 first page] A's inbox fields ${JSON.stringify(fields)}; B's ${JSON.stringify(fieldsB)}`);
    expect(fields.requests).toBeUndefined();
    console.log(`[c2 first page] table ${JSON.stringify(table.map((r) => ({ N: r.N, storedA: r.storedA, storedB: r.storedB, a: (r.firstGetMs as { a: Stats }).a, b: (r.firstGetMs as { b: Stats }).b, ratio: r.ratioOfMedians })))}`);
  });

  it("one read of A's requests record at the bound, as the take reads it (no lane does): the store's unseal and the hex, logged", async () => {
    // messaging.ts's own hex, as `hexOfBase64` makes the requests' record (:695-707).
    const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
    const hexOf = (bytes: Uint8Array) => {
      let out = "";
      for (const b of bytes) out += HEX[b];
      return out;
    };
    const parts: Record<string, number[]> = { areaJson: [], fromBase64: [], decrypt: [], decodeAndParse: [], requestsToHex: [], whole: [] };
    for (const p of [x.a]) {
      const raw = p.local.data.get(PRIVATE_PREFIX + "messagingRequests.preprod") as string;
      const got: Record<string, number[]> = { areaJson: [], fromBase64: [], decrypt: [], decodeAndParse: [], requestsToHex: [], whole: [] };
      for (let i = 0; i < 15; i++) {
        const start = performance.now();
        let t = start;
        const sealed = JSON.parse(raw) as { nonce: string; data: string };
        got.areaJson!.push(performance.now() - t);
        await p.wallet.withStoreKey((key) => {
          t = performance.now();
          const data = fromBase64(sealed.data);
          const nonce = fromBase64(sealed.nonce);
          got.fromBase64!.push(performance.now() - t);
          t = performance.now();
          const plain = xchacha20poly1305(key, nonce, new TextEncoder().encode(PRIVATE_PREFIX + "messagingRequests.preprod")).decrypt(data);
          got.decrypt!.push(performance.now() - t);
          t = performance.now();
          const inbox = JSON.parse(new TextDecoder().decode(plain)) as { requests?: string };
          got.decodeAndParse!.push(performance.now() - t);
          t = performance.now();
          if (inbox.requests !== undefined) hexOf(fromBase64(inbox.requests));
          got.requestsToHex!.push(performance.now() - t);
        });
        got.whole!.push(performance.now() - start);
      }
      const medians = Object.fromEntries(Object.entries(got).map(([k, v]) => [k, stats(v).median]));
      console.log(`[c2 first page] one read of A's requests record (${storedOf(p, "messagingRequests.preprod")} bytes), medians of 15 (ms): ${JSON.stringify(medians)}`);
      Object.assign(parts, got);
    }
    // At full speed since round 5 (fix item 5.3): far under what it took at 48480cf8 (53 to 86 ms for base64 alone).
    expect(stats(parts.whole!).median).toBeLessThan(100);
  });
});

describe("C2's reach: a Seedelf under the key that takes no first messages (W8) grows nothing (the verifiers' verify2-c2)", { timeout: 300_000 }, () => {
  it("W's eight longest first messages to A's second Seedelf, not minted here and not turned on: A's inbox stays B's size", async () => {
    const y = await world();
    // A second Seedelf under A's key, in A's kept view, that this browser didn't mint: it takes no first messages.
    const ALICE2 = "5eed0e1f00" + Buffer.from("alice2").toString("hex");
    const register = await another(y.a);
    y.a.own.push({ name: ALICE2, register });
    y.directory.set(ALICE2, register);
    // Its certificate on the list, as another browser of A's phrase posted it (chunk 55's 55e): W can write to it.
    await listed(y.relay, y.a, ALICE2, register);
    // Its name is a byte longer than ALICE's, and F with it: the longest text is probed again.
    let longest = 0;
    try {
      await y.w.messaging.start("preprod", ALICE2, "x".repeat(70_000));
    } catch (e) {
      longest = Number(/at most ([\d,]+) bytes/.exec((e as Error).message)![1]!.replace(/,/g, ""));
    }
    y.writing = true;
    for (let i = 0; i < 8; i++) {
      await y.w.messaging.start("preprod", ALICE2, `to the other ${i} `.padEnd(longest, "x"));
      await y.w.messaging.whenIdle();
    }
    y.writing = false;
    for (const p of [y.a, y.b, y.a, y.b]) await synced(p);
    // A's scan found them its own and its take refused each without a word: nothing grew.
    expect((await y.a.messaging.overview("preprod")).requests).toHaveLength(0);
    expect(storedOf(y.a, INBOX)).toBe(storedOf(y.b, INBOX));
    const qa = await quiet(y.a, y.wa);
    const qb = await quiet(y.b, y.wb);
    expect(qa.asked).toEqual(qb.asked);
    expect(qa.before).toEqual(qb.before);
    expect(qa.lane).toEqual(qb.lane);
    const t = await timed(y, 21);
    console.log(`[c2 first page] a Seedelf taking no first messages: ${JSON.stringify({ stored: [storedOf(y.a, INBOX), storedOf(y.b, INBOX)], firstGetMs: t.first, ratio: t.ratio })}`);
    expect(t.first.a.median).toBeLessThan(t.first.b.median + 20);
  });
});
