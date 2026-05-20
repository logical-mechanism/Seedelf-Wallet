# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

This is a multi-language monorepo for **Seedelf**, a Cardano stealth wallet. Two top-level components:

- [seedelf-contracts/](seedelf-contracts/) — on-chain validators written in **Aiken**.
- [seedelf-platform/](seedelf-platform/) — a Cargo workspace of Rust crates implementing the CLI and supporting libraries.

The on-chain contract and the off-chain Rust code must stay in sync: the Rust code hardcodes the compiled script hashes produced by `compile.sh` (see [seedelf-contracts/README.md](seedelf-contracts/README.md) for current version-1 hashes). Changing validator code or the `acabcafe` random seed changes the hashes, which must then be updated in the Rust constants.

## Common Commands

### Aiken contracts ([seedelf-contracts/](seedelf-contracts/))

```bash
aiken check              # run all on-chain tests
aiken check -m <module>  # run tests in a specific module
./compile.sh             # full rebuild: aiken build + apply seed + emit plutus.json, contracts/, hashes/
```

`compile.sh` requires `aiken`, `cardano-cli`, `python3`, and the `cbor2` python package. It bakes the seed `acabcafe` into each validator via `aiken blueprint apply` and writes the resulting script hashes to `hashes/`.

### Rust workspace ([seedelf-platform/](seedelf-platform/))

Cargo workspace rooted at [seedelf-platform/Cargo.toml](seedelf-platform/Cargo.toml). The workspace `[patch.crates-io]` section rewrites the inter-crate deps to local paths, so local edits propagate immediately — don't remove this when bumping versions.

```bash
cargo build --release --bin seedelf-cli
cargo install --path seedelf-cli --bin seedelf-cli
cargo run -- help                    # run the CLI from the workspace root
cargo test -p <crate>                # run tests for one crate
cargo test -p seedelf-crypto <name>  # single test
```

## Architecture

### Crate boundaries ([seedelf-platform/](seedelf-platform/))

- **seedelf-crypto** — BLS12-381 primitives. [register.rs](seedelf-platform/seedelf-crypto/src/register.rs) defines the `Register { generator, public_value }` datum type; [schnorr.rs](seedelf-platform/seedelf-crypto/src/schnorr.rs) implements the non-interactive Schnorr Σ-protocol (Fiat-Shamir) used to prove spendability. The `vkh` one-time pad in proofs prevents rollback-replay attacks.
- **seedelf-koios** — thin client for the Koios REST API (UTxO queries, tx submission/evaluation). Koios is the sole data layer; no local node.
- **seedelf-core** — wallet-level domain logic: address types, asset handling, UTxO selection, on-chain `constants` (script hashes, network params), transaction building atop Pallas.
- **seedelf-display** — TUI/text formatting, color, version-check helpers.
- **seedelf-cli** — binary entrypoint. One module per subcommand in [src/commands/](seedelf-platform/seedelf-cli/src/commands/) (`create`, `fund`, `transfer`, `sweep`, `remove`, `balance`, `welcome`, `util/`, `external/`). [web_server.rs](seedelf-platform/seedelf-cli/src/web_server.rs) spins up a local static site at `127.0.0.1:44203` to bridge CIP30 browser wallets for signing.

Dependency direction: `cli` → `core` → `crypto` + `koios` + `display`. Crypto and koios are leaf crates.

### On-chain contracts ([seedelf-contracts/](seedelf-contracts/))

- [validators/wallet.ak](seedelf-contracts/validators/wallet.ak) — spending validator. Verifies a Schnorr NIZK proof of knowledge of the discrete log for the UTxO's `Register`.
- [validators/seedelf.ak](seedelf-contracts/validators/seedelf.ak) — minting policy for the `5eed0e1f…`-prefixed identifier tokens (see root [README.md](README.md) for the token-name scheme).
- [validators/always_false.ak](seedelf-contracts/validators/always_false.ak) — utility script.
- [lib/schnorr.ak](seedelf-contracts/lib/schnorr.ak), [lib/token_name.ak](seedelf-contracts/lib/token_name.ak) — shared on-chain logic; the schnorr verifier here must match `seedelf-crypto`'s prover exactly.

### Core protocol invariants

These constraints are load-bearing for correctness *and* safety — a mistake here can create permanently locked UTxOs (see [README.md](README.md) §Wallet Limitations):

- A re-randomized register must apply the *same* scalar `d` to both `generator` and `public_value`. `(g^d, u^d)` spendable; `(g^d, u^d')` is a dead UTxO.
- Points pushed into a `Register` must be torsion-free (in the BLS12-381 prime-order subgroup). The validator rejects non-prime-order points, which also yields a dead UTxO. The CLI enforces this; callers constructing registers directly must call `is_torsion_free()` or multiply by the cofactor first.
- Proof `z = r + c·x`; `c` comes from Fiat-Shamir including the one-time signing key hash `vkh` — omitting `vkh` reintroduces the rollback-replay vector.

## Release & versioning

- Rust workspace version is pinned in `[workspace.package]` of [seedelf-platform/Cargo.toml](seedelf-platform/Cargo.toml); the inter-crate deps in `[workspace.dependencies]` must match. Bump them together.
- Contract versioning is exposed via the CLI's `--variant` flag (defaults to `1`); the core crate selects script hashes per variant.
