// The review of chunk 55's 55e (2026-11-26): the worker's certificate list, its own certificates and their
// withdrawals, held to what two reviews found. Each test fails on the worker before its fix.
//
// H1: a Seedelf minted while Messages are on is posted before its mint is on the chain the relay reads; the 409 waits
// and goes again, then stops. M1: a pass of the switch's asked before a switch off drops nothing and makes nothing. M2:
// a switch off, or a Seedelf's turn-off, leaves its intent for the next unlock whatever stops it. M3: the copy's room
// never takes the wallet's own, goes by Seedelf, and a press reads the list to its end; the relay's `already` names the
// bytes it holds (F10). L1 to L5, X-L6 and X-L7 as each test says. The review's second round, at the end: a Seedelf
// turned on again keeps its certificate; a mark says its intent; a press's write is its unlock's; a Seedelf the copy let
// go stays unknown; Start Messages again keeps the withdrawals; a first message on a failed read says why; the switch
// turned on whatever its pass does; a parked certificate offers nothing; and a gap mid-list, read to the end.
import type * as WasmTypes from "@seedelf/wasm";
import { describe, expect, it } from "vitest";

import type { RegisterHex } from "../src/background/chain";
import {
  CERTIFICATE_SPACING_MS,
  ListBehind,
  LIST_PAGES_A_READ,
  MOVED_BACKOFF_MS,
  NoCertificate,
  NotListedYet,
  PAUSED_ASK_MS,
  SESSION_READ_AFTER,
} from "../src/background/messaging";
import { rememberRegister } from "../src/background/minted-by";
import { LIST_PAGE_BODY_MAX_BYTES, readCertificatePage } from "../src/background/relay";
import { WalletLocked } from "../src/background/wallet";
import type { NetworkName } from "../src/networks";
import { loadTestWasm } from "./fakes";
import {
  ALICE_SEEDELF,
  another,
  BOB_SEEDELF,
  busyFor,
  CAROL_SEEDELF,
  checkedRelay,
  clock,
  type Directory,
  listed,
  pair,
  party,
  type Party,
  PASSWORD,
  synced,
  talking,
  turnOn,
} from "./messaging-harness";

const CERTIFICATES = "/messaging/v1/preprod/certificates";
const WITHDRAWALS = "/messaging/v1/preprod/withdrawals";

/** Turns of the event loop, with nothing timed: what a held request lets run meanwhile. */
const turns = async (n = 50) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

/** The certificate posts, and the withdrawals' posts, `p`'s worker made. */
const posted = (p: Party) => p.trace.filter((s) => s === `POST ${CERTIFICATES}`).length;
const withdrawn = (p: Party) => p.trace.filter((s) => s === `POST ${WITHDRAWALS}`).length;

/** Whether `p` holds the withdrawals' mark (messaging.ts `markWithdrawals`). */
const marked = (p: Party, network: NetworkName = "preprod") => p.local.data.has(`seedelf.private.messagingWithdraw.${network}`);

/** The list record as stored, its certificates and queue in hex. */
async function listOf(p: Pick<Party, "store">) {
  const stored = await p.store.get<{
    cursor?: string;
    certificates?: string[];
    queue?: Array<{ certificate: string; after: number; withdraw?: true; tries?: number; parked?: number }>;
    trimmed?: true;
    tooOften?: string[];
  }>("messagingList.preprod");
  const hex = (b64: string) => Buffer.from(b64, "base64").toString("hex");
  return {
    cursor: stored?.cursor,
    certificates: (stored?.certificates ?? []).map(hex),
    queue: (stored?.queue ?? []).map((q) => ({ ...q, certificate: hex(q.certificate) })),
    trimmed: stored?.trimmed === true,
    tooOften: stored?.tooOften ?? [],
  };
}

/** What a certificate names, as the WebAssembly checks it. */
function named(certificate: string): { name: string; register: RegisterHex; messaging: string } | undefined {
  const answer = JSON.parse(loadTestWasm().messagingCheckCertificate(JSON.stringify({ network: "preprod", certificate }))) as {
    name: string;
    register: RegisterHex;
    messaging: string;
    refused?: string;
  };
  return answer.refused ? undefined : answer;
}

/** The certificates the relay's list holds for the Seedelf `name`. */
const onList = (relay: ReturnType<typeof checkedRelay>, name: string) => relay.certificatesIn("preprod").filter((c) => named(c)?.name === name);

/** A register of `seedelf`'s, re-randomized. */
function registerOf(wasm: ReturnType<typeof loadTestWasm>, seedelf: WasmTypes.SeedelfKey): RegisterHex {
  const base = seedelf.baseRegister();
  const r = wasm.rerandomize(base);
  try {
    return { generator: r.generator, publicValue: r.publicValue };
  } finally {
    r.free();
    base.free();
  }
}

/**
 * A stranger's Seedelf `name` at a register of a fresh key, and `keys` certificates of it there, each naming a messaging
 * key of its own: one, an ordinary Seedelf's; two, one whose key another holds too.
 */
function strangers(name: string, keys = 1): { register: RegisterHex; certificates: string[] } {
  const wasm = loadTestWasm();
  const seedelf = wasm.SeedelfKey.random();
  try {
    const register = registerOf(wasm, seedelf);
    const certificates = Array.from({ length: keys }, () => {
      const messaging = wasm.MessagingKey.random("preprod");
      try {
        return (JSON.parse(wasm.messagingCertificate(seedelf, messaging, JSON.stringify({ network: "preprod", name, register }))) as { certificate: string })
          .certificate;
      } finally {
        messaging.free();
      }
    });
    return { register, certificates };
  } finally {
    seedelf.free();
  }
}

/** A run of the alarm's, and everything it started. */
async function alarm(p: Party) {
  await p.messaging.syncAll(["preprod", "mainnet"], { alarm: true });
  await p.messaging.whenIdle();
}

/** Holds `relay`'s next request that `holds` picks until the returned release is called. */
function holdNext(relay: ReturnType<typeof checkedRelay>, holds: (url: string, init: RequestInit) => boolean): () => void {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const real = relay.fetch;
  let holding = true;
  relay.fetch = async (url, init) => {
    if (holding && holds(url, init)) {
      holding = false;
      await held;
    }
    return real(url, init);
  };
  return release;
}

describe("H1: a Seedelf minted while Messages are on (protocol.md §21.8)", { timeout: 120_000 }, () => {
  /** Bob, Messages on, then a Seedelf minted here whose mint the relay's view of the chain doesn't show yet. */
  async function minting() {
    const relay = checkedRelay();
    const directory: Directory = new Map();
    const bob = await party(24, relay, directory, BOB_SEEDELF);
    await turnOn(bob);
    const SECOND = BOB_SEEDELF + "02";
    const register = await another(bob);
    directory.set(SECOND, register);
    const chain = { landed: false };
    relay.chain = (_pool, name) => name !== SECOND || chain.landed;
    // Minted here: its pair kept, the kept view not showing it yet (a mint on its way).
    await rememberRegister(bob.store, "preprod", SECOND, register);
    // The take's look at the Seedelfs after a sync asks for the list; the next sync reads it and posts the certificate.
    await synced(bob);
    await synced(bob);
    expect(posted(bob)).toBe(1);
    expect(onList(relay, SECOND)).toEqual([]);
    return { relay, bob, SECOND, register, chain };
  }

  it("goes again once the chain shows the mint: the 409 keeps it queued, 2 minutes on", async () => {
    const { relay, bob, SECOND, chain } = await minting();
    const [waiting] = (await listOf(bob)).queue;
    expect(waiting).toMatchObject({ tries: 1 });
    expect(named(waiting!.certificate)?.name).toBe(SECOND);
    // Before its wait: nothing.
    await busyFor(MOVED_BACKOFF_MS[0]! - 30_000, bob);
    await alarm(bob);
    expect(posted(bob)).toBe(1);
    // The mint on the chain the relay reads: the next post after the wait lands.
    chain.landed = true;
    await busyFor(60_000, bob);
    await alarm(bob);
    expect(posted(bob)).toBe(2);
    expect(onList(relay, SECOND)).toHaveLength(1);
    expect((await listOf(bob)).queue).toEqual([]);
  });

  it("stops after its waits for a pair that never appears, and goes again only in a later unlock whose view holds it", async () => {
    const { relay, bob, SECOND, register, chain } = await minting();
    for (const wait of MOVED_BACKOFF_MS) {
      await busyFor(wait + 1000, bob);
      await alarm(bob);
    }
    expect(posted(bob)).toBe(1 + MOVED_BACKOFF_MS.length);
    expect((await listOf(bob)).queue).toMatchObject([{ parked: expect.any(Number) }]);
    // Hours of the alarm, then a lock and an unlock whose view still doesn't hold it: nothing.
    for (let i = 0; i < 4; i++) {
      await busyFor(60 * 60_000, bob);
      await alarm(bob);
    }
    await bob.wallet.lock();
    await bob.wallet.unlock(PASSWORD);
    await alarm(bob);
    expect(posted(bob)).toBe(1 + MOVED_BACKOFF_MS.length);
    // A later unlock whose view holds it, its mint on the chain: posted, and listed.
    bob.own.push({ name: SECOND, register });
    chain.landed = true;
    await bob.wallet.lock();
    await bob.wallet.unlock(PASSWORD);
    await alarm(bob);
    expect(posted(bob)).toBe(2 + MOVED_BACKOFF_MS.length);
    expect(onList(relay, SECOND)).toHaveLength(1);
  });
});

describe("M1: a pass asked before a switch off (protocol.md §21.7)", { timeout: 120_000 }, () => {
  it("drops no withdrawal and makes no certificate: a Seedelf's turn-on pending as the switch goes off", async () => {
    const relay = checkedRelay();
    const directory: Directory = new Map();
    const bob = await party(24, relay, directory, BOB_SEEDELF, { certificateSpacing: () => 5 * 60_000 });
    await turnOn(bob);
    expect(relay.certificatesIn("preprod")).toHaveLength(1);
    const SECOND = BOB_SEEDELF + "02";
    const second = await another(bob);
    bob.own.push({ name: SECOND, register: second });
    directory.set(SECOND, second);
    // The turn-on's list read held until the switch off has been asked.
    const release = holdNext(relay, (url, init) => init.method === "GET" && url.includes("/certificates"));
    const on = bob.messaging.answerAt("preprod", SECOND, second, true);
    await turns();
    const off = bob.messaging.switch("preprod", false);
    await turns();
    expect((await bob.preferences.get()).messaging.preprod).toBe(false);
    release();
    await Promise.all([on, off]);
    await bob.messaging.whenIdle();
    for (let i = 0; i < 4; i++) {
      await busyFor(10 * 60_000, bob);
      await alarm(bob);
    }
    expect(withdrawn(bob)).toBe(1);
    expect(relay.certificatesIn("preprod")).toEqual([]);
    // Nothing made for the Seedelf turned on with the switch off, nor posted.
    expect((await listOf(bob)).queue).toEqual([]);
    expect(posted(bob)).toBe(0);
    expect(marked(bob)).toBe(false);
  });

  it("drops no withdrawal: a switch off during an unlock's first sync, its list read on its way", async () => {
    const relay = checkedRelay();
    const bob = await party(24, relay, new Map(), BOB_SEEDELF, { certificateSpacing: () => 5 * 60_000 });
    await turnOn(bob);
    await bob.wallet.lock();
    await bob.wallet.unlock(PASSWORD);
    const release = holdNext(relay, (url, init) => init.method === "GET" && url.includes("/certificates"));
    const run = bob.messaging.syncAll(["preprod", "mainnet"]);
    await turns();
    const off = bob.messaging.switch("preprod", false);
    await turns();
    release();
    await Promise.all([run, off]);
    await bob.messaging.whenIdle();
    for (let i = 0; i < 4; i++) {
      await busyFor(10 * 60_000, bob);
      await alarm(bob);
    }
    expect(withdrawn(bob)).toBe(1);
    expect(relay.certificatesIn("preprod")).toEqual([]);
  });
});

describe("M2: the intent to withdraw outlives a lock or a worker stop", { timeout: 120_000 }, () => {
  it("a switch off while a lane runs, then a lock before its withdrawals are queued: they go after the unlock", async () => {
    const relay = checkedRelay();
    const bob = await party(24, relay, new Map(), BOB_SEEDELF);
    await turnOn(bob);
    const release = holdNext(relay, (url, init) => init.method === "GET" && url.includes("/envelopes"));
    const run = bob.messaging.sync("preprod");
    await turns();
    const off = bob.messaging.switch("preprod", false).catch(() => undefined);
    await turns();
    await bob.wallet.lock();
    release();
    await Promise.all([run.catch(() => undefined), off]);
    await bob.messaging.whenIdle();
    // Off, and the intent kept through the lock with no key.
    expect((await bob.preferences.get()).messaging.preprod).toBe(false);
    expect(marked(bob)).toBe(true);
    expect(withdrawn(bob)).toBe(0);
    await busyFor(60_000, bob);
    await bob.wallet.unlock(PASSWORD);
    await bob.messaging.syncAll(["preprod", "mainnet"]);
    await bob.messaging.whenIdle();
    expect(withdrawn(bob)).toBe(1);
    expect(relay.certificatesIn("preprod")).toEqual([]);
    expect(marked(bob)).toBe(false);
  });

  it("a Seedelf's turn-off whose withdrawal never reached the record (a worker stopped): the next worker queues it", async () => {
    const relay = checkedRelay();
    const bob = await party(24, relay, new Map(), BOB_SEEDELF);
    await turnOn(bob);
    // A worker stopped before the list's record was written, and the relay out of reach for what it had in memory.
    let stopped = true;
    bob.beforeWrite = (name) => {
      if (stopped && name === "messagingList.preprod") throw new Error("the worker stopped");
    };
    relay.up = false;
    await bob.messaging.answerAt("preprod", BOB_SEEDELF, bob.own[0]!.register, false);
    await bob.messaging.whenIdle();
    expect((await listOf(bob)).queue).toEqual([]);
    expect(marked(bob)).toBe(true);
    // A new worker, the relay back.
    stopped = false;
    relay.up = true;
    bob.restart();
    bob.trace.length = 0;
    await bob.messaging.syncAll(["preprod", "mainnet"]);
    await bob.messaging.whenIdle();
    expect(withdrawn(bob)).toBe(1);
    expect(onList(relay, BOB_SEEDELF)).toEqual([]);
    expect(marked(bob)).toBe(false);
  });
});

describe("M3: the copy's room, the relay's `already` and reading to the end (protocol.md §21.7)", { timeout: 120_000 }, () => {
  it("never evicts the wallet's own: a turn-off past the room withdraws the certificate the relay lists", async () => {
    const relay = checkedRelay();
    // Room for about three certificates.
    const bob = await party(24, relay, new Map(), BOB_SEEDELF, { listRoomBytes: 1400 });
    await turnOn(bob);
    const [mine] = relay.certificatesIn("preprod");
    for (let i = 0; i < 6; i++) relay.putCertificate("preprod", strangers("5eed0e1f00" + "7300" + i.toString(16).padStart(2, "0")).certificates[0]!);
    await bob.wallet.lock();
    await bob.wallet.unlock(PASSWORD);
    await bob.messaging.syncAll(["preprod", "mainnet"]);
    await bob.messaging.whenIdle();
    // Its own kept on the copy, the strangers' gone past the room: nothing made or posted again.
    const copy = await listOf(bob);
    expect(copy.certificates).toContain(mine);
    expect(copy.trimmed).toBe(true);
    expect(posted(bob)).toBe(0);
    await bob.messaging.switch("preprod", false);
    await bob.messaging.whenIdle();
    expect(relay.certificatesIn("preprod")).not.toContain(mine);
  });

  it("takes the bytes the relay's `already` names: the copy reads the list again from its start, and the turn-off withdraws those", async () => {
    const relay = checkedRelay();
    const bob = await party(24, relay, new Map(), BOB_SEEDELF);
    await turnOn(bob);
    const [mine] = relay.certificatesIn("preprod");
    // The copy without it, its cursor past it, at the list's end: a copy lost, then read again past where it was.
    const stored = (await bob.store.get<{ certificates: string[] }>("messagingList.preprod"))!;
    const last = relay.lists.get("preprod")!.entries.at(-1)!.number;
    await bob.store.set("messagingList.preprod", { ...stored, certificates: [], cursor: String(last) });
    await bob.wallet.lock();
    await bob.wallet.unlock(PASSWORD);
    bob.restart();
    await bob.messaging.syncAll(["preprod", "mainnet"]);
    await bob.messaging.whenIdle();
    // Made again, and answered `already`, naming the bytes listed: those aren't put on the copy as if listed.
    expect(posted(bob)).toBe(1);
    expect(relay.certificatesIn("preprod")).toEqual([mine]);
    // The next sync reads the list from its start, and finds them.
    await synced(bob);
    expect(bob.trace).toContain(`GET ${CERTIFICATES}`);
    expect((await listOf(bob)).certificates).toEqual([mine]);
    await bob.messaging.switch("preprod", false);
    await bob.messaging.whenIdle();
    expect(relay.certificatesIn("preprod")).toEqual([]);
  });

  it("evicts a Seedelf's certificates together: a reader never holds one of two m_S without the other, and refuses", async () => {
    const relay = checkedRelay();
    const directory: Directory = new Map();
    const alice = await party(12, relay, directory, ALICE_SEEDELF);
    await turnOn(alice);
    // A stranger's Seedelf with two keys' certificates, the first oldest, the second newest, strangers' between.
    const { register, certificates } = strangers(CAROL_SEEDELF, 2);
    directory.set(CAROL_SEEDELF, register);
    relay.putCertificate("preprod", certificates[0]!);
    for (let i = 0; i < 6; i++) relay.putCertificate("preprod", strangers("5eed0e1f00" + "7400" + i.toString(16).padStart(2, "0")).certificates[0]!);
    relay.putCertificate("preprod", certificates[1]!);
    alice.restart(undefined, { listRoomBytes: 2400 });
    await expect(alice.messaging.start("preprod", CAROL_SEEDELF, "which key?")).rejects.toThrow(NoCertificate);
    const copy = (await listOf(alice)).certificates;
    expect(copy.includes(certificates[0]!)).toBe(copy.includes(certificates[1]!));
    expect(copy).not.toContain(certificates[1]!);
    expect((await alice.messaging.overview("preprod")).conversations).toEqual([]);
  });

  it("reads the list to its end at a first message, past one read's pages, and says to try again past a press's", async () => {
    const { relay, directory, alice } = await pair();
    relay.listPageCount = 1;
    // A read's pages and a few more of strangers', then Carol's last.
    for (let i = 0; i < LIST_PAGES_A_READ + 4; i++) relay.putCertificate("preprod", strangers("5eed0e1f00" + "7500" + i.toString(16).padStart(2, "0")).certificates[0]!);
    const carol = await party(15, relay, directory, CAROL_SEEDELF);
    await listed(relay, carol, CAROL_SEEDELF, carol.own[0]!.register);
    const cid = await alice.messaging.start("preprod", CAROL_SEEDELF, "found at the end");
    expect(cid).toEqual(expect.any(String));
    // Past a press's two reads: nothing decided, nothing written, and the next press goes on from where it ended.
    for (let i = 0; i < 2 * LIST_PAGES_A_READ + 2; i++) relay.putCertificate("preprod", strangers("5eed0e1f00" + "7600" + i.toString(16).padStart(2, "0")).certificates[0]!);
    const dave = strangers("5eed0e1f00" + "64617665");
    directory.set("5eed0e1f00" + "64617665", dave.register);
    relay.putCertificate("preprod", dave.certificates[0]!);
    const before = (await alice.messaging.overview("preprod")).conversations.length;
    await expect(alice.messaging.start("preprod", "5eed0e1f00" + "64617665", "too far")).rejects.toThrow(ListBehind);
    expect((await alice.messaging.overview("preprod")).conversations).toHaveLength(before);
    await alice.messaging.start("preprod", "5eed0e1f00" + "64617665", "pressed again");
    expect((await alice.messaging.overview("preprod")).conversations).toHaveLength(before + 1);
  });

  it("takes a `new` whose digest isn't its bytes' as an answer it doesn't know: nothing on the copy, posted again", async () => {
    const relay = checkedRelay();
    const bob = await party(24, relay, new Map(), BOB_SEEDELF);
    const real = relay.fetch;
    let lying = true;
    relay.fetch = async (url, init) => {
      if (lying && init.method === "POST" && url.includes("/certificates")) {
        lying = false;
        return new Response(JSON.stringify({ kept: "new", digest: "00".repeat(32) }), { status: 200 });
      }
      return real(url, init);
    };
    await turnOn(bob);
    expect((await listOf(bob)).certificates).toEqual([]);
    expect((await listOf(bob)).queue).toHaveLength(1);
    await busyFor(2 * 60_000, bob);
    await alarm(bob);
    expect(relay.certificatesIn("preprod")).toHaveLength(1);
    expect((await listOf(bob)).certificates).toEqual(relay.certificatesIn("preprod"));
  });
});

describe("check 3″: a Seedelf withdrawn too often at its register", { timeout: 60_000 }, () => {
  it("is marked, not posted again, and the overview says so", async () => {
    const relay = checkedRelay();
    relay.withdrawnMost = 1;
    const bob = await party(24, relay, new Map(), BOB_SEEDELF);
    await turnOn(bob);
    await bob.messaging.switch("preprod", false);
    await bob.messaging.whenIdle();
    await bob.messaging.switch("preprod", true);
    await bob.messaging.whenIdle();
    expect(posted(bob)).toBe(1);
    expect(relay.certificatesIn("preprod")).toEqual([]);
    expect((await bob.messaging.overview("preprod")).seedelfs).toMatchObject([{ name: BOB_SEEDELF, on: true, tooOften: true }]);
    // Not again: another unlock's list read and its pass post nothing.
    await bob.wallet.lock();
    await bob.wallet.unlock(PASSWORD);
    await alarm(bob);
    expect(posted(bob)).toBe(1);
  });
});

describe("L1: Show my Seedelf goes once its certificate is listed (protocol.md §21.8)", { timeout: 120_000 }, () => {
  it("posts it first no sooner than the spacing after the last, says to try again, and goes once it's listed", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    const [was] = onList(relay, ALICE_SEEDELF);
    relay.removeCertificate("preprod", was!);
    const stored = (await alice.store.get<{ certificates: string[] }>("messagingList.preprod"))!;
    await alice.store.set("messagingList.preprod", { ...stored, certificates: stored.certificates.filter((c) => Buffer.from(c, "base64").toString("hex") !== was) });
    // The worker's own spacing: her last post, at the switch, was a moment ago.
    alice.restart(undefined, { certificateSpacing: () => CERTIFICATE_SPACING_MS.least });
    alice.trace.length = 0;
    const early = alice.messaging.reveal("preprod", cid, ALICE_SEEDELF);
    await expect(early).rejects.toThrow(NotListedYet);
    await expect(early).rejects.toThrow("Your Seedelf is still being listed. Try again in a few minutes.");
    await alice.messaging.whenIdle();
    expect(alice.trace.filter((s) => s.startsWith("POST "))).toEqual([]);
    // After the spacing, the alarm posts it; then the reveal goes, carrying it.
    await busyFor(CERTIFICATE_SPACING_MS.least + 1000, alice);
    await alarm(alice);
    const [now] = onList(relay, ALICE_SEEDELF);
    expect(now).toBeDefined();
    await alice.messaging.reveal("preprod", cid, ALICE_SEEDELF);
    await alice.messaging.whenIdle();
    await synced(bob);
    await bob.messaging.checkReveals("preprod", cid);
    expect((await bob.messaging.thread("preprod", cid)).conversation.revealed?.name).toBe(ALICE_SEEDELF);
  });

  it("leaves a reveal unchecked at the reader's press where its Seedelf's certificates went past the copy's room", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await alice.messaging.reveal("preprod", cid, ALICE_SEEDELF);
    await alice.messaging.whenIdle();
    await synced(bob);
    // Strangers' certificates past Bob's room: Alice's, the oldest that isn't his own, goes.
    for (let i = 0; i < 6; i++) relay.putCertificate("preprod", strangers("5eed0e1f00" + "7700" + i.toString(16).padStart(2, "0")).certificates[0]!);
    bob.restart(undefined, { listRoomBytes: 1800 });
    await bob.messaging.checkReveals("preprod", cid);
    expect((await listOf(bob)).trimmed).toBe(true);
    expect((await bob.messaging.thread("preprod", cid)).messages.at(-1)).toMatchObject({ reveal: { status: "unchecked" } });
  });
});

describe("L2: the overview never waits at the gate for the list record", { timeout: 60_000 }, () => {
  it("answers while a lane runs, reading the record with no turn at the gate", async () => {
    const { relay, bob } = await pair();
    bob.restart();
    // A sync and a first overview with no view kept: the inbox, the reads and the takes held, the list record not read.
    bob.keptView = false;
    await synced(bob);
    await bob.messaging.overview("preprod");
    bob.keptView = true;
    // The list's copy not in memory, as in a worker that hasn't needed it since it started: the next lane's first
    // steps (its reads) come before it's held.
    (bob.messaging as unknown as { lists: Map<string, unknown> }).lists.clear();
    const release = holdNext(relay, (url, init) => init.method === "GET" && url.includes("/envelopes"));
    const run = bob.messaging.sync("preprod");
    await turns();
    const answered = await Promise.race([bob.messaging.overview("preprod").then(() => "answered"), turns(400).then(() => "waited")]);
    release();
    await run;
    expect(answered).toBe("answered");
  });
});

describe("L3: a press's list read belongs to its unlock", { timeout: 60_000 }, () => {
  it("refuses a first message as a lock refuses it where the unlock ended during its list read", async () => {
    const { relay, alice } = await pair();
    const release = holdNext(relay, (url, init) => init.method === "GET" && url.includes("/certificates"));
    const press = alice.messaging.start("preprod", BOB_SEEDELF, "across an unlock").catch((e: unknown) => e);
    await turns();
    await alice.wallet.lock();
    await alice.wallet.unlock(PASSWORD);
    release();
    expect(await press).toBeInstanceOf(WalletLocked);
    await alice.messaging.whenIdle();
    expect((await alice.messaging.overview("preprod")).conversations).toEqual([]);
  });

  it("refuses a Seedelf's turn-on as a lock refuses it where the unlock ended during its list read", async () => {
    const { relay, directory, bob } = await pair();
    const SECOND = BOB_SEEDELF + "02";
    const second = await another(bob);
    bob.own.push({ name: SECOND, register: second });
    directory.set(SECOND, second);
    const release = holdNext(relay, (url, init) => init.method === "GET" && url.includes("/certificates"));
    const press = bob.messaging.answerAt("preprod", SECOND, second, true).catch((e: unknown) => e);
    await turns();
    await bob.wallet.lock();
    await bob.wallet.unlock(PASSWORD);
    release();
    expect(await press).toBeInstanceOf(WalletLocked);
    await bob.messaging.whenIdle();
    expect((await bob.messaging.overview("preprod")).seedelfs?.find((s) => s.name === SECOND)?.on).toBe(false);
  });
});

describe("L4: what waits to be posted for a pair that takes no first messages now", { timeout: 120_000 }, () => {
  it("leaves the queue at the next pass: a Seedelf the view no longer holds is never posted", async () => {
    const relay = checkedRelay();
    const directory: Directory = new Map();
    const bob = await party(24, relay, directory, BOB_SEEDELF, { certificateSpacing: () => 5 * 60_000 });
    const SECOND = BOB_SEEDELF + "02";
    const second = await another(bob);
    bob.own.push({ name: SECOND, register: second });
    directory.set(SECOND, second);
    await rememberRegister(bob.store, "preprod", SECOND, second);
    await turnOn(bob);
    // Bob's posted, the second's waiting its turn.
    expect(relay.certificatesIn("preprod")).toHaveLength(1);
    expect((await listOf(bob)).queue).toHaveLength(1);
    // Seen by the view, then moved away: its pair is gone.
    await synced(bob);
    bob.own.splice(1, 1);
    await synced(bob);
    await bob.wallet.lock();
    await bob.wallet.unlock(PASSWORD);
    await bob.messaging.syncAll(["preprod", "mainnet"]);
    await bob.messaging.whenIdle();
    for (let i = 0; i < 3; i++) {
      await busyFor(10 * 60_000, bob);
      await alarm(bob);
    }
    expect(onList(relay, SECOND)).toEqual([]);
    expect((await listOf(bob)).queue).toEqual([]);
  });
});

describe("L5: the alarm and the list page's bound", { timeout: 60_000 }, () => {
  it("keeps the alarm on while another network's withdrawals wait", async () => {
    const relay = checkedRelay();
    const bob = await party(24, relay, new Map(), BOB_SEEDELF);
    await turnOn(bob);
    await bob.messaging.switch("mainnet", true);
    await bob.messaging.whenIdle();
    // Preprod's withdrawal waits, the relay out of reach.
    relay.up = false;
    await bob.messaging.switch("preprod", false);
    await bob.messaging.whenIdle();
    expect(marked(bob)).toBe(true);
    await bob.messaging.switch("mainnet", false);
    await bob.messaging.whenIdle();
    expect(bob.alarm.on).toBe(true);
    relay.up = true;
    await alarm(bob);
    expect(relay.certificatesIn("preprod")).toEqual([]);
    expect(bob.alarm.on).toBe(false);
  });

  it("reads a page of short entries of a kind it doesn't know, skipping them, never refusing the page", () => {
    const count = 30_000;
    const page = new Uint8Array(13 + 3 * count);
    const view = new DataView(page.buffer);
    page[0] = 1;
    view.setBigUint64(2, 77n);
    page[10] = 4;
    view.setUint16(11, count);
    for (let i = 0; i < count; i++) page[13 + 3 * i] = 0x7f;
    expect(page.length).toBeLessThanOrEqual(LIST_PAGE_BODY_MAX_BYTES);
    expect(readCertificatePage(page)).toEqual({ more: false, gap: false, cursor: "77", price: 4, entries: [] });
  });
});

describe("X-L6, X-L7: a withdrawal waits until it's done", { timeout: 120_000 }, () => {
  for (const [what, answer] of [
    ["a 404 that isn't the relay's own words", () => new Response("not found", { status: 404 })],
    ["a 400", () => new Response(JSON.stringify({ error: "not a withdrawal" }), { status: 400 })],
  ] as const) {
    it(`goes again after ${what}, the switch off`, async () => {
      const { relay, bob } = await pair();
      const real = relay.fetch;
      let refusing = true;
      relay.fetch = async (url, init) => (refusing && url.includes("/withdrawals") ? answer() : real(url, init));
      await bob.messaging.switch("preprod", false);
      await bob.messaging.whenIdle();
      expect(withdrawn(bob)).toBe(1);
      expect((await listOf(bob)).queue).toMatchObject([{ withdraw: true, tries: 1 }]);
      expect(marked(bob)).toBe(true);
      refusing = false;
      await busyFor(MOVED_BACKOFF_MS[0]! + 1000, bob);
      await alarm(bob);
      expect(withdrawn(bob)).toBe(2);
      expect(onList(relay, BOB_SEEDELF)).toEqual([]);
      expect(marked(bob)).toBe(false);
    });
  }

  it("goes again an hour after the relay's 410, the switch off: the post is the probe", async () => {
    const { relay, bob } = await pair();
    const real = relay.fetch;
    let stopped = true;
    relay.fetch = async (url, init) =>
      stopped && url.includes("/withdrawals") ? new Response(JSON.stringify({ error: "stopped" }), { status: 410 }) : real(url, init);
    await bob.messaging.switch("preprod", false);
    await bob.messaging.whenIdle();
    expect(withdrawn(bob)).toBe(1);
    stopped = false;
    await busyFor(PAUSED_ASK_MS / 2, bob);
    await alarm(bob);
    expect(withdrawn(bob)).toBe(1);
    await busyFor(PAUSED_ASK_MS / 2 + 60_000, bob);
    await alarm(bob);
    expect(withdrawn(bob)).toBe(2);
    expect(onList(relay, BOB_SEEDELF)).toEqual([]);
  });
});

describe("the review's second round", { timeout: 180_000 }, () => {
  it("1: a Seedelf turned off, then on again while the list can't be read, keeps its certificate listed", async () => {
    const relay = checkedRelay();
    const bob = await party(24, relay, new Map(), BOB_SEEDELF, { certificateSpacing: () => 5 * 60_000 });
    await turnOn(bob);
    const [listedNow] = relay.certificatesIn("preprod");
    const register = bob.own[0]!.register;
    await bob.messaging.answerAt("preprod", BOB_SEEDELF, register, false);
    await bob.messaging.whenIdle();
    relay.up = false;
    // Every read of the inbox after the press's own fails, so the pass that follows its step does nothing: the step's
    // own write is what holds.
    const get = bob.local.get.bind(bob.local) as (key: string) => Promise<unknown>;
    let reads = 0;
    let failing = true;
    (bob.local as unknown as { get: (key: string) => Promise<unknown> }).get = async (key: string) => {
      if (failing && key === "seedelf.private.messaging.preprod" && ++reads > 1) throw new Error("the area failed");
      return get(key);
    };
    await bob.messaging.answerAt("preprod", BOB_SEEDELF, register, true);
    await bob.messaging.whenIdle();
    failing = false;
    expect(reads).toBeGreaterThan(1);
    relay.up = true;
    // A new worker, which holds no inbox in memory: what the turn-on's own step wrote is all there is.
    bob.restart();
    for (let i = 0; i < 3; i++) {
      await busyFor(6 * 60_000, bob);
      await alarm(bob);
    }
    expect(withdrawn(bob)).toBe(0);
    expect(relay.certificatesIn("preprod")).toEqual([listedNow]);
    expect(marked(bob)).toBe(false);
  });

  it("1: a withdrawal of a Seedelf the inbox says takes messages again isn't posted as it would go", async () => {
    const relay = checkedRelay();
    const bob = await party(24, relay, new Map(), BOB_SEEDELF, { certificateSpacing: () => 5 * 60_000 });
    await turnOn(bob);
    const [listedNow] = relay.certificatesIn("preprod");
    const register = bob.own[0]!.register;
    await bob.messaging.answerAt("preprod", BOB_SEEDELF, register, false);
    await bob.messaging.whenIdle();
    const queued = (await bob.store.get<{ queue?: unknown[] }>("messagingList.preprod"))!.queue!;
    await bob.messaging.answerAt("preprod", BOB_SEEDELF, register, true);
    await bob.messaging.whenIdle();
    // The withdrawal back in the record, as a stop before the turn-on's list write would leave it, and a new worker
    // that has read the inbox.
    const stored = (await bob.store.get<Record<string, unknown>>("messagingList.preprod"))!;
    await bob.store.set("messagingList.preprod", { ...stored, queue: queued });
    bob.restart();
    await bob.messaging.overview("preprod");
    await busyFor(6 * 60_000, bob);
    await alarm(bob);
    expect(withdrawn(bob)).toBe(0);
    expect(relay.certificatesIn("preprod")).toEqual([listedNow]);
    expect((await listOf(bob)).queue).toEqual([]);
  });

  it("2: a mark whose turn-off never reached the inbox stays, until a turn-on undoes it or the turn-off lands", async () => {
    const relay = checkedRelay();
    const bob = await party(24, relay, new Map(), BOB_SEEDELF);
    await turnOn(bob);
    const register = bob.own[0]!.register;
    // The choice's write refused: the press fails, the turn-off kept with its mark.
    let refusing = true;
    bob.beforeWrite = (name) => {
      if (refusing && name === "messaging.preprod") throw new Error("the worker stopped");
    };
    await bob.messaging.answerAt("preprod", BOB_SEEDELF, register, false).catch(() => undefined);
    await bob.messaging.whenIdle();
    refusing = false;
    expect(marked(bob)).toBe(true);
    // A pass at the next unlock, and a new worker's: the choices say otherwise, so the mark stays.
    await bob.wallet.lock();
    await bob.wallet.unlock(PASSWORD);
    bob.restart();
    await bob.messaging.syncAll(["preprod", "mainnet"]);
    await bob.messaging.whenIdle();
    expect(marked(bob)).toBe(true);
    expect(withdrawn(bob)).toBe(0);
    // The turn-off pressed again, landing: withdrawn, the mark cleared.
    await bob.messaging.answerAt("preprod", BOB_SEEDELF, register, false);
    await bob.messaging.whenIdle();
    expect(withdrawn(bob)).toBe(1);
    expect(marked(bob)).toBe(false);
  });

  it("2: a mark whose turn-off never reached the inbox goes with the turn-on that undoes it, nothing withdrawn", async () => {
    const relay = checkedRelay();
    const bob = await party(24, relay, new Map(), BOB_SEEDELF);
    await turnOn(bob);
    const register = bob.own[0]!.register;
    let refusing = true;
    bob.beforeWrite = (name) => {
      if (refusing && name === "messaging.preprod") throw new Error("the worker stopped");
    };
    await bob.messaging.answerAt("preprod", BOB_SEEDELF, register, false).catch(() => undefined);
    await bob.messaging.whenIdle();
    refusing = false;
    await bob.messaging.syncAll(["preprod", "mainnet"]);
    await bob.messaging.whenIdle();
    expect(marked(bob)).toBe(true);
    await bob.messaging.answerAt("preprod", BOB_SEEDELF, register, true);
    await bob.messaging.whenIdle();
    await bob.messaging.syncAll(["preprod", "mainnet"]);
    await bob.messaging.whenIdle();
    expect(marked(bob)).toBe(false);
    expect(withdrawn(bob)).toBe(0);
    expect(onList(relay, BOB_SEEDELF)).toHaveLength(1);
  });

  it("3: a first message whose certificate's look waits at the gate across an unlock is refused as a lock refuses it", async () => {
    const { relay, alice } = await pair();
    // The press's own list read goes; then a sync's lane holds the gate while the wallet locks and unlocks.
    const release = holdNext(relay, (url, init) => init.method === "GET" && url.includes("/envelopes"));
    const lane = alice.messaging.sync("preprod");
    await turns();
    const press = alice.messaging.start("preprod", BOB_SEEDELF, "across the gate").catch((e: unknown) => e);
    await turns(200);
    await alice.wallet.lock();
    await alice.wallet.unlock(PASSWORD);
    release();
    await lane.catch(() => undefined);
    expect(await press).toBeInstanceOf(WalletLocked);
    await alice.messaging.whenIdle();
    expect((await alice.messaging.overview("preprod")).conversations).toEqual([]);
  });

  it("4: a later certificate of a Seedelf the copy's room let go isn't kept alone: a first message to it is refused", async () => {
    const relay = checkedRelay();
    const directory: Directory = new Map();
    const alice = await party(12, relay, directory, ALICE_SEEDELF);
    await turnOn(alice);
    const { register, certificates } = strangers(CAROL_SEEDELF, 2);
    directory.set(CAROL_SEEDELF, register);
    relay.putCertificate("preprod", certificates[0]!);
    for (let i = 0; i < 6; i++) relay.putCertificate("preprod", strangers("5eed0e1f00" + "7800" + i.toString(16).padStart(2, "0")).certificates[0]!);
    alice.restart(undefined, { listRoomBytes: 2400 });
    // The first read lets Carol's go, the oldest.
    await expect(alice.messaging.start("preprod", CAROL_SEEDELF, "first")).rejects.toThrow(NoCertificate);
    expect((await listOf(alice)).certificates).not.toContain(certificates[0]!);
    // Then her second key's, alone on the relay's next page: not kept, and still refused.
    relay.putCertificate("preprod", certificates[1]!);
    await expect(alice.messaging.start("preprod", CAROL_SEEDELF, "second")).rejects.toThrow(NoCertificate);
    expect((await listOf(alice)).certificates).not.toContain(certificates[1]!);
    expect((await alice.messaging.overview("preprod")).conversations).toEqual([]);
  });

  it("5: Start Messages again withdraws what only a deleted choice listed, and keeps the made one listed", async () => {
    const relay = checkedRelay();
    const directory: Directory = new Map();
    const bob = await party(24, relay, directory, BOB_SEEDELF);
    const TURNED = BOB_SEEDELF + "02";
    const turned = await another(bob);
    bob.own.push({ name: TURNED, register: turned });
    directory.set(TURNED, turned);
    await turnOn(bob);
    await bob.messaging.answerAt("preprod", TURNED, turned, true);
    await bob.messaging.whenIdle();
    expect(onList(relay, TURNED)).toHaveLength(1);
    bob.trace.length = 0;
    await bob.messaging.clear("preprod");
    await bob.messaging.whenIdle();
    await alarm(bob);
    expect(withdrawn(bob)).toBe(1);
    expect(onList(relay, TURNED)).toEqual([]);
    expect(onList(relay, BOB_SEEDELF)).toHaveLength(1);
    expect(marked(bob)).toBe(false);
  });

  for (const [why, words, setUp] of [
    [
      "the relay out of reach",
      "Can't reach the server to see whether that Seedelf takes messages. Try again shortly.",
      (relay: ReturnType<typeof checkedRelay>) => {
        const real = relay.fetch;
        relay.fetch = async (url, init) => (url.includes("/certificates") ? Promise.reject(new TypeError("Failed to fetch")) : real(url, init));
      },
    ],
    [
      "the relay's Messages stopped",
      "Messages are paused, so a first message can't be written now.",
      (relay: ReturnType<typeof checkedRelay>) => {
        const real = relay.fetch;
        relay.fetch = async (url, init) =>
          url.includes("/certificates") ? new Response(JSON.stringify({ error: "stopped" }), { status: 410 }) : real(url, init);
      },
    ],
  ] as const) {
    it(`6: a first message isn't written on the copy as last read when the read fails (${why}), and says why`, async () => {
      const { relay, alice } = await pair();
      // The copy holds Bob's certificate from the switch.
      expect((await listOf(alice)).certificates).toHaveLength(2);
      setUp(relay);
      await expect(alice.messaging.start("preprod", BOB_SEEDELF, "on the old copy")).rejects.toThrow(words);
      await alice.messaging.whenIdle();
      expect((await alice.messaging.overview("preprod")).conversations).toEqual([]);
    });
  }

  it("6: a first message isn't written with this address's day of reading used up, nor with the switch off, and says why", async () => {
    const { relay, alice } = await pair();
    const until = clock.now + 60 * 60_000;
    await alice.session.set(SESSION_READ_AFTER, { preprod: until });
    await expect(alice.messaging.start("preprod", BOB_SEEDELF, "today")).rejects.toThrow("This connection has reached its reading limit for the day. Try again later.");
    await alice.session.set(SESSION_READ_AFTER, {});
    await alice.messaging.switch("preprod", false);
    await alice.messaging.whenIdle();
    relay.calls.length = 0;
    await expect(alice.messaging.start("preprod", BOB_SEEDELF, "off")).rejects.toThrow(/Turn Messages on/);
    expect(relay.calls).toEqual([]);
    expect((await alice.messaging.overview("preprod")).conversations).toEqual([]);
  });

  it("7: the switch turned on asks for the list, starts the alarm and reads the pool though its pass fails", async () => {
    const relay = checkedRelay();
    const bob = await party(24, relay, new Map(), BOB_SEEDELF);
    await turnOn(bob);
    relay.up = false;
    await bob.messaging.switch("preprod", false);
    await bob.messaging.whenIdle();
    relay.up = true;
    expect(marked(bob)).toBe(true);
    await bob.alarm.stop();
    // The inbox's next read fails, as a storage area that errors: the pass the switch makes throws.
    const get = bob.local.get.bind(bob.local) as (key: string) => Promise<unknown>;
    let failing = 1;
    (bob.local as unknown as { get: (key: string) => Promise<unknown> }).get = async (key: string) => {
      if (failing > 0 && key === "seedelf.private.messaging.preprod") {
        failing--;
        throw new Error("the area failed");
      }
      return get(key);
    };
    bob.restart();
    bob.trace.length = 0;
    await bob.messaging.switch("preprod", true);
    await bob.messaging.whenIdle();
    expect(failing).toBe(0);
    expect(bob.alarm.on).toBe(true);
    expect(bob.trace.some((s) => s.startsWith("GET /messaging/v1/preprod/envelopes"))).toBe(true);
    expect(bob.trace.some((s) => s.startsWith(`GET ${CERTIFICATES}`))).toBe(true);
  });

  it("a parked certificate (its waits for the chain run out) makes Show my Seedelf offer nothing for it", async () => {
    const relay = checkedRelay();
    const directory: Directory = new Map();
    const alice = await party(12, relay, directory, ALICE_SEEDELF);
    const bob = await party(24, relay, directory, BOB_SEEDELF);
    await turnOn(alice, bob);
    const SECOND = BOB_SEEDELF + "02";
    const register = await another(bob);
    directory.set(SECOND, register);
    relay.chain = (_pool, name) => name !== SECOND;
    await rememberRegister(bob.store, "preprod", SECOND, register);
    await synced(bob);
    await synced(bob);
    for (const wait of MOVED_BACKOFF_MS) {
      await busyFor(wait + 1000, bob, alice);
      await alarm(bob);
    }
    expect((await listOf(bob)).queue).toMatchObject([{ parked: expect.any(Number) }]);
    // Bob writes first to Alice, who replies: his thread offers his Seedelfs listed, never the parked one.
    const cid = await talking(bob, alice, ALICE_SEEDELF);
    const offered = (await bob.messaging.thread("preprod", cid)).seedelfs;
    expect(offered).toContain(BOB_SEEDELF);
    expect(offered).not.toContain(SECOND);
  });

  it("a gap mid-list (the relay renumbered its entries) starts the copy again and reads forward to the list's end", async () => {
    const { relay, directory, alice } = await pair();
    relay.listPageCount = 1;
    for (let i = 0; i < LIST_PAGES_A_READ + 4; i++) relay.putCertificate("preprod", strangers("5eed0e1f00" + "7900" + i.toString(16).padStart(2, "0")).certificates[0]!);
    // One read, its pages short of the end: the copy's cursor is mid-list.
    await (alice.messaging as unknown as { readList(n: NetworkName): Promise<unknown> }).readList("preprod");
    await alice.messaging.whenIdle();
    const mid = (await listOf(alice)).cursor;
    // The relay compacts: every entry renumbered above what it forgot. Carol's comes last.
    relay.renumberList("preprod");
    const carol = await party(15, relay, directory, CAROL_SEEDELF);
    await listed(relay, carol, CAROL_SEEDELF, carol.own[0]!.register);
    alice.trace.length = 0;
    await alice.messaging.start("preprod", CAROL_SEEDELF, "after the renumbering");
    const reads = alice.trace.filter((s) => s.startsWith(`GET ${CERTIFICATES}`));
    expect(reads[0]).toBe(`GET ${CERTIFICATES}?after=${mid}`);
    // One gap, then forward: no read from the start again.
    expect(reads.slice(1).every((r) => r.includes("?after="))).toBe(true);
    expect((await listOf(alice)).certificates.sort()).toEqual(relay.certificatesIn("preprod").sort());
  });
});
