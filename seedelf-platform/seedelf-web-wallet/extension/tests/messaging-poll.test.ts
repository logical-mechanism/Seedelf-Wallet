// The screens' poll on the worker's grid (src/ui/messaging.ts `pollOnGrid`, the 1.10.0 gate's round 5): a sync as the
// page is shown and as it comes into view, then one at each tick of the worker's grid, as each answer's `nextIn` says,
// read again at every tick; nothing while hidden; SYNC_OPEN_EVERY_MS on where an answer fails or says nothing usable.
import { describe, expect, it } from "vitest";

import { pollOnGrid, SYNC_OPEN_EVERY_MS } from "../src/ui/messaging";

/** A page's world for its poll: a clock, its timers, whether it's seen, and the worker's answers, each waiting. */
function page() {
  const w = {
    now: 0,
    visible: true,
    timers: [] as Array<{ at: number; run: () => void; id: number }>,
    ids: 0,
    asked: [] as Array<{ at: number; kind: "grid" | "view"; answer: (value: unknown) => void; fail: () => void }>,
    listeners: new Set<() => void>(),
  };
  const stop = pollOnGrid({
    ask: (kind) =>
      new Promise((resolve, reject) => w.asked.push({ at: w.now, kind, answer: (v) => resolve(v as { nextIn?: unknown }), fail: () => reject(new Error("no answer")) })),
    visible: () => w.visible,
    onVisibility: (listener) => {
      w.listeners.add(listener);
      return () => w.listeners.delete(listener);
    },
    setTimeout: (run, ms) => {
      const id = ++w.ids;
      w.timers.push({ at: w.now + ms, run, id });
      return id;
    },
    clearTimeout: (id) => {
      w.timers = w.timers.filter((t) => t.id !== id);
    },
  });
  /** The clock on to `at`, each timer due run at its moment. */
  const to = async (at: number) => {
    for (;;) {
      const due = w.timers.filter((t) => t.at <= at).sort((p, q) => p.at - q.at)[0];
      if (!due) break;
      w.now = due.at;
      w.timers = w.timers.filter((t) => t !== due);
      due.run();
      await Promise.resolve();
    }
    w.now = at;
  };
  /** The last ask answered: its promise settles, and the poll's next tick is set. */
  const answer = async (value: unknown) => {
    w.asked.at(-1)!.answer(value);
    for (let i = 0; i < 3; i++) await Promise.resolve();
  };
  const fail = async () => {
    w.asked.at(-1)!.fail();
    for (let i = 0; i < 3; i++) await Promise.resolve();
  };
  const seen = (visible: boolean) => {
    w.visible = visible;
    for (const l of w.listeners) l();
  };
  const asks = () => w.asked.map((a) => ({ at: a.at, kind: a.kind }));
  return { w, stop, to, answer, fail, seen, asks };
}

describe("the screens' poll on the worker's grid (round 5)", () => {
  it("asks as it's shown, then at each tick the answers give, read again at every one", async () => {
    const p = page();
    expect(p.asks()).toEqual([{ at: 0, kind: "view" }]);
    await p.answer({ nextIn: 3000 });
    await p.to(2999);
    expect(p.asks()).toHaveLength(1);
    await p.to(3000);
    expect(p.asks()).toEqual([
      { at: 0, kind: "view" },
      { at: 3000, kind: "grid" },
    ]);
    // Its answer came 40 ms after the tick: the next tick is the worker's, not 10 s from the answer.
    p.w.now = 3040;
    await p.answer({ nextIn: 9960 });
    await p.to(13_000);
    expect(p.asks().at(-1)).toEqual({ at: 13_000, kind: "grid" });
    p.stop();
  });

  it("asks nothing while hidden, sets nothing more, and asks as it comes into view", async () => {
    const p = page();
    await p.answer({ nextIn: 5000 });
    p.seen(false);
    // Hidden: the tick set is let go.
    expect(p.w.timers).toEqual([]);
    await p.to(30_000);
    expect(p.asks()).toHaveLength(1);
    p.seen(true);
    expect(p.asks().at(-1)).toEqual({ at: 30_000, kind: "view" });
    await p.answer({ nextIn: 1200 });
    await p.to(31_200);
    expect(p.asks().at(-1)).toEqual({ at: 31_200, kind: "grid" });
    // A tick that comes hidden (its answer was on the way as the page was hidden): nothing asked, nothing set.
    p.seen(false);
    await p.answer({ nextIn: 10_000 });
    await p.to(60_000);
    expect(p.asks()).toHaveLength(3);
    expect(p.w.timers).toEqual([]);
    p.stop();
  });

  it("an answer that fails, or says nothing a page can wait for: the next ask SYNC_OPEN_EVERY_MS on", async () => {
    const p = page();
    await p.fail();
    await p.to(SYNC_OPEN_EVERY_MS - 1);
    expect(p.asks()).toHaveLength(1);
    await p.to(SYNC_OPEN_EVERY_MS);
    expect(p.asks()).toHaveLength(2);
    let at = SYNC_OPEN_EVERY_MS;
    for (const bad of [null, undefined, {}, { nextIn: -1 }, { nextIn: SYNC_OPEN_EVERY_MS + 1 }, { nextIn: Number.NaN }, { nextIn: "5" }]) {
      await p.answer(bad);
      at += SYNC_OPEN_EVERY_MS;
      await p.to(at);
      expect(p.asks().at(-1), JSON.stringify(bad)).toEqual({ at, kind: "grid" });
    }
    p.stop();
  });

  it("one at a time: coming into view while a sync is out asks nothing more, and the answer sets the tick", async () => {
    const p = page();
    p.seen(false);
    p.seen(true);
    expect(p.asks()).toHaveLength(1);
    await p.answer({ nextIn: 700 });
    await p.to(700);
    expect(p.asks()).toHaveLength(2);
    p.seen(true);
    expect(p.asks()).toHaveLength(2);
    p.stop();
  });

  it("stopped: no ask, no tick, no listener", async () => {
    const p = page();
    await p.answer({ nextIn: 4000 });
    p.stop();
    expect(p.w.timers).toEqual([]);
    expect(p.w.listeners.size).toBe(0);
    await p.to(50_000);
    expect(p.asks()).toHaveLength(1);
  });
});
