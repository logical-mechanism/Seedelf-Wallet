// C3's relay-only triggers (the 1.10.0 gate's round 5, ported from the
// verifiers' verify2-c3-relay-trigger, which reproduced them at 48480cf8): no
// browser refusal, nothing but what the relay chooses, with each area just
// above Messages' reserve line. A lever the relay held grew A's inbox across a
// pad (a gap flag, a request that couldn't be kept, the cursor's own digits),
// or each worker's first scan mark was charged a whole pad; the reserve refused
// it for A alone, A stalled, and its next worker asked from an old cursor.
// Since round 5 the gap, the cursor and the marks are fixed writes that never
// meet the reserve (fix item 4), the rooms count as taken (fix item 7), and
// `full` only pauses the take: what each wallet asks is the same, before and
// after each restart, and A's `full`, where set, shows only in its overview.
//
// Paired worlds: one relay, one pool, A (Alice) and B (Bob) served the same
// pages; W (Carol) writes. A holds W's requests; B none.
import { describe, expect, it } from "vitest";

import { QUOTA_BYTES, RESERVE_BYTES } from "../src/background/messaging";
import { ALICE_SEEDELF, cursorOf, type Party, readOf, usedBytes } from "./messaging-harness";
import { expectLanesClean, junk, requestsOf, tick, world, type World, writing } from "./messaging-lanes-kit";

const FILLER = "seedelf.other.filler";
/** Each area's room above the reserve line once the rooms are counted: less than any pad's growth past 2 KiB. */
const ROOM = 3000;

async function roomAbove(p: Party, room: number): Promise<void> {
  p.local.data.delete(FILLER);
  const rooms = await (p.messaging as unknown as { roomsHeld(): Promise<number> }).roomsHeld();
  const fill = QUOTA_BYTES - RESERVE_BYTES - room - rooms - usedBytes(p);
  p.local.data.set(FILLER, JSON.stringify("x".repeat(fill - FILLER.length - 2)));
}

let n = 0;
const junks = (x: World, count = 1) => {
  for (let i = 0; i < count; i++) x.relay.put("preprod", junk(n++));
};

async function ticks(x: World): Promise<void> {
  await tick(x.a);
  await x.a.messaging.whenIdle();
  await tick(x.b);
  await x.b.messaging.whenIdle();
}

/** A holding W's first message (a request of A's), B none; one envelope a page; each area ROOM above the line. */
async function staged(): Promise<{ x: World; cid: string }> {
  const x = await world();
  const cid = await writing(x, () => x.w.messaging.start("preprod", ALICE_SEEDELF, "x"));
  for (const p of [x.a, x.b, x.a, x.b]) await tick(p);
  await x.a.messaging.whenIdle();
  await x.b.messaging.whenIdle();
  x.relay.pageCount = 1;
  await roomAbove(x.a, ROOM);
  await roomAbove(x.b, ROOM);
  return { x, cid };
}

/** After `lever`, three ticks, a restart of both, three more: what each asked is the same throughout. */
async function same(x: World, lever: () => Promise<void>): Promise<void> {
  const [fa, fb] = [x.a.log.length, x.b.log.length];
  await lever();
  for (let k = 0; k < 3; k++) {
    junks(x);
    await ticks(x);
    expect(await cursorOf(x.a)).toBe(await cursorOf(x.b));
  }
  x.a.restart();
  x.b.restart();
  for (let k = 0; k < 3; k++) {
    junks(x);
    await ticks(x);
  }
  expect(requestsOf(x.a, fa)).toEqual(requestsOf(x.b, fb));
  expect(await cursorOf(x.a)).toBe(await cursorOf(x.b));
  expectLanesClean(x.a, fa);
  expectLanesClean(x.b, fb);
  // Nothing in a lane is `full`'s: B, which takes nothing, never is.
  expect((await x.b.messaging.overview("preprod")).full).toBeUndefined();
}

describe("C3, the relay's levers move nothing it can see (round 5; the verifiers' verify2-c3)", { timeout: 300_000 }, () => {
  it("the gap flag: kept in the read record, its one size, for both", async () => {
    const { x } = await staged();
    let gapNext = true;
    const real = x.relay.fetch;
    x.relay.fetch = async (url, init) => {
      if (init.method === "GET" && gapNext && new URL(url).searchParams.get("after")) x.relay.gapOnce = true;
      return real(url, init);
    };
    await same(x, async () => {
      junks(x);
      await ticks(x);
      gapNext = false;
    });
    expect((await readOf(x.a))!.gapAt).toBeDefined();
    expect((await readOf(x.b))!.gapAt).toBeDefined();
  });

  it("a first message A has to keep: its request grows in a room of its own, counted as taken; A asks what B asks", async () => {
    const { x, cid } = await staged();
    await same(x, async () => {
      await writing(x, () => x.w.messaging.send("preprod", cid, "y".repeat(1500)));
      await ticks(x);
    });
    const overview = await x.a.messaging.overview("preprod");
    console.log(`[c3-relay] the join: A's requests ${JSON.stringify(overview.requests.map((r) => r.messages))}, full ${overview.full}, dropped ${overview.dropped}`);
  });

  it("the cursor's digits, swept by the relay from 8 to 20: the read record stays in its pad, and neither wallet is refused", async () => {
    const { x } = await staged();
    await same(x, async () => {
      const pool = x.relay.pools.get("preprod")!;
      for (let digits = 8; digits <= 20; digits++) {
        pool.next = 10n ** BigInt(digits - 1);
        junks(x);
        await ticks(x);
        expect([(await x.a.messaging.overview("preprod")).full, (await x.b.messaging.overview("preprod")).full]).toEqual([undefined, undefined]);
      }
    });
  });

  it("no lever at all: each worker's first scan mark is a fixed write, never refused for room, never `full`", async () => {
    const { x } = await staged();
    await roomAbove(x.a, 500);
    await roomAbove(x.b, 500);
    await same(x, async () => {
      for (let life = 0; life < 3; life++) {
        x.a.restart();
        x.b.restart();
        junks(x);
        await ticks(x);
        expect([(await x.a.messaging.overview("preprod")).full, (await x.b.messaging.overview("preprod")).full]).toEqual([undefined, undefined]);
      }
    });
  });
});
