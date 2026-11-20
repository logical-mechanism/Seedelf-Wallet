// Mix my boxes again whose chain a lock cut partway (the owner, 2026-11-20): the boxes it didn't mix wait in the pool,
// and Mix my boxes again takes them first. A stopped chain never sends again (markCut, sendChain's stop), and what it
// left at its account comes back directly, or with its collateral's mix alone (buildBack's `started`): a chain of its
// own (sendChain's `from`), which draws only others' boxes and spends none of the wallet's but the one its collateral's
// deposit made, reserved while it's sent. So nothing is held for it, nor for that chain, which giveme.my may keep
// waiting a day, and one of it that never went is built again as the rest, never as another mix of the wallet's boxes
// beside the one the user pressed (1.9.3's gate review, r4#1, r4#2). Its return waits the unlock's draw (privacy
// review §3.1), as every send does, and the hold that waited for that return kept every way of mixing again, Bring one
// back now and Lovejoin's own withdraws off for a day. One still being sent, one with a transaction maybe on its way,
// and one stopped before any of it went, which the runner builds again over the same boxes, still hold them. The real
// WebAssembly, Lovejoin v2's 5 ₳ pool, and fakes.
import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { CHAIN_CUT, LovejoinService } from "../src/background/lovejoin";
import { Minswap } from "../src/background/minswap";
import { SessionService } from "../src/background/sessions";
import type { SessionView } from "../src/shared/rpc";
import { isMixingAgain } from "../src/ui/screens/Lovejoin";
import { account, AGREES, atSession, HOUR, PASSWORD, type Tested } from "./chain-fixtures";
import { txIdOf } from "./fixtures/cbor";
import { busyFor, loadTestWasm, testBalances, withdrawPreprod } from "./fakes";
import { ADA, ADA_ADDRESS, ADA_POOL, ADA_ROWS, adaBox, madeByAdaMix, ownDatum } from "./v2-pools";

/** Building and measuring a chain runs the scripts of every mix in it. */
const CHAINS = { timeout: 120_000 };
const hash = (h: string) => h.repeat(32);
const [FUNDING, X, BACK, M] = ["ab", "e1", "e9", "b1"].map(hash) as [string, string, string, string];

/** A box in the 5 ₳ pool that the wallet's Seedelf key owns, at `tx#0`. */
const owned = async (t: Tested, tx: string) => adaBox(tx, await ownDatum(t.wallet), t.clock.now, 5, 0);

/** How session 0's Mix my boxes again stands: its chain's first mix (X) sent, and the rest not. */
type Shape = {
  /** Why the chain stopped; none while it's still being sent. */
  stopped?: string;
  /** X sent: on chain, or maybe on its way. None: nothing of the chain went. */
  mix?: "confirmed" | "maybe";
  /** What the chain left at its account to pay for its later mixes, beside its 5 ₳ collateral: 4 ₳ by default. */
  left?: string;
  /** The tile's Mix in its place, rather than a mix of the boxes again (X its first mix's, its deposit before it aside). */
  tile?: true;
};

/**
 * An unlocked wallet with two boxes in the 5 ₳ pool beside ten others' (one box mixed again at a time, two waves deep):
 * M, which a mix of someone else's made, and X, which session 0's Mix my boxes again made with its first mix before its
 * chain stopped, as `shape` says, so X isn't mixed yet. Session 0's return waits the unlock's draw. Lovejoin and the
 * sessions wired to each other as the worker wires them (sw.ts).
 */
async function cut(shape: Shape) {
  const t = testBalances({ pools: [ADA_POOL] });
  await t.wallet.create(account(12).phrase, PASSWORD);
  const spend = withdrawPreprod.amount.evaluation as { result: unknown[] };
  t.koios.evaluation = (body: { params: { additionalUtxo?: unknown[] } }) =>
    body.params.additionalUtxo ? AGREES : { ...spend, result: spend.result.slice(0, 1) };
  t.koios.addedToAccounts.push(...ADA_ROWS.slice(0, 10));
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  const wasm = loadTestWasm();
  const collateral = () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch);
  // giveme.my's witness and the one-time key's signature stood in for, as sessions.test.ts does: a Seedelf spend's,
  // and a collateral's mix's (lovejoin-planner.test.ts).
  const signed = (request: string) => {
    const { txCbor } = JSON.parse(request) as { txCbor: string };
    return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
  };
  const lovejoin: LovejoinService = new LovejoinService({
    ...t.deps,
    wasm: { ...wasm, finishLovejoinWithdraw: signed } as typeof wasm,
    collateral,
    store: t.store,
    mixingAgain: (network) => sessions.mixingAgain(network),
    pools: async () => [ADA_POOL],
  });
  const sessions: SessionService = new SessionService({
    ...t.deps,
    wasm: { ...wasm, signScriptSpend: (_key: unknown, request: string) => signed(request) } as typeof wasm,
    collateral,
    store: t.store,
    minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
    lovejoin,
    sleep: async () => undefined,
  });

  // M: a mix of someone else's made it, as Koios says.
  t.koios.addedToAccounts.push(await owned(t, M));
  madeByAdaMix(t.koios, M);
  // Session 0's chain: its first mix spent a box of the wallet's and made X, its last is the return (BACK).
  const created = t.clock.now - 2 * HOUR;
  const chainAt = t.clock.now - HOUR;
  const txs = [X, hash("e2"), BACK].map((txHash) => ({ kind: "mix" as const, txHash, txCbor: "", fee: "0" }));
  await lovejoin.recordChain("preprod", {
    session: 0,
    progress: "seedelf.session.chain.preprod.0",
    txs,
    leaves: [{ txHash: hash("e2"), txIndex: 0, pool: ADA }],
    boxes: 1,
    pools: { [ADA]: 1 },
    again: !shape.tile,
  });
  if (shape.mix) {
    await lovejoin.chainSent("preprod", BACK, 0);
    t.koios.addedToAccounts.push(await owned(t, X));
  }
  const unlocked = await t.wallet.unlockedAt();
  await t.store.set("sessions.preprod", {
    next: 1,
    sessions: [
      {
        index: 0,
        ownStake: true,
        createdAt: created,
        txs: [
          { kind: "out", txHash: FUNDING, at: created, confirmed: true },
          ...(shape.mix ? [{ kind: "mix", txHash: X, at: chainAt, ...(shape.mix === "confirmed" ? { confirmed: true } : {}) }] : []),
        ],
        mix: { boxes: 1, ...(shape.tile ? {} : { again: true }), pool: ADA, depth: 2, delay: "1-6" },
        chain: { total: 3, last: BACK, at: chainAt, ...(shape.stopped ? { stopped: shape.stopped } : {}) },
        // Its return waits the unlock's draw, as every send of the runner's does.
        auto: {
          approved: { minAmountOut: "0", fund: { lovelace: "6000000", tokens: [] } },
          unlockWait: t.clock.now + 15 * 60_000,
          unlockDrawn: unlocked,
        },
      },
    ],
  });
  // What session 0's chain left at its account: what pays for its later mixes, and its 5 ₳ collateral.
  t.koios.addedToAccounts.push(atSession(hash("e3"), 0, shape.left ?? "4000000"), atSession(hash("e3"), 1, "5000000"));
  return { t, lovejoin, sessions };
}

/** A UTxO at session `index`'s one-time account (`address`), as Koios lists it. */
async function atAccount(t: Tested, index: number, address: string, txHash: string, txIndex: number, value: string): Promise<KoiosUtxo> {
  const keyHash = await t.wallet.withKeys((keys) => keys.oneTime.keyHash(index));
  return { ...atSession(txHash, txIndex, value), address, payment_cred: keyHash };
}

/** Session 0's latest chain through Lovejoin, as Lovejoin's record keeps it: its collateral's deposit and mix, and box. */
async function lastChain(t: Tested) {
  const schedule = await t.store.get<{
    chains: Array<{ session?: number; tail?: { deposit: string; box: { txHash: string; txIndex: number }; over?: true } }>;
  }>("lovejoin.preprod");
  return schedule!.chains.filter((c) => c.session === 0).at(-1)!;
}

/**
 * Session 0's collateral's deposit on chain, as Koios lists what it made: its box in the pool, its change at the
 * account, what it spent gone. The box `tail`, as a pool read lists it.
 */
async function depositIn(t: Tested): Promise<KoiosUtxo> {
  const { tail } = await lastChain(t);
  const sent = t.koios.submitted.find((tx) => txIdOf(tx) === tail!.deposit)!;
  type Out = { index: number; address: string; value: { ada: { lovelace: number } }; datum?: string };
  const outs = JSON.parse(loadTestWasm().ogmiosUtxos(Buffer.from(sent).toString("hex"))) as Out[];
  for (const o of txInputs(sent)) t.koios.spent.add(o);
  let box: KoiosUtxo | undefined;
  for (const out of outs) {
    if (out.address !== ADA_ADDRESS) {
      t.koios.addedToAccounts.push(atSession(tail!.deposit, out.index, String(out.value.ada.lovelace)));
      continue;
    }
    box = adaBox(tail!.deposit, out.datum!, t.clock.now, 0, out.index);
    t.koios.addedToAccounts.push(box);
  }
  expect(box && { txHash: box.tx_hash, txIndex: box.tx_index }).toEqual({ txHash: tail!.box.txHash, txIndex: tail!.box.txIndex });
  return box!;
}

/** Each input spent by more than one of the transactions submitted, by hash: none, where two chains never draw one box. */
function spentTwice(t: Tested): string[] {
  const by = new Map<string, Set<string>>();
  for (const tx of t.koios.submitted) for (const o of txInputs(tx)) by.set(o, (by.get(o) ?? new Set()).add(txIdOf(tx)));
  return [...by].filter(([, txs]) => txs.size > 1).map(([o]) => o);
}

/** Session `index` in the list, as the page reads it. */
const viewOf = async (sessions: SessionService, index: number): Promise<SessionView> =>
  (await sessions.list("preprod")).find((v) => v.index === index)!;

/** Session `index`'s hold, as the worker gives it to the page and the page reads it. */
const holds = async (sessions: SessionService, index: number) => {
  const view = await viewOf(sessions, index);
  return { view: !!view.mixingAgain, page: isMixingAgain(view) };
};

describe("Mix my boxes again after a chain of it was cut (the owner, 2026-11-20)", () => {
  it("isn't held for a chain a lock cut partway, and takes the box it didn't mix first", CHAINS, async () => {
    const { t, lovejoin, sessions } = await cut({ stopped: CHAIN_CUT(), mix: "confirmed" });
    const status = (await lovejoin.status("preprod")).pools!.find((p) => p.id === ADA)!;
    expect(status.notMixed.map((b) => b.txHash)).toEqual([X]);
    // The cut chain sends nothing again, and its return, which waits the unlock's draw, spends none of the boxes.
    expect(await sessions.mixingAgain("preprod")).toBe(false);
    const [view] = await sessions.list("preprod");
    expect(view!.mixingAgain).toBeUndefined();
    expect(isMixingAgain(view!)).toBe(false);

    // Mix my boxes again goes: one box at a time with ten others, X first.
    const out = await sessions.againBuild("preprod", false, ADA);
    expect(out.mix).toMatchObject({ boxes: 1, again: true, owned: 2 });
    await sessions.mixOutSubmit("preprod", out.txHash);
    // The new mix is held while it runs, and Mix my boxes again isn't offered twice.
    expect(await sessions.mixingAgain("preprod")).toBe(true);
    await expect(sessions.againBuild("preprod", false, ADA)).rejects.toThrow("being mixed again already");
    const address = out.address;
    t.koios.addedToAccounts.push(
      await atAccount(t, out.index, address, out.txHash, 0, out.payments[0]!.lovelace),
      await atAccount(t, out.index, address, out.txHash, 1, "5000000"),
    );
    t.koios.confirmations = 1;
    t.koios.evaluation = AGREES;
    const before = t.koios.submitted.length;
    await sessions.advance("preprod", out.index, true);
    const spent = t.koios.submitted.slice(before).flatMap((tx) => txInputs(tx));
    expect(spent).toContain(`${X}#0`);
    expect(spent).not.toContain(`${M}#0`);
    // Session 0's return still waits its draw: nothing of it went meanwhile.
    expect(t.koios.submitted.slice(before).some((tx) => txInputs(tx).includes(`${hash("e3")}#0`))).toBe(false);
  });

  it("holds the boxes while a transaction of the cut chain may still land", async () => {
    const { sessions } = await cut({ stopped: CHAIN_CUT(), mix: "maybe" });
    expect(await sessions.mixingAgain("preprod")).toBe(true);
    const [view] = await sessions.list("preprod");
    expect(view!.mixingAgain).toBe(true);
    expect(isMixingAgain(view!)).toBe(true);
    await expect(sessions.againBuild("preprod", false, ADA)).rejects.toThrow("being mixed again already");
  });

  it("holds the boxes while its chain is still being sent", async () => {
    const { sessions } = await cut({ mix: "confirmed" });
    expect(await sessions.mixingAgain("preprod")).toBe(true);
    expect(isMixingAgain((await sessions.list("preprod"))[0]!)).toBe(true);
  });

  it("holds the boxes for a chain stopped before any of it went, which the runner builds again over them", async () => {
    const { sessions } = await cut({ stopped: CHAIN_CUT() });
    expect(await sessions.mixingAgain("preprod")).toBe(true);
    expect(isMixingAgain((await sessions.list("preprod"))[0]!)).toBe(true);
  });

  it("lets go once the cut chain's mix on its way lands, in the view the pool page's own advance gets", CHAINS, async () => {
    const { t, sessions } = await cut({ stopped: CHAIN_CUT(), mix: "maybe" });
    expect(await sessions.mixingAgain("preprod")).toBe(true);
    // The pool page's 20 s advance (run, not asked): the mix is on chain now.
    t.koios.confirmations = 1;
    const view = await sessions.advance("preprod", 0, false);
    expect(view.mixingAgain).toBeUndefined();
    expect(isMixingAgain(view)).toBe(false);
    expect(await sessions.mixingAgain("preprod")).toBe(false);
  });
});

describe("what a chain cut partway left, coming back through its collateral's mix (1.9.3's gate review, r4#1, r4#2)", () => {
  it("holds nothing while that mix waits for giveme.my, and Mix my boxes again beside it leaves that mix its box", CHAINS, async () => {
    const { t, sessions } = await cut({ stopped: CHAIN_CUT(), mix: "confirmed" });
    t.koios.evaluation = AGREES;
    // The unlock's draw run out (asked here, which goes at once, as the draw's end does): the rest goes as a chain of its
    // own, its collateral's deposit first, which spends neither box.
    const before = t.koios.submitted.length;
    await sessions.advance("preprod", 0, true);
    const spent = t.koios.submitted.slice(before).flatMap((tx) => txInputs(tx));
    expect(spent.length).toBeGreaterThan(0);
    expect(spent).not.toContain(`${X}#0`);
    expect(spent).not.toContain(`${M}#0`);
    expect((await viewOf(sessions, 0)).txs.map((x) => x.kind)).toEqual(["out", "mix", "deposit"]);
    expect({ worker: await sessions.mixingAgain("preprod"), ...(await holds(sessions, 0)) }).toEqual({ worker: false, view: false, page: false });
    // That deposit in, and giveme.my busy for hours: its mix waits (witnessTail), and still nothing is held.
    t.koios.confirmations = 1;
    const box = await depositIn(t);
    t.collateral.answer = { status: 503, body: { error: "busy" } };
    for (let hour = 0; hour < 3; hour++) {
      await busyFor(t, HOUR);
      await sessions.advance("preprod", 0, false);
    }
    expect((await viewOf(sessions, 0)).chain).toMatchObject({ total: 3, sent: 1, confirmed: 1 });
    expect({ worker: await sessions.mixingAgain("preprod"), ...(await holds(sessions, 0)) }).toEqual({ worker: false, view: false, page: false });
    // Mix my boxes again goes beside it: its review now, its funding once giveme.my, which backs that too, is back. X
    // moved by someone else's mix since, the collateral's box is the wallet's one box not mixed yet, which a mix of the
    // boxes again takes first: that chain's reservation keeps it for that mix (spent.ts), and M goes.
    t.koios.spent.add(`${X}#0`);
    const out = await sessions.againBuild("preprod", false, ADA);
    expect(out.mix).toMatchObject({ boxes: 1, again: true });
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    await sessions.mixOutSubmit("preprod", out.txHash);
    t.koios.addedToAccounts.push(
      await atAccount(t, out.index, out.address, out.txHash, 0, out.payments[0]!.lovelace),
      await atAccount(t, out.index, out.address, out.txHash, 1, "5000000"),
    );
    const sent = t.koios.submitted.length;
    await sessions.advance("preprod", out.index, true);
    const again = t.koios.submitted.slice(sent).flatMap((tx) => txInputs(tx));
    expect(again).toContain(`${M}#0`);
    expect(again).not.toContain(`${box.tx_hash}#${box.tx_index}`);
    // Then that mix goes on its box, the return after it, and no box went into two transactions.
    await busyFor(t, HOUR);
    await sessions.advance("preprod", 0, false);
    const tail = t.koios.submitted.slice(sent).filter((tx) => txInputs(tx).includes(`${box.tx_hash}#${box.tx_index}`));
    expect(new Set(tail.map((tx) => txIdOf(tx))).size).toBe(1);
    expect((await viewOf(sessions, 0)).txs.map((x) => x.kind)).toEqual(["out", "mix", "deposit", "mix", "back"]);
    expect(spentTwice(t)).toEqual([]);
  });

  it("brings its rest back as the rest again when that chain never went, never in a mix of the boxes beside a new Mix my boxes again", CHAINS, async () => {
    // A long chain cut early leaves most of what pays for its mixes: enough for another mix of the boxes.
    const { t, sessions } = await cut({ stopped: CHAIN_CUT(), mix: "confirmed", left: "40000000" });
    // Session 1: Mix my boxes again, pressed while the cut session holds nothing.
    const out = await sessions.againBuild("preprod", false, ADA);
    await sessions.mixOutSubmit("preprod", out.txHash);
    expect(out.index).toBe(1);
    // Session 0's draw runs out: its rest goes as a chain of its own, and the node turns away that chain's first
    // transaction, its collateral's deposit. It stops before any of it went, and still holds nothing.
    t.koios.evaluation = AGREES;
    t.koios.rejectSubmit = "BadInputsUTxO";
    await sessions.advance("preprod", 0, true);
    delete t.koios.rejectSubmit;
    const refused = await viewOf(sessions, 0);
    expect(refused.chain).toMatchObject({ total: 3, sent: 0, stopped: expect.any(String) });
    expect(await holds(sessions, 0)).toEqual({ view: false, page: false });
    // The turned-away deposit let go (RESEND_AFTER_MS), its return is built again: the rest again, the collateral's
    // deposit first, never a chain that mixes X or M again.
    await busyFor(t, 3 * 60_000);
    const before = t.koios.submitted.length;
    const view = await sessions.advance("preprod", 0, true);
    const spent = t.koios.submitted.slice(before).flatMap((tx) => txInputs(tx));
    expect(spent.length).toBeGreaterThan(0);
    expect({ x: spent.includes(`${X}#0`), m: spent.includes(`${M}#0`) }).toEqual({ x: false, m: false });
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "mix", "deposit"]);
    expect(view.chain).toMatchObject({ total: 3, sent: 1 });
    expect(view.mix?.skipped).toBeUndefined();
    expect(await holds(sessions, 0)).toEqual({ view: false, page: false });
  });

  it("brings a tile's Mix's rest back as the rest again too when that chain never went, never into Lovejoin afresh", CHAINS, async () => {
    // What a chain that went in partly left never goes in again (buildBack's `started`), whatever the session.
    const { t, sessions } = await cut({ stopped: CHAIN_CUT(), mix: "confirmed", left: "40000000", tile: true });
    t.koios.evaluation = AGREES;
    t.koios.rejectSubmit = "BadInputsUTxO";
    await sessions.advance("preprod", 0, true);
    delete t.koios.rejectSubmit;
    expect((await viewOf(sessions, 0)).chain).toMatchObject({ total: 3, sent: 0, stopped: expect.any(String) });
    await busyFor(t, 3 * 60_000);
    const view = await sessions.advance("preprod", 0, true);
    // Its collateral's deposit, that mix and the return, never a chain that puts the 40 ₳ into boxes again.
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "mix", "deposit"]);
    expect(view.chain).toMatchObject({ total: 3, sent: 1 });
    expect(view.mix?.skipped).toBeUndefined();
  });

  it("never says a cut chain's mix can't be paid for anymore when its rest's chain never went", CHAINS, async () => {
    // What its later mixes left is too little for another mix of the boxes, which its return must never try.
    const { t, sessions } = await cut({ stopped: CHAIN_CUT(), mix: "confirmed" });
    t.koios.evaluation = AGREES;
    t.koios.rejectSubmit = "BadInputsUTxO";
    await sessions.advance("preprod", 0, true);
    delete t.koios.rejectSubmit;
    await busyFor(t, 3 * 60_000);
    const view = await sessions.advance("preprod", 0, true);
    expect(view.mix?.skipped).toBeUndefined();
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "mix", "deposit"]);
  });

  it("leaves the collateral's box to Mix my boxes again where that took it first: the rest then comes back without its mix", CHAINS, async () => {
    const { t, sessions } = await cut({ stopped: CHAIN_CUT(), mix: "confirmed" });
    t.koios.evaluation = AGREES;
    await sessions.advance("preprod", 0, true);
    // Its deposit in; giveme.my turns that mix down past its wait for a chain behind, so the chain stops there. Its box
    // waits for that mix to be built again (tailBuildable) at the session's next step, a lock's draw maybe before that,
    // and nothing holds it meanwhile.
    t.koios.confirmations = 1;
    const box = await depositIn(t);
    t.collateral.answer = { status: 400, body: { error: "transaction fails validation" } };
    await sessions.advance("preprod", 0, true);
    await busyFor(t, 4 * 60_000);
    await sessions.advance("preprod", 0, true);
    expect((await viewOf(sessions, 0)).chain).toMatchObject({ sent: 1, stopped: expect.any(String) });
    expect((await lastChain(t)).tail!.over).toBeUndefined();
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    // X moved by someone else's mix since: the collateral's box is the wallet's one box not mixed yet.
    t.koios.spent.add(`${X}#0`);
    expect(await sessions.mixingAgain("preprod")).toBe(false);
    const out = await sessions.againBuild("preprod", false, ADA);
    await sessions.mixOutSubmit("preprod", out.txHash);
    t.koios.addedToAccounts.push(
      await atAccount(t, out.index, out.address, out.txHash, 0, out.payments[0]!.lovelace),
      await atAccount(t, out.index, out.address, out.txHash, 1, "5000000"),
    );
    const before = t.koios.submitted.length;
    await sessions.advance("preprod", out.index, true);
    expect(t.koios.submitted.slice(before).flatMap((tx) => txInputs(tx))).toContain(`${box.tx_hash}#${box.tx_index}`);
    // Session 0's next step: its collateral's mix isn't built again on that box, a send of the wallet's took it. The
    // rest comes back without it, and no box went into two transactions.
    const sent = t.koios.submitted.length;
    const view = await sessions.advance("preprod", 0, true);
    expect(t.koios.submitted.slice(sent).flatMap((tx) => txInputs(tx))).not.toContain(`${box.tx_hash}#${box.tx_index}`);
    expect((await lastChain(t)).tail!.over).toBe(true);
    expect(view.txs.at(-1)!.kind).toBe("back");
    expect(spentTwice(t)).toEqual([]);
  });
});

describe("the page reads the worker's hold in the states its copy before 1.9.3 read for itself (1.9.3's gate review, r4#3)", () => {
  /** 1.9.2's copy on the page, as it was: a mix of the boxes again, not over, with no return in its view. */
  const copy192 = (s: SessionView) => !!s.mix?.again && s.stage !== "closed" && s.stage !== "failed" && !s.txs.some((t) => t.kind === "back");

  /** Session 0, a Mix my boxes again with no chain stopped, as `record` has it: the worker's hold, the page's, 1.9.2's copy. */
  async function held(record: Record<string, unknown>) {
    const t = testBalances({ pools: [ADA_POOL] });
    await t.wallet.create(account(12).phrase, PASSWORD);
    const collateral = () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch);
    const lovejoin: LovejoinService = new LovejoinService({
      ...t.deps,
      collateral,
      store: t.store,
      mixingAgain: (network) => sessions.mixingAgain(network),
      pools: async () => [ADA_POOL],
    });
    const sessions: SessionService = new SessionService({
      ...t.deps,
      collateral,
      store: t.store,
      minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
      lovejoin,
      sleep: async () => undefined,
    });
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: t.clock.now - 2 * HOUR,
          mix: { boxes: 1, again: true, pool: ADA, depth: 2, delay: "1-6" },
          auto: { approved: { minAmountOut: "0", fund: { lovelace: "6000000", tokens: [] } } },
          ...record,
        },
      ],
    });
    const [view] = await sessions.list("preprod");
    return { worker: await sessions.mixingAgain("preprod"), page: isMixingAgain(view!), copy192: copy192(view!) };
  }

  it("holds where the worker holds in each, and 1.9.2's copy never let go where the worker held: it held where nothing comes back", async () => {
    const at = 1_800_000_000_000 - 2 * HOUR;
    const states = {
      fundingNeverSent: await held({ txs: [{ kind: "out", txHash: FUNDING, at, unsent: true }] }),
      // The view leaves an unsent transaction out, so the copy never saw that return.
      unsentReturn: await held({
        txs: [
          { kind: "out", txHash: FUNDING, at, confirmed: true },
          { kind: "back", txHash: BACK, at: at + HOUR, unsent: true },
        ],
      }),
      autoFailed: await held({
        txs: [{ kind: "out", txHash: FUNDING, at }],
        auto: { approved: { minAmountOut: "0", fund: { lovelace: "6000000", tokens: [] } }, failed: at + HOUR },
      }),
      nothingBack: await held({
        txs: [
          { kind: "out", txHash: FUNDING, at, confirmed: true },
          { kind: "mix", txHash: X, at: at + HOUR, confirmed: true },
        ],
        chain: { total: 3, last: BACK, at: at + HOUR },
        nothingBack: at + HOUR,
      }),
    };
    expect(states).toEqual({
      fundingNeverSent: { worker: false, page: false, copy192: false },
      unsentReturn: { worker: true, page: true, copy192: true },
      autoFailed: { worker: false, page: false, copy192: false },
      nothingBack: { worker: false, page: false, copy192: true },
    });
  });
});
