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
| 1 | WASM foundation | ✅ | Create the `seedelf-web-wallet/wasm` crate (a workspace member). Expose register create, re-randomize, the ownership check and the Schnorr proof. Build with `wasm-bindgen` and smoke-test from JS. |
| 2 | Seedelf key derivation | ✅ | Implement the v1 HKDF spec ([keys-and-accounts.md](keys-and-accounts.md#seedelf-key-derivation)) in `seedelf-crypto` with frozen test vectors. Expose it through WASM and check the vectors from TS. |
| 3 | Cardano keys | ✅ | Phrase → CIP-1852 Cardano account (account `0'`): receive, change and stake addresses, in Rust (`pallas-wallet`). Checked against Lace's library (`@cardano-sdk`). |
| 4 | Extension scaffold | ✅ | Vite + React + TS and an MV3 manifest (preprod). Service worker, popup plus full tab, typed messaging, WASM loaded in the worker, load unpacked. CI for Rust and the extension on PRs. |
| 5 | Vault and lock | ⬜ | SecretBox vault, create/restore onboarding, unlock, `chrome.storage.session`, auto-lock, unlock back-off. |
| 6 | Balance | ⬜ | TS Koios client. Contract scan using the ownership check. Cardano account discovery: receive and change chains, gap limit 20. Balances, tokens, list of seedelfs. |
| 7 | Builder extraction + move in | ⬜ | Merge `main` first. Gate `seedelf-koios`'s `connect_timeout` for wasm32 (the only thing that stops `seedelf-core` compiling to WASM). Split building from network calls in `seedelf-core`, starting with `external sweep`, and keep the CLI tests green. Then move in, end to end on preprod. |
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

- **2026-09-23: chunk 4 done** (`web-wallet/extension-scaffold`).
  - **What landed:** `extension/`, built with Vite 8 (Rolldown), React 19, TypeScript 7 and an MV3 manifest.
    - The manifest is generated per build: preprod by default, mainnet behind `VITE_ENABLE_MAINNET`, a strict CSP, and a dev `key` that pins the ID to `jfekiogplaamnceifeehipmomhojngcb`.
    - The service worker is an ES module. It loads WASM lazily and answers typed RPC (`src/shared/rpc.ts`) only from the extension's own pages.
    - The UI works as a popup (360 px) or a full tab (`?view=tab`).
    - A temporary "Wallet core check" screen derives a phrase's Cardano account and Seedelf key in the worker.
  - **Tests:**
    - Vitest (9): the manifest, and the handlers with the real WASM against the shared vectors.
    - Playwright (3): loads `dist/` into Chromium, checks the pinned ID and module worker, and checks the popup derives the Lace-matching addresses. It also covers the full tab.
  - **CI:** added `.github/workflows/web-wallet.yml`, which runs on PRs touching `seedelf-platform/`. It covers Rust fmt/clippy/tests, the WASM build and tests, and the extension typecheck, tests, build and end-to-end run.
    - `Cargo.lock` is untracked, so CI resolves dependencies fresh and installs the matching `wasm-bindgen-cli`.
  - **Gotchas:**
    - Vite 8 renamed `rollupOptions` to `rolldownOptions`.
    - Aliases don't apply to `?url` imports, so the WASM binary is imported by relative path.
    - Playwright 1.63 needs its own Chromium: `npx playwright install chromium`.
  - **Next:** chunk 5, the vault and lock. It adds the `storage` permission and replaces the preview screen with create/restore onboarding.
- **2026-09-23: chunk 3 done** (`web-wallet/cardano-keys`).
  - **What landed:** `seedelf-crypto/src/cardano.rs`, `CardanoAccount`.
    - Icarus master key (CIP-3) via `pallas-wallet`, then `m/1852'/1815'/account'/role/index`.
    - Base addresses for receive and change, plus the stake address, on either network.
    - The account xpub.
  - **WASM:** `CardanoAccount` and a `Network` enum. The module is now about 590 KB before `wasm-opt`; shrinking it is a job for chunk 4 or 11.
  - **Verified against Lace's library.** `seedelf-crypto/tests/vectors/cardano_account.json` (12/15/24 words, accounts 0 and 1, preprod and mainnet) matches `@cardano-sdk/key-management` 0.29.13's `InMemoryKeyAgent` on all 80 values.
    - I ran the check with a Node script that loaded the installed SDK from another local project.
    - The Rust and WASM tests read the same file.
  - **Decided this chunk:**
    - "Deposit account" is renamed "Cardano account". For a restored Lace or Yoroi phrase, it is that wallet's account 0.
    - v1 uses account `0'` only, but every function takes the index.
    - The six Cardano-account rules are in [keys-and-accounts.md](keys-and-accounts.md#the-cardano-account). They include: coin selection skips 5 ADA pure-ADA UTxOs (someone's collateral), as the CLI does; and staking is left alone.
    - One-time accounts move to the reserved account `24301'` (`0x5EED`). Account `1'` could be a real Lace account and would link one-time addresses back to the user.
  - **Not done here:** signing (chunk 7) and address discovery (chunk 6).
  - **Next:** chunk 4, the extension scaffold.
- **2026-09-23: chunk 2 done** (`web-wallet/key-derivation`).
  - **What landed:** the v1 derivation, frozen, in `seedelf-crypto/src/derivation.rs`:
    - `parse_phrase`: checksum and case/whitespace normalization, with user-facing errors. New phrases are 24 words; restore accepts 12, 15 or 24, like Lace.
    - `generate_phrase`, `bip39_seed`, `okm_v1`, `scalar_from_okm`, `seedelf_key_v1`.
    - No new crates: `bip39` comes via `pallas-wallet`, and HKDF comes from `cryptoxide`.
  - **Vectors:** nine (12, 15 and 24 words), in `seedelf-crypto/tests/vectors/seedelf_key_v1.json`.
    - Checked against independent implementations: Python `hashlib`/`hmac`, `py_ecc` for the public values, the Trezor BIP39 vector, and the well-known 12-word seed.
    - The Rust tests (`derivation_test.rs`) and the WASM tests (`derivation.test.mjs`) both read them.
  - **WASM:** added `SeedelfKey.fromPhrase(phrase, account)`, `generatePhrase()` and `validatePhrase()`. The module is now about 350 KB, mostly the word list and SHA-512.
  - **Change from the plan:** BIP39 moved into Rust, so `@scure/bip39` is out of the JS stack.
  - **Next:** chunk 3, the phrase → CIP-1852 deposit account.
    - `pallas-wallet` (already in the tree) has an HD module and `bip39`. Check it for Icarus master-key and CIP-1852 derivation before reaching for a JS library.
    - Verify the results against a known wallet's addresses for the same phrase.
- **2026-09-23: chunk 1 done** (`web-wallet/wasm-foundation`).
  - **What landed:** the `seedelf-wasm` crate in `seedelf-web-wallet/wasm/`.
    - `SeedelfKey` keeps the scalar inside WASM.
    - `Register`, `rerandomize`, `isValidRegister`, `registerToDatum`, `verifyProof`.
    - `build.sh` produces an ES module of about 260 KB.
  - **Tests:**
    - Native: `cargo test -p seedelf-wasm`.
    - From JS: `node --test "seedelf-web-wallet/wasm/tests/*.test.mjs"`, run after `build.sh`.
    - Both check the same pinned vector as `seedelf-crypto`.
    - A proof takes about 10 ms.
  - **Things to know:**
    - `wasm-bindgen-cli` must match the crate version (0.2.128 today).
    - `seedelf-platform/Cargo.lock` is gitignored (`*.lock`), so versions can float on a fresh clone. `build.sh` reports what to install.
    - The `seedelf-koios` `connect_timeout` gate moved to chunk 7, where `seedelf-core` first needs WASM.
  - **Next:** chunk 2. Implement the v1 key derivation in `seedelf-crypto`, then add `SeedelfKey.fromPhrase()`.
- **2026-09-23: design done.** The docs in this folder hold every decision.
