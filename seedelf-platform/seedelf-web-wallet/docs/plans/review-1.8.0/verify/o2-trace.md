# O2 · trace verification (o2-trace)

Verifier: **o2-trace**, round two. Tree `a6c94743`, sandbox `wt/cross`. Cluster O2: release#1 (medium), adapool#2 (low), tests-unit#9 (low). Below: the five claims of the brief, the proposed fix, then each member's verdict, what I covered and what I didn't check.

**All five claims hold.** Claim 2 is medium: in one window, a swap's own return pays Lovejoin fees its approval said it wouldn't. Claims 3 and 4 are low (words), and claim 5 is O1's. Of the proposed fix:
- **Fix 1** (`priced` asks at Review) is right and enough.
- **Fix 2** (`collateralWanted`'s no-pool reason) must ask first, at the return's build alone. Read literally, it trades one false critical reason for another.
- **Fix 3** (`skipped` keeps the choice) must be narrowed. As worded, it replaces a true line with a promise that can't come true.

## How I tested

Two files of my own, in the sandbox's `extension/tests/`:
- `o2-trace-scratch.test.ts`, 8 tests: what `a6c94743` does. `npx vitest run tests/o2-trace-scratch.test.ts --maxWorkers=2 --silent=false` gives **8 passed**.
- `o2-trace-fix.test.ts`, 7 tests: what the fixes should do, plus two probes. `npx vitest run tests/o2-trace-fix.test.ts --maxWorkers=2` gives **4 failed, 3 passed** at `a6c94743`. The four are the fixed behaviour; the three are the Koios-only check and the two probes.

**The world is the worker's own discovery, not hand-faked `known`/`pools`.** The finders' scratches set `known` and `pools` by hand. Mine wire discovery as `sw.ts` does:
- a real `PoolDiscovery` whose head start holds no v2 pool;
- its `index` goes through the real `privateIndexClient` gate (the Koios-only switch, the private part up). Behind it is `fakeIndex`, whose `lovejoin/pools` lists the v2 5 ₳ fixture (`wasm/tests/fixtures/lovejoin-v2-ada-pool-preprod.json`);
- Koios's holder is a counting fake;
- the Lovejoin service runs on `serviceDeps(discovery)`, with `lookForPools` and `facts` as in `sw.ts`.

The network is preprod (the fixtures'), with the data layer's origin forced: that's mainnet's wiring. The pool's own boxes come from Koios's fake (`ADA_ROWS`, 20 of other people's), not the data layer's `lovejoin/tokens`. That changes nothing in `priced`, `tailReserve`, `collateralPool` or `chain()`. Preprod's floor is 0; two probes raise it to 25.

**Mutations:** each fix was applied to the sandbox's `src/`, the tests run, then the file put back from a copy. The sha256 sums are checked after: `sessions.ts` `35cbea47…`, `Swaps.tsx` `c5adbd5a…`. Nothing else was changed, and no git state.

## Claim 1 · one swap review that disagrees with itself

**CONFIRMED · medium (as the cause of claim 2) · new · mainnet only, once per device, in a window**

**Trace.** At Review, `outBuild` (`sessions.ts:1841`) calls `lovejoinCost(…, pool = true)`, which runs these in order:
1. `priced` reads `adaPool(network)` quietly (`:1759`). With nothing kept, it gets no pool, so `skipped` is `noAdaPool`, with no box, no `of` and no `ifStopped`.
2. `tokenPool` then calls `poolsOf(network, unit, !pool)` (`:1622`, `:1675`). That isn't quiet: `readSet` → `pools` → `discovery.refresh` asks the data layer's list and keeps the pool.
3. Then `tailReserve` (`:1845`) → `collateralPool` → `adaPool(network, true)` (`lovejoin.ts:4119`) finds it in the quiet read, and the review takes the 1.5 ₳ reserve.

So in a swap, the read that finds the pool is the token pool's look, not `collateralPool`'s own ask, as the finders put it. The effect is the same. A site's funding review asks through `collateralPool` alone.

**Evidence.**
- `o2-trace-scratch` "claim 1":
  - quote: `listAsked 0`, `skipped` noAdaPool, no reserve (`collateralPoolTakes` is "no" with nothing kept);
  - review: `{"boxes":0,…,"skipped":"Lovejoin has no pool of 5 ₳ boxes to take it yet"},"collateralReserve":"1500000","collateralMix":"ifLeft"} listAsked 1`;
  - the pool kept afterwards (`adaPool("preprod")` finds `0eedc4eb…`);
  - the same review built again: no `skipped`, `"ifStopped":{"boxes":2,"mixes":2,"mixFees":"1900000","withdrawFees":"600000"}`.
- "claim 1's order of reads" logs the reads:
  - typing: `adaPool([]) 0→0`, `poolsOf([MIN,true]) 0→0`;
  - Review: `adaPool([]) 0→0`, `poolsOf([MIN,false]) 0→1`, `adaPool([true]) 1→1 found 0eedc4eb`, `collateralPool(…) 1→1 found 0eedc4eb`.
- **The user never sees the no-pool reason.** With no box, no `of` and no `ifStopped`, `any` is false (`Swaps.tsx:1290`). The approval rendered from that summary says "The proceeds and everything left, directly … Too little spare ADA for a Lovejoin box, so it all comes back at once." It also shows "For its collateral's mix 1.5 ₳" and "Its 5 ₳ collateral is mixed only if enough is left when it comes back."
- **Under the floor, the money agrees** (probe, a floor of 25):
  - 30 others: noAdaPool and the 1.5 ₳ reserve;
  - 20 others: noAdaPool and no reserve, since `collateralPool`'s `floorShort` gives none.

  So under the floor both halves come back directly, and only the reason is wrong: "no pool" for a pool under its floor.

**Reachable** only when all of these hold:
1. **Mainnet with the data layer read:** Koios-only off, the private part up. On preprod, and with Koios-only on, the Review's ask finds nothing, so both halves say none (claim 5, O1).
2. **The v2 5 ₳ pool on the data layer's list but not kept on the device.** That's when 1.8.0 ships without it in its head start, which the owner's call of 2026-11-06 allows, or the pool is launched after the release.
3. **The pool past its floor**, with two free draws. Otherwise there's no reserve.
4. **This Review is the device's first read that asks since the pool was listed.** The Lovejoin page, any return's build and the withdraw run with something open all ask. Home doesn't: `held()` reads `readSet(network, true)`.

After that the pool stays kept for good. A user who mostly swaps meets this at their first private swap after the launch. A wallet with Lovejoin boxes asks at its first unlock instead (`retireOnce` → `bringAllBackNow` → `ours`).

**New:** 1.7.2's `priced` read the classic pool, always in the read set. `e8dc1ec9` made `chain()` and `collateralPool` ask, not `priced`.

## Claim 2 · the swap's return mixes, with fees the approval never showed

**CONFIRMED · medium · new**

**No review comes between the approval and a fill's or refund's return.**
- After a fill or a refund, the runner's own step calls `bringBack` (`sessions.ts:3689`, `:3735`), then `buildBack` → `sendBack` (`:4155-4165`). The page isn't involved, and nothing is shown.
- The approval's record keeps the depth, the wait, the width and the token's boxes (`auto.lovejoin`, `wayOf` `:6156-6169`). Nothing in it caps or bars the ADA's boxes, and `direct` is false.
- **Stop is different.** Its dialog (`stopCost` → `priced(network, true, …)`) prices the boxes, with the pool kept by then. The user then picks "Stop, through Lovejoin" or "Stop and bring it back directly", so a review comes first there.

**Evidence.**
- "claim 2", one wave deep:
  - approved record `{"direct":false,"lovejoin":{"depth":1,"delay":"1-6"}}`;
  - the order refunded (12 ₳ back, 4.5 ₳ of change, the 5 ₳ collateral) and the runner run once (`advance("preprod", 0)`, its own run): `refunded`, txs `out, swap, deposit, mix, mix, deposit`;
  - four transactions into the 5 ₳ pool, with 2, 3, 3 and 1 mix-box outputs; the chain `{boxes 2, pools {ADA: 2}, total 6, tail}`.
- Two waves deep, Settings' default:
  - **The refund.** The approval is the same: noAdaPool, no `ifStopped`, the 1.5 ₳ reserve, "The proceeds and everything left, directly" and "Too little spare ADA for a Lovejoin box, so it all comes back at once." The return built `{boxes 1, mixes 4, fees 4.664195 ₳, txs 8}`, plus the collateral's mix (1.008107 ₳, out of its reserve).
  - **500 MIN sold for 50 ₳.** The approval says "Comes back, about 58.5 ₳", "The proceeds and the rest directly; its 5 ₳ collateral in a Lovejoin box, later" and "Too little spare ADA for a Lovejoin box, so all but its 5 ₳ collateral comes back at once." Filled, the return built `{boxes 2, mixes 8, fees 7.979558 ₳, txs 12}`, with 35.52 ₳ back at once. That's about 8 ₳ of the 58.5 ₳ the approval named, gone in fees.
  - **Why only two boxes.** My pool holds 20 others: room for (20 − 2) / 8 draws. The 54 ₳ spare pays for 5. With fix 1 the same review says "About 2 of 5, as the pool is now … Mix fees, about 7.6 ₳ … about 0.6 ₳".
  - **A bigger pool takes more,** up to one chain: 32 boxes two waves deep, about 130 ₳ of estimated fees for 160 ₳ mixed (adapool#3's figures).

**Why medium.** It's a wrong outcome a user meets in normal use: the swap's own return takes fees its approval said it wouldn't, with no screen in between. That breaks Money first ("pays a fee it didn't say"). It isn't high:
- nothing is lost to anyone else, locked or stranded;
- the fees buy the mixing the user's own Settings default asks for (Lovejoin returns on);
- it happens once per device, on mainnet, inside claim 1's window.

The owner may weigh it higher for a large ADA-out sale into a pool with room. Early on, a pool just past its floor has room for 3 or 4 boxes two waves deep, about 12–16 ₳.

## Claim 3 · the no-pool words of a swap's approval

**CONFIRMED, broader than stated · low · new**

**Evidence** ("claim 3"). No pool anywhere: the data layer lists none, the head start holds none.
- MIN→ADA, 50 ₳: summary `{boxes 0, skipped: noAdaPool}`. The approval says "The proceeds and everything left, directly … Too little spare ADA for a Lovejoin box, so it all comes back at once." It says nothing of the pool, and has no switch ("Bring it back through Lovejoin" is absent).
- ADA→MIN, 10 ₳: the same words.

**Broader than stated:** every swap reviewed with no pool known, not only an ADA-out one. With the classic pool, 1.7.2 showed an ADA→MIN swap its choice through `ifStopped`.

**Reachable:**
- on mainnet until the v2 pool is launched (1.8.0 may ship first);
- with Koios-only on;
- on preprod until the head start carries its pool;
- in claim 1's window.

**Why low.** `swaps.review.noBox` isn't a critical key (`docs/i18n/critical-keys.json`). The outcome it states (it all comes back at once) is true; the reason is false, and the approval hides the Lovejoin switch.

## Claim 4 · a return whose collateral is gone

**CONFIRMED · low · new**

**Evidence** ("claim 4"): a site's session with 40 ₳ at its account and its 5 ₳ collateral spent.
- **No pool anywhere:** "its spare ADA is too little for a box". It's saved with the session (`lovejoinSkipped`), and shown later as "Lovejoin was left out of its return: its spare ADA is too little for a box. So it comes back directly, tied to the session on chain."
- **Listed but not kept:** the same words, and nothing asked (`listAsked 0`). With no 5 ₳ at the account, `buildBack` builds no chain. It reads `collateralPool` only where a 5 ₳ is there (`sessions.ts:4393-4404`), and `collateralWanted` reads quietly (`:4701`).
- **Kept:** `noCollateral`, which is true.

**New:** 1.7.2's classic pool always priced a box, so this was `noCollateral`.

**Reachable** when a return has no 5 ₳ collateral at its account while no pool is known: a site's transaction spent it, or a return before this one took it and more money arrived since. That's rare.

**Why low, though `sess.skip.warn.noBox` is critical:** the critical part of the frame (it comes back directly, tied to the session) is true, the false clause names the wrong cause, and the case is rare. By the letter of the scale ("a false statement in a critical string") it could be medium; I'd keep it low.

## Claim 5 · Koios-only mainnet

**CONFIRMED · this is O1's (the lead filed release#1's Koios-only half there), medium there · new**

**Evidence** ("claim 5"). Run once with Koios-only on, and once with the private part marked down for an hour (`parts.down("private", 3_600_000)`). A site's session's return, with its collateral:
- **Before the page's look:** `noAdaPool`. The data layer's list is never asked (`listAsked 0`) and Koios's holder never read (`holder.asked 0`).
- **After `lookForPools`** (the page's look): the holder is read once, `{"grew":true}`, and the next return mixes 6 boxes.

**Trace.**
- `privateIndexClient` answers none with Koios-only on or the part down (`private-index.ts:368`).
- `refresh` then asks nobody (`lovejoin-pools.ts:431`).
- Only `look` reads the holder (`:402`). Its one caller is `handlers.ts:531`, from Lovejoin.tsx's opening (`:1747`).

**Reachable** on mainnet. Koios-only is a Settings switch, off by default. The private part is down for a hold after a failure. Until the Lovejoin page opens, every mainnet return comes back directly saying "Lovejoin has no pool of 5 ₳ boxes to take it yet". That key is critical, and false here.

**O2's fixes don't reach it.** With fix 1, the swap's review agrees with itself there (both halves say none) but still finds nothing. Only O1's fix covers it: `adaPool`'s ask looks at Koios's holder, throttled.

## The proposed fix

### 1. `priced` asks at Review: `adaPool(network, pool)` (`sessions.ts:1759`)

**Right, and enough for claim 1 and for claim 2's money in claim 1's window.**
- **One review agrees with itself** (`o2-trace-fix`, its first describe):
  - buy: `ifStopped {boxes 2, mixes 2, 1.9 ₳, 0.6 ₳}`, no `skipped`, the 1.5 ₳ reserve;
  - sell: `{boxes 2, mixes 8, mixFees 7.6 ₳, withdrawFees 0.6 ₳, of 5}`, with the approval's Lovejoin cost rows;
  - Koios-only: noAdaPool and no reserve.
- **No new request.** The list is asked once at Review, as before: `tokenPool`'s look already asked it, and `refresh`'s REFRESH_MS throttle holds. As the user types it's still quiet (`listAsked 0`). Stop's dialog asks too (`stopCost` passes `true`), which is a user action and one throttled request, as any pool read is.
- **Breaks nothing:**
  - `lovejoin-1-5-0`, `swap-lovejoin-way`, `lovejoin-retired`, `approvals-review-fixes`, `swap-runner`, `swap-page`: **104 passed**;
  - `sessions`, `collateral-reserve-review-fixes`, `lovejoin-planner`, `dapp-prompt`: **202 passed**;
  - with all three fixes: the screens (`approvals-review-fixes`, `screens`, `lovejoin-hub`, `swap-page-words`, `swap-form`) **180 passed**; `i18n-worker-reasons`, `lovejoin-planner`, `session-collateral`, `sessions-review-fixes`, `lovejoin-retired`, `lovejoin-1-5-0`, `return-site-outs` **171 passed**; `lovejoin` **92 passed**;
  - `npx tsc --noEmit -p .` is clean outside the scratch files, and `VITE_ENABLE_MAINNET=false` runs the fix file at 5 of 5.
- **Residual:** a pool listed only after the Review (none then) is still used by the return, with fees nobody priced. That's the owner's 2026-11-06 call ("when it exists it uses it"), and with fix 3 the approval says so: "Only if Lovejoin's pool has room when it comes back." A swap's return comes minutes after its Review, a stopped or refunded one later.
- **Pin it** with `o2-trace-fix`'s first describe: it fails at `a6c94743` and passes with the fix. It also asserts no ask as the user types, which no test that wires `pools` without `known` can (tests-unit#9).

### 2. `collateralWanted` with no pool says `noAdaPool`

**Right in direction; read literally, not enough.**
- **Mutation A, the quiet read:** `else if (!(await lovejoin.adaPool(network))) skipped = noAdaPool`. "No pool anywhere" gives noAdaPool, which is true. But "listed, not kept" gives "Lovejoin has no pool of 5 ₳ boxes to take it yet" while the data layer lists one. That's the critical `noAdaPool`, false and saved with the session (`o2-trace-fix`: `expected 'Lovejoin has no pool…' to be 'its 5 ₳ collateral isn't…'`).
- **Mutation B, ask first, at the return's build only:** `const ada = await lovejoin.adaPool(network, true)` before `collateralWanted` in `buildBack`'s no-collateral branch, and `else if (!ada) skipped = noAdaPool`. All three cases come out true: noAdaPool, noCollateral, noCollateral (**1 passed**).
- **Not inside `collateralWanted`.** `backWantsCollateral` (`sessions.ts:5529`, the session list's view, "Read from the device alone") calls it too, and an ask there would put a data layer request into the list's reads.
- **Keep `collateralWanted`'s `ada &&`.** Without it, no pool gives `noCollateral` and the offer of 5 ₳ for nothing (tests-unit#9).
- **The saved `noAdaPool` still owes O4** a wording that stays true once a pool exists.

### 3. `skipped` keeps the approval's Lovejoin choice showing (`any` on `!!l.skipped`, `Swaps.tsx:1290`)

**Right for the no-pool case; as worded, it regresses one corner.**
- **No pool:** the approval says "Bring it back through Lovejoin [switch] — Only if Lovejoin's pool has room when it comes back. — Lovejoin has no pool of 5 ₳ boxes to take it yet, so as things are, this swap's ADA comes back directly, tied to this session on chain."
  - It uses existing keys only, both blind-back-translated (`swaps.lovejoin.warn.pool` and `swaps.lovejoin.privacy.onPoolShort` are in `verified-critical-{es,ja}.json`), so nothing needs a new back-translation.
  - No new text.
  - Private by default: the switch is on, with a way to turn it down.
- **The corner:** the pool short (floor or free) and the ADA paying for no box. That's an ADA-out swap with small proceeds; `priced` then sets `skipped` with no `of` and no `ifStopped`.
  - Today the approval says "Too little spare ADA for a Lovejoin box, so it all comes back at once.", which is true.
  - With the fix it says "Only if Lovejoin's pool has room when it comes back." beside the floor's reason. That can't come true: the ADA pays for no box at any room.
  - Probe (1 ₳ of proceeds, floor 25, 20 others): passes at `a6c94743`, fails under the fix.
- **Narrowing:** show the choice for `skipped` only where the ADA would pay for a box. Have `priced` report `of` at a 5 ₳ box's own price when no pool is shown, as the floor's case already reports it. `any` then holds through `of`, and the no-box line stays where the ADA pays for none.

### Tests

tests-unit#9's two pins are in `o2-trace-fix.test.ts`, ready to move into `lovejoin-retired.test.ts` or a file of their own:
- the review agrees with itself, with no ask as the user types (fix 1);
- a return whose collateral is gone, in the three discovery states, whose view never asks or offers 5 ₳ (fix 2);
- the approval's choice with no pool (fix 3);
- the corner, for fix 3's narrowing.

## The members

- **release#1: CONFIRMED.**
  - Its swap half is claims 1–2: medium.
  - Its Koios-only half is claim 5, filed under O1.
  - Its first fix ("keep the plan's gate on both networks") is overridden by the owner's call of 2026-11-06. Its second is fix 1, plus `collateralWanted` (fix 2, with the ask).
- **adapool#2: CONFIRMED** (claims 1, 3 and 4).
  - Its own rating, low, fits its words. The swap half's money is release#1's medium.
  - Its fix is the proposal, with fix 2's ask and fix 3's narrowing.
  - Its "ADA-out" is every swap with no pool known.
- **tests-unit#9: CONFIRMED · low.**
  - **The offer:** its `sessions-spareAda` mutant (`if (ada && spare >= …)` → `if (spare >= …)`) survives `session-collateral`, `lovejoin-retired`, `lovejoin-1-5-0` and `i18n-worker-reasons` (**56 passed**). My claim 4 test fails under it ("no pool anywhere" gets `noCollateral`).
  - **The ask:** the Review half of its `sessions-pricedAsks` mutant is fix 1, which passed every file listed above, so nothing pins how `priced` reads. My tests pin both directions.

## Covered

- **Discovery's wiring against `sw.ts`:** `PoolDiscovery`, `serviceDeps`, `lookForPools` and `facts`; `privateIndexClient`'s gate; `refresh`'s throttle and keep; `known`'s hand-over; `look` called only by the Lovejoin page.
- **Which reads ask:**
  - `ours` (status, the withdraw run with something open, Bring every box back, Bring one back);
  - `split`/`splitAll`, `poolNamed`, `poolsOf` at Review;
  - `adaPool(…, true)` in `chain()` and `collateralPool`.

  `held()`, Home's, is quiet.
- **The runner's way back after a fill, a refund and a cancel; Stop's dialog** (`stopCost` prices before the choice). **The approval's record** (`auto.lovejoin`, `wayOf`).
- **The floor:** above it the review disagrees with itself; below it only the reason is wrong.
- **The figures** of a chain built by the runner, one and two waves deep, and a fixed review's price beside them (7.6 + 0.6 ₳ priced against 7.98 ₳ built).
- **Every fix,** applied and reverted, against the suites named above, on both builds for the fix file.

## Not checked

- **A live run, or the real data layer's `lovejoin/pools`** (no network). The data layer's list is `fakeIndex`'s, holding the v2 fixture's rows as `refresh` reads them. The 44a server's own copy is the pr363 lens's.
- **Mainnet's own reads of the pool's boxes** (`lovejoin/tokens` through the private index): my pool rows come from Koios's fake. `priced`, `tailReserve` and `chain()` read rooms through `split`, which takes either.
- **The e2e,** and the screens beyond the swap's approval. Stop's dialog with no pool was read only (`swaps.stop.poolShort`).
- **A full-suite run under each fix.** The files run are those that build or render these paths, listed above.
- **How often sites spend a session's 5 ₳ collateral.** Claim 4's frequency rests on reading `buildBack`'s own comment.
- **The es and ja words of the reused keys,** beyond their being in both verified files.
