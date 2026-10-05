# seedelf-crypto

BLS12-381 primitives: the `Register { generator, public_value }` datum, the non-interactive Schnorr proof that a UTxO is spendable, the frozen v1 key derivation from a recovery phrase, the CIP-1852 Cardano account, and Lovejoin's proofs.

- **The prover must match the on-chain verifier byte for byte** (`seedelf-contracts/lib/schnorr.ak`): the same hash, over the same concatenation, with the one-time key hash `vkh` in it. Leaving `vkh` out reintroduces rollback replay.
- **The v1 derivation is frozen.** Every existing recovery phrase depends on it; a new scheme is a `v2` beside it, never a change to it.
- **A register's points must be in the prime-order subgroup, and neither may be the identity.** Torsion locks the funds for good, and an identity public value lets anyone spend them. `Register::is_valid` checks the subgroup but not the identity: check a register with `seedelf_core::build::is_payable` before paying it.

An internal crate of [Seedelf](https://github.com/logical-mechanism/Seedelf-Wallet), a Cardano stealth wallet. It's published so that `cargo install seedelf-cli` resolves; its API is on the `0.x` line and still moving, so expect breaking changes on a minor bump. The [repository's README](https://github.com/logical-mechanism/Seedelf-Wallet#readme) explains the protocol, and [SECURITY.md](https://github.com/logical-mechanism/Seedelf-Wallet/blob/main/SECURITY.md) how to report a problem.
