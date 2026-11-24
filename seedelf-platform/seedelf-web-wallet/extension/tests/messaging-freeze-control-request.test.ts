// What a 1.10.0 reader shows of a message whose plaintext is a control kind it doesn't know (0x80-0xFF, protocol.md
// §18), as a later version might send one, when it isn't in an established conversation's session: a first contact (an
// unknown cid) and its joins, and at the initiator a control-only reply. The writer here is a 1.10.0 wallet whose
// WebAssembly seals a control plaintext in place of a marked text, which is byte for byte what a later version's
// control message is: the session layer takes the plaintext as bytes. Ported from the verifiers'
// verify2-freeze-control-request.test.ts (the §20 freeze review, item 4): the first two cases are the behaviour §20
// freezes; the third is reversed by the 1.10.0 gate's round 5 (O4, relay-oracle fix item 3): a control-only reply at
// the initiator changes nothing the user can do, so the conversation stays unanswered, its share held.
import { describe, expect, it } from "vitest";

import { plaintextOf } from "../src/background/messaging";
import { BOB_SEEDELF, busyFor, loadTestWasm, pair, synced, type Wasm } from "./messaging-harness";

/** A text whose plaintext the writer's WebAssembly swaps for `CONTROL`. */
const MARK = "this text is sealed as a control message";
/** A control kind 1.10.0 doesn't know, 0x85, and a body. */
const CONTROL = "85" + "beef";

/** WebAssembly whose `messagingSend` seals CONTROL wherever the plaintext is MARK's. */
function swapping(): Wasm {
  const wasm = loadTestWasm();
  return {
    ...wasm,
    messagingSend: (request: string) => {
      const asked = JSON.parse(request) as { conversation: string; plaintext: string };
      if (asked.plaintext === plaintextOf(MARK)) asked.plaintext = CONTROL;
      return wasm.messagingSend(JSON.stringify(asked));
    },
  };
}

describe("a control kind 1.10.0 doesn't know, outside an established session (freeze item 4)", { timeout: 120_000 }, () => {
  it("as a first contact's only message: a request is listed, its time moves with a join, and it opens empty", async () => {
    const { alice, bob } = await pair();
    alice.restart(swapping());
    expect((await bob.messaging.overview("preprod")).requests).toEqual([]);

    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, MARK);
    await alice.messaging.whenIdle();
    bob.changed.length = 0;
    await synced(bob);
    const listed = await bob.messaging.overview("preprod");
    // A row in the list: "Unknown sender", its time and the Seedelf it was written to (Messages.tsx 300-336). No unread.
    expect(listed.requests).toHaveLength(1);
    expect(listed.requests[0]).toMatchObject({ cid, to: BOB_SEEDELF, messages: 1, unread: 0 });
    // The open pages were told: the list is drawn again with it.
    expect(bob.changed).toContain("preprod");
    // Opened, it holds nothing.
    expect(await bob.messaging.request("preprod", cid)).toEqual([]);

    // A join, ten minutes on, also control: the row's count and time move; still no unread.
    const lastAt = listed.requests[0]!.lastAt;
    await busyFor(10 * 60_000, alice, bob);
    await alice.messaging.send("preprod", cid, MARK);
    await alice.messaging.whenIdle();
    await synced(bob);
    const joined = (await bob.messaging.overview("preprod")).requests[0]!;
    expect(joined).toMatchObject({ cid, messages: 2, unread: 0 });
    expect(joined.lastAt).toBeGreaterThan(lastAt);

    // Accepted: a conversation with no messages.
    await bob.messaging.accept("preprod", cid);
    expect((await bob.messaging.thread("preprod", cid)).messages).toEqual([]);
  });

  it("takes a request's place: the 51st request, control-only, pushes the oldest text request out", async () => {
    const { alice, bob } = await pair();
    const texts: string[] = [];
    for (let i = 0; i < 50; i++) {
      texts.push(await alice.messaging.start("preprod", BOB_SEEDELF, `request ${i}`));
      await alice.messaging.whenIdle();
    }
    await synced(bob);
    const before = (await bob.messaging.overview("preprod")).requests;
    expect(before).toHaveLength(50);
    expect(before.reduce((n, r) => n + r.unread, 0)).toBe(50);

    alice.restart(swapping());
    const control = await alice.messaging.start("preprod", BOB_SEEDELF, MARK);
    await alice.messaging.whenIdle();
    await synced(bob);
    const after = (await bob.messaging.overview("preprod")).requests;
    const cids = after.map((r) => r.cid);
    expect(after).toHaveLength(50);
    expect(cids).toContain(control);
    // The oldest text request is gone, with its unread message.
    expect(cids).not.toContain(texts[0]);
    expect(after.reduce((n, r) => n + r.unread, 0)).toBe(49);
  });

  it("as the responder's only reply, at the initiator: no entry, and nothing changes: still unanswered, the share as it was (O4)", async () => {
    const { alice, bob } = await pair();
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "hello Bob");
    await alice.messaging.whenIdle();
    await synced(bob);
    await bob.messaging.accept("preprod", cid);
    // 49 hours on with no reply: Alice's list says it may need starting again (§16.4).
    await busyFor(49 * 3600_000, alice, bob);
    await synced(alice);
    const waiting = (await alice.messaging.overview("preprod")).conversations[0]!;
    expect(waiting).toMatchObject({ cid, unanswered: true });
    expect(waiting.firstContactLeft).toBeDefined();

    bob.restart(swapping());
    await bob.messaging.send("preprod", cid, MARK);
    await bob.messaging.whenIdle();
    await synced(alice);
    const after = (await alice.messaging.overview("preprod")).conversations[0]!;
    // Nothing to read in the thread, no unread...
    expect(after.unread).toBe(0);
    expect((await alice.messaging.thread("preprod", cid)).messages.map((m) => m.dir)).toEqual(["out"]);
    // ...and so nothing the user can do moves: "no reply, start again" stays, and the share with it, as the crate
    // counted it before the reply.
    expect(after.unanswered).toBe(true);
    expect(after.firstContactLeft).toEqual(waiting.firstContactLeft);
    // A reply the thread shows lifts it.
    bob.restart();
    await bob.messaging.send("preprod", cid, "hi Alice");
    await bob.messaging.whenIdle();
    await synced(alice);
    const answered = (await alice.messaging.overview("preprod")).conversations[0]!;
    expect(answered.unanswered).toBe(false);
    expect(answered.firstContactLeft).toBeUndefined();
  });
});
