# 1.6.0 review of the fixes: screens and states

Lens: every screen a fix in rounds 1 and 2 changed. For each state a fix makes reachable, four questions: which button still works, can a switch show a state the review isn't in, does a figure on the form match the review's, and is any text a paragraph. Everything below was read at `e43eef7f` (the tree was clean). Each finding was reproduced with a throwaway test (`tests/zz-review-screens-states-{1,2,3}.test.ts`, deleted before returning). Each test asserted the right behaviour and failed with the output quoted.

The states the fixes reach mostly hold up:
- Every AgainSwitch, BringAllBack, PendingBanner, LockCountdown, Remove wallet, MaxLeftNote and SendButton state I looked at leaves a working button.
- No switch shows a width or a way back that its review isn't built at.
- The form and review totals agree wherever the form offers a count.

What's left is where the collateral's mix reserve meets the forms. Two fixers took opposite rules for it, and Max and the stepper still disagree with what the build does.

## Findings

### 1. The Mix form refuses one box, and stops its stepper one box low, where the worker funds it without the collateral's reserve

- **Severity:** low. **File:** `WW/extension/src/ui/screens/Lovejoin.tsx:304`, with `:2558` (`tail`), `:2916-2925` (stuckForm) and `:2947-2949` (notNow, cantAfford).
- **Concerns:** sc-lj-1, 323-worker#0 (the form half) and 320-screens#2. It disagrees with sc-o-1's `adaShort` (call 1) and with reserve's `orWithoutReserve` contract.

**Scenario.**
- The setup: preprod (a 5 ₳ pool shown that takes the collateral; on mainnet, once one holds its floor), the classic pool, one wave deep, a private balance of 19.45 ₳.
- The worker funds one box without the 1.5 ₳ reserve (`orWithoutReserve`): 12.45 ₳ and 5 ₳, a fee of 0.233 ₳, about 1.77 ₳ of change.
- The form does this:
  - `mixMost(…, tail)` keeps the reserve aside, so `adaMost` is 0.
  - Beside the stepper: "Your private balance can't pay for one box."
  - `notNow` becomes `cantAfford`, so Review is disabled.
- The window:
  - At one box it is 19.45 to 20.95 ₳.
  - At n boxes the stepper stops at n−1 and says "Your private balance pays for n−1 boxes at most", where n go.
- sc-lj-1's call 2 says Settings' collateral switch is the way out. With returns off (a supported setting), that switch is greyed (`Settings.tsx:852`, `disabled={!loaded || !on}`). Yet `funding()` still names the reserve and `mixFunding` still pays it (`tailReserve(network, true)`). A returns-off user can't reach that way out without turning returns on, the collateral off, and returns off again.

**Evidence.**
- `sessions.ts:4492-4494`, orWithoutReserve's own doc: "no form that decides what can be funded counts it, so it's never what refuses a funding (1.6.0's release review, 323-worker#0)".
- sc-o-1 left the reserve out of the swap form's `adaShort` for exactly that reason (its call 1). sc-lj-1 put it in the stepper's affordability, and the stepper also decides `notNow`.
- sc-lj-1's own mutation note ("the real test, `expected undefined to be '1500000'`, since it was funded without the reserve (the worker's fallback)") shows the worker builds there.
- Throwaway test, real WebAssembly, preprod's bundled 5 ₳ pool with two strangers' boxes:
  - at `held = funding.lovelace + 7 ₳ = 19.45 ₳`, `mixMost(…, 0n).adaMost` is 1;
  - `runner(wallet(19.45 ₳)).mixOutBuild("preprod", 1)` builds, paying `['12450000', '5000000']` with a fee of 233208 and no `collateralReserve`;
  - asserting the form offers that box fails: `AssertionError: the form should offer the box the worker funds: expected +0 to be 1`.
- A second case set `lovejoinReturns: false, lovejoinCollateral: true`. `lj.funding` still names `collateralReserve: "1500000"`, `tailReserveOf` gives 1.5 ₳, and a rich `mixOutBuild` pays it. `settings.test.ts:230` already pins the switch as disabled there.

**Suggested fix.** Keep `adaMost`, stuckForm, `capBalance` and `notNow` on `COLLATERAL + FEE_ROOM`, never refusing on the reserve. Use the tail only for the figures:
- Where the chosen count is more than the balance pays with the reserve, take the form's `tail` as 0, as the worker will build it, so the totals still match the review.
- Say so in one short line, e.g. "At this many, its collateral isn't mixed: there isn't 1.5 ₳ more for it."

That's a warning, not a refusal, and the default stays the most private wherever it's paid for.

### 2. Max pressed before any quote leaves the collateral's reserve out, so the swap goes without its collateral's mix, unsaid

- **Severity:** low. **File:** `WW/extension/src/ui/screens/Swaps.tsx:751`, with `ui/swap.ts:134` and the Max note at `Swaps.tsx:1085-1091`.
- **Concerns:** sc-o-1, 323-worker#0 (the form half).

**Scenario.**
- The swap form opens, the user picks MIN, and presses Max first: the usual first press.
- `quoted` is set only after a quote, and a quote needs an amount, so Max is worked out with no quote. On 24.5 ₳ that's 24.5 − 6 − 5 − 2 = 11 ₳ (USUAL_COSTS, no reserve).
- The quote for 11 ₳ names `collateralReserve` 1.5 ₳. Max then becomes 10 ₳, so the typed 11 ₳ isn't Max any more, and the Max note (`raw === max`) goes.
- Review funds the 11 ₳ without the reserve (`orWithoutReserve`), so the 5 ₳ comes back unmixed, tied to the session. Neither the form nor the approval says it was left out.
- Rounding Max to whole ₳ leaves under 1 ₳ over, never the reserve's 1.5 ₳. So this happens on nearly every first press, wherever the swap's real costs are the usual 6 ₳ or more.
- sc-o-1's test (`collateral-reserve-review-fixes.test.ts:274`) works Max out after a quote, so it never meets this case.

**Evidence.** Throwaway test, real WebAssembly, the recorded Minswap estimate:
- the first Max is 11 ₳, and Max after the quote is 10 ₳;
- `quote.collateralReserve` is `"1500000"`;
- `outBuild` of the 11 ₳ quote builds;
- asserting it is funded with the reserve fails: `AssertionError: Max's amount should be funded with the collateral's mix: expected undefined to be '1500000'`.

**Suggested fix.** Either of:
- Remember that Max was pressed (cleared when the user types), and fill the new Max when `max` changes.
- Ask on open whether a 5 ₳ pool is shown (as the quote's `collateralPoolShown` does, asking nobody), and keep the reserve aside in the no-quote Max too.

### 3. Max keeps 1.5 ₳ aside, and its note names "its collateral's mix", where the 5 ₳ pool is shown but can't take the collateral, so the approval then funds none

- **Severity:** low. **File:** `WW/extension/src/background/sessions.ts:1541` (the quote's `collateralReserve`), with `Swaps.tsx:1087`.
- **Concerns:** sc-o-1's call 2 (a Claude call, not an owner's) and 323-worker#0. It disagrees with sc-lj-1's `tailReserveOf`, which checks the same pool's floor, free boxes and usability from the page's own read.

**Scenario.**
- On mainnet, the first 5 ₳ pool anyone starts is shown at once, and sits under the floor of 30 other people's boxes for a long time.
- All that time, every wallet's swap form gets `collateralReserve` from `collateralPoolShown`, which checks only that the pool is shown.
- Max sits 1.5 ₳ under what's funded: 25 ₳ against 27 ₳ on 40 ₳, after rounding.
- Its note says "…pays the swap's costs and network fee, its collateral's mix, and what's kept aside for contracts…".
- `tailReserve`'s `collateralPool` refuses the pool (floor, two free boxes, usable). So the approval has no *Its collateral's mix* row, and its Plan brings the 5 ₳ back with the rest.

**Evidence.** Throwaway test: preprod's 5 ₳ pool with one stranger's box, fewer than TAIL_DRAWS:
- `quote.collateralReserve` is `"1500000"`;
- `outBuild` gives no `collateralReserve`;
- `maxAdaIn` gives 25 ₳ with it and 27 ₳ without;
- asserting the quote keeps aside only what the approval funds fails: `AssertionError: Max should keep aside only what the approval then funds: expected '1500000' to be undefined`.

**Suggested fix.** Use `tailReserveOf`'s rule in the quote, from what the worker last read, asking nobody: the network's floor against the last kept listing or the rooms cache, free boxes, and `unusable`. Where that isn't known, leave the reserve out of Max, and "its collateral's mix" out of the note.

### 4. The public Mix form's cap in a token pool still offers boxes the build refuses

- **Severity:** low. **File:** `WW/extension/src/ui/screens/Lovejoin.tsx:340` (`publicMixAda`).
- **Concerns:** sc-lj-1, 321-lj-screens#1, incomplete for token pools.

**Scenario.**
- PR #163's LJTEST pool. The public account holds 9 ₳ of ADA alone (the recorded fixture's) and one 5.4 ₳ UTxO holding three boxes' worth of LJTEST.
- `publicMixAda` gives 14.4 ₳, at least two boxes' funding of 14.3 ₳, so the stepper offers 2.
- Review's build refuses it.
- The causes, in `wasm/src/lovejoin.rs:2104-2160` (chain_from_account_at):
  - The chain returns the token the boxes don't take in an output of its own, and adds that output's least ADA (about 1.2 ₳) to `needed`.
  - It takes only as many token UTxOs as hold enough, largest first, where `publicMixAda` counts every pool-token UTxO's ADA.
- So whenever the user holds more of the token than the boxes take (the usual case), there's a window of about 1.2 ₳ or more where the form offers what the build refuses. That's the class 321-lj-screens#1 fixed for rewards and other tokens.

**Evidence.** Throwaway test, real WebAssembly:
- `t.coins.lists` gives `[10338.5 ₳ + 2 tokens, 5.4 ₳ + LJTEST, 5 ₳ collateral, 3 ₳, 3 ₳ + 4 tokens, 2 ₳ × 3]`;
- held is 14.4 ₳, and `mixMost` gives `adaMost` 2;
- `lj.publicBuild("preprod", 2, { pool })` throws: `Error: Your public account's ADA doesn't pay for 2 boxes of 2 ₳ and their mixes: that takes 11 ₳ in UTxOs of ADA alone, besides the collateral`.

**Suggested fix.** Either of:
- Count only the ADA of the token UTxOs the chain would pick (fewest that hold enough, most first), less an output's least when they hold more than the boxes take or other tokens.
- Let WebAssembly give the public cap, as `lovejoinBootstrapMost` gives the private Bootstrap's.

### 5. A swap approval whose only part through Lovejoin is its collateral's mix shows that mix's 1.5 ₳ cost with no switch to turn it down

- **Severity:** low. **File:** `WW/extension/src/ui/screens/Swaps.tsx:1366` (`any && <LovejoinChoice>`), and `:1378` (the no-box note).
- **Concerns:** pre-existing since #323, and now costed on screen by sc-o-1's 323-worker#1 and #6 (sc-o-1's call 7).

**Scenario.**
- A swap whose spare ADA pays for no box, and whose funding pays for none if stopped either (a small swap, or token→ADA with small proceeds). Settings as by default, a 5 ₳ pool taking the collateral.
- The approval shows *Its collateral's mix, about 1.5 ₳* in *Costs in all* (15% of a 10 ₳ swap) and "Too little spare ADA for a Lovejoin box, so all but its 5 ₳ collateral comes back at once".
- There's no switch, since `LovejoinChoice` needs `any`, which counts boxes only.
- Turning that mix down takes Settings. The note doesn't say so, unlike the site funding's ("Settings → Lovejoin turns that off").
- The owner's rules: private by default, with a visible control where it costs fees or time; a costed choice is a switch.

**Evidence.**
- Throwaway render of `SwapApproval` with sc-o-1's own fixture (`funding(true)`, `noBox`). The text has "Its collateral's mix, about 1.5 ₳" and the no-box line.
- Asserting a switch fails: `AssertionError: a costed choice should have its switch: expected '<div class="swap-summary" data-testid…' to contain 'role="switch"'`.
- The worker drops the reserve when the switch's rebuild sends `through: false` (`outBuild` → `tailReserve(network, false)`), so a switch would do it.

**Suggested fix.** Show the switch where `collateralMixed`, with a one-line note about the collateral. Off rebuilds with `through: false`, as the switch does today.

### 6. A private Bootstrap's review hint says "The deposit goes in now, in one transaction"

- **Severity:** nit. **File:** `WW/extension/src/ui/screens/Lovejoin.tsx:172`.
- **Concerns:** pre-existing. bootstrap's call 5 handed it to the screens round, and sc-lj-1 left it ("untouched").

**Scenario.**
- A private Bootstrap's review shows "First, a one-time account is funded", the *For returning the rest* row, and "Then it runs by itself".
- Its ⓘ hint (`reviewHint`, the same for both sides) says "The deposit goes in now, in one transaction. …".
- It's three transactions: the funding now, the deposit once that lands while the wallet is unlocked, then the sweep back. Nothing on that review says to stay unlocked.

**Evidence.**
- Throwaway: `reviewHint({ source: "private", summary: { mix: { bootstrap: true, … }, bootstrapReserve: "1500000" } })` returns `lovejoin.review.bootstrapNote`.
- Asserting it doesn't say "now, in one transaction" fails: `expected 'The deposit goes in now, in one trans…' not to contain 'now, in one transaction'`.

**Suggested fix.** A private variant, e.g. "Once funded, the account deposits the boxes and returns what's left. The boxes stay in the pool …", with no new critical key.

### 7. The public Mix form's held figure keeps the label "In your public account"

- **Severity:** nit. **File:** `WW/extension/src/ui/screens/Lovejoin.tsx:447` (HeldOnSide's `where`).
- **Concerns:** sc-lj-1, 321-lj-screens#1 (its call 4).

**Scenario.**
- From the public account, the stepper's held figure is now `publicMixAda`, what a mix can spend. For the fixture account in finding 4 that's 14.4 ₳, where Home's Public tab shows about 10,370 ₳.
- Its title and screen-reader text still say "In your public account" (`lovejoin.mix.inPublic`), on the Mix and Bootstrap forms alike.
- `cantAffordPublic` was reworded ("…has {{held}} ₳ a mix can spend"), but the label beside the number wasn't.

**Evidence.** Code at `:447` and `:2554-2555`. The figures are from finding 4's test.

**Suggested fix.** Where `publicMixAda` feeds it, label it as what a mix can spend from the public account. The private side is unchanged.

## Questions (not made concrete)

- PendingBanner's new `pending.confirmed.lovejoin_bootstrap`, "In Lovejoin, held there until you bring them back" (es "retenidas … las traigas"), is plural for a one-box public Bootstrap. sc-lj-1 made Your mixes singular for one box (x-i18n-es#2). `PendingTx` carries no box count, and the mix sibling is plural too. Is it worth a field?
- Bring every box back now's late state stacks three things above Stop:
  - "N sent. Waiting for the chain to confirm.";
  - "Keep Seedelf Wallet unlocked…";
  - the two-sentence late line.

  Is that within "one short line beside a button"? It reuses the old `why` slot, so the shape isn't new.
- The swap form keeps the reserve out of `adaShort` (sc-o-1's call 1). A balance short of it is then funded without the collateral's mix, and nothing says so on the form or the approval. That's the reserve fixer's call 4 too, so it isn't a finding here, but findings 2 and 3 make it more common.

## Checks

- **Read:**
  - the brief, FIXBRIEF, HANDOFF, file-owners, and the reports of sc-lj-1, sc-lj-2, sc-o-1, sc-o-2, bootstrap, max-left and wss-1;
  - the round 1 and 2 diffs (`git diff 499768f6`) of Lovejoin.tsx, LovejoinLaunch.tsx, BringAllBack.tsx, Settings.tsx, Swaps.tsx, DappApprovals.tsx, SiteSessions.tsx, swap.ts, SendButton.tsx, LovejoinReturn.tsx, Home.tsx, PendingBanner.tsx, Collateral.tsx, LockCountdown.tsx, Transfer.tsx, Withdraw.tsx and styles.css;
  - the worker paths those screens read: `funding()`, `collateralPool`/`collateralPoolShown`, `quote()`, `mixFunding`, `tailReserve`/`orWithoutReserve`, `bringAllBackNow`/`bringingView`, `pending-tx`, `atStake`, `pending.ts` settleNow, and the WASM's `chain_from_account_at`.
- **Throwaway tests:**
  - `zz-review-screens-states-1.test.ts`: real WebAssembly, the Mix form and the swap form, 4 cases;
  - `zz-review-screens-states-2.test.ts`: renders, 2 cases;
  - `zz-review-screens-states-3.test.ts`: real WebAssembly, the public token-pool cap;
  - first as reproductions (all passing), then with the right behaviour asserted: 6 failures, each quoted above. All three files are deleted.
- **Not run:** e2e, any build, mutation copies (no fix was proposed in code), and es/ja wording (L5).
- **Confirmed sound** (no finding):
  - AgainSwitch/widthTurned: the switch always shows the built width, and a failed rebuild leaves the review, Send's build and the page's width.
  - SendButton's Building…/Sending… on Start swap, the session's and the site's returns, and Start mix.
  - The CBOR retry's live region.
  - BringAllBack's waits, late, Stop, Done and donePool, and bringFollower's press bookkeeping (L2 aside).
  - The hub's StartedPools.
  - LaunchStartedBefore.
  - The launch amount guard.
  - PendingBanner's Bootstrap titles.
  - Collateral `lookAgain` and Home `unwatched` against pending.ts's watch rules.
  - LockStops and the Remove wallet line.
  - MaxLeftNote.
  - PrivateReview's and AgainReview's reserve rows.
  - The swap and site totals with the collateral's mix.
