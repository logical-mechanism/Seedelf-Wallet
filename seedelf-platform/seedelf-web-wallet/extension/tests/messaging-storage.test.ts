// What Seedelf Messaging keeps on the device (the 1.10.0 gate's W7). Nothing
// at rest says which conversation a record is: each is named by an ID of its
// own, kept in the sealed inbox. Everything Messages stores, both networks'
// inboxes and every conversation's record, is held to one budget before it's
// written, since chrome.storage.local's 10 MB is the whole wallet's and a
// refused write there breaks payments' own records. The crate's bytes are
// stored as base64. A sync that takes nothing writes nothing, and no request's
// record is parsed for an envelope that isn't a request's, or for the list.
import { describe, expect, it } from "vitest";

import { type ConversationFile, type Inbox, plaintextOf } from "../src/background/messaging";
import { rememberRegister } from "../src/background/minted-by";
import { CONVERSATION_RECORDS, PRIVATE_PREFIX } from "../src/background/private-store";
import {
  ALICE_SEEDELF,
  another,
  BOB_SEEDELF,
  busyFor,
  CAROL_SEEDELF,
  clock,
  cursorOf,
  type Directory,
  fakeRelay,
  fileOf,
  listed,
  loadTestWasm,
  pair,
  party,
  recordName,
  storedTotal,
  synced,
  talking,
  texts,
  turnOn,
  usedBytes,
  withQuota,
  requestsOf,
} from "./messaging-harness";

const asHex = (base64: string) => Buffer.from(base64, "base64").toString("hex");

// Each test bounded: one that fails mid-take fails here, never hangs the run.
describe("what Messages keeps on the device (W7)", { timeout: 30_000 }, () => {
  it("names no record by its conversation's ID: two wallets that talk share no key, and nothing in the clear holds it (worker-state#4, cross-feature#3, key-uses#5)", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    const family = PRIVATE_PREFIX + CONVERSATION_RECORDS;
    const a = await alice.local.keys(family);
    const b = await bob.local.keys(family);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    // The two sides of one conversation: nothing in either browser's keys says so.
    expect(a.filter((key) => b.includes(key))).toEqual([]);
    for (const p of [alice, bob]) for (const key of await p.local.keys("")) expect(key).not.toContain(cid);
    // The conversation goes on, and Remove wallet still finds the family by its prefix, with no key.
    await alice.messaging.send("preprod", cid, "still here");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect((await texts(bob, cid)).at(-1)).toBe("in:still here");
    await bob.wallet.reset();
    expect(await bob.local.keys(family)).toEqual([]);
  });

  it("holds what Messages stores to its budget before each write: one counterpart's flood past its share shortens only its own conversation (ratchet#2, worker-state#1)", async () => {
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const budget = 64 * 1024;
    const options = { budgetBytes: budget, shareBytes: 16 * 1024 };
    const alice = await party(12, relay, directory, ALICE_SEEDELF, options);
    const bob = await party(24, relay, directory, BOB_SEEDELF, options);
    const carol = await party(15, relay, directory, CAROL_SEEDELF, options);
    await turnOn(alice, bob, carol);
    // Alice wrote first to Bob, a while ago; Carol wrote first to Alice, who replied.
    const old = await talking(alice, bob);
    await busyFor(3600_000, alice, bob, carol);
    const flood = await talking(carol, alice, ALICE_SEEDELF);
    // Never more than the budget at rest, after any write of Alice's.
    let most = 0;
    const set = alice.local.set.bind(alice.local);
    alice.local.set = async (key, value) => {
      await set(key, value);
      most = Math.max(most, storedTotal(alice));
    };
    for (let i = 0; i < 12; i++) await carol.messaging.send("preprod", flood, `${i}:` + "w".repeat(3000));
    await carol.messaging.whenIdle();
    await synced(alice);
    expect(most).toBeLessThanOrEqual(budget);
    // Alice's conversation with Bob is as it was; Carol's lost its oldest, and keeps its newest.
    expect(await texts(alice, old)).toEqual(["out:hello Bob", "in:hi Alice"]);
    const thread = await alice.messaging.thread("preprod", flood);
    expect(thread.trimmed).toBeGreaterThan(0);
    expect(thread.messages.at(-1)!.text).toMatch(/^11:/);
  });

  it("deletes read messages before an unread one, however old that is", async () => {
    const { alice, bob } = await pair(48 * 1024);
    const cid = await talking(alice, bob);
    // One of Alice's that Bob hasn't opened, then twelve of his own after it.
    await alice.messaging.send("preprod", cid, "unread:" + "u".repeat(3000));
    await alice.messaging.whenIdle();
    await synced(bob);
    for (let i = 0; i < 12; i++) {
      // Each posted before the next: one still waiting to be posted holds its envelope, and stays.
      await bob.messaging.send("preprod", cid, `mine ${i}:` + "m".repeat(3000));
      await bob.messaging.whenIdle();
    }
    const file = (await fileOf(bob, cid))!;
    expect(file.trimmed).toBeGreaterThan(0);
    // The oldest it kept is the unread one: every read one before it went first.
    expect(file.history[0]!.text).toMatch(/^unread:/);
    expect(file.history.at(-1)!.text).toMatch(/^mine 11:/);
    expect((await bob.messaging.overview("preprod")).conversations[0]!.unread).toBe(1);
    expect(storedTotal(bob)).toBeLessThanOrEqual(48 * 1024);
  });

  it("holds both networks' records to the one budget: a write on one makes its room from the other where that frees the most", async () => {
    const budget = 96 * 1024;
    const { relay, alice, bob } = await pair(budget);
    const cid = await talking(alice, bob);
    // Alice's long conversation on mainnet, all of it posted: Bob's certificate there on the list (chunk 55's 55e).
    await listed(relay, bob, BOB_SEEDELF, bob.own[0]!.register, "mainnet");
    await alice.messaging.switch("mainnet", true);
    await alice.messaging.whenIdle();
    const far = await alice.messaging.start("mainnet", BOB_SEEDELF, "on mainnet");
    await alice.messaging.whenIdle();
    for (let i = 0; i < 12; i++) await alice.messaging.send("mainnet", far, `far ${i}:` + "f".repeat(3000));
    await alice.messaging.whenIdle();
    // Then on preprod, until the two together pass the budget.
    for (let i = 0; i < 10; i++) await alice.messaging.send("preprod", cid, `near ${i}:` + "n".repeat(3000));
    await alice.messaging.whenIdle();
    expect(storedTotal(alice)).toBeLessThanOrEqual(budget);
    // The room came from mainnet's, the larger, its newest kept.
    const mainnet = await alice.messaging.thread("mainnet", far);
    expect(mainnet.trimmed).toBeGreaterThan(0);
    expect(mainnet.messages.at(-1)!.text).toMatch(/^far 11:/);
    expect((await alice.messaging.thread("preprod", cid)).messages.at(-1)!.text).toMatch(/^near 9:/);
  });

  it("never deletes a message to make room it can't make: a message that won't fit isn't kept, it's counted, and the cursor moves past it (W11)", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    // Bob's conversation with Alice is far more its ratchet's bytes than its messages': 299 of her messages never
    // reached him, and he keeps their keys (48 hours). Nothing deletes those.
    const wasm = loadTestWasm();
    let state = (await fileOf(alice, cid))!.state;
    let envelope = "";
    for (let i = 0; i < 300; i++) {
      const sent = JSON.parse(wasm.messagingSend(JSON.stringify({ conversation: state, plaintext: plaintextOf(`m${i}`) }))) as {
        conversation: string;
        envelope: string;
      };
      state = sent.conversation;
      envelope = sent.envelope;
    }
    relay.put("preprod", envelope);
    await synced(bob);
    // Bob's budget, a little over what he holds now.
    bob.restart(undefined, { budgetBytes: storedTotal(bob) + 500 });
    // A long message of Alice's, past the power of two Bob's record is padded to: its record would pass the budget, and
    // only the ratchet's bytes could pay for it.
    const length = JSON.stringify(await bob.store.get(await recordName(bob, cid))).length;
    let pad = 1024;
    while (pad < length) pad *= 2;
    const long = pad - length + 2000;
    expect(long).toBeLessThan(30_000);
    await alice.messaging.send("preprod", cid, "z".repeat(long));
    await alice.messaging.send("preprod", cid, "short");
    await alice.messaging.whenIdle();
    relay.calls.length = 0;
    await synced(bob);
    const overview = await bob.messaging.overview("preprod");
    expect(overview.dropped).toBe(1);
    // Never `full`: nothing about it shows in what the wallet asks the relay. The cursor is past both.
    expect(overview.full).toBeUndefined();
    expect((await cursorOf(bob))).toBe(relay.pools.get("preprod")!.held.at(-1)!.number.toString());
    expect(await texts(bob, cid)).toEqual(["in:hello Bob", "out:hi Alice", "in:m299", "in:short"]);
    // The next read asks on from there, as any other would.
    relay.calls.length = 0;
    await synced(bob);
    expect(relay.calls.filter((c) => c.startsWith("GET "))).toEqual([
      `GET /messaging/v1/preprod/envelopes?after=${relay.pools.get("preprod")!.held.at(-1)!.number}`,
    ]);
  });

  it("gives requests a room of their own: a stranger's request never trims a message, nor makes Messages full (W11, redteam W7)", async () => {
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const alice = await party(12, relay, directory, ALICE_SEEDELF);
    const bob = await party(24, relay, directory, BOB_SEEDELF, { budgetBytes: 48 * 1024 });
    const carol = await party(15, relay, directory, CAROL_SEEDELF);
    await turnOn(alice, bob, carol);
    const cid = await talking(alice, bob);
    // Bob's history at its budget: Alice's long messages, every one read.
    for (let i = 0; i < 12; i++) await alice.messaging.send("preprod", cid, `${i}:` + "x".repeat(3000));
    await alice.messaging.whenIdle();
    await synced(bob);
    await texts(bob, cid);
    const before = (await fileOf(bob, cid))!.history.map((e) => e.id);
    // Carol's request, at the crate's own bound for it and no other.
    const request = await carol.messaging.start("preprod", BOB_SEEDELF, "r".repeat(1500));
    await carol.messaging.send("preprod", request, "s".repeat(1500));
    await carol.messaging.whenIdle();
    await synced(bob);
    const overview = await bob.messaging.overview("preprod");
    expect(overview.requests.map((r) => r.cid)).toEqual([request]);
    expect(overview.full).toBeUndefined();
    expect(overview.dropped).toBeUndefined();
    expect((await fileOf(bob, cid))!.history.map((e) => e.id)).toEqual(before);
  });

  it("leaves payments' own write-ahead its room: Messages never takes the area past its quota less the reserve (W11, quota-outside#1/#2)", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    // Bob's area, as Chrome holds it to its quota, with 400 KB left; Messages leaves 256 KiB of it free.
    const quota = usedBytes(bob) + 400 * 1024;
    withQuota(bob, () => quota);
    bob.restart(undefined, { quotaBytes: quota, reserveBytes: 256 * 1024 });
    // Alice's messages, enough to fill it.
    for (let i = 0; i < 20; i++) await alice.messaging.send("preprod", cid, `${i}:` + "f".repeat(25_000));
    await alice.messaging.whenIdle();
    await synced(bob);
    await synced(bob);
    expect(quota - usedBytes(bob)).toBeGreaterThanOrEqual(256 * 1024 - 64 * 1024);
    // What didn't fit was counted, never left waiting: the overview says so, and the newest that fit are there.
    expect((await bob.messaging.overview("preprod")).dropped).toBeGreaterThan(0);
    // A payment's sealed copy, as pending.ts writes one before it's sent (a large one: about 87 KB as stored).
    await bob.store.set("maybeSent.preprod", { pad: "p".repeat(60_000) });
    expect(await bob.local.get(PRIVATE_PREFIX + "maybeSent.preprod")).toBeDefined();
  }, 60_000);

  it("makes room for its own bookkeeping, best effort, within the budget: a write that grows the inbox trims first (review G)", async () => {
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const alice = await party(12, relay, directory, ALICE_SEEDELF);
    const bob = await party(24, relay, directory, BOB_SEEDELF);
    await turnOn(alice, bob);
    const cid = await talking(alice, bob);
    for (let i = 0; i < 12; i++) await alice.messaging.send("preprod", cid, `${i}:` + "x".repeat(3000));
    await alice.messaging.whenIdle();
    await synced(bob);
    await texts(bob, cid);
    // Bob's budget, a little over what he holds now; then forty Seedelfs this browser minted, which the next take's
    // note of the Seedelfs that take first messages writes into the inbox.
    const budget = storedTotal(bob) + 2048;
    bob.restart(undefined, { budgetBytes: budget });
    for (let i = 0; i < 40; i++) {
      const name = BOB_SEEDELF + i.toString(16).padStart(4, "0");
      const register = await another(bob);
      bob.own.push({ name, register });
      await rememberRegister(bob.store, "preprod", name, register);
    }
    let most = 0;
    const set = bob.local.set.bind(bob.local);
    bob.local.set = async (key, value) => {
      await set(key, value);
      most = Math.max(most, storedTotal(bob));
    };
    await alice.messaging.send("preprod", cid, "one more");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect(Object.keys((await bob.store.get<Inbox>("messaging.preprod"))!.handles)).toHaveLength(41);
    expect(most).toBeLessThanOrEqual(budget);
    expect((await texts(bob, cid)).at(-1)).toBe("in:one more");
  });

  it("ends a sync cleanly when the browser refuses a write: the envelope isn't kept but counted, nothing waits behind it, and the queue is free (worker-state#2, cross-feature#4)", async () => {
    const { relay, directory, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    const carol = await party(15, relay, directory, CAROL_SEEDELF);
    await turnOn(carol);
    // Bob's storage, as Chrome holds it to its quota: room for small writes, none for a long message.
    let quota = usedBytes(bob) + 600;
    withQuota(bob, () => quota);
    await alice.messaging.send("preprod", cid, "y".repeat(3000));
    await alice.messaging.whenIdle();
    await synced(bob);
    expect((await bob.messaging.overview("preprod")).dropped).toBe(1);
    expect((await cursorOf(bob))).toBe(relay.pools.get("preprod")!.held.at(-1)!.number.toString());
    // The queue isn't held: a thread opens, as ever.
    expect(await texts(bob, cid)).toEqual(["in:hello Bob", "out:hi Alice"]);
    // Room again: the next message is taken.
    quota = Number.POSITIVE_INFINITY;
    await alice.messaging.send("preprod", cid, "fits now");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect((await texts(bob, cid)).at(-1)).toBe("in:fits now");
  });

  it("stores the crate's records and every envelope as base64, not hex", async () => {
    const { relay, directory, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    const wasm = loadTestWasm();
    relay.up = false;
    await alice.messaging.send("preprod", cid, "waiting");
    await alice.messaging.whenIdle();
    const stored = (await alice.store.get<ConversationFile>(await recordName(alice, cid)))!;
    // The crate reads the stored state once it's turned back from base64...
    expect((JSON.parse(wasm.messagingConversationInfo(asHex(stored.state))) as { cid: string }).cid).toBe(cid);
    // ...and the pending envelope is its 2,048 bytes (a short text padded to its first-contact size, O1 b), so written.
    const pending = stored.history.at(-1)!;
    expect(pending.sent).toBe("pending");
    expect(Buffer.from(pending.envelope!, "base64")).toHaveLength(2048);
    // A request's record too, in its own record since round 5.
    relay.up = true;
    const carol = await party(15, relay, directory, CAROL_SEEDELF);
    await turnOn(carol);
    const request = await carol.messaging.start("preprod", BOB_SEEDELF, "a request");
    await carol.messaging.whenIdle();
    await synced(bob);
    const requests = (await requestsOf(bob))!;
    expect((JSON.parse(wasm.messagingRequestsInfo(asHex(requests.requests!))) as Array<{ cid: string }>).map((r) => r.cid)).toEqual([request]);
    // The inbox keeps none of them, only what the list shows.
    expect((await bob.store.get<Record<string, unknown>>("messaging.preprod"))!.requests).toBeUndefined();
  });

  it("writes nothing when a sync takes nothing and its cursor doesn't move, an hour on too (worker-net#6, cross-feature#6, docs-claims#18)", async () => {
    const { alice, bob } = await pair();
    await talking(alice, bob);
    await synced(bob);
    const writes = () => bob.trace.filter((s) => /^(set|remove) /.test(s));
    bob.trace.length = 0;
    await synced(bob);
    await synced(bob);
    expect(writes()).toEqual([]);
    // An hour on, the expiry's turn: nothing has expired, so nothing is written.
    await busyFor(61 * 60_000, alice, bob);
    bob.trace.length = 0;
    await synced(bob);
    expect(writes()).toEqual([]);
  });

  it("parses no request's record for an envelope that isn't a request's, nor for the list (wasm#1, worker-state#3)", async () => {
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const alice = await party(12, relay, directory, ALICE_SEEDELF);
    const bob = await party(24, relay, directory, BOB_SEEDELF);
    const carol = await party(15, relay, directory, CAROL_SEEDELF);
    await turnOn(alice, bob, carol);
    const cid = await talking(alice, bob);
    // Bob holds Carol's request.
    await carol.messaging.start("preprod", BOB_SEEDELF, "a request");
    await carol.messaging.whenIdle();
    await synced(bob);
    // What Bob's WebAssembly is asked from here.
    const wasm = loadTestWasm();
    let parses = 0;
    const handed: boolean[] = [];
    bob.restart({
      ...wasm,
      messagingRequestsInfo: (record) => {
        parses++;
        return wasm.messagingRequestsInfo(record);
      },
      messagingReceive: (key, request) => {
        handed.push("requests" in (JSON.parse(request) as object));
        return wasm.messagingReceive(key, request);
      },
    });
    for (const text of ["one", "two", "three"]) await alice.messaging.send("preprod", cid, text);
    await alice.messaging.whenIdle();
    await synced(bob);
    for (let i = 0; i < 3; i++) expect((await bob.messaging.overview("preprod")).requests).toHaveLength(1);
    // Three session messages of a held conversation: the requests' record is handed to none of them.
    expect(handed).toEqual([false, false, false]);
    expect(parses).toBe(0);
    expect((await texts(bob, cid)).slice(-3)).toEqual(["in:one", "in:two", "in:three"]);
  });

  it("keeps what each record takes true as its skipped keys expire (ratchet#2, worker-state#1)", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    // 600 of Bob's messages never reach Alice: his ratchet steps on a copy of his record, and only the last is posted.
    const wasm = loadTestWasm();
    let state = (await fileOf(bob, cid))!.state;
    let envelope = "";
    for (let i = 0; i < 600; i++) {
      const sent = JSON.parse(wasm.messagingSend(JSON.stringify({ conversation: state, plaintext: plaintextOf(`m${i}`) }))) as {
        conversation: string;
        envelope: string;
      };
      state = sent.conversation;
      envelope = sent.envelope;
    }
    relay.put("preprod", envelope);
    await synced(alice);
    const meta = async () => (await alice.store.get<Inbox>("messaging.preprod"))!.conversations[cid]!;
    const sealed = async () => (await alice.local.get<{ data: string }>(PRIVATE_PREFIX + (await recordName(alice, cid))))!.data.length;
    const big = await sealed();
    expect(Math.abs((await meta()).bytes - big)).toBeLessThanOrEqual(4);
    // 48 hours on, the keys expire and the record shrinks: what the inbox counts follows it.
    await busyFor(49 * 3600_000, alice, bob);
    await synced(alice);
    expect(await sealed()).toBeLessThan(big);
    expect(Math.abs((await meta()).bytes - (await sealed()))).toBeLessThanOrEqual(4);
  }, 60_000);
});
