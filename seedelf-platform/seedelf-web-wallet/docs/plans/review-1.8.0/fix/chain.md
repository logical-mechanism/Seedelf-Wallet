# 1.8.0's release review: the chain lane's fixes

- **Branch:** `review-1.8.0/fix-chain`, in `…/scratchpad/fix/chain`, from `1beba3fb`.
- **Head:** `180172bb0895bf40058df7d9ad7f4427270a9010`.
- **Commits:**
  - `73c23fd3` fix(web-wallet): with no 5 ₳ pool shown, a return's tokens still go into their pools (O5)
  - `180172bb` fix(web-wallet): a swap approved on 1.7.2 comes back in no more boxes than it was priced for (critic#4)
- **New test file:** `extension/tests/lovejoin-chain-review-fixes.test.ts`, 8 tests (3 for O5, 5 for critic#4).
- **Words:** no key added or changed, so nothing awaits back-translation.
- **Outside my lane:** one existing pin, and three hand-written approval records in another file, change with critic#4's marker. They are 4 lines, not applied on my branch: see *For the lead*, item 1.

Every command below ran from the worktree's `seedelf-platform/seedelf-web-wallet/extension`. I ran no git command outside the worktree. In it, I committed by path, and the revert checks rewrote files from `git show <rev>:<path>` or `git apply` and then put them back. `git status` is clean at the head.

---

## critic#4, confirmed first (it had no verifier)

**The critic's own case, unchanged in my worktree at `1beba3fb`.** A scratch copy of `critic-scratch.test.ts`, deleted after the run.
- Command: `npx vitest run tests/chain-scratch-critic.test.ts -t "classic pool's price" --maxWorkers=2 --silent=false`.
- Output: `PRICE A BOX: {"classicPerBox":"10950000","classicBoxes":3,"fivePerBox":"5950000"} RETURN: {"boxes":6,"mixes":6,"fees":"6348878","collateral":true}`. 1 passed.

**Ported to a 1.7.2-shaped approval, through the runner.**
- I took the record's shape and its pricing from 1.7.2's own code (`git show 6b70c1f8:…/sessions.ts`, read-only):
  - `AutoRecord.lovejoin` is `{ depth, delay, width?, tokens?, tokenBoxes?, fund? }`. Nothing in it names the ADA's box, and 1.8.0's `outBuild` writes the same shape. So nothing told a 1.7.2 approval from a 1.8.0 one before this fix.
  - 1.7.2's `priced` took `funding(…, 1)` and `funding(…, 2)` with no pool named (the classic pool) and computed `perBox` and `besides` from them. A box count was `(spare − besides) / perBox`, capped at `chainBoxes`.
  - WebAssembly's `funding_for_in(n)` is `DEPOSIT_RESERVE + n·per`, so that count is `boxes_affordable_in(spare)`. It's exactly what `plan` counts in the classic pool, and 1.7.2's `chain()` planned the classic pool (`poolNamed(undefined)`, which has no `ref`) the same way.
- **It holds.** Run at `1beba3fb`, the runner's own step (`advance(…, true)`) brought each session back by itself:

| Case | 1.7.2 priced (classic) | 1.8.0 sent |
|---|---|---|
| Stopped before its order, 40 ₳, approved 1 wave deep (Settings since: 2) | 3 boxes | 6 boxes |
| MIN sold for ADA and filled: 60 ₳ proceeds and the 2 ₳ margin, 1 wave | 5 | 9 |
| 40 ₳ refunded, 2 waves, 40 strangers in the 5 ₳ pool | 2 | 4 |

---

## O5 · fixed (`73c23fd3`)

**What changed** (`src/background/lovejoin.ts`):
- **`chain()`'s no-pool throw.** With no 5 ₳ pool shown, a return (`way.returns`, no pool named, not Mix again) runs `acrossOf` with no ADA leg. The call has no collateral pool, which is none with no 5 ₳ pool: its collateral comes back with the return. If a token goes, that chain is the return's. `noAdaPool` is thrown only where no token goes. The `ChainCall` literal and its `holdTail` line (share's) are untouched.
- **`acrossOf`'s ADA leg is optional.** A new `AcrossCall` type is `ChainCall` with `pool` optional, and `acrossOf` takes it. Its `values`, its guess, its legs, `adaSplit`, `adaShort` (now from `adaFloor`, read once), and the token-failure fallback all leave the ADA out where there's none. Where nothing goes, the no-ADA case says `noAdaPool`, as the prototype had it.
- **Two type-only widenings** outside my functions: `planAcross` and `tailRows` take `AcrossCall`. They read nothing of the pool, and every `ChainCall` is one (see *For the lead*, item 2).
- **Words:** none new. The return's switch already says `swaps.lovejoin.privacy.onTokens` where only token pools take boxes (`LovejoinReturn.tsx`).

**Tests** (`describe("1.8.0's release review, O5…")`):
1. *takes a site's LJTEST into its v2 pool, and brings its ADA back with the return.* This is lows-a's and cross's case, with only the v2 token pool shown. It expects:
   - `parts: [{ pool: TOKEN, boxes: 2 }]` and the token's way with 2 boxes;
   - no `lovejoinSkipped`, no collateral tail, and no 5 ₳ pool in `values`;
   - `lovelace` over 40 ₳.
2. *brings it all back directly, saying no pool of 5 ₳ boxes, where no token goes either.* A token pool too short for a box, and a session with ADA alone. A guard of the rule: it passes at the base too.
3. *takes a swap's MIN into the pool its approval showed, with only MIN's v2 pool shown.* This is o-design's swap case, end to end:
   - the approval (`outBuild`) shows MIN's way with 1 box and `skipped: noAdaPool`;
   - `outSubmit` records it;
   - then the fill: its return has `parts: [{ pool: min.id, boxes: 1 }]` and no `lovejoinSkipped`.

**At the base.** `lovejoin.ts` at `1beba3fb`, with O5's tests (before the commit): `npx vitest run tests/lovejoin-chain-review-fixes.test.ts --maxWorkers=2` gives **2 failed, 1 passed**. Tests 1 and 3 fail with `expected 'Lovejoin has no pool of 5 ₳ boxes to …' to be undefined`, the finding's reason. Test 2 passes.

**Fixed:** the same command gives **3 passed**.

**Revert check at the head.** I reversed O5's hunks (`git diff 1beba3fb 73c23fd3 -- …/lovejoin.ts | git apply -R`) and kept critic#4's:
- the whole file gave **2 failed, 6 passed**: O5's tests 1 and 3, as at the base;
- then I put it back from `HEAD`.

**Mutant.** `if (across?.chain) return across.chain;` became `if (across) return across.chain;`, so an across read with no chain came back directly as `noBox`:
- `-t "O5"` gave **1 failed, 2 passed**: test 2, with `expected 'its spare ADA is too little for a box' to be 'Lovejoin has no pool of 5 ₳ boxes to …'`;
- then I put it back.

**Not pinned:** `acrossOf`'s throw where every leg fits none, which says `noAdaPool` with no ADA pool. It's reached only where the read leaves no room the guess saw: `works` already needs room for a box, and the guess must pay for one first. The base had no such branch either.

## critic#4 · fixed (`180172bb`)

**What changed:**
- **`lovejoin.ts` `ChainWay.classic`:** its approval priced its ADA's boxes in the classic pool's 10 ₳.
- **`lovejoin.ts` `chain()`'s `countAt`:** with `way.classic`, it also plans the same rows in the classic pool (`this.plan(…, this.classic(network), …)`, the request 1.7.2's return made) and takes the lesser count. The rest comes back at once with the return. A mix session's `boxes` cap is unchanged. `this.classic()` can't throw there: `chain()` runs only where Lovejoin is on, and every network's Lovejoin config has a `mixBox`.
- **`sessions.ts` `AutoRecord.lovejoin.box`:** the marker, the box value an approval priced at, in lovelace.
- **`sessions.ts` `outBuild`:** records `box: "5000000"` (`SESSION_COLLATERAL`, the 5 ₳ pool's box under `adaPoolOf`'s rule) on every approval through Lovejoin, a 5 ₳ pool shown or not. So a 1.8.0 approval is never capped. With no pool at Review, the return uses one found later, as the owner's call of 2026-11-06 has it.
- **`sessions.ts`, what `buildBack` passes to `chain()`:** `classic: true` where `pricedClassic(record)` holds. That's a new module function beside `wayOf`: `!!s?.swap && !!s.auto && !s.auto.lovejoin?.box`. It's added in `buildBack`'s call, not in `wayOf`, so `lovejoin-planner.test.ts`'s `wayOf` pins stay as they are.
- **Scope:**
  - A mix session (no `swap`), a site's session and a restored session aren't capped.
  - The cap holds on every path of the swap's return: the runner's, and the worker's `backBuild` of a self-running swap, which no page offers (the swap page's Bring it back and `reviewAfterSkip` need `!auto`, and `claimBuild` refuses one). An approval's terms bind its return, as its depth, wait, width and token boxes already do (independent review L21; 34e's review, 10).
  - It's counted in `countAt` alone; *For the lead*, item 5, says why `acrossOf` needs none.
- **Words:** none new. A 1.7.2 swap whose ADA pays for a 5 ₳ box but no 10 ₳ one now comes back directly, saying `sess.skip.warn.noBox` ("its spare ADA is too little for a box"). That's what 1.7.2's own return said for that ADA, and true of the box its approval priced.

**Tests** (`describe("1.8.0's release review, critic#4…")`). The helper `pricedOn172` is 1.7.2's `priced` arithmetic, and `swapRecord` writes 1.7.2's record shape.
1. *stopped before its order, its 40 ₳ takes the three boxes 1.7.2 priced…, not six of 5 ₳.* This is the critic's case, ported.
   - It asserts 1.7.2's count, 3, and the 5 ₳ plan's 6.
   - Then the runner's `advance`: the sealed chain has `boxes: 3`, and its mixes are ≤ 3.
2. *filled with ADA…*: the fill through the runner (`view.auto.filled`), `boxes: 5` (1.7.2's count for 62 ₳), mixes ≤ 5.
3. *refunded, two waves deep…*: the refund through the runner (`view.auto.refunded`), `boxes: 2`, mixes ≤ 8.
4. *approved on 1.8.0, records the 5 ₳ box it was priced at, and its return takes all its ADA pays for.*
   - `outBuild` then `outSubmit`: `auto.lovejoin` holds `{ depth: 1, box: "5000000" }`.
   - That recorded approval, stopped with 40 ₳: the runner sends `boxes: 6`.
5. *brings back at once what it leaves out, where a site's session with the same ADA takes the six boxes it pays for.*
   - The site's session: `{ boxes: 6, mixes: 6 }`.
   - The 1.7.2 swap's review: `{ boxes: 3, mixes: 3 }`, and its `lovelace` beats the site's by at least 3 × 5 ₳.

**At the base.** Both source files at `1beba3fb`, with the final test file: `npx vitest run tests/lovejoin-chain-review-fixes.test.ts --maxWorkers=2` gives **7 failed, 1 passed** (the 1 is O5's guard). Each fails for its finding's reason:
- test 1: `"boxes": 6` where 3 is expected;
- test 2: 9 for 5;
- test 3: 4 for 2;
- test 4: `expected { depth: 1, delay: '1-6' } to match object { depth: 1, box: '5000000' }`;
- test 5: `{ boxes: 6, mixes: 6 }` for `{ boxes: 3, mixes: 3 }`;
- O5's two cases fail too, as above.

**Fixed:** **8 passed**.

**Revert checks.** The same command each time; each file was put back from `HEAD` after:

| Check | What changed | Result |
|---|---|---|
| A, the whole fix | `lovejoin.ts` and `sessions.ts` at `73c23fd3` | 5 failed, 3 passed: all five critic#4 tests; O5's pass |
| B, the cap alone | `countAt`'s `paid.set` without `priced.boxes` | 4 failed, 4 passed: tests 1, 2, 3, 5; test 4 passes |
| C, the marker alone | `outBuild` records no `box` | 1 failed, 7 passed: test 4, at its record |
| D, a mutant | `pricedClassic` ignores `box` | 1 failed: test 4, at the runner's `boxes: 6` (got 3) |
| E, a mutant | `pricedClassic` returns `true`, every return capped | 2 failed: test 4 (got 3), and test 5's site session (`{ boxes: 3, mixes: 3 }` for 6) |

---

## Awaiting blind back-translation

None: no key is added or changed.
- `sess.skip.warn.noAdaPool` is now also thrown from `acrossOf`'s no-ADA case. It's shown in the same frames as before: the return's review, the saved `lovejoinSkipped`, `lovejoin.warn.skippedIts` and `claim.warn.skippedItem`.
- The find lane's O4 rewording covers that throw.
- `tests/i18n-worker-reasons.test.ts` follows both new uses (it walks a `??` and a ternary), and passes.

## For the lead

1. **critic#4's marker changes four hand-written records outside my lane.**
   - **Why.** A swap's `auto.lovejoin` with no `box` now means "approved before 1.8.0". Three records in `collateral-reserve-review-fixes.test.ts` model 1.8.0 approvals (Stop's 5 ₳ pricing against the chain WebAssembly builds). Without `box`, their returns are capped, and four tests fail: *prices Stop's boxes…(L1)*, and three in *Stop: … (last-3c, 2 and 4)*. `swap-lovejoin-way.test.ts:69` pins `auto.lovejoin` with `toEqual`.
   - **The patch.** I applied it temporarily, ran it, and put the files back: both files pass, **35 tests on each build**. It applies cleanly at my head (`git apply --check`), and a copy is at `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/chain-work/lead-test-edits.diff`. The four lines:
     - `collateral-reserve-review-fixes.test.ts:585`: `lovejoin: { depth: 1, delay: "1-6" }` becomes `lovejoin: { depth: 1, delay: "1-6", box: "5000000" }`.
     - `collateral-reserve-review-fixes.test.ts:836`: `lovejoin: { depth: o.depth ?? 1, delay: "1-6" },` becomes `lovejoin: { depth: o.depth ?? 1, delay: "1-6", box: "5000000" },`.
     - `collateral-reserve-review-fixes.test.ts:1163`: `lovejoin: { depth: 1, delay: "1-6" },` becomes `lovejoin: { depth: 1, delay: "1-6", box: "5000000" },`. It passes either way; it's for faithfulness.
     - `swap-lovejoin-way.test.ts:69`: `toEqual({ depth: 1, delay: "2-12" })` becomes `toEqual({ depth: 1, delay: "2-12", box: "5000000" })`.
   - **Optional, for faithfulness.** These pass as they are:
     - `lovejoin-planner.test.ts:634` and `:1307` (their ADA goes across pools, which isn't capped);
     - `swap-lovejoin-way.test.ts:36` (it asserts depth and wait alone).
     They model 1.8.0 approvals too, and could carry `box: "5000000"`.
2. **Two type-only widenings in `lovejoin.ts`, outside my functions:** `planAcross(network, c: AcrossCall, …)` and `tailRows(c: AcrossCall, …)`. No behaviour changes. No other lane's prototype touches them: I read share's `p1-impact-prototype.diff`, and lows-a's P2 fix is in `buildBack`'s tail branch.
3. **At the merge, by lane:**
   - **find:** `chain()`'s `adaPool(network, true)` picks up O1's look unchanged, and my `if (!into)` block runs after it. O4's reworded `noAdaPool` covers the new throw site.
   - **share:** its `holdTail` line in the `ChainCall` literal is untouched. P1 doesn't meet O5: with no 5 ₳ pool there's no collateral pool.
   - **connector:** nothing of mine is in `siteOutBuild` or the card.
   - **screens:** W1's box words (`swaps.boxes.*`, "of 10 ₳") are what Stop's dialog says for a capped 1.7.2 swap too.
4. **Stop's dialog for a swap approved before 1.8.0.** `stopCost` calls `priced`, which is find's, and it prices in 5 ₳ boxes, while the return now takes no more than the classic count. With 40 ₳ one wave deep, the dialog says "at most 6 boxes…, about 5.7 ₳ in mix fees", and 3 boxes go, about 2.85 ₳ of mix fees.
   - "At most" and "about" stay true, and no unsaid fee is paid.
   - To make it exact, `priced` could take the lesser of the 5 ₳ count and the classic count (`funding(…, undefined)`) for a `fixed` with no `box`. That's find's file; I didn't touch it.
5. **Why the cap is in `countAt` alone.**
   - A 1.7.2 approval can name no v2 token pool. 1.7.2 verified none, and a pool's seed is spent by its one launch, so an 8131b1d pool's id is never a v2 pool's on chain. Its named token pools are all retired, so no token leg of it goes, and `acrossOf` hands its ADA back to `countAt` (`read`). A swap approved before 34e has no `returns` at all.
   - In tests alone, the v2 token-pool fixture shares its id with its 8131b1d twin. A hand-written 1.7.2-shaped record naming that id would take a token leg, its ADA leg uncapped: that's `lovejoin-planner.test.ts:634`'s state, with a wallet-launched MIN pool. Say if you want the ADA leg capped in `acrossOf` too: its `counts(w)` would need the classic count a width.
6. **What O5's review says.** With no 5 ₳ pool, a return whose tokens go says `swaps.lovejoin.privacy.onTokens`, and nothing says why its ADA came back unmixed. That's what the floor case has said since 44b, under the 5 ₳ pool's floor. If every screen must name it, that's the screens lane's call.
7. **e2e:** no spec pins `noAdaPool`, and the e2e's swaps go through `outBuild`, so they record `box` and aren't capped. On preprod the bundled head start holds v2's 5 ₳ pool, so O5's path isn't taken there. I ran no Playwright (not my lane).

## Checks run

- **`npx tsc --noEmit -p .`:** clean at the head (exit 0). Also clean at `73c23fd3`, and with O5 reverted at the head.
- **The test files my change can reach:** every test that builds a return or a chain, records or reads a swap's approval, or calls `wayOf`. That's `grep -lE "backBuild\(|claimBuild\(|outBuild\(|outSubmit\(|\.chain\(|advance\(|runAll\(|wayOf\(|stopCost\(|tailChain\(|claimSubmit\(|backSubmit\("`: 57 files, each run with `npx vitest run <files> --maxWorkers=2`.
  - **The batches:**
    - batch 00: chain-entry, chain-in-view, chain-lock, chain-record, chain-resend, chain-reservations, chain-return-history, collateral-reserve-review-fixes, direct-swaps, history-classes, i18n-worker-reasons, lovejoin-1-5-0, lovejoin-chain-review-fixes, lovejoin-flows, lovejoin-merged-review, lovejoin-restore, lovejoin-retired, lovejoin-stopped-before;
    - batch 01: lovejoin, lovejoin-token-feed, order-cancel-check, parts-send-review-fixes, pool-swap-landing, private-index, private-landing, restore-scan-lovejoin, restore-scan, return-chain-scope, return-history, return-plan, return-site-outs, session-close, session-collateral, session-funding-parts, session-index-taken, session-index, session-resend-spent;
    - batch 02: sessions-review-fixes, sessions-sent-twice, session-stale-reservation, sessions, session-trap, site-funding-seen, spent-clock-review-fixes, splash-remnant, submit-inputs-spent, sundae-orders, swap-order-open, swap-page, swap-page-words, swap-quote-ask, swap-routes, swap-runner, unlock-waits, worker-words;
    - with swap-lovejoin-way and lovejoin-planner.
  - **Default build:**
    - batch 00: 6 failed, 280 passed;
    - batch 01: 297 passed;
    - batch 02: 275 passed;
    - swap-lovejoin-way and lovejoin-planner: 1 failed, 90 passed;
    - **in all, 7 failed and 942 passed.**
  - **`VITE_ENABLE_MAINNET=false`:**
    - batch 00 with the two files: 7 failed, 370 passed;
    - batch 01: 297 passed;
    - batch 02: 275 passed;
    - **in all, 7 failed and 942 passed.**
  - **The 7 failures are the same on both builds:**
    - 2 are `lovejoin-1-5-0`'s head-start case: *plans every return and mix as with the classic pool alone…* and *finishes a 1.5.0 vault left mid-flight…*. They fail at `1beba3fb` too (2 failed, 2 passed there), by design, and they're the e2e lane's.
    - 5 are item 1's: 4 in `collateral-reserve-review-fixes` and 1 at `swap-lovejoin-way:69`. With item 1's patch, those two files pass, 35 tests on each build.
- **The i18n and words files:** `npx vitest run tests/i18n*.test.ts tests/words.test.ts tests/worker-words.test.ts --maxWorkers=2` gives 10 files, **191 passed**, on both builds.
- **My new file alone:** 8 passed on both builds (it ran in batch 00 each time).
