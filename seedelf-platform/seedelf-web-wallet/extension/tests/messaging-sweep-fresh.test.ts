// A fresh worker's first post, and one take step at the bound (the 1.10.0
// gate's round 5, ported from the verifiers' verify2-sweep-work-fresh, which
// measured them at 48480cf8). A fresh worker's first sync used to sweep every
// conversation's record between its last page and its first post, a cost the
// other sides set. Since round 5 the sweep is the runner's, after the lane
// (fix items 4 and 5): what each wallet reads between its last page and its
// first post is the same, the outbox record alone. The times are logged, and
// asserted only within a margin far past what load moves; one take step's hold
// of the event loop is logged for W10's residual.
import { describe, expect, it } from "vitest";

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
  talking,
  turnOn,
  turns,
} from "./messaging-harness";

const turn = () => new Promise<void>((r) => setImmediate(r));
async function until(done: () => boolean, most = 20000): Promise<boolean> {
  for (let i = 0; i < most && !done(); i++) await turn();
  return done();
}

type Timed = Array<{ what: string; at: number }>;
function timeTrace(p: Party): Timed {
  const timed: Timed = [];
  const push = p.trace.push.bind(p.trace);
  p.trace.push = (...items: string[]) => {
    const at = performance.now();
    for (const what of items) timed.push({ what, at });
    return push(...items);
  };
  return timed;
}

async function tick(p: Party, label: string): Promise<void> {
  p.trace.push(`# ${label}`);
  let settled = false;
  p.messaging.sync("preprod").then(
    () => void (settled = true),
    () => void (settled = true),
  );
  await until(() => settled);
  await turns(5);
  await p.messaging.whenIdle();
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/** The longest the event loop went without a turn while `run` ran: the most a page's fetch could wait for it. */
async function longestBlock<T>(run: () => Promise<T>): Promise<{ value: T; longest: number }> {
  let longest = 0;
  let last = performance.now();
  let on = true;
  const beat = () => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
    if (on) setImmediate(beat);
  };
  setImmediate(beat);
  const value = await run();
  on = false;
  return { value, longest };
}

describe("class B: a fresh worker's sweep after its lane, and one take step at the bound (round 5; the verifiers' sweep)", () => {
  it("the first post of a fresh worker waits for the sweep of every conversation's record", { timeout: 300_000 }, async () => {
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const w = await party(15, relay, directory, CAROL_SEEDELF);
    const a = await party(12, relay, directory, ALICE_SEEDELF);
    const b = await party(24, relay, directory, BOB_SEEDELF);
    await turnOn(w, a, b);
    const ca = await talking(w, a, ALICE_SEEDELF);
    const cb = await talking(w, b, BOB_SEEDELF);
    // The other side of A's conversation writes long messages, which A takes; B's writes short ones.
    for (let i = 0; i < 14; i++) {
      await w.messaging.send("preprod", ca, `${i} `.padEnd(30_000, "y"));
      await w.messaging.send("preprod", cb, `${i} short`);
      await w.messaging.whenIdle();
    }
    await synced(a);
    await synced(b);
    const recordOf = async (p: Party, cid: string) => {
      const inbox = await p.store.get<{ conversations: Record<string, { id: string; bytes: number }> }>("messaging.preprod");
      return inbox!.conversations[cid]!.bytes;
    };
    console.log("conversation record as stored: A", await recordOf(a, ca), "B", await recordOf(b, cb));
    const real = relay.fetch;
    relay.fetch = async (url, init) => {
      if (init.method === "POST") {
        if (!relay.up) throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify({ kept: "new", expires: Math.floor((clock.now + 36 * 3600_000) / 1000) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return real(url, init);
    };
    relay.price = 1;
    const gaps = { fresh: { a: [] as number[], b: [] as number[] }, warm: { a: [] as number[], b: [] as number[] } };
    let order: string[] = [];
    for (let round = 0; round < 8; round++) {
      const fresh = round % 2 === 0;
      for (const [key, p, cid] of [
        ["a", a, ca],
        ["b", b, cb],
      ] as const) {
        relay.up = false;
        await p.messaging.send("preprod", cid, `reply ${round}`);
        await p.messaging.whenIdle();
        relay.up = true;
        // A worker Chrome stopped and started again (no page open between two alarms): nothing in memory.
        if (fresh) p.restart();
        const timed = timeTrace(p);
        await tick(p, `round ${round}`);
        const lastGet = timed.filter((e) => e.what.startsWith("GET ")).at(-1)!;
        const post = timed.find((e) => e.what.startsWith("POST "))!;
        expect(post).toBeDefined();
        gaps[fresh ? "fresh" : "warm"][key].push(post.at - lastGet.at);
        // Between the last page and the post: the outbox record alone, for either, fresh or not.
        const between = timed.slice(timed.indexOf(lastGet) + 1, timed.indexOf(post)).filter((e) => /^(get|set) /.test(e.what)).map((e) => e.what);
        expect(between).toEqual(["get messagingOutbox.preprod"]);
        if (fresh && key === "a" && round === 0) order = timed.slice(timed.indexOf(lastGet), timed.indexOf(post) + 1).map((e) => e.what);
      }
    }
    console.log("last page to first post, fresh worker, median ms: A", median(gaps.fresh.a).toFixed(1), "B", median(gaps.fresh.b).toFixed(1));
    console.log("last page to first post, same worker, median ms: A", median(gaps.warm.a).toFixed(1), "B", median(gaps.warm.b).toFixed(1));
    console.log("A, fresh worker, last page to the post:", JSON.stringify(order));
    // At 48480cf8 A's was 215.5 ms against B's 6.4: now alike, within a margin far past what load moves.
    expect(median(gaps.fresh.a)).toBeLessThan(median(gaps.fresh.b) + 20);
  });

  it("one first message taken at the requests' bound: how long it holds the event loop", { timeout: 300_000 }, async () => {
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const w = await party(15, relay, directory, CAROL_SEEDELF);
    const a = await party(12, relay, directory, ALICE_SEEDELF);
    await turnOn(w, a);
    const takeOne = async (label: string) => {
      await w.messaging.start("preprod", ALICE_SEEDELF, `${label} `.padEnd(30_000, "z"));
      await w.messaging.whenIdle();
      const timed = timeTrace(a);
      const { longest } = await longestBlock(async () => {
        await a.messaging.sync("preprod");
        await a.messaging.whenIdle();
      });
      const receive = timed.find((e) => e.what === "receive");
      const end = timed.filter((e) => e.what === "set messaging.preprod").at(-1);
      return { longest, take: receive && end ? end.at - receive.at : Number.NaN };
    };
    const empty = await takeOne("first");
    for (let i = 0; i < 8; i++) {
      await w.messaging.start("preprod", ALICE_SEEDELF, `${i} `.padEnd(30_000, "z"));
      await w.messaging.whenIdle();
    }
    await synced(a);
    const full = await takeOne("at the bound");
    console.log(
      "one first message taken: longest event-loop block ms, empty requests",
      empty.longest.toFixed(1),
      "at the bound",
      full.longest.toFixed(1),
      "; receive to the inbox's write ms:",
      empty.take.toFixed(1),
      full.take.toFixed(1),
    );
    // Logged for W10's residual: a step's one call can be this long. Not asserted: it's the crate's own work.
    expect(Number.isFinite(full.longest)).toBe(true);
  });
});
