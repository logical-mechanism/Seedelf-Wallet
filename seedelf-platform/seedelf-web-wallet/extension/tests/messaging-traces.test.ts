// What each wallet asks any server, side by side, when the same pages hold
// envelopes for one and none for the other (the 1.10.0 gate's paired relay
// traces, and its finding 8). Every envelope in the pages is sealed to a
// register of wallet A's key: A's scan finds them its own, B's finds none.
// Whatever A then does with them (takes them slowly, can't store them, falls
// behind and drops some, has a Seedelf turned on or removed meanwhile, locks
// or stops mid-take), what each wallet asks the relay or any other server, and
// in which order, must be the same: the relay chooses what pages hold, so any
// difference is the answer to whether that register is A's. Every assertion
// is on order (each tick's requests after its mark), never on a clock.
//
// Two cases differ by design, each said where it is: a trap in a take locks
// the wallet that took the envelope (W9, W13), and a post whose bookkeeping
// waits behind a take step held across ticks (W10's residual: in the wallet
// one envelope's work, which the control case holds to).
//
// One relay, one pool: W (Carol) writes, A (Alice) and B (Bob) read the same
// bytes at the same cursors. What A or B posts during the comparison is
// answered by the test and kept nowhere, so neither changes the other's pages.
// A run writes its traces as JSON where TRACES_OUT names a file.
import { writeFileSync } from "node:fs";

import { afterAll, describe, expect, it } from "vitest";

import { QUOTA_BYTES, RESERVE_BYTES } from "../src/background/messaging";
import { forgetRegisters } from "../src/background/minted-by";
import { PRIVATE_PREFIX, type RecordName } from "../src/background/private-store";
import type { RegisterHex } from "../src/background/chain";
import {
  ALICE_SEEDELF,
  another,
  BOB_SEEDELF,
  CAROL_SEEDELF,
  clock,
  cursorOf,
  type Directory,
  fakeRelay,
  type FakeRelay,
  loadTestWasm,
  party,
  type Party,
  PASSWORD,
  recordName,
  synced,
  takesOf,
  talking,
  texts,
  turnOn,
  turns,
  usedBytes,
  type Wasm,
} from "./messaging-harness";

/** A second Seedelf under each reader's key that this browser didn't make: off until the user turns it on. */
const ALICE2 = "5eed0e1f00" + Buffer.from("alice2").toString("hex");
const BOB2 = "5eed0e1f00" + Buffer.from("bob2").toString("hex");

/** 512 bytes nobody's, at the version the relay takes: the smallest envelope. */
const junk = (n: number) => "01" + n.toString(16).padStart(8, "0") + "5a".repeat(507);

/** What a party asked of any server (the relay's pages and posts, the chain's reads), with the test's own marks, in order. */
const SERVER = /^(GET|POST) |^chain /;
const asked = (p: Party) => p.trace.filter((s) => SERVER.test(s) || s.startsWith("# "));

const turn = () => new Promise<void>((r) => setImmediate(r));
async function until(done: () => boolean, most = 5000): Promise<boolean> {
  for (let i = 0; i < most && !done(); i++) await turn();
  return done();
}

/**
 * The W–A conversation's record, by name: the one write a hold stops in A's take. B never writes it, so the same rule
 * on B holds nothing (B's own posts write B's own records, which no hold may stop).
 */
const ofCid = (x: World) => (name: RecordName) => name === x.record;

const keptNew = () =>
  new Response(JSON.stringify({ kept: "new", expires: Math.floor((clock.now + 36 * 3600_000) / 1000) }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const sizeWait = () =>
  new Response(JSON.stringify({ error: "this address's share of the pool is full for now" }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": "30" },
  });

interface World {
  relay: FakeRelay;
  directory: Directory;
  /** The writer: every envelope it puts in the pool is sealed to a register of A's key. */
  w: Party;
  a: Party;
  b: Party;
  /** W's conversation with A, A's reply read by W: W's messages in it are A's session messages. */
  cid: string;
  /** A's record of it. */
  record: RecordName;
  /** Set while W writes: only W's posts reach the pool. */
  writing: boolean;
  /** What the relay answers A's and B's posts, the nth of them: kept nowhere, so neither changes the other's pages. */
  answer: (n: number) => Response;
  posted: number;
  n: number;
  /** What happened locally beside the requests (a sync that threw, or hadn't ended), kept apart from the traces. */
  notes: { a: string[]; b: string[] };
}

/** W, A and B on one relay, Messages on; W wrote first to A, A replied, W read it; A and B read to the pool's end. */
async function world(): Promise<World> {
  const relay = fakeRelay(clock);
  const directory: Directory = new Map();
  const w = await party(15, relay, directory, CAROL_SEEDELF);
  const a = await party(12, relay, directory, ALICE_SEEDELF);
  const b = await party(24, relay, directory, BOB_SEEDELF);
  await turnOn(w, a, b);
  const cid = await talking(w, a, ALICE_SEEDELF);
  await synced(a);
  await synced(b);
  const record = await recordName(a, cid);
  const x: World = { relay, directory, w, a, b, cid, record, writing: false, answer: () => keptNew(), posted: 0, n: 0, notes: { a: [], b: [] } };
  const real = relay.fetch;
  relay.fetch = async (url, init) => {
    if (init.method === "POST" && !x.writing) return x.answer(++x.posted);
    return real(url, init);
  };
  // One envelope a page: every envelope is a request of its own, so each decides nothing but what the scan sees.
  relay.pageCount = 1;
  expect(await cursorOf(a)).toBeDefined();
  expect(await cursorOf(a)).toBe(await cursorOf(b));
  a.trace.length = 0;
  b.trace.length = 0;
  return x;
}

/** Both readers' second Seedelf, under a register of each one's own key, in each one's kept view; W can write to it. */
async function seconds(x: World): Promise<{ a: RegisterHex; b: RegisterHex }> {
  const a = await another(x.a);
  const b = await another(x.b);
  x.a.own.push({ name: ALICE2, register: a });
  x.b.own.push({ name: BOB2, register: b });
  x.directory.set(ALICE2, a);
  x.directory.set(BOB2, b);
  return { a, b };
}

type Write = "session" | "first" | "other" | "junk";

/**
 * W writes, in order: a message in its conversation with A (`session`), a first message to A's Seedelf (`first`) or to
 * her second one (`other`), or 512 bytes of nobody's (`junk`). Each is in the pool before the next. Returns what was
 * put, hex.
 */
async function writes(x: World, plan: readonly Write[]): Promise<string[]> {
  const held = () => x.relay.pools.get("preprod")!.held;
  const before = held().length;
  x.writing = true;
  try {
    for (const kind of plan) {
      const i = x.n++;
      if (kind === "session") await x.w.messaging.send("preprod", x.cid, `session ${i}`);
      else if (kind === "first") await x.w.messaging.start("preprod", ALICE_SEEDELF, `first ${i}`);
      else if (kind === "other") await x.w.messaging.start("preprod", ALICE2, `to the other ${i}`);
      else x.relay.put("preprod", junk(i));
      await x.w.messaging.whenIdle();
    }
  } finally {
    x.writing = false;
  }
  const put = held()
    .slice(before)
    .map((h) => Buffer.from(h.bytes).toString("hex"));
  expect(put).toHaveLength(plan.length);
  return put;
}

/** A mark in both readers' traces, at the same place in the run. */
function mark(x: World, label: string): void {
  x.a.trace.push(`# ${label}`);
  x.b.trace.push(`# ${label}`);
}

/**
 * One tick of `p`'s alarm (or a page's poll): its sync started, and the event loop turned until that sync ends, at
 * most a bound of turns (a sync that hasn't ended by then is noted: the next tick's joins it, as sync() does).
 */
async function tick(p: Party, label: string, notes: string[]): Promise<void> {
  p.trace.push(`# ${label}`);
  let settled = false;
  p.messaging.sync("preprod").then(
    () => void (settled = true),
    (e: unknown) => {
      settled = true;
      notes.push(`${label}: the sync threw ${e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e)}`);
    },
  );
  if (!(await until(() => settled))) notes.push(`${label}: the sync hadn't ended`);
  await turns(5);
}

/** A tick of each reader, A first, each waiting for its own take where `idle` says. */
async function ticks(x: World, label: string, idle: { a: boolean; b: boolean } = { a: true, b: true }): Promise<void> {
  await tick(x.a, label, x.notes.a);
  if (idle.a) await x.a.messaging.whenIdle();
  await tick(x.b, label, x.notes.b);
  if (idle.b) await x.b.messaging.whenIdle();
}

interface Hold {
  holding: boolean;
  release(): void;
}

/** Holds `p`'s first write of a record `which` picks, from now, until released: one envelope's take that spans ticks. */
function holdFirst(p: Party, which: (name: RecordName) => boolean): Hold {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const hold: Hold = { holding: false, release: () => release() };
  let armed = true;
  p.beforeWrite = async (name) => {
    if (!armed || !which(name)) return;
    armed = false;
    hold.holding = true;
    await held;
  };
  return hold;
}

/** chrome.storage.local refusing `p`'s first write of a key `which` picks, from now, once, as at its quota. */
function refuseWriteOnce(p: Party, which: (key: string) => boolean): { fired: boolean } {
  const state = { fired: false };
  const set = p.local.set.bind(p.local);
  p.local.set = async (key, value) => {
    if (!state.fired && which(key)) {
      state.fired = true;
      throw new Error("QUOTA_BYTES quota exceeded");
    }
    return set(key, value);
  };
  return state;
}

/** chrome.storage.local failing `p`'s first read of a key `which` picks, from now, once: an ordinary I/O error. */
function failReadOnce(p: Party, which: (key: string) => boolean): { fired: boolean } {
  const state = { fired: false };
  const get = p.local.get.bind(p.local);
  p.local.get = async <T>(key: string) => {
    if (!state.fired && which(key)) {
      state.fired = true;
      throw new Error("IO error: the read failed");
    }
    return get<T>(key);
  };
  return state;
}

/** Fills `p`'s area with another record of the wallet's until exactly the reserve is left: any growth is refused (W11). */
function atReserve(p: Party): void {
  const key = "seedelf.other.filler";
  const room = QUOTA_BYTES - RESERVE_BYTES - usedBytes(p);
  p.local.data.set(key, JSON.stringify("x".repeat(room - key.length - 2)));
  expect(usedBytes(p)).toBe(QUOTA_BYTES - RESERVE_BYTES);
}

/** chrome.storage.local as Chrome answers it, over IPC: each call answered at a later turn of the event loop. */
function chromeLatency(p: Party): void {
  const area = p.local as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  for (const method of ["get", "set", "remove", "keys"]) {
    const real = area[method]!.bind(p.local);
    area[method] = async (...args: unknown[]) => {
      await turn();
      return real(...args);
    };
  }
}

interface Result {
  case: string;
  identical: boolean;
  difference?: string;
  a: string[];
  b: string[];
  notes: { a: string[]; b: string[] };
  facts: Record<string, unknown>;
}
const results: Result[] = [];

/** The two readers' traces side by side: identical or not, and where they first part. */
function paired(name: string, x: World, facts: Record<string, unknown> = {}): Result {
  const a = asked(x.a);
  const b = asked(x.b);
  let at = 0;
  while (at < a.length && at < b.length && a[at] === b[at]) at++;
  const identical = at === a.length && at === b.length;
  const where = [...a.slice(0, at)].reverse().find((s) => s.startsWith("# ")) ?? "# (the start)";
  const result: Result = {
    case: name,
    identical,
    ...(identical
      ? {}
      : { difference: `from entry ${at}, under "${where.slice(2)}": A ${JSON.stringify(a.slice(at, at + 4))}; B ${JSON.stringify(b.slice(at, at + 4))}` }),
    a,
    b,
    notes: x.notes,
    facts,
  };
  results.push(result);
  console.log(`[traces] ${name}: ${identical ? "IDENTICAL" : `DIFFERENT ${result.difference}`}`);
  return result;
}

afterAll(() => {
  const out = process.env.TRACES_OUT;
  if (out) writeFileSync(out, JSON.stringify(results, null, 1));
});

const requestsOf = async (p: Party) => (await p.messaging.overview("preprod")).requests.length;
const sessionsIn = async (p: Party, cid: string) => (await texts(p, cid)).filter((m) => m.startsWith("in:session"));

describe("what two wallets ask when the same pages hold one's envelopes and none of the other's (paired traces)", { timeout: 180_000 }, () => {
  it("the happy path: W's first messages, session messages and junk, past one read's 16 pages, with a post of each wallet's own", async () => {
    const x = await world();
    // Each reader has a first message of its own to W's Seedelf waiting to be posted: its first try didn't reach the relay.
    x.answer = () => {
      throw new TypeError("Failed to fetch");
    };
    for (const p of [x.a, x.b]) {
      await p.messaging.start("preprod", CAROL_SEEDELF, "waiting to go");
      await p.messaging.whenIdle();
      p.trace.length = 0;
    }
    x.answer = () => keptNew();
    const plans: Write[][] = [
      ["first", "session", "junk", "session"],
      ["junk", "first"],
      [],
      // 20: more than one read's PAGES_A_SYNC pages of one envelope each.
      [...Array<Write>(4).fill("session"), ...Array<Write>(13).fill("junk"), "first", "first", "session"],
      [],
    ];
    for (const [k, plan] of plans.entries()) {
      await writes(x, plan);
      await ticks(x, `tick ${k + 1}`);
    }
    const facts = {
      aRequests: await requestsOf(x.a),
      bRequests: await requestsOf(x.b),
      aSessions: (await sessionsIn(x.a, x.cid)).length,
      aPosts: asked(x.a).filter((s) => s.startsWith("POST ")).length,
      bPosts: asked(x.b).filter((s) => s.startsWith("POST ")).length,
      cursors: [await cursorOf(x.a), await cursorOf(x.b)],
    };
    // A took every one of W's; B none; each posted its own once.
    expect(facts).toMatchObject({ aRequests: 4, bRequests: 0, aSessions: 7, aPosts: 1, bPosts: 1 });
    expect(facts.cursors[0]).toBe(facts.cursors[1]);
    const r = paired("happy path", x, facts);
    expect(r.a).toEqual(r.b);
  });

  it("a slow take: A's take of its first envelope held at its record's write across three ticks", async () => {
    const x = await world();
    const holdA = holdFirst(x.a, ofCid(x));
    const holdB = holdFirst(x.b, ofCid(x));
    await writes(x, ["session", "first"]);
    await tick(x.a, "tick 1", x.notes.a);
    expect(await until(() => holdA.holding)).toBe(true);
    await tick(x.b, "tick 1", x.notes.b);
    await x.b.messaging.whenIdle();
    const cursorsHeld = [await cursorOf(x.a), await cursorOf(x.b)];
    for (const [k, plan] of ([["session", "junk"], ["first"], ["session"]] as Write[][]).entries()) {
      await writes(x, plan);
      await ticks(x, `tick ${k + 2}`, { a: false, b: true });
    }
    expect(holdB.holding).toBe(false);
    mark(x, "release");
    holdA.release();
    await x.a.messaging.whenIdle();
    await x.b.messaging.whenIdle();
    await ticks(x, "tick 5");
    const facts = {
      durableCursorsWhileHeld: cursorsHeld,
      aSessions: await sessionsIn(x.a, x.cid),
      aRequests: await requestsOf(x.a),
      cursors: [await cursorOf(x.a), await cursorOf(x.b)],
    };
    expect(facts.aSessions).toHaveLength(3);
    expect(facts.aRequests).toBe(2);
    expect(facts.cursors[0]).toBe(facts.cursors[1]);
    const r = paired("slow take", x, facts);
    expect(r.a).toEqual(r.b);
  });

  it("a slow take while a post of each wallet's own comes due: the post's bookkeeping waits in the queue behind A's take", async () => {
    const x = await world();
    x.answer = () => {
      throw new TypeError("Failed to fetch");
    };
    for (const p of [x.a, x.b]) {
      await p.messaging.start("preprod", CAROL_SEEDELF, "waiting to go");
      await p.messaging.whenIdle();
      p.trace.length = 0;
    }
    const holdA = holdFirst(x.a, ofCid(x));
    holdFirst(x.b, ofCid(x));
    // Tick 1: the relay asks this size to wait 30 s (§17.4's per-size wait), so the post comes due at tick 2.
    x.answer = () => sizeWait();
    await writes(x, ["session"]);
    await tick(x.a, "tick 1", x.notes.a);
    expect(await until(() => holdA.holding)).toBe(true);
    await tick(x.b, "tick 1", x.notes.b);
    await x.b.messaging.whenIdle();
    clock.now += 31_000;
    await x.a.wallet.touch();
    await x.b.wallet.touch();
    x.answer = () => keptNew();
    for (const k of [2, 3]) {
      await writes(x, ["junk"]);
      await ticks(x, `tick ${k}`, { a: false, b: true });
    }
    mark(x, "release");
    holdA.release();
    await x.a.messaging.whenIdle();
    await x.b.messaging.whenIdle();
    await ticks(x, "tick 4");
    const r = paired("slow take, a post due", x, { cursors: [await cursorOf(x.a), await cursorOf(x.b)] });
    // Different by design: W10's residual (the 1.10.0 gate's f9, words only). A's post at tick 2 goes as B's does, and
    // its bookkeeping (marking it posted) waits in the queue behind A's take step, held here across ticks; so A's tick-2
    // sync ends only as that step does, and its tick 3 joins it. In the wallet a take step is one envelope's work: the
    // control below, a take slow at every step, is identical. The requests are the same ones, in the same order: A's
    // posts are B's, and A's pages B's, one tick late.
    const gets = (t: string[]) => t.filter((s) => s.startsWith("GET "));
    const posts = (t: string[]) => t.filter((s) => s.startsWith("POST "));
    expect(posts(r.a)).toEqual(posts(r.b));
    expect(gets(r.a)).toEqual(gets(r.b).slice(0, gets(r.a).length));
    expect(gets(r.b).length - gets(r.a).length).toBe(1);
  });

  it("control: a slow take of many short receives while a post comes due (each of A's record writes 40 turns late)", async () => {
    const x = await world();
    x.answer = () => {
      throw new TypeError("Failed to fetch");
    };
    for (const p of [x.a, x.b]) {
      await p.messaging.start("preprod", CAROL_SEEDELF, "waiting to go");
      await p.messaging.whenIdle();
      p.trace.length = 0;
    }
    // Every write of the W–A record takes 40 turns of the event loop: a take that is slow throughout, never held.
    let slowWrites = 0;
    for (const p of [x.a, x.b]) {
      p.beforeWrite = async (name) => {
        if (name !== x.record) return;
        slowWrites++;
        for (let i = 0; i < 40; i++) await turn();
      };
    }
    x.answer = () => sizeWait();
    await writes(x, Array<Write>(24).fill("session"));
    await ticks(x, "tick 1", { a: false, b: true });
    clock.now += 31_000;
    await x.a.wallet.touch();
    await x.b.wallet.touch();
    x.answer = () => keptNew();
    const writesAtTick: number[] = [];
    for (const k of [2, 3]) {
      await writes(x, ["junk"]);
      writesAtTick.push(slowWrites);
      await ticks(x, `tick ${k}`, { a: false, b: true });
    }
    await x.a.messaging.whenIdle();
    await ticks(x, "tick 4");
    const facts = {
      slowWrites,
      // The record writes A's take had begun as ticks 2 and 3 began: fewer than tick 1's 16 is a take still under way.
      slowWritesAsTicks2And3Began: writesAtTick,
      aSessions: (await sessionsIn(x.a, x.cid)).length,
      cursors: [await cursorOf(x.a), await cursorOf(x.b)],
    };
    expect(facts.aSessions).toBe(24);
    expect(writesAtTick[0]).toBeLessThan(16);
    const r = paired("control: slow take of short receives, a post due", x, facts);
    expect(r.a).toEqual(r.b);
  });

  it("a lock while A's take is under way: the first read after the unlock", async () => {
    const x = await world();
    const holdA = holdFirst(x.a, ofCid(x));
    holdFirst(x.b, ofCid(x));
    await writes(x, ["session", "first"]);
    await tick(x.a, "tick 1", x.notes.a);
    expect(await until(() => holdA.holding)).toBe(true);
    await tick(x.b, "tick 1", x.notes.b);
    await x.b.messaging.whenIdle();
    const durable = [await cursorOf(x.a), await cursorOf(x.b)];
    // The wallet locks (its timer, or the user) while the take is between two writes; then the user unlocks.
    mark(x, "lock");
    await x.a.wallet.lock();
    await x.b.wallet.lock();
    holdA.release();
    await x.a.messaging.whenIdle();
    await x.b.messaging.whenIdle();
    mark(x, "unlock");
    await x.a.wallet.unlock(PASSWORD);
    await x.b.wallet.unlock(PASSWORD);
    await writes(x, ["junk"]);
    await ticks(x, "tick 2");
    await ticks(x, "tick 3");
    const facts = {
      durableCursorsBeforeTheLock: durable,
      aSessions: (await sessionsIn(x.a, x.cid)).length,
      aRequests: await requestsOf(x.a),
      cursors: [await cursorOf(x.a), await cursorOf(x.b)],
    };
    // The read's end was written before the take began (finding 8): the same for both, before the lock as after it.
    expect(durable[0]).toBe(durable[1]);
    // What A's take hadn't taken when it locked, the session message and the first message, taken from the take record
    // after the unlock: no page asked for them again (the traces below are B's).
    expect(facts).toMatchObject({ aSessions: 1, aRequests: 1 });
    expect(await takesOf(x.a)).toMatchObject({ batches: [] });
    const r = paired("a lock mid-take", x, facts);
    expect(r.a).toEqual(r.b);
  });

  it("a lock after reads made while A's take was held: each read's end was written as it ended, behind no take step (finding 8)", async () => {
    const x = await world();
    const holdA = holdFirst(x.a, ofCid(x));
    holdFirst(x.b, ofCid(x));
    await writes(x, ["session", "first"]);
    await tick(x.a, "tick 1", x.notes.a);
    expect(await until(() => holdA.holding)).toBe(true);
    await tick(x.b, "tick 1", x.notes.b);
    await x.b.messaging.whenIdle();
    // Two more reads while A's take is held: each finds one of A's.
    for (const [k, plan] of ([["session"], ["first"]] as Write[][]).entries()) {
      await writes(x, plan);
      await ticks(x, `tick ${k + 2}`, { a: false, b: true });
    }
    const durable = [await cursorOf(x.a), await cursorOf(x.b)];
    mark(x, "lock");
    await x.a.wallet.lock();
    await x.b.wallet.lock();
    holdA.release();
    await x.a.messaging.whenIdle();
    await x.b.messaging.whenIdle();
    mark(x, "unlock");
    await x.a.wallet.unlock(PASSWORD);
    await x.b.wallet.unlock(PASSWORD);
    await writes(x, ["junk"]);
    await ticks(x, "tick 4");
    await ticks(x, "tick 5");
    const facts = {
      durableCursorsAtTheLock: durable,
      aSessions: (await sessionsIn(x.a, x.cid)).length,
      aRequests: await requestsOf(x.a),
      cursors: [await cursorOf(x.a), await cursorOf(x.b)],
    };
    expect(durable[0]).toBe(durable[1]);
    // All four of W's taken after the unlock, from the take record.
    expect(facts).toMatchObject({ aSessions: 2, aRequests: 2 });
    const r = paired("a lock after reads made while the take was held", x, facts);
    expect(r.a).toEqual(r.b);
  });

  it("the worker stopped while A's take is under way (a browser closed, Chrome's own stop): the first read of the next worker", async () => {
    const x = await world();
    const holdA = holdFirst(x.a, ofCid(x));
    holdFirst(x.b, ofCid(x));
    await writes(x, ["session", "first"]);
    await tick(x.a, "tick 1", x.notes.a);
    expect(await until(() => holdA.holding)).toBe(true);
    await tick(x.b, "tick 1", x.notes.b);
    await x.b.messaging.whenIdle();
    const durable = [await cursorOf(x.a), await cursorOf(x.b)];
    // Both workers stop; A's take, held, never resumes (the old worker is gone). New workers over the same storage.
    mark(x, "worker stopped");
    x.a.restart();
    x.b.restart();
    await writes(x, ["junk"]);
    await ticks(x, "tick 2");
    await ticks(x, "tick 3");
    const facts = {
      durableCursorsAtTheStop: durable,
      aSessions: (await sessionsIn(x.a, x.cid)).length,
      aRequests: await requestsOf(x.a),
      cursors: [await cursorOf(x.a), await cursorOf(x.b)],
    };
    expect(durable[0]).toBe(durable[1]);
    // The new worker takes what the old one hadn't, from the take record, asking no page for it again.
    expect(facts).toMatchObject({ aSessions: 1, aRequests: 1 });
    expect(await takesOf(x.a)).toMatchObject({ batches: [] });
    const r = paired("a worker stop mid-take", x, facts);
    expect(r.a).toEqual(r.b);
  });

  it("a storage failure in the take: a conversation's record write refused once", async () => {
    const x = await world();
    const refusedA = refuseWriteOnce(x.a, (k) => k.startsWith(PRIVATE_PREFIX + "conversation."));
    const refusedB = refuseWriteOnce(x.b, (k) => k.startsWith(PRIVATE_PREFIX + "conversation."));
    await writes(x, ["session", "first", "session"]);
    await ticks(x, "tick 1");
    await writes(x, ["session"]);
    await ticks(x, "tick 2");
    const facts = {
      refused: [refusedA.fired, refusedB.fired],
      aDropped: (await x.a.messaging.overview("preprod")).dropped,
      aSessions: await sessionsIn(x.a, x.cid),
      aRequests: await requestsOf(x.a),
    };
    expect(facts.refused).toEqual([true, false]);
    const r = paired("conversation write refused once", x, facts);
    expect(r.a).toEqual(r.b);
  });

  it("a storage failure in the take: the inbox's write refused once (A's after a record's write; B, whose cursor is the take record's, writes none)", async () => {
    const x = await world();
    const refusedA = refuseWriteOnce(x.a, (k) => k === PRIVATE_PREFIX + "messaging.preprod");
    const refusedB = refuseWriteOnce(x.b, (k) => k === PRIVATE_PREFIX + "messaging.preprod");
    await writes(x, ["session", "first"]);
    await ticks(x, "tick 1");
    const full = [(await x.a.messaging.overview("preprod")).full, (await x.b.messaging.overview("preprod")).full];
    await writes(x, ["junk"]);
    await ticks(x, "tick 2");
    await writes(x, ["session"]);
    await ticks(x, "tick 3");
    const conversation = (await x.a.messaging.overview("preprod")).conversations.find((c) => c.cid === x.cid);
    const facts = {
      refused: [refusedA.fired, refusedB.fired],
      fullAfterTick1: full,
      aUnreadBeforeOpening: conversation?.unread,
      aSessions: await sessionsIn(x.a, x.cid),
      aRequests: await requestsOf(x.a),
      cursors: [await cursorOf(x.a), await cursorOf(x.b)],
    };
    // B's inbox is never written by a read of none of its envelopes: its cursor is in the take record (finding 8).
    expect(facts.refused).toEqual([true, false]);
    const r = paired("inbox write refused once", x, facts);
    expect(r.a).toEqual(r.b);
  });

  it("a storage failure in the take: the area's reserve reached, any growth refused", async () => {
    const x = await world();
    atReserve(x.a);
    atReserve(x.b);
    await writes(x, ["first", "session", "first", "session"]);
    await ticks(x, "tick 1");
    await writes(x, ["session", "first"]);
    await ticks(x, "tick 2");
    await writes(x, ["junk"]);
    await ticks(x, "tick 3");
    const [oa, ob] = [await x.a.messaging.overview("preprod"), await x.b.messaging.overview("preprod")];
    const facts = {
      a: { full: oa.full, dropped: oa.dropped, requests: oa.requests.length },
      b: { full: ob.full, dropped: ob.dropped, requests: ob.requests.length },
      cursors: [await cursorOf(x.a), await cursorOf(x.b)],
    };
    const r = paired("area's reserve reached", x, facts);
    expect(r.a).toEqual(r.b);
  });

  it("a storage failure in the take: a conversation's record read failing once (the review's finding 2)", async () => {
    const x = await world();
    const failedA = failReadOnce(x.a, (k) => k.startsWith(PRIVATE_PREFIX + "conversation."));
    const failedB = failReadOnce(x.b, (k) => k.startsWith(PRIVATE_PREFIX + "conversation."));
    await writes(x, ["session", "session"]);
    await ticks(x, "tick 1");
    await writes(x, ["junk"]);
    await ticks(x, "tick 2");
    const facts = {
      failed: [failedA.fired, failedB.fired],
      aDropped: (await x.a.messaging.overview("preprod")).dropped,
      aSessions: await sessionsIn(x.a, x.cid),
    };
    expect(facts.failed).toEqual([true, false]);
    const r = paired("conversation read failing once", x, facts);
    expect(r.a).toEqual(r.b);
  });

  it("backlog eviction: A's take held while six more reads find her envelopes, the two oldest waiting dropped", async () => {
    const x = await world();
    const holdA = holdFirst(x.a, ofCid(x));
    holdFirst(x.b, ofCid(x));
    await writes(x, ["session"]);
    await tick(x.a, "tick 1", x.notes.a);
    expect(await until(() => holdA.holding)).toBe(true);
    await tick(x.b, "tick 1", x.notes.b);
    await x.b.messaging.whenIdle();
    for (let k = 2; k <= 7; k++) {
      await writes(x, ["first"]);
      await ticks(x, `tick ${k}`, { a: false, b: true });
    }
    mark(x, "release");
    holdA.release();
    await x.a.messaging.whenIdle();
    await x.b.messaging.whenIdle();
    await ticks(x, "tick 8");
    const facts = {
      aDropped: (await x.a.messaging.overview("preprod")).droppedUnread,
      aRequests: await requestsOf(x.a),
      cursors: [await cursorOf(x.a), await cursorOf(x.b)],
    };
    // The reads of ticks 2 and 3 waited past four and went, a first message each, counted unopened (f5).
    expect(facts.aDropped).toBe(2);
    expect(facts.aRequests).toBe(4);
    const r = paired("backlog eviction", x, facts);
    expect(r.a).toEqual(r.b);
  });

  it("a Seedelf turned on while both are idle: the pool read again from its oldest", async () => {
    const x = await world();
    const second = await seconds(x);
    await writes(x, ["other"]);
    await ticks(x, "tick 1");
    expect(await requestsOf(x.a)).toBe(0);
    await writes(x, ["session"]);
    await ticks(x, "tick 2");
    mark(x, "turn on");
    await x.a.messaging.answerAt("preprod", ALICE2, second.a, true);
    await x.b.messaging.answerAt("preprod", BOB2, second.b, true);
    await x.a.messaging.whenIdle();
    await x.b.messaging.whenIdle();
    const afterPress = [await cursorOf(x.a), await cursorOf(x.b)];
    await ticks(x, "tick 3");
    await ticks(x, "tick 4");
    const facts = { cursorsAfterPress: afterPress, aRequests: await requestsOf(x.a), cursors: [await cursorOf(x.a), await cursorOf(x.b)] };
    // The first message to the second Seedelf, from before it was on, taken at the read from the oldest.
    expect(facts.aRequests).toBe(1);
    const r = paired("Seedelf turned on, idle", x, facts);
    expect(r.a).toEqual(r.b);
  });

  for (const latency of [false, true]) {
    it(`a Seedelf turned on while A's take of its last envelope runs (${latency ? "chrome.storage answering a turn later, as over IPC" : "the harness's storage, answering at once"})`, async () => {
      const x = await world();
      const second = await seconds(x);
      await writes(x, ["other"]);
      await ticks(x, "tick 1");
      if (latency) {
        chromeLatency(x.a);
        chromeLatency(x.b);
      }
      const holdA = holdFirst(x.a, ofCid(x));
      holdFirst(x.b, ofCid(x));
      await writes(x, ["session"]);
      await tick(x.a, "tick 2", x.notes.a);
      expect(await until(() => holdA.holding)).toBe(true);
      await tick(x.b, "tick 2", x.notes.b);
      await x.b.messaging.whenIdle();
      // The press comes while A's take of the read's last envelope is under way: in the queue behind it. B has nothing
      // under way: its take of a read with none of its envelopes ended with the read.
      mark(x, "turn on");
      const pressA = x.a.messaging.answerAt("preprod", ALICE2, second.a, true);
      await x.b.messaging.answerAt("preprod", BOB2, second.b, true);
      await turns(5);
      mark(x, "release");
      holdA.release();
      await pressA;
      await x.a.messaging.whenIdle();
      await x.b.messaging.whenIdle();
      const afterPress = [await cursorOf(x.a), await cursorOf(x.b)];
      await ticks(x, "tick 3");
      await ticks(x, "tick 4");
      const facts = {
        cursorsAfterPress: afterPress,
        aRequests: await requestsOf(x.a),
        aSessions: (await sessionsIn(x.a, x.cid)).length,
        cursors: [await cursorOf(x.a), await cursorOf(x.b)],
      };
      const r = paired(`Seedelf turned on during A's last take${latency ? ", IPC latency" : ""}`, x, facts);
      expect(r.a).toEqual(r.b);
    });
  }

  it("a removal: each wallet's own Seedelf removed (its pair forgotten as submitRemove does), the kept view still showing it, then not", async () => {
    const x = await world();
    mark(x, "remove");
    await forgetRegisters(x.a.store, "preprod", ALICE_SEEDELF);
    await forgetRegisters(x.b.store, "preprod", BOB_SEEDELF);
    await writes(x, ["first", "session"]);
    await ticks(x, "tick 1");
    const requestsStale = await requestsOf(x.a);
    mark(x, "a view without it");
    x.a.own = x.a.own.filter((s) => s.name !== ALICE_SEEDELF);
    x.b.own = x.b.own.filter((s) => s.name !== BOB_SEEDELF);
    await writes(x, ["first"]);
    await ticks(x, "tick 2");
    const facts = { aRequestsWithTheStaleView: requestsStale, aRequests: await requestsOf(x.a), aSessions: (await sessionsIn(x.a, x.cid)).length };
    expect(facts.aRequests).toBe(0);
    const r = paired("removal", x, facts);
    expect(r.a).toEqual(r.b);
  });

  it("a removal after the user turned the Seedelf on by hand (the review's finding 6): first messages still taken, asking nothing", async () => {
    const x = await world();
    const regA = x.a.own.find((s) => s.name === ALICE_SEEDELF)!.register;
    const regB = x.b.own.find((s) => s.name === BOB_SEEDELF)!.register;
    mark(x, "turn on by hand");
    await x.a.messaging.answerAt("preprod", ALICE_SEEDELF, regA, true);
    await x.b.messaging.answerAt("preprod", BOB_SEEDELF, regB, true);
    mark(x, "remove");
    await forgetRegisters(x.a.store, "preprod", ALICE_SEEDELF);
    await forgetRegisters(x.b.store, "preprod", BOB_SEEDELF);
    await writes(x, ["first"]);
    await ticks(x, "tick 1");
    const facts = { aRequestsAfterTheRemoval: await requestsOf(x.a) };
    const r = paired("removal after an explicit on", x, facts);
    expect(r.a).toEqual(r.b);
  });

  it("a trap in a scan: an envelope of A's whose bytes trap any scan holding it, both wallets' alike", async () => {
    const x = await world();
    const put = await writes(x, ["first", "session", "first"]);
    const bad = put[1]!;
    const wasm = loadTestWasm();
    const trapping: Wasm = {
      ...wasm,
      messagingScan: (key, envelopes) => {
        if ((JSON.parse(envelopes) as string[]).includes(bad)) throw new WebAssembly.RuntimeError("unreachable");
        return wasm.messagingScan(key, envelopes);
      },
    };
    x.a.restart(trapping);
    x.b.restart(trapping);
    await ticks(x, "tick 1");
    const locked = [await x.a.wallet.state(), await x.b.wallet.state()];
    mark(x, "unlock");
    for (const p of [x.a, x.b]) {
      await p.wallet.unlock(PASSWORD);
      p.restart(trapping);
    }
    await ticks(x, "tick 2");
    for (const press of [1, 2]) {
      mark(x, `try again ${press}`);
      for (const p of [x.a, x.b]) {
        await p.messaging.retry("preprod").catch(() => undefined);
        await p.messaging.whenIdle();
      }
      mark(x, `unlock ${press}`);
      for (const p of [x.a, x.b]) {
        if ((await p.wallet.state()) === "locked") await p.wallet.unlock(PASSWORD);
        p.restart(trapping);
      }
    }
    await ticks(x, "tick 3");
    const facts = { lockedAfterTick1: locked, aRequests: await requestsOf(x.a), states: [await x.a.wallet.state(), await x.b.wallet.state()] };
    expect(locked).toEqual(["locked", "locked"]);
    expect(facts.aRequests).toBe(2);
    const r = paired("trap in a scan", x, facts);
    expect(r.a).toEqual(r.b);
  });

  it("a trap in a take: an envelope of A's whose receive traps (only A takes it)", async () => {
    const x = await world();
    const put = await writes(x, ["session", "first"]);
    const bad = put[0]!;
    const wasm = loadTestWasm();
    const trapping: Wasm = {
      ...wasm,
      messagingReceive: (key, request) => {
        if ((JSON.parse(request) as { envelope: string }).envelope === bad) throw new WebAssembly.RuntimeError("unreachable");
        return wasm.messagingReceive(key, request);
      },
    };
    x.a.restart(trapping);
    x.b.restart(trapping);
    await ticks(x, "tick 1");
    const states = [await x.a.wallet.state(), await x.b.wallet.state()];
    await writes(x, ["junk"]);
    await ticks(x, "tick 2");
    // The user unlocks the wallet that locked itself; the other never locked.
    mark(x, "unlock");
    if ((await x.a.wallet.state()) === "locked") await x.a.wallet.unlock(PASSWORD);
    if ((await x.b.wallet.state()) === "locked") await x.b.wallet.unlock(PASSWORD);
    await writes(x, ["junk"]);
    await ticks(x, "tick 3");
    // Try again, which only the stopped wallet's page offers.
    mark(x, "try again");
    for (const p of [x.a, x.b]) {
      if ((await p.messaging.overview("preprod")).stopped) {
        await p.messaging.retry("preprod");
        await p.messaging.whenIdle();
      }
    }
    await ticks(x, "tick 4");
    const facts = {
      statesAfterTick1: states,
      aRequests: await requestsOf(x.a),
      aSessions: (await sessionsIn(x.a, x.cid)).length,
      cursors: [await cursorOf(x.a), await cursorOf(x.b)],
    };
    expect(states).toEqual(["locked", "unlocked"]);
    const r = paired("trap in a take", x, facts);
    // Different by design (W9, W13): WebAssembly that traps locks the wallet that ran it, here only A, which took the
    // envelope, and A's Messages read nothing by themselves until Try again. Then A reads on from where its last read
    // ended, never that read's pages again (finding 8), and the take goes on from the take record past the envelope that
    // trapped: the same pages as B's, in the same order, A's later. A trap anyone can cause would be high anyway.
    const gets = (t: string[]) => t.filter((s) => s.startsWith("GET "));
    expect(gets(r.a)).toEqual(gets(r.b));
    const tryAgain = r.a.indexOf("# try again");
    expect(r.a.slice(r.a.indexOf("# tick 2"), tryAgain).filter((s) => s.startsWith("GET "))).toEqual([]);
    expect(facts.cursors[0]).toBe(facts.cursors[1]);
    // The first message taken; the session message that trapped stepped over.
    expect(facts).toMatchObject({ aRequests: 1, aSessions: 0 });
  });

  it("W10's 40 pages, every envelope the wallet's or none, a lock in the first read's take: the same pages, the same cursors (finding 8)", async () => {
    /** A 32 KiB envelope nobody's: eight fill a page. */
    const bigJunk = (n: number) => "01" + n.toString(16).padStart(8, "0") + "6b".repeat(32768 - 5);
    const served = async (own: boolean) => {
      const relay = fakeRelay(clock);
      const reader = await party(24, relay, new Map(), BOB_SEEDELF);
      await turnOn(reader);
      for (let i = 0; i < 40 * 8; i++) relay.put("preprod", bigJunk(i));
      // The scan finds every envelope the reader's, or none of them: what a relay that seals pages to a register gets.
      const wasm = loadTestWasm();
      reader.restart({
        ...wasm,
        messagingScan: (key, envelopes) => (own ? "1".repeat((JSON.parse(envelopes) as string[]).length) : wasm.messagingScan(key, envelopes)),
      });
      relay.calls.length = 0;
      const asked: string[][] = [];
      const cursors: Array<string | undefined> = [];
      let openedAtLock = 0;
      for (let sync = 0; sync < 4; sync++) {
        const before = relay.calls.length;
        await reader.messaging.sync("preprod");
        if (sync === 0) {
          // The lock comes as the first read's take has begun: the read and the posts are done, the take isn't.
          openedAtLock = reader.trace.filter((s) => s === "open").length;
          await reader.wallet.lock();
          await reader.messaging.whenIdle();
          await reader.wallet.unlock(PASSWORD);
        }
        await reader.messaging.whenIdle();
        asked.push(relay.calls.slice(before).filter((c) => c.startsWith("GET ")));
        cursors.push(await cursorOf(reader));
      }
      return { asked, cursors, openedAtLock, opened: reader.trace.filter((s) => s === "open").length, takes: await takesOf(reader) };
    };
    const holder = await served(true);
    const bystander = await served(false);
    // The holder's take was under way at the lock, and was finished from the take record after it.
    expect(holder.opened).toBeGreaterThan(holder.openedAtLock);
    expect(holder.takes?.batches).toEqual([]);
    expect(bystander.opened).toBe(0);
    // The same pages, and the same cursors, sync by sync.
    expect(holder.asked).toEqual(bystander.asked);
    expect(holder.cursors).toEqual(bystander.cursors);
    expect(holder.asked.map((pages) => pages.length)).toEqual([16, 16, 8, 1]);
  });
});
