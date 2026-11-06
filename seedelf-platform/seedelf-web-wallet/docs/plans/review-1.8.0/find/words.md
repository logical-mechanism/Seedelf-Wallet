# 1.8.0 release review: words

Lens: the words and translations 44a and 44b added or changed (`git diff c15603d5 a6c94743 -- …/extension/src/i18n …/docs/i18n`), every place each is shown, the 10 ₳ → 5 ₳ sweep, and the guards.

Sandbox: `SANDBOX=/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/wt/words`. Every command runs from `$SANDBOX/seedelf-platform/seedelf-web-wallet/extension`. The scratch tests named below are in its `tests/`, named `words-scratch-*.test.ts`. Every mutation was restored after its run, and `git status` is clean apart from the scratch tests.

Overlaps with the screens lens, for the lead to dedupe: words#2 ≈ screens#2, words#5 ⊃ screens#9, words#7 ≈ screens#1, words#12 ≈ screens#7.

### words#0: The swap's review, its approval and Stop's dialog call v2's 5 ₳ boxes "boxes of 10 ₳"

- **Severity:** low · **Kind:** words · **Introduced:** new · **Proven:** test
- **Where:** `extension/src/i18n/translations/en.json:2262-2265` (`swaps.boxes.atMost_*`, `swaps.boxes.roomFor_*`), `en.json:2272` (`swaps.cost.boxesLabel`); `es.json:2400-2405`, `es.json:2412`; `ja.json:2124-2125`, `ja.json:2132`; `extension/src/ui/screens/Swaps.tsx:1651` (`boxesText`), `:1634`, `:1679`, `:2899`; `extension/src/background/sessions.ts:1757-1803` (`priced`); `extension/tests/screens.test.ts:353`, `:366`, `:446`, `:570`.
- **Claim:** 44b moved a swap's ADA boxes from the classic pool into v2's 5 ₳ pool: `priced` reads `adaPool` and counts boxes only for it. But the three swap frames that name the box value still say 10 ₳, in all three languages:
  - the review's row "Boxes of 10 ₳";
  - the approval's "If you stop it or the order is refunded … at most N boxes of 10 ₳";
  - Stop's "Its ADA goes through Lovejoin first: at most N boxes of 10 ₳".

  44b's sweep changed the dApps tile, Lovejoin's aside, Settings' note and the connector's lines, but not these.
- **Scenario:** A swap approved through Lovejoin, one wave deep, funded with 40 ₳ plus 15.3 ₳ for its token's boxes. Stop prices 9 boxes of the 5 ₳ pool, and the dialog says "at most 9 boxes of 10 ₳". That is 90 ₳ of boxes out of 55.3 ₳ funded. A 6 ₳ swap's 12 ₳ funding is said to come back as "at most 1 box of 10 ₳", though a 10 ₳ box plus about 4.1 ₳ of fees can't come out of 12 ₳.
- **Evidence:**
  - **Trace.** At `sessions.ts:1757`, `const ada = await lovejoin.adaPool(network)`. Both `funding` calls take `ada`, and `affordable` and `fits` are 0 without it. So every box a swap's quote counts is a box of `adaPoolOf`'s pool, whose `p.lovelace === COLLATERAL_LOVELACE` (5 ₳). `boxesText` (`Swaps.tsx:1651`) and the label (`:1679`) are fixed text. The planner's own test comment says the same boxes are 5 ₳: "6 boxes of 5.95 ₳ without the boxes' ADA, 9 with it" (`tests/lovejoin-planner.test.ts:1169`).
  - **Scratch test.** `tests/words-scratch-swapboxes.test.ts` uses the planner's real WebAssembly, `ADA_POOL` and `ADA_ROWS`. `npx vitest run tests/words-scratch-swapboxes.test.ts --maxWorkers=2 --silent=false` gives 2 passed, with `stop.boxes === 9` and `ADA_VIEW.boxLovelace === "5000000"`. It prints:
    - `STOP DIALOG: … Its ADA goes through Lovejoin first: at most 9 boxes of 10 ₳, about 8.55 ₳ in mix fees and 2.7 ₳ to bring them back, each after 1 to 6 hours.`
    - `IFSTOPPED: {"boxes":1,"mixes":4,…} fund 12000000`
    - `COST ROWS: On the way back, through Lovejoin Boxes of 10 ₳ About 1, at most …`
  - **Mutation.** With 10 ₳ changed to 5 ₳ in these keys (en, es and ja), `npx vitest run tests/screens.test.ts tests/swap-page-words.test.ts tests/swap-page.test.ts tests/i18n.test.ts --maxWorkers=2` gives 3 failed, 137 passed. The tests pin the stale words: `screens.test.ts:353` ("Boxes of 10 ₳ About 4, at most"), `:366`, `:446` and `:570` ("at most 1 box of 10 ₳").
- **Fix:** Name the ADA box's value from the pool, as a return's review does (`partsText`, `values`), or at least say 5 ₳ in all seven keys (es `_many` included). Then update `screens.test.ts:353/366/446/570` and the comment at `Swaps.tsx:1650`.

### words#1: The connector's approval promises mixing, where 1.8.0 brings the return back directly until the 5 ₳ pool holds 30 other boxes

- **Severity:** low · **Kind:** words · **Introduced:** reachable · **Proven:** trace
- **Where:** `extension/src/ui/screens/DappApprovals.tsx:533`, `:488`, `:921`; `en.json:348-349` (`dappUi.back.privacy.noteLovejoin`, `.noteLovejoinMixed`), `en.json:468` (`dappUi.private.privacy.staysLovejoin`); `es.json:366-367`, `:490`; `ja.json:330-331`, `:446`.
- **Claim:** The connector's lines for a private session are chosen from Settings and the network alone: `lovejoinBack = prefs.lovejoinReturns && lovejoinOn(network)`, and `lovejoinOn` is `NETWORKS[network].lovejoin !== undefined`. They read no pool. They say "Spare ADA is mixed through Lovejoin so it's harder to tie to this session … back hours later" and "Lovejoin mixes the spare ADA … back in 5 ₳ boxes hours later". By the owner's call 4, a return comes back directly until v2's 5 ₳ pool holds 30 other boxes on mainnet, and 1.8.0 starts that pool empty. The swap's approval reads the pool and says "Only if Lovejoin's pool has room when it comes back" (`swaps.lovejoin.privacy.onPoolShort`, `Swaps.tsx:1590-1596`). The connector's doesn't. The plan's 44c names only the half where no pool is known (the head start), not the floor.
- **Scenario:** Mainnet, with the 5 ₳ pool launched but holding fewer than 30 others. A site's private session is approved under "Spare ADA is mixed through Lovejoin". Its return then says "Right now Lovejoin's pool holds 12 boxes that aren't yours, under the 30 it needs", and comes back directly unless the user waits. The return's review does warn before anything is sent, so privacy isn't lost silently. The approval's critical promise is false for as long as the pool is short.
- **Evidence:**
  - **Trace.** `DappApprovals.tsx:533` → `:771` (`FundingWayBack`'s `lovejoin`) → `:488`, and `:921`. `networks.ts:136` and `networks.ts:71` (mainnet `poolFloor: 30`). The return's floor check is at `sessions.ts:6129-6131` (`poolShort`), and so is the collateral's (`lovejoin.ts` `collateralPool`).
  - **Render.** `tests/words-scratch-wayback.test.ts` renders `FundingWayBack`, which takes no pool state at all.
- **Fix:** Either make Bootstrapping mainnet's 5 ₳ pool to its floor a condition of shipping, beside the head start (44c). Or qualify the connector's lines as the swap's approval does, from the last kept room, and back-translate them, since they're critical.

### words#2: On a retired pool's page, the retired pools' run says "every box in this pool", counting every retired pool's boxes

- **Severity:** low · **Kind:** words · **Introduced:** new · **Proven:** test
- **Where:** `extension/src/ui/components/BringAllBack.tsx:285-288` (`goingText`), `:58-59` (`coversRun`); `extension/src/ui/screens/Lovejoin.tsx:3567`; `extension/src/background/lovejoin.ts:6792`; `en.json:1999-2000`, `es.json:2128-2130`, `ja.json:1870` (`lovejoin.bring.going_*`).
- **Claim:** The first unlock's Bring every box back runs over every retired pool: `Bringing.retired`, whose scope is `old.has(p)` (`lovejoin.ts:6792`). A retired pool's page follows that run (`coversRun`'s `retired`). `goingText` gives every pool's run and Settings their own words, but on a pool's page the retired run falls through to `lovejoin.bring.going`: "Bringing every box in this pool back: N sent back so far. M left." N and M count every retired pool's boxes, and the Stop under the line stops all of them. Before 44b (`c441881e`), any run without `pool` said "Bringing every box back" on a pool's page too. By trace alone: on a v2 pool's page the same run reads "Another pool's boxes are coming back now", a single pool where it's several.
- **Scenario:** A 1.7 user holds boxes in the classic pool and in 8131b1d's 5 ₳ pool. They unlock 1.8.0, and `retireOnce` asks for the retired pools' run. They open the classic pool's page: "Bringing every box in this pool back: 5 boxes sent back so far. 3 boxes left." Some of those boxes are the other pool's.
- **Evidence:** `tests/words-scratch-bring.test.ts` renders `BringAllBackView` with `{back: 5, left: 3, retired: true}`. `npx vitest run tests/words-scratch-bring.test.ts --maxWorkers=2 --silent=false` gives 1 passed, and prints:
  - `POOL PAGE (en): Bringing every box in this pool back: 5 boxes sent back so far. 3 boxes left. …`; es "Trayendo todas las cajas de este pool de vuelta…"; ja "このプールのすべてのボックスを戻しています…".
  - `SETTINGS (en): Bringing every box in the retired pools back: …`
  - Every pool's run, on a pool page: `Bringing every box back: …`
- **Fix:** In `goingText`, use `settings.lovejoin.bringingRetired` for `b.retired` on a pool's page too; its words fit there. Optionally, give `lovejoin.bring.other` a retired variant ("The retired pools' boxes are coming back now").

### words#3: Three critical privacy lines changed in es and ja after their last back-translation, and no fresh one is recorded

- **Severity:** low · **Kind:** words · **Introduced:** new · **Proven:** mutation
- **Where:** `docs/i18n/verified-critical-es.json:2` (reviewer) and `:477-478`; `docs/i18n/verified-critical-ja.json:2` and `:477-478`; `es.json:366`, `:367`, `:490`; `ja.json:330`, `:331`, `:446`; `ja.json:2999`.
- **Claim:** `50cd76b4` changed the es and ja values of three critical keys (10 ₳ → 5 ₳). All three are machine drafts that the verified lists pass by key alone. Nothing records a fresh back-translation of them:
  - `431955dd` says only "The new reasons are back-translated".
  - Neither verified file's reviewer note has a 1.8.0 entry, though every release through 1.7.2 wrote its round there.
  - The two new keys' round isn't recorded either.
  - ja `lj.unusable.warn.retired` was changed in that same commit, after its first round. Whether the corrected value passed blind again isn't said; the house rule is "each passed blind again" (`docs/archive/roadmap.md:115`).
- **The list the brief asks for:** the critical keys whose es or ja value changed after their last back-translation.

  | Language | Key | Change |
  |---|---|---|
  | es | `dappUi.back.privacy.noteLovejoin` | 10 → 5 |
  | es | `dappUi.back.privacy.noteLovejoinMixed` | 10 → 5 |
  | es | `dappUi.private.privacy.staysLovejoin` | 10 → 5 |
  | ja | `dappUi.back.privacy.noteLovejoin` | 10 → 5 |
  | ja | `dappUi.back.privacy.noteLovejoinMixed` | 10 → 5 |
  | ja | `dappUi.private.privacy.staysLovejoin` | 10 → 5 |
  | ja | `lj.unusable.warn.retired` | corrected after its first round; re-check not recorded |

  A script comparing every critical key's es and ja value at `c15603d5` with `a6c94743` finds exactly those three changed keys, plus the two new ones (`sess.skip.warn.noAdaPool`, `lj.unusable.warn.retired`), all `machine` and listed as verified.
- **Scenario:** CI passes any value of these keys.
- **Evidence:**
  - `git log c15603d5..a6c94743 -- docs/i18n/verified-critical-*.json` shows only `431955dd`, which adds two keys and no reviewer text.
  - **Mutation.** With all three keys' es and ja values changed to "50 ₳", `npx vitest run tests/i18n.test.ts tests/i18n-critical-helpers.test.ts tests/i18n-screens.test.ts tests/i18n-values-in-place.test.ts tests/i18n-review-fixes.test.ts tests/i18n-assembly.test.ts tests/i18n-joins.test.ts tests/i18n-worker-reasons.test.ts tests/approvals-review-fixes.test.ts tests/dapp-prompt.test.ts --maxWorkers=2` gives 10 files, 218 passed.
  - My own reading, which isn't blind: all six still say what the English says, the number aside. words#6 is the one meaning change the edit brought, and it's in the English too.
- **Fix:** Back-translate the six values blind, and ja `lj.unusable.warn.retired`'s final value. Add a 1.8.0 entry to both reviewer notes naming the keys, as 1.7.2's does. To let CI see staleness, the verified lists could record a hash of each verified value, so a changed value drops out of the set.

### words#4: `sess.skip.warn.noAdaPool` reads false on the session's page once a 5 ₳ pool exists

- **Severity:** low · **Kind:** words · **Introduced:** new · **Proven:** test
- **Where:** `en.json:1882`, `es.json:2000`, `ja.json:1764`; `extension/src/background/lovejoin.ts:3517`; `extension/src/background/sessions.ts:1803`, `:4836-4839` (saved); `extension/src/ui/components/LovejoinReturn.tsx:446-452`; `extension/src/ui/screens/SiteSessions.tsx:452`; `Swaps.tsx:2519`, `:2582`.
- **Claim:** A return built while no 5 ₳ pool is shown saves its reason with the session (`lovejoinSkipped`): "Lovejoin has no pool of 5 ₳ boxes to take it yet" (es "aún no tiene", ja "まだ…ありません"). The session's page keeps showing it in the past frame: "Lovejoin was left out of its return: Lovejoin has no pool of 5 ₳ boxes to take it yet." Once a pool is found, that sentence is false. The house fixed the same thing in `sess.skip.warn.collateralComing` by putting it in the past tense (1.5.0's last review, L9; `docs/archive/plans/chunk-32-found-session-collateral.md:41`). It also speaks for Lovejoin where it means what the wallet found: a pool on chain that discovery hasn't handed over yet (preprod before 44c's head start) gets the same words. With the head start carrying the pool, it's rare in a release build.
- **Scenario:** Discovery lists only 8131b1d's retired 5 ₳ pool. A site's session comes back directly, saying `noAdaPool`. Discovery then lists v2's pool, and `adaPool` returns it, but the session's page still says Lovejoin has no pool.
- **Evidence:** `tests/words-scratch-saved.test.ts`, first test, runs the real WebAssembly:
  - `backBuild` gives `lovejoinSkipped` = `noAdaPool`, then `backSubmit`;
  - `pools.push(ADA_POOL)`, and `lj.adaPool("preprod", true)` now gives `ADA`;
  - `sessions.list("preprod", true)[0].lovejoinSkipped` is still `noAdaPool`.

  It prints `SESSION PAGE (past, en): Lovejoin was left out of its return: Lovejoin has no pool of 5 ₳ boxes to take it yet. So it comes back directly, tied to the session on chain.`, and es and ja say the same. `npx vitest run tests/words-scratch-saved.test.ts --maxWorkers=2 --silent=false` gives 2 passed.
- **Fix:** Use a past-tense, wallet-side reason that stays true later, such as "the wallet knew of no pool of 5 ₳ boxes to take it". Back-translate it, since it's critical.

### words#5: The retired reason, written for a pool's page, is also a return's saved reason, where "This pool" and "Your boxes in it" name nothing

- **Severity:** low · **Kind:** words · **Introduced:** new · **Proven:** test
- **Where:** `extension/src/background/lovejoin.ts:3522-3530`, `:4047`, `:2499-2504`; `en.json:3170`, `es.json:3341`, `ja.json:2999`; `LovejoinReturn.tsx:417`, `:451`; `extension/src/ui/screens/Lovejoin.tsx:909` (`detailOf` → `lj.leftOut`); `extension/src/ui/screens/ClaimAll.tsx:363`.
- **Claim:** `chain()` turns a retired pool's refusal into `LovejoinSkipped(e.message)`. So the return of a 1.7 mix session, or a 1.7 Mix again, saves `lj.unusable.warn.retired` as its reason; the plan calls this "saying the pool is retired". That value is two whole sentences written for the pool's own page. In the return's frames no pool is named, so "This pool" points at nothing. "Your boxes in it come back by themselves" (es "Tus cajas aquí", ja "ここにある…") sits beside "Came back without going into Lovejoin", about money that never went in. The same shape has existed for `superseded` and `belowMinimum` since 34g (CROSS-1); the retired reason is the one 1.8.0 makes reachable for every 1.7 mix left over.
- **Scenario:** A 1.7 mix session, funded but not yet chained when the wallet updates.
  - The return's review: "Lovejoin is left out of this return: This pool runs Lovejoin's retired scripts: the wallet puts no new box in it, and mixes none again. Your boxes in it come back by themselves. Everything comes back directly, unmixed."
  - The hub's mix row: "Lovejoin was left out: This pool runs …"
- **Evidence:**
  - `tests/lovejoin-retired.test.ts:233-250` asserts the saved reason is `tr("lj.unusable.warn.retired")`.
  - `tests/words-scratch-saved.test.ts` (second test) renders the return's review and the session's page in en, es and ja.
  - `tests/words-scratch-detail.test.ts` renders `detailOf`: `MIX ROW (en): Lovejoin was left out: This pool runs Lovejoin's retired scripts: … Your boxes in it come back by themselves.` `npx vitest run tests/words-scratch-detail.test.ts --maxWorkers=2 --silent=false` gives 1 passed.
- **Fix:** In `chain()`, map `retired` to a clause of its own, a new `sess.skip.warn.poolRetired` such as "the pool it was funded for runs Lovejoin's retired scripts, which take no new box". Keep `lj.unusable.warn.retired` for the pool's page, and back-translate the new key.

### words#6: "the 5 ₳" (the collateral) now reads as the 5 ₳ boxes, in two privacy lines

- **Severity:** low · **Kind:** words · **Introduced:** new · **Proven:** test
- **Where:** `en.json:348-349`, `es.json:366-367`, `ja.json:330-331`; `DappApprovals.tsx:478`, `:488`, `:756`.
- **Claim:** The 10 → 5 edit put two different "5 ₳" side by side. The section reads: "Through Lovejoin first, about 4.1 ₳ a 5 ₳ box … back in 5 ₳ boxes hours later. The rest and the 5 ₳ come back at once." Here "the 5 ₳" is the collateral, kept aside on the row "Kept aside for contracts" further up. Right after "5 ₳ boxes", though, it reads as the boxes, so the line seems to say they come back both hours later and at once. The mixed variant has the same problem ("in 5 ₳ boxes, and the 5 ₳ once"), and so does ja ("5 ₳ のボックスとして数時間後に戻ります。残りと 5 ₳ はまとめてすぐに戻ります"). With 10 ₳ boxes the two numbers told them apart. `dappUi.back.noteDirect` already names it "the 5 ₳ kept aside".
- **Evidence:** `tests/words-scratch-wayback.test.ts` renders `FundingWayBack` in en, es and ja. `npx vitest run tests/words-scratch-wayback.test.ts --maxWorkers=2 --silent=false` gives 1 passed and prints `WAY BACK (en): … Through Lovejoin first, about 4.1 ₳ a 5 ₳ box … back in 5 ₳ boxes hours later. The rest and the 5 ₳ come back at once. …`
- **Fix:** Say "the 5 ₳ kept aside" in both lines (es "los 5 ₳ apartados", ja "確保分の 5 ₳", as `noteDirect` has them), and back-translate them.

### words#7: A retired token pool whose boxes can't pay their own way back says both that they come back by themselves and that they wait for the fees

- **Severity:** low · **Kind:** words · **Introduced:** new · **Proven:** test
- **Where:** `en.json:3170` (`lj.unusable.warn.retired`), `en.json:1342` (`lovejoin.stuck.warn.lead`); `Lovejoin.tsx:3131`, `:3484`.
- **Claim:** The retired reason ends, with no condition, "Your boxes in it come back by themselves". In a retired 8131b1d token pool whose boxes can't pay their own way back under today's fees, the same page's stuck callout says "This pool's boxes wait in it, and come back by themselves only if the fees drop enough." Elsewhere the house leaves "come back by themselves" out where a pool is stuck (`BootstrapHeld`, session 5's cross-area review, L2).
- **Scenario:** An 8131b1d MIN pool (4.5 ₳ + 100 MIN a box) holds two of the wallet's boxes, and the price of a byte has risen far enough that a box can't pay its own way back. This needs the fees to rise, so it's an edge case.
- **Evidence:** `tests/words-scratch-stuck.test.ts` renders `PoolPage` with `{unusable: {why: "retired"}, cantComeBack: {…}}` and no version (`Pools.isRetired` is true). `npx vitest run tests/words-scratch-stuck.test.ts --maxWorkers=2 --silent=false` gives 1 passed. The page reads: "… This pool's boxes wait in it, and come back by themselves only if the fees drop enough. … This pool runs Lovejoin's retired scripts: … Your boxes in it come back by themselves." The retired reason appears a second time under Mix's Review.
- **Fix:** Where `cantComeBack`, show the retired reason without its last sentence: a second key, back-translated.

### words#8: The retired reason is critical by its name alone; its run-time route into the return's warnings is neither followed nor listed

- **Severity:** low · **Kind:** test · **Introduced:** new · **Proven:** mutation
- **Where:** `lovejoin.ts:4047`, `:3528`; `extension/tests/i18n-worker-reasons.test.ts:43-48` (`REASON_*`), `:66-83` (`RUNTIME`).
- **Claim:** The worker-reasons guard holds every reason the worker gives a warning to the critical set. It follows literal routes, and lists by hand (`RUNTIME`) the ones that arrive as an error's words. `lj.unusable.warn.retired` reaches the return's warnings (`skippedThis`, `skippedIts`, `lj.leftOut`, `claim.warn.skippedItem`) as `new Error(unusableReason(why))` → `new LovejoinSkipped(e.message)`. That route is neither followed nor listed. The pool's page shows the reason through `unusableText`, which the deriver doesn't follow either. So only the `.warn.` in its name keeps it critical: renamed without it, CI passes, and the reason would ship unchecked inside a checked frame, which is the failure the guard was written for (the review of 2026-10-04). The same route has carried `superseded` and `belowMinimum` since 34g.
- **Evidence:**
  - **M8.** Rename `lj.unusable.warn.retired` → `lj.unusable.retired` in en, es and ja, both provenance files, `Lovejoin.tsx`, `lovejoin.ts` and the three tests that name it. Drop it from both verified lists and run `node scripts/i18n-critical.mjs --write`, after which `critical-keys.json` no longer has it. Then `npx vitest run tests/i18n.test.ts tests/i18n-worker-reasons.test.ts tests/i18n-critical-helpers.test.ts tests/i18n-screens.test.ts tests/i18n-assembly.test.ts tests/i18n-review-fixes.test.ts tests/i18n-values-in-place.test.ts tests/i18n-joins.test.ts tests/worker-words.test.ts tests/words.test.ts tests/lovejoin-retired.test.ts tests/lovejoin-release-rules.test.ts tests/lovejoin-flows.test.ts --maxWorkers=2` gives 13 files, 258 passed.
  - **M9, the contrast.** The same rename of `sess.skip.warn.noAdaPool`, a literal route, fails "is accuracy-critical, or a word it borrows" (1 failed, 55 passed).
- **Fix:** Add `unusableReason` to `REASON_FUNCTIONS`, so the scan holds its three `lj.unusable.warn.*` keys, or follow `e.message` into `LovejoinSkipped` in `chain()`.

### words#9: Untested: the retired run's words in Settings

- **Severity:** low · **Kind:** test · **Introduced:** new · **Proven:** mutation
- **Where:** `BringAllBack.tsx:288`, `:368`.
- **Claim:** No test renders `settings.lovejoin.bringingRetired` or `settings.lovejoin.bringNoneRetired`. Replacing both with the one-pool words passes every Bring every box back test. `lovejoin-retired.test.ts:441-459` holds `doneOf` alone.
- **Evidence:** Make two edits in `BringAllBack.tsx`:
  - `b.retired ? "settings.lovejoin.bringingRetired" : "settings.lovejoin.bringingPool"` → `"settings.lovejoin.bringingPool"`;
  - `: doneRetired` → `: false && doneRetired`.

  Then `npx vitest run tests/lovejoin-bring-all-back.test.ts tests/settings.test.ts tests/lovejoin-bring-screen-review-fixes.test.ts tests/lovejoin-bring-review-fixes.test.ts tests/lovejoin-retired.test.ts tests/screens-wiring-review-fixes.test.ts --maxWorkers=2` gives 6 files, 147 passed.
- **Fix:** Render `BringAllBackView` with a retired run going and done in Settings, and on a pool's page once words#2 is fixed.

### words#10: Untested: the hub's "No pool to mix in yet"

- **Severity:** low · **Kind:** test · **Introduced:** new · **Proven:** mutation
- **Where:** `Lovejoin.tsx:2003-2008`.
- **Claim:** `98ab4ba5` fixed the hub saying "No pool's token matches “”." when nothing was searched for (the owner's test of 44b). The fix has no test: reverting it passes every Lovejoin screen test. No unit test or e2e spec names `lovejoin.pools.noneYet`, `lovejoin.pools.noneMatch` or `lovejoin-pools-none`.
- **Evidence:** With line 2007 reverted to `{tr("lovejoin.pools.noneMatch", { query: query.trim() })}`, `grep -rln 'screens/Lovejoin"' tests/*.test.ts | xargs npx vitest run --maxWorkers=2` gives 25 files, 499 passed.
- **Fix:** Render the hub with every pool retired and nothing of the wallet's in them: it says `noneYet`, never `noneMatch`. With a query typed, it says `noneMatch`.

### words#11: Five comments still say a session's or a swap's boxes are 10 ₳

- **Severity:** nit · **Kind:** words · **Introduced:** new · **Proven:** reading
- **Where:** `DappApprovals.tsx:435`, `:530`; `Swaps.tsx:1650`; `extension/src/shared/rpc.ts:1664`, `:2042`.
- **Claim:** Since 44b these boxes are v2's 5 ₳ boxes. Others have been stale since 1.6.0's token pools ("every box is 10 ₳": `Home.tsx:1468`, `Lovejoin.tsx:6`, `:45`, `preferences.tsx:6`, `:90`). `PendingBanner.tsx:242`'s "10 ₳ in the classic pool" is still true.
- **Scenario:** Someone keeping the code is misled.
- **Evidence:** Reading.
- **Fix:** Say 5 ₳, or "a box".

### words#12: Lovejoin's aside says "in 5 ₳ boxes" only where no 5 ₳ pool is known

- **Severity:** nit · **Kind:** words · **Introduced:** new · **Proven:** trace
- **Where:** `Lovejoin.tsx:1922`, `:1929`; `en.json:982`, `es.json:1029`, `ja.json:935`. Same as screens#7.
- **Claim:** `tokenPools = pools.some((p) => p.id !== undefined)`, and `pools` is the classic pool plus every pool the status lists. v2's 5 ₳ pool has an id, so once it's known the aside reads "A mixer for ADA and tokens". The sweep's "A mixer for ADA, in 5 ₳ boxes" therefore shows only while the status lists the classic pool alone, and then there is no 5 ₳ pool. In 1.7 it said 10 ₳ in exactly that state, which was true then.
- **Scenario:** Mainnet before the v2 pool is found, with no box in 8131b1d's pools: "A mixer for ADA, in 5 ₳ boxes" above "No pool to mix in yet."
- **Evidence:** Trace: `Lovejoin.tsx:1849` (`poolsOf(status)`), `:1922`, `:1929`; `lovejoin-pools.ts:52`.
- **Fix:** Key the aside on whether a token pool is shown (`p.box.token`), not on whether any pool has an id.

### words#13: No glossary row for the retired pools' new terms

- **Severity:** nit · **Kind:** docs · **Introduced:** new · **Proven:** reading
- **Where:** `docs/i18n/glossary.md`: the term table has no row for them.
- **Claim:** 44b's critical lines use "Lovejoin's retired scripts" and "the retired pools": es "scripts retirados", "pools retirados"; ja "廃止済みのスクリプト", "廃止されたプール". `431955dd` settled a choice ("Japanese's 'retired' now binds to the scripts, never to Lovejoin"). The glossary records neither, where every earlier Lovejoin term has a row (a copy, the pool of 5 ₳ boxes, Bring every box back now). es "retirado" also sits near the glossary's warning about "retiro", a withdrawal.
- **Scenario:** The next translation of these words drifts from the choice 44b made.
- **Evidence:** `grep -n -i 'retired\|廃止\|retirad' docs/i18n/glossary.md` finds only the DRep row.
- **Fix:** Add a row: retired (a Lovejoin pool, its scripts) | los scripts retirados de Lovejoin; los pools retirados | 廃止済みのスクリプト; 廃止されたプール | bound to the scripts, never to Lovejoin.

## Covered

- **Every new or changed key, read in en, es and ja for meaning, style, the Seedelf name and numbers.**
  - New: `lj.unusable.warn.retired`, `sess.skip.warn.noAdaPool`, `lovejoin.pools.noneYet`, `settings.lovejoin.bringNoneRetired`, `settings.lovejoin.bringingRetired_*`.
  - Changed: `dappUi.back.lovejoinValue`, the three privacy lines, `dapps.lovejoin.what`, `lovejoin.aside`, `settings.lovejoin.note`, `lj.launch.classicCopy`.
  - Each translation says what its English says, apart from words#6 and words#4. None names the wallet. Every new value has U+00A0 before ₳. `lj.launch.classicCopy`'s plain space before ₳ is old, and 47 en values have one.
- **The connector's figure.** `boxCost` is mixes × the mix fee plus the way back, whatever the box holds, so "about 4.1 ₳ a 5 ₳ box" is true.
- **The 10 ₳ sweep in en, es and ja.**
  - What still says 10 ₳ is the launch rule, kept by the owner's call: `lovejoin.start.warn.cost`, `lovejoin.launch.adaNote`, `lj.launch.classicCopy` and `lovejoin.pool.asideClassic`.
    - "About 23 ₳ … never comes back" still holds on v2: core's `lovejoin_launch_test.rs:177` keeps the locked total within 23–24 ₳.
    - "No wallet shows such a copy" holds: `background/lovejoin-pools.ts:483` never shows an ADA pool of 10 ₳.
  - The other 10 ₳ words are the swap's (words#0).
  - I read all 40-odd values that name "Lovejoin's pool" or "the pool". Each names the pool its context reads. The collateral's lines say "Lovejoin's pool of 5 ₳ boxes", which is v2's pool now. No value says "the 5 ₳ pool", which the glossary forbids.
  - The store listing has no 10 ₳. The privacy policy's 10 ₳ is in a dated past entry. Core and WebAssembly added no message strings.
- **The frames each new reason is shown in.**
  - `noAdaPool` fires only for a return with no 5 ₳ pool: `poolNamed` throws `lj.poolUnknown` rather than return nothing, so a mix session never gets it.
  - `swaps.lovejoin.warn.pool` and `swaps.stop.poolShort` are read at review and never saved; `claim.warn.skippedItem` is present tense. All three read true with `noAdaPool`.
  - The retired reason reads true later, since retirement is for good; words#5 is about its frames, not its tense.
- **`NotMixed`'s "never comes back by itself" can't show in a retired pool.** The status's `notMixed` is `its(unmixed)`, and `sortOut` drops a retired pool's boxes from `unmixed`, `unsure` and `deposits` (`41e1c03e`).
- **`lovejoin.pools.noneYet`** shows only when nothing is listed and nothing searched for, and then no pool takes a box.
- **The guards.** The ten i18n and words test files pass at `a6c94743` (191 tests).
  - M1: dropping `lj.unusable.warn.retired` from `verified-critical-es.json` fails "es.json has no unchecked machine draft among them".
  - M2: dropping `sess.skip.warn.noAdaPool` from `critical-keys.json` fails "is derived from the source, and the checked-in list matches".
  - M9 is caught too (words#8).
  - The negation lists match both new critical values in es and ja (ja through ません).
  - Provenance: every new key is recorded in both files, and ja has `_other` alone.
- **The worker's rules.** 44a and 44b add no module-level `t()` and no comparison of translated text.

## Not checked

- **A blind back-translation.** I had no second agent. My reading of the six changed values and the two new keys isn't blind.
- **The privacy policy's Changes.** Its newest entry is 30 October 2026, and 44a and 44b add none. 44b's first-unlock bring-back sends every retired pool's boxes back-to-back, through giveme.my, without being asked, and a return now asks discovery once where it kept none. Both may owe a dated entry in the same PR (the brief's rule). That's the docs or privacy lens; I didn't judge it.
- **The e2e specs' words** (the tests-e2e lens), and the Playwright run.
- **Whether a stuck retired token pool exists on mainnet** (words#7): that needs the network.
