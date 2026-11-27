// Seedelf Messaging in the worker (chunk 54's 54e): two wallets writing to
// each other through an in-memory relay (fake-relay.ts), with the records
// alone between their calls, as a restarted worker has them. What the wallet
// sends and when (the 1.10.0 gate's W1 to W6) is in tests/messaging-*.test.ts,
// the verified reveal in messaging-reveal.test.ts.
import { describe, expect, it } from "vitest";

import { lastOf, MessagingFull, MessagingService, PREVIEW_CHARS, storedBytes, textOf, plaintextOf } from "../src/background/messaging";
import { rememberRegister } from "../src/background/minted-by";
import { PreferencesService } from "../src/background/preferences";
import { conversationRecord, PRIVATE_PREFIX, PrivateStore } from "../src/background/private-store";
import type { RegisterHex } from "../src/background/chain";
import type { NetworkName } from "../src/networks";
import type { MessagingEntry } from "../src/shared/rpc";
import { fakeRelay, type FakeRelay } from "./fake-relay";
import { loadTestWasm, memoryArea, testWallet, vectors, type MemoryArea } from "./fakes";
import { BOTH_OPEN, cursorOf } from "./messaging-harness";

const PASSWORD = "correct horse battery";
const phrase = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!.phrase as string;

/** A Seedelf's asset name: the prefix, then a tag. */
const BOB_SEEDELF = "5eed0e1f00" + "626f62";
const ALICE_SEEDELF = "5eed0e1f00" + "616c696365";

/** Where Send's pay-by-name would look a Seedelf's register up: the chain, for both wallets. */
type Directory = Map<string, RegisterHex>;

interface Party {
  messaging: MessagingService;
  wallet: ReturnType<typeof testWallet>["wallet"];
  local: MemoryArea;
  session: MemoryArea;
  store: PrivateStore;
  preferences: PreferencesService;
  /** What `ownSeedelfs` answers: the Seedelfs the wallet's contract view holds now. */
  own: Array<{ name: string; register: RegisterHex }>;
  /** Whether the wallet keeps a view of the contract: without one, only a read (`ownSeedelfs(n, true)`) finds them. */
  keptView: boolean;
  /** The kept view's Seedelfs, when it's older than the chain (`own`): a read finds the rest. */
  kept?: Array<{ name: string; register: RegisterHex }>;
  /** What a read of the contract does instead of answering: throw. */
  readFails?: unknown;
  /** What any look at the wallet's Seedelfs does instead of answering, kept view or read: throw. */
  ownFails?: unknown;
  /** What a read of the contract for reveals does instead of answering: throw. */
  revealFails?: unknown;
  /** How many times the contract was read for reveals. */
  revealReads: number;
  /** Runs at each turn of the event loop the service takes (between scan batches, between a stamp's slices). */
  onWait?: () => Promise<void>;
  /** The messaging alarm, as sw.ts gives it. */
  alarm: { on: boolean; start(): Promise<void>; stop(): Promise<void> };
  changed: NetworkName[];
  /** A new service over the same storage: a restarted worker's, on `wasm` if given. */
  restart(wasm?: Wasm): MessagingService;
}

type Wasm = ReturnType<typeof loadTestWasm>;

const clock = { now: 1_800_000_000_000 };

function service(p: Omit<Party, "messaging" | "restart">, relay: FakeRelay, directory: Directory, budgetBytes?: number, wasm?: Wasm) {
  return new MessagingService({
    wasm: wasm ?? loadTestWasm(),
    wallet: p.wallet,
    store: p.store,
    local: p.local,
    preferences: p.preferences,
    relay: (n) => relay.client(n),
    ownSeedelfs: async (_n, read) => {
      if (p.ownFails) throw p.ownFails;
      if (read && p.readFails) throw p.readFails;
      return read ? p.own : p.keptView ? (p.kept ?? p.own) : undefined;
    },
    alarm: p.alarm,
    seedelfRegister: async (_n, name) => {
      const register = directory.get(name);
      if (!register) throw new Error("no such Seedelf");
      return register;
    },
    revealedRegisters: async () => {
      p.revealReads++;
      if (p.revealFails) throw p.revealFails;
      // The chain as it is now: what the read finds.
      const now = new Map(directory);
      return (name) => now.get(name);
    },
    now: () => clock.now,
    // The waits kept in memory run on the monotonic clock (the 1.10.0 gate's W14): here it moves with the test's.
    monotonic: () => clock.now,
    wait: async () => {
      await p.onWait?.();
    },
    changed: (n) => void p.changed.push(n),
    // Cheap first-contact stamps for tests; the worker never sets it.
    firstContactBits: 6,
    ...(budgetBytes !== undefined ? { budgetBytes } : {}),
  });
}

async function party(words: number, relay: FakeRelay, directory: Directory, seedelf?: string, budgetBytes?: number): Promise<Party> {
  const t = testWallet({ local: memoryArea(), session: memoryArea(), clock });
  await t.wallet.create(phrase(words), PASSWORD);
  const store = new PrivateStore({ wallet: t.wallet, local: t.local });
  const preferences = new PreferencesService(t.local, BOTH_OPEN);
  const base: Omit<Party, "messaging" | "restart"> = {
    wallet: t.wallet,
    local: t.local,
    session: t.session,
    store,
    preferences,
    own: [],
    keptView: true,
    revealReads: 0,
    changed: [],
    alarm: {
      on: false,
      async start() {
        this.on = true;
      },
      async stop() {
        this.on = false;
      },
    },
  };
  if (seedelf) {
    const wasm = loadTestWasm();
    const register = await t.wallet.withKeys((keys) => {
      const b = keys.seedelf.baseRegister();
      const r = wasm.rerandomize(b);
      b.free();
      try {
        return { generator: r.generator, publicValue: r.publicValue };
      } finally {
        r.free();
      }
    });
    base.own.push({ name: seedelf, register });
    directory.set(seedelf, register);
    // Minted in this browser, under that register: it takes first messages by itself (the 1.10.0 gate's W8).
    await rememberRegister(store, "preprod", seedelf, register);
  }
  // One object: what a test changes on the party (its Seedelfs, its kept view) is what its service reads.
  const p = base as Party;
  p.messaging = service(p, relay, directory, budgetBytes);
  p.restart = (wasm) => (p.messaging = service(p, relay, directory, budgetBytes, wasm));
  return p;
}

/** Two wallets, Messages on for preprod, Bob holding a Seedelf. */
async function pair(budgetBytes?: number) {
  const relay = fakeRelay(clock);
  const directory: Directory = new Map();
  const alice = await party(12, relay, directory, ALICE_SEEDELF, budgetBytes);
  const bob = await party(24, relay, directory, BOB_SEEDELF, budgetBytes);
  await alice.messaging.switch("preprod", true);
  await bob.messaging.switch("preprod", true);
  await alice.messaging.whenIdle();
  await bob.messaging.whenIdle();
  relay.calls.length = 0;
  return { relay, directory, alice, bob };
}

/** Syncs `p` and waits for everything it started. */
async function synced(p: Party, network: NetworkName = "preprod") {
  await p.messaging.sync(network);
  await p.messaging.whenIdle();
}

/** Alice writes first to Bob's Seedelf; Bob accepts and replies. Returns the conversation's ID. */
async function talking(alice: Party, bob: Party): Promise<string> {
  const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "hello Bob");
  await alice.messaging.whenIdle();
  await synced(bob);
  await bob.messaging.accept("preprod", cid);
  await bob.messaging.send("preprod", cid, "hi Alice");
  await bob.messaging.whenIdle();
  await synced(alice);
  return cid;
}

/** Moves the clock on by `ms` with each wallet's user busy all along, so none locks itself. */
async function busyFor(ms: number, ...parties: Party[]) {
  for (let left = ms; left > 0; left -= 10 * 60_000) {
    clock.now += Math.min(left, 10 * 60_000);
    for (const p of parties) await p.wallet.touch();
  }
}

const texts = async (p: Party, cid: string) => (await p.messaging.thread("preprod", cid)).messages.map((m) => `${m.dir}:${m.text}`);

/** A conversation's record's name, by the ID `p`'s inbox gives it (W7): no name holds the conversation's own. */
async function recordOf(p: Party, cid: string): Promise<ReturnType<typeof conversationRecord>> {
  const inbox = await p.store.get<{ conversations: Record<string, { id: string }> }>("messaging.preprod");
  return conversationRecord("preprod", inbox!.conversations[cid]!.id);
}

// Each test bounded: one that fails mid-take fails here, never hangs the run.
describe("Seedelf Messaging in the worker", { timeout: 30_000 }, () => {
  it("reads nothing and posts nothing while a network's switch is off (call 9)", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await alice.messaging.switch("preprod", false);
    await alice.messaging.whenIdle();
    relay.calls.length = 0;
    await alice.messaging.syncAll(["preprod", "mainnet"]);
    // Written while off: kept, sealed, never posted. A first message isn't written at all (the review's second round,
    // finding 6): nothing is read for it, the list included.
    await alice.messaging.send("preprod", cid, "not yet");
    await expect(alice.messaging.start("preprod", BOB_SEEDELF, "a first message")).rejects.toThrow(/Turn Messages on/);
    await alice.messaging.whenIdle();
    expect(relay.calls).toEqual([]);
    expect((await alice.messaging.overview("preprod")).conversations.find((c) => c.cid === cid)!.outbox).toBe(1);
    // On: the next sync posts what was waiting.
    await alice.messaging.switch("preprod", true);
    await alice.messaging.whenIdle();
    expect(relay.calls.some((c) => c.startsWith("POST /messaging/v1/preprod/"))).toBe(true);
    expect((await alice.messaging.overview("preprod")).conversations.find((c) => c.cid === cid)!.outbox).toBe(0);
  });

  it("keeps each network apart: preprod's switch never reads mainnet's pool", async () => {
    const { relay, alice } = await pair();
    await alice.messaging.syncAll(["preprod", "mainnet"]);
    await alice.messaging.whenIdle();
    expect(relay.calls.length).toBeGreaterThan(0);
    expect(relay.calls.every((c) => c.includes("/messaging/v1/preprod/"))).toBe(true);
  });

  it("starts a conversation to a Seedelf, which arrives as a request, and goes on once accepted", async () => {
    const { alice, bob } = await pair();
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "hello Bob");
    // Queued until the first-contact stamp is set, then posted.
    await alice.messaging.whenIdle();
    const sent = (await alice.messaging.thread("preprod", cid)).messages[0]!;
    expect(sent).toMatchObject({ dir: "out", text: "hello Bob", sent: "posted" });
    expect(sent.expires).toBe(clock.now + 36 * 3600_000 - (clock.now % 1000));

    await synced(bob);
    const overview = await bob.messaging.overview("preprod");
    expect(overview.conversations).toEqual([]);
    expect(overview.requests).toMatchObject([{ cid, to: BOB_SEEDELF, messages: 1, unread: 1 }]);
    expect((await bob.messaging.request("preprod", cid)).map((m) => m.text)).toEqual(["hello Bob"]);
    expect((await bob.messaging.overview("preprod")).requests[0]!.unread).toBe(0);

    await bob.messaging.accept("preprod", cid);
    expect((await bob.messaging.overview("preprod")).requests).toEqual([]);
    await bob.messaging.send("preprod", cid, "hi Alice");
    await bob.messaging.whenIdle();
    await synced(alice);
    expect(await texts(alice, cid)).toEqual(["out:hello Bob", "in:hi Alice"]);
    expect((await alice.messaging.overview("preprod")).conversations[0]).toMatchObject({ cid, role: "initiator", handle: BOB_SEEDELF, unread: 0 });

    await alice.messaging.send("preprod", cid, "how are you?");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect(await texts(bob, cid)).toEqual(["in:hello Bob", "out:hi Alice", "in:how are you?"]);
    expect((await bob.messaging.overview("preprod")).conversations[0]).toMatchObject({ cid, role: "responder", to: BOB_SEEDELF });
  });

  it("queues every text written before the stamp is set, and seals them in order", async () => {
    const { alice, bob } = await pair();
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "one");
    await alice.messaging.send("preprod", cid, "two");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect((await bob.messaging.request("preprod", cid)).map((m) => m.text)).toEqual(["one", "two"]);
  });

  it("takes an envelope read twice once: a page read again after a stop is harmless (§4.2)", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await alice.messaging.send("preprod", cid, "once");
    await alice.messaging.whenIdle();
    await synced(bob);
    // A worker stopped before the cursor moved: the same pages read again, from the start. The cursor is the read
    // record's (round 5).
    const read = await bob.store.get<{ cursor?: string }>("messagingRead.preprod");
    expect(read?.cursor).toBeDefined();
    await bob.store.set("messagingRead.preprod", { ...read, cursor: undefined });
    bob.restart();
    await synced(bob);
    expect(await texts(bob, cid)).toEqual(["in:hello Bob", "out:hi Alice", "in:once"]);
  });

  it("posts a pending envelope again after a stop, the same bytes, once (§4.2)", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    // The relay keeps the post, and the answer is lost: the message stays pending.
    const real = relay.fetch;
    relay.fetch = async (url, init) => {
      const answer = await real(url, init);
      if (init.method === "POST") throw new TypeError("Failed to fetch");
      return answer;
    };
    await alice.messaging.send("preprod", cid, "lost answer");
    await alice.messaging.whenIdle();
    expect((await alice.messaging.thread("preprod", cid)).messages.at(-1)!.sent).toBe("pending");
    relay.fetch = real;
    const held = relay.pools.get("preprod")!.held.length;
    alice.restart();
    await synced(alice);
    expect((await alice.messaging.thread("preprod", cid)).messages.at(-1)!.sent).toBe("posted");
    // Already held: nothing new in the pool, and Bob reads it once.
    expect(relay.pools.get("preprod")!.held.length).toBe(held);
    await synced(bob);
    expect((await texts(bob, cid)).filter((m) => m === "in:lost answer")).toHaveLength(1);
  });

  it("loses nothing when the wallet locks mid-take: the cursor moves only once everything read is taken", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await alice.messaging.send("preprod", cid, "first");
    await alice.messaging.send("preprod", cid, "second");
    await alice.messaging.whenIdle();
    // Bob locks as the read's first new envelope is taken, before its record is written.
    let taken = 0;
    const wasm = loadTestWasm();
    bob.restart({
      ...wasm,
      messagingReceive: (key, request) => {
        const answer = wasm.messagingReceive(key, request);
        if (++taken === 1) void bob.wallet.lock();
        return answer;
      },
    });
    // The sync is the read and the posts; the take that the lock stops is in the background, nothing waiting on it.
    await bob.messaging.sync("preprod");
    await bob.messaging.whenIdle();
    expect(taken).toBe(1);
    await bob.wallet.unlock(PASSWORD);
    bob.restart();
    await synced(bob);
    expect(await texts(bob, cid)).toEqual(["in:hello Bob", "out:hi Alice", "in:first", "in:second"]);
  });

  it("solves again at the price a 402 names, and waits out a 429", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    // The page said 4 bits; the relay now asks 9.
    relay.price = 9;
    await alice.messaging.send("preprod", cid, "dearer");
    await alice.messaging.whenIdle();
    expect((await alice.messaging.thread("preprod", cid)).messages.at(-1)!.sent).toBe("posted");

    relay.waitOnce = 429;
    await alice.messaging.send("preprod", cid, "later");
    await alice.messaging.whenIdle();
    expect((await alice.messaging.thread("preprod", cid)).messages.at(-1)!.sent).toBe("pending");
    // Nothing posted again until its Retry-After has passed.
    await synced(alice);
    expect((await alice.messaging.thread("preprod", cid)).messages.at(-1)!.sent).toBe("pending");
    clock.now += 31_000;
    await synced(alice);
    expect((await alice.messaging.thread("preprod", cid)).messages.at(-1)!.sent).toBe("posted");
  });

  it("asks with no work where the page prices a size at 0, and the thread counts down to the relay's own retry-after", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    let solved = 0;
    const wasm = loadTestWasm();
    alice.restart({
      ...wasm,
      messagingFindStamp: (request) => {
        solved++;
        return wasm.messagingFindStamp(request);
      },
    });
    relay.refusing = 90;
    await synced(alice);
    relay.calls.length = 0;
    await alice.messaging.send("preprod", cid, "later");
    await alice.messaging.whenIdle();
    // One post, with no work solved: the 429 says how long, not a guess.
    expect(solved).toBe(0);
    expect(relay.calls.filter((c) => c.startsWith("POST"))).toHaveLength(1);
    let thread = await alice.messaging.thread("preprod", cid);
    expect(thread.messages.at(-1)!.sent).toBe("pending");
    expect(thread.nextTry).toBe(clock.now + 90_000);
    // Nothing asked again before then.
    await synced(alice);
    expect(relay.calls.filter((c) => c.startsWith("POST"))).toHaveLength(1);
    // Then the relay takes it at the price it names (402), solved now. Named whatever nonce 0 shows: the post goes at
    // the page's price of 0, and nonce 0 meets the fake relay's 4 bits one time in 16.
    relay.refusing = undefined;
    clock.now += 90_000;
    const real = relay.fetch;
    let priced = false;
    relay.fetch = async (url, init) => {
      if (init.method === "POST" && !priced) {
        priced = true;
        return new Response(JSON.stringify({ error: "more proof of work", price: 9 }), { status: 402 });
      }
      return real(url, init);
    };
    await alice.messaging.post("preprod");
    await alice.messaging.whenIdle();
    thread = await alice.messaging.thread("preprod", cid);
    expect(thread.messages.at(-1)!.sent).toBe("posted");
    expect(thread.nextTry).toBeUndefined();
    expect(solved).toBeGreaterThan(0);
  });

  it("says about how long a post's work and a first message's stamp take, on the messages waiting on them", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    // Each first slice comes back empty, so there's a turn of the event loop to read the thread in.
    const wasm = loadTestWasm();
    alice.restart({
      ...wasm,
      messagingFindStamp: (request) =>
        (JSON.parse(request) as { from: number }).from === 0 ? JSON.stringify({ nonce: null }) : wasm.messagingFindStamp(request),
    });
    relay.price = 9;
    await synced(alice);
    // A post's work is solved in its posting run, a lane, which no thread is read during (O8, round 5): what the thread
    // would say is the worker's work for that message, looked at from inside the run.
    const work = () => (alice.messaging as unknown as { work: Map<string, { entry?: number; bits: number }> }).work;
    const seen: Array<Array<{ entry?: number; bits: number }>> = [];
    alice.onWait = async () => {
      alice.onWait = undefined;
      seen.push([...work().values()]);
    };
    await alice.messaging.send("preprod", cid, "worked for");
    await alice.messaging.whenIdle();
    const [during] = seen;
    const last = (await alice.messaging.thread("preprod", cid)).messages.at(-1)!;
    expect(during).toEqual([{ entry: last.id, bits: 9 }]);
    expect((await alice.messaging.thread("preprod", cid)).messages.some((m) => m.working)).toBe(false);

    // A first message: every message waiting on its stamp says so.
    let first: MessagingEntry[] | undefined;
    let other = "";
    alice.onWait = async () => {
      // The stamp's first slice's: the runner after the press's list read takes turns of the event loop too.
      if (!other) return;
      alice.onWait = undefined;
      first = (await alice.messaging.thread("preprod", other)).messages;
    };
    other = await alice.messaging.start("preprod", BOB_SEEDELF, "again");
    await alice.messaging.whenIdle();
    expect(first?.[0]?.sent).toBe("queued");
    expect(first?.[0]?.working?.seconds).toBeGreaterThanOrEqual(1);
  });

  it("keeps a deleted request's ID as a tombstone: its first message read again starts nothing (§5)", async () => {
    const { alice, bob } = await pair();
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "hello");
    await alice.messaging.whenIdle();
    await synced(bob);
    await bob.messaging.remove("preprod", cid);
    const inbox = await bob.store.get<{ cursor?: string }>("messaging.preprod");
    await bob.store.set("messaging.preprod", { ...inbox, cursor: undefined });
    await synced(bob);
    expect((await bob.messaging.overview("preprod")).requests).toEqual([]);
  });

  it("deletes a conversation's record with it, and Remove wallet deletes them all", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    const record = await recordOf(bob, cid);
    expect(await bob.local.get(PRIVATE_PREFIX + record)).toBeDefined();
    await bob.messaging.remove("preprod", cid);
    expect(await bob.local.get(PRIVATE_PREFIX + record)).toBeUndefined();
    expect((await bob.messaging.overview("preprod")).conversations).toEqual([]);

    expect(await alice.local.keys(PRIVATE_PREFIX + "conversation.")).toHaveLength(1);
    await alice.wallet.reset();
    expect(await alice.local.keys(PRIVATE_PREFIX + "conversation.")).toEqual([]);
    expect(await alice.local.get(PRIVATE_PREFIX + "messaging.preprod")).toBeUndefined();
  });

  it("deletes a record nothing lists at the first sync: a stop between writing it and listing it", async () => {
    const { alice } = await pair();
    await alice.store.set(conversationRecord("preprod", "00".repeat(16)), { v: 1, state: "", history: [], next: 0, trimmed: 0 });
    alice.restart();
    await synced(alice);
    expect(await alice.local.keys(PRIVATE_PREFIX + "conversation.")).toEqual([]);
  });

  it("says when the relay lost envelopes, and nothing of a conversation this browser no longer has (W3)", async () => {
    const { relay, directory, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    // Alice's wallet restored in a new browser: the same key, none of the conversations.
    const again = await party(12, relay, directory);
    await again.messaging.switch("preprod", true);
    await again.messaging.whenIdle();
    await bob.messaging.send("preprod", cid, "are you there?");
    await bob.messaging.whenIdle();
    await synced(again);
    // Bob's two messages, both to the conversation it no longer has: dropped, as any envelope it can't place is.
    expect(await again.messaging.overview("preprod")).toEqual({ on: true, conversations: [], requests: [] });

    relay.gapOnce = true;
    await synced(bob);
    expect((await bob.messaging.overview("preprod")).gapAt).toBe(clock.now);
  });

  it("keeps a request that came at a Seedelf's register when its datum changes, and takes no first message there after (W8)", async () => {
    const { directory, alice, bob } = await pair();
    // Bob's sync has seen the register Alice writes to, and takes her first message there.
    await synced(bob);
    const old = directory.get(BOB_SEEDELF)!;
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "to your datum");
    await alice.messaging.whenIdle();
    await synced(bob);
    // Then the Seedelf's datum changed, and the view Bob's wallet keeps says so.
    const fresh = await bob.wallet.withKeys((keys) => {
      const wasm = loadTestWasm();
      const b = keys.seedelf.baseRegister();
      const r = wasm.rerandomize(b);
      b.free();
      try {
        return { generator: r.generator, publicValue: r.publicValue };
      } finally {
        r.free();
      }
    });
    bob.own.splice(0, 1, { name: BOB_SEEDELF, register: fresh });
    expect(fresh).not.toEqual(old);
    // Alice's lookup still has the old one: what she writes there now isn't taken, and what came before it stays.
    await alice.messaging.start("preprod", BOB_SEEDELF, "to your old datum");
    await alice.messaging.whenIdle();
    bob.restart();
    await synced(bob);
    expect((await bob.messaging.overview("preprod")).requests.map((r) => r.cid)).toEqual([cid]);
  });

  it("refuses writing to one's own Seedelf, an empty text and one too long", async () => {
    const { alice, bob } = await pair();
    await expect(alice.messaging.start("preprod", ALICE_SEEDELF, "me")).rejects.toThrow(/your own Seedelfs/);
    await expect(alice.messaging.start("preprod", BOB_SEEDELF, "  ")).rejects.toThrow(/Write a message/);
    const cid = await talking(alice, bob);
    const { maxTextBytes } = await alice.messaging.thread("preprod", cid);
    expect(maxTextBytes).toBeGreaterThan(30_000);
    await expect(alice.messaging.send("preprod", cid, "x".repeat(maxTextBytes + 1))).rejects.toThrow(/at most/);
    await alice.messaging.send("preprod", cid, "x".repeat(maxTextBytes));
  });

  it("says a conversation nobody answered in 48 hours, and starts it again to the same Seedelf", async () => {
    const { alice, bob } = await pair();
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "anyone?");
    await alice.messaging.whenIdle();
    expect((await alice.messaging.overview("preprod")).conversations[0]!.unanswered).toBe(false);
    await busyFor(49 * 3600_000, alice, bob);
    expect((await alice.messaging.overview("preprod")).conversations[0]!.unanswered).toBe(true);
    // Bob never read it in time: the relay's 36 hours are up, and so is its window.
    const next = await alice.messaging.restart("preprod", cid, "again");
    await alice.messaging.whenIdle();
    const listed = (await alice.messaging.overview("preprod")).conversations;
    expect(listed.find((c) => c.cid === cid)!.restartedAs).toBe(next);
    await synced(bob);
    expect((await bob.messaging.overview("preprod")).requests.map((r) => r.cid)).toEqual([next]);
  });

  it("never calls a conversation that has had a reply unanswered, however old", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await busyFor(49 * 3600_000, alice, bob);
    expect((await alice.messaging.overview("preprod")).conversations.find((c) => c.cid === cid)!.unanswered).toBe(false);
  });

  it("holds the history to its budget, oldest first, and keeps what's still to be posted (call 10)", async () => {
    const { alice, bob } = await pair(64 * 1024);
    const cid = await talking(alice, bob);
    for (let i = 0; i < 12; i++) await alice.messaging.send("preprod", cid, `${i}:` + "y".repeat(3000));
    await alice.messaging.whenIdle();
    const thread = await alice.messaging.thread("preprod", cid);
    expect(thread.trimmed).toBeGreaterThan(0);
    expect(thread.messages.at(-1)!.text).toMatch(/^11:/);
    const total = (await alice.messaging.overview("preprod")).conversations.length;
    expect(total).toBe(1);
    const inbox = await alice.store.get<{ conversations: Record<string, { bytes: number }> }>("messaging.preprod");
    expect(inbox!.conversations[cid]!.bytes).toBeLessThanOrEqual(64 * 1024);
  });

  it("reads every page behind the cursor, and asks from the cursor after", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    for (const text of ["a", "b", "c", "d"]) await alice.messaging.send("preprod", cid, text);
    await alice.messaging.whenIdle();
    relay.pageCount = 1;
    relay.calls.length = 0;
    await synced(bob);
    expect(await texts(bob, cid)).toEqual(["in:hello Bob", "out:hi Alice", "in:a", "in:b", "in:c", "in:d"]);
    const pages = relay.calls.filter((c) => c.startsWith("GET"));
    expect(pages.length).toBeGreaterThanOrEqual(4);
    expect(pages.every((c) => c.includes("?after="))).toBe(true);
    // Unread until the thread is shown.
    expect((await bob.messaging.overview("preprod")).conversations[0]!.unread).toBe(0);
    await alice.messaging.send("preprod", cid, "e");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect((await bob.messaging.overview("preprod")).conversations[0]!.unread).toBe(1);
    await bob.messaging.thread("preprod", cid);
    expect((await bob.messaging.overview("preprod")).conversations[0]!.unread).toBe(0);
  });

  it("keeps a message while the relay refuses its size (0), asking once with no work, and asks nothing from a direct sync while off", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    relay.refusing = 600;
    await synced(alice);
    relay.calls.length = 0;
    await alice.messaging.send("preprod", cid, "held");
    await alice.messaging.whenIdle();
    expect((await alice.messaging.thread("preprod", cid)).messages.at(-1)!.sent).toBe("pending");
    expect(relay.calls.filter((c) => c.startsWith("POST"))).toHaveLength(1);

    await alice.messaging.switch("preprod", false);
    relay.calls.length = 0;
    await alice.messaging.sync("preprod");
    await alice.messaging.post("preprod");
    expect(relay.calls).toEqual([]);
  });

  it("expires tombstones past their t + 48 hours and 7 days, at most hourly (DESIGN-protocol §3.6)", async () => {
    const { alice, bob } = await pair();
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "hello");
    await alice.messaging.whenIdle();
    await synced(bob);
    await bob.messaging.remove("preprod", cid);
    const held = async () => (await bob.store.get<{ tombstones?: string }>("messaging.preprod"))!.tombstones!.length;
    const one = await held();
    // Past its 48 hours, still held: the crate keeps it 7 days more (TOMBSTONE_MARGIN), whatever a clock does meanwhile.
    await busyFor(49 * 3600_000, alice, bob);
    await synced(bob);
    expect(await held()).toBe(one);
    await busyFor(7 * 24 * 3600_000, alice, bob);
    await synced(bob);
    expect(await held()).toBeLessThan(one);
  });

  it("never lets the budget delete a message still to be posted: one with no room beside them isn't kept, and says why (W7)", async () => {
    const { relay, alice, bob } = await pair(64 * 1024);
    const cid = await talking(alice, bob);
    relay.up = false;
    // Six of them, each an 8 KiB envelope kept until it's posted: more than this budget holds.
    const kept: string[] = [];
    for (let i = 0; i < 6; i++) {
      const text = `${i}:` + "z".repeat(3000);
      await alice.messaging.send("preprod", cid, text).then(
        () => void kept.push(text),
        (e: unknown) => expect(e).toBeInstanceOf(MessagingFull),
      );
    }
    await alice.messaging.whenIdle();
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(6);
    const waiting = (await alice.messaging.thread("preprod", cid)).messages.filter((m) => m.sent === "pending");
    expect(waiting.map((m) => m.text)).toEqual(kept);
    // Said at the send that was refused (MessagingFull's words); Messages still takes what comes (W11).
    expect((await alice.messaging.overview("preprod")).full).toBeUndefined();
    relay.up = true;
    await synced(alice);
    await synced(bob);
    expect((await texts(bob, cid)).filter((m) => m.startsWith("in:"))).toHaveLength(1 + kept.length);
  });

  it("stops reading pages once the switch is turned off mid-catch-up, and asks nothing while it's off", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    for (const text of ["a", "b", "c", "d"]) await alice.messaging.send("preprod", cid, text);
    await alice.messaging.whenIdle();
    relay.pageCount = 1;
    const real = relay.fetch;
    let gets = 0;
    relay.fetch = async (url, init) => {
      if (init.method === "GET" && ++gets === 1) await bob.preferences.set({ messaging: { preprod: false, mainnet: false } });
      return real(url, init);
    };
    await bob.messaging.sync("preprod");
    await bob.messaging.whenIdle();
    expect(gets).toBe(1);
  });

  it("never stops at a relay that says another page follows but gives none", async () => {
    const { relay, bob } = await pair();
    relay.alwaysMore = true;
    relay.calls.length = 0;
    await synced(bob);
    expect(relay.calls.filter((c) => c.startsWith("GET")).length).toBeLessThanOrEqual(2);
  });

  it("turns each network's switch apart: two at once keep both", async () => {
    const relay = fakeRelay(clock);
    const alice = await party(12, relay, new Map(), ALICE_SEEDELF);
    await Promise.all([alice.messaging.switch("preprod", true), alice.messaging.switch("mainnet", true)]);
    await alice.messaging.whenIdle();
    expect((await alice.preferences.get()).messaging).toEqual({ preprod: true, mainnet: true });
    await alice.messaging.switch("mainnet", false);
    await alice.messaging.whenIdle();
    expect(alice.alarm.on).toBe(true);
    await alice.messaging.switch("preprod", false);
    await alice.messaging.whenIdle();
    // Her certificate's withdrawal waits its random while after her certificate's post (chunk 55's call 9): the alarm
    // runs on for it, every switch off, and its run posts it; then nothing needs the alarm.
    expect(alice.alarm.on).toBe(true);
    await busyFor(10 * 60_000 + 1000, alice);
    await alice.messaging.syncAll(["preprod", "mainnet"], { alarm: true });
    await alice.messaging.whenIdle();
    expect(relay.calls.filter((c) => c === "POST /messaging/v1/preprod/withdrawals")).toHaveLength(1);
    expect(alice.alarm.on).toBe(false);
  });

  it("locks the wallet when WebAssembly traps under a sync nothing waits for, outside the wallet's queue", async () => {
    const relay = fakeRelay(clock);
    const bob = await party(24, relay, new Map(), BOB_SEEDELF);
    // As the contract's read can, in a call of its own outside the wallet's queue.
    bob.ownFails = new WebAssembly.RuntimeError("unreachable");
    await bob.messaging.switch("preprod", true);
    await bob.messaging.whenIdle();
    expect(await bob.wallet.state()).toBe("locked");
  });

  it("posts nothing once the switch goes off while a post's stamp is solved", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    // Dear enough to take several slices, the switch turned off at the first turn between them. The first slice comes
    // back empty: at 19 bits a real one finds a nonce one time in eight, and then there's no turn to turn it off in.
    relay.price = 19;
    const wasm = loadTestWasm();
    alice.restart({
      ...wasm,
      messagingFindStamp: (request) =>
        (JSON.parse(request) as { from: number }).from === 0 ? JSON.stringify({ nonce: null }) : wasm.messagingFindStamp(request),
    });
    await synced(alice);
    relay.calls.length = 0;
    alice.onWait = async () => {
      alice.onWait = undefined;
      await alice.preferences.set({ messaging: { preprod: false, mainnet: false } });
    };
    await alice.messaging.send("preprod", cid, "not now");
    await alice.messaging.whenIdle();
    expect(relay.calls.filter((c) => c.startsWith("POST"))).toEqual([]);
    expect((await alice.messaging.thread("preprod", cid)).messages.at(-1)!.sent).toBe("pending");
  });

  it("posts nothing more of a conversation deleted while its messages are posted", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    relay.up = false;
    await alice.messaging.send("preprod", cid, "one");
    await alice.messaging.send("preprod", cid, "two");
    await alice.messaging.whenIdle();
    relay.up = true;
    const real = relay.fetch;
    let posts = 0;
    // The deletion is pressed as the first post goes: a press waits for the posting run, a lane, to end (O8, round 5),
    // so the run posts what it read; then the conversation goes, and nothing of it is posted again, now or later.
    let removal: Promise<void> | undefined;
    relay.fetch = async (url, init) => {
      const answer = await real(url, init);
      if (init.method === "POST" && ++posts === 1) removal = alice.messaging.remove("preprod", cid);
      return answer;
    };
    await alice.messaging.post("preprod");
    await removal;
    await alice.messaging.whenIdle();
    expect(posts).toBe(2);
    expect((await alice.messaging.overview("preprod")).conversations).toEqual([]);
    alice.restart();
    await synced(alice);
    expect(posts).toBe(2);
  });

  it("posts nothing of a conversation deleted before its run read the outbox, after a restart too (round 5)", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    relay.up = false;
    await alice.messaging.send("preprod", cid, "one");
    await alice.messaging.whenIdle();
    relay.up = true;
    await alice.messaging.remove("preprod", cid);
    alice.restart();
    relay.calls.length = 0;
    await synced(alice);
    expect(relay.calls.filter((c) => c.startsWith("POST "))).toEqual([]);
  });

  it("writes no cursor into another phrase's inbox: the wallet removed and restored mid-sync", async () => {
    const { alice, bob } = await pair();
    await talking(alice, bob);
    await alice.messaging.send("preprod", (await alice.messaging.overview("preprod")).conversations[0]!.cid, "more");
    await alice.messaging.whenIdle();
    // Between the read's scan and the take's cursor, Bob's wallet is removed and another phrase restored.
    bob.onWait = async () => {
      bob.onWait = undefined;
      await bob.wallet.reset();
      await bob.wallet.create(phrase(15), PASSWORD);
    };
    await bob.messaging.sync("preprod").catch(() => undefined);
    await bob.messaging.whenIdle();
    expect((await cursorOf(bob))).toBeUndefined();
    expect(await bob.local.keys(PRIVATE_PREFIX + "conversation.")).toEqual([]);
  });

  it("goes on past a conversation's record that won't open, and deletes it", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    const record = await recordOf(bob, cid);
    await bob.local.set(PRIVATE_PREFIX + record, { v: 1, nonce: "A".repeat(32), data: "AAAA" });
    await alice.messaging.send("preprod", cid, "into the void");
    const other = await alice.messaging.start("preprod", BOB_SEEDELF, "a second one");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect((await bob.messaging.overview("preprod")).requests.map((r) => r.cid)).toEqual([other]);
    await bob.messaging.remove("preprod", cid);
    expect(await bob.local.get(PRIVATE_PREFIX + record)).toBeUndefined();
  });

  it("counts a record as the store keeps it: UTF-8, so Japanese counts three bytes a character", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await alice.messaging.send("preprod", cid, "日本語".repeat(1500));
    await alice.messaging.whenIdle();
    const sealed = (await alice.local.get<{ data: string }>(PRIVATE_PREFIX + (await recordOf(alice, cid))))!;
    const inbox = (await alice.store.get<{ conversations: Record<string, { bytes: number }> }>("messaging.preprod"))!;
    expect(Math.abs(inbox.conversations[cid]!.bytes - sealed.data.length)).toBeLessThanOrEqual(4);
  });

  it("trims the conversation that takes the room, never an older one it can do without (W7)", async () => {
    const { alice, bob } = await pair(64 * 1024);
    const old = await talking(alice, bob);
    await busyFor(3600_000, alice, bob);
    const busy = await alice.messaging.start("preprod", BOB_SEEDELF, "another");
    await alice.messaging.whenIdle();
    await synced(bob);
    await bob.messaging.accept("preprod", busy);
    await bob.messaging.send("preprod", busy, "ok");
    await bob.messaging.whenIdle();
    await synced(alice);
    for (let i = 0; i < 12; i++) await alice.messaging.send("preprod", busy, `${i}:` + "w".repeat(3000));
    await alice.messaging.whenIdle();
    // Everything Messages stores, the inbox too, within the budget.
    let stored = 0;
    for (const key of await alice.local.keys(PRIVATE_PREFIX)) {
      if (/^seedelf\.private\.(messaging|conversation)\./.test(key)) stored += (await alice.local.get<{ data: string }>(key))!.data.length;
    }
    expect(stored).toBeLessThanOrEqual(64 * 1024);
    // The older conversation is as it was; the busy one lost its oldest, and keeps its newest.
    expect(await texts(alice, old)).toEqual(["out:hello Bob", "in:hi Alice"]);
    const thread = await alice.messaging.thread("preprod", busy);
    expect(thread.trimmed).toBeGreaterThan(0);
    expect(thread.messages.at(-1)!.text).toMatch(/^11:/);
    expect((await alice.messaging.overview("preprod")).conversations.find((c) => c.cid === busy)!.last!.text).toMatch(/^11:/);
  });

  it("tells open pages what changed, and syncs nothing while locked, its alarm stopped", async () => {
    const { relay, alice, bob } = await pair();
    await talking(alice, bob);
    expect(alice.changed).toContain("preprod");
    await alice.messaging.syncAll(["preprod"]);
    expect(alice.alarm.on).toBe(true);
    await alice.wallet.lock();
    relay.calls.length = 0;
    await alice.messaging.syncAll(["preprod"]);
    expect(relay.calls).toEqual([]);
    expect(alice.alarm.on).toBe(false);
  });

  it("posts a message the inbox lost count of: a lock between its record's write and the inbox's", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    relay.up = false;
    await alice.messaging.send("preprod", cid, "uncounted");
    await alice.messaging.whenIdle();
    relay.up = true;
    // The record holds it pending; the inbox, as a lock between the two writes leaves it, doesn't count it.
    const inbox = (await alice.store.get<{ conversations: Record<string, { outbox: number }> }>("messaging.preprod"))!;
    inbox.conversations[cid]!.outbox = 0;
    await alice.store.set("messaging.preprod", inbox);
    await alice.wallet.lock();
    clock.now += 1000;
    await alice.wallet.unlock(PASSWORD);
    await synced(alice);
    expect((await alice.messaging.thread("preprod", cid)).messages.at(-1)).toMatchObject({ text: "uncounted", sent: "posted" });
  });
});

describe("the wallet's messages", () => {
  it("are a kind byte, then UTF-8 text: another kind is said, never guessed at (protocol.md §18)", () => {
    expect(plaintextOf("héllo")).toBe("01" + "68c3a96c6c6f");
    expect(textOf("01" + "68c3a96c6c6f")).toEqual({ text: "héllo" });
    expect(textOf("02" + "00ff")).toEqual({ kind: 2 });
    // A content kind this version doesn't know keeps its body, for a later version to show; a control kind leaves
    // nothing at all (the 1.10.0 gate's W15).
    expect(textOf("05" + "c0ffee")).toEqual({ kind: 5, body: "c0ffee" });
    expect(textOf("7f")).toEqual({ kind: 0x7f, body: "" });
    expect(textOf("80" + "00")).toBeUndefined();
    expect(textOf("ff")).toBeUndefined();
  });

  it("are counted as the store keeps them: sealed, padded to a power of two, base64", () => {
    // Base64 with its padding characters (round 5): exactly the stored data's length.
    expect(storedBytes(10)).toBe(4 * Math.ceil((1024 + 16) / 3));
    expect(storedBytes(10)).toBe(1388);
    expect(storedBytes(1025)).toBe(4 * Math.ceil((2048 + 16) / 3));
    expect(Buffer.from(new Uint8Array(1024 + 16)).toString("base64")).toHaveLength(storedBytes(10));
    expect(Buffer.from(new Uint8Array(4096 + 16)).toString("base64")).toHaveLength(storedBytes(4000));
  });
});

describe("what the screens show (54f)", { timeout: 30_000 }, () => {
  it("keeps each conversation's last message for the list, either way, from the start, a reply and an accept", async () => {
    const { alice, bob } = await pair();
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "hello Bob");
    expect((await alice.messaging.overview("preprod")).conversations[0]!.last).toEqual({ dir: "out", text: "hello Bob" });
    await alice.messaging.whenIdle();
    await synced(bob);
    await bob.messaging.accept("preprod", cid);
    expect((await bob.messaging.overview("preprod")).conversations[0]!.last).toEqual({ dir: "in", text: "hello Bob" });
    await bob.messaging.send("preprod", cid, "hi Alice");
    expect((await bob.messaging.overview("preprod")).conversations[0]!.last).toEqual({ dir: "out", text: "hi Alice" });
    await bob.messaging.whenIdle();
    await synced(alice);
    expect((await alice.messaging.overview("preprod")).conversations[0]!.last).toEqual({ dir: "in", text: "hi Alice" });
  });

  it("cuts a long last message to whole characters, and names a kind it can't show by its way alone", () => {
    const long = "🙂".repeat(PREVIEW_CHARS + 5);
    const cut = lastOf([{ id: 0, dir: "in", at: 1, text: long }])!;
    expect([...cut.text!]).toHaveLength(PREVIEW_CHARS + 1);
    expect(cut.text!.endsWith("🙂…")).toBe(true);
    expect(lastOf([{ id: 0, dir: "out", at: 1, text: "short" }])).toEqual({ dir: "out", text: "short" });
    expect(lastOf([{ id: 0, dir: "in", at: 1, kind: 9 }])).toEqual({ dir: "in" });
    expect(lastOf([{ id: 0, dir: "in", at: 1, kind: 2 }])).toEqual({ dir: "in", reveal: true });
    expect(lastOf([])).toBeUndefined();
  });

  // The 1.10.0 gate's blind reading: a refused message's row read "You: …", as if it went, and one waiting for a
  // reply "Sending…". The list is handed the one thing its count of the outbox doesn't say (`unsent`).
  it("says, for the list, a last message of the user's that ended unsent, and waiting ones that all wait for a reply", () => {
    type Sent = "queued" | "pending" | "posted" | "refused";
    const out = (id: number, sent: Sent, more: object = {}) => ({ id, dir: "out" as const, at: id, text: `m${id}`, sent, ...more });
    // Refused, by the server (its bytes kept) or by the wallet's own crate.
    expect(lastOf([out(0, "posted"), out(1, "refused", { envelope: "01ab" })])).toEqual({ dir: "out", text: "m1", unsent: "refused" });
    expect(lastOf([out(0, "refused", { refusedBy: "wallet" })])).toEqual({ dir: "out", text: "m0", unsent: "refused" });
    expect(lastOf([out(0, "posted"), { id: 1, dir: "out", at: 1, kind: 2, sent: "refused" }])).toEqual({ dir: "out", reveal: true, unsent: "refused" });
    // One the other side wrote after it: the row is their message's.
    expect(lastOf([out(0, "refused"), { id: 1, dir: "in", at: 1, text: "hi" }])).toEqual({ dir: "in", text: "hi" });
    // Sent, being prepared or being posted: nothing to say but what the outbox's count does.
    expect(lastOf([out(0, "posted")])).toEqual({ dir: "out", text: "m0" });
    expect(lastOf([out(0, "queued")])).toEqual({ dir: "out", text: "m0" });
    expect(lastOf([out(0, "posted"), out(1, "pending")])).toEqual({ dir: "out", text: "m1" });
    // Every waiting one queued behind a message past its stamp: they wait for a reply, as the thread says of each.
    expect(lastOf([out(0, "posted"), out(1, "queued"), out(2, "queued")])).toEqual({ dir: "out", text: "m2", unsent: "reply" });
    // One of them still being posted: something is on its way.
    expect(lastOf([out(0, "pending"), out(1, "queued")])).toEqual({ dir: "out", text: "m1" });
  });

  it("says the relay didn't answer while it doesn't, and stops once it does; never while the switch is off", async () => {
    const { relay, alice } = await pair();
    relay.up = false;
    alice.changed.length = 0;
    await synced(alice);
    expect((await alice.messaging.overview("preprod")).offline).toBe(true);
    expect(alice.changed).toContain("preprod");
    relay.up = true;
    alice.changed.length = 0;
    await synced(alice);
    expect((await alice.messaging.overview("preprod")).offline).toBeUndefined();
    expect(alice.changed).toContain("preprod");
    // Off, there's nothing to wait for, and on again the next read says afresh: no warning left from before.
    relay.up = false;
    await synced(alice);
    await alice.messaging.switch("preprod", false);
    expect((await alice.messaging.overview("preprod")).offline).toBeUndefined();
    relay.up = true;
    await alice.messaging.switch("preprod", true);
    await alice.messaging.whenIdle();
    expect((await alice.messaging.overview("preprod")).offline).toBeUndefined();
  });

  it("tells open pages when reading a thread or a request leaves less unread, and only then", async () => {
    const { alice, bob } = await pair();
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "hello Bob");
    await alice.messaging.whenIdle();
    await synced(bob);
    bob.changed.length = 0;
    await bob.messaging.request("preprod", cid);
    expect(bob.changed).toEqual(["preprod"]);
    await bob.messaging.request("preprod", cid);
    expect(bob.changed).toEqual(["preprod"]);
    await bob.messaging.accept("preprod", cid);
    await bob.messaging.send("preprod", cid, "hi Alice");
    await bob.messaging.whenIdle();
    await synced(alice);
    alice.changed.length = 0;
    await alice.messaging.thread("preprod", cid);
    expect(alice.changed).toEqual(["preprod"]);
    await alice.messaging.thread("preprod", cid);
    expect(alice.changed).toEqual(["preprod"]);
  });

  it("says the relay answers again at once, even when what it read then can't be taken", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    // Taking fails once `failing` is set: the record won't read.
    const wasm = loadTestWasm();
    let failing = false;
    bob.restart({
      ...wasm,
      messagingReceive: (key, request) => {
        if (failing) throw new Error("the record won't read");
        return wasm.messagingReceive(key, request);
      },
    });
    relay.up = false;
    await synced(bob);
    expect((await bob.messaging.overview("preprod")).offline).toBe(true);
    relay.up = true;
    await alice.messaging.send("preprod", cid, "while you were away");
    await alice.messaging.whenIdle();
    // The page reads, then taking what it found fails: the relay's answer is said all the same, and at once.
    failing = true;
    bob.changed.length = 0;
    await bob.messaging.sync("preprod");
    expect((await bob.messaging.overview("preprod")).offline).toBeUndefined();
    expect(bob.changed).toContain("preprod");
    await bob.messaging.whenIdle();
    expect((await texts(bob, cid)).includes("in:while you were away")).toBe(false);
  });

  it("keeps the user's own name for a conversation, on the device, into one started again; takes it away when empty", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "hello Bob");
    await alice.messaging.whenIdle();
    await synced(bob);
    await bob.messaging.accept("preprod", cid);
    relay.calls.length = 0;
    await bob.messaging.rename("preprod", cid, "  Alice  ");
    expect((await bob.messaging.overview("preprod")).conversations[0]).toMatchObject({ cid, name: "Alice", role: "responder" });
    // Never sent: naming asks the relay nothing.
    expect(relay.calls).toEqual([]);
    await expect(bob.messaging.rename("preprod", cid, "x".repeat(41))).rejects.toThrow(/at most 40/);
    await bob.messaging.rename("preprod", cid, "");
    expect((await bob.messaging.overview("preprod")).conversations[0]!.name).toBeUndefined();
    // Started again to the same Seedelf: Alice's name for it goes on.
    await alice.messaging.rename("preprod", cid, "Bob");
    const again = await alice.messaging.restart("preprod", cid, "again");
    const listed = (await alice.messaging.overview("preprod")).conversations;
    expect(listed.find((c) => c.cid === again)!.name).toBe("Bob");
  });

  it("isn't offline for a read it chose not to make: a lock mid-sync", async () => {
    const { relay, alice } = await pair();
    relay.up = false;
    await alice.wallet.lock();
    await alice.messaging.sync("preprod");
    await alice.wallet.unlock(PASSWORD);
    expect((await alice.messaging.overview("preprod")).offline).toBeUndefined();
  });
});
