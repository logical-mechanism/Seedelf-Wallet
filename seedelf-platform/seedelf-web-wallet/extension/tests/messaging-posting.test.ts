// Posting in the worker (the 1.10.0 gate's W5): what a price, a wait and a
// refusal from the relay make the wallet do. A price past the relay's own
// ceiling is never solved; work already solved isn't done again; a wait for
// one envelope size holds that size alone; a message the server refused
// keeps its bytes, so it can be sent again.
import { describe, expect, it } from "vitest";

import type { Inbox } from "../src/background/messaging";
import {
  ALICE_SEEDELF,
  BOB_SEEDELF,
  busyFor,
  clock,
  type Directory,
  fakeRelay,
  fileOf,
  loadTestWasm,
  pair,
  type Party,
  party,
  synced,
  talking,
  texts,
  turnOn,
  turns,
  type Wasm,
} from "./messaging-harness";

/**
 * The client's ceiling, written out: the guards below hold even where the module's constant were missing. 26 bits,
 * the relay's 24 and room for a later relay's dearer prices (the 1.10.0 gate's W15).
 */
const CEILING = 26;

/**
 * WebAssembly that notes the price of each search for a stamp, once a search: its slices after the first go on from
 * where the last ended. `fake` answers a price instead of solving it.
 */
function counting(asked: number[], fake?: (bits: number) => string | undefined): Wasm {
  const wasm = loadTestWasm();
  let last = { key: "", from: -1 };
  return {
    ...wasm,
    messagingFindStamp: (request) => {
      const { digest, bits, from } = JSON.parse(request) as { digest: string; bits: number; from: number };
      const key = `${digest}:${bits}`;
      if (key !== last.key || from <= last.from) asked.push(bits);
      last = { key, from };
      return fake?.(bits) ?? wasm.messagingFindStamp(request);
    },
  };
}

const lastOf = async (p: Party, cid: string) => (await p.messaging.thread("preprod", cid)).messages.at(-1)!;

/** `wasm`, its `messagingConstants` changed as `change` says: another build's numbers. */
function withConstants(wasm: Wasm, change: (constants: Record<string, unknown>) => Record<string, unknown>): Wasm {
  const real = loadTestWasm();
  return { ...wasm, messagingConstants: () => JSON.stringify(change(JSON.parse(real.messagingConstants()) as Record<string, unknown>)) };
}

describe("a post's price (worker-net#4)", { timeout: 30_000 }, () => {
  it("has the client's ceiling at 26 bits, the bindings' own (W15, W17)", () => {
    expect((JSON.parse(loadTestWasm().messagingConstants()) as { priceCeilingBits: number }).priceCeilingBits).toBe(CEILING);
  });

  it("takes its ceiling from the bindings, never a copy of its own: a module that gives a lower one waits at a price under 26 (W17)", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    relay.price = 9;
    const asked: number[] = [];
    alice.restart(withConstants(counting(asked), (c) => ({ ...c, priceCeilingBits: 8 })));
    await synced(alice);
    relay.calls.length = 0;
    await alice.messaging.send("preprod", cid, "past this module's ceiling");
    await alice.messaging.whenIdle();
    expect(asked).toEqual([]);
    expect(relay.calls.filter((c) => c.startsWith("POST"))).toEqual([]);
    const thread = await alice.messaging.thread("preprod", cid);
    expect(thread.messages.at(-1)!.sent).toBe("pending");
    expect(thread.nextTry).toBe(clock.now + 60_000);
  });

  it("solves and posts nothing with a module that gives no ceiling: another build's, whose ceiling isn't guessed (W17)", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    const asked: number[] = [];
    alice.restart(withConstants(counting(asked), ({ priceCeilingBits: _none, ...rest }) => rest));
    relay.calls.length = 0;
    await alice.messaging.send("preprod", cid, "no ceiling, no work");
    await alice.messaging.whenIdle();
    expect(asked).toEqual([]);
    expect(relay.calls.filter((c) => c.startsWith("POST"))).toEqual([]);
    expect((await lastOf(alice, cid)).sent).toBe("pending");
  });

  it("waits as long as a 402 past the ceiling says, never working for it (W17)", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    const real = relay.fetch;
    relay.fetch = async (url, init) =>
      init.method === "POST"
        ? new Response(JSON.stringify({ error: "more proof of work", price: 27 }), { status: 402, headers: { "retry-after": "120" } })
        : real(url, init);
    const asked: number[] = [];
    alice.restart(counting(asked, (bits) => (bits > CEILING ? JSON.stringify({ nonce: 0 }) : undefined)));
    await synced(alice);
    await alice.messaging.send("preprod", cid, "27 bits?");
    await alice.messaging.whenIdle();
    expect(asked.filter((bits) => bits > CEILING)).toEqual([]);
    const thread = await alice.messaging.thread("preprod", cid);
    expect(thread.messages.at(-1)!.sent).toBe("pending");
    expect(thread.nextTry).toBe(clock.now + 120_000);
  });

  it("is never solved past the relay's ceiling: a page that prices a size above it waits instead", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    // A relay that isn't §17's: every size at 30 bits, an hour of one core each.
    relay.prices = [30, 30, 30, 30];
    const asked: number[] = [];
    // Were a price above the ceiling ever solved here, it's answered at once, not worked for.
    alice.restart(counting(asked, (bits) => (bits > CEILING ? JSON.stringify({ nonce: 0 }) : undefined)));
    await synced(alice);
    relay.calls.length = 0;
    await alice.messaging.send("preprod", cid, "not at that price");
    await alice.messaging.whenIdle();
    expect(asked.filter((bits) => bits > CEILING)).toEqual([]);
    expect(relay.calls.filter((c) => c.startsWith("POST"))).toEqual([]);
    const thread = await alice.messaging.thread("preprod", cid);
    expect(thread.messages.at(-1)!.sent).toBe("pending");
    // It waits a minute for a page to price it again.
    expect(thread.nextTry).toBe(clock.now + 60_000);
    expect(thread.messages.at(-1)!.nextTry).toBe(clock.now + 60_000);
    // An honest price again: the next sync's page says so, and it goes.
    relay.prices = undefined;
    clock.now += 61_000;
    await alice.wallet.touch();
    await synced(alice);
    expect((await lastOf(alice, cid)).sent).toBe("posted");
  });

  it("is never solved past the ceiling when a 402 names it, either", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    const real = relay.fetch;
    relay.fetch = async (url, init) =>
      init.method === "POST"
        ? new Response(JSON.stringify({ error: "more proof of work", price: 32 }), { status: 402 })
        : real(url, init);
    const asked: number[] = [];
    alice.restart(counting(asked, (bits) => (bits > CEILING ? JSON.stringify({ nonce: 0 }) : undefined)));
    await synced(alice);
    await alice.messaging.send("preprod", cid, "32 bits?");
    await alice.messaging.whenIdle();
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.filter((bits) => bits > CEILING)).toEqual([]);
    const thread = await alice.messaging.thread("preprod", cid);
    expect(thread.messages.at(-1)!.sent).toBe("pending");
    expect(thread.nextTry).toBe(clock.now + 60_000);
  });

  it("isn't worked for twice: a stamp solved while the relay can't be reached is kept for the next try", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    relay.price = 9;
    const asked: number[] = [];
    alice.restart(counting(asked));
    await synced(alice);
    // The page read, the post's connection lost.
    const real = relay.fetch;
    relay.fetch = async (url, init) => {
      if (init.method === "POST") throw new TypeError("Failed to fetch");
      return real(url, init);
    };
    await alice.messaging.send("preprod", cid, "worked for once");
    await alice.messaging.whenIdle();
    expect(asked).toEqual([9]);
    expect((await lastOf(alice, cid)).sent).toBe("pending");
    // Two more syncs with the post still failing: nothing is solved again.
    await synced(alice);
    await synced(alice);
    expect(asked).toEqual([9]);
    relay.fetch = real;
    await synced(alice);
    expect(asked).toEqual([9]);
    expect((await lastOf(alice, cid)).sent).toBe("posted");
    // A dearer price is worked for, from where the last search ended.
    relay.price = 11;
    relay.fetch = async (url, init) => {
      if (init.method === "POST") throw new TypeError("Failed to fetch");
      return real(url, init);
    };
    await alice.messaging.send("preprod", cid, "dearer");
    await alice.messaging.whenIdle();
    // The relay names 12 bits for the post whatever the work kept (a nonce kept for 9 has 12 one time in 8, so a price
    // the relay checked itself would make this test pass by luck that often).
    let priced = false;
    relay.fetch = async (url, init) => {
      if (init.method === "POST" && !priced) {
        priced = true;
        return new Response(JSON.stringify({ error: "more proof of work", price: 12 }), { status: 402 });
      }
      return real(url, init);
    };
    relay.price = 12;
    await alice.messaging.post("preprod");
    await alice.messaging.whenIdle();
    expect(priced).toBe(true);
    expect(asked).toEqual([9, 9, 12]);
    expect((await lastOf(alice, cid)).sent).toBe("posted");
  });
});

describe("a wait the relay asks for (worker-net#7, tests-ci#3)", { timeout: 30_000 }, () => {
  it("holds the size it was for, and no other: a long message refused for 36 hours never holds a short one", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    // The address's window has no room for a 2 KiB envelope, and room for a short one: the page says [4, 0, 4, 4].
    relay.refusingSizes = { 2048: 36 * 3600 };
    await synced(alice);
    relay.calls.length = 0;
    await alice.messaging.send("preprod", cid, "L".repeat(400));
    await alice.messaging.whenIdle();
    await alice.messaging.send("preprod", cid, "short");
    await alice.messaging.whenIdle();
    let thread = await alice.messaging.thread("preprod", cid);
    expect(thread.messages.slice(-2).map((m) => m.sent)).toEqual(["pending", "posted"]);
    // The long one asked once, with no work, and counts down to the relay's own time; the short one doesn't.
    expect(thread.messages.at(-2)!.nextTry).toBe(clock.now + 36 * 3600_000);
    expect(thread.messages.at(-1)!.nextTry).toBeUndefined();
    expect(thread.nextTry).toBe(clock.now + 36 * 3600_000);
    // In another conversation too, and at later syncs, without the long one asked again.
    const other = await alice.messaging.start("preprod", BOB_SEEDELF, "second conversation, 2 KiB itself");
    await alice.messaging.whenIdle();
    await alice.messaging.send("preprod", cid, "short again");
    await alice.messaging.whenIdle();
    await synced(alice);
    thread = await alice.messaging.thread("preprod", cid);
    expect(thread.messages.at(-1)!.sent).toBe("posted");
    // A first message is a 2 KiB envelope: it waits with the long one.
    expect((await alice.messaging.thread("preprod", other)).messages[0]!.sent).toBe("pending");
    expect(relay.calls.filter((c) => c.startsWith("POST"))).toHaveLength(3);
    // Room again: both go.
    relay.refusingSizes = undefined;
    await busyFor(36 * 3600_000 + 1000, alice);
    await synced(alice);
    expect((await alice.messaging.thread("preprod", cid)).messages.at(-3)!.sent).toBe("posted");
    expect((await alice.messaging.thread("preprod", other)).messages[0]!.sent).toBe("posted");
  });

  it("holds every size when it's the server's own (a 503): nothing is asked again before its time", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    relay.waitOnce = 503;
    await alice.messaging.send("preprod", cid, "L".repeat(400));
    await alice.messaging.whenIdle();
    relay.calls.length = 0;
    await alice.messaging.send("preprod", cid, "short");
    await alice.messaging.whenIdle();
    await synced(alice);
    expect(relay.calls.filter((c) => c.startsWith("POST"))).toEqual([]);
    const thread = await alice.messaging.thread("preprod", cid);
    expect(thread.messages.slice(-2).map((m) => m.sent)).toEqual(["pending", "pending"]);
    expect(thread.messages.slice(-2).map((m) => m.nextTry)).toEqual([clock.now + 30_000, clock.now + 30_000]);
    clock.now += 31_000;
    await synced(alice);
    expect((await alice.messaging.thread("preprod", cid)).messages.slice(-2).map((m) => m.sent)).toEqual(["posted", "posted"]);
  });
});

describe("a message the server refused (worker-net#8)", { timeout: 30_000 }, () => {
  it("keeps its bytes, says it can be sent again, and posts the same bytes when asked", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    // A proxy on the way that caps uploads: a 413 for this post, whatever the relay would say.
    const real = relay.fetch;
    let refuse = 1;
    relay.fetch = async (url, init) => (init.method === "POST" && refuse-- > 0 ? new Response("too big", { status: 413 }) : real(url, init));
    await alice.messaging.send("preprod", cid, "refused once");
    await alice.messaging.whenIdle();
    let sent = await lastOf(alice, cid);
    expect(sent).toMatchObject({ text: "refused once", sent: "refused", resend: true });
    const record = async () => (await fileOf(alice, cid))!.history.at(-1)!;
    const envelope = (await record()).envelope;
    expect(envelope).toMatch(/^01[0-9a-f]+$/);
    // Not counted as waiting, and no sync posts it by itself.
    expect((await alice.store.get<Inbox>("messaging.preprod"))!.conversations[cid]!.outbox).toBe(0);
    relay.calls.length = 0;
    await synced(alice);
    expect(relay.calls.filter((c) => c.startsWith("POST"))).toEqual([]);

    await alice.messaging.resend("preprod", cid, sent.id);
    await alice.messaging.whenIdle();
    sent = await lastOf(alice, cid);
    expect(sent).toMatchObject({ text: "refused once", sent: "posted" });
    expect(sent.resend).toBeUndefined();
    expect((await record()).envelope).toBeUndefined();
    // The bytes the ratchet sealed the first time: Bob reads it, once.
    expect(relay.pools.get("preprod")!.held.some((h) => Buffer.from(h.bytes).toString("hex") === envelope)).toBe(true);
    await synced(bob);
    expect((await texts(bob, cid)).filter((m) => m === "in:refused once")).toHaveLength(1);
    // Only a refused message with its bytes goes again: asked for one already posted (a stale screen), nothing happens.
    relay.calls.length = 0;
    await alice.messaging.resend("preprod", cid, sent.id);
    await alice.messaging.whenIdle();
    expect(relay.calls.filter((c) => c.startsWith("POST"))).toEqual([]);
    expect((await lastOf(alice, cid)).sent).toBe("posted");
  });

  it("offers nothing for one the wallet itself couldn't seal: it has no bytes to send", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    const wasm = loadTestWasm();
    alice.restart({ ...wasm, messagingSend: () => JSON.stringify({ refused: "chain_exhausted" }) });
    await alice.messaging.send("preprod", cid, "unsealed");
    await alice.messaging.whenIdle();
    const sent = await lastOf(alice, cid);
    expect(sent.sent).toBe("refused");
    expect(sent.resend).toBeUndefined();
    relay.calls.length = 0;
    await alice.messaging.resend("preprod", cid, sent.id);
    await alice.messaging.whenIdle();
    expect(relay.calls).toEqual([]);
    expect((await lastOf(alice, cid)).sent).toBe("refused");
  });
});

describe("a queued text the crate refuses as the stamp is set (review E)", { timeout: 30_000 }, () => {
  /**
   * Alice writes first to Bob, then two texts more while the stamp is solved: queued. `seal` answers each text's seal
   * instead of the module, where it says.
   */
  async function queued(seal: (text: string) => string | undefined) {
    const { relay, alice, bob } = await pair();
    const wasm = loadTestWasm();
    let first = true;
    alice.restart({
      ...wasm,
      // The stamp's first slice comes back empty: a turn of the event loop to write in while it's solved.
      messagingFindStamp: (request) => {
        if ((JSON.parse(request) as { from: number }).from === 0 && first) {
          first = false;
          return JSON.stringify({ nonce: null });
        }
        return wasm.messagingFindStamp(request);
      },
      messagingSend: (request) => {
        const { plaintext } = JSON.parse(request) as { plaintext: string };
        const text = Buffer.from(plaintext.slice(2), "hex").toString("utf8");
        return seal(text) ?? wasm.messagingSend(request);
      },
    });
    let cid = "";
    let wrote = false;
    alice.onWait = async () => {
      if (wrote || !cid) return;
      wrote = true;
      await alice.messaging.send("preprod", cid, "second");
      await alice.messaging.send("preprod", cid, "third");
    };
    cid = await alice.messaging.start("preprod", BOB_SEEDELF, "first");
    await alice.messaging.whenIdle();
    alice.onWait = undefined;
    expect(wrote).toBe(true);
    return { relay, alice, bob, cid };
  }

  it("leaves it and every text after it queued when the writer's own share is used up: never the server's refusal", async () => {
    const { alice, cid } = await queued((text) => (text === "second" ? JSON.stringify({ refused: "request_full" }) : undefined));
    const messages = (await alice.messaging.thread("preprod", cid)).messages;
    expect(messages.map((m) => [m.text, m.sent])).toEqual([
      ["first", "posted"],
      ["second", "queued"],
      ["third", "queued"],
    ]);
    expect(messages.some((m) => m.refusedBy !== undefined || m.resend)).toBe(false);
  });

  it("marks one it refuses for anything else as the wallet's refusal, with no bytes, and seals the rest", async () => {
    const { alice, cid } = await queued((text) => (text === "second" ? JSON.stringify({ refused: "chain_exhausted" }) : undefined));
    const messages = (await alice.messaging.thread("preprod", cid)).messages;
    expect(messages.map((m) => [m.text, m.sent])).toEqual([
      ["first", "posted"],
      ["second", "refused"],
      ["third", "posted"],
    ]);
    expect(messages[1]).toMatchObject({ refusedBy: "wallet" });
    expect(messages[1]!.resend).toBeUndefined();
  });

  it("says a refusal is the server's where it is: a 400 or a 413 keeps the bytes to send again", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    const real = relay.fetch;
    let refuse = 1;
    relay.fetch = async (url, init) => (init.method === "POST" && refuse-- > 0 ? new Response("bad", { status: 400 }) : real(url, init));
    await alice.messaging.send("preprod", cid, "refused by the server");
    await alice.messaging.whenIdle();
    expect(await lastOf(alice, cid)).toMatchObject({ sent: "refused", refusedBy: "server", resend: true });
  });
});

describe("what a page says beside its envelopes", { timeout: 30_000 }, () => {
  it("tells of no loss on a first read: a gap flag with no cursor of the wallet's own means nothing (relay-server#7)", async () => {
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const alice = await party(12, relay, directory, ALICE_SEEDELF);
    // A pool of three envelopes, nobody's, one a page: the first read is three pages, the last two asked with cursors
    // that read gave out, none the wallet held before.
    for (let i = 0; i < 3; i++) relay.put("preprod", "01" + i.toString(16).padStart(2, "0") + "00".repeat(510));
    relay.pageCount = 1;
    // Every page flags a gap, the first too.
    const real = relay.fetch;
    relay.fetch = async (url, init) => {
      const answer = await real(url, init);
      if (init.method !== "GET") return answer;
      const page = new Uint8Array(await answer.arrayBuffer());
      page[1]! |= 2;
      return new Response(page, { status: 200 });
    };
    await turnOn(alice);
    expect((await alice.messaging.overview("preprod")).gapAt).toBeUndefined();
    // With a cursor of its own, the flag is a loss, and it's said.
    await synced(alice);
    expect((await alice.messaging.overview("preprod")).gapAt).toBe(clock.now);
  });
});

describe("what a thread says of work under way (worker-net#14)", { timeout: 30_000 }, () => {
  it("keeps a post's 'about N s' while a sync comes and goes: a stamp with nothing to solve takes nothing away", async () => {
    const { relay, alice, bob } = await pair();
    // Alice wrote first: her conversation is one a sync looks at for a first-contact stamp still to solve.
    const cid = await talking(alice, bob);
    const wasm = loadTestWasm();
    // The post's stamp takes a dozen slices, so there are turns of the event loop to look in.
    alice.restart({
      ...wasm,
      messagingFindStamp: (request) =>
        (JSON.parse(request) as { from: number }).from < 12 * 65536 ? JSON.stringify({ nonce: null }) : wasm.messagingFindStamp(request),
    });
    relay.price = 9;
    await synced(alice);
    const seen: boolean[] = [];
    let waits = 0;
    const working = async () => (await alice.messaging.thread("preprod", cid)).messages.some((m) => m.working);
    alice.onWait = async () => {
      waits++;
      if (waits === 1) seen.push(await working());
      // The 10-second poll's sync, while the stamp is solved: it comes and goes, and the thread is read again.
      if (waits === 2) {
        void alice.messaging.sync("preprod").catch(() => undefined);
        await turns(5);
        seen.push(await working());
      }
    };
    await alice.messaging.send("preprod", cid, "worked for");
    await alice.messaging.whenIdle();
    alice.onWait = undefined;
    expect(seen).toEqual([true, true]);
    expect(await working()).toBe(false);
  });
});
