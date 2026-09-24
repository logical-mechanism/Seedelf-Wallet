# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See the repository root [CLAUDE.md](../CLAUDE.md) for the cross-cutting picture (contract ↔ Rust hash coupling, on-chain invariants, release versioning). This file covers what is specific to the Rust workspace.

## Workspace layout

Cargo workspace rooted at [Cargo.toml](Cargo.toml), resolver `"3"`, edition `2024`. Members:

- [seedelf-crypto](seedelf-crypto/) — BLS12-381 primitives, the `Register { generator, public_value }` datum, and the Schnorr Σ-protocol prover. Must match [seedelf-contracts/lib/schnorr.ak](../seedelf-contracts/lib/schnorr.ak) byte-for-byte.
- [seedelf-koios](seedelf-koios/) — REST client for Koios (UTxO queries, tx submit/evaluate). Leaf crate, no internal deps.
- [seedelf-core](seedelf-core/) — wallet domain logic: address/asset/UTxO selection, [constants.rs](seedelf-core/src/constants.rs) (hardcoded script hashes and reference UTxOs per `variant`), tx building on Pallas 0.33.
- [seedelf-display](seedelf-display/) — TUI formatting, colors, version-check helpers.
- [seedelf-cli](seedelf-cli/) — CLI crate: a thin [main.rs](seedelf-cli/src/main.rs) binary shim over a [lib.rs](seedelf-cli/src/lib.rs) library target. The split exists so the offline integration tests in [tests/cli/](seedelf-cli/tests/cli/) can drive the command `run()` functions directly. One file per subcommand under [src/commands/](seedelf-cli/src/commands/); `util/` and `external/` are subcommand groups with their own `mod.rs`.

Also in this folder but **not** a Cargo member:

- [seedelf-web-wallet](seedelf-web-wallet/) — the Chrome extension wallet.
  - Start with its [README](seedelf-web-wallet/README.md).
  - [docs/roadmap.md](seedelf-web-wallet/docs/roadmap.md) holds the current chunk and handoff notes.
  - **Branching:** web-wallet work branches from `seedelf-web-wallet` as `web-wallet/<topic>`, and PRs go back into `seedelf-web-wallet`, never `main`.
- `_reference/` — gitignored third-party checkouts, such as Lace, for reading only.

Dependency direction: `cli` → `core` → `crypto` + `koios` + `display`. `seedelf-cli` is a leaf crate and is intentionally NOT in `[workspace.dependencies]` / `[patch.crates-io]` — its library target is consumed only by its own `main.rs` and `tests/`. The workspace patch table rewrites the published `seedelf-{core,crypto,koios,display}` crates to local paths so edits propagate without a publish — never remove this when bumping versions, and always bump `[workspace.package].version` together with the `[workspace.dependencies]` entries (they must match).

## Common commands

```bash
# build / install the CLI
cargo build --release --bin seedelf-cli
cargo install --path seedelf-cli --bin seedelf-cli
cargo run -- help                    # from workspace root

# tests
cargo test                           # whole workspace
cargo test -p seedelf-crypto         # one crate
cargo test -p seedelf-crypto schnorr # filter by name
```

Formatting is governed by [rustfmt.toml](rustfmt.toml). No project-level lint script — rely on `cargo clippy` if running lints.

## CLI conventions

- Two global flags live on the root `Cli` and are threaded through every command: `--preprod` (network selector) and `--variant <u64>` (contract variant, defaults to `seedelf_core::constants::VARIANT`). When adding commands, plumb both — `seedelf-core::constants::get_config(variant, !preprod)` returns the right script hashes and reference UTxOs.
- Every subcommand `run` is `async` and returns `Result<_, _>`; `main.rs` matches and `eprintln!`s the error. Keep that pattern when adding commands.
- **Transaction building is moving into network-free builders in [seedelf-core/src/build.rs](seedelf-core/src/build.rs)**, shared with the web wallet (which calls them through WebAssembly). A builder takes chain data the caller already fetched (protocol parameters, Koios `UtxoResponse`s) and returns an unsigned transaction; `run` keeps the network calls (Koios, the collateral service, submit) and the signing.
  - Done: `external sweep` (`build::external_sweep`), the web wallet's move-in (`build::move_in`), `util mint` (`build::mint`), `transfer` (`build::transfer` / `transfer_from`), `sweep` (`build::sweep` / `sweep_from` / `sweep_all`), `remove` (`build::remove`), and an account-paid mint for the web wallet (`build::account_mint`, the shape of the CLI's `create`, whose `run()` still builds inline). The fee helpers (`fake_signer`, `linear_fee`, `settle_fee`, `even`, `collateral_output`) live there too.
  - **Script spends** go through `build::ScriptSpend`: owned inputs proven against a one-time key hash, giveme.my collateral, reference scripts. `draft()` carries placeholder budgets for Ogmios; `finalize(&Budgets::from_ogmios(..))` puts in the measured ones, **matched by purpose and index**, never by answer order. Mint, transfer, sweep and remove are built on it; `change_to(addr)` sends the change to a key address instead of the contract. Every CLI script spend ends in `commands/spend.rs` (prove, evaluate, finish, giveme.my, sign, submit).
  - Still inside `run`: `create` and `fund`; the web wallet doesn't need them. The mock Ogmios in `tests/cli/harness.rs` (`mount_evaluate`) labels every budget `spend`, which is right for a transfer or sweep; a mint or `remove`'s burn needs `mount_evaluate_mint`, which adds the policy's.
  - This reverses the old "no `build_*` functions" rule, which existed only because the removed GUI was the other consumer.
- `ProtocolParameters::from_koios` parses one Koios `epoch_params` row; `epoch_params()` fetches and calls it. `seedelf-koios`'s HTTP timeouts are gated off on `wasm32` (reqwest's browser client has none), which is what lets `seedelf-core` compile to WebAssembly.
- `evaluate_transaction` returns Ogmios's JSON-RPC answer for a 400 too: that's how Ogmios says a script failed or an input is unknown.
- Before dispatching, `main.rs` calls `setup::check_and_prepare_seedelf()`, which creates `$HOME/.seedelf` and prompts for wallet creation if empty. The encrypted secret key file lives there (Argon2 + AES-256-GCM, see [setup.rs](seedelf-cli/src/setup.rs)).
- CIP30 signing is bridged via a local static site served at `127.0.0.1:44203` by [web_server.rs](seedelf-cli/src/web_server.rs). The HTML/JS is embedded with `rust-embed` / `include_dir`; rebuild after editing those assets.

## Offline integration tests

[tests/cli/](seedelf-cli/tests/cli/) drives every transaction-building command's `run()` against a mock Koios server (`wiremock`), decodes the transaction the command tried to submit, and asserts value conservation, min-UTxO floors, and valid change `Register`s. It relies on three inert-by-default seams (all `None`/disarmed in production):

- `seedelf_koios::koios::override_endpoints` — redirects the Koios REST + collateral-service base URLs.
- `seedelf_display::version_control::override_github_base` — redirects the update-check URL.
- `seedelf_cli::setup::inject_wallet_scalar` — bypasses the interactive password prompt.
- `seedelf_cli::web_server::arm_cbor_capture` — records `create`/`fund`/`extract` CBOR instead of serving the blocking signing site.

These seams are process-global, so every test in the `cli` binary is `#[serial]`. Adding a transaction command means adding a test here.

## Things that bite

- **Script hashes are baked in.** [seedelf-core/src/constants.rs](seedelf-core/src/constants.rs) hardcodes the wallet contract hash, seedelf policy ID, and reference UTxOs for each `variant`. If `../seedelf-contracts/compile.sh` is re-run (or the `acabcafe` seed changes), these must be updated here — see [../seedelf-contracts/README.md](../seedelf-contracts/README.md) for the canonical values.
- **Torsion-free points and matching scalars** are protocol invariants — violating them produces permanently-locked UTxOs. The CLI enforces this, but any new code constructing `Register`s directly must call `is_torsion_free()` and re-randomize with the same `d` on both `generator` and `public_value`. See root CLAUDE.md "Core protocol invariants".
- **Check a register with `build::is_payable` before paying it, not `Register::is_valid`.** `is_valid` accepts the identity point: an identity public value is `g^0`, so anyone can prove the key and take the payment, and an identity generator locks it. `transfer` and both mints check `is_payable`.
- **The web wallet's key derivation is frozen.** Every web wallet's recovery phrase depends on it: [seedelf-crypto/src/derivation.rs](seedelf-crypto/src/derivation.rs), v1.
  - Never change its outputs, and never edit the vectors in `seedelf-crypto/tests/vectors/seedelf_key_v1.json`.
  - A new scheme would be a new version (`v2`) alongside v1, never a replacement.
- **Size fees come from the protocol parameters.** Use `seedelf_core::build::linear_fee(&params, size)`, which is `min_fee_a × size + min_fee_b`. Pallas's `fees::PolicyParams::default()` is Byron's policy (43.946 lovelace a byte): it prices a Seedelf spend a few dozen lovelace short, and the node refuses it with `FeeTooSmallUTxO`. The old CLI drafts hid this with oversized placeholder budgets.
- **`[profile.wasm-release]` in the workspace `Cargo.toml` is the web wallet's WebAssembly build** (`seedelf-web-wallet/wasm/build.sh`): release built for size. The CLI doesn't use it; don't drop it as unused.
- **Pallas is pinned to 0.33.0** across the workspace. Bumping it is a coordinated change — `pallas-txbuilder`'s API drifts between minor versions.
