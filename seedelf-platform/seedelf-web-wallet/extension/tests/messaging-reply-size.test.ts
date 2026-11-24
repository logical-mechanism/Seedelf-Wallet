// A reply the thread doesn't show changes nothing the user can do (the 1.10.0 gate's round 5, relay-oracle fix item 3,
// the owner's call O4 (a)). C1's share face: once any reply decrypts, the crate ends the writer's share of first
// messages, so the thread's room, Show my Seedelf and the restart prompt would open with it. A reply of a control kind
// this version doesn't know (0x80 to 0xFF) shows the user nothing, so a user who then wrote past the share would tell
// the server a reply came that nothing on screen said. The worker holds the crate's own count from before that reply
// (`ConversationFile.held`) until a reply the thread shows comes. A reply it shows is the user reacting to what they
// read: that difference is documented (protocol.md §11), and asserted here as it is.
//
// Paired worlds: A and B each write first to Carol's Seedelf, the same messages; Carol answers A alone. A and B are
// served the same pages, so only A's take receives her reply. Each user then does the same thing in their own
// conversation. Every POST's body length is written into the poster's trace, so a difference in what a request
// carries shows as one in the trace. What A and B post during a comparison is answered by the test and kept nowhere.
import { describe, expect, it } from "vitest";

import { type Inbox, ShareUsedUp } from "../src/background/messaging";
import {
  ALICE_SEEDELF,
  BOB_SEEDELF,
  busyFor,
  CAROL_SEEDELF,
  clock,
  type Directory,
  fakeRelay,
  type FakeRelay,
  fileOf,
  loadTestWasm,
  party,
  type Party,
  type ServiceOptions,
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
  notes: Map<Party, string[]>;
}

const keptNew = () =>
  new Response(JSON.stringify({ kept: "new", expires: Math.floor((clock.now + 36 * 3600_000) / 1000) }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** Every POST's body length into its poster's trace: `POST /messaging/v1/preprod/envelopes 2056`. */
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
    owner.trace[owner.trace.length - 1] = `${bare} ${new Uint8Array(init.body as Uint8Array).byteLength}`;
    return x.keeps(owner) ? real(url, init) : keptNew();
  };
}

/** Carol, A and B, Messages on; A and B each wrote first to Carol's Seedelf `firsts` messages of `text`, all posted. */
async function world(firsts = 1, text = (i: number) => `first ${i}`, options: ServiceOptions = {}): Promise<World> {
  const relay = fakeRelay(clock);
  const directory: Directory = new Map();
  const carol = await party(15, relay, directory, CAROL_SEEDELF);
  const a = await party(12, relay, directory, ALICE_SEEDELF, options);
  const b = await party(24, relay, directory, BOB_SEEDELF, options);
  const x: World = {
    relay,
    directory,
    carol,
    a,
    b,
    cidA: "",
    cidB: "",
    keeps: () => true,
    notes: new Map([
      [carol, []],
      [a, []],
      [b, []],
    ]),
  };
  watchPosts(x);
  await turnOn(carol, a, b);
  for (const [p, key] of [
    [a, "cidA"],
    [b, "cidB"],
  ] as const) {
    const cid = await p.messaging.start("preprod", CAROL_SEEDELF, text(1));
    await p.messaging.whenIdle();
    for (let i = 2; i <= firsts; i++) {
      await p.messaging.send("preprod", cid, text(i));
      await p.messaging.whenIdle();
    }
    x[key] = cid;
  }
  await synced(carol);
  expect((await carol.messaging.overview("preprod")).requests).toHaveLength(2);
  return x;
}

/** Carol accepts A's request and answers with a control kind this version doesn't know (0x80): her ratchet steps. */
async function hiddenReply(x: World): Promise<void> {
  await x.carol.messaging.accept("preprod", x.cidA);
  const file = (await fileOf(x.carol, x.cidA))!;
  const sent = JSON.parse(String(wasm.messagingSend(JSON.stringify({ conversation: file.state, plaintext: "80" })))) as { conversation: string; envelope: string };
  await setFileOf(x.carol, x.cidA, { ...file, state: sent.conversation });
  x.relay.put("preprod", sent.envelope);
}

/** Carol answers A with text, in the conversation she accepted (accepting it first where she hasn't). */
async function textReply(x: World, text = "hi"): Promise<void> {
  if ((await x.carol.messaging.overview("preprod")).requests.some((r) => r.cid === x.cidA)) await x.carol.messaging.accept("preprod", x.cidA);
  await x.carol.messaging.send("preprod", x.cidA, text);
  await x.carol.messaging.whenIdle();
}

/** From here A's and B's posts are answered and kept nowhere; their traces start afresh. */
function comparing(x: World): void {
  x.keeps = (p) => p === x.carol;
  x.a.trace.length = 0;
  x.b.trace.length = 0;
}

async function tick(p: Party, label: string): Promise<void> {
  p.trace.push(`# ${label}`);
  await p.messaging.sync("preprod");
  await p.messaging.whenIdle();
}

/** A press of the user's, and everything it started; a refusal is noted beside the traces, never in them. */
async function press(x: World, p: Party, label: string, act: () => Promise<unknown>): Promise<void> {
  p.trace.push(`# ${label}`);
  try {
    await act();
  } catch (e) {
    x.notes.get(p)!.push(`${label}: refused, ${e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e)}`);
  }
  await p.messaging.whenIdle();
}

/** What a party asked of any server, with the test's marks, in order. */
const asked = (p: Party) => p.trace.filter((s) => /^(GET|POST) |^chain |^# /.test(s));
const posts = (trace: string[]) => trace.filter((s) => s.startsWith("POST "));
const answered = async (p: Party, cid: string) => (await p.store.get<Inbox>("messaging.preprod"))!.conversations[cid]!.answered === true;

/** What the user can do in each one's conversation: what the screens are given. */
async function canDo(p: Party, cid: string) {
  const thread = await p.messaging.thread("preprod", cid);
  const listed = (await p.messaging.overview("preprod")).conversations.find((c) => c.cid === cid)!;
  return {
    dirs: thread.messages.map((m) => m.dir),
    unread: listed.unread,
    maxTextBytes: thread.maxTextBytes,
    firstContactLeft: listed.firstContactLeft,
    seedelfs: thread.seedelfs ?? [],
    unanswered: listed.unanswered,
  };
}

describe("a reply the thread doesn't show changes nothing the user can do (O4, fix item 3)", { timeout: 120_000 }, () => {
  it("a control-kind reply: A's room, share, Show my Seedelf and restart prompt are B's, the same press posts the same, and the traces are identical", async () => {
    const x = await world(1);
    await hiddenReply(x);
    comparing(x);
    await tick(x.a, "tick 1");
    await tick(x.b, "tick 1");
    // A's take received it: the ratchet stepped, the crate counts no share any more, but the worker holds it.
    expect((await fileOf(x.a, x.cidA))!.held).toBeDefined();
    expect(await answered(x.a, x.cidA)).toBe(false);
    const a = await canDo(x.a, x.cidA);
    const b = await canDo(x.b, x.cidB);
    expect(a).toEqual(b);
    expect(a.firstContactLeft).toBeDefined();
    expect(a.seedelfs).toEqual([]);
    // One byte past what's left, refused for both, in the same words; then the same short text, posted the same.
    const room = a.maxTextBytes;
    await press(x, x.a, "one past the room", () => x.a.messaging.send("preprod", x.cidA, "x".repeat(room + 1)));
    await press(x, x.b, "one past the room", () => x.b.messaging.send("preprod", x.cidB, "x".repeat(room + 1)));
    await press(x, x.a, "send ok", () => x.a.messaging.send("preprod", x.cidA, "ok"));
    await press(x, x.b, "send ok", () => x.b.messaging.send("preprod", x.cidB, "ok"));
    // Show my Seedelf: refused for both, before any key is used, after the same chain read.
    await press(x, x.a, "reveal", () => x.a.messaging.reveal("preprod", x.cidA, ALICE_SEEDELF));
    await press(x, x.b, "reveal", () => x.b.messaging.reveal("preprod", x.cidB, BOB_SEEDELF));
    expect(x.notes.get(x.a)).toEqual(x.notes.get(x.b)!.map((n) => n));
    expect(x.notes.get(x.a)).toHaveLength(2);
    expect(x.notes.get(x.a)![1]).toMatch(/^reveal: refused/);
    // The share each one's crate or hold counts: the same after the same posts.
    expect(await canDo(x.a, x.cidA)).toEqual(await canDo(x.b, x.cidB));
    // Past the 48 hours a first message is read in: the restart prompt, for both.
    await busyFor(48 * 3600_000 + 20 * 60_000, x.carol, x.a, x.b);
    await tick(x.a, "tick 2, past the window");
    await tick(x.b, "tick 2, past the window");
    const later = [await canDo(x.a, x.cidA), await canDo(x.b, x.cidB)];
    expect(later[0]).toEqual(later[1]);
    expect(later[0]!.unanswered).toBe(true);
    expect(asked(x.a)).toEqual(asked(x.b));
    expect(posts(asked(x.a))).toEqual(["POST /messaging/v1/preprod/envelopes 2056"]);
  });

  it("a control-kind reply after sixteen first messages: A's 17th is refused like B's, and a text reply after it lifts all of it", async () => {
    const x = await world(16);
    await hiddenReply(x);
    comparing(x);
    await tick(x.a, "tick 1");
    await tick(x.b, "tick 1");
    await press(x, x.a, "17th", () => x.a.messaging.send("preprod", x.cidA, "seventeenth"));
    await press(x, x.b, "17th", () => x.b.messaging.send("preprod", x.cidB, "seventeenth"));
    expect(x.notes.get(x.a)).toEqual([expect.stringContaining("ShareUsedUp")]);
    expect(x.notes.get(x.b)).toEqual([expect.stringContaining("ShareUsedUp")]);
    expect((await canDo(x.a, x.cidA)).maxTextBytes).toBe(0);
    expect(asked(x.a)).toEqual(asked(x.b));
    await expect(x.a.messaging.send("preprod", x.cidA, "again")).rejects.toBeInstanceOf(ShareUsedUp);
    // A reply the thread shows: answered, the share and its hold gone, Show my Seedelf offered, the 17th goes.
    await textReply(x);
    await tick(x.a, "tick 2");
    expect(await answered(x.a, x.cidA)).toBe(true);
    expect((await fileOf(x.a, x.cidA))!.held).toBeUndefined();
    const after = await canDo(x.a, x.cidA);
    expect(after.firstContactLeft).toBeUndefined();
    expect(after.seedelfs).toContain(ALICE_SEEDELF);
    expect(after.maxTextBytes).toBeGreaterThan(0);
    await press(x, x.a, "17th after the reply", () => x.a.messaging.send("preprod", x.cidA, "seventeenth"));
    expect(posts(asked(x.a)).at(-1)).toBe("POST /messaging/v1/preprod/envelopes 2056");
  });

  it("a text reply: the documented difference, the user reacting to what they read: A's 17th goes, B's is refused", async () => {
    const x = await world(16);
    await textReply(x);
    comparing(x);
    await tick(x.a, "tick 1");
    await tick(x.b, "tick 1");
    expect((await canDo(x.a, x.cidA)).dirs).toContain("in");
    await press(x, x.a, "17th", () => x.a.messaging.send("preprod", x.cidA, "seventeenth"));
    await press(x, x.b, "17th", () => x.b.messaging.send("preprod", x.cidB, "seventeenth"));
    expect(x.notes.get(x.a)).toEqual([]);
    expect(x.notes.get(x.b)).toEqual([expect.stringContaining("ShareUsedUp")]);
    // The same size it would have been: padding (O1 b) leaves only the press itself to tell.
    expect(posts(asked(x.a))).toEqual(["POST /messaging/v1/preprod/envelopes 2056"]);
    expect(posts(asked(x.b))).toEqual([]);
  });

  it("the hold is the crate's count, not the history's: a tight share trims A's posted first messages first, and A's 17th is still refused", async () => {
    // A conversation's share small enough that sixteen long first messages can't all stay in its record.
    const x = await world(16, (i) => `${i} ${"long ".repeat(200)}`, { shareBytes: 8192 });
    expect((await x.a.messaging.thread("preprod", x.cidA)).trimmed).toBeGreaterThan(0);
    await hiddenReply(x);
    comparing(x);
    await tick(x.a, "tick 1");
    await tick(x.b, "tick 1");
    expect((await fileOf(x.a, x.cidA))!.held).toMatchObject({ messages: 0 });
    await press(x, x.a, "17th", () => x.a.messaging.send("preprod", x.cidA, "seventeenth"));
    await press(x, x.b, "17th", () => x.b.messaging.send("preprod", x.cidB, "seventeenth"));
    expect(x.notes.get(x.a)).toEqual([expect.stringContaining("ShareUsedUp")]);
    expect(x.notes.get(x.b)).toEqual([expect.stringContaining("ShareUsedUp")]);
    expect(asked(x.a)).toEqual(asked(x.b));
  });
});
