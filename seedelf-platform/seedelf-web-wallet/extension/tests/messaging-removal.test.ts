// A Seedelf removed here, or minted here with its pair unwritten, never takes
// first messages by itself (the 1.10.0 gate's W8, W12, f6): the Remove leaves
// a mark that a choice made before it, a view kept from before it and the
// adoption of what was minted before 1.10.0 all respect; a pair a view dropped
// stays dropped when no view is kept; and a mint keeps who paid only once its
// pair is kept. Only the user's own turn-on lifts either. The Remove's and the
// mint's own submit run as written (withdraw.ts submitRemove, mint.ts submit);
// only the network send under them is stubbed, so nothing leaves the test.
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/background/script-spend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/background/script-spend")>();
  return {
    ...actual,
    // The submit to the chain and giveme.my: stubbed, as it went.
    send: vi.fn(async (_deps: unknown, network: string, txHash: string, _key: string, kind: string) => ({
      kind,
      network,
      txHash,
      confirmations: null,
      submittedAt: 0,
    })),
  };
});

import { CONTRACT_V1 } from "../src/background/balances";
import { MintService, SESSION_MINT, type MintDeps } from "../src/background/mint";
import type { RegisterHex } from "../src/background/chain";
import { mintedAt, mintedBy, mintedRegister, rememberMint, rememberRegister } from "../src/background/minted-by";
import { send, type ScriptSpendDeps } from "../src/background/script-spend";
import { SESSION_REMOVE, WithdrawService, type WithdrawDeps } from "../src/background/withdraw";
import type { NetworkName } from "../src/networks";
import { accountMintPreprod, testBalances } from "./fakes";
import {
  ALICE_SEEDELF,
  another,
  BOB_SEEDELF,
  checkedRelay,
  clock,
  type Directory,
  fakeRelay,
  listed,
  loadTestWasm,
  party,
  type Party,
  PASSWORD,
  phrase,
  synced,
  turnOn,
} from "./messaging-harness";

const requestsOf = async (p: Party) => (await p.messaging.overview("preprod")).requests.map((r) => r.cid).sort();

/**
 * `p` removes its Seedelf `name` and Send sends it: the Remove's review kept which Seedelf (withdraw.ts buildRemove),
 * and `submitRemove` runs as written over `p`'s own records. No request: `send` is stubbed.
 */
async function removeSent(p: Party, name: string): Promise<void> {
  const txHash = "ab".repeat(32);
  await p.session.set(SESSION_REMOVE, { network: "preprod", txHash, name, txCbor: "00", seed: "00", builtAt: clock.now });
  const withdraw = new WithdrawService({ wasm: loadTestWasm(), wallet: p.wallet, session: p.session, store: p.store } as unknown as ScriptSpendDeps);
  const calls = vi.mocked(send).mock.calls.length;
  await withdraw.submitRemove("preprod", txHash);
  expect(vi.mocked(send).mock.calls.length).toBe(calls + 1);
}

describe("finding 6: a Seedelf removed here takes no first message (W12)", { timeout: 60_000 }, () => {
  it("control: one minted here, removed, takes none even while the kept view still has it", async () => {
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const alice = await party(12, relay, directory, ALICE_SEEDELF);
    const bob = await party(24, relay, directory, BOB_SEEDELF);
    await turnOn(alice, bob);
    const before = await alice.messaging.start("preprod", BOB_SEEDELF, "before the removal");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect(await requestsOf(bob)).toEqual([before]);
    const asked = relay.calls.length;
    await removeSent(bob, BOB_SEEDELF);
    // The Remove asks no server anything about Messages.
    expect(relay.calls.length).toBe(asked);
    // The kept view is the one the Remove's review read: it still has the Seedelf at its register (bob.own unchanged).
    await alice.messaging.start("preprod", BOB_SEEDELF, "after the removal");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect(await requestsOf(bob)).toEqual([before]);
    expect(bob.trace.filter((s) => s.startsWith("chain"))).toEqual([]);
  });

  it("(a) one the user turned on, removed here: takes none while the kept view still has it", async () => {
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const alice = await party(12, relay, directory, ALICE_SEEDELF);
    // Bob's phrase restored here: his Seedelf was minted in another browser, so he turned it on himself.
    const bob = await party(24, relay, directory);
    const register = await another(bob);
    bob.own.push({ name: BOB_SEEDELF, register });
    directory.set(BOB_SEEDELF, register);
    await turnOn(alice, bob);
    await bob.messaging.answerAt("preprod", BOB_SEEDELF, register, true);
    await bob.messaging.whenIdle();
    const before = await alice.messaging.start("preprod", BOB_SEEDELF, "before the removal");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect(await requestsOf(bob)).toEqual([before]);
    await removeSent(bob, BOB_SEEDELF);
    // As in the control: the kept view still has it, its removal not yet read.
    const after = await alice.messaging.start("preprod", BOB_SEEDELF, "after the removal");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect((await requestsOf(bob)).includes(after), "a first message taken at a Seedelf removed here").toBe(false);
    expect(bob.trace.filter((s) => s.startsWith("chain"))).toEqual([]);
  });

  it("(a') one the user turned on, removed here: takes none after a lock, before the unlock's first view", async () => {
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const alice = await party(12, relay, directory, ALICE_SEEDELF);
    const bob = await party(24, relay, directory);
    const register = await another(bob);
    bob.own.push({ name: BOB_SEEDELF, register });
    directory.set(BOB_SEEDELF, register);
    await turnOn(alice, bob);
    await bob.messaging.answerAt("preprod", BOB_SEEDELF, register, true);
    await bob.messaging.whenIdle();
    await synced(bob);
    await removeSent(bob, BOB_SEEDELF);
    // The removal landed, and a view that read it is kept: none taken (48480cf8 holds this).
    bob.own.length = 0;
    const landed = await alice.messaging.start("preprod", BOB_SEEDELF, "after it landed");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect(await requestsOf(bob)).toEqual([]);
    // Locked; a first message comes meanwhile; the unlock's first sync runs before any reading has kept a view.
    await bob.wallet.lock();
    const whileLocked = await alice.messaging.start("preprod", BOB_SEEDELF, "while you were away");
    await alice.messaging.whenIdle();
    await bob.wallet.unlock(PASSWORD);
    bob.keptView = false;
    bob.restart();
    await bob.messaging.syncAll(["preprod"]);
    await bob.messaging.whenIdle();
    const taken = await requestsOf(bob);
    expect.soft(taken.includes(landed), "the one refused while a view had it gone stays refused").toBe(false);
    expect.soft(taken.includes(whileLocked), "a Seedelf removed here took a first message again on an absent view").toBe(false);
    expect(taken).toEqual([]);
  });

  it("(d) same root: one minted here and removed in another browser takes none once a reading no longer has it, a lock included", async () => {
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const alice = await party(12, relay, directory, ALICE_SEEDELF);
    // Minted in this browser (its pair kept), removed with the same phrase elsewhere: only the reading here says so.
    const bob = await party(24, relay, directory, BOB_SEEDELF);
    await turnOn(alice, bob);
    await synced(bob);
    bob.own.length = 0;
    const gone = await alice.messaging.start("preprod", BOB_SEEDELF, "after a reading has it gone");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect.soft((await requestsOf(bob)).includes(gone)).toBe(false);
    await bob.wallet.lock();
    const whileLocked = await alice.messaging.start("preprod", BOB_SEEDELF, "while you were away");
    await alice.messaging.whenIdle();
    await bob.wallet.unlock(PASSWORD);
    bob.keptView = false;
    bob.restart();
    await bob.messaging.syncAll(["preprod"]);
    await bob.messaging.whenIdle();
    expect((await requestsOf(bob)).includes(whileLocked), "a pair a reading had dropped came back on an absent view").toBe(false);
  });
});

describe("finding 6: what a fix must keep (both hold at 48480cf8)", { timeout: 60_000 }, () => {
  it("a Remove that never landed: turned on again, the Seedelf takes first messages (no dead switch)", async () => {
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const alice = await party(12, relay, directory, ALICE_SEEDELF);
    const bob = await party(24, relay, directory, BOB_SEEDELF);
    await turnOn(alice, bob);
    await removeSent(bob, BOB_SEEDELF);
    // It never landed: a reading still has it at its register, and the user turns it on.
    await synced(bob);
    await bob.messaging.answerAt("preprod", BOB_SEEDELF, bob.own[0]!.register, true);
    await bob.messaging.whenIdle();
    const again = await alice.messaging.start("preprod", BOB_SEEDELF, "it's still yours");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect(await requestsOf(bob)).toEqual([again]);
    expect(((await bob.messaging.overview("preprod")).seedelfs ?? []).map((s) => s.on)).toEqual([true]);
  });

  it("THE RULE: across the Remove, a lock and the unlock's first sync, the relay is asked the same as by a wallet that matches nothing", async () => {
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const alice = await party(12, relay, directory, ALICE_SEEDELF);
    // Bob turned on his restored Seedelf and removes it; Carol's key matches none of the pool's envelopes.
    const bob = await party(24, relay, directory);
    const register = await another(bob);
    bob.own.push({ name: BOB_SEEDELF, register });
    directory.set(BOB_SEEDELF, register);
    const carol = await party(15, relay, directory);
    await turnOn(alice, bob, carol);
    await bob.messaging.answerAt("preprod", BOB_SEEDELF, register, true);
    await bob.messaging.whenIdle();
    await synced(bob);
    await synced(carol);
    const asked = (p: Party) => p.trace.filter((s) => /^(GET|POST) /.test(s) || s.startsWith("chain"));
    bob.trace.length = 0;
    carol.trace.length = 0;
    await removeSent(bob, BOB_SEEDELF);
    for (const text of ["one", "two"]) {
      await alice.messaging.start("preprod", BOB_SEEDELF, text);
      await alice.messaging.whenIdle();
      await synced(bob);
      await synced(carol);
    }
    for (const p of [bob, carol]) {
      await p.wallet.lock();
    }
    await alice.messaging.start("preprod", BOB_SEEDELF, "while you were away");
    await alice.messaging.whenIdle();
    for (const p of [bob, carol]) {
      await p.wallet.unlock(PASSWORD);
      p.keptView = false;
      p.restart();
      await p.messaging.syncAll(["preprod"]);
      await p.messaging.whenIdle();
    }
    expect(asked(bob).length).toBeGreaterThan(0);
    expect(asked(bob)).toEqual(asked(carol));
  });
});

describe("finding 6: adoption takes only what predates 1.10.0 (W12)", { timeout: 60_000 }, () => {
  it("(b) one minted here before 1.10.0 and removed before Messages first ran: not adopted from a view kept from before", async () => {
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const alice = await party(12, relay, directory, ALICE_SEEDELF);
    // Bob minted his Seedelf here with 1.9: who paid is kept (mintedBy), its register isn't (mintedAt is new).
    const bob = await party(24, relay, directory);
    const register = await another(bob);
    bob.own.push({ name: BOB_SEEDELF, register });
    directory.set(BOB_SEEDELF, register);
    await rememberMint(bob.store, "preprod", BOB_SEEDELF, "account", 0);
    // Its certificate on the list, from before its removal (chunk 55's 55e): a writer can still write to it.
    await listed(relay, bob, BOB_SEEDELF, register);
    await turnOn(alice);
    // Bob, Messages still off (as every wallet starts 1.10.0), removes it.
    await removeSent(bob, BOB_SEEDELF);
    // No register kept for it (a fix may keep a mark of the removal there, with none).
    expect((await mintedAt(bob.store, "preprod"))[BOB_SEEDELF] ?? []).toEqual([]);
    expect(Object.keys(await mintedBy(bob.store, "preprod"))).toEqual([BOB_SEEDELF]);
    const toRemoved = await alice.messaging.start("preprod", BOB_SEEDELF, "to the one you removed");
    await alice.messaging.whenIdle();
    // He turns Messages on before any reading has read the removal: the kept view is the Remove's review's.
    await turnOn(bob);
    await synced(bob);
    expect.soft((await mintedAt(bob.store, "preprod"))[BOB_SEEDELF] ?? [], "the removed Seedelf's pair was made again").toEqual([]);
    expect.soft((await requestsOf(bob)).includes(toRemoved), "a first message taken at a Seedelf removed here").toBe(false);
    expect.soft(((await bob.messaging.overview("preprod")).seedelfs ?? []).filter((s) => s.on), "listed as on").toEqual([]);
  });

  it("(b') the same, held only to what privacy.md and flows.md say: none once a reading no longer has it, a lock included", async () => {
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const alice = await party(12, relay, directory, ALICE_SEEDELF);
    const bob = await party(24, relay, directory);
    const register = await another(bob);
    bob.own.push({ name: BOB_SEEDELF, register });
    directory.set(BOB_SEEDELF, register);
    await rememberMint(bob.store, "preprod", BOB_SEEDELF, "account", 0);
    // Its certificate on the list, from before its removal (chunk 55's 55e): a writer can still write to it.
    await listed(relay, bob, BOB_SEEDELF, register);
    await turnOn(alice);
    await removeSent(bob, BOB_SEEDELF);
    await alice.messaging.start("preprod", BOB_SEEDELF, "while the view was stale");
    await alice.messaging.whenIdle();
    await turnOn(bob);
    await synced(bob);
    // Whatever the stale view let in: what's held from here on is the docs' rule.
    const stale = await requestsOf(bob);
    // A reading that read the removal is kept: none.
    bob.own.length = 0;
    const gone = await alice.messaging.start("preprod", BOB_SEEDELF, "after a reading has it gone");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect.soft((await requestsOf(bob)).includes(gone)).toBe(false);
    // Locked, a first message meanwhile, the unlock's first sync before any reading.
    await bob.wallet.lock();
    const whileLocked = await alice.messaging.start("preprod", BOB_SEEDELF, "while you were away");
    await alice.messaging.whenIdle();
    await bob.wallet.unlock(PASSWORD);
    bob.keptView = false;
    bob.restart();
    await bob.messaging.syncAll(["preprod"]);
    await bob.messaging.whenIdle();
    expect((await requestsOf(bob)).includes(whileLocked), "taken at a removed Seedelf after a reading had it gone").toBe(false);
    expect(await requestsOf(bob)).toEqual(stale);
  });

  it("(c) one minted with 1.10.0 whose pair couldn't be written, before Messages first ran: off, never adopted", async () => {
    // The mint, built for real on the 12-word phrase's account (as messaging-handles.test.ts's mint tests build it).
    const t = testBalances();
    await t.wallet.create(phrase(12), PASSWORD);
    t.koios.evaluation = accountMintPreprod.evaluation;
    const summary = await t.mint.build("preprod", "first", "account");
    const built = await t.wallet.withKeys(() => t.session.get<Record<string, unknown>>(SESSION_MINT));
    const wasm = loadTestWasm();
    const register = mintedRegister(wasm, "preprod", built!.txCbor as string, CONTRACT_V1.seedelfPolicyId, summary.tokenName)!;
    expect(register).toBeDefined();

    // The reader is that phrase's wallet, Messages off; the writer holds a Seedelf of its own.
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const reader = await party(12, relay, directory);
    const writer = await party(24, relay, directory, BOB_SEEDELF);
    await turnOn(writer);
    // Send: the review as kept, submitted by the mint's own submit; the browser refuses the pair's write once.
    await reader.session.set(SESSION_MINT, built);
    const set = reader.store.set.bind(reader.store);
    let refused = 0;
    reader.store.set = async (name, value) => {
      if (name === "mintedAt.preprod" && refused++ === 0) throw new Error("QUOTA_BYTES quota exceeded");
      return set(name, value);
    };
    const mint = new MintService({ wasm, wallet: reader.wallet, session: reader.session, store: reader.store } as unknown as MintDeps);
    expect((await mint.submit("preprod", summary.txHash)).txHash).toBe(summary.txHash);
    reader.store.set = set;
    expect(refused).toBe(1);
    // As W12 has it: no pair made. (At 48480cf8 who paid is kept, which is what adoption then takes for a name
    // minted before 1.10.0; a fix may instead keep it only once the pair is.)
    expect(await mintedAt(reader.store, "preprod")).toEqual({});

    // It lands: the kept view has it at the register the mint put it under. A first message comes to it.
    reader.own.push({ name: summary.tokenName, register });
    directory.set(summary.tokenName, register);
    // Its certificate on the list, as another browser of the phrase posted it (chunk 55's 55e): the writer can write.
    await listed(relay, reader, summary.tokenName, register);
    const first = await writer.messaging.start("preprod", summary.tokenName, "to your new Seedelf");
    await writer.messaging.whenIdle();
    // Messages turned on, its first sync with that view.
    await turnOn(reader);
    await synced(reader);
    expect.soft((await reader.messaging.overview("preprod")).seedelfs, "a pair that couldn't be written was adopted").toEqual([
      { name: summary.tokenName, register, made: false, on: false },
    ]);
    expect.soft((await mintedAt(reader.store, "preprod"))[summary.tokenName] ?? [], "its pair written by adoption").toEqual([]);
    expect.soft((await requestsOf(reader)).includes(first), "a first message taken at a Seedelf whose switch should be off").toBe(false);
  });
});

describe("a Remove sent withdraws its Seedelf's certificates (chunk 55, the review of 55e's X-M3; protocol.md §21.7)", { timeout: 60_000 }, () => {
  it("queues each of its own on the list as the Remove is sent, the others staying listed, with no other request", async () => {
    const relay = checkedRelay();
    const directory: Directory = new Map();
    const bob = await party(24, relay, directory, BOB_SEEDELF);
    const SECOND = BOB_SEEDELF + "02";
    const second = await another(bob);
    bob.own.push({ name: SECOND, register: second });
    directory.set(SECOND, second);
    await rememberRegister(bob.store, "preprod", SECOND, second);
    await turnOn(bob);
    await synced(bob);
    expect(relay.certificatesIn("preprod")).toHaveLength(2);
    const register = bob.own[0]!.register;
    const txHash = "cd".repeat(32);
    await bob.session.set(SESSION_REMOVE, { network: "preprod", txHash, name: BOB_SEEDELF, register, txCbor: "00", seed: "00", builtAt: clock.now });
    const withdraw = new WithdrawService({
      wasm: loadTestWasm(),
      wallet: bob.wallet,
      session: bob.session,
      store: bob.store,
      seedelfRemoved: (n: NetworkName, name: string, r: RegisterHex) => bob.messaging.seedelfRemoved(n, name, r),
    } as unknown as WithdrawDeps);
    bob.trace.length = 0;
    await withdraw.submitRemove("preprod", txHash);
    await bob.messaging.whenIdle();
    expect(bob.trace.filter((s) => /^(GET|POST) /.test(s))).toEqual(["POST /messaging/v1/preprod/withdrawals"]);
    const left = relay.certificatesIn("preprod").map((c) => JSON.parse(loadTestWasm().messagingCheckCertificate(JSON.stringify({ network: "preprod", certificate: c }))).name);
    expect(left).toEqual([SECOND]);
    expect(bob.local.data.has("seedelf.private.messagingWithdraw.preprod")).toBe(false);
  });
});
