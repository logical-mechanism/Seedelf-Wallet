# 1.8.0's release review: the findings, clustered

Nine finders, at `a6c94743` (reports in [find/](find/)): **92 findings**, 6 medium, 72 low, 14 nits. Deduplicated, they're **44 clusters**. Each cluster has an ID (`O`: the owner's call, `R`: retirement, `P`: the 5 ₳ pool shared, `W`: words, `S`: screens, `V`: 44a, `D`: release and docs), the severity of its worst member as the lead rates it, and its members as `<lens>#<n>`.

The **owner's call of 2026-11-06** reshapes the O cluster and part of D: "We need it to work since that if no 5 ada pool exists, or really any pool, then no mix happens. Then when it exists it uses it." So:
- The head start is never a gate. That reverses 44c's "1.8.0 can't ship without each network's v2 5 ₳ pool in the head start". The floor isn't one either: release#2's "Bootstrap it to 30 before the upload" isn't the fix.
- With no pool, or one under its floor, a return comes back directly, and every screen says so truthfully, the connector's approval included.
- A pool launched later, from the wallet, before or after the release, is found and used on both networks without Lovejoin's page.

**Verification by convergence:** a cluster that two or more lenses found independently, each with its own failing test or mutation, counts as confirmed. Single-lens code and words findings get one trace verifier, and mediums a trace verifier and an impact verifier. Docs findings go to the lead.

## O · No pool, then a pool (the owner's call)

| ID | Sev | Members | Claim | Fix direction |
|---|---|---|---|---|
| O1 | medium | (the owner's call); release#1 (Koios-only half) | On preprod, and on mainnet with Koios-only on or the data layer down, a pool launched after the head start is found only by Lovejoin's page's look. `adaPool`'s ask refreshes the data layer's list, which is nothing there. | At `adaPool`'s ask, with no 5 ₳ pool kept after the refresh, look at Koios's holder as the page does, throttled to `REFRESH_MS` per network. A unit test: a preprod return with no pool kept and a v2 pool at the holder asks, finds it and mixes. |
| O2 | medium | release#1, adapool#2, tests-unit#9 | The quiet reads (`priced` at Review, `collateralWanted`) don't ask. So one swap review says "no pool of 5 ₳ boxes" while `tailReserve` asks, finds that pool and charges the collateral's mix there. The return later mixes with fees the approval never showed. An ADA-out swap with no pool says "Too little spare ADA for a Lovejoin box". With no pool, a return whose collateral is gone saves "too little for a box". | `priced` asks at Review (`adaPool(network, pool)`), quiet as the user types. `collateralWanted` with no pool says `noAdaPool`. `skipped` keeps the approval's Lovejoin choice showing. Tests per tests-unit#9. |
| O3 | medium | release#2, tests-e2e#0, words#1, cross#8, adapool#3 (its connector half) | The connector's approval and its funding review promise that spare ADA is mixed (critical `.privacy.` keys) on Settings' switch alone. They read nothing of the 5 ₳ pool: none known, under its floor, or no room. The connect e2e pins the promise in a world where no pool can take the ADA. | Let the approval follow the worker's view of the 5 ₳ pool, as `collateralMix` does. Where none takes the ADA now, say so truthfully, in one line: reuse `swaps.lovejoin.privacy.onPoolShort` or the direct words. The e2e asserts both states. Back-translate anything new or changed. |
| O4 | low | words#4, adapool#4 | `sess.skip.warn.noAdaPool` ("Lovejoin has no pool of 5 ₳ boxes to take it yet") is saved with a session. Shown later in `lovejoin.warn.skippedIts`, it's false once a pool exists. Critical. | A wording that stays true later: the wallet knew of none then. Blind back-translation. |
| O5 | low | cross#6 | With no 5 ₳ pool shown, `chain()` throws `noAdaPool` before `acrossOf`, so a token with a usable v2 token pool comes back directly too. Under the floor the tokens still go. | Throw only when no token goes either: `acrossOf` with no ADA leg, as `adaShort` has none. |
| O6 | nit | screens#12, words#12, screens#13 | The hub's "A mixer for ADA, in 5 ₳ boxes" shows only when no 5 ₳ pool is known. "No pool to mix in yet" isn't said when every listed pool is retired. | Key the aside on a token pool shown. Show `noneYet` when no listed pool takes boxes. |

## R · The first unlock's bring-back and the retired pools

| ID | Sev | Members | Claim | Fix direction |
|---|---|---|---|---|
| R1 | low | retire#0, cross#3, screens#2, tests-unit#0 | `retireOnce` keeps a going one-pool run (a 1.7 pool page's), marks `retired`, and never asks the retired pools' run. The other retired pools' boxes miss call 3's "right away". | Widen a going run of a retired pool to the retired pools' run, keeping its `at` and `back`. |
| R2 | low | cross#0, retire#1, tests-unit#6 | `retireOnce` runs before `cuts`, so a 1.7 chain the update cut keeps its tail in a retired pool not `over`. The retired run then waits on that box ("waits for its mix, a day at most") and holds every pool's scheduled withdraw, v2's too, for up to a day. | `await this.cuts(network)` at the top of `retireOnce`, and `tailBoxes`/`tailBuildable` skip a tail whose pool is retired. |
| R3 | low | cross#4, retire#6 | When discovery's `known` throws (a storage failure), `retiredIds` takes every pool missing from the quiet read set for retired. `retireOnce` then releases v2 Bootstraps and ends v2 tails, for good, and marks `retired`. | Decide nothing on a read that fell back. Retired = the classic pool, or a pool the set has whose version isn't v2. |
| R4 | low | retire#2, cross#9, screens#0 | When the retired pools' run stops by itself, Settings' Try again ("bring back the rest", critical) asks every pool's run, so the v2 boxes come back back to back too. | Try again restarts the run that stopped (`retired` carried through `lovejoin-bring-all-back`). |
| R5 | low | cross#1, cross#2, retire#3, retire#4, retire#5, tests-unit#1, tests-unit#4, tests-unit#7, tests-unit#8, adapool#5 (1, 2) | Untested guards: `chain()`'s `isRetired(into)` for a 1.7 Mix again; `tailChain`'s `isRetired`; the stopped-run re-ask; the release's `old(poolOf)`; the tails trigger; `bringStopped`'s delete; the run end's `covered`; `held()`'s `retired` mark; and the hold filters (Koios's word, cut chain, Bootstrap, Bring one back now). | Tests in `lovejoin-retired.test.ts`: the finders' scratch tests, each failing under its mutant. |
| R6 | low | tests-unit#5 | run-traps' "in its own run" case runs Bring every box back since #364, so no test reaches the scheduled withdraw's trap hand-on. | `retiredAlready` after `dueBox`, or the box in the 5 ₳ pool; the same for `:474`. |
| R7 | nit | tests-unit#10 | Three moved tests pass for retirement's reason. | Boxes in the 5 ₳ pool, or `retiredAlready`; drop the seed half. |
| R8 | nit | retire#7 | A public mix in a retired pool reads the account before it's refused. | Refuse right after `poolNamed`. |

## P · The 5 ₳ pool shared by returns, mixes and the collateral

| ID | Sev | Members | Claim | Fix direction |
|---|---|---|---|---|
| P1 | medium | adapool#0 | A mix session in the 5 ₳ pool (the tile's Mix, Mix my boxes again) leaves its collateral's mix fewer than two draws. Its review still says the 5 ₳ "comes back later, mixed once", with the critical giveme.my note. Built, the 5 ₳ comes back unmixed. | Count `TAIL_DRAWS` where the collateral's pool is the mix's own (`fits`, `againBoxes`, the Mix form's room, `holdTail` for a mix session). Or say `ifLeft` when the boxes leave fewer than two. |
| P2 | low | cross#5 | Bring everything back over found sessions: a direct return's collateral mix and a chain in the same 5 ₳ pool draw the same two boxes. One Send is refused (`lj.stalePool`). | Reserve a direct return's collateral mix at build. |
| P3 | low | adapool#3 | In 5 ₳ boxes a return pays about twice the fees per ₳ mixed, and one chain carries half the ADA (160 ₳ two waves deep). The rest comes back at once. Every figure shown is right. | For the owner to know: privacy.md and the plan say it. No code change. |
| P4 | low | tests-unit#2, tests-unit#3, adapool#5 (3–9), screens#9 | Untested: `tailRows`' `avoid`; `roomIn` across pools and in other pools; `holdTail`; `adaPoolOf`'s `!p.token`; `priced`'s 64 cap; `funding`'s v2 tail; `LovejoinSwitch`'s ADA pool. | Tests, per each finding. |

## W · Words

| ID | Sev | Members | Claim | Fix direction |
|---|---|---|---|---|
| W1 | low | release#5, words#0, cross#7, adapool#1 | A swap's cost row, its stop line and Stop's dialog say "boxes of 10 ₳". They're the 5 ₳ pool's (`swaps.cost.boxesLabel`, `swaps.boxes.*`, en/es/ja; `screens.test.ts` pins the stale words). | Name the pool's box (5 ₳, or its value). Update the pins. |
| W2 | low | screens#3, words#2 | A retired pool's page, during the retired pools' run, says "every box in this pool" and counts every retired pool's boxes. | `goingText` uses `settings.lovejoin.bringingRetired` for `b.retired`. |
| W3 | low | words#5, screens#14 | `lj.unusable.warn.retired`, two sentences for a pool's page, is saved as a 1.7 mix session's reason. "This pool" and "Your boxes in it" then name nothing. Critical. | A clause of its own for the session's frames. Back-translate. |
| W4 | low | screens#1, words#7 | A retired token pool whose boxes can't pay their own way back says they "come back by themselves" (critical) beside the stuck callout saying the opposite. | Leave that sentence out where `cantComeBack`. |
| W5 | low | words#6 | "The 5 ₳" (the collateral) now reads as the 5 ₳ boxes in `dappUi.back.privacy.noteLovejoin(Mixed)`. Critical. | "The 5 ₳ kept aside", as `noteDirect` says it. Back-translate. |
| W6 | low | words#3 | Three critical `.privacy.` values changed in es and ja (10 → 5 ₳) with no fresh back-translation recorded. ja `lj.unusable.warn.retired` was corrected after its round. | Blind back-translation of each, recorded in both verified files' notes. |
| W7 | low | words#8 | The worker-reasons guard doesn't follow `unusableReason` → `LovejoinSkipped(e.message)`, so the retired reason is critical by its name alone. | `unusableReason` into `REASON_FUNCTIONS`. |
| W8 | low | screens#4 | A 1.7 chain stopped partway in a retired pool says "Mix my boxes again mixes the boxes it didn't". | `LovejoinChainView` carries the retired flag; its own words there. |
| W9 | low | screens#5 | A retired pool's page sends the user to another account "to mix them again". | `OtherAccounts` only when Mix again isn't refused. |
| W10 | nit | words#11, adapool#6, pr363#4 | Stale comments (10 ₳; the shown rule before 44a); `room()`'s dead default. | Fix the comments. |
| W11 | nit | words#13 | No glossary row for "retired". | Add it. |

## S · Screens

| ID | Sev | Members | Claim | Fix direction |
|---|---|---|---|---|
| S1 | low | screens#6 | The hub's search keeps filtering after its box hides (the retired groups emptied). | Search only while the box shows. |
| S2 | nit | screens#11 | A retired token pool's page loses its run's Done when the pool leaves the status. | Keep the page on its last read while it holds a `done`. |
| S3 | low | words#9, words#10, screens#7, screens#8, screens#10, tests-e2e#2, tests-e2e#3 | Untested screen guards: the retired run in BringAllBack and Settings; a retired pool's page and row; `noneYet`; a token's list of pools. | Screen tests, per each; one e2e for the token list. |

## V · 44a (#363)

| ID | Sev | Members | Claim | Fix direction |
|---|---|---|---|---|
| V1 | low | pr363#0 | `startedBefore` matches a 1.7.2-recorded 8131b1d start by values, so a v2 start gets the critical "the later one is a copy" though it's shown. | Record the set on each start; match the start's set only. |
| V2 | low | pr363#1 | The two copies' tests read a fixture pool with no version differently (the extension: tokenV1; the data layer: V2). | Read the version strictly, the same way, in both. |
| V3 | low | pr363#2 | The data layer's new `version` on `lovejoin/pools` is pinned by no test. | A unit test for V1 and V2. |
| V4 | low | pr363#3 | The status's `version`, Start a pool's only source for joining v2 pools, is pinned by no test. | A worker test of `status()`. |
| V5 | low | tests-e2e#5 | No test holds a v2 mix's fee under the estimates. | Assert both estimates in `every_width_measured`. |
| V6 | nit | tests-e2e#6 | The v2 fixtures put one launch's outputs in three blocks. | The writers take the reference's block; re-record. |

## D · The release and the docs

| ID | Sev | Members | Claim | Fix direction |
|---|---|---|---|---|
| D1 | medium | release#0 | What 44c and 44d still owe, in order. As the owner's call amends it: no head-start or floor gate. The prep did the version and the lists; the fix round, the live run, the checks and the record are Claude's; the merge, the deploy, the package, the upload and the tag are the owner's; the mainnet launch comes whenever the owner chooses. | The record's "For the owner" section. |
| D2 | medium | release#3 | The privacy policy owes 1.8.0 a dated Changes entry: the first unlock sends unasked (back to back, unmixed boxes included), and the record keeps `retired`. | Draft the entry, and move *Effective*. |
| D3 | low | release#4 | `npm run lovejoin-registry` throws at a v2 pool, names it as the 8131b1d 5 ₳ pool, and links 8131b1d's tree. | Accept v2, name its set, link `COMMIT_V2`. |
| D4 | low | release#6–#11, release#13, release#14, tests-e2e#4 | architecture.md, flows.md, privacy.md (the first unlock's timing cost; P3's costs), lovejoin-mix-width.md (lead with v2), README, development.md (`release_version`, the head start, checklist item 6), backlog.md still describe 1.7. | 44d. development.md's "never a gate" stays true (O1). |
| D5 | low | release#12 | The store listing says new boxes go "only in the first started for each box value" (all three languages); mainnet's first 5 ₳ pool is 8131b1d's. | "…on Lovejoin's current contracts", in en, es and ja. |
| D6 | low | tests-e2e#1, release#0 (5) | The prep's head start (preprod's v2 pool bundled) breaks `lovejoin-1-5-0`'s head-start case (2 tests) and the e2e's `fivePool` on preprod (8 tests), and leaves "Mix my boxes again" passing on a copy. | `lovejoin-1-5-0` compares the retired pools alone and asserts the v2 ones apart. The e2e puts boxes at the bundled pool's mix_box where one is bundled, `fivePool` only where none is (tests-e2e's spec script). |

## Round two: the verdicts and the critic

Eight agents ([verify/](verify/)): a completeness critic, a trace and an impact verifier for P1, a trace each for O2 and O3, a design pass over the owner's call (O1, O4–O6), and a trace for each single-lens low.

**Every finding they traced held: 30 confirmed, none refuted.** One member's half was refuted: adapool#3's connector half (the connector's per-box line isn't false, since its notes say the rest comes back at once), which is a nit at most. What changed is the severities and the fixes.

**Severities:**
- words#1 and cross#8: low → medium. They're O3's three critical lines, false in normal use.
- O1, O2 and O3 stay medium, and P1 stays medium. The rest stay as rated.

**Fixes:**
- **O1:** the lead's draft holds in all four modes, mainnet itself included. Add the throttle in discovery (hardening a), a shared in-flight refresh (b), and the privacy policy's words: the look at an ask changes when the wallet sends a request.
- **O2:**
  - `priced` asks at Review; it must ship with O1's look.
  - `collateralWanted` asks first, at the return's build alone. Without the ask, `noAdaPool` is false where the list has a pool.
  - The approval's choice for `skipped` shows only where the ADA would pay for a box.
- **O3:**
  - The card adds the verified `swaps.lovejoin.privacy.onPoolShort`; the review's note gets one new hedged critical key.
  - Never the direct words: they go false once a pool fills.
  - The mark is `priced`'s rule, not `collateralMix`'s: that follows the collateral's two draws, and is absent with the collateral switch off.
- **P1:** the two verifiers differed. The lead takes p1-impact's (c):
  - Mix my boxes again holds the collateral's draws. Its count is the wallet's, so this refuses nothing, and it's 44b's `roomIn` rule.
  - The tile's Mix keeps the user's count and says `ifLeft` where the draws run short.
  - p1-trace's words-alone fix stays for the tile and for Stop's one-box case.
  - Capping the tile's count would be a guard nobody asked for (the critic's note).
- **W3 and W4:** drop the retired reason's last sentence, rather than two new critical keys (lows-b). W3's saved reason reaches one frame of five.
- **W8, W9 and V1:** no new keys; rendering conditions and a recorded set.
- **P2:** reserve a direct return's collateral tail at build.

**The critic's findings**, each proven by a test in its sandbox:

| ID | Sev | Where it goes | Claim |
|---|---|---|---|
| critic#0 | low | O4 | `lj.skip.warn.floorShort`, saved with a session, reads false once the pool fills. Under 1.8.0 it's every mainnet return's reason until v2's 5 ₳ pool holds 30 others. |
| critic#1 | low | O2 | Under the floor, a session whose 5 ₳ is gone is told its collateral is missing and offered 5 ₳. Once that's in, it comes back directly for the floor. |
| critic#2 | low | the lead, at the merge | With no data layer, a device that never kept v2's 5 ₳ pool can't find the user's boxes there through Settings' Bring every box back until Lovejoin's page opens. That a restored wallet finds its boxes when Lovejoin's tile opens is the design (privacy review §2.18). Bring every box back saying nothing is left isn't. |
| critic#3 | low | R | Home keeps 1.7's "not mixed yet" count for the retired pools until the retired run ends. After Stop, for two hours, it shows money that's already back. |
| critic#4 | low | chain | A swap approved on 1.7.2 comes back on 1.8.0 by itself in about twice the boxes and fees its approval priced (classic 10 ₳ boxes, now 5 ₳). |
| critic#5 | low | R | `madeSince` is pool-blind: a v2 chain recorded during the retired run makes it pass over a retired box someone else's mix moved. |
| critic#6 | nit | for the owner | Settings' Lovejoin row says returns are mixed on the switch alone. It describes the setting, as the connector's lines did; left as it is. |
| critic#7 | nit | W10 | `adaPoolOf`'s doc comment sits above `retiredOf`. |

The critic closed 18 of its 22 gaps. The four left: Chrome's real order of Home's read and the first run; an e2e of the first unlock; the panel width; a stuck retired token pool on mainnet. The e2e is in the e2e lane now.
