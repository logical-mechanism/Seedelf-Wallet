# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See the repository root [CLAUDE.md](../CLAUDE.md) for the cross-cutting picture (contract ↔ Rust hash coupling, on-chain invariants, release versioning). This file covers what is specific to the Rust workspace.

## Workspace layout

Cargo workspace rooted at [Cargo.toml](Cargo.toml), resolver `"3"`, edition `2024`. Members:

- [seedelf-crypto](seedelf-crypto/) — BLS12-381 primitives, the `Register { generator, public_value }` datum, and the Schnorr Σ-protocol prover. Must match [seedelf-contracts/lib/schnorr.ak](../seedelf-contracts/lib/schnorr.ak) byte-for-byte.
- [seedelf-koios](seedelf-koios/) — REST client for Koios (UTxO queries, tx submit/evaluate) and the giveme.my collateral service. Depends on `seedelf-crypto` (for `Register`).
- [seedelf-core](seedelf-core/) — wallet domain logic: address/asset/UTxO selection, [constants.rs](seedelf-core/src/constants.rs) (hardcoded script hashes and reference UTxOs per `variant`), tx building on Pallas 0.35.
- [seedelf-display](seedelf-display/) — TUI formatting, colors, version-check helpers.
- [seedelf-cli](seedelf-cli/) — CLI crate: a thin [main.rs](seedelf-cli/src/main.rs) binary shim over a [lib.rs](seedelf-cli/src/lib.rs) library target. The split exists so the offline integration tests in [tests/cli/](seedelf-cli/tests/cli/) can drive the command `run()` functions directly. One file per subcommand under [src/commands/](seedelf-cli/src/commands/); `util/` and `external/` are subcommand groups with their own `mod.rs`.
- [seedelf-web-wallet/wasm](seedelf-web-wallet/wasm/) — `seedelf-wasm`, the web wallet's WebAssembly bindings over `seedelf-crypto` and `seedelf-core` (`publish = false`). Built by `wasm/build.sh` with `[profile.wasm-release]`.

Also in this folder but **not** a Cargo member (bar its `wasm/` crate above):

- [seedelf-web-wallet](seedelf-web-wallet/) — the Chrome extension wallet.
  - Start with its [README](seedelf-web-wallet/README.md).
  - [docs/post-release-roadmap.md](seedelf-web-wallet/docs/post-release-roadmap.md) holds the decisions and what comes next; [docs/roadmap.md](seedelf-web-wallet/docs/roadmap.md) holds the handoff notes.
  - **Branching:** web-wallet work branches from **`main`** as `web-wallet/<topic>`, and PRs go back into `main`. The long-lived `seedelf-web-wallet` branch was merged into `main` (PR #266) and is finished; don't start new work on it.
  - **Private and Public:** the web wallet's screens call the Seedelf balance the *private balance* and the Cardano account the *public account*, with the flows *Make private* (move in), *Make public* (withdraw) and *Send* on each side. The code and the docs' internals keep the older names.
  - **Writing the name (the web wallet's style, not the CLI's):** always *Seedelf* (a Seedelf, Seedelfs), and *Seedelf Wallet* for the app, in anything the web wallet shows: its UI, its messages (core's too, since it shows them), its docs and the store listing. Lowercase only in code, and never in the frozen derivation strings. `extension/tests/words.test.ts` enforces it.
- `_reference/` — gitignored third-party checkouts, such as Lace, for reading only.

Dependency direction: `cli` → `core`, `display`, `koios`, `crypto`; `seedelf-wasm` → `core`, `koios`, `crypto`; `core` → `crypto` + `koios`; `display` → `koios`; `koios` → `crypto`. Nothing depends on `seedelf-cli`, and it's intentionally NOT in `[workspace.dependencies]` / `[patch.crates-io]` — its library target is consumed only by its own `main.rs` and `tests/`. The workspace patch table rewrites the published `seedelf-{core,crypto,koios,display}` crates to local paths so edits propagate without a publish — never remove this when bumping versions, and always bump `[workspace.package].version` together with the `[workspace.dependencies]` entries (they must match).

## Common commands

```bash
# build / install the CLI
cargo build --release --bin seedelf-cli
cargo install --path seedelf-cli --bin seedelf-cli
cargo run -- help                    # from workspace root

# tests
cargo test --workspace --locked      # whole workspace, offline (as CI runs it)
cargo test -p seedelf-crypto         # one crate
cargo test -p seedelf-crypto schnorr # filter by name

# the live Koios tests only (they need the network)
cargo test -p seedelf-cli --test koios_test -- --ignored
cargo test -p seedelf-core --test utxos_test -- --ignored
```

Tests that ask the public Koios for real are marked `#[ignore = "live Koios"]` (seedelf-cli's [koios_test.rs](seedelf-cli/tests/koios_test.rs), and the `find_*` tests in seedelf-core's [utxos_test.rs](seedelf-core/tests/utxos_test.rs)), so the default run and CI stay offline. Run them on purpose with `cargo test -- --ignored`, named by file as above: they depend on what's on chain, so a change there can fail them. A bare `cargo test -- --ignored` at the workspace root runs every ignored test, seedelf-wasm's `record_the_extensions_session_swap_fixture` too, which rewrites an extension fixture. A new test that reaches the network gets the same mark, or goes through a mock (`wiremock`) as [tests/cli/](seedelf-cli/tests/cli/) does.

Formatting is governed by [rustfmt.toml](rustfmt.toml). No project-level lint script — rely on `cargo clippy` if running lints.

## CLI conventions

- Two global flags live on the root `Cli` and are threaded through every command: `--preprod` (network selector) and `--variant <u64>` (contract variant, defaults to `seedelf_core::constants::VARIANT`). When adding commands, plumb both — `seedelf-core::constants::get_config(variant, preprod)` returns the right script hashes and reference UTxOs (`true` is preprod, `false` mainnet, as for every network flag in the workspace).
- Every subcommand `run` is `async` and returns `Result<_, _>`; `lib.rs`'s `run()` matches and `eprintln!`s the error. Keep that pattern when adding commands.
- **Transaction building is moving into network-free builders in [seedelf-core/src/build.rs](seedelf-core/src/build.rs)**, shared with the web wallet (which calls them through WebAssembly). A builder takes chain data the caller already fetched (protocol parameters, Koios `UtxoResponse`s) and returns an unsigned transaction; `run` keeps the network calls (Koios, the collateral service, submit) and the signing.
  - Done: `external sweep` (`build::external_sweep`), the web wallet's move-in and its send from the Cardano account (`build::move_in` / `account_send_many`, one to 20 recipients, each a key address or a seedelf, the shape of the CLI's `fund` from the account; `account_send` is its one-address case; account payments to `Payee`s), `util mint` (`build::mint`), `transfer` (`build::transfer` / `transfer_from`, and the web wallet's Max, `transfer_most`), `sweep` (`build::sweep` / `sweep_from` / `sweep_all`, `sweep_many` / `sweep_many_from` for several addresses, and `sweep_most`, the most a payment of some tokens can be), `remove` (`build::remove`), an account-paid mint for the web wallet (`build::account_mint`, the shape of the CLI's `create`, whose `run()` still builds inline), and the web wallet's staking and own-DRep transactions (`build::account_staking`, whose `Staking` carries the stake and DRep certificates, a withdrawal and the DRep's votes). The web wallet calls the history-aware forms `mint_apart`, `transfer_apart` and `sweep_many_apart`, which keep UTxOs of different `Histories` apart where they can. The fee helpers (`fake_signer`, `linear_fee`, `settle_fee`, `even`, `collateral_output`) live there too, and so do the minimums a payment must carry (`minimum_deposit`, `minimum_address_payment`, `minimum_seedelf_payment`): the builders refuse less, and the web wallet's WebAssembly raises an amount to them.
  - **Script spends** go through `build::ScriptSpend`: owned inputs proven against a one-time key hash, giveme.my collateral, reference scripts. `draft()` carries placeholder budgets for Ogmios; `finalize(&Budgets::from_ogmios(..))` puts in the measured ones, **matched by purpose and index**, never by answer order. Mint, transfer, sweep and remove are built on it; `change_to(addr)` sends the change to a key address instead of the contract. Every CLI spend built on it ends in `commands/spend.rs` (prove, evaluate, finish, giveme.my, sign, submit).
    - `with_account(key, inputs, collateral)` (the web wallet's session return, chunk 16) also spends a key account's UTxOs and puts up its collateral instead of giveme.my's. The proofs stay bound to the spend's one-time key, never the account's (a connected site can ask the account's key to sign). Redeemer indexes count the account's inputs too.
    - `measure_locally(known)` measures in the wallet (`eval`, Aiken's `uplc`) instead of Ogmios, for inputs that aren't on chain yet. A spend the guessed budgets call short is drafted with the most fee it can pay and measured, since the guess runs about 1.3× what the scripts use; `build::is_short` tells such a shortfall from other errors.
    - `pay_rest(RestTo, tokens)` pays what's left to a Seedelf or a key address instead of keeping it as change: Max. The tokens it doesn't send stay as change with exactly their minimum; `FinalSpend::rest_lovelace` is what it paid. `build::max_inputs` picks Max's inputs (those holding the tokens sent, then the largest, at most 20).
  - Still inside `run`: `create`, `fund` and `util extract` (a contract UTxO with no datum, signed over CIP-30); the web wallet has its own account-paid versions (`account_mint`, and `account_send_many` to a `Payee::Seedelf`). The mock Ogmios in `tests/cli/harness.rs` (`mount_evaluate`) labels every budget `spend`, which is right for a transfer or sweep; a mint or `remove`'s burn needs `mount_evaluate_mint`, which adds the policy's.
  - This reverses the old "no `build_*` functions" rule, which existed only because the removed GUI was the other consumer.
- `ProtocolParameters::from_koios` parses one Koios `epoch_params` row; `epoch_params()` fetches and calls it. `seedelf-koios`'s HTTP timeouts are gated off on `wasm32` (reqwest's browser client has none), which is what lets `seedelf-core` compile to WebAssembly.
- `evaluate_transaction` returns Ogmios's JSON-RPC answer for a 400 too: that's how Ogmios says a script failed or an input is unknown.
- Before dispatching, `lib.rs`'s `run()` calls `setup::check_and_prepare_seedelf()`, which creates `$HOME/.seedelf` and prompts for wallet creation if empty. The encrypted secret key file lives there (Argon2 + AES-256-GCM, see [setup.rs](seedelf-cli/src/setup.rs)).
- CIP30 signing is bridged via a local static site served at `127.0.0.1:44203` by [web_server.rs](seedelf-cli/src/web_server.rs). The HTML/JS in `seedelf-cli/static/` is embedded with `rust-embed`; rebuild after editing those assets.

## Offline integration tests

[tests/cli/](seedelf-cli/tests/cli/) drives every transaction-building command's `run()` against a mock Koios server (`wiremock`), decodes the transaction the command tried to submit, and asserts value conservation, min-UTxO floors, and valid change `Register`s. It relies on four inert-by-default seams (all `None`/disarmed in production):

- `seedelf_koios::koios::override_endpoints` — redirects the Koios REST + collateral-service base URLs.
- `seedelf_display::version_control::override_github_base` — redirects the update-check URL.
- `seedelf_cli::setup::inject_wallet_scalar` — bypasses the interactive password prompt.
- `seedelf_cli::web_server::arm_cbor_capture` — records `create`/`fund`/`extract` CBOR instead of serving the blocking signing site.

These seams are process-global, so every test in the `cli` binary is `#[serial]`. Adding a transaction command means adding a test here.

## Things that bite

- **Script hashes are baked in, and variant 1 is frozen.** [seedelf-core/src/constants.rs](seedelf-core/src/constants.rs) hardcodes the wallet contract hash, seedelf policy ID, and reference UTxOs for each `variant`, and [references.rs](seedelf-core/src/references.rs) the reference outputs as they sit on chain. Variant 1 is the deployed contracts (commit `5b82530`, Aiken v1.1.9), and [tests/constants_test.rs](seedelf-core/tests/constants_test.rs) pins it, mainnet included.
  - Re-running `../seedelf-contracts/compile.sh` never changes these. Its `hashes/` is a later build that was never deployed: copied here, the wallet would show no funds and fail every spend.
  - A new build of the contracts is a new variant with its own deployed reference UTxOs, added beside variant 1, never an edit to it. See [../seedelf-contracts/README.md](../seedelf-contracts/README.md) for the deployed values.
- **Torsion-free points and matching scalars** are protocol invariants — violating them produces permanently-locked UTxOs. The CLI enforces this, but any new code constructing `Register`s directly must call `is_torsion_free()` and re-randomize with the same `d` on both `generator` and `public_value`. See root CLAUDE.md "Core protocol invariants".
- **Check a register with `build::is_payable` before paying it, not `Register::is_valid`.** `is_valid` accepts the identity point: an identity public value is `g^0`, so anyone can prove the key and take the payment, and an identity generator locks it. `transfer`, `account_send_many` (for a `Payee::Seedelf`) and both mints check `is_payable`, and so does the CLI's `fund`, which still builds inline.
- **The web wallet's key derivation is frozen.** Every web wallet's recovery phrase depends on it: [seedelf-crypto/src/derivation.rs](seedelf-crypto/src/derivation.rs), v1.
  - Never change its outputs, and never edit the vectors in `seedelf-crypto/tests/vectors/seedelf_key_v1.json`.
  - A new scheme would be a new version (`v2`) alongside v1, never a replacement.
- **Size fees come from the protocol parameters.** Use `seedelf_core::build::linear_fee(&params, size)`, which is `min_fee_a × size + min_fee_b`. Pallas's `fees::PolicyParams::default()` is Byron's policy (43.946 lovelace a byte): it prices a Seedelf spend a few dozen lovelace short, and the node refuses it with `FeeTooSmallUTxO`. The old CLI drafts hid this with oversized placeholder budgets.
- **`[profile.wasm-release]` in the workspace `Cargo.toml` is the web wallet's WebAssembly build** (`seedelf-web-wallet/wasm/build.sh`): release built for size. The CLI doesn't use it; don't drop it as unused.
- **Pallas can't stage certificates or withdrawals** (`pallas-txbuilder` 0.33 and 0.35 write `None` for both; 1.4 is no different, and it has no `Reward` redeemer either). [seedelf-core/src/staking.rs](seedelf-core/src/staking.rs) patches them, and the account's DRep votes (the body's `voting_procedures`), into the built body and puts the new body hash into the `BuiltTransaction`, so the account builders take a `&Staking` (`Staking::none()` for a plain payment). Patch first, sign after: `BuiltTransaction::sign` signs whatever `tx_hash` holds, and a patch after signing is refused. [withdraw_zero.rs](seedelf-core/src/withdraw_zero.rs) patches Lovejoin's zero withdrawal and its `Reward` redeemer the same way.
- **Pallas's script data hash is wrong for a transaction with witness datums.** `pallas-txbuilder` hashes them as a plain list but writes them as a tagged set (258), so the node refuses it. Nothing the wallet built before carried one; a DEX order's cancel does (a Plutus V1 order keeps its datum by hash). [seedelf-core/src/orders.rs](seedelf-core/src/orders.rs)' `with_integrity` recomputes the hash from the transaction's own witness bytes (`integrity_hash`, Plutus V1's legacy language view included), tested against real V1, V2 and V3 transactions from chain. `orders.rs` also holds the web wallet's own cancels of DEX orders (the pinned `orders.json`, chunk 24 Step 3).
- **Pallas can't stage metadata either.** [seedelf-core/src/note.rs](seedelf-core/src/note.rs) patches a CIP-20 note (label 674) in the same way, setting the auxiliary data and its hash in the body, after the staking patch (`Patches` in `build.rs` applies both, in every draft `settle` prices). Only `account_send_many` takes a note (the web wallet's public Send).
- **`settle` refuses a transaction over 16 KiB** (`build::MAX_TX_SIZE`, the ledger's `max_tx_size`), in words, before the node would. Many recipients or tokens are how one gets there.
- **Pallas is pinned to 0.35** across the workspace (0.33 until chunk 16: `uplc` 1.1.23, the web wallet's script evaluator, needs 0.35; 0.33's `txbuilder` source was identical and every test passed unchanged). Bumping it is a coordinated change — `pallas-txbuilder`'s API drifts between minor versions, and `uplc` must be on the same Pallas.
