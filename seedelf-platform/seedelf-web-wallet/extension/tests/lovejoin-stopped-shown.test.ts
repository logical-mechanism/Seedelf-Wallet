// A chain through Lovejoin that stopped partway is shown on the Lovejoin page,
// and counted on Home, while it leaves the user something to do: boxes it
// didn't mix, or a transaction that may still have gone through. Once its
// boxes were all mixed again (or brought back), it has nothing more to ask,
// and it goes from both at the next pool read, though its record lives out
// its hours for the rules that read it. Asked live (2026-09-28): a stopped
// chain stayed listed, "stopped at 39 of 49", after its boxes were mixed
// again, with no way to clear it.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { KoiosUtxo } from "../src/background/koios";
import { CHAIN_CUT } from "../src/background/lovejoin";
import { busyFor, loadTestWasm, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const HOUR = 3_600_000;
const PHRASE = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase;
const SLOW = { timeout: 30_000 };

/** Lovejoin's preprod pool, as Koios lists it (2026-09-25). */
const POOL = (
  JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }
).pool;

type T = ReturnType<typeof testBalances>;

/** A box of the wallet's in the pool, output `txIndex` of `tx`: a fresh re-randomization of the Seedelf key's register. */
async function ownedBox(t: T, tx: string, txIndex: number): Promise<KoiosUtxo> {
  const wasm = loadTestWasm();
  const datum = await t.wallet.withKeys((keys) => wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister())));
  return { ...POOL[0]!, tx_hash: tx, tx_index: txIndex, inline_datum: { bytes: Buffer.from(datum).toString("hex"), value: {} } };
}

const DEPOSIT = "d9".repeat(32);

/** A session's return chain a lock cut after its deposit, an hour ago: both its boxes are still the deposit's. */
function cutChain(t: T, extra: object = {}) {
  return {
    id: "a9".repeat(32),
    session: 0,
    progress: "seedelf.lovejoin.chain.preprod.0",
    deposit: DEPOSIT,
    mixes: ["a8".repeat(32), "a9".repeat(32)],
    leaves: [
      { txHash: "a8".repeat(32), txIndex: 0 },
      { txHash: "a9".repeat(32), txIndex: 0 },
    ],
    boxes: 2,
    total: 3,
    sent: 1,
    at: t.clock.now - HOUR,
    scheduled: true,
    stopped: CHAIN_CUT(),
    ended: t.clock.now - HOUR,
    ...extra,
  };
}

async function wallet(): Promise<T> {
  const t = testBalances();
  await t.wallet.create(PHRASE, PASSWORD);
  t.koios.addedToAccounts.push(...POOL);
  return t;
}

describe("a stopped chain on the Lovejoin page and Home", SLOW, () => {
  it("is shown while boxes it didn't mix wait, and goes once they were all mixed again, while its record stays", async () => {
    const t = await wallet();
    const boxes = [await ownedBox(t, DEPOSIT, 0), await ownedBox(t, DEPOSIT, 1)];
    t.koios.addedToAccounts.push(...boxes);
    await t.store.set("lovejoin.preprod", { due: [], chains: [cutChain(t)] });

    let status = await t.lovejoin.status("preprod");
    expect(status.notMixed).toHaveLength(2);
    expect(status.chains).toEqual([expect.objectContaining({ stopped: CHAIN_CUT(), sent: 1, total: 3 })]);
    expect(await t.lovejoin.held("preprod")).toMatchObject({ notMixed: 2, stopped: 1 });

    // Mix my boxes again spent both: the pool no longer lists them as the wallet's.
    t.koios.addedToAccounts.splice(t.koios.addedToAccounts.indexOf(boxes[0]!), 2);
    status = await t.lovejoin.status("preprod");
    expect(status.notMixed).toEqual([]);
    expect(status.chains).toEqual([]);
    expect(await t.lovejoin.held("preprod")).toMatchObject({ notMixed: 0, stopped: 0 });
    // The record itself lives out its hours: the rules that read it still have it.
    const kept = (await t.store.get<{ chains: Array<{ id: string; left?: number }> }>("lovejoin.preprod"))!;
    expect(kept.chains).toEqual([expect.objectContaining({ id: "a9".repeat(32), left: 0, found: true })]);
  });

  it("stays while one of its boxes is left, and while a transaction of it may have gone through", async () => {
    const t = await wallet();
    const one = await ownedBox(t, DEPOSIT, 0);
    t.koios.addedToAccounts.push(one);
    const maybe = { index: 1, txHash: "a8".repeat(32), inputs: [`${DEPOSIT}#1`], at: t.clock.now - HOUR };
    await t.store.set("lovejoin.preprod", {
      due: [],
      chains: [cutChain(t), cutChain(t, { id: "b9".repeat(32), deposit: "db".repeat(32), session: undefined, maybe })],
    });
    const status = await t.lovejoin.status("preprod");
    // The first still leaves one box to mix; the second has none, but may have gone through.
    expect(status.chains).toHaveLength(2);
    expect(await t.lovejoin.held("preprod")).toMatchObject({ stopped: 2 });
  });

  it("stays while no read has found its boxes yet: its deposit may not be in", async () => {
    const t = await wallet();
    await t.store.set("lovejoin.preprod", { due: [], chains: [cutChain(t)] });
    // Read twice, nothing of it listed: it isn't taken for one whose boxes all moved on.
    for (let i = 0; i < 2; i++) {
      expect((await t.lovejoin.status("preprod")).chains).toEqual([expect.objectContaining({ stopped: CHAIN_CUT() })]);
    }
    expect(await t.lovejoin.held("preprod")).toMatchObject({ stopped: 1 });
  });

  it("is counted on Home until a pool read has counted what it left", async () => {
    const t = await wallet();
    await t.store.set("lovejoin.preprod", { due: [], chains: [cutChain(t)] });
    // No pool read since it stopped: Home, which reads nothing, still says it stopped.
    expect(await t.lovejoin.held("preprod")).toMatchObject({ stopped: 1 });
  });
});

// 1.6.0's gate, LIVE-1 (its live run on preprod, wallet B): a lock cut a session's chain once its deposit and its mixes
// went, and its return built the rest again as a chain of its own, which went. The records as that run left them read
// as stopped partway on Home, under Chains and on the mix's card, at every read, every box of it mixed.
describe("a stopped chain whose rest its session's return brought back since (1.6.0's gate, LIVE-1)", SLOW, () => {
  /** The 5 ₳ pool's id. */
  const FIVE = "f5".repeat(28);
  const CUT = "c8".repeat(32);
  const box = (tx: string, pool?: string) => ({ txHash: tx.repeat(32), txIndex: 0, ...(pool ? { pool } : {}) });

  /** The live run's chain: cut once its deposit and four mixes went, before its collateral's deposit and mix and its return. */
  function cut(t: T, extra: object = {}) {
    return {
      id: CUT,
      session: 0,
      progress: "seedelf.session.chain.preprod.0",
      deposit: "c1".repeat(32),
      mixes: ["c2", "c3", "c4", "c5"].map((h) => h.repeat(32)),
      leaves: [box("c5"), box("c7", FIVE)],
      tail: { deposit: "c6".repeat(32), mix: "c7".repeat(32), pool: FIVE, box: box("c6", FIVE), leaf: box("c7", FIVE), tries: 1 },
      boxes: 1,
      total: 8,
      sent: 5,
      at: t.clock.now - HOUR,
      scheduled: true,
      stopped: CHAIN_CUT(),
      cut: true,
      ended: t.clock.now - HOUR / 2,
      // A pool read since found nothing of it left the wallet's, not mixed: its one box is at its leaf.
      left: 0,
      ...extra,
    };
  }

  /** What its return built in its place (Session 11's call 1): its collateral's deposit and mix, then the return, all sent. */
  function rest(t: T, extra: object = {}) {
    return {
      id: "d8".repeat(32),
      session: 0,
      progress: "seedelf.session.chain.preprod.0",
      mixes: [],
      leaves: [box("d7", FIVE)],
      tail: { deposit: "d6".repeat(32), mix: "d7".repeat(32), pool: FIVE, box: box("d6", FIVE), leaf: box("d7", FIVE), tries: 1, scheduled: true },
      boxes: 0,
      total: 3,
      sent: 3,
      at: t.clock.now - HOUR / 4,
      done: true,
      ended: t.clock.now - HOUR / 8,
      ...extra,
    };
  }

  /** What Home, Chains and the cut chain's card in Your mixes say, from the device alone. */
  async function pages(t: T) {
    const held = await t.lovejoin.held("preprod");
    const rows = await t.lovejoin.chains("preprod");
    const entry = (await t.lovejoin.mixes("preprod")).find((e) => e.id === CUT)!;
    return { stopped: held.stopped, rows, chain: entry.chain };
  }

  /** The schedule holding `chains`, its box's due time and each chain's mix, as on the device. */
  async function keep(t: T, chains: object[], mixes: object[] = []) {
    await t.store.set("lovejoin.preprod", {
      due: [t.clock.now + HOUR],
      chains,
      mixes: [{ id: CUT, deposit: "c1".repeat(32), at: t.clock.now - HOUR, session: 0, shares: [{ boxes: 1 }] }, ...mixes],
    });
  }

  /** keep, then pages. */
  async function reads(t: T, chains: object[], mixes: object[] = []) {
    await keep(t, chains, mixes);
    return pages(t);
  }

  it("reads as the done chain it is, kept as the live run left it: at the next read, with nothing written", async () => {
    const t = await wallet();
    await keep(t, [cut(t), rest(t)], [{ id: "d8".repeat(32), at: t.clock.now - HOUR / 4, session: 0, shares: [{ pool: FIVE, boxes: 1 }] }]);
    const before = JSON.stringify(await t.store.get("lovejoin.preprod"));
    expect(await pages(t)).toEqual({ stopped: 0, rows: [], chain: { total: 8, sent: 5, done: true } });
    // Its box still comes back by itself, and nothing is said not mixed yet.
    expect(await t.lovejoin.held("preprod")).toMatchObject({ boxes: 1, notMixed: 0 });
    // Read so, not marked: the records stay as they were for the rules that read them.
    expect(JSON.stringify(await t.store.get("lovejoin.preprod"))).toBe(before);
  });

  it("still reads as stopped while its rest is still to come back: none built in its place, or one that stopped too", async () => {
    const t = await wallet();
    // Unlocked, its return not built again yet.
    expect(await reads(t, [cut(t)])).toMatchObject({ stopped: 1, rows: [expect.objectContaining({ stopped: CHAIN_CUT(), sent: 5 })], chain: { stopped: CHAIN_CUT() } });
    // Built again, and stopped short of its end as well.
    const short = rest(t, { done: undefined, sent: 1, stopped: CHAIN_CUT(), cut: true, tail: { ...rest(t).tail, scheduled: undefined } });
    expect((await reads(t, [cut(t), short])).chain).toMatchObject({ stopped: CHAIN_CUT() });
    expect((await reads(t, [cut(t), short])).stopped).toBe(2);
    // Another session's, all sent: not this one's rest.
    expect((await reads(t, [cut(t), rest(t, { session: 1 })])).stopped).toBe(1);
    // A chain of its session's recorded before it, all sent: no rest of this one's either.
    expect((await reads(t, [rest(t), cut(t)])).stopped).toBe(1);
  });

  it("still reads as stopped where a box of its own may wait to be mixed: a mix of it unsent, or its collateral's box no chain took over", async () => {
    const t = await wallet();
    // Cut before its fourth mix went.
    expect((await reads(t, [cut(t, { sent: 4 }), rest(t)])).chain).toMatchObject({ stopped: CHAIN_CUT(), sent: 4 });
    // Cut once its collateral's deposit went, its box waiting for its mix; the chain in its place put in a 5 ₳ of its own.
    expect((await reads(t, [cut(t, { sent: 6 }), rest(t)])).stopped).toBe(1);
    // Its box taken over by the chain in its place, that mix built again and sent with the return (tailChain): done.
    const over = cut(t, { sent: 6, tail: { ...cut(t).tail, over: true } });
    const again = rest(t, { total: 2, sent: 2, tail: { ...rest(t).tail, deposit: "c6".repeat(32), box: box("c6", FIVE) } });
    expect(await reads(t, [over, again])).toEqual({ stopped: 0, rows: [], chain: { total: 8, sent: 6, done: true } });
  });

  it("reads as done once its session's return came back directly, its hold as it was where it's a Bootstrap's", async () => {
    const t = await wallet();
    // A chain with no collateral's mix (Settings' switch off, or no 5 ₳ pool), cut short of its return alone.
    const plain = cut(t, { total: 6, leaves: [box("c5")], tail: undefined });
    expect((await reads(t, [plain])).stopped).toBe(1);
    await t.lovejoin.restBack("preprod", 0);
    expect(await pages(t)).toEqual({ stopped: 0, rows: [], chain: { total: 6, sent: 5, done: true } });
    // Another session's return marks nothing of its.
    await keep(t, [plain]);
    await t.lovejoin.restBack("preprod", 1);
    expect((await pages(t)).stopped).toBe(1);
    // Its collateral's box left waiting for its mix: still the wallet's not mixed yet, so nothing is marked. Nor where
    // that mix was built again (tailChain) and stopped before it went: the box still waits.
    const handed = cut(t, { sent: 6, tail: { ...cut(t).tail, over: true } });
    const resumed = rest(t, { total: 2, sent: 0, done: undefined, stopped: CHAIN_CUT(), cut: true, tail: { ...rest(t).tail, deposit: "c6".repeat(32), box: box("c6", FIVE), scheduled: undefined } });
    for (const chains of [[cut(t, { sent: 6 })], [handed, resumed]]) {
      await t.store.set("lovejoin.preprod", { due: [], chains });
      const before = JSON.stringify(await t.store.get("lovejoin.preprod"));
      await t.lovejoin.restBack("preprod", 0);
      expect(JSON.stringify(await t.store.get("lovejoin.preprod"))).toBe(before);
    }
    // A Bootstrap cut after its deposit: its boxes are still held, until brought back by hand.
    const deposit = "b1".repeat(32);
    const bootstrap = { ...plain, id: "b8".repeat(32), deposit, mixes: [], leaves: [box("b1")], bootstrap: true, total: 2, sent: 1, scheduled: undefined };
    await t.store.set("lovejoin.preprod", {
      due: [],
      chains: [bootstrap],
      mixes: [{ id: bootstrap.id, deposit, at: bootstrap.at, session: 0, bootstrap: true, shares: [{ boxes: 1 }] }],
    });
    expect(await t.lovejoin.held("preprod")).toMatchObject({ stopped: 1, bootstrap: 1 });
    await t.lovejoin.restBack("preprod", 0);
    expect(await t.lovejoin.held("preprod")).toMatchObject({ stopped: 0, bootstrap: 1 });
    expect((await t.lovejoin.mixes("preprod"))[0]).toMatchObject({ bootstrap: true, chain: { total: 2, sent: 1, done: true } });
  });

  // 1.6.0's gate, last-5's first low: the chain built in its place records no delay of its own, so its record goes
  // RECORD_KEEP_MS after it ended, while the cut chain's is kept for Settings' delay's least, 6 h at 6–24 h.
  it("stays done once the record of the chain built in its place goes before its own, kept by Settings' 6–24 h delay (1.6.0's gate, last-5's first low)", async () => {
    const t = await wallet();
    // Its one box at its leaf in the classic pool, due once Settings' 6–24 h are out.
    t.koios.addedToAccounts.push(await ownedBox(t, "c5".repeat(32), 0));
    const due = [t.clock.now + 6 * HOUR];
    const own = { id: CUT, deposit: "c1".repeat(32), at: t.clock.now - HOUR, session: 0, shares: [{ boxes: 1 }] };
    const its = { id: "d8".repeat(32), at: t.clock.now - HOUR / 4, session: 0, shares: [{ pool: FIVE, boxes: 1 }] };
    const records = async () =>
      (await t.store.get<{ chains: Array<{ id: string; restBack?: true }> }>("lovejoin.preprod"))!.chains.map(({ id, restBack }) => ({ id, ...(restBack ? { restBack } : {}) }));
    // Its rest still to come back: a pool read marks nothing, and it still says it stopped.
    await t.store.set("lovejoin.preprod", { due, chains: [cut(t, { delay: "6-24" })], mixes: [own] });
    await t.lovejoin.status("preprod");
    expect(await pages(t)).toMatchObject({ stopped: 1, chain: { stopped: CHAIN_CUT() } });
    expect(await records()).toEqual([{ id: CUT }]);
    // The chain built in its place went: done, as it is.
    await t.store.set("lovejoin.preprod", { due, chains: [cut(t, { delay: "6-24" }), rest(t)], mixes: [own, its] });
    expect(await pages(t)).toEqual({ stopped: 0, rows: [], chain: { total: 8, sent: 5, done: true } });
    // Three hours on, a pool read lets that chain's record go and keeps the cut chain's: still done.
    await busyFor(t, 3 * HOUR);
    await t.lovejoin.status("preprod");
    expect(await pages(t)).toEqual({ stopped: 0, rows: [], chain: { total: 8, sent: 5, done: true } });
    // Read so from its own record, which keeps it.
    expect(await records()).toEqual([{ id: CUT, restBack: true }]);
  });
});
