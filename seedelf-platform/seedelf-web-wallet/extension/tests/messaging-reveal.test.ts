// The verified reveal in the worker (protocol.md §19, the 1.10.0 gate's W2).
// A reveal's proof is checked as its message is taken, with no request. The
// chain check (does the Seedelf sit at the register the proof names) is a
// read of the contract, and the server that answers it sees when it's made:
// so no sync ever makes it. It's made when the user asks, in the thread
// (`messaging-check-reveal`), once for every reveal of that conversation
// still waiting. Until then a reveal is unchecked, and names nothing.
import { describe, expect, it } from "vitest";

import { registerOf, type RegisterHex } from "../src/background/chain";
import { readContractView } from "../src/background/contract-scan";
import { type Inbox, revealedRegistersFrom } from "../src/background/messaging";
import { rememberRegister } from "../src/background/minted-by";
import { outpoint } from "../src/background/spent";
import { koiosPreprod, testBalances, transferPreprod, vectors } from "./fakes";
import { ALICE_SEEDELF, another, BOB_SEEDELF, certificateOf, fileOf, loadTestWasm, pair, type Party, PASSWORD, synced, talking, texts, turns } from "./messaging-harness";

const last = async (p: Party, cid: string) => (await p.messaging.thread("preprod", cid)).messages.at(-1)!;
const record = (p: Party, cid: string) => fileOf(p, cid);
const inboxOf = async (p: Party) => (await p.store.get<Inbox>("messaging.preprod"))!;
/** `name`, put under `register` by `p`'s own browser: a Seedelf it shows (W8). */
const madeHere = (p: Party, name: string, register: RegisterHex) => rememberRegister(p.store, "preprod", name, register);

describe("the verified reveal in the worker (protocol.md §19)", { timeout: 30_000 }, () => {
  it("shows Bob Alice's Seedelf once he has replied; his wallet checks it against the chain when he asks, then names it", async () => {
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

    // Taken: its proof verified, nothing of the chain asked, nothing named.
    await synced(bob);
    let thread = await bob.messaging.thread("preprod", cid);
    expect(thread.messages.at(-1)).toMatchObject({ dir: "in", reveal: { status: "unchecked" } });
    expect(thread.messages.at(-1)!.reveal!.name).toBeUndefined();
    expect(thread.conversation.revealed).toBeUndefined();
    expect(bob.revealReads).toBe(0);
    expect((await inboxOf(bob)).conversations[cid]!.unchecked).toBe(true);

    // Bob asks: one read of the contract, and the conversation names the Seedelf.
    await bob.messaging.checkReveals("preprod", cid);
    thread = await bob.messaging.thread("preprod", cid);
    expect(thread.messages.at(-1)).toMatchObject({ dir: "in", reveal: { status: "verified", name: ALICE_SEEDELF } });
    expect(thread.conversation.revealed).toEqual({ name: ALICE_SEEDELF, at: expect.any(Number) });
    expect((await bob.messaging.overview("preprod")).conversations[0]!.last).toEqual({ dir: "in", reveal: true });
    expect(bob.revealReads).toBe(1);
    expect((await inboxOf(bob)).conversations[cid]!.unchecked).toBeUndefined();
    expect((await record(bob, cid))!.history.at(-1)!.reveal).toEqual({ status: "verified", name: ALICE_SEEDELF });
  });

  it("never reads the chain in a sync, however many reveals come and however often it syncs", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    bob.trace.length = 0;
    for (let i = 0; i < 3; i++) {
      await alice.messaging.reveal("preprod", cid, ALICE_SEEDELF);
      await alice.messaging.whenIdle();
      await synced(bob);
      await synced(bob);
    }
    expect(bob.revealReads).toBe(0);
    expect(bob.trace.filter((s) => s.startsWith("chain"))).toEqual([]);
    // A lock and an unlock, and the syncs after: still none.
    await bob.wallet.lock();
    await bob.wallet.unlock(PASSWORD);
    bob.restart();
    await synced(bob);
    expect(bob.revealReads).toBe(0);
    const thread = await bob.messaging.thread("preprod", cid);
    expect(thread.messages.slice(-3).map((m) => m.reveal?.status)).toEqual(["unchecked", "unchecked", "unchecked"]);
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
    await bob.messaging.checkReveals("preprod", cid);
    let thread = await bob.messaging.thread("preprod", cid);
    expect(thread.messages.at(-1)!.reveal).toEqual({ status: "failed" });
    expect(thread.conversation.revealed).toBeUndefined();
    expect(bob.revealReads).toBe(1);
    expect(JSON.stringify(await record(bob, cid))).not.toContain(ALICE_SEEDELF);
    expect(JSON.stringify(await bob.store.get("messaging.preprod"))).not.toContain(ALICE_SEEDELF);

    // Shown again: for the register a contract read finds now, even where Alice's kept view still has the old one. Her
    // browser put it there.
    await madeHere(alice, ALICE_SEEDELF, now);
    alice.own = [{ name: ALICE_SEEDELF, register: now }];
    alice.kept = [{ name: ALICE_SEEDELF, register: was }];
    await alice.messaging.reveal("preprod", cid, ALICE_SEEDELF);
    await alice.messaging.whenIdle();
    await synced(bob);
    await bob.messaging.checkReveals("preprod", cid);
    thread = await bob.messaging.thread("preprod", cid);
    expect(thread.messages.at(-1)!.reveal).toEqual({ status: "verified", name: ALICE_SEEDELF });
    expect(thread.conversation.revealed?.name).toBe(ALICE_SEEDELF);
  });

  it("reads the contract once a check, however many reveals wait, and not at all when none does", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    for (let i = 0; i < 3; i++) await alice.messaging.reveal("preprod", cid, ALICE_SEEDELF);
    await alice.messaging.whenIdle();
    await synced(bob);
    // Two presses at once are one check.
    await Promise.all([bob.messaging.checkReveals("preprod", cid), bob.messaging.checkReveals("preprod", cid)]);
    const thread = await bob.messaging.thread("preprod", cid);
    expect(thread.messages.slice(-3).map((m) => m.reveal?.status)).toEqual(["verified", "verified", "verified"]);
    expect(bob.revealReads).toBe(1);
    await bob.messaging.checkReveals("preprod", cid);
    expect(bob.revealReads).toBe(1);
  });

  it("says a reveal is being checked while the chain is read, and leaves it unchecked when the read fails", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await alice.messaging.reveal("preprod", cid, ALICE_SEEDELF);
    await alice.messaging.whenIdle();
    await synced(bob);
    // The read fails: said to whoever asked, and the reveal waits for another press, never named.
    bob.revealFails = new Error("the server didn't answer");
    await expect(bob.messaging.checkReveals("preprod", cid)).rejects.toThrow(/didn't answer/);
    expect((await last(bob, cid)).reveal).toEqual({ status: "unchecked" });
    expect((await bob.messaging.overview("preprod")).conversations[0]!.revealed).toBeUndefined();
    expect((await inboxOf(bob)).conversations[cid]!.unchecked).toBe(true);
    // No sync tries again by itself.
    bob.revealFails = undefined;
    await synced(bob);
    expect(bob.revealReads).toBe(1);

    // While the read runs, the thread says so, and open pages are told as it starts and as it ends.
    let during: unknown;
    bob.changed.length = 0;
    bob.onRevealRead = async () => {
      bob.onRevealRead = undefined;
      expect(bob.changed).toEqual(["preprod"]);
      during = (await last(bob, cid)).reveal;
    };
    await bob.messaging.checkReveals("preprod", cid);
    expect(during).toEqual({ status: "checking" });
    expect(bob.revealReads).toBe(2);
    expect((await last(bob, cid)).reveal).toEqual({ status: "verified", name: ALICE_SEEDELF });
    expect(bob.changed.length).toBeGreaterThanOrEqual(2);
    expect((await inboxOf(bob)).conversations[cid]!.unchecked).toBeUndefined();
  });

  it("refuses the check while the network's Messages are off, and stops before its request if they go off meanwhile", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await alice.messaging.reveal("preprod", cid, ALICE_SEEDELF);
    await alice.messaging.whenIdle();
    await synced(bob);
    await bob.messaging.switch("preprod", false);
    await expect(bob.messaging.checkReveals("preprod", cid)).rejects.toThrow(/Turn Messages on/);
    expect(bob.revealReads).toBe(0);
    expect((await last(bob, cid)).reveal).toEqual({ status: "unchecked" });

    // On, then off as the check reads its records, before its request goes.
    await bob.messaging.switch("preprod", true);
    await bob.messaging.whenIdle();
    const real = bob.messaging;
    bob.trace.length = 0;
    const check = real.checkReveals("preprod", cid);
    await bob.preferences.set({ messaging: { preprod: false, mainnet: false } });
    await expect(check).rejects.toThrow(/Turn Messages on/);
    expect(bob.revealReads).toBe(0);
    // Locked, it asks nothing either.
    await bob.messaging.switch("preprod", true);
    await bob.messaging.whenIdle();
    await bob.wallet.lock();
    await expect(bob.messaging.checkReveals("preprod", cid)).rejects.toThrow(/locked/);
    expect(bob.revealReads).toBe(0);
  });

  it("names the other side by the latest that verified, by when it came", async () => {
    const { alice, bob, directory } = await pair();
    const cid = await talking(alice, bob);
    const SECOND = "5eed0e1f00" + "616c69636532";
    const second = await another(alice);
    await madeHere(alice, SECOND, second);
    alice.own.push({ name: SECOND, register: second });
    directory.set(SECOND, second);
    await alice.messaging.reveal("preprod", cid, ALICE_SEEDELF);
    await alice.messaging.reveal("preprod", cid, SECOND);
    await alice.messaging.whenIdle();
    // Both verified in one check, at one time: the one that came last names the other side.
    await synced(bob);
    await bob.messaging.checkReveals("preprod", cid);
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
    // Before it's checked too: an unchecked reveal never takes a verified name away.
    expect((await bob.messaging.thread("preprod", cid)).conversation.revealed?.name).toBe(SECOND);
    await bob.messaging.checkReveals("preprod", cid);
    thread = await bob.messaging.thread("preprod", cid);
    expect(thread.messages.at(-1)!.reveal).toEqual({ status: "failed" });
    expect(thread.conversation.revealed?.name).toBe(SECOND);
    // Shown again for the register it holds now, where Alice's browser put it: the newer names the other side.
    await madeHere(alice, ALICE_SEEDELF, directory.get(ALICE_SEEDELF)!);
    alice.own[0] = { name: ALICE_SEEDELF, register: directory.get(ALICE_SEEDELF)! };
    await alice.messaging.reveal("preprod", cid, ALICE_SEEDELF);
    await alice.messaging.whenIdle();
    await synced(bob);
    await bob.messaging.checkReveals("preprod", cid);
    thread = await bob.messaging.thread("preprod", cid);
    expect(thread.messages.at(-1)!.reveal).toEqual({ status: "verified", name: ALICE_SEEDELF });
    expect(thread.conversation.revealed?.name).toBe(ALICE_SEEDELF);
  });

  it("sets right what the inbox says of a conversation's reveals from its record: a stop between two writes", async () => {
    const { alice, bob } = await pair();
    const cid = await talking(alice, bob);
    await alice.messaging.reveal("preprod", cid, ALICE_SEEDELF);
    await alice.messaging.whenIdle();
    await synced(bob);
    // A stop between the record's write and the inbox's: the reveal waits, and the inbox doesn't say so.
    let kept = await inboxOf(bob);
    delete kept.conversations[cid]!.unchecked;
    await bob.store.set("messaging.preprod", kept);
    bob.restart();
    await synced(bob);
    expect((await inboxOf(bob)).conversations[cid]!.unchecked).toBe(true);
    // The record checked and the inbox not told: still waiting by the inbox, named by nothing.
    await bob.messaging.checkReveals("preprod", cid);
    kept = await inboxOf(bob);
    kept.conversations[cid]!.unchecked = true;
    delete kept.conversations[cid]!.revealed;
    await bob.store.set("messaging.preprod", kept);
    const reads = bob.revealReads;
    await bob.wallet.lock();
    await bob.wallet.unlock(PASSWORD);
    bob.restart();
    await synced(bob);
    expect(bob.revealReads).toBe(reads);
    expect((await inboxOf(bob)).conversations[cid]!.unchecked).toBeUndefined();
    expect((await bob.messaging.thread("preprod", cid)).conversation.revealed?.name).toBe(ALICE_SEEDELF);
  });

  it("fails one whose proof doesn't verify at once, never naming it, and reads nothing of the chain for it", async () => {
    const { relay, alice, bob } = await pair();
    const wasm = loadTestWasm();
    const cid = await talking(alice, bob);
    const state = (await record(alice, cid))!.state;
    const certificate = await certificateOf(alice, ALICE_SEEDELF, alice.own[0]!.register);
    const made = await alice.wallet.withKeys(
      (keys) =>
        JSON.parse(
          wasm.messagingReveal(
            keys.messaging.preprod!,
            JSON.stringify({ network: "preprod", conversation: state, name: ALICE_SEEDELF, register: alice.own[0]!.register, certificate }),
          ),
        ).reveal as string,
    );
    // z₂'s last bit flipped: still a scalar below q, a proof that no longer verifies, in an honest session message.
    const flipped = Number.parseInt(made.slice(-2), 16) ^ 1;
    const broken = made.slice(0, -2) + flipped.toString(16).padStart(2, "0");
    relay.put("preprod", JSON.parse(wasm.messagingSend(JSON.stringify({ conversation: state, plaintext: "02" + broken }))).envelope);
    await synced(bob);
    const thread = await bob.messaging.thread("preprod", cid);
    expect(thread.messages.at(-1)).toMatchObject({ dir: "in", reveal: { status: "failed" } });
    expect(thread.conversation.revealed).toBeUndefined();
    // Nothing waits, so a check asks nothing.
    await bob.messaging.checkReveals("preprod", cid);
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
    const certificate = await certificateOf(alice, ALICE_SEEDELF, alice.own[0]!.register);
    const made = await alice.wallet.withKeys(
      (keys) =>
        JSON.parse(
          wasm.messagingReveal(
            keys.messaging.preprod!,
            JSON.stringify({ network: "preprod", conversation: after, name: ALICE_SEEDELF, register: alice.own[0]!.register, certificate }),
          ),
        ).reveal as string,
    );
    const skipped = JSON.parse(wasm.messagingSend(JSON.stringify({ conversation: odd.conversation, plaintext: "02" + made })));
    relay.put("preprod", skipped.envelope);
    await synced(bob);
    const thread = await bob.messaging.thread("preprod", cid);
    expect(thread.messages.at(-1)).toMatchObject({ dir: "in", reveal: { status: "failed" } });
    expect(thread.conversation.revealed).toBeUndefined();
    await bob.messaging.checkReveals("preprod", cid);
    expect(bob.revealReads).toBe(0);
    await turns(1);
  });
});

// sw.ts gives the service its read of the contract for reveals through `revealedRegistersFrom`: the whole contract,
// read now. Here over the real scan and a fake Koios (preprod's path, and mainnet's with Koios only or the index down).
describe("the contract read a reveal's check makes (reveal#5)", { timeout: 30_000 }, () => {
  const NAME = transferPreprod.to;
  const THEIRS = koiosPreprod.contract_utxos.find((u) => u.asset_list?.some((a) => a.asset_name === NAME))!;

  async function unlocked() {
    const v = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
    const t = testBalances();
    await t.wallet.create(v.phrase, PASSWORD);
    return t;
  }

  it("is whole and fresh on Koios: a Seedelf that left the contract a minute ago has no register there", async () => {
    const t = await unlocked();
    const registers = revealedRegistersFrom((network, options) => readContractView(t.deps, network, options));
    // The wallet read the contract in full a moment ago (an unlock, Home's balance): the Seedelf is there.
    await readContractView(t.deps, "preprod");
    expect((await registers("preprod"))(NAME)).toEqual(registerOf(THEIRS));
    // Its UTxO is spent, the token burned or moved out of the contract: no new row. A minute on, a reveal names it.
    t.koios.spent.add(outpoint(THEIRS));
    t.clock.now += 60_000;
    expect((await registers("preprod"))(NAME)).toBeUndefined();
  });
});
