# 1.8.0's review of its fixes, round two: the sessions lane

Branch `review-1.8.0/fix2-sessions`, from `4b4628e9`, head **`a4f37e49`**, in `scratchpad/fix/share`. Six commits:

| Commit | What |
|---|---|
| `31cb114a` | fix: r2-worker#0, Stop's dialog counts its boxes as its return builds them |
| `6ed11342` | fix: r2-worker#1, one listing of the pools a review, a trap in it handed on (with run-traps' test) |
| `14740f5b` | fix: r2-worker#2, the connect window's card reads the kept room alone |
| `12632bf8` | test: `tests/lovejoin-round2-sessions.test.ts`, the pins of r2-worker#0, #1 and #2 |
| `2cde54c4` | test: r2-tests#0, in `lovejoin-chain-review-fixes.test.ts`'s critic#4 describe |
| `a4f37e49` | test: r2-tests#2 and Put in 5 ₳'s press, in `lovejoin-found-later.test.ts`'s critic#1 describe |

**Two tests outside my files fail at my head by design:** `tests/lovejoin.test.ts` pins the swap Review's old double listing (`poolReads` 2, 3 and 4). The fix is the lead's, at the merge: *For the lead*, 1, with a verified patch.

The scratch tooling and every log are in `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/fix2-sessions/`:
- `mutate.py`: applies each mutant by exact replacement, runs its tests, restores the file and checks it by sha256;
- `spec.py` / `spec.json`: the mutants;
- `mutants.jsonl` and `mutants.jsonl.<name>.log`: each mutant's run;
- `revert-w0.txt`, `revert-w1.txt`, `revert-w2.txt`: the revert checks;
- `base-new.txt`: the new file at the base;
- `default-build.txt`, `preprod-build.txt`, `more-default.txt`, `more-preprod.txt`, `tsc.txt`: the checks;
- `lead/lovejoin-test-pins.diff`: the patch for the lead.

Every command below ran from the worktree's `extension/` with `--maxWorkers=2`.

## r2-worker#0: fixed

**What changed** (`sessions.ts`), the trace's flag form, with its "better" `room`:
- **`priced`:** each width's `at(w)` has `fitsOf(held)`: the room `⌊free / draws⌋`, or with `held` `roomLeavingTail(free, draws)`, as `roomIn` has it where the collateral shares the 5 ₳ pool.
  - `price(spare, held)` and `leg(spare, held)` take it, and so does the outer `price(spare, upTo, held)`, at both widths. So `wayOver` weighs what `fanOut` weighs.
  - `priced` returns its `room`.
- **`stopCost`:** keeps its order and calls `price(counted, undefined, takes === "yes")`, after priced's read.
  - `drawn = takes === "yes" && tailDrawn(room, cost, depth)`.
  - Its L1 sentence now says what the count holds: the funding's reserve set aside (L1), and the collateral mix's two draws where that collateral shares the pool.
- **`tailDrawn`:** now a module function over priced's `room`, at the counted width (the chain's): `room.free − boxes·draws < TAIL_DRAWS`. Its second `adaPool`/`room()` read is gone, which closes r2-worker#2's tailDrawn half.
- **A swap's Review** stays a forecast (P1): `lovejoinCost` passes no hold, and nothing it says changes.

**Test:** `tests/lovejoin-round2-sessions.test.ts`, describe "Stop's dialog counts its boxes as its return's chain builds them…". It uses a device wired as sw.ts wires it (discovery, and the data layer's index in the Lovejoin service's deps). Each test compares Stop's dialog with the chain `stop()` seals:
- **(a)** two waves deep, 16 strangers' boxes, a device that kept nothing: dialog `{boxes 1, mixes 4, mixFees "3800000", "mixed"}` = chain `{1 box, 4 mixes, tail}`;
- **(b)** four a mix, one wave deep, 4 strangers: dialog `{boxes 1, width 4, fellBack undefined, "ifLeft"}`, chain `{1, width 4, no tail}`, mix fees four-wide's;
- **(c)** four a mix, one wave deep, 6 strangers, 15 ₳: dialog `{boxes 2, width undefined, fellBack lj.width.warn.short}`, chain `{2, three}`, mix fees three-wide's;
- **(d)** 6 strangers, one wave deep: with the collateral on (pool kept by the page) `2 = 2` with the tail and "mixed"; Settings' collateral off `3 = 3`, no tail and no collateral word;
- **(e)** (a) to (c) run on a device that kept nothing.

**At the base:** `npx vitest run tests/lovejoin-round2-sessions.test.ts`, 4 of these failed:
- (a) `expected { boxes: 2, mixes: 8, … } to match object { boxes: 1, mixes: 4, … }`;
- (b) `expected { boxes: 2, width: undefined, … } to deeply equal { boxes: 1, width: 4, … }`;
- (c) `expected { boxes: 2, width: 4, … } to deeply equal { boxes: 2, width: undefined, … }`;
- (d) `expected { boxes: 3, mixes: 3, … } to match object { boxes: 2, mixes: 2, … }`.

**With the fix:** `-t "r2-worker#0"`: 4 passed.

**Revert check:** `git diff 31cb114a~1 31cb114a -- …/sessions.ts | git apply -R` on the head, then `-t "r2-worker#0"`: 4 failed, with the same four messages (`revert-w0.txt`). Restored with `git checkout HEAD --`, checked by sha256.

**Mutants**, the trace's list, each killed (`mutants.jsonl`):

| Mutant | Result |
|---|---|
| hold dropped (`price(counted)`) | 4 failed |
| hold ungated (`held` always `true`) | 1 failed: (d)'s off half, `expected 2 to be 3` |
| cap alternative (count unheld, then cap `boxes` at `roomLeavingTail` and recount the mixes and fees) | 2 failed, (b) and (c) |
| tailDrawn at the unheld width | 1 failed: (b), "mixed" for "ifLeft" |
| hold read before priced's `room()` (`collateralPoolTakes` called first) | 4 failed |

**The older tests with the hold in:** the trace's 9-file Stop set (collateral-reserve-review-fixes, lovejoin-chain-review-fixes, lovejoin-share-review-fixes, swap-lovejoin-way, lovejoin-found-later, lovejoin-1-5-0, lovejoin-planner, lovejoin, sessions) gives 354 passed (354), the 6 cases I added included. That run had r2-worker#0's fix in, not yet #1's.

## r2-worker#1: fixed

**What changed:**
- **`lovejoin.ts`:**
  - **`collateralRoom(network, params)`**, new, beside `collateralPool`, the trace's code: `adaPool(network, true)`, then `usableNow`, then `rooms()` (the review's one read, kept POOL_ROOM_MS, shared with `priced`, `tokenPool` and `lovejoinRoomNow`).
    - Where `rooms()` fails: `"failed"`.
    - Where the kept map lacks the 5 ₳ pool: `collateralPool(network, params, undefined, true)`'s fresh split, never "failed".
    - Otherwise the floor and TAIL_DRAWS as `collateralPool` has them, then `{ pool, free }`.
  - **`rooms()`**'s catch hands a trap on: `catch (e) { if (isTrap(e)) throw e; return undefined; }`.
  - **The doc comments:** `room()`'s and `rooms()`'s say they never throw but a trap. `collateralPool`'s `tell` names who asks it now.
- **`sessions.ts` `tailReserve`:** `draws ? collateralPool(…, true) : collateralRoom(…)`, with its `.catch` and the `"failed"` branch as before. A mix's review (`mixOutBuild`, `againBuild`, its `draws`) keeps the fresh split. Its doc says why.
- **Build-time reads** (a return's collateral pick, `chain()`) are unchanged.

**Tests:** `tests/lovejoin-round2-sessions.test.ts`, describe "a review lists the pools once…":
- **Count:** preprod, the pool kept by the page, the collateral on.
  - `siteOutBuild` makes one Koios credential_utxos naming the 5 ₳ mix_box, and still reserves 2.8 ₳ and marks `lovejoinRoom`.
  - Past POOL_ROOM_MS, `outBuild` makes one.
  - Mainnet, the data layer up, its token feed covering the pool, 32 strangers' boxes: `siteOutBuild` makes one `lovejoin/tokens` and no Koios pool listing.
- **P1:** 6 strangers' boxes, `rooms()` read (free 6), a minute on another chain reserves 3, then the tile's Mix of 1 box one wave deep: `collateralMix` "ifLeft", its reserve 1.5 ₳.
- **Found later:** `rooms()` read with no 5 ₳ pool kept, then `lookForPools`, then `siteOutBuild` reserves `"2800000"`.

**The trap**, in `tests/run-traps-review-fixes.test.ts`, "hands a trap in a funding's look for the 5 ₳ pool on…". Its `collateralPool` spy is replaced: the look no longer calls `collateralPool`, which is why the trace saw it fail under the model.
- **The setup:** mainnet, the data layer's index in the Lovejoin service's deps, its token feed covering the mainnet-addressed v2 5 ₳ pool. `cip30Address` traps (both of the file's trap kinds), outside withKeys, on the feed's rows.
- **The trap is handed on by:**
  - `siteOutBuild` with the collateral on;
  - `siteOutBuild` with the collateral off;
  - a site session's top-up review (`topUpBuild`, a fresh collateral), which reads the pools for its collateral alone. So this arm isolates tailReserve's own rethrow.
- **The read failing otherwise** (the token routes 503, then Koios 500 for the mix_box): `siteOutBuild` and `topUpBuild` go on without the reserve.

**At the base:**
- The two count pins failed, `expected 2 to be 1` each.
- The run-traps test failed: `promise resolved "{ changeLovelace: '24766792', …(13) }" instead of rejecting` (collateral off: the bare catch swallowed it, and the funding was built on).
- The P1 and found-later pins pass at the base. They are guards against the wrong fixes the trace named, and they fail under those mutants (below).

**With the fix:** the four pins and run-traps' test pass.

**Revert check:** `git diff 6ed11342~1 6ed11342 -- …/sessions.ts …/lovejoin.ts | git apply -R`, then the r2-worker#1 describe and run-traps' test: 3 failed (`revert-w1.txt`), the two count pins (`expected 2 to be 1`) and run-traps (`promise resolved … instead of rejecting`). The P1 and found-later pins pass, as at the base. Restored, sha256 checked.

**Mutants:**

| Mutant | Result |
|---|---|
| tailReserve back on the split | 2 failed (the count pins, `expected 2 to be 1`) |
| `draws` moved onto `collateralRoom` | 1 failed (P1, `expected 'mixed' to be 'ifLeft'`) |
| the missing pool taken as failed | 1 failed (`expected undefined to be '2800000'`) |
| `rooms()`'s bare catch | run-traps failed (siteOutBuild built on) |
| tailReserve's catch swallowing the trap | run-traps failed, at the top-up arm: siteOutBuild's own `lovejoinRoomNow` read re-raises the trap, so only the top-up tells |
| the tell (`collateralRoom` answering `undefined` where `rooms()` fails) | 2 failed in collateral-reserve-review-fixes (the fx-may tests of a swap's review and of a mix's, a site's funding's and a top-up's review), as the brief said it's pinned there |

**And `tests/lovejoin.test.ts`'s two count pins fail on both builds:** they pin the old double listing. See *For the lead*, 1.

## r2-worker#2: fixed

**What changed:** `sessions.ts` `lovejoinRoomKept`: `room(network, ada.id, true)`, the kept read alone. tailDrawn's half went with r2-worker#0.

**Test:** `tests/lovejoin-round2-sessions.test.ts`, describe "a site's connect window's card reads the kept room alone", r2-worker's `F-quiet`. For k = 1 to 30:
1. a fresh read of the pools, the user busy (`wallet.touch()`) so the wallet stays unlocked;
2. a clock that ticks a millisecond at each `now()`, started k ms before that read lapses;
3. `lovejoinRoomKept`.

It asserts no pool listing over all k, and that the card was marked for some k.

**At the base:** failed, `expected 1 to be +0` (the loud `room()` read the pools once in the lapse window). An earlier draft of this test failed at the base for the wrong reason: the wallet locked itself over the clock's jumps. The `touch()` fixed that, and it's the version committed and run here.

**With the fix:** passed.

**Revert check:** `git diff 14740f5b~1 14740f5b -- …/sessions.ts | git apply -R`: 1 failed, `expected 1 to be +0` (`revert-w2.txt`). Restored.

**Mutant:** the loud form (`room(network, ada.id)`): 1 failed.

## r2-tests#0: pinned

**What changed:** `tests/lovejoin-chain-review-fixes.test.ts`, in its critic#4 describe:
- three cases of a swap approved on 1.7.2 four a mix, one wave deep: 40 ₳ with 12 strangers' boxes; 60 ₳ with 20; 80 ₳ with 30 under preprod's floor set to 30;
- the floor is restored by an `afterEach` in the describe, as found-later restores it;
- the imports gain `afterEach` and `NETWORKS`.

Each case asserts:
- the sealed chain goes four wide;
- Stop's `{boxes, width ?? 3, fellBack}` equals `{chain.boxes, 4, undefined}`;
- the dialog's `mixFees` is boxes × the four-wide funding's.

**Mutant B3** (`const pays = affordable(spare);` at priced's `leg`), with r2-worker#0's hold in: 3 failed, e.g. `expected { boxes: 3, width: 3, … } to deeply equal { boxes: 3, width: 4, … }`. Clean: 3 passed, on both builds.

They also hold with the hold in: they passed in the 354-test run, and the hold leaves these counts as they were (held four has room for 3, 6 and 9).

## r2-tests#2: pinned

**What changed:** `tests/lovejoin-found-later.test.ts`:
- `ADA_VIEW` added to the top import from `./v2-pools`;
- a `poolReads` helper in the critic#1 describe;
- two cases there.

The cases:
- **preprod** (floor set to 30), `byHand()`, the pool kept by the page, its room not read lately: `sessions.list` makes no Koios read naming `ADA_VIEW.mixBoxHash`. That is the guard; `backCollateral` "missing" is secondary.
- **the mainnet twin**, with the shipped floor: the data layer up and Koios-only alike, a `sessions.mainnet` record holding 40 ₳ and no 5 ₳. The list makes no pool read and offers "missing". It doesn't touch NETWORKS.

**Mutant E1** (`room(network, ada!.id)` in collateralWanted): 3 failed in the describe, these two (`expected 1 to be +0`) and the Put in 5 ₳ case below. Clean: passed, on both builds.

## Put in 5 ₳'s press reads the pool (r2-critic#3's trace, with the lead's call on r2-critic#5): pinned

**What changed:** found-later's critic#1 describe, r2-critic's `r2-critic-put-in-five.test.ts`, moved in. Preprod's floor is set to 30, `byHand({ privateLovelace })`, and the pool is kept by the page. In order:
1. the list offers "missing";
2. the press is refused with `sess.backCollateral.notNeeded`, and makes exactly one pool read;
3. the list then offers nothing, with no read more.

**Mutant E2** (`room(network, ada!.id, true)`, the press reading quietly): 2 failed, this case and found-later's existing "under the pool's floor" test. Clean: passed, on both builds.

## Requests changed (for the privacy policy's entry)

A **listing** below is one read of every pool's boxes, the same request as before. On preprod, on mainnet with Koios only, or with the data layer down, it's one Koios `credential_utxos` naming every pool's mix_box. On mainnet with the data layer up, it's `lovejoin/pool` and `lovejoin/since/…`, plus `lovejoin/tokens` and `lovejoin/tokens/since/…`, and Koios for a pool the feed doesn't cover. No new kind of request, nothing new kept, no word on any screen changed.

| Flow | At the merge (4b4628e9) | Now |
|---|---|---|
| A site's private-session funding review, collateral on (the default), 5 ₳ pool kept or found | 2 listings: tailReserve's split, then lovejoinRoomNow's `rooms()` | 1 listing, made by the collateral's look (`collateralRoom` → `rooms()`) and kept POOL_ROOM_MS. A second review within 5 min: 0, where it made 1. |
| The same, collateral off | 1 (lovejoinRoomNow) | 1, unchanged |
| A swap's Review | 2 (priced's `rooms()` beside tailReserve's split), since 1.6.0 | 1 (the second Review within 5 min: 0, where it made 1) |
| A site session's top-up review, with a new collateral | 1 (a split, never kept) | 1, the kept read: none where a read within 5 min is kept, and it's kept for the next review |
| Any review whose kept read lacks the 5 ₳ pool (read before it was found) | its split | its split, unchanged (`collateralRoom`'s fallback) |
| A mix's review (the tile's Mix, Mix my boxes again) | 2 (`fits`'/`againBoxes`' split, and tailReserve's) | 2, unchanged: its collateral's look stays a fresh split |
| Stop's dialog | priced's ask and room, then tailDrawn's `adaPool`/`room()` (kept, so none unless it lapsed between the two) | priced's alone |
| A site's connect window (enable → lovejoinRoomKept) | none, but one listing where the kept read lapsed between its two looks (a window of microseconds) | never |
| The session list, Put in 5 ₳, a return's build, `chain()`, the look (lookSoon), `epoch_params` | — | unchanged. The list asks nothing of the pool; Put in 5 ₳'s press makes one listing (on mainnet, where the floor is set), now pinned. |

## Awaiting blind back-translation

None: no i18n key or value changed.

## For the lead

1. **`tests/lovejoin.test.ts`, "a swap's way back", two tests pin the Review's old double listing.** They fail at my head on both builds:
   - "reads the pool at Review alone…": `expected 1 to be 2` at `:2544`;
   - "says a pool with too few boxes free…": `expected 2 to be 4` at `:2568`.

   The file isn't my lane's. The patch, comments included: `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/fix2-sessions/lead/lovejoin-test-pins.diff`. It changes 2 to 1 at `:2544`, 3 to 1 at `:2547` (the second Review within 5 min reads nothing) and 4 to 2 at `:2568`. In a throwaway copy, run and deleted: `-t "a swap's way back"` gives 6 passed on both builds; with r2-worker#1 reverted it gives 2 failed (`expected 2 to be 1`, `expected 4 to be 2`), so it pins r2-worker#1 too.
2. **`lovejoin.ts` `collateralPoolTakes`'s doc (`:4323` at my head)**, not my function: "Whether it takes it at Review is collateralPool's, read then." Now it's `collateralRoom`'s at a review, and collateralPool's at a mix's review and at a build. Suggested: "Whether it takes it at a review is collateralRoom's, read then; at a mix's review and a build, collateralPool's."
3. **`roomLeavingTail`'s doc** (`lovejoin.ts:831-836`), not mine, names its users: a chain's (`roomIn`) and Mix my boxes again's count. Stop's dialog's count uses it now too (`sessions.ts` priced's `held`). A nit.
4. **The docs, after the merge:**
   - `docs/architecture.md:634` says `collateralPool` is "asked with `tell`, as a funding's look asks it (`tailReserve`)". A review's look now reads `collateralRoom`, the review's one kept read (`"failed"` where it fails); a mix's review still asks `collateralPool` with `tell`.
   - The *Requests changed* table above is what the privacy policy's entry needs: fewer listings, no new request.
5. **Two known over-counts stay in Stop's dialog**, both upper bounds, so "at most" holds. Both come from the brief's `=== "yes"`:
   - mainnet's crowd count under the floor while the live read is over it (`takes` "no" while the return holds), the trace's edge;
   - `collateralPoolTakes`'s `now()` lapsing a moment after priced's `rooms()` answered from the kept read (r2-worker#2's window, for `takes`).
6. **Where the lanes meet:**
   - **`run-traps-review-fixes.test.ts`:** my test needed new imports at the file's top (DataParts, HOLDER, privateIndexClient, atSession, fakeIndex/indexRowOf, bech32, memoryArea, ADA_VIEW, adaStrangers).
   - **`lovejoin-found-later.test.ts`:** my hunks are the top import and the critic#1 describe's end. That shifts the es `floorShort` pin the screens lane edits by about 50 lines, in another hunk, so a 3-way merge should take both.
   - **`lovejoin.ts`:** I touched `room()`, `rooms()`, `collateralPool`'s doc, and added `collateralRoom` beside `collateralPool`. The retire lane's functions are untouched.
7. **The e2e:** no e2e assertion depends on Stop's dialog's counts or on a review's listing count. I grepped `e2e/extension.spec.ts`: the Stop test asserts its words alone, and the found-later e2e counts holder reads at a return's build, unchanged.
8. **The lead's calls kept:**
   - `wayOver`'s D3 rule is unchanged;
   - the swap's Review stays unheld (a forecast, P1);
   - critic#5's list stays quiet, and the press refuses with its reason (pinned above).

## Checks run

- **`npx tsc --noEmit -p .`:** clean (`tsc.txt`).
- **The 64 test files my changes reach.** That's every file naming `stopCost`, `outBuild`, `siteOutBuild`, `mixOutBuild`, `againBuild`, `topUpBuild`, `backCollateral*`, `lovejoinRoomKept`, `collateralPool`, `collateralPoolTakes`, `room(`/`rooms(`, or `session-stop-cost`, plus r2-tests' other stopCost files, the dApp connect files, and the i18n and words files (`tests/i18n*.test.ts`, `words.test.ts`, `worker-words.test.ts`). The list is in `files.txt`.
  - Default build: 1317 passed, 2 failed (1319), 64 files (`default-build.txt`).
  - `VITE_ENABLE_MAINNET=false`: 1317 passed, 2 failed (1319) (`preprod-build.txt`).
  - The 2 failures are `tests/lovejoin.test.ts`'s count pins, *For the lead*, 1.
- **The 17 other dApp, settings and handler files** (`more-new.txt`): 164 passed, on both builds.
- **The lane's own files**, at the head: `tests/lovejoin-round2-sessions.test.ts` (9), `lovejoin-chain-review-fixes` (12), `lovejoin-found-later` (40) and `run-traps-review-fixes` (14). All 75 pass, on both builds (inside the runs above).
- **No other runs:** no Playwright, no `npm run build`, no network.
