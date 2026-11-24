// One grid for every page (the 1.10.0 gate's round 5, risk 3's decision): each wallet page shown polls the relay at the
// ticks of the worker's own 10-second grid, which each sync's answer gives (`nextIn`), so the margins the runner keeps
// before the ticks don't multiply with pages, pages at a tick join one lane (one read per 10 s whatever the number of
// pages), and the relay can't count the pages shown. The pages here are the screens' own poll (`pollOnGrid`, src/ui),
// on the test's clock, asking the worker as the handler does (`sync`, then `pollIn`).
import { describe, expect, it } from "vitest";

import { MESSAGING_SYNC_EVERY_MS } from "../src/shared/rpc";
import { pollOnGrid } from "../src/ui/messaging";
import { TAKE_MARGIN_MS } from "../src/background/messaging";
import { another, clock, loadTestWasm, type Party, turns } from "./messaging-harness";
import { expectLanesClean, lanesOf, requestsOf, type World, world } from "./messaging-lanes-kit";

const EVERY = MESSAGING_SYNC_EVERY_MS;

/** Timers on the test's clock, as `pollOnGrid` sets them: run as the test moves the clock on (`drive`). */
class Timers {
  /** The pages' syncs still out: the test's clock stands still till each is answered (`drive`). */
  out = 0;
  private due: Array<{ at: number; run: () => void; id: number }> = [];
  private ids = 0;
  set = (run: () => void, ms: number) => {
    const id = ++this.ids;
    this.due.push({ at: clock.now + ms, run, id });
    return id;
  };
  clear = (id: unknown) => {
    this.due = this.due.filter((d) => d.id !== id);
  };
  /** When the soonest timer is due. */
  soonest(): number {
    return Math.min(...this.due.map((d) => d.at));
  }
  /** Runs every timer due by now, soonest first. */
  fire(): void {
    for (;;) {
      const ready = this.due.filter((d) => d.at <= clock.now).sort((p, q) => p.at - q.at || p.id - q.id)[0];
      if (!ready) return;
      this.due = this.due.filter((d) => d !== ready);
      ready.run();
    }
  }
}

interface Page {
  id: string;
  visible: boolean;
  /** Each sync it asked: when (the test's clock, from the run's start), and which. */
  syncs: Array<{ at: number; kind: "grid" | "view" }>;
  /** Each answer's `nextIn`. */
  answers: number[];
  /** The next asks that fail, as a worker Chrome stopped mid-answer would. */
  failNext: number;
  listeners: Set<() => void>;
  stop: () => void;
}

/**
 * A page shown on `p`'s wallet: the screens' poll, asking the worker as the handler does, on the test's clock. `failing`:
 * how many of its first asks fail.
 */
function show(p: Party, id: string, timers: Timers, t0: number, failing = 0): Page {
  const page: Page = { id, visible: true, syncs: [], answers: [], failNext: failing, listeners: new Set(), stop: () => undefined };
  page.stop = pollOnGrid({
    ask: async (kind) => {
      page.syncs.push({ at: clock.now - t0, kind });
      if (page.failNext > 0) {
        page.failNext--;
        throw new Error("the worker stopped");
      }
      // The handler's `messaging-sync`: the sync, then how long until the grid's next tick.
      timers.out++;
      try {
        await p.messaging.sync("preprod", { page: id, kind });
        const nextIn = p.messaging.pollIn();
        page.answers.push(nextIn);
        return { nextIn };
      } finally {
        timers.out--;
      }
    },
    visible: () => page.visible,
    onVisibility: (listener) => {
      page.listeners.add(listener);
      return () => page.listeners.delete(listener);
    },
    setTimeout: timers.set,
    clearTimeout: timers.clear,
  });
  return page;
}

function setVisible(page: Page, visible: boolean): void {
  page.visible = visible;
  for (const l of page.listeners) l();
}

/**
 * The test's clock on to `until`, 100 ms a turn and to each page's timer exactly, `p`'s user busy all along: each due
 * timer run (a page's sync), and `at` told each moment first (a page shown, hidden, a worker started again). It stands
 * still while a page's sync is out, so each answer is the worker's at its sync's own moment, however many turns of the
 * event loop its lane took: what an answer is computed from is then the same for every wallet.
 */
async function drive(p: Party, timers: Timers, until: number, at: (now: number) => void = () => undefined): Promise<void> {
  at(clock.now);
  timers.fire();
  for (;;) {
    for (const start = performance.now(); timers.out > 0; ) {
      if (performance.now() - start > 60_000) throw new Error("a page's sync never ended");
      await turns(1);
    }
    if (clock.now >= until) return;
    clock.now = Math.min(until, clock.now + 100, Math.max(clock.now + 1, timers.soonest()));
    at(clock.now);
    timers.fire();
    await p.wallet.touch();
    await turns(1);
  }
}

/**
 * The pages stopped, the clock on past the worker's two periods, till no tick of the grid is expected: the clock stands
 * still in `whenIdle`, and a tick no page served would be waited for till it's past.
 */
async function quiet(p: Party, timers: Timers): Promise<void> {
  await drive(p, timers, clock.now + 2 * EVERY + 5000);
  await p.messaging.whenIdle();
}

/** A's second register, under A's key: `n` first messages from W to a Seedelf there A didn't mint, each refused by A's take. */
async function firstsToTake(x: World, n: number): Promise<void> {
  const wasm = loadTestWasm();
  const register = await another(x.a);
  const name = "5eed0e1f00" + Buffer.from("alice2").toString("hex");
  const t = Math.floor(clock.now / 1000 / 600) * 600;
  await x.w.wallet.withKeys((keys) => {
    for (let i = 0; i < n; i++) {
      const started = JSON.parse(String(wasm.messagingStart(keys.seedelf, JSON.stringify({ handle: register, to: name, now: t })))) as { conversation: string };
      const stamped = JSON.parse(String(wasm.messagingSetStamp(JSON.stringify({ conversation: started.conversation, nonce: 0 })))) as { conversation: string };
      const sent = JSON.parse(String(wasm.messagingSend(JSON.stringify({ conversation: stamped.conversation, plaintext: "01" + i.toString(16).padStart(6, "0") })))) as {
        envelope: string;
      };
      x.relay.put("preprod", sent.envelope);
    }
  });
}

/** The ticks a log's lanes started at, from `t0`, each lane once. */
const laneStarts = (p: Party, from: number, t0: number) => lanesOf(p, from).map((lane) => p.log[lane.from]!.at - t0);

describe("one grid for every page (round 5, risk 3)", { timeout: 300_000 }, () => {
  it("three pages shown at different moments, A with first messages to take, B none: the same answers, syncs and requests", async () => {
    const x = await world({ takeMarginMs: TAKE_MARGIN_MS });
    await firstsToTake(x, 300);
    x.a.passOverOk = true;
    const run = async (p: Party) => {
      const timers = new Timers();
      const t0 = clock.now;
      const from = p.log.length;
      const pages: Page[] = [];
      await drive(p, timers, t0 + 60_000, (now) => {
        // Shown at 0 s, 3.3 s and 6.7 s.
        for (const [k, at] of [0, 3300, 6700].entries()) if (now - t0 === at) pages.push(show(p, `page-${k}`, timers, t0));
      });
      for (const page of pages) page.stop();
      await quiet(p, timers);
      return { pages: pages.map((g) => ({ syncs: g.syncs, answers: g.answers })), from, t0 };
    };
    const a = await run(x.a);
    const b = await run(x.b);
    // A took what it had to take, between the ticks.
    expect(x.a.log.slice(a.from).filter((e) => e.what === "open").length).toBeGreaterThan(100);
    expect(x.b.log.slice(b.from).some((e) => e.what === "open")).toBe(false);
    // The answers, the pages' syncs and the requests: the same for A as for B.
    expect(a.pages).toEqual(b.pages);
    expect(requestsOf(x.a, a.from)).toEqual(requestsOf(x.b, b.from));
    expect(laneStarts(x.a, a.from, a.t0)).toEqual(laneStarts(x.b, b.from, b.t0));
    expectLanesClean(x.a, a.from);
    expectLanesClean(x.b, b.from);
    // Each answer is the time to the grid's next tick from the sync's own moment: the first page's at 0 s, 3.3 s and 6.7 s
    // as each was shown, then a whole period at every tick.
    expect(a.pages.map((g) => g.answers[0])).toEqual([EVERY, 6700, 3300]);
    for (const page of a.pages) expect(page.answers.slice(1).every((n) => n === EVERY)).toBe(true);
    // After its sync as it was shown, every page polls at the grid's ticks: the first page's sync and each 10 s on.
    for (const page of a.pages) {
      const [shown, ...rest] = page.syncs;
      expect(shown!.kind).toBe("view");
      expect(rest.length).toBeGreaterThan(4);
      for (const s of rest) expect(s).toEqual({ at: Math.ceil(s.at / EVERY) * EVERY, kind: "grid" });
    }
    // One lane a tick: the three shown, then one each 10 s.
    expect(laneStarts(x.a, a.from, a.t0)).toEqual([0, 3300, 6700, 10_000, 20_000, 30_000, 40_000, 50_000, 60_000]);
  });

  it("four pages spread 2.5 s apart: one lane a tick, and the runner works in every period (none would, with a grid each)", async () => {
    const x = await world({ takeMarginMs: TAKE_MARGIN_MS });
    await firstsToTake(x, 1000);
    x.a.passOverOk = true;
    const timers = new Timers();
    const t0 = clock.now;
    const from = x.a.log.length;
    const pages: Page[] = [];
    await drive(x.a, timers, t0 + 80_000, (now) => {
      for (const [k, at] of [0, 2500, 5000, 7500].entries()) if (now - t0 === at) pages.push(show(x.a, `page-${k}`, timers, t0));
    });
    for (const page of pages) page.stop();
    await quiet(x.a, timers);
    const starts = laneStarts(x.a, from, t0);
    expect(starts).toEqual([0, 2500, 5000, 7500, ...Array.from({ length: 8 }, (_, k) => (k + 1) * EVERY)]);
    // Each period after the pages were shown: the runner's steps between its lane's end and the next tick's margin.
    const log = x.a.log.slice(from);
    const periods = Array.from({ length: 7 }, (_, k) => ({
      from: (k + 1) * 10,
      steps: log.filter((e) => e.what === "step-start" && e.at - t0 > (k + 1) * EVERY && e.at - t0 <= (k + 2) * EVERY).length,
      lanes: starts.filter((s) => s > (k + 1) * EVERY && s <= (k + 2) * EVERY).length,
    }));
    console.log(`[four pages] ${JSON.stringify(periods)}`);
    for (let k = 1; k < 7; k++) {
      const steps = log.filter((e) => e.what === "step-start" && e.at - t0 > k * EVERY && e.at - t0 < (k + 1) * EVERY);
      expect(steps.length, `steps in the period from ${k * 10} s`).toBeGreaterThan(0);
      // None in the margin before the next tick.
      expect(steps.filter((e) => e.at - t0 > (k + 1) * EVERY - TAKE_MARGIN_MS)).toEqual([]);
    }
    expectLanesClean(x.a, from);
  });

  it("a page hidden and shown again rejoins the grid; the only page hidden past two periods starts it again", async () => {
    const x = await world({ takeMarginMs: TAKE_MARGIN_MS });
    const timers = new Timers();
    const t0 = clock.now;
    const pages: Page[] = [];
    await drive(x.a, timers, t0 + 120_000, (now) => {
      const at = now - t0;
      if (at === 0 || at === 4000) pages.push(show(x.a, `page-${pages.length}`, timers, t0));
      // The second hidden from 21.3 s to 54.7 s, past the worker's two periods: it's forgotten, the grid held by the first.
      if (at === 21_300) setVisible(pages[1]!, false);
      if (at === 54_700) setVisible(pages[1]!, true);
      // Both hidden from 70.5 s, the first shown again at 103.9 s, after both were forgotten: a grid of its own sync.
      if (at === 70_500) for (const page of pages) setVisible(page, false);
      if (at === 103_900) setVisible(pages[0]!, true);
    });
    for (const page of pages) page.stop();
    await quiet(x.a, timers);
    const [first, second] = pages.map((p) => p.syncs);
    expect(first).toEqual([
      { at: 0, kind: "view" },
      ...[10, 20, 30, 40, 50, 60, 70].map((s) => ({ at: s * 1000, kind: "grid" })),
      { at: 103_900, kind: "view" },
      ...[113_900].map((at) => ({ at, kind: "grid" })),
    ]);
    expect(second).toEqual([
      { at: 4000, kind: "view" },
      ...[10, 20].map((s) => ({ at: s * 1000, kind: "grid" })),
      { at: 54_700, kind: "view" },
      ...[60, 70].map((s) => ({ at: s * 1000, kind: "grid" })),
    ]);
  });

  it("a worker started again with pages polling: the next sync starts a grid, and every page is on it within one period", async () => {
    const x = await world({ takeMarginMs: TAKE_MARGIN_MS });
    const timers = new Timers();
    const t0 = clock.now;
    const pages: Page[] = [];
    await drive(x.a, timers, t0 + 70_000, (now) => {
      const at = now - t0;
      if (at === 0 || at === 3000) pages.push(show(x.a, `page-${pages.length}`, timers, t0));
      // Chrome starts the worker again at 25 s: a new service, nothing of the grid in it.
      if (at === 25_000) x.a.restart();
      // A third page comes into view at 26.4 s and its first answer fails: it asks again 10 s on, off the grid.
      if (at === 26_400) pages.push(show(x.a, "page-2", timers, t0, 1));
    });
    for (const page of pages) page.stop();
    await quiet(x.a, timers);
    // The first two, on the old grid, start the new one at 30 s; the third follows it from its retry at 36.4 s.
    const after = (page: Page) => page.syncs.filter((s) => s.at > 40_000).map((s) => s.at);
    expect(pages[2]!.syncs.slice(0, 3)).toEqual([
      { at: 26_400, kind: "view" },
      { at: 36_400, kind: "grid" },
      { at: 40_000, kind: "grid" },
    ]);
    expect(after(pages[0]!)).toEqual([50_000, 60_000, 70_000]);
    expect(after(pages[1]!)).toEqual(after(pages[0]!));
    expect(after(pages[2]!)).toEqual(after(pages[0]!));
  });

  it("the answer is the grid's and the clock's alone: a lane running, a backlog or none, the same `nextIn`", async () => {
    const x = await world({ takeMarginMs: TAKE_MARGIN_MS });
    await firstsToTake(x, 50);
    const t0 = clock.now;
    await x.a.messaging.sync("preprod", { page: "page-0", kind: "view" });
    await x.b.messaging.sync("preprod", { page: "page-0", kind: "view" });
    clock.now = t0 + 3700;
    // A's backlog is being taken; a lane is running for B (a sync asked and not yet ended).
    const lane = x.b.messaging.sync("preprod");
    expect(x.a.messaging.pollIn()).toBe(6300);
    expect(x.b.messaging.pollIn()).toBe(6300);
    await lane;
    expect(x.b.messaging.pollIn()).toBe(6300);
    // Malformed pages are heard as none: a long ID, a number.
    const c = x.a.restart();
    await c.sync("preprod", { page: "x".repeat(65), kind: "view" });
    await c.sync("preprod", { page: 7, kind: "view" });
    expect(c.pollIn()).toBe(EVERY);
    await x.a.messaging.whenIdle();
    await x.b.messaging.whenIdle();
  });
});
