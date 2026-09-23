# Roadmap

The wallet is built in **chunks**, each about one working session.

**Each chunk:**

1. Starts on a branch `web-wallet/<topic>` taken from `seedelf-web-wallet`. See [development.md](development.md#branching).
2. Ends with a PR back into `seedelf-web-wallet`.
3. At its end, updates this file: tick the chunk, and write what the next session needs to know under [Handoff notes](#handoff-notes).

**Status:** ✅ done · 🚧 in progress · ⬜ not started

## v1

| # | Chunk | Status | Scope |
|---|---|---|---|
| 1 | WASM foundation | 🚧 | Create the `seedelf-web-wallet/wasm` crate (a workspace member). Gate `seedelf-koios`'s `connect_timeout` for wasm32. Expose register create, re-randomize, the ownership check and the Schnorr proof. Build with `wasm-bindgen` and smoke-test from JS. |
| 2 | Seedelf key derivation | ⬜ | Implement the v1 HKDF spec ([keys-and-accounts.md](keys-and-accounts.md#seedelf-key-derivation)) in `seedelf-crypto` with frozen test vectors. Expose it through WASM and check the vectors from TS. |
| 3 | Cardano keys | ⬜ | Phrase → CIP-1852 deposit account and address. Rust (`pallas-wallet`) or a JS library, decided in the chunk. Check against a known wallet's addresses. |
| 4 | Extension scaffold | ⬜ | Vite + React + TS and an MV3 manifest (preprod). Service worker, popup plus full tab, typed messaging, WASM loaded in the worker, load unpacked. CI for Rust and the extension on PRs. |
| 5 | Vault and lock | ⬜ | SecretBox vault, create/restore onboarding, unlock, `chrome.storage.session`, auto-lock, unlock back-off. |
| 6 | Balance | ⬜ | TS Koios client, contract scan using the ownership check, deposit balance, list of seedelfs. |
| 7 | Builder extraction + move in | ⬜ | Merge `main` first. Split building from network calls in `seedelf-core`, starting with `external sweep`, and keep the CLI tests green. Then move in, end to end on preprod. |
| 8 | Create a seedelf | ⬜ | Stealth mint (`util mint`) with giveme.my collateral. |
| 9 | Transfer | ⬜ | Seedelf → seedelf (`transfer`). |
| 10 | Withdraw | ⬜ | `sweep` and `remove`. |
| 11 | Polish and testers | ⬜ | UI style pass, Playwright end-to-end tests on preprod, unlisted Web Store listing. |

## After v1

- Contract round trip: one-time accounts, CIP-30, auto-return ([flows.md](flows.md#contract-round-trip)).
- Turn on the mainnet build flag ([architecture.md](architecture.md#networks)).
- Merge `seedelf-web-wallet` into `main`.

## Handoff notes

Newest first. Keep each entry short: what landed, what's next, and anything surprising.

- **2026-09-23: design done.** The docs in this folder hold every decision. Chunk 1 started on `web-wallet/wasm-foundation`.
