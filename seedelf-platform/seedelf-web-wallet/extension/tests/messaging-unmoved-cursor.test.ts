// Whether a lane writes the read record is decided by the pages alone (THE RULE; 1.10.0's second review, F2): the cursor
// moved, a page held envelopes, or a gap. Never by whether the scan matched. A relay that isn't §17's can serve a page
// that holds envelopes and leave the cursor where it was asked from (relay.ts `readPage` takes it). Before the fix the
// lane then sealed and wrote `messagingRead` only where an envelope was the wallet's: one write more in A's lane than
// in B's, and, since a read asked while a lane runs is that lane, a request that exists for B and not for A.
//
// Paired: W writes one first message to A's Seedelf; A and B read the same pages, at the same cursors.
import { describe, expect, it } from "vitest";

import { turns } from "./messaging-harness";
import { ALICE_SEEDELF, expectLanesClean, lanesOf, recordsIn, requestsOf, type World, world, writing } from "./messaging-lanes-kit";

/** From now on, every page that holds envelopes says the cursor it was asked from, and that nothing follows. */
function unmovedCursor(x: World): void {
  const real = x.relay.fetch;
  x.relay.fetch = async (url, init) => {
    const answer = await real(url, init);
    const after = new URL(url).searchParams.get("after");
    if (init.method !== "GET" || after === null || answer.status !== 200) return answer;
    const bytes = new Uint8Array(await answer.arrayBuffer());
    const view = new DataView(bytes.buffer);
    if (view.getUint16(14) > 0) {
      view.setBigUint64(2, BigInt(after));
      bytes[1] = bytes[1]! & ~1;
    }
    return new Response(bytes, { status: 200, headers: { "content-type": "application/octet-stream" } });
  };
}

describe("a page that holds envelopes and doesn't move the cursor (1.10.0's second review, F2)", { timeout: 120_000 }, () => {
  it("A's lanes touch the records B's do, at the same sizes: the read record is written for both", async () => {
    const x = await world();
    // Both hold a cursor (their first read, as Messages were turned on). W writes one first message to A's Seedelf.
    await writing(x, () => x.w.messaging.start("preprod", ALICE_SEEDELF, "hello Alice"));
    unmovedCursor(x);
    const from = { a: x.a.log.length, b: x.b.log.length };
    for (let i = 0; i < 3; i++) {
      await x.a.messaging.sync("preprod");
      await x.b.messaging.sync("preprod");
      await turns(3);
    }
    await x.a.messaging.whenIdle();
    await x.b.messaging.whenIdle();
    // The same requests, each from the cursor that never moved; clean lanes.
    expect(requestsOf(x.a, from.a)).toEqual(requestsOf(x.b, from.b));
    expect(new Set(requestsOf(x.a, from.a)).size).toBe(1);
    expectLanesClean(x.a, from.a);
    expectLanesClean(x.b, from.b);
    // A really is the one the envelope is for.
    expect(x.a.log.slice(from.a).some((e) => e.what === "open")).toBe(true);
    expect(x.b.log.slice(from.b).some((e) => e.what === "open")).toBe(false);
    const a = lanesOf(x.a, from.a).map(recordsIn);
    const b = lanesOf(x.b, from.b).map(recordsIn);
    expect(a).toEqual(b);
    // The page held envelopes: the record is written, by both.
    expect(b.every((lane) => lane.includes("set messagingRead.preprod 1388"))).toBe(true);
    // And taken once, as before: served again at every read, refused as a duplicate.
    expect((await x.a.messaging.overview("preprod")).requests).toHaveLength(1);
  });

  it("a read asked in the lane's last moments (the alarm's) is the same request for A and for B", async () => {
    const x = await world();
    await writing(x, () => x.w.messaging.start("preprod", ALICE_SEEDELF, "hello Alice"));
    unmovedCursor(x);
    // A sealed write takes its time in a real browser (a turn of the wallet's queue and chrome.storage's IPC). Here the
    // read record's write in the lane is held until the test lets it go, for A and B alike.
    const asked: Record<"a" | "b", string[]> = { a: [], b: [] };
    const held: Record<"a" | "b", boolean> = { a: false, b: false };
    for (const [key, p] of [
      ["a", x.a],
      ["b", x.b],
    ] as const) {
      let release!: () => void;
      const hold = new Promise<void>((r) => (release = r));
      p.beforeWrite = async (name) => {
        if (name !== "messagingRead.preprod" || held[key]) return;
        held[key] = true;
        await hold;
      };
      const from = p.log.length;
      const first = p.messaging.sync("preprod");
      // The page is answered and scanned, the posts done: the lane is at its end.
      await turns(20);
      // The alarm's minute comes now.
      const second = p.messaging.syncAll(["preprod"], { alarm: true });
      await turns(20);
      release();
      await first;
      await second;
      p.beforeWrite = undefined;
      asked[key] = requestsOf(p, from);
      await p.messaging.whenIdle();
    }
    expect(held).toEqual({ a: true, b: true });
    expect(asked.a).toEqual(asked.b);
    expect(asked.a).toHaveLength(1);
  });
});
