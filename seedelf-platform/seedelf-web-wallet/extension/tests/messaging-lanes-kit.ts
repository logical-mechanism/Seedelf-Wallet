// What the lane tests share (the 1.10.0 gate's round 5): paired worlds on one
// relay, where W writes and A and B read the same pages at the same cursors,
// and the windows of each wallet's lanes in its timeline (`Party.log`). A lane
// is every run of a wallet's requests to the relay; in one, the wallet may
// touch only records whose size no envelope sets.
import { expect } from "vitest";

import { storedBytes } from "../src/background/messaging";
import {
  ALICE_SEEDELF,
  BOB_SEEDELF,
  CAROL_SEEDELF,
  clock,
  type Directory,
  fakeRelay,
  type FakeRelay,
  type LogEntry,
  loadTestWasm,
  party,
  type Party,
  type ServiceOptions,
  synced,
  turnOn,
  turns,
  type Wasm,
} from "./messaging-harness";

/** The records a lane may touch, on either network: the read record, the scan's mark, the user's own outbox. */
export const LANE_RECORDS = new Set(
  ["preprod", "mainnet"].flatMap((n) => [`messagingRead.${n}`, `messagingMark.${n}`, `messagingOutbox.${n}`]),
);

/** A sealed record's smallest stored size: its 1 KiB pad. */
export const PAD = storedBytes(0);

/** 512 bytes nobody's, at the version the relay takes: the smallest envelope. */
export const junk = (n: number) => "01" + n.toString(16).padStart(8, "0") + "5a".repeat(507);

export const keptNew = () =>
  new Response(JSON.stringify({ kept: "new", expires: Math.floor((clock.now + 36 * 3600_000) / 1000) }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

export interface World {
  relay: FakeRelay;
  directory: Directory;
  /** The writer: every envelope it puts in the pool is sealed to a register of A's key, or nobody's. */
  w: Party;
  a: Party;
  b: Party;
  /** Set while W writes: only W's posts reach the pool. A's and B's are answered by `answer` and kept nowhere. */
  writing: boolean;
  answer: (n: number) => Response;
  posted: number;
  /** The longest text a first message to A's Seedelf carries. */
  maxText: number;
}

/** W, A and B on one relay, Messages on; A's and B's posts answered by the test, so neither changes the other's pages. */
export async function world(options: ServiceOptions = {}): Promise<World> {
  const relay = fakeRelay(clock);
  const directory: Directory = new Map();
  const w = await party(15, relay, directory, CAROL_SEEDELF);
  const a = await party(12, relay, directory, ALICE_SEEDELF, options);
  const b = await party(24, relay, directory, BOB_SEEDELF, options);
  await turnOn(w, a, b);
  const x: World = { relay, directory, w, a, b, writing: false, answer: () => keptNew(), posted: 0, maxText: 0 };
  const real = relay.fetch;
  relay.fetch = async (url, init) => (init.method === "POST" && !x.writing ? x.answer(++x.posted) : real(url, init));
  try {
    await w.messaging.start("preprod", ALICE_SEEDELF, "x".repeat(70_000));
  } catch (e) {
    const m = /at most ([\d,]+) bytes/.exec((e as Error).message);
    if (!m) throw e;
    x.maxText = Number(m[1]!.replace(/,/g, ""));
  }
  return x;
}

/** W writes, posting for real into the pool: `run`'s sends and starts. */
export async function writing<T>(x: World, run: () => Promise<T>): Promise<T> {
  x.writing = true;
  try {
    const out = await run();
    await x.w.messaging.whenIdle();
    return out;
  } finally {
    x.writing = false;
  }
}

/** W's `k` first messages at their longest to A's Seedelf, each a conversation of its own; A and B read them. */
export async function strangers(x: World, k: number): Promise<void> {
  await writing(x, async () => {
    for (let i = 0; i < k; i++) {
      await x.w.messaging.start("preprod", ALICE_SEEDELF, `first message ${i} `.padEnd(x.maxText, "x"));
      await x.w.messaging.whenIdle();
    }
  });
  for (const p of [x.a, x.b, x.a, x.b]) await synced(p);
}

/** WebAssembly whose scan finds the key's own envelopes as the real one does, and also every one `claims` says. */
export function claiming(claims: (envelope: string) => boolean, base: Wasm = loadTestWasm()): Wasm {
  return {
    ...base,
    messagingScan: (key, envelopes) => {
      const batch = JSON.parse(envelopes) as string[];
      const bits = [...base.messagingScan(key, envelopes)];
      batch.forEach((e, i) => claims(e) && (bits[i] = "1"));
      return bits.join("");
    },
  };
}

/** A lane of `p`'s: the entries from a lane's start, none running before, to the end of the last running. */
export interface Lane {
  entries: LogEntry[];
  /** Where it starts and ends in the log. */
  from: number;
  to: number;
}

/** `p`'s lanes, from its log: nested lanes (a sync's posting run) are one. */
export function lanesOf(p: Party, from = 0): Lane[] {
  const out: Lane[] = [];
  let depth = 0;
  let start = -1;
  for (let i = from; i < p.log.length; i++) {
    const e = p.log[i]!;
    if (e.what === "lane-start") {
      if (depth++ === 0) start = i;
    } else if (e.what === "lane-end") {
      if (--depth === 0) out.push({ entries: p.log.slice(start + 1, i), from: start, to: i });
    }
  }
  return out;
}

/** The records a lane touched, each with its stored length: `get name 1388`. */
export const recordsIn = (lane: Lane) => lane.entries.filter((e) => e.what === "get" || e.what === "set" || e.what === "remove").map((e) => `${e.what} ${e.name} ${e.bytes ?? ""}`.trim());

/** What a wallet asked any server, in order. */
export const requestsOf = (p: Party, from = 0) => p.log.slice(from).filter((e) => e.what === "GET" || e.what === "POST").map((e) => `${e.what} ${e.name}`);

/**
 * Every lane of `p`, the whole of it, touched only the lane's own records, and opened and received nothing, and no
 * runner step started in it: a call of the runner's waiting in the wallet's queue as a lane starts gives the queue back
 * as its turn comes (round 5's admit check). `also`: records the screens' overview may read meanwhile, the wallet's own
 * and the same size whatever any envelope held (O8: which Seedelfs this browser made).
 */
export function expectLanesClean(p: Party, from = 0, also: ReadonlySet<string> = new Set()): void {
  for (const lane of lanesOf(p, from)) {
    for (const e of lane.entries) {
      if (e.what === "open" || e.what === "receive") throw new Error(`a lane opened an envelope: ${JSON.stringify(e)}`);
      if ((e.what === "get" || e.what === "set" || e.what === "remove") && !LANE_RECORDS.has(e.name!) && !also.has(e.name!)) {
        throw new Error(`a lane touched ${e.what} ${e.name} (${e.bytes} bytes)`);
      }
      if (e.what === "step-start") throw new Error("a runner step started inside a lane");
    }
  }
}

/** Two wallets' lanes touched the same records at the same lengths, lane by lane. */
export function expectSameLanes(a: Party, b: Party, fromA = 0, fromB = 0): void {
  expect(lanesOf(a, fromA).map(recordsIn)).toEqual(lanesOf(b, fromB).map(recordsIn));
}

/** A tick: `p`'s sync started, and the event loop turned until it ends; its runner's work goes on in the background. */
export async function tick(p: Party, network: "preprod" | "mainnet" = "preprod"): Promise<void> {
  let settled = false;
  p.messaging.sync(network).then(
    () => void (settled = true),
    () => void (settled = true),
  );
  // Bounded by the wall clock: over `ipc`, storage answers on timers, which take real time.
  for (const start = performance.now(); !settled && performance.now() - start < 60_000; ) await new Promise((r) => setImmediate(r));
  expect(settled).toBe(true);
  await turns(5);
}

export const median = (xs: number[]) => {
  const s = [...xs].sort((p, q) => p - q);
  return s[Math.floor(s.length / 2)]!;
};

export { ALICE_SEEDELF, BOB_SEEDELF, CAROL_SEEDELF };
