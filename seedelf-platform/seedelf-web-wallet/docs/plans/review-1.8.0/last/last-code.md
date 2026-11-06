# 1.8.0's release review, the last look: last-code

*Written by the lead from the reviewer's and tracers' structured outputs (workflow `wf_ff09b08c-b06`).*

## last-code#0: collateralRoom, round two's review-time copy of collateralPool's rule, has its floor and its ask held by no test

**Severity:** low · **Trace:** CONFIRMED

**Where:** seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4324, seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4330, seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4824

**Claim:** r2-worker#1 moved every review's collateral look that has no draws (a swap's Review, a site's funding review, a top-up) from collateralPool onto the new collateralRoom. collateralRoom re-implements collateralPool's rule, and two of its guards are load-bearing but unpinned: its ask, `adaPool(network, true)` (:4324), and its floor, `floorShort` (:4330). Dropping either one passes every review test. collateralPool's own copies are still pinned through the build, so the review copy can drift from them unseen. Introduced: new (round two).

**Scenario:** Floor dropped: on mainnet, v2's 5 ₳ pool is kept but under its floor of 30. That is its state from the owner's launch until 30 other boxes are in it (call 4). A swap's Review selling MIN for ADA then reserves 1.5 ₳ and says collateralMix "mixed": the Plan reads "its 5 ₳ collateral in a Lovejoin box, later" and shows a mix-cost row, right beside its own skipped reason "…holds 20 boxes that aren't yours, under the 30 it needs". A site's funding review reserves 2.8 ₳. Under the floor, both returns bring the 5 ₳ back directly. Ask dropped: on a device that hasn't kept the pool yet (mainnet's head start bundles no v2 pool), the first site funding review reserves nothing. lovejoinRoomNow's later ask then finds the pool and marks the review, so it shows the critical dappUi.back.privacy.noteLovejoin: "The rest and the 5 ₳ kept aside come back at once". Meanwhile the return's collateral pick mixes that 5 ₳ if enough is left. The merged code is right in both states; only the tests miss them.

**Evidence:** How the mutants ran: exact replacement, then each file restored and checked by sha256. Runner: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/last-code-work/last-code-mutate.py. Specs: last-code-cross.json and last-code-cross2.json. Logs: logs/last-code-x2-*.log and logs/last-code-x3-*.log, all in that folder. Each run is `npx vitest run <files> --maxWorkers=2` in the sandbox's extension/.
x2 replaces `if (this.floorShort(network, room.others) || room.free < TAIL_DRAWS) return undefined;` with `if (room.free < TAIL_DRAWS) return undefined;`.
- The 10 review files (collateral-reserve-review-fixes, connector-lovejoin-review-fixes, lovejoin-share-review-fixes, lovejoin-round2-sessions, swap-lovejoin-way, lovejoin-found-later, run-traps-review-fixes, lovejoin-chain-review-fixes, lovejoin, approvals-review-fixes): 273 passed (273).
- The 9 other files that name the floor (i18n-worker-reasons, lovejoin-planner, lovejoin-screens-review, screens, worker-words, sessions, lovejoin-1-5-0, session-collateral, dapp): 356 passed (356).
x3 changes collateralRoom's `this.adaPool(network, true)` to `this.adaPool(network)`. It gives 273 passed over the 10 review files, and 372 passed over those 9 files plus lovejoin-retired.
Scratch test tests/last-code-floor-review.test.ts uses lovejoin-round2-sessions' harness, wired as sw.ts wires the services. Clean, its 3 cases pass.
- Under x2: `expected '2800000' to be undefined`. Its log shows the review as {reserve "1500000", mix "mixed", skipped "…under the 30 it needs"}.
- Under x3: `expected {…} to match object { collateralReserve: '2800000', … }`. Its log shows the site review as {room: true} only.

**Fix:** Pin both in lovejoin-round2-sessions.test.ts's r2-worker#1 describe, using the scratch's first two cases:
- Preprod's floor set to 30, 20 strangers' boxes, the pool kept: a site's funding review and a MIN-for-ADA swap's Review reserve nothing and carry no collateralMix.
- Nothing kept, the pool at the holder: a site's funding review reserves 2.8 ₳, says "ifLeft" and marks lovejoinRoom.
Better still, give collateralRoom and collateralPool one shared predicate for the floor and the mix's two draws, so the two copies can't drift.

**Trace, reach:** Only the tests have the gap. The merged code is right in both states. The finding's severity (low: a new guard no test pins) and its "new" both stand: collateralRoom arrived in 6ed11342 (round two). At 4b4628e9 every review's look was collateralPool's (sessions.ts:4807 there).

Both states are reached in normal use:
- **Floor:** mainnet, from the 5 ₳ pool's launch until it holds 30 other boxes (call 4).
- **Ask:** a mainnet device that hasn't kept v2's 5 ₳ pool (its head start bundles none). The ask decides at that device's first site funding review, or at a top-up that adds a new collateral, because tailReserve asks first there. It never decides at a swap's Review: priced asks first (sessions.ts:1796), so the ask in collateralRoom is redundant there. The finding claims the ask only for the site review, which is right.

On preprod the floor is 0 and the head start bundles the pool, so by default neither guard decides anything.

What a later edit dropping either guard would ship, unseen by any test:
- **Floor dropped:** a review under the floor sets aside 1.5 ₳ (swap) or 2.8 ₳ (site or top-up), which comes back with the change. It says the collateral is mixed: "mixed" plus a mix-cost row on a swap selling a token for ADA, "ifLeft" on a site review. The return brings the 5 ₳ back directly.
- **Ask dropped:** the site review shows the critical dappUi.back.privacy.noteLovejoin ("The rest and the 5 ₳ kept aside come back at once"), while the return mixes that 5 ₳ if enough is left.

1.8.0 as merged ships none of this.

**Trace, trace:** Line numbers are at merged HEAD 4ad4dc06.

1. **The split.** sessions.ts:4815 tailReserve, then :4824–4826: with no `draws` it calls lovejoin.collateralRoom, with `draws` collateralPool(…, true).
   - Callers without draws: outBuild :1906, siteOutBuild :2015 (direct), topUpBuild :2343 (direct, new collateral only).
   - The caller with draws: the mix's review, :2226.
2. **collateralRoom**, lovejoin.ts:4322:
   - :4324 adaPool(network, true)
   - :4325 usableNow
   - :4326 rooms()
   - :4327 "failed"
   - :4329 a kept map without the pool → collateralPool's fresh split
   - :4330 floorShort(network, room.others) || room.free < TAIL_DRAWS
3. **The ask.** adaPool (:4180) returns the kept pool. With `ask` it then tries readSet() (the data layer's list on mainnet), then lookSoon (Koios's holder).
   - siteOutBuild runs tailReserve (:2015) before lovejoinRoomNow (:2018), whose own ask (:2069) finds the pool second. So under x3 the reserve is gone but `lovejoinRoom` is still marked.
   - topUpBuild makes no other ask.
   - outBuild's priced asks first (:1796).
4. **The floor.** floorShort (:3482) compares against poolFloor: 0 on preprod (networks.ts:56), 30 on mainnet (:71). Nothing else at a review stops the reserve:
   - lovejoinRoomNow's poolShort only sets `lovejoinRoom`;
   - priced's `skipped` only sets the words;
   - outBuild's asked() drops the reserve only on tailUnpaid (a token fill against the pools with no box).
5. **The words.**
   - DappApprovals.tsx:496–503: `lovejoinRoom` without `collateralMix` gives noteLovejoin.
   - Swaps.tsx Plan: `collateralMix` "mixed" with no box gives swaps.plan.backDirectMixed ("…its 5 ₳ collateral in a Lovejoin box, later"). keepsReserve is true where tokenOut is lovelace (sessions.ts:1994).
6. **The build.** A return's collateral pick is collateralPool at sessions.ts:4546, with its own ask (lovejoin.ts:4301) and floor (:4305). So under the floor the 5 ₳ comes back directly, as the scenario says.

**Trace, evidence:** **Method.** No source was mutated. The sandbox's src was clean against HEAD before and after, and identical to the merged tree by sha256.
- `tests/trace-last-code-0-patch.ts` puts a copy of collateralRoom (or collateralPool) on the prototype in a root beforeAll, so vi.mock in a target is unaffected. TRACE_LC0 picks the mode:
  - `probe`: a faithful copy with counters;
  - `x2`: the floor dropped;
  - `x3`: adaPool(network) for adaPool(network, true);
  - `x4`: usableNow dropped;
  - `cpfloor`, `cpask`: collateralPool's own floor or ask dropped.
- 55 wrappers imported each target. They are now in /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/trace-last-code-0-wrappers/; the logs are in …/scratchpad/trace-last-code-0-logs/.

**Positive control:** the reviewer's last-code-floor-review under the patch.
- probe: 3 passed.
- x2: `expected '2800000' to be undefined`. The swap Review is {reserve 1500000, "mixed", skipped "Right now Lovejoin's pool holds 20 boxes that aren't yours, under the 30 it needs"}.
- x3: the site review is {room:true} only, and `to match object { collateralReserve: '2800000' … }` fails.

**Every reachable unit file, 52 of them:** each file that names siteOutBuild, outBuild, topUpBuild, collateralRoom or privateBuild, or the RPCs session-out-build, session-top-up-build or dapp-private-build; each importer of swap-session.ts (which calls outBuild); plus the reviewer's 20. 32 of these the reviewer didn't run. `TRACE_LC0=<m> npx vitest run <52> --maxWorkers=2`:

| Mode | Result |
|---|---|
| probe | 52 files, 1092 passed |
| x2 | 1092 passed |
| x3 | 1092 passed |

The probe's counters show where each guard decides:
- The floor decides 5 reviews: the connector's :206 (two), lovejoin.test's :2526 (two), found-later's :717 (one).
- The ask decides 1: the connector's :199.
- usableNow decides 1: the connector's :224.

x2 reserved in exactly those 5 reviews ("roomed" 58 → 63), and x3 dropped exactly the one (58 → 57). None of those tests asserts the collateral.

**e2e** (read, not run):
- extension.spec.ts :5326 and :5426 run on preprod (floor 0) with the bundled pool kept.
- :6107 (mainnet, the pool found later) builds the funding review with nothing kept, but asserts only the return's review and one holder read. Under x3, lovejoinRoomNow's ask makes that read instead.
- No e2e can tell either mutant.

**The sub-claim, over 13 files.** collateralPool's own copies are pinned through the build:
- cpfloor: 1 failed, found-later :457 (`collateralTail` not undefined).
- cpask: 3 failed, found-later :312, its mainnet twin, and lovejoin-retired :214.

**Assertion-only copies of existing tests:** tests/trace-last-code-0-connector-pins.test.ts and tests/trace-last-code-0-lovejoin-pins.test.ts. They pass on the merged code on both builds.
- x2 fails the connector's :206 (`expected '2800000' to be undefined`) and lovejoin.test's :2526 (`expected '1500000' to be undefined`).
- x3 fails the connector's :199 (`expected undefined to be 'ifLeft'`).
- x4 fails the connector's :224 (`expected '2800000' to be undefined`).
- With VITE_ENABLE_MAINNET=false, the finding's own two cases fail under x2 and x3 too.

**Aside:** x4 is the same gap at a third guard, which the finding leaves out. The reviewer's own x4 run survived. It's reachable only where a 5 ₳ box is under the ledger's minimum (`belowMinimum`), so it's an edge case.

**Trace, fixJudgment:** Right, and either form works.

**The finding's pins.** Its two cases pass on the merged code on both builds and fail under x2 and x3. lovejoin-round2-sessions already restores both floors in a root afterEach and has a head start without v2 pools, so they fit the r2-worker#1 describe as written.

**A smaller fix of the same strength.** Add assertions to existing tests that already build these states and whose titles already promise them:
- connector-lovejoin-review-fixes "a pool under the network's floor (mainnet's 30, set on preprod): hedged" (:206): `collateralReserve` and `collateralMix` undefined. Kills x2 at a site's review.
- lovejoin.test "reads the pool at Review alone… under its floor" (:2526): the same on `out`. Kills x2 at a swap's Review. It shows "ifLeft" rather than "mixed", since it buys a token.
- The connector's "a pool discovery hadn't kept, found as Review asks for it…: marked" (:199): `collateralMix` "ifLeft" and `collateralReserve` "2800000". Kills x3.
- The connector's "a pool that takes no new box now (usableNow): hedged" (:224): the same two lines as :206. These pin x4 too, which the finding's cases don't.

Every one of these is verified to fail under its mutant.

**The shared predicate** is a complement to the pins, not better than them:
- A predicate for the floor and TAIL_DRAWS keeps the two copies' rule in step, but leaves out the ask and usableNow, the guards they also share.
- collateralRoom could still drop its call to the predicate unseen, so the pins are still what holds the guards.
- If it's done, it should share the whole precondition (ask, usableNow, floor and TAIL_DRAWS over {others, free}), and the pins should stay. It touches the build's collateralPool, so it belongs on the backlog rather than at the gate.

## last-code#1: The retire lane's read times after a Stop, which its report hands the privacy entry, are held by no test: a plain Stop's read, and the run's own stop's, stay two hours on

**Severity:** low · **Trace:** CONFIRMED

**Where:** seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:6980, seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:7239

**Claim:** r2-critic#0 rewrote both Stops as `Math.min(s.recheck ?? Infinity, now + SPENT_KEEP_MS)`. The `?? Infinity` is what keeps every other Stop's read at SPENT_KEEP_MS. fix2/retire.md's *Requests a flow makes* says exactly that for the 6 November policy entry: "Every other Stop: unchanged, one read at the stop plus SPENT_KEEP_MS". Written `?? 0`, every Stop reads every pool at the next alarm minute instead, and no test notices. The existing Stop tests check only that a dropped withdraw's box gets its due time back, which it still does. Introduced: new (round two).

**Scenario:** Every pool's Bring every box back sends one withdraw, which lands. Then the user presses Settings' Stop, or the run stops itself after three runs that sent nothing. Merged: the pools are read once, 120 minutes later. With `?? 0`: they are read at the very next minute and not at 120, a pool listing tied in time to the Stop press, which the policy entry is being written to say doesn't change.

**Evidence:** x12 changes `?? Infinity` to `?? 0` at :6980, and x13 does the same at :7239. Each gives 173 passed (173) over the 14 Bring/retire files: `npx vitest run tests/{lovejoin-round2-retire,lovejoin-bring-review-fixes,lovejoin-crediting-review-fixes,lovejoin-bring-all-back,spent-clock-review-fixes,lovejoin-retire-review-fixes,lovejoin-retired,unlock-waits,lovejoin-due-times,lovejoin-withdraw-submit,withdraw-resend-unlock,lovejoin-own-wait,lovejoin-bring-screen-review-fixes,home-review-fixes}.test.ts --maxWorkers=2`. Logs: logs/last-code-x12-stop-reads-at-once.log and logs/last-code-x13-ownstop-reads-at-once.log.
Scratch test tests/last-code-retire-reads.test.ts counts pool listings minute by minute for 3 hours. Clean, all 4 cases pass:
- the retired run's Stop, its withdraw landed: reads at [1];
- the same with Koios behind until minute 30: [1, 121];
- a plain Stop: [120];
- the run's own stop: [120].
Under x12: `expected [ 1 ] to deeply equal [ 120 ]` (the plain Stop). Under x13: the same failure, for the own stop. The lane's own norearm mutant fails it too: `expected [ 1 ] to deeply equal [ 1, 121 ]`. Logs: logs/last-code-x12-scratch-assert.log, logs/last-code-x13-scratch-assert.log and logs/last-code-r-norearm-scratch-assert.log.

**Fix:** Adopt the scratch's four cases into lovejoin-round2-retire.test.ts's r2-critic#0 describe. They hold the read times the retire report gives for the policy entry, kill x12 and x13, and give norearm a second kill.

**Trace, reach:** Real, reachable in normal use, low. It's an untested default and the merged code is right: a plain Stop and the run's own stop both read the pools once, at +120 minutes.

**What the gap covers.** It covers the `?? Infinity` default in two lines of lovejoin.ts:
- `stopBringingAllBack` at :6980;
- `bringNoted`'s own stop at :7239.

That default decides the read time for every Stop where a run sent at least one withdraw and no read was owed yet. That means Settings' Stop or a pool page's Stop of every pool's run or one pool's run, and the run's own stop after BRING_FAILED_RUNS runs that sent nothing.

**The claim needs two small corrections:**
- **"Every Stop" is too broad.** A Stop after a run that sent nothing (`back` 0) never writes `recheck`, so neither mutant changes it.
- **"Instead" holds only when every withdraw has landed by the next minute.** Then the single read moves from +120 to +1, with the same number of reads. If one is still listed (Koios behind, or a node dropped it), x12 adds a read rather than moving it: `[1, 121]` against `[120]`. The dropped box still gets its due time, a minute later. So the old Stop tests stay green, as the finding says.

**The title's first clause is too broad.** The retired run's own read times are already pinned:
- the read at the next run: lovejoin-round2-retire.test.ts:161, :179, :219 and :234, which kill `stop`, `own-stop`, `nullish` and `released`;
- the re-arm while a withdraw is held: :194, which kills `norearm`.

Only the report's line "Every other Stop: unchanged, one read at the stop plus SPENT_KEEP_MS" is unpinned.

**Is it new?** The default is new in round two: commit 77f60757 added it. Before that, 1.7.2 (6b70c1f8), a6c94743 and 4b4628e9 all wrote a plain `now + SPENT_KEEP_MS`. The property it carries, a +2 h read after a Stop, dates from 1.6.0 (wlj-2) and was never pinned to the minute. The old tests jump SPENT_KEEP_MS in one step after the Stop, so they can't tell a read at +1 from one at +120.

**The realistic slip** is copying retireOnce's form from :4269, `Math.min(s.recheck ?? now, now)`, into the Stops. That reads at once, just like `?? 0`.

**Privacy weight under the mutant:** one pool listing (the same for everyone, naming nothing of the user's) a minute after the Stop, or one extra listing. That's small. The 6 November entry (privacy-policy.md:93) says nothing about reads after a Stop, and that silence is only true while this read stays at +2 h.

**Trace, trace:** **How the Stop sets the read time:**
- Both Stops write `s.recheck = Math.min(s.recheck ?? Infinity, now + SPENT_KEEP_MS)`. This is lovejoin.ts:6980, guarded by `if (s.bringing?.back)`, and :7239, guarded by `if (b.back)` inside `b.fails >= BRING_FAILED_RUNS`. SPENT_KEEP_MS is 2 h (spent.ts:33).
- On a plain run, `recheck` is undefined at the Stop, so the read is owed at +2 h.
- With `?? 0`, `Math.min(0, now + 2h)` gives 0, so `withdrawDueNow`'s `recheck <= now` holds at the very next run and `ours()` reads every pool then (:6619–6636).
- At that read:
  - If the withdraw has landed, discovery drops its `counted` entry (:5873–5876) and `unconfirmed` no longer holds it, so `recheck` is deleted and nothing reads at +120.
  - If it's still listed and held as spent, `counted` has it (`dropWithdrawing` sets it for every withdraw with `w.bring`, :7547), so the read re-arms at now + 2 h and comes again at +121.

**Which tests can reach the two lines with `back > 0`:**
- Seven test files call `stopBringingAllBack`. Six are in the finder's 14. The seventh, lovejoin-found-later.test.ts:878–884, only Stops runs that never ran (`back` 0).
- The Stop message `lovejoin-bring-all-back-stop` appears only in screens-wiring-review-fixes, whose worker is mocked.
- Outside the 14, Bring every box back is also asked in:
  - handlers.test.ts, mocked;
  - run-traps-review-fixes.test.ts:282 and :300, which only trap with `back` 0.
- No other file drives the run's own stop.
- The e2e Stops all have `back` 0 (extension.spec.ts, the first-unlock test at :3680), or are a swap's Stop.

So every test that can reach either line is in the finder's 14, and x12 and x13 survive them all.

**What the old Stop tests assert.** The wlj-2 tests (lovejoin-bring-review-fixes.test.ts:673 and :696) jump `busyFor(t, SPENT_KEEP_MS)` after the Stop, so their first run after it is already at +2 h. They check only that the dropped box gets its due time, which it still does under the mutant.

**Trace, evidence:** **Not reproduced here.** I ran no source mutants myself, since this task forbids changing sources. For x12 and x13 against the 14 files I rely on the finder's logs. Their runner, /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/last-code-work/last-code-mutate.py, makes one exact replacement, runs, then restores and checks sha256.
- The x12 and x13 specs in last-code-cross.json are exactly `?? Infinity` → `?? 0` on the :6980 and :7239 lines.
- Both logs read `14 passed (14)`, `173 passed (173)`, with `restored: true` (last-code-work/logs/last-code-x12-stop-reads-at-once.log and last-code-x13-ownstop-reads-at-once.log).
- The scratch-assert logs show x12 failing the plain Stop (`expected [ 1 ] to deeply equal [ 120 ]`) and x13 failing the own stop with the same message. `norearm` fails the lagging case (`expected [ 1 ] to deeply equal [ 1, 121 ]`).

**My own runs, clean tree only.** I ran them in /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/last/last-code with sources untouched: `git diff` was empty and lovejoin.ts kept sha256 7a2f41c5… before and after, the same as the merged head. My copy is /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/last/last-code/seedelf-platform/seedelf-web-wallet/extension/tests/trace-last-code-1-retire-reads.test.ts. It holds the finder's four cases unchanged, plus three cases that write x12's or x13's exact post-Stop state into the store after a clean Stop. That state is `recheck: 0`, after first asserting the clean value `now + SPENT_KEEP_MS`. `read()` keeps `recheck` as a plain number (:7758), so the state matches what the mutant would write.

Command: `npx vitest run tests/trace-last-code-1-retire-reads.test.ts --maxWorkers=2 --silent=false` gives 7 passed (7). With `VITE_ENABLE_MAINNET=false` it also gives 7 passed (7). Read minutes:

| Case | Clean | Mutant's state |
|---|---|---|
| Retired run's Stop, withdraw landed | [1] | – |
| Retired run's Stop, Koios behind till minute 30 | [1, 121] | – |
| Plain Stop, withdraw landed | [120] | x12: [1] |
| Run's own stop | [120] | x13: [1] |
| Plain Stop, withdraw dropped | [120] | x12: [1, 121] |

In the dropped case the box gets its due time either way: 2 boxes shown, `next` set, a minute later under x12.

Logs: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/trace-last-code-1-run-default.log and trace-last-code-1-run-preprod.log in the same folder.

**The docs.** fix2/retire.md's *Requests a flow makes* says "Every other Stop: unchanged, one read at the stop plus SPENT_KEEP_MS". privacy-policy.md:93 (merged worktree) says nothing about reads after a Stop.

**Trace, fixJudgment:** **Sound and cheap; adopt it, with three adjustments.**
- **Cost and fit.** The four cases ran in about 3–8 s in both builds. lovejoin-round2-retire.test.ts already has every helper they use (`pooled`, `wallet`, `classicBox`, `heldBy17`, `givemeTakes`, `landed`, `CLASSIC_BOX`), so only `listings` and `minutes` need adding.
- **Merge into that file.** The typecheck covers tests with `noUnusedLocals`, so committing the scratch file as is would fail on its unused imports.
- **Clean up.** Drop the `console.log` lines, and write the minute marks from `SPENT_KEEP_MS / 60_000` (and +1) rather than the literals 120 and 121.
- **Which cases matter.** Cases 3 (plain Stop) and 4 (own stop) are the ones that close this finding: they kill x12 and x13. Cases 1 and 2 are optional extras:
  - Case 1 pins that no second read comes once the withdraw has landed.
  - Case 2 kills `norearm` a second time; it's already killed at :194.
- **One wording fix to the fix.** "They hold the read times the retire report gives" is wider than the cases reach. The finder's x5 mutant re-arms for any held box, not only the run's withdraws (`if (unconfirmed.length)`). It passes all four cases (last-code-x5-scratch-assert.log: 4 passed) as well as the 14 files. So the report's "only while one of that run's withdraws is still listed and held as spent" stays unpinned and needs its own case if it's to be held.

## last-code#2: Round two left an older pin half vacuous: the 'read failing' case at collateral-reserve-review-fixes:1219-1227 no longer reaches tailReserve's failed look, so fx-may's "no" is held by no test

**Severity:** low · **Trace:** CONFIRMED

**Where:** seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4833, seedelf-platform/seedelf-web-wallet/extension/tests/collateral-reserve-review-fixes.test.ts:1219, seedelf-platform/seedelf-web-wallet/extension/tests/collateral-reserve-review-fixes.test.ts:1227

**Claim:** The sub-case keeps a read of the pool with one stranger's box, so collateralPoolTakes says "no". It then makes the pool's reads fail and expects a swap's Review to say nothing of the collateral's mix: "nothing said, the read failing or not". Before round two, the Review's collateralPool split failed, and fx-may's branch (`pool === "failed"`, then collateralPoolTakes "no", so no `may`) said nothing. Now collateralRoom answers from the kept read, whose 1 free box is under 2, and never fails. So the branch isn't reached any more: dropping its "no" passes every review test at HEAD, though it fails exactly this line at 4b4628e9. The branch is still reachable in two places: a review on mainnet where the data layer's last crowd count is under the floor and the pool's reads fail; and a mix's review (collateralPool, fresh) after a kept "no". The sub-case isn't empty: it's now the only test that catches collateralRoom's `room.free < TAIL_DRAWS` dropped (x1, 1 failed). Introduced: new (round two).

**Scenario:** Under the mutant, on mainnet: the 5 ₳ pool's last crowd count is 20 (under 30), the data layer's token feed is down, and Koios fails for the pool. A site's funding review then says the 5 ₳ may be mixed (collateralMix "ifLeft"), although the wallet's last word says the pool won't take it. Merged: nothing is said.

**Evidence:** x14 replaces `if (pool === "failed") return (await lovejoin.collateralPoolTakes(network)) === "no" ? { reserve: 0n } : { reserve: 0n, may: true };` with `if (pool === "failed") return { reserve: 0n, may: true };`.
- At HEAD, the 10 review files give 273 passed (273). Log: logs/last-code-x14-tell-no-dropped.log.
- At the base: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/last-code-work/last-code-at-base.py swaps 4b4628e9's sessions.ts and lovejoin.ts into the sandbox, then restores HEAD's and checks the sha256. Clean, the case passes (1 passed). Under x14 it fails (1 failed) at collateral-reserve-review-fixes.test.ts:1227:116 with `expected 'ifLeft' to be undefined` (logs/last-code-base-base-x14.log).
- The third case of tests/last-code-floor-review.test.ts (mainnet, crowd 20, reads failing) passes clean, logging site {}. Under x14 it fails with `expected 'ifLeft' to be undefined` (logs/last-code-x14-scratch.log).

**Fix:** Point the sub-case at a look that still fails, for example the scratch's mainnet crowd case, and correct its comment: with the read kept, nothing is read again. Or add the scratch case beside it, and keep the sub-case as collateralRoom's free-room pin, said so.

**Trace, reach:** It's real, and wider than the reviewer showed. The reviewer ran 10 files; I checked the whole committed unit suite. No committed test reaches tailReserve's failed branch (sessions.ts:4833) and gets a "no" back, so dropping that "no" (x14) passes every unit test at HEAD. The e2e reaches it nowhere either, though that rests on reading alone: its 503s are data-layer fallbacks to a Koios that answers.

The guard itself still works at HEAD; only its pin is gone. Two places still reach it, both edge states, and I showed both:
- Mainnet: the data layer's last crowd count for the 5 ₳ pool is under 30, and every read of the pool fails. This holds for a site's funding review, a swap's Review or a top-up: anything that looks without `draws`.
- A mix's review (mixOutBuild or againBuild, which do a fresh split) after a kept "no", on either network.

On preprod a review without draws can never get the "no": the floor is 0, so collateralPoolTakes skips the crowd check, and a failed look leaves no fresh kept read, so it answers "maybe".

Under the mutant, the cost is words only: a hedged "ifLeft" line ("mixed only if enough is left") said where the wallet's last word says the pool won't take the collateral. No money is at stake. Low, as filed; introduced in round two (r2-worker#1's collateralRoom, 6ed11342).

The aside is also right, across the whole suite: the sub-case is the only committed pin of collateralRoom's free check (x1).

**Trace, trace:** **HEAD's code:**
- tailReserve (sessions.ts:4815-4838) looks through `collateralRoom` unless it has `draws`.
- collateralRoom (lovejoin.ts:4322-4332) answers from rooms(), the kept read. It returns "failed" only where rooms() fails, and its fallback for a pool the kept map lacks throws into tailReserve's `.catch`.
- So only a failed look reaches :4833, which asks collateralPoolTakes (lovejoin.ts:4344-4355). That answers "no" from the crowd (lovejoin.ts:4349-4350, only when the floor is non-zero) or from a kept room read within POOL_ROOM_MS.

**The sub-case** (collateral-reserve-review-fixes.test.ts:1221-1227):
1. `lj.rooms("preprod")` runs before `fiveDown`, keeping `{others 1, free 1}`.
2. At outBuild, collateralRoom gets that kept map back from rooms(). The floor is 0, but `room.free < TAIL_DRAWS` (1 < 2), so it returns `undefined` (lovejoin.ts:4330).
3. tailReserve returns `{ reserve: 0n }` at :4834. Nothing is read again, and :4833 is never reached.

**At 4b4628e9,** tailReserve always called `collateralPool(network, read, undefined, true)`, a fresh split. With fiveDown that read fails (504), the look is "failed", and the kept read's free 1 gives "no", so nothing is said. That is the only way the sub-case ever held the "no".

**Trace, evidence:** I changed no source: the 481 tracked src/tests files in last/last-code equal the merged HEAD before and after my runs. Everything ran through instance spies, or through a line-for-line runtime copy of HEAD's tailReserve/collateralRoom patched in by wrapper files. Logs are in /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/trace-last-code-2-logs/.

**1. The sub-case:** `tests/trace-last-code-2-subcase.test.ts`, 6 passed (subcase.log).
- At HEAD:
  - collateralRoom answers `undefined`;
  - tailReserve calls collateralPoolTakes 0 times (the quote's one call says "no");
  - 0 reads of the 5 ₳ pool at Review.
- x14 emulated at HEAD (tailReserve's call answers "maybe"): `collateralMix` is still undefined.
- The base's look (collateralRoom answered by collateralPool(…, true)):
  - clean: the look throws a 504, tailReserve's call says "no", nothing is said;
  - plus x14: `'ifLeft'`.
- The draws path on preprod (the pool kept with one stranger, then grown, the collateral's look failing at mixOutBuild):
  - clean: "no", nothing said;
  - x14: `'ifLeft'`.

**2. The mainnet crowd case:** `tests/trace-last-code-2-floor.test.ts`, the reviewer's harness, crowd 20, token feed 503, Koios 500 (floor.log).
- clean: siteOutBuild's look is `["failed"]`, tailReserve's call says "no", nothing said;
- x14: `'ifLeft'`.

**3. Whole suite, record mode:** the faithful copy over the 56 committed files that reach a builder, plus the scratch (all-record.log).
- 57 files, 1157 passed, so the copy is faithful.
- tailReserve is called 438 times in 47 files and looks 152 times in 19.
- The failed branch is reached 10 times in 4 files:
  - collateral-reserve-review-fixes: 6, all "maybe";
  - connector-lovejoin-review-fixes: 1, "maybe";
  - run-traps-review-fixes: 2, "maybe";
  - the scratch: 1, "no".
- The other 205 files never reach tailReserve: none uses a builder, a builder's handler message, `privateBuild` or swap-session.

**4. x14 on those 4 files:** 1 failed, 70 passed. The one failure is the scratch, at last-code-floor-review.test.ts:313:32, `expected 'ifLeft' to be undefined` (failed4-x14.log).

**5. x1 over the 19 files that look:** collateralRoom is only called from that look. Result: 1 failed, 532 passed (533). The one failure is collateral-reserve-review-fixes.test.ts:1227:116 (looked-x1.log). The free check also decided twice in restore-scan, which doesn't catch the change.

The reviewer's logs agree: x14 at HEAD gives 273 passed; at the base x14 fails at :1227:116 and the clean run passes.

**Trace, fixJudgment:** Take the second option; the first is wrong:
- **Repointing loses a pin.** The sub-case is the only committed pin of collateralRoom's `room.free < TAIL_DRAWS`, so repointing it leaves x1 unpinned.
- **The swap Review can't be repointed on preprod anyway.** At HEAD a swap's Review there can never reach the "no".

**What to do:**
- Keep the sub-case as collateralRoom's free-room pin.
- Correct its comment. With the read kept, nothing is read: one free box is under the two draws. Only the R3-10 (Danogo) half's read fails. Its `fiveDown` is dead setup now.
- Add a case that reaches :4833 with a "no", choosing one of:
  - the scratch's mainnet crowd case, about 10 lines, in tests/lovejoin-round2-sessions.test.ts, whose `device()` already wires `facts` with discovery's crowds and the `covered` token feed;
  - a preprod mix-review arm in collateral-reserve-review-fixes' second fx-may test: `oneStranger`, then `lj.rooms`, then the strangers back, then the spy on collateralPool (my scratch's draws case).

Either one kills x14 (shown above).

## last-code#3: The hub's comment on `takes` says a pool below the minimum is counted as taking boxes, the reverse of the code beside it

**Severity:** nit · **Trace:** none (a nit)

**Where:** seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:1942

**Claim:** The comment reads "A pool that takes boxes: none that's `unusable`, retired, a copy or below the network's minimum, …; below the minimum counted as taking them (1.8.0's review of its fixes, r2-screens#3)." The last clause is meant as what the code did before r2-screens#3, but it reads as the present rule. `takes = (p) => !p.unusable` counts a pool below the minimum as taking none. Introduced: new.

**Scenario:** Someone maintaining the hub reads that a pool below the minimum takes boxes.

**Evidence:** Lovejoin.tsx:1941-1942 against :1948. The real behaviour is pinned by lovejoin-screens-review-fixes-1-8-0's r2-screens#3 case: the R3 mutant fails 2 tests on the merged tree (logs/last-code-c-R3.log).

**Fix:** "…; one below the minimum was counted as taking them (…r2-screens#3)".

## last-code#4: Share's P1 test is still named for the dialog r2-worker#0 fixed, and still doesn't hold the dialog's count

**Severity:** nit · **Trace:** none (a nit)

**Where:** seedelf-platform/seedelf-web-wallet/extension/tests/lovejoin-share-review-fixes.test.ts:465

**Claim:** The test is named "with 10, and with 16 where the chain makes one box of the dialog's two…". At 16 strangers, Stop's dialog now counts one box, as the return builds. The test never asserted the dialog's count, which is why it didn't catch r2-worker#0. It still doesn't hold the hold at depth 2 on a 1.7.2-style record. Introduced: new.

**Scenario:** A reader takes the name as a known gap between the dialog and the return; the gap is closed, and this test doesn't pin that.

**Evidence:** A probe copy (tests/last-code-share-probe.test.ts) adds one log line. At HEAD, 16 strangers give {dialog 1, built 1}. With 4b4628e9's sources swapped in (last-code-at-base.py, sha256 restored) they give {dialog 2, built 1} (logs/last-code-base-share-probe.log).

**Fix:** Rename it ("…16, where the chain makes one box, as the dialog says, to leave that mix its draws") and add `expect(cost?.boxes).toBe(back.lovejoin?.boxes)`.

## Covered

- Every fix against its trace (verify.md). r2-worker#0 is the trace's flag form: `price` and `leg` take `held` (fitsOf: roomLeavingTail or ⌊free/draws⌋); stopCost calls `price(counted, undefined, takes === "yes")`; priced returns its `room`; tailDrawn is a module function over that room at the counted width; the L1 sentence is corrected. The Review is unheld (P1).
- r2-worker#1 is the trace's snippet exactly: collateralRoom, tailReserve's `draws ? collateralPool : collateralRoom`, rooms()'s catch handing a trap on, and the missing pool read afresh. r2-worker#2: lovejoinRoomKept is quiet. r2-critic#0 is A+ as prototyped: Math.min in both Stops, the re-arm (equivalent to the trace's `mine`/`out` form), and `released` in retireOnce. The comments of r2-worker#3 and r2-critic#1/#2 match the code. r2-screens#1-#5, r2-tests#0-#3 and the e2e pin all match their briefs. The e2e pin equals en.json's new noteLovejoinMixed once whitespace is folded.
- Is anything left of a finding? Nothing beyond what's recorded as accepted:
- the trace's crowd-count edge, where Stop's dialog over-counts but "at most" holds;
- the Review's ifStopped, a forecast and unheld (the lead's call);
- a mix's review's two listings (by design).
- Lane pins re-run on the merged tree by exact replacement, each restored and checked by sha256. All killed:
- sessions: w0-hold-dropped (4 failed), w1-split-again in round2-sessions (2) and in the lead's re-pinned lovejoin.test.ts (2: `expected 2 to be 1`, `expected 4 to be 2`), w1-bare-catch (1), E1 (3), E2 (2), B3 (3, the 80 ₳ floor-30 case 7 against 6), w2-loud (1);
- retire: stop (3), own-stop (1), norearm (1), released (2), nullish (1), kept (1), scanned (1);
- screens: R3 (2), R4 (1), R5 (1), C1 (1), I1 (1).
Specs and results: …/scratchpad/last-code-work/last-code-lanes.json, logs/*.results.jsonl.
- Money. The trace's 51-state Stop sweep, copied to tests/last-code-stop-sweep.test.ts and run on the merged tree, gives 62 passed. Checked by …/last-code-work/last-code-sweep-check.py: Stop's dialog equals the sealed chain in boxes, width, mixes, and collateral word against tail in 51 of 51 states. The switch-off states agree too. The Review rows are unchanged from the trace's (a forecast).
- Requests, counted with tests/last-code-requests.test.ts (sw.ts wiring). Preprod, pool kept:
- a site's funding review: 1 listing with the collateral on or off, 0 for a second within 5 min;
- a swap's Review: 1, then 0 (quote 0);
- Stop's dialog after the list (the list reads 0): 1, 0 at once, 1 after POOL_ROOM_MS; the Stop press's return build: 2 listings with the collateral on, 1 off, build time and unchanged;
- the tile's Mix review: 2 with the collateral on, 1 off, every time;
- a site's top-up with a fresh collateral: 1, then 0 (2 epoch_params each, which is older).
With no pool kept, a site review makes 1 listing plus discovery's look. Mainnet, the data layer up and covering: a site review makes lovejoin/pool, /since, /tokens and /tokens/since once each, and 0 Koios. After a Stop of the retired run (tests/last-code-retire-reads.test.ts): a read at the next minute, then only at +2 h while a counted withdraw is still listed. A plain Stop reads at +2 h, as before. All of this matches fix2/sessions.md's table and fix2/retire.md's Requests.
- Traps, by reading. rooms()/room() are called by tokenPool, priced, lovejoinRoomNow (rethrows), lovejoinRoomKept (quiet, so it never calls rooms), collateralWanted (loud with `ask`) and collateralRoom (tailReserve rethrows). Up the chain, every caller hands a trap on: outBuild's catch counts isTrap among `mendable`, claimBuild rethrows it, bringBack and stopCost have no catch, and sw.ts answerUi locks the wallet. rooms()'s bare catch is killed by run-traps (on both switches and the top-up).
- Where the lanes meet. The recheck read is ours(), not rooms(), so it can't serve or stale a review's kept read. The hub's `takes` (!unusable) and `fiveOnly` match status()'s `unusable` (retired, superseded or belowMinimum; the classic pool is always retired). otherRetired matches bringAllBack's refusal while the retired run goes (`other()`), and the page's link is off then. The e2e first-unlock path never meets A+, since it has no 1.7 counts and no Bootstrap. The lead's three comments are accurate: roomLeavingTail's users, collateralPoolTakes' review/mix/build split, and Schedule.recheck's three writers. All writers of `recheck` were checked; only the re-arm moves a consumed read later.
- Cross-lane mutants of my own:
- killed: x6 (tailDrawn `<` to `<=`; 2 failed: round2-sessions (d) and share P1), x1 (collateralRoom's free check; 1 failed, see last-code#2);
- survived but practically equivalent: x4 (collateralRoom's usableNow). adaPoolOf takes v2's 5 ₳ pool, never a retired pool or a copy, and a 5 ₳ box below the minimum would need coinsPerUTxOByte about 3×;
- survived by the lead's call: x7 (the outer price's `held` default true, which holds only the Review's ifStopped; FIX2BRIEF keeps the Review a forecast).
- Checks. `npx tsc --noEmit -p .` shows no error outside my last-code-* scratch files. The 8 lane test files give 163 passed on the default build and 163 with VITE_ENABLE_MAINNET=false. The sandbox's tracked files are clean (git diff --quiet); only untracked tests/last-code-*.test.ts are left. No Rust or data-layer change in round two (git diff 4b4628e9 HEAD is empty there).

## Not checked

- The e2e lane's Playwright mutants (M1, M2/C1, C3, C4, W6) and its stress runs. No Playwright for this part. The new first-unlock test and the noteLovejoinMixed pin were read against the merged code and en.json only.
- x5 (the re-arm on any listed box held as spent, not only a `counted` one) survives the 14 Bring/retire files and my scratch tests. By reading, it differs only when a recheck read meets a Mix my boxes again chain that's all sent and still landing (one more read 2 h on). I didn't model that state, so it isn't reported.
- A swap's Review request count on mainnet. The harness's Minswap is preprod's (404 on mainnet), so this is by reading: one listing of 4 data-layer GETs.
- The whole suite. Only targeted sets ran: 10 to 20 files a mutant, plus the lanes' files on both builds.
- The docs and the es/ja values round two changed (the last-docs part). The privacy entry's wording against the request counts above is theirs to compare.
- Real Chrome: worker restarts, timers, and Date.now across awaits.
- An older edge I saw but didn't pursue. Where the kept rooms() map lacks a pool found since, a swap's Review still counts its ADA boxes unbounded by the room (priced's fits = Infinity), and a site review stays hedged. The collateral's look reads it afresh. This isn't new in round two.
