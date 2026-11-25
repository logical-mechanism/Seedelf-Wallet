// What Messages writes belongs to the unlock it was asked under (1.10.0's second review, round 7). A press reads the
// inbox, changes it and writes it back; every one of its calls into the wallet's queue waits at the gate while a run
// of requests to the relay goes on, which a slow server can stretch to minutes. The wallet locked, removed and another
// phrase restored inside that wait, the write went on under the second wallet's key, into its storage: its Messages
// then listed the first wallet's conversations, who it wrote to and each one's last message, after a Remove wallet
// that says the data is gone.
//
// So the worker holds the wallet's count of its opens (an unlock, a create, a restore) from the moment a call is
// asked, and looks at it again after every wait at the gate and inside the very turn of the wallet's queue that reads
// or writes: another count, and the call is refused as a locked wallet refuses, nothing read or written for it. A lock
// and an unlock of the same phrase in between refuse it too: the press belonged to an unlock that ended, and is made
// again. With nothing in between, a write that waited at the gate lands as it always did.
import { describe, expect, it, vi } from "vitest";

import { SESSION_POSTS } from "../src/background/messaging";
import { phrasePin, type PhrasePin, WalletLocked } from "../src/background/wallet";
import { pair, PASSWORD, phrase, synced, talking } from "./messaging-harness";

const NAME = "named under the first unlock";

/** Alice and Bob talking; the relay then answers slowly: each request waits for `release`, and fails as an unreachable one. */
async function slowly() {
  const world = await pair();
  const cid = await talking(world.alice, world.bob);
  await synced(world.bob);
  await world.alice.messaging.whenIdle();
  const real = world.relay.fetch;
  const held = { asked: 0, release: () => undefined as void };
  const wait = new Promise<void>((resolve) => (held.release = resolve));
  world.relay.fetch = async () => {
    held.asked++;
    await wait;
    throw new TypeError("Failed to fetch");
  };
  /** A run of requests under way, the server not answering: everything else of Messages waits at the gate. */
  const lane = async () => {
    const run = world.alice.messaging.sync("preprod").catch(() => undefined);
    await vi.waitFor(() => expect(held.asked).toBeGreaterThan(0), { timeout: 5000 });
    // In an object: an async function that returned the run itself would wait for it.
    return { run };
  };
  /** The server answers as ever again. */
  const fast = () => void (world.relay.fetch = real);
  return { ...world, cid, held, lane, fast };
}

type World = Awaited<ReturnType<typeof slowly>>;

/** A rename whose inbox write is on its way as a run of requests starts: the write waits at the gate. What `then` does comes before the run ends. */
async function renameWaiting(world: World, then: () => Promise<void>) {
  const { alice, cid, held, lane } = world;
  let run: Promise<void> | undefined;
  let began = false;
  alice.beforeWrite = async (name) => {
    if (name !== "messaging.preprod" || began) return;
    began = true;
    ({ run } = await lane());
  };
  const press = alice.messaging.rename("preprod", cid, NAME).then(
    () => "renamed" as const,
    (e: unknown) => e,
  );
  await vi.waitFor(() => expect(run).toBeDefined(), { timeout: 5000 });
  alice.beforeWrite = undefined;
  await then();
  await new Promise((resolve) => setTimeout(resolve, 50));
  held.release();
  const answer = await press;
  await run;
  await alice.messaging.whenIdle();
  return answer;
}

const stored = (world: World) => world.alice.local.keys("seedelf.private.");
const nameOf = async (world: World) =>
  (await world.alice.store.get<{ conversations: Record<string, { name?: string }> }>("messaging.preprod"))?.conversations[world.cid]?.name;

describe("a write belongs to the unlock it was asked under (1.10.0's second review)", { timeout: 60_000 }, () => {
  it("a press's write waiting at the gate; the wallet locked, removed and another phrase restored: refused, and the second wallet holds nothing of the first's", async () => {
    const world = await slowly();
    const { alice, cid } = world;
    const answer = await renameWaiting(world, async () => {
      await alice.wallet.lock();
      await alice.wallet.reset();
      expect(await stored(world)).toEqual([]);
      await alice.wallet.create(phrase(15), PASSWORD);
    });
    expect(answer).toBeInstanceOf(WalletLocked);
    // Nothing of the first wallet's was sealed under the second's key.
    expect(await stored(world)).toEqual([]);
    // The second wallet turns Messages on: its inbox lists none of the first's conversations.
    world.fast();
    await alice.messaging.switch("preprod", true);
    await alice.messaging.whenIdle();
    await synced(alice);
    const overview = await alice.messaging.overview("preprod");
    expect([overview.conversations, overview.requests]).toEqual([[], []]);
    expect(JSON.stringify(await alice.store.get("messaging.preprod") ?? {})).not.toContain(cid);
    expect(JSON.stringify(await alice.store.get("messaging.preprod") ?? {})).not.toContain(NAME);
  });

  it("a press asked under the first wallet and still waiting to begin when the second is restored: refused before it reads anything", async () => {
    const world = await slowly();
    const { alice, cid, held, lane } = world;
    const { run } = await lane();
    alice.trace.length = 0;
    const inboxReads = () => alice.area.filter((read) => read.name === "messaging.preprod").length;
    const reads = inboxReads();
    const press = alice.messaging.rename("preprod", cid, NAME).then(
      () => "renamed" as const,
      (e: unknown) => e,
    );
    await alice.wallet.lock();
    await alice.wallet.reset();
    await alice.wallet.create(phrase(15), PASSWORD);
    await new Promise((resolve) => setTimeout(resolve, 50));
    held.release();
    expect(await press).toBeInstanceOf(WalletLocked);
    await run;
    await alice.messaging.whenIdle();
    // No record was unsealed or sealed for it, and the inbox wasn't so much as read from the area: the look comes
    // after the gate, before anything is made ready for the call.
    expect(alice.trace.filter((s) => /^(get|set|remove) /.test(s))).toEqual([]);
    expect(inboxReads()).toBe(reads);
    expect(await stored(world)).toEqual([]);
  });

  it("the same with only a lock and an unlock of the same phrase in between: refused, nothing written, and made again it lands", async () => {
    const world = await slowly();
    const { alice, cid } = world;
    const before = alice.local.data.get("seedelf.private.messaging.preprod");
    const answer = await renameWaiting(world, async () => {
      await alice.wallet.lock();
      await alice.wallet.unlock(PASSWORD);
    });
    // The press belonged to an unlock that ended.
    expect(answer).toBeInstanceOf(WalletLocked);
    expect(alice.local.data.get("seedelf.private.messaging.preprod")).toBe(before);
    expect(await nameOf(world)).toBeUndefined();
    // Made again under the unlock there now, it's written.
    world.fast();
    await alice.messaging.rename("preprod", cid, NAME);
    expect(await nameOf(world)).toBe(NAME);
    expect((await alice.messaging.overview("preprod")).conversations.map((c) => c.name)).toEqual([NAME]);
  });

  it("asked before a lock and an unlock already waiting in the wallet's queue: refused in its own turn there, nothing read", async () => {
    // The gate is open and the count hasn't moved as the press is asked and passes it: only the look inside the
    // press's own turn of the wallet's queue, behind the lock and the unlock, finds the unlock it was asked under gone.
    const world = await slowly();
    const { alice, cid } = world;
    let free!: () => void;
    const busy = alice.wallet.withKeys(() => new Promise<void>((resolve) => (free = resolve)));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const lock = alice.wallet.lock();
    const unlock = alice.wallet.unlock(PASSWORD);
    alice.trace.length = 0;
    const press = alice.messaging.rename("preprod", cid, NAME).then(
      () => "renamed" as const,
      (e: unknown) => e,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    free();
    await Promise.all([busy, lock, unlock]);
    expect(await press).toBeInstanceOf(WalletLocked);
    await alice.messaging.whenIdle();
    expect(alice.trace.filter((s) => /^(get|set|remove) /.test(s))).toEqual([]);
    expect(await nameOf(world)).toBeUndefined();
  });

  for (const then of ["the same phrase unlocked again", "another phrase restored"] as const) {
    it(`whose keys are there now is asked of the wallet as it is: after a lock, ${then} ${then.startsWith("the same") ? "isn't" : "is"} another phrase's`, async () => {
      // The runner drops what it read for a phrase that's gone (`anotherPhrase`). A lock and an unlock of the same phrase
      // while that question waited would refuse it as a call of the unlock that ended, and the wallet being unlocked,
      // that would read as another phrase's: its own envelopes dropped unread. So the question is of now.
      const world = await slowly();
      const { alice } = world;
      const pin = phrasePin();
      await alice.wallet.withKeys((keys) => pin(keys));
      let free!: () => void;
      const busy = alice.wallet.withKeys(() => new Promise<void>((resolve) => (free = resolve)));
      await new Promise((resolve) => setTimeout(resolve, 20));
      const after = [alice.wallet.lock(), ...(then.startsWith("the same") ? [alice.wallet.unlock(PASSWORD)] : [alice.wallet.reset(), alice.wallet.create(phrase(15), PASSWORD)])];
      const asked = (alice.messaging as unknown as { anotherPhrase(pin: PhrasePin): Promise<boolean> }).anotherPhrase(pin);
      await new Promise((resolve) => setTimeout(resolve, 50));
      free();
      await Promise.all([busy, ...after]);
      expect(await asked).toBe(!then.startsWith("the same"));
    });
  }

  it("Start Messages again, asked of the first wallet and waiting at the gate, never deletes the second wallet's", async () => {
    const world = await slowly();
    const { alice, held, lane } = world;
    const { run } = await lane();
    const press = alice.messaging.clear("preprod").then(
      () => "cleared" as const,
      (e: unknown) => e,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    await alice.wallet.lock();
    await alice.wallet.reset();
    await alice.wallet.create(phrase(15), PASSWORD);
    // The second wallet's own inbox, as its Messages would have written it.
    await alice.store.set("messaging.preprod", { v: 2, handles: {}, conversations: {}, requestsUnread: {}, requestsShown: {}, dropped: 7 });
    const mine = alice.local.data.get("seedelf.private.messaging.preprod");
    held.release();
    expect(await press).toBeInstanceOf(WalletLocked);
    await run;
    await alice.messaging.whenIdle();
    expect(alice.local.data.get("seedelf.private.messaging.preprod")).toBe(mine);
  });

  it("a posting run that outlives its unlock leaves the session's copy of the runs alone", async () => {
    const world = await slowly();
    const { relay, alice, cid } = world;
    // A message waits to be posted, the server unreachable as it's written.
    world.fast();
    const real = relay.fetch;
    relay.up = false;
    await alice.messaging.send("preprod", cid, "still waiting");
    await alice.messaging.whenIdle();
    relay.up = true;
    // Then the server takes the post's request and doesn't answer; the wallet locks; and the request fails.
    let posts = 0;
    let fail!: () => void;
    const taken = new Promise<void>((resolve) => (fail = resolve));
    relay.fetch = async (url, init) => {
      if (init.method !== "POST") return real(url, init);
      posts++;
      await taken;
      throw new TypeError("Failed to fetch");
    };
    const run = alice.messaging.sync("preprod").catch(() => undefined);
    await vi.waitFor(() => expect(posts).toBe(1), { timeout: 5000 });
    await alice.wallet.lock();
    expect(alice.session.data.get(SESSION_POSTS)).toBeUndefined();
    fail();
    await run;
    await alice.messaging.whenIdle();
    // The lock cleared the session; the run's end, after it, wrote nothing back into it.
    expect(alice.session.data.get(SESSION_POSTS)).toBeUndefined();
  });

  it("control: with no lock in between, a write that waited at the gate lands", async () => {
    const world = await slowly();
    const answer = await renameWaiting(world, async () => undefined);
    expect(answer).toBe("renamed");
    expect(await nameOf(world)).toBe(NAME);
  });

  it("control: a lock alone refuses as it always did, and the unlock's own presses and takes go on", async () => {
    const world = await slowly();
    const { alice, bob, cid } = world;
    const answer = await renameWaiting(world, async () => {
      await alice.wallet.lock();
    });
    expect(answer).toBeInstanceOf(WalletLocked);
    world.fast();
    await alice.wallet.unlock(PASSWORD);
    expect(await nameOf(world)).toBeUndefined();
    // What the new unlock asks is its own: a message taken, a reply sent, a name given.
    await bob.messaging.send("preprod", cid, "after the unlock");
    await bob.messaging.whenIdle();
    await synced(alice);
    expect((await alice.messaging.thread("preprod", cid)).messages.at(-1)?.text).toBe("after the unlock");
    await alice.messaging.send("preprod", cid, "and back");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect((await bob.messaging.thread("preprod", cid)).messages.at(-1)?.text).toBe("and back");
    await alice.messaging.rename("preprod", cid, NAME);
    expect(await nameOf(world)).toBe(NAME);
  });
});
