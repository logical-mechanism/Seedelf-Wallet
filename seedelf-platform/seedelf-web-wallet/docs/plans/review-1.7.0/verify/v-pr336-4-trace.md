# v-pr336-4-trace: pr336#4, confirmed()'s trap rethrow has no test

**Verdict: confirmed. Severity: low.** The finding holds as described on HEAD `6bca8bec`, and the gap is wider than it measured. Mutation M5 survives every test file that wires discovery: 18 files and 382 tests, not just the 2 files and 62 tests the finding ran. The code on HEAD is correct. Only the test is missing. The proposed test works: it passes on HEAD and fails on M5.

## The trace on HEAD

1. **The catch.** `lovejoin-pools.ts:578-581`:
   ```ts
   } catch (e) {
     if (isTrap(e)) throw e;
     standard = [];
   }
   ```
   This is in `confirmed()` (`:565`), which #336 added.
2. **Only `confirmed()` reaches it, and only after `refresh()`'s own verification has passed.**
   - `refresh()` first verifies each listed pool (`:450` `this.verified(...)`, which calls `lovejoinVerifyPool` through `tried()`). Then `:454` runs `await this.keep(network, await this.confirmed(network, found))`.
   - `confirmed()` calls `koiosAlone()` at `:570`, outside the `try`. Inside the `try`, `launched()` calls `lovejoinLaunchCheck` (`:537-539`, through `tried()`, which rethrows a trap at `:250`) and then verifies again (`:542`, a second `lovejoinVerifyPool`).
   - So a trap reaches this catch from only two places: `lovejoinLaunchCheck`, or `launched()`'s second verify. Both run on a pool the data layer listed and `refresh()` already verified.
3. **On HEAD the trap travels to a lock.**
   - `serviceDeps().pools` rethrows a trap (`:597-600`).
   - `LovejoinService.readSet`'s `kept` rethrows a trap (`lovejoin.ts:2705-2711`).
   - From there it reaches one of three places:
     - `answerUi` (`sw.ts:376-381`): `if (!isTrap(e)) throw e; await ctx.wallet.trapped(); throw new WalletLocked(WASM_BROKEN());`
     - #330's `unawaited` (`handlers.ts:48-52`), for example `withdrawDue` at `:585`.
     - The alarm's runs.
   - `look()` awaits `refresh()` with no catch (`:391-392`), so the Lovejoin page's look (`handlers.ts:528-531`) ends in `answerUi` too.
4. **No existing test reaches the catch with a trap.**
   - `wasm-review-fixes.test.ts:169-177` traps in `verify`, which is `refresh()`'s `verified()` at `:450`, before `:454` is reached.
   - Its fakes are `:117` `lovejoinLaunchCheck: refused` and `:118` `koios: () => ({ koiosAlone: refused })`. Had `confirmed()` run with a fresh pool, `:570` would throw "not asked here" outside the `try`.
   - `run-traps-review-fixes.test.ts:235` stubs the `pools` dep itself, with no `PoolDiscovery`. `:261` traps in LovejoinService's own verify.
   - `lovejoin-discovery-review-fixes.test.ts`'s deep datum doesn't trap with the Rust fix in place. A module built without the fix would trap in `refresh()`'s verify first.
   - Only `sw.ts:236` constructs `PoolDiscovery` in `src/`. `e2e/` has no trap hook.

## The mutation (a copy outside the tree)

M5 deletes only line 579, `if (isTrap(e)) throw e;`. The copy is `seedelf-web-wallet/` without node_modules, dist, release or test-results; `node_modules` is symlinked back, and `seedelf-core` and `seedelf-crypto` are linked beside it for `fakes.ts`'s fixtures.

- `lovejoin-discovery` and `lovejoin-merged-review`: `Test Files 2 passed (2)`, `Tests 62 passed (62)`. This reproduces the finding's number.
- The other 16 files that import `lovejoin-pools` or construct `PoolDiscovery`:
  - The files: `wasm-review-fixes`, `run-traps-review-fixes`, `lovejoin-discovery-review-fixes`, `lovejoin-pools-head-start`, `collateral-reserve-review-fixes`, `lovejoin-1-5-0`, `lovejoin-crediting-review-fixes`, `lovejoin-flows`, `lovejoin-form-review-fixes`, `lovejoin-held-balance`, `lovejoin-hub`, `lovejoin-merged-screens`, `lovejoin-planner`, `lovejoin-screens-review`, `lovejoin-session5-screens`, `storage-privacy`.
  - Result: `Test Files 16 passed (16)`, `Tests 320 passed | 2 skipped (322)`.
  - The 2 skips are the head start's writer and its live-Koios block. Both are env-gated, and I ran with both variables unset.
- **What M5 does**, from a test run only in the copy:
  - `refresh()` resolves, `known()` is `[]`, and `serviceDeps(d).pools()` resolves `[]`.
  - The pool is left out exactly as when Koios is down (`:580`).
  - The new record is written with its `listed`, so the five minutes hold before the next list.
  - No trap reaches `answerUi` or `unawaited`, `wallet.trapped()` never runs, and the broken instance stays in use. This is the scenario as filed.

## The scratch test

`extension/tests/zz-review-v-pr336-4-trace-1.test.ts` (deleted). It uses the fixture pool listed by the data layer, the real WebAssembly, and Koios answering its launch.

1. **Control.** With the real launch check, Koios is asked `["tx_info"]`, the calls are `{ verify: 2, launchCheck: 1 }`, and `known()` is `[ID]`. This proves the path reaches `confirmed()`.
2. **`lovejoinLaunchCheck` throws `new WebAssembly.RuntimeError("unreachable")`.** `refresh()` and `serviceDeps(d).pools()` both `rejects.toBe(trap)`. The calls are `{ verify: 1, launchCheck: 1 }`, and `tx_info` was asked.
3. **`launched()`'s second `lovejoinVerifyPool` traps.** Both reject with the trap.
4. **A refusal in words from the launch check.** The pool is only left out. That is `tried()`'s job, not this catch's.

Results:
- HEAD, in the tree: `Tests 4 passed (4)`.
- M5, in the copy: `Tests 2 failed | 2 passed (4)`. Cases 2 and 3 fail with `AssertionError: promise resolved "undefined" instead of rejecting`. Cases 1 and 4 pass.

## Severity

Low, as filed.
- The code is correct on HEAD. This is a regression guard with no test.
- The trigger is narrow: a trap in a second-stage call after `refresh()` already verified the same rows. Only Koios's `tx_info` inputs are new to `lovejoinLaunchCheck` there.
- If the rethrow were dropped, the harm would be in 314-wasm#0's class: the wallet stays unlocked on a broken instance until something else traps. It doesn't move or lock money.

The case for medium is the brief's "a critical guard with no test". This is the trap rule's defence in depth (`run-traps-review-fixes.test.ts`'s header), and every other catch on that rule has a test. Context I didn't trace further: #332 made integer overflow in core, crypto and koios a trap rather than a wrapped sum, so more inputs can now trap under core. I'd keep it at low, but the owner may read it as medium.

## Fix advice

- The proposed test is right and enough. The one rethrow covers both WebAssembly calls under `confirmed()`.
- **Where to put it:** the describe block that #336 added, "a pool the data layer lists, confirmed from Koios before it's kept" (`lovejoin-discovery.test.ts:367`). Its `discovery()` helper (`:95`) fixes the real `wasm` (`:45`). Give it a `wasm` option that defaults to the real module. The test is then `onIndex()` with `listed()`, `koiosOf([], [launch()])`, and the real `lovejoinVerifyPool` with `lovejoinLaunchCheck: () => { throw trap; }`.
- **Assert where it trapped:** check `asked(k, "tx_info")` has length 1, so the test can't pass on a trap from `refresh()`'s own verify. Use `rejects.toBe(trap)`, not only `toBeInstanceOf`.
- **Loop over both kinds of trap**, as `run-traps-review-fixes.test.ts:66`'s `traps()` does: a `RuntimeError`, and a `RangeError` thrown inside WebAssembly. `isTrap` has a branch for each.
- Keep a refusal in words beside it, which only leaves the pool out.

## Cleanup

- Deleted `extension/tests/zz-review-v-pr336-4-trace-1.test.ts` from the tree.
- Deleted the whole mutation copy at `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/review/v-pr336-4-trace/`. rsync had copied `extension/.preprod-test-wallet.txt` into it, so that copy is gone too.
- No tracked file was touched, and no network was used: Koios and the data layer were fakes throughout.
