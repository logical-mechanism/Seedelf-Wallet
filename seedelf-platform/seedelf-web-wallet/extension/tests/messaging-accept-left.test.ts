// A request an Accept left in the requests' record always leaves it (1.10.0's second review, its last pass). Accept
// lists the conversation (its second write) before it writes the requests' record without the request (its third): a
// stop between the two, or a third write the browser refuses, leaves the request in its record beside its conversation.
// The inbox noted that by holding no nonce for the record, which the first window's repair compared. But every write
// of the record notes its nonce again: a press that wrote it before the repair ran (Accept another, Delete a request),
// or a stranger's first message taken by the same worker, made the record look settled, and no repair ever read it.
// The other side's continuation of that conversation then threw in the crate (one conversation ID in two records) and
// was passed over at every take, without a word.
//
// Chrome stops the worker about 30 seconds after its last activity, the wallet still unlocked, so a stop between two
// writes is an ordinary event and nothing here may wait in memory. The inbox keeps a mark, stored in the very write
// that lists the conversation, which no writer of the record unsets: only the repair, once it has read the record, and
// the accept that set it, once its own write of the record went through with no earlier mark standing. And the repair
// runs before a take hands the crate the record, and before a conversation is deleted.
//
// The harness fails a test whose take passes a throw over (`passOverOk` stays false here): each case below is also
// the claim that nothing was.
import { describe, expect, it } from "vitest";

import { BOB_SEEDELF, CAROL_SEEDELF, loadTestWasm, pair, party, PASSWORD, requestsOf, synced, texts, turnOn, type Party } from "./messaging-harness";

const FIRST = "hello Bob, it's Alice";
const CAROLS = "hello Bob, it's Carol";

/** The requests the stored record holds, by cid: read by the test with the module, no key needed. */
async function requestsHeld(p: Party): Promise<string[]> {
  const stored = await requestsOf(p);
  if (!stored?.requests) return [];
  const listed = JSON.parse(loadTestWasm().messagingRequestsInfo(Buffer.from(stored.requests, "base64").toString("hex"))) as Array<{ cid: string }>;
  return listed.map((r) => r.cid);
}

type StoredInbox = { requestLeft?: true; requestsAs?: string; conversations: Record<string, unknown>; requestsShown?: Record<string, unknown> };
const inboxOf = async (p: Party) => (await p.store.get<StoredInbox>("messaging.preprod"))!;
/** Whether the stored inbox marks a request an Accept left in the record. */
const marked = async (p: Party) => (await inboxOf(p)).requestLeft === true;

/** Alice, Bob and Carol, Messages on; Alice's first message X a request at Bob, and Carol's Z too where `withCarols`. */
async function begun(withCarols: boolean) {
  const { relay, directory, alice, bob } = await pair();
  const carol = await party(15, relay, directory, CAROL_SEEDELF);
  await turnOn(carol);
  const x = await alice.messaging.start("preprod", BOB_SEEDELF, FIRST);
  await alice.messaging.whenIdle();
  let z = "";
  if (withCarols) {
    z = await carol.messaging.start("preprod", BOB_SEEDELF, CAROLS);
    await carol.messaging.whenIdle();
  }
  await synced(bob);
  expect((await bob.messaging.overview("preprod")).requests.map((r) => r.cid).sort()).toEqual([x, ...(z ? [z] : [])].sort());
  return { alice, bob, carol, x, z };
}

/** Bob accepts `cid`, the requests' record's write (Accept's third) refused once: accepted all the same. */
async function acceptRefused(bob: Party, cid: string) {
  let refused = 0;
  bob.beforeWrite = (name) => {
    if (name === "messagingRequests.preprod" && refused++ === 0) throw new Error("QUOTA_BYTES quota exceeded");
  };
  await bob.messaging.accept("preprod", cid);
  bob.beforeWrite = undefined;
  expect(refused).toBe(1);
}

/** Bob accepts `cid`, the wallet locking as the requests' record is written: the worker stops, and the user unlocks. */
async function acceptLocked(bob: Party, cid: string) {
  let writes = 0;
  bob.beforeWrite = async () => {
    if (++writes === 3) await bob.wallet.lock();
  };
  await bob.messaging.accept("preprod", cid).catch(() => undefined);
  bob.beforeWrite = undefined;
  expect(writes).toBe(3);
  bob.restart();
  await bob.wallet.unlock(PASSWORD);
}

type Others = { requests: string[]; conversations: string[] };

/**
 * What must hold from here, whatever came before the repair: the request is out of its record and never listed beside
 * its conversation; the exchange goes on, and Alice's continuation of X reaches Bob as a request; and once Bob deletes
 * X, nothing of it comes back.
 */
async function goesOn(who: { alice: Party; bob: Party; x: string }, others: Others) {
  await repaired(who, others);
  await continued(who, others);
}

/** The next reads' windows have set the record right, and a lock and an unlock change nothing of it. */
async function repaired({ bob, x }: { bob: Party; x: string }, others: Others) {
  await synced(bob);
  await synced(bob);
  expect(await requestsHeld(bob)).toEqual(others.requests);
  expect(await marked(bob)).toBe(false);
  // A lock and an unlock change nothing of it.
  await bob.wallet.lock();
  await bob.wallet.unlock(PASSWORD);
  await synced(bob);
  const overview = await bob.messaging.overview("preprod");
  expect(overview.conversations.map((c) => c.cid).sort()).toEqual([x, ...others.conversations].sort());
  expect(overview.requests.map((r) => r.cid)).toEqual(others.requests);
  expect(await requestsHeld(bob)).toEqual(others.requests);
}

/** The exchange in X goes on, and Alice continues it in a new conversation: Bob gets the continuation. Then Bob deletes X. */
async function continued({ alice, bob, x }: { alice: Party; bob: Party; x: string }, others: Others) {
  await bob.messaging.send("preprod", x, "hi Alice");
  await bob.messaging.whenIdle();
  await synced(alice);
  expect(await texts(alice, x)).toEqual([`out:${FIRST}`, "in:hi Alice"]);
  const y = await alice.messaging.continueIn("preprod", x, "continued in a new one");
  await alice.messaging.whenIdle();
  await synced(bob);
  await synced(bob);
  expect(bob.passedOver).toEqual([]);
  const after = await bob.messaging.overview("preprod");
  expect(after.requests.map((r) => r.cid)).toEqual([...others.requests, y]);
  expect((await bob.messaging.request("preprod", y)).map((m) => m.text)).toEqual(["continued in a new one"]);
  expect(await requestsHeld(bob)).toEqual([...others.requests, y]);
  expect(await marked(bob)).toBe(false);

  // Bob deletes X: no request of it is left to be listed again.
  await bob.messaging.remove("preprod", x);
  await bob.wallet.lock();
  await bob.wallet.unlock(PASSWORD);
  await synced(bob);
  await synced(bob);
  const end = await bob.messaging.overview("preprod");
  expect(end.requests.map((r) => r.cid)).toEqual([...others.requests, y]);
  expect(end.conversations.map((c) => c.cid).sort()).toEqual([...others.conversations].sort());
  expect(await requestsHeld(bob)).toEqual([...others.requests, y]);
}

describe("a request an Accept left in its record, and a write of that record before the repair (1.10.0's second review)", { timeout: 60_000 }, () => {
  it("A: the record's write refused, then a stranger's first message taken by the same worker", async () => {
    const { alice, bob, carol, x } = await begun(false);
    await acceptRefused(bob, x);
    expect(await requestsHeld(bob)).toEqual([x]);
    expect(await marked(bob)).toBe(true);
    // A stranger's first message arrives in the same unlock, the same worker: nobody presses anything.
    const z = await carol.messaging.start("preprod", BOB_SEEDELF, CAROLS);
    await carol.messaging.whenIdle();
    await synced(bob);
    expect(await requestsHeld(bob)).toEqual([z]);
    await goesOn({ alice, bob, x }, { requests: [z], conversations: [] });
  });

  it("A, the continuation first: the record's write refused, then the other side's continuation taken by the same worker", async () => {
    const { alice, bob, x } = await begun(false);
    await acceptRefused(bob, x);
    // Nothing arrives, the worker goes on: no window of its own reads the record, which waits, marked.
    await synced(bob);
    expect(await requestsHeld(bob)).toEqual([x]);
    expect(await marked(bob)).toBe(true);
    // Bob's reply goes out, and Alice continues: the next thing Bob's worker takes is the continuation itself.
    await continued({ alice, bob, x }, { requests: [], conversations: [] });
  });

  for (const stop of ["a lock at the record's write, the worker stopped", "the worker stopped after the inbox's write, the wallet still unlocked"] as const) {
    for (const press of ["Accept another", "Delete a request"] as const) {
      it(`B: ${stop}; then ${press} before the first window`, async () => {
        const { alice, bob, x, z } = await begun(true);
        if (stop.startsWith("a lock")) await acceptLocked(bob, x);
        else {
          // Chrome stops the worker between Accept's second write and its third: storage as that leaves it (the third
          // refused), and a new service over it, nothing of the first one's memory.
          await acceptRefused(bob, x);
          bob.restart();
        }
        expect(await requestsHeld(bob)).toEqual([x, z]);
        expect(await marked(bob)).toBe(true);
        // The first thing the new worker does: a press that writes the requests' record, before any window's repair.
        bob.trace.length = 0;
        if (press === "Accept another") await bob.messaging.accept("preprod", z);
        else await bob.messaging.remove("preprod", z);
        expect(bob.trace.filter((s) => /^(GET|POST|chain) /.test(s))).toEqual([]);
        if (press === "Accept another") {
          // It wrote the record, X still in it, and noted its nonce: the mark stands all the same, so the repair reads it.
          expect(await requestsHeld(bob)).toEqual([x]);
          expect(await marked(bob)).toBe(true);
          expect((await inboxOf(bob)).requestsAs).toBeDefined();
        } else {
          // A deletion repairs first: X left the record before Z did.
          expect(await requestsHeld(bob)).toEqual([]);
          expect(await marked(bob)).toBe(false);
        }
        await goesOn({ alice, bob, x }, { requests: [], conversations: press === "Accept another" ? [z] : [] });
      });
    }
  }

  it("control: no write of the record before the repair", async () => {
    const { alice, bob, x, z } = await begun(true);
    await acceptLocked(bob, x);
    expect(await requestsHeld(bob)).toEqual([x, z]);
    await goesOn({ alice, bob, x }, { requests: [z], conversations: [] });
  });

  it("control: an accept that writes all it writes leaves no mark, and no repair reads the record after it", async () => {
    const { bob, x, z } = await begun(true);
    await bob.messaging.accept("preprod", x);
    expect(await marked(bob)).toBe(false);
    expect(await requestsHeld(bob)).toEqual([z]);
    await bob.messaging.whenIdle();
    bob.trace.length = 0;
    await synced(bob);
    await synced(bob);
    // Nothing unsealed the requests' record, and nothing wrote it or the inbox.
    expect(bob.trace.filter((s) => /^(get|set|remove) messagingRequests\./.test(s) || s === "set messaging.preprod")).toEqual([]);
  });

  it("an accept after one that left its request never unsets the first one's mark, its own writes all through", async () => {
    const { bob, x, z } = await begun(true);
    await acceptRefused(bob, x);
    await bob.messaging.accept("preprod", z);
    // The record as the second accept wrote it: X still in it, and the inbox says so.
    expect(await requestsHeld(bob)).toEqual([x]);
    expect(await marked(bob)).toBe(true);
    // Chrome stops the worker; the next one's first window reads the record, for the mark alone: the nonces agree.
    const inbox = await inboxOf(bob);
    expect(inbox.requestsAs).toBeDefined();
    bob.restart();
    await synced(bob);
    expect(await requestsHeld(bob)).toEqual([]);
    expect(await marked(bob)).toBe(false);
    const after = await bob.messaging.overview("preprod");
    expect([after.conversations.map((c) => c.cid).sort(), after.requests]).toEqual([[x, z].sort(), []]);
  });

  it("Messages switched off: the mark waits in storage, Delete repairs first, and nothing is asked of the relay or the chain", async () => {
    const { bob, x, z } = await begun(true);
    await bob.messaging.switch("preprod", false);
    await bob.messaging.whenIdle();
    await acceptRefused(bob, x);
    // No window runs while the switch is off: the request stays in its record, marked, listed nowhere.
    bob.restart();
    await bob.messaging.whenIdle();
    expect(await requestsHeld(bob)).toEqual([x, z]);
    expect(await marked(bob)).toBe(true);
    expect((await bob.messaging.overview("preprod")).requests.map((r) => r.cid)).toEqual([z]);
    // The conversation deleted: its request leaves the record first, so no later repair lists it again.
    bob.trace.length = 0;
    const reads = bob.freshReads;
    await bob.messaging.remove("preprod", x);
    await bob.messaging.whenIdle();
    expect(bob.trace.filter((s) => /^(GET|POST|chain) /.test(s))).toEqual([]);
    expect(bob.freshReads).toBe(reads);
    expect(await requestsHeld(bob)).toEqual([z]);
    expect(await marked(bob)).toBe(false);
    // Turned on again: Carol's request as it was, and nothing of X.
    await bob.messaging.switch("preprod", true);
    await bob.messaging.whenIdle();
    await synced(bob);
    const after = await bob.messaging.overview("preprod");
    expect([after.requests.map((r) => r.cid), after.conversations]).toEqual([[z], []]);
    expect(await requestsHeld(bob)).toEqual([z]);
  });

  it("Messages switched off, then on: the first window's repair comes before any take", async () => {
    const { alice, bob, x } = await begun(false);
    await bob.messaging.switch("preprod", false);
    await bob.messaging.whenIdle();
    await acceptRefused(bob, x);
    bob.restart();
    expect(await marked(bob)).toBe(true);
    await bob.messaging.switch("preprod", true);
    await bob.messaging.whenIdle();
    await goesOn({ alice, bob, x }, { requests: [], conversations: [] });
  });

  it("an inbox the build before wrote (no mark, no nonce noted) loads, and is repaired by the nonce as it was", async () => {
    const { alice, bob, x, z } = await begun(true);
    await acceptRefused(bob, x);
    bob.restart();
    // As the build before this change left it after the same stop: the conversation listed, no nonce, no mark.
    const { requestLeft: _mark, ...old } = await inboxOf(bob);
    expect(old.requestsAs).toBeUndefined();
    await bob.store.set("messaging.preprod", old);
    expect(await marked(bob)).toBe(false);
    await goesOn({ alice, bob, x }, { requests: [z], conversations: [] });
  });

  it("drops no request that isn't a held conversation's: the repair leaves every other request whole", async () => {
    const { bob, carol, x, z } = await begun(true);
    await acceptRefused(bob, x);
    bob.restart();
    await synced(bob);
    await synced(bob);
    expect(await requestsHeld(bob)).toEqual([z]);
    expect((await bob.messaging.request("preprod", z)).map((m) => m.text)).toEqual([CAROLS]);
    // And it's still Carol's to be accepted: the exchange goes on from it.
    await bob.messaging.accept("preprod", z);
    await bob.messaging.send("preprod", z, "hi Carol");
    await bob.messaging.whenIdle();
    await synced(carol);
    expect(await texts(carol, z)).toEqual([`out:${CAROLS}`, "in:hi Carol"]);
  });
});
