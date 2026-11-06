# critic: the find round's completeness (1.8.0 release review, round two)

Lens: what the nine finders left out. I read every report's findings, *Covered* and *Not checked* (`find/*.md`), `FINDINGS.md` (its opening: the owner's call of 2026-11-06 overrides 44c's head-start gate) and the plan, then closed what I could in the sandbox.

- **Tree:** `a6c94743`, in the sandbox `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/wt/release`. Paths below are under `seedelf-platform/seedelf-web-wallet/extension/` unless they say otherwise.
- **Scratch tests:** `tests/critic-scratch.test.ts` (six tests) and `tests/critic-scratch-restore.test.ts` (one). Copies are kept outside the sandbox at `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/critic-scratch.test.ts.copy` and `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/critic-scratch-restore.test.ts.copy`.
  - Each test asserts what `a6c94743` does and prints what a person reads.
  - From the extension folder, `npx vitest run tests/critic-scratch.test.ts tests/critic-scratch-restore.test.ts --maxWorkers=2 --silent=false` gives **7 passed**. With `VITE_ENABLE_MAINNET=false`: **7 passed**.
- **The one mutation** (critic#5) was put back from a copy. `git diff --stat` in the sandbox is empty.
- **Not re-reported:** what `FINDINGS.md` already has. Where a finding here is a new member of a cluster, it says which.

## Findings

### critic#0

- **Title:** The floor's reason, saved with a session, reads false once the pool fills. 1.8.0 makes it every mainnet return's reason until v2's 5 ₳ pool holds 30 others.
- **Severity:** low · **kind:** words · **introduced:** reachable · **proven:** test
- **Where:**
  - `src/background/lovejoin.ts:3401-3405` (`floorShort`) and `:3604-3605` (fanOut throws it)
  - `src/background/sessions.ts:6097-6098` (`leftOut`), `:4839` and `:4957` (saved as `lovejoinSkipped`)
  - `src/ui/components/LovejoinReturn.tsx:446-452` (`lovejoin.warn.skippedIts`)
  - `src/i18n/translations/en.json:940-941` (`lj.skip.warn.floorShort`, critical) and `:1261`
- **Claim:**
  - A return built under the floor saves `lj.skip.warn.floorShort` with its session: "Lovejoin's pool holds {{count}} boxes not yours, and the wallet mixes only from {{floor}}".
  - The session's page shows it later in the past frame, and the count is the count from when the return was built.
  - O4's defect, in another critical key. O4 names only `noAdaPool`.
  - In 1.7 this reason needed the classic pool's crowd under 30. In 1.8.0 every mainnet session's return saves it, from the 5 ₳ pool's launch until that pool holds 30 boxes that aren't the user's.
- **Scenario:**
  1. Mainnet. v2's 5 ₳ pool holds 20 boxes that aren't the user's. A site's session comes back directly for the floor.
  2. Later the pool holds 40.
  3. The session's page still says: "Lovejoin was left out of its return: Lovejoin's pool holds 20 boxes not yours, and the wallet mixes only from 30. So it comes back directly, tied to the session on chain."
- **Evidence:** `npx vitest run tests/critic-scratch.test.ts -t "floor's reason" --maxWorkers=2 --silent=false` passes:
  - The floor is set to 30, and the pool holds 20 others.
  - `backBuild` gives `lovejoinSkipped` = `floorShort(20, 30)`, and then `backSubmit`.
  - 20 more strangers' boxes are added and the clock moves 6 minutes. `room` then prints `ROOM NOW: {"others":40,"free":40}`.
  - `sessions.list` still holds the same reason, and the page renders `SESSION PAGE (past frame, pool now at 40): Lovejoin was left out of its return: Lovejoin's pool holds 20 boxes not yours, and the wallet mixes only from 30. So it comes back directly, tied to the session on chain.`
- **Fix:**
  - Use O4's fix here too: a saved form that stays true later, for example "Lovejoin's pool held {{count}} boxes not yours then, …". Or save the reason's kind and render a past-tense key on the session's page.
  - Back-translate the new value blind in es and ja.
  - Put it in O4.

### critic#1

- **Title:** Under the 5 ₳ pool's floor, a by-hand session whose 5 ₳ is gone is told its collateral is what's missing and offered 5 ₳. Once that's in, it comes back directly for the floor.
- **Severity:** low · **kind:** code · **introduced:** reachable · **proven:** test
- **Where:**
  - `src/background/sessions.ts:4694-4702` (`collateralWanted`: needs a 5 ₳ pool shown, never its floor)
  - `sessions.ts:4466` (`NO_COLLATERAL`), `:2336` (the offer's check, through `lovejoinWantsCollateral`), `:5672-5673` (the view's `backCollateral: "missing"`)
  - `src/ui/screens/Swaps.tsx:3345` and `:3428` ("put one in from your private balance", and its button)
  - `en.json:1883` (`sess.skip.warn.noCollateral`, critical)
- **Claim:**
  - `collateralWanted` says a box of the spare ADA wants the collateral wherever a v2 5 ₳ pool is shown. It never asks whether that pool takes a box now.
  - Under the floor, a session brought back by hand with no 5 ₳ at its account gets two things wrong:
    - its review names the collateral as the reason Lovejoin is left out;
    - its page offers to put 5 ₳ in from the private balance.
  - Once the 5 ₳ is in, the return still comes back directly, now saying the floor's reason. The top-up's fee bought nothing, and the first reason named the wrong cause.
  - tests-unit#9 and O2 cover only the case with no pool, where the `ada &&` check already holds.
- **Scenario:**
  1. Mainnet, with the 5 ₳ pool under 30 others.
  2. After a restore, a found session holds 40 ₳ and no 5 ₳ of ADA alone, because a site's transaction spent it.
  3. Its page says "Nothing is waiting. To bring its spare ADA back through Lovejoin, the mixes need a UTxO of exactly 5 ₳ … put one in from your private balance."
  4. The user puts it in. Bring it back then says "Lovejoin's pool holds 20 boxes not yours, and the wallet mixes only from 30" and comes back directly.
- **Evidence:** `npx vitest run tests/critic-scratch.test.ts -t "by-hand" --maxWorkers=2 --silent=false` passes. The setup is the floor at 30, the pool holding 20 others, and a session with no site, swap or mix record and 40 ₳ at its account. It prints:
  - `NO 5 ₳: {"skipped":"its 5 ₳ collateral isn't at its account anymore, and the mixes need it","backCollateral":"missing"}`;
  - then, with a 5 ₳ UTxO added: `5 ₳ IN: {"skipped":"Lovejoin's pool holds 20 boxes not yours, and the wallet mixes only from 30"}`, with no chain.
- **Fix:**
  - In `collateralWanted`, read the 5 ₳ pool's kept room: `room(network, ada.id)`, which a read keeps for POOL_ROOM_MS and which asks nobody within that time. Answer false under the floor (`poolShort`).
  - Then `buildBack` should give the floor's reason there, not `sess.skip.warn.noBox`.
  - Fix it with O2's no-pool half (`noAdaPool`). It's a new member of O2.

### critic#2

- **Title:** O1 reaches the wallet's own boxes. With no data layer, a device that never kept v2's 5 ₳ pool doesn't read, schedule or show the user's boxes there until Lovejoin's page opens, and O1's fix doesn't reach that.
- **Severity:** low · **kind:** code · **introduced:** new · **proven:** test
- **Where:**
  - `src/background/lovejoin-pools.ts:415-431` (`refresh`: nothing with no index) and `:402-408` (`look`)
  - `src/background/lovejoin.ts:3164-3167` (`lookForPools`, which only the page's `handlers.ts:531` calls; the only other look is a pool's start, `lovejoin-launch.ts:244`)
  - `lovejoin.ts:2755-2786` (`readSet`)
- **Claim:**
  - Only Lovejoin's page, and a pool's start, look at Koios's holder.
  - With no data layer (preprod, mainnet with Koios-only on, or the data layer marked down), a device whose head start lacks the v2 5 ₳ pool never adds it to its read set otherwise. Its boxes there, mixed on another device or before a restore or Remove wallet, have four ways out, and none works until the page opens:
    - the pool reads don't list them;
    - they get no due times;
    - Home's In Lovejoin doesn't show them;
    - Settings' Bring every box back doesn't find them.
  - Opening Lovejoin's page finds them. Nothing on Home sends the user there.
  - O1's fix, a look at `adaPool`'s ask, doesn't help here: a restore builds no return.
  - The prep (`1beba3fb`, on the release branch) bundles preprod's v2 pool (`47bece42…`) but no mainnet v2 pool. On mainnet, then, this is every Koios-only device until a release's head start carries one.
- **Scenario:**
  1. On device A, with the data layer on, the user's returns go into mainnet's v2 5 ₳ pool.
  2. On device B, with Koios-only on, the user restores the phrase.
  3. Home shows nothing in Lovejoin. The boxes don't come back by themselves, and Bring every box back finds none.
  4. Opening Lovejoin's page finds them, and they come back on their schedules.
- **Evidence:** `npx vitest run tests/critic-scratch-restore.test.ts --maxWorkers=2 --silent=false` passes.
  - The setup:
    - `PoolDiscovery` with no index, its head start empty;
    - Koios's holder holds `lovejoin-v2-ada-pool-preprod.json`'s launch, its rows in one block, with a `tx_info` answer that registers L;
    - the service is wired as `sw.ts` wires it (`serviceDeps`, `lookForPools`), with one of the wallet's boxes at the pool's mix_box.
  - After `withdrawDue(unlock)` and `held()`, it prints `BEFORE THE PAGE: {"holderAsked":[]}`: no pool on `held`, no sealed record of it, and the holder never asked.
  - After `lookForPools`, it prints `AFTER THE PAGE: {"found":true,"boxes":[{…"pool":"0eedc4eb…"}],"due":1,"holderAsked":["credential_utxos","tx_info"]}`.
- **Fix:**
  - Merge it into O1 and widen O1's fix. Where the data layer can't answer, look at the holder at the first pool read of a worker's life (the restore's scan and the unlock's run among them), throttled to REFRESH_MS a network, not only at `adaPool`'s ask.
  - That look runs at times the privacy policy doesn't name. Its rule is "when you open Lovejoin's page or a pool's start" (`docs/store/privacy-policy.md:46`; `docs/privacy.md:201`). O1's fix, narrow or wide, owes a dated *Changes* entry and privacy.md's line in the same PR. D2 doesn't cover that.

### critic#3

- **Title:** Home keeps 1.7's "not mixed yet" count for the retired pools until the retired run ends. After Stop, it shows for two hours 20 ₳ in Lovejoin that's already back.
- **Severity:** low · **kind:** code · **introduced:** new · **proven:** test
- **Where:**
  - `src/background/lovejoin.ts:4081-4101` (`retireOnce` drops no count) and `:6866-6873` (only the run's end does)
  - `lovejoin.ts:6257-6301` (`held()` reads the counts), `:6716-6727` (Stop sets the recheck SPENT_KEEP_MS on)
  - `src/ui/screens/Home.tsx:1505-1537`
- **Claim:**
  - A 1.7 record keeps per-pool counts of boxes held as not mixed yet (`notMixed`, `unsure`), which only a pool read through `sortOut` rewrites.
  - 1.8.0 holds nothing in a retired pool (the owner, 2026-11-06). But `retireOnce` leaves those counts, and the retired pools' run drops them only when it ends.
  - So while the run sends those boxes, Home says "2 boxes of 10 ₳ 20 ₳ · Not on their way back · 2 not mixed yet: open Lovejoin to see what to do".
  - If the run is stopped after it sent them (Stop, or three runs that sent nothing), the counts stay until one of three reads:
    - the recheck read, two hours on;
    - the next unlock's read;
    - the hub's read.
  - Until then Home shows, as In Lovejoin, 20 ₳ that is back in the private balance.
- **Scenario:**
  1. A 1.7 restore left two classic boxes held as not mixed yet: a deposit made them.
  2. At 1.8.0's first unlock the retired pools' run sends both.
  3. The user presses Stop in Settings, and the withdraws land.
  4. For two hours Home says the 20 ₳ is in Lovejoin and not on its way back.
- **Evidence:** `npx vitest run tests/critic-scratch.test.ts -t "Home's figures" --maxWorkers=2 --silent=false`, 2 passed.
  - While the run goes, the first test prints `HELD WHILE THE RUN GOES: {"notMixed":2,"boxes":0,"bringing":{"back":2,"retired":true,"left":0}}` and `HOME WHILE THE RUN GOES: In Lovejoin 2 boxes of 10 ₳ 20 ₳ Not on their way back 2 not mixed yet: open Lovejoin to see what to do.`. The run's end prints `{"notMixed":0}`.
  - After Stop, with the withdraws landed and the wallet kept unlocked, the second test prints `HOME'S COUNT BY MINUTE: [{"minutes":1,"notMixed":2},{"minutes":30,"notMixed":2},{"minutes":60,"notMixed":2},{"minutes":90,"notMixed":2},{"minutes":120,"notMixed":0}]`.
- **Fix:** In `retireOnce`'s update, drop each retired pool's `notMixed` and `unsure`, as the run's end does (the classic pool's set to 0, as `sortOut` keeps it). Nothing is held there any more. It's a new R-cluster item.

### critic#4

- **Title:** A swap approved before 1.8.0 comes back by itself in about twice the boxes and mixes its approval priced.
- **Severity:** low · **kind:** code · **introduced:** new · **proven:** test
- **Where:**
  - `src/background/lovejoin.ts:3516` (a return's ADA goes into the 5 ₳ pool) and `:3566-3573` (`countAt`: as many boxes as the ADA pays for there)
  - `src/background/sessions.ts:4155-4165` (the runner's `bringBack`: built and sent, with no review) and `:4494` (the approved depth)
  - `sessions.ts:442-450` (`AutoRecord.lovejoin`: depth, wait, width and the tokens' boxes, never the ADA's count)
  - 1.7.2's `priced`, `git show 6b70c1f8:seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts`, lines 1760-1774: the classic pool's funding and `mixFees = boxes × one.mixFees`
- **Claim:**
  - 1.7.2's swap approval priced the way back in the classic pool's 10 ₳ boxes: "at most N boxes of 10 ₳, about X ₳ in mix fees".
  - The approval records the depth, the wait and the width, and how many token boxes, but not how many ADA boxes.
  - On 1.8.0 the runner brings it back into v2's 5 ₳ pool, with as many boxes as the ADA pays for, at the same mix fees a box, with no review. That's about twice the boxes and mixes, and less ADA mixed.
  - It's a consequence of call 4 in the update's window that costs the user money, and no finder listed it. Cross and adapool traced a 1.7 swap's token, not its ADA's fees.
- **Scenario:**
  1. A 1.7.2 ADA→token swap goes through Lovejoin, its order still out when Chrome applies 1.8.0, and it's refunded.
  2. With 40 ₳ at depth 1: the approval priced 3 boxes and 3 mixes; 1.8.0 sends 6 boxes and 6 mixes.
  3. With 100 ₳ at the default depth 2: about 7 boxes and 28.7 ₳ of fees were approved, against about 11 boxes and 45.1 ₳.
- **Evidence:** `npx vitest run tests/critic-scratch.test.ts -t "classic pool's price" --maxWorkers=2 --silent=false` passes.
  - It prints `PRICE A BOX: {"classicPerBox":"10950000","classicBoxes":3,"fivePerBox":"5950000"} RETURN: {"boxes":6,"mixes":6,"fees":"6352017","collateral":true}`.
  - The classic figure is 1.7.2's own computation: `funding(…, undefined)` prices the classic pool, here as there.
  - The return is a site session's, through the same `chain()` a swap's return takes.
- **Fix:**
  - Choice one: a swap approved before 1.8.0 (no marker in its `auto.lovejoin`) takes no more ADA boxes than the classic pool's count for that ADA, so its mixes and fees stay within what was shown. New approvals record the count.
  - Choice two: the owner accepts it as the update's cost, and the plan says so.
  - Choice one mixes less ADA than was approved too. Either way it's the owner's call, near P3.

### critic#5

- **Title:** `madeSince` is pool-blind. In the retired pools' run, a v2 chain recorded since makes the run pass over a retired box someone else's mix moved.
- **Severity:** low · **kind:** code · **introduced:** reachable · **proven:** test
- **Where:** `src/background/lovejoin.ts:2098-2111` (`madeSince`) and `:6810` (the run's `ours`)
- **Claim:**
  - `madeSince` passes over any box whose last move came after a chain the wallet recorded since the run was asked, whatever pools that chain used.
  - In the retired pools' run, a v2 return or mix sent meanwhile is such a chain. A 1.7 wallet's mix that moves one of the user's classic or 8131b1d boxes after it makes the run pass that box over.
  - That box keeps its due time instead of coming back right away (call 3).
  - It's 1.6.0's logic. 1.8.0's retired run, spanning pools while v2 chains go, makes the cross-pool case reachable.
- **Scenario:**
  1. At the first unlock, while the retired pools' run goes, the user brings a site's session back into v2's 5 ₳ pool.
  2. A 1.7 wallet's classic mix draws one of the user's classic boxes.
  3. The run brings the others back and ends. That box comes back hours later, by itself.
- **Evidence:** `npx vitest run tests/critic-scratch.test.ts -t "pool-blind" --maxWorkers=2 --silent=false` passes.
  - The setup:
    - a retired run asked 10 minutes ago;
    - a v2 chain recorded 5 minutes ago, all sent and landed;
    - one classic box moved 2 minutes ago, and one made 5 hours ago.
  - It prints `WITHDRAWN: ["c8c8…#0"]`, then, once the run ended, `AFTER: {"due":[238]}`: the moved box `c7…` was never withdrawn and is due in 238 minutes.
  - **Mutation:** in `madeSince`, `return s.chains.some((c) => c.at > at && c.at <= moved);` became `… && poolsOf(c).includes(poolOf(b)));`. The same test then fails: `WITHDRAWN: ["c7c7…#0","c8c8…#0"]` and `expected [ …(2) ] to not include 'c7c7…'`. The file was put back from `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/critic-lovejoin.ts.orig`.
- **Fix:** `s.chains.some((c) => c.at > at && c.at <= moved && poolsOf(c).includes(poolOf(b)))`. A chain can only move a box of a pool it mixes in. It's an R-cluster item.

### critic#6

- **Title:** Settings' Lovejoin row says returns are mixed whatever the pool.
- **Severity:** nit · **kind:** words · **introduced:** reachable · **proven:** reading
- **Where:**
  - `src/ui/screens/Settings.tsx:194-198`: `settings.lovejoin.stateOn` is picked by `prefs.lovejoinReturns` alone.
  - `Settings.tsx:806-811`: the section's note, whose floor line shows only where the floor isn't 0.
  - `en.json:2025-2026` and `:2013`.
- **Claim:**
  - The owner's call of 2026-11-06 is that every screen says a return comes back directly while no pool, or one under its floor, takes it.
  - The connector is O3. Settings' privacy row still says "On: money from swaps and sites returns mixed, 2 waves deep" on the switch alone.
  - On mainnet the section's floor line says returns come back directly until the pool holds 30. On preprod (floor 0) nothing says so while no 5 ₳ pool is known.
  - Neither key is critical.
- **Fix:** For the owner. The row describes the setting, as the connector's lines did. If it should follow the pool, give it a short state from the worker's view, as O3's fix does, kept to one line.

### critic#7

- **Title:** `adaPoolOf`'s doc comment sits above `retiredOf`'s.
- **Severity:** nit · **kind:** docs · **introduced:** new · **proven:** reading
- **Where:** `src/background/lovejoin.ts:663-670`
- **Claim:**
  - The block "Of `pools`, the one a return's spare ADA and its session's 5 ₳ collateral go into…" describes `adaPoolOf`. It sits above `retiredOf`'s own comment, and `adaPoolOf` has none.
  - release's *Not checked* listed it, and W10 leaves it out.
- **Fix:** Move it to `adaPoolOf`.

## Gaps

| Area | What | Closed | How |
|---|---|---|---|
| screens' lead | Home's classic `notMixed` count, as 1.7 kept it, while the retired pools' run goes | yes | critic#3, two tests: while the run goes, and for two hours after Stop. |
| tests-unit's survivors | `withdrawNow-classicWatch` and `settleWithdrawing-classicFeed` | yes | Equivalent mutants, by trace. A classic withdraw spends a box the classic pool's feed lists (`index.poolSince`) and pays a Seedelf the contract's feed lists (`index.since`). `chainStatus` takes a transaction seen on any feed it's watched on for on chain (`src/background/feed.ts:232-252`), so either feed sees it, and with no data layer both ask tx_status. Only which of two feeds the same for every wallet is read differs. No finding. |
| retire's lead | `madeSince` is pool-blind | yes | critic#5: a test, and a pool-aware mutation that takes the box. |
| pr363's lead | C8, caught only through a rebuilt WebAssembly | yes | By reading CI. `.github/workflows/web-wallet.yml`'s wasm job builds the module (`:143-149`), and the unit job runs Vitest on that artifact (`:161-197`). There, `tests/lovejoin-discovery.test.ts:147-170` verifies an 8131b1d pool whose scripts are named by hash, with `scriptsInline` 0: the case C8 breaks. CI catches it, though native tests alone don't. The rebuild that shows it is the lead's. |
| the owner's call of 2026-11-06 | The code against "no pool, no mix; once one exists, use it; every screen truthful; found without Lovejoin's page" | yes | Every read of the 5 ₳ pool traced[^calls]. Confirms O1, O2, O3 and O5 by reading. New: critic#0, #1, #2, #6. Nothing fails or blocks with no pool: each path comes back directly, saying why. ClaimAll's "Each session's spare ADA is mixed" shows only where a return has boxes (`ClaimAll.tsx:287`). Stop's `swaps.stop.poolShort` reads true with `noAdaPool`. |
| O1's fix and the privacy policy | Whether O1's proposed look at the holder owes a policy entry | yes | It does. The policy and privacy.md say the Koios holder look runs only as Lovejoin's page opens or a pool's start is reviewed (`docs/store/privacy-policy.md:46`, `docs/privacy.md:201`). A look at a return's build changes what is sent and when. See critic#2's fix. |
| brief rule: no fee it didn't say | Approvals made before 1.8.0 and carried across the update | yes | critic#4. |
| brief rule: a saved reason read true later | Reasons 1.8.0 makes common, beyond its two new keys | yes | critic#0 (`lj.skip.warn.floorShort`). The other reasons `chain()` can save were as reachable in 1.7. |
| brief rules: module-level `t()`, dates, the worker reading translated text | Nobody grepped 44a's and 44b's added lines | yes | `git diff c15603d5 a6c94743 -- …/extension/src` adds no module-level `const X = t(`, no date formatting, and no comparison, regex or parse of translated text. |
| brief rule: the docs never date a release | #361 and chunk 44's docs | yes | #361's `docs/releases.md` lines carry no date. The plan dates only the owner's calls. |
| brief rule: no paternalistic guards, in the proposed fixes | P1's first fix option | yes, a note | Counting TAIL_DRAWS in `fits`, `againBoxes` and the Mix form's room offers fewer boxes than the pool takes, to keep the collateral's mix: a protective rule nobody asked for. P1's second option (`ifLeft`) changes words only. P1's verifier should weigh it. |
| areas of #363 and #364 nobody read | Every hunk mapped to a lens | yes | Each hunk of #364's 18 non-test files and #363's 33 is in some report. The one file no report names, `seedelf-data/api/src/lovejoin/flat.rs`, is a test that both sets' templates round-trip. The prep commit `1beba3fb`, on the release branch after `a6c94743`, was read: preprod's head start gains `47bece42…` (v2, 5 ₳, launched at block 5378705, height 5378705), mainnet's is unchanged (critic#2). Its test breakages are D6's. |
| tests-e2e's caveat | Mainnet's way of finding the pool, the data layer's list, has no end-to-end test | yes | By reading. `refresh` and the holder scan share `verified()` (`src/background/lovejoin-pools.ts:470`), which keeps `version` from WebAssembly's view (pr363's E2 is caught). `serviceDeps`' `pools` is the wiring lovejoin-retired's ask test fakes. The data layer's tokens feed covers every shown pool, the new scripts' ADA pools too (`seedelf-data/api/src/lovejoin/routes.rs:1-11`, `:309-330`). No finding. |
| screens' lead | BringAllBack's effect and its `retired` | yes | `src/ui/components/BringAllBack.tsx:191`: `[network, pool, retired]`. |
| cross's lead | A 1.7.2 withdraw on its way at the update | yes | By reading: `withdrawing` lives in the sealed schedule, which the update keeps, and `settleWithdrawing` marks its inputs spent again where the wiped session storage lost them (`lovejoin.ts:7356`). Unchanged since 1.7.2. |
| pr363's lead | The second L application at each 8131b1d pool's verify | yes | By reading: once a pool a worker's life (`verifiedPool`'s cache), with no change in outcome. |
| adapool's lead | Stop's dialog and a new swap's form with no 5 ₳ pool | yes | Stop's line takes `noAdaPool` and reads true. The approval's ADA-out words are O2's. |
| release's lead | The doc comment above `retiredOf` | yes | critic#7. |
| retire's lead | Chrome's order of Home's `held()` (which runs `cuts`) and the first run's `withdrawDue` | no | Needs the real extension. R2 already states both orders. |
| tests-e2e's lead | An e2e of the first unlock's bring-back, and of a retired pool's page with boxes | no | Playwright is the tests-e2e lens's. Unit tests pin `retireOnce`. |
| screens' lead | The new lines at panel width | no | No browser here. |
| words' lead | A stuck retired token pool on mainnet (W4) | no | Needs the network. |

[^calls]: The reads traced: `chain()`, `acrossOf`, `collateralPool`, `collateralPoolTakes`, `priced`, `collateralWanted`, `tailReserve`, `funding`'s tail and `room`; then the connector, Settings, the hub, Stop, ClaimAll and the session pages.

## Not checked

- The lead's own steps: the blind back-translations, the 44d docs, the live preprod run, the full checks and a WebAssembly rebuild.
- Playwright and Rust: I ran neither.
- `tsc` over my scratch files. Vitest doesn't check types.
- Mainnet facts:
  - The classic pool's mainnet crowd in 1.7, which says whether critic#0's and critic#1's states were already reachable on 1.7.2.
  - Whether a stuck retired token pool exists there.
- The verifiers' verdicts on `FINDINGS.md`'s clusters. I reverified none of them; my reading confirms O1's, O2's, O3's and O5's mechanisms only.
- What critic#2's fix costs on Koios's public tier: one holder read a worker's life a network, more where it falls back.
