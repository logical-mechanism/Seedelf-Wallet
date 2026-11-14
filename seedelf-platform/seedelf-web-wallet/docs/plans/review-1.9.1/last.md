# last (last-look)

8 finding(s).

## last#1: r2-planner#1's record says the second plan can't go in a window, but where a UTxO holding none of the tokens is left it can, with a different split

- **Severity:** nit; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-web-wallet/docs/architecture.md:170`

**What.** Four places say more than the code does. (1) architecture.md:170: "Where a part's smaller payment would leave its change under an output's least, the second plan can't go, and the first plan's overpayment stays". (2) reserving's doc, lib.rs:4347-4349: "What a part spends doesn't turn on what it pays, so the parts are the same, but where ... it's short there, and the second plan chains or is refused". (3) backlog.md:138: "there `reserving`'s second plan is short ... 1 to 2 % of the asks where a token takes three parts or more". (4) The untracked archive draft: line 60 narrows the condition to "every UTxO it spends holds the token, so there's none to add", and line 119 says the limit is "exactly where" what's spent turns on what's paid. What the code does: fit_part (lib.rs:4069-4071) retries a short part whenever `free` is non-empty (`free` = the UTxOs left that hold none of the tokens still owed). Room::for_ada adds one free UTxO, or, with no room for one, cuts the holders to two-thirds. The second plan then goes with different parts wherever the guard passes them. So the window exists only where nothing free is left, or where the retry costs a part or a carry. The archive's condition is wrong both ways: in the 90-box case below, all 20 UTxOs part 0 spends hold the token and the window still closes; in the 100-box case one free UTxO exists and the window stays.

**Scenario.** Case 1: 90 boxes (4.5 ₳ + 100 of token 0 each) plus one UTxO of ADA alone (10 ₳ or 3 ₳ past its least). Send all of the token and 94.8, 95.0, 95.5 or 96.0 ₳ to a Seedelf. Every ask pays exactly what was asked, as 13/20/20/20/17 inputs: the second plan cut part 0 to 13 holders. The same boxes without that UTxO pay +3.516960 ₳ at each of those asks. Case 2: 100 boxes plus the same UTxO, at 95 ₳. The window stays (98.516960 ₳ paid), because the 13-holder second plan needs a sixth part and the guard refuses it.

**Evidence.** Probe in my worktree at b0e7f5bd (SCRATCH/review-1.9.1/last/probe-free.rs, debug, inside api_test's parts_of_any_shape). It builds boxes as `UtxoResponse { value: "4500000".into(), ..utxo(i, 0, &[token(0, 100)]) }`, optionally adds `utxo(5_000, 10_000_000, &[])`, and calls `api::build_transfer_parts(sk, transfer(utxos, Some(asked), all))`. Output:
`LASTFREE free=None asked=95000000: parts=5 paid=98516960 over=3516960 [20in/89082968, 20in/4158552, 20in/1758480, 20in/1758480, 10in/1758480]`
`LASTFREE free=Some(10000000) asked=95000000: parts=5 paid=95000000 over=0 [13in/57835940, 20in/31888620, 20in/1758480, 20in/1758480, 17in/1758480]`
The same holds at 94.8, 95.5 and 96.0 ₳, and for a 3 ₳ free UTxO. With LAST_BOXES=100 and the free UTxO: `free=Some(10000000) asked=95000000: parts=5 paid=98516960 over=3516960`. With the guard forced off (probe-g1-100.rs): `LASTG1 100+free asked=95000000: parts=6 carries=0 paid=96758480 [13in/57835940, 20in/31888620, 20in/1758480, 20in/1758480, 20in/1758480, 7in/1758480]`.

**Suggestion.** State the condition the code has. Something like: "where that part is short and no other split goes in as many parts and carries (with nothing left that holds none of the tokens, it tries none), the second plan can't go". Narrow the backlog line's reach the same way, and fix the archive's parenthetical and its Lessons bullet to match. One observation for the owner's backlog call, traced and not run: the fewer-holders retry doesn't need a free UTxO, yet lib.rs:4069 gates it on one. Lifting that gate would close the pure 90-box window too, but not the 100-box one. It would also change every short part's retries.

## last#2: The new backlog line's overpay rule, one least for each token part past the second, gives 3 leasts for its own example, which pays 2

- **Severity:** nit; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-web-wallet/docs/backlog.md:138`

**What.** backlog.md:138 says the first plan goes "one least too many for each part of tokens past the second" and cites "90 boxes and 95 ₳ pay 98.52 ₳". In a window, the overpay is one least for each token part after the boundary part, less one. The boundary part is the one that pays less than its most. That is (P − b − 2) leasts, with b its index. (P − 2) holds only when b = 0, as in shapes#1's 50 ₳ asks. The backlog's example has b = 1: 5 token parts, 2 leasts over. r2-planner's other windows agree with the same rule: 150 boxes at 100 ₳ is +8.792400 (5 leasts of 1.758480, with 8 parts), and at 187.5 ₳ it is +7.033920 (4). The same phrase appears in two more places. In the suite's comment (payment_parts_shapes_test.rs:708-709) it describes the suite's own catch, 90 boxes at 243 ₳, which paid one least over, not three (shapes#1: 244.633490 for 243, in 5 parts). flows.md:370 and FINDINGS' M1 state it as a general rule.

**Scenario.** Sizing the open window from the backlog line: 90 boxes + 95 ₳ would pay 95 + 3 × 1.758480 = 100.28 ₳ by the line's rule. It pays 98.516960 ₳.

**Evidence.** Re-run at b0e7f5bd: `free=None asked=95000000: parts=5 paid=98516960 over=3516960 [20in/89082968, 20in/4158552, 20in/1758480, 20in/1758480, 10in/1758480]`. Part 0 pays its most and part 1 is the boundary. Parts 2 to 4 each pay a least of 1.758480, where one least was owed. 3.516960 = 2 × 1.758480. shapes.md: `90 boxes + 243 ₳ ... [89.090264, 89.084244, 63.192002, 1.633490, 1.633490] ... 244.633490 ₳ paid for 243.000000 asked`.

**Suggestion.** In backlog.md, say "one least too many for each part of tokens past the one after it", or keep only the example's figure ("two leasts over"). In the suite's comment, either cite shapes#1's 50 ₳ case, or say the suite's catch was one least.

## last#3: No test pins reserving's guard, which keeps r2-planner#1's windows from chaining: taking any second plan passes all 92 api tests and 7 lib tests while a window ask goes as 4 waiting parts

- **Severity:** low; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:4386`

**What.** The guard is `again.len() <= first.len() && chains(&again) <= chains(&first) && takes(&again)? < takes(&first)?` (lib.rs:4386-4388). In r2-planner#1's windows the second plan either chains (4 to 7 carries against 0) or needs one part more (last#1's 100 boxes), and the guard sends the first plan instead. r2-tests saw at 23ca5f20 that mutant G1 (always take the second plan) changed no test. Nothing in b0e7f5bd reaches a second plan either: #384's pins and the carry shapes all return the first plan. Now that the windows are recorded as left open, this guard is the only thing between them and a needless chain, against the owner's 'chain where needed'.

**Scenario.** G1 makes the guard `if true || (...)`. Then 90 boxes and 95 ₳ to a Seedelf go as 5 parts with 4 carries, so four parts wait on the one before and the wallet must stay unlocked. The release sends the same ask as 5 parts with none waiting. And 100 boxes plus one free 10 ₳ UTxO at 95 ₳ go as 6 parts where 5 go now.

**Evidence.** In my worktree at b0e7f5bd, with G1 applied:
`cargo test -j 4 -p seedelf-wasm --test api_test` → `test result: ok. 92 passed; 0 failed` (91 tests + my probe)
`--lib` → `ok. 7 passed`
Probe (probe-guard.rs): `LASTGUARD asked=95000000: parts=5 carries=4 paid=95000000`
Probe (probe-g1-100.rs): `LASTG1 100+free asked=95000000: parts=6 carries=0 paid=96758480`

**Suggestion.** Add two api_test cases, both of which hold today and fail under G1. First: 90 boxes (4.5 ₳ + 100 of one token), all of it and 95 ₳ to a Seedelf: no part spends another's output (carries empty), and paid ≥ 95 ₳. This stays true once the backlog line makes the payment exact. Second: 100 boxes plus one 10 ₳ UTxO at 95 ₳: 5 parts.

## last#4: FINDINGS.md records no round-two disposition, so its M1 row still says 'Fixed' with no word of r2-planner#1's windows

- **Severity:** nit; **confidence:** traced
- **Where:** `seedelf-platform/seedelf-web-wallet/docs/plans/review-1.9.1/FINDINGS.md:9`

**What.** FINDINGS.md was last written at 11:53:47, before round two's reports (12:42). It holds round one's clusters and the critic's rows only, with no r2-* row. Round two's 11 dispositions live in two places: b0e7f5bd's message, and the untracked archive draft (docs/archive/plans/review-1.9.1.md:55-67), whose ID table names FINDINGS.md as the clusters' home. Once the folder is committed (D6), FINDINGS' M1 row reads "Fixed: `reserving`" with no caveat. Two smaller points on the record. b0e7f5bd's message lists r2-planner, r2-tests and r2-docs but not r2-extension#1, although the commit carries its 'backs off' timeout (wallet.test.ts:127 cites it). And the draft's line 63 says "every new test fails with its fix reverted alone", which is more than r2-tests found. The refusal test is a guard on `owed == 0`: 1.9.0's chained passes it too, and only mutant e4 fails it. The TS 'adds up the parts' leasts' test passes under T1 by design.

**Scenario.** A reader of the committed working folder takes M1 as fully fixed, and finds no record of round two there.

**Evidence.** `stat`: FINDINGS.md 11:53:47; r2-*.md 12:42:07. `grep -n "r2-" FINDINGS.md` → nothing. b0e7f5bd's message: r2-planner#1, #2, r2-tests#1–#5, r2-docs#1–#3. r2-tests.md's coverage table: refusal test 'e4: FAIL ... c: ok (a guard, not a fail-before test)'; TS 'adds up...': 'T1: ok (by design)'.

**Suggestion.** Either add a round-two section to FINDINGS.md (r2-planner#1 recorded as open, the other ten fixed, and M1's row qualified), or say in FINDINGS.md that the archive holds round two. Name r2-extension#1 wherever b0e7f5bd's findings are listed. In the draft, write "every fix's test", or note the guard.

## last#5: M1's figures mix two tokens, and the three-parts test's comment cites 54.88 ₳, which its own shape never paid

- **Severity:** nit; **confidence:** traced
- **Where:** `seedelf-platform/seedelf-web-wallet/docs/plans/review-1.9.1/FINDINGS.md:9`

**What.** M1 says "61 boxes and 50 ₳ paid 51.76 ₳, 90 paid 54.88 ₳, 150 paid 59.78 ₳", and the archive draft's line 29 repeats it. 51.76 comes from critic#4's token, whose least to a Seedelf is 1.758480 (51.758480). 54.88 and 59.78 come from shapes#1's MIN, whose least is 1.633490 (54.883230 and 59.783700); with that token, 61 boxes paid 51.633490. Separately, the api test an_amount_whose_token_takes_three_parts_or_more_pays_what_was_asked (api_test.rs:4727-4728, c3d24629) says its 90 boxes "went as five parts paying 54.88 ₳". Its token(0, 100) has the 1.758480 least, though: under R1 its 90 boxes paid 55.28 ₳ to a Seedelf.

**Scenario.** Someone dividing the overpays gets 1.76 ₳ a least from the first figure and 1.63 ₳ from the second.

**Evidence.** shapes.md: '61 boxes + 50 ₳ to a Seedelf: 3 parts pay [48.366510, 1.633490, 1.633490] = 51.633490'; '90 boxes + 50 ₳: 5 parts, 54.883230'; '150 boxes + 50 ₳: 8 parts, 59.783700'. critic.md: 'BOXES 61 transfer asked=50.000000 ...: OK parts=3 paid=51.758480'. r2-tests.md: 'under R1 they pay 51.76, 51.28, 55.28 and 53.84 ₳'. My probe shows token(0, 100)'s least to a Seedelf: parts paying 1758480.

**Suggestion.** Use one token's series: 51.63/54.88/59.78 ₳ (shapes#1) or 51.76/55.28 ₳ (the api test's token). In the test's comment, write 55.28 ₳, or '54.88 ₳ with shapes#1's token'.

## last#6: reserving's rewritten doc leaves a 208-column line, the longest in lib.rs

- **Severity:** nit; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:4350`

**What.** When the r2-planner#1 sentence went in, the paragraph's last line wasn't rewrapped: "/// where it takes less from the Seedelf balance, in no more parts and no more carries; otherwise the first. `sent`: a part's payment (its lovelace and tokens) and all it takes, every payment and its fee." The house width is about 120. rustfmt.toml sets no wrap_comments, so `cargo fmt --check` passes anyway.

**Scenario.** Style only.

**Evidence.** `awk 'length($0) > 120'` over lib.rs at b0e7f5bd: 1050:143, 4096:147, 4350:208, 5228:125. Only 4350 is new in b0e7f5bd.

**Suggestion.** Rewrap the paragraph to about 120 columns.

## last#7: chain_end_tests still blames a closed window when the end after a carry is the thing removed

- **Severity:** nit; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:5378`

**What.** The new bracket comment says a window that moves past the scan's ends no longer reads as closed, and that holds. But mutant b (`if false && tokens.is_empty() && owed == 0`) refuses the window's fundings: after the carry, the pre-loop amount over the carry alone is short. Both brackets still pass, and the test fails with the same message a really closed window gives (W1). That message points away from the code that broke.

**Scenario.** Someone drops the end after a carry, which is critic#1's warning. The test fails, but says "the window this test reaches closed", so they go looking at fees or SPEND_BUDGET_GUESS.

**Evidence.** Mutant b in my worktree: `panicked at .../lib.rs:5376:13: no funding here ends on its carry: the window this test reaches closed`. W1 (build_withdraw without `request.funding.is_none() &&`) gives the identical message. Shifted windows give the bracket messages: at 1_214_000 → `the scan no longer starts short: fees or leasts moved the window` (lib.rs:5354); `extra - 22_000` → `the scan no longer ends on an amount: fees or leasts moved the window` (lib.rs:5358).

**Suggestion.** Say "no funding here ends on its carry: the window closed, or the chain no longer ends on a carry that paid it all".

## last#8: The tests#1 backlog line doesn't say that taking it makes critic#2's branch reachable and calls for its test

- **Severity:** nit; **confidence:** traced
- **Where:** `seedelf-platform/seedelf-web-wallet/docs/backlog.md:139`

**What.** FINDINGS' C1 and the archive draft's Left open both record that taking tests#1 would make #384's amount-first after a carry reachable "and need its test". The backlog line ("A chain's short last part of tokens carries rather than taking more ADA") is where that work would be picked up, and it says nothing of this.

**Scenario.** A later release takes the backlog line, and the amount-first after a carry starts building untested: a last part that leaves the carry unspent goes unseen, though carry_kept would count it.

**Evidence.** backlog.md:139 ends "... pays them, at more planning time on a refusal." FINDINGS.md C1: "Taking L8 would make it reachable, and need its test".

**Suggestion.** Append: "(then #384's amount-first after a carry is reached: test that its last part spends the carry, critic#2)".

## Checked and holds

- Ran at b0e7f5bd in my own worktree (target ~/.cache/seedelf-review-1.9.1/last-main): chain_end_tests 1 passed (2.3 s); the whole api_test 91 passed (140.8 s debug, with the machine's load average at 27).
- Vitest, from my worktree's extension/ (node_modules linked entry by entry, the release tree's wasm/pkg copied, sha256 431ca0bd…): wallet.test.ts and payment-parts-review-fixes.test.ts, 34 passed in 18 s. Pinned to 2 CPUs beside 4 busy loops, wallet.test.ts passed 27 of 27.
- tsc --noEmit is clean, cargo fmt --check -p seedelf-wasm is clean, and cargo clippy -p seedelf-wasm --tests -- -D warnings is clean, so the edited parts suite compiles.
- chained's new comment is true. A transfer's amount and a plain withdrawal's have the measured retry (build_transfer's measured_or_more, and lib.rs:3571 for non-fundings); only a funding's amount lacks it, while its carry is measured.
- The carry test's comment figures hold at b0e7f5bd: the move-in funding has part 0's carry at 1.502890 ₳ and part 1's change at 2.085198 ₳ (3.588088 ₳ counted), and the 22x8 shape's carry is 2.173536 ₳ funded and 7.176484 ₳ withdrawn.
- The change-outputs assertion can't underflow: a part whose carry is set always has that carry's output. Its spent-carry branch isn't reached by either shape, since no carry in them is spent later. That's harmless, because no screen shows changeOutputs.
- The carry test, now three builds, takes 5.3 s in debug alone.
- #384's one-part pins hold for all 12 cases. Given one part sending every token, the fourth assertion follows from the third; it's redundant and harmless.
- The suite's bound now names "an output's least" where no part sends a token, and its comment's claims about reach and fundings match r2-tests' runs.
- wallet.test.ts: the other tests run at most 3 Argon2id operations, the counts in the two new comments (5 and 7) are right, and changePassword's sealVault writes {version, blob}, which drops createdAt as vault.ts says.
- architecture.md's 'or none' line, flows.md's 'where that costs no more' and the reunited own#1/own#2 pair are right, and no added line dates a release or lowercases Seedelf in prose.
- FINDINGS.md's round-one rows match the reports: 31 findings (1 medium, 18 low, 12 nits), and every ID, grade and disposition. L1's 2.09/3.59 and 65.26/67.44 ₳, L7's 1.17/0.26 ₳ and C3's odds match, as do the Checked-and-holds figures (3,708; 139; 3,585; 167/562/39; 422; 1,161; 14 remainders). D1 to D4 hold in the tree.
- The archive draft's round-two counts (11 findings: 2 low, 9 nits) and r2-planner's figures (7,938 requests a build; 697 changed; 696 paying less, 1,923.06 ₳ in all) match the reports.
- The release tree is untouched; its status is the lead's two untracked items. My worktree is removed, with its linked node_modules unlinked first.

## Coverage

Read in full: the diff 23ca5f20..b0e7f5bd (lib.rs, api_test.rs, payment_parts_shapes_test.rs, wallet.test.ts, architecture.md, flows.md, backlog.md); both briefs; every round-two report, critic.md and FINDINGS.md; round one's headings and the figures FINDINGS cites; the lead's untracked archive draft.

Ran, in SCRATCH/review-1.9.1/last/tree at b0e7f5bd, since removed:
- The three runs the task names (chain_end_tests, the whole api_test, the two Vitest files), plus tsc, fmt and clippy.
- Mutants:
  - M6 on the whole carry test, then on each 22x8 case alone;
  - R2 on each 22x8 case alone;
  - chain_end_tests' scan started at 1_214_000, and the window shifted up 22,000;
  - W1 and b against chain_end_tests;
  - a changePassword that keeps createdAt;
  - G1 against the whole api_test and lib.
- Probes: the carry figures under R2; the reserving window with and without a free ADA UTxO, for 90 and 100 boxes; G1 on a window ask and on 100 boxes plus a free UTxO.

All logs and probe sources are in SCRATCH/review-1.9.1/last/ (probe-*.rs, mut-*.log, probe-*.log, run-*.log, vitest-*.log). The cargo target ~/.cache/seedelf-review-1.9.1/last-main remains.

Not covered:
- The ignored parts suite in release, which I only compiled; G1's effect on it is cited from r2-tests.
- WebAssembly and Chrome.
- Histories for a second plan that changes its split (last#1's 90-box case regroups which boxes each part co-spends; the guard doesn't compare merged histories, so I make no claim there).
- Fundings and addresses in the window probes, which went to a Seedelf only.
- Lifting fit_part's free-UTxO gate, which is traced, not run.
- Re-running r2-planner's sweeps.

No report.md was written: subagents return through StructuredOutput only.

## confirmed

```json
[
 "r2-planner#1 (low): recorded as left open, not closed. The record is in reserving's doc (lib.rs:4347-4349), architecture.md:170 and backlog.md:138; FINDINGS.md has no row for it, only b0e7f5bd's message and the archive draft do. It is right that the overpay stays where 1.9.0 had it. Re-run: 90 boxes at 94.8, 95, 95.5 and 96 ₳ pay +3.516960 ₳, and 94.6 and 96.2 pay exactly. But the record overstates where the window is (last#1) and how much it costs (last#2), and the guard that stops it chaining is untested (last#3).",
 "r2-planner#2 (nit): closed. The carry test checks each part's change_outputs against the decoded outputs not paid to the recipient. With `*change_outputs += 1;` removed it fails at api_test.rs:4833: \"a move-in's bundles, funded: part 0's change outputs\", left 0, right 1. Each 22x8 case also fails it alone (funded and withdrawn: left 8, right 9).",
 "r2-tests#1 (nit): closed by its second option. The suite's comment now says the bounty's trailing part is #384's api test's and no suite shape reaches it (payment_parts_shapes_test.rs:710-711). The gap stays, now stated: 1.9.0's chained still passes the suite.",
 "r2-tests#2 (nit): closed. The comment says a funding would count its collateral as paid, and the message reads \"an output's least\" where no part sends a token (the `(leasts, what)` tuple). The suite compiles clean under clippy --tests -D warnings; I didn't run it.",
 "r2-tests#3 (nit): closed. #384's test now pins `paid.len() == 1` and `total == asked.max(least(&sold))` (api_test.rs:4510-4511), and all 12 cases pass at b0e7f5bd. The suite's comment says its bound is relative to the plan's split. The archive draft records that relativity as left open; FINDINGS.md doesn't.",
 "r2-tests#4 (nit): closed. chain_from's doc now says the chain starts after a first part that paid the collateral (`first` false), and two bracket asserts come before the scan. A scan starting inside the window (1_214_000) fails with \"the scan no longer starts short: fees or leasts moved the window\". A window shifted up 22,000 fails with \"the scan no longer ends on an amount\". W1 (a funding's measured fallback) still reads \"closed\", so the brackets don't hide a really closed window. Mutant b's message still misleads (last#7).",
 "r2-tests#5 (nit): closed. The test gets 30 s, and its creation-time check bites: a changePassword that keeps createdAt fails with \"expected 1700000000000 to be undefined\". The Argon2id count of 7 in the comment is right.",
 "r2-docs#1 (nit): closed. architecture.md:171 now reads \"than there was, or none (1.9.1's release review, chain-rust#1, ts-parts#1)\".",
 "r2-docs#2 (nit): closed. flows.md:370 adds \"where that costs no more\", which matches the guard (no more parts or carries, less taken). It keeps the \"each part past the second\" wording of last#2.",
 "r2-docs#3 (nit): closed. own#1 and own#2 sit together again (backlog.md:135-136).",
 "r2-extension#1 (low): closed. 'backs off' (5 Argon2id operations) gets 20 s and 'changes the password' (7) gets 30 s. Pinned to 2 CPUs beside 4 busy loops, the file passed 27 of 27, those two at 2.4 s and 3.2 s. b0e7f5bd's message doesn't name it (last#4).",
 "critic#1 (L2): closes as FINDINGS records. The early return stays. chained's comment (lib.rs:4317-4319) says only a session's funding gets there, which is true: build_transfer has measured_or_more, and build_withdraw keeps fundings out of it (lib.rs:3571). chain_end_tests pins the return: mutant b fails.",
 "critic#2 (C1): recorded truthfully as left open (FINDINGS C1, the archive draft's Left open). carry_kept would count a carry that branch left, since it checks every part's carry against all later parts' inputs. The tests#1 backlog line doesn't carry the note (last#8).",
 "critic#3 (L1): closes as recorded ('both shapes tested'). The 22x8 shape is in the carry test, funded and withdrawn. Each case alone fails with carry_kept removed (R2: \"part 0 carries what no later part spends\") and with the change_outputs increment removed (M6). The figures re-read at b0e7f5bd under R2 match: carries of 2.173536 ₳ funded and 7.176484 ₳ withdrawn, and the move-in's 1.502890 + 2.085198 = 3.588088 ₳.",
 "critic#4 (M1): closes as recorded in grade and trigger (medium; three token parts, an ask above (P − 1) leasts). M1's row still says 'Fixed' with no word of r2-planner#1's windows (last#4), and its figure series mixes two tokens (last#5).",
 "critic#5 (C2): closes as recorded (not taken). lib.rs:3571 keeps `request.funding.is_none()`. Taking it would close chain_end_tests' window, and the test would say so (the W1 run).",
 "critic#6 (C3): closes as recorded. FINDINGS uses 5.48e-6 (23/2048²), merges shapes#2 and tests#5 into L7, closes docs#1 (development.md:182 reads 1.9.1) and keeps c3d24629's bound (N2)."
]
```
