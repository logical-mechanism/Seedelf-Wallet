# seedelf-core

The wallet logic of [Seedelf](https://github.com/logical-mechanism/Seedelf-Wallet), a Cardano stealth wallet: addresses, assets, UTxO selection, the deployed contracts' script hashes and reference UTxOs per variant (a deployed version of the contracts), and the transaction builders (`build`). `seedelf-cli` and the Seedelf Wallet, the Chrome wallet, share the builders; the Chrome wallet calls them through WebAssembly. They make no network calls: they take chain data the caller has fetched.

It's an internal crate, published so that `cargo install seedelf-cli` resolves. Its API is on the `0.x` line and still moving, so expect breaking changes on a minor bump.

- **Variant 1 is frozen on chain.** Its constants are the deployed contracts' script hashes and reference UTxOs, and `tests/constants_test.rs` pins them. A different build of the contracts would be a new variant beside it.
- **Check a register with `build::is_payable` before paying it.** A register is the datum a UTxO is locked under: two BLS12-381 points. `is_payable` refuses a point that doesn't decode or isn't in the prime-order subgroup, and the identity point, which `Register::is_valid` alone accepts.
- Size fees come from the protocol parameters (`build::linear_fee`: `min_fee_a × size + min_fee_b`, as the ledger charges them), never from [Pallas](https://github.com/txpipe/pallas)'s default fee policy, which is Byron's.

The [repository's README](https://github.com/logical-mechanism/Seedelf-Wallet#readme) explains the protocol, and [SECURITY.md](https://github.com/logical-mechanism/Seedelf-Wallet/blob/main/SECURITY.md) how to report a problem.
