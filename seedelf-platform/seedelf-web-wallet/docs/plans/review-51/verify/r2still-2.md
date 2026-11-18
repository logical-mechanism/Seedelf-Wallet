# r2still#2: verification

From lane R2still, graded low by its finder.

## Trace: confirmed, low

The finding holds as described. I checked every quote at its cited line in FIXTREE; sessions.ts has no uncommitted changes, so this is the committed code.

Part 1: gap-g4#1's fix (506e4ed2) only adds `late = since` to the first return. When both of the run's credential_utxos reads miss leg 2, while utxo_info already reads every order spent, `since` is empty. The first return's chain then takes leg 1, the change and the 5 ₳ collateral, and leg 2 comes back later in a lone, direct return (NO_COLLATERAL).

Part 2: e2b#2's rule (fdd3b8b2) marks that later return `strangers`. Leg 2's transaction is not in `own`, and it is not in `auto.fills` either, which is recorded once from the two listings that missed it. So the reason is never written, and the finished swap's page says "Through Lovejoin" with nothing about the direct part. privacy.md:458 promises the opposite: "comes back directly, and says Lovejoin was left out and why".

My test shows both parts. It fails on FIXTREE in both builds, and also on a copy of the committed code (HEAD's lovejoin.ts, without another fixer's uncommitted gap-g6#2 edit). Two mutants in that copy settle the cause and the fix:
- Disabling `{ strangers: true }` brings the NO_COLLATERAL reason back, so the rule is what silences the page.
- The impact verifier's sturdier fix (wait a run after every order first reads spent) makes the test pass in both builds.

Severity: low.
- Who: the user's own default swap, a route split into legs that fill in different blocks. The trigger is a timing race between read backends that nobody controls: the listings' backend must be behind utxo_info's for both reads around it. That fits Koios's load-balanced gateway (preprod, Koios-only, or the data layer's public part down).
- Cost: one more return fee (about 0.2 ₳, the gap-g4#1 verifier's figure). In a narrow band (the first legs don't already fill the 32-box cap or the pool's room), some of the late leg's ADA goes back unboxed, tied on chain to the session. The page now leaves that out, and for an ADA→token split the label reads "partly" (traced; the label part predates this round).
- No money is lost or stuck, and none of it needs a way out.

I'd put "who" as user, by timing alone, rather than the finder's nobody. The grade doesn't change.

**Evidence:**

Trace in FIXTREE, seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts. It is unmodified in the working copy, so it equals HEAD.

1. act (3772): 3859 `const { listed, rows } = await this.listing(network, keyHash);` is a const and never reassigned. listing (6119-6125) is credential_utxos through readFresh, which retries only when the listing holds rows the wallet spent.
2. 3936 liveOrders is utxo_info of the recorded orders; it returns [] once both are spent. 3969 ordersSpent is a second utxo_info.
3. 3973 `if (!auto.filled && !auto.refunded) {`:
   - 3977 `const since = returnable(s, (await this.listing(network, keyHash)).rows).filter(...)`
   - 3980 outcomeOf and 3982 `const fills = fillsOf(s, [...arrived, ...since]);`, recorded once (`r.auto!.fills = fills`)
   - 3992 `late = since;`
   With both listings behind utxo_info's source, since = [] and late = [].
4. 4005 `bringBack(network, s.index, [...rows, ...late], false, u)` leads to buildBack (4652). The chain is built from those rows alone: lovejoin.ts (HEAD) chain() 3673-3760 and fanOut read only the pool (split), never the session's account. The chain's collateral (4788 collateralFits) and its tail (intoPool 4727) take the 5 ₳.
5. Once the chain lands:
   - 3908 `if (kinds.has("deposit") || kinds.has("mix")) return go(... bringBack(network, s.index, rows ...))` runs with rows = [leg 2].
   - chainSoFar (1339-1348) reads the chain as finished, so started = false.
   - No row passes collateralFits, so collateralWanted is true, and 4802 sets `skipped = ... NO_COLLATERAL()`.
   - intoPool needs `rows.some(collateralFits)`, so there is no tail. The return is direct.
6. 4704-4711 `apart` is `{ strangers: true }`: a back was sent, and `rows.every((u) => !own.includes(u.tx_hash) && !fills.has(u.tx_hash))` holds for leg 2, which is in neither own (4697) nor auto.fills (step 3).
7. 5241 `const skipped = built.strangers ? undefined : built.lovejoinSkipped;`, so 5244 never writes s.lovejoinSkipped. sendChain 5361 `if (strangers) return;` does the same for a chain.
   - The view (6063) carries no lovejoinSkipped.
   - Swaps.tsx:3101 backStepText falls to s.chain (the first chain, not cut), which reads "Through Lovejoin".
   - `<LovejoinSkipped>` (Swaps.tsx 2559, 2622) shows nothing.
8. privacy.md:458 (FIXTREE): "A session whose collateral was spent (... an earlier return, which takes it too ...) comes back directly, and says Lovejoin was left out and why."

ADA→token (traced, not run): outcomeOf (6740-6757) sees only leg 1's token, below the whole swap's minAmountOut, and returns "partly". That label part predates the round (M18's two readings).

Blame: 4700-4711 fdd3b8b2 (e2b#2), 3992 506e4ed2 (gap-g4#1), 3977-3979 19b1a7ed (M18).

Reach: DataLayerKoios.read (data-layer.ts:232-253) sends each read to the data layer or to Koios. A data-layer failure mid-run moves the rest of the run to Koios, and Fix A covers that case. The residual needs both listings answered by a backend behind utxo_info's, as Koios's balanced gateway can do. I didn't read the mainnet data layer's own sources (seedelf-data is out of the chunk).

The test's model: both orders read spent from run 1 (t.koios.spent is preset), and leg 2 is put into the fake account only after run 1. So both of run 1's credential_utxos reads miss it, and every later listing has it.

Runs:
- FIXTREE, both builds: fails on both soft assertions.
- Committed-code copy (`git archive HEAD` into ~/.cache/seedelf-review-51/verify-r2still_2-trace, wasm/pkg copied, node_modules symlinked): the same failures.
- Mutant in the copy, sessions.ts:4710 `{ strangers: true as const }` changed to `{}`: only the first assertion fails, now with `"lovejoinSkipped": "its 5 ₳ collateral isn't at its account anymore, and the mixes need it"`.
- Fix in the copy (rule restored, `return;` after 3992's `late = since;`): passes in both builds.

The copy is removed. In FIXTREE I wrote only the test file.

The WebAssembly pkg was built at 04:20, after the last Rust commit (21caa3b8, 03:58).

**Known:** Not known. This member and its sturdier fix appear only as recommendations the fixer didn't take, in verify/gap-g4-1.md: the impact verifier's fix note 1 (line 371) and the tiebreak's note 2 (line 398). Neither is a settled list.

What I searched:
- docs/backlog.md: split route, second/late leg, leg paid, both/second listing, utxo_info ahead, auto.fills, fillsOf, strangers. Nothing.
- docs/archive/plans/: the same terms. The only hits are chunk-34 F4 (fillsOf's junk-token rule), chunk-24's multi-hop note and chunk-29's quote test, and none of them is this.
- review-51/owner-calls.md: lists only gap-g4#2, a different finding.
- fixes/G4.md: names the timeline step pointing at the latest return, not a late fill.
- verify/e2b-2.md: considers no fill missed by fillsOf.
- SECURITY.md out of scope: no data source has to lie; backends a block apart are honest.
- No owner rule applies: the fix adds no refusal and changes no default.

**Fix notes:**

This needs no owner call.

1. Part 1, the class fix (sessions.ts act, 3973-4005). Don't decide or build in the run that first reads every order spent. Record that moment, for example `auto.spentSeen = now()`, and return. In the next run:
   - work out outcomeOf and fillsOf from that run's own listings;
   - record filled, refunded, partly and fills;
   - build the first return from those same rows.
   In a copy, adding just `return;` after `late = since;` made r51-r2still-2 pass in both builds. That minimal form is not enough, though, because it keeps the outcome and the fills from the earlier listings:
   - an ADA→token late leg would still read "partly" (outcomeOf, 6740);
   - its token couldn't go into its approved pool, since lovejoin.ts acrossOf allows only `own ∪ fills` (`mayGo`).
   So work both out in the run that builds the return. The cost is one READ_EVERY_MS cycle. The change narrows the race but doesn't close it: a listing more than a cycle behind still misses the leg, and part 2 covers the page in that case. Runner tests that count runs (swap-runner.test.ts, lovejoin-planner.test.ts's gap-g4#1 case) may need one more advance.

2. Part 2 (4704-4711). e2b#2's `apart` must not read the swap's own late fill as a stranger's. One way: count rows as strangers' only if they reached the chain after the session's first return was sent (KoiosUtxo `block_time * 1000` later than that back's `at`, or a block above where it landed). A leg already on chain before the return, but listed only after it, then keeps the session's word (NO_COLLATERAL), as privacy.md:458 promises. Another way: keep adding fillsOf-shaped arrivals to auto.fills until a return after them has gone. sendChain's `if (strangers) return;` (5361) needs the same rule.

3. Class:
   - A return built, or a verdict taken, from a reading made before the step that proves the account complete. This is gap-g4#1's family; C12's `unlisted` (3877ff) and e7a#3's `partsUnlisted` are its other members.
   - A set recorded once (`auto.fills`) and later read as if complete: e2b#2's `apart`, acrossOf's `mayGo`, and outcomeOf's label.
   Test: r51-r2still-2.test.ts.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51-fixes/seedelf-platform/seedelf-web-wallet/extension/tests/r51-r2still-2.test.ts`

Result: FIXTREE (from extension/, `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 10m nice -n 10 npx vitest run tests/r51-r2still-2.test.ts`): FAILS on both soft assertions.
```
 ❯ tests/r51-r2still-2.test.ts (1 test | 1 failed) 2072ms
     × comes back in the session's first return, through Lovejoin as approved, and never alone after it unsaid 2071ms
AssertionError: expected { closed: true, …(3) } to deeply equal { closed: true, …(3) }
  {
    "closed": true,
-   "firstTakesLate": true,
+   "firstTakesLate": false,
    "lovejoinSkipped": undefined,
-   "returns": 1,
+   "returns": 2,
  }
 ❯ tests/r51-r2still-2.test.ts:173:8
Error: the swap's own leg came back alone and directly, and the page says nothing of it: expect(received).toSatisfy()
Received: Object { "lateAloneDirect": true, "pageSays": undefined }
 ❯ tests/r51-r2still-2.test.ts:181:8
 Test Files  1 failed (1)
      Tests  1 failed (1)
```

The same command with `VITE_ENABLE_MAINNET=false` in front also FAILS, with the same two diffs (firstTakesLate false, returns 2; lateAloneDirect true, pageSays undefined). Test Files 1 failed (1), Tests 1 failed (1).

Committed-code copy (`git archive HEAD`, so HEAD's lovejoin.ts rather than the working copy's uncommitted gap-g6#2 edit): the same two failures.

Mutant in the copy, sessions.ts:4710 `? { strangers: true as const }` changed to `? {}`: only the first assertion fails, now with `+ "lovejoinSkipped": "its 5 ₳ collateral isn't at its account anymore, and the mixes need it"`. The second (toSatisfy) passes, which shows that e2b#2's rule is what silences the page.

Fix in the copy (rule restored, `return;` added after 3992's `late = since;`, so the return is built from the next run's listing): `Test Files 1 passed (1) / Tests 1 passed (1)` in both the default and the VITE_ENABLE_MAINNET=false builds. The copy is removed.

```
// Chunk 51, finding r2still#2: gap-g4#1's fix (506e4ed2) has the first return take what the runner's second listing of
// the account found (`late = since`), so a split route's leg paid between the two listings goes in it. A leg that both
// listings miss, while utxo_info already reads every order spent (Koios's gateway answering the listings from a backend
// a block behind the one that answers utxo_info), is still left out: the first return's chain puts the 5 ₳ collateral
// into its pool, and the leg comes back alone in a later return, directly. And since e2b#2's strangers rule (fdd3b8b2),
// that return reads as a stranger's: the leg's transaction is neither the session's own nor in `auto.fills`, recorded
// once from the two listings that missed it. So the swap's page never says part of it came back directly, though
// privacy.md says a session whose collateral an earlier return took "comes back directly, and says Lovejoin was left
// out and why".
// Right: the first return takes every leg the chain has once every order is spent, and nothing comes back after it
// without Lovejoin; where the swap's own leg does come back alone and directly, its page says so.
// Real WebAssembly and Lovejoin v2's 5 ₳ pool, as lovejoin-planner.test.ts's gap-g4#1 case sets them up, the leg listed
// only from the run after the one that first read every order spent.
import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import { LovejoinService, type PoolRef } from "../src/background/lovejoin";
import { Minswap } from "../src/background/minswap";
import { SESSION_CHAIN_PREFIX, SessionService } from "../src/background/sessions";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, testBalances, vectors } from "./fakes";
import { ASK, atSession, MIN, orderRow, SWAP_TX } from "./swap-session";
import { ADA_POOL, ADA_ROWS } from "./v2-pools";

const PASSWORD = "correct horse battery";
const PHRASE = (vectors("cardano_account.json") as Array<{ account: number; phrase: string }>).find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
)!.phrase;
/** Ogmios's answer when the network measures no more than a transaction declares. */
const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };

type T = ReturnType<typeof testBalances>;
type Book = { closedAt?: number; lovejoinSkipped?: string; txs: Array<{ kind: string; txHash: string; replaced?: boolean }> };

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

describe("a split route's leg that both of the runner's listings miss (chunk 51, r2still#2)", { timeout: 600_000 }, () => {
  it("comes back in the session's first return, through Lovejoin as approved, and never alone after it unsaid", async () => {
    const t = testBalances();
    await t.wallet.create(PHRASE, PASSWORD);
    t.koios.evaluation = AGREES;
    // A slot in preprod's Shelley era, for what the account signs (lovejoin-flows.test.ts).
    t.koios.tip = 110_000_000;
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    const sessions = runner(t, pooled(t, [ADA_POOL]));

    // Session 0 sold MIN for ADA through Lovejoin, as approved, one wave deep; Minswap split it into two orders,
    // SWAP_TX#0 and #2, both landed. Its funding (FUND) paid it the 5 ₳ collateral too.
    const now = t.clock.now;
    const FUND = "01".repeat(32);
    const orders = [`${SWAP_TX}#0`, `${SWAP_TX}#2`];
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: now,
          txs: [
            { kind: "out", txHash: FUND, at: now, confirmed: true },
            { kind: "swap", txHash: SWAP_TX, at: now, confirmed: true, orders, minAmountOut: "40000000" },
          ],
          swap: { ...ASK, tokenIn: MIN, tokenOut: "lovelace", amount: "906594100", amountOut: "41000000", minAmountOut: "40000000" },
          auto: {
            approved: { minAmountOut: "40000000", fund: { lovelace: "16000000", tokens: [] } },
            direct: false,
            lovejoin: { depth: 1, delay: "1-6", box: "5000000" },
          },
        },
      ],
    });
    // The account: the swap's change, the collateral, and leg 1's fill (20 ₳), listed; both orders spent at the DEX's
    // contract, as utxo_info reads them from the first run on; the 5 ₳ pool's 20 boxes of other people's.
    t.koios.addedToAccounts.push(
      atSession(SWAP_TX, 1, "2000000"),
      atSession(FUND, 1, "5000000"),
      ...orders.map((o) => orderRow(SWAP_TX, Number(o.split("#")[1]))),
      atSession("aa".repeat(32), 0, "20000000"),
      ...ADA_ROWS,
    );
    for (const o of orders) t.koios.spent.add(o);
    // Leg 2's fill (20 ₳) is in the block utxo_info's backend has and the listings' backend doesn't yet: neither of the
    // first run's two listings holds it. That backend has caught up by the next run, 15 s later.
    const LATE = `${"bb".repeat(32)}#0`;
    const late = atSession("bb".repeat(32), 0, "20000000");
    const book = async () => (await t.store.get<{ sessions: Book[] }>("sessions.preprod"))!.sessions[0]!;
    const before = t.koios.submitted.length;
    // The session's first return as the runner sent it: a chain through Lovejoin, kept as it's sent, or one that came
    // back directly.
    const firstReturn = async (): Promise<Uint8Array[]> => {
      const chain = await t.wallet.withKeys(() => t.session.get<{ txs: Array<{ txCbor: string }> }>(`${SESSION_CHAIN_PREFIX}preprod.0`));
      if (chain) return chain.txs.map((x) => Uint8Array.from(Buffer.from(x.txCbor, "hex")));
      return (await book()).txs.some((x) => x.kind === "back") ? t.koios.submitted.slice(before) : [];
    };

    // The run that first reads every order spent, its listings behind; then the leg is listed. A fix may wait a run
    // for it, so up to three runs until the first return goes.
    await sessions.advance("preprod", 0, true);
    t.koios.addedToAccounts.push(late);
    let first = await firstReturn();
    for (let run = 1; run < 3 && !first.length; run++) {
      await sessions.advance("preprod", 0, true);
      first = await firstReturn();
    }
    expect(first.length).toBeGreaterThan(0);

    // It lands, and the runner runs on until the session closes: whatever is left at the account comes back.
    t.koios.confirmations = 1;
    for (let run = 0; run < 10 && !(await book()).closedAt; run++) {
      for (const tx of t.koios.submitted) for (const o of txInputs(tx)) t.koios.spent.add(o);
      await sessions.advance("preprod", 0, true);
    }
    const s = await book();
    const view = await sessions.advance("preprod", 0, true);
    const firstTakesLate = first.some((tx) => txInputs(tx).includes(LATE));
    // Where the leg came back otherwise: in a return of its own after the first, with no deposit or mix after the
    // first return's, so directly.
    const lateTx = t.koios.submitted.find((tx) => txInputs(tx).includes(LATE));
    const lateHash = lateTx ? txIdOf(lateTx) : undefined;
    const later = s.txs.slice(s.txs.findIndex((x) => x.kind === "back" && !x.replaced) + 1).filter((x) => !x.replaced);
    const lateAloneDirect =
      !firstTakesLate && later.some((x) => x.kind === "back" && x.txHash === lateHash) && !later.some((x) => x.kind === "deposit" || x.kind === "mix");

    expect
      .soft({
        closed: s.closedAt !== undefined,
        // The first return takes leg 2's fill.
        firstTakesLate,
        // One return: the chain's, nothing after it.
        returns: s.txs.filter((x) => x.kind === "back" && !x.replaced).length,
        // Nothing came back saying Lovejoin was left out.
        lovejoinSkipped: s.lovejoinSkipped,
      })
      .toEqual({ closed: true, firstTakesLate: true, returns: 1, lovejoinSkipped: undefined });
    // And where the swap's own leg did come back alone and directly, its page says Lovejoin was left out of it, never
    // nothing, as for a stranger's 2 ₳ (e2b#2).
    expect
      .soft(
        { lateAloneDirect, pageSays: view.lovejoinSkipped },
        "the swap's own leg came back alone and directly, and the page says nothing of it",
      )
      .toSatisfy(({ lateAloneDirect: alone, pageSays }: { lateAloneDirect: boolean; pageSays?: string }) => !alone || pageSays !== undefined);
  });
});
```
