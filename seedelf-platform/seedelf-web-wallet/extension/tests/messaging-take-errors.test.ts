// An error in an envelope's take that isn't the envelope's (the 1.10.0 gate's
// f2): a read of the storage area that fails, as Chrome's does when its
// database can't be read, is StorageFailed, and the take tries that envelope
// again, in place, up to TAKE_RETRIES times, pausing out of the queue: no
// page and no post waits for it, and the cursor is never held for it. What
// still fails, and every other throw, is passed over without a word (W9), the
// ones after it taken. What the wallet asks the relay is what a wallet the
// envelope isn't for asks, through a worker restart (THE RULE).
import { describe, expect, it } from "vitest";

import { PRIVATE_PREFIX } from "../src/background/private-store";
import {
  ALICE_SEEDELF,
  BOB_SEEDELF,
  CAROL_SEEDELF,
  clock,
  cursorOf,
  type Directory,
  fakeRelay,
  loadTestWasm,
  type Party,
  pair,
  party,
  recordName,
  synced,
  talking,
  texts,
  turnOn,
} from "./messaging-harness";

/**
 * Makes `p`'s storage area refuse reads of `key` (a chrome.storage.local key) the way Chrome's does when its database
 * can't be read, at most `times` times, and only inside a take: after the service opens an envelope (the trace's
 * `open`) and before it hands the crate the records (`receive`). `off()` gives the area back.
 */
function failReadsInTake(p: Party, key: string, times: number) {
  const get = p.local.get.bind(p.local);
  const fault = {
    failed: 0,
    off() {
      p.local.get = get;
    },
  };
  p.local.get = (async (k: string) => {
    if (k === key && fault.failed < times) {
      const open = p.trace.lastIndexOf("open");
      if (open >= 0 && open > p.trace.lastIndexOf("receive")) {
        fault.failed++;
        throw new Error("IO error: the storage area couldn't be read");
      }
    }
    return get(k);
  }) as typeof p.local.get;
  return fault;
}

const lastHeld = (relay: ReturnType<typeof fakeRelay>) => relay.pools.get("preprod")!.held.at(-1)!.number.toString();

// Each test bounded: one that fails mid-take fails here, never hangs the run.
describe("an error in a take that isn't the envelope's (the 1.10.0 gate's f2)", { timeout: 60_000 }, () => {
  for (const { what, record } of [
    { what: "the conversation's record", record: "conversation" },
    { what: "the inbox", record: "inbox" },
  ] as const) {
    it(`keeps the message when a read of ${what} fails once as it's taken: the take tries it again, in place`, async () => {
      const { relay, alice, bob } = await pair();
      const cid = await talking(alice, bob);
      // Past Bob's own reply: the next page holds only Alice's.
      await synced(bob);
      await alice.messaging.send("preprod", cid, "lost?");
      await alice.messaging.whenIdle();
      const key = PRIVATE_PREFIX + (record === "inbox" ? "messaging.preprod" : await recordName(bob, cid));
      const fault = failReadsInTake(bob, key, 1);
      bob.trace.length = 0;
      await synced(bob);
      fault.off();
      // The fault was met where the finding says, inside the take: else this test proves nothing.
      expect(fault.failed).toBe(1);
      // Opened twice, received once: the same envelope, again.
      expect(bob.trace.filter((s) => s === "open")).toHaveLength(2);
      expect(bob.trace.filter((s) => s === "receive")).toHaveLength(1);
      expect(await texts(bob, cid)).toContain("in:lost?");
      expect(await cursorOf(bob)).toBe(lastHeld(relay));
      expect((await bob.messaging.overview("preprod")).dropped).toBeUndefined();
      // Nothing passed over: the harness's hook would have failed the test.
      expect(bob.passedOver).toEqual([]);
    });
  }

  it("passes over without a word a message whose read fails every time it's tried, and takes the next: the cursor goes on, nothing counted", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await synced(bob);
    await alice.messaging.send("preprod", cid, "lost?");
    await alice.messaging.whenIdle();
    const fault = failReadsInTake(bob, PRIVATE_PREFIX + (await recordName(bob, cid)), Infinity);
    // The one throw this test means the take to pass over, after its tries (W9 stands: the owner's default).
    bob.passOverOk = true;
    await synced(bob);
    fault.off();
    expect(fault.failed).toBe(4);
    expect(bob.passedOver).toHaveLength(1);
    expect(await cursorOf(bob)).toBe(lastHeld(relay));
    // The conversation goes on: the next message is taken; the one that failed is gone, and nothing says so.
    await alice.messaging.send("preprod", cid, "after");
    await alice.messaging.whenIdle();
    await synced(bob);
    const thread = await texts(bob, cid);
    expect(thread).toContain("in:after");
    expect(thread).not.toContain("in:lost?");
    expect((await bob.messaging.overview("preprod")).dropped).toBeUndefined();
  });

  it("asks the relay what a wallet the envelope isn't for asks, a worker restart between syncs included (THE RULE)", async () => {
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const alice = await party(12, relay, directory, ALICE_SEEDELF);
    const bob = await party(24, relay, directory, BOB_SEEDELF);
    const carol = await party(15, relay, directory, CAROL_SEEDELF);
    await turnOn(alice, bob, carol);
    const cid = await talking(alice, bob);
    await synced(bob);
    await synced(carol);
    // Both read the same pool to the same place.
    expect(await cursorOf(bob)).toBe(await cursorOf(carol));
    await alice.messaging.send("preprod", cid, "lost?");
    await alice.messaging.whenIdle();
    // The same fault armed in both: it fires only inside a take of an envelope, which only Bob's read finds.
    const faults = [
      failReadsInTake(bob, PRIVATE_PREFIX + (await recordName(bob, cid)), 1),
      failReadsInTake(carol, PRIVATE_PREFIX + "messaging.preprod", 1),
    ];
    const asked = (p: Party) => p.trace.filter((s) => /^(GET|POST) /.test(s));
    for (const p of [bob, carol]) {
      p.trace.length = 0;
      // A sync; the worker stopped, as Chrome stops an idle one, and started again over the same storage (the wallet
      // stays unlocked: its entropy is in session storage); two syncs more.
      await synced(p);
      p.restart();
      await synced(p);
      await synced(p);
    }
    for (const f of faults) f.off();
    expect(faults.map((f) => f.failed)).toEqual([1, 0]);
    expect(asked(bob)).toEqual(asked(carol));
    expect(asked(bob).length).toBeGreaterThanOrEqual(3);
    expect(await texts(bob, cid)).toContain("in:lost?");
  });

  it("still passes over a throw of the module's on one envelope, without a word: the ones after it taken (W9, W3)", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    for (const text of ["one", "breaks", "three"]) await alice.messaging.send("preprod", cid, text);
    await alice.messaging.whenIdle();
    const bad = Buffer.from(relay.pools.get("preprod")!.held.at(-2)!.bytes).toString("hex");
    const wasm = loadTestWasm();
    bob.restart({
      ...wasm,
      messagingReceive: (key, request) => {
        if ((JSON.parse(request) as { envelope: string }).envelope === bad) throw new Error("not what the module expected");
        return wasm.messagingReceive(key, request);
      },
    });
    bob.passOverOk = true;
    bob.trace.length = 0;
    await synced(bob);
    expect((await texts(bob, cid)).slice(-2)).toEqual(["in:one", "in:three"]);
    expect(await cursorOf(bob)).toBe(lastHeld(relay));
    expect((await bob.messaging.overview("preprod")).dropped).toBeUndefined();
    // Not tried again: a throw of the module's is the envelope's own.
    expect(bob.trace.filter((s) => s === "receive")).toHaveLength(3);
    expect(bob.passedOver.map((e) => (e as Error).message)).toEqual(["not what the module expected"]);
  });
});
