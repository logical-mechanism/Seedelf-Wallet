# seedelf-display

Terminal output for the `seedelf-cli`: text, colours, and the update check.

- **The update check calls `api.github.com`** for the latest release, so GitHub sees the caller's IP address.

An internal crate of [Seedelf](https://github.com/logical-mechanism/Seedelf-Wallet), a Cardano stealth wallet. It's published so that `cargo install seedelf-cli` resolves; its API is on the `0.x` line and still moving, so expect breaking changes on a minor bump. The [repository's README](https://github.com/logical-mechanism/Seedelf-Wallet#readme) explains the protocol, and [SECURITY.md](https://github.com/logical-mechanism/Seedelf-Wallet/blob/main/SECURITY.md) how to report a problem.
