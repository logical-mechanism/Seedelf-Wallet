# Lane L4cli

Returned by the workflow's agent `a37ead44a5708707b`, written here by the lead from its structured answer.

## Findings (3)

### l4cli#1 · low · The window gives within_kinds' 4,000 kinds to every holder of a sent token first, whatever each brings, so four stranger piles holding one unit of a fungible token the user sends push the user's own ADA out, and transfer --asset and sweep --asset are refused

- **Where:** `seedelf-platform/seedelf-cli/src/commands/rows.rs:364`
- **Who:** stranger · **Since:** 5be0b1b4 (cca673cd on cli/stranger-rows) · **Confidence:** confirmed-by-run

**Scenario:**

Line numbers are FIXTREE's; the file is byte-identical on cli/stranger-rows.

The user's Seedelf balance:
- U1: 2 ₳ and 1,000 SNEK (a receipt).
- U2: 300 ₳ beside one NFT. A CLI spend's change keeps the rest of the ADA with the last token chunk.

A stranger pays the contract four UTxOs under a re-randomization of the user's register. Each holds 1 SNEK beside 999 or 1,000 one-of junk tokens, 4,000 kinds with SNEK. Each sits at a contract output's least: 18.99 ₳ + 3 × 19.01 ₳ = 76.0 ₳ in all.

`transfer -l 50000000 --asset SNEK=100` and `sweep -l 50000000 --asset SNEK=100` are then both refused: "Not enough ADA in the Seedelf balance for this, its fee and the change", with 302 ₳ and 1,000 SNEK in the balance. Without the piles, and on round two's window, both send from [U1, U2]. main sent too: its window was the first 20 owned rows, here all six.

The piles stay. Each brings −78 ₳ to a spend, so every later spend of SNEK needs --utxo. A stranger can't see the balance, but can put one unit of each popular fungible token in every pile.

A dearer variant drops the user's own holder: 398 ₳, the piles paid their deposit plus 1 ₳ so they rank above U1, and U1 holds 3 NFTs beside its SNEK. The transfer is then refused with a false "The Seedelf balance holds only 4 of the token 279c…3f.534e454b, not 100" (a token the user holds that the CLI's own pick can't send).

**Evidence:**

Code (FIXTREE):
- rows.rs:361-364: `let (holders, others) = ranked.into_iter().partition(|u| holds_any(u, needed)); let most = holders.len() + at_most; let candidates = within_kinds(holders.into_iter().chain(others), &Assets::new(), most);`. Every holder's kinds are counted before any other row's.
- rows.rs:295-297, within_kinds: `if kinds.len() + new.len() > MOST_KINDS { continue; }`. U2's one NFT is the 4,001st kind, so U2 is skipped.
- build.rs:2989-3000, max_inputs_by: holding takes U1 (most SNEK), and the rest is P1..P4 by place.
- build.rs:2639-2652: the blind path tries [U1], [U1,P1] … [U1,P1..P4]. Each is NotEnough, since the piles' junk needs about 80 ₳ of change each, and the result is SEEDELF_SHORT.

Runs are offline, driving FIXTREE's real code. The test is SCRATCH/r51/work/L4cli/e2e/tests/l4cli.rs; it includes FIXTREE's tests/cli/harness.rs and src/commands/rows.rs by #[path], and round two's window copied verbatim from afc52463. Command: `CARGO_TARGET_DIR=~/.cache/seedelf-review-51/L4cli-target systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 30m nice -n 10 cargo test -j 4 --offline --test l4cli -- l4cli_ --nocapture --test-threads=1`, exit 101.
- l4cli_window_direct:
  - `pile of 1000 kinds: 18989860 lovelace at the contract's least, worth -78342870`
  - `piles=true round three: window ["U1", "P1", "P2", "P3", "P4"]; transfer of 50 ADA + 100 SNEK refused: Not enough ADA in the Seedelf balance for this, its fee and the change`
  - `piles=true round two: window ["U1", "U2", "P1", "P2", "P3", "P4"]; … builds, spending ["U1", "U2"]`
  - `piles=false round three: … builds, spending ["U1", "U2"]`
- l4cli_transfer_and_sweep_asset_e2e, through transfer::run and sweep::run and the mock Koios:
  - `Transfer piles=false: Ok(()), inputs Some(["U1", "U2"])` and `Transfer piles=true: Err("Not enough ADA in the Seedelf balance for this, its fee and the change")`
  - Sweep: the same.
- l4cli_window_drops_the_users_own_holder:
  - `the four piles hold 398179670 lovelace together`
  - `round three: window []; … Err("window: The Seedelf balance holds only 4 of the token 279c909f…3f.534e454b, not 100")`
  - `round two: … Ok(["U1", "U2"])`
- The same tests on cli/stranger-rows (a copy of the crate pointed at that worktree) print the same lines.

**Fix:**

Count kinds in rank order, and put first only the holders core's holding will pick, not every holder:
- Compute holding's pick over the evaluable rows, as max_inputs_by does (quantity_in per token).
- Admit those rows first.
- Run every other row, the unpicked holders included, through within_kinds in by_worth order.

Then a pile takes kinds only when it ranks above the user's rows by worth, which costs the stranger its whole deposit. for_select has the same holders-first budget (l4cli#2): fix them as one class. Add this layout to tests/cli/window.rs for `transfer --asset` and `sweep -l --asset`: four piles each holding one unit of the sent token, with 4,000 kinds.

**Known check:**

Searched review-51 INDEX.md, FINDINGS.md, owner-calls.md, fix-branches.md and lanes/L3cli.md and L3money.md, plus backlog.md (TREE's and FIXTREE's) and archive/plans. Terms: within_kinds, for_select, MOST_KINDS, "4,000 kinds", holder, holders first, window. Found:
- l3cli#1 and #3 and l3money#2 and #3: fixed by 5be0b1b4, which brought within_kinds in.
- The backlog's ⬜ "Picking takes the biggest holder of each token" and r2a#3 (owner-calls §1): about which holder core's holding makes mandatory, not a kinds budget spent before the user's rows.
- TREE backlog's ⬜ "Core's token sums are quadratic in their kinds": a slowdown.
None has the sent token's holders using up the kinds.

### l4cli#2 · low · fund's for_select gives the 4,000 kinds to the sent token's holders by lovelace, so four stranger piles at the payer's address, each holding one unit of it, leave out the user's own holder or ADA, and fund --asset is refused where round two sent

- **Where:** `seedelf-platform/seedelf-cli/src/commands/rows.rs:319`
- **Who:** stranger · **Since:** 5be0b1b4 (cca673cd on cli/stranger-rows) · **Confidence:** confirmed-by-run

**Scenario:**

The payer's address is the browser wallet's, and it's public. The README's dApp flow funds the Seedelf from such a wallet after buying tokens, so its holdings are known.
- Layout A: U1, 2 ₳ and 1,000 SNEK; U2, 500 ₳ beside 10 NFTs.
- Layout B: U1, 2 ₳ with 1,000 SNEK and 3 NFTs; U3, 500 ₳ alone.

A stranger sends the address four UTxOs, each 1 SNEK beside 999 or 1,000 junk tokens (4,000 kinds), each at the ledger's least there: 18.51 ₳ + 3 × 18.53 ₳ = 74.1 ₳.

`fund -s <seedelf> --asset SNEK=100 -l 10000000` (and `-l 100000000`) is then refused in both layouts: "Not Enough Lovelace/Tokens".
- for_select puts the holders first by lovelace, so the piles (18.5 ₳) come before U1 (2 ₳).
- In A, U2's NFTs pass 4,000 kinds and the ADA is left out.
- In B, U1's own 3 NFTs do, and the user's SNEK holder never reaches select. Round three's own holders_of fix (brings, l3cli#2) then sees only the piles' 4 SNEK.

Round two sent both, from [U1, U2] and [U1, U3]. So does round three's own select without for_select. main and round one refused these two layouts too, by their own orders.

fund has no --utxo. The way out is moving the piles, or the SNEK, with the browser wallet first.

**Evidence:**

Code (FIXTREE):
- rows.rs:314-327, for_select: `Ok(((!holds_any(&u, sent), holds_tokens, Reverse(lovelace)), u))`, then `within_kinds(…, base, usize::MAX)`. Holders are ordered by lovelace alone, where core's holders_of (utxos.rs:232-247) ranks them by `lovelace - change_floor(others)`.
- fund.rs:137-146: for_select, then fitting, then utxos::select. An empty pick bails "Not Enough Lovelace/Tokens".
- utxos.rs:381-389: once U1's SNEK is found, the loop takes the piles for ADA. utxos.rs:401-415: their junk raises the change floor to about 950 ₳, so the selection comes back empty.

Run (l4cli_fund_asset_e2e through fund::run with the web capture, plus fund's own steps with and without for_select):
- `pile of 1000 kinds at the payer's address: 18511450 lovelace at the ledger's least`
- `A fund 10000000 + 100 SNEK piles=true: for_select keeps ["P2", "P3", "P4", "P1", "U1"]; select without it ["U1", "U2"], with it []; fund::run Err("Not Enough Lovelace/Tokens")`
- `B fund 10000000 + 100 SNEK piles=true: for_select keeps ["P2", "P3", "P4", "P1", "U3"]; select without it ["U1", "U3"], with it []; fund::run Err("Not Enough Lovelace/Tokens")`
- The same at 100000000.
- piles=false: `fund::run Ok(()) inputs Some(["U1", "U2"])` and `Some(["U1", "U3"])`.

Round two's holders_of (most of the token) also picks U1, which holds 1,000 against the piles' 1 each; the rest of do_select is unchanged, so "select without it" is round two's pick.

l4cli_fund_on_main, with L3cli's verbatim copies of main's and round one's select: `A piles=true: main picks [], round one []`, `B piles=true: main picks [], round one []`.

The same output on cli/stranger-rows.

**Fix:**

for_select should admit first exactly the holders select will pick: holders_of's pick by brings, taken until the token is found, as core decides it. Expose that pick from core, or move the kinds bound into utxos::select after holders_of. Then put ADA alone, then the rest by lovelace, through within_kinds, so an unpicked holder's kinds never come before the user's other rows. This is the class of l4cli#1. create and util extract send no token, so they're unaffected (checked_ok). Add layouts A and B to tests/cli/fund.rs with the four piles, at -l 10 ₳.

**Known check:**

Same searches as l4cli#1, plus "Not Enough Lovelace/Tokens", holders_of, r2b#2 and r2cli#2 in review-51 and archive/plans.
- l3cli#2 and l3money#1 (fixed by 5be0b1b4's holders_of) had a stranger's holder with 100 junk tokens, too few to reach within_kinds' bound.
- r2b#2 (main's refusal when the ADA sits in a larger token UTxO) is main's own order.
None has for_select or within_kinds leaving out the user's holder.

### l4cli#3 · low · The window caps its candidates at 20 rows in within_kinds before core's fitting drops what would overflow a u64, so 20 stranger UTxOs of 2^63-1 of one token fill the 20, fitting keeps two, and a spend the user's own UTxOs pay is refused

- **Where:** `seedelf-platform/seedelf-cli/src/commands/rows.rs:363`
- **Who:** stranger · **Since:** 5be0b1b4 (cca673cd on cli/stranger-rows) · **Confidence:** confirmed-by-run

**Scenario:**

The user's Seedelf balance is 25 UTxOs of 2 ₳ alone: receipts, 50 ₳.

A stranger pays the contract 20 UTxOs under a re-randomization of the user's register. Each holds 3.76 ₳ and 2^63-1 of one junk token: the deposit of 1.66 ₳ plus 2.1 ₳, so each brings 2.1 ₳ and outranks the user's 2 ₳. That's 75.2 ₳ in all.

by_worth puts them first, within_kinds stops at 20 rows, and max_inputs_by's fitting keeps only two of them, since a third would push the token past a u64. The window is [J0, J1]: none of the user's 25 UTxOs.

`transfer -l 10000000` is then refused: "Not enough ADA in the Seedelf balance for this, its fee and the change". So is `sweep -l`, and any spend over about 5 ₳. Round two's window holds 20 of the user's own UTxOs and pays.

This reopens the owner's §7 (2) item, "a UTxO the spend never takes holds no place among the 20". e6d6a18d settled it, and tests/cli/window.rs pins it only for reference scripts. window's own doc (rows.rs:335-337) still says such rows take no place.

The cost grows with what the user's UTxOs bring, so this bites a balance of many small UTxOs. The ways out are --utxo, or sweep --all, which keeps two junk UTxOs a run and takes the user's.

**Evidence:**

Code (FIXTREE):
- rows.rs:363-364: `let most = holders.len() + at_most; let candidates = within_kinds(…, most);` caps rows. rows.rs:285 `if kept.len() == at_most { break; }`.
- The u64 check comes later. build.rs:2988 `let (fits, _) = fitting(&evaluable, &Assets::new(), holds_needed)?;`, and utxos.rs:533-539 drops a row whose merge overflows. The truncate at build.rs:3000 then has only two rows.
- Round two handed max_inputs_by every ranked row, so fitting dropped the 18 and the truncate filled the 20 from the rest.

Run (l4cli_window_overflow_rows_take_slots, rows::window and core's build::transfer, against round two's window copied verbatim from afc52463):
- `each junk UTxO: 3759350 lovelace (its deposit 1659350); 20 of them 75187000 lovelace; the user's 25 x 2 ADA`
- `round three: window of 2 (0 of them the user's): ["J0", "J1"]; transfer of 10 ADA: Err("Not enough ADA in the Seedelf balance for this, its fee and the change")`
- `round two: window of 20 (20 of them the user's): ["u0", … "u19"]; transfer of 10 ADA: Ok(["u0", "u1", "u2", "u3", "u4", "u5"])`
- The same output on cli/stranger-rows.

Only two of the 20 need the full 2^63-1. Rows that sort later need only a few units, since 2 × (2^63-1) + 2 already overflows, so the stranger needs two mints.

**Fix:**

Don't cap rows before fitting. Either:
- give within_kinds no row cap in window (usize::MAX), since the 4,000 kinds alone bound core's cost and max_inputs_by truncates to 20 after fitting; or
- have within_kinds keep each token's u64 sum, as sweepable does (rows.rs:164-185), and skip a row that would overflow before it takes a place.
Extend window.rs's utxos_a_spend_never_takes_hold_no_place_among_the_20 with this overflow case.

**Known check:**

owner-calls §7, the CLI fixer's note (2), is the same class: "the 20-UTxO window … is picked before any filter, so a stranger's UTxOs that selection then refuses take slots". It is recorded as settled by e6d6a18d ("every owned UTxO, the refused ones out"), and fix-branches.md's errata say the same. This is that item undone by 5be0b1b4's row cap, a new regression and not the settled item. Also searched review-51 and backlog for overflow, u64, "2^63" and "take slots": r4#1 and r4#2 (fixed: sweeps and balances) and the backlog's ⬜ "Contract token totals saturate" (the web wallet's sign window). Neither covers this.

## Checked and holds

- The two branches match. `git show 5be0b1b4` and `git show cca673cd` are byte-identical without index lines. seedelf-cli/, core's utxos.rs, the README, Cargo.toml/Cargo.lock, seedelf-koios/src and seedelf-display are identical on FIXTREE and cli/stranger-rows.
- None of the core files that differ between the branches reach the CLI's paths. build.rs: the account-collateral hold (stage's None branch, which the CLI takes, is unchanged) and apart's short_whole (the CLI is blind, Histories::default). eval.rs: ogmios_purpose and Byron, for local evaluation only. cbor.rs: adds check_nesting; within_depth, which eval::refusal uses, is unchanged. schnorr.rs: a refactor. assets.rs: asset_id_to_asset, which the CLI doesn't call.
- Every one of this lens's five failing tests prints the same lines on cli/stranger-rows as on FIXTREE (a copy of the crate pointed at that worktree).
- by_worth's new key (Reverse(worth), holds_tokens) never moves a negative-worth row ahead of a positive one, and ADA alone wins only ties. sweep --all and external sweep still put the piles last, and most_that_fit's drop rule (negative worth only) and its termination are unchanged.
- value_of gives what assets_of gave for a Koios row: each token once, with None and Some(vec![]) both empty. So worth is unchanged, minus assets_of's per-row quadratic.
- window's eval::refusal pre-filter is the same set max_inputs_by filtered (reference script, too-deep datum), so it changes no rank or place.
- within_kinds never skips a UTxO of ADA alone, a skipped row doesn't count toward the cap, and the scan is linear.
- Timing is bounded. With 40 piles each holding the sent token beside 1,000 junk kinds, round three's window took 1.7 s and the window plus core's transfer 4.6 s, in a debug build; round two's windows over the same rows took about 100 s. fund's selection steps with for_select took 1.6 s.
- create and util extract send no token, so for_select's order is select's own: ADA alone, then token UTxOs by lovelace. within_kinds leaves out only what select would reach after piles whose change floor already refuses, so there's no regression against round two there (traced). fund with no --asset is the same.
- holders_of's brings is lovelace less change_floor(other tokens), the same floor do_select already applied, and it takes holders only until the token is found. In layouts A and B without for_select it picks U1 (run). A stranger's holder that brings more is spent with its own ADA covering its junk. Its new Result can't fail on honest Koios rows.
- The README's "`--utxo` can name one" holds. transfer_from, sweep_from and mint_from go through ScriptSpend::new with no refusal filter, the reference-script fee is priced, and sweep --all includes such UTxOs up to MAX_REFERENCE_SCRIPT_BYTES.
- transfer, sweep and util mint pass no token to the window except what's sent. util mint passes none, so l4cli#1 can't reach it. A transfer of ADA alone ranks the piles last and pays from [U2, U1] (traced).
- Nothing this lens ran wrote into either tree: `git status --short` is clean on FIXTREE and on cli/stranger-rows.

## Notes

- Money guards met (the schema has no guards field, so they're here):
- rows.rs:295, within_kinds' MOST_KINDS bound: stops core's quadratic token sums. Pinned by rows.rs's a_strangers_piles_dont_slow_the_window and within_kinds_hands_core_no_more_than_one_transaction_carries, and by the fund, create and extract 40-pile timing tests.
- rows.rs:349-352, window's refusal pre-filter: pinned by window.rs's utxos_a_spend_never_takes_hold_no_place_among_the_20, for reference scripts only.
- rows.rs:244, by_worth's key: window.rs's what_brings_most_is_taken_whatever_it_holds.
- utxos.rs:232-271, holders_of by brings, taken until found: selection_integration's fund_takes_the_holder_of_the_token_sent_that_brings_most and a_strangers_bigger_holder_of_the_token_sent_comes_last.
- build.rs:2988, max_inputs_by's fitting (overflow): now run after within_kinds' row cap (l4cli#3). No test puts overflow rows in the window.
- The gap behind l4cli#1 and #2: none of round three's new tests puts a token being sent in the stranger's piles. Every pile in rows.rs, fund.rs, create.rs and extract.rs holds only its own junk, so the holders-first budget was never exercised.
- l4cli#1 and #2 are one class (within_kinds counting the sent token's holders first). The lead may merge them. They differ in order (worth against lovelace) and so in what the stranger pays: about 76 ₳ at the contract to drop the user's ADA, or 398 ₳ to drop the user's holder; about 74 ₳ at the payer's address for either.
- Grading: all three are refusals a stranger can cause, each with a way out (--utxo; for fund, moving the piles with the browser wallet). The review graded the same class low (l3cli#1, l3cli#2, r2cli#2). Unlike l3cli#1, these piles stay in the balance, so every later spend of that token needs --utxo. A tiebreak may weigh l4cli#1 higher for that reason.
- The window's doc comment (rows.rs:335-337) says a row the spend would never pick takes no place. l4cli#3's fix should keep that true, or the comment should change.
- Test code is in SCRATCH/r51/work/L4cli/e2e/tests/l4cli.rs:
- l4cli_window_direct, l4cli_transfer_and_sweep_asset_e2e, l4cli_fund_asset_e2e, l4cli_window_overflow_rows_take_slots and l4cli_window_drops_the_users_own_holder fail on both branches.
- l4cli_fund_on_main, l4cli_holder_piles_timing and l4cli_round_three_holder_piles_timing are information only.
- old_select.rs is L3cli's verbatim copy of main's and round one's select.
- The CLI-branch copy is in L4cli/e2e-clirows/. Run logs are L4cli/run1.log to run6.log and run-clirows.log.
Both Cargo targets under ~/.cache/seedelf-review-51 (L4cli-target, L4cli-clirows-target) are removed.

## Coverage

Read in full:
- The 5be0b1b4 diff, all 12 files; checked byte-identical to cca673cd.
- FIXTREE's rows.rs.
- The CLI's selection paths: fund.rs, create.rs, util/extract.rs, transfer.rs, sweep.rs, external/sweep.rs, util/mint.rs.
- Core utxos.rs: collect_*, change_floor, holders_of, select/do_select, assets_of, fitting.
- Core build.rs: max_inputs/max_inputs_by/holding/quantity_in, select_script_inputs' blind path, transfer/transfer_apart/transfer_from/sweep_from/mint_from, ScriptSpend::new and stage's collateral branch, deposit_outputs/minimum_deposit/minimum_address_payment/pay_address.
- Core assets.rs, all of it, and eval::refusal.
- Round two's by_worth, window and holders_of/do_select (afc52463).
- The core diffs between the two branches (build.rs, assets.rs, eval.rs, cbor.rs, schnorr.rs).
- README.md lines 140-195.

Review records: COMMON.md, fix-branches.md, RESUME.md, lanes/L3cli.md, lanes/L3money.md and owner-calls.md. INDEX.md, FINDINGS.md and both backlogs searched.

Skimmed: harness.rs, window.rs and the round-three tests.

Ran (offline, own scratch crate, capped): FIXTREE's real transfer::run, sweep::run, fund::run, rows::window, rows::for_select and core's build::transfer, on FIXTREE and on cli/stranger-rows. No test in either tree, no build into either tree.

Not reached: remove, balance (beyond its printout), history and util age/find; the web wallet; the proofs; core's estimate and fee internals beyond what a refusal needs.
