// The wallet's ways out (the 1.10.0 gate's W9). What the inbox shows of a
// conversation is set right from its record; a sync is bound to its phrase
// before it asks anything; a step whose WebAssembly trapped isn't started
// again by itself, and Try again steps over the envelope that did it; one
// envelope whose take throws holds up nothing behind it; a record that can't
// be read can still be deleted, and an inbox that can't be read started
// again; and writing first seals to the register the chain gives the
// Seedelf now, as Send pays one.
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { registerOf } from "../src/background/chain";
import { keptContractView, readContractView } from "../src/background/contract-scan";
import { type Inbox, seedelfRegisterFrom, ShareUsedUp } from "../src/background/messaging";
import { CONVERSATION_RECORDS, PRIVATE_PREFIX } from "../src/background/private-store";
import { outpoint } from "../src/background/spent";
import { koiosPreprod, testBalances, transferPreprod } from "./fakes";
import {
  BOB_SEEDELF,
  busyFor,
  CAROL_SEEDELF,
  cursorOf,
  fileOf,
  loadTestWasm,
  pair,
  party,
  PASSWORD,
  phrase,
  recordName,
  setFileOf,
  synced,
  talking,
  texts,
  turnOn,
  turns,
  type Wasm,
} from "./messaging-harness";

/** The envelope the relay holds `from_end` places from its last, hex. */
const heldAt = (relay: Awaited<ReturnType<typeof pair>>["relay"], fromEnd: number) =>
  Buffer.from(relay.pools.get("preprod")!.held.at(-fromEnd)!.bytes).toString("hex");

/** An envelope's SHA-256, hex: how the skip list names one. */
const sha = (hex: string) => createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");

const gets = (relay: Awaited<ReturnType<typeof pair>>["relay"]) => relay.calls.filter((c) => c.startsWith("GET "));

// Each test bounded: one that fails mid-take fails here, never hangs the run.
describe("what the inbox shows of a conversation (W9)", { timeout: 30_000 }, () => {
  it("counts a reply that came as the worker stopped between its record's write and the inbox's (worker-state#7, cross-feature#5, assumptions-vs-code#7)", async () => {
    const { alice, bob } = await pair();
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "hello Bob");
    await alice.messaging.whenIdle();
    await synced(bob);
    await bob.messaging.accept("preprod", cid);
    await bob.messaging.send("preprod", cid, "hi Alice");
    await bob.messaging.whenIdle();
    // Alice's take of the reply: its record written, and the worker stops before the inbox is.
    const name = await recordName(alice, cid);
    let written = false;
    alice.beforeWrite = (record) => {
      if (record === name) written = true;
      else if (record === "messaging.preprod" && written) throw new Error("stopped");
    };
    await alice.messaging.sync("preprod").catch(() => undefined);
    await alice.messaging.whenIdle();
    alice.beforeWrite = undefined;
    expect(written).toBe(true);
    // The next unlock, in a worker started afresh: its first sync sets the inbox right from the record.
    await alice.wallet.lock();
    await alice.wallet.unlock(PASSWORD);
    alice.restart();
    await synced(alice);
    const listed = (await alice.messaging.overview("preprod")).conversations[0]!;
    const reply = (await fileOf(alice, cid))!.history.at(-1)!;
    expect(reply).toMatchObject({ dir: "in", text: "hi Alice" });
    expect(listed).toMatchObject({ unread: 1, lastAt: reply.at, last: { dir: "in", text: "hi Alice" } });
    // 48 hours on, it's still answered: no "no reply" over a reply.
    await busyFor(49 * 3600_000, alice, bob);
    expect((await alice.messaging.overview("preprod")).conversations[0]!.unanswered).toBe(false);
  });
});

describe("a sync's phrase (W9)", { timeout: 30_000 }, () => {
  it("is bound before the first page is asked: a wallet removed and another restored while it's on its way gets no cursor of the first's (worker-state#8)", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await alice.messaging.send("preprod", cid, "more");
    await alice.messaging.whenIdle();
    const real = relay.fetch;
    let swapped = false;
    relay.fetch = async (url, init) => {
      if (init.method === "GET" && !swapped) {
        swapped = true;
        await bob.wallet.reset();
        await bob.wallet.create(phrase(15), PASSWORD);
      }
      return real(url, init);
    };
    await bob.messaging.sync("preprod").catch(() => undefined);
    await bob.messaging.whenIdle();
    relay.fetch = real;
    expect(swapped).toBe(true);
    expect(await bob.store.get("messaging.preprod")).toBeUndefined();
  });
});

describe("a step whose WebAssembly trapped (W9)", { timeout: 30_000 }, () => {
  it("isn't started again by itself after a take trapped: the overview says it stopped, and Try again steps over the envelope that did it (worker-state#11, cross-feature#9)", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    for (const text of ["before", "the one that traps", "after"]) await alice.messaging.send("preprod", cid, text);
    await alice.messaging.whenIdle();
    const bad = heldAt(relay, 2);
    const wasm = loadTestWasm();
    const trapping: Wasm = {
      ...wasm,
      messagingReceive: (key, request) => {
        if ((JSON.parse(request) as { envelope: string }).envelope === bad) throw new WebAssembly.RuntimeError("unreachable");
        return wasm.messagingReceive(key, request);
      },
    };
    bob.restart(trapping);
    await bob.messaging.sync("preprod");
    await bob.messaging.whenIdle();
    expect(await bob.wallet.state()).toBe("locked");
    // The next unlock, in a worker started afresh on the same module: nothing is read by itself.
    await bob.wallet.unlock(PASSWORD);
    bob.restart(trapping);
    relay.calls.length = 0;
    await bob.messaging.syncAll(["preprod"]);
    await bob.messaging.whenIdle();
    expect(await bob.wallet.state()).toBe("unlocked");
    expect(gets(relay)).toEqual([]);
    expect((await bob.messaging.overview("preprod")).stopped).toBe(true);
    // Nor by a page's poll.
    await synced(bob);
    expect(gets(relay)).toEqual([]);
    // Try again: the envelope that trapped is stepped over, and the rest taken.
    await bob.messaging.retry("preprod");
    await bob.messaging.whenIdle();
    expect(await bob.wallet.state()).toBe("unlocked");
    expect((await texts(bob, cid)).slice(-2)).toEqual(["in:before", "in:after"]);
    expect((await bob.messaging.overview("preprod")).stopped).toBeUndefined();
    // And it stays stepped over: the syncs after read on.
    await synced(bob);
    expect(await bob.wallet.state()).toBe("unlocked");
  });

  it("finds the envelope a scan trapped on at the user's press, scanning that page's alone, then steps over it", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    // An envelope nobody's, that traps the scan of any batch holding it, and Alice's message behind it.
    const junk = "01" + "ee".repeat(511);
    relay.put("preprod", junk);
    await alice.messaging.send("preprod", cid, "behind it");
    await alice.messaging.whenIdle();
    const wasm = loadTestWasm();
    const trapping: Wasm = {
      ...wasm,
      messagingScan: (key, envelopes) => {
        if ((JSON.parse(envelopes) as string[]).includes(junk)) throw new WebAssembly.RuntimeError("unreachable");
        return wasm.messagingScan(key, envelopes);
      },
    };
    bob.restart(trapping);
    await bob.messaging.sync("preprod").catch(() => undefined);
    await bob.messaging.whenIdle();
    expect(await bob.wallet.state()).toBe("locked");
    await bob.wallet.unlock(PASSWORD);
    bob.restart(trapping);
    relay.calls.length = 0;
    await bob.messaging.syncAll(["preprod"]);
    await bob.messaging.whenIdle();
    expect(gets(relay)).toEqual([]);
    expect((await bob.messaging.overview("preprod")).stopped).toBe(true);
    // Try again scans that page's envelopes one at a time: the one that traps does so alone, once more.
    await bob.messaging.retry("preprod").catch(() => undefined);
    await bob.messaging.whenIdle();
    expect(await bob.wallet.state()).toBe("locked");
    await bob.wallet.unlock(PASSWORD);
    bob.restart(trapping);
    await bob.messaging.syncAll(["preprod"]);
    await bob.messaging.whenIdle();
    expect((await bob.messaging.overview("preprod")).stopped).toBe(true);
    // The next Try again steps over it: what's behind it arrives.
    await bob.messaging.retry("preprod");
    await bob.messaging.whenIdle();
    expect(await bob.wallet.state()).toBe("unlocked");
    expect((await texts(bob, cid)).at(-1)).toBe("in:behind it");
    expect((await bob.messaging.overview("preprod")).stopped).toBeUndefined();
  });

  it("steps over the envelope a scan trapped on while a take ran, never the take's (review C)", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await synced(bob);
    await alice.messaging.send("preprod", cid, "one");
    await alice.messaging.whenIdle();
    const one = heldAt(relay, 1);
    // An envelope nobody's, that traps any scan holding it.
    const junk = "01" + "ee".repeat(511);
    const wasm = loadTestWasm();
    const trapping: Wasm = {
      ...wasm,
      messagingScan: (key, envelopes) => {
        if ((JSON.parse(envelopes) as string[]).includes(junk)) throw new WebAssembly.RuntimeError("unreachable");
        return wasm.messagingScan(key, envelopes);
      },
    };
    bob.restart(trapping);
    // The take of "one" is held at its record's write.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let holding = false;
    const record = await recordName(bob, cid);
    bob.beforeWrite = async (name) => {
      if (name !== record || holding) return;
      holding = true;
      await held;
    };
    await bob.messaging.sync("preprod");
    await turns();
    expect(holding).toBe(true);
    // The next tick's read finds the junk while "one" is still being taken: its scan traps.
    relay.put("preprod", junk);
    await bob.messaging.sync("preprod").catch(() => undefined);
    await turns();
    release();
    await bob.messaging.whenIdle();
    bob.beforeWrite = undefined;
    expect(await bob.wallet.state()).toBe("locked");
    // Try again, after each unlock, until "one" arrives: never by stepping over it.
    const skipped = new Set<string>();
    let presses = 0;
    while (!(await bob.wallet.state().then(async (s) => s === "unlocked" && (await texts(bob, cid)).includes("in:one")))) {
      if (presses++ === 3) break;
      if ((await bob.wallet.state()) === "locked") await bob.wallet.unlock(PASSWORD);
      bob.restart(trapping);
      await bob.messaging.retry("preprod").catch(() => undefined);
      await bob.messaging.whenIdle();
      if ((await bob.wallet.state()) === "unlocked") {
        for (const s of (await bob.store.get<Inbox>("messaging.preprod"))!.skip ?? []) skipped.add(s.envelope);
      }
    }
    expect(await bob.wallet.state()).toBe("unlocked");
    expect(await texts(bob, cid)).toContain("in:one");
    // One more lock at the user's press at most: the junk's page scanned alone, then the junk stepped over.
    expect(presses).toBeLessThanOrEqual(2);
    expect([...skipped]).toEqual([sha(junk)]);
    expect(skipped.has(sha(one))).toBe(false);
  });

  it("holds nothing up after a step a closed browser cut short: only a trap stops a network's sync", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await alice.messaging.send("preprod", cid, "arrives");
    await alice.messaging.whenIdle();
    // What a take leaves as the browser closes under it: its mark, and no trap.
    await bob.store.set("messagingTakeMark.preprod" as never, { envelope: "ab".repeat(32) });
    await bob.wallet.lock();
    await bob.wallet.unlock(PASSWORD);
    bob.restart();
    relay.calls.length = 0;
    await bob.messaging.syncAll(["preprod"]);
    await bob.messaging.whenIdle();
    expect(gets(relay).length).toBeGreaterThan(0);
    expect((await bob.messaging.overview("preprod")).stopped).toBeUndefined();
    expect((await texts(bob, cid)).at(-1)).toBe("in:arrives");
  });
});

describe("what runs first at a tick (W13)", { timeout: 30_000 }, () => {
  /** Bob, with mainnet's Messages turned off after a conversation there: records an off network holds. */
  async function offOnMainnet() {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await bob.messaging.switch("mainnet", true);
    await bob.messaging.whenIdle();
    await bob.messaging.start("mainnet", BOB_SEEDELF.replace("626f62", "616c696365"), "on mainnet").catch(() => undefined);
    await bob.messaging.whenIdle();
    await bob.messaging.switch("mainnet", false);
    return { relay, alice, bob, cid };
  }

  it("reads the on networks' pools before it tidies an off one (review D)", async () => {
    const { bob } = await offOnMainnet();
    // A new unlock: the off network's sweep and expiry are due.
    await bob.wallet.lock();
    await bob.wallet.unlock(PASSWORD);
    bob.restart();
    bob.trace.length = 0;
    await bob.messaging.syncAll(["preprod", "mainnet"]);
    await bob.messaging.whenIdle();
    const firstPage = bob.trace.findIndex((s) => s.startsWith("GET "));
    const firstOff = bob.trace.findIndex((s) => s.includes("mainnet"));
    expect(firstPage).toBeGreaterThanOrEqual(0);
    expect(firstOff).toBeGreaterThan(firstPage);
  });

  it("never waits behind a take for an expiry that isn't due: its hour is looked at before the queue (review D)", async () => {
    const { relay, alice, bob, cid } = await offOnMainnet();
    await bob.messaging.syncAll(["preprod", "mainnet"]);
    await bob.messaging.whenIdle();
    await alice.messaging.send("preprod", cid, "one");
    await alice.messaging.whenIdle();
    // The take of "one" holds the queue at its record's write.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let holding = false;
    const record = await recordName(bob, cid);
    bob.beforeWrite = async (name) => {
      if (name !== record || holding) return;
      holding = true;
      await held;
    };
    try {
      await bob.messaging.sync("preprod");
      await turns();
      expect(holding).toBe(true);
      // The next minute's run, with the take still held: its reads, and the off network's tidy, end all the same.
      const before = gets(relay).length;
      const ended = bob.messaging.syncAll(["preprod", "mainnet"]).then(() => true);
      const late = new Promise<boolean>((r) => setTimeout(() => r(false), 2000));
      expect(await Promise.race([ended, late])).toBe(true);
      expect(gets(relay).length).toBeGreaterThan(before);
    } finally {
      release();
    }
    await bob.messaging.whenIdle();
    bob.beforeWrite = undefined;
    expect((await texts(bob, cid)).at(-1)).toBe("in:one");
  });

  it("stops a running take when Messages are started again: nothing it read goes into the new inbox (review K)", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await alice.messaging.send("preprod", cid, "one");
    await alice.messaging.whenIdle();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let holding = false;
    const record = await recordName(bob, cid);
    bob.beforeWrite = async (name) => {
      if (name !== record || holding) return;
      holding = true;
      await held;
    };
    let cleared: Promise<unknown> | undefined;
    try {
      await bob.messaging.sync("preprod");
      await turns();
      expect(holding).toBe(true);
      // The page's way out, asked while the take is held.
      cleared = bob.messaging.clear("preprod");
      await turns();
    } finally {
      release();
    }
    await cleared;
    await bob.messaging.whenIdle();
    bob.beforeWrite = undefined;
    // The new inbox holds no cursor of the old read's: the next read starts at the pool's oldest.
    expect((await cursorOf(bob))).toBeUndefined();
    relay.calls.length = 0;
    await synced(bob);
    expect(gets(relay)[0]).toBe("GET /messaging/v1/preprod/envelopes");
  });
});

describe("one envelope whose take throws (W9)", { timeout: 30_000 }, () => {
  it("holds up nothing behind it: the ones after it are taken, and the cursor moves past it", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    for (const text of ["one", "breaks", "three"]) await alice.messaging.send("preprod", cid, text);
    await alice.messaging.whenIdle();
    const bad = heldAt(relay, 2);
    const wasm = loadTestWasm();
    bob.restart({
      ...wasm,
      messagingReceive: (key, request) => {
        if ((JSON.parse(request) as { envelope: string }).envelope === bad) throw new Error("not what the module expected");
        return wasm.messagingReceive(key, request);
      },
    });
    // The one throw this test means its take to pass over (the harness's f2 hook fails any other).
    bob.passOverOk = true;
    await synced(bob);
    expect((await texts(bob, cid)).slice(-2)).toEqual(["in:one", "in:three"]);
    expect((await cursorOf(bob))).toBe(relay.pools.get("preprod")!.held.at(-1)!.number.toString());
    expect(bob.passedOver.map((e) => (e as Error).message)).toEqual(["not what the module expected"]);
  });
});

describe("a record that can't be read (W9)", { timeout: 30_000 }, () => {
  it("shows a conversation whose record the crate refuses as one that can't be opened, goes on past it, and deletes it (wasm#6, screens#7)", async () => {
    const { relay, directory, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    const carol = await party(15, relay, directory, CAROL_SEEDELF);
    await turnOn(carol);
    const other = await talking(carol, bob, BOB_SEEDELF);
    // Bob's record of the first holds bytes the crate can't read: a later build's, say.
    const file = (await fileOf(bob, cid))!;
    await setFileOf(bob, cid, { ...file, state: "00" });
    await alice.messaging.send("preprod", cid, "into the void");
    await alice.messaging.whenIdle();
    await carol.messaging.send("preprod", other, "still arrives");
    await carol.messaging.whenIdle();
    await synced(bob);
    expect((await texts(bob, other)).at(-1)).toBe("in:still arrives");
    expect((await bob.messaging.overview("preprod")).conversations.find((c) => c.cid === cid)).toMatchObject({ unreadable: true });
    await expect(bob.messaging.thread("preprod", cid)).rejects.toThrow(/couldn't open its record of a conversation/);
    await bob.messaging.remove("preprod", cid);
    expect((await bob.messaging.overview("preprod")).conversations.map((c) => c.cid)).toEqual([other]);
    expect(await bob.local.keys(PRIVATE_PREFIX + CONVERSATION_RECORDS)).toHaveLength(1);
  });

  it("asks nothing of the relay while the inbox won't open, says so, and starts that network's Messages again when asked (cross-feature#8)", async () => {
    const { relay, alice, bob } = await pair();
    await talking(alice, bob);
    await bob.local.set(PRIVATE_PREFIX + "messaging.preprod", { v: 1, nonce: "A".repeat(32), data: "AAAA" });
    relay.calls.length = 0;
    await bob.messaging.sync("preprod").catch(() => undefined);
    await bob.messaging.whenIdle();
    expect(relay.calls).toEqual([]);
    await expect(bob.messaging.overview("preprod")).rejects.toThrow(/couldn't open its record of your messages/);
    // The page's way out, behind its question: that network's Messages start again, everything of it deleted.
    await bob.messaging.clear("preprod");
    expect(await bob.local.keys(PRIVATE_PREFIX + CONVERSATION_RECORDS + "preprod.")).toEqual([]);
    expect(await bob.messaging.overview("preprod")).toMatchObject({ on: true, conversations: [], requests: [] });
    await synced(bob);
    expect(gets(relay).length).toBeGreaterThan(0);
  });

  it("drops a requests' record the crate can't read: the list still shows, and a first message is still taken", async () => {
    const { relay, directory, alice, bob } = await pair();
    const carol = await party(15, relay, directory, CAROL_SEEDELF);
    await turnOn(carol);
    await carol.messaging.start("preprod", BOB_SEEDELF, "an old request");
    await carol.messaging.whenIdle();
    await synced(bob);
    // Its record is bytes the crate can't read: a later build's, say.
    const inbox = (await bob.store.get<Inbox & { v: number }>("messaging.preprod"))!;
    await bob.store.set("messaging.preprod", { ...inbox, requests: inbox.v === 2 ? "AA==" : "00" });
    bob.restart();
    expect((await bob.messaging.overview("preprod")).requests).toHaveLength(1);
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "a new one");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect((await bob.messaging.overview("preprod")).requests.map((r) => r.cid)).toEqual([cid]);
  });
});

describe("writing first (W9, reactions#7)", { timeout: 30_000 }, () => {
  const NAME = transferPreprod.to;
  const THEIRS = koiosPreprod.contract_utxos.find((u) => u.asset_list?.some((a) => a.asset_name === NAME))!;

  it("seals to the register a contract read finds now, as Send's build pays a Seedelf, never a view kept from before it moved", async () => {
    const t = testBalances();
    await t.wallet.create(phrase(12), PASSWORD);
    const register = seedelfRegisterFrom((network) => readContractView(t.deps, network));
    // The wallet read the contract a moment ago: the view it keeps has the Seedelf at its register.
    await readContractView(t.deps, "preprod");
    expect(await register("preprod", NAME)).toEqual(registerOf(THEIRS));
    // Moved since, within the contract: a later row with its token under another register, the old one spent.
    const datum = THEIRS.inline_datum!.bytes;
    const was = registerOf(THEIRS)!;
    const swapped = datum.replace(was.generator, "G".repeat(96)).replace(was.publicValue, was.generator).replace("G".repeat(96), was.publicValue);
    // In a block past everything the fixtures hold, the wallet's own rows too: a catch-up reads it.
    const moved = {
      ...THEIRS,
      tx_hash: "ab".repeat(32),
      tx_index: 0,
      block_height: 99_999_999,
      inline_datum: { ...THEIRS.inline_datum!, bytes: swapped },
    };
    t.koios.spent.add(outpoint(THEIRS));
    t.koios.added.push(moved);
    t.clock.now += 60_000;
    expect(registerOf(moved)).not.toEqual(was);
    // The view the last reading kept still has the old one, which sw.ts sealed a first message to before: it would
    // reach whoever held the Seedelf then.
    const kept = await t.wallet.withKeys(() => keptContractView(t.session, "preprod"));
    expect(registerOf(kept!.seedelfs[NAME]!)).toEqual(was);
    expect(await register("preprod", NAME)).toEqual(registerOf(moved));
  });
});

describe("continuing a conversation (worker-state#10)", { timeout: 30_000 }, () => {
  it("goes through the worker: the other side reads it as continuing the old one, verified, and the two go on in it", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await bob.messaging.rename("preprod", cid, "Alice");
    const next = await alice.messaging.continueIn("preprod", cid, "the same keys, a new conversation");
    await alice.messaging.whenIdle();
    expect((await alice.messaging.overview("preprod")).conversations.find((c) => c.cid === cid)!.restartedAs).toBe(next);
    await synced(bob);
    expect((await bob.messaging.overview("preprod")).requests).toMatchObject([{ cid: next, continues: { cid, verified: true } }]);
    await bob.messaging.accept("preprod", next);
    expect((await bob.messaging.overview("preprod")).conversations.find((c) => c.cid === next)).toMatchObject({
      role: "responder",
      continues: { cid, verified: true },
      name: "Alice",
    });
    await bob.messaging.send("preprod", next, "the same you");
    await bob.messaging.whenIdle();
    await synced(alice);
    expect(await texts(alice, next)).toEqual(["out:the same keys, a new conversation", "in:the same you"]);
  });
});

describe("a first message's own share, used up (DESIGN-protocol §3.5)", { timeout: 30_000 }, () => {
  it("refuses a text the crate's share has no room for, in words, and keeps nothing of it: it's never the server's refusal (W17)", async () => {
    const { alice } = await pair();
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "first");
    await alice.messaging.whenIdle();
    const wasm = loadTestWasm();
    // The crate's own word, where what the worker counted said there was room.
    alice.restart({ ...wasm, messagingSend: () => JSON.stringify({ refused: "request_full" }) });
    const refused = await alice.messaging.send("preprod", cid, "one too many").catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ShareUsedUp);
    expect(refused).toMatchObject({ code: "request_full", message: "Wait for a reply: until one comes, their wallet takes no more messages from you here." });
    expect(await texts(alice, cid)).toEqual(["out:first"]);
  });
});
