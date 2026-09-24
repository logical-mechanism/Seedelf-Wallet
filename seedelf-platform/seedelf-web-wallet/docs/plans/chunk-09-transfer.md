# Chunk 9 plan: transfer (seedelf → seedelf)

**Branch:** `web-wallet/transfer`. It already exists: this plan is its first commit. It ends with a PR back into `seedelf-web-wallet`.

A transfer pays someone's seedelf from the Seedelf balance. It's the CLI's `transfer`, and the second Seedelf script spend after the stealth mint. Most of the machinery exists already:

- `ScriptSpend` does the owned inputs, proofs, one-time key, giveme.my collateral, draft → Ogmios → finalize, and budgets by purpose and index.
- `signScriptSpend` checks giveme.my's signature and signs at Send.
- The mint service's stealth path is the whole draft / evaluate / finish / Send flow.

This chunk is mostly a new kind of output (the recipient's re-randomized register), a lookup, and a screen.

## Start here (new session)

1. Sync the branch:
   ```bash
   git checkout web-wallet/transfer && git pull
   git fetch origin && git merge origin/seedelf-web-wallet   # if it moved since
   git log --oneline HEAD..origin/main                       # merge main first if this lists anything
   ```
2. Read:
   - this plan
   - the chunk 8 and 8b entries in [roadmap.md](../roadmap.md#handoff-notes)
   - [flows.md](../flows.md) *Transfer* and *Create a seedelf*
   - [privacy.md](../privacy.md) *Rules the wallet enforces* and *Known links*
   - [architecture.md](../architecture.md) *Transaction building*
3. Read the code this chunk extracts and copies:
   - `seedelf-cli/src/commands/transfer.rs`: the CLI, still building inline.
   - `seedelf-core/src/build.rs`: `ScriptSpend`, `select_script_inputs`, and `mint` / `mint_from`, which are the template.
   - `seedelf-core/src/utxos.rs`: `find_seedelf_datum` and `find_seedelf_utxo`.
   - `seedelf-web-wallet/wasm/src/lib.rs`: `draft_mint`, `finish_mint`, `sign_script_spend`.
   - `extension/src/background/mint.ts` (`buildStealth`, `submit`) and `extension/src/ui/screens/{CreateSeedelf,MoveIn}.tsx`.
4. If the user has the tx hash of chunk 8b's live account-paid mint, record it in the roadmap first.
5. Confirm the [decisions](#decisions-to-confirm-first) with the user before building the parts they affect.

## What `transfer` does today

`seedelf-cli/src/commands/transfer.rs` (about 500 lines) will become a thin `run()` around a builder.

1. **Arguments:** one or more `--seedelfs` (token names, hex), `--lovelaces` per recipient, optional `--asset` per recipient, and optional `--utxo`s to spend.
2. **Minimums:** each recipient output needs `wallet_minimum_lovelace_with_assets(tokens)`, about 1.46 ADA with no tokens.
3. **The recipient's register:** `find_seedelf_datum(name, policy, every contract UTxO)`, the datum of the UTxO holding that seedelf token, found in the same whole-contract scan the balance uses.
4. **Selection:** `utxos::select(params, owned, total lovelace, total tokens)`.
5. **Outputs:**
   - For each recipient: `register.rerandomize()` (this refuses points outside the prime-order subgroup), at the contract with the lovelace and tokens.
   - Then change under the user's own fresh registers, tokens 20 to an output.
6. **Script plumbing:** as for the stealth mint, but only the wallet script (reference input, and 629 bytes × 15 of fee). There's no mint.
7. **Budgets:** the CLI zips them in answer order (`extract_budgets`), which is exactly what `Budgets::from_ogmios` fixes.
8. **Fee:** the draft's size fee on the old Byron formula, plus compute, plus the script reference, rounded to even. `ScriptSpend::finalize` replaces all of it.

## Decisions to confirm first

| Decision | Suggestion | Notes |
|---|---|---|
| How the recipient is given | **Paste the full token name** (`5eed0e1f…`, 64 hex characters). Show the tag it reads as, and whether it was found on chain. | Tags aren't unique: anyone can mint "alice". A tag search, like the CLI's `util find`, could come later, but it must always show the full name to pick. |
| Recipients per transfer | **One** | The CLI allows several. One keeps the form and review simple, and a second transfer is cheap. |
| What's sent | **An ADA amount** (the move-in `AdaInput` rules: 6 decimals, the supply cap, "more than you have"), **plus optional tokens, each with an amount** | Unlike move-in, a token doesn't move in full: people pay parts of a balance. |
| Paying your own seedelf | **Refuse, and say why** | It moves money in a circle, costs a fee, and could confuse the balance. The worker can tell: the recipient's register `isOwned`. |
| Max | **No Max in v1** | "Everything" is what withdraw (chunk 10) is for. |
| Privacy nudges | **The round-amount nudge from move-in, plus one line**: sending right after moving in is easy to match by timing | See privacy.md *Known links*. |

## Work items

### 1. Core (`seedelf-core/src/build.rs`)

- **`build::transfer(chain, available, payments, change_owner, signer) -> Result<ScriptSpend>`**, next to `mint` and `mint_from`, with a `transfer_from` variant for the CLI's explicit `--utxo`. A payment is `{ register (the recipient's, as found on chain), lovelace, tokens }`.
  - For each payment, refuse lovelace below `wallet_minimum_lovelace_with_assets(tokens)`.
  - **Build the output from `register.rerandomize()?` and nothing else.** Never write the recipient's register as found: re-randomizing is what makes the payment unlinkable, and it's also the torsion check.
  - Add each output with `ScriptSpend::output(output, &tokens)`.
- **Selection with tokens.** `select_script_inputs` sorts pure ADA first. For a transfer, UTxOs holding a token being sent must come first.
  - `ScriptSpend::remainder` now reports "the UTxOs spent don't hold the tokens being sent" as a hard error. **It must count as `NotEnough` (`SEEDELF_SHORT`)**, or selection stops instead of adding the UTxO that holds the token.
  - Give `select_script_inputs` the tokens needed, and sort the UTxOs holding them first. That's the "mandatory" idea from `move_in`.
  - If no amount of inputs holds the tokens, say which token.
- **The CLI's `transfer` `run()` becomes thin.** It looks up each recipient, then calls `build::transfer`, proves, drafts, evaluates, finalizes, and has giveme.my witness it. Keep its CLI shape, several recipients included: `transfer` takes a slice.
  - `seedelf-cli/tests/cli/transfer.rs` must stay green. Its `mount_evaluate(n)` labels every budget `spend`, which is right for a transfer.
- **Tests** (`seedelf-core/tests/`, a `transfer` module in `mint_test.rs` or a new file that reuses its decoder and `ledger_minimum_fee`):
  - Value is conserved, and every output is above its minimum.
  - **The recipient's output is a re-randomization of the recipient's register:** it's owned by the recipient's scalar and not equal to the register found.
  - The change is owned by the payer.
  - The proofs verify against the one-time key, and the budgets are matched on a shuffled answer.
  - The fee meets the ledger's formula with the wallet script only (629 bytes).
  - Selection pulls in the UTxO that holds a requested token.
  - Refusals: an invalid recipient register (e.g. `"00"×48`, and a non-torsion-free point), too little ADA for the recipient's minimum, and tokens the balance doesn't hold.

### 2. WebAssembly

- **`draftTransfer(key, requestJson)` and `finishTransfer(key, requestJson)`**, the same two-step shape as `draftMint` / `finishMint`, with the same one-time key seed.
  - The request: `network`, the `epoch_params` row, the owned spendable `utxos`, `recipient`, `lovelace`, `tokens: [{ policyId, assetName, quantity }]`, then `seed` and `evaluation` for the finish.
  - `recipient` is **the recipient's UTxO row from Koios**.
- **WASM checks the recipient itself:**
  - That UTxO holds exactly one token of the seedelf policy, with the requested name.
  - Its inline datum parses as a `Register` (`extract_bytes_with_logging`) with valid points.
  - The register isn't owned by this key: that's paying yourself.
- Owned-input checks as in `mint_spend`: every input owned, none holding a seedelf.
- `signScriptSpend` is reused unchanged.
- Consider a shared internal helper for "check the owned inputs, derive the one-time key, prove", used by mint and transfer, before chunk 10 adds two more.

### 3. Service worker

- **Share the stealth flow.** `MintService.buildStealth` and its Send path are the flow every Seedelf spend needs:
  - read → draft → evaluate → finish → store the unsigned tx and seed
  - then at Send: giveme.my → `signScriptSpend` → submit → pending
  - Pull that into a small `background/script-spend.ts` (functions, or a base class) that takes the WASM draft and finish calls, and use it from mint and from a new `transfer.ts`. Chunk 10's sweep and remove then just plug in.
- **The lookup:** `credential_utxos` for the whole contract (the query the balance already makes), then pick the UTxO holding `(seedelfPolicyId, name)` locally.
  - **Never ask Koios by the recipient's token** (`asset_utxos` and the like): that tells Koios exactly who is being paid. Note it in privacy.md.
  - Validate the pasted name before any network call: 64 hex characters starting `5eed0e1f`.
  - If it isn't found: "No seedelf with that name on <network>".
- **RPC:**
  - `"transfer-build": { to, lovelace, tokens } → TransferSummary`: the recipient's name and tag, the amount, the tokens, the fee parts, the change, the inputs.
  - `"transfer-submit": { txHash } → PendingTx`.
  - `PendingTx.kind` gains `"transfer"`.
- Lock clears the built transfer, like everything else in session storage.

### 4. UI

- **A "Send" (or "Transfer") button on the Seedelf card.** It's disabled while the Seedelf balance is empty or a transaction is confirming.
- **Form:**
  - The recipient: a paste box, then "Found: <tag> · 5eed0e1f…" or a clear error.
  - The ADA amount (`AdaInput`).
  - Optional tokens from the Seedelf balance, each with an amount (`formatQuantity` / decimals, as in move-in's token list).
  - The round-amount and timing nudges.
- **Review:** the recipient (tag and short name, full name on hover), the amount and tokens, the fee, and the change back to Seedelf → **Send**.
- **Banner:** "Transfer sent. Waiting for the network…", then "Transfer confirmed".
- **Style:** keep it plain and consistent with the other screens; the Lace pass is chunk 11.

### 5. Tests

- **Rust:** item 1's tests; the CLI's offline tests (`transfer` especially); `seedelf-wasm` native tests for the recipient checks, including paying yourself and a recipient UTxO with the wrong token or no register.
- **Recorded fixture:** a `record-transfer.mjs` like `record-mint.mjs`.
  - Draft a transfer from the 12-word phrase's synthetic owned UTxOs (as `additionalUtxo`) to a real preprod seedelf. `TAK1` (`5eed0e1f54414b31009dda2589…`) is owned by that same public phrase, so either pay another phrase's seedelf, or point the recorder at any other live seedelf (`policy_asset_list` for the policy lists them).
  - Evaluate it on preprod Ogmios, and save the answer (and giveme.my's refusal) for the tests.
- **Vitest:** the transfer service over fakes (lookup, refusals, and the build and Send paths with a stubbed signer, as mint.test.ts does), plus the shared script-spend helper.
- **Playwright:** paste a name, see it found, amount, review, Send → a forged giveme.my witness is refused and nothing is submitted, as in the stealth-mint test. A real giveme.my signature only happens live.
- **Live:** the user sends a transfer by hand from a funded Seedelf balance to another seedelf. Record the tx hash.

### 6. Docs

- flows.md *Transfer*, as built.
- privacy.md: the lookup never names the recipient to Koios, and paying yourself is refused.
- architecture.md *Transaction building*: `transfer`, and the shared service flow.
- `seedelf-platform/CLAUDE.md`: `transfer` is extracted.
- The READMEs: the wasm exports and the extension's screens.
- roadmap.md: tick chunk 9, add a handoff note.

## Risks and things to check

- **A malformed recipient register locks the payment for good.** `rerandomize` refuses non-prime-order points. Keep an explicit test for it, and never skip it.
- **The recipient's seedelf can be removed between review and Send.** The payment still reaches their register, so it's spendable by them; only the name is gone. That's acceptable. Don't re-check at Send.
- **Budget:** each spend is about 338M steps, so about 29 inputs fill a transaction. `select_script_inputs` and `MAX_TX_BUDGET` already guard this.
- **Fee:** about 0.24 ADA for one input (the wallet script only). Check it against the ledger's formula in tests, as chunk 8 does.
- **Tokens in change:** 20 to an output, as everywhere.

## Out of scope

- Several recipients in the UI, a tag search, and Max.
- Sweep and remove (chunk 10).
- Telling received Seedelf money from moved-in money (see flows.md *Create a seedelf*, Details).
