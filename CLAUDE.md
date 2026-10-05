# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

This is a multi-language monorepo for **Seedelf**, a Cardano stealth wallet. Two top-level components:

- [seedelf-contracts/](seedelf-contracts/) — on-chain validators written in **Aiken**.
- [seedelf-platform/](seedelf-platform/) — a Cargo workspace of Rust crates implementing the CLI and supporting libraries.
  - It also holds the Chrome web wallet (Seedelf Wallet), [seedelf-platform/seedelf-web-wallet/](seedelf-platform/seedelf-web-wallet/), where nearly all work now happens. Start with its [README](seedelf-platform/seedelf-web-wallet/README.md) and [seedelf-platform/CLAUDE.md](seedelf-platform/CLAUDE.md).

The Rust code hardcodes the deployed contracts' script hashes, reference UTxOs and reference outputs, per variant (`seedelf-core`'s `constants.rs` and `references.rs`). Variant 1 is what's on chain and it's frozen: commit `5b82530`, built with Aiken v1.1.9 (see [seedelf-contracts/README.md](seedelf-contracts/README.md)). The contracts' current source, `contracts/` and `hashes/` are a later revision that was never deployed, so never copy `hashes/` into the Rust constants. Changing validator code, the toolchain or the `acabcafe` random seed changes the hashes: putting that on chain is a new variant with its own reference UTxOs, added beside variant 1, never an edit to it.

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

### Web wallet ([seedelf-platform/seedelf-web-wallet/](seedelf-platform/seedelf-web-wallet/))

```bash
cd seedelf-platform/seedelf-web-wallet/extension
npm ci
npm run build       # wasm/build.sh, then Vite into dist/ (load it unpacked)
npm run typecheck
npm test            # Vitest
npm run e2e         # Playwright, on the built dist/
```

`wasm/build.sh` needs the toolchain [seedelf-platform/rust-toolchain.toml](seedelf-platform/rust-toolchain.toml) pins (with `wasm32-unknown-unknown`), `clang` with a wasm32 backend, `llvm-ar`, and `wasm-bindgen-cli` at `Cargo.lock`'s version; it says what's missing. CI is [.github/workflows/web-wallet.yml](.github/workflows/web-wallet.yml). There's no prettier config: don't run a formatter. Everything else — the store package, live runs, the docs — starts at [docs/development.md](seedelf-platform/seedelf-web-wallet/docs/development.md).

## Architecture

### Crate boundaries ([seedelf-platform/](seedelf-platform/))

- **seedelf-crypto** — BLS12-381 primitives. [register.rs](seedelf-platform/seedelf-crypto/src/register.rs) defines the `Register { generator, public_value }` datum type; [schnorr.rs](seedelf-platform/seedelf-crypto/src/schnorr.rs) implements the non-interactive Schnorr Σ-protocol (Fiat-Shamir) used to prove spendability. The `vkh` one-time pad in proofs prevents rollback-replay attacks. It also holds the web wallet's keys — the frozen v1 Seedelf key derivation ([derivation.rs](seedelf-platform/seedelf-crypto/src/derivation.rs)) and the CIP-1852 Cardano account ([cardano.rs](seedelf-platform/seedelf-crypto/src/cardano.rs)) — and Lovejoin's proofs ([lovejoin.rs](seedelf-platform/seedelf-crypto/src/lovejoin.rs)).
- **seedelf-koios** — thin client for the Koios REST API (UTxO queries, tx submission/evaluation) and the giveme.my collateral service. Koios is the sole data layer; no local node.
- **seedelf-core** — wallet-level domain logic: address types, asset handling, UTxO selection, on-chain `constants` (script hashes, network params), transaction building atop Pallas: the network-free builders in [build.rs](seedelf-platform/seedelf-core/src/build.rs), shared by the CLI and, through `seedelf-wasm`, the web wallet.
- **seedelf-display** — TUI/text formatting, color, version-check helpers.
- **seedelf-cli** — binary entrypoint. One module per subcommand in [src/commands/](seedelf-platform/seedelf-cli/src/commands/) (`create`, `fund`, `transfer`, `sweep`, `remove`, `balance`, `welcome`, `util/`, `external/`). [web_server.rs](seedelf-platform/seedelf-cli/src/web_server.rs) spins up a local static site at `127.0.0.1:44203` to bridge CIP30 browser wallets for signing.
- **seedelf-wasm** ([seedelf-web-wallet/wasm/](seedelf-platform/seedelf-web-wallet/wasm/), `publish = false`) — the web wallet's WebAssembly bindings: thin wrappers over `seedelf-crypto` and `seedelf-core`, built by `wasm/build.sh` with the workspace's `[profile.wasm-release]`.

Dependency direction: `cli` → `core`, `display`, `koios`, `crypto`; `seedelf-wasm` → `core`, `koios`, `crypto`; `core` → `crypto` + `koios`; `display` → `koios`; `koios` → `crypto`. Crypto is the only leaf crate.

### On-chain contracts ([seedelf-contracts/](seedelf-contracts/))

- [validators/wallet.ak](seedelf-contracts/validators/wallet.ak) — spending validator. Verifies a Schnorr NIZK proof of knowledge of the discrete log for the UTxO's `Register`.
- [validators/seedelf.ak](seedelf-contracts/validators/seedelf.ak) — minting policy for the `5eed0e1f…`-prefixed identifier tokens (see root [README.md](README.md) for the token-name scheme).
- [validators/always_false.ak](seedelf-contracts/validators/always_false.ak) — utility script.
- [lib/schnorr.ak](seedelf-contracts/lib/schnorr.ak), [lib/token_name.ak](seedelf-contracts/lib/token_name.ak) — shared on-chain logic; the schnorr verifier here must match `seedelf-crypto`'s prover exactly.

### Core protocol invariants

These constraints are load-bearing for correctness *and* safety — a mistake here can create permanently locked UTxOs (see [README.md](README.md) §Wallet Limitations):

- A re-randomized register must apply the *same* scalar `d` to both `generator` and `public_value`. `(g^d, u^d)` spendable; `(g^d, u^d')` is a dead UTxO.
- Points pushed into a `Register` must be torsion-free (in the BLS12-381 prime-order subgroup). The validator rejects non-prime-order points, which also yields a dead UTxO. The CLI enforces this; callers constructing registers directly must call `is_torsion_free()` or multiply by the cofactor first. Neither point may be the identity either: an identity public value lets anyone spend the UTxO. `seedelf_core::build::is_payable` checks all of this.
- Proof `z = r + c·x`; `c` comes from Fiat-Shamir including the one-time signing key hash `vkh` — omitting `vkh` reintroduces the rollback-replay vector.

## Release & versioning

**Two version lines, deliberately apart** (the owner, 2026-09-29). Don't align them.

- **The web wallet is its own line, from `1.0.0`** (`seedelf-platform/seedelf-web-wallet/extension/package.json`), because the Chrome Web Store demands a strictly higher version on every upload. A listing hotfix must be free to bump it alone.
- **The Rust workspace and the contracts stay on `0.x.y`** (0.4.10 today). `seedelf-core`'s API is still moving — the builder extraction is unfinished — and on `0.x` Cargo reads a minor bump as breaking, which is the right regime for it. Go to `1.0.0` deliberately when that API settles, as a statement that it has.
- A unified "Seedelf 1.0" is an announcement, never a package version.

**Tagging: a web wallet tag must contain a `/`.** [.github/workflows/release.yml](.github/workflows/release.yml) fires on tags matching `*.*.*` and builds, GPG-signs and publishes **CLI** binaries. A tag glob's `*` matches anything but `/`, so `v1.0.0` and `seedelf-wallet-1.0.0` both match it and would ship a false CLI release. Use `web-wallet/<version>`, on the commit the uploaded zip was built from. None has been cut so far: a release's commit and zip hash go in its handoff note instead ([post-release-roadmap.md](seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md#how-this-file-works)).

- Rust workspace version is pinned in `[workspace.package]` of [seedelf-platform/Cargo.toml](seedelf-platform/Cargo.toml); the inter-crate deps in `[workspace.dependencies]` must match. Bump them together.
- Contract versioning is exposed via the CLI's `--variant` flag (defaults to `1`); the core crate selects script hashes per variant. Variant 1 is frozen on chain, so `aiken.toml`'s version says nothing about what's deployed.
