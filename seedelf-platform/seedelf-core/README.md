# seedelf-core

Wallet logic: addresses, assets, UTxO selection, the deployed contracts' script hashes and reference UTxOs per variant, and the network-free transaction builders (`build`) that the CLI and the Seedelf Wallet's WebAssembly share.

- **Variant 1 is frozen on chain.** Its constants never change; a rebuilt contract is a new variant beside it.
- **Check a register with `build::is_payable` before paying it.** It refuses invalid points and the identity, which `Register::is_valid` alone doesn't.
- Size fees come from the protocol parameters (`build::linear_fee`), never Pallas's default policy, which prices a Seedelf spend short.

An internal crate of [Seedelf](https://github.com/logical-mechanism/Seedelf-Wallet), a Cardano stealth wallet. It's published so that `cargo install seedelf-cli` resolves; its API is on the `0.x` line and still moving, so expect breaking changes on a minor bump. The [repository's README](https://github.com/logical-mechanism/Seedelf-Wallet#readme) explains the protocol, and [SECURITY.md](https://github.com/logical-mechanism/Seedelf-Wallet/blob/main/SECURITY.md) how to report a problem.
