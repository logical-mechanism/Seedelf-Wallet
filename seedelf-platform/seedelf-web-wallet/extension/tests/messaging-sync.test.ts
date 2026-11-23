// What the wallet asks the relay, and when (the 1.10.0 gate's W4): nothing an
// envelope holds decides when a request goes, is delayed or is skipped. The
// relay sees every request's time, and it chooses what each page holds, so a
// sync reads first (pages and the scan, which costs the same for every
// envelope) and takes after (open, receive, the records' writes, the cursor).
// Between two pages, beside the scan, the one write is the scan's mark (W9),
// the same for every page that holds envelopes, whoever they are for.
// These are assertions on the order of what a wallet's service did
// (messaging-harness.ts `trace`), never on a clock.
import { describe, expect, it } from "vitest";

import type { ConversationFile, Inbox } from "../src/background/messaging";
import { PAGES_A_SYNC } from "../src/background/relay";
import { WalletLocked } from "../src/background/wallet";
import {
  ALICE_SEEDELF,
  BOB_SEEDELF,
  CAROL_SEEDELF,
  clock,
  type Directory,
  fakeRelay,
  fileOf,
  loadTestWasm,
  pair,
  party,
  recordName,
  records,
  synced,
  talking,
  texts,
  turnOn,
  turns,
} from "./messaging-harness";

/** What a wallet's service did between each page request and the next, and after the last. */
function betweenPages(trace: readonly string[]): string[][] {
  const out: string[][] = [];
  for (const step of trace) {
    if (step.startsWith("GET ")) out.push([]);
    else out.at(-1)?.push(step);
  }
  return out;
}

/** Alice, Bob and Carol, Messages on, Alice in a conversation with each of the other two. */
async function three() {
  const relay = fakeRelay(clock);
  const directory: Directory = new Map();
  const alice = await party(12, relay, directory, ALICE_SEEDELF);
  const bob = await party(24, relay, directory, BOB_SEEDELF);
  const carol = await party(15, relay, directory, CAROL_SEEDELF);
  await turnOn(alice, bob, carol);
  const toBob = await talking(alice, bob, BOB_SEEDELF);
  const toCarol = await talking(alice, carol, CAROL_SEEDELF);
  await synced(bob);
  await synced(carol);
  return { relay, directory, alice, bob, carol, toBob, toCarol };
}

// Each test bounded: one that fails mid-take fails here, never hangs the run.
describe("when the wallet asks the relay for a page (W4)", { timeout: 30_000 }, () => {
  it("never depends on what the last page held: one envelope a page, the reader's own and the others' alike", async () => {
    const { relay, alice, bob, carol, toBob, toCarol } = await three();
    // Twelve short messages, to Bob and to Carol in an order of no pattern.
    const whose = ["bob", "carol", "carol", "bob", "bob", "bob", "carol", "bob", "carol", "carol", "bob", "carol"];
    for (const [i, to] of whose.entries()) {
      await alice.messaging.send("preprod", to === "bob" ? toBob : toCarol, `message ${i}`);
      await alice.messaging.whenIdle();
    }
    // The relay serves one envelope a page, and notes what comes between its requests.
    relay.pageCount = 1;
    for (const reader of [bob, carol]) {
      reader.trace.length = 0;
      await synced(reader);
      const pages = reader.trace.filter((s) => s.startsWith("GET "));
      expect(pages.length).toBeGreaterThanOrEqual(whose.length);
      // Between two page requests: the scan's mark and the scan, and nothing else, whoever the page's envelope was for.
      const gaps = betweenPages(reader.trace).slice(0, -1);
      expect(gaps.every((gap) => gap.join() === "set messagingMark.preprod,scan")).toBe(true);
      // Every page is asked for before anything is opened, read from a conversation's record, or written but the mark.
      const lastPage = reader.trace.lastIndexOf(pages.at(-1)!);
      const firstLocal = reader.trace.findIndex((s) => /^(open|receive|set (?!messagingMark\.)|remove |get conversation\.)/.test(s));
      expect(firstLocal).toBeGreaterThan(lastPage);
      // And what was read is all there.
      const name = reader === bob ? "bob" : "carol";
      const got = (await texts(reader, reader === bob ? toBob : toCarol)).filter((m) => m.startsWith("in:message"));
      expect(got).toEqual(whose.flatMap((to, i) => (to === name ? [`in:message ${i}`] : [])));
    }
  });

  it("writes the cursor once, after the last envelope is taken, to where the read ended", async () => {
    const { relay, alice, bob, toBob } = await three();
    for (const text of ["a", "b", "c"]) await alice.messaging.send("preprod", toBob, text);
    await alice.messaging.whenIdle();
    const before = (await bob.store.get<Inbox>("messaging.preprod"))!.cursor;
    relay.pageCount = 1;
    bob.trace.length = 0;
    // Each write of the inbox: where the trace was, and the cursor it wrote.
    const written: Array<{ at: number; cursor?: string }> = [];
    bob.beforeWrite = (name, value) => {
      if (name === "messaging.preprod") written.push({ at: bob.trace.length, cursor: (value as Inbox).cursor });
    };
    await synced(bob);
    bob.beforeWrite = undefined;
    const end = relay.pools.get("preprod")!.held.at(-1)!.number.toString();
    const moved = written.filter((w) => w.cursor !== before);
    // One write moves the cursor, to the last page's, and it comes after the last envelope is taken.
    expect(moved).toHaveLength(1);
    expect(moved[0]!.cursor).toBe(end);
    expect(moved[0]!.at).toBeGreaterThan(bob.trace.lastIndexOf("receive"));
    expect(bob.trace.filter((s) => s === "receive")).toHaveLength(3);
  });

  it("takes what it took before a stop once, of every kind: a request's first message, a join, a session message, a reveal", async () => {
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const alice = await party(12, relay, directory, ALICE_SEEDELF);
    const bob = await party(24, relay, directory, BOB_SEEDELF);
    const carol = await party(15, relay, directory, CAROL_SEEDELF);
    await turnOn(alice, bob, carol);
    // Carol wrote first to Bob, and he replied: she may show him her Seedelf.
    const withCarol = await talking(carol, bob, BOB_SEEDELF);
    await synced(bob);
    const before = (await bob.store.get<Inbox>("messaging.preprod"))!.cursor;
    // In the pool for Bob now: Alice's first message (a request), a second from her before any reply (a join), and
    // from Carol a text and a reveal.
    const request = await alice.messaging.start("preprod", BOB_SEEDELF, "first");
    await alice.messaging.send("preprod", request, "second");
    await alice.messaging.whenIdle();
    await carol.messaging.send("preprod", withCarol, "a text");
    await carol.messaging.reveal("preprod", withCarol, CAROL_SEEDELF);
    await carol.messaging.whenIdle();

    // A worker stopped as the cursor is written: everything taken, the cursor where it was.
    bob.beforeWrite = (name, value) => {
      if (name === "messaging.preprod" && (value as Inbox).cursor !== before) throw new Error("stopped");
    };
    await bob.messaging.sync("preprod").catch(() => undefined);
    await bob.messaging.whenIdle();
    bob.beforeWrite = undefined;
    expect((await bob.messaging.overview("preprod")).requests).toMatchObject([{ cid: request, messages: 2, unread: 2 }]);
    const stopped = await records(bob);
    expect((stopped["messaging.preprod"] as Inbox).cursor).toBe(before);
    const kinds = (file: ConversationFile) => file.history.slice(-2).map((e) => e.text ?? `kind ${e.kind}`);
    expect(kinds(stopped[await recordName(bob, withCarol)] as ConversationFile)).toEqual(["a text", "kind 2"]);

    // The next worker reads the same pages: every envelope is refused as a duplicate, and only the cursor moves.
    bob.restart();
    await synced(bob);
    const again = await records(bob);
    const moved = (again["messaging.preprod"] as Inbox).cursor;
    expect(moved).not.toBe(before);
    expect({ ...again, "messaging.preprod": { ...(again["messaging.preprod"] as Inbox), cursor: before } }).toEqual(stopped);
    expect((await bob.messaging.request("preprod", request)).map((m) => m.text)).toEqual(["first", "second"]);
    const history = (await fileOf(bob, withCarol))!.history;
    expect(history.filter((e) => e.text === "a text")).toHaveLength(1);
    expect(history.filter((e) => e.kind === 2)).toHaveLength(1);
  });

  it("posts what's waiting right after the read, before anything is taken", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    // Alice has a message the relay never took, and one of Bob's to read.
    relay.up = false;
    await alice.messaging.send("preprod", cid, "kept waiting");
    await alice.messaging.whenIdle();
    relay.up = true;
    await bob.messaging.send("preprod", cid, "for Alice");
    await bob.messaging.whenIdle();
    alice.trace.length = 0;
    await synced(alice);
    const post = alice.trace.findIndex((s) => s.startsWith("POST "));
    const lastPage = alice.trace.map((s) => s.startsWith("GET ")).lastIndexOf(true);
    const open = alice.trace.indexOf("open");
    expect(post).toBeGreaterThan(lastPage);
    expect(open).toBeGreaterThan(post);
    expect(await texts(alice, cid)).toContain("in:for Alice");
    expect((await alice.messaging.thread("preprod", cid)).messages.find((m) => m.text === "kept waiting")!.sent).toBe("posted");
  });

  it("takes what the read found though the posts after it fail", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    // Alice has a message waiting to go, and one of Bob's to read; her posting then fails, once, with no trap.
    relay.up = false;
    await alice.messaging.send("preprod", cid, "kept waiting");
    await alice.messaging.whenIdle();
    relay.up = true;
    await bob.messaging.send("preprod", cid, "for Alice");
    await bob.messaging.whenIdle();
    const wasm = loadTestWasm();
    let fail = true;
    alice.restart({
      ...wasm,
      messagingRelayDigest: (pool, envelope) => {
        if (fail) {
          fail = false;
          throw new Error("no digest");
        }
        return wasm.messagingRelayDigest(pool, envelope);
      },
    });
    await expect(alice.messaging.sync("preprod")).rejects.toThrow(/no digest/);
    await alice.messaging.whenIdle();
    expect(await texts(alice, cid)).toContain("in:for Alice");
  });

  it("never chains a read to the end of a take: a sync asked during one joins it, and the next comes at the next tick", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await alice.messaging.send("preprod", cid, "one");
    await alice.messaging.whenIdle();
    relay.calls.length = 0;
    // The unlock's sync and a page's first poll, together.
    await Promise.all([bob.messaging.sync("preprod"), bob.messaging.sync("preprod")]);
    await bob.messaging.whenIdle();
    // One read: its page, and nothing asked again as the taking ended.
    expect(relay.calls.filter((c) => c.startsWith("GET "))).toHaveLength(1);
    expect(await texts(bob, cid)).toContain("in:one");
  });

  it("reads on at the next tick while what the last read found is still being taken", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await alice.messaging.send("preprod", cid, "one");
    await alice.messaging.whenIdle();
    // The taking of "one" is held at its record's write.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let holding = false;
    const record = await recordName(bob, cid);
    bob.beforeWrite = async (name) => {
      if (name !== record || holding) return;
      holding = true;
      await held;
    };
    try {
      relay.calls.length = 0;
      // The sync is its read and its posts: it ends while what it read is still being taken.
      await bob.messaging.sync("preprod");
      await turns();
      expect(holding).toBe(true);
      const first = relay.calls.filter((c) => c.startsWith("GET "));
      expect(first).toHaveLength(1);
      // The next tick, with "two" in the pool meanwhile: its page is asked now, from where the first read ended.
      await alice.messaging.send("preprod", cid, "two");
      await alice.messaging.whenIdle();
      void bob.messaging.sync("preprod").catch(() => undefined);
      await turns();
      const pages = relay.calls.filter((c) => c.startsWith("GET "));
      expect(pages).toHaveLength(2);
      expect(pages[1]).not.toBe(first[0]);
      // The cursor kept is still where the first read began: nothing it found is taken yet.
      expect((await bob.store.get<Inbox>("messaging.preprod"))!.cursor).toBe(first[0]!.split("?after=")[1]);
    } finally {
      release();
    }
    await bob.messaging.whenIdle();
    // Both taken, in order, once; the cursor where the second read ended.
    expect((await texts(bob, cid)).slice(-2)).toEqual(["in:one", "in:two"]);
    expect((await bob.store.get<Inbox>("messaging.preprod"))!.cursor).toBe(relay.pools.get("preprod")!.held.at(-1)!.number.toString());
    await synced(bob);
    expect((await texts(bob, cid)).filter((m) => m === "in:one" || m === "in:two")).toHaveLength(2);
  });

  it("takes nothing a read found when a take before it fails: the next read goes on from the cursor kept", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await alice.messaging.send("preprod", cid, "one");
    await alice.messaging.whenIdle();
    const before = (await bob.store.get<Inbox>("messaging.preprod"))!.cursor;
    // The first take is held at its record's write, then stops there as a lock stops it: no key for any write after.
    // (A write the browser alone refuses is that envelope's: counted, and passed, W11.)
    let release!: (fail: boolean) => void;
    const held = new Promise<boolean>((r) => (release = r));
    let holding = false;
    const record = await recordName(bob, cid);
    bob.beforeWrite = async (name) => {
      if (name !== record || holding) return;
      holding = true;
      if (await held) throw new WalletLocked("locked meanwhile");
    };
    try {
      await bob.messaging.sync("preprod");
      await turns();
      expect(holding).toBe(true);
      // Meanwhile a second read, from where the first ended, finds "two".
      await alice.messaging.send("preprod", cid, "two");
      await alice.messaging.whenIdle();
      await bob.messaging.sync("preprod");
    } finally {
      release(true);
    }
    await bob.messaging.whenIdle();
    bob.beforeWrite = undefined;
    // Neither is taken, and the cursor never passed "one".
    expect((await texts(bob, cid)).filter((m) => m === "in:one" || m === "in:two")).toEqual([]);
    expect((await bob.store.get<Inbox>("messaging.preprod"))!.cursor).toBe(before);
    // The next read goes on from the cursor kept: both, in order, once.
    relay.calls.length = 0;
    await synced(bob);
    expect(relay.calls.find((c) => c.startsWith("GET "))).toBe(`GET /messaging/v1/preprod/envelopes?after=${before}`);
    expect((await texts(bob, cid)).slice(-2)).toEqual(["in:one", "in:two"]);
  });

  it("asks for no more pages in one sync than the client's own limit lets through without a wait, and goes on at the next (W10)", async () => {
    const { relay, bob } = await pair();
    // A relay that isn't §17's: every page says another follows, each with a cursor further on and nothing in it.
    const most = PAGES_A_SYNC;
    expect(most).toBe(16);
    let served = 0;
    let at = 5_000_000n;
    relay.fetch = async (_url, init) => {
      if (init.method !== "GET") return new Response("", { status: 503 });
      served++;
      const out = new Uint8Array(16);
      out[0] = 1;
      // More, until well past the bound: then the test's own end, so a loop without one still stops.
      out[1] = served < 4 * most ? 1 : 0;
      new DataView(out.buffer).setBigUint64(2, ++at);
      out.set([4, 4, 4, 4], 10);
      return new Response(out, { status: 200 });
    };
    await synced(bob);
    expect(served).toBe(most);
    // The cursor is where the read stopped: the next sync goes on from there.
    expect((await bob.store.get<Inbox>("messaging.preprod"))!.cursor).toBe(at.toString());
    await synced(bob);
    expect(served).toBe(2 * most);
  });

  it("stops following a relay whose cursor doesn't move on, envelopes or none", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await alice.messaging.send("preprod", cid, "again and again");
    await alice.messaging.whenIdle();
    const before = (await bob.store.get<Inbox>("messaging.preprod"))!.cursor!;
    // The same page for ever: its envelope, the cursor it was asked from, and "more".
    const real = relay.fetch;
    let served = 0;
    relay.fetch = async (url, init) => {
      const answer = await real(url, init);
      if (init.method !== "GET" || ++served > 40) return answer;
      const page = new Uint8Array(await answer.arrayBuffer());
      page[1] = 1;
      new DataView(page.buffer).setBigUint64(2, BigInt(before));
      return new Response(page, { status: 200 });
    };
    await synced(bob);
    expect(served).toBe(1);
    expect((await texts(bob, cid)).filter((m) => m === "in:again and again")).toHaveLength(1);
  });

  it("takes an envelope a page serves twice once: the read keeps what the scan's digits say, and the take each envelope once (W17)", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await synced(bob);
    await alice.messaging.send("preprod", cid, "once");
    await alice.messaging.whenIdle();
    // The relay serves it again, right behind itself, in the same page.
    relay.put("preprod", Buffer.from(relay.pools.get("preprod")!.held.at(-1)!.bytes).toString("hex"));
    bob.trace.length = 0;
    await synced(bob);
    expect(bob.trace.filter((s) => s === "scan")).toHaveLength(1);
    expect(bob.trace.filter((s) => s === "open")).toHaveLength(1);
    expect((await texts(bob, cid)).filter((m) => m === "in:once")).toHaveLength(1);
  });

  it("keeps nothing of a read whose scan answers anything but a digit an envelope: another build's module (W17)", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await synced(bob);
    await alice.messaging.send("preprod", cid, "past a wrong build");
    await alice.messaging.whenIdle();
    const before = (await bob.store.get<Inbox>("messaging.preprod"))!.cursor;
    const wasm = loadTestWasm();
    const indexes = (key: Parameters<typeof wasm.messagingScan>[0], envelopes: string) =>
      [...wasm.messagingScan(key, envelopes)].flatMap((digit, i) => (digit === "1" ? [i] : []));
    // A build before call 16's answer, the matches' indexes as JSON; and one as long as the batch that isn't digits.
    for (const answer of [
      (key: Parameters<typeof wasm.messagingScan>[0], envelopes: string) => JSON.stringify(indexes(key, envelopes)),
      (_key: Parameters<typeof wasm.messagingScan>[0], envelopes: string) => "2".repeat((JSON.parse(envelopes) as string[]).length),
    ]) {
      bob.restart({ ...wasm, messagingScan: answer });
      bob.trace.length = 0;
      relay.calls.length = 0;
      await expect(bob.messaging.sync("preprod")).rejects.toThrow(/a digit an envelope/);
      await bob.messaging.whenIdle();
      expect(bob.trace.filter((s) => s === "open")).toEqual([]);
      expect((await bob.store.get<Inbox>("messaging.preprod"))!.cursor).toBe(before);
    }
    // The module this build ships with reads it at the next sync.
    bob.restart();
    await synced(bob);
    expect((await texts(bob, cid)).at(-1)).toBe("in:past a wrong build");
  });

  it("reads on past its own envelopes: one a page, the read is as long as for anyone's (W10, review A)", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    // Past Bob's own reply, so every page from here holds one of Alice's to him.
    await synced(bob);
    for (const text of ["1", "2", "3", "4", "5", "6", "7"]) await alice.messaging.send("preprod", cid, text);
    await alice.messaging.whenIdle();
    relay.pageCount = 1;
    relay.calls.length = 0;
    await synced(bob);
    // Seven pages, the last saying nothing follows: no stop for how many were his.
    expect(relay.calls.filter((c) => c.startsWith("GET "))).toHaveLength(7);
    expect((await texts(bob, cid)).slice(-7)).toEqual(["in:1", "in:2", "in:3", "in:4", "in:5", "in:6", "in:7"]);
  });
});
