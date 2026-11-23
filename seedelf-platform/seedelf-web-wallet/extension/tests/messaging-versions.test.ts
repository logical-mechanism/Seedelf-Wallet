// What 1.10.0 does with what a later relay or a later wallet may send (the
// 1.10.0 gate's W15 and W16): a relay stopped on purpose (410) is asked once
// an hour, never posted to; an envelope of a size this version doesn't know
// is stepped over, not the whole page; a message of a kind it doesn't know is
// kept with its body (0x01–0x7F) or leaves nothing (0x80–0xFF); a record of
// another version is set aside, never written over; a post's answer it
// doesn't know holds that envelope alone; and the relay's day's reading, or
// the edge's busy answer, holds what they say and nothing more.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { type ConversationFile, type Inbox } from "../src/background/messaging";
import { CONVERSATION_RECORDS, PRIVATE_PREFIX } from "../src/background/private-store";
import {
  BOB_SEEDELF,
  busyFor,
  CAROL_SEEDELF,
  clock,
  fileOf,
  type FakeRelay,
  loadTestWasm,
  pair,
  type Party,
  party,
  recordName,
  setFileOf,
  synced,
  talking,
  texts,
  turnOn,
  type Wasm,
} from "./messaging-harness";

/** The records development builds wrote before the gate's call 16 (seedelf-messaging's fixture), hex. */
const OLD = JSON.parse(readFileSync(new URL("../../../seedelf-messaging/tests/fixtures/old_records_v1.json", import.meta.url), "utf8")) as Record<
  string,
  string
>;
/** A development build's requests' record, version 1; and the same bytes as a later version's would begin, version 3. */
const DEV_REQUESTS = OLD.requests_two_requests_three_messages!;
const LATER_REQUESTS = "03" + DEV_REQUESTS.slice(2);
const base64 = (hex: string) => Buffer.from(hex, "hex").toString("base64");

/** Puts `hex` in `p`'s inbox in place of its requests' record, stored as this build stores it (base64). */
async function withRequests(p: Party, hex: string): Promise<void> {
  const inbox = (await p.store.get<Inbox>("messaging.preprod"))!;
  await p.store.set("messaging.preprod", { ...inbox, requests: base64(hex) });
}

/** Bob, holding one request, Carol's, of one message; and Alice, who can write to him. */
async function withRequest() {
  const { relay, directory, alice, bob } = await pair();
  const carol = await party(15, relay, directory, CAROL_SEEDELF);
  await turnOn(carol);
  const old = await carol.messaging.start("preprod", BOB_SEEDELF, "an old request");
  await carol.messaging.whenIdle();
  await synced(bob);
  expect((await bob.messaging.overview("preprod")).requests).toMatchObject([{ cid: old, messages: 1 }]);
  return { relay, alice, bob, carol, old };
}

const gets = (relay: FakeRelay) => relay.calls.filter((c) => c.startsWith("GET "));
const posts = (relay: FakeRelay) => relay.calls.filter((c) => c.startsWith("POST "));

/** WebAssembly that counts the searches for a stamp, a post's or a first message's. */
function counting(solves: { n: number }): Wasm {
  const wasm = loadTestWasm();
  return {
    ...wasm,
    messagingFindStamp: (request) => {
      solves.n++;
      return wasm.messagingFindStamp(request);
    },
  };
}

/** `from` sends `plaintext` (hex, its kind first) in conversation `cid`, as a later version would: its record steps. */
async function sendRaw(from: Party, cid: string, plaintext: string, relay: FakeRelay): Promise<void> {
  const wasm = loadTestWasm();
  const file = (await fileOf(from, cid))!;
  const sent = JSON.parse(wasm.messagingSend(JSON.stringify({ conversation: file.state, plaintext }))) as {
    conversation: string;
    envelope: string;
  };
  await setFileOf(from, cid, { ...file, state: sent.conversation });
  relay.put("preprod", sent.envelope);
}

// Each test bounded: one that fails mid-take fails here, never hangs the run.
describe("a relay stopped on purpose (W15, versions-upgrade#2)", { timeout: 60_000 }, () => {
  it("is asked once an hour through two hours of 10-second syncs: no post, no work, and the overview says paused", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    const solves = { n: 0 };
    alice.restart(counting(solves));
    // The relay's off switch: every route of messaging answers 410.
    relay.fetch = async (url, init) => {
      relay.calls.push(`${init.method} ${new URL(url).pathname}${new URL(url).search}`);
      return new Response(JSON.stringify({ error: "messaging is stopped" }), { status: 410 });
    };
    relay.calls.length = 0;
    await synced(alice);
    expect((await alice.messaging.overview("preprod")).paused).toBe(true);
    // Written while paused: kept, never solved for, never posted.
    await alice.messaging.send("preprod", cid, "while it's stopped");
    await alice.messaging.start("preprod", BOB_SEEDELF, "a first message too");
    await alice.messaging.whenIdle();
    for (let tick = 0; tick < 720; tick++) {
      clock.now += 10_000;
      if (tick % 60 === 0) await alice.wallet.touch();
      await alice.messaging.sync("preprod");
    }
    await alice.messaging.whenIdle();
    expect(gets(relay).length).toBeLessThanOrEqual(3);
    expect(posts(relay)).toEqual([]);
    expect(solves.n).toBe(0);
    expect((await alice.messaging.overview("preprod")).paused).toBe(true);
    expect((await alice.messaging.thread("preprod", cid)).messages.at(-1)!.sent).toBe("pending");
  }, 120_000);

  it("is asked again at each unlock, and once it answers, everything waiting goes", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    const real = relay.fetch;
    relay.fetch = async (url, init) => {
      relay.calls.push(`${init.method} ${new URL(url).pathname}${new URL(url).search}`);
      return new Response(JSON.stringify({ error: "messaging is stopped" }), { status: 410 });
    };
    await synced(alice);
    await alice.messaging.send("preprod", cid, "waiting");
    await alice.messaging.whenIdle();
    relay.fetch = real;
    // Asked again only after the lock: the hold was this unlock's.
    relay.calls.length = 0;
    await synced(alice);
    expect(gets(relay)).toEqual([]);
    await alice.wallet.lock();
    await alice.wallet.unlock("correct horse battery");
    await synced(alice);
    expect(gets(relay).length).toBeGreaterThan(0);
    expect((await alice.messaging.overview("preprod")).paused).toBeUndefined();
    expect((await alice.messaging.thread("preprod", cid)).messages.at(-1)!.sent).toBe("posted");
  });
});

describe("a page with an envelope of a size this version doesn't know (W15, versions-upgrade#3)", { timeout: 30_000 }, () => {
  it("is read all the same: the envelope is stepped over, the others taken, and the cursor moves", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await alice.messaging.send("preprod", cid, "before it");
    await alice.messaging.whenIdle();
    relay.put("preprod", "01" + "77".repeat(1023));
    await alice.messaging.send("preprod", cid, "after it");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect((await texts(bob, cid)).slice(-2)).toEqual(["in:before it", "in:after it"]);
    expect((await bob.messaging.overview("preprod")).offline).toBeUndefined();
    expect((await bob.store.get<Inbox>("messaging.preprod"))!.cursor).toBe(relay.pools.get("preprod")!.held.at(-1)!.number.toString());
  });

  it("takes the pages before one that doesn't read, and goes on from there", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    for (const text of ["one", "two", "three"]) {
      await alice.messaging.send("preprod", cid, text);
      await alice.messaging.whenIdle();
    }
    relay.pageCount = 1;
    // The page that holds "three" doesn't read, this once.
    const three = Buffer.from(relay.pools.get("preprod")!.held.at(-1)!.bytes).toString("hex");
    const real = relay.fetch;
    let broken = false;
    relay.fetch = async (url, init) => {
      const answer = await real(url, init);
      if (init.method !== "GET" || broken) return answer;
      const body = new Uint8Array(await answer.arrayBuffer());
      if (!Buffer.from(body).toString("hex").includes(three)) return new Response(body, { status: 200 });
      broken = true;
      return new Response(new Uint8Array([1, 0, 0]), { status: 200 });
    };
    await synced(bob);
    expect((await texts(bob, cid)).slice(-2)).toEqual(["in:one", "in:two"]);
    relay.fetch = real;
    await synced(bob);
    expect((await texts(bob, cid)).slice(-3)).toEqual(["in:one", "in:two", "in:three"]);
  });
});

describe("a message of a kind this version doesn't know (W15, versions-upgrade#4)", { timeout: 30_000 }, () => {
  it("keeps content (0x01–0x7F) with its body, shown as one it can't show; control (0x80–0xFF) leaves nothing", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await synced(bob);
    const unread = (await bob.messaging.overview("preprod")).conversations[0]!.unread;
    await sendRaw(alice, cid, "05" + "c0ffee", relay);
    await sendRaw(alice, cid, "85" + "beef", relay);
    bob.changed.length = 0;
    await synced(bob);
    const overview = await bob.messaging.overview("preprod");
    expect(overview.conversations[0]!.unread).toBe(unread + 1);
    expect(overview.conversations[0]!.last).toEqual({ dir: "in" });
    const thread = await bob.messaging.thread("preprod", cid);
    expect(thread.messages.at(-1)).toMatchObject({ dir: "in", unreadable: true });
    expect(thread.messages.filter((m) => m.unreadable)).toHaveLength(1);
    // The content's bytes are kept for a later version to show.
    const kept = (await fileOf(bob, cid))!.history.at(-1)!;
    expect(kept).toMatchObject({ kind: 5, body: "c0ffee" });
    // The conversation went on through both: Alice's next text arrives.
    await alice.messaging.send("preprod", cid, "and text again");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect((await texts(bob, cid)).at(-1)).toBe("in:and text again");
  });
});

describe("a record of another version (W15, versions-upgrade#5)", { timeout: 30_000 }, () => {
  it("is an inbox that won't open: nothing is asked and nothing written over it, and it can be started again", async () => {
    const { relay, alice, bob } = await pair();
    await talking(alice, bob);
    const inbox = (await bob.store.get<Inbox>("messaging.preprod"))!;
    await bob.store.set("messaging.preprod", { ...inbox, v: 3, later: "a field 1.11 adds" });
    const sealed = await bob.local.get(PRIVATE_PREFIX + "messaging.preprod");
    relay.calls.length = 0;
    bob.restart();
    await bob.messaging.sync("preprod").catch(() => undefined);
    await bob.messaging.whenIdle();
    expect(relay.calls).toEqual([]);
    expect(await bob.local.get(PRIVATE_PREFIX + "messaging.preprod")).toEqual(sealed);
    await expect(bob.messaging.overview("preprod")).rejects.toThrow(/couldn't open its record of your messages/);
    await bob.messaging.clear("preprod");
    expect(await bob.messaging.overview("preprod")).toMatchObject({ conversations: [], requests: [] });
  });

  it("is a conversation that can't be opened: kept as it is through a sync, and deletable", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    const name = await recordName(bob, cid);
    // A later build's record, its crate's bytes in hex again: one a build that didn't read `v` took for a v 1, read,
    // used and wrote back over.
    const file: ConversationFile = (await fileOf(bob, cid))!;
    await bob.store.set(name, { ...file, v: 9 });
    const sealed = await bob.local.get(PRIVATE_PREFIX + name);
    await alice.messaging.send("preprod", cid, "to a later build's record");
    await alice.messaging.whenIdle();
    bob.restart();
    await synced(bob);
    expect(await bob.local.get(PRIVATE_PREFIX + name)).toEqual(sealed);
    expect((await bob.messaging.overview("preprod")).conversations[0]).toMatchObject({ cid, unreadable: true });
    await bob.messaging.remove("preprod", cid);
    expect(await bob.local.keys(PRIVATE_PREFIX + CONVERSATION_RECORDS)).toEqual([]);
  });

  it("is a conversation a development build wrote: one that can't be opened, deleted with no tombstone (W17)", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    // The crate's bytes from before call 16, version 1: it refuses them at their first byte.
    const file: ConversationFile = (await fileOf(bob, cid))!;
    await setFileOf(bob, cid, { ...file, state: OLD.responder_with_five_skipped_keys_in_two_chains! });
    bob.restart();
    await expect(bob.messaging.thread("preprod", cid)).rejects.toThrow(/couldn't open its record of a conversation/);
    expect((await bob.messaging.overview("preprod")).conversations[0]).toMatchObject({ cid, unreadable: true });
    await bob.messaging.remove("preprod", cid);
    const stored = (await bob.store.get<Inbox>("messaging.preprod"))!;
    expect(stored.conversations).toEqual({});
    // Its t can't be read, so nothing holds its ID.
    expect(Buffer.from(stored.tombstones ?? "", "base64").toString("hex")).not.toContain(cid);
    expect(await bob.local.keys(PRIVATE_PREFIX + CONVERSATION_RECORDS)).toEqual([]);
  });
});

describe("a requests' record the crate doesn't read (W17, DESIGN-protocol §3.7)", { timeout: 60_000 }, () => {
  it("is one a development build wrote: dropped at the next take, the messages it listed counted, and new requests come", async () => {
    const { alice, bob } = await withRequest();
    await withRequests(bob, DEV_REQUESTS);
    bob.restart();
    const fresh = await alice.messaging.start("preprod", BOB_SEEDELF, "a new one");
    await alice.messaging.whenIdle();
    await synced(bob);
    const overview = await bob.messaging.overview("preprod");
    expect(overview.requests.map((r) => r.cid)).toEqual([fresh]);
    expect(overview.dropped).toBe(1);
    expect((await bob.store.get<Inbox>("messaging.preprod"))!.requestsAside).toBeUndefined();
  });

  it("is one a later version wrote: kept aside as it came, never written over nor counted lost, and new requests come", async () => {
    const { alice, bob } = await withRequest();
    await withRequests(bob, LATER_REQUESTS);
    bob.restart();
    const fresh = await alice.messaging.start("preprod", BOB_SEEDELF, "a new one");
    await alice.messaging.whenIdle();
    await synced(bob);
    const overview = await bob.messaging.overview("preprod");
    expect(overview.requests.map((r) => r.cid)).toEqual([fresh]);
    expect(overview.dropped).toBeUndefined();
    expect((await bob.store.get<Inbox>("messaging.preprod"))!.requestsAside).toEqual([base64(LATER_REQUESTS)]);
    // Through a deletion and the takes after it, as it came.
    await bob.messaging.remove("preprod", fresh);
    const another = await alice.messaging.start("preprod", BOB_SEEDELF, "and another");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect((await bob.messaging.overview("preprod")).requests.map((r) => r.cid)).toEqual([another]);
    expect((await bob.store.get<Inbox>("messaging.preprod"))!.requestsAside).toEqual([base64(LATER_REQUESTS)]);
  });

  it("is set aside at a press too: the request opened or accepted isn't there any more, said in words", async () => {
    const { alice, bob, old } = await withRequest();
    await withRequests(bob, LATER_REQUESTS);
    bob.restart();
    await expect(bob.messaging.request("preprod", old)).rejects.toThrow("This request isn't in this browser any more.");
    const stored = (await bob.store.get<Inbox>("messaging.preprod"))!;
    expect(stored.requests).toBeUndefined();
    expect(stored.requestsAside).toEqual([base64(LATER_REQUESTS)]);
    expect((await bob.messaging.overview("preprod")).requests).toEqual([]);
    // A development build's, at Reply: dropped, the request it listed counted.
    const fresh = await alice.messaging.start("preprod", BOB_SEEDELF, "another");
    await alice.messaging.whenIdle();
    await synced(bob);
    await withRequests(bob, DEV_REQUESTS);
    bob.restart();
    await expect(bob.messaging.accept("preprod", fresh)).rejects.toThrow("This request isn't in this browser any more.");
    const after = (await bob.store.get<Inbox>("messaging.preprod"))!;
    expect(after.requests).toBeUndefined();
    expect(after.requestsAside).toEqual([base64(LATER_REQUESTS)]);
    expect((await bob.messaging.overview("preprod"))).toMatchObject({ requests: [], dropped: 1 });
  });

  it("holds up no deletion: the conversation goes, and its ID is a tombstone", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await withRequests(bob, LATER_REQUESTS);
    bob.restart();
    await bob.messaging.remove("preprod", cid);
    const stored = (await bob.store.get<Inbox>("messaging.preprod"))!;
    expect(stored.conversations[cid]).toBeUndefined();
    // Its first message read again starts nothing (§5).
    expect(stored.tombstones).toBeDefined();
    expect(Buffer.from(stored.tombstones!, "base64").toString("hex")).toContain(cid);
    expect(stored.requestsAside).toEqual([base64(LATER_REQUESTS)]);
  });

  it("is one in an inbox from before the gate, which kept no list: dropped as it's opened, what was unread counted", async () => {
    const { bob } = await pair();
    const { requestsShown: _shown, ...inbox } = (await bob.store.get<Inbox>("messaging.preprod"))!;
    // That inbox's binary fields are hex.
    await bob.store.set("messaging.preprod", { ...inbox, v: 1, requests: DEV_REQUESTS, requestsUnread: { ["ab".repeat(16)]: 2 } });
    bob.restart();
    expect(await bob.messaging.overview("preprod")).toMatchObject({ requests: [], dropped: 2 });
  });
});

describe("a post's answer this version doesn't know (W15, versions-upgrade#6)", { timeout: 30_000 }, () => {
  it("holds that envelope alone: the next run goes on after it, and after three in a row it's set aside to send again", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    relay.up = false;
    await alice.messaging.send("preprod", cid, "the server breaks on this one");
    await alice.messaging.send("preprod", cid, "behind it");
    await alice.messaging.whenIdle();
    relay.up = true;
    const broken = (await fileOf(alice, cid))!.history.at(-2)!.envelope!;
    const real = relay.fetch;
    let answered500 = 0;
    relay.fetch = async (url, init) => {
      if (init.method === "POST" && Buffer.from(new Uint8Array(init.body as ArrayBuffer).subarray(8)).toString("hex") === broken) {
        relay.calls.push(`POST ${new URL(url).pathname}`);
        answered500++;
        return new Response("internal error", { status: 500 });
      }
      return real(url, init);
    };
    await synced(alice);
    expect((await alice.messaging.thread("preprod", cid)).messages.at(-1)!.sent).toBe("pending");
    await synced(alice);
    expect((await alice.messaging.thread("preprod", cid)).messages.at(-1)!.sent).toBe("posted");
    await synced(alice);
    await synced(alice);
    const entry = (await alice.messaging.thread("preprod", cid)).messages.at(-2)!;
    expect(answered500).toBe(3);
    expect(entry).toMatchObject({ sent: "refused", refusedBy: "server", resend: true });
    // No more tries by itself; Send again posts the same bytes once the server takes them.
    await synced(alice);
    expect(answered500).toBe(3);
    relay.fetch = real;
    await alice.messaging.resend("preprod", cid, entry.id);
    await alice.messaging.whenIdle();
    expect((await alice.messaging.thread("preprod", cid)).messages.at(-2)!.sent).toBe("posted");
    // Bob reads both, each once, in the order the relay took them.
    await synced(bob);
    expect((await texts(bob, cid)).slice(-2)).toEqual(["in:behind it", "in:the server breaks on this one"]);
  });
});

describe("the relay's own holds (W16)", { timeout: 30_000 }, () => {
  it("holds only that pool's page reads for the day's reading, as long as it says; posts go on", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    const real = relay.fetch;
    let readSoFar = true;
    relay.fetch = async (url, init) => {
      if (init.method === "GET" && readSoFar) {
        relay.calls.push(`GET ${new URL(url).pathname}${new URL(url).search}`);
        return new Response(JSON.stringify({ error: "this address has read its share of the pool for the day" }), {
          status: 429,
          headers: { "retry-after": String(2 * 3600) },
        });
      }
      return real(url, init);
    };
    await synced(alice);
    relay.calls.length = 0;
    // An hour on: no page asked, but a message posted.
    await busyFor(3600_000, alice, bob);
    await alice.messaging.send("preprod", cid, "posts go on");
    await alice.messaging.whenIdle();
    await synced(alice);
    expect(gets(relay)).toEqual([]);
    expect(posts(relay)).toHaveLength(1);
    expect((await alice.messaging.overview("preprod")).offline).toBeUndefined();
    // Past its two hours, read again.
    readSoFar = false;
    await busyFor(3600_000 + 60_000, alice, bob);
    await synced(alice);
    expect(gets(relay).length).toBeGreaterThan(0);
  });

  it("waits a second for the edge's 'too many requests at once', and says nothing of it", async () => {
    const { relay, alice, bob } = await pair();
    await talking(alice, bob);
    const real = relay.fetch;
    let once = true;
    relay.fetch = async (url, init) => {
      if (init.method === "GET" && once) {
        once = false;
        return new Response(JSON.stringify({ error: "too many requests at once" }), { status: 429, headers: { "retry-after": "1" } });
      }
      return real(url, init);
    };
    alice.changed.length = 0;
    await synced(alice);
    expect((await alice.messaging.overview("preprod")).offline).toBeUndefined();
    expect(alice.changed).toEqual([]);
  });
});
