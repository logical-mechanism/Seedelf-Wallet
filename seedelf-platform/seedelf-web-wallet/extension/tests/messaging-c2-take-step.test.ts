// C2's take face (the 1.10.0 gate's round 5, ported from the verifiers'
// verify2-c2-take-step, which measured it at 48480cf8): how much one first
// message's take at the requests' bound costs, and what a page asked while it
// runs meets. Since round 5 the take is the runner's, between lanes and off
// every tick the worker expects (fix item 5), and the step's records are at
// most a conversation's share or the requests' room. A request off those grids
// (as here, a sync asked as the last one's take begins) can still meet the one
// call into the wallet's queue a step is making: W10's residual. These
// timings are logged for the docs' figures, never asserted; what's asserted is
// the step's bytes.
import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import { PRIVATE_PREFIX } from "../src/background/private-store";
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
  type Wasm,
} from "./messaging-harness";

const INBOX = "messaging.preprod";

const storedOf = (p: Party, name: string) => {
  const raw = p.local.data.get(PRIVATE_PREFIX + name) as string | undefined;
  return raw === undefined ? 0 : (JSON.parse(raw) as { data: string }).data.length;
};

const keptNew = () =>
  new Response(JSON.stringify({ kept: "new", expires: Math.floor((clock.now + 36 * 3600_000) / 1000) }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

interface Hold {
  kind: string;
  ms: number;
}

/** What one party's service and wallet were busy with, timed. */
interface Timing {
  /** Each receive() of a take: the service's queue held for one envelope. */
  receives: number[];
  /** Each `messagingReceive`, the crate's call, inside the wallet's queue. */
  crate: number[];
  /** Each task the wallet's queue ran for the service and the store. */
  holds: Hold[];
  /** When each page request went. */
  gets: number[];
}

function timeParty(p: Party, crate: number[]): Timing {
  const t: Timing = { receives: [], crate, holds: [], gets: [] };
  const svc = p.messaging as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const receive = svc.receive!.bind(p.messaging);
  svc.receive = async (...args: unknown[]) => {
    const s = performance.now();
    try {
      return await receive(...args);
    } finally {
      t.receives.push(performance.now() - s);
    }
  };
  const wallet = p.wallet as unknown as Record<string, (task: (k: unknown) => unknown) => Promise<unknown>>;
  for (const kind of ["withKeys", "withStoreKey"]) {
    const real = wallet[kind]!.bind(p.wallet);
    wallet[kind] = (task) =>
      real(async (k: unknown) => {
        const s = performance.now();
        try {
          return await task(k);
        } finally {
          t.holds.push({ kind, ms: performance.now() - s });
        }
      });
  }
  const push = Array.prototype.push;
  p.trace.push = function (this: string[], ...items: string[]) {
    for (const what of items) if (what.startsWith("GET ")) t.gets.push(performance.now());
    return push.apply(this, items);
  } as typeof p.trace.push;
  return t;
}

/** The longest the event loop was held between two of its turns, from now until `done` resolves. */
async function loopHeld<T>(done: Promise<T>): Promise<{ value: T; longest: number }> {
  let last = performance.now();
  let longest = 0;
  let on = true;
  const tick = () => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
    if (on) setImmediate(tick);
  };
  setImmediate(tick);
  try {
    return { value: await done, longest };
  } finally {
    on = false;
  }
}

interface World {
  relay: FakeRelay;
  w: Party;
  a: Party;
  b: Party;
  ta: Timing;
  tb: Timing;
  writing: boolean;
  n: number;
  maxText: number;
}

/** The crate's `messagingReceive`, timed: a module for a service started again over the same storage. */
function timedWasm(into: number[]): Wasm {
  const real = loadTestWasm();
  return {
    ...real,
    messagingReceive: (key: Parameters<Wasm["messagingReceive"]>[0], request: string) => {
      const s = performance.now();
      try {
        return real.messagingReceive(key, request);
      } finally {
        into.push(performance.now() - s);
      }
    },
  } as Wasm;
}

async function world(): Promise<World> {
  const relay = fakeRelay(clock);
  const directory: Directory = new Map();
  const w = await party(15, relay, directory, CAROL_SEEDELF);
  const a = await party(12, relay, directory, ALICE_SEEDELF);
  const b = await party(24, relay, directory, BOB_SEEDELF);
  await turnOn(w, a, b);
  // A's and B's services, started again over the same storage with the crate's receive timed.
  const crateA: number[] = [];
  const crateB: number[] = [];
  a.restart(timedWasm(crateA));
  b.restart(timedWasm(crateB));
  await synced(a);
  await synced(b);
  const x: World = { relay, w, a, b, ta: timeParty(a, crateA), tb: timeParty(b, crateB), writing: false, n: 0, maxText: 0 };
  const real = relay.fetch;
  relay.fetch = async (url, init) => (init.method === "POST" && !x.writing ? keptNew() : real(url, init));
  try {
    await w.messaging.start("preprod", ALICE_SEEDELF, "x".repeat(70_000));
  } catch (e) {
    x.maxText = Number(/at most ([\d,]+) bytes/.exec((e as Error).message)![1]!.replace(/,/g, ""));
  }
  return x;
}

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
}

const reset = (t: Timing) => {
  t.receives.length = 0;
  t.crate.length = 0;
  t.holds.length = 0;
  t.gets.length = 0;
};
const r2 = (v: number) => Math.round(v * 100) / 100;
const longestOf = (hs: Hold[]) => hs.reduce((m, h) => (h.ms > m.ms ? h : m), { kind: "none", ms: 0 });

interface Take {
  record: number;
  inbox: number;
  receiveMs: number;
  crateMs: number;
  longestQueueTask: Hold;
  loopHeldMs: number;
  takeMs: number;
}

/** W's next first message, read by A, whose take is then timed to its end; B reads the same page. */
async function oneTake(x: World): Promise<Take> {
  const before = storedOf(x.a, INBOX);
  // The requests record's own size, in its own record since round 5.
  const record = ((await x.a.store.get<{ requests?: string }>("messagingRequests.preprod"))?.requests?.length ?? 0) * 0.75;
  await firstMessages(x, 1);
  reset(x.ta);
  await x.a.messaging.sync("preprod");
  const s = performance.now();
  const { longest } = await loopHeld(x.a.messaging.whenIdle());
  const takeMs = performance.now() - s;
  expect(x.ta.receives).toHaveLength(1);
  const take: Take = {
    record: Math.round(record),
    inbox: before,
    receiveMs: r2(x.ta.receives[0]!),
    crateMs: r2(x.ta.crate[0]!),
    longestQueueTask: { kind: longestOf(x.ta.holds).kind, ms: r2(longestOf(x.ta.holds).ms) },
    loopHeldMs: r2(longest),
    takeMs: r2(takeMs),
  };
  await synced(x.b);
  return take;
}

/** A sync started as the last one ends, while what it read is taken: from sync() to its first page request (ms). */
async function syncDuringTake(p: Party, t: Timing): Promise<{ firstGetMs: number; taking: boolean }> {
  reset(t);
  await p.messaging.sync("preprod");
  // The take of what that read kept is under way now, in the background: the read's envelopes wait in the runner.
  const taking = ((p.messaging as unknown as { batches: Map<string, unknown[]> }).batches.get("preprod")?.length ?? 0) > 0;
  t.gets.length = 0;
  const s = performance.now();
  await p.messaging.sync("preprod");
  const firstGetMs = t.gets[0]! - s;
  await p.messaging.whenIdle();
  return { firstGetMs: r2(firstGetMs), taking };
}

/** A sync with nothing new and no take: from sync() to its first page request (ms). */
async function quietSync(p: Party, t: Timing): Promise<number> {
  await p.messaging.whenIdle();
  t.gets.length = 0;
  const s = performance.now();
  await p.messaging.sync("preprod");
  const ms = t.gets[0]! - s;
  await p.messaging.whenIdle();
  return r2(ms);
}

describe("C2's take face: one first message's take at the requests' bound, off the lanes (round 5; the verifiers' verify2-c2)", { timeout: 300_000 }, () => {
  it("a take's queue and event-loop holds, a requests' record nearly empty against one at its bound", async () => {
    const x = await world();
    const low: Take[] = [];
    for (let i = 0; i < 3; i++) low.push(await oneTake(x));
    await firstMessages(x, 5);
    for (const p of [x.a, x.b, x.a, x.b]) await synced(p);
    expect(storedOf(x.a, "messagingRequests.preprod")).toBe(699_072);
    const high: Take[] = [];
    for (let i = 0; i < 5; i++) high.push(await oneTake(x));
    expect((await x.a.messaging.overview("preprod")).requests).toHaveLength(8);
    console.log(`[c2 take] low ${JSON.stringify(low)}`);
    console.log(`[c2 take] high ${JSON.stringify(high)}`);
    const median = (xs: number[]) => [...xs].sort((p, q) => p - q)[Math.floor(xs.length / 2)]!;
    const summary = {
      receiveMs: { low: median(low.map((t) => t.receiveMs)), high: median(high.map((t) => t.receiveMs)) },
      crateMs: { low: median(low.map((t) => t.crateMs)), high: median(high.map((t) => t.crateMs)) },
      longestQueueTaskMs: { low: median(low.map((t) => t.longestQueueTask.ms)), high: median(high.map((t) => t.longestQueueTask.ms)) },
      loopHeldMs: { low: median(low.map((t) => t.loopHeldMs)), high: median(high.map((t) => t.loopHeldMs)) },
      takeMs: { low: median(low.map((t) => t.takeMs)), high: median(high.map((t) => t.takeMs)) },
    };
    console.log(`[c2 take] medians ${JSON.stringify(summary)}`);
    // Logged, for W10's residual: what one step costs. Asserted: no single call into the wallet's queue held more than a
    // conversation's share or the requests' room of a record (the share cap, round 5).
    const biggest = Math.max(...x.a.log.filter((l) => l.what === "get" || l.what === "set").map((l) => l.bytes ?? 0));
    expect(biggest).toBeLessThanOrEqual(699_072);
  });

  it("a page asked while such a take runs: A's next sync's first page against B's and against A's with no take", async () => {
    const x = await world();
    await firstMessages(x, 8);
    for (const p of [x.a, x.b, x.a, x.b]) await synced(p);
    expect(storedOf(x.a, "messagingRequests.preprod")).toBe(699_072);
    const during: number[] = [];
    const duringB: number[] = [];
    const quietA: number[] = [];
    const quietB: number[] = [];
    for (let i = 0; i < 10; i++) {
      await firstMessages(x, 1);
      const a = await syncDuringTake(x.a, x.ta);
      const b = await syncDuringTake(x.b, x.tb);
      expect(a.taking).toBe(true);
      during.push(a.firstGetMs);
      duringB.push(b.firstGetMs);
      quietA.push(await quietSync(x.a, x.ta));
      quietB.push(await quietSync(x.b, x.tb));
    }
    const sorted = (xs: number[]) => [...xs].sort((p, q) => p - q);
    const median = (xs: number[]) => sorted(xs)[Math.floor(xs.length / 2)]!;
    const out = {
      aDuringTake: { median: median(during), all: sorted(during) },
      bSame: { median: median(duringB), all: sorted(duringB) },
      aNoTake: { median: median(quietA), all: sorted(quietA) },
      bNoTake: { median: median(quietB), all: sorted(quietB) },
    };
    console.log(`[c2 take] a page during the take ${JSON.stringify(out)}`);
    // Logged, never asserted: a sync asked as a take begins is off every grid, the residual's case.
    expect(during).toHaveLength(10);
  });
});
