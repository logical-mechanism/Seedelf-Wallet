// C2's overview face (the 1.10.0 gate's round 5, ported from the verifiers'
// verify2-c2-overview-queue, which reproduced it at 48480cf8): a wallet page
// that's open reads the overview again whenever the worker says the network
// changed, and the relay chooses when a read says so (a page that fails, then
// one that answers). That reload used to unseal the whole inbox in the
// wallet's queue in front of the next page. Since round 5 the notice waits for
// the lane's end, and the overview answers from memory (fix item 4, O8).
//
// Paired worlds: one relay, one pool, the same pages to A and B; A holds W's
// eight first messages (the crate's 256 KiB of requests), B none. Each has a
// page open. What runs between a read's first and second page request is
// asserted the same for both, and no reload is among it; the gap's time is
// logged, and asserted only within a margin far past what load moves, at its
// lower decile: load only adds time, and on a runner busy with the rest of
// the suite it splits 32-envelope rounds into two groups about 25 ms apart,
// so a median of 20 lands in either (PR #417's CI: A 59, B 38). The fault this
// guards slowed every round (at 48480cf8 A's gap was 96 to 201 ms). The
// harness's own wait (a setImmediate) and the worker's (a setTimeout of 0)
// both.
import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import { PRIVATE_PREFIX } from "../src/background/private-store";
import type { NetworkName } from "../src/networks";
import {
  ALICE_SEEDELF,
  BOB_SEEDELF,
  CAROL_SEEDELF,
  clock,
  type Directory,
  fakeRelay,
  type FakeRelay,
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
}

function watch(p: Party): Seen[] {
  const log: Seen[] = [];
  const push = Array.prototype.push;
  p.trace.push = function (this: string[], ...items: string[]) {
    const at = performance.now();
    for (const what of items) log.push({ what, at });
    return push.apply(this, items);
  } as typeof p.trace.push;
  return log;
}

const storedOf = (p: Party, name: string) => {
  const raw = p.local.data.get(PRIVATE_PREFIX + name) as string | undefined;
  return raw === undefined ? 0 : (JSON.parse(raw) as { data: string }).data.length;
};

const keptNew = () =>
  new Response(JSON.stringify({ kept: "new", expires: Math.floor((clock.now + 36 * 3600_000) / 1000) }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** 512 bytes nobody's, at the version the relay takes: the smallest envelope. */
const junk = (n: number) => "01" + n.toString(16).padStart(8, "0") + "5a".repeat(507);

/** A Seedelf under a key no wallet of the test holds: W's first messages to it are well formed and nobody's here. */
const DAVE_SEEDELF = "5eed0e1f00" + Buffer.from("dave").toString("hex");

/**
 * A register of a fresh key that no party holds, and the certificate for Dave's Seedelf there that its own wallet would
 * post (chunk 55's 55e): what lets W write to it.
 */
function strangersRegister(): { register: { generator: string; publicValue: string }; certificate: string } {
  const wasm = loadTestWasm();
  const key = wasm.SeedelfKey.fromEntropy(crypto.getRandomValues(new Uint8Array(16)), 0);
  const messaging = wasm.MessagingKey.random("preprod");
  const base = key.baseRegister();
  const r = wasm.rerandomize(base);
  try {
    const register = { generator: r.generator, publicValue: r.publicValue };
    const { certificate } = JSON.parse(wasm.messagingCertificate(key, messaging, JSON.stringify({ network: "preprod", name: DAVE_SEEDELF, register }))) as {
      certificate: string;
    };
    return { register, certificate };
  } finally {
    r.free();
    base.free();
    messaging.free();
    key.free();
  }
}

interface Page {
  /** Reloads made: when each began and ended (ms). */
  reloads: Array<{ from: number; to?: number }>;
  /** Reloads asked and not yet ended. */
  pending: number;
  open: boolean;
  /** The way to the page and back, before its call reaches the worker. */
  delay: () => Promise<void>;
}

/** A wallet page open on `p`: at each 'changed', after `delay`, it asks the overview again, as useMessagingOverview does. */
function page(p: Party): Page {
  const pg: Page = { reloads: [], pending: 0, open: false, delay: () => new Promise((r) => setImmediate(r)) };
  const push = Array.prototype.push;
  p.changed.push = function (this: NetworkName[], ...items: NetworkName[]) {
    for (const n of items) {
      if (!pg.open) continue;
      pg.pending++;
      void pg.delay().then(async () => {
        const reload: { from: number; to?: number } = { from: performance.now() };
        pg.reloads.push(reload);
        await p.messaging.overview(n).catch(() => undefined);
        reload.to = performance.now();
        pg.pending--;
      });
    }
    return push.apply(this, items);
  } as typeof p.changed.push;
  return pg;
}

/** Until every reload asked has ended. */
async function settle(pg: Page): Promise<void> {
  for (let i = 0; i < 2000 && pg.pending > 0; i++) await new Promise((r) => setTimeout(r, 1));
  expect(pg.pending).toBe(0);
}

interface World {
  relay: FakeRelay;
  w: Party;
  a: Party;
  b: Party;
  la: Seen[];
  lb: Seen[];
  pa: Page;
  pb: Page;
  writing: boolean;
  junk: number;
  /** W's first messages to a Seedelf nobody here holds, hex: copies of them fill pages that take a real scan. */
  nobodys: string[];
}

async function world(): Promise<World> {
  const relay = fakeRelay(clock);
  const directory: Directory = new Map();
  const w = await party(15, relay, directory, CAROL_SEEDELF);
  const a = await party(12, relay, directory, ALICE_SEEDELF);
  const b = await party(24, relay, directory, BOB_SEEDELF);
  await turnOn(w, a, b);
  const x: World = { relay, w, a, b, la: watch(a), lb: watch(b), pa: page(a), pb: page(b), writing: false, junk: 0, nobodys: [] };
  const real = relay.fetch;
  relay.fetch = async (url, init) => (init.method === "POST" && !x.writing ? keptNew() : real(url, init));
  let max = 0;
  try {
    await w.messaging.start("preprod", ALICE_SEEDELF, "x".repeat(70_000));
  } catch (e) {
    max = Number(/at most ([\d,]+) bytes/.exec((e as Error).message)![1]!.replace(/,/g, ""));
  }
  x.writing = true;
  for (let i = 0; i < 8; i++) {
    await w.messaging.start("preprod", ALICE_SEEDELF, `first message ${i} `.padEnd(max, "x"));
    await w.messaging.whenIdle();
  }
  // Nobody's here, well formed: first messages to a Seedelf under a key no party holds.
  const dave = strangersRegister();
  directory.set(DAVE_SEEDELF, dave.register);
  relay.putCertificate("preprod", dave.certificate);
  const held = () => relay.pools.get("preprod")!.held;
  const before = held().length;
  for (let i = 0; i < 32; i++) {
    await w.messaging.start("preprod", DAVE_SEEDELF, `to Dave ${i}`);
    await w.messaging.whenIdle();
  }
  x.nobodys = held()
    .slice(before)
    .map((h) => Buffer.from(h.bytes).toString("hex"));
  expect(x.nobodys).toHaveLength(32);
  x.writing = false;
  for (const p of [a, b, a, b]) await synced(p);
  // The requests in their own record (round 5): A's at the bound, B's none.
  expect(storedOf(a, "messagingRequests.preprod")).toBe(699_072);
  expect(storedOf(b, "messagingRequests.preprod")).toBe(0);
  return x;
}

interface Round {
  asked: string[];
  /** From the read's first page request to its second (ms). */
  gapMs: number;
  /** The sealed records read between the two page requests. */
  between: string[];
  /** Whether a reload of the overview began before the second page request went. */
  reloadBefore: boolean;
}

/**
 * One round for `p`: a read the relay doesn't answer (so the network is `offline`), then, the relay answering again, a
 * read of two pages of `perPage` envelopes nobody's each, which says 'changed' as its first page comes.
 */
async function round(x: World, p: Party, log: Seen[], pg: Page, _perPage: number): Promise<Round> {
  x.relay.up = false;
  await p.messaging.sync("preprod");
  await p.messaging.whenIdle();
  await settle(pg);
  x.relay.up = true;
  log.length = 0;
  pg.reloads.length = 0;
  await p.messaging.sync("preprod");
  await p.messaging.whenIdle();
  await settle(pg);
  const gets = log.flatMap((s, i) => (s.what.startsWith("GET ") ? [i] : []));
  const second = log[gets[1]!]!.at;
  return {
    asked: log.filter((s) => SERVER.test(s.what)).map((s) => s.what),
    gapMs: second - log[gets[0]!]!.at,
    between: log
      .slice(gets[0]! + 1, gets[1]!)
      .filter((s) => /^(get|set) /.test(s.what))
      .map((s) => s.what),
    reloadBefore: pg.reloads.some((r) => r.from < second),
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

/**
 * `k` rounds each, A and B interleaved, each round's two pages put in the pool for both: envelopes nobody's, junk or
 * (`wellFormed`) copies of W's first messages to a key no party holds, which take a scan's full cost.
 */
async function rounds(x: World, k: number, perPage: number, wellFormed = false) {
  x.relay.pageCount = perPage;
  const a: Round[] = [];
  const b: Round[] = [];
  for (let i = 0; i < k; i++) {
    // Two pages' worth, for the next read of each: the same pages to both.
    for (let j = 0; j < 2 * perPage; j++) x.relay.put("preprod", wellFormed ? x.nobodys[j % x.nobodys.length]! : junk(x.junk++));
    // Each reads its two pages in its own round; the other then reads the same two pages in its own.
    const order: Array<[Party, Seen[], Page, Round[]]> =
      i % 2 === 0
        ? [
            [x.a, x.la, x.pa, a],
            [x.b, x.lb, x.pb, b],
          ]
        : [
            [x.b, x.lb, x.pb, b],
            [x.a, x.la, x.pa, a],
          ];
    for (const [p, log, pg, out] of order) out.push(await round(x, p, log, pg, perPage));
    expect(a.at(-1)!.asked).toEqual(b.at(-1)!.asked);
    expect(a.at(-1)!.asked.filter((s) => s.startsWith("GET "))).toHaveLength(2);
  }
  return {
    gap: { a: stats(a.map((r) => r.gapMs)), b: stats(b.map((r) => r.gapMs)) },
    reloadBefore: { a: a.filter((r) => r.reloadBefore).length, b: b.filter((r) => r.reloadBefore).length },
    between: { a: a.at(-1)!.between, b: b.at(-1)!.between },
    asked: a.at(-1)!.asked,
  };
}

const ROUNDS = 20;

describe("C2's overview face: a page's reload after 'changed' never goes in front of the next page (round 5; the verifiers' verify2-c2)", { timeout: 300_000 }, () => {
  let x: World;

  it("control: no page open, one envelope a page", async () => {
    x = await world();
    x.pa.open = false;
    x.pb.open = false;
    const r = await rounds(x, ROUNDS, 1);
    console.log(`[c2 overview, closed, 1 a page] ${JSON.stringify(r)}`);
    expect(r.between.a).not.toContain(`get ${INBOX}`);
    expect(r.between.b).not.toContain(`get ${INBOX}`);
    // No reload, nothing of the inbox between two pages: A and B alike, within the load's noise.
    expect(r.gap.a.p10).toBeLessThan(r.gap.b.p10 + 10);
  });

  it("a page open, its call back one turn of the event loop later, one envelope a page", async () => {
    x.pa.open = true;
    x.pb.open = true;
    x.pa.delay = x.pb.delay = () => new Promise((r) => setImmediate(r));
    const r = await rounds(x, ROUNDS, 1);
    console.log(`[c2 overview, open, 1 a page, a turn] ${JSON.stringify(r)}`);
    // No reload between the two pages (the notice waits for the lane's end), for either; and A's second page as B's
    // (at 48480cf8 A's gap was 96 to 201 ms).
    expect(r.between.a).not.toContain(`get ${INBOX}`);
    expect(r.between.a).toEqual(r.between.b);
    expect(r.reloadBefore).toEqual({ a: 0, b: 0 });
    expect(r.gap.a.p10).toBeLessThan(r.gap.b.p10 + 20);
  });

  it("a page open, its call back 5 ms later, the first page 32 well-formed envelopes nobody's, the harness's wait (a setImmediate)", async () => {
    x.pa.delay = x.pb.delay = () => new Promise((r) => setTimeout(r, 5));
    const r = await rounds(x, ROUNDS, 32, true);
    console.log(`[c2 overview, open, 32 well formed a page, 5 ms, setImmediate wait] ${JSON.stringify(r)}`);
    expect(r.reloadBefore).toEqual({ a: 0, b: 0 });
    expect(r.between.a).toEqual(r.between.b);
  });

  it("the same, with the worker's own wait between scans (messaging.ts wait: a setTimeout of 0)", async () => {
    // The worker's `wait` is setTimeout(r, 0) (messaging.ts :3426-3428); the harness's a setImmediate, then `onWait`.
    x.a.onWait = x.b.onWait = () => new Promise((r) => setTimeout(r, 0));
    try {
      const r = await rounds(x, ROUNDS, 32, true);
      console.log(`[c2 overview, open, 32 well formed a page, 5 ms, setTimeout wait] ${JSON.stringify(r)}`);
      // Under the worker's own wait too (at 48480cf8: 20 of 20 reloads before page 2): none now.
      expect(r.reloadBefore).toEqual({ a: 0, b: 0 });
      expect(r.between.a).not.toContain(`get ${INBOX}`);
      expect(r.between.a).toEqual(r.between.b);
      expect(r.gap.a.p10).toBeLessThan(r.gap.b.p10 + 20);
    } finally {
      x.a.onWait = x.b.onWait = undefined;
    }
  });

  it("control: the page closed again, the same 32 well-formed envelopes a page", async () => {
    x.pa.open = false;
    x.pb.open = false;
    const r = await rounds(x, ROUNDS, 32, true);
    console.log(`[c2 overview, closed, 32 well formed a page] ${JSON.stringify(r)}`);
    expect(r.between.a).not.toContain(`get ${INBOX}`);
    expect(Math.abs(r.gap.a.p10 - r.gap.b.p10)).toBeLessThan(Math.max(10, 0.5 * r.gap.b.p10));
  });
});
