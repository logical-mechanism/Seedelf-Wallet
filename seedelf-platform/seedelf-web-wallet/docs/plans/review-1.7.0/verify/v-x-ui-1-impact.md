# v-x-ui-1-impact: x-ui#1, impact and the fix

**Verdict: confirmed. Severity: low** (the finder's). The fix is right; refine how fix 1 is wired. Fix 2 is the least the owner should take.

## What the press does on a by-hand page (HEAD 6bca8bec, all of it from #337's aa6f5fc2)

- `sessions.ts:5537`: `skipCollateralMix` ends in `return this.advance(network, index, true);`.
- `sessions.ts:3446`: `step` reads `if (!s || !running(s)) return;`.
- `sessions.ts:1231`: `running` reads `return !!s.auto && !s.closedAt && !s.auto.paused && !s.auto.failed;`.

A site's session, a swap from before swaps ran themselves and a found session have no `auto`. For them the press only does three things: it marks the tail over, it pumps the chain (which stops at the mix, `witnessTail` at `sessions.ts:5144` throwing `lj.tail.skipped`), and it returns the view. The docstring at `sessions.ts:5522-5523` says as much: "one brought back by hand is offered on its page". So it's deliberate in the worker. The button's words, the stop reason and flows.md don't say it.

## Scratch run

`tests/zz-review-v-x-ui-1-impact-1.test.ts` (deleted) was set up as the PR's own test: a site's session, a 5 ₳ pool, `backBuild`, `backSubmit`, giveme.my answering 503, then the hour passes.

- **Chain:** `["deposit","mix","deposit","mix","back"]`.
- **Before the press:** `{"total":5,"sent":3,"confirmed":3,"cut":false}`, with `collateralHeld` set.
- **The skip:** nothing was submitted, and `txs` reads `["out","deposit","mix","deposit"]` (no back).
  - `chain.stopped` is "You brought the rest back without waiting for the collateral's mix, so the chain stopped there.", with `cut: false` and `collateralHeld` undefined.
  - `backCollateral` is undefined, so no *Put in 5 ₳ for Lovejoin*.
  - The page's row reads `chainText(chain, true)`: "Stopped after 3 of 5 transactions; the rest stays at the account until you bring it back".
- **Lovejoin page:** `lj.chains` lists session 0 with stopped "You brought the rest back…", which is false at this point.
- **The alarm (runAll) 10 minutes later:** still no return.
- **Bring it back by hand (what fix 1 would open):** `backBuild` builds a direct return (`lovejoin`, `collateralTail` and `lovejoinSkipped` all undefined). Once it's sent, the chain reads `cut: true`, "what was left came back directly".
  - The Chains row still lists the chain with the same reason, now true. `restBack()` never marks this chain: `restOnly` is false while `tailBoxOut` holds (`lovejoin.ts:1963-1970`, `5109-5124`). So the row stays until the collateral's box is mixed again or brought back (`shown`, `lovejoin.ts:2007`).

## Reachable?

Yes, under conditions:

- **Pages:** a site's page (`SiteSessions.tsx:411-419`), or a by-hand or found swap's page (`Swaps.tsx:2567`).
- **The return:** brought back through Lovejoin, where a 5 ₳ ADA pool is shown at its floor.
- **The wait:** giveme.my keeps the collateral's mix waiting for over an hour after its deposit lands. 323-worker#3's own scenario was six hours of 503s. It also happens when a lock cut the chain and its mix waits to be built again: `tailBuildable`, where the wrong label applies but the Lovejoin page's reason is `lj.chainCut`.
- **Networks:**
  - Preprod (Settings): reachable today.
  - Mainnet (the default): dormant today. privacy.md:217 says "every return on mainnet until a 5 ₳ pool there holds 30 boxes that aren't yours". Anyone can launch or bootstrap such a pool, with no update needed.

## Why low, not medium

No money is lost, locked or exposed. The rest stays at the session's one-time account. Right after the press, the session's own page tells the truth: "the rest stays at the account until you bring it back". Bring it back is enabled in the foot, and the by-hand swap's next step says to bring it back.

What's wrong is a button label that promises one more step than it takes, a past-tense claim on another page (the Lovejoin page's Chains row, "Why it stopped: You brought the rest back…"), and flows.md:522. That's a small UX defect plus a misleading doc.

## The fix

**1. Screens.** Right, and it keeps the critical line `lj.tail.privacy.wayOut` ("Bring the rest back without it…") true without a new back-translation. Relabelling the button instead would ripple into that critical line. Wiring:

- Don't call `buildBack(true)` from inside the skip's `act`. It's `void act(...)`, so the outer `finally` clears `busy` while the build still runs.
- Do both in one `act`:
  1. `const after = await call("session-skip-collateral-mix", …)`.
  2. Only if the skip took (`!after.collateralHeld`), build as Bring it back does: `setRebuilding`, `setBack(await call("session-back-build", { index }))`, `setBackThrough(true)`, `setBackPools({})`.
  3. `onRefresh()`.
- Factor buildBack's body into an awaited helper that both use.
- `Swaps.tsx` needs a handler for the by-hand branch alone. Leave the runs-itself branch's `skipCollateralMix` and the Lovejoin page's mix card alone, since their runner sends the return itself.
- No new text, guard or request: the build is the one Bring it back makes anyway.
- If the user backs out of the review, the page shows the true "stays at the account" row.
- Test: the `vi.mock("react")` seam in `screens-wiring-review-fixes.test.ts`. A SiteSession with `collateralHeld.offerAt` in the past, `collateral-held-skip` pressed, then `session-skip-collateral-mix` and `session-back-build` are called and `site-back-review` shows. It fails today.

**2. `lj.tail.skipped`.** Needed whatever fix 1 does, since a review can be backed out of. The proposed "You chose not to wait for the collateral's mix, so the chain stopped there." is true on every page, for sessions that run themselves too, both before and after the return.

- It's not critical: `critical-keys.json` holds only `lj.tail.privacy.wayOut`.
- es and ja are machine drafts (provenance `machine`): redraft both.
- No test reads the English. The planner's test at `:1818` uses `tr()`.
- Reasons already stored keep their old words. A stop reason is persisted translated text, as `lj.tail.tooLong`'s is.

**3. flows.md:522.** Today it says "and the rest comes back directly". Change it to say:

- a swap that runs itself and a mix bring the rest back at once;
- a site's page and a by-hand swap's open the return's review, whose Send brings it back directly. This is already how flows.md:494 (L23) puts a stopped chain on a site's page.
- Update the quoted reason too. architecture.md:633 is accurate as it stands.

## Evidence on HEAD

- `en.json:920` holds `lj.tail.skipped`; `en.json:986` holds `lovejoin.chain.stoppedByHand`.
- `SiteSessions.tsx:416-417` reads `await call("session-skip-collateral-mix", { index: s.index }); onRefresh();`.
- `Swaps.tsx:2403` holds the one `skipCollateralMix` both branches share.
- `Lovejoin.tsx:963-966` holds the Chains row's `lovejoin.chains.whyStopped`.
- `lovejoin-planner.test.ts:1814-1825` is the PR's own test. It skips, then calls `sessions.backBuild` itself.
