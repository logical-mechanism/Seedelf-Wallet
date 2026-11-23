// What a sync asks never depends on what it found (the 1.10.0 gate's W10).
// A read is at most PAGES_A_SYNC pages, whatever they hold: never fewer
// because the key's own envelopes filled them, and never one skipped because
// what earlier reads found is still being taken. The relay chooses what each
// page holds, and it can fill pages with envelopes sealed to any register it
// likes: had the read stopped once the key's envelopes passed a bound, the
// number of pages asked would have told it whether that register is this
// wallet's. These tests serve the same pages to a wallet whose scan finds
// itself in every envelope and to one whose scan finds none (the scan is the
// one step that looks at what an envelope holds), and compare what each asks.
import { describe, expect, it } from "vitest";

import type { Inbox } from "../src/background/messaging";
import { PAGES_A_SYNC } from "../src/background/relay";
import {
  BOB_SEEDELF,
  clock,
  type Directory,
  fakeRelay,
  type FakeRelay,
  loadTestWasm,
  pair,
  party,
  recordName,
  synced,
  talking,
  texts,
  turnOn,
  turns,
  type Wasm,
} from "./messaging-harness";

/** A 32 KiB envelope nobody's: eight fill a page (§17.5's 256 KiB). */
const bigJunk = (n: number) => "01" + n.toString(16).padStart(8, "0") + "6b".repeat(32768 - 5);

const gets = (relay: FakeRelay) => relay.calls.filter((c) => c.startsWith("GET "));

/**
 * WebAssembly whose scan finds the key's own envelopes as the real one does, and also every envelope `claims` says:
 * what a relay that fills pages with envelopes sealed to this wallet's registers gets from it.
 */
function claiming(claims: (envelope: string) => boolean): Wasm {
  const wasm = loadTestWasm();
  return {
    ...wasm,
    // The module's answer, a digit an envelope (W17), with a 1 wherever `claims` says.
    messagingScan: (key, envelopes) => {
      const batch = JSON.parse(envelopes) as string[];
      const bits = [...wasm.messagingScan(key, envelopes)];
      batch.forEach((e, i) => claims(e) && (bits[i] = "1"));
      return bits.join("");
    },
  };
}

// Each test bounded: one that fails mid-take fails here, never hangs the run.
describe("what a read asks (W10)", { timeout: 60_000 }, () => {
  it("is PAGES_A_SYNC pages: what the client's own limit lets through without a wait", () => {
    // The edge's messaging bucket, as the client paces it: 280 units in any 30 s, a page charged 17 (relay.ts).
    expect(PAGES_A_SYNC).toBe(Math.floor(280 / 17));
  });

  it("asks the same pages, and goes on from the same cursor, whether every envelope is the wallet's or none is (review A, scan-timing#2)", async () => {
    // 40 full pages, the same bytes for both readers; more follow after each but the last.
    const served = async (own: boolean) => {
      const relay = fakeRelay(clock);
      const directory: Directory = new Map();
      const reader = await party(24, relay, directory, BOB_SEEDELF);
      await turnOn(reader);
      for (let i = 0; i < 40 * 8; i++) relay.put("preprod", bigJunk(i));
      reader.restart(claiming(() => own));
      relay.calls.length = 0;
      const asked: string[][] = [];
      const cursors: Array<string | undefined> = [];
      for (let sync = 0; sync < 4; sync++) {
        const before = relay.calls.length;
        await synced(reader);
        asked.push(gets({ ...relay, calls: relay.calls.slice(before) }));
        cursors.push((await reader.store.get<Inbox>("messaging.preprod"))!.cursor);
      }
      return { asked, cursors };
    };
    const holder = await served(true);
    const bystander = await served(false);
    expect(holder.asked).toEqual(bystander.asked);
    expect(holder.cursors).toEqual(bystander.cursors);
    // Each sync PAGES_A_SYNC pages, on from where the last ended, until the pool's last page.
    expect(holder.asked.map((pages) => pages.length)).toEqual([PAGES_A_SYNC, PAGES_A_SYNC, 40 - 2 * PAGES_A_SYNC, 1]);
  });

  it("asks for pages at every tick while what an earlier read found is still being taken, three ticks on (redteam high 2)", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await synced(bob);
    await alice.messaging.send("preprod", cid, "one");
    await alice.messaging.whenIdle();
    // Behind "one", full pages of envelopes Bob's scan finds his: every read keeps a full batch.
    for (let i = 0; i < 5 * PAGES_A_SYNC * 8; i++) relay.put("preprod", bigJunk(i));
    bob.restart(claiming((e) => e.startsWith("01") && e.endsWith("6b6b6b6b")));
    // The take of "one" is held at its record's write: a take that spans the ticks below.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let holding = false;
    const record = await recordName(bob, cid);
    bob.beforeWrite = async (name) => {
      if (name !== record || holding) return;
      holding = true;
      await held;
    };
    const perTick: number[] = [];
    try {
      for (let tick = 0; tick < 4; tick++) {
        const before = gets(relay).length;
        // A tick: the alarm's, or a wallet page's poll. It ends with its read and its posts, never with the take.
        await bob.messaging.sync("preprod");
        await turns();
        perTick.push(gets(relay).length - before);
        expect(holding).toBe(true);
      }
    } finally {
      release();
    }
    await bob.messaging.whenIdle();
    bob.beforeWrite = undefined;
    expect(perTick).toEqual([PAGES_A_SYNC, PAGES_A_SYNC, PAGES_A_SYNC, PAGES_A_SYNC]);
    // Taken once the hold is gone, and the cursor past where the last tick asked: the next read goes on from it.
    expect((await texts(bob, cid)).at(-1)).toBe("in:one");
    await expectOnFromLast(relay, bob);
  });

  it("keeps asking at every tick when the takes fall more than four reads behind: the oldest waiting read's envelopes are dropped and counted (pushback on W10's wait)", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await synced(bob);
    await alice.messaging.send("preprod", cid, "one");
    await alice.messaging.whenIdle();
    for (let i = 0; i < 8 * PAGES_A_SYNC * 8; i++) relay.put("preprod", bigJunk(i));
    bob.restart(claiming((e) => e.startsWith("01") && e.endsWith("6b6b6b6b")));
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let holding = false;
    const record = await recordName(bob, cid);
    bob.beforeWrite = async (name) => {
      if (name !== record || holding) return;
      holding = true;
      await held;
    };
    const perTick: number[] = [];
    try {
      for (let tick = 0; tick < 7; tick++) {
        const before = gets(relay).length;
        await bob.messaging.sync("preprod");
        await turns();
        perTick.push(gets(relay).length - before);
      }
    } finally {
      release();
    }
    await bob.messaging.whenIdle();
    bob.beforeWrite = undefined;
    // Never a tick without its pages, however far behind the take is.
    expect(perTick).toEqual(Array<number>(7).fill(PAGES_A_SYNC));
    // The first read's "one" taken; the two oldest reads that waited past four, dropped unopened and counted.
    expect((await texts(bob, cid)).at(-1)).toBe("in:one");
    expect((await bob.messaging.overview("preprod")).dropped).toBe(2 * PAGES_A_SYNC * 8);
    // And the cursor where the last read ended: the next read goes on from there.
    await expectOnFromLast(relay, bob);
  });
});

/** The cursor kept is past where the last read asked from, and the next read asks from it. */
async function expectOnFromLast(relay: FakeRelay, p: Awaited<ReturnType<typeof pair>>["bob"]): Promise<void> {
  const lastAsked = BigInt(gets(relay).at(-1)!.split("?after=")[1]!);
  const cursor = (await p.store.get<Inbox>("messaging.preprod"))!.cursor!;
  expect(BigInt(cursor) > lastAsked).toBe(true);
  relay.calls.length = 0;
  await synced(p);
  expect(gets(relay)[0]).toBe(`GET /messaging/v1/preprod/envelopes?after=${cursor}`);
}
