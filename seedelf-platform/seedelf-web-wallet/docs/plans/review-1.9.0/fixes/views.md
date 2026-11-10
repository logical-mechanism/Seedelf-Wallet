# 1.9.0's release review: the views fixer

A fix lane, in a worktree of `8d7c4b0c`, test first. Verbatim from its structured report.

**Branch:** `review-1.9.0/fix-views`, commit `177e3666`.

**Files:** `seedelf-platform/seedelf-web-wallet/extension/src/background/tx-view.ts`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/TxDetail.tsx`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx`, `seedelf-platform/seedelf-web-wallet/extension/tests/tx-view.test.ts`, `seedelf-platform/seedelf-web-wallet/extension/tests/tx-view-screen.test.ts`

## Fixed

### L6 (dapp-ui#3), the DRep key

**What.** markYours now marks each account's DRep key, unconditionally as the brief decided. New helper drepKey() at extension/src/background/tx-view.ts:228 derives it the way dapp.ts publicKeys does: JSON.parse(cardano.drepOf()).hash. Active account: tx-view.ts:294 derives it only when the transaction has required signers, and :296 adds `|| hash === drep`. Other known accounts: :312 adds `drep` to each account's turn, derived only while signers are still unmarked, and :314 adds `|| h === theirs.drep`. Sessions have no DRep key. Nothing is asked of Koios.

**Tests.** extension/tests/tx-view.test.ts: "marks each account's DRep key as the user's, as the sign window says it is (1.9.0's release review, dapp-ui#3)". Required signers: the active account's DRep, Account 2's DRep and a stranger's key. Both DReps are marked. Without Account 2 known, only the active account's is. No Koios calls.

**Evidence.** Ran `npx vitest run tests/tx-view.test.ts -t "DRep"`, under an 8G memory cap.
- Fails before the fix: "AssertionError: expected [] to deeply equal [ …(2) ]" (the two DRep hashes 6b1ecc8b…692e and b2a7f53b…89dd).
- Passes after the fix: tx-view.test.ts "Tests 13 passed (13)".
- Mutant, active-turn branch dropped (`|| hash === drep`): "expected [ Array(1) ] to deeply equal [ …(2) ]".
- Mutant, other-account branch dropped (`|| h === theirs.drep`): same failure.
- Both mutants restored, checked with cmp against the saved fixed file.
- Cost: a throwaway probe, deleted afterwards and never committed, timed drepOf at 0.434 ms per account turn against 12.076 ms for the 40 payment key hashes the turn already derives (ratio 0.036).

### L7 (cross#1)

**What.** New `lookedUp` prop in extension/src/ui/components/TxDetail.tsx:
- declared on TxDetailButton (:60, :68) and passed on to TxDetailModal (:90);
- declared on TxDetailModal (:126, :133) and passed on to TxDetailBody (:236);
- declared on TxDetailBody (:329, :342); its inputs hint at :377 is now `site || lookedUp ? "tx.privacy.inputsHintSite" : "tx.privacy.inputsHint"`.
The signatures row still switches on `site` alone. Swaps.tsx:2696 (SessionTxReviewScreen's session-tx-detail button) passes `lookedUp={review.kind === "cancel" || pools}`, where `pools` is the component's existing `review.kind === "swap" && !!review.againstPools`. This equals sessions.ts inspect's `others.length > 0`: againstPools is `direct`, which is `kind === "swap" && others.length > 0`. A cancel always spends at least one order: cancelBuild throws sess.noOrderWaiting when there's none, and orders sit at DEX scripts, never in the session's rows. Corrected the comment at tx-view-screen.test.ts:123-124. Every other caller passes neither prop and keeps "asks nobody" (checked by grep): Withdraw, CreateSeedelf, RemoveSeedelf, Transfer, SiteSessions x2, Staking, MoveIn, Collateral, Swaps swap-out-tx, session-back-tx and cancel-collateral-tx, LovejoinLaunch, ClaimAll, Lovejoin x4 (one is a TxDetailModal), CardanoSend and DappApprovals dapp-funding-tx. DappApprovals dapp-tx still passes only `site`, so it keeps the looked-up hint and the site's signature words.

**Tests.** extension/tests/tx-view-screen.test.ts:
- :133, "says the wallet looked up its own review's inputs where it did, in its own words for the signatures (1.9.0's release review, cross#1)": TxDetailBody with lookedUp gives the looked-up hint and "Signatures 1, made while preparing it: not sent until you confirm", never "press Sign".
- :743, describe "Review it myself's Transaction details, on what the wallet looked up for it (1.9.0's release review, cross#1)", three tests: "a cancel's: …" (:811), "a swap against a DEX's pools: …" (:817) and "an order's: it spends only what the session holds, and the wallet asks nobody" (:823).
Each of the three renders the real SessionTxReviewScreen with its Transaction details opened, and reads the session-tx-detail-inputs-hint title from the body. The view is opened by a cut-down `vi.mock("react")` seam at :21-43: useState only, and a pass-through unless `opened.view` is set. It is the house's pattern from screens-wiring-review-fixes.test.ts.

**Evidence.** Before the fix, `npx vitest run tests/tx-view-screen.test.ts` gave "Tests 3 failed | 43 passed (46)":
- the TxDetailBody test failed;
- the cancel's and the pool swap's both failed with "expected 'What each one holds isn't in the tra…' to contain 'The wallet looked up the ones it does…'", which also shows the seam opened the view;
- the order swap's passed.
After the fix, tx-view.test.ts and tx-view-screen.test.ts: "Tests 59 passed (59)".
Mutants, run on the final files, one at a time, each restored and checked with cmp (the script is fix/views/mut/mutate.py, the log fix/views/mut/l7-mutants-final.log):
- m1, Swaps.tsx passes nothing: 2 failed (cancel, pools).
- m2, TxDetailButton doesn't pass it on: 2 failed.
- m3, TxDetailModal doesn't pass it on: 2 failed.
- m4, the body's hint ignores it: 3 failed.
- m5, lookedUp also switches the signatures to the site's words: 1 failed (the body test).
- m6, Swaps.tsx passes it for every review: 1 failed (the order's).
- m7, Swaps.tsx passes it for a cancel only: 1 failed (pools).

### dapp-ui#4

**What.** Test gap closed in extension/tests/tx-view.test.ts at about :151-182. The existing required-signer test now also names a session's stake key (its reward address, index 0) and Account 2's stake key, 7 signers in all. Both are expected marked. Without the session or Account 2 known, only the active account's payment and stake keys are.

**Tests.** extension/tests/tx-view.test.ts: "marks a required signer that's one of the wallet's keys, and no one else's (a bounty report against 1.8.1)"

**Evidence.** Ran `npx vitest run tests/tx-view.test.ts -t "marks a required signer"`.
- Passes on the base code: "Tests 1 passed | 11 skipped (12)".
- Mutant A, tx-view.ts:288 `|| hash === stake || sessionStakes.has(hash))` → `|| hash === stake)`: "AssertionError: expected [ …(5) ] to deeply equal [ …(6) ]".
- Mutant B, tx-view.ts:303 `|| h === theirs.stake` removed: same failure.
- Each restored with git checkout; git status showed only the test modified.

## Not fixed

- **L6 (dapp-ui#3), the other half: another account's payment keys past its first 20:** The brief scopes L6 to the DRep key. markYours checks each other account's first 20 keys of each chain. That is the rule flows.md:261 documents for outputs; only the active account adds the keys its last reading found. Marking more would need the dApp view's discovered paths (dapp.ts SESSION_DAPP_VIEW), outside this lane's files. It's a missing "you", never a false one.

## Commands

Every run was under `systemd-run --user --scope -p MemoryMax=8G`, from the worktree's extension/.
- Base: `npx vitest run tests/tx-view.test.ts tests/tx-view-screen.test.ts`: Test Files 2 passed (2), Tests 54 passed (54).
- dapp-ui#4:
  - on the base, `npx vitest run tests/tx-view.test.ts -t "marks a required signer"`: 1 passed | 11 skipped (12);
  - mutant A: 1 failed, "expected [ …(5) ] to deeply equal [ …(6) ]";
  - mutant B: 1 failed, the same;
  - restored.
- L6:
  - on the base, `npx vitest run tests/tx-view.test.ts -t "DRep"`: 1 failed | 12 skipped (13), "expected [] to deeply equal [ …(2) ]";
  - after the fix, tx-view.test.ts: 13 passed (13);
  - the active-turn mutant and the other-account mutant: each 1 failed, "expected [ Array(1) ] to deeply equal [ …(2) ]";
  - restored (cmp).
- L7:
  - on the base, `npx vitest run tests/tx-view-screen.test.ts`: 3 failed | 43 passed (46);
  - after the fix, both files: 59 passed (59);
  - mutants m1 to m7 on the final files: 2, 2, 2, 3, 1, 1 and 1 failed of 46; each restored (cmp).
- `npx tsc --noEmit -p .`: exit 0, run after the fix and again on the final files.
- 67 test files that import TxDetail, tx-view.ts or a screen that renders TxDetailButton, run through bash so the list splits:
  - among them dapp-prompt, swap-page-words, screens-wiring-review-fixes, i18n-screens, chain-in-view, direct-swaps, swap-page, screens, tx-view and tx-view-screen;
  - result: Test Files 67 passed (67), Tests 1169 passed (1169), 145 s.
- Cost probe, a throwaway tests/zz-views-drep-cost.test.ts deleted after the run: drepOf 0.434 ms against 12.076 ms for an account turn's 40 payment key hashes.
- Not run: e2e and vite build, which aren't in the views lane's run list. No e2e asserts on session-tx-detail, the inputs hint or the signer labels (grep).

## Notes for the lead

1. **L7's condition.** It is decided in the UI: `review.kind === "cancel" || pools`, which equals inspect's `others.length > 0` today. The verifier's sturdier option is for inspect to return a flag through SessionTxReview. That needs sessions.ts (the swaps lane) and rpc.ts (no lane), so it isn't done. If the swaps lane ever lets a cancel or an order swap spend something outside the session's rows, this condition has to follow.
2. **The test seam.** tx-view-screen.test.ts now holds a cut-down `vi.mock("react")`: useState only, keyed by the calling component's name, and a pass-through unless `opened.view` is set. All 43 earlier tests in the file pass under it unchanged. This was the only way, in my lane's files, to test the button → modal → body chain: no other test covers it, the `site` prop's included.
3. **Docs lane.**
   - flows.md:275 ("It asks nobody anything") and about 262 should say that the session's cancel review and its swap against a DEX's pools look up what the session doesn't hold. That's already in their brief.
   - No doc lists which signer keys Transaction details marks, so the DRep change (L6) needs no docs edit.
   - The verifier's nuance on L6 stays as the lead accepted it: a site without governance that names the DRep key now reads "Must be signed by you" in details, while the window counts that key among othersSign.
4. **A possible case of the same hint problem, outside this lane** (the verifier flagged it; I only looked, didn't trace it end to end). When a Lovejoin pool's boxes come from Koios rather than the private index, lovejoin.ts lookUp/madeBy (about 6176-6227) asks Koios's tx_info about the transactions that made them. A mix's Transaction details (lovejoin-tx, Lovejoin.tsx) passes no prop, so it says "the wallet asks nobody". The fix would be `lookedUp` on that button, under the right condition, in lovejoin.ts and Lovejoin.tsx.
5. **Cost (cross#2).** L6 adds about 0.43 ms per account turn when the transaction has signers that are still unmarked, 3.6% on top of that turn's 40 payment key derivations, so cross#2's backlog line stands as it is.
6. **The worktree.** The node_modules symlink is unlinked, and wasm/pkg is a copy, ignored by git. The worktree is clean at 177e3666. The main tree is untouched at 8d7c4b0c.

