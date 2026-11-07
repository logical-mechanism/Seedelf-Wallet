# 1.8.1's fix round · rust

Lane `rust`. Worktree `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-r181`, detached at `2a8060d3`, everything uncommitted, on its own target (CARGO_TARGET_DIR unset).

**In short.** All eleven findings are fixed. Two are code in core:
- `Rewards::of` now lets the last entry for a hash win, a 0 included (core#2).
- Two doc comments now say everything that joins a withdraw's register (core#3).

The rest are tests: twelve new tests (two of them in one new file) and two existing ones extended.
- **No test found a defect.** Every new test passed on `2a8060d3` except core#2's, which failed there and passes after the fix.
- **Each test-gap test was checked against a mutant of the line it holds:** 22 mutants, all killed. Every mutated file went back byte for byte (sha256 checked).
- **Three of the mutants, N1 to N3, got past the suite as it was.** Each leaves a signature or a script out of what a giveme.my mix or a private withdraw is priced on. With this lane's new tests skipped, each passed all 20 targets the mutation lens sweeps. Only the new fee checks catch them.

## The findings

### core#1 and money#1 · fixed · `seedelf-core/tests/lovejoin_pools_test.rs:1464–1972`

A new section, after chunk 43's token-pool test.

**The helpers:**
- `v2_pool`, `v2_ada` and `v2_token` read the WebAssembly crate's two v2 fixtures and verify each pool as the wallet verifies one (`Version::V2` asserted).
- `balances` checks the ledger's balance from the bytes: the inputs (each found in `known`) plus the withdrawals equal the outputs plus the fee, for ADA and for each token by policy and name.
- `ledger_minimum_fee` works the fee out apart from the builder: the signed size, the declared budgets priced as exact rationals, and 15 lovelace a byte of every reference script the transaction spends or reads.
- `declares_what_it_uses` is money#1's budget check: measured again, the finished transaction uses no more than each redeemer declares.

**`every_kind_takes(pool, take)`** builds five transactions with `take` in the pool's account: a mix under the payer's collateral, a mix under giveme.my's, and a withdraw paid by the box, by an account and by a private UTxO. Each must:
- withdraw exactly `take` from the pool's account, and leave `Rewards` empty;
- balance;
- put the take in the user's own output:
  - a mix's change holds `20 ₳ + take − fee`, and every box is exactly a box;
  - the register holds `denom + take − fee` when the box pays, or `denom + 20 ₳ + take − fee` when a private UTxO pays;
  - when an account pays, the register holds at least `denom + take`, and the account's change is `20 ₳ − fee − top-up`;
- return the collateral on the fee alone: `5 ₳ − 3/2·fee`, less 1 more for the payer's own;
- pay the ledger's minimum, within 1,000 lovelace for a mix and 6,000 for a withdraw, the bounds `lovejoin_mainnet_test.rs` uses;
- declare what it uses.

**The tests:**
- **`v2_pools_take_a_reward_balance_in_every_kind_and_pay_the_ledgers_fee` (:1816):** v2's ADA and token pools, at 24 lovelace (one CBOR byte more than none), 500 ₳ and 5,000 ₳ (past 32 bits).
- **`the_classic_pools_take_a_reward_balance_in_every_kind_too` (:1827):** mainnet's and preprod's classic pools at 500 ₳. That runs the kinds no test ran with a balance: mainnet's giveme.my mix and both of its paid ways back, and preprod's paid ways back.
  - It's here rather than in `lovejoin_mainnet_test.rs`, so both networks run the same checks.
  - `seedelf_payer` gained a network as `seedelf_payer_on` (:1180). `seedelf_payer` calls it, and its callers are unchanged.
- **`every_chain_transaction_balances_with_a_take` (:1851):** each transaction is balanced from the bytes of everything before it.
  - One box two waves deep, in the classic pool and in v2's 5 ₳ pool. The takes are `[0, 500 ₳, 0, 0, 0]`, the last change carries the take, and the last transaction's change output is `Chain::change`.
  - `chain_across` v2's token pool, then its 5 ₳ pool, each with its own balance. The takes are `[0, 5,000 ₳, 0, 0, 0, 3 ₳, 0, 0, 0]`.
  - A session's collateral tail into v2's 5 ₳ pool. The deposit takes nothing, and the giveme.my mix takes the balance into its change.

**What the tests failed on.** These are test gaps, so all of them pass on `2a8060d3`. They fail on these mutants:
- **N1 (new):** `mix_with` prices a giveme.my mix without giveme.my's signature. The fee comes out 4,442 lovelace short: "Classic, 500000000 taken, giveme.my's collateral true: fee 822212 for 826654", and on v2 "fee 827440 for 831883".
- **N2 (new):** `withdraw_with` leaves a private payer's wallet-contract script (629 bytes) out of the reference-script fee. 9,433 short: "a private withdraw's fee 336070 for 345503".
- **N3 (new):** the one-time key's signature is left out of a private withdraw's size. 4,443 short.
- **C8 (the mutation lens's):** the take goes into the account's change, not the register: "the register holds the box and the take".
- **C6:** the take goes into no output: "the ledger's balance: {([], []): 500000000}", in all three tests.
- **C23:** each `chain_across` leg gets a copy of `Rewards`. The chain test's `rewards == Rewards::none()` fails.

**The sweep.** N1, N2 and N3 each ran through the 20 targets the mutation lens sweeps, this lane's new tests skipped: core's nine Lovejoin targets and `--lib`, and the WebAssembly crate's ten. Each mutant survived all 20. Before this round, nothing held a giveme.my mix's fee or a private withdraw's fee to the ledger's minimum. A slip there would only have shown up as `FeeTooSmallUTxO` on chain.

### money#2 and mutants#3 · fixed · `seedelf-web-wallet/wasm/tests/lovejoin_test.rs`, the reward balance's section

One test per entry point:
- **`a_chain_across_pools_takes_each_pools_balance_once` (:2211):** `chain_across_pools` over the classic pool and the 5 ₳ pool, with the collateral's tail in the 5 ₳ pool. Each pool's first mix takes its own balance (500 ₳, 3 ₳), and the tail's mix takes 0.
  - Fails on W2: the classic mix withdraws 0 where 500,000,000.
  - Fails on W11: the tail's mix withdraws 3,000,000 where 0.
- **`a_direct_returns_tail_takes_the_balance_and_the_return_brings_it_back` (:2273):** `api::session_return`'s direct tail. The tail's mix takes 500 ₳, the sweep brings `20 ₳ + 500 ₳ − fees` into Seedelf, and `lovelace` says so. Fails on W9.
- **`the_collateral_mix_built_again_takes_the_balance_and_its_return_brings_it_back` (:2322):** `collateral_mix`. Its mix takes 500 ₳, and `returned` counts it. Fails on W8.
- **`mixing_again_from_the_public_account_leaves_the_balance_it_took_there` (:2409):** `again_from_account_at`. The first mix takes 500 ₳, the second 0, and `returned + fees` rises by 500 ₳. Fails on W4.
- **`a_box_brought_back_paid_takes_the_pools_balance_into_its_register` (:2480):**
  - `withdraw_paid_in`: the register holds `10 ₳ + 500 ₳`, and the account pays the fee alone (`paid == fee`). Fails on W6.
  - `withdraw_private_in`: the register holds `10 ₳ + 12 ₳ + 500 ₳ − fee`. Fails on W7.

Each failed with `left: [(…, 0)], right: [(…, 500000000)]`, or the 3,000,000 above for W11.

These use the file's own 5 ₳ pool (`five()`, built on V1's templates) and the classic pool, not v2's fixture as money's repros did. What they hold is the request's `rewards` reaching the builder, which no set changes; v2 is held in core, above.

### mutants#1 · fixed · `lovejoin_pools_test.rs:1106` (`a_withdraw_refused_after_it_read_the_balance_takes_none`)

The test sits beside `a_box_worth_less_than_the_fee_cant_pay_its_way_back`.
- A 1-lovelace balance goes through a CantPayBack withdraw, then a PrivateTooSmall private one. Each leaves the balance where it was.
- The UTxO that pays then withdraws it, and `Rewards` is left empty.

It passes on `2a8060d3`. It fails on C5b and C5c with `left: 0, right: 1` at the first balance check.

### mutants#2 · fixed · core `lovejoin_test.rs:1336–1355`

The last block of `a_chains_first_mix_takes_the_balance_and_its_change_carries_it` now mixes again on a named `Rewards` and asserts it's empty afterwards. It fails on C26: `left: Rewards({…: 500000000}), right: Rewards({})`.

### mutants#4 · fixed · `wasm/tests/cip30_test.rs:2112–2120`

`a_transaction_names_every_script_reward_account_it_pays_into` gains a proposal that returns its deposit to `[6; 28]`, with no treasury withdrawal. `paid_scripts` names `[6; 28]` alone. It fails on W19: `left: [], right: ["0606…06"]`.

### core#2 · fixed · `seedelf-core/src/lovejoin/mod.rs:598–604`

**The fix.** `Rewards::of` collects first, then keeps only the non-zero balances, so the last entry for a hash wins, a 0 included. Its doc says so.

**The test:** `lovejoin_test.rs:1160` (`a_pool_named_twice_holds_the_last_balance_given`):
- `[5, 7]` gives 7, `[7, 5]` gives 5, and `[0, 5]` gives 5;
- `[5, 0]` gives none.

Before the fix it failed on `[5, 0]`: `left: Rewards({…: 5}), right: Rewards({})`. It passes after.

**What changes.** Only a request that names one hash twice, and only `RewardsIn` can send one. It's a `BTreeMap<String, String>`, so one hash in upper and lower case makes two keys. Its lower-case entry sorts last, so it now wins at "0" too. The worker names each pool once, in lower case.

### core#3 · fixed · `mod.rs:1229–1231` and `:1313–1317` (docs, no test)

- **`Withdraw::lovelace`:** "the boxes' ADA, a private payer's UTxO or an account's top-up, and what was taken from `mix_logic`'s reward account, less the fee where the boxes or the private UTxO pay it".
- **`withdraw_paid`:** "if their ADA and the balance taken are less than the Seedelf output needs, the account makes up the rest".

### trust#1 and claims#2 · fixed · new `seedelf-web-wallet/wasm/tests/lovejoin_proven_bytes_test.rs`

It's in the WebAssembly crate, which is never published, since it reads files outside the crate.

**`the_proven_scripts_are_the_wallets_v2_templates` (:30).** It reads four files with `include_str!`:
- `seedelf-verification/Lovejoin/Template/Scripts/{mix_logic,mix_box,one_shot_mint}.hex`, what `Lovejoin.Template.Scripts` imports;
- `Lovejoin/Scripts/reference_holder.hex`.

It holds each script's hash to core's `unapplied_hashes_in(Set::V2)` and `REFERENCE_HOLDER_HASH`. Those are the bytes of CLAIMS.md's four Lovejoin rows.
- The brief named two of the files; mix_box's and reference_holder's are those rows' bytes too, and cost a line each.
- fee_contract is out of the claim, so it's out of the test.
- It also checks that v2's mix_logic isn't v1's.

**`mainnets_v2_pool_is_the_proven_templates_applied` (:41).** `derive_in(Set::V2)` from seed `6db8a313…#3` gives P `fcb3f5ec…`, L `a6a85074…` and M `dd94113c…`. The test has the full hashes.

**What the tests failed on.** Both pass on `2a8060d3`.
- One hex digit changed in each Lean file (P1 to P4) fails the first test, on a hash mismatch.
- One digit changed in core's `MIX_LOGIC_V2` (P5) fails both: the template's hash, and the pool's L comes out `3d659166…` for `a6a85074…`.
- Each file was restored byte for byte (sha256 checked).

## Files (worktree, uncommitted)

- M `seedelf-platform/seedelf-core/src/lovejoin/mod.rs`: `Rewards::of` and the two docs, nothing else.
- M `seedelf-platform/seedelf-core/tests/lovejoin_pools_test.rs`
- M `seedelf-platform/seedelf-core/tests/lovejoin_test.rs`
- M `seedelf-platform/seedelf-web-wallet/wasm/tests/cip30_test.rs`
- M `seedelf-platform/seedelf-web-wallet/wasm/tests/lovejoin_test.rs`
- A `seedelf-platform/seedelf-web-wallet/wasm/tests/lovejoin_proven_bytes_test.rs`

No `WASM/src` change was needed: every path was reachable through its public entry point. There are no i18n keys and no user-visible strings.

## For the lead

**The review's record.** Chunk 43's archived record now ends "its record says what its fix round added" (the docs lane's `:176–181`). This round added:
- **core, v2 and every kind:** `v2_pools_take_a_reward_balance_in_every_kind_and_pay_the_ledgers_fee`, `the_classic_pools_take_a_reward_balance_in_every_kind_too` and `every_chain_transaction_balances_with_a_take`;
- **core, the hand-over:** `a_withdraw_refused_after_it_read_the_balance_takes_none`, `a_pool_named_twice_holds_the_last_balance_given`, and the extended `a_chains_first_mix_takes_the_balance_and_its_change_carries_it`;
- **WebAssembly, each entry point:** the five `lovejoin_test.rs` tests above;
- **cip30:** the proposal's return alone, in `a_transaction_names_every_script_reward_account_it_pays_into`;
- **the proven bytes:** `lovejoin_proven_bytes_test.rs`.

Note that the across-pools test is in `lovejoin_test.rs`; `lovejoin_across_test.rs` still passes no balance.

**CI, the owner's call (per the brief).** web-wallet.yml's `changes` filter (`covered`, :67) skips the `rust` job for a pull request that touches only `seedelf-verification/`.
- So a hex-only edit goes red only on main's post-merge run, where push runs check everything.
- To catch it on the pull request, `covered` would add `/^seedelf-verification\/Lovejoin\/(Template\/)?Scripts\//`.
- The test itself is in `cargo test --workspace --locked`, which the `rust` job runs.

**Docs that can now say more:**
- **The docs lane:** `seedelf-platform/CLAUDE.md:86` says `Set::V2` is "the bytes `seedelf-verification` proves" (the docs lane's own note). `lovejoin_proven_bytes_test.rs` now holds that, so its name can go there. `wasm/README.md`'s tested list (:171 at `2a8060d3`) can name it too.
- **The verif lane:** CLAIMS.md's claims#2 line can cite `mainnets_v2_pool_is_the_proven_templates_applied`.

**Where the tests reach.**
- `lovejoin_proven_bytes_test.rs` reads those four `seedelf-verification/` files by path, so a move or rename of them stops that target compiling. The verif lane's brief moves no hex file.
- Core's new tests read the WebAssembly crate's v2 fixtures by path, as `lovejoin_width_test.rs` already does. `cargo publish` builds no tests, so publishing core isn't affected.

## Ran

All in the worktree's `seedelf-platform/`, last:

- **rustfmt:** `cargo fmt --all`, then `cargo fmt --all -- --check`: clean. It was clean before too, so rustfmt touched only this lane's new lines.
- **Clippy:**
  - `cargo clippy -p seedelf-core -p seedelf-wasm --tests -- -D warnings`: exit 0 (and exit 0 before any change).
  - CI's `cargo clippy --locked -p seedelf-crypto -p seedelf-wasm --all-targets -- -D warnings`: exit 0.
- **seedelf-core, by `--test`:**
  - `lovejoin_pools_test` 41 passed, `lovejoin_test` 31, `--lib` 2;
  - `lovejoin_mainnet_test` 8, `lovejoin_planner_test` 13, `lovejoin_width_test` 4 (its live test ignored);
  - `withdraw_zero_test` 6, `lovejoin_box_value_test` 2, `lovejoin_launch_test` 8, `lovejoin_vectors_test` 3.
- **seedelf-wasm, by `--test`:**
  - `lovejoin_test` 34 passed, `cip30_test` 49, `lovejoin_proven_bytes_test` 2;
  - `lovejoin_flows_test` 14, `lovejoin_across_test` 4, `lovejoin_mainnet_test` 8, `lovejoin_pools_test` 6, `lovejoin_v2_fixture_test` 5;
  - `session_test` 13 (its fixture recorder ignored), `return_cost_test` 5, `api_test` 86, `readme_test` 1.
- **Mutants:** `python3 -I /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/cfcbd3c7-4fba-46f9-8be7-526fb876c645/scratchpad/fix-rust/mutate.py all` killed 22 of 22. `… mutate.py --sweep N1 N2 N3`: each survived all 20 targets. Every mutant's text, run and log is in that folder (`mutants.jsonl`, `mutant-*.log`, `sweep-*.log`).
- **Not run:** no network, no `--ignored`, nothing in seedelf-data, no lake, lean or check.sh, no npm.
