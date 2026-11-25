// The worker is kept alive only while a post's or a first message's work is solved, and only while that work is still
// wanted (1.10.0's second review, round 7). Chrome stops a worker 30 seconds after its last event or call to an
// extension API, and a solve makes neither, so between its slices, at most every 10 seconds, it makes one call that
// does nothing else: Chrome's own pattern for a bounded task ("Keep a service worker alive until a long-running
// operation is finished"). The continuous keep-alive, a timer that calls on and on, is allowed on managed devices only
// and isn't used (worker-messaging-wiring.test.ts holds that it never comes back).
//
// Here: the calls come only inside a solve, never closer than 10 seconds, and stop with it; and a lock, the switch
// turned off or the wallet removed while it's solved gives the work up at its next look, with no call made for it and
// the message still waiting. The service's clock is the test's, moved on four seconds at each of a solve's turns.
import { describe, expect, it } from "vitest";

import { BOB_SEEDELF, clock, loadTestWasm, outboxOf, pair, PASSWORD, synced, talking, texts } from "./messaging-harness";

const STEP_MS = 4000;

/** Alice and Bob, every solve of Alice's taking `slices` slices past its first; each of the worker's calls noted with the clock's time. */
async function slow(slices: number) {
  const pings: number[] = [];
  const world = await pair({ keepAlive: async () => void pings.push(clock.now) });
  const wasm = loadTestWasm();
  const solving = { slices: 0 };
  const stub = () =>
    world.alice.restart({
      ...wasm,
      messagingFindStamp: (request) => {
        solving.slices++;
        return (JSON.parse(request) as { from: number }).from < slices * 65536 ? JSON.stringify({ nonce: null }) : wasm.messagingFindStamp(request);
      },
    });
  return { ...world, pings, solving, stub };
}

describe("the solve's keep-alive is bounded by the solve (1.10.0's second review)", { timeout: 60_000 }, () => {
  it("calls come between a solve's slices, never closer than 10 seconds, and none once the solve is over", async () => {
    const world = await slow(12);
    const { relay, alice, bob, pings } = world;
    const cid = await talking(alice, bob);
    await synced(bob);
    world.stub();
    relay.price = 9;
    await synced(alice);
    // No solve yet ran long: nothing called.
    expect(pings).toEqual([]);
    alice.onWait = async () => void (clock.now += STEP_MS);
    await alice.messaging.send("preprod", cid, "worked for");
    await alice.messaging.whenIdle();
    // Twelve empty slices, 48 seconds of the worker's clock: a call past each tenth second, four in all.
    expect(pings).toHaveLength(4);
    for (let i = 1; i < pings.length; i++) expect(pings[i]! - pings[i - 1]!).toBeGreaterThanOrEqual(10_000);
    // The work done and posted: minutes go by, syncs with them, and nothing calls again.
    const called = pings.length;
    for (let i = 0; i < 5; i++) {
      clock.now += 60_000;
      await synced(alice);
    }
    alice.onWait = undefined;
    expect(pings).toHaveLength(called);
    await synced(bob);
    expect(await texts(bob, cid)).toContain("in:worked for");
  });

  for (const how of ["a lock", "the switch turned off", "Remove wallet"] as const) {
    it(`${how} while a post's work is solved gives it up at its next look: no call is made for it`, async () => {
      const world = await slow(12);
      const { relay, alice, bob, pings, solving } = world;
      const cid = await talking(alice, bob);
      await synced(bob);
      world.stub();
      relay.price = 9;
      await synced(alice);
      solving.slices = 0;
      let done = false;
      alice.onWait = async () => {
        clock.now += STEP_MS;
        if (done || solving.slices < 1) return;
        done = true;
        if (how === "a lock") await alice.wallet.lock();
        else if (how === "the switch turned off") await alice.preferences.set({ messaging: { preprod: false } as never });
        else await alice.wallet.reset();
      };
      alice.trace.length = 0;
      await alice.messaging.send("preprod", cid, "worked for").catch(() => undefined);
      await alice.messaging.whenIdle();
      alice.onWait = undefined;
      // It happened where this case means it to: else it proves nothing.
      expect(done).toBe(true);
      // Given up at the first look, the third slice's: not one call, nine slices never worked, nothing posted.
      expect(pings).toEqual([]);
      expect(solving.slices).toBeLessThanOrEqual(4);
      expect(alice.trace.filter((s) => s.startsWith("POST"))).toEqual([]);
      if (how === "Remove wallet") return;
      // The message still waits: unlocked, or switched on again, it's worked for and posted.
      if (how === "a lock") await alice.wallet.unlock(PASSWORD);
      else await alice.preferences.set({ messaging: { preprod: true } as never });
      expect((await outboxOf(alice))?.map((w) => w.cid)).toEqual([cid]);
      alice.onWait = async () => void (clock.now += STEP_MS);
      await synced(alice);
      alice.onWait = undefined;
      expect(pings.length).toBeGreaterThan(0);
      await synced(bob);
      expect(await texts(bob, cid)).toContain("in:worked for");
    });
  }

  it("a first message's stamp: calls while it's solved and the wallet stays unlocked; a lock gives it up, and the next unlock solves it", async () => {
    const world = await slow(12);
    const { alice, bob, pings, solving } = world;
    world.stub();
    let locked = false;
    alice.onWait = async () => {
      clock.now += STEP_MS;
      // Past its first call, the wallet locks.
      if (!locked && pings.length === 1) {
        locked = true;
        await alice.wallet.lock();
      }
    };
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "hello Bob");
    await alice.messaging.whenIdle();
    alice.onWait = undefined;
    expect(locked).toBe(true);
    // One call while it was wanted; at the next look the wallet was locked: given up, no second call.
    expect(pings).toHaveLength(1);
    expect(solving.slices).toBeLessThanOrEqual(7);
    // Unlocked again: the unlock's first window takes the stamp up, and the message goes.
    await alice.wallet.unlock(PASSWORD);
    alice.onWait = async () => void (clock.now += STEP_MS);
    await synced(alice);
    await alice.messaging.whenIdle();
    await synced(alice);
    alice.onWait = undefined;
    await synced(bob);
    expect((await bob.messaging.overview("preprod")).requests.map((r) => r.cid)).toEqual([cid]);
  });
});
