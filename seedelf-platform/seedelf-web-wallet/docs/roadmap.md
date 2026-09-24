# Roadmap

The wallet is built in **chunks**, each about one working session.

**Each chunk:**

1. Starts on a branch `web-wallet/<topic>` taken from `seedelf-web-wallet`. See [development.md](development.md#branching).
2. Ends with a PR back into `seedelf-web-wallet`.
3. At its end, updates this file: tick the chunk, and write what the next session needs to know under [Handoff notes](#handoff-notes).

**Status:** ✅ done · 🚧 in progress · ⬜ not started

## v1

| # | Chunk | Status | Scope |
|---|---|---|---|
| 1 | WASM foundation | ✅ | Create the `seedelf-web-wallet/wasm` crate (a workspace member). Expose register create, re-randomize, the ownership check and the Schnorr proof. Build with `wasm-bindgen` and smoke-test from JS. |
| 2 | Seedelf key derivation | ✅ | Implement the v1 HKDF spec ([keys-and-accounts.md](keys-and-accounts.md#seedelf-key-derivation)) in `seedelf-crypto` with frozen test vectors. Expose it through WASM and check the vectors from TS. |
| 3 | Cardano keys | ✅ | Phrase → CIP-1852 Cardano account (account `0'`): receive, change and stake addresses, in Rust (`pallas-wallet`). Checked against Lace's library (`@cardano-sdk`). |
| 4 | Extension scaffold | ✅ | Vite + React + TS and an MV3 manifest (preprod). Service worker, popup plus full tab, typed messaging, WASM loaded in the worker, load unpacked. CI for Rust and the extension on PRs. |
| 5 | Vault and lock | ✅ | SecretBox vault, create/restore onboarding (restore has per-word BIP39 autocomplete, like Lace and Eternl), unlock, `chrome.storage.session`, auto-lock, unlock back-off. Plan: [plans/chunk-05-vault-and-lock.md](plans/chunk-05-vault-and-lock.md). |
| 6 | Balance | ✅ | TS Koios client. Contract scan using the ownership check. Cardano account discovery: receive and change chains, gap limit 20. Balances, tokens, list of seedelfs. QR code for the receive address. |
| 7 | Builder extraction + move in | ✅ | Merge `main` first. Gate `seedelf-koios`'s `connect_timeout` for wasm32 (the only thing that stops `seedelf-core` compiling to WASM). Split building from network calls in `seedelf-core`, starting with `external sweep`, and keep the CLI tests green. Then move in, end to end on preprod. |
| 8 | Create a seedelf | ✅ | Stealth mint (`util mint`) with giveme.my collateral. Plan: [plans/chunk-08-create-seedelf.md](plans/chunk-08-create-seedelf.md). |
| 8b | Mint first | ✅ | The first seedelf is paid by the Cardano account (the CLI's `create`, signed in WASM, the account's own collateral), before any move-in. The stealth mint stays as a choice for a Seedelf balance holding received money. See [flows.md](flows.md#create-a-seedelf). |
| 9 | Transfer | ✅ | Seedelf → seedelf (`transfer`). Plan: [plans/chunk-09-transfer.md](plans/chunk-09-transfer.md). |
| 10 | Withdraw | ✅ | `sweep` and `remove`, on `ScriptSpend` and the extension's `script-spend.ts`. Plan: [plans/chunk-10-withdraw.md](plans/chunk-10-withdraw.md). |
| 11a | Style and flow pass | ⬜ | The whole UI, much more like Lace's dark mode (`packages/lib/ui-toolkit/src/design-tokens/theme/dark.ts`): its look, not its brand. Starts with the user's list of CSS and UX fixes. **Plan: [plans/chunk-11-polish.md](plans/chunk-11-polish.md).** |
| 11b | Size and live runs | ⬜ | A smaller WebAssembly module (a size-tuned cargo profile, then `wasm-opt` if it pays). Live preprod runs of every flow from the built extension. The loose ends from chunks 8b–10. Same plan. |
| 11c | Testers | ⬜ | The unlisted Chrome Web Store listing (`VITE_STORE_BUILD=true`): the store build, the listing text, the privacy policy, the screenshots and a release checklist, ready for the user to submit. Same plan. |

## After v1

- Contract round trip: one-time accounts, CIP-30, auto-return ([flows.md](flows.md#contract-round-trip)).
- Turn on the mainnet build flag ([architecture.md](architecture.md#networks)).
- Merge `seedelf-web-wallet` into `main`.

## Handoff notes

Newest first. Keep each entry short: what landed, what's next, and anything surprising.

- **2026-09-24: chunk 11 planned** (after #255 merged; CI green).
  - It's split into three sessions, 11a, 11b and 11c, each with a "Start here": [plans/chunk-11-polish.md](plans/chunk-11-polish.md). The plan is committed on the pushed branch `web-wallet/polish`, which 11a builds on.
  - **Next:** 11a, the style and flow pass. First ask the user for their list of CSS and UX fixes, then confirm 11a's decisions (theme, palette, font, icons, Home's structure).

- **2026-09-24: chunk 10 done** (`web-wallet/withdraw`). Plan: [plans/chunk-10-withdraw.md](plans/chunk-10-withdraw.md).
  - **Decided with the user:**
    - A removed seedelf's ADA goes to the Cardano account by default, or to the Seedelf balance.
    - Withdrawals go to any key address or ADA Handle, with a warning when it's your own account.
    - Max takes up to 20 UTxOs.
  - **Rust (`seedelf-core/src/build.rs`):**
    - `ScriptSpend::change_to(addr)` sends the change to a key address instead of the contract.
    - `sweep`, `sweep_from` and `sweep_all` pay an address; `sweep` picks the token UTxOs first, as transfer does. `remove` burns the one seedelf in a UTxO. `is_payable_address` is the CLI's rule: Shelley, this network, no script part.
    - The CLI's `sweep` and `remove` are thin now. **Every CLI script spend ends in `commands/spend.rs`**, which also shortened `util mint` and `transfer`. Only `create` and `fund` still build inline.
    - `remove`'s offline test now mocks Ogmios with real purposes (`mount_evaluate_mint(1)`); its assertions are unchanged.
  - **WASM:**
    - `draftWithdraw`/`finishWithdraw` (Max takes the 20 largest UTxOs, and `left` says how many stayed) and `draftRemove`/`finishRemove`.
    - `checkWithdrawAddress`, and `CardanoAccount.isOwnAddress`, which checks for the account's staking key in an address.
  - **Extension:**
    - `withdraw.ts` covers resolve, withdraw and remove, on `script-spend.ts`. The Koios client gains `assetNftAddress` for handles (plain, then CIP-68).
    - UI: **Withdraw** next to **Send to a seedelf**, and **Remove** on each seedelf row, whose row is now two lines. `TokenAmounts` is shared with Transfer.
  - **Checked on preprod without spending anything:** `extension/tests/fixtures/record-withdraw.mjs`.
    - All three shapes pass the real scripts under Ogmios. The removal ran both scripts, and the policy accepted the burn of the synthetic seedelf.
    - Fees: 270,270 for an amount with a token (two inputs); 261,734 for Max (two inputs); 242,394 for a removal.
  - **Found in testing:** the fixture's synthetic seedelf holds 1.5 ₳. After the fee, that's below a contract output's minimum, so "back into the Seedelf balance" is refused for it with "Not enough ADA". A real seedelf's 1.74986 ₳ works, and a test checks both.
  - **Tests:** core `mint_test` 24 (4 new); the CLI's offline tests 11; `seedelf-wasm` native 20 and Node 29; Vitest 109 (+1 live); Playwright 18. The withdraw and remove e2e tests stop at Send, as the other Seedelf spends' do.
  - **Not done:** live runs, by hand.
    - The public 12-word phrase's Seedelf balance, read live today after chunk 9, is 17.4 ₳ and 4.82028 ₳ (UTxOs from `9f564d0f…`). It also holds `TAK1` and `TAK2`.
    - Withdraw some to another wallet's address, then remove `TAK1` to the Cardano account, and record both tx hashes here.
    - An ADA Handle lookup against a real preprod handle is still untested.
  - **Next:** chunk 11, polish and testers. See the chunk 11 entry above.

- **2026-09-24: chunk 9 done** (`web-wallet/transfer`). Plan: [plans/chunk-09-transfer.md](plans/chunk-09-transfer.md).
  - **Decided with the user:** the plan's table, except that **paying your own seedelf is allowed, with a warning**. The plan suggested refusing it.
  - **Rust (`seedelf-core/src/build.rs`):**
    - `transfer` and `transfer_from` take `Payment { register, lovelace, tokens }`s. Each output is `deposit_output`, a fresh re-randomization of the register found on chain, checked against its minimum.
    - **Found this chunk: `Register::is_valid` accepts the identity point.** An identity public value is `g^0`, so anyone could take a payment to it. The new `is_payable` also refuses the identity; `transfer` and both mints use it.
    - `select_script_inputs` takes the tokens being sent. The UTxOs holding them come first, with the biggest holdings of each token first, then pure ADA as before.
    - **Changed from the plan:** the "UTxOs don't hold the tokens" error didn't need to count as `NotEnough`. The token UTxOs are picked up front, so only `transfer_from` with given UTxOs can hit that error, and it stays a hard error there.
    - The CLI's `transfer` `run()` is thin. Its offline tests pass unchanged.
  - **WASM:**
    - `draftTransfer` and `finishTransfer`. The recipient checks run here: a whole name, a wallet-contract UTxO holding that seedelf, and a register datum. `toSelf` flags your own seedelf.
    - Mint and transfer share the owned-input check, the seed, the proofs and the draft and finish plumbing. `MintDraft` is now `SpendDraft`, and `TokenOut` is now `TokenAmount`.
    - The module is 2.3 MB (582 KB gzipped).
  - **Extension:**
    - `script-spend.ts` holds the shared flow (read, draft → Ogmios → finish, keep, then giveme.my → sign → submit → pending). `mint.ts` now uses it too, and chunk 10 plugs in.
    - `transfer.ts`, plus the RPCs `transfer-lookup`, `transfer-build` and `transfer-submit`. `PendingTx.kind` gains `"transfer"`.
    - **Added beyond the plan:** `transfer-lookup`, so the form shows "Found: *tag*" (or "No seedelf with that name") as soon as a whole name is pasted, before Review.
    - The lookup is the same whole-contract `credential_utxos` query a balance reading makes. Koios never hears the recipient's token.
    - UI: **Send to a seedelf** on the Seedelf card, then the form, review and Send. The banner says "Transfer sent…", then "Transfer confirmed".
    - **Found in review (the user):** there was no way to copy a seedelf's full name, to give out or paste. Each row in **Your seedelfs** now has a Copy button (`CopyButton`, split out of `CopyField`), and the e2e test copies a name there and pastes it into the form.
    - giveme.my's refusal now says "refresh, then review it again", not "create it again".
  - **Checked on preprod without spending anything:** `extension/tests/fixtures/record-transfer.mjs` drafted 5 ₳ and 1 tUSDM to the live seedelf "This is a test." from the 12-word phrase's synthetic UTxOs. It passes the real wallet script under Ogmios.
    - Each spend is 76,043 memory and 337,845,799 steps.
    - The fee is 273,922 for two inputs, and 233,912 for one input with ADA only.
    - giveme.my refused, as for the synthetic mint.
  - **Tests:** core `mint_test` 20 (5 new: a fresh copy of the recipient's register, budgets on a shuffled answer, part of a token from the UTxOs holding it, several recipients including yourself, and the refusals, among them a real torsion point and the identity); the CLI's offline tests 11; `seedelf-wasm` native 15 and Node 26; Vitest 100 (+1 live); Playwright 16. The transfer e2e test stops at Send, as the stealth mint's does.
  - **Live on preprod (2026-09-24, by the user):** the transfer [`22585835…fc8d9c`](https://preprod.cardanoscan.io/transaction/225858355a5bd56f55bb437330ebf312683dd912f961b211e7b5b23f92fc8d9c), from the public 12-word phrase to one of its own seedelfs (the flagged pay-yourself case). "Everything worked."
    - It spent the phrase's one Seedelf UTxO, chunk 8's 22,994,294 change: 7,654,321 paid, and 15,106,061 back as change.
    - Fee 233,912 for 916 bytes, exactly the one-input figure measured under Ogmios. The collateral return is 4,649,132 (5 ₳ − 3/2 × fee).
    - Checked live afterwards: both new outputs are owned by the phrase, under valid, freshly re-randomized registers.
  - **Next:** chunk 10, withdraw (`sweep` and `remove`). Both are `ScriptSpend`s with other outputs: `sweep` pays an address, and `remove` burns a seedelf (`ScriptSpend::mint` with −1). Write `docs/plans/chunk-10-*.md` first.

- **2026-09-24: chunk 8b done** (`web-wallet/mint-first`).
  - **Why:** the user pointed out that a mint links the seedelf to whatever pays for it. See chunk 8's note, and privacy rule 5.
  - **Rust:** `build::account_mint` / `AccountMint`, which drafts and finalizes like a `ScriptSpend`.
    - Key inputs: pure ADA first, never a 5 ₳ pure UTxO.
    - Change goes to `0/0`.
    - Only the seedelf policy runs, by reference. There are no proofs, no one-time key and no required signers.
    - `change_outputs` now takes its "not enough" error.
  - **Changed from the roadmap row: the collateral is the account's own UTxO, not giveme.my.**
    - That's what the CLI's `create` does, and the transaction names the account anyway.
    - It lets WASM sign at review like a move-in, with no giveme.my at Send.
    - Order of preference: ADA-only, then at least 2 ₳, then not spent, then 5 ₳, then the largest.
    - A token UTxO can be collateral, since the collateral return gives its tokens back. **Found live:** after the user's move-in, every UTxO in the public 12-word account holds tokens.
    - With one UTxO, it's both an input and the collateral.
  - **WASM:** `draftAccountMint` and `finishAccountMint` (signed). Move-in's path checks and per-key signing are now shared helpers.
  - **Extension:**
    - `MintService.build(network, label, from)`; `MintSummary.from`.
    - Create has a "Pay with" choice (Cardano account by default, or Seedelf balance), each with a note on what it links.
    - Home's Cardano card says to create a seedelf before moving in, until one exists.
  - **Checked live without submitting:** an account-paid draft from the public 12-word phrase's real preprod UTxOs passes the real policy under Ogmios. The mint uses 72,836 memory and 21.4M steps; the fee is 212,868 for 999 bytes.
    - `extension/tests/fixtures/record-account-mint.mjs` records it.
    - The fixture keeps no CBOR: a signed transaction over public-phrase UTxOs shouldn't sit in the repo.
  - **Tests:** core `mint_test` 15 (4 new: collateral choice, token collateral, overlap, errors, and fees against the ledger's formula); `seedelf-wasm` native 12 and Node 24; Vitest 91; Playwright 15. The account path runs through Send to "Seedelf created", since no giveme.my signature is needed.
  - **Live on preprod (2026-09-24, by the user):** the account-paid mint [`ca0fac00…ade137`](https://preprod.cardanoscan.io/transaction/ca0fac004c2b59a28cc7065b10225db8acfb2f5ef0c808a09d5ffbcba4ade137), the seedelf `TAK2` (`5eed0e1f54414b32019dda2589…`) with 1.74986 ₳.
    - Fee 212,516 for 990 bytes. One account input; the change, with its tokens, went back to the account.
    - **The collateral held tokens:** a 3 ₳ UTxO with four. The collateral return is 2,681,226 (3 ₳ − 3/2 × fee) with all four tokens, so that path works live.
  - **Next:** chunk 9, transfer. **Its plan is ready: [plans/chunk-09-transfer.md](plans/chunk-09-transfer.md),** committed on the `web-wallet/transfer` branch. Start there.

- **2026-09-24: chunk 8 done** (`web-wallet/create-seedelf`). Plan: [plans/chunk-08-create-seedelf.md](plans/chunk-08-create-seedelf.md).
  - **Decided with the user:**
    - The tag is optional, printable ASCII, at most 15 characters, with a live preview.
    - giveme.my is asked at Send, not at Review.
    - The seedelf gets the user's own re-randomized register, and the wallet picks the UTxOs.
    - The live run is the user's own funded wallet, by hand. The test wallet is still unfunded, so chunk 7's `move-in.mjs` hasn't run.
  - **Rust (`seedelf-core/src/build.rs`):**
    - `ScriptSpend` is the shape every Seedelf spend shares. `draft()` carries placeholder budgets; `finalize(budgets)` puts in Ogmios's and settles an even fee. Transfer, sweep and remove should reuse it.
    - Budgets are matched by purpose and index (`Budgets::from_ogmios`). Ogmios errors become plain words.
    - `mint` and `mint_from`. The CLI's `util mint` `run()` is thin now; its test mocks Ogmios with real purposes (`mount_evaluate_mint`).
    - Smaller changes:
      - `seedelf_token_name` refuses an output index past 255 (the policy takes one byte).
      - `seedelf-koios`'s `evaluate_transaction` passes Ogmios's 400 answer on.
      - `add_witnesses`, `tx_id` and `required_signers` sign and read a transaction kept as CBOR.
  - **WASM:**
    - `draftMint`, `finishMint` and `signScriptSpend`.
    - **Changed from the plan: no stateful builder object.** The one-time key is HKDF of the Seedelf scalar and a random seed, so the seed waits in session storage and Send re-derives the key, even in a worker Chrome restarted after 30 idle seconds.
    - `signScriptSpend` checks giveme.my's signature before adding it.
    - The module is 2.2 MB (545 KB gzipped). An all-era `MultiEraTx` decode cost about 540 KB more, so Conway-only decoding is used.
  - **Extension:**
    - `mint.ts`, `collateral.ts` (giveme.my) and `pending.ts`. The pending watch moved out of `move-in.ts`, and `PendingTx` has a `kind`.
    - Koios has `evaluate`.
    - UI: Create a seedelf (form, review, send), and the banner goes "Seedelf mint sent…" then "Seedelf created".
  - **Checked on preprod without spending anything:**
    - A draft for the 12-word phrase's synthetic UTxOs passes both real scripts under preprod Ogmios (the UTxOs go along as `additionalUtxo`).
    - Measured: a spend is 76,043 memory and 338M steps; the mint is 72,836 memory and 21M steps. A one-input mint costs 0.256 ADA.
    - Our transaction matches a real CLI mint on preprod field for field.
    - giveme.my checks against the chain before it signs, so it refused the synthetic mint ("Transaction Fails Validation"). There's no real giveme.my signature in the tests.
    - Recorders: `extension/tests/fixtures/record-mint.mjs` and `seedelf-core/tests/fixtures/ogmios/`.
  - **Tests:** core `mint_test` 10 (value, minimums, registers, proofs bound to the one-time key, collateral, budgets on a shuffled answer, selection, a draft on a tight balance); `seedelf-wasm` native 10 and Node 23; Vitest 88 (+1 live); Playwright 14; the CLI's offline tests (11) are green.
    - **Coverage gap:** Playwright stops at Send, checking a forged witness is refused and nothing is submitted, because only giveme.my's key signs. Vitest covers Send with a stubbed signer, and Rust signs with a stand-in key.
  - **Fixed after the user's first live mint:** the node refused it with `FeeTooSmallUTxO` (255,788 supplied, 255,801 expected).
    - The cause: `linear_fee` used Pallas's `PolicyParams::default()`, which is Byron's 43.946 lovelace a byte, not the protocol's 44.
    - It now reads `min_fee_a` and `min_fee_b` from the protocol parameters (`ProtocolParameters` gained both).
    - Move-in had the same bug through `settle_fee`.
    - The core tests now check every fee against the ledger's formula written out, and they fail on the old one.
  - **Live on preprod (2026-09-24), both by the user from the public 12-word test phrase's account:**
    - Move-in [`9dda2589…28bc8`](https://preprod.cardanoscan.io/transaction/9dda2589d1029e6d6596a3449b05986e2c489dd81aa65fcf40082eea2c428bc8): five key inputs, 25 ₳ into the contract, change to `0/0`. Fee 186,979 for 718 bytes. This is chunk 7's live move-in.
    - Mint [`939ae7df…aa6ac`](https://preprod.cardanoscan.io/transaction/939ae7df3d6a31255bd6036d05857ea7c6f3cb4d95480813283e9dfca01aa6ac): the seedelf `TAK1` (`5eed0e1f54414b31009dda2589…`) with 1.74986 ₳.
      - Fee 255,846 for 1,107 bytes. The collateral return is 4,616,231 (5 ₳ − 3/2 × fee), and the change is 22,994,294.
      - This is the first transaction with a real giveme.my signature.
    - The live balance scan (`LIVE_KOIOS=1`) finds both. That phrase is public, so anyone can spend them; the live test now checks their shape, not their count.
    - `e2e/live/*.mjs` on the private test wallet still haven't run (it's unfunded).
  - **Privacy correction (the user):** a stealth mint paid by money you moved in yourself links the Cardano account to the seedelf. The live mint spent exactly its move-in's UTxO.
    - The docs, privacy rule 5 and the Create screen's text now say so.
    - The fix is to mint first, then move in: chunk 8b.
    - **The user's rule:** stealth minting only helps when Seedelf money you received pays for the seedelf ("hidden money paying for the hidden seedelf").
    - **An idea for 8b:** the wallet can tell received UTxOs from moved-in ones by the transaction that created them. A received one came from a tx spending contract inputs; a moved-in one came from key inputs.
  - **Next:** chunk 8b, mint first: the account-paid mint, then the Create screen's default, before chunk 9 (transfer).

- **2026-09-23: chunk 7 done** (`web-wallet/move-in`). Plan: [plans/chunk-07-move-in.md](plans/chunk-07-move-in.md).
  - **Decided with the user:**
    - Move-in takes an ADA amount or Max, plus a token picker (a picked token moves in full).
    - After sending, the wallet watches `tx_status` every 15 s, then refreshes.
    - Change goes to `0/0`.
    - The live run is on a fresh test wallet the user funds.
  - **Rust:**
    - `seedelf-core` now compiles to WebAssembly. The only blocker was `seedelf-koios`'s reqwest timeouts, now gated off on wasm32.
    - `seedelf-core/src/build.rs` holds network-free builders:
      - `deposit_outputs`: fresh re-randomized registers, tokens 20 to an output.
      - `settle_fee`: one throwaway signature per signer, repriced until it covers the signed size.
      - `external_sweep`: the CLI command is now a thin `run()` around it, and its offline tests pass unchanged.
      - `move_in`: never spends a 5-ADA pure-ADA UTxO.
    - `ProtocolParameters::from_koios` parses a Koios row. The platform CLAUDE.md's "no `build_*`" rule is reversed.
  - **WASM:** `buildMoveIn` checks each UTxO against its `role/index`, builds, and signs once per payment key. The module is now 1.6 MB (468 KB gzipped); `wasm-opt` is chunk 11.
  - **Extension:**
    - The Koios client gains `epochParams`, `submitTx` (never retried) and `txStatus`.
    - `move-in.ts` builds, holds the signed tx in session storage until **Send**, submits exactly it, and watches it.
    - Lock now clears all of `chrome.storage.session`.
    - UI: Move in (form → review → send) and a pending banner that resumes on reopen.
  - **Fixes from the user's manual testing:**
    - **"Failed to fetch" and nothing else.** A rebuild under a running extension left the old worker asking for a deleted, hash-named WASM file, and the failure was cached. Now the start is retried, "The wallet couldn't start" offers Try again or Reload the extension, and Koios errors are in plain words.
    - **`AdaInput`:** at most 6 decimals (truncated, with a note), nothing above the 45 billion ADA supply, and a note when the amount exceeds the balance. The WASM builder refuses over-supply amounts too.
  - **Tests:** core builder 6; `seedelf-wasm` native 6 (witnesses verify against the tx hash, and the signers are exactly the inputs' keys, on the real recorded preprod UTxOs); Node 21; Vitest 79 + 1 live; Playwright 13; the CLI's offline tests (11) are green.
  - **Not done: the live preprod move-in.** (Done 2026-09-24: see chunk 8's note.)
    - The test wallet in `extension/.preprod-test-wallet.txt` (gitignored) was never funded.
    - The user tried the flow by hand in their own wallet, but no transaction hash was recorded.
    - To finish: fund that wallet, `npm run build`, then `node e2e/live/move-in.mjs 10`. It restores the wallet, moves 10 tADA plus any tokens, waits for confirmation, and prints the result.
  - **Next:**
    - The user plans CSS and UX fixes as part of the Lace style and flow pass (chunk 11). Keep new screens simple until then.
    - Chunk 8, create a seedelf (`util mint`), is the first script spend. **Its plan is ready: [plans/chunk-08-create-seedelf.md](plans/chunk-08-create-seedelf.md).** Start there, and finish chunk 7's live move-in first.
    - A real owned contract UTxO (from a live move-in) would let chunk 8 test on-chain.

- **2026-09-23: chunk 6 done** (`web-wallet/balances`).
  - **Decided with the user:** the receive-address QR code is in (`uqr`, MIT, a port of Nayuki's generator). Balances are read when Home opens, if the last reading is over a minute old, and on Refresh; there's no background polling.
  - **What landed:** `extension/src/background/koios.ts`, `chain.ts` and `balances.ts`, plus the new Home. See [architecture.md](architecture.md#chain-data).
    - One reading is three Koios requests: `credential_utxos` for the contract, and `account_addresses` plus `account_utxos` for the Cardano account's stake key.
    - Ownership runs in WebAssembly inside `wallet.withKeys`, which also writes the session cache, so a lock can't interleave. A reading that finishes after a lock is dropped.
    - The seedelf tag is the leading printable run of the 15-byte window after `5eed0e1f`, slightly stricter than the CLI's filter.
  - **Checked against the real chain:** the recorded preprod fixtures (`extension/tests/fixtures/`) match what `LIVE_KOIOS=1` reads today. The built extension, run against live preprod with no interception, shows the 12-word test phrase's account (10,350.538725 ₳, 4 addresses used) and contacts only `preprod.koios.rest`. The receive QR decodes back to the exact address with `zxing-cpp` and OpenCV.
  - **Tests:** Vitest 64, plus 1 opt-in live test (Koios paging and retries, datum parsing on all 25 real contract UTxOs, the gap limit, bigint sums, seedelf tags, the balance service with the cache and the lock, formatting). Playwright 10: all e2e tests now get Koios from the fixtures with every other host blocked, and 2 are new, for balances and a Koios failure.
  - **Surprises:**
    - The `abandon … art` phrase's stake key has a foreign script UTxO on preprod. Anyone can pair a stake key with their own payment part, so the account's UTxOs count only at derived addresses.
    - Older preprod contract UTxOs carry the shared Seedelf stake key; the current CLI writes none. Querying by payment credential finds both.
    - Real token names carry CIP-68 labels (`0014df10…`), which the UI drops.
    - No phrase wallet owns contract UTxOs yet, so owned-UTxO coverage uses synthetic fixtures (re-randomized registers of the 12-word vector). Chunk 7's move-in makes real ones.
  - **Next:** chunk 7, builder extraction and move-in. It's the biggest chunk, so start by writing `docs/plans/chunk-07-*.md` with a "Start here" list, and merge `main` first.

- **2026-09-23: chunk 5 done** (`web-wallet/vault-lock`).
  - **Decided with the user:** auto-lock after 15 minutes; passwords of at least 12 characters with a strength hint and no composition rules; the receive-address QR code waits for chunk 6 or 11. It's for someone paying from a phone wallet who scans the desktop screen.
  - **Rust / WASM:** `phrase_to_entropy`, `entropy_to_phrase` and `wordlist` in `seedelf-crypto::derivation`. The frozen v1 derivation is untouched.
    - Exported as `phraseToEntropy`, `entropyToPhrase` and `bip39Wordlist`.
    - Added beyond the plan: `SeedelfKey.fromEntropy` and `CardanoAccount.fromEntropy`, so unlock never turns the phrase into a JS string.
  - **Vault:** Lace's SecretBox is in `extension/src/background/secret-box/` (Apache-2.0, license and change list in that folder, no EMIP-003). The entropy is sealed under `seedelf.vault`.
    - Checked against vectors made independently in Python (`argon2-cffi`, `cryptography`): `extension/tests/vectors/secret_box_sbv1.json`.
    - Unlock takes about 190 ms in the service worker, so pure-JS Argon2id stays.
  - **State:** `extension/src/background/wallet.ts`, with the states `no-wallet`, `locked` and `unlocked`.
    - Keys stay in worker memory, and the entropy sits in `chrome.storage.session`.
    - Auto-lock uses `chrome.alarms` plus UI activity pings. The back-off is enforced in the worker and kept in `chrome.storage.local`.
    - Operations run one at a time, so concurrent unlocks can't race the back-off.
    - The worker broadcasts `state-changed`, so every open page follows a lock.
  - **RPC:** the plan's table, plus `validate-phrase`, so restore can show the Rust core's reason before asking for a password. `status` also carries `retryAfterMs`.
  - **UI:** Welcome, Create (reveal → confirm 3 words → password), Restore (per-word boxes, autocomplete, paste fills all), Unlock (countdown, forgot → reset → restore), and a Home placeholder.
    - From the popup, onboarding opens in a full tab.
    - The chunk-4 Wallet core check is gone.
  - **Brand:** the user added the Seedelf logo set; the originals are in `brand/`.
    - The emblem is the extension icon at 16, 32, 48 and 128 px. The wordmark is on Welcome, with a dark-mode variant whose navy lettering is lifted to near-white.
    - The design tokens now use the logo's navy and teal, and the dark theme follows Lace's structure. The full Lace-style pass is still chunk 11.
  - **Tests:**
    - Rust: 5 new derivation tests and 1 new `seedelf-wasm` test. Node: `wasm/tests/entropy.test.mjs`.
    - Vitest (37): SecretBox, the wallet state machine (including restart, browser restart, auto-lock and the back-off), the handlers, and the password rule.
    - Playwright (8): create, restore by paste and by autocomplete, lock and unlock across pages, the back-off, reset, and a browser restart that comes back locked. It also times unlock.
  - **Gotchas:**
    - `chrome.runtime.sendMessage` from one page also reaches other open extension pages. The UI's listener ignores anything that isn't `state-changed` and never replies.
    - A hash-only `page.goto` doesn't remount the app, so open a new page to test `#create` or `#restore`.
  - **Next:** chunk 6, balances. The Koios client and contract scan go in the worker, using the unlocked `SeedelfKey` in `wallet.ts`. The Home screen is the placeholder to replace.

- **2026-09-23: chunk 4 done** (`web-wallet/extension-scaffold`).
  - **What landed:** `extension/`, built with Vite 8 (Rolldown), React 19, TypeScript 7 and an MV3 manifest.
    - The manifest is generated per build: preprod by default, mainnet behind `VITE_ENABLE_MAINNET`, a strict CSP, and a dev `key` that pins the ID to `jfekiogplaamnceifeehipmomhojngcb`.
    - The service worker is an ES module. It loads WASM lazily and answers typed RPC (`src/shared/rpc.ts`) only from the extension's own pages.
    - The UI works as a popup (360 px) or a full tab (`?view=tab`).
    - A temporary "Wallet core check" screen derives a phrase's Cardano account and Seedelf key in the worker.
  - **Tests:**
    - Vitest (9): the manifest, and the handlers with the real WASM against the shared vectors.
    - Playwright (3): loads `dist/` into Chromium, checks the pinned ID and module worker, and checks the popup derives the Lace-matching addresses. It also covers the full tab.
  - **CI:** added `.github/workflows/web-wallet.yml`, which runs on PRs touching `seedelf-platform/`. It covers Rust fmt/clippy/tests, the WASM build and tests, and the extension typecheck, tests, build and end-to-end run.
    - `Cargo.lock` is untracked, so CI resolves dependencies fresh and installs the matching `wasm-bindgen-cli`.
  - **Gotchas:**
    - Vite 8 renamed `rollupOptions` to `rolldownOptions`.
    - Aliases don't apply to `?url` imports, so the WASM binary is imported by relative path.
    - Playwright 1.63 needs its own Chromium: `npx playwright install chromium`.
  - **Next:** chunk 5, the vault and lock. It adds the `storage` permission and replaces the preview screen with create/restore onboarding.
- **2026-09-23: chunk 3 done** (`web-wallet/cardano-keys`).
  - **What landed:** `seedelf-crypto/src/cardano.rs`, `CardanoAccount`.
    - Icarus master key (CIP-3) via `pallas-wallet`, then `m/1852'/1815'/account'/role/index`.
    - Base addresses for receive and change, plus the stake address, on either network.
    - The account xpub.
  - **WASM:** `CardanoAccount` and a `Network` enum. The module is now about 590 KB before `wasm-opt`; shrinking it is a job for chunk 4 or 11.
  - **Verified against Lace's library.** `seedelf-crypto/tests/vectors/cardano_account.json` (12/15/24 words, accounts 0 and 1, preprod and mainnet) matches `@cardano-sdk/key-management` 0.29.13's `InMemoryKeyAgent` on all 80 values.
    - I ran the check with a Node script that loaded the installed SDK from another local project.
    - The Rust and WASM tests read the same file.
  - **Decided this chunk:**
    - "Deposit account" is renamed "Cardano account". For a restored Lace or Yoroi phrase, it is that wallet's account 0.
    - v1 uses account `0'` only, but every function takes the index.
    - The six Cardano-account rules are in [keys-and-accounts.md](keys-and-accounts.md#the-cardano-account). They include: coin selection skips 5 ADA pure-ADA UTxOs (someone's collateral), as the CLI does; and staking is left alone.
    - One-time accounts move to the reserved account `24301'` (`0x5EED`). Account `1'` could be a real Lace account and would link one-time addresses back to the user.
  - **Not done here:** signing (chunk 7) and address discovery (chunk 6).
  - **Next:** chunk 4, the extension scaffold.
- **2026-09-23: chunk 2 done** (`web-wallet/key-derivation`).
  - **What landed:** the v1 derivation, frozen, in `seedelf-crypto/src/derivation.rs`:
    - `parse_phrase`: checksum and case/whitespace normalization, with user-facing errors. New phrases are 24 words; restore accepts 12, 15 or 24, like Lace.
    - `generate_phrase`, `bip39_seed`, `okm_v1`, `scalar_from_okm`, `seedelf_key_v1`.
    - No new crates: `bip39` comes via `pallas-wallet`, and HKDF comes from `cryptoxide`.
  - **Vectors:** nine (12, 15 and 24 words), in `seedelf-crypto/tests/vectors/seedelf_key_v1.json`.
    - Checked against independent implementations: Python `hashlib`/`hmac`, `py_ecc` for the public values, the Trezor BIP39 vector, and the well-known 12-word seed.
    - The Rust tests (`derivation_test.rs`) and the WASM tests (`derivation.test.mjs`) both read them.
  - **WASM:** added `SeedelfKey.fromPhrase(phrase, account)`, `generatePhrase()` and `validatePhrase()`. The module is now about 350 KB, mostly the word list and SHA-512.
  - **Change from the plan:** BIP39 moved into Rust, so `@scure/bip39` is out of the JS stack.
  - **Next:** chunk 3, the phrase → CIP-1852 deposit account.
    - `pallas-wallet` (already in the tree) has an HD module and `bip39`. Check it for Icarus master-key and CIP-1852 derivation before reaching for a JS library.
    - Verify the results against a known wallet's addresses for the same phrase.
- **2026-09-23: chunk 1 done** (`web-wallet/wasm-foundation`).
  - **What landed:** the `seedelf-wasm` crate in `seedelf-web-wallet/wasm/`.
    - `SeedelfKey` keeps the scalar inside WASM.
    - `Register`, `rerandomize`, `isValidRegister`, `registerToDatum`, `verifyProof`.
    - `build.sh` produces an ES module of about 260 KB.
  - **Tests:**
    - Native: `cargo test -p seedelf-wasm`.
    - From JS: `node --test "seedelf-web-wallet/wasm/tests/*.test.mjs"`, run after `build.sh`.
    - Both check the same pinned vector as `seedelf-crypto`.
    - A proof takes about 10 ms.
  - **Things to know:**
    - `wasm-bindgen-cli` must match the crate version (0.2.128 today).
    - `seedelf-platform/Cargo.lock` is gitignored (`*.lock`), so versions can float on a fresh clone. `build.sh` reports what to install.
    - The `seedelf-koios` `connect_timeout` gate moved to chunk 7, where `seedelf-core` first needs WASM.
  - **Next:** chunk 2. Implement the v1 key derivation in `seedelf-crypto`, then add `SeedelfKey.fromPhrase()`.
- **2026-09-23: design done.** The docs in this folder hold every decision.
