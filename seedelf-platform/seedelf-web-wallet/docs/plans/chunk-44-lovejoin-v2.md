# Chunk 44 · Lovejoin v2 in the wallet (1.8.0)

Branch `web-wallet/lovejoin-v2`, from `main` at `c15603d5`. It's chunk 42's step 9: the wallet moves to Lovejoin v2, and the older pools keep their withdrawals alone.

**v2** is Lovejoin `main` at `29573c5` (Lovejoin PRs #165 and #166). Its five templates are 8131b1d's, except `mix_logic`, whose xor32 checks both lengths: unapplied `62befd1e…` becomes `7fb45b75…`. The bytes the wallet pins are the ones `seedelf-verification` proves (`Lovejoin/Template/Scripts/mix_logic.hex`, 3439 bytes).

- `one_shot_mint` is unchanged, so a seed makes the same P, and the same pool id, under either set. Only L, and through it M, say which set a pool runs: the datum's `mix_logic` decides.
- The classic pool and every pool on 8131b1d's templates are **retired**. v2 pools are the only ones that take new boxes.

## The owner's calls

- **2026-11-03, the game plan (chunk 42):** 1.8.0 allows no mixing into the old pools and returns every box in them as soon as it can. The UI hides the old pools, shown for withdrawal alone, and the release integrates v2. Once v2 is merged, the owner launches a new 5 ₳ pool, the only pool for now.
- **2026-11-05:** "the faster we get this published the better". Asked four questions, the owner chose:
  1. **The pool list is v2's alone.** The earliest pool of each value among v2 pools is shown. Classic and 8131b1d pools appear only where the wallet holds a box, marked withdraw-only.
  2. **Withdraw only.** No deposit, mix, Mix again or Bootstrap in a retired pool. Scheduled returns, Bring one back now and Bring every box back stay.
  3. **Right away.** At the first unlock on 1.8.0, Bring every box back runs for the retired pools. Back-to-back withdraws are easier to match; the owner chose speed.
  4. **The earliest v2 5 ₳ ADA pool** takes a return's spare ADA and the session's 5 ₳ collateral, by the rule the collateral pool already uses. Until it holds 30 other boxes (the mainnet floor), returns come back direct; Bootstrap fills it.
- **Kept as they are, unless the owner says otherwise:** no ADA pool of exactly 10 ₳ on the new scripts (it would look like the classic pool's copy), and the floor of 30.

## 44a · v2 recognised and launched ✅

Its own PR: core, WebAssembly, the data layer's copy, and the extension's discovery and launch checks, as the copies change together. After it merges and the data layer is deployed, a dev build can launch the v2 pool. Wallets already installed drop v2 pools: their `verify_pool` refuses them.

- **Core** (`seedelf-core/src/lovejoin/`):
  - ✅ `templates.rs`: `Set::V1` (8131b1d) and `Set::V2` (`COMMIT_V2`, `MIX_LOGIC_V2`), never an edit to V1's.
    - `derive` keeps V1's meaning, so its callers' tests run unedited. `derive_in(set, …)` sits beside it.
    - `derive_for(seed, datum's L)` applies P once and tries V2's L first. With no match it returns V2's scripts, so `verify_pool` refuses in its old order.
    - `Derived.set` records the set.
  - ✅ `Version::V2` beside `Classic` and `TokenV1` (`"v2"` in JavaScript), and `Version::retired()`.
  - ✅ `verify_pool` reads the set from the datum's L and accepts both; WebAssembly's `protocol_of` resolves hash-named script rows on that set too.
  - ✅ Launch and the box-value probe run v2 alone. A launch locks 124,990 lovelace more: v2's `mix_logic` is 29 bytes longer.
  - ✅ The builders stay unrestricted (the classic tests run on its preprod pool); 44b enforces retirement.
  - ✅ `v2_templates_are_frozen`, `a_seed_derives_each_sets_scripts`, `only_v2_takes_new_boxes`; the vectors file's `v2` section.
- ✅ **The data layer** (`seedelf-data/api/src/lovejoin/`): `Set`, `derive_in`, `derive_for`, v2's `mix_logic`, and `version` on each pool `lovejoin/pools` serves.
- ✅ **The shown rule keys on the set and the values,** in `standard.rs`, the extension's `lovejoin-pools.ts` and `tests/fixtures/lovejoin-shown.json` (two scenarios added).
  - Not "v2 pools alone", as first written: dropping 8131b1d pools from the data layer's list would drop the coverage wallets find their boxes by.
  - So an 8131b1d pool shown stays shown, and a v2 pool is never its copy. The wallet's screens hide the retired ones (44b, the owner's call 1).
- ✅ **The extension:** a found pool keeps `version: "v2"` (absent for every pool kept before, so old records are unchanged), and so do `LovejoinPool` and the status. A launch is a copy only of a v2 pool, and joins only v2 pools (worker and form).
- ✅ `wasm/tests/fixtures/lovejoin-v2-token-pool-preprod.json`: Lovejoin's preprod token-pool launch with its scripts derived on v2 and put at the holder. It's never on chain, and `lovejoin_v2_fixture_test.rs` writes it and verifies it as `v2` (`RECORD_LOVEJOIN_V2_FIXTURE=1`). The tests that a start of a listed pool's values is a copy run on it, and 44b's fixtures can grow from it.
- **Between 44a and 44b (dev builds only):** a retired pool still takes boxes, and the collateral still goes to the first 5 ₳ ADA pool read. With the v2 pool launched, the hub lists it beside 8131b1d's 5 ₳ pool. 1.8.0 ships both parts, so no release sees this.
- ✅ PR #363: CI green (unit on both builds, e2e, store, rust, wasm).

## 44b · The extension on v2 🟡

Branch `web-wallet/lovejoin-v2-retire`, from `main` at `c441881e` (#363 merged). Its own PR. The worker's tests ran their mixes and returns on the classic preprod pool, so retiring it moved them to v2 pools.

- ✅ **Withdraw only** (`lovejoin.ts`): `isRetired` is the classic pool and every pool not on v2's scripts. `usableNow` and `takesNewBoxes` refuse a deposit, a mix, Mix again and Bootstrap there, `retired` in words, before anything is built or read; every way of mixing asks there. Every withdraw stays. A request naming no pool is still the classic pool's, so it's refused: the screens name the pool they mix in.
- ✅ **The ADA pool** (`adaPool`): the first v2 ADA pool of 5 ₳ a box that isn't a copy, as discovery last kept them. It takes a return's spare ADA (`chain()` asked for no pool, and `acrossOf`'s ADA leg), a swap's price (`priced`, 64 boxes a deposit at most) and the collateral (`collateralPool`, `collateralPoolTakes`, `funding`'s tail). None shown: the return comes back directly, saying `sess.skip.warn.noAdaPool`. The chain and the ADA's collateral now share that pool: WebAssembly's two draws for the collateral's mix already avoid what the chain spends. A chain names the pool's box value (`values`) for its review.
  - A 1.7 mix session recorded with no pool is the classic pool's (sessions.ts names it so): its return is refused there and comes back directly, saying the pool is retired.
- ✅ **Right away** (`retireOnce`, at every `withdrawDue` run, so 1.8.0's first unlock): the first run that finds the wallet with something in a retired pool marks the record (`retired`), lets each Bootstrap there go (`released`), ends a collateral's mix left to build there (`tail.over`, and `tailChain` refuses one), and asks Bring every box back over the retired pools alone (`Bringing.retired`). Once a network; nothing is written for a wallet with nothing there.
  - **The retired pools alone, not every pool:** a second device updating later would otherwise bring back the v2 boxes the first one mixed. Every pool's, asked in Settings, widens it; a retired pool's page's is in it; a v2 pool's page's is refused while it goes, as another pool's is.
  - **No hold in a retired pool** (the owner, 2026-11-06: "no mixing in retired pools withdraw only. period"): nothing there waits for Mix again, a Bootstrap or Koios's word on what made a box. Every box comes back by itself on its schedule, mixed or not; only a chain's box still being sent is held (`sortOut`'s `old`, and `moreThanDue`, the scheduled withdraw's check and Bring one back now's choice with it). In v2 pools every hold is as it was.
- ✅ **Screens:** the hub lists a retired pool only while the wallet has boxes there (`shownOnHub`), withdraw-only with its reason, as a copy is: no Bootstrap offered, no start-up meter. Home already showed a pool's row only while it held something. Settings and the pool's page follow the retired pools' run ("Bringing every box in the retired pools back"). The 10 ₳ words say 5 ₳: the dApps tile, Lovejoin's aside, Settings' note, the connector's reviews. The launch's 10 ₳ rule stays (the owner's call), its "or mix in the classic pool" gone.
- ✅ **Costs, measured on v2's bytes** (`lovejoin_width_test.rs`, `docs/lovejoin-mix-width.md`): v2's xor32 costs 6 million steps more at three a mix and 10.8 million at four. Four still fits, by 100.3 million (1.0%), and the estimates stand: 0.837 ₳ against `MIX_FEE_ESTIMATE`'s 0.95 ₳, 1.230 ₳ against 1.35 ₳.
- ✅ **Tests:** `wasm/tests/fixtures/lovejoin-v2-ada-pool-preprod.json` (a v2 5 ₳ pool, never on chain, its own seed and launch so it reads beside the v2 token pool) and `tests/v2-pools.ts`; `lovejoin-retired.test.ts` holds the four calls. ⬜ The rest of the worker's tests moved off the classic pool.
- ✅ **The e2e:** its world had the classic pool and the bundled 8131b1d pools alone, all retired. `fivePool` puts the v2 ADA fixture at the holder above the head start's height and answers its launch's `tx_info`, so the page's look finds it, with 20 boxes at its mix_box (on mainnet, empty, for the floor's test). Twelve tests moved, their figures 5 ₳ boxes', a return's chain twelve transactions with its collateral's mix.
- **A wallet that never opened Lovejoin's page knew of no 5 ₳ pool** (the e2e found it): before chunk 44 a return's pool needed no discovery. A return's build and its collateral's pick ask discovery once where it kept none (`adaPool`'s `ask`): the data layer's list, on mainnet. On preprod only the page's look reads the holder, so the head start must carry the pool (44c).
- **Two fixes the moved tests found:** the schedule's read dropped `retired`, so the bring-back started again at every run; and a collateral's mix drew from the rows read before its chain on every try, so a box another chain reserved since was drawn again until the return gave up (`tailRows`: each try's own read).

## 44c · Live, the deploy and the launch ⬜

- **Preprod first:** a v2 5 ₳ pool launched with the dev test wallet, and every private flow run live on it.
  - Then the head start's refresh (`npm run lovejoin-pools`) bundles it, and mainnet's once the owner launches it. **1.8.0 can't ship without each network's v2 5 ₳ pool in the head start:** on preprod nothing else finds it before Lovejoin's page opens, so every return there came back directly; and the connector's approval says spare ADA is mixed "about 4.1 ₳ a 5 ₳ box" whether or not a pool is known. Two tests meet that: `lovejoin-1-5-0`'s head-start case holds that no bundled pool is v2 (read it again then), and the e2e's `fivePool`, launched after the head start, would be a copy of the bundled pool: move the e2e's boxes to the bundled pool's mix_box and drop `fivePool`.
- **The data layer goes out before the mainnet launch** (CI, the owner approves): a running data layer refuses a v2 pool and keeps that verdict until it restarts.
- **The owner launches the mainnet v2 5 ₳ pool,** then Bootstraps it toward the floor.

## 44d · Docs and the release ⬜

- `architecture.md`, `flows.md` and `privacy.md` (Bring every box back's timing cost), and the data layer's README.
- Then 1.8.0, by `development.md`'s steps.
