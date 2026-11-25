// From a tick to its lane's end, chrome.storage.local is read for the lane's own records alone (THE RULE; 1.10.0's second
// review, F5). A call of the runner's that the admit check turns away (it waited in the wallet's queue behind another
// feature's long task, and a lane started or a tick came near meanwhile) used to make itself ready again at once, before
// it waited at the gate: for a record's read, chrome.storage.local's read of it; for a write, the area's byte counts.
// That is a record whose size an envelope sets (the inbox, a conversation, the requests, the take record), read inside
// the lane or at the tick, for the wallet that was taking and not for the one that owns nothing. Now the gate comes
// first, then the making ready, then the call; and turned away, the gate again.
//
// The harness notes the area's own reads as they're asked (`Party.area`): the log's `get` is only a record's unseal.
// Paired, as messaging-admit: A's take waits in the queue behind a long task as the tick comes; B owns nothing.
import { describe, expect, it } from "vitest";

import { TAKE_MARGIN_MS } from "../src/background/messaging";
import { clock, type LogEntry, type Party, turns } from "./messaging-harness";
import { ALICE_SEEDELF, LANE_RECORDS, lanesOf, requestsOf, world, writing } from "./messaging-lanes-kit";

function foreignTask(p: Party): { release: () => void; done: Promise<void> } {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  return { release, done: p.wallet.withKeys(() => held) };
}

/** What the area was asked for a sealed record from its `from`th read on, until the log stood past `to`. */
const areaReads = (p: Party, from: number, to: number) =>
  p.area
    .slice(from)
    .filter((r) => r.index <= to)
    .map((r) => `${r.name.replace(/\.[0-9a-f]{32}$/, ".<id>")} ${r.bytes}`);

describe("a turned-away call makes ready again only once the gate has opened (1.10.0's second review, F5)", { timeout: 120_000 }, () => {
  for (const kind of ["view", "grid", "alarm"] as const) {
    it(`from ${kind === "alarm" ? "the alarm's tick" : kind === "grid" ? "a page's poll on the grid" : "a page's own sync"} to its lane's end, the area is read for the lane's own records only, for A as for B`, async () => {
      const at = { next: Number.POSITIVE_INFINITY };
      const x = await world({ ticks: () => (Number.isFinite(at.next) ? [{ at: at.next, lane: true }] : []), takeMarginMs: TAKE_MARGIN_MS });
      await writing(x, () => x.w.messaging.start("preprod", ALICE_SEEDELF, "hello Alice"));
      const reads: Record<"a" | "b", string[]> = { a: [], b: [] };
      const yields: Record<"a" | "b", number> = { a: 0, b: 0 };
      for (const [key, p, taking] of [
        ["a", x.a, true],
        ["b", x.b, false],
      ] as const) {
        // On a little, so the worker reads the alarms' schedule again (an empty one is kept for a second).
        clock.now += 1500;
        await p.wallet.touch();
        const t0 = clock.now;
        if (kind === "alarm") at.next = t0 + 10_000;
        const page = { page: `page-${key}`, kind: "grid" as const };
        // Another feature's long task takes the wallet's queue as the take's first unseal (the inbox's, after its open)
        // has passed the gate: that unseal waits its turn behind it.
        let foreign: ReturnType<typeof foreignTask> | undefined;
        let state = 0;
        const push = p.log.push.bind(p.log);
        p.log.push = (...items: LogEntry[]) => {
          const n = push(...items);
          for (const e of items) {
            if (state === 0 && e.what === "open") state = 1;
            else if (state === 1 && e.what === "gate") {
              state = 2;
              foreign = foreignTask(p);
            }
          }
          return n;
        };
        // The read that finds it: the page's first, which starts its grid, where the tick is the grid's.
        const first = kind === "grid" ? p.messaging.sync("preprod", page) : p.messaging.sync("preprod");
        if (taking) {
          for (const start = performance.now(); !foreign && performance.now() - start < 30_000; ) await new Promise((r) => setImmediate(r));
          expect(foreign, "the take's unseal passed the gate").toBeDefined();
        } else {
          await first;
          await p.messaging.whenIdle();
          foreign = foreignTask(p);
        }
        await turns(3);
        // The tick, with the queue still held; then the long task ends.
        clock.now = kind === "view" ? clock.now + 5000 : t0 + 10_000;
        const from = p.area.length;
        const asked = p.log.length;
        const lanes = lanesOf(p).length;
        const tick =
          kind === "alarm"
            ? p.messaging.syncAll(["preprod"], { alarm: true })
            : p.messaging.sync("preprod", kind === "grid" ? page : { page: `page-${key}`, kind: "view" });
        await turns(3);
        foreign!.release();
        await foreign!.done;
        await tick;
        const lane = lanesOf(p)[lanes]!;
        reads[key] = areaReads(p, from, lane.to);
        yields[key] = p.log.slice(asked, lane.to).filter((e) => e.what === "yield").length;
        at.next = Number.POSITIVE_INFINITY;
        // Past the grid's next tick, where there's one, so what waits at the gate goes on.
        clock.now += 15_000;
        await p.wallet.touch();
        await p.messaging.whenIdle();
      }
      console.log(`[area reads] ${kind}: A ${JSON.stringify(reads.a)}; B ${JSON.stringify(reads.b)}`);
      // The scenario met: A's unseal was waiting as the tick came, and gave the queue back.
      expect(yields.a).toBeGreaterThan(0);
      expect(yields.b).toBe(0);
      // The same reads of the area, each a lane's own record or the trap's flag (which needs no key, and is no record).
      expect(reads.a).toEqual(reads.b);
      for (const read of reads.a) expect(LANE_RECORDS.has(read.split(" ")[0]!) || read.startsWith("messagingTrap."), read).toBe(true);
      expect(requestsOf(x.a)).toEqual(requestsOf(x.b));
      // And A's envelope was taken, after the lane.
      expect(x.a.log.some((e) => e.what === "receive")).toBe(true);
    });
  }
});
