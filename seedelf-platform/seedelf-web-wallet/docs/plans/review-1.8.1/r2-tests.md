# 1.8.1's review of its merged fixes · r2-tests

Lens: **the fixes' tests, by revert and under load**, in R2 (`/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-r181-r2`) only. Paths below are under EXT (`seedelf-platform/seedelf-web-wallet/extension`) unless they say otherwise. Line numbers are the main tree's, which is R2's merged state.

**In short:**

- **Every fix's revert is caught.** That's 30 TypeScript reverts and mutants, one typecheck pair, and 23 Rust reverts and mutants. Each went in alone, its tests kept, and at least one test it should break failed on an assertion, never a timeout. No fix is untested.
- **One defect where two lanes meet** (r2-tests#1, low): the refusals lane's v-pv11-impact#2 makes Ogmios's real answer name an unknown input. crossCheck then takes the account's own box for a pool box that's gone.
  - A public Mix again built while Koios's Ogmios is a block behind ends in "None of your boxes in Lovejoin's pool came from a mix from your public account."
  - With a second account's boxes in the pool, it ends in `lj.privacy.otherAccount`.
  - Before this round it said "…Try again in a minute."
  - Shown by a repro, before and after.
- **Under load, five runs of the 20 new and changed files** (542 tests), under two CPUs, on both builds, with one, three and four workers.
  - Nothing timed out, failed or flaked.
  - The round's new tests are well inside their limits.
  - Three older tests at Vitest's 5 s default reach 4.0–4.2 s with four workers (r2-tests#2, low). One of them is the test the guard lane saw time out at 5.7 s.
- **The new Rust tests are cheap in a debug build.** The slowest is 2.1 s. Together they add about 7 s to their targets on two CPUs.
- **R2 is as I found it:** `git -C R2 diff` printed nothing at the end, and my repro files are deleted. Other round-two reviewers used R2 at the same time; *R2, shared* says how my runs kept apart from theirs.

## r2-tests#1 (low) · A Mix again from the public account, its own box new to Koios's Ogmios, says the account has no box there

**Where:** `src/background/lovejoin.ts:4831-4832` (crossCheck), with `:4619` (unstale), `:7495` (split's `reserved`), `:5052-5058` (publicAgainBuild's `theirs`) and `:3799` (fanOut's `owned`). It's where the refusals lane's v-pv11-impact#2 meets Mix again's choice of the account's own boxes, which no lane changed. That fix is `unknownInputs` naming an input from a 3004's reason, at `:596` and `:619-624`.

**What's wrong.** crossCheck takes every input Ogmios's answer names as a pool box that's gone: `if (unknown) throw new StalePool(unknown)`.

- unstale puts the names in `avoid`, and split folds `avoid` into `reserved`.
- publicAgainBuild filters the account's own boxes by `reserved` too: `free(fromAccount(split.owned, schedule, account), split.reserved)`.
- So when the evaluating Ogmios is a block behind the pool read and doesn't know the account's own box yet, the next try leaves that box out, as if it were gone.
- With one or two of its boxes in the pool, the third try has none. The build throws `lj.noneFromAccount`, or `lj.privacy.otherAccount` where another account's boxes are in the pool.

**Why it's new.** Before this round, an evaluation never named anything.

- Ogmios never answers an evaluation with 3117 (v-pv11-impact#2). So `unknownInputs` gave `[]` for the real answer, and every try built the same.
- The build ended in `lj.poolDrifted`: "Lovejoin's pool changed while the wallet read it: a box it drew isn't there anymore. Try again in a minute." That's the right advice.
- tailWitness already tells the two apart: an unknown input of the wallet's own (`ours`, `:4553`) is `sess.notCaughtUp`. crossCheck has no such guard, and needed none while nothing was named.

**Evidence, two repros** (`zz-r181-r2-tests-1.test.ts` and `-2`, run in R2 and deleted). The setup is lovejoin-reward-balance.test.ts's `cutAfterDeposit`: the account's two boxes in the 5 ₳ pool, at `d0…#0` and `d0…#1`. The evaluation answers seedelf-core's recorded `unknown_inputs.json`, renamed to the first of the account's boxes the transaction spends, and AGREES otherwise.

- **On the merged tree:** "Ogmios named [d0…#1, d0…#0]; the build threw Error: None of your boxes in Lovejoin's pool came from a mix from your public account."
- **With only v-pv11-impact#2 reverted** (`unknownInputs` as at 2a8060d3): the build threw `lj.poolDrifted`, and the test passed.
- **With a second account's chain and box in the pool** (`-2`, merged tree): "These boxes came from a mix from Account 2. Switch to it on the Public tab to mix them again: paying from this account would tie the two accounts together."
- **With the network caught up,** the same setup builds: `{ again: true, boxes: 2 }`.

**The failure.**

- **The flow:** the account's public mix lands, and the pool read lists its boxes. Koios's `/ogmios` backend is a block behind. Mix again, pressed then, is refused, and the refusal says the account has no box from a mix of its own in the pool.
- **Where the read can be ahead of the evaluation:**
  - **Preprod,** which reads and evaluates through Koios's gateway, whose backends differ (the planner tests' "a backend a block behind").
  - **Mainnet with Koios-only on,** or with the data layer's `submit` part down: evaluation then goes to Koios while reads stay on home's node (`data-layer.ts:374-384`).
  - With the data layer whole, both come from home's node, so the evaluation is never behind the read.
- **With a second account's boxes there,** the refusal is `lj.privacy.otherAccount`, a critical line, telling the user to switch accounts. By the severity table that's medium; I've graded it low for how narrow the window is (a block's lag, right as the boxes land). The lead may grade it up.
- **The cost:** nothing is signed or sent, and a try once Ogmios has caught up works. But the words give no reason to try again.
- **The private Mix again, from the code (not run):** fanOut filters `owned` the same way (`:3794-3799`) and throws `LovejoinSkipped(lj.skip.warn.noneLeft)`. sessions.ts takes a skip as the reason to bring the session back directly (`:4662`, `leftOut` at `:6321`), so its funding comes back unmixed, its fees spent. It needs an Ogmios behind boxes that landed before the review, so it's narrower than the public case.

**Smallest fix, test first.**

- **The test:** keep the repro as a test. A public Mix again whose evaluation doesn't know the account's own box ends in `lj.poolDrifted`, as before.
- **The fix, either of:**
  - keep `avoid` off the wallet's own boxes: filter `owned` by the other chains' reservations alone (split's `inputs`), and the pool's other boxes by `inputs` and `avoid` (fanOut `:3794-3799`, publicAgainBuild `:5052-5056`);
  - or have crossCheck do as tailWitness does: names that are only the wallet's own mean Ogmios is behind, not a box gone.

## r2-tests#2 (low) · Three tests the round touched run within a second of Vitest's 5 s default under load

**Where:**

- `tests/dapp-ties-accounts.test.ts:186` ("names a public account it pays whichever is on screen…", in the describe at `:185`);
- `tests/dapp.test.ts:803` ("reads a site's transactions one at a time…", the describe at `:148`) and `:1404` ("answers a site that names another account's recent transaction…", the describe at `:1138`).

Their files are among the round's changed ones (the guard lane's `lovejoin: t.lovejoin`), but the round added no work to these tests: `t.lovejoin` is built anyway, and their transactions name no script's reward account. This is older than the round.

**Evidence.** Each runs at Vitest's 5 s default: neither its describe nor its file sets a timeout, where the heavy files use `SLOW` or `CHAINS`.

| Run | `:186` | `:1404` | `:803` |
|---|---|---|---|
| One worker on two CPUs (default; preprod-only) | 1.20 s; 1.16 s | 1.10 s; 1.05 s | 1.66 s; 1.00 s |
| Eleven on twelve (the unconstrained baseline) | 2.42 s | 1.13 s | 2.07 s |
| Three on two (default; preprod-only) | 2.93 s; 2.75 s | 3.24 s; 3.11 s | 3.10 s; 3.28 s |
| Four on two | 4.15 s | 4.06 s | 4.04 s |

The guard lane saw `:186` time out at 5.7 s with 13 heavy files together (fixes/guard.md).

**The failure.** On a CI runner slower than this machine, or busier, these fail by timeout, at random. That reds a pull request for nothing the change did.

**Smallest fix.** A timeout on those describes, as the heavy files have: `SLOW`, or `{ timeout: 15_000 }`. Check it with `--maxWorkers=4` under `taskset -c 0,1`.

## Every fix, reverted alone

Each was run in R2 by `SCRATCH/review/r2-tests/revert.py` (TypeScript) and `rust/mutate.py` (the rust lane's mutants, pointed at R2). Each puts exact replacements into one file, runs the tests that should hold it, writes the file back byte for byte, and checks it by sha256 and `git diff --quiet`. "Caught by" is every test that failed, all on assertions.

### refusals lane

| Revert | Caught by |
|---|---|
| R1 · staking's rewards words for `WithdrawalsNotInRewards` alone | 11 tests: koios.test.ts's PV11 test; staking.test.ts "refuses the same choice again…"; lovejoin-refusals ×4; lovejoin-reward-balance's PV11 cases ×5 |
| R2 · the `WithdrawalsMissingAccounts` block removed | koios.test.ts's PV11 test |
| R2b · it checked after `NotDelegatedToDRep` (M2) | the same |
| R3 · DELEG's match as it was | koios.test.ts's PV11 test; staking.test.ts |
| R3a, R3b, R3b2 · `AccountAlreadyRegistered`; `(Deposit\|Refund)IncorrectDELEG`; `RefundIncorrectDELEG` alone, each left out | koios.test.ts's PV11 test |
| R3c · the 1.21 `NonZero` name left out | koios.test.ts; staking.test.ts |
| R3d · the brief's wider `DepositIncorrect\|RefundIncorrect` (M1) | koios.test.ts's PV11 test, at GOV's `ProposalDepositIncorrect`, which must stay the network's own words |
| R4 · the type by the PV10 name alone | 10 tests: koios.test.ts; lovejoin-refusals ×4; lovejoin-reward-balance's PV11 cases ×5 |
| R4a · `WITHDRAWAL_REFUSED` without `WithdrawalsMissingAccounts` (M4) | koios.test.ts |
| R4b · without `IncompleteWithdrawals` | the same 10 as R4 |
| R5 · pumpPublicNow's rethrow as it was | lovejoin-refusals "by a mix's Send from the public account" |
| R5a · that rethrow as a plain KoiosError (M5a) | the same |
| R6 · sessions.ts pump's `throw e` | lovejoin-refusals ×3: the reviewed return's Send, Bring everything back's line, the retry line |
| R6a · its rethrow as a plain KoiosError (M5b) | lovejoin-refusals "by a reviewed return's Send" |
| R7 · `unknownInputs` as at 2a8060d3 | lovejoin-refusals "are named as Ogmios names them"; lovejoin-planner ×2 ("asks again, rather than stop", "lets a box of any pool come back"); lovejoin.test.ts "builds the chain again from a fresh read…" |
| R7b · no deduplication (M6) | lovejoin-refusals "are named as Ogmios names them" |

### balance lane

| Revert | Caught by |
|---|---|
| B1 · publicBuild's summary without `taken` | lovejoin-reward-balance "is named on its summary…" |
| B2 · publicAgainBuild's without it | lovejoin-reward-balance "takes it in its first mix alone, names it on its review…" |
| B3 · PublicReview's after row as it was | lovejoin-merged-screens "with what its first mix takes…" |
| B3b · `publicAfter` without `taken` | the same |
| B4 · PublicAgainReview's after row as it was | the same, at its "mixing again" line |
| B5 · a private Bootstrap's chain reads its pool again | lovejoin-reward-balance "reads none for a Bootstrap from the private balance either" |

### guard lane

| Revert | Caught by |
|---|---|
| G1 · serviceDeps without `everyKept` | dapp-lovejoin-rewards ×2 ("are every copy discovery keeps too…", "refuse a site's payment into a copy's account unasked…") |
| G2 · mixLogicHashes as it was | those two, and "…a trap is handed on" |
| G2a · discovery's record failing fails the guard | "…a trap is handed on" (`Error: unreadable`) |
| G2b · a trap reading it swallowed | the same (resolved instead of rejecting) |
| mutants#9 · `DappDeps.lovejoin` optional again, and sw.ts's connector line deleted | **The typecheck alone.** With the fix and the line deleted, `tsc` fails with TS2741 at `sw.ts(268,28)`. With the fix reverted too, `tsc` passes. No runtime test catches it, since dapp-lovejoin-rewards copies sw.ts's wiring rather than importing it. CI's `npm run typecheck` holds it, as the lane said. |

### the lead's merge

| Revert | Caught by |
|---|---|
| L1a · withdrawOne refused twice throws the network's error, not `REWARDS_MOVED()` | T12c at PV10 and PV11. The older "refused again at %s…" way-back test passes it, since it checks no words. |
| L1b · the rebuild forgets `paid` (T12d's mutant, now `it.each`) | T12d at PV10 and PV11, and T12c at both |
| `unknownTo` in lovejoin.test.ts | R7 above: "builds the chain again from a fresh read…" fails with v-pv11-impact#2 reverted, so the lead's edit made it a before/after test. "…when the pool stays behind" passes either way: it holds the retry's words, not the naming. |

### rust lane, in R2

- **core#2 reverted** (`Rewards::of` filtering before it collects): `a_pool_named_twice_holds_the_last_balance_given` fails, `Rewards({…: 5})` for `Rewards({})`.
- **The 22 mutants of the lines the new tests hold,** the lane's own, all killed in the merged tree:
  - **C5b, C5c:** `a_withdraw_refused_after_it_read_the_balance_takes_none`;
  - **C26:** the extended `a_chains_first_mix_takes_the_balance_and_its_change_carries_it`;
  - **N1, N2, N3, C8:** `v2_pools_take_a_reward_balance_in_every_kind_and_pay_the_ledgers_fee` and `the_classic_pools_take_a_reward_balance_in_every_kind_too`;
  - **C6:** those two and `every_chain_transaction_balances_with_a_take`; **C23:** the last alone;
  - **W2, W11, W4, W6, W7, W8, W9:** each its wasm `lovejoin_test` entry-point test;
  - **W19:** `cip30_test`'s `a_transaction_names_every_script_reward_account_it_pays_into`;
  - **P1–P4:** `the_proven_scripts_are_the_wallets_v2_templates`; **P5:** both `lovejoin_proven_bytes_test` tests (L `3d659166…` for `a6a85074…`).

### verif and docs lanes

These have no test in the tree, which the brief chose: check.sh's caps and its 51 prerequisites, and the tools' path parsers. I ran the verif lane's scratch checks against R2's files and against HEAD's, copied out, with nothing run in R2 and no lake.

- `test_tool_paths.py`: the merged tools pass; HEAD's fail.
- `cases.sh`: the merged check.sh gives the lane's `cases.after.txt` exactly, and HEAD's its `cases.before.txt`.
- The Lean guards are their own test, which is the lead's build.
- `wasm/tests/readme_test.rs` passes in R2.

## Under load

The round's 20 new and changed test files (542 tests) were run together under `taskset -c 0,1` in R2, on both of CI's builds: the default, and preprod-only (`VITE_ENABLE_MAINNET=false`).

- **The command as given runs one worker.** Vitest takes two CPUs for one worker (`availableParallelism() − 1`), so the files go one after another, each test with a core of its own. That's the two plain runs.
- **The contended runs give the same two CPUs three or four workers** (`--maxWorkers`), as a runner slower than this machine, or one doing more at once, would. CI's `ubuntu-latest` has four vCPUs, so three workers.

| Run | Build | Workers | Wall | Result | dapp-ties-accounts `:186` | Slowest at the 5 s default |
|---|---|---|---|---|---|---|
| unconstrained, for reference | default | 11 on 12 CPUs | 158 s | 542/542 | 2.42 s | that test |
| plain-default-1 | default | 1 | 521 s | 542/542 | 1.20 s | 1.66 s, dapp.test.ts "reads a site's transactions one at a time…" |
| plain-preprod-1 | preprod-only | 1 | 476 s | 542/542 | 1.16 s | that test |
| w3-default-1 | default | 3 | 440 s | 542/542 | 2.93 s | 3.24 s, dapp.test.ts `:1404` "private CIP-30: … answers a site that names another account's recent transaction…" |
| w3-preprod-1 | preprod-only | 3 | 438 s | 542/542 | 2.75 s | 3.28 s, dapp.test.ts `:803` "reads a site's transactions one at a time…" |
| w4-default-1 | default | 4 | 440 s | 542/542 | **4.15 s** | that test; then dapp.test.ts `:1404` 4.06 s and `:803` 4.04 s |

- **Nothing timed out, failed or flaked** in the five runs.
- **Three tests at Vitest's 5 s default come within a second of it** with four workers on two CPUs (r2-tests#2): dapp-ties-accounts.test.ts `:186` at 4.15 s, and dapp.test.ts `:1404` and `:803` at about 4.05 s. The first is the test the guard lane saw time out at 5.7 s. All three are older than this round, which added no work to them.
- **The round's new tests are well inside their limits.**
  - Every one that builds a chain runs under a 60 s timeout (`CHAINS`, or its describe's own). The slowest was 4.67 s, lovejoin-reward-balance's "across pools…" with four workers.
  - Those at the 5 s default took at most: dapp-lovejoin-rewards 1.30 s, dapp.test.ts's two refusals of a payment into a pool's account (`:608` and `:1515`) 1.44 s, staking's extended test 1.59 s, and the screens and koios tests 0.01 s.

## The new Rust tests in a debug build

CI runs `cargo test --workspace --locked`, which is the test profile, unoptimized. All times were taken in R2.

- **Each new test alone, at full speed:**
  - core: `v2_pools_…` 2.11 s, `every_chain_…` 1.22 s, `the_classic_pools_…` 0.69 s, the extended `a_chains_first_mix_…` 0.43 s, `a_withdraw_refused_…` 0.12 s, `a_pool_named_twice_…` 0.00 s;
  - wasm: `mixing_again_…` 0.87 s, `the_collateral_mix_built_again_…` 0.61 s, `a_direct_returns_tail_…` 0.55 s, `a_box_brought_back_paid_…` 0.49 s, `a_chain_across_pools_…` 0.45 s;
  - the extended cip30 test 1.37 s, and the proven bytes 0.01 s.
- **Their targets on two CPUs** (`taskset -c 4,5`), with the new tests and without them:
  - core `lovejoin_pools_test`: 8.9 s against 4.9 s;
  - wasm `lovejoin_test`: 17.8 s against 14.6 s;
  - core `lovejoin_test` 2.2 s, `lovejoin_proven_bytes_test` 0.01 s, and `cip30_test` 40.8 s, all of which it already took.
- **That's about 7 s more,** and the one new test binary (`lovejoin_proven_bytes_test`) compiles and links in 2.0 s. Nothing near libtest's 60 s warning: not slow enough to matter.

## R2, shared

Other round-two reviewers worked in R2 while I did. So every run of mine checked the tree before and after, and the load runs sampled it every 5 s.

- **One revert run saw another's change.** `r2-screens` reverted `koios.ts`, and added its own repro, during my B3 run (01:11). B3 runs the screens test alone, which doesn't import koios.ts. The harness stopped there, and B3 was run again afterwards.
- **From then on** the harness waited for a clean tree before each revert and recorded anything else changed during it. Nothing was.
- **The load runs:**
  - During the first plain run, another reviewer's Rust mutants of `seedelf-core/src/lovejoin/mod.rs` were in place. The TypeScript tests run the merged `wasm/pkg`, never the Rust source.
  - During the plain preprod run, `src/background/lovejoin.ts` was changed from 01:25:53 to 01:26:18. Only lovejoin-planner.test.ts was running, and it had loaded its modules at 01:25:34, before that.
  - The first contended run met another reviewer's 12-file mutant run, with its `lovejoin.ts` change in place. I stopped it and threw it away.
  - The contended runs since then wait until the tree is clean and no other Vitest runs in R2. A run that sees another's change to the extension is run again.
  - w3-default-1 saw a 25-second `lovejoin.ts` change (01:37:39–01:38:04), but none of its files started in that window: each had loaded its modules before or after it. I kept it, and stopped its rerun.
  - w3-preprod-1 and w4-default-1 saw nothing.
- **Nothing of mine is left.** No result above comes from a tree with another's TypeScript change in it. Others' files are theirs: I touched none.
- **For the lead:** several reviewers revert files in R2 at once, so a run can load another reviewer's mutant without knowing it: a 30-second revert inside someone's test run leaves `git diff` clean before and after. A worktree each, or a lock file the revert scripts take, would rule that out.

## Checked, and it held

- Every fix in the merged diff, reverted alone in R2, is caught by its tests (the tables above). The weakest holds are one test each: R2, R2b, R3a–R3d, R4a, R5, R5a, R6a, R7b, B1–B5 and G2a/G2b.
- mutants#9 is held by the typecheck alone, as the guard lane said.
- The lead's T12c holds withdrawOne's `REWARDS_MOVED()` at PV10 and PV11. The merged `refusing(t, refusal, count, then)` keeps T12d's kill at both.
- `NOT_IN_REWARDS` is declared below its first `it.each`, which is fine: Vitest runs describe bodies after the module's import, and all four cases ran in every run.
- The lead's lovejoin.test.ts edit makes "builds the chain again from a fresh read…" a before/after test of v-pv11-impact#2.
- The guard lane's `lovejoin: t.lovejoin` adds no work to dapp-ties-accounts: `t.lovejoin` is built eagerly (`tests/fakes.ts:734`), and that file's transactions name no script's reward account, so the guard never runs there. Its load sensitivity predates this round. dapp-ties.test.ts does name one (`f0cd…` at `:454`), so the guard now runs once there: one `mixLogicHashes`, asking nobody.
- CLAIMS.md:19, `seedelf-platform/CLAUDE.md:86` and `extract-lovejoin-v2.sh`'s comment name `wasm/tests/lovejoin_proven_bytes_test.rs`, which exists and holds what they say: P5 fails both of its tests. `bash -n extract-lovejoin-v2.sh` is ok with the lead's comment.
- The private Mix again's variant of r2-tests#1 was read in the code only: fanOut `:3794-3799`, then sessions.ts `:4662` and `:6321`.

## Scratch

`/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/cfcbd3c7-4fba-46f9-8be7-526fb876c645/scratchpad/review/r2-tests/`:

- `revert.py`, and `ts/reverts.jsonl` with each run's report and log;
- `rust/mutate.py` and `rust/run.out`;
- `typecheck.py` and `ts/typecheck-*.log`;
- `repro.py`, `zz-r181-r2-tests-1.test.ts` and `-2`, and `ts/repro-*.log`;
- `load/` (each run's JSON, output and tree samples, `report.py`);
- `verif/` (the copies the verif lane's checks ran on).
