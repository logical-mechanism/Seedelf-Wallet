# Round 3b's fix-ups: money, state, and where fixes meet (lens `last-money`)

Scope: `git diff 56dce2cd`, the working tree against round 3's commit. Fixers: `fx-reserve-1`, `fx-reserve-2`, `fx-lj-1`, `fx-lj-2`, `fx-misc`, `fx-tests`.

Two findings, both low. No high or medium.

## Findings

### 1. The collateral's mix is promised where the return pays it only from what's left after the boxes (low)

- **Where:** `extension/src/background/sessions.ts:3252` (stopCost's `mixed`); also `extension/src/ui/screens/Swaps.tsx:1303` (SwapApproval's `collateralMixed`).
- **Concerns:** `fx-reserve-1`, L1 (Stop's dialog) and R3-9 (the approval's ADA-out rule).

**The rule.** Without the reserve, WebAssembly counts a return's boxes on all the spare ADA (`tail_reserve(false)` = 0). It builds the collateral's mix only from the change left after them. With no box, the return comes back directly, and the mix needs the direct tail's ADA from UTxOs of ADA alone.

**What the fixes key on:**
- **Stop's dialog** flags `collateralMix` wherever the account holds its 5 ₳, any spare ADA (`spare > 0n`), Settings' switch on, and a pool not "no". Its line, `swaps.review.privacy.collateralMix`, then says "giveme.my backs its collateral's mix too, so it sees that mix…". It shows wherever Stop goes through Lovejoin, and always with no box.
- **The approval** says it for any ADA-out swap funded without the reserve (`collateralPool && adaOut`): the Plan's *Mixed* step, `noBoxMixed` and the giveme.my line.

**Scenario A: L1's own test state.** A swap session funded without the reserve, whose account holds `fund + 1.5 ₳` and its 5 ₳ collateral; preprod's 5 ₳ pool holds two strangers' boxes.
- Stop's dialog: `{ boxes: 2, collateralMix: true }`, so the giveme.my line shows.
- The return `backBuild` then builds: 2 boxes, and no `collateralTail`. The 5 ₳ comes back with the rest.
- L1's test asserts `{ boxes: 2, collateralMix: true }` for this record without building its return, so the test pins the false line.

**Scenario B: no box.** The line shows with no box, whatever the switch says.
- A session funded **with** the reserve whose account holds 1.5 ₳ or 2 ₳ of spare ADA: the dialog says it's mixed, and the direct return builds no tail.
- At 3 ₳ and above it does.
- Unreserved, 2 ₳: the same mismatch.

**Scenario C: the approval's ADA-out rule.** I swept an ADA-out fill, unreserved, across one box's width: 12.45 ₳ to 22.95 ₳ in steps of 0.5 ₳, a box being 10.95 ₳ with 1.5 ₳ besides.
- The return built no collateral's mix in 3 of 22 fills (12.45, 12.95, 13.45 ₳), wherever less than about 1.5 ₳ is left after the boxes.
- That's about one fill in seven below the chain's box cap. The approval says "giveme.my backs its collateral's mix too" for all of them.

**Evidence.** Throwaway `tests/zz-review-last-money-1.test.ts`, real WebAssembly, on L1's harness (deleted). Its output:
```
reserved:   {"cost":{"boxes":1,"collateralMix":true},"built":{"boxes":1,"tail":true}}
unreserved: {"cost":{"boxes":2,"collateralMix":true},"built":{"boxes":2,"tail":false}}
AssertionError: Stop's dialog says the collateral is mixed: expected true to be false
```
```
reserved spare 1500000:   {"cost":{"boxes":0,"collateralMix":true},"built":{"tail":false}}
reserved spare 2000000:   {"cost":{"boxes":0,"collateralMix":true},"built":{"tail":false}}
reserved spare 3000000:   {"cost":{"boxes":0,"collateralMix":true},"built":{"tail":true}}
unreserved spare 2000000: {"cost":{"boxes":0,"collateralMix":true},"built":{"tail":false}}
```
```
perBox 10950000 besides 1500000
12.45 ₳: 1 boxes, tail false … 13.45 ₳: 1 boxes, tail false; 13.95 ₳: 1 boxes, tail true …
no collateral mix in 3 of 22 fills across one box's width
```

**Why low.**
- It's the same class as R3-10, which round 3 confirmed low: a line promising a mix the return doesn't build. That direction tells the user more privacy than they get.
- The 5 ₳ comes back in the return, which the dialog and approval already say ties to the session.
- Nothing is lost.
- It's dormant on mainnet until a 5 ₳ pool holds its floor.

**Suggested fix.** No new words and no refusal.
- **In stopCost:** flag `collateralMix` only where the return pays for that mix:
  - a box or more, and either the reserve was paid (`s.collateralReserve`, set aside first, as now) or what's left after the priced boxes (the spare less `besides + boxes × perBox`) covers `lovejoinCollateralReserve()`;
  - no box, and the spare of ADA alone covers `lovejoinDirectCollateralReserve(params)`.
  - `priced()`'s `at()` already works out `one` and `perBox`; returning them, or the leftover, is enough.
- **In outBuild:** apply the same leftover test to the expected fill, `proceeds + deposits + SWAP_MARGIN` less the boxes it pays for (lovejoinCost works out both), before setting `collateralPool` for a funding without the reserve. The approval's words then follow one rule.
- **In L1's test:** assert the unreserved case against what `backBuild` builds.

### 2. Max empties the swap's amount where the collateral's reserve takes Max to zero (low)

- **Where:** `extension/src/ui/swap.ts:147` (followMax); `extension/src/ui/screens/Swaps.tsx:770` (the follow effect).
- **Concerns:** `fx-reserve-1`, R3-12. R3-11 makes it common on preprod, where the quote's "maybe" is the usual state until a review reads the pools.

**Scenario.** A private balance of 14 to 15 ₳, ADA to MIN, preprod's 5 ₳ pool shown, nothing read of it lately.
1. Max before any quote gives 1 ₳ (14 ₳ held) or 2 ₳ (15 ₳ held).
2. The quote for that amount names the reserve as a maybe, so Max becomes 0.
3. `followMax` returns `"0"`, and the effect sets the amount to `""`.

**What the user sees:**
- They pressed Max and the field went empty.
- Max's button turns off (`max === "0"`), and no note says why: the Max note needs `max !== "0"`.

**What the worker does with that amount:** it funds the 1 ₳ or 2 ₳ swap, without the reserve (orWithoutReserve). Before R3-12, the amount stayed and was funded.

At 16 ₳, Max follows 3 ₳ down to 1 ₳ on the same maybe. That's the documented private default (fx-reserve-1's call 5), not this finding.

**Evidence.** The same throwaway, real worker and WebAssembly:
```
held 14000000: first Max 1000000, quote reserve 1500000 (maybe), Max after 0, follows to "0"; funds 1000000 (reserve none)
held 15000000: first Max 2000000, quote reserve 1500000 (maybe), Max after 0, follows to "0"; funds 2000000 (reserve none)
held 16000000: first Max 3000000, quote reserve 1500000 (maybe), Max after 1000000, follows to "1000000"; funds 3000000 (reserve none)
```
`parseQuantity("")` is undefined (format.ts:150), so the empty field is stable. Typing an amount still works.

**Why low.** An edge of small balances. Nothing is lost or refused, and typing recovers.

**Suggested fix.** In `followMax`, never follow down to nothing: add `BigInt(max) > 0n`. The amount Max set then stays where Max can't keep the reserve aside, and goes without it, as one typed past Max does. No new words.

## Checked, and holding

**R3-8, orWithoutReserve on TOO_MANY / TOO_LARGE:**
- The two regexes match build.rs:169, :173 and :517 to the word.
- In-parts fundings (outBuild, siteOutBuild, a new mix) split inside `buildWithdrawParts`, so they only take an extra build on an escaped error.
- outBuild's order holds: without the reserve, then without the token's boxes.
- mixFunding's Bootstrap catch is inside the build callback, with reserve 0, so its words are unchanged.

**R3-10, tailUnpaid:** lovejoinCost gives a token-out swap `spare = SWAP_MARGIN`, so `l.boxes` is 0 there. The rule reduces to "no token box". The retry without token boxes re-decides `asked(lovejoin)`, and the returned `collateralPool` uses the final `lovejoin`.

**L1, the reserved case:**
- WebAssembly's `tail_reserve(funded)` sets the reserve aside only where funded, and buildBack passes `collateralReserve` only with `intoPool`. stopCost's `aside` agrees with both.
- `priced()` refreshes `roomsRead` through `room()` before `collateralPoolTakes` reads it.
- An unfilled order prices on `approved.fund`, which excludes the reserve. That matches the cancel's return.

**R3-4, refuseParts:**
- `fundingChange` already leaves out reservations with `until === undefined` (reservedSet `sending: true`), parts included, so the runner's fresh returns never meet the new check.
- claimSubmit lists a refusal under `failed`.
- backSubmit keeps the review, and a new one leaves the UTxO out.

**R3-5, holdable:**
- holderOf's first branch ignores `mine`, but both callers ask it only for a box in `bootstrapOf`, so a counted box gets no holder.
- countBack never credits an unreleased Bootstrap for a free box, so the stranger-moved variant counts once.

**R3-6, mayLand:**
- `c.tail.landed` is defined whenever tailWaits holds.
- A resumed tail carries an old `landed`, so it adds no hold.
- The 15-minute stop of a box's own run is fx-lj-1's call 4.

**The lock-cut tail:**
- tailBoxes' `last` is tailOf's `.at(-1)`, and `tailBuildable` is tailOf's old test (M26).
- chainsMixing runs `cuts()` before bringAllBackNow reads the schedule, so an unmarked cut chain blocks as "chain" rather than losing its box.

**L2, the Stop mark:**
- A new ask deletes the mark, so an old one can't speak for a later run.
- A failed Stop request never sets `halted`.
- The mark keeps the schedule record from emptying, but no rule reads the record's existence; the unlock reads `open` from due times, chains and notMixed.

**L3, traps:**
- None of withdrawOne's post-submit steps (`stale`, `activity.sent`, `dropWithdrawing`) calls WebAssembly: the sealed store is WebCrypto. So the rethrow, and the `b.back += 1` it would skip in bringAllBackNow, aren't reachable in the worker.
- settleWithdrawing's onChain always passes a feed, so it never reaches watchOf.

**L4, clocks:** sw.ts wires every service's `now` to `Date.now`, so the split clocks are a test concern only.

**Pay it again anyway:**
- `pay()` runs settleMaybeSent first.
- Both payments' inputs are marked spent while heldSent holds the first, so the second spends other UTxOs.
- Home's `blocked` (10 minutes) and `late` (10 minutes) line up.
- If both land, the first 5 ₳ is an ordinary UTxO, not the `collateral`-flagged one.

**The payer order and the hatch (R3-2, R3-3):** an order only. A session's box gives no account. The hatch's rank (1 + account) and `hatchAccountOf`'s `Math.min` agree.

**Backward compatibility:**
- `bringStopped`, `PendingTx.boxes`, `CollateralStatus.late`, `SwapQuote.collateralMaybe`, `SwapLovejoin.collateralMix` and `SessionOutSummary.collateralPool` are additive.
- `bringStopped` is read back validated.
- None is persisted where 1.5.0 reads.

## Questions (not made concrete)

1. **Since L3, a trap in watchOf's pool read during a chain's pump** (sessions.ts pump's `onChain`; pumpPublic's) lands in their catch-all. That catch records the trap's raw message as why the chain stopped (`s.chain.stopped = why`, `sending.stopped = e.message`), and pages show it.
   - 314-wasm#0 kept traps out of the bring run's reason, not a chain's.
   - The same already held for a trap in sendStep.
   - A lock clears session storage and cuts the chain anyway, so only the words differ.
   - Reaching it needs a first trap inside `lovejoinVerifyPool` mid-chain: unlikely. Should the catches word a trap as a cut?
2. **The quote's `tailUnpaid` uses `lovejoinCost` without the pool read**, so a token pool shown but full at Review keeps 1.5 ₳ out of Max that the approval then doesn't fund. That's R3-11's class, by another door. Owner's call?

## Checks run

- **Round 3b's 14 test files:** 201 of 201.
- **`tsc --noEmit -p .`:** clean, bar another lens's throwaway (`zz-review-last-words-2`).
- **The wide set** (122 files: session*, lovejoin*, swap*, collateral*, parts*, return*, site*, chain*, withdraw*, pending*, coin-control*, approvals*, dapp*, run*, spent*, screens*, home*, settings*, activity*): 120 files ran, 1550 passed and 2 skipped, on the default build.
- **The throwaway**, `zz-review-last-money-1.test.ts`, is deleted. Nothing tracked was edited.
