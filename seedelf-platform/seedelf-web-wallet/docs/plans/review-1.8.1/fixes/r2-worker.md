# 1.8.1's round-two fix-ups: worker

**Lane:** worker. **Worktree:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-r2fix-worker`, detached at `a619169f` (round one merged). Everything is uncommitted and unstaged, and nothing is staged. Paths below are under `EXT` (`seedelf-platform/seedelf-web-wallet/extension`) unless they say otherwise.

**In short:**

- **All seven findings are done, test first.**
  - The revert of v-pv11-impact#2 fixes r2-worker#1, r2-worker#2 and r2-tests#1.
  - r2-screens#1 is fixed.
  - r2-last#1 is closed by tests.
  - r2-tests#2 is closed by timeouts.
- **Every new test fails on the merged code, or on a mutant of the line it holds, and passes now.** Every mutant was put back and checked by its hash.
- **No user-visible string is new or changed.** One existing key, `koios.rejected`, now shows where staking's words did (below).
- **Runs:**
  - the nine touched test files in full: 402 of 402;
  - under four workers on two CPUs (21 files): 583 of 583;
  - `npm run typecheck`: clean.

| id | outcome | where |
|---|---|---|
| v-pv11-impact#2 | reverted to `2a8060d3` | `src/background/lovejoin.ts:595-615`; `tests/lovejoin-planner.test.ts` and `tests/lovejoin.test.ts` back to `2a8060d3`'s |
| r2-worker#1 | fixed by the revert | test `tests/lovejoin-planner.test.ts:1575` |
| r2-worker#2 | fixed by the revert | tests `tests/lovejoin-refusals.test.ts:222`, `:237` |
| r2-tests#1 | fixed by the revert | test `tests/lovejoin-refusals.test.ts:222` (the same scenario as r2-worker#2's public one) |
| r2-screens#1 | fixed | `src/background/koios.ts:627-634`, `:1248-1254` |
| r2-last#1 | test gap closed | `tests/lovejoin-reward-balance.test.ts:833-939` |
| r2-tests#2 | fixed | `tests/dapp-ties-accounts.test.ts:40-44`, `:190`; `tests/dapp.test.ts:41-45`, `:153`, `:1143` |

## Files

All modified (`M`); none is new, moved or deleted.

- `src/background/koios.ts`
- `src/background/lovejoin.ts`
- `tests/dapp-ties-accounts.test.ts`
- `tests/dapp.test.ts`
- `tests/direct-swaps.test.ts`
- `tests/koios.test.ts`
- `tests/lovejoin-planner.test.ts`
- `tests/lovejoin-refusals.test.ts`
- `tests/lovejoin-reward-balance.test.ts`
- `tests/lovejoin.test.ts`
- `tests/staking.test.ts`

**Scratch:** `SCRATCH/r2fix-worker/`. It holds:

- the mutant runner, `mutate.py`, with its specs (`r2last-mutants.json`, `final-mutants.json`) and each mutant's log (`mutant-*.log`);
- the merged code's runs (`revert-merged-*.log`);
- the load run (`load-files.txt`, `load-w4.json`) and the final full run (`final-full.log`);
- the whole diff, `r2-worker.diff`.

## The words

- **No key is added, and no value changes.** There's nothing new for the back-translation round.
- **`koios.rejected` now shows where a script's reward account's withdrawal is refused:**
  - a direct swap's retry line and its Send (Danogo's withdraw-zero);
  - a site's signing window's detail. The site still hears English `dapp.notSent`.
- **`koios.staking.rewardsChanged` and `koios.staking.changed` no longer show there.** They still show for the public account's own account, a key's: Withdraw, Stop staking, and a payment that spends rewards.
- **Lovejoin's own words are unchanged.** It still words the refusal by its type: `lj.warn.rewardsMoved`.
- **The worker stays English.** It compares only the node's own text (`KeyHashObj`), never translated words.

## The revert (v-pv11-impact#2): r2-worker#1, r2-worker#2, r2-tests#1

**What changed:**

- **`src/background/lovejoin.ts:595-615`:** `MISSING_INPUT` is gone, and `unknownInputs` is `2a8060d3`'s again: it names only a 3117's `unknownOutputReferences`.
  - **Its doc gains one sentence** (`:598-601`). Ogmios names an evaluation's unknown input only in a 3004's reason, which isn't read: read, it reached tailWitness, unstale and Mix again together.
  - That sentence is the only text here that isn't `2a8060d3`'s. Drop it if you want the function exact.
- **`tests/lovejoin-planner.test.ts`:** restored with `git show 2a8060d3:<path> > <path>`, then r2-worker#1's test added. `git diff 2a8060d3` shows that test alone.
  - Its two "asks again" cases (`:1547`, `:1596`) answer the invented 3117 again.
  - `unknownTo` is gone.
- **`tests/lovejoin.test.ts`:** byte for byte `2a8060d3`'s. `unknownBox` and the runner's case (`:2251`) answer the invented 3117, and `unknownTo` is gone.
- **`tests/lovejoin-refusals.test.ts`** (round one's file, not in the brief's list):
  - **Its first test of `unknownInputs` was v-pv11-impact#2's own,** and fails on the revert. At `:156` it now holds the reverted rule: Ogmios's recorded answer is stale and names nothing the wallet reads, and a 3117's list is named.
  - **The header** (`:4-7`) says why.
  - **The second test,** that a reason alone never makes an answer stale, is unchanged and passes either way.
  - **A new describe** (`:184`) holds the two Mix again repros. Their setups are copied in: `cutAfterDeposit` from lovejoin-reward-balance.test.ts, and ZZR2W3's.

**The merged `lovejoin.ts` was swapped in for one run, then put back and checked by sha256.** Each new test failed on it:

- **`tests/lovejoin-refusals.test.ts:156`**, "are none the wallet reads in Ogmios's own answer, stale all the same: its 3004's reason is never read".
  - Failed with `expected [ "a1…#0" ] to deeply equal []`.
- **`:222`**, "from the public account, is told to try again in a minute, never that the account has no box there". This is r2-tests#1's repro, and r2-worker#2's ZZR2W2, which is the same scenario.
  - Failed with "None of your boxes in Lovejoin's pool came from a mix from your public account."
  - Now it's `lj.poolDrifted`, after three tries.
- **`:237`**, "from the private balance, is tried again later, and its mix never given up" (r2-worker#2's ZZR2W3).
  - Failed: `mix.skipped` was "none of your boxes is in Lovejoin's pool anymore".
  - Now:
    - nothing is skipped;
    - the retry is in `lj.poolDrifted`'s words;
    - nothing is sent but the funding, after three tries.
- **`tests/lovejoin-planner.test.ts:1575`**, "stops at its mix, as it did, when Ogmios's own answer says it doesn't know the box, which another wallet's mix may have drawn" (r2-worker#1).
  - Failed with `expected undefined to be "Lovejoin's pool changed while the wallet read it."`: the chain waited, taken as behind.
  - Now it stops at the first ask, and giveme.my is never asked.
  - **Beyond the brief's two repros:** it's the first path the lead's call names. It's one runner pass, not r2-worker's day-long loop.

**The restored cases pass, as at `2a8060d3`:** the planner's two "asks again" cases (3 of 3 by name, with the new test), and lovejoin.test.ts's network check and runner case (8 of 8 by name). Both files pass in full too.

**A note on the public test:** each try draws the account's boxes afresh. Which box Ogmios names changes from run to run, so the test holds the words and the three tries, not the box.

## r2-screens#1 · fixed

**What changed, in `src/background/koios.ts`:**

- **`:1248-1254`:** a withdrawal refused (`WITHDRAWAL_REFUSED`) whose answer names no `KeyHashObj` is a `RewardsChangedError` in the network's own words (`koios.rejected`, as any other refusal). A key's account keeps staking's words.
- **`:627-634`:** `RewardsChangedError`'s comment says so.

**Why `KeyHashObj`:** every real refusal names the account's credential.

- **To protocol version 10,** CERTS (cardano-ledger-conway 1.17's `Rules/Certs.hs`) raises `WithdrawalsNotInRewardsCERTS (Map (RewardAccount …) Coin)`.
  - It lists the failing withdrawals only: Shelley's `validateZeroRewards` keeps, by `Map.differenceWith`, those not of the whole balance or of no account.
  - It shows each as `RewardAccount {raNetwork = …, raCredential = KeyHashObj (…)}`, or `ScriptHashObj (…)`.
- **From 11,** LEDGER names `AccountAddress {… unAccountId = KeyHashObj (…)}`, or `ScriptHashObj (…)`.

**The check reads the whole answer.** A refusal that names a key's account anywhere keeps staking's words.

- So a script's withdrawal refused beside another failure that names a key's address (an output too small, say) would get them.
- In the wallet's own transactions that takes a second failure beside the script's. Lovejoin words the refusal by type anyway, so only a direct swap's line or a site's window could show it.

**Tests, each failing before the fix:**

- **`tests/koios.test.ts:379`** (protocol version 10): a script's account gets the network's words, with the type.
  - Failed with "Your staking rewards changed since you reviewed this. Review it again."
- **`:402`** (protocol version 11): `ConwayIncompleteWithdrawals` and `ConwayWithdrawalsMissingAccounts` for Lovejoin's `mix_logic`. The same failure.
- **`tests/direct-swaps.test.ts:657`**, "says a refusal for a Danogo script's reward account in the network's words, never staking's". This is r2-screens's repro 2 as a test.
  - Failed: the runner's retry was "Your staking rewards changed since you reviewed this. Review it again."
  - Now it's the network's words, and the swap's page never says "staking rewards" or "review it again".
- **Lovejoin still holds `REWARDS_MOVED()`:** lovejoin-refusals ×4 and every refusal case of lovejoin-reward-balance, at both versions, pass unchanged.

**Two test bodies changed with the rule:**

- **What was wrong with them:** koios.test.ts's PV10 test (`:381-384`) and `tests/staking.test.ts:777` used bare names, which name no account. No real refusal does.
- **What the rule did to them:** a body that names no account gets the network's words now. staking.test.ts failed with "The network rejected the transaction: {…"WithdrawalsNotInRewardsCERTS"…}".
- **Now:** both carry PV10's real shape, the key's account named.

**Mutants of the fix:**

- **The check dropped:** 3 tests fail (koios.test.ts ×2, direct-swaps ×1).
- **A script's refusal thrown as a plain `KoiosError`:** 22 tests fail.
  - koios.test.ts ×2;
  - lovejoin-refusals ×4;
  - lovejoin-reward-balance ×16: every refusal case at both versions, the new r2-last#1 ones included.

## r2-last#1 · test gap closed

**What changed:** tests only, in `tests/lovejoin-reward-balance.test.ts:833-939`.

- **The describe** is "a way back built again after a refusal for a moved balance, as its first build was asked".
- **Each test is an `it.each(NOT_IN_REWARDS)`,** so it runs at protocol version 10 and 11. They start from r2-last's repros.
- **`bring`** (`:840`, r2-last's repro 2): Bring every box back now's box, refused once as the balance moved and sent again, is counted back as Bring every box back's (Schedule `counted`).
- **`unlocked`** (`:852`): the wallet locks and is unlocked again while giveme.my answers for the rebuild.
  - Nothing is sent: `lj.lockedWhileBuilding`, which withdrawDue swallows.
  - There's one submit, nothing kept as withdrawing, and the due time is back.
  - giveme.my was asked twice, so the rebuild ran.
- **`bootstrap` and `holder`** (`:925`, with the setup `bootstraps()` at `:882`): crediting-review-fixes' 316#0 setup, in the 5 ₳ pool.
  - The setup: a mix of the public account's with its box out, then two Bootstraps. B2's second box was moved by someone else's mix.
  - That box is brought back by hand (`withdrawNow`), refused once, and sent again.
  - Afterwards B2's count is down by one, B1 still holds both its boxes, and the public mix still has its box out.

**Mutants of the rebuild line, `src/background/lovejoin.ts:7709`.** Run against the describe, each fails its own test at both versions and none of the others:

- **`bring` dropped:** `expected [] to deeply equal [ Array(1) ]`. The box isn't counted.
- **`unlocked` dropped:** the rebuild is sent across the lock (`expected [ { kind: 'lovejoin-withdraw', … } ] to deeply equal []`).
- **`bootstrap` dropped, or `bootstrap` and `holder`:** the public account's mix's entry is closed early, and B2 is never counted.
- **`holder` dropped:** B1 is counted (`back: 1`), not B2.

## r2-tests#2 · fixed

**What changed:** `const SLOW = { timeout: 30_000 }`, each with a line saying why, as `dapp-account-change.test.ts` has it, on:

- `tests/dapp-ties-accounts.test.ts:190`'s describe, holding `:191` (was `:186`);
- `tests/dapp.test.ts:153`'s describe, holding `:808` (was `:803`);
- `tests/dapp.test.ts:1143`'s describe, holding `:1409` (was `:1404`).

**Checked under load:** r2-tests's 20 files and direct-swaps.test.ts, run with `taskset -c 0,1 npx vitest run … --maxWorkers=4`.

- 583 of 583 passed, in 456 s.
- The three tests took 4.31 s, 3.98 s and 4.09 s: within a second of the old 5 s default, a seventh of the new limit.
- **The new tests under that load:**
  - the private Mix again took 7.31 s, under `CHAINS`' 60 s;
  - the planner's tail test took 6.92 s, under its `SLOW`'s 180 s;
  - the direct swap took 0.89 s, at the file's 5 s default.

**Mutant:** with `SLOW` at 150 ms, all three time out ("Test timed out in 150ms"). So the describes' option is what governs them.

## Runs

- **Baseline, before any edit:** koios, staking, direct-swaps and lovejoin-refusals, 107 of 107.
- **The nine touched test files in full, on the final state:** 402 of 402.
- **The load run,** above: 583 of 583.
- **`npm run typecheck`:** clean.
- **Not run, by the rules:** no build, no e2e, no `e2e/live`, no network but two cardano-ledger source files read on GitHub.

## Not done

Nothing of this lane is left.

**One variant of the rule no test tells apart:** "staking's words unless a script's account is named". It differs only for an answer that names no account at all, and no real refusal does.

## For the lead

1. **For the docs lane, `docs/architecture.md:377`.** It says a withdrawal refused by any of its three names is a `RewardsChangedError` in `stakingRefusal`'s words. That holds for a key's account now: a script's (a Danogo pool's, Lovejoin's `mix_logic`) is the network's own words, of the same type (r2-screens#1). A clause there would make it exact.
   - chunk 43's archived record (`:45`, "staking's words still") records what chunk 43 did. Yours to leave.
2. **The backlog line for the revert** is the docs lane's. The code's own pointer is `lovejoin.ts:598-601`; drop it if `unknownInputs` should be `2a8060d3`'s byte for byte.
3. **`tests/lovejoin-refusals.test.ts` isn't in the brief's list.** Its first `unknownInputs` test was v-pv11-impact#2's and fails on the revert, so it holds the reverted rule now. The revert's Mix again tests live there too, beside the recorded answer they use.
4. **`tests/staking.test.ts:777` and koios.test.ts's PV10 test** changed their bodies from bare names to PV10's real shape. The new rule needs a named account, and real refusals always name one.
5. **`NOT_IN_REWARDS`'s PV10 body names no account.** It's `Withdrawals {unWithdrawals = fromList []}` in lovejoin-reward-balance.test.ts, which isn't PV10's real shape.
   - It now gets the network's words, and Lovejoin words it by type, so its tests hold unchanged.
   - Making it real (the `mix_logic` script's `RewardAccount`) is optional; I left it as round one's.
6. **The e2e:** no spec names a withdrawal refusal (grep over `e2e/`), so none needs changing.
7. **For your own load runs:** the session's shell is zsh. A file list in an unquoted variable reaches vitest as one argument, and vitest then runs nothing yet still writes its JSON report, with zero tests. I ran the list under `bash -c`.
