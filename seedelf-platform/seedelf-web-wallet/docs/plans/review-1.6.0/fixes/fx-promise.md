# Fixer `fx-promise`: one rule for what the screens promise of the collateral's mix (the launch gate)

Findings 1–5 of [review/last-3c.md](../review/last-3c.md): four lows and a nit, all about what Stop's dialog and the swap approval promise of the collateral's mix. The task: stop chasing each prediction and put one rule in place on every screen that speaks of that mix.

- **Worker:** `sessions.ts`: `quote`, `lovejoinCost`, `priced`, `outBuild`, `siteOutBuild`, `topUpBuild`, `mixFunding`, `stopCost`; `keepsReserve` and `CANCEL_FEE_ESTIMATE` (new); `tailPaid` and `lovejoinPriced` (removed).
- **Types:** `rpc.ts`: `CollateralMix` (new). `SwapLovejoin.collateralMix` and `SwapQuote.collateralMix` take it. `SessionOutSummary.collateralPool` gives way to `collateralMix`.
- **Screens:** `LovejoinReturn.tsx` (`CollateralMixLine`, new), `Swaps.tsx` (Max's note, `SwapApproval`, `StopDialog`), `DappApprovals.tsx` (`FundingWayBack`), `SiteSessions.tsx` (`TopUpCollateralNote`), `Lovejoin.tsx` (`reviewHint`, `CollateralMixNote`).
- **No Rust, no WebAssembly change:** nothing waits for a rebuild.

## The one rule

The worker decides one of three words wherever its way back is known (`CollateralMix`). Each screen maps it to its words.

- **`mixed` (definite):** only where the funding paid the reserve and the return's way keeps it for that mix, whatever the swap does. Shown as the definite words (the Plan's *Mixed* step, `noBoxMixed`, Stop's `*Mixed` notes, `privateNoteMixed`) and the existing giveme.my line.
  - **A mix's funding** (`mixFunding`): the reserve paid. Its chain sets the reserve aside before its boxes (`tail_reserve`).
  - **A swap's** (`outBuild`, `keepsReserve`): the reserve paid, and the fill is ADA, or the token has boxes of its own (a chain).
    - A fill of ADA is ADA alone, an order's or the pools' alike.
    - A token's fill with no box doesn't keep the reserve. Approved as an order, Minswap may still build it against the pools (`order`: "a swap against the pools goes"). That swap pays the session the token beside all the ADA, which a direct return can't pay that mix from (tailUnpaid's case; fx-reserve-1's call 1).
  - **Stop** (`stopCost`): the reserve paid, and nothing out can merge it. Not where an order of a token is out, since its cancel gives the token back beside all the ADA (`cancel_orders`; last-3c, 1). Not while a swap against the pools may yet land, or not.
  - **A site's funding and top-up: never.** What the site's transactions leave decides, and with tokens funded the reserve sits in a token UTxO. The return's own review (`CollateralTailNote`) says which.
- **`ifLeft` (conditional):** wherever a 5 ₳ pool may take the collateral (Settings' switch on, the pool not known to refuse) and the definite case doesn't hold.
  - Shown as one new line, `lovejoin.collateralMix.privacy.ifLeft`: "Its 5 ₳ collateral is mixed only if enough is left when it comes back. If it is, giveme.my backs that mix, so it sees it; if that mix can't go, its 5 ₳ box waits unmixed, tied to this session." [Round 4's words review took out the second "it": "If it is, giveme.my backs that mix, and so sees it; …".]
  - That's `collateralIfLeft`'s meaning, with giveme.my's part worded so it holds either way, and the tie kept.
  - The site's two notes say the same in their own words: their values changed in place, their keys reused.
- **Plain words:** only where no mix can go: no 5 ₳ pool, the switch off, the pool known to refuse, a direct Stop, tailUnpaid, no 5 ₳ at the account, or nothing of ADA alone there with nothing out.

**Costs and figures follow the money:**
- the cost rows (*Its collateral's mix, about*, the site's *Network fees both ways*) stay on `collateralReserve`;
- Stop's box count sets aside only what the funding paid (`aside`, as before), and counts what its return will hold (finding 4).

**`tailPaid` served only words, so it's gone:**
- with it go `lovejoinPriced`'s `spare`/`left` (folded back into `lovejoinCost`) and `priced()`'s `left`;
- so does the `epoch_params` read Stop's dialog made with no box.

## Findings

| id | status | change |
|---|---|---|
| last-3c 1 | fixed (by the rule) | A token sold through an order that's out is `ifLeft`, never `mixed`: its cancel gives the token back beside all the ADA. The finding's suggestion was the `*Direct` note and no giveme.my line. The rule says conditional instead, since the order may fill first, and then the mix goes. With no box, Stop's dialog says the plain "…everything comes back to your private balance." (with "The cancel costs a network fee too." for an order), then the line. Its box count is none: nothing of ADA alone is left after that cancel. |
| last-3c 2 | fixed (by the rule) | Not paid for, a pool taking it: `ifLeft`, whatever the boxes leave. The giveme.my disclosure never drops where the return may mix it: at depth 2 with 0.9 ₳ left after a box, the dialog now says the line, and WebAssembly builds the tail. The approval's half too: an ADA fill funded without the reserve is `ifLeft`. |
| last-3c 3 | fixed (by the rule) | An ADA fill against the pools funded without the reserve is `ifLeft`, never the definite words, whatever the swap's own fee leaves. No prediction is left to miss. |
| last-3c 4 | fixed | **With an order of ADA out and on chain,** Stop counts its boxes on what the cancel brings back: the account's ADA less the reserve set aside, plus the order's ADA (the approved funding less Minswap's fee and `SWAP_MARGIN`, which the order's change already holds, its fee paid), less `CANCEL_FEE_ESTIMATE` (0.25 ₳; a real Minswap cancel is 0.237697 ₳). **An order of a token:** none, since its cancel merges it all. **Before the order is on chain, or with a pools swap out:** at least the funding, as before. **Filled or refunded:** what's there. |
| last-3c 5 | fixed (words) | `swaps.stop.poolShort`: "{{why}}, so its ADA would come back directly, tied to this session on chain." en, es and ja. |

## Tests, fail-before, and mutation checks

**How they ran:**
- Every new test was written first and run on today's code. Assertions were ordered so the first failure shows what the screen wrongly says today, not a missing field. The logs are `fx-promise-*-failbefore.log` in the scratchpad.
- Each fix hunk was then undone with Edit, its test run, and the hunk put back with Edit. The logs are `fx-promise-mut-*.log`.
- A grep afterwards found every hunk in place.

**Worker, real WebAssembly** (`collateral-reserve-review-fixes` › "1.6.0's review of the fixes, fx-promise: the collateral's mix said by one rule, and Stop's boxes counted on what its return will hold (last-3c)"; preprod's 5 ₳ pool with two strangers' boxes, the classic pool):

| test | fail-before | mutation → failure |
|---|---|---|
| "Stop: mixed where its funding paid the reserve and the return keeps it, only if enough is left otherwise, nothing where no mix can go" | `expected { boxes: 2, … } to match object { boxes: 2, collateralMix: 'ifLeft' }` (unreserved: nothing said) | B, unreserved → none: same |
| "Stop: a token sold through an order that's out is mixed only if enough is left, since its cancel gives the token back beside all its ADA (last-3c, 1)" | `expected true to be 'ifLeft'` | A, `keeps = true`: `expected 'mixed' to be 'ifLeft'`<br>D, `spare > 0n` alone: `expected undefined to be 'ifLeft'` (the order sent, not seen) |
| "Stop: says that mix may go, giveme.my's part with it, where a default depth's box leaves too little for the rule of thumb and the return still mixes it (last-3c, 2)" | `expected undefined to be 'ifLeft'` | B: same |
| "Stop: counts its boxes, with an order of ADA out, on what its cancel brings back, the order's fee and the cancel's left out (last-3c, 4)" | `expected 1 to be +0` | C, the old count: same<br>C2, the cancel's fee left in: same |
| "the approval: an ADA fill against the pools its funding paid no reserve for may be mixed, said with giveme.my's part, never that it's mixed (last-3c, 3)" | `expected 'MI You pay 0.0005 MIN …' not to contain 'giveme.my backs its collateral's mix…'` | E2, an unpaid ADA fill said mixed: same |
| "the approval: a token's fill with no box of its own is mixed only if enough is left, its reserve paid or not, since Minswap may still route it to the pools; none where its return can't build it" | `expected '₳ You pay 10 ₳ …' not to contain 'giveme.my backs its collateral's mix…'` | E, the reserve alone decides: same<br>F, a token's boxes not a chain: `expected 'ifLeft' to be 'mixed'` |
| "the quote: Max's note follows the same rule, mixed only where that pool takes it and the fill keeps the reserve" | `expected {…} to match object { collateralReserve: '1500000', collateralMix: 'ifLeft' }` (a new field: Max's words are pinned below) | I, `takes === "yes"` alone: `expected 'mixed' to be 'ifLeft'` |
| "a site's funding and its top-up never say the collateral is mixed: what the site leaves decides, so only if enough is left, its reserve paid or not" | `funding, paid: expected 'Later, to bring it back …' to contain 'only if enough is left'` | G, a paid site's said mixed: `funding, paid: expected 'mixed' to be 'ifLeft'` |
| "a mix's review: mixed where its funding paid the reserve, which its chain sets aside; only if enough is left where it didn't; nothing with no 5 ₳ pool" | `expected 'First, a one-time account is funded …' to contain 'lovejoin.collateralMix.privacy.ifLeft'` | H, only the reserve's word: `…to contain 'Its 5 ₳ collateral is mixed only if e…'` |

**What the worker tests also prove against WebAssembly** (`backBuild`, at each state the rule speaks of):
- **Reserved, one box:** a tail.
- **Reserved, no box:** 9.5 ₳ of ADA alone, a tail.
- **Unreserved:** 0.5 ₳ after two boxes, none; 1.5 ₳ after one, a tail. "Only if enough is left" holds either way.
- **Depth 2, 0.9 ₳ after a box:** a tail.
- **What a token order's cancel leaves** (MIN and every lovelace in one output): no tail.
- **What an ADA order's cancel leaves** at finding 4's edge: no box. Not out yet: one box, as the dialog says.

**Screens** (`approvals-review-fixes` › "1.6.0's review of the fixes, fx-promise: each screen says the collateral's mix one of three ways (last-3c)", rendered in English):

| test | fail-before | mutation → failure |
|---|---|---|
| "the swap approval: mixed, only if enough is left, or nothing, its cost row on the reserve alone" (box and no box, reserve paid or not) | `no box: expected '…' not to contain 'giveme.my backs its collateral's mix…'` | J, words on the reserve: `…not to contain 'its 5 ₳ collateral in'`<br>L, the line always definite: same file, 4 tests fail |
| "Stop's dialog: mixed, only if enough is left, or nothing, and nothing where Stop brings it back directly" | `expected 'Stop this swap? … everything but its 5 ₳ collateral …' to contain '…everything comes back to your private balance.'` | K, the one-fee notes: same<br>K2, the direct gate dropped: 3 tests (L1's, LW-1's, this) |
| "Stop's dialog: with Lovejoin's pool short, its ADA comes back directly, never the 5 ₳ said mixed just before it (last-3c, 5)" | `…to contain 'under the 30 it needs, so its ADA wou…'` | P, the old words: same |
| "a site's funding review and its top-up: only if enough is left wherever a pool may take it, never mixed, its cost row on the reserve alone" | `1500000 ifLeft: …to contain 'and the 5 ₳ once, in a box of its own…'` | M, `FundingWayBack` on `ifLeft` alone: `1500000 mixed: …`<br>N, `TopUpCollateralNote` the same: `1500000 mixed: expected 'The account has no collateral left…' …` |
| "a mix's review: mixed, only if enough is left, or nothing, on a mix and on Mix my boxes again" | `a mix: …to contain 'lovejoin.collateralMix.privacy.ifLeft'` | Q, the note on `mixed` alone: `a mix: …to contain 'Its 5 ₳ collateral is mixed only if e…'` |

**Wiring** (`screens-wiring-review-fixes`):

| test | fail-before | mutation → failure |
|---|---|---|
| R3-12 › "says what Max keeps aside for the collateral's mix by the approval's rule: its mix, what it may take, or nothing (…fx-promise)" | `Received: "Max is 35 ₳. The other 15 ₳ pays the swap's costs, network fee and its collateral's mix, or comes back:"` | O, the note on `collateralMaybe`: same |
| Mix form › "says its collateral's mix one of three ways: its reserve counted, mixed only if enough is left, or nothing where no 5 ₳ pool takes it (…fx-promise)" | a pin: it passed before. The Mix form already followed the rule (rows where the count leaves room for the reserve, `CollateralIfLeft` where it doesn't, neither with no pool). | — |

**Existing tests moved to the rule** (the old expectations pinned what the rule replaces):
- **`collateral-reserve-review-fixes`:**
  - R3-9's: `collateralPool` → `collateralMix`. ADA→MIN paid and short are `ifLeft`; a site's and a top-up's are `ifLeft`.
  - R3-10's: `out.collateralMix` undefined.
  - L1's: `"mixed"`, and unreserved `"ifLeft"`.
  - R3-8's top-up: `"ifLeft"`.
  - **fx-last's three LM-1 tests are removed.** They pinned `tailPaid`'s bands, which this rule retires on purpose. Their states are re-proven in the new describe, with what WebAssembly builds. Their describe keeps LM-2's test.
- **`approvals-review-fixes`:**
  - 323-worker#6 and x-privacy#1 use `mixedFunding()` (the worker's `mixed`). The site's take `siteFunding()` (`ifLeft`) and the new site words.
  - R3-1/R3-9's describe uses `collateralMix: "ifLeft"`.
  - Its "ADA-out vs ADA-in" test now says both are `ifLeft`, never the definite words.
  - L1 and LW-1 use `"mixed"`, and finding 5's words.
  - 319-worker#0's Stop: finding 5's words.
- **`screens-wiring-review-fixes`:** the site wiring's `built()` takes `collateralMix`; titles say "only if enough is left".
- **`lovejoin-form-review-fixes`:** the Mix review's fixtures carry `collateralMix: "mixed"` beside the reserve.
- **`screens.test.ts`:** the pool-short line.

## Files touched

- **Worker:** `extension/src/background/sessions.ts`:
  - `CANCEL_FEE_ESTIMATE` and `keepsReserve` (new); `tailPaid` and `lovejoinPriced` (removed);
  - `lovejoinCost` and `priced` back to their shape before the last look;
  - `quote`, `outBuild`, `siteOutBuild`, `topUpBuild`, `mixFunding` and `stopCost`.
- **Types:** `extension/src/shared/rpc.ts`:
  - `CollateralMix` (new);
  - `SwapQuote.collateralMix` (new), and `collateralMaybe`'s doc;
  - `SwapLovejoin.collateralMix` takes the type;
  - `SessionOutSummary.collateralPool` → `collateralMix`.
- **Screens:**
  - `extension/src/ui/components/LovejoinReturn.tsx`: `CollateralMixLine` (new);
  - `extension/src/ui/screens/Swaps.tsx`: NewSwap's Max note, `SwapApproval`, `Plan`'s doc, `StopDialog`;
  - `extension/src/ui/screens/DappApprovals.tsx`: `FundingWayBack`;
  - `extension/src/ui/screens/SiteSessions.tsx`: `TopUpCollateralNote`;
  - `extension/src/ui/screens/Lovejoin.tsx`: `reviewHint`, `CollateralMixNote`.
- **Strings:**
  - `extension/src/i18n/translations/{en,es,ja}.json`: one key added; three values changed. Single-line edits; the two site notes by an exact-text script scoped to their lines, no JSON round trip, their no-break spaces kept.
  - `docs/i18n/{es,ja}-provenance.json`: the new key, `machine`, one inserted line each. The three changed keys were `machine` already.
- **Tests:**
  - `extension/tests/collateral-reserve-review-fixes.test.ts`: imports, one describe (9 tests), the moves above, LM-1's three removed;
  - `extension/tests/approvals-review-fixes.test.ts`: imports, two fixtures, one describe (5 tests), the moves above;
  - `extension/tests/screens-wiring-review-fixes.test.ts`: two tests, the site wiring's moves;
  - `extension/tests/lovejoin-form-review-fixes.test.ts`: three fixtures;
  - `extension/tests/screens.test.ts`: one expectation.

## Keys

- **Critical key added:** `lovejoin.collateralMix.privacy.ifLeft`:
  - en: "Its 5 ₳ collateral is mixed only if enough is left when it comes back. If it is, giveme.my backs that mix, so it sees it; if that mix can't go, its 5 ₳ box waits unmixed, tied to this session." [Since round 4: "…giveme.my backs that mix, and so sees it; …".]
  - es: "Su colateral de 5 ₳ solo se mezcla si queda lo suficiente cuando vuelve. Si se mezcla, giveme.my respalda esa mezcla, así que giveme.my la ve; si esa mezcla no puede hacerse, su caja de 5 ₳ espera sin mezclar, vinculada con esta sesión."
  - ja: "5 ₳ のコラテラルは、戻るときに十分残っている場合にだけミックスされます。ミックスされる場合は giveme.my がそのミックスを支えるため、giveme.my はそのミックスを見ます。そのミックスができない場合、5 ₳ のボックスはミックスされないまま、このセッションと結び付いた状態で待ちます。"
  - The wording follows `lovejoin.mix.privacy.collateralIfLeft` and `swaps.review.privacy.collateralMix`, the glossary's colateral/コラテラル.
- **Critical key changed:** `dappUi.back.privacy.noteLovejoinMixed` (unverified before; its key reused):
  - en: "…Lovejoin mixes the spare ADA in 10 ₳ boxes, and the 5 ₳ once, in a box of its own, only if enough is left, so they're harder to tie to this session; they come back hours later. The rest comes back at once. Settings → Lovejoin turns that off."
  - es: "…, y los 5 ₳ una vez, en una caja propia, solo si queda lo suficiente, …"
  - ja: "…5 ₳ は十分残っている場合にだけ専用のボックスで 1 回、…"
- **Other keys changed** (non-critical, `machine`):
  - **`sites.topUp.collateralMixed`:** "…At the next return it's mixed once, in a box of its own, only if enough is left, then comes back by itself; if not, it comes back with that return." Its key is reused, like its sibling's.
  - **`swaps.stop.poolShort`** (finding 5): "{{why}}, so its ADA would come back directly, tied to this session on chain."
    - es: "…así que su ADA volvería directamente…"
    - ja: "…停止するとその ADA は直接戻り…"
- **Reused unchanged, in new places:**
  - `swaps.stop.notPlaced`, `notSwapped`, `cancelled` and `cancelFeeToo`: Stop's no-box conditional;
  - `swaps.maxNoteMaybe`: Max's note wherever the quote is `ifLeft`.
- **No key removed.** No test or e2e reads the replaced words:
  - e2e's Stop step reads "If no order has gone out yet, none will", which every variant keeps;
  - nothing in e2e reads the changed notes or test ids.

## Docs to update

1. **flows.md:464** (You pay / Max): Max's note names "its collateral's mix" only where the quote's pool read says the pool takes it and the fill keeps the reserve (an ADA fill, or the token's own boxes). It says "what its collateral's mix may take" wherever else it keeps the reserve aside, a maybe included. For ADA→token with no token box, that's the usual case.
2. **flows.md:469** (Review the swap, its last part):
   - **Mixed** (the last step's "its 5 ₳ collateral in a Lovejoin box, later", "all but its 5 ₳ collateral comes back at once", giveme.my's line): only where the funding paid the reserve and the fill keeps it, an ADA fill or a token with boxes of its own.
   - **Mixed only if enough is left:** wherever else a 5 ₳ pool takes the collateral, reserve paid or not. A token's fill with no box is here: approved as an order, it may still go against the pools, beside all its ADA. The plain step and no-box line stay, and the line under giveme.my's says the 5 ₳ is mixed only if enough is left; if it is, giveme.my backs and sees that mix, and if it can't go its box waits unmixed, tied to the session.
   - **The cost row** stays on the reserve.
   - Replace "or a pool of 5 ₳ boxes takes the collateral without it and the swap's fill is ADA…" and "An ADA-to-token swap funded without it keeps the plain words…".
3. **flows.md:480** (Stop):
   - **The dialog says one of three things of the collateral:**
     - **mixed** (the line giveme.my backs that mix; with no box, "everything but its 5 ₳ collateral comes back…, the 5 ₳ later, mixed once"), where the funding paid the reserve and nothing out can merge it;
     - **only if enough is left**, with giveme.my's part, wherever else a 5 ₳ pool may take it, an order of a token out included (its cancel merges the token and all the ADA). With no box it says everything comes back to the private balance, with "The cancel costs a network fee too." for an order;
     - **nothing**, where no mix can go or Stop brings it back directly.
   - **With an order of ADA on chain,** the boxes are priced on what its cancel brings back: the account's ADA less the reserve set aside, and the order's ADA, less about 0.25 ₳ for the cancel. An order of a token's: none.
   - **The pool-short line** says "its ADA would come back directly".
4. **flows.md:490 and :494** (a site's funding review; Top up): wherever a 5 ₳ pool may take the collateral, reserve paid or not, the note says the 5 ₳ is mixed once, in a box of its own, only if enough is left: what the site leaves decides, and the return's own review says which. It never says it's mixed outright. The mix row and the both-ways total stay on the reserve.
5. **flows.md:514** (a mix from the private balance):
   - where the funding pays for the collateral's mix, as now;
   - where a pool takes it and the funding went without the reserve, the review's line says the 5 ₳ is mixed only if enough is left, with giveme.my's part;
   - its ⓘ keeps "comes back with the 5 ₳ kept aside" there (Session 10's call 2).
6. **architecture.md:633** (the collateral's mix):
   - **The summaries:** replace "The summaries' `collateralPool` says a 5 ₳ pool takes the collateral…" with `collateralMix` (`CollateralMix`: `mixed`/`ifLeft`) on `SessionOutSummary`, `SwapQuote` and `SwapLovejoin`, decided by the one rule: `keepsReserve` for a swap; a mix's always keeps its reserve; a site's is never `mixed`. Costs stay on `collateralReserve`.
   - **The quote** names `collateralMix` beside `collateralMaybe`, which no screen reads now.
   - **`stopCost`:** `mayMix` (a swap out counts as maybe bringing ADA alone), `keeps`, and the box count with an order on chain (`CANCEL_FEE_ESTIMATE`). It reads no `epoch_params` now.
   - **`tailPaid` and `lovejoinPriced` are gone,** if any doc names them (none does today).
7. **privacy.md:217:** the reviews' words by the one rule:
   - mixed only where the funding paid that mix and the return keeps it;
   - "only if enough is left", with giveme.my's part either way, wherever else a pool may take it, Stop's dialog included;
   - a site's funding and top-up never say mixed outright.
   - Replace "A swap's approval, where its fill is ADA, and a site's notes say the 5 ₳ is mixed also where the funding went without it…".
8. **privacy.md:121**, if it lists the reviews that say giveme.my sees the collateral's mix: they now say it wherever that mix may go, in a hedged line where it may not.
9. **The owner's list of calls (OWNER-CALLS.md and the chunk 34 plan):**
   - fx-last's calls 1 and 2 (the thresholds, a failed parameters read) are moot: no threshold is predicted, nothing is read.
   - fx-reserve-1's call 2 (mixed words with no cost row) no longer arises: `mixed` needs the reserve.
   - fx-reserve-1's call 4 (a site says mixed without the reserve) is now "only if enough is left", reserve or not.
   - fx-reserve-2's call 3 (the Mix reviews say nothing new without the reserve) is reversed: they now say the conditional line.
   - LM-1 is superseded by this rule.
   - Add this fixer's calls below.
10. **The privacy policy: no change.** Nothing new leaves the device. Stop's dialog makes one request fewer (no `epoch_params` with no box).

## Calls the owner might overturn

1. **A token's fill with no box of its own is never said mixed,** reserve paid or not: ADA→token, the commonest swap, now shows the conditional line and Max's "may take".
   - **Why:** approved as an order, Minswap may build it against the pools at the runner's build (`order`), and that return can't pay that mix (fx-reserve-1's call 1).
   - **To overturn:** let `keepsReserve` take an order-approved token fill, accepting that re-route.
   - **Or Rust:** the call 1 option (a), `direct_tail` paying from a token UTxO's ADA, which makes it moot.
2. **A site's funding and top-up never say mixed outright,** reserve paid or not. The dApp decides what's left, and a funded token puts the reserve in a token UTxO. The return's own review says which.
3. **The approval's conditional case keeps the plain Plan step and no-box line** ("the rest at once", "it all comes back at once"), qualified by the line under GivemeNote, as the Mix form's figures are by `collateralIfLeft`. Conditional variants of those five keys would make it exact, at five more keys in three languages.
4. **The conditional line keeps "if that mix can't go, its 5 ₳ box waits unmixed, tied to this session"** (never drop what it ties), so it's two sentences, about 38 words.
5. **The definite case rests on what the reserve and the swap's margin leave,** not on a measured threshold: 3.2 ₳ or more of ADA alone on every path, against the 2.66 ₳ a direct tail takes.
   - A session holding less with the reserve flag set would be said mixed, as last-money's synthetic Scenario B did.
   - No real path reaches it: pools' fees come off an ADA fill, and a token's against the pools takes no reserve.
6. **Stop counts a swap still out as one that may bring ADA alone:** an order sent and not yet seen, or a pools swap not landed. It says the line, not nothing, though the account holds no ADA alone yet.
7. **`CANCEL_FEE_ESTIMATE` is 0.25 ₳,** above Minswap's measured 0.2377 ₳. A dearer cancel (a SundaeSwap V3 or Plutus V1 order's) could leave the dialog a box high at the very edge.
8. **`collateralMaybe` stays on the quote** (R3-11's tests and the docs read it), though Max's note now follows `collateralMix`.
9. **The two site notes reuse their keys,** `noteLovejoinMixed` and `collateralMixed`, now carrying conditional words, rather than renaming them: no new key, the same translation work.
10. **The Mix review's ⓘ in the conditional case keeps `privateNote`'s** "comes back with the 5 ₳ kept aside" (Session 10's call 2, still the owner's), qualified by the line.
11. **LW-3** (the Mix form against its review in a band about 0.3 ₳ wide) is unchanged, the owner's.

## Notes for the lead

- **No test needs the pkg rebuilt.**
- **`--write` is needed:** the derived critical set differs from the checked-in list by exactly `lovejoin.collateralMix.privacy.ifLeft` (`node scripts/i18n-critical.mjs`, print only).
- **Round 4's blind back-translation** should read:
  - `lovejoin.collateralMix.privacy.ifLeft` (new);
  - `dappUi.back.privacy.noteLovejoinMixed` (changed; unverified before);
  - for meaning, the non-critical `sites.topUp.collateralMixed` and `swaps.stop.poolShort`.
- **The 1.5.0 gate** (`tests/lovejoin-1-5-0.test.ts`) passes unedited on both builds. Its Stop has no box in its 5 ₳ pool, so no word, and no new read.
- **e2e:** no expectation changed (above).
- **Visual checks,** on preprod with the 5 ₳ pool holding two strangers' boxes:
  - an ADA→MIN approval paying the reserve shows the cost rows and the "only if enough is left" line, not "giveme.my backs its collateral's mix too";
  - MIN→ADA paying it shows the definite words;
  - Stop on a session funded without the reserve shows the line;
  - a site's funding review says "…and the 5 ₳ once, in a box of its own, only if enough is left…";
  - a mix funded without the reserve shows the line on its review.
- **LM-1's tests:** fx-last's three LM-1 tests in `collateral-reserve-review-fixes` are removed. They pinned the retired `tailPaid`; the new describe covers their states.
- **Shared files:**
  - the locale edits are single lines;
  - the two site notes were edited by an exact-text script (`fx-promise-strings.py` in the scratchpad) scoped to each key's line, which asserts one match each, with no JSON round trip;
  - the provenance edits are one inserted line each.

## Checks

- **`npm run typecheck`:** clean (exit 0), run last.
- **Baseline before any edit:** the 8 files of this area, 159 of 159.
- **Fail-before:**
  - the worker's 9 new tests, all failing as above;
  - the screens' 5;
  - the wiring's Max note (the Mix form pin passed, as it should).
- **After the fix:** the 16 new tests pass. The touched files (approvals, collateral-reserve, screens-wiring, lovejoin-form, screens, dapp-prompt, lovejoin-1-5-0): 194 of 194 on the default build, and 194 of 194 with `VITE_ENABLE_MAINNET=false`.
- **The wide set, default build:** 139 files (session\*, lovejoin\*, swap\*, collateral\*, parts\*, return\*, site\*, chain\*, withdraw\*, pending\*, coin-control\*, approvals\*, dapp\*, run\*, spent\*, screens\*, home\*, settings\*, activity\*, privacy\*, words, i18n\*, direct-swaps, pool-swap\*, minswap\*, maybe-sent, mempool\*, date-locale, format, import-boundaries, ui-safety). 1868 passed, 2 skipped, 3 failed: `i18n.test.ts`'s critical-set gates, the `--write` above and L5's unchecked drafts, my key now among them.
- **The same set on preprod,** without the i18n files: 131 files, 1708 passed, 2 skipped.
- **Mutations:**
  - worker: A, B, C, C2, D, E, E2, F, G, H, I;
  - screens: J, K, K2, L, M, N, O, P, Q.
  - Each failed its test and was put back with Edit. A grep confirms every hunk.
- **Not run (the brief):** e2e, builds, `--write`, cargo.
- **Scratch files** are `fx-promise-*` in the scratchpad: the baseline, fail-before, mutation and final logs, the wide-run file lists and logs, the critical-set print and the string script.
