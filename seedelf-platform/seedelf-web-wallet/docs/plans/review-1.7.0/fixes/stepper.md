# Lane "stepper": #335's Transaction details stepper

Worktree `W = /home/logic/Documents/LogicalMechanism/Seedelf-Wallet-wt/release-1.7.0`, branch `web-wallet/release-1.7.0-fixes`. Paths below are under `W/seedelf-platform/seedelf-web-wallet/extension/`.

## Outcomes

| ID | Severity | Outcome | Summary |
|---|---|---|---|
| pr335#0 | low | **fixed** | The stepper's index is clamped to the parts it has (`at`), and the arrows step from `at`. TxDetailButton keys its view by the review's first hash, so a review built again in place opens on its first transaction. |
| pr335#2 | low | **fixed** (test only) | Five wiring tests: each review in parts hands Transaction details its own `parts`. |
| x-mut-ts#5 | low | **fixed** (test only) | Same five tests as pr335#2. |
| x-mut-ts#6 | low | **fixed** (test only) | A seam test with effects running: the step asks for the next part, and nothing of the last one's shows under it. |
| pr335#3 | nit (verifier: low) | **fixed** | Component: each answer is tied to the hash it was asked for. e2e: the second part's own read is checked before "Pays" and the error check. |
| pr335#4 | nit (verifier: low) | **owner-call** | Focus drops to `<body>` when an arrow disables itself. The box stepper does the same, and the finding defers it to the owner. |
| pr335#5 | nit | **deferred** | Verified by the trace verifier. The finding itself says no release fix is needed. |
| x-scen#8 | nit (UNVERIFIED) | **deferred** | Reproduced. Left as is, the finding's own first option: the kept parts can't go from that review any more. |
| x-upgrade#1 | low (UNVERIFIED) | **partly** | Reproduced. parts.ts's header is corrected. The fix itself, a sealed progress record, is the owner's call. |

## Each finding

### pr335#0: fixed

- **Change (`src/ui/components/TxDetail.tsx`):**
  - `const at = many ? Math.min(shown, many.length - 1) : 0;` is used for the hash, the label and both ends.
  - Previous and Next call `setShown(at ∓ 1)`, not `setShown((i) => i ∓ 1)`, so the first press after a shrink isn't dead (the trace verifier's fix_advice).
  - `<TxDetailModal key={txHash} …/>` in TxDetailButton: a review built again in place has a new first hash, since each build signs with a new one-time key, so its view starts afresh on its first.
- **Tests:** `tests/screens-wiring-review-fixes.test.ts` › *Transaction details' stepper, through a payment's parts*:
  - "never stands past its last part…": before, `Transaction 3 of 2` over the first's id, with Next enabled. Now `Transaction 2 of 2`, the second's id, Next off.
  - "steps back from there to the one before it…": before, a Previous press from past the end still read `Transaction 2 of 2`. Now `1 of 2` and the first's id.
  - "opens a review built again on its first transaction…": before, the key was `undefined`. Now it's the first's hash. This test also covers TxDetailButton's own `parts.map(p => p.txHash)`, which only the e2e covered.
- Each failed on HEAD for the finding's reason, and passes now.

### pr335#2 and x-mut-ts#5: fixed (tests)

- **Tests:** `tests/screens-wiring-review-fixes.test.ts` › *Transaction details for every part, handed on by each review in parts*.
  - Cases: Send privately, Make public, a swap's funding, a mix into Lovejoin from the private balance, a site's funding.
  - Each seeds its review over the seam, captures TxDetailButton's props by testId, and expects `{ txHash, parts }` to equal the summary's.
- They pass on HEAD, which wires all five correctly. There's no code defect: these are the missing guard.
- **Mutation check** (in a copy outside the tree):
  - Dropping `parts=` on Transfer, Withdraw, Swaps:935, Lovejoin:3075 or DappApprovals:772 fails exactly that case. Every pre-existing test stays green, which confirms x-mut-ts#5's claim.
  - Passing the wrong array (`review.parts?.slice(1)`) fails too, so this covers the impact verifier's "wrong array" gap that a source scan would miss.

### x-mut-ts#6: fixed (test)

- **Claim verified:** on HEAD's TxDetail with `setView(undefined); setError(undefined);` removed, all 88 pre-existing tests that import TxDetail pass:
  - tx-view-screen 40
  - chain-in-view 6
  - i18n-screens 14
  - the wiring file as on HEAD, 28
- **Test:** "asks for the next as it steps, and shows nothing of the last one's under it meanwhile, not for one render (pr335#3, x-mut-ts#6)".
  - It runs TxDetailModal's effects over the seam: the first part's read answers, the second's never does. Next is pressed once the first's view is in.
  - It expects: both reads asked, `Transaction 2 of 2`, the second's id, the loading note, Next off.
  - It also records every render's label, id and body: the first's view only under `1 of 2`, nothing of it under `2 of 2`.
- **Mutations it catches:**
  - the view not tied to its hash (the new code's form of removing the clear);
  - the effect keyed on `txHash`;
  - Next left on at the end.

### pr335#3: fixed

- **Component (`TxDetail.tsx`):** `view` and `error` are now one state, `read = { of, view?, error? }`.
  - What shows is derived: `read?.of === hash ? read.view : undefined`.
  - Another part, or a txHash or parts change, shows nothing of the last answer, not even in the commit before the effect runs.
  - The effect no longer clears anything. `gone` still drops a late answer.
- **Test:** the same test as x-mut-ts#6. On HEAD, one render showed the first's id and body under `Transaction 2 of 2`, which is the finding's one-frame mismatch. Now none does.
- **e2e (`e2e/extension.spec.ts`, the withdraw-in-parts test, ~2667):** after Next, the order is now:
  1. the label, and the id isn't `first`;
  2. `withdraw-tx-loading` has count 0;
  3. the error has count 0;
  4. "Pays";
  5. Next disabled.
- That ties the error and "Pays" checks to part 2's own read, with or without the component fix. **Not run here: the lead runs it.**

### pr335#4: owner-call

- Confirmed by its verifier.
- Recommendation: on an arrow press that reaches an end, move focus to the other arrow (a ref plus `.focus()`, keeping native `disabled`). Do the same in Lovejoin's box stepper (Lovejoin.tsx ~3232) so the two stay alike. It isn't a release blocker.

### pr335#5: deferred

- The trace verifier confirmed it: the window opens at part 1's take, when `submitWatched` removes the first's record, the only one with `partHashes`.
- No change. The advice "Review it again" is right after a partial failure. During Send, Back is disabled and a successful Send replaces the review.
- The finding's optional idea, disabling the chip while its review sends, is a small UX choice for later.

### x-scen#8: deferred (verified)

- **Scratch reproduction** (deleted): Max over 41 UTxOs, two parts, Koios refuses part 2 at Send.
  - Send says "1 of 2 transactions went. The rest didn't: … Review what's left again."
  - Part 2 is still kept under `seedelf.transfer.built.1`, and the first's record is gone.
  - `txView` says NOT_HELD for both parts.
- Send pressed again refuses as sent already (`send` → `refuseSent`), so those kept parts can never go from this review.
- Showing them would present transactions that never go. The view's "Review it again" matches `worker.parts.partly`. Left as is, per the finding's first option.

### x-upgrade#1: partly

- **Scratch reproduction** (deleted): wallet A's shape (12 bundles: two parts, the second waits on the first's carry), Send, Koios answers part 1.
  - **Before the wipe:** Home hears `parts {sent:1,total:2}`, "Private payment not confirmed yet 1 more to go, once the one before lands." `maybeSent.preprod` is already unsealed (undefined).
  - **The wipe:** `wallet.lock()` (session storage wiped, as by an update or a closed browser), unlock, then a restarted worker's services over the same storage.
  - **After:** `pending-tx` is `null`. After part 1 lands, `pump` returns false, `pending-tx` is still `null`, and only 1 transaction was ever submitted. Confirmed as filed.
- **Changed (`src/background/parts.ts` header, comment only):**
  - A lock, a closed browser or an update wipes what waits. Only the lock gets the countdown's warning.
  - The watched part's progress is sealed only while it may still go through (until Koios takes it, or it's settled).
  - Once Koios took it, nothing says the rest didn't go after a wipe.
- **Not built:** the finding's code fix, which it leaves to the owner (see Owner's calls).
- Nothing in 1.7.0 can recover a 1.6.0 payment cut by this update. 1.6.0 left no durable trace: the history entry keeps no `partHashes`, and Koios had unsealed the watched part.

## Strings and keys

- No UI string was added or changed. No locale file or provenance file was touched.
- **Critical keys changed:** none.

## e2e specs edited

- `e2e/extension.spec.ts`, test "withdraw: more UTxOs than one transaction spends go as several, said on the review…" (the stepper block after Next). **Not run here: the lead runs it.**

## WebAssembly node tests added

- None. No Rust changes.

## Tests run (one file at a time)

- `screens-wiring-review-fixes`: 38/38, with my 9 new tests and another lane's pr333#1 test.
- `tx-view-screen` 40, `chain-in-view` 6, `i18n-screens` 14.
- `words` 2, `i18n` 24, `i18n-critical-helpers` 62, `i18n-assembly` 17, `import-boundaries` 6, `ui-safety` 15, `date-locale` 3, `hide-balances-forms` 2.
- `parts-send-review-fixes` 38.
- `npm run typecheck`: clean after my changes. A later run showed errors only in another lane's in-progress Lovejoin pool-discovery change, none in my files:
  - `lovejoin-pools.ts`: `checking` unused;
  - `sw.ts`, and five lovejoin and wasm review tests: `DiscoveryDeps.wallet` missing.

## Test harness change

- In `tests/screens-wiring-review-fixes.test.ts`, the seam's `on(match, act)` now also hands `act` the element's key, the JSX runtime's third argument. It's backwards compatible: every existing `on` ignores it. It's what lets the key test see `key={txHash}`.

## For the docs lanes

- **`docs/flows.md:371`** says "That holds after a lock too: the part Home watches keeps how far the payment went, sealed with it, so once it lands after an unlock it reads '… only partly sent'". That's true only while that part may still go through (Koios didn't answer it). Once Koios took it, a lock, a closed browser or an update leaves Home saying nothing, and the rest never go (x-upgrade#1).
- **`docs/architecture.md:173`:**
  - "A lock wipes session storage" should be "a lock, a closed browser or an update".
  - "carries `parts: {sent, total}` on its watch record, written ahead and sealed" should say it's sealed only until Koios takes it.
  - The `pending-tx` "locked" cut works only for a watch that survived the wipe, which only a maybe-sent one does.
- **`docs/privacy.md:135`:** "A lock wipes them, and the rest never go" should be "a lock, a closed browser or an update". Only the lock is warned of first.
- **Optional, for the Transaction details stepper:**
  - A view opened under a review that's built again in place starts again at the new review's first transaction.
  - The stepper never stands past the last part.
  - Nothing of one part shows while the next is being read.
  - No doc describes the stepper in that detail today: only `post-release-roadmap.md` item 7 names it.
- No privacy-policy *Changes* entry is needed for this lane's changes: no data handling changed. x-upgrade#1's sealed record would need one if the owner builds it.

## Owner's calls

- **pr335#4:** recommend fixing both steppers alike later: on reaching an end, focus the other arrow. Not a blocker.
- **x-upgrade#1:** recommend building the finding's sealed record in a follow-up (1.7.x), with its privacy-policy *Changes* entry, since it's a new record on the device:
  - Seal `{first, sent, total, at}` with `holdWaiting`, and remove it when the last part goes or the parts stop.
  - `pending-tx` answers `parts {sent, total, stopped: "locked"}` from it when neither the watch nor the parts' record has the payment.
  - It can't help this 1.6.0 → 1.7.0 update's own cases.
  - Holding Chrome's update while parts wait (`runtime.onUpdateAvailable`) is an untested alternative for later updates only.
