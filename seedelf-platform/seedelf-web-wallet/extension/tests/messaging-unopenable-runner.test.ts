// An inbox that won't open never turns the runner for ever (1.10.0's second review, the worker's finding 4). A lane
// reads no inbox, so a fresh worker reads the pool once before anything finds the inbox won't open; where that read
// found one of the key's envelopes, the runner's first phase threw at the inbox on every pass and the runner went round
// again without end (thousands of unseals a second), never reaching the other network's take or the tidy-up. Now a
// network whose inbox is found unopenable is held: its first phase is skipped, what its lanes left stays in memory
// (bounded: no lane reads its pool again until the inbox opens or Messages are started again), and the runner goes on
// to the rest. Start Messages again drops what's held and the read's cursor with it, so the pool is read from its
// oldest and the same envelopes come again. What's held includes the posts still to mark (the review of the merged
// fixes): one whose bookkeeping met the inbox that won't open stays due, and is marked once the inbox opens.
import { describe, expect, it } from "vitest";

import { SESSION_EXPIRED_AT } from "../src/background/messaging";
import { rememberRegister } from "../src/background/minted-by";
import { PRIVATE_PREFIX } from "../src/background/private-store";
import { BOB_SEEDELF, pair, type Party, synced, talking, turns } from "./messaging-harness";

/** `p`'s runner and lanes done, or not within `ms` of real time: a runner that turns for ever never is. */
const idleWithin = (p: Party, ms: number) =>
  Promise.race([p.messaging.whenIdle().then(() => true), new Promise<boolean>((done) => setTimeout(() => done(false), ms))]);

const unseals = (p: Party, record: string) => p.trace.filter((s) => s === `get ${record}`).length;

describe("the runner, and an inbox that won't open (1.10.0's second review)", { timeout: 30_000 }, () => {
  it("ends, a read's envelopes still due, and Start Messages again brings them back", async () => {
    const { alice, bob } = await pair();
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "hello Bob");
    await alice.messaging.whenIdle();
    // Bob's inbox as another version left it: a record that won't open.
    await bob.store.set("messaging.preprod", { v: 99 });
    // A worker Chrome started again: nothing in memory says so yet. The alarm's read comes before any page's overview.
    bob.restart();
    bob.trace.length = 0;
    try {
      await bob.messaging.sync("preprod");
      expect(await idleWithin(bob, 3000)).toBe(true);
      // The inbox was tried, found, and left alone.
      expect(unseals(bob, "messaging.preprod")).toBeLessThanOrEqual(2);
      await expect(bob.messaging.overview("preprod")).rejects.toThrow();
      // Nothing more is read while it won't open, and nothing is tried again.
      const before = bob.trace.length;
      await bob.messaging.sync("preprod");
      expect(await idleWithin(bob, 3000)).toBe(true);
      expect(bob.trace.slice(before).filter((s) => s.startsWith("GET") || s === "get messaging.preprod")).toEqual([]);

      // Start Messages again: what was held goes, with the read's cursor, so the pool is read from its oldest.
      await bob.messaging.clear("preprod");
      await bob.messaging.sync("preprod");
      expect(await idleWithin(bob, 3000)).toBe(true);
      expect((await bob.messaging.overview("preprod")).requests.map((r) => r.cid)).toEqual([cid]);
    } finally {
      // A runner still turning stops at a lock: the test's own bound, whatever it found.
      await bob.wallet.lock();
      await turns();
    }
  });

  it("still takes the other network's envelopes and runs its tidy-up", async () => {
    const { alice, bob, directory } = await pair();
    // Bob's Seedelf takes first messages on mainnet too, and both wallets have its Messages on.
    await rememberRegister(bob.store, "mainnet", BOB_SEEDELF, directory.get(BOB_SEEDELF)!);
    await alice.messaging.switch("mainnet", true);
    await bob.messaging.switch("mainnet", true);
    await alice.messaging.whenIdle();
    await bob.messaging.whenIdle();
    await alice.messaging.start("preprod", BOB_SEEDELF, "on preprod");
    const there = await alice.messaging.start("mainnet", BOB_SEEDELF, "on mainnet");
    await alice.messaging.whenIdle();
    await bob.store.set("messaging.preprod", { v: 99 });
    bob.restart();
    bob.trace.length = 0;
    // Expiry is due again on both networks, as at an unlock.
    await bob.session.remove(SESSION_EXPIRED_AT);
    try {
      // The alarm's run: both pools read, preprod's first.
      await bob.messaging.syncAll(["preprod", "mainnet"]);
      expect(await idleWithin(bob, 3000)).toBe(true);
      // Mainnet's first message was taken, a request, and its inbox written: its take ran.
      expect((await bob.messaging.overview("mainnet")).requests.map((r) => r.cid)).toEqual([there]);
      expect(bob.trace).toContain("set messaging.mainnet");
      // And its tidy-up, to its last step: expiry notes when it ran, by network.
      expect(Object.keys((await bob.session.get<Record<string, number>>(SESSION_EXPIRED_AT)) ?? {})).toEqual(["mainnet"]);
      expect(unseals(bob, "messaging.preprod")).toBeLessThanOrEqual(2);
    } finally {
      await bob.wallet.lock();
      await turns();
    }
  });

  it("keeps a post's bookkeeping while the inbox won't open, and marks it once it opens: never lost, never posted twice", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await synced(bob);
    const key = `${PRIVATE_PREFIX}messaging.preprod`;
    // The inbox stops opening between a post's answer and its bookkeeping: here, as the relay answers Alice's post.
    let good: string | undefined;
    const answer = relay.fetch.bind(relay);
    relay.fetch = async (url, init) => {
      const answered = await answer(url, init);
      if (init.method === "POST" && good === undefined) {
        good = alice.local.data.get(key) as string;
        await alice.store.set("messaging.preprod", { v: 99 });
      }
      return answered;
    };
    try {
      await alice.messaging.send("preprod", cid, "posted, not marked yet");
      expect(await idleWithin(alice, 3000)).toBe(true);
      relay.fetch = answer;
      expect(good).toBeDefined();
      await expect(alice.messaging.thread("preprod", cid)).rejects.toThrow();
      // The inbox opens again, as it was, and the thread's read finds so: its message still says it's being sent.
      alice.local.data.set(key, good!);
      expect((await alice.messaging.thread("preprod", cid)).messages.at(-1)?.sent).toBe("pending");
      // The next lane's first phase marks the post it kept: from memory, with no second post.
      alice.trace.length = 0;
      await alice.messaging.sync("preprod");
      expect(await idleWithin(alice, 3000)).toBe(true);
      expect((await alice.messaging.thread("preprod", cid)).messages.at(-1)?.sent).toBe("posted");
      expect(alice.trace.filter((s) => s.startsWith("POST"))).toEqual([]);
    } finally {
      relay.fetch = answer;
      await alice.wallet.lock();
      await turns();
    }
  });
});
