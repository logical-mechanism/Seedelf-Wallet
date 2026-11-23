// A first message's own share (the 1.10.0 gate's W17, DESIGN-protocol §3.5).
// A reader's wallet keeps at most 16 of a stranger's first-contact messages,
// and 64 KiB of them, before it replies; the writer's crate refuses one past
// that before the chain moves (`request_full`), and counts only what it has
// sealed. So the wallet counts what's left with the texts still queued for the
// stamp, refuses a text past it before it's queued, in words and never as the
// server's refusal, and tells the screens what's left until a reply comes.
import { describe, expect, it } from "vitest";

import { type Inbox, ShareUsedUp } from "../src/background/messaging";
import { BOB_SEEDELF, loadTestWasm, pair, synced, type Wasm } from "./messaging-harness";

/** WebAssembly whose stamp search finds nothing while `held.on`: a first message's texts stay queued meanwhile. */
function holdingStamp(held: { on: boolean }): Wasm {
  const wasm = loadTestWasm();
  return { ...wasm, messagingFindStamp: (request) => (held.on ? JSON.stringify({ nonce: null }) : wasm.messagingFindStamp(request)) };
}

/** The share: 16 first-contact messages, and 65,536 bytes of their inner messages (the bindings' own numbers). */
const SHARE = JSON.parse(loadTestWasm().messagingConstants()) as { maxRequestMessages: number; maxOneRequestBytes: number };

/** What each first-contact message to Bob's Seedelf takes beside its text and kind byte: F (498 bytes to an 8-byte name) and 97. */
const PER = 595;

// Each test bounded: one that fails mid-take fails here, never hangs the run.
describe("a first message's own share (W17)", { timeout: 60_000 }, () => {
  it("is 16 messages and 64 KiB, the bindings' numbers", () => {
    expect(SHARE).toMatchObject({ maxRequestMessages: 16, maxOneRequestBytes: 65_536 });
  });

  it("counts the texts still queued for the stamp, refuses one past what's left before it's queued, in words, and goes once a reply comes", async () => {
    const { alice, bob } = await pair();
    const held = { on: true };
    alice.restart(holdingStamp(held));
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "first");
    const thread = () => alice.messaging.thread("preprod", cid);
    const left = async () => (await thread()).conversation.firstContactLeft;
    // "first" waits for the stamp, and takes its part already.
    expect(await left()).toEqual({ messages: 15, bytes: SHARE.maxOneRequestBytes - (5 + 1 + PER) - 1 - PER });
    // The largest envelope's room binds before the share does: the thread says the lesser.
    expect((await thread()).maxTextBytes).toBe(32_026);
    await alice.messaging.send("preprod", cid, "x".repeat(32_000));
    const room = SHARE.maxOneRequestBytes - (5 + 1 + PER) - (32_000 + 1 + PER) - 1 - PER;
    expect(await left()).toEqual({ messages: 14, bytes: room });
    expect((await thread()).maxTextBytes).toBe(room);
    // One past what's left is too long, by what's left; nothing of it is kept.
    await expect(alice.messaging.send("preprod", cid, "y".repeat(room + 1))).rejects.toThrow(`A message can be at most ${room} bytes.`);
    expect((await thread()).messages).toHaveLength(2);
    // Exactly what's left goes; then nothing more does, in words, never the server's refusal.
    await alice.messaging.send("preprod", cid, "y".repeat(room));
    expect(await left()).toEqual({ messages: 0, bytes: 0 });
    expect((await thread()).maxTextBytes).toBe(0);
    const refused = await alice.messaging.send("preprod", cid, "one more").catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ShareUsedUp);
    expect((refused as Error).message).toBe("Wait for a reply: until one comes, their wallet takes no more messages from you here.");
    expect((await thread()).messages).toHaveLength(3);
    // The list says so too, without opening the record.
    expect((await alice.messaging.overview("preprod")).conversations[0]!.firstContactLeft).toEqual({ messages: 0, bytes: 0 });
    // The stamp found: all three sealed and posted, within the share to the byte, none refused.
    held.on = false;
    await alice.messaging.whenIdle();
    const sent = (await thread()).messages;
    expect(sent.map((m) => [m.text?.length, m.sent])).toEqual([
      [5, "posted"],
      [32_000, "posted"],
      [room, "posted"],
    ]);
    expect(sent.some((m) => m.refusedBy !== undefined)).toBe(false);
    // Bob's wallet takes all three, as one request; he replies, and the share ends.
    await synced(bob);
    expect((await bob.messaging.overview("preprod")).requests).toMatchObject([{ cid, messages: 3 }]);
    await bob.messaging.accept("preprod", cid);
    await bob.messaging.send("preprod", cid, "hi");
    await bob.messaging.whenIdle();
    // The reply is taken with no look at the record but the crate's own receive: the share ends by the reply, never by a
    // call of the take's own that no trap mark would cover (W9).
    const looks = { n: 0 };
    const wasm = loadTestWasm();
    alice.restart({
      ...wasm,
      messagingConversationInfo: (record) => {
        looks.n++;
        return wasm.messagingConversationInfo(record);
      },
    });
    await synced(alice);
    expect(looks.n).toBe(0);
    // The reply's own write ends it in what the inbox keeps, before anything looks.
    expect((await alice.store.get<Inbox>("messaging.preprod"))!.conversations[cid]!.firstContactLeft).toBeUndefined();
    expect(await left()).toBeUndefined();
    expect((await alice.messaging.overview("preprod")).conversations[0]!.firstContactLeft).toBeUndefined();
    expect((await thread()).maxTextBytes).toBeGreaterThan(room);
    await alice.messaging.send("preprod", cid, "and more now");
    await alice.messaging.whenIdle();
    expect((await thread()).messages.at(-1)).toMatchObject({ text: "and more now", sent: "posted" });
  });

  it("counts every message, not only bytes: the seventeenth short one waits for a reply", async () => {
    const { alice } = await pair();
    const held = { on: true };
    alice.restart(holdingStamp(held));
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "1");
    for (let i = 2; i <= SHARE.maxRequestMessages; i++) await alice.messaging.send("preprod", cid, String(i));
    expect((await alice.messaging.thread("preprod", cid)).conversation.firstContactLeft).toEqual({ messages: 0, bytes: 0 });
    await expect(alice.messaging.send("preprod", cid, "17")).rejects.toBeInstanceOf(ShareUsedUp);
    held.on = false;
    await alice.messaging.whenIdle();
    const messages = (await alice.messaging.thread("preprod", cid)).messages;
    expect(messages).toHaveLength(SHARE.maxRequestMessages);
    expect(messages.every((m) => m.sent === "posted")).toBe(true);
  });

  it("is said of what the writer started only: the side written to has none", async () => {
    const { alice, bob } = await pair();
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "hello");
    await alice.messaging.whenIdle();
    await synced(bob);
    await bob.messaging.accept("preprod", cid);
    expect((await bob.messaging.thread("preprod", cid)).conversation.firstContactLeft).toBeUndefined();
    expect((await bob.messaging.overview("preprod")).conversations[0]!.firstContactLeft).toBeUndefined();
    expect((await alice.messaging.overview("preprod")).conversations[0]!.firstContactLeft).toMatchObject({ messages: 15 });
  });
});
