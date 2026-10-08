// A direct swap through Minswap's router (chunk 24): Danogo's pools, swapped
// against in the swap itself, with no order. Shaped like the one Minswap's
// preprod aggregator built on 2026-10-06: the session's funding and a pool's
// UTxO spent, a collateral its owner signed already, zero withdrawals from
// Danogo's script and the pool's staking script, the pool recreated,
// Minswap's fee, and the proceeds back to the session. Each of the checks
// the runner signs one by, both ways (a token bought, and ADA), is driven
// through it here; so is an approval through the pools that Minswap routes to
// an order instead, and Review it myself on one (release review C08 to C11,
// C21, C22).
import { blake2b } from "@noble/hashes/blake2.js";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { KoiosUtxo } from "../src/background/koios";
import { DANOGO_POOL, DIRECT_PROTOCOLS, excludedProtocols, MAINNET_PROTOCOLS, outOfPlace, witnessedKeys } from "../src/background/minswap";
import { SWAP_MARGIN } from "../src/background/sessions";
import type { SessionView } from "../src/shared/rpc";
import { NetworkContext } from "../src/ui/network";
import { Plan, Session, SwapRow } from "../src/ui/screens/Swaps";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { bytes, cbor, type Cbor, hex, ORDER_ADDRESS, ORDER_DATUM, SESSION_ADDRESS, swapTx } from "./fixtures/swap-tx";
import { minswapEstimate, sessionSwap } from "./fakes";
import { ASK, atSession, bookOf, FUNDING, funded, MIN, signing, started, SWAP, unlocked, type T } from "./swap-session";

const POOL = DANOGO_POOL.preprod;
const POOL_STAKE = "6e".repeat(28);
/** A pool's address: Danogo's script, under the pool's own staking script (header 0x30, preprod). */
const POOL_ADDRESS = `30${POOL}${POOL_STAKE}`;
const COLLATERAL_VKEY = "c0".repeat(32);
const COLLATERAL_KEY = hex(blake2b(bytes(COLLATERAL_VKEY), { dkLen: 28 }));
const FEE_ADDRESS = `60${"89".repeat(28)}`;
const POOL_IN = `${"b1".repeat(32)}#0`;
const COLLATERAL_IN = `${"c1".repeat(32)}#0`;
/** A UTxO at the collateral owner's key that isn't its collateral. */
const KEY_IN = `${"c2".repeat(32)}#0`;

const FUNDED = BigInt(sessionSwap.utxo.value);
const FEE = 600_000n;
const MINSWAP_FEE = 850_000n;
const BOUGHT = BigInt(minswapEstimate.estimate.amount_out);
const PAID_IN = BigInt(minswapEstimate.ask.amount);
/** What the swap's quote funds besides the 10 ₳ it swaps (quoteOf): the DEX's fee, the deposit, Minswap's fee and the room. */
const COSTS =
  BigInt(minswapEstimate.estimate.total_dex_fee) + BigInt(minswapEstimate.estimate.deposits) + MINSWAP_FEE + SWAP_MARGIN;

/** The checks' words, as a paused swap's warning shows them. */
const MORE_ADA = "it pays out more ADA than was funded for the swap.";
const TOO_LITTLE = "it gives this session less than the approved minimum.";
const NOT_POOL = "it pays a contract that isn't one of the DEX's pools.";
const OTHER_ADDRESS = "it pays an address that isn't this session's.";
const OWN_COLLATERAL = "it puts up this session's own funds as collateral.";
const NOW_ORDER = "Minswap now routes it through an order, whose minimum the wallet can't check, instead of against the DEX's pools as approved.";

/** A value: ADA, and MIN when `min` is given. */
const value = (lovelace: bigint, min?: bigint): Cbor =>
  min === undefined
    ? lovelace
    : { raw: hex([0x82, ...cbor(lovelace), 0xa1, 0x58, 0x1c, ...bytes(MIN.slice(0, 56)), 0xa1, 0x43, ...bytes(MIN.slice(56)), ...cbor(min)]) };
const outpointOf = (ref: string): Cbor => [bytes(ref.split("#")[0]!), Number(ref.split("#")[1])];

type Out = [address: string, value: Cbor, datum?: string];

/**
 * The session's direct swap of 10 ADA for MIN, as Minswap builds it, with any part in its place: `fee`, its
 * network fee; `required`, signers its body names (key 14).
 */
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
  fee = FEE,
  required = [],
}: {
  spends?: string[];
  collateral?: string[];
  withdrawals?: Array<[string, number]>;
  outputs?: Out[];
  bought?: bigint;
  witnessed?: boolean;
  fee?: bigint;
  required?: string[];
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
    [2, Number(fee)],
    [3, 134_639_865],
    [5, withdrawn],
    [13, { tag: 258, of: collateral.map(outpointOf) }],
    [18, { tag: 258, of: [[bytes("d1".repeat(32)), 0]] }],
  ]);
  if (required.length) body.set(14, { tag: 258, of: required.map(bytes) });
  const redeemers: Cbor = [
    [0, 1, { tag: 121, of: [] }, [500_000, 200_000_000]],
    [3, 0, { tag: 121, of: [] }, [500_000, 200_000_000]],
    [3, 1, { tag: 121, of: [] }, [500_000, 200_000_000]],
  ];
  const witnesses = new Map<number, Cbor>(witnessed ? [[0, { tag: 258, of: [[bytes(COLLATERAL_VKEY), bytes("5a".repeat(64))]] }]] : []);
  witnesses.set(5, redeemers);
  return hex(cbor([body, witnesses, true, null]));
}

/** What Koios knows of what isn't the session's: the pool's UTxO, the collateral's, and another of its owner's. */
function others(t: T, { pool = POOL_ADDRESS, collateral = `60${COLLATERAL_KEY}` } = {}) {
  const row = (ref: string, address: string, lovelace: string, min?: string): KoiosUtxo =>
    ({
      ...atSession(ref.split("#")[0]!, Number(ref.split("#")[1]), lovelace, min ? [[MIN, min]] : []),
      address: bech32("addr_test", bytes(address)),
      payment_cred: address.slice(2, 58),
    }) as KoiosUtxo;
  t.koios.addedToAccounts.push(
    row(POOL_IN, pool, "2000000000", "100000000000"),
    row(COLLATERAL_IN, collateral, "3000000"),
    row(KEY_IN, `60${COLLATERAL_KEY}`, "4000000"),
  );
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

  it("pauses rather than sign one whose network fee and Minswap's take more than the funded costs, whatever the pool gets", async () => {
    // 2 ₳ less into the pool, the session still given its MIN: that room and the costs' go to the fee, its net
    // spend within the funding all the same (release review C08).
    const pooled = PAID_IN - 2_000_000n;
    const fee = COSTS - MINSWAP_FEE + 1n;
    const { view, t } = await placing(
      directTx({
        fee,
        outputs: [
          [POOL_ADDRESS, value(2_000_000_000n + pooled, 100_000_000_000n - BOUGHT), "d87980"],
          [FEE_ADDRESS, value(MINSWAP_FEE)],
          [SESSION_ADDRESS, value(FUNDED - pooled - fee - MINSWAP_FEE, BOUGHT)],
        ],
      }),
    );
    expect(view.auto!.paused).toMatchObject({ why: "refused", detail: MORE_ADA });
    expect(t.koios.submitted).toHaveLength(1);
  });

  it("pauses rather than sign one that puts up the session's own UTxO as collateral, alone or beside Minswap's", async () => {
    // Its own would be at stake on scripts the wallet never runs (release review C21).
    for (const collateral of [[FUNDING], [COLLATERAL_IN, FUNDING]]) {
      const { view, t } = await placing(directTx({ collateral, witnessed: collateral.includes(COLLATERAL_IN) }));
      expect(view.auto!.paused).toMatchObject({ why: "refused", detail: OWN_COLLATERAL });
      expect(t.koios.submitted).toHaveLength(1);
    }
  });

  it("pauses rather than sign one that pays the pools' script anywhere but where a spent pool was, or twice for one", async () => {
    // The pools it recreates are the pools it spends, at their own addresses, one each (release review C22).
    const lessBack = FUNDED - PAID_IN - FEE - MINSWAP_FEE - 3_000_000n;
    const recreated: Out = [POOL_ADDRESS, value(2_000_000_000n + PAID_IN, 100_000_000_000n - BOUGHT), "d87980"];
    const strays: Out[] = [
      // Under a staking part no spent pool has, with a datum.
      [`30${POOL}${"ee".repeat(28)}`, value(3_000_000n), "d87980"],
      // A second output where the one pool spent was.
      [POOL_ADDRESS, value(3_000_000n), "d87980"],
      // With no staking part, and no datum.
      [`70${POOL}`, value(3_000_000n)],
    ];
    for (const stray of strays) {
      const { view, t } = await placing(
        directTx({ outputs: [recreated, [FEE_ADDRESS, value(MINSWAP_FEE)], stray, [SESSION_ADDRESS, value(lessBack, BOUGHT)]] }),
      );
      expect(view.auto!.paused).toMatchObject({ why: "refused", detail: NOT_POOL });
      expect(t.koios.submitted).toHaveLength(1);
    }
  });

  it("pauses rather than sign one that pays the session's key under someone else's staking part, even fee-sized", async () => {
    const { view, t } = await placing(
      directTx({
        outputs: [
          [POOL_ADDRESS, value(2_000_000_000n + PAID_IN, 100_000_000_000n - BOUGHT), "d87980"],
          [`${SESSION_ADDRESS.slice(0, 58)}${"c5".repeat(28)}`, value(MINSWAP_FEE)],
          [SESSION_ADDRESS, value(FUNDED - PAID_IN - FEE - MINSWAP_FEE, BOUGHT)],
        ],
      }),
    );
    expect(view.auto!.paused).toMatchObject({ why: "refused", detail: "it pays this session's key under someone else's staking part." });
    expect(t.koios.submitted).toHaveLength(1);
  });

  it("pauses rather than sign one that spends a key's UTxO that isn't the session's, or needs a signature beyond its collateral owner's", async () => {
    // The collateral's owner, who signed already: another of its UTxOs is still no pool's.
    const key = await placing(directTx({ spends: [FUNDING, POOL_IN, KEY_IN] }));
    expect(key.view.auto!.paused).toMatchObject({ why: "refused", detail: "it spends something that isn't this session's." });
    expect(key.t.koios.submitted).toHaveLength(1);
    const signer = await placing(directTx({ required: ["77".repeat(28)] }));
    expect(signer.view.auto!.paused).toMatchObject({ why: "refused", detail: "it needs someone else's signature too." });
    expect(signer.t.koios.submitted).toHaveLength(1);
  });
});

/** A sale through one of Danogo's pools: 500 MIN for about 9.1 ₳, its minimum Minswap's at 0.5%. */
const SOLD = 500_000_000n;
const RELEASED = 9_100_000n;
const LEAST = (RELEASED * 1_000n) / 1_005n;
/** What a sale through one Danogo pool is funded with besides its MIN (quoteOf): the pool's fee, Minswap's, and the room. */
const DANOGO_DEX_FEE = 100_000n;
const SALE_COSTS = DANOGO_DEX_FEE + MINSWAP_FEE + SWAP_MARGIN;
/** The sale's funding (its MIN and costs, then the session's 5 ₳ collateral), and MIN someone sent the account besides. */
const SALE_TX = "5a".repeat(32);
const SALE_IN = `${SALE_TX}#0`;
const EXTRA_IN = `${"e1".repeat(32)}#0`;
const EXTRA_MIN = 100_000_000n;

/** Minswap's sale of SOLD MIN against the pool, which releases `released` ₳: Minswap's fee, and the rest back, less `fee`. */
function saleTx({ released = RELEASED, fee = FEE, ...rest }: { released?: bigint; fee?: bigint; outputs?: Out[]; spends?: string[] } = {}) {
  return directTx({
    spends: [SALE_IN, POOL_IN],
    fee,
    outputs: [
      [POOL_ADDRESS, value(2_000_000_000n - released, 100_000_000_000n + SOLD), "d87980"],
      [FEE_ADDRESS, value(MINSWAP_FEE)],
      [SESSION_ADDRESS, value(SALE_COSTS - fee - MINSWAP_FEE + released)],
    ],
    ...rest,
  });
}

/**
 * Session 0 at the step that places a sale of SOLD MIN for ADA through one Danogo pool, approved so (its record as
 * outSubmit writes one; `costs`, the ADA funded besides the MIN), its funding landed with its 5 ₳ collateral, and
 * `swapCbor` what Minswap builds. `extra`: MIN someone sent the account besides.
 */
async function placingSale(swapCbor: string, { extra = false, costs = SALE_COSTS } = {}) {
  const t = await unlocked();
  const sessions = signing(t);
  const now = t.clock.now;
  const fund = { lovelace: costs.toString(), tokens: [{ policyId: MIN.slice(0, 56), assetName: MIN.slice(56), quantity: SOLD.toString() }] };
  await t.store.set("sessions.preprod", {
    next: 1,
    sessions: [
      {
        index: 0,
        ownStake: true,
        createdAt: now,
        txs: [{ kind: "out", txHash: SALE_TX, at: now, confirmed: true }],
        swap: { ...ASK, tokenIn: MIN, tokenOut: "lovelace", amount: SOLD.toString(), amountOut: RELEASED.toString(), minAmountOut: LEAST.toString() },
        auto: { approved: { minAmountOut: LEAST.toString(), fund, aggregatorFee: MINSWAP_FEE.toString(), againstPools: true } },
      },
    ],
  });
  t.koios.confirmations = 1;
  t.koios.addedToAccounts.push(atSession(SALE_TX, 0, costs.toString(), [[MIN, SOLD.toString()]]), atSession(SALE_TX, 1, "5000000"));
  if (extra) t.koios.addedToAccounts.push(atSession(EXTRA_IN.split("#")[0]!, 0, "2000000", [[MIN, EXTRA_MIN.toString()]]));
  others(t);
  const leg = minswapEstimate.estimate.paths[0]![0]!;
  const sale = { token_in: MIN, token_out: "lovelace", amount_in: SOLD.toString(), amount_out: RELEASED.toString(), min_amount_out: LEAST.toString() };
  const fees = { dex_fee: DANOGO_DEX_FEE.toString(), deposits: "0" };
  t.minswap.estimate = {
    ...minswapEstimate.estimate,
    ...sale,
    total_dex_fee: fees.dex_fee,
    deposits: "0",
    aggregator_fee: MINSWAP_FEE.toString(),
    paths: [[{ ...leg, ...sale, ...fees, protocol: "DanogoCLMMV1" }]],
  };
  t.minswap.swapCbor = swapCbor;
  const view = await sessions.advance("preprod", 0, true);
  return { t, sessions, view };
}

describe("a sale against Danogo's pools, a token for ADA, as the runner places it (release review C08, C11)", () => {
  const pool = (released = RELEASED, sold = SOLD): Out => [POOL_ADDRESS, value(2_000_000_000n - released, 100_000_000_000n + sold), "d87980"];
  const back = (lovelace: bigint): Out => [SESSION_ADDRESS, value(lovelace)];

  it("is signed when the pool gives exactly the approved minimum, Minswap's fee as approved", async () => {
    const { t, view } = await placingSale(saleTx({ released: LEAST }));
    expect(view.auto!.paused).toBeUndefined();
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap"]);
    expect([...witnessedKeys(t.koios.submitted.at(-1)!)].sort()).toEqual([COLLATERAL_KEY, sessionSwap.keyHash].sort());
  });

  it("pauses rather than sign one whose pool gives a lovelace under the minimum", async () => {
    const { t, view } = await placingSale(saleTx({ released: LEAST - 1n }));
    expect(view.auto!.paused).toMatchObject({ why: "refused", detail: TOO_LITTLE });
    expect(t.koios.submitted).toHaveLength(0);
  });

  it("pauses rather than sign one that pays the proceeds as Minswap's fee, a fee a lovelace over, or a fee carrying a token", async () => {
    // Minswap's fee is added back to what the session gets: its bound is all that keeps the proceeds out of it.
    const builds: Out[][] = [
      [pool(), [FEE_ADDRESS, value(MINSWAP_FEE + RELEASED)], back(SALE_COSTS - FEE - MINSWAP_FEE)],
      [pool(), [FEE_ADDRESS, value(MINSWAP_FEE + 1n)], back(SALE_COSTS - FEE - MINSWAP_FEE - 1n + RELEASED)],
      [pool(RELEASED, SOLD - 1_000n), [FEE_ADDRESS, value(MINSWAP_FEE, 1_000n)], back(SALE_COSTS - FEE - MINSWAP_FEE + RELEASED)],
    ];
    for (const outputs of builds) {
      const { t, view } = await placingSale(saleTx({ outputs }));
      expect(view.auto!.paused).toMatchObject({ why: "refused", detail: OTHER_ADDRESS });
      expect(t.koios.submitted).toHaveLength(0);
    }
  });

  it("pauses rather than sign one that sells more of the token than was funded", async () => {
    const { t, view } = await placingSale(
      saleTx({
        spends: [SALE_IN, EXTRA_IN, POOL_IN],
        outputs: [pool(RELEASED, SOLD + EXTRA_MIN), [FEE_ADDRESS, value(MINSWAP_FEE)], back(SALE_COSTS + 2_000_000n - FEE - MINSWAP_FEE + RELEASED)],
      }),
      { extra: true },
    );
    expect(view.auto!.paused).toMatchObject({ why: "refused", detail: "it pays out tokens that weren't funded for the swap." });
    expect(t.koios.submitted).toHaveLength(0);
  });

  it("pauses rather than sign one whose network fee eats the proceeds, all of them or a part", async () => {
    // Nothing back: the pool's ₳ and the funded costs, less Minswap's fee, are the network's (release review C08).
    const all = SALE_COSTS + RELEASED - MINSWAP_FEE;
    const builds: Array<[bigint, Out[]]> = [
      [all, [pool(), [FEE_ADDRESS, value(MINSWAP_FEE)]]],
      [all - 4_000_000n, [pool(), [FEE_ADDRESS, value(MINSWAP_FEE)], back(4_000_000n)]],
    ];
    for (const [fee, outputs] of builds) {
      const { t, view } = await placingSale(saleTx({ fee, outputs }));
      expect(view.auto!.paused).toMatchObject({ why: "refused", detail: TOO_LITTLE });
      expect(t.koios.submitted).toHaveLength(0);
    }
  });

  it("holds the network fee and Minswap's to the funded costs, never the proceeds: at them it's signed, a lovelace over pauses", async () => {
    const fee = SALE_COSTS - MINSWAP_FEE;
    const at = await placingSale(saleTx({ fee }));
    expect(at.view.auto!.paused).toBeUndefined();
    expect(at.t.koios.submitted).toHaveLength(1);
    const over = await placingSale(saleTx({ fee: fee + 1n }));
    expect(over.view.auto!.paused).toMatchObject({ why: "refused", detail: MORE_ADA });
    expect(over.t.koios.submitted).toHaveLength(0);
  });

  it("counts no more network fee with the proceeds than a pool swap takes, though the costs approved had room for more", async () => {
    // Approved through an order's route (SundaeSwap V3's costs), built against Danogo's pools: its costs would pay a
    // 5 ₳ fee, and the pool's 9.1 ₳ less what's over 3 ₳ of it isn't the minimum.
    const costs = 1_280_000n + 2_000_000n + MINSWAP_FEE + SWAP_MARGIN;
    const fee = 5_000_000n;
    const { t, view } = await placingSale(saleTx({ fee, outputs: [pool(), [FEE_ADDRESS, value(MINSWAP_FEE)], back(costs - fee - MINSWAP_FEE + RELEASED)] }), {
      costs,
    });
    expect(view.auto!.paused).toMatchObject({ why: "refused", detail: TOO_LITTLE });
    expect(t.koios.submitted).toHaveLength(0);
  });
});

describe("a swap approved against the pools (release review C09)", () => {
  const leg = minswapEstimate.estimate.paths[0]![0]!;
  /** Danogo's estimate for the 10 ₳ swap: one pool, 0.1 ₳ its fee, no deposit, and Minswap's fee. Funded 12.95 ₳. */
  const danogo = {
    ...minswapEstimate.estimate,
    total_dex_fee: "100000",
    deposits: "0",
    aggregator_fee: MINSWAP_FEE.toString(),
    paths: [[{ ...leg, dex_fee: "100000", deposits: "0", protocol: "DanogoCLMMV1" }]],
  };
  /** An order of Minswap's for it, 12.7 ₳ and its fee: within the funding, so only the route's kind stops it. */
  const order = swapTx({
    outputs: [
      [ORDER_ADDRESS, 12_700_000, ORDER_DATUM],
      [SESSION_ADDRESS, Number(FUNDED) - 12_700_000 - 205_189],
    ],
  });

  /** Session 0, approved through Danogo's estimate and funded. */
  async function approved() {
    const t = await unlocked();
    const sessions = signing(t);
    t.minswap.estimate = danogo;
    await started(sessions);
    funded(t);
    others(t);
    return { t, sessions };
  }

  it("is recorded as approved against the pools, and one approved as an order isn't", async () => {
    const pools = await approved();
    expect((await bookOf(pools.t)).sessions[0]!.auto!.approved).toMatchObject({ againstPools: true, fund: { lovelace: "12950000" } });
    const t = await unlocked();
    await started(signing(t));
    expect((await bookOf(t)).sessions[0]!.auto!.approved).not.toHaveProperty("againstPools");
  });

  it("pauses rather than place an order once Minswap routes it through one, before anything's built", async () => {
    const { t, sessions } = await approved();
    t.minswap.estimate = { ...minswapEstimate.estimate, aggregator_fee: MINSWAP_FEE.toString() };
    t.minswap.swapCbor = order;
    const view = await sessions.advance("preprod", 0, true);
    expect(view.auto!.paused).toMatchObject({ why: "refused", detail: NOW_ORDER });
    expect(t.minswap.calls.map((c) => c.path)).not.toContain("build-tx");
    expect(t.koios.submitted).toHaveLength(1);
  });

  it("pauses rather than sign an order build-tx makes of it, its estimate still the pools', and swaps once they're back", async () => {
    const { t, sessions } = await approved();
    t.minswap.swapCbor = order;
    const view = await sessions.advance("preprod", 0, true);
    expect(view.auto!.paused).toMatchObject({ why: "refused", detail: NOW_ORDER });
    expect(t.koios.submitted).toHaveLength(1);
    // Try again: built against the pools this time, it goes.
    t.minswap.swapCbor = directTx();
    const again = await sessions.resume("preprod", 0);
    expect(again.auto!.paused).toBeUndefined();
    expect(again.txs.map((x) => x.kind)).toEqual(["out", "swap"]);
    expect(again.auto).toMatchObject({ againstPools: true });
  });

  it("says so in its view before it's sent, from the approval, and from the swap once one's gone out (release review C13)", async () => {
    const { t, sessions } = await approved();
    // Before anything's built: the approval's words, which Stop never reads (it stays until the swap goes out).
    let view = (await sessions.list("preprod"))[0]!;
    expect(view.auto).toMatchObject({ approvedPools: true });
    expect(view.auto).not.toHaveProperty("againstPools");
    // Sent against the pools: the swap's own.
    t.minswap.swapCbor = directTx();
    view = await sessions.advance("preprod", 0, true);
    expect(view.auto).toMatchObject({ againstPools: true });
    expect(view.auto).not.toHaveProperty("approvedPools");
  });

  it("says nothing of the pools once the user's own review sent an order instead (release review C13)", async () => {
    const { t, sessions } = await approved();
    t.minswap.swapCbor = order;
    // Review it myself isn't held to the approved route: the user's own review (release review C09).
    const review = await sessions.swapBuild("preprod", 0);
    await sessions.txSubmit("preprod", review.txHash, "swap");
    const view = (await sessions.list("preprod"))[0]!;
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap"]);
    expect(view.auto).not.toHaveProperty("approvedPools");
    expect(view.auto).not.toHaveProperty("againstPools");
  });
});

describe("Review it myself on a swap against the pools (release review C10)", () => {
  /** A direct swap that puts 50 ₳ more of the session's into the pool: the runner refuses it. */
  const greedy = directTx({
    outputs: [
      [POOL_ADDRESS, value(2_000_000_000n + PAID_IN + 50_000_000n, 100_000_000_000n - BOUGHT), "d87980"],
      [FEE_ADDRESS, value(MINSWAP_FEE)],
      [SESSION_ADDRESS, value(FUNDED - PAID_IN - FEE - MINSWAP_FEE - 50_000_000n, BOUGHT)],
    ],
  });

  it("is held to what was funded, as the runner is, and keeps nothing to send", async () => {
    const { t, sessions, view } = await placing(greedy);
    expect(view.auto!.paused).toMatchObject({ why: "refused", detail: MORE_ADA });
    await expect(sessions.swapBuild("preprod", 0)).rejects.toThrow(`The wallet won't sign what Minswap built: ${MORE_ADA}`);
    await expect(sessions.txSubmit("preprod", txIdOf(bytes(greedy)), "swap")).rejects.toThrow();
    expect(t.koios.submitted).toHaveLength(1);
  });

  it("says it's a swap against the pools, from the transaction it keeps rather than the quote, and an order's doesn't", async () => {
    const { t, sessions } = await placing(greedy);
    t.minswap.swapCbor = directTx();
    const review = await sessions.swapBuild("preprod", 0);
    expect(review.againstPools).toBe(true);
    // Its fresh quote went through Minswap's own pool: what's signed is what's said.
    expect(review.quote?.againstPools).toBeUndefined();
    t.minswap.swapCbor = SWAP;
    expect(await sessions.swapBuild("preprod", 0)).not.toHaveProperty("againstPools");
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
    // In a longer path, every DEX of it is, as any route of more than one leg.
    expect(outOfPlace(route(["MinswapV2", "DanogoCLMMV1"]))).toEqual(["MinswapV2", "DanogoCLMMV1"]);
    expect(outOfPlace(route(["DanogoCLMMV1"], ["MinswapV2", "SundaeSwapV3"])).sort()).toEqual(["DanogoCLMMV1", "MinswapV2", "SundaeSwapV3"]);
  });
});

describe("Danogo routed (chunk 24)", () => {
  const leg = minswapEstimate.estimate.paths[0]![0]!;
  const selling = { ...minswapEstimate.ask, tokenIn: MIN, tokenOut: "lovelace", amount: "500" };

  it("is left in routing on both networks, and a quote through it says it swaps against the pools", async () => {
    expect(MAINNET_PROTOCOLS).toContain("DanogoCLMMV1");
    expect(DIRECT_PROTOCOLS).not.toContain("DanogoCLMMV1");
    expect(excludedProtocols("mainnet")).not.toContain("DanogoCLMMV1");
    expect(excludedProtocols("preprod")).not.toContain("DanogoCLMMV1");
    // A bonding curve and Djed's minting still aren't.
    expect(excludedProtocols("mainnet")).toEqual(expect.arrayContaining(["ChakraBondingCurve", "OpenDjedV1"]));

    const t = await unlocked();
    t.minswap.estimate = { ...minswapEstimate.estimate, paths: [[{ ...leg, protocol: "DanogoCLMMV1" }], [{ ...leg, protocol: "DanogoCLMMV1" }]] };
    await expect(t.sessions.quote("mainnet", selling)).resolves.toMatchObject({ route: ["DanogoCLMMV1"], againstPools: true });
    t.minswap.estimate = { ...minswapEstimate.estimate, paths: [[{ ...leg, protocol: "MinswapV2" }]] };
    expect(await t.sessions.quote("mainnet", selling)).not.toHaveProperty("againstPools");
  });

  it("is refused in words of its own if Minswap still puts it beside another DEX: Danogo's a DEX the wallet checks", async () => {
    // The fake answers the ask again the same: the split stays (release review C34).
    const t = await unlocked();
    t.minswap.estimate = { ...minswapEstimate.estimate, paths: [[{ ...leg, protocol: "DanogoCLMMV1" }], [{ ...leg, protocol: "MinswapV2" }]] };
    for (const network of ["preprod", "mainnet"] as const) {
      const refused = t.sessions.quote(network, selling);
      await expect(refused).rejects.toThrow(
        "Minswap routes this swap through DanogoCLMMV1 in a way the wallet's check can't follow, so it won't swap this way. Try another amount or pair.",
      );
      await expect(refused).rejects.not.toThrow(/can't check yet/);
    }
  });
});

/** A page's text, as a person reads it. */
const text = (element: ReactElement) =>
  renderToStaticMarkup(createElement(NetworkContext.Provider, { value: "preprod" }, element))
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ");

describe("a swap against the pools, on its page (chunk 24)", () => {
  it("says it swaps against the DEX's pools and fills in itself, with no order, and offers no Stop once it's gone out", async () => {
    const { view } = await placing(directTx());
    expect(view.auto).toMatchObject({ step: "ordering", againstPools: true });
    const page = text(
      createElement(Session, { session: view, reading: false, onRefresh: () => undefined, onBack: () => undefined, onChanged: () => undefined }),
    );
    expect(page).toContain("Swapped against the DEX's pools");
    expect(page).toContain("In the swap itself: no order to wait for");
    expect(page).not.toContain("Order placed");
    expect(page).not.toMatch(/\bStop\b/);
    expect(text(createElement(SwapRow, { session: view as SessionView, onOpen: () => undefined }))).toContain("Swapping");
  });

  it("says so in the plan before it's started, when the route is Danogo's", () => {
    const pools = text(createElement(Plan, { lovejoin: false, adaOut: false, pools: true }));
    expect(pools).toContain("Swapped against the DEX's pools");
    expect(pools).toContain("In the swap itself: no order to wait for");
    const orders = text(createElement(Plan, { lovejoin: false, adaOut: false }));
    expect(orders).toContain("Order placed");
    expect(orders).toContain("By a DEX, usually within a few blocks");
  });
});
