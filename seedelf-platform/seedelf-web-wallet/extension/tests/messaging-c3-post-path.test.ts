// C3, face 3 (the 1.10.0 gate's round 5, ported from the verifiers'
// verify2-c3-post-path, which reproduced it at 48480cf8): a post's bookkeeping
// was written between two posts of one run, and where that write (the clock in
// the inbox) would grow a pad near the reserve line it was refused for A alone,
// ending A's posting run: A posted one message a tick and B both at once. Since
// round 5 a posting run writes nothing between two posts, the clock is the read
// record's, a fixed write, and the posts' bookkeeping is the runner's, after the
// lane (fix items 4 and 7).
//
// Paired worlds: one relay, one pool; A holds W's requests, B none; each has
// two messages of its own waiting; each area 3,000 bytes above the reserve
// line, the rooms counted as taken. A posts both in the same run as B.
import { describe, expect, it } from "vitest";

import { QUOTA_BYTES, RESERVE_BYTES } from "../src/background/messaging";
import { CAROL_SEEDELF, fileOf, type Party, readOf, usedBytes } from "./messaging-harness";
import { keptNew, requestsOf, strangers, tick, world, writing } from "./messaging-lanes-kit";

const FILLER = "seedelf.other.filler";

async function roomAbove(p: Party, room: number): Promise<void> {
  p.local.data.delete(FILLER);
  const rooms = await (p.messaging as unknown as { roomsHeld(): Promise<number> }).roomsHeld();
  const fill = QUOTA_BYTES - RESERVE_BYTES - room - rooms - usedBytes(p);
  p.local.data.set(FILLER, JSON.stringify("x".repeat(fill - FILLER.length - 2)));
}

const pendingOf = async (p: Party, cid: string) => ((await fileOf(p, cid))?.history ?? []).filter((e) => e.sent === "pending").length;

describe("C3, face 3: a post's bookkeeping cuts no wallet's posting short (round 5; the verifiers' verify2-c3)", { timeout: 300_000 }, () => {
  it("each with two messages waiting, A at the requests' bound, each area 3,000 bytes above the line: both post both at once", async () => {
    const x = await world();
    await strangers(x, 8);
    const own: Record<"a" | "b", string> = { a: "", b: "" };
    x.answer = () => {
      throw new TypeError("Failed to fetch");
    };
    for (const [k, p] of [
      ["a", x.a],
      ["b", x.b],
    ] as const) {
      own[k] = await p.messaging.start("preprod", CAROL_SEEDELF, "hello there");
      await p.messaging.whenIdle();
      await p.messaging.send("preprod", own[k], "and again");
      await p.messaging.whenIdle();
    }
    expect([await pendingOf(x.a, own.a), await pendingOf(x.b, own.b)]).toEqual([2, 2]);
    void writing;
    await roomAbove(x.a, 3000);
    await roomAbove(x.b, 3000);
    x.answer = () => keptNew();
    const [fa, fb] = [x.a.log.length, x.b.log.length];
    for (const p of [x.a, x.b]) {
      await tick(p);
      await p.messaging.whenIdle();
    }
    const posts = (p: Party, from: number) => requestsOf(p, from).filter((r) => r.startsWith("POST ")).length;
    expect([posts(x.a, fa), posts(x.b, fb)]).toEqual([2, 2]);
    expect(requestsOf(x.a, fa)).toEqual(requestsOf(x.b, fb));
    expect([await pendingOf(x.a, own.a), await pendingOf(x.b, own.b)]).toEqual([0, 0]);
    // The clock a fresh post measured, in the read record for both (W14).
    expect((await readOf(x.a))!.clock).toBeDefined();
    expect((await readOf(x.b))!.clock).toBeDefined();
  });
});
