# 1.9.1 gate review, round two: the brief

You review the fixes round one led to, where they meet. **Review only: never fix, commit, push, or edit a tracked file.** Every rule of [REVIEWBRIEF.md](REVIEWBRIEF.md) holds (the tree, what you may run, the limits, severity, the report), except what's below.

## The tree

`SCRATCH/release-1.9.1`, branch `web-wallet/release-1.9.1`, now at `23ca5f20`:

| Commit | What |
|---|---|
| `36d90389` | the prep: 1.9.1, the lists, development.md's blocks |
| `c3d24629` | **the fixes** (below) |
| `af32b1aa` | the chunk plans' facts (docs#2, #3, #4) |
| `23ca5f20` | the verification docs (verification#1 to #5), text only |

The whole of it: `git -C SCRATCH/release-1.9.1 diff 36d90389 23ca5f20`. Round one's reports are beside this file (`chain-rust.md`, `shapes.md`, `tests.md`, `ts-parts.md`, `docs.md`, `verification.md`). The tree's `wasm/pkg` is built from `c3d24629`, so Vitest there runs the fixed WebAssembly.

## The fixes in `c3d24629`

- **shapes#1 (medium, since 1.6.0):** `in_parts`' part that can pay more than is owed left the parts of tokens after it one output's least (`keep = least(&later)`), so an amount whose tokens took three parts or more paid one least too many for each part past the second (90 Lovejoin boxes of a token and 50 ₳: five parts, 54.88 ₳). Now `in_parts` takes `reserve` (per part index: the least the parts of tokens after it need) and keeps `least(&later).max(reserved)`. The callers plan through `reserving`: the first plan with no reserve; where its parts pay more than `max(owed, Σ least of the token parts)`, a second plan with each part's reserve taken from the first plan's shares, kept only where it takes less from the balance (every payment and fee: `taken`) in no more parts and no more carries.
- **chain-rust#1 and ts-parts#1 (low):** a carry no later part spends (a chain's last part over the carry and what's left spends as few as pay; or #384's end after a carry) was in no figure. `carry_kept` adds it to its part's `change_lovelace` and `change_outputs` and clears its `carry`, after `reserving`, in both callers' `plan`.
- **ts-parts#2 (nit):** `whole`'s `minimum` is the parts' leasts added up only where every part sends tokens.
- **Tests:** api_test's `an_amount_whose_token_takes_three_parts_or_more_pays_what_was_asked`, `a_carry_no_later_part_spends_counts_as_its_parts_change`, `a_funding_whose_chain_ends_at_its_first_part_pays_the_accounts_collateral`, `an_amount_the_balance_cant_pay_is_refused_never_paid_in_part`, and #384's test's bound over the token parts only; lib.rs's `chain_end_tests` (#384's end after a carry, from a constructed funding chain); the parts suite's new bound in `check_parts`; `payment-parts-review-fixes.test.ts`' least; `wallet.test.ts`' structural vault check.
- **Docs:** architecture.md, flows.md, privacy.md, wasm/README.md, backlog.md (two lines).

The lead checked: each new test fails without its fix and passes with it; all seedelf-wasm tests pass; the parts suite passes (0 with problems, 108 refused) and its bound flagged the 90 boxes without the fix; fmt and clippy are clean.

## Your lens

Your prompt names it. Look where the fixes meet the rest: a plan that changed for the worse, a consumer that read the old figures, a test that would pass a wrong plan, a doc that says more than the code does. The memory of past releases: every fix round broke something where two features meet.

## Report

Through the StructuredOutput schema only: subagents can't write report files here. IDs `r2-<lens>#<n>`.
