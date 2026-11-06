# P1 · the trace verifier (p1-trace)

1.8.0's release review, round two. Finding: **P1** (adapool#0, medium). Tree `a6c94743`, traced and tested in the sandbox `scratchpad/wt/tests-unit` (unit tests only, two workers, no network, nothing built). I traced it on my own first and read adapool's scratch test only afterwards.

## P1 · adapool#0

**Verdict: CONFIRMED. Severity: Medium, as rated. Reachability: `reachable`.** The bug is older: 1.7.2 had it for a mix in 8131b1d's 5 ₳ pool. 1.8.0 puts every ADA mix on that path.

### The trace (`a6c94743`)

This covers a mix session from the private balance in v2's 5 ₳ pool: the tile's Mix (`mixOutBuild`) and Mix my boxes again (`againBuild`).

1. **The review counts room for the boxes only.**
   - `fits` (`src/background/lovejoin.ts:3280`) checks `enough(room, boxes, width)`, where `room` is the pool's free others.
   - `againBoxes` (`:3377`) takes `min(mine, ⌊free / (mixesPerBox × (w−1))⌋, most)`: as many as fit.
   - Neither counts `TAIL_DRAWS`. The Mix form's stepper offers up to `⌊free / draws⌋` (`Lovejoin.tsx` `poolRoom` `:226`, `formRoom` `:259`).
2. **The review promises the collateral's mix.**
   - `mixFunding` (`src/background/sessions.ts:2103`) asks `tailReserve`, then `collateralPool` (`lovejoin.ts:4117`). That checks `free ≥ TAIL_DRAWS` on the pool as it stands before this mix's own chain. So the 1.5 ₳ reserve is paid and `collateralMix` is `"mixed"` (`sessions.ts:2157`).
   - The review's hint by the title (`Lovejoin.tsx:177`, `:3032`) is `lovejoin.review.privateNoteMixed` or `againNoteMixed`: "…the 5 ₳ kept aside comes back later, mixed once…". These keys aren't critical.
   - `CollateralMixNote` (`:3853`, `:3934`) shows the critical `swaps.review.privacy.collateralMix`: "giveme.my backs its collateral's mix too, so it sees that mix. If that mix can't go, its 5 ₳ box waits unmixed, tied to this session."
3. **The chain takes the room.**
   - A mix session's `chain()` gets `boxes = record.mix.boxes`, so `holdTail` is never set (`lovejoin.ts:3551`). That's deliberate: ChainCall's comment (`:803`) says "Never a mix session's, whose boxes were paid for: short of room, its collateral comes back with the rest."
   - So `roomIn` (`:816`) returns plain `fit(free)`, and fanOut's room (`:3630`) takes every box the review counted.
4. **WebAssembly finds fewer than two boxes to draw.**
   - fanOut hands over that try's own rows as `collateralBoxes` (`tailRows`, `:3665`).
   - `with_return` (`wasm/src/lovejoin.rs:1784`) sets `avoid = spent_by(chain)`. `CollateralTail::build` then draws from the rows, less `avoid`, less the wallet's own boxes (`draws`, `:301`).
   - `collateral_mix` needs two (`seedelf-core/src/lovejoin/mod.rs:2319`, `fresh_for(1, 1, 3, …)`). With fewer it fails as a `PoolShort`, `.ok()` drops it (`:1796`), and the return is built with `attempt(None)` (`:1865`, `:1867`).
   - So the 5 ₳ collateral is an input of the `back` sweep, with the rest, unmixed. Nothing records why, and nothing says so afterwards.

**When it happens:** whenever the free others, less `boxes × mixesPerBox × (width − 1)`, come to fewer than two.

- **The tile's Mix:** when the user takes the most the form offers and the free count, mod `2 × mixesPerBox`, is 0 or 1.
  - Two waves deep (Settings' default, three a mix): 2 pool sizes in 8, up to 81 free, where the 10-box cap starts to leave room.
  - One wave deep on mainnet: never while nothing is reserved, because the cap of 10 boxes draws 20, under the floor of 30. With 9 or more reserved by the wallet's other chains (free under 22), the form's most leaves fewer than two at every pool size.
- **Mix my boxes again:** once the wallet's own boxes there reach `⌊free / draws⌋`.
  - Two waves deep that's 4 boxes at 32 free, then 2 pool sizes in 8.
  - One wave deep: always.
  - Three deep: 2 in 26.

### Evidence

**My test:** `extension/tests/p1-trace-mix.test.ts`, in the sandbox.

- **Command**, from `extension/`: `npx vitest run tests/p1-trace-mix.test.ts --maxWorkers=2 --silent=false`.
- **Result:** 6 passed, 1 skipped (the patched-fix block), in 27.9 s.
- **Set-up:** the real WebAssembly, on preprod, with v2's 5 ₳ pool fixture (`v2-pools.ts`) and a 200 ₳ private balance, so the reserve is always paid. Settings' depth is as listed, three boxes a mix.
- **What it records:** `buildLovejoinChain` is wrapped to keep the worker's request and WebAssembly's answer, and every built transaction's inputs are read back.
- **Why this is the user's path:** the return is built with `backBuild`, which calls the same `buildBack` as the runner's `bringBack` (`sessions.ts:4158`).

Every row below had the reserve paid (1.5 ₳). Wherever the review said `"mixed"`, the "mixed once" hint and the critical note were rendered too.

The tile's Mix:

| depth | others | boxes | review | chain drew | left | WebAssembly's tail | the 5 ₳ collateral is spent by |
|---|---|---|---|---|---|---|---|
| 1 | 2 | 1 | `mixed` | 2 | 0 | none | `back` |
| 1 | 3 | 1 | `mixed` | 2 | 1 | none | `back` |
| 1 | 4 | 1 | `mixed` | 2 | 2 | built | the tail's deposit |
| 2 | 8 | 1 | `mixed` | 8 | 0 | none | `back` |
| 2 | 9 | 1 | `mixed` | 8 | 1 | none | `back` |
| 2 | 10 | 1 | `mixed` | 8 | 2 | built | the tail's deposit |
| 2 | 32 | 4 (the form's most) | `mixed` | 32 | 0 | none | `back` |
| 2 | 33 | 4 | `mixed` | 32 | 1 | none | `back` |
| 2 | 34 | 4 | `mixed` | 32 | 2 | built | the tail's deposit |

Mix my boxes again:

| depth | own | others | `againBoxes` | review | chain drew | left | WebAssembly's tail | the 5 ₳ collateral is spent by |
|---|---|---|---|---|---|---|---|---|
| 1 | 2 | 4 | 2 of 2 | `mixed` | 4 | 0 | none | `back` |
| 1 | 2 | 5 | 2 of 2 | `mixed` | 4 | 1 | none | `back` |
| 1 | 2 | 6 | 2 of 2 | `mixed` | 4 | 2 | built | the tail's deposit |
| 2 | 2 | 8 | 1 of 2 | `mixed` | 8 | 0 | none | `back` |
| 2 | 2 | 9 | 1 of 2 | `mixed` | 8 | 1 | none | `back` |
| 2 | 2 | 10 | 1 of 2 | `mixed` | 8 | 2 | built | the tail's deposit |
| 2 | 5 | 32 | 4 of 5 | `mixed` | 32 | 0 | none | `back` |

The rows at 32 to 34 others are past mainnet's floor of 30 with nothing reserved. Preprod's floor is 0, but on this path the floor only adds `others ≥ 30`, which they meet, so mainnet behaves the same.

**adapool's scratch test** (`adapool-scratch-mix.test.ts`), read afterwards.

- It runs the same scenarios through `advance`, the runner, and reads the sealed chain record's `tail`. It corroborates mine.
- Its Mix again cases assert only `collateralMix: "mixed"` and that a chain exists. The tail's absence is only logged there.
- My test asserts WebAssembly's answer and the built transactions themselves.

### The three questions

1. **Is the "mixed" promise really shown, and really broken when it's built?** Yes, both, on every row above where fewer than two are left.
   - At review: `collateralMix: "mixed"`, the reserve on its row, the "…comes back later, mixed once…" hint, and the critical giveme.my note.
   - Built: no tail, and the 5 ₳ spent by the `back` sweep.
   - The critical note isn't false about the link. A 5 ₳ swept back with the rest is tied to the session, as its "box waits unmixed" fallback says. But it presupposes a mix that giveme.my backs and a box that waits, and neither exists.
   - The definite promise is the hint's. The choice between the `mixed` and `ifLeft` variants is what fx-promise (1.6.0) made the critical distinction, and here the wrong one is shown.
2. **Is roomIn's one-box exception for a return real?** Yes, and it's `new` (8019541f, 44b).
   - Set-up: a swap's session with `collateralReserve`, two waves deep, 30 ₳ plus the reserve at its account (`swapReturn` in my test).
   - Stop's dialog (`stopCost`) says `{ boxes: 1, collateralMix: "mixed" }` at 8, 9 and 10 others. That's the critical `swaps.stop.privacy.collateralMix`.
   - Built at 8 and 9 others: 1 box, the chain drew 8, no tail. At 10: 1 box and the tail.
   - `roomIn` = `max(fit(free − 2), min(1, fit(free)))` keeps the one box on purpose: "a box of the spare ADA is the more worth mixing".
   - It's rarer than the mix session's case. On mainnet, 8 or 9 free past the floor of 30 needs 21 or more boxes reserved by the wallet's other chains. Three deep, it needs 26 or 27 free.
   - A swap's approval says `"mixed"` too (`outBuild`, `sessions.ts:1935`), but that's a forecast: the room when its return builds can't be known then.
3. **Before 1.8.0, could the same happen in 8131b1d's 5 ₳ pool?** Yes. Read in 1.7.2 (`6b70c1f8`, `git show`):
   - `collateralPool` took the first 5 ₳ ADA pool in the read set (`lovejoin.ts:3970`): 8131b1d's, the one the hub showed.
   - A mix session's `chain()` used the pool it was funded for (`:3453`, from `record.mix.pool` at `sessions.ts:4482`).
   - fanOut's room was `⌊others / draws⌋`, with no hold for anyone (`:3555`). The collateral's rows were `collateralPool`'s (`collateralAsked(c)`, `:3590`).
   - `mixFunding`'s `collateralMix` (`sessions.ts:2143`) and `reviewHint` were the same.
   - WebAssembly's `draws`, `spent_by` and `with_return` are byte-identical between `6b70c1f8` and `a6c94743` (I diffed them).
   - So a mix in that pool met exactly this in 1.7.2. Mixes went to the classic pool by default then, whose room the collateral never shared.
   - 1.8.0 retires the classic pool, so every ADA mix shares the collateral's pool. That makes it `reachable`.
   - Whether mainnet's 8131b1d 5 ₳ pool ever held its floor of others is chain state, which I didn't check.

**Why Medium, not High or Low:**

- **Medium:** it's a wrong outcome a user meets in normal use. The common path is Mix my boxes again at the default depth, once a few of the wallet's boxes wait in a pool of 32, 33, 40, 41… free. The review picks the critical definite note for it.
- **Not High:** no money is lost (the unused reserve comes back in the sweep), and the boxes are mixed as said. The 5 ₳ only joins the session's own return, an output the review already says comes back from the session ("What isn't used comes back"). The link is the same; that output just holds 5 ₳ more.
- **Not Low:** the cause is the review choosing the definite critical variant, not loose wording outside the critical set.

### The fix I'd make

**Recommended: change the words, not the count.**

- Where the review's own boxes leave the collateral's pool fewer than `TAIL_DRAWS` free, say `collateralMix: "ifLeft"`. The plain hint then follows: "What isn't used comes back with the 5 ₳ kept aside." This applies only when that pool is the mix's own (`tailReserve`'s pool id is `mix.pool`).
- Count it from the review's own read. `fits` and `againBoxes` already have the free count and the boxes, so they can hand the leftover `free − boxes × mixesPerBox(depth, w) × (w − 1)` to `mixFunding`.
- Keep the reserve. If the pool grows before the chain builds, the mix still goes, and the `ifLeft` note's giveme.my clause still holds.
- Do the same in `stopCost` (or `priced`) for the return's one-box exception: in the ADA pool, `room.free − boxes × draws < TAIL_DRAWS` means `ifLeft`. Leave a swap's approval alone, since it's a forecast.
- No translated value changes (both keys and both hints exist and are back-translated), so it costs no back-translation. No new text, and no refusal.

**I tested the direction.** I patched `mixFunding` temporarily in the sandbox, checking with a second `room()` read for brevity, and ran it with `P1_FIXED=1 npx vitest run tests/p1-trace-mix.test.ts --maxWorkers=2 -t "words-only fix"`: 1 passed.

- At 9 others two waves deep (the tile's Mix and Mix again) and at 5 others one wave deep (Mix again), the review says `ifLeft`, its hint drops "mixed once", and it renders the `ifLeft` note.
- At 10 others it still says `mixed`.
- With the patch on, `collateral-reserve-review-fixes`, `lovejoin-form-review-fixes` and `collateral-again-review-fixes` passed: 56 tests.
- I then restored the file: its sha256 is back to `35cbea47…`, and `git diff` is empty.

**Not adapool's first fix** (count `TAIL_DRAWS` in `fits`, `againBoxes` and the form's room, and give a mix session `holdTail`):

- For the tile's Mix it refuses or caps a box count that the ledger and the contracts take, to keep room for the collateral's mix. That's a protective rule the owner didn't ask for. At 8 or 9 free two waves deep it would refuse the one box outright.
- It adds a third copy of the rule to the form.
- `holdTail` alone changes nothing at the one-box margin, where `roomIn` keeps the box.
- For Mix again, leaving the last box unmixed so the collateral can be is a trade between two 5 ₳ amounts. That's the owner's call, not a fix.

## Notes

- **Aside, not a finding:** `priced` counts `⌊free / draws⌋` and doesn't count `roomIn`'s hold. With 16 or 17 others two waves deep, Stop's dialog says 2 boxes (and `mixed`), but the return builds 1 box plus the collateral's mix (logged with `P1_SIXTEEN=1 … -t "16 and 17"`). Stop's words say "at most" or "about … all the pool has room for now", so nothing there is false.
- **Scratch files in the sandbox:**
  - `extension/tests/p1-trace-mix.test.ts`, my own.
  - `scratchpad/p1-trace-old/` holds 1.7.2's files, taken with `git show`.
  - `scratchpad/p1-trace-backup/sessions.ts.orig` is the backup used to restore after the patch.
- No file outside my scratch files is left changed.
