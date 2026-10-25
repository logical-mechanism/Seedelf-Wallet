# Fixer `reserve`: the collateral's mix reserve (the tail)

Lane R, after `max-left`. Findings 323-rust#1 and 323-worker#0, plus the worker half of the screens round's 320-screens#2 and 321-lj-screens#3. Rust and TypeScript both. **The TypeScript half calls a new WebAssembly export, so `npm run typecheck` and three tests wait for the lead's rebuild** (listed under the notes). Everything else passes on today's pkg.

## What I measured first

I used the wasm crate's `api::session_return` and `lovejoin::chain`, with preprod's parameters, the test 5 ₳ pool and two strangers' boxes. Temporary tests, deleted.

- **A return back directly, nothing beside the collateral:** the tail builds from 2,663,085 lovelace of ADA alone at 4,310 lovelace a byte, and from 3,391,601 at 6,465. That is exactly the deposit (175,357) + the mix (830,646) + the sweep's first draft (0.2 ₳, `build::settle`) + the Seedelf output's least (1,456,780).
- **The same, beside a 2 ₳ token UTxO** (a swap's fill, which carries the sweep's least): 2,154,296 at 4,310, and 2,643,554 at 6,465. Here the binding limit is the mix's 1 ₳ draft plus its change's least.
- **On a chain** (one 10 ₳ box at depth 1, funded `funding_for` + 1.5 ₳, `collateralReserve` set): the tail builds with 0.293 ₳ less than funded. So 1.5 ₳ holds on a chain.

## Findings

| id | status | change |
|---|---|---|
| 323-rust#1 | fixed (owner call on the amount) | Core `lovejoin::direct_tail_reserve(params)` prices what a return back directly needs, from the parameters, rounded up to 0.1 ₳: 2.8 ₳ at 4,310, 3.6 ₳ at 6,465. WebAssembly `lovejoinDirectCollateralReserve(paramsJson)` exports it. `COLLATERAL_TAIL_RESERVE`'s doc is corrected. A site's funding and a top-up that pays a new collateral take the direct figure. A mix and a swap keep 1.5 ₳ (the split, below). |
| 323-worker#0 | fixed (the forms' half is the screens round's) | `SessionService.orWithoutReserve`: in `outBuild`, `siteOutBuild`, `mixFunding` and `topUpBuild`, a funding refused with `NotEnoughPrivate` is built again with no reserve: no `tailReserved`, no `collateralReserve` on the summary or the record. A swap leaves the reserve out before its token's boxes. A private Bootstrap's own reserve (`fixes/bootstrap.md`) is never left out. |
| 320-screens#2, 321-lj-screens#3 (worker half) | done for the screens round | `lovejoin-funding` (`LovejoinService.funding`) returns `collateralReserve` and `collateralPool` where a mix from the private balance would add the reserve. The screens still have to count it. |

### 323-rust#1: the sizing and the split

- **The formula.** The deposit (500 bytes priced) + max(the mix's 1 ₳ draft + its change's least, `MIX_FEE_ESTIMATE` + max(0.2 ₳ first draft, the sweep's size fee) + the Seedelf least).
  - The leasts come from the parameters, so the figure follows the price of a byte.
  - The mix is planned on `MIX_FEE_ESTIMATE` (0.95 ₳, against 0.83 ₳ measured), as chains plan it. That and the rounding leave it 0.137 ₳ over the least that builds at 4,310.
- **The split, from the measurements: swaps keep 1.5 ₳.**
  - A swap's funding carries `SWAP_MARGIN` (2 ₳). What's left of it after the order's fee (0.2–0.4 ₳) comes back as ADA beside the reserve, and the fill carries the sweep's least.
  - So 1.5 + 2 − 0.4 = 3.1 ₳ meets the 2.15 ₳ needed at 4,310, and the 2.64 ₳ needed at 6,465. The wasm test proves both.
  - Sizing swaps at 2.8 ₳ would ask 1.3 ₳ more of every swap, for nothing in the cases measured. `SWAP_MARGIN`'s doc now names this dependence.
  - Mixes keep 1.5 ₳: the chain's `DEPOSIT_RESERVE` covers the sweep.
- **Two literals named, byte-identical:**
  - `build::FIRST_DRAFT_FEE` (0.2 ₳), used by `settle`;
  - `MIX_DRAFT_FEE` (1 ₳), used by `mix_with`.
- **Tests:**
  - Rust `wasm/tests/lovejoin_test.rs`, `a_direct_returns_collateral_tail_is_paid_by_its_reserve_alone`. At 4,310 and at 6,465:
    - the direct reserve alone builds a direct return's tail, its deposit, mix and sweep checked by `the_tail` and `swept_after`, and what they don't spend comes back;
    - 1.5 ₳ alone builds none;
    - a swap's 1.5 ₳ + 1.6 ₳ beside a MIN fill builds one;
    - the figure is pinned to 2.8 and 3.6 ₳.
  - Node `wasm/tests/lovejoin-reserve.test.mjs`, "a direct return's collateral reserve is priced from the parameters (1.6.0's release review, 323-rust#1)". It covers both exports, both byte prices, and parameters it can't read (refused).
  - Vitest `tests/collateral-reserve-review-fixes.test.ts`: a site's and a top-up's `collateralReserve` is the direct figure, a mix's and a swap's the chain's.
  - Vitest `tests/lovejoin-planner.test.ts`, "is paid for by a site's funding where a 5 ₳ pool would take it…": now expects WebAssembly's direct figure (needs the rebuild).
- **Fail-before:**
  - Vitest: `AssertionError: expected '1500000' to be '2800000' // Object.is equality`, for the site and the top-up.
  - The Rust test calls a function that didn't exist. As a mutation, see below.
- **Mutations:**
  - `direct_tail_reserve` returning `COLLATERAL_TAIL_RESERVE`: `no tail built from 1500000 at 4310`.
  - The Seedelf least left out of the sum: `no tail built from 2200000 at 4310`.
  - Site and top-up back on the chain's figure (`direct: false`): both Vitest tests fail with `expected '1500000' to be '2800000'`.

### 323-worker#0: the fallback

- **The order in a swap:** boxes and reserve, then boxes alone, then the reserve alone, then neither.
  - The boxes hide what the swap gets; the reserve hides only the 5 ₳ collateral, which may still be mixed at the return.
  - At `9978654a`, the token's boxes went first and the reserve was never left out.
- **Without the reserve,** the collateral is mixed at the return if what's left pays (WebAssembly's `CollateralTail::build(...).ok()`), else it comes back with the rest. That's privacy.md's documented fallback, and Session 11's call 3.
- **Tests** (`tests/collateral-reserve-review-fixes.test.ts`):
  - "funds a site's session with what a return back directly takes for its collateral's mix, else without it (323-worker#0)". It covers paid, short only by the reserve (its record unmarked after `siteOutSubmit`), and short (still refused).
  - "tops a site's session up with a new collateral and its direct reserve, else without the reserve (323-worker#0)".
  - "funds a mix with the chain's reserve, else without it, its record unmarked (323-worker#0)". It also checks that `mix` keeps none of the form's fields.
  - "funds a swap with the chain's reserve, its margin and fill paying the rest, else without it (323-worker#0, 323-rust#1)".
  - "leaves the collateral's reserve out before a swap's token's boxes (323-worker#0)". It uses preprod's bundled MIN pool with 20 strangers' boxes.
  - Each stubs only the new export (`lovejoinDirectCollateralReserve: () => "2800000"`) and runs the real WebAssembly otherwise, so all pass on today's pkg.
- **Fail-before:**
  - the mix and the swap: `Error: Not enough ADA in your private balance for this, its fee and the change.`;
  - the site and the top-up failed first on the figure (above).
- **Mutations:**
  - The helper's fallback disabled: 4 tests fail with `Error: Not enough ADA in your private balance for this, its fee and the change.`
  - `outBuild` back to the old order (the boxes first): `AssertionError: expected undefined to be '50550000'`.
- **Not done here:** the finding's second half, keeping the reserve aside in the forms (the swap's `maxAdaIn` and `adaShort`, the Mix stepper) and FEE_ROOM covering the fee and the change's least. That's the screens round's. With the fallback, the reserve can no longer be what refuses a Max or a stepper count at Review. FEE_ROOM's own shortfall predates #323.

### The screens round's field (320-screens#2, 321-lj-screens#3)

- **When it's there:** `funding()` adds `collateralReserve` (WebAssembly's `lovejoinCollateralReserve()`, 1.5 ₳) and `collateralPool` (the pool's id) when all of these hold:
  - the depth isn't 0 (not a Bootstrap);
  - Settings' `lovejoinCollateral` is on;
  - a shown 5 ₳ ADA pool is among the pools discovery last kept (a reference, not a copy).
- **It asks nobody:** `readSet(network, true)`, so the form's stepper still makes no request. A test checks that.
- **What it doesn't check:** the pool's floor or free boxes, which need a pool read. The form counts the reserve on the private side while that pool's entry in the page's own `lovejoin-status` read has `others >= floor`, `free >= 2` and no `unusable`.
- **The 1.5.0 gate is untouched:** its service reads no pools, so the field never appears there. The gate passes unedited.
- **Kept out of the mix's record:** `mixFunding` drops both fields from the `mix` it keeps and returns, so the summary's `collateralReserve` stays the one measured at build.
- **Test:** "names what a mix from the private balance adds for its collateral's mix, and the 5 ₳ pool it goes into".
  - Fail-before: `AssertionError: expected { Object (lovelace, mixes, ...) } to match object { collateralReserve: '1500000', …(1) }`.
  - Mutations: the fields off gives the same failure; the strip in `mixFunding` off gives `AssertionError: expected '1500000' to be undefined`.

## Files touched

- `seedelf-platform/seedelf-core/src/build.rs`: `FIRST_DRAFT_FEE`, and `settle` uses it.
- `seedelf-platform/seedelf-core/src/lovejoin/mod.rs`:
  - `COLLATERAL_TAIL_RESERVE`'s doc;
  - `MIX_DRAFT_FEE`, used by `mix_with`;
  - `TAIL_DEPOSIT_BYTES` and `TAIL_SWEEP_BYTES`;
  - `direct_tail_reserve`.
- `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs`: `lovejoinCollateralReserve`'s doc, and the `lovejoinDirectCollateralReserve` export.
- `seedelf-platform/seedelf-web-wallet/wasm/tests/lovejoin_test.rs`: one new test.
- `seedelf-platform/seedelf-web-wallet/wasm/tests/lovejoin-reserve.test.mjs`: new.
- `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts`:
  - `SWAP_MARGIN`'s doc;
  - `outBuild`, `siteOutBuild`, `mixFunding` and `topUpBuild`;
  - `tailReserve`, now `(network, through, { params, direct })`;
  - the new `orWithoutReserve`.
- `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts`: one anchored edit at the end of `funding()`.
- `seedelf-platform/seedelf-web-wallet/extension/src/shared/rpc.ts`: `LovejoinFunding.collateralReserve` and `collateralPool` (additive).
- `seedelf-platform/seedelf-web-wallet/extension/tests/collateral-reserve-review-fixes.test.ts`: new.
- `seedelf-platform/seedelf-web-wallet/extension/tests/lovejoin-planner.test.ts`: the site reserve test only.

## Keys

None added or changed, critical or other. The funding reviews' existing row (`lovejoin.collateralReserve.*`) shows whatever figure the summary carries.

## Docs to update

- **architecture.md:632**, the collateral's mix bullet, its sentence "A funding that pays a collateral adds `COLLATERAL_TAIL_RESERVE` (1.5 ₳)…". Now true:
  - A mix's and a swap's funding add `COLLATERAL_TAIL_RESERVE` (1.5 ₳: the collateral's deposit and its mix). On a chain, what `DEPOSIT_RESERVE` leaves pays the sweep's least, about 0.29 ₳ over for one box. On a swap's direct return, `SWAP_MARGIN` less the order's fee comes back beside it, and its fill carries that least.
  - A site's funding, and a top-up that pays a new collateral, add `lovejoinDirectCollateralReserve(params)` (core's `direct_tail_reserve`): 2.8 ₳ at 4,310 lovelace a byte, 3.6 ₳ at 6,465. A site may spend all but the reserve.
  - Each of the four builds again without the reserve where the private balance doesn't pay for it too (`orWithoutReserve`): no `collateralReserve` on the record or the review. A swap leaves it out before its token's boxes.
  - `lovejoin-funding` names `collateralReserve` and `collateralPool` for the Mix form.
- **privacy.md:217.** Now true:
  - "pays a little more for that mix (`COLLATERAL_TAIL_RESERVE`, 1.5 ₳)" becomes: 1.5 ₳ for a mix or a swap; for a site's session or its top-up, what a return that comes back directly takes (2.8 ₳ at today's parameters).
  - Where the private balance doesn't pay for that too, the session is funded without it. Add that case to the "can't be built" list: its collateral is mixed only if what's left at the return pays.
- **flows.md:513** (Mix from the private balance, "*For its collateral's mix*"): 1.5 ₳, left out where the private balance doesn't pay for it too.
- **flows.md:477** (a swap), **489–493** (a site's session, Top up) and **521** (docs-1's note). The *For its collateral's mix* row shows:
  - 1.5 ₳ on a swap's or a mix's funding;
  - what a direct return takes on a site's and a top-up's (2.8 ₳ today);
  - no row where the balance doesn't pay for it too.
- **wasm/README.md**, the export table: add `lovejoinDirectCollateralReserve(paramsJson)`.
  - In: one Koios `epoch_params` row. Out: a lovelace string, what a site's session or its top-up adds for its collateral's mix. Parameters it can't read are refused.
  - Add `lovejoinCollateralReserve()` too (no argument; 1.5 ₳; a mix's and a swap's) if it's still missing. This overlaps bootstrap's `lovejoinBootstrapReserve` and 321-lj-rust-data#2.
- **plans/chunk-34-token-pools.md**, Session 11: the owner's "adds about 1 ₳" is now 1.5 ₳ for mixes and swaps and 2.8 ₳ for site sessions and their top-ups, with the fallback. Record this review's fix.
- **seedelf-platform/CLAUDE.md**, the "giveme.my backs one kind of Lovejoin mix too" bullet (optional): `direct_tail_reserve` sizes a direct return's tail.

## Calls the owner might overturn

1. **The money: a site's session and its top-up now add 2.8 ₳, not 1.5 ₳, at today's parameters,** where a 5 ₳ pool would take the collateral. It's live on preprod, and dormant on mainnet until a 5 ₳ pool there holds 30 other people's boxes. What the tail doesn't use comes back. The alternative, the finding's: keep 1.5 ₳ and say the collateral is mixed only where enough is left at the return.
2. **Swaps keep 1.5 ₳,** on the strength of `SWAP_MARGIN` less the order's fee coming back beside the reserve, with the fill to carry the sweep's least. Measured above, at both byte prices. If `SWAP_MARGIN` ever drops, revisit (its doc says so).
3. **In a swap, the reserve is left out before the token's boxes.** At `9978654a`, the boxes went first.
4. **The fallback says nothing.** A funding without the reserve shows no *For its collateral's mix* row, as one with Settings' switch off does; whether the collateral is mixed is decided at the return. Words for that, if wanted, are the screens round's.
5. **Rounding and the mix's estimate:** up to 0.1 ₳, and the mix planned on `MIX_FEE_ESTIMATE`. That's 0.137 ₳ over the least that builds today.
6. **Not fixed (WebAssembly; beyond these findings):** a direct return whose ADA sits only in token UTxOs has no UTxO of ADA alone to pay for the collateral's mix, whatever the reserve (`direct_tail` pays only from ADA-only UTxOs). For example, a swap against the pools whose own transaction puts the token and the change in one output. The fix would pay from a token UTxO's ADA, its tokens back as the deposit's token change.
7. **Not fixed (screens round):** 323-worker#0's form half (the swap form's Max and shortfall, the Mix stepper, FEE_ROOM). And 320-screens#2 and 321-lj-screens#3's counting of the new field, with *Comes back once it's mixed* (321-lj-screens#4).

## Notes for other fixers and the lead

- **Needs the pkg rebuilt:**
  - `npm run typecheck`: 2 errors until then, at `src/background/sessions.ts:4407` and `tests/lovejoin-planner.test.ts:1604` (`lovejoinDirectCollateralReserve` isn't on the old pkg's type). Clean against a private build.
  - Vitest `tests/lovejoin-planner.test.ts`, "is paid for by a site's funding where a 5 ₳ pool would take it, and by none where it wouldn't".
  - Node `wasm/tests/lovejoin-reserve.test.mjs`.
  - Any test that runs `siteOutBuild` or `topUpBuild` with a 5 ₳ pool shown and the collateral switch on, without stubbing the export, throws a TypeError until then. In today's suites that's only the planner test above.
- **`wss-1` (sessions.ts after me):**
  - the four builders now go through `orWithoutReserve`;
  - `tailReserve` takes `{ params, direct }`;
  - `mixFunding`'s parameter is `funding`, and it drops the form's two fields into `mix`;
  - the bootstrap fixer's `back` reserve is untouched and never left out.
- **The screens round:**
  - the field and its rule are above;
  - DappApprovals, SiteSessions and Swaps already subtract `summary.collateralReserve` generically, so the larger figure shows on its own row with no change;
  - the e2e Mix form's "Room for network fees 1.5 ₳" is `DEPOSIT_RESERVE`, unchanged.
- **Lane L:** my one edit in `lovejoin.ts` is the end of `funding()`: a `tail` const and one spread in its return.
- **The lead:** the Rust also turns two literals into named constants (`build::FIRST_DRAFT_FEE` in `settle`, `MIX_DRAFT_FEE` in `mix_with`). They're byte-identical, and core's and wasm's whole suites pass.
- **Cleanup:** the private `wasm/pkg-reserve/` and `wasm/tests-reserve/` are deleted, and so are the temporary measurement tests and the scratch tsconfig.

## Checks

- **Rust:**
  - `cargo test -p seedelf-core`: every test binary passes.
  - `cargo test -p seedelf-wasm`: every test binary passes, `lovejoin_test` 23 tests with the new one.
  - `cargo build -p seedelf-cli`: builds.
  - `cargo clippy -p seedelf-core -p seedelf-wasm --tests`: clean.
  - `cargo fmt --all -- --check`: clean. My fmt run left everyone else's files alone, as their diff stats confirm.
- **WebAssembly:** a private `wasm-release` build (wasm-bindgen into `pkg-reserve/`, then deleted): `node --test` on all of `tests/*.test.mjs` gives 57 of 57.
- **TypeScript:**
  - `tsc` against the private build's types: clean.
  - `npm run typecheck` on the shared pkg: only the 2 errors above.
- **Vitest:**
  - `tests/collateral-reserve-review-fixes.test.ts`: 6 of 6, default build and `VITE_ENABLE_MAINNET=false`.
  - `tests/lovejoin* sessions* session-* site-* swap* dapp* collateral* parts* payment-parts*` on the shared pkg: 83 files, 1039 passed, 2 skipped, 3 failed.
    - Two are deep-datum's untracked `lovejoin-discovery-review-fixes.test.ts`, which wait for the rebuild.
    - One is the planner's site test above, mine, which also waits for the rebuild.
    - `tests/lovejoin-1-5-0.test.ts` passes, unedited.
  - The same area under `VITE_ENABLE_MAINNET=false` (23 files): 336 passed, and only the planner's site test failed.
