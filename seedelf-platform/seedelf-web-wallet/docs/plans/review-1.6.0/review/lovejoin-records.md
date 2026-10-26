# Review of the fixes: Lovejoin records and compatibility (`lovejoin-records`)

Lens: the records and bookkeeping the fix rounds added or changed (wlj-1 `countBack`/`holderOf`/`depositors`/`holder`; wlj-2 `landed`/`landedBy`/`mayLand`/`bringSays`/`waiting`/`late`; wlj-3 `TailWait`/`chainSoFar`/`chain.from`; wlj-4 `LaunchRecord.box`/`reviewed`/`startedBefore`; w-left `counted`/`recheck`; bootstrap `mix.noCollateral`). I also checked whether old vaults still read and finish, whether the new records are pruned and kept correctly, and whether countBack, counted and landed double count. And I checked the 1.5.0 gate's two new cases.

Three findings: two low, one nit. Old records read and finish: I found nothing a 1.5.0 vault or an earlier 1.6.0 vault breaks on.

## Findings

### F1 (low): after a dropped withdraw of Bring every box back now and a Stop, a Bootstrap never closes and holds another of the wallet's boxes for good

- **File:** `WW/extension/src/background/lovejoin.ts:6812` (dropWithdrawing's `counted` skip), with `:2258` (bootstrapOf's order) and `:2149` (countBack's path for a box no Bootstrap holds).
- **Concerns:** two fixes meet here:
  - w-left: wlj-2's notes (a), the `counted` skip, and (b), Stop's `recheck`;
  - wlj-1: 316#0, bootstrapOf's hold by count, and countBack crediting a Bootstrap's deposit box only once that Bootstrap is released.
- **Scenario:**
  1. A held Bootstrap B1 has three boxes at its deposit (b1#0, b1#1, b1#2).
  2. Bring every box back now sends the withdraw of b1#0. It's counted back against B1 at the send and recorded in `counted`.
  3. The run stops before it takes the other two: the user presses Stop, or the run stops itself after three runs that sent nothing.
  4. A node drops that withdraw. b1#0 stays in the pool, held as spent for 2 h, then free.
  5. Stop's recheck reads the pools. bootstrapOf holds by count: B1 has 2 out, so it holds the first two deposit boxes listed, b1#0 and b1#1. b1#2 is left free, and scheduleFound gives it a due time.
  6. b1#2 comes back by itself. countBack's path for a box no Bootstrap holds credits it to nobody, since it credits a deposit box only to a released Bootstrap.
  7. The user brings b1#0 and b1#1 back by hand. b1#0 is in `counted`, so its countBack is skipped.
  8. Now all three boxes have left the pool, but B1's entry says 2 of 3 back.
  - squareUp heals this only when the pool lists none of the wallet's other boxes.
  - When the pool lists a box of the wallet's that no record accounts for (one someone else's mix moved, which is common in a busy pool), squareUp finds the counts balanced. bootstrapOf then holds that box in B1's place: no due time, never back by itself, and Home counts it as a Bootstrap's held box.
  - Bringing it back by hand clears it.
- **Evidence:**
  - Throwaway test `zz-review-lovejoin-records-1.test.ts`, run in the tree and then deleted.
    - Setup: B1 with 3 boxes in PR #163's token pool. Bring every box back now runs out of time after the first withdraw, then Stop. b1#0's spent mark lapses and the recheck read runs. Runs follow until b1#2 is back. A box f9 appears in the pool, made by someone else's mix. B1's held boxes are then brought back by hand.
    - It fails on the tree: `AssertionError: expected [ [ …(2) ] ] to deeply equal []`, received `["b1…", [{ back: 2, boxes: 3, pool: TOKEN }]]`.
  - The exploratory run's log:
    - after the recheck read: held `[b1#0, b1#1]`, and one due time;
    - came back by itself: `b1#2`; the entry still `back: 1`;
    - after the by-hand returns: `back: 2`;
    - then: held `[f9#0]` with `due []`, and f9 not withdrawn in 8 runs over 24 h;
    - `held().pools[0].bootstrap === 1`.
  - With the `counted` skip disabled, the same test passes: B1 closes, and f9 comes back by itself. Before w-left, b1#0's second credit made up for the substitution. The skip removed that, and with it the fix that made the counts come right.
- **Suggested fix:**
  - bootstrapOf holds a deposit box that's in `counted` last: `mine.filter(at a deposit).sort(counted last)`.
  - Then the dropped withdraw's own box is the one that comes back (by itself after Stop, counted once), and the Bootstrap keeps holding its other boxes. No refusal is added.
  - Checked in a copy: the throwaway test passes. `lovejoin-crediting-review-fixes`, `lovejoin-bring-review-fixes`, `lovejoin-bring-all-back`, `lovejoin-pools` and `lovejoin-release-rules` still pass (89 tests).

### F2 (low): the 1.5.0 gate's head-start case compares no Koios requests

- **File:** `WW/extension/tests/lovejoin-1-5-0.test.ts:696` (`classicAfter` deletes `step.calls`, and `restored.calls` at :699).
- **Concerns:** wlj-4 x-compat#2, the new gate cases.
- **Scenario:** a change that makes the wallet ask Koios something more, such as a request naming the wallet's own boxes, and does so only when a token pool is in the read set. All four gate cases still pass.
  - The two original cases read the classic pool alone.
  - The head-start case deletes every request.
  - The test's name claims sends, schedules and the restore, and those are compared. But no case guards what a 1.5.0 vault asks with pools shown, and every preprod wallet has pools shown.
- **Evidence:**
  - I probed the head-start cases in a copy with the strips taken out. Differences from 1.5.0's record:
    - **plans:** only `funding[].collateralReserve`/`collateralPool` (36 each), `swap.quote.{ways, values, fund, ifStopped.*}` and `swap.review.ways`. So `classicPlans` is tight: it strips nothing else that differs.
    - **after the update:** only `calls`, and `status.pools`:
      - each `credential_utxos` names the two head-start mix boxes;
      - the status read and the restore make one `epoch_params` call more;
      - the return makes one pool read more.
    - Every `tx_status`, `tx_info` and `submittx` matched 1.5.0's exactly.
  - Mutation in the copy: `ours()` sends a `utxo_info` naming every one of the wallet's boxes whenever a non-classic pool is read.
    - `npx vitest run tests/lovejoin-1-5-0.test.ts` gave 4 of 4 passed.
    - The probe showed 12 such requests in the head-start replay.
- **Suggested fix:** in `classicAfter`, normalize the requests rather than delete them:
  - drop the two head-start mix-box credentials from each `credential_utxos`;
  - drop `epoch_params`, and the return's extra read of the pools alone;
  - compare what's left with 1.5.0's exactly, step by step. Today that's every `tx_status`, `tx_info`, `utxo_info`, `submittx` and read of the wallet's own credentials, and it matches.

### F3 (nit): recordLaunch's comment says launches are never read by a rule

- **File:** `WW/extension/src/background/lovejoin.ts:5704`
- **Concerns:** wlj-4 318-worker#1.
- **Scenario:** since 318-worker#1, `launches` is read by `startedBefore` (the start review's warning) and by `submit()`, whose `reviewed` check throws `worker.spend.sentAlready`. The comment still says "for the hub, never read by a rule".
- **Suggested fix:** say it feeds the hub, the start review's same-values warning and Send's sent-already check.

## Compatibility: what I checked, with no finding

- **A vault written by 1.5.0** (`tests/fixtures/lovejoin-1.5.0.json`): the gate passes 4 of 4 on the tree. In its vault:
  - The public mix ended 36 min before the update, and the return's chain is cut, never `done`. So `mayLand`/`landedBy` never take effect, and no `landed` is written.
  - Neither chain writes `depositors`: one has mixes, the other a session.
  - `counted` is written by Bring every box back now's withdraws alone, and `recheck` by Stop alone, so the sealed schedule stays 1.5.0's step for step.
  - One known change the gate can't show: a 1.5.0 vault updated within 15 min of a chain all sent holds a box's own run until a read lists the chain's last box. That's wlj-2's owner's call 4, timing only, never different transaction bytes.
- **Fields absent from older 1.6.0 records:**
  - `Withdrawing.holder`: countBack credits by where the box sat, then by age.
  - `Withdrawing.bring`: no `counted` entry.
  - `ChainRecord.landed`: `mayLand` holds for at most 15 min after `ended`.
  - `Bringing.waiting`/`late`: a code a later build wrote is filtered out by `BRING_WAITS`.
  - `SessionRecord.chain.from`: `chainSoFar` behaves as before.
  - `mix.noCollateral`: a Bootstrap funded with its 5 ₳ (before 62162483) finds and puts it up. One funded with neither goes in with one box fewer.
  - `LaunchRecord.box`: `startedBefore` skips it.
  - `Schedule.depositors`/`counted`/`recheck`: `read()` validates each.
  - `MixEntry.found`, which bootstrapOf's moved-box hold now needs, was already written at 499768f6 (sortOut and landedDeposit).
- **Pruning and keep rules:**
  - `depositors` is written only for a public deposit-only chain whose record goes. It's refreshed while a read lists its deposit's boxes, and goes 3 h after (as `origins`).
  - `counted` goes once a read of its pool doesn't list its box. One written for a pool no longer read is kept.
  - `recheck` goes at the first read at or after it, and keeps the alarm going until then.
  - `launches` are never pruned (as before).
  - A tail's leaf is in `c.leaves` (recordChain), so the every-leaf rule can't mark a chain in before its collateral's mix lands.
- **Double counting:**
  - `landed` counts nothing.
  - squareUp can't credit what countBack already credited: a box credited but still listed only makes `extra` smaller.
  - `counted` stops a box's own withdraw from crediting twice (wlj-2's note a), but see F1.
  - The new entry for a chain with no box of its own (316#3) is made only when that chain has none, including when its own closed during the tail's wait (x-scenarios-lj#1).

## Questions (not made concrete)

1. **During a return's collateral-mix wait** (tailWaits), `mixing()` lets withdrawDueNow trim due times, which `chainsSending` used to stop.
   - Suppose a pool read in that window lags behind the chain and doesn't list its leaves. Then the trim drops their due times.
   - With no other due time left, nothing reads again until the next unlock or page read.
   - I didn't reproduce it: it needs a listing lag at the moment of a read during the wait.
2. **Records that may never go:**
   - `counted` entries for a pool no longer read (a dropped copy, a token pool no longer handed over) are kept for good (`!pools.includes(c.pool)`).
   - So is `recheck` on a network where Lovejoin isn't available.
   - Either way, `empty()` never lets the sealed schedule go. Harmless, but is that intended?
3. **`depositors` prune timing:** it ages out by `listedTxs` across whichever pools the read covered, as `origins` does. Suppose discovery hands over no token pool for 3 h (a worker restart while discovery is down). Then the tie for a public Bootstrap's boxes in that pool could be lost. I didn't check whether discovery's `pools()` falls back to its sealed list.
4. **A moved box after a dropped withdraw** (pre-existing): suppose a node drops a Bring withdraw and someone else's mix then moves the box. The new box comes back and is counted again (the first was counted at the send). `counted` can't follow it. Mixed boxes are interchangeable, so only a mix's card closes early.

## Checks run

- `npx vitest run tests/lovejoin-1-5-0.test.ts` on the tree: 4 passed.
- Probe of the head-start cases in a copy, with the strips taken out: the differences listed in F2.
- Mutation in the copy (a `utxo_info` naming the wallet's boxes whenever a token pool is read): the gate's 4 cases passed.
- F1's throwaway test:
  - fails on the tree;
  - passes in the copy with the suggested bootstrapOf order;
  - passes in the copy with dropWithdrawing's `counted` skip disabled, which is the behaviour before w-left.
- The suggested fix against the existing tests, in the copy: 5 files, 89 passed.
- Read for compatibility: `read()`, `update()`, `empty()`, `sortOut`, `bootstrapOf`, `holderOf`, `countBack`, `squareUp`, `dropWithdrawing`, `bringAllBackNow`, `withdrawDueNow`, `landedDeposit`, `tailChain`/`tailOf`/`tailLanded`, `recordChain`/`chainSent`, sessions.ts `chainSoFar`/`sendChain`/`buildBack`/`mixFunding`/`mixOutSubmit`, lovejoin-launch.ts `startedBefore`/`submit`.
- Cleanup:
  - the throwaway test is deleted from `WW/extension/tests/`;
  - the copy, scratch fixtures and probe outputs are deleted;
  - `git status` shows only other reviewers' untracked files.
