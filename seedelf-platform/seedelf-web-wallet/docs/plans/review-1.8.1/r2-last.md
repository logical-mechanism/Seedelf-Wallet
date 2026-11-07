# 1.8.1's review of its merged fixes: r2-last

Reviewer `r2-last`. Lens: **the last look.** The lead's own merge edits, whether every round-one fix is still there and right on the merged tree, and, as the round's completeness critic, what a fix makes reachable that nobody exercised. The tree read is the main tree with the merged fixes uncommitted (`git diff HEAD`), on `2a8060d3`.

**In short:**

- **The merge lost nothing.** The staged tree is byte for byte a clean three-way merge of the six lanes' worktrees, and the lead's own edits are exactly the unstaged diff: the seven items R2BRIEF lists, in eight files.
- **The lead's seven edits each do what they say.** Edit 7 marks #71 merged in chunk 41's table, which GitHub confirms, but the same plan still calls #71 open in two other places (r2-last#2, nit; r2-docs#6 has one of them).
- **Every round-one finding marked fixed is present and right on the merged tree.** That's checked by the merge proof, the other round-two lenses' reverts, and my own mutants in R2.
- **One test gap where a fix meets code nobody changed** (r2-last#1, low). readers#4's match makes `withdrawOne`'s rebuild run on both networks for the first time. The rebuild passes on what the first build was given, and only `paid` and `due` are held by any test. Dropping `bring`, `bootstrap`, `holder` and `unlocked` from it passes 338 tests in 12 files.
- **Not repeated here:** the other round-two lenses' findings (r2-worker#1–#2, r2-tests#1, r2-screens#1–#3, r2-docs#1–#13). The two regressions from v-pv11-impact#2 (r2-worker#1, r2-worker#2 and r2-tests#1) are this round's real defects.

| id | severity | where | what |
|---|---|---|---|
| r2-last#1 | low | `EXT/src/background/lovejoin.ts:7719` | The rebuild after a refusal for a moved balance passes `bring`, `bootstrap`, `holder` and `unlocked` on, and no test holds any of them |
| r2-last#2 | nit | `WW/docs/plans/chunk-41-blaster-fixes.md:19–21` (and `:85`) | After the lead's edit 7, the plan still says #71 has changes requested, and lists it as open |

## How I worked

- **The merge:** `SCRATCH/review/r2-last/mergecheck.sh`. For every file a lane changed, it re-merged the lanes' worktree files onto HEAD with `git merge-file`, then compared the result with the main tree's index (`git show :path`).
- **Mutants and reverts in R2 only,** through `SCRATCH/review/r2-last/mutate.py`.
  - **R2 was shared.** Other reviewers had mutants in R2 while I worked: `koios.ts`, `Lovejoin.tsx`, and core's `mod.rs`.
  - So the runner waits until `git -C R2 diff` is empty, applies the mutant, and polls `git diff --name-only` every 0.5 s during the run. It restores with `git checkout`.
  - Every result below had no other edit in R2 during its run. The one exception is the T12c rerun, where another reviewer's `Lovejoin.tsx` mutant was in place. That file is a screen, and T12c drives the worker alone.
  - My first T12c run, without the watcher, had someone's `koios.ts` edit in place. I discarded it and ran it again.
  - `git -C R2 diff` printed nothing at the end, and no file of mine is left in R2.
- **Two repros in the main tree,** `EXT/tests/zz-r181-r2-last-1.test.ts` and `-2`, each run alone (`npx vitest run tests/zz-r181-r2-last-<n>.test.ts`), then copied into R2 for the mutant runs and deleted there. Both are deleted from the main tree too, and kept at `SCRATCH/review/r2-last/repros/`.
- **One network read:** `gh api` for PlutusCoreBlaster #71 and #73, and Lean-blaster #455 (public, read only).
- **Not run:** no build, no e2e, nothing in seedelf-data, nothing under `e2e/live`, no lake.

## Findings

### r2-last#1 · low · the rebuild after a refusal for a moved balance passes four options on that no test holds

**Where:** `EXT/src/background/lovejoin.ts:7719`, `withdrawOne`'s catch:

```ts
if (!again) return this.withdrawOne(network, read, box, { unlocked, due, bootstrap, holder, params: known, paid, bring, again: true });
```

**Where the features meet.**

- **This line is chunk 43's** (#367, in this release).
- **It never ran on either network before this round.**
  - At protocol version 11 the node says `ConwayIncompleteWithdrawals`, which the wallet didn't match, so no refusal was a `RewardsChangedError` (readers#4, critic).
  - readers#4's match makes it run now, for every way back in a pool whose `mix_logic` account moved between read and Send.
- **What the tests hold.**
  - mutants#7 named `paid` (T12d). The merged `it.each` holds it at PV10 and PV11, and so does the lead's T12c.
  - `due` is held by "is built again once, at once … and sent", whose due time must be used.
  - Nothing holds the other four.

**Evidence.**

- **The four dropped together** (`{ due, params: known, paid, again: true }`). All 12 files that drive a way back, a Bring every box back now, a Bootstrap's held box or a refusal pass: 338 of 338 tests. The files: `lovejoin-reward-balance`, `lovejoin-refusals`, `lovejoin-bring-all-back`, `lovejoin-bring-review-fixes`, `lovejoin-flows`, `lovejoin-retired`, `lovejoin-round2-retire`, `lovejoin-retire-review-fixes`, `lovejoin-merged-review`, `lovejoin-crediting-review-fixes`, `lovejoin` and `lovejoin-withdraw-submit`. No other edit was in R2 during the run.
- **`bring` alone dropped:**
  - `lovejoin-reward-balance`, `lovejoin-bring-all-back` and `lovejoin-bring-review-fixes` pass, 77 tests.
  - Repro 2 fails: `expected [] to deeply equal [ Array(1) ]`.
  - Repro 2 is lovejoin-reward-balance.test.ts's `due()`, then `bringAllBack`, then `withdrawDue` refused once at PV11 as the balance moves. It checks that the box sent again is counted back as Bring every box back's (Schedule `counted`).
- **On the merged tree,** repro 2 passes.

**The failure each would cause, should the line lose it.** The code passes all four today. This is a test gap on a path new to the networks.

- **`bootstrap` and `holder`:** take a Bootstrap's held box brought back by hand, refused once and sent again.
  - `dropWithdrawing` → `countBack(…, w.bootstrap === true, holder)` counts it against a mix instead of the Bootstrap that held it.
  - That closes another mix's entry early, and the Bootstrap still shows the box as held (316#0, R3-5).
- **`bring`:** take a Bring every box back now box, refused once and sent again.
  - Its box isn't marked `counted`.
  - A node dropping that withdraw would count the box back twice: "counted back once, never twice, which closed another mix early, or let a Bootstrap's held box go" (Schedule `counted`).
- **`unlocked`:** the rebuild would go out after a lock and an unlock during its own Koios and giveme.my calls (independent review L11's rule).

**Smallest fix, test first** (tests only):

- **Keep repro 2,** as an `it.each(NOT_IN_REWARDS)` in lovejoin-reward-balance.test.ts's "a box's way back and the pool's reward balance".
- **Add a Bootstrap's held box** brought back by `withdrawNow`, refused once. Expect its Bootstrap's count down by one, and no mix's entry closed.
- **Optionally,** a lock and unlock inside the rebuild, refused with `lj.lockedWhileBuilding`.
- Each fails on its option dropped from `:7719`.

### r2-last#2 · nit · chunk 41's plan still says #71 is open, after the lead's edit 7

**Where:** `WW/docs/plans/chunk-41-blaster-fixes.md:19–21`, and `:85`, which is r2-docs#6.

**The evidence.**

- **The lead's edit 7** made `:11` read "✅ PR #71 merged 2026-11-05 (`6b4260a`)", and `:269` says the same. GitHub agrees: merged 2026-11-05T11:22:34Z, merge commit `6b4260a980af…`.
- **Two parts of the live plan still say otherwise:**
  - `:19`, "**#71 (changes requested):** …";
  - `:21`, "**Open:** … asked whether they'd take #71 as a stopgap like #27. If not, close #71 and keep the alias on our fork."
- **`:85`** lists #71 as open (r2-docs#6).

**The failure.** The plan the owner monitors upstream from says both. "If not, close #71" is an action on a PR that merged.

**Fix** (docs, no test):

- `:19`: "#71 (merged 2026-11-05, `6b4260a`)".
- `:21`: keep only what's still open, the ByteString-as-ByteArray issue to follow.
- `:85`: r2-docs#6's line.

## The lead's own merge edits

| # | Edit | Checked |
|---|---|---|
| 1 | `lovejoin-reward-balance.test.ts`: the paid way back on `refusing(t, refusal, count, then)` at PV10 and PV11, and T12c | In R2: T12c's mutant (`withdrawOne` throws `e`, not `KoiosError(REWARDS_MOVED())`) fails both T12c cases ("Your staking rewards changed since you reviewed this…" received). T12d's mutant (the rebuild forgets `paid`) fails T12d at both versions, and T12c too. The older "refused again at %s…" checks no words (r2-tests says so too). |
| 2 | `lovejoin.test.ts`: `unknownTo` reads core's recorded `unknown_inputs.json` | Its 3110s are the spend redeemers on inputs it can't resolve, and its 3004 is the mint's, naming `a1…#0`: as the comment says. In R2, with v-pv11-impact#2's names reverted (`unknownInputs` returns `listed` alone), "builds the chain again from a fresh read…" fails (`expected [ …(40) ] to not include '5a5e0004…'`). So the edit made it a before/after test. "says to try again later…" and the runner's "brings a mix back directly when it's stopped" pass either way: they hold the retry's words. |
| 3 | `architecture.md:377` names `DepositIncorrectDELEG` and `RefundIncorrectDELEG` whole | It matches `koios.ts:717–737` name for name. "From 11" is right for the PV-gated pair, as for the two withdrawal names. 1.24's `AccountAlreadyRegistered` and the `NonZero` rename are ledger renames, worded as such. |
| 4 | `withdraw_zero.rs:8`: PV11's name | As the code matches it. |
| 5 | `CLAIMS.md:19` and `extract-lovejoin-v2.sh` name `wasm/tests/lovejoin_proven_bytes_test.rs` | The test holds `Lovejoin/Template/Scripts/{mix_logic,mix_box,one_shot_mint}.hex` and `Lovejoin/Scripts/reference_holder.hex`, by hash, to `unapplied_hashes_in(Set::V2)` and `REFERENCE_HOLDER_HASH`. Those are the files `Lovejoin/Template/Scripts.lean:23–25` and `Lovejoin/Scripts.lean:18` import. It derives P, L and M from seed `6db8a313…#3`. That's the retired pool's launch transaction (`dc6abe3b`'s reference is `6db8a313…#0`), and the head start gives `fcb3f5ec`'s reference as `b1720b86…#0`, its launch. CI's checkouts are whole, so the `include_str!` paths resolve. |
| 6 | `seedelf-platform/CLAUDE.md:86` names that test | Accurate ("its script files" are seedelf-verification's). |
| 7 | chunk 41's step 2 row: #71 merged | True on GitHub. The rest of the plan disagrees: r2-last#2. |

## Is each finding still fixed?

- **The merge:** for all 55 files the lanes changed, the main tree's index equals a fresh `git merge-file` of the lanes' files onto HEAD. That includes `lovejoin.ts` from three lanes and `lovejoin-reward-balance.test.ts` from two, with no conflict. So no hunk was dropped or altered in merging.
  - chunk 45's plan is deleted, and its archived copy added, as the verif lane did.
  - R2's files equal the main tree's merged files, and its `wasm/pkg` is byte-identical to the main tree's (`65b3edee…`).
- **refusals:** readers#4, worker#1, v-pv11-trace#1, v-pv11-impact#1 and #2 are present at `koios.ts:635–641`, `:714–737` and `:1248`; `lovejoin.ts:595–625` and `:5450–5456`; and `sessions.ts:5309–5321`.
  - The rethrow's `KoiosError(message, trouble, failure)` order is right, and `REWARDS_MOVED` is imported in sessions.ts.
  - T11b is now held: lovejoin-refusals' `record.chain.stopped` and `view.chain.stopped`.
- **balance:** readers#1 and worker#5 are present (`rpc.ts:2264`, `lovejoin.ts:919–926`, `:3856`, `:4930–4956`, `:5109–5130`, `Lovejoin.tsx:4011`, `:4051`, `:4118`), and the mutants#5–#8 tests.
- **guard:** guard#1, v-guard#1, guard#3 and mutants#9 are present (`lovejoin-pools.ts:358–365`, `:646`, `:665`; `lovejoin.ts:1652–1656`, `:4631–4639`; `dapp.ts:293–297`, `:2099`). Production passes `serviceDeps(discovery)` (`sw.ts:249`) and `lovejoin` to the connector (`sw.ts:273`).
- **rust:** core#1–#3, money#1–#2, mutants#1–#4, trust#1 and claims#2 are present. r2-tests ran the lane's 22 mutants and core#2's revert in R2, all caught.
- **verif and docs:** every listed change is present as its lane left it (the merge proof). The lead's capped run (`SCRATCH/lean/lovejoin-every-r1.log`) ends `76` ok.
  - It **built** `Lovejoin.Every.Readable` ("✔ [638/638] Built", after `Readable.lean` changed at 00:37:44), so fidelity#3's two guards held.
  - The Every README's "six of the 25 pass 8 GB" matches that log's peaks: Carrier 8459 MB, Collect 12782, Walk 8563, Withdraw 8379, MintCheck 8386 and MintRoot 8307.
- **Each lane's *For the lead* note:**
  - **Done by the lead's edits:** architecture.md:377, `withdraw_zero.rs`, `unknownBox`, the test merge, T12c, CLAUDE.md:86, CLAIMS.md:19, and chunk 41's row.
  - **Still the lead's:** the review record (chunk 43's record `:176` now points to it), the archive README's IDs table row for 1.8.1 (the code now cites "1.8.1's release review, <id>"), and guard#4's blind round (r2-screens#2). The verified-critical files have no 1.8.1 note yet.
  - **The owner's:** the CI filter (trust#1's note).

## What a fix makes reachable that nobody exercised

| Path, and the fix that opens it | Status |
|---|---|
| `withdrawOne`'s rebuild, paid by the private balance (readers#4) | **Ran it:** repro 1, PV10 and PV11. Built again once, the same private UTxO pays (`d2…#0`), giveme.my is asked twice, and it's sent. Refused twice, it says `REWARDS_MOVED()`. It holds. A mutant that keeps the first try's spent marks (no `forgetWithdraw`) is also caught by the account-paid and box-paid rebuild tests, so the repro adds no unique kill. |
| The rebuild's other options (readers#4) | r2-last#1. |
| tailWitness's `notCaughtUp` and crossCheck's named `avoid` (v-pv11-impact#2) | r2-worker#1, r2-worker#2 and r2-tests#1. |
| readers#4's words on non-Lovejoin script accounts | r2-screens#1 (Danogo). |
| Nothing else of the wallet's withdraws from a script | Core's `orders.rs` cancels carry no withdrawal. `staking.rs` stages only the account's own. Lovejoin's builders stage only `withdraw_zero`, and use `Staking` only for the launch's registration. |
| `everyKept` at a site's signature (guard#1) | It held. `verifiedPool` and `mixLogicOf` both go through wasm's `protocol_of`, so a kept pool that verifies can't throw in `mixLogicOf`: round one critic's per-pool catch isn't needed. `mixLogicOf` caches by pool id. A kept pool is launch-checked before discovery keeps it. |
| `taken` on the public reviews (readers#1) | It held. `takenOf` sums readsFor's takes from the transactions' own withdrawals, so an unread read is 0. `AfterRow` clamps at 0 and keeps `review-after-public`, as TotalRows did. The Bootstrap review takes nothing. No other screen renders a `LovejoinPublicSummary`. The e2e's public review after (`e2e/extension.spec.ts:3118`) is unchanged, since its fake answers no `account_info` row for a script's stake address. |
| A Bootstrap's skipped read (worker#5) | It held. Depth 0 is only a Bootstrap's or a seed's: Settings' depths are 1–3, `funding()` gives no collateral pool at depth 0, and sessions' `intoPool` excludes `depositOnly`. |

## Notes for the lead

- **R2 was shared, and mutated by several reviewers at once.** A runner that doesn't watch `git -C R2 diff` during its run can report a kill or a survivor that another reviewer's mutant caused. Mine watched (*How I worked*).
- **r2-last#1's repro** is at `SCRATCH/review/r2-last/repros/zz-r181-r2-last-2.test.ts`, ready to move into lovejoin-reward-balance.test.ts. Repro 1, the private-paid rebuild, is beside it, if wanted as a test.
