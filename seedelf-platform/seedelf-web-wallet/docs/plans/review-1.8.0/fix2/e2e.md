# 1.8.0's review of its fixes, round two: the e2e lane

Lane **e2e**. Branch `review-1.8.0/fix2-e2e` in `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/fix/e2e`, on `4b4628e9`. Head **`d3dac5db`**.

Two commits, one file (`e2e/extension.spec.ts`). No `src/` change, and no key or value changed:
- `2beff9bc` test(web-wallet): the first unlock's retired run, end to end (1.8.0's review of its fixes, r2-critic#4).
- `d3dac5db` test(web-wallet): the connect test's pin of noteLovejoinMixed in its reordered words (1.8.0's review of its fixes, r2-screens#2).

How I worked:
- Commands ran from the worktree's `extension/`. Logs are in `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/e2e-lane2/`.
- The mutation runner is `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/e2e-lane2-scripts/mutants.py`. For each mutant it makes one exact replacement, rebuilds dist, runs the test, then restores the file with `git checkout` and checks its sha256. dist is rebuilt from the clean source at the end.
- I didn't open `support.ts`, the vectors, the test wallet or any `.env`. Nothing reached the network.

## The first unlock's retired run · tested (R2BRIEF's *Known*; r2-critic#4's G1, the half the fakes reach)

**What changed:** a new test at `e2e/extension.spec.ts:3680`, "Lovejoin: the first unlock on 1.8.0 asks for the retired pools' boxes back at once: Home keeps them on their way back, Settings follows the run to its own stop, and Try again asks of the retired pools". It sits beside the retired pool's test (test A) and uses test A's world: v2's 5 ₳ pool, a box of the wallet's in the classic pool next to its 20 recorded boxes, and one in the head start's MIN pool. The spec also imports `type LovejoinHeld` from `src/shared/rpc` (`e2e/data-layer.ts` imports a `src` type the same way). The probe's source from round one wasn't kept, so I wrote the test from its recipe.

**What it does, step by step:**
1. **The hub's read.** It gives each box its due time, the schedule a 1.7 device brings into 1.8.0. Its first `lovejoin-held` is `{boxes 1, notMixed 0, pools: [MIN {boxes 1, notMixed 0, retired}]}`, with no `bringing` and no ask to giveme.my.
2. **Lock, then unlock** (brief, bullet 1).
   - `lovejoin-held`'s `bringing` equals `{back: 0, retired: true, left: 2, why: …"refused this transaction"…}`: no `pool`, no `stopped`.
   - giveme.my was asked to witness a withdraw of each box. A route keeps each ask's `tx` on its way to the fakes, and an ask counts for a box when its transaction's CBOR holds that box's transaction hash.
   - Nothing was sent.
3. **Home** (bullet 2). In Lovejoin reads "1 box of 10 ₳" and "1 box of 100 MIN + 4.5 ₳". It never says "not mixed yet" or "Not on their way back".
4. **Settings → Lovejoin** (bullet 3).
   - The run reads "Bringing every box in the retired pools back: 0 boxes sent back so far. 2 boxes left." and "The last box that didn't go: giveme.my, which lends the collateral, refused this transaction", with Stop enabled.
   - Its button, pressed while the run goes, asks "Bring every box back now?", because the press widens the run (R4). The test answers Keep them in Lovejoin.
5. **The run's own stop, then Try again** (bullet 4).
   - Two more unlocks make three runs in a row that send nothing, and the run stops itself: `bringing` is `{back 0, retired, left 2, stopped: …}`. The alarm's minute may stop it first, and the loop accepts that.
   - Settings reads "Stopped: several tries in a row sent nothing. giveme.my … refused this transaction", with no progress line.
   - Try again's question is "Bring the retired pools' boxes back now?". Bring them back starts the retired run afresh: its progress line shows, `bringing` is `{back 0, retired, left 2, why}` and not stopped, and giveme.my is asked for each box again.
6. **Stop.** Settings reads "Stopped: 0 boxes sent back.". `bringStopped` is `{back: 0, retired: true}`, both boxes keep their due times, and nothing was sent.

**On "Stop, then Try again":** a press of Stop never leads to Try again.
- `stopBringingAllBack` deletes `bringing` and writes `bringStopped`. Settings then offers its plain "Bring every box back now" (`bringAsk` gives `{}`), whose question is "Bring every box back now?".
- Try again exists only on a run that stopped itself, after BRING_FAILED_RUNS runs in a row sent nothing. The test reaches it that way, then presses Stop at the end on the restarted run.

**The checks:**
- **At the base.** It tests guards that already exist, so it passes at `4b4628e9`: **1 passed** in 7.8 s (`first1.log`). A throwaway print showed the timeline: 2 asks after the first unlock, 4 after the second, 6 after the third with `stopped`, and 8 after Try again with `why` (`first-probe.log`).
- **Mutation checks** on the final version of the test (`mutants-final/`). Line numbers are at the head:

| Mutant | What it undoes | Result |
|---|---|---|
| M1: `await this.retireOnce(network);` dropped from `withdrawDueNow` (`lovejoin.ts:6527`) | the retired run starting at the unlock | **fails** at `:3738`, `bringing` received `undefined` |
| M2 (C1): `retired={false}` (`BringAllBack.tsx:256`) | Try again's title | **fails** at `:3793`: no dialog "Bring the retired pools' boxes back now?" |
| C3: `retired={!!bringing?.retired}` | the title of the press that widens the run | **fails** at `:3767`: no dialog "Bring every box back now?" |
| C4: `retired={!!bringAsk(pool, undefined).retired}` | Try again's title | **fails** at `:3793` |
| W6: sortOut's `waits` always true (`lovejoin.ts:5728`) | the owner's 2026-11-06 rule that nothing in a retired pool waits for Mix my boxes again | **fails** at `:3728`: each pool `boxes 0, notMixed 1` after the restore's read |
| K3: critic#3 reverted (retireOnce's counts loop at `:4236` runs over no pool) | the first run dropping 1.7's counts | **passes** (survives), as it must, explained below |

**Why critic#3's revert survives.** The count critic#3 drops is 1.7's own. No device in an e2e world can hold it:
- 1.8.0 never counts a box in a retired pool as not mixed yet (sortOut's `waits`), and the hub-read check pins that (W6).
- The schedule is sealed, so a test can't write one in.
- So Home's "never not mixed yet" can't fail under K3 here. critic#3's mutant-killing pin stays the unit tests'. The 1.7 → 1.8.0 update with real 1.7 counts is G1's live half (r2-critic#4).

**Stress**, on the final version, with `taskset -c 0,1` (load average 4.5 to 10 from the other lanes):

| Build | `--workers=2 --repeat-each=3` | `--workers=3 --repeat-each=6` (harder) |
|---|---|---|
| dev (`npm run build:ext`) | **3 passed**, 9.0 to 16.1 s | **6 passed**, 20.6 to 21.8 s |
| store (`VITE_ENABLE_MAINNET=true VITE_STORE_BUILD=true npm run build:ext`) | **3 passed**, 8.9 to 15.6 s | **6 passed**, 20.3 to 22.4 s |

An earlier version passed the same way: dev 3 of 3, store 3 of 3 and store 6 of 6. `test.slow()` stays as headroom: the slowest run took 22.4 s against the default 30 s limit, and slow() gives 90 s.

## The pin of `noteLovejoinMixed` · changed

**What changed:** in the O3 connect test, the comment at `:5465–5466` and the assertion at `:5470–5472`.
- The assertion now takes FIX2BRIEF's en value exactly. A script confirms it's byte-identical to the brief's text.
- Each ₳ has a plain space before it, as the brief writes it and as the spec writes every ₳: the spec holds no U+00A0. Playwright's `toHaveText` folds whitespace, U+00A0 included, so it matches en.json's U+00A0. The old pin relied on the same folding.
- The comment no longer reads as "kept aside once": "and the 5 ₳ kept aside in a box of its own, mixed once, only if enough is left".

**At the base, which is this tree:** the value is the screens lane's, so here the test fails at that assertion (`pin-base.log`). Expected is the new value; Received is "…and the 5 ₳ kept aside once, in a box of its own, only if enough is left…". This is also the revert check: the old value fails the new pin.

**With the screens lane's en value applied by hand:**
- One exact replacement in en.json, keeping its two U+00A0s. Never committed. en.json was restored afterwards: sha256 `0d89037c…` OK.
- **1 passed** (`pin-screens.log`).
- Stress with `taskset -c 0,1 --workers=2 --repeat-each=3`: **3 passed** on the dev build and **3 passed** on the store build (`stress-o3-dev.log`, `stress-o3-store.log`).

## Awaiting blind back-translation

None: no key or value changed in this lane. The pin follows the screens lane's new en value of `dappUi.back.privacy.noteLovejoinMixed`, which that lane lists.

## For the lead

1. **The O3 connect test fails on this branch until the screens lane's en.json is merged.** It fails at `:5470`, receiving the old words. Once merged: `npm run build:ext && npx playwright test --project=extension -g "where v2's 5 ₳ pool takes a box" --workers=2`.
2. **Run the new test after the merge:** `npx playwright test --project=extension -g "the first unlock on 1.8.0" --workers=2`. By reading, no other lane's fix changes its path:
   - **retire, A+:** its recheck is for `back > 0`, a 1.7 count or a released Bootstrap. This world has none: every run sends nothing, and there are no counts and no Bootstrap.
   - **screens, r2-screens#5:** the new line is on a v2 pool's page, which the test never opens during the run.
   - **screens, the hub's `takes` and aside:** the test reads only the ADA tile's "1 box".
   - **sessions:** the test has no session.
3. **The words the new test pins** all exist, and none is on the screens lane's list:
   - `settings.lovejoin.bringingRetired`, `bringLeft`, `bringWhy`, `warn.bringStopped`, `bringRetiredTitle`, `bringTitle`, `bringConfirm`, `bringKeep` and `bringStoppedSent`;
   - `common.tryAgain`, `lovejoin.mixes.stop` and `lovejoin.mixes.boxesOf`;
   - giveme.my's "refused this transaction";
   - and, as text that must not appear, `home.lovejoin.flag.notMixed` and `home.lovejoin.notBack`.
4. **"Stop, then Try again"** (FIX2BRIEF, the e2e lane's last bullet) is reachable only through the run's own stop. A press of Stop leads to the plain every-pool button, not to Try again. The test does both, in that order.
5. **critic#3's drop is the unit tests' to pin** (above). G1's live half still owes a real 1.7 device updated to 1.8.0, as r2-critic#4 plans it.
6. **The alarm:** `scheduleFound` starts it at the hub's read, so its first run comes a minute later and may count as one of the three runs. The test accepts that. A run comes either from an unlock or from the alarm, never two at once (`runSessions`).
7. **Seen, not mine.** While the retired run goes, Home's In Lovejoin shows each box's own due time: "1 box of 10 ₳ · Next back Today, 11:00" and "1 box of 100 MIN + 4.5 ₳ · Next back Today, 10:23", seen at 07:43. Settings meanwhile says the run is bringing them back now. This is old: Home has never followed Bring every box back. It's true of each box's wait but understates the run. It's for the owner or the screens lane to decide.
8. **Requests:** none changed. These are tests only.

**Edits outside my lane I'd make:** none.

## Checks run

- **tsc:** `npx tsc --noEmit -p .` is clean at each commit and at the head.
- **Unit:**
  - `npx vitest run tests/i18n*.test.ts tests/words.test.ts tests/worker-words.test.ts --maxWorkers=2` gives **10 files, 194 passed**. The same with `VITE_ENABLE_MAINNET=false` also gives **10 files, 194 passed**.
  - No unit test reads `e2e/extension.spec.ts`. A grep finds only `live-runs-copy` and `store-images-copy`, which read `e2e/live/` and `e2e/store-images.spec.ts`. `words.test.ts` scans `src/` alone.
- **Playwright, dev build:**
  - At the head, the new test **1 passed**, and the O3 test failed at its pin by design (`head.log`).
  - The Lovejoin and connector groups (`-g "Lovejoin: |a mix being sent|a session the restore scan found: Home|site session|a site's private session|a site connects to a private session|Settings' Bring every box back|launched after the head start"`): **16 passed, 1 failed** in 2.6 min (`group-dev.log`). The failure is O3's pin.
- **Stress:** both tables above, dev and store builds.
- dist was last rebuilt from the clean source, as the dev build.
