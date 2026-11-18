# Lane T1g

Returned by the workflow's agent `a99505c58a540565d`, written here by the lead from its structured answer.

## Findings (14)

### t1g#1 · low · A due box that a reviewed or sending chain has reserved, withdrawn by the due run: no test fails without it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:6876`
- **Who:** user · **Since:** b2e589b6 (2026-10-17), in web-wallet/1.6.0 and later · **Confidence:** confirmed-by-run

**Scenario:**

I dropped withdrawDueNow's reserved filter and every test still passed. No test lets a box come due while a chain reserves it: neither a chain kept for Send (a public Mix my boxes again review, held up to BUILT_TTL_MS = 10 min) nor one being sent. A regression that withdraws such a box would ship green. The review's Send would then be refused for a spent input, or a withdraw would race the chain for one box.

**Evidence:**

Change in the copy: lovejoin.ts:6876 `const candidates = free(inPool(back, pool), reserved);` became `const candidates = inPool(back, pool);`. The lane's guess (b18), tests/lovejoin-bring-review-fixes.test.ts: 21 passed. Then I ran the 41 tests in 8 files that execute this line (lovejoin.test.ts, lovejoin-pools, lovejoin-restore, lovejoin-reward-balance, lovejoin-flows, lovejoin-merged-review, lovejoin-retire-review-fixes, lovejoin-crediting-review-fixes), filtered with -t: all passed. I also placed a marker that logs whenever `free(...)` drops a candidate and has no other effect. It never fired across the full fire-marker run, so no test ever has a reserved box among the due ones. The sibling checks are pinned: Bring one back's (7034) by lovejoin-bring-review-fixes.test.ts:524, and Bring every box back's (7277) by lovejoin-bring-all-back.test.ts:371.

**Fix:**

Add a test in lovejoin.test.ts 'the boxes' withdraws'. Give the wallet one box that is due, and let publicAgainBuild keep a Mix again for Send that spends it. withdrawDue('preprod', false, now) should return [], with t.koios.submitted unchanged and the box's due time kept. publicSubmit should then succeed.

**Known check:**

Searched docs/backlog.md and docs/archive/plans/ for reservedBoxes, boxReserved, 'reserved' near withdrawDue, and 'mutant'. Nothing records this. Backlog's 'Untested in 1.8.0' line is about withdrawDueNow's re-arm, which is a different line.

### t1g#2 · low · A withdraw whose signed hash differs from the reviewed build, sent anyway: no test fails without the hash check

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:7643`
- **Who:** nobody · **Since:** e90efff5 (2026-10-02), in web-wallet/1.6.0 and later · **Confidence:** confirmed-by-run

**Scenario:**

I deleted the check and every test still passed. Every test's finishLovejoinWithdraw or signScriptSpend fake returns the transaction's own hash, so the check never fires. A regression that drops it would ship green, and so would a later finishing step that alters the body. Today finish_withdraw only adds giveme.my's witness over the unchanged body, so nothing makes the two hashes differ.

**Evidence:**

Change in the copy: deleted lovejoin.ts:7643 `if (finished.txHash !== built.txHash) throw new Error(t("lj.signingChanged"));`. tests/lovejoin-withdraw-submit.test.ts: 12 passed. The 102 tests in 12 files that reach this line: all passed. A marker that logs when `finished.txHash !== built.txHash` never fired in any test. No test names lj.signingChanged.

**Fix:**

In lovejoin-withdraw-submit.test.ts's due(), add a variant whose finishLovejoinWithdraw returns txHash '00'.repeat(32). withdrawDue should return [] with nothing submitted, kept(t).withdrawing undefined and the due time kept. The same class exists, not mutated here: sessions.ts:4477 and script-spend.ts:429 throw worker.spend.signingChanged, and no test names that key either.

**Known check:**

Searched backlog.md, docs/archive/plans/ and docs/plans/ for signingChanged, 'hash changed' and 'txHash !== built'. Nothing.

### t1g#3 · low · A copy of the 5 ₳ pool taken as a return's ADA and collateral pool: no test fails without adaPoolOf's copy check

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:702`
- **Who:** pool-launcher · **Since:** 50cd76b4 (2026-11-05), in web-wallet/1.8.0 and later · **Confidence:** confirmed-by-run

**Scenario:**

I dropped `!p.copy` from adaPoolOf and every test still passed. In no call anywhere in the suite does the copy check change the pick. No test gives discovery a copy of the 5 ₳ values that would be found before the shown pool, or in its place. A regression would therefore ship green and send a return's spare ADA and its session's collateral into a copy that no wallet shows.

**Evidence:**

Change in the copy: lovejoin.ts:701-702 `pools.find((p) => !p.token && p.ref && !p.copy && !isRetired(p) && p.lovelace === COLLATERAL_LOVELACE)` with `!p.copy` removed. The lane named no test. I ran the 73 tests in 6 files that call adaPoolOf and deal with copies or the 5 ₳ pool (lovejoin-merged-review, lovejoin-share-review-fixes, lovejoin-round2-retire, lovejoin-found-later, lovejoin-retired, lovejoin-round2-sessions): all passed. A marker comparing the original pick with the mutant's never saw them differ, across the 342 tests in 41 files that call adaPoolOf. The other three conjuncts are pinned (see checked_ok).

**Fix:**

In lovejoin-share-review-fixes.test.ts's 'the 5 ₳ pool a return and its collateral go into' block, add two cases. If discovery hands over only a copy of the 5 ₳ values ({ copy: ref }), adaPool() is undefined and the return's collateral comes back directly. If the copy is listed before the shown pool, the shown pool is the one picked.

**Known check:**

Searched backlog.md and docs/archive/plans/ for adaPoolOf, 'copy' near the 5 ₳ pool, and MERGED-1's leftovers. Nothing about a test for this conjunct.

### t1g#4 · low · A token pool named on the review taken even though it can't take a box now: no test fails without acrossOf's 'works' check

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:3974`
- **Who:** user · **Since:** b9c35f06 (2026-10-18), in web-wallet/1.6.0 and later · **Confidence:** confirmed-by-run

**Scenario:**

I swapped `works.find(...)` for `pools.find(...)` and every test still passed. No test names a pool on the review that, when the return is built, is under its floor, short of free boxes or unusable. So the 'the pool chosen for it can't take a box now' path (lj.tokens.skip.warn.poolCant) never runs. Without the check, the chain is built into that pool, and the refusal comes later and in other words: from WebAssembly or from the network's check.

**Evidence:**

Change in the copy: lovejoin.ts:3974 `... : works.find((p) => p.id === named)` became `pools.find((p) => p.id === named)`. I ran the 17 tests that execute this line (lovejoin-planner, lovejoin-chain-review-fixes, lovejoin-merged-review, lovejoin-reward-balance, lovejoin-share-review-fixes): all passed. A marker for 'works and pools pick differently' never fired. No test mentions lj.tokens.skip.warn.poolCant.

**Fix:**

Add a planner test: a return holds LJTEST and its review named the LJTEST pool. Before backBuild, another chain reserves that pool's free boxes (or the floor is raised). The token's way should be { boxes: 0, skipped: tr('lj.tokens.skip.warn.poolCant') }, with no deposit into that pool.

**Known check:**

Searched backlog.md and docs/archive/plans/ for poolCant, 'named pool' and 'pool chosen'. Nothing.

### t1g#5 · low · A data-layer pool of an unlisted token (or a 10 ₳ ADA pool) kept: no test fails without verified()'s listedValue check

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:530`
- **Who:** pool-launcher · **Since:** 1772c96f (2026-10-17), in web-wallet/1.6.0 and later · **Confidence:** confirmed-by-run

**Scenario:**

I dropped `|| !this.listedValue(network, view)` from verified() and every test still passed. Koios's holder path runs listedValue on its own (lovejoin-pools.ts:584), and lovejoin-discovery.test.ts:183 pins that. The data layer's list path has only verified(), and no test lists such a pool there. A regression would keep and read a pool of an unlisted token whenever the data layer lists one.

**Evidence:**

Change in the copy: lovejoin-pools.ts:530 `if (!view || view.scriptsInline !== 0 || !this.listedValue(network, view)) return undefined;` with the listedValue clause removed. tests/lovejoin-discovery.test.ts and tests/lovejoin-pools.test.ts: 51 passed. The 43 other tests that call verified(), in 4 files: all passed. A marker for 'verified, no inline scripts, not listed' never fired. The neighbouring inline-scripts clause is pinned (lovejoin-discovery-review-fixes.test.ts:116).

**Fix:**

In lovejoin-discovery.test.ts 'the data layer's list', set on.index.poolList = listed() with discovery(..., { listed: new Set() }); known() should be []. Add the same for a v2 ADA pool listed at 10 ₳.

**Known check:**

Searched backlog.md and docs/archive/plans/ for listedValue, unlisted and 317-wallet. Chunk 34's plan says 'the wallet re-verifies every pool' and records no test gap.

### t1g#6 · low · A pool's bare private start spending UTxOs its review never showed: no test fails without the 'only' filter

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:337`
- **Who:** user · **Since:** 52ba024c (2026-10-17), in web-wallet/1.6.0 and later · **Confidence:** confirmed-by-run

**Scenario:**

I dropped the filter, so the bare build gets every private UTxO, and all 33 lovejoin-flows tests still passed. The filter does drop UTxOs in two of them ('starts a pool from the private balance…' and 'reads the parameters once in its review…'), but there the bare build's own coin selection happens to stay inside the reviewed set. A regression could have Send spend, and tie together, UTxOs and histories that the review never showed.

**Evidence:**

Change in the copy: lovejoin-launch.ts:337 `utxos: only ? utxos.filter(among(only)) : utxos` became `utxos`. tests/lovejoin-flows.test.ts: 33 passed. A marker for `only && utxos.filter(among(only)).length !== utxos.length` fired in those two flows tests only, and both pass under the mutant.

**Fix:**

Make lovejoin-flows' launching() helper record each buildLovejoinLaunch request. In 'starts a pool from the private balance…', expect the register:false request's utxos to equal the register:true build's inputs. Alternatively, give the private balance UTxOs for which the build that is 2 ₳ cheaper would pick a different one, and expect bare.inputs to be a subset of built.inputs.

**Known check:**

Searched backlog.md and docs/archive/plans/ for launch_apart and for 'bare' and 'only' near the launch. Chunk 34's plan describes launch_apart. Nothing about this filter's test.

### t1g#7 · low · withdrawDueNow's early return while a chain is mixing: no test fails without it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:6796`
- **Who:** user · **Since:** fc8561c7 (2026-10-25), in web-wallet/1.6.0 and later · **Confidence:** confirmed-by-run

**Scenario:**

I deleted it and every test still passed. It acts in one test only, lovejoin.test.ts:1457 'withdraws nothing while a chain is being sent…'. That test calls withdrawDue with unlock = true, and later in the same run `sending` (mixing(c)) returns [] as well, so the withdraw stays blocked either way. What no test pins is the early return itself: without it, a run reads the pools and redraws due times while a chain is mixing.

**Evidence:**

Change in the copy: deleted lovejoin.ts:6796 `if (await this.chainsMixing(network)) return [];`. tests/lovejoin-withdraw-submit.test.ts: 12 passed. The only test where the condition is ever true (lovejoin.test.ts:1457): passed.

**Fix:**

In lovejoin.test.ts:1457, call withdrawDue('preprod', false) while the chain is being sent, and expect t.koios.calls to be unchanged. The Mix-again test (lovejoin.test.ts:2091) does this for line 6793.

**Known check:**

Searched backlog.md and docs/archive/plans/ for chainsMixing and 'while a chain is being sent'. Nothing about this test.

### t1g#8 · low · giveme.my's coin put up for a collateral mix the network measures higher: no test fails without tailWitness's budget check

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4546`
- **Who:** nobody · **Since:** 24c5c62a (2026-10-23), in web-wallet/1.6.0 and later · **Confidence:** confirmed-by-run

**Scenario:**

I deleted the throw and every test still passed. No test answers the collateral mix's evaluation with a budget above what it declares; only lovejoin.test.ts:649 does that, for a chain's first mix at review. Without the check, giveme.my would be asked to back a mix the network measures higher, which is what a hard fork that moves the evaluator would cause.

**Evidence:**

Change in the copy: deleted lovejoin.ts:4546 `if (!checked.covers) throw new LovejoinSkipped(...)` in tailWitness. tests/lovejoin-chain-review-fixes.test.ts: 12 passed. A marker for `!checked.covers` in tailWitness never fired in any test. I started a run of the 65 tests that reach tailWitness and stopped it after 15 minutes under load. No failure was reported, and none could be, since no test makes the check act.

**Fix:**

In lovejoin-planner.test.ts's 'a return's 5 ₳ collateral mixed once' block (the setUp used at 1547 and 1575), answer the tail mix's evaluate with the over-budget result from lovejoin.test.ts:649. After runAll, t.collateral.asked should be [] and the chain stopped with 'measures its scripts above'.

**Known check:**

Searched backlog.md and docs/archive/plans/ for tailWitness, 'measures it higher' and measuredDifferently. Backlog line 61 is about tailWitness's 'Koios behind' naming rule, which is a different check.

### t1g#9 · low · A session chain keeps its reservation after the network's check refused it: no test fails without the unreserve (both copies)

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:3865`
- **Who:** user · **Since:** b9c35f06 (2026-10-18), in web-wallet/1.6.0 and later · **Confidence:** confirmed-by-run

**Scenario:**

I deleted the unreserve in attempt()'s catch (3865), and separately the one in acrossOf's (4100). Every test still passed both times, although the refusal path runs in 7 tests for 3865 (lovejoin.test.ts 'the network's check' and others) and in 1 for 4100 (the planner's token-pool refusal). A refused review then keeps its pool boxes reserved for BUILT_TTL_MS (10 minutes). The next review, or another chain, finds them taken and builds fewer boxes or leaves Lovejoin out.

**Evidence:**

Change in the copy, one copy at a time: deleted `await this.unreserve(network, owner, mine).catch(() => undefined);` at lovejoin.ts:3865 and at :4100. For each, tests/chain-reservations.test.ts: 3 passed. 3865 acts in 7 tests where crossCheck refused (lovejoin.test.ts 'leaves Lovejoin out… measures the first mix above', 'leaves it out too when the network refuses a script', 'builds the chain again from a fresh read…', 'says to try again later…', 'says on the session when its return, sent, left Lovejoin out', 'brings a mix back directly when it's stopped…', and lovejoin-refusals 'from the private balance, is tried again later…'): all passed. 4100 acts in one (lovejoin-planner 'mixes a return's ADA through the 5 ₳ pool when its token's pool refuses the mix'): passed. The public mix's own copy (checked(), lovejoin.ts:4976-4985) is pinned by chain-reservations.test.ts:111.

**Fix:**

After lovejoin.test.ts:645's refused review, expect t.lovejoin.room('preprod', ADA) to be { others: 20, free: 20 }, as chain-reservations.test.ts:111 does for the public mix. Do the same after the planner's token-pool refusal, for acrossOf.

**Known check:**

Searched backlog.md and docs/archive/plans/ for unreserve, 'reservation go' and L27. Nothing about these two copies.

### t1g#10 · low · A return across pools reserving its boxes only after the network's check: no test fails

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4098`
- **Who:** user · **Since:** b9c35f06 (2026-10-18), in web-wallet/1.6.0 and later · **Confidence:** confirmed-by-run

**Scenario:**

I moved acrossOf's reserve to after crossCheck and every test still passed, though the line runs in 14 tests. While the check runs, another chain of the wallet's could draw the same boxes. reserve()'s StalePool still refuses the second reserver, so the cost is a rebuild, not a double spend. The single-pool chain's copy (3863) is pinned by chain-reservations.test.ts:99.

**Evidence:**

Change in the copy: lovejoin.ts:4098-4102 used to reserve and then run crossCheck with an unreserve on refusal. It became `await this.crossCheck(network, chain, firsts); await this.reserve(network, owner, chain.txs, this.deps.now() + BUILT_TTL_MS);`. tests/chain-reservations.test.ts (3) and the 14 tests that run the line (lovejoin-planner, lovejoin-chain-review-fixes, lovejoin-reward-balance 'across pools…', lovejoin-share-review-fixes): all passed.

**Fix:**

Add a chain-reservations case like :99 for a return holding LJTEST, so that it goes through acrossOf. Hold Ogmios, and while it checks, expect room() for both pools to show the return's draws reserved.

**Known check:**

Searched backlog.md and docs/archive/plans/ for L27, unreserve and 'across pools' near reservations. Nothing.

### t1g#11 · low · Only the first leg's first mix measured in a return across pools: no test fails without crossCheck's per-leg indexes

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4808`
- **Who:** nobody · **Since:** f16bdbca (2026-10-23), in web-wallet/1.6.0 and later · **Confidence:** confirmed-by-run

**Scenario:**

I replaced `at ?? [...]` with the default index and every test still passed: 89 planner tests, and 3 more where `at` differs from the default. In the planner's token-pool refusal test, the refused leg is the first one, which the default index checks anyway. No test has the network refuse or over-measure a later leg's first mix (the 5 ₳ pool's). A regression that checks only the first leg would send chains whose later scripts the network measures higher, putting the collateral at risk.

**Evidence:**

Change in the copy: lovejoin.ts:4808 `const firsts = at ?? [chain.txs.findIndex((t) => t.kind === "mix" && !t.tail)];` became `[chain.txs.findIndex(...)]`. tests/lovejoin-planner.test.ts (the lane's): 89 passed. The other tests where `at` differs from the default (lovejoin-reward-balance 'across pools, takes each pool's balance…' and lovejoin-share-review-fixes ×2): passed.

**Fix:**

Add a planner test: a return across pools whose evaluate answer refuses only the cbor of the ADA leg's first mix. The ADA leg (or Lovejoin) should be left out, and the number of Ogmios calls should equal the number of legs.

**Known check:**

Searched backlog.md and docs/archive/plans/ for 'each pool's first', firsts and chunk 34 §8. The plan describes the per-leg check. No test gap is recorded.

### t1g#12 · low · An ADA pool start at the classic pool's 10 ₳: no test fails without the worker's own refusal

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:237`
- **Who:** user · **Since:** 84c2775f (2026-10-17), in web-wallet/1.6.0 and later · **Confidence:** confirmed-by-run

**Scenario:**

I deleted the check, and lovejoin-flows' 'refuses what isn't a pool to start' still passed. Core's launch builder refuses the same terms (seedelf-core/src/lovejoin/launch.rs:169: 'An ADA pool of 10 ₳ a box would be a copy of the classic pool's value, which no wallet shows'), and toThrow("classic pool's value") matches either message. Only the Koios reads made before the build (epoch parameters, the account) differ, so dropping the check costs requests, not money.

**Evidence:**

Change in the copy: removed lovejoin-launch.ts:237-239 `} else if (box === CLASSIC_LOVELACE) { throw new Error(t("lj.launch.classicCopy")); }`. tests/lovejoin-flows.test.ts: 33 passed. The fire marker fired in flows:823 only, and that test passes under the mutant.

**Fix:**

In flows:823, record t.koios.calls.length before build({ boxLovelace: '10000000' }) and expect it to be unchanged afterwards, as 'never pays from the public account unless asked to' (flows:855) does.

**Known check:**

Searched for classicCopy and "classic pool's value". Chunk 34's plan says a 10 ₳ ADA pool is refused before anything is built. Nothing about this test.

### t1g#13 · low · A token start of more than one output holds (over 2^64−1 a box): no test fails without the worker's cap

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:235`
- **Who:** user · **Since:** 84c2775f (2026-10-17), in web-wallet/1.6.0 and later · **Confidence:** confirmed-by-run

**Scenario:**

I dropped `|| q > MAX_QUANTITY` and every test still passed. Only the page's field caps it: lovejoin-launch-review-fixes.test.ts:146 tests the form, not the worker. With the check gone, the worker passes a quantity beyond u64 to WebAssembly, and nothing here tests what WebAssembly then does.

**Evidence:**

Change in the copy: lovejoin-launch.ts:235 `if (q < 1n || q > MAX_QUANTITY)` became `if (q < 1n)`. tests/lovejoin-launch-review-fixes.test.ts and tests/lovejoin-flows.test.ts: 39 passed. The 18 other tests that reach the line: passed. A marker for `q > MAX_QUANTITY` never fired. The zero half of the check is pinned (flows:823).

**Fix:**

In flows:823, add build({ token: min, quantity: '18446744073709551616', boxLovelace: '4500000' }) and expect toThrow('whole number above zero').

**Known check:**

Searched for MAX_QUANTITY and 2⁶⁴. Found only the UI test's comment.

### t1g#14 · low · Mix again's boxes paid by an account switched to during its build: no test fails without the account check

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:5082`
- **Who:** user · **Since:** b9c35f06 (2026-10-18), in web-wallet/1.6.0 and later · **Confidence:** confirmed-by-run

**Scenario:**

I deleted the check and every test still passed. No test switches the active account between publicAgainBuild's pick (5021) and its build (5080); lovejoin-accounts switches only between builds. Without the check, a switch in that window would have one account pay to mix the boxes picked for another, tying the two accounts.

**Evidence:**

Change in the copy: deleted lovejoin.ts:5082 `if (keys.account !== account) throw new Error(NOT_READY());`. tests/lovejoin-accounts.test.ts and tests/lovejoin-accounts-review-fixes.test.ts: 16 passed. The 7 other tests that reach the check: passed. A marker for `keys.account !== account` never fired.

**Fix:**

In lovejoin-accounts.test.ts, switch accounts (t.accounts.use(1, ['preprod'])) from inside a Koios fetch fake while publicAgainBuild runs. It should reject with "That mix isn't ready to send. Review it again." and keep nothing for Send. E1b notes that WebAssembly's check_paths refuses another account's UTxOs in publicBuild's builder; I didn't check the again builder.

**Known check:**

Searched backlog.md and docs/archive/plans/ for keys.account, 'switch since' and 'account switch'. Nothing.

## Guards (68)

| Where | What it stops | Test |
|---|---|---|
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:2707` | evaluable: a session UTxO with a reference script counted as holding a token the deposit takes | tests/lovejoin-planner.test.ts:448 (fails at :469 'a reference script') |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:2710` | evaluable: a UTxO whose datum is nested too deep counted as the deposit's | tests/lovejoin-planner.test.ts:448 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:2791` | withinDepth's depth cap (MAX_DEPTH) | tests/lovejoin-planner.test.ts:448 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:264` | chainRetryMs: a chain's first transaction refused as spent retried though no try may have sent it | tests/lovejoin.test.ts:341 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:265` | chainRetryMs: endless retries of a later transaction refused as spent (CHAIN_SPENT_TRIES cap) | tests/lovejoin.test.ts:1111, by a hang only (27 s on pristine; never finishes without the cap) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:702` | adaPoolOf: a retired pool as the return's 5 ₳ pool | tests/lovejoin-found-later.test.ts:312 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:702` | adaPoolOf: an ADA pool whose box isn't 5 ₳ | tests/collateral-reserve-review-fixes.test.ts:345 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:702` | adaPoolOf: a token pool whose box holds 5 ₳ | tests/lovejoin-share-review-fixes.test.ts:804 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:702` | adaPoolOf: a copy of the 5 ₳ pool | none (t1g#3) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:820` | poolChoice: a malformed unit or pool id from the page kept | tests/lovejoin-planner.test.ts:355 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:3974` | acrossOf: a named pool taken though it doesn't work now | none (t1g#4) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:3823` | attempt(): a chain built short when the pool has too few free others | tests/lovejoin-planner.test.ts:992 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:3863` | a single-pool chain reserving before the network's check | tests/chain-reservations.test.ts:99 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:3865` | a single-pool chain's reservation let go when the check refuses it | none (t1g#9) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4098` | acrossOf reserving before the network's check | none (t1g#10) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4100` | acrossOf's reservation let go when the check refuses it | none (t1g#9) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4199` | usableNow/takesNewBoxes: a new box in a retired pool | tests/lovejoin-retired.test.ts:121 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4200` | usableNow/takesNewBoxes: a new box in a copy | tests/lovejoin-merged-review.test.ts:337 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4210` | usableNow: a box below the network's minimum | tests/lovejoin-merged-review.test.ts:819 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4241` | takesNewBoxes' refusal as a whole | tests/lovejoin-retired.test.ts:121 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4383` | collateralPool: the collateral mixed into a pool under its floor | tests/lovejoin-found-later.test.ts:457 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4385` | collateralPool: fewer than two other boxes free for its mix | tests/lovejoin-form-review-fixes.test.ts:545 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4544` | tailWitness: giveme.my asked for a mix whose drawn box is gone | tests/lovejoin-planner.test.ts:1575 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4546` | tailWitness: giveme.my asked for a mix the network measures higher | none (t1g#8) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4722` | reserve(): a public mix kept for Send while the last is still being sent | tests/public-mix-race.test.ts:63 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4723` | reserve(): a Send whose reservation another build replaced | tests/public-mix-race.test.ts:82 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4726` | reserve(): two of the wallet's chains spending one box (StalePool) | tests/lovejoin-share-review-fixes.test.ts:571 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4805` | crossCheck as a whole: a chain sent with no network measure | tests/lovejoin.test.ts:349 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4808` | crossCheck: each pool's first mix measured, not only the first leg's | none (t1g#11) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4824` | crossCheck: a first mix the network measures above its declared budget | tests/lovejoin-planner.test.ts:871 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:5082` | Mix again paid by an account switched to during its build | none (t1g#14) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:5184` | a public mix sent after its pool's reward balance moved | tests/lovejoin-reward-balance.test.ts:115 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:5321` | a public mix's first transaction not marked maybe-sent before its first submit | tests/chain-lock.test.ts:28 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:6793` | withdrawDueNow while a session mixes again | tests/lovejoin.test.ts:2091 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:6796` | withdrawDueNow while a chain is mixing (early return) | none (t1g#7; the later `sending` check still blocks the withdraw) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:6798` | withdrawDueNow while the last withdraw may have gone | tests/lovejoin-withdraw-submit.test.ts:106 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:6876` | withdrawDueNow withdrawing a box a chain reserved | none (t1g#1) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:6924` | a box of unknown making coming back by itself | tests/lovejoin-restore.test.ts:942 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:7047` | Bring one back taking an untold box without 'anyway' | tests/lovejoin-restore.test.ts:237 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:7052` | Bring one back taking an unmixed or chain-stopped box without 'anyway' | tests/lovejoin-restore.test.ts:136 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:7277` | Bring every box back taking a box a chain or review reserved | tests/lovejoin-bring-all-back.test.ts:371 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:7277` | Bring every box back taking a session's collateral box its mix still waits for | tests/lovejoin-bring-review-fixes.test.ts:587 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:7643` | a withdraw whose hash changed in finishing or signing sent | none (t1g#2) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:7644` | a withdraw built across a lock and an unlock sent | tests/lovejoin-withdraw-submit.test.ts:179 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:7657` | the withdraw's record kept, sealed, before the submit (M1) | tests/lovejoin-withdraw-submit.test.ts:106 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:7684` | the withdraw's box held as spent before the submit | tests/lovejoin-withdraw-submit.test.ts:133 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:7687` | a lock before the submit marked as never sent (F5) | tests/withdraw-refused-locked.test.ts:131 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:7698` | a maybe-sent submit (5xx, timeout) freed as if refused | tests/lovejoin-withdraw-submit.test.ts:106 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:7709` | a withdraw refused for a moved balance rebuilt without end | tests/lovejoin-reward-balance.test.ts:664 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:227` | a pool's start paid from the public account unasked | tests/lovejoin-flows.test.ts:855 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:235` | a token quantity of 0 | tests/lovejoin-flows.test.ts:823 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:235` | a token quantity past 2^64−1 | none (t1g#13) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:237` | an ADA pool at the classic pool's 10 ₳ | none (t1g#12; core's launch.rs:169 also refuses it) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:244` | the copy check read before discovery looks | tests/lovejoin-flows.test.ts:870 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:253` | a start copying a shown v2 pool's values | tests/lovejoin-flows.test.ts:823 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:258` | boxes too small to come back | tests/lovejoin-flows.test.ts:823 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:259` | a token box over its most | tests/lovejoin-flows.test.ts:823 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:337` | the bare private build spending UTxOs the review never showed | none (t1g#6) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:390` | Send asked again for a review whose bare build went | tests/lovejoin-flows.test.ts:1052 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:429` | the bare build sent when it makes another pool whose credential nothing registered | tests/lovejoin-flows.test.ts:985 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-rewards.ts:35` | a balance that isn't a whole number taken | tests/lovejoin-reward-balance.test.ts:71 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-rewards.ts:37` | a balance past all the ADA there is taken | tests/lovejoin-reward-balance.test.ts:71 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-rewards.ts:87` | a second take of a balance the wallet's own transaction already takes | tests/lovejoin-reward-balance.test.ts:76 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:509` | a data-layer pool whose launch or scripts aren't its reference UTxO's transaction | tests/lovejoin-discovery.test.ts:322 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:530` | verified(): a pool whose scripts aren't read by reference | tests/lovejoin-discovery-review-fixes.test.ts:116 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:530` | verified(): a pool of unlisted values (data-layer path) | none (t1g#5) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:579` | holder(): a launch younger than SETTLE_MS | tests/lovejoin-discovery.test.ts:227 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:632` | launched(): a pool whose L isn't registered by its launch or an earlier block | tests/lovejoin-discovery.test.ts:195 |

## Checked and holds

- evaluable and withinDepth (lovejoin.ts:2707, 2710, and the depth cap at 2791): each removal fails tests/lovejoin-planner.test.ts:448 'is no token of a pool's this time…', at :469 ('a reference script', 'a datum nested past what the wallet reads').
- reserve()'s StalePool (lovejoin.ts:4726): its removal fails tests/lovejoin-share-review-fixes.test.ts:571 'is built again without a box another chain reserved since its pool read' (the chain is built once instead of twice). The lane's chain-reservations.test.ts:59 passes without it.
- A single-pool chain reserving before the network's check (lovejoin.ts:3863): with the reserve moved after the check, tests/chain-reservations.test.ts:99 fails (room free 20, not 2).
- withdrawDueNow while a session mixes again (lovejoin.ts:6793): fails tests/lovejoin.test.ts:2091 (Koios calls 10, not 9). While the last withdraw may have gone (6798): fails tests/lovejoin-withdraw-submit.test.ts:106.
- The withdraw recorded before its submit (lovejoin.ts:7657-7682): with the record moved after the submit, tests/lovejoin-withdraw-submit.test.ts:106 fails (no withdrawing record after the lock). Its box held as spent first (7684): fails :133. A lock before the submit marked never sent (7687): fails tests/withdraw-refused-locked.test.ts:131.
- Refused versus maybe sent (lovejoin.ts:7698): both reading a maybe-sent 5xx as refused and reading any error as refused fail tests/lovejoin-withdraw-submit.test.ts:106.
- takesNewBoxes and usableNow (lovejoin.ts:4199-4241): the retired check fails tests/lovejoin-retired.test.ts:121. The copy check (both copies) fails tests/lovejoin-merged-review.test.ts:337. The below-minimum check fails tests/lovejoin-merged-review.test.ts:819. Dropping the whole refusal at 4241 fails lovejoin-retired.test.ts:121.
- crossCheck skipped whole (lovejoin.ts:4805): fails tests/lovejoin.test.ts:349 (no Ogmios call made). Its covers check (4824): fails tests/lovejoin-planner.test.ts:871. The lane's lovejoin-flows and lovejoin-1-5-0 pass without it.
- chainRetryMs's first-transaction rule (lovejoin.ts:264): fails tests/lovejoin.test.ts:341. Its CHAIN_SPENT_TRIES cap (265) is caught only by a hang. On pristine code, with the same ×10 timeouts, tests/lovejoin.test.ts:1111 'still stops a session's chain whose resend is refused while tx_status says it isn't on chain' passes in 27 s. Under the mutant it never finished and was stopped at 414 s. The spent-retry tests in chain-in-view, chain-resend and public-mix-reached ran 25 minutes under the mutant without finishing.
- adaPoolOf (lovejoin.ts:701-702): the retired conjunct fails tests/lovejoin-found-later.test.ts:312, the 5 ₳ conjunct fails tests/collateral-reserve-review-fixes.test.ts:345, and the ADA-only conjunct fails tests/lovejoin-share-review-fixes.test.ts:804.
- poolChoice (lovejoin.ts:820): dropping either the unit check or the pool check fails tests/lovejoin-planner.test.ts:355.
- attempt()'s too-few-others refusal (lovejoin.ts:3823): fails tests/lovejoin-planner.test.ts:992. The lane's lovejoin-not-enough.test.ts passes without it, because an earlier check refuses there.
- Discovery (lovejoin-pools.ts): the launch and script transaction checks (509) fail tests/lovejoin-discovery.test.ts:322. The inline-scripts clause in verified() (530) fails tests/lovejoin-discovery-review-fixes.test.ts:116. The settle check (579) fails tests/lovejoin-discovery.test.ts:227. The L-registered check (632) fails tests/lovejoin-discovery.test.ts:195.
- A pool's start (lovejoin-launch.ts): who pays (227) fails tests/lovejoin-flows.test.ts:855. The copy check (253), least and most (258, 259) and zero quantity (235) fail :823. Looking first (244) fails :870. Sent already (390) fails :1052. Another pool (429) fails :985.
- Reward balance: readBalance (lovejoin-rewards.ts:35 and 37) fails tests/lovejoin-reward-balance.test.ts:71. balanceAfter (87) fails :76. publicStart's moved balance (lovejoin.ts:5184) fails :115. The rebuild-once rule (lovejoin.ts:7709) fails :664.
- reserve()'s still-sending refusal (lovejoin.ts:4722) fails tests/public-mix-race.test.ts:63; the lane's public-mix-start and collateral-held pass without it. Its held refusal (4723) fails tests/public-mix-race.test.ts:82.
- tailWitness's box-gone StalePool (lovejoin.ts:4544) fails tests/lovejoin-planner.test.ts:1575. The lane's lovejoin-chain-review-fixes passes without it.
- A public mix's first send marked before it is tried (lovejoin.ts:5321) fails tests/chain-lock.test.ts:28. The lane's public-mix-unsure passes without it.
- Restores: a box of unknown making held from its run (lovejoin.ts:6924) fails tests/lovejoin-restore.test.ts:942. Bring one back's untold check (7047) fails :237, and its unmixed check (7052) fails :136.
- Bring every box back (lovejoin.ts:7277): the reserved filter fails tests/lovejoin-bring-all-back.test.ts:371, and the collateral-tail filter fails tests/lovejoin-bring-review-fixes.test.ts:587.
- A withdraw built across a lock and an unlock (lovejoin.ts:7644) fails tests/lovejoin-withdraw-submit.test.ts:179.
- collateralPool's floor (lovejoin.ts:4383) fails tests/lovejoin-found-later.test.ts:457, and its two-draws check (4385) fails tests/lovejoin-form-review-fixes.test.ts:545. So backlog line 77's 'Tests pin both copies' holds for collateralPool.

## Notes

- Method. 71 mutants over the 37 merged guards: one per check, the smallest change that removes it, each made in a copy and put back after its run. Step 1 ran each mutant against the files the lane named, whole, with --bail=1. Step 2 used a second copy with markers that change no behaviour. Each marker logged when its mutant would change what the code does: the guard's condition true, or the mutated predicate picking differently. I ran that copy over the 192 test files that import the four modules directly or through src/, minus 43 files that never call a Lovejoin flow. Each survivor was then run against exactly the tests in which its marker fired. A guard whose marker never fired cannot fail any test. M01, M02, M03, M09, M14, M62 and M68 were also run against every test that merely reaches the line, and all passed.
- Load. The machine ran at load 40 to 95 on 12 cores. Default 5 s timeouts and some describe-level 20 to 30 s timeouts failed on pristine code (sessions.test.ts, restore-scan.test.ts, lovejoin.test.ts:1111). Later runs used --testTimeout=120000, with explicit test timeouts scaled ×10 in the copies only. I checked every 'caught' result against its failure message. One false catch, M54's first run (a timeout that pristine code also hits under this load), was discarded and rerun. The final fire-run logs had no failures at all (52 + 57 files passed).
- tests/chain-reservations.test.ts:59 (L27) no longer produces the race its comment describes. Under the StalePool mutant, the return drew 10 of the 20 pool boxes and the public mix drew 8, with zero overlap, in four runs. With the pool cut to 17 boxes the draws were 8 and 8, again with no overlap. The two chains never draw from the same reservations, so the test can't fail without the check; lovejoin-share-review-fixes.test.ts:571 is what pins it.
- Several lane-named tests don't pin their guard: chain-reservations:59 (a1), lovejoin-not-enough (a13), public-mix-start (b11, b12), lovejoin-flows and lovejoin-1-5-0 (b14), chain-reservations:111 (it pins only the public mix's copy of the unreserve, checked() at 4976-4985), lovejoin-chain-review-fixes (b15), lovejoin-accounts (b16), public-mix-unsure (b17) and lovejoin-bring-review-fixes (a4/b18, which pins Bring one back's own reserved refusal). collateral-held, lovejoin-launch-review-fixes and lovejoin-accounts-review-fixes are UI tests that never reach the worker.
- The CHAIN_SPENT_TRIES cap (lovejoin.ts:265) is pinned only by a hang. Without the cap, the send loop retries a spent transaction on fake sleeps that never yield to a timer, so Vitest's own timeout never fires either. CI would hang rather than fail. A unit assertion would pin it cleanly: chainRetryMs(1, { busy: 0, spent: CHAIN_SPENT_TRIES }, new SpentInputError('x')) should return undefined.
- t1g#12's guard is duplicated in Rust: seedelf-core/src/lovejoin/launch.rs:169 check_terms refuses a 10 ₳ ADA pool, so dropping the worker's check costs only Koios reads. t1g#7's guard is backed by withdrawDueNow's later `sending` check. t1g#10's harm is bounded by reserve()'s StalePool. t1g#2 can't be reached today.
- Setup side effect, shared by every T1 agent: the copies' node_modules symlink points at TREE's, so Vitest wrote its timing cache to TREE's extension/node_modules/.vite/vitest/<hash>/results.json and Vite used node_modules/.vite-temp. Both are gitignored. No tracked file in TREE changed (git diff HEAD is clean for extension/src and extension/tests), and all copies under ~/.cache/seedelf-review-51/T1g* are removed. No Rust was built, so T1g-target was never created.

## Coverage

Tried every guard in E1a's and E1b's lists, after merging the duplicates (a1/b13, a4/b18, a5/b22, a6/b24, a7/b25, and a9 with b14). That is 37 guards and 71 mutants, run in the order asked: no named test first, then a stranger's or site's input, then the rest. Every mutant ran against its lane-named tests where the lane named any. Every survivor then ran against each test where the fire marker showed its guard acting; for M01, M02, M03, M09, M14, M62 and M68, against every test that reaches the line as well. Not fire-checked: 43 of the 192 reaching test files, which reach the modules only through handlers, sessions, sw or dapp and never call a Lovejoin flow (accounts*, dapp-*, governance, swap-*, wallet, worker and similar). Their runs could miss a firing, but none of them calls a Lovejoin flow. Two runs were cut short. M24's extra reach-set run (65 tests) was stopped after 15 minutes under load with no failure, though its marker never fired, so it couldn't catch. M54's runs were stopped while hanging; see the notes. Not run: Playwright, Rust (no guard here is in Rust, and none sits behind WebAssembly), any WebAssembly rebuild, and the verifiers' r51-* tests, which I excluded from every run.
