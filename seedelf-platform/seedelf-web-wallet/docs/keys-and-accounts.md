# Keys and accounts

## One phrase, two key trees

A wallet is one **24-word BIP39 recovery phrase** (256 bits of entropy). Two independent key trees come from it:

- **Cardano tree:** standard CIP-1852 derivation (`m/1852'/1815'/account'/role/index`) from the usual Icarus master key.
  - Because it is standard, the phrase also restores the Cardano side in Lace, Eternl and other wallets.
  - Those wallets see the deposit account. They never see seedelfs.
- **Seedelf key:** one BLS12-381 scalar `x`, derived from the same phrase by a separate, Seedelf-specific derivation.
  - The two trees are independent: knowing one reveals nothing about the other.

A web-wallet phrase is a Seedelf phrase. CLI wallets use a random scalar stored in a file, and they are a separate product with no import path (see the [README](../README.md#relationship-to-the-cli)).

### Seedelf key derivation

**Decided: domain-tagged HKDF.** Once wallets exist this derivation can never change, or their phrases stop restoring funds.

**Proposed `v1`:**

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
- **Freezing it:** the spec is frozen with test vectors when it's implemented (phrase → seed → okm → `x` → base register). It is implemented once in Rust (`seedelf-crypto`) and used through WebAssembly.

## Accounts

| Account | What it is | Address | Lifetime |
|---|---|---|---|
| **Seedelf** | The scalar `x`. The base register is `(G1, G1^x)`. Each seedelf's root UTxO holds a re-randomized copy that senders use. | Wallet contract (script address, no staking part) | Permanent |
| **Deposit** | CIP-1852 account `0'`, payment `0/0`, staking `2/0` | Standard base address | Permanent. Money passes through it and doesn't stay. |
| **One-time** (round-trip phase) | CIP-1852 account `1'`, payment `0/i`, a fresh `i` each session | Base address with the shared Seedelf staking part, the same as the CLI's External Wallet. See [privacy.md](privacy.md#known-links). | One session, then retired |

- **The deposit account is what exchanges and other wallets pay.** It is linked to the user by definition, so it is never used as a one-time account.
- **One-time accounts are how funds leave Seedelf to use a contract.** The wallet sweeps them back automatically (see [flows.md](flows.md#contract-round-trip)).
  - On restore, scan them with a gap limit so any leftovers are found.
- **The CLI has the same concept:** its External Wallet (`seedelf-cli/src/commands/external/`), a normal address tied to the Seedelf key. The web wallet reaches it through HD derivation instead.

## Password and vault

- **The vault is one SecretBox blob** that seals the phrase entropy under the user's password. Every key is re-derived on unlock, so no derived keys are stored.
- **SecretBox `SBV1`** (from Lace, `packages/lib/core/src/secret-box/`):
  - **Key derivation:** Argon2id with m = 19456 KiB, t = 2, p = 1, giving a 32-byte key.
  - **Cipher:** ChaCha20-Poly1305.
  - **Header:** 48 bytes: magic `SBV1`, a 32-byte salt and a 12-byte nonce. It is authenticated as associated data.
  - **Changing parameters** means a new magic (`SBV2`), never a silent change.
- **Password check:** opening the vault proves the password, because the authentication tag fails otherwise. We have one blob, so Lace's separate "sentinel" value isn't needed.
- **Performance:** `@noble/hashes` Argon2id is pure JS, so measure unlock time.
  - Lace allows swapping in a faster implementation (`setArgon2idImplementation`).
  - Another option is the Rust `argon2` crate inside our WebAssembly module.
- **Lock and wipe:**
  - On lock, zero the entropy, the derived keys and `x` in memory.
  - Never keep the password after use.
