# r2-planner (r2-planner)

2 finding(s).

## r2-planner#1: The second plan breaks where its smaller payment leaves change under an output's least, so shapes#1's overpay stays in a window about 1.46 ₳ wide at each part boundary

- **Severity:** low; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:4163`
- **Since:** older (the overpay dates from 1.6.0; the fix leaves it in these windows)

**What.** `reserving` plans a second time on the assumption, stated in its own doc, that "What a part spends doesn't turn on what it pays, so the parts are the same" (lib.rs:4345). That assumption fails in one case.

The part that can pay more than is owed now pays `owed - keep`, with `keep` the reserve (lib.rs:4163-4171). When that part's most exceeds `owed - keep` by less than the least its change needs (an output of ADA alone at the wallet's own register: 1.456780 ₳), the amount is short:
- Every UTxO it spends holds the token, so `fit_part` has no free UTxO to add (lib.rs:4069-4074 falls through to `Err(_) => None`).
- `in_parts` breaks short (lib.rs:4177) and plans a chain from that part.
- The guard (lib.rs:4383-4385) rejects that chain (4 to 7 carries against 0), or the chain is refused.
- The first plan goes, with one least too many for each part of tokens past the second: exactly the shapes#1 figures.

There is one window per part boundary: the asks where owed at that part falls in (most + reserve - 1.456780, most + reserve).

Counts from my sweeps:
- 704 first plans overpaid.
- 696 second plans fixed them and pay exactly max(asked, Σ token leasts).
- The other 8 were all in such windows and overpay by the same amount as on 36d90389.

Tests miss the windows. The new api test asks 50 ₳ and the parts suite 243 ₳; both are outside every window, so both pass.

This is not a regression: 36d90389 overpays the same there. The review shows the inflated total, and since whole()'s minimum (the Σ of leasts) isn't the lovelace, there's no minimum note to explain it.

Older, with the same root, on both builds: the first plan has its own window (keep = least(later)), where it chains when it doesn't need to.
- 150 boxes + 90 ₳ to a Seedelf goes as 8 parts, 7 of them waiting on the part before.
- 42 boxes + 89 ₳ to an address carries 87.799950 ₳ back to the wallet in part 0, and part 1 doesn't spend it. carry_kept now counts that carry as change, which is right.

architecture.md's "A part that can pay more than is owed leaves the parts of tokens after it their leasts" says more than the code does in these windows.

**Scenario.** Lovejoin token boxes (4.5 ₳ and 100 of one token each), all of the token sent. To a Seedelf unless said:
- 90 boxes, any ask from 94.7 to 96.1 ₳ (0.1 ₳ steps): pays the ask + 3.516960 ₳. For example, 95 ₳ pays 98.516960 in 5 parts. 94.6 and 96.2 ₳ pay exactly.
- 150 boxes, 100.0–101.3 ₳: + 8.792400. 100 ₳ pays 108.792400 as [89.082968, 9.158552, 1.758480 ×6].
- 150 boxes, 187.5–188.5 ₳: + 7.033920.
- 150 boxes, 536.75–538.0 ₳: + 1.264768 down to + 0.020788.
- 480 boxes, 129 ₳: pays 165.928080 (+ 36.928080, 21 leasts). The second plan is refused.

As a session's funding:
- 90 boxes, 89 ₳: pays 91.560140 (+ 2.560140).
- 150 boxes at 75 %, 89 ₳: + 3.840210.
- Mixed boxes (40 of 4.5 ₳ and 200; 40 at their least and 100), 175.116760 ₳: + 0.613672.

That's about 1–2 % of the asks where these shapes go in three parts or more.

**Evidence.** Code:
- lib.rs:4163-4171: `let keep = least(&later)?.max(reserved); if paid.saturating_add(keep) <= owed { return Ok(all); } amount(picks, owed.saturating_sub(keep).max(least(&share)?), share.clone(), first)`
- lib.rs:4383-4385: `again.len() <= first.len() && chains(&again) <= chains(&first) && takes(&again)? < takes(&first)?`

Instrumented run: 23ca5f20 plus a println in reserving, in my own worktree (SCRATCH/review-1.9.1/r2-planner/variant-T-instrument.diff). For 150 boxes + 100 ₳:
`RSV first_us=2738075 second_us=1758233 paid=108792400 owed=100000000 leasts=14067840 reserve=[12309360, 10550880, 8792400, 7033920, 5275440, 3516960, 1758480, 0] ok kept=false parts=8/8 chains=7/0 takes=107280640/115810456 paid_again=[1758480 x7, 87690640] paid_first=[89082968, 9158552, 1758480 x6]`
Part 0 would pay 87.690640 of its 89.082968, leaving change of 1.392328 < 1.456780.

Fine sweep (window.sh, 0.1 ₳ steps):
- 90 boxes: `asked=94600000 paid=94600000 kept=true`, then `asked=94700000 paid=98216960 kept=false parts=5/5 chains=4/0`, … `asked=96100000 paid=99616960`, then `asked=96200000 paid=96200000 kept=true`.
- 150 boxes: `asked=99900000 kept=true`, then `asked=100000000 paid=108792400 chains=7/0`, … `asked=101300000 paid=110092400`, then `asked=101400000 paid=101400000 kept=true`.
- 480 boxes + 129 ₳: `err kept=false Not enough ADA in the Seedelf balance for this, its fee and the change`. Both builds paid 165928080.

Sweeps (r2_compare.py over the 36d90389 and 23ca5f20 logs):
- Main: `overpaid (paid > max(owed, token parts' leasts)): before 452, after 6`.
- Second sweep: `before 252, after 2`.
- Every `AFTER STILL` line carries the before's overpay, for example `boxes x90 1000pm F asked=89000000: over 2.560140 ... pays [84083672, 3636258, 1280070, 1280070, 1280070] (before over 2.560140)`.

The older chain, on both builds:
- before: `x150 S 90 ADA: parts 8 links 7 carries 7 paid 90000000`
- after: `parts 8 links 7 carries 7 paid 90000000`

**Suggestion.** In `in_parts`' closure, where `amount(owed - keep)` is short only because its change would be under its least, pay that much less: all but the change's least. The parts after it then pay a little over their leasts, which the last part of tokens takes as owed. Failing that, pay all, and the next part's keep absorbs the difference (at most one change least over).

This makes reserving's doc line true, closes these windows, and ends the older chain in the first plan's own windows.

Pin it with tests:
- 90 boxes + 94.8, 95.0 and 95.5 ₳ to a Seedelf pay exactly the ask. Each now pays 3.516960 over.
- 150 boxes + 90 ₳ goes with no part waiting. Now 7 parts wait.

## r2-planner#2: No test checks the kept carry's output count: deleting `*change_outputs += 1` passes every test

- **Severity:** nit; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:4434`
- **Since:** new in the fixes

**What.** carry_kept adds a kept carry to its part's change_lovelace and change_outputs (lib.rs:4430-4434).

api_test's a_carry_no_later_part_spends_counts_as_its_parts_change checks two things: that no carry is left unspent, and that held == payments + fees + change_lovelace. It never checks change_outputs.

changeOutputs is summed by whole() (script-spend.ts:522) and no screen reads it, so nothing a user sees depends on it today.

**Scenario.** Mutant M6, the line deleted: lib (7) and api_test (91) all pass. The move-in funding's plan then reports 1 change output where it makes 2 (one is the kept carry). My sweep's figures for that request move from 1 to 2 with the line in place.

**Evidence.** `bash mutrun-api.sh M6`, with lib-M6.rs = 23ca5f20 less `*change_outputs += 1;`:
- `test result: ok. 7 passed` (lib)
- `test result: ok. 91 passed` (api_test)

Controls on the same test, each failing:
- M5 (carry cleared but not counted) fails at api_test.rs:4842: `left: 92380780 right: 90877890`.
- M4 (counted but `carry` left set) fails at api_test.rs:4819.

**Suggestion.** In that api test, also assert each part's change_outputs: every output back to the wallet's register but the carries a later part spends.

## Checked and holds

- reserving never keeps a plan that pays less than asked or sends other tokens. Every exit of in_parts pays owed.max(…) (lib.rs:4153-4196), and so does chained (4276, 4295-4303). Over 7,938 requests per build, every 23ca5f20 plan pays at least owed and sends the same token quantities as 36d90389's plan.
- No new waits. A second plan is kept only with no more parts, no more carries and a lower `taken` (lib.rs:4382-4385). No request has more parts spending an earlier part's output on 23ca5f20 (0 of 7,938). The guard counts carries before carry_kept, so a first plan whose one carry no part spends counts as one. I found no way for the second plan to turn that carry into a spent one, since the chain's last part pays the same with or without the reserve, and none appeared in the runs.
- The trigger is right. It compares Σ payments[0] with max(owed, Σ least of the parts that send tokens) (lib.rs:4358-4369). A funding's collateral is in neither `paid` nor `owed`, and `taken` counts it in part 0 of both plans. Parts of ADA alone count 0, and keep least([]) through least(&later). 704 first plans tripped it: 696 second plans were kept, and 8 were rejected (all in finding 1's windows).
- `least(&later).max(reserved)` is right for the last part of tokens and for parts of ADA alone. Both get reserved = 0, so keep is least([]) as on 36d90389. Every kept second plan paid exactly max(owed, Σ token leasts).
- The reserve is indexed by part position, from the first plan. With the same picks, the second plan differs only in what the boundary part pays. It diverged only in the dust windows (finding 1), where the guard rejected it.
- carry_kept counts each kept carry once. A carry is kept only when no later part's inputs hold its outpoint (lib.rs:4422-4429). Its value is core `carried`'s rest_lovelace, ADA alone, and core's change_outputs already leaves the carry out (rest_outputs = token_chunks(empty).len() = 1), so adding the value and one output is right. In 34 unchanged plans where 36d90389 left a carry uncounted, 23ca5f20's change is 36d90389's plus the carry, less fee noise: a 12-bundle funding goes 2.085198 → 3.588088 ₳, and 42 boxes + 89 ₳ to an address 10.287812 → 98.087762 ₳. No 23ca5f20 plan leaves a carry uncounted.
- by_history_first's predicate change is rare and right. In 1,512 move-in requests whose histories order UTxOs apart from their worth (instrumented), 8 history plans had only a kept carry. For 7 of them, a plan by worth without a chain is refused anyway, so the outcome is the same. 1 changed (bundles received, the big UTxO own, the spare received; big 2 ₳, spare 3 ₳, to a Seedelf, least + 2 ₳). 36d90389 took the plan by worth: 53.289000 ₳ from the spare and 7 bundles, then 36.635000 from the big UTxO and 5 bundles. 23ca5f20 takes the plan by history: 51.289000 from the big UTxO and 7 bundles, then 38.635000 from the spare and 5 bundles. Both pay 89.924000 with fees of 1.686626 and change of 4.226934, merge the same two pairs of histories, and have no part waiting. That fits the owner's 'chain only where needed'.
- A funding's first and beside: all 2,160 funding plans on 23ca5f20 pay the 5 ₳ collateral once, in part 0. That includes the kept second plans and plans whose part 0 is a carry.
- No regressions over 7,938 requests per build. The bounty shapes (n10 and n30, with and without histories) are 2,376; token boxes ×42/61/90/150 at 100 % and 75 %, 708; move-ins of 8, 12, 18 and 24 bundles with spare ADA, 1,824; a spread token, 918; mixed boxes, 432; boxes with ADA beside, 168; the history orders, 1,512. Each shape went to a Seedelf, to an address and as a funding. 0 are refused now. 0 have more parts, more paid, more taken (beyond the ±12,342 lovelace of fee noise between identical runs) or more parts waiting. 697 changed: 696 pay less (0.100000–10.550880 ₳ each, 1,923.06 ₳ in all) and 1 is equal. No plan changed for the bounty shapes or the move-ins.
- Time of the second plan, native release, under load 10–22 on 12 cores from other lanes. It runs only where the first plan pays past the bound, never on a refusal. In 85 instrumented runs (42–480 boxes) it took 2.06 s on average against the first plan's 2.18 s (0.43–2.07×). The longest was 12.38 s: 480 boxes + 100 ₳ to a Seedelf, the whole request going from 7.1 s to 20.7 s; with per-box histories, from 12.0 to 19.7 s. Across the sweeps, where the first plan overpaid: boxes +1.84 s per request (1.97×), spread +0.39 s (1.40×), mixed +0.67 s (1.58×). Elsewhere 1.00×.
- Mutations, each applied alone to 23ca5f20 (clean: lib 7 and api_test 91 pass).
- M1, no second plan: api_test an_amount_whose_token_takes_three_parts_or_more_pays_what_was_asked fails (61 boxes to a Seedelf: 51758480 against 50000000), and so does the parts suite's every_shape_goes_in_parts_the_ledger_takes (2 with problems: boxes ×90 at 600‰ paid 244633490 and 244155080).
- M3, reserve ignored in in_parts: the same two fail.
- M2, carry_kept out: api_test a_carry_no_later_part_spends_counts_as_its_parts_change fails ('part 0 carries what no later part spends'). Lib and the suite pass.
- M4, the carry counted but `carry` left set: the same test fails.
- M5, the carry cleared but not counted: the same test fails at held == counted.
- M6: nothing fails (finding 2).
chain_end_tests calls chained directly, so no planner mutant reaches it.
- Planner consumers: `carry` is serde(skip). The only Rust reader after `plan` is by_history_first's predicate. The worker reads changeLovelace only in the funding note, and changeOutputs on no screen.

## Coverage

What I ran:
- Worktrees at 36d90389 (before), 23ca5f20 (after), an instrumented 23ca5f20 (println in reserving, by_history_first and carry_kept) and a mutation worktree, each with its own target under ~/.cache/seedelf-review-1.9.1/r2-planner-{before,after,mut,mutx}. Those targets are about 2.2 GB and are left in place. All four worktrees are removed.
- Planning compared through the public API only, with the same test files on both builds.

Comparing plans:
- Fees vary up to ±12,342 lovelace between identical runs, because the random seeds change the measured budgets, and a carry's output index varies.
- A plan counts as the same where its parts, tokens and inputs match and each payment is within 20,000 lovelace.

Not covered:
- No WebAssembly or Chrome timing; native only, under heavy load from other lanes. The worst plan I timed was 20.7 s native (480 boxes). I didn't measure how close a 25-part plan with histories and a second plan gets to the worker's 5 minutes in WebAssembly.
- Histories: only own, received and Lovejoin classes as I assigned them. No session classes, so no top-up with Fund{session}.
- Max and Everything were not swept. They go through neither reserving nor carry_kept, and every Max carry is spent by the next part.
- The fine window sweeps went to a Seedelf only. Fundings and addresses were seen only at the sweeps' single asks.
- Extension (TS) consumers beyond the grep for changeLovelace and changeOutputs.
- The docs, beyond the one architecture.md line in finding 1.

Kept in SCRATCH/review-1.9.1/r2-planner/:
- Test files: r2_planner_sweep_test.rs, r2_planner_sweep2_test.rs, r2_planner_sweep3_test.rs and r2_probe_test.rs.
- Scripts: r2_compare.py, r2_checks.py, r2_savings.py, tparse.py, window.sh, timing.sh, mutate.py, mutrun.sh and mutrun-api.sh.
- Logs: sweep*-{before,after}.log, sweep3-T.log, window*-T.log, timing*.log and mut-M1..M6/clean.log.
- Mutants and instrumentation: lib-M1..M6.rs with mutant-M*.diff, and variant-T-instrument.diff.

I wrote nothing in the release tree; its status is unchanged.
