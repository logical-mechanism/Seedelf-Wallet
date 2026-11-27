// Finding C1 (an outside review of 48480cf8, the 1.10.0 gate's relay oracles): a taken reply changed the size of the
// writer's next post. THE RULE: nothing about whether an envelope is the wallet's, and nothing it holds, may change
// which requests the wallet makes to any server, with what content, or when. Ported from the verifiers'
// verify2-c1-answered-size.test.ts and reversed by round 5's padding (relay-oracle fix item 1, the owner's call O1
// (b)): every message of either side is padded to the envelope its text would take as a first-contact message, so a
// reply taken changes no size. What's left is face 2's: the user pressing send because a reply they read came, which
// the share lets them do (fix item 3's documented difference, protocol.md §11).
//
// Paired worlds, every request compared in order. A and B each write first to Carol's Seedelf; Carol accepts A's
// request and replies (R). A and B are then served the same pages, R in them: R is A's, so only A's take receives it.
// Each user then does the same thing in their own conversation. Every POST's body length is written into the poster's
// trace, and the harness's log keeps it too (round 4's review, #9).
//
// What A and B post during a comparison is answered by the test and kept nowhere, so neither changes the other's pages.
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
  loadTestWasm,
  party,
  type Party,
  synced,
  turnOn,
} from "./messaging-harness";

const wasm = loadTestWasm();
const CONSTANTS = JSON.parse(wasm.messagingConstants()) as {
  firstContactMaxAge: number;
  maxRequestMessages: number;
  envelopeSizes: number[];
};

interface Post {
  size: number;
  envelope: string;
}

interface World {
  relay: FakeRelay;
  directory: Directory;
  /** Written to: takes both first messages as requests. */
  carol: Party;
  /** Wrote first to Carol: the one Carol answers (when she does). */
  a: Party;
  /** Wrote first to Carol too: never answered. */
  b: Party;
  cidA: string;
  cidB: string;
  /** Whose posts reach the pool: every one in a setup; in a comparison, the writer's only. */
  keeps: (p: Party) => boolean;
  /** Every post each party made, its body's length and its envelope (hex), in order. */
  posts: Map<Party, Post[]>;
  /** What each refused press threw, beside the request traces. */
  notes: Map<Party, string[]>;
}

const hexOf = (b: Uint8Array) => Buffer.from(b).toString("hex");

const keptNew = () =>
  new Response(JSON.stringify({ kept: "new", expires: Math.floor((clock.now + 36 * 3600_000) / 1000) }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/**
 * Every POST's body length into its poster's trace: `POST /messaging/v1/preprod/envelopes 2056`. The fake relay's
 * client tells the poster's trace of the request and calls the relay's fetch at once, in the same turn, so the one
 * trace that ends with the bare line is the poster's (each is annotated as it goes, so none is left bare).
 */
function watchPosts(x: World): void {
  const parties = [x.carol, x.a, x.b];
  const real = x.relay.fetch;
  x.relay.fetch = async (url, init) => {
    const u = new URL(url);
    // A certificate's post (chunk 55's 55e), the turn-on's, is no envelope: what these tests compare are the envelopes.
    if (init.method !== "POST" || u.pathname.endsWith("/certificates")) return real(url, init);
    const bare = `POST ${u.pathname}${u.search}`;
    const owners = parties.filter((p) => p.trace.at(-1) === bare);
    if (owners.length !== 1) throw new Error(`a post whose poster can't be told (${owners.length})`);
    const owner = owners[0]!;
    const body = new Uint8Array(init.body as Uint8Array);
    owner.trace[owner.trace.length - 1] = `${bare} ${body.byteLength}`;
    x.posts.get(owner)!.push({ size: body.byteLength, envelope: hexOf(body.subarray(8)) });
    return x.keeps(owner) ? real(url, init) : keptNew();
  };
}

/**
 * Carol, A and B on one relay, Messages on; A and B each wrote first to Carol's Seedelf (`firsts` messages each, every
 * one posted), and Carol's wallet took both as requests.
 */
async function world(firsts = 1): Promise<World> {
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
    const cid = await p.messaging.start("preprod", CAROL_SEEDELF, "hello Carol");
    await p.messaging.whenIdle();
    for (let i = 2; i <= firsts; i++) {
      await p.messaging.send("preprod", cid, `first ${i}`);
      await p.messaging.whenIdle();
    }
    x[key] = cid;
  }
  expect(x.posts.get(a)!.map((q) => q.size)).toEqual(Array(firsts).fill(8 + 2048));
  expect(x.posts.get(b)!.map((q) => q.size)).toEqual(Array(firsts).fill(8 + 2048));
  await synced(carol);
  const requests = (await carol.messaging.overview("preprod")).requests;
  expect(requests.map((r) => r.cid).sort()).toEqual([x.cidA, x.cidB].sort());
  expect(requests.every((r) => r.messages === firsts)).toBe(true);
  return x;
}

/** Carol accepts A's request and replies `text`: R, posted. Returns R's envelope (hex). */
async function reply(x: World, text = "hi"): Promise<string> {
  await x.carol.messaging.accept("preprod", x.cidA);
  await x.carol.messaging.send("preprod", x.cidA, text);
  await x.carol.messaging.whenIdle();
  return x.posts.get(x.carol)!.at(-1)!.envelope;
}

/** From here A's and B's posts are answered and kept nowhere; their traces start afresh. */
function comparing(x: World, ...parties: Party[]): void {
  x.keeps = (p) => !parties.includes(p);
  for (const p of parties) p.trace.length = 0;
}

/** One tick of `p`'s alarm: its sync, and everything it started (the take), to the end. */
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

function paired(name: string, a: string[], b: string[]): { identical: boolean; at: number } {
  let at = 0;
  while (at < a.length && at < b.length && a[at] === b[at]) at++;
  const identical = at === a.length && at === b.length;
  console.log(
    `[C1] ${name}: ${identical ? "IDENTICAL" : `DIFFERENT from entry ${at}`}\n  first:  ${JSON.stringify(a)}\n  second: ${JSON.stringify(b)}`,
  );
  return { identical, at };
}

/** What Carol's key opens `envelope` as: its kind (session or first-contact), and F's t and to for a first message. */
async function opened(carol: Party, envelope: string): Promise<{ kind?: string; t?: number | null; to?: string | null; refused?: string }> {
  return carol.wallet.withKeys((keys) => JSON.parse(String(wasm.messagingOpen(keys.messaging.preprod!, envelope))));
}

const answeredIn = async (p: Party, cid: string) => (await p.store.get<Inbox>("messaging.preprod"))!.conversations[cid]!.answered === true;

/** 512 bytes nobody's, at the version the relay takes. */
const junk = (n: number, size = 512) => "01" + n.toString(16).padStart(8, "0") + "5a".repeat(size - 5);

/** The relay serves `replacement` where `envelope` was, at the same place in the pool: what it hands out is its choice. */
function swapHeld(relay: FakeRelay, envelope: string, replacement: string): void {
  const held = relay.pools.get("preprod")!.held.find((h) => hexOf(h.bytes) === envelope);
  if (!held) throw new Error("not held");
  held.bytes = Uint8Array.from(Buffer.from(replacement, "hex"));
}

const POST_LINE = /^POST \/messaging\/v1\/preprod\/envelopes (\d+)$/;
const postSizes = (trace: string[]) => trace.flatMap((s) => (POST_LINE.test(s) ? [Number(POST_LINE.exec(s)![1])] : []));
const gets = (trace: string[]) => trace.filter((s) => s.startsWith("GET "));

describe("C1: a taken reply changes no size of the writer's next post (paired worlds; padding, O1 b)", { timeout: 120_000 }, () => {
  it("face 1: the same pages to A and B, R in them; the same short text after: both post 2,056 bytes, and the traces are identical", async () => {
    const x = await world();
    const r = await reply(x);
    // R itself: a short reply, padded to its first-contact size.
    expect(r.length / 2).toBe(2048);
    comparing(x, x.a, x.b);
    await tick(x.a, "tick 1");
    await tick(x.b, "tick 1");
    // The same pages: one GET each, the same cursor.
    expect(gets(asked(x.a))).toEqual(gets(asked(x.b)));
    expect(gets(asked(x.a))).toHaveLength(1);
    // Only A's take received R: A's conversation is answered, B's isn't.
    expect([await answeredIn(x.a, x.cidA), await answeredIn(x.b, x.cidB)]).toEqual([true, false]);
    const logged = { a: x.a.log.length, b: x.b.log.length };
    await press(x, x.a, "send ok", () => x.a.messaging.send("preprod", x.cidA, "ok"));
    await press(x, x.b, "send ok", () => x.b.messaging.send("preprod", x.cidB, "ok"));
    const result = paired("face 1, A vs B, same pages", asked(x.a), asked(x.b));
    expect(result.identical).toBe(true);
    expect(postSizes(asked(x.a))).toEqual([8 + 2048]);
    expect(postSizes(asked(x.b))).toEqual([8 + 2048]);
    // The harness's log says the same of each POST: its body's length.
    const posted = (p: Party, from: number) => p.log.slice(from).flatMap((e) => (e.what === "POST" ? [e.bytes] : []));
    expect(posted(x.a, logged.a)).toEqual([8 + 2048]);
    expect(posted(x.b, logged.b)).toEqual([8 + 2048]);
    // What the two posts are, as Carol's key opens them: A's a session message, B's a first-contact one; the relay sees
    // two envelopes of one size.
    const aKind = await opened(x.carol, x.posts.get(x.a)!.at(-1)!.envelope);
    const bKind = await opened(x.carol, x.posts.get(x.b)!.at(-1)!.envelope);
    expect(aKind.kind).toBe("session");
    expect(bKind).toMatchObject({ kind: "first-contact", to: CAROL_SEEDELF });
    expect(x.notes.get(x.a)).toEqual([]);
    expect(x.notes.get(x.b)).toEqual([]);
  });

  it("face 1, one wallet in two worlds: R served, or an envelope nobody's in its place; A's next short post is the same", async () => {
    const runs: string[][] = [];
    for (const served of [true, false]) {
      const x = await world();
      const r = await reply(x);
      if (!served) swapHeld(x.relay, r, junk(1, r.length / 2));
      comparing(x, x.a);
      await tick(x.a, "tick 1");
      expect(await answeredIn(x.a, x.cidA)).toBe(served);
      await press(x, x.a, "send ok", () => x.a.messaging.send("preprod", x.cidA, "ok"));
      runs.push(asked(x.a));
    }
    const result = paired("face 1, A served R vs A served junk in its place", runs[0]!, runs[1]!);
    expect(result.identical).toBe(true);
    expect(postSizes(runs[0]!)).toEqual([8 + 2048]);
  });

  it("face 2, the share: after 16 first messages each, a 17th text: refused for both before the take; after it A's goes, at 2,056, B's is refused (documented)", async () => {
    expect(CONSTANTS.maxRequestMessages).toBe(16);
    const x = await world(16);
    await reply(x);
    comparing(x, x.a, x.b);
    // Before any take of R: both refused, nothing asked, in words (the wallet's own refusal).
    await press(x, x.a, "17th before the take", () => x.a.messaging.send("preprod", x.cidA, "seventeenth"));
    await press(x, x.b, "17th before the take", () => x.b.messaging.send("preprod", x.cidB, "seventeenth"));
    expect(x.notes.get(x.a)).toEqual([expect.stringContaining("ShareUsedUp")]);
    expect(x.notes.get(x.b)).toEqual([expect.stringContaining("ShareUsedUp")]);
    expect((await x.a.messaging.thread("preprod", x.cidA)).maxTextBytes).toBe(0);
    await tick(x.a, "tick 1");
    await tick(x.b, "tick 1");
    expect(gets(asked(x.a))).toEqual(gets(asked(x.b)));
    // After it: A's goes, a session message of the same size any message of hers is; B's is refused again. The user
    // reacting to a reply they read: protocol.md §11's documented difference (fix item 3).
    await press(x, x.a, "17th after the take", () => x.a.messaging.send("preprod", x.cidA, "seventeenth"));
    await press(x, x.b, "17th after the take", () => x.b.messaging.send("preprod", x.cidB, "seventeenth"));
    const result = paired("face 2, the 17th text, A (R taken) vs B", asked(x.a), asked(x.b));
    expect(result.identical).toBe(false);
    expect(postSizes(asked(x.a))).toEqual([8 + 2048]);
    expect(postSizes(asked(x.b))).toEqual([]);
    expect(x.notes.get(x.a)).toHaveLength(1);
    expect(x.notes.get(x.b)).toEqual([expect.stringContaining("ShareUsedUp"), expect.stringContaining("ShareUsedUp")]);
    expect((await x.a.messaging.thread("preprod", x.cidA)).maxTextBytes).toBeGreaterThan(0);
    expect((await x.b.messaging.thread("preprod", x.cidB)).maxTextBytes).toBe(0);
    await expect(x.b.messaging.send("preprod", x.cidB, "again")).rejects.toBeInstanceOf(ShareUsedUp);
  });

  it("face 4, past the 48 hours a first message is read in: A (answered) and B (unanswered) both post 2,056, identical", async () => {
    // The window, in the crate (first_contact.rs FIRST_CONTACT_MAX_AGE, within_window): t + 48 hours, read only for a
    // first message that starts a request (inbox.rs receive_opened); the worker uses it only to say `unanswered`.
    expect(CONSTANTS.firstContactMaxAge).toBe(48 * 3600);
    const x = await world();
    await reply(x);
    comparing(x, x.a, x.b);
    await tick(x.a, "tick 1");
    await tick(x.b, "tick 1");
    await busyFor(CONSTANTS.firstContactMaxAge * 1000 + 20 * 60_000, x.carol, x.a, x.b);
    const unanswered = async (p: Party, cid: string) =>
      (await p.messaging.overview("preprod")).conversations.find((c) => c.cid === cid)!.unanswered;
    expect([await unanswered(x.a, x.cidA), await unanswered(x.b, x.cidB)]).toEqual([false, true]);
    await tick(x.a, "tick 2, past the window");
    await tick(x.b, "tick 2, past the window");
    await press(x, x.a, "send ok", () => x.a.messaging.send("preprod", x.cidA, "ok"));
    await press(x, x.b, "send ok", () => x.b.messaging.send("preprod", x.cidB, "ok"));
    const result = paired("face 4, past t + 48 h, A (answered) vs B (unanswered)", asked(x.a), asked(x.b));
    expect(result.identical).toBe(true);
    expect(postSizes(asked(x.a))).toEqual([8 + 2048]);
    expect(postSizes(asked(x.b))).toEqual([8 + 2048]);
    expect(x.notes.get(x.b)).toEqual([]);
    const bPost = x.posts.get(x.b)!.at(-1)!;
    const bKind = await opened(x.carol, bPost.envelope);
    expect(bKind.kind).toBe("first-contact");
    expect(Math.floor(clock.now / 1000)).toBeGreaterThan(bKind.t! + CONSTANTS.firstContactMaxAge);
    // A reader that holds the request still takes it, as a join (no window for one): B's late post isn't lost.
    x.relay.put("preprod", bPost.envelope);
    await synced(x.carol);
    const request = (await x.carol.messaging.overview("preprod")).requests.find((q) => q.cid === x.cidB);
    expect(request?.messages).toBe(2);
  });
});
