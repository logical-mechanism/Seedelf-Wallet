# v-pr337-2-impact: pr337#2, judged on impact and the fix

**Finding:** no test covers `tailHeld`'s lock-cut branch (`tailBuildable`), or the skip's path for sessions that run themselves (`advance("asked")` after the skip).

**Verdict:** confirmed. **Severity:** low, as filed. The fix is right, with two corrections to (b)'s setup and one to which assertion matters in (a).

## Is the gap real?

Yes. I checked it with mutations in a copy outside the tree (`scratchpad/review/v-pr337-2-impact/`).

- **M2** turns `lovejoin.ts:4131` into `if (!tailWaits(c)) return undefined;`. All 43 tests that match "collateral" in `lovejoin-planner.test.ts` and `collateral-held.test.ts` still pass: `Tests  43 passed | 38 skipped (81)`, the same count as on HEAD.
- **M3** turns `sessions.ts:5537` from `return this.advance(network, index, true);` into `return this.one(network, index);`. The PR's three way-out tests still pass: `Tests  3 passed | 78 skipped`.
- No other test, e2e included, mentions `tailHeld`, `collateralHeld`, `skipCollateralMix` or `session-skip-collateral-mix`. The only worker test is `lovejoin-planner.test.ts:1791`. It uses `setUp`'s site's session, whose chain is still being sent, so it reaches only the `tailWaits` branch, and its `advance` does nothing for a site's session.

## Can a real user reach the untested paths?

Yes, in the shipped build.

**Preprod (Settings):** reachable today.
- `networks.ts:56` sets `poolFloor: 0`.
- `src/lovejoin-pools.json` lists a 5 ₳ ADA pool for preprod (`18c4df77…`).
- `lovejoinCollateral` is on by default (`shared/preferences.ts:173`).

**Mainnet:** dormant until a 5 ₳ ADA pool holds 30 of other people's boxes.
- `networks.ts:71` sets `poolFloor: 30`, and the bundled list has no mainnet pools.
- That threshold is chain state, so the path can go live with no update.

**The lock-cut state is the usual one at the offer's hour.** The finding's claim holds:
1. Auto-lock is 15 min by default, 60 at most (`shared/preferences.ts:76`, `:167`).
2. Activity counts only pointer and key events (`ui/App.tsx:95`), so an open, idle page doesn't keep the wallet unlocked.
3. The offer comes an hour after the deposit landed (`TAIL_OFFER_MS`). By then a user who waited has usually been locked, and the lock wiped the chain's progress.
4. After the unlock, every alarm run calls `lovejoin.returning` (`runs.ts:101`), which calls `cuts` (`lovejoin.ts:6142`) and marks the chain ended.
5. From then on only `tailBuildable` keeps `collateralHeld` on the view. `sessions.ts` `tailHeld` reads "from the device alone" and never calls `cuts`.

A giveme.my refusal (`lj.tail.refused`) or a drawn box that has gone ends the chain the same way, so it lands in the same state.

## What the regressions the tests would catch would cost

Neither would lose or lock money, which keeps this at low.

- **M2 shipped:** a site's or hand-run session would show no *Bring the rest back now* in its most common held state. A workaround remains:
  - The return review's direct switch skips the tail (`sessions.ts:4386`: `if (started && !direct && lovejoin)`).
  - A mix's Stop comes back directly (`sessions.ts:3617`).
  - The day's end still frees the rest.
  - For a session that runs itself, the offer would be hidden only during the unlock wait. After that the runner rebuilds the mix, and `tailWaits` shows the offer again.
- **M3 shipped:** a session that runs itself would bring its rest back at a later alarm run, not in the same request. That's a delay of minutes, plus an unlock wait if the wallet was unlocked recently.

The brief's medium covers "a critical guard with no test". This is not a guard. It's "a missing test on a minor path", which is low.

## The fix: checked

I wrote both tests (`tests/zz-review-v-pr337-2-impact-1.test.ts`, now deleted). Results on HEAD:
- 2/2 pass.
- They also pass with `VITE_ENABLE_MAINNET=false`, and in three repeated runs.
- They take about 2 s each.

Under the mutations:
- **M2:** (a) fails at the view check after `cuts`: `expected undefined to deeply equal { offerAt: 1800003600000 }`. (b) passes.
- **M3:** (b) fails: `expected [] to have a length of 1 but got +0`. (a) passes.

The two tests complement each other.

### (a) A site's session, held at the mix, with the lock cutting its chain

1. Set up as the PR's test does: `runAll` with giveme.my at 503.
2. Lock the wallet, then unlock it (`t.wallet.lock()`, then `t.wallet.unlock(PASSWORD)`).
3. Assert `collateralHeld` before `cuts`. Here the record isn't ended yet, so `tailWaits` still covers it.
4. Run `await lj.cuts("preprod")`, then assert `ended`, `cut`, and `collateralHeld` equal to `{ offerAt: landed + TAIL_OFFER_MS }`.
5. Move `landed` back by `TAIL_OFFER_MS`, then call `skipCollateralMix`.
6. Assert that `tail.over` is true.
7. List the box and the deposit's change, then assert that `backBuild` has no `collateralTail`, `kept(t).chain` is undefined, and giveme.my was asked once.

**Corrections to the finding's (a):**
- `lj.cuts` (or `lj.returning`) is required. Without it, `sessions.list` still reads the chain as being sent, and the test passes under M2.
- The assertions that catch M2 are `collateralHeld` after `cuts` and `tail.over` after the skip. `after.collateralHeld` being undefined is true either way.
- Removing `${SESSION_CHAIN_PREFIX}preprod.0` works as well as a real lock and unlock.

### (b) A mix session that runs itself, held at the mix

1. Rewrite `setUp`'s session as `mixOutSubmit` records one: drop `site`, and add `mix: { boxes: 1 }` and `auto: { approved: { minAmountOut: "0", fund: { lovelace: "16000000", tokens: [] } } }`.
2. Run `runAll`, which builds and sends the chain up to the mix.
3. Set `confirmations = 1` and giveme.my to 503, add `READ_EVERY_MS` to the clock, and run `runAll` again. Assert that giveme.my was asked once and that `collateralHeld` is shown.
4. List the box and the deposit's change, move `landed` back by an hour, and call `skipCollateralMix`.
5. Assert, within that same request:
   - exactly one submit;
   - it is neither the mix nor the old return;
   - its inputs include `${deposit}#${change}` and not the 5 ₳ box;
   - giveme.my was still asked once;
   - `collateralHeld` is undefined;
   - `tail.over` is true;
   - `stopped === tr("lj.tail.skipped")`.

**Corrections to the finding's (b):**
- The runner keeps no review, so `steps(t)` (`SESSION_BACK`) is undefined. Read the chain from `${SESSION_CHAIN_PREFIX}preprod.0` instead.
- Add `READ_EVERY_MS` to the clock between the `runAll` calls, or the step is gated. `advance(…, true)` also works.
- Find the box by `boxAddress(five.mixBox)`.

### What else the fix changes

Only tests change. No source, no strings, no privacy note, no guard, so the owner's rules are untouched.

- It adds about 4 s to the SLOW suite, on each of CI's two Vitest builds.
- (b) mirrors `mixOutSubmit`'s record shape, as the Bootstrap test at `lovejoin-planner.test.ts:2284` already does.
- Neither test covers the pages' wiring (`Swaps.tsx`, `SiteSessions.tsx`, `Lovejoin.tsx` `MixCard`). The PR says e2e can't reach the state under its fakes. I read the wiring and the types line up: `mixes` is `SessionView[]`. Covering it would take a screen-harness render, which is optional and outside a minimal fix.

**Confidence:** high. The mutation results come from running the tests in the copy.
