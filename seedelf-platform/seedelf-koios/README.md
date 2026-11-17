# seedelf-koios

The network client of [Seedelf](https://github.com/logical-mechanism/Seedelf-Wallet), a Cardano stealth wallet: a thin client for the public [Koios](https://koios.rest) REST API (UTxO queries, transaction submission, and evaluation: measuring a transaction's scripts through Koios's Ogmios endpoint) and the [giveme.my](https://giveme.my) collateral service, which puts up the collateral a Seedelf spend needs, the same for every user.

It's an internal crate, published so that `cargo install seedelf-cli` resolves. Its API is on the `0.x` line and still moving, so expect breaking changes on a minor bump.

- **Koios is a third-party service, and giveme.my is Logical Mechanism's. Both are called with no API key, and both see the caller's IP address**, with what each request carries: the addresses it reads and the transactions it sends. Either can group the requests that come from one IP address. The [repository's README](https://github.com/logical-mechanism/Seedelf-Wallet#de-anonymizing-via-ip-tracking) covers what that means for privacy.

The [repository's README](https://github.com/logical-mechanism/Seedelf-Wallet#readme) explains the protocol, and [SECURITY.md](https://github.com/logical-mechanism/Seedelf-Wallet/blob/main/SECURITY.md) how to report a problem.
