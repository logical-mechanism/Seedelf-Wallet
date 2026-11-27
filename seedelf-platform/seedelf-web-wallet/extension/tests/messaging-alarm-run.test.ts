// The alarm's run is marked as it begins (THE RULE; 1.10.0's second review, F3). `syncAll` reads the settings and the
// wallet's state before any lane of its starts, and that state's read waits its turn in the wallet's queue: behind
// another feature's long task, where one holds it across the tick. Before the fix nothing said a run was on its way, so
// once the tick was TICK_GRACE_MS past, a call of A's take waiting in the same queue was admitted and ran ahead of the
// alarm's read. Now the run is a lane from before its first await, and ends cleanly whatever it finds to read.
//
// Paired, as messaging-admit's `heldAcrossTick` (A's take call waits behind the long task; B owns nothing), with the
// long task let go at the tick (that test's own case) and well after it.
import { describe, expect, it } from "vitest";

import { TAKE_MARGIN_MS, TICK_GRACE_MS } from "../src/background/messaging";
import { PRIVATE_PREFIX } from "../src/background/private-store";
import { clock, type LogEntry, loadTestWasm, type Party, turns, type Wasm } from "./messaging-harness";
import { ALICE_SEEDELF, type Lane, lanesOf, requestsOf, world, writing } from "./messaging-lanes-kit";

const spin = (ms: number) => {
  for (const s = performance.now(); performance.now() - s < ms; );
};
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

/** Another feature's long task in `p`'s wallet's queue, held until `release`. */
function foreignTask(p: Party): { release: () => void; done: Promise<void> } {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  return { release, done: p.wallet.withKeys(() => held) };
}

async function until(ready: () => boolean, what: string): Promise<void> {
  for (const start = performance.now(); !ready(); ) {
    if (performance.now() - start > 60_000) throw new Error(`never came: ${what}`);
    await new Promise((r) => setImmediate(r));
  }
}

/** `run`, or "held" where it hasn't settled in `ms` of real time. */
const within = (run: Promise<unknown>, ms = 10_000): Promise<"settled" | "held"> =>
  Promise.race([
    run.then(
      () => "settled" as const,
      () => "settled" as const,
    ),
    new Promise<"held">((r) => setTimeout(() => r("held"), ms)),
  ]);

interface Held {
  lane: Lane;
  /** Real ms from the alarm's run being asked to its lane's first request. */
  toFirst: number;
  /** What the runner did in the wallet's queue from the alarm's run being asked to its lane's first request. */
  ahead: string[];
  yields: number;
}

/** As messaging-admit's `heldAcrossTick` for the alarm, the long task let go `past` ms (the test's clock) after the tick. */
async function heldAcrossTick(p: Party, taking: boolean, at: { next: number }, past: number): Promise<Held> {
  const t0 = clock.now;
  at.next = t0 + 10_000;
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
          foreign = foreignTask(p);
        }
      }
      return n;
    };
  }
  const first = p.messaging.sync("preprod");
  if (taking) {
    await until(() => foreign !== undefined, "the take's gate");
  } else {
    await first;
    await p.messaging.whenIdle();
    foreign = foreignTask(p);
  }
  await turns(3);
  // The tick, with the queue still held: the alarm's run, which says so.
  clock.now = t0 + 10_000;
  const lanes = lanesOf(p, from).length;
  const at0 = p.log.length;
  const t1 = performance.now();
  const tick = p.messaging.syncAll(["preprod"], { alarm: true });
  await turns(3);
  // The long task runs on past the tick.
  clock.now = t0 + 10_000 + past;
  await turns(3);
  foreign!.release();
  await foreign!.done;
  await tick;
  at.next = Number.POSITIVE_INFINITY;
  await p.messaging.whenIdle();
  const lane = lanesOf(p, from)[lanes]!;
  const firstRequest = lane.entries.find((e) => e.what === "GET" || e.what === "POST")!;
  const window = p.log.slice(at0, p.log.indexOf(firstRequest));
  const ahead = window
    .filter((e) => ["open", "receive", "get", "set", "step-start"].includes(e.what) && !lane.entries.includes(e))
    .map((e) => `${e.what}${e.name ? ` ${e.name.replace(/\.[0-9a-f]{32}$/, ".<id>")}` : ""}`);
  return { lane, toFirst: firstRequest.t - t1, ahead, yields: window.filter((e) => e.what === "yield").length };
}

describe("the alarm's run is a lane from before its first await (1.10.0's second review, F3)", { timeout: 120_000 }, () => {
  for (const past of [0, TICK_GRACE_MS + 100, 4 * TICK_GRACE_MS]) {
    it(`another feature's long task until ${past} ms after the alarm's tick: A's take call gives the queue back, and A's alarm read is B's`, async () => {
      const at = { next: Number.POSITIVE_INFINITY };
      const x = await world({ ticks: () => (Number.isFinite(at.next) ? [{ at: at.next, lane: true }] : []), takeMarginMs: TAKE_MARGIN_MS });
      x.a.restart(slow(SLOW_MS));
      x.b.restart(slow(SLOW_MS));
      await writing(x, () => x.w.messaging.start("preprod", ALICE_SEEDELF, "hello Alice"));
      const a = await heldAcrossTick(x.a, true, at, past);
      const b = await heldAcrossTick(x.b, false, at, past);
      console.log(`[alarm's run] long task until +${past} ms: first request after ${a.toFirst.toFixed(1)} ms (A), ${b.toFirst.toFixed(1)} ms (B)`);
      expect(requestsOf(x.a)).toEqual(requestsOf(x.b));
      // Nothing of the runner's between the alarm's run being asked and its first request, for either; A's waiting call
      // gave the queue back as its turn came.
      expect(a.ahead, "A: the runner's calls ahead of the alarm's first request").toEqual([]);
      expect(b.ahead, "B: the runner's calls ahead of the alarm's first request").toEqual([]);
      expect(a.yields).toBeGreaterThan(0);
      expect(b.yields).toBe(0);
      // And in real time, with messaging-admit's slack: A's read isn't held back by its open (SLOW_MS).
      expect(a.toFirst - b.toFirst).toBeLessThan(SLOW_MS / 2);
      // A's envelope was taken all the same, after the run.
      expect(x.a.log.slice(x.a.log.indexOf(a.lane.entries[0]!)).some((e) => e.what === "open")).toBe(true);
    });
  }

  it("a run that finds nothing to read leaves no mark: switches off, the wallet locked, a network stopped", async () => {
    const at = { next: Number.POSITIVE_INFINITY };
    const x = await world({ ticks: () => (Number.isFinite(at.next) ? [{ at: at.next, lane: true }] : []), takeMarginMs: TAKE_MARGIN_MS });
    const p = x.a;
    /** The alarm's run at its tick, then something gated (a request's read, which waits at the gate): it's answered. */
    const runThenGated = async (what: string) => {
      clock.now += 1500;
      at.next = clock.now;
      const from = requestsOf(p).length;
      expect(await within(p.messaging.syncAll(["preprod"], { alarm: true })), `${what}: the run ends`).toBe("settled");
      expect(requestsOf(p).length, `${what}: nothing was asked`).toBe(from);
      expect(await within(p.messaging.request("preprod", "00".repeat(32))), `${what}: the gate opens after the run`).toBe("settled");
      expect(await within(p.messaging.whenIdle()), `${what}: nothing is left waiting`).toBe("settled");
      at.next = Number.POSITIVE_INFINITY;
    };
    // A network stopped by a trap's flag: its sync starts nothing.
    await p.local.set(`${PRIVATE_PREFIX}messagingTrap.preprod`, "scan");
    await runThenGated("stopped");
    await p.local.remove(`${PRIVATE_PREFIX}messagingTrap.preprod`);
    // Every switch off: the wallet's own certificate withdrawn first, the switch's own post (chunk 55's call 9).
    await p.messaging.switch("preprod", false);
    await p.messaging.whenIdle();
    await runThenGated("off");
    await p.messaging.switch("preprod", true);
    await p.messaging.whenIdle();
    // The wallet locked.
    await p.wallet.lock();
    await runThenGated("locked");
  });
});
