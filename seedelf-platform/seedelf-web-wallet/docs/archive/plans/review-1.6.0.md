# 1.6.0's release review, its fix rounds and the gate (2026-10-24/26)

**Status: ✅ done, the gate for 1.6.0.** It's on branch `web-wallet/review-1.6.0` (PR #324), and every step of the Web Wallet check is green. The working folder (`docs/plans/review-1.6.0/`: the findings, the briefs, every fixer's and reviewer's report) was compressed into this file when the PR was ready, at the owner's word (2026-10-26). The full text is in git at `7e2d89ed`; [The IDs](#the-ids) says where each family is. What still holds is in the design docs, the open items in [post-release-roadmap.md](../post-release-roadmap.md)'s *Left by 1.6.0's release review*, and the release's record in [chunk-34-token-pools.md](chunk-34-token-pools.md)'s Session 12.

## The review

**What it covered:** every PR since 1.5.0, #308–#323. That was 33 slices: one reviewer for each small PR, and two to five for each large one (#314, #317–#321, #323). Then 7 lenses across them:
- privacy;
- the 1.5.0 upgrade and the classic pool;
- release readiness;
- Spanish, and Japanese;
- two end-to-end scenario walks.

A completeness critic named 3 gaps, each probed. A skeptic per slice tried to refute every finding, and every high and medium was reproduced independently, mostly by a throwaway test that failed on the review's HEAD (`499768f6`). That made 83 agents.

**136 findings:** 8 high, 8 medium, 78 low, 22 nits, 16 owner's calls, 4 refuted.

**The highs came down to three problems:**
1. **Every private Bootstrap failed** (318-rust#0, 323-rust#0, x-scenarios-lj#0). Session 11's call 4 (`62162483`, *a Bootstrap needs no collateral*) left the deposit's change too small to pay its sweep back. Two unit tests went red with it (x-compat#0, docs-small#0, x-release#0), so `main`'s Web Wallet check stayed red from #323 on, and its e2e never ran on that tree. #323 merged while its check was still running.
2. **A hostile pool** (314-wasm#0): a launch whose script output carries a deeply nested datum overflowed the WebAssembly's stack as pools were verified, and every mainnet wallet that read it locked itself.
3. **Two Bootstraps in one pool** (316#0): a box brought back by hand was credited to the wrong one.

**The mediums:**
- Bring every box back now ended before a just-sent chain's boxes landed (321-lj-worker#0);
- the swap and site approvals left the collateral's mix out of their totals (323-worker#1);
- Remove wallet went ahead while a payment's parts waited (gap-1#1);
- a restored session funded in parts brought back one part's tokens (x-scenarios-sessions#0);
- a public Bootstrap's banner named the private balance (318-worker#0);
- a public deposit's box lost its tie (316#1);
- the Collateral page raced Home's watch (309#0);
- the live run still owed (x-release#1).

## The fix rounds

The laptop crashed under the load as the first fixers worked. The round went on from that commit (`d5fa7ede`) on the desktop, through workflows of fixers working in one tree, each writing its test first, seeing it fail, then undoing its fix to see the test fail again:

| Round | What | Commit |
|---|---|---|
| A, repaired | the interrupted fixers' Rust, formatted and made to build | `9978654a` |
| 1 | 16 fixers in three lanes: the private Bootstrap (its funding carries its 1.5 ₳ way back), the hostile pool (a depth check in core, WebAssembly and the data layer; a RangeError resets the instance), the Lovejoin worker, the Rust, the docs and the translations; 84 fixed, 10 in part | `fc8561c7` |
| 2 | 5 fixers: the screens, and round 1's leftovers in the worker; 36 fixed | `e43eef7f` |
| prep | `vitest` 5.0.3; the token, DRep and pool lists refreshed | `8cd8ce08` |
| 3 | **a review of both rounds**: 10 lenses (money, records, Rust, the data layer, privacy and words, screens, a mutation check of the fixes' tests, completeness twice, where fixes meet), merged and refuted: 31 confirmed (R3-1 to R3-31), 19 low and 12 nits, none high or medium; every high and medium fix's test fails without it | `56dce2cd` |
| 3b | 6 fixers on R3 and the leftovers L1–L4; two fresh reviewers on just those fix-ups | `3ea05dc1` |
| 3c | fx-last on that last look; the docs from 161 fixers' items, checked against the code | `677715db` |
| 3d | **one rule for the collateral's mix:** each look had found a new edge where a screen predicted that mix wrongly, so the worker decides it once (`CollateralMix`): "mixed" only where the funding paid the reserve and the return keeps it, "mixed only if enough is left" (with giveme.my's part) wherever a 5 ₳ pool may take it, nothing where no mix can go | `22acd30e` |
| 4 | fx-may's two missing "may"s; the Spanish and Japanese of the 92 changed keys reviewed, the 19 critical ones back-translated blind by fresh agents shown no English and no key names (two drifts fixed and passed again) | `22acd30e` |
| 5 | LIVE-1, from the live run: a chain cut once its mixes went, whose rebuilt tail and return landed, read "stopped partway" (`carriedOf`; fx-cut, fx-cut-2) | `7e2d89ed` |

## The live run (preprod, 2026-10-26)

A dev build of `22acd30e`, with the real giveme.my. The wallet was fresh, funded from test wallet A's public account in node, so that A, which holds 64 Bootstrap boxes, was never restored. Three checkers then read each transaction back from its own CBOR: every proof, register, signature and value checks out.

| What | Transactions |
|---|---|
| A private Bootstrap: one 13 ₳ payment, a 10 ₳ box in the classic pool, the change swept back with nothing put up (its Seedelf output 1.32 ₳ over the least; without the reserve 0.18 ₳ short) | `313e4979`, `90659b0d`, `462ed023` |
| A private mix with its collateral's mix, the wallet locked mid-chain and unlocked: the rebuilt tail's deposit, **the collateral's mix under giveme.my's collateral** (x-release#1: giveme.my backs that shape), the return | `6ad1bad1`, `17944d29`, `a36ee6c8`, `41afe1d6` |
| The release harness: `e2e/live/run.mjs all` (six transactions) and `staking` (three), the second after its review buttons were named | all confirmed |

The full hashes are in the plan's Session 12.

## The checks, on `7e2d89ed`

- Rust: fmt, clippy `-D warnings`, and 684 tests.
- The WebAssembly built, and `node --test` 57.
- `tsc` clean.
- Vitest: 2,894 on both builds, the critical-key gate included, with no failure for the first time since #323.
- e2e: 104/104 on the dev build and on the store build, and the data layer's 3.
- The data layer: fmt, clippy, and 126 tests.
- PR #324's Web Wallet check: every step green.

## Lessons

- **Predictions on screens don't converge.** Each narrow look found a new case where a review promised the collateral's mix wrongly. One rule decided in the worker, with a conditional wording where it can't know, closed the class.
- **The release harness rots unseen.** Round 1 fixed its labels, but a staking review's button had said the act since ST-2, and its guard test couldn't see that, since "Send" is a word elsewhere. Only a live run caught it.
- **A reviewer agent once ran the data layer's API server** from `seedelf-data/target/`, taking it for a test. It read `.env` and was connected to home's mainnet services for two minutes, sending nothing. Agents never run a binary there.
- **The 2-CPU stress** times out the long Lovejoin mix e2e (19.6 s in a normal run, and it passes on CI): leave it.

## The IDs

The code, the tests and the docs cite these by ID. Their full text is in git at `7e2d89ed`, under `seedelf-platform/seedelf-web-wallet/docs/plans/review-1.6.0/`. For example: `git show 7e2d89ed:seedelf-platform/seedelf-web-wallet/docs/plans/review-1.6.0/FINDINGS.md | grep -n -A40 '^## 318-rust#0$'`.

| IDs | What | File at `7e2d89ed` |
|---|---|---|
| `<PR>#<n>`, `<PR>-<area>#<n>` (e.g. `316#0`, `318-rust#0`), `x-<lens>#<n>`, `gap-<n>#<n>`, `docs-small#<n>` | the review's 136 findings, cited as "1.6.0's release review, …" | `FINDINGS.md`, and `HANDOFF.md`'s index |
| `R3-1` … `R3-31` | the review of the fixes, cited as "1.6.0's review of the fixes" | `review/CONFIRMED.md`, and each lens's `review/<lens>.md` |
| `L1` … `L6` | its known leftovers | `REVIEWBRIEF.md` |
| `LM-<n>`, `LW-<n>`; `last-3c`, `last-3d`, `last-3e`, `last-5`, `last-5b` | the narrow looks at each round's fix-ups | `review/last-money.md`, `last-words.md`, `last-3c.md` … `last-5b.md` |
| a fixer's name (`bootstrap`, `wlj-1`, `deep-datum`, `reserve`, `fx-promise`, `fx-may`, `fx-cut`, …) | each fixer's report: its findings, tests, calls | `fixes/<name>.md` |
| `LIVE-1` | the live run's finding | the plan's Session 12, and `fixes/fx-cut.md` |
