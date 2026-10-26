# Review of the fixes: money and state

Lens: follow the money through every flow the two fix rounds changed. That's the private Bootstrap and its older records, the collateral's mix reserve, the Mix and swap forms, the approvals' totals, payments in parts, Max in parts and Bring every box back now. For each I checked that the sums add up, that no record ends where money waits for good or no button moves it, and that nothing pays twice, refunds wrongly or leaves a reservation stuck.

**Verdict: no high or medium finding.**
- **Three lows.** Two fixes are incomplete (w-left's sendChain check, reserve's fallback). One set of round-2 words promises a collateral's mix that a swap against the pools can't build.
- **One nit.**
- Each low was proved with a throwaway Vitest test that failed on the tree. All four are deleted.
- Everything else I followed holds, listed under Checks.

## Findings

### 1. low: a direct return reviewed before a payment's Send still takes what a waiting part spends; only a chain is refused

- **File:** `WW/extension/src/background/sessions.ts:4663` (sendBack's direct path, `sendRecorded`). The check w-left added is at `sessions.ts:4741-4751`, in sendChain alone.
- **Concerns:** w-left, 321-parts-worker#3's second half. The finding says: "A Bring it back reviewed before the payment went gives the same result". That covers a return that comes back directly as much as a chain.
- **Scenario:**
  1. Session 0's funding change F is a token bundle.
  2. The user reviews Bring it back. It comes back directly (Lovejoin off, the spare pays no box, or the review's switch), and merges into F.
  3. In another window, the user reviews and sends Max in parts. F is in its second part, which waits for the first, so F is now reserved (`parts.<first>`).
  4. The return's Send goes: nothing checks the parts' reservation. fundingChange left reserved UTxOs out only at build time, before the reservation existed.
  5. When the first part lands, the pump's `send()` refuses the second as spent since (refuseSpentSince), and `stopWaiting("refused")` runs.
  6. The payment ends partly sent: the recipient gets part 1 only, and Home says "only partly sent".
  - For a chain, w-left's check now refuses the same return whole, in `worker.spend.partsConflict.return`, and a review built again leaves F out.
- **Evidence:** a throwaway test (zz-review-money-state-1), built on w-left's "refuses, sending none of it, a return through Lovejoin…" with `backBuild("preprod", 0, true)`. It printed:
  - `direct return merged: 1`;
  - `direct return spends F: true`;
  - `direct return's Send refused: NO, it went`;
  - `order: [ 'part1', 'return', 'part2' ]`.
  - It failed with `AssertionError: a direct return reviewed before the payment's Send, merging into what a waiting part spends, went: expected undefined to be defined`.
  - In the test, part 2 was even submitted: rememberSpent stamps `Date.now()` while the test clock runs ahead, the clock gap L4 notes. In the worker the two clocks agree, and refuseSpentSince stops part 2 as above.
- **Fix:** run the same parts-reservation check in sendBack before `sendRecorded`, for every return kind (Bring it back, Bring everything back's SESSION_CLAIM), with the same words. Better, move w-left's check into one helper that both paths call. Nothing is sent and no record is touched before it, as in sendChain. Add the direct case to w-left's test.

### 2. low: orWithoutReserve falls back only on NotEnoughPrivate, so a one-transaction funding the reserve takes past one transaction's computation is refused

- **File:** `WW/extension/src/background/sessions.ts:4502` (`if (!reserve || !(e instanceof NotEnoughPrivate)) throw e;`).
  - topUpBuild builds with `{ inParts: false }` (`sessions.ts:2147`).
  - Mix my boxes again does too (`inParts: !mix.again && !mix.bootstrap`, `sessions.ts:2055`).
- **Concerns:** reserve, 323-worker#0 ("nothing falls back without it"). The helper's own doc says the reserve is "never what refuses a funding". 323-rust#1 makes it bite more: a top-up's reserve is now the direct 2.8 ₳.
- **Scenario:**
  1. A site's session has no collateral left, so its top-up pays a new 5 ₳ and the direct reserve. A 5 ₳ pool is shown and Settings has the collateral go in.
  2. The private balance is spread over many small UTxOs. That's common after boxes come back, one UTxO each.
  3. A top-up of 6 ₳ with the 2.8 ₳ reserve needs 23 inputs, and WebAssembly refuses it with a computation error.
  4. orWithoutReserve rethrows it, so the user sees "Spending 23 UTxOs at once needs more computation than a transaction may use". Without the reserve, the same top-up builds with 20 inputs.
  5. The form never showed the reserve, so the user can't tell why. Mixing again from the private balance has the same shape with the 1.5 ₳ reserve.
  - Too large a transaction (`TooLarge`) falls in the same gap.
  - Nothing is sent and nothing is lost: it's a refusal of a funding the chain would take without the wallet's own extra.
- **Evidence:** a throwaway test (zz-review-money-state-4), with collateral-reserve-review-fixes' harness (DIRECT stubbed at 2.8 ₳), a private balance of 40 UTxOs of 0.7 ₳, and `topUpBuild("preprod", 0, "6000000", [])`. It printed:
  ```
  6 ₳: with 5 ₳ pool -> refused: Spending 23 UTxOs at once needs more computation than a transaction may use | no pool -> ok(reserve=none, inputs=20)
  ```
  It failed with `AssertionError: a top-up refused with the reserve that goes without it`.
- **Fix:** in orWithoutReserve, also build without the reserve when the error is one transaction's computation or size limit: `TOO_MANY.test(message)`, or a typed TooMany/TooLarge if the worker gets one. A Bootstrap's own `sess.bootstrapTooMany` never reaches it, since its asked reserve is 0. It isn't a guard either way: the fallback only adds a build the ledger takes.

### 3. low: a swap against the pools is charged the collateral's mix reserve, and its approval promises that mix, though a direct return can't build it

- **Files:**
  - `WW/extension/src/ui/screens/Swaps.tsx:1285` (`collateralMixed = !!summary.collateralReserve` feeds the cost row, the Plan's `*Mixed` step, `swaps.review.noBoxMixed` and `swaps.review.privacy.collateralMix`);
  - `WW/extension/src/background/sessions.ts:1786` (outBuild takes the reserve whatever `quote.againstPools` says);
  - `WW/wasm/src/lovejoin.rs:369` (direct_tail pays only from UTxOs of ADA alone).
- **Concerns:** sc-o-1 (323-worker#1, 323-worker#6, x-privacy#1), over reserve's open call 6, which isn't among the brief's leftovers.
- **Scenario:**
  1. A 5 ₳ pool is shown (preprod today), with Settings' collateral switch on.
  2. The user swaps ADA for a token that has no Lovejoin pool, or that they set to come back directly. Minswap routes it against Danogo's pools.
  3. The funding pays the swap, its costs, the 1.5 ₳ reserve and the 5 ₳ collateral.
  4. The pool swap pays the session one output: the token, plus all the ADA left over, the reserve included. That's pool-swap-landing.test.ts's own model of Minswap's build: "output 2: the change, and the MIN bought".
  5. At the return, the spare pays no box, so it comes back directly. Apart from the collateral, the only ADA is in that token output, so `direct_tail` bails ("Nothing of the session's but its collateral pays for the collateral's mix"). The collateral comes back with the rest, unmixed.
  6. What the approval said, all false here:
     - "Its collateral's mix, about 1.5 ₳" counted in *Costs in all*;
     - *Comes back* 1.5 ₳ lower;
     - the Plan: "The proceeds and the rest directly; its 5 ₳ collateral in a Lovejoin box, later";
     - "Too little spare ADA for a Lovejoin box, so all but its 5 ₳ collateral comes back at once.";
     - "giveme.my backs its collateral's mix too, so it sees that mix."
  - No money is lost: the reserve comes back in the change. The privacy assurance and the cost lines are wrong. An order swap is unaffected: its order transaction's change comes back as ADA alone.
  - The same limit hits a site's session whose dApp leaves the session's ADA beside tokens, where `dappUi.back.privacy.noteLovejoinMixed` and `sites.topUp.collateralMixed` promise the mix too. That one depends on the dApp; the pool swap's is certain.
  - It's dormant on mainnet until a 5 ₳ pool there holds its floor. The brief's "misleading … about privacy" could argue medium; I rate it low for that dormancy and the narrow route.
- **Evidence:** a throwaway test (zz-review-money-state-2), with collateral-reserve-review-fixes' harness. Session 0, a site's, with `collateralReserve: true`, its account holding 3.1 ₳ and the 5 ₳ collateral, a 5 ₳ pool with two strangers' boxes, and `backBuild`:
  - with the 3.1 ₳ as ADA alone, `collateralTail` is built (passed);
  - with the same 3.1 ₳ beside 906 MIN in one UTxO, it printed `withToken=true: lovejoin=null tail=null skipped=its spare ADA is too little for a box` and failed with `AssertionError: the collateral's mix, its funding having paid the reserve (token UTxO): expected undefined to be defined`.
  - The approval's words follow `summary.collateralReserve` alone (Swaps.tsx:1285-1290, 1362, 1380, 1390).
- **Fix:** either one of these.
  - **(a)** Reserve's call 6: let `direct_tail` pay from the ADA of a token UTxO, its tokens going back as the deposit's token change. That's Rust and a rebuild.
  - **(b)** In outBuild, take no reserve for a swap against the pools whose return would come back directly (no token boxes), and so show none of the mix rows.
  - Either way, the approval's mix words should show only where the return can build the mix. (b) is a worker change with no new string.

### 4. nit: a private Bootstrap's review still says "The deposit goes in now, in one transaction"

- **File:** `WW/extension/src/ui/screens/Lovejoin.tsx:172` (reviewHint returns `lovejoin.review.bootstrapNote` on either side).
- **Concerns:** bootstrap's open point 5, which sc-lj-1 left untouched.
- **Scenario:** from the private balance, a Bootstrap is three transactions with three fees: the funding into the one-time account, the deposit, and the sweep back of what's left. Its review now has a *For returning the rest* row for that sweep, and its ⓘ hint says one transaction.
- **Fix:** a private variant of the hint, such as "Funded now; the deposit and the way back of what's left follow by themselves.", or drop "in one transaction" for the private side. It's words only.

## Checks

**The private Bootstrap**
- **The back reserve.**
  - `mixFunding` adds `lovejoinBootstrapReserve()` (1.5 ₳) beside `funding_for`'s depth-0 lovelace (boxes + 1.5 ₳), so the payment is boxes + 3 ₳.
  - It's never left out: the Bootstrap's asked reserve is 0, so `orWithoutReserve(0)` rethrows.
  - It's never in `tailReserved`. The record gets `mix.noCollateral` from `backReserved`.
  - The form's `short` is boxes + 3 ₳ (BOOTSTRAP_RESERVE) + 2 ₳ (FEE_ROOM), which covers the funding's fee and a change's least.
  - `privateBootstrapMost` builds with the same core constant and the review's own parameters.
- **The return.** For a marked record, buildBack takes no collateral, so any 5 ₳ there is a coin, and depositOnly keeps `collateralWanted`/`backCollateral` from offering 5 ₳.
- **Funded before 62162483 (with 5 ₳).** Its collateral is found, so the one-box-fewer rule is skipped (bootstrap's guard test).
- **Funded between 62162483 and the fix (neither collateral nor way back).** The rule fires only when the record is unmarked, has no collateral, and its funding paid less than the boxes' funding plus the reserve. With 0 boxes, `Math.min(plan.boxes, 0 ?? …)` is 0 and the chain returns undefined, so it comes back directly.
  - Throwaway test zz-review-money-state-3 covered the **token pool**, which bootstrap tested only in the classic pool. 2 LJTEST boxes give `out, deposit (1 box), back`, and 1 box gives `out, back`. It passed on both builds.
- **A collateral's mix failing on a chain** is `.ok()` (wasm lovejoin.rs:1772-1789). A session funded without the reserve still goes through its chain, with the collateral back with the rest.

**The collateral's mix reserve**
- **tailReserve.** The direct figure goes to a site's funding and its top-up only; mixes and swaps take 1.5 ₳.
  - `again_funding` includes DEPOSIT_RESERVE, so Mix again's 1.5 ₳ is backed for the sweep after its tail.
  - `direct_tail_reserve`'s sum checks out: deposit + max(mix draft + its change's least, MIX_FEE_ESTIMATE + sweep draft + Seedelf least), which gives 2.8 ₳ at 4,310.
- **The swap's fallback order** is boxes+reserve, then boxes, then reserve, then neither: `funded(lovejoin)`, then outBuild's catch, then `funded(lovejoin')`.
- **Where the fallback went,** the summary and the record carry no `collateralReserve` or `tailReserved`. mixFunding strips the form's `collateralReserve`/`collateralPool` from `mix`.

**The forms and totals**
- **The Mix form.**
  - `mixCosts` keeps `leaving = cost + later + tailBack + soon`.
  - `tailFees` (COLLATERAL_MIX_COST, 1.5 ₳) and `tailBack` (5 − 0.3 ₳) don't double-count the box's way back.
  - FEE_ROOM 2 ₳ covers a fee (≈0.25 ₳) and a change's least (1.46 ₳, or 1.65 ₳ with a token).
  - `boxesAffordable`'s aside is 5 ₳ + tail + 2 ₳.
  - tailReserveOf mirrors collateralPool's floor, free ≥ 2 and unusable checks. A public mix counts no tail.
- **The swap form.**
  - `maxAdaIn = held − costs − collateral − reserve − FEE_ROOM`, so Max's funding leaves change ≥ 1.75 ₳ less the fee, plus the rounding.
  - The form refuses only `raw > held` (`tooMuch`), never past Max, so no new refusal.
  - `adaShort` leaves the reserve out, which matches the fallback.
- **The approvals.**
  - The swap's: the reserve is in `paid` and COLLATERAL_MIX_COST in `cost`, so *Comes back* matches a funding without the reserve.
  - The site's: both ways adds 1.5 ₳, and TotalRows' leaving includes the 2.8 ₳.

**Payments in parts**
- **laterParts** reads Send's own copies, which splitParts keeps until holdWaiting removes them.
- **A refusal of a later part** comes before anything goes. Both sendParts' and sendFunding's catches call `unsplit`, so no parts reservation is left stuck.
- **How far the payment went.** `parts: {sent, total}` is passed by sendParts, step and sendFunding on the last part with more to go. holdWaiting's `nameParts` is then a no-op, or seals a funding's.
- **`pending-tx`'s "locked" rule** fires only for a watch carrying `parts` whose record is gone.
- **sendChain's new refusal** comes before the record write and `lovejoin.reserve`, so nothing is left reserved. It counts only `parts.*` reservations being sent (they have no `until`).
- **pumpHolds** covers goNow = 1. With goNow ≥ 2, a first part Koios didn't answer stops the rest (unsplit) before the pump holds them, so its case can't arise.

**Max in parts**
- `left_why` is set on the last part only. `Limit` means 25 parts. `Fee` means no chain went. `Tokens` covers everything else, including fitting's overflow after a chain: max_chained returns Ok only when its last part takes everything, and bails at the cap.
- The empty Max refusal can't be reached from the worker, which refuses an empty set first (transfer.ts:104, withdraw.ts:99).

**Bring every box back now**
- **`counted`.** It's written at the withdraw's submit (`gone`). A retake skips countBack and takes no due time, and `back` doesn't grow for this run's own retake. It's pruned once a read of its pool doesn't list the box.
- **`recheck`** is set by Stop, and by the stop after three failed runs, only when `back > 0`. It keeps `returning()` true, and the read in withdrawDueNow clears it.
- **The waits.**
  - The landing wait lasts LANDING_MS at most. It also holds a box's own run's trim and send, through `sending`.
  - The collateral wait is bounded by the tail's day.
  - `late` comes only with `confirming`.
  - Stop shows in every wait and once late.
  - `bringSays` seals nothing when nothing changed.
- No state I found waits for good. Each wait is bounded by LANDING_MS, the tail's day or SPENT_KEEP_MS, or ends at three failed runs.

**Elsewhere**
- **The restore scan.** Its NOT_CAUGHT_UP rule needs `utxo_info` to list spent outputs. The data layer's does ("spent or not", seedelf-data README), so mainnet restores don't fail on it.
- **The collateral's "waiting"** is bounded by `heldSent`, two hours at most, and is recorded on the account it was built on.

**Runs**
- I read every hunk in this lens: `git diff 499768f6` for sessions.ts, lovejoin.ts, parts.ts, script-spend.ts, pending.ts, coin-control.ts, swap.ts, Swaps.tsx, DappApprovals.tsx, Lovejoin.tsx, BringAllBack.tsx, Collateral.tsx, Home.tsx, and wasm lib.rs and lovejoin.rs.
- `npx vitest run tests/collateral-reserve-review-fixes.test.ts tests/lovejoin-form-review-fixes.test.ts tests/swap-form.test.ts tests/approvals-review-fixes.test.ts`: 55 passed.
- The four throwaway tests: 1, 2 and 4 failed as described, and 3 passed (default build, and 3 also with `VITE_ENABLE_MAINNET=false`). All are deleted. I made no mutation copy. No tracked file was touched.

## Questions

- `tailReserve` wraps `collateralPool(...)` in `.catch(() => undefined)` (sessions.ts:4485). That swallows a WebAssembly trap raised while it verifies or measures the 5 ₳ pool, and the funding then goes on building on the broken instance. It's L3's class but not in L3's list. Should it rethrow `isTrap(e)`?
- A Bring every box back now withdraw a node drops leaves its box in the pool, held as spent for two hours, and `counted` holds it. If someone else's mix moves that box meanwhile, the read prunes `counted`. The wallet's new box from that mix then comes back later and is counted against a mix entry again: a double count. I couldn't build it concretely in time. It's the regular flow's own double count (w-left's call 1) by another route, closing a mix entry early in the list.
- Site sessions: `direct_tail` can't pay where the dApp left the session's ADA beside tokens (reserve's call 6). Is charging the 2.8 ₳ direct reserve, and saying the 5 ₳ is mixed once, the intended trade there, or should the site's words hedge as the swap's code comment does ("decided then")?
