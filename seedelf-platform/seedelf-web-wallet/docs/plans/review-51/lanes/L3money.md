# Lane L3money

Returned by the workflow's agent `ad216ea6d5fed4651`, written here by the lead from its structured answer.

## Findings (3)

### l3money#1 · low · fund's holders_of leads with the UTxO holding the most of the token sent, whatever else it holds and however little ADA: a fund main builds is refused again, and a smaller one spends an extra UTxO

- **Where:** `seedelf-platform/seedelf-core/src/utxos.rs:220`
- **Who:** user · **Since:** af022a6f (afc52463 on cli/stranger-rows, the CLI patch branch; same utxos.rs) · **Confidence:** confirmed-by-run

**Scenario:**

The payer's address (`fund -a`) holds the user's own two UTxOs: U01, 2 ₳ with 150 T and 40 of their NFTs in one UTxO (as a wallet that gathers tokens leaves them), and U02, 50 ₳ with 100 T. `fund -s <seedelf> -l 45000000 --asset <T>=100`: main takes U02 alone and builds. On FIXTREE, holders_of ranks the holders by the T they hold, so U01 (150) goes first. Its 50 T and 40 NFTs (41 kinds) join the change, and select's floor becomes 3 × 7,482,160 = 22.45 ₳. The goal rises to 67.45 ₳ against the 52 ₳ held, and fund says "Not Enough Lovelace/Tokens". With -l 10000000 it builds, but spends U01 too: 41 kinds of change in 3 outputs, a larger fee and the NFTs moved, where main spends U02 alone. A stranger can force the same at the user's address with one UTxO of 1.5 ₳, at least as much T as the user's largest holder, and 60 NFTs. On a tie, the hash the payer ground wins, since address_utxos pages in tx_hash order. Then -l 100000000, which main builds, is refused, and -l 10000000 spends the stranger's junk into change outputs. No money is lost. The ways out are funding less ADA with the token, or moving U01 with the browser wallet.

**Evidence:**

FIXTREE lines. utxos.rs:205-229 holders_of: `holders.sort_by_key(|&i| Reverse(of(i)))` (:220), then `if have >= want.amount { break; }`, so the order is the amount of the token alone. Ties keep the order given, which is Koios's tx_hash order (koios.rs:227, address_utxos :313 via utxo_pages). do_select :281 `let front = holders_of(&held, &tokens)`; the rest is sorted `(!held[i].1.is_empty(), Reverse(held[i].0))`. The loop's first branch takes a front UTxO (`utxo_assets.any(tokens) && !found_assets.contains(tokens)`) and merges all its tokens into found_assets. The floor `multiplier × wallet_minimum_lovelace_with_assets(change)` (41 kinds → 3) raises the goal through the recursion until `Ok(Vec::new())`, and fund.rs:145 runs `bail!("Not Enough Lovelace/Tokens")`. main (cd764fba) sorted `(has_tokens, Reverse(value))`, so U02 (50 ₳) came before U01 (2 ₳).

Runs. Each used a copy (FIXTREE at ad8c3ce4, and the review tree) with its own CARGO_TARGET_DIR under ~/.cache/seedelf-review-51, removed afterwards. The tests call utxos::select after collect_address_utxos and fitting, as fund.rs:124-141 does, and are kept at SCRATCH/r51/work/L3money/l3money_fund_own.rs and l3money_fund_holder.rs.
- FIXTREE: `U01 change: 41 kinds, one output's least 7482160, select's floor (x3) 22446480`, then `own goal=10000000 picked=["U01", "U02"] total=52000000 change_kinds=41`, then `own goal=45000000 picked=[]`.
- main: `own goal=10000000 picked=["U02"]` and `own goal=45000000 picked=["U02"]`.
- Stranger (1.5 ₳, T and 60 NFTs, beside U01 20 ₳ + 100 T and U03 100 ₳), FIXTREE: `case=tie, ground hash goal=100000000 picked=[]` and `goal=10000000 picked=["U00", "U03"] change_kinds=60`; `case=101, after goal=100000000 picked=[]`.
- Stranger, main: ["U03", "U01"] in all four.

**Fix:**

Rank fund's holders by what each brings: lovelace less the change floor its other tokens add (the CLI's rows::worth, with the address's least). Take them only until the tokens are found. Alternatively, keep holders_of, and when select comes up empty, select again in main's order (ADA alone first, then token UTxOs by lovelace) before refusing. Keep the tests for r2b#2 (`fund_takes_ada_from_a_token_utxo_sorted_ahead_of_the_one_holding_the_token`) and r2cli#2 (`fund_takes_ada_alone_before_another_holder_of_the_token_sent`, `fund_of_two_tokens_takes_only_the_holders_it_needs`), and add this layout and the stranger's. The class: core's `holding` (build.rs:3023) has the same rule, and the CLI window and every script spend use it. That part is the backlog's open candidate and the owner's call. Fund didn't share it until af022a6f copied it.

**Known check:**

backlog.md's ⬜ "Picking takes the biggest holder of each token" (1.9.1's review) is core's `holding` in script spends. Its cost is extra fees and its fix is the owner's call. Fund's utxos::select didn't use the rule in main; af022a6f copied it in, and here it refuses a fund main makes. So this is a new regression in another function, not that item; the new fact is in the notes too. Also searched: archive/plans (utxos::select, do_select), and review-51 INDEX, FINDINGS, owner-calls, fix-branches, lanes and verify, for holders_of, "most of", "Not Enough Lovelace/Tokens" and "second holder". Found: r2cli#2 (fixed: a second holder taken for ADA), r2b#2 (fixed: main's own refusal) and r2a#3 (owner: core's build.rs). The r2cli#2 verifier's fix note recommended holding's per-token pick, the rule that fails here.

### l3money#2 · low · The CLI's new window ranks every UTxO of ADA alone above every token UTxO: twenty small ones, a stranger's dust or the user's own receipts, shut out the ADA a CLI spend leaves in token change

- **Where:** `seedelf-platform/seedelf-cli/src/commands/rows.rs:221`
- **Who:** stranger · **Since:** e6d6a18d (d8114f19 on cli/stranger-rows; same rows.rs) · **Confidence:** confirmed-by-run

**Scenario:**

Under the user's registers the contract holds:
- their Seedelf;
- 300 ₳ beside 3 NFTs, and 150 ₳ beside 1. This is what a CLI spend's change looks like: core's deposit_outputs puts the rest of the ADA beside the last 20 tokens.
- 20 UTxOs of ADA alone at 1.46 ₳, about the contract's least. They're a stranger's: 29.2 ₳ in all, which become the user's. (Or 25 of the user's own 1.5 ₳ receipts.)

`transfer` of 100 ₳ to a Seedelf: rows::window puts the ADA-only UTxOs first and takes 20. The window holds 29.2 ₳ and neither token UTxO, so the transfer is refused: "Not enough ADA in the Seedelf balance for this, its fee and the change", with 479 ₳ in the balance. `sweep -l` and `util mint` draw on the same window. main sent the same transfer, since its first 20 in Koios's order held the token UTxOs. With 19 dust UTxOs FIXTREE sends too. The ways out are `--utxo` naming a token UTxO, or `sweep --all`, which takes the dust first, 20 a run. The stranger can send 20 more each time for 29 ₳. The README's new line describes this order ("then those that bring most, ADA alone first"), but 1.46 ₳ outranks 300 ₳.

**Evidence:**

FIXTREE lines.
- rows.rs:213-227 by_worth sorts by `(holds_tokens, Reverse(worth(&u, needs)?))` (:221), so any ADA-alone UTxO precedes every token UTxO, whatever each brings.
- window (rows.rs:244-266) hands that order to build::max_inputs_by. Its rest is `sort_by_key(|u| Reverse(worth(u)))`, with worth = Reverse(place), then `truncate(at_most - taken.len())` (build.rs:2988-2997).
- transfer.rs:132, sweep.rs:185 and util/mint.rs:97 build on the window. select_script_inputs then tries k = 0..=20 over it and returns SEEDELF_SHORT.
- The change: ScriptSpend::stage builds it with deposit_outputs (build.rs:2226), whose last chunk carries the rest (build.rs:374 `let amount = if i == last { remaining } else { minimum };`).

Run: a test through the CLI's offline harness, kept at SCRATCH/r51/work/L3money/l3money_window_dust.rs and added as `mod l3money_window_dust;` to tests/cli/main.rs in each copy. Rows are in insertion order, the user's oldest first, and transfer::run pays 100 ₳ to SAMPLE_SEEDELF.
- FIXTREE copy: `20 x 1.46 ADA dust beside 450 ADA in token change, transfer 100 ADA: Err("Not enough ADA in the Seedelf balance for this, its fee and the change")`; `25 x 1.5 ADA receipts ...: Err(same)`; `control 19 x 1.46 ADA: Ok(())`.
- main copy: all three `Ok(())`.

The copies and targets are removed.

**Fix:**

Rank the window by what each UTxO brings on its own: lovelace less what its own tokens need back in the contract (worth). ADA alone should only break ties, so a 1.46 ₳ UTxO never outranks a 300 ₳ one. Alternatively, take UTxOs by worth until they cover the payment, its fee and the change floor, and only then fill the rest of the 20. The README's Limits line changes with it. sweep --all can keep ADA alone first, since it takes everything over its runs. Add this layout to tests/cli/window.rs for transfer, sweep -l and util mint.

**Known check:**

Searched backlog.md (the CLI section, '20 UTxO', 'window', 'dust') and archive/plans ('first 20', 'window'). Searched review-51 INDEX, owner-calls §7, fix-branches ('For the owner' #2 and #4, and the Errata), lanes/R2cli.md and verify/r2cli-1.md. r2cli#1, which this commit fixed, was piles at ground hashes. The 'Dusting' item is sweeps carrying a pile. The 20-UTxO cap is settled (README Limits), but the order "ADA alone first" is new in e6d6a18d: r2cli#1's fix note suggested it, and nothing records its downside.

### l3money#3 · low · The CLI's window adds up every owned UTxO's tokens in core's fitting, quadratic in the kinds: a stranger's piles make each transfer, sweep -l and util mint take minutes

- **Where:** `seedelf-platform/seedelf-cli/src/commands/rows.rs:257`
- **Who:** stranger · **Since:** e6d6a18d (the window). Core's fitting has been quadratic since f446cb27 (1.6.0). · **Confidence:** confirmed-by-run

**Scenario:**

A stranger pays the contract P UTxOs under re-randomizations of the user's register. Each holds 1,000 distinct tokens: 2-byte names under a policy of its own, under 5,000 bytes of value, about 19 ₳ each at the ledger's least. Before e6d6a18d, transfer, sweep -l and util mint handed core 20 UTxOs. Now rows::window hands max_inputs_by every owned UTxO, and core's fitting merges each one's tokens into one running Assets whose add clones and scans the whole list. Measured in release: 20 piles (20,000 kinds) take 8.2 s and 40 piles 33 s. 100 piles (about 1,900 ₳, which stays junk at the user's contract) therefore take about 3.4 minutes, on every run of those three commands. sweep --all stays bounded (sweepable's MOST_KINDS), and --utxo skips the window. That's a slow-down at a stranger's high cost, not a lock.

**Evidence:**

FIXTREE lines.
- rows.rs:257 runs `build::max_inputs_by(&ranked, needed, at_most, ...)` over every owned UTxO; transfer.rs:102, sweep.rs:152 and util/mint.rs:69 now call collect_all_wallet_utxos.
- build.rs:2988 runs `fitting(&evaluable, &Assets::new(), holds_needed)`, and utxos.rs:501-505 runs `total.merge(tokens)` for each UTxO.
- assets.rs:207-216: `Assets::add` clones `self.items` and finds linearly, and merge (:312-319) calls it once per token. The running total is O(K²) in the kinds.
- rows.rs's own MOST_KINDS comment says "core's token sums grow with the square of the kinds", and that guard bounds sweepable alone.

Run: release build in a copy of FIXTREE, test kept at SCRATCH/r51/work/L3money/l3money_window_time.rs. It times piles of 1,000 tokens at 18 ₳ plus 5 ADA-only UTxOs, through utxos::fitting and build::max_inputs_by(..., 20, ...):
- `piles=5 kinds_total=5000 fitting=654ms max_inputs_by=633ms`
- `piles=10 kinds_total=10000 fitting=2.32s max_inputs_by=2.19s`
- `piles=20 kinds_total=20000 fitting=8.23s max_inputs_by=7.99s`
- `piles=40 kinds_total=40000 fitting=34.2s max_inputs_by=32.9s`

**Fix:**

Keep fitting's running total in a map keyed by policy and name, as rows::sweepable's BTreeMap does, and assets_of's per UTxO too. That fixes every caller of the class at once: the window, select_script_inputs (the web wallet's sends over every private row), max_inputs, account_inputs, and fund, create and extract's fitting. Alternatively, bound the window's rows by kinds (sweepable's MOST_KINDS) before max_inputs_by. A timing test at 40,000 kinds pins it.

**Known check:**

Searched backlog.md and archive/plans for 'quadratic', 'square', 'kinds' and 'slow', and review-51 INDEX, lanes and FINDINGS for 'freeze', 'hang', 'minutes' and 'fitting'. Found only w2#3 (decode.rs's bignum, unrelated) and rows.rs's MOST_KINDS comment, which bounds sweepable alone. W1a's note on one_more is a different loop. Not known.

## Checked and holds

- b3687869: every account-collateral spend reaches the new check. with_account is used only by merged_return (lib.rs:1377), whose measure_locally calls finalize twice (build.rs:1936, 1942), and finalize runs collateral_back at the fee that's sent. The CLI's finalize (spend.rs:48) has no account.
- b3687869: the typed CollateralShort survives to session_return: no context or re-wrap between finalize, measure_locally, merged_return, planned_return and built_or_without_strangers' `None => return Err(e)`. The fallback runs once with merge = [], making the plain sweep, which puts up no collateral and can't loop.
- b3687869: a fallen-back return reads right downstream. The result says merged 0 and the review's row says new UTxOs (LovejoinReturn.tsx:527 and 534 read back.merged). Spent marks and reservations come from the transaction's own inputs (spent.ts txInputs), so the unspent funding change isn't held.
- b3687869 AccountMint: the old stage refusal wasn't NotEnough, so account_mint's k-loop returned on it. Moving the check to finalize changes no input or collateral choice; only the band where the estimate's fee exceeds the settled fee now builds. Ogmios evaluates a draft with a saturated collateral return.
- AccountLaunch (launch.rs:503) still holds the least in stage at the estimate's fee, but holds in practice. Ran it in a copy: a launch whose collateral is exactly least + 3/2 of the settled fee (1,621,531 lovelace at fee 428,774) builds, and so does every value above. The one-shot mint's estimate never prices above its settled fee, so there's no band.
- 53780f85/81516188: koios register_of_datum, chain.ts registerOf and cip30's inspect read the indefinite pair alike, inner break first. Ran all ten of the fixture's register spellings (both indefinite-pair forms included) through ScriptSpend::new, proven, measure_locally against the deployed preprod wallet contract under uplc. Each spends, at fee 227,312, and eval::refusal refuses none, so a row the worker now counts is one WebAssembly spends.
- 81516188 SETTLED_RULE 3 only widens what's ours. Rows sealed as ours under rule 2 stay ours, and a stranger's indefinite-pair row becomes the user's spendable money.
- e4d97bea/61a4d717 are display only and consistent. The top-up and funding forms parse with tokenDecimals of the held token (TokenAmounts tokenChoices), and the reviews show `{...held, ...paid}`: the paid quantity with the held token's decimals. So what's typed is what's shown, and no decimals reach an amount that's paid.
- e6d6a18d: --utxo reaches every owned row (filter_utxos over collect_all_wallet_utxos). The window is a subset of fitting over all rows, so select_script_inputs keeps all 20. Holders first matches core's holding, as main's select_script_inputs did. The `holding` bail past 20 holders replaces a later shortfall.
- e6d6a18d sweep --all: by_worth before sweepable puts short piles last. sweepable's MOST_KINDS bounds its sums, most_that_fit terminates, and short UTxOs are now named on the error path. external sweep is unchanged apart from its message.
- af022a6f: create and extract pass no tokens, so holders_of picks nothing and their order is main's. The recursion ends because the goal grows by a positive floor each turn. r2cli#2's layout picks U1, U3.
- cli/stranger-rows (afc52463) carries the same utxos.rs, rows.rs and transfer.rs as FIXTREE, so l3money#1 to #3 ship in the CLI patch release unless fixed. FIXTREE is unchanged (git status clean at ad8c3ce4).

## Notes

- For the owner (new fact on a settled item): the backlog's ⬜ "Picking takes the biggest holder of each token" (core's `holding`) now reaches fund too. af022a6f copied the rule into utxos::select, where main didn't have it, and there it refuses (l3money#1), not just overpays. The CLI window's holders-first is core's holding, as main's was, so that part stays the backlog item's, decided with r2a#3.
- Outside round two, not run in WebAssembly: the web wallet's sends run the same quadratic fitting over every private row (select_script_inputs since f446cb27, and max_inputs and account_inputs). A stranger's 100 piles of 1,000 tokens (~1,900 ₳) cost about 3.4 minutes native per fitting, likely more in WebAssembly, and a private send calls it more than once. A worker event that long may be cut short by Chrome. l3money#3's map-based fix covers it; worth a T-lens timing.
- b3687869's fallback is silent until the review. A heavy return whose only collateral is the 2 ₳ fallback comes back as new UTxOs, not merged into the funding's change; the review's row says so. privacy.md's account of the merge could say when it doesn't happen. That's wording, not money.
- Earlier session: before the reset, this lens had started two scratch tests (l3money_fund_holder.rs, l3money_window_time.rs) and copies under ~/.cache/seedelf-review-51. I checked that the copies matched ad8c3ce4 and the review tree's Rust, reran everything, and removed L3money, L3money-main and both targets. L3still's copy is another lens's.
- Guards met: build.rs:1872 (finalize's collateral_back) stops a collateral return under an output's least at the fee sent, pinned by merge_test.rs an_account_collateral_whose_return_falls_under_its_least_is_refused and a_merged_return_whose_collateral_comes_back_with_its_least_at_the_fee_it_pays_is_built, and by mint_test.rs. lib.rs:1462 (the fallback): session_test.rs a_merged_return_its_fallback_collateral_cant_carry_comes_back_as_the_plain_sweep. utxos.rs:281 holders_of: selection_integration.rs (r2b#2's and r2cli#2's). rows.rs:244 window: tests/cli/window.rs. koios.rs register_of_datum's open-pair break: rows_test.rs and register_spellings_test.rs.
- Test files, all in SCRATCH/r51/work/L3money/:
- l3money_fund_own.rs and l3money_fund_holder.rs (core tests/)
- l3money_window_dust.rs (seedelf-cli tests/cli/, add `mod l3money_window_dust;` to main.rs)
- l3money_window_time.rs (core tests/, run with --release; L3_M and L3_NS set the sizes)
- l3money_indef_pair_spend.rs and l3money_launch_band.rs (core tests/, the checks that held)

## Coverage

Read in full:
- The diffs of b3687869 (build.rs, lib.rs and the new tests in merge_test, mint_test and session_test), e6d6a18d (rows.rs, sweep.rs, transfer.rs, util/mint.rs, external/sweep.rs, README), af022a6f (utxos.rs, selection_integration.rs), 53780f85 (koios.rs, rows_test.rs), 81516188 (chain.ts, contract-scan.ts, cip30.rs, decode.rs, register_spellings_test.rs), e4d97bea (balances.ts, withdraw.ts) and 61a4d717's worker and screen changes (dapp.ts moreThanNote, tx-view.ts withDecimals, rpc.ts, DappApprovals.tsx, SiteSessions.tsx, TxDetail.tsx).
- FIXTREE's rows.rs, fund.rs and utxos.rs select, do_select, fitting and collect_*.
- core's ScriptSpend: with_account, draft, finalize, estimate, measure_locally, measuring_draft, most_fee and stage's account branch.
- AccountMint (draft, finalize, estimate, settle, stage), account_inputs, account_collateral, account_mint, and AccountLaunch (stage, estimate, measure_locally, launch_from_account).
- max_inputs_by, holding, select_script_inputs, deposit_outputs and minimum_deposit.
- wasm: session_collateral, ReturnPlan, plan_return, built_or_without_strangers, merged_return, session_return, planned_return, draft_/finish_account_mint and build_launch_from_account.
- eval.rs: refusal, unreadable_datum, resolve and evaluate_with. koios: register_of_datum and extract_bytes_with_logging.

Read around:
- sweep.rs's body; chain.ts registerOf; balances.ts decimalsOf, atContract and ownedUtxos; contract-scan.ts's settled rule and readIndexView's head.
- coin-control collateralOf and account; account.ts readAccount; lovejoin-launch.ts fromPublic.
- sessions.ts: buildBack's merge, fundingChange and sendBack; spent marks.
- tokens.ts tokenDecimals and TokenAmounts tokenChoices; LovejoinReturn.tsx's merged rows.

Ran, in copies of FIXTREE and the review tree with their own targets (removed afterwards), six test files: the fund layouts on both trees, the window dust layout on both trees, the window timing in release, the ten register spellings through measure_locally, and the launch collateral band.

Not reached:
- ad8c3ce4's changes (writes after a network wait, the swap's late leg, Bring one back's one payer), and 2d639df8, e66a6a16 and 7b6881f7 (not in this lens's list).
- The extension's tests.
- The web wallet's own exposure to the quadratic fitting (not run in WebAssembly).
- seedelf-data's register reader (out of the chunk).
