# Chunk 7 plan: builder extraction and move-in

> **Done on 2026-09-23, except the live preprod run** (the test wallet wasn't funded). The [roadmap handoff note](../roadmap.md#handoff-notes) has what was built and how to finish the live run.

**Branch:** `web-wallet/move-in`, created from `seedelf-web-wallet` at `1e70e35` (after PR #250). `main` had nothing new to merge. It ends with a PR back into `seedelf-web-wallet`.

## Start here (new session)

1. Check out the branch and merge `seedelf-web-wallet` if it moved.
2. Read this plan, then [architecture.md](../architecture.md) *Transaction building* and *Chain data*, and [flows.md](../flows.md) *Move in*.
3. The preprod test wallet for the live run is in `extension/.preprod-test-wallet.txt` (gitignored).

## Decided with the user (2026-09-23)

| Question | Decision |
|---|---|
| What move-in lets the user choose | An **ADA amount (or Max) plus a token picker**. A picked token moves in full. |
| After submitting | **Watch** the tx with Koios `tx_status` every 15 s for up to 5 minutes, show Pending → Confirmed, then refresh balances once |
| Live preprod run | A **fresh test wallet the user funds** from the faucet |
| Change | Back to the Cardano account's receive address **`0/0`**, like Lace's single-address mode |

## Work items

### 1. Make `seedelf-core` build for WebAssembly

- Gate `seedelf-koios`'s `connect_timeout` and `timeout` with `#[cfg(not(target_arch = "wasm32"))]`. This was the only blocker; checked by building `seedelf-wasm` with `seedelf-core` as a dependency.
- `ProtocolParameters::from_koios(&Value)`: split the parsing out of `epoch_params()`, so the extension can pass Koios JSON through WebAssembly.

### 2. Network-free builders in `seedelf-core` (`build.rs`)

- **Shared pieces:**
  - `deposit_outputs(params, wallet_addr, owner, lovelace, tokens)`: contract outputs under fresh re-randomizations of the owner's register, with tokens split 20 per output (`MAXIMUM_TOKENS_PER_UTXO`), each carrying its minimum and the last carrying the rest. This was duplicated twice inside `external sweep`.
  - Fee estimation: sign a draft with one fake key per distinct signer, apply the linear fee, and repeat until the fee is stable. `fake_signer` and `linear_fee` move from the CLI's `fee.rs` into core.
- **`external_sweep(...)`:** the CLI command's building, unchanged in behaviour. `run()` keeps the network calls (params, UTxOs, submit) and signs.
- **`move_in(...)`:** the web wallet's deposit from the Cardano account.
  - **Never selects** a pure-ADA UTxO of exactly 5 ADA (another wallet's collateral), as in `collect_address_utxos`.
  - **Always selects** the UTxOs holding picked tokens. Then it adds pure-ADA UTxOs, largest first, then other token UTxOs, until the amount, the fee and a valid change output are covered.
  - **Max** spends every eligible UTxO. The change output keeps exactly the minimum ADA for the tokens that aren't moving.
  - **Outputs:** the deposit outputs, then change to `0/0`, with any unpicked tokens split 20 per output. No change output if nothing is left.
  - Returns the unsigned transaction and a summary: ADA and tokens moved, fee, change, and the signer paths.
- The CLI's `seedelf-platform/CLAUDE.md` rule against `build_*` functions is reversed, as [architecture.md](../architecture.md#transaction-building) planned.

### 3. WebAssembly: `buildMoveIn(account, key, requestJson)`

- **Request:** the network, the Koios `epoch_params` row, the account's UTxOs each with its `role/index`, `lovelace` (or null for Max), and the picked tokens.
- It checks that every UTxO sits at the address its path derives. Then it builds, signs with each input's payment key, and returns `{ txCbor, txHash, fee, … }`.
- Keys never leave WebAssembly.

### 4. Service worker

- **Koios:** `epochParams()`, `submitTx(cbor)`, `txStatus(hashes)`.
- **Move-in:**
  - It reads the account fresh, running discovery with paths, which is shared with the balance service.
  - It builds through WebAssembly and keeps the signed tx as pending in session storage.
  - On confirm, it submits exactly that tx.
- **RPC:** `move-in-build { lovelace | null, tokens }` → summary. `move-in-submit { txHash }` → submitted. `tx-status { txHash }` → confirmations.

### 5. UI

- **Move in**, from the Cardano account card:
  - An amount field with **Max**, and the list of the account's tokens to tick.
  - A privacy note: round amounts, and the link this creates (the Cardano account → some contract UTxOs, never a seedelf name).
- **Review:** what moves, the fee, the change → **Confirm**.
- **Pending:** the tx hash with a Cardanoscan link, a Pending → Confirmed status, then the refreshed balances.

### 6. Tests

- **Rust:**
  - Core builder tests: value conservation, min-UTxO, owned valid registers, the token split, collateral never spent, Max, and the fee covering the real signed size.
  - The CLI's offline tests stay green, `external sweep` included.
  - `seedelf-wasm`: signatures match the inputs' payment credentials.
- **Node (WASM):** `buildMoveIn` on the recorded preprod account.
- **Vitest:** the Koios additions, and the move-in service over the fake Koios (build, the pending tx, submit, status).
- **Playwright:** move-in end to end with Koios from fixtures. It captures the submitted CBOR, then shows Pending → Confirmed → refreshed.
- **Live:** one real move-in on preprod from the funded test wallet. Then its Seedelf balance shows a real owned contract UTxO.

### 7. Docs

- architecture.md *Transaction building* (as built), flows.md *Move in*, extension/README.md, `seedelf-platform/CLAUDE.md`, and the roadmap tick and handoff.

## Out of scope

Create a seedelf (chunk 8), transfer (chunk 9), withdraw (chunk 10), and moving the 5-ADA collateral UTxOs (use the other wallet for those).
