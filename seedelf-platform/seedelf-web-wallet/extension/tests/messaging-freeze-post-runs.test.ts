// What a post's answer does to the worker's posting runs over time (the 1.10.0 gate's round 5, the §20 freeze review's
// fixes C, D and F), ported from the verifiers' verify2-freeze-post-runs.test.ts with each defect's case reversed. A
// post with no answer moves the run on past it, nothing counted (C); the strikes, where the next run starts and the
// waits the relay asked for outlive the worker in session storage, which names no conversation (D); a 402 whose price
// the post's work already meets is a strike, not the same bytes again (F). A restarted worker (Chrome stops an idle
// one) is `restart()`: a new service on the same storage.
import { describe, expect, it } from "vitest";

import { SESSION_POSTS } from "../src/background/messaging";
import { RELAY_HOLD_MS } from "../src/background/relay";
import { clock, type FakeRelay, fileOf, loadTestWasm, pair, PASSWORD, type Party, recordName, synced, talking, type Wasm } from "./messaging-harness";

const envelopeOf = (init: RequestInit) => Buffer.from(new Uint8Array(init.body as ArrayBuffer).subarray(8)).toString("hex");
const json = (status: number, value: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });

/** Alice with two messages waiting, `first` and `second` (hex envelopes), in that order. */
async function twoWaiting() {
  const { relay, alice, bob } = await pair();
  const cid = await talking(alice, bob);
  relay.up = false;
  await alice.messaging.send("preprod", cid, "first");
  await alice.messaging.send("preprod", cid, "second");
  await alice.messaging.whenIdle();
  relay.up = true;
  const history = (await fileOf(alice, cid))!.history;
  return { relay, alice, bob, cid, first: history.at(-2)!.envelope!, second: history.at(-1)!.envelope! };
}

/** The relay's own answers but for posts of `envelope`, which `answer` gives (after `real`'s if `keep`). */
function answeringFor(relay: FakeRelay, envelope: string, answer: () => Response, keep = false): { posts: number } {
  const real = relay.fetch;
  const seen = { posts: 0 };
  relay.fetch = async (url, init) => {
    if (init.method !== "POST" || envelopeOf(init) !== envelope) return real(url, init);
    seen.posts++;
    if (keep) await real(url, init);
    else relay.calls.push(`POST ${new URL(url).pathname}`);
    return answer();
  };
  return seen;
}

const sent = async (p: Party, cid: string) => (await p.messaging.thread("preprod", cid)).messages.slice(-2).map((m) => m.sent);

function counting(finds: { n: number }): Wasm {
  const wasm = loadTestWasm();
  return {
    ...wasm,
    messagingFindStamp: (request: string) => {
      finds.n++;
      return wasm.messagingFindStamp(request);
    },
  };
}

/** Everything `p`'s session storage holds, keys and values: what must never name a conversation (fix D). */
const sessionText = (p: Party) => [...p.session.data].map(([k, v]) => `${k}=${String(v)}`).join("\n");

/** Every name of a conversation `p` holds: its cids and its records' own IDs. */
async function namesOf(p: Party): Promise<string[]> {
  const inbox = await p.store.get<{ conversations: Record<string, { id?: string }> }>("messaging.preprod");
  const out: string[] = [];
  for (const [cid, meta] of Object.entries(inbox?.conversations ?? {})) {
    out.push(cid);
    if (meta.id) out.push(meta.id);
    out.push(await recordName(p, cid));
  }
  return out;
}

async function expectNoConversationInSession(p: Party): Promise<void> {
  const text = sessionText(p);
  const names = await namesOf(p);
  expect(names.length).toBeGreaterThan(0);
  for (const name of names) expect(text).not.toContain(name);
  // Only these keys of Messages', each a fixed shape: numbers by network, and digests where it says.
  const keys = [...p.session.data.keys()].filter((k) => k.startsWith("seedelf.messaging."));
  // And the certificate list's mark that it was read in this unlock (chunk 55's 55e): a number by network.
  for (const key of keys) {
    expect(["seedelf.messaging.paused", "seedelf.messaging.readAfter", "seedelf.messaging.expiredAt", "seedelf.messaging.listed", SESSION_POSTS]).toContain(key);
  }
  const posts = p.session.data.get(SESSION_POSTS);
  if (posts !== undefined) {
    for (const runs of Object.values(JSON.parse(posts as string) as Record<string, Record<string, unknown>>)) {
      for (const [field, value] of Object.entries(runs)) {
        expect(["from", "strikes", "after", "sizes"]).toContain(field);
        if (field === "from") expect(value).toMatch(/^[0-9a-f]{64}$/);
        if (field === "after") expect(typeof value).toBe("number");
        if (field === "strikes") for (const [k, n] of Object.entries(value as object)) expect([k.length, typeof n]).toEqual([64, "number"]);
        if (field === "sizes") for (const [k, n] of Object.entries(value as object)) expect([[512, 2048, 8192, 32768].includes(Number(k)), typeof n]).toEqual([true, "number"]);
      }
    }
  }
}

describe("a post's answer and the posting run (the freeze's fixes C, D and F)", { timeout: 60_000 }, () => {
  it("F: a 402 naming a price the post already shows is a strike: one POST of it a sync, the next posted at the second, it set aside at the third", async () => {
    const { relay, alice, cid, first } = await twoWaiting();
    // The page prices every size at 4 bits; the post is solved at 4, and the relay asks 2.
    const seen = answeringFor(relay, first, () => json(402, { error: "more proof of work", price: 2 }));
    const perSync: number[] = [];
    const states: string[][] = [];
    for (let i = 0; i < 3; i++) {
      const before = seen.posts;
      clock.now += 10_000;
      await synced(alice);
      perSync.push(seen.posts - before);
      states.push((await sent(alice, cid)) as string[]);
    }
    expect(perSync).toEqual([1, 1, 1]);
    expect(states).toEqual([
      ["pending", "pending"],
      ["pending", "posted"],
      ["refused", "posted"],
    ]);
    // Set aside with its bytes, to send again.
    expect((await alice.messaging.thread("preprod", cid)).messages.at(-2)).toMatchObject({ sent: "refused", refusedBy: "server", resend: true });
  });

  it("D: an answer this version doesn't know (a 418), the worker restarted between syncs: the other posted at the second, the first set aside at the third", async () => {
    const { relay, alice, cid, first } = await twoWaiting();
    const seen = answeringFor(relay, first, () => new Response("I'm a teapot", { status: 418 }));
    const states: string[][] = [];
    for (let i = 0; i < 3; i++) {
      alice.restart();
      clock.now += 60_000;
      await synced(alice);
      states.push((await sent(alice, cid)) as string[]);
      await expectNoConversationInSession(alice);
    }
    expect(seen.posts).toBe(3);
    expect(states).toEqual([
      ["pending", "pending"],
      ["pending", "posted"],
      ["refused", "posted"],
    ]);
  });

  it("D: a lock between two syncs starts the count again", async () => {
    const { relay, alice, cid, first } = await twoWaiting();
    const seen = answeringFor(relay, first, () => new Response("I'm a teapot", { status: 418 }));
    clock.now += 60_000;
    await synced(alice);
    clock.now += 60_000;
    await synced(alice);
    expect(await sent(alice, cid)).toEqual(["pending", "posted"]);
    // Two strikes; a lock: the count, and where the next run starts, go with it.
    await alice.wallet.lock();
    await alice.wallet.unlock(PASSWORD);
    expect(alice.session.data.get(SESSION_POSTS)).toBeUndefined();
    for (let i = 0; i < 2; i++) {
      clock.now += 60_000;
      await synced(alice);
    }
    expect(await sent(alice, cid)).toEqual(["pending", "posted"]);
    clock.now += 60_000;
    await synced(alice);
    expect(await sent(alice, cid)).toEqual(["refused", "posted"]);
    expect(seen.posts).toBe(5);
  });

  it("C: a 500 to one envelope's posts, the worker kept alive and then restarted: the other posted at the next sync, the first pending, never refused", async () => {
    const { relay, alice, cid, first } = await twoWaiting();
    let failing = true;
    const real = relay.fetch;
    let answered = 0;
    relay.fetch = async (url, init) => {
      if (failing && init.method === "POST" && envelopeOf(init) === first) {
        relay.calls.push(`POST ${new URL(url).pathname}`);
        answered++;
        return new Response("internal error", { status: 500 });
      }
      return real(url, init);
    };
    clock.now += 60_000;
    await synced(alice);
    expect(await sent(alice, cid)).toEqual(["pending", "pending"]);
    clock.now += 60_000;
    await synced(alice);
    expect(await sent(alice, cid)).toEqual(["pending", "posted"]);
    for (let i = 0; i < 4; i++) {
      alice.restart();
      clock.now += 60_000;
      await synced(alice);
    }
    // No answer is never a strike: it waits, pending, however many syncs.
    expect(answered).toBe(6);
    expect(await sent(alice, cid)).toEqual(["pending", "posted"]);
    failing = false;
    clock.now += 60_000;
    await synced(alice);
    expect(await sent(alice, cid)).toEqual(["posted", "posted"]);
  });

  it("C: a 200 past 4,096 bytes is no answer: 'second' goes at the next sync, and the first is never set aside", async () => {
    const { relay, alice, bob, cid, first } = await twoWaiting();
    const seen = answeringFor(relay, first, () => json(200, { kept: "new", expires: 1_900_000_000, pad: "x".repeat(5000) }), true);
    clock.now += 10_000;
    await synced(alice);
    expect(await sent(alice, cid)).toEqual(["pending", "pending"]);
    clock.now += 10_000;
    await synced(alice);
    expect(await sent(alice, cid)).toEqual(["pending", "posted"]);
    for (let i = 0; i < 3; i++) {
      clock.now += 10_000;
      await synced(alice);
    }
    expect(seen.posts).toBe(5);
    expect((await sent(alice, cid))[0]).toBe("pending");
    // The relay kept it all along: Bob has both.
    await synced(bob);
    const bobs = (await bob.messaging.thread("preprod", cid)).messages.map((m) => m.text);
    expect(bobs).toContain("first");
    expect(bobs).toContain("second");
  });

  it("D: a size's long wait (a 429 of 37 hours) outlives the worker: a restarted worker posts nothing of that size before it", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    // Every short message is 2 KiB (O1 b).
    relay.refusingSizes = { 2048: 37 * 3600 };
    await synced(alice);
    relay.calls.length = 0;
    await alice.messaging.send("preprod", cid, "waits 37 hours");
    await alice.messaging.whenIdle();
    clock.now += 10_000;
    await synced(alice);
    const before = relay.calls.filter((c) => c.startsWith("POST ")).length;
    alice.restart();
    clock.now += 10_000;
    await synced(alice);
    const after = relay.calls.filter((c) => c.startsWith("POST ")).length - before;
    expect(before).toBe(1);
    expect(after).toBe(0);
    // The thread says when, on the device's clock, from the copy.
    expect((await alice.messaging.thread("preprod", cid)).messages.at(-1)!.sent).toBe("pending");
    await expectNoConversationInSession(alice);
    // A device clock set back past the longest wait there is: the copy holds no more, after a restart.
    alice.skew = -40 * 3600_000;
    alice.restart();
    relay.refusingSizes = undefined;
    clock.now += 10_000;
    await synced(alice);
    expect((await alice.messaging.thread("preprod", cid)).messages.at(-1)!.sent).toBe("posted");
  });

  it("a page's 0 taken as a literal free price: one post with nonce 0, kept at once, no 402", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    relay.price = 0;
    await synced(alice);
    relay.calls.length = 0;
    const finds = { n: 0 };
    alice.restart(counting(finds));
    await synced(alice);
    await alice.messaging.send("preprod", cid, "free");
    await alice.messaging.whenIdle();
    expect(relay.calls.filter((c) => c.startsWith("POST "))).toHaveLength(1);
    expect(finds.n).toBe(0);
    expect((await alice.messaging.thread("preprod", cid)).messages.at(-1)!.sent).toBe("posted");
  });

  it("a fresh post's expires in milliseconds: the message's expiry is still the device's, the clock said off by ages", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    const real = relay.fetch;
    relay.fetch = async (url, init) => {
      const answer = await real(url, init);
      if (init.method !== "POST") return answer;
      const read = (await answer.json()) as { kept: string; expires: number };
      return json(200, { ...read, expires: read.expires * 1000 });
    };
    await alice.messaging.send("preprod", cid, "milliseconds");
    await alice.messaging.whenIdle();
    const last = (await alice.messaging.thread("preprod", cid)).messages.at(-1)!;
    const overview = await alice.messaging.overview("preprod");
    expect(last.expires).toBe(clock.now + RELAY_HOLD_MS);
    expect(overview.clockOff!).toBeLessThan(-1e6);
  });

  it("a post whose answer was lost, re-posted by a restarted worker: its work is searched for again, and both go", async () => {
    const { relay, alice, cid, first } = await twoWaiting();
    const real = relay.fetch;
    let lost = true;
    relay.fetch = async (url, init) => {
      if (init.method === "POST" && lost && envelopeOf(init) === first) {
        // Kept, and the answer lost on the way.
        await real(url, init);
        lost = false;
        throw new TypeError("Failed to fetch");
      }
      return real(url, init);
    };
    await synced(alice);
    expect(await sent(alice, cid)).toEqual(["pending", "pending"]);
    const finds = { n: 0 };
    alice.restart(counting(finds));
    clock.now += 60_000;
    await synced(alice);
    expect(finds.n).toBeGreaterThan(0);
    expect(await sent(alice, cid)).toEqual(["posted", "posted"]);
  });
});
