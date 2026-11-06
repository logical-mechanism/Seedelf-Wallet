# P1's impact and fix (1.8.0's release review, round two)

Verifier: **p1-impact**. Finding: **P1 = adapool#0**. Tree `a6c94743`, in the sandbox `scratchpad/wt/retire`: unit tests only, two workers, no network, nothing built. I prototyped the fix there to check it, then put every source file back: `git diff --stat` is empty.

My scratch files, all in the sandbox's `seedelf-platform/seedelf-web-wallet/extension/tests/`:
- `p1-impact-scratch.test.ts`: section 1 records what a6c94743 does, section 2 holds the pins.
- `p1-impact-finder-mix.test.ts`: adapool's `adapool-scratch-mix.test.ts`, copied unchanged.

Run each from `extension/` with `npx vitest run tests/<file> --maxWorkers=2 --silent=false`. In the scratchpad: the prototype is `p1-impact-prototype.diff`, the originals `p1-impact-orig/`.

## P1 · adapool#0: a mix session's collateral's mix in the 5 ₳ pool

- **Verdict:** CONFIRMED.
- **Severity:** medium (kept).
- **Reachability:** `reachable`.
  - The review's rule is 1.7.2's: `collateralMix: reserve ? "mixed" : "ifLeft"` (`sessions.ts:2157`; at `6b70c1f8`, `sessions.ts:2143`).
  - 1.8.0 makes it false in normal use. Every ADA mix now goes into v2's 5 ₳ pool, the pool the collateral's mix draws from (call 4).
  - 44b's `roomIn`/`holdTail` (8019541f, new in 1.8.0, not in 1.7.2) leaves a return its two draws. It leaves a mix session none, on purpose: the ChainCall `holdTail` comment says "Never a mix session's… short of room, its collateral comes back with the rest".

### The trace, on a pool sized as mainnet's would be

The finder's scenarios (8–21 strangers' boxes) exist only on preprod: mainnet's floor is 30 others (`networks.ts:71`). So I built my own just past that floor, at Settings' defaults: `lovejoinCollateral` on (`shared/preferences.ts:173`), two waves, three a mix.

**Review.**
- `againBoxes` takes `min(mine, floor(free/8), 32)` (`lovejoin.ts:3377`). The tile's `fits` takes any count up to `floor(free/8)`, and the stepper offers exactly that (`formRoom` / `poolRoom.fits`).
- `mixFunding` → `tailReserve` → `collateralPool` checks two free *before* the session's own draws (`lovejoin.ts:4124`). It pays the 1.5 ₳ reserve, so the review says `"mixed"`.
- The review then shows `lovejoin.review.againNoteMixed` / `privateNoteMixed` and the critical `swaps.review.privacy.collateralMix`.

**Build.**
- `chain()` sets no `holdTail`, since `boxes` is defined (`lovejoin.ts:3551`), so fanOut's room is `fit(free)` (`:3630`).
- WebAssembly's `draws()` leaves `free − boxes×8` boxes, with what the chain spends taken out (`spent_by`). With fewer than two, the tail can't be built:
  - core's `collateral_mix` calls `fresh_for(1, 1, 3, …)`, which refuses with `PoolShort` (`seedelf-core/src/lovejoin/mod.rs:2319`);
  - WebAssembly's `CollateralTail::build(…).ok()` turns that into no tail (`wasm/src/lovejoin.rs:1780-1797`);
  - then `attempt(None)` runs (`:1862-1867`).
- The `back` transaction then sweeps the chain's change **and the collateral** to the private balance.

**What a6c94743 does** (`p1-impact-scratch.test.ts`, section 1; every record passes at a6c94743):

| Case | Review | Built |
|---|---|---|
| Mix my boxes again, 33 strangers, 5 of the wallet's | 4 boxes, `collateralMix=mixed`, reserve 1.5 ₳, critical note shown, hint "…the 5 ₳ kept aside comes back later, mixed once…" | 4 boxes, no tail; the collateral is spent by `back` |
| Same, 34 strangers (control) | 4 boxes, mixed | 4 boxes, tail; the collateral is spent by the tail's `deposit` |
| Tile's Mix at the stepper's most (`formRoom` = 4), 33 strangers | 4 boxes, mixed, hint "…mixed once…" | no tail; 3 boxes: tail |
| Mix again one wave deep, 31 strangers, 20 of the wallet's | 15 boxes, mixed | no tail |

The run's lines, verbatim:

```
[again s33 m5] review boxes 4 collateralMix=mixed reserve=1500000 critical note shown=true hint="…What isn't used comes back; the 5 ₳ kept aside comes back later, mixed once…"; chain boxes 4, tail none
[again s33 m5] kinds mix×16,back; the collateral caab9694… spent by: back
[again s34 m5] kinds mix×16,deposit(tail),mix(tail),back; the collateral cb0a42bd… spent by: deposit
[tile s33] 4 boxes: collateralMix=mixed … chain boxes 4 tail none; 3 boxes: collateralMix=mixed chain boxes 3 tail yes
[again d1 s31 m20] review boxes 15 collateralMix=mixed; chain boxes 15, tail none
```

The finder's own file reproduces exactly (`p1-impact-finder-mix.test.ts`, 6 passed): `[8]`/`[9]` tail null, `[10]` tail; `[again d2 m3 s9] … chain boxes 1, tail none`; `[again d1 m11 s21] … chain boxes 10, tail none`. Its setups are real, but preprod-only. Its assertions record behaviour; they don't test a rule.

The existing suite already holds a P1 state. `lovejoin.test.ts:2342` has 40 others and 12 of the wallet's boxes at two waves: `againBoxes` → `{ boxes: 5 }`, and 5 × 8 = 40 leaves 0 for the collateral's mix. It pins the count, never the collateral.

### Who meets it, and how often

**Who:** anyone mixing from the private balance through the Lovejoin tile on mainnet, at Settings' defaults: the Mix form, and Mix my boxes again. On mainnet the v2 5 ₳ pool is the only ADA pool, so every such mix shares its room with its collateral's mix.

**Who doesn't:**
- A dApp's or a swap's return: `roomIn` holds the draws there.
- A mix from the public account: it puts up its own collateral and has no tail. `againBoxes` is called only by the private `againBuild` (`sessions.ts:2068`), and `chain()` only by a session's return (`sessions.ts:4484`).

**When:** only where the count is bound by the pool's room, and the free others leave fewer than two after it: `free − count × draws < 2`. Pool sizes from 30 to 300 free others (`python3` over the code's own formulas):

| Settings | Draws a box | Tile's Mix at the stepper's top: short in | Mix again, room-bound: short in |
|---|---|---|---|
| Two waves, three a mix (default) | 8 | 14 of 271 sizes (only under 82 free: 32, 33, 40, 41, …) | 58 of 271 (free mod 8 ∈ {0, 1}, about 1 in 4) |
| One wave, three a mix | 2 | 0 (the 10-box cap binds first on mainnet) | 232 of 271 (whenever the room binds) |
| Three waves, three a mix | 26 | 18 | 18 |
| One wave, four a mix | 3 | 2 | 181 |
| Two waves, four a mix | 15 | 18 | 37 |

In practice:
- **The tile's Mix** starts at 1 box (`useState(1)`, `Lovejoin.tsx:2667`), which leaves the draws, so the default count is safe. It's met only when the user presses + to the top while the pool is small. Early on that's exactly mainnet's state: the owner Bootstraps the new pool toward 30, so the top is 3–5 boxes, and about one top-count mix in four is short.
- **Mix again** needs the wallet's free boxes to fill the room: 4 or more in a 33-box pool, 10 in an 80-box one, 32 in a pool of 256 or more. Then it's short about 1 time in 4 at the defaults, and every time one wave deep.

### What the user loses

- **The 5 ₳ comes back tied to the session, unmixed.** It returns at once in the chain's `back` transaction, as one output to the private balance with the session's unused mix fees and its unused 1.5 ₳ reserve. So it carries the session's history: the private UTxOs that funded it.
- **No money is lost.** The reserve comes back too.
- **The marginal privacy cost is 5 ₳.** That `back` output exists anyway, holding the leftover fees, so the 5 ₳ joins an output already tied to the session, where it should have come back separately after one mix.
- **giveme.my sees nothing.** No mix is built.
- **The user was told the opposite**, against the owner's default that the collateral is mixed (2026-10-22/23).

### Is medium right?

Yes. The brief's medium covers "a false statement in a critical string" and "a wrong outcome a user can meet in normal use". This is both.

- **The critical string shown is the wrong variant for this state.** `swaps.review.privacy.collateralMix` says: "giveme.my backs its collateral's mix too, so it sees that mix. If that mix can't go, its 5 ₳ box waits unmixed, tied to this session."
  - Here that mix is never built, by construction, not by chance.
  - The certain outcome is framed as a failure contingency, and "its 5 ₳ box waits" names a box that never exists.
  - The critical variant written for this state, `lovejoin.collateralMix.privacy.ifLeft` ("mixed only if enough is left when it comes back"), is true. The worker picks the other one.
- **The flat promise is in non-critical keys.** "…the 5 ₳ kept aside comes back later, mixed once" is `lovejoin.review.againNoteMixed` / `privateNoteMixed`, not in `critical-keys.json`. Alone they'd be low.
- **It's met in normal use:** default Settings, the only ADA pool, and the young pool 1.8.0 launches into.
- **It isn't high:** no money is lost, the critical note does name an unmixed, tied 5 ₳ as possible, and the loss is 5 ₳ joining an output already tied to the session.

### The fix: comparing (a), (b) and (c)

First, a correction to (a) as framed. Holding `TAIL_DRAWS` costs two *draws*, not two boxes: **at most one box**, and only where `free mod draws < 2`.
- At the defaults, that's 2 pool sizes in 8.
- One wave deep, every time the room binds, since a box draws exactly 2.

And (a) can't promise "always has its draws":
- **The one-box case stays.** `roomIn`'s exception keeps the mix's only box (pin C: 9 strangers, 1 box). Refusing that box would refuse a mix the contracts take.
- **A pool can shrink** between Review and the build (pin E).

So any fix keeps (b)'s rule for that residue.

**(a) everywhere** (`fits`, `againBoxes`, the Mix form's room, `holdTail` for any mix session):
- **The tile's Mix gets a new cap.** The stepper would stop a box short of what the pool and the contracts take, to protect the collateral's mix. That's a protective rule nobody asked for (no paternalistic guards).
- **It buys no privacy there.** The box not mixed stays in the private balance as the funding's change, linked to the same inputs as the session's `back`. So the unmixed 5 ₳ is the same either way, the user mixes one deep box fewer (four mixes, nine-wide) to gain one shallow mix (three-wide) that giveme.my sees.
- **`holdTail` at a tile mix's build is worse.** It would drop a *paid* box, whose 5 ₳ then comes back in `back` instead of the collateral's: the same 5 ₳ tied, and a box fewer.

**(b) everywhere** (boxes as they are; `ifLeft` and the plain hint where the boxes leave fewer than two):
- Every word is true.
- It reuses keys already back-translated: `lovejoin.collateralMix.privacy.ifLeft`, and on the form `lovejoin.mix.privacy.collateralIfLeft` ("At this many, its 5 ₳ collateral is mixed only if enough is left when it comes back.", critical, in both verified files). The plain hints are `lovejoin.review.againNote` / `privateNote`. No value changes, so no back-translation is owed.
- The cost: the 5 ₳ stays unmixed wherever the boxes fill the room. For Mix again that's about 1 press in 4 at the defaults, and every room-bound press one wave deep, though one box fewer would have kept the collateral's mix at no real cost.

**(c), recommended: (a) for Mix my boxes again only, and (b) for the tile's Mix and for every residue.**
- **Mix my boxes again's count is the wallet's, not the user's.** It takes "as many as fit", and the box it leaves stays in the pool:
  - The boxes not mixed yet go first (fanOut's `notMixedYet` order), so the one left is a mixed one wherever the wallet has one, and it comes back on its schedule like any mixed box.
  - One not mixed yet waits for the next press (v2 pools keep their holds). Never sent back unmixed.
  - Leaving it out to keep the collateral's mix refuses nothing. It's the rule 44b already applies to a return (`roomIn`), so it's consistent, and it's the more private default.
  - Settings' collateral switch is the control that turns it down: off, nothing is held.
  - The partial-count words ("The pool has room for 3 boxes at this depth now. Mix the rest once this is done.", non-critical) stay true.
- **The tile's Mix keeps the user's count.**
  - At a count that leaves fewer than two, the review says `ifLeft` with the plain hint, and the form shows its existing one-line note under the stepper. One press of − keeps the collateral's mix: the choice is the stepper, visible, not a link.
  - The default count, 1 box, leaves the draws: private by default.
- **No new or changed words**, so no blind back-translation.
- **Call 4 is unchanged:** the collateral still goes into the earliest v2 5 ₳ pool by `collateralPool`'s rule.
- **The reserve stays paid where the room is short.** The form's figures and the review's stay equal (the form's `tailReserveOf` still counts it), and if the pool grows by the time it's built, the collateral's mix is paid for. If unused, it comes back.
  - This pairing already exists: a swap's approval says `ifLeft` with the reserve paid and its cost row shown (`collateral-reserve-review-fixes.test.ts`, "a token's fill with no box of its own…").

**What (c) costs the user:**
- Mix again: one already-mixed box's extra mixing waits a press, in the sessions where it binds (its funded mix fees come back).
- The tile's Mix at its top count: the 5 ₳ comes back unmixed, as today, but said on the form and in the review.

### The functions (c) changes

Prototyped in `scratchpad/p1-impact-prototype.diff`: 35 lines added, 12 removed, over three files.

1. **`LovejoinService.againBoxes`** (`lovejoin.ts:3341`, the count at `:3377`): where Settings' `lovejoinCollateral` is on and `adaPoolOf(readSet(network, true))` is the pool it mixes in, count through `roomIn` with `holdTail`. That's `max(fit(free − TAIL_DRAWS), min(1, fit(free)))`, the one box kept.
2. **`LovejoinService.chain`** (`lovejoin.ts:3551`): `holdTail` for `again` too, i.e. `way.collateralPool && (boxes === undefined || again)`. Update the `holdTail` (`:801-806`) and `roomIn` (`:808-815`) comments.
3. **`LovejoinService.collateralPool`** (`lovejoin.ts:4117-4128`): return the read's free count (`CollateralPool.free`). Export `TAIL_DRAWS`.
4. **`SessionService.tailReserve`** (`sessions.ts:4635`): take the session's own draws `{ pool, count }`. Where that pool is the collateral's and `free − count < TAIL_DRAWS`, answer `short` and keep the reserve.
5. **`SessionService.mixFunding`** (`sessions.ts:2103`, `:2157`):
   - Pass `boxes × mixesPerBox(depth, width) × (width − 1)` and the mix's pool.
   - Use `collateralMix: reserve && !tail.short ? "mixed" : "ifLeft"`.
6. **`mixOffer`** (`Lovejoin.tsx:350-364`) and the Mix form's call (`:2788-2798`):
   - A `left` argument: `room.have − room.need` where `funding.collateralPool` is the pool shown.
   - `tailShort` also when `left < COLLATERAL_MIX_DRAWS`.
   - `CollateralIfLeft` is then shown as it stands.
7. **The test** `lovejoin.test.ts:2342` ("mixes as many… past ten"): two waves deep, 5 → 4, its comment "four of the twelve go, leaving its collateral's mix two".

### The pins, each failing at a6c94743

They're in `p1-impact-scratch.test.ts`, section 2 (pools sized past mainnet's floor, bar C).

| Pin | What it holds | At a6c94743 |
|---|---|---|
| **A** | Mix my boxes again, 33 strangers and 5 of the wallet's: review 3 boxes, `mixed`; chain 3 boxes with its collateral's mix | `expected 4 to be 3` |
| **B** | The tile's Mix of 4 boxes in 33: `ifLeft`, hint `lovejoin.review.privateNote`, the review renders `…collateralMix.privacy.ifLeft` and not `swaps.review.privacy.collateralMix`; 3 boxes: `mixed` | `expected 'mixed' to be 'ifLeft'` |
| **C** | Mix again's one box where only it fits (9 strangers, preprod's floor of 0): 1 box, `ifLeft`, hint `againNote` | `expected 'mixed' to be 'ifLeft'` |
| **D** | `mixOffer(…, left)`, 4 boxes in 33 free: `tailShort: true`, reserve still counted; 3 boxes: `false` | `expected { …tailShort: false } to match { most: 4, tail: 1500000n, tailShort: true }` |
| **E** | Reviewed at 34 (4 boxes, mixed), a stranger's box gone before the build: the again chain builds 3 boxes and the tail (`holdTail` at build) | `expected 4 to be 3` |
| keep | The stepper still offers 4 in 33 free, and 10 one wave deep: no cap for the draws. Passes before and after: it catches (a)'s cap if it's ever added | passes |

**At a6c94743:** `npx vitest run tests/p1-impact-scratch.test.ts --maxWorkers=2` → `Tests 4 failed | 6 passed (10)`: A, B, C and D fail, and every record and the keep test pass. `-t "pin E"` → `1 failed`, `expected 4 to be 3`.

**With the prototype:**
- `-t "section 2"` → `6 passed`, and the same on the preprod-only build (`VITE_ENABLE_MAINNET=false`).
- `npx tsc --noEmit -p .` is clean.

**Each half has its own pin:**
- Only `chain()`'s hold reverted: A passes, E fails.
- `mixFunding`'s rule and the form's `left` reverted: B, C and D fail, while A and E pass.

**Cost to the existing suite**, prototype applied (27 files, two workers):
- `lovejoin`, `lovejoin-planner`, `collateral-reserve-review-fixes`, `lovejoin-form-review-fixes`, `lovejoin-retired`, `session-collateral`: 1 failed, 250 passed. The one is `lovejoin.test.ts:2342`'s 5 → 4 (item 7).
- `lovejoin-review-fixes`, `lovejoin-release-rules`, `lovejoin-merged-review`, `lovejoin-accounts`, `lovejoin-restore`, `chain-reservations`, `collateral-held`: 123 passed.
- `lovejoin-flows`, `lovejoin-1-5-0`, `approvals-review-fixes`, `screens-wiring-review-fixes`, `sessions-review-fixes`, `lovejoin-token-feed`, `restore-scan`: 188 passed.
- `lovejoin-screens-review`, `lovejoin-merged-screens`, `lovejoin-session5-screens`, `screens`, `swap-lovejoin-way`, `screens-nits-review-fixes`, `words`: 152 passed.

### Not covered by this fix (for the lead)

- **A return in `roomIn`'s one-box exception.** With 8 or 9 free two waves deep, a swap's approval says `mixed` with its reserve paid, and the box goes while the collateral's mix doesn't. On mainnet that needs 30+ others but 9 or fewer free: 21+ of the pool's boxes reserved by the wallet's other chains at once. Rare.
  - The approval is made long before the return and can't know that room. Its critical note's "If that mix can't go" covers it loosely. Low at most.
- **The full unit suite and the e2e** under the prototype: I ran the 27 files above, not all.
- **The rendered Mix form under the prototype**: `mixOffer`'s rule is pinned and `CollateralIfLeft` renders as it does today.
