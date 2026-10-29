# Traps lane: report

Worktree: `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-wt/release-1.7.0` (W). Paths below are relative to `W/seedelf-platform/seedelf-web-wallet/extension/`.

## Summary

| Finding | Outcome | Code changed |
|---|---|---|
| x-merge#1 | **fixed** (sessions.ts half). The dapp.ts `watchFunding` half is **not a bug**: confirmed, nothing changed. | `src/background/sessions.ts` (`runAll`, `pump`) |
| pr330#0 | **fixed** (tests only: the scan's three trap rethrows are now pinned) | none |
| pr330#1 | **not a bug** (refuted, confirmed in source and at runtime), so left as it is | none |

No UI strings, no critical keys, no e2e specs, no WebAssembly node tests and no Rust changed. No privacy-policy entry is needed: there's no data-handling or Koios change.

## x-merge#1: a trap dropped under the alarm's run (fixed); dapp.ts watchFunding (not a bug)

### The fix (`src/background/sessions.ts`)

1. **`runAll`.** The pump loop and the `settleReturns` loop now catch with a local `unlessTrap` (`if (isTrap(e)) throw e;`) instead of `() => undefined`.
   - A trap goes on to runs.ts. There `unlessTrap` hands it on and `runNetworks` calls `wallet.trapped()` and stops the alarm.
   - Any other failure is still swallowed, so one session never stops the others.
   - The step loop and `markCut` are unchanged:
     - A step locks on a trap itself.
     - `markCut` has no WebAssembly outside the wallet's queue, so a trap there locks inside `Wallet.serial`.
2. **`pump`'s catch.** It now starts with `if (isTrap(e)) throw e;`, as `step` does: nothing is recorded first.
   - The session's `chain.stopped` isn't written, `chainEnded` isn't called, and the progress isn't dropped or released by pump.
   - The lock that follows wipes session storage, which takes the chain's progress and reservation with it. The next run marks the chain cut (`markCut`, and `lovejoin.ts` `cuts`).
   - So a chain a trap stops now reads as **CHAIN_CUT** ("The wallet locked, or the browser closed, while its chain was being sent.") in the user's language, on the session and in Lovejoin's record. Before, it read as the raw word "unreachable".
   - This holds on every path that pumps: the alarm, a running session's step, Send's `backSubmit`, and #337's skip (the tail lane's reworked `skipCollateralMix` still hands a pump trap on).
   - Any other failure is recorded exactly as before.

### Tests (`tests/session-trap.test.ts`, new describe "WebAssembly that traps under the alarm's run, as a chain or a return nothing steps comes back")

- **"locks the wallet when a site's return's chain traps as the alarm sends more of it, and the chain reads as a lock cut it"**
  - Setup: `withSession`, `backBuild`, `backSubmit` (the first window sent). Lovejoin's `watchOf` then rejects with `WebAssembly.RuntimeError`, as `verifiedPool`'s `lovejoinVerifyPool` would trap.
  - The run goes through `runNetworks`.
  - Before the fix: wallet `unlocked`, and after an unlock the chain was stopped with `"unreachable"`.
  - Now: `locked` with `lockReason` `"trap"`, and after an unlock the session's chain and Lovejoin's record both read `CHAIN_CUT()`.
- **"locks it when a chain traps under a mix's own step, the chain cut by the lock, not stopped for the trap's raw word"**
  - `runningMix(2)` builds a 6-transaction chain, so 4 are sent and 2 wait. Then `watchOf` traps under the next `advance`.
  - Before the fix: the wallet locked, but the chain read `stopped: "unreachable"` (pump wrote it before the step locked).
  - Now: `CHAIN_CUT()`.
  - `runningMix` gained an optional `depth` parameter, default 1, so the existing tests are unchanged.
- **"locks it when the look for a site's return, its history still to write, traps"** (the `settleReturns` path)
  - Setup: a recorded site's session whose return's chain went whole, with its last mix unconfirmed and the return's summary kept. `watchOf` traps, and the run goes through `runNetworks`.
  - Before the fix: `unlocked`. Now: locked by trap.
- **"keeps a chain's other failures as they were: said on the session as why it stopped, the wallet open"**
  - A guard test. A plain `Error` from the same seam leaves the wallet unlocked and records its message as the stop reason.
  - It passes both before and after the fix.

Mutation check, in a copy outside the tree:
- Without `runAll`'s half, tests 1 and 3 fail (`unlocked`).
- Without `pump`'s half, tests 1 and 2 fail (`"unreachable"`).

So each half is pinned.

### The dapp.ts `watchFunding` half: not a bug, nothing changed

- Every WebAssembly call under `watchFunding` runs inside `wallet.withKeys`:
  - `siteAccount` calls `accounts()` (`oneTime.address` / `keyHash`) and `oneTime.rewardAddress`.
  - `accountUtxos`, `fundingSeen` and `partsOf` are JS only. koios.ts, spent.ts and private-store.ts use no WebAssembly.
- So `Wallet.serial` locks on a trap (`lockedBy: "trap"`) and throws `WalletLocked` before the bare `catch {}` sees anything. The site's `SITE_TRAPPED` answer is then right.
- I confirmed this with a scratch test outside the tree:
  - Setup: the real `siteAccount` with `OneTimeAccounts.prototype.rewardAddress` trapping, through `enable` → `privateBuild` → `answer`.
  - Result: the wallet ended `locked` with `lockReason` `"trap"`, and the site heard `{ code: -2, info: "Seedelf Wallet couldn't answer this request." }`.
- Adding `wallet.trapped()` there would be dead code.

## pr330#0: nothing pinned the restore scan handing its own trap on (fixed, tests only)

There's no defect on HEAD. Following the verifiers' corrections, the tests pin **all three** of the scan's catches outside the wallet's queue, not only `hexOf`. The finding's snippet (`as typeof wasm`) wouldn't typecheck; the tests use `ReturnType<typeof loadTestWasm>`.

**In `tests/restore-scan.test.ts`**, new describe "a trap in the restore scan's own WebAssembly":
- `it.each(["cip30Address", "readDexOrder"])` **"hands on a trap in %s, reading what the session's swap paid, and writes nothing"**
  - It uses the real scan, with the "order still open" fixture and `signing(t, { wasm: trapping(name, trap) })`.
  - Expected: `sessions.scan("preprod")` rejects with that very trap, and the book is not written.
- **"locks the wallet when a restore's own scan traps there, the restore answered"**
  - End to end: a real `restore-wallet` through `handle`, the real scan, and the real `unawaited`, with `cip30Address` trapping.
  - Expected: `vi.waitFor` sees the status `{ state: "locked", lockedBy: "trap" }`.

**In `tests/splash-remnant.test.ts`**, new describe "a trap reading what a stranger put at a spent Splash order's address, in a restore's scan":
- **"is handed on, never read on from as no order: the scan fails, writing nothing"**
  - It runs a mainnet scan that finds session 0's spent Splash order. `readDexOrder` traps only on the stranger's datum (`STRANGERS`) at that address.
  - Only `liveOrders`' look for the order's rest reads that datum, which is the input anyone can put there (how C06 got in).
  - Expected: `sessions.scan("mainnet")` rejects with the trap, and nothing is written.
  - The file's import gained `loadTestWasm`.

All four pass on HEAD. Mutations in a copy outside the tree:

| Mutation | What changed | Tests that fail |
|---|---|---|
| M4a | `hexOf`'s rethrow → `void e` | the `cip30Address` test and the end-to-end test |
| M4b | `recoveredRecords`' `read` rethrow → `void e` | the `readDexOrder` test |
| M4c | `liveOrders`' `read` rethrow → `void e` | the Splash scan test |
| M3 | #330's `unawaited` lock removed | the end-to-end test |

The verifiers also corrected two of the finding's claims, and both corrections are right:
- "As such catches did before 1.6.0" is wrong: these three have rethrown traps since `aef01f72` / `ce86c647`.
- "Site 3 end to end" overstates: those tests call `withdrawDue` directly.

## pr330#1: tx-view's `ownRegister` (not a bug, confirmed; left as is)

**Source check.**
- wasm-bindgen-macro-support 0.2.128 `codegen.rs`: `ref_from_abi` calls `Rc::increment_strong_count` (the `RcRef` anchor) before the body runs.
- The generated `__wbg_register_free(ptr, 0)` claims ownership through `from_abi`, which calls `Rc::try_unwrap`. If the value is still borrowed, that fails with `throw_str("attempted to take ownership of Rust value while it was borrowed")`.
- `isTrap` matches that message.
- The glue's `free()` calls `__wbg_call_guard()` first, but nothing ever sets `__wbg_reinit_scheduled`. The call guard is a no-op, and `free` runs on the same instance.

**Runtime check** (scratch tests in the copy, no mocks of `isOwned`):
1. **A real trap inside `is_owned`'s body with plenty of stack.**
   - How: the register's `generator` String pointer was moved past the end of linear memory, so `generator.clone()` reads out of bounds.
   - This used `ownRegister`'s exact shape, inside `t.wallet.withKeys` with the wallet's own `SeedelfKey`.
   - `isOwned` threw `RuntimeError: memory access out of bounds` and the catch returned false. Then `finally { r.free() }` threw, which replaced the return.
   - `serial` locked: `WalletLocked(WASM_BROKEN)`, `lockReason` `"trap"`.
2. **A real stack overflow inside WebAssembly, at every JS stack depth near the limit.**
   - At every depth where the overflow landed in WebAssembly, `ownRegister` threw an error `isTrap` counts. None returned `false`.
   - In production a stack overflow can't happen here anyway: the `withKeys` task runs on a shallow microtask stack.

So a real trap locks the wallet. The finding's repro threw from a JS mock, without entering WebAssembly, so nothing was borrowed and the free succeeded. The explicit rethrow the finding proposes would change nothing in the shipped build. It stays an optional nit for the lead: it would make the lock independent of wasm-bindgen's free refusing a borrowed value, as `balances.ts` `ownedUtxos` already is.

## Related gap found, not fixed (outside my functions)

**`claimSubmit` (Bring everything back's submit), sessions.ts.**
- Its per-return `catch (e) { failed.push({ index, error: e.message }) }` takes a trap too. The session is then listed as failed with "unreachable", and the next return is sent on the broken instance, with the wallet unlocked.
- Reach is narrow. A trap there needs WebAssembly outside the queue in `sendBack`, and that happens only when a chain's first window begins at giveme.my's witnessed mix (a collateral tail chain built again). `restBack`, `chainSent`, `recordChain` and `reserve` are JS only.
- With the pump change, such a chain's progress now stays until a lock. The alarm's next run pumps it, and a trap there locks the wallet (the fix above). Before, it was recorded as "unreachable" and dropped, with no lock.
- Recommendation: one line, `if (isTrap(e)) throw e;` at the top of that catch. The request then locks through `answerUi`, as `claimBuild`'s trap already does.
- I left it because the tail lane edits sessions.ts' way out, which includes Bring everything back.

## Tests run (W, one file at a time)

- Pass:
  - session-trap (7)
  - restore-scan (45)
  - splash-remnant (9)
  - handlers (21)
  - runs (6)
  - run-traps-review-fixes (14)
  - words (2)
  - chain-lock (3), chain-resend (7), chain-in-view (6), chain-return-history (4), chain-record (6)
  - lovejoin-stopped-before (3), resend-send-time (2), public-mix-stopped-runs (3), return-history (7), pending-alarm (3), return-chain-scope (4)
  - lovejoin-planner (87, on the rerun: see below), session-stale-reservation (2), session-resend-spent (4), lovejoin (92), unlock-resend (5)
  - swap-order-open (13), sessions-review-fixes (25), parts-send-review-fixes (38), pending-watch-busy (2), site-funding-seen (6)
  - submit-inputs-spent (2), unseen-send-time (4), unlock-waits (17), sessions (61), restore-scan-lovejoin (8)
- `npm run typecheck`: clean.
- The new tests ran 3× each, pinned to 2 CPUs (`taskset -c 0,1`): stable. The session-trap file took about 6 s.
- **lovejoin-1-5-0.test.ts** fails one test in W:
  - Test: "plans every return and mix as 1.5.0 did, but what a shown pool adds of its own".
  - Assertion: `mainnet 1: expected 'dc6abe3b…' to be undefined`, at the `collateralPool` check.
  - It fails identically in a copy with my changes removed, so it's **not mine**. It's most likely the release prep's refreshed `src/lovejoin-pools.json` (mainnet's 5 ₳ pool).
- One run of lovejoin-planner.test.ts showed 4 failures. They were the tail lane's new pr337 tests, before its fix landed. The file passes 87/87 now.

## For the docs lanes

- **architecture.md, "The runs and the services hand a trap on"** (line 53 in the main checkout).
  - Its claim that the runs "lock the wallet on a trap from any step" now holds for the alarm's chain sending and the return look too.
  - Suggested addition: "So do a session's chain the alarm sends and its look for a return nothing steps (`runAll`). A chain's sending (`pump`) hands a trap on before it records anything, so a chain a trap stops reads as cut by the lock (CHAIN_CUT), never stopped for the trap's raw word (1.7.0's release review, x-merge#1)."
- **1.6.0's fx-cut-2.md gap** ("runAll swallows a trap on the alarm's path ... (and pump, markCut)"):
  - It's closed for `pump` and `settleReturns`.
  - `markCut` needs nothing: no WebAssembly outside the wallet's queue.
  - If post-release-roadmap tracks it, it can say done. The `claimSubmit` gap above is the one left.
- **User-visible change:** a chain stopped by a trap now shows the lock's reason (CHAIN_CUT, translated) on the session's page and the Lovejoin page, instead of "Why it stopped: unreachable."
- No privacy-policy *Changes* entry is needed: there's no data-handling change and no Koios change.

## Lists

- **Strings added or changed:** none.
- **Critical keys changed:** none.
- **e2e specs edited:** none.
- **WebAssembly node tests added:** none.
- **Owner's calls:** none from these findings. The pr330#1 explicit rethrow is an optional nit for the lead. The `claimSubmit` rethrow above is a one-line fix for whichever lane owns Bring everything back.
- **Scratch work** (outside the tree, not for commit): `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/traps/`. It holds the mutation copy `mut/`, with `tests/zz-scratch-*.test.ts` and the mutators `unfix.py`, `half.py` and `mutate.py`.
