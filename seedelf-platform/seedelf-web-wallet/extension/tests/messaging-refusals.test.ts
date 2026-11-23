// What the wallet does with an envelope it refuses (the 1.10.0 gate's W1 and
// W3): nothing. Anyone can address an envelope to a register, so a refusal
// that showed on a screen, in storage or as a request to a server would tell
// its sender, the relay or the chain's server which registers a wallet
// holds. No sync reads the chain, whatever a page held. One refusal leaves a
// mark, and it sends nothing: a message the conversation's own ratchet
// authenticated and couldn't reach (`too_far_ahead`, as the crate gives it
// once protocol.md's fix is in; stubbed here). A session message for a
// conversation this browser doesn't hold is dropped like the rest: any
// envelope sealed to any register of the key raises that refusal, so a count
// of them on screen would be the answer to whether that register is the key's.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { type Inbox, plaintextOf } from "../src/background/messaging";
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
  loadTestWasm,
  pair,
  type Party,
  party,
  records,
  synced,
  talking,
  turnOn,
  type Wasm,
} from "./messaging-harness";

/** Every refusal the bindings can give, read from their own table (wasm/src/messaging.rs `code`). */
const CODES: string[] = (() => {
  const source = readFileSync(new URL("../../wasm/src/messaging.rs", import.meta.url), "utf8");
  const table = source.slice(source.indexOf("pub fn code(error: Error)"), source.indexOf("// Reading what JavaScript passes"));
  return [...table.matchAll(/Error::\w+(?:\(_\))? => "([a-z_]+)"/g)].map((m) => m[1]!);
})();

/** A code no build gives: one a later crate may add, which nobody has thought of yet. */
const NEW_CODES = ["a_code_from_a_later_crate"];

/** An envelope's worth of bytes that is nobody's: the test's WebAssembly says it's the reader's, then refuses it. */
const junkEnvelope = (n: number) => "01" + n.toString(16).padStart(8, "0") + "5a".repeat(512 - 5);

/** WebAssembly that takes `junk` as the reader's own, opens it as `opened` says, and refuses to receive it with `code`. */
function refusing(junk: string, opened: unknown, code: string): Wasm {
  const wasm = loadTestWasm();
  return {
    ...wasm,
    // The module's answer, a digit an envelope (W17), with the junk's a 1.
    messagingScan: (key, envelopes) => {
      const batch = JSON.parse(envelopes) as string[];
      const bits = [...wasm.messagingScan(key, envelopes)];
      batch.forEach((e, i) => e === junk && (bits[i] = "1"));
      return bits.join("");
    },
    messagingOpen: (key, envelope) => (envelope === junk ? JSON.stringify(opened) : wasm.messagingOpen(key, envelope)),
    messagingReceive: (key, request) =>
      (JSON.parse(request) as { envelope: string }).envelope === junk ? JSON.stringify({ refused: code }) : wasm.messagingReceive(key, request),
  };
}

// Each test bounded: one that fails mid-take fails here, never hangs the run.
describe("an envelope the wallet refuses (W3)", { timeout: 30_000 }, () => {
  it("has every code the bindings give in this test's table, the protocol's call 16's among them (W17)", () => {
    expect(CODES.length).toBeGreaterThanOrEqual(34);
    expect(new Set(CODES).size).toBe(CODES.length);
    for (const code of [
      "unknown_handle",
      "invalid_base_proof",
      "too_far_ahead",
      "unknown_conversation",
      "deleted",
      "decryption_failed",
      "invalid_keys_proof",
      "request_full",
      "wrong_envelope_register",
    ]) {
      expect(CODES).toContain(code);
    }
  });

  it("changes nothing, tells no page and asks no server, whatever the refusal's code and whatever it was aimed at", async () => {
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const alice = await party(12, relay, directory, ALICE_SEEDELF);
    const bob = await party(24, relay, directory, BOB_SEEDELF);
    const carol = await party(15, relay, directory, CAROL_SEEDELF);
    await turnOn(alice, bob, carol);
    // Bob holds a conversation (Alice's) and a request (Carol's).
    const held = await talking(alice, bob);
    const request = await carol.messaging.start("preprod", BOB_SEEDELF, "a request");
    await carol.messaging.whenIdle();
    await synced(bob);
    await synced(bob);
    const base = new Map(bob.local.data);
    const before = await records(bob);
    const cursorBefore = await cursorOf(bob);
    const unknown = "ab".repeat(16);
    const seconds = Math.floor(clock.now / 1000);
    // What the junk envelope opens as: each way an envelope can name a conversation.
    const aims: Record<string, unknown> = {
      "refused as it's opened": undefined,
      "a session message of a held conversation": { cid: held, kind: "session", t: null, to: null, replaces: null },
      "a session message of a request": { cid: request, kind: "session", t: null, to: null, replaces: null },
      "a session message of no conversation here": { cid: unknown, kind: "session", t: null, to: null, replaces: null },
      "a first message to a Seedelf of the wallet's": { cid: unknown, kind: "first-contact", t: seconds, to: BOB_SEEDELF, replaces: null },
      "a first message to a Seedelf that isn't": { cid: unknown, kind: "first-contact", t: seconds, to: CAROL_SEEDELF, replaces: null },
      "a first message of a held conversation": { cid: held, kind: "first-contact", t: seconds, to: BOB_SEEDELF, replaces: null },
      "a first message of a request": { cid: request, kind: "first-contact", t: seconds, to: BOB_SEEDELF, replaces: null },
      "a continuation of a held conversation": { cid: unknown, kind: "first-contact", t: seconds, to: "", replaces: held },
    };
    let n = 0;
    const failures: string[] = [];
    for (const code of [...CODES, ...NEW_CODES]) {
      for (const [aim, opened] of Object.entries(aims)) {
        // The same storage each time, and one more envelope in the pool: the junk.
        bob.local.data.clear();
        for (const [key, value] of base) bob.local.data.set(key, value);
        const junk = junkEnvelope(++n);
        relay.put("preprod", junk);
        bob.restart(refusing(junk, opened ?? { refused: code }, code));
        bob.trace.length = 0;
        bob.changed.length = 0;
        bob.freshReads = 0;
        bob.revealReads = 0;
        await synced(bob);
        relay.pools.get("preprod")!.held.pop();

        const after = await records(bob);
        // What the one refusal that leaves a mark leaves, and nothing else: the cursor moved past the junk (in the take
        // record, finding 8).
        const expected = structuredClone(before) as Record<string, unknown>;
        const was = expected["messaging.preprod"] as Inbox;
        expect(await cursorOf(bob)).not.toBe(cursorBefore);
        const tooFar = opened !== undefined && code === "too_far_ahead" && (opened as { cid: string }).cid === held;
        if (tooFar) was.conversations[held]!.unreachable = true;
        const where = `${code}, ${aim}`;
        try {
          expect(after, where).toEqual(expected);
          // The junk was looked at: opened, and unless that refused it, received.
          expect(bob.trace.filter((s) => s === "open"), where).toHaveLength(1);
          expect(bob.trace.filter((s) => s === "receive"), where).toHaveLength(opened === undefined ? 0 : 1);
          // No server but the relay's pages, and no page told: only the authenticated refusal shows.
          expect(bob.trace.filter((s) => /^(POST|chain)/.test(s)), where).toEqual([]);
          expect(bob.trace.filter((s) => s.startsWith("GET ")), where).toHaveLength(1);
          expect(bob.changed, where).toEqual(tooFar ? ["preprod"] : []);
          expect(bob.freshReads + bob.revealReads, where).toBe(0);
        } catch (e) {
          failures.push((e as Error).message.split("\n")[0]!);
        }
      }
    }
    expect(failures).toEqual([]);
  }, 180_000);

  it("clears 'can't continue' once a later message of the conversation decrypts", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    // A message the ratchet authenticated and couldn't reach, as the crate will say it: stubbed here.
    const junk = junkEnvelope(1);
    relay.put("preprod", junk);
    alice.restart(refusing(junk, { cid, kind: "session", t: null, to: null, replaces: null }, "too_far_ahead"));
    alice.changed.length = 0;
    await synced(alice);
    expect((await alice.messaging.overview("preprod")).conversations[0]!.unreachable).toBe(true);
    expect(alice.changed).toEqual(["preprod"]);
    // Read again after a stop, it's the same mark: a flag, never a count.
    const inbox = (await alice.store.get<Inbox>("messaging.preprod"))!;
    expect(inbox.conversations[cid]!.unreachable).toBe(true);
    await alice.store.set("messaging.preprod", { ...inbox, cursor: undefined });
    alice.changed.length = 0;
    await synced(alice);
    expect((await alice.store.get<Inbox>("messaging.preprod"))!.conversations[cid]!.unreachable).toBe(true);
    expect(alice.changed).toEqual([]);
    await bob.messaging.send("preprod", cid, "still here");
    await bob.messaging.whenIdle();
    alice.changed.length = 0;
    await synced(alice);
    expect((await alice.messaging.overview("preprod")).conversations[0]!.unreachable).toBeUndefined();
    expect(alice.changed).toContain("preprod");
  });

  it("drops one too far ahead that comes with a message that decrypts after it in the same read", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    const junk = junkEnvelope(2);
    relay.put("preprod", junk);
    await bob.messaging.send("preprod", cid, "right behind it");
    await bob.messaging.whenIdle();
    alice.restart(refusing(junk, { cid, kind: "session", t: null, to: null, replaces: null }, "too_far_ahead"));
    await synced(alice);
    expect((await alice.messaging.overview("preprod")).conversations[0]!.unreachable).toBeUndefined();
  });
});

describe("session messages for conversations this browser doesn't hold (W3)", { timeout: 30_000 }, () => {
  /** Alice's phrase restored in a new browser: the same key, none of her conversations. */
  async function restored(relay: ReturnType<typeof fakeRelay>, directory: Directory): Promise<Party> {
    const again = await party(12, relay, directory);
    await turnOn(again);
    return again;
  }

  it("are dropped like any other refusal: nothing counted, kept or told, whoever sent them", async () => {
    const { relay, directory, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    // Its first read finds Bob's reply, to a conversation this browser doesn't hold.
    const again = await restored(relay, directory);
    const before = await records(again);
    await bob.messaging.send("preprod", cid, "are you there?");
    await bob.messaging.send("preprod", cid, "hello?");
    await bob.messaging.whenIdle();
    again.changed.length = 0;
    again.trace.length = 0;
    await synced(again);
    // Opened, refused, and nothing more: no record but the cursor, no page told, no field on the overview.
    expect(again.trace.filter((s) => s === "receive")).toHaveLength(2);
    const after = await records(again);
    const inbox = after["messaging.preprod"] as Inbox;
    expect(after).toEqual({ ...before, "messaging.preprod": { ...(before["messaging.preprod"] as Inbox), cursor: inbox.cursor } });
    expect(again.changed).toEqual([]);
    const overview = await again.messaging.overview("preprod");
    expect(overview).toEqual({ on: true, conversations: [], requests: [] });
    expect(JSON.stringify(after)).not.toContain(cid);
  });

  it("are dropped however many a stranger sends", async () => {
    const { relay, bob } = await pair();
    const wasm = loadTestWasm();
    const junk = Array.from({ length: 120 }, (_, i) => junkEnvelope(1000 + i));
    for (const envelope of junk) relay.put("preprod", envelope);
    const mine = new Set(junk);
    const before = await records(bob);
    bob.restart({
      ...wasm,
      messagingScan: (key, envelopes) => {
        const batch = JSON.parse(envelopes) as string[];
        const bits = [...wasm.messagingScan(key, envelopes)];
        batch.forEach((e, i) => mine.has(e) && (bits[i] = "1"));
        return bits.join("");
      },
      messagingOpen: (key, envelope) =>
        mine.has(envelope)
          ? JSON.stringify({ cid: envelope.slice(2, 10).repeat(4), kind: "session", t: null, to: null, replaces: null })
          : wasm.messagingOpen(key, envelope),
      messagingReceive: (key, request) =>
        mine.has((JSON.parse(request) as { envelope: string }).envelope)
          ? JSON.stringify({ refused: "unknown_conversation" })
          : wasm.messagingReceive(key, request),
    });
    bob.changed.length = 0;
    await synced(bob);
    const after = await records(bob);
    const inbox = after["messaging.preprod"] as Inbox;
    expect(after).toEqual({ ...before, "messaging.preprod": { ...(before["messaging.preprod"] as Inbox), cursor: inbox.cursor } });
    expect(bob.changed).toEqual([]);
  });

  it("never show a conversation the user deleted, past its tombstone too", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await bob.messaging.remove("preprod", cid);
    // Past t + 48 hours its tombstone holds nothing: the other side's next message is a cid Bob doesn't hold.
    await busyFor(49 * 3600_000, alice, bob);
    await alice.messaging.send("preprod", cid, "are you there?");
    await alice.messaging.whenIdle();
    bob.changed.length = 0;
    await synced(bob);
    // Nothing but Bob's own Seedelf and its switch (W8).
    const { seedelfs, ...overview } = await bob.messaging.overview("preprod");
    expect(overview).toEqual({ on: true, conversations: [], requests: [] });
    expect(seedelfs?.map((s) => s.name)).toEqual([BOB_SEEDELF]);
    expect(JSON.stringify(await bob.store.get("messaging.preprod"))).not.toContain(cid);
    expect(bob.changed).toEqual([]);
  });
});

describe("a first message the wallet can't place (W1)", { timeout: 30_000 }, () => {
  it("is dropped without a word when it names a Seedelf the kept view doesn't have: no sync reads the contract", async () => {
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const alice = await party(12, relay, directory, ALICE_SEEDELF);
    const bob = await party(24, relay, directory, BOB_SEEDELF);
    // Bob minted a second Seedelf since his view of the contract was kept.
    const SECOND = "5eed0e1f00" + "626f6232";
    const second = await another(bob);
    bob.kept = [...bob.own];
    bob.own.push({ name: SECOND, register: second });
    directory.set(SECOND, second);
    await turnOn(alice, bob);
    const before = (await cursorOf(bob));
    const lost = await alice.messaging.start("preprod", SECOND, "to your new Seedelf");
    const kept = await alice.messaging.start("preprod", BOB_SEEDELF, "to the one you know");
    await alice.messaging.whenIdle();
    // A read of the contract would fail, were one made: none is, and nothing waits on it.
    bob.readFails = new Error("Koios is down");
    await synced(bob);
    expect(bob.freshReads).toBe(0);
    expect(bob.trace.filter((s) => s.startsWith("chain"))).toEqual([]);
    // The one behind it arrived, and the cursor moved past both.
    expect((await bob.messaging.overview("preprod")).requests.map((r) => r.cid)).toEqual([kept]);
    expect((await cursorOf(bob))).not.toBe(before);
    expect(JSON.stringify(await records(bob))).not.toContain(lost);
    // However many come, at however many syncs.
    for (let i = 0; i < 3; i++) {
      await alice.messaging.start("preprod", SECOND, `again ${i}`);
      await alice.messaging.whenIdle();
      await synced(bob);
    }
    expect(bob.freshReads).toBe(0);
  });

  it("is dropped when its register is one the kept view is too old to have, or no view is kept at all", async () => {
    const { directory, alice, bob } = await pair();
    // The chain, and Alice, have the Seedelf's new register; Bob's kept view the one before.
    const was = bob.own[0]!;
    const fresh = await another(bob);
    bob.kept = [was];
    bob.own.splice(0, 1, { name: BOB_SEEDELF, register: fresh });
    directory.set(BOB_SEEDELF, fresh);
    await alice.messaging.start("preprod", BOB_SEEDELF, "to your new datum");
    await alice.messaging.whenIdle();
    bob.changed.length = 0;
    await synced(bob);
    expect((await bob.messaging.overview("preprod")).requests).toEqual([]);
    expect(bob.freshReads).toBe(0);
    expect(bob.changed).toEqual([]);

    // No view kept: the wallet takes first messages at the registers it put its Seedelfs under, and asks for no others.
    bob.keptView = false;
    bob.kept = undefined;
    await alice.messaging.start("preprod", BOB_SEEDELF, "again");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect(bob.freshReads).toBe(0);
  });

  it("is dropped at a register the kept view no longer has its Seedelf at, once a view has shown it there (W8)", async () => {
    const { directory, alice, bob } = await pair();
    // Bob's sync has seen the register Alice writes to; then the datum changes, and his kept view says so.
    await synced(bob);
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "to your old datum");
    await alice.messaging.whenIdle();
    const fresh = await another(bob);
    bob.own.splice(0, 1, { name: BOB_SEEDELF, register: fresh });
    directory.set(BOB_SEEDELF, fresh);
    bob.restart();
    await synced(bob);
    // The pair it took first messages at is gone, and the new one isn't a register this browser put it under.
    expect((await bob.messaging.overview("preprod")).requests).toEqual([]);
    expect(JSON.stringify(await records(bob))).not.toContain(cid);
    expect(bob.freshReads).toBe(0);
  });

  it("holds up nothing: a first message it can't place and a chain that can't be read leave the queue free", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    bob.kept = [];
    bob.readFails = new Error("Koios is down");
    await alice.messaging.start("preprod", BOB_SEEDELF, "who are you");
    await alice.messaging.send("preprod", cid, "behind it");
    await alice.messaging.whenIdle();
    bob.restart();
    await synced(bob);
    expect((await bob.messaging.thread("preprod", cid)).messages.at(-1)!.text).toBe("behind it");
    await bob.messaging.rename("preprod", cid, "Alice");
    expect((await bob.messaging.overview("preprod")).conversations[0]!.name).toBe("Alice");
    expect(bob.freshReads).toBe(0);
  });
});

// The reviewers' own case, with the crate as it is: the conversation's other side forges nothing here, it only sends
// more than MAX_SKIP messages that never arrive, then one that does.
describe("a message the ratchet can't reach (protocol.md §6)", () => {
  it("says the conversation may not continue, to open pages at once, and stops saying so when the next one decrypts", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    // More than MAX_SKIP (1,000) of Bob's messages never reach Alice: his ratchet steps on a copy of his record, and
    // only the last envelope is posted.
    const wasm = loadTestWasm();
    let state = (await fileOf(bob, cid))!.state;
    let envelope = "";
    for (let i = 0; i < 1002; i++) {
      const sent = JSON.parse(wasm.messagingSend(JSON.stringify({ conversation: state, plaintext: plaintextOf(`m${i}`) })));
      state = sent.conversation;
      envelope = sent.envelope;
    }
    relay.put("preprod", envelope);
    alice.changed.length = 0;
    await synced(alice);
    expect((await alice.messaging.overview("preprod")).conversations[0]!.unreachable).toBe(true);
    expect(alice.changed).toContain("preprod");
    // Bob's wallet, whose record never stepped, writes on: it decrypts, and the conversation goes on.
    await bob.messaging.send("preprod", cid, "in order again");
    await bob.messaging.whenIdle();
    await synced(alice);
    expect((await alice.messaging.overview("preprod")).conversations[0]!.unreachable).toBeUndefined();
    expect((await alice.messaging.thread("preprod", cid)).messages.at(-1)!.text).toBe("in order again");
    // 1,002 ratchet steps: about 5 s alone, twice that beside the rest of the suite.
  }, 60_000);
});
