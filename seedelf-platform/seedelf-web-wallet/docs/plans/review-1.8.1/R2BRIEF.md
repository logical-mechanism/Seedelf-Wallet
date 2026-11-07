# 1.8.1's review of its merged fixes (round two): the brief

Round one's six fix lanes ([FIXBRIEF.md](FIXBRIEF.md), their reports in [fixes/](fixes/)) were merged by the lead into the main tree, uncommitted, on top of the prep `2a8060d3`: 59 files, +2,665/−420. `git -C ROOT diff HEAD` is the whole of it, and `git -C ROOT diff HEAD --stat` the list. The same tree, with `node_modules` and the rebuilt `wasm/pkg`, is the worktree `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-r181-r2` (R2), the merged diff staged there.

Every fix round here has introduced bugs where two features meet. Round two reads the merged fixes where the lanes meet, and the lead's own merge edits, which nobody has reviewed.

## Rules

[REVIEWBRIEF.md](REVIEWBRIEF.md)'s rules hold, with three changes:

- **The tree you read** is the main tree as it is now: the merged fixes.
- **Your report** is `WW/docs/plans/review-1.8.1/r2-<your id>.md`.
- **Reverts and mutants** go in R2 only. There you may edit anything to revert a fix or make a mutant: restore it (`git -C R2 checkout -- <file>` puts back the merged state, since it's staged) and leave R2 as you found it (`git -C R2 diff` prints nothing). R2's cargo target is its own (`R2/seedelf-platform/target`, built from nothing on first use: minutes). Never run `wasm/build.sh` or `npm run build` there; the copied `wasm/pkg` is the merged tree's.

## What was merged, by lane

- **refusals:** koios.ts's `WITHDRAWAL_REFUSED` (`WithdrawalsNotInRewards|IncompleteWithdrawals|WithdrawalsMissingAccounts`). In `stakingRefusal`, the rewards words, `WithdrawalsMissingAccounts` as `koios.staking.changed` (checked before `NotDelegatedToDRep`), and DELEG's PV11 and ledger-1.24 names. worker#1's rethrows (`lovejoin.ts` pumpPublicNow, `sessions.ts` pump) as `RewardsChangedError(REWARDS_MOVED(), trouble, failure)`. `unknownInputs` naming a stale answer's input from its 3004 reason (`MISSING_INPUT`). Tests: `koios.test.ts`, `staking.test.ts`, `lovejoin-planner.test.ts`, the new `lovejoin-refusals.test.ts`, and `lovejoin-reward-balance.test.ts`'s refusal bodies at PV10 and PV11.
- **balance:** a public mix's and Mix again's review count what the chain takes in *Public account after* (the summary's take; rpc.ts, lovejoin.ts, Lovejoin.tsx). A Bootstrap (depth 0) reads no reward account. Tests: `lovejoin-reward-balance.test.ts`'s new blocks (mutants#5–#8, worker#4) and `lovejoin-merged-screens.test.ts`.
- **guard:** `mixLogicHashes` is the classic pool plus every pool discovery keeps (`PoolDiscovery.everyKept` through serviceDeps), so the set no longer depends on where the wallet's boxes are. `DappDeps.lovejoin` is required. Tests: the new `dapp-lovejoin-rewards.test.ts`, `dapp.test.ts`, and the construction sites.
- **rust:** `Rewards::of` (the last entry for a hash wins, a 0 included). New tests in core (`lovejoin_pools_test.rs`, `lovejoin_test.rs`) and wasm (`lovejoin_test.rs`, `cip30_test.rs`, the new `lovejoin_proven_bytes_test.rs`, which holds `seedelf-verification`'s template hex to `Set::V2` and mainnet's v2 5 ₳ pool to them applied). Two doc comments.
- **verif:**
  - CLAIMS.md's *Where it stops*: the fork, the decoder and encodings, Z3's word for Seedelf's results.
  - README.md: the hypotheses, the standard command with `lovejoin-every`, Audit's scope, the Next line, the manual step after an extract run.
  - The AnyTx README, and a new `Lovejoin/Every/README.md` with chunk 45's method, pitfalls and tools.
  - check.sh: 51 prerequisites ahead of the 25, and 16 GB and 30 minutes for an Every module named alone.
  - Readable.lean's two guards on the base iffs. The lead's capped build of the family: 76 ok.
  - The tools' path regex, and Audit's findings reopened.
  - Chunk 42's and chunk 45's plans moved to the archive; chunk 41's upstream list.
- **docs:**
  - the privacy policy's body (Lovejoin's pools) and its 6 November entry's last clause;
  - architecture.md's diagram, cost line and refusal list;
  - privacy.md, `seedelf-platform/CLAUDE.md` and the wasm README;
  - chunk 43's archived record;
  - backlog.md (readers#1's line, the race, guard#10);
  - development.md part 1 (`release_version=1.8.1`, the zip's name).

## The lead's own merge edits (unreviewed)

1. `extension/tests/lovejoin-reward-balance.test.ts`:
   - the balance lane's paid way back takes the refusals lane's `refusing(t, refusal, count, then)`, run at PV10 and PV11 (`it.each(NOT_IN_REWARDS)`);
   - a new test, "paid by the public account and refused twice at %s, says so in Lovejoin's words" (T12c, which no lane covered).
2. `extension/tests/lovejoin.test.ts`: a module-level `unknownTo(outpoint)` reads seedelf-core's recorded `unknown_inputs.json`. `unknownBox` and the runner's "Koios's view of the pool stays behind" case answer with it, never the invented top-level 3117.
3. `docs/architecture.md:377`: `DepositIncorrectDELEG` and `RefundIncorrectDELEG` named whole, as the code matches them.
4. `seedelf-core/src/withdraw_zero.rs:8`: the PV11 name beside the PV10 one.
5. `seedelf-verification/CLAIMS.md:19` and `extract-lovejoin-v2.sh`: name `wasm/tests/lovejoin_proven_bytes_test.rs`.
6. `seedelf-platform/CLAUDE.md:86`: names that test.
7. `docs/plans/chunk-41-blaster-fixes.md`: step 2's row, #71 merged.

## Not fixed, on purpose

These are backlog lines, the owner's to order: worker#2, worker#3, readers#2 and readers#3 (the race for a balance between two of the wallet's own transactions in one pool), and guard#10. The *Lead's calls* in FIXBRIEF.md say why. A finding may say the merged code makes one of them worse.
