// A tick is served only by the run made for it (THE RULE; 1.10.0's second review, F1). Messages' alarm's tick is served
// by the alarm's own run (`syncAll` told so), the pages' grid's by a grid poll. A lane of another kind that starts inside
// the margin before a tick (a page's grid lane 2 s before the alarm's minute, a page's own sync as it's shown) opens
// nothing: the gate, the admit check and the held notices stay shut across that tick, so the alarm's read meets none of
// the runner's calls, whatever the wallet was taking. Before the fix, any lane that started within TAKE_MARGIN_MS before
// an alarm's tick marked it served, and the runner worked up to and across it.
//
// Paired: A takes a backlog, B owns nothing; the margin is looked at for both. The shape is messaging-runner (a)'s,
// with the pages' grid 2 s off the alarm's minute (there, every alarm falls exactly on a grid tick), and
// messaging-admit's real-time measure.
import { describe, expect, it } from "vitest";

import { TAKE_MARGIN_MS } from "../src/background/messaging";
import { another, certificateOf, clock, type LogEntry, loadTestWasm, type Party, turns, type Wasm } from "./messaging-harness";
import { expectLanesClean, lanesOf, requestsOf, world, type World } from "./messaging-lanes-kit";

/** A second Seedelf under A's key that this browser didn't mint: off, so a first message to it is refused. */
const ALICE2 = "5eed0e1f00" + Buffer.from("alice2").toString("hex");

/** As messaging-runner's: `n` first messages to A's second register, each refused by A's take at its first phase. */
async function refusedFirsts(x: World, n: number, salt = 0): Promise<void> {
  const wasm = loadTestWasm();
  const register = await another(x.a);
  // A's certificate for that pair, made with both its keys (chunk 55's 55e): what W writes to, by A's messaging key.
  const certificate = await certificateOf(x.a, ALICE2, register);
  const t = Math.floor(clock.now / 1000 / 600) * 600;
  await x.w.wallet.withKeys((keys) => {
    for (let i = 0; i < n; i++) {
      const started = JSON.parse(wasm.messagingStart(keys.messaging.preprod!, JSON.stringify({ network: "preprod", name: ALICE2, register, certificate, now: t }))) as { conversation: string };
      const stamped = JSON.parse(wasm.messagingSetStamp(JSON.stringify({ conversation: started.conversation, nonce: 0 }))) as { conversation: string };
      const plaintext = "01" + (salt * 100_000 + i).toString(16).padStart(8, "0");
      const sent = JSON.parse(wasm.messagingSend(JSON.stringify({ conversation: stamped.conversation, plaintext }))) as { envelope: string };
      x.relay.put("preprod", sent.envelope);
    }
  });
}

/** What the runner does in the wallet's queue, and each step's start. */
const RUNNER = ["get", "set", "remove", "open", "receive", "step-start"];

/** Busy for `ms` of real time. */
const spin = (ms: number) => {
  for (const s = performance.now(); performance.now() - s < ms; );
};

/** WebAssembly whose open and receive each take `ms` more, as messaging-admit's. */
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

describe("a tick is served only by its own run (1.10.0's second review, F1)", { timeout: 300_000 }, () => {
  it("an alarm's tick 2 s after a page's grid lane, and 1 s after a page is shown: no runner call in its margin, for A or B", async () => {
    const base = clock.now;
    // Messages' alarm alone: its minute at +22 s, then every 60 s.
    const alarmAt = (now: number) => base + 22_000 + 60_000 * Math.max(0, Math.ceil((now - base - 22_000 + 1) / 60_000));
    let alarms = true;
    const x = await world({ ticks: () => (alarms ? [{ at: alarmAt(clock.now), lane: true }] : []), takeMarginMs: TAKE_MARGIN_MS });
    await refusedFirsts(x, 400);
    x.a.passOverOk = true;
    // One page, shown at +10 s: the grid's ticks at +20 s, +30 s, ... A second page is shown at +21 s, off every tick.
    // The alarm at +22 s is 2 s after the grid's lane and 1 s after the second page's own.
    type Event = { at: number; kind: "grid" | "view" | "view2" | "alarm" };
    const events: Event[] = [
      { at: base + 10_000, kind: "view" },
      { at: base + 20_000, kind: "grid" },
      { at: base + 21_000, kind: "view2" },
      { at: base + 22_000, kind: "alarm" },
      { at: base + 30_000, kind: "grid" },
      { at: base + 40_000, kind: "grid" },
    ];
    const marks: Record<"a" | "b", Array<{ at: number; index: number; kind: Event["kind"] }>> = { a: [], b: [] };
    const fire = (p: Party, e: Event) =>
      (e.kind === "alarm"
        ? p.messaging.syncAll(["preprod"], { alarm: true })
        : e.kind === "view2"
          ? p.messaging.sync("preprod", { page: "p2", kind: "view" })
          : p.messaging.sync("preprod", { page: "p1", kind: e.kind })
      ).catch(() => undefined);
    for (const e of events) {
      while (clock.now < e.at) {
        clock.now = Math.min(e.at, clock.now + 100);
        await x.a.wallet.touch();
        await x.b.wallet.touch();
        await turns(1);
      }
      for (const [key, p] of [
        ["a", x.a],
        ["b", x.b],
      ] as const) {
        marks[key].push({ at: e.at, index: p.log.length, kind: e.kind });
        await fire(p, e);
      }
    }
    // The same requests, clean lanes, and A's backlog outlasted the alarm: its runner had work all along.
    expect(requestsOf(x.a)).toEqual(requestsOf(x.b));
    expectLanesClean(x.a);
    expectLanesClean(x.b);
    const mark = (key: "a" | "b", kind: Event["kind"], at: number) => marks[key].find((m) => m.kind === kind && m.at === base + at)!;
    expect(x.a.log.slice(mark("a", "alarm", 22_000).index).some((l) => l.what === "open")).toBe(true);
    expect(x.a.log.slice(0, mark("a", "grid", 20_000).index).some((l) => l.what === "open")).toBe(true);
    // The runner's calls from TAKE_MARGIN_MS before a tick until that tick's run starts, outside every lane: none, for
    // A and for B (B's own first phase after a lane counts as much as A's take).
    const inMargin = (p: Party, m: { at: number; index: number }): LogEntry[] => {
      const inLane = new Set(lanesOf(p).flatMap((lane) => Array.from({ length: lane.to - lane.from + 1 }, (_, i) => p.log[lane.from + i]!)));
      return p.log.slice(0, m.index).filter((l) => l.at >= m.at - TAKE_MARGIN_MS && !inLane.has(l) && RUNNER.includes(l.what));
    };
    for (const key of ["a", "b"] as const) {
      const p = key === "a" ? x.a : x.b;
      expect(inMargin(p, mark(key, "alarm", 22_000)), `${key}: the runner's calls in the margin before the alarm's tick`).toEqual([]);
      expect(inMargin(p, mark(key, "grid", 30_000)), `${key}: the runner's calls in the margin before the grid's tick`).toEqual([]);
      expect(inMargin(p, mark(key, "grid", 40_000)), `${key}: the runner's calls in the margin before the grid's tick`).toEqual([]);
    }
    // And the take went on between the ticks: after the alarm's run, before the grid's next margin.
    const between = x.a.log.filter((l) => l.what === "open" && l.at > base + 22_000 && l.at < base + 27_000);
    expect(between.length).toBeGreaterThan(0);
    // The rest of the backlog, the alarm stopped and the pages gone quiet.
    alarms = false;
    for (let i = 0; i < 300; i++) {
      clock.now += 100;
      await x.a.wallet.touch();
      await x.b.wallet.touch();
      await turns(1);
    }
    await x.a.messaging.whenIdle();
    await x.b.messaging.whenIdle();
  });

  it("in real time: the alarm's first request comes as soon for A as for B, 2 s after a grid lane as 5 s after it", async () => {
    const at = { next: Number.POSITIVE_INFINITY };
    const x = await world({ ipc: true, ticks: () => (Number.isFinite(at.next) ? [{ at: at.next, lane: true }] : []), takeMarginMs: TAKE_MARGIN_MS });
    x.a.restart(slow(SLOW_MS));
    x.b.restart(slow(SLOW_MS));
    x.a.passOverOk = true;
    /** One wallet's page shown at t0, its grid's tick at +10 s, and Messages' alarm `gap` ms after that tick. */
    const alarmAfterGrid = async (p: Party, gap: number, page: string) => {
      const t0 = clock.now;
      at.next = t0 + 10_000 + gap;
      await p.wallet.touch();
      const from = p.log.length;
      await p.messaging.sync("preprod", { page, kind: "view" });
      clock.now = t0 + 10_000;
      await p.messaging.sync("preprod", { page, kind: "grid" });
      // On towards the alarm's minute, the runner working in real time meanwhile.
      while (clock.now < at.next - 100) {
        clock.now = Math.min(at.next - 100, clock.now + 100);
        await new Promise((r) => setTimeout(r, 15));
      }
      clock.now = at.next;
      const lanes = lanesOf(p, from).length;
      const t1 = performance.now();
      await p.messaging.syncAll(["preprod"], { alarm: true });
      const lane = lanesOf(p, from)[lanes]!;
      const first = lane.entries.find((e) => e.what === "GET")!;
      const inMargin = p.log
        .slice(from, p.log.indexOf(first))
        .filter((e) => (e.what === "open" || e.what === "receive") && e.at >= at.next - TAKE_MARGIN_MS).length;
      const requests = requestsOf(p, from);
      // The rest of the backlog, with no tick and the page gone.
      at.next = Number.POSITIVE_INFINITY;
      clock.now += 40_000;
      await p.wallet.touch();
      await p.messaging.whenIdle();
      return { toFirst: first.t - t1, inMargin, requests };
    };
    const rounds = 6;
    const out: Record<number, { a: number[]; b: number[]; margin: number[] }> = { 2000: { a: [], b: [], margin: [] }, 5000: { a: [], b: [], margin: [] } };
    for (let round = 0; round < rounds; round++) {
      for (const gap of [2000, 5000]) {
        for (const p of [x.w, x.a, x.b]) await p.wallet.touch();
        await refusedFirsts(x, 12, 1 + round * 10 + gap / 1000);
        const b = await alarmAfterGrid(x.b, gap, `b-${round}-${gap}`);
        for (const p of [x.w, x.a, x.b]) await p.wallet.touch();
        const a = await alarmAfterGrid(x.a, gap, `a-${round}-${gap}`);
        expect(a.requests).toEqual(b.requests);
        out[gap]!.a.push(a.toFirst);
        out[gap]!.b.push(b.toFirst);
        out[gap]!.margin.push(a.inMargin);
      }
    }
    const median = (xs: number[]) => [...xs].sort((p, q) => p - q)[Math.floor(xs.length / 2)]!;
    const show = (xs: number[]) => xs.map((v) => v.toFixed(1)).join(", ");
    for (const gap of [2000, 5000]) {
      const o = out[gap]!;
      console.log(`[tick's own run] alarm ${gap} ms after the grid's lane, ms to its first GET: A ${show(o.a)}; B ${show(o.b)}; A's opens and receives in its margin: ${o.margin.join(", ")}`);
      // Nothing of A's take inside the alarm's margin, and no round where A's read came a call later than B's: with the
      // slack messaging-admit gives (half a slow call).
      expect(o.margin, `alarm ${gap} ms after a lane: A's take inside the alarm's margin`).toEqual(o.margin.map(() => 0));
      expect(o.a.filter((v) => v - median(o.b) >= SLOW_MS / 2), `alarm ${gap} ms after a lane: A's read held back by its take`).toEqual([]);
    }
  });
});
