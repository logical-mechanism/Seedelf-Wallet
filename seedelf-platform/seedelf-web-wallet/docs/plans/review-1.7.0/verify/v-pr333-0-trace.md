# v-pr333-0-trace: verifying pr333#0 (the Bootstrap form's fixed FEE_ROOM at a dearer byte)

**Verdict: confirmed. Severity: low.** Every figure in the finding reproduces on HEAD (`6bca8bec`). The form passes a balance that the funding then refuses, and the PR's line 506 asserts one such balance.

## The path traced on HEAD

1. **The form.** `PoolPage` asks `lovejoin-bootstrap-most`, which `handlers.ts` answers with `privateBootstrapBounds`. That returns `{ most, back }`, and `back` is `lovejoinBootstrapReserve(params)`: only the way back's reserve. `bootstrapLimits` then works out:
   - `Lovejoin.tsx:3662`: `const reserves = DEPOSIT_RESERVE + (back === undefined ? BOOTSTRAP_BACK_LEAST : BigInt(back));`
   - `Lovejoin.tsx:3663`: `const costs = BigInt(putting) * BigInt(pool.box.lovelace) + reserves + FEE_ROOM;`
   - `Lovejoin.tsx:211`: `const FEE_ROOM = 2_000_000n;`. The comment at 206-207 reads: "its network fee, about 0.25 ₳, and the least its change holds, a Seedelf output's, 1.46 ₳ at today's 4,310 lovelace a byte, with room for a dearer byte. The build decides exactly."
   - Nothing that reaches the form carries the price of a byte, so FEE_ROOM can't follow it.
2. **Pressing Bootstrap.** The button calls `lovejoin-mix-private-build` with `bootstrap: true` (`Lovejoin.tsx:2941-2946`), which runs `sessions.ts` `mixOutBuild`. With 30 boxes, both caps say 96, then:
   - `mixFunding` pays one output of `funding.lovelace + back`: 303.3 ₳ at 6,465 lovelace a byte.
   - `buildFunding` builds it with `inParts: false`, through `wasm.buildWithdraw`, then `sweep_many_apart`.
3. **The funding's change.** Input selection calls `spend.estimate()` with the guessed budgets (`build.rs:3440-3443`). A session funding skips the measured retry: `wasm/src/lib.rs:3565`, `if build::is_short(&short) && request.funding.is_none() && !request.carry`.
   - So the estimate's fee decides the change: about 0.24 ₳, a hair over the measured 0.230 ₳.
   - `stage` refuses any change between 0 and the Seedelf least: `build.rs`, `if change_lovelace < minimum_deposit(params, &change_tokens)? { bail!(SEEDELF_SHORT); }`.
   - The worker shows that refusal as `sess.notEnoughPrivate`: "Not enough ADA in your private balance for this, its fee and the change."

## The scratch test: `extension/tests/zz-review-v-pr333-0-trace-1.test.ts` (deleted)

The setup:
- A real wallet from `testBalances({ owned: false })`, holding nothing but the private UTxO(s) the test gives it, under the wallet's own register.
- Koios `epoch_params` overridden with `coins_per_utxo_size` (none means the fixture's 4,310).
- The form's verdict comes from `bootstrapLimits` with the balance as `BalanceService.get` reads it and the worker's own `privateBootstrapBounds`.
- The worker's verdict comes from `SessionService.mixOutBuild("preprod", 30, { bootstrap: true })` with the real WebAssembly.

**One UTxO, 30 classic boxes:**

| Price (lovelace a byte) | Private balance | Bounds | Form says short | Worker |
|---|---|---|---|---|
| 6,465 | 305.300000 ₳ | most 96, back 1.8 ₳ | **no** | **refused**: "Not enough ADA in your private balance for this, its fee and the change." |
| 6,465 | 305.700000 ₳ | same | no | refused |
| 6,465 | 305.716000 ₳ | same | no | refused |
| 6,465 | 306.000000 ₳ | same | no | funded: payment 303,300,000; fee 230,260; change 2,469,740; changeMinimum 2,185,170 |
| 4,310 | 305.000000 ₳ | most 96, back 1.5 ₳ | no | funded: payment 303,000,000; fee 230,260; change 1,769,740; changeMinimum 1,456,780 |
| 4,310 | 304.687100 ₳ | same | yes | refused (agrees) |

**Bisected to 1,000 lovelace:**
- At 6,465, the worker refuses 305.724875 ₳ and funds 305.725429 ₳. So the form passes balances from 305.3 ₳ up to about 305.725 ₳, a gap of about 0.425 ₳, that the funding refuses.
- At 4,310, the worker funds from about 304.697 ₳. The form, at 305 ₳, is conservative there.
- At the form's own 305 ₳ threshold (back is still 1.5 ₳ in this range), the worker funds at 5,207 lovelace a byte and refuses at **5,208**. The finding's "from about 5,200 up" is right.

**The property the PR claims, as a test:**
- The test: `expect(s.formShort).toBe(!s.worker.funded)` at 6,465 with 305.3 ₳.
- It **fails on HEAD**: the form says false, so not short, and the worker refuses.
- This is the balance `lovejoin-release-rules.test.ts:506` asserts is enough: `expect(bootstrapLimits(box, "private", ada(needs + 300_000n), 96, 30, dear).short).toBe(false);`, where `needs` is 305 ₳.

## What the finding gets slightly off (none of it changes the verdict)

- **Review never opens.** Pressing Bootstrap asks the worker to build Review, and that build is what's refused. The error shows on the page, the same gap MONEY-6 described.
- **The fee that decides is the selection's estimate,** about 0.24 ₳ with guessed budgets, not the measured 0.230 ₳. So the worker's real threshold at 6,465 is 305.7254 ₳, not about 305.715 ₳.
- **The gap isn't new in #333.** FEE_ROOM has been 2 ₳ since 1.6.0's 323-worker#0. Before #333 the same gap was there above 5,208, just as wide: 305 to 305.425 ₳ at 6,465. #333 left it as it was. What it did was write "at any price" into:
  - the PR body ("So what it says the balance must hold matches what the funding takes, at any price");
  - the new doc comment on `privateBootstrapBounds` (`lovejoin.ts:2963-2964`: "so what the form says the balance must hold is what the funding takes at any price of a byte");
  - the test at line 506.

## Severity: low

- **Not reachable today.** The fixture's preprod parameters, and mainnet, are at 4,310. It only appears once a parameter change takes the byte past 5,208.
- **No money moves.** It's a refused build with a clear message, and no stuck state. It brings back MONEY-6's "form passes, build refuses" gap, but only at a dearer byte.
- **The claim and the test are wrong.** The PR's claim and its test assert something that's false at the very price the PR tests.

## The same fixed room also misses at today's price when a funding spends several UTxOs

- At 4,310 I split the form's exact threshold, 305 ₳, over n private UTxOs. Each added input adds about 36,100 lovelace of measured fee:
  - n = 1, 2, 3, 4 and 6 fund. With 6 the fee is 410,954.
  - **n = 8 is refused** while the form says not short.
- So pricing the change's least alone won't make the form match "at any price". The fee half of FEE_ROOM depends on how many UTxOs the selection takes, and the form can't know that.
- This shows the finding is real and that the underlying cause is wider than the price of a byte. It doesn't narrow the finding.

## Corrections to the proposed fix

- **Price the change's least.** Return `minimum_seedelf_payment(params)` from `privateBootstrapBounds` with `back`, and use about 0.25 ₳ plus that in place of FEE_ROOM once it's known.
  - At 6,465 that's 305.735 ₳ against the worker's 305.725 ₳.
  - At 4,310 it's 304.707 ₳ against 304.697 ₳.
  - So it matches a one-UTxO funding at any price, within about 10k lovelace. It also stops the form refusing, at today's price, a balance from 304.70 to 305 ₳ that the build would fund. Today's fixed room does that, which leans against rule 1.
  - Don't raise FEE_ROOM instead: that refuses more of what the build takes.
- **Line 506.** At 6,465, 305.3 ₳ is short. 305.73 ₳ isn't (the bisected threshold is 305.7254 ₳), and 306 ₳ is a safe round figure.
- **Reword "at any price"** in the PR's doc comment (`lovejoin.ts:2963-2964`). Even with the change's least priced, a funding that spends several UTxOs pays more fee than any fixed allowance. "Leaves room for the fee and the change; the build decides exactly" is what FEE_ROOM's own comment already says.
- **The Mix stepper** uses the same fixed room: `Lovejoin.tsx:279`, `aside = COLLATERAL + FEE_ROOM`, and `:313`. That's older than #333 and outside it.

## Noticed while tracing (outside this finding: stale docs after #333)

- **`docs/flows.md:523`** still says "one deposit's most under today's fees (68 in the classic pool at 6,465 lovelace a byte, half as much again as today's)". After #333 it's 96 at 6,465: the PR's own tests and my run's bounds both give `most: 96`. The same line's "1.5 ₳ for returning the rest" is now "at least 1.5 ₳, priced".
- **`docs/architecture.md:672`** still says `lovejoinBootstrapMost` gives "one deposit's most under today's parameters, fewer at a dearer byte". After #333 it's one deposit's most at a dearer byte too.
