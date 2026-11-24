// C1's fifth question (an outside review of 48480cf8, the 1.10.0 gate's relay oracles): does anything else a take
// does change a later request? Each case is one reader in two worlds that differ only in one envelope of the pages: in
// the first it's the one the case names (a reveal, a control kind, a first message that starts a request, a message the
// ratchet can't reach), in the second a same-size envelope nobody's, in its place. The reader then does the same
// things in both, and every request it makes is compared in order, each POST with its body's length. The reader's own
// posts are answered and kept nowhere. Ported from the verifiers' verify2-c1-take-effects.test.ts: since round 5 every
// case is identical. The control kind's was not (a reply the thread doesn't show ended the share and offered Show my
// Seedelf, and the next post shrank): padding (fix item 1, O1 b) and the held share (fix item 3, O4) reverse it.
import { describe, expect, it } from "vitest";

import { type Inbox, plaintextOf } from "../src/background/messaging";
import {
  ALICE_SEEDELF,
  BOB_SEEDELF,
  CAROL_SEEDELF,
  clock,
  type Directory,
  fakeRelay,
  type FakeRelay,
  fileOf,
  loadTestWasm,
  party,
  type Party,
  setFileOf,
  synced,
  turnOn,
} from "./messaging-harness";

const wasm = loadTestWasm();

interface World {
  relay: FakeRelay;
  directory: Directory;
  carol: Party;
  a: Party;
  b: Party;
  cidA: string;
  cidB: string;
  keeps: (p: Party) => boolean;
  posts: Map<Party, string[]>;
}

const hexOf = (b: Uint8Array) => Buffer.from(b).toString("hex");
const keptNew = () =>
  new Response(JSON.stringify({ kept: "new", expires: Math.floor((clock.now + 36 * 3600_000) / 1000) }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** Every POST's body length into its poster's trace (verify2-c1-answered-size.test.ts's `watchPosts`). */
function watchPosts(x: World): void {
  const parties = [x.carol, x.a, x.b];
  const real = x.relay.fetch;
  x.relay.fetch = async (url, init) => {
    if (init.method !== "POST") return real(url, init);
    const u = new URL(url);
    const bare = `POST ${u.pathname}${u.search}`;
    const owners = parties.filter((p) => p.trace.at(-1) === bare);
    if (owners.length !== 1) throw new Error(`a post whose poster can't be told (${owners.length})`);
    const owner = owners[0]!;
    const body = new Uint8Array(init.body as Uint8Array);
    owner.trace[owner.trace.length - 1] = `${bare} ${body.byteLength}`;
    x.posts.get(owner)!.push(hexOf(body.subarray(8)));
    return x.keeps(owner) ? real(url, init) : keptNew();
  };
}

/** Carol, A and B, Messages on; A and B each wrote first to Carol's Seedelf, and Carol's wallet took both as requests. */
async function world(): Promise<World> {
  const relay = fakeRelay(clock);
  const directory: Directory = new Map();
  const carol = await party(15, relay, directory, CAROL_SEEDELF);
  const a = await party(12, relay, directory, ALICE_SEEDELF);
  const b = await party(24, relay, directory, BOB_SEEDELF);
  const x: World = {
    relay,
    directory,
    carol,
    a,
    b,
    cidA: "",
    cidB: "",
    keeps: () => true,
    posts: new Map([
      [carol, []],
      [a, []],
      [b, []],
    ]),
  };
  watchPosts(x);
  await turnOn(carol, a, b);
  x.cidA = await a.messaging.start("preprod", CAROL_SEEDELF, "hello Carol");
  await a.messaging.whenIdle();
  x.cidB = await b.messaging.start("preprod", CAROL_SEEDELF, "hello Carol");
  await b.messaging.whenIdle();
  await synced(carol);
  expect((await carol.messaging.overview("preprod")).requests).toHaveLength(2);
  return x;
}

/** Carol accepts both requests and replies to each; A and B take their replies. */
async function answerBoth(x: World): Promise<void> {
  for (const cid of [x.cidA, x.cidB]) {
    await x.carol.messaging.accept("preprod", cid);
    await x.carol.messaging.send("preprod", cid, "hi");
  }
  await x.carol.messaging.whenIdle();
  await synced(x.a);
  await synced(x.b);
  await synced(x.carol);
}

async function tick(p: Party, label: string): Promise<void> {
  p.trace.push(`# ${label}`);
  await p.messaging.sync("preprod");
  await p.messaging.whenIdle();
}

async function press(p: Party, label: string, act: () => Promise<unknown>): Promise<void> {
  p.trace.push(`# ${label}`);
  await act();
  await p.messaging.whenIdle();
}

const asked = (p: Party) => p.trace.filter((s) => /^(GET|POST) |^chain |^# /.test(s));

function paired(name: string, a: string[], b: string[]): { identical: boolean; at: number } {
  let at = 0;
  while (at < a.length && at < b.length && a[at] === b[at]) at++;
  const identical = at === a.length && at === b.length;
  console.log(`[C1] ${name}: ${identical ? "IDENTICAL" : `DIFFERENT from entry ${at}`}\n  served:   ${JSON.stringify(a)}\n  replaced: ${JSON.stringify(b)}`);
  return { identical, at };
}

/** `size` bytes nobody's, at the version the relay takes. */
const junk = (size: number) => "01" + "00c1c1c1" + "5a".repeat(size - 5);

function swapHeld(relay: FakeRelay, envelope: string, replacement: string): void {
  const held = relay.pools.get("preprod")!.held.find((h) => hexOf(h.bytes) === envelope);
  if (!held) throw new Error("not held");
  held.bytes = Uint8Array.from(Buffer.from(replacement, "hex"));
}

interface Case {
  /** Builds the world up to the one envelope, put in the pool; returns the reader and that envelope. */
  setup: (x: World) => Promise<{ reader: Party; envelope: string }>;
  /** The same presses in both worlds, after the reader's first tick; `served` only for what's asserted. */
  after: (x: World, reader: Party, served: boolean) => Promise<void>;
}

/** The case's two worlds: the reader's requests with the envelope served, and with a same-size one nobody's in its place. */
async function twoWorlds(name: string, c: Case): Promise<{ identical: boolean; traces: string[][] }> {
  const traces: string[][] = [];
  for (const served of [true, false]) {
    const x = await world();
    const { reader, envelope } = await c.setup(x);
    if (!served) swapHeld(x.relay, envelope, junk(envelope.length / 2));
    x.keeps = (p) => p !== reader;
    reader.trace.length = 0;
    await tick(reader, "tick 1");
    await c.after(x, reader, served);
    traces.push(asked(reader));
  }
  const { identical } = paired(name, traces[0]!, traces[1]!);
  return { identical, traces };
}

const conversationOf = async (p: Party, cid: string) => (await p.store.get<Inbox>("messaging.preprod"))!.conversations[cid]!;

describe("C1 face 5: what else a take does, and whether it changes a later request", { timeout: 300_000 }, () => {
  it("a reveal taken (Carol, from A): no later request changes; no chain read without the press", async () => {
    const { identical } = await twoWorlds("face 5, a reveal taken by Carol", {
      setup: async (x) => {
        await answerBoth(x);
        await x.a.messaging.reveal("preprod", x.cidA, ALICE_SEEDELF);
        await x.a.messaging.whenIdle();
        return { reader: x.carol, envelope: x.posts.get(x.a)!.at(-1)! };
      },
      after: async (x, reader, served) => {
        const thread = await reader.messaging.thread("preprod", x.cidA);
        expect(thread.messages.some((m) => m.reveal?.status === "unchecked")).toBe(served);
        expect((await conversationOf(reader, x.cidA)).unchecked === true).toBe(served);
        await press(reader, "send ok", () => reader.messaging.send("preprod", x.cidA, "ok"));
        await tick(reader, "tick 2");
        expect([reader.revealReads, reader.freshReads]).toEqual([0, 0]);
      },
    });
    expect(identical).toBe(true);
  });

  it("a control kind taken (A, Carol's reply of kind 0x80, which shows nothing): nothing the user can do changes, and no later request", async () => {
    const { identical, traces } = await twoWorlds("face 5, a control-kind reply taken by A", {
      setup: async (x) => {
        await x.carol.messaging.accept("preprod", x.cidA);
        // Carol's next message in the conversation, of a control kind this version doesn't know: its ratchet steps.
        const file = (await fileOf(x.carol, x.cidA))!;
        const sent = JSON.parse(String(wasm.messagingSend(JSON.stringify({ conversation: file.state, plaintext: "80" })))) as {
          conversation: string;
          envelope: string;
        };
        await setFileOf(x.carol, x.cidA, { ...file, state: sent.conversation });
        x.relay.put("preprod", sent.envelope);
        return { reader: x.a, envelope: sent.envelope };
      },
      after: async (x, reader) => {
        const thread = await reader.messaging.thread("preprod", x.cidA);
        // What the user sees: no new message and nothing unread, either way...
        expect(thread.messages.map((m) => m.dir)).toEqual(["out"]);
        expect(thread.conversation.unread).toBe(0);
        // ...and nothing they can do moves: not answered, the share held, Show my Seedelf not offered (O4).
        expect((await conversationOf(reader, x.cidA)).answered === true).toBe(false);
        expect(thread.conversation.firstContactLeft).toBeDefined();
        expect(thread.seedelfs ?? []).toEqual([]);
        await press(reader, "send ok", () => reader.messaging.send("preprod", x.cidA, "ok"));
        await tick(reader, "tick 2");
      },
    });
    expect(identical).toBe(true);
    const sizes = traces.map((t) => t.filter((s) => s.startsWith("POST ")));
    expect(sizes).toEqual([["POST /messaging/v1/preprod/envelopes 2056"], ["POST /messaging/v1/preprod/envelopes 2056"]]);
  });

  it("a first message taken, starting a request (Carol, a second one from A): no later request changes", async () => {
    const { identical } = await twoWorlds("face 5, a request taken by Carol", {
      setup: async (x) => {
        await answerBoth(x);
        await x.a.messaging.start("preprod", CAROL_SEEDELF, "another hello");
        await x.a.messaging.whenIdle();
        return { reader: x.carol, envelope: x.posts.get(x.a)!.at(-1)! };
      },
      after: async (x, reader, served) => {
        expect((await reader.messaging.overview("preprod")).requests).toHaveLength(served ? 1 : 0);
        // A press in another conversation of hers, the one with B: the same in both.
        await press(reader, "send ok to B", () => reader.messaging.send("preprod", x.cidB, "ok"));
        await tick(reader, "tick 2");
      },
    });
    expect(identical).toBe(true);
  });

  it("a message the ratchet can't reach (A, Carol's 1,002nd): marked unreachable; no later request changes", async () => {
    const { identical } = await twoWorlds("face 5, a conversation marked unreachable at A", {
      setup: async (x) => {
        await x.carol.messaging.accept("preprod", x.cidA);
        await x.carol.messaging.send("preprod", x.cidA, "hi");
        await x.carol.messaging.whenIdle();
        await synced(x.a);
        expect((await conversationOf(x.a, x.cidA)).answered).toBe(true);
        // More than MAX_SKIP (1,000) of Carol's messages never reach A: her ratchet steps on a copy, the last is posted.
        let state = (await fileOf(x.carol, x.cidA))!.state;
        let envelope = "";
        for (let i = 0; i < 1002; i++) {
          const sent = JSON.parse(String(wasm.messagingSend(JSON.stringify({ conversation: state, plaintext: plaintextOf(`m${i}`) }))));
          state = sent.conversation;
          envelope = sent.envelope;
        }
        x.relay.put("preprod", envelope);
        return { reader: x.a, envelope };
      },
      after: async (x, reader, served) => {
        expect((await reader.messaging.overview("preprod")).conversations.find((c) => c.cid === x.cidA)!.unreachable === true).toBe(served);
        await press(reader, "send ok", () => reader.messaging.send("preprod", x.cidA, "ok"));
        await tick(reader, "tick 2");
      },
    });
    expect(identical).toBe(true);
  });
});
