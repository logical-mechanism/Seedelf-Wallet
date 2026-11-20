# 1.9.3's release review, its fixes and the gate (2026-11-20)

**Status: ✅ done, the gate for 1.9.3.** It's on branch `web-wallet/release-1.9.3`. It was [chunk 52](chunk-52-box-rule-exact.md)'s step 5 too. The reviewers' working files held local paths, so they stayed out of git; every finding is below, and what's left open is a line in [backlog.md](../../backlog.md).

## The review

**What it covered:** every PR since `web-wallet/1.9.2` (`36551c7b`), as one tree at `main`'s `07929504`.
- **#396, chunk 52:** the box rule made exact for 12 boxes or fewer (`Exact`), and a sent token's holders by the rule (`holding_by_rule`). Its plan's step 5 listed what to verify.
- **#397:** Mix my boxes again isn't held for a chain a lock cut partway (`stoppedForGood`), and the page reads the worker's hold (`SessionView.mixingAgain`).
- **#394** (CI's actions bumped by dependabot) and **#395** (1.9.2's record): read by the lead, nothing to review.

**How:** the owner's weekly budget was low, so four reviewers in one round, by step 5's points. Each finding had to be reproduced by a test failing on the release's code, and the lead reran every repro before fixing.
- **R1:** the exact search's arithmetic and its time (the bound, `epsilon`, the costs, the WebAssembly on two cores).
- **R2:** the search's order, and rule 1 by a differential against 1.9.2's build over 7,120 seeded picks.
- **R3:** the holders by the rule, and the parts.
- **R4:** #397's hold, state by state, and which button still works.

**16 findings: 1 high, 9 medium, 5 low and 1 nit.** The differential found no refusal of what 1.9.2 built; the refusals came from shapes built at an output's edges (20 kinds of token, 16 KiB).

## The findings

| ID | | What | Fix |
|---|---|---|---|
| r1#2 | high | The bound stopped only below the best short worth less `epsilon` (about 31,700 lovelace), so every set within it was built: 13,900 builds, 135 s for one Send in the WebAssembly on two cores (1.9.2: 0.64 s). | An exact bound per (change outputs, count), `epsilon` only across outputs, and a fee floor (`min_fee_b` and the inputs' computation): 0.1 s native, 0.5 s in the WebAssembly. |
| r1#1 | medium | A too-large build ruled out every later set of as many inputs and outputs, though a smaller one fits: two boxes where one paid. | The prune keyed by the bytes a set adds (`LARGER`), and no failed build in `tried`. |
| r2#1 | medium | After a short 1, 3's orders were skipped where the other money held no token, but they hold UTxOs 1 leaves out (`last`): one more box of unknown making than 1.9.2. | 3 starts where each order first holds what 1 leaves out. |
| r2#2 | medium | Sets were built with their boxes in the balance's order; token layout depends on it, so a spend 1.9.2 built in its weighed order was refused. | `Exact` takes the boxes in 1's weighed order. |
| r2#3 | medium | Where the plain choice went beside all the other money, a more-mixed set was never tried beside less (pre-existing; the words claimed it). | Also beside each of 3's orders' first k, fewer than all of it. |
| r3#1 | medium | Parts by history took every non-box and mixed holder before the box the rule needs: 21 boxes where 1.9.2 merged 1, 7 parts where it sent 2. | `token_group` puts the rule's holders for what's still owed first. |
| r3#2 | medium | Holders went no-box first for every purpose: a funding's token came from another session's money, or money made private, before a mixed box that paid alone. | `Histories::before_boxes`: the money the purpose takes before a mixed box first, then boxes, then the rest. |
| r3#3 | medium | A tie by `box_key` kept the rule's holders even where they merged money made private with the mixed box that paid alone. | A tie goes to the spend merging fewer histories. |
| r4#1 | medium | A cut chain's rest whose own chain never went was followed by a new Mix my boxes again chain over the wallet's boxes, beside the one the user pressed. | A rest after a started chain carries `from`; one that never went is the rest again. |
| r4#2 | medium | The hold came back while the cut session's rest went through its collateral's mix, up to a day with giveme.my busy, with "being mixed again" shown (pre-existing). | Such a rest holds nothing: it draws only others' boxes. |
| r1#3 | low | The chunk 52 timing pin printed its times and asserted none. | Bounds asserted, and r1#2's shape pinned. |
| r2#4 | low | The other money alone ran 3's orders, so a stranger's pile went in before any box. | The alone pass leaves `last` UTxOs out (1.9.2's pick). |
| r2#5 | low | flows.md and architecture.md put the parts' margins under "with more than 12". | "In one transaction", and "at any count" for parts. |
| r3#4 | low | Holders chosen token by token took two boxes of unknown making where one held both (pre-existing). | `needless_dropped`. |
| r4#3 | low | Lovejoin.tsx's comment, and #397's description, said 1.9.2's page copy let go where the worker refused. It never did: where they parted, the copy held what the worker took. | The comment; the record's sentence below. |
| r4#4 | nit | Two comments missed the rest's collateral mix. | Reworded. |

**#397's record, corrected (r4#3):** its description says 1.9.2's page copy of the hold let go of the boxes in four cases where the worker still refused the press (a funding never sent, an unsent return, `auto.failed` and `nothingBack`). It never did. With a funding never sent or `auto.failed` both let go; with an unsent return both held (the view leaves unsent transactions out); and with `nothingBack` the copy held where the worker let go, as it held after a cut chain. So the page's copy only ever turned off a press the worker would take, never offered one it refused.

**The owner's question from #397** (no "being mixed again" note while the button was off): R4 traced 1.9.2's code, and in that state the copy held and the note shares the button's prop, so the note should have shown. The code doesn't explain it.

## The lead's calls

- **A stranger's pile (r2#1, r2#4):** 1.9.2's picks kept. A UTxO that adds less than nothing goes in beside a set's boxes where one more box would, as 1.9.2's 3 took it, and with at most 12 boxes never with none where a box pays. Whether it should come after every box is a ❓ line in the backlog.
- **r2#3, r3#4, r4#2:** fixed in code rather than in words. Each named margin was a claim the release made.
- **The holders' split (r3#2):** a stealth mint and a pool's start send no token, so only payments and fundings reach it.

## The fixes

Each fix's pin fails without it and passes with it.

| Commit | What | Findings |
|---|---|---|
| `299f00d0` | the holders: `before_boxes`, `needless_dropped`, the tie by histories, `token_group`'s order; `token_holders_purpose_test.rs`, the WebAssembly's `parts_holders_test.rs` | r3#1 to r3#4 |
| `5e2b683f` | sessions.ts's `from` and `stoppedForGood`; `lovejoin-again-after-cut.test.ts` | r4#1 to r4#4 |
| `964128d1` | the exact search's bounds, prune, box order, 3's starts, the more-mixed sets, the alone pass; pins in `mint_test.rs`, `box_rule_reference_test.rs` and `build.rs`'s `exact_costs` | r1#1 to r1#3, r2#1 to r2#4 |
| `bd99f6f0` | the words: architecture.md, privacy.md, flows.md, the WebAssembly's README, the policy's 20 November entry, three backlog lines | r2#5, and every claim the fixes touched |
| `9bc0fde1` | the last look's four (below) | F1 to F4 |

## The last look

One reviewer read the merged fixes where they meet. It found 4, each reproduced, each fixed in `9bc0fde1` and pinned.
- **F1 (high, r3#4 × r3#1):** `needless_dropped` re-summed every token over all the others for each holder, and `token_group` chooses holders at every part: 400 NFTs paid in parts took 68 s native (1.9.2: 4.8 s), about 4 minutes in the WebAssembly. Now linear: 5.6 s, and the holders of 400 tokens in 7 ms.
- **F2 (medium, r1#1 × r2#1):** a too-large build at one level could pass over every set of a later one unbuilt, and 3's orders then started past every start: a spend 1.9.2 sent was refused at 16,401 bytes. Any too-large build so far now sends 3's orders from no money.
- **F3 (medium):** merging's first step still asked a stranger's pile before any box (pre-existing pick, but the new words said never). Left out there.
- **F4 (low):** the tie-break counted a top-up's own session as no history, so another session's money won (pre-existing pick). `Histories::ties` counts it.

## Left open

Lines in [backlog.md](../../backlog.md):
- **The exact search builds each set in one order of its boxes:** where a change passes 20 kinds of token, another order could pay. No test or sweep has found one.
- **A stranger's pile before one more box?** The owner's call.
- **A rest whose collateral's mix alone waits is called a chain being sent:** the chain row's and `lj.chainSending`'s words, and Bring one back now pressable about a block while the worker turns it away in words. New words, so translations come with them.
- **A sent token's holders aren't searched with what pays beside them** (chunk 52's line) stays.

## The release prep

`3beb6fab`: 1.9.3; tokens unchanged (32 mainnet); the DRep lists keep their counts (447 of 1,051 on mainnet, 64 of 296 on preprod, 19 and 3 left out for `doNotList`), recorded 2026-11-20; the pools' head start moves mainnet's height and gains no pool. The Strica registry step is the owner's and was skipped. No new strings, so no back-translation, and no screen changed, so no store images.

## The checks

At `9bc0fde1`, all green:
- **Rust:**
  - `cargo test --workspace --locked`: 1,126 passed, 14 ignored.
  - The box rule's ignored pair (`box_rule_reference_test --ignored`: the strict sweep, and 200 + 200 boxes in parts), and the parts suite (`payment_parts_shapes_test --ignored`).
  - `cargo fmt --check`, and clippy as CI runs it.
- **The differential against 1.9.2** (R2's harness, 7,120 seeded picks):
  - no refusal of what 1.9.2 built, and none worse by the rule;
  - 180 better;
  - 573 refused by both;
  - 18 alike by the rule with other inputs;
  - 4 past 12 boxes that differ, each sending a token (the holders by the rule).
- **Time, release native:**
  - chunk 52's pin, 5 to 7 ms a selection, 35 ms for the token-heavy balance;
  - r1#2's shape about 0.1 s, 0.5 s in the WebAssembly on two cores (it took 135 s);
  - 400 NFTs in parts, 5.6 s (1.9.2: 4.8 s).
- **The extension:**
  - typecheck;
  - Vitest, 3,960 on the default build and 3,946 on the preprod build;
  - e2e, 109 on the dev build and 109 on the store build, each with 1 skipped by design;
  - live Koios, 2.

## The live runs

**On `9bc0fde1`'s dev build, test wallet A, all ten confirmed:**
- **`run.mjs all`,** hosts preprod.koios.rest and www.giveme.my:
  - mint (account), `68b0a604`;
  - move in 25.5 ₳, `1b420492`;
  - stealth mint, `6b4902be`;
  - transfer 3.3 ₳, `f37bec0b`;
  - Make public 5.5 ₳, `459f7695`;
  - remove into the private balance, `5dd54fc2`.

  The last four spend from the private balance through the fixed selection.
- **`run.mjs staking`,** host preprod.koios.rest:
  - stake TPREP, `879e6015`;
  - vote no confidence, `dcbe2e34`;
  - vote abstain, `be1ddec5`;
  - stake LOGIC, `440eff94`.

**#397's live run** (the owner's, left for this review): a fresh wallet, since wallet A's held boxes in v2's 5 ₳ pool would read as not mixed yet after a restore. Its phrase was made by the wallet's own WebAssembly and kept out of every log. A funded it with 60 ₳ (`21c63fe0`); it minted a Seedelf from its account (`1db3ddb4`), made 54 ₳ private (`a63af2d6`), and mixed two boxes from its private balance into v2's 5 ₳ pool (funding `04d970d4`, its chain of 12 sent within a minute). A first Mix my boxes again, uncut, went on at once after that mix and ran its 15 transactions.

The test itself, a Mix my boxes again over 4 boxes (16 mixes, 19 transactions), was cut by a lock at 3 of 19 sent (21:08:22 UTC), then unlocked 20 s later:
- **Just after the unlock:** three of its transactions were still in flight. Mix my boxes again was off, and the page said the boxes were being mixed again: the note and the button agreed.
- **42 s later:** those had landed, and it came on with no reload. On 1.9.2 it stayed off until the session's return went, after the unlock's draw.
- **The pool page** said 3 of the 4 boxes weren't mixed yet, and the chain's row why it stopped. Mix my boxes again's review took all 4.
- **A new Mix my boxes again** (funding `c4596316`) ran its 19 transactions to the end beside the cut session.
- **The cut session's rest** came back about 12.5 minutes after the unlock, as a chain of its own through its collateral's mix (3 transactions), never as another mix of the boxes (r4#1).
- **While that rest ran,** Mix my boxes again stayed on, with no note (r4#2).

The fresh wallet contacted preprod.koios.rest and www.giveme.my. Seen, not fixed: the hub's card said the cut chain "Stopped after 4 of 19 transactions", and its row "Stopped after 3 of 19". The two count the transaction whose send began at the lock differently, as 1.9.2's views did.

## For the owner

- **The policy's date:** the 20 November entry and the Effective line say 20 November 2026, the day #396 merged; this branch rewords that entry. If it merges on a later day, move both to the merge day in its last commit (one entry, never two).
- **After the merge:** package on `main` (part 2 of [development.md's release steps](../../development.md#releasing-to-the-web-store)), upload, tag `web-wallet/1.9.3` on the merge commit, and the record PR (release-records.md and releases.md). No API deploy: the data layer and the token decimals didn't change.
- **The calls:** the stranger's pile (backlog ❓), and the "being mixed again" note you didn't see (unexplained by the code).

## Lessons

- **A timing pin asserts its time.** Chunk 52's printed its times, so r1#2's shape, 135 s in the WebAssembly, passed every check (r1#3).
- **Fixes still break where two meet:** F1 came from r3#4 meeting r3#1, F2 from r1#1 meeting r2#1. The last look found both, after each fix group's own checks had passed.
- **Random sweeps miss the edges.** The differential over 7,120 random picks found no refusal; the refusals were shapes built at an output's limits (20 kinds of token to an output, 16 KiB to a transaction).

## The IDs

r1# to r4#: round one's four reviewers, R1 to R4 above. F#: the last look.
