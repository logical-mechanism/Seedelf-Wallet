# v-x-rel-4-trace: x-rel#4, "#337's way out has never run against a chain"

**Verdict: confirmed, low.** Every fact the finding states holds on HEAD `6bca8bec`. Nothing in the release process as written would run the way out before users do. Two corrections, both to the fix's procedure, not to the finding:
- **When to block giveme.my.** The procedure blocks it "once the collateral's deposit lands". That is too late: by then the wallet has already asked.
- **What to expect after the press.** The rest comes back directly only on a session that runs itself.

## What I checked, and how

**1. No e2e names it.**
- A scratch test scanned `e2e/extension.spec.ts`, `data-layer.spec.ts` and `store-images.spec.ts` for any of the way out's names:
  - the test ids `collateral-held` and `collateral-held-skip`;
  - the RPC `session-skip-collateral-mix`, `skipCollateralMix` and `collateralHeld`;
  - the button's English, "Bring the rest back now";
  - the stop reason, "You brought the rest back without waiting for the collateral's mix".
- It found none, so the test **fails on HEAD**.
- e2e does drive a site session's return through Lovejoin under fakes (`extension.spec.ts:5106–5170`, `siteSessionHolding40`). Its chain is 10 transactions with no collateral tail, so no e2e reaches the 5 ₳ pool's mix at all.
- An e2e can't easily fake the hour either:
  - the worker captures its clock by reference (`sw.ts:160` `now: Date.now`);
  - `Tail.landed` lives in the sealed `lovejoin.<network>` schedule.

  So the PR's "e2e can't reach this state under its fakes" holds without a new test seam.

**2. No live preprod run.**
- **The PR.** Its body lists unit tests, the i18n gates, and "Checked by eye: the component, rendered against the built styles".
- **The authoring session** (`953cc8a5`, which wrote items 3 to 7). Its scratchpad holds only that eye check: `held.html` from a throwaway `renderToStaticMarkup` test, and `shot.mjs`, a Playwright screenshot of a `file://` page. Its transcript mentions `driver.mjs` and "live preprod" only where it quotes the memory index or the docs. Its last write is 18:34Z, four minutes after the merge.
- **The other sessions.** No other session's transcript or scratchpad mentions `skip-collateral-mix`, `collateral-held`, `TAIL_OFFER_MS` or the button's text.
- **The live harness.** No `driver.mjs` or `NOTES.md` is left in any scratchpad. The in-tree harness, `e2e/live/flows.mjs:24` `FLOWS`, runs only the v1 flows: mint, move-in, transfer, withdraw, stake, vote, withdraw-rewards, unstake and remove. The scratch test's scan of `e2e/live/*.mjs` **fails on HEAD**.

**3. No checklist line.**
- `docs/development.md:145`, the checklist's collateral-mix line, still ends "…and that mix waits for giveme.my;".
- The only commit in the range that touches that file is #331's `c5d19d3f`.
- The scratch test's scan of the *Preprod checklist before a release* section **fails on HEAD**.
- Checklist item 1's `node e2e/live/run.mjs all` can't reach the way out either, because `FLOWS` has no session flow.

**4. The only coverage is unit tests over fakes.**
- `lovejoin-planner.test.ts:1791` is the worker's test, with `t.koios` and `t.collateral` faked. It checks that `offerAt` is `landed + TAIL_OFFER_MS`, that a press before the hour changes nothing, and that after the hour the chain stops with `lj.tail.skipped`, giveme.my is asked once and `backBuild` has no `collateralTail`.
- `collateral-held.test.ts` checks the component's markup.
- My control in the scratch test, "the unit tests name it", passed.

**5. The owner's rule.**
- The memory `test-live-on-preprod` (2026-10-20) says: "When a change touches a real send path that the e2e fakes can't complete (private spends: giveme.my's real signature), run it live on preprod… before reporting".
- #337 changes exactly that path. `witnessTail` now stops before giveme.my (`sessions.ts:5143–5144`). `skipCollateralMix` pumps the chain, then `advance`s (`sessions.ts:5526–5538`), and for a session that runs itself, that sends the direct return in the same request.

**6. Dormant on mainnet: true.**
- The scratch test's control passed:
  - mainnet bundles 0 pools (`src/lovejoin-pools.json`, height 14110720), and `NETWORKS.mainnet.lovejoin.poolFloor` is 30 (`networks.ts:71`);
  - preprod bundles the 5 ₳ ADA pool `18c4df77…`, and its floor is 0 (`networks.ts:56`).
- `collateralPoolTakes` (`lovejoin.ts:3987–3998`) answers "no" while no 5 ₳ ADA pool is shown.
- So the live run the fix asks for can be done on preprod. 1.6.0 already ran the collateral's mix there (`17944d29`, `a36ee6c8`, `41afe1d6`; `docs/archive/plans/review-1.6.0.md:57`).

## Why it matters, and how far

**The bound on harm.** If the way out misbehaves, the session falls back to 1.6.0's behaviour: the wait ends at `TAIL_KEEP_MS` (`lj.tail.tooLong`, `sessions.ts:5147`), or the user presses again. No money is at risk, which fits low.

**Defects that unit tests over fakes missed.**
- In this exact area, 1.6.0's live run found LIVE-1 ("a chain cut once its mixes went, whose rebuilt tail and return landed, read 'stopped partway'"). No unit test had caught it (`review-1.6.0.md:48`).
- pr337's own review found three defects in this flow that the PR's tests never reached:
  - its #1: the offer shows where nothing waits;
  - its #2: by hand, the press brings nothing back, yet the reason says it did;
  - its #4: a press is lost while the runner builds the mix again.

  A live run of the fix's step 5 on a site's page would have shown #2 at once.

**The race the scenario names is benign.** pr337's report already traced the race with giveme.my's witness and the mix's submit: the mix and the return both go, which is more private than the line promises. The finding offers that race only as an example ("say"). The gap itself is that the flow has never run end to end in the built extension.

## Corrections to the fix

1. **Block giveme.my before the tail's deposit lands, not after.**
   - `pumpChain` asks giveme.my at the first poll that finds every earlier transaction on chain (`lovejoin.ts:484–489`, `:506–508`; the witness is `sessions.ts:5049` → `witnessTail`). By the time a tester sees the deposit land, giveme.my has usually been asked and has signed.
   - **When:** block it after the session's funding is in, because the funding is a Seedelf spend that needs giveme.my. Nothing else on the way asks for it: the chain's other mixes put up the session's own collateral. The only giveme.my calls are `tailWitness` (`lovejoin.ts:4104`), the private withdraws (`:6956`, `:6968`) and `script-spend.ts:413`.
   - **What the block does:** a blocked request is a `CollateralError` ("unreachable", `collateral.ts:64–69`), so the chain keeps waiting. It asks again after 1 minute, then each wait doubles, up to 30 minutes (`sessions.ts:5161–5167`, `TAIL_WITNESS_WAIT_MS` at `:705`).
   - **When the hour starts:** at the first `witnessTail`, through `tailLanded` (`lovejoin.ts:4108–4117`).
2. **Plan for the hour and the auto-lock.**
   - Auto-lock is 15 minutes by default, at most 60 (`shared/preferences.ts:76`, `:167`). Left alone for the hour, the wallet locks, and the lock cuts the chain.
   - The offer then comes from `tailBuildable`'s branch (`lovejoin.ts:4131`). That is the branch pr337's M2 mutation showed no test guards.
   - Say which run is meant: kept active (Settings → 60 minutes, and *Stay unlocked*) for "a chain still being sent", or one lock and unlock for the cut. Both are worth a run.
3. **The expected outcome depends on the session's kind.**
   - **A swap or mix that runs itself:** the direct return goes in the same request.
   - **By hand** (a site's page, or a swap brought back by hand): on HEAD the press only stops the chain, and the rest comes back after *Bring it back* (pr337#2).
   - Word the checklist line to match how pr337#2 is settled.
   - Each page needs its own held session, so the three pages take three sessions or three runs.
4. **The rest stands:** unblock giveme.my, then *Mix my boxes again* moves the box. Add the line after `development.md:145`, as x-rel's F6 says.

## Scratch work (deleted)

`extension/tests/zz-review-v-x-rel-4-trace-1.test.ts`, run alone: **3 failed, 3 passed**.
- **Failed, as the finding predicts:** e2e names the way out; the live harness names it; the checklist names it.
- **Passed (controls):** the button's English is "Bring the rest back now"; the unit tests name the way out; mainnet bundles no 5 ₳ ADA pool and has floor 30, while preprod bundles one and has floor 0.

The file was deleted afterwards. No tracked file changed, nothing went to the network, and no Koios request was made.
