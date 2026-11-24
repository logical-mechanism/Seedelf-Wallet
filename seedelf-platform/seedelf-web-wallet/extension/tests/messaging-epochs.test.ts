// A take under an older epoch takes and writes nothing more (the 1.10.0 gate's f1, W12, W13; round 4's review, #5:
// those checks were pinned by no test). Start Messages again (`clear`) moves the network's epoch at once, outside the
// queue, and deletes every record, again in each record's chain, so none outlives it. A take step already under way
// when it comes meets the epoch at its next look, and stops: no envelope opened or received, no record of Messages
// written again. Each case holds Bob's take at one of its writes, starts Messages again, and lets the take go on.
import { describe, expect, it } from "vitest";

import { PRIVATE_PREFIX } from "../src/background/private-store";
import { pair, type Party, synced, talking } from "./messaging-harness";

const turn = () => new Promise<void>((r) => setImmediate(r));
async function until(done: () => boolean, most = 5000): Promise<boolean> {
  for (let i = 0; i < most && !done(); i++) await turn();
  return done();
}

/** What `p` did after log entry `from`: WebAssembly's opens and receives, and every record written. */
const after = (p: Party, from: number) => p.log.slice(from).flatMap((e) => (e.what === "open" || e.what === "receive" ? [e.what] : e.what === "set" ? [`set ${e.name}`] : []));

/** Messages' records of `p`'s on preprod still in its area. */
const recordsLeft = (p: Party) =>
  [...p.local.data.keys()].filter((k) => k.startsWith(PRIVATE_PREFIX) && /^(messaging|conversation)[A-Za-z]*\.preprod/.test(k.slice(PRIVATE_PREFIX.length)));

/**
 * Bob with two of Alice's messages to take, his take held at the first write `hold` picks; the hold's release, and the
 * log's length as the take reached it.
 */
async function heldTake(hold: (name: string, value: unknown) => boolean) {
  const { relay, alice, bob } = await pair();
  const cid = await talking(alice, bob);
  await alice.messaging.send("preprod", cid, "one");
  await alice.messaging.send("preprod", cid, "two");
  await alice.messaging.whenIdle();
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const state = { holding: false };
  bob.beforeWrite = async (name, value) => {
    if (state.holding || !hold(name, value)) return;
    state.holding = true;
    await held;
  };
  void bob.messaging.sync("preprod");
  expect(await until(() => state.holding)).toBe(true);
  return { relay, alice, bob, cid, release };
}

/** The network's epoch, as the service holds it. */
const epochOf = (p: Party) => (p.messaging as unknown as { epochOf(n: string): number }).epochOf("preprod");

/**
 * Starts Bob's Messages again while his take is held (its epoch moves at once, outside the queue; its deletion comes in
 * the queue, after any step under way), then lets the take go on: what it did after the epoch moved, and what's left.
 */
async function clearedUnder(x: Awaited<ReturnType<typeof heldTake>>) {
  const was = epochOf(x.bob);
  const cleared = x.bob.messaging.clear("preprod");
  expect(await until(() => epochOf(x.bob) !== was)).toBe(true);
  const from = x.bob.log.length;
  x.release();
  await cleared;
  await x.bob.messaging.whenIdle();
  x.bob.beforeWrite = undefined;
  return { did: after(x.bob, from), left: recordsLeft(x.bob) };
}

describe("a take under an older epoch takes and writes nothing more (f1; round 4's review, #5)", { timeout: 60_000 }, () => {
  it("held at an envelope's mark, before its receive: Messages started again, nothing is opened or received, nothing written", async () => {
    const x = await heldTake((name, value) => name === "messagingTakeMark.preprod" && Object.keys(value as object).length > 0);
    const { did, left } = await clearedUnder(x);
    expect(did.filter((d) => d === "open" || d === "receive")).toEqual([]);
    expect(did.filter((d) => !d.startsWith("set messagingTakeMark"))).toEqual([]);
    // The mark the take was writing as it was held goes too, in its own chain: no record of Messages is left.
    expect(left).toEqual([]);
    // And the next sync reads from the pool's oldest into the new Messages.
    await synced(x.bob);
    expect((await x.bob.messaging.overview("preprod")).conversations).toEqual([]);
  });

  it("held at the read's end, its mark cleared: Messages started again, the take record isn't written again", async () => {
    const x = await heldTake((name, value) => name === "messagingTakeMark.preprod" && Object.keys(value as object).length === 0);
    const { did, left } = await clearedUnder(x);
    expect(did.filter((d) => !d.startsWith("set messagingTakeMark"))).toEqual([]);
    expect(left).toEqual([]);
  });

  it("held at the read's end with a message it had no room for: Messages started again, its count isn't written into a record that's gone", async () => {
    let refused = false;
    const x = await heldTake((name, value) => {
      // "one"'s record refused once by the browser: no room for its message (W11), counted as the read ends.
      if (!refused && name.startsWith("conversation.preprod.")) {
        refused = true;
        throw new Error("QUOTA_BYTES quota exceeded");
      }
      return name === "messagingTakeMark.preprod" && Object.keys(value as object).length === 0;
    });
    expect(refused).toBe(true);
    const { did, left } = await clearedUnder(x);
    expect(did.filter((d) => !d.startsWith("set messagingTakeMark"))).toEqual([]);
    expect(left).toEqual([]);
    expect((await x.bob.messaging.overview("preprod")).dropped).toBeUndefined();
  });

  it("held at a received message's record write: Messages started again, nothing after it is taken, the inbox not written again", async () => {
    let records = 0;
    const x = await heldTake((name) => name.startsWith("conversation.preprod.") && ++records === 1);
    const { did, left } = await clearedUnder(x);
    // The step under way ends as it began (its record, then the inbox that lists it): a step looks at the epoch as it
    // starts. Then Messages' deletion, behind it in the queue, deletes what it wrote, and no step after it takes "two".
    expect(did.filter((d) => d === "open" || d === "receive")).toEqual([]);
    expect(did.filter((d) => d.startsWith("set messagingTake."))).toEqual([]);
    expect(left).toEqual([]);
  });
});
