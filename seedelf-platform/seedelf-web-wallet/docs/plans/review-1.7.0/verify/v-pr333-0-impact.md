# v-pr333-0-impact: the Bootstrap form's fixed 2 ₳ room at a dearer byte

**Verdict:** confirmed, but latent. Every number in the finding reproduces on HEAD with the real WebAssembly. The scenario needs `coins_per_utxo_size` at or above about 5,210 lovelace a byte. Both networks are at 4,310 today, the figure the PR itself calls "today", so no user meets it until a governance change raises the byte's price by more than 21 %.

**Severity:** low. Nothing is lost, locked or signed. The Review refusal is true and in the user's words, and one box fewer goes. This is the class 1.6.0's review rated low (323-worker#0). It also leaves a misleading code comment (`lovejoin.ts:2963-2964`). Not a release blocker.

**Confidence:** high (measured).

## What reproduces

Scratch test `extension/tests/zz-review-v-pr333-0-impact-1.test.ts`, run alone on HEAD, then deleted. The copy is at `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/review/v-pr333-0-impact/zz-review-v-pr333-0-impact-1.test.ts`.

- **Setup:** `testBalances({ owned: false })`, and the private balance as k UTxOs of the wallet's own registers. The contract cache is cleared before each try.
- **The worker side:** `mixOutBuild("preprod", 30, { bootstrap: true })`, classic pool.
- **The form side:** `bootstrapLimits` with the worker's own `privateBootstrapBounds`.
- **Method:** bisection to about 0.007 ₳ for the least balance that funds.

**One UTxO, by price of a byte:**

| Price | `back` | Form calls enough from | Funding goes from | Funding − form |
|---|---|---|---|---|
| 4,310 | 1.5 ₳ | 305.000 ₳ | 304.702 ₳ | −0.298 (the form is stricter) |
| 5,200 | 1.5 ₳ | 305.000 ₳ | 305.000 ₳ | 0 |
| 5,300 | 1.5 ₳ | 305.000 ₳ | 305.031 ₳ | +0.031 |
| 5,500 | 1.5 ₳ | 305.000 ₳ | 305.102 ₳ | +0.102 |
| 5,700 | 1.6 ₳ | 305.100 ₳ | 305.273 ₳ | +0.173 |
| 6,465 | 1.8 ₳ | 305.300 ₳ | 305.728 ₳ | **+0.428** |

- **The fee doesn't follow the price.** The measured fee is 0.230260 ₳ at every price. The change's least is 338 bytes × the price: 1,456,780 at 4,310 and 2,185,170 at 6,465. Both match the finding.
- **The finding's three balances at 6,465:**
  - 305.3 ₳: the form says not short, and the funding is refused ("Not enough ADA in your private balance for this, its fee and the change.").
  - 305.7 ₳: the same.
  - 306.0 ₳: it funds.
- **`lovejoin-release-rules.test.ts:506`** asserts 305.3 ₳ is not short at 6,465 (`needs + 300_000n`, `dear`). That is a balance the funding refuses at that price.

## Reachability

- **Not at today's parameters.**
  - `back` is 1.5 ₳ at 4,310, so the form's sum is unchanged from 1.6.0's.
  - The gap opens only past about 5,210 lovelace a byte.
  - `utxoCostPerByte` changes only by a ratified governance action, announced epochs ahead.
  - I didn't query Koios. The repository's own October figures (the PR's table "4,310 (today)", `FEE_ROOM`'s comment, core's docs) give 4,310 for both networks.
- **What a user would see once it is reachable:**
  - The Bootstrap button is enabled (`Lovejoin.tsx:3404` disables only on `bootstrapShort`).
  - Pressing it gives the worker's `NotEnoughPrivate` from `mixOutBuild`.
  - No money moves and no fee is paid. A count one box lower goes.
  - At the highest count the form allows, the balance sits anywhere in a 10 ₳ step, so about 4 % of such balances fall in the 0.43 ₳ window at 6,465.
- **The same outcome is live today through the fee's input count.** This is pre-existing, from 1.6.0's `FEE_ROOM` (e43eef7f, an ancestor of babb8e76), not #333.
  - Near the boundary, the funding spends every UTxO the private balance holds.
  - Each input adds about 0.036 ₳ measured, and more under the guessed budgets that input picking uses.
  - Measured at 4,310, with the form at 305.000 ₳:

    | UTxOs | Funding goes from | Fee | Funding − form |
    |---|---|---|---|
    | 2 | 304.746 ₳ | 0.266 ₳ | −0.254 |
    | 3 | 304.793 ₳ | 0.303 ₳ | −0.207 |
    | 5 | 304.881 ₳ | 0.375 ₳ | −0.119 |
    | 8 | 305.021 ₳ | 0.483 ₳ | +0.021 |
    | 12 | 305.203 ₳ | 0.628 ₳ | +0.203 |
    | 16 | 305.385 ₳ | 0.768 ₳ | +0.385 |
    | 20 | 305.566 ₳ | 0.917 ₳ | **+0.566** |

  - A Lovejoin user's private balance is often many UTxOs, since boxes come back one each. Today's input-count gap is therefore more reachable, and at 20 UTxOs larger, than the dearer-byte gap this finding names.
- **The reverse is live today too, and pre-existing.** With one to five UTxOs, the form calls a balance short that the funding takes: by up to 0.30 ₳ with one UTxO. The button is disabled there.
  - That is a refusal past the ledger, by owner rule 1.
  - It was 1.6.0's accepted trade: `FEE_ROOM` 2 ₳ "with room for a dearer byte", so that Review isn't refused after Bootstrap is pressed.
  - It matters for which allowance a fix picks.

## The fix

**The direction is right.** Pricing the change's least from the parameters makes the form follow the byte. It is not a new guard: the `short` gate exists since MONEY-6, and this only moves its figure. It adds no read (the bounds already read `epoch_params`), no string and no privacy change.

As proposed, though, it needs corrections:

1. **It isn't small.** No WebAssembly export gives a Seedelf output's least on its own: `pkg/seedelf_wasm.d.ts` has `lovejoinBootstrapReserve`, `lovejoinDirectCollateralReserve`, `lovejoinBoxValue` (a pool box's, a different output) and no other "minimum".
   - The fix needs a new export over `minimum_seedelf_payment(params, &Assets::new())`, or a changed one.
   - Either way it means a WebAssembly rebuild, the `.d.ts`, `wasm/README.md`, the node tests, the worker, the RPC type and the form.
   - Hard-coding 338 bytes in TypeScript would copy core's min-UTxO rule. Don't.
2. **It closes the price part only.** A fixed fee allowance still leaves the input-count gap above, which is live today: +0.2 to +0.57 ₳ at 12 to 20 UTxOs.
   - The form can't know which UTxOs the build picks. `FEE_ROOM`'s own comment ("The build decides exactly") and `boxesAffordable`'s ("keeps the stepper from offering what plainly can't be paid") are the honest frame.
   - "Matches what the funding takes, at any price" can't be made true by a static room.
3. **The allowance decides which way the form errs.** That is the owner's call, not a defect fix:
   - **`least + 0.543 ₳`:** exactly today's 2 ₳ at 4,310, so nothing changes today. The form then stays about 0.3 ₳ strict for one UTxO at every price. At 6,465 it asks 306.03 ₳ where the funding takes 305.73 ₳.
   - **One input's fee (about 0.25 ₳):** the form never blocks a balance a one-UTxO funding takes, which suits rule 1. It passes more multi-UTxO balances that Review then refuses in words: about 0.05 ₳ more for each UTxO past the first.
4. **The other rooms stay fixed.** The Mix stepper shares `FEE_ROOM` (`Lovejoin.tsx:279`, `:313`: `COLLATERAL + tail + FEE_ROOM`). `ui/swap.ts:114` has its own 2 ₳. Both have the same latent gap at a dearer byte. Fixing only `bootstrapLimits` leaves the forms counting the change differently.
5. **The tests move.**
   - Lines 505-506 flip: 305.3 ₳ becomes short at 6,465. With the 0.543 allowance, 306.03 ₳ is the new boundary.
   - Lines 497-500 (`needs` = 305 ₳ at 4,310) hold only with the 0.543 allowance.
   - The e2e is unaffected: its Bootstrap shortfall is 28 ₳ against 300 ₳ (`e2e/extension.spec.ts:3409-3411`).

**Minimal for 1.7.0: wording only.** No code, no WebAssembly, no strings.

- **`lovejoin.ts:2963-2964`**, `privateBootstrapBounds`' JSDoc from #333 (fe900cea). It says "so what the form says the balance must hold is what the funding takes at any price of a byte". It should say the way back's reserve follows the price, while the funding's own fee and change stay in the form's fixed room.
- **`Lovejoin.tsx:207`**, `FEE_ROOM`'s "with room for a dearer byte". That holds to about 5,200 lovelace a byte, and for a funding of up to about seven UTxOs at today's price.
- **The test's comment at `lovejoin-release-rules.test.ts:501-502`.** The comment should make line 506 read as the form counting `back` (which it does, and which the assertion pins correctly), not as the funding's figure.
- **The priced room** then goes on the post-release list as one item with the Mix stepper's and the swap form's rooms, with the allowance left to the owner.

## Attribution

- **`FEE_ROOM` 2 ₳:** e43eef7f (2026-10-25, 323-worker#0's fix), shipped in 1.6.0.
- **The pricing of `back` and the "at any price" claim:** #333 (b2c3940f; the JSDoc at fe900cea).
- **Later PRs:** no later PR in the range touches these lines. #338 is docs only.

## Not checked

- No Koios read of the live `epoch_params`.
- Token pools weren't run. Where the funding's change holds ADA alone, its least is the same. Where the UTxOs it spends hold other tokens, the change carries them, and its least, and so the gap, is larger.
- Vitest's mainnet-off build.
- Guessed and measured budgets are taken as the shipped module computes them. I didn't separate them beyond the thresholds above.
