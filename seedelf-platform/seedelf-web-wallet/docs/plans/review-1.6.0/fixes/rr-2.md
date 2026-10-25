# Fixer rr-2 (Lane R, the last Rust fixer): 321-lj-rust-data#1, 323-rust#2, 321-parts-rust#1, gap-2#0, 321-lj-rust-data#2, 314-core#2, 321-parts-rust#0

Builders and their docs, in core and the WebAssembly, and the WebAssembly README. No TypeScript changed. **No test of mine needs the pkg rebuilt, and nothing a user sees changes after it.** `external_sweep` is 1.5.0's function again, and `with_staking`'s new refusal can't be reached from the wallet: its only caller, a launch, passes a script's cert 0 or nothing.

**The CI's Rust checks pass**, in both workspaces, on the tree as the round left it (details at the end).

## 321-lj-rust-data#1 (nit, docs): **fixed, by removing `external_sweep_with`**

- **Change.** `external_sweep_with` is folded back into `external_sweep` (core `build.rs`), and `extra` is gone with it. `external_sweep` is now 1.5.0's function verbatim, doc and body: diffed against `63f87b8`, identical.
- **Why remove it, not check `extra`.** Both of the brief's conditions hold, and removing is clearly cleaner.
  - **Nothing calls it.** A grep of the whole repo, the CLI, the WebAssembly, core, every test and the data layer included, finds one call: `external_sweep` itself, passing `&[]`. #323 (`24c5c62a`) turned both of the collateral box's calls into plain `build::external_sweep`.
  - **It was never published.** crates.io's seedelf-core 0.5.0 (the last publish; the registry's copy in `~/.cargo` checked) has only `external_sweep`. `external_sweep_with` came on 2026-10-22 in #321 (`4d5bf583`). So removing it deletes no published API: the next publish's `external_sweep` is 0.5.0's.
  - **The transactions can't change.** With `&[]`, `checked_lovelace(total, &[fee, 0])` equals `checked_lovelace(total, &[fee])`, and no output was staged. Now the code is 1.5.0's too.
  - Checking `extra` would have kept a parameter with no use and no test, for a box #323 removed.
- **Test.** None needed, per the finding. The callers' tests pass in the workspace run: the CLI's `tests/cli/external_sweep.rs`, core's `lovejoin_pools_test` (`bootstrap_most`'s sweep), and the WebAssembly's session, Lovejoin and flows tests.

## 323-rust#2 (nit, docs): **fixed**

- `external_sweep_with`'s doc went with it (above).
- **The WebAssembly module doc, step 3** (`wasm/src/lovejoin.rs`). A merged return (`api::merged_return`) puts up and spends the collateral the mixes put up. The return is a sweep into fresh registers (`build::external_sweep`, which runs no script) in three cases: the funding's Seedelf UTxO is spent, a UTxO there can't be measured, or there's no collateral to put up, which is a Bootstrap's session. rr-1's sentence on the tail (`CollateralTail`) stays.
- **`ChainResult.returned`'s doc.** The collateral isn't in it after a `collateral_tail`, which mixed it, nor for a Bootstrap's session, which has none.
- **`bootstrap_most`'s doc**, which the skeptic flagged as stale in the same way: **already fixed** by phase A. It now says the session holds its funding "with no collateral (the owner, 2026-10-23)", and that each count's deposit and sweep are built.
- No test (comments).

## 321-parts-rust#1 (nit, docs) and gap-2#0 (low, docs): **fixed**

The same three stale comments, found twice.
- **`RestTo::Seedelf`:** "into the contract, each output under a fresh re-randomization of its register … Tokens go `MAXIMUM_TOKENS_PER_UTXO` to an output ([`deposit_outputs`])". Checked: `deposit_output` re-randomizes each output.
- **`RestTo::Address`:** "Tokens go `MAXIMUM_TOKENS_PER_UTXO` to an output".
- **`account_send`:** "its tokens `MAXIMUM_TOKENS_PER_UTXO` to an output ([`Payee::Address`])".
- **`carry()`'s** "one output of ADA alone" stays: it sends no token, so it's one output (as the skeptic said).
- **Also, the WebAssembly's `Room::after` comment** (`wasm/src/lib.rs`), which gap-2#0's skeptic named as outside that finding.
  - It said "Only a payment's tokens make one output too large (change goes 20 tokens to an output)", which was #321's state before payments split too.
  - It now says payments go 20 tokens to an output as change does (since 1.6.0), so no output should be too large; the branch stays, as a fallback.
  - Comment only. I changed it because no later lane edits Rust comments.
- **Test (a guard, gap-2#0's test idea):** core `tests/most_test.rs`, `max_pays_what_is_left_twenty_tokens_to_an_output`.
  - One UTxO of 60 ₳ holding 25 kinds of token. Max of all 25, measured in the wallet:
    - to a Seedelf (`transfer_most`, `RestTo::Seedelf`): two outputs, of 20 and 5 tokens, both under the recipient's register. The 20's carries exactly its minimum (`minimum_deposit` of 20 tokens), and the 5's the rest. Nothing stays.
    - to an address (`sweep_most`, `RestTo::Address`): the same, the 20's carrying `minimum_address_payment` of 20 tokens.
  - **Fail-before: none.** It passes on the baseline: the code was right and the docs wrong. It pins what the docs now say.
  - **Mutation:** the rest to a Seedelf as one output (`vec![deposit_output(..)]` in `stage`). The test fails, at `settle`'s chunk-aware count of the rest's outputs (`attempt to subtract with overflow`, build.rs:2030), before its own assertion. Restored: 5/5 pass.

## 321-lj-rust-data#2 (low, docs): **fixed**

`wasm/README.md` (Lane R's folder; no docs lane had touched it):
- **Rows for the 14 exports it lacked.**
  - The skeptic's 12: `buildCollateralMix`, `buildLovejoinLaunch`, `buildLovejoinLaunchFromAccount`, `buildTransferParts`, `buildWithdrawParts`, `lovejoinBootstrapMost`, `lovejoinBoxValue`, `lovejoinCandidate`, `lovejoinCollateralReserve`, `lovejoinLaunchCheck`, `lovejoinUsable`, `lovejoinVerifyPool`.
  - This round's two: `lovejoinBootstrapReserve` (phase A's, from bootstrap's report) and `lovejoinDirectCollateralReserve` (reserve's).
- **`buildSessionReturn`:** the request's `collateralPool` and `collateralBoxes`, and the answer's `tail`: `{ txs, box, leaf, fee }`, its deposit then its mix (`giveme`), sent before the return. `fee` and `lovelace` are then the return's alone, without the collateral's 5 ₳. Where the tail can't be built, the return is as before.
- **`buildLovejoinChain`:**
  - the request: `collateral` absent for a Bootstrap, whose return is then a sweep; `collateralPool`, `collateralBoxes` and `collateralReserve`; `legs`, `fills` and `params` across pools;
  - each transaction's `tail` and `giveme`;
  - the answer's `legs` and `collateralTail`, with `returned` leaving the collateral's 5 ₳ out;
  - pool-exists' change: a deposit into a token pool reads the pool's reference UTxO.
- **`planLovejoin`:** `collateralReserve`, `own`, `legs`.
- **`lovejoinFunding`:** `token`; the reserves the worker adds beside its lovelace; rr-1's refusal, "These boxes cost more ADA than there is".
- **`lovejoinOwned` and `buildLovejoinWithdraw`:** `token`.
- **A shared row** for chunk 34's `poolRef` (`{ reference, seed, scripts }`, verified on every call) and `width` (3 or 4).
- **The parts row**, as max-left's notes asked: each part is a `buildTransfer` or `buildWithdraw` result, and a chain's part waits for its carry. The last part carries `left` and `leftWhy` (`tokens`, `fee` or `limit`). Max over no UTxOs throws one transaction's words.
- **`lovejoinVerifyPool`:** deep-datum's rule. A script row under a datum the wallet can't read isn't a reference, so `scriptsInline` counts its script.
- **The Test section** names the new test.
- **How the rows were checked:** each against its request and result struct and its doc in `lib.rs` and `lovejoin.rs`, field by field.
- **Test:** wasm `tests/readme_test.rs`, `the_readme_names_every_export` (the finding's test idea).
  - It checks that every `js_name` and `js_class` in `wasm/src/*.rs`, and every item a bare `#[wasm_bindgen]` exports, is a whole word in the README.
  - It checks names only. Methods of an exported `impl` with no `js_name` (`accounts.address`) aren't collected; every one today is in the table.
  - **Fail-before:** the test pointed, temporarily and in the test only, at the baseline README (`git show 9978654a:…`, a scratch copy). The real README wasn't touched. It failed: `wasm/README.md's export table doesn't name ["buildCollateralMix", "buildLovejoinLaunch", "buildLovejoinLaunchFromAccount", "buildTransferParts", "buildWithdrawParts", "lovejoinBootstrapMost", "lovejoinBootstrapReserve", "lovejoinBoxValue", "lovejoinCandidate", "lovejoinCollateralReserve", "lovejoinDirectCollateralReserve", "lovejoinLaunchCheck", "lovejoinUsable", "lovejoinVerifyPool"]`.
  - **Mutation:** `lovejoinUsable`'s row renamed: `doesn't name ["lovejoinUsable"]`. Restored: passes.

## 314-core#2 (nit, correctness): **fixed**

- **Change.** `ScriptSpend::with_staking` (core `build.rs`) now takes only Shelley's registration (cert 0) of a script's credential. Of a script's certificates, that's the one the ledger asks no witness for.
- **What's refused**, before anything is built:
  - a script's Conway registration with a deposit (7);
  - its deregistrations (1, 8) and delegations (2);
  - any key's certificate;
  - a withdrawal or a vote.
- **The words** (core's are English): "A Seedelf spend takes only a script's stake registration: any other certificate, a withdrawal or a vote needs a signature or a script the spend doesn't add".
- **The rule** is a new `pub(crate) Staking::registers_scripts_alone()` (`staking.rs`). `is_scripts`' doc now says a script may have to run instead.
- **`stake_signs()` and `signers()` are unchanged.** They still mean "the stake key signs", for the fee and the signing.
- **Test:** core `tests/staking_test.rs`, `a_seedelf_spend_takes_no_certificate_whose_witness_it_never_adds`.
  - A script's cert 0 goes in, and so does no staking at all.
  - Each of these, beside a good cert 0, is refused in those words: `Reg(script, 2 ₳)`, `StakeDeregistration(script)`, `UnReg(script, 2 ₳)`, `StakeDelegation(script, pool)`, a key's `StakeRegistration` and `StakeDelegation`. So is a withdrawal.
  - **Fail-before:** `Reg(ScriptHash(Hash<28>("5c5c…5c")), 2000000) went in`.
  - **Mutation:** the old predicate put back (`withdrawal || votes || signers() > 0`): the same failure. Restored: `staking_test` passes 20/20, and `lovejoin_launch_test` 8/8. Its `a_launch_makes_a_pool_the_wallet_trusts` asserts the launch's one certificate, mix_logic's cert 0, so the launch still goes through.
- **Not changed: `refund()` and cert 1's refund.** A Seedelf spend can't carry cert 1 now, and the account builders never build one (an unregistration is `UnReg` with its deposit).

## 321-parts-rust#0 (low, compat): **skipped-scope**

CLI-only: seedelf-cli's sweep default (`commands/sweep.rs:129-160`). For 21 or more tokens it works out one output's minimum, under the shared builder's floor of each 20-token output's least added up. The web wallet doesn't use it.
- **For a later CLI pass:** work out the default and the pre-check from `build::minimum_address_payment(&params, &addr, &selected_tokens)`.
- **Test idea (the finding's):** `tests/cli/sweep.rs`, one UTxO of 21 tokens swept with no `--lovelace`.

## Files touched

- `seedelf-platform/seedelf-core/src/build.rs`:
  - `external_sweep_with` removed, so `external_sweep` is 1.5.0's;
  - the `RestTo` and `account_send` docs;
  - `with_staking`.
- `seedelf-platform/seedelf-core/src/staking.rs`: `registers_scripts_alone`; `is_scripts`' doc.
- `seedelf-platform/seedelf-core/tests/staking_test.rs`: one test, two imports.
- `seedelf-platform/seedelf-core/tests/most_test.rs`: one test.
- `seedelf-platform/seedelf-web-wallet/wasm/src/lovejoin.rs`: the module doc's step 3; `ChainResult.returned`'s doc.
- `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs`: `Room::after`'s comment, nothing else.
- `seedelf-platform/seedelf-web-wallet/wasm/README.md`: the API table, and the Test section.
- `seedelf-platform/seedelf-web-wallet/wasm/tests/readme_test.rs`: new.

## Keys

None added or changed, critical or other.

## Docs to update

1. **`WW/docs/plans/chunk-34-token-pools.md`, 34g's record of this review** (and the Session 10 line, :967, if history is annotated): `external_sweep_with` was folded back into `external_sweep`. It was unused since #323 and never published; core's `external_sweep` is 1.5.0's again.
2. **The same record, and :490** ("certificates patched in (`with_staking`) … asks no key of a script's credential"): `with_staking` takes only a script's registration with cert 0. Any other certificate, a withdrawal or a vote is refused in words, since the spend adds no witness for it (314-core#2).
3. **`seedelf-platform/CLAUDE.md:61`, optional:** `pay_rest(RestTo, tokens)` pays what's left, its tokens 20 to an output.
4. **`wasm/README.md`:** done here. Bootstrap's, reserve's, max-left's and rr-1's README items are in it, so the docs lane needn't touch it.
5. **No `privacy.md` change, and no policy entry:** nothing new is sent, asked or shown.

## Calls the owner might overturn

1. **Removing `external_sweep_with`**, rather than checking its `extra` and testing it (the brief preferred keeping a public function). Removal stands on the reasons above: no caller, never published, and `external_sweep` back to 1.5.0's code.
2. **The README check is a new native test**, so an export added without a README row fails `cargo test --workspace`, and so CI. It checks names only.
3. **`with_staking` still refuses a key's cert 0**, as the old rule did (through `signers()`). The ledger asks no witness for any cert 0, so a Seedelf spend could carry a key's. But no caller wants it, and taking it would need `signers()` changed for the fee. It isn't a refusal a user meets: the wallet's only caller is a launch.
4. **The refusal's words** are mine.
5. **`Room::after`'s comment** is outside my findings (above).

## Notes for the lead and other fixers

- **The pkg rebuild:** no test of mine needs it, and no TypeScript changed. After the rebuild, nothing a user sees changes (see the top).
- **seedelf-core's public API:**
  - `external_sweep_with` is gone (never published; nothing called it);
  - `with_staking` refuses more, only what the node would refuse.
  - The CLI builds, and every workspace target compiles with no warnings.
- **Scratch files** (`rr-2-*` in the scratchpad): logs, the baseline README copy and the export list. No private pkg was built, so there's nothing to delete in `wasm/`.

## Checks run

Every one on the shared tree as it stood at the end of my work: all six Lane R fixers' Rust, and other lanes' TypeScript mid-edit, which none of these reads.

**From `seedelf-platform/`, the CI's three:**
- `cargo fmt --all -- --check`: clean. Its one diff was my own new test in `most_test.rs`, which I formatted with `rustfmt` on that file alone.
- `cargo clippy --locked -p seedelf-crypto -p seedelf-wasm --all-targets -- -D warnings`: clean.
- `cargo test --workspace --locked`: exit 0.
  - 65 test binaries and 6 doc-test sets: 684 passed, 0 failed, 12 ignored.
  - The 12 ignored: 10 live Koios tests, the slow shapes harness (`every_shape_goes_in_parts_the_ledger_takes`), and the session-swap fixture recorder.
  - My three new tests are among the passes, and so is the CLI's harness, 18/18 (its two external sweeps included).

**Also from `seedelf-platform/` (not the CI's):**
- `cargo clippy --locked -p seedelf-core --all-targets -- -D warnings`: clean.
- `cargo check --workspace --locked --all-targets`: clean, with no warnings. The CLI builds.
- Targeted runs, each with its fail-before and mutation runs above: `staking_test` 20/20, `lovejoin_launch_test` 8/8, `most_test` 5/5, `readme_test` 1/1.

**From `seedelf-data/`, the CI's three:**
- `cargo fmt --all -- --check`: clean.
- `cargo clippy --locked --all-targets -- -D warnings`: clean.
- `cargo test --locked`: exit 0. 10 binaries: 123 passed, 0 failed, 30 ignored (the live tests).

**Nothing failed, so nothing needed fixing.** That's this round's Rust (deep-datum's, pool-exists', max-left's, reserve's, rr-1's and mine) and seedelf-data's (phase A's data fixes and deep-datum's).

**Not run:**
- `wasm/build.sh` and the node tests: the lead's. None of my changes alters what the module does (comments, the README and a native test; core's `external_sweep` the same code; `with_staking` never reached from WebAssembly). No Rust has changed since rr-1's private-pkg node run (57/57) but mine.
- Vitest and `npm run typecheck`: no TypeScript changed.
