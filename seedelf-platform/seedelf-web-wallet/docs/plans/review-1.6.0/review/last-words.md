# Last words: round 3b's fix-ups, words, privacy and screens

Lens: every new or changed string (`git diff 56dce2cd -- '*.json'`) and every changed screen in round 3b's working tree. For each I asked four things:
- Is it true for the path that shows it?
- Is it short?
- Is it in a `.warn.`/`.privacy.` key where it warns or speaks of privacy?
- Does a figure match its review, and does a switch or button show a state that's so?

I also checked whether the new tests prove what they claim: the `vi.mock("react")` harness, and the 1.5.0 gate's normalization.

**Verdict:** no high or medium. Two low, two nit.

Every finding was made concrete with a throwaway test (`tests/zz-review-last-words-{1..4}.test.ts`). All four are deleted. Nothing tracked was edited.

## Findings

### 1. low: Stop's dialog, with no box, says everything comes back less one fee, then says the collateral is mixed (fx-reserve-1, L1)

`extension/src/ui/screens/Swaps.tsx:2866` (the `session-stop-what` note), `:2893` (L1's new line)

**Scenario:**
- A swap is stopped through Lovejoin while its spare pays no 10 ₳ box (`cost.boxes === 0`), or Lovejoin's pool is short (`cost.skipped`).
- stopCost sets `collateralMix`: the account holds the 5 ₳, Settings has the collateral go in, and the 5 ₳ pool isn't "no".
- That happens on a token→ADA swap, whose funded ADA is only its costs, and on a small ADA→token one.

**What the dialog says**, in this order:
- One of:
  - "If no order has gone out yet, none will, and everything comes back to your private balance, less the return's network fee." (`swaps.stop.notPlacedDirect`, or `notSwappedDirect`);
  - "The order is cancelled, unless it fills first, and everything comes back to your private balance. The cancel and the return each cost a network fee." (`cancelledDirect`).
- With `skipped`, also "…, so it would come back directly, tied to this session on chain."
- Then L1's line: "giveme.my backs its collateral's mix too, so it sees that mix. If that mix can't go, its 5 ₳ box waits unmixed, tied to this session."

**What the return does:** Stop goes as `onStop(false)`, so the return isn't direct. buildBack puts the 5 ₳ into the 5 ₳ pool.
- So "everything comes back … less the return's network fee" is false there.
- The 5 ₳ comes back hours later, in a box.
- The deposit, mix and box's way back cost about 1.2–1.5 ₳ more. That comes out of the reserve, or out of what's left.
- The approval said it rightly for the same session: "Too little spare ADA for a Lovejoin box, so all but its 5 ₳ collateral comes back at once." (`swaps.review.noBoxMixed`).
- The dialog never says it.
- The line's "too" also has nothing to refer to in this dialog: it came from the approval, beside GivemeNote.

**Evidence:** zz-review-last-words-1 rendered StopDialog with `{ boxes: 0, …, collateralMix: true }` for placed or not and pools or not, and with `skipped`. All 5 cases passed with:
- the "everything comes back…" note present;
- L1's line present;
- no "all but its 5 ₳ collateral".

For example, the text read:

> Stop this swap? If no order has gone out yet, none will, and everything comes back to your private balance, less the return's network fee. If one is being placed right now, it's cancelled unless it fills first. giveme.my backs its collateral's mix too, so it sees that mix. If that mix can't go, its 5 ₳ box waits unmixed, tied to this session. Keep going Stop the swap

**Partly pre-existing:**
- The note's words date from before #323. R3-9's skeptic (correction 2) put them with L1's Stop work.
- L1's fix added the line but left the note, so the dialog now contradicts itself.
- L1's test (approvals-review-fixes "Stop's dialog says the collateral is mixed…") pins the line, not the note.

**Suggested fix:** words only, no refusal. Where `cost?.collateralMix && !lovejoin`, and Stop isn't direct, say what the approval says:
- either `*Mixed` variants of the three direct notes ("…everything but its 5 ₳ collateral comes back…; that comes back later, mixed"), in three languages;
- or show `swaps.review.noBoxMixed` in place of the direct note's "everything".

Drop "too" from the line here, or give the Stop dialog its own one-line key.

### 2. low: Home's banner says "it" for one box while balances are hidden (fx-misc, the banner's count)

`extension/src/ui/components/PendingBanner.tsx:240`

**The house rule:** a count of boxes is an amount, so with balances hidden it takes the plural.
- `useAmounts().count` says so: "every Lovejoin box is 10 ₳, so the count says what's in the pool (privacy review §2.16)".
- BringAllBack.tsx:242, Lovejoin.tsx:1382 and Home.tsx:1561 use `amounts.hidden ? 2 : n`.
- MixList's test pins it: "Hidden, the count isn't shown, so neither is it said by the singular".

**The change:** fx-misc's `boxes = { count: pending.boxes ?? 2 }` never reads `hidden`. With Hide balances on:
- a one-box public mix's done banner says "In Lovejoin, on its way to your private balance";
- a one-box Bootstrap's says "In Lovejoin, held there until you bring it back".

Either tells an onlooker it was exactly one box: 10 ₳ in the classic pool. Before this round it was always plural.

**Evidence:** zz-review-last-words-3 rendered PendingBanner with `hideBalances: true` and `boxes: 1`. Expecting the plural failed:

```
expected 'In Lovejoin, on its way to your priva…' to contain 'on their way to your private balance'
```

The Bootstrap printed "In Lovejoin, held there until you bring it back".

**Suggested fix:**

```ts
const amounts = useAmounts();
const boxes = pending.kind === "lovejoin-mix" ? { count: amounts.hidden ? 2 : (pending.boxes ?? 2) } : undefined;
```

Add a hidden case to screens-nits' banner tests.

### 3. nit: the Mix form and its review disagree by 1.5 ₳ in a band about 0.3 ₳ wide (confirms fx-reserve-2's call 2, R3-7)

`extension/src/ui/screens/Lovejoin.tsx:356`

**Why:** mixOffer counts the reserve in the figures only where `mixMost(…, asked).adaMost >= boxes`. That keeps FEE_ROOM's 2 ₳ for the fee and the change's least. The build needs about 1.69 ₳ from one UTxO.

**Measured** with real WebAssembly, on the classic pool, one box, depth 1, and preprod's 5 ₳ pool with two strangers' boxes:
- The form counts the reserve from 20.95 ₳ held.
- `mixOutBuild` funds it from between 20.60 and 20.65 ₳.
- Between those balances:
  - **the form:** no reserve row, "Total leaving" 17.70 ₳, and "At this many, its 5 ₳ collateral is mixed only if enough is left when it comes back.";
  - **the review:** "For its collateral's mix 1.5 ₳", and 19.18 ₳ leaving (1.483 ₳ more).

**Evidence:** zz-review-last-words-2 copied the R3-7 test's helpers, probed held = paid − {0.05 … 0.6} ₳, and printed:
- `paid-300000: form tail=0 tailShort=true formLeaving=17700000 | worker reserve=1500000 leaving=19183208`;
- `paid-350000: … worker reserve=undefined`.

fx-reserve-2's test checks only the two boundaries, not the band between them.

**Suggested fix:** the owner's call, now measured.
- **Accept it:** the review is right and the form errs safe.
- **Narrow it:** decide the figures' `tail` with the one-UTxO fee plus the change's least (about 1.7 ₳) rather than FEE_ROOM. That narrows the band, at the cost of a thin opposite band for a balance spread over many UTxOs.

No refusal either way.

### 4. nit: in a token pool, the held figure beside the stepper follows the count and understates what the stepper offers (fx-reserve-2, R3-14; label fx-misc, R3-27)

`extension/src/ui/screens/Lovejoin.tsx:2742` (figure), `:608` (label)

**The behaviour:** `publicSideOf(cardano, accountUtxos, token, boxes)` is the chain's pick at the stepper's count. Its label (tooltip and screen reader) says "What Lovejoin can spend from your public account".

**fx-reserve-2's own "richer" account:** 6.2 ₳ alone; 1.2 ₳ with 200 TOK; 10 ₳ with 100 TOK.
- At 1 box the figure reads 6.24 ₳, and 7.4 ₳ at 2.
- The stepper offers 3 boxes, whose funding is 10.35 ₳.
- At 3 the figure jumps to 17.4 ₳.
- So the amount shown as what can go in grows as the user presses +, and sits below what the offered count costs.

**Evidence:** zz-review-last-words-4 printed `{boxes:1, held:'6240610', most:3, costOfMost:'10350000'}`, `{boxes:2, held:'7400000'}` and `{boxes:3, held:'17400000'}`. The cap and the build are right: the cap note shows only at the cap, where the figure agrees.

**Suggested fix:** show the figure at `Math.max(boxes, most)`, or at `most || 1`, so it's what the stepper offers. Keep the cap count by count. No new words.

## Questions (not made concrete)

- **The escape hatch's named public note:** "…anyone can tie {{active}} to the box, to {{account}}, whose box it is…".
  - The hatch takes only mixed boxes, so the named account's box is always a finished leaf.
  - The words follow `otherAccounts`' model (rpc.ts: another account paying ties the two).
  - privacy.md:210's PRIV-3 says a finished leaf ties no account.
  - That's privacy-words' open question 3 (QUESTIONS.md), still the owner's. Not re-reported.
- **ja `settings.lovejoin.bringLate`:** its third sentence ("停止すると、そのボックスの待ち時間のあとに送ります。") stands on its own. It doesn't syntactically keep the English "if a node dropped it". It's a non-critical machine draft, and no native reader checked it.

## Checks

**Strings:**
- **Every new or changed key** exists in en, es and ja with matching placeholders and provenance entries. Removed keys are gone from all five files: `privateAccounts`, and the two unplural `pending.confirmed.lovejoin_*`.
  - **New:** collateral.payAgain, collateral.warn.bothLand, lovejoin.mix.cantAffordPublicHolds, lovejoin.mix.inPublicSpendable, lovejoin.review.bootstrapNotePrivate, lovejoin.mix.privacy.collateralIfLeft, lovejoin.stuck.privacy.privateNamed, pending.confirmed.lovejoin_bootstrap_*/lovejoin_mix_*, settings.lovejoin.bringStoppedSent_*, swaps.maxNoteMaybe.
  - **Changed:** lovejoin.stuck.privacy.publicNamed, settings.lovejoin.bringLate, settings.lovejoin.collateralOn, swaps.maxNote, swaps.maxNoteMixed.
- **The critical set:** `node scripts/i18n-critical.mjs` (print only) adds collateral.warn.bothLand, lovejoin.mix.privacy.collateralIfLeft and lovejoin.stuck.privacy.privateNamed, and drops privateAccounts. That's what the fixers said.
  - No verified-critical entry's value changed (R3-22's class).
  - publicNamed was never verified.
  - Every warning or privacy line this round carries `.warn.`/`.privacy.`. Stop's reuse of `swaps.review.privacy.collateralMix` is critical by name.
- **Read against the paths that show them:**
  - **bothLand:** coin-control, and the collateral-again test: both landing, the newer is set and the first is spendable.
  - **Others:**
    - bringLate ("or after its own wait if you stop": w-left's due-time test);
    - bringStoppedSent;
    - collateralOn;
    - maxNote, maxNoteMixed and maxNoteMaybe;
    - bootstrapNotePrivate;
    - collateralIfLeft (hedged, and true: with_return still tries the tail);
    - privateNamed, against withdrawOne's new payer order;
    - publicNamed.
  - **Hidden balances:** bringStoppedSent uses `boxes()`, which honours them.
- **Short:** the late state is now the count line, one two-sentence note, and Stop. privateNamed is long, but it's fx-lj-1's call 6, and it replaces two notes.

**Screens:**
- **SwapApproval (R3-9):**
  - `collateralMixed = reserve || (pool && adaOut)`; the cost row stays on the reserve.
  - The switch turned off rebuilds with no reserve and no `collateralPool`, since tailReserve(…, false) is 0.
  - `tailUnpaid` keeps both off for a direct pools return.
  - "Comes back" is high by the mix's cost where it's mixed without the reserve: fx-reserve-1's disclosed call 2.
- **FundingWayBack and TopUpCollateralNote:** required `summary`. `collateralPool` can't be set while `lovejoinBack` is false, since both follow the returns setting.
- **NewSwap's follow-down (R3-12):**
  - It only goes down, so it converges.
  - flip, choose and Half all clear `maxed` through setTyped.
  - The effect uses setAmount, so `maxed` stays set.
- **BringAllBack (L2):** I traced every read and press path. The mark is cleared on each new ask. A self-stopped run gets no mark. The pressing page's `halted` clears on the next read.
- **Collateral's WaitingFoot:**
  - Home's `blocked` lifts at HOLD_MS (10 min), when `late` starts, so the button is live from Home.
  - On Settings it's never blocked.
- **hatchAccountOf against hatchOrder:** the same set and order, bar reservations (fx-lj-1's call 3).
- **tailReserveOf:** 0 on the public side, so CollateralIfLeft can't show there.
- **`PendingTx.boxes`:** it survives pending.ts' `shown()`.

**Tests:**
- **The harness:**
  - Its render-phase updates land only for the component rendering.
  - `on` acts in the parent's render, so a press reaches its handler.
  - A moved seed throws, never passes quietly.
  - Each screens-wiring case asserts what its mutation flips. Its negative assertions sit beside a positive one, so none passes vacuously.
- **The gate's `classicCalls`:**
  - It drops only:
    - the shown pools' boxes from pool reads;
    - the return step's first pool read;
    - the status step's first `epoch_params`.
  - Everything else is compared exactly.
  - The step labels it keys on fail loudly if they're renamed.
- **`nearly()`:** paths start `.returns[`, which matches the plans object.

**Runs:**
- **The lens's files:** screens-wiring, screens-nits, approvals, collateral-again, lovejoin-accounts, lovejoin-bring-screen, dapp-prompt, settings, words, privacy-notes, i18n, i18n-critical-helpers and i18n-worker-reasons. Of 261 tests, 258 passed; the 3 failures are i18n.test.ts' critical-set gate (`--write` and L5), as expected.
- **Not run (the brief):** e2e, builds, `--write`, cargo.
- **Throwaway tests:** zz-review-last-words-1..4, all deleted. No copy was needed.
