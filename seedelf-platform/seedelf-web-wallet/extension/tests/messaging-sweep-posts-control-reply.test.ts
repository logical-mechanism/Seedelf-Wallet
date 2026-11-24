// Class A sweep (takes that change posts), the 1.10.0 gate: a C1 variant. The responder's reply that ended the
// initiator's first-contact share needn't be anything the initiator's user sees: a control kind this version doesn't
// know (0x80 to 0xFF, W15) leaves no entry, no unread and no preview, yet its take set `answered` and the crate's state
// moved to session messages, so the user's next text went out at 512 bytes instead of 2,048. Ported from the
// verifiers' verify2-sweep-posts-control-reply.test.ts and reversed by round 5: every message is padded to its
// first-contact size (fix item 1, O1 b), and a reply the thread doesn't show holds the share (fix item 3, O4). Paired:
// the same conversation, the same press, with the control message delivered to the initiator (A) or not (B).
import { describe, expect, it } from "vitest";

import { ALICE_SEEDELF, BOB_SEEDELF, fileOf, loadTestWasm, pair, synced } from "./messaging-harness";

/** What `p`'s relay is posted, by envelope size (the body less its 8-byte nonce), in order. */
function postSizes(relay: ReturnType<typeof Object>, into: number[]): void {
  const r = relay as { fetch: (url: string, init: RequestInit) => Promise<Response> };
  const real = r.fetch;
  r.fetch = async (url, init) => {
    if (init.method === "POST") into.push((init.body as Uint8Array).length - 8);
    return real(url, init);
  };
}

async function world(deliver: boolean) {
  const { relay, alice, bob } = await pair();
  // Alice writes first to Bob's Seedelf; Bob takes the request and accepts it, but answers with no text.
  const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "hello Bob");
  await alice.messaging.whenIdle();
  await synced(bob);
  await bob.messaging.accept("preprod", cid);
  const before = await alice.messaging.thread("preprod", cid);
  if (deliver) {
    // Bob's side seals a control kind (0x80): what a later version could send, and what a counterpart can send at will.
    const state = (await fileOf(bob, cid))!.state;
    const sent = JSON.parse(loadTestWasm().messagingSend(JSON.stringify({ conversation: state, plaintext: "80" }))) as {
      envelope?: string;
      refused?: string;
    };
    expect(sent.refused).toBeUndefined();
    relay.put("preprod", sent.envelope!);
  }
  await synced(alice);
  const after = await alice.messaging.thread("preprod", cid);
  const overview = await alice.messaging.overview("preprod");
  const sizes: number[] = [];
  postSizes(relay, sizes);
  // The user's own press, the same in both worlds.
  await alice.messaging.send("preprod", cid, "ok");
  await alice.messaging.whenIdle();
  return {
    sizes,
    shownBefore: before.messages.length,
    shownAfter: after.messages.length,
    unread: overview.conversations.find((c) => c.cid === cid)?.unread,
    maxTextBytesBefore: before.maxTextBytes,
    maxTextBytesAfter: after.maxTextBytes,
    firstContactLeft: overview.conversations.find((c) => c.cid === cid)?.firstContactLeft,
  };
}

describe("class A: an invisible control-kind reply changes neither the initiator's sizes nor its share (C1 variant)", { timeout: 120_000 }, () => {
  it("the same press posts 2,048 bytes either way; the thread shows nothing new, and the share is as it was", async () => {
    const a = await world(true);
    const b = await world(false);
    // Nothing on A's screen says a reply came: no entry, no unread.
    expect(a.shownAfter).toBe(a.shownBefore);
    expect(a.unread).toBe(0);
    // And nothing it can do moves: the share is held as the crate counted it before the reply.
    expect(a.firstContactLeft).toEqual(b.firstContactLeft);
    expect(a.firstContactLeft).toBeDefined();
    expect(a.maxTextBytesAfter).toBe(b.maxTextBytesAfter);
    expect(a.sizes).toEqual([2048]);
    expect(b.sizes).toEqual([2048]);
  });
});

void ALICE_SEEDELF;
