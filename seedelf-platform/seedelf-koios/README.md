# seedelf-koios

A thin client for the public [Koios](https://koios.rest) REST API (UTxO queries, transaction submission and evaluation) and the [giveme.my](https://giveme.my) collateral service.

- **Koios is a third-party service and giveme.my is Logical Mechanism's; both are called with no API key, so both see the caller's IP address**, and can group the requests that come from it. The repository's README covers what that means for privacy.

An internal crate of [Seedelf](https://github.com/logical-mechanism/Seedelf-Wallet), a Cardano stealth wallet. It's published so that `cargo install seedelf-cli` resolves; its API is on the `0.x` line and still moving, so expect breaking changes on a minor bump. The [repository's README](https://github.com/logical-mechanism/Seedelf-Wallet#readme) explains the protocol, and [SECURITY.md](https://github.com/logical-mechanism/Seedelf-Wallet/blob/main/SECURITY.md) how to report a problem.
