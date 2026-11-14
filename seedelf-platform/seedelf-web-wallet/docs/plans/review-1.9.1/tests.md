# tests (find:tests)

7 finding(s).

## tests#1: A short last-of-tokens amount carries instead of taking more ADA, so a near-max payment the planner can make is refused

- **Severity:** low; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:4296`
- **Since:** unchanged from 1.9.0

**What.** In `chained`, the part that sends the last of the tokens first tries `amount` over its lean picks. When that's short, the closure swallows the error (`Err(e) if build::is_short(&e) => {}`) and carries. So `fit_part` never gets the short back to add a UTxO of ADA (`Room::for_ada`). The next part then has to pay the rest from the carry and what's left; near the most the balance can pay, that's short, and the payment is refused.

Two alternatives pay it. Mutant e7 removes the fallback. Variant e8 (`SCRATCH/review-1.9.1/tests/mutants/lib.rs.e8`) runs `fit_part` with the amount alone first, which lets it add ADA, and falls back to #384's amount-or-carry on any error. Under either, the suite pays 2 more of its asks with no problems and changes no other amount plan. `api_test` passes under both: 87 under e7; 89 under e8, counting the two new tests below.

Not a regression: 1.9.0 always carried, and its suite run refuses the same two asks.

**Scenario.** Suite shape "poor holders x19 (T + 8) + ada x10", 900‰ ADA plus all of T, as transfer and as withdraw: asked 533.1 ₳ of at most 536.3 ₳ (fees aside).
- 3063b33f and 1.9.0: "ERR Not enough ADA in the Seedelf balance for this, its fee and the change".
- e7 and e8: "2 part(s), 1 chained [13in/10027B 17in/7543B] paid 533.14 ADA, 1 token kinds", every suite check passing.

**Evidence.** Instrumented trace of the transfer (`suite-x19-probe.log`), chain from anchor 0:
```
PROBE chained: last-of-tokens amount SHORT -> carry (owed 533136600, least 1633490)
PROBE chained: carry (more false) OK
PROBE chained: after carry, owed 531503110, tokens 0
PROBE chained: top amount ERR Not enough ADA in the Seedelf balance for this, its fee and the change
```
The chain from anchor 1 does the same, and the payment is refused.

Suite tallies (`cargo test -j 4 --release -p seedelf-wasm --test payment_parts_shapes_test -- --ignored`):
- 3063b33f: 0 with problems, 108 refused
- c (1.9.0): 0, 108
- e7: 0, 106
- e8: 0, 106

Diffing the amount lines (timings stripped), 3063b33f vs e7 and vs e8 differ only on lines 305-306, this ask. `api_test` under e8: "89 passed".

**Suggestion.** Let the last of the tokens take more ADA before it carries: one `fit_part` pass with the amount alone, then #384's amount-or-carry where that fails (the e8 sketch). Add this suite case as an `api_test`. A second `fit_part` pass adds planning time on refusals; measure it, since the suite timings here were too noisy to compare.

## tests#2: No test covers the amount-first's `starts`, which puts a funding's collateral in the first part

- **Severity:** low; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:4294`
- **Since:** new in 1.9.1

**What.** #384 adds a path where a funding chain's first part is built by `amount`, told `starts`, rather than by `carry`. Mutant e2 passes `false` instead of `starts`. It survives all 87 `api_test` tests, and the suite has no fundings. The existing collateral test, `a_funding_in_three_parts_or_a_chain_pays_the_accounts_collateral_once`, only reaches chains whose first part carries.

**Scenario.** A funding of 2 of each of 10 tokens, in the report's shape: bundles of 20 at their least hold most of each token, and the UTxO with 300 ₳ holds 2 of each.
- 3063b33f: 1 part, collateral x1.
- e2: 1 part, collateral x0, so the session's one-time account gets no 5 ₳ collateral.

**Evidence.** Killing test, for `api_test.rs`'s `parts_of_any_shape` module, using its helpers:
```rust
#[test]
fn a_funding_whose_chain_ends_at_its_first_part_pays_the_accounts_collateral() {
    let sk = seedelf_key_v1(PHRASE, 0).unwrap();
    let sold: Vec<TokenAmount> = (0..10).map(|i| token(i, 2)).collect();
    let mut utxos: Vec<UtxoResponse> = (0..10).map(|i| { let mut held = vec![token(i, 5_000)]; held.extend((0..19).map(|j| token(20_000 + i * 100 + j, 3))); utxo(i + 1, 0, &held) }).collect();
    utxos.push(utxo(900, 300_000_000, &sold));
    let parts = api::build_withdraw_parts(sk, funding(utxos, sold)).unwrap();
    assert_eq!(collaterals(&parts), vec![1]);
}
```
Runs of `cargo test -j 4 -p seedelf-wasm --test api_test -- <name>`:
- 3063b33f: ok
- e2: FAILED, `left: [0]` `right: [1]`
- c (1.9.0): FAILED, two parts `[1, 0]`
- b, e4, e5, e6, e7: ok

**Suggestion.** Add the funding test to `parts_of_any_shape`. The full code, with comments, is in `SCRATCH/review-1.9.1/tests/probe/kill_e2.rs`, and both new tests as a diff in `SCRATCH/review-1.9.1/tests/mutants/api_test-kill-tests.diff`.

## tests#3: Only the ignored parts suite guards the early return's `owed == 0`, and the early return itself never runs

- **Severity:** low; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:4313`
- **Since:** new in 1.9.1

**What.** **`owed == 0` is load-bearing.** In a chain with no tokens left to send, `more` is always false. So every part tries the amount, and where that's short it carries, paying the recipient an output of ADA alone at its least. The check after each carry is what keeps the chain going until what's owed is paid. Mutant e4 (`if tokens.is_empty()`) survives `api_test`, and only the ignored suite kills it: 46 with problems, all "paid N < asked N". CI runs `cargo test --workspace --locked` (`.github/workflows/web-wallet.yml:109`), which skips the suite; it runs by hand at release (`docs/development.md:114`).

**The early return itself never fires.** Mutants b (no early return) and e6 (returns before pushing the carry) survive everything, the suite included. The early return needs a short amount-first whose carry goes, with nothing owed after. But the carry is the same payment plus one more output at its least, so it always needs more ADA than the amount. No shape I probed reached it: the report's shape, the same with free ADA, test wallet A with 12, 20 and 30 bundles and a second UTxO of ADA, and ADA-only chains. A funding is the one case where the amount isn't measured again on the largest UTxOs (`lib.rs:3570-3571`), so I scanned one at 0.01 ₳: no window. `docs/architecture.md:171` ("a chain its carries paid in full ends there") describes this path.

Mutant e5 (early return on `owed == 0` alone) also survives everything.

**Scenario.** Under e4: 25 UTxOs of 30 tokens each, 0.5 ₳ past their least, plus 5 UTxOs of 20 ₳ ADA alone. Asked 150 ₳, of about 117 ₳ the balance can spend.
- 3063b33f: refused.
- e4: one part paying 1,456,780 to a Seedelf (978,370 to an address), 148.5 ₳ short of what was asked.

In the suite under e4, "bundles x25 of 30 + ada x5", 600‰ ADA, "goes" as 1 part paying 1.46 ADA; 3063b33f refuses it as "asked 250.3 of at most 135.2".

**Evidence.** Killing test for CI:
```rust
#[test]
fn an_amount_the_balance_cant_pay_is_refused_never_paid_in_part() {
    let sk = seedelf_key_v1(PHRASE, 0).unwrap();
    let mut utxos: Vec<UtxoResponse> = (0..25).map(|i| { let held: Vec<TokenAmount> = (0..30).map(|j| token(1_000 + i * 100 + j, 7)).collect(); utxo(i + 1, 500_000, &held) }).collect();
    utxos.extend(ada(500, 5, 20_000_000));
    let asked = Some(150_000_000);
    assert!(api::build_transfer_parts(sk, transfer(utxos.clone(), asked, vec![])).is_err());
    assert!(api::build_withdraw_parts(sk, withdraw(utxos, asked, vec![])).is_err());
}
```
Runs:
- 3063b33f: ok
- e4: FAILED, `assertion failed: api::build_transfer_parts(...).is_err()`
- b, c, e5, e6, e7: ok

Suite results:
- e4: "46 with problems, 62 refused", exit 101
- b, e5, e6: "0 with problems, 108 refused", amount lines identical to 3063b33f

Funding window scan, the report's shape as a funding with the UTxO of ADA at +4.0 to +14.0 ₳ (0.25 ₳ steps), then +5.74 to +6.01 ₳ (0.01 ₳ steps):
```
ada+5780000: "amount SHORT -> carry", "carry (more false) ERR" (refused)
ada+5790000: "last-of-tokens amount OK -> ends"
```

**Suggestion.** Add the refusal test so CI guards `owed == 0`; the code with comments is in `SCRATCH/review-1.9.1/tests/probe/kill_e4.rs`. For the early return, either drop it and architecture.md's clause, or keep it and say it's a guard. No test with the real builders can kill b or e6. A stand-in test would need core's `NotEnough`, which is `pub(crate)`.

## tests#4: The new test's total bound is computed from the plan's own parts, so it holds for 1.9.0's buggy plan

- **Severity:** low; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-web-wallet/wasm/tests/api_test.rs:4501`
- **Since:** new in 1.9.1

**What.** `leasts` sums `least(t)` over every part, including a part with no tokens. That part's `least([])` is exactly the overpayment the report was about, so it inflates both sides of `total == asked.max(leasts)` equally.

Under 1.9.0's `chained` (c), the assertion holds in all 12 cases. The test fails only through `none_after_paid` (asked 0) and "a part of ADA alone", which holds only because this shape's UTxO of ADA covers every asked amount. Under mutant a at least + 1, the plan overpays 1,456,779 and the bound holds there too.

For the one-part plans 3063b33f makes, the bound gives the right figure. It just can't tell a wrong plan from a right one.

**Scenario.** Under c, 10 tokens to a Seedelf, asked 0: the parts pay 4,310,000 + 1,456,780 = 5,766,780, and `leasts` is the same 4,310,000 + 1,456,780, so the assertion holds. The right figure is 4,310,000.

**Evidence.** The test's code (`api_test.rs:4500-4501`):
```rust
let leasts: u64 = paid.iter().map(|(_, t)| least(t)).sum();
assert_eq!(total, asked.max(leasts), "{case}: paid what was asked");
```
Assertion matrix (`probe_test.rs` `assertion_matrix`, which evaluates each of the new test's assertions separately; `cargo test --release --test probe_test assertion_matrix`):
- 3063b33f: 12 of 12 cases one part, every assertion ok, including `total == asked.max(least(sold))`.
- c: `total==asked.max(leasts)` ok 12/12; `asked.max(least(sold))` FAIL 8/12.
- a: at least + 1, `ada_alone` FAIL, `total==asked.max(leasts)` ok, `asked.max(least(sold))` FAIL.

**Suggestion.** Bound the total from the request, not the plan: `assert_eq!(paid.len(), 1)` and `assert_eq!(total, asked.max(least(&sold)))`. Both hold in all 12 cases at 3063b33f. Alternatively, sum `least` only over parts that send tokens.

## tests#5: The report's shape still overpays about 0.90 ₳, now in fee, and the new test doesn't look at fees

- **Severity:** low; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-core/src/build.rs:2949`
- **Since:** unchanged from 1.9.0

**What.** At 3063b33f the report's wallet pays in one transaction, but it has 10 inputs, 16,000 of 16,384 bytes, and a 1.165 ₳ fee. Core's `holding` takes the biggest holder of each token, which is a bundle, though the UTxO of ADA alone holds every token sent; built over that UTxO alone, the payment is 1 input, 1,372 B, fee 0.263 ₳. Add a 100 ₳ UTxO of ADA beside and `in_parts` sends the same payment as 2 parts with 1.52 ₳ in fees.

This is pre-existing: 1.9.0's first part was the same 10 inputs. The new test checks neither inputs nor fees.

**Scenario.** 10 tokens, 2 of each, to a Seedelf, asked 0. Cost beyond the tokens' least:
- 1.9.0: 2.860 ₳ (fees 1.169 + 0.234, plus a 1.457 ₳ output)
- 3063b33f: 1.165 ₳
- the UTxO of ADA alone: 0.263 ₳

To an address, 3063b33f costs 1.162 ₳ against 0.259 ₳.

**Evidence.** Probe `alone` (`probe_test.rs`), runs printing each part's inputs, size, fee and payment.

At 3063b33f:
```
full n=10/transfer: 1 part(s) | #0: 10 in, 16000 B, fee 1165394, pays 4310000 + 10 kinds
alone n=10/transfer: 1 part(s) | #0: 1 in, 1372 B, fee 263040, pays 4310000 + 10 kinds
```
Under c:
```
full n=10/transfer: 2 part(s) | #0: 10 in, 16150 B, fee 1168984, CARRIES ... | #1: 1 in, 710 B, fee 233912, pays 1456780 + 0 kinds
```
With a 100 ₳ UTxO of ADA beside (probe `free`):
```
free 1x100/transfer: #0: 7 in, 10810 B, fee 850794 | #1: 5 in, 7942 B, fee 667108
```
The last one has no chain: `in_parts` alone.

**Suggestion.** Outside #384's change: a selection that tries the fewest holders that cover the tokens before the biggest holder of each. Worth a line in 1.9.1's record; for this release only if the owner wants it.

## tests#6: The suite's new "pays after" check guards nothing in its current shapes

- **Severity:** nit; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-web-wallet/wasm/tests/payment_parts_shapes_test.rs:650`
- **Since:** new in 1.9.1

**What.** Under 1.9.0's `chained` (c), the suite reports 0 problems and 108 refused, with no "pays after" line. Every amount plan is identical to 3063b33f's. The only differences are the last cent of some Max payments, which never go through `chained`; their fee moves with the encoded size of a random proof. #384's PR says no suite shape hit the bug; this goes further: the suite exercises none of #384's change.

**Scenario.** Diffing the suite's amount lines (timings stripped) under c and at 3063b33f gives no difference.

**Evidence.** From `summary-suite.txt`:
```
c    | exit 0 | 0 with problems, 108 refused, 0 of them Max | 'pays after' lines: 0
orig | exit 0 | 0 with problems, 108 refused, 0 of them Max | 'pays after' lines: 0
```
Diff of the normalized logs: only `max +` lines differ, by 0.01 ADA.

**Suggestion.** Add the report's shape to `shapes()`: 10 or more tokens, each held most by a bundle of 20 at its least, and a little of each by the UTxO holding the ADA. Then the check bites.

## tests#7: The vault check misses words stored apart; numbered fields inside the vault record pass every test

- **Severity:** low; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-web-wallet/extension/tests/wallet.test.ts:49`
- **Since:** new in 1.9.1

**What.** The check flags two adjacent words with only non-word characters between them. It catches every listing that keeps two words side by side, which includes the realistic regressions (the phrase string, or its word list). It misses listings that put word characters between the words:
- one word per key, and numbered fields in their own key: only "reset deletes the vault" catches these, through `local.data.size` after reset.
- numbered fields inside the vault record: no test catches it.

False positives: one BIP39 pair, ("vault", "version"), matches the stored JSON outside the blob, at 2.6e-6 per run. The old first-word check caught every listing but flaked at about 0.15% per run, because "seed", "vault" and "version" appear in the stored key and field names.

**Scenario.** `create()` also storing `{ ...record, w0: "abandon", w1: "ability", ... }` under `seedelf.vault`: all 27 tests in `wallet.test.ts` pass.

**Evidence.** `npx vitest run tests/wallet.test.ts` in my worktree (`node_modules` linked to the release tree's, its `wasm/pkg` copied):
- unmutated: 27 passed
- spaces, JSON array, JSON string of an array, comma-joined, no separator: the vault check ("creates a wallet …") and "reset deletes the vault" fail
- an array inside the record: the vault check fails
- one word per key: only "reset deletes the vault" fails ("expected 24 to be +0")
- numbered fields in their own key: only "reset deletes the vault" fails
- numbered fields inside the record: 27 passed

A brute force over all 2048² BIP39 pairs found only ('vault', 'version').

**Suggestion.** Add a structural check beside the regex:
```ts
expect([...local.data.keys()]).toEqual([VAULT_KEY]);
expect(Object.keys(record).sort()).toEqual(["blob", "version"]);
```
It passes at 3063b33f (I ran it), catches every listing above, and can't flake.

## Checked and holds

- #384's new api_test is a valid test of the fix: it fails on 1.9.0's `chained` ("part 1 pays after the payment was all paid") and passes at 3063b33f, where all 87 tests in the file pass.
- It also kills mutant a (always carry: "10 tokens, to a Seedelf true, asked 4310001: a part of ADA alone") and mutant e3 (the amount-first part doesn't end the chain: refused).
- At 3063b33f all 12 of the new test's cases go as one part, each paying exactly asked.max(least(sold)), every token once (assertion matrix).
- Mutants d (any error falls to the carry) and e1 (`owed` instead of `owed.max(least(&share))`) are equivalent. Every plan raises a payment to its least (lib.rs:3048, :3425). An amount-first error that isn't short is either too_much (fit_part shrinks the room) or one the carry, over the same picks plus one more output, also hits.
- Parts suite at 3063b33f: 0 with problems, 108 refused, no Max refused. Under b, e5 and e6 every amount plan is identical to 3063b33f's.
- The suite under c (1.9.0's chained): its new check fires on no shape, which confirms the PR's note that no suite shape hit the bug.
- none_after_paid and the suite's check both compare against `asked` rather than asked.max(least). That's right for what they check: no part after every token and the asked lovelace are paid.
- The new vault check passes unmutated (27/27), catches the realistic leaks (the phrase string or its word list, joined any way), and builds no regex from anything but [a-z] BIP39 words.
- The proposed structural vault check passes at 3063b33f: after create, local storage holds only seedelf.vault, a record of exactly {version, blob}.

## Coverage

**Ran:**
- api_test, the whole file, under 11 mutants of `chained` (a, b, c, d, e1-e7) and the e8 variant.
- The parts suite in release under c, 3063b33f, b, e4, e5, e6, e7 and e8.
- Two killing tests at 3063b33f and under orig, e2, e4, c, b, e7, e5, e6.
- An assertion matrix of the new test's 12 cases under 3063b33f, c, a and e3.
- Plan probes:
  - the report's shape (10 and 30 tokens, asked 0 to 300 ₳; transfer, withdraw and funding)
  - the same with free ADA beside
  - test wallet A with 12, 20 and 30 bundles plus a second UTxO of ADA
  - ADA-only chains
  - a funding scan for the early return at 0.25 ₳, then 0.01 ₳
- 9 vault listings against wallet.test.ts, plus a BIP39 false-positive brute force.

**Not run:**
- The suite under a, d, e1, e2 and e3: api_test already settles a and e3, d and e1 are equivalent, and the suite has no fundings, so it can't reach e2.
- Mutants of in_parts, fit_part, max_in_parts or core selection: other code than #384's.
- The worker's review (`whole` and its minimum note) for a plan with a legitimate trailing part of ADA alone.
- e8's planning time on refusals: the suite timings were noisy because runs overlapped.

**No mutant left the expected files changed:** both worktrees were restored and then removed.

**Artifacts:** report.md wasn't written; the harness refuses report files from subagents. Everything else is in `SCRATCH/review-1.9.1/tests/`:
- `mutants/` holds the lib.rs.* mutants, the logs, the summary-*.txt files and api_test-kill-tests.diff.
- `probe/` holds probe_test.rs and kill_e2.rs / kill_e4.rs.

Here SCRATCH is `SCRATCH`.

**Left in place:** the cargo targets `~/.cache/seedelf-review-1.9.1/tests` and `~/.cache/seedelf-review-1.9.1/tests-probe`. The vitest runs went through the symlinked node_modules, so vitest's cache under the release tree's node_modules may have been touched.

**Not mine:** the release tree now shows uncommitted edits in docs/plans and seedelf-verification. I never wrote in that tree.
