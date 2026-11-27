// C1's third face (an outside review of 48480cf8, the 1.10.0 gate's relay oracles), and relay-oracle fix item 2: a
// text left `queued` past the writer's share at the first-contact stamp's turn (stamp() -> sealQueued leaves one the
// crate refuses `request_full` queued) was sealed by the take of a reply, and the next sync posted it with no press.
// Since round 5 nothing a take does seals or posts a message: a text so left waits for the user's next press in that
// conversation, which seals it first. Ported from the verifiers' verify2-c1-queued-share.test.ts.
//
// Part 1 tries to reach that state the way a user can: texts of every length, ASCII and multibyte, written while the
// stamp is still being solved, so the share's bytes and its 16 messages run out at sealing. The worker counts each
// queued text against the share before it queues the next (`shareOf`, send's checks), so every text it lets through
// must seal: none may be left queued, and the harness fails any test that reaches the defensive branch (`unreachable`).
//
// Part 2 makes the state by force (a binding that says one message more is left than the crate allows, so a 17th
// text queues and the crate refuses it at the stamp's turn) to see what the take of a reply does with it now, in
// paired worlds: nothing. That state isn't one a user can reach (part 1).
import { describe, expect, it } from "vitest";

import { ShareUsedUp } from "../src/background/messaging";
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
  synced,
  turnOn,
  type Wasm,
} from "./messaging-harness";

const wasm = loadTestWasm();

/** WebAssembly whose stamp search finds nothing while `held.on`; `overReport` says one message more of the share is left. */
function binding(held: { on: boolean }, overReport = false): Wasm {
  return {
    ...wasm,
    messagingFindStamp: (request) => (held.on ? JSON.stringify({ nonce: null }) : wasm.messagingFindStamp(request)),
    ...(overReport
      ? {
          messagingConversationInfo: (record: string) => {
            const info = JSON.parse(String(wasm.messagingConversationInfo(record)));
            if (info.firstContactLeft) info.firstContactLeft.messages += 1;
            return JSON.stringify(info);
          },
        }
      : {}),
  };
}

const keptNew = () =>
  new Response(JSON.stringify({ kept: "new", expires: Math.floor((clock.now + 36 * 3600_000) / 1000) }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** Every POST's body length into its poster's trace (see verify2-c1-answered-size.test.ts's `watchPosts`). */
function watchPosts(relay: FakeRelay, parties: Party[], keeps: () => (p: Party) => boolean, posts: Map<Party, number[]>): void {
  const real = relay.fetch;
  relay.fetch = async (url, init) => {
    const u = new URL(url);
    // A certificate's post (chunk 55's 55e), the turn-on's, is no envelope: what these tests compare are the envelopes.
    if (init.method !== "POST" || u.pathname.endsWith("/certificates")) return real(url, init);
    const bare = `POST ${u.pathname}${u.search}`;
    const owners = parties.filter((p) => p.trace.at(-1) === bare);
    if (owners.length !== 1) throw new Error(`a post whose poster can't be told (${owners.length})`);
    const owner = owners[0]!;
    const body = new Uint8Array(init.body as Uint8Array);
    owner.trace[owner.trace.length - 1] = `${bare} ${body.byteLength}`;
    posts.get(owner)!.push(body.byteLength);
    return keeps()(owner) ? real(url, init) : keptNew();
  };
}

const asked = (p: Party) => p.trace.filter((s) => /^(GET|POST) |^chain |^# /.test(s));

async function tick(p: Party, label: string): Promise<void> {
  p.trace.push(`# ${label}`);
  await p.messaging.sync("preprod");
  await p.messaging.whenIdle();
}

function paired(name: string, a: string[], b: string[]): { identical: boolean; at: number } {
  let at = 0;
  while (at < a.length && at < b.length && a[at] === b[at]) at++;
  const identical = at === a.length && at === b.length;
  console.log(`[C1] ${name}: ${identical ? "IDENTICAL" : `DIFFERENT from entry ${at}`}\n  first:  ${JSON.stringify(a)}\n  second: ${JSON.stringify(b)}`);
  return { identical, at };
}

/** A small seeded generator, so a failing plan is the same plan when run again. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const utf8 = (s: string) => new TextEncoder().encode(s).length;

/**
 * A string of exactly `bytes` UTF-8 bytes, of random characters of 1 to 4 bytes and lone surrogates (3 bytes each, as
 * U+FFFD; a high one then a low one is a pair, 4 bytes, which the count follows from the last code unit).
 */
function multibyte(bytes: number, next: () => number): string {
  const pieces = ["a", "é", "あ", "😀", "\uD800", "\uDFFF", "ß", "€"];
  let out = "";
  let left = bytes;
  while (left > 0) {
    const piece = pieces[Math.floor(next() * pieces.length)]!;
    const tail = out.slice(-1);
    const n = utf8(tail + piece) - utf8(tail);
    if (n > left) {
      out += "z".repeat(left);
      break;
    }
    out += piece;
    left -= n;
  }
  if (utf8(out) !== bytes) throw new Error(`multibyte made ${utf8(out)} bytes, not ${bytes}`);
  return out;
}

type Plan = { name: string; first: string; next: (room: number, last: "accepted" | "tooLong" | "shareUsedUp" | undefined, r: () => number) => string | undefined };

const PLANS: Plan[] = [
  { name: "the largest text each time", first: "first", next: (room) => (room > 0 ? "x".repeat(room) : "x") },
  {
    name: "one byte past the room, then the room",
    first: "first",
    next: (room, last) => (room === 0 ? "x" : last === "tooLong" ? "x".repeat(room) : "x".repeat(room + 1)),
  },
  { name: "random ASCII lengths", first: "first", next: (room, _l, r) => (room > 0 ? "y".repeat(1 + Math.floor(r() * room)) : "y") },
  { name: "random multibyte, exactly a random part of the room", first: "あ😀", next: (room, _l, r) => (room > 0 ? multibyte(1 + Math.floor(r() * room), r) || "q" : "あ") },
  { name: "multibyte at the room's edge", first: "€", next: (room, _l, r) => (room > 0 ? multibyte(room, r) : "😀") },
  { name: "the room less up to 700 bytes (near F's own part)", first: "first", next: (room, _l, r) => (room > 0 ? "w".repeat(Math.max(1, room - Math.floor(r() * 700))) : "w") },
  { name: "the largest first text, then the largest", first: "x".repeat(32_024), next: (room) => (room > 0 ? "x".repeat(room) : "x") },
  { name: "sixteen one-byte texts, then a seventeenth", first: "1", next: () => "s" },
];

describe("C1 face 3: a text left queued past the share at the stamp's turn (fix item 2)", { timeout: 300_000 }, () => {
  it("part 1: can't be reached by writing while the stamp is solved; every text the worker lets through seals, none stays queued", async () => {
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const carol = await party(15, relay, directory, CAROL_SEEDELF);
    const a = await party(12, relay, directory, ALICE_SEEDELF);
    // Carol's turn-on posts her certificate (chunk 55's 55e): what A writes first to her on.
    await turnOn(carol, a);
    // The defensive branch fails the test if it's reached (the harness's `unreachable`).
    expect(a.unreachableOk).toBe(false);
    const held = { on: true };
    a.restart(binding(held));
    const summary: string[] = [];
    for (const [k, plan] of PLANS.entries()) {
      const r = rng(1000 + k);
      held.on = true;
      let cid: string;
      try {
        cid = await a.messaging.start("preprod", CAROL_SEEDELF, plan.first);
      } catch (e) {
        throw new Error(`${plan.name}: the first text was refused: ${(e as Error).message}`);
      }
      const accepted = [plan.first];
      const refusals: string[] = [];
      let last: "accepted" | "tooLong" | "shareUsedUp" | undefined;
      for (let step = 0; step < 60; step++) {
        const room = (await a.messaging.thread("preprod", cid)).maxTextBytes;
        const text = plan.next(room, last, r);
        if (text === undefined) break;
        const before = (await a.messaging.thread("preprod", cid)).messages.length;
        try {
          await a.messaging.send("preprod", cid, text);
          accepted.push(text);
          last = "accepted";
          // What the worker let through, it counted against what's left.
          expect(utf8(text)).toBeLessThanOrEqual(room);
        } catch (e) {
          // Refused before it's queued: nothing of it kept.
          expect((await a.messaging.thread("preprod", cid)).messages.length).toBe(before);
          if (e instanceof ShareUsedUp) {
            refusals.push("ShareUsedUp");
            last = "shareUsedUp";
            break;
          }
          expect((e as Error).message).toMatch(/^A message can be at most \d+ bytes\.$/);
          expect(utf8(text)).toBeGreaterThan(room);
          refusals.push("tooLong");
          last = "tooLong";
        }
      }
      expect(last).toBe("shareUsedUp");
      // Every one is still waiting for the stamp.
      const waiting = (await a.messaging.thread("preprod", cid)).messages;
      expect(waiting.every((m) => m.sent === "queued")).toBe(true);
      // The stamp found: its turn seals every queued text in order (stamp() -> sealQueued).
      held.on = false;
      await a.messaging.whenIdle();
      const after = (await a.messaging.thread("preprod", cid)).messages;
      const states = after.map((m) => m.sent);
      const file = (await fileOf(a, cid))!;
      const info = JSON.parse(String(wasm.messagingConversationInfo(file.state))) as {
        sentInChain: number;
        firstContactLeft: { messages: number; bytes: number; perMessage: number } | null;
      };
      const bytesUsed = accepted.reduce((s, t) => s + utf8(t) + 1 + info.firstContactLeft!.perMessage, 0);
      summary.push(
        `${plan.name}: ${accepted.length} let through (${bytesUsed} share bytes of 65,536), refused ${JSON.stringify(refusals)}; after the stamp's turn ${JSON.stringify(
          [...new Set(states)],
        )}; the crate sealed ${info.sentInChain}, left ${JSON.stringify({ messages: info.firstContactLeft!.messages, bytes: info.firstContactLeft!.bytes })}`,
      );
      expect(states.every((s) => s === "posted")).toBe(true);
      expect(after.map((m) => m.text)).toEqual(accepted);
      expect(file.history.some((e) => e.sent === "queued")).toBe(false);
      expect(info.sentInChain).toBe(accepted.length);
      // The crate's own count and the worker's agree: what it has left is exactly what the worker said was used.
      expect(65_536 - info.firstContactLeft!.bytes).toBe(bytesUsed);
    }
    console.log(`[C1] face 3 part 1, ${PLANS.length} plans:\n  ${summary.join("\n  ")}`);
    expect(a.unreachable).toEqual([]);
  });

  it("part 2 (a forced state, not one a user can reach): the take of R seals nothing; three ticks the same for A and B, no POST; A's next press posts the 17th with its own", async () => {
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const carol = await party(15, relay, directory, CAROL_SEEDELF);
    const a = await party(12, relay, directory, ALICE_SEEDELF);
    const b = await party(24, relay, directory, BOB_SEEDELF);
    const posts = new Map<Party, number[]>([
      [carol, []],
      [a, []],
      [b, []],
    ]);
    let keeps: (p: Party) => boolean = () => true;
    watchPosts(relay, [carol, a, b], () => keeps, posts);
    await turnOn(carol, a, b);
    const held = { on: true };
    const cids = new Map<Party, string>();
    for (const p of [a, b]) {
      // The binding misreports the share: the defensive branch is reached, as meant.
      p.unreachableOk = true;
      held.on = true;
      p.restart(binding(held, true));
      const cid = await p.messaging.start("preprod", CAROL_SEEDELF, "1");
      for (let i = 2; i <= 17; i++) await p.messaging.send("preprod", cid, String(i));
      held.on = false;
      await p.messaging.whenIdle();
      cids.set(p, cid);
      const sent = (await p.messaging.thread("preprod", cid)).messages.map((m) => m.sent);
      // The stamp's turn: 16 sealed and posted; the crate refused the 17th (`request_full`), which stays queued.
      expect(sent).toEqual([...Array(16).fill("posted"), "queued"]);
      expect(p.unreachable).toEqual(["sealQueued"]);
    }
    expect(posts.get(a)).toEqual(Array(16).fill(8 + 2048));
    await synced(carol);
    await carol.messaging.accept("preprod", cids.get(a)!);
    await carol.messaging.send("preprod", cids.get(a)!, "hi");
    await carol.messaging.whenIdle();
    keeps = (p) => p === carol;
    a.trace.length = 0;
    b.trace.length = 0;
    for (const label of ["tick 1", "tick 2", "tick 3"]) {
      await tick(a, label);
      await tick(b, label);
    }
    const result = paired("face 3 part 2 (forced), A (R taken) vs B, three ticks, no press", asked(a), asked(b));
    expect(result.identical).toBe(true);
    expect(asked(a).filter((s) => s.startsWith("POST "))).toEqual([]);
    // Still queued in A's thread after the take: nothing a take does seals it.
    expect((await a.messaging.thread("preprod", cids.get(a)!)).messages.at(16)!.sent).toBe("queued");
    expect((await b.messaging.thread("preprod", cids.get(b)!)).messages.at(16)!.sent).toBe("queued");
    // A's next press in that conversation seals it first, then the new one: both posted, at the same size.
    await a.messaging.send("preprod", cids.get(a)!, "after the reply");
    await a.messaging.whenIdle();
    expect(asked(a).filter((s) => s.startsWith("POST "))).toEqual(Array(2).fill("POST /messaging/v1/preprod/envelopes 2056"));
    expect((await a.messaging.thread("preprod", cids.get(a)!)).messages.slice(16).map((m) => [m.text, m.dir === "in" ? "in" : m.sent])).toEqual([
      ["17", "posted"],
      ["hi", "in"],
      ["after the reply", "posted"],
    ]);
  });
});
