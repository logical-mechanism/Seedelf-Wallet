# Chunk 52 · The box rule, exact

**Status: 🚧 in progress (2026-11-20, branch `web-wallet/box-rule-exact`, worktree `../Seedelf-Wallet-chunk52`).** Steps 1 to 4 are built and every offline check passes (*Done means*). Left: step 5, the review, then the record, then 1.9.3. For 1.9.3. Written 2026-11-19 on chunk 51's branch, so a new session can pick it up once 1.9.2 ships. The owner: "We could write these as chunks then commit push and open that pr for merge then after release we handle those chunks for the 1.9.3 since it would be much smaller of a patch then what ended up happening here."

Chunk 51's calls round ([its record](../archive/plans/review-51.md#the-calls-round)) built the box rule: how a private spend merges the boxes back from Lovejoin. It is round six's rule, the lead's, set on the owner's calls. In 1.9.2, rule 1 holds by construction: nothing 1e1b0647's selection sent as one transaction is refused or split. Rules 2 to 4 hold among the orders the search tries.

Near the input limit, beside token boxes, the search can miss a set, and architecture.md's *The box rule* names those margins. The cause is that one transaction weighs each box alone, but the least a set's tokens need back as change is shared, 20 kinds of token to an output. So a set pays more or less than its boxes' weights add up to.

Reviews six to eight of the calls round each found a new window, with 5, 3 and 4 mediums. Rounds seven to nine closed some of them. Then round nine narrowed the claims instead, by the lead's call. This chunk makes the rule exact where a balance holds few boxes, which is nearly every wallet.

## Start here

- **Read first:**
  - architecture.md's *Picking inputs*, *Merging* and *The box rule*;
  - `build.rs`: `box_rank` and `Weighed`'s docs, `apart`, `fewer_built` and pass d;
  - `box_rule_reference_test.rs`, and `mint_test.rs`'s `mod apart`.
- **The findings** are in chunk 51's calls folder, in git at the commit before its record's (*The IDs* in the record names it): `review6.json` to `review8.json` hold every shape, verdict and prototype, and `round6.json` to `round9.json` what each round built.
- **Branch `web-wallet/box-rule-exact` from `main`,** in a worktree.
- **Round nine had no review of its own** (`ff9e888f`, `fd107595`), to spare the owner's budget (2026-11-19). Read its diff first.

## Steps

### 1. ✅ An exact search where a balance holds few boxes

- **Where a spend's boxes number at most N,** enumerate box sets in the rule's order:
  - the fewest of unknown making;
  - then the fewest boxes;
  - then the most a mix moved.
- **Cost each set** from its merged assets: the change's least with the set's tokens beside the tokens the change keeps anyway (`Kept`), with a lovelace bound before any build.
- **Build only a set that can pay,** with the other money as the orders take it today: all of it within the input limit, and the fewest past it.
- **Rules 1 and 5 stay as built:** pass d is still the backstop, and a set never takes more of the other inputs than the plain choice's build takes.
- **Past N,** the weights stay as in 1.9.2, and their margins stay named.
- **Pick N by measurement.** Start near 12, which is 4,096 sets with pruning by sums. Measure N boxes beside 400 payments, and 500 boxes (past N). The timing pins must still hold.

**Built (2026-11-20):** `EXACT_BOXES` = 12, `Exact` in `build.rs`, called from `apart` where `box_list` holds at most 12.
- **The bound needs no fee model.** A fee is the same for every choice of as many inputs but for the bytes of the change and of the outpoints' indexes, which a set's cost includes. So a short build at a count bounds every set worth less at that count, and at larger counts by the inputs' computation fee, within `epsilon` (the bytes an output's address and lovelace can differ by, as the least sizes it). Only sets the bound can't rule out are built.
- **Costs without serializing.** `change_cost` works the least out from token counts, and a test holds it to the ledger's function over 400 random token sets. A change's tokens are laid out once around a set's (`Around`, `Laid`), so a set costs only the output where its tokens meet; a randomized test holds that to the full merge.
- **Measured** (`twelve_boxes_beside_hundreds_of_payments_plan_in_a_fraction_of_a_second`, release): 12 boxes beside 400 payments, 6 to 10 ms a selection, as 1.9.2; every box holding another policy's token beside 400 kinds of the other money's, 30 to 100 ms, as 1.9.2. Before the layout that balance took 13.6 s and 38 s (each set re-merged 400 kinds with `Assets::merge`'s linear lookups). 500 boxes are past N and unchanged. Debug: 22 to 35 ms, and up to 0.45 s for the token-heavy balance.
- **The pass before the first box of unknown making stays** between u = 0's levels and u = 1's: its orders' sets are all among the search's but for a token single past step 1's cap. Pass d and e stay after.

### 2. ✅ The reviews' shapes, pinned

Each must pick the rule's best with the search on, and fail on 1.9.2's `build.rs`:
- l7merge#1's A and B, and l7still#1's three;
- l8merge#1 (A beside 1 to 5 small payments);
- l8still#2 (a third token box a little larger than the pool's two);
- l7merge#2's C and D, l8merge#2's four, and l8still#1's E, F and H.

`box_rule_reference_test.rs` checks rules 2 to 4 strictly for balances within N, in its default parts and in the ignored sweep.

**Built (2026-11-20).** l7merge#1's A and B, l7still#1's three, l7merge#2's C and D, l8merge#2's four and l8still#1's E and H were already pinned by chunk 51 and pass on 1.9.2 too, so they can't fail there; they pass with the search. The three 1.9.2 still missed are new pins in `mint_test.rs`, each failing on 1.9.2's `build.rs` (run in a scratch worktree at `origin/main`) and passing with the search:
- l8merge#1: `beside_small_payments_a_box_of_unknown_making_stays_out_where_one_pools_ways_back_pay` (1.9.2 spent A, U and the 20);
- l8still#2: `beside_a_third_token_box_a_box_of_unknown_making_stays_out_where_one_pools_ways_back_pay` (1.9.2 spent U beside A or T3);
- l8still#1's F: `of_as_many_boxes_a_mixed_one_goes_where_its_token_shares_the_output_another_opens` (1.9.2 spent A, M, R and T).

The reference's plain choice is now the set of its level that adds the most (`set_value`, its own reckoning from the ledger's least), and every check is strict for balances within N, the pair parts too (they were checked within round eight's margin). Strict, it fails 1.9.2 in all three pair parts (31 picks) and passes with the search: default parts in 3.5 s release, the ignored sweep in 3 min 15 s (5,927 merges, 2,850 single-UTxO picks, 973 refusals).

### 3. ✅ The holders of a token being sent, by the box rule

This is l6words#1's code option, the backlog's *The UTxOs holding a token being sent go by quantity*.
- Today `holding` takes a sent token's holders by how much of it each holds, whatever made them.
- Instead, among the holder sets that suffice, it would take a box a mix moved first, then a plain one, then one of unknown making, and only then go by quantity.
- That is the more private default, so build it. Say in the PR what it changes about which UTxOs carry a token.

**Built (2026-11-20).**
- **`holding_by_rule`:** for each token, those that are no box first, the biggest first; then as few boxes of unknown making as hold the rest, then as few boxes, of as many the most mixed, beside as few of the others as then hold enough.
- **`select_script_inputs` builds both spends.** Where those holders differ from `holding`'s, it builds the spend from each and keeps the rule's, unless the other does better by the rule over all its boxes (`box_key`) or the rule's is refused. So nothing that built is refused, and no spend is worse by the rule than 1.9.2's.
- **The parts:** a `Worth` by history keeps its histories, `token_group` takes the rule's holders first (`Worth::holder`), and a part's picks go through `max_inputs_apart`. Parts by worth keep today's holders, so the planner's fallback tries them last.
- **Pins:** `token_holders_test.rs` (two old pins now expect the rule's holders; two new ones), and `api_test`'s `a_token_sent_in_parts_comes_from_boxes_a_mix_moved_before_those_of_unknown_making`. The three that pin a changed pick fail on 1.9.2.
- **Open, a new backlog line:** holders and what pays beside them aren't searched together, and the reference sends no token.

### 4. ✅ The words

- Where the search is exact, the margins leave privacy.md, architecture.md, flows.md and the WebAssembly's README.
- The privacy policy gets a new dated *Changes* entry, since 1.9.2's 19 November entry has shipped. That entry moved from 18 to 19 November at 1.9.2's merge, so fix the code comments that still cite "the 18 November entry": `token_holders_test.rs`, and the extension's `phrase-typed-translate`, `r5-when-it-asks` (one test title too) and `r6-when-it-asks` tests.
- The two backlog lines go: *An exact search for the box rule's rules 2 and 3* and the holders' line.

**Done (2026-11-20):** privacy.md, architecture.md (*Picking inputs*, *Merging*, *The box rule*, and the box of unknown making's line), flows.md's Send and the WebAssembly's README; the policy's entry is dated **20 November 2026** with its Effective line: move both to the merge day in the PR's last commit, one entry. The three extension tests now cite the 19 November entry.

### 5. ⬜ The review, then the patch

The owner, 2026-11-20: "We will do a review on this before publishing. Maybe we can update the chunk to talk about a review so its very pinpointed about what it needs to verify. Then after the review for the patch we retire that chunk and publish it."

Review the PR's diff against `main` (1.9.2). A finding is real only if a reviewer reproduces it, with a test that fails on this branch; one inside a margin the docs name is a low (chunk 51's stopping rule). Verify each:

1. **The bound never rules out a set that pays** (`Exact::first_built`, `Exact::bound`, `epsilon`).
   - A fee is `min_fee_a × size` plus parts the same for every choice of as many inputs. A set's cost counts its change's bytes as its leasts size them, and its outpoints' index bytes.
   - So two sets of one count differ in fee only by what `epsilon` covers: the least's dummy base address against the change's enterprise one (28 bytes an output), the change's lovelace past 2³², `even`, and `settle`'s fixed point.
   - Check that list is whole. Check the carry to a larger count (`per_input`: `computation_fee` at `SPEND_BUDGET_GUESS`, exact a spend input).
   - Check the `tried` key: two builds of one count, worth and number of outputs end alike.
   - Check the `large` prune, (count, outputs) after a failure other than short or too many.
   - Named, not covered: a set that pays exactly, leaving no change at all, is found only where it's built.
2. **A set's cost is the build's** (`change_cost`, `Around`, `Laid::cost`).
   - The token order is the inputs' as `select_script_inputs` hands them: base, then all the other money, then the boxes; or base, the boxes, then an order's first k.
   - `Laid::cost` must equal the full merge wherever it answers: a kind sent whole, or one after the set's, falls back; bumps into whole outputs change only an amount's head; the phase of the outputs after.
   - Try to break `a_sets_change_costed_from_its_layout_is_its_change_costed_in_full` and `a_changes_least_worked_out_from_its_tokens_is_the_ledgers` with shapes they don't draw: names past 64 bytes don't exist, but quantities near `u64::MAX` and many policies in one output do.
3. **The search tries every set 1.9.2's orders tried, in the rule's order** (`apart`'s exact block, `Exact::level`).
   - Each set goes beside all the other money (a) where one transaction takes it, else beside the fewest of each of c's orders.
   - c is skipped after a short a only for other money of ADA alone (fewer of it pays less). Check that holds with `last` UTxOs and a funding's last resorts.
   - The other money alone first (a's, b's and c's orders at no box); the pass before the first box of unknown making kept; pass d and e after.
   - Rules 4 and 5: a set with more mixed is tried only beside the plain choice's own other money (all of it, or that order's first `k_P`). Check no fewer k could be one.
   - Balances past 12 boxes run the weighed orders exactly as 1.9.2 did (`weighed_to`).
4. **The holders by the rule never refuse or worsen a spend** (`holding_by_rule`, `select_script_inputs`, `box_key`).
   - Both spends are built; the one returned must be the one whose inputs `spent` recorded.
   - `more_mixed_built`, `fewer_built` and the exact search's rule-4 phase each return their last successful build. Check every path.
   - The comparison is by unknown, then boxes, then mixed only: ties keep the rule's holders.
   - The CLI (`Histories::default`) is unchanged.
   - Per token, the greedy choice is the rule's best by quantity alone (fewest of unknown making, fewest boxes, most mixed). Holders chosen with what pays beside them aren't searched: the new backlog line.
5. **The parts** (`Worth`'s histories, `token_group`, `Worth::holder`, `max_inputs_apart`).
   - Only parts by history see the histories; by worth they plan as 1.9.2, and `by_history_first` falls back to them.
   - In a chain, `holder` now sorts before `rich`. Find a balance a chain planned on 1.9.2 that this branch refuses or splits otherwise (test wallet A's shape: the ADA with one holder, bundles at their least).
   - `max_inputs_apart` falls back to `holding` where the rule's holders are more than a part takes.
6. **Time.**
   - The worst sets to cost: 12 token boxes of 12 policies beside 400 kinds past the input limit, 0.1 s release.
   - A token send's two selections; a payment in parts, each part's rerun.
   - Measure in the WebAssembly (2 to 3 times native) on a slow machine, and hold the timing pins.
7. **The words.**
   - privacy.md, architecture.md, flows.md, the WebAssembly's README and the policy's 20 November entry: each claim against the code.
   - "12 boxes or fewer" counts boxes that add something (a box that adds less than nothing isn't one). "In one transaction" scopes the exact search, not parts.
   - The margins now hold past 12 boxes and in parts only. The policy says nothing the extension sends to a service changed.

Fixes go in this PR, each test-first (fails before, passes after). Then rerun *Done means*' checks, the live flows, and a short look at the fixes alone.

## Done means

- Within N, the reference's checks are strict, and every pinned shape picks the rule's best.
- The ignored sweep, the parts suite and the timing pins pass.
- The live preprod flows pass on the build (`run.mjs all` and `staking`).
- The review's findings are fixed or named, and its fixes pass the checks above.
- This plan moves to the archive with a record of its PR and its review, and 1.9.3 ships.

**Checks (2026-11-20, on the uncommitted tree):** `cargo test --workspace --locked` 1,104 passed (chunk 51's 1,095 and nine new); the box rule's ignored pair (the strict sweep, and 200 + 200 boxes in parts) and the parts suite (`payment_parts_shapes_test --ignored`, 163 s) pass; `cargo fmt --check` and CI's clippy pass. Typecheck; Vitest 3,949 and, preprod-only, 3,935; e2e 109 on the dev build, 3 on the data layer's, 109 on the store build. **Left:** the live preprod flows (`run.mjs all` and `staking`), which need the test wallet's phrase file in this worktree's extension folder; then the commit, the PR and its record.
