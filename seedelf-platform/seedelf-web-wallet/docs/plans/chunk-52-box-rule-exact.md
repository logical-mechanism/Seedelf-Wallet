# Chunk 52 · The box rule, exact

**Status: ⬜ not started.** For 1.9.3. Written 2026-11-19 on chunk 51's branch, so a new session can pick it up once 1.9.2 ships. The owner: "We could write these as chunks then commit push and open that pr for merge then after release we handle those chunks for the 1.9.3 since it would be much smaller of a patch then what ended up happening here."

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

### 1. ⬜ An exact search where a balance holds few boxes

- **Where a spend's boxes number at most N,** enumerate box sets in the rule's order:
  - the fewest of unknown making;
  - then the fewest boxes;
  - then the most a mix moved.
- **Cost each set** from its merged assets: the change's least with the set's tokens beside the tokens the change keeps anyway (`Kept`), with a lovelace bound before any build.
- **Build only a set that can pay,** with the other money as the orders take it today: all of it within the input limit, and the fewest past it.
- **Rules 1 and 5 stay as built:** pass d is still the backstop, and a set never takes more of the other inputs than the plain choice's build takes.
- **Past N,** the weights stay as in 1.9.2, and their margins stay named.
- **Pick N by measurement.** Start near 12, which is 4,096 sets with pruning by sums. Measure N boxes beside 400 payments, and 500 boxes (past N). The timing pins must still hold.

### 2. ⬜ The reviews' shapes, pinned

Each must pick the rule's best with the search on, and fail on 1.9.2's `build.rs`:
- l7merge#1's A and B, and l7still#1's three;
- l8merge#1 (A beside 1 to 5 small payments);
- l8still#2 (a third token box a little larger than the pool's two);
- l7merge#2's C and D, l8merge#2's four, and l8still#1's E, F and H.

`box_rule_reference_test.rs` checks rules 2 to 4 strictly for balances within N, in its default parts and in the ignored sweep.

### 3. ⬜ The holders of a token being sent, by the box rule

This is l6words#1's code option, the backlog's *The UTxOs holding a token being sent go by quantity*.
- Today `holding` takes a sent token's holders by how much of it each holds, whatever made them.
- Instead, among the holder sets that suffice, it would take a box a mix moved first, then a plain one, then one of unknown making, and only then go by quantity.
- That is the more private default, so build it. Say in the PR what it changes about which UTxOs carry a token.

### 4. ⬜ The words

- Where the search is exact, the margins leave privacy.md, architecture.md, flows.md and the WebAssembly's README.
- The privacy policy gets a new dated *Changes* entry, since 1.9.2's 19 November entry has shipped. That entry moved from 18 to 19 November at 1.9.2's merge, so fix the code comments that still cite "the 18 November entry": `token_holders_test.rs`, and the extension's `phrase-typed-translate`, `r5-when-it-asks` (one test title too) and `r6-when-it-asks` tests.
- The two backlog lines go: *An exact search for the box rule's rules 2 and 3* and the holders' line.

## Done means

- Within N, the reference's checks are strict, and every pinned shape picks the rule's best.
- The ignored sweep, the parts suite and the timing pins pass.
- The live preprod flows pass on the build (`run.mjs all` and `staking`).
- This plan moves to the archive with a record of its PR.
