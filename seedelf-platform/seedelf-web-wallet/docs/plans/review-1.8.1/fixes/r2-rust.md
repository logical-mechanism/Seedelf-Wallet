# 1.8.1's round-two fix-ups · rust

Lane `rust`. Worktree `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-r181`: round one's changes still staged as they were, this round's unstaged (`git diff` is this round alone), on its own target (CARGO_TARGET_DIR unset).

**In short.** r2-rust#1 is fixed, with tests alone: no source file changed.
- **Core:** `every_kind_takes` now builds with a second payer too, whose fee UTxO and collateral sit at two keys, and a deposit from UTxOs at two keys. The deposit, the mix under the payer's collateral and the paid withdraw each pay the ledger's minimum for two signatures, on v2's two pools and both classic ones.
- **WebAssembly:** the tests that build the public account's two-key transactions hold each signed transaction's fee to the ledger's minimum, worked out from its own signed bytes. Every signature is already in those bytes, so no count of keys is copied from the code.
  - This replaces `fee >= 44 × size + 155,381`, which leaves out the scripts' computation and reference-script fees. Those are more than half a mix's fee, so a fee a signature short passed it with room to spare.
  - A new test holds Mix again's key count where its first mix and the rest are signed by different numbers of keys.
- **What the tests catch:**
  - The reviewer's three mutants (G1–G3) each fail both core tests and at least one WebAssembly test.
  - Six more of the same slip one layer out (H1–H6: the WebAssembly crate's count of the account's keys, and core's chain plumbing) survived every target that builds these transactions before. Each fails a WebAssembly test now; core can't see them, since its builders take the count as given.
  - Each half of Mix again's `max` (H4a, H4b) survived the extended tests, and fails the new one.

r2-rust#2 (the CLAUDE.md line) is the docs lane's, per R2FIXBRIEF.

## r2-rust#1 · fixed

### Checked against the code

The finding holds as written.
- **Core prices from the count it's given:**
  - `mix_with`: `MixCollateral::Own(_) => payer.signers` (`seedelf-core/src/lovejoin/mod.rs:1136`);
  - `withdraw_with`: `Paying::Account(p) => p.signers` (`:1667`);
  - `deposit_across`: `settle_fee(params, signers, …)` (`:813`).
- **The WebAssembly crate counts the account's keys:**
  - `withdraw_paid_in`: `signers: keys.len()` (`wasm/src/lovejoin.rs:2791`);
  - `chain_from_account_at`: `deposit_signers: deposit_keys.len()` and `mix_signers: mix_keys.len()` (`:2362–2363`);
  - `again_from_account_at`: `first_keys.len().max(mix_keys.len())` (`:2521`).
- **Core's chain plumbing** passes them on: `chain_across` puts `*mix_signers` in each leg's `Payer` (`mod.rs:2327`) and `*deposit_signers` into `deposit_across` (`:2307`).

### Core · `seedelf-core/tests/lovejoin_pools_test.rs`

- **Helpers:**
  - `other_key` (`:848`): another key's base address beside `session`'s;
  - `coin_at` (`:860`): a coin at any address. `coin` (`:855`) calls it, unchanged for its callers.
- **`every_kind_takes` (`:1667`):**
  - **Two payers:** `one_key` (`payer`, as before) and `two_keys` (`:1679`), the same fee UTxO with its collateral at `other_key`, `signers: 2`.
  - **A deposit, new and first (`:1685`):** from UTxOs at two keys, a token pool's token from the first (`token_holding`), signed by 2. It withdraws nothing, balances, and pays the ledger's minimum for two signatures, within 1,000 lovelace (`settle`'s bound).
  - **The mixes (`:1729`):** under the payer's collateral with one key and with two, and under giveme.my's with one beside giveme.my's. Each is held to `ledger_minimum_fee` at 1, 2 and 2 signatures, within 1,000, as before.
  - **The paid withdraw (`:1811`):** with one key and with two, held at 1 and 2, within 6,000.
  - The rest is as round one left it. The doc says all of this.
- **Where it runs:** in both callers.
  - `v2_pools_take_a_reward_balance_in_every_kind_and_pay_the_ledgers_fee` (`:1887`): v2's ADA and token pools, three takes each;
  - `the_classic_pools_take_a_reward_balance_in_every_kind_too` (`:1898`): mainnet's and preprod's classic pools.
  - The two take 3.2 s, where they took 2.1 s.

### WebAssembly · `seedelf-web-wallet/wasm/tests/lovejoin_test.rs`

- **`each_pays_the_ledgers_minimum` (`:765`), with `script_size` (`:746`):** each signed transaction's fee, read from its body, is at least the sum of:
  - 44 × its signed size + 155,381;
  - its redeemers' budgets at 577/10⁴ a memory unit and 721/10⁷ a step, one ceiling over the total;
  - 15 × the bytes of every reference script it spends or reads.

  What it spends or reads is resolved from the request's rows, the pool's references and the outputs of the transactions before it. An input it can't find panics. It asserts the file's `params()` holds those prices.
- **`the_public_account_mixes_straight_in_signed_by_the_keys_it_spends` (`:847`):** its UTxOs are hoisted (`:854`) so the check knows them. Both builds are held in full (`:927`, `:937`): the deposit (two keys) and the mixes (one key, then two). The weak check is gone.
- **`the_public_account_mixes_its_own_boxes_again_signed_by_the_keys_it_spends` (`:1170`):** Mix again's two mixes, two keys each (`:1265`), in place of the weak check.
- **`a_box_brought_back_paid_takes_the_pools_balance_into_its_register` (`:2616`):** asserts the paid withdraw is signed by two keys, then holds its fee (`:2656`).
- **New: `mixing_again_pays_for_the_keys_that_sign_each_mix` (`:1300`).** Mix again prices every mix on `first_keys.len().max(mix_keys.len())`, and two arrangements make the halves differ:
  - the collateral at 0/0: two keys sign the first mix, one the next;
  - the paying UTxO at the collateral's key: one, then two.

  It asserts those witness counts, then each fee.

### What the tests failed on

These are test gaps: every test passes on the code as it is. Each mutant was applied to the source, run, and written back byte for byte (sha256 checked); neither source file differs from round one's.

- **The reviewer's three** (`SCRATCH/review/r2-rust/mutant-G*.diff`), which survived all 20 Lovejoin targets in round two:
  - **G1**, `withdraw_with`: `Paying::Account(_) => 1`.
    - Both core tests: "Classic, 500000000 taken, 2 signing: a paid withdraw's fee 296406 for 300848", and "V2, 24 taken, …: 301686 for 306128".
    - The paid-withdraw test: "2 signing: fee 296820 for 301263".
  - **G2**, `mix_with`: `MixCollateral::Own(_) => 1`.
    - Both core tests: "Classic, 500000000 taken, giveme.my's collateral false, 2 signing: fee 821903 for 826346".
    - The chain test, Mix again's and the new one (the chain test: "2 signing: fee 822226 for 826668").
  - **G3**, `deposit_across`: `settle_fee(params, signers.min(1), …)`.
    - Both core tests: "Classic, 500000000 taken: a deposit's fee 173553 for 177997", and "V2, 24 taken: … 175357 for 179801".
    - The chain test: "2 signing: fee 180153 for 184597".
- **The same slip one layer out.** Before this round's edits, each survived the three WebAssembly targets that build public-account transactions, whole: `lovejoin_test` (34), `lovejoin_flows_test` (14) and `lovejoin_mainnet_test` (8). No other target builds one, and every chain core's tests build is signed by one key, where H5 and H6 change nothing.
  - **H1**, `withdraw_paid_in`: `signers: 1`. Fails the paid-withdraw test ("fee 296820 for 301263").
  - **H2**, `chain_from_account_at`: `mix_signers: 1`. Fails the chain test ("fee 822226 for 826668").
  - **H3**, `chain_from_account_at`: `deposit_signers: 1`. Fails the chain test ("fee 180153 for 184597").
  - **H4**, `again_from_account_at`: `signers: 1`. Fails Mix again's test and the new one (Mix again's: "fee 821727 for 826170").
  - **H5**, core's `chain_across`: `signers: 1` in each leg's `Payer`. Fails the chain test ("fee 822636 for 827079").
  - **H6**, core's `chain_across`: `deposit_across(…, 1)`. Fails the chain test ("fee 180153 for 184597").
- **Mix again's `max`:**
  - H4a (`signers: first_keys.len()`) and H4b (`signers: mix_keys.len()`) survived the three extended tests, where both halves are 2.
  - Each fails the new test: "2 signing: fee 822636 for 827079".

Every failure is about 4,443 lovelace short: one signature's bytes at 44 lovelace a byte.

### Not done, and why

- **`wasm/tests/lovejoin_mainnet_test.rs:565` keeps its weak check,** as `lovejoin_flows_test.rs`'s `a_box_comes_back_with_the_public_account_paying` keeps none.
  - Each runs the same WebAssembly path as a test above, on another pool: mainnet's classic pool, and Lovejoin's V1 token pool on preprod. The count of keys doesn't depend on the pool.
  - Core now holds two-key fees on mainnet's classic pool too (`the_classic_pools_take_a_reward_balance_in_every_kind_too`), and on v2's token pool (the v2 test).
- **The WebAssembly check has no upper bound.** Mix again prices every mix on the most keys any of them is signed by, so a mix signed by fewer pays a signature's bytes over, by design. Core's tests hold both bounds.

## Files (worktree, unstaged)

- M `seedelf-platform/seedelf-core/tests/lovejoin_pools_test.rs`
- M `seedelf-platform/seedelf-web-wallet/wasm/tests/lovejoin_test.rs`

No new, moved or deleted file. No source file changed. No user-visible string and no i18n key.

The patch is `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/cfcbd3c7-4fba-46f9-8be7-526fb876c645/scratchpad/fix-r2-rust/r2-rust.patch`. `git apply --check` passes on the main tree as it stands.

## For the lead

- **The review's record** (chunk 43's archived record leaves the fix rounds' tests to it). This round adds:
  - in core's `every_kind_takes`, the two-key deposit, mix under the payer's collateral and paid withdraw;
  - in the WebAssembly crate's `lovejoin_test.rs`, the fee checks from the signed bytes in the public chain's, Mix again's and the paid withdraw's tests;
  - and `mixing_again_pays_for_the_keys_that_sign_each_mix`.
- **r2-rust#2:** nothing in this lane changes what CLAUDE.md's line should say.

## Ran

All in the worktree's `seedelf-platform/`, last:

- **rustfmt:** `cargo fmt --all`, then `cargo fmt --all -- --check`: clean.
- **Clippy, `-D warnings`:** every run exited 0.
  - `cargo clippy -p seedelf-core -p seedelf-wasm --tests`;
  - CI's `cargo clippy --locked -p seedelf-crypto -p seedelf-wasm --all-targets`;
  - each touched target by name: `-p seedelf-core --test lovejoin_pools_test`, `-p seedelf-wasm --test lovejoin_test`.
- **The touched targets, in full:**
  - `cargo test --locked -p seedelf-core --test lovejoin_pools_test`: 41 passed;
  - `cargo test --locked -p seedelf-wasm --test lovejoin_test`: 35 passed.
- **Determinism:** the two core tests and the four WebAssembly ones, 15 runs each: all passed.
- **Mutants:** `python3 -I /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/cfcbd3c7-4fba-46f9-8be7-526fb876c645/scratchpad/fix-r2-rust/mutate.py`, run as:
  - `before H1 … H6`, before any test changed;
  - `core G1 G2 G3`;
  - `wasm G1 … H6`;
  - `wasm H4a H4b`, before the new test;
  - `wasm H4a H4b H4 G2`, after it.

  Every outcome is in that folder's `mutants.jsonl`, with each run's log beside it (`mutant-<id>-<set>.log`, `before-run.log`, `core-run.log`, `wasm-run*.log`).
- **Not run:** no network, no `--ignored`, nothing in seedelf-data, no lake, lean or check.sh, no npm.
