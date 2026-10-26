# fx-last's fix-ups, reviewed (lens `last-3c`)

Scope: `git diff 3ea05dc1` outside `WW/docs/`, fixer `fx-last` (LM-1, LM-2, LW-1, LW-2, LW-4). The docs fixers' edits (`seedelf-data/README.md`, `seedelf-platform/CLAUDE.md`, `extension/README.md`, `WW/docs/` bar the two provenance files) are theirs and not reviewed.

**Verdict:** no high or medium. Four low, one nit. LM-2, LW-2 and LW-4 do what they say. LM-1's rule is right wherever the account already holds what the return spends. It still promises the collateral's mix where fees, or a cancel, take the ADA it counts on, and its safe side is much wider at Settings' default depth than fx-last's call 1 says.

Every finding was made concrete with a throwaway test against the real WebAssembly (`tests/zz-review-3c-{1..5}.test.ts`, all deleted). Nothing tracked was edited.

## The real thresholds

What `tailPaid` compares with 1.5 ₳ is `left` = spare − `besides` − boxes × `perBox`. The `left` at which `backBuild` really builds the collateral's tail, measured by bisection on L1's harness (preprod, the classic pool, the 5 ₳ pool with two strangers' boxes):

| chain | the tail is built from `left` = | rule | slack |
|---|---|---|---|
| depth 1, 3 wide, one box | 1.205–1.209 ₳ | 1.5 ₳ | 0.29 ₳ |
| depth 1, 3 wide, two boxes | 1.083–1.088 ₳ | 1.5 ₳ | 0.42 ₳ |
| depth 1, 4 wide, one box | 1.195–1.203 ₳ | 1.5 ₳ | 0.30 ₳ |
| **depth 2 (Settings' default), 3 wide, one box** | 0.820–0.828 ₳ | 1.5 ₳ | 0.68 ₳ |
| depth 2, 4 wide, one box | 0.648–0.656 ₳ | 1.5 ₳ | 0.85 ₳ |
| no box (direct), ADA alone | 2.660–2.664 ₳ | 2.8 ₳ (`lovejoinDirectCollateralReserve`, real export, preprod's parameters) | 0.14 ₳ |

So on its own inputs the rule never says a mix the chain doesn't build, at any depth or width tried. The findings below are where its inputs aren't what the return will hold.

## Findings

### 1. low: Stop promises the 5 ₳ is mixed for a token→ADA swap whose order is out, and its cancel leaves nothing to pay for that mix

- **Where:** `extension/src/background/sessions.ts:3300` (stopCost's `mixed`, no-box branch); the words at `extension/src/ui/screens/Swaps.tsx:2886` and `:2908`.
- **Concerns:** fx-last, LM-1 (incomplete) and LW-1 (its words). The flag dates from fx-reserve-1's L1.
- **Scenario:** default settings. A MIN→ADA swap routed as an order, funded with the collateral's reserve (the default where the private balance pays it). The order is out and hasn't filled, say the price moved. The user presses Stop.
  - The order's change is at the account: the margin less the order's fee, beside the 1.5 ₳ reserve, ADA alone (≈ 3.34 ₳). So `ada` ≥ 2.8 ₳ and `collateralMix` is set.
  - The dialog says: "The order is cancelled, unless it fills first, and everything but its 5 ₳ collateral comes back to your private balance, less network fees; the 5 ₳ comes back later, mixed once. giveme.my backs its collateral's mix, so it sees that mix. …"
  - **The cancel** (`orders.rs` cancel_orders) spends the order and every UTxO of ADA alone but the collateral (`funds`, :805), and `change_outputs` puts the token and all the lovelace in one output (:906–916).
  - **The return then:** no box, so it comes back directly. `direct_tail` finds no payer of ADA alone (`lovejoin.rs:352`, its `payers` filter) and `session_return`'s `.ok()` (`lib.rs:1419`) builds none. The 5 ₳ comes back at once, with the rest.
- **Evidence:** `zz-review-3c-2`, test 1. Setup:
  - the account with the order out holds 2 ₳ − 0.155381 ₳ (the least fee any transaction pays) + 1.5 ₳, and its 5 ₳;
  - after the cancel it holds 500 MIN + 4 ₳ + that − 0.237697 ₳ (a real Minswap cancel's fee, seedelf-core `cancel_integrity.json`) in one UTxO, and its 5 ₳.

  Output:
  ```
  stopCost with the order out: {"boxes":0,"mixes":0,"mixFees":"0","withdrawFees":"0","depth":1,"delay":"1-6","on":true,"collateralMix":true}
  dialog: Stop this swap? The order is cancelled, unless it fills first, and everything but its 5 ₳ collateral comes back to your private balance, less network fees; the 5 ₳ comes back later, mixed once. giveme.my backs its collateral's mix, so it sees that mix. If that mix can't go, its 5 ₳ box waits unmixed, tied to this session. Keep going Stop the swap
  return after the cancel: {"tail":null,"lovelace":"11933017","chain":0,"skipped":"its spare ADA is too little for a box"}
  AssertionError: Stop's dialog says the collateral is mixed: expected true to be false
  ```
- **Why low:** LM-1's class, which last-money rated low. The dialog promises more privacy than the return gives, nothing is lost, and it's dormant on mainnet until a 5 ₳ pool holds its floor. But this is Settings' default and a common reason to press Stop, and LW-1's note now says outright that the 5 ₳ "comes back later, mixed once".
- **Suggested fix:** no new words, no refusal.
  - **In stopCost's no-box branch,** count what the return will hold of ADA alone. For a token-in swap with its order out and not filled, that's none, since the cancel's change carries the token and every UTxO of ADA alone. The dialog then shows the `*Direct` note and no giveme.my line. If the order fills first, the return mixes the 5 ₳ anyway: the side call 1 already accepts.
  - **More private, but needs Rust and a pkg rebuild:** have the cancel give the token back at its least ADA and the rest as a UTxO of ADA alone. The direct tail can then pay, and the promise holds.

### 2. low: at Settings' default depth, call 1's band is 0.82–1.5 ₳, and in it Stop and the approval drop the giveme.my line while giveme.my backs the mix

- **Where:** `extension/src/background/sessions.ts:4613` (tailPaid's 1.5 ₳ test), read by stopCost (:3300) and outBuild (:1928).
- **Concerns:** fx-last, LM-1, its call 1 ("about 1.0–1.5 ₳ left after the boxes").
- **Scenario:** depth 2, three wide (the defaults), one box, no reserve, 0.9 ₳ left after the box.
  - **Stop's dialog** says "Its ADA goes through Lovejoin first: 1 box, …", with no giveme.my line.
  - **The return** mixes the collateral under giveme.my's collateral.
  - **The approval:** the same holds for an ADA-out swap funded without the reserve, from about 1.0 ₳ of expected `left` (its order's fee comes off first). It shows no *Mixed* step and no giveme.my line, and "Comes back" counts the 5 ₳ as coming back with the rest. The return mixes it, and the deposit and mix (≈ 1.0 ₳) come out of its change.
- **How wide:** the band is about 0.68 ₳ of every 13.8 ₳ box (0.85 ₳ of 16.75 ₳ four wide), against the "about 1.0–1.5 ₳" the call states.
- **What changed:** before LM-1 the dialog was wrong below the threshold (it promised a mix it didn't build). Now it's wrong above it, in the other direction. What's lost there is the disclosure x-privacy#1 and L1 added: that giveme.my sees that mix.
- **Evidence:** `zz-review-3c-4` (depth 2), at 0.9 ₳ left:
  ```
  d2 w3: … at 0.9: {"said":false,"built":true,"costBoxes":1,"boxes":1,"width":3,"costWidth":3}
  d2 w3: T_chain between 820312 and 828125
  d2 w4: … at 0.9: {"said":false,"built":true,"costBoxes":1,"boxes":1,"width":4,"costWidth":4}
  d2 w4: T_chain between 648437 and 656250
  ```
- **Why low:** a missing warning, not a wrong one, and the privacy policy's general giveme.my line still covers it. The owner decides call 1, so give it these numbers.
- **Suggested fix:** no refusal. Either:
  - **a middle state.** Between the lowest measured threshold and 1.5 ₳, say the 5 ₳ "is mixed only if enough is left when it comes back", one line, with the giveme.my line. That's the Mix form's `lovejoin.mix.privacy.collateralIfLeft` pattern.
  - **or price the chain's change as WebAssembly does.** The funding estimate's per-mix surplus and the deposit's reserve make up the slack. A WebAssembly export that answers whether `CollateralTail` fits a change would remove the band.

### 3. low: the approval says an ADA-out swap against the pools mixes its collateral where the swap's own fee leaves too little

- **Where:** `extension/src/background/sessions.ts:1621` (lovejoinPriced's `spare = proceeds + SWAP_MARGIN`), `:1654` (`left`), `:1928` (outBuild's `mixes`).
- **Concerns:** fx-last, LM-1 (the approval half).
- **Scenario:** depth 1 (a Settings choice).
  - A MIN→ADA swap routed against Danogo's pools, the private balance paying the swap but not the reserve.
  - The quote's fill leaves 1.6 ₳ after one box, so `collateralPool` is set. The approval (`collateralReserve || (collateralPool && adaOut)`) shows the *Mixed* step and "giveme.my backs its collateral's mix too…".
  - The swap's network fee comes out of the margin first. It's 0.48–0.92 ₳ against the pools (swap.ts:28–34; swapCosts: "The later ones come out of the room for network fees (SWAP_MARGIN)"). That's more than depth 1's 0.29 ₳ of slack.
  - **The return:** one box, no tail.
  - **At the default depth 2** the slack is 0.68 ₳: only the dearest sample, 0.92 ₳, passes it.
  - **An order** (0.155 ₳ of fee at least) stays inside depth 1's slack, unless its fill comes in more than about 0.14 ₳ under the quote.
- **Evidence:** `zz-review-3c-3`. outBuild on the Danogo estimate (no deposit, 0.1 ₳ DEX fee, 0.85 ₳ Minswap fee). Then backBuild on the account that fill leaves: the proceeds as quoted and the margin less the swap's fee, ADA alone, and the 5 ₳.
  ```
  fee 480000: againstPools true, approval {"reserve":null,"pool":true,"boxes":1}, return {"boxes":1,"tail":false}
  fee 640000: againstPools true, approval {"reserve":null,"pool":true,"boxes":1}, return {"boxes":1,"tail":false}
  ```
- **Why low:** the same over-promise class as LM-1, in a band of fills about 0.2–0.6 ₳ wide per box, at a non-default depth.
- **Suggested fix:** in outBuild, take the swap's own fee off the margin before `tailPaid`: POOL_SWAP_FEE_ESTIMATE against the pools, SESSION_FEE_ESTIMATE for an order. Price the fill at `minAmountOut`, the least it brings. That's the safe side, as call 1 has it.

### 4. low: Stop with an ADA→token order out prices its collateral's mix on the whole funding, leaving out the order's and the cancel's fees

- **Where:** `extension/src/background/sessions.ts:3296` (`counted = held > funded ? held : funded`), `:3302` (`left(counted)`).
- **Concerns:** fx-last, LM-1 (the Stop half).
- **Scenario:** depth 1. An ADA→MIN swap funded without the reserve, its order out and not filled.
  - **The dialog** prices on `funded`, the whole approved funding.
  - **What the cancel brings back** is that less the order's fee, the cancel's fee and Minswap's: at least 0.155 + 0.238 ₳. That's more than depth 1's 0.29 ₳ of slack at one box.
  - **So** at `left(funded)` 1.55 ₳ the dialog says the collateral is mixed, and the return after the cancel builds none.
  - **At depth 2** the 0.68 ₳ of slack covers these fees.
- **Evidence:** `zz-review-3c-2`, test 2. The account with the order out holds 2 ₳ − 0.155381 ₳ and its 5 ₳; after the cancel, F − 0.155381 − 0.237697 ₳ of ADA alone.
  ```
  left(funded) = 1550000: dialog {"boxes":1,"mix":true}, return {"boxes":1,"tail":false}
  left(funded) = 1600000: dialog {"boxes":1,"mix":true}, return {"boxes":1,"tail":true}
  ```
- **Why low:** a band about 0.1 ₳ wide (0.15 ₳ with a typical order fee) per box, at a non-default depth.
- **Suggested fix:** price an order that's out as what its cancel brings back: `held + funded − SWAP_MARGIN − aggregatorFee −` a cancel-fee estimate. Or take two SESSION_FEE_ESTIMATEs off `left(funded)`. No new words.

### 5. nit: after LW-1's *Mixed* note, the pool-short line's "it" reads as the 5 ₳

- **Where:** `extension/src/i18n/translations/en.json:2516` (`swaps.stop.poolShort`), shown at `Swaps.tsx:2898`.
- **Concerns:** fx-last, LW-1 (its call 6).
- **Evidence:** `zz-review-3c-5`, placed, Lovejoin's pool short, `collateralMix`:
  > Stop this swap? The order is cancelled, unless it fills first, and everything but its 5 ₳ collateral comes back to your private balance, less network fees; the 5 ₳ comes back later, mixed once. Right now Lovejoin's pool holds 12 boxes that aren't yours, under the 30 it needs, so it would come back directly, tied to this session on chain. giveme.my backs …

  Before LW-1, "it" followed "everything". Now the nearest antecedent is "the 5 ₳", which the sentence before said is mixed.
- **Suggested fix:** "{{why}}, so its ADA would come back directly, tied to this session on chain." That's one word. The key shows only with `skipped`, which is always the no-box case. The es and ja drafts follow.

## Checked, and holding

**LM-2:**
- `followMax` never follows to nothing.
- **The kept amount reviews:** it's neither `tooMuch` (against what's held) nor `short` (`adaShort` leaves the reserve out), so Review is live.
- The worker funds it without the reserve (`orWithoutReserve`).
- Max's button is off and its note hidden (call 8).
- The follow-down only goes down, so it still converges.

**LW-2:**
- PendingBanner renders only on Home, inside the PreferencesProvider.
- The context's default (`loaded: false`) reads as hidden, so the count is plural until the preferences are read.
- In a copy, dropping `hidden` fails the new test.

**LW-4:**
- `shownSide` is the pick at `most || 1`.
- `side`, count by count, still feeds only `mixOffer`. `mixable` doesn't depend on the count.
- `cantAffordPublic` is at one box, and the Bootstrap form is unchanged.

**LW-1's logic:**
- `mixedBack` holds only with no box.
- A box with the switch off goes directly, with the `*Direct` note and no giveme.my line.
- "Comes back later, mixed once" is `lovejoin.review.privateNoteMixed`'s wording.

**LM-1 where the account holds what the return spends** (filled, or not placed):
- it never over-promises at depth 1–2, three or four wide (the table above);
- the reserved short-circuit always builds, since the chain sets the reserve aside first;
- in a copy, setting `mixed` back to `intoPool` fails three tests (L1's and both LM-1 Stop tests).

**ADA→token without the reserve:**
- It's never flagged now.
- The approval's rule ignores the flag for it, so nothing shown changes (calls 3, 4).
- With Lovejoin unavailable, or the switch off, `asked` is 0, so there's no flag.

**Unchanged neighbours:**
- **The site paths** (FundingWayBack, TopUpCollateralNote) are unchanged.
- **The 1.5.0 gate:** stopCost reads `epoch_params` only with no box and the collateral going in. The gate's Stop has no box in its 5 ₳ pool, so it makes no new read, and the gate passes.

**Strings:**
- The derived critical set differs from the checked-in list by exactly `swaps.stop.privacy.collateralMix` (`--write` and round 4 pending).
- The four new keys are in en, es and ja, with provenance.

**Backward compatibility:** no record shape changed, and nothing new is persisted.

## Questions (not made concrete)

1. By the same `max(held, funded)` count (finding 4), at a box's edge an unfilled order's Stop dialog may name a box more than its return makes, which L1 promised it wouldn't. That's pre-existing, and not tested here.
2. The site paths still say mixed wherever a pool takes the collateral without the reserve. The swap's approval now follows "the return pays". Should a site's words get finding 2's middle state too? That's the owner's call.

## Checks run

- **fx-last's four test files:** 78 of 78.
- **The neighbouring set**, 114 files (approvals\*, chain\*, collateral\*, dapp\*, direct-swaps, home\*, lovejoin\*, minswap\*, pending\*, pool-swap\*, return\*, screens\*, session\*, sessions\*, site\*, swap\*, withdraw\*): 1425 passed, 2 skipped.
- **i18n, words, i18n-critical-helpers, i18n-worker-reasons, privacy-notes:** 127 of 130. The 3 failures are the known critical-set gates (`--write`, L5).
- **`tsc --noEmit -p .`:** clean, run after the throwaways were deleted.
- **Mutations in a copy** (`scratchpad/copy-3c`, deleted): stopCost's `mixed` and PendingBanner's `hidden`.
- **Throwaways `zz-review-3c-1..5`:** deleted. Nothing tracked was edited. No build, no Playwright, no cargo.
