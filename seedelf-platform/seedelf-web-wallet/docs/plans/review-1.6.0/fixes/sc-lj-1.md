# Fixer `sc-lj-1`: the Mix forms and their reviews (round 2, lane S1)

The Mix form now counts the collateral's mix reserve the worker adds, keeps it aside in the stepper, and says the 5 ₳ comes back later as a box. The public side's cap counts only the ADA its chain spends. Mix my boxes again's switch shows the width its review is at. The private mix reviews say giveme.my sees the collateral's mix. A Bootstrap of one box is said in the singular. All in `ui/screens/Lovejoin.tsx`, with no worker or Rust change. Every test runs on today's pkg: nothing waits for a rebuild.

## Findings

| id | status | change |
|---|---|---|
| 320-screens#2 | fixed | `tailReserveOf(funding, source, pools)` counts lovejoin-funding's `collateralReserve` on the private side while the pool `collateralPool` names has, in the page's own status read, `others >= floor`, `free >= 2` and no `unusable` (the worker's collateralPool rule). `mixCosts(…, tail)` puts it into *Into a one-time account* (with a part row *For its collateral's mix*, the review's words) and the total. The cost section gains *Its collateral's mix, about* (sc-o-1's `COLLATERAL_MIX_COST`: deposit 0.25 + mix 0.95 + its box's way back 0.3 ₳), so the rows still add up. The cantAfford figure includes it. `PoolPage` takes a new `pools` prop from the hub. |
| 321-lj-screens#3 | fixed | The same change. |
| 323-worker#0 (Lovejoin's form half) | fixed | `mixMost(…, tail)` keeps the reserve aside on the private side, and `FEE_ROOM` is now 2 ₳: the funding's fee (~0.25 ₳) plus its change's least (a Seedelf output's, 1.46 ₳ at 4,310 lovelace a byte). The old 1 ₳ covered the fee alone. sc-o-1 made the same change to the swap form's `FEE_ROOM`. `FEE_ROOM` is shared with `bootstrapLimits`, so the Bootstrap form's shortfall moved by 1 ₳ too. Its test was updated. |
| 321-lj-screens#4 | fixed (the tail case only, as asked) | Where the reserve is counted, *Comes back once it's mixed* leaves the 5 ₳ out. A row under *Back later* says *Its 5 ₳ collateral: The box, about 4.7 ₳ once brought back, after 1 to 6 hours*. Without a 5 ₳ pool the figures are byte-identical to before (Session 10's call 2 still covers that case). |
| 321-lj-screens#1 | fixed | `publicMixAda(utxos, token?)` sums the public account's spendable UTxOs of ADA alone, plus, in a token pool, those holding the pool's token. It leaves out the collateral, locked UTxOs, reference-script UTxOs, ADA held with other tokens and the staking rewards. That is WebAssembly's `buildLovejoinFromAccount` rule. The page reads the existing `utxos` RPC (the last reading, no new request) when the public side is chosen and at each new reading Home hands down. The stepper, `HeldOnSide` and `cantAffordPublic` use that figure; without the list (none yet, or a reading too large to keep) they use Home's figure, as before. |
| 320-screens#4 | fixed | The review's switch is `AgainSwitch`, which shows the width the review was built at (`summary.mix.width` / `summary.width`). It never shows the page's width, which `againAt` used to set before the rebuild. `againAt` now goes through `widthTurned`: rebuild, then the page takes the width only once the new review is in. A failed rebuild leaves the review, Send's build, the switch and the page's width as they were, and shows the error. The switch can be turned again. |
| 321-lj-screens#2 | fixed | The same change. |
| x-privacy#1 (Lovejoin's part) | fixed | Where `summary.collateralReserve` is set, the private mix review and Mix my boxes again's review show one short note under the giveme.my note: "giveme.my backs its collateral's mix too, so it sees that mix. If that mix can't go, its 5 ₳ box waits unmixed, tied to this session." That is sc-o-1's critical `swaps.review.privacy.collateralMix`, the swap approval's words and placement, so both approvals share one key and nothing new needs back-translating. |
| 323-worker#6 (Lovejoin's part) | fixed | Where `summary.collateralReserve` is set, the review's ⓘ hint uses `lovejoin.review.privateNoteMixed` / `againNoteMixed`: "What isn't used comes back; the 5 ₳ kept aside comes back later, mixed once." It no longer says the 5 ₳ comes back with the rest. Elsewhere the hints are unchanged (call 2). The form's figures are as in 321-lj-screens#4. |
| gap-3#2 (Lovejoin's part) | fixed | The same change. |
| x-i18n-es#2 (the remainder) | fixed | `lovejoin.mixes.held` / `.released` are now plurals: en `_one`/`_other`, es `_one`/`_many`/`_other`, ja `_other`. They are rendered through `amounts.count(boxes, …)` with the Bootstrap's box count. With balances hidden, `amounts.count` asks for the plural, so a one-box Bootstrap isn't given away. The es `released` became "volviendo por sí sola(s)", the round's fix for a bare "sola". |
| bootstrap.md's note | already there | `PrivateReview` has the *For returning the rest* row reading `summary.bootstrapReserve` (`lovejoin.review.returnRest`). No change. |

## Tests

All tests are in the new `extension/tests/lovejoin-form-review-fixes.test.ts`, with one updated threshold in `lovejoin-release-rules.test.ts`. Each test name carries "1.6.0's release review, <id>".

- **"while the 5 ₳ pool it names holds its floor, two of its boxes free, and takes new boxes, as the worker builds it"** (320-screens#2, 321-lj-screens#3). Fail-before: `TypeError: tailReserveOf is not a function`.
- **"in what leaves, and the 5 ₳ back later as a box of its own rather than once it's mixed (321-lj-screens#4), the rows adding up".** Fail-before: `AssertionError: expected 20550000n to be 22050000n`.
- **"on the form's rows: the reserve beside the boxes, the total, and the collateral's own row under Back later"**, a static render of the extracted `MixMoves`. Fail-before: `Element type is invalid … got: undefined` (MixMoves not exported). The behavioural failure shows under mutation (below).
- **"offers a box only where the funding, the 5 ₳, its fee and its change's least are held, the reserve too where it's paid for"** (323-worker#0). Fail-before: `AssertionError: expected 1 to be +0`.
- **"funds the least private balance the stepper offers a box at, its collateral's mix paid for, and the form's total is the review's"** (323-worker#0, 320-screens#2). It uses the real WebAssembly, preprod's bundled 5 ₳ pool with two strangers' boxes, and the classic pool's recorded boxes.
  - It reads `funding()` and `status()`, then checks that `tailReserveOf` agrees with the worker's reserve.
  - It searches for the least private balance `mixMost` offers one box at, builds `mixOutBuild` there, and expects `collateralReserve` = 1.5 ₳. The form's `leaving` must be within 0.05 ₳ of the review's payments plus fee.
  - Fail-before, run with the reserve taken straight from the funding: `Error: Not enough ADA in your private balance for this, its fee and the change.` The old threshold is refused by the real funding even without the reserve.
- **"counts none where the 5 ₳ pool has too few boxes to draw, as the worker then funds none"**, with one stranger's box. Here lovejoin-funding still names the reserve, but the page's read says no, and the worker funds none. Fail-before: `TypeError: tailReserveOf is not a function`.
- **"its ADA alone, and in a token pool the UTxOs holding its token: never rewards, the collateral, or ADA held with other tokens"** (321-lj-screens#1). Fail-before: `TypeError: publicMixAda is not a function`.
- **"four only on a review built four wide, whatever was asked of it"** (320-screens#4, 321-lj-screens#2). It covers a private and a public again review at four and at three, and four asked that went three. Fail-before: `Element type is invalid … got: undefined` (AgainSwitch not exported).
- **"takes the new width only once the review built at it is in, never after that build fails".** Fail-before: `TypeError: widthTurned is not a function`.
- **"say giveme.my backs and sees that mix, in its own short note, on a mix and on Mix my boxes again"** (x-privacy#1). Fail-before: `AssertionError: expected '<h2>First, a one-time account is fund…' to contain 'data-testid="lovejoin-collateral-mix-…'`.
- **"no longer say the 5 ₳ comes back with what isn't used: it comes back later, mixed once"** (323-worker#6, gap-3#2). Fail-before: `AssertionError: expected 'Once funded, the account deposits the…' to be 'lovejoin.review.privateNoteMixed'`.
- **"held, and coming back by itself, for one box; their plural for two, and while balances are hidden"** (x-i18n-es#2), in en and es. Fail-before: `AssertionError: expected 'Your mixes Bootstrap: 1 box of 10 ₳ H…' to contain 'held until you bring it back'`.
- **Updated:** `lovejoin-release-rules.test.ts`, "counts the funding's reserves, the deposit's and its way back's, in what the private balance must hold". The threshold is now boxes + 3 ₳ + 2 ₳ (was + 1 ₳), with its comment.

### Mutation checks

Each mutation was undone with Edit, and all tests pass again.

- **Batch A.**
  - `mixCosts`' reserve forced to 0. Three tests fail:
    - `expected 20550000n to be 22050000n`;
    - `expected 'Into a one-time account 15.3 ₳ …' to contain 'Into a one-time account 16.8 ₳'`;
    - the real-WebAssembly test, `expected false to be true` (the form and the review 1.5 ₳ apart).
  - `widthTurned`'s two lines swapped: `expected [ true ] to deeply equal []`.
  - The note dropped from PrivateReview: the note test fails.
  - held/released always counted 2: `… to contain 'held until you bring it back'`.
- **Batch B.**
  - `tailReserveOf`'s free-boxes check dropped: `expected 1500000n to be 0n`, in the rule test and the one-stranger real test.
  - The reserve dropped from `mixMost`'s aside:
    - `expected 1 to be +0`;
    - the real test, `expected undefined to be '1500000'`, since it was funded without the reserve (the worker's fallback).
  - Token-held ADA counted: `expected '57000000' to be '25000000'`.
  - `AgainSwitch` showing four where four went three: `expected 'true' to be 'false'`.
  - The hint's variant off: the hint test fails.
- **Batch C.** `FEE_ROOM` back at 1 ₳. Three tests fail:
  - `expected 1 to be +0`;
  - the real test, `expected undefined to be '1500000'`;
  - the Bootstrap bound, `expected false to be true`.
- **Not covered by a test that fails without it:** `PoolPage`'s wiring.
  - That is the `utxos` read on the public tab, `againAt` calling `widthTurned`, and the page passing `tail`.
  - The tests run in Node with no DOM, so they can't press a tab or a switch.
  - The rules and the extracted components (`MixMoves`, `AgainSwitch`) are tested. The wiring is for the lead's e2e run and visual check.

## Files touched

- `extension/src/ui/screens/Lovejoin.tsx`:
  - `FEE_ROOM`, and `COLLATERAL_MIX_DRAWS`;
  - `mixMost`'s `tail`;
  - new `tailReserveOf`, `publicMixAda`, `AgainSwitch`, `widthTurned`, and `MixMoves` (extracted from PoolPage's inline rows);
  - `mixCosts`' `tail`, `tailFees` and `tailBack`;
  - `reviewHint`'s variants;
  - MixCard's held/released;
  - `PoolPage`'s `pools` prop, `utxos` read, `side`, `tail`, `firstBox` and `costs`; the again builders split into `againReview`/`againPublicReview`; `againAt`; the cost section's part row;
  - the hub passes `pools`;
  - `CollateralMixNote` on PrivateReview and AgainReview.
  - It imports `COLLATERAL_MIX_COST` from `LovejoinReturn.tsx` (sc-o-1's).
- `extension/src/i18n/translations/{en,es,ja}.json` and `docs/i18n/{es,ja}-provenance.json`: small anchored edits. Lines with a no-break space before ₳ went through an exact-substring script, each anchor asserted to occur once, with no JSON round trip.
- `extension/tests/lovejoin-form-review-fixes.test.ts` (new); `extension/tests/lovejoin-release-rules.test.ts` (the Bootstrap threshold).
- `extension/e2e/extension.spec.ts`: one test's setup (below).

## Keys

- **Critical keys added or changed: none of mine.** `node scripts/i18n-critical.mjs` (print only) adds only sc-o-1's three keys over the checked-in list. I reuse sc-o-1's critical `swaps.review.privacy.collateralMix`, and sc-o-1's `lovejoin.collateralMix.label` (the cost part row).
- **Added**, es/ja provenance `machine`:
  - `lovejoin.review.privateNoteMixed`, `lovejoin.review.againNoteMixed` (en, es, ja);
  - plural forms `lovejoin.mixes.held_one`/`_other` and `lovejoin.mixes.released_one`/`_other` in en; `_one`/`_many`/`_other` in es; `_other` in ja.
- **Removed:** the bases `lovejoin.mixes.held` and `lovejoin.mixes.released`, and their provenance entries.
- **Changed**, provenance already `machine`:
  - `lovejoin.mix.cantAfford` (en, es, ja): "…plus 5 ₳ kept aside, the fee and the change.";
  - `lovejoin.mix.cantAffordPublic` (en, es, ja): "…Your public account has {{held}} ₳ a mix can spend."
  - No test or e2e pinned the old words.

## e2e changed

- `e2e/extension.spec.ts`, "Lovejoin: a mix from the public account without its collateral says so before Review, and sets it in place".
  - Its account gains two UTxOs of ADA alone, 30 ₳ and 20 ₳.
  - The fixture account holds only 9 ₳ in ADA alone (its 10,338 ₳ UTxO holds tokens), which no public mix can spend.
  - With the corrected cap, the form would have shown the ADA shortfall before the collateral message. Review would also never go on once the collateral landed, a promise WebAssembly never kept there.
  - Core spends pure ADA largest first, so the collateral's payment takes the 30 ₳ UTxO and the 20 ₳ one still pays for a box.
  - No expectation's words changed.
- **Unchanged, but depends on the new cap:** the main Lovejoin test's public stepper going to two boxes.
  - That account counts 39 to 44 ₳ in ADA alone (the fixture's 9 ₳, plus e6, plus e5 unless it's the collateral), and two boxes need 29.1 ₳.

## Docs to update

- **flows.md:512** (Mix). Now true:
  - From the private balance, where a 5 ₳ pool would take the collateral (its floor held, two boxes free), the form counts the funding's 1.5 ₳ for that mix:
    - in *Into a one-time account*, with *For its collateral's mix* set in under it, and in the total;
    - in the costs (*Its collateral's mix, about* 1.5 ₳: its deposit, its mix and its box's way back);
    - *Comes back once it's mixed* without the 5 ₳;
    - a row *Its 5 ₳ collateral*, back later as a box, about 4.7 ₳.
  - The stepper keeps that reserve aside, and 2 ₳ for the funding's fee and its change's least.
  - From the public account, what's held and the stepper count only the ADA a mix can spend: UTxOs of ADA alone, and in a token pool those holding its token. Not ADA held with other tokens, nor the rewards Home counts.
- **flows.md:516 and :520** (Mix my boxes again; Four boxes a mix). The review's switch says the width the review was built at, three where four went three. A rebuild that fails leaves the switch, the review and Send's build as they were, with the error.
- **flows.md**, Your mixes: a Bootstrap of one box reads "held until you bring it back" / "coming back by itself".
- **flows.md:522** (Bootstrap): from the private balance, the form's shortfall is the boxes, 3 ₳ of reserves and 2 ₳ for the fee and the change.
- **privacy.md:217** (the collateral's mix): a mix's and a Mix my boxes again's review now say, where the funding pays for that mix, that giveme.my backs and sees it, and that a mix that can't go leaves the box tied to the session. privacy.md:121's rule ("every review that asks giveme.my says so where it's read") now holds for them.

## Calls the owner might overturn

1. **The collateral's mix is a cost on the form.** Where it applies, "Mixing 10 ₳ costs about 6.35 ₳ (63.5%)", with its own part row (1.5 ₳ estimated). The alternative is to keep it out of the cost and the percentage, but then the rows no longer add up to what leaves.
2. **The stepper keeps the reserve aside** (private by default). In a ~1.5 ₳ window it offers one box fewer than a funding without the collateral's mix would pay for. Settings' collateral switch turns it off. It's not a refusal: Review and the worker's fallback are unchanged.
3. **`FEE_ROOM` 2 ₳**, the fee and the change's least, for the Mix stepper and the Bootstrap form alike. A balance within about 1 ₳ of the old threshold is now said to be short before Review, where the funding refused it at Review. It's a 1 ₳ bend on classic-only screens.
4. **The public side's held figure is what a mix can spend**, not Home's public figure. An account with ADA held with tokens, or with rewards, sees less here than on Home. `cantAffordPublic`'s words say "a mix can spend".
5. **The review hints change only where the collateral is mixed** (`*NoteMixed`). The general wording waits for Session 10's call 2.
6. **One critical key for both approvals.** The note is sc-o-1's `swaps.review.privacy.collateralMix`, placed under the giveme.my note as on the swap approval. It's short, and doesn't repeat the return review's three-sentence note.
7. **The again switch shows the built width.** Where four was asked and it went three, it shows three, and the WidthNote says why. Turning it on asks four again.
8. **321-lj-screens#4, the tail case only.** Without a 5 ₳ pool, the form still counts the 5 ₳ as coming back once it's mixed (call 2).
9. **The e2e setup change** above.

## Notes for other fixers and the lead

- **sc-o-1:** I use your `COLLATERAL_MIX_COST` (LovejoinReturn.tsx), `lovejoin.collateralMix.label` and `swaps.review.privacy.collateralMix`. Renaming or removing any of them breaks Lovejoin.tsx; typecheck will say so. Your `SendButton` on the Lovejoin review fits my `againAt`, which sets `pressed` to "again" / "again-public" while it rebuilds.
- **sc-lj-2:**
  - `FEE_ROOM` is 2 ₳, and moves `bootstrapLimits.short`.
  - `PoolPage` has a `pools` prop.
  - The again reviews are built by `againReview` / `againPublicReview`.
  - `MixMoves`, `AgainSwitch`, `tailReserveOf`, `publicMixAda` and `widthTurned` are exported.
  - bootstrap.md's open point (`lovejoin.review.bootstrapNote` shown on a private Bootstrap's three transactions) is untouched.
- **The lead:**
  - The critical-keys check ("is derived from the source…") fails on sc-o-1's three new keys only; run `--write` once.
  - The es/ja gate lists only others' keys (round 3).
  - No test of mine needs the pkg rebuilt.
- **Outside my work:** `tests/lovejoin-bring-review-fixes.test.ts` fails 2 tests ("counts a box it takes again back once…", "gives the box its due time back after Stop…"). Both that file and `lovejoin.ts` are being edited by lane W. On a rerun one still failed: `expected [ 1800054120000 ] to have a length of 2 but got 1`.
- **Cleanup:** my scratch files are in the scratchpad (`sc-lj-1-*`); nothing untracked of mine in the tree but the new test file.

## Checks

- `npm run typecheck` (`tsc --noEmit -p .`, which includes tests and e2e): clean.
- `tests/lovejoin-form-review-fixes.test.ts`: 12 of 12, on the default build and with `VITE_ENABLE_MAINNET=false`. Before the fixes, all 12 failed (above).
- `tests/lovejoin*.test.ts`, `screens`, `i18n*`, `words`, `hide-balances-forms`, `shown-text`, `dapp-prompt` and `settings`: 46 files, 855 passed, 2 skipped, 5 failed. None of the five is mine:
  - three in i18n.test.ts's critical-key gate (sc-o-1's new keys and round 3);
  - two in lovejoin-bring-review-fixes (lane W, mid-edit).
  - `tests/lovejoin-1-5-0.test.ts` passes, unedited.
- With `VITE_ENABLE_MAINNET=false`: my file plus screens, lovejoin-held-balance, lovejoin-screens-review, lovejoin-hub, lovejoin-release-rules, lovejoin-session5-screens, lovejoin-merged-screens, words and i18n-screens: 10 files, 229 passed.
- All three locale files parse.
- Not run (the brief): e2e, any build, `--write`.
