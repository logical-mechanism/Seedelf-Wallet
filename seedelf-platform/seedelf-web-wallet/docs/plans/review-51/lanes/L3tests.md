# Lane L3tests

Returned by the workflow's agent `a837d93696c310409`, written here by the lead from its structured answer.

## Findings (4)

### l3tests#1 · low · The e2e private swap fails on both builds since ad8c3ce4: one Refresh after the fill now only notes the order spent

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/e2e/extension.spec.ts:2948`
- **Who:** nobody · **Since:** ad8c3ce4 · **Confidence:** confirmed-by-run

**Scenario:**

In 'a private swap: Minswap's quote, a one-time account funded, and then it runs itself', the order is marked spent and the fill is put at the account, then Refresh is clicked once. Since ad8c3ce4 (r2still#2), the first run that sees every order spent only records auto.spentSeen and returns. So the page still reads 'Waiting for the order to fill. Then it all comes back by itself; Stop cancels it.', and the test's 'Coming back into your private balance' times out. This happens in the dev build and in the store build alike, so CI's two e2e jobs (web-wallet.yml:240 and :288) go red and the branch can't pass the release checks. The Vitest runner tests were moved to the new step (pastSpent); this test wasn't. In the product, the swap page says it's waiting for the fill for one more runner turn after the order was seen spent: up to the 1-minute alarm, or until the next Refresh.

**Evidence:**

Paths and lines are FIXTREE's. The lead's final checks on ad8c3ce4 (scratchpad final/ext-summary.txt): 'e2e-dev exit 1  1 failed  1 skipped  108 passed' and 'e2e-store exit 1  1 failed  1 skipped  108 passed'. Both logs (final/ext-e2e-dev.log and ext-e2e-store.log) show the same failure: '✘ 56 … e2e/extension.spec.ts:2748:1 › a private swap …', then 'Expected substring: "Coming back into your private balance" Received string: "Waiting for the order to fill. Then it all comes back by itself; Stop cancels it."' at extension.spec.ts:2948:49. The cause is sessions.ts:3986-3991: `if (auto.spentSeen === undefined) { await this.update(... r.auto!.spentSeen = now()); return; }`. The page's Refresh is `call("session-advance", { index, now: true })` (Swaps.tsx:2189/2515), which runs step(..., "asked") once. The test clicks Refresh once (2947), then expects the return and koios.submitted of 2 (2948-2951). The unit tests were changed to `pastSpent(t, sessions)` (tests/swap-session.ts:181-188, two advances back to back) in swap-runner, swap-page, return-plan, return-history, spent-clock, splash-remnant, order-cancel-check and lovejoin-chain-review-fixes. grep finds no other e2e flow that waits on a fill: the Stop flow at 3983 never has its order spent, store-images.spec.ts has no swap, and e2e/live has no swap flow. Round one's final run (02f73991) had this test passing; its 6 failures were the tUSDM lookalikes that 417fff13 fixed.

**Fix:**

In the e2e, after the fill's Refresh, assert the interim 'Waiting for the order to fill' line, then click Refresh again before expecting 'Coming back into your private balance', three steps done, 906.5941 MIN and two submitted. An asked run skips READ_EVERY_MS, so the second Refresh tells the outcome at once. The class is every test that drives a fill: the Vitest ones were moved, and this is the only e2e one. Optionally, have the timeline say the order was seen filled while spentSeen is set, instead of 'Waiting for the order to fill'.

**Known check:**

Searched review-51 (RESUME, FINDINGS, INDEX, lanes, verify, data) and docs/backlog.md and docs/archive/plans for spentSeen, pastSpent, 'Coming back into your private balance', 'extension.spec.ts:2748', '2948' and 'private swap'. spentSeen appears only in verify/r2still-2.md, the fix's design. Nothing records the e2e break.

### l3tests#2 · low · count.py's new exit status fails a full audit run for modules Lake replays: they read STALE by mtime, and no check.sh run can clear that

- **Where:** `seedelf-verification/Audit/count.py:153`
- **Who:** nobody · **Since:** ddc17685 · **Confidence:** confirmed-by-run

**Scenario:**

A module's source gets rewritten with the same bytes after its build. That happens on a git stash pop, a branch switch there and back, `git checkout -- file` after a trial edit, or any worktree made with a copied .lake, as chunk 51's are. The source is then newer than its trace. Lake hashes the content, finds it unchanged and replays without touching the trace, so check.sh says ok. count.py:114 still says 'STALE: trace older than the source: rebuild it', and no check.sh run rebuilds it. Since ddc17685, count.py exits 1 (:153), and a full `bash Audit/run-all.sh` takes that status (run-all.sh:42, :47), so it exits nonzero although every module just read ok. FIXTREE shows it today: after the final runs read every Seedelf module ok, count.py says '0 ok, 200 STALE' (exit 1) and tally.py Seedelf says 158 not ok, 156 of them 'built before its source changed'. Before ddc17685, the same full run exited 0, with the STALE rows printed only.

**Evidence:**

In FIXTREE, Seedelf/AlwaysFalse.lean is dated 2026-11-17 23:14 (the worktree checkout). Its .trace and .olean are dated 2026-11-04 19:41, and they still are after the final default run printed 'ok Seedelf.AlwaysFalse'. That run's console has no 'Built' line: grep -c 'Built Seedelf.' gives 0 for lean-default.log, lean-lovejoin-any-tx.log and lean-lovejoin-every.log, and 14 for seedelf-every, which had no builds before. So Lake replays by hash and never refreshes the trace. Read-only runs: `python3 -I Audit/count.py` gave exit 1 and '== 0 ok, 200 STALE'; `python3 -I tally.py Seedelf` gave '158 not ok', 156 'built before its source changed'. Harness SCRATCH/r51/work/L3tests/stale/demo.sh: a fake package, with eight audit families of one module each, a stand-in lake that replays and a stub run-diag.sh, run once with 10a06db6's check.sh, count.py and run-all.sh and once with HEAD's. Output: 'old tools, sources rewritten after the build: yes :: run-all.sh exit 0 :: check.sh: 8 ok :: count.py: == 0 ok, 8 STALE'; 'new tools … yes :: run-all.sh exit 1 :: check.sh: 8 ok :: count.py: == 0 ok, 8 STALE'. Controls, with the sources untouched: both tools exit 0, 8 ok.

**Fix:**

Judge freshness the way Lake does, not by mtime. One way: check.sh touches a module's trace once it has read that module's verdict from it, since a replayed trace belongs to the current source (Lake matched its hash). Another: keep per-module verdicts with a time in check.sh and have the readers consult them (r2verif#3's option (c)). A third: have the readers ask Lake, `lake build --no-build M`. The class includes tally.py:127's 'built before its source changed', which prints NOT OK for the same modules. count.py's 'rebuild it' advice should name a step that works.

**Known check:**

Searched Audit/review/findings.md (checksh-cannot-tell-replay is the converse: a replay reading as fresh), verify/v3-1.md (count.py's freshness test, taken as sound), verify/r2verif-4.md (it proposed the exit status), lanes/R2verif.md's note on FIXTREE's STALE rows (taken as the worktree's state, not a defect), owner-calls.md §9 (diag's LOOK rows, a different cause), the chunk-46 and chunk-49 plans and backlog.md, for mtime, 'older than the source', 'built before its source', STALE and 'rebuild it'. None says check.sh can't clear a STALE caused by a replay, or that a full run now fails on it.

### l3tests#3 · low · check.sh's family runs no longer fail on an import's own sorry or Undetermined, and lovejoin-any-tx's 34 V2/Template imports were judged by none of the final runs

- **Where:** `seedelf-verification/check.sh:275`
- **Who:** nobody · **Since:** ddc17685 · **Confidence:** confirmed-by-run

**Scenario:**

`./check.sh lovejoin-any-tx` builds or replays 34 root modules its list doesn't name, among them Lovejoin.Template.OneShotMint, Template.FeeContract, V2.MixAnySpec and V2.OwnAny2Steps. Suppose one of them logs '⚠️ Undetermined' or a `declaration uses 'sorry'`, for example after chunk 46's pin move. The console replays it under every module that imports it, but own_log reads only `$m`'s own trace. The run reads 143 ok and exits 0, and the import appears nowhere in the summary. At 10a06db6 the same run read UNDETERM or SORRY and exited 1. The final Lean checks (scratchpad final/lean.sh: seedelf-every, lovejoin-every, lovejoin-any-tx, default) judge none of those 34. README.md:177's standard chain would, since it runs lovejoin-v2 first, but those final checks, and any single-family run, don't. The default run has one more such module, Seedelf.Signers.Keys (generated definitions and #guards).

**Evidence:**

check.sh:275 `r=$(root_of "$m") && read -r undet unsound < <(own_log "$r/.lake/build/lib/lean/${m//.//}.trace")`, the only verdict read, and only for $m. Harness SCRATCH/r51/work/L3tests/imp/demo.sh: Demo.Top is listed and imports Demo.Imp; Demo.Imp's own trace holds an Undetermined and a sorry, and the console replays both. Output: '== old check.sh: exit 1 :: SORRY Demo.Top (1 sorry or native_decide, 0s, …)' and '== new check.sh: exit 0 :: ok Demo.Top (0s, …)'. A computation over check.sh's arrays, Signers/modules.txt and the audit lists, walking each of the four final runs' imports: default leaves ['Seedelf.Signers.Keys'] unjudged; seedelf-every and lovejoin-every leave none; lovejoin-any-tx leaves 34 (Lovejoin.Steps, Template.Fee, Template.FeeContract, Template.OneShotMint, Template.Steps, V2.Mix, V2.MixAny*, V2.MixTok*, V2.OwnAny1-4 and their Spec and Steps, V2.MixSpec, V2.Scripts). The real any-tx console carries their messages: lean-lovejoin-any-tx.log has 15 'warning: Lovejoin/Template/OneShotMint.lean' lines and 10 'warning: Lovejoin/Template/FeeContract.lean' lines. The r2verif#2 verifier foresaw this: verify/r2verif-2.md:77, 'decide SORRY from each module's own trace JSON … That also covers it, but check.sh would then have to walk the imports' logs, which the console already carries.'

**Fix:**

Judge each in-package module a run builds or replays by its own trace, under its own name. Walk $m's in-package imports as tally.py's hole() does, or read Lake's Built and Replayed captions before the 'Replayed' filter drops them. Print, for example, 'UNDETERM Lovejoin.V2.MixAnySpec (an import of …)' and fail the run. An alternative is to list each family's outside imports first, as lovejoin-every already does. Either way, run README.md:177's whole chain in the final checks (lean.sh skipped lovejoin, lovejoin-v2 and seedelf-slice), and say in the README that a family's exit status covers only the modules it lists.

**Known check:**

review-1.9.0.md:67 docs-prep#1 (via verify/r2verif-1.md:94) is the converse: an import's Undetermined charged to the importer, which this fix ended. verify/r2verif-1.md and -2.md give the fix notes, -2.md:77 the warning. lanes/R2verif.md's notes are about attribution, not coverage. Also searched backlog.md, the chunk-46 and chunk-49 plans and Audit/review/findings.md for 'import', 'replayed log' and 'family'. Nothing records the lost coverage.

### l3tests#4 · low · test-tools.sh still passes with three of the rules it claims to hold dropped: check.sh's own sorry, its NO TRACE, and count.py's exit status

- **Where:** `seedelf-verification/test-tools.sh:8`
- **Who:** nobody · **Since:** ddc17685 · **Confidence:** confirmed-by-run

**Scenario:**

test-tools.sh's header, the commit ('it fails with any of them dropped') and README.md:182 ('checks these rules in check.sh, tally.py, Audit/count.py and the diag scan') say it holds the tools to these rules. Three mutants, each applied alone to a copy, still give 'PASS: the tools hold'. (1) own_log stops counting `declaration uses 'sorry'`, so a module whose own log has a sorry reads ok in check.sh. That is the README.md:204 guard against Blaster props holding sorryAx. (2) check.sh's NO TRACE rule becomes rc=0, so a build that passed and left no readable trace reads ok. (3) count.py always exits 0. run-all.sh, whose new status rules are in the same commit, never runs in the test. A later edit that drops any of these goes green.

**Evidence:**

Copies in SCRATCH/r51/work/L3tests/tt/<m>/ (check.sh, tally.py, Audit/count.py, run-all.sh, diag/scan-diag.py and selftest). Run: `TOOLS=<copy> TMPDIR=… bash test-tools.sh`. head: 'PASS: the tools hold'. m1 (check.sh:277 `rc=notrace` → `rc=0`): exit 0, PASS. m2 (check.sh:251 `unsound = sum("declaration uses 'sorry'" in m or (` → `unsound = sum((`): exit 0, PASS. m3 (count.py:153 → `return 0`): exit 0, PASS. Controls are caught: m4 (root_of's .lake/packages loop dropped) → 'FAIL forget() left the dependency's old build', 'FAIL a dependency's failed module reads ok'; m5 (undet = 0) → 'FAIL an Undetermined reads ok'; m6 (scan-diag `return 0`) → 'FAIL a killed Lean run scans clean', 'FAIL the self-test's LOOK and FAILED rows scan clean'. Reading confirms the gaps. The check.sh SORRY case (test-tools.sh:142-150) gives only a wrapped `#print axioms` list. The only own-sorry case (:103-108) is checked through tally.py and count.py. No case leaves a passed build without its trace. readers() (:75) discards count.py's exit code. run-all.sh is never invoked.

**Fix:**

Add four cases. (1) A passed build whose own trace has `declaration uses 'sorry'` must read SORRY and exit 1. (2) A passed build with its trace removed must read NO TRACE and exit 1. (3) count.py's exit status: 0 on the good package, 1 once a module isn't ok. (4) run-all.sh with a stub run-diag.sh: a partial run ends on its families' statuses, a full run on count.py's too. Then check each rule's mutant fails the test, as this round did for the others.

**Known check:**

r2tests#6 (lanes/R2tests.md) asked for this test to exist, which ddc17685 answers; this is the new test's own coverage. Searched review-51 (lanes, verify, data) and the verification READMEs for test-tools: no record.

## Checked and holds

- Preprod-only build: every one of the 40 test files round two touched, run alone with VITE_ENABLE_MAINNET=false in a copy of HEAD, passes: 767 passed, 9 skipped. All 9 skips are swap-form-review's mainnet-only runIf describes, r2screens#2's new one included. The lead's full runs on ad8c3ce4: default 3617 passed / 4 skipped, preprod 3607 / 14 skipped.
- Timing: the slowest round-two test, private-index 'is neither the wallet's nor a Seedelf's place', took 6.4 s alone, under its new 30 s limit (r2tests#7). Every other new or changed test took 2.3 s or less, or has an explicit limit.
- Each test below fails with its fix reverted alone, in a copy. accounts-restore-look's two new cases: merge's pin and check()'s pin (r2tests#4). stake-elsewhere-screens: Send's and Make public's form notes, each `&& false` (r2tests#2). collateral-review: Create's RewardsRow removed (r2tests#3). swap-page's new case: `if (strangers) return;` dropped (r2tests#9). private-refresh's new case: e5#2's summary path for an old watch dropped. apart_test's new case: the error half `failed && !short_whole` → `failed` (r2tests#5), which panics with the size error instead of the shortfall.
- Read against their fixes, these tests pin what they say: 2d639df8 (Building… then Sending…), e4d97bea (Remove's summary takes the UTxO's 6 decimals), 7b6881f7 (the last step links the first return; backStepText's branches), 61a4d717 (each of the four Seedelf callouts only for its reading; a second msg or a second 674 sets otherMetadata), 853d5779 (a changed hash isn't submitted or watched), e66a6a16's three origin cases (control, judged again with nobody asked, kept-before re-asked once), 81516188's shared spellings (the Vitest loop and the Rust test every_reader_of_a_payments_register_reads_every_spelling_alike both ran), f88560c4's CSV cells, and e6d6a18d's Tx Hash lines read from a child run's stdout.
- ownReturnAt (Swaps.tsx) and sessions.ts's firstBack agree: the view drops unsent and replaced txs (sessions.ts:6033), so the page's first return is the worker's.
- e2e: store-images.spec.ts and e2e/live use no control, test id or text that round two renamed or reworded. extension.spec.ts:5362's dapp-private-held still reads 'in your private balance' with nothing locked, and that test passed. The only e2e failure on either build is l3tests#1.
- i18n: dappUi.warn.datumByHash and tx.out.warn.seedelfByHash are in critical-keys.json and both verified-critical lists. sites.topUp.tooMuch is gone from en, es and ja and from both provenance files. ja's reworded tx.out.warn.anyoneCanSpend is listed. No critical English value changed after its back-translation. The new strings' siblings (dappUi.heldAndCollateral, withdraw.tooMuch, withdraw.asideAvailable, home.lockedMeta) aren't critical, and their placeholders match how they're called. i18n.test passes in both legs.
- check.sh's own_log rule, applied to all 1,038 traces in FIXTREE (676 root, 362 dependency), flags only PlutusCore.UPLC.CekMachine, a dependency check.sh never builds as $m. No root module reads SORRY or UNDETERM falsely. Blaster logs '⚠️ Undetermined' as a warning and 'Expected Undetermined' as info (Smt/Env.lean:67-70), which own_log tells apart.
- root_of resolves every module in check.sh's arrays, the eight audit lists, Signers/modules.txt, Slice/modules.txt and BlasterMain: no false NO TRACE. Every dependency .olean has a trace and a source that home() finds: no false 'rests on'.
- check.sh on real Lake output, the final runs at ad8c3ce4: seedelf-every 28 ok, 14 of them built; lovejoin-every 76 ok; lovejoin-any-tx 143 ok; default 163 ok, with PolicyBurn and PolicyMint FAILED on BitVec as documented and their builds absent. No false verdict.
- scan-diag.py: FAILED only on a nonzero rc= (run-diag.sh appends it) or an unknown output. The diag files use the #blaster command, so an Undetermined leaves rc=0. test-tools.sh passes on HEAD and catches forget()'s dependency lookup, own_log's Undetermined count and scan-diag's exit status. A run-all.sh run of some families ignores count.py, as documented.
- Rust: the final cargo run (951 passed, 12 ignored) includes the new apart, register-spellings and signing-page tests, none of them ignored.
- FIXTREE is clean at ad8c3ce4, with no r51 files tracked or untracked. My copies under ~/.cache/seedelf-review-51/L3tests* are removed.

## Notes

- For L3still (r2still#2): the fix's comment says 'the next run's listings, READ_EVERY_MS on', but an asked run (the page's Refresh, run === "asked") skips READ_EVERY_MS (sessions.ts:3738). So the second run can come seconds after the first, and pastSpent tests exactly that: two advances back to back with no clock moved. A lagging backend missing a split leg twice in a few seconds leaves gap-g4#1's class narrower but open. The leg is then the swap's own by landedAfter, but its fill goes untold and it comes back directly.
- For L3still and the owner: landedAfter (sessions.ts) compares Koios's block_time with the device's clock. A device clock running minutes fast reads a stranger's payment that landed after the first return as landed before it. That payment then counts as the swap's own (no KeptBack strangers), which e2b#2 kept apart. The comment assumes the clocks agree to a second.
- Not all of round two's Lean was judged: the final Lean checks (final/lean.sh) ran seedelf-every, lovejoin-every, lovejoin-any-tx and the default run, and skipped lovejoin, lovejoin-v2 and seedelf-slice from README.md:177's standard chain. Nothing in those families changed this round, and the any-tx and every runs only replayed, so nothing is missed today. Under l3tests#3's narrower verdicts, the full chain is what covers the 34 imports.
- FIXTREE's tally.py and count.py output is unusable as a record: every source is newer than its trace (the worktree's checkout), so 200 audit modules read STALE and 156 Seedelf modules NOT OK, though check.sh read them ok. The record should quote check.sh's summaries, not those readers' counts, from this tree.
- Both earlier fix rounds' Vitest breaks were in the preprod-only leg. This round's break is in Playwright, which only the final run exercises: the round's fixers ran no e2e.
- An earlier attempt of this lens, cut off by the usage limit, left SCRATCH/r51/work/L3tests/tools-m4, tools-m6 and tally-*.out. Its m4 and m6 are this report's m1 and m3, re-run here.

## Coverage

Read in full:
- COMMON.md, FIX.md, RESUME.md, fix-branches.md and LIVE.md; lanes/R2tests.md and lanes/R2verif.md; owner-calls.md.
- ddc17685's whole diff: check.sh, tally.py, count.py, run-all.sh and scan-diag.py as files; test-tools.sh; the README changes.
- The test diffs of 853d5779, 2d639df8, e4d97bea, 7b6881f7, 459d4cf8, 61a4d717 (dapp-datum-hash, dapp-prompt), e66a6a16 (lovejoin-accounts, lovejoin-restore) and ad8c3ce4 (swap-page, swap-session, and the pastSpent edits to eight runner tests), with the source changes each pins. The UI diffs of round two; the en, es and ja and docs/i18n diffs.
- The failing e2e test and the final checks' logs: e2e on both builds, both Vitest legs, cargo, and the four Lean runs.

Skimmed:
- f88560c4's 17 tests (CSV cells read closely); e66a6a16's sessions submit-check tests; 81516188's Rust side; b3687869, e6d6a18d and af022a6f's Rust tests. Only apart_test's new case was mutated; the rest are L3money's and L3cli's.
- ad8c3ce4's pinning code: serial's turnPin, activity, pending and account. I checked for a wallet-queue deadlock: no withKeys callback calls into the sessions queue.

Ran:
- All 40 changed test files one at a time, preprod-only.
- Nine single-file mutants: seven Vitest, one Rust test binary, plus test-tools.sh against six tool mutants.
- Two scratch harnesses contrasting 10a06db6's tools with HEAD's.
- Read-only trace scans, and tally.py and count.py over FIXTREE.

Not reached:
- Playwright and the store-images spec, which I didn't run; the live runs.
- Mutants for f88560c4's 17 guards (their commit says each was reverted), for e66a6a16's seven submit checks, and for 61a4d717's decimals siblings beyond reading their tests.
- Lean itself, never built. The CLI and money Rust tests beyond reading.
