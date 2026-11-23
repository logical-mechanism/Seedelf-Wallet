// What isn't kept is counted once, by the write that makes it lost (the 1.10.0
// gate's f5, with its finding 8). A read's end is written as the read ends, so
// a read the backlog drops (more than TAKES_BEHIND reads waiting) is never
// read again: its envelopes are counted unopened in the same write of the take
// record that drops them, and a stop after it neither erases the count nor
// counts again. A message with no room (W11) is counted as its read's
// envelopes go from the record, so a read taken again after a stop counts each
// once, and one kept the second time not at all. The two counts are apart:
// unopened envelopes may be anyone's, and deleting a conversation doesn't make
// room for them.
//
// The layout: Alice's "one" and pages of 512-byte junk Bob's (stubbed) scan
// claims, eight to a page, so each read is PAGES_A_SYNC pages and 128 of Bob's
// envelopes, and five reads fit the take record; Alice's "two" is the first
// envelope of the second read (B1), the read the backlog drops at the sixth
// tick while the first read's take (B0) is held.
import { describe, expect, it } from "vitest";

import { PAGES_A_SYNC } from "../src/background/relay";
import {
  cursorOf,
  type FakeRelay,
  loadTestWasm,
  pair,
  PASSWORD,
  recordName,
  synced,
  takesOf,
  talking,
  texts,
  turns,
  type Wasm,
} from "./messaging-harness";

/** A 512-byte envelope nobody's, the smallest. */
const junk = (n: number) => "01" + n.toString(16).padStart(8, "0") + "6b".repeat(512 - 5);

/** WebAssembly whose scan finds the key's own envelopes as the real one does, and also every one `claims` says. */
function claiming(claims: (envelope: string) => boolean): Wasm {
  const wasm = loadTestWasm();
  return {
    ...wasm,
    messagingScan: (key, envelopes) => {
      const batch = JSON.parse(envelopes) as string[];
      const bits = [...wasm.messagingScan(key, envelopes)];
      batch.forEach((e, i) => claims(e) && (bits[i] = "1"));
      return bits.join("");
    },
  };
}

const PER_READ = PAGES_A_SYNC * 8;
const gets = (relay: FakeRelay) => relay.calls.filter((c) => c.startsWith("GET "));

/** Bob's pool: "one", then 127 junk (B0), "two" and 127 junk (B1), then four reads of 128 junk (B2 to B5). */
async function scenario() {
  const { relay, alice, bob } = await pair();
  const cid = await talking(alice, bob);
  await synced(bob);
  relay.pageCount = 8;
  await alice.messaging.send("preprod", cid, "one");
  await alice.messaging.whenIdle();
  let n = 0;
  for (let i = 0; i < PER_READ - 1; i++) relay.put("preprod", junk(n++));
  const pool = relay.pools.get("preprod")!;
  const twoAt = pool.next;
  await alice.messaging.send("preprod", cid, "two");
  await alice.messaging.whenIdle();
  expect(pool.next).toBe(twoAt + 1n);
  for (let i = 0; i < PER_READ * 5 - 1; i++) relay.put("preprod", junk(n++));
  const wasm = claiming((e) => e.startsWith("01") && e.endsWith("6b6b6b6b"));
  bob.restart(wasm);
  const record = await recordName(bob, cid);
  return { relay, alice, bob, cid, wasm, twoAt, pool, record };
}

/** A tick: the alarm's, or a wallet page's poll. */
async function tick(bob: Awaited<ReturnType<typeof scenario>>["bob"]) {
  await bob.messaging.sync("preprod");
  await turns();
}

/** A promise and its resolve. */
function gate() {
  let open!: () => void;
  const shut = new Promise<void>((r) => (open = r));
  return { open, shut };
}

describe("what isn't kept is counted once, by the write that makes it lost (the 1.10.0 gate's f5)", { timeout: 120_000 }, () => {
  it.each(["lock", "restart"] as const)(
    "(a) a stop (%s) in the first read's take after the backlog dropped a read: counted once, never read again, and what waits taken from the record",
    async (stop) => {
      const { relay, bob, cid, wasm, twoAt, pool, record } = await scenario();
      const takeHeld = gate();
      let holding = false;
      bob.beforeWrite = async (name) => {
        // The first read's take, held at "one"'s record: a take that spans the ticks below.
        if (name === record && !holding) {
          holding = true;
          await takeHeld.shut;
        }
      };
      // Six ticks while the first read's take is held: the sixth read takes the waiting reads past four, and the
      // backlog drops the oldest waiting one (B1, "two" in it), counting its 128 envelopes in the same write.
      for (let i = 0; i < 6; i++) await tick(bob);
      expect(holding).toBe(true);
      expect((await bob.messaging.overview("preprod")).droppedUnread).toBe(PER_READ);
      expect((await takesOf(bob))!.unopened).toBe(PER_READ);
      const end = await cursorOf(bob);
      expect(end).toBe(String(pool.next - 1n));
      // The stop, with "one"'s take under way: a lock of this worker, or a new worker over the same storage.
      if (stop === "lock") {
        await bob.wallet.lock();
        takeHeld.open();
        await bob.messaging.whenIdle();
        await bob.wallet.unlock(PASSWORD);
      } else {
        bob.restart(wasm);
        takeHeld.open();
      }
      bob.beforeWrite = undefined;
      relay.calls.length = 0;
      for (let i = 0; i < 3; i++) await synced(bob);
      // Nothing read again: every page asked goes on from where the last read ended.
      expect(gets(relay).every((c) => c === `GET /messaging/v1/preprod/envelopes?after=${end}`)).toBe(true);
      // What waited is taken from the record, "one" among it; the dropped read's "two" is gone, and counted once.
      expect(await texts(bob, cid)).toContain("in:one");
      expect(await texts(bob, cid)).not.toContain("in:two");
      expect(BigInt((await cursorOf(bob))!) > twoAt).toBe(true);
      const overview = await bob.messaging.overview("preprod");
      expect(overview.droppedUnread).toBe(PER_READ);
      expect(overview.dropped).toBeUndefined();
      expect((await takesOf(bob))!.batches).toEqual([]);
    },
  );

  it("(b) a read made while the first read's envelopes go from the take record waits for that write in the record's chain: nothing dropped, nothing counted", async () => {
    const { bob, cid, twoAt, record } = await scenario();
    const takeHeld = gate();
    const consumeHeld = gate();
    const consumeHolding = gate();
    let holding = false;
    let released = false;
    bob.beforeWrite = async (name, value) => {
      if (name === record && !holding) {
        holding = true;
        await takeHeld.shut;
        return;
      }
      // The take record written with B0 gone from it, once its take is let go: held, B1 to B4 still waiting in it.
      if (released && name === "messagingTake.preprod" && (value as { batches: unknown[] }).batches.length === 4) {
        released = false;
        consumeHolding.open();
        await consumeHeld.shut;
      }
    };
    // Five ticks: the read being taken and four waiting, none dropped yet.
    for (let i = 0; i < 5; i++) await tick(bob);
    expect(holding).toBe(true);
    expect((await bob.messaging.overview("preprod")).droppedUnread).toBeUndefined();
    released = true;
    takeHeld.open();
    await consumeHolding.shut;
    // The sixth tick, while that write is under way: its read's end waits for it, so B0 is gone before B5 comes.
    const sixth = bob.messaging.sync("preprod");
    await turns();
    consumeHeld.open();
    await sixth;
    await bob.messaging.whenIdle();
    bob.beforeWrite = undefined;
    expect({
      two: (await texts(bob, cid)).includes("in:two"),
      cursorPastTwo: BigInt((await cursorOf(bob))!) > twoAt,
      droppedUnread: (await bob.messaging.overview("preprod")).droppedUnread,
      unopened: (await takesOf(bob))!.unopened,
    }).toEqual({ two: true, cursorPastTwo: true, droppedUnread: undefined, unopened: undefined });
  });

  it("(c) a read taken again after its last write was refused counts its no-room envelope only as the take that drops it ends: one kept the second time isn't counted", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await synced(bob);
    await alice.messaging.send("preprod", cid, "one");
    await alice.messaging.whenIdle();
    const record = await recordName(bob, cid);
    let recordOnce = false;
    let takenOnce = false;
    bob.beforeWrite = (name, value) => {
      // "one"'s record refused once by the browser: no room for its message (W11).
      if (name === record && !recordOnce) {
        recordOnce = true;
        throw new Error("QUOTA_BYTES quota exceeded");
      }
      // Then the take record's write as the read's envelopes go from it, refused once: bookkeeping with no room.
      if (!takenOnce && name === "messagingTake.preprod" && (value as { batches: unknown[] }).batches.length === 0) {
        takenOnce = true;
        throw new Error("QUOTA_BYTES quota exceeded");
      }
    };
    await synced(bob);
    const first = await bob.messaging.overview("preprod");
    // The next tick, with room again: the same read taken again from the record, from its first envelope.
    await synced(bob);
    bob.beforeWrite = undefined;
    expect({
      first: { full: first.full, dropped: first.dropped },
      one: (await texts(bob, cid)).includes("in:one"),
      dropped: (await bob.messaging.overview("preprod")).dropped,
    }).toEqual({
      first: { full: true, dropped: undefined },
      // Kept the second time: nothing was lost, and nothing says it was.
      one: true,
      dropped: undefined,
    });
  });

  it("(control) the same drop with no stop: counted once, apart from what had no room", async () => {
    const { bob, cid, twoAt, record } = await scenario();
    const takeHeld = gate();
    let holding = false;
    bob.beforeWrite = async (name) => {
      if (name === record && !holding) {
        holding = true;
        await takeHeld.shut;
      }
    };
    for (let i = 0; i < 6; i++) await tick(bob);
    expect((await bob.messaging.overview("preprod")).droppedUnread).toBe(PER_READ);
    takeHeld.open();
    await bob.messaging.whenIdle();
    bob.beforeWrite = undefined;
    const overview = await bob.messaging.overview("preprod");
    expect({
      two: (await texts(bob, cid)).includes("in:two"),
      cursorPastTwo: BigInt((await cursorOf(bob))!) > twoAt,
      droppedUnread: overview.droppedUnread,
      dropped: overview.dropped,
      unopened: (await takesOf(bob))!.unopened,
    }).toEqual({ two: false, cursorPastTwo: true, droppedUnread: PER_READ, dropped: undefined, unopened: PER_READ });
  });
});
