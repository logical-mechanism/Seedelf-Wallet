// The unlock's first lane makes the same sealed read whatever memory holds (THE RULE; 1.10.0's second review, F4). Only
// a wallet that was taking something lowers what its read record owes (`lowerOwed`), in memory first and then in a gated
// write. A lock between the two left the record dirty in memory, and where the worker lived on to the unlock, the next
// lane took it from memory with no read, where a wallet that owns nothing reads and unseals `messagingRead` before its
// first page: one sealed read fewer for A. Now the read is made either way, and memory's copy, the newer, is the one
// kept.
//
// Paired: W writes one first message to A's Seedelf; A's lock comes as its runner writes the read record, B's after it
// has read the same page.
import { describe, expect, it } from "vitest";

import { PASSWORD, type Party, turns } from "./messaging-harness";
import { ALICE_SEEDELF, expectLanesClean, lanesOf, recordsIn, requestsOf, world, writing } from "./messaging-lanes-kit";

describe("a lock while what's owed is being lowered (1.10.0's second review, F4)", { timeout: 120_000 }, () => {
  it("the unlock's first lane reads the same records for A and B, and A keeps the newer copy", async () => {
    const x = await world();
    await writing(x, () => x.w.messaging.start("preprod", ALICE_SEEDELF, "hello Alice"));
    // The lock comes as A's runner writes the read record (outside every lane): the write is refused, as a lock refuses it.
    let locked = false;
    let inLane = 0;
    const push = x.a.log.push.bind(x.a.log);
    x.a.log.push = (...items) => {
      for (const e of items) inLane += e.what === "lane-start" ? 1 : e.what === "lane-end" ? -1 : 0;
      return push(...items);
    };
    x.a.beforeWrite = async (name) => {
      if (name !== "messagingRead.preprod" || inLane > 0 || locked) return;
      locked = true;
      await x.a.wallet.lock();
    };
    await x.a.messaging.sync("preprod");
    await x.b.messaging.sync("preprod");
    for (let i = 0; i < 200 && !locked; i++) await turns(1);
    expect(locked, "A's runner wrote the read record after its lane").toBe(true);
    await x.b.wallet.lock();
    await x.a.messaging.whenIdle();
    await x.b.messaging.whenIdle();
    x.a.beforeWrite = undefined;
    await turns(5);
    // The unlock, and its read (the worker lived on: the same services).
    await x.a.wallet.unlock(PASSWORD);
    await x.b.wallet.unlock(PASSWORD);
    const from = { a: x.a.log.length, b: x.b.log.length };
    await x.a.messaging.syncAll(["preprod"]);
    await x.b.messaging.syncAll(["preprod"]);
    /** The sealed records the unlock's lane touched before its first page. */
    const before = (p: Party, at: number) => {
      const lane = lanesOf(p, at)[0]!;
      return recordsIn({ ...lane, entries: lane.entries.slice(0, lane.entries.findIndex((e) => e.what === "GET")) });
    };
    const a = before(x.a, from.a);
    const b = before(x.b, from.b);
    await x.a.messaging.whenIdle();
    await x.b.messaging.whenIdle();
    expect(requestsOf(x.a, from.a)).toEqual(requestsOf(x.b, from.b));
    expectLanesClean(x.a, from.a);
    expectLanesClean(x.b, from.b);
    expect(a).toEqual(b);
    expect(b).toEqual(["get messagingRead.preprod 1388"]);
    // Memory's copy was the newer (what's owed already lowered for the read saved in the take record): kept, so nothing
    // is counted as lost that wasn't, and the message is taken.
    const overview = await x.a.messaging.overview("preprod");
    expect(overview.droppedUnread).toBeUndefined();
    expect(overview.dropped).toBeUndefined();
    expect(overview.requests).toHaveLength(1);
  });
});
