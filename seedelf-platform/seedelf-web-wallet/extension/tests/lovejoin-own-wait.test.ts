// A box comes back only once it has waited its own chain's delay's least
// since that chain went in: a swap approved to wait 6 to 24 hours keeps that
// wait although Settings say 1 to 6 hours now, and another chain's earlier
// due time brings that chain's own box back instead, or waits. Among the
// boxes that have waited, the order is as before (privacy review §3.6). A
// chain's record stays until its boxes have waited, even past the time an
// ended record is kept (final review F9, independent review L21).
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService, WITHDRAW_SPREAD_MS } from "../src/background/lovejoin";
import { SESSION_UNLOCKED_AT } from "../src/background/wallet";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const HOUR = 3_600_000;
const MINUTE = 60_000;
const PHRASE = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase;
const SLOW = { timeout: 30_000 };
const POOL = (
  JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }
).pool;

type T = ReturnType<typeof testBalances>;

/** A box of ours in the pool, where tx `tx` put it at `at` (ms). */
async function ownedBox(t: T, tx: string, at: number): Promise<KoiosUtxo> {
  const wasm = loadTestWasm();
  const datum = await t.wallet.withKeys((keys) => wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister())));
  return {
    ...POOL[0]!,
    tx_hash: tx.repeat(32),
    tx_index: 0,
    block_time: Math.floor(at / 1000),
    inline_datum: { bytes: Buffer.from(datum).toString("hex"), value: {} },
  };
}

/** A session's chain, all sent, whose one box's last mix (`tx`) put it in the pool: recorded at `at`, waiting `delay`. */
const chain = (session: number, tx: string, at: number, delay: string) => ({
  id: `${tx.slice(0, 1)}f`.repeat(32),
  session,
  progress: `seedelf.session.chain.preprod.${session}`,
  deposit: `${tx.slice(0, 1)}0`.repeat(32),
  mixes: [tx.repeat(32)],
  leaves: [{ txHash: tx.repeat(32), txIndex: 0 }],
  boxes: 1,
  total: 3,
  sent: 3,
  at,
  scheduled: true,
  done: true,
  ended: at + 10 * MINUTE,
  delay,
});

/**
 * An unlocked wallet (its unlock's draws made), Settings' delay 1 to 6 hours,
 * and two boxes in the pool: a swap's, whose chain went in `swapAgo` ago
 * approved to wait 6 to 24 hours, and another return's, which went in
 * `otherAgo` ago at 1 to 6 hours; due times `due`.
 */
async function pooled(swapAgo: number, otherAgo: number, due: (now: number) => number[]) {
  const t = testBalances();
  await t.wallet.create(PHRASE, PASSWORD);
  await t.preferences.set({ lovejoinDelay: "1-6" });
  const now = t.clock.now;
  const swapAt = now - swapAgo;
  const otherAt = now - otherAgo;
  t.koios.addedToAccounts.push(...POOL, await ownedBox(t, "a1", swapAt + 5 * MINUTE), await ownedBox(t, "b1", otherAt + 5 * MINUTE));
  const unlocked = now - 2 * HOUR;
  await t.wallet.withKeys(() => t.session.set(SESSION_UNLOCKED_AT, unlocked));
  await t.store.set("lovejoin.preprod", {
    due: due(now),
    unlock: unlocked,
    chains: [chain(0, "a1", swapAt, "6-24"), chain(1, "b1", otherAt, "1-6")],
  });
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
  });
  return { t, lovejoin };
}

const SWAP = `${"a1".repeat(32)}#0`;
const OTHER = `${"b1".repeat(32)}#0`;
const spends = (t: T) => txInputs(t.koios.submitted.at(-1)!);
const kept = async (t: T) => (await t.store.get<{ due: number[]; chains: Array<{ session: number }> }>("lovejoin.preprod"))!;

describe("a box and its own chain's wait (final review F9)", SLOW, () => {
  it("brings back the other chain's box at its due time, never the swap's before its approved wait", async () => {
    // The swap went in 90 minutes ago, the other return 80: the first due time is the other's.
    const { t, lovejoin } = await pooled(90 * MINUTE, 80 * MINUTE, (now) => [now - MINUTE, now + 18 * HOUR]);
    const [pending] = await lovejoin.withdrawDue("preprod", false, t.clock.now);
    expect(pending).toBeDefined();
    expect(spends(t)).toContain(OTHER);
    expect(spends(t)).not.toContain(SWAP);
  });

  it("waits, when only the swap's box is there, until it has waited its own least, and a fresh draw past it", async () => {
    const { t, lovejoin } = await pooled(90 * MINUTE, 80 * MINUTE, (now) => [now - MINUTE]);
    // The other chain's box has gone back already.
    t.koios.spent.add(OTHER);
    const now = t.clock.now;
    expect(await lovejoin.withdrawDue("preprod", false, now)).toEqual([]);
    expect(t.collateral.asked).toHaveLength(0);
    const [moved] = (await kept(t)).due;
    const ripe = now - 90 * MINUTE + 6 * HOUR;
    expect(moved).toBeGreaterThanOrEqual(ripe + WITHDRAW_SPREAD_MS[0]);
    expect(moved).toBeLessThanOrEqual(ripe + WITHDRAW_SPREAD_MS[1]);
  });

  it("keeps the swap's chain record, past an ended record's time, until its box has waited: its wait still holds", async () => {
    // The swap went in four hours ago and ended long since; the other return two.
    const { t, lovejoin } = await pooled(4 * HOUR, 2 * HOUR, (now) => [now - MINUTE, now + 18 * HOUR]);
    const [pending] = await lovejoin.withdrawDue("preprod", false, t.clock.now);
    expect(pending).toBeDefined();
    expect(spends(t)).toContain(OTHER);
    expect((await kept(t)).chains.map((c) => c.session)).toContain(0);
  });

  it("brings the swap's box back in the pool's order once it has waited its own least", async () => {
    // Both have waited their own: the older, the swap's, goes first, as before.
    const { t, lovejoin } = await pooled(7 * HOUR, 2 * HOUR, (now) => [now - MINUTE, now + HOUR]);
    await lovejoin.withdrawDue("preprod", false, t.clock.now);
    expect(spends(t)).toContain(SWAP);
  });
});
