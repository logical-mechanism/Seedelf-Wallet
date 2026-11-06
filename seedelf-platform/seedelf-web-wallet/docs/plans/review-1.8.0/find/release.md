# 1.8.0's release review: the release lens

Reviewer: release. Tree: `a6c94743`, read in the sandbox `wt/release`. Scratch tests (all in the sandbox, named `release-*`): `tests/release-registry-scratch.test.ts`, `tests/release-fresh-device-scratch.test.ts`, `tests/release-floor-words-scratch.test.ts`, `tests/release-swap-box-words-scratch.test.ts`. Run from `extension/` with `npx vitest run tests/<file> --maxWorkers=2`.

Paths below are from the repository root unless they start with `extension/` or `docs/` (both under `seedelf-platform/seedelf-web-wallet/`).

## Findings

### release#0

**release#0 · medium · release · new** · `docs/plans/chunk-44-lovejoin-v2.md:60-71`, `extension/src/lovejoin-pools.json:3-5`, `extension/package.json` (version)

**1.8.0 can't ship from `a6c94743`. Here is what 44c and 44d still owe, in order, and whose step each is**

*Claim:* At `a6c94743` neither network's head start carries a v2 pool, and the version is 1.7.2. Every design doc still describes 1.7 (release#6–#13), and the release's registry step can't handle a v2 pool (release#4). The plan's 44c and 44d are the right outline. They leave out the floor as a gate (release#2), the privacy policy's entry (release#3), the registry fix, and the second test the refresh breaks.

*The order, and whose step each is:*
1. **Claude:** finish 44c's preprod live runs on preprod's v2 5 ₳ pool (`47bece42…`) with the dev test wallet. That means a mix from each side, a site's return and a swap's return with the collateral's mix, Bring one back, and Bring every box back. The owner has seen the Bootstraps and a restore's bring-back.
2. **The owner (CI, approves):** *Data layer deploy* from `main`. Any commit from `c441881e` on carries 44a's templates, and 44b changed nothing under `seedelf-data/`. Then `status` and part 2's `curl` checks. Do this before the mainnet launch. A pre-44a server rejects the v2 launch and keeps that verdict until it restarts: `seedelf-data/api/src/lovejoin/discovery.rs:99-127` stores `Verdict::Rejected` and drops the candidate from its kept read. A deploy after the launch would also clear it, because the deploy restarts the server. What matters is that a 44a binary runs before step 4.
3. **The owner:** launch mainnet's v2 5 ₳ pool, then Bootstrap it **to** the floor of 30 boxes, not "toward" it, before the upload (release#2).
4. **Claude, on `web-wallet/release-1.8.0`:** `npm version 1.8.0`, `npm run tokens`, `npm run dreps`, then `npm run lovejoin-pools`. Run the refresh at least 10 minutes after the mainnet launch's block, since the holder scan takes only settled launches (`extension/src/background/lovejoin-pools.ts:511`, `SETTLE_MS`). Then check that both networks' v2 5 ₳ pools are in the head start with `version: "v2"`.
5. **Claude:** rework the tests the refresh breaks:
   - Both of `lovejoin-1-5-0.test.ts`'s head-start cases fail, not only the one with the v2 check. The plan names only that one.
   - The e2e's `fivePool` (8 call sites, and `lookedForFive`) breaks on both networks, mainnet's floor test included. Move them onto the bundled pools.
6. **Claude, then the owner:** Claude fixes `lovejoin-registry` (release#4). The owner commits or discards the fork's uncommitted entries (still there), runs part 1's registry block, sends the PR to Strica and messages Cardanoscan.
7. **Claude:** the 44d docs (release#6–#14), the swap's words (release#5), the privacy policy's dated entry (release#3) and the store listing in all three languages (release#12). Any critical key changed on the way needs a fresh blind back-translation.
8. **Claude:** the checks (the workspace tests, `payment_parts_shapes_test`, the WebAssembly tests, Vitest on both builds, e2e, the live runs), then the PR. **The owner** merges.
9. **The owner (CI):** development.md's step 7 deploy (`seedelf-data/` changed since `web-wallet/1.7.2`), then the `curl` checks.
10. **Claude:** the package from the merge commit, the second build kept apart, and e2e on the store build. **The owner:** checklist item 9 by hand, the upload with the listing in three languages, submit, and tag `web-wallet/1.8.0` on the zip's commit. **Claude:** the record PR.

*Scenario:* if the release is cut at `a6c94743` as it stands:
- every preprod return comes back directly;
- mainnet's quiet reads see no 5 ₳ pool (release#1);
- the connector promises mixing during the floor's window (release#2);
- the policy says nothing of the first unlock's bring-back (release#3).

*Evidence:*
- **The head start at `a6c94743`:**
  - preprod: height 5356458, pools `dfa1f845` (MIN), `18c4df77` (5 ₳), `8b3ae2e2` (MIN), `aab7c72d` (7 tADA), none of them `version: "v2"`;
  - mainnet: height 14139313, `dc6abe3b` (5 ₳, tokenV1);
  - `extension/tests/lovejoin-1-5-0.test.ts:922` asserts that no bundled pool is v2.
- **A refresh, simulated:** I appended a stand-in v2 5 ₳ pool to preprod's head start (the WebAssembly fixture `lovejoin-v2-ada-pool-preprod.json`, at launch block 5378705; scratch `release_headstart_v2.py`).
  - `npx vitest run tests/lovejoin-1-5-0.test.ts --maxWorkers=2` gives **2 failed, 2 passed**. "plans every return and mix as with the classic pool alone" fails with `expected [ { …(10) } ] to deeply equal []`. "finishes a 1.5.0 vault … the hub lists none of the retired pools shown" fails on the trace's shape (`expected [ { at: 60000, …(3) }, …(27) ] to deeply equal …`).
  - `lovejoin-pools-head-start`, `lovejoin-discovery`, `lovejoin-retired` and `lovejoin-form-review-fixes` all pass (23 and 35 tests).
- **The e2e (by reading):** `extension/e2e/extension.spec.ts:3240-3285` launches `fivePool` at `HEAD_START[network].height + 1`. That makes it a later launch of the bundled pool's values, so a copy, and never shown.
- **The registry fork:** `git --no-optional-locks diff` on the fork still shows the four `(5 ADA)` entries for `dc6abe3b` uncommitted.
- **The version:** `package.json` is 1.7.2.

*Fix:* add the missing steps to 44c, in this order. The two that aren't in the plan: the floor as a gate before the upload, and the policy entry.

### release#1

**release#1 · medium · code · new** · `extension/src/background/sessions.ts:1759`, `extension/src/background/sessions.ts:4701`, `extension/src/background/lovejoin.ts:3309`, `extension/src/background/lovejoin.ts:4137-4139`, `extension/src/background/lovejoin.ts:3467`, `extension/src/background/lovejoin-pools.ts:430-431`, `docs/plans/chunk-44-lovejoin-v2.md:57,64`

**Mainnet needs its v2 5 ₳ pool in the head start too, even with the data layer up: one swap review says there's no 5 ₳ pool yet charges for its collateral mix there, and the swap's way back later pays fees nobody priced**

*Claim:* The plan holds that on mainnet a return's build and its collateral's pick ask discovery, so the head start matters there only for the connector's words. That's true of `adaPool(network, true)`. But several other reads look at the pools quietly, as discovery last kept them, asking nobody:
- a swap's quote and its review at Review (`priced`);
- `collateralPoolTakes`, `room` and `collateralWanted`;
- the Mix form's tail.

So a device that has kept no v2 5 ₳ pool behaves badly. That's a fresh install, or a 1.7.2 device just updated, before any pool read has asked. On such a device one swap review:
- says *"Lovejoin has no pool of 5 ₳ boxes to take it yet"* (the critical `sess.skip.warn.noAdaPool`), and prices nothing for a stop or a refund;
- in the same build, has `tailReserve` ask discovery, find that pool, and charge 1.5 ₳ for the collateral's mix in it.

The return later asks discovery and sends a stopped or refunded swap's ADA through Lovejoin, with mix and withdraw fees the approval never showed.

With *Read Cardano through Koios only* on, or the data layer's private part down, mainnet behaves like preprod. `privateIndexClient` answers no index (`extension/src/background/private-index.ts:366-370`), and `refresh` asks nobody (`extension/src/background/lovejoin-pools.ts:430-431`). No v2 pool is known until Lovejoin's page opens. Every return comes back directly saying there's no pool of 5 ₳ boxes, which is false.

*Scenario:*
- Mainnet, 1.8.0 shipped with mainnet's v2 5 ₳ pool launched but not in the head start (launched after the refresh, say). The data layer is up.
- A user who hasn't opened Lovejoin since the update reviews a 10 ₳ ADA→MIN swap.
- The review says no pool takes the ADA but adds the 1.5 ₳ reserve. The user approves.
- The order is refunded. The funding comes back through the 5 ₳ pool in 2 boxes, for 1.9 ₳ of mix fees and 0.6 ₳ to bring them back, none of it on the approval.

*Evidence:*
- `tests/release-fresh-device-scratch.test.ts`, with discovery as `sw.ts` wires it: `known` returns nothing until `pools` has been asked, then keeps the pool. `npx vitest run tests/release-fresh-device-scratch.test.ts --maxWorkers=2` gives **1 passed**, logging:
  - first review: `{"skipped":"Lovejoin has no pool of 5 ₳ boxes to take it yet","boxes":0,"collateralReserve":"1500000","collateralMix":"ifLeft","asked":2}`;
  - the same review built again, once the ask kept the pool: `{"boxes":0,"ifStopped":{"boxes":2,"mixes":2,"mixFees":"1900000","withdrawFees":"600000"}}`.
- **The fix, tried in the sandbox:** `sessions.ts:1759` changed to `lovejoin.adaPool(network, pool)`, so it asks at Review. The first review then prices `ifStopped` at 2 boxes and skips nothing, and the scratch's assertion of the bug fails as expected. I restored the file afterwards.
- **The return:** with no 5 ₳ pool known it comes back directly with `noAdaPool`, as pinned by `extension/tests/lovejoin-retired.test.ts:225`.

*Fix:*
- Keep the plan's gate on both networks, and say in 44c why mainnet needs it: the quiet reads, and Koios-only.
- Make one review agree with itself: at Review, `priced` asks as `collateralPool` does (`adaPool(network, pool)`), and the quote stays quiet while the user types. Do the same for `collateralWanted` (`sessions.ts:4701`) where a return is being built.

### release#2

**release#2 · medium · words · reachable** · `extension/src/ui/screens/DappApprovals.tsx:533`, `:488`, `:921`, `extension/src/i18n/translations/en.json:348`, `:468`, `docs/plans/chunk-44-lovejoin-v2.md:64-66`

**From mainnet's launch until its v2 5 ₳ pool holds the floor, the connector says spare ADA is mixed while every return comes back directly**

*Claim:* Two `.privacy.` strings are chosen by `prefs.lovejoinReturns && lovejoinOn(network)` alone (`DappApprovals.tsx:533`), with nothing of the pool:
- the private-session card's `dappUi.private.privacy.staysLovejoin`;
- a site session's funding review's *Through Lovejoin first, about X ₳ a 5 ₳ box* and `dappUi.back.privacy.noteLovejoin`.

A return under the floor comes back directly. 1.8.0 moves every return to the new v2 5 ₳ pool, which starts empty. Until it holds 30 boxes that aren't the user's, every mainnet site session is promised mixing it won't get. In 1.7.2 the same words described the classic pool. The plan's 44c names the head start for the "no pool known" half of this. The head start doesn't cover the floor, and 44c only says the owner Bootstraps "toward the floor".

*Scenario:* Mainnet, 1.8.0 uploaded right after the launch, the pool holding 10 Bootstrap boxes.
- The card says: "Spare ADA is mixed through Lovejoin so it's harder to tie to this session: about 4.1 ₳ a 5 ₳ box plus a fee, back hours later."
- On Bring it back, the return comes back directly, tied to the session: "Lovejoin's pool holds 10 boxes not yours, and the wallet mixes only from 30".
- The owner's own wallet never counts its own Bootstrap boxes as others. For that wallet this lasts until other people's boxes arrive.

*Evidence:* `tests/release-floor-words-scratch.test.ts` sets preprod's floor to 30, as `lovejoin.test.ts` does. `npx vitest run tests/release-floor-words-scratch.test.ts --maxWorkers=2` gives **1 passed**:
- A site session's `backBuild`, with the v2 pool holding 20 strangers' boxes, gives `lovejoinSkipped` "Lovejoin's pool holds 20 boxes not yours, and the wallet mixes only from 30" and no chain.
- `FundingWayBack`, rendered with `lovejoin = DEFAULT_PREFERENCES.lovejoinReturns && lovejoinOn("preprod")` and no collateral's mix, reads "Lovejoin mixes the spare ADA so it's harder to tie to this session, back in 5 ₳ boxes hours later."

*Fix:* in 44c, make it a gate that mainnet's v2 5 ₳ pool holds 30 boxes before the upload. The owner's Bootstrap of 30 counts as others for every other wallet. Add a backlog line for the words: let the card and the funding review read the worker's view of the 5 ₳ pool (as `collateralPoolTakes` does), or hedge them ("once its pool holds enough boxes").

### release#3

**release#3 · medium · docs · new** · `docs/store/privacy-policy.md:89-93`, `:28`, `:71`, `extension/src/background/lovejoin.ts:4081-4101`, `extension/src/background/lovejoin.ts:6344-6351`

**The privacy policy owes 1.8.0 a dated Changes entry, and none was written**

*Claim:* 1.8.0 changes what the wallet sends and what it stores, and neither #363 nor #364 touched the policy.

1. **The first run on 1.8.0 sends unasked.** That run is the unlock's own (`retireOnce`, then `bringAllBackNow` before `unlockDraws`). It brings back every box of the user's in the retired pools, one right after another, with none of the waits. That includes boxes not mixed yet: a deposit's unmixed box, and a Bootstrap's held boxes, which `retireOnce` releases.
   - Each withdraw goes to the Cardano server and giveme.my at once.
   - Anyone reading the chain sees those boxes as one person's, and an unmixed box tied to its deposit, and so to the public account that paid for it.
   - The policy says Lovejoin makes the way back harder to tie (`:28`). It says bringing boxes back together, or soon after their mixes, narrows that (`:71`), as something the user does, not something the wallet does by itself.
2. **The wallet stores more.** A new record, encrypted and kept for good: when the retired pools' run was asked (`Schedule.retired`). Stop's record now also says the run was the retired pools' (`bringStopped.retired`).

`adaPool`'s `ask` adds nothing that's sent:
- every return's pool read already asked the data layer's list, through `split` and `ours`, which call `readSet(network)` (as 1.7.2's `lovejoin.ts` did too);
- that list is throttled to once every 5 minutes;
- preprod has no list at all.

*Scenario:* a 1.7.2 user with 12 boxes in the classic pool, a few of them held by a Bootstrap, gets the update. Within minutes of the first unlock, 12 withdraws go out in a row. The published policy says nothing of it.

*Evidence:*
- `extension/tests/lovejoin-retired.test.ts:290-300` pins the behaviour: the unlock's run, `withdrawDue("preprod", true)`, sends the classic box though nothing is due, and seals `retired` and `bringing: { retired: true }`.
- `:319-354` pins the Bootstrap's hold being let go.
- `:356-386` pins a deposit's box coming back by itself.
- `git diff c15603d5 a6c94743 -- seedelf-platform/seedelf-web-wallet/docs/store/` is empty. The last entry is 30 October 2026 (`privacy-policy.md:93`).
- The policy's own promise (`:91`): "list the change under Changes below, before the new version ships".

*Fix:* add a dated entry on the release branch, for the owner to word, and move the *Effective* line. A draft:

> Lovejoin's older pools (the classic pool of 10 ₳ boxes, and those started on its earlier contracts) are retired: the wallet puts no new box in them and mixes none there again. At the first unlock after this update it brings every box of yours in them back, one right after another, mixed or not, which ties them together, and a box not mixed since its deposit to that deposit. A private session's spare ADA and its 5 ₳ collateral now go into a pool of 5 ₳ boxes on Lovejoin's current contracts, and come back directly until that pool holds enough other people's boxes. The wallet keeps, encrypted like your contacts, when it did that.

Severity: medium, because by the policy's own promise the release can't ship without it. If the lead reads the policy as just a doc, it's low.

### release#4

**release#4 · low · release · reachable** · `extension/scripts/lovejoin-registry.mjs:96`, `:78-83`, `:117`, `:45-47`, `docs/development.md:331`

**`npm run lovejoin-registry` can't name a v2 pool, so the new pool's Cardanoscan names can't be made**

*Claim:* Once the head start carries mainnet's v2 5 ₳ pool, the script has three problems:
1. It throws at that pool (`view.version !== "tokenV1"`, line 96) and writes nothing for any pool.
2. With that fixed alone, it names the v2 pool's four scripts after its value: `Mix Box (5 ADA)`, `Mix Logic (5 ADA)`, `Fee Pool (5 ADA)`, `Reference Minter (5 ADA)`. Those are exactly the names of the 8131b1d 5 ₳ pool's (`dc6abe3b`) four entries, still uncommitted in the fork, so its duplicate check (line 117) refuses.
3. Its `github` link is built from `COMMIT`, 8131b1d's tree, for every pool, while v2's `mix_logic` is 29573c5's (`COMMIT_V2`, `seedelf-core/src/lovejoin/templates.rs:41`).

The guard dates from `38fe56b7` (1.7.x). 1.8.0's v2 pools make it reachable.

*Scenario:* step 6 of release#0. Part 1's registry block prints "`<id>` verifies as v2 pool `<id>`. Nothing written.", and Cardanoscan shows the new pool's scripts unnamed.

*Evidence:* `tests/release-registry-scratch.test.ts`. The script itself isn't run, because the brief forbids it. The test reads the guard and the naming from its source and feeds it WebAssembly's views:
- `lovejoinVerifyPool` answers `"v2"` for v2's 5 ₳ pool and `"tokenV1"` for the bundled mainnet 5 ₳ pool;
- both get `Mix Box (5 ADA)` by the script's own `amount`;
- the source never names `COMMIT_V2`.

`npx vitest run tests/release-registry-scratch.test.ts --maxWorkers=2` gives **2 passed**. In the fork, `git --no-optional-locks diff projects/lovejoin.json` shows the four `(5 ADA)` entries, version 2, for `dc6abe3b`.

*Fix:*
- Accept `v2`, and mark the set in the entries: for example version 3, `Mix Box v2 (5 ADA)` (within 45 characters), with the link to `COMMIT_V2`'s tree.
- Rename the fork's uncommitted 8131b1d entries (for example "(5 ADA, v1)") before they're sent. They never reached Strica's `master`.
- Make development.md:331 say so.

### release#5

**release#5 · low · words · new** · `extension/src/i18n/translations/en.json:2262-2265`, `:2272`, `es.json:2400-2405`, `:2412`, `ja.json:2124-2125`, `:2132`, `extension/src/ui/screens/Swaps.tsx:1651-1655`, `:1679`, `:1634`, `:2899`

**A swap's approval and Stop's dialog call the 5 ₳ pool's boxes "boxes of 10 ₳"**

*Claim:* 44b's sweep of the 10 ₳ words covered the tile, Lovejoin's aside, Settings' note and the connector. It missed the swap's:
- `swaps.cost.boxesLabel` ("Boxes of 10 ₳"), the label of the approval's Lovejoin cost rows;
- `swaps.boxes.atMost` and `swaps.boxes.roomFor` ("at most 2 boxes of 10 ₳"), in the approval's line for a stopped or refunded swap (`swaps.lovejoin.ifStopped`) and in Stop's dialog (`swaps.stop.throughCost`).

In 1.8.0 the swap's ADA goes into v2's 5 ₳ pool (`priced` uses `adaPool`). So a 10 ₳ swap's approval says its ~16 ₳ would come back through Lovejoin in "at most 2 boxes of 10 ₳", which is 20 ₳. The same holds in es (7 keys, with `_many`) and ja (3 keys). None of these keys is critical.

*Evidence:* `tests/release-swap-box-words-scratch.test.ts`. `npx vitest run tests/release-swap-box-words-scratch.test.ts --maxWorkers=2` gives **1 passed**:
- `adaPool` is the 5 ₳ pool (`lovelace` 5,000,000);
- the quote's `ifStopped` is `{"boxes":2,"mixes":2,"mixFees":"1900000","withdrawFees":"600000"}`;
- its words read "at most 2 boxes of 10 ₳";
- `LovejoinCost` renders "Boxes of 10 ₳".

A scan of en, es and ja for "10 ₳" finds these and nothing else stale: the launch's 10 ₳ rule words stay true.

*Fix:* fill the box from the ADA pool: "Boxes of {{box}}" and "boxes of {{box}}", or 5 ₳, in all three languages, with a test that pins it.

### release#6

**release#6 · low · docs · new** · `docs/architecture.md:671`, `:673`, `:686`, `:690`, `:692`, `:695`, `:707`, `:723`, `:730`, `:731`, `:732`

**architecture.md's Lovejoin section still describes 1.7**

*Claim:*
- **:671:** "a mixer of fixed 10 ₳ boxes … where a return goes through it". In 1.8.0 a return goes into v2's 5 ₳ pool, and the classic pool is retired.
- **:673:** a Bootstrap's boxes "are held … until brought back by hand". `retireOnce` lets a retired pool's Bootstrap go.
- **:686:** `lovejoin-1-5-0.test.ts` "holds the classic pool to 1.5.0's own record of how it planned … its plans to the lovelace". Since 44b it holds them as retired: every return comes back directly (`asRetired`).
- **:690, :692:** a deposit's box, or one Koios can't say of, "is held". Not in a retired pool, where nothing is held (`sortOut`'s `old`).
- **:695:** a box coming back by itself is asked about just before its withdraw. Not in a retired pool (`lovejoin.ts:6479`).
- **:707:** "Never at the moment of unlock … the unlock's run sends nothing". The first 1.8.0 unlock's run does (release#3).
- **:723:** Mix my boxes again is offered in any pool, which it isn't.
- **:730:** Home "counts only boxes that can come back by themselves". In a retired pool every box can.
- **:731, :732:** the tile's mixes and Bootstraps go into "any shown pool", and each pool's page has "today's mix form, Bootstrap". A retired pool's page is withdraw-only.
- Nothing says that a pool is retired, that the hub lists one only while the wallet holds boxes there, what `retireOnce` does, or that `adaPool` takes a return's ADA and its collateral.

*Evidence:* reading at `a6c94743`. The behaviour they contradict is pinned in `extension/tests/lovejoin-retired.test.ts:121-174`, `:198-231` and `:277-399`.

*Fix:* 44d's rewrite of the section.

### release#7

**release#7 · low · docs · new** · `docs/flows.md:73`, `:501`, `:507`, `:510`, `:512`, `:513`, `:517`, `:518`, `:519`, `:523`, `:529`, `:531`

**flows.md's Lovejoin flows still describe 1.7**

*Claim:*
- **:73:** Home counts "boxes of 10 ₳".
- **:501:** the mixer "of ADA in the classic pool's 10 ₳ boxes", with no word of retirement.
- **:507:** the hub's pools, with no "No pool to mix in yet.", and no retired pool listed only while it holds boxes.
- **:510:** every pool's page has Mix and Bootstrap. A retired pool's doesn't.
- **:512:** "every box is 10 ₳".
- **:513:** the cost example, "Mixing 10 ₳ costs about 4.85 ₳", is a box of a pool no one can mix in now.
- **:517, :518, :519:** Mix my boxes again, and "Not mixed yet … never comes back by itself". In a retired pool Mix again is off, and every box comes back by itself.
- **:523:** a Bootstrap's hold. Let go in a retired pool.
- **:529:** Bring every box back now, with nothing of the first unlock's run over the retired pools: Settings' "Bringing every box in the retired pools back", every pool's run widening it, a v2 pool's page refused meanwhile, and "Nothing of yours was left in the retired pools."
- **:531:** a return's review example, "2 boxes of 10 ₳". A return's ADA boxes are 5 ₳ now.

*Evidence:* reading. The behaviour is pinned by `lovejoin-retired.test.ts`. The strings are `lovejoin.pools.noneYet`, `settings.lovejoin.bringingRetired_*` and `settings.lovejoin.bringNoneRetired`.

*Fix:* 44d.

### release#8

**release#8 · low · docs · new** · `docs/privacy.md:195`, `:198`, `:216`, `:220`, `:226`, `:230`, `:234`

**privacy.md still describes 1.7's Lovejoin, and leaves out the first unlock's bring-back and what it costs in timing (44d's note)**

*Claim:*
- **:195:** "10 ₳ in the classic pool". No word of retired pools, or of v2's 5 ₳ pool taking every return.
- **:198:** a Bootstrap's boxes "never come back by themselves". In a retired pool they do.
- **:216:** "the ADA still goes through the classic pool". It goes into the 5 ₳ pool (`acrossOf`'s `ada`).
- **:220:** "never the moment it unlocks".
- **:226:** Bring every box back sets the rules aside "by the user's choice". At the first 1.8.0 unlock the wallet sets them aside itself, in the unlock's own run, for every box in the retired pools.
- **:230:** after a restore, a deposit's box "never comes back by itself". In a retired pool it does, unmixed, with no warning.
- **:234:** a box coming back by itself is asked of Koios just before its withdraw. Not in a retired pool.

Missing altogether: what the first unlock's run ties together on chain. Back-to-back withdraws tie the boxes as one person's, and an unmixed box ties to its deposit and to the account that paid it. Also missing: that 1.8.0's returns come back directly until v2's 5 ₳ pool holds the floor.

*Evidence:* reading. The behaviour is pinned by `lovejoin-retired.test.ts:290-300` (the unlock's run sends) and `:356-386` (an unmixed box comes back by itself).

*Fix:* 44d. The policy entry (release#3) should carry the same words.

### release#9

**release#9 · low · docs · new** · `docs/lovejoin-mix-width.md:7`, `:8`, `:54`, `:135`

**lovejoin-mix-width.md's conclusions are still the classic pool's, which the wallet no longer mixes in**

*Claim:*
- **:54:** "**The classic pool on mainnet** (what the wallet mixes on)". The wallet mixes only on v2 pools now.
- **:7:** four fits "leaving 111 to 118 million".
- **:8:** the token pool is "the thinnest of the three deployments".
- **:135:** the cost table uses the classic pool's 0.823 ₳ and 1.214 ₳.

44b added v2's table (line 74 on): 99.0%, leaving 100,250,656 steps, 0.837 ₳ and 1.230 ₳. It didn't change *The answer*. So the page's headline understates how thin four is on every pool the wallet uses now.

*Evidence:* reading. The doc's own v2 table, lines 76-82.

*Fix:* make *The answer* and the cost section v2's, and keep the classic pool's figures as history.

### release#10

**release#10 · low · docs · new** · `seedelf-platform/seedelf-web-wallet/README.md:47`, `:57`

**The web wallet's README still says returns go through 10 ₳ boxes**

*Claim:*
- **:47:** "the spare ADA a private session brings back goes through Lovejoin, 10 ₳ boxes on chain".
- **:57:** "Beside the 10 ₳ pool … the wallet shows the earliest genuine pool of each box value". Now it's the earliest v2 pool of each value, with retired pools shown only while they hold the user's boxes.

There's no paragraph for 1.8.0 (Lovejoin v2, the old pools withdraw-only).

*Evidence:* reading.

*Fix:* 44d.

### release#11

**release#11 · low · docs · new** · `docs/development.md:330`, `:143`, `:144`, `extension/src/lovejoin-pools.json:2`

**development.md calls the head start "never a gate", and its preprod checklist can't be run on 1.8.0**

*Claim:*
- **:330:** "It's a head start, never a gate: a pool launched after it is found live". The same in the head start's `//` note. From 1.8.0, the head start is what lets a return, a swap's review and the connector find the 5 ₳ pool (release#1, plan 44c).
- **:143:** checklist item 6, "Lovejoin's pools beside the classic one (preprod's head start shows MIN's and one of 5 ₳ boxes of ADA): a mix in one from each side … a Bootstrap". Every pool in preprod's head start is retired and withdraw-only.
- **:144:** "a private swap into a token with a pool shown". No v2 token pool exists on preprod (the v2 token pool fixture was never launched), so 1.8.0's token-pool paths can't be checked live as written.

*Evidence:*
- reading;
- the head start's pools, as in release#0;
- `lovejoin-retired.test.ts:140-151`: an 8131b1d token pool refuses a mix and a Bootstrap, and no swap's token is offered it.

*Fix:*
- Say the head start is a gate where it carries a return's pool.
- Point item 6 at v2's 5 ₳ pool, and add a restore with retired-pool boxes.
- Either launch a v2 MIN pool on preprod for the checklist (test ADA; the owner's call, since every preprod wallet sees it), or say these items wait for one.

### release#12

**release#12 · low · words · new** · `docs/store/README.md:59`, `:147`, `:211`

**The store listing says the wallet puts new boxes "only in the first started for each box value", in all three languages**

*Claim:* Mainnet's first 5 ₳ pool is 8131b1d's (`dc6abe3b`), and it takes no new box. The wallet's new boxes go only into the first pool of each value on Lovejoin's current scripts, and older pools are withdraw-only. The rest of the bullet holds: spare ADA goes through Lovejoin, the floor of 30, no audit, starting a pool costs about 23 ADA.

*Evidence:* reading. `adaPoolOf` (`lovejoin.ts:671-672`) and `isRetired` (`:661`), pinned by `lovejoin-retired.test.ts:267-274`.

*Fix:* for example "…puts new boxes only in the first started for each box value on Lovejoin's current contracts; pools on its older ones take none, and the wallet brings yours back from them", in es and ja too. The listing changes in all three languages at the upload.

### release#13

**release#13 · nit · docs · new** · `docs/backlog.md:71`

**backlog.md keeps a line 44b settled, and adds nothing 1.8.0 leaves open**

*Claim:* Line 71 ("what a classic-only user sees since 1.6.0 (*four-switch-classic-bend*), and the dApps tile's "Mix ADA in 10 ₳ boxes"") is settled. The tile says 5 ₳ now, and the classic pool takes no mix. The backlog's rule is that the chunk that settles a line deletes it. Nothing records what 1.8.0 leaves open: release#1's quiet reads, release#2's words, release#4's registry, and launching a preprod v2 token pool (release#11). Any of them that the release doesn't fix is a line.

*Evidence:* reading.

*Fix:* delete the settled half of line 71, and add lines for what stays open.

### release#14

**release#14 · nit · release · new** · `docs/development.md:181`, `:278`

**development.md's release example still says 1.7.2**

*Claim:* `release_version=1.7.2`, and "With `package.json` at 1.7.2, that file is `…/seedelf-wallet-1.7.2-mainnet.zip`". Every release's docs commit bumps both (1.7.2's review, release#3). Pasted as written on the 1.8.0 branch, `npm version 1.7.2` would take `package.json` back down.

*Evidence:* reading.

*Fix:* change both lines to 1.8.0 in the release branch's docs commit.

## Covered

- **#361, 1.7.2's record**, against `docs/archive/plans/review-1.7.2.md` and git. All of it holds:
  - #353–#359, and #360 merged as `6b70c1f8`;
  - `web-wallet/1.7.2` points at `6b70c1f8` (a lightweight tag);
  - the zip in `extension/release/` has SHA-256 `087c30a8…dc9b`, is 2,101,045 bytes with 24 entries, and its manifest says 1.7.2;
  - DReps 466 mainnet and 63 preprod (recorded 2026-11-02); tokens 2 and 32; the data layer's decimals 1,172, unchanged;
  - the head start gained `aab7c72d` (7 tADA) and no mainnet pool;
  - nothing under `seedelf-data/` or in `list.json` changed between `f31758b0` and `6b70c1f8`, so no API deploy was owed;
  - the fork's change is still uncommitted, as the record says.
- **The version:** a minor is right, by development.md's *Which number* and plans/README.md ("1.x.0 for features").
- **CI needs no change for 1.8.0:**
  - `web-wallet.yml`: the changes filter, the workspace tests, the WebAssembly build and its tests, unit on both builds, e2e, and the store build's e2e.
  - `data-layer.yml`: its paths cover every file its build includes (the vectors, the shown scenarios, the token list, `constants.rs`, `networks.ts`, `nft-images.json`).
  - The v2 fixtures' writer is gated (`RECORD_LOVEJOIN_V2_FIXTURE`).
  - `release.yml`'s `*.*.*` glob doesn't match `web-wallet/1.8.0`.
- **SECURITY.md:** the scope is the latest `web-wallet/` tag, and nothing 1.8.0 changes bears on it.
- **The store images** (en, es and ja: screenshots 1–5, the promo tile, the icon) show Home's two tabs, Send privately, Create a Seedelf and Make public. No Lovejoin screen, no 10 ₳ boxes, no classic pool. The *Test instructions* still hold.
- **seedelf-data/README.md:** 44a updated it (`version` on `lovejoin/pools`, the rule per template set, the vectors per set). Nothing 44b did makes it false. Same for keys-and-accounts.md, the root README and seedelf-platform/README.md.
- **The data layer's verdicts** (`discovery.rs`): a `Rejected` verdict is kept until restart and dropped from the kept read, so the deploy-before-launch order in 44c holds, and a later deploy fixes it too. 1.7.2 wallets reading a 44a data layer are fine: 1.7.2's `poolRows` ignores feed pools it doesn't read, and its WebAssembly refuses a v2 pool on the list.
- **`adaPool`'s `ask`** sends nothing new (release#3's reasoning; 1.7.2's `split` and `ours` already asked `readSet(network)`).
- **The head start's `version` field is guarded:** dropping `version` from a v2 entry fails `lovejoin-pools-head-start.test.ts` ("holds only pools the wallet would show": `shown(pools)` no longer equals the file).
- **With a stand-in v2 pool bundled on preprod,** these still pass: `lovejoin-pools-head-start` and `lovejoin-discovery` (23 tests), and `lovejoin-retired` and `lovejoin-form-review-fixes` (35 tests).
- **The live runs** (`e2e/live/`) and `tests/live.test.ts` have no Lovejoin step, so 1.8.0 doesn't break them.

## Not checked

- Anything that needs the network:
  - whether the running data layer is already at `c441881e` or later;
  - preprod's `47bece42…` on chain;
  - the mainnet classic pool's crowd. release#2's "1.7.2's words were true" rests on 1.7's returns having mixed on mainnet.
- The e2e: I didn't run Playwright (the tests-e2e lens). The `fivePool` breakage is by reading.
- `lovejoin-registry` itself, which the brief forbids running. Its behaviour is shown through its source and WebAssembly's answers.
- The bodies of #363 and #364 (no network), for any open items they name.
- The back-translations of 44b's critical keys (the i18n lens).
- Code comments that still say 10 ₳ where the box is now 5 ₳, listed but not judged: `Home.tsx:1468`, `DappApprovals.tsx:435` and `:530`, `rpc.ts:1664` and `:2042`, `Lovejoin.tsx:6` and `:45`, `preferences.tsx:6` and `:90`, `Swaps.tsx:1650`. The doc comment above `retiredOf` at `lovejoin.ts:663-667` belongs to `adaPoolOf`, two declarations down.
- A process note: once, I put a mutated `sessions.ts` back with `git checkout -- <file>` in my sandbox. Nothing else changed, and HEAD stayed at `a6c94743`. Later restores used copies.
