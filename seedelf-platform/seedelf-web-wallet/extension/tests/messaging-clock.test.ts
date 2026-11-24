// The device's clock in Seedelf Messaging (the 1.10.0 gate's W14). A first
// message carries its writer's clock (t), and a reader takes one only within
// 48 hours back and an hour ahead of its own: a clock that's off loses first
// messages without a word. So the wallet measures its clock against the
// relay's where a post's answer gives that (a fresh post's `expires` is the
// relay's now and 36 hours) and the overview says so. It never takes the
// relay's time as its own: §5's rules, which stop a relay that serves an old
// or deleted envelope again, run on the reader's clock because the relay
// can't be trusted with it. In-memory waits run on a monotonic clock, so a
// clock set right doesn't stretch them; t is rounded down to 10 minutes.
import { describe, expect, it } from "vitest";

import type { Inbox } from "../src/background/messaging";
import {
  BOB_SEEDELF,
  busyFor,
  CAROL_SEEDELF,
  clock,
  fileOf,
  pair,
  party,
  synced,
  talking,
  turnOn,
} from "./messaging-harness";

const HOUR = 3600_000;

// Each test bounded: one that fails mid-take fails here, never hangs the run.
describe("the device's clock (W14)", { timeout: 30_000 }, () => {
  it("is measured against the relay's at a fresh post, and the overview says how far off it is, either way (clock#1)", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    // Alice's laptop is three hours fast.
    alice.skew = 3 * HOUR;
    await alice.messaging.send("preprod", cid, "from a fast clock");
    await alice.messaging.whenIdle();
    expect((await alice.messaging.overview("preprod")).clockOff).toBeCloseTo(3, 1);
    // Bob's is three hours slow.
    bob.skew = -3 * HOUR;
    await bob.messaging.send("preprod", cid, "from a slow clock");
    await bob.messaging.whenIdle();
    expect((await bob.messaging.overview("preprod")).clockOff).toBeCloseTo(-3, 1);
    // Set right: the next fresh post says so.
    alice.skew = 0;
    await alice.messaging.send("preprod", cid, "set right");
    await alice.messaging.whenIdle();
    expect((await alice.messaging.overview("preprod")).clockOff).toBeUndefined();
  });

  it("says nothing of a clock half an hour off or less: two such clocks never refuse each other", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    alice.skew = 25 * 60_000;
    await alice.messaging.send("preprod", cid, "close enough");
    await alice.messaging.whenIdle();
    expect((await alice.messaging.overview("preprod")).clockOff).toBeUndefined();
    alice.skew = 50 * 60_000;
    await alice.messaging.send("preprod", cid, "not quite");
    await alice.messaging.whenIdle();
    expect((await alice.messaging.overview("preprod")).clockOff).toBeCloseTo(50 / 60, 1);
  });

  it("isn't measured from an answer for an envelope the relay already held: its time is the first post's", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    // The relay keeps the post, and the answer is lost: the message stays pending.
    const real = relay.fetch;
    relay.fetch = async (url, init) => {
      const answer = await real(url, init);
      if (init.method === "POST") throw new TypeError("Failed to fetch");
      return answer;
    };
    await alice.messaging.send("preprod", cid, "held before");
    await alice.messaging.whenIdle();
    relay.fetch = real;
    // Five hours on, posted again: "already held", with the first post's expiry.
    await busyFor(5 * HOUR, alice, bob);
    alice.restart();
    await synced(alice);
    const entry = (await alice.messaging.thread("preprod", cid)).messages.at(-1)!;
    expect(entry.sent).toBe("posted");
    expect((await alice.messaging.overview("preprod")).clockOff).toBeUndefined();
    // Its expiry is the relay's, the first post's 36 hours.
    expect(entry.expires).toBe(relay.pools.get("preprod")!.held.at(-1)!.came + 36 * HOUR - (relay.pools.get("preprod")!.held.at(-1)!.came % 1000));
  });

  it("is never corrected by the relay's: a fast writer's first message still carries its own clock (clock#1)", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    alice.skew = 2 * HOUR;
    await alice.messaging.send("preprod", cid, "measured");
    await alice.messaging.whenIdle();
    expect((await alice.messaging.overview("preprod")).clockOff).toBeCloseTo(2, 1);
    // A first message after the measure, at a time off the 10-minute lines: t is the device's, rounded down, not the
    // relay's.
    clock.now += 600_000 - (clock.now % 600_000) + 4_321;
    await alice.wallet.touch();
    const second = await alice.messaging.start("preprod", BOB_SEEDELF, "to you again");
    await alice.messaging.whenIdle();
    const t = (await alice.messaging.overview("preprod")).conversations.find((c) => c.cid === second)!.startedAt;
    expect(t).toBe(Math.floor((clock.now + 2 * HOUR) / 600_000) * 600_000);
  });

  it("rounds a first message's t down to 10 minutes, at the start and at a continuation (clock#6)", async () => {
    const { alice, bob } = await pair();
    // A time that isn't on a 10-minute line.
    clock.now += 600_000 - (clock.now % 600_000) + 12_345;
    await alice.wallet.touch();
    await bob.wallet.touch();
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "hello");
    await alice.messaging.whenIdle();
    await synced(bob);
    const line = Math.floor(clock.now / 600_000) * 600_000;
    expect((await bob.messaging.overview("preprod")).requests[0]!.startedAt).toBe(line);
    expect((await alice.messaging.overview("preprod")).conversations[0]!.startedAt).toBe(line);
    await bob.messaging.accept("preprod", cid);
    await bob.messaging.send("preprod", cid, "hi");
    await bob.messaging.whenIdle();
    await synced(alice);
    clock.now += 7_000;
    const next = await alice.messaging.continueIn("preprod", cid, "the same keys");
    await alice.messaging.whenIdle();
    await synced(bob);
    const continued = (await bob.messaging.overview("preprod")).requests.find((r) => r.cid === next)!;
    expect(continued.startedAt % 600_000).toBe(0);
  });

  it("expires at once after a sync that ran with the clock ahead, once it's set right (clock#3)", async () => {
    const { relay, directory, alice, bob } = await pair();
    const carol = await party(15, relay, directory, CAROL_SEEDELF);
    await turnOn(carol);
    const one = await alice.messaging.start("preprod", BOB_SEEDELF, "one");
    const two = await carol.messaging.start("preprod", BOB_SEEDELF, "two");
    await alice.messaging.whenIdle();
    await carol.messaging.whenIdle();
    await synced(bob);
    await bob.messaging.remove("preprod", one);
    // One sync with the clock a month ahead: everything due expires, and the expiry's time is a month on.
    bob.skew = 30 * 24 * HOUR;
    await synced(bob);
    bob.skew = 0;
    // Set right, then a tombstone of its own, and 49 hours and 7 days: past its 48, and the crate's 7 days more.
    await bob.messaging.remove("preprod", two);
    const tombstones = (await bob.store.get<Inbox>("messaging.preprod"))!.tombstones;
    await busyFor(49 * HOUR + 7 * 24 * HOUR, alice, bob, carol);
    await synced(bob);
    expect((await bob.store.get<Inbox>("messaging.preprod"))!.tombstones).not.toBe(tombstones);
  });

  it("holds a wait the relay asked for as long as it asked, whatever the clock does meanwhile (clock#4)", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    // A day ahead when the relay says 30 s.
    alice.skew = 24 * HOUR;
    relay.waitOnce = 429;
    await alice.messaging.send("preprod", cid, "later");
    await alice.messaging.whenIdle();
    let thread = await alice.messaging.thread("preprod", cid);
    expect(thread.nextTry).toBe(clock.now + 24 * HOUR + 30_000);
    // Set right: the thread counts down the 30 s, never a day and 30 s.
    alice.skew = 0;
    thread = await alice.messaging.thread("preprod", cid);
    expect(thread.nextTry).toBe(clock.now + 30_000);
    clock.now += 31_000;
    await alice.wallet.touch();
    await synced(alice);
    expect((await alice.messaging.thread("preprod", cid)).messages.at(-1)!.sent).toBe("posted");
  });

  it("says when a fresh post expires by this device's own clock: 36 hours from its answer (clock#5)", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    alice.skew = 38 * HOUR;
    await alice.messaging.send("preprod", cid, "from the future");
    await alice.messaging.whenIdle();
    const entry = (await alice.messaging.thread("preprod", cid)).messages.at(-1)!;
    expect(entry.sent).toBe("posted");
    expect(entry.expires).toBe(clock.now + 38 * HOUR + 36 * HOUR);
    const kept = (await fileOf(alice, cid))!.history.at(-1)!;
    expect(kept).toMatchObject({ postedAt: clock.now + 38 * HOUR });
  });
});

describe("a sync that posts nothing", { timeout: 30_000 }, () => {
  it("measures nothing: pages carry no time, and a received first message's t is never taken for the relay's", async () => {
    const { alice, bob } = await pair();
    // Alice's first message carries her clock, 50 minutes fast; Bob's wallet reads it with no post of its own.
    alice.skew = 50 * 60_000;
    await alice.messaging.start("preprod", BOB_SEEDELF, "from a fast clock");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect((await bob.messaging.overview("preprod")).requests).toHaveLength(1);
    expect((await bob.messaging.overview("preprod")).clockOff).toBeUndefined();
  });
});
