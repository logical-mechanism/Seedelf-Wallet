# r2-tests (r2-tests)

5 finding(s).

## r2-tests#1: The suite's new bound names the bounty, but no suite shape reaches the bounty's code, so 1.9.0's chained still passes the whole suite

- **Severity:** nit; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-web-wallet/wasm/tests/payment_parts_shapes_test.rs:707`
- **Since:** new in the fixes (the comment); the reach gap is older (tests#6)

**What.** The bound's comment (lines 707-710) names two overpayments it catches: shapes#1's token boxes, and 'a part of ADA alone after the tokens can pay more than was still owed (the bounty report against 1.9.0)'. The suite only reaches the first. With shapes#1 reverted (R1), it flags 2 of 592 asks. With 1.9.0's `chained` swapped in (c), it reports 0 with problems, and every outcome line matches 23ca5f20's once timings and Max's last cent are stripped. That is round one's tests#6, still open. The check itself works: given the report's shape directly, `check_parts` flags c's plans both at asked 0 and at the tokens' least + 1. The second case is the one the older 'pays after' check misses. CI isn't blind to the bounty: #384's api test kills c. Only the release-time suite is.

**Scenario.** Revert #384 (c: c0b451a8's `chained` in 23ca5f20's lib.rs). Run the suite: '0 with problems, 108 refused, 0 of them Max', exit 0. Meanwhile 1.9.0 overpays the bounty's shape by 0.978 ₳ to an address or 1.457 ₳ to a Seedelf, plus a fee of about 0.23 ₳.

**Evidence.** Suite runs (`cargo test -j 4 --locked --release -p seedelf-wasm --test payment_parts_shapes_test -- --ignored --nocapture`):
- 23ca5f20: '0 with problems, 108 refused, 0 of them Max' (409 s)
- R1: '2 with problems' (231 s), both token boxes x90 at 600‰ ADA + all T: '! paid 244633490 > asked 243000000 and the token parts' leasts 8167450' (transfer) and '! paid 244155080 > asked 243000000 and the token parts' leasts 5775400' (withdraw)
- c: '0 with problems, 108 refused' (275 s); `diff` of the normalized logs against 23ca5f20 is empty

Probe `r2_bound_probe` (appended to my copy of the suite file; it feeds the bounty's shape to `check_parts`, with 10 tokens x2, bundles of 20 at their least and 300 ₳ holding 2 of each):
- 23ca5f20: 1 part, no problems, for every ask
- c, withdraw asked 0: ['part 1 pays after the payment was all paid', 'paid 4809960 > asked 0 and the token parts' leasts 3831590']
- c, withdraw asked 3831591: ['paid 4809960 > asked 3831591 and the token parts' leasts 3831590'] (the new bound only)
- c, transfer: 5766780 > 4310000 / 4310001

**Suggestion.** Add the report's shape to `shapes()` with its own ask: 2 of each of 10 tokens, asked 0 and asked the least + 1, transfer and withdraw. The per-mille asks can't express it: 1000‰ asks all 5,002 of each, and 0‰ asks none. Or narrow the comment to shapes#1.

## r2-tests#2: The suite's bound counts every output to the recipient's address, so a session funding would be flagged by its own collateral

- **Severity:** nit; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-web-wallet/wasm/tests/payment_parts_shapes_test.rs:741`
- **Since:** new in the fixes

**What.** `inspect` counts every output to `to_address` as paid (lines 536-546), and the bound compares that total with `w.max(leasts)` (line 741). A session's funding sends its payment and the account's 5 ₳ collateral to the same one-time account: sessions.ts builds both with `to: address` (sessions.ts:1933-1943). Funding the bound would therefore flag every funding by its collateral, and by any reserve paid beside it. The suite builds no fundings today, so no false flag is reachable now. But round one suggested adding funding shapes (tests#2, chain-rust), and doing so would trip this. Also wording: with no token sent, the message says 'the token parts' leasts 978370' for an ADA-alone output's least.

**Scenario.** Feed `check_parts` a 10 ₳ funding over 5 UTxOs of 20 ₳, with the account's 5 ₳ collateral beside it, both to the same address. It reports 'paid 15000000 > asked 10000000 and the token parts' leasts 978370', on a plan that is right.

**Evidence.** Probe `r2_bound_probe` at 23ca5f20:
`R2BOUND funding 10 ADA + its 5 ADA collateral, to the account: 1 part(s) [1in/694B/v5] paid 15.00 ADA, 0 token kinds ["paid 15000000 > asked 10000000 and the token parts' leasts 978370"]`

The request: `payments: [ {to, 10_000_000, []}, {to, 5_000_000, []} ], funding: Some(Funding { session: Some("session:9") })`, checked with `check_parts(&ada, sk, Some(&to), cbors, Some(10_000_000), &BTreeMap::new(), None)`.

In the same run, asks of nothing pass: withdraw asked 0 pays 0.98 ₳, transfer asked 0 pays 1.46 ₳, with no problems.

**Suggestion.** If fundings join the suite, add the payments beside the first to `w`. Or skip an output that is the collateral (exactly 5 ₳ of ADA alone to the account), as api_test's `collaterals()` spots it. Say 'an output's least' when no part sends a token.

## r2-tests#3: Both new bounds grow with the plan's own token split, so a plan that splits tokens more than it must passes them

- **Severity:** nit; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-web-wallet/wasm/tests/payment_parts_shapes_test.rs:732`
- **Since:** new in the fixes

**What.** The suite's bound (lines 732-741) and #384's api bound (api_test.rs:4500-4507) both add up the leasts of the parts that send tokens, as the plan split them. An extra token part therefore raises the ceiling by its own least, and the comment's 'Nor more than they must' holds only relative to that split. Mutant X (`Room::new()`'s `h` capped at 10 holders, so token parts split more) passes the token boxes x90 shape with no problems while paying more. api_test does catch X, through three part-count tests: `a_funding_in_three_parts_or_a_chain_pays_the_accounts_collateral_once` and both `all_of_a_token_in_more_utxos_than_one_transaction_spends…`. So CI isn't blind; the bounds alone are. In #384's api test a stricter bound is free: at 23ca5f20 all 12 cases are one part paying exactly `asked.max(least(&sold))`.

**Scenario.** Mutant X, token boxes x90, 0‰ ADA + all T:
- transfer: 8 parts paying 13.07 ₳, against 5 parts and 8.17 ₳ at 23ca5f20
- withdraw: 9.24 ₳ against 5.78 ₳
- at 500‰ of T: 6.53 ₳ against 4.90 ₳
Each adds 3 or 4 more fees. The suite: '0 with problems'.

**Evidence.** `ONLY="token boxes x90" cargo test --release … --test payment_parts_shapes_test -- --ignored --nocapture`:
- 23ca5f20: `ok  transfer amount 0‰ ADA + 1 token(s) at 1000‰ 5 part(s) [..] paid 8.17 ADA`
- X: `ok  transfer amount 0‰ ADA + 1 token(s) at 1000‰ 8 part(s) [..] paid 13.07 ADA`, and '0 with problems, 0 refused'

api_test under X: 'FAILED. 88 passed; 3 failed'.

Assertion matrix (my `r2_probe_test.rs`), 23ca5f20: `request_bound=true` in all 12 cases of #384's test.

**Suggestion.** In #384's test, also assert `paid.len() == 1` and `total == asked.max(least(&sold))`. Both hold at 23ca5f20, and this is round one's tests#4 suggestion. For the suite, say in the comment that the bound is relative to the plan's split.

## r2-tests#4: chain_end_tests: its comment puts the one-time account's 5 ₳ collateral in a chain that never pays it, and its 'window closed' failure also fires when the window has only moved

- **Severity:** nit; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:5247`
- **Since:** new in the fixes

**What.** `chain_from`'s doc (lib.rs:5247) says the chain has 'the one-time account's 5 ₳ collateral beside'. But the test calls `chained(&from, false, MAX_PARTS - 2, …)` (lib.rs:5326-5328), so `starts` is always false. `with(…, first = false, …)` then sends `beside = &[]`, and the request's second payment is never paid. The constructed state also isn't exactly what `build_withdraw_parts` gives a wallet holding H alone: that is anchor 0, with `first` true and the collateral paid.

The window is real and steady. Over 30 runs it is [1,211,545 to 1,211,666, 1,221,134) lovelace past H's least, 9,468 to 9,589 wide. That width is exactly SPEND_BUDGET_GUESS less the measured budget, at the fixture's prices: (100,000 − 76,043) × 0.0577 + (450,000,000 − 337,845,799) × 0.0000721 = 9,468. The upper edge is fixed, and the lower one moves about 120 lovelace with the random proof. Five of the 20 scan points fall inside it in every run, so the test isn't flaky.

Two changes close it, and the test then fails as designed:
- give a funding's amount the measured fallback, by dropping `request.funding.is_none() &&` at lib.rs:3571 (mutant W1: the amount builds at 1,212,000);
- bring SPEND_BUDGET_GUESS down to the measured budget.

It prints the same 'the window this test reaches closed' when the window merely leaves the fixed scan (lib.rs:5349, 1,200,000..1,240,000): a shift below −21,134 or above +26,334 lovelace from a change to fees or leasts. That message then says the wrong thing.

**Scenario.** Under W1, the funding's amount is measured too: 'R2SCAN 1212000: parts=1 carry=None change=1457114', and the test fails with 'no funding here ends on its carry: the window this test reaches closed', which is right. Change the fixture's fees or coins_per_utxo_size enough to move the window more than about 0.02 ₳ and it fails with the same message, though the window is still about 9,468 wide.

**Evidence.** Probe in my worktree's `chain_end_tests` (copy kept in SCRATCH/review-1.9.1/r2-tests/kept/lib-with-probe.rs):
```rust
fn r2_outcome(extra: u64) -> u8 { match chain_from(extra) { Err(_) => 0, Ok(p) if p[0].carry.is_some() => 1, Ok(_) => 2 } }
// per run: bisect [1_100_000, 1_400_000] for the first extra that goes, then for the first that goes as an amount
```
`RUNS=30 … r2_window_edges --ignored --nocapture` gave 'goes from 1211545..1211666, amount from 1221134..1221134, width 9468..9589, scan points inside 5..5'.

A scan at 500-lovelace steps: ERR to 1,211,000; carry from 1,211,500 ('carry=Some("1456916") change=0 fee=232994'); amount from 1,221,500.

Mutants:
- b (no end after the carry): FAILED 'window closed'
- e6 (end before the push): FAILED '1212000 past H's least, left: 0, right: 1'
- c: FAILED 'window closed'
- e4 and e5: ok (with one token and one carry, the plan is the same)

**Suggestion.** Drop the collateral from the comment (or from the request). Find the lower edge by bisection, as the probe does, or first assert that the scan starts short and ends on an amount. Then a shift reads as 'the scan no longer brackets the window', and only a closed window says 'closed'.

## r2-tests#5: wallet.test.ts: the fix round raised only the create test's timeout for Argon2id; its neighbour, the password change with about seven seals and opens, times out at the default 5 s on two CPUs

- **Severity:** nit; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-web-wallet/extension/tests/wallet.test.ts:301`
- **Since:** older (1.9.0)

**What.** c3d24629 gave 'creates a wallet…' 20 s ('An Argon2id seal and an open: slow on a busy machine'). Under `taskset -c 0,1` that test took 0.4 to 2.1 s in 8 runs, well inside 20 s. 'changes the password: the new one unlocks, the old one doesn't' runs about 7 Argon2id operations (create, a wrong-password change, the change, two unlocks, the reveal) under the default 5,000 ms, and timed out in 2 of the 6 runs I logged. CI's last 40 web-wallet runs show no such failure: the only failure is #384's first-word vault flake. Separately, its `expect(after!.createdAt).toBe(before!.createdAt)` (line 313) compares undefined with undefined. `create` writes no `createdAt`, which the new structural check (line 49) now proves, so that assertion can't fail.

**Scenario.** `taskset -c 0,1 npx vitest run tests/wallet.test.ts tests/payment-parts-review-fixes.test.ts`, on a machine already loaded by other builds: '× … changes the password … 5035ms → Test timed out in 5000ms' (run 4) and '5018ms' (run 6). Otherwise it took 1.2 to 4.0 s.

**Evidence.** Logs: SCRATCH/review-1.9.1/r2-tests/ts-taskset-run4.log and run6.log. Run 3 also ended '1 failed | 33 passed', with the name not captured. `gh run list --workflow web-wallet.yml --limit 40` shows one failure, 43617427391: 'expected … not to contain 'toe'', the old vault check.

**Suggestion.** Give the password test the same 20 s (or 30 s, as the restore test has). Drop or rewrite the `createdAt` assertion: an old record that has `createdAt` should lose it at a change.

## Checked and holds

- Every Rust test the fixes added fails with its own fix reverted alone in my worktree at 23ca5f20, and passes with it (table in coverage). The refusal test is a guard on `owed == 0` (it kills e4), not a fail-before test: 1.9.0's chained (c) refuses that ask too.
- Two mutants each kill api_test's three-parts test, with the same message 'left 51758480, right 50000000': R1 (`least(&later)?` without `.max(reserved)`) and R1b (`reserving` returns the first plan). The matrix puts every case at 50 ₳ at 23ca5f20; under R1 they pay 51.76, 51.28, 55.28 and 53.84 ₳.
- #384's bound, now over the token parts only, fails on its own under c (8 of 8 overpaying cases) and under a (4 of 4). The old all-parts bound held in all of them, so round one's tests#4 is resolved.
- The funding first-part test kills e2 ([0]) and c ([1, 0]). Under a (no amount-first) it passes, and that plan is right: one carry part pays the tokens at their least plus the collateral, and carry_kept counts the carry as change.
- The carry test kills R2 at its first assertion. Its conservation check (inputs = payments + fees + counted change) fails too if the carry is uncounted.
- chain_end_tests isn't flaky. Window [1,211,545 to 1,211,666, 1,221,134), 9,468 to 9,589 wide over 30 runs, with 5 of its 20 points inside every time. The scan is monotonic: the upper edge is fixed and the lower one moves about 120 lovelace. It kills b, e6 and c.
- The suite at 23ca5f20 gives 0 with problems and 108 refused over 592 asks. Its bound flags shapes#1 (R1: 2 asks), skips Max and Everything (`max_tokens.is_none()`), and doesn't flag an ask of nothing raised to an output's least (probe: 0.98 ₳ withdraw, 1.46 ₳ transfer).
- The new Rust tests have no timing or threshold sensitivity. Their random fee jitter (120 to 300 lovelace) sits far from every threshold: a 300 ₳ UTxO, 150 ₳ asked of about 117 ₳ spendable, and `reserving`'s takes differing by at least one output's least. Rust tests have no timeouts.
- Debug times, alone and then on two CPUs beside a load: three-parts 11.4 s / 26.0 s; carry 1.8 / 3.7; funding 0.8 / 1.7; refusal 7.5 / 15.7; #384's 7.8 / 17.1; chain_end 0.7 / 1.4. The whole api_test in debug on two CPUs takes 149 s for 91 tests. The fixes add about 22 s of debug CPU.
- TS least tests pin both sides. The old condition (T1) fails 'is none…' with 'expected '3870000' to be null'. A `whole` that never names a least (T2) fails 'adds up…' with 'expected null to be '4826000''. Both take 0 ms.
- The structural vault check can't flake (it searches no text) and catches all 8 leaks I tried. #384's regex missed 6 of them (numbered words in the record, a word per key, the blob sealing the phrase's text, sorted words, numbered words in another key, createdAt back). 1.9.0's first-word check missed 2 (the blob sealing text, createdAt).
- `reserving`'s guard (no more parts, no more carries, takes less) never decides a test. Mutant G1, which always takes the second plan, leaves api_test (91 passed) and the suite (identical lines) unchanged. Only the 'takes less' direction is pinned, through R1b.
- I never wrote in the release tree. My vitest runs used a shadow node_modules (links to the release tree's packages) with its own .vite cache. The release tree's results.json (265 files, 12:33) is someone else's full run.

## Coverage

Before and after (the table asked for). 'Before' is the fix reverted alone in my worktree at 23ca5f20; 'after' is 23ca5f20. Rust times are debug, alone and then on two CPUs beside the rest of api_test.

| Test | Fix it guards | Before (reverted) | After | Time |
|---|---|---|---|---|
| api `an_amount_whose_token_takes_three_parts_or_more_pays_what_was_asked` | shapes#1, lib.rs:4163 `.max(reserved)` and `reserving` | R1 and R1b: FAIL, '61 boxes, to a Seedelf true: paid what was asked, left 51758480, right 50000000' | ok | 11.4 s / 26.0 s |
| api `a_carry_no_later_part_spends_counts_as_its_parts_change` | carry_kept | R2: FAIL, 'part 0 carries what no later part spends' | ok | 1.8 / 3.7 |
| api `a_funding_whose_chain_ends_at_its_first_part_pays_the_accounts_collateral` | #384's amount-first told `starts` | e2: FAIL [0] vs [1]; c: FAIL [1, 0]; a: ok (same money) | ok | 0.8 / 1.7 |
| api `an_amount_the_balance_cant_pay_is_refused_never_paid_in_part` | `owed == 0` at lib.rs:4318 | e4: FAIL (`build_transfer_parts` is Ok); c: ok (a guard, not a fail-before test) | ok | 7.5 / 15.7 |
| api `a_chain_ends_with_the_part_that_sends_the_last_of_the_tokens`, its bound over token parts | #384 | c: FAIL, 'part 1 pays after the payment was all paid'; a: FAIL, 'asked 4310001: a part of ADA alone'; the bound alone is false in 8/8 (c) and 4/4 (a) | ok, 12/12 one part | 7.8 / 17.1 |
| lib `chain_end_tests::a_chain_its_carries_paid_ends_on_the_last_carry` | #384's end after a carry | b: FAIL 'window closed'; e6: FAIL '1212000: left 0, right 1'; c: FAIL; e4, e5: ok | ok | 0.7 / 1.4 |
| suite bound in `check_parts` (release) | shapes#1 | R1: 2 with problems (token boxes x90 at 600‰ + T); c: 0 with problems | 0 with problems, 108 refused | 409 s release, loaded |
| TS 'is none where a part sends no token' | ts-parts#2 | T1: FAIL, 'expected '3870000' to be null' | ok | 0 ms |
| TS 'adds up the parts' leasts…' | guards the other side | T1: ok (by design); T2: FAIL | ok | 0 ms |
| TS wallet.test.ts create, the structural vault check | the vault holds entropy only | all 8 vault leaks: FAIL | ok | 0.4 to 2.1 s of 20 s on two CPUs |

Mutants:
- R1: `.max(reserved)` dropped.
- R1b: `reserving` returns the first plan.
- R2: `carry_kept` returns at once.
- e2: `starts` → `false` in the amount-first.
- e4: `if tokens.is_empty()`.
- e5: `if owed == 0`.
- b: no end after a carry.
- e6: the end before the push.
- a: no amount-first.
- c: c0b451a8's `chained`.
- G1: `reserving` with no guard.
- X: `Room::new` h = 10.
- W1: a funding's measured fallback.

Not covered:
- e5 (`owed == 0` alone) still survives everything, chain_end_tests included. By arithmetic it would end a chain with tokens unsent once its token carries make more outputs than the payment's 20-token chunks, with 3 or fewer tokens left. I didn't build such a shape: plausible only.
- No api_test timing at 3063b33f to compare against.
- The full vitest suite on two CPUs: I ran only the two changed files, 9 times.
- `reserving`'s second plan timed in WebAssembly.

Kept in SCRATCH/review-1.9.1/r2-tests/:
- mutants/: snippets, logs and times.
- kept/: r2_probe_test.rs (assertion matrices), lib-with-probe.rs (window probes), payment_parts_shapes_test-with-probe.rs (`r2_bound_probe`).
- suite-*.log and *.norm.
- window-edges.log and window-scan-500.log.
- ts-taskset-run*.log.
- swap.py, mutate_c.py, run_mutant.sh and run_suite.sh.

Both worktrees are removed. The cargo targets ~/.cache/seedelf-review-1.9.1/r2-tests-tree and r2-tests-suite remain. Per R2BRIEF, no report.md was written.
