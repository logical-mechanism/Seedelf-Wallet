# 1.9.0's release review: the rust fixer

A fix lane, in a worktree of `8d7c4b0c`, test first. Verbatim from its structured report.

**Branch:** `review-1.9.0/fix-rust`, commit `929f45b5`.

**Files:** `seedelf-platform/seedelf-web-wallet/wasm/tests/cip30_test.rs`, `seedelf-platform/seedelf-web-wallet/wasm/tests/session_test.rs`, `seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs`, `seedelf-platform/seedelf-core/tests/orders_test.rs`, `seedelf-platform/seedelf-core/src/orders.rs`

## Fixed

### mutants#1

**What.** Two tests with a script data hash set, so the native-script term can't hide the other two terms. cip30_test.rs:2447 `a_required_signer_releases_under_a_script_data_hash_too` is the bounty report's shape: 0/0 is a required signer, with the site's collateral, and 49.8 ₳ plus the token goes to a stranger. It kills mutant f. cip30_test.rs:2466 `a_datum_naming_the_accounts_key_counts_under_a_script_data_hash_too` has an inline datum naming 0/0 and no required signer. It kills mutant e.

**Tests.** seedelf-web-wallet/wasm/tests/cip30_test.rs: a_required_signer_releases_under_a_script_data_hash_too, a_datum_naming_the_accounts_key_counts_under_a_script_data_hash_too

**Evidence.** Base (src at 8d7c4b0c): `cargo test -j 4 -p seedelf-wasm --test cip30_test` gives ok. 73 passed (65 old, 8 new).

Mutant f (required-signer term dropped) gives FAILED. 69 passed; 4 failed. The failures are a_required_signer_releases_under_a_script_data_hash_too, a_drep_key_required_signer_releases_too, a_stake_key_releasing_an_input_the_wallet_cant_find_is_said and the_accounts_own_token_of_a_kind_doesnt_hide_the_contracts_taken. All 65 old tests pass under f. session_test: ok. 14 passed.

Mutant e (names_key dropped from key_releases) gives FAILED. 70 passed; 3 failed: a_datum_naming_the_accounts_key_counts_under_a_script_data_hash_too, a_carried_datum_is_hashed_as_written_in_a_set_or_a_list and a_real_v1_cancel_carries_its_orders_datum. The old 65 pass.

Each mutant was restored with `git checkout -- cip30.rs` (clean). Logs: R/fix/rust/logs/mutant-{e,f}-cip30_test.txt.

### mutants#2

**What.** cip30_test.rs:2488 `the_accounts_own_token_of_a_kind_doesnt_hide_the_contracts_taken` uses mut_d2's shape plus a script data hash. The account's 5 ₳ and 1 T, the order's 50 ₳ and 1 T, and 2 ₳ of the site's go in. Out go 54.8 ₳ and 1 T to the account, and 2 ₳ and 1 T to the site, with 0/0 a required signer. Asserted: net +49.8 ₳ with no net tokens, key_releases, released 0 ₳, and released_tokens [1].

**Tests.** seedelf-web-wallet/wasm/tests/cip30_test.rs: the_accounts_own_token_of_a_kind_doesnt_hide_the_contracts_taken

**Evidence.** Base: cip30_test ok. 73 passed.

Mutant d (`back` ignores put_in) gives FAILED. 72 passed; 1 failed. Only this test fails, at the released_tokens length: `left: 0, right: 1`. All 65 old tests pass under d. session_test ok. 14 passed.

Restored clean. Log: R/fix/rust/logs/mutant-d-cip30_test.txt.

### mutants#5

**What.** cip30_test.rs:2522 `a_counterpartys_key_input_isnt_a_contract_utxo` is a co-signed trade with no script data hash. The account's 2 ₳ and 1 T, plus 5 ₳ from account 1 of the same phrase, pay 2 ₳ and 1 T to them and 4.8 ₳ to 0/0. Asserted: others_sign 1, contract_inputs 0, contract_lovelace 0, key_releases false, released 0.

**Tests.** seedelf-web-wallet/wasm/tests/cip30_test.rs: a_counterpartys_key_input_isnt_a_contract_utxo

**Evidence.** Base: ok. 73 passed.

Mutant z1 (at_script always true) gives FAILED. 71 passed; 2 failed:
- this test, at contract_inputs: `left: 1, right: 0`;
- the_accounts_own_token_of_a_kind_doesnt_hide_the_contracts_taken, whose site input then counts as a contract's: released `"2000000"` vs `"0"`.

The old 65 pass under z1. Restored clean.

### cip30-rust#7

**What.** Four probes, given real names.

- r2, cip30_test.rs:2553 `a_stake_key_releasing_an_input_the_wallet_cant_find_is_said`: an input not found, the stake key as required signer, a script data hash. Gives unknown_inputs [TX_B#0], signs [stake], contract_inputs 0, key_releases true, released 0.
- r3, :2569 `a_drep_key_required_signer_releases_too`: the DRep key as required signer, with governance. Gives signs [drep], key_releases, released 49.8 ₳.
- r6, :2586 `a_carried_datum_is_hashed_as_written_in_a_set_or_a_list`: the datum `d8799f581c<0/0>1a00000001ff`, which Pallas would re-encode. It's carried in a hand-written tx, as a tagged set and as a plain list, and gives names_key and key_releases in both.
- r7, :2623 `a_real_v1_cancel_carries_its_orders_datum`: the real Minswap V1 cancel 4044b9cc… (cancel_integrity.json) with its order 74db9b06…#0 (order_cancels.json). The carried datum's raw hash is the order's datum_hash dae9e5dc…. Gives scripts, contract_inputs 1, contract_lovelace 4 ₳, one unknown input (its collateral), and names_key and key_releases false. Then the carried datum's owner key is swapped for 0/0 in the real CBOR, with the body unchanged. That gives names_key and key_releases true, released 4 ₳ minus the fee, and 600000 SNEK.

**Tests.** seedelf-web-wallet/wasm/tests/cip30_test.rs: a_stake_key_releasing_an_input_the_wallet_cant_find_is_said, a_drep_key_required_signer_releases_too, a_carried_datum_is_hashed_as_written_in_a_set_or_a_list, a_real_v1_cancel_carries_its_orders_datum

**Evidence.** Base: ok. 73 passed. Each mutant was restored clean; mutants are in R/fix/rust/mutate.py.

- r2 against mutant r2m (key_releases gated on `contract_inputs > 0`): FAILED. 72 passed; 1 failed, only r2. f kills it too.
- r3 against mutant r3m (required-signer term `is_some_and(|s| s != Signer::Drep)`): FAILED. 72/1, only r3. f kills it too.
- r6 against mutant z2 (carried map keyed by the hash of a re-encoding): FAILED. 72/1, only r6. e and h kill it too.
- r7 against mutant h (carried map unused): FAILED. 70/3 (r6, r7 and the old a_datum_kept_by_hash_is_read_from_the_transaction). e kills r7 too.

The old 65 survive r2m, r3m and z2. A scratch probe showed the real V1 datum re-encodes byte for byte under Pallas, so no real transaction here can hold z2; r6 does.

### cross#3

**What.** session_test.rs:1078 `a_sessions_own_cancel_releases_nothing_away_from_it`, with helper fixture_utxo at :1048.

Each of the 11 mainnet DEX fixtures in order_cancels.json has its datum re-keyed to one-time session 3 (0/3, 2/3). It's cancelled by `orders::cancel_orders` at `api::one_time_address(.., false, 3)` and read by `cip30::inspect_tx` with keys [0/3] and stake_index 3.

Asserted for each: complete; signs contain stake exactly when the DEX signs with its stake key; contract_inputs 1; contract_lovelace equal to the order's; key_releases and names_key; paid empty; released 0 ₳ and no tokens.

**Tests.** seedelf-web-wallet/wasm/tests/session_test.rs: a_sessions_own_cancel_releases_nothing_away_from_it

**Evidence.** Base: `cargo test -j 4 -p seedelf-wasm --test session_test` gives ok. 14 passed; 1 ignored (13 old).

- Mutant c1 (keys_of's stake key from index 0, not the session's stake index): FAILED. 10 passed; 4 failed. The new test fails with 'Minswap: If a contract refused this transaction, your collateral would go to someone else…'. Three old session tests fail too: the_connector_reads_and_signs_a_swap_…, a_withdrawal_from_a_sessions_reward_account_… and a_site_connected_to_a_session_….
- Mutant c4 (fee credit `.saturating_sub(put_in.lovelace)` instead of `went_out`): session_test FAILED. 13/1, the new test only: `Minswap left: "204558" right: "0"`. cip30_test fails only on the new mutants#2 test (`"200000"` vs `"0"`). All 78 old tests pass under c4.
- Mutant h: also fails it.

Restored clean.

### mutants#6

**What.** orders_test.rs:1190 adds the variant "another second module": the second constraint's module is set to OTHER. It's Expect::Unread, in an_order_is_the_sessions_only_when_its_canceller_and_every_payee_are's V4 arm.

**Tests.** seedelf-core/tests/orders_test.rs: an_order_is_the_sessions_only_when_its_canceller_and_every_payee_are (variant "another second module")

**Evidence.** Base: `cargo test -j 4 -p seedelf-core --test orders_test` gives ok. 26 passed.

Mutant z9 (`.take(1)` after `.zip(SUNDAE_V4_ONE_FILL)`):
- with the variant: FAILED. 25 passed; 1 failed, panicking with '"SundaeSwapV4" on "mainnet", another second module';
- with 8d7c4b0c's own orders_test.rs: ok. 26 passed.

Logs: R/fix/rust/logs/mutant-z9-orders_test.txt and logs/pass1/mutant-z9-orders_test-base-suite.txt. Restored clean.

### z5

**What.** orders_test.rs:1198 adds the variant "a constraint of three items": an int is pushed into the first constraint's [module, data]. It's Expect::Unread.

**Tests.** seedelf-core/tests/orders_test.rs: an_order_is_the_sessions_only_when_its_canceller_and_every_payee_are (variant "a constraint of three items")

**Evidence.** Base: ok. 26 passed.

Mutant z5 (`pair.len() == 2` → `!pair.is_empty()` in fills_once):
- with the variant: FAILED. 25 passed; 1 failed, '"SundaeSwapV4" on "mainnet", a constraint of three items';
- with 8d7c4b0c's own orders_test.rs: ok. 26 passed.

Restored clean.

### v4-orders#2

**What.** Comments only.
- orders.rs:23-25 now adds: "SundaeSwap V4's were read on 2026-11-09 from Sundae's SDK and one real owner cancel: its validators are unpublished."
- The orders_test.rs:4-9 header now dates V4's fixture 2026-11-09, and says its cancel's needs rest on Sundae's SDK and that one real cancel, since its validators are unpublished.

**Tests.** No test, comments only. orders_test still ok. 26 passed.

**Evidence.** `git diff -U0` of orders.rs shows only `//!` lines changed (0 non-comment lines). fmt, clippy and orders_test pass on the final tree.

### comment: cip30_test.rs (cip30-rust#2)

**What.** cip30_test.rs:2410: "With the hash, a script runs that can't see the key…" now reads: "With a script data hash, a native script's input can't be told from a Plutus script's: a datum in the witness set alone gives a body one, with no Plutus (1.9.0's release review, cip30-rust#2). Only a required signer or a datum naming the key says the key releases it then."

The same false premise at :2299 ("A Plutus script runs here: the body's script data hash says so") now reads "A script data hash, as a Plutus script's spend has: the native-script term doesn't hold."

**Tests.** No test, comments only.

**Evidence.** Comment lines only. cip30_test ok. 73 passed.

### comment: cip30.rs (critic#1)

**What.** cip30.rs:1827-1832: "A required signer is what a Plutus script can see" now reads "A required signer is how a Plutus script sees a signature". The datum clause now names every other proof of the owner: the owner's own input being spent, or a withdrawal, a certificate or a vote of the owner's key (1.9.0's release review, critic#1). The rest is rewrapped unchanged, within 120 columns.

**Tests.** No test, comments only.

**Evidence.** `git diff -U0` of cip30.rs and orders.rs: 0 changed lines that aren't `//` or `//!`. Every mutant ran with both src files checked out at 8d7c4b0c; the comment edits were copied back after. fmt and clippy are clean on the final tree.

## Not fixed

- **mutants#1 (e2e half):** The finding also suggests giving extension.spec.ts's hand-built tx a script data hash (map a5 with 0b5820…). That file is the words lane's, and the brief gives this lane only the cip30 tests. The new Rust tests now pin the required-signer and datum terms with a script data hash set, so the e2e change is optional.

## Commands

Everything ran in my worktree's seedelf-platform/, with CARGO_TARGET_DIR=$HOME/.cache/seedelf-review-1.9.0/target-fix-rust (seeded from target-mutants), -j 4, and systemd-run --user --scope -p MemoryMax=8G.

Setup:
- git worktree add -b review-1.9.0/fix-rust R/fix/rust/tree 8d7c4b0c → HEAD is now at 8d7c4b0c

Base, before any edit:
- cargo test -p seedelf-wasm --test cip30_test → ok. 65 passed
- --test session_test → ok. 13 passed; 1 ignored
- cargo test -p seedelf-core --test orders_test → ok. 26 passed

Scratch probe (R/fix/rust/zz_fix_rust_probe.rs.txt, removed from the tree before commit):
- real V1 cancel: re-encodes the same: true; inspect: contract_inputs=1 contract_lovelace=4000000 names_key=false key_releases=false released=3791879 unknown=[collateral]; re-keyed datum: names_key=true key_releases=true
- 11 mainnet DEX cancels re-keyed to session 3: every one key_releases=true names_key=true released=0 rtokens=0 paid=0 complete=true

Final tree:
- cargo fmt --check -p seedelf-wasm -p seedelf-core → exit 0 (hand-laid to rustfmt's 100 columns; no formatter run)
- cip30_test → ok. 73 passed
- session_test → ok. 14 passed; 1 ignored
- orders_test → ok. 26 passed
- cargo clippy -j 4 -p seedelf-wasm -p seedelf-core --tests -- -D warnings → exit 0, Finished, 0 warnings

Mutants, second pass against the final tests (R/fix/rust/run.sh with mutate.py). Src was at 8d7c4b0c, and each mutant was restored with git checkout -- <file> → clean:
- d → cip30 FAILED 72/1 [the_accounts_own_token_of_a_kind_doesnt_hide_the_contracts_taken]; session ok 14
- e → cip30 FAILED 70/3 [a_datum_naming_…_under_a_script_data_hash_too, a_carried_datum_…, a_real_v1_cancel_…]; session ok
- f → cip30 FAILED 69/4 [a_required_signer_releases_under_a_script_data_hash_too, a_drep_key_…, a_stake_key_releasing_…, the_accounts_own_token_…]; session ok
- z1 → cip30 FAILED 71/2 [a_counterpartys_key_input_isnt_a_contract_utxo, the_accounts_own_token_…]; session ok
- z2 → cip30 FAILED 72/1 [a_carried_datum_is_hashed_as_written_in_a_set_or_a_list]; session ok
- h → cip30 FAILED 70/3 (incl. the old a_datum_kept_by_hash_…); session FAILED 13/1 [a_sessions_own_cancel_…]
- r2m → cip30 FAILED 72/1 [a_stake_key_releasing_an_input_the_wallet_cant_find_is_said]; session ok
- r3m → cip30 FAILED 72/1 [a_drep_key_required_signer_releases_too]; session ok
- c4 → cip30 FAILED 72/1 [the_accounts_own_token_…]; session FAILED 13/1 [a_sessions_own_cancel_…: Minswap "204558" vs "0"]
- c1 → cip30 ok 73; session FAILED 10/4 [a_sessions_own_cancel_… plus 3 old session tests]
- z9 → orders FAILED 25/1 "another second module"; 8d7c4b0c's orders_test.rs under z9 → ok. 26 passed
- z5 → orders FAILED 25/1 "a constraint of three items"; 8d7c4b0c's orders_test.rs under z5 → ok. 26 passed

The first pass, before the formatting edits, gave the same verdicts (R/fix/rust/logs/pass1/).

Commit:
- git add <5 paths>; git commit → 929f45b5 review-1.9.0 fix: rust
- git status → clean; main tree still 8d7c4b0c, clean

## Notes for the lead

- **The words lane's L3 fix:** `a_stake_key_releasing_an_input_the_wallet_cant_find_is_said` pins the summary that the new unfound-input line reads: keyReleases true, one unknown input, contract_inputs 0, released 0. Mutant r2m (key_releases only with a found contract UTxO) would silently undo L3, and only this test catches it. Check the merged DappApprovals change against this shape.
- **cross#3, and why c4:** the finder said no test would fail if a session's own address were told apart wrongly. That's too strong: its mutant c1 (the stake key taken from index 0) is also caught by three existing session tests. So I also ran c4, a fee-credit mutant all 78 old tests miss. The new session test kills it, and so does the new mutants#2 test.
- **r7 and z2:** the real Minswap V1 datum re-encodes byte for byte under Pallas, so no real transaction here can catch z2; r6 does. To read the carried map, r7 swaps only the witness datum's owner key for 0/0 in the real CBOR, leaving the body as it was.
- **Beyond the brief's line, same finding:** I also reworded cip30_test.rs:2299. It made the same claim as 2410 ("A Plutus script runs here: the body's script data hash says so").
- **Pass-2 log line numbers** predate three doc-comment rewordings in cip30_test.rs. Only comments changed after it, no code.
- **Source edits are comments only:** 0 non-comment lines changed in cip30.rs and orders.rs. Every lane's copied wasm/pkg still matches the merged Rust.
- **No node_modules symlink or wasm/pkg** was created: this lane runs no Node, so there's nothing to unlink.
- **Left in place:**
  - the cargo target at ~/.cache/seedelf-review-1.9.0/target-fix-rust (about 3.3 GB);
  - mutate.py, run.sh, logs/ and logs/pass1/, in R/fix/rust/;
  - the .mine backups there, which are copies of the committed files.

