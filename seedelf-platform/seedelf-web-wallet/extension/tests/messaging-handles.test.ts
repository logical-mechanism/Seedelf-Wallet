// Which of the wallet's Seedelfs take first messages (the 1.10.0 gate's W8).
// A handle is a (name, register) pair: one this browser put a Seedelf under
// when it minted it, or one the user turned on, never a Seedelf merely found
// under the key. Anyone can mint a Seedelf under a register that is the sum of
// two of a wallet's own: the wallet's scan owns it exactly when both are its,
// so a reply at it, or showing it, would tell the minter that the two are one
// wallet's. No chain read for any of it.
import { describe, expect, it } from "vitest";

import { SESSION_MINT } from "../src/background/mint";
import { mintedAt, rememberMint, rememberRegister } from "../src/background/minted-by";
import { PRIVATE_PREFIX } from "../src/background/private-store";
import type { TxDetail } from "../src/shared/rpc";
import { accountMintPreprod, testBalances } from "./fakes";
import {
  ALICE_SEEDELF,
  another,
  BOB_SEEDELF,
  clock,
  type Directory,
  fakeRelay,
  loadTestWasm,
  pair,
  party,
  PASSWORD,
  phrase,
  records,
  synced,
  talking,
  texts,
  turnOn,
} from "./messaging-harness";

/** A Seedelf someone else minted, its name ("planted"). */
const PLANTED = "5eed0e1f00" + "706c616e746564";

const requestsOf = async (p: Awaited<ReturnType<typeof pair>>["bob"]) =>
  (await p.messaging.overview("preprod")).requests.map((r) => r.cid).sort();

// Each test bounded: one that fails mid-take fails here, never hangs the run.
describe("which Seedelfs take first messages (W8)", { timeout: 30_000 }, () => {
  it("takes no first message at a Seedelf under the key that this browser didn't make, and lists it, off (reveal#1, first-contact#3, assumptions-vs-code#3, spec-cryptanalysis#6)", async () => {
    const { directory, alice, bob } = await pair();
    // A Seedelf someone else minted under a register of Bob's key: to his wallet, a sum of two of its registers looks
    // like any other.
    const planted = await another(bob);
    bob.own.push({ name: PLANTED, register: planted });
    directory.set(PLANTED, planted);
    await synced(bob);
    const cid = await alice.messaging.start("preprod", PLANTED, "who holds this one?");
    await alice.messaging.whenIdle();
    bob.changed.length = 0;
    bob.trace.length = 0;
    await synced(bob);
    expect(await requestsOf(bob)).toEqual([]);
    expect(JSON.stringify(await records(bob))).not.toContain(cid);
    expect(bob.changed).toEqual([]);
    expect(bob.trace.filter((s) => /^(POST|chain)/.test(s))).toEqual([]);
    // The page lists both, each with its switch: the one this browser made on, the other off.
    expect((await bob.messaging.overview("preprod")).seedelfs).toEqual([
      { name: BOB_SEEDELF, register: bob.own[0]!.register, made: true, on: true },
      { name: PLANTED, register: planted, made: false, on: false },
    ]);
  });

  it("takes first messages at a Seedelf the user turns on, and none at one turned off, this browser's own included", async () => {
    const { directory, alice, bob } = await pair();
    const planted = await another(bob);
    bob.own.push({ name: PLANTED, register: planted });
    directory.set(PLANTED, planted);
    await synced(bob);
    // On, as the kept view shows it now.
    await bob.messaging.answerAt("preprod", PLANTED, planted, true);
    const toPlanted = await alice.messaging.start("preprod", PLANTED, "now you take them");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect(await requestsOf(bob)).toEqual([toPlanted]);
    // Off, the one this browser made: no more first messages at it, and what began there stays.
    const before = await alice.messaging.start("preprod", BOB_SEEDELF, "before it's off");
    await alice.messaging.whenIdle();
    await synced(bob);
    await bob.messaging.answerAt("preprod", BOB_SEEDELF, bob.own[0]!.register, false);
    await alice.messaging.start("preprod", BOB_SEEDELF, "after it's off");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect(await requestsOf(bob)).toEqual([toPlanted, before].sort());
    expect((await bob.messaging.overview("preprod")).seedelfs).toEqual([
      { name: BOB_SEEDELF, register: bob.own[0]!.register, made: true, on: false },
      { name: PLANTED, register: planted, made: false, on: true },
    ]);
    // Only a Seedelf the kept view has, at the register it has it: a stale page's press changes nothing.
    await expect(bob.messaging.answerAt("preprod", PLANTED, await another(bob), true)).rejects.toThrow(/isn't this wallet's/);
    expect(bob.trace.filter((s) => s.startsWith("chain"))).toEqual([]);
  });

  it("takes first messages at none of a restored wallet's Seedelfs until the user turns them on", async () => {
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const alice = await party(12, relay, directory, ALICE_SEEDELF);
    // Bob's phrase restored in this browser: his Seedelf is in the contract, minted in another.
    const bob = await party(24, relay, directory);
    const register = await another(bob);
    bob.own.push({ name: BOB_SEEDELF, register });
    directory.set(BOB_SEEDELF, register);
    await turnOn(alice, bob);
    const first = await alice.messaging.start("preprod", BOB_SEEDELF, "anyone there?");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect(await requestsOf(bob)).toEqual([]);
    expect((await bob.messaging.overview("preprod")).seedelfs).toEqual([{ name: BOB_SEEDELF, register, made: false, on: false }]);
    await bob.messaging.answerAt("preprod", BOB_SEEDELF, register, true);
    const second = await alice.messaging.start("preprod", BOB_SEEDELF, "and now?");
    await alice.messaging.whenIdle();
    await synced(bob);
    // Turned on, the pool is read again from its oldest (W12): the first message that came while it was off is taken.
    expect(await requestsOf(bob)).toEqual([first, second].sort());
  });

  it("stops taking first messages at a Seedelf once the kept view has it at another register, or not at all, and keeps what began there", async () => {
    const { directory, alice, bob } = await pair();
    const first = await alice.messaging.start("preprod", BOB_SEEDELF, "to your Seedelf");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect(await requestsOf(bob)).toEqual([first]);
    // Locked again under another register of Bob's key: the kept view says so, Alice's lookup still the old one.
    bob.own.splice(0, 1, { name: BOB_SEEDELF, register: await another(bob) });
    await alice.messaging.start("preprod", BOB_SEEDELF, "to its old register");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect(await requestsOf(bob)).toEqual([first]);
    // Gone from the contract: none either.
    bob.own.length = 0;
    await alice.messaging.start("preprod", BOB_SEEDELF, "and now it's gone");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect(await requestsOf(bob)).toEqual([first]);
    expect(directory.size).toBeGreaterThan(0);
  });

  it("offers to show only a Seedelf that takes messages, and reveal() refuses any other, by its register", async () => {
    const { directory, alice, bob } = await pair();
    const planted = await another(alice);
    alice.own.push({ name: PLANTED, register: planted });
    directory.set(PLANTED, planted);
    const cid = await talking(alice, bob);
    expect((await alice.messaging.thread("preprod", cid)).seedelfs).toEqual([ALICE_SEEDELF]);
    await expect(alice.messaging.reveal("preprod", cid, PLANTED)).rejects.toThrow(/isn't this wallet's/);
    // Alice's own, at a register other than the one this browser put it under: a read that finds it so is refused.
    alice.own.splice(0, 1, { name: ALICE_SEEDELF, register: await another(alice) });
    await expect(alice.messaging.reveal("preprod", cid, ALICE_SEEDELF)).rejects.toThrow(/isn't this wallet's/);
    expect(await texts(alice, cid)).toEqual(["out:hello Bob", "in:hi Alice"]);
  });

  it("still shows a Seedelf this browser made whose first messages the user turned off: the switch is for requests", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await alice.messaging.answerAt("preprod", ALICE_SEEDELF, alice.own[0]!.register, false);
    expect((await alice.messaging.thread("preprod", cid)).seedelfs).toEqual([ALICE_SEEDELF]);
    await alice.messaging.reveal("preprod", cid, ALICE_SEEDELF);
    await alice.messaging.whenIdle();
    await synced(bob);
    await bob.messaging.checkReveals("preprod", cid);
    expect((await bob.messaging.thread("preprod", cid)).conversation.revealed?.name).toBe(ALICE_SEEDELF);
  });
});

describe("which Seedelfs take first messages, over time (W12)", { timeout: 30_000 }, () => {
  it("drops a pair only when a kept view that showed it no longer does: never on an absent view, nor one older than the mint (handles-lifecycle#1)", async () => {
    const { alice, bob } = await pair();
    // (a) Minted here, then locked; a first message comes while locked; the unlock has no view kept.
    await bob.wallet.lock();
    const whileLocked = await alice.messaging.start("preprod", BOB_SEEDELF, "while you were away");
    await alice.messaging.whenIdle();
    await bob.wallet.unlock(PASSWORD);
    bob.keptView = false;
    bob.restart();
    await bob.messaging.syncAll(["preprod"]);
    await bob.messaging.whenIdle();
    expect(await requestsOf(bob)).toEqual([whileLocked]);
    // (c) Locked and unlocked again with no view: nothing dropped.
    await bob.wallet.lock();
    await bob.wallet.unlock(PASSWORD);
    bob.restart();
    const again = await alice.messaging.start("preprod", BOB_SEEDELF, "and again");
    await alice.messaging.whenIdle();
    await bob.messaging.syncAll(["preprod"]);
    await bob.messaging.whenIdle();
    expect(await requestsOf(bob)).toEqual([whileLocked, again].sort());
    // (b) A view that shows it, then one that doesn't: its pair is gone.
    bob.keptView = true;
    await synced(bob);
    bob.own.length = 0;
    const gone = await alice.messaging.start("preprod", BOB_SEEDELF, "after it moved");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect(await requestsOf(bob)).toEqual([whileLocked, again].sort());
    expect(JSON.stringify(await records(bob))).not.toContain(gone);
  });

  it("takes a first message at a Seedelf minted here that no view has shown yet (handles-lifecycle#1 d, #2)", async () => {
    const { directory, alice, bob } = await pair();
    // Minted here a moment ago: the kept view, read before, doesn't have it.
    const SECOND = BOB_SEEDELF + "32";
    const second = await another(bob);
    bob.kept = [...bob.own];
    await rememberRegister(bob.store, "preprod", SECOND, second);
    bob.own.push({ name: SECOND, register: second });
    directory.set(SECOND, second);
    const cid = await alice.messaging.start("preprod", SECOND, "to your new Seedelf");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect(await requestsOf(bob)).toEqual([cid]);
  });

  it("adopts a Seedelf minted here before 1.10.0, at the register the first kept view shows, on (handles-lifecycle#4)", async () => {
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const alice = await party(12, relay, directory, ALICE_SEEDELF);
    // Bob minted his Seedelf here with 1.9: who paid is kept (mintedBy), its register isn't (mintedAt is new).
    const bob = await party(24, relay, directory);
    const register = await another(bob);
    bob.own.push({ name: BOB_SEEDELF, register });
    directory.set(BOB_SEEDELF, register);
    await rememberMint(bob.store, "preprod", BOB_SEEDELF, "account", 0);
    await turnOn(alice, bob);
    expect((await bob.messaging.overview("preprod")).seedelfs).toEqual([{ name: BOB_SEEDELF, register, made: true, on: true }]);
    const cid = await alice.messaging.start("preprod", BOB_SEEDELF, "an old friend");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect(await requestsOf(bob)).toEqual([cid]);
    // Once: a name kept later without its register (a 1.10 mint whose pair couldn't be written) isn't adopted.
    const LATER = BOB_SEEDELF + "33";
    const later = await another(bob);
    bob.own.push({ name: LATER, register: later });
    await rememberMint(bob.store, "preprod", LATER, "account", 0);
    await synced(bob);
    expect((await bob.messaging.overview("preprod")).seedelfs).toContainEqual({ name: LATER, register: later, made: false, on: false });
  });

  it("reads the pool again from its oldest when the user turns a Seedelf on: the first messages to it still there are taken (two-browsers#2)", async () => {
    const relay = fakeRelay(clock);
    const directory: Directory = new Map();
    const alice = await party(12, relay, directory, ALICE_SEEDELF);
    // Bob's phrase restored here: his Seedelf takes no first message until he turns it on.
    const bob = await party(24, relay, directory);
    const register = await another(bob);
    bob.own.push({ name: BOB_SEEDELF, register });
    directory.set(BOB_SEEDELF, register);
    await turnOn(alice, bob);
    const waiting = await alice.messaging.start("preprod", BOB_SEEDELF, "from before the restore");
    await alice.messaging.whenIdle();
    await synced(bob);
    expect(await requestsOf(bob)).toEqual([]);
    relay.calls.length = 0;
    await bob.messaging.answerAt("preprod", BOB_SEEDELF, register, true);
    await bob.messaging.whenIdle();
    await synced(bob);
    // A fresh read, from the pool's start: what came while it was off is taken, once.
    expect(relay.calls.find((c) => c.startsWith("GET "))).toBe("GET /messaging/v1/preprod/envelopes");
    expect(await requestsOf(bob)).toEqual([waiting]);
    expect((await bob.messaging.overview("preprod")).requests[0]!.messages).toBe(1);
  });
});

describe("a mint (W8)", { timeout: 30_000 }, () => {
  it("keeps the register it puts its Seedelf under, read from the transaction it built, when it's sent", async () => {
    const t = testBalances();
    await t.wallet.create(phrase(12), PASSWORD);
    t.koios.evaluation = accountMintPreprod.evaluation;
    const summary = await t.mint.build("preprod", "first", "account");
    const { txCbor } = (await t.wallet.withKeys(() => t.session.get<{ txCbor: string }>(SESSION_MINT)))!;
    expect(await mintedAt(t.store, "preprod")).toEqual({});
    await t.mint.submit("preprod", summary.txHash);
    // The output the transaction puts its token in, at the contract: its datum's register.
    const wasm = loadTestWasm();
    const detail = JSON.parse(wasm.decodeTx(wasm.Network.Preprod, txCbor)) as TxDetail;
    const output = detail.outputs.find((o) => o.address.seedelf && o.assets.some((a) => a.assetName === summary.tokenName))!;
    expect(await mintedAt(t.store, "preprod")).toEqual({
      [summary.tokenName]: [{ generator: output.register!.generator, publicValue: output.register!.publicValue }],
    });
    expect(await mintedAt(t.store, "mainnet")).toEqual({});
    // Sealed: neither the name nor the register is on the device in the clear.
    const sealed = JSON.stringify(await t.local.get(`${PRIVATE_PREFIX}mintedAt.preprod`));
    expect(sealed).not.toContain(summary.tokenName);
    expect(sealed).not.toContain(output.register!.generator);
  });

  it("goes on when its pair can't be written, and that Seedelf takes no first message by itself (W12, quota-outside#11)", async () => {
    const t = testBalances();
    await t.wallet.create(phrase(12), PASSWORD);
    t.koios.evaluation = accountMintPreprod.evaluation;
    const summary = await t.mint.build("preprod", "first", "account");
    // The browser refuses the pair's write, as on a full area; every other write goes.
    const set = t.store.set.bind(t.store);
    t.store.set = async (name, value) => {
      if (name === "mintedAt.preprod") throw new Error("QUOTA_BYTES quota exceeded");
      return set(name, value);
    };
    const sent = await t.mint.submit("preprod", summary.txHash);
    expect(sent.txHash).toBe(summary.txHash);
    // No pair made: Messages lists the Seedelf as one this browser didn't make, its switch off (W8's overview).
    expect(await mintedAt(t.store, "preprod")).toEqual({});
  });
});
