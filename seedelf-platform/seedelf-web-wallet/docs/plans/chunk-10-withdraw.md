# Chunk 10 plan: withdraw (sweep and remove)

**Branch:** `web-wallet/withdraw`, taken from `seedelf-web-wallet` after #254 (chunk 9) merged. It ends with a PR back into `seedelf-web-wallet`.

Withdraw takes money out of the Seedelf balance: to any address (the CLI's `sweep`), or by removing a seedelf and freeing the ADA locked with it (the CLI's `remove`). Both are Seedelf script spends, so the machinery is there:

- `ScriptSpend` in `seedelf-core` does the owned inputs, proofs, one-time key, giveme.my collateral, draft → Ogmios → finalize, and budgets by purpose and index. `ScriptSpend::mint` already takes a negative amount for a burn.
- In the extension, `background/script-spend.ts` is the whole build and Send flow.

What's new: change that goes to an **address** instead of back into the contract (Max, and a removal's ADA), the destination checks, the ADA Handle lookup, and two screens.

## Start here (new session)

1. Sync the branch:
   ```bash
   git checkout web-wallet/withdraw && git pull
   git fetch origin && git merge origin/seedelf-web-wallet   # if it moved since
   git log --oneline HEAD..origin/main                       # merge main first if this lists anything
   ```
2. Read:
   - this plan
   - the chunk 9 entry in [roadmap.md](../roadmap.md#handoff-notes)
   - [flows.md](../flows.md) *Withdraw* and *Transfer*
   - [privacy.md](../privacy.md) *Known links*, especially *Exit*
3. Read the code this chunk extracts and copies:
   - `seedelf-cli/src/commands/sweep.rs` and `remove.rs`: still building inline.
   - `seedelf-core/src/build.rs`: `ScriptSpend`, `transfer`, `select_script_inputs`, `change_outputs`.
   - `seedelf-web-wallet/wasm/src/lib.rs`: `transfer_spend`, `check_spendable`, `draft_of`, `finishing`.
   - `extension/src/background/{script-spend,transfer}.ts` and `extension/src/ui/screens/Transfer.tsx`.

## Decisions (confirmed with the user, 2026-09-24)

| Decision | Decided | Notes |
|---|---|---|
| Where a removed seedelf's ADA goes | **The user picks: the Cardano account (`0/0`, the default) or the Seedelf balance**, each with a note on what it links | Returning it to whatever paid for the mint links nothing new. An account-paid seedelf's ADA put into the Seedelf balance ties the name to that new UTxO, and to whatever it's later spent with. The Seedelf balance is right for a stealth-minted seedelf. |
| Withdraw destinations | **Any key address on this network, or an ADA Handle.** Script addresses are refused, as in the CLI (the output carries no datum). **A warning when it's your own Cardano account** | Withdrawing to your own account re-links the money (privacy.md *Exit*). The handle is resolved through Koios, which then sees it. |
| Max | **Max sends every Seedelf UTxO that fits one transaction, up to 20** (the CLI's `MAXIMUM_WALLET_UTXOS`), with all their tokens, and the review says what's left | The form notes that spending everything at once ties those UTxOs together (co-spending). |
| What an amount sends | An ADA amount (the `AdaInput` rules) plus optional tokens, each with an amount, as in transfer | The destination output needs its address minimum, about 1 ₳, more with tokens. |

## Work items

### 1. Core (`seedelf-core/src/build.rs`)

- **`ScriptSpend::change_to(addr)`:** what's left goes to a key address instead of back into the contract, through `change_outputs` (tokens 20 to an output). That is Max, and a removal's ADA.
- **`is_payable_address(addr, network_flag)`:** Shelley, on this network, and no script in the payment or the delegation part (the CLI's `is_not_a_script` and `is_on_correct_network`).
- **`sweep(chain, available, to, lovelace, tokens, change_owner, signer)`**, with `sweep_from` for the CLI's `--utxo`. It pays `to` a fixed output, refused below the address minimum, and the change goes back into the contract. Selection is `transfer`'s: the UTxOs holding the tokens first.
- **`sweep_all(chain, inputs, to, change_owner, signer)`:** spends exactly `inputs`, with no fixed output; everything less the fee goes to `to`.
- **`remove(chain, seedelf_utxo, change_owner, signer)`:** spends the seedelf's UTxO and burns its token (`mint(name, -1, create_mint_redeemer(""))`). The rest goes back into the contract unless `.change_to(addr)`. It refuses a UTxO without exactly one seedelf token.
- **The CLI's `sweep` and `remove` `run()`s become thin.** They keep their argument checks and the ADA Handle lookup.
  - `tests/cli/remove.rs` mocks Ogmios with `mount_evaluate(2)` (two "spend" budgets). A `ScriptSpend` burn needs a spend budget and the policy's, so it switches to `mount_evaluate_mint(1)`. That is the same mock fix `util mint` needed. The assertions stay.
- **Tests** (a `withdraw` module in `mint_test.rs`):
  - An amount with change; part of a token.
  - Max with 25 tokens, which go out 20 to an output.
  - A removal to an address, and one back into the contract.
  - The fee against the ledger's formula: for remove, both scripts (629 + 519 bytes).
  - Budgets on a shuffled answer.
  - Refusals: a script or wrong-network address, below the address minimum, a UTxO without a seedelf, and burning with no policy budget.

### 2. WebAssembly

- **`draftWithdraw` / `finishWithdraw`:** the request is `network`, `params`, the spendable `utxos`, `to` (a bech32 address), `lovelace` (`null` for Max), and `tokens`. The result is the transfer summary's shape, plus `to`, `max` and `left` (how many UTxOs Max couldn't take).
  - WASM checks the address, and the owned inputs as for a transfer.
  - Max takes the 20 largest spendable UTxOs.
- **`draftRemove` / `finishRemove`:** the request is `network`, `params`, the seedelf's `utxo`, and `to` (a bech32 address, or `null` for the Seedelf balance).
  - WASM checks that the UTxO is this wallet's and holds exactly one seedelf token.
- **`CardanoAccount.isOwnAddress(address)`:** whether an address carries the account's stake key, as every address a normal wallet shows does. It drives the own-account warning.
- `signScriptSpend` is reused unchanged.

### 3. Service worker

- **`withdraw.ts`: `WithdrawService` with `send` (sweep) and `remove`**, each a build plus submit on `script-spend.ts`. There's a session key each, and `PendingTx.kind` gains `"withdraw"` and `"remove"`.
- **The destination:** a bech32 address, or `$handle`.
  - A handle resolves with Koios `asset_nft_address` for the ADA Handle policy (`f0ff48bb…`, the same on preprod), trying the plain name, then CIP-68 (`000de140` + name), as the CLI does.
  - A handle held at the wallet contract is refused.
  - The Koios client gains `assetNftAddress`.
- **RPC:**
  - `withdraw-resolve`: `{ to }` → `{ address, handle?, own }`, for the form's feedback.
  - `withdraw-build`: `{ to, lovelace | null, tokens }` → `WithdrawSummary`.
  - `withdraw-submit`.
  - `remove-build`: `{ name, to: "account" | "seedelf" }` → `RemoveSummary`.
  - `remove-submit`.
- Lock clears everything in session storage, as before.

### 4. UI

- **Withdraw**, from the Seedelf card:
  - The destination (address or `$handle`), resolved as it's typed: "Sends to addr_test1…", or the handle's address.
  - A warning when it's your own Cardano account.
  - An amount or Max (`AdaInput` with Max, as in move-in); optional token amounts, which are hidden under Max ("every token goes too").
  - The round-amount nudge, and the *Exit* callout.
- **Withdraw review:** the destination (short, full on hover), the amount and tokens, the fee, the change back to the Seedelf balance, and the UTxOs spent. Under Max: "N UTxOs left for another withdrawal".
- **Remove**, a link on each row of *Your seedelfs*:
  - The seedelf, the ADA locked with it, and "Send what's freed to": Cardano account (the default) or Seedelf balance, each with its note.
  - Then a review of the token burned, what comes back, and the fee, then Send.
  - A line saying payments already sent to the seedelf stay yours; only the name goes.
- **Banners:** "Withdrawal sent…" then "Withdrawal confirmed"; "Seedelf removal sent…" then "Seedelf removed".

### 5. Tests

- **Rust:** item 1's tests, the CLI's offline tests (`sweep`, `remove`), and `seedelf-wasm` native tests for the address and seedelf checks, Max's cap, and `isOwnAddress`.
- **Recorded fixtures:** `record-withdraw.mjs` (an amount and Max to an address) and `record-remove.mjs` (the synthetic owned seedelf `web-wallet`). Both use the 12-word phrase's synthetic UTxOs as `additionalUtxo`, on real preprod Ogmios.
- **Vitest:** the withdraw service over fakes: handle resolution, the own-account flag, refusals, and Send with a stubbed signer.
- **Playwright:**
  - Withdraw: a handle or an address, an amount, review, and Send refused on a forged witness.
  - Remove: the choice, review, and the same refusal.
- **Live:** the user withdraws and removes by hand on preprod. The public 12-word phrase has TAK1, TAK2 and about 15 ₳ in its Seedelf balance.

### 6. Docs

- flows.md *Withdraw*, as built.
- privacy.md:
  - Removal: where the ADA goes, and what it links.
  - The handle lookup tells Koios the handle.
  - The own-account warning.
- architecture.md, the READMEs and `seedelf-platform/CLAUDE.md`: `sweep` and `remove` are extracted, and every CLI script spend is on `ScriptSpend`.
- roadmap.md: tick chunk 10, and add a handoff note.

## Risks and things to check

- **A removal's ADA has to cover the fee and an output.** About 1.75 ₳ less about 0.3 ₳ leaves about 1.45 ₳. That covers an address output (about 1 ₳) and a contract output (about 1.2 ₳), but check both minimums in tests.
- **Max near the budget:** 20 spends are about 1.5M memory and 6.8G steps, under the 16.5M and 10G limits. `MAX_TX_BUDGET` still guards it.
- **Handles on preprod** use the same policy and live in the same Koios endpoint. Test the lookup against a real preprod handle by hand.
- **Never send tokens to a script address:** `is_payable_address` refuses any script part.

## Out of scope

- Removing to an arbitrary address (the CLI keeps `--address`).
- Several destinations per withdrawal.
- The contract round trip's one-time accounts (after v1).
