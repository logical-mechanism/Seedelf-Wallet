# v-pr330-0-trace: pr330#0, the restore scan handing its own trap on

**Verdict: confirmed.** **Severity: low.** **Confidence: high.**

I tried to refute it and couldn't. On HEAD the real scan does hand a trap on from all three of its WebAssembly calls outside the wallet's queue, and a real restore then ends `{ state: "locked", lockedBy: "trap" }`. But no test anywhere checks that.

I removed all three of the scan's own trap rethrows, the two the finding mutated and `liveOrders`', the one it didn't. Every existing test that reaches the scan, a restore or `liveOrders`' reads still passed: 13 files, 181 tests. Only my scratch tests failed.

## What I traced (HEAD `6bca8bec`)

1. **What #330 relies on for site 1.**
   - `unawaited` (handlers.ts:48-52) locks only when the run *rejects* with something `isTrap` counts (line 50: `if (isTrap(e)) await ctx.wallet.trapped()…`).
   - handlers.ts:166 hands it `ctx.sessions.scan(...)`. `scan` (sessions.ts:2559) passes `scanNow`'s rejection through, since `.finally` keeps it.
   - So if the scan swallowed its own trap, `unawaited` would see a resolution and do nothing.
2. **The scan's WebAssembly calls outside the wallet's queue.** There are exactly three, each `try { … } catch (e) { if (isTrap(e)) throw e; return undefined; }`:
   - `read` → `dexOrderAt` → `readDexOrder`, at sessions.ts:2727-2734 (rethrow at 2731). It is called at 2769 and 2803.
   - `hexOf` → `wasm.cip30Address`, at sessions.ts:2735-2742 (rethrow at 2739). It is called at 2768 and 2800.
   - `liveOrders`' `read` → `dexOrder` → `cip30Address` + `readDexOrder`, at sessions.ts:3860-3868 (rethrow at 3865).
     - The scan reaches it only through 2662 (`rows.length ? [] : await this.liveOrders(…, read)`).
     - Inside, WebAssembly runs only for a row with an inline datum (3861 returns before it otherwise), and only for spent rows (3871: `r.is_spent && read(r)?.protocol === "Splash"`).

   Everything else the scan calls in WebAssembly runs inside `wallet.withKeys`, which is `serial` (wallet.ts:505, 577-590), so a trap there locks by itself:
   - `accounts()` (5881-5898), `spentSet` and `ownedUtxos`;
   - `pin`, at 2668 and in every key read.

   `remnantsFrom` calls no WebAssembly.
3. **History.** The three rethrows date from when the code was written: `aef01f72` (2026-10-07) for `liveOrders`, and `ce86c647` (2026-10-11, the restore scan) for `read` and `hexOf`. They never were `return undefined` on everything.
4. **The tests, by grep of `extension/tests/` and `e2e/`.**
   - **Trap stubs.** These are every `WebAssembly.RuntimeError` stub, borrow-message `Error` and `overflowing()` stack overflow in the tests, and what each stubs:
     - dapp-caps (`cip30ReadValue`, `ogmiosUtxos` on DappService's wasm);
     - contacts and send (`checkPayableAddress`, `buildAccountSend`);
     - private-index (`isOwned`);
     - session-trap and worker-words (`lovejoin.chain`);
     - lovejoin-planner (`restBack`);
     - run-traps-review-fixes (Lovejoin's calls);
     - wallet and wasm-review-fixes (`isTrap` itself);
     - handlers.test.ts:130, which mocks `sessions.scan` whole.

     None throws into the sessions' `cip30Address` or `readDexOrder`. splash-remnant.test.ts:280 wraps `readDexOrder` but never throws.
   - **Files that run the real scan or a real restore.** restore-scan, restore-scan-lovejoin and swap-page run the scan. accounts-restore-look, remove-wallet, remove-wallet-mix and reset-network send `restore-wallet`. None of them simulates a trap.
   - **e2e.** No trap case.
5. **Site 3's claim checks out.** run-traps-review-fixes.test.ts:261 and :277 assert `await expect(lj.withdrawDue("preprod")).rejects.toBe(trap)` with the real `withdrawDue`. That is site 3's other half, pinned. I didn't re-trace site 2. Its pump's catch hands traps on (parts.ts: `if (e instanceof WalletLocked || isTrap(e)) throw e;`), and its hooks run in the sessions' own `serial`.

## The scratch test and the mutations

The scratch test was `extension/tests/zz-review-v-pr330-0-trace-1.test.ts` (deleted). It has 6 cases on the real WebAssembly. In each, one call on the SessionService's wasm only throws `new WebAssembly.RuntimeError("unreachable")`, and `signing(t, { wasm })` comes from swap-session.ts. The trap cases:

- **A:** `cip30Address` traps (`hexOf`). The setup is restore-scan.test.ts's "finds an order still open…": `usedWith(0, [[SWAP_TX…],[FUNDING_TX…]])`, its `swapped`, and `orderRow(SWAP_TX)`. `sessions.scan("preprod")` rejects with a `RuntimeError`, and the wallet is still `unlocked`: the trap came from outside the queue, so locking is the caller's job.
- **A2:** the same, with `readDexOrder` trapping (`read`).
- **C:** `cip30Address` traps, armed only once `recoveredRecords` has returned. The order is restore-scan.test.ts's C30 SundaeSwap V3 one, with an inline datum made out to session 0 and marked spent (`t.koios.spent`), so only `liveOrders`' `dexOrder` throws (exactly 1 call). The scan rejects with a `RuntimeError`.
- **B:** `handle({ type: "restore-wallet", phrase, password })` through restore-scan.test.ts's `context`, set up as `removedWithLeftovers` plus the swap (`unlocked`, `usedWith`, `swapped`, `wallet.reset()`), with `cip30Address` trapping. `vi.waitFor` sees status `{ state: "locked", lockedBy: "trap" }`.

There are two controls:

- **C0:** C without the trap resolves `{ used: 1, found: [] }`.
- **B0:** B without the trap stays `unlocked` once `session-scan-due` reads `{ due: false, scanning: false }`.

The mutations ran in a copy outside the tree, in the scratchpad's `review/v-pr330-0-trace/`, with node_modules symlinked and the crypto vectors and core fixtures copied. The tree was untouched.

| Where | A | A2 | C | B | controls |
|---|---|---|---|---|---|
| HEAD, the tree | pass | pass | pass | pass | pass |
| copy, unmutated (with the 13 files below: 187/187) | pass | pass | pass | pass | pass |
| **M4** (2731, 2739 → `void e;`: `read`, `hexOf`) | **fail** | **fail** | pass | **fail** | pass |
| **M6** (3865 → `void e;`: `liveOrders`) | pass | pass | **fail** | pass | pass |
| **M3** (handlers.ts:166 back to `.catch(() => undefined)`) | pass | pass | pass | **fail** | pass |
| **M4 + M6** | **fail** | **fail** | **fail** | **fail** | pass |

Under M4 + M6, these 13 existing files all passed, with 181 tests: restore-scan, restore-scan-lovejoin, handlers, swap-page, accounts-restore-look, remove-wallet, remove-wallet-mix, reset-network, splash-remnant, sundae-orders, order-cancel-check, session-trap and run-traps-review-fixes. Run with `--maxWorkers=3`, the results were "Test Files 1 failed | 13 passed (14)" and "Tests 4 failed | 183 passed (187)". The 4 failures were mine.

The failures said:

- A, A2 and C: `expected { used: 1, found: [] } to be an instance of RuntimeError`.
- B: `expected { state: 'unlocked', …(4) } to match object { state: 'locked', lockedBy: 'trap' }`.

## Corrections and additions to the finding

- **`liveOrders` is unpinned too.** M4 didn't cover it, but M6 confirms nothing catches it. The scan reaches its WebAssembly only for a spent order row with an inline datum (see 2 above). Of the tests here, only C pins it.
- **"as such catches did before 1.6.0"** isn't true of these three. They carried the rethrow from the commits that wrote them, so the regression would be a new edit, not a revert. The wording is harmless.
- **The regression would do more than the finding says.** A swallowed trap in `hexOf` or `read` also drops the order from what the scan finds. It resolves `{ used: 1, found: [] }` (A and A2 under M4), and a scan that finishes clears the restore's `unscanned` mark (2674-2675). So the session with an open order isn't listed, and the dApps page's pointer to Find leftovers goes too. No money is lost: the order stays cancellable with the session's key, and a later Find leftovers looks at that index again, since `known` (2638) is only the book's sessions.
- **"Leaves the wallet unlocked" is the likely outcome, not a certain one.** The scan ends with `withKeys(pin)` (2668), which runs `keys.oneTime.keyHash(0)` inside the queue. On an instance broken badly enough for that call to trap too, `serial` locks. A panic in a free function such as `cip30Address` leaves no borrow flag on `keys.oneTime`, so that call would usually go through. #330's own rationale has the same nuance.
- **The severity stays low.** It's a missing test on a defence-in-depth path. The handler half is pinned by #330's `it.each`. No trap is known in `cip30Address` or `readDexOrder`: the deep datum that once trapped is refused unread since C06 (splash-remnant.test.ts:264).

## Fix advice

The finding's two tests are right. Put them in restore-scan.test.ts, which already has `usedWith`, `swapped`, `context`, `ask` and `removedWithLeftovers`. Two refinements:

- **B needs a transaction the key signed that pays elsewhere** (`swapped(t)` and `orderRow(SWAP_TX)`), not just session 0's stake marked used. With only a funding, `own` (2753) is empty and `cip30Address` is never called, so B can't pass on HEAD.
- **Add C for `liveOrders`:**
  - the C30 V3 order with an inline datum, with `t.koios.spent.add(`${SWAP_TX}#0`)`;
  - the trap armed after `recoveredRecords` returns (wrap the private method) or on the third `cip30Address` call;
  - expect `scan` to reject with a `RuntimeError`.

  It is the only one of these tests that fails under M6.

Counting the stub's calls (`> 0`, or `=== 1` for C) keeps a later fixture change from making a test pass without ever reaching the trap.

## Cleanup

I deleted the scratch test from `extension/tests/` and the whole mutation copy. I touched no tracked file. The other `zz-review-v-pr330-*` files in `tests/` are other agents', and I left them alone.
