# tests-unit: #364's moved worker tests (1.8.0 release review)

Lens **tests-unit**, tree `a6c94743`. Sandbox: `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/wt/tests-unit`; every command below runs from its `seedelf-platform/seedelf-web-wallet/extension`. Eleven findings: two in the code (retireOnce, #0 and #6), eight tests or guards no test pins, one nit. No High or Medium.

## How the mutants ran

`/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/tests-unit-mutate.py` applies one exact-string patch to the sandbox's `src/` (it checks the old string occurs once), runs `npx vitest run tests/<files> --maxWorkers=2 --reporter=dot --bail=1`, and puts the file back from a copy. The 84 patches are in `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/tests-unit-mutants.json`, and every run's log is in `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/tests-unit-runs/`. Tier 1 ran each mutant against `lovejoin-retired.test.ts`. Each survivor then ran against the set that can reach its code:

- **RETIRED_SET**, 21 files: every test file that puts one of the wallet's boxes in a retired pool (checked by grep: no other file lists a classic or 8131b1d row with the wallet's datum), plus lovejoin.test.ts and the two discovery files: lovejoin-retired, lovejoin-1-5-0, lovejoin-restore, lovejoin-pools, lovejoin-bring-all-back, lovejoin-bring-review-fixes, lovejoin-bring-screen-review-fixes, lovejoin-release-rules, lovejoin-merged-review, lovejoin-public-cap-review-fixes, lovejoin-crediting-review-fixes, lovejoin-flows, lovejoin-stopped-shown, lovejoin-index, lovejoin-token-feed, private-landing, run-traps-review-fixes, wasm-review-fixes, lovejoin-discovery, lovejoin-discovery-review-fixes, lovejoin.
  - **RETIRED_LEAN**, the same less lovejoin.test.ts and the two discovery files (18 files), for code that only acts on a box in a retired pool.
- **TAIL_SET**, 29 files that build a return, a mix or a Bootstrap through the 5 ₳ pool: lovejoin-retired, lovejoin, lovejoin-planner, collateral-reserve-review-fixes, chain-reservations, chain-entry, chain-in-view, chain-lock, chain-record, chain-resend, chain-return-history, chain-requests, chain-stopped-copy, restore-scan-lovejoin, session-collateral, session-trap, sessions, sessions-review-fixes, submit-inputs-spent, dapp-chain-collateral, return-chain-scope, lovejoin-form-review-fixes, approvals-review-fixes, lovejoin-merged-review, swap-lovejoin-way, parts-send-review-fixes, collateral-held, lovejoin-stopped-before, lovejoin-flows.
  - **TAIL_MORE**, the rest that build one (9 files): i18n-worker-reasons, lovejoin-1-5-0, lovejoin-release-rules, lovejoin-restore, restore-scan, return-site-outs, session-stale-reservation, unlock-waits, worker-words.

Scratch tests (they can be removed with the sandbox; copies are kept at `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/tests-unit-scratch.test.ts.copy` and `…/tests-unit-scratch-traps.test.ts.copy`): `tests/tests-unit-scratch.test.ts` (probes A, B, C, E, F, F2) and `tests/tests-unit-scratch-traps.test.ts` (run-traps with the record past its first run). `npx tsc --noEmit -p .` passes on the tree (with the two scratch files moved aside).

## Findings

### tests-unit#0

- **title:** 1.8.0's first run keeps a 1.7 Bring every box back still going for one retired pool's page, so the other retired pools miss the right-away bring-back
- **severity:** low · **introduced:** new · **kind:** code · **proven:** test
- **where:** `src/background/lovejoin.ts:4095-4099` and `:4092` (retireOnce)
- **claim:** retireOnce marks the network `retired` for good, but asks the retired pools' run only where no run is going (`if (!s.bringing || s.bringing.stopped)`). A run 1.7 started from the classic pool's page (or an 8131b1d pool's) that is still going at the update keeps its `pool`. It brings that pool's boxes back alone. Every other retired pool's boxes wait their own 1–6 h draws, and retireOnce never runs again. The owner's call 3 ("at the first unlock on 1.8.0, Bring every box back runs for the retired pools") is lost for those boxes.
- **scenario:** a 1.7 wallet has a box in the classic pool and one in PR #163's 8131b1d token pool, both with due times. The user pressed Bring every box back on the classic pool's page, and it is still going when Chrome updates the extension. The first runs on 1.8.0 bring the classic box back. The token pool's box stays, due 204 minutes later, and comes back by itself then.
- **evidence:** scratch "A:", `npx vitest run tests/tests-unit-scratch.test.ts -t "A:" --maxWorkers=2`: after six runs a minute apart, giveme.my was asked for the classic box alone. The record reads `retired: 1800000000000`, `bringing: {"at":1799999940000,"back":1,"pool":"classic","left":0,"confirming":1}`, with the token pool's due time 204 min on. `expect(withdrawn(t)).toContain(<token box>)` fails. The test that kills the mutant overwriting a going run (lovejoin-bring-all-back's "waits while a chain of the wallet's is being sent") has Settings' every-pool run going, which covers the retired pools anyway; it says nothing of a one-pool run.
- **fix:** in retireOnce, widen a going run of one retired pool to the retired pools (`delete s.bringing.pool; s.bringing.retired = true`), the way every pool's run widens a pool's (bringAllBack). Pin it in lovejoin-retired.test.ts.

### tests-unit#1

- **title:** retireOnce's own guards, and what it does with a run that stopped, are pinned by no test
- **severity:** low · **introduced:** new · **kind:** test · **proven:** mutation
- **where:** `src/background/lovejoin.ts:4086-4099` (retireOnce); `tests/lovejoin-retired.test.ts:277-399`
- **claim:** four of retireOnce's rules survive every test that puts a box in a retired pool:
  - it lets go only of the Bootstraps in retired pools;
  - it runs for a collateral's mix left to build in a retired pool even when nothing else is there;
  - it asks afresh a run that gave up;
  - it drops 1.7's Stopped mark when it does.
- **scenario:** with each rule broken, nothing fails:
  - (a) a wallet whose first 1.8.0 runs found nothing retired Bootstraps v2's 5 ₳ pool (call 4's "Bootstrap fills it"). Later a box of its turns up in the classic pool (a 1.7 device's mix). retireOnce runs then, and under the mutant it lets the v2 Bootstrap go: its boxes come back by themselves.
  - (b) the only thing in a retired pool is a 1.7 session's collateral's mix left to build there. Under the mutant nothing runs, and that box waits up to a day (tailBoxes) before it can come back.
  - (c) 1.7's run gave up (`bringing.stopped`). Under the mutant it stays given up, and the retired pools never get a bring-back.
  - (d) under the mutant, 1.7's `bringStopped` stays beside the new run.
- **evidence:** each mutant against RETIRED_SET, `npx vitest run tests/{lovejoin-retired,lovejoin-1-5-0,lovejoin-restore,lovejoin-pools,lovejoin-bring-all-back,lovejoin-bring-review-fixes,lovejoin-bring-screen-review-fixes,lovejoin-release-rules,lovejoin-merged-review,lovejoin-public-cap-review-fixes,lovejoin-crediting-review-fixes,lovejoin-flows,lovejoin-stopped-shown,lovejoin-index,lovejoin-token-feed,private-landing,run-traps-review-fixes,wasm-review-fixes,lovejoin-discovery,lovejoin-discovery-review-fixes,lovejoin}.test.ts --maxWorkers=2`, each **21 files, 407 tests passed**:
  - (a) `:4093` `if (e.bootstrap && e.shares.some((x) => old(poolOf(x)))) e.released = true` → `if (e.bootstrap) e.released = true`
  - (b) `:4088` `if (!tails(before).length && ![...].some(…)) return` → `if (![...].some(…)) return`
  - (c) `:4096` `if (!s.bringing || s.bringing.stopped)` → `if (!s.bringing)`
  - (d) `:4098` `delete s.bringStopped;` removed

  The same set kills retireOnce overwriting a going run (lovejoin-bring-all-back) and ending a v2 pool's tail too (lovejoin.test.ts "withdraws nothing while a chain is being sent…").
- **fix:** add to lovejoin-retired.test.ts's "right away":
  - a v2 Bootstrap and a v2 collateral's tail present when retireOnce runs, which stay held and not over;
  - a tail alone in a retired pool, which ends and asks the run;
  - a 1.7 run with `stopped`, which is asked afresh, and a `bringStopped`, which goes.

### tests-unit#2

- **title:** the collateral's mix drawing again a box the tries before found taken is pinned only where the chain mixes in the 5 ₳ pool
- **severity:** low · **introduced:** new · **kind:** test · **proven:** mutation
- **where:** `src/background/lovejoin.ts:3958-3961` (tailRows; its second branch is at `:3960`), `:3665`
- **claim:** tailRows (e5f06392) hands each try of a chain's build the rows its collateral's mix draws from. Where the chain mixes in the 5 ₳ pool too, it hands this try's own read. Otherwise it hands the rows collateralPool read, less what the tries before found taken (`avoid`). The first branch is pinned and the second's `avoid` filter isn't: drop it, and the bug e5f06392 fixed comes back for every chain that mixes somewhere else.
- **scenario:** a mix from the private balance into v2's token pool (or the return of a session funded for it), with its session's 5 ₳ collateral going into the 5 ₳ pool. After collateralPool reads that pool, another chain of the wallet's reserves one of the two boxes the collateral's mix draws. The build is refused (StalePool). Under the mutant every try draws the same box again, until `STALE_POOL_TRIES` runs out and the mix gives up with "the pool drifted".
- **evidence:**
  - `tailRows-asBefore` (every try handed the rows read before the chain) is killed by lovejoin.test.ts:681, "builds the chain again from a fresh read when the network doesn't know a pool box it drew" (26 s).
  - `tailRows-noAvoid`, `:3960` `c.collateralPool.rows.filter((u) => !avoid.has(outpoint(u)))` → `c.collateralPool.rows`, survives TAIL_SET (`npx vitest run tests/{lovejoin-retired,lovejoin,lovejoin-planner,collateral-reserve-review-fixes,chain-reservations,chain-entry,chain-in-view,chain-lock,chain-record,chain-resend,chain-return-history,chain-requests,chain-stopped-copy,restore-scan-lovejoin,session-collateral,session-trap,sessions,sessions-review-fixes,submit-inputs-spent,dapp-chain-collateral,return-chain-scope,lovejoin-form-review-fixes,approvals-review-fixes,lovejoin-merged-review,swap-lovejoin-way,parts-send-review-fixes,collateral-held,lovejoin-stopped-before,lovejoin-flows}.test.ts --maxWorkers=2`, **29 files, 554 passed**) and TAIL_MORE (`npx vitest run tests/{i18n-worker-reasons,lovejoin-1-5-0,lovejoin-release-rules,lovejoin-restore,restore-scan,return-site-outs,session-stale-reservation,unlock-waits,worker-words}.test.ts --maxWorkers=2`, **9 files, 183 passed**).
  - `tailRows-noRead` (the second branch for every chain) survives both sets too: no test tells this try's own read from the first read less `avoid`.
- **fix:** add a test of a private mix into the v2 token pool where another chain reserves the collateral's first draw between collateralPool's read and the build (the shape of chain-reservations' `poolReadsTogether`). It should build on the next try with that box left out.

### tests-unit#3

- **title:** roomIn is pinned only for a return into the 5 ₳ pool, not across pools, in another pool, or for a mix session
- **severity:** low · **introduced:** new · **kind:** test · **proven:** mutation
- **where:** `src/background/lovejoin.ts:816-820` (roomIn), `:3816` (acrossOf's `counts`), `:3551` (`holdTail`)
- **claim:** lovejoin-retired's "leaves its collateral's mix two boxes of the 5 ₳ pool" pins roomIn's hold, and its floor of one box, for a return whose chain is in the 5 ₳ pool. No test pins three neighbouring rules:
  - a return across pools holds those two boxes in its ADA leg;
  - no other pool's room is cut for them;
  - a mix session (whose boxes are paid for) holds none.
- **scenario:**
  - (a) a site's session holds a box's worth of LJTEST and 40 ₳, and the 5 ₳ pool holds 8 boxes that aren't the wallet's, one wave deep. With acrossOf's room plain, the ADA leg takes 4 boxes and its mixes draw all 8. The collateral's mix has none left to draw, and the 5 ₳ comes back with the rest, unmixed, which is the case roomIn exists for.
  - (b) with the hold counted in every pool, a token pool's leg puts in fewer boxes than its room allows.
  - (c) with `holdTail` set for a mix session too, a session funded for N boxes in a tight 5 ₳ pool mixes fewer than it paid for.
- **evidence:** each survives TAIL_SET (**29 files, 554 passed**) and TAIL_MORE (**9 files, 183 passed**), with the commands in tests-unit#2:
  - `roomIn-acrossPlain`: `:3816` `roomIn(c, l.pool, free(l.split.others, l.split.reserved).length, perBox * (w - 1))` → `Math.floor(free(l.split.others, l.split.reserved).length / (perBox * (w - 1)))`
  - `roomIn-holdAnyPool`: `:818` `c.collateralPool?.pool.id !== pool.id` → `!c.collateralPool`
  - `holdTail-mixSessionsToo`: `:3551` `way.collateralPool && boxes === undefined ? { holdTail: true } : {}` → `way.collateralPool ? { holdTail: true } : {}`

  lovejoin-retired kills `roomIn-noHold`, `roomIn-noMinOne` and `holdTail-never`.
- **fix:** add to lovejoin-planner:
  - a return across the token pool and a tight 5 ₳ pool, whose review has `collateralTail` and leaves two boxes there;
  - the token leg's count, unchanged by the hold;
  - a mix session in a tight 5 ₳ pool that mixes every box it paid for.

### tests-unit#4

- **title:** the owner's 2026-11-06 call is pinned for a deposit's box alone, not for Koios's word, a Bootstrap, a cut chain's box, or Bring one back now
- **severity:** low · **introduced:** new · **kind:** test · **proven:** mutation
- **where:** `src/background/lovejoin.ts:5565-5581` (sortOut's `old`), `:6576`, `:6596` and `:6630` (withdrawNow's `old`), `:1927` (moreThanDue's `retired`); `tests/lovejoin-retired.test.ts:356-386`
- **claim:** the call reads "no mixing in retired pools withdraw only. period": nothing in a retired pool is held for Mix again, a Bootstrap, or Koios's word on what made a box. lovejoin-retired's "holds nothing in a retired pool" pins it for a box a deposit made (the deposits filter's mutant dies there). Every other filter that makes the call true survives every test that puts the wallet's boxes in a retired pool. As lovejoin-restore's header says, each of its hold tests moved to the 5 ₳ pool, and nothing took their place for the retired pools.
- **scenario:** with any one filter dropped, nothing fails, and:
  - a classic box whose making Koios can't say (a restore while tx_info times out) is held, as unsure or (where Bring one back now forces the look) as untold, and never comes back by itself while Koios can't say;
  - a 1.7 chain cut in the classic pool leaves its box held "not mixed yet", waiting for a Mix again the pool refuses;
  - a Bootstrap the first run didn't release holds its boxes there;
  - Bring one back now, with no box named, passes over a classic box that is held or unknown ("weren't mixed yet"), though the pool can only withdraw;
  - a 1.7 chain still being sent there could have its box freed (sending), or its due times dropped in a retired pool (unschedule).
- **evidence:** each against RETIRED_LEAN, `npx vitest run tests/{lovejoin-retired,lovejoin-1-5-0,lovejoin-restore,lovejoin-pools,lovejoin-bring-all-back,lovejoin-bring-review-fixes,lovejoin-bring-screen-review-fixes,lovejoin-release-rules,lovejoin-merged-review,lovejoin-public-cap-review-fixes,lovejoin-crediting-review-fixes,lovejoin-flows,lovejoin-stopped-shown,lovejoin-index,lovejoin-token-feed,private-landing,run-traps-review-fixes,wasm-review-fixes}.test.ts --maxWorkers=2`, each **18 files, 292 passed**:
  - `:5566` `found.unsure.filter(waits)` → `found.unsure` (Koios can't say, counted)
  - `:5566` `found.untold.filter(waits)` → `found.untold` (Koios can't say, forced)
  - `:5568` `bootstrapOf(before, owned).filter(waits)` → `bootstrapOf(before, owned)`
  - `:5569` `unmixedOf(chains.filter((c) => c.ended), owned).filter(waits)` → without the filter (a cut chain's box)
  - `:5570` `unmixedOf(chains.filter((c) => !c.ended), owned)` → `….filter(waits)` (a chain's box being sent, freed)
  - `:5581` `pools.filter((x) => !old.has(x))` → `pools` (unschedule in a retired pool)
  - `:6576` `const old = retiredOf(reads)` → `new Set<string>()` (Bring one back now as in a v2 pool)
  - `:6596` `.filter((b) => !old.has(poolOf(b)))` removed (its held set: which boxes Koios is asked about before the choice)
  - `:6630` `old.has(poolOf(b)) || mixed(b)` → `mixed(b)` (its known-mixed rule)
  - `:1927` moreThanDue's retired branch → the v2 one, or nothing held. These two change only what Koios is asked, since `waits` drops the answer in a retired pool.

  lovejoin-retired kills `sortOut-waitsAll` (every filter at once), `sortOut-deposits` and `withdrawDue-madeRetired`.
- **fix:** add to lovejoin-retired:
  - a classic box Koios can't say anything about (lovejoin-restore's `flakyTxInfo`), which comes back by itself;
  - a cut 1.7 chain's classic box, which comes back by itself too;
  - a Bootstrap recorded after `retired`, which holds nothing there;
  - Bring one back now with no box named, which takes, with no `anyway`, a classic box a deposit made and one Koios can't say anything about.

### tests-unit#5

- **title:** run-traps' "in its own run" case now runs Bring every box back, so no test checks that a box's scheduled withdraw hands a trap on
- **severity:** low · **introduced:** new · **kind:** test · **proven:** mutation
- **where:** `tests/run-traps-review-fixes.test.ts:277-296` (with its `dueBox`, `:128-139`); `src/background/lovejoin.ts:6496-6502`
- **claim:** "hands a trap in a box's withdraw on, in its own run and in Bring every box back now's" loops `bring` over false and true, with a due box of the classic pool. Since #364, the first run that finds that box retires the classic pool (retireOnce) and asks Bring every box back, so the `bring = false` case runs Bring every box back's withdraw too. No test now reaches the scheduled withdraw's catch, which hands a trap on so the wallet locks (1.6.0's release review, 314-wasm#0). #364 didn't touch this test (its hunks in the file moved the 5 ₳ pool's tests), so nothing marks the change.
- **scenario:** with the scheduled withdraw's `if (isTrap(e)) throw e;` removed, a trap in a box's own withdraw (WebAssembly broken for good) is taken for a withdraw that didn't go. Its due time stays, the next run builds on the broken instance again, and the wallet never locks. Every test still passes.
- **evidence:**
  - mutant `scheduledWithdraw-swallowTrap` (`:6500` `if (isTrap(e)) throw e;` removed): `npx vitest run tests/{run-traps-review-fixes,session-trap,wasm-review-fixes,lovejoin-retired,lovejoin-withdraw-submit,withdraw-refused-locked,pending-alarm,runs}.test.ts --maxWorkers=2` → **8 files, 67 passed**;
  - the same test with one line added after `dueBox` (`await retiredAlready(t.store)`, so the record is past its first run) is `tests/tests-unit-scratch-traps.test.ts`. It passes on the tree and **fails** under the mutant (`-t "hands a trap in a box's withdraw on"`). The original passes under it;
  - scratch "B:" shows the mechanism: a due classic box makes `withdrawDue` write `retired` and `bringing: {"retired":true,…}`, and run the bring-back.
- **fix:** in run-traps-review-fixes.test.ts, either put `dueBox`'s box in the 5 ₳ pool (`adaBox`, a leaf with `pool: ADA`, `pools: { [ADA]: 1 }`) or call `retiredAlready` after `dueBox`. The test at `:474` ("keeps a withdraw sent as sent…") uses the same box and needs the same change.

### tests-unit#6

- **title:** 1.8.0's first run retires before it marks the chains the update cut, so a 1.7 return's collateral's box in 1.7's 5 ₳ pool is held up to a day for a mix the pool refuses
- **severity:** low · **introduced:** new · **kind:** code · **proven:** test
- **where:** `src/background/lovejoin.ts:6346-6351` (withdrawDueNow: retireOnce, then bringAllBackNow, whose chainsMixing (`:6764`) runs `cuts`), `:4086` (retireOnce's `tails`: ended chains alone), `:4193-4196` (tailChain's `isRetired`)
- **claim:** an update wipes session storage, so a chain mid-send is cut, but `cuts` marks it ended only after retireOnce has run. retireOnce ends a collateral's tail in a retired pool only on a chain already ended, so at the first run it marks the network retired and leaves that tail. The tail's box is then held by tailBoxes for up to `TAIL_KEEP_MS` (24 h), and the retired pools' Bring every box back sits "waiting for the collateral". That runs against call 3 (right away) and the 2026-11-06 call (nothing held in a retired pool). Only tailChain's `isRetired` then stops the session's next return from building that mix in the retired pool, and no test pins it.
- **scenario:** a 1.7 return's chain is cut by the update (or by a browser closed mid-chain, with Chrome applying the update at the next start) after its collateral's deposit into 1.7's 5 ₳ pool and before that box's mix. At 1.8.0's first unlock, the classic leaf comes back, but the collateral's box stays, and Settings says the run waits for the collateral's mix. The box comes back a day later, or sooner if the user brings the session back (tailChain ends the tail then).
- **evidence:**
  - scratch "F:", `npx vitest run tests/tests-unit-scratch.test.ts -t "F:" --maxWorkers=2`, starts from a not-yet-ended 1.7 chain record with a tail in 1.7's bundled 5 ₳ pool. After `withdrawDue(unlock)` the record has `retired` set, the chain `ended`/`cut`, and `tail.over` undefined; `tailOf` then hands the tail on, `{"pool":true}`.
  - scratch "F2:" lists that tail's box and the chain's classic leaf. Over five runs, giveme.my is asked for the leaf alone, and the record reads `bringing: {"back":1,"retired":true,"left":1,"waiting":"collateral"}`. `expect(withdrawn(t)).toContain(<tail box>)` fails.
  - mutant `tailChain-retired` (`:4193-4196` removed) survives RETIRED_SET: **21 files, 407 passed** (tests-unit#1's command).
- **fix:** run `cuts` before retireOnce in withdrawDueNow (or have retireOnce call it), so the tails of chains the update cut are ended too. Pin it with F2's case, and pin tailChain's `isRetired` with a tail left to build in an 8131b1d pool after `retired`.

### tests-unit#7

- **title:** the check that stops a 1.7 Mix my boxes again session mixing in the classic pool is pinned by no test
- **severity:** low · **introduced:** new · **kind:** test · **proven:** test
- **where:** `src/background/lovejoin.ts:3523` (chain(): `if (!again || isRetired(into))`); `src/background/sessions.ts:4497`
- **claim:** a Mix my boxes again session funded from the private balance under 1.7, whose chain hasn't run yet, names no pool, so it is the classic pool's (sessions.ts:4497). chain() refuses it only through `isRetired(into)` beside `!again`. lovejoin-retired's 1.7 case is a mix session's return (`mix: { boxes: 2 }`), not Mix again.
- **scenario:** without the check, the session's next build or advance makes a Mix again chain in the classic pool. The wallet's classic boxes and two strangers' are spent in a mix of a retired pool.
- **evidence:**
  - mutant `chain-againRetired` (`:3523` → `if (!again)`) survives `npx vitest run tests/{lovejoin-retired,lovejoin,lovejoin-restore,lovejoin-planner,lovejoin-1-5-0,sessions}.test.ts --maxWorkers=2` (**6 files, 305 passed**) and `npx vitest run tests/{return-plan,lovejoin-bring-all-back,lovejoin-pools,lovejoin-flows,lovejoin-merged-review,restore-scan,lovejoin-stopped-before,collateral-reserve-review-fixes}.test.ts --maxWorkers=2` (**8 files, 207 passed**; return-plan holds the tree's one 1.7-style `mix: { boxes: 2, again: true }` record, which runs without Lovejoin);
  - scratch "E:" (`-t "E:"`) passes on the tree, with `lovejoinSkipped` the retired words and no classic box spent. Under the mutant it fails: `lovejoin: {"boxes":1,"depth":1,"mixes":1,"txs":4,"again":true,…}`, its chain spending **3** classic boxes.
- **fix:** move scratch E into lovejoin-retired.test.ts's "a session's return".

### tests-unit#8

- **title:** no worker test checks the `retired` mark that held() puts on a retired pool, which BringAllBack's "nothing was left" reads
- **severity:** low · **introduced:** new · **kind:** test · **proven:** mutation
- **where:** `src/background/lovejoin.ts:6292` (held()); `src/ui/components/BringAllBack.tsx:45-52` (doneOf); `tests/lovejoin-retired.test.ts:441-459`
- **claim:** doneOf says nothing was left after the retired pools' run only when no pool marked `retired` still holds the wallet's boxes. lovejoin-retired tests doneOf with a `LovejoinHeld` built by hand, and no test has the worker's held() mark an 8131b1d pool.
- **scenario:** without the mark, a retired run that sent nothing ends while an 8131b1d pool still holds a box that came after the run was asked (madeSince). The page says nothing was left there, though Home lists the box.
- **evidence:** mutant `held-retired` (`:6292` removed) survives RETIRED_SET: **21 files, 407 passed**.
- **fix:** in lovejoin-retired's "says so on its status", assert `(await lj.held("preprod")).pools` marks the old token pool `retired: true` and the 5 ₳ pool not.

### tests-unit#9

- **title:** two of sessions.ts's new no-5 ₳-pool rules are pinned by no test: "Put in 5 ₳" offered for nothing, and a quote's price asking discovery
- **severity:** low · **introduced:** new · **kind:** test · **proven:** mutation
- **where:** `src/background/sessions.ts:4701-4702` (collateralWanted), `:1759` (priced)
- **claim:** collateralWanted counts a box of the spare ADA only where a 5 ₳ pool is shown (`ada &&`). Without that check, a return with no 5 ₳ pool and no 5 ₳ at its account says its collateral is missing (`sess.skip.warn.noCollateral`) and the session's page offers to put 5 ₳ in, for a mix no pool would take. priced's `adaPool(network)` is quiet ("as the user types"); with `ask` set, every quote with no pool kept would refresh discovery. testBalances wires `pools` without `known`, so a quiet read and a look look the same to every test that doesn't pass `known`.
- **scenario:** a session with 40 ₳ and no 5 ₳ at its account, on a network with no v2 5 ₳ pool shown. Under the first mutant its page offers Put in 5 ₳. After the top-up the return still comes back directly ("no pool of 5 ₳ boxes"), so the top-up's fee bought nothing.
- **evidence:** `sessions-spareAda` (`:4702` `if (ada && spare >= …)` → `if (spare >= …)`) and `sessions-pricedAsks` (`:1759` `adaPool(network)` → `adaPool(network, true)`) each survive `npx vitest run tests/{lovejoin-1-5-0,sessions,lovejoin,lovejoin-planner,collateral-reserve-review-fixes,lovejoin-retired,approvals-review-fixes,dapp-prompt}.test.ts --maxWorkers=2`: **8 files, 341 passed**. The same set kills priced's 64-box cap (sessions.test.ts), its `noAdaPool` skip and its `affordable` check (both lovejoin-1-5-0's `asRetired`).
- **fix:** add a session test with no 5 ₳ pool and no 5 ₳ at the account: `lovejoinSkipped` is `noAdaPool`, never `noCollateral`, and `backCollateral` is unset. Add a quote test with `known: []` and a counting `pools`: no ask.

### tests-unit#10

- **title:** three moved tests now pass for the retirement's reason, not their own
- **severity:** nit · **introduced:** new · **kind:** test · **proven:** mutation
- **where:** `tests/lovejoin-restore.test.ts:308-325` and `:700-723`; `tests/lovejoin-flows.test.ts:538-590`
- **claim:**
  - lovejoin-restore's "asks Koios nothing new in its steady state" and "asks nothing while Mix my boxes again sends two of a steady-state wallet's boxes" keep their boxes in the classic pool. Their `withdrawDue(unlock)` step now runs the retired pools' bring-back, which never asks what made a box, so it no longer reaches the scheduled run's count. The 5 ₳-pool test that kills `withdrawDue-forceAll` pins that count instead.
  - lovejoin-flows' "still brings a 1.5.0 seed's box back by itself…" has its seed half in the classic pool, which since 1.8.0 holds nothing. The half passes whether or not seeds are held, and 1.5.0 seeds live only in that pool.
- **scenario:** each passes under a mutant that breaks its subject.
- **evidence:**
  - `withdrawDue-forceAll` (the scheduled run forced to ask Koios about every box) → `npx vitest run tests/lovejoin-restore.test.ts -t "asks Koios nothing new in its steady state|asks nothing while Mix my boxes again sends two of a steady-state" --maxWorkers=2`: **2 passed**. The mutant itself dies on lovejoin-restore's "asks, before a box no record accounts for comes back by itself…".
  - `seedRule-holdSeeds` (`:2427` seeds held as Bootstraps) → the flows test passes, and RETIRED_LEAN passes (18 files, 292).
  - scratch "B:" shows the restore tests' run writing `retired` and a `retired` bring-back.
- **fix:** put the two restore tests' boxes in the 5 ₳ pool (as the rest of the file did), or call `retiredAlready` first. Drop the flows test's seed half, or reword it to say the classic pool holds nothing.

## Covered

- **The diff, file by file** (`git diff c441881e a6c94743 -- …/extension/tests`: 64 test files and the three helpers).
  - No test was dropped and no `expect` lost: the `it(` and `expect(` counts per file are equal or higher. Nothing added a `skip`, `only`, `todo` or `fails`.
  - Every hunk that swapped a strict matcher for a looser one pairs it with a stricter check beside it. The planner's collateral mix also checks that its two draws avoid the chain's own; `amounts.size` goes 2→4 with both amounts named. Or it follows a shape change: `{txHash, txIndex}` becomes `{…, pool: ADA}`, `due` becomes `pools[ADA].due`, `unscheduled` becomes `unscheduledIn[ADA]`.
  - No refusal I read now passes for another reason: each `lovejoin).toBeUndefined()` (session-collateral, restore-scan, restore-scan-lovejoin, sessions, swap-lovejoin-way, and the moved files read in full) keeps its `lovejoinSkipped` checked (not `noAdaPool`), or sits where Lovejoin is off or the switch is direct.
- **Figures were worked out, not pasted.** From a 5 ₳ box, `MIX_FEE_ESTIMATE` of 0.95 ₳ (1.35 ₳ four a mix), the 0.3 ₳ withdraw estimate, the 1.5 ₳ deposit reserve and 20 strangers' boxes:
  - a 40 ₳ return two waves deep is 2 boxes (room 20/8, or (20−2)/8 with the tail held), 12 transactions with the collateral's deposit and mix, and draws 18 of the 20;
  - a one-box Bootstrap is 6.5 ₳ (8 ₳ with its way back, 8.3 ₳ at a 1.8 ₳ reserve);
  - a box two waves deep costs 10.3 ₳, or 13.25 ₳ four a mix;
  - Stop's 40 ₳ pays for 4 boxes, and the pool mixes 2;
  - a swap's 54 ₳ pays for 5 boxes at 9.1 ₳;
  - 55.3 ₳ one wave deep pays for 9 boxes at 5.95 ₳ (6 without the token boxes' ADA);
  - one deposit on the new scripts holds 64 boxes;
  - `NO_BOX` is 6 ₳;
  - restore-scan-lovejoin's 25 ₳ pays for 2 boxes.

  Each matches the test's new figure and its comment.
- **Moved to pools their rules apply in.** Every test of a box held (deposit, cut chain, Koios can't say, Bootstrap, the public account's box) moved to the 5 ₳ pool, where holds still apply. The classic pool keeps the tests of its own records (1.5.0's vault, seeds, crediting, Bring every box back), with `retiredAlready` where a test needs a box to keep its own wait past the first run. The exceptions are tests-unit#5 and #10.
- **The 1.5.0 gate** (lovejoin-1-5-0). `asRetired` and `finishesRetired` build their expectations from 1.5.0's recorded plans and trace, not from this tree's output:
  - each return becomes its recorded direct return, with `noAdaPool`;
  - the unlock resends every `CHAIN_RESEND_MS`;
  - the run that sees the withdraw brings back every box 1.5.0 brought back over nine hours, and the two its restore held.

  The head-start case pins that no bundled pool is v2, which 44c must read again (as the plan says).
- **Helpers checked against the chain and the data layer.**
  - `v2-pools.ts`'s boxes sit at the pool's enterprise script address (`0x70` + `mixBoxHash`, which core's `mix_box_address` and its check at `lovejoin/mod.rs:431` require), with 5 ₳, no assets and an inline register datum.
  - `madeByAdaMix` is tx_info's input at that address with its credential, and `ADA_POOL` verifies through WebAssembly as `version: "v2"`.
  - lovejoin-index puts the 5 ₳ pool's rows on `lovejoin/tokens`, with the pool in `pools`. That's where the data layer serves every shown pool's boxes (`seedelf-data/api/src/lovejoin/routes.rs` `tokens`, and its README).
  - Rows keep the classic template's `block_height`/`epoch_no`, and say `datum_hash: null` where Koios gives the inline datum's hash. No wallet code reads either field for a pool row (checked in lovejoin.ts and wasm's lovejoin.rs).
  - `testBalances({ pools })` wires `pools` alone (see tests-unit#9).
- **Owner's calls against lovejoin-retired.test.ts.** At least one killed mutant pins each of:
  - call 1: status's list and the hub's `shownOnHub`;
  - call 2: every way in refused in words before anything is built, from both sides, in the classic and 8131b1d pools;
  - call 3: the first run's bring-back over the retired pools, never a v2 pool's, once, at the unlock with no draw;
  - call 4: the 5 ₳ pool taking the ADA and the collateral, `noAdaPool` with none, a 1.7 mix session refused as retired, the tail's two draws held.

  The 2026-11-06 call is pinned for a deposit's box and for the no-wait bring-back (the rest is tests-unit#4).
- **Mutants killed**, of the 84 over the new code:
  - `isRetired`, both ways;
  - the `retired` check in `usableNow` and in `takesNewBoxes`;
  - retireOnce: its once (both checks), the `retired` write, the release, `tail.over`, the bring (none, and every pool's), overwriting a going run, the trigger without `stillIn`, a v2 tail ended too, and the call itself;
  - `retiredIds` reading classic only;
  - tailRows as before;
  - roomIn's hold and its floor of one box; `holdTail` never set;
  - crossCheck's tail deposit (lovejoin.test.ts "mixes the wallet's boxes again…");
  - sortOut: `waits` whole, the deposits filter, `retiredOf` at status and at the scheduled run;
  - the scheduled run's `!isRetired` before `made`;
  - `adaPool`'s `ask`; `adaPoolOf`'s `!isRetired`;
  - chain()'s `noAdaPool` and its review `values`;
  - `poolsOf`'s `!isRetired`;
  - status's `listedHere` and the classic pool's `unusable`;
  - `bringAllBack`'s other-pool refusal and its widening; `bringAllBackNow`'s `covered`;
  - the schedule read's `retired`; `bringingView`'s `retired`; `unusableReason`'s retired words;
  - sessions: the classic name for a 1.7 mix session, the chain's `values`, priced's cap, skip and `affordable`;
  - `room()`'s default pool;
  - `shownOnHub`'s `isRetired` and its Bootstrap clause; `poolsOf`'s classic `unusable`.
- **Equivalent or near-equivalent survivors** (no behaviour to pin):
  - retireOnce without its outer `retired` check: the inner one still stops it.
  - `usable` without its retired filter: `usableNow` says `retired` for each pool anyway.
  - status's early `{ why }` for a retired pool: the copy branch gives the same.
  - `bringStopped.retired`, both where it's written and where it's read back: no screen reads `bringStopped`'s `retired` or `pool` (BringAllBack follows the run it saw).
  - priced's `fits` with no pool: `affordable` is already 0.
  - `adaPoolOf` taking a copy: the read set is in launch order, and a lone copy is refused by `usableNow` anyway.
  - acrossOf's `!isRetired`: `usableNow` drops a retired pool from `works`, and only the review's words for a token whose pools are all retired differ.
- **Probe C:** with nothing kept, one return's review asks discovery's list four times (`asked` is 4). The test named "asks discovery once" asserts `> 0`. Every pool read asks it anyway, as `readSet` does, so this is no finding.
- **Preprod-only build:** `VITE_ENABLE_MAINNET=false npx vitest run tests/lovejoin-retired.test.ts tests/lovejoin-1-5-0.test.ts --maxWorkers=2` → 2 files, 20 passed.

## Not checked

- The whole 154-file worker suite against each survivor. Each survivor ran only against the sets named in its finding, which hold every file that can reach its code (RETIRED_SET by grep for wallet boxes in retired pools; TAIL_SET and TAIL_MORE by grep for return, mix and Bootstrap builds in a 5 ₳ pool world). The non-listed survivors (#7–#9) ran against smaller targeted sets, named in each.
- `tailRows-fanOutNoSplit` and `tailRows-acrossNoSplit`, stopped part-way: they are the second branch at one call site each, which `tailRows-noRead` already covers.
- `withdrawNow-classicWatch` (a classic box's Bring one back now watched on the contract's feed) and `settleWithdrawing-classicFeed` both survive RETIRED_SET. Whether either breaks anything wasn't traced. The first was pinned before #364 by lovejoin.test.ts's "watches a box brought back now in Home's banner", whose box #364 moved to the 5 ₳ pool.
- tests-unit#2's and #3's scenarios built as tests: they're proven by surviving mutants only.
- The preprod-only build for the other moved files; the e2e (tests-e2e); the screens' words and the critical keys (words); the Rust side and the data layer (pr363).
