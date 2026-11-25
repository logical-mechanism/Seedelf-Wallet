// A request accepted is never lost to a stop (1.10.0's second review, the worker's finding 2). Accept writes the
// conversation's record, the inbox that lists it and no longer lists the request, the requests' record without the
// request, and the inbox again with that record's nonce. Before the review it wrote the requests' record second: a lock
// between it and the inbox left a conversation's record nothing listed, which the sweep deleted, and a requests' record
// without the request, so the stranger's first messages were gone, with nothing said. Here the wallet locks at each of
// Accept's writes in turn, the worker going on or stopped while locked: after the unlock the first message is still a
// request or a conversation, never both and never neither, and the exchange goes on from it.
//
// And a request is never accepted a second time once its conversation was deleted (the same review, later): one an
// Accept left in its record (that record's write refused, or a stop before it) leaves it before its conversation is
// deleted (messaging-accept-left.test.ts); where that write is refused too, it's listed again after the deletion, but
// its ID is a tombstone's, and Accept refuses it in the worker's words, writing nothing. Accepted, it would be a
// conversation neither side's messages reach. An ordinary accept writes what it wrote, in the same order.
import { describe, expect, it } from "vitest";

import { BOB_SEEDELF, CAROL_SEEDELF, loadTestWasm, pair, party, PASSWORD, requestsOf, synced, texts, turnOn } from "./messaging-harness";

const FIRST = "hello Bob, it's Alice";

/** The requests the stored record holds, by cid: read by the test with the module, no key needed. */
async function requestsHeld(p: Parameters<typeof requestsOf>[0]): Promise<string[]> {
  const stored = await requestsOf(p);
  if (!stored?.requests) return [];
  const listed = JSON.parse(loadTestWasm().messagingRequestsInfo(Buffer.from(stored.requests, "base64").toString("hex"))) as Array<{ cid: string }>;
  return listed.map((r) => r.cid);
}

describe("Accept, and a lock at each of its writes (1.10.0's second review)", { timeout: 30_000 }, () => {
  // Accept's writes, in order: the conversation's record, the inbox, the requests' record, the inbox.
  for (const at of [1, 2, 3, 4]) {
    for (const stopped of [false, true]) {
      it(`keeps the first message, a lock at write ${at}, the worker ${stopped ? "stopped while locked" : "going on"}`, async () => {
        const { alice, bob } = await pair();
        const cid = await alice.messaging.start("preprod", BOB_SEEDELF, FIRST);
        await alice.messaging.whenIdle();
        await synced(bob);
        expect((await bob.messaging.overview("preprod")).requests.map((r) => r.cid)).toEqual([cid]);

        let writes = 0;
        let locked = false;
        bob.beforeWrite = async () => {
          if (++writes === at && !locked) {
            locked = true;
            await bob.wallet.lock();
          }
        };
        const accepted = await bob.messaging.accept("preprod", cid).then(
          () => true,
          () => false,
        );
        bob.beforeWrite = undefined;
        // The lock landed where this case means it to: else it proves nothing.
        expect(locked).toBe(true);
        expect(accepted).toBe(false);

        if (stopped) bob.restart();
        await bob.wallet.unlock(PASSWORD);
        // The unlock's read, its first window (the repairs) and its sweep.
        await synced(bob);
        await synced(bob);
        const after = await bob.messaging.overview("preprod");
        // One or the other, never neither (the loss) and never both (a request beside its own conversation).
        expect([...after.requests.map((r) => r.cid), ...after.conversations.map((c) => c.cid)]).toEqual([cid]);
        // Which, by where the lock came: a request until the inbox lists the conversation (its second write), then it.
        expect(after.conversations.length).toBe(at <= 2 ? 0 : 1);
        if (after.requests.length) {
          // Still a request, whole: read, and accepted again.
          expect((await bob.messaging.request("preprod", cid)).map((m) => m.text)).toEqual([FIRST]);
          await bob.messaging.accept("preprod", cid);
        } else {
          // A conversation: the request is gone from its record too, so no later repair lists it beside the conversation.
          expect(await requestsHeld(bob)).toEqual([]);
        }
        // No record of a conversation nothing lists is left, and none was deleted that the inbox lists.
        expect(await bob.local.keys("seedelf.private.conversation.preprod.")).toHaveLength(1);
        expect(await texts(bob, cid)).toEqual([`in:${FIRST}`]);
        // And it goes on: Bob's reply reaches Alice.
        await bob.messaging.send("preprod", cid, "hi Alice");
        await bob.messaging.whenIdle();
        await synced(alice);
        expect(await texts(alice, cid)).toEqual([`out:${FIRST}`, "in:hi Alice"]);
        expect((await bob.messaging.overview("preprod")).requests).toEqual([]);
      });
    }
  }

  it("lists no request beside its own conversation when a later repair reads the requests' record again", async () => {
    const { alice, bob } = await pair();
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, FIRST);
    await alice.messaging.whenIdle();
    await synced(bob);
    // The wallet locks as Accept writes the requests' record: the conversation is listed, the request still in its record.
    let writes = 0;
    bob.beforeWrite = async () => {
      if (++writes === 3) await bob.wallet.lock();
    };
    await bob.messaging.accept("preprod", cid).catch(() => undefined);
    bob.beforeWrite = undefined;
    bob.restart();
    await bob.wallet.unlock(PASSWORD);
    expect(await requestsHeld(bob)).toEqual([cid]);
    await synced(bob);
    await synced(bob);
    // The first window's repair dropped it from the record, with no tombstone: the conversation is live.
    expect(await requestsHeld(bob)).toEqual([]);
    const after = await bob.messaging.overview("preprod");
    expect(after.requests).toEqual([]);
    expect(after.conversations.map((c) => c.cid)).toEqual([cid]);
    // Alice's next first-contact message is the conversation's, not a new request.
    await alice.messaging.send("preprod", cid, "are you there?");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect(await texts(bob, cid)).toEqual([`in:${FIRST}`, "in:are you there?"]);
    expect((await bob.messaging.overview("preprod")).requests).toEqual([]);
  });

  for (const stopped of [false, true]) {
    it(`refuses a request left in its record once its conversation was deleted, the worker ${stopped ? "stopped while locked" : "going on"}: listed again, never accepted`, async () => {
      const { alice, bob } = await pair();
      const cid = await alice.messaging.start("preprod", BOB_SEEDELF, FIRST);
      await alice.messaging.whenIdle();
      await synced(bob);
      // Accepted, the requests' record's write refused after the conversation is listed: the request stays in its record.
      let refused = 0;
      bob.beforeWrite = (name) => {
        if (name === "messagingRequests.preprod" && refused++ < 2) throw new Error("QUOTA_BYTES quota exceeded");
      };
      await bob.messaging.accept("preprod", cid);
      expect(refused).toBe(1);
      expect(await requestsHeld(bob)).toEqual([cid]);
      expect((await bob.messaging.overview("preprod")).conversations.map((c) => c.cid)).toEqual([cid]);
      // Bob deletes the conversation: its tombstone stands. The deletion's own repair of the requests' record is
      // refused as the accept's write was, and deletes all the same. The next unlock's repair reads the record again.
      await bob.messaging.remove("preprod", cid);
      bob.beforeWrite = undefined;
      expect(refused).toBe(2);
      expect(await requestsHeld(bob)).toEqual([cid]);
      await bob.wallet.lock();
      if (stopped) bob.restart();
      await bob.wallet.unlock(PASSWORD);
      await synced(bob);
      await synced(bob);
      // Listed again, as the tree has it: readable, with an Accept that refuses.
      const listed = await bob.messaging.overview("preprod");
      expect([listed.requests.map((r) => r.cid), listed.conversations]).toEqual([[cid], []]);
      expect((await bob.messaging.request("preprod", cid)).map((m) => m.text)).toEqual([FIRST]);
      await bob.messaging.whenIdle();
      bob.trace.length = 0;
      await expect(bob.messaging.accept("preprod", cid)).rejects.toThrow("The message was refused (deleted).");
      // A reply accepts first: none can be sealed or posted into it.
      await expect(bob.messaging.send("preprod", cid, "a reply nobody would read")).rejects.toThrow();
      await bob.messaging.whenIdle();
      expect(bob.trace.filter((s) => /^(set|remove|POST) /.test(s))).toEqual([]);
      const after = await bob.messaging.overview("preprod");
      expect([after.requests.map((r) => r.cid), after.conversations]).toEqual([[cid], []]);
      expect(await bob.local.keys("seedelf.private.conversation.preprod.")).toEqual([]);
      await synced(alice);
      expect(await texts(alice, cid)).toEqual([`out:${FIRST}`]);
      // The way out: Delete, which takes it from the record too.
      await bob.messaging.remove("preprod", cid);
      expect((await bob.messaging.overview("preprod")).requests).toEqual([]);
      expect(await requestsHeld(bob)).toEqual([]);
    });
  }

  it("control: an ordinary accept writes what it wrote, in the same order, another conversation's tombstone standing or not", async () => {
    const { relay, directory, alice, bob } = await pair();
    const carol = await party(15, relay, directory, CAROL_SEEDELF);
    await turnOn(carol);
    const first = await alice.messaging.start("preprod", BOB_SEEDELF, FIRST);
    await alice.messaging.whenIdle();
    const other = await carol.messaging.start("preprod", BOB_SEEDELF, "hello Bob, it's Carol");
    await carol.messaging.whenIdle();
    await synced(bob);
    expect((await bob.messaging.overview("preprod")).requests.map((r) => r.cid).sort()).toEqual([first, other].sort());
    /** What an accept writes, in order: its conversation's record by what it is, not by its own ID. */
    const written = async (cid: string) => {
      await bob.messaging.whenIdle();
      bob.trace.length = 0;
      await bob.messaging.accept("preprod", cid);
      return bob.trace.filter((s) => /^(set|remove) /.test(s)).map((s) => s.replace(/^set conversation\.preprod\..*$/, "set conversation.preprod.<id>"));
    };
    const ORDER = ["set conversation.preprod.<id>", "set messaging.preprod", "set messagingRequests.preprod", "set messaging.preprod"];
    // No tombstone anywhere.
    expect(await written(first)).toEqual(ORDER);
    expect(await texts(bob, first)).toEqual([`in:${FIRST}`]);
    // Deleted: its tombstone stands, and is in the way of nobody else's request.
    await bob.messaging.remove("preprod", first);
    expect(await written(other)).toEqual(ORDER);
    expect((await bob.messaging.overview("preprod")).conversations.map((c) => c.cid)).toEqual([other]);
    await bob.messaging.send("preprod", other, "hi Carol");
    await bob.messaging.whenIdle();
    await synced(carol);
    expect(await texts(carol, other)).toEqual(["out:hello Bob, it's Carol", "in:hi Carol"]);
  });
});
