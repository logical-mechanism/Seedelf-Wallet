# 1.8.0's review of its fixes, round two: the retire lane's fixes

Lane **retire**: r2-critic#0; the comments of r2-worker#3, r2-critic#2 and r2-critic#1; the two pins of what the comments say.

- **Branch:** `review-1.8.0/fix2-retire`, head `956711469c2a47656a1cab0235ecd197f94c2901`, three commits on `4b4628e9`:
  - `77f60757` fix(web-wallet): the boxes the first unlock's retired run hadn't taken are read at the next run after it stops (r2-critic#0)
  - `82501e9c` docs(web-wallet): the look's comments say when it runs, for which pool, and that its five minutes are a worker's (r2-worker#3, r2-critic#1, r2-critic#2)
  - `95671146` test(web-wallet): a read a Stop on 1.7 owed later comes at once after the first unlock's run stops too (r2-critic#0)
- **Worktree:** `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/fix/retire`. Every command below runs from its `seedelf-platform/seedelf-web-wallet/extension`.
- **Files changed:**
  - `src/background/lovejoin.ts`: `retireOnce`, `withdrawDueNow`'s recheck read (the fix names it) and the comment on its trigger, `stopBringingAllBack`, `bringNoted`'s stop (the run's own stop); the doc comments of `LovejoinDeps.lookSoon`, `adaPool` and `bringAllBack`. Nothing else; `adaPool`'s code, `room()`, `rooms()` and `collateralPool()` untouched.
  - `src/background/lovejoin-pools.ts`: the header's two bullets (the data layer's, Koios's), `lookSoon`'s, `refresh`'s and `scan`'s docs. Comments only.
  - `src/background/sw.ts`: the comment by `PoolDiscovery`'s construction (`serviceDeps`' `lookSoon`). Comment only.
  - The new `tests/lovejoin-round2-retire.test.ts`: 9 tests.
- **No i18n key, screen, schema, storage shape or migration changed.**

**How each check ran.** Scripts in `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/fix2-retire-scripts/`, logs in `…/scratchpad/fix2-retire-logs/`:
- *At the base:* first the test file at the worktree before any source edit (`base.log`); then the final file with `src/background/lovejoin.ts` from `4b4628e9` swapped in and restored, sha256 checked (`base-final.log`). The other two files' changes are comments.
- *Fixed:* `npx vitest run tests/lovejoin-round2-retire.test.ts --maxWorkers=2`, and the same with `VITE_ENABLE_MAINNET=false`.
- *Revert checks:* `python3 -I revert.py src/background/lovejoin.ts <piece>` reverts one piece of the fix by exact strings (`stop`, `own-stop`, `norearm`, `released`, `nullish`); the file is run; `… restore` puts it back, sha256 checked (`final.sha`). The comment pins' mutants the same with `mutate.py` (`kept`, `look` in lovejoin.ts; `scanned` in lovejoin-pools.ts).

## r2-critic#0: fixed

The trace's **A+**, as prototyped (`scratchpad/r2/r2-critic/trace0-proto.py`).

**What changed** (`lovejoin.ts`):
- `stopBringingAllBack` (`:6944`) and `bringNoted`'s stop (`:7203`): `s.recheck = Math.min(s.recheck ?? Infinity, now + SPENT_KEEP_MS)`. A Stop, Settings' or the run's own, never puts a read owed sooner later.
- `withdrawDueNow`'s recheck read (`:6594–6599`): re-arms at `now + SPENT_KEEP_MS` instead of deleting while a box a withdraw of Bring every box back went for (`counted`) is still listed and held as spent (`listed` less `owned`, named `unspentByUs`/`unconfirmed` as `bringAllBackNow` names them). Deleted, a dropped withdraw's box had no due time and nothing read the pools again.
- `retireOnce` (`:4235–4240`, `:4258`): tracks `released` for a Bootstrap entry it lets go that wasn't released before, and `if (counted || released) s.recheck = Math.min(s.recheck ?? now, now)`. The read is owed at once for a 1.7 Bootstrap's boxes too, and a read a 1.7 Stop owed later comes at once with it.
- Comments: retireOnce's critic#3 comment, the recheck trigger's in withdrawDueNow (`:6562`), and each changed line's.

**Tests** (`describe("the first unlock's retired run stopped partway: …(r2-critic#0)")`; critic#3's `heldBy17`, the trace's `bootstrapBy17`, runs a minute apart until Home counts one box with its due time: `inLovejoinShown(held) && held.boxes === 1 && held.next !== null`):

| Pin | At the base | Fixed | Kills |
|---|---|---|---|
| 1. Settings' Stop after one withdraw: the box left shows from the next run | `expected 120 to be 1` | passes | `stop`: `expected 120 to be 1` |
| 2. The run's own stop after one withdraw (giveme.my 503 three runs) | `expected 120 to be 1` | passes | `own-stop`: `expected 120 to be 1` |
| 3. Stop once late, a node having dropped the last withdraw, nothing else left: its box still gets a due time once free, and comes back | passes (the trace's table: the base's Stop read at +2 h covers it) | passes | `norearm` (plain `Math.min`): `expected [ Array(1) ] to have a length of 2 but got 1` |
| 4. (new, `95671146`) A read a 1.7 Stop owed an hour on comes at once too | `expected 120 to be 1` | passes | `nullish` (critic#3's `??=` kept): `expected 60 to be 1` |
| 5. A 1.7 Bootstrap's boxes let go, Stop after one withdraw | `expected 120 to be 1` | passes | `stop`: `expected 120 to be 1`; `released`: `expected 120 to be 1` |
| 6. A 1.7 Bootstrap's, the run stopped by itself having sent nothing (Koios's credential_utxos 500 three runs): both come back by themselves within 12 h, an unlock among the runs | `expected [] to deeply equal [ …(2) ]` | passes | `released`: `expected [] to deeply equal [ …(2) ]` |

- At the base, before any source edit: `npx vitest run tests/lovejoin-round2-retire.test.ts --maxWorkers=2` → **4 failed | 4 passed (8)** (pins 1, 2, 5, 6; pin 4 wasn't written yet). The final file against `4b4628e9`'s lovejoin.ts: **5 failed | 4 passed (9)** (pins 1, 2, 4, 5, 6).
- Fixed, at the head: **9 passed (9)**, both builds.
- Revert checks at the head, each piece alone: `stop` 2 failed (1, 5), `own-stop` 1 failed (2), `norearm` 1 failed (3), `released` 2 failed (5, 6), `nullish` 1 failed (4).
- Pin 4 is mine, beyond the trace's five: `Math.min(s.recheck ?? now, now)` in retireOnce would be an untested guard without it.

**Requests:** see *Requests a flow makes*, below.

## r2-worker#3: fixed (comments)

**What changed:** `lookSoon`'s doc (`lovejoin-pools.ts:419–431`), `LovejoinDeps.lookSoon`'s (`lovejoin.ts:1590–1597`) and sw.ts's (`:234–238`) say the look also runs when Settings' Bring every box back is asked with no pool named, whatever is kept (`bringAllBack`). `bringAllBack`'s doc says "whatever is kept" too.

**Test:** pinned in r2-critic#1's preprod case below: with the 5 ₳ pool kept, Settings' press reads the holder once (`expect(holderReads(k)).toBe(before + 1)`) and finds the token pool. Under the `look` mutant it fails earlier, at the return's build.

## r2-critic#2: fixed (comments), pinned

**What changed:** every comment that says the look, or the data layer's list, comes at most every REFRESH_MS a network now says it holds while the worker runs, its throttle in memory:
- the look's: `lookSoon` (`lovejoin-pools.ts`, "`scanned` is in its memory, as `asked` is, so a worker Chrome started again looks at its first ask"), `LovejoinDeps.lookSoon`, `adaPool`, `bringAllBack` (`lovejoin.ts`), sw.ts's;
- the list's old ones: the header's data layer bullet (`lovejoin-pools.ts:32–34`) and `refresh`'s doc (`:447–454`).

**Test:** `describe("the look's five minutes are a worker's: …(r2-critic#2)")`: preprod, no v2 pool in the head start, nothing at the holder. A worker (a `PoolDiscovery` and a `LovejoinService` over the device's `local` and sealed store, as `getContext` makes them) asks twice a minute apart and reads the holder once; a new worker over the same storage asks a minute later and reads it again: 2 reads within REFRESH_MS.
- At the base and fixed: passes (it pins what the code does).
- Mutant `scanned` (one module-level map for every `PoolDiscovery`, a throttle kept across workers): **1 failed**, `expected 1 to be 2`.

## r2-critic#1: pinned (the lead's call: no code change); its comments corrected

**What changed:** `lookSoon`'s and `adaPool`'s docs say a **5 ₳** pool launched later is found without Lovejoin's page, not any pool: once one is kept no ask looks, so on Koios paths a token pool launched later is found as Lovejoin's page opens, at a pool's start, or at Settings' press. The header's Koios bullet (`lovejoin-pools.ts:43–49`) and `scan`'s doc (`:539–544`) say when Koios's holder is read: as the page opens and at a pool's start (`look`); at an ask that finds no 5 ₳ pool kept and at Settings' press (`lookSoon`), at most every REFRESH_MS while the worker runs.

**Tests:** `describe("with the 5 ₳ pool kept, an ask asks nobody: …(r2-critic#1)")`:
- *preprod* (the trace's `trace-c1-when-found` pin, trimmed): the 5 ₳ pool kept by a page look, the token pool launched at the holder, 40 strangers' LJTEST boxes, a site's session holding two boxes' worth, the clock moved REFRESH_MS + 1 on. The return's build reads no holder, its ADA goes to the 5 ₳ pool, and its token comes back directly. Then Settings' press reads the holder once and finds the token pool.
- *mainnet, the data layer up:* an ask finds the pool (one list ask); REFRESH_MS + 1 on, the next ask asks nobody, its list neither.
- At the base and fixed: both pass.
- Mutant `kept` (adaPool's `if (kept || !ask)` → `if (!ask)`): **1 failed**, the mainnet case, `expected 2 to be 1` (the list asked again).
- Mutant `look` (both short-circuits dropped, an ask that looks whatever is kept): **2 failed**, the preprod case `expected 2 to be 1` (a holder read at the return's build), and the mainnet case.

**The trace's preprod pin can't kill the `kept ||` mutant** (For the lead, 1): it passes under it. The trace reasoned it would, unmutated. With `kept ||` dropped, an ask goes on to `readSet(network)`, whose `pools` hands over every kept pool (the read set only grows), so `listed` returns before `lookSoon`. On preprod and with Koios-only that mutant asks nothing more; only the data layer's list, asked again past its five minutes, tells it. So the mainnet case is the one that kills it, and the preprod case kills the stronger `look` mutant and pins the comment's "never by a return".

## Requests a flow makes

The read r2-critic#0 moves is `ours()`, the pool read every pool read makes: discovery's list where the data layer answers (at most every REFRESH_MS while the worker runs), each pool's boxes (Koios's credential_utxos of each mix_box, or the data layer's), and tx_info for what made a box of the wallet's whose making Koios hasn't said yet. No new kind of request.
- **The first unlock's retired run stopped after sending at least one withdraw** (Settings' or a retired pool page's Stop, or the run's own stop after BRING_FAILED_RUNS runs that sent nothing), on a wallet whose first unlock dropped 1.7's not-mixed counts or let a 1.7 Bootstrap go in a retired pool: the read comes at the next run (the alarm's next minute while unlocked) instead of two hours after the stop. Then once more two hours later, only while one of that run's withdraws is still listed and held as spent at that read: at most one read more than before.
- **A first unlock that let a 1.7 Bootstrap go** (and no 1.7 counts): one read at the next run once the retired run is over or stopped. Before, none came: after a run that stopped having sent nothing, none at all until Lovejoin's page or Try again.
- **A 1.7 Stop's read still owed at the update** comes at the first unlock's run's end or stop, not at its own time.
- **Every other Stop:** unchanged, one read at the stop plus SPENT_KEEP_MS. Each withdraw a run sent was sent before its Stop, so nothing is held as spent by then and nothing re-arms.
- **The comments** (r2-worker#3, r2-critic#1, r2-critic#2): no request changes.
- What Koios learns: the box's own wait is drawn a minute after the Stop, not two hours on. It still comes back alone, at its own time.

## Awaiting blind back-translation

None: no key added or changed.

## For the lead

1. **The `kept ||` pin.** The trace's preprod pin doesn't kill the mutant FIX2BRIEF names: it passes under it (`fix2-retire-logs/final-mutant-kept.log`). That mutant is request-equivalent on preprod and Koios-only, as above. My mainnet data-layer case kills it. The preprod case kills the ask that looks whatever is kept. Both are in the file.
2. **`Schedule.recheck`'s doc** (`lovejoin.ts:977–982`, not my function) still says the read is Stop's, once. critic#3 already gave it a second writer. Suggested: "… And at once, the read retireOnce owes for the boxes the first unlock's run takes, which have no due time (critic#3; r2-critic#0). It reads again SPENT_KEEP_MS on while a box one of Bring every box back's withdraws went for is still listed and held as spent (withdrawDueNow)."
3. **The docs drafts** (the docs writer's) owe the same as the comments:
   - r2-critic#2's hedge: privacy-policy.md:46 and :93, privacy.md:202, architecture.md:740 and :748, development.md:331;
   - r2-critic#1's scope ("a 5 ₳ pool", and the page, a pool's start or Settings' press for a token pool on Koios paths): development.md:331, architecture.md:740, the archived chunk-44 plan's :67;
   - and the backlog line the trace asks for.

   *Requests a flow makes* above is written for the 6 November policy entry. The trace calls r2-critic#0's read "the same pool listings every wallet makes", so the policy needs no new request.
4. **The e2e lane's first-unlock test.** With this merged, a Stop of the retired run gives the boxes left their due times at the next alarm run. Home's In Lovejoin then shows them with their next time a minute after the Stop, never "not mixed yet". Settings still shows the stopped run, and Try again still starts the retired run, which takes them back to back. Nothing the e2e lane pins should change, but run its new test with my branch merged.
5. **Older and outside 1.8.0** (from r2-critic#2's trace, not touched): `PUBLIC_LOOK_MS`'s `looked` has the same in-memory gap. privacy.md:124, architecture.md:349, :351 and :748, and flows.md:128 say "at most every two minutes". It's a backlog item.
6. **Seen in passing** (r2-critic#0's trace, base and merged alike): with a 1.7 cut chain's record, Home keeps "A mix stopped partway: open Lovejoin to see what to do." after the box is back on its due time in a retired pool. Not this round's.
7. **Where lanes meet:** my hunks in lovejoin.ts are `retireOnce`, `withdrawDueNow`'s recheck, `stopBringingAllBack`, `bringNoted`, and three doc comments. None touches `room()`, `rooms()`, `collateralPool()` (sessions) or `adaPool`'s code. In lovejoin-pools.ts, comments only.

## Checks run

All from the worktree's `extension/`, `--maxWorkers=2`:
- `npx tsc --noEmit -p .`: exit 0, no output. Also at `77f60757`'s state alone (lovejoin.ts and the test file as that commit has them, swapped in and restored): exit 0, and its 5 pins pass.
- `tests/lovejoin-round2-retire.test.ts`: 9 passed, default and `VITE_ENABLE_MAINNET=false`.
- The 33 files the fix can reach: **658 passed, 2 skipped (660)** on the default build, and the same with `VITE_ENABLE_MAINNET=false`. They are home-review-fixes, lovejoin-1-5-0, lovejoin-bring-all-back, lovejoin-bring-review-fixes, lovejoin-bring-screen-review-fixes, lovejoin-crediting-review-fixes, lovejoin-discovery-review-fixes, lovejoin-discovery, lovejoin-due-times, lovejoin-flows, lovejoin-found-later, lovejoin-held-balance, lovejoin-merged-review, lovejoin-own-wait, lovejoin-planner, lovejoin-pools-head-start, lovejoin-pools, lovejoin-release-rules, lovejoin-restore, lovejoin-retire-review-fixes, lovejoin-retired, lovejoin-round2-retire, lovejoin-stopped-shown, lovejoin-withdraw-submit, lovejoin, public-mix-maybe, run-traps-review-fixes, runs, sessions-review-fixes, spent-clock-review-fixes, unlock-waits, withdraw-resend-unlock and worker. The 2 skipped are lovejoin-pools-head-start's writer and its live-Koios case, skipped by design.
- 16 more that call withdrawDue, held, Bring every box back or the look: **171 passed**, both builds. They are chain-record, chain-resend, data-layer, lovejoin-token-feed, pending-watch-busy, private-landing, pending-alarm, parts-send-review-fixes, public-mix-pump, resend-send-time, public-mix-race, withdraw-refused-locked, unlock-resend, handlers, lovejoin-merged-screens and unseen-send-time.
- The i18n and words files with the new file: `tests/i18n*.test.ts tests/words.test.ts tests/worker-words.test.ts tests/lovejoin-round2-retire.test.ts`, 11 files, **203 passed**, both builds.
- No formatter; no network; no build, Playwright or package step; nothing in the main tree but this report.
