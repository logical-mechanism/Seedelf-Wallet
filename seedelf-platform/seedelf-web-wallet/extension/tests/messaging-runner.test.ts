// The runner and the rooms (the 1.10.0 gate's round 5, fix items 5 and 7).
// Everything that isn't a request or a press runs one step at a time in the
// background runner, between lanes, and before each of its calls into the
// wallet's queue a step waits until no lane runs and more than TAKE_MARGIN_MS
// remain before every tick the worker expects: both alarms' next minute, and
// the next tick of the pages' one 10-second grid. So the grids' requests go at the same moment
// after the same work whatever was taken. The rooms (the requests', the take
// record's, the inbox's take-sized part) count as taken in every look at the
// area's reserve, so strangers never decide whether the user's write fits.
import { describe, expect, it } from "vitest";

import { CONVERSATION_SHARE_BYTES, QUOTA_BYTES, RESERVE_BYTES, storedBytes, TAKE_MARGIN_MS, TICK_GRACE_MS } from "../src/background/messaging";
import { PRIVATE_PREFIX } from "../src/background/private-store";
import {
  ALICE_SEEDELF,
  another,
  BOB_SEEDELF,
  busyFor,
  CAROL_SEEDELF,
  certificateOf,
  clock,
  fileOf,
  type LogEntry,
  loadTestWasm,
  pair,
  type Party,
  recordName,
  synced,
  talking,
  texts,
  turns,
  usedBytes,
  type Wasm,
} from "./messaging-harness";
import { expectLanesClean, keptNew, lanesOf, requestsOf, strangers, world, type World, writing } from "./messaging-lanes-kit";

/** A second Seedelf under A's key that this browser didn't mint: off, so a first message to it is refused. */
const ALICE2 = "5eed0e1f00" + Buffer.from("alice2").toString("hex");

/**
 * `n` first messages from W's key to A's second register, each a conversation of its own, stamped with nonce 0: sealed
 * by WebAssembly directly (W's service would keep 2,000 conversations), each refused by A's take at its first phase.
 */
async function refusedFirsts(x: World, n: number): Promise<void> {
  const wasm = loadTestWasm();
  const register = await another(x.a);
  // A's certificate for that pair, made with both its keys (chunk 55's 55e): what W writes to, by A's messaging key.
  const certificate = await certificateOf(x.a, ALICE2, register);
  const t = Math.floor(clock.now / 1000 / 600) * 600;
  await x.w.wallet.withKeys((keys) => {
    for (let i = 0; i < n; i++) {
      const started = JSON.parse(wasm.messagingStart(keys.messaging.preprod!, JSON.stringify({ network: "preprod", name: ALICE2, register, certificate, now: t }))) as { conversation: string };
      const stamped = JSON.parse(wasm.messagingSetStamp(JSON.stringify({ conversation: started.conversation, nonce: 0 }))) as { conversation: string };
      const sent = JSON.parse(wasm.messagingSend(JSON.stringify({ conversation: stamped.conversation, plaintext: "01" + i.toString(16).padStart(6, "0") }))) as {
        envelope: string;
      };
      x.relay.put("preprod", sent.envelope);
    }
  });
}

/** The alarms, once a test has stopped them. */
const stopped = { alarms: false };

/** The ticks a wallet expects, as both alarms schedule them from `base`: Messages' every minute, the sessions' at :30. */
const alarms = (base: number) => () => {
  if (stopped.alarms) return [];
  const next = (offset: number) => base + offset + 60_000 * Math.ceil((clock.now - base - offset + 1) / 60_000);
  return [
    { at: next(0), lane: true },
    { at: next(30_000), lane: false },
  ];
};

describe("the runner keeps off the lanes and the ticks (round 5, fix item 5)", { timeout: 300_000 }, () => {
  it("(a) a backlog spanning 20 ticks, two pages on the worker's grid and both alarms: no step's call in a lane or a tick's margin, and A's requests are B's", async () => {
    const base = clock.now;
    const x = await world({ ticks: alarms(base), takeMarginMs: TAKE_MARGIN_MS });
    await refusedFirsts(x, 2000);
    x.a.passOverOk = true;
    // The events, on the test's clock: two pages, shown at 10 s and at 15 s, each polling on the worker's one grid (from
    // the first page's sync) after its first sync; Messages' alarm each minute; the sessions' alarm at :30 (a run of
    // another feature's, which no lane of Messages serves).
    type Event = { at: number; kind: "p1" | "p2" | "alarm" | "sessions"; view?: true };
    const events: Event[] = [{ at: base + 10_000, kind: "p1", view: true }, { at: base + 15_000, kind: "p2", view: true }];
    for (let s = 20; s < 210; s += 10) events.push({ at: base + s * 1000, kind: "p1" }, { at: base + s * 1000, kind: "p2" });
    for (let m = 1; m <= 3; m++) events.push({ at: base + m * 60_000, kind: "alarm" }, { at: base + m * 60_000 - 30_000, kind: "sessions" });
    events.sort((p, q) => p.at - q.at);
    const marks: Record<string, Array<{ at: number; index: number; kind: Event["kind"]; view?: true }>> = { a: [], b: [] };
    // What happened before the first event is the world's making, its clock still at its start.
    const started = x.a.log.length;
    const fire = async (p: Party, e: Event) => {
      if (e.kind === "sessions") return;
      const syncs =
        e.kind === "alarm"
          ? // The alarm's own run, said so, as sw.ts's alarm says it (1.10.0's second review, F1): a tick is served only
            // by its own run. Plain, it was taken for the alarm's only because any lane near a tick served it: the bug.
            p.messaging.syncAll(["preprod"], { alarm: true })
          : p.messaging.sync("preprod", { page: e.kind, kind: e.view ? "view" : "grid" });
      await syncs.catch(() => undefined);
    };
    // What comes at one moment comes together, as the pages' polls at a tick of the grid do: they join one lane.
    const moments = [...new Set(events.map((e) => e.at))];
    for (const at of moments) {
      const now = events.filter((e) => e.at === at);
      // The clock runs on towards the moment, a little at a time, while the runners work.
      while (clock.now < at) {
        clock.now = Math.min(at, clock.now + 100);
        await x.a.wallet.touch();
        await x.b.wallet.touch();
        await turns(1);
      }
      for (const [key, p] of [
        ["a", x.a],
        ["b", x.b],
      ] as const) {
        const index = p.log.length;
        for (const e of now) marks[key]!.push({ at, index, kind: e.kind, ...(e.view ? { view: true as const } : {}) });
        await Promise.all(now.map((e) => fire(p, e)));
      }
    }
    // The rest of the backlog, the alarms stopped and the pages gone quiet: the clock on, the users busy, till no tick
    // is expected (the alarms' last read, kept while it's to be waited for, past its grace too: the clock stands still in
    // `whenIdle`).
    stopped.alarms = true;
    try {
      for (let i = 0; i < 500; i++) {
        clock.now += 100;
        await x.a.wallet.touch();
        await x.b.wallet.touch();
        await turns(1);
      }
      await x.a.messaging.whenIdle();
      await x.b.messaging.whenIdle();
    } finally {
      stopped.alarms = false;
    }
    expect(requestsOf(x.a)).toEqual(requestsOf(x.b));
    expectLanesClean(x.a);
    expectLanesClean(x.b);
    // Every step's call: none from TAKE_MARGIN_MS before a tick until its lane started (or, for the sessions' alarm,
    // TICK_GRACE_MS past it), none in a lane; and at every tick's first page no step running.
    // The runner's own: what a lane does is the lane's (`expectLanesClean` above).
    // For B as for A (1.10.0's second review: the margin was looked at for A alone, and B's own first phase after a lane
    // is the runner's work as much as A's take).
    for (const [key, p, from] of [
      ["a", x.a, started],
      ["b", x.b, 0],
    ] as const) {
      const inLane = new Set(lanesOf(p).flatMap((lane) => Array.from({ length: lane.to - lane.from + 1 }, (_, i) => p.log[lane.from + i]!)));
      const steps = (entries: LogEntry[]) => entries.filter((l) => !inLane.has(l) && ["get", "set", "remove", "open", "receive", "step-start"].includes(l.what));
      // A page's first sync is as it's shown: off the grid (the residual's "a page's own sync as it's shown"), and the
      // first page's starts the grid. Every tick after is one the worker expects.
      let prev = from;
      let checked = 0;
      for (const m of marks[key]!) {
        if (!m.view) {
          // A tick no lane serves is waited for until it's TICK_GRACE_MS past, and no longer.
          const until = m.kind === "sessions" ? p.log.findIndex((l, i) => i >= m.index && l.at >= m.at + TICK_GRACE_MS) : m.index;
          const window = p.log.slice(prev, until < 0 ? p.log.length : until).filter((l) => l.at >= m.at - TAKE_MARGIN_MS);
          expect(steps(window), `${key}: the runner's calls in the margin before ${m.kind} at +${(m.at - base) / 1000} s`).toEqual([]);
          checked++;
        }
        prev = m.index;
      }
      expect(checked).toBe(events.length - 2);
      let depth = 0;
      for (const l of p.log) {
        if (l.what === "step-start") depth++;
        else if (l.what === "step-end") depth--;
        else if (l.what === "lane-start") expect(depth, `${key}: a step running as a lane starts`).toBe(0);
      }
    }
    // The backlog was taken between the ticks: every envelope opened, over many of them.
    const opens = x.a.log.filter((l) => l.what === "open");
    expect(opens.length).toBeGreaterThanOrEqual(2000);
    const spread = new Set(opens.map((o) => Math.floor((o.at - base) / 10_000)));
    console.log(`[runner a] ${opens.length} envelopes taken across ${spread.size} of the ticks' 10-second spans; lanes A ${lanesOf(x.a).length}, B ${lanesOf(x.b).length}`);
    expect(spread.size).toBeGreaterThanOrEqual(5);
  });

  it("(b) a step that overruns into a tick's margin: its next call into the wallet's queue waits for that tick's lane", async () => {
    const base = clock.now;
    const x = await world({ ticks: alarms(base), takeMarginMs: TAKE_MARGIN_MS });
    const cid = await writing(x, () => talking(x.w, x.a, ALICE_SEEDELF));
    await synced(x.a);
    await writing(x, () => x.w.messaging.send("preprod", cid, "a slow one"));
    // The next alarm, and a receive that runs on into its margin.
    const tickAt = alarms(base)()[0]!.at;
    const wasm = loadTestWasm();
    let slow = false;
    let after = -1;
    x.a.restart({
      ...wasm,
      messagingReceive: (key, request) => {
        const answer = wasm.messagingReceive(key, request);
        if (!slow) {
          slow = true;
          after = x.a.log.length;
          clock.now = tickAt - TAKE_MARGIN_MS / 2;
        }
        return answer;
      },
    } as Wasm);
    clock.now = tickAt - 10_000;
    await x.a.wallet.touch();
    await x.a.messaging.sync("preprod");
    for (let i = 0; i < 200 && !slow; i++) await turns(1);
    expect(slow).toBe(true);
    await turns(20);
    const record = await recordName(x.a, cid);
    const lane = x.a.log.length;
    // The tick: its lane runs, then the step's write.
    clock.now = tickAt;
    await x.a.wallet.touch();
    // The alarm's own run, said so (F1, as in (a)).
    await x.a.messaging.syncAll(["preprod"], { alarm: true });
    await x.a.messaging.whenIdle();
    const wrote = x.a.log.findIndex((l, i) => i > after && l.what === "set" && l.name === record);
    const ended = x.a.log.findIndex((l, i) => i >= lane && l.what === "lane-end");
    expect(wrote).toBeGreaterThan(ended);
    expect(await texts(x.a, cid)).toContain("in:a slow one");
  });

  it("(c) a first message the crate refuses at its first phase reads no requests record; a genuine new one reads it once; no read past a conversation's share", async () => {
    const x = await world();
    await strangers(x, 8);
    await refusedFirsts(x, 1);
    let from = x.a.log.length;
    await synced(x.a);
    const requestReads = (f: number) => x.a.log.slice(f).filter((l) => l.what === "get" && l.name === "messagingRequests.preprod").length;
    expect(x.a.log.slice(from).filter((l) => l.what === "receive")).toHaveLength(1);
    expect(requestReads(from)).toBe(0);
    from = x.a.log.length;
    await writing(x, () => x.w.messaging.start("preprod", ALICE_SEEDELF, "a genuine new one"));
    await synced(x.a);
    // Received twice, read once: the first phase without the record, the second with it.
    expect(x.a.log.slice(from).filter((l) => l.what === "receive")).toHaveLength(2);
    expect(requestReads(from)).toBe(1);
    const biggest = Math.max(...x.a.log.filter((l) => l.what === "get").map((l) => l.bytes ?? 0));
    expect(biggest).toBeLessThanOrEqual(CONVERSATION_SHARE_BYTES);
  });

  it("(d) a stop between the requests record's write and the inbox's, then a join of that request past 48 hours: taken, the repair having run first", async () => {
    const x = await world();
    const cid = await writing(x, () => x.w.messaging.start("preprod", ALICE_SEEDELF, "the request's first"));
    // A's take writes the requests record, and the worker stops before the inbox that lists it.
    x.a.beforeWrite = (name) => {
      if (name === "messaging.preprod") throw new Error("the worker stopped");
    };
    await synced(x.a);
    x.a.beforeWrite = undefined;
    expect((await x.a.messaging.overview("preprod")).requests).toEqual([]);
    x.a.restart();
    // Past the 48 hours a first message starts a request in: a join is still taken.
    await busyFor(49 * 3600_000, x.w, x.a, x.b);
    await writing(x, () => x.w.messaging.send("preprod", cid, "the request's second"));
    await synced(x.a);
    const listed = (await x.a.messaging.overview("preprod")).requests;
    expect(listed.map((r) => [r.cid, r.messages])).toEqual([[cid, 2]]);
  });

  it("(d′) a request kept in its record whose list's write the browser refuses: the take stops for room, then lists it, nothing counted lost", async () => {
    const x = await world();
    let previous = "";
    let refused = 0;
    x.a.beforeWrite = (name) => {
      const after = previous;
      previous = name;
      if (name === "messaging.preprod" && after === "messagingRequests.preprod" && refused === 0) {
        refused++;
        throw new Error("QUOTA_BYTES quota exceeded");
      }
    };
    const cid = await writing(x, () => x.w.messaging.start("preprod", ALICE_SEEDELF, "kept in the record"));
    await synced(x.a);
    expect(refused).toBe(1);
    expect((await x.a.messaging.overview("preprod")).full).toBe(true);
    x.a.beforeWrite = undefined;
    await synced(x.a);
    const overview = await x.a.messaging.overview("preprod");
    expect(overview.full).toBeUndefined();
    expect(overview.requests.map((r) => [r.cid, r.messages])).toEqual([[cid, 1]]);
    expect(overview.dropped).toBeUndefined();
    expect(await x.a.messaging.request("preprod", cid)).toHaveLength(1);
  });

  it("(e) a record held above its share by the user's own waiting messages: a take's message for it is dropped and counted, the user's send kept", async () => {
    const share = storedBytes(4096);
    const x = await world({ shareBytes: share });
    const cid = await writing(x, () => talking(x.a, x.w, CAROL_SEEDELF));
    await synced(x.a);
    x.answer = () => {
      throw new TypeError("Failed to fetch");
    };
    for (let i = 0; i < 8; i++) await x.a.messaging.send("preprod", cid, `waiting ${i} `.padEnd(300, "w"));
    await x.a.messaging.whenIdle();
    const record = await recordName(x.a, cid);
    const size = () => {
      const raw = x.a.local.data.get(PRIVATE_PREFIX + record) as string;
      return (JSON.parse(raw) as { data: string }).data.length;
    };
    expect(size()).toBeGreaterThan(share);
    await writing(x, () => x.w.messaging.send("preprod", cid, "no room beside them"));
    await synced(x.a);
    expect(await texts(x.a, cid)).not.toContain("in:no room beside them");
    expect((await x.a.messaging.overview("preprod")).dropped).toBe(1);
    // The user's own send goes through, above the share.
    await x.a.messaging.send("preprod", cid, "the user's own");
    await x.a.messaging.whenIdle();
    expect((await fileOf(x.a, cid))!.history.at(-1)!.text).toBe("the user's own");
  });
});

describe("the rooms count as taken (round 5, fix item 7, O5)", { timeout: 300_000 }, () => {
  it("within 20 KB of the line, the rooms counted: A holding 50 requests and B none, the same send posts for both, or is refused for both", async () => {
    for (const fits of [true, false]) {
      const x = await world();
      await writing(x, async () => {
        for (let i = 0; i < 50; i++) await x.w.messaging.start("preprod", ALICE_SEEDELF, `request ${i}`);
      });
      for (const p of [x.a, x.b, x.a, x.b]) await synced(p);
      expect((await x.a.messaging.overview("preprod")).requests).toHaveLength(50);
      const ca = await writing(x, () => talking(x.a, x.w, CAROL_SEEDELF));
      const cb = await writing(x, () => talking(x.b, x.w, CAROL_SEEDELF));
      for (const p of [x.a, x.b]) await synced(p);
      const sent: Record<string, string | undefined> = {};
      for (const [key, p, cid] of [
        ["a", x.a, ca],
        ["b", x.b, cb],
      ] as const) {
        // The area within 20 KB of the line, with the rooms counted as taken: 20 KB left where the send fits, 200 bytes
        // where it doesn't (its record grows a whole pad).
        const rooms = await (p.messaging as unknown as { roomsHeld(): Promise<number> }).roomsHeld();
        const left = fits ? 20_000 : 200;
        const filler = "seedelf.other.filler";
        p.local.data.delete(filler);
        const fill = QUOTA_BYTES - RESERVE_BYTES - left - rooms - usedBytes(p);
        p.local.data.set(filler, JSON.stringify("x".repeat(fill - filler.length - 2)));
        const text = "z".repeat(fits ? 1500 : 6000);
        sent[key] = await p.messaging.send("preprod", cid, text).then(
          () => "posted",
          (e: unknown) => (e as Error).message,
        );
        await p.messaging.whenIdle();
      }
      console.log(`[rooms] ${fits ? "room" : "no room"}: A ${sent.a}, B ${sent.b}`);
      expect(sent.a).toBe(sent.b);
      if (fits) expect(sent.a).toBe("posted");
      else expect(sent.a).not.toBe("posted");
    }
  });
});

void BOB_SEEDELF;
void keptNew;

// Round 4's review, #3 (the 1.10.0 gate's round 5): the take record's room is never passed by a later write. A read is
// saved only where it fits with every count at its most digits, so the writes after it, which only drop reads or add to
// a count, never pad the record past the room the area's reserve counts it at.
describe("the take record's room, with its counts at their most (round 4's review, #3)", { timeout: 60_000 }, () => {
  /** Bob's take record's writes, as stored values, while one message of Alice's is read and taken under `room`. */
  async function oneRead(room?: number) {
    const { alice, bob } = await pair(room === undefined ? {} : { takeRoomBytes: room });
    const cid = await talking(alice, bob);
    const writes: Array<{ batches?: unknown[] }> = [];
    bob.beforeWrite = (name, value) => {
      if (name === "messagingTake.preprod") writes.push(value as { batches?: unknown[] });
    };
    await alice.messaging.send("preprod", cid, "one more");
    await alice.messaging.whenIdle();
    await synced(bob);
    bob.beforeWrite = undefined;
    return { writes, texts: await texts(bob, cid) };
  }

  it("saves a read only where it fits with the counts at their most digits; one that fits only with them at none is taken from memory", async () => {
    // The record with the read in it, its JSON length: what the room is set to below.
    const measured = await oneRead();
    const saved = measured.writes.find((w) => (w.batches?.length ?? 0) > 0)!;
    expect(saved).toBeDefined();
    const length = new TextEncoder().encode(JSON.stringify(saved)).length;
    const counts = ',"unopened":9007199254740991,"noRoom":9007199254740991,"seen":9007199254740991'.length;
    // Room for the read with no counts: not saved, since a count added later would pad it past its room. Taken all the
    // same, from memory.
    const tight = await oneRead(length);
    expect(tight.writes.every((w) => (w.batches?.length ?? 0) === 0)).toBe(true);
    expect(tight.texts.at(-1)).toBe("in:one more");
    // Room for it with every count at its most: saved.
    const roomy = await oneRead(length + counts);
    expect(roomy.writes.some((w) => (w.batches?.length ?? 0) > 0)).toBe(true);
    expect(roomy.texts.at(-1)).toBe("in:one more");
    for (const w of [...tight.writes, ...roomy.writes]) {
      expect(storedBytes(new TextEncoder().encode(JSON.stringify(w)).length)).toBeLessThanOrEqual(storedBytes(length + counts));
    }
  });
});
