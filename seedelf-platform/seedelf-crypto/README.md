# seedelf-crypto

The BLS12-381 cryptography of [Seedelf](https://github.com/logical-mechanism/Seedelf-Wallet), a Cardano stealth wallet: the `Register { generator, public_value }` datum (the two curve points a Seedelf UTxO is locked under), the non-interactive Schnorr proof that a UTxO is spendable, the frozen v1 key derivation from a recovery phrase, the CIP-1852 Cardano account, and the proofs of [Lovejoin](https://github.com/logical-mechanism/Lovejoin), the mixer the Seedelf Wallet uses.

It's an internal crate, published so that `cargo install seedelf-cli` resolves. Its API is on the `0.x` line and still moving, so expect breaking changes on a minor bump.

- **The prover must match the on-chain verifier byte for byte** ([`seedelf-contracts/lib/schnorr.ak`](https://github.com/logical-mechanism/Seedelf-Wallet/blob/main/seedelf-contracts/lib/schnorr.ak)): the same hash, over the same concatenation. That hash includes `vkh`, the hash of a one-time key that must sign the spending transaction, so a proof holds only in a transaction that key signs and can't be replayed in another, such as after a rollback.
- **The v1 derivation is frozen.** Every existing recovery phrase depends on its outputs, and `tests/vectors/seedelf_key_v1.json` pins them.
- **A register's points must be in the prime-order subgroup, and neither may be the identity.** Torsion locks the funds for good, and an identity public value lets anyone spend them. `Register::is_valid` checks the subgroup but not the identity: check a register with `seedelf_core::build::is_payable` before paying it.

The [repository's README](https://github.com/logical-mechanism/Seedelf-Wallet#readme) explains the protocol, and [SECURITY.md](https://github.com/logical-mechanism/Seedelf-Wallet/blob/main/SECURITY.md) how to report a problem.
