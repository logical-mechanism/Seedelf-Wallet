// C2's post path (the 1.10.0 gate's round 5, ported from the verifiers'
// verify2-c2-post-path, which reproduced it at 48480cf8): after a sync's last
// page, the inbox used to be unsealed whole three times before the POST, and
// between two posts of one run the first one's bookkeeping read and wrote it
// again. Since round 5 a lane reads only the outbox record between its last
// page and its first post, and nothing between two posts: marking them posted
// is the runner's, after the lane (fix item 4).
//
// Paired worlds: one relay, one pool; W writes first messages to A's Seedelf,
// which A takes (W8); A and B read the same pages. Each of A and B has its own
// message waiting to be posted, which the test answers itself (kept nowhere,
// so neither changes the other's pages). What each one reads between its last
// page and its POST is asserted the same for both; the times are logged, and
// asserted only within a margin far past what load moves.
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
  recordName,
  synced,
  talking,
  turnOn,
  type Wasm,
} from "./messaging-harness";

const INBOX = "messaging.preprod";
const SERVER = /^(GET|POST) |^chain /;

interface Seen {
  what: string;
  at: number;
  bytes?: number;
}
interface Watch {
  log: Seen[];
  exact: boolean;
}

function watch(p: Party): Watch {
  const w: Watch = { log: [], exact: true };
  const push = Array.prototype.push;
  p.trace.push = function (this: string[], ...items: string[]) {
    const at = performance.now();
    for (const what of items) {
      const got = /^(get|set) (.+)$/.exec(what);
      if (got) {
        const raw = p.local.data.get(PRIVATE_PREFIX + got[2]) as string | undefined;
        const bytes = raw === undefined ? 0 : w.exact ? (JSON.parse(raw) as { data: string }).data.length : raw.length - 60;
        w.log.push({ what, at, bytes });
      } else w.log.push({ what, at });
    }
    return push.apply(this, items);
  } as typeof p.trace.push;
  return w;
}

const storedOf = (p: Party, name: string) => {
  const raw = p.local.data.get(PRIVATE_PREFIX + name) as string | undefined;
  return raw === undefined ? 0 : (JSON.parse(raw) as { data: string }).data.length;
};

const json = (status: number, value: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const keptNew = () => json(200, { kept: "new", expires: Math.floor((clock.now + 36 * 3600_000) / 1000) });
/** The relay's own 503 (§17.2): every post on the network waits, here a second. */
const busy = () => json(503, { error: "the pool is busy" }, { "retry-after": "1" });

interface World {
  relay: FakeRelay;
  w: Party;
  a: Party;
  b: Party;
  wa: Watch;
  wb: Watch;
  writing: boolean;
  /** A's and B's posts, the nth of this run: answered by the test, kept nowhere. */
  answer: (n: number) => Response;
  posts: number;
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
  const x: World = { relay, w, a, b, wa: watch(a), wb: watch(b), writing: false, answer: () => keptNew(), posts: 0, n: 0, maxText: 0 };
  const real = relay.fetch;
  relay.fetch = async (url, init) => (init.method === "POST" && !x.writing ? x.answer(++x.posts) : real(url, init));
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

/** W writes `k` first messages at their longest to A's Seedelf; A and B then read them (A takes them). */
async function firstMessages(x: World, k: number): Promise<void> {
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
  await synced(x.a);
  await synced(x.b);
  await synced(x.a);
  await synced(x.b);
}

interface Run {
  asked: string[];
  /** From the last page request to the (first) POST (ms). */
  pageToPostMs: number;
  /** From the first POST to the second, where there were two (ms). */
  postToPostMs?: number;
  /** The sealed records read (and written) between the last page request and the first POST. */
  between: Array<[string, number]>;
  /** ... and between the first POST and the second. */
  betweenPosts: Array<[string, number]>;
}

async function run(p: Party, w: Watch, x: World): Promise<Run> {
  w.log.length = 0;
  x.posts = 0;
  await p.messaging.sync("preprod");
  await p.messaging.whenIdle();
  const at = (i: number) => w.log[i]!.at;
  let lastGet = -1;
  for (const [i, s] of w.log.entries()) if (s.what.startsWith("GET ")) lastGet = i;
  const posts = w.log.flatMap((s, i) => (s.what.startsWith("POST ") ? [i] : []));
  const records = (from: number, to: number) =>
    w.log
      .slice(from + 1, to)
      .filter((s) => /^(get|set) /.test(s.what))
      .map((s) => [s.what, s.bytes!] as [string, number]);
  return {
    asked: w.log.filter((s) => SERVER.test(s.what)).map((s) => s.what),
    pageToPostMs: posts.length ? at(posts[0]!) - at(lastGet) : Number.NaN,
    ...(posts.length > 1 ? { postToPostMs: at(posts[1]!) - at(posts[0]!) } : {}),
    between: posts.length ? records(lastGet, posts[0]!) : [],
    betweenPosts: posts.length > 1 ? records(posts[0]!, posts[1]!) : [],
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

/** Moves the clock past the 503's second, the users busy, so each one's post comes due at its next sync. */
async function nextSecond(x: World) {
  clock.now += 2000;
  await x.a.wallet.touch();
  await x.b.wallet.touch();
}

/** `runs` interleaved syncs, each posting what's waiting; `before` runs ahead of each (a new message, say). */
async function runs(x: World, k: number, before?: (p: Party) => Promise<void>) {
  x.wa.exact = false;
  x.wb.exact = false;
  const a: Run[] = [];
  const b: Run[] = [];
  try {
    for (let i = 0; i < k; i++) {
      for (const p of i % 2 === 0 ? [x.a, x.b] : [x.b, x.a]) await before?.(p);
      await nextSecond(x);
      for (const p of i % 2 === 0 ? [x.a, x.b] : [x.b, x.a]) (p === x.a ? a : b).push(await run(p, p === x.a ? x.wa : x.wb, x));
      expect(a.at(-1)!.asked).toEqual(b.at(-1)!.asked);
    }
  } finally {
    x.wa.exact = true;
    x.wb.exact = true;
  }
  return { a, b };
}

const RUNS = 25;

describe("C2's post path: nothing sized by a stranger between the last page and a post (round 5; the verifiers' verify2-c2)", { timeout: 300_000 }, () => {
  it("one pending post each, in a conversation each started: N = 0 (control), then N = 8", async () => {
    const x = await world();
    // Each starts a conversation to W's Seedelf, its first message waiting: the relay's 503 holds it.
    x.answer = () => busy();
    for (const p of [x.a, x.b]) {
      await p.messaging.start("preprod", CAROL_SEEDELF, "waiting to be posted");
      await p.messaging.whenIdle();
    }
    const out: Record<string, unknown> = {};
    for (const n of [0, 8]) {
      if (n) await firstMessages(x, n);
      // Deterministic: one run each, exact sizes.
      await nextSecond(x);
      const ra = await run(x.a, x.wa, x);
      const rb = await run(x.b, x.wb, x);
      expect(ra.asked).toEqual(["GET /messaging/v1/preprod/envelopes?after=" + ra.asked[0]!.split("=")[1], "POST /messaging/v1/preprod/envelopes"]);
      expect(ra.asked).toEqual(rb.asked);
      const inboxA = storedOf(x.a, INBOX);
      const inboxB = storedOf(x.b, INBOX);
      const unsealed = (r: Run) => r.between.filter(([w]) => w.startsWith("get ")).reduce((s, [, n]) => s + n, 0);
      const inboxReads = (r: Run) => r.between.filter(([w]) => w === `get ${INBOX}`).length;
      // Between the last page and the POST, only the outbox record, the same for A as for B: no inbox, no conversation.
      expect(inboxReads(ra)).toBe(0);
      expect(inboxReads(rb)).toBe(0);
      expect(ra.between.map(([w]) => w)).toEqual(["get messagingOutbox.preprod"]);
      expect(ra.between).toEqual(rb.between);
      const t = await runs(x, RUNS);
      const row = {
        N: n,
        inboxA,
        inboxB,
        betweenLastPageAndPost: { a: ra.between, b: rb.between },
        unsealedBytes: { a: unsealed(ra), b: unsealed(rb) },
        asked: ra.asked,
        pageToPostMs: { a: stats(t.a.map((r) => r.pageToPostMs)), b: stats(t.b.map((r) => r.pageToPostMs)) },
      };
      out[`N=${n}`] = row;
      console.log(`[c2 post path, one post] ${JSON.stringify(row)}`);
      expect(unsealed(ra)).toBe(unsealed(rb));
      if (n > 0) expect(storedOf(x.a, "messagingRequests.preprod")).toBe(699_072);
      // A's POST as B's, within a margin far past what load moves (at 48480cf8 A's median was 189 to 463 ms).
      expect(row.pageToPostMs.a.median).toBeLessThan(row.pageToPostMs.b.median + 20);
    }
  });

  it("two pending posts in one run, in a conversation answered: the first one's bookkeeping, between the two POSTs", async () => {
    const x = await world();
    // A and B each write first to W, who answers: a session each, so a message a run never meets the writer's share.
    x.writing = true;
    const cidA = await talking(x.a, x.w, CAROL_SEEDELF);
    const cidB = await talking(x.b, x.w, CAROL_SEEDELF);
    x.writing = false;
    for (const p of [x.a, x.b, x.a, x.b]) await synced(p);
    await firstMessages(x, 8);
    expect(storedOf(x.a, "messagingRequests.preprod")).toBe(699_072);
    // Each run: the first post of the run kept, the next held by a 503; a new message before each run, which waits.
    x.answer = (n) => (n === 1 ? keptNew() : busy());
    let k = 0;
    const send = async (p: Party) => {
      x.posts = 1;
      await p.messaging.send("preprod", p === x.a ? cidA : cidB, `message ${k++}`);
      await p.messaging.whenIdle();
    };
    // Two waiting, each.
    for (const p of [x.a, x.b]) await send(p);
    await nextSecond(x);
    for (const p of [x.a, x.b]) await send(p);
    const t = await runs(x, RUNS, send);
    const ra = t.a.at(-1)!;
    const rb = t.b.at(-1)!;
    expect(ra.asked).toEqual(rb.asked);
    expect(ra.asked.filter((s) => s.startsWith("POST "))).toHaveLength(2);
    const recordA = await recordName(x.a, cidA);
    const recordB = await recordName(x.b, cidB);
    const row = {
      inboxA: storedOf(x.a, INBOX),
      inboxB: storedOf(x.b, INBOX),
      records: { a: [recordA, storedOf(x.a, recordA)], b: [recordB, storedOf(x.b, recordB)] },
      betweenPosts: { a: ra.betweenPosts, b: rb.betweenPosts },
      asked: ra.asked,
      pageToPostMs: { a: stats(t.a.map((r) => r.pageToPostMs)), b: stats(t.b.map((r) => r.pageToPostMs)) },
      postToPostMs: { a: stats(t.a.map((r) => r.postToPostMs!)), b: stats(t.b.map((r) => r.postToPostMs!)) },
    };
    console.log(`[c2 post path, two posts] ${JSON.stringify(row)}`);
    // Between the two POSTs nothing at all, for either: their bookkeeping is the runner's, after the lane.
    expect(ra.betweenPosts).toEqual([]);
    expect(rb.betweenPosts).toEqual([]);
    expect(row.postToPostMs.a.median).toBeLessThan(row.postToPostMs.b.median + 20);
  });

  it("two pending posts with a wallet page open: the reloads wait for the lane's end, never in front of the second post", async () => {
    const x = await world();
    x.writing = true;
    const cidA = await talking(x.a, x.w, CAROL_SEEDELF);
    const cidB = await talking(x.b, x.w, CAROL_SEEDELF);
    x.writing = false;
    for (const p of [x.a, x.b, x.a, x.b]) await synced(p);
    await firstMessages(x, 8);
    // Each wallet's service started again over the same storage, the crate's stamp search timed: each post's own work,
    // apart from whatever else holds the event loop between its slices.
    const slices = new Map<Party, Array<[number, number]>>();
    for (const p of [x.a, x.b]) {
      const into: Array<[number, number]> = [];
      slices.set(p, into);
      const real = loadTestWasm();
      p.restart({
        ...real,
        messagingFindStamp: (request: string) => {
          const at = performance.now();
          try {
            return real.messagingFindStamp(request);
          } finally {
            into.push([at, performance.now()]);
          }
        },
      } as Wasm);
    }
    for (const p of [x.a, x.b, x.a, x.b]) await synced(p);
    // A post's price as mainnet's pool starts it (18 bits, protocol.md §17.4), for both wallets in every phase: each new
    // post is solved in slices, with a turn of the event loop between (messaging.ts solve :2820-2839).
    x.relay.price = 18;
    // chrome.storage as Chrome answers it, over IPC: each call of either area answered a turn later, for both wallets
    // in every phase, so the page is the only difference between them.
    for (const p of [x.a, x.b]) {
      for (const area of [p.local, p.session] as unknown as Array<Record<string, (...args: unknown[]) => Promise<unknown>>>) {
        for (const method of ["get", "set", "remove", "keys"]) {
          const real = area[method]!.bind(area);
          area[method] = async (...args: unknown[]) => {
            await new Promise((r) => setImmediate(r));
            return real(...args);
          };
        }
      }
    }
    // A page of each wallet: at each 'changed', a turn later, it reads the overview again (ui/messaging.ts :36-48).
    const pages = new Map<Party, { open: boolean; pending: number }>();
    for (const p of [x.a, x.b]) {
      const pg = { open: false, pending: 0 };
      pages.set(p, pg);
      const push = Array.prototype.push;
      p.changed.push = function (this: NetworkName[], ...items: NetworkName[]) {
        for (const n of items) {
          if (!pg.open) continue;
          pg.pending++;
          void new Promise((r) => setImmediate(r))
            .then(() => p.messaging.overview(n).catch(() => undefined))
            .finally(() => pg.pending--);
        }
        return push.apply(this, items);
      } as typeof p.changed.push;
    }
    const settle = async () => {
      for (let i = 0; i < 4000 && [...pages.values()].some((pg) => pg.pending > 0); i++) await new Promise((r) => setTimeout(r, 1));
    };
    x.answer = (n) => (n === 1 ? keptNew() : busy());
    let k = 0;
    const send = async (p: Party) => {
      await settle();
      x.posts = 1;
      await p.messaging.send("preprod", p === x.a ? cidA : cidB, `message ${k++}`);
      await p.messaging.whenIdle();
      await settle();
    };
    for (const p of [x.a, x.b]) await send(p);
    await nextSecond(x);
    for (const p of [x.a, x.b]) await send(p);
    interface Gap {
      /** POST to POST (ms). */
      gap: number;
      /** Of it, the stamp search's own slices (ms). */
      solving: number;
      /** Whether a reload's read of the whole inbox ended before the second POST. */
      landed: boolean;
    }
    const out: Record<string, Record<string, unknown>> = {};
    const rest: Record<string, { a: number[]; b: number[] }> = {};
    for (const [phase, open] of [
      ["closed", false],
      ["open", true],
      ["closed again", false],
    ] as Array<[string, boolean]>) {
      for (const pg of pages.values()) pg.open = open;
      const gaps = new Map<Party, Gap[]>([
        [x.a, []],
        [x.b, []],
      ]);
      for (let i = 0; i < 20; i++) {
        const order = i % 2 === 0 ? [x.a, x.b] : [x.b, x.a];
        for (const p of order) await send(p);
        await nextSecond(x);
        const asked: string[][] = [];
        for (const p of order) {
          const w = p === x.a ? x.wa : x.wb;
          slices.get(p)!.length = 0;
          const r = await run(p, w, x);
          await settle();
          asked.push(r.asked);
          const posts = w.log.filter((e) => e.what.startsWith("POST ")).map((e) => e.at);
          expect(posts).toHaveLength(2);
          const solving = slices
            .get(p)!
            .filter(([from, to]) => from >= posts[0]! && to <= posts[1]!)
            .reduce((t, [from, to]) => t + to - from, 0);
          gaps.get(p)!.push({ gap: posts[1]! - posts[0]!, solving, landed: r.betweenPosts.some(([w]) => w === "get mintedAt.preprod") });
        }
        expect(asked[0]).toEqual(asked[1]);
      }
      const ga = gaps.get(x.a)!;
      const gb = gaps.get(x.b)!;
      rest[phase] = { a: ga.map((g) => g.gap - g.solving), b: gb.map((g) => g.gap - g.solving) };
      out[phase] = {
        postToPostMs: { a: stats(ga.map((g) => g.gap)), b: stats(gb.map((g) => g.gap)) },
        solvingMs: { a: stats(ga.map((g) => g.solving)), b: stats(gb.map((g) => g.solving)) },
        postToPostLessSolvingMs: { a: stats(rest[phase]!.a), b: stats(rest[phase]!.b) },
        landed: { a: ga.filter((g) => g.landed).length, b: gb.filter((g) => g.landed).length },
        ...(open
          ? {
              lessSolvingWhenLandedA: stats(ga.filter((g) => g.landed).map((g) => g.gap - g.solving)),
              lessSolvingWhenNotA: ga.some((g) => !g.landed) ? stats(ga.filter((g) => !g.landed).map((g) => g.gap - g.solving)) : null,
            }
          : {}),
      };
      console.log(`[c2 post path, two posts, 18 bits, IPC turns, page ${phase}] ${JSON.stringify(out[phase])}`);
      // No reload lands between the two posts, open or closed: the notice waits for the lane's end (round 5).
      expect(out[phase]!.landed).toEqual({ a: 0, b: 0 });
    }
    const med = (xs: number[]) => stats(xs).median;
    expect(med(rest.open!.a)).toBeLessThan(med(rest.open!.b) + 20);
  });
});
