# Fixer `sc-o-1`: the approvals, the swap form and the swaps page (round 2, lane S2)

Findings 323-worker#1, 323-worker#0 (the form half), 323-worker#6, gap-3#2, x-privacy#1, 319-worker#0 (the words), 320-screens#3, 322#0 and 322#1.

- Screens: `ui/swap.ts`, `Swaps.tsx`, `DappApprovals.tsx`, `SiteSessions.tsx`, and a new `ui/components/SendButton.tsx`.
- **Outside my lane, each a small anchored edit, said here:**
  - `background/sessions.ts` (Lane W's): one hunk in `quote()`;
  - `background/lovejoin.ts` (Lane W's): one new method, `collateralPoolShown`, after `collateralPool`;
  - `ui/screens/Lovejoin.tsx` (Lane S1's): the `SendButton` import and the Start mix button, nothing else;
  - `ui/components/LovejoinReturn.tsx` (no lane's): one exported constant, `COLLATERAL_MIX_COST`, beside `CollateralReserveRow`;
  - `ui/styles.css`: one rule, `.timeline__said`.
- No Rust. **No test needs the pkg rebuilt.**

## Findings

| id | status | change |
|---|---|---|
| 323-worker#1 (medium) | partly | **The swap approval:** `swapCosts` takes the collateral's mix (`COLLATERAL_MIX_COST`: its deposit, the mix under giveme.my and its box's way back, about 1.5 ₳). It goes into *Costs in all* as its own part row, *Its collateral's mix, about*, and comes out of *Comes back*. **A site's funding review:** `FundingWayBack` gains `collateral`, a row of the same name, and adds it to *Network fees both ways*. **Not done:** Stop's dialog (`stopCost`, sessions.ts) still prices boxes on the account's spare ADA with the reserve in. That's worker logic in Lane W's file, at a boundary (see the owner's calls, 9). |
| 323-worker#0, the form half | fixed | **`FEE_ROOM` is 2 ₳**, for the fee and the change's least: 1 ₳ covered the fee alone. **A swap's quote names `collateralReserve`** where its return goes through Lovejoin as Settings has it, Settings' collateral switch is on and a 5 ₳ pool is shown. It's read as discovery last kept the pools, asking nobody, through a new worker field (`SessionService.quote` → `LovejoinService.collateralPoolShown`). **`maxAdaIn` keeps it aside**, and the Max note names it (`swaps.maxNoteMixed`). **`adaShort` deliberately doesn't count it:** a balance short of the reserve is funded without it (`orWithoutReserve`), so counting it would refuse what the chain takes. See the owner's calls, 1. |
| 323-worker#6 | fixed (the swap, site and top-up reviews) | Each review that shows *For its collateral's mix* now says where the 5 ₳ goes. **The site's funding note** is `dappUi.back.privacy.noteLovejoinMixed`: the 5 ₳ is mixed once, in a box of its own, and comes back hours later. **The top-up's note** is `sites.topUp.collateralMixed`, through the extracted `TopUpCollateralNote`. **The swap approval:** its Plan's last step (four `swaps.plan.*Mixed`) and its no-box line (`swaps.review.noBoxMixed`). The Lovejoin tile's reviews are sc-lj-1's. The by-hand 5 ₳ notes are untouched: their reviews pay no reserve (the owner's calls, 6). |
| gap-3#2 | fixed | The same changes. Its cost half is 323-worker#1's above. |
| x-privacy#1 | fixed (the swap approval) | **One short line under giveme.my's note**, where the funding pays for the collateral's mix: `swaps.review.privacy.collateralMix`, "giveme.my backs its collateral's mix too, so it sees that mix. If that mix can't go, its 5 ₳ box waits unmixed, tied to this session." It compresses `lovejoin.collateralBox.privacy.note` and keeps both of its ties. The Lovejoin tile's reviews are sc-lj-1's. |
| 319-worker#0, the words | fixed | **The approval:** the width note shows only where something goes through Lovejoin (`cost`, not `through`). Where the pool takes nothing, the one true line is the pool-short warning, whatever the worker sends. **Stop's dialog** was already gated on `mixes`; a test now holds it there. wlj-4's worker fix stands beside this. |
| 320-screens#3 | fixed | **`SendButton`:** "Building…" while the review is built again, the sending words only while it's sent. **Wired into:** Start swap (`NewSwap` `rebuilding`, set by `rebuild()`); the session's and the site's return review Send (`rebuilding`, set by `buildBack`, which also stops `useSendingLabel` polling during a rebuild); and Lovejoin's Start mix (`pressed` again or again-public). **Start mix** also shows a public mix's progress only on a public mix's review, never on a private one. |
| 322#0 | fixed | **A `.privacy.` line under Details**, between Copy and the hex: `swaps.retry.privacy.cbor`, "Whoever you send it to can tie this swap's one-time account, and the private UTxOs that funded it, to you." |
| 322#1 | fixed | **`aria-live="polite"` moves** off the retry line onto a wrapper around its words: the reason with its time, and the error line. Details and its hex sit outside it. **The layout is unchanged:** `.timeline__said` gives the wrapper the line's own flex column and gap. The e2e's `session-retry` still holds the Details. |

## Tests, fail-before, and mutation checks

**The setup:**
- New file: `tests/approvals-review-fixes.test.ts`.
- `SendButton` and `TopUpCollateralNote` were first extracted with today's behaviour exactly, so their tests failed on today's words, not on a missing import. Then fixed.
- Every mutation below was undone with Edit, the tests rerun, and the hunk put back with Edit.
- A grep afterwards found no mutation left.

| finding | test (file › describe › name) | fail-before (today's code) | mutation check |
|---|---|---|---|
| 323-worker#1 | approvals-review-fixes › "a swap's costs count the collateral's mix its funding pays for (323-worker#1)" › "adds that mix's deposit, the mix and its box's way back…" | `expected undefined to be 1500000n` (no input for it) | `+ collateral` out of `cost`: `expected 0n to be 1500000n` |
| 323-worker#1 | same › "says so on the approval: in the total, as a part of it, and not as coming back" | received "Costs in all, about 2.73 ₳ … Comes back, about 906.5941 MIN and 10 ₳", expected "…about 4.23 ₳ … Its collateral's mix, about 1.5 ₳ Comes back, about 906.5941 MIN and 8.5 ₳" | both mutations fail it: the cost mutation above, and the part row off |
| 323-worker#1 | approvals-review-fixes › "a site's funding review counts the collateral's mix in the way back (323-worker#1)" | `expected 'Later, to bring it back …' to contain 'Its collateral's mix, about 1.5 ₳'` (both ways 0.73 ₳) | `+ mix` out of both ways: `expected … to contain 'Network fees both ways, about 2.23 ₳'` |
| 323-worker#6, gap-3#2 | approvals-review-fixes › "where the reviews that pay for the collateral's mix say its 5 ₳ goes" › "a site's funding review never says the 5 ₳ comes back at once" | `expected '…' not to contain 'the 5 ₳ come back at once'` | the note's old ternary back: the same failure |
| 323-worker#6, gap-3#2 | same › "a site's top-up never says its new 5 ₳ comes back with the next return" | `expected 'The account has no collateral left, s…' not to contain 'comes back with the next return'` | the old key back: the same failure |
| 323-worker#6, gap-3#2 | same › "a swap's approval never says everything left comes back at once or directly, its 5 ₳ included" | `expected '…' not to contain 'The proceeds and everything left, dir…'` | each fails it: the Plan's map ignored; the no-box key back (`… not to contain 'so it all comes back at once'`) |
| 323-worker#6, gap-3#2 | same › "each of the Plan's ways back, with its 5 ₳ in a box of its own" | `expected '…' to contain 'The proceeds and the rest at once; sp…'` | the Plan's map ignored: the same failure |
| x-privacy#1 | approvals-review-fixes › "a swap's approval says giveme.my sees its collateral's mix (x-privacy#1)" | `expected '…' to contain 'giveme.my backs its collateral\'s mix…'` | the line emptied: the same failure |
| 319-worker#0 | approvals-review-fixes › "where Lovejoin's pool takes nothing, the swap's screens say only that (319-worker#0)" › "on the approval…" | `expected '…' not to contain 'three at a time'` | the gate back to `through`: the same failure |
| 319-worker#0 | same › "and Stop's dialog, likewise"; "but says why four went three where something goes through Lovejoin" | guards: they pass before and after | (Stop's dialog's existing gate) |
| 320-screens#3 | approvals-review-fixes › "a review built again by its switch or Change says Building…, never Sending…" (2 tests) | `expected 'Sending…' to be 'Building…'` | the `rebuilding` branch off: the same failure |
| 322#0 | approvals-review-fixes › "the transaction under a retry's Details (322#0, 322#1)" › "says, beside Copy, that it ties whoever sends it…" | `expected ' Details The transaction Minswap buil…' to contain 'Whoever you send it to can tie this s…'` | the note emptied: the same failure |
| 322#1 | same › "keeps it out of the line read aloud as the retry changes" | `expected [ Array(1) ] to deeply equal []` (the `<pre>` inside the `aria-live` div) | `aria-live` back on the outer div: the same failure |
| 323-worker#0 | `tests/swap-form.test.ts` › the swap form › "keeps aside what the funding adds for its collateral's mix, and room for its fee and change (1.6.0's release review, 323-worker#0)" | written after the fix; its fail-before is the mutation | reserve ignored in `maxAdaIn`: `expected '15000000' to be '13500000'` |
| 323-worker#0 | `tests/collateral-reserve-review-fixes.test.ts` › "the swap form's Max and the collateral's mix (323-worker#0)" › "names in a swap's quote what its funding would add for its collateral's mix where a 5 ₳ pool is shown, asking nobody". It covers no pool shown, the switch off, returns off, and as many Koios requests as a quote that never looked | written after the fix | the quote's field removed: `expected undefined to be '1500000'` |
| 323-worker#0 | same › "funds the ADA amount Max gives, with the collateral's mix where a 5 ₳ pool would take it". It uses the real WebAssembly: a balance whose Max is whole ₳ to the lovelace, with and without a 5 ₳ pool | written after the fix | three mutations, each `1 pools: expected undefined to be '1500000'` (Max's amount funded without the mix): reserve ignored in `maxAdaIn`; `FEE_ROOM` back to 1 ₳; the quote's field removed |

**Honesty note on 323-worker#0's tests.** I edited `swap.ts` before writing its three tests, so their fail-before is shown by the mutations above, not by a run on today's code.
- What I traced, not ran: on today's code, Max on 24.5 ₳ with a 5 ₳ pool gives 12 ₳. That funding needs about 26.2 ₳ with the reserve and 24.7 ₳ without, so Review refuses it: the finding's bug.

### Existing tests adapted

**`tests/swap-form.test.ts`:** its FEE_ROOM expectations, now 2 ₳.

| case | was | now |
|---|---|---|
| `maxAdaIn("28000000")` | 16 ₳ | 15 ₳ |
| a quote's own 7.5 ₳ of costs | 14.5 ₳ | 13.5 ₳ |
| a token's quote | 16 ₳ | 15 ₳ |
| `halfOf("20000000", max)` | 8 ₳ | 7 ₳ |
| Max on 123.456789 ₳, rounded | 111 ₳ ("less the usual 12 ₳") | 110 ₳ ("13 ₳") |

Nothing else changed.

## e2e changed (`e2e/extension.spec.ts`)

**One place:** the private swap's step "a swap Minswap built and couldn't run", after Details opens. Three new expectations:
- `retry.getByTestId("session-retry-cbor-privacy")` has the text "Whoever you send it to can tie this swap's one-time account, and the private UTxOs that funded it, to you." (322#0);
- the hex's nearest `[aria-live]` is none: `cbor.evaluate((el) => el.closest("[aria-live]")?.getAttribute("aria-live") ?? "off")` is `"off"` (322#1);
- `retry.locator('[aria-live="polite"]')` contains "The swap Minswap built failed when Minswap ran it" (322#1).

**No expectation removed or reworded.** e2e's swap and site fundings carry no reserve, so every new variant stays off there. Its Plan, costs and both-ways lines are unchanged.

## Files touched

- **Screens:**
  - `extension/src/ui/swap.ts`: `swapCosts`' `collateral`; `FEE_ROOM`; `maxAdaIn`; `adaShort`'s doc;
  - `extension/src/ui/components/SendButton.tsx` (new);
  - `extension/src/ui/components/LovejoinReturn.tsx`: `COLLATERAL_MIX_COST`, and `SESSION_FEE_ESTIMATE` imported;
  - `extension/src/ui/screens/Swaps.tsx`:
    - `NewSwap`: `rebuilding`, `SendButton`, the Max note;
    - `SwapApproval`, `SwapCosts`, `Plan` (`COLLATERAL_LATER`) and `LovejoinChoice`'s width-note gate;
    - `Session`: `rebuilding`, `SendButton`;
    - `Timeline`'s retry line;
  - `extension/src/ui/screens/DappApprovals.tsx`: `FundingWayBack`'s `collateral`;
  - `extension/src/ui/screens/SiteSessions.tsx`: `TopUpCollateralNote`; `SiteSession`'s `rebuilding` and `SendButton`;
  - `extension/src/ui/screens/Lovejoin.tsx` (S1's): the import and the Start mix button;
  - `extension/src/ui/styles.css`: `.timeline__said`.
- **Shared, worker:**
  - `extension/src/shared/rpc.ts`: `SwapQuote.collateralReserve` (additive);
  - `extension/src/background/sessions.ts` (W's): `quote()`, one hunk;
  - `extension/src/background/lovejoin.ts` (W's): `collateralPoolShown`.
- **Strings:**
  - `extension/src/i18n/translations/{en,es,ja}.json`: 11 keys each, added;
  - `docs/i18n/{es,ja}-provenance.json`: `machine` for each.
- **Tests:**
  - `extension/tests/approvals-review-fixes.test.ts` (new, 15 tests);
  - `extension/tests/swap-form.test.ts`;
  - `extension/tests/collateral-reserve-review-fixes.test.ts` (an import, and a new describe with 2 tests);
  - `extension/e2e/extension.spec.ts`.

## Keys

**Critical keys added** (named `.privacy.`; es/ja provenance `machine`; they need the blind back-translation):

| key | en |
|---|---|
| `dappUi.back.privacy.noteLovejoinMixed` | "From the dApps page. Lovejoin mixes the spare ADA in 10 ₳ boxes and the 5 ₳ once, in a box of its own, so they're harder to tie to this session; they come back hours later. The rest comes back at once. Settings → Lovejoin turns that off." |
| `swaps.review.privacy.collateralMix` | "giveme.my backs its collateral's mix too, so it sees that mix. If that mix can't go, its 5 ₳ box waits unmixed, tied to this session." |
| `swaps.retry.privacy.cbor` | "Whoever you send it to can tie this swap's one-time account, and the private UTxOs that funded it, to you." |

**Other keys added:**

| key | en |
|---|---|
| `lovejoin.collateralMix.label` | "Its collateral's mix, about". The swap's cost row and the site's way-back row. |
| `sites.topUp.collateralMixed` | "…At the next return it's mixed once, in a box of its own, then comes back by itself." |
| `swaps.maxNoteMixed` | "…pays the swap's costs and network fee, its collateral's mix, and what's kept aside for contracts, which comes back." |
| `swaps.plan.backAdaOutMixed` | "The proceeds, spare ADA and its 5 ₳ collateral in Lovejoin boxes, later; the rest at once" |
| `swaps.plan.backDirectMixed` | "The proceeds and the rest directly; its 5 ₳ collateral in a Lovejoin box, later" |
| `swaps.plan.backTokenOutMixed` | "The proceeds and the rest at once; spare ADA and its 5 ₳ collateral in Lovejoin boxes, later" |
| `swaps.plan.backTokenPoolMixed` | "The proceeds and its 5 ₳ collateral in Lovejoin boxes, later; the rest at once" |
| `swaps.review.noBoxMixed` | "Too little spare ADA for a Lovejoin box, so all but its 5 ₳ collateral comes back at once." |

**How they're written:**
- **No existing value changed.** Each is a variant chosen where the funding pays the reserve, so classic-only and no-pool screens read as before.
- **A no-break space before ₳** in every new value, as the strings they vary have.
- **Terms follow each language's existing strings:**
  - es: "colateral", "caja propia", "de una vez", "aprox.";
  - ja: "コラテラル", "専用のボックス", "まとめて", "（概算）";
  - `swaps.review.privacy.collateralMix` es/ja follow `lovejoin.collateralBox.privacy.note`'s wording.

## Docs to update

1. **flows.md:463** (You pay, Max):
   - ADA's Max leaves the swap's costs, the collateral, and **2 ₳ for the funding's fee and its change's least** (a Seedelf output's least is 1.46 ₳). It also leaves the **1.5 ₳ its funding adds for its collateral's mix**, where a pool of 5 ₳ boxes is shown and Settings has the collateral go in (the quote's `collateralReserve`, asking nobody).
   - Its note then names that mix.
   - The example becomes "Max is 15 ₳. The other 13 ₳ …".
   - An amount typed past Max that the balance pays without the reserve is funded without it, and nothing refuses it.
2. **flows.md:468** (Review the swap):
   - **The costs:** where the funding pays for its collateral's mix, *Its collateral's mix, about 1.5 ₳* (its deposit, the mix under giveme.my's collateral, and its box's way back) is a part of *Costs in all*, and isn't counted as coming back.
   - **The steps:** the last one says the 5 ₳ collateral comes back later, in a Lovejoin box. "Too little spare ADA for a Lovejoin box" says all but the 5 ₳ comes back at once.
   - **Under giveme.my's line:** giveme.my backs that mix too and sees it, and if it can't go, the box waits unmixed, tied to the session.
   - **The width note** shows only where something goes through Lovejoin.
   - **Start swap** reads "Building…" while the switch or Change builds the review again.
3. **flows.md:481** (the retry): Details also says whoever you send the transaction to can tie the swap's one-time account, and the private UTxOs that funded it, to you. A screen reader reads the line's words as they change, never the transaction.
4. **flows.md:489** (a site's funding review): *Later, to bring it back* adds *Its collateral's mix, about 1.5 ₳* where the funding pays for it, and counts it in the fees both ways. Its note then says the 5 ₳ is mixed once, in a box of its own, and comes back hours later; the rest at once.
5. **flows.md:493** (Top up, Bring it back):
   - A top-up that pays a new collateral and its mix says the collateral is mixed once at the next return, then comes back by itself.
   - Bring it back's Send, and a swap's return reviewed by hand, read "Building…" while the switch or Change rebuilds the review.
6. **flows.md:521** (the collateral's mix): the swap's costs and the site's way back count about 1.5 ₳ for that mix where the funding pays the reserve.
7. **flows.md, Mix my boxes again / Start mix:** Start mix reads "Building…" while the *Four boxes a mix* switch rebuilds the review. It shows a public mix's progress only on a public mix's review. (The docs lane decides where this goes; it sits beside S1's switch fixes.)
8. **privacy.md:121** ("Every review that asks it says so where it's read"): add that a swap's approval also says giveme.my backs and sees its collateral's mix, since that return runs by itself. A site's or a top-up's says it on the return's own review, before anything is sent.
9. **privacy.md:145** (Copying raw bytes): the swap's retry Details now says what sending its transaction on ties.
10. **architecture.md:632** (the collateral's mix), and the swap form, wherever the docs lane keeps `ui/swap.ts`:
    - **`SwapQuote.collateralReserve`:** `SessionService.quote` sets it from `LovejoinService.collateralPoolShown`, a quiet `readSet` (no request), where the return goes through Lovejoin as Settings has it and `lovejoinCollateral` is on.
    - **`maxAdaIn`** keeps it aside. **`FEE_ROOM`** is 2 ₳. **`adaShort`** doesn't count it.
    - **`swapCosts`' `collateral`:** `COLLATERAL_MIX_COST` (LovejoinReturn.tsx), what the swap's costs and `FundingWayBack` count.
11. **architecture.md:646** (`minswap-build-failed`): the retry's `cbor` under Details now carries a privacy line. The retry line's live region holds only its words.

No privacy-policy change: nothing new leaves the device. The quote's pool check asks nobody, and every other change is words on a screen.

## Calls the owner might overturn

1. **`adaShort` doesn't count the collateral's reserve.** A balance that pays for the swap but not for the reserve is funded without it (`orWithoutReserve`). Refusing it at the form would be a guard the chain doesn't make.
   - Max keeps the reserve aside, the most private way as the default.
   - An amount typed past it is funded without the collateral's mix, and nothing on the form or the approval says so (the round-1 reserve fixer's call 4).
   - The option: a note where the quote names a reserve but the approval's summary has none. That case can't tell "the pool can't take it now" from "the balance is short".
2. **Max keeps the reserve aside wherever a 5 ₳ pool is shown** in discovery's last kept set. It doesn't check the pool's floor or free boxes, which would need a pool read as the user types.
   - Where a shown 5 ₳ pool is under its floor (mainnet, until one holds 30 others' boxes), Max leaves 1.5 ₳ more than the funding then takes. That ADA stays in the private balance.
3. **`FEE_ROOM` is 2 ₳.** It covers a fee from a few UTxOs and a change's least, with one token in it.
   - A Max over many UTxOs, or whose change carries many tokens, can still need more. Review then refuses it, as before.
4. **The costs notes (`swaps.costs.note*`) are unchanged.** The collateral's mix is its own labelled row. The note still names only the *Network fees* row's transactions, and stays true.
   - The option: name the mix's deposit and mix in the note. That's more words, and the owner asked for short.
5. **The estimate: `COLLATERAL_MIX_COST` is 1.5 ₳** (0.25 + 0.95 + 0.3), against 1.29 ₳ measured. It's high, as the other estimates are.
   - So on a swap, *Comes back* equals the figure with no reserve, since the reserve is also 1.5 ₳.
6. **The by-hand 5 ₳ notes aren't reworded:** `swaps.collateral.note` and `swaps.backCollateral.note`, "It comes back with everything else when you bring the session back".
   - Their reviews pay no reserve.
   - They're of the class Session 10's call 2 kept. The skeptic's advice was to put them to the owner with call 2.
   - They can be false where `buildBack` mixes a 5 ₳ of ADA alone from what's left over.
7. **A swap approval whose only Lovejoin part is the collateral's mix shows no switch.**
   - No 10 ₳ box: `any` is false, so `LovejoinChoice` isn't shown.
   - That mix (about 1.5 ₳ reserved, about 1.2 ₳ of fees) can then be turned down only in Settings (`lovejoinCollateral`).
   - No finding asked for a switch, and the existing switch's note speaks of the spare ADA, so it would read wrong there. Choices-not-links may want one.
8. **No giveme.my line on a site's or a top-up's funding review.** Their returns are reviewed by hand, and `CollateralTailNote` says it there, before anything is sent. A swap's runs by itself, hence its line.
9. **Not fixed (Lane W's, worker): Stop's dialog's boxes.**
   - `stopCost` (sessions.ts) prices them on `spareOf(returnable(s, rows))`, reserve included. The return sets the reserve aside first.
   - So where the spare's remainder over a box's price is under 1.5 ₳, Stop names one box more than goes.
   - Suggested: `const held = (rows ? spareOf(returnable(s, rows)) : 0n) - (s.collateralReserve ? BigInt(this.deps.wasm.lovejoinCollateralReserve()) : 0n);`, with a planner test at that boundary.
   - I left it: it's logic, not a field, in a file Lane W was editing.
10. **Lovejoin.tsx (S1's): the Start mix button, by anchored edit.** The finding names Start mix, and sc-lj-1's scope (its test file's header) doesn't include 320-screens#3.

## Notes for the lead and other fixers

- **Worker edits in Lane W's files:**
  - `sessions.ts` `quote()`: one hunk, the additive `collateralReserve` from `this.deps.lovejoin!.collateralPoolShown(network)`;
  - `lovejoin.ts`: `collateralPoolShown`, right after `collateralPool`. It uses the same pool predicate as `collateralPool` and `funding()`'s tail. A later tidy could share it.
- **The 1.5.0 gate.** `tests/lovejoin-1-5-0.test.ts` passed with all my changes in, 4 of 4 on both builds. Its comparison takes the quote's `lovejoin` only, not the new top-level field.
  - At my last run, its two "finishes a 1.5.0 vault left mid-flight by an update" cases failed on both builds.
  - The cause is Lane W's in-progress `counted` field in `lovejoin.ts`: the received vault trace gains `"counted": {…}` records. Not mine. For w-left and the lead.
- **For sc-lj-1:**
  - `SendButton` is shared and generic, with `rebuilding` and `sending`.
  - `COLLATERAL_MIX_COST` is exported from LovejoinReturn.tsx. If the Mix form's tail figure computes the same thing, reconcile it to one constant.
- **`node scripts/i18n-critical.mjs --write`** adds my three keys. Its derived set is 450 against the 447 checked in, and these three are exactly the difference. `tests/i18n.test.ts`'s three critical-set checks fail until then and until the back-translation.
- **Vitest has no DOM here.** The wiring is read, not run: each rebuild sets `rebuilding`, and `send()` doesn't. The label rule is tested through `SendButton`. See the screens to look at.

## Checks

- **New and changed files:**
  - `tests/approvals-review-fixes.test.ts`: 15 of 15, on the default build and with `VITE_ENABLE_MAINNET=false`;
  - `tests/swap-form.test.ts` and `tests/collateral-reserve-review-fixes.test.ts`: 28 of 28.
- **The screens:** `screens`, `lovejoin-hub`, `lovejoin-screens-review`, `dapp-prompt`, `swap-page`, `swap-page-words`, `swap-hidden-balances`, `swap-lovejoin-way`, `swap-form`, `approvals-review-fixes` and `lovejoin-1-5-0`: 11 files, 239 of 239.
  - On the preprod build, an 8-file subset: 180 of 180.
- **Every suite that calls the worker's quote** (16 files): 372 of 372.
- **The wider set:** `swap*`, `site*`, `dapp*`, `session*`, `return-site-outs`, `pool-swap-landing` and `minswap-refusals`: 49 files, 480 of 480.
- **The Lovejoin screens, after the Start mix edit:** 5 files, 168 of 168.
- **`i18n*`, `words`, `privacy-notes`:** 172 of 175. The 3 failures are `i18n.test.ts`'s critical-set checks, as expected above.
- **`npm run typecheck`** (src, tests and e2e): clean at my last run. An earlier run showed only sc-lj-1's mid-edit keys.
- **Mutations:** every hunk was put back with Edit, and a grep for the mutation forms found none.
- **Cleanup:** my scratch files are `sc-o-1-*` in the scratchpad: the fail-before log, the critical-set print, and the no-break-space line script.
