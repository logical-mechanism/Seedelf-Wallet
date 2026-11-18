# gap-g4#1: verification

From lane gap-G4, graded medium by its finder.

## Trace: confirmed, medium

It holds as described, and I found no guard that stops it. On the run where the last order reads spent, `act` reads the account first (sessions.ts:3770, `rows`, a const). It then looks the orders up (liveOrders 3841, ordersSpent 3872, both utxo_info) and reads the account a second time (`since`, 3880). That second reading holds the leg, but it feeds only `outcomeOf` and `fillsOf`.

The return is still built from the first reading (3904 `bringBack(network, s.index, rows)`). Neither bringBack, buildBack nor lovejoin.chain/fanOut reads the account again: they build from the `rows` they are given. So a leg paid in the block between the two reads is left out.

Through Lovejoin, that first chain also deposits the session's 5 ₳ collateral into the 5 ₳ pool (its tail). Once it lands, the leg is alone at the account and the next run sends it back by the ordinary path:
- act 3816 sends it back, because a deposit and a mix are already recorded.
- chainSoFar marks the chain finished, so buildBack tries Lovejoin again.
- No exact 5 ₳ is left (collateralFits), and collateralWanted returns true because the leg's spare pays for a box.
- So the return is direct, with "its 5 ₳ collateral isn't at its account anymore, and the mixes need it".

I ran this on TREE and it happened exactly so: the first chain had 3 boxes and none of its transactions spent the late leg. A second, direct return of the leg followed with that reason, then the session closed. The approval's own words (en.json:2346 swaps.lovejoin.privacy.on) are "Its spare ADA is mixed with other people's on the way back, so it's harder to tie to this session."

Who: the user, through an ordinary swap through Lovejoin (the default) that Minswap splits into single-leg paths. outOfPlace (minswap.ts:291-296) refuses only paths of more than one leg, so split routes are allowed. The trigger is timing:
- A leg's fill block lands between two back-to-back requests in one run, or the backend that lists the account is a block behind the one that answers utxo_info. Both go through the same client (data-layer.ts:244-253; Koios's gateway balances several backends).
- That is a few percent of split routes whose legs fill in different blocks. No stranger or site controls it.

Severity medium: by default it makes a privacy link that the approval said wouldn't be made. The late leg's ADA comes back directly, tied on chain to the session, instead of in mixed boxes. It also costs a second return's fee (about 0.2 ₳), and the page names the wrong cause. It sits at the narrow end of medium because of the timing window.

Not run, traced only:
- An ADA→token swap's late token leg comes back directly with noBox. A lone token fill has no spare ADA (spareOf leaves token UTxOs out), so collateralWanted's token branch can't pay for a box.
- A Splash last fill landing in the window would go the same way.
- The rare lone long-named token fill being left behind for cost rests on the finder's Python model, not on a run.

The finder's "since" is slightly early in the wrong direction. The return has been built from the listing taken before the order lookup since 2026-09-27's runner commits (git blame: 3770 c138b3b0, 3904 d74677a9). 19b1a7ed (M18's fix, that evening) is when the runner first read the leg, for the label alone. It is in every tag from web-wallet/1.6.0 to 1.9.1.

**Evidence:**

**Trace in TREE** (code identical to cd764fba; only review docs changed since):
1. sessions.ts:3770 `const { listed, rows } = await this.listing(network, keyHash);` is the first reading, never reassigned in act. listing (5945-5951) is credential_utxos through readFresh, which retries only when the listing holds UTxOs the wallet spent, so it makes no utxo_info call.
2. 3841 `const orders = await this.liveOrders(network, s, address, true);` is utxo_info of the recorded orders; with both spent it returns []. 3864 `arrived` comes from the first reading. 3872 `ordersSpent` is utxo_info again.
3. 3880-3885: `since = returnable(s, (await this.listing(network, keyHash)).rows).filter(...)` feeds only `outcomeOf` and `fillsOf`.
4. 3904 `await go(() => this.bringBack(network, s.index, rows));` leads to bringBack (4324-4334), then buildBack(held=rows) (4502). Nothing there reads the account, and neither do lovejoin.chain (lovejoin.ts:3642-3763) or fanOut (`utxos: rows`, 3830).

**The second return:**
- act 3816 `if (kinds.has("deposit") || kinds.has("mix")) return go(() => this.bringBack(network, s.index, rows));`
- chainSoFar (1303-1311): `finished`, so `started` is false.
- buildBack 4622-4625 finds no collateralFits row (1052-1054). collateralWanted (4918-4930) returns true (`pays && !short`), so 4639 sets `skipped = NO_COLLATERAL()` (781).
- intoPool (4565-4573) needs `rows.some(collateralFits)`, so there is no tail.
- sendBack (5076-5079) writes `s.lovejoinSkipped`.

**Exploratory run** (same set-up as the test, with logging), request order of run 1: credential_utxos, utxo_info (the late leg lands), utxo_info, credential_utxos (the `since` reading, which holds bb…#0), epoch_params, …, submittx ×4.
- The chain was deposit, mix, mix, mix, deposit, mix, back.
- The deposit spent SWAP_TX#1 and aaaa…#0; the tail deposit spent 0101…#1, the 5 ₳. No transaction spent bb…#0.
- Run 3 sent a second back spending bb…#0, with skipped "its 5 ₳ collateral isn't at its account anymore, and the mixes need it". Run 4 closed the session.

**Final test on TREE** (command: `timeout 10m npx vitest run tests/r51-gap-g4-1.test.ts`):
```
× comes back in the session's first return, through Lovejoin as approved, never alone after it
- Expected
+ Received
    "closed": true,
-   "firstTakesLate": true,
-   "lovejoinSkipped": undefined,
-   "returns": 1,
+   "firstTakesLate": false,
+   "lovejoinSkipped": "its 5 ₳ collateral isn't at its account anymore, and the mixes need it",
+   "returns": 2,
```

**Fixed in a copy** (outside TREE: rsync to ~/.cache/seedelf-review-51/verify-gap-g4_1-trace, node_modules symlinked; removed after; TREE's tracked files untouched):
- Fix A (hoist `since`, then `bringBack(network, s.index, [...rows, ...since])`): 1 passed.
- Fix B (`if (since.length) return;` after the outcome's update): 1 passed.

**Other facts checked:**
- Split routes are allowed: minswap.ts:291-296 outOfPlace refuses only a path with more than one leg, or Danogo beside another DEX.
- The approval's wording is en.json:2346.
- swap-runner.test.ts:925-933 already drives this path (its `late`) and asserts only `filled`.
- Blame: 3770 c138b3b0 and 3904 d74677a9 (both 2026-09-27, before 19b1a7ed).

**Known:** None: it isn't settled or known.

**docs/backlog.md** (every Declined, ❓ and ⬜ line), searched for 'split', 'leg', 'second/later/another return', 'come back later', 'partial fill' and 'behind the chain'. Nothing matches:
- Line 71 is four-wide mixes and a later token.
- Line 110 is multi-hop routes, a different shape from parallel single-leg paths.
- Line 115 is Splash's remnant.

**docs/archive/plans/*.md**, searched for 'M18', 'split route', 'paid in different blocks', 'second return', 'later return' and 'later without it':
- Independent review M18 (row 137) is the outcome label only, fixed by 7b61c28 and 19b1a7e.
- Its M9 is a site session's first return spending the collateral, fixed with a top-up. A swap session gets no top-up.
- L17 and chunk-16 line 474 are about earlier chains holding returns back.
- No review's Not fixed or Left open list names this.

**Current docs:**
- architecture.md:647 says the outcome is decided from both readings, and is silent on the return.
- privacy.md's list (line ~458) admits that a session whose collateral 'an earlier return' took comes back directly. That covers money paid after a return. It doesn't cover the runner leaving out a leg it had already read, against the approval's 'mixed'.

**Chunk 51:** INDEX e2b#2 (confirmed low) is only the display side of a second return.

**SECURITY.md out of scope:** no data source has to lie; honest backends a block apart are enough. No owner rule applies: the fix adds no refusal and changes no default.

**Fix notes:**

**The fix** (needs no owner call): build the return from what the runner has read.
- Either hoist `since` out of the `if (!auto.filled && !auto.refunded)` block and call `bringBack(network, s.index, [...rows, ...since])` at sessions.ts:3904. `since` already leaves out own rows and those `arrived` holds, so nothing is doubled.
- Or `return` right after recording the outcome when `since.length > 0`, so the next run's listing holds every leg.
- Both make the test pass (checked in a copy). The first keeps one fewer run; the second also re-reads the collateral and pools.

**The family:** anything whose return is built from a reading taken before the step that proves the account complete.
- C12's `unlisted` (3824-3827) guards the same harm for a cancel's and a pool swap's payout.
- A Splash last fill reaches this same line, so the same change covers it.

**Tests:** swap-runner.test.ts:925-933 already lands a late leg at utxo_info and checks only `filled`. It could also assert the return's inputs hold bb…#0, with one back.

**For the owner, separate:** buildBack's `own` (4549) leaves out `auto.fills`. A swap's own fill that is ever alone at the account is a stranger's to plan_return, under the H1 rule (settled). The fix stops this race from making one alone. Counting `auto.fills` in `own` would end the rest, and that is the owner's call on H1.

**Not run, only traced:** the token-leg (noBox), Splash and lone long-named-token sub-cases.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/extension/tests/r51-gap-g4-1.test.ts`

Result: **On TREE: fails** (`timeout 10m npx vitest run tests/r51-gap-g4-1.test.ts`, run from extension/, 18.7 s):
```
❯ tests/r51-gap-g4-1.test.ts (1 test | 1 failed) 9416ms
  × comes back in the session's first return, through Lovejoin as approved, never alone after it 9399ms
AssertionError: expected { closed: true, …(3) } to deeply equal { closed: true, …(3) }
- Expected
+ Received
  {
    "closed": true,
-   "firstTakesLate": true,
-   "lovejoinSkipped": undefined,
-   "returns": 1,
+   "firstTakesLate": false,
+   "lovejoinSkipped": "its 5 ₳ collateral isn't at its account anymore, and the mixes need it",
+   "returns": 2,
  }
❯ tests/r51-gap-g4-1.test.ts:156:8
Test Files  1 failed (1)
     Tests  1 failed (1)
```

**In a patched copy outside TREE: passes** with either of the finder's fixes (copy removed after):
- `[...rows, ...since]` at 3904: Test Files 1 passed, Tests 1 passed.
- `if (since.length) return;` after the outcome's update: Test Files 1 passed, Tests 1 passed.

```
// Chunk 51, finding gap-g4#1: a split route's second leg, paid in a block that lands between the runner's listing of
// the account (sessions.ts act, `rows`) and its lookup of the orders (liveOrders, utxo_info). Every order then reads
// spent, and the runner reads the account again for the outcome (`since`, independent review M18), a reading that
// holds the leg. The return is built from the first reading all the same (`bringBack(..., rows)`), so the leg is left
// out of it. Through Lovejoin, that chain puts the session's 5 ₳ collateral into the 5 ₳ pool, and the leg then comes
// back alone in a second return, directly: "its 5 ₳ collateral isn't at its account anymore, and the mixes need it".
// Right: the session's first return takes every leg the runner found, and nothing comes back after it without Lovejoin.
// Real WebAssembly and Lovejoin v2's 5 ₳ pool, as tests/lovejoin-planner.test.ts sets them up.
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
type Step = { kind: string; txCbor: string; txHash: string };
type Sealed = { closedAt?: number; lovejoinSkipped?: string; txs: Array<{ kind: string; txHash: string; replaced?: boolean }> };

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

describe("a split route's leg paid between the runner's two readings of the account (chunk 51, gap-g4#1)", { timeout: 600_000 }, () => {
  it("comes back in the session's first return, through Lovejoin as approved, never alone after it", async () => {
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
    // contract; the 5 ₳ pool's 20 boxes of other people's.
    t.koios.addedToAccounts.push(
      atSession(SWAP_TX, 1, "2000000"),
      atSession(FUND, 1, "5000000"),
      ...orders.map((o) => orderRow(SWAP_TX, Number(o.split("#")[1]))),
      atSession("aa".repeat(32), 0, "20000000"),
      ...ADA_ROWS,
    );
    for (const o of orders) t.koios.spent.add(o);
    // Leg 2's fill (20 ₳) lands in the block between the runner's listing and its lookup of the orders.
    const LATE = `${"bb".repeat(32)}#0`;
    const late = [atSession("bb".repeat(32), 0, "20000000")];
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => {
      const path = new URL(url).pathname.split("/").pop();
      const refs = typeof init?.body === "string" ? (JSON.parse(init.body) as { _utxo_refs?: string[] })._utxo_refs : undefined;
      if (path === "utxo_info" && refs?.includes(orders[0]!)) t.koios.addedToAccounts.push(...late.splice(0));
      return real(url, init);
    };
    const book = async () => (await t.store.get<{ sessions: Sealed[] }>("sessions.preprod"))!.sessions[0]!;
    const before = t.koios.submitted.length;

    // The runner's runs until it sends the session's first return: a chain through Lovejoin, kept as it's sent, or one
    // that comes back directly. A fix may wait a run for the leg to be listed, so up to three.
    let first: Uint8Array[] = [];
    for (let run = 0; run < 3 && !first.length; run++) {
      await sessions.advance("preprod", 0, true);
      const chain = await t.wallet.withKeys(() => t.session.get<{ txs: Step[] }>(`${SESSION_CHAIN_PREFIX}preprod.0`));
      if (chain) first = chain.txs.map((x) => Uint8Array.from(Buffer.from(x.txCbor, "hex")));
      else if ((await book()).txs.some((x) => x.kind === "back")) first = t.koios.submitted.slice(before);
    }
    expect(first.length).toBeGreaterThan(0);

    // It lands, and the runner runs on until the session closes: whatever is left at the account comes back.
    t.koios.confirmations = 1;
    for (let run = 0; run < 10 && !(await book()).closedAt; run++) {
      for (const tx of t.koios.submitted) for (const o of txInputs(tx)) t.koios.spent.add(o);
      await sessions.advance("preprod", 0, true);
    }
    const s = await book();
    expect({
      closed: s.closedAt !== undefined,
      // The first return takes leg 2's fill.
      firstTakesLate: first.some((tx) => txInputs(tx).includes(LATE)),
      // One return: the chain's, nothing after it.
      returns: s.txs.filter((x) => x.kind === "back" && !x.replaced).length,
      // Nothing came back saying Lovejoin was left out.
      lovejoinSkipped: s.lovejoinSkipped,
    }).toEqual({ closed: true, firstTakesLate: true, returns: 1, lovejoinSkipped: undefined });
  });
});
```

## Impact: partly, low

The trace holds. act builds the first return from the first listing (sessions.ts:3770, :3904), and the second reading (:3880) feeds only the label and the fills. So a leg whose order reads spent in the same run, but whose fill that listing missed, stays at the account. Once the chain lands, its 5 ₳ is gone. The next run's return skips Lovejoin with NO_COLLATERAL and is sent without a pause: the 5 ₳ offer is for sessions brought back by hand only.

The impact is much narrower than claimed:

1. **The finder's headline case loses no mixing at the default settings.**
   - A return's chain takes at most 32 boxes at depth 2: MAX_CHAIN_MIXES is 130 and a box takes 4 mixes. The pool also limits it to floor(free/8) boxes.
   - At about 9.1 ₳ a box, leg 1's 300 ₳ already pays for the cap. So without the race, 32 boxes go in and about 340 ₳ comes back at once, tied to the session, which privacy.md:412 admits. With the race it's still 32 boxes; the only change is that 200 ₳ of that direct rest comes back in a second sweep.
   - What that costs: one extra return fee (about 0.2 ₳), one more private UTxO under the same session's history, and e2b#2's page text. No two histories are newly tied.
   - Neither "about 49 boxes" nor "about 29 boxes" can occur at depth 2.
2. **More ADA goes unmixed only in a narrow band.** That's where the first return's spare pays for fewer boxes than the cap or the pool's room allow: under about 290 ₳ of spare with a pool of at least 258 free boxes, and less with a smaller pool. Minswap seldom splits swaps that small, since each extra order costs a batcher fee and a deposit.
3. **On mainnet today it's likely unreachable.** The v2 5 ₳ pool (fcb3f5ec…) is new. Under its 30-box floor every mainnet return comes back directly, race or not. Just past the floor its room is 3 to 7 boxes, which any first return fills. Mainnet bundles no v2 token pool, so the token variant needs one launched since.
4. **The window is narrow.** It's about one request's round trip to the same server, on a 15 s cycle: a few percent of split routes at most.
5. **No money is lost.** Fewer mixing fees are paid; one return fee is added.

The one heavier outcome is the stranded token fill. A lone late fill is a stranger's to plan_return, and one left behind for cost lets the session close Done, after which nothing in this browser brings it back. It needs a token name of about 30 bytes or more. COPI (30 bytes) is on the wallet's own list, but whether its 2 ₳ fill falls short is the finder's hand model, not a run. It sits on the settled H1/H2 rule's edge and multiplies the race's few percent by rare factors, so it doesn't lift the grade.

This is a small cost in an edge case: low. Medium's "privacy link made by default" doesn't hold: the link is made only in a race, and often adds nothing.

**Evidence:**

TREE = cd764fba. The code under review matches web-wallet/1.9.1 apart from manifest.ts.

**The trace holds**
- sessions.ts:3770 `const { listed, rows } = await this.listing(...)` is never reassigned. :3841 liveOrders and :3872 ordersSpent are utxo_info reads (:3981, :4051).
- :3880-3891: the second listing goes only to outcomeOf and fillsOf. :3904 `bringBack(network, s.index, rows)`. buildBack (:4502-4821) reads no account. Its `merge` is the private funding change (fundingChange).
- After the chain:
  - :3759 waits while any chain transaction is unconfirmed. Then :3816 (kinds has deposit or mix) calls bringBack(rows = [the late leg]).
  - chainSoFar (:1303-1311): a confirmed back finishes a non-mix chain, so started = false.
  - :4616-4640: no row passes collateralFits (:1052, exactly 5 ₳). collateralWanted (:4918-4930) returns true where the spare pays for a box and the pool is past its floor, so skipped = NO_COLLATERAL. intoPool (:4565-4568) also needs collateralFits, so there's no collateral tail.
- No pause: backCollateralBuild (:2476) and backWantsCollateral (:5772) are byHand only (:1252, `!s.auto && !s.site && !s.mix`).
- The test lands the leg exactly so: swap-runner.test.ts:886-891 adds `late` on the utxo_info fetch, and :925-933 assert only `filled`.

**Narrowing 1: the cap and the room**
- lovejoin.ts:1783 `mixesPerBox = (w**d-1)/(w-1)`, so 4 mixes at depth 2, width 3. :1811 MAX_CHAIN_MIXES = 10 × 13 = 130. :1826 chainBoxes(2) = min(96, 32) = 32.
- fanOut's fit: count = min(pays, room, most), and 'what's left comes back with the return'.
- roomIn and roomLeavingTail (:870-885) give floor((free − 2)/8) at depth 2, so 32 boxes need 258 free boxes.
- privacy.md:412 prices a 5 ₳ box at about 4.1 ₳ of fees, about 9.1 ₳ of spare in all. 300 ₳ / 9.1 ≈ 33, which is at or over the cap, so the race changes no box count in the finder's example.
- At depth 1 the cap is 64 and the room floor(free/2). There 49 boxes means a room of 49, which 300 ₳ (≈ 47 boxes at ~6.3 ₳ each) nearly fills, so the race shifts at most two or three boxes to the direct rest.
- Whatever exceeds the cap comes back directly in the no-race case too. After the collateral's mix that's a sweep into new registers (privacy.md:433), so the race adds one more sweep, of the same history.

**Narrowing 2: mainnet's pool**
- src/lovejoin-pools.json mainnet lists only dc6abe3b… (v1, retired) and fcb3f5ec… (v2 5 ₳). review-1.8.1.md:110 says it was launched at block 14,167,059, and review-1.8.0.md:127 says that until it holds 30 other boxes every mainnet return comes back directly.
- Room at 30, 60 and 100 free boxes is 3, 7 and 12 boxes.
- To look up: fcb3f5ec…'s free box count today.

**Narrowing 3: the window**
- Between :3770 and :3841 there is only local work. Both reads go to one server (data-layer.ts:232-253, DataLayerKoios.read), and the cadence is READ_EVERY_MS = 15_000 (:246).
- Which data-layer source answers each read is in seedelf-data/, which I didn't read.

**The class is documented**
- privacy.md:458: 'A session whose collateral was spent (… an earlier return, which takes it too …) comes back directly, and says Lovejoin was left out and why.'

**The stranded fill**
- lib.rs:1202-1283: a token row whose hash isn't in `own` is a stranger. With nothing taken, Draft::needs is 0 (:1138), so it must pay a whole return + STRANGER_MARGIN (50_000, :1068), with SWEEP_OVERHEAD_BYTES = 500 (:1055).
- buildBack's own (:4549) excludes auto.fills.
- A closed session refuses every action: live() at :5924 throws sess.sessionOver.
- The scan adds only indexes the book doesn't know (:2803-2804, `lost = used.filter(i => !known.has(i))`).
- Measured from the token list (python3 -I): src/tokens/list.json has 32 mainnet tokens, and one has a name of 30 bytes or more: COPI, 30 bytes (b6a7467e…).
- The 2 ₳ threshold at 30 bytes is the finder's hand model. Nothing was run here.

**Known:** Not known as such. The class is admitted in privacy.md:458 (a later return, after an earlier return took the 5 ₳, comes back directly and says why). privacy.md:412 admits the direct rest past a chain's cap. No record names this cause, the runner's own two readings: independent-review.md M18 (19b1a7ed) fixed the label only, and architecture.md:647 describes only the label's two readings. Chunk 51's e2b#2 (INDEX, confirmed low) is its display side. I searched backlog.md and docs/archive/plans/*.md for split route, second leg, later return, comes back later, paid after, read again, NO_COLLATERAL and noCollateral, plus the other chunk-51 lanes and data/*.json for 3904 and split route; there's no duplicate.

**Fix notes:**

The finder's fix is right in kind: build the first return from both readings, `bringBack(network, s.index, [...rows, ...since])`, or skip the return in a run where `since` is non-empty. needs_owner: no.

1. **Cover the class, not just `since`.** If the second listing also misses the leg (its source behind utxo_info's, for example two Koios backends), `since` is empty and the return still goes without it. Sturdier: return only from a run whose listing was taken after every order was already known spent. Record when ordersSpent first held (as auto.filled does), and build from the next run's listing. That costs one 15 s cycle.
2. **The lone-fill sub-case is separate.** Counting auto.fills in buildBack's `own` (:4549) makes a fill pay only its own sweep, but that changes the H1/H2 stranger rule's inputs, so it's the owner's call. Before deciding, have the trace verifier run plan_return on a lone 2 ₳ fill with a 30-byte name (COPI) to see whether it's really left behind.
3. **Test.** Extend swap-runner.test.ts:925's first case: the back's inputs include bb…#0, and no second back follows.
