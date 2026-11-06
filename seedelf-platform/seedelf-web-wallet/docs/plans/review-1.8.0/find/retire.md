# retire: #364's withdraw-only rule and the first unlock's bring-back (the worker)

Reviewer: retire. Tree: `a6c94743`, read and run in the sandbox
`/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/wt/retire`.
Lines are `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts` unless named.

Evidence lives in two places, both in the sandbox (scratchpad, the lead removes it):

- `extension/tests/retire-scratch.test.ts`: 15 scratch tests, all passing at `a6c94743`, run with
  `npx vitest run tests/retire-scratch.test.ts --maxWorkers=2` from the extension folder (31/31 beside
  `lovejoin-retired.test.ts` on both builds, `VITE_ENABLE_MAINNET=false` too). A copy is at
  `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/retire-mut/retire-scratch.test.ts`.
- `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/retire-mut/`:
  `mutate.py` (one exact-string mutation, the named tests, then the file restored), `combined.py` (every surviving
  mutation at once against 104 worker test files, scratch file excluded) and `bisect.py`. The combined mutant failed
  2 of 1374 tests, both M3's alone (bisect): every other mutation named below survives all 104 files.

Every finding is Low or Nit. No box is stranded and nothing deposits or mixes into a retired pool on any path I
found: the refusals hold. What's below is where "right away" quietly doesn't happen, one fragile default, and
guards no test pins.

### retire#0

- **Title:** A pool page's Bring every box back that 1.7 left going takes the first run's place: the other retired pools' boxes never come back right away.
- **Severity:** low · **kind:** code · **introduced:** new
- **Where:** `lovejoin.ts:4092`, `lovejoin.ts:4096`, `lovejoin.ts:4083`
- **Claim:** retireOnce keeps a going run as it is (4096: "One the user asked that still goes stays as it is"), and still marks the network retired (4092). If that run is one pool's (1.7's pool page), the retired pools' run is never asked, and retireOnce never runs again (4083). The other retired pools' boxes come back only on their own draws, not at the first unlock (the owner's call 3).
- **Scenario:** On 1.7.2 the user presses "Bring every box in this pool back now" on PR #163's 8131b1d token pool page, and Chrome updates the extension while that run goes (`bringing: {pool}` sits in the sealed record). At 1.8.0's first unlock, retireOnce sets `retired` and keeps `{pool}`. The run brings that pool's boxes back and ends. The classic pool's box then waits its own due time, hours away, and no right-away run comes for it on that network.
- **Evidence:** In `tests/retire-scratch.test.ts`, "a pool page's run 1.7 left going keeps its one pool: the classic pool's box isn't asked back at the first run" passes at a6c94743. After the first `withdrawDue(unlock)`, `retired` is set, `bringing` is `{pool: OLD_TOKEN}` with no `retired`, and only the token box is withdrawn. After 5 more runs the run is over, the classic box isn't withdrawn, and its due time is more than 30 minutes away. Command: `npx vitest run tests/retire-scratch.test.ts --maxWorkers=2 -t "1.7 left going"`.
- **Fix:** In retireOnce's update, replace a going run of one retired pool with the retired pools' run, keeping its `at` and `back` (it covers that pool). If a going run can't cover the retired pools (a v2 pool's, after a late fire), leave `retired` unset, so the next run after it asks again.

### retire#1

- **Title:** retireOnce reads the chains before cuts. A collateral's mix the update cut in 1.7's 5 ₳ pool isn't ended, and the retired pools' run waits on its box for up to a day, holding back every pool's scheduled returns meanwhile.
- **Severity:** low · **kind:** code · **introduced:** new
- **Where:** `lovejoin.ts:4082`, `lovejoin.ts:4086`, `lovejoin.ts:6811`, `lovejoin.ts:6824`, `lovejoin.ts:6351`, `lovejoin.ts:1385`
- **Claim:** retireOnce reads the schedule without `this.cuts(network)`, and its `tails` filter keeps ended chains alone (4086). A chain that 1.7 was sending when the update came still reads as being sent at the first 1.8.0 run when nothing has called cuts yet. Its tail is in a retired pool, but retireOnce marks the record retired without ending that tail (`tail.over`). chainsMixing then cuts the chain, and its tail is buildable (`tailBuildable`, 1385) for TAIL_KEEP_MS (24 h). So the retired pools' run leaves that box to its mix (`tailBoxes`, 6811), a mix nothing will build in a retired pool, and says so (`waiting: "collateral"`, 6824: "What's left is a session's 5 ₳ collateral: it waits for its mix, a day at most."). While the run waits, withdrawDueNow returns its answer (6351), so no scheduled withdraw of any pool goes. It ends when the session's return is built by hand (tailChain's guard then ends the tail) or when the day is up.
- **Scenario:** A dApp session's return chain is all sent, its spare ADA in the classic pool, its 5 ₳ collateral's deposit in 1.7's 8131b1d 5 ₳ pool, the collateral's mix waiting for giveme.my (minutes, normally), when Chrome updates the extension. At the first unlock, the runs' withdrawDue comes before anything calls cuts (sessions' runAll, pumpPublic and pending.watch don't; Home's `held` does, if it comes first). The classic boxes come back. The collateral's box waits, and a box in v2's 5 ₳ pool, an hour past its due time, doesn't come back for that day.
- **Evidence:** In `tests/retire-scratch.test.ts`, under "a chain the update cut, its collateral's mix waiting in 1.7's 5 ₳ pool", all of these pass at a6c94743:
  - "is not marked over by the first run, and the retired pools' run leaves its box to that mix": after the first run, `retired` is set, the chain is ended, `tail.over` is undefined, both classic boxes are withdrawn and the tail box isn't. Four runs later the tail box still isn't withdrawn, and `bringing` is `{retired: true, waiting: "collateral"}`.
  - "and while it waits there, no scheduled return of any pool goes": a v2 box due an hour ago isn't sent in 20 runs (an hour, the wallet kept unlocked).
  - Control "with that mix ended first, the same v2 box comes back within the same hour of runs": `held()` first, so cuts runs, and both the tail box and the v2 box are sent.
  - Control "read once first (cuts)": the tail is over and its box comes back.

  Command: `npx vitest run tests/retire-scratch.test.ts --maxWorkers=2 -t "update cut"`.
- **Fix:** `await this.cuts(network)` at the top of retireOnce, as tailOf, status and held do, so `tails` sees the cut chain ended and ends its tail.

### retire#2

- **Title:** Once stopped, the retired pools' run is never asked again: Settings' Try again (its critical words: "Press Try again to bring back the rest") asks every pool's run, and the v2 pools' boxes come back too.
- **Severity:** low · **kind:** code · **introduced:** new
- **Where:** `lovejoin.ts:6704`, `lovejoin.ts:6976`, `lovejoin.ts:4083`, `src/i18n/translations/en.json:1987`, `src/ui/components/BringAllBack.tsx:283`, `src/ui/components/BringAllBack.tsx:377`, `src/ui/components/BringAllBack.tsx:197`
- **Claim:** The retired pools' run stops after BRING_FAILED_RUNS (3) runs that send nothing (6976), or when Stop is pressed. Nothing asks it again: retireOnce returns once `retired` is set (4083), and `bringAllBack` takes no retired scope. Settings shows the stopped run (BringAllBack.tsx:283) with `settings.warn.bringStopped`, "Stopped: several tries in a row sent nothing. {{why}} Press Try again to bring back the rest." Its Try again (377) sends `lovejoin-bring-all-back` with `{}` (197), which makes every pool's run (6704). That run brings back, back to back, the boxes the user mixed into v2 pools too, which the retired run never touches. The note beside the button does say "Every box in every pool", so the user is told, but "the rest" isn't what the press does. A retired pool's own page can restart only that pool's run.
- **Scenario:** giveme.my or Koios fails for three minutes at the first unlock. The retired run stops itself. The user presses Try again. Their boxes in v2's 5 ₳ pool, mixed an hour ago and hours from their own due times, come back in the same burst as the retired ones.
- **Evidence:** In `tests/retire-scratch.test.ts`, "stopped by three runs that sent nothing, Settings' Try again asks every pool's run: the v2 boxes come back too" passes at a6c94743. With giveme.my answering 500, three runs send nothing, and `held().bringing` is `{retired: true, stopped: …}`. After `bringAllBack()` (Try again's request), `bringing.retired` is undefined, and the next runs send both the classic box and the v2 box (`t.koios.submitted`). Command: `npx vitest run tests/retire-scratch.test.ts --maxWorkers=2 -t "Try again"`.
- **Fix:** Let Try again on a stopped retired run ask that run again: carry `retired` through `lovejoin-bring-all-back` to bringAllBack, or have bringAllBack with no pool restart `{retired: true}` when the stopped record is the retired run's. Keep every pool's for Settings' first press. Or make the stopped retired run's words say what Try again does.

### retire#3

- **Title:** Untested guards: a 1.7 Mix again session's chain, and a 1.7 collateral's mix built again, in a retired pool.
- **Severity:** low · **kind:** test · **introduced:** new
- **Where:** `lovejoin.ts:3523`, `lovejoin.ts:4193`
- **Claim:** Both guards keep a mix out of a retired pool, and both work. No suite test fails without either.
- **Scenario:**
  - Without 3523's `|| isRetired(into)`: a Mix my boxes again session that 1.7.2 funded but didn't build before the update builds a Mix again chain in the classic pool. Its record names no pool, so sessions.ts names it the classic pool's.
  - Without 4193's: a 1.7 collateral's mix left to build again in 1.7's 5 ₳ pool is built there, a `giveme` mix and the return after it. This guard is the only stop when the session's return comes before retireOnce (runAll runs before withdrawDue in each run), and in retire#1's state.
- **Evidence:**
  - M1 (`if (!again || isRetired(into)) {` → `if (!again) {`) survives `lovejoin-retired`, `sessions`, `sessions-review-fixes`, `lovejoin-flows` and `lovejoin` (227 pass), and the combined 104-file run. The scratch test "comes back directly, saying the classic pool is retired, never mixing the wallet's classic boxes again there" kills it: under M1 the review has `lovejoin: {again: true, boxes: 1, mixes: 4, …}`.
  - M2 (`if (isRetired(pool)) {` → `if (false) {` in tailChain) survives `lovejoin-retired`, `session-collateral`, `collateral-reserve-review-fixes` and `sessions-review-fixes` (77 pass), and the combined run. The scratch test "tailChain: a 1.7 collateral's mix left in 1.7's 5 ₳ pool is over, never built there" kills it: under M2, tailChain returns a chain whose txs are a `kind: "mix", giveme: true` and a `back`.

  Commands: `python3 -I …/retire-mut/mutate.py lovejoin '<old>' '<new>' tests/lovejoin-retired.test.ts …`, then `npx vitest run tests/retire-scratch.test.ts -t "Mix again session|tailChain"`.
- **Fix:** Add those two tests to `lovejoin-retired.test.ts`.

### retire#4

- **Title:** Untested guards: the v2 side of a late retireOnce and of the retired pools' run.
- **Severity:** low · **kind:** test · **introduced:** new
- **Where:** `lovejoin.ts:4093`, `lovejoin.ts:6867`, `lovejoin.ts:6292`
- **Claim:** retireOnce runs at every withdrawDue run until it fires, so it can fire late, after the wallet has used v2: a second device still on 1.7 mixes into the classic pool after this one updated, and this one's next read finds the box. Two guards keep that late fire off the v2 pools: the Bootstrap release's `old(poolOf(x))` (4093), and the run end's `covered` (6867, the retired scope). Neither is tested. `held()`'s per-pool `retired` flag (6292), which BringAllBack.tsx's `doneOf` reads for "Nothing of yours was left in the retired pools", is tested only by a hand-made `held` in the UI test.
- **Scenario:**
  - Without 4093's filter, the late fire lets the v2 5 ₳ pool's Bootstrap go, and its boxes stop being the Bootstrap's (the owner's call 4: "Bootstrap fills it").
  - Without 6867's, the retired run's end drops the v2 pool's due times and counts. The next read draws them again later, ignoring a swap's approved wait.
  - Without 6292's, Settings says the retired pools held nothing while an 8131b1d pool still has a box made since.
- **Evidence:**
  - M4 (4093 → `if (e.bootstrap) e.released = true`), M6b (6867 → `scope !== undefined ? r.pool.id === scope : true`) and M10 (6292 deleted) each survive `lovejoin-retired`, `lovejoin-release-rules`, `lovejoin-bring-all-back`, `lovejoin-bring-review-fixes` and `lovejoin-bring-screen-review-fixes`, and the combined run.
  - The scratch test "never lets a v2 Bootstrap go, ends a v2 collateral's mix, or drops the v2 pool's due times" (a v2 Bootstrap, a v2 tail and a v2 due time, then a classic box another device made) passes at a6c94743 and kills M4 and M6b.
  - Its third mutation, M3 (4086's `old(c.tail.pool)`), is caught by the suite (`lovejoin-crediting-review-fixes` "follows a return's collateral mixed…", and `lovejoin.test.ts` "withdraws nothing while a chain is being sent…"; bisect.py).
- **Fix:** Add the late-fire test to `lovejoin-retired.test.ts`, and a worker-level check that `held().pools[].retired` marks an 8131b1d pool and not a v2 one.

### retire#5

- **Title:** Untested guards: nothing held in a retired pool, past the first run. Only the restore's deposit box is tested.
- **Severity:** low · **kind:** test · **introduced:** new
- **Where:** `lovejoin.ts:5569`, `lovejoin.ts:5566`, `lovejoin.ts:6630`
- **Claim:** The owner's 2026-11-06 call, nothing held in a retired pool, rests on three filters besides `depositsOf`'s, which `lovejoin-retired`'s "holds nothing in a retired pool" pins. None of the three is tested:
  - `.filter(waits)` on an ended chain's boxes not mixed yet (5569);
  - the filter on the boxes Koios can't say the making of (`unsure`/`untold`, 5566);
  - Bring one back now's `old.has(poolOf(b)) ||` (6630).
- **Scenario:**
  - Without 5569's: a chain 1.7 stopped partway leaves its deposit's boxes held as not mixed yet in the classic pool. They wait for Mix my boxes again, which a retired pool refuses: no due time, so they never come back by themselves, only by hand.
  - Without 5566's: a box Koios can't say the making of after a restore is held there.
  - Without 6630's: Bring one back now refuses a deposit's box there.
- **Evidence:**
  - M13b (5569's `.filter(waits)` dropped), M13c (5566's two filters dropped) and M7 (6630 → `.filter((b) => mixed(b))`) survive the files named above, `lovejoin-restore`, `lovejoin-stopped-shown`, `lovejoin-due-times`, `lovejoin` and `lovejoin-withdraw-submit`, and the combined run.
  - Scratch tests "a 1.7 chain's boxes left not mixed yet in the classic pool get due times and come back by themselves", "a box Koios can't say the making of after a restore is no reason to hold it there" and "Bring one back now takes a deposit's box there, though no mix moved it" pass at a6c94743, and each kills its mutation.

  Command: `npx vitest run tests/retire-scratch.test.ts --maxWorkers=2 -t "nothing held"`.
- **Fix:** Add the three tests to `lovejoin-retired.test.ts`.

### retire#6

- **Title:** A pool the quiet read set lacks is taken for retired: one unreadable read of discovery's record just after a worker restart makes retireOnce let a v2 Bootstrap go for good, on a wallet with nothing retired.
- **Severity:** low · **kind:** code · **introduced:** new
- **Where:** `lovejoin.ts:4070`, `lovejoin.ts:2765`, `lovejoin.ts:4093`, `lovejoin.ts:6348`
- **Claim:** `retiredIds` reads every id not in the quiet read set as retired (4070: "named by 1.7, which read no v2 pool"). But 1.8.0's own records name v2 pools. readSet's quiet read falls back to `handed`, which is empty after a worker restart, when `known` throws (2765), and then returns the classic pool alone. retireOnce runs at every withdrawDue run until it fires (6348). On such a run, the wallet's v2 pools all read as retired: retireOnce marks the record retired, lets every v2 Bootstrap go (4093), ends v2 collateral mixes, and asks a retired run, which finds nothing and ends. The mark stays, so a real retired box later never gets the right-away run.
- **Scenario:** A wallet with only v2 boxes and a Bootstrap holding two boxes in v2's 5 ₳ pool. The worker wakes for an alarm run, and `discovery.known` throws once (chrome.storage.local refusing a get or a set: corruption, or the 10 MB quota with no `unlimitedStorage`). Afterwards Home counts nothing held, and status lists neither box as the Bootstrap's. The precondition is a storage failure, never normal use.
- **Evidence:** In `tests/retire-scratch.test.ts`, "discovery's record unreadable once after a restart: a wallet with nothing retired lets its v2 Bootstrap go" passes at a6c94743. Before, `held().pools[ADA].bootstrap` is 2 and `status` lists both boxes. A fresh service whose `known` throws runs `withdrawDue`: `retired` is set, the entry is `released: true`, `bringing` is gone, and neither `held` nor `status` names the boxes the Bootstrap's. Command: `npx vitest run tests/retire-scratch.test.ts --maxWorkers=2 -t "unreadable once"`.
- **Fix:** Count a pool as retired only when it's the classic pool, or the read set has it with a version other than v2. Where the record names a pool the quiet set lacks, skip retireOnce this run, or let readSet's quiet failure throw to retiredIds instead of reading as no pools.

### retire#7

- **Title:** A mix from the public account in a retired pool reads the account before it's refused.
- **Severity:** nit · **kind:** code · **introduced:** new
- **Where:** `lovejoin.ts:4480`, `lovejoin.ts:4482`, `lovejoin.ts:4631`, `lovejoin.ts:4634`, `src/background/sessions.ts:2036`, `src/background/sessions.ts:2066`
- **Claim:** The plan says retirement is refused "before anything is built or read", and the retired refusal needs no parameters. Yet publicBuild and publicAgainBuild refuse it only after publicReady, settleMaybeSent and readAccount, and mixOutBuild and againBuild read the epoch parameters first. Nothing is built, and the screens never ask it of a retired pool.
- **Scenario:** A stale or crafted `lovejoin-mix-public-build` naming no pool asks Koios for `epoch_params`, `account_info`, `account_addresses` and `credential_utxos`, then says the pool is retired.
- **Evidence:** In `tests/retire-scratch.test.ts`, "a mix from the public account into the classic pool reads the account before it's refused" passes, and logs those four paths before each of the two refusals.
- **Fix:** `if (isRetired(into)) throw new Error(unusableReason("retired"))` right after `poolNamed` in both, and before the parameters' read in sessions.ts where the pool is named.

## Covered

- **`isRetired`, `retiredOf`, `adaPoolOf`.**
  - Retired means the classic pool, plus every pool whose verified view isn't `v2`, copies included. A v2 copy isn't retired: it still takes Mix again, not a new box.
  - Mutations: M21 (`isRetired` = classic only) and M22 (`adaPoolOf` without `!isRetired`) are killed by `lovejoin-retired`.
  - `verifiedPool` sets `version` from WebAssembly's view every worker lifetime, never from discovery's stored copy.
- **Every way a box goes into a pool asks first.** Each was traced:
  - The private Mix: `mixOutBuild` → `fits` → `takesNewBoxes`, before the pool read.
  - The private Bootstrap: `privateBootstrapMost`.
  - The private Mix again: `againBoxes` → `takesNewBoxes(again)`. The retired check runs before the copy rule.
  - The public mix and public Bootstrap: `publicBuild`, after the account read (retire#7).
  - The public Mix again: `publicAgainBuild`.
  - A private session's return: `chain()` with no pool goes to `adaPool`, v2 only, with `sess.skip.warn.noAdaPool` when there's none (tested).
  - A mix session's chain: `chain()` → `poolNamed` → `takesNewBoxes`. sessions.ts names a 1.7 mix with no pool the classic pool's (mutation M29 is killed). A 1.7 Mix again's chain is retire#3.
  - A swap's price: `priced` → `adaPool`, and with none, nothing is paid for and it says why.
  - A swap's or a return's token: `poolsOf` and `usable` filter retired pools (M25 killed). `acrossOf`'s `tokenPools` filter does too; its mutation M26 survives, but `works` refuses through `usableNow`, so only the review's skip words change.
  - The session collateral's mix: `collateralPool`/`collateralPoolTakes` → `adaPoolOf`. Its tail: `tailChain`'s guard (retire#3) and retireOnce's `tails`.
  - `funding`'s tail: `adaPoolOf`. A seed: none left but a 1.5 record's, refused at its chain. A launch puts no box.
  - `lovejoin-funding` with no pool only prices. `room()` with no pool goes to `adaPool`, with no caller left.
- **Where a request still names no pool.** The build paths refuse one with the retired words: `fits`, `againBoxes`, `privateBootstrapMost`/`Bounds`, `publicBuild`, `publicAgainBuild`, and `chain(again)`. The others are not deposits: `funding` (pricing), a return's `chain()` (→ `adaPool`), `withdrawNow` and `bringAllBack` (every pool), and `releaseBootstrap` (classic).
- **`usableNow` and `takesNewBoxes`.** Both answer `retired` first, with no parameters read; M23 and M24 are killed. `usable()` returns `[]` before reading parameters when every pool is retired. Its M11 survives, but costs only a parameters read the swap's review already had.
- **`status()`.** The classic pool is always `unusable: retired`, and a retired token pool is listed only while `stillIn`. M28 is killed. The `unusable` branch for a retired pool (M27's area) is equivalent: a retired pool's `again` is never `belowMinimum`.
- **retireOnce.**
  - It runs at every `withdrawDue` run until it fires.
  - It writes nothing for a wallet with nothing retired (M20 killed).
  - It fires once a network. Both of its guards removed is killed (M19c). Each alone is redundant: M19 and M19b survive, a race guard.
  - It lets Bootstraps go and ends tails (tested). It asks the run over the retired pools alone, and never a v2 pool's (tested).
  - The schedule's read keeps `retired` (fix 007678a7): M31, dropping it from `read()`, is killed by two tests.
  - `read()` keeps `bringing.retired` (a spread) and `bringStopped.retired`. Nothing on the screens reads `bringStopped.retired` or `.pool`: the follower uses the run it saw, so M8 and M9 surviving is harmless.
  - The precondition traced through `stillIn`: classic due times, counts, open entries, chain records, a withdraw.
- **bringAllBack and bringAllBackNow.**
  - While the retired run goes, a v2 page's ask is refused and a retired page's joins it. Every pool's widens it, deleting `pool` and `retired`. M17 and M18 are killed.
  - `covered`/`inScope` never take a v2 box (tested). Stop records `retired` in `bringStopped`. The counts (`left`, `back`) count retired boxes alone. `bringSays` writes onto the current record, so a widen meanwhile isn't undone.
  - Lock, unlock and a restart: the record is sealed and the run goes on at the unlock's run. The owner accepted no unlock delay.
- **Nothing held in a retired pool.**
  - The scheduled withdraw skips `made()` there (M16 killed).
  - `moreThanDue` with `retired` matches sortOut's `sending`.
  - In `found()`, `old.has(p)` only makes Koios be asked about unknown boxes there, whose answer is ignored. M14 survives; the asks are no more than before 1.8.0.
  - sortOut's unschedule filter (M12) is equivalent: `keep` counts those boxes as free.
  - Bring one back now: nothing is held but a chain's box still being sent, which chainsMixing refuses anyway.
- **Can a box in a retired pool never come back, or come back twice?** I found none of either:
  - Every retired box is free unless a chain sends it, and gets a due time at the next read (scheduleFound).
  - The run ends only once nothing it took is left (made-since boxes keep due times).
  - Withdraws and runs share `inTurn(withdraw.<network>)`.
  - An 8131b1d pool stays in the read set (head start, the data layer's rule, sealed copies).
  - A stuck token box falls back to paid, as before.
- **Withdraws still go in every retired pool.** The classic pool and PR #163's 8131b1d token pool are covered by the suite's tests. An 8131b1d ADA pool (1.7's 5 ₳) is covered by a scratch test: "brings back a box of 1.7's 5 ₳ pool at the first run". An 8131b1d copy goes through the same `poolRef` path, by reading. `withdrawOne` has no retirement check.
- **How it meets the rest.**
  - Several networks: runs.ts runs `withdrawDue` on every network. Several accounts: the run takes every account's boxes, as 1.6.0's every-pool run does.
  - Remove wallet and restore: the record goes. retireOnce fires again once a read names something retired, as the plan's preprod run saw.
  - A second device: its own record. A late fire's v2 side is retire#4, a 1.7 run left going is retire#0.
  - The sessions runner comes before `withdrawDue` (retire#1, retire#3).
  - A held box and a chain being sent: the run waits in words.
- **Accepted consequences.** A retired pool's unmixed boxes come back by themselves, and so do a released public Bootstrap's or seed's, and that ties the deposit (and its public account) to the private balance with no question asked. That follows from the owner's 2026-11-06 call ("mixed or not"), so it isn't a finding. privacy.md's update is 44d's.
- **The preprod-only build and the types.** `VITE_ENABLE_MAINNET=false` passes `lovejoin-retired` plus the scratch file (31/31, as the default build does), and `npx tsc --noEmit -p .` is clean.

## Not checked

- The screens beyond what the worker hands them (BringAllBack.tsx's follower, Lovejoin.tsx's hub and pool page), and the e2e. Only the button path in retire#2 was read.
- The words and their es/ja values. That includes the frames of the reasons saved with a session (`sess.skip.warn.noAdaPool` and `lj.unusable.warn.retired` in `lovejoin.warn.skippedIts`), which the words lens owns.
- 44b's 5 ₳ pool sharing (`roomIn`, `holdTail`, `tailRows`, crossCheck's `!t.tail`) and 44a's derivations, the data layer and the WebAssembly.
- The real-extension race between Home's `held` (cuts) and the first run's `withdrawDue`: retire#1 is shown in the order where withdrawDue comes first, not measured in Chrome.
- `madeSince` is pool-blind, so a v2 chain recorded during the retired run can make it skip a retired box someone else's mix moved. That box keeps its wait. This is older 1.6.0 logic and not traced further.
