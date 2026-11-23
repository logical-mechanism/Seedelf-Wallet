// The inbox's write failing once right after a conversation record's (the
// 1.10.0 gate's f4), in a worker that lives on: a wallet page on screen polls
// every 10 s and keeps it alive, so there's no lock and no restart. What the
// inbox shows of that conversation is set right from its record at the
// take's next bookkeeping write (each read's start, `noteOwn`, and its end),
// never in the sweep's slot before the post; and a press whose record holds
// its message succeeds, its message posted once, since only the user's own
// press widens what the post reads.
//
// The take path: the take stops at the refusal (bookkeeping with no room), its
// read's envelopes kept in the take record, resumes at the next sync, and the
// reply's envelope is refused as a duplicate by the ratchet the record already
// holds, so `receive` writes nothing: the noted entry is set right all the
// same. The press path: a send whose record holds the message pending behind
// the refused inbox write.
import { describe, expect, it } from "vitest";

import { PRIVATE_PREFIX } from "../src/background/private-store";
import {
  BOB_SEEDELF,
  busyFor,
  CAROL_SEEDELF,
  fileOf,
  pair,
  party,
  type Party,
  recordName,
  synced,
  talking,
  texts,
  turnOn,
} from "./messaging-harness";

const INBOX_KEY = PRIVATE_PREFIX + "messaging.preprod";

/**
 * `p`'s chrome.storage.local refuses, once, the inbox's next write after a write of conversation record `name`, as a
 * browser refuses one (an I/O error, its own quota): nothing of it is stored. Says what it saw.
 */
function refuseInboxOnceAfter(p: Party, name: string): { recordWritten: boolean; refused: number } {
  const seen = { recordWritten: false, refused: 0 };
  const set = p.local.set.bind(p.local);
  p.local.set = async (key, value) => {
    if (key === PRIVATE_PREFIX + name) seen.recordWritten = true;
    else if (key === INBOX_KEY && seen.recordWritten && seen.refused === 0) {
      seen.refused++;
      throw new Error("IO error: the write was refused");
    }
    await set(key, value);
  };
  return seen;
}

/** Alice writes first to Bob, who reads it some minutes on, accepts it and replies a minute before Alice's next sync. */
async function replied(alice: Party, bob: Party, ...others: Party[]): Promise<string> {
  const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "hello Bob");
  await alice.messaging.whenIdle();
  await busyFor(5 * 60_000, alice, bob, ...others);
  await synced(bob);
  await bob.messaging.accept("preprod", cid);
  await bob.messaging.send("preprod", cid, "hi Alice");
  await bob.messaging.whenIdle();
  await busyFor(60_000, alice, bob, ...others);
  return cid;
}

/** The next ticks of a wallet page's poll, 10 s apart: the same worker and the same unlock. */
async function ticks(n: number, p: Party, ...others: Party[]) {
  for (let i = 0; i < n; i++) {
    await busyFor(10_000, p, ...others);
    await synced(p);
  }
}

const requests = (p: Party) => p.trace.filter((c) => c.startsWith("GET ") || c.startsWith("POST "));

// Each test bounded: one that fails mid-take fails here, never hangs the run.
describe("finding 4: the inbox's write refused once after a conversation record's (verify-f4)", { timeout: 60_000 }, () => {
  it("take path: a reply whose record was written and whose inbox write was refused is counted, previewed and answered once the take resumes, in the same worker and unlock", async () => {
    const { alice, bob } = await pair();
    const cid = await replied(alice, bob);
    const before = (await alice.messaging.overview("preprod")).conversations[0]!;

    // Alice's sync after this unlock's sweep (turnOn's): the take writes the reply's record, and the inbox's write
    // after it is refused once.
    const seen = refuseInboxOnceAfter(alice, await recordName(alice, cid));
    await synced(alice);
    expect(seen).toEqual({ recordWritten: true, refused: 1 });
    const reply = (await fileOf(alice, cid))!.history.at(-1)!;
    expect(reply).toMatchObject({ dir: "in", text: "hi Alice" });
    expect(reply.at).toBeGreaterThan(before.lastAt);
    // The refusal took: bookkeeping with no room (ReserveReached), the take stopped with its batch kept.
    expect((await alice.messaging.overview("preprod")).full).toBe(true);

    // Three ticks on, no lock, no restart: the take resumed and ended (nothing full), and the cursor is past the reply.
    await ticks(3, alice, bob);
    const after = await alice.messaging.overview("preprod");
    expect(after.full).toBeUndefined();
    const listed = after.conversations[0]!;
    expect.soft(listed.unread, "the reply is counted unread: the top bar, Home's row and the list say so").toBe(1);
    expect.soft(listed.last, "the list previews the reply").toEqual({ dir: "in", text: "hi Alice" });
    expect.soft(listed.lastAt, "the list orders the conversation by the reply").toBe(reply.at);

    // 48 hours from the start, still the same worker: an answered conversation says no "No reply", offers no Start again.
    await busyFor(48 * 3600_000, alice, bob);
    await synced(alice);
    expect.soft((await alice.messaging.overview("preprod")).conversations[0]!.unanswered, "no 'No reply' over a reply").toBe(false);
    expect.soft((await alice.messaging.thread("preprod", cid)).conversation.unanswered, "the thread offers no Start again").toBe(false);

    // The worker's next life (same unlock): its first sync's sweep sets it all right from the record.
    alice.restart();
    await synced(alice);
    expect((await alice.messaging.overview("preprod")).conversations[0]).toMatchObject({
      last: { dir: "in", text: "hi Alice" },
      lastAt: reply.at,
      unanswered: false,
    });
  });

  it("control: the same flow with no refusal shows the reply counted, previewed and answered", async () => {
    const { alice, bob } = await pair();
    const cid = await replied(alice, bob);
    await synced(alice);
    const reply = (await fileOf(alice, cid))!.history.at(-1)!;
    await ticks(3, alice, bob);
    expect((await alice.messaging.overview("preprod")).conversations[0]).toMatchObject({
      unread: 1,
      last: { dir: "in", text: "hi Alice" },
      lastAt: reply.at,
    });
    await busyFor(48 * 3600_000, alice, bob);
    await synced(alice);
    expect((await alice.messaging.overview("preprod")).conversations[0]!.unanswered).toBe(false);
  });

  it("press path: a message whose record holds it pending behind a refused inbox write is posted at a later tick of the same worker and unlock", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    expect((await alice.messaging.overview("preprod")).conversations[0]!.outbox).toBe(0);
    const seen = refuseInboxOnceAfter(alice, await recordName(alice, cid));
    const told = await alice.messaging.send("preprod", cid, "uncounted").then(
      () => "resolved",
      (e: unknown) => (e as Error).message,
    );
    expect(seen).toEqual({ recordWritten: true, refused: 1 });
    // The record keeps the message, sealed: the ratchet stepped for it, so it's the one to post.
    expect((await fileOf(alice, cid))!.history.at(-1)).toMatchObject({ text: "uncounted" });
    expect((await fileOf(alice, cid))!.history.at(-1)!.envelope ?? "posted").toBeTruthy();
    // A message the wallet keeps and sends isn't said to be refused (48480cf8 says "The message was refused (full).").
    expect.soft(told, "the press isn't told 'refused' for a message it then sends").not.toMatch(/refused/);

    await ticks(3, alice, bob);
    expect.soft((await fileOf(alice, cid))!.history.at(-1)!.sent, "posted at a later tick").toBe("posted");
    expect.soft((await alice.messaging.overview("preprod")).conversations[0]!.outbox, "the list counts what's waiting").toBe(
      (await fileOf(alice, cid))!.history.filter((e) => e.sent === "pending" || e.sent === "queued").length,
    );
    await synced(bob);
    expect.soft((await texts(bob, cid)).filter((m) => m === "in:uncounted"), "Bob reads it, once").toHaveLength(1);

    // The worker's next life: its first sync's sweep counts it, and its post posts it, once.
    alice.restart();
    await synced(alice);
    expect((await fileOf(alice, cid))!.history.at(-1)!.sent).toBe("posted");
    await synced(bob);
    expect((await texts(bob, cid)).filter((m) => m === "in:uncounted")).toHaveLength(1);
  });

  it("THE RULE, as the take path's recovery must keep it: the wallet whose envelope's write was refused asks the relay what a wallet with no envelope on those pages asks, sync by sync, and its take's own work comes after each sync's requests", async () => {
    const { relay, directory, alice, bob } = await pair();
    // Carol reads the same pool from the same point, and nothing on it is hers.
    const carol = await party(15, relay, directory, CAROL_SEEDELF);
    await turnOn(carol);
    const cid = await replied(alice, bob, carol);
    refuseInboxOnceAfter(alice, await recordName(alice, cid));
    const syncs: Array<{ alice: string[]; carol: string[] }> = [];
    for (let i = 0; i < 4; i++) {
      alice.trace.length = 0;
      carol.trace.length = 0;
      await synced(alice);
      await synced(carol);
      let lastRequest = -1;
      alice.trace.forEach((c, at) => {
        if (/^(GET|POST) /.test(c)) lastRequest = at;
      });
      const firstTake = alice.trace.findIndex((c) => c === "open" || c === "receive" || /^(get|set) conversation\./.test(c));
      if (firstTake >= 0) expect(firstTake, `sync ${i}: ${alice.trace.join(" | ")}`).toBeGreaterThan(lastRequest);
      syncs.push({ alice: requests(alice), carol: requests(carol) });
      await busyFor(10_000, alice, bob, carol);
    }
    expect(syncs.map((s) => s.alice)).toEqual(syncs.map((s) => s.carol));
    expect(syncs[0]!.alice.length).toBeGreaterThan(0);
  });

  it("a read of storage failing inside the inbox's write after the record's: the envelope tried again, refused as taken, and the same read's end sets the entry right, in the same sync", async () => {
    const { alice, bob } = await pair();
    const cid = await replied(alice, bob);
    const name = await recordName(alice, cid);
    // A new worker, knowing nothing of what its records take yet: the inbox's write after the record's reads what the
    // inbox takes as stored. That read fails once, right after the record's write, as Chrome's does.
    alice.restart();
    await synced(alice);
    await bob.messaging.send("preprod", cid, "the reply's second");
    await bob.messaging.whenIdle();
    alice.restart();
    let recordWritten = false;
    let failed = 0;
    const set = alice.local.set.bind(alice.local);
    alice.local.set = async (key, value) => {
      if (key === PRIVATE_PREFIX + name) recordWritten = true;
      await set(key, value);
    };
    const get = alice.local.get.bind(alice.local);
    alice.local.get = (async (key: string) => {
      if (key === INBOX_KEY && recordWritten && failed === 0) {
        failed++;
        throw new Error("IO error: the storage area couldn't be read");
      }
      return get(key);
    }) as typeof alice.local.get;
    alice.trace.length = 0;
    await synced(alice);
    alice.local.get = get;
    alice.local.set = set;
    expect(failed).toBe(1);
    // Tried again in place: opened twice, the second refused by the ratchet that already took it. Nothing passed over.
    expect(alice.trace.filter((s) => s === "open").length).toBeGreaterThanOrEqual(2);
    expect(alice.passedOver).toEqual([]);
    // In the same sync, no restart, no lock: the list says what the record holds.
    const reply = (await fileOf(alice, cid))!.history.at(-1)!;
    expect(reply).toMatchObject({ dir: "in", text: "the reply's second" });
    expect((await alice.messaging.overview("preprod")).conversations[0]).toMatchObject({
      unread: 2,
      last: { dir: "in", text: "the reply's second" },
      lastAt: reply.at,
    });
  });
});
