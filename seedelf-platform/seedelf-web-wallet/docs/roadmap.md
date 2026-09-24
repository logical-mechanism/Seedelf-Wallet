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
| 5 | Vault and lock | ✅ | SecretBox vault, create/restore onboarding (restore has per-word BIP39 autocomplete, like Lace and Eternl), unlock, `chrome.storage.session`, auto-lock, unlock back-off. Plan: [plans/chunk-05-vault-and-lock.md](plans/chunk-05-vault-and-lock.md). |
| 6 | Balance | ✅ | TS Koios client. Contract scan using the ownership check. Cardano account discovery: receive and change chains, gap limit 20. Balances, tokens, list of seedelfs. QR code for the receive address. |
| 7 | Builder extraction + move in | ✅ | Merge `main` first. Gate `seedelf-koios`'s `connect_timeout` for wasm32 (the only thing that stops `seedelf-core` compiling to WASM). Split building from network calls in `seedelf-core`, starting with `external sweep`, and keep the CLI tests green. Then move in, end to end on preprod. |
| 8 | Create a seedelf | ⬜ | Stealth mint (`util mint`) with giveme.my collateral. |
| 9 | Transfer | ⬜ | Seedelf → seedelf (`transfer`). |
| 10 | Withdraw | ⬜ | `sweep` and `remove`. |
| 11 | Polish and testers | ⬜ | UI style pass: align much more with Lace's dark mode (`packages/lib/ui-toolkit/src/design-tokens/theme/dark.ts`), taking the look but not the brand. `wasm-opt` to shrink the module. Playwright end-to-end tests on preprod. Unlisted Web Store listing (`VITE_STORE_BUILD=true`). |

## After v1

- Contract round trip: one-time accounts, CIP-30, auto-return ([flows.md](flows.md#contract-round-trip)).
- Turn on the mainnet build flag ([architecture.md](architecture.md#networks)).
- Merge `seedelf-web-wallet` into `main`.

## Handoff notes

Newest first. Keep each entry short: what landed, what's next, and anything surprising.

- **2026-09-23: chunk 7 done** (`web-wallet/move-in`). Plan: [plans/chunk-07-move-in.md](plans/chunk-07-move-in.md).
  - **Decided with the user:**
    - Move-in takes an ADA amount or Max, plus a token picker (a picked token moves in full).
    - After sending, the wallet watches `tx_status` every 15 s, then refreshes.
    - Change goes to `0/0`.
    - The live run is on a fresh test wallet the user funds.
  - **Rust:**
    - `seedelf-core` now compiles to WebAssembly. The only blocker was `seedelf-koios`'s reqwest timeouts, now gated off on wasm32.
    - `seedelf-core/src/build.rs` holds network-free builders:
      - `deposit_outputs`: fresh re-randomized registers, tokens 20 to an output.
      - `settle_fee`: one throwaway signature per signer, repriced until it covers the signed size.
      - `external_sweep`: the CLI command is now a thin `run()` around it, and its offline tests pass unchanged.
      - `move_in`: never spends a 5-ADA pure-ADA UTxO.
    - `ProtocolParameters::from_koios` parses a Koios row. The platform CLAUDE.md's "no `build_*`" rule is reversed.
  - **WASM:** `buildMoveIn` checks each UTxO against its `role/index`, builds, and signs once per payment key. The module is now 1.6 MB (468 KB gzipped); `wasm-opt` is chunk 11.
  - **Extension:**
    - The Koios client gains `epochParams`, `submitTx` (never retried) and `txStatus`.
    - `move-in.ts` builds, holds the signed tx in session storage until **Send**, submits exactly it, and watches it.
    - Lock now clears all of `chrome.storage.session`.
    - UI: Move in (form → review → send) and a pending banner that resumes on reopen.
  - **Fixes from the user's manual testing:**
    - **"Failed to fetch" and nothing else.** A rebuild under a running extension left the old worker asking for a deleted, hash-named WASM file, and the failure was cached. Now the start is retried, "The wallet couldn't start" offers Try again or Reload the extension, and Koios errors are in plain words.
    - **`AdaInput`:** at most 6 decimals (truncated, with a note), nothing above the 45 billion ADA supply, and a note when the amount exceeds the balance. The WASM builder refuses over-supply amounts too.
  - **Tests:** core builder 6; `seedelf-wasm` native 6 (witnesses verify against the tx hash, and the signers are exactly the inputs' keys, on the real recorded preprod UTxOs); Node 21; Vitest 79 + 1 live; Playwright 13; the CLI's offline tests (11) are green.
  - **Not done: the live preprod move-in.**
    - The test wallet in `extension/.preprod-test-wallet.txt` (gitignored) was never funded.
    - The user tried the flow by hand in their own wallet, but no transaction hash was recorded.
    - To finish: fund that wallet, `npm run build`, then `node e2e/live/move-in.mjs 10`. It restores the wallet, moves 10 tADA plus any tokens, waits for confirmation, and prints the result.
  - **Next:**
    - The user plans CSS and UX fixes as part of the Lace style and flow pass (chunk 11). Keep new screens simple until then.
    - Chunk 8, create a seedelf (`util mint`), is the first script spend. It needs the draft/finalize split around `evaluate_transaction` and the giveme.my collateral witness. Write its plan first.
    - A real owned contract UTxO (from a live move-in) would let chunk 8 test on-chain.

- **2026-09-23: chunk 6 done** (`web-wallet/balances`).
  - **Decided with the user:** the receive-address QR code is in (`uqr`, MIT, a port of Nayuki's generator). Balances are read when Home opens, if the last reading is over a minute old, and on Refresh; there's no background polling.
  - **What landed:** `extension/src/background/koios.ts`, `chain.ts` and `balances.ts`, plus the new Home. See [architecture.md](architecture.md#chain-data).
    - One reading is three Koios requests: `credential_utxos` for the contract, and `account_addresses` plus `account_utxos` for the Cardano account's stake key.
    - Ownership runs in WebAssembly inside `wallet.withKeys`, which also writes the session cache, so a lock can't interleave. A reading that finishes after a lock is dropped.
    - The seedelf tag is the leading printable run of the 15-byte window after `5eed0e1f`, slightly stricter than the CLI's filter.
  - **Checked against the real chain:** the recorded preprod fixtures (`extension/tests/fixtures/`) match what `LIVE_KOIOS=1` reads today. The built extension, run against live preprod with no interception, shows the 12-word test phrase's account (10,350.538725 ₳, 4 addresses used) and contacts only `preprod.koios.rest`. The receive QR decodes back to the exact address with `zxing-cpp` and OpenCV.
  - **Tests:** Vitest 64, plus 1 opt-in live test (Koios paging and retries, datum parsing on all 25 real contract UTxOs, the gap limit, bigint sums, seedelf tags, the balance service with the cache and the lock, formatting). Playwright 10: all e2e tests now get Koios from the fixtures with every other host blocked, and 2 are new, for balances and a Koios failure.
  - **Surprises:**
    - The `abandon … art` phrase's stake key has a foreign script UTxO on preprod. Anyone can pair a stake key with their own payment part, so the account's UTxOs count only at derived addresses.
    - Older preprod contract UTxOs carry the shared Seedelf stake key; the current CLI writes none. Querying by payment credential finds both.
    - Real token names carry CIP-68 labels (`0014df10…`), which the UI drops.
    - No phrase wallet owns contract UTxOs yet, so owned-UTxO coverage uses synthetic fixtures (re-randomized registers of the 12-word vector). Chunk 7's move-in makes real ones.
  - **Next:** chunk 7, builder extraction and move-in. It's the biggest chunk, so start by writing `docs/plans/chunk-07-*.md` with a "Start here" list, and merge `main` first.

- **2026-09-23: chunk 5 done** (`web-wallet/vault-lock`).
  - **Decided with the user:** auto-lock after 15 minutes; passwords of at least 12 characters with a strength hint and no composition rules; the receive-address QR code waits for chunk 6 or 11. It's for someone paying from a phone wallet who scans the desktop screen.
  - **Rust / WASM:** `phrase_to_entropy`, `entropy_to_phrase` and `wordlist` in `seedelf-crypto::derivation`. The frozen v1 derivation is untouched.
    - Exported as `phraseToEntropy`, `entropyToPhrase` and `bip39Wordlist`.
    - Added beyond the plan: `SeedelfKey.fromEntropy` and `CardanoAccount.fromEntropy`, so unlock never turns the phrase into a JS string.
  - **Vault:** Lace's SecretBox is in `extension/src/background/secret-box/` (Apache-2.0, license and change list in that folder, no EMIP-003). The entropy is sealed under `seedelf.vault`.
    - Checked against vectors made independently in Python (`argon2-cffi`, `cryptography`): `extension/tests/vectors/secret_box_sbv1.json`.
    - Unlock takes about 190 ms in the service worker, so pure-JS Argon2id stays.
  - **State:** `extension/src/background/wallet.ts`, with the states `no-wallet`, `locked` and `unlocked`.
    - Keys stay in worker memory, and the entropy sits in `chrome.storage.session`.
    - Auto-lock uses `chrome.alarms` plus UI activity pings. The back-off is enforced in the worker and kept in `chrome.storage.local`.
    - Operations run one at a time, so concurrent unlocks can't race the back-off.
    - The worker broadcasts `state-changed`, so every open page follows a lock.
  - **RPC:** the plan's table, plus `validate-phrase`, so restore can show the Rust core's reason before asking for a password. `status` also carries `retryAfterMs`.
  - **UI:** Welcome, Create (reveal → confirm 3 words → password), Restore (per-word boxes, autocomplete, paste fills all), Unlock (countdown, forgot → reset → restore), and a Home placeholder.
    - From the popup, onboarding opens in a full tab.
    - The chunk-4 Wallet core check is gone.
  - **Brand:** the user added the Seedelf logo set; the originals are in `brand/`.
    - The emblem is the extension icon at 16, 32, 48 and 128 px. The wordmark is on Welcome, with a dark-mode variant whose navy lettering is lifted to near-white.
    - The design tokens now use the logo's navy and teal, and the dark theme follows Lace's structure. The full Lace-style pass is still chunk 11.
  - **Tests:**
    - Rust: 5 new derivation tests and 1 new `seedelf-wasm` test. Node: `wasm/tests/entropy.test.mjs`.
    - Vitest (37): SecretBox, the wallet state machine (including restart, browser restart, auto-lock and the back-off), the handlers, and the password rule.
    - Playwright (8): create, restore by paste and by autocomplete, lock and unlock across pages, the back-off, reset, and a browser restart that comes back locked. It also times unlock.
  - **Gotchas:**
    - `chrome.runtime.sendMessage` from one page also reaches other open extension pages. The UI's listener ignores anything that isn't `state-changed` and never replies.
    - A hash-only `page.goto` doesn't remount the app, so open a new page to test `#create` or `#restore`.
  - **Next:** chunk 6, balances. The Koios client and contract scan go in the worker, using the unlocked `SeedelfKey` in `wallet.ts`. The Home screen is the placeholder to replace.

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
