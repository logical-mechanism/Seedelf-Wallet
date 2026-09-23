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

**Open decision, and the most important one.** Once wallets exist this derivation can never change, or their phrases stop restoring funds.

**Requirements:**

- **Versioned from day one** (`v1`).
- **Domain-separated** from the Cardano tree.
- **Uniform output:** a non-zero scalar mod `r`, with no modulo bias. Expand to at least 48 bytes before reducing.
- **One implementation:** specified here with test vectors, implemented once in Rust (`seedelf-crypto`), and used through WebAssembly.

**Candidates:**

1. **A domain-tagged hash-to-scalar.** For example, HKDF-SHA-256 over the BIP39 seed with info `seedelf-wallet-v1/<account>`, expanded and reduced mod `r`. This is the simplest option and easy to specify completely.
2. **EIP-2333.** The standard BLS12-381 key derivation from a BIP39 seed, with published test vectors. It carries more machinery than we need for one scalar per account.

**Leaning:** candidate 1, with an account index in the info string so multiple Seedelf accounts per phrase stay possible later.

## Accounts

| Account | What it is | Address | Lifetime |
|---|---|---|---|
| **Seedelf** | The scalar `x`. The base register is `(G1, G1^x)`. Each seedelf's root UTxO holds a re-randomized copy that senders use. | Wallet contract (script address, no staking part) | Permanent |
| **Deposit** | CIP-1852 account `0'`, payment `0/0`, staking `2/0` | Standard base address | Permanent. Money passes through it and doesn't stay. |
| **One-time** (round-trip phase) | CIP-1852 account `1'`, payment `0/i`, a fresh `i` each session | Shared Seedelf staking part or none. See [privacy.md](privacy.md#known-links). | One session, then retired |

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
