// C3's stall (the 1.10.0 gate's round 5, ported from the verifiers'
// verify2-c3-full-stall, which reproduced it at 48480cf8): after one refused
// bookkeeping write, a wallet whose inbox was large stayed `full` (its take
// stalled) while one whose inbox was small took again at the next tick, and the
// stalled one's next worker read again from where its take stopped. Since
// round 5 the read record holds where the next read goes on from, a fixed
// write never refused for room and never `full` (fix item 4), `full` only
// pauses the take, and each take lets it go and tries again (fix item 7).
//
// Paired worlds: one relay, one pool, A (Alice) and B (Bob) served the same
// pages at the same cursors; W (Carol) writes. A holds strangers' requests at
// the crate's bound; B none. Each area 100,000 bytes above the reserve line,
// the rooms counted as taken. The same refusals, then a worker's restart: what
// each asks is the same, tick by tick, and A takes again at the next take.
import { describe, expect, it } from "vitest";

import { QUOTA_BYTES, RESERVE_BYTES } from "../src/background/messaging";
import { PRIVATE_PREFIX } from "../src/background/private-store";
import { ALICE_SEEDELF, cursorOf, type Party, PASSWORD, usedBytes } from "./messaging-harness";
import { expectLanesClean, junk, requestsOf, strangers, tick, world, type World, writing } from "./messaging-lanes-kit";

const FILLER = "seedelf.other.filler";

/** `p`'s area set `room` bytes above Messages' reserve line, the rooms it counts as taken counted (O5). */
async function roomAbove(p: Party, room: number): Promise<void> {
  p.local.data.delete(FILLER);
  const rooms = await (p.messaging as unknown as { roomsHeld(): Promise<number> }).roomsHeld();
  const fill = QUOTA_BYTES - RESERVE_BYTES - room - rooms - usedBytes(p);
  expect(fill).toBeGreaterThan(FILLER.length + 2);
  p.local.data.set(FILLER, JSON.stringify("x".repeat(fill - FILLER.length - 2)));
}

/** chrome.storage.local refusing `p`'s next write of `key`, once, as at its quota. */
function refuseWriteOnce(p: Party, key: string): { fired: boolean } {
  const state = { fired: false };
  const set = p.local.set.bind(p.local);
  p.local.set = async (k, value) => {
    if (!state.fired && k === key) {
      state.fired = true;
      throw new Error("QUOTA_BYTES quota exceeded");
    }
    return set(k, value);
  };
  return state;
}

let n = 0;
const junks = (x: World, count = 1) => {
  for (let i = 0; i < count; i++) x.relay.put("preprod", junk(n++));
};
const fullOf = async (p: Party) => (await p.messaging.overview("preprod")).full === true;

/** Both readers' ticks, A first: each's sync, its runner's work after it. */
async function ticks(x: World): Promise<void> {
  await tick(x.a);
  await x.a.messaging.whenIdle();
  await tick(x.b);
  await x.b.messaging.whenIdle();
}

/** A at the requests' bound and B with none; one envelope a page; each area 100 KB above the line, the rooms counted. */
async function staged(large = true): Promise<World> {
  const x = await world();
  if (large) await strangers(x, 8);
  x.relay.pageCount = 1;
  await roomAbove(x.a, 100_000);
  await roomAbove(x.b, 100_000);
  return x;
}

describe("C3: a refused write stalls no wallet, and the next worker asks what the other's asks (round 5; the verifiers' verify2-c3)", { timeout: 300_000 }, () => {
  it("the reported sequence: the write of where the read ended refused once for both; neither is `full`, and every worker after asks the same", async () => {
    const x = await staged();
    junks(x);
    await ticks(x);
    const [fa, fb] = [x.a.log.length, x.b.log.length];
    const ra = refuseWriteOnce(x.a, PRIVATE_PREFIX + "messagingRead.preprod");
    const rb = refuseWriteOnce(x.b, PRIVATE_PREFIX + "messagingRead.preprod");
    for (let k = 1; k <= 5; k++) {
      junks(x);
      await ticks(x);
      expect([await fullOf(x.a), await fullOf(x.b)]).toEqual([false, false]);
      expect(await cursorOf(x.a)).toBe(await cursorOf(x.b));
    }
    expect([ra.fired, rb.fired]).toEqual([true, true]);
    x.a.restart();
    x.b.restart();
    await ticks(x);
    await ticks(x);
    expect(requestsOf(x.a, fa)).toEqual(requestsOf(x.b, fb));
    expectLanesClean(x.a, fa);
  });

  it("A's take's own bookkeeping refused once: A is `full` until the next take, which takes again; what each asks is the same", async () => {
    const x = await staged();
    junks(x);
    await ticks(x);
    const [fa, fb] = [x.a.log.length, x.b.log.length];
    // W's first message to A: A's take writes the requests record, then the inbox's list of it, which the browser
    // refuses once: the take's own bookkeeping, so the take stops for room (W11).
    const refused = refuseWriteOnce(x.a, PRIVATE_PREFIX + "messaging.preprod");
    const cid = await writing(x, () => x.w.messaging.start("preprod", ALICE_SEEDELF, "one more"));
    await ticks(x);
    expect(refused.fired).toBe(true);
    const fullAfter = await fullOf(x.a);
    for (let k = 0; k < 3; k++) {
      junks(x);
      await ticks(x);
    }
    // The next take let `full` go, tried again, and set the list right from the record: the request is listed, and
    // nothing counted lost.
    expect(fullAfter).toBe(true);
    expect(await fullOf(x.a)).toBe(false);
    const overview = await x.a.messaging.overview("preprod");
    expect(overview.requests.map((r) => r.cid)).toContain(cid);
    expect(overview.dropped).toBeUndefined();
    x.a.restart();
    x.b.restart();
    await ticks(x);
    expect(requestsOf(x.a, fa)).toEqual(requestsOf(x.b, fb));
  });

  it("control: both inboxes small, the same refusal of the read record: the same, before and after the restart", async () => {
    const x = await staged(false);
    junks(x);
    await ticks(x);
    const [fa, fb] = [x.a.log.length, x.b.log.length];
    refuseWriteOnce(x.a, PRIVATE_PREFIX + "messagingRead.preprod");
    refuseWriteOnce(x.b, PRIVATE_PREFIX + "messagingRead.preprod");
    for (let k = 0; k < 3; k++) {
      junks(x);
      await ticks(x);
    }
    x.a.restart();
    x.b.restart();
    await ticks(x);
    expect(requestsOf(x.a, fa)).toEqual(requestsOf(x.b, fb));
  });

  it("a lock and an unlock, then the restart: the same", async () => {
    const x = await staged();
    junks(x);
    await ticks(x);
    const [fa, fb] = [x.a.log.length, x.b.log.length];
    refuseWriteOnce(x.a, PRIVATE_PREFIX + "messagingRead.preprod");
    refuseWriteOnce(x.b, PRIVATE_PREFIX + "messagingRead.preprod");
    junks(x);
    await ticks(x);
    for (const p of [x.a, x.b]) {
      await p.wallet.lock();
      await p.wallet.unlock(PASSWORD);
    }
    junks(x);
    await ticks(x);
    x.a.restart();
    x.b.restart();
    await ticks(x);
    expect(requestsOf(x.a, fa)).toEqual(requestsOf(x.b, fb));
    expect(await cursorOf(x.a)).toBe(await cursorOf(x.b));
  });

  it("the lag: six full reads of 16 pages after the refusal, then a restart: each worker asks one page a tick from where the last read ended", async () => {
    const x = await staged();
    junks(x);
    await ticks(x);
    refuseWriteOnce(x.a, PRIVATE_PREFIX + "messagingRead.preprod");
    refuseWriteOnce(x.b, PRIVATE_PREFIX + "messagingRead.preprod");
    for (let k = 0; k < 6; k++) {
      junks(x, 16);
      await ticks(x);
    }
    x.a.restart();
    x.b.restart();
    const [fa, fb] = [x.a.log.length, x.b.log.length];
    for (let k = 0; k < 3; k++) await ticks(x);
    const gets = requestsOf(x.a, fa).filter((r) => r.startsWith("GET "));
    expect(requestsOf(x.a, fa)).toEqual(requestsOf(x.b, fb));
    expect(gets).toHaveLength(3);
    expect(new Set(gets).size).toBe(1);
  });
});
