# Bootstrap lane: #333's priced way back for a private Bootstrap

I worked in `W` = `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-wt/release-1.7.0`, on branch `web-wallet/release-1.7.0-fixes`.
- All edits are small, anchored edits to my lane's files. No locale, provenance or e2e file was touched.
- Mutation checks and reproductions ran in a copy outside the tree, with its own `CARGO_TARGET_DIR`. The copy is deleted.

## Outcomes

| id | outcome | test (fails before or under the mutant, passes now) | files |
|---|---|---|---|
| pr333#0 | partly: words fixed; the priced room is an owner's call | none committed (wording only). Reproduced in the copy, see below | `extension/src/background/lovejoin.ts`, `extension/src/ui/screens/Lovejoin.tsx`, `extension/tests/lovejoin-release-rules.test.ts` |
| pr333#1 | fixed (test added) | `extension/tests/screens-wiring-review-fixes.test.ts` › "holds the Bootstrap form from the private balance to the way back's reserve the worker priced, never the 1.5 ₳ that stands in (1.7.0's release review, pr333#1)" | that file |
| x-mut-ts#4 | fixed (test added) | `extension/tests/lovejoin-flows.test.ts` › "caps a Bootstrap from the private balance at what its funding pays…": new `handle({ type: "lovejoin-bootstrap-most" })` assertion | that file |
| pr333#5 | not-a-bug | none: no change | none |
| x-mut-rs#0 | fixed (test added) | `seedelf-core/tests/lovejoin_pools_test.rs` › `the_most_a_private_bootstrap_puts_in_is_the_most_that_builds` (new) | that file |
| x-mut-rs#1 | fixed (test added) | `seedelf-core/tests/lovejoin_pools_test.rs` › `a_private_bootstrap_is_held_to_what_its_funding_pays_its_deposit_and_way_back_for` (new dearer-fee row) | that file |
| x-mut-rs#3 | fixed (node test added) | `wasm/tests/lovejoin-reserve.test.mjs` › "a private Bootstrap's way back is priced from the parameters (1.7.0's release review, x-mut-rs#3)" | that file |
| x-mut-rs#4 | fixed | `wasm/tests/lovejoin_test.rs` › `a_bootstrap_with_no_collateral_deposits_and_sweeps_back`, `wasm/tests/lovejoin_flows_test.rs` › `a_private_bootstrap_of_a_token_pool_deposits_and_sweeps_back` | those two files |
| pr333#4 | fixed | `seedelf-core/tests/lovejoin_pools_test.rs` › `a_private_bootstrap_is_held_…` (dear token case) | that file, `seedelf-core/src/lovejoin/mod.rs` (doc), `extension/tests/lovejoin-flows.test.ts` (comment) |
| pr333#3 | owner-call | none: not built | none |

The paths in the table start at `seedelf-platform/` for Rust and at `seedelf-platform/seedelf-web-wallet/` for `extension/` and `wasm/`.

## Each finding

### pr333#0: the form's fixed 2 ₳ FEE_ROOM: words fixed; the priced room is the owner's call

**Reproduced** with a scratch Vitest in the copy: 30 classic boxes, real WebAssembly, the whole private balance in one UTxO.
- **At 6,465 lovelace a byte:** for 305.3 ₳ and for 305.7 ₳ the form says "not short", and the funding refuses: "Not enough ADA in your private balance for this, its fee and the change." 306 ₳ funds (303.3 ₳ paid).
- **At 4,310:** the form and the funding agree (305 ₳ funds).
- **The same gap today, by UTxO count:** at 4,310, 305 ₳ spread over 1 to 7 UTxOs funds, but over 8 or 12 UTxOs it's refused while the form says not short. This was there before #333 (1.6.0's FEE_ROOM).

**What I changed: the words only.**
- **`lovejoin.ts` `privateBootstrapBounds`' JSDoc.** It said the form's figure "is what the funding takes at any price of a byte". It now says the figure counts the priced reserve at any price, and that the room for the funding's fee and change is the form's own fixed one (FEE_ROOM), so the build decides exactly.
- **`Lovejoin.tsx` FEE_ROOM's comment.** "with room for a dearer byte" is replaced: it's fixed, so from about 5,200 lovelace a byte, or for a funding that spends many UTxOs, it can hold too little, and the build refuses that in words.
- **`lovejoin-release-rules.test.ts`:** a comment above line 506. The assertion stays, because it rightly pins that the form counts `back`. The comment says the form counts those 0.3 ₳ and no more, and that the build may still refuse what passes there.

**Why not the behaviour now:**
- Pricing the room needs a new WebAssembly export for a Seedelf output's least: none exists today. Adding one means a README row (`readme_test` enforces it) and the lead's rebuild.
- Until that rebuild, the worker's call to the export would break `npm run typecheck` (`typeof wasm` comes from `pkg`) and every Vitest that reaches `privateBootstrapBounds`, for every lane in this shared tree.
- The fee allowance is a product choice: see the owner's call below.
- The gap is latent. It needs `utxoCostPerByte` to rise by more than 21 %, and no money moves when it does.
- Both verifiers recommended the words for this gate.

### pr333#1: no test of the page passing the worker's `back` (fixed: test added)

**The test.** It goes in the file whose `vi.mock("react")` seam runs PoolPage's effects:
- the pool is below its floor (3 others of 30), so the form leads at 27 boxes;
- the private balance is 275 ₳;
- `lovejoin-bootstrap-most` answers `{ most: 96, back }`.

With `back` at "1500000", `lovejoin-bootstrap-why` is absent and Bootstrap is enabled. With "1800000", the why shows and Bootstrap is disabled. It also checks the request's payload (`[{}]`).

**Mutation runs in the copy.** Each ran over the 7 test files that reach the bounds, the pool page or `bootstrapLimits` (155 tests).
- **Mutant B, the effect stops storing `back`:** tsc is clean, and only this test fails.
- **Mutant C, line 3115 stops passing `back`:** tsc fails with TS6133 (as the trace verifier said), and this test fails too.
- **The clean copy:** 155 of 155 pass.

### x-mut-ts#4: nothing holds the handler's answer to carry `back` (fixed: test added)

**Reproduced.** Mutant A puts the case back to 1.6.0's form, `privateBootstrapMost(...).then((most) => ({ most }))`. With it, tsc passes (exit 0) and HEAD's other 154 tests pass. That confirms the claim: `handle()`'s type is the union of every request's result.

**The test.** In the existing cap test, at 6,465, I added:
`expect(await handle({ type: "lovejoin-bootstrap-most" }, ctx)).toEqual({ most: 96, back: "1800000" })`.
It fails under mutant A and passes on HEAD. `handle` and `Context` are now imported in `lovejoin-flows.test.ts`. The page half of this finding is pr333#1's test.

### pr333#5: the 1.5 ₳ stand-in until the bounds answer (not-a-bug)

The finding is accurate, and it says itself that no fix is needed.
- The stand-in is optimistic only until the worker answers, or when the read fails. Review then decides in words, with no money moving.
- Refusing more would go against "refuse only what the ledger refuses".
- The stand-in is already pinned: `lovejoin-release-rules.test.ts` lines 495-496, with no `back` given.

### x-mut-rs#0: no test where `bootstrap_most`'s search binds (fixed: test added)

**Reproduced** in the copy with env-switched mutants. Under M_RETURN_MOST, R_FEES_FIXED and R_DEPOSIT_FIXED, these all pass:
- all 43 tests in `lovejoin_pools_test.rs` and `lovejoin_planner_test.rs`;
- seedelf-wasm's 3 Bootstrap tests.

**The new test** `the_most_a_private_bootstrap_puts_in_is_the_most_that_builds`:
- **Asked 200 at today's parameters:** the cap is 107, inside 96..200. That many builds; 108 doesn't (the transaction's size).
- **At `min_fee_a` 1,000 / `min_fee_b` 2 ₳, asked 96:** the cap is 51, inside 1..96. 51 builds; 52 doesn't (the wallet's 10 ₳ fee limit).
- **Under the mutants:** it fails under M_RETURN_MOST (200), and under R_FEES_FIXED and R_DEPOSIT_FIXED (the fee case gives 0). It passes on HEAD.

### x-mut-rs#1: the reserve never tested with other fees (fixed: test added)

The new row has `min_fee_a` × 3/2 beside the dearer byte. It asserts:
- the reserve is 2,200,000;
- the dearer byte's 1.8 ₳ can't pay 96 boxes there;
- the cap is still 96, and that many builds.

It fails under R_FEES_FIXED and R_DEPOSIT_FIXED (`left: 1800000`) and passes on HEAD.

### x-mut-rs#3: `lovejoinBootstrapReserve` had no WebAssembly-level test (fixed: node test added)

**The gap.** No node test and no Rust test called the binding (checked with grep).

**The new test** asserts three things:
- "1500000" at the fixture;
- "1800000" at `coins_per_utxo_size` "6465";
- `assert.throws` for `"{}"`.

**Runs.** It passes on today's `wasm/pkg`, since the binding has existed since #333 and I made no Rust change to it: `node --test wasm/tests/lovejoin-reserve.test.mjs`, 2 of 2 pass. Building the WebAssembly isn't allowed here, so W_SWALLOW was simulated by wrapping the real export in JS to answer "1500000" for a row it can't read. Under that wrapper the throws line fails ("Missing expected exception").

### x-mut-rs#4: the WebAssembly Bootstrap tests funded the fixed 1.5 ₳ (fixed)

All three places now fund `seedelf_core::lovejoin::bootstrap_back_reserve(&ProtocolParameters::from_koios(&params()))`, the worker's figure:
- `lovejoin_flows_test.rs` gets a `back_reserve()` helper, used twice;
- `lovejoin_test.rs` gets a `back_reserve` local.

**Reproduced** with the fixture row moved to 6,465 in the copy. HEAD's versions fail on their own under-funding:
- "96 boxes, funded 963000000: A Seedelf deposit of these tokens needs at least 2.185170 ADA";
- the token pool's 64, funded 131000000, likewise.

The fixed versions pass there (963.3 ₳ and 131.3 ₳, as the worker funds) and at the fixture.

### pr333#4: the dear token-pool case used LJTEST's 2 ₳ pool, which the ledger refuses there (fixed)

**The test** now asserts `usable(&dear, &lj)` is `BelowMinimum`. The dear token case runs on `Protocol { denom: 4_500_000, ..lj_pool() }`, which is usable at 6,465, and asserts:
- a fixed 1.5 ₳ can't pay its 64;
- the cap is 64, and its deposit and sweep build.

**The words:**
- **core's doc on `bootstrap_back_reserve`:** "51 in a token pool", and LJTEST's own pool takes no new box at 6,465;
- **the core test's comment:** "51 in a token pool";
- **`lovejoin-flows.test.ts`:** the pointer comment now says core's token case has boxes that hold their least there.

### pr333#3: a marked Bootstrap built after a price rise comes back with no box in (owner-call, not built)

The code path is confirmed by reading:
- `sessions.ts:4451`'s one-box-fewer branch skips any record with `mix.noCollateral`;
- a chain that fails comes back directly, with `sess.skip.warn.chainFailed` wrapping core's raw message;
- the chain does fail at 96 boxes funded on 1.5 ₳ at 6,465: the x-mut-rs#4 reproduction above shows it, with core's "a Seedelf deposit of these tokens needs at least 2.185170 ADA".

## Checks run in the tree

| Command | Result |
|---|---|
| `cargo test --locked -p seedelf-core --test lovejoin_pools_test` | 32 passed |
| `cargo test --locked -p seedelf-wasm --test lovejoin_test --test lovejoin_flows_test` | 23 and 14 passed |
| `cargo fmt -p seedelf-core`, `-p seedelf-wasm` | clean (fmt reformatted only my test file) |
| `cargo clippy --locked -p seedelf-wasm --all-targets -- -D warnings` | clean |
| `node --test wasm/tests/lovejoin-reserve.test.mjs` | 2 passed |
| Vitest: `lovejoin-flows`, `lovejoin-release-rules`, `screens-wiring-review-fixes` | 89 passed |
| Vitest: `lovejoin-held-balance`, `lovejoin-merged-screens`, `lovejoin-screens-review`, `lovejoin-session5-screens`, `lovejoin-release-rules`, `screens-wiring-review-fixes` | 131 passed |
| `npm run typecheck`, mid-session | clean, with all my changes in |
| `npm run typecheck`, last run | fails, but only outside my files (below) |

The last typecheck's errors are in `sw.ts`, `lovejoin-crediting-review-fixes.test.ts`, `lovejoin-discovery-review-fixes.test.ts`, `lovejoin-pools-head-start.test.ts` and `lovejoin-screens-review.test.ts`. `DiscoveryDeps` now requires `wallet`: that's another lane's change, still in progress, in `lovejoin-pools.ts`.

## Strings, critical keys, e2e and WebAssembly node tests

- **Strings added or changed:** none.
- **Critical keys changed:** none.
- **e2e specs edited:** none.
- **WebAssembly node tests added:** one test in `wasm/tests/lovejoin-reserve.test.mjs`. It runs against today's `pkg` and passes: it needs no rebuild, though the rebuild won't change it.
- **Privacy:** no data-handling change, so no privacy-policy entry.

## For the docs lanes

- **`docs/flows.md:523`:**
  - "1.5 ₳ for returning the rest" is priced from the parameters since #333: 1.5 ₳ today, 1.8 ₳ at 6,465.
  - "(68 in the classic pool at 6,465 lovelace a byte, half as much again as today's)" is stale: one deposit's most goes there too since #333.
- **`docs/architecture.md:673`:** "one deposit's most under today's parameters, fewer at a dearer byte" is stale. A dearer byte keeps one deposit's most. Fewer only where a deposit's fee would pass the wallet's 10 ₳ limit (51 at `min_fee_b` 2 ₳). The new core test pins that.
- **Any doc saying the Bootstrap form's figure matches the funding:** it counts the worker's priced `back`, but its room for the funding's fee and change is a fixed 2 ₳ (FEE_ROOM). From about 5,200 lovelace a byte (one UTxO), or from 8 private UTxOs at today's 4,310 (30 boxes), the form can pass a balance the funding then refuses in words. I found no doc claiming the match. #333's PR body did.
- **`docs/post-release-roadmap.md:378`:**
  - "51 of LJTEST" is a count no wallet can reach: LJTEST's 2 ₳ pool takes no new box at 6,465. "51 in a token pool" is right.
  - The post-release list could take the two owner's calls below.
- The archive (`docs/archive/plans/chunk-34-token-pools.md:970`) is history: leave it.

## Owner's calls

1. **pr333#0, the priced room.** Recommended, after 1.7.0, together with the Mix stepper's shared FEE_ROOM and `ui/swap.ts`'s own 2 ₳ room:
   - price the Bootstrap form's room from the parameters, as the change's Seedelf least (from a new WebAssembly export) plus a fixed fee allowance;
   - an allowance of 0.543 ₳ makes it exactly today's 2 ₳ at 4,310;
   - the UTxO-count part stays the build's to decide.
2. **pr333#3, a marked Bootstrap built after a price rise.** Recommended:
   - extend `sessions.ts`'s one-box-fewer rule to marked (`noCollateral`) Bootstraps whose paid funding is short of `funding(boxes) + lovejoinBootstrapReserve(params)` under the chain's parameters, so it goes in one box short instead of coming back with no box and a second fee;
   - say a direct return's reason in the wallet's words, not core's "of these tokens".
