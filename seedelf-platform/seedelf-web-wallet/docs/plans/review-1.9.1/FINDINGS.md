# 1.9.1 gate review: the lead's findings

Round one ran six lanes over every PR since `web-wallet/1.9.0` (`c0b451a8`), as one tree at `3063b33f`, then a completeness critic. Each lane's report is beside this file. The lead verified each code finding by a test that fails without its fix and passes with it, run on the fix branch, and read the docs findings against the files.

## The clusters

| ID | Grade | What | Lanes | Disposition |
|---|---|---|---|---|
| M1 | medium | An amount whose tokens take three parts or more pays one output's least too many for each part past the second: `in_parts` left the parts of tokens after a part one least (`keep`). It takes an ask above (P − 1) token-output leasts: 42 boxes go in two parts and never overpay; with shapes#1's token, 61 boxes and 50 ₳ paid 51.63 ₳, 90 paid 54.88 ₳, 150 paid 59.78 ₳. The review shows the total with no note. Since 1.6.0 | shapes#1, critic#4 | Fixed: `reserving`, but in r2-planner#1's windows (below) |
| L1 | low | A carry no later part spends is in no figure: a chain's last part over the carry and what's left spends as few as pay (since 1.6.0), and #384's end after a carry (unreached from a full request). A funding's privacy note named 2.09 ₳ of private change tied to the one-time account where 3.59 ₳ was; in a second shape 65.26 ₳ where 67.44 ₳ was | chain-rust#1, critic#3, ts-parts#1, docs (a note) | Fixed: `carry_kept`, both shapes tested |
| L2 | low | #384's end after a carry had no test: deleting it passed CI. Only a funding reaches it (a guessed-budget amount, a measured carry), and no full request did in any run; dropping it brings the bounty's extra part back | chain-rust#2, tests#3, critic#1 | Kept, its comment says what reaches it; `chain_end_tests` in lib.rs |
| L3 | low | `chained`'s `owed == 0` was guarded only by the ignored parts suite | tests#3 | Fixed: a refusal test in api_test |
| L4 | low | No test reached a funding chain's first part that is its last (`starts`: the collateral) | tests#2 | Fixed: a test |
| L5 | low | #384's test bounded the total by the plan's own parts, ADA-alone ones included, so it held for 1.9.0's plan | tests#4 | Fixed: the token parts' leasts only |
| L6 | low | #384's vault check could fail by chance ("vault" then "version"), and missed words stored apart or out of order | ts-parts#3, tests#7 | Fixed: a structural check |
| L7 | low | Picking takes the biggest holder of each token (core's `holding`), so the bounty's shape still pays 1.17 ₳ in fees where one input pays 0.26 ₳; more ADA beside splits it into parts. Since before 1.9.0 | shapes#2, tests#5 | Backlog: changing core's picking is the CLI's too |
| L8 | low | A chain's short last part of tokens carries rather than taking more ADA, so two near-max asks of the parts suite are refused that the planner could pay. Since before 1.9.0 | tests#1 | Backlog |
| N1 | nit | The review's least added up an ADA-alone part's least as the tokens' | ts-parts#2 | Fixed: `whole` |
| N2 | nit | The parts suite's "pays after" check guards none of its shapes, and nothing bounded what parts pay from above | tests#6, chain-rust#2 | The suite's new bound; the bounty's own shape stays in api_test (the suite asks only all of each `several` token) |
| C1 | low | No run built #384's amount-first part after a carry: every chain it ended was one part. A selection change there would pass every test | critic#2 | Recorded as unreached; a carry it left would count as change (`carry_kept`). Taking L8 would make it reachable, and need its test |
| C2 | nit | A measured fallback for a funding's amount (the other fix L1's lanes offered) would retry on the balance's 20 largest UTxOs, merging other sessions' money | critic#5 | Not taken |
| C3 | nit | Corrections between lanes: the vault check's odds are 5.48e-6 a run (23 pairs of a 24-word phrase), not 2.6e-6; shapes#2 and tests#5 are one finding; docs#1 was fixed in the prep | critic#6 | Taken |
| D1 | low | development.md's blocks still named 1.9.0 | docs#1 | Fixed in the prep |
| D2 | low | Chunk 46 held the Rust proptest as an open call, which chunk 49 took | docs#2 | Fixed |
| D3 | nit | Chunk 48's record didn't name its merge | docs#3 | Fixed |
| D4 | nit | Chunk 50 named a *Status* section the verification README doesn't have | docs#4 | Fixed (*Next*) |
| D5 | nit | "342 files" in chunks 46 and 49 against 339 tracked | docs#5 | Left for a verification pass: the count may include generated modules |
| D6 | nit | The review folder under plans/ | docs#6 | As 1.9.0's: committed once, then compressed into the archive's record |
| V1 | low | The verification README said the kernel proves each script "accepts exactly when its Aiken source says it does" | verification#1 | Fixed |
| V2 | low | The README said #73 hadn't merged, where its *Next* and CLAIMS.md said it had | verification#2 | Fixed |
| V3 to V5 | nit | CLAIMS.md's count of the fork's changes; the two `policyAccepts`; stale check.sh and README lines | verification#3, #4, #5 | Fixed |

## Round two and the last look

Round two read the fixes where they meet the rest (`R2BRIEF.md`, `r2-*.md`): 11 findings, 2 low and 9 nits. The last look read what landed after it (`last.md`): 8, one low and seven nits. All were fixed in `3a7d7b1f` and `ddc6d07b`, or recorded as open:

| ID | Grade | What | Disposition |
|---|---|---|---|
| r2-planner#1 | low | Where a part's smaller payment would leave its change under an output's least, `reserving`'s second plan can't go unless another split goes in as many parts and carries, and the first plan's overpayment stays: a window about 1.46 ₳ wide at each part boundary, 1 to 2 % of the asks where a token takes three parts or more (90 boxes and 95 ₳ pay 98.52 ₳, two leasts over). Older: 1.9.0 pays the same there | Open, a backlog line; the docs say it (last#1, #2) |
| r2-planner#2 | nit | Nothing checked a kept carry's output count | Fixed: the carry test checks every part's |
| r2-extension#1, r2-tests#5 | low, nit | Two Argon2id-heavy wallet tests could run out of 5 s on two CPUs; the password test compared two undefined creation times | Fixed: 30 s and 20 s; the check seeds an older vault |
| r2-tests#1 to #4 | nit | The suite's bound claimed the bounty, would misread a funding's collateral and grows with the plan's split; #384's test could pin its plan; `chain_end_tests` named a collateral it never pays and would call a moved window closed | Fixed |
| r2-docs#1 to #3 | nit | A citation, flows.md's condition, the backlog's order | Fixed |
| last#3 | low | No test reached `reserving`'s guard, which alone keeps a second plan from chaining in r2-planner#1's windows | Fixed: a test, which fails without the guard |
| last#1, #2, #5 to #8 | nit | Where the windows are and what they cost; one figure series; a 208-column line; a test message; the backlog's note for critic#2 | Fixed |
| last#4 | nit | This file had no round two | Fixed: this section |

## Checked and holds

- #384 is sound. Its test fails on 1.9.0's `chained` and passes after. Over 3,708 requests a build, 1.9.1 never refused what 1.9.0 built, nor planned more parts or paid more; 139 that 1.9.0 refused now go in one part (chain-rust). Over 3,585 bounty-shape runs, no part after the payment was paid, no top-up, no overpay; 1.9.0 had 167, 562 and 39 (shapes).
- The unverified lead from the report's triage, `in_parts`' last part of tokens: its precondition never fired in any run. `chained`'s remainder under an output's least was reached 14 times, each refused short, as on 1.9.0; nothing overpaid (chain-rust).
- A funding pays its collateral once in every plan (chain-rust: 422 plans; shapes: 1,161 runs).
- #380 is the owner's guard tooling: not reviewed. It touches nothing the extension builds.
