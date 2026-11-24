// THE RULE inside the wallet's queue (the 1.10.0 gate's round 5, measure's and lanes-e's finding): the gate runs before
// a call is queued, and the wallet's queue runs its tasks in order, so a call of the runner's that passed the gate could
// wait behind another feature's long task and then run ahead of a tick's lane's own call, only where the wallet had
// something to take. Each call of the runner's, a press's or a screen's now looks again as its turn comes (its admit
// check), and gives the queue back where a lane has started or a tick come near. Paired traces: A has a first message
// to take, B nothing; the tick's lane is the same for both.
import { describe, expect, it } from "vitest";

import { TAKE_MARGIN_MS } from "../src/background/messaging";
import { ALICE_SEEDELF, CAROL_SEEDELF, clock, loadTestWasm, type LogEntry, type Party, turns, type Wasm } from "./messaging-harness";
import {
  claiming,
  expectLanesClean,
  junk,
  type Lane,
  LANE_RECORDS,
  lanesOf,
  recordsIn,
  requestsOf,
  strangers,
  type World,
  world,
  writing,
} from "./messaging-lanes-kit";

/** Busy for `ms` of real time. */
const spin = (ms: number) => {
  for (const s = performance.now(); performance.now() - s < ms; );
};

/** WebAssembly whose open and receive each take `ms` more: what a first message's receive costs at the requests' bound. */
const slow = (ms: number, base: Wasm = loadTestWasm()): Wasm => ({
  ...base,
  messagingOpen: (key, envelope) => {
    spin(ms);
    return base.messagingOpen(key, envelope);
  },
  messagingReceive: (key, request) => {
    spin(ms);
    return base.messagingReceive(key, request);
  },
});

const SLOW_MS = 60;

/** Another feature's long task in `p`'s wallet's queue (a Lovejoin build, say), held until `release`. */
function foreignTask(p: Party): { release: () => void; done: Promise<void> } {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  return { release, done: p.wallet.withKeys(() => held) };
}

/** Turns of the event loop, bounded by the wall clock, until `ready`. */
async function until(ready: () => boolean, what: string): Promise<void> {
  for (const start = performance.now(); !ready(); ) {
    if (performance.now() - start > 60_000) throw new Error(`never came: ${what}`);
    await new Promise((r) => setImmediate(r));
  }
}

/** Nothing of the runner's in `lane`: no gate passed, no step started, nothing opened, received or read but its own. */
function expectNoRunnerIn(lane: Lane): void {
  for (const e of lane.entries) {
    expect(e.what === "gate" || e.what === "step-start" || e.what === "open" || e.what === "receive", JSON.stringify(e)).toBe(false);
    if (e.what === "get" || e.what === "set" || e.what === "remove") expect(LANE_RECORDS.has(e.name!), JSON.stringify(e)).toBe(true);
  }
}

type Kind = "alarm" | "page";

interface Held {
  /** The tick's lane. */
  lane: Lane;
  /** From the tick (the alarm's run, or the page's poll, asked) to the lane's end: the alarm's run reads the wallet's state before its lane starts. */
  window: Lane;
  /** Real ms from the tick to the lane's first request. */
  toFirst: number;
  /** Where in the log A's take opened its envelope, if it did. */
  opened: number;
}

/**
 * `p`'s tick, met by another feature's long task (measure's scenario): the task takes the wallet's queue before the
 * tick and keeps it until the tick's lane has started. Where `taking`, the task is queued the moment the runner's take
 * passes the gate for its open, so that call waits in the queue behind it, as one did on a slow laptop; otherwise once
 * the runner is idle. The tick is the alarm's next minute (`at.next`) or the page's next 10-second poll.
 */
async function heldAcrossTick(p: Party, kind: Kind, taking: boolean, at: { next: number }): Promise<Held> {
  const page = { page: "page-1", kind: "grid" as const };
  const t0 = clock.now;
  if (kind === "alarm") at.next = t0 + 10_000;
  let foreign: ReturnType<typeof foreignTask> | undefined;
  const from = p.log.length;
  if (taking) {
    // The take's open: its mark written, its step started, then the gate passed for the call.
    const push = p.log.push.bind(p.log);
    let state = 0;
    p.log.push = (...items: LogEntry[]) => {
      const n = push(...items);
      for (const e of items) {
        if (state === 0 && e.what === "set" && e.name === "messagingTakeMark.preprod" && (e.bytes ?? 0) > 0) state = 1;
        else if (state === 1 && e.what === "step-start") state = 2;
        else if (state === 2 && e.what === "gate") {
          state = 3;
          // Queued now, in this very turn: before the call the gate just let through.
          foreign = foreignTask(p);
        }
      }
      return n;
    };
  }
  // The read that finds it: on the page's grid where it's the page's, off the alarm's.
  const first = kind === "page" ? p.messaging.sync("preprod", page) : p.messaging.sync("preprod");
  if (taking) {
    await until(() => foreign !== undefined, "the take's gate");
  } else {
    await first;
    await p.messaging.whenIdle();
    foreign = foreignTask(p);
  }
  await turns(3);
  // The tick, with the queue still held.
  clock.now = t0 + 10_000;
  const lanes = lanesOf(p, from).length;
  const at0 = p.log.length;
  const t1 = performance.now();
  const tick = kind === "alarm" ? p.messaging.syncAll(["preprod"]) : p.messaging.sync("preprod", page);
  await turns(3);
  foreign!.release();
  await foreign!.done;
  await tick;
  await p.messaging.whenIdle();
  const lane = lanesOf(p, from)[lanes]!;
  const firstRequest = lane.entries.find((e) => e.what === "GET" || e.what === "POST")!;
  return {
    lane,
    window: { entries: p.log.slice(at0, lane.to), from: at0, to: lane.to },
    toFirst: firstRequest.t - t1,
    opened: p.log.findIndex((e, i) => i >= from && e.what === "open"),
  };
}

/** A and B with a slow open, A sent a first message it hasn't read yet. */
async function paired(ipc: boolean, at: { next: number }): Promise<World> {
  const x = await world({ ipc, ticks: () => (Number.isFinite(at.next) ? [{ at: at.next, lane: true }] : []), takeMarginMs: TAKE_MARGIN_MS });
  x.a.restart(slow(SLOW_MS));
  x.b.restart(slow(SLOW_MS));
  await writing(x, () => x.w.messaging.start("preprod", ALICE_SEEDELF, "hello Alice"));
  return x;
}

describe("THE RULE inside the wallet's queue: a long task across a tick (round 5)", { timeout: 120_000 }, () => {
  for (const ipc of [false, true]) {
    for (const kind of ["alarm", "page"] as const) {
      it(`${kind === "alarm" ? "the alarm's tick" : "a page's poll"}${ipc ? ", over chrome.storage's IPC" : ""}: A's take call gives the queue back, and A's lane is B's`, async () => {
        const at = { next: Number.POSITIVE_INFINITY };
        const x = await paired(ipc, at);
        const a = await heldAcrossTick(x.a, kind, true, at);
        const b = await heldAcrossTick(x.b, kind, false, at);
        // The same requests, at the same moments of the test's clock, and the same records at the same lengths.
        const requests = (lane: Lane, x0: number) =>
          lane.entries.filter((e) => e.what === "GET" || e.what === "POST").map((e) => `${e.what} ${e.name} ${e.bytes ?? ""} +${e.at - x0}`);
        expect(requests(a.lane, x.a.log[a.lane.from]!.at)).toEqual(requests(b.lane, x.b.log[b.lane.from]!.at));
        expect(recordsIn(a.lane)).toEqual(recordsIn(b.lane));
        // And in real time: the lane's first request isn't held back by A's open (SLOW_MS), as it would be had it run.
        expect(a.toFirst - b.toFirst).toBeLessThan(SLOW_MS / 2);
        // Nothing of the runner's from the tick to the lane's end, in either; A's open came after its lane.
        expectNoRunnerIn(a.window);
        expectNoRunnerIn(b.window);
        expect(a.opened).toBeGreaterThan(a.lane.to);
        // The scenario met: A's call was waiting in the queue as the tick came, and gave it back as its turn came (the
        // page's lane already running, or the alarm's tick near while its run read the wallet's state).
        expect(a.window.entries.filter((e) => e.what === "yield").length).toBeGreaterThan(0);
        expect(b.window.entries.filter((e) => e.what === "yield")).toEqual([]);
      });
    }
  }
});

describe("a screen's read yields to a lane that started while it waited in the queue (round 5, O8)", { timeout: 120_000 }, () => {
  it("a thread's unseal, queued behind another feature's task as a sync starts: it runs after the lane", async () => {
    const x = await world();
    const cid = await x.a.messaging.start("preprod", CAROL_SEEDELF, "hello Carol");
    await x.a.messaging.whenIdle();
    const foreign = foreignTask(x.a);
    const from = x.a.log.length;
    const read = x.a.messaging.thread("preprod", cid);
    // Its gates passed (the screens' turn, then the inbox's read): its unseal waits in the wallet's queue.
    await until(() => x.a.log.slice(from).filter((e) => e.what === "gate").length >= 2, "the read's gates");
    await turns(3);
    expect(x.a.log.slice(from).some((e) => e.what === "get")).toBe(false);
    const lane = x.a.messaging.sync("preprod");
    await turns(3);
    foreign.release();
    await lane;
    const thread = await read;
    expect(thread.messages.map((m) => m.text)).toEqual(["hello Carol"]);
    const [only] = lanesOf(x.a, from);
    expectNoRunnerIn(only!);
    const inboxRead = x.a.log.findIndex((e, i) => i >= from && e.what === "get" && e.name === "messaging.preprod");
    expect(inboxRead).toBeGreaterThan(only!.to);
    expect(only!.entries.filter((e) => e.what === "yield").length).toBeGreaterThan(0);
  });
});

describe("a lane started as a take's call reads the session for its turn (round 5, lanes-e)", { timeout: 120_000 }, () => {
  /**
   * lanes-e's interleaving, made deterministic: A has a take backlog; the moment a take's call passes the gate, a sync
   * starts in the next macrotask, as a real one comes (an event of its own), while the wallet's queue reads its session
   * for that call. Before the admit check the call's open ran in the lane, ahead of its first request.
   */
  async function laneAt(trigger: "the take's gate" | "after the open", ipc: boolean, slowMs = 0) {
    const x = await world({ ipc });
    await strangers(x, 1);
    for (let i = 0; i < 40; i++) x.relay.put("preprod", junk(i));
    const claimed = claiming((e) => e.endsWith("5a5a5a5a"), slowMs ? slow(slowMs) : loadTestWasm());
    x.a.restart(claimed);
    x.a.passOverOk = true;
    // The first lane finds the backlog; the runner takes it after.
    await x.a.messaging.sync("preprod");
    const log = x.a.log;
    let armed = true;
    let lane: Promise<void> | undefined;
    let at = -1;
    const push = log.push.bind(log);
    log.push = (...items: LogEntry[]) => {
      const n = push(...items);
      const e = items[items.length - 1]!;
      const back = (k: number) => log[log.length - 1 - k];
      const hit =
        trigger === "the take's gate"
          ? e.what === "gate" && back(1)?.what === "step-start" && back(2)?.what === "gate" && back(3)?.what === "set" && back(3)?.name === "messagingTakeMark.preprod"
          : e.what === "step-end" && back(1)?.what === "open";
      if (armed && hit) {
        armed = false;
        at = log.length;
        setTimeout(() => {
          lane = x.a.messaging.sync("preprod");
        }, 0);
      }
      return n;
    };
    await until(() => lane !== undefined, "the trigger");
    await lane;
    await x.a.messaging.whenIdle();
    const ln = lanesOf(x.a, at).find((l) => l.from >= at)!;
    const first = ln.entries.findIndex((e) => e.what === "GET" || e.what === "POST");
    return { lane: ln, ms: ln.entries[first]!.t - log[ln.from]!.t };
  }

  for (const ipc of [true, false]) {
    for (const trigger of ["the take's gate", "after the open"] as const) {
      it(`a lane started ${trigger === "the take's gate" ? "as a take's call passes the gate" : "right after a take's open"} (ipc ${ipc}): nothing of the step's in it`, async () => {
        const r = await laneAt(trigger, ipc);
        expectNoRunnerIn(r.lane);
      });
    }
  }

  it("what it costs the lane's first request: none, where the open would have met it", async () => {
    const met = await laneAt("the take's gate", true, 50);
    const clear = await laneAt("after the open", true, 50);
    expectNoRunnerIn(met.lane);
    expectNoRunnerIn(clear.lane);
    expect(met.ms - clear.ms).toBeLessThan(25);
  });
});

describe("the alarm's first tick, appearing 10 s ahead after a read with none (round 5, lanes-e item 3)", { timeout: 300_000 }, () => {
  /**
   * lanes-e's e-grid case: the worker read the alarms' ticks as none (no alarm yet), and an empty list stayed cached for
   * 30 s, so a tick Chrome scheduled meanwhile went unseen and the runner ran up to it. Now an empty list is read again
   * after a second, and nothing of the runner's comes within TAKE_MARGIN_MS of a tick, nor in its lane.
   */
  it("A takes, B doesn't: the same requests, and no runner work within the margin of any grid tick", async () => {
    let next = Number.POSITIVE_INFINITY;
    const x = await world({ ipc: true, ticks: () => (Number.isFinite(next) ? [{ at: next, lane: true }] : []), takeMarginMs: TAKE_MARGIN_MS });
    await strangers(x, 4);
    for (let i = 0; i < 40; i++) x.relay.put("preprod", junk(i));
    x.a.restart(claiming((e) => e.endsWith("5a5a5a5a")));
    x.b.restart();
    x.a.passOverOk = true;
    const [fa, fb] = [x.a.log.length, x.b.log.length];
    // The unlock's lanes, off the grid, with no alarm yet: the worker reads none.
    await x.a.messaging.sync("preprod");
    await x.b.messaging.sync("preprod");
    const ticks: number[] = [];
    for (let k = 0; k < 2; k++) {
      // The alarm starts, or moves on: its next tick 10 s ahead.
      next = clock.now + 10_000;
      ticks.push(next);
      while (clock.now < next) {
        clock.now = Math.min(next, clock.now + 100);
        await x.a.wallet.touch();
        await x.b.wallet.touch();
        await new Promise((r) => setTimeout(r, 0));
      }
      await Promise.all([x.a.messaging.syncAll(["preprod"]), x.b.messaging.syncAll(["preprod"])]);
    }
    next = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 300; i++) {
      clock.now += 100;
      await x.a.wallet.touch();
      await x.b.wallet.touch();
      await new Promise((r) => setTimeout(r, 0));
    }
    await x.a.messaging.whenIdle();
    await x.b.messaging.whenIdle();
    expect(requestsOf(x.a, fa)).toEqual(requestsOf(x.b, fb));
    // A took something, so the case was met.
    expect(x.a.log.slice(fa).some((e) => e.what === "open")).toBe(true);
    for (const [p, from] of [
      [x.a, fa],
      [x.b, fb],
    ] as const) {
      expectLanesClean(p, from);
      // Nothing of the runner's from TAKE_MARGIN_MS before each grid tick to its lane's start.
      for (const tick of ticks) {
        const start = p.log.findIndex((e, i) => i >= from && e.what === "lane-start" && e.at >= tick);
        const near = p.log
          .slice(from, start)
          .filter((e) => e.at > tick - TAKE_MARGIN_MS && (e.what === "gate" || e.what === "step-start" || e.what === "open" || e.what === "receive" || e.what === "get" || e.what === "set"));
        expect(near, `near the tick at ${tick}`).toEqual([]);
      }
    }
  });
});
