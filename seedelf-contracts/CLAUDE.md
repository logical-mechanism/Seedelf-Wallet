# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Scope: this file covers the Aiken on-chain contracts. The parent [../CLAUDE.md](../CLAUDE.md) has the monorepo-wide context (Rust off-chain crates, cross-cutting invariants). Read it too when work spans both sides.

## Commands

```bash
aiken check                 # run all on-chain tests
aiken check -m <module>     # run tests in one module (e.g. `-m schnorr`)
aiken check -m <module> -e  # exact-match a single test name
aiken build --trace-level verbose --trace-filter all   # keep traces for debugging
./compile.sh                # full rebuild: build + apply `acabcafe` seed + emit plutus.json, contracts/, hashes/
```

`compile.sh` requires `aiken`, `cardano-cli`, `python3`, and `cbor2`. It applies the `acabcafe` seed parameter to each validator via `aiken blueprint apply`, then runs `cardano-cli conway transaction policyid` to write the script hashes. **The emitted hashes in `hashes/` must match the constants hardcoded in the Rust `seedelf-core` crate** — any validator edit that changes a hash requires a synchronized Rust update (see parent CLAUDE.md).

Toolchain: Aiken `v1.1.19`, Plutus `v3`, stdlib `v3.0.0` (pinned in [aiken.toml](aiken.toml)).

## Architecture

Three validators, all parameterized by the same random-seed `Data` argument (the `acabcafe` seed) so edits + re-seeding produce fresh policy IDs:

- [validators/wallet.ak](validators/wallet.ak) — spending validator. The datum is expected to be a `Register { generator, public_value }`; the redeemer is a Schnorr `Proof { z_b, g_r_b, vkh }`. Spending requires both `schnorr.verify(...)` **and** `list.has(self.extra_signatories, proof.vkh)`. The `vkh` requirement is the one-time pad that blocks rollback-replay — if a tx is dropped during rollback, the same proof can't be reused because a fresh `vkh` must resign. Datums that fail the `Register` type check (or are absent) are spendable — this is intentional so malformed/missing datums don't lock funds, but means the *only* thing protecting a well-formed `Register` UTxO is the proof.
- [validators/seedelf.ak](validators/seedelf.ak) — minting policy for `5eed0e1f…`-prefixed locator NFTs. Burning requires `amt == -1` + a `5eed0e1f` prefix. Minting requires `amt == 1` and a token name derived via `token_name.generate(first_input.tx_id, first_input.idx, seedelf_prefix, personal_tag)` — tying the NFT name to the first consumed input makes each mint unique without any authority.
- [validators/always_false.ak](validators/always_false.ak) — utility script that always fails.

Shared on-chain library ([lib/](lib/)):
- [lib/schnorr.ak](lib/schnorr.ak) — `Register`/`Proof` types, the Fiat-Shamir transform (`blake2b_224` of `g_b ‖ g_r_b ‖ u_b ‖ bound`), and `verify`. The off-chain prover in `seedelf-crypto` **must** hash the exact same byte-concat order and use the same hash — any drift makes proofs non-verifying.
- [lib/token_name.ak](lib/token_name.ak) — seedelf token-name generation.

## Invariants (load-bearing)

A mistake here permanently locks UTxOs (see root [../README.md](../README.md) §Wallet Limitations):

- **Re-randomization uses one scalar `d` for both points.** `(g, u) → (g^d, u^d)` preserves `g^x = u`. `(g^d, u^d')` produces an unspendable UTxO — no one knows the DL.
- **Points must be torsion-free** (prime-order BLS12-381 G1 subgroup). Torsion points decompress but fail DL relations; the [torsion_point test](lib/schnorr.ak) documents this. Off-chain callers constructing registers directly must check `is_torsion_free()` or multiply by the cofactor.
- **`vkh` is mandatory in the Fiat-Shamir challenge.** Removing it reintroduces rollback replay.

## `happy-path-scripts/`

Shell harness using `cardano-cli` for on-testnet manual integration testing. **Not** the user-facing path — users should use `seedelf-cli`. Useful as a reference for the raw tx shape each validator expects.
