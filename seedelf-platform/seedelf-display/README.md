# seedelf-display

Terminal output for `seedelf-cli`, the command-line wallet of [Seedelf](https://github.com/logical-mechanism/Seedelf-Wallet), a Cardano stealth wallet: text, colours, and the update check. It also reads the chain's tip and the contract's UTxOs, through `seedelf-koios`, for what `seedelf-cli` prints.

It's an internal crate, published so that `cargo install seedelf-cli` resolves. Its API is on the `0.x` line and still moving, so expect breaking changes on a minor bump.

- **The update check calls `api.github.com`** for the latest release, so GitHub sees the caller's IP address. `seedelf-cli` runs it at the start of most commands, and has no switch to turn it off.

The [repository's README](https://github.com/logical-mechanism/Seedelf-Wallet#readme) explains Seedelf, and [SECURITY.md](https://github.com/logical-mechanism/Seedelf-Wallet/blob/main/SECURITY.md) how to report a problem.
