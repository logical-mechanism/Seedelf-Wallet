// A swap against Danogo's pools (chunk 24) on its way to the chain and after
// it lands (release review C03, C12): one Koios took that never lands, since
// someone else's swap took its pool first, is built again from the funding
// it spent; and once one lands, nothing comes back before Koios lists what it
// paid the account. Shaped as direct-swaps.test.ts builds them. And once one
// is given up and its swap built again pauses, Stop and Review it myself
// (cross-area review X04).
import { blake2b } from "@noble/hashes/blake2.js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { bodyOutpoints } from "../src/background/cbor";
import type { KoiosUtxo } from "../src/background/koios";
import { DANOGO_POOL } from "../src/background/minswap";
import { NetworkContext } from "../src/ui/network";
import { lateStopOf, StoppedLate, stopReading } from "../src/ui/screens/Swaps";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { bytes, cbor, type Cbor, hex, SESSION_ADDRESS } from "./fixtures/swap-tx";
import { minswapEstimate, sessionSwap } from "./fakes";
import { atSession, bookOf, busy, FUNDING, funded, MIN, signing, started, unlocked, type T } from "./swap-session";

const POOL = DANOGO_POOL.preprod;
const POOL_STAKE = "6e".repeat(28);
/** A pool's address: Danogo's script, under the pool's own staking script (header 0x30, preprod). */
const POOL_ADDRESS = `30${POOL}${POOL_STAKE}`;
const COLLATERAL_VKEY = "c0".repeat(32);
const COLLATERAL_KEY = hex(blake2b(bytes(COLLATERAL_VKEY), { dkLen: 28 }));
const FEE_ADDRESS = `60${"89".repeat(28)}`;
const POOL_IN = `${"b1".repeat(32)}#0`;
const COLLATERAL_IN = `${"c1".repeat(32)}#0`;
/** The session's own 5 ₳ collateral, as its funding pays one. */
const OWN_COLLATERAL = `${"0c".repeat(32)}#1`;

const FUNDED = BigInt(sessionSwap.utxo.value);
const FEE = 600_000n;
const MINSWAP_FEE = 850_000n;
const BOUGHT = BigInt(minswapEstimate.estimate.amount_out);
const PAID_IN = BigInt(minswapEstimate.ask.amount);
/** What comes back to the session in the swap itself, output 2: the change, and the MIN bought. */
const BACK = (fee: bigint) => FUNDED - PAID_IN - fee - MINSWAP_FEE;

const value = (lovelace: bigint, min?: bigint): Cbor =>
  min === undefined
    ? lovelace
    : { raw: hex([0x82, ...cbor(lovelace), 0xa1, 0x58, 0x1c, ...bytes(MIN.slice(0, 56)), 0xa1, 0x43, ...bytes(MIN.slice(56)), ...cbor(min)]) };
const outpointOf = (ref: string): Cbor => [bytes(ref.split("#")[0]!), Number(ref.split("#")[1])];

/** The session's direct swap of 10 ADA for MIN, as Minswap builds it: the funding and a pool's UTxO spent. `fee` sets its id apart. */
function directTx(fee = FEE): string {
  const paid: Array<[string, Cbor, string?]> = [
    [POOL_ADDRESS, value(2_000_000_000n + PAID_IN, 100_000_000_000n - BOUGHT), "d87980"],
    [FEE_ADDRESS, value(MINSWAP_FEE)],
    [SESSION_ADDRESS, value(BACK(fee), BOUGHT)],
  ];
  const withdrawn = { raw: hex([0xa2, ...cbor(bytes(`f0${POOL}`)), ...cbor(0), ...cbor(bytes(`f0${POOL_STAKE}`)), ...cbor(0)]) };
  const body = new Map<number, Cbor>([
    [0, { tag: 258, of: [FUNDING, POOL_IN].map(outpointOf) }],
    [
      1,
      paid.map(([address, v, datum]) => {
        const out = new Map<number, Cbor>([
          [0, bytes(address)],
          [1, v],
        ]);
        if (datum) out.set(2, [1, { tag: 24, of: bytes(datum) }]);
        return out;
      }),
    ],
    [2, Number(fee)],
    [3, 134_639_865],
    [5, withdrawn],
    [13, { tag: 258, of: [COLLATERAL_IN].map(outpointOf) }],
    [18, { tag: 258, of: [[bytes("d1".repeat(32)), 0]] }],
  ]);
  const redeemers: Cbor = [
    [0, 1, { tag: 121, of: [] }, [500_000, 200_000_000]],
    [3, 0, { tag: 121, of: [] }, [500_000, 200_000_000]],
    [3, 1, { tag: 121, of: [] }, [500_000, 200_000_000]],
  ];
  const witnesses = new Map<number, Cbor>([[0, { tag: 258, of: [[bytes(COLLATERAL_VKEY), bytes("5a".repeat(64))]] }]]);
  witnesses.set(5, redeemers);
  return hex(cbor([body, witnesses, true, null]));
}

/** What Koios knows of what isn't the session's: the pool's UTxO, and the collateral's. */
function others(t: T) {
  const row = (ref: string, address: string, lovelace: string, min?: string): KoiosUtxo =>
    ({
      ...atSession(ref.split("#")[0]!, Number(ref.split("#")[1]), lovelace, min ? [[MIN, min]] : []),
      address: bech32("addr_test", bytes(address)),
      payment_cred: address.slice(2, 58),
    }) as KoiosUtxo;
  t.koios.addedToAccounts.push(row(POOL_IN, POOL_ADDRESS, "2000000000", "100000000000"), row(COLLATERAL_IN, `60${COLLATERAL_KEY}`, "3000000"));
}

/** Session 0, funded with the swap's UTxO and its own 5 ₳, its swap against the pools sent: the swap's id. */
async function placed(t: T, sessions: ReturnType<typeof signing>): Promise<string> {
  t.minswap.estimate = { ...minswapEstimate.estimate, aggregator_fee: MINSWAP_FEE.toString() };
  await started(sessions);
  funded(t);
  t.koios.addedToAccounts.push(atSession(OWN_COLLATERAL.split("#")[0]!, 1, "5000000"));
  others(t);
  t.minswap.swapCbor = directTx();
  const view = await sessions.advance("preprod", 0);
  expect(view.auto).toMatchObject({ step: "ordering", againstPools: true });
  expect(view.auto!.paused).toBeUndefined();
  return txIdOf(t.koios.submitted.at(-1)!);
}

describe("a swap against the pools Koios took that never lands (release review C03)", () => {
  it("is built again from the funding it spent once it's gone unseen, rather than refused as spending someone else's", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const first = await placed(t, sessions);
    // Someone else's swap took the pool first: this one never lands. Minswap builds it again, with another id.
    t.koios.missing.add(first);
    t.minswap.swapCbor = directTx(FEE + 2n);
    await busy(t, 16 * 60_000);
    const view = await sessions.advance("preprod", 0, true);
    expect(view.auto!.paused).toBeUndefined();
    expect(view.auto!.retry).toBeUndefined();
    const again = t.koios.submitted.at(-1)!;
    expect(txIdOf(again)).not.toBe(first);
    expect(bodyOutpoints(again, 0)).toContain(FUNDING);
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap"]);
  });
});

describe("a swap against the pools that landed, as Koios lists it (release review C12)", () => {
  it("brings nothing back until Koios lists what it paid the account: never the 5 ₳ alone, and the rest later", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const swap = await placed(t, sessions);
    // On chain, as tx_status says. The listing is a block behind: the funding still there, the proceeds not yet.
    t.clock.now += 15_000;
    let view = await sessions.advance("preprod", 0);
    expect(t.koios.submitted).toHaveLength(2);
    expect(view.auto!.filled).toBe(false);
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap"]);

    // Koios lists them: one return, of the 5 ₳ and the proceeds together.
    t.koios.spent.add(FUNDING);
    t.koios.addedToAccounts.push(atSession(swap, 2, BACK(FEE).toString(), [[MIN, BOUGHT.toString()]]));
    t.clock.now += 15_000;
    view = await sessions.advance("preprod", 0);
    expect(view.auto).toMatchObject({ step: "returning", filled: true });
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "back"]);
    expect(bodyOutpoints(t.koios.submitted.at(-1)!, 0)!.sort()).toEqual([OWN_COLLATERAL, `${swap}#2`].sort());
  });

  it("brings back what's listed once a step isn't looked for anymore: one a fork dropped never shows", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await placed(t, sessions);
    t.clock.now += 15_000;
    await sessions.advance("preprod", 0);
    expect(t.koios.submitted).toHaveLength(2);
    // Fifteen minutes, and Koios still lists none of it: what's there comes back all the same.
    await busy(t, 15 * 60_000);
    const view = await sessions.advance("preprod", 0, true);
    expect(view.auto).toMatchObject({ step: "returning", filled: true });
    expect(bodyOutpoints(t.koios.submitted.at(-1)!, 0)).toEqual([OWN_COLLATERAL]);
  });
});

describe("a swap against the pools given up, its swap built again paused on the price (cross-area review X04)", () => {
  /**
   * Session 0's swap against the pools Koios took, that never lands. Fifteen minutes on, it's given up, and the swap
   * built again pauses: the price is under the approved minimum. The page shows no swap; the record keeps the copy.
   */
  async function pausedAfterGivingUp(t: T, sessions: ReturnType<typeof signing>) {
    const first = await placed(t, sessions);
    t.koios.missing.add(first);
    t.minswap.estimate = { ...t.minswap.estimate, amount_out: "900000000", min_amount_out: "895500000" };
    await busy(t, 16 * 60_000);
    const view = await sessions.advance("preprod", 0, true);
    expect(view.auto!.paused).toMatchObject({ why: "price" });
    expect(view.txs.map((x) => x.kind)).toEqual(["out"]);
    expect((await bookOf(t)).sessions[0]!.txs.find((x) => x.txHash === first)).toMatchObject({ replaced: true, againstPools: true });
    return { first, view };
  }

  it("Stop says the swap that went out went against the pools, never that an order went out to cancel, and brings it all back as before", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const { view } = await pausedAfterGivingUp(t, sessions);
    const { ordered, orderedPools, ...stopped } = await sessions.stop("preprod", 0);
    expect(ordered).toBe(true);
    expect(orderedPools).toBe(true);
    const late = lateStopOf(ordered, stopReading(view).placed, stopped, orderedPools);
    expect(late).toBe("pools");
    const callout = renderToStaticMarkup(createElement(NetworkContext.Provider, { value: "preprod" }, createElement(StoppedLate, { late: late! })));
    expect(callout).not.toContain("An order went out");
    // Stop itself is as it was: no cancel, and the return takes the funding the given-up copy spent.
    expect(stopped.txs.map((x) => x.kind)).toEqual(["out", "back"]);
    expect(bodyOutpoints(t.koios.submitted.at(-1)!, 0)!.sort()).toEqual([FUNDING, OWN_COLLATERAL].sort());
  });

  it("Review it myself builds the swap again from the funding the given-up copy spent, rather than say it was sent already", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await pausedAfterGivingUp(t, sessions);
    t.minswap.swapCbor = directTx(FEE + 4n);
    const review = await sessions.swapBuild("preprod", 0);
    expect(review.txHash).toBe(txIdOf(bytes(directTx(FEE + 4n))));
    expect(review.againstPools).toBe(true);
  });

  it("Review it myself still says it was sent already once the copy given up may have landed, as the runner looks before it builds one again", async () => {
    // The chain shows it, though the paused runner hasn't looked; or Koios lists what it paid the account.
    for (const how of ["tx_status", "listed"] as const) {
      const t = await unlocked();
      const sessions = signing(t);
      const { first } = await pausedAfterGivingUp(t, sessions);
      if (how === "tx_status") t.koios.missing.delete(first);
      else t.koios.addedToAccounts.push(atSession(first, 2, BACK(FEE).toString(), [[MIN, BOUGHT.toString()]]));
      const builds = t.minswap.calls.filter((c) => c.path === "build-tx").length;
      await expect(sessions.swapBuild("preprod", 0), how).rejects.toThrow("This session's swap was sent already.");
      expect(t.minswap.calls.filter((c) => c.path === "build-tx"), how).toHaveLength(builds);
    }
  }, 30_000);
});
