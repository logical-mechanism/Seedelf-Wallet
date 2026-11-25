// A deleted conversation's waiting message is never posted (1.10.0's second review, the worker's finding 3). Deleting a
// conversation is the only way to take back a message that still waits to be posted. Delete drops its envelopes from
// the outbox record, and from what a press noted in memory, before the inbox stops listing it and its record goes: a
// posting run reads the outbox record alone. Before the review the outbox was dropped last, and every failure of that
// write but a lock was let go: a lock or a stop between left the envelope listed, and the next worker posted it, to a
// conversation the user had deleted. Here the wallet locks at each of the deletion's writes in turn, the worker going
// on or stopped while locked; the outbox's write fails as a storage area's does; and a press's noted envelope is
// deleted with its conversation. After each: the conversation is whole (still listed, its message still waiting, to be
// deleted again), or gone with nothing posted.
//
// And what's noted in memory never outlives its phrase (the review of the merged fixes): a deletion that fails at a
// lock notes nothing back (the unlock's first window writes the outbox again from the records), every note carries the
// phrase it was made under, and a posting run uses only the unlocked phrase's. So a wallet removed and another restored
// while the worker lives posts nothing of the first's. From the deletion's first write, no posting run of this worker
// posts the conversation: one that starts as the outbox record is being dropped passes it over.
import { describe, expect, it, vi } from "vitest";

import { PRIVATE_PREFIX } from "../src/background/private-store";
import { clock, loadTestWasm, outboxOf, pair, type Party, PASSWORD, phrase, recordName, type ServiceOptions, synced, talking, texts } from "./messaging-harness";

const TEXT = "I take this back";
const OUTBOX = `${PRIVATE_PREFIX}messagingOutbox.preprod`;

/** Alice and Bob talking, Alice's next message sealed and waiting: the server can't be reached. */
async function waiting(options: ServiceOptions = {}) {
  const world = await pair(options);
  const cid = await talking(world.alice, world.bob);
  await synced(world.bob);
  world.relay.up = false;
  await world.alice.messaging.send("preprod", cid, TEXT);
  await world.alice.messaging.whenIdle();
  expect((await outboxOf(world.alice))?.map((w) => w.cid)).toEqual([cid]);
  return { ...world, cid };
}

const listed = async (p: Party, cid: string) =>
  (await p.store.get<{ conversations: Record<string, unknown> }>("messaging.preprod"))?.conversations[cid] !== undefined;

/** The server reachable again, Alice's syncs and Bob's: what Alice posted, and whether Bob got the message. */
async function afterwards(world: Awaited<ReturnType<typeof waiting>>) {
  const { relay, alice, bob, cid } = world;
  relay.up = true;
  alice.trace.length = 0;
  await synced(alice);
  await synced(alice);
  await synced(bob);
  return { posts: alice.trace.filter((s) => s.startsWith("POST")).length, got: (await texts(bob, cid)).includes(`in:${TEXT}`) };
}

describe("Delete, with a message still waiting (1.10.0's second review)", { timeout: 30_000 }, () => {
  // The deletion's writes, in order: the outbox record's, the inbox's, the conversation's record's.
  for (const at of ["outbox", "inbox", "record"] as const) {
    for (const stopped of [false, true]) {
      it(`leaves it whole or gone with nothing to post: a lock at the ${at}'s write, the worker ${stopped ? "stopped while locked" : "going on"}`, async () => {
        const world = await waiting();
        const { alice, cid } = world;
        const record = PRIVATE_PREFIX + (await recordName(alice, cid));
        let locked = false;
        const lock = async () => {
          if (locked) return;
          locked = true;
          await alice.wallet.lock();
        };
        const remove = alice.local.remove.bind(alice.local);
        alice.local.remove = (async (...keys: string[]) => {
          if ((at === "outbox" && keys.includes(OUTBOX)) || (at === "record" && keys.includes(record))) await lock();
          return remove(...keys);
        }) as typeof alice.local.remove;
        alice.beforeWrite = async (name) => {
          if (at === "inbox" && name === "messaging.preprod") await lock();
        };
        const deleted = await alice.messaging.remove("preprod", cid).then(
          () => true,
          () => false,
        );
        alice.local.remove = remove;
        alice.beforeWrite = undefined;
        // The lock landed where this case means it to: else it proves nothing.
        expect(locked).toBe(true);

        if (stopped) alice.restart();
        await alice.wallet.unlock(PASSWORD);
        const still = await listed(alice, cid);
        // Which, by where the lock came: whole until the inbox stops listing it (its second write), then gone.
        expect(still).toBe(at !== "record");
        const { posts, got } = await afterwards(world);
        if (still) {
          // Whole: the press failed, the conversation is listed, and its message still waits and goes, as before the press.
          expect(deleted).toBe(false);
          expect(await texts(alice, cid)).toContain(`out:${TEXT}`);
          expect(got).toBe(true);
          // And it can be deleted again.
          await alice.messaging.remove("preprod", cid);
          expect(await listed(alice, cid)).toBe(false);
        } else {
          // Gone: nothing of it is posted, by this worker or the next, and Bob never reads it.
          expect(posts).toBe(0);
          expect(got).toBe(false);
          expect((await outboxOf(alice)) ?? []).toEqual([]);
        }
        // Either way no record of it is left once it's unlisted.
        expect(await alice.local.keys(record)).toEqual([]);
      });
    }
  }

  it("fails, deleting nothing, where the outbox record's write fails: what a posting run could send is never left behind", async () => {
    const world = await waiting();
    const { alice, cid } = world;
    // The storage area can't be read as the deletion comes to the outbox record, as Chrome's can't when its database fails.
    let failing = true;
    const get = alice.local.get.bind(alice.local);
    alice.local.get = (async (key: string) => {
      if (failing && key === OUTBOX) throw new Error("IO error: the storage area couldn't be read");
      return get(key);
    }) as typeof alice.local.get;
    await expect(alice.messaging.remove("preprod", cid)).rejects.toThrow();
    failing = false;
    alice.local.get = get;
    // Nothing half-deleted: still listed, its record there, its envelope still in the outbox record.
    expect(await listed(alice, cid)).toBe(true);
    expect((await outboxOf(alice))?.map((w) => w.cid)).toEqual([cid]);
    expect(await texts(alice, cid)).toContain(`out:${TEXT}`);
    // Deleted again, it goes, and a worker started later posts nothing of it.
    await alice.messaging.remove("preprod", cid);
    expect(await listed(alice, cid)).toBe(false);
    alice.restart();
    const { posts, got } = await afterwards(world);
    expect(posts).toBe(0);
    expect(got).toBe(false);
  });

  it("drops what a press noted in memory too: an envelope the outbox record had no room for goes with its conversation", async () => {
    const world = await pair();
    const { relay, alice, bob } = world;
    const cid = await talking(alice, bob);
    await synced(bob);
    relay.up = false;
    // The outbox record's append is refused, as an area at its quota refuses it: the envelope is noted in memory.
    alice.beforeWrite = (name) => {
      if (name === "messagingOutbox.preprod") throw new Error("QUOTA_BYTES quota exceeded");
    };
    await alice.messaging.send("preprod", cid, TEXT);
    await alice.messaging.whenIdle();
    alice.beforeWrite = undefined;
    expect((await outboxOf(alice)) ?? []).toEqual([]);
    await alice.messaging.remove("preprod", cid);
    const { posts, got } = await afterwards({ ...world, cid });
    expect(posts).toBe(0);
    expect(got).toBe(false);
  });

  it("keeps a noted envelope where the deletion fails: the message goes as it would have", async () => {
    const world = await waiting();
    const { alice, cid } = world;
    // The inbox's write is refused once, as the browser refuses one: the deletion fails after the outbox was dropped.
    let refused = 0;
    alice.beforeWrite = (name) => {
      if (name === "messaging.preprod" && refused++ === 0) throw new Error("QUOTA_BYTES quota exceeded");
    };
    await expect(alice.messaging.remove("preprod", cid)).rejects.toThrow();
    alice.beforeWrite = undefined;
    expect(await listed(alice, cid)).toBe(true);
    // The same worker posts it from memory, as before the press; its record says so after.
    const { posts, got } = await afterwards(world);
    expect(posts).toBe(1);
    expect(got).toBe(true);
    expect((await alice.messaging.thread("preprod", cid)).messages.at(-1)?.sent).toBe("posted");
  });

  it("passes it over in a posting run that starts as the deletion drops it from the outbox record", async () => {
    const world = await waiting();
    const { relay, alice, bob, cid } = world;
    // A tick comes as the deletion reads the outbox record to drop the envelope, the server reachable again: its lane
    // runs first (the deletion's write waits for it) and reads the outbox record with the envelope still in it.
    let lane: Promise<void> | undefined;
    const get = alice.local.get.bind(alice.local);
    alice.local.get = (async (key: string) => {
      if (key === OUTBOX && !lane) {
        relay.up = true;
        alice.trace.length = 0;
        lane = alice.messaging.sync("preprod");
      }
      return get(key);
    }) as typeof alice.local.get;
    await alice.messaging.remove("preprod", cid);
    alice.local.get = get;
    // The lane ran where this case means it to, and read the pool: else it proves nothing.
    expect(lane).toBeDefined();
    await lane;
    await alice.messaging.whenIdle();
    expect(alice.trace.filter((s) => s.startsWith("GET")).length).toBeGreaterThan(0);
    // Held back from the moment the deletion began to write: never posted, then or after.
    expect(alice.trace.filter((s) => s.startsWith("POST"))).toEqual([]);
    expect(await listed(alice, cid)).toBe(false);
    await synced(alice);
    await synced(bob);
    expect(alice.trace.filter((s) => s.startsWith("POST"))).toEqual([]);
    expect(await texts(bob, cid)).not.toContain(`in:${TEXT}`);
  });

  // Forgot password, or Remove wallet, then another phrase restored, the worker living on (a page is open): what the
  // first wallet's presses left in memory is no envelope of the second's.
  const anotherPhrase = async (world: Awaited<ReturnType<typeof waiting>>) => {
    const { relay, alice, bob, cid } = world;
    await alice.wallet.reset();
    await alice.wallet.create(phrase(15), PASSWORD);
    relay.up = true;
    alice.trace.length = 0;
    // The new wallet turns Messages on, and its first reads and posting runs go by.
    await alice.messaging.switch("preprod", true);
    await alice.messaging.whenIdle();
    await synced(alice);
    await synced(alice);
    await synced(bob);
    return { posts: alice.trace.filter((s) => s.startsWith("POST")), got: (await texts(bob, cid)).includes(`in:${TEXT}`) };
  };

  it("posts nothing of a removed wallet's under another phrase: a deletion that failed at a lock", async () => {
    const world = await waiting();
    const { alice, cid } = world;
    // The wallet locks as the deletion writes the inbox: the outbox record no longer holds the envelope.
    let locked = false;
    alice.beforeWrite = async (name) => {
      if (name === "messaging.preprod" && !locked) {
        locked = true;
        await alice.wallet.lock();
      }
    };
    await expect(alice.messaging.remove("preprod", cid)).rejects.toThrow();
    alice.beforeWrite = undefined;
    expect(locked).toBe(true);
    const { posts, got } = await anotherPhrase(world);
    expect(posts).toEqual([]);
    expect(got).toBe(false);
  });

  it("notes nothing back at a lock, whoever unlocks before the failure is answered: another phrase restored while the question waits for a tick", async () => {
    // The guard this holds (`remove`'s catch: nothing noted at a lock) matters in one order only. Noting asks the
    // wallet's queue for the phrase unlocked now, and that question waits at the gate while a tick is near (up to
    // TAKE_MARGIN_MS before it and TICK_GRACE_MS after): a wallet removed and another restored inside that wait would
    // answer it, and the first wallet's envelope would be noted under the second's phrase, for its posting run to send.
    // No person is that fast at the pages; the worker doesn't count on it.
    let tick: number | undefined;
    const world = await waiting({ ticks: () => (tick === undefined ? [] : [{ at: tick, lane: true }]) });
    const { relay, alice, bob, cid } = world;
    // The wallet locks as the deletion writes the inbox (the outbox record no longer holds the envelope), and the
    // alarm's minute comes near: the write, already let through, fails for the lock; whatever asks next waits.
    let locked = false;
    alice.beforeWrite = async (name) => {
      if (name !== "messaging.preprod" || locked) return;
      locked = true;
      await alice.wallet.lock();
      // A second on, so the worker reads the alarms again at its next look; the tick a second after that.
      clock.now += 1000;
      tick = clock.now + 1000;
    };
    const removal = alice.messaging.remove("preprod", cid).then(
      () => "deleted",
      () => "failed",
    );
    await vi.waitFor(() => expect(locked).toBe(true), { timeout: 5000 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    alice.beforeWrite = undefined;
    // Forgot password, and another phrase restored: unlocked again, as another wallet, the tick still to come.
    await alice.wallet.reset();
    await alice.wallet.create(phrase(15), PASSWORD);
    await new Promise((resolve) => setTimeout(resolve, 50));
    // The tick passes with no run of its own, and its grace: the gate opens.
    clock.now += 6000;
    tick = undefined;
    expect(await removal).toBe("failed");
    await alice.messaging.whenIdle();
    relay.up = true;
    alice.trace.length = 0;
    // The new wallet turns Messages on, and its first reads and posting runs go by: nothing of the first wallet's.
    await alice.messaging.switch("preprod", true);
    await alice.messaging.whenIdle();
    await synced(alice);
    await synced(alice);
    await synced(bob);
    expect(alice.trace.filter((s) => s.startsWith("POST"))).toEqual([]);
    expect(await texts(bob, cid)).not.toContain(`in:${TEXT}`);
  });

  for (const when of ["the first post's", "the second post's"] as const) {
    it(`posts nothing of a removed wallet's under another phrase: removed and restored, Messages turned on, while ${when} work is solved`, async () => {
      // A posting run reads what's waiting once, under the phrase unlocked then, and a post's work can take a minute.
      // The wallet removed, another phrase restored and its Messages switch turned on inside that: unlocked, and on.
      // Each post asks under the run's own phrase right before it goes (`mayAsk`), so none of the first wallet's does.
      const world = await pair();
      const { relay, alice, bob } = world;
      const cid = await talking(alice, bob);
      await synced(bob);
      relay.up = false;
      await alice.messaging.send("preprod", cid, TEXT);
      await alice.messaging.send("preprod", cid, "and this");
      await alice.messaging.whenIdle();
      expect((await outboxOf(alice))?.map((w) => w.id)).toHaveLength(2);
      // Each post's work takes a slice more than one: a turn of the event loop to act in while it's solved.
      const wasm = loadTestWasm();
      let solves = 0;
      alice.restart({
        ...wasm,
        messagingFindStamp: (request) => {
          if ((JSON.parse(request) as { from: number }).from !== 0) return wasm.messagingFindStamp(request);
          solves++;
          return JSON.stringify({ nonce: null });
        },
      });
      let restored = false;
      alice.onWait = async () => {
        if (restored || solves < (when === "the first post's" ? 1 : 2)) return;
        restored = true;
        await alice.wallet.reset();
        await alice.wallet.create(phrase(15), PASSWORD);
        await alice.messaging.switch("preprod", true);
      };
      relay.up = true;
      alice.trace.length = 0;
      await synced(alice);
      alice.onWait = undefined;
      // The other wallet was restored where this case means it to: else it proves nothing.
      expect(restored).toBe(true);
      await synced(alice);
      await synced(bob);
      // What the first wallet posted before it was removed, and nothing after.
      const posted = when === "the first post's" ? [] : [TEXT];
      expect(alice.trace.filter((s) => s.startsWith("POST"))).toHaveLength(posted.length);
      expect((await texts(bob, cid)).filter((m) => m === `in:${TEXT}` || m === "in:and this")).toEqual(posted.map((m) => `in:${m}`));
    });
  }

  it("posts nothing of a removed wallet's under another phrase: an append the outbox record had no room for", async () => {
    const world = await pair();
    const { relay, alice, bob } = world;
    const cid = await talking(alice, bob);
    await synced(bob);
    relay.up = false;
    alice.beforeWrite = (name) => {
      if (name === "messagingOutbox.preprod") throw new Error("QUOTA_BYTES quota exceeded");
    };
    await alice.messaging.send("preprod", cid, TEXT);
    await alice.messaging.whenIdle();
    alice.beforeWrite = undefined;
    // Noted in memory alone, under the first phrase.
    expect((await outboxOf(alice)) ?? []).toEqual([]);
    const { posts, got } = await anotherPhrase({ ...world, cid });
    expect(posts).toEqual([]);
    expect(got).toBe(false);
  });

  it("still posts what was noted under the phrase that is unlocked, a lock and an unlock between", async () => {
    const world = await pair();
    const { relay, alice, bob } = world;
    const cid = await talking(alice, bob);
    await synced(bob);
    relay.up = false;
    // The outbox record takes no append, now or at the unlock's repair: the envelope is in memory alone.
    alice.beforeWrite = (name) => {
      if (name === "messagingOutbox.preprod") throw new Error("QUOTA_BYTES quota exceeded");
    };
    await alice.messaging.send("preprod", cid, TEXT);
    await alice.messaging.whenIdle();
    await alice.wallet.lock();
    await alice.wallet.unlock(PASSWORD);
    relay.up = true;
    alice.trace.length = 0;
    await synced(alice);
    alice.beforeWrite = undefined;
    // The same phrase's note, posted by the unlock's first posting run, once.
    expect(alice.trace.filter((s) => s.startsWith("POST"))).toHaveLength(1);
    await synced(bob);
    expect(await texts(bob, cid)).toContain(`in:${TEXT}`);
  });
});
