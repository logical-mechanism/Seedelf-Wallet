# critic (critic)

6 finding(s).

## critic#1: No full request reached the early return after a carry: keep it as a guard and test it inside lib.rs, because dropping it (tests#3's other option) brings back the bounty's extra part

- **Severity:** low; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:4313`
- **Since:** new in 1.9.1

**What.** The lanes disagree about this branch.
- chain-rust reached it only by calling `chained` on a hand-made state (review_q1).
- tests#3 and docs say no request reaches it, and tests#3 offers dropping it.
- ts-parts#1 grades its consequence as "new in 1.9.1".

I looked for it from full requests. I instrumented my own worktree at 3063b33f: a stderr marker at each exit of `chained`, plus CRITIC_MODE=190, which runs 1.9.0's `chained` in the same binary. c0b451a8 and 3063b33f differ in lib.rs only there, and core is unchanged. Three runs:
- Binary searches over the spare ADA of the UTxO that holds the ADA, from 0 to 40 ₳, in six bounty-like shapes: 22 to 26 tokens in bundles of 3 to 8, plus the bounty's 10 in bundles of 20. All were fundings, and one shape also ran as a transfer and a withdrawal.
- A scan of the same shapes and all three kinds from 0 to 12 ₳ in 0.25 ₳ steps: 882 requests.
- 432 requests with histories.
The marker never fired.

Why it's hard to reach:
- The window only exists where the part keeps no token. Where tokens stay, the amount's leftover sits in their change, so the carry needs an output's least more than the amount does (chain-rust Q1).
- Only a funding has the window, because its amount gets no measured retry (lib.rs:3571).
- After a carry, the pre-loop amount returns its short error before fit_part runs (lib.rs:4277). So the window has to be met at a chain's first part. There, the shrinking room tries every pick set that includes a bundle first, and those need less ADA.

tests#3's reason, that the carry "always needs more ADA than the amount", is wrong for a funding part that keeps nothing: the carry is measured while the amount uses guessed budgets. Its conclusion still held in every run.

**Scenario.** Mutant b (no early return) passes api_test and the parts suite (tests lane). In chain-rust's state {owed = least(T), tokens [T], rest [H]}, a funding whose H holds 1,212,000 to about 1,221,000 lovelace past its least ends on a carry of 1.457114 ₳. Without the return, the loop's next pre-loop amount pays the recipient least([]), which is 0.978 ₳ to an address, or the anchor fails. chain-rust saw the same on 1.9.0 ("goes on to a 0.978 ₳ part of ADA alone, or fails that anchor"). That is the report's bug.

**Evidence.** lib.rs:4313 `if tokens.is_empty() && owed == 0 {` (return Ok(parts)). lib.rs:4277 `Err(e) => return Err(e),` (pre-loop short ends the chain). lib.rs:3571 `if build::is_short(&short) && request.funding.is_none() && !request.carry =>`.

Command: `CRITIC_TRACE=1 cargo test -j 4 --release -p seedelf-wasm --test critic_probe_test <name> -- --ignored --nocapture --test-threads=1`, in my worktree with CARGO_TARGET_DIR=~/.cache/seedelf-review-1.9.1/critic.

funding_window_full_request:
- `SHAPE n=22 b=5 funding asked=0: first plan at rich+0.000000, first plan whose last part carries nothing at rich+0.000000` (and the same for n=24 b=5, n=22 b=8, n=26 b=4, n=23 b=3, and for transfer and withdraw)
- `SHAPE n=10 b=20 funding asked=0: first plan at rich+5.780960, first plan whose last part carries nothing at rich+5.780960`

Marker tallies:
- window.err: 0 early returns, 24 amount-first exits
- leave.err (882 requests): 0 early returns, 115 amount-first exits
- hist.err (864 builds): 0 early returns, 73 amount-first exits

**Suggestion.** Keep the return. Say in its comment that it guards a funding whose amount is short on guessed budgets, and pin it with a lib-internal test built from chain-rust's review_q1 state. c3d24629, on the release branch since, does both ("#384's end after a carry (in lib.rs: no test reached it)"); I read it but didn't run it.

## critic#2: In no lane's run did #384's amount-first part build after a carry: every chain it ended was a single part, so a chain whose last amount comes after a carry is untested

- **Severity:** low; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:4289`
- **Since:** new in 1.9.1

**What.** The counts:
- chain-rust's instrumented logs hold 1,620 `C-LAST-AMOUNT-OK` lines, every one `fwd=false`, and 163 `C-LAST-AMOUNT-SHORT ... fwd=true`.
- My runs had 212 amount-first exits, none with a forward carry.

So every chain #384 ends early is one part that sends every token. After a carry, the amount over [carry, holders] (Room::beside) was short every time, and the chain went on carrying as it did on 1.9.0.

Two things in that branch have no test:
- The amount is built by sweep_many_apart / transfer_apart. Their selection tries the token holders alone first (k = 0), then UTxOs of ADA alone, largest first (core build.rs:2567-2569). Where the holders pay, the forward carry is left unspent: chain-rust's path (a) again, from a new place.
- Where the amount is short after carries, the closure falls to the carry rather than handing fit_part the short so it can add a UTxO of ADA (tests#1). So the chain doesn't end at that part.

#384's api_test and the parts suite reach only a chain's first part.

**Scenario.** A regression confined to that branch passes api_test and the parts suite, since neither builds it. One example is a selection change that makes the last amount after a carry leave the carry unspent. With c3d24629's carry_kept, such a carry would at least be counted as change; the plan itself stays unchecked.

**Evidence.** `for f in chain-rust/*.err chain-rust/*.log; do grep -o 'C-LAST-AMOUNT-OK .*fwd=[a-z]*' $f | grep -o 'fwd=[a-z]*'; done | sort | uniq -c` gives `1620 fwd=false`. The same for SHORT gives `1167 fwd=false` and `163 fwd=true`.

My tallies: window 24, leave 115 and hist 73 amount-first exits, all `spends-forward=None`.

Code:
- lib.rs:4289 `if !more {` … lib.rs:4300 `carry(picks, share, starts).map(|part| (part, false))`
- core build.rs:2567 `rest.sort_by_key(|u| (holds_tokens(u), std::cmp::Reverse(lovelace_of(u))));`
- core build.rs:2569 `for k in 0..=rest.len() {` (k = 0 is the token holders alone)

**Suggestion.** Either add a test whose chain carries once and then ends on the amount, asserting that the last part spends the carry, or record in 1.9.1's review that the branch is unreached. Taking tests#1's backlog item (let a short last part of tokens add ADA before carrying) would make the branch reachable, so it would need that test then.

## critic#3: A second shape leaves a funding's carry unspent, on 1.9.0 and 1.9.1 alike: 2.17 ₳ missing from the privacy note's change

- **Severity:** low; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:4271`
- **Since:** unchanged from 1.9.0

**What.** chain-rust#1's path (a) was found from full requests only in move-in probes (14 of 1,320). My scan found it in a bundle shape too. The chain's second part is the pre-loop amount over carry + rest. Its selection paid from the remaining bundles alone, because their kept tokens fit in fewer change outputs and that frees ADA, so part 0's carry was left.

The same request under CRITIC_MODE=190 (1.9.0's chained) gives the identical plan. So this is the old path, and ts-parts#1's "new in 1.9.1" applies only to the unreached early return (critic#1).

**Scenario.** The shape: 22 tokens sent, 2 of each. Each token is held most by its own bundle (5,000 of it plus 7 other tokens, 3 each, at their least), and 2 of each sit on one more UTxO at its least.
- As a funding asking 0, with its 5 ₳ collateral: 2 parts pay 8.232100 ₳, plus the 5 ₳ beside. Σ changeLovelace is 65.264134 ₳, and part 0's carry of 2.173536 ₳ is spent by no part. The note would say 65.26 ₳ of private change is tied to the one-time account, where 67.44 ₳ is.
- As a plain withdrawal: 7.176484 ₳ is left uncounted.
- As a transfer, the plan spends its carry.

**Evidence.** From unspent_carry_both_builds (both.out):
- `CRITIC preloop-last parts=2 spends-forward=Some(false)`
- `BOTH n=22 b=8 rich+0 funding asked=0 1.9.1: OK parts=2 paid=8.232100 ... unspent_carry=2.173536 change(Σ changeLovelace)=65.264134 fee=1.823630 beside=5.000000`
- `... funding asked=0 1.9.0: OK parts=2 paid=8.232100 ... unspent_carry=2.173536 change(Σ changeLovelace)=65.264134 ...`
- `... withdraw asked=0 1.9.1: ... unspent_carry=7.176484 ...` (1.9.0 identical)

The scan (leave.out, 882 requests) found only these two. lib.rs:4271 `match amount(all, owed.max(least(&tokens)?), tokens.clone(), false) {` (`all` = carry + rest; the selection may skip the carry).

**Suggestion.** c3d24629's carry_kept counts every carry that no later part spends (read, not run). Add this request as a second regression case for it: `unspent_carry_both_builds` in critic_probe_test.rs, using `bundles(22, 8, 0)`.

## critic#4: Review: shapes#1 needs three token parts (61 boxes do, 42 don't), and from there nearly any ADA amount triggers it; medium fits the owner's 90-box case

- **Severity:** nit; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:4158`
- **Since:** unchanged from 1.9.0

**What.** shapes#1 calls its shape the owner's 1.6.0 test of 42 and 90 boxes.
- 42 boxes went as two parts at every ask I tried, from 0 to 50 ₳. Two parts never overpay: the excess is (P − 2) leasts.
- 61 boxes went as three. With three parts the excess is min(asked − 2·least, least): nothing up to 2 leasts (3.52 ₳ to a Seedelf here), then the whole least from 3 leasts on.

So the trigger is a token spread over more UTxOs than two parts take, sent whole with almost any ADA amount. The review shows the inflated amount with no "raised from": `amountText` (AdaInput.tsx:91-94) raises only when lovelace equals the summed minimum. Medium holds where users reach that shape, as the owner's 90 boxes do; the finding should name the trigger.

**Scenario.** Boxes of 4.5 ₳ + 100 of one token, the whole token sent, to a Seedelf:
- 42 boxes: asked 3.516960, 5.275439 and 50 ₳ pay exactly that.
- 61 boxes: asked 3.516960 pays 5.275440 (the parts' leasts, which is fair). Asked 5.275439 pays 7.033919 (1.758479 over). Asked 50 ₳ pays 51.758480 (1.758480 over).

**Evidence.** token_boxes_keep_needs_an_amount (boxes.out):
- `BOXES 42 transfer asked=50.000000 (least 1.758480): OK parts=2 paid=50.000000`
- `BOXES 61 transfer asked=3.516960 ...: OK parts=3 paid=5.275440 ... over 0.000000`
- `BOXES 61 transfer asked=5.275439 ...: OK parts=3 paid=7.033919 ... over 1.758479`
- `BOXES 61 transfer asked=50.000000 ...: OK parts=3 paid=51.758480 ... over 1.758480`
- Withdraw, 61 boxes, asked 50 ₳: `paid=51.280070 ... over 1.280070`

lib.rs:4158 `let keep = least(&later)?;`

**Suggestion.** Keep it graded medium, with the trigger stated: three token parts or more, and an ask above (P − 1) token-output leasts. The 42-box case is a useful no-change check for c3d24629's `reserving`.

## critic#5: Review: the other fix chain-rust#1 and ts-parts#1 offer, a measured fallback for a funding's amount, would pick a funding's UTxOs by size across sessions

- **Severity:** nit; **confidence:** traced
- **Where:** `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:3571`
- **Since:** n/a

**What.** Both lanes suggest closing path (b)'s window by giving a funding's amount build_withdraw's measured fallback. That fallback is measured_or_more, which takes `build::max_inputs` over `request.utxos`: the 20 largest UTxOs, with no histories (lib.rs:3198-3212).

build_withdraw leaves fundings out of it on purpose: "not a session's funding, whose picking keeps another session's money out" (lib.rs:3557-3558). In build_withdraw_parts' one-transaction try, `request.utxos` is the whole private balance. So every single-transaction funding that the guess calls short would retry on the largest UTxOs, whatever their session, merging other sessions' money. That goes against the most-private default.

c3d24629 counts the carry instead (carry_kept), which needs no such change (read).

**Scenario.** A session funding that is short on guessed budgets: today it is refused. With the fallback, it would be rebuilt on the balance's 20 largest UTxOs, tying another session's money to this one-time account.

**Evidence.** lib.rs:3204 `let Ok((inputs, _)) = build::max_inputs(utxos, needed, MAX_WITHDRAW_UTXOS) else {`. lib.rs:3557-3558 `/// ... not a session's funding,` / `/// whose picking keeps another session's money out.` lib.rs:3571 `if build::is_short(&short) && request.funding.is_none() && !request.carry =>`.

**Suggestion.** Don't take that route. If a measured retry is ever wanted for fundings, keep it to the picks already made: the planner's picks, never the whole balance.

## critic#6: Review: smaller corrections between lanes (vault odds, a duplicate, docs#1 already fixed, the shapes lane's bound)

- **Severity:** nit; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-web-wallet/extension/tests/wallet.test.ts:46`
- **Since:** n/a

**What.** - Vault odds: tests#7 puts the vault check's chance failure at 2.6e-6 per run. That's 11 pairs, as for 12 words. The wallet generates 24 words (seedelf-crypto/src/derivation.rs:46-50), so there are 23 pairs and the odds are 5.48e-6, as ts-parts#3 says.
- tests#5 and shapes#2 are the same finding (core `holding` takes the bundles). Merge them.
- docs#1 is already fixed: 36d90389 sets both release blocks to 1.9.1.
- The bound the shapes lane added counts a part of ADA alone's least as owed. A trailing part shows only as a `TOPUP` note, which never fails the suite, so it couldn't catch the report's bug (tests#4's flaw). c3d24629's suite bound uses the token parts' leasts only and treats an ask of nothing separately (read).

**Scenario.** Two of these would mislead if taken as written:
- tests#7's figure halves the flake's real odds.
- If the shapes lane's bound were the suite's guard, the report's trailing part would stay a note and the run would still pass.

**Evidence.** derivation.rs:46 `/// Generates a new 24-word recovery phrase` and :49 `let mut entropy = Zeroizing::new([0u8; 32]);`.

The shapes lane's diff: `notes.push(format!("TOPUP a part of ADA alone paid {} over max(asked {asked}, the token parts' leasts {tokens_least}); ...` (shapes/payment_parts_shapes_test.diff).

`git show 36d90389 -- docs/development.md`: `-release_version=1.9.0` / `+release_version=1.9.1` (4 ++--).

**Suggestion.** Use ts-parts#3's figure, merge shapes#2 into tests#5, close docs#1, and keep c3d24629's bound rather than the lane's.

## Checked and holds

- Histories, which no lane ran. 432 requests: the bounty's shape (10 tokens in bundles of 20) with its bundles, the UTxO holding the ADA and 0, 1 or 3 spare UTxOs of ADA in 4 history layouts; the rich UTxO at 2, 4, 6 and 300 ₳; as a transfer, a withdrawal and a funding; asking 0, the least + 1 ₳ and 10 ₳. Against 1.9.0's chained in the same binary: none that 1.9.0 built did 1.9.1 refuse, and none planned more parts, more carries, more lovelace paid or more histories merged. 16 that 1.9.0 refused now go, 57 are better, 279 are the same and 80 are refused by both (critic/hist.out, scripts/cmp_hist.py).
- by_history_first's `carry.is_some()` retry is unchanged. A chain that #384 ends at its first part has no carry, so it's kept without asking for a plan by worth. That is what the doc's 'a chain only where it's needed' asks for, and the history order is the private default.
- Max's max_chained, which #384 doesn't touch, can't end on a part that spends its carry alone. Its first part's room is 20, so a carry takes all of rest only when rest is at most 20 UTxOs. A non-chained Max part over those same UTxOs already failed, and a carry is that same transaction plus one output. After that, `part(carry + rest)` is tried whenever rest has fewer than 20 (lib.rs:4460-4474), and fit_part takes at most 19 beside a carry.
- A refused payment's shortfall measure (short.ts privateShortOf, withdraw.ts:112-116, transfer.ts:124-127) rebuilds the payment as Max in parts, which #384 doesn't touch. Amounts that now go never reach it.
- Several recipients never go in parts (lib.rs:4538, 4655). A funding's later payments go in its first part (`with`, lib.rs:4609-4613), and #384's amount-first honours that through `starts` (lib.rs:4294); tests#2's mutant e2 shows no test pinned it.
- 42 boxes of a token (4.5 ₳ + 100 each) pay exactly what's asked at every ask from 0 to 50 ₳: two parts, to a Seedelf and to an address.
- c3d24629 on the release branch, read and not run. carry_kept counts every carry that no later part spends, whatever path left it: the pre-loop, the early return, or critic#2's branch. The early return stays, with a lib.rs test. Fundings get no measured fallback. `reserving` replans only when the parts pay more than max(asked, the token parts' leasts).

## Coverage

What I ran:
- All runs were at 3063b33f in my own worktree, since removed, building to ~/.cache/seedelf-review-1.9.1/critic.
- `chained` was instrumented (critic/instrumented-lib.diff). CRITIC_MODE=190 runs 1.9.0's chained, which is exact because c0b451a8 and 3063b33f differ in lib.rs only there and core is unchanged. CRITIC_MODE=noearly drops the early return. CRITIC_TRACE prints each chain's exit and whether its last part spends the carry.
- About 2,200 builds in all: window binary searches (~420), an 882-request scan, 864 builds with histories, 32 builds of the boxes and 6 under both builds.

What I didn't cover:
- The noearly mode never met a plan ending at the early return, because none was found. What happens without the return rests on chain-rust's hand-made state.
- I didn't run critic#2's branch: no request reached it.
- I didn't run tests#1's e8, any WebAssembly or browser timing (a refusal with histories can plan up to three times), or my requests against c3d24629, which I read only.
- I didn't check the TypeScript side of c3d24629: change_outputs + 1, the summed minimum.

Contradictions settled:
- ts-parts#1's 'new in 1.9.1' holds only for the unreached path. The path users reach predates 1.9.1 (chain-rust, critic#3).
- tests#3's reason for the early return being unreachable is wrong, though its conclusion holds (critic#1).
- tests#7's flake odds are off by half (critic#6).

A slip on my side: my first `git worktree add` passed a relative path with `-C release-1.9.1`, which put the worktree inside the release tree (release-1.9.1/review-1.9.1/critic/tree) for under a minute. I removed it with `git worktree remove --force` and deleted the two empty folders before building anything. The tree's status was then exactly as it was before.

The release tree moved during my run: 36d90389 (version and lists), c3d24629 (the fixes), af32b1aa and 23ca5f20 (docs). My probes describe 3063b33f.

I didn't write report.md: the session's rules forbid report files from subagents, so this output is the report.

Artifacts, all in SCRATCH/review-1.9.1/critic/:
- critic_probe_test.rs: helpers copied from chain-rust's review_chain_test.rs, plus funding_window_full_request, token_boxes_keep_needs_an_amount, histories_bounty, which_requests_leave_a_carry and unspent_carry_both_builds.
- instrumented-lib.diff
- window.out/.err, leave.out/.err, hist.out/.err, boxes.out, both.out
- scripts/cmp_hist.py

The cargo target ~/.cache/seedelf-review-1.9.1/critic remains.
