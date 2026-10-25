# Fixer `bootstrap`: the private Bootstrap (the release blocker)

Lane L, first. Phase A's Rust half (d5fa7ede, made to build in 9978654a) was already in: core's `BOOTSTRAP_BACK_RESERVE` (1.5 ₳), `bootstrap_most` building each count's deposit and its sweep back, and WebAssembly's `lovejoinBootstrapReserve()`. The pkg built at 9978654a has both, so **no test of mine needs a rebuild**. This round did the worker, the record's mark, the screens, the tests, and the compatibility of older records. I didn't touch Rust or run cargo.

## Findings

All nine come down to one bug: since 62162483, a private Bootstrap's session held its boxes and 1.5 ₳. The deposit's change (1.5 ₳ less its fee) couldn't pay a sweep back into the private balance, so the chain failed and the session came straight back with a second fee and no box in.

| id | status | change |
|---|---|---|
| 318-rust#0 | fixed | `mixFunding` adds `lovejoinBootstrapReserve()` (from WebAssembly, never a TS constant) to a private Bootstrap's one payment. It's kept apart from the tail's `reserve`, so it never sets `tailReserved` and never counts the boxes 1.5 ₳ short. The funding is boxes + 3 ₳. privateBootstrapMost's WebAssembly cap already builds with the same core constant, so the cap and the funding agree (doc updated). |
| 323-rust#0 | fixed | The same bug and the same fix. |
| x-scenarios-lj#0 | fixed | The same bug and the same fix, covered for a token pool too. |
| docs-small#0 | fixed | Both red tests fixed for the right reason, and the four fixtures that landed a 5 ₳ the funding no longer pays now land the funding's real outputs. The CI steps that never ran (build, e2e, e2e:data, store package) are the lead's, on the release PR. |
| x-compat#0 | fixed | As docs-small#0. lovejoin-flows' "deposit" check now needs an output at mix_box, since a direct return also spends out#0. The legacy path (a Bootstrap funded with its 5 ₳ before 62162483) keeps its own labelled test. |
| x-release#0 | fixed | As docs-small#0, plus the form's 302/302.5 ₳ test (now 304 ₳, pinned to WebAssembly). Its release items D (a green workflow, and one real private Bootstrap on preprod at the funded amount) are for the lead or owner: fixers send nothing. |
| 316#2 | fixed | The two red tests, as above. |
| 312#4 | fixed | The two red tests, as above. |
| 323-worker#4 | fixed | mixOutSubmit marks a Bootstrap funded with no collateral (`mix.noCollateral`, from `KeptMix.backReserved`). For a marked record, buildBack's collateral pick takes none, so any 5 ₳ of ADA alone at the account stays a coin. **Note:** with the reserve, the finding's exact shape can't arise from a funding any more. A 1-box Bootstrap of a 3.5 ₳ pool is now funded with 6.5 ₳; every ADA pool's box is ≥ 3.45 ₳; and a token pool's funding UTxO holds the token. So the mark is defensive, and its test uses a stranger's 5 ₳ at the account. |

### Tests, the fail-before lines, and the mutation checks

- **The whole private Bootstrap.** `tests/lovejoin-flows.test.ts`, "funds a private Bootstrap with its way back, deposits, then sweeps the change back with nothing put up (1.6.0's release review, 318-rust#0)". It covers 1 classic box, the cap (96), and 2 token-pool boxes. The funding lands exactly as it paid the account (decoded from the funding's bytes). Then it checks:
  - the chain is out → deposit → back, with no `mix.skipped`;
  - one payment of `lovejoin.funding` (depth 0) plus the reserve, and no 5 ₳;
  - the deposit pays every box at the pool's mix_box;
  - the back spends only the deposit's change, puts up no collateral, and pays the wallet contract;
  - the record is marked `noCollateral`.
  - **Fail-before:** `AssertionError: 1 boxes of the classic pool, the wallet couldn't build its chain: a Seedelf deposit of these tokens needs at least 1.456780 ADA: expected [ 'out', 'back' ] to deeply equal [ 'out', 'deposit', 'back' ]`.
  - **Mutation:** with `back` dropped from the payment, the same failure. Also failing then: lovejoin.test.ts's seed and tile tests, lovejoin-flows' one-time-account test, merged-review's MERGED-5 test and CROSS-1's Bootstrap case, and the planner's Bootstrap test.
- **323-worker#4.** `lovejoin-flows.test.ts`, "puts up no collateral for a Bootstrap funded with none, whatever 5 ₳ of ADA alone its account holds (1.6.0's release review, 323-worker#4)". It checks that `chain()` gets no collateral, that nothing is put up, and that the stranger's 5 ₳ comes back as a coin.
  - **Fail-before:** `AssertionError: expected [ { …(14) } ] to deeply equal [ undefined ]` (the chain was handed the stranger's 5 ₳).
  - **Mutation:** undoing the pick gives the same failure.
- **Compatibility, funded before 62162483.** `lovejoin-flows.test.ts`, "still puts up the 5 ₳ a Bootstrap funded before 62162483 paid, and goes in (1.6.0's release review)". The record is unmarked, with 11.5 ₳ and 5 ₳ at the funding's #0 and #1. Its 5 ₳ goes up as the collateral, one box goes in, and the 5 ₳ comes back in the return. This is a guard: it passes before and after.
- **Compatibility, funded between 62162483 and this fix.** `lovejoin-flows.test.ts`, "brings a Bootstrap funded with neither a collateral nor its way back back as well as it can (1.6.0's release review)".
  - 2 boxes funded with exactly 21.5 ₳: one box goes in, and its ADA pays the sweep back.
  - 1 box: it comes back directly, its whole funding swept, with `sess.skip.warn.mixCannotPay`.
  - **Fail-before:** `expected [ 'out', 'back' ] to deeply equal [ 'out', 'deposit', 'back' ]`.
  - **Mutation:** disabling the one-box-fewer rule gives the same failure.
- **Red test: lovejoin-flows.** "caps a Bootstrap from the private balance at what its funding pays the deposit and its way back for (34d's review 3; 1.6.0's release review, 318-rust#0)". The old test's own fail on the tree: `expected 96 to be less than 96`, since core's rule had moved the cap.
  - Rewritten: under today's parameters the cap is one deposit's most (96 classic, 64 token).
  - At 6465 lovelace a byte (and a new epoch, so the cache misses) the sweep holds the classic pool to 68. 69 is refused before anything is built.
  - From the public account, 69 still goes.
  - **Mutation:** with mixOutBuild's privateBootstrapMost check removed: `expected [Function] to throw error including 'Bootstrap 1 to 68 boxes at a time.' but got 'Not enough ADA in your private balanc…'`.
- **Red test: lovejoin.test.ts.** "mixes from the private balance through a one-time account that runs itself once funded" now expects `["13000000"]`, `bootstrapReserve` equal to WebAssembly's, and no `collateralReserve`. The comment about giveme.my's collateral on the funding's own Seedelf spend stays: it's still true.
  - The neighbouring "seeds from the private balance on an empty pool under a floor" now lands the funding's real outputs (`["13000000"]`), not 11.5 ₳ and 5 ₳.
  - The original red line, `expected [ '11500000' ] to deeply equal [ '11500000', '5000000' ]`, is gone.
- **Red test: sessions-review-fixes.** "stays one transaction, as its cap's deposit has it: never parts its deposit then can't pay" now uses `spread(40, "500000")`.
  - With the reserve the old spread was refused again, but only just: 11.5 ₳ fit in 21 inputs, and 13 ₳ needs about 23 against a cap near 22.
  - The new spread needs 33 inputs (measured by forcing parts: 20 + 13), and its 20 ₳ pays, so the refusal is for its inputs, never its ADA.
  - **Mutations:** forcing `inParts` for a Bootstrap resolves the funding over 33 inputs, so the test fails. Dropping the TOO_MANY mapping gives `got 'Spending 23 UTxOs at once needs more computation than a transaction may use'`.
- **Other stale fixtures, now landing the funding's real outputs.**
  - `lovejoin-flows.test.ts`, "goes through a one-time account from the private balance…";
  - `lovejoin-merged-review.test.ts`, "keeps holding from the private balance once its session saw the deposit land" (it now also checks the chain went in with its box), and CROSS-1's `funded()`, whose mix case keeps its real 5 ₳;
  - `lovejoin-planner.test.ts`, "funds a Bootstrap with no collateral, and brings it back through its deposit with none put up". This one now funds exactly `payments[0]` (not 40 ₳), with the record as mixOutSubmit marks it.
- **The form.** `lovejoin-release-rules.test.ts`, "counts the funding's reserves, the deposit's and its way back's, in what the private balance must hold". The reserves are derived from WebAssembly (lovejoinFunding past the box, plus lovejoinBootstrapReserve, which is 3 ₳), so the screen's constant can't drift from core's.
  - **Mutation:** `BOOTSTRAP_RESERVE` back at 1.5 ₳ gives `expected false to be true`.
- **The review.** `lovejoin-screens-review.test.ts`, "says what returning the rest takes beside the boxes, and that what it doesn't use comes back (1.6.0's release review, 318-rust#0)". The R3 case now uses the real summary (183 ₳ paid, `bootstrapReserve` 1.5 ₳), and its total moves to 183.236778 ₳.
  - **Mutations:** with the row off: `expected '…' to contain 'For returning the rest 1.5 ₳, and wha…'`. With lessReserve not subtracting the reserve: `…to contain 'For the boxes and network fees 181.5 …'`.

## Files touched

- `extension/src/background/sessions.ts`, only in these places:
  - the `SessionRecord.mix.noCollateral` and `KeptMix.backReserved` types;
  - mixOutBuild's comment;
  - `mixFunding`;
  - mixOutSubmit's mark;
  - buildBack's collateral pick, and the chain call beside it (the one-box-fewer rule for records funded with neither).
- `extension/src/background/lovejoin.ts`: the docs of `checkBoxes` and `privateBootstrapMost` only. No code needed changing.
- `extension/src/shared/rpc.ts`: `SessionOutSummary.bootstrapReserve` (additive).
- `extension/src/ui/screens/Lovejoin.tsx`:
  - `BOOTSTRAP_RESERVE`, now 3 ₳, its doc naming both core constants;
  - the docs of `bootstrapLimits`;
  - the form's comments;
  - `lessReserve`;
  - PrivateReview's new row.
- `extension/src/i18n/translations/{en,es,ja}.json`.
- `docs/i18n/{es,ja}-provenance.json`.
- Tests:
  - `extension/tests/lovejoin-flows.test.ts`: four new tests, the cap test rewritten, a fixture, and the `landed()` helper;
  - `lovejoin.test.ts`;
  - `sessions-review-fixes.test.ts`;
  - `lovejoin-merged-review.test.ts`: two fixtures and `landed()`;
  - `lovejoin-planner.test.ts`;
  - `lovejoin-release-rules.test.ts`;
  - `lovejoin-screens-review.test.ts`.

## Keys

- **Critical keys added or changed: none.** Neither key is in a callout or alert, and neither is named `.warn.` or `.privacy.`. `node scripts/i18n-critical.mjs` (print only) lists neither, and `tests/i18n.test.ts` passes.
- **Added:** `lovejoin.review.returnRest`. The value comes from the existing `lovejoin.collateralReserve.value` ("{{ada}} ₳, and what it doesn't use comes back").
  - en: "For returning the rest"
  - es: "Para la vuelta del resto"
  - ja: "残りの返却のために"
  - es/ja provenance: `machine`.
  - The es and ja wording matches each language's `lovejoin.mix.networkHintPrivate` for "returning the rest".
- **Changed:** `lovejoin.bootstrap.cantAfford`. es/ja provenance was already `machine`.
  - en: "…not enough for that many, with the fees and returning the rest on top."
  - es: "…no alcanza para tantas, sumando las comisiones y la vuelta del resto."
  - ja: "…手数料と残りの返却分も合わせるとその件数分には足りません。"
  - e2e's "not enough for that many" still matches. No test greps the old words.

## Docs to update

- **flows.md:522** (the Bootstrap bullet). Now true:
  - From the private balance, the one payment carries the boxes, the deposit's 1.5 ₳ reserve and a further 1.5 ₳ for returning the rest. That return is a sweep with no collateral, whose Seedelf output must hold its least after its fee.
  - The cap is what both reserves pay the deposit and the sweep for, measured by building both: one deposit's most under today's parameters (96, or 64 in a token pool), and fewer at a dearer byte (68 in the classic pool at 1.5× `coins_per_utxo_size`). "53 … 35 to 40" and "fixed 1.5 ₳" are stale.
  - The review has a *For returning the rest* row: 1.5 ₳, and what it doesn't use comes back.
  - "what comes back later is a sweep into new private UTxOs" is now true.
- **privacy.md:198.** Now true: "funded with the boxes, 1.5 ₳ for the deposit's fee and 1.5 ₳ for its way back; the wallet builds the deposit and the sweep to find how many". Today that's one deposit's most.
- **architecture.md:**
  - **671:** privateBootstrapMost is held to what the reserves pay the deposit and its sweep back for. Say:
    - the reserve is core's `BOOTSTRAP_BACK_RESERVE`, read through `lovejoinBootstrapReserve` and added in mixFunding, never in `funding_for`, which the 1.5.0 gate pins;
    - the record carries `mix.noCollateral`;
    - a Bootstrap funded between 62162483 and this fix goes in with one box fewer, and a one-box one comes back directly.
  - **611:** a Bootstrap's cap is what a deposit and its sweep back, from one funding UTxO, leave room for.
  - **632:** a Bootstrap's return never takes a collateral, whatever 5 ₳ is at its account (`mix.noCollateral`, 323-worker#4).
- **plans/chunk-34-token-pools.md:711** (34d review 3's "53 classic boxes, 40 of LJTEST"), and Session 11's item 4: record this review's fix.
- **wasm/README.md's export table:** add `lovejoinBootstrapReserve()` (no argument; a lovelace string, what a private Bootstrap's payment carries beside `lovejoinFunding`'s lovelace for its way back). Say that `lovejoinBootstrapMost` builds the deposit and its sweep back. This overlaps rust-rest's 321-lj-rust-data#2.

## Calls the owner might overturn

1. **The amount.** The way back's 1.5 ₳ is phase A's choice in core, so a private Bootstrap is funded with its boxes plus 3 ₳. The least that works is about 0.3 ₳ at 1 box and about 0.65 ₳ at 96. 1.5 ₳ leaves about 0.5 ₳ for fees or the price of a byte to move, and what the sweep doesn't spend comes back. A different figure is a core change and a rebuild.
2. **Records funded between 62162483 and this fix** (dev builds only). They go in with one box fewer, and that box's ADA pays the way back; a one-box one comes back directly with "its ADA doesn't pay for a box and its mixes anymore". The alternative is today's: come back directly with the confusing chainFailed text. The rule applies only to an unmarked Bootstrap with no collateral whose funding paid less than its boxes' funding plus the reserve. A first, blunter version misfired on an over-funded record (the planner test's), so the rule checks what the funding paid.
3. **The review shows the way back as its own row**, *For returning the rest*, rather than folding it into *For the boxes and network fees*. The form's refusal now says "with the fees and returning the rest on top".
4. **The private cap rises** from 53 (40 in a token pool) to one deposit's most under today's parameters. The form says "From your private balance, at most 96 go in at a time".
5. **Not fixed, existing before this round:** `lovejoin.review.bootstrapNote` ("The deposit goes in now, in one transaction.") is shown for a private Bootstrap too, where the funding, the deposit and the sweep are three transactions. That's for the screens round.
6. **Not taken:** restoring the 5 ₳, which the owner turned down on 2026-10-23.

## Notes for other fixers and the lead

- **No test of mine needs the pkg rebuilt.** The only failures in my runs are deep-datum's untracked `tests/lovejoin-discovery-review-fixes.test.ts` (314-wasm#0, 2 tests: a RangeError and a memory access out of bounds on today's pkg). They wait for the rebuild.
- **`reserve` and `wss-1` (sessions.ts after me).**
  - mixFunding's `back` sits beside the tail's `reserve`. Keep it out of `reserve`, `tailReserved` and `collateralReserve`.
  - `KeptMix.backReserved` becomes `SessionRecord.mix.noCollateral` at mixOutSubmit.
  - buildBack's collateral pick skips a marked record.
  - The one-box-fewer rule sits inside the chain call's `try`, so its `lovejoin.funding` failures land in `leftOut` like the chain's.
- **The screens round:** PrivateReview reads `summary.bootstrapReserve`. Note the bootstrapNote wording above.
- **Tests that land a session's funding:** use the `landed()` helpers (lovejoin-flows, lovejoin-merged-review). They decode the funding's real outputs. A supposed amount hid this bug.
- **The release:** x-release#0 asks for one real private Bootstrap on preprod at the funded amount before release. That's the lead's or owner's step: fixers send nothing.

## Checks

- `npx vitest run tests/lovejoin*.test.ts tests/sessions*.test.ts tests/i18n*.test.ts tests/words.test.ts`, run last after every mutation was put back:
  - default build: 40 of 41 files, 757 passed, 2 skipped, 2 failed (deep-datum's, above);
  - `VITE_ENABLE_MAINNET=false`: the same.
- `tests/lovejoin-1-5-0.test.ts` alone: 2 of 2 on both builds. It's unedited, and its fixtures are untouched.
- `npm run typecheck`: clean.
- Measured on the pkg with a scratch script:
  - `lovejoinBootstrapReserve()`: 1500000;
  - `lovejoinFunding` at depth 0: 11500000 for 1 box, 961500000 for 96;
  - `lovejoinBootstrapMost`: 96 at 4310 lovelace a byte, 68 at 6465.
