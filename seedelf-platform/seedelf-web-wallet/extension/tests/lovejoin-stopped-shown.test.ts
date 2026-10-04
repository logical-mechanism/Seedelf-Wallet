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
import { loadTestWasm, testBalances, vectors } from "./fakes";

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
