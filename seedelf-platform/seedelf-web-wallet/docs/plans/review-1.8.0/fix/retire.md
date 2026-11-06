# 1.8.0's release review: the retire lane's fixes

Lane **retire**: R1–R8, W2, critic#3, critic#5, and S3's BringAllBack half (screens#7, words#9).

- **Branch:** `review-1.8.0/fix-retire`, head `7d3dd4d00a0f763691b2fe9e171a8d95c80956b8`, two commits on `1beba3fb`:
  - `15d0875d` fix(web-wallet): 1.8.0's release review: the first unlock's bring-back and the retired pools
  - `7d3dd4d0` test(web-wallet): moved tests reach their own runs past 1.8.0's first (R6, R7)
- **Worktree:** `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/fix/retire`. Every command below runs from its `seedelf-platform/seedelf-web-wallet/extension`.
- **Files changed:** `src/background/lovejoin.ts` (`retiredIds`, `retireOnce`, `tailBuildable`, `tailBoxes`, `madeSince`, `bringAllBack`, `bringAllBackNow`'s call to `tailBoxes`, `held`'s comment, `publicBuild`, `publicAgainBuild`), `src/background/handlers.ts` (the `lovejoin-bring-all-back` case), `src/shared/rpc.ts` (its payload), `src/ui/components/BringAllBack.tsx`. Tests: the new `tests/lovejoin-retire-review-fixes.test.ts` (30 tests), and in my row's files `tests/run-traps-review-fixes.test.ts` (R6), `tests/lovejoin-restore.test.ts` and `tests/lovejoin-flows.test.ts` (R7).
- **No i18n key added or changed.**

**How each check ran.** The runner, its specs and their logs are in `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/retire-fix/` (`retire-fix/` below):
- *At the base:* the four source files checked out at `1beba3fb` (`git checkout 1beba3fb -- <them>`), then `npx vitest run tests/lovejoin-retire-review-fixes.test.ts --maxWorkers=2`, then `git checkout HEAD -- <them>`.
- *Fixed:* the same at the branch's head.
- *Revert and mutants:* `python3 -I retire-fix/mutate.py retire-fix/specs-retire.json [id]`. Each spec swaps one exact string (the fix reverted, or the finding's mutant), runs the test it names (`-t`), and puts the file back. Results: `retire-fix/runs-final.jsonl`.

The base run: **15 failed, 15 passed (30)**. The 15 that fail are the finding tests below, each failing for its finding. The 15 that pass are guard tests (R5, S3), whose check is their mutant, and three pins: a branch R1 keeps, the guard of critic#3's fix, and critic#5's control.

## R1 (retire#0, cross#3, screens#2, tests-unit#0): fixed

**What changed:** `retireOnce`, at the first run.
- A retired pool's run that 1.7 left going (a pool page's) is widened to the retired pools' run, keeping its `at`, `back` and the rest, as every pool's widens a pool's.
- Every pool's run is kept: it covers the retired pools already.
- A v2 pool's run going (only after a late first run: a second device's mix in a retired pool) decides nothing. `retired` stays unset, and the first run after it ends asks the retired pools' run (retire#0's second half).

**Tests:**
- "widens a retired pool's page's run to the retired pools', keeping when it was asked: …". At the base: `expected { at: 1799999940000, back: 1, …(2) } to match object { at: 1799999940000, …(2) }`: the run kept its pool, and only the token box came back; the classic box waited its own time. Fixed: passes. Revert `R1-widen`: caught.
- "leaves a v2 pool's run going as it is and retires nothing meanwhile: once it's over, the retired pools' run is asked". At the base: `expected 1800000000000 to be undefined` (marked retired while the v2 page's run went, and the classic box never asked). Revert `R1-defer`: caught.
- Pin, "keeps every pool's run 1.7 left going as it is: …": passes at the base and fixed.

Two pins outside my lane pinned the old rule (For the lead, 1).

## R2 (cross#0, retire#1, tests-unit#6): fixed

**What changed:**
- `retireOnce` calls `cuts` before it reads the chains, as `tailOf`, `status` and `held` do. A 1.7 chain cut while its collateral's mix waited in a retired pool is ended, and its tail is over at the first run.
- `tailBuildable` and `tailBoxes` take a retired predicate, and `bringAllBackNow` passes its read's retired pools. The run never leaves a box in a retired pool to a mix nobody builds there.
- `tailOf` and `tailHeld` are unchanged (not my functions): `tailChain`'s own `isRetired` still ends such a tail when it's asked.

**Tests:**
- "is marked cut before the first run retires the pools: its tail is over, its box comes back with the rest, and a v2 box's own withdraw never waits on it". At the base: `expected {…} to match object { cut: true, tail: { over: true } }`. Revert `R2-cuts`: caught. The test pins `over`, since the `tailBoxes` skip alone would still bring the box back.
- "never leaves a box in a retired pool to a collateral's mix there: Bring every box back takes it". At the base: `expected 'collateral' not to be 'collateral'`. Revert `R2-tailBoxes`: caught.

## R3 (cross#4, retire#6): fixed

**What changed:**
- `retiredIds` answers three ways. The classic pool, and a pool the quiet read set has that isn't v2, are retired; a v2 pool isn't. One the set lacks is **undecided** (`undefined`): every pool a record names was in the set once, and the set only grows, so a missing one says the read fell back.
- `retireOnce` decides nothing that run when any pool it would decide on is undecided: the schedule's, the list of mixes', the chains' and their tails', and a going run's. A later run decides.
- `bringAllBack` takes an undecided pool as not retired. A page's ask for one while the retired run goes is refused in words (`lj.bringOtherPool`), not joined, since that run may not cover it. This changes only on a storage failure.
- `held()` still marks a pool it didn't read `retired` (comment updated). `doneOf` then never says "Nothing of yours was left in the retired pools" while one may hold a box.

**Tests:**
- "decides nothing on a run whose read of discovery's record failed: nothing is retired, and a v2 Bootstrap stays held". At the base: `expected 1800000060000 to be undefined`. Marked retired, and the Bootstrap let go.
- "retires the classic pool at the next run that reads the pools, a v2 Bootstrap held all the same". At the base: `expected 1800000000000 to be undefined`.
- Revert `R3-undecided` (a missing pool read as retired again): caught, both tests.

One pin outside my lane pinned the old rule with a made-up pool id (For the lead, 1).

## R4 (retire#2, cross#9, screens#0): fixed

**What changed:**
- `lovejoin-bring-all-back` takes `retired?: true` (`rpc.ts`), handed on by `handlers.ts` (`message.retired === true`).
- `bringAllBack(network, pool?, retired)`, with no pool:
  - it starts the retired pools' run afresh, its last Stop said no more;
  - it widens a retired pool's run going to theirs, and keeps every pool's or theirs as it is;
  - it's refused in words while a v2 pool's run goes (or an undecided pool's).
- `BringAllBack.tsx`:
  - `bringAsk` makes Settings' Try again on the retired pools' stopped run send `{ retired: true }`;
  - the follower's press shows that run until the next read;
  - `settings.lovejoin.bringNote` ("Every box in every pool, without the waits.") isn't shown beside that Try again, since it would be false there.
- Unchanged: Settings' first press, and its button while a run goes, stay every pool's. A retired pool's page's Try again still asks its own pool's run: its question says "Bring this pool's boxes back now?", which the retired run would overstate.

**Tests:**
- Worker, "asks the retired pools' run again: the rest of their boxes come back, a v2 pool's keep their waits". At the base: `expected { at: 1800000120000, back: +0 } to deeply equal { at: 1800000120000, back: +0, …(1) }`: every pool's run, which brought the v2 box back too.
- Worker, "widens a retired pool's run going to the retired pools', and is refused while a v2 pool's goes". At the base: `expected { at: 1800000000000, back: +0 } to deeply equal { at: Any<Number>, back: +0, …(1) }`: widened to every pool's, and never refused.
- Handler, "is handed on by the worker's request, `retired` alone taken as it". At the base: `expected [ [ 'preprod', undefined ], … ] to deeply equal [ Array(3) ]`.
- UI, "is what Settings' Try again asks there, the page following that run, with no line on every pool beside it". At the base: `TypeError: bringAsk is not a function`; the component sent `{}` inline.
- Reverts: `R4-worker` (both worker tests), `R4-handler`, `R4-ask`, `R4-follower` and `R4-note`, each caught.

## R5: the untested guards, tested

Every test below passes at the base, and fails under its finding's mutant (all **caught**, `runs-final.jsonl`):

| Guard | Members | Test | Mutant |
|---|---|---|---|
| `chain()`'s `isRetired(into)` for a 1.7 Mix again | cross#1, retire#3, tests-unit#7, adapool#5 (1) | "brings a 1.7 Mix my boxes again session back directly, …" | `R5-chainAgain` |
| `tailChain`'s `isRetired` | cross#1, retire#3, adapool#5 (2) | "ends a 1.7 collateral's mix left to build in 1.7's 5 ₳ pool, …" | `R5-tailChain` |
| a stopped 1.7 run asked afresh, and its Stop's mark dropped | cross#2, tests-unit#1 (c, d) | "asks the retired pools' run afresh over a run 1.7 stopped, …" | `R5-stoppedAfresh`, `R5-bringStopped` |
| the release's `old(poolOf)`, the tails' `old`, the run end's `covered` | retire#4 (M4, M3, M6b), tests-unit#1 (a) | "fired late (another device's classic mix), lets no v2 Bootstrap go, …" | `R5-releaseEvery`, `R5-tailsAnyPool`, `R5-runEndCovered` |
| the tails trigger | tests-unit#1 (b) | "ends a collateral's mix left to build in a retired pool though nothing else …" | `R5-tailsTrigger` |
| `held()`'s `retired` mark | tests-unit#8, retire#4 (M10) | "marks a retired pool's figures retired on Home, never a v2 pool's" | `R5-heldRetired` |
| nothing held: a cut chain's box, Koios's word, a Bootstrap's | tests-unit#4, retire#5 (M13b, M13c) | "holds nothing in a retired pool: …" | `R5-sortOutUnmixed`, `R5-sortOutUnsure`, `R5-sortOutBootstrap` |
| Bring one back now, a deposit's box or one Koios can't say of | tests-unit#4, retire#5 (M7) | "brings one back now, with no box named, whatever made it there: …" | `R5-sortOutUntold`, `R5-withdrawNowOld`, `R5-withdrawNowMixed` |

Four of tests-unit#4's mutants survive, and stay so (`retire-fix/specs-equivalent.json`):
- sortOut's `sending` freed: unreachable on 1.8.0. Every 1.7 chain is cut, now before `retireOnce` decides, and 1.8.0 builds no chain into a retired pool.
- sortOut's unschedule filter: equivalent, as retire's covered says of M12 (`keep` counts those boxes free).
- `withdrawNow`'s held filter, and `moreThanDue`'s retired branch: they change only which boxes Koios is asked about first. `waits` drops the answer in a retired pool.

## R6 (tests-unit#5): fixed (test)

**What changed:** `run-traps-review-fixes.test.ts`' `dueBox` puts its record past 1.8.0's first run (`retiredAlready`). So "hands a trap in a box's withdraw on, in its own run and in Bring every box back now's" runs the scheduled withdraw when `bring` is false, and so does "keeps a withdraw sent as sent, …" (tests-unit#5's `:474`).

**Check:** mutant `R6-swallowTrap` (the scheduled withdraw's `if (isTrap(e)) throw e;` removed), `python3 -I retire-fix/mutate.py retire-fix/specs-r6r7.json R6-swallowTrap`:
- before the edit: **survived** (2 passed);
- after: **caught** (2 failed).

On the tree, both pass.

## R7 (tests-unit#10): fixed (test); the seed half explained

**`lovejoin-restore.test.ts`:** "asks Koios nothing new in its steady state" and "asks nothing while Mix my boxes again sends two of a steady-state wallet's boxes" are marked past the first run. Mutant `R7-forceAll` (the scheduled run asks Koios about every box): survived before (2 passed), **caught** after (2 failed).

**`lovejoin-flows.test.ts`'s seed half:** reworded, its title and comment, to say why the box comes back: a retired pool holds nothing, and a seed is in no other pool. Mutant `R7-holdSeeds` (seeds held as Bootstraps) survives before and after, by design.
- The rule is unobservable on 1.8.0: a seed exists only in a 1.5.0 record, in the classic pool, where every hold is filtered by `old`.
- The half still pins that a 1.5.0 seed's record, read on 1.8.0, gives its box a due time.

## R8 (retire#7): fixed in the worker; sessions.ts's half is the lead's

**What changed:** `publicBuild` and `publicAgainBuild` refuse a retired pool right after `poolNamed`, before `publicReady`, `settleMaybeSent` and the account's read.

**Test:** "is refused before anything is read: a mix, a Bootstrap and mixing again in the classic pool ask Koios nothing". At the base: `expected [ 'epoch_params', …(11) ] to deeply equal []`. Reverts `R8-public` and `R8-again`: each caught.

**Not done:** `sessions.ts`' `mixOutBuild` (`:2036`) and `againBuild` (`:2066`) read `epoch_params` before `fits` or `againBoxes` refuse a retired pool. They're in no lane's files (For the lead, 2).

## W2 (screens#3, words#2): fixed

**What changed:** `goingText` says the retired pools' run as theirs (`settings.lovejoin.bringingRetired`) on a retired pool's page too, never "every box in this pool".

**Test:** "a retired pool's page says the retired pools' run as theirs, with their count, never 'every box in this pool'". At the base: `expected 'Bringing every box in this pool back:…' to contain 'Bringing every box in the retired poo…'`. Revert `W2-goingText`: caught.

No key changed. es and ja's `bringingRetired` name the retired pools, and read right on a pool's page.

## critic#3: fixed, with a guard the critic's fix lacked

**What changed:** `retireOnce` drops each retired pool's `notMixed` and `unsure` (the classic pool's `notMixed` set to 0, as sortOut keeps it). Where it dropped any, it sets `recheck` to now, unless one is set.

**Why the `recheck`:**
- The counts are also the scheduled run's sign that a network has something open (`open`), and so what reads the pools at the next unlock.
- Dropped alone, a retired run that stops before it takes those boxes (Stop with nothing sent, or three runs that sent nothing) leaves them with no due time and no count. They'd come back by themselves only once the hub opens.
- The `recheck` reads the pools at the next scheduled run, and gives each its own wait. A Stop that sent something sets its own `recheck`, two hours on, as before.

**Tests:**
- "drops 1.7's count of boxes not mixed yet in a retired pool at once: Home never says they wait, while the run takes them nor after a Stop". At the base: `expected 2 to be +0`. Revert `critic3-counts`: caught.
- The guard, "has the pools read all the same where the run stops before it takes them: they come back by themselves":
  - it passes at the base, where the counts open the next unlock's read;
  - it fails with the counts dropped and no `recheck` (`critic3-recheck`: caught);
  - it passes with both.

## critic#5: fixed

**What changed:** `madeSince` passes over a box only for a chain that put boxes in its pool, or mixed its collateral there (`poolsOf`, plus the tail's pool).

The critic's fix had `poolsOf` alone. Then a return whose only Lovejoin part is its collateral's mix would let an every-pool run take a box that mix may have made since.

**Tests:**
- "takes a retired box someone else's mix moved after a v2 chain of the wallet's went: that chain mixes in no retired pool". At the base: `expected [ Array(1) ] to deeply equal [ …(2) ]`. Revert `critic5-pool`: caught.
- Control, "still passes over a box of a pool such a chain mixes in, its collateral's included: …": passes at the base, and `critic5-tailPool` (`poolsOf` alone) is caught.

## S3's BringAllBack half (screens#7, words#9): tested

**Tests:** five in "the retired pools' run on its pages", beside W2's. Each passes at the base, but one that uses `doneShown`, new here, which fails at the base with `TypeError: doneShown is not a function`.

**Mutants**, each caught (`S3-*`):

| Mutant | What it breaks |
|---|---|
| M10 | `coversRun` ignores `retired` |
| M11, M12 | the follower's end, over or stopped, drops `retired` |
| M13 | Settings' widen keeps `retired` |
| M14 | the retired run said as every pool's |
| M15 | Settings says "one pool" for it (words#9's first) |
| M16 | Settings' widen button gone while it goes |
| M17 | `doneRetired`'s words dropped (words#9's second) |
| M19 | `doneOf`'s classic pool not retired |
| M20 | the component's `done` drops `retired` |

M20 is in the component's effect. Its mapping moved into `doneShown`, a pure function exported for its test, as `doneOf` and `bringFollower` are. M18 was caught already (`lovejoin-retired`).

## Awaiting blind back-translation

None. No key was added or changed. Two existing keys change frames, neither critical:
- `settings.lovejoin.bringingRetired` now shows on a retired pool's page too (W2).
- `settings.lovejoin.bringNote` no longer shows beside Settings' Try again on the retired pools' stopped run (R4).

## For the lead

1. **Three pins outside my lane** test what R1 and R3 change. They fail on my branch, and pass with these edits, checked on throwaway copies: 3 files, 52 passed. The diff is also at `retire-fix/lead/lead-pins.diff`.
   - The two R1 tests are 1.6.0's tests of a pool page's own run. They now run past the first run, as 44b moved the others.
   - The R3 test gave its tail a made-up pool id, which is now undecided.

   ```diff
   --- a/tests/lovejoin-bring-all-back.test.ts
   +++ b/tests/lovejoin-bring-all-back.test.ts
   @@ -274,6 +274,8 @@
      it("from a pool's page brings back that pool's boxes alone: the other pools' keep their waits", async () => {
        const t = await wallet();
   +    // Past 1.8.0's first run, which widens a retired pool's run going to the retired pools' (retireOnce, R1).
   +    await retiredAlready(t.store);
        const lj = pooled(t);
   --- a/tests/lovejoin-bring-review-fixes.test.ts
   +++ b/tests/lovejoin-bring-review-fixes.test.ts
   @@ -719,6 +719,8 @@
      it("marks the stop with how many it sent and its pool, kept sealed through a restart, until it's asked again", async () => {
        const t = await wallet();
   +    // Past 1.8.0's first run, which widens a retired pool's run going to the retired pools' (retireOnce, R1).
   +    await retiredAlready(t.store);
        const lj = pooled(t);
   --- a/tests/lovejoin-retired.test.ts
   +++ b/tests/lovejoin-retired.test.ts
   @@ -318,8 +318,9 @@
      it("lets go of a Bootstrap's hold and a collateral's mix in a retired pool, and asks for their boxes", async () => {
        const t = await wallet();
   -    const lj = pooled(t);
   -    const old = "cc".repeat(28);
   +    // A retired pool the read set has: one it lacks is undecided, and nothing is decided then (1.8.0's release review, R3).
   +    const lj = pooled(t, [ADA_POOL, OLD_FIVE]);
   +    const old = (JSON.parse(loadTestWasm().lovejoinVerifyPool(JSON.stringify({ network: "preprod", pool: OLD_FIVE }))) as { id: string }).id;
   ```
2. **R8's sessions.ts half (a nit).** `mixOutBuild` and `againBuild` could refuse a retired pool before their `epoch_params` read. The screens never ask them of one, and nothing is built.
3. **Settings' question for the retired run's Try again** still reads "Bring every box back now?" (`settings.lovejoin.bringTitle`). It overstates, in the safe direction: only the retired pools' boxes come.
   - A title of its own would need a new key in en, es and ja, not critical, e.g. "Bring the retired pools' boxes back now?".
   - No i18n file is in my lane. The question's privacy note is right as it is.
4. **`retiredIds` is now `(id) => boolean | undefined`.** lows-b's W8 fix (the screens lane) builds `LovejoinChainView.retired` "by `retiredIds` or by R3's corrected rule": test `=== true` for retired, and decide what an undecided pool shows.
5. **critic#2 (yours at the merge):** `bringAllBack` is `(network, pool?, retired = false)` now. Its `retiredIds` read is quiet, so a look added there for critic#2 goes before it: the retired Try again then decides on the fresh set too.
6. **R1 keeps the widened run's `at`, as FINDINGS says.** One consequence: a box another retired pool got from a 1.7 chain sent between 1.7's page ask and the update counts as made since the ask (`madeSince`). It keeps its own wait rather than coming back at once. Setting `at` to now would take it; I followed the cluster's fix.
7. **`lovejoin-1-5-0`'s head-start case** fails identically with and without my change: its 85-line failure output is the same at the base and at my head, timings stripped. Its main case passes.
8. **e2e:** the Settings test at `e2e/extension.spec.ts:2969` asks the first press, where the note stays. Nothing in the spec drives a stopped retired run's Try again. The e2e lane's first-unlock probe meets none of my changes.

**Edits outside my lane I'd make:** item 1's three, and item 2.

## Checks run

- `npx tsc --noEmit -p .`: clean (exit 0) at the head; tests are in the project.
- **The new file:** `npx vitest run tests/lovejoin-retire-review-fixes.test.ts --maxWorkers=2`, 30 passed. At the base, 15 failed and 15 passed.
- **Every file my change can reach:** 90 files, run in five chunks by `retire-fix/reach.sh` (the list is `retire-fix/reach.txt`; `i18n-worker-reasons` and `worker-words` run in two chunks each, so 92 file runs). It covers:
  - the tests-unit lens's retired set;
  - every file that calls `withdrawDue`, `publicBuild`, `publicAgainBuild`, `bringAllBack` or `held`, or renders `BringAllBack`;
  - the tail and session sets;
  - `tests/i18n*.test.ts`, `tests/words.test.ts` and `tests/worker-words.test.ts`.
- **Default build:** 1350 test runs, 1345 passed and 5 failed.
  - Two are `lovejoin-1-5-0`'s head-start tests, the base's own (item 7).
  - Three are item 1's pins.
- **`VITE_ENABLE_MAINNET=false`:** the same 92 file runs, 1350 test runs: 1345 passed, and the same 5 failed.
- **Mutation runs at the head** (`7d3dd4d0`): 42 specs (`specs-retire.json`, log `runs-final.jsonl`), all caught. 3 R6/R7 specs (`specs-r6r7.json`, log `runs-r6r7-final.jsonl`): two caught, and `R7-holdSeeds` survives by design. 4 equivalent specs (`specs-equivalent.json`) survive, as R5 says. The worktree is clean after them.
