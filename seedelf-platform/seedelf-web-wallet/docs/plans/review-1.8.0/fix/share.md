# 1.8.0's release review: the share lane's fixes

The harness refused this lane's report file ("Subagents should return findings as text, not write report files"), so the lead wrote this one from the lane's structured output, kept in the workflow's journal (`wf_91ead3b3-87a`).

- **Branch:** `review-1.8.0/fix-share`, in `…/scratchpad/fix/share`, from `1beba3fb`.
- **Head:** `a2c5c573` fix(web-wallet): the 5 ₳ pool's draws, shared by a mix, its collateral's mix and a direct return (1.8.0's release review, share). One commit.
- **Files:** `src/background/lovejoin.ts`, `src/background/sessions.ts`, `src/ui/screens/Lovejoin.tsx`, `tests/lovejoin.test.ts` (the `:2342` count), and the new `tests/lovejoin-share-review-fixes.test.ts` (22 tests).
- **Words:** none changed. Nothing awaits back-translation.
- **Harness and logs:** `…/scratchpad/share-lane/` (`mutate.py` and `spec.json`, 25 mutants; `mutants/` from the final run on the committed state, `mutants-before/` from the first; `run-chunk-*.log`; `base-final.log`).

**At the base** (the three source files from `git show 1beba3fb`, then restored, sha256 checked): `npx vitest run tests/lovejoin-share-review-fixes.test.ts --maxWorkers=2` gave **12 failed | 10 passed (22)**. p1-impact's own pins file, copied in: 5 failed (A to E) | 6 passed.

**Fixed:** 22 passed, on the default build and with `VITE_ENABLE_MAINNET=false`, and twice more (stable). With `tests/lovejoin.test.ts`: 114 passed on both builds.

---

## P1 (adapool#0) · fixed

p1-impact's (c). Every hunk of `p1-impact-prototype.diff` was checked against `1beba3fb` (`git apply --check`: clean), then written by hand in the house style.

**What changed**
- **`lovejoin.ts`:**
  - `TAIL_DRAWS` is exported.
  - A new exported **`roomLeavingTail(free, draws)`** holds `roomIn`'s hold rule: `max(fit(free − TAIL_DRAWS), min(1, fit(free)))`. `roomIn` calls it; `acrossOf`'s calls to `roomIn` are unchanged.
  - **`againBoxes`** counts through `roomLeavingTail` where Settings' `lovejoinCollateral` is on and `adaPoolOf(readSet quiet)` is the pool it mixes in (funding's `tail` rule). That rule is exact: `usableNow` differs for Mix again only on copies, and `adaPoolOf` never picks a copy.
  - **`chain()`'s `holdTail`** is `way.collateralPool && (boxes === undefined || again)`, with `ChainCall.holdTail`'s comment updated.
  - **`collateralPool`** returns `free` (`CollateralPool.free`, a required field; only `collateralPool` builds one).
- **`sessions.ts`:**
  - **`tailReserve`** takes `draws` `{pool, count}`, and answers `short` where that pool is the collateral's and `free − count < TAIL_DRAWS`. The reserve is still paid, so the form's figures stay the review's.
  - **`mixFunding`** passes `boxes × mixesPerBox(depth, width) × (width − 1)` and its pool. Its `collateralMix` is `reserve && !short ? mixed : ifLeft`.
- **`Lovejoin.tsx`:** `mixOffer` gets a `left` argument, and `tailShort` is also true when `left < COLLATERAL_MIX_DRAWS`, the reserve still counted. The Mix form's call passes `room.have − room.need` where `funding.collateralPool` is the page's pool and the room isn't under its floor. **The stepper is never capped** (no paternalistic guards).
- **`tests/lovejoin.test.ts:2342`:** 5 → 4, with its comment.

**Tests** (11, in `tests/lovejoin-share-review-fixes.test.ts`)
- *"Mix my boxes again leaves its collateral's mix its two draws in the pool it mixes in (P1)"* (6):
  - pin A: 3 of 5 with 33 strangers' boxes, mixed, built with its tail;
  - one wave deep: 14 of 20 with 31, the tail built;
  - pin C: 1 of 1 with 9: `ifLeft`, with the `againNote` hint and the `ifLeft` note;
  - pin E: reviewed at 34 for 4, built at 33 for 3, with the tail;
  - guards: Settings' collateral off takes 4; Mix again in the LJTEST pool takes both that fit.
- *"the tile's Mix keeps the user's count…"* (4):
  - pin B: 4 in 33 is `ifLeft`, reserve 1.5 ₳, the `privateNote` hint, the `ifLeft` note and not giveme.my's; built, all 4 go with no tail. 3 is mixed and built with its tail;
  - one wave deep at one box: 2 and 3 strangers give `ifLeft`, 4 gives mixed;
  - pin D: `mixOffer`'s `left`;
  - keep: the stepper still offers 4 and 10.
- *"the Mix form's line…, wired"* (1): `PoolPage` rendered through a cut-down copy of screens-wiring's render seam. It shows `lovejoin-collateral-if-left` at 9 strangers, and not at 10.

**At the base:** 3 of 5: expected 4 to be 3. 14 of 20: expected 15 to be 14. 1 of 1: expected 'mixed' to be 'ifLeft'. Built at 33: expected 4 to be 3. 4 in 33: 'mixed' for 'ifLeft'. One wave deep at 2: 'mixed' for 'ifLeft'. The form: `tailShort: false` for `{most: 4, tail: 1500000n, tailShort: true}`. Wired: no `lovejoin-collateral-if-left`. The Settings-off, LJTEST-pool and keep guards pass at the base.

**Revert checks**

| Reverted | Result |
|---|---|
| p1-again-review (`againBoxes`' hold) | 2 failed (3 of 5; 14 of 20) |
| p1-again-chain (`\|\| again` dropped) | 1 failed (built at 33), as p1-impact found: chain's hold alone passes A and fails E |
| p1-short (`short` → `{}`) | 3 failed |
| p1-form (`mixOffer`'s `drawn` dropped) | 1 failed |
| p1-form-call (the call passes `undefined`) | 1 failed (wired). Before the wiring test, it survived 109 tests in 4 files |
| p1-settings (`lovejoinCollateral &&` dropped) | 1 failed |
| p1-pool (the pool check dropped) | 1 failed |

## P1-onebox (p1-trace's question 2) · fixed

**What changed** (`sessions.ts` `stopCost`). Its `collateralPoolTakes` value (`takes`) is kept, with the same order and requests. A new private `tailDrawn(network, cost, depth)` runs only where `takes` is `"yes"` (a pool read within `POOL_ROOM_MS`), so it asks nobody. It reads the 5 ₳ pool quietly and its kept room, and counts the boxes the chain makes: `min(cost.boxes, roomLeavingTail(free, draws))`. Where those leave `free − made × draws < TAIL_DRAWS`, Stop's dialog says `ifLeft`. That happens only at the return's one box, where the pool has room for it alone. A swap's approval (`outBuild`) is unchanged: it's a forecast.

**Test:** *"Stop's dialog says where a return's one box leaves its collateral's mix short (P1, p1-trace's second question)"*, p1-trace's `swapReturn` moved in. A swap session funded with its reserve and 30 ₳, two waves deep:
- 8 and 9 strangers' boxes: `{boxes: 1, collateralMix: ifLeft}`, built as 1 box with no tail;
- 10 and 16: mixed, built as 1 box with its tail. At 16 the dialog counts 2 boxes and the chain makes 1 to leave the draws, so this pins that the hold is counted.

**At the base:** at 8, `{boxes: 1, mixes: 4, …}` for `{boxes: 1, collateralMix: 'ifLeft'}`. The 10/16 guard passes at the base.

**Revert checks:** p1-onebox (`&& !drawn` dropped): 1 failed (8 or 9). p1-onebox-naive (`made = cost.boxes`): 1 failed (10 and 16).

**Not changed:** `priced`'s own box count at 16 or 17 (2, against the chain's 1) is the find lane's, and Stop says "at most".

## P2 (cross#5) · fixed

**What changed** (`sessions.ts`, `buildBack`'s tail branch):
- The direct return is built by a local `build(boxes?)`, and `chainOf()` gives its chain (the tail's transactions, then the return).
- Where it has a tail and `intoPool`, it's reserved at once under `chainOwner(index)` until `now + BUILT_TTL_MS`, as `fanOut` reserves a chain.
- On a `StalePool` at that reserve, the taken outpoints are avoided and the return is built again from `intoPool.rows` less them, `STALE_POOL_TRIES` times. Past that it's built with no `collateralPool`, so no mix, and its review shows none.
- `sendChain`'s later reserve, by the same owner, replaces it. `claimBuildNow` needed no change: the reservation covers it.
- `lovejoin.ts`: `export class StalePool`, one word with a comment (outside the lane's row; no other lane names it).

**Tests** (*"a return that comes back directly reserves its collateral's mix as it's built (P2)"*, 3):
- lows-a's `claimOf`, moved in: sessions found by a restore. Session 0 holds 3 ₳ + 5 ₳ and comes back directly with its tail; session 1 holds 40 ₳ + 5 ₳, in a chain; 14 strangers' boxes, one wave deep. `drawn(0) = 2`, `drawn(1) = 12`, none drawn twice, and `claimSubmit` sends both.
- A box its mix drew, reserved by `"public"` at the reserve: the return is built twice, the second build's `collateralBoxes` exactly the first's less the taken box, and its two draws reserved for `chainOwner(0)`.
- Every box taken at every reserve: `STALE_POOL_TRIES + 1` reserves, then no tail, nothing reserved, and the return still builds.

**At the base:** claim: expected 14 to be 12 (session 1 drew all 14, session 0's two among them; lows-a's run had session 0 refused at Send with `lj.stalePool`). Built again: nothing reserved at build. Past `STALE_POOL_TRIES`: expected +0 to be 3.

**Revert checks:** p2-reserve (the loop disabled): 3 failed. p2-catch (`StalePool` rethrown): 2 failed. p2-avoid (rebuilt from unfiltered rows): 1 failed. p2-bound (no `STALE_POOL_TRIES` bound): 1 failed.

## P4: the untested guards, tested

Each of these passes at the base, and fails under its finding's mutant.

| Guard | Test | Mutants caught |
|---|---|---|
| tests-unit#2 (`tailRows`) | "a return into the 5 ₳ pool hands that mix this try's own read of the pool, never the rows read before"; "a private mix into the LJTEST pool, refused a box its collateral's mix drew, draws again without it" (asserted on WebAssembly's request, so not on OsRng's shuffle) | tailRows-noRead (2), tailRows-fanOutNoSplit, tailRows-noAvoid (= adapool m10), tailRows-asBefore (3) |
| tests-unit#3 (`roomIn`) | "2 boxes of LJTEST in a pool with room for 2, and 3 of the 5 ₳ pool's 4 that 8 strangers' boxes have room for: that mix keeps two"; the tile's Mix, 4 boxes built in 33, holds `holdTail` for a mix session | roomIn-acrossPlain (= m29), roomIn-holdAnyPool, holdTail-mixSessionsToo |
| adapool#5 item 4 | the `roomIn` across-pools test above | m29 |
| adapool#5 item 5 | "a return across pools does too, its collateral's in the 5 ₳ pool's leg's read", plus the LJTEST mix test | m30, tailRows-acrossNoSplit, m10 |
| adapool#5 item 6 | "never a token's pool whose box holds 5 ₳, launched before it" (a v2 MIN pool of 5 ₳ a box, launched through `LovejoinLaunchService`, first in the read set) | m23 (`adaPoolOf` without `!p.token`) |
| adapool#5 item 8 | "never 1.7's 5 ₳ pool, retired…" | m26 (funding's tail as 1.7's find) |

**adapool#5 item 7** (`priced`'s 64 cap): no change needed. It's pinned already by `tests/sessions.test.ts:328`; m13 (the cap dropped) fails there (`{boxes: 96, …}` for `{boxes: 64, depth: 1, mixes: 64}`). The adapool finder hadn't run that file.

## For the lead

1. **One edit outside the lane's row in `lovejoin.ts`:** `export class StalePool`. Also new: `roomLeavingTail`, beside `roomIn`, and `CollateralPool.free`.
2. **chain lane:** the only edit in `chain()` is the `holdTail` line. `acrossOf`'s ADA leg still calls `roomIn` with the same signature.
3. **find lane:** `stopCost` reads the 5 ₳ pool quietly and its room through `room(network, ada.id)`, only where `collateralPoolTakes` said "yes", so it adds no request, and after `priced`'s new ask it sees the pool found. It always names `room()`'s pool. `chain-reservations.test.ts:107` and `:120` call `room("preprod")` with none; they break if the default goes. The `buildBack` edit is after `release(chainOwner(index))`, apart from find's no-collateral branch.
4. **screens lane:** the `Lovejoin.tsx` edits are `mixOffer` (its doc, `left`, `drawn`) and one argument and its comment at the Mix form's call.
5. **e2e lane:** Mix my boxes again now takes one box fewer where the pool's room binds and the collateral goes there. A direct return reviewed with its collateral mixed now holds that mix's 2 boxes for `BUILT_TTL_MS`, so a later chain in the same e2e sees 2 fewer free.
6. **critic#4:** the Stop's-dialog test's session has no 1.8.0 marker on `auto.lovejoin`; its builds (1 box at 8–16 strangers) stay under the classic count (2). Run `tests/lovejoin-share-review-fixes.test.ts` after the chain lane is merged.
7. **Not fixed, the same class as P2:** `buildBack`'s resumed collateral mix (the `tailChain` branch) also draws two boxes at build, and is reserved only at Send. Bring everything back over a site session whose chain was cut after its collateral's deposit, with a chain session built after it, can refuse one Send the same way. It's rarer, and outside P2 as found. A fix would reserve there too, with `tailChain` taking `avoid`.
8. **The new test file mocks two modules file-wide**, `vi.mock("react")` and `vi.mock("../src/ui/background")`: screens-wiring's seam cut down. Effects run only for components named in `seam.effects`.
9. **`lovejoin-1-5-0`'s two head-start tests** fail identically at the base and with this change (D6, the e2e lane's).

## Checks run

- `npx tsc --noEmit -p .` at `a2c5c573`: clean.
- The 113 test files importing `lovejoin.ts`, `sessions.ts`, the Lovejoin screen, `chain-fixtures`, `swap-session` or `v2-pools`, in 6 chunks, `--maxWorkers=2`: 1649 passed, 2 failed (1651) on each build. The 2 are `lovejoin-1-5-0`'s head-start case, identical at the base.
- The 27 files reaching them through `dapp.ts`, `handlers.ts`, `sw.ts`, `tx-view.ts`, `lovejoin-pools.ts`, `lovejoin-launch.ts` or `Dapps.tsx`: 176 passed, 2 skipped (the head start's writer and its live test) on both builds.
- The i18n and words files: 10 files, 191 passed, on both builds.
- 25 mutants, each killed by its intended test on the committed state.
- No network, no build, no formatter, no Playwright, no Rust, no git command outside the worktree.
