# Fixer pool-exists (Lane R): 317-wallet#0

## 317-wallet#0 (low, money): **fixed**

The Rust half shows in the extension only after the lead rebuilds `wasm/pkg`. The TypeScript half (`lovejoin-pools.ts`) works now.

### What changed

- **Core, `lovejoin/mod.rs`: a token pool's deposit reads the pool's reference UTxO.**
  - New private `Protocol::deposit_reference()`:
    - `Version::TokenV1`: `references[0]`, the reference UTxO.
    - `Version::Classic`: none (an exhaustive match, so a later version must decide).
  - `deposit_across` collects one reference input per token pool a box goes into: once per pool, none for a leg with no boxes. It stages them in every draft `settle_fee` prices.
  - Every path that pays a box into a token pool goes through `deposit_across`, so all of them read it:
    - a mix session's and a return's chain (`chain_across`, WebAssembly's `chain_at` and `chain_across_pools`);
    - a private Bootstrap (depth 0);
    - the public account's mix or Bootstrap (`chain_from_account_at`);
    - the collateral tail's deposit into the 5 ₳ pool (`collateral_tail` → `deposit`), from a chain or a direct return (`CollateralTail::build`);
    - `bootstrap_most`, which builds each count's deposit.
  - A launch makes the reference UTxO in the same transaction, and puts no box in. Mixes and withdraws already read every reference.
  - With that UTxO read, the ledger refuses a deposit into a pool that isn't on chain (a seed no launch spent, or a launch rolled back) with `BadInputsUTxO`, as it refuses an unknown input. Before, the deposit went through and the boxes were locked for good.
- **`references[0]` holds no script: verified.**
  - `pool_of` puts the verified reference UTxO first.
  - `candidate()` refuses a reference output carrying a script (`Rejected::ReferenceScript`).
  - The test checks the real preprod pool's reference output.
  - `deposit_reference` also refuses, in words, a hand-made `Protocol` whose first reference carries a script: "A token pool's reference UTxO carries a script". Such a deposit would owe a reference-script fee it doesn't price. It can't happen for a pool `verify_pool` made.
- **The cost: 41 bytes, 1,804 lovelace a deposit** at 44 lovelace a byte. Measured before and after, on preprod's parameters:

  | Deposit | Before | After |
  |---|---|---|
  | 1 LJTEST box | 174,125 | 175,929 |
  | 64 LJTEST boxes | 725,797 | 727,601 |
  | 64 worst-case token boxes | 801,829 | 803,633 |
  | the collateral tail's (2 inputs, into a 5 ₳ pool) | ≈173,553 | 175,357 |

  The classic pool's are unchanged: 171,969 and 799,013.
- **Discovery, `lovejoin-pools.ts` `refresh`: the cheap guard.**
  - A pool on the data layer's list is skipped unless `launch.tx`, and every script row's transaction, is the reference row's own transaction.
  - This is the data layer's own standard rule ("its launch didn't put its scripts at the holder", `standard.rs`; db.rs takes script rows from the launch's own outputs). An honest answer always meets it, and only a server that contradicts itself fails it.
  - The Koios path already meets it by construction: script rows `byTx` of the reference row's transaction, and the launch from its `tx_info`.
- **Wording.**
  - lovejoin-pools.ts's header said the data layer "can leave a pool out, never make one look real". It now says it can't pass off other scripts as a pool's, and that whether a pool is on chain is the ledger's to judge.
  - The matching test's name now says the same.
  - Core's `pool.rs` module doc now says the seed proves the NFT genuine, not minted.
  - Core's module doc on deposits, the `deposit_across` doc and `Protocol::references` ("first") say the same.

### The fee estimates still hold

- **`DEPOSIT_RESERVE`** (1.5 ₳): it's a flat plan with no size in it. A token deposit's 1,804 lovelace more is absorbed: 0.8036 ₳ at the largest worst-case deposit, and at depth ≥ 1 each mix is planned at 0.95 ₳ against 0.82 to 0.88 ₳ measured.
- **`BOOTSTRAP_BACK_RESERVE`'s doc:**
  - "0.17 ₳ for one box, 0.8 ₳ for one deposit's most of 96, about as much for a token pool's 64": 0.1759 ₳ and 0.8036 ₳.
  - "about 0.5 ₳ over at the largest deposit": the worst token pool's 64 boxes bring back 2,025,762, against a Seedelf output's least of about 1.457 ₳. That's about 0.57 ₳ over.
- **`bootstrap_most`** builds, so it adapts. It still gives 64 for LJTEST's pool and the worst token's, 96 for the classic pool, and 68 at the dearer byte (core's `a_private_bootstrap_is_held_…`). The WebAssembly's `a_private_bootstrap_of_a_token_pool_…` passes too.
- **`COLLATERAL_TAIL_RESERVE`'s doc** ("the deposit that boxes it, about 0.18 ₳"): 0.1754 ₳ measured.
- **The planner** (`plan_across`, `boxes_affordable_in`, `funding_for_in`): a flat reserve plus per-box estimates, with no deposit size in it. Unchanged.
- **`MAX_TOKEN_DEPOSIT_BOXES`** (64; "71 fit with two inputs, and 64 with 31"): 71 still fit with two inputs, and `fits(64, 30)` still passes. The doc in lovejoin.ts stays true.
- **WebAssembly tests that pin fees:** none pins a token deposit's.
  - `a_large_bootstrap_from_the_public_account_takes_another_utxo_for_its_fee` still takes 4 inputs, and its change is ≥ 969,750.
  - Every native WebAssembly test, and the 56 node tests on a private package, pass.

### Tests

| Test | Fail before | Mutation check |
|---|---|---|
| Rust `seedelf-core/tests/lovejoin_pools_test.rs`, `a_token_pools_deposit_reads_its_reference_utxo` (line ~1352). Checks:<br>• Both forms of LJTEST's pool (scripts inline, scripts by reference) read `references[0]` alone. That output carries no script, and the fee covers the bytes alone.<br>• The wallet's evaluator, which resolves every input and reference input as the ledger does, refuses the deposit without the pool's reference UTxO, naming it, and takes it with it.<br>• `deposit_across`: two token pools are read once each, in leg order; the same pool twice is read once; the classic pool's boxes read nothing; a leg with no boxes reads nothing, and is byte-identical to the classic deposit alone.<br>• The collateral tail into a 5 ₳ TokenV1 pool: its deposit reads that pool's reference.<br>• A scripts-first hand-made pool is refused. | `assertion left == right failed, left: [], right: [([127, 118, 123, 62, …], 0)]`: the token deposit read nothing. | Each fails when undone alone:<br>• the staging of the reads: the same failure;<br>• the once-per-pool check: two reads of the same reference;<br>• the empty-leg check: the bytes differ from the classic deposit alone;<br>• the script guard: `unwrap_err() on an Ok value`, built at 195,025. |
| Rust `wasm/tests/lovejoin_flows_test.rs`, `every_deposit_into_a_token_pool_reads_its_reference_utxo` (new): a mix session's deposit (and its mix), a private Bootstrap's, the classic pool's (reads nothing), and the public account's at depth 1 and 0. | Written after the core fix; see the mutation check. | Core staging undone: fails at line 504. |
| Rust `wasm/tests/lovejoin_across_test.rs`, `a_return_across_pools_deposits_once_and_mixes_each_box_in_its_pool`: an added assertion that the deposit reads only the token pool's reference. | Same. | Fails at line 343. |
| Rust `wasm/tests/lovejoin_test.rs`, the `the_tail` helper: an added assertion that the collateral tail's deposit reads the 5 ₳ pool's reference. Run by `a_chains_collateral_is_mixed_once_…`, `a_direct_return_mixes_the_collateral_once_…` and `the_collateral_never_draws_a_box_its_chain_drew`. | Same. | All 3 fail at line 1476. |
| Vitest `extension/tests/lovejoin-discovery.test.ts`, "leaves out a pool whose launch, or a script of it, isn't its reference UTxO's own transaction (1.6.0's release review, 317-wallet#0)". Covers a listed `launch.tx` naming another transaction, and a script row from another transaction. A consistent list is kept. | `toEqual([])` failed: the pool was kept (lovejoin-discovery.test.ts:314). | Each half of the guard removed alone fails the test. |

## Files touched

- `seedelf-platform/seedelf-core/src/lovejoin/mod.rs` (the fix, and doc comments)
- `seedelf-platform/seedelf-core/src/lovejoin/pool.rs` (module doc only)
- `seedelf-platform/seedelf-core/tests/lovejoin_pools_test.rs`
- `seedelf-platform/seedelf-web-wallet/wasm/tests/lovejoin_flows_test.rs`
- `seedelf-platform/seedelf-web-wallet/wasm/tests/lovejoin_across_test.rs`
- `seedelf-platform/seedelf-web-wallet/wasm/tests/lovejoin_test.rs`
- `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts`
- `seedelf-platform/seedelf-web-wallet/extension/tests/lovejoin-discovery.test.ts`

## Keys

None added or changed. Nothing new is shown.

## Docs to update

1. **`WW/docs/architecture.md`, ~line 730, "Which pools are shown":**
   - From the data layer's list, a pool is also left out unless its launch and both script rows are the reference row's own transaction (`refresh`).
   - That a pool is on chain is the ledger's to judge, not the server's word. A pool verifies offline from any seed, so one a list names may never have been launched, or its launch rolled back.
   - A token pool's deposit reads the pool's reference UTxO (core's `deposit_across`). A deposit into a pool that isn't on chain is refused at submit (`BadInputsUTxO`, which stops the chain) instead of locking its boxes for good.
2. **`WW/docs/architecture.md`, ~line 632, the collateral's tail:** its deposit reads the 5 ₳ pool's reference UTxO, 1,804 lovelace more.
3. **`WW/docs/architecture.md`, ~line 671, Bootstrapping:** a Bootstrap's deposit into a token pool reads the pool's reference UTxO. Still no script and no collateral.
4. **`WW/docs/plans/chunk-34-token-pools.md:473`:** "The server can leave a pool out, but it can't make one look real" is false.
   - What's true: the server can leave a pool out, and can't pass off other scripts as a pool's. It could name a pool that isn't on chain. The ledger refuses any deposit into one, since each reads the pool's reference UTxO (1.6.0's release review, 317-wallet#0).
   - Also :737 (`deposit_across`): it reads the reference UTxO of each token pool a box goes into.
5. **Optional, `seedelf-platform/CLAUDE.md`, the "Lovejoin's token-pool templates are pinned" bullet:** after "trusts a pool only by deriving its scripts…", add that a token pool's deposit reads its reference UTxO, so the ledger refuses one into a pool that isn't on chain.
6. **No change:**
   - `privacy.md`, and no policy entry: nothing new is asked or sent. On chain, the reference input names the pool the deposit's `mix_box` output already names, and Lovejoin's own deposit builder always reads it too (Lovejoin cb5a5a3, `offchain/src/tx/deposit.ts:563-569`, "Reference UTxO is always read"). The wallet's token deposits now look more like Lovejoin's own, not less.
   - `seedelf-data/README.md`.

## Calls the owner might overturn

- **The classic pool's deposits read nothing**, byte for byte 1.5.0's (the owner's rule; `lovejoin-1-5-0.test.ts` passes unedited). Its pool is bundled and on chain since 2026-09-26, so it can't be faked.
- **Every token-pool deposit costs 1,804 lovelace more**, the 5 ₳ collateral tail's included.
- **Not done: confirming a listed pool exists before it's handed over.** The finding's alternative is one Koios `utxo_info` per newly listed pool, the same for every wallet, so no privacy cost.
  - Without it, a lying server (or a rollback past its stable cursor) can still make a pool that isn't on chain show on the hub. It's kept for good (STATE-2), and Bootstrap is offered.
  - No money goes in now: the deposit is refused at submit. The user sees a refused send.
  - If such a pool should never be shown, add that check.
- **The refusal's words fit poorly.** `BadInputsUTxO` is read as `SpentInputError`, which shows `koios.spentInput`: "The network refused it: a UTxO it spends is already spent…". It doesn't say the pool isn't on chain.
  - The chain stops as for any refused deposit (`chainRetryMs`): at once for a chain's first transaction, after 18 tries, 10 s apart, for a later one such as the tail's deposit. The session then comes back directly.
  - Left as is: `koios.ts` isn't this lane's, and the case needs a lying server or a deep rollback.
- **The refresh guard leaves a listed pool out** when its launch or script rows aren't the reference row's own transaction. It refuses an inconsistent server answer, never a user action, and the data layer's standard rule demands the same.
- **Core refuses a deposit into a hand-made token `Protocol` whose first reference carries a script,** rather than building it under-priced. It can't happen for a verified pool.

## Notes for the lead and other fixers

- **The pkg rebuild.** None of this fixer's tests needs it to pass: the Rust tests run natively, and the Vitest test is TypeScript alone.
- **The TypeScript tests that build a real token-pool deposit,** and see its reference input and 1,804 lovelace only after the rebuild. Each was logged through WebAssembly in a run against a private pkg built from this tree. All pass there, so none pins the old fee.
  - `lovejoin-flows.test.ts` (5):
    - "deposits the pool's token from the account, mixes in that pool alone, and records every leaf there";
    - "funds a private Bootstrap with its way back, deposits, then sweeps the change back with nothing put up (1.6.0's release review, 318-rust#0)";
    - "funds its one-time account with the token beside the ADA, deposits both, and mixes in that pool alone";
    - "lists every pool the wallet reads in each read, whichever pool a flow takes";
    - "puts a token pool's boxes in with no mixes, holds them, and caps a deposit at a token box's size".
  - `lovejoin-merged-review.test.ts` (4):
    - "comes back directly, saying why, never into the copy (a Bootstrap)";
    - "… (a mix)";
    - "refuses a public mix's Send into a pool that turned into a copy since its review";
    - "takes new boxes, from either side, and says on its status why they wait…".
  - `lovejoin-planner.test.ts` (18 tests, 21 deposits). The collateral tail's deposits into the 5 ₳ pool, and token returns:
    - "asks a busy giveme.my again after a minute, then two, then four";
    - "asks again, rather than stop, while Koios's Ogmios doesn't know the outputs of its own deposit yet";
    - "asks giveme.my for its mix once everything before it is on chain, then sends it and the return";
    - "counts a return's boxes across pools after what its funding paid for its collateral's mix, as its chain does";
    - "deposits the token's boxes beside the ADA's in one transaction, and mixes each box in its own pool";
    - "goes as a chain of its own with a return that comes back directly, its spare ADA paying for no 10 ₳ box";
    - "goes last in a chain's return: its deposit, then its mix of two other people's boxes, then the return";
    - "goes only once the 5 ₳ pool holds the network's floor of boxes that aren't the wallet's, two of them free";
    - "holds what's left at the account while a lock cut its chain before the collateral's box is listed";
    - "is a return's token's pool, and its way says the boxes wait";
    - "keeps a stopped chain's collateral's mix to build again when the chain built in its place never starts";
    - "looks for a box in a token's cheapest pool before reading the pools, as the most used may be any of them (7)";
    - "mixes a return's ADA through the classic pool when its token's pool refuses the mix, and says why the token comes back (1)";
    - "names the box value of each token pool a return's review shows";
    - "stops waiting on a collateral's deposit that isn't on chain an hour after its chain stopped";
    - "takes no more of a swap's token into its pool than its review showed, whatever its fill brought (10)";
    - "takes the fill's token into the pool approved, the rest back with the return";
    - "waits out giveme.my behind the chain, then stops, and the runner builds that mix again with fresh boxes".
  - `lovejoin-token-feed.test.ts` (2):
    - "sends all of a mix from the private balance into a token pool, and its session sees each step land";
    - "sends all of a mix from the public account into a token pool, and Home's banner sees it, naming none of it to tx_status".
- **For `reserve` (323-rust#1):** the collateral tail's deposit is 1,804 lovelace dearer: 175,357 measured with two inputs into a 5 ₳ pool. Size the reserve with it.
- **For later Lane R fixers:** a new path that pays boxes into a pool must go through `deposit_across` to read the reference UTxO.
- **Seen mid-round, not mine:**
  - `tests/lovejoin-pools.test.ts` "tells a pool's page of its own boxes alone when none can come back (34f's review, 6)" failed twice while `lovejoin.ts` was mid-edit (Lane L). It passed in the later full runs.
  - A typecheck error in `tests/lovejoin-crediting-review-fixes.test.ts` (unused `madeByMix`). Gone at the final typecheck.
- **Cleanup:**
  - Deleted: the private pkg and test copies (`wasm/pkg-pool-exists/`, `wasm/tests-pool-exists/`, `extension/tests-pool-exists/`, `extension/vitest.pool-exists.config.ts`).
  - Left: the private module build sits in the cargo target dir (`target/wasm32-unknown-unknown/wasm-release/`), not in `wasm/pkg`. `build.sh` rebuilds it.

## Checks run

- **`seedelf-platform`:**
  - `cargo test -p seedelf-core --locked` (whole offline suite): pass.
  - `cargo test -p seedelf-wasm --locked --no-fail-fast` (native): pass.
  - `cargo clippy --locked -p seedelf-crypto -p seedelf-wasm -p seedelf-core --all-targets -- -D warnings`: clean.
  - `cargo fmt --all -- --check`: clean.
- **Node, on a private pkg from this tree:** `node --test` on every `wasm/tests/*.test.mjs`, 56/56 pass.
- **Vitest on the shared pkg,** with `VITE_ENABLE_MAINNET` on and off: `lovejoin-discovery`, `lovejoin-pools-head-start`, `lovejoin-1-5-0` (the 1.5.0 gate, unedited) and `wasm-review-fixes` pass; `lovejoin-pools` passes but for Lane L's transient failure above.
- **Vitest on the private pkg** (throwaway copy):
  - The whole suite: 2,603 passed, 4 skipped, 0 failed.
  - The four token-deposit files, `lovejoin-discovery` and `lovejoin-1-5-0`, with `VITE_ENABLE_MAINNET` on and off: 144/144 each.
- **`npm run typecheck`:** clean.
