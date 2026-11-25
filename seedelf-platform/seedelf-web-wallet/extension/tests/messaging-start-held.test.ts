// A new conversation never takes an ID the wallet already holds (1.10.0's second review, from an attack on the
// written security proof). A start depends only on the key, the handle, `to`, t and the draws: the worker rounds t down
// to ten minutes, the first-contact stamp is searched from 0, and a send depends only on the state, the text and its
// salt. So with a random source that repeats (stuck; a snapshot restored twice), two starts to one Seedelf, or two
// continuations of one conversation, in one ten-minute window make the same conversation, and their first messages are
// sealed under one key and nonce, at both layers, with different texts. The worker refuses the second press before
// anything of it is written, stamped or sealed: an ID it holds as a conversation or as a request (`invalid_state`, the
// crate's word for an ID its inbox holds), or as a tombstone (`deleted`); and a record's own ID that is taken.
//
// Each case replays the first press's draws for the second, as a snapshot restored twice would, and holds every
// envelope the test saw (posted to the relay, or sealed in a record or the outbox) to one rule: no two different
// envelopes share their header, their first 145 bytes (the register sealed to, its tag and the ephemeral point), which
// one message key and salt used for two texts makes equal while the ciphertexts differ. That check comes before the
// refusal's own, so without the guard it fails on the reuse itself.
//
// The same holds for a request accepted twice (the same review, later): an accept draws the responder's ratchet key,
// so a request an Accept left in its record, accepted again after its conversation was deleted and under the same
// draws, is the first accept's state again, and its first reply the first reply's key and salt. Accept refuses an ID a
// tombstone holds (`deleted`).
import { afterEach, describe, expect, it, vi } from "vitest";

import { PRIVATE_PREFIX } from "../src/background/private-store";
import {
  ALICE_SEEDELF,
  BOB_SEEDELF,
  fileOf,
  type FakeRelay,
  outboxOf,
  pair,
  type Party,
  PASSWORD,
  synced,
  talking,
  texts,
} from "./messaging-harness";

// A record's own ID, fixed where a test says: the draw `newRecordId` makes, repeated.
const ids = vi.hoisted(() => ({ fixed: undefined as string | undefined }));
vi.mock("../src/background/private-store", async (original) => {
  const real = await original<typeof import("../src/background/private-store")>();
  return { ...real, newRecordId: () => ids.fixed ?? real.newRecordId() };
});

/** An envelope's header: its first 145 bytes, in hex. */
const HEADER = 2 * 145;
const HELD = "The message was refused (invalid_state).";
const DELETED = "The message was refused (deleted).";

/**
 * The random source every draw here comes from (the module's, and the worker's own), made to repeat: `record` keeps
 * each draw, by its length, in order; `replay` hands the same ones out again, in order, and goes live once they run out.
 */
function source() {
  const real = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  const tapes = new Map<number, Uint8Array[]>();
  let at = new Map<number, number>();
  let mode: "live" | "record" | "replay" = "live";
  const spy = vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(((into: Uint8Array<ArrayBuffer>) => {
    const bytes = new Uint8Array(into.buffer, into.byteOffset, into.byteLength);
    const tape = tapes.get(bytes.length) ?? [];
    if (mode === "replay") {
      const next = at.get(bytes.length) ?? 0;
      at.set(bytes.length, next + 1);
      if (next < tape.length) {
        bytes.set(tape[next]!);
        return into;
      }
    }
    real(bytes);
    if (mode === "record") tapes.set(bytes.length, [...tape, bytes.slice()]);
    return into;
  }) as never);
  return {
    record: () => {
      tapes.clear();
      mode = "record";
    },
    replay: () => {
      at = new Map();
      mode = "replay";
    },
    live: () => void (mode = "live"),
    restore: () => spy.mockRestore(),
  };
}

/** Every envelope posted to `relay` from here on, in hex, by whoever posts. */
function posts(relay: FakeRelay): string[] {
  const posted: string[] = [];
  const answer = relay.fetch.bind(relay);
  relay.fetch = async (url, init) => {
    if (init.method === "POST") posted.push(Buffer.from(new Uint8Array(init.body as ArrayBuffer)).subarray(8).toString("hex"));
    return answer(url, init);
  };
  return posted;
}

/** Every envelope `p` holds sealed now, in hex: in its outbox record and in its conversations' records. */
async function sealed(p: Party): Promise<string[]> {
  const out = ((await outboxOf(p)) ?? []).map((w) => Buffer.from(w.envelope, "base64").toString("hex"));
  for (const c of (await p.messaging.overview("preprod")).conversations) {
    for (const e of (await fileOf(p, c.cid))?.history ?? []) if (e.envelope) out.push(e.envelope);
  }
  return out;
}

/** The pairs of different envelopes that share their header: one key and nonce over two messages. None, ever. */
function reused(envelopes: readonly string[]): string[] {
  const all = [...new Set(envelopes)];
  const pairs: string[] = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (all[i]!.slice(0, HEADER) === all[j]!.slice(0, HEADER)) pairs.push(`envelopes ${i} and ${j} share their first 145 bytes: ${all[i]!.slice(0, 24)}…`);
    }
  }
  return pairs;
}

const records = (p: Party) => p.local.keys(`${PRIVATE_PREFIX}conversation.preprod.`);
/** A press's outcome, kept for after the reuse check: its cid, or the words it was refused in. */
const outcome = (press: Promise<string>) =>
  press.then(
    (cid) => ({ cid }),
    (e: Error) => ({ refused: e.message }),
  );

describe("a new conversation whose ID the wallet already holds (1.10.0's second review)", { timeout: 30_000 }, () => {
  let draws: ReturnType<typeof source> | undefined;
  afterEach(() => {
    draws?.restore();
    draws = undefined;
    ids.fixed = undefined;
  });

  it("refuses a second start to one Seedelf in one ten-minute window, the source repeating: one conversation, one envelope", async () => {
    const { relay, alice, bob } = await pair();
    const posted = posts(relay);
    draws = source();
    draws.record();
    const first = await alice.messaging.start("preprod", BOB_SEEDELF, "the first text");
    await alice.messaging.whenIdle();
    draws.live();
    const seen = [...(await sealed(alice))];
    const record = (await records(alice))[0]!;
    const before = alice.local.data.get(record);
    alice.trace.length = 0;

    // The same draws again, the same window, another text.
    draws.replay();
    const second = await outcome(alice.messaging.start("preprod", BOB_SEEDELF, "another text, under the same draws"));
    await alice.messaging.whenIdle();
    // And Start again from the first one, which makes a start of its own.
    draws.replay();
    const again = await outcome(alice.messaging.restart("preprod", first, "a third text"));
    await alice.messaging.whenIdle();
    draws.live();
    seen.push(...(await sealed(alice)));

    // No key and nonce over two messages, in what was posted or what was sealed: without the guard, this is what fails.
    expect(reused([...posted, ...seen])).toEqual([]);
    expect(new Set(posted).size).toBe(1);
    // Refused, in the worker's words, with nothing written: the first conversation, its record and its message as they were.
    expect(second).toEqual({ refused: HELD });
    expect(again).toEqual({ refused: HELD });
    expect(alice.trace.filter((s) => /^(set|remove|POST) /.test(s))).toEqual([]);
    expect(await records(alice)).toEqual([record]);
    expect(alice.local.data.get(record)).toBe(before);
    const overview = await alice.messaging.overview("preprod");
    expect(overview.conversations.map((c) => [c.cid, c.restartedAs])).toEqual([[first, undefined]]);
    expect(await texts(alice, first)).toEqual(["out:the first text"]);
    // And Bob reads the one message that went.
    await synced(bob);
    expect((await bob.messaging.request("preprod", first)).map((m) => m.text)).toEqual(["the first text"]);
  });

  it("refuses a second continuation of one conversation, the source repeating", async () => {
    const { relay, alice, bob } = await pair();
    const posted = posts(relay);
    const old = await talking(alice, bob);
    draws = source();
    draws.record();
    const first = await alice.messaging.continueIn("preprod", old, "continued here");
    await alice.messaging.whenIdle();
    draws.live();
    const seen = [...(await sealed(alice))];
    alice.trace.length = 0;

    draws.replay();
    const second = await outcome(alice.messaging.continueIn("preprod", old, "continued again, with another text"));
    await alice.messaging.whenIdle();
    draws.live();
    seen.push(...(await sealed(alice)));

    expect(reused([...posted, ...seen])).toEqual([]);
    // Three went, each under its own header: the first message, Bob's reply, the continuation's first.
    expect(new Set(posted).size).toBe(3);
    expect(second).toEqual({ refused: HELD });
    expect(alice.trace.filter((s) => /^(set|remove|POST) /.test(s))).toEqual([]);
    expect((await alice.messaging.overview("preprod")).conversations.map((c) => c.cid).sort()).toEqual([old, first].sort());
    expect(await records(alice)).toHaveLength(2);
    expect(await texts(alice, first)).toEqual(["out:continued here"]);
  });

  it("control: with a source that works, the same two presses both go through, each with its own ID and header", async () => {
    const { relay, alice } = await pair();
    const posted = posts(relay);
    // A tombstone of another conversation's is in the way of neither.
    const gone = await alice.messaging.start("preprod", BOB_SEEDELF, "deleted before the two");
    await alice.messaging.whenIdle();
    await alice.messaging.remove("preprod", gone);
    draws = source();
    draws.record();
    const first = await outcome(alice.messaging.start("preprod", BOB_SEEDELF, "the first text"));
    await alice.messaging.whenIdle();
    const second = await outcome(alice.messaging.start("preprod", BOB_SEEDELF, "another text"));
    await alice.messaging.whenIdle();
    draws.live();

    expect(reused([...posted, ...(await sealed(alice))])).toEqual([]);
    expect(new Set(posted).size).toBe(3);
    expect("cid" in first && "cid" in second && first.cid !== second.cid).toBe(true);
    expect(await records(alice)).toHaveLength(2);
    expect((await alice.messaging.overview("preprod")).conversations).toHaveLength(2);
  });

  it("refuses a start whose ID a tombstone holds: the first deleted, the same draws, the same window", async () => {
    const { relay, alice } = await pair();
    const posted = posts(relay);
    draws = source();
    draws.record();
    const first = await alice.messaging.start("preprod", BOB_SEEDELF, "the first text");
    await alice.messaging.whenIdle();
    draws.live();
    const seen = [...(await sealed(alice))];
    await alice.messaging.remove("preprod", first);
    alice.trace.length = 0;

    draws.replay();
    const second = await outcome(alice.messaging.start("preprod", BOB_SEEDELF, "another text, after the deletion"));
    await alice.messaging.whenIdle();
    draws.live();
    seen.push(...(await sealed(alice)));

    expect(reused([...posted, ...seen])).toEqual([]);
    expect(new Set(posted).size).toBe(1);
    expect(second).toEqual({ refused: DELETED });
    expect(alice.trace.filter((s) => /^(set|remove|POST) /.test(s))).toEqual([]);
    expect((await alice.messaging.overview("preprod")).conversations).toEqual([]);
    expect(await records(alice)).toEqual([]);
  });

  it("refuses a start whose ID is a request's the inbox lists", async () => {
    const { alice, bob } = await pair();
    draws = source();
    draws.record();
    const theirs = await alice.messaging.start("preprod", BOB_SEEDELF, "hello Bob");
    await alice.messaging.whenIdle();
    draws.live();
    await synced(bob);
    expect((await bob.messaging.overview("preprod")).requests.map((r) => r.cid)).toEqual([theirs]);
    bob.trace.length = 0;

    // Bob's own start draws what Alice's drew: its ID first.
    draws.replay();
    const own = await outcome(bob.messaging.start("preprod", ALICE_SEEDELF, "hello Alice"));
    await bob.messaging.whenIdle();
    draws.live();

    expect(own).toEqual({ refused: HELD });
    expect(bob.trace.filter((s) => /^(set|remove|POST) /.test(s))).toEqual([]);
    const overview = await bob.messaging.overview("preprod");
    expect([overview.requests.map((r) => r.cid), overview.conversations]).toEqual([[theirs], []]);
    expect((await bob.messaging.request("preprod", theirs)).map((m) => m.text)).toEqual(["hello Bob"]);
  });

  it("refuses a new conversation whose record's own ID is taken: the first one's record is never written over", async () => {
    const { alice } = await pair();
    ids.fixed = "ab".repeat(16);
    const first = await alice.messaging.start("preprod", BOB_SEEDELF, "the first text");
    await alice.messaging.whenIdle();
    const record = `${PRIVATE_PREFIX}conversation.preprod.${ids.fixed}`;
    expect(await records(alice)).toEqual([record]);
    const before = alice.local.data.get(record);
    alice.trace.length = 0;

    // Another conversation, its own ID and keys (the draws work): only the record's ID repeats.
    const second = await outcome(alice.messaging.start("preprod", BOB_SEEDELF, "another text"));
    await alice.messaging.whenIdle();
    expect(second).toEqual({ refused: HELD });
    expect(alice.trace.filter((s) => /^(set|remove|POST) /.test(s))).toEqual([]);
    expect(alice.local.data.get(record)).toBe(before);
    expect((await alice.messaging.overview("preprod")).conversations.map((c) => c.cid)).toEqual([first]);
    expect(await texts(alice, first)).toEqual(["out:the first text"]);
  });

  it("refuses a request accepted again after its conversation was deleted, the first accept's draws replayed: no reply under the first's key", async () => {
    const { relay, alice, bob } = await pair();
    const posted = posts(relay);
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "hello Bob");
    await alice.messaging.whenIdle();
    await synced(bob);
    // The first accept leaves the request in its record (that record's write refused, the conversation listed), and
    // Bob replies: the responder's ratchet key and the reply's salt are drawn here.
    let refused = 0;
    bob.beforeWrite = (name) => {
      if (name === "messagingRequests.preprod" && refused++ === 0) throw new Error("QUOTA_BYTES quota exceeded");
    };
    draws = source();
    draws.record();
    await bob.messaging.accept("preprod", cid);
    await bob.messaging.send("preprod", cid, "the first reply");
    await bob.messaging.whenIdle();
    draws.live();
    bob.beforeWrite = undefined;
    expect(refused).toBe(1);
    const seen = [...(await sealed(bob))];
    // Deleted, the deletion's own repair of the requests' record refused as the accept's write was (it would take the
    // request out first, messaging-accept-left.test.ts); the next unlock's repair lists the request again.
    bob.beforeWrite = (name) => {
      if (name === "messagingRequests.preprod" && refused++ === 1) throw new Error("QUOTA_BYTES quota exceeded");
    };
    await bob.messaging.remove("preprod", cid);
    bob.beforeWrite = undefined;
    expect(refused).toBe(2);
    await bob.wallet.lock();
    await bob.wallet.unlock(PASSWORD);
    await synced(bob);
    await synced(bob);
    expect((await bob.messaging.overview("preprod")).requests.map((r) => r.cid)).toEqual([cid]);
    await bob.messaging.whenIdle();
    bob.trace.length = 0;

    // The same draws again: the same responder's keys, the same salt, another text.
    draws.replay();
    const again = await bob.messaging.accept("preprod", cid).then(
      () => "accepted",
      (e: Error) => e.message,
    );
    const reply = await bob.messaging.send("preprod", cid, "another reply, under the same draws").then(
      () => "sent",
      (e: Error) => e.message,
    );
    await bob.messaging.whenIdle();
    draws.live();
    seen.push(...(await sealed(bob)));

    // Alice's first message and Bob's one reply went, each under its own header: without the guard, a second reply
    // goes under the first reply's.
    expect(reused([...posted, ...seen])).toEqual([]);
    expect(new Set(posted).size).toBe(2);
    expect(again).toBe(DELETED);
    expect(reply).not.toBe("sent");
    expect(bob.trace.filter((s) => /^(set|remove|POST) /.test(s))).toEqual([]);
    expect((await bob.messaging.overview("preprod")).conversations).toEqual([]);
  });
});
