// Lovejoin's due times against the pool: a run keeps one per box it finds,
// counted from the schedule as it is when it's changed, so a chain the user
// sends while the run reads the pool keeps its boxes' times, and no box goes
// back while that chain is sent (independent review L29). The real
// WebAssembly, v2's 5 ₳ pool (the classic pool, retired, brings its boxes all
// back at the first run, with no due time: chunk 44), and fakes of Koios and
// giveme.my.
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { LovejoinService } from "../src/background/lovejoin";
import { SESSION_UNLOCKED_AT } from "../src/background/wallet";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, testBalances, vectors } from "./fakes";
import { ADA, ADA_POOL, ADA_ROWS, adaBox, madeByAdaMix, ownDatum } from "./v2-pools";

const PASSWORD = "correct horse battery";
const HOUR = 3_600_000;
const PHRASE = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase;
/** Each withdraw is built and measured in WebAssembly: past Vitest's 5 s on CI's runners. */
const SLOW = { timeout: 30_000 };

type T = ReturnType<typeof testBalances>;

/** A box of ours in the pool: a fresh re-randomization of the Seedelf key's register. */
async function ownedBox(t: T, tx: string) {
  // Someone else's mix moved it: Koios says so, as the wallet asks before it takes a box no record accounts for (M14).
  madeByAdaMix(t.koios, tx.repeat(32));
  return adaBox(tx, await ownDatum(t.wallet), t.clock.now);
}

/**
 * An unlocked wallet, unlocked an hour ago with its unlock's draws made, with
 * Lovejoin's pool and one box of its own in it, and `due` due times; and
 * Lovejoin with giveme.my's witness stood in for.
 */
async function withBox(due: (now: number) => number[]) {
  const t = testBalances({ pools: [ADA_POOL] });
  await t.wallet.create(PHRASE, PASSWORD);
  t.koios.addedToAccounts.push(...ADA_ROWS, await ownedBox(t, "d1"));
  const unlocked = t.clock.now - HOUR;
  await t.wallet.withKeys(() => t.session.set(SESSION_UNLOCKED_AT, unlocked));
  await t.store.set("lovejoin.preprod", { due: [], pools: { [ADA]: { due: due(t.clock.now) } }, unlock: unlocked });
  const wasm = loadTestWasm();
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  const lovejoin = new LovejoinService({
    ...t.deps,
    wasm: {
      ...wasm,
      finishLovejoinWithdraw: (request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    pools: async () => [ADA_POOL],
  });
  return { t, lovejoin };
}

/** The 5 ₳ pool's due times. */
const due = async (t: T) => {
  const s = (await t.store.get<{ pools?: Record<string, { due: number[] }> }>("lovejoin.preprod"))!;
  return s.pools?.[ADA]?.due ?? [];
};

describe("a box's due times against the pool (independent review L29)", SLOW, () => {
  it("keeps those a chain sent while the run read the pool set, and brings no box back while it's sent", async () => {
    const { t, lovejoin } = await withBox((now) => [now - HOUR]);
    // Koios holds the run's pool read.
    let release!: () => void;
    t.koios.hold = new Promise((r) => (release = r));
    const run = lovejoin.withdrawDue("preprod", false, t.clock.now);
    while (!t.koios.calls.some((c) => c.path === "credential_utxos")) await new Promise((r) => setTimeout(r, 5));
    // Meanwhile the user sends a session's return through Lovejoin: its chain is recorded, and its deposit sets two boxes' times.
    const key = "seedelf.lovejoin.sending.preprod";
    const txs = (["deposit", "mix"] as const).map((kind, i) => ({ kind, txCbor: "", txHash: "a1".repeat(31) + `0${i}`, fee: "0" }));
    await t.lovejoin.recordChain("preprod", { progress: key, txs, leaves: [], boxes: 2, pools: { [ADA]: 2 } });
    await t.wallet.withKeys(() => t.session.set(key, { txs, next: 1, flying: [] }));
    await t.lovejoin.chainSent("preprod", txs.at(-1)!.txHash, 0);
    const drawn = await due(t);
    expect(drawn).toHaveLength(3);
    t.koios.hold = undefined;
    release();
    expect(await run).toEqual([]);
    // All three are kept: the read found one box, but the chain's two aren't in the pool yet.
    expect((await due(t)).sort()).toEqual([...drawn].sort());
    expect(t.collateral.asked).toHaveLength(0);
  });

  it("still drops a due time no box is left for, with no chain sent meanwhile", async () => {
    const { t, lovejoin } = await withBox((now) => [now - 2 * HOUR, now - HOUR]);
    const [pending] = await lovejoin.withdrawDue("preprod", false, t.clock.now);
    expect(pending?.kind).toBe("lovejoin-withdraw");
    expect(await due(t)).toEqual([]);
  });
});
