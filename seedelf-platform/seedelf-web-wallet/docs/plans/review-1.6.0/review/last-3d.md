# fx-promise's one rule, reviewed (lens `last-3d`)

Scope: `git diff 677715db` outside `WW/docs/`, fixer `fx-promise` (last-3c 1–5). Its code is the whole diff: `sessions.ts`, `rpc.ts`, `LovejoinReturn.tsx`, `Swaps.tsx`, `DappApprovals.tsx`, `SiteSessions.tsx`, `Lovejoin.tsx`, the three locales and five test files.

**Verdict:** no high or medium. Two lows. The rule holds on every screen in every case the task names except two states where the worker never asks the question:
- Stop's dialog while the swap's funding is on its way;
- a Review whose read of the 5 ₳ pool fails.

In both, the giveme.my line is missing where the return mixes the 5 ₳ under giveme.my's collateral. Both gaps date from before fx-promise. Each contradicts its report's claim that "the giveme.my disclosure never drops where the return may mix it". No cost row counts a reserve that wasn't paid. No neighbouring flow broke.

Each finding was made concrete with a throwaway test against the real WebAssembly (`tests/zz-review-3d-{1,2}.test.ts`, both deleted). Nothing tracked was edited.

## Findings

### 1. low: Stop pressed while the funding is on its way says nothing of the collateral's mix, and with no box "everything … less the return's network fee", while the return mixes the 5 ₳

- **Where:** `extension/src/background/sessions.ts:3290–3292` (stopCost's `mayMix`: `!!rows?.some(collateralFits) && (spare > 0n || out)`). The words are at `extension/src/ui/screens/Swaps.tsx:2909` (`notPlacedDirect`).
- **Concerns:** fx-reserve-1's L1, whose gate this is (3ea05dc1; LW-1's words follow it). fx-promise widened the gate for a swap that's out (`|| out`) but not for a funding that's on its way, so its rule (last-3c 2's fix) is incomplete. Pre-existing.
- **Scenario:** an ADA→MIN swap, funded with the collateral's reserve (the default where the private balance pays it), preprod's 5 ₳ pool taking it.
  - The user presses Stop while the page still shows the funding. `stoppable` offers it at step `funding`.
  - The account's last reading holds nothing yet, so `rows?.some(collateralFits)` is false. `collateralMix` is then unset, whatever was paid.
  - **No box (8 ₳ funded):** the dialog says "If no order has gone out yet, none will, and everything comes back to your private balance, less the return's network fee." It has no giveme.my line. That is the over-promise LW-1 removed.
  - **Two boxes (30 ₳):** the dialog gives the boxes' words and no giveme.my line.
  - **Once the funding lands,** Stop's own return builds the collateral's tail: giveme.my backs that mix, and the 5 ₳ comes later, its deposit and mix paid from the reserve.
  - The same funding, read once it has landed, says `mixed` and the definite line.
- **Evidence:** `zz-review-3d-1`. The record is unconfirmed (`txs: [{ kind: "out" }]`), with `collateralReserve: true` and nothing at the account. Then the real `sessions.stop`, the funding landing (`fund + 1.5 ₳`, and the 5 ₳), and `backBuild`:
  ```
  {"fund":"8000000","step":"funding","stage":"funding","before":{"boxes":0,…,"on":true},"after":{"boxes":0,…,"collateralMix":"mixed"},"backTail":true,"backBoxes":0}
  dialog before it lands: Stop this swap? If no order has gone out yet, none will, and everything comes back to your private balance, less the return's network fee. If one is being placed right now, it's cancelled unless it fills first. Keep going Stop the swap
  {"fund":"30000000","step":"funding",…,"before":{"boxes":2,…},"after":{"boxes":2,…,"collateralMix":"mixed"},"backTail":true,"backBoxes":2}
  {"cost":{"boxes":0,…},"stoppedStep":"funding","stopping":true,"afterStage":"open","tail":true}   (the real Stop, then the funding lands)
  AssertionError: fund 8000000: Stop dialog before the funding lands: expected undefined to be 'mixed'
  AssertionError: fund 30000000: Stop dialog before the funding lands: expected undefined to be 'mixed'
  ```
- **Why low:** the approval said it a minute before, the privacy policy's giveme.my line covers it, and nothing is lost. It's a missing warning plus LW-1's misleading "less the return's network fee" in a short, common window: pressing Stop right after Start swap. It's dormant on mainnet until a 5 ₳ pool holds its floor.
  - The box count is unaffected: with nothing set aside it counts `funded`, which excludes the reserve.
  - A token→ADA funding is unaffected too: once landed, it holds no ADA alone, and nothing is said either way.
- **Suggested fix:** no new words, no refusal. While the funding isn't on chain (its `out` unconfirmed), count the account as the funding will leave it:
  - its 5 ₳ collateral;
  - for an ADA swap, ADA alone (`adaIn`, `funded > 0n`).

  So: `mayMix = (rows?.some(collateralFits) || landing) && (spare > 0n || out || (landing && adaIn)) && …`, with `landing = !s.txs.some((t) => t.kind === "out" && t.confirmed)`. `aside` then follows as now.

### 2. low: a Review whose 5 ₳ pool read fails says nothing of the collateral's mix, though the rule, the quote and Stop treat a failed read as "may", and the return mixes it

- **Where:** `extension/src/background/sessions.ts:4603–4607` (tailReserve: a failed `collateralPool`, and so a failed split at `lovejoin.ts:3899`, returns 0n). From it:
  - `:1831` and `:1920`: outBuild sets `collateralMix` only where `asked(lovejoin)` > 0;
  - `:2087` and `:2140`: mixFunding the same;
  - siteOutBuild and topUpBuild the same.
- **Concerns:** fx-promise's rule, whose `ifLeft` is "wherever a 5 ₳ pool may take the collateral (Settings' switch on, the pool not known to refuse)". The fundings decide it on tailReserve's answer, and that folds "the read failed" into "no pool". The gating dates from R3-9 and x-privacy#1; the quote and Stop use `collateralPoolTakes`, where a failed read is "maybe" (`lovejoin.ts:3923`). So the fix and its neighbours disagree.
- **Scenario:** 500 MIN sold for ADA, preprod's 5 ₳ pool taking the collateral. At Review, Koios times out on the pools' read (credential_utxos naming the 5 ₳ pool's `mix_box`).
  - **The quote** (as the user typed) said `collateralMix: "ifLeft"`, `collateralMaybe`. Max kept the reserve aside.
  - **The approval:** no reserve, no `collateralMix`. So it has no *Mixed* step and no giveme.my line of any kind for that mix, only GivemeNote's funding line.
  - **After the fill,** the return reads the pool again (buildBack's `intoPool`, which doesn't look at what the approval found). It builds the collateral's tail from the fill's ADA, and giveme.my backs that mix, which the approval never named.
  - ADA→MIN shows the same approval (nothing said); its return mixes the 5 ₳ only on a stop or a refund, where Stop's dialog does say so.
  - **A mix's review** is the same, through mixFunding.
  - **A site's funding** says "The rest and the 5 ₳ come back at once". Its return is reviewed by hand, and that review names the tail before anything is sent.
- **Evidence:** `zz-review-3d-2`, with the Koios fake failing (504) any credential_utxos naming the 5 ₳ pool's `mix_box` during the quote and outBuild. Then `backBuild` on that sell's filled session, unreserved, with the read working: the order's change 1.84 ₳, the fill's 6 ₳ and the 5 ₳.
  ```
  {"quoteMix":"ifLeft","approvalReserve":null,"approvalMix":null,"backTail":true,"backBoxes":0,"giveme":"giveme.my backs it"}
  AssertionError: the sell's approval after a failed read: expected undefined to be 'ifLeft'
  ADA→MIN: {"quoteReserve":"1500000","quoteMix":"ifLeft","quoteMaybe":true,"boxes":0}; with the read working: {"okReserve":"1500000","okMix":"ifLeft"}
  AssertionError: approval after a failed 5 ₳ pool read: expected undefined to be 'ifLeft'
  ```
- **Why low:** it's the same class as last-3c 2. It's a missing warning, never a wrong one, and the privacy policy's giveme.my line (which names "the one mix of a private session's 5 ₳ collateral") covers it. giveme.my already sees the funding, which names the same one-time account. It needs a read failure at Review, and it's dormant on mainnet until a 5 ₳ pool exists.
- **Suggested fix:** no refusal, and the funding still goes without the reserve on a failed read, as now.
  - Have tailReserve tell "no pool takes it" from "the read failed": for example `{ reserve, may }`, where `may` is the read failing or throwing, a trap still handed on.
  - outBuild, mixFunding, siteOutBuild and topUpBuild then set `collateralMix: "ifLeft"` where `may` holds.
  - outBuild still sets nothing where tailUnpaid holds.
  - The approval's line and the Mix review's line follow with no new words.

## Checked, and holding

**The rule, case by case.** "Mixed" holds only where the reserve is paid and the money keeps it; "ifLeft" is conditional; "none" means no mix can go:
- **The swap approval** (outBuild → SwapApproval):
  - **ADA fill, order or pools:** reserve paid → `mixed`, short → `ifLeft`.
    - An order's change holds the reserve as ADA alone: margin − fee + 1.5 ₳ ≈ 3.34 ₳, above the direct tail's 2.66 ₳.
    - A pools fill of ADA is one output of ADA alone.
    - A refund keeps the change.
  - **Token fill, no box of its own:** `ifLeft`, paid or not (call 1). Against the pools, `tailUnpaid` → nothing.
  - **Token fill with boxes:** `mixed` (a chain).
  - **The `short` refund of a token's boxes:** `asked` and `keepsReserve` are recomputed on the new `lovejoin`.
  - **Switch off, Settings' collateral off, or no 5 ₳ pool:** nothing.
- **Stop:**
  - **Nothing sent:** an ADA swap is `mixed` or `ifLeft` by the reserve. A token swap is nothing, since its funding is the token beside all the ADA, and the return builds none.
  - **An order sent or on chain:** ADA-in keeps the reserve whether it's cancelled or fills. Token-in is `ifLeft`.
  - **Stop direct, with a box:** no line.
  - **Approved direct:** `null`, no line.
  - **Pool short:** "its ADA would come back directly" (finding 5).
  - Stop isn't offered once filled, refunded or a pools swap is out (`stoppable`), so those `counted` and `keeps` branches are reached only by a dialog already open.
- **Stop's count with an ADA order on chain:** checked against `quoteOf`. `fund.lovelace − aggregatorFee − SWAP_MARGIN` is the order's ADA, and the token boxes' `fund` sits in the change, inside `held`. SWAP_MARGIN has been 2 ₳ since chunk 15, so 1.5.0's records count the same.
- **A mix:** `mixed` exactly where its reserve is paid. A Bootstrap: nothing. `reviewHint` and the review's line agree.
- **A site's funding and top-up:** `ifLeft` wherever asked, the reserve paid or not (call 2). FundingWayBack and TopUpCollateralNote read `collateralMix` alone.
- **Max's note:** `mixed` needs `takes === "yes"` and `keepsReserve`. A maybe is `ifLeft`, and no pool is the plain note. The quote prices a token's boxes without the room read, so its `mixed` can be the approval's `ifLeft`, the safe way round.

**No cost row counts a reserve that wasn't paid:**
- the approval's mix cost (`mixCost`) is gated on `collateralReserve`;
- so are FundingWayBack's row and its both-ways total;
- so is every `CollateralReserveRow`;
- Stop names no cost for that mix, and its box count sets aside only `s.collateralReserve`'s reserve.

**What fx-promise reverted:**
- `lovejoinCost` and `priced` are line for line as they were before fx-last (3ea05dc1).
- outBuild, siteOutBuild and topUpBuild differ from 3ea05dc1 only in their `collateralMix` lines.
- No caller of `lovejoinPriced`, `tailPaid` or `priced().left` is left.

**Backward compatibility:**
- nothing persisted carries `collateralPool` or `collateralMix` (kept fundings hold `tailReserved`; records hold `collateralReserve`, both unchanged);
- the dApp's site funding summary isn't stored;
- `lovejoin-1-5-0.test.ts` passes.

**Strings:**
- the new key and the three changed values are in en, es and ja, with `{{why}}` kept;
- the new key has its provenance;
- the derived critical set differs from the checked-in list by exactly `lovejoin.collateralMix.privacy.ifLeft` (`--write`, L5);
- no e2e spec reads a changed word or test id.

## Questions (not made concrete)

1. **The definite "mixed" for an ADA→token swap with boxes of its token rests on those boxes going at the return.** Routed against the pools, its fill is one UTxO holding the token beside all the ADA. If the token's pool can't take the boxes then (its room taken, stuck, refused under that epoch's parameters), the chain doesn't go. The return comes back directly, no direct tail can be paid from a token UTxO, and the 5 ₳ comes back with the rest. This needs a pool change between Review and return; not tested.
2. **A Stop that takes effect after the runner sent an order-approved ADA→token swap Minswap built against the pools.** The dialog said `mixed`, since nothing was out. That swap merges the reserve into the token's output, and StoppedLate's pools warning doesn't take the line back. This is a race with the runner's build; not tested.

## Checks run

- **Baseline:** fx-promise's worker describe passes, 9 of 9.
- **The wide set,** 132 files (session\*, swap\*, approvals\*, collateral\*, screens\*, lovejoin\*, dapp\*, site\*, i18n\*, words, privacy\*, pool-swap\*, direct-swaps, minswap\*, return\*, chain\*, parts\*, withdraw\*, pending\*, run\*, spent\*, home\*, settings\*, activity\*):
  - 1769 passed, 2 skipped, 3 failed;
  - the 3 failures are `i18n.test.ts`'s known critical-set gates (`--write`, L5's drafts).
- **`tsc --noEmit -p .`:** clean, run after the throwaways were deleted.
- **Throwaways** `zz-review-3d-1` and `zz-review-3d-2`: deleted.
  - Their logs are in the scratchpad, `last3d-throwaways.log`; the wide run's is `last3d-wide.log`.
  - Nothing tracked was edited.
  - No build, no Playwright, no cargo, no mainnet.
