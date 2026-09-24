# seedelf-wasm

The WebAssembly bindings the web wallet uses for Seedelf cryptography. It is a thin layer over [seedelf-crypto](../../seedelf-crypto/): every protocol rule is enforced there, and this crate only adapts it for JavaScript.

## API

| Export | What it does |
|---|---|
| `SeedelfKey` | Holds the secret scalar inside WebAssembly memory. |
| `SeedelfKey.fromPhrase(phrase, account)` | The wallet's key from a 12-, 15- or 24-word phrase, using the frozen v1 derivation (`seedelf-crypto::derivation`). Throws with a reason on an invalid phrase. |
| `SeedelfKey.fromEntropy(entropy, account)` | The same key from the phrase's BIP39 entropy, as the vault stores it. The phrase is rebuilt and wiped inside WebAssembly, so it never reaches JavaScript. |
| `SeedelfKey.random()`, `SeedelfKey.fromHex()` | Dev/test constructors only. |
| `key.baseRegister()` | Returns the base register `(G1, G1^x)`. |
| `key.isOwned(register)` | Whether this key can spend a UTxO with this register. |
| `key.createProof(register, vkh)` | Returns a Schnorr proof `{ z, gR }` bound to the one-time key hash `vkh` (28 bytes, hex). |
| `key.free()` | Drops the key and overwrites the scalar. |
| `generatePhrase()` | A new 24-word recovery phrase from the secure random source. |
| `validatePhrase(phrase)` | Accepts 12, 15 or 24 words, the lengths Lace accepts. Throws with a user-facing reason (word count, unknown word N, checksum). Case and extra whitespace are ignored. |
| `phraseToEntropy(phrase)`, `entropyToPhrase(entropy)` | Phrase ↔ BIP39 entropy (16, 20 or 32 bytes), with the same rules as `validatePhrase`. The vault stores entropy, not words. |
| `bip39Wordlist()` | The 2048 BIP39 English words, for autocomplete. |
| `CardanoAccount.fromPhrase(phrase, account)` | The wallet's Cardano account: standard CIP-1852 keys, the same as Lace, Eternl and Yoroi. v1 uses account 0. The private keys stay in WebAssembly memory. |
| `CardanoAccount.fromEntropy(entropy, account)` | The same account from vault entropy. |
| `account.receiveAddress(network, index)`, `account.changeAddress(network, index)` | Base addresses `0/index` and `1/index`, delegated to the staking key `2/0`. |
| `account.stakeAddress(network)`, `account.accountPublicKey()` | The reward address, and the account xpub (hex). |
| `Network.Preprod`, `Network.Mainnet` | The network for addresses. |
| `Register` | `{ generator, publicValue }`: compressed G1 points in hex. |
| `rerandomize(register)` | Returns `(g^d, u^d)` with a fresh `d` that is thrown away. |
| `isValidRegister(register)` | On-curve and torsion-free check. |
| `registerToDatum(register)` | Inline-datum bytes (PlutusData CBOR). |
| `verifyProof(register, z, gR, vkh)` | Off-chain mirror of the validator's check. |
| `buildMoveIn(account, key, requestJson)` | Builds and signs a move-in with `seedelf-core`'s `build::move_in`. The request carries Koios's `epoch_params` row and the account's UTxOs, each with its `role/index`, which is checked against the derived address. Returns JSON with the signed CBOR, its hash and a summary. Keys never reach JavaScript. |
| `draftMint(key, requestJson)` | Creating a seedelf, step 1 (`build::mint`). The request carries `network`, the `epoch_params` row, the wallet's spendable contract UTxOs (each checked: owned, no seedelf) and the `label` (printable ASCII, 15 at most). Picks the UTxOs, proves them under a new one-time key, and returns `{ seed, draftCbor, inputs }` for Ogmios. |
| `finishMint(key, requestJson)` | Step 2: the same request plus `seed` and Ogmios's `evaluation`. Returns the unsigned transaction with the measured budgets and fee: `{ txCbor, txHash, seed, tokenName, lovelace, fee: { size, compute, scriptReference, total }, changeLovelace, changeTokens, changeOutputs, inputs }`. An Ogmios error becomes a plain-words exception. |
| `draftAccountMint(account, key, requestJson)` | Creating a seedelf paid by the Cardano account (`build::account_mint`), step 1. The request carries `network`, the `epoch_params` row, the account's UTxOs (each with its `role/index`, checked as for a move-in) and the `label`. Picks the inputs and the collateral, and returns `{ draftCbor, inputs, collateral }` for Ogmios. |
| `finishAccountMint(account, key, requestJson)` | Step 2: the same request plus Ogmios's `evaluation`. Returns the transaction **signed** with every input's key and the collateral's, ready to submit, and a summary like `finishMint`'s plus `collateral`. |
| `draftTransfer(key, requestJson)` | Paying a seedelf, step 1 (`build::transfer`). The request carries `network`, the `epoch_params` row, the wallet's spendable contract UTxOs (checked as for a mint), `to` (the seedelf's full name), `recipient` (the contract UTxO holding it, as Koios returns it), `lovelace` and `tokens` (`[{ policyId, assetName, quantity }]`). Checks the recipient's UTxO and register, picks the UTxOs (those holding the tokens first), proves them under a new one-time key, and returns `{ seed, draftCbor, inputs }` for Ogmios. |
| `finishTransfer(key, requestJson)` | Step 2: the same request plus `seed` and Ogmios's `evaluation`. Returns the unsigned transaction and `{ to, toSelf, lovelace, tokens, fee, changeLovelace, changeTokens, changeOutputs, inputs }`. `toSelf` says the seedelf is this wallet's own; paying it is allowed. |
| `signScriptSpend(key, requestJson)` | At Send: `{ txCbor, seed, collateral }`, where `collateral` is giveme.my's answer. Checks giveme.my's signature against its public key over the transaction id, then adds it and the one-time key's. Returns `{ txCbor, txHash }`. |

The one-time key of a script spend is HKDF-SHA-256 of the Seedelf scalar (salt `seedelf-one-time-key-v1`, info the 32-byte `seed`). The seed can wait in JavaScript between review and Send; the key is re-derived inside WebAssembly each time and never leaves it.

## Build

```bash
./build.sh    # → pkg/seedelf_wasm.js, pkg/seedelf_wasm_bg.wasm, .d.ts
```

**Requirements:**

- the `wasm32-unknown-unknown` Rust target
- `clang` with a wasm32 backend, because `blst` is C code
- `llvm-ar` (Ubuntu names it `llvm-ar-18` and similar; the script finds it)
- `wasm-bindgen-cli` at the exact version of the `wasm-bindgen` crate in `Cargo.lock`. The script checks the version and prints the install command.

The output is an ES module (`--target web`). Load it with `init()` or `initSync()`.

## Test

From `seedelf-platform/`:

```bash
cargo test -p seedelf-wasm                                        # native, the plain-Rust layer
./seedelf-web-wallet/wasm/build.sh
node --test "seedelf-web-wallet/wasm/tests/*.test.mjs"            # the built package, from JS
```

Both suites check the same pinned vectors as `seedelf-crypto`, so the WebAssembly build is known to match native Rust byte for byte:

- `seedelf-crypto`'s `random_register` vector
- the frozen key-derivation vectors in `seedelf-crypto/tests/vectors/seedelf_key_v1.json`
- the Cardano account vectors in `seedelf-crypto/tests/vectors/cardano_account.json`, verified against `@cardano-sdk` (Lace's library)
- entropy round trips on every one of those phrases (`tests/entropy.test.mjs`)
- a move-in on the 12-word phrase's recorded preprod UTxOs (`tests/move-in.test.mjs`). The native tests also check that every witness verifies against the tx hash, and that the signers are exactly the inputs' payment keys.
- an account-paid mint on the 12-word phrase's recorded preprod UTxOs, with a real preprod evaluation (`tests/mint.test.mjs`). The native tests also check that every witness verifies, and that the signers are exactly the inputs' and the collateral's keys.
- a transfer of 5 ADA and 1 tUSDM from the 12-word phrase's synthetic Seedelf UTxOs to a live preprod seedelf, with a real preprod evaluation (`tests/transfer.test.mjs`, from the extension's `tests/fixtures/transfer-preprod.json`). The native tests also check that the payment is a fresh copy of the recipient's register, that paying your own seedelf is flagged, and every refusal: a name that isn't whole, a UTxO without that seedelf or outside the contract, no register, and invalid, torsion or identity points.
- a mint of the 12-word phrase's synthetic Seedelf UTxOs with a real preprod Ogmios evaluation (`tests/mint.test.mjs`, from the extension's `tests/fixtures/mint-preprod.json`). The native tests also sign one with a stand-in collateral key and check every witness, and check that giveme.my's real key refuses anything else.
