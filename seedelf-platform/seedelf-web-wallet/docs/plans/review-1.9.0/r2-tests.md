# 1.9.0's review of its fixes: the tests lens

Round two, on the merged fixes at `204c7a93`. Verbatim from its structured report.

## Coverage

Read: R2BRIEF.md, FIXBRIEF.md, fix-full.txt, COMMON.md and FINDINGS.md, plus the merged diff 8d7c4b0c..204c7a93 of every changed source file and test.

Worktree: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/6637f822-1e93-462d-9b5e-5bd103fc4b4b/scratchpad/review-1.9.0/r2/tests/tree, detached at 204c7a93 (review-1.9.0/integrate).
- node_modules was symlinked to the main tree's and wasm/pkg copied in.
- Cargo used $HOME/.cache/seedelf-review-1.9.0/target-r2-tests, seeded from target-integrate, with -j 4, MemoryMax=8G and taskset -c 4-11. It is left in place (11 GB).
- Cleaned up at the end: the symlink is unlinked and the worktree removed. The main tree and R/integrate/tree were never touched: 0 changed, main at 8d7c4b0c.
- Every revert went through scripts/revert.py and was restored with `git checkout -- <files>`. Each restore was checked clean, per file and for the whole tree.
- Scripts are in R/r2/tests/scripts (revert.py, run-vitest-revert.sh, run-e2e-revert.sh, mutate.py: the rust lane's with TREE repointed, drive-rust.sh, drive-rust-oldtests.sh, timing.sh). Logs are in R/r2/tests/logs and timing JSON in R/r2/tests/timing, where R = /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/6637f822-1e93-462d-9b5e-5bd103fc4b4b/scratchpad/review-1.9.0.

Baselines on the integration branch:
- Vitest over the 5 changed files plus the 6 i18n guards: 11 files, 299 passed.
- cargo: cip30_test 73 passed; session_test 14 passed, 1 ignored; orders_test 26 passed.

Vitest reverts (dapp-prompt plus the 6 i18n guards, 182 tests, unless named otherwise):
- m1-all, m1-row, m1-yours: 1 failed each.
- m1-ack: 182 passed. The e2e catches it instead (below).
- l3-old-key: 1 failed. l3-new-key-always: 2 failed.
- l11-names (en/es/ja and DappApprovals): 4 failed. l11-whole (also the provenance files, critical-keys.json and the verified lists): 1 failed.
- nb-all, nb-en, nb-es, nb-ja, nb-one-forms: 1 failed each.
- nb-en-other, nb-es-other-many, nb-plural-forms: 182 passed each (r2-tests#1).
- Views (tx-view, tx-view-screen, dapp-prompt; 90 tests): l6-active 1 failed, l6-other 1, l7-swaps 2, l7-body 3; m2 2, m3 2, m5 1, m6 1, m7 1; dapp-ui4-a 1, dapp-ui4-b 1.
- Swap routes (swap-routes, minswap-refusals, swap-quote-ask; 38 tests): l8-routeof 12 failed; l8-no-name-refused 7; l8-no-no-route 7; l8-any-status-400 1; l8-any-status-404 1; l8-keep-name-only 6; l8-keep-route-only 6; l8-keep-any-minswap 1; l8-keep-all 1.
- z6, z7 (swap-routes): 1 failed each.
- stake-v3-only, scan-preprod, spent-by-hash-only (order-cancel-check, splash-remnant, sundae-orders; 52 tests): 2, 2 and 5 failed.
- l8-reason-silent over 13 swap files: 304 passed (r2-tests#2).

Rust: all 12 mutants of the rust lane's mutate.py were applied to the integration tree. Each kills its new test (details in checked_ok). The 12 were also run against 8d7c4b0c's own test files.

e2e on my dev build (`npx vite build`, then the brief's `taskset -c 0,1 xvfb-run -a npx playwright test --project=extension -g "releases a contract UTxO under the account's key says so" --repeat-each=4 --workers=4`, under the cap):
- 4 passed (26.5 s), each 20.1–21.4 s against the 30 s timeout, at load about 6.4.
- With repeat-each=2: m1-ack 2 failed; mutant m 2 failed; enter-skips-ack 2 passed (an equivalent mutant, see checked_ok).
- dist was rebuilt from the restored tree after each.

Timing: 24 JSON runs.
- Each changed file three times alone under taskset -c 0,1, at load 5.6–9.0 while the lead's full suite and e2e ran.
- swap-routes three more times at load about 2.3.
- Six parallel runs (3 or 5 changed files, --maxWorkers=2) on CPUs 0,1.
- Only the swap-routes test in r2-tests#3, and two older C05 tests in order-cancel-check, crossed 3.5 s, all under heavy load.

Not done:
- the #373 e2e on the store build;
- the full Vitest suite on two CPUs;
- cargo fmt or clippy (not this lens's; the lead's rust.log is green).

No network calls. Never opened e2e/support.ts or the vectors JSON.

## Findings

### r2-tests#1 (nit, confirmed-by-run): i18n#5's test holds the U+00A0 in the `_one` notes only: 6 of the 12 values can lose it with every test passing

**Files:** seedelf-platform/seedelf-web-wallet/extension/tests/dapp-prompt.test.ts, seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/en.json, seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/es.json

**Claim.** "keeps each note's ₳ by its number, in every language" renders only summaries built from `taken`, which has `contractInputs: 1`. In en and es that picks the `_one` plural form; ja has only `_other`. So the test holds 6 of the 12 note values the fix changed: en `_one` ×2, es `_one` ×2 and ja ×2. The other six have no test: en `_other` ×2, es `_other` ×2 and es `_many` ×2. The other note tests can't see the NBSP either, because `text()` folds every `\s`, U+00A0 included, into a space.

**Evidence.** Code in the integration tree:
- dapp-prompt.test.ts:95: `contractInputs: 1,`
- :149-160: the i18n#5 test renders `honest` and `pool` from `taken` and reads them with `toContain("50 ₳")` and `not.toContain("50 ₳")`.
- The `text()` helper: `html.replace(/<[^>]+>/g, " ")...replace(/\s+/g, " ")`.
- Values with no test: en.json:431 and :433 (`contractInputs_other`, `contractInputsTokens_other`); es.json:449, :451, :452 and :454 (the `_many` and `_other` forms).

Runs: `R/r2/tests/scripts/run-vitest-revert.sh <revert> tests/dapp-prompt.test.ts tests/i18n.test.ts tests/i18n-critical-helpers.test.ts tests/words.test.ts tests/i18n-worker-reasons.test.ts tests/i18n-values-in-place.test.ts tests/i18n-screens.test.ts`. Each revert sets the NBSP back to a plain space on the notes' lines only.
- nb-en-other (en's two `_other`): "Tests 182 passed (182)".
- nb-es-other-many (es's four `_other`/`_many`): "Tests 182 passed (182)".
- nb-plural-forms (all six): "Tests 182 passed (182)".
- Each of nb-one-forms, nb-en, nb-es, nb-ja and nb-all: "Tests 1 failed | 181 passed (182)", the i18n#5 test.

Each was restored with git checkout, clean.

**Scenario.** A later redraft of en's `dappUi.note.warn.contractInputs_other`, or an editor that normalises the NBSP, brings back the plain space. A site's transaction that spends two contract UTxOs without a release (a swap through two pools) then shows "It spends 2 contract UTxOs holding 50" with "₳." wrapped onto the next line in the 400-px window, and no test fails. es `_many` needs about a million contract inputs, so only the four `_other` values are reachable.

**Fix.** Render both summaries at `contractInputs: 2` as well as 1, which reaches en and es `_other`. Or assert on the JSON directly: in en, es and ja, every value of a `dappUi.note.warn.contractInputs*` key contains `{{ada}} ₳`.

### r2-tests#2 (low, confirmed-by-run): L8's MINSWAP_REASON entries are unpinned: the new codes outside routeOf can be remapped to a wrong retry reason with all 304 swap tests passing

**Files:** seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts, seedelf-platform/seedelf-web-wallet/extension/tests/swap-routes.test.ts

**Claim.** Outside routeOf's second ask, the fix's own words are "anywhere else, a refusal like any other". Such a refusal is a first ask's or a build's "Quote not found.", or the 400 for a name on the wallet's own list. It is retried with reason "other", which shows Minswap's words. Only the `"name-refused": "other"` and `"no-route": "other"` entries keep it so, and no test sends either refusal anywhere but routeOf's second ask.

**Evidence.** Code in the integration tree:
- sessions.ts:282-284: `// routeOf's, which keeps its first answer on either: anywhere else, a refusal like any other, in Minswap's words.` then `"name-refused": "other",` and `"no-route": "other",`
- sessions.ts:294: `if (e instanceof MinswapError && e.trouble) return MINSWAP_REASON[e.trouble];`
- Swaps.tsx:3052: `if (reason) return reason === "other" ? error : t(RETRY_REASONS[reason]);`
- `grep -rn -i -e "quote not found" -e "must be equal to constant" tests` finds only swap-routes.test.ts:297, 304 and 335-336, all for the second ask.

Run: revert `l8-reason-silent` changes the entries to `"name-refused": "minswap-build-failed"` and `"no-route": "minswap-silent"`. Over swap-routes, swap-runner, minswap-refusals, swap-quote-ask, sessions, direct-swaps, swap-order-open, sessions-refused, order-cancel-check, sundae-orders, swap-page, swap-page-words and i18n-worker-reasons: "RESULT l8-reason-silent (exit 0): Tests 304 passed (304)". Restored clean.

**Scenario.** A funded runner's first estimate is refused. Either Minswap stops taking a name on the wallet's own list (as it stopped taking ChakraBondingCurve on 2026-11-09), or the pair loses its route while the funding confirms. It retries, as it should. If an edit remaps the entry, its retry line says "Minswap didn't answer." or "The swap Minswap built failed when Minswap ran it…" in place of Minswap's refusal, and nothing fails. Today's mapping is right; this is a gap in the tests only.

**Fix.** In swap-routes' "a second ask Minswap refuses" describe, add a funded runner whose first estimate answers `noRoute()`, and one whose first answers `nameRefused(0)`. Expect `view.auto.retry` toMatchObject `{ reason: "other", error: <Minswap refused it (404/400): …> }`, with no pause and no build-tx.

### r2-tests#3 (nit, confirmed-by-run): swap-routes' new "still throws on a limit or an outage" test came within 1.5 s of Vitest's 5 s on a loaded two-CPU run

**Files:** seedelf-platform/seedelf-web-wallet/extension/tests/swap-routes.test.ts

**Claim.** The new test at swap-routes.test.ts:427 unlocks a wallet three times, and each `unlocked()` runs `wallet.create`'s password KDF. It also takes three runner steps. It's the slowest new test in every run. On taskset -c 0,1 it reached 3,585 ms alone and 3,822 ms beside other files while the machine's load was 7–9. With the machine quiet it took about 650 ms.

**Evidence.** Code: swap-routes.test.ts:427-460 calls `await unlocked()` once in each of two loop turns, then once more before `started` and three `sessions.advance` calls. swap-session.ts:23: `await t.wallet.create(phrase, PASSWORD);`

Runs, `systemd-run ... taskset -c 0,1 npx vitest run tests/swap-routes.test.ts --reporter=json`, durations in R/r2/tests/timing:
- alone, runs 1-3 at load 7.8-9.0: 3585, 3164, 2911 ms;
- with order-cancel-check and tx-view, --maxWorkers=2: 3822, 2852, 2269 ms;
- alone at load about 2.3: 650, 643, 649 ms;
- 5 files, 2 workers, at load 3.2/4.0/7.6: 632, 2692, 658 ms.

The same parallel run at load 7.6 also took two older order-cancel-check C05 tests to 3,751 and 3,698 ms. So the machine's load drives it, but this is the only new test to cross 3.5 s. None failed in 24 runs. The house gives tests like this room: withdraw-resend-unlock.test.ts:23 has `const SLOW = { timeout: 30_000 };`.

**Scenario.** CI's unit job runs the 264-file suite with two workers on ubuntu-latest. A busy moment slows the KDF, and this test, at 77% of 5 s on a loaded two-CPU run here, times out. The job fails and a rerun passes.

**Fix.** Split the quote half (the 429/503 loop) from the runner half, so each test unlocks once or twice. Or pass the house's `{ timeout: 30_000 }` to it.

## What holds

- M1: reverting en.json's three values together, or contractRow or contractYours alone, fails dapp-prompt's "says what comes from a contract…" test.
- M1: contractAck reverted alone passes all 182 Vitest tests but fails the #373 e2e 2/2 at getByRole('switch', { name: 'I expect this not to come back to me' }). The switch's English is held by the e2e alone, which CI runs.
- L3: forcing the old key whatever keyReleases says fails the L3 test. Forcing the new key always fails the L3 test and 1.7.2's i18n#0 test. Both directions are held.
- L11: renaming the notes back in en, es, ja and DappApprovals fails 4 tests. Renaming them back everywhere, the provenance files, critical-keys.json and the verified lists included, still fails dapp-prompt's L11 test, so the test holds the name itself.
- i18n#5: dropping the NBSP in all 12 values, in any one language, or in the `_one` forms fails the i18n#5 test. The plural forms are r2-tests#1.
- L6: dropping `|| hash === drep` (the active account) or `|| h === theirs.drep` (another account) each fails the DRep test.
- L7: Swaps.tsx passing no lookedUp fails the cancel and pool-swap tests. TxDetailBody ignoring it fails those two and the body test.
- L7: the views lane's m2, m3, m5, m6 and m7 each still kill on the merged tree.
- tx-view-screen's vi.mock('react') seam is sound: TxDetailModal has one no-initial useState (its read) and TxDetailButton one (open). With no view set it's a pass-through, and a seam that failed to open the view would fail every toContain, never pass.
- L8: routeOf back to 8d7c4b0c's fails 12 tests. Dropping either trouble code fails 7, and either status check fails the unit test.
- L8: keeping `first` on one code only fails 6 tests each way. Keeping it on any Minswap error, or on any error, fails the "still throws" test.
- mutants#4 (z6, z7), routes#3 (stake-v3-only, scan-preprod, spent-by-hash-only) and dapp-ui#4 (mutants A and B) each still kill on the merged tree.
- Rust: all 12 mutants kill their new tests on the integration branch:
- d, e, f, h, z1, z2, r2m, r3m, c4 and c1 in cip30_test or session_test;
- z5 trips orders_test's "a constraint of three items" and z9 its "another second module".
- Rust: against 8d7c4b0c's own test files, d, e, f, z1, z2, r2m, r3m, c4, z5 and z9 survive, so only the new tests kill them. h and c1 are also caught by old tests. This matches the rust lane's claims.
- cip30.rs and orders.rs: 0 non-comment lines changed in the merged diff, so the copied wasm/pkg matches the merged Rust.
- The #373 e2e on the dev build: 4 passed (20.1–21.4 s against 30 s) under taskset -c 0,1 with 4 workers. Mutant m (a yes carrying over to the next request) fails 2/2 at extension.spec.ts:5884.
- The e2e's "Enter signs nothing" is held by the browser itself. Sign is type=submit and disabled until the yes, so Enter can't submit the form. Removing answer()'s `mustAck && !ack` passes 2/2, correctly: that guard is a second layer that no browser path reaches.
- The "no unchecked machine draft" gate passes for contractRow, contractAck and contractYours by key name only. The lead's note in verified-critical-{es,ja}.json records three blind rounds for this round's redrafts, and the shipped es and ja values match what it names.
- No new test can pass vacuously: each reads a regex match or a rendered value, so a missing element yields undefined and fails.
