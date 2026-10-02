# Keys and accounts

## One phrase, two key trees

A wallet is one **BIP39 recovery phrase**. New wallets get 24 words (256 bits of entropy). Restore also accepts 12 or 15 words, as Lace does. Two independent key trees come from the phrase:

- **Cardano tree:** standard CIP-1852 derivation (`m/1852'/1815'/account'/role/index`) from the usual Icarus master key.
  - Because it is standard, the phrase also restores the Cardano side in Lace, Eternl and other wallets.
  - Those wallets see the Cardano account. They never see Seedelfs.
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
  - **Restoring another wallet's phrase:** if someone restores a phrase from Lace or Yoroi, the Cardano account is that wallet's standard account 0. Seedelf Wallet can then see and spend those funds, and the Seedelf key is new.
  - Case and extra whitespace are ignored. The seed is always computed from the canonical words.
  - `generatePhrase` and `validatePhrase` in the WebAssembly module apply these rules, and `validatePhrase` says what is wrong.
- **One implementation:** the derivation lives in Rust (`seedelf-crypto`), and the extension uses it through WebAssembly (`SeedelfKey.fromPhrase`).

## Accounts

| Account | What it is | Address | Lifetime |
|---|---|---|---|
| **Seedelf** | The scalar `x`. The base register is `(G1, G1^x)`. Each Seedelf's root UTxO holds a re-randomized copy that senders use. | Wallet contract (script address, no staking part) | Permanent |
| **Cardano** | CIP-1852 account `n'`, one at a time (chunk 18; `0'` until then): receive keys `0/i`, change keys `1/i`, staking key `2/0` | Standard base addresses | Permanent. See [The Cardano account](#the-cardano-account). |
| **One-time** (private sessions, chunk 15) | Reserved CIP-1852 account `24301'` (`0x5EED`, `ONE_TIME_ACCOUNT`), payment `0/i` and staking `2/i`: session `i`, counting from 0 in order | Base address with the session's own stake key `2/i`, never registered (since chunk 15b; sessions from before keep the shared Seedelf staking part). See [privacy.md](privacy.md#known-links). | One session, then retired |

- **The Cardano account is what exchanges and other wallets pay.** It is linked to the user by definition, so it is never used as a one-time account.
- **One-time accounts are how funds leave Seedelf to use a contract.** The wallet sweeps them back automatically (see [flows.md](flows.md#contract-round-trip)).
  - On restore, scan them with a gap limit so any leftovers are found.
  - **A session's index is checked against the chain before it's used** (the crypto review, 2026-09-25). The next index is kept in the sealed session record, which is only on this device: a restored wallet, one removed and restored, or the same phrase in another browser starts it at 0 again. So before a session is funded, the worker asks Koios whether the next index's stake key (`2/i`) has been used by any address (`account_addresses`, that one stake address, which the funding puts on chain anyway), and only when it has, which of the 20 after it have, in one request, taking the first that none has (`SessionService.freshIndex`; the launch review, #22). Asking about 20 at once tells Koios they're one wallet's, so it's done only when a restore or another browser used the next one. Every session since chunk 15b has its own stake key, so any payment to one shows there. The few sessions from before then, with the shared staking part, were on preprod only.
    - **Send asks again** (independent review M13): before the funding is recorded and sent, `SessionService.stillUnused` asks about that one index: its stake key (`account_addresses`), then, if that shows nothing, its payment key (`credential_utxos`). If either shows it used, nothing is sent: the record's next index moves past it, and the error says to review it again, which takes the next unused one. A top-up doesn't ask: its account is already the session's.
    - **Neither check sees a mempool,** or what a Koios backend that's behind hasn't shown yet. So two browsers with the same phrase funding sessions at about the same time can still put both on one account.
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

1. **One account at a time, and all of it. Several accounts since chunk 18.**
   - Discovery scans both the receive (`0/i`) and change (`1/i`) chains with the standard gap limit of 20, so a restored wallet shows its full balance. Built in chunk 6; see [architecture.md](architecture.md#chain-data).
   - Everything under the account's payment keys is the account's, whatever the address's staking part: enterprise addresses, and our key with someone else's stake key, are found and spent too (chunk 12).
   - **Which account the wallet works on** is one integer in `chrome.storage.local` (`seedelf.account`, unsealed, beside the network and for the same reason: `Wallet` reads it while deriving the keys, before anything is unlocked). `Wallet` reads it at **every** key use, so a switch writes the choice and nothing else — the next use re-derives, and no request can sign with the account the user just left. **Which accounts the phrase has used, and what they are called, are sealed** with the other private records (`accounts`): how many accounts someone runs is about them.
   - **Any CIP-1852 index is an account.** The path component is hardened, so `m/1852'/1815'/n'` runs to 2^31 - 1, and `seedelf-crypto`'s `check_account` is the only bound. The wallet keeps up to 100 of them in its list — a list length, never a limit on *which* numbers.
   - **A custom or non-sequential account is reached by number** (the owner, 2026-10-02). Sequential discovery stops at the first unused account, so it can never find account 1337; and an account that has never been used can't be discovered at all. So Settings → Public accounts has an account-number entry with two actions: **Check it**, one `account_addresses` request about that one account, which adds it if it has been used; and **Add it**, which asks nobody anything and adds it whether or not it has ever been used — the way to *start* a custom-numbered account. It exists in the phrase either way and holds nothing until something is put there.
   - **Discovery looks for accounts in order, stopping at the first never used** (BIP44's rule), **one `account_addresses` request at a time**. It carries on from the first gap in the run up from 0, not from the highest known, so adding a custom account doesn't stop it ever reaching account 2. `Koios.usedStakeAddresses` would answer for twenty in one request, and that request would tell Koios those twenty stake addresses are one wallet's — which works against the habit several accounts serve. It runs on a **restore** (in the background: a restored phrase may hold funds past account 0) and on demand from Settings → Public accounts, which probes exactly one. Never on unlock.
   - **The Seedelf key stays on account 0.** One private balance for the whole phrase, whichever public account is active. See [Several accounts and the private balance](#several-accounts-and-the-private-balance).
   - Each account has **its own staking** (its own `2/0`), **its own collateral** and **its own locked UTxOs**; contacts, the Seedelf history and the private sessions are the wallet's, not an account's.
   - **A connected site stays bound to the account it connected to** and is refused, not served from the active one, when the wallet moves off it. Following the active account would hand a site that had seen Account 1's addresses Account 2's as well, and teach it the two are one wallet's.
   - A switch is **refused while something of the account's is on its way** — a payment Koios didn't answer, or a public mix still being sent — since a watch must not lose its account halfway through.
2. **One collateral, set aside, as in Lace (chunk 12).**
   - Lace's collateral is just a pure-ADA UTxO of exactly 5 ADA, which Lace marks as reserved in its own local storage; nothing on-chain says so. The web wallet does the same, in Settings → Collateral.
   - With none chosen, the wallet takes the oldest pure 5 ADA UTxO the account holds (no transaction), so another wallet's collateral on the same phrase stays put. Reclaiming it stops that; setting one with none to take pays 5 ADA to `0/0`.
   - It's kept out of every payment, and put up only by the account-paid mint: move-in and send run no script, and Seedelf spends use giveme.my.
   - Until chunk 12, move-in and send never spent any pure 5 ADA UTxO, as the CLI's `collect_address_utxos` doesn't. Now only the collateral, and the UTxOs the user locked, stay put.
3. **Tokens and NFTs are shown.** Move-in moves ADA by default, and tokens only when the user picks them. Each Seedelf UTxO can only hold so many tokens (see the root README's *Wallet Limitations*).
4. **The account stakes, with its own stake key `2/0` (chunk 13).**
   - Delegation to one pool, the vote's delegation, and the rewards are the account's, as in Lace: a restored phrase shows the same pool and DRep, and a change made here shows there.
   - The stake key signs inside WebAssembly, only for a certificate or a withdrawal, and never leaves it. See [flows.md](flows.md#staking-and-voting-public-account).
   - Moving ADA into Seedelf lowers the stake behind that delegation, because Seedelf addresses have no staking part.
5. **Using it alongside another wallet is fine.** Both wallets can spend the same UTxOs. If both try at once, one transaction simply fails.
6. **It is not private.** For a restored wallet, this account is the user's public identity, and the UI never suggests otherwise.

**The Seedelf key is separate.** It stays on its own account 0 whichever Cardano account is used.

## Several accounts and the private balance

**Decided by the owner, 2026-10-02: the Seedelf key stays on account 0** — one private balance for the whole phrase. The derivation would allow one key per account (`info = "seedelf-key" || u32_be(account)`), and it isn't needed: **stealth addressing already unlinks the move-ins.** Two public accounts paying the same Seedelf create re-randomized registers `(g^d1, u^d1)` and `(g^d2, u^d2)`, which can't be tied to each other or back to `(g, u)` without `d`. Account 0 is, in effect, the nonce.

**What stealth addressing does not cover is co-spending.** A contract UTxO's creating transaction is public. The registers hid *who* the money went to, not where an input came from — so one later private spend that takes a UTxO originating from account 0 together with one from account 1 **ties those two accounts to one owner, in the open**.

So each account's money made private is **its own history class**: `public:<n>` in [`shared/histories.ts`](../extension/src/shared/histories.ts). Coin selection keeps different classes apart where a choice that doesn't merge them pays (`seedelf-core`'s `build::Histories`), the review says what a merge ties together and names the accounts, and the UTxOs screen tags each private UTxO with the account its money came from. See [privacy.md](privacy.md#several-public-accounts).

- **The bare `public` of a wallet from before chunk 18 reads as `public:0`**, canonicalized on the way in. Two classes there would have the wallet claim a spend ties two accounts together when both are account 0 — a privacy note that is simply false.
- **Paying your own public account from Seedelf is flagged for every account the wallet knows**, not only the active one: the money is re-linked to that account either way.
- **Sending between your own accounts is allowed, and said** (the owner, 2026-10-02). It is an ordinary Cardano payment, so anyone can see the two accounts paying each other and tell they are one wallet's — which the Send form says, naming the account, so the user decides. It reads the resolved address, so it reads the same however the address arrived: typed, pasted, an ADA Handle, or picked from Contacts. Paying *this* account says what it always said (the money comes straight back less the fee), and the collateral payment is exactly that.
  - **And offered, not merely allowed** (the owner, 2026-10-02): the Send form's To field has *Your accounts* beside *Contacts*, listing every account but the one you are on — paying the one you are on sends the money straight back, which is the collateral payment's job. The addresses are derived on the device, so opening it asks nobody anything. Picking one only fills the field: it is then read and said like any address typed by hand. Without it the only way to pay your own Account 2 is to switch to it, copy its address, switch back and paste, which is worse in every way than picking it and reading the note.
  - **Not refused, on the owner's call:** people do want to move money between their own accounts, and **accounts are not necessarily unlinked in the first place** — several things the wallet already does link them, and in some cases that is the point. So this is a *known link* like every other: the wallet makes it visible rather than forbidding it ([privacy.md](privacy.md#known-links)).
- **Making money *public* to another of your accounts** is the same: allowed, and said. What it links is the account to the private UTxOs spent, which Make public always names, and the history classes say what else it ties.

## Password and vault

**Built in chunk 5.** The code is in [`extension/src/background/`](../extension/src/background/): `vault.ts`, `wallet.ts` and `secret-box/`.

- **The vault is one SecretBox blob** that seals the phrase's BIP39 entropy under the user's password. It holds 16, 20 or 32 bytes for 12, 15 or 24 words; the words themselves are never stored.
  - Every key is re-derived on unlock, so no derived key is stored.
  - It lives in `chrome.storage.local` under `seedelf.vault`, as `{ version: 1, blob: <base64>, createdAt }`.
  - The entropy ↔ phrase conversion is in Rust (`seedelf_crypto::derivation::{phrase_to_entropy, entropy_to_phrase}`), with the same rules as `parse_phrase`.
  - Unlock goes straight from entropy to keys inside WebAssembly (`SeedelfKey.fromEntropy`, `CardanoAccount.fromEntropy`), so the phrase never becomes a JavaScript string after onboarding, unless the user asks to see it (Settings, below).
  - Since the launch review (#32), WebAssembly doesn't write the phrase out either: the keys come from the entropy directly (`seedelf_key_v1_from_entropy`, `CardanoAccount::from_entropy`), and they're the keys the phrase gives. Tests check that against the frozen vectors and against pallas's own Cardano master key.
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
  - **Remove wallet** deletes the vault after the typed confirmation (`delete wallet`), as Forgot password does, and every private record with it but two: a payment that may still go through, and, from Remove wallet only, a mix from the public account that may have gone through, stay sealed until a wallet is next made or restored here, which looks for them again if it's the same phrase and deletes them if not (independent review M2, final review F1). While something is still open (that payment or mix, a private session, a Lovejoin chain being sent), it lists it first and asks a second time (independent review M5).
- **Private records** (contacts, the Seedelf history, the locked UTxOs and the collateral) are sealed under a second key: HKDF-SHA-256 of the entropy with its own salt (`seedelf-web-wallet-private-store-v1`), so it has nothing to do with the Seedelf or Cardano keys. See [architecture.md](architecture.md#storage).
- **Password rule:** at least 12 characters, with no composition rules. The UI shows a rough strength hint, and the worker enforces the length. (The CLI asks for 14 characters with character classes; the two are separate products.)
- **Performance:** unlock takes about 190 ms in the service worker, measured end to end in Playwright (Argon2id in pure JS, plus both key derivations in WebAssembly). That's well under the 1.5 s budget, so no faster Argon2id is needed. Lace's `setArgon2idImplementation` hook is kept in case that changes.
- **Lock and wipe:**
  - On lock, the worker frees the WebAssembly key objects, which overwrite `x` and the Cardano account key before releasing them, and clears `chrome.storage.session`, all but when the wallet last sent something (`seedelf.sends`, for Lovejoin's quiet rule; independent review M10).
  - Entropy buffers and the password's bytes are zeroed after use. JavaScript strings can't be zeroed, so the password string and the phrase typed during onboarding are simply dropped.
  - The password is never kept after use.
  - **Wiping is best effort.** WebAssembly wipes the copies of the phrase, the entropy and the keys its own code makes (see [architecture.md](architecture.md#crypto)). Copies inside the libraries and on the stack, and JavaScript strings (the base64 entropy read from session storage, a phrase typed or shown), stay in memory until it's reused or the worker is torn down. Lock frees the keys and clears session storage; it can't promise nothing is left.
