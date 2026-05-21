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
- Each transaction-building command (`create`, `fund`, `remove`, `sweep`, `transfer`) does all its work inside `run` — no separate builder function or `*Output` struct. (An earlier `pub build_*_seedelf(...) -> *SeedelfOutput` factoring existed only for the now-removed GUI; do not reintroduce it.)
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
- **Pallas is pinned to 0.33.0** across the workspace. Bumping it is a coordinated change — `pallas-txbuilder`'s API drifts between minor versions.
