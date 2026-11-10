# 1.9.0's release review: the swaps fixer

A fix lane, in a worktree of `8d7c4b0c`, test first. Verbatim from its structured report.

**Branch:** `review-1.9.0/fix-swaps`, commit `f338e6a5`.

**Files:** `seedelf-platform/seedelf-web-wallet/extension/src/background/minswap.ts`, `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts`, `seedelf-platform/seedelf-web-wallet/extension/tests/swap-routes.test.ts`, `seedelf-platform/seedelf-web-wallet/extension/tests/order-cancel-check.test.ts`

## Fixed

### L8 (routes#1 and its 404 neighbour)

**What.** The fix follows R/v-routes/fix-routes1b.diff, with the status checked for both codes as the brief gives them.

minswap.ts:
- :86 MinswapTrouble gains "name-refused" and "no-route", and its doc names them as routeOf's.
- :125 NAME_REFUSED is /exclude_protocols\/\d+ must be equal to constant/; :128 NO_ROUTE is /^quote not found\.?$/i.
- :436 troubleOf(status, why) replaces the inline ternary. It sets name-refused only on a 400 and no-route only on a 404; funding-unseen and build-failed match as before. If Minswap's words change, the match fails and the code falls back to today's behaviour.

sessions.ts:
- :283-284 MINSWAP_REASON maps both codes to "other" (tsc needs the entries). Anywhere else, such as the first ask or build-tx, they behave like any other refusal, so RetryReason and the UI don't change.
- :891-903 routeOf: when the second ask fails with name-refused or no-route, it keeps `first`. Anything else is rethrown: a 429, silence, a 5xx or another refusal.

Trace of the brief's point, keeping `first` after an outOfPlace re-ask:
- routeOf asks again only when avoid = outOfPlace(first) ∪ uncheckedProtocols(network, first) is non-empty.
- All three callers run those same two checks, on the same est = first and the same network, before buildTx: quote at sessions.ts ~1597 (routesThrough, then routesOutOfPlace), swapBuild ~3196 (nowRoutesThrough, then nowRoutesOutOfPlace) and order() ~4137 (Refused nowRoutes, then nowOutOfPlace, which step() turns into a pause).
- So a kept `first` always ends in a refusal or a pause in the wallet's words, and Minswap's build-tx is never called.
- This also covers the two-leg and Danogo-beside cases, which in 1.8.1 already showed the raw 404 and retried.

**Tests.** swap-routes.test.ts, describe "a second ask Minswap refuses (1.9.0's release review, routes#1)" (line 288), 14 tests:
- "tells these two refusals by Minswap's own words and status, and nothing else": a unit test on the Minswap client, using the live 400 shape (23 constants plus anyOf, 1,249 chars) and the live 404 {QuoteNotFoundError, "Quote not found."}; the same words under a 500, or another 404, give no trouble code.
- it.each over ChakraBondingCurve (400) and SomeNewDex (404), quote on mainnet: refused with "Minswap routes this swap through X, which the wallet can't check yet…" after exactly 2 estimates.
- it.each over the same two, runner: paused with "Minswap now routes it through X, whose orders the wallet can't check yet." and no retry; Review it myself refuses with nowRoutesThrough; no build-tx; only the funding submitted; Stop returns ["out","back"].
- it.each over outOfPlace (a path of two legs MinswapV2+SundaeSwapV3, and Danogo beside MinswapV2) × (404, 400), quote on preprod and mainnet: refused with routesOutOfPlace's words after 2 estimates.
- The same four, runner: paused with nowOutOfPlace's words; Review it myself refuses with nowRoutesOutOfPlace; no build-tx; one submitted transaction (the funding).
- "still throws on a limit or an outage…": a 429 or a 503 on the second ask fails the quote with Minswap's words. The runner retries with reason minswap-rate-limited, then other, never pauses or builds, and places ["out","swap"] once Minswap answers.

**Evidence.** Test first, then the fix:
- Before any change, the 3 files passed: 53 passed (53).
- With the new tests on the base sources (logs/base-swap-routes.txt): "Tests 13 failed | 15 passed (28)". All 13 L8 behaviour tests fail with the bug's own output: "Minswap refused it (400): body/exclude_protocols/1 must be equal to constant, …" or "Minswap refused it (404): Quote not found.", the runner not paused, and "expected undefined to be 'name-refused'".
- With the fix (logs/fix-swap-routes.txt): "Tests 28 passed (28)".
- The final tests on the base sources, swapped in with git show 8d7c4b0c and then restored and checked with cmp (logs/final-base-new-tests.txt): "Tests 13 failed | 45 passed (58)". Only the 13 L8 tests fail.

Mutants on the final code, each applied by mutate.py and restored from a backup checked with cmp (logs/final-mut-*.txt):
- keep-any (`if (!(e instanceof MinswapError)) throw e;`): "Tests 1 failed | 27 passed (28)", killed by the limit/outage test, which passes on the base.
- any-status-400 and any-status-404 (each status check dropped): each "1 failed | 27 passed (28)", killed by the unit test.

### mutants#4

**What.** A test only. swap-routes.test.ts:173 adds fundedOnMainnet(t): session 0 under sessions.mainnet, funded with the fixture's UTxO at the session's mainnet address. Minswap builds a Minswap V1 order at 11<ORDER_SCRIPT><stake>, the same script on both networks, so the runner really places it on mainnet. This goes further than the verifier's probe, which ended in an unrelated "spends something that isn't this session's" pause.

swap-routes.test.ts:201 adds "is asked for again on mainnet by Review it myself and the runner's order too, and built without it (1.9.0's release review, mutants#4)":
- swapBuild("mainnet") resolves a review.
- advance("mainnet") places ["out","swap"] with no pause or retry.
- Each asks [estimate, estimate excluding SomeNewDex, build-tx excluding SomeNewDex].

**Tests.** swap-routes.test.ts > "a route through a DEX the wallet doesn't know (2026-11-09)" > "is asked for again on mainnet by Review it myself and the runner's order too, and built without it (1.9.0's release review, mutants#4)"

**Evidence.** - It passes on the base (logs/base-swap-routes.txt).
- z6 (R/v-routes/z6z7.diff, swapBuild's routeOf given "preprod"): "Tests 1 failed | 27 passed (28)". It fails at line 208: "promise rejected 'Error: Minswap now routes this swap through SomeNewDex, which the wallet can't check yet…' instead of resolving" (logs/final-mut-z6.txt).
- z7 (order()'s routeOf given "preprod"): "Tests 1 failed | 27 passed (28)". It fails at the runner: paused {why:"refused", detail:"Minswap now routes it through SomeNewDex, whose orders the wallet can't check yet."} (logs/final-mut-z7.txt).

### routes#3

**What.** Tests only, in order-cancel-check.test.ts:
- :341 adds describe "a SundaeSwap V4 order on mainnet: Stop, the restore scan, and its fill (1.9.0's release review, routes#3)", ported from R/routes/review-v4-stop.test.ts onto the file's own realOrder, swapPlacing and seeded, with the real V4 fixture re-keyed to session 0.
- :176 lifts the mainnet reference rows out of seeded() into mainnetReferences(t) for the scan test. No behaviour changes: the REAL it.each still passes.

**Tests.** order-cancel-check.test.ts, under that describe:
- "is cancelled by Stop with V4's reference, signed by the session's payment and stake keys, paying the session alone": orders() reads SundaeSwapV4 at SWAP#0; cancelBuild signs ["0/0","stake"]; stop gives ["out","swap","cancel"] with no pause or retry; the build request's references are [c1ecddd6…#0]; the witness set holds two vkeys; every output pays the session.
- "is found by the restore scan through the swap its key signed, and its cancel is signed by both keys": scan("mainnet") gives {used:1, found:[0]}; the record's swap has orders [SWAP#0]; the protocol is SundaeSwapV4; the cancel review is {kind:"cancel", orders:1} with signs ["0/0","stake"]; txSubmit records the cancel.
- "is noticed filled once it's spent and the token comes to the session, and the session comes back": open, the order isn't counted as filled; once spent, with the token arriving, filled is true, refunded false, and the txs are ["out","swap","back"].

**Evidence.** All three pass on the base sources (logs/final-base-new-tests.txt) and with the fix: order-cancel-check "Tests 30 passed (30)".

Mutants, run on the final code over the 11 swap files (the brief's 10 plus swap-runner, logs/final-mut-*-swapset.txt):
- stake-v3-only (inspect's stake key held to SundaeSwapV3 by name, sessions.ts ~4402): "Tests 2 failed | 274 passed (276)". It is killed only by the new V4 Stop and scan tests, and survives every existing test.
- scan-preprod (the restore scan's order read given "preprod"): "2 failed | 274 passed". It is killed by the V4 scan test, and also by splash-remnant's trap test.
- spent-by-hash-only (ordersSpent counts only orders kept by hash): "5 failed | 271 passed". It is killed by the V4 fill test and 4 Splash tests.

The fill path has no V4-specific TypeScript, so its mutant is a general one. What's specific to V4 lives in WebAssembly (orders.json's V4 entry and reader). These tests run it for real, but it can't be mutated without rebuilding the wasm package, which this round forbids.

## Commands

All runs were from the worktree's extension/ folder, under `systemd-run --user --scope -p MemoryMax=8G`. Logs are in /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/6637f822-1e93-462d-9b5e-5bd103fc4b4b/scratchpad/review-1.9.0/fix/swaps/logs/

- Base, before any change: `npx vitest run tests/swap-routes.test.ts tests/sundae-orders.test.ts tests/order-cancel-check.test.ts`: Test Files 3 passed (3), Tests 53 passed (53).
- New tests on the base sources: `npx vitest run tests/swap-routes.test.ts --reporter=verbose`: Tests 13 failed | 15 passed (28) (base-swap-routes.txt).
- With the fix: the same command gives Tests 28 passed (28) (fix-swap-routes.txt).
- Final tests on the base sources (git show 8d7c4b0c for sessions.ts and minswap.ts, run, restore, cmp): `npx vitest run tests/order-cancel-check.test.ts tests/swap-routes.test.ts`: Tests 13 failed | 45 passed (58) (final-base-new-tests.txt).
- Mutants, via mutate.py and run-mutant.sh in fix/swaps/, each restored and checked with cmp:
  - z6 on swap-routes: Tests 1 failed | 27 passed (28)
  - z7: 1 failed | 27 passed (28)
  - keep-any: 1 failed | 27 passed (28)
  - any-status-400: 1 failed | 27 passed (28)
  - any-status-404: 1 failed | 27 passed (28)
  - Over 11 swap files: stake-v3-only Tests 2 failed | 274 passed (276); scan-preprod 2 failed | 274 passed (276); spent-by-hash-only 5 failed | 271 passed (276).
- `npx tsc --noEmit -p .` (its include covers tests/): exit 0, no output (final-tsc.txt).
- The brief's list: `npx vitest run tests/swap-routes.test.ts tests/direct-swaps.test.ts tests/order-cancel-check.test.ts tests/sessions.test.ts tests/sundae-orders.test.ts tests/swap-quote-ask.test.ts tests/restore-scan.test.ts tests/swap-order-open.test.ts tests/minswap-refusals.test.ts tests/splash-remnant.test.ts`: Test Files 10 passed (10), Tests 241 passed (241) (final-brief-list.txt).
- Wider check: every file in R/v-routes/minswap-test-files.txt that exists, plus i18n-worker-reasons, final code: Test Files 73 passed (73), Tests 1536 passed (1536) (final-minswap-files.txt).
  - An earlier run of the same set, before the last formatting edits, had one 5 s timeout: restore-scan's C41/C47 test at 5,034 ms under parallel load.
  - That file alone passed twice (45 passed, the test at 2,048 ms and 1,614 ms).
- `git diff --check`: clean.
- Committed by path: `git add` on the 4 files, then `git commit` "review-1.9.0 fix: swaps", f338e6a5.
- Afterwards the worktree is clean, the node_modules symlink is unlinked, and the main tree is clean at 8d7c4b0c.

## Notes for the lead

- **Docs lane (architecture.md ~660-669, the backlog line):** routeOf now keeps its first answer for both kinds of re-ask: a DEX the wallet doesn't check, and outOfPlace's (a path of more than one leg, or Danogo beside another DEX).
  - For outOfPlace this also changes 1.8.1's behaviour. 1.8.1 showed "Minswap refused it (404): Quote not found." and retried; now the quote and Review it myself refuse it, and the runner pauses, in routesOutOfPlace/nowOutOfPlace's words. Please describe it as covering both.
  - One trade-off to state: a paused swap waits for Try again, where the old retry would have resumed by itself if Minswap later routed elsewhere. That pause is architecture.md:669's stated design.
- **The new codes outside routeOf:** name-refused and no-route also tag a refusal of the first ask or of build-tx, for example if Minswap stops taking another of the wallet's own names. They map to RetryReason "other", exactly as before. So the backlog's "retry without a refused name", for the wallet's own list, still stands.
- **No other lane's files are touched:** RetryReason, rpc.ts, Swaps.tsx and i18n are unchanged, since both new codes map to "other".
- **routes#3:** the V4 Stop and scan tests are the only tests that catch the stake-key mutant (stake-v3-only). The fill test's mutant isn't V4-specific, since the fill path has no V4-specific TypeScript; V4's specifics live in WebAssembly, which the tests run for real but can't be mutated without a wasm rebuild.
- **Possible CI flake, outside this lane:** restore-scan.test.ts "offers 5 ₳ where the account's ADA alone is each under 5 ₳… (C41, C47)" hit Vitest's 5 s timeout once (5,034 ms) in a 73-file parallel run. Alone it takes about 2 s.
- **Limits kept:**
  - e2e/support.ts and the vectors JSON were never opened.
  - No network calls.
  - No cargo, Vite or Playwright run was needed.
  - The main tree is untouched.
  - The copied wasm/pkg (gitignored) stays in my worktree; the node_modules symlink is unlinked.
  - The commit ends with the session's Co-Authored-By line.

