// Mix my boxes again whose chain a lock cut partway (the owner, 2026-11-20): the boxes it didn't mix wait in the pool,
// and Mix my boxes again takes them first. A stopped chain never sends again (markCut, sendChain's stop), and what it
// left at its account comes back directly (buildBack's `started`), so it spends none of the wallet's boxes: nothing is
// held for it. Its return waits the unlock's draw (privacy review §3.1), as every send does, and the hold that waited
// for that return kept every way of mixing again, Bring one back now and Lovejoin's own withdraws off for a day.
// One still being sent, one with a transaction maybe on its way, and one stopped before any of it went, which the
// runner builds again over the same boxes, still hold them. The real WebAssembly, Lovejoin v2's 5 ₳ pool, and fakes.
import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { CHAIN_CUT, LovejoinService } from "../src/background/lovejoin";
import { Minswap } from "../src/background/minswap";
import { SessionService } from "../src/background/sessions";
import { isMixingAgain } from "../src/ui/screens/Lovejoin";
import { account, AGREES, atSession, HOUR, PASSWORD, type Tested } from "./chain-fixtures";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, testBalances, withdrawPreprod } from "./fakes";
import { ADA, ADA_POOL, ADA_ROWS, adaBox, madeByAdaMix, ownDatum } from "./v2-pools";

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
  const lovejoin: LovejoinService = new LovejoinService({
    ...t.deps,
    collateral,
    store: t.store,
    mixingAgain: (network) => sessions.mixingAgain(network),
    pools: async () => [ADA_POOL],
  });
  const sessions: SessionService = new SessionService({
    ...t.deps,
    // giveme.my's witness and the one-time key's signature stood in for, as sessions.test.ts does.
    wasm: {
      ...wasm,
      signScriptSpend: (_key: unknown, request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
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
    again: true,
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
        mix: { boxes: 1, again: true, pool: ADA, depth: 2, delay: "1-6" },
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
  t.koios.addedToAccounts.push(atSession(hash("e3"), 0, "4000000"), atSession(hash("e3"), 1, "5000000"));
  return { t, lovejoin, sessions };
}

/** A UTxO at session `index`'s one-time account (`address`), as Koios lists it. */
async function atAccount(t: Tested, index: number, address: string, txHash: string, txIndex: number, value: string): Promise<KoiosUtxo> {
  const keyHash = await t.wallet.withKeys((keys) => keys.oneTime.keyHash(index));
  return { ...atSession(txHash, txIndex, value), address, payment_cred: keyHash };
}

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
});
