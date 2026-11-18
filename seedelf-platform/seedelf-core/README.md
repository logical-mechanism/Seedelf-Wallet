# seedelf-core

The wallet logic of [Seedelf](https://github.com/logical-mechanism/Seedelf-Wallet), a Cardano stealth wallet: addresses, assets, UTxO selection, the transaction builders (`build`), and the script hashes and reference UTxOs of each *variant*, a deployed version of the contracts. The builders make no network calls; they take chain data the caller has already fetched. `seedelf-cli` calls them directly, and Seedelf Wallet, the Chrome extension, calls them through WebAssembly.

It's an internal crate, published so that `cargo install seedelf-cli` resolves. Its API is on the `0.x` line and still moving, so expect breaking changes on a minor bump.

- **Variant 1 is frozen on chain.** Its constants are the deployed contracts' script hashes and reference UTxOs, and `tests/constants_test.rs` pins them. A different build of the contracts would be a new variant beside it.
- **Check a register with `build::is_payable` before paying it, not `Register::is_valid`.** A register is the datum a UTxO is locked under: two BLS12-381 points. `is_payable` refuses a point that doesn't decode; one outside the prime-order subgroup, which would lock the payment for good; and the identity point, which would let anyone spend it. `Register::is_valid` accepts the identity.
- **Size fees come from the protocol parameters** (`build::linear_fee`: `min_fee_a × size + min_fee_b`, as the ledger charges them), never from [Pallas](https://github.com/txpipe/pallas)'s default fee policy. That policy is Byron's: it prices a Seedelf spend a few dozen lovelace short, and the node refuses it.

The [repository's README](https://github.com/logical-mechanism/Seedelf-Wallet#readme) explains the protocol, and [SECURITY.md](https://github.com/logical-mechanism/Seedelf-Wallet/blob/main/SECURITY.md) how to report a problem.
