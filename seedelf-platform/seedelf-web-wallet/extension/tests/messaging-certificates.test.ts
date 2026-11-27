// Messages' own key and the relay's certificate list, in the worker (chunk 55's 55e; protocol.md §21.7 and §21.8).
//
// Messages reads, writes and proves with a key of its own, x_m, one a network it's open on, derived at unlock beside
// the Seedelf key and freed at a lock with it (wallet.ts `Keys.messaging`); the Seedelf key makes only a Seedelf's
// certificate. The relay keeps the certificates on a list per pool, which each wallet reads whole and keeps a copy of,
// behind a cursor, removals applied and a gap starting it again. The wallet makes its own at the switch and at a
// Seedelf's turn-on, none where a good one names another key, and posts them apart, from a queue the alarm works. A
// first message is written only on the one good certificate of its Seedelf, refused before any work otherwise; Show my
// Seedelf carries the wallet's own; and a reveal's check verifies only where exactly one good certificate names the
// reveal's m_S.
import type * as WasmTypes from "@seedelf/wasm";
import { describe, expect, it } from "vitest";

import type { RegisterHex } from "../src/background/chain";
import { CERTIFICATE_SPACING_MS, NoCertificate } from "../src/background/messaging";
import { rememberRegister } from "../src/background/minted-by";
import { MESSAGING_NETWORKS, type NetworkName } from "../src/networks";
import { loadTestWasm, memoryArea, testWallet } from "./fakes";
import {
  ALICE_SEEDELF,
  another,
  BOB_SEEDELF,
  BOTH_OPEN,
  busyFor,
  CAROL_SEEDELF,
  certificateOf,
  checkedRelay,
  clock,
  type Directory,
  fakeRelay,
  pair,
  party,
  type Party,
  PASSWORD,
  phrase,
  synced,
  talking,
  turnOn,
  type Wasm,
} from "./messaging-harness";

const CERTIFICATES = "/messaging/v1/preprod/certificates";

/** The list record as stored, its certificates and queue in hex. */
async function listOf(p: Pick<Party, "store">, network: NetworkName = "preprod") {
  const stored = await p.store.get<{
    v: 1;
    cursor?: string;
    certificates?: string[];
    queue?: Array<{ certificate: string; after: number; withdraw?: true }>;
    elsewhere?: string[];
  }>(`messagingList.${network}`);
  const hex = (b64: string) => Buffer.from(b64, "base64").toString("hex");
  return {
    cursor: stored?.cursor,
    certificates: (stored?.certificates ?? []).map(hex),
    queue: (stored?.queue ?? []).map((q) => ({ certificate: hex(q.certificate), after: q.after, ...(q.withdraw ? { withdraw: true } : {}) })),
    elsewhere: stored?.elsewhere ?? [],
  };
}

/** What a certificate names, checked by the WebAssembly's own check: undefined for one that doesn't check. */
function named(certificate: string, network: NetworkName = "preprod"): { name: string; register: RegisterHex; messaging: string } | undefined {
  const answer = JSON.parse(loadTestWasm().messagingCheckCertificate(JSON.stringify({ network, certificate }))) as {
    name: string;
    register: RegisterHex;
    messaging: string;
    refused?: string;
  };
  return answer.refused ? undefined : answer;
}

/** The certificates the relay's list holds for the pair, each checked. */
function onList(relay: ReturnType<typeof fakeRelay>, name: string, register: RegisterHex): Array<{ certificate: string; messaging: string }> {
  return relay.certificatesIn("preprod").flatMap((certificate) => {
    const n = named(certificate);
    return n && n.name === name && n.register.generator === register.generator && n.register.publicValue === register.publicValue
      ? [{ certificate, messaging: n.messaging }]
      : [];
  });
}

/** `p`'s own m_S for its pair, from its messaging key (`messagingValue`). */
async function valueOf(p: Pick<Party, "wallet">, name: string, register: RegisterHex, network: NetworkName = "preprod"): Promise<string> {
  const wasm = loadTestWasm();
  return p.wallet.withKeys((keys) => (JSON.parse(wasm.messagingValue(keys.messaging[network]!, JSON.stringify({ network, name, register }))) as { messaging: string }).messaging);
}

/** A certificate for `p`'s pair that names another key's m_S: `p`'s Seedelf key, a fresh messaging key. */
async function foreignCertificate(p: Pick<Party, "wallet">, name: string, register: RegisterHex): Promise<string> {
  const wasm = loadTestWasm();
  const other = wasm.MessagingKey.random("preprod");
  try {
    return await p.wallet.withKeys(
      (keys) => (JSON.parse(wasm.messagingCertificate(keys.seedelf, other, JSON.stringify({ network: "preprod", name, register }))) as { certificate: string }).certificate,
    );
  } finally {
    other.free();
  }
}

/** The certificate posts `p`'s worker made. */
const posted = (p: Party) => p.trace.filter((s) => s === `POST ${CERTIFICATES}`).length;

/**
 * WebAssembly whose every `messaging*` export notes the keys it was handed, by class and network: what the worker gives
 * Messages to work with.
 */
function recording(calls: Array<{ name: string; keys: string[] }>): Wasm {
  const wasm = loadTestWasm();
  const out: Record<string, unknown> = { ...wasm };
  for (const [name, fn] of Object.entries(wasm)) {
    if (!name.startsWith("messaging") || typeof fn !== "function") continue;
    out[name] = (...args: unknown[]) => {
      const keys = args.flatMap((a) =>
        a instanceof wasm.MessagingKey ? [`messaging:${a.network}`] : a instanceof wasm.SeedelfKey ? ["seedelf"] : [],
      );
      calls.push({ name, keys });
      return (fn as (...a: unknown[]) => unknown)(...args);
    };
  }
  return out as unknown as Wasm;
}

/** A stranger's Seedelf `name`: a register of a fresh key, and its certificate there, from a messaging key of its own. */
function strangersCertificate(name: string): { register: RegisterHex; certificate: string } {
  const wasm = loadTestWasm();
  const seedelf = wasm.SeedelfKey.random();
  const messaging = wasm.MessagingKey.random("preprod");
  try {
    const register = registerOf(wasm, seedelf);
    const { certificate } = JSON.parse(wasm.messagingCertificate(seedelf, messaging, JSON.stringify({ network: "preprod", name, register }))) as {
      certificate: string;
    };
    return { register, certificate };
  } finally {
    messaging.free();
    seedelf.free();
  }
}

/** A register of `seedelf`'s, re-randomized. */
function registerOf(wasm: Wasm, seedelf: WasmTypes.SeedelfKey): RegisterHex {
  const base = seedelf.baseRegister();
  const r = wasm.rerandomize(base);
  try {
    return { generator: r.generator, publicValue: r.publicValue };
  } finally {
    r.free();
    base.free();
  }
}

describe("Messages' own key (wallet.ts `Keys.messaging`)", { timeout: 60_000 }, () => {
  it("is one a network Messages is open on, derived at unlock beside the Seedelf key: a closed network gets none", async () => {
    const wasm = loadTestWasm();
    // As the worker derives them: Messages' networks, preprod alone for now.
    const shipped = testWallet();
    await shipped.wallet.create(phrase(12), PASSWORD);
    await shipped.wallet.withKeys((keys) => {
      expect(Object.keys(keys.messaging)).toEqual([...MESSAGING_NETWORKS]);
      expect(keys.messaging.preprod!.network).toBe("preprod");
      expect(keys.messaging.mainnet).toBeUndefined();
      expect(keys.messaging.preprod).toBeInstanceOf(wasm.MessagingKey);
    });
    // A release that opens both: one each, each its network's, each the phrase's own (protocol.md §21.2).
    const both = testWallet({ local: memoryArea(), session: memoryArea(), clock: { now: clock.now }, messagingNetworks: BOTH_OPEN });
    await both.wallet.create(phrase(12), PASSWORD);
    const seedelf = wasm.SeedelfKey.fromPhrase(phrase(12), 0);
    const register = registerOf(wasm, seedelf);
    seedelf.free();
    for (const network of BOTH_OPEN) {
      const fromPhrase = wasm.MessagingKey.fromPhrase(phrase(12), 0, network);
      const request = JSON.stringify({ network, name: BOB_SEEDELF, register });
      const expected = JSON.parse(wasm.messagingValue(fromPhrase, request)) as { messaging: string };
      fromPhrase.free();
      const held = await both.wallet.withKeys((keys) => {
        expect(keys.messaging[network]!.network).toBe(network);
        return JSON.parse(wasm.messagingValue(keys.messaging[network]!, request)) as { messaging: string };
      });
      expect(held).toEqual(expected);
    }
    // And another network's key is another key: the same Seedelf's m_S isn't the same on both.
    const [pre, main] = await both.wallet.withKeys((keys) =>
      (["preprod", "mainnet"] as const).map((n) => (JSON.parse(wasm.messagingValue(keys.messaging[n]!, JSON.stringify({ network: n, name: BOB_SEEDELF, register }))) as { messaging: string }).messaging),
    );
    expect(pre).not.toBe(main);
  });

  it("is freed at a lock with the rest, and derived again, the same, at the unlock", async () => {
    const wasm = loadTestWasm();
    const t = testWallet();
    await t.wallet.create(phrase(24), PASSWORD);
    const seedelf = wasm.SeedelfKey.fromPhrase(phrase(24), 0);
    const register = registerOf(wasm, seedelf);
    seedelf.free();
    const request = JSON.stringify({ network: "preprod", name: BOB_SEEDELF, register });
    // Held past the wallet's queue, as nothing in the worker holds one (a test's own).
    const old = await t.wallet.withKeys((keys) => keys.messaging.preprod!);
    const before = JSON.parse(wasm.messagingValue(old, request)) as { messaging: string };
    await t.wallet.lock();
    // Freed: its object refuses, as a freed Seedelf key does.
    expect(() => wasm.messagingValue(old, request)).toThrow();
    expect(await t.wallet.unlock(PASSWORD)).toEqual({ unlocked: true });
    const after = await t.wallet.withKeys((keys) => {
      expect(keys.messaging.preprod).not.toBe(old);
      return JSON.parse(wasm.messagingValue(keys.messaging.preprod!, request)) as { messaging: string };
    });
    expect(after).toEqual(before);
  });

  it("is the only key any messaging call is handed, of its own network, but the certificate's, which takes both", async () => {
    const { relay, directory, alice, bob } = await pair();
    const calls: Array<{ name: string; keys: string[] }> = [];
    alice.restart(recording(calls));
    bob.restart(recording(calls));
    // A conversation, a request read, a reveal and its check, and a second Seedelf turned on: a certificate made.
    const cid = await talking(alice, bob);
    const second = await alice.messaging.start("preprod", BOB_SEEDELF, "a request to read");
    await alice.messaging.whenIdle();
    await synced(bob);
    await bob.messaging.request("preprod", second);
    await alice.messaging.reveal("preprod", cid, ALICE_SEEDELF);
    await alice.messaging.whenIdle();
    await synced(bob);
    await bob.messaging.checkReveals("preprod", cid);
    const SECOND = BOB_SEEDELF + "02";
    const register = await another(bob);
    bob.own.push({ name: SECOND, register });
    directory.set(SECOND, register);
    await bob.messaging.answerAt("preprod", SECOND, register, true);
    await bob.messaging.whenIdle();
    expect(onList(relay, SECOND, register)).toHaveLength(1);
    const keyed = new Set(["messagingScan", "messagingOpen", "messagingReceive", "messagingStart", "messagingStartContinuing", "messagingAccept", "messagingReadRequest", "messagingReveal", "messagingValue"]);
    for (const call of calls) {
      if (call.name === "messagingCertificate") expect(call.keys, call.name).toEqual(["seedelf", "messaging:preprod"]);
      else if (keyed.has(call.name)) expect(call.keys, call.name).toEqual(["messaging:preprod"]);
      else expect(call.keys, call.name).toEqual([]);
    }
    const made = new Set(calls.map((c) => c.name));
    for (const name of [...keyed].filter((n) => n !== "messagingStartContinuing")) expect(made, name).toContain(name);
    expect(made).toContain("messagingCertificate");
    expect(made).toContain("messagingCheckReveal");
    expect(made).toContain("messagingCheckCertificate");
  });
});

describe("the certificate list's copy (protocol.md §21.7)", { timeout: 60_000 }, () => {
  it("holds the list's certificates behind its cursor, reads only what's new after it, page by page, and applies removals", async () => {
    const { relay, directory, alice } = await pair();
    const listed0 = await listOf(alice);
    // Both wallets' certificates, the list's own order, the cursor at the list's last entry.
    expect(listed0.certificates.sort()).toEqual(relay.certificatesIn("preprod").sort());
    expect(listed0.cursor).toBe(String(relay.lists.get("preprod")!.next - 1n));
    // Two more Seedelfs turned on, Carol's and a stranger's, a page an entry: Alice's next read asks from her cursor,
    // then from each page's.
    const carol = await party(15, relay, directory, CAROL_SEEDELF);
    await turnOn(carol);
    relay.putCertificate("preprod", strangersCertificate(CAROL_SEEDELF + "02").certificate);
    relay.listPageCount = 1;
    alice.trace.length = 0;
    await alice.messaging.start("preprod", CAROL_SEEDELF, "hello Carol");
    await alice.messaging.whenIdle();
    const next = BigInt(listed0.cursor!);
    expect(alice.trace.filter((s) => s.startsWith(`GET ${CERTIFICATES}`))).toEqual([
      `GET ${CERTIFICATES}?after=${next}`,
      `GET ${CERTIFICATES}?after=${next + 1n}`,
    ]);
    const listed1 = await listOf(alice);
    expect(listed1.certificates).toHaveLength(4);
    expect(listed1.cursor).toBe(String(next + 2n));
    // Carol's certificate taken off the list, a removal in its place: Alice's next read drops it from her copy, and
    // Carol's Seedelf takes no first message from her.
    const [carols] = onList(relay, CAROL_SEEDELF, carol.own[0]!.register);
    relay.removeCertificate("preprod", carols!.certificate);
    await expect(alice.messaging.start("preprod", CAROL_SEEDELF, "again")).rejects.toThrow(NoCertificate);
    const listed2 = await listOf(alice);
    expect(listed2.certificates).toHaveLength(3);
    expect(listed2.certificates).not.toContain(carols!.certificate);
    expect(listed2.cursor).toBe(String(next + 3n));
  });

  it("drops its copy on a gap, and reads the list again from its oldest entry", async () => {
    const { relay, directory, alice } = await pair();
    // Something the list doesn't hold in Alice's copy: a certificate of a stranger's Seedelf, never posted, at the
    // register the chain gives it.
    const { register, certificate: strangers } = strangersCertificate(CAROL_SEEDELF);
    directory.set(CAROL_SEEDELF, register);
    const stored = (await alice.store.get<{ certificates: string[] }>("messagingList.preprod"))!;
    await alice.store.set("messagingList.preprod", { ...stored, certificates: [...stored.certificates, Buffer.from(strangers, "hex").toString("base64")] });
    alice.restart();
    expect((await listOf(alice)).certificates).toContain(strangers);
    // The relay lost entries after Alice's cursor: its next page says so, from the oldest it holds.
    relay.listGapOnce = true;
    await expect(alice.messaging.start("preprod", CAROL_SEEDELF, "to the stranger")).rejects.toThrow(NoCertificate);
    const after = await listOf(alice);
    expect(after.certificates.sort()).toEqual(relay.certificatesIn("preprod").sort());
    expect(after.certificates).not.toContain(strangers);
  });

  it("keeps within its room, its oldest Seedelfs' certificates going first, never the wallet's own", async () => {
    const { relay, directory, alice } = await pair();
    // Eight more certificates on the list, strangers' each.
    for (let i = 0; i < 8; i++) relay.putCertificate("preprod", strangersCertificate("5eed0e1f00" + i.toString(16).padStart(4, "0")).certificate);
    // A Seedelf with none, to read the list for.
    directory.set(CAROL_SEEDELF, strangersCertificate(CAROL_SEEDELF).register);
    const room = 3 * 1024;
    alice.restart(undefined, { listRoomBytes: room });
    await expect(alice.messaging.start("preprod", CAROL_SEEDELF, "nobody")).rejects.toThrow(NoCertificate);
    const stored = (await alice.store.get<unknown>("messagingList.preprod"))!;
    expect(JSON.stringify(stored).length).toBeLessThanOrEqual(room);
    const kept = (await listOf(alice)).certificates;
    const all = relay.certificatesIn("preprod");
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(all.length);
    // Her own, the oldest, kept (the review of 55e, M3); of the rest, the newest.
    const [own] = onList(relay, ALICE_SEEDELF, alice.own[0]!.register);
    expect(kept).toContain(own!.certificate);
    const others = kept.filter((c) => c !== own!.certificate);
    expect(others).toEqual(all.slice(-others.length));
  });
});

describe("the wallet's own certificates (protocol.md §21.8)", { timeout: 120_000 }, () => {
  it("are made at the switch for each Seedelf that takes first messages, good for its pair and its own m_S, and posted once", async () => {
    const { relay, alice, bob } = await pair();
    for (const [p, name] of [
      [alice, ALICE_SEEDELF],
      [bob, BOB_SEEDELF],
    ] as const) {
      const register = p.own[0]!.register;
      expect(onList(relay, name, register)).toEqual([{ certificate: expect.any(String), messaging: await valueOf(p, name, register) }]);
    }
    // Locked and unlocked: the next unlock's first sync reads the list again, and the certificate there is used as it is.
    await bob.wallet.lock();
    await bob.wallet.unlock(PASSWORD);
    bob.trace.length = 0;
    await bob.messaging.syncAll(["preprod"]);
    await bob.messaging.whenIdle();
    expect(bob.trace).toContain(`GET ${CERTIFICATES}?after=${(await listOf(bob)).cursor}`);
    expect(posted(bob)).toBe(0);
    expect(onList(relay, BOB_SEEDELF, bob.own[0]!.register)).toHaveLength(1);
  });

  it("are found on the list by a second browser of the same phrase, which posts none", async () => {
    const { relay, directory, bob } = await pair();
    const register = bob.own[0]!.register;
    // Bob's phrase in another browser, his Seedelf turned on there: the same pair, the same messaging key.
    const again = await party(24, relay, directory);
    again.own.push({ name: BOB_SEEDELF, register });
    await again.messaging.switch("preprod", true);
    await again.messaging.whenIdle();
    await again.messaging.answerAt("preprod", BOB_SEEDELF, register, true);
    await again.messaging.whenIdle();
    expect(posted(again)).toBe(0);
    expect(onList(relay, BOB_SEEDELF, register)).toHaveLength(1);
    expect((await again.messaging.overview("preprod")).seedelfs).toEqual([{ name: BOB_SEEDELF, register, made: false, on: true }]);
  });

  it("post none for a Seedelf whose good certificate names another key, and the overview says so", async () => {
    const relay = checkedRelay();
    const directory: Directory = new Map();
    const alice = await party(12, relay, directory, ALICE_SEEDELF);
    const bob = await party(24, relay, directory, BOB_SEEDELF);
    const register = bob.own[0]!.register;
    // A certificate for Bob's pair under Bob's Seedelf key, naming another messaging key's m_S: another wallet holds x.
    relay.putCertificate("preprod", await foreignCertificate(bob, BOB_SEEDELF, register));
    await turnOn(alice, bob);
    expect(onList(relay, BOB_SEEDELF, register)).toHaveLength(1);
    expect(onList(relay, BOB_SEEDELF, register)[0]!.messaging).not.toBe(await valueOf(bob, BOB_SEEDELF, register));
    expect(relay.calls.filter((c) => c === `POST ${CERTIFICATES}`)).toHaveLength(1);
    expect((await bob.messaging.overview("preprod")).seedelfs).toEqual([{ name: BOB_SEEDELF, register, made: true, on: true, elsewhere: true }]);
    expect((await listOf(bob)).elsewhere).toHaveLength(1);
  });

  it("are spaced through the alarm: the first at once, each next a random wait after the last, none without a run", async () => {
    const relay = checkedRelay();
    const directory: Directory = new Map();
    // The worker's own spacing (CERTIFICATE_SPACING_MS), not the harness's none.
    const bob = await party(24, relay, directory, BOB_SEEDELF, { certificateSpacing: undefined });
    const names = [BOB_SEEDELF, BOB_SEEDELF + "02", BOB_SEEDELF + "03"];
    for (const name of names.slice(1)) {
      const register = await another(bob);
      bob.own.push({ name, register });
      directory.set(name, register);
      await rememberRegister(bob.store, "preprod", name, register);
    }
    const start = clock.now;
    await turnOn(bob);
    const count = () => relay.certificatesIn("preprod").length;
    expect(count()).toBe(1);
    const queue = (await listOf(bob)).queue;
    expect(queue).toHaveLength(2);
    expect(queue[0]!.after).toBeGreaterThanOrEqual(start + CERTIFICATE_SPACING_MS.least);
    expect(queue[0]!.after).toBeLessThanOrEqual(start + CERTIFICATE_SPACING_MS.most);
    expect(queue[1]!.after - queue[0]!.after).toBeGreaterThanOrEqual(CERTIFICATE_SPACING_MS.least);
    // Before the least wait, an alarm's run posts none.
    await busyFor(CERTIFICATE_SPACING_MS.least - 1000, bob);
    await bob.messaging.syncAll(["preprod"], { alarm: true });
    await bob.messaging.whenIdle();
    expect(count()).toBe(1);
    // Past its time, nothing posts it but a run: no timer of its own.
    await busyFor(queue[0]!.after - clock.now + 1000, bob);
    await bob.messaging.whenIdle();
    expect(count()).toBe(1);
    await bob.messaging.syncAll(["preprod"], { alarm: true });
    await bob.messaging.whenIdle();
    expect(count()).toBe(2);
    // The third: never with the second, even long past both their times; then at the next run past its own.
    const third = (await listOf(bob)).queue;
    expect(third).toHaveLength(1);
    expect(third[0]!.after - clock.now).toBeGreaterThanOrEqual(CERTIFICATE_SPACING_MS.least - 1000);
    await busyFor(CERTIFICATE_SPACING_MS.most + 1000, bob);
    await bob.messaging.syncAll(["preprod"], { alarm: true });
    await bob.messaging.whenIdle();
    expect(count()).toBe(3);
    // Each good for its own pair.
    for (const name of names) expect(onList(relay, name, bob.own.find((s) => s.name === name)!.register)).toHaveLength(1);
  });

  it("make one of the wallet's own again where the list no longer holds it, at the next unlock's first sync, and read the list once an unlock", async () => {
    const { relay, bob } = await pair();
    const register = bob.own[0]!.register;
    const [mine] = onList(relay, BOB_SEEDELF, register);
    relay.removeCertificate("preprod", mine!.certificate);
    // In the same unlock, and in a worker Chrome started again in it: the list isn't read again by itself.
    bob.trace.length = 0;
    await synced(bob);
    bob.restart();
    await bob.messaging.syncAll(["preprod"]);
    await bob.messaging.whenIdle();
    expect(bob.trace.filter((s) => s.startsWith(`GET ${CERTIFICATES}`))).toEqual([]);
    expect(onList(relay, BOB_SEEDELF, register)).toEqual([]);
    // The next unlock's first sync reads it, finds its own missing and posts it again: other bytes, the same m_S.
    await bob.wallet.lock();
    await bob.wallet.unlock(PASSWORD);
    await bob.messaging.syncAll(["preprod"]);
    await bob.messaging.whenIdle();
    const now = onList(relay, BOB_SEEDELF, register);
    expect(now).toHaveLength(1);
    expect(now[0]!.certificate).not.toBe(mine!.certificate);
    expect(now[0]!.messaging).toBe(mine!.messaging);
    // And once: the next sync of the same unlock reads nothing of the list.
    bob.trace.length = 0;
    await synced(bob);
    expect(bob.trace.filter((s) => s.startsWith(`GET ${CERTIFICATES}`))).toEqual([]);
  });
});

describe("a first message (protocol.md §21.5, §21.8)", { timeout: 60_000 }, () => {
  /** WebAssembly whose writing and solving exports are counted: none may run for a refused first message. */
  const counting = (used: string[]): Wasm => {
    const wasm = loadTestWasm();
    const count =
      <A extends unknown[], R>(name: string, call: (...args: A) => R) =>
      (...args: A): R => {
        used.push(name);
        return call(...args);
      };
    return {
      ...wasm,
      messagingStart: count("start", wasm.messagingStart),
      messagingFindStamp: count("findStamp", wasm.messagingFindStamp),
      messagingSetStamp: count("setStamp", wasm.messagingSetStamp),
      messagingSend: count("send", wasm.messagingSend),
    };
  };

  it("is refused before any work or post where its Seedelf has no good certificate: the list read, nothing else", async () => {
    const { relay, directory, alice } = await pair();
    // Carol's Seedelf, never turned on: no certificate.
    await party(15, relay, directory, CAROL_SEEDELF);
    const used: string[] = [];
    alice.restart(counting(used));
    const before = await alice.store.get("messaging.preprod");
    alice.trace.length = 0;
    relay.calls.length = 0;
    const refused = alice.messaging.start("preprod", CAROL_SEEDELF, "hello?");
    await expect(refused).rejects.toThrow(NoCertificate);
    await expect(refused).rejects.toMatchObject({ code: "no_certificate", message: "That Seedelf doesn't take messages." });
    await alice.messaging.whenIdle();
    expect(used).toEqual([]);
    expect(relay.calls).toEqual([`GET ${CERTIFICATES}?after=${(await listOf(alice)).cursor}`]);
    expect(alice.trace.filter((s) => s.startsWith("set ") || s.startsWith("POST "))).toEqual([]);
    expect(await alice.store.get("messaging.preprod")).toEqual(before);
    expect((await alice.messaging.overview("preprod")).conversations).toEqual([]);
  });

  it("is refused where the good certificates for its Seedelf name two keys", async () => {
    const { relay, alice, bob } = await pair();
    relay.putCertificate("preprod", await foreignCertificate(bob, BOB_SEEDELF, bob.own[0]!.register));
    expect(onList(relay, BOB_SEEDELF, bob.own[0]!.register)).toHaveLength(2);
    const used: string[] = [];
    alice.restart(counting(used));
    await expect(alice.messaging.start("preprod", BOB_SEEDELF, "which of you?")).rejects.toThrow(NoCertificate);
    expect(used).toEqual([]);
    expect((await alice.messaging.overview("preprod")).conversations).toEqual([]);
  });

  it("is refused where its only certificate is for a register the chain no longer gives it, or doesn't check", async () => {
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const alice = await party(12, relay, directory, ALICE_SEEDELF);
    const bob = await party(24, relay, directory, BOB_SEEDELF);
    const carol = await party(15, relay, directory, CAROL_SEEDELF);
    // Carol's certificate forged (its proof's last byte changed), on a relay that takes any shape: the writer's check.
    const real = await certificateOf(carol, CAROL_SEEDELF, carol.own[0]!.register);
    const forged = real.slice(0, -2) + (Number.parseInt(real.slice(-2), 16) ^ 1).toString(16).padStart(2, "0");
    relay.putCertificate("preprod", forged);
    await turnOn(alice, bob);
    await expect(alice.messaging.start("preprod", CAROL_SEEDELF, "forged")).rejects.toThrow(NoCertificate);
    // Bob's Seedelf moved: the chain gives it a new register, its certificate names the old one.
    directory.set(BOB_SEEDELF, await another(bob));
    await expect(alice.messaging.start("preprod", BOB_SEEDELF, "after the move")).rejects.toThrow(NoCertificate);
    expect((await alice.messaging.overview("preprod")).conversations).toEqual([]);
    // The control: at the register its certificate names, written.
    directory.set(BOB_SEEDELF, bob.own[0]!.register);
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "at the old one");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect((await bob.messaging.overview("preprod")).requests.map((r) => r.cid)).toEqual([cid]);
  });

  it("with the switch off reads nothing: the list as last read is looked at, and a Seedelf it has none of can't be written to", async () => {
    const { relay, directory, alice } = await pair();
    const carol = await party(15, relay, directory, CAROL_SEEDELF);
    await turnOn(carol);
    // Off: her own certificate withdrawn (chunk 55's call 9), and nothing else asked from here.
    await alice.messaging.switch("preprod", false);
    await alice.messaging.whenIdle();
    relay.calls.length = 0;
    // Carol's certificate came after Alice's last read: off, she can't write first to Carol.
    await expect(alice.messaging.start("preprod", CAROL_SEEDELF, "hello")).rejects.toThrow(/Turn Messages on/);
    expect(relay.calls).toEqual([]);
  });
});

describe("Show my Seedelf and its check (protocol.md §19, §21.9)", { timeout: 60_000 }, () => {
  /** WebAssembly whose reveals' requests are kept: what the worker handed `messagingReveal`. */
  const revealing = (asked: Array<{ certificate?: string; network?: string }>): Wasm => {
    const wasm = loadTestWasm();
    return {
      ...wasm,
      messagingReveal: (key, request) => {
        asked.push(JSON.parse(request) as { certificate?: string; network?: string });
        return wasm.messagingReveal(key, request);
      },
    };
  };

  it("carries the wallet's own certificate, the one on the list for its pair, and verifies at the reader's press", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    const asked: Array<{ certificate?: string; network?: string }> = [];
    alice.restart(revealing(asked));
    await alice.messaging.reveal("preprod", cid, ALICE_SEEDELF);
    await alice.messaging.whenIdle();
    const [mine] = onList(relay, ALICE_SEEDELF, alice.own[0]!.register);
    expect(asked).toMatchObject([{ network: "preprod", certificate: mine!.certificate }]);
    await synced(bob);
    bob.trace.length = 0;
    await bob.messaging.checkReveals("preprod", cid);
    // The press: the contract read, then the list's new entries.
    expect(bob.trace.filter((s) => s.startsWith("chain") || s.startsWith(`GET ${CERTIFICATES}`))).toEqual([
      "chain reveal",
      `GET ${CERTIFICATES}?after=${(await listOf(bob)).cursor}`,
    ]);
    expect((await bob.messaging.thread("preprod", cid)).conversation.revealed?.name).toBe(ALICE_SEEDELF);
  });

  it("makes and posts its certificate first where the list's copy has none for the pair", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    const register = alice.own[0]!.register;
    const [was] = onList(relay, ALICE_SEEDELF, register);
    relay.removeCertificate("preprod", was!.certificate);
    // Alice's copy without it either, as a read since the removal would have it.
    const stored = (await alice.store.get<{ certificates: string[] }>("messagingList.preprod"))!;
    await alice.store.set("messagingList.preprod", { ...stored, certificates: stored.certificates.filter((c) => Buffer.from(c, "base64").toString("hex") !== was!.certificate) });
    const asked: Array<{ certificate?: string }> = [];
    alice.restart(revealing(asked));
    alice.trace.length = 0;
    await alice.messaging.reveal("preprod", cid, ALICE_SEEDELF);
    await alice.messaging.whenIdle();
    const posts = alice.trace.filter((s) => s.startsWith("POST "));
    expect(posts).toEqual([`POST ${CERTIFICATES}`, "POST /messaging/v1/preprod/envelopes"]);
    const [now] = onList(relay, ALICE_SEEDELF, register);
    expect(now!.certificate).not.toBe(was!.certificate);
    expect(asked[0]!.certificate).toBe(now!.certificate);
    await synced(bob);
    await bob.messaging.checkReveals("preprod", cid);
    expect((await bob.messaging.thread("preprod", cid)).conversation.revealed?.name).toBe(ALICE_SEEDELF);
  });

  it("is refused for a Seedelf whose good certificate names another key", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    relay.putCertificate("preprod", await foreignCertificate(alice, ALICE_SEEDELF, alice.own[0]!.register));
    // Alice's copy reads it at her next read of the list (a first message's press).
    await alice.messaging.start("preprod", BOB_SEEDELF, "reads the list").catch(() => undefined);
    await alice.messaging.whenIdle();
    expect((await alice.messaging.thread("preprod", cid)).seedelfs).toBeUndefined();
    await expect(alice.messaging.reveal("preprod", cid, ALICE_SEEDELF)).rejects.toThrow(/A key not in this wallet takes this Seedelf's messages/);
  });

  for (const [what, between] of [
    ["the wallet's certificate taken off the list before the press", "removed"],
    ["a second good certificate for the pair, naming another key, on the list before the press", "two"],
  ] as const) {
    it(`fails where exactly one good certificate doesn't name the reveal's m_S: ${what}`, async () => {
      const { relay, alice, bob } = await pair();
      const cid = await talking(alice, bob);
      await alice.messaging.reveal("preprod", cid, ALICE_SEEDELF);
      await alice.messaging.whenIdle();
      await synced(bob);
      const register = alice.own[0]!.register;
      if (between === "removed") relay.removeCertificate("preprod", onList(relay, ALICE_SEEDELF, register)[0]!.certificate);
      else relay.putCertificate("preprod", await foreignCertificate(alice, ALICE_SEEDELF, register));
      await bob.messaging.checkReveals("preprod", cid);
      const thread = await bob.messaging.thread("preprod", cid);
      expect(thread.messages.at(-1)).toMatchObject({ dir: "in", reveal: { status: "failed" } });
      expect(thread.conversation.revealed).toBeUndefined();
    });
  }

  it("leaves a reveal unchecked where the list can't be read at the press, and verifies it at the next", async () => {
    const { relay, alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await alice.messaging.reveal("preprod", cid, ALICE_SEEDELF);
    await alice.messaging.whenIdle();
    await synced(bob);
    const fetch = relay.fetch;
    relay.fetch = async (url, init) => (new URL(url).pathname === CERTIFICATES ? Promise.reject(new TypeError("Failed to fetch")) : fetch(url, init));
    await expect(bob.messaging.checkReveals("preprod", cid)).rejects.toThrow();
    expect((await bob.messaging.thread("preprod", cid)).messages.at(-1)).toMatchObject({ reveal: { status: "unchecked" } });
    relay.fetch = fetch;
    await bob.messaging.checkReveals("preprod", cid);
    expect((await bob.messaging.thread("preprod", cid)).conversation.revealed?.name).toBe(ALICE_SEEDELF);
  });
});

describe("withdrawing the wallet's own certificates (protocol.md §21.7; chunk 55's call 9)", { timeout: 120_000 }, () => {
  const WITHDRAWALS = "/messaging/v1/preprod/withdrawals";
  const withdrawn = (p: Party) => p.trace.filter((s) => s === `POST ${WITHDRAWALS}`).length;
  /** The mark that withdrawals wait (messaging.ts `withdrawing`), as stored: none once every one has gone. */
  const marked = (p: Party) => p.local.data.has("seedelf.private.messagingWithdraw.preprod");

  it("at a network's switch off, each certificate of the wallet's own on the list: a writer's next read finds the Seedelf taking no messages", async () => {
    const { relay, alice, bob } = await pair();
    const register = bob.own[0]!.register;
    expect(onList(relay, BOB_SEEDELF, register)).toHaveLength(1);
    bob.trace.length = 0;
    await bob.messaging.switch("preprod", false);
    await bob.messaging.whenIdle();
    expect(withdrawn(bob)).toBe(1);
    expect(onList(relay, BOB_SEEDELF, register)).toEqual([]);
    expect((await listOf(bob)).queue).toEqual([]);
    expect(marked(bob)).toBe(false);
    // Nothing else asked of the relay with the switch off: no page, no certificate.
    expect(bob.trace.filter((s) => /^(GET|POST) /.test(s))).toEqual([`POST ${WITHDRAWALS}`]);
    // The removal on the list: Alice's next read drops it, and Bob's Seedelf takes no first message from her.
    await expect(alice.messaging.start("preprod", BOB_SEEDELF, "still there?")).rejects.toThrow(NoCertificate);
    // Turned on again: the list read, and a certificate made and posted again.
    await bob.messaging.switch("preprod", true);
    await bob.messaging.whenIdle();
    expect(onList(relay, BOB_SEEDELF, register)).toHaveLength(1);
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "back again");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect((await bob.messaging.overview("preprod")).requests.map((r) => r.cid)).toEqual([cid]);
  });

  it("at a Seedelf's turn-off, its own certificates alone, the others' staying listed", async () => {
    const { relay, directory, alice, bob } = await pair();
    const SECOND = BOB_SEEDELF + "02";
    const second = await another(bob);
    bob.own.push({ name: SECOND, register: second });
    directory.set(SECOND, second);
    await bob.messaging.answerAt("preprod", SECOND, second, true);
    await bob.messaging.whenIdle();
    expect(onList(relay, SECOND, second)).toHaveLength(1);
    bob.trace.length = 0;
    await bob.messaging.answerAt("preprod", BOB_SEEDELF, bob.own[0]!.register, false);
    await bob.messaging.whenIdle();
    expect(withdrawn(bob)).toBe(1);
    expect(onList(relay, BOB_SEEDELF, bob.own[0]!.register)).toEqual([]);
    expect(onList(relay, SECOND, second)).toHaveLength(1);
    await expect(alice.messaging.start("preprod", BOB_SEEDELF, "off now")).rejects.toThrow(NoCertificate);
    await alice.messaging.start("preprod", SECOND, "on still");
  });

  it("go apart, the first at once and each next a random wait after it, through the alarm with the switch off; one waiting at a lock goes after the unlock", async () => {
    const relay = checkedRelay();
    const directory: Directory = new Map();
    const bob = await party(24, relay, directory, BOB_SEEDELF);
    const SECOND = BOB_SEEDELF + "02";
    const second = await another(bob);
    bob.own.push({ name: SECOND, register: second });
    directory.set(SECOND, second);
    await rememberRegister(bob.store, "preprod", SECOND, second);
    // Both posted, one a lane: the turn-on's, and the next sync's.
    await turnOn(bob);
    await synced(bob);
    expect(relay.certificatesIn("preprod")).toHaveLength(2);
    // The worker's own spacing from here, and the last post long past.
    bob.restart(undefined, { certificateSpacing: undefined });
    await busyFor(CERTIFICATE_SPACING_MS.most + 60_000, bob);
    bob.trace.length = 0;
    await bob.messaging.switch("preprod", false);
    await bob.messaging.whenIdle();
    expect(withdrawn(bob)).toBe(1);
    expect(relay.certificatesIn("preprod")).toHaveLength(1);
    const [next] = (await listOf(bob)).queue;
    expect(next).toMatchObject({ withdraw: true });
    expect(next!.after - clock.now).toBeGreaterThanOrEqual(CERTIFICATE_SPACING_MS.least - 1000);
    // The alarm runs on for it, Messages off: before its time a run posts nothing.
    expect(bob.alarm.on).toBe(true);
    await busyFor(CERTIFICATE_SPACING_MS.least - 60_000, bob);
    await bob.messaging.syncAll(["preprod", "mainnet"], { alarm: true });
    await bob.messaging.whenIdle();
    expect(withdrawn(bob)).toBe(1);
    // Locked before its time, and unlocked after it: the unlock's run posts it, the mark kept through the lock.
    await bob.wallet.lock();
    expect(marked(bob)).toBe(true);
    clock.now = next!.after + 1000;
    await bob.wallet.unlock(PASSWORD);
    await bob.messaging.syncAll(["preprod", "mainnet"]);
    await bob.messaging.whenIdle();
    expect(withdrawn(bob)).toBe(2);
    expect(relay.certificatesIn("preprod")).toEqual([]);
    expect(marked(bob)).toBe(false);
    // Nothing left: the next run stops the alarm, and asks nothing.
    bob.trace.length = 0;
    await bob.messaging.syncAll(["preprod", "mainnet"], { alarm: true });
    await bob.messaging.whenIdle();
    expect(bob.alarm.on).toBe(false);
    expect(bob.trace.filter((s) => /^(GET|POST) /.test(s))).toEqual([]);
  });

  it("take a 404, no such certificate, as done: the list already shows it gone", async () => {
    const { relay, bob } = await pair();
    const register = bob.own[0]!.register;
    // The relay dropped it, and Bob's copy doesn't know yet.
    relay.removeCertificate("preprod", onList(relay, BOB_SEEDELF, register)[0]!.certificate);
    bob.trace.length = 0;
    await bob.messaging.switch("preprod", false);
    await bob.messaging.whenIdle();
    expect(withdrawn(bob)).toBe(1);
    expect((await listOf(bob)).queue).toEqual([]);
    expect(marked(bob)).toBe(false);
    // Never asked again.
    await busyFor(CERTIFICATE_SPACING_MS.most, bob);
    await bob.messaging.syncAll(["preprod", "mainnet"], { alarm: true });
    await bob.messaging.whenIdle();
    expect(withdrawn(bob)).toBe(1);
  });

  it("drop one still waiting where its Seedelf is turned on again: its certificate stays listed", async () => {
    const { relay, bob } = await pair();
    const register = bob.own[0]!.register;
    // The relay unreachable at the switch off: the withdrawal waits.
    relay.up = false;
    await bob.messaging.switch("preprod", false);
    await bob.messaging.whenIdle();
    expect((await listOf(bob)).queue).toMatchObject([{ withdraw: true }]);
    relay.up = true;
    await bob.messaging.switch("preprod", true);
    await bob.messaging.whenIdle();
    expect((await listOf(bob)).queue).toEqual([]);
    expect(onList(relay, BOB_SEEDELF, register)).toHaveLength(1);
    expect(marked(bob)).toBe(false);
  });
});
