# Keys and accounts

## One phrase, two key trees

A wallet is one **BIP39 recovery phrase**. New wallets get 24 words (256 bits of entropy). Restore also accepts 12 or 15 words, as Lace does. Two independent key trees come from the phrase:

- **Cardano tree:** standard CIP-1852 derivation (`m/1852'/1815'/account'/role/index`) from the usual Icarus master key.
  - Because it is standard, the phrase also restores the Cardano side in Lace, Eternl and other wallets.
  - Those wallets see the Cardano account. They never see seedelfs.
- **Seedelf key:** one BLS12-381 scalar `x`, derived from the same phrase by a separate, Seedelf-specific derivation.
  - The two trees are independent: knowing one reveals nothing about the other.

A web-wallet phrase is a Seedelf phrase. CLI wallets use a random scalar stored in a file, and they are a separate product with no import path (see the [README](../README.md#relationship-to-the-cli)).

### Seedelf key derivation

**`v1`, frozen on 2026-09-23.** Once wallets exist this derivation can never change, or their phrases stop restoring funds.

- **Implementation:** [`seedelf-crypto/src/derivation.rs`](../../seedelf-crypto/src/derivation.rs).
- **Vectors:** [`seedelf-crypto/tests/vectors/seedelf_key_v1.json`](../../seedelf-crypto/tests/vectors/seedelf_key_v1.json).
  - Nine vectors, covering 12-, 15- and 24-word phrases, pin every step: phrase → seed → okm → `x` → base register.
  - They were checked against independent implementations: Python `hashlib`/`hmac` for the seed, HKDF and the reduction, and `py_ecc` for the public value. The BIP39 layer also reproduces the official Trezor vector.
  - Both the Rust tests and the WebAssembly tests run them.

```text
seed = BIP39 seed of the phrase             PBKDF2-HMAC-SHA512, 2048 rounds, empty passphrase → 64 bytes
okm  = HKDF-SHA-256(
         ikm  = seed,
         salt = "seedelf-wallet-v1",
         info = "seedelf-key" || u32_be(account),
         L    = 64)
x    = int_be(okm) mod r                    r = BLS12-381 scalar field order
if x == 0: derivation error                 probability ≈ 2^-255
```

**Notes:**

- **`account` is `0` for v1.** The index keeps multiple Seedelf accounts per phrase possible later.
- **Why the BIP39 seed and not the raw entropy:**
  - The BIP39 seed is the standard input for non-Cardano derivations.
  - It's already a different function of the phrase than Cardano's Icarus master key.
  - The salt and info tags separate the two domains again.
- **Reducing 64 bytes mod `r`** (a 255-bit prime) leaves negligible bias.
- **BIP39 passphrase:** always empty in v1. Supporting one later would be an opt-in variant.
- **Phrase rules (wallet policy, applied before the derivation):**
  - New phrases are 24 words. Restore accepts 12, 15 or 24 BIP39 English words with a valid checksum. These are the lengths Lace accepts; 18 and 21 are refused.
  - The rule is checked before the derivation, which works the same for any length. Accepting another length later wouldn't change any existing wallet's keys.
  - **Restoring another wallet's phrase:** if someone restores a phrase from Lace or Yoroi, the Cardano account is that wallet's standard account 0. The Seedelf wallet can then see and spend those funds, and the Seedelf key is new.
  - Case and extra whitespace are ignored. The seed is always computed from the canonical words.
  - `generatePhrase` and `validatePhrase` in the WebAssembly module apply these rules, and `validatePhrase` says what is wrong.
- **One implementation:** the derivation lives in Rust (`seedelf-crypto`), and the extension uses it through WebAssembly (`SeedelfKey.fromPhrase`).

## Accounts

| Account | What it is | Address | Lifetime |
|---|---|---|---|
| **Seedelf** | The scalar `x`. The base register is `(G1, G1^x)`. Each seedelf's root UTxO holds a re-randomized copy that senders use. | Wallet contract (script address, no staking part) | Permanent |
| **Cardano** | CIP-1852 account `0'` in v1: receive keys `0/i`, change keys `1/i`, staking key `2/0` | Standard base addresses | Permanent. See [The Cardano account](#the-cardano-account). |
| **One-time** (round-trip phase) | Reserved CIP-1852 account `24301'` (`0x5EED`), payment `0/i`, a fresh `i` each session | Base address with the shared Seedelf staking part, the same as the CLI's External Wallet. See [privacy.md](privacy.md#known-links). | One session, then retired |

- **The Cardano account is what exchanges and other wallets pay.** It is linked to the user by definition, so it is never used as a one-time account.
- **One-time accounts are how funds leave Seedelf to use a contract.** The wallet sweeps them back automatically (see [flows.md](flows.md#contract-round-trip)).
  - On restore, scan them with a gap limit so any leftovers are found.
- **The CLI has the same concept:** its External Wallet (`seedelf-cli/src/commands/external/`), a normal address tied to the Seedelf key. The web wallet reaches it through HD derivation instead.

## The Cardano account

The Cardano account is CIP-1852 account `0'` of the phrase: an ordinary Cardano wallet account, and the wallet's non-private side. What it holds depends on where the phrase came from:

- **A new Seedelf phrase:** a fresh, empty account.
- **A restored Lace, Yoroi or Eternl phrase:** that wallet's first account, with the same addresses, UTxOs, tokens, NFTs, staking key and delegation, and any collateral.

**Implementation:** [`seedelf-crypto/src/cardano.rs`](../../seedelf-crypto/src/cardano.rs).

- **Master key:** the Icarus master key (CIP-3) from `pallas-wallet`.
- **Derivation:** `m/1852'/1815'/account'/role/index`.
- **Vectors:** [`seedelf-crypto/tests/vectors/cardano_account.json`](../../seedelf-crypto/tests/vectors/cardano_account.json).
  - They cover 12-, 15- and 24-word phrases, accounts 0 and 1, and both networks.
  - They match `@cardano-sdk/key-management`, the library Lace uses: 80 of 80 values.

**Rules:**

1. **Account `0'` only in v1, but all of it.**
   - Discovery scans both the receive (`0/i`) and change (`1/i`) chains with the standard gap limit of 20, so a restored wallet shows its full balance. Built in chunk 6; see [architecture.md](architecture.md#chain-data).
   - Every function takes the account index, so more accounts can come later. A picker would discover accounts in order (0, 1, 2, … stopping at the first one never used), the way BIP44 does.
2. **Leave collateral alone.**
   - Lace's collateral is just a pure-ADA UTxO of exactly 5 ADA, which Lace marks as reserved in its own local storage; nothing on-chain says so.
   - The web wallet never needs it: move-in runs no script, and Seedelf spends use giveme.my.
   - Like the CLI (`seedelf-core::utxos::collect_address_utxos`), move-in never spends those UTxOs, not even with Max. They have to be moved with the other wallet.
3. **Tokens and NFTs are shown.** Move-in moves ADA by default, and tokens only when the user picks them. Each Seedelf UTxO can only hold so many tokens (see the root README's *Wallet Limitations*).
4. **Staking is untouched.**
   - Delegation, rewards and governance stay with the user's main wallet.
   - Moving ADA into Seedelf lowers the stake behind that delegation, because Seedelf addresses have no staking part.
5. **Using it alongside another wallet is fine.** Both wallets can spend the same UTxOs. If both try at once, one transaction simply fails.
6. **It is not private.** For a restored wallet, this account is the user's public identity, and the UI never suggests otherwise.

**The Seedelf key is separate.** It stays on its own account 0 whichever Cardano account is used.

## Password and vault

**Built in chunk 5.** The code is in [`extension/src/background/`](../extension/src/background/): `vault.ts`, `wallet.ts` and `secret-box/`.

- **The vault is one SecretBox blob** that seals the phrase's BIP39 entropy under the user's password. It holds 16, 20 or 32 bytes for 12, 15 or 24 words; the words themselves are never stored.
  - Every key is re-derived on unlock, so no derived key is stored.
  - It lives in `chrome.storage.local` under `seedelf.vault`, as `{ version: 1, blob: <base64>, createdAt }`.
  - The entropy ↔ phrase conversion is in Rust (`seedelf_crypto::derivation::{phrase_to_entropy, entropy_to_phrase}`), with the same rules as `parse_phrase`.
  - Unlock goes straight from entropy to keys inside WebAssembly (`SeedelfKey.fromEntropy`, `CardanoAccount.fromEntropy`), so the phrase never becomes a JavaScript string after onboarding, unless the user asks to see it (Settings, below).
- **SecretBox `SBV1`**, adapted from Lace (`packages/lib/core/src/secret-box/`) into [`secret-box/`](../extension/src/background/secret-box/). Those files stay under Apache-2.0, with Lace's notice and our changes listed in that folder's README.
  - **Key derivation:** Argon2id with m = 19456 KiB, t = 2, p = 1, giving a 32-byte key (`@noble/hashes`).
  - **Cipher:** ChaCha20-Poly1305 (`@noble/ciphers`).
  - **Header:** 48 bytes: magic `SBV1`, a 32-byte salt and a 12-byte nonce. It is authenticated as associated data.
  - **Changing parameters** means a new magic (`SBV2`), never a silent change.
  - Lace's legacy EMIP-003 path is left out; this wallet only ever writes `SBV1`.
  - **Checked independently:** `extension/tests/vectors/secret_box_sbv1.json` was made with Python's `argon2-cffi` (the reference Argon2) and `cryptography`'s ChaCha20Poly1305. The TypeScript code reproduces its keys and blobs byte for byte.
- **Password check:** opening the vault proves the password, because the authentication tag fails otherwise. We have one blob, so Lace's separate "sentinel" value isn't needed.
- **Settings (chunk 12):**
  - **Show recovery phrase** opens the vault with the password again, even while unlocked, and shows the words. A wrong password counts towards the unlock back-off and waits like one.
  - **Change password** opens the vault with the current password and seals the same entropy under the new one, keeping `createdAt`. The same back-off applies.
  - **Remove wallet** deletes the vault after the typed confirmation (`delete wallet`), as Forgot password does, and every private record with it.
- **Private records** (contacts, the Seedelf history) are sealed under a second key: HKDF-SHA-256 of the entropy with its own salt (`seedelf-web-wallet-private-store-v1`), so it has nothing to do with the Seedelf or Cardano keys. See [architecture.md](architecture.md#storage).
- **Password rule:** at least 12 characters, with no composition rules. The UI shows a rough strength hint, and the worker enforces the length. (The CLI asks for 14 characters with character classes; the two are separate products.)
- **Performance:** unlock takes about 190 ms in the service worker, measured end to end in Playwright (Argon2id in pure JS, plus both key derivations in WebAssembly). That's well under the 1.5 s budget, so no faster Argon2id is needed. Lace's `setArgon2idImplementation` hook is kept in case that changes.
- **Lock and wipe:**
  - On lock, the worker frees the WebAssembly key objects, which overwrite `x` and the Cardano account key before releasing them, and clears `chrome.storage.session`.
  - Entropy buffers and the password's bytes are zeroed after use. JavaScript strings can't be zeroed, so the password string and the phrase typed during onboarding are simply dropped.
  - The password is never kept after use.
