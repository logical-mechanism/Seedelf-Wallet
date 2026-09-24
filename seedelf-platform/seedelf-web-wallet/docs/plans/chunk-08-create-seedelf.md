# Chunk 8 plan: create a seedelf (stealth mint)

**Branch:** `web-wallet/create-seedelf`, created from `seedelf-web-wallet` after PR #251 (chunk 7) is merged. It ends with a PR back into `seedelf-web-wallet`.

This is the first **script spend** in the web wallet. Every Seedelf spend in chunks 9 and 10 (transfer, sweep, remove) reuses what this chunk builds: owned contract inputs with Schnorr proofs, a one-time key, reference scripts, giveme.my collateral, and evaluation through Ogmios.

## Start here (new session)

1. Sync, and branch:
   ```bash
   git checkout seedelf-web-wallet && git pull
   git log --oneline HEAD..origin/main   # merge main first if this lists anything
   git checkout -b web-wallet/create-seedelf
   ```
2. Read this plan, then the chunk 7 entry in [roadmap.md](../roadmap.md#handoff-notes), [architecture.md](../architecture.md) *Transaction building*, [flows.md](../flows.md) *Create a seedelf*, and [privacy.md](../privacy.md) *Rules the wallet enforces*.
3. Read the code this chunk extracts: `seedelf-cli/src/commands/util/mint.rs` (about 500 lines), and the helpers it uses in `seedelf-core/src/transaction.rs` (`seedelf_token_name`, `extract_budgets`, `total_computation_fee`, `seedelf_minimum_lovelace`, `collateral_input`, `reference_utxo`), `seedelf-core/src/data_structures.rs` (the redeemers), and `seedelf-cli/src/commands/fee.rs` (the collateral output and even rounding).
4. **Finish chunk 7's live move-in first.** Minting spends *owned contract UTxOs*, and on preprod none exist for a phrase wallet until a move-in lands.
   - The test wallet is in `extension/.preprod-test-wallet.txt` (gitignored). The user funds its `receive_0` from the faucet.
   - Then run `npm run build && node e2e/live/move-in.mjs 10`.
   - Record the tx hash in the roadmap.
5. The tooling is already installed (see [chunk 5's plan](chunk-05-vault-and-lock.md#start-here-new-session)). Commands are in [extension/README.md](../../extension/README.md).
6. Confirm the [decisions](#decisions-to-confirm-first) with the user before building the parts they affect.

## What `util mint` does today

`seedelf-cli/src/commands/util/mint.rs`, which becomes network-free builders plus a thin `run()`:

1. **Select** owned contract UTxOs (`collect_wallet_utxos`, which skips UTxOs holding a seedelf) worth the seedelf minimum (about 1.5 ADA) plus a fee guess.
2. **Token name:** `seedelf_token_name(label, inputs)`, which is `5eed0e1f` ‖ the label (at most 15 bytes) ‖ the index of the *lexicographically smallest* input ‖ its tx id, cut to 32 bytes.
3. **Outputs:**
   - The new seedelf: the minimum ADA, the token, and a freshly re-randomized own register.
   - Change back to the contract under fresh registers, with tokens 20 to an output.
4. **One-time key:** a fresh random ed25519 key. Its hash `pkh` is a required signer, and so is `COLLATERAL_HASH`.
5. **Spend redeemers:** per input, `create_proof(register, sk, pkh)` gives `(z, g_r)`. The proof is bound to `pkh`, which is the rollback-replay defence.
6. **Script plumbing:**
   - The mint redeemer carries the label.
   - Reference inputs for the seedelf and wallet scripts.
   - The PlutusV3 language view.
   - The collateral input is giveme.my's UTxO. The collateral output returns 5 ADA − 1.5 × fee to the collateral address.
7. **Draft → evaluate:**
   - Build with placeholder ex-units (14M mem, 10G steps).
   - `evaluate_transaction` (Koios `/ogmios`, JSON-RPC `evaluateTransaction`) gives budgets.
   - `extract_budgets` reads them *in response order*, and `split_last` treats the last one as the mint.
8. **Fee:**
   - Size fee: the draft signed by the one-time key plus one fake signature.
   - Compute fee: from the budgets.
   - Script-reference fee: `(seedelf_size + wallet_size) × 15`.
   - The total is rounded up to even, so the collateral maths stays whole.
9. **Finalize** with the real budgets and fee.
10. **Witness:** POST `{ tx: cbor }` to giveme.my. It answers `{ witness }`, whose last 64 bytes are the collateral key's signature. Sign with the one-time key, add that signature, then submit.

## Decisions to confirm first

| Decision | Suggestion | Notes |
|---|---|---|
| Label (personal tag) | Optional; **printable ASCII, at most 15 characters**, with a live preview of how it will read | On chain it's any bytes, cut to 15. Multi-byte text could be cut mid-character, and the wallet reads tags back as printable ASCII (`seedelfLabel` in `chain.ts`). |
| When giveme.my is contacted | **At Send**, not at Review | Draft, evaluate and finalize happen at Review, so the user sees the real fee. The collateral witness is fetched only once the user commits. |
| The seedelf's register | **A fresh re-randomization of the user's own base register** | The CLI can also mint to someone else's register (`--generator/--public-value`). The web wallet doesn't need that in v1. |
| Which UTxOs pay | **Automatic**, from the Seedelf balance (as in the CLI's `select`) | Privacy: few inputs, and never the Cardano account (privacy rule 5). |
| Minimum balance | Show the cost up front: about 1.5 ADA locked with the seedelf, plus about 0.3–0.6 ADA in fees | Only `remove` gets the locked ADA back (chunk 10). |

## Work items

### 1. Core: script-spend builders (`seedelf-core/src/build.rs`)

- **Shared pieces for every Seedelf spend:**
  - Script inputs with spend redeemers from proofs.
  - The collateral input and output.
  - The reference inputs and language view.
  - A `script_fee(size, budgets, …)` helper.
  - A **two-phase shape**: `draft(…) -> StagingTransaction` with placeholder ex-units, then `finalize(draft, budgets) -> BuiltTransaction`.
  - Both phases take the one-time key's hash and the proofs, or a closure that makes proofs, so core never needs the secret scalar in plain form. **Design this API once, for mint, transfer, sweep and remove.**
- **Harden budget matching.** Map Ogmios results by `validator.purpose` (`spend` or `mint`) and `validator.index`, not by response order. Check how Ogmios orders the result on a real response, and keep `extract_budgets` working for the CLI.
- **`build::mint_*`:** extracted from `util mint`. The CLI's `run()` becomes thin, and `seedelf-cli/tests/cli/mint.rs` must stay green.
- **Tests** (`seedelf-core/tests/`):
  - Conservation, and every output above its minimum.
  - Seedelf and change registers valid, owned and re-randomized.
  - The token name comes from the smallest input.
  - The mint redeemer holds the label.
  - Every spend proof verifies against `pkh` (`schnorr::prove`).
  - Collateral output = 5 ADA − 1.5 × fee, and the fee is even.
  - Budgets are matched by purpose and index, including a shuffled response.

### 2. WebAssembly: a stateful spend builder

- A `SeedelfSpend` (or `MintBuilder`) object that lives in the worker for one mint:
  - `new(key, requestJson)`: makes the one-time key *inside WASM*, the proofs, and the draft. Returns the draft CBOR.
  - `finalize(ogmiosJson)`: returns the final unsigned CBOR plus a summary (token name, fee parts, change).
  - `sign(collateralWitnessJson)`:
    - **Verify the collateral signature against `COLLATERAL_PUBLIC_KEY`** over the tx hash before adding it.
    - Sign with the one-time key.
    - Return the signed CBOR and hash.
  - `free()`: drops the one-time key.
- **The one-time key never reaches JavaScript.** It lives only as long as the object; a new mint gets a new key (privacy rule 1).

### 3. Service worker

- **Koios:** `evaluate(cborHex)` via POST `/ogmios` with the JSON-RPC body above. Surface Ogmios script errors in plain words.
- **`collateral.ts`:** the giveme.my client, POST `{ tx }` to `NETWORKS[network].collateral`. The host permission is already in the manifest.
- **Mint service**, like `move-in.ts`:
  - **Review:** read the contract, find the owned UTxOs (as `balances.ts` does), run the builder, evaluate, finalize. Keep the builder until Send, or rebuild if the worker restarted; a builder is in-memory only.
  - **Send:** giveme.my witness → sign → submit exactly that tx → watch it with the existing `pending-tx` watch.
  - Lock drops any builder.

### 4. UI

- **"Create a seedelf"**, on the Seedelf balance card, disabled when the balance can't cover the cost:
  - A label field with a live preview and the ASCII/15 limit.
  - The cost, stated plainly.
  - A privacy note: the seedelf is paid from the Seedelf balance, so it's never linked to the Cardano account.
- **Review:** the token name, ADA locked, the fee (size, compute and script parts can fold into one line), and change back to Seedelf → **Send**.
- **After Send:** the pending banner from chunk 7 (generalize its wording: "Seedelf mint sent…"). Once confirmed, the new seedelf appears under **Your seedelfs**.

### 5. Tests

- **Rust:** item 1's tests. The CLI's offline tests stay green (`mint` especially). `seedelf-wasm` native tests: proofs verify, the collateral witness check refuses a wrong signature, and the one-time key signs.
- **Vitest:** the Koios `evaluate`, the giveme.my client, and the mint service over fakes. Fixtures:
  - A **recorded real Ogmios response**. Evaluate a CLI-built preprod draft against live Koios once and save it.
  - A giveme.my witness shape. The CLI harness in `seedelf-cli/tests/cli/harness.rs` mocks both and is a good reference.
- **Playwright:** create a seedelf end to end with Koios, Ogmios and giveme.my served from fixtures: the label preview, review, send, pending, confirmed, and the seedelf listed.
- **Live:** mint on preprod from the test wallet after its move-in. Check the seedelf appears, and that its register is owned and valid.

### 6. Docs

- architecture.md *Transaction building*, flows.md *Create a seedelf* (as built), privacy.md (confirm rules 1, 2 and 5 hold), `seedelf-platform/CLAUDE.md` (what's extracted now), and the READMEs.
- roadmap.md: tick chunk 8 and add a handoff note.

## Risks and things to check

- **Budget order** (above). A wrong match puts the mint's budget on a spend and fails at submit, or wastes fee.
- **giveme.my** is a single service. If it's down or answers oddly, say so plainly. The fee cap is 5 ADA of collateral: `collateral_output` errors if 1.5 × fee > 5 ADA.
- **The one-time key's lifetime** crosses two network calls (evaluate, then witness at Send). A worker restart in between loses it, so rebuild.
- **The token name** comes from the smallest input. Coin selection may change the inputs between Review and a rebuild, and with them the name. Show the name from the build that's actually sent.

## Out of scope

Transfer (chunk 9), sweep and remove (chunk 10), minting to someone else's register, and the CLI's `create` (paid by an outside wallet, which links it).
