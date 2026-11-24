// Work before a request that strangers' requests size (the 1.10.0 gate's
// round 5, ported from the verifiers' verify2-sweep-work-reload, which
// reproduced B1 to B3 at 48480cf8): a relay-made 'changed' mid-read had every
// open page's overview unseal the whole inbox before page 2; two posts of one
// run had the bookkeeping between them unseal and seal it; with both networks
// on, one network's first page waited behind the other's inbox. Since round 5
// a lane's notices wait for its end, the overview answers from memory, and no
// lane reads an inbox (fix item 4, O8). What runs between each wallet's
// requests is asserted the same; times are logged, and asserted only within a
// margin far past what load moves.
import { describe, expect, it } from "vitest";

import {
  ALICE_SEEDELF,
  BOB_SEEDELF,
  CAROL_SEEDELF,
  clock,
  type Directory,
  fakeRelay,
  type FakeRelay,
  party,
  type Party,
  synced,
  turnOn,
  turns,
} from "./messaging-harness";

/** 512 bytes nobody's, at the version the relay takes: the smallest envelope. */
const junk = (n: number) => "01" + n.toString(16).padStart(8, "0") + "5a".repeat(507);

const turn = () => new Promise<void>((r) => setImmediate(r));
async function until(done: () => boolean, most = 20000): Promise<boolean> {
  for (let i = 0; i < most && !done(); i++) await turn();
  return done();
}

/** Every trace entry with the time it was pushed. */
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

/**
 * As App.tsx's useMessagingOverview does on every `messaging-changed`: the overview read again. Returns the reloads
 * started, to wait for.
 */
function reloadOnChanged(p: Party): Array<Promise<unknown>> {
  const reloads: Array<Promise<unknown>> = [];
  const push = p.changed.push.bind(p.changed);
  p.changed.push = (...n) => {
    p.trace.push("# changed");
    for (const network of n) {
      reloads.push(
        p.messaging.overview(network).then(
          () => p.trace.push("# overview done"),
          () => p.trace.push("# overview failed"),
        ),
      );
    }
    return push(...n);
  };
  return reloads;
}

async function tick(p: Party, label: string, network: "preprod" | "mainnet" = "preprod"): Promise<void> {
  p.trace.push(`# ${label}`);
  let settled = false;
  p.messaging.sync(network).then(
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

const storedInbox = (p: Party, network = "preprod") => {
  const raw = p.local.data.get(`seedelf.private.messaging.${network}`) as string | undefined;
  return raw ? (JSON.parse(raw) as { data: string }).data.length : 0;
};

interface World {
  relay: FakeRelay;
  directory: Directory;
  w: Party;
  a: Party;
  b: Party;
}

/** W writes 9 first messages of ~30 KB to A's Seedelf (the crate keeps 256 KiB of them); A takes them, B takes none. */
async function world(): Promise<World> {
  const relay = fakeRelay(clock);
  const directory: Directory = new Map();
  const w = await party(15, relay, directory, CAROL_SEEDELF);
  const a = await party(12, relay, directory, ALICE_SEEDELF);
  const b = await party(24, relay, directory, BOB_SEEDELF);
  await turnOn(w, a, b);
  for (let i = 0; i < 9; i++) {
    await w.messaging.start("preprod", ALICE_SEEDELF, `${i} `.padEnd(30_000, "x"));
    await w.messaging.whenIdle();
  }
  await synced(a);
  await synced(b);
  a.trace.length = 0;
  b.trace.length = 0;
  return { relay, directory, w, a, b };
}

describe("class B: no work before a request that strangers' requests size (round 5; the verifiers' sweep)", () => {
  it("a relay-made 'changed' mid-read: every open page's overview unseals the whole inbox before page 2", { timeout: 300_000 }, async () => {
    const x = await world();
    // The requests in their own record since round 5: A's past 0.6 MB, B's none; the inboxes small, alike.
    const ia = await x.a.store.get<{ requests?: string }>("messagingRequests.preprod");
    const ib = await x.b.store.get<{ requests?: string }>("messagingRequests.preprod");
    const sizes = { a: storedInbox(x.a), b: storedInbox(x.b), requestsA: ia?.requests?.length ?? 0, requestsB: ib?.requests?.length ?? 0 };
    console.log("stored inbox (base64 chars) and the requests record's field:", JSON.stringify(sizes));
    expect(sizes.requestsA).toBeGreaterThan(300_000);
    expect(sizes.requestsB).toBe(0);
    expect(sizes.a).toBeLessThan(10_000);

    // The overview's own cost, measured alone: what one reload of a page costs the worker.
    const cost = async (p: Party) => {
      const ms: number[] = [];
      for (let i = 0; i < 7; i++) {
        const t0 = performance.now();
        await p.messaging.overview("preprod");
        ms.push(performance.now() - t0);
      }
      return median(ms);
    };
    console.log("overview alone, median ms: A", (await cost(x.a)).toFixed(1), "B", (await cost(x.b)).toFixed(1));

    const ta = timeTrace(x.a);
    const tb = timeTrace(x.b);
    reloadOnChanged(x.a);
    reloadOnChanged(x.b);
    x.relay.pageCount = 4;
    const gaps = { a: [] as number[], b: [] as number[], aNext: [] as number[], bNext: [] as number[], aFirst: [] as number[], bFirst: [] as number[] };
    const orders: Record<"a" | "b", string[][]> = { a: [], b: [] };
    for (let round = 0; round < 6; round++) {
      // The relay doesn't answer one read: each wallet says it's offline.
      x.relay.up = false;
      await tick(x.a, `down ${round}`);
      await tick(x.b, `down ${round}`);
      x.relay.up = true;
      // Then three pages of nobody's envelopes, the first page answered after the failure.
      for (let i = 0; i < 12; i++) x.relay.put("preprod", junk(1000 * round + i));
      for (const [key, p, timed] of [
        ["a", x.a, ta],
        ["b", x.b, tb],
      ] as const) {
        const from = timed.length;
        await tick(p, `up ${round}`);
        const run = timed.slice(from);
        const gets = run.filter((e) => e.what.startsWith("GET "));
        expect(gets.length).toBeGreaterThanOrEqual(3);
        const start = run[0]!.at;
        gaps[key].push(gets[1]!.at - gets[0]!.at);
        gaps[`${key}Next` as "aNext"].push(gets[2]!.at - gets[1]!.at);
        gaps[`${key}First` as "aFirst"].push(gets[0]!.at - start);
        // What ran between page 1's request and page 2's.
        const i1 = run.indexOf(gets[0]!);
        const i2 = run.indexOf(gets[1]!);
        orders[key].push(run.slice(i1, i2 + 1).map((e) => e.what));
      }
    }
    console.log("between page 1 and page 2 (the overview's reload), median ms: A", median(gaps.a).toFixed(1), "B", median(gaps.b).toFixed(1));
    console.log("between page 2 and page 3 (no reload), median ms: A", median(gaps.aNext).toFixed(1), "B", median(gaps.bNext).toFixed(1));
    console.log("tick start to page 1 (C2: the read's own inbox read), median ms: A", median(gaps.aFirst).toFixed(1), "B", median(gaps.bFirst).toFixed(1));
    console.log("A, page 1 to page 2:", JSON.stringify(orders.a[0]));
    console.log("B, page 1 to page 2:", JSON.stringify(orders.b[0]));
    // The same for both, and no notice, no overview and no inbox between page 1 and page 2: the notice waits for the
    // lane's end (at 48480cf8 A's page 2 was 141 to 160 ms behind page 1, B's 1.5 to 4.8).
    expect(orders.a).toEqual(orders.b);
    for (const order of orders.a) {
      expect(order).not.toContain("# changed");
      expect(order).not.toContain("get messaging.preprod");
    }
    expect(median(gaps.a)).toBeLessThan(median(gaps.b) + 20);
  });

  it("two posts of one run: the bookkeeping between them unseals and seals the whole inbox", { timeout: 300_000 }, async () => {
    const x = await world();
    // A takes one of W's requests (a conversation of its own); W writes first to B, which takes it.
    const req = (await x.a.messaging.overview("preprod")).requests[0]!.cid;
    await x.a.messaging.accept("preprod", req);
    const cidB = await x.w.messaging.start("preprod", BOB_SEEDELF, "hello Bob");
    await x.w.messaging.whenIdle();
    await synced(x.b);
    await x.b.messaging.accept("preprod", cidB);
    await synced(x.a);
    await synced(x.b);
    // Posts are answered by the test and kept nowhere, so neither wallet changes the other's pages.
    const real = x.relay.fetch;
    let answering = true;
    x.relay.fetch = async (url, init) => {
      if (init.method === "POST" && answering) {
        if (!x.relay.up) throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify({ kept: "new", expires: Math.floor((clock.now + 36 * 3600_000) / 1000) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return real(url, init);
    };
    x.relay.price = 1;
    const ta = timeTrace(x.a);
    const tb = timeTrace(x.b);
    reloadOnChanged(x.a);
    reloadOnChanged(x.b);
    const gaps = { a: [] as number[], b: [] as number[] };
    const between = { a: [] as string[], b: [] as string[] };
    for (let round = 0; round < 6; round++) {
      // Two texts each, written while the relay is down: both wait, pending.
      x.relay.up = false;
      for (const [p, cid] of [
        [x.a, req],
        [x.b, cidB],
      ] as const) {
        await p.messaging.send("preprod", cid, `one ${round}`);
        await p.messaging.send("preprod", cid, `two ${round}`);
        await p.messaging.whenIdle();
      }
      x.relay.up = true;
      for (const [key, p, timed] of [
        ["a", x.a, ta],
        ["b", x.b, tb],
      ] as const) {
        const from = timed.length;
        await tick(p, `post ${round}`);
        const run = timed.slice(from);
        const posts = run.filter((e) => e.what.startsWith("POST "));
        expect(posts.length).toBe(2);
        gaps[key].push(posts[1]!.at - posts[0]!.at);
        // Nothing sealed between the two posts: their bookkeeping is the runner's, after the lane.
        between[key].push(...run.slice(run.indexOf(posts[0]!) + 1, run.indexOf(posts[1]!)).filter((e) => /^(get|set) /.test(e.what)).map((e) => e.what));
      }
    }
    answering = false;
    console.log("between the two posts, median ms: A", median(gaps.a).toFixed(1), "B", median(gaps.b).toFixed(1));
    console.log("all, A:", gaps.a.map((g) => g.toFixed(1)).join(" "), "B:", gaps.b.map((g) => g.toFixed(1)).join(" "));
    // At 48480cf8 A's was 229 to 602 ms, B's 2.5 to 4.6: alike now.
    expect(median(gaps.a)).toBeLessThan(median(gaps.b) + 20);
    expect(between.a).toEqual([]);
    expect(between.b).toEqual([]);
  });

  it("both networks on: one network's first page waits behind the other's inbox read", { timeout: 300_000 }, async () => {
    const x = await world();
    for (const p of [x.a, x.b]) {
      await p.messaging.switch("mainnet", true);
      await p.messaging.whenIdle();
    }
    const ta = timeTrace(x.a);
    const tb = timeTrace(x.b);
    const first = { a: [] as number[], b: [] as number[] };
    const orders: Record<"a" | "b", string[]> = { a: [], b: [] };
    for (let round = 0; round < 6; round++) {
      for (const [key, p, timed] of [
        ["a", x.a, ta],
        ["b", x.b, tb],
      ] as const) {
        const from = timed.length;
        p.trace.push(`# alarm ${round}`);
        // The alarm's run (sw.ts): every network whose switch is on, at once.
        await p.messaging.syncAll(["mainnet", "preprod"]);
        await p.messaging.whenIdle();
        const run = timed.slice(from);
        const main = run.find((e) => e.what.startsWith("GET /messaging/v1/mainnet/"))!;
        first[key].push(main.at - run[0]!.at);
        if (round === 0) orders[key] = run.slice(0, run.indexOf(main) + 1).map((e) => e.what);
      }
    }
    console.log("alarm to mainnet's first page, median ms: A", median(first.a).toFixed(1), "B", median(first.b).toFixed(1));
    console.log("A, up to mainnet's first page:", JSON.stringify(orders.a));
    // Before mainnet's first page, nothing of preprod's but its fixed records, the same for both (at 48480cf8 preprod's
    // inbox read came first, A's 135 to 170 ms against B's 1.1 to 3.3).
    for (const key of ["a", "b"] as const) expect(orders[key]).not.toContain("get messaging.preprod");
    expect(orders.a.filter((w) => /^(get|set) /.test(w))).toEqual(orders.b.filter((w) => /^(get|set) /.test(w)));
    expect(median(first.a)).toBeLessThan(median(first.b) + 20);
  });
});
