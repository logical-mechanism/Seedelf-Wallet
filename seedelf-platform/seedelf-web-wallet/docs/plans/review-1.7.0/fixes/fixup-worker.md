# Fix-up lane: the worker lens of the review of the merged fixes

Tree: `W` = `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-wt/release-1.7.0`, branch `web-wallet/release-1.7.0-fixes`. Paths below start at `W/seedelf-platform/seedelf-web-wallet/`.

Both findings are fixed, test first. Each new test failed on the merged tree for the reason its finding gives, and passes now. Ids are 0-indexed, as the lanes' ids are: **worker#0** is Bring everything back's Send, **worker#1** is the public mix. The docs lane already uses worker#0 for `claimSubmit` in `docs/post-release-roadmap.md:390`.

## worker#0: Bring everything back's Send swallowed a trap from a chain's sending (fixed)

- **Fix:** `extension/src/background/sessions.ts:3206-3212`, `claimSubmit`'s catch now starts with `if (isTrap(e)) throw e;`, as `claimBuild`'s catch does. The request locks as `answerUi` answers it (sw.ts), no other session's return goes out on the broken instance, and the lock cuts the chain (CHAIN_CUT). Its JSDoc now ends "One that fails doesn't stop the rest; a trap does."
- **Reached for real:** with Send's budget of 0, through `witnessTail` → `lovejoin.tailWitness`, which calls `wasm.declaredCovers` and `wasm.finishLovejoinWithdraw` directly, outside `withKeys`. `claimSubmit` was the only caller of `sendBack` that swallowed a trap. `backSubmit` has no catch, and `bringBack` reaches a step's catch, which locks.
- **Test:** `extension/tests/session-trap.test.ts:115`, "ends Bring everything back's Send with a trap in a chain's sending, sends no other return on it, and the lock cuts that chain". It sits beside "ends Bring everything back with the trap itself".
  - Setup: `twoSites`, then `claimBuild`. `t.lovejoin.chainSent` rejects once with `WebAssembly.RuntimeError` as the stand-in trap.
  - It expects `claimSubmit` to reject with the trap, and checks that no transaction of session 1's return was submitted. Here that return comes back directly, because session 0's chain holds the pool's boxes.
  - It then calls `t.wallet.trapped()` as `answerUi` does, unlocks and runs `runAll`. Session 0's chain must read `stopped: CHAIN_CUT()`, on the session and in Lovejoin's record.
  - **Before the fix** it failed: `claimSubmit` resolved with `{ sent: [{ index: 1, … }], failed: [{ index: 0, error: "unreachable" }] }`.
- **UI:** `ClaimAll.tsx` is unchanged. Its `send()` already shows a rejected request's message, here WASM_BROKEN's, and the wallet locks. The answer listing what was sent is lost when it locks, the same trade-off `claimBuild` makes. Returns sent before the trap are recorded on their sessions, and their history is written (`sendRecorded`, `noteLanded`).

## worker#1: a public mix's chain recorded a trap's raw word as why it stopped (fixed)

- **Fix:** `extension/src/background/lovejoin.ts:4825-4830`, `pumpPublicNow`'s catch now starts with `if (isTrap(e)) throw e;`, before the `ChainGone` branch. It's the same rule as sessions' `pump`, so nothing is recorded, released or saved for a trap.
  - Every caller locks for it: runs.ts (`unlessTrap`), the Lovejoin page's progress (`unlessTrap`, then `answerUi`) and `publicSubmit` (`answerUi`). No `unawaited` run in handlers.ts reaches `pumpPublic`.
  - The lock wipes the progress and the reservation (both in session storage). The next look marks the chain cut (`cuts`), and its first transaction's sealed mark, if any, is kept. That's the same as a lock at that moment.
- **Test:** `extension/tests/session-trap.test.ts:220`, "locks it when a mix from the public account traps as the alarm sends more of it, the chain cut by the lock, not stopped for the trap's raw word". It's in the x-merge#1 block and reuses `alarmRun` and `trap`.
  - Steps: `publicFunded`, `publicBuild`, `publicSubmit` (its first window), then `watchOf` rejecting with the trap and the alarm's run.
  - It expects the wallet locked with lockReason `trap`. After unlock, `status().chains` must match `[{ stopped: CHAIN_CUT() }]`, and so must `progress()`.
  - **Before the fix** it failed: the record read `stopped: "unreachable"`.

## Also changed

- **`docs/architecture.md:53`, the x-merge#1 sentence only.** The docs lane's report left "the worker review's two notes" in this bullet to this lane. The sentence now names "a chain's sending (a session's `pump`, a public mix's `pumpPublic`)" and adds "(…; its review of the fixes, worker#1). So does Bring everything back's Send (`claimSubmit`), as its build does: no other session's return goes out on the broken instance (worker#0)." I checked every claim in that bullet against the code: it's true now, the public mix's progress included.

## For the record

- **Strings added or changed:** none. **Critical keys changed:** none. **e2e specs edited:** none. **WebAssembly node tests added:** none. **Rust:** none.
- **Data handling:** no change, so no privacy policy *Changes* entry is needed.
- **Owner's calls:** none. Neither fix adds a guard: each hands a trap on to the lock that already exists.
- **For the docs lanes:**
  - `docs/post-release-roadmap.md:390` already says Bring everything back's Send locks on a trap (worker#0), and that's true now.
  - The same line's "a chain a trap stopped reads as cut by the lock" is now true for a public mix's chain too. Nothing else needs to change.
- **Files changed:**
  - `extension/src/background/sessions.ts` (`claimSubmit`'s catch and its JSDoc)
  - `extension/src/background/lovejoin.ts` (`pumpPublicNow`'s catch)
  - `extension/tests/session-trap.test.ts` (two tests; imports `publicFunded` and `txIdOf`)
  - `docs/architecture.md:53`
- **Scratch:** one scratch test, `extension/tests/zz-fixup-worker-1.test.ts`, showed that session 1's return comes back directly. It's deleted, and no scratch file of mine is left in `W`.

## What I ran (on `W`, one file at a time)

- **`session-trap`:** 9 of 9 pass, three runs in a row. Before the fixes, its two new tests failed as described above.
- **Pass:** sessions 61, parts-send-review-fixes 38, chain-lock 3, chain-record 6, chain-in-view 6, chain-resend 7, chain-requests 6, run-traps-review-fixes 14, runs 6, lovejoin 92, home-review-fixes 8, lovejoin-crediting-review-fixes 17, lovejoin-accounts 5, lovejoin-flows 33, lovejoin-token-feed 6, lovejoin-release-rules 18, lovejoin-planner 88, handlers 21, sessions-review-fixes 25, collateral-held 7, words 2.
- **Public mix and pending suites, pass:**
  - public-mix: pump 2, stopped-runs 3, maybe 5, maybe-hold 3, look 3, busy-mark 3, reached 1, mark 4, start 2, unsure 5, race 5
  - pending: watch-busy 2, activity 4, alarm 3
  - resend-send-time 2, unseen-send-time 4, unlock-resend 5, unlock-waits 17, remove-wallet-mix 4, worker-words 19
- **`lovejoin-1-5-0`:** 1 of 4 fails, as known from the release prep (the bundled mainnet 5 ₳ pool, `dc6abe3b…`). It isn't mine.
- **`lovejoin-merged-review`:** 1 of 42 failed in my first run. Another fixer edited the file at 21:31, during that run (the reviewer saw 41 tests), so it was their test-first step. It passed 42 of 42 in three runs since. It isn't mine.
- **`npm run typecheck`:** clean.
