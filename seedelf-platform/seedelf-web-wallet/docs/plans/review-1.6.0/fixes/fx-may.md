# Fixer `fx-may`: the collateral's mix said where it may go, before the funding lands and after a failed read

Findings 1 and 2 of [review/last-3d.md](../review/last-3d.md). Both are lows, and both are a missing warning under fx-promise's one rule ([fx-promise.md](fx-promise.md): `ifLeft` wherever a 5 ₳ pool may take the collateral). **No new words:** each screen already says `ifLeft` in its own words, so no locale, provenance or e2e file is touched.

- **Worker:** `sessions.ts`:
  - `stopCost`: `landing`;
  - `tailReserve`: returns `{ reserve, may }`;
  - `outBuild`, `siteOutBuild`, `mixFunding`, `topUpBuild`.
- **Lovejoin:** `lovejoin.ts`: `collateralPool` takes `tell`. Its default is off, which behaves as before.
- **Not changed:** no screen, no string, no Rust, no WebAssembly. Nothing waits for a rebuild.

## Findings

| id | status | change |
|---|---|---|
| last-3d 1 | fixed | **While the funding is on its way, `stopCost` counts the account as the funding will leave it.** `landing` is `fundingState(s, rows).state === "funding"`, the page's own *funding* stage. The account then holds its 5 ₳ collateral and, for an ADA swap, ADA alone beside it. So `mayMix = (holds the 5 ₳ ∨ landing) ∧ (spare > 0 ∨ out ∨ (landing ∧ adaIn)) ∧ …`, as the finding suggested.<br>**A token's funding** is the token beside all the ADA, so nothing is said, as once it lands.<br>**The box count is unchanged.** With nothing seen it counts `funded`, which leaves the reserve out. |
| last-3d 2 | fixed | **`tailReserve` now tells "no pool takes it" from "the read failed".** It asks `collateralPool` with `tell`, so a failed split is thrown rather than answered as none. On that failure it returns `{ reserve: 0n, may: true }`, unless `collateralPoolTakes` says "no" (the quote's and Stop's rule). A trap is still handed on.<br>**The funding still goes without the reserve.**<br>**The four fundings** (`outBuild`, `mixFunding`, `siteOutBuild`, `topUpBuild`) set `collateralMix: "ifLeft"` on `may`. `outBuild` still sets nothing where `tailUnpaid` holds.<br>**The screens:** the approval, the Mix review, FundingWayBack and TopUpCollateralNote follow with their existing words. |

**Why `fundingState` rather than the finding's `!s.txs.some(out ∧ confirmed)`:**
- **A funding in parts:** its first part carries the collateral beside the most it can pay (core's `sweep_most_with`, wasm's `build_withdraw_parts`).
  - With part 1 on chain and part 2 on its way, the finding's test says "landed". The account's last reading may still be from before part 1 landed, so nothing would be said.
  - `fundingState` says *funding*, as the page does.
- **A part found missed** makes the funding `short` or `never`. Stop's reading of the account then decides, as before.
- **A single transaction** gets the same answer from both tests, and a funding found failed isn't offered Stop (stage `failed`).

**Why `collateralPoolTakes` after a failed read, not always `may`:** it is the rule the quote and Stop already use, as the wallet last read the pool, asking nobody. So all three agree:
- no 5 ₳ pool shown, or one that took no new box when last measured: none;
- the data layer's last count under the floor: none;
- a pool read within `POOL_ROOM_MS` showing too few others or free boxes: none;
- otherwise: a maybe.

## Tests, fail-before, and mutation checks

**How they ran:**
- Each test was written first and run on today's code (`fx-may-failbefore.log` in the scratchpad), then run again after the fix (`fx-may-after.log`).
- For each mutation, one hunk was undone with Edit, the tests rerun, and the hunk put back with Edit (`fx-may-mut-*.log`).
- A grep afterwards found every hunk in place.

**Worker and screens, real WebAssembly** (`tests/collateral-reserve-review-fixes.test.ts`):
- **Where:** inside fx-promise's describe, whose helpers they share: `stopped`, `at`, `boxPrice`, `approval`, `read`.
- **Setup:** preprod's 5 ₳ pool with two strangers' boxes, and the classic pool.

| test | fail-before | mutation → failure |
|---|---|---|
| "Stop, pressed while its funding is on its way: says its collateral's mix as once that funding lands, the account counted as it will leave it (fx-may; last-3d, 1)" | `8000000: expected { boxes: +0, mixes: +0, …(5) } to match object { boxes: +0, collateralMix: 'mixed' }` | M1, `landing` dropped from `mayMix`: same<br>M1c, `landing ∧ adaIn` widened to `landing` (a token's funding counted as ADA alone): `expected 'mixed' to be undefined` |
| "a swap's review whose read of the 5 ₳ pool fails: funded without the reserve, its collateral mixed only if enough is left, as its quote and Stop have it (fx-may; last-3d, 2)" | `expected 'MI You pay 0.0005 MIN ₳ You receive ≈…' to contain 'Its 5 ₳ collateral is mixed only if e…'` | M2, a failed read gives no `may`: same<br>M2b, `may` on every failed read: `expected 'ifLeft' to be undefined` at :1049, the pool last read as taking none<br>M2d, `outBuild` without `may`: same as fail-before<br>M2e, `outBuild`'s `may` without `!tailUnpaid`: `expected 'ifLeft' to be undefined` at :1054, against Danogo's pools |
| "a mix's, a site's funding's and a top-up's review whose read of the 5 ₳ pool fails: funded without the reserve, mixed only if enough is left (fx-may; last-3d, 2)" | `expected 'First, a one-time account is funded T…' to contain 'Its 5 ₳ collateral is mixed only if e…'` | M2: same<br>M2g, `mixFunding` without `may`: same<br>M2f, `siteOutBuild` without it: `expected 'Later, to bring it back Its network f…' to contain 'only if enough is left'`<br>M2h, `topUpBuild` without it: `expected 'The account has no collateral left, s…' to contain 'only if enough is left'` |

**The look's contract** (`tests/run-traps-review-fixes.test.ts`, L3's describe):

| test | fail-before | mutation → failure |
|---|---|---|
| "tells a funding's look at the 5 ₳ pool a read that fails, rather than answer none, a trap handed on as ever (1.6.0's review of the fixes, fx-may; last-3d, 2)" | `promise resolved "undefined" instead of rejecting`. Its trap half passed before: it pins behaviour that was already right. | M2c, `tell` ignored: same, and both funding tests above fail as in M2 |

The site and top-up halves of the third test come after the mix's, so their own fail-before shows through M2f and M2h: each undoes exactly that hunk.

**What the tests also show:**
- **Stop while the funding is on its way:**
  - **Funded with the reserve** (0 boxes at 8 ₳, and 2 boxes): `mixed`. The dialog shows giveme.my's line and never "less the return's network fee".
  - **Once the funding lands:** the same answer, and `backBuild` builds the collateral's tail.
  - **Unreserved:** `ifLeft`, with the conditional line.
  - **Nothing said:** a token's funding, Settings' switch off, or the pool taking none (one stranger's box).
- **A swap's review with every read naming the 5 ₳ pool's `mix_box` failing** (Koios 504):
  - **The quote:** `ifLeft` and a maybe; Max keeps the reserve aside.
  - **The approval:** no reserve, no cost row, the conditional line.
  - **Its return after the fill** builds the collateral's tail, from the order's change (1.84 ₳), the fill's 6 ₳ and the 5 ₳. So the line is owed.
  - **ADA→MIN:** the same.
  - **Nothing said:** the pool last read as taking none; a swap against Danogo's pools with no box (R3-10); Settings' switch off.
- **A mix whose collateral's look alone fails:**
  - The mix's own pool read goes through, as when Koios answers one request and times out on the next.
  - No reserve; the conditional line on its review.
- **A site's funding and a top-up:** no reserve; the conditional line in each one's own words.

**Existing tests:**
- `stopped()`, fx-promise's helper, gains `landing` (its funding unconfirmed, nothing at the account) and also returns the fakes.
- No expectation moved.

## Files touched

- `extension/src/background/sessions.ts`: `stopCost`, `tailReserve` (its return type and doc), `outBuild`, `siteOutBuild`, `mixFunding`, `topUpBuild`.
- `extension/src/background/lovejoin.ts`: `collateralPool` (`tell`, and its doc). One anchored edit.
- `extension/tests/collateral-reserve-review-fixes.test.ts`:
  - imports: `vi`, `SwapLovejoin`, `StopDialog`;
  - `stopped()`'s `landing`;
  - three tests and the `dialog` and `fiveDown` helpers.
- `extension/tests/run-traps-review-fixes.test.ts`: one test.

## Keys

None added or changed, critical or not. The locales and the provenance files are untouched.

## Docs to update

1. **flows.md:480 (Stop):**
   - **Pressed while the swap's funding is still on its way,** the dialog says of the collateral what it says once that funding lands. The account is counted as the funding will leave it: its 5 ₳ and, for an ADA swap, ADA alone.
     - Mixed where the funding paid that mix.
     - Only if enough is left where it didn't.
     - Nothing for a token's funding, which is the token beside all the ADA.
   - **The boxes** are counted on the funding, as before.
2. **flows.md:469 (Review the swap):**
   - **A review whose read of the pool of 5 ₳ boxes fails** (Koios not answering it) funds without the 1.5 ₳, as before, with no cost row. Its line says the 5 ₳ is mixed only if enough is left, since the return reads that pool again.
   - **Unless** the wallet's last read of that pool says it takes none.
   - **Against Danogo's pools with no box (R3-10):** nothing, as before.
3. **flows.md:490 and :494 (a site's funding, Top up):** the notes say "only if enough is left" where that read failed too, the funding going without the reserve.
4. **flows.md:514 (a mix from the private balance):** a mix's review, and Mix my boxes again's, say the conditional line where their read of that pool failed too. The funding then goes without the 1.5 ₳.
5. **architecture.md:633 (the collateral's mix):**
   - **`LovejoinService.collateralPool(…, tell)`:** with `tell`, a read that fails is thrown, for a funding's look. Without it, as a return asks, it's none, as before.
   - **`tailReserve`** returns `{ reserve, may }`. `may` holds where its look failed (not a trap) and `collateralPoolTakes` isn't "no".
     - The funding goes without the reserve.
     - `outBuild` (not where `tailUnpaid` holds), `mixFunding`, `siteOutBuild` and `topUpBuild` set `collateralMix: "ifLeft"` on `may`.
   - **`stopCost`'s `mayMix`:** "the account holds it, and ADA alone or a swap out that may bring some" gains a third case. While its funding is on its way (`fundingState` `funding`), the account is counted as that funding will leave it: its 5 ₳, and ADA alone for an ADA swap.
6. **privacy.md:217:**
   - **"Wherever else a pool may take it… one line says it's mixed only if enough is left"** now also covers a review whose read of that pool failed. The funding goes without the reserve, unless the wallet's last read says the pool takes none.
   - **"Stop's dialog where nothing out can merge it"** now holds from the moment the funding is sent, not only once it lands.
7. **privacy.md:121** ("where the collateral may be mixed as the review reads the pool"):
   - a read that fails counts as a maybe, said in the hedged line;
   - Stop's dialog says it while the funding is on its way too.
8. **The privacy policy: no change.** Nothing new leaves the device:
   - `collateralPoolTakes` asks nobody (`known` and `facts` make no request);
   - Stop's dialog makes no new request;
   - a failed read sends nothing more.
9. **OWNER-CALLS.md and the chunk 34 plan:** add the calls below.

## Calls the owner might overturn

1. **A failed read at Review funds without the reserve,** even where the private balance would pay it.
   - **Why:** the lead's brief, and L3's rule ("a look that fails funds without the reserve").
   - **What the quote did:** its Max had kept the reserve aside on the same maybe, the private default there.
   - **To overturn:** fund with the reserve on `may`.
     - That mix is then paid for whatever's left: 1.5 ₳, or 2.8 ₳ for a site's.
     - That amount comes back with the change if the mix doesn't go.
     - It's the more private default by the owner's rule.
2. **A failed read is a maybe unless what the wallet last read says the pool takes none** (`collateralPoolTakes`), so the fundings agree with the quote and Stop.
   - **To overturn:** always `may` on a failed read, the finding's literal wording.
3. **Stop counts a funding as on its way while the page shows it so** (`fundingState`), a funding in parts included.
   - **The edge it doesn't guard:** a funding in parts whose first part (the collateral's) was found missed while a later part may still land would be said to bring the 5 ₳.
   - **Why that's unguarded:** it's unreachable in practice.
     - Parts sent together share their clock, so they're found missed together.
     - A part held for the one before never goes after that one is missed.
   - It isn't tested.

## Notes for the lead

- **No test needs the pkg rebuilt.**
- **`collateralPool`'s default is unchanged** (`tell = false`). `buildBack`'s `intoPool` and L3's test still read none on a failed read.
- **The 1.5.0 gate** (`tests/lovejoin-1-5-0.test.ts`) passes unedited.
- **e2e: no expectation changes.** Its Stop step runs after the funding landed and reads "If no order has gone out yet, none will", which every variant keeps.
- **`i18n.test.ts`'s two es/ja gates fail** in the wide run. These are the unchecked machine drafts the translation round clears; no string of mine is among them.
- **Visual check (optional),** on preprod with the 5 ₳ pool holding two strangers' boxes:
  1. Start an ADA→MIN swap that pays the reserve, and press Stop at once, while the page still shows the funding.
  2. The dialog should read "…everything but its 5 ₳ collateral comes back to your private balance, less network fees; the 5 ₳ comes back later, mixed once.", followed by giveme.my's line.
  - A failed read can't be made by hand.

## Checks

- **Baseline before any edit:** `collateral-reserve-review-fixes` and `run-traps-review-fixes`, 40 of 40.
- **Fail-before:** the four new tests failed as in the tables.
- **After the fix:** the same two files, 44 of 44, on both the default build and `VITE_ENABLE_MAINNET=false`.
- **The touched-area set:** 34 files.
  - **Which:** every test file that calls `stopCost`, `outBuild`, `siteOutBuild`, `topUpBuild`, `mixOutBuild`, `againBuild` or `collateralPool`, plus `approvals-review-fixes`, `screens`, `swap-page-words` and `dapp-prompt`.
  - **Results:** 849 of 849 on the default build, and 849 of 849 on preprod.
- **The wide set:** fx-promise's 139 files, on the default build.
  - 1873 passed, 2 skipped, 2 failed.
  - The two failures are the i18n gates above.
- **`npm run typecheck`:** clean (exit 0).
- **Mutations:** M1, M1c, M2, M2b, M2c, M2d, M2e, M2f, M2g, M2h. Each failed its test and was put back with Edit.
- **Not run (the brief):** e2e, builds, cargo, `--write`, a formatter.
- **Scratch files:** `fx-may-*` in the scratchpad. They hold the baseline, fail-before, after, mutation, typecheck and wide-run logs, and the file lists.
