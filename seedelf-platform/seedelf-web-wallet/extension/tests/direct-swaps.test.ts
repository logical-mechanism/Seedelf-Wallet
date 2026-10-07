// A direct swap through Minswap's router (chunk 24): Danogo's pools, swapped
// against in the swap itself, with no order. Shaped like the one Minswap's
// preprod aggregator built on 2026-10-06: the session's funding and a pool's
// UTxO spent, a collateral its owner signed already, zero withdrawals from
// Danogo's script and the pool's staking script, the pool recreated,
// Minswap's fee, and the proceeds back to the session.
import { blake2b } from "@noble/hashes/blake2.js";
import { describe, expect, it } from "vitest";

import type { KoiosUtxo } from "../src/background/koios";
import { DANOGO_POOL, outOfPlace, witnessedKeys } from "../src/background/minswap";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { bytes, cbor, type Cbor, hex, SESSION_ADDRESS } from "./fixtures/swap-tx";
import { minswapEstimate, sessionSwap } from "./fakes";
import { atSession, FUNDING, funded, MIN, signing, started, unlocked, type T } from "./swap-session";

const POOL = DANOGO_POOL.preprod;
const POOL_STAKE = "6e".repeat(28);
/** A pool's address: Danogo's script, under the pool's own staking script (header 0x30, preprod). */
const POOL_ADDRESS = `30${POOL}${POOL_STAKE}`;
const COLLATERAL_VKEY = "c0".repeat(32);
const COLLATERAL_KEY = hex(blake2b(bytes(COLLATERAL_VKEY), { dkLen: 28 }));
const FEE_ADDRESS = `60${"89".repeat(28)}`;
const POOL_IN = `${"b1".repeat(32)}#0`;
const COLLATERAL_IN = `${"c1".repeat(32)}#0`;

const FUNDED = BigInt(sessionSwap.utxo.value);
const FEE = 600_000n;
const MINSWAP_FEE = 850_000n;
const BOUGHT = BigInt(minswapEstimate.estimate.amount_out);
const PAID_IN = BigInt(minswapEstimate.ask.amount);

/** A value: ADA, and MIN when `min` is given. */
const value = (lovelace: bigint, min?: bigint): Cbor =>
  min === undefined
    ? lovelace
    : { raw: hex([0x82, ...cbor(lovelace), 0xa1, 0x58, 0x1c, ...bytes(MIN.slice(0, 56)), 0xa1, 0x43, ...bytes(MIN.slice(56)), ...cbor(min)]) };
const outpointOf = (ref: string): Cbor => [bytes(ref.split("#")[0]!), Number(ref.split("#")[1])];

type Out = [address: string, value: Cbor, datum?: string];

/** The session's direct swap of 10 ADA for MIN, as Minswap builds it, with any part in its place. */
function directTx({
  spends = [FUNDING, POOL_IN],
  collateral = [COLLATERAL_IN],
  withdrawals = [
    [`f0${POOL}`, 0],
    [`f0${POOL_STAKE}`, 0],
  ],
  outputs,
  bought = BOUGHT,
  witnessed = true,
}: {
  spends?: string[];
  collateral?: string[];
  withdrawals?: Array<[string, number]>;
  outputs?: Out[];
  bought?: bigint;
  witnessed?: boolean;
} = {}): string {
  const paid: Out[] = outputs ?? [
    [POOL_ADDRESS, value(2_000_000_000n + PAID_IN, 100_000_000_000n - bought), "d87980"],
    [FEE_ADDRESS, value(MINSWAP_FEE)],
    [SESSION_ADDRESS, value(FUNDED - PAID_IN - FEE - MINSWAP_FEE, bought)],
  ];
  const withdrawn = { raw: hex([0xa0 + withdrawals.length, ...withdrawals.flatMap(([account, n]) => [...cbor(bytes(account)), ...cbor(n)])]) };
  const body = new Map<number, Cbor>([
    [0, { tag: 258, of: spends.map(outpointOf) }],
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
    [2, Number(FEE)],
    [3, 134_639_865],
    [5, withdrawn],
    [13, { tag: 258, of: collateral.map(outpointOf) }],
    [18, { tag: 258, of: [[bytes("d1".repeat(32)), 0]] }],
  ]);
  const redeemers: Cbor = [
    [0, 1, { tag: 121, of: [] }, [500_000, 200_000_000]],
    [3, 0, { tag: 121, of: [] }, [500_000, 200_000_000]],
    [3, 1, { tag: 121, of: [] }, [500_000, 200_000_000]],
  ];
  const witnesses = new Map<number, Cbor>(witnessed ? [[0, { tag: 258, of: [[bytes(COLLATERAL_VKEY), bytes("5a".repeat(64))]] }]] : []);
  witnesses.set(5, redeemers);
  return hex(cbor([body, witnesses, true, null]));
}

/** What Koios knows of what isn't the session's: the pool's UTxO, and the collateral's. */
function others(t: T, { pool = POOL_ADDRESS, collateral = `60${COLLATERAL_KEY}` } = {}) {
  const row = (ref: string, address: string, lovelace: string, min?: string): KoiosUtxo =>
    ({
      ...atSession(ref.split("#")[0]!, Number(ref.split("#")[1]), lovelace, min ? [[MIN, min]] : []),
      address: bech32("addr_test", bytes(address)),
      payment_cred: address.slice(2, 58),
    }) as KoiosUtxo;
  t.koios.addedToAccounts.push(row(POOL_IN, pool, "2000000000", "100000000000"), row(COLLATERAL_IN, collateral, "3000000"));
}

/** Session 0, funded, with Minswap's fee quoted and approved, and `swapCbor` what Minswap builds. */
async function placing(swapCbor: string, foreign: Parameters<typeof others>[1] = {}) {
  const t = await unlocked();
  const sessions = signing(t);
  t.minswap.estimate = { ...minswapEstimate.estimate, aggregator_fee: MINSWAP_FEE.toString() };
  await started(sessions);
  funded(t);
  others(t, foreign);
  t.minswap.swapCbor = swapCbor;
  const view = await sessions.advance("preprod", 0);
  return { t, sessions, view };
}

describe("a direct swap against Danogo's pools", () => {
  it("is signed beside its collateral owner's signature, and once it lands it's the fill, and everything comes back", async () => {
    const swap = directTx();
    const { t, sessions, view } = await placing(swap);
    expect(view.auto!.paused).toBeUndefined();
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap"]);
    // Sent with both signatures: the collateral owner's, there already, and the session's.
    const sent = t.koios.submitted.at(-1)!;
    expect(txIdOf(sent)).toBe(txIdOf(bytes(swap)));
    expect([...witnessedKeys(sent)].sort()).toEqual([COLLATERAL_KEY, sessionSwap.keyHash].sort());

    // It lands: its proceeds are at the account, in the swap itself. No order, so nothing waits on a batcher.
    t.koios.spent.add(FUNDING);
    t.koios.addedToAccounts.push(atSession(txIdOf(sent), 2, (FUNDED - PAID_IN - FEE - MINSWAP_FEE).toString(), [[MIN, BOUGHT.toString()]]));
    t.clock.now += 15_000;
    const after = await sessions.advance("preprod", 0);
    expect(after.auto).toMatchObject({ step: "returning", filled: true });
    expect(after.txs.map((x) => x.kind)).toEqual(["out", "swap", "back"]);
    expect(t.minswap.calls.map((c) => c.path)).not.toContain("cancel-tx");
  });

  it("pauses rather than sign one that spends anyone else's UTxO but a Danogo pool's", async () => {
    const { view, t } = await placing(directTx(), { pool: `30${"a6".repeat(28)}${POOL_STAKE}` });
    expect(view.auto!.paused).toMatchObject({ why: "refused", detail: "it spends something that isn't this session's." });
    expect(t.koios.submitted).toHaveLength(1);
  });

  it("pauses rather than sign one whose collateral isn't signed by its owner already, or is a contract's", async () => {
    const unsigned = await placing(directTx({ witnessed: false }));
    expect(unsigned.view.auto!.paused).toMatchObject({ why: "refused", detail: "it needs someone else's signature too." });
    const contract = await placing(directTx(), { collateral: `70${"a6".repeat(28)}` });
    expect(contract.view.auto!.paused).toMatchObject({ why: "refused", detail: "it needs someone else's signature too." });
  });

  it("pauses rather than sign one that withdraws anything, or from a script that isn't Danogo's or a spent pool's", async () => {
    const some = await placing(directTx({ withdrawals: [[`f0${POOL}`, 1_000_000]] }));
    expect(some.view.auto!.paused).toMatchObject({ why: "refused", detail: "it does something with staking or governance." });
    const other = await placing(directTx({ withdrawals: [[`f0${"a6".repeat(28)}`, 0]] }));
    expect(other.view.auto!.paused).toMatchObject({ why: "refused", detail: "it does something with staking or governance." });
    // The session's own stake key, a key's reward address.
    const own = await placing(directTx({ withdrawals: [[`e0${SESSION_ADDRESS.slice(58)}`, 0]] }));
    expect(own.view.auto!.paused).toMatchObject({ why: "refused" });
    expect(own.t.koios.submitted).toHaveLength(1);
  });

  it("pauses rather than sign one that pays a contract other than Danogo's pools, or a second fee", async () => {
    const lessBack = FUNDED - PAID_IN - FEE - MINSWAP_FEE - 3_000_000n;
    const contract = await placing(
      directTx({
        outputs: [
          [POOL_ADDRESS, value(2_000_000_000n + PAID_IN, 100_000_000_000n - BOUGHT), "d87980"],
          [FEE_ADDRESS, value(MINSWAP_FEE)],
          [`70${"a6".repeat(28)}`, value(3_000_000n)],
          [SESSION_ADDRESS, value(lessBack, BOUGHT)],
        ],
      }),
    );
    expect(contract.view.auto!.paused).toMatchObject({ why: "refused", detail: "it pays a contract that isn't one of the DEX's pools." });
    const twice = await placing(
      directTx({
        outputs: [
          [POOL_ADDRESS, value(2_000_000_000n + PAID_IN, 100_000_000_000n - BOUGHT), "d87980"],
          [FEE_ADDRESS, value(MINSWAP_FEE)],
          [`60${"77".repeat(28)}`, value(MINSWAP_FEE)],
          [SESSION_ADDRESS, value(lessBack, BOUGHT)],
        ],
      }),
    );
    expect(twice.view.auto!.paused).toMatchObject({ why: "refused", detail: "it pays an address that isn't this session's." });
  });

  it("pauses rather than sign one that gives the session less than the approved minimum", async () => {
    const least = BigInt(minswapEstimate.estimate.min_amount_out);
    const { view, t } = await placing(directTx({ bought: least - 1n }));
    expect(view.auto!.paused).toMatchObject({ why: "refused", detail: "it gives this session less than the approved minimum." });
    expect(t.koios.submitted).toHaveLength(1);
  });

  it("pauses rather than sign one that takes more of the session's ADA than was funded, into a pool", async () => {
    const { view } = await placing(
      directTx({
        outputs: [
          [POOL_ADDRESS, value(2_000_000_000n + PAID_IN + 50_000_000n, 100_000_000_000n - BOUGHT), "d87980"],
          [FEE_ADDRESS, value(MINSWAP_FEE)],
          [SESSION_ADDRESS, value(FUNDED - PAID_IN - FEE - MINSWAP_FEE - 50_000_000n, BOUGHT)],
        ],
      }),
    );
    expect(view.auto!.paused).toMatchObject({ why: "refused", detail: "it pays out more ADA than was funded for the swap." });
  });
});

describe("a route through Danogo", () => {
  const leg = minswapEstimate.estimate.paths[0]![0]!;
  const route = (...paths: string[][]) => ({ paths: paths.map((p) => p.map((protocol) => ({ ...leg, protocol }))) });

  it("goes through nothing else: beside another DEX, or in a longer path, it's asked for again without Danogo", () => {
    expect(outOfPlace(route(["DanogoCLMMV1"]))).toEqual([]);
    // Split across two of its own pools: one direct swap.
    expect(outOfPlace(route(["DanogoCLMMV1"], ["DanogoCLMMV1"]))).toEqual([]);
    expect(outOfPlace(route(["DanogoCLMMV1"], ["MinswapV2"]))).toEqual(["DanogoCLMMV1"]);
    expect(outOfPlace(route(["MinswapV2", "DanogoCLMMV1"]))).toEqual(["DanogoCLMMV1"]);
    expect(outOfPlace(route(["DanogoCLMMV1"], ["MinswapV2", "SundaeSwapV3"])).sort()).toEqual(["DanogoCLMMV1", "SundaeSwapV3"]);
  });
});
