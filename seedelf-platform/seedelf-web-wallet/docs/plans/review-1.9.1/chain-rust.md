# chain-rust (find:chain-rust)

2 finding(s).

## chain-rust#1: A carry that no later part spends shows up in no figure, so a funding's privacy note understates the private change

- **Severity:** low; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:4312`
- **Since:** unchanged from 1.9.0 (the pre-loop path, lib.rs:4271); #384 adds a second path (the early return after a carry, lib.rs:4312-4315)

**What.** A carry part's `change_lovelace` counts only what its kept tokens need. In core `split` (seedelf-core/src/build.rs:2049-2063) the carried ADA is `rest_lovelace`, and the carry row is `#[serde(skip)]` (lib.rs:2972, 3367), so the worker never sees it. That ADA only shows up in the figures when a later part spends the carry. Two paths end a plan with a carry that no part spends.
(a) Already in 1.9.0: the chain's pre-loop last part, `amount(carry + rest, ...)` at lib.rs:4271, spends as few UTxOs as pay (`select_script_inputs`), so it can pay from the rest alone and leave the carry out.
(b) New in #384: the early return after a carry. Its comment says the carried ADA "stays in the Seedelf balance, as change does", but nothing reports it as change.
The worker's `whole()` adds up `changeLovelace` (extension/src/background/script-spend.ts:516). A funding's review prints that sum: `fundingPrivacy(review.changeLovelace)` (DappApprovals.tsx:444-446, 811) says "…and its X ₳ private change, to the one-time account", and with 0 it says nothing about change. No money is lost: the carry is the wallet's own output, and the session's history is sealed by tx hash. Path (b) is reachable only for a funding, because `build_withdraw` gives a funding's amount no measured fallback (lib.rs:3570-3571: `request.funding.is_none()`). The amount is picked by the guessed budgets (about 1.3x the real ones), while the carry is measured, so between the two fees the amount is short and the carry builds. For a transfer or a plain withdrawal, a carry that builds means the amount builds too.

**Scenario.** (a) A full request on 1.9.1, and the same on 1.9.0: a session's funding of all 240 tokens of a move-in's 12 bundles of 20 (each at its least) plus one UTxO with 3 ₳ past its least. It asks for the tokens' least (41.091540 ₳ for each half) and pays the 5 ₳ collateral beside.
- Part 0 (6 bundles and the ADA UTxO) pays 41.091540 ₳ + 120 tokens + the 5 ₳ collateral. Its changeLovelace is 0 and it carries 1.502890 ₳.
- Part 1 (the other 6 bundles alone) pays 41.091540 ₳ + 120 tokens, with changeLovelace 2.087004 ₳, and does not spend part 0's carry.
- 92.380780 ₳ in = 87.183080 paid + 1.607806 fees + 2.087004 change + 1.502890 unspent carry.
- The review says 2.09 ₳ of private change is tied to the one-time account. In fact 3.59 ₳ is.
- 1.9.0 gives 2.085198 against 3.588088.
This came up in 14 of 1,320 move-in probe requests on both builds (12 fundings, and 2 transfers where 3.510800 ₳ went uncounted but transfers show no change figure). It came up in none of the other 2,388 swept requests.
(b) Run from the chain state {owed = least(T), tokens [T], rest [H]}, with H holding T alone and 1.275760 ₳ the address least. For a funding with H's ADA past its least anywhere in [1,212,000, ~1,221,000) lovelace (one input; the window is about 9,500 lovelace per input, at most about 0.19 ₳ at 20), the plan ends at the carry:
- payments[0] = 1.275760 ₳ + T
- change_lovelace = 0
- fee = 0.233296 ₳
- carry = 1.457114 ₳, never spent
The note would then say the payment ties no change at all. A plain withdrawal from the same state builds the amount at the same threshold, with change 1.457114 ₳. On 1.9.0 this state goes on to a 0.978 ₳ part of ADA alone, or fails that anchor. Path (b) was not reached from a full request in any run.

**Evidence.** Code: lib.rs:4271 `match amount(all, owed.max(least(&tokens)?), tokens.clone(), false) {` (pre-loop; `all` = carry + rest, selection may skip the carry). lib.rs:4312-4315 `// Paid in full by the carries: what the last carried stays in the Seedelf balance, as change does.` / `if tokens.is_empty() && owed == 0 { return Ok(parts); }`. script-spend.ts:516 `changeLovelace: sum((p) => p.changeLovelace),`. DappApprovals.tsx:445 `if (BigInt(changeLovelace) > 0n) return t("dappUi.privacy.fundingWithChange", { ada: formatAda(changeLovelace) });`. lib.rs:3570-3571 `Err(short) if build::is_short(&short) && request.funding.is_none() && !request.carry =>` (measured_or_more, not for fundings).

Run (a), in my worktree 3063b33f and the 1.9.0 mutant (3063b33f + c0b451a8's lib.rs, own target dir), with `cargo test -j 4 --release -p seedelf-wasm --test review_chain_test detail_unspent_carry -- --ignored --nocapture`:
1.9.1: `part 0: tx 6d3b016a09d8 inputs 7 (from earlier parts: 0) payments ["41.091540+120tok", "5.000000+0tok"] fee 0.824350 changeLovelace 0.000000 carry Some("1.502890") spent by a later part: Some(false)` / `part 1: tx ad8a872f3f3e inputs 6 (from earlier parts: 0) payments ["41.091540+120tok"] fee 0.783456 changeLovelace 2.087004 carry None` / `held 92.380780 spent 92.380780: paid 87.183080 + fees 1.607806 + changeLovelace 2.087004 = 90.877890; unspent carry 1.502890; review's change 2.087004 vs what stays 3.589894`. 1.9.0: same plan, `review's change 2.085198 vs what stays 3.588088`.
Test (a) (in SCRATCH/review-1.9.1/chain-rust/review_chain_test.rs, with its helpers copied from api_test's parts_of_any_shape; `withdraw_req(.., Some(5 * ADA))` adds the collateral payment and `funding: Some(Funding::default())`):
```
fn detail_unspent_carry() {
    let sk = seedelf_key_v1(PHRASE, 0).unwrap();
    let all: Vec<TokenAmount> = (0..240).map(|i| token(i, 1_000 + i)).collect();
    let mut utxos: Vec<UtxoResponse> = all.chunks(20).enumerate().map(|(i, c)| utxo(i as u64 + 1, 0, c)).collect();
    utxos.push(utxo(500, 3_000_000, &[]));
    let asked = least_for(2, &all); // minimum_address_payment of the 240 tokens
    let parts = api::build_withdraw_parts(sk, withdraw_req(utxos.clone(), asked, all.clone(), Some(5 * ADA))).unwrap();
    // per part: payments, fee, change_lovelace, carry, and whether a later part's inputs hold the carry's outpoint;
    // then Σ payments + Σ fees + Σ change_lovelace against Σ inputs, and the carries no part spends
}
```
Run (b) is a lib-internal unit test in my worktree (`mod review_q1` inside `pub mod api`), run as `cargo test -j 4 --release -p seedelf-wasm --lib review_q1 -- --ignored --nocapture`. It builds `build_withdraw_parts`' own `with` closure for a WithdrawRequest of [T to theirs(), lovelace "0"] + [5 ₳ collateral], with funding on or off, and calls `chained(&Owed { lovelace: least(T), tokens: vec![t], rest: vec![h] }, false, MAX_PARTS - 2, &least, &Worth::of(&chain, &request.utxos, None), &inputs_of, &|r| lovelace_of(&r.payments[0].lovelace), &|r| r.carry.clone(), &mut |from, l, t, first| with(from, Some(l), t, first, false), &mut |picks, share, first| with(picks, Some(0), share, first, true))`, stepping H's ADA past its least by 2,000 lovelace. Output: `funding=true extra=1200000: ERR short=true ...` / `funding=true extra=1212000: parts=1 last: payments0=1275760 tokens=1 change_lovelace=0 fee=233296 carry=Some("1457114")` / `funding=true extra=1222000: parts=1 last: payments0=1275760 tokens=1 change_lovelace=1467114 fee=233296 carry=None` / `funding=false extra=1200000: ERR ...` / `funding=false extra=1212000: parts=1 last: payments0=1275760 tokens=1 change_lovelace=1457114 fee=233296 carry=None`. The instrumented `C-EARLY-RETURN-AFTER-CARRY` marker fired 5 times there, and 0 times across the shapes suite, all 87 api tests and 3,708 swept requests.

**Suggestion.** After planning in build_transfer_parts / build_withdraw_parts (or at the end of in_parts), add the lovelace of each carry that no later part's inputs spend to that part's change_lovelace and change_outputs, since it is change. Alternatively, make a chain's last part spend `forward`. Test it with the funding in (a), asserting that payments + fees + change add up to the inputs. A funding's amount could also take build_withdraw's measured fallback, which would close path (b)'s window at its source.

## chain-rust#2: No test reaches the early return after a carry, and the shapes suite never takes the new amount-first branch

- **Severity:** low; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:4313`
- **Since:** new in 1.9.1

**What.** I added stderr markers to my worktree's `chained` and `in_parts` (no change in behaviour) and ran every api test, the parts shapes suite and the sweeps.
- The early return after a carry (lib.rs:4313-4315) was never reached. Deleting it would fail no test. It is the one exit that leaves a carry as the plan's last part (finding 1).
- #384's amount-first last part built 435 times, but never in the shapes suite: all 495 last-part amounts in its 592 requests were short or too large. Only api_test's new `a_chain_ends_with_the_part_that_sends_the_last_of_the_tokens` reaches it (12 times).
- The suite's new check (payment_parts_shapes_test.rs, `part {n} pays after the payment was all paid`) fires only once earlier parts have paid every token and the whole asked lovelace. It misses a trailing part that pays more than what was still owed, which is the report's second shape ("an amount just past the tokens' least overpaid the same way"). Otherwise the suite flags only underpayment (`paid_lovelace < w`).

**Scenario.** Remove `if tokens.is_empty() && owed == 0 { return Ok(parts); }` at lib.rs:4313-4315: CI stays green. A regression that makes a trailing part of ADA alone pay least([]) where owed′ ∈ (0, least([])) passes the suite, because owed′ > 0 means the 'all paid' condition never holds before that part.

**Evidence.** Marker totals from `cargo test -j 4 --release -p seedelf-wasm --test api_test -- --nocapture --test-threads=1` (87 passed), `... --test payment_parts_shapes_test -- --ignored --nocapture` (ok, 251.69s) and the review sweeps: C-EARLY-RETURN-AFTER-CARRY 0, C-LAST-AMOUNT-OK 435 (0 in the shapes suite), C-LAST-AMOUNT-SHORT 1,309, C-LAST-AMOUNT-ERR 3,252 (all too_much=true). The shapes suite's outcomes on 1.9.0 and 1.9.1 are identical apart from ±0.01 ₳ noise on Max lines, which never go through `chained`. The check: `if max_tokens.is_none() && n > 0 && &paid == want_tokens && want_lovelace.is_some_and(|w| paid_lovelace >= w) { problems.push(format!("part {n} pays after the payment was all paid")); }`. Control: #384's api test fails on the 1.9.0 mutant (`panicked at seedelf-web-wallet/wasm/tests/api_test.rs:4401:13: part 1 pays after the payment was all paid`) and passes on 1.9.1, as the rule asks.

**Suggestion.** Add a test that reaches the early return: the funding window of finding 1 (a lib-internal test like review_q1, or a full funding request). In the shapes suite, also flag paid_lovelace > max(asked, Σ least of each part's tokens), so a trailing part of ADA alone that overpays is caught whatever is still owed.

## Checked and holds

- #384's own test fails on the 1.9.0 mutant (3063b33f with c0b451a8's lib.rs, built in its own target dir): 'part 1 pays after the payment was all paid' (api_test.rs:4401). It passes on 1.9.1.
- Q1, transfers and plain withdrawals: the early return can't be reached. When the part sending the last tokens keeps no token, the amount's change output and the carry's output are the same size and both are measured, so the carry builds exactly when the amount does. Run from the same chain state, both start at 1,212,000 lovelace past H's least. When the part keeps tokens, the carry needs an output's least (about 1.46 ₳) more than the amount. Only a funding's guessed-budget amount opens a window (finding 1).
- Q2, chained: after a carry that still leaves lovelace owed, a part that keeps tokens always leaves owed′ ≥ least([]) (67 of the 81 such carries in my runs). With no token kept, 0 < owed′ < least([]) happened 14 times (move-in fundings, owed′ 0.59–0.89 ₳). Each time the next part (`amount(carry + rest, owed.max(least([])), [], false)`) was short, because the chain had already carried all its ADA. The payment was refused, as on 1.9.0. No overpayment was reached. If that part had built, it would pay least([]) − owed′ more (up to 0.978 ₳ to an address, up to 1.457 ₳ to a Seedelf) plus one more fee (0.17–0.33 ₳).
- Q2, in_parts (lead at lib.rs:4162): the reduced last-tokens amount `owed.saturating_sub(least([])).max(least(share))` leaves min(least([]), owed − least(share)) to a trailing part of ADA alone, which overpays when owed < least(share) + least([]). Its precondition (nothing after this part, and either Max short of owed or the exact amount short) never fired in any run. That part's room fills with the 20 richest UTxOs, so it is short of ADA only when no spendable ADA is left. Unchanged from 1.9.0.
- Consistency: chained's part that sends the last tokens now tries in_parts' exact amount (`owed.max(least(share))`, change staying) and ends there. When that amount is short they still differ: in_parts reduces its payment and leaves least([]); chained carries and leaves owed − least(share). Both follow the same trailing-part arithmetic.
- Q3: over 3,708 requests per build (bounty shape 1,008; fat holders 360; one token held alone 300; bare bounty 480; move-in 240; two move-in probes 1,320), 1.9.1 never refused what 1.9.0 built and never planned more parts or paid more. 139 requests 1.9.0 refused now go in one part (the bounty shape with at most 1.8 ₳ past the rich UTxO's least, where the old trailing part couldn't be paid). 284 go in fewer parts at exactly the amount asked.
- Q3, errors: every non-short error the new amount raised (3,252, instrumented) was TooLarge, none of any other kind. An amount's attempts spend a subset of the carry's picks with one output fewer, so the carry is larger still. 20 inputs never pass the guessed budget (20 × 450M = 9.0B steps < 10B). The amount's smaller TooLarge shrinks the room less per step than the carry's did, never more.
- Q4: the funding collateral is paid once. `starts = first && parts.is_empty()`, and `amount(.., starts)` puts payments[1..] in that part only. `paid_of` reads payments[0], and sessions.ts:3109 adds `first.payments.slice(1)`. All 422 funding plans in the sweeps paid 5.000000 ₳ beside, once. The api test a_funding_in_three_parts_or_a_chain_pays_the_accounts_collateral_once passes.
- Q5: both new exits push inside `while parts.len() < room`, so a chain never goes past its room. `next_of` now runs only for carries, and a last amount part that spends only the carry is a valid last part. Nothing else in the loop moved. One thing predates #384 and is unchanged: a chained plan stops at MAX_PARTS − 1 parts (anchor + room), while in_parts' own plans can reach 25.
- by_history_first: a chain that now ends in an amount has no carry, so `chains` is false and the by-worth retry without chains is skipped. That is fine, since nothing waits on another part.
- The new closure only ever passes the current `owed`, `share` and `starts` to amount and carry. A non-short, non-TooLarge amount error ends that anchor's search the same way the carry's own error used to.
- Planning time: refusals in the bounty shape take about twice as long (native release: 160 → 313 ms and 99 → 212 ms); plans that succeed take the same. My 20-case timing set is 17–24% slower overall. That is far below the worker's 5 minutes.
- docs/architecture.md's new sentence and the lib.rs doc comment on `chained` match the code.

## Coverage

Covered: the whole of fit_part, in_parts, chained, next_of, Room, token_group, max_in_parts and max_chained; the `with` closures of build_transfer_parts and build_withdraw_parts; and the core builders behind them (transfer_apart / sweep_many_apart through select_script_inputs and estimate, measured_or_more, transfer_from / sweep_many_from with ScriptSpend::carry, split, stage and settle). I checked these by reading, by instrumented runs (stderr markers in my worktree only) and by comparing 1.9.0 with 1.9.1 build by build.

Not covered:
- My sweeps sent no histories (classes empty, so selection ran blind). The apart-mode selection was exercised only through the api tests.
- The early return was reached from a constructed chain state, never from a full request.
- On the worker side I read only whole(), fundingPrivacy and sessions.ts's funding summary. I took the sealed history of an unspent carry to be its transaction's, from activity.ts's per-transaction origin.
- No timing in WebAssembly or a browser; native release only.
- From #384 I did not review wallet.test.ts's vault check or anything outside architecture.md's paragraph. max_chained and Max are untouched by #384 and were run only through the shapes suite.

Notes:
- A first old-versus-new comparison shared one CARGO_TARGET_DIR. Cargo then reused 1.9.1's binary for the 1.9.0 worktree, so I discarded it and redid every comparison with a separate target, ~/.cache/seedelf-review-1.9.1/chain-rust-190. That directory and ~/.cache/seedelf-review-1.9.1/chain-rust remain. Both worktrees are removed.
- The harness refused to let this subagent write report.md, so the report is this output only.
- Kept in the scratch folder SCRATCH/review-1.9.1/chain-rust/: review_chain_test.rs (the sweeps, probes, timing and detail_unspent_carry), instrumented-lib.diff (the markers plus the review_q1 unit test), review_q1.rs, cmp.py, and the 1.9.0 and 1.9.1 logs (sweep-*, probe*, shapes-instr.log, api-instr.log, time-*).
- I never wrote in the release tree. Its git status at the end showed uncommitted changes that aren't mine and aren't on the brief's list: docs/plans chunk-46 and chunk-50, docs/archive/plans chunk-48, seedelf-verification/CLAIMS.md, README.md and check.sh.
