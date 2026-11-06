# 1.8.0's release review, round two: the fixers' brief

You're one of four fixers of round two's findings. Each lane has its findings and the files it owns. Read this brief all through first. Then read:
- [FIXBRIEF.md](FIXBRIEF.md)'s *How to fix*, all of it, which binds you as it bound round one's fixers: test-first with the revert check, new tests where your row says, match the code around you, the rules that bit before, the words, the checks before you report;
- [REVIEWBRIEF.md](REVIEWBRIEF.md)'s never-do list and [R2BRIEF.md](R2BRIEF.md) (the owner's calls, what's known);
- each finding of your lane in full, in its reviewer's report under [round2/](round2/);
- its trace in [round2/verify.md](round2/verify.md), which may narrow the finding or change its fix. Where the trace and the finding disagree, the trace wins.

## The base and your worktree

- **The base** is `review-1.8.0/merged` at `4b4628e9`: round one's eight lanes merged, plus the lead's fixes (`d188eaec`, `a990deb8`, `4b4628e9`). The full unit suite passes there on both builds, and so do the e2e on the dev and store builds.
- **Your worktree:** the table below names it, on the branch `review-1.8.0/fix2-<lane>` at `4b4628e9`, with `extension/node_modules` and `wasm/pkg` in place. Commit there as FIXBRIEF.md says: stage by path, house-style messages citing `(1.8.0's review of its fixes, r2-<lens>#<n>)`, the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` line, no push, no other branch.
- **The reviewers' scratch tests** are in `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/<lens>/seedelf-platform/seedelf-web-wallet/extension/tests/` (`r2-worker-*`, `r2-screens-*`, `r2-tests-*`, `r2-critic-*`), and the r2-tests runner and mutant specs in `…/r2/r2-tests/r2-tests-scratch/`. Each is a ready start: read it, then move what you adopt into your lane's file, trimmed to what it pins. Never edit them in place.
- **The main tree** is read-only for you, except your report.

## The calls on round two

**The owner answered four on 2026-11-06, each as recommended:** no wider look for token pools in 1.8.0 (a backlog line); D3 stays as it is at width 4's tie (a backlog line); Put in 5 ₳'s refusal under the floor stays; the swap's Plan step stays. The lead's calls below are those, and they stand.

- **r2-critic#1 (a v2 token pool launched later, on Koios paths):** no code change. O1's look stays the 5 ₳ pool's, as the find lane's design scoped it and two rounds reviewed. No v2 token pool exists on either network; on mainnet's default path the data layer's list finds one; widening the look would add a holder read at most returns holding a listed token on Koios paths. The docs that say "any pool" are corrected after the merge, and the owner is told it's theirs to reverse.
- **r2-critic#5 (Put in 5 ₳ offered, then refused, under the floor):** accepted. The list stays quiet, and the refusal says why.
- **r2-worker#4 (the swap's Plan says "directly" with no pool known):** left, as 1.6.0's DX-3 left the same step for a pool short of room. The screen's warn line says "as things are", and its choice "only if Lovejoin's pool has room when it comes back".
- **The share lane's `tailChain` sibling of P2:** left for the backlog, as r2-worker and r2-critic judged.
- **D3 at width 4 ignores the collateral's tail** (r2-worker#0's trace, an aside): with four asked and the hold, at 4 free (depth 1) or 16 (depth 2) three and four each make one box, so four goes and leaves the collateral's mix one draw: the 5 ₳ comes back unmixed where three would have mixed both. It's the owner's D3 rule (boxes alone), so it's left for the backlog and the owner. Don't change `wayOver`.
- **Where round two's trace changed a fix,** the lane's section below says so.

## The lanes

| Lane | Worktree | Findings | Files it owns | Its new test file |
|---|---|---|---|---|
| **sessions** | `scratchpad/fix/share` | r2-worker#0, r2-worker#1, r2-worker#2; r2-tests#0, r2-tests#2 | `sessions.ts`: `priced`, `stopCost`, `tailDrawn`, `tailReserve`, `siteOutBuild`'s room mark, `lovejoinRoomNow`, `lovejoinRoomKept`, and their callers' arguments. `lovejoin.ts`: `room()`, `rooms()`, `collateralPool()` and their doc comments, nothing else. `tests/lovejoin-chain-review-fixes.test.ts` (r2-tests#0's case, in its critic#4 describe). `tests/lovejoin-found-later.test.ts` (r2-tests#2's and Put in 5 ₳'s cases, in its critic#1 describe; not its es `floorShort` pin, which is the screens lane's). `tests/run-traps-review-fixes.test.ts`: its "hands a trap in a funding's look for the 5 ₳ pool on…" test alone | `tests/lovejoin-round2-sessions.test.ts` |
| **retire** | `scratchpad/fix/retire` | r2-critic#0; the comments of r2-worker#3 and r2-critic#2 | `lovejoin.ts`: `retireOnce`, `stopBringingAllBack`, the run's own stop and end (`bringAllBackNow`), `held`, and the doc comments of `adaPool`, `bringAllBack` and `LovejoinDeps.lookSoon`. `lovejoin-pools.ts`: `lookSoon`'s doc, the header's comment (`:40-42`) and `scan`'s doc (`:530`). `sw.ts`: the comment by `serviceDeps`' `lookSoon` (`:235`) | `tests/lovejoin-round2-retire.test.ts` |
| **screens** | `scratchpad/fix/screens` | r2-screens#1 with r2-critic#6, r2-screens#2, r2-screens#3, r2-screens#4, r2-screens#5; r2-tests#1 (with r2-screens#0), r2-tests#3 | `Lovejoin.tsx`: the hub's `takes` and its aside. `BringAllBack.tsx`: the line a pool's page shows while another run goes. i18n: every edit to `en.json`, `es.json`, `ja.json` and `docs/i18n/{es,ja}-provenance.json`, `verified-critical-{es,ja}.json`'s `keys` (never `reviewer`), and `critical-keys.json` by `--write`. The unit pins of the words you change, wherever they are (`tests/lovejoin-found-later.test.ts`'s es `floorShort` pin near `:761`, `tests/approvals-review-fixes.test.ts`, `tests/connector-lovejoin-review-fixes.test.ts`, and any the grep finds) but `e2e/extension.spec.ts`. `tests/lovejoin-screens-review-fixes-1-8-0.test.ts` (r2-tests#3's case in its W8 describe; the hub's cases in its O6 describe) | — (r2-tests#1's cases go into `lovejoin-screens-review-fixes-1-8-0.test.ts`, which has the react seam) |
| **e2e** | `scratchpad/fix/e2e` | the first unlock's retired run, which has no e2e (R2BRIEF's *Known*; r2-critic#4's G1, its unit-reachable half); the e2e pin of `noteLovejoinMixed` | `e2e/extension.spec.ts` | — |

**Where lanes meet:**
- **`lovejoin.ts`:** sessions owns `room()`, `rooms()` and `collateralPool()`; retire owns its functions and doc comments above. Edit nothing else in it. Neither lane changes `adaPool`'s code.
- **`tests/lovejoin-found-later.test.ts`:** sessions adds its case in the critic#1 describe; screens changes the es `floorShort` pin alone. Keep your hunks to those places.
- **The words:** the screens lane changes them, in the unit tests too. The e2e lane changes `e2e/extension.spec.ts`'s pin of `noteLovejoinMixed` to the en value below, exactly.

## Each lane's fixes

### sessions

- **r2-worker#0: Stop's dialog counts its boxes as its return builds them.** The return's chain leaves its collateral's mix its two draws where that collateral goes into the 5 ₳ pool too (`chain()`'s `holdTail`, `fanOut`'s `roomIn`, `roomLeavingTail`), at each width, so `wayOver` picks the width on those counts. Stop's dialog counts the room as `free / draws`: where the room binds it names a box, its mixes and its fees more than the return makes, and at width 4 its width, its fall-back note and even its collateral's word ("mixed", where the return builds no tail) can be wrong (the trace: 51 states). The fix is the trace's **flag form**:
  - priced's `price(spare, upTo, held)` and `leg(spare, held)` take `fits` as `roomLeavingTail(room.free, draws)` where `held`, and `⌊room.free / draws⌋` otherwise, at each width, so `wayOver` weighs what `fanOut` weighs;
  - `stopCost` keeps its order and calls `price(counted, undefined, takes === "yes")` (`=== "yes"`, as `tailDrawn` and `collateralPool`'s success are);
  - `tailDrawn` then gets the chain's width. Better: `priced` returns its `room`, and `drawn` is computed from it (`held && room.free − cost.boxes·draws(cost.width) < TAIL_DRAWS`), which drops tailDrawn's second `adaPool`/`room()` and closes r2-worker#2's tailDrawn half;
  - a swap's Review stays a forecast (P1): it calls `price` with no hold, and nothing it says changes;
  - correct stopCost's L1 sentence (`sessions.ts:3393–3397`).

  The trace's patch is `scratchpad/r2/r2-worker/trace-w0-out/flag.diff`, its 51-state test `…/r2/r2-worker/seedelf-platform/seedelf-web-wallet/extension/tests/trace-w0-stop.test.ts`. Pin at least the trace's (a)–(e): share's Stop at 16 strangers (dialog boxes = the return's = 1, mixes 4, 3.8 ₳); a width-4 approval, depth 1, 4 strangers (dialog `{boxes 1, width 4, no fellBack, "ifLeft"}`, chain width 4, 1 box, no tail); width 4, depth 1, 6 strangers, 15 ₳ (dialog `fellBack` with no width, chain three, 2 boxes); the collateral switch off, 6 strangers, depth 1 (3 = 3); a fresh device with nothing kept. They must kill: the hold dropped; the hold ungated; the cap alternative (cap `cost.boxes` after `price`); tailDrawn at the unheld width; the hold read before priced's `room()`.
- **r2-worker#1: one listing of the pools per review.** A site's funding review lists every pool twice since 1.8.0 (tailReserve's `collateralPool` split, and `lovejoinRoomNow`'s `rooms()`), and a swap's Review has since 1.6.0 (priced's `rooms()` beside tailReserve's split). The fix is the trace's smallest change, with its three conditions:
  - `lovejoin.ts`, beside `collateralPool`, a review-time `collateralRoom(network, params)`: `adaPool(network, true)`, `usableNow`, then `rooms()` (the one read of every pool, kept POOL_ROOM_MS, shared with `priced` and `lovejoinRoomNow`); `"failed"` where `rooms()` fails, so `tell`'s maybe holds; where the kept map lacks the 5 ₳ pool (read before the pool was found), `collateralPool(network, params, undefined, true)`'s fresh split, never "failed"; then the floor and TAIL_DRAWS as `collateralPool` has them, `{ pool, free }`. The trace's code is in round2/verify.md.
  - `tailReserve`: `draws ? collateralPool(…, true) : collateralRoom(…)`. Its `draws` callers (`mixOutBuild`, `againBuild`) keep the fresh split: P1's `short` compares their own fresh draws, which a kept read can't see.
  - `rooms()`'s catch hands a trap on (`catch (e) { if (isTrap(e)) throw e; return undefined; }`). Without it a trap outside `withKeys` (the data layer's token rows' `cip30Address`, `readSet`'s first `verifiedPool`), which today's `collateralPool(tell)` hands on, is swallowed and the funding built on: L3. With it `priced`, `tokenPool` and `lovejoinRoomNow` hand traps on too, an older gap closed (the trace's side finding 1).
  - Build-time reads (a return's collateral pick, `chain()`) are unchanged.

  Pins, each killing its mutant: preprod, pool kept, collateral on, `siteOutBuild` and `outBuild` each list once (credential_utxos naming the 5 ₳ mix_box; on mainnet with the data layer up, `lovejoin/tokens` once; kills tailReserve back on the split); mainnet with the data layer up and `cip30Address` trapping, `siteOutBuild` rejects on both switches (kills rooms()'s bare catch; it replaces `run-traps-review-fixes.test.ts`'s collateralPool spy in "hands a trap in a funding's look for the 5 ₳ pool on…", which you own); 6 free, `rooms()` read, another chain reserves 3, then the tile's Mix of 1 box at depth 1 says `ifLeft` (kills `draws` moved onto collateralRoom); `rooms()` read with no pool, then `lookForPools`, then `siteOutBuild` reserves 2.8 ₳ (kills missing-as-failed). The tell is pinned already (collateral-reserve-review-fixes' fx-may). The trace's model and counting test: `…/r2/r2-worker/…/extension/tests/trace-r2-worker1-*.ts`, wired as `sw.ts` wires the service, the data layer's `index` included.
- **r2-worker#2:** `lovejoinRoomKept` reads the kept room alone: `room(network, ada.id, true)`; so does `tailDrawn` if it keeps its own read. Pin it with r2-worker's `F-quiet` (a clock that ticks per `now()` call), killing the loud form.
- **r2-tests#0:** pin priced's classic cap on D3's leg, in `lovejoin-chain-review-fixes.test.ts`'s critic#4 describe, Stop's `{boxes, width ?? 3}` against the sealed chain's with `fellBack` undefined. The trace keeps only the cases that tell the widths apart: 40 ₳ with 12 strangers and 60 ₳ with 20 (its adoption copy `…/r2/r2-tests/…/extension/tests/trace-r2-tests-adopt-chain.test.ts`). Add its floor-30 case, 80 ₳ with 30 strangers, preprod's floor set to 30 and restored as found-later does (`trace-r2-tests-stop-floor.test.ts`), where the mutant also names a box more than the return makes; and assert the dialog's `mixFees` as boxes × the four-wide funding's. They must fail under mutant B3 (`const pays = affordable(spare);`). Check they still hold with r2-worker#0's hold in.
- **r2-tests#2:** pin the session list's quiet room read, in found-later's critic#1 describe with its `byHand()` helper and `ADA_VIEW` in the top import from `./v2-pools` (the trace's `trace-r2-tests-adopt-found-later.test.ts`). The guard is the request count: no pool read naming `ADA_VIEW.mixBoxHash`; keep the `backCollateral` "missing" check as secondary. It must fail under E1 (`room(network, ada!.id)`). A mainnet twin with the shipped floor (`trace-r2-tests-list-mainnet.test.ts`) is welcome: it kills E1 without touching NETWORKS.
- **Put in 5 ₳'s press reads the pool** (r2-critic#3's trace): r2-critic's `r2-critic-put-in-five.test.ts` into found-later's critic#1 describe too. It must fail where `sessions.ts:4876`'s `!ask` is `true` (the press then stops reading, and critic#1's refusal under the floor goes with it).
- Whatever your fixes change in a request a flow makes (the count of listings, when one is made), say it in your report: the privacy policy's entry is written from it.

### retire

- **r2-critic#0: the boxes the first unlock's retired run hadn't taken are counted, and read, at once after it stops.** The fix is the trace's **A+**, prototyped as `scratchpad/r2/r2-critic/trace0-proto.py` (`A+`), its pins `…/r2/r2-critic/seedelf-platform/seedelf-web-wallet/extension/tests/trace-r2-critic0-pin.test.ts` (5) and its reach test `trace-r2-critic0-reach.test.ts`:
  - `stopBringingAllBack` (`:6919`) and the run's own stop (`bringNoted`, `:7177`): `s.recheck = Math.min(s.recheck ?? Infinity, now + SPENT_KEEP_MS)`, so a Stop never pushes critic#3's earlier read later;
  - `withdrawDueNow`'s recheck read (`:6578`) re-arms instead of deleting while one of the run's withdraws is still listed and held as spent (`counted` against the read's `listed` less `owned`), so a dropped withdraw keeps its two-hour read where nothing else is left: a plain `Math.min` loses it, and only pin 3 catches that;
  - `retireOnce` owes the read at once when it releases a 1.7 Bootstrap's boxes too (`:4229`, `:4245`: `if (counted || released) s.recheck = Math.min(s.recheck ?? now, now)`), the older sibling: hidden two hours after a Stop partway, and never read at all after a run that stopped having sent nothing.

  No UI, i18n, schema or migration change, and no new kind of request: Stop's read moves from two hours on to the next run (one more read at two hours while a withdraw is held as spent), the same pool listing every wallet makes. Pins 1–5 must each kill their mutant (`:6919` reverted, `:7177` reverted, plain `Math.min`, `released` dropped).
- **The comments** (no behaviour change):
  - r2-worker#3: `lookSoon`'s doc, `LovejoinDeps.lookSoon`'s and sw.ts's say the look also runs when Settings' Bring every box back is asked with no pool named, whatever is kept.
  - r2-critic#2: every comment that says the look runs at most every REFRESH_MS a network says it holds while this worker runs (`scanned` is in its memory, as `asked` is): `lovejoin-pools.ts:414-416` (lookSoon), `lovejoin.ts:1591-1592` (LovejoinDeps.lookSoon), `:4158-4159` (adaPool), `:6868` (bringAllBack), `sw.ts:235-236`; and the list's own old ones, `lovejoin-pools.ts:32` and `:439`.
  - r2-critic#1: `lovejoin-pools.ts:417-418` and `lovejoin.ts:4159-4160` say a 5 ₳ pool launched later is found without the page, not any pool: a token pool on Koios paths is found as Lovejoin's page opens, at a pool's start, or at Settings' press.
  - `lovejoin-pools.ts`'s header (`:40-42`) and `scan`'s doc (`:530`): Koios's holder is read as the Lovejoin page opens, and also at an ask (`lookSoon`) and at Settings' press.
- **Two pins of what the comments say**, in your new test file:
  - adaPool's `kept` short-circuit (r2-critic#1's trace): preprod, the 5 ₳ pool kept by a page look, the clock moved REFRESH_MS + 1 on, then a return's build reads no holder. It must kill a mutant that drops adaPool's `kept ||`, which the reviewer's same-instant test can't. The trace's `…/r2/r2-screens/…/extension/tests/trace-c1-when-found.test.ts` has the case.
  - the throttle is a worker's (r2-critic#2's trace): a new PoolDiscovery and LovejoinService over the same storage, as a worker Chrome started again, looks at its first ask (`…/r2/r2-critic/…/tests/r2-critic-throttle.test.ts`). It kills a mutant that keeps `scanned` across workers while the docs still hedge.

### screens

- **r2-screens#1 with r2-critic#6: es `lj.skip.warn.floorShort`**, all three forms, exactly:
  - `_one`: `el pool de Lovejoin tenía {{count}} caja que no era tuya cuando la billetera lo leyó, y la billetera solo mezcla a partir de {{floor}}`
  - `_many` and `_other`: `el pool de Lovejoin tenía {{count}} cajas que no eran tuyas cuando la billetera lo leyó, y la billetera solo mezcla a partir de {{floor}}`

  Check, with r2-screens' reasons scan (`r2-screens-openings.test.ts`, `r2-screens-reasons-dump.test.ts`), that it's shown only after a colon frame. If it can open a sentence anywhere, say where. A critical value: awaiting blind back-translation. Update the es pin in found-later.
- **r2-screens#2: `dappUi.back.privacy.noteLovejoinMixed`**, "once" with the mix, never next to "kept aside". en and es change; ja already keeps the count with the verb, and stays. Exactly:
  - en: `From the dApps page. Lovejoin mixes the spare ADA in 5 ₳ boxes, and the 5 ₳ kept aside in a box of its own, mixed once, only if enough is left, so they're harder to tie to this session; they come back hours later. The rest comes back at once. Settings → Lovejoin turns that off.`
  - es: `Desde la página de dApps. Lovejoin mezcla el ADA sobrante en cajas de 5 ₳, y mezcla una vez los 5 ₳ apartados, en una caja propia, solo si queda lo suficiente, para que sean más difíciles de vincular con esta sesión; vuelven horas más tarde. El resto vuelve de una vez. Se desactiva en Configuración → Lovejoin.`

  Every ₳ keeps its U+00A0 before it, as the values have now: copy the space from the current value, don't type it. A critical value: es awaits blind back-translation. Update its unit pins (r2-screens#2 lists them).
- **r2-screens#3:** the hub's `takes` is `(p) => !p.unusable`: a pool below the network's minimum, retired or a copy takes no new box. Add a below-minimum case to the O6 describe.
- **r2-screens#4:** the hub's aside says "in 5 ₳ boxes" only where every ADA pool that takes boxes holds 5 ₳, or none takes any; otherwise a new non-critical key, `lovejoin.asideAda`: en `A mixer for ADA`, es `Un mezclador de ADA`, ja `ADA をミックスするサービス`, `machine` in es and ja's provenance. A token pool that takes boxes keeps `lovejoin.asideTokens`. Pin each case.
- **r2-screens#5:** on a pool's page that isn't retired, while the retired pools' run goes (`going.retired`), the line says the retired pools' run, not "another pool's", and doesn't ask to stop it: a new key beside `lj.bringOtherPool`'s use there. en: `The retired pools' boxes are coming back now. This pool's can come back once that's done, or use Settings for every pool.` es and ja drafts yours, `machine`, in the house's words (the glossary's *retired*: "los pools retirados", 廃止されたプール). Run `node scripts/i18n-critical.mjs --write`: if the new key joins the critical set, it awaits blind back-translation too; say so.
- **r2-tests#1 with r2-screens#0:** BringAllBack's question wiring, `retired={!!bringAsk(pool, bringing).retired}`, pinned in `lovejoin-screens-review-fixes-1-8-0.test.ts`, which already has the file-wide react seam: a describe with a short `question()` helper (`seam.reset()`, `seed([], bringing)`, `seedInitial(false, true)`, render BringAllBack) carrying r2-screens' five states and its key-level expectations (`t("settings.lovejoin.bringRetiredTitle")`, never literal English), the run shapes the worker writes (no `at` on a `bringing`). The trace's adoption copy is `…/r2/r2-tests/…/extension/tests/trace-r2-tests-adopt-screens.test.ts`. It must fail under C1 (`retired={false}`), C2 (the title ignoring `retired`), C3 (`retired={!!bringing?.retired}`) and C4 (`bringAsk(pool, undefined)`).
- **r2-tests#3:** W8's undecided pool, in the W8 describe, with both `pools` and `known` throwing, as sw.ts's serviceDeps would when discovery's record can't be read (the trace's `trace-r2-tests-chain-undecided-known.test.ts`). It pins rows() to R3's rule (undecided is said as before), not a working action: Mix again is refused in that window. It must fail under I1.

### e2e

- **The first unlock's retired run.** The e2e lane's probe (`fix/e2e.md`, *The first unlock's bring-back*; `scratchpad/e2e-lane/probe.log`) shows the recipe in test A's world: once the hub's read schedules the retired boxes, a lock and an unlock run `retireOnce` at the unlock's run. Under the fakes giveme.my refuses each withdraw, so pin what the fakes allow:
  - after the unlock, `lovejoin-held`'s `bringing` is the retired pools' run (`retired: true`), and giveme.my was asked for each retired box;
  - Home's In Lovejoin never says the retired boxes are "not mixed yet" (critic#3);
  - Settings' Lovejoin shows the retired pools' run, its last failure and Stop;
  - Stop, then Try again: its question reads "Bring the retired pools' boxes back now?" (the lead's a990deb8), and Bring them back starts the retired run again.

  The screens lane's new words aren't in your worktree: assert none of them (the lead adds what's needed at the merge).

  Each assertion must fail where its fix is reverted: the retired run never started at the unlock (drop `retireOnce`'s call there), and Try again's title (`retired={false}`). Stress it as FIXBRIEF.md says, dev and store builds.
- **The pin:** `e2e/extension.spec.ts`'s `noteLovejoinMixed` (`:5328`'s comment and `:5333`'s assertion) to the en value above, exactly.
- **Playwright:** `npm run build:ext` in your worktree, then `npx playwright test --project=extension -g "<pattern>" --workers=2`; the store build as FIXBRIEF.md says, never `npm run package`.

## Your report

Write it to `docs/plans/review-1.8.0/fix2/<lane>.md` in the main tree before you return, in FIXBRIEF.md's form: for each finding what changed, its test with the failure at the base, the pass and the revert check (commands and results), or why it isn't fixed. Then *Awaiting blind back-translation*, *For the lead*, and *Checks run* (tsc, the test files on both builds, with their counts). If the harness refuses the file, your structured output is the report. Return the same as your structured output, with your branch's head commit.
