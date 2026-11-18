# gap-g4#2: verification

From lane gap-G4, graded medium by its finder.

## Trace: confirmed, medium

The finding holds on TREE. A swap's funding pays the one-time account two outputs at the same address: the swap's output and exactly 5 ₳. Minswap's build-tx is given the sender alone and picks the inputs itself. None of the checks between build-tx and the signature look at which of the session's own UTxOs the swap spends: inspect, refuseOddities, checkOrder, cancelsChecked, withinFunding, signAndSend.

So the runner signs and sends a swap that spends the 5 ₳ too. After the fill the account holds no UTxO of exactly 5 ₳ (collateralFits). buildBack then skips Lovejoin with NO_COLLATERAL, intoPool is undefined so the collateral is never mixed, and everything comes back directly.

I looked for what would refute it and found nothing:
- No guard: directSpends' `ownCollateral` check (6730) covers only the collateral field (body key 13) of a Danogo swap, never the inputs.
- No caller restriction: the runner's order() and Review it myself's swapBuild both go through inspect with the full listing as `rows`.
- The types can hold the case.
- No existing test covers it: swap-session.ts `funded()` puts only one UTxO at the account, so no swap test ever had the 5 ₳ there when the order was placed.

The test shows the contrast. In its control, the same swap spending only the swap's output is signed, and the return goes through a 13-transaction Lovejoin chain that ends with the collateral's deposit and its mix. The swap that also spends the 5 ₳ is signed too, but its return is one direct transaction carrying the NO_COLLATERAL reason. A three-line fix in a copy (refuse a swap whose inputs include a collateralFits row) makes the test pass.

Reach can't be settled offline, as the finder said. The trigger is the choice an honest Minswap makes from the sender's UTxOs: a largest-first selection would never take the 5 ₳, a random one could, and nothing in the repo records a real session swap's inputs. The finder's lookup still decides how often this happens. It isn't known or settled: SECURITY.md lists Minswap nowhere among the trusted data sources, and an honest coin selection isn't a lying data source.

Grade: medium, because when it happens it is a privacy link made by default, against an approval that promised Lovejoin and said the collateral is "mixed". No money is lost. It drops to low if the lookup shows Minswap never takes the 5 ₳.

**Evidence:**

Paths relative to TREE (/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51); sessions.ts and minswap.ts are under seedelf-platform/seedelf-web-wallet/extension/src/background/.

Where the input enters:
- sessions.ts:1932-1948 (outBuild). The funding pays two outputs, both `to: address`: `[{ lovelace: quote.fund + l.fund + reserve, tokens: quote.fund.tokens }, { lovelace: SESSION_COLLATERAL (5 ₳) }]`.
- minswap.ts:8-9 says "`build-tx` takes only a sender: it picks the sender's UTxOs from its own view of the chain".
- minswap.ts:389-397 (buildTx) posts only `{ sender, min_amount_out, estimate, amount_in_decimal }`.
- The runner places the order only after the funding is confirmed (sessions.ts:3759) and with the listing as `rows` (3770, 3837). Both outputs are on chain and in `rows` when Minswap builds.

What the swap passes before it's signed:
- order(), 4167-4175: buildTx → inspect(…, rows, quote) → withinFunding → signAndSend. Nothing compares the spends against the collateral.
- inspect, 4371-4377: `own = new Map(rows.map(...))`, `others = refs.filter((r) => !own.has(r))`. The 5 ₳ is the session's own, so it is neither "other" nor "direct".
- refuseOddities, 6850-6872: unknown inputs, other signers, keys, certificates, withdrawals, mint, donation. Nothing about which own UTxO is spent.
- checkOrder, 6659-6707: reads outputs only. 6672 skips outputs at the session's address.
- withinFunding, 6571-6583: counts only paidOut plus the fee, so the 5 ₳ rejoining the change passes.
- cancelsChecked, 4261-4291: runs on stand-in funds and doesn't look at the inputs.
- Danogo swaps: directSpends 6730 refuses the session's own UTxO only as body-13 collateral, not as an input.
- Review it myself: swapBuild, 3210-3211 (buildTx → review → inspect) has the same gap.

After the fill:
- act, 3862-3904 → bringBack(rows), 4324 → buildBack, 4616-4640.
- `collateral = rows.find(collateralFits && funding) ?? rows.find(collateralFits)` finds nothing. collateralFits (1052-1054) wants exactly 5 ₳ of ADA alone.
- collateralWanted(…, true), 4918-4930, returns true once the spare pays for a box, so `skipped = NO_COLLATERAL()` (781).
- intoPool (4565-4573) needs `rows.some(collateralFits)`, so there is no tail (the collateral's mix).
- build() (4749-4778) makes the direct return with `lovejoinSkipped` (4804), and sendBack (5075-5078) records it on the session.
- WebAssembly's session_collateral (wasm/src/lib.rs:985-999) takes an exact 5 ₳, or else the largest ADA-only UTxO of 2 ₳ or more. So the merged direct return still builds, and the finder's "merged into the funding's change" holds.
- The approval's "mixed" comes from outBuild 2018, `reserve && keepsReserve(quote, lovejoin)`. keepsReserve (1076-1078) is true when tokenOut is lovelace.

Since:
- Swap fundings have paid the 5 ₳ since b858d22e (2026-09-24). The NO_COLLATERAL skip arrived in d319d9fa (2026-09-27, privacy review §2.15).
- Both are at web-wallet/1.6.0 and web-wallet/1.9.1. I ran `git show <tag>:…sessions.ts | grep -c NO_COLLATERAL`, which gave 3 at each tag, and the sender-only comment in minswap.ts gave 1 at each.

What the test run logged (temporary logging, since removed):
- Control: the swap spends 010101#0 alone. The session ends with chain {total: 13}. Its kinds are: out, swap, deposit (the change and the fill into 9 boxes), 9 mixes, deposit (spending 010101#1, the 5 ₳), the mix, back. The Lovejoin record's chain carries `tail` {deposit d40a53f3…, mix 96623c0e…}.
- Main case: the swap's inputs are [010101#0, 010101#1]. Next comes one return, 5c1b159c, spending [change#1, fill aaaa#0]. The session's kinds are out, swap, back. lovejoinSkipped is "its 5 ₳ collateral isn't at its account anymore, and the mixes need it". There is no chain and no Lovejoin record.

Mutant in a copy (`$HOME/.cache/seedelf-review-51/verify-gap-g4_2-trace`, removed afterwards). In order(), after inspect, I added:

```ts
const takes = new Set(txInputs(hexBytes(txCbor)));
if (rows.some((u) => collateralFits(u) && takes.has(outpoint(u)))) throw new Refused(...);
```

With that, the test passed: "Test Files 1 passed (1)", "Tests 1 passed (1)", Duration 19.41s. The unmodified copy failed the same way TREE does.

**Known:** None: not known or settled.

Searched backlog.md, every docs/archive/plans/*.md, privacy.md, flows.md, architecture.md and SECURITY.md for: 'coin selection', 'picks the sender', 'its own view of the chain', 'spends the 5', 'spent the 5', 'takes the 5 ₳', 'took the 5', 'spends its 5', 'spent its 5', 'Minswap takes/took/picks/chose/spends', 'build-tx spends/takes', and the backlog's collateral lines.

Nearest matches, none of them this case:
- Privacy review §2.15 (d319d9fa): a site's transaction spends the 5 ₳, and the skip says so.
- Independent review M9: a site session's first return spent it, and Top up puts one back.
- privacy.md:458 lists what spends a session's collateral: a site's transaction, an earlier return, or a Stop's cancel. The swap isn't on the list.
- flows.md:475 says "Minswap picks the account's UTxOs itself". That's design text, and says nothing of the 5 ₳.
- architecture.md:653 covers holdsCancelCollateral.
- E7a.md:161, in this same chunk, raised the doubt without tracing it.

Not covered by the owner's rules either. "Refuses only what the ledger refuses" bears on which fix to choose, not on whether this is a finding. SECURITY.md doesn't name Minswap as a trusted data source.

**Fix notes:**

The family: every swap Minswap builds reaches the signature through inspect (sessions.ts:4349). That covers the runner's order() (4167-4175) and Review it myself's swapBuild (3210-3211), for order swaps and Danogo swaps alike. directSpends 6730 guards only the collateral field (body key 13), never the inputs. So a fix in inspect for kind "swap" covers both callers.

Options, each the owner's call:
- (a) Pause, with a reason, a swap whose spends include a collateralFits row of `rows`. That refuses a transaction the ledger takes. In a copy, three lines after inspect in order() made the test pass.
- (b) Let the return's chain put up any ADA-only UTxO of 5 ₳ or more, and pay an exact 5 ₳ out of it for the collateral's deposit and mix first. Only the chain's path wants exactly 5 ₳ (collateralFits at 4568 and 4623-4625). WebAssembly's direct merge already takes the largest ADA-only UTxO of 2 ₳ or more (lib.rs:985-999).
- (c) Ask build-tx with an input list, if Minswap's API takes one. minswap.ts:8-9 and chunk-15's research say it doesn't.

The test doesn't depend on which fix: it passes under (a), where nothing signed spends the 5 ₳, and under (b), where the return still goes through Lovejoin.

Add the swap to privacy.md:458's list in any case.

A test gap: swap-session.ts `funded()` says the account holds "what the recorded swap spends, and its collateral" but adds only the one swap UTxO. So no swap test ever had the 5 ₳ at the account when the order was placed.

Reach still turns on the finder's lookup. Check the inputs of real session swaps, for example chunk 24's 2026-10-07 mainnet runs and chunk 34's preprod 8e7fea0d…: does any of them spend its funding's 5 ₳ output (#1)?

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/extension/tests/r51-gap-g4-2.test.ts`

Result: Command, run from TREE's extension/:

nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 10m npx vitest run tests/r51-gap-g4-2.test.ts

It exited with 1. The control passed, and the main case failed at line 234:

 ❯ tests/r51-gap-g4-2.test.ts (1 test | 1 failed) 12585ms
   ❯ a swap Minswap builds spending the session's own 5 ₳ collateral (chunk 51, gap-g4#2) (1)
     × never costs the session the Lovejoin return its approval promised 12577ms
 FAIL  tests/r51-gap-g4-2.test.ts > a swap Minswap builds spending the session's own 5 ₳ collateral (chunk 51, gap-g4#2) > never costs the session the Lovejoin return its approval promised
AssertionError: expected { signed: true, …(7) } to deeply equal { signed: true, …(7) }
- Expected
+ Received
  {
    "filled": true,
-   "lovejoinSkipped": undefined,
+   "lovejoinSkipped": "its 5 ₳ collateral isn't at its account anymore, and the mixes need it",
    "paused": undefined,
    "returned": true,
    "signed": true,
-   "skippedForWantOfTheCollateral": false,
+   "skippedForWantOfTheCollateral": true,
    "spentCollateral": true,
-   "throughLovejoin": true,
+   "throughLovejoin": false,
  }
 ❯ tests/r51-gap-g4-2.test.ts:234:8
 Test Files  1 failed (1)
      Tests  1 failed (1)
   Duration  19.18s

The same test in a copy, with a three-line fix in order() that refuses a swap whose inputs include a collateralFits row of `rows`: "Test Files 1 passed (1)", "Tests 1 passed (1)", Duration 19.41s. The copy has been removed. No tracked file in TREE changed (`git diff --quiet` is clean); the only new file is the test.

```
// Chunk 51, finding gap-g4#2 (the trace verifier's test). A swap's funding pays its one-time account two outputs: the
// swap with its costs (and the collateral's mix's reserve), and exactly 5 ₳, the account's own collateral (outBuild).
// Minswap's build-tx takes only the sender and picks the sender's UTxOs itself (minswap.ts). Nothing the runner checks
// before it signs (inspect, refuseOddities, checkOrder, cancelsChecked, withinFunding) looks at which of the session's
// UTxOs the swap spends, so a swap that spends the 5 ₳ too is signed and sent. The 5 ₳ joins the swap's change, and
// after the fill no exact 5 ₳ is left (collateralFits): the return, approved through Lovejoin, comes back directly,
// "its 5 ₳ collateral isn't at its account anymore, and the mixes need it" (NO_COLLATERAL), its collateral unmixed.
// Right: the approval's way back holds. Either the runner signs no swap that spends the session's 5 ₳ collateral, or
// the return after such a swap still goes through Lovejoin, nothing left out for want of that collateral.
// The harness is r51-gap-g4-1.test.ts's: the real WebAssembly, v2's 5 ₳ pool, and fakes of Koios, giveme.my and
// Minswap's aggregator, whose build-tx answers the swap given. Its control, the same swap spending the swap's output
// alone, is signed and comes back through Lovejoin: only the inputs Minswap picked differ.
import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import { LovejoinService, type PoolRef } from "../src/background/lovejoin";
import { Minswap } from "../src/background/minswap";
import { SessionService } from "../src/background/sessions";
import { t as tr } from "../src/i18n";
import { txIdOf } from "./fixtures/cbor";
import { bytes, cbor, type Cbor, hex, ORDER_ADDRESS, ORDER_DATUM, ORDER_DATUM_HASH, SESSION_ADDRESS } from "./fixtures/swap-tx";
import { loadTestWasm, testBalances, vectors } from "./fakes";
import { atSession, MIN, orderRow } from "./swap-session";
import { ADA_POOL, ADA_ROWS } from "./v2-pools";

const PASSWORD = "correct horse battery";
const PHRASE = (vectors("cardano_account.json") as Array<{ account: number; phrase: string }>).find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
)!.phrase;
/** Ogmios's answer when the network measures no more than a transaction declares. */
const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };

/** The session's funding: output 0 the swap and its costs, output 1 the account's own 5 ₳ collateral. */
const FUND = "01".repeat(32);
const SWAP_IN = `${FUND}#0`;
const COLLATERAL = `${FUND}#1`;
/** The MIN it sells. */
const SOLD = 906_594_100n;
/** Its costs as quoteOf funds them (the DEX's 2 ₳ fee, the 2 ₳ deposit, no Minswap fee on preprod, the 2 ₳ room), and the collateral's mix's 1.5 ₳ reserve. */
const FUNDED = 7_500_000n;
/** What the order holds beside the MIN (the batcher's fee and the deposit), and the swap's fee. */
const ORDERED = 4_000_000n;
const FEE = 205_189n;
/** The fill: the ADA bought and the deposit back. */
const FILL_TX = "aa".repeat(32);
const FILLED = "908594100";

const minValue = (lovelace: bigint, quantity: bigint): Cbor => ({
  raw: hex([0x82, ...cbor(lovelace), 0xa1, 0x58, 0x1c, ...bytes(MIN.slice(0, 56)), 0xa1, 0x43, ...bytes(MIN.slice(56)), ...cbor(quantity)]),
});

/**
 * Minswap's swap of the MIN for ADA from session 0's account, shaped as fixtures/swap-tx.ts has Minswap's V1 order (the
 * order at its script, its datum by hash in the witness set, the change back): spending the swap's output alone, or
 * (`collateralToo`) both of the funding's outputs, as a coin selection that takes every UTxO the sender holds would.
 */
function swapOf(collateralToo: boolean): { cbor: string; change: bigint } {
  const change = FUNDED + (collateralToo ? 5_000_000n : 0n) - ORDERED - FEE;
  const body = new Map<number, Cbor>([
    [0, { tag: 258, of: collateralToo ? [[bytes(FUND), 0], [bytes(FUND), 1]] : [[bytes(FUND), 0]] }],
    [
      1,
      [
        new Map<number, Cbor>([
          [0, bytes(ORDER_ADDRESS)],
          [1, minValue(ORDERED, SOLD)],
          [2, [0, bytes(ORDER_DATUM_HASH)]],
        ]),
        new Map<number, Cbor>([
          [0, bytes(SESSION_ADDRESS)],
          [1, change],
        ]),
      ],
    ],
    [2, FEE],
    [3, 134_639_865],
  ]);
  const witnesses = new Map<number, Cbor>([[4, { tag: 258, of: [{ raw: ORDER_DATUM }] }]]);
  return { cbor: hex(cbor([body, witnesses, true, null])), change };
}

type T = ReturnType<typeof testBalances>;
type Record = {
  lovejoinSkipped?: string;
  chain?: unknown;
  auto?: { paused?: { why: string; detail?: string }; retry?: { error: string }; filled?: number };
  txs: Array<{ kind: string; txHash: string }>;
};

/** Lovejoin reading `pools`, giveme.my's witness stood in for (lovejoin-planner.test.ts `pooled`). */
function pooled(t: T, pools: PoolRef[]): LovejoinService {
  const wasm = loadTestWasm();
  return new LovejoinService({
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
    pools: async () => pools,
    random: () => 0.5,
  });
}

/** The sessions over `lj`, the one-time key's script signature stood in for (lovejoin-planner.test.ts `runner`). */
function runner(t: T, lj: LovejoinService): SessionService {
  const wasm = loadTestWasm();
  return new SessionService({
    ...t.deps,
    wasm: {
      ...wasm,
      signScriptSpend: (_key: unknown, request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
    lovejoin: lj,
    sleep: async () => undefined,
  });
}

/**
 * Session 0 sells the MIN for ADA, approved through Lovejoin one wave deep, its collateral's mix paid for, as outSubmit
 * records it; its funding landed, and no order yet. The account holds both of the funding's outputs, and v2's 5 ₳ pool
 * its 20 boxes of other people's. The runner places the order from what Minswap builds (`collateralToo`, swapOf). If
 * it signs it, the swap lands, the batcher fills it, and the runner runs until the session's return goes.
 */
async function swapped(collateralToo: boolean) {
  const t = testBalances();
  await t.wallet.create(PHRASE, PASSWORD);
  t.koios.evaluation = AGREES;
  // A slot in preprod's Shelley era, for what the account signs (lovejoin-flows.test.ts).
  t.koios.tip = 110_000_000;
  t.koios.confirmations = 1;
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  await t.deps.preferences.set({ lovejoinDepth: 1 });
  const swap = swapOf(collateralToo);
  const SWAP_TX = txIdOf(bytes(swap.cbor));
  t.minswap.swapCbor = swap.cbor;
  const sessions = runner(t, pooled(t, [ADA_POOL]));
  const now = t.clock.now;
  await t.store.set("sessions.preprod", {
    next: 1,
    sessions: [
      {
        index: 0,
        ownStake: true,
        createdAt: now,
        txs: [{ kind: "out", txHash: FUND, at: now, confirmed: true, outs: [SWAP_IN, COLLATERAL] }],
        swap: { amount: SOLD.toString(), tokenIn: MIN, tokenOut: "lovelace", slippage: 0.5, amountOut: "906594100", minAmountOut: "902083681" },
        auto: {
          approved: {
            minAmountOut: "902083681",
            fund: { lovelace: "6000000", tokens: [{ policyId: MIN.slice(0, 56), assetName: MIN.slice(56), quantity: SOLD.toString() }] },
            aggregatorFee: "0",
          },
          direct: false,
          lovejoin: { depth: 1, delay: "1-6", box: "5000000" },
        },
        collateralReserve: true,
      },
    ],
  });
  t.koios.addedToAccounts.push(atSession(FUND, 0, FUNDED.toString(), [[MIN, SOLD.toString()]]), atSession(FUND, 1, "5000000"), ...ADA_ROWS);
  const book = async () => (await t.store.get<{ sessions: Record[] }>("sessions.preprod"))!.sessions[0]!;

  // The runner places the order: Minswap's swap, the checks, the session's key.
  await sessions.advance("preprod", 0, true);
  const sent = t.koios.submitted.map((tx) => ({ id: txIdOf(tx), inputs: txInputs(tx) }));
  const signed = sent.find((x) => x.id === SWAP_TX);
  if (!signed) return { signed: false, spentCollateral: sent.some((x) => x.inputs.includes(COLLATERAL)), s: await book() };

  // It lands: the order waits at Minswap V1's script, and its change is at the account.
  for (const o of signed.inputs) t.koios.spent.add(o);
  t.koios.addedToAccounts.push(atSession(SWAP_TX, 1, swap.change.toString()), {
    ...orderRow(SWAP_TX, 0, ORDERED.toString()),
    asset_list: atSession(SWAP_TX, 0, "0", [[MIN, SOLD.toString()]]).asset_list,
  });
  await sessions.advance("preprod", 0, true);

  // The batcher fills it: the order is spent, and the ADA bought arrives. The runner runs until a return goes, its
  // chain through Lovejoin or one that comes back directly.
  t.koios.spent.add(`${SWAP_TX}#0`);
  t.koios.addedToAccounts.push(atSession(FILL_TX, 0, FILLED));
  for (let run = 0; run < 4; run++) {
    const r = await book();
    if (r.chain !== undefined || r.txs.some((x) => x.kind === "back")) break;
    await sessions.advance("preprod", 0, true);
  }
  const s = await book();
  return { signed: true, spentCollateral: signed.inputs.includes(COLLATERAL), s };
}

/** What the session's return did: through Lovejoin (its chain recorded), or why Lovejoin was left out. */
const wayBack = (s: Record) => ({
  filled: s.auto?.filled !== undefined,
  returned: s.chain !== undefined || s.txs.some((x) => x.kind === "back"),
  throughLovejoin: s.chain !== undefined,
  lovejoinSkipped: s.lovejoinSkipped,
  paused: s.auto?.paused,
});
const AS_APPROVED = { filled: true, returned: true, throughLovejoin: true, lovejoinSkipped: undefined, paused: undefined };

describe("a swap Minswap builds spending the session's own 5 ₳ collateral (chunk 51, gap-g4#2)", { timeout: 900_000 }, () => {
  it("never costs the session the Lovejoin return its approval promised", async () => {
    // The control: Minswap's swap leaves the 5 ₳ alone. It's signed, and the return goes through Lovejoin.
    const control = await swapped(false);
    expect({ signed: control.signed, spentCollateral: control.spentCollateral, ...wayBack(control.s) }).toEqual({
      signed: true,
      spentCollateral: false,
      ...AS_APPROVED,
    });

    // Minswap's swap spends the 5 ₳ too. A runner that won't sign it is right; one that signs it must still bring the
    // session back through Lovejoin, as approved.
    const both = await swapped(true);
    if (!both.signed) {
      expect(both.spentCollateral).toBe(false);
      return;
    }
    expect({
      signed: both.signed,
      spentCollateral: both.spentCollateral,
      skippedForWantOfTheCollateral: both.s.lovejoinSkipped === tr("sess.skip.warn.noCollateral"),
      ...wayBack(both.s),
    }).toEqual({
      signed: true,
      spentCollateral: true,
      skippedForWantOfTheCollateral: false,
      ...AS_APPROVED,
    });
  });
});
```

## Impact: partly, low

The code path holds. Nothing in order(), inspect(), withinFunding or checkOrder looks at which of the session's own UTxOs Minswap spends. If the swap takes the exact 5 ₳, buildBack finds no collateralFits row and collateralWanted returns true, so the return skips with NO_COLLATERAL, builds no chain and no tail, and comes back directly. privacy.md:458 doesn't list the swap as a cause.

The harm needs Minswap's honest coin selection to take an input it doesn't need, and nothing shows that it does:

- **The finder's own case doesn't happen under the usual algorithms.** That case is a sell whose approval says 'mixed'. 'Mixed' needs the 1.5 ₳ reserve, so output 0 holds the token plus at least 6.2 ₳ (MinswapV2's 0.7 ₳ fee + 2 ₳ deposit + 2 ₳ margin + 1.5 ₳). Output 0 is the only input with the token, and it covers all the ADA. Largest-first stops there. CSL's random-improve only swaps inputs. A selection that adds inputs toward twice the target would also skip the 5 ₳ on any single leg: the order's ADA is at most about 5.35 ₳, and adding pays only above 6 ₳.
- **The one recorded live sell left the 5 ₳ in place.** Preprod, 2026-09-25, MIN → ADA, chunk-16-lovejoin.md:376 and :393. Its return's chain put the 5 ₳ up for a deposit and 6 mixes, and it came back afterwards. It was a single-leg swap, though, so it doesn't tell the algorithms apart.
- **Where some algorithm could reach it, little is lost today:**
  - Buys: a random or add-toward-target selection could take the 5 ₳. But a buy's spare ADA pays for no box, and no v2 token pool is bundled on either network. So a buy's approval says 'ifLeft', and the loss is the 5 ₳ coming back unmixed.
  - Split-route sells: an add-toward-target selection would take the 5 ₳, and the finder's harm would follow. Whether Minswap uses one is unknown.
  - On mainnet the return is direct anyway while the 5 ₳ pool is under its floor.
- **What the user loses if it happens:**
  - No money: a direct return is cheaper by about 4.1 ₳ a box.
  - Privacy: the chain's share (at most 32 boxes, 160 ₳, at the default depth; the rest of a large return comes back directly by design) comes back tied to the session. privacy.md:356 names this link for a direct return.
  - The page says why. An auto session has no way out in the wallet. The proceeds can still be mixed later from the private balance.

So it's a missing check plus a doc gap, with no harm shown: low. If the free lookup below shows Minswap taking a funding's #1, split-route sells through Lovejoin would make it medium.

**Evidence:**

The trace, checked in TREE (src unchanged from web-wallet/1.9.1 except manifest.ts):
- sessions.ts:4167 calls `minswap.buildTx(address, …)`; minswap.ts:389-397 posts only the sender. In inspect, 4372-4377 build `own` from `rows`, which hold the 5 ₳. withinFunding (6571-6582) counts only `paidOut`, what leaves the address. checkOrder (6672) returns early for outputs at the session's address.
- After the fill:
  - buildBack 4623-4625; collateralFits 1052-1054 (exactly 5 ₳).
  - 4629-4640: collateralWanted gives NO_COLLATERAL (781), and no chain is built.
  - intoPool 4565-4573 needs collateralFits, so there's no tail.
  - The direct merge still goes: wasm lib.rs:985-999 session_collateral takes the exact 5 ₳, else the largest ADA-only UTxO of 2 ₳ or more.

Funding shape:
- outBuild 1932-1948: output 0 is quote.fund + l.fund + reserve, with the tokens; output 1 is exactly 5 ₳.
- quoteOf 908-912: costs = dex fee + deposits + aggregator fee + SWAP_MARGIN (2 ₳).
- tailReserve 4848-4870 gives 1.5 ₳.
- 2018: 'mixed' only with the reserve and keepsReserve (1076-1078).
- So a 'mixed' sell's output 0 holds at least 0.7 + 2 + 2 + 1.5 = 6.2 ₳, using the lowest order fee in gap-G4's decode of order_cancels.json.

Records:
- chunk-16-lovejoin.md:376-378 and :393-395 (preprod MIN → ADA, order 20aadac3…, deposit 952fd89f…): 3 boxes deposited and 6 mixes run, so the exact 5 ₳ was there after Minswap's swap. After Stop, 'the 12.6 ₳ of change and the 5 ₳ collateral' came back.
- chunk-24-dapp-additions.md:129: 'everything works'. No NO_COLLATERAL on a swap is recorded anywhere.

Narrowing:
- spareOf (6400-6404) counts only ADA-only rows.
- extension/src/lovejoin-pools.json bundles mainnet dc6abe3b (retired) and fcb3f5ec (v2, 5 ₳); preprod's token pools are v1.
- collateralWanted 4931-4937 returns the floor's reason, not true, under the floor.
- privacy.md:412: the chain cap is 32 boxes at depth 2, about 4.1 ₳ a box.
- architecture.md:654: Put in 5 ₳ for Lovejoin is offered only to sessions brought back by hand.
- en.json sess.skip.warn.noCollateral is the page's line.

Free lookup: the owner's 2026-10-07 mainnet buys (20 ₳ → SUNDAE/NTX/MIN, 50 ₳ → USDA/IAG/COPI/LQ). Does any swap spend its funding's #1? Random or add-toward-target selection would show on most of them; largest-first on none.

**Known:** Not settled. The only earlier mention is E7a's unverified note in this review (lanes/E7a.md:161). Privacy review §2.15 (Low, fixed in d319d9f) settles the fallback itself: a session whose collateral is gone comes back directly and says why. privacy.md:458 lists the other causes. I searched backlog.md for collateral, Minswap and coin selection and found nothing on this cause.

**Fix notes:**

Start with the free lookup above. If it shows Minswap taking a funding's #1, the cheap guard is a check in order(), before signing: do the built swap's spends include a collateralFits row of `rows`? What to do then is the owner's call, since any of these pauses a swap the ledger takes or changes how a return finds its collateral:
- ask Minswap again;
- let the chain put up any ADA-only UTxO of 5 ₳ or more and pay an exact 5 ₳ out of it for the tail first (session_collateral already does this for the direct merge);
- pause the swap with a reason.

In any case, add the swap to privacy.md:458's list.
