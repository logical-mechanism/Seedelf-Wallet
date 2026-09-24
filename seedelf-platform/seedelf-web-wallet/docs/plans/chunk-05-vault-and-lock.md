# Chunk 5 plan: vault, onboarding and lock

> **Done on 2026-09-23.** What was built, and where it differs from this plan, is in the [roadmap handoff note](../roadmap.md#handoff-notes).

**Branch:** `web-wallet/vault-lock`, created from `seedelf-web-wallet` at `b3e9383` (after PR #248). It ends with a PR back into `seedelf-web-wallet`.

## Start here (new session)

1. Check out the branch: `git checkout web-wallet/vault-lock && git pull`. If `seedelf-web-wallet` has moved since, merge it in.
2. Read this plan, then:
   - [keys-and-accounts.md](../keys-and-accounts.md): *Password and vault*, and *The Cardano account*
   - [architecture.md](../architecture.md): *Service worker*, and *Storage*
   - [flows.md](../flows.md): *Onboarding*, and *Lock and unlock*
   - [privacy.md](../privacy.md): *Rules the wallet enforces*
3. The tooling is already installed on the dev machine:
   - Rust 1.98 with `wasm32-unknown-unknown`
   - `clang` and `llvm-ar-18`
   - `wasm-bindgen-cli` 0.2.128
   - Node 24
   - Playwright's Chromium (build 1243)

   Build and test commands are in [extension/README.md](../../extension/README.md).
4. Confirm the [decisions](#decisions-to-confirm-first) with the user before building the parts they affect.

## Goal

When the chunk is done, a user can:

- **Create** a wallet: a new 24-word phrase, shown once and confirmed.
- **Restore** a wallet: 12, 15 or 24 words, typed with per-word autocomplete.
- Set a password, close the browser, come back and unlock.
- See their Cardano receive address and their Seedelf identity.
- Lock manually or on inactivity.

The chunk-4 **Wallet core check** screen is removed. Balances come in chunk 6.

## Decisions to confirm first

| Decision | Suggestion | Notes |
|---|---|---|
| Auto-lock default | 15 minutes | Lace defaults to "never". A settings screen can come later. |
| Password rule | At least 12 characters, no composition rules, with a strength hint | The CLI requires 14 characters with character classes. |
| QR code for the receive address | Later (chunk 6 or 11) | Copy is enough for now. |

## Work items

### 1. Rust / WASM additions

In `seedelf-crypto::derivation`, exposed through `seedelf-wasm`. The frozen v1 derivation is not touched.

- `phrase_to_entropy(phrase) -> Vec<u8>` and `entropy_to_phrase(bytes) -> String`.
  - They follow the same rules as `parse_phrase`: 12, 15 or 24 words, checksum, and normalization.
  - The vault stores entropy, not words.
- `wordlist()`: the English BIP39 list, for autocomplete (`bip39::Language::English.word_list()`).
- WASM exports: `phraseToEntropy`, `entropyToPhrase`, `bip39Wordlist`.
- Tests in Rust and Node. Include round trips on every phrase in `seedelf-crypto/tests/vectors/seedelf_key_v1.json`.

### 2. Vault (SecretBox `SBV1`): `extension/src/background/vault/`

- **Adapt Lace's code** from `packages/lib/core/src/secret-box/{constants,format,kdf,seal,open}.ts`.
  - It's Apache-2.0: keep its notices, mark our changes, and put the Apache license text next to the copied files (for example `vault/LICENSE-APACHE-2.0`).
  - Skip Lace's legacy EMIP-003 path (`emip3.ts`).
- **Dependencies:**
  - `@noble/hashes`: `argon2idAsync`, `randomBytes`
  - `@noble/ciphers`: `chacha20poly1305`
- **Format:**
  - Argon2id with m = 19456 KiB, t = 2, p = 1, giving a 32-byte key.
  - Blob = `"SBV1" ‖ salt(32) ‖ nonce(12) ‖ ciphertext ‖ tag(16)`.
  - The 48-byte header is the AEAD associated data.
- **Password handling:**
  - Passed around as a `Uint8Array` (via `TextEncoder`) and zeroed after use.
  - A wrong password shows up as an AEAD failure, so no sentinel value is needed.
- **Storage:** `chrome.storage.local` under `seedelf.vault`, as `{ version: 1, blob: <base64>, createdAt }`.
- **Performance:** measure seal and open time inside the service worker. If noble's pure-JS Argon2id is too slow (target: under about 1.5 s), switch to the Rust `argon2` crate in WASM behind the same `deriveKey` interface.
- **Tests:**
  - A round trip.
  - A wrong password fails.
  - Flipping any header byte fails.
  - A frozen vector (fixed salt and nonce), cross-checked against an independent implementation the way chunks 2 and 3 were: Python `argon2-cffi` plus `cryptography`'s ChaCha20Poly1305, in a scratch venv.

### 3. Wallet state and lock (service worker)

**States:** `no-wallet` → `unlocked` (after create or restore) ⇄ `locked`.

**Unlock:**

1. Open the vault.
2. Turn the entropy into a phrase (WASM).
3. Derive `SeedelfKey` and `CardanoAccount` (account 0), and keep them in worker memory.
4. Copy the entropy into `chrome.storage.session`, so a restarted worker can re-derive the keys without the password. See architecture.md, *Staying unlocked across restarts*.

**Worker start-up:**

- If `chrome.storage.session` holds entropy → `unlocked`.
- Else, if a vault exists → `locked`.
- Else → `no-wallet`.

**Lock:** `free()` the WASM objects, clear `chrome.storage.session`, and zero the buffers.

**Auto-lock:**

- Use `chrome.alarms`, because worker timers don't survive restarts.
- The UI sends throttled `activity` pings while the user interacts.
- The worker keeps `lastActivity` in session storage, and an alarm checks it every minute.

**Unlock back-off:**

- After consecutive failures, wait 1 s, 2 s, 4 s and so on, capped at 60 s. These are Lace's values, from `packages/contract/authentication-prompt/src/store/unlock-backoff.ts`.
- Unlike Lace, **enforce it in the worker**: keep `failedAttempts` and `lastFailureAt` in `chrome.storage.local`, and reject early attempts. The UI only shows the countdown.

**Lace reference:** `packages/contract/app-lock/src/store/{state-machine,side-effects}.ts`.

**Manifest:** add `"permissions": ["storage", "alarms"]`, and update `tests/manifest.test.ts`.

**Create flow:** the worker generates the phrase and returns it for display. It writes the vault only after the user confirms the phrase.

### 4. RPC: `extension/src/shared/rpc.ts`

Replace `preview` with:

| Request | Payload | Result |
|---|---|---|
| `status` | none | `{ state, network, networks, version }` |
| `generate-phrase` | none | `{ phrase }` |
| `create-wallet` | `{ phrase, password }` | writes the vault and unlocks |
| `restore-wallet` | `{ phrase, password }` | writes the vault and unlocks |
| `unlock` | `{ password }` | OK, or `{ retryAfterMs }` |
| `lock`, `activity` | none | none |
| `account` | none | `{ receiveAddress, stakeAddress, seedelfPublicValue }`, only when unlocked |
| `wordlist` | none | the BIP39 list. The UI doesn't load WASM, so it fetches the list once and caches it. |
| `reset-wallet` | none | deletes the vault. The UI requires a typed confirmation first. |

### 5. UI screens: `extension/src/ui/`

- **Welcome:** "Create new wallet" or "Restore wallet".
- **Create:**
  1. Show the 24 words in a grid, hidden until the user presses "Reveal".
  2. Warn against copying the phrase into insecure places.
  3. Ask for 3 randomly chosen word positions to confirm.
  4. Set the password (typed twice).
  5. Go to Home.
  - Show the phrase warning from flows.md: "This phrase restores your seedelfs only in a Seedelf wallet…"
- **Restore:**
  - Choose the word count: 12, 15 or 24.
  - **One box per word, with BIP39 autocomplete.** Pasting a full phrase fills every box.
  - Show `validatePhrase`'s reason when the phrase is wrong.
  - Set the password, then go to Home.
  - Lace's behavior (not its code) is the reference: `packages/lib/ui-toolkit/src/design-system/organisms/mnemonicTextInput/`.
- **Unlock:** a password field, the back-off countdown, and "Forgot password? Restore from your phrase", which leads to reset then restore.
- **Home** (a placeholder until chunk 6): the Cardano receive address with a copy button, the stake address, the Seedelf identity (short public value), a Lock button, and the network badge.
- **Rules for all screens:**
  - Clear the phrase and password from component state on unmount, and never persist them in the UI.
  - Navigation is simple state-based switching; no router.
- **Optional if time allows:** start moving the design tokens toward Lace's dark theme (`packages/lib/ui-toolkit/src/design-tokens/theme/dark.ts`). Otherwise it waits for chunk 11. Take the look only, not Lace's brand assets or fonts.

### 6. Tests

**Vitest:**

- The vault tests above.
- The state machine and handlers, using an in-memory `chrome.storage` fake and the real WASM:
  - create
  - restore with the vector phrases, checking the Lace-matching address
  - unlock and lock
  - a wrong password, and the back-off
  - a simulated worker restart that comes back unlocked from session storage

**Playwright:**

- Create → confirm → password → Home shows `addr_test1…`.
- Lock → unlock.
- Restore with a vector phrase → Home shows that vector's address.
- A wrong password shows the back-off.
- Reopening the popup keeps it unlocked.
- A browser restart (a new persistent context on the same user-data directory) comes back locked.

**CI** already runs Vitest and Playwright.

### 7. Docs to update at the end

- keys-and-accounts.md, *Password and vault*: describe it as built.
- architecture.md: storage and permissions.
- flows.md: onboarding and lock details.
- extension/README.md: the screens.
- roadmap.md: tick chunk 5 and add a handoff note.
- Remove the Wallet core check from the docs and the e2e tests.

## Out of scope

- Balances and Koios (chunk 6)
- Transactions (chunk 7 onwards)
- Settings beyond the auto-lock default
- Multiple accounts
- Hardware wallets
