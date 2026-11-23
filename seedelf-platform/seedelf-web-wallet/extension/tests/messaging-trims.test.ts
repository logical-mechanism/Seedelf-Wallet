// A write that would pass Messages' budget makes room first (W7: `makeRoom`
// plans which old messages go, and writes the other conversations' trimmed
// records), and only then is the record that needed the room written, or the
// inbox that lists it. The area's reserve (W11) is looked at with the plan's
// credit before any trim is written (the 1.10.0 gate's f3): a write it would
// refuse deletes nothing. What's left, and said in the docs: the browser can
// still refuse the write itself after the trims are made, as can a stop.
//
// Each case: Bob holds a long conversation with Alice (every message read, the
// largest record, which the plan trims first) and a short one with Carol; his
// budget is set just over what he holds, so a write that doubles Carol's
// record (or a new conversation's record) needs room, which the plan takes
// from Alice's.
import { describe, expect, it } from "vitest";

import { type Inbox, MessagingFull } from "../src/background/messaging";
import { PRIVATE_PREFIX } from "../src/background/private-store";
import {
  ALICE_SEEDELF,
  CAROL_SEEDELF,
  clock,
  cursorOf,
  type Directory,
  fakeRelay,
  fileOf,
  type Party,
  party,
  recordName,
  storedTotal,
  synced,
  talking,
  texts,
  turnOn,
  usedBytes,
} from "./messaging-harness";

const BOB_SEEDELF = "5eed0e1f00" + "626f62";
const FILLER = "seedelf.messaging-trims.walletRecords";

/** Bob with a long, read conversation with Alice (`old`) and a short one with Carol (`near`). */
async function setup() {
  const relay = fakeRelay(clock);
  const directory: Directory = new Map();
  const alice = await party(12, relay, directory, ALICE_SEEDELF);
  const bob = await party(24, relay, directory, BOB_SEEDELF);
  const carol = await party(15, relay, directory, CAROL_SEEDELF);
  await turnOn(alice, bob, carol);
  const old = await talking(alice, bob);
  for (let i = 0; i < 12; i++) await alice.messaging.send("preprod", old, `${i}:` + "x".repeat(3000));
  await alice.messaging.whenIdle();
  await synced(bob);
  // Every one of them read: the first a trim takes.
  await texts(bob, old);
  const near = await talking(carol, bob);
  return { relay, directory, alice, bob, carol, old, near };
}

/** A conversation of `p`'s as its record and its inbox entry hold it. */
async function snapshot(p: Party, cid: string) {
  const file = (await fileOf(p, cid))!;
  const meta = (await p.store.get<Inbox>("messaging.preprod"))!.conversations[cid]!;
  const sealed = (await p.local.get<{ data: string }>(PRIVATE_PREFIX + (await recordName(p, cid))))!.data.length;
  return { ids: file.history.map((e) => e.id), trimmed: file.trimmed, sealed, metaBytes: meta.bytes, unread: meta.unread };
}

/** Alice's conversation as Bob's restarted worker shows it after its first sync (the sweep sets the inbox from records). */
async function afterRestart(bob: Party, old: string) {
  bob.beforeWrite = undefined;
  bob.restart();
  await synced(bob);
  const thread = await bob.messaging.thread("preprod", old);
  return { trimmed: thread.trimmed, messages: thread.messages.length };
}

/**
 * Bob's Messages at their budget in an area whose reserve line is 256 KiB above what it holds, Carol's short message
 * taken (so the restarted worker has written its marks once, as a running one has). As the take of Carol's long message
 * first reads Bob's record of their conversation (the read's own write of what it found already made, finding 8), the
 * wallet's other records grow to take the area to `line`: so the reserve's look in `makeRoom` is what decides. Returns
 * what a measure of the same steps in an area with room gives: how much Bob's record of Carol's conversation grows by,
 * and what the trim of Alice's frees, as stored.
 */
async function atTheLine(line: (sizes: { growth: number; freed: number; limit: number }) => number) {
  // The same steps in an area with room: the numbers the filler is set from.
  const measured = await setup();
  measured.bob.restart(undefined, { budgetBytes: storedTotal(measured.bob) + 1024 });
  await measured.carol.messaging.send("preprod", measured.near, "ok");
  await measured.carol.messaging.whenIdle();
  await synced(measured.bob);
  const [nearBefore, oldBefore] = [await snapshot(measured.bob, measured.near), await snapshot(measured.bob, measured.old)];
  await measured.carol.messaging.send("preprod", measured.near, "z".repeat(6000));
  await measured.carol.messaging.whenIdle();
  await synced(measured.bob);
  const growth = (await snapshot(measured.bob, measured.near)).sealed - nearBefore.sealed;
  const freed = oldBefore.sealed - (await snapshot(measured.bob, measured.old)).sealed;
  expect(growth).toBeGreaterThan(0);
  expect(freed).toBeGreaterThan(growth);

  const world = await setup();
  const { bob, carol, near } = world;
  const quotaBytes = usedBytes(bob) + 512 * 1024;
  const reserveBytes = 256 * 1024;
  bob.restart(undefined, { budgetBytes: storedTotal(bob) + 1024, quotaBytes, reserveBytes });
  await carol.messaging.send("preprod", near, "ok");
  await carol.messaging.whenIdle();
  await synced(bob);
  expect((await texts(bob, near)).at(-1)).toBe("in:ok");
  const limit = quotaBytes - reserveBytes;
  const target = line({ growth, freed, limit });
  // At the take's first read of the record: the other records written straight into the area, as another of the
  // wallet's writes would have them.
  const key = PRIVATE_PREFIX + (await recordName(bob, near));
  const get = bob.local.get.bind(bob.local);
  const at = { filled: -1 };
  bob.local.get = (async (k: string) => {
    if (k === key && at.filled < 0 && bob.trace.lastIndexOf("open") > bob.trace.lastIndexOf("receive")) {
      bob.local.data.delete(FILLER);
      bob.local.data.set(FILLER, JSON.stringify("w".repeat(target - usedBytes(bob) - FILLER.length - 2)));
      at.filled = usedBytes(bob);
    }
    return get(k);
  }) as typeof bob.local.get;
  return { ...world, growth, freed, limit, target, at };
}

// Each test bounded: one that fails mid-take fails here, never hangs the run.
describe("a write that needs room is made only where the area's reserve holds it with that room (the 1.10.0 gate's f3)", { timeout: 60_000 }, () => {
  it("control: the same received message, with room in the area, is kept, and the room comes from Alice's conversation", async () => {
    const { bob, carol, old, near } = await setup();
    bob.restart(undefined, { budgetBytes: storedTotal(bob) + 1024 });
    const before = await snapshot(bob, old);
    await carol.messaging.send("preprod", near, "z".repeat(6000));
    await carol.messaging.whenIdle();
    await synced(bob);
    expect((await texts(bob, near)).at(-1)).toBe("in:" + "z".repeat(6000));
    // The plan's room: Alice's oldest messages. So in the cases below a trim of hers is what the plan makes.
    const after = await snapshot(bob, old);
    expect(after.trimmed).toBeGreaterThan(0);
    expect(after.ids.length).toBeLessThan(before.ids.length);
  });

  it("a received message the area's reserve refuses deletes nothing of another conversation (W11's reserve after W7's trim)", async () => {
    const { bob, carol, old, near } = await setup();
    // Bob's Messages at its budget, and an area whose reserve line is 256 KiB above what it holds now.
    const used = usedBytes(bob);
    const quotaBytes = used + 512 * 1024;
    const reserveBytes = 256 * 1024;
    bob.restart(undefined, { budgetBytes: storedTotal(bob) + 1024, quotaBytes, reserveBytes });
    // A short message first, within the reserve, so the restarted worker has written its marks once, as a worker that
    // has been running has: their later writes don't grow the area.
    await carol.messaging.send("preprod", near, "ok");
    await carol.messaging.whenIdle();
    await synced(bob);
    expect((await texts(bob, near)).at(-1)).toBe("in:ok");
    const before = await snapshot(bob, old);
    const nearBefore = await snapshot(bob, near);
    expect(before.trimmed).toBe(0);
    // Then the wallet's own records grow (its history, its coins, the contract view: nothing of Messages'), taking the
    // area past its reserve line. Every write of Messages that grows storage is refused from here.
    const line = quotaBytes - reserveBytes;
    await bob.local.set(FILLER, "w".repeat(line - usedBytes(bob) + 128 * 1024));
    // Carol's long message: the area so far past the line that the read's own write of what it found has no room
    // (finding 8), before any take; the next two cases have the reserve decide at makeRoom's look.
    await carol.messaging.send("preprod", near, "z".repeat(6000));
    await carol.messaging.whenIdle();
    await synced(bob);
    // Refused, and counted (W11).
    expect((await bob.messaging.overview("preprod")).dropped).toBe(1);
    expect((await snapshot(bob, near)).ids).toEqual(nearBefore.ids);
    // Nothing of Alice's conversation goes for a write that wasn't made.
    const now = await snapshot(bob, old);
    expect(now.ids).toEqual(before.ids);
    expect(now.trimmed).toBe(0);
    // And what the inbox says of it is what its record holds.
    expect(Math.abs(now.metaBytes - now.sealed)).toBeLessThanOrEqual(4);
    // A restarted worker's first sync (the sweep) brings nothing back that was deleted.
    await bob.local.remove(FILLER);
    expect(await afterRestart(bob, old)).toEqual({ trimmed: 0, messages: before.ids.length });
  });

  it("makes a write the reserve holds only with the room the trims free: the message kept, and the room taken from Alice's", async () => {
    // The area as the write comes: past what the record's growth leaves room for, within it with what the trim frees.
    const { bob, carol, near, old, growth, limit, target, at } = await atTheLine(({ growth, freed, limit }) => limit - growth + Math.floor(freed / 2));
    expect(target + growth).toBeGreaterThan(limit);
    const before = await snapshot(bob, old);
    await carol.messaging.send("preprod", near, "z".repeat(6000));
    await carol.messaging.whenIdle();
    await synced(bob);
    expect(at.filled).toBe(target);
    expect((await texts(bob, near)).at(-1)).toBe("in:" + "z".repeat(6000));
    expect((await bob.messaging.overview("preprod")).dropped).toBeUndefined();
    const now = await snapshot(bob, old);
    expect(now.trimmed).toBeGreaterThan(0);
    expect(now.ids.length).toBeLessThan(before.ids.length);
    expect(usedBytes(bob)).toBeLessThanOrEqual(limit);
  });

  it("deletes nothing where the reserve can't hold the write even with the room the trims free: refused, counted, and the cursor goes past it", async () => {
    const { relay, bob, carol, near, old, limit, target, at } = await atTheLine(({ growth, freed, limit }) => limit - growth + freed + 2048);
    const before = await snapshot(bob, old);
    const nearBefore = await snapshot(bob, near);
    await carol.messaging.send("preprod", near, "z".repeat(6000));
    await carol.messaging.whenIdle();
    await synced(bob);
    // The read's own write was made: what the reserve refused is the take's, at makeRoom's look.
    expect(at.filled).toBe(target);
    expect((await bob.messaging.overview("preprod")).dropped).toBe(1);
    expect((await snapshot(bob, near)).ids).toEqual(nearBefore.ids);
    const now = await snapshot(bob, old);
    expect(now.ids).toEqual(before.ids);
    expect(now.trimmed).toBe(0);
    expect(Math.abs(now.metaBytes - now.sealed)).toBeLessThanOrEqual(4);
    // The cursor went past it, as for any other's (W11): never held for it.
    expect(await cursorOf(bob)).toBe(relay.pools.get("preprod")!.held.at(-1)!.number.toString());
    expect(usedBytes(bob)).toBeGreaterThan(limit);
  });

  // The gap the docs state (architecture.md, writeFile's comment): the browser refusing the write itself, after the trims
  // the room needed were made, leaves them made: the oldest read messages, which the budget deletes next anyway. These
  // two record it, and fail as long as it stands (`it.fails`): the complete fix, trims last, is for after 1.10.0.
  it.fails("leaves the trims made where the browser refuses a send's record after them (the gap the docs state)", async () => {
    const { bob, old, near } = await setup();
    bob.restart(undefined, { budgetBytes: storedTotal(bob) + 1024 });
    const before = await snapshot(bob, old);
    // The browser refuses Bob's record of his conversation with Carol, once (chrome.storage.local.set rejecting, "quota or
    // otherwise"): every other write goes through.
    const nearRecord = await recordName(bob, near);
    let refused = 0;
    bob.beforeWrite = (name) => {
      if (name === nearRecord && refused++ === 0) throw new Error("IO error: the browser refused the write");
    };
    await expect(bob.messaging.send("preprod", near, "y".repeat(6000))).rejects.toBeInstanceOf(MessagingFull);
    bob.beforeWrite = undefined;
    expect(refused).toBe(1);
    // The send was refused, and wrote nothing of its own.
    expect((await texts(bob, near)).some((t) => t.startsWith("out:yyy"))).toBe(false);
    const now = await snapshot(bob, old);
    expect.soft(now.ids).toEqual(before.ids);
    expect.soft(now.trimmed).toBe(0);
    expect.soft(Math.abs(now.metaBytes - now.sealed)).toBeLessThanOrEqual(4);
    expect.soft(await afterRestart(bob, old)).toEqual({ trimmed: 0, messages: before.ids.length });
  });

  it.fails("leaves the trims made where the browser refuses the inbox that would list a conversation started (the gap the docs state)", async () => {
    const { bob, old } = await setup();
    bob.restart(undefined, { budgetBytes: storedTotal(bob) + 1024 });
    const before = await snapshot(bob, old);
    const conversations = Object.keys((await bob.store.get<Inbox>("messaging.preprod"))!.conversations).sort();
    // The new conversation's record is written (its room taken from Alice's); then the browser refuses the inbox that
    // would list it, once.
    let refused = 0;
    bob.beforeWrite = (name) => {
      if (name === "messaging.preprod" && refused++ === 0) throw new Error("IO error: the browser refused the write");
    };
    await expect(bob.messaging.start("preprod", CAROL_SEEDELF, "s".repeat(6000))).rejects.toBeInstanceOf(MessagingFull);
    bob.beforeWrite = undefined;
    expect(refused).toBe(1);
    // Nothing started: the inbox lists the same conversations.
    expect(Object.keys((await bob.store.get<Inbox>("messaging.preprod"))!.conversations).sort()).toEqual(conversations);
    const now = await snapshot(bob, old);
    expect.soft(now.ids).toEqual(before.ids);
    expect.soft(now.trimmed).toBe(0);
    expect.soft(Math.abs(now.metaBytes - now.sealed)).toBeLessThanOrEqual(4);
    expect.soft(await afterRestart(bob, old)).toEqual({ trimmed: 0, messages: before.ids.length });
  });
});
