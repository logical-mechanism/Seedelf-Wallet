// C2 with both networks' switches on (the 1.10.0 gate's round 5, ported from
// the verifiers' verify2-c2-two-pools, which reproduced it at 48480cf8): the
// alarm's tick syncs every network whose switch is on at once, and both pools
// are on one server behind one edge. Each sync's first page used to wait for
// its own network's whole inbox, through the one wallet queue, so one
// network's requests delayed the other's read. Since round 5 no lane reads an
// inbox (fix item 4).
//
// Paired worlds: A holds W's eight first messages on preprod (the crate's 256
// KiB of requests), B none; both have Messages on for mainnet too, where
// neither holds anything. At each tick: what each reads before each pool's
// first page, asserted the same for both and only the lanes' fixed records;
// the times logged, and asserted only within a margin far past what load moves.
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
  party,
  type Party,
  synced,
  turnOn,
} from "./messaging-harness";

const storedOf = (p: Party, name: string) => {
  const raw = p.local.data.get(PRIVATE_PREFIX + name) as string | undefined;
  return raw === undefined ? 0 : (JSON.parse(raw) as { data: string }).data.length;
};

const keptNew = () =>
  new Response(JSON.stringify({ kept: "new", expires: Math.floor((clock.now + 36 * 3600_000) / 1000) }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

interface Seen {
  what: string;
  at: number;
}
function watch(p: Party): Seen[] {
  const log: Seen[] = [];
  const push = Array.prototype.push;
  p.trace.push = function (this: string[], ...items: string[]) {
    const at = performance.now();
    for (const what of items) if (/^(GET|POST) |^(get|set) /.test(what)) log.push({ what, at });
    return push.apply(this, items);
  } as typeof p.trace.push;
  return log;
}

interface Tick {
  asked: string[];
  /** When each pool's first page went, from the tick (ms). */
  mainnet: number;
  preprod: number;
  /** The sealed records read or written before each pool's first page. */
  before: { mainnet: string[]; preprod: string[] };
}

async function tick(p: Party, log: Seen[], order: NetworkName[]): Promise<Tick> {
  log.length = 0;
  const s = performance.now();
  await p.messaging.syncAll(order);
  await p.messaging.whenIdle();
  const at = (n: NetworkName) => log.findIndex((e) => e.what.startsWith(`GET /messaging/v1/${n}/`));
  const first = (n: NetworkName) => log[at(n)]!.at - s;
  const before = (n: NetworkName) => log.slice(0, at(n)).filter((e) => /^(get|set) /.test(e.what)).map((e) => e.what);
  return {
    asked: log.filter((e) => /^(GET|POST) /.test(e.what)).map((e) => e.what),
    mainnet: first("mainnet"),
    preprod: first("preprod"),
    before: { mainnet: before("mainnet"), preprod: before("preprod") },
  };
}

const median = (xs: number[]) => [...xs].sort((p, q) => p - q)[Math.floor(xs.length / 2)]!;
const r2 = (v: number) => Math.round(v * 100) / 100;

describe("C2 with both pools on: neither network's first page waits for the other's (round 5; the verifiers' verify2-c2)", { timeout: 300_000 }, () => {
  it("A's preprod inbox at the bound, B's empty: the time between the two pools' first pages of one tick", async () => {
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const w = await party(15, relay, directory, CAROL_SEEDELF);
    const a = await party(12, relay, directory, ALICE_SEEDELF);
    const b = await party(24, relay, directory, BOB_SEEDELF);
    await turnOn(w, a, b);
    let writing = false;
    const real = relay.fetch;
    relay.fetch = async (url, init) => (init.method === "POST" && !writing ? keptNew() : real(url, init));
    let max = 0;
    try {
      await w.messaging.start("preprod", ALICE_SEEDELF, "x".repeat(70_000));
    } catch (e) {
      max = Number(/at most ([\d,]+) bytes/.exec((e as Error).message)![1]!.replace(/,/g, ""));
    }
    writing = true;
    for (let i = 0; i < 8; i++) {
      await w.messaging.start("preprod", ALICE_SEEDELF, `first message ${i} `.padEnd(max, "x"));
      await w.messaging.whenIdle();
    }
    writing = false;
    for (const p of [a, b, a, b]) await synced(p);
    // Mainnet's switch on too, for both: one read of an empty pool each, then nothing held there.
    for (const p of [a, b]) {
      await p.messaging.switch("mainnet", true);
      await p.messaging.whenIdle();
    }
    expect(storedOf(a, "messagingRequests.preprod")).toBe(699_072);
    expect(storedOf(b, "messagingRequests.preprod")).toBe(0);
    expect(storedOf(a, "messaging.mainnet")).toBe(storedOf(b, "messaging.mainnet"));
    const la = watch(a);
    const lb = watch(b);
    const out: Record<string, unknown> = {};
    for (const order of [
      ["mainnet", "preprod"],
      ["preprod", "mainnet"],
    ] as NetworkName[][]) {
      const ta: Tick[] = [];
      const tb: Tick[] = [];
      for (let i = 0; i < 20; i++) {
        for (const [p, log, into] of (i % 2 === 0
          ? [
              [a, la, ta],
              [b, lb, tb],
            ]
          : [
              [b, lb, tb],
              [a, la, ta],
            ]) as Array<[Party, Seen[], Tick[]]>)
          into.push(await tick(p, log, order));
        expect([...ta.at(-1)!.asked].sort()).toEqual([...tb.at(-1)!.asked].sort());
      }
      const gap = (t: Tick) => t.preprod - t.mainnet;
      const row = {
        aGapPreprodMinusMainnet: { median: r2(median(ta.map(gap))), all: ta.map((t) => r2(gap(t))).sort((p, q) => p - q) },
        bGapPreprodMinusMainnet: { median: r2(median(tb.map(gap))), all: tb.map((t) => r2(gap(t))).sort((p, q) => p - q) },
        aFirstPages: { mainnet: r2(median(ta.map((t) => t.mainnet))), preprod: r2(median(ta.map((t) => t.preprod))) },
        bFirstPages: { mainnet: r2(median(tb.map((t) => t.mainnet))), preprod: r2(median(tb.map((t) => t.preprod))) },
        asked: { a: ta.at(-1)!.asked, b: tb.at(-1)!.asked },
      };
      out[order.join(",")] = row;
      console.log(`[c2 two pools, ${order.join(" then ")}] ${JSON.stringify(row)}`);
      // Before either pool's first page, only the lanes' fixed records, the same for A as for B, tick by tick; and A's
      // first pages as B's (at 48480cf8 both of A's waited for its preprod inbox, 129 to 138 ms against 1.2 to 1.9).
      expect(ta.map((t) => t.before)).toEqual(tb.map((t) => t.before));
      for (const t of ta) for (const r of [...t.before.mainnet, ...t.before.preprod]) expect(r).toMatch(/^(get|set) messaging(Read|Mark|Outbox)\./);
      expect(row.aFirstPages.mainnet).toBeLessThan(row.bFirstPages.mainnet + 20);
      expect(row.aFirstPages.preprod).toBeLessThan(row.bFirstPages.preprod + 20);
    }
  });
});
