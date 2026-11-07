# 1.8.1's review of its merged fixes · r2-rust

Lens: **the Rust as merged.** `Rewards::of` and its callers, the new tests in `seedelf-core/tests/` and `wasm/tests/`, `lovejoin_proven_bytes_test.rs` and what it pins, and `withdraw_zero.rs`'s comment. Read on the main tree (`git diff HEAD`), mutants in R2.

**In short.** No defect in the merged Rust. `Rewards::of` reaches one caller, `RewardsIn::read`, and the worker never sends it a hash twice. The new tests hold what they claim, and they're deterministic: 25 runs of the core ones and 15 of the WebAssembly ones, no failure. Two findings:

- **r2-rust#1 (low, test gap):** no test holds a Lovejoin fee when two keys sign. Three mutants that price one signature for two survive all 20 Lovejoin targets. The round's own new WebAssembly tests build that case and check only totals.
- **r2-rust#2 (nit):** `seedelf-platform/CLAUDE.md:86` (the lead's edit #6) says the proven-bytes test holds seedelf-verification's script files to `Set::V2`. It holds three of the four.

## Findings

### r2-rust#1 · low · test gap: no Lovejoin fee is held to the ledger's when two keys sign

`seedelf-core/tests/lovejoin_pools_test.rs:1648` (`every_kind_takes`), with its `payer()` at `:860`, which has `signers: 1`.

- **The claim.** money#1's fix says every kind pays the ledger's minimum fee. `every_kind_takes` holds that only for a payer with one key: `payer()` puts the fee UTxO and the collateral at one address, `session(flag)`.
- **What the wallet builds.** The public account's transactions often have two keys signing, since the fee UTxO and the collateral can sit at different addresses:
  - a paid way back: `withdraw_paid_in`, `signers: keys.len()` (`wasm/src/lovejoin.rs:2791`);
  - Mix again: `again_from_account_at`, `signers: first_keys.len().max(mix_keys.len())` (`:2521`);
  - a public chain's deposit and mixes: `deposit_signers: deposit_keys.len()` and `mix_signers: mix_keys.len()` (`:2362–2363`).
- **Core prices from those counts:**
  - `mix_with`: `MixCollateral::Own(_) => payer.signers` (`mod.rs:1136`);
  - `withdraw_with`: `Paying::Account(p) => p.signers` (`:1667`);
  - `deposit_across`: `settle_fee(params, signers, …)` (`:813`).
- **The round's own tests build the two-key case without holding its fee.**
  - In `mixing_again_from_the_public_account_leaves_the_balance_it_took_there`, the fee UTxO is at Receive/4 and the collateral at Receive/7. In `a_box_brought_back_paid_takes_the_pools_balance_into_its_register`, they're at Receive/2 and Receive/0.
  - Both check totals (`returned + fees`, `paid == fee`), never the fee against the ledger's.
  - The older two-key tests check which keys sign, never the fee: `the_public_account_mixes_straight_in_signed_by_the_keys_it_spends` (`:773`), `…its_own_boxes_again…` (`:1092`) and `lovejoin_flows_test.rs`'s `a_box_comes_back_with_the_public_account_paying` (`:654`).
- **Evidence: mutants in R2.** Each was applied with sed, run against the 20 targets the mutation lens sweeps, and restored (sha256 checked):
  - **G1:** `Paying::Account(_) => 1`;
  - **G2:** `MixCollateral::Own(_) => 1`;
  - **G3:** `settle_fee(params, signers.min(1), …)` in `deposit_across`.

  All three survived every target. The 20 targets are core's `lovejoin_pools_test` (41), `lovejoin_test` (31), `lovejoin_mainnet_test` (8), `lovejoin_planner_test` (13), `lovejoin_width_test` (4), `lovejoin_launch_test` (8), `lovejoin_box_value_test` (2), `lovejoin_vectors_test` (3), `withdraw_zero_test` (6) and `--lib` (2); and the WebAssembly crate's `lovejoin_test` (34), `lovejoin_flows_test` (14), `lovejoin_mainnet_test` (8), `lovejoin_pools_test` (6), `lovejoin_across_test` (4), `lovejoin_v2_fixture_test` (5), `session_test` (13), `return_cost_test` (5), `api_test` (86) and `cip30_test` (49). Logs: `SCRATCH/review/r2-rust/mutant-G{1,2,3}.log`.
- **Evidence: repro 2.** `CORE/tests/zz_r181_r2_rust_2.rs`, run in R2 and then deleted; a copy is in `SCRATCH/review/r2-rust/`. It builds a payer whose fee UTxO and collateral are at two keys (`signers: 2`), on preprod's classic pool, and holds each fee to the ledger's minimum for two signatures, worked out as `ledger_minimum_fee` does.
  - **Merged code: passes.** Mix 826,171 for a minimum of 826,170; paid withdraw 300,674 for 300,672; deposit 177,997 for 177,997.
  - **G1:** `paid withdraw: fee 296230 for 300672`, 4,442 short.
  - **G2:** `mix: fee 821727 for 826170`, 4,443 short.
  - **G3:** `deposit: fee 173553 for 177997`, 4,444 short.
- **The failure it lets through.** A slip that prices one signature where two sign passes CI. The node then refuses with `FeeTooSmallUTxO` every public mix, Mix again and paid way back whose fee UTxO and collateral sit at two keys. Nothing is lost, but those flows are stuck until a fix ships. Nothing short of a live run notices: the extension's fakes never price a fee, and only inject a `FeeTooSmallUTxO` refusal where a test asks for one.
- **Smallest fix, test first.**
  - In `every_kind_takes`, build the mix under the payer's own collateral and the paid withdraw again with a two-key payer (`Payer { signers: 2, .. }`, its collateral at another key), and hold each to `ledger_minimum_fee(.., 2, ..)`. Add a two-key deposit beside them, or the repro as it is. Each fails on its mutant above.
  - Better still, in the WebAssembly tests that already build two-key public transactions: hold each signed transaction's fee to the minimum worked out from its own signed bytes. A transaction under its own collateral comes back fully signed, so there's no signer count to copy from the code.

### r2-rust#2 · nit · CLAUDE.md says the test holds every script file of `Set::V2`; it holds three of four

`seedelf-platform/CLAUDE.md:86` (the lead's merge edit #6)

- **What it says.** "`Set::V2` … the bytes `seedelf-verification` proves (`seedelf-wasm`'s `lovejoin_proven_bytes_test.rs` holds its script files to these, …)".
- **What the test reads** (`wasm/tests/lovejoin_proven_bytes_test.rs:15–22`):
  - `Template/Scripts/{mix_logic,mix_box,one_shot_mint}.hex`;
  - `Scripts/reference_holder.hex`, which isn't in `Set::V2`.

  It leaves out `Template/Scripts/fee_contract.hex`. That is `Set::V2`'s fourth template (`FEE_CONTRACT`), and seedelf-verification proves things about it too (`Template/FeeContract.lean`).
- **What it is.** CLAIMS.md is exact: fee_contract is out of the claim, and the rust lane left it out on purpose. Only CLAUDE.md's "its script files" says more than the test holds.
- **Checked:** `fee_contract.hex` is byte for byte core's `FEE_CONTRACT` (both hash to 3698bbfd…), so holding it costs one line.
- **Fix:** either bind the destructure's `_` and add `assert_eq!(hash(FEE_CONTRACT), fee_contract)`, or reword CLAUDE.md to "holds the template files CLAIMS.md's rows are about (mix_logic, mix_box, one_shot_mint), and reference_holder's, to these".

## Checked, and held

### `Rewards::of` and its callers

**`Rewards::of` (`mod.rs:598–604`)** collects, then keeps only non-zero balances, so the last entry for a hash wins, a 0 included. It has one caller outside tests, `RewardsIn::read` (`wasm/src/lovejoin.rs:120–139`).

**Repro 1** (`WASM/tests/zz_r181_r2_rust_1.rs`, run on the main tree by its own target, then deleted; a copy is in SCRATCH):
- **Order:** "last" means last in the `BTreeMap<String,String>`'s key order, not the request's. The all-lower-case key always sorts last:
  - `{"AB…":"5","ab…":"0"}` and `{"ab…":"0","AB…":"5"}` both read as none;
  - `{"AB…":"0","ab…":"5"}` and `{"ab…":"5","AB…":"0"}` both read as 5.
- **Case:** upper case alone reads as the same hash.
- **Duplicates:** one key twice in the JSON text keeps the last, through serde.
- **Parse:**
  - `"+5"` and `"0005"` parse as 5;
  - a JSON number is a deserialization error.

**None of it is reachable.** The worker writes each pool once:
- `rewardsField`: `Object.fromEntries` keyed by `mixLogicOf`'s hash, which is WebAssembly's `hex::encode`, lower case;
- the hash read once per pool id, in `rewardsIn`;
- each amount as `readBalance`'s `^\d{1,20}$`, capped at all the ADA there is.

So the change only matters for a request the worker never sends. Every request's `rewards` is `#[serde(default)]`.

**Each WebAssembly entry point reads `rewards` once, and every build in it shares that one `Rewards`:**
- `chain_at` (`:1596`) and `chain_across_pools` (`:1792`) share theirs with `with_return`'s tail;
- `collateral_mix` (`:557`), `again_from_account_at` (`:2531`), `withdraw_in` (`:2698`) and `withdraw_paid_in` (`:2801`) read it once;
- `withdraw_private_in` reads it once, before its loop over UTxOs (`:2896`);
- `session_return`'s direct tail reads it once (`lib.rs:1423`).

`chain_from_account_at` reads it once (`:2340`), and each of its retries takes a fresh `rewards.clone()` (`:2372`). That's right, since only the try that builds is used. A tail at depth 0 can't miss its pool's balance now that a Bootstrap reads none (worker#5): `intoPool` needs `!depositOnly(record)` (`sessions.ts:4547`), and depth 0 is only a Bootstrap's or a seed's.

**The worker and WebAssembly agree on the account's bytes:** `"f0"`/`"f1"` + hash in `rewardsIn`, `reward_account`'s `0xf0`/`0xf1` in core, and lower-case hex from `txWithdrawals`. The balance lane's `takenOf` sums `readsFor`'s takes from the built bytes, and the WebAssembly tests show the take reaches `returned` and the public change.

**CLAUDE.md's "Every Lovejoin builder whose transactions run `mix_logic` … takes a `&mut lovejoin::Rewards`; not the deposits or a pool's start"** matches core's public functions:
- they take one: `again`, `again_at`, `chain`, `chain_across`, `chain_from`, `collateral_mix`, `collateral_tail`, `mix`, `mix_giveme`, `withdraw`, `withdraw_paid`, `withdraw_private`;
- they don't: the deposits and the launches.

### The new tests

**Independence.**
- **`ledger_minimum_fee`** works the fee out apart from the builder:
  - its own exact rationals, one ceiling over the summed units, as the ledger's `txscriptfee`;
  - the reference scripts of every spent and reference input, counted without merging duplicates;
  - a flat 15 lovelace a byte, which is exact here. Every transaction's reference scripts are under 25,600 bytes (the files are 594 to 3,487 bytes each), so Conway's tiers never apply.
- **Signer counts.** The counts it's given (1, 2, 1, 2) match who must sign:
  - giveme.my alone for a withdraw the box pays;
  - giveme.my and the one-time key for a private withdraw;
  - the account for the account's;
  - giveme.my beside the payer for a giveme.my mix.

  They're the builder's numbers too, but right, and they caught N1 and N3. Two keys are r2-rust#1.
- **`balances`** checks inputs + withdrawals = outputs + fee from the bytes, for ADA and every token. These transactions carry no certificate or mint for it to miss.
- **`declares_what_it_uses`.**
  - For mixes it's independent: `mix_with` only checks that the finished transaction evaluates.
  - For withdraws it measures the same transaction again, with the same evaluator and the same `known`, after `withdraw_with` has already checked `declared.covers(measured)` on it. It adds nothing there, and loses nothing.
- **The collateral returns** (`5 ₳ − 3/2·fee`, and `−1` more for the payer's own) copy the builder's formula. Both satisfy the ledger's `collateral·100 ≥ fee·150`, and giveme.my's fee is asserted even.
- **The paid withdraw's top-up** is 0 for every pool `every_kind_takes` uses. Its comment ("makes up only what's still short") is held by chunk 43's poor-pool test, where the take covers it all. Every mutant I tried that ignores the take in the top-up dies there or in `balances`.

**Determinism.**
- 25 runs of core's four new pool tests, and 15 runs each of the five new WebAssembly tests and core's two `lovejoin_test` ones, all passed. `lovejoin_proven_bytes_test` is pure, and the cip30 block's test passed too.
- What's random is `made_up_box`'s last hash byte, the points, the proofs and the permutations. Every assertion relates a transaction to its own fee and outputs, and no two made-up hashes can collide.

**What each holds:**
- **chain_across:** `Chain::change` is the last mix's change, threaded through the legs.
- **The WebAssembly tests:**
  - their 5 ₳ pool is V1 (`five()`), but the rewards plumbing doesn't depend on the set;
  - V2 is held in core;
  - V1 deposits succeed in WebAssembly only because the worker, not WebAssembly, refuses retired pools.
- **The cip30 block** names the proposal's return alone; `paid_scripts` is sorted and deduped.
- **The core test docs:** each claim matches its assertions.

### `lovejoin_proven_bytes_test.rs`

**Paths.** `../../../../seedelf-verification/…` from `wasm/tests/` reaches the repository's root. All five `.hex` files are tracked and one line each; `trim()` takes a trailing newline or CRLF.

**What it pins.** The four files are exactly the bytes of CLAIMS.md's Lovejoin rows:
- `BoxPurposesAll.every_context_iff` → `mixBoxTemplate`;
- `mix_logic_accepts_iff` → `mixLogicTemplate`, at `nftName = "lovejoin"`, which is core's `NFT_NAME`;
- `one_shot_mint_accepts_iff` → `oneShotMintTemplate`;
- `reference_holder_every_context_errors` → `Lovejoin/Scripts/reference_holder.hex`, 288fea77….

`unapplied_hashes_in` hashes core's own bundled bytes, so equal hashes mean equal bytes.

**The mainnet pool.** The seed `6db8a313…#3`, P `fcb3f5ec…`, L `a6a85074…` and M `dd94113c…` match the head start (`lovejoin-pools.json`'s second mainnet pool: its seed, its datum's M and L, and its scripts' hashes). `lovejoin-pools-head-start.test.ts` verifies that pool through the real WebAssembly. So CLAIMS.md:19 is accurate. It "derives that pool's … from them" by way of core's copy, which the first test ties to the files hash for hash.

**CI.** The `rust` job checks out the whole tree (`actions/checkout@v4`, not sparse). The test runs in `cargo test --workspace --locked` and compiles in clippy's `--all-targets`. The `changes` filter skips the job for a pull request that touches only `seedelf-verification/`, so a hex-only edit goes red only on main's push run. That's the owner's call (FIXBRIEF), and only a note here.

**A published crate.**
- `seedelf-wasm` is `publish = false`.
- `seedelf-core` is published with its `tests/`, and `lovejoin_pools_test.rs` now reads the WebAssembly crate's two v2 fixtures by path, as `lovejoin_width_test.rs` and `wasm_profile_test.rs` already read files outside the crate. `cargo publish` builds the library alone, so publishing works; those test targets don't build from an unpacked `.crate`.

**A sparse checkout.** Without `seedelf-verification/`, this target fails to compile, and so does `cargo test --workspace`, which compiles every target first. A scratch crate showed it: `cargo test` gives "couldn't read `tests/../../../../seedelf-verification/…`", and `cargo build` passes. Unaffected:
- `cargo build`;
- `wasm/build.sh` (the cdylib alone);
- `cargo test -p seedelf-core`;
- the extension's builds.

No documented flow checks out part of the repository.

### Docs and the lead's edits

- **`withdraw_zero.rs`'s comment** (the lead's edit #4): `WithdrawalsNotInRewards` (CERTS, PV10), then `ConwayIncompleteWithdrawals` from protocol version 11. That's `hardforkConwayMoveWithdrawalsAndDRepChecksToLedgerRule`, `pvMajor > 10` (v-pv11-trace.md). Accurate.
- **`extract-lovejoin-v2.sh`** (the lead's edit #5): `bash -n` passes, and its Python heredoc parses. The edits are comments and two print strings.
- **`Withdraw::lovelace` and `withdraw_paid`'s docs** (core#3) match `into_register` and `paid_back`.
- **Every `.hex` file's hash** matches its doc:
  - templates: 6878ed6f…, 7fb45b75…, 2365a62d… and 3698bbfd…;
  - classic: c145c10f…, 0dad3046…, a072c7e8… and f5592689…;
  - reference_holder: 288fea77…;
  - V2 applied: 60294352….

## How

- **Read:** the merged diff of every Rust file, the docs that name the test, `RewardsIn`, every WebAssembly entry point that reads `rewards`, the worker's `rewardsIn`, `rewardsField`, `readsFor` and `takenOf`, and the Lean imports behind CLAIMS.md's rows.
- **Repro 1:** `WASM/tests/zz_r181_r2_rust_1.rs` on the main tree, by its own target, then deleted.
- **Repro 2 and mutants G1–G3:** in R2, each restored by `git checkout` and checked by sha256. The repro file is deleted, and `git -C R2 diff` prints nothing.
- **Determinism:** the test binaries on the main tree, run by name.
- **Scratch:** everything is in `SCRATCH/review/r2-rust/`: the logs, the mutant runner, both repros and the sparse-checkout probe.
- **Not run:** no network, no `--ignored`, nothing in seedelf-data, no lake, lean or check.sh, no npm.
