// Class A sweep (takes that change posts), the 1.10.0 gate: a take that keeps a request left the inbox larger, and
// every later sync unsealed that inbox before its first page request and again before its first post. So whether a
// stranger's first messages were the wallet's changed, for as long as the requests were kept, how much work came
// before each sync's requests. Ported from the verifiers' verify2-sweep-posts-inbox-size.test.ts and reversed by
// worker5a's lanes (round 5, relay-oracle fix items 4 and 6): the requests are a record of their own, a lane reads only
// the records whose size no envelope sets (the read record, held in memory; the user's own outbox), so before the
// first page and between it and the post both wallets read the same, by key and by size. Paired: W writes first
// messages of 31,000 bytes to A's Seedelf; A and B read the same pages; A keeps them as requests, B can't open them.
// Then both sync the same way, each with a post of its own waiting. Times are logged, never asserted.
import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import {
  ALICE_SEEDELF,
  BOB_SEEDELF,
  CAROL_SEEDELF,
  clock,
  type Directory,
  fakeRelay,
  loadTestWasm,
  party,
  type Party,
  synced,
  turnOn,
} from "./messaging-harness";

const SERVER = /^(GET|POST) /;

interface Probe {
  /** The service's own steps, timed: `GET`/`POST` to the relay and `get <record>` of a sealed record. */
  steps: Array<{ step: string; at: number }>;
  /** Bytes of sealed records read from the area, as stored, with the step they came before. */
  read: number;
  firstGetRead?: number;
  /** Each read of the area, by key, in order, with what preceded it among the service's steps. */
  keys: string[];
}

/** Each party's own `trace.push` and `local.get`, so each round's probe wraps them alone. */
const originals = new Map<Party, { push: Party["trace"]["push"]; get: Party["local"]["get"] }>();

function probe(p: Party): Probe {
  const probe: Probe = { steps: [], read: 0, keys: [] };
  if (!originals.has(p)) originals.set(p, { push: p.trace.push, get: p.local.get });
  p.trace.push = originals.get(p)!.push;
  p.local.get = originals.get(p)!.get;
  const push = p.trace.push.bind(p.trace);
  p.trace.push = (...items: string[]) => {
    for (const step of items) {
      probe.steps.push({ step, at: performance.now() });
      if (step.startsWith("GET ") && probe.firstGetRead === undefined) probe.firstGetRead = probe.read;
    }
    return push(...items);
  };
  const get = p.local.get.bind(p.local);
  p.local.get = async <T>(key: string) => {
    const raw = p.local.data.get(key);
    if (typeof raw === "string" && key.startsWith("seedelf.private.")) probe.read += raw.length;
    const last = [...probe.steps].reverse().find((s) => /^(GET|POST) /.test(s.step))?.step.split(" ")[0] ?? "start";
    probe.keys.push(`${last}>${key.replace("seedelf.private.", "")}:${typeof raw === "string" ? raw.length : 0}`);
    return get<T>(key);
  };
  return probe;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

describe("class A: requests a take keeps change no later sync's own work before its requests", { timeout: 120_000 }, () => {
  it("the same requests in the same order, and the same reads, by key and size, before each first page and each post", async () => {
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const w = await party(15, relay, directory, CAROL_SEEDELF);
    const a = await party(12, relay, directory, ALICE_SEEDELF);
    const b = await party(24, relay, directory, BOB_SEEDELF);
    await turnOn(w, a, b);
    // Only W's posts reach the pool; A's and B's fail as a lost connection would, so each keeps one waiting.
    let writing = false;
    const real = relay.fetch;
    relay.fetch = async (url, init) => {
      if (init.method === "POST" && !writing) throw new TypeError("Failed to fetch");
      return real(url, init);
    };
    for (const p of [a, b]) {
      await p.messaging.start("preprod", CAROL_SEEDELF, "waiting to go");
      await p.messaging.whenIdle();
    }
    const constants = JSON.parse(loadTestWasm().messagingConstants()) as Record<string, unknown>;
    // W's first messages to A's Seedelf: three requests of two 32 KiB envelopes each, inside the crate's bounds.
    writing = true;
    const text = "x".repeat(31_000);
    for (let i = 0; i < 3; i++) {
      const cid = await w.messaging.start("preprod", ALICE_SEEDELF, `${i}${text}`);
      await w.messaging.whenIdle();
      await w.messaging.send("preprod", cid, `${i}${text}`);
      await w.messaging.whenIdle();
    }
    writing = false;
    for (const p of [a, b]) {
      await synced(p);
      await synced(p);
    }
    const requests = [(await a.messaging.overview("preprod")).requests.length, (await b.messaging.overview("preprod")).requests.length];
    const inboxStored = [a, b].map((p) => (JSON.parse(p.local.data.get("seedelf.private.messaging.preprod") as string) as { data: string }).data.length);
    expect(requests[0]).toBeGreaterThan(0);
    expect(requests[1]).toBe(0);

    // Now the same syncs for both, nothing new in the pool: one page, then the post that waits.
    const runs = { a: [] as Probe[], b: [] as Probe[] };
    const traces = { a: [] as string[][], b: [] as string[][] };
    for (let round = 0; round < 9; round++) {
      for (const [name, p] of [["a", a], ["b", b]] as const) {
        p.trace.length = 0;
        const pr = probe(p);
        const t0 = performance.now();
        pr.steps.push({ step: "# sync", at: t0 });
        await p.messaging.sync("preprod");
        await p.messaging.whenIdle();
        runs[name].push(pr);
        traces[name].push(p.trace.filter((s) => SERVER.test(s)));
      }
    }
    // The relay's view: the same requests, in the same order, every round.
    expect(traces.a).toEqual(traces.b);
    const firstGet = (pr: Probe) => pr.steps.find((s) => s.step.startsWith("GET "))!.at - pr.steps[0]!.at;
    const getToPost = (pr: Probe) => {
      const get = pr.steps.find((s) => s.step.startsWith("GET "))!;
      const post = pr.steps.find((s) => s.step.startsWith("POST "));
      return post ? post.at - get.at : Number.NaN;
    };
    const facts = {
      constants: { maxRequestBytes: constants.maxRequestBytes, maxOneRequestBytes: constants.maxOneRequestBytes },
      requests,
      inboxStored,
      readBeforeFirstGet: [median(runs.a.map((r) => r.firstGetRead ?? 0)), median(runs.b.map((r) => r.firstGetRead ?? 0))],
      readPerSync: [median(runs.a.map((r) => r.read)), median(runs.b.map((r) => r.read))],
      msToFirstGet: [median(runs.a.map(firstGet)), median(runs.b.map(firstGet))].map((x) => Math.round(x * 100) / 100),
      msGetToPost: [median(runs.a.map(getToPost)), median(runs.b.map(getToPost))].map((x) => Math.round(x * 100) / 100),
    };
    console.log(`[inbox-size] ${JSON.stringify(facts)}`);
    // What's read before the first page request, and between it and the post: the same for both, keys and sizes.
    const lane = (pr: Probe) => pr.keys.filter((k) => !k.startsWith("POST>"));
    expect(facts.readBeforeFirstGet[0]).toBe(facts.readBeforeFirstGet[1]);
    for (let round = 0; round < runs.a.length; round++) expect(lane(runs.a[round]!)).toEqual(lane(runs.b[round]!));
    // And nothing of the requests: no record a stranger's envelopes size is read in a lane.
    for (const pr of runs.a) expect(lane(pr).some((k) => /messagingRequests|messaging\.preprod|conversation\./.test(k))).toBe(false);
  });
});
