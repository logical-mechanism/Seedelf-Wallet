// Seedelf Messaging in the worker (chunk 54's 54e): two wallets writing to
// each other through an in-memory relay (fake-relay.ts), with the records
// alone between their calls, as a restarted worker has them.
import { describe, expect, it } from "vitest";

import {
  type ConversationFile,
  type Inbox,
  lastOf,
  REVEAL_READ_RETRY_MS,
  MessagingService,
  plaintextOf,
  PREVIEW_CHARS,
  storedBytes,
  textOf,
} from "../src/background/messaging";
import { PreferencesService } from "../src/background/preferences";
import { conversationRecord, PRIVATE_PREFIX, PrivateStore } from "../src/background/private-store";
import type { RegisterHex } from "../src/background/chain";
import type { NetworkName } from "../src/networks";
import { fakeRelay, type FakeRelay } from "./fake-relay";
import { loadTestWasm, memoryArea, testWallet, vectors, type MemoryArea } from "./fakes";

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
      return read ? p.own : p.keptView ? (p.kept ?? p.own) : [];
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
  const preferences = new PreferencesService(t.local);
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

describe("Seedelf Messaging in the worker", () => {
  it("reads nothing and posts nothing while a network's switch is off (call 9)", async () => {
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const alice = await party(12, relay, directory, ALICE_SEEDELF);
    await party(24, relay, directory, BOB_SEEDELF);
    await alice.messaging.syncAll(["preprod", "mainnet"]);
    // Written while off: kept, stamped, never posted.
    await alice.messaging.start("preprod", BOB_SEEDELF, "not yet");
    await alice.messaging.whenIdle();
    expect(relay.calls).toEqual([]);
    expect((await alice.messaging.overview("preprod")).conversations[0]!.outbox).toBe(1);
    // On: the next sync posts what was waiting.
    await alice.messaging.switch("preprod", true);
    await alice.messaging.whenIdle();
    expect(relay.calls.some((c) => c.startsWith("POST /messaging/v1/preprod/"))).toBe(true);
    expect((await alice.messaging.overview("preprod")).conversations[0]!.outbox).toBe(0);
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
    // A worker stopped before the cursor moved: the same pages read again, from the start.
    const inbox = await bob.store.get<{ cursor?: string }>("messaging.preprod");
    await bob.store.set("messaging.preprod", { ...inbox, cursor: undefined });
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

  it("loses nothing when the wallet locks mid-page: the cursor moves only once the page is done", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await alice.messaging.send("preprod", cid, "first");
    await alice.messaging.send("preprod", cid, "second");
    await alice.messaging.whenIdle();
    // Bob locks as the page's first new envelope is taken, before its record is written.
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
    await expect(bob.messaging.sync("preprod")).rejects.toThrow();
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
    expect(await bob.local.get(PRIVATE_PREFIX + conversationRecord("preprod", cid))).toBeDefined();
    await bob.messaging.remove("preprod", cid);
    expect(await bob.local.get(PRIVATE_PREFIX + conversationRecord("preprod", cid))).toBeUndefined();
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

  it("says a conversation this browser no longer has, and when the relay lost envelopes", async () => {
    const { relay, directory, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    // Alice's wallet restored in a new browser: the same key, none of the conversations.
    const again = await party(12, relay, directory);
    await again.messaging.switch("preprod", true);
    await again.messaging.whenIdle();
    await bob.messaging.send("preprod", cid, "are you there?");
    await bob.messaging.whenIdle();
    await synced(again);
    // Bob's two messages, both to the conversation it no longer has.
    expect((await again.messaging.overview("preprod")).lost).toEqual([{ cid, lastAt: clock.now, messages: 2 }]);

    relay.gapOnce = true;
    await synced(bob);
    expect((await bob.messaging.overview("preprod")).gapAt).toBe(clock.now);
  });

  it("reads a first message to a register the Seedelf no longer holds (§16.4)", async () => {
    const { directory, alice, bob } = await pair();
    // Bob's sync has seen the register Alice will write to.
    await synced(bob);
    const old = directory.get(BOB_SEEDELF)!;
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "to your old datum");
    await alice.messaging.whenIdle();
    // Then the Seedelf's datum changed.
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

  it("posts nothing while the relay's price for its size is refused (0), and nothing from a direct sync while off", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    relay.price = 0;
    await synced(alice);
    await alice.messaging.send("preprod", cid, "held");
    await alice.messaging.whenIdle();
    expect((await alice.messaging.thread("preprod", cid)).messages.at(-1)!.sent).toBe("pending");

    await alice.messaging.switch("preprod", false);
    relay.calls.length = 0;
    await alice.messaging.sync("preprod");
    await alice.messaging.post("preprod");
    expect(relay.calls).toEqual([]);
  });

  it("expires tombstones past their t + 48 hours, at most hourly", async () => {
    const { alice, bob } = await pair();
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "hello");
    await alice.messaging.whenIdle();
    await synced(bob);
    await bob.messaging.remove("preprod", cid);
    const held = async () => (await bob.store.get<{ tombstones?: string }>("messaging.preprod"))!.tombstones!.length;
    const one = await held();
    await busyFor(49 * 3600_000, alice, bob);
    await synced(bob);
    expect(await held()).toBeLessThan(one);
  });

  it("never lets the budget delete a message still to be posted", async () => {
    const { relay, alice, bob } = await pair(64 * 1024);
    const cid = await talking(alice, bob);
    relay.up = false;
    for (let i = 0; i < 6; i++) await alice.messaging.send("preprod", cid, `${i}:` + "z".repeat(3000));
    await alice.messaging.whenIdle();
    const waiting = (await alice.messaging.thread("preprod", cid)).messages.filter((m) => m.sent === "pending");
    expect(waiting).toHaveLength(6);
    relay.up = true;
    await synced(alice);
    await synced(bob);
    expect((await texts(bob, cid)).filter((m) => m.startsWith("in:"))).toHaveLength(7);
  });

  it("reads the contract again for a Seedelf the kept view is too old to have, and keeps the cursor when it can't", async () => {
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const alice = await party(12, relay, directory, ALICE_SEEDELF);
    const bob = await party(24, relay, directory, BOB_SEEDELF);
    // Bob's view was kept before this Seedelf was his.
    bob.kept = [];
    await alice.messaging.switch("preprod", true);
    await bob.messaging.switch("preprod", true);
    await alice.messaging.whenIdle();
    await bob.messaging.whenIdle();
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "new Seedelf?");
    await alice.messaging.whenIdle();
    // The read fails: the page is read again next time, nothing lost.
    bob.readFails = new Error("Koios is down");
    await expect(bob.messaging.sync("preprod")).rejects.toThrow(/Koios is down/);
    expect((await bob.messaging.overview("preprod")).requests).toEqual([]);
    bob.readFails = undefined;
    await synced(bob);
    expect((await bob.messaging.overview("preprod")).requests.map((r) => r.cid)).toEqual([cid]);
  });

  it("reads the contract again for a register the kept view is too old to have", async () => {
    const { directory, alice, bob } = await pair();
    // The kept view still has the register Bob's Seedelf held before; the chain, and Alice, have its new one.
    const before = bob.own[0]!;
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
    bob.kept = [before];
    bob.own.splice(0, 1, { name: BOB_SEEDELF, register: fresh });
    directory.set(BOB_SEEDELF, fresh);
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "to your new datum");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect((await bob.messaging.overview("preprod")).requests.map((r) => r.cid)).toEqual([cid]);
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
    expect(alice.alarm.on).toBe(true);
    await alice.messaging.switch("preprod", false);
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
    relay.fetch = async (url, init) => {
      const answer = await real(url, init);
      if (init.method === "POST" && ++posts === 1) await alice.messaging.remove("preprod", cid);
      return answer;
    };
    await alice.messaging.post("preprod");
    await alice.messaging.whenIdle();
    expect(posts).toBe(1);
  });

  it("writes no cursor into another phrase's inbox: the wallet removed and restored mid-sync", async () => {
    const { alice, bob } = await pair();
    await talking(alice, bob);
    await alice.messaging.send("preprod", (await alice.messaging.overview("preprod")).conversations[0]!.cid, "more");
    await alice.messaging.whenIdle();
    // Between the page's scan and its cursor's write, Bob's wallet is removed and another phrase restored.
    bob.onWait = async () => {
      bob.onWait = undefined;
      await bob.wallet.reset();
      await bob.wallet.create(phrase(15), PASSWORD);
    };
    await expect(bob.messaging.sync("preprod")).rejects.toThrow();
    expect((await bob.store.get<{ cursor?: string }>("messaging.preprod"))?.cursor).toBeUndefined();
  });

  it("goes on past a conversation's record that won't open, and deletes it", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await bob.local.set(PRIVATE_PREFIX + conversationRecord("preprod", cid), { v: 1, nonce: "A".repeat(32), data: "AAAA" });
    await alice.messaging.send("preprod", cid, "into the void");
    const other = await alice.messaging.start("preprod", BOB_SEEDELF, "a second one");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect((await bob.messaging.overview("preprod")).requests.map((r) => r.cid)).toEqual([other]);
    await bob.messaging.remove("preprod", cid);
    expect(await bob.local.get(PRIVATE_PREFIX + conversationRecord("preprod", cid))).toBeUndefined();
  });

  it("counts a record as the store keeps it: UTF-8, so Japanese counts three bytes a character", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await alice.messaging.send("preprod", cid, "日本語".repeat(1500));
    await alice.messaging.whenIdle();
    const sealed = (await alice.local.get<{ data: string }>(PRIVATE_PREFIX + conversationRecord("preprod", cid)))!;
    const inbox = (await alice.store.get<{ conversations: Record<string, { bytes: number }> }>("messaging.preprod"))!;
    expect(Math.abs(inbox.conversations[cid]!.bytes - sealed.data.length)).toBeLessThanOrEqual(4);
  });

  it("trims a busy conversation past the budget once an older one has nothing left to delete", async () => {
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
    const inbox = (await alice.store.get<{ conversations: Record<string, { bytes: number }> }>("messaging.preprod"))!;
    const total = Object.values(inbox.conversations).reduce((sum, m) => sum + m.bytes, 0);
    expect(total).toBeLessThanOrEqual(64 * 1024);
    expect((await alice.messaging.thread("preprod", old)).messages).toEqual([]);
    expect((await alice.messaging.thread("preprod", busy)).trimmed).toBeGreaterThan(0);
    // The list's last message went with the rest: no deleted text is shown for it.
    expect((await alice.messaging.overview("preprod")).conversations.find((c) => c.cid === old)!.last).toBeUndefined();
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

  it("reads the contract for the wallet's Seedelfs when a stranger writes and no view of it is kept", async () => {
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const alice = await party(12, relay, directory, ALICE_SEEDELF);
    const bob = await party(24, relay, directory, BOB_SEEDELF);
    bob.keptView = false;
    await alice.messaging.switch("preprod", true);
    await bob.messaging.switch("preprod", true);
    await alice.messaging.whenIdle();
    await bob.messaging.whenIdle();
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "found you");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect((await bob.messaging.overview("preprod")).requests.map((r) => r.cid)).toEqual([cid]);
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
  });

  it("are counted as the store keeps them: sealed, padded to a power of two, base64", () => {
    expect(storedBytes(10)).toBe(Math.ceil(((1024 + 16) * 4) / 3));
    expect(storedBytes(1025)).toBe(Math.ceil(((2048 + 16) * 4) / 3));
  });
});

describe("what the screens show (54f)", () => {
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

  it("says the relay answers again at once, even when the sync then fails", async () => {
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const alice = await party(12, relay, directory, ALICE_SEEDELF);
    const bob = await party(24, relay, directory, BOB_SEEDELF);
    bob.kept = [];
    await alice.messaging.switch("preprod", true);
    await bob.messaging.switch("preprod", true);
    await alice.messaging.whenIdle();
    await bob.messaging.whenIdle();
    relay.up = false;
    await synced(bob);
    expect((await bob.messaging.overview("preprod")).offline).toBe(true);
    relay.up = true;
    await alice.messaging.start("preprod", BOB_SEEDELF, "new Seedelf?");
    await alice.messaging.whenIdle();
    // The page reads, then the contract read for the stranger's first message fails: the sync throws.
    bob.readFails = new Error("Koios is down");
    bob.changed.length = 0;
    await expect(bob.messaging.sync("preprod")).rejects.toThrow(/Koios is down/);
    expect((await bob.messaging.overview("preprod")).offline).toBeUndefined();
    expect(bob.changed).toContain("preprod");
  });

  it("tells open pages at once that a conversation may not continue", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    // More than MAX_SKIP (1,000) of Bob's messages never reach Alice: his ratchet steps on a copy of his record, and
    // only the last envelope is posted.
    const wasm = loadTestWasm();
    let state = (await bob.store.get<{ state: string }>(conversationRecord("preprod", cid)))!.state;
    let envelope = "";
    for (let i = 0; i < 1002; i++) {
      const sent = JSON.parse(wasm.messagingSend(JSON.stringify({ conversation: state, plaintext: plaintextOf(`m${i}`) })));
      state = sent.conversation;
      envelope = sent.envelope;
    }
    relay.put("preprod", envelope);
    alice.changed.length = 0;
    await synced(alice);
    expect((await alice.messaging.overview("preprod")).conversations[0]!.unreachable).toBe(1);
    expect(alice.changed).toContain("preprod");
    // 1,002 ratchet steps: about 5 s alone, twice that beside the rest of the suite.
  }, 60_000);

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

describe("the verified reveal in the worker (protocol.md §19)", () => {
  /** Another register of `p`'s key: what its Seedelf's datum holds once it's locked again. */
  async function another(p: Party): Promise<RegisterHex> {
    const wasm = loadTestWasm();
    return p.wallet.withKeys((keys) => {
      const b = keys.seedelf.baseRegister();
      const r = wasm.rerandomize(b);
      b.free();
      try {
        return { generator: r.generator, publicValue: r.publicValue };
      } finally {
        r.free();
      }
    });
  }

  const last = async (p: Party, cid: string) => (await p.messaging.thread("preprod", cid)).messages.at(-1)!;
  const record = (p: Party, cid: string) => p.store.get<ConversationFile>(conversationRecord("preprod", cid));

  it("shows Bob Alice's Seedelf once he has replied, which his wallet checks against the chain, then names", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    // Offered where Alice wrote first and has a reply, never on Bob's side.
    expect((await alice.messaging.thread("preprod", cid)).seedelfs).toEqual([ALICE_SEEDELF]);
    expect((await bob.messaging.thread("preprod", cid)).seedelfs).toBeUndefined();
    await alice.messaging.reveal("preprod", cid, ALICE_SEEDELF);
    await alice.messaging.whenIdle();
    const shown = await last(alice, cid);
    expect(shown).toMatchObject({ dir: "out", reveal: { status: "shown", name: ALICE_SEEDELF }, sent: "posted" });
    expect(shown.text).toBeUndefined();
    const mine = (await alice.messaging.overview("preprod")).conversations[0]!;
    expect(mine.last).toEqual({ dir: "out", reveal: true });
    expect(mine.revealed).toBeUndefined();

    await synced(bob);
    const thread = await bob.messaging.thread("preprod", cid);
    expect(thread.messages.at(-1)).toMatchObject({ dir: "in", reveal: { status: "verified", name: ALICE_SEEDELF } });
    expect(thread.conversation.revealed).toEqual({ name: ALICE_SEEDELF, at: expect.any(Number) });
    expect((await bob.messaging.overview("preprod")).conversations[0]!.last).toEqual({ dir: "in", reveal: true });
    // One fresh read of the contract, and nothing left to check.
    expect(bob.revealReads).toBe(1);
    expect((await bob.store.get<Inbox>("messaging.preprod"))!.conversations[cid]!.checking).toBeUndefined();
    expect((await record(bob, cid))!.history.at(-1)!.reveal).toEqual({ status: "verified", name: ALICE_SEEDELF });
  });

  it("refuses one before a reply, from the side written to, and of a Seedelf that isn't the wallet's, sending nothing", async () => {
    const { alice, bob } = await pair();
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "hello Bob");
    await alice.messaging.whenIdle();
    expect((await alice.messaging.thread("preprod", cid)).seedelfs).toBeUndefined();
    await expect(alice.messaging.reveal("preprod", cid, ALICE_SEEDELF)).rejects.toThrow(/wrote first/);
    await synced(bob);
    await bob.messaging.accept("preprod", cid);
    await bob.messaging.send("preprod", cid, "hi Alice");
    await bob.messaging.whenIdle();
    await synced(alice);
    await expect(bob.messaging.reveal("preprod", cid, BOB_SEEDELF)).rejects.toThrow(/wrote first/);
    await expect(alice.messaging.reveal("preprod", cid, BOB_SEEDELF)).rejects.toThrow(/isn't this wallet's/);
    // One the contract read no longer finds the wallet's: moved away since the view was kept.
    alice.own = [];
    await expect(alice.messaging.reveal("preprod", cid, ALICE_SEEDELF)).rejects.toThrow(/isn't this wallet's/);
    expect(await texts(alice, cid)).toEqual(["out:hello Bob", "in:hi Alice"]);
  });

  it("fails one whose register the chain no longer gives its name, never naming it; shown again, it verifies", async () => {
    const { alice, bob, directory } = await pair();
    const cid = await talking(alice, bob);
    await alice.messaging.reveal("preprod", cid, ALICE_SEEDELF);
    await alice.messaging.whenIdle();
    // Alice's Seedelf was locked again under another register (or passed to someone else) before Bob's wallet read
    // the contract: whatever a view kept from before says, the read now decides.
    const was = directory.get(ALICE_SEEDELF)!;
    const now = await another(alice);
    directory.set(ALICE_SEEDELF, now);
    await synced(bob);
    let thread = await bob.messaging.thread("preprod", cid);
    expect(thread.messages.at(-1)!.reveal).toEqual({ status: "failed" });
    expect(thread.conversation.revealed).toBeUndefined();
    expect(bob.revealReads).toBe(1);
    expect(JSON.stringify(await record(bob, cid))).not.toContain(ALICE_SEEDELF);
    expect(JSON.stringify(await bob.store.get("messaging.preprod"))).not.toContain(ALICE_SEEDELF);

    // Shown again: for the register a contract read finds now, even where Alice's kept view still has the old one.
    alice.own = [{ name: ALICE_SEEDELF, register: now }];
    alice.kept = [{ name: ALICE_SEEDELF, register: was }];
    await alice.messaging.reveal("preprod", cid, ALICE_SEEDELF);
    await alice.messaging.whenIdle();
    await synced(bob);
    thread = await bob.messaging.thread("preprod", cid);
    expect(thread.messages.at(-1)!.reveal).toEqual({ status: "verified", name: ALICE_SEEDELF });
    expect(thread.conversation.revealed?.name).toBe(ALICE_SEEDELF);
  });

  it("reads the contract once a pass, however many reveals wait, and not at all when none does", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    for (let i = 0; i < 3; i++) await alice.messaging.reveal("preprod", cid, ALICE_SEEDELF);
    await alice.messaging.whenIdle();
    await synced(bob);
    const thread = await bob.messaging.thread("preprod", cid);
    expect(thread.messages.slice(-3).map((m) => m.reveal?.status)).toEqual(["verified", "verified", "verified"]);
    expect(bob.revealReads).toBe(1);
    await synced(bob);
    expect(bob.revealReads).toBe(1);
  });

  it("leaves one checking while the chain can't be read, never named, and checks it at the next sync", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await alice.messaging.reveal("preprod", cid, ALICE_SEEDELF);
    await alice.messaging.whenIdle();
    bob.revealFails = new Error("the server didn't answer");
    await synced(bob);
    expect((await last(bob, cid)).reveal).toEqual({ status: "checking" });
    expect((await bob.messaging.overview("preprod")).conversations[0]!.revealed).toBeUndefined();
    expect((await bob.store.get<Inbox>("messaging.preprod"))!.conversations[cid]!.checking).toBe(true);
    // Not asked again at every sync: a minute on.
    bob.revealFails = undefined;
    await synced(bob);
    expect(bob.revealReads).toBe(1);
    expect((await last(bob, cid)).reveal).toEqual({ status: "checking" });
    await busyFor(REVEAL_READ_RETRY_MS, bob);
    await synced(bob);
    expect(bob.revealReads).toBe(2);
    expect((await last(bob, cid)).reveal).toEqual({ status: "verified", name: ALICE_SEEDELF });
    expect((await bob.store.get<Inbox>("messaging.preprod"))!.conversations[cid]!.checking).toBeUndefined();
  });

  it("names the other side by the latest that verified, by when it came", async () => {
    const { alice, bob, directory } = await pair();
    const cid = await talking(alice, bob);
    const SECOND = "5eed0e1f00" + "616c69636532";
    const second = await another(alice);
    alice.own.push({ name: SECOND, register: second });
    directory.set(SECOND, second);
    await alice.messaging.reveal("preprod", cid, ALICE_SEEDELF);
    await alice.messaging.reveal("preprod", cid, SECOND);
    await alice.messaging.whenIdle();
    // Both verified in one pass, at one time: the one that came last names the other side.
    await synced(bob);
    let thread = await bob.messaging.thread("preprod", cid);
    expect(thread.messages.slice(-2).map((m) => m.reveal)).toEqual([
      { status: "verified", name: ALICE_SEEDELF },
      { status: "verified", name: SECOND },
    ]);
    expect(thread.conversation.revealed?.name).toBe(SECOND);
    // A later one that fails names nothing, and the last that verified stands.
    directory.set(ALICE_SEEDELF, await another(alice));
    await alice.messaging.reveal("preprod", cid, ALICE_SEEDELF);
    await alice.messaging.whenIdle();
    await synced(bob);
    thread = await bob.messaging.thread("preprod", cid);
    expect(thread.messages.at(-1)!.reveal).toEqual({ status: "failed" });
    expect(thread.conversation.revealed?.name).toBe(SECOND);
    // Shown again for the register it holds now, at a later sync: the newer names the other side.
    alice.own[0] = { name: ALICE_SEEDELF, register: directory.get(ALICE_SEEDELF)! };
    await alice.messaging.reveal("preprod", cid, ALICE_SEEDELF);
    await alice.messaging.whenIdle();
    await synced(bob);
    thread = await bob.messaging.thread("preprod", cid);
    expect(thread.messages.at(-1)!.reveal).toEqual({ status: "verified", name: ALICE_SEEDELF });
    expect(thread.conversation.revealed?.name).toBe(ALICE_SEEDELF);
  });

  it("sets right a conversation's reveals from its record: a stop between two writes, or the history's budget", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await alice.messaging.reveal("preprod", cid, ALICE_SEEDELF);
    await alice.messaging.whenIdle();
    bob.revealFails = new Error("the server didn't answer");
    await synced(bob);
    const inbox = async () => (await bob.store.get<Inbox>("messaging.preprod"))!;
    // A stop between the record's write and the inbox's: the reveal waits, and the inbox doesn't say so.
    let kept = await inbox();
    delete kept.conversations[cid]!.checking;
    await bob.store.set("messaging.preprod", kept);
    bob.revealFails = undefined;
    await busyFor(REVEAL_READ_RETRY_MS, bob);
    bob.restart();
    await synced(bob);
    expect((await last(bob, cid)).reveal).toEqual({ status: "verified", name: ALICE_SEEDELF });
    expect((await inbox()).conversations[cid]!.revealed?.name).toBe(ALICE_SEEDELF);
    // The record checked and the inbox not told: still waiting by the inbox, named by nothing.
    kept = await inbox();
    kept.conversations[cid]!.checking = true;
    delete kept.conversations[cid]!.revealed;
    await bob.store.set("messaging.preprod", kept);
    const reads = bob.revealReads;
    await synced(bob);
    expect(bob.revealReads).toBe(reads);
    expect((await inbox()).conversations[cid]!.checking).toBeUndefined();
    expect((await bob.messaging.thread("preprod", cid)).conversation.revealed?.name).toBe(ALICE_SEEDELF);
  });

  it("fails one whose proof doesn't verify at once, never naming it, and reads nothing of the chain for it", async () => {
    const { relay, alice, bob } = await pair();
    const wasm = loadTestWasm();
    const cid = await talking(alice, bob);
    const state = (await record(alice, cid))!.state;
    const made = await alice.wallet.withKeys(
      (keys) =>
        JSON.parse(wasm.messagingReveal(keys.seedelf, JSON.stringify({ conversation: state, name: ALICE_SEEDELF, register: alice.own[0]!.register })))
          .reveal as string,
    );
    // z₂'s last bit flipped: still a scalar below q, a proof that no longer verifies, in an honest session message.
    const last = Number.parseInt(made.slice(-2), 16) ^ 1;
    const broken = made.slice(0, -2) + last.toString(16).padStart(2, "0");
    relay.put("preprod", JSON.parse(wasm.messagingSend(JSON.stringify({ conversation: state, plaintext: "02" + broken }))).envelope);
    await synced(bob);
    const thread = await bob.messaging.thread("preprod", cid);
    expect(thread.messages.at(-1)).toMatchObject({ dir: "in", reveal: { status: "failed" } });
    expect(thread.conversation.revealed).toBeUndefined();
    expect(bob.revealReads).toBe(0);
    expect(JSON.stringify(await record(bob, cid))).not.toContain(ALICE_SEEDELF);
  });

  it("takes no reveal from a first-contact message, nor from a request's, and never names one", async () => {
    const { relay, alice, bob } = await pair();
    const wasm = loadTestWasm();
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "hello Bob");
    await alice.messaging.whenIdle();
    const before = (await record(alice, cid))!.state;
    // A request's message of kind 0x02: shown as a reveal that couldn't be verified, before and after the reply.
    const odd = JSON.parse(wasm.messagingSend(JSON.stringify({ conversation: before, plaintext: "02" + "00".repeat(226) })));
    relay.put("preprod", odd.envelope);
    await synced(bob);
    expect((await bob.messaging.request("preprod", cid)).map((m) => m.reveal)).toEqual([undefined, { status: "failed" }]);
    await bob.messaging.accept("preprod", cid);
    await bob.messaging.send("preprod", cid, "hi Alice");
    await bob.messaging.whenIdle();
    await synced(alice);
    expect((await bob.messaging.thread("preprod", cid)).messages[1]!.reveal).toEqual({ status: "failed" });

    // A valid reveal, sealed with Alice's record from before the reply: a first-contact message, F and all.
    const after = (await record(alice, cid))!.state;
    const made = await alice.wallet.withKeys(
      (keys) =>
        JSON.parse(wasm.messagingReveal(keys.seedelf, JSON.stringify({ conversation: after, name: ALICE_SEEDELF, register: alice.own[0]!.register })))
          .reveal as string,
    );
    const skipped = JSON.parse(wasm.messagingSend(JSON.stringify({ conversation: odd.conversation, plaintext: "02" + made })));
    relay.put("preprod", skipped.envelope);
    await synced(bob);
    const thread = await bob.messaging.thread("preprod", cid);
    expect(thread.messages.at(-1)).toMatchObject({ dir: "in", reveal: { status: "failed" } });
    expect(thread.conversation.revealed).toBeUndefined();
    expect(bob.revealReads).toBe(0);
  });
});
