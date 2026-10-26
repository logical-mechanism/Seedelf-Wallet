# Fixer `fx-reserve-1`: the collateral's mix on the swap and site paths (round 3b, lane X)

Findings R3-9, R3-10, R3-11, R3-12, R3-1, R3-25 and L1, worker and screens together.

- **Worker:** `sessions.ts`'s quote, `outBuild`, `siteOutBuild`, `topUpBuild` and `stopCost`, plus one anchored method in `lovejoin.ts` (Lane Y's file).
- **Screens:** `ui/swap.ts`, `Swaps.tsx`, `DappApprovals.tsx`, `SiteSessions.tsx`.
- **Types:** `rpc.ts`, additive only.
- **No Rust, no WebAssembly change:** nothing waits for a rebuild.

## One rule for every review (R3-9 and R3-10)

- **The worker's summary says whether a 5 ₳ pool takes the collateral.** `outBuild`, `siteOutBuild` and `topUpBuild` return `collateralPool: true` where `tailReserve` found such a pool and the return can build the mix. That holds whether or not `orWithoutReserve` then dropped the reserve.
- **What the reviews count as a cost follows `collateralReserve`, as before.** That covers *Its collateral's mix, about*, the swap's *Costs in all* and *Comes back*, and the site's *Network fees both ways*.
- **What the reviews say of where the 5 ₳ goes follows what the return will do:**
  - **The swap approval** (the *Mixed* Plan step, `noBoxMixed`, giveme.my's line) uses `collateralReserve || (collateralPool && adaOut)`.
    - An ADA-out swap's fill is ADA alone, which pays for the mix, so it gets the mixed words.
    - An ADA-in (or token-to-token) swap without the reserve can't pay from its fill, so it keeps the plain words.
  - **A site's funding note and a top-up's note** use `collateralReserve || collateralPool`. What the site leaves decides at the return, and that return's own review (`CollateralTailNote`) says so before anything is sent.
- **R3-10:** `tailUnpaid(quote, l)` is true for a swap against the pools, a token out, no 10 ₳ box and no token box. Such a swap takes no reserve and carries no flag. Its quote names none, and its approval shows none of the mix's rows or words.

## Findings

| id | status | change |
|---|---|---|
| R3-9 | fixed | **Worker:** the three builders return `collateralPool: true` where a 5 ₳ pool takes the collateral, reserve paid or not. **Screens:** `SwapApproval` keys its words as above, and its cost on the reserve (`mixCost`). `FundingWayBack` puts its mix row and both-ways total on the reserve, and its note on reserve-or-pool. `TopUpCollateralNote` uses reserve-or-pool. |
| R3-10 | fixed, option (b) | **`tailUnpaid`** is new in `sessions.ts`. **`outBuild`** asks the reserve per way back (`asked(l)`), so it's decided again after the token-boxes fallback too. Its `collateralPool` follows `asked(lovejoin)`. **`quote()`** names no reserve there. **Option (a)**, the Rust `direct_tail` paying from a token UTxO's ADA, is the owner's (calls, 1). |
| R3-11 | fixed | **`LovejoinService.collateralPoolTakes`** replaces sc-o-1's `collateralPoolShown`. It asks nobody, by `collateralPool`'s rule as the Mix form's `tailReserveOf` keeps it:<br>• **"no":** no 5 ₳ pool is shown; it took no new box when last measured (`usables`); the data layer's last crowd count is under the network's floor (only read where the floor isn't 0); or a pool read within `POOL_ROOM_MS` has too few others or free (`TAIL_DRAWS`).<br>• **"yes":** that read has enough of both.<br>• **"maybe":** nothing read lately says.<br>**`quote()`** names no reserve on "no", the reserve on "yes", and the reserve with `collateralMaybe: true` on "maybe" (the private default). **The Max note** is `maxNote`, `maxNoteMixed`, or the new `maxNoteMaybe` ("what its collateral's mix may take"). |
| R3-12 | fixed | **`NewSwap` remembers that Max set the amount** (`maxed`). Max's button sets it. Typing, Half, a flip and another pay token clear it, since each goes through `setTyped` or the field's `onChange`. **An effect follows Max down** when it drops below the amount (`followMax` in `ui/swap.ts`): ADA only, never up. |
| R3-1 | fixed | **`FundingWayBack` and `TopUpCollateralNote` decide inside,** from a required `summary: Pick<SessionOutSummary, "collateralReserve" \| "collateralPool">`. The call sites pass `summary={review}`. **Dropping it fails tsc:** checked, TS2741 at both. **Tests render both** from summaries with the reserve, with the pool alone, and with neither. |
| R3-25 | fixed (words) | **`swaps.maxNote`:** "Max is {{max}} ₳. The other {{aside}} ₳ pays the swap's costs and network fee, or comes back: what's kept aside for contracts, and the change." **`swaps.maxNoteMixed`** says the same with "its collateral's mix" among what it pays. **es and ja** moved with them. |
| L1 | fixed | **When the collateral goes into the 5 ₳ pool first, in `stopCost`:** the account holds a 5 ₳ collateral and ADA alone to pay for the mix, Settings' switch is on, and `collateralPoolTakes` isn't "no". The dialog's own pool read has just refreshed the rooms. **Priced as WebAssembly does:** the funding's reserve (`record.collateralReserve`) is then set aside before the boxes are priced, as WebAssembly's `tail_reserve` sets it aside. **The cost carries `collateralMix: true`.** `StopDialog` then shows the existing critical line `swaps.review.privacy.collateralMix` wherever Stop doesn't bring it back directly: the switch is on, or there's no box, so no switch. |

## Tests, fail-before, and mutation checks

**How they ran:**
- **Fail-before** is today's behaviour, logged in `fx-reserve-1-failbefore.log` in the scratchpad.
  - `followMax` started as a stub that follows nothing.
  - The R3-1 prop change first kept today's reserve-only rule.
  - So each failure was on behaviour, not on a missing import.
- **Every mutation** was made with Edit, run, and put back with Edit, in groups A to D whose mutations each target a different test.
- **Afterwards** a grep of my diff found no mutation left.

**`tests/approvals-review-fixes.test.ts`** › "1.6.0's release review, round 3b: the reviews' collateral words follow what the return does (R3-1, R3-9, L1)":

| test | fail-before | mutation → failure |
|---|---|---|
| "a site's funding review counts the mix only where its reserve is paid, and says the 5 ₳ is mixed wherever a pool takes it (R3-1, R3-9)" | `expected 'Later, to bring it back Its network f…' to contain 'Lovejoin mixes the spare ADA in 10 ₳ …'` | pool flag ignored in FundingWayBack → same |
| "a site's top-up says its new 5 ₳ is mixed wherever a pool takes it, its reserve paid or not (R3-1, R3-9)" | `expected 'The account has no collateral left, s…' to contain 'At the next return it's mixed once, …'` | flag ignored in TopUpCollateralNote → same |
| "a swap's approval funded without the reserve: an ADA-out swap's fill pays for the mix, so it says so, an ADA-in one's can't (R3-9)" | `expected 'MI You pay 906.5941 MIN ₳ You receive…' to contain 'Too little spare ADA for a Lovejoin b…'` | flag ignored → same<br>`adaOut` dropped (flag alone) → `…to contain 'The proceeds and everything left, dir…'` (:378)<br>cost keyed on the words, not the reserve → `…not to contain 'Its collateral's mix, about'` (:372) |
| "Stop's dialog says the collateral is mixed under giveme.my's collateral wherever its return goes through Lovejoin (L1)" | `expected 'Stop this swap? Bring it back through…' to contain 'giveme.my backs its collateral's mix…'` | line removed → same<br>the direct gate dropped → `…not to contain 'giveme.my backs'` (:392) |

The three existing 323-worker#1 and #6 tests now pass `summary: funding(true|false)`, the required prop. They still pin the reserve's rule.

**`tests/collateral-reserve-review-fixes.test.ts`** › "1.6.0's release review, round 3b: the collateral's mix on the swap and site paths (R3-9, R3-10, R3-11, R3-12, L1)". Real WebAssembly, preprod's bundled 5 ₳ pool:

| test | fail-before | mutation → failure |
|---|---|---|
| "keeps on a funding without the reserve that a 5 ₳ pool would take its collateral (R3-9)" | `expected { changeLovelace: '2766792', …(15) } to match object { collateralReserve: '1500000', …(1) }` | outBuild's flag off → same<br>siteOutBuild's → `expected undefined to be true` (:332)<br>topUpBuild's → same (:337) |
| "takes no reserve for a swap against the pools whose return comes back directly with its token, nor names one (R3-10)" | `expected '1500000' to be undefined` (the quote) | outBuild's rule off → same at :350 (`out.collateralReserve`)<br>quote's rule off → same at :348 |
| "names a quote's reserve by what the wallet last read of the 5 ₳ pool, asking nobody, a maybe where nothing read lately says (R3-11)" | `expected undefined to be true` (collateralMaybe) | rooms read ignored → `expected '1500000' to be undefined` (:384)<br>maybe flag off → `expected undefined to be true` (:380) |
| "names none where the data layer's last count of the 5 ₳ pool is under the network's floor (R3-11)" | `expected '1500000' to be undefined` | crowd check off → same (:418) |
| "funds the amount Max set before any quote, followed down once the quote names the reserve (R3-12)" | `expected undefined to be '1500000'` (the 11 ₳ funded without the reserve) | followMax returns nothing → same |
| "prices Stop's boxes on what's left once its reserve is set aside, as WebAssembly's chain does, and says its collateral is mixed (L1)" | `expected { boxes: 2, mixes: 2, …(5) } to match object { boxes: 1, collateralMix: true }` | set-aside off → `{ boxes: 2, … }`<br>flag off → `expected { boxes: 1, mixes: 1, …(5) } to match…` (:482) |

**What the L1 test also checks:**
- WebAssembly's own chain, through `backBuild`, builds one box and a collateral tail at that boundary.
- A record funded without the reserve, with the same ADA, prices two boxes, its collateral still mixed.
- Settings' switch off: two boxes, and no line.

**What the R3-11 test also checks:**
- the read-decided quote asks Koios no more than the unread one;
- Max takes back the 1.5 ₳ once the pool's known not to take it;
- two boxes free, read again, give the reserve with no maybe.

**R3-1's type check (group D):** with `summary={review}` dropped at both call sites, typecheck gives `TS2741: Property 'summary' is missing…` at DappApprovals.tsx:768 and SiteSessions.tsx:635. Both put back.

**`tests/dapp-prompt.test.ts`:** its FundingWayBack call gains `summary: {}` (the required prop).

## Files touched

- **Worker:**
  - `extension/src/background/sessions.ts`: `tailUnpaid` (new), `quote()`, `outBuild()`, `siteOutBuild()`, `topUpBuild()`, `stopCost()`;
  - `extension/src/background/lovejoin.ts` (Lane Y's): `collateralPoolShown` replaced by `collateralPoolTakes`, one anchored method.
- **Types:** `extension/src/shared/rpc.ts`: `SwapQuote.collateralMaybe`, `SwapLovejoin.collateralMix` and `SessionOutSummary.collateralPool`, all additive.
- **Screens:**
  - `extension/src/ui/swap.ts`: `followMax` (new); `maxAdaIn`'s doc.
  - `extension/src/ui/screens/Swaps.tsx`:
    - `NewSwap`: `maxed`, the follow effect, Max's button, the field's `onChange`, the Max note's key;
    - `SwapApproval`: `collateralMixed`, `mixCost`;
    - `StopDialog`: the collateral line.
  - `extension/src/ui/screens/DappApprovals.tsx`: `FundingWayBack`'s required `summary`, and its call site.
  - `extension/src/ui/screens/SiteSessions.tsx`: `TopUpCollateralNote`'s required `summary`, and its call site.
- **Strings:**
  - `extension/src/i18n/translations/{en,es,ja}.json`: two values changed, one key added;
  - `docs/i18n/{es,ja}-provenance.json`: `swaps.maxNoteMaybe` is `machine`; the two changed keys stay `machine`.
- **Tests:**
  - `extension/tests/collateral-reserve-review-fixes.test.ts`: imports, and one describe with 6 tests;
  - `extension/tests/approvals-review-fixes.test.ts`: 3 tests moved to the required prop, and one describe with 4 tests;
  - `extension/tests/dapp-prompt.test.ts`: the required prop.

## Keys

- **Critical keys added or changed: none.**
  - `swaps.review.privacy.collateralMix` is reused unchanged, and now also shows in Stop's dialog.
  - Its es and ja are already among L5's unchecked drafts. Round 4's back-translation should read it in that second place too.
- **Other keys** (es and ja provenance `machine`):
  - **changed:** `swaps.maxNote`, `swaps.maxNoteMixed`;
  - **added:** `swaps.maxNoteMaybe`, "Max is {{max}} ₳. The other {{aside}} ₳ pays the swap's costs, network fee and what its collateral's mix may take, or comes back: what's kept aside for contracts, and the change."
- **No test or e2e reads the old words.** I grepped for the key, "pays the swap's costs", "costs and network fee" and "which comes back". Only `swaps.maxAda`'s title is tested, and it's unchanged.

## Docs to update

1. **flows.md:463** (You pay, Max): ADA's Max also keeps aside the 1.5 ₳ its funding adds for its collateral's mix, in either of these cases:
   - a pool of 5 ₳ boxes takes the collateral, as the wallet last read it: a pool read within five minutes, the data layer's last count against the floor, and whether it takes new boxes;
   - nothing read lately says. The note then says what the mix "may take".
   - It keeps none for a swap against Danogo's pools whose return comes back directly with its token.
   - Max pressed before any quote follows Max down once the quote names the reserve.
   - The example note: "Max is 15 ₳. The other 13 ₳ pays the swap's costs and network fee, or comes back: what's kept aside for contracts, and the change."
2. **flows.md:468–469** (Review the swap):
   - **The 5 ₳'s words** (the Plan's last step, the no-box line, giveme.my's line) show where the funding pays the reserve. They also show where a 5 ₳ pool takes the collateral though the balance couldn't pay the reserve too, if the swap's fill is ADA.
   - **An ADA-to-token swap without the reserve** says the 5 ₳ comes back with the rest.
   - **The cost row** (*Its collateral's mix, about*) shows only where the reserve is paid.
   - **A swap against Danogo's pools** whose return comes back directly with its token takes no reserve and says nothing of that mix.
3. **flows.md:479** (Stop):
   - The dialog prices its boxes on the account's ADA less the reserve its funding paid, as the return sets it aside.
   - Where the collateral would go into the 5 ₳ pool first, it says giveme.my backs that mix too, unless Stop brings it back directly.
4. **flows.md:489 and :493** (a site's funding review; Top up):
   - The note says the 5 ₳ is mixed once wherever a 5 ₳ pool takes the collateral, reserve or not. The return mixes it where what's left pays.
   - The mix row and the both-ways total count it only where the reserve is paid.
5. **architecture.md:632** (the collateral's mix), and wherever sc-o-1's docs item 10 lands. Its `collateralPoolShown` is now `collateralPoolTakes`:
   - **`collateralPoolTakes`** answers yes, no or maybe, by `collateralPool`'s rule, from what the wallet last read, asking nobody: `usableNow`'s last measure, the data layer's crowds against `poolFloor`, and the rooms read within `POOL_ROOM_MS`.
   - **The quote:** "maybe" keeps the reserve and adds `collateralMaybe`.
   - **`tailUnpaid`:** `outBuild` takes no reserve there.
   - **The summaries' `collateralPool`:** the words follow it, the costs follow `collateralReserve`.
   - **`stopCost`** sets the reserve aside where the collateral goes into the pool (WebAssembly's `tail_reserve`), and returns `collateralMix`.
6. **privacy.md:217**, the collateral mixed once:
   - A swap's approval and a site's reviews say so also where a pool takes the collateral though the balance couldn't pay the reserve too. An ADA fill, or what a site leaves, pays then.
   - Stop's dialog says giveme.my backs that mix where Stop brings the session back through Lovejoin.
   - privacy.md:121 can name Stop's dialog among the reviews that say it.
7. **The owner's list of calls.** sc-o-1's call 1 should read "funded without the reserve, not without the mix": its collateral is still mixed at the return where what's left pays (an ADA fill, a stop or a refund). The reviews now say so, by the rule above. reserve's call 4 is accurate.
8. **The privacy policy: no change.** Nothing new leaves the device: the quote's and Stop's checks read only what the wallet holds.

## Calls the owner might overturn

1. **R3-10's option (a), not taken** (the brief's instruction): let WebAssembly's `direct_tail` pay the collateral's mix from a token UTxO's ADA, its tokens going back as the deposit's token change. That's Rust and a rebuild. It would cover:
   - the pools' direct return;
   - a swap approved as an order that Minswap routes to the pools at build time, which (b) still misses: the reserve is taken, and that return can't build the mix;
   - a site session whose dApp leaves its ADA beside tokens.
2. **An ADA-out swap without the reserve shows the mixed words but no cost row** (the instruction: the cost row stays on the reserve). The mix's fees, about 1.2 ₳, come out of what comes back, so *Comes back* is high by about that there.
3. **An ADA-in swap without the reserve never names the collateral's mix for a stop or a refund,** whose return could build it. Stop's dialog says it when stopping. The R3-9 skeptic's short clause on the approval's ifStopped line is left to the owner.
4. **A site's funding or top-up without the reserve, a pool taking the collateral, says the 5 ₳ is mixed once.** That's true where the site leaves ADA alone to pay for it. The return's own review says whether it is, before anything is sent. The alternative was keying on the reserve alone.
5. **R3-11's edges:**
   - "maybe" keeps the reserve, the private default;
   - a pool read older than five minutes counts as unknown, never as a refusal;
   - the data layer's crowd count is trusted whatever its age, since it refreshes with every pool read;
   - on preprod, "maybe" is the form's usual state until a review reads the pools.
6. **R3-12's edges:**
   - Max's flag survives a change of the token received; only the pay token clears it, as the skeptic had it;
   - it follows down only.
7. **Stop's dialog line** shows on "maybe", where the dialog's pool read failed, as a disclosure. It also shows with no box, where there's no switch, since Stop isn't direct then.
8. **The Stop line reuses `swaps.review.privacy.collateralMix`** ("giveme.my backs its collateral's mix too…") rather than a new key, which would need its own back-translation.

## Notes for other fixers and the lead

- **Lane Y, `lovejoin.ts`:** one anchored method, `collateralPoolTakes`, in place of `collateralPoolShown`. It reads the `usables` and `roomsRead` caches and `facts`, and makes no request.
- **fx-reserve-2, the Mix path: the same class as R3-9, untouched here.**
  - The Mix review's hint (`Lovejoin.tsx` `reviewHint`, about line 177) keys its 5 ₳ words on `collateralReserve` alone.
  - `mixFunding`'s summary carries no `collateralPool`.
  - A mix funded without the reserve still has its collateral mixed at the chain's end where the change pays (`with_return`'s `CollateralTail::build(...).ok()`).
  - If wanted: one spread in `mixFunding`'s return (`...(asked ? { collateralPool: true } : {})`), and `reviewHint` keying on it.
- **A possible later improvement:** `status()` (the Lovejoin page's pool read) works out each pool's others and free, but doesn't refresh `roomsRead`. Refreshing it would make the swap form's note definite after a visit to the Lovejoin page. Not done: it's Lane Y's code.
- **No test needs the pkg rebuilt.**
- **No e2e expectation changed:**
  - e2e's fakes put no box in the 5 ₳ pool;
  - nothing in e2e reads the Max note, the site notes or the new Stop line;
  - its Stop step's `toContainText` still holds.
- **Read, not run (Vitest has no DOM):** `NewSwap`'s Max flag and follow effect. The rule is pinned through `followMax`, and the funding through the worker test.
  - **A visual check for the lead:** on preprod, with the 5 ₳ pool holding two boxes, press the swap form's Max before any quote. Once the quote arrives, the amount drops by 1.5 ₳ and the note reads "…what its collateral's mix may take…".
- **The critical-set gate** differs from the checked-in list by other lanes' keys:
  - `collateral.warn.bothLand` and `lovejoin.stuck.privacy.privateNamed` in;
  - `lovejoin.stuck.privacy.privateAccounts` out;
  - none of mine. The es and ja gate checks are L5.
- **The 1.5.0 gate,** `tests/lovejoin-1-5-0.test.ts`, passes unedited on both builds. Its Stop cost is unchanged: there's no box in its 5 ₳ pool, so "no".

## Checks

- **`npm run typecheck`:** clean (exit 0). An earlier run showed only Lane Y's mid-edit `lovejoin-accounts-review-fixes.test.ts`.
- **My files** (`collateral-reserve-review-fixes`, `approvals-review-fixes`, `dapp-prompt`): 50 of 50, on the default build and with `VITE_ENABLE_MAINNET=false`.
- **The wider set,** default build: 69 files, 936 passed and 3 failed. The 3 are `i18n.test.ts`'s critical-set checks: other lanes' keys, and L5.
  - The set: approvals, collateral\*, dapp-\*, direct-swaps, i18n\*, import-boundaries, lovejoin-1-5-0, lovejoin-planner, lovejoin, minswap-refusals, pool-swap-landing, privacy-notes, return-site-outs, screens, session\*, site-\*, swap-\*, ui-safety and words.
- **The same set on preprod** (`VITE_ENABLE_MAINNET=false`), without the i18n files: 53 files, 730 of 730.
- **After my last tidy** (the crowd read skipped where the floor is 0): collateral-reserve, approvals, lovejoin-1-5-0 and lovejoin.test, 129 of 129. On preprod, collateral-reserve and lovejoin-1-5-0, 18 of 18.
- **`node scripts/i18n-critical.mjs`** (print only, never `--write`): no key of mine in the difference.
- **Mutations:** groups A–D as above, each put back with Edit. A grep of my diff finds no mutation left.
- **Scratch files** are `fx-reserve-1-*` in the scratchpad:
  - the fail-before and mutation logs;
  - the string script, an exact-line replacement with no JSON round trip;
  - the critical-set print;
  - the final runs' logs.
