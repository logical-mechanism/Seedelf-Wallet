// The lane and the read and take records (the 1.10.0 gate's round 5, fix
// items 4 and 6). A lane is every run of the wallet's requests to the relay: a
// sync's pages and then its posts, and every posting run. In one the wallet
// reads and writes only records whose size no envelope sets (the read record,
// the scan's mark, the user's own outbox), opens nothing and tells the screens
// nothing. Paired worlds: W writes, A holds strangers' requests at the crate's
// bound, a conversation at its share and a take backlog, B none; both read the
// same pages. Every assertion is on what each wallet asked and what it touched
// in each lane, deterministic counts; timings are logged, never asserted.
import { describe, expect, it } from "vitest";

import { PAD_MIN_BYTES, PRIVATE_PREFIX, type RecordName } from "../src/background/private-store";
import {
  ALICE_SEEDELF,
  another,
  CAROL_SEEDELF,
  clock,
  cursorOf,
  fileOf,
  loadTestWasm,
  type Party,
  PASSWORD,
  readOf,
  recordName,
  synced,
  takesOf,
  talking,
  texts,
  turns,
  type Wasm,
} from "./messaging-harness";
import {
  claiming,
  expectLanesClean,
  expectSameLanes,
  junk,
  keptNew,
  lanesOf,
  median,
  PAD,
  recordsIn,
  requestsOf,
  strangers,
  tick,
  world,
  type World,
  writing,
} from "./messaging-lanes-kit";

/** A second Seedelf under A's key that this browser didn't mint: off until the user turns it on. */
const ALICE2 = "5eed0e1f00" + Buffer.from("alice2").toString("hex");

const until = async (done: () => boolean, most = 20_000) => {
  for (let i = 0; i < most && !done(); i++) await new Promise((r) => setImmediate(r));
  return done();
};

/** A's conversation with W, W's long messages taken by A until its record is at its share. */
async function atShare(x: World): Promise<string> {
  const cid = await writing(x, () => talking(x.w, x.a, ALICE_SEEDELF));
  await writing(x, async () => {
    for (let i = 0; i < 24; i++) await x.w.messaging.send("preprod", cid, `${i} `.padEnd(30_000, "y"));
  });
  await synced(x.a);
  await synced(x.b);
  return cid;
}

/** The stored length of `p`'s record now. */
const stored = (p: Party, name: string) => {
  const raw = p.local.data.get(PRIVATE_PREFIX + name) as string | undefined;
  return raw === undefined ? 0 : (JSON.parse(raw) as { data: string }).data.length;
};

/** From sync() to `p`'s first GET, in each of its lanes after `from` (ms, real time). */
function firstGets(p: Party, from: number): number[] {
  return lanesOf(p, from).flatMap((lane) => {
    const get = lane.entries.find((e) => e.what === "GET");
    return get ? [get.t - p.log[lane.from]!.t] : [];
  });
}

describe("a lane touches only its own records (round 5, fix item 4)", { timeout: 300_000 }, () => {
  it("(a) 20 quiet syncs with A at the requests' bound, a conversation at its share and a take backlog: the same GETs, every lane clean", async () => {
    const x = await world();
    await strangers(x, 8);
    await atShare(x);
    expect(stored(x.a, "messagingRequests.preprod")).toBe(699_072);
    // A backlog: 300 envelopes A's scan claims, which its take goes through between the ticks.
    for (let i = 0; i < 300; i++) x.relay.put("preprod", junk(i));
    // Both workers new over the same storage: each reads its read record once, at its first lane.
    x.a.restart(claiming((e) => e.endsWith("5a5a5a5a")));
    x.b.restart();
    x.a.passOverOk = true;
    const [fa, fb] = [x.a.log.length, x.b.log.length];
    for (let k = 0; k < 20; k++) {
      await tick(x.a);
      await tick(x.b);
    }
    await x.a.messaging.whenIdle();
    await x.b.messaging.whenIdle();
    expect(requestsOf(x.a, fa)).toEqual(requestsOf(x.b, fb));
    expect(requestsOf(x.a, fa).filter((r) => r.startsWith("GET "))).toHaveLength(20);
    expectLanesClean(x.a, fa);
    expectLanesClean(x.b, fb);
    expectSameLanes(x.a, x.b, fa, fb);
    // Each lane's records at the read record's one size, A's as B's.
    for (const lane of lanesOf(x.a, fa)) for (const r of recordsIn(lane)) if (r.includes("messagingRead")) expect(r).toMatch(new RegExp(` ${PAD}$`));
    // The backlog was taken between the ticks, never in a lane.
    expect(x.a.log.slice(fa).filter((e) => e.what === "open").length).toBeGreaterThanOrEqual(300);
    console.log(`[lanes a] sync() to the first GET, median ms: A ${median(firstGets(x.a, fa)).toFixed(2)}, B ${median(firstGets(x.b, fb)).toFixed(2)}`);
  });

  it("(b) one and two waiting posts each: between the last GET and the first POST only the outbox record's read, between two POSTs nothing", async () => {
    const x = await world();
    await strangers(x, 8);
    const ca = await writing(x, () => talking(x.a, x.w, CAROL_SEEDELF));
    const cb = await writing(x, () => talking(x.b, x.w, CAROL_SEEDELF));
    for (const p of [x.a, x.b, x.a, x.b]) await synced(p);
    for (const count of [1, 2]) {
      x.answer = () => {
        throw new TypeError("Failed to fetch");
      };
      for (const [p, cid] of [
        [x.a, ca],
        [x.b, cb],
      ] as const) {
        for (let i = 0; i < count; i++) await p.messaging.send("preprod", cid, `waiting ${count}.${i}`);
        await p.messaging.whenIdle();
      }
      x.answer = () => keptNew();
      const [fa, fb] = [x.a.log.length, x.b.log.length];
      await synced(x.a);
      await synced(x.b);
      expect(requestsOf(x.a, fa)).toEqual(requestsOf(x.b, fb));
      for (const p of [x.a, x.b]) {
        const lane = lanesOf(p, p === x.a ? fa : fb)[0]!;
        const at = (i: number) => lane.entries[i]!;
        const gets = lane.entries.flatMap((e, i) => (e.what === "GET" ? [i] : []));
        const posts = lane.entries.flatMap((e, i) => (e.what === "POST" ? [i] : []));
        expect(posts).toHaveLength(count);
        const between = (from: number, to: number) =>
          lane.entries.slice(from + 1, to).filter((e) => e.what === "get" || e.what === "set").map((e) => `${e.what} ${e.name}`);
        expect(between(gets.at(-1)!, posts[0]!)).toEqual(["get messagingOutbox.preprod"]);
        if (count === 2) expect(between(posts[0]!, posts[1]!)).toEqual([]);
        expect(at(0)).toBeDefined();
      }
      expectLanesClean(x.a, fa);
      expectLanesClean(x.b, fb);
    }
  });

  it("(c) a page open, told of every change: no notice and no screen read lands in a lane, whatever the relay or the take does", async () => {
    const x = await world();
    await strangers(x, 2);
    const ca = await writing(x, () => talking(x.w, x.a, ALICE_SEEDELF));
    const request = (await x.a.messaging.overview("preprod")).requests[0]!.cid;
    const cb = await writing(x, () => talking(x.b, x.w, CAROL_SEEDELF));
    for (const p of [x.a, x.b, x.a, x.b]) await synced(p);
    // A page of each, as the screens read: the overview, the open thread, and a request, at each change notice.
    const screens: Array<Promise<unknown>> = [];
    for (const [p, cid, req] of [
      [x.a, ca, request],
      [x.b, cb, undefined],
    ] as const) {
      const push = p.changed.push.bind(p.changed);
      p.changed.push = (...items) => {
        for (const n of items) {
          screens.push(p.messaging.overview(n).catch(() => undefined));
          screens.push(p.messaging.thread(n, cid).catch(() => undefined));
          if (req) screens.push(p.messaging.request(n, req).catch(() => undefined));
        }
        return push(...items);
      };
    }
    const [fa, fb] = [x.a.log.length, x.b.log.length];
    // A page that fails, then one that answers: the relay says the read changed mid-read.
    x.relay.up = false;
    for (const p of [x.a, x.b]) await synced(p);
    x.relay.up = true;
    // A message of W's for A, so A's take ends with something to tell; and a post each, met with a 402 and a size wait.
    await writing(x, () => x.w.messaging.send("preprod", ca, "for A's take"));
    for (const [p, cid] of [
      [x.a, ca],
      [x.b, cb],
    ] as const) {
      x.answer = () => {
        throw new TypeError("Failed to fetch");
      };
      await p.messaging.send("preprod", cid, "met with a 402");
      await p.messaging.whenIdle();
    }
    // Each wallet's posts met alike: a 402, then a size's wait, then kept.
    let current = x.a;
    const answered = new Map<Party, number>();
    x.answer = () => {
      const k = (answered.get(current) ?? 0) + 1;
      answered.set(current, k);
      return k === 1
        ? new Response(JSON.stringify({ error: "more proof of work", price: 6 }), { status: 402, headers: { "content-type": "application/json" } })
        : k === 2
          ? new Response(JSON.stringify({ error: "full for now" }), { status: 429, headers: { "content-type": "application/json", "retry-after": "1" } })
          : keptNew();
    };
    for (const p of [x.a, x.b]) {
      current = p;
      await synced(p);
    }
    clock.now += 2000;
    for (const p of [x.a, x.b]) {
      current = p;
      await p.wallet.touch();
      await synced(p);
    }
    await Promise.all(screens);
    expect(requestsOf(x.a, fa)).toEqual(requestsOf(x.b, fb));
    for (const [p, from] of [
      [x.a, fa],
      [x.b, fb],
    ] as const) {
      // The overview answers at once (O8): the wallet's own record of which Seedelfs it made is all it reads.
      expectLanesClean(p, from, new Set(["mintedAt.preprod"]));
      // No notice inside a lane: each comes once no lane runs.
      for (const lane of lanesOf(p, from)) expect(lane.entries.filter((e) => e.what === "changed")).toEqual([]);
      expect(p.log.slice(from).some((e) => e.what === "changed")).toBe(true);
    }
    expect(await texts(x.a, ca)).toContain("in:for A's take");
  });

  it("(d) both networks on, A's preprod requests at the bound: mainnet's first page has nothing of preprod's before it but its fixed records", async () => {
    const x = await world();
    await strangers(x, 8);
    for (const p of [x.a, x.b]) {
      await p.messaging.switch("mainnet", true);
      await p.messaging.whenIdle();
    }
    const firsts: Record<string, string[][]> = { a: [], b: [] };
    const times: Record<string, number[]> = { a: [], b: [] };
    for (let k = 0; k < 10; k++) {
      for (const [key, p] of [
        ["a", x.a],
        ["b", x.b],
      ] as const) {
        const from = p.log.length;
        await p.messaging.syncAll(["mainnet", "preprod"]);
        await p.messaging.whenIdle();
        const log = p.log.slice(from);
        const main = log.findIndex((e) => e.what === "GET" && e.name!.includes("/mainnet/"));
        firsts[key]!.push(log.slice(0, main).filter((e) => e.what === "get" || e.what === "set").map((e) => `${e.what} ${e.name} ${e.bytes}`));
        times[key]!.push(log[main]!.t - log[0]!.t);
        expectLanesClean(p, from);
      }
    }
    expect(firsts.a).toEqual(firsts.b);
    for (const records of firsts.a!) for (const r of records) expect(r).toMatch(/^(get|set) messaging(Read|Mark|Outbox)\.(preprod|mainnet) /);
    console.log(`[lanes d] the alarm to mainnet's first page, median ms: A ${median(times.a!).toFixed(2)}, B ${median(times.b!).toFixed(2)}`);
  });

  it("(e) the same over chrome.storage's IPC (every get and set a macrotask later) and the worker's own setTimeout(0) waits", async () => {
    const x = await world({ ipc: true });
    await strangers(x, 4);
    for (let i = 0; i < 120; i++) x.relay.put("preprod", junk(i));
    x.a.restart(claiming((e) => e.endsWith("5a5a5a5a")));
    x.b.restart();
    x.a.passOverOk = true;
    // A page open on each, its overview read again at every notice.
    for (const p of [x.a, x.b]) {
      const push = p.changed.push.bind(p.changed);
      p.changed.push = (...items) => {
        for (const n of items) void p.messaging.overview(n).catch(() => undefined);
        return push(...items);
      };
    }
    const [fa, fb] = [x.a.log.length, x.b.log.length];
    for (let k = 0; k < 10; k++) {
      await tick(x.a);
      await tick(x.b);
    }
    await x.a.messaging.whenIdle();
    await x.b.messaging.whenIdle();
    expect(requestsOf(x.a, fa)).toEqual(requestsOf(x.b, fb));
    // The whole of each lane (round 5's admit check): a take's call queued as a lane starts, or still reading the
    // session for its turn, gives the queue back as its turn comes, so nothing of a step's runs anywhere in a lane.
    expectLanesClean(x.a, fa);
    expectLanesClean(x.b, fb);
    // And in each lane, the same records at the same lengths for A as for B.
    expectSameLanes(x.a, x.b, fa, fb);
  });

  it("(f) after a restart, A and B read the read record alone before their first page", async () => {
    const x = await world();
    await strangers(x, 8);
    x.a.restart();
    x.b.restart();
    const [fa, fb] = [x.a.log.length, x.b.log.length];
    await synced(x.a);
    await synced(x.b);
    for (const [p, from] of [
      [x.a, fa],
      [x.b, fb],
    ] as const) {
      const log = p.log.slice(from);
      const first = log.findIndex((e) => e.what === "GET");
      expect(log.slice(0, first).filter((e) => e.what === "get" || e.what === "set").map((e) => `${e.what} ${e.name} ${e.bytes}`)).toEqual([
        `get messagingRead.preprod ${PAD}`,
      ]);
    }
    expect(requestsOf(x.a, fa)).toEqual(requestsOf(x.b, fb));
  });

  it("(g) a press during a lane's posts: its envelope appended, nothing lost, nothing posted twice", async () => {
    const x = await world();
    const cid = await writing(x, () => talking(x.a, x.w, CAROL_SEEDELF));
    x.answer = () => {
      throw new TypeError("Failed to fetch");
    };
    await x.a.messaging.send("preprod", cid, "one");
    await x.a.messaging.send("preprod", cid, "two");
    await x.a.messaging.whenIdle();
    const bodies: string[] = [];
    let press: Promise<void> | undefined;
    x.answer = () => keptNew();
    const real = x.relay.fetch;
    x.relay.fetch = async (url, init) => {
      if (init.method === "POST") {
        bodies.push(Buffer.from(new Uint8Array(init.body as ArrayBuffer).subarray(8)).toString("hex"));
        // The user sends a third as the first post goes: it waits for the lane, then is appended and posted.
        if (bodies.length === 1) press = x.a.messaging.send("preprod", cid, "three");
      }
      return real(url, init);
    };
    await synced(x.a);
    await press;
    await x.a.messaging.whenIdle();
    expect(bodies).toHaveLength(3);
    expect(new Set(bodies).size).toBe(3);
    expect((await fileOf(x.a, cid))!.history.filter((e) => e.dir === "out").map((e) => e.sent)).toEqual(["posted", "posted", "posted", "posted"]);
    expectLanesClean(x.a);
  });

  it("(h) a conversation deleted with an envelope waiting, then a restart: nothing of it is posted", async () => {
    const x = await world();
    const cid = await writing(x, () => talking(x.a, x.w, CAROL_SEEDELF));
    x.answer = () => {
      throw new TypeError("Failed to fetch");
    };
    await x.a.messaging.send("preprod", cid, "never posted");
    await x.a.messaging.whenIdle();
    await x.a.messaging.remove("preprod", cid);
    x.a.restart();
    x.answer = () => keptNew();
    const from = x.a.log.length;
    await synced(x.a);
    expect(requestsOf(x.a, from).filter((r) => r.startsWith("POST "))).toEqual([]);
  });

  it("(i) clear() in the middle of a lane: that lane writes no cursor; answerAt (on) waits for the lane; the next lane reads from the oldest either way", async () => {
    for (const press of ["clear", "answerAt"] as const) {
      const x = await world();
      await writing(x, () => x.w.messaging.start("preprod", ALICE_SEEDELF, "a first message"));
      await synced(x.a);
      // A second Seedelf under A's key, in its kept view, not on yet: turning it on reads the pool again from its oldest.
      const register = await another(x.a);
      x.a.own.push({ name: ALICE2, register });
      // The lane held at its first page.
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      let holding = false;
      const real = x.relay.fetch;
      x.relay.fetch = async (url, init) => {
        if (init.method === "GET" && !holding) {
          holding = true;
          await held;
        }
        return real(url, init);
      };
      const from = x.a.log.length;
      const sync = x.a.messaging.sync("preprod");
      expect(await until(() => holding)).toBe(true);
      const pressed = press === "clear" ? x.a.messaging.clear("preprod") : x.a.messaging.answerAt("preprod", ALICE2, register, true);
      await turns(5);
      release();
      await sync;
      await pressed;
      await x.a.messaging.whenIdle();
      x.relay.fetch = real;
      const lane = lanesOf(x.a, from)[0]!;
      if (press === "clear") expect(lane.entries.filter((e) => e.what === "set" && e.name === "messagingRead.preprod")).toEqual([]);
      const next = x.a.log.length;
      await synced(x.a);
      expect(requestsOf(x.a, next)[0]).toBe("GET /messaging/v1/preprod/envelopes");
    }
  });

  it("(j) a screen's overview, thread and request sent with a page's sync, in both orders: inside the lane nothing but its own records", async () => {
    const x = await world();
    await strangers(x, 2);
    const cid = await writing(x, () => talking(x.w, x.a, ALICE_SEEDELF));
    const request = (await x.a.messaging.overview("preprod")).requests[0]!.cid;
    for (const first of ["screens", "sync"] as const) {
      const from = x.a.log.length;
      const screens = () => [x.a.messaging.overview("preprod"), x.a.messaging.thread("preprod", cid), x.a.messaging.request("preprod", request)];
      let asked: Array<Promise<unknown>> = [];
      let sync: Promise<void>;
      if (first === "screens") {
        asked = screens();
        sync = x.a.messaging.sync("preprod", { page: "page-1", kind: "grid" });
      } else {
        sync = x.a.messaging.sync("preprod", { page: "page-1", kind: "grid" });
        asked = screens();
      }
      await Promise.all([sync, ...asked]);
      await x.a.messaging.whenIdle();
      // The overview answers at once (O8): the wallet's own record of which Seedelfs it made is all it reads.
      expectLanesClean(x.a, from, new Set(["mintedAt.preprod"]));
      // What the screens read comes after the lane: none of it began inside it.
      const lane = lanesOf(x.a, from)[0]!;
      const conversation = await recordName(x.a, cid);
      const after = x.a.log.slice(lane.to).filter((e) => e.what === "get").map((e) => e.name);
      expect(after).toContain(conversation);
      expect(after).toContain("messagingRequests.preprod");
    }
  });
});

describe("what the lane's end tells open pages (round 4's review, round 5)", { timeout: 120_000 }, () => {
  it("a gap the relay says, and its day's hold: each told once the lane has ended, and shown in the overview", async () => {
    const x = await world();
    await synced(x.a);
    x.a.changed.length = 0;
    x.relay.gapOnce = true;
    const from = x.a.log.length;
    await synced(x.a);
    expect(x.a.changed).toContain("preprod");
    expect((await x.a.messaging.overview("preprod")).gapAt).toBeDefined();
    for (const lane of lanesOf(x.a, from)) expect(lane.entries.filter((e) => e.what === "changed")).toEqual([]);
    // The day's share read (W16): a 429 that names it.
    x.a.changed.length = 0;
    const real = x.relay.fetch;
    x.relay.fetch = async (url, init) =>
      init.method === "GET"
        ? new Response(JSON.stringify({ error: "this address has read its share of the pool for the day" }), {
            status: 429,
            headers: { "content-type": "application/json", "retry-after": "3600" },
          })
        : real(url, init);
    await synced(x.a);
    x.relay.fetch = real;
    const overview = await x.a.messaging.overview("preprod");
    expect(overview.dayReadUntil).toBeDefined();
    expect(x.a.changed).toContain("preprod");
  });
});

describe("the read and take records (round 5, fix item 6)", { timeout: 300_000 }, () => {
  it("(a) after a restart the only record read before the first page is the read record; the take record is read after the lane", async () => {
    const x = await world();
    await strangers(x, 4);
    x.a.restart();
    x.b.restart();
    const [fa, fb] = [x.a.log.length, x.b.log.length];
    await synced(x.a);
    await synced(x.b);
    for (const [p, from] of [
      [x.a, fa],
      [x.b, fb],
    ] as const) {
      const lane = lanesOf(p, from)[0]!;
      const first = lane.entries.findIndex((e) => e.what === "GET");
      expect(recordsIn({ ...lane, entries: lane.entries.slice(0, first) })).toEqual([`get messagingRead.preprod ${PAD}`]);
      const take = p.log.findIndex((e, i) => i > from && e.what === "get" && e.name === "messagingTake.preprod");
      if (take >= 0) expect(take).toBeGreaterThan(lane.to);
    }
  });

  it("(b) no take record write between the last page and the first post: it comes after the lane's end", async () => {
    const x = await world();
    const ca = await writing(x, () => talking(x.w, x.a, ALICE_SEEDELF));
    const mine = await writing(x, () => talking(x.a, x.w, CAROL_SEEDELF));
    await synced(x.a);
    x.answer = () => {
      throw new TypeError("Failed to fetch");
    };
    await x.a.messaging.send("preprod", mine, "waiting");
    await x.a.messaging.whenIdle();
    x.answer = () => keptNew();
    await writing(x, () => x.w.messaging.send("preprod", ca, "for A"));
    const from = x.a.log.length;
    await synced(x.a);
    const lane = lanesOf(x.a, from)[0]!;
    expect(lane.entries.some((e) => e.what === "POST")).toBe(true);
    expect(lane.entries.filter((e) => e.name === "messagingTake.preprod")).toEqual([]);
    expect(x.a.log.slice(lane.to).some((e) => e.what === "set" && e.name === "messagingTake.preprod")).toBe(true);
    expect(await texts(x.a, ca)).toContain("in:for A");
  });

  it("(c) the take record is written once a read saved and once a read taken, never once an envelope", async () => {
    const x = await world();
    const cid = await writing(x, () => talking(x.w, x.a, ALICE_SEEDELF));
    await synced(x.a);
    const from = x.a.log.length;
    for (let k = 0; k < 3; k++) {
      await writing(x, async () => {
        for (let i = 0; i < 5; i++) await x.w.messaging.send("preprod", cid, `read ${k}, message ${i}`);
      });
      await synced(x.a);
    }
    const writes = x.a.log.slice(from).filter((e) => e.what === "set" && e.name === "messagingTake.preprod").length;
    expect(writes).toBe(2 * 3);
    expect((await texts(x.a, cid)).filter((m) => m.startsWith("in:read "))).toHaveLength(15);
  });

  it("(d) the browser refusing A's take record write: A's lanes match B's, the read taken from memory; with a stop before it's taken, counted", async () => {
    for (const stop of [false, true]) {
      const x = await world();
      const cid = await writing(x, () => talking(x.w, x.a, ALICE_SEEDELF));
      for (const p of [x.a, x.b]) await synced(p);
      const set = x.a.local.set.bind(x.a.local);
      let refused = 0;
      x.a.local.set = async (key, value) => {
        if (key === PRIVATE_PREFIX + "messagingTake.preprod" && refused === 0) {
          refused++;
          throw new Error("QUOTA_BYTES quota exceeded");
        }
        return set(key, value);
      };
      // A's take held at its record, where `stop` is: so the read, not saved, waits in memory as the worker stops.
      let holding = false;
      const record = await recordName(x.a, cid);
      if (stop) x.a.beforeWrite = async (name) => void (name === record && (holding = true) && (await new Promise(() => undefined)));
      await writing(x, () => x.w.messaging.send("preprod", cid, "taken from memory"));
      const [fa, fb] = [x.a.log.length, x.b.log.length];
      await tick(x.a);
      await tick(x.b);
      if (stop) {
        expect(await until(() => holding)).toBe(true);
        x.a.beforeWrite = undefined;
        x.a.restart();
      }
      for (let k = 0; k < 3; k++) {
        await synced(x.a);
        await synced(x.b);
      }
      expect(refused).toBe(1);
      expect(requestsOf(x.a, fa)).toEqual(requestsOf(x.b, fb));
      expectLanesClean(x.a, fa);
      const overview = await x.a.messaging.overview("preprod");
      if (stop) {
        expect(await texts(x.a, cid)).not.toContain("in:taken from memory");
        expect(overview.droppedUnread).toBe(1);
      } else {
        expect(await texts(x.a, cid)).toContain("in:taken from memory");
        expect(overview.droppedUnread).toBeUndefined();
      }
      expect(overview.full).toBeUndefined();
    }
  });

  it("(e) a flood of 300 of A's envelopes, past the take record's room: not saved, and A's lanes are B's", async () => {
    const x = await world();
    for (let i = 0; i < 300; i++) x.relay.put("preprod", junk(i));
    x.a.restart(claiming((e) => e.endsWith("5a5a5a5a")));
    x.b.restart();
    x.a.passOverOk = true;
    const [fa, fb] = [x.a.log.length, x.b.log.length];
    let biggest = 0;
    x.a.beforeWrite = (name, value) => {
      if (name === "messagingTake.preprod") biggest = Math.max(biggest, (value as { batches: unknown[] }).batches.length);
    };
    for (let k = 0; k < 3; k++) {
      await tick(x.a);
      await tick(x.b);
    }
    await x.a.messaging.whenIdle();
    expect(biggest).toBe(0);
    expect(requestsOf(x.a, fa)).toEqual(requestsOf(x.b, fb));
    expectSameLanes(x.a, x.b, fa, fb);
    expect(x.a.log.slice(fa).filter((e) => e.what === "open").length).toBe(300);
  });

  it("(f) the read record at its largest stays in its 1 KiB pad: 1,388 bytes stored", async () => {
    const x = await world();
    await synced(x.a);
    const service = x.a.messaging as unknown as {
      readRecords: Map<string, { cursor?: string; gapAt?: number; skip: unknown[]; clock?: unknown; owed: number; dirty: boolean }>;
      writeRead(network: string, held: unknown, gated: boolean): Promise<void>;
    };
    const held = service.readRecords.get("preprod")!;
    held.cursor = "18446744073709551615";
    held.gapAt = 9_999_999_999_999;
    held.clock = { at: 9_999_999_999_999, off: -9_999_999_999_999 };
    held.skip = Array.from({ length: 6 }, (_, i) => ({ envelope: "f".repeat(63) + i, until: 9_999_999_999_999 }));
    held.owed = 99_999;
    held.dirty = true;
    await service.writeRead("preprod", held, true);
    const read = (await readOf(x.a))!;
    expect(JSON.stringify(read).length).toBeLessThanOrEqual(PAD_MIN_BYTES);
    expect(stored(x.a, "messagingRead.preprod")).toBe(PAD);
    expect(read.skip).toHaveLength(6);
  });

  it("(g) a trap in a take, then Try again: the take steps over that envelope and takes the rest, one lock in all", async () => {
    const x = await world();
    const cid = await writing(x, () => talking(x.w, x.a, ALICE_SEEDELF));
    await synced(x.a);
    const before = x.relay.pools.get("preprod")!.held.length;
    await writing(x, async () => {
      for (const text of ["traps", "after it", "and after that"]) await x.w.messaging.send("preprod", cid, text);
    });
    const bad = Buffer.from(x.relay.pools.get("preprod")!.held[before]!.bytes).toString("hex");
    const wasm = loadTestWasm();
    const trapping: Wasm = {
      ...wasm,
      messagingReceive: (key, request) => {
        if ((JSON.parse(request) as { envelope: string }).envelope === bad) throw new WebAssembly.RuntimeError("unreachable");
        return wasm.messagingReceive(key, request);
      },
    };
    x.a.restart(trapping);
    // Each trap leaves its flag (`messagingTrap`): how many times the take locked the wallet.
    let locks = 0;
    const set = x.a.local.set.bind(x.a.local);
    x.a.local.set = async (key, value) => {
      if (key === PRIVATE_PREFIX + "messagingTrap.preprod") locks++;
      return set(key, value);
    };
    await synced(x.a);
    expect(await x.a.wallet.state()).toBe("locked");
    await x.a.wallet.unlock(PASSWORD);
    // Nothing of the network is taken by itself while it's stopped.
    await synced(x.a);
    expect(await texts(x.a, cid)).not.toContain("in:after it");
    await x.a.messaging.retry("preprod");
    await x.a.messaging.whenIdle();
    expect(await x.a.wallet.state()).toBe("unlocked");
    expect((await texts(x.a, cid)).filter((m) => m === "in:after it" || m === "in:and after that")).toHaveLength(2);
    expect(await texts(x.a, cid)).not.toContain("in:traps");
    expect(locks).toBe(1);
    expect((await readOf(x.a))!.skip).toHaveLength(1);
  });

  it("(h) a take backlog across ticks, then a lock: every read made meanwhile was saved in a first phase, and is taken after the unlock, no page asked again", async () => {
    const x = await world();
    const cid = await writing(x, () => talking(x.w, x.a, ALICE_SEEDELF));
    await synced(x.a);
    // Each take step slow (its record's write 30 turns late): the reads come faster than they're taken.
    const record = await recordName(x.a, cid);
    x.a.beforeWrite = async (name) => {
      if (name === record) for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
    };
    let saved = 0;
    const set = x.a.local.set.bind(x.a.local);
    x.a.local.set = async (key, value) => {
      if (key === PRIVATE_PREFIX + "messagingTake.preprod") saved++;
      return set(key, value);
    };
    for (let k = 0; k < 4; k++) {
      await writing(x, async () => {
        for (let i = 0; i < 4; i++) await x.w.messaging.send("preprod", cid, `tick ${k}, ${i}`);
      });
      await tick(x.a);
    }
    const kept = (await takesOf(x.a))!.batches.length;
    expect(kept).toBeGreaterThan(0);
    expect(saved).toBeGreaterThanOrEqual(kept);
    const end = await cursorOf(x.a);
    await x.a.wallet.lock();
    await x.a.messaging.whenIdle();
    x.a.beforeWrite = undefined;
    clock.now += 1000;
    await x.a.wallet.unlock(PASSWORD);
    const from = x.a.log.length;
    for (let k = 0; k < 2; k++) await synced(x.a);
    expect(requestsOf(x.a, from).every((r) => r === `GET /messaging/v1/preprod/envelopes?after=${end}`)).toBe(true);
    expect((await texts(x.a, cid)).filter((m) => m.startsWith("in:tick "))).toHaveLength(16);
    expect((await takesOf(x.a))!.batches).toEqual([]);
  });

  it("(i) a worker stopped with no unlock while it owed envelopes: the next worker's overview counts them", async () => {
    const x = await world();
    const cid = await writing(x, () => talking(x.w, x.a, ALICE_SEEDELF));
    await synced(x.a);
    for (let i = 0; i < 300; i++) x.relay.put("preprod", junk(i));
    x.a.restart(claiming((e) => e.endsWith("5a5a5a5a")));
    x.a.passOverOk = true;
    // The read's first envelope's take never ends: the 300, past the take record's room, are owed as the worker stops.
    let holding = false;
    x.a.beforeWrite = async (name) => {
      if (name === "messagingTakeMark.preprod" && !holding) {
        holding = true;
        await new Promise(() => undefined);
      }
    };
    await tick(x.a);
    expect(await until(() => holding)).toBe(true);
    expect((await readOf(x.a))!.owed).toBe(300);
    x.a.beforeWrite = undefined;
    x.a.restart();
    await synced(x.a);
    expect((await x.a.messaging.overview("preprod")).droppedUnread).toBe(300);
    expect((await readOf(x.a))!.owed).toBeUndefined();
    expect(await texts(x.a, cid)).toBeDefined();
  });

  it("(i′) the same, the next worker's first read finding more of A's: only what the stopped worker owed is counted lost", async () => {
    const x = await world();
    await writing(x, () => talking(x.w, x.a, ALICE_SEEDELF));
    await synced(x.a);
    for (let i = 0; i < 300; i++) x.relay.put("preprod", junk(i));
    const claims = claiming((e) => e.endsWith("5a5a5a5a"));
    x.a.restart(claims);
    x.a.passOverOk = true;
    let holding = false;
    x.a.beforeWrite = async (name) => {
      if (name === "messagingTakeMark.preprod" && !holding) {
        holding = true;
        await new Promise(() => undefined);
      }
    };
    await tick(x.a);
    expect(await until(() => holding)).toBe(true);
    x.a.beforeWrite = undefined;
    // 40 more of A's, which the next worker's first read finds and takes.
    for (let i = 300; i < 340; i++) x.relay.put("preprod", junk(i));
    x.a.restart(claims);
    x.a.passOverOk = true;
    await synced(x.a);
    expect((await x.a.messaging.overview("preprod")).droppedUnread).toBe(300);
    expect((await readOf(x.a))!.owed).toBeUndefined();
  });

  it("(j) a lock in a worker that keeps running: each envelope taken once, the reads in memory and in the take record told apart by where they ended", async () => {
    const x = await world();
    const cid = await writing(x, () => talking(x.w, x.a, ALICE_SEEDELF));
    await synced(x.a);
    const record = await recordName(x.a, cid);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let holding = false;
    x.a.beforeWrite = async (name) => {
      if (name === record && !holding) {
        holding = true;
        await held;
      }
    };
    await writing(x, async () => {
      for (let i = 0; i < 3; i++) await x.w.messaging.send("preprod", cid, `once ${i}`);
    });
    await tick(x.a);
    expect(await until(() => holding)).toBe(true);
    expect((await takesOf(x.a))!.batches).toHaveLength(1);
    await x.a.wallet.lock();
    release();
    await x.a.messaging.whenIdle();
    x.a.beforeWrite = undefined;
    // A new unlock: its first window reads the take record back, beside the same read still in memory.
    clock.now += 1000;
    await x.a.wallet.unlock(PASSWORD);
    const from = x.a.log.length;
    await synced(x.a);
    await synced(x.a);
    expect((await texts(x.a, cid)).filter((m) => m.startsWith("in:once "))).toEqual(["in:once 0", "in:once 1", "in:once 2"]);
    // Received at most once each after the unlock: none twice.
    expect(x.a.log.slice(from).filter((e) => e.what === "receive").length).toBeLessThanOrEqual(3);
  });
});

describe("records a development build wrote (O6)", { timeout: 120_000 }, () => {
  it("an inbox holding the requests and a read cursor: the first unlock moves the requests out, and the first read starts from the pool's oldest", async () => {
    const x = await world();
    await strangers(x, 2);
    const requests = (await x.a.store.get<{ requests?: string }>("messagingRequests.preprod"))!.requests!;
    const inbox = (await x.a.store.get<Record<string, unknown>>("messaging.preprod"))!;
    // As a build before round 5 kept them: in the inbox, with its cursor; no read or requests record of their own.
    await x.a.store.set("messaging.preprod", { ...inbox, requests, cursor: "1000005", gapAt: 1 });
    for (const name of ["messagingRequests.preprod", "messagingRead.preprod", "messagingTake.preprod"] as RecordName[]) await x.a.local.remove(PRIVATE_PREFIX + name);
    x.a.restart();
    const shown = (await x.a.messaging.overview("preprod")).requests.map((r) => r.cid).sort();
    const from = x.a.log.length;
    await synced(x.a);
    expect(requestsOf(x.a, from)[0]).toBe("GET /messaging/v1/preprod/envelopes");
    expect((await x.a.store.get<{ requests?: string }>("messagingRequests.preprod"))!.requests).toBe(requests);
    const after = (await x.a.store.get<Record<string, unknown>>("messaging.preprod"))!;
    expect(after.requests).toBeUndefined();
    expect(after.cursor).toBeUndefined();
    expect((await x.a.messaging.overview("preprod")).requests.map((r) => r.cid).sort()).toEqual(shown);
    // And the requests are still the crate's: one can be opened.
    expect(await x.a.messaging.request("preprod", shown[0]!)).toHaveLength(1);
  });
});

describe("the outbox record (round 5, fix item 4.3)", { timeout: 120_000 }, () => {
  it("a stop between a record's write and the inbox's: the message is posted at the first sync, which the outbox record lists", async () => {
    const x = await world();
    const cid = await writing(x, () => talking(x.a, x.w, CAROL_SEEDELF));
    x.answer = () => {
      throw new TypeError("Failed to fetch");
    };
    // The send's inbox write never lands: the worker stops there.
    x.a.beforeWrite = (name) => {
      if (name === "messaging.preprod") throw new Error("the worker stopped");
    };
    await x.a.messaging.send("preprod", cid, "listed in the outbox").catch(() => undefined);
    await x.a.messaging.whenIdle();
    x.a.beforeWrite = undefined;
    x.a.restart();
    x.answer = () => keptNew();
    const from = x.a.log.length;
    await synced(x.a);
    expect(requestsOf(x.a, from).filter((r) => r.startsWith("POST "))).toHaveLength(1);
  });

  it("a stop before the outbox's append: posted at the second sync, after the first window's sweep writes it", async () => {
    const x = await world();
    const cid = await writing(x, () => talking(x.a, x.w, CAROL_SEEDELF));
    x.answer = () => {
      throw new TypeError("Failed to fetch");
    };
    x.a.beforeWrite = (name) => {
      if (name === "messagingOutbox.preprod") throw new Error("the worker stopped");
    };
    await x.a.messaging.send("preprod", cid, "only in its record").catch(() => undefined);
    await x.a.messaging.whenIdle();
    x.a.beforeWrite = undefined;
    x.a.restart();
    x.answer = () => keptNew();
    const first = x.a.log.length;
    await synced(x.a);
    expect(requestsOf(x.a, first).filter((r) => r.startsWith("POST "))).toEqual([]);
    const second = x.a.log.length;
    await synced(x.a);
    expect(requestsOf(x.a, second).filter((r) => r.startsWith("POST "))).toHaveLength(1);
    expect((await fileOf(x.a, cid))!.history.at(-1)!.sent).toBe("posted");
  });
});
