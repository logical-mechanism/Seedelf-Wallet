# Architecture

Keep it light: a small Manifest V3 extension, the Seedelf crypto and transaction building we already have in Rust (compiled to WebAssembly), and Koios for chain data. Nothing else unless it earns its place.

## Shape

```mermaid
flowchart LR
  UI["UI<br/>(popup or full tab)"] -- "typed RPC (runtime messages)" --> SW
  subgraph SW["Service worker"]
    Vault["Vault + lock"]
    Wallet["Wallet state"]
    Crypto["seedelf-crypto (WASM)"]
    Tx["Tx building + signing"]
  end
  SW -- "fetch" --> Koios["Koios"]
  SW -- "fetch" --> Collat["giveme.my collateral"]
  Page["dApp page"] -. "CIP-30 via content script<br/>(round-trip phase only)" .-> SW
```

- **Service worker:** owns everything that matters.
  - While unlocked, it holds the decrypted secret. It is the only place secrets ever exist.
  - It also holds wallet state, builds and signs transactions, and makes all network calls.
- **UI:** renders state and sends the user's actions to the service worker. It never holds keys. The only secret it ever sees is the recovery phrase, while the user writes it down or types it in during onboarding.
- **Content scripts:** v1 has none. They arrive with the contract round trip, to offer CIP-30 on one-time accounts.
  - This matters for security: v1 injects nothing into web pages.
  - v1 only needs host permissions for Koios and giveme.my, not `<all_urls>`.

## Service worker

- **The worker owns the state and the UI mirrors it.** The UI takes a snapshot on open (the `status` request), then refreshes whenever the worker broadcasts `state-changed`, for example on auto-lock. This is Lace's model, minus its framework.
  - The wallet states are `no-wallet`, `locked` and `unlocked` (`extension/src/background/wallet.ts`).
  - The worker runs state changes one at a time, so two pages can't race each other past the unlock back-off.
- **Chrome kills an idle worker after about 30 seconds.** State must reload from storage on every wake-up. The worker's timers don't survive either, so auto-lock uses `chrome.alarms`.
  - Register event listeners synchronously, before the first `await`, or the event that woke the worker is lost.
- **The worker is an ES module** (`"type": "module"` in the manifest).
  - Static imports of the extension's own files are fine. The build emits `sw.js` plus a shared chunk.
  - Dynamic `import()` and top-level `await` are not allowed in service workers, so WASM initializes lazily: `loadWasm()` in `extension/src/background/wasm.ts`.
  - Lace's classic-worker `importScripts` preloading isn't needed.
- **Staying unlocked across restarts (built in chunk 5).** A worker restart loses everything held in memory, including the unlocked keys. The popup can't hold the keys either, because it closes as soon as the user clicks away.
  - On unlock, the vault's entropy goes into `chrome.storage.session` (`seedelf.entropy`), along with the time of the last activity (`seedelf.lastActivity`). That storage is in memory only, never written to disk, cleared when the browser closes, and not readable by content scripts.
  - A restarted worker re-derives the keys from there, unless the auto-lock deadline has passed, in which case it locks.
  - **Lock** (manual or auto-lock) clears the key from session storage as well as from memory.
  - The result: the wallet stays unlocked until auto-lock or browser close, instead of asking for the password after every idle restart.

## Crypto

- **Seedelf cryptography comes from [seedelf-crypto](../../seedelf-crypto/), compiled to WebAssembly with `wasm-bindgen`.**
  - This is the same prover the CLI already runs against the on-chain verifier.
  - It covers register creation, re-randomization, the ownership check and Schnorr proofs.
  - One implementation, so there are no byte-for-byte parity problems.
- **One WebAssembly crate for the wallet:** [seedelf-web-wallet/wasm](../wasm/) (`seedelf-wasm`), a Cargo workspace member.
  - It exposes only what the extension needs, for both crypto and [transaction building](#transaction-building).
  - `build.sh` produces an ES module of about 590 KB, before `wasm-opt`.
  - Its tests check the output against native Rust byte for byte.
- **Build settings:**
  - `getrandom` 0.2 with the `js` feature, set in the wasm crate.
  - `CC_wasm32_unknown_unknown=clang`, because `blst` is C code.
  - `AR_wasm32_unknown_unknown=llvm-ar`, which is `llvm-ar-18` on Ubuntu.
  - `wasm-bindgen-cli` pinned to the crate's `wasm-bindgen` version.
- **The manifest CSP needs `script-src 'self' 'wasm-unsafe-eval'`** to load WebAssembly.
- **Recovery phrases (BIP39) are handled in Rust too:** generation, validation and the Seedelf key derivation. See [keys-and-accounts.md](keys-and-accounts.md#seedelf-key-derivation).
- **Everything else uses small, audited JS libraries:**
  - `@noble/hashes` (Argon2id, BLAKE2b)
  - `@noble/ciphers` (ChaCha20-Poly1305)

## Transaction building

**Decided: Rust (Pallas 0.33), compiled to WebAssembly.**

- **One implementation.** The CLI already builds every Seedelf transaction with Pallas: registers, reference-script spends, the fee and ex-unit loop, and the collateral-service witness. Offline integration tests cover it. Reusing it gives the same single implementation as the crypto.
- **The rejected option was a TypeScript library.** Lace's `TransactionBuilder` has no reference inputs, so we would have had to port the Seedelf logic by hand.

**What a probe found:**

- **It compiles.** `seedelf-core`, `pallas-txbuilder`, `seedelf-crypto` and `seedelf-koios` all compile to `wasm32-unknown-unknown`, at about 912 KB before `wasm-opt`.
- **One line blocked it.** `seedelf-koios` sets `connect_timeout` on its HTTP client, and `reqwest`'s browser build doesn't have that setting. Gate the line with `#[cfg(not(target_arch = "wasm32"))]`.

**Plan: separate building from network calls.** Each CLI command's `run` mixes pure building with a few network calls:

- **At the start:** protocol parameters, UTxOs, recipient registers.
- **In the middle:** `evaluate_transaction`, to get ex-units.
- **At the end:** the giveme.my collateral witness, then submit.

The building moves into network-free functions in `seedelf-core`: a draft step, plus a finalize step after evaluation for script spends. Both callers then use the same functions:

- **The CLI** calls them with Koios data, as it does today.
- **The extension** fetches the same Koios JSON in TypeScript and passes it through WebAssembly. It deserializes into the same `seedelf-koios` types.

**Notes on the refactor:**

- **Scope:** only the commands the web wallet needs, about 2.1k lines:
  - `external sweep` (move in)
  - `util mint` (create)
  - `transfer`
  - `sweep`
  - `remove`
- **Tests guard it.** The CLI's offline integration tests (`seedelf-cli/tests/cli/`) already check value conservation, min-UTxO and valid change registers for each of these commands.
- **CLAUDE.md rule:** this reverses the "don't reintroduce `build_*` functions" rule in [seedelf-platform/CLAUDE.md](../../CLAUDE.md). That rule existed because the removed GUI was the only other consumer. Update it when the refactor lands.

## Networks

**Preprod first. Mainnet is a build flag.**

**Default builds are preprod-only:**

- Only the preprod hosts are in the manifest's host permissions.
- There is no network switch.
- The UI shows a permanent **PREPROD** badge.

**Setting the flag** (for example `VITE_ENABLE_MAINNET=true`) makes three changes:

- It adds the mainnet hosts to the manifest.
- It makes mainnet the default.
- It adds a network switch in settings, so preprod stays available for testing.

**One network value drives everything network-specific.** The Rust side already takes a `network_flag` everywhere (`true` = preprod), and the WebAssembly API passes it through. This is how the CLI's `--preprod` works.

| | Preprod | Mainnet |
|---|---|---|
| Koios | `https://preprod.koios.rest/api/v1` | `https://api.koios.rest/api/v1` |
| Collateral service | `https://www.giveme.my/preprod/collateral/` | `https://www.giveme.my/mainnet/collateral/` |
| Contract config | `get_config(variant, true)` | `get_config(variant, false)` |
| Addresses | `addr_test…` | `addr…` |

- **The contract config** covers reference UTxOs, the collateral UTxO and the shared staking hash. These differ per network. The script hashes are the same on both.
- **Cached chain data is kept per network.** The vault is shared, because keys don't depend on the network. The CLI works the same way.
- **Addresses are checked against the active network** before anything is sent. This mirrors the CLI's `is_on_correct_network`.
- **Preprod status on 2026-09-23:**
  - The wallet and seedelf reference scripts are live and unspent.
  - The collateral UTxO is live, and the giveme.my preprod endpoint is up.
  - The wallet contract holds 25 UTxOs.

## Chain data

**Koios, same as the CLI.** Balances were built in chunk 6: `extension/src/background/koios.ts` (the client), `chain.ts` (pure helpers) and `balances.ts` (the service).

**What one balance reading asks Koios** (three requests, in parallel):

| Request | For |
|---|---|
| `credential_utxos` with the wallet contract's script hash | Every UTxO in the contract, to find the owned ones |
| `account_addresses` with the Cardano account's stake address (`_empty: true`) | Every address that has used the stake key, including empty ones, for discovery |
| `account_utxos` with the same stake address | The account's UTxOs |

- **Paging:** 1000 rows a page, in a fixed order (`order=tx_hash.asc,tx_index.asc`), until a short page.
- **Retries:** a rate limit (429), a server error (5xx) or a network failure is retried twice, after 1 s and 3 s. Anything else fails at once with Koios's status.
- **Finding owned UTxOs:** keep the contract UTxOs whose inline datum is a register (constructor 0, two 48-byte fields) with `generator^x == public_value`. This is `is_owned`, the same method the CLI's `balance` uses, run in WebAssembly. Points that don't decode or aren't torsion-free count as not owned.
  - As in the CLI, a UTxO holding a seedelf isn't counted in the balance. It's listed as a seedelf, with the ADA locked with it.
  - The query goes by payment credential, so it finds contract UTxOs with and without a staking part. Older outputs on preprod carry the shared Seedelf stake key; the current CLI writes none.
  - The cost grows with the size of the contract's UTxO set. That's fine today; revisit if it gets large.
- **Discovering the Cardano account:** walk the receive chain (`0/i`) and the change chain (`1/i`) from index 0 until 20 addresses in a row are unused. "Used" means Koios lists the address under the account's stake key.
  - The account's UTxOs count only when they sit at an address the wallet derived. Anyone can build an address from their own payment key or script plus someone else's stake key. The well-known `abandon … art` test phrase has exactly such a script UTxO on preprod.
  - Addresses from our payment keys with no staking part, or with someone else's, aren't found. Standard wallets don't make them.
- **Tokens** show the name as text when it decodes as UTF-8 (after dropping a CIP-68 label such as `0014df10`), otherwise as hex, with the decimals Koios reports. No token images are fetched: they would reveal holdings to more servers, and the page CSP allows only the extension's own images.
- **When it reads the chain:** when Home opens, if the last reading is over a minute old, and on **Refresh**. There's no background polling. The reading is cached per network in `chrome.storage.session` (it says which contract UTxOs are the user's, so it never goes to disk) and wiped on lock.
- **Still to come:** protocol parameters, tip, `evaluate_transaction` and `submit_tx` (chunk 7), and seedelf token lookups for recipients' registers (chunk 9).
- **Collateral for Seedelf spends comes from the giveme.my service**, exactly as in the CLI (`seedelf-koios`). See [privacy.md](privacy.md).
- **All requests come from the user's IP.** The IP-tracking caveats in the root [README](../../../README.md#de-anonymizing-via-ip-tracking) apply. The extension adds no analytics or telemetry.

## Storage

**Permissions:** `storage` and `alarms`, plus the host permissions for the enabled network's Koios and giveme.my.

| Where | Key | What |
|---|---|---|
| `chrome.storage.local` | `seedelf.vault` | The encrypted vault: a single SecretBox blob, see [keys-and-accounts.md](keys-and-accounts.md#password-and-vault) |
| `chrome.storage.local` | `seedelf.unlockFailures` | `{ count, lastFailureAt }` for the unlock back-off |
| `chrome.storage.session` | `seedelf.entropy` | The vault entropy, only while unlocked |
| `chrome.storage.session` | `seedelf.lastActivity` | When the user last did something, for auto-lock |
| `chrome.storage.session` | `seedelf.balances.<network>` | The last balance reading, only while unlocked |

Non-secret settings and cached chain data join `chrome.storage.local` in later chunks.

- **Decrypted secrets live only in service-worker memory and `chrome.storage.session`** (see above).
- **They are wiped on lock.** Lace keeps the last verified password in memory after use (`packages/contract/authentication-prompt/src/store/auth-secret-accessor.ts`), and we don't.
- **Auto-lock** after 15 minutes without activity.
  - While unlocked, the UI reports activity (a key press or a click) to the worker, at most every 30 seconds.
  - A `chrome.alarms` alarm checks once a minute, and every request checks too.
  - A settings screen for the delay can come later.
- **Failed unlocks** trigger an exponential back-off: 1 s, 2 s, 4 s and so on, capped at 60 s (Lace's values).
  - Unlike Lace, the worker enforces it: an attempt that comes too early is refused before the password is even tried.
  - The count is kept in `chrome.storage.local`, so restarting the worker or the browser doesn't reset it. The right password resets it.

## UI

- **React + TypeScript, bundled with Vite 8 (Rolldown) (decided).**
  - One build emits the popup/tab page, `sw.js`, the WASM asset, and `manifest.json` (generated by `extension/src/manifest.ts`).
  - The page CSP is `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'` plus the enabled network's Koios and giveme.my origins only.
  - No heavy component library.
  - Plain CSS with design tokens for light and dark themes. The colours come from the Seedelf logo (navy `#011833`, teal `#00c4bc`), and the dark theme follows Lace's structure.
  - Not Lace's React Native / Expo stack.
- **Lace's flows and visual language may inspire ours:** spacing, corner radius, light and dark themes, screen-to-screen flow.
- **We don't take Lace's name, logo or brand assets,** and we don't take its commercial fonts (Brandon Grotesque and Proxima Nova are in its repo but not licensed to us).
- **Our own brand:** the Seedelf logo set is in [brand/](../brand/). The extension ships resized copies (`extension/public/`).
- **Icons** only under a compatible license. The few UI icons so far are drawn inline for this project.
- **Popup plus full tab (decided), like Eternl:**
  - Clicking the toolbar icon opens a popup.
  - An "expand" button opens the same app in a full browser tab.
  - One responsive UI serves both.
  - Onboarding (create or restore) opens in a full tab, as in Lace and Eternl, because a popup closes as soon as the user clicks elsewhere.
  - No side panel. Lace opens in a side panel, which feels cramped.

## What we borrow from Lace

Paths are relative to a `lace-extension@2.4.0` checkout (see the [README](../README.md#reference-lace)).

| What | Lace path | How we use it |
|---|---|---|
| SecretBox (Argon2id + ChaCha20-Poly1305) | `packages/lib/core/src/secret-box/` | Adopted in `extension/src/background/secret-box/` (Apache-2.0, without the EMIP-003 path) |
| Typed RPC between extension contexts | `packages/lib/extension-messaging/src/` | Adapt; it's about 1.8k lines and needs RxJS |
| Service-worker boot order and install preloading | `apps/lace-extension/src/sw-script/` | Pattern |
| Worker-owned store mirrored in the UI | `apps/lace-extension/src/util/connect-store.ts`, `apps/lace-extension/src/sw-script/create-remote-store.ts` | Pattern |
| Lock state machine and inactivity timer | `packages/contract/app-lock/src/store/` | Pattern |
| Unlock back-off | `packages/contract/authentication-prompt/src/store/unlock-backoff.ts` | Pattern |
| MV3 manifest and CSP | `apps/lace-extension/assets/manifest.json` | Pattern |
| CIP-30 injection (round-trip phase) | `apps/lace-extension/src/content-scripts/`, `packages/lib/dapp-connector/`, `packages/module/dapp-connector-cardano/` | Pattern |
| Keeping existing vkey witnesses intact | `packages/module/blockchain-cardano/src/tx-executor-implementation/merge-pre-existing-vkeys.ts` | Reference |

We don't take Lace's contracts, modules or feature-flag framework, its host/guest shell, its analytics (PostHog, Sentry), or anything for Bitcoin or Midnight.

**Licensing:** Lace is Apache-2.0, and this repository is MIT. Files copied or adapted from Lace stay under Apache-2.0. For each one:

- keep its notices
- mark our changes
- ship a copy of the Apache-2.0 license alongside it
