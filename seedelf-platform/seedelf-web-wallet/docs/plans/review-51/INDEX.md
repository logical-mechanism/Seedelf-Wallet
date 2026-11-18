# Chunk 51 · Every lane finding, one line each

Made by `tools/index.py` from `data/`. Severity is the finder's; *verified* gives the verifiers' (the lower of trace and impact, or the tiebreak's). A finding merged into another names it. Full text: `lanes/<lane>.md`; verdicts: `verify/<id>.md`.

## R1 (4 findings, 17 guards)

- `r1#1` low (user): The CLI reads the wallet contract with offset paging and no fixed order, so a page can skip or repeat a UTxO `koios.rs:252` · verified **partly, low**
- `r1#2` low (user): CLI submit: a timeout or 5xx after Koios forwarded the transaction reads as failed or rejected, so running the command again can pay twice `koios.rs:559` · verified **confirmed, medium** · merged into r4#4
- `r1#3` nit (nobody): schnorr::prove (exported as verifyProof, never called) panics on a z over 32 bytes, so it doesn't decide as the deployed validator does `schnorr.rs:198`
- `r1#4` nit (nobody): hashing::sha3_256's doc says bad hex hashes an empty array and never fails; it returns an error `hashing.rs:75`

*Coverage:* Read in full, every line: - seedelf-crypto/src: lib.rs, convert.rs, hashing.rs, schnorr.rs, register.rs, derivation.rs, cardano.rs, lovejoin.rs. - seedelf-koios/src: lib.rs, koios.rs (all 1,152 lines). - Both Cargo.toml files and both READMEs.  Tests: - Read: schnorr_test.rs, register_test.rs, proptest_crypto.rs, rows_test.rs, params_test.rs. - Lovejoin_test.rs: read lines 1-126 and the list of test names. - cardano_test.rs and derivation_test.rs: only the test names and their asserts on guards. - hashing_test.rs, convert_test.rs and the vector JSON files: not read beyond their sizes.  Compared against, read only: - The deployed 5b82530 lib/schnorr.ak and validators/wallet.ak. - Aiken stdlib v2.2.0 scalar.new and from_bytearray_big_endian, from a local package copy. - Lovejoin 29573c5 lib/lovejoin/{schnorr,dhtuple,sigma_or,bls,hash}.ak, plus mix_logic.ak's verify call sites and ctx lines…

## R2a (3 findings, 29 guards)

- `r2a#3` medium (stranger): A stranger's many-token UTxO costs several times its ADA once re-made as change 20 tokens an output, and history-aware selection takes it ahead of money that pays without it `build.rs:353` · verified **confirmed, medium**
- `r2a#2` low (stranger): apart ends the search at the first order grown whole that's short, so it refuses payments a subset pays and the CLI's order would make `build.rs:2843` · verified **confirmed, low**
- `r2a#1` low (user): is_payable_address refuses a key-payment address whose stake part is a script, and the screen calls it a script's address `build.rs:3280` · verified **confirmed, low**

*Coverage:* Read in full, line by line: - seedelf-platform/seedelf-core/src/build.rs, all 3,922 lines (identical to web-wallet/1.9.1); - seedelf-core's transaction.rs, utxos.rs, assets.rs, address.rs, data_structures.rs and constants.rs.  Read where build.rs calls them: - staking.rs: the Staking methods none, withdraw, of, drep, is_empty, registers_scripts_alone, signers, deposit, deposit_at, refund, net and patch, plus is_scripts and vote_delegation; - eval.rs lines 1-330: refusal, unreadable_datum, resolve_row, resolve, resolve_outputs, seedelf_references, evaluate_with's resolving; - lovejoin::shuffle; - seedelf-crypto: register.rs's is_valid, rerandomize and is_owned; schnorr.rs's z encoding; - pallas-txbuilder 0.35.1's conway.rs (input sorting, redeemer indexes, output encoding) and pallas-addresses 0.35.1's has_script.  Followed out of build.rs: - WebAssembly lib.rs: move_in (532-583), merged_…

## R2b (4 findings, 28 guards)

- `r2b#1` low (user): A key address whose stake part is a script is refused as "a script's address", though the ledger takes it and only its key can spend it `build.rs:3282` · merged into r2a#1
- `r2b#2` low (user): CLI `fund` says "Not Enough Lovelace/Tokens" when its ADA sits in token UTxOs larger than the one holding the token being sent `utxos.rs:258` · verified **confirmed, low**
- `r2b#3` nit (nobody): A failing certifying script would be labelled "propose": uplc 1.1.23 names a Cert redeemer "Publish", which `ogmios_purpose` doesn't map `eval.rs:378`
- `r2b#4` nit (nobody): `asset_id_to_asset` is dead code that panics on a short or non-ASCII id `assets.rs:367`

*Coverage:* Read in full, every line: transaction.rs, eval.rs, cbor.rs, note.rs, staking.rs, withdraw_zero.rs, utxos.rs, assets.rs, address.rs, constants.rs, data_structures.rs, lib.rs. references.rs: read its structure and the script-ref headers (sizes 629/519); the frozen hex bodies were skimmed, not decoded. Followed values into: build.rs (linear_fee, reference_script_fee, settle, Patches::apply, signed_size, built_with, tx_id, account_payment and build_account_payment, deposit_outputs, change_outputs, minimum_deposit/seedelf/address payments, payment_outputs, is_payable_address/check_payable, ScriptSpend::with_staking, with_account's at_signer, measure_locally, measuring_draft, the head of settle, account_mint, mint_from); lovejoin/mod.rs's mix and withdraw stage and measure loops (the WithdrawZero callers); wasm lib.rs (payable_address, assets_of, picked_of, withdrawing, sign_staking, shared_st…

## R3a (2 findings, 31 guards)

- `r3a#1` high (stranger): A stranger's mix can write the user's box datum as constructor 0's tag-102 form, which the contract accepts and the wallet no longer sees as a box `mod.rs:387` · verified **confirmed, high**
- `r3a#2` nit (nobody): again_affordable divides by zero at depth 0, where its _in sibling guards it; mixes_per_box_at traps on an unchecked width or depth `mod.rs:2177`

*Coverage:* Read in full: seedelf-core/src/lovejoin/mod.rs (2,605 lines), value.rs (131) and box_value.rs (403).\n\nFollowed out of them, read in the relevant parts:\n- build.rs: the fee helpers (30-175), Budget/Budgets/even/collateral_output (1090-1340), change_outputs and minimum_change (417-473)\n- withdraw_zero.rs and eval.rs, whole\n- transaction.rs: collateral_input, computation_fee, calculate_min_required_utxo\n- address.rs: wallet_contract, collateral_address, dummy_base_address\n- pool.rs: ReferenceDatum decode and encode, verify_pool, pool_of, usable/comes_back/measured (120-260, 360-645)\n- seedelf-crypto lovejoin.rs: point_from_bytes, prove_schnorr, prove_sigma_or headers\n- seedelf-koios koios.rs: register_of_datum, InlineDatum, UtxoResponse\n- Pallas 0.35.1 plutus_data.rs: Constr and BoundedBytes decoding\n- Lovejoin 29573c5, in full: mix_logic.ak, mix_box.ak, mixbox.ak, value.ak, refe…

## R3b (1 findings, 30 guards)

- `r3b#1` low (nobody): check_cancels decodes Minswap's swap with no nesting check of its own; it is safe today only because inspect runs check_nesting first `orders.rs:1232` · verified **confirmed, low**

*Coverage:* Read in full: seedelf-core/src/lovejoin/pool.rs (645 lines), launch.rs (796), orders.rs (1518), and templates.rs' code (lines 1-230); its hex constants were skimmed, frozen. orders.json was decoded entry by entry; the V1 scripts' hashes and every referenceSize were recomputed. Followed out of the lane: lovejoin/mod.rs 1-640 (Protocol, Version, mix_box_address, deposit_reference, reference_script_size, PoolBox, Rewards). In the wasm crate: lovejoin.rs protocol_of and PoolView (150-320, 660-700); lib.rs' launch builders (2470-2780), order bindings (640-940), check_spendable (2300-2345) and inspect_session_tx; cip30.rs check_nesting and inspect (575-690, 1139-1150). In the extension: sessions.ts cancel, cancelOf, cancelsChecked, referenceRows and inspect (4150-4440), plainAda and collateralFits, and lovejoin.ts isRetired. Lovejoin 29573c5's one_shot_mint.ak, reference_holder.ak, reference.a…

## R4 (9 findings, 14 guards)

- `r4#1` high (stranger): A stranger freezes any CLI external wallet: `external sweep` (and `external balance`) total every UTxO there, and three junk rows overflow the token sum forever `sweep.rs:40` · verified **confirmed, high**
- `r4#2` medium (stranger): A stranger's three junk UTxOs under the user's register break `balance` for good (and `sweep --all` while they're among its 20) `balance.rs:39` · verified **confirmed, medium**
- `r4#4` medium (user): A submit the CLI can't confirm (30 s timeout, 5xx, unreadable 2xx) is reported as a plain failure, and re-running the command pays again `spend.rs:91` · verified **confirmed, medium**
- `r4#3` low (user): The signing page finds the witness set by searching the tx hex for the first `a105` (or `a0f5f6`) at any nibble, so create/fund/extract fail when their body happens to contain it `index.js:49` · verified **confirmed, low**
- `r4#5` low (user): The signing page has no tie to the run that served it: a still-open tab or an earlier run's server signs the earlier transaction, and nothing shows which Seedelf it pays `web_server.rs:97` · verified **confirmed, low**
- `r4#6` low (site): The signing server answers any Host header, so a DNS-rebinding page can read the unsigned transaction while it runs `web_server.rs:58` · verified **confirmed, low**
- `r4#7` low (user): `util extract` refuses a datum-less UTxO at the contract's staked address form, which the contract lets anyone spend `extract.rs:65` · verified **confirmed, low**
- `r4#8` low (user): `util mint -g -p` writes the given register as the Seedelf's datum unchanged, so Seedelfs minted for one person from their `util base` register are visibly the same person's `mint.rs:76` · verified **confirmed, low**
- `r4#9` nit (nobody): The escaping comment claims serde_json stops angle brackets from injecting HTML; it doesn't (unreachable: every caller passes hex) `web_server.rs:62`

*Coverage:* Read in full: - seedelf-cli/src: main.rs, lib.rs, setup.rs, web_server.rs. - commands/: mod, create, fund, fee, spend, transfer, sweep, remove, balance, welcome. - commands/util/: mod, expose_key, base, statistics, migrate, find, age, history, mint, extract. - commands/external/: mod, balance, sweep. - static/: index.html, index.js. - seedelf-display/src: lib, display, version_control, text_coloring.  Skimmed: static/index.css (searched for external loads: none). favicon.ico is binary.  Followed out of the lane: - seedelf-core, in full: utxos.rs, transaction.rs, address.rs, data_structures.rs, constants.rs. - seedelf-core, in part: assets.rs (Asset/Assets add, merge, parse); build.rs (fee helpers, even, collateral, Budgets::from_ogmios, ScriptSpend::new, proven, draft, estimate and remainder, select_script_inputs, the transfer/sweep/remove/mint/external_sweep builders, is_payable, is_pay…

## W1a (1 findings, 17 guards)

- `w1a#1` low (user): Max in parts never checks the named tokens are held: a quantity above what the spendable UTxOs hold sends a partial Max that leaves the ADA, blaming tokens (or is refused as 'not enough ADA') `lib.rs:4062` · verified **confirmed, low**

*Coverage:* Read in full in seedelf-wasm lib.rs: lines 2880-4975 (TransferRequest through withdraw_result: transfer_plan/spend/result, measured_or_more, withdrawal_of, amounts_of, carried_payment, withdraw_spend, build_withdraw, MAX_PARTS, LeftWhy, without, holds_any, holding_enough, quantity_of, token_group, too_much, Worth, by_history_first, same_order, Room, share_of, less, Fill, fit_part, Owed, in_parts, chained, next_of, reserving, taken, carry_kept, max_in_parts, max_chained, build_transfer_parts, build_withdraw_parts, withdraw_result). Also its helpers (150-250 lovelace_of, assets_of, token_amount; 1537-1546 check_recipients; 1591-1602 Paid; 2080-2440 histories, Carried, classes_mixed, check_spendable, prove/draft/measured, fee_out, out_refs), the bindings that call them (6650-6725) and chain_end_tests (5226-5383). Followed into core: build.rs TooLarge/settle/deposit_outputs/minimum_deposit/N…

## W1b (2 findings, 21 guards)

- `w1b#1` low (user): Send, Make public and Remove refuse any address with a script in it, though the ledger accepts them, including key addresses whose stake part is a script `lib.rs:3266` · merged into r2a#1
- `w1b#2` low (stranger): Removing a Seedelf moves the other tokens in its UTxO, but neither the review nor the Seedelf list shows them `lib.rs:5074` · verified **confirmed, low**

*Coverage:* Read in full, line by line: - seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs lines 1-3300 (orientation types, account flows, staking/DRep, DEX order bindings, session return with plan_return/ReturnPlan/built_or_without_strangers/merged_return/planned_return, histories and classes, mint, launch, account mint, transfer). Also lines 3300-3640 for context, which overlap W1a (WithdrawRequest, withdrawal_of, amounts_of, carried_payment, withdraw_spend, build_withdraw, LeftWhy, holding_enough). - lib.rs lines 4600-6883: the end of build_transfer_parts, build_withdraw_parts, withdraw_result, remove, is_own_address/carries_stake_key, the signing functions, the tests (chain_end_tests, return_plan_tests, dex_order_tests), and every wasm_bindgen export including the Register, SeedelfKey, CardanoAccount and OneTimeAccounts classes and the cip30, decode and lovejoin wrappers.  Skimmed: lib.rs 364…

## W2 (6 findings, 23 guards)

- `w2#1` low (site): A certificate under a script's stake credential counts as another signer, so partialSign=false is refused and the window says others must sign `cip30.rs:1610` · verified **confirmed, low**
- `w2#2` low (site): A key address whose key hash equals the Seedelf contract's script hash is labelled Seedelf Wallet's contract, so a burn shows as a Seedelf payment `cip30.rs:1386` · verified **confirmed, low**
- `w2#3` low (site): Transaction details converts a big number to decimal in quadratic time, so a site's 60 KB bignum freezes the worker for tens of seconds per open `decode.rs:480`
- `w2#4` low (stranger): getUtxos drops a UTxO's reference script, so a site spending it underpays the Conway fee and the node refuses the signed transaction `cip30.rs:287` · verified **confirmed, low**
- `w2#5` low (stranger): getBalance fails for every site once a stranger's token total across the account's UTxOs passes a u64 `cip30.rs:348` · verified **confirmed, low**
- `w2#6` low (site): Byron addresses: a found Byron input fails the whole read, and a Byron payee shows as raw hex `cip30.rs:1191` · verified **confirmed, low**

*Coverage:* Read every line of seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs (2384 lines) and decode.rs (1679 lines).  Followed the values out of them: - wasm/src/lib.rs bindings: inspect/sign for dApps and sessions, attachWitnesses, cip30Utxos, cip30Value, decodeTx, shared_stake_address. - seedelf-core build::tx_id. - Pallas 0.35.1 sources:   - primitives: the conway body (derived map) and PlutusData/BigInt/BoundedBytes decoders.   - codec: CborWrap.   - addresses: as_hash/is_script, to_bech32/from_bech32, Display/FromStr, Byron attributes. - minicbor-derive 0.15.3's map decode, and the preallocation grep across pallas and minicbor. - Extension, read where values cross:   - dapp.ts: resolve, sentOutputs, paysHolder, keptApart, heldForLovejoin, stakeDeposit, readTx, signTx, available, balance, the getBalance dispatch.   - cbor.ts: head, skip, bodyField, bodyOutpoints, certificateKinds, outpo…

## W3 (1 findings, 18 guards)

- `w3#1` low (user): A tile Mix's chain (and Mix my boxes again's) runs at Settings' depth when the runner builds it, not the depth its review showed and its funding paid for `sessions.ts:4667` · verified **confirmed, low**

*Coverage:* Read in full: seedelf-platform/seedelf-web-wallet/wasm/src/lovejoin.rs (all 3,038 lines). Followed into, read in full for the parts used: seedelf-core/src/lovejoin/mod.rs lines 1-2605 (Protocol::of, PoolBox, Coin, Holding, Rewards, deposit_across, mix_with, withdraw_with, the planning functions and reserves, plan_across, bootstrap_most, chain_across, again_at, collateral_tail, collateral_mix, fresh_for, fan_out); lovejoin/value.rs; pool.rs's verify_pool, derived_from and pool_of; eval.rs's refusal, unreadable_datum, resolve_row, resolve_reference and resolve; build.rs's add_witnesses, tx_id and collateral_signature; seedelf-koios InlineDatum, ReferenceScript, UtxoResponse and register_of_datum; seedelf-crypto Register::is_owned; lib.rs's Lovejoin bindings (6060-6445), check_paths, and api's SessionReturnRequest, session_collateral, ReturnPlan, plan_return, built_or_without_strangers, mer…

## E1a (1 findings, 15 guards)

- `e1a#1` medium (stranger): A stranger's deposit under the wallet's register is taken for the wallet's own unmixed box, and Mix my boxes again takes it first, tying the mix session and its private funding to that register `lovejoin.ts:3819` · verified **confirmed, medium**

*Coverage:* Read in full, every line: lovejoin.ts lines 1-4000, lovejoin-pools.ts (all 687 lines) and lovejoin-rewards.ts (122 lines). Calls followed into lovejoin.ts past 4000 and read: 4010-4310 (the rest of acrossOf, tailRows, planAcross, usableNow, takesNewBoxes, adaPool, retiredIds, the start of retireOnce); 4590-4850 (unstale, mixLogicHashes, rewardsIn/readRewards/rewardsOf/rewardsMoved, reserve/unreserve/release/holdOnly/reserving/inTurn, crossCheck); 5450-5730 (schedule, scheduleFound, draw, recordChain, chainSent, chainEnded, restBack, chainMarked); 5884-6510 (cuts, chainsSending/chainsMixing, sortOut, found, made, lookUp, madeBy, inputsOf, accountKeys, keysOf, reservedBoxes, status, chains); 6751-7212 (returning, withdrawDue(Now), unlockDraws, withdrawNow(Now), bringAllBack, stopBringingAllBack); 7466-8048 (split, splitAll, real, ownership, withdrawOne, dropWithdrawing, neverWent, dropRefu…

## E1b (1 findings, 28 guards)

- `e1b#1` low (user): Bring every box back meets a service-wide refusal box by box: a build, an account_info and a giveme.my request for every box, three runs over `lovejoin.ts:7412` · verified **partly, low**

*Coverage:* Read every line: seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts lines 4000-8048, lovejoin-launch.ts (all 460 lines) and lovejoin-rewards.ts (all 122 lines).  Read for context in lovejoin.ts (E1a's half, not reviewed line by line for findings): - the header and constants (1-640); - the types and the sealed schedule (640-1610); - the helpers my half calls (1676-2600: unmixedOf, recorded, knownOf, mixedOf, depositsOf, moreThanDue, unschedule, backOrder, originOf, carriedOf, ripeAt, madeSince, depositAccountOf, moveDue, takeDue, empty, countBack, holderOf, moveOn, squareUp, bootstrapOf, stillIn); - narrower and withinDepth (2600-2811); - the class's fields, readSet, verifiedPool, progress, onChain, watchOf, cantComeBack, listing, poolRows, ours and plan (2811-3410); - acrossOf's head (3899-4000).  Followed out of my paths: - spent.ts reservationOf and reservedSet; s…

## E2a (0 findings, 25 guards)

- none

*Coverage:* Read in full: sessions.ts lines 1-3450, every line, plus connector.ts, collateral.ts and runs.ts in full. I followed the first half's calls into E2b's half and read these in full: stopCost, resume, runAll, settleReturns, markCut, step, act, ordersSpent, placed, ordersOpen, liveOrders, remnantsFrom, order, cancel (3451-4205); bringBack, inspect, review, signAndSend (4324-4495); buildBack through noteLanded and refuseParts (4502-5158), and sendChain's opening checks (5170-5197); sendRecorded and submit (5490-5619); listNow, backWantsCollateral, one, tailHeld, skipCollateralMix and view (5621-5918); and live through serial (5921-6306): freshIndex, stillUnused, fundingRecords, sendFunding, partsStopped, partsMayGo, returning, stillWaiting, outRecord, accounts, book/save/update, atStake, clearMixes, wayOf/pricedClassic/fillsOf (6400-6450). Skimmed or not reached in E2b's half: cancelOf, cance…

## E2b (2 findings, 26 guards)

- `e2b#1` low (stranger): A finished mix's account paid before it closes gets a second chain with the mix's own settings, or the mix is marked "Not mixed" `sessions.ts:1309` · verified **confirmed, low**
- `e2b#2` low (stranger): A finished swap's "Received" shows only its last return, and a later return's skip reason replaces the main return's `sessions.ts:5522` · verified **confirmed, low**

*Coverage:* Read in full: extension/src/background/parts.ts (1-663) and sessions.ts lines 3450-6872: stopCost, resume, runAll, settleReturns, markCut, step, act, noteOrderOpen, waits, ordersSpent, placed, ordersOpen, liveOrders, remnantsFrom, order, cancel, cancelOf, cancelsChecked, referenceRows, bringBack, inspect, review, signAndSend, buildBack, the tail and reserve helpers, collateralWanted, nothingBack, leaveBehind, leftBy, fundingChange, sendBack, noteLanded, refuseParts, sendChain, pump, sendStep, witnessTail, the pending-chain helpers, sendRecorded, submit, listNow, view, the readers, fundingRecords, sendFunding, partsStopped, partsMayGo, returning, stillWaiting, outRecord, accounts, freshIndex, stillUnused, book/save/update, atStake, clearMixes, serial, and every free function after the class. Followed calls into E2a's half, read: sessions.ts 1-1480 (types and helpers: fundingState, short, …

## E3a (4 findings, 20 guards)

- `e3a#1` medium (site): A site on the dApp account can probe another public account's Lovejoin chain: the 'public' reservation isn't per account `dapp.ts:1912` · verified **confirmed, low**
- `e3a#3` medium (site): signData shows a site's message with direction overrides and invisible characters raw, so it can read differently from the bytes signed `dapp.ts:2896` · verified **confirmed, low**
- `e3a#2` low (stranger): The connector takes the first 5 ₳ without tokens as a session's collateral: a stranger's 5 ₳ with a datum hides a spend of the real one `dapp.ts:2777` · verified **confirmed, low**
- `e3a#4` nit (nobody): manifest.ts names the extension with a ternary whose two branches are the same `manifest.ts:59`

*Coverage:* Read in full: src/background/dapp.ts (2949 lines), dapp-window.ts, tx-view.ts, src/content/bridge.ts and page.ts, src/shared/dapp.ts, src/manifest.ts, plus #387's diff to it.  Followed out of them, reading the relevant parts: - sw.ts 330-470 (the dApp port, dappSession, the window/storage/permission listeners). - handlers.ts 330-470 (preferences-set, account-use, network-set, tx-detail, the dapp-* messages). - connector.ts, all of it; ui-port.ts 1-60. - spent.ts: remember/forget, reservedSet, reservationOf. - cbor.ts: head, skip, bodyField, outpoints, certificateKinds, txId. - koios.ts: the error classes and submitTx; data-layer.ts submitTx. - lovejoin.ts: chainOwner/publicOwner/accountOf, reserve, unreserve, release, holdOnly, publicReady, the public mix and Mix again builds, Send's reservation. - sessions.ts: collateralFits, plainAda, accountUtxos, the return's collateral pick. - accou…

## E3b (5 findings, 18 guards)

- `e3b#1` low (site): The sign window shows a site's CIP-8 message and CIP-20 note with direction overrides and invisible characters still active, and the note isn't checked against the body `DappApprovals.tsx:1369` · merged into e3a#3
- `e3b#2` low (user): The connector's private-session form counts locked private UTxOs as available `DappApprovals.tsx:607` · verified **confirmed, low**
- `e3b#3` low (user): While a sent private-session funding waits, every request behind it is hidden: no count, no Decline all, and closing the window declines them unseen `DappApprovals.tsx:626` · verified **confirmed, low**
- `e3b#4` low (user): An approved request's failure stays on screen over the next request, right above its Sign `DappApprovals.tsx:169` · verified **confirmed, low**
- `e3b#5` nit (user): A sent funding's Cardanoscan link follows the wallet to the other network `DappApprovals.tsx:642`

*Coverage:* Read every line of: ui/dapp.ts, ui/sites.ts, ui/screens/DappApprovals.tsx, SiteSessions.tsx, ConnectedSites.tsx, Dapps.tsx. Followed into, read in the parts that matter: - background/dapp.ts: lines 1-1505 in full; signTx, readTx, ties, publicKeys, remember, signData, submitTx, send and helpers (1755-2949) in full; 1520-1700 (view, read, available, balance) skimmed. - wasm/src/cip30.rs: Amount and difference (110-290), keys_of and own_address (436-520), output_parts and register_datum (960-1066), released_from_contracts and inspect (1100-1892), anchor_url and is_bidi, sign_tx, CIP-8 data_key, data_signer and sign_data (2185-2400). - wasm/src/lib.rs: the session and dApp tx and data bindings. - wasm/src/decode.rs: shown, hidden and metadata_hash_matches. - background/sessions.ts: siteOutBuild, siteOutSubmit, topUpBuild, topUpSubmit, backBuild, backSubmit, claimBuild, disconnect, view() sta…

## E4a (1 findings, 9 guards)

- `e4a#1` low (user): A balance reading begun before Remove wallet finishes under the next phrase's wallet: it's shared with the new wallet's Home, kept as its reading, and its private UTxOs are sealed into the new wallet's history `balances.ts:392` · verified **confirmed, low**

*Coverage:* Read in full: background/{vault,private-store,storage,storage-access,wallet,accounts,account,preferences,wasm}.ts; background/secret-box/ (README, index, kdf, format, seal, open); shared/{password,preferences,fingerprint}.ts; ui/screens/{Create,Restore,Unlock,Settings}.tsx (all 1,721 lines of Settings); ui/delete-phrase.ts. I followed the values out of them into: handlers.ts lines 1-330 plus atStake and status; sw.ts in full; ui-port.ts; ui/background.ts; App.tsx lines 1-200; components PhraseGrid, PhraseInput, SetPassword and PasswordField; history.ts (head); the sealed maybe-sent helpers and adoptKept in pending.ts; keepOnReset, adoptKept and keptMaybe in lovejoin.ts; reset, book and save in sessions.ts; contract-scan.ts readContractView, readKoiosView and readIndexView; balances.ts get, reading, shared, read and readPrivate; activity.ts arrived, update and cardano; staking.ts readStak…

## E4b (2 findings, 12 guards)

- `e4b#1` low (site): A site can keep the wallet from auto-locking: each connector window it opens counts as user activity when it mounts `App.tsx:94` · verified **confirmed, low**
- `e4b#2` low (nobody): `dapp-approvals` answers while locked, with a waiting signature's summary and its ties to the wallet's other accounts and sessions `handlers.ts:433` · verified **confirmed, low**

*Coverage:* Read in full, every line: shared/rpc.ts (3,323), background/sw.ts (459), background/handlers.ts (655), background/ui-port.ts (69). Also read in full: background/wallet.ts, accounts.ts, runs.ts, storage-access.ts, connector.ts, dapp-window.ts, wasm.ts, content/bridge.ts, content/page.ts, shared/dapp.ts, src/manifest.ts, ui/background.ts, ui/view.ts, shared/open-in.ts, and the built dist/manifest.json (read only). Read in part, where my files call them: dapp.ts (call/run, enable, ask, answer, approvals, stateChanged, closeWindow, windowClosed, networkChanged, dappAccountChanged, connectorOff, gone, sites, forget, disconnectSession, answerSite, failed, notSent, DappError), parts.ts (waitingOn, pumpParts, PartsService), preferences.ts (NetworkChoice, PreferencesService), tx-view.ts (txView), lovejoin.ts (poolChoice, poolNamed, fits, funding's head, publicBuild's head, withdrawDue, publicMayb…

## E5 (2 findings, 30 guards)

- `e5#1` low (user): Send, Make public and Contacts refuse an address with a key payment part and a script stake part, and every Byron address, in words that misdescribe them `destination.ts:97` · verified **partly, low** · merged into r2a#1
- `e5#2` low (user): A Make public to another of the user's own accounts reads the active account again as it lands, the timing link privacy review §2.9 removed `pending.ts:165` · verified **confirmed, low**

*Coverage:* Read in full, every line: background/send.ts, transfer.ts, move-in.ts, mint.ts, withdraw.ts, script-spend.ts, destination.ts, coin-control.ts, pending.ts, spent.ts, sent-txs.ts, short.ts, cbor.ts, and shared/recipients.ts, handles.ts, seedelf-name.ts, histories.ts, label.ts. Also read in full: background/account.ts and feed.ts. Followed values into: handlers.ts dispatch (150-240); koios.ts submitTx and its error classes (600-680, 1175-1290); contract-scan.ts' sealed record (170-260, 340-370); balances.ts reading choice (195-240); parts.ts reviewParts, sendParts and the splitParts header; sessions.ts' use of whole() (3080-3110); dapp.ts submit and keepSent (2560-2680); accounts.ts WIPED_ON_SWITCH. In wasm/src/lib.rs: SendRequest/account_send, recipient_register, transfer_plan's head, build_transfer_parts, build_withdraw_parts' head, carry_kept, max_in_parts, max_chained, withdraw_result, …

## E6 (2 findings, 15 guards)

- `e6#1` medium (stranger): A stranger can plant a Seedelf so Remove preselects the public account and says it 'links nothing new' `minted-by.ts:124` · verified **confirmed, medium**
- `e6#2` low (user): A balance reading that spans Remove wallet plus a restore is kept as the new wallet's and uses up its first-reading mark `balances.ts:392` · merged into e4a#1

*Coverage:* Read every line of the lane's 13 files (5,767 lines): koios.ts, data-layer.ts, chain.ts, balances.ts, activity.ts, feed.ts, incoming.ts, private-index.ts, contract-scan.ts, minted-by.ts, nft-image.ts, prices.ts, contacts.ts.  Read the parts that matter in the code they call or feed: - seedelf-crypto register.rs (is_owned, is_valid, rerandomize) and blstrs 0.7.1 G1Affine::from_compressed - seedelf-koios register_of_datum and point_bytes - the deployed seedelf.ak at 5b82530 - wallet.ts: Keys, withKeys, withAccount, load/derive on account switch, open - accounts.ts WIPED_ON_SWITCH; account.ts readAccountUtxos and readAccount - handlers.ts: create/restore/reset-wallet - sessions.ts scanNow's pin - RemoveSeedelf.tsx's default and notes, with their en.json strings - NftImage.tsx's rendering; ui/format.ts formatQuantity - governance.ts ownDrepId; lovejoin.ts mixBoxes; staking.ts delegationHisto…

## E7a (4 findings, 20 guards)

- `e7a#1` medium (user): A token picked while the swap's review builds is named on the approval, beside the other token's quote, and Start swap runs the swap that was built `Swaps.tsx:926` · verified **confirmed, low**
- `e7a#2` low (user): Stop's dialog says the swap comes back directly, less the return's fee, until its cost is read or when the read fails, and Stop then brings it back through Lovejoin as approved `Swaps.tsx:2451` · verified **partly, low**
- `e7a#3` low (user): A swap funded in parts pauses as 'it spends something that isn't this session's' when Minswap's build spends a part Koios doesn't list yet `sessions.ts:4377` · verified **confirmed, low**
- `e7a#4` nit (user): A swap held by its wait after an unlock says it's asking Minswap now `Swaps.tsx:3288`

*Coverage:* Read in full, every line: background/minswap.ts (630), ui/swap.ts (270), ui/screens/Swaps.tsx (3450).  Followed out of them into background/sessions.ts: - 180-1100: constants, AutoRecord, Refused/PriceMoved, checkAsk, slippageKeeping, quotesTheAsk, routeOf, quoteOf, tailUnpaid/keepsReserve, collateralFits, plainAda, fundingOf/fundingState. - 1480-2025: tokens, quote, lovejoinCost, tokenPool/tokenAt read for the values the approval shows, priced skimmed, verified, outBuild. - 3105-3300: outSubmit, swapBuild, orders, cancelBuild, txSubmit. - 3390-3540: advance, stop, stopCost, resume. - 3636-4135: step, act, waits, ordersSpent, placed, liveOrders. - 4135-4495: order, cancel, cancelOf, cancelsChecked, referenceRows, inspect, review, signAndSend. - Also: 4897 throughLovejoin, 5490-5600 sendRecorded, 5825-5920 view, 5936-5960 listing, 6420-6872 autoView, outcomeOf, withinFunding, dexOrderAt, …

## E7b (4 findings, 18 guards)

- `e7b#1` low (user): Delegating again to the pool or DRep Koios names is refused, though the ledger takes it `staking.ts:539` · verified **confirmed, low**
- `e7b#2` low (user): A DRep profile's address is refused unless it starts http(s):// or ipfs://, though the ledger takes any address up to 128 bytes `Governance.tsx:165` · verified **confirmed, low**
- `e7b#3` nit (nobody): KoiosProposal.expiration's doc says the opposite of how governance.ts reads it `koios.ts:289`
- `e7b#4` nit (user): Voting's "Inactive since epoch E" and the DRep card's "Active until the end of epoch E" read the same field an epoch apart `Voting.tsx:477`

*Coverage:* Read in full, every line: background/staking.ts (574), background/governance.ts (213), ui/screens/Staking.tsx (1109), Governance.tsx (1047), Voting.tsx (502), Delegations.tsx (198), Rewards.tsx (177), Pools.tsx (420), ui/dreps.ts (47). Followed the values out of them, read in full or the relevant ranges: seedelf-core/src/staking.rs (all 671); seedelf-core/src/build.rs settle_fee/settle/signed_size/Patches/expiring (100-340) and account_staking/account_payment/build_account_payment (780-1072); wasm/src/lib.rs lovelace_of, check_paths, sign_with_paths, withdrawing, stake_key, sign_staking, drep_key, drep_of, drep_profile (180-210, 295-520), and StakingRequest/StakingAction/StakeStateIn/DrepStateIn/StakingResult/pool_id/drep_id/stake/drep_transaction (1700-2080); seedelf-koios ProtocolParameters and from_koios (880-1090); extension background/account.ts (all), script-spend.ts ScriptSpendDep…

## E8a (3 findings, 15 guards)

- `e8a#1` low (user): A mix from the private balance, and Mix my boxes again, build their chain at Settings' depth and wait when the runner builds it, not the reviewed ones `sessions.ts:4667` · merged into w3#1
- `e8a#3` low (user): Pay from my private balance anyway warns of a tie to 'your public account' when the boxes it takes are another account's `Lovejoin.tsx:3649` · verified **confirmed, low**
- `e8a#2` nit (user): A public account's stopped chain on the hub says 'Mix my boxes again mixes the boxes it didn't', and doesn't name which account `Lovejoin.tsx:973`

*Coverage:* Read every line of ui/screens/Lovejoin.tsx (4,125), ui/screens/LovejoinLaunch.tsx (460), ui/components/LovejoinReturn.tsx (578) and ui/components/BringAllBack.tsx (471). Followed the values out: handlers.ts' Lovejoin dispatch; rpc.ts's Lovejoin and session types; ui/lovejoin-pools.ts, ui/swap.ts' estimates and ReviewTotals.tsx in full; lovejoin-launch.ts in full. In lovejoin.ts: funding, plan, fits, room, againBoxes, the mix bounds and constants, widthFor/wayOver/againWay, status, part of sortOut, withdrawDueNow, withdrawNowNow, bringAllBack and part of bringAllBackNow, stopBringingAllBack, progress, rows/shown, chain() and its countAt, hatchOrder, cantComeBack. In sessions.ts: mixOutBuild, againBuild, mixFunding, mixOutSubmit, buildFunding, tailReserve, orWithoutReserve, collateralIntoPool, buildBack's chain call and delay, mixingAgain, resume, fundingState and the view's stage, wayOf. …

## E8b (6 findings, 19 guards)

- `e8b#1` low (stranger): A stranger's 5 ₳ carrying a reference script or an unreadable datum becomes the public account's collateral, public Lovejoin mixes then fail, and the Collateral page can only pick it again `coin-control.ts:184` · verified **confirmed, low**
- `e8b#2` low (user): The collateral payment's review doesn't show that it withdraws all the account's staking rewards `Collateral.tsx:194` · verified **confirmed, low**
- `e8b#3` low (user): Bring everything back: a session left out while the switch rebuilds is chosen again when the rebuild lands `ClaimAll.tsx:111` · verified **confirmed, low**
- `e8b#4` nit (user): Bring everything back's total counts a token once per session, not once per kind `ClaimAll.tsx:259`
- `e8b#5` nit (user): Make private keeps a refusal on the form after the amount changes and after Back from its review, and Collateral keeps the review's error after Back `MoveIn.tsx:105`
- `e8b#6` nit (user): A token picked from its details but not spendable (all in locked UTxOs) is dropped silently, and Review waits with no reason `Recipients.tsx:167` · merged into e9a#1

*Coverage:* Read in full: ClaimAll.tsx, Transfer.tsx, Withdraw.tsx, MoveIn.tsx, CreateSeedelf.tsx, RemoveSeedelf.tsx, Collateral.tsx. Followed into the worker, read in full: transfer.ts, withdraw.ts, move-in.ts, mint.ts, send.ts, script-spend.ts, coin-control.ts. Followed in part: sessions.ts (claimBuild/claimBuildNow/claimSubmit, backBuild/backSubmit, buildBack in full, sendBack, pendingChain, collateralFits, tailReserve); parts.ts (reviewParts, sendParts head); pending.ts (refuseSent, settleMaybeSent); account.ts (readAccount, readAccountUtxos); lovejoin.ts (LovejoinChain type, the public mix build's collateral); handlers.ts dispatch. WebAssembly and core, read in part: lib.rs (build_transfer_parts, build_withdraw_parts head, transfer plan/spend/result, carry_kept, max_in_parts, max_chained, remove, MoveInResult/move_in, SendRequest/SendResult/account_send); wasm lovejoin.rs (the public mix's coll…

## E9a (6 findings, 16 guards)

- `e9a#1` low (user): A token's details offer Send or Make private/public for a token with no spendable units, and the form silently drops it, with Review greyed and no reason `Home.tsx:572` · verified **confirmed, low**
- `e9a#2` low (user): Transaction details show an unlisted token in raw units, while the review above them and Home scale it by Koios's decimals `TxDetail.tsx:351` · verified **confirmed, low**
- `e9a#3` low (stranger): UTxO details call any address under payment key 0/0 'Your receive address, the one Receive shows', whatever its stake part `Utxos.tsx:411` · verified **confirmed, low**
- `e9a#4` low (user): Public activity's Save as CSV note says the file holds nothing the chain doesn't, but its rows name the user's own Make private and Make public `Activity.tsx:126` · verified **confirmed, low**
- `e9a#5` nit (user): Private activity's CSV includes a private payment still marked Pending, against exported()'s own promise `Activity.tsx:305`
- `e9a#6` nit (user): Activity's details label a private session's funding or return, and a box back from Lovejoin, as 'Seedelf' `Activity.tsx:428`

*Coverage:* Read in full, every line: screens/{Activity,CardanoSend,Home,Onboarding,Receive,Tokens,Utxos}.tsx and components/{TxDetail,PendingBanner,TxBanner,ReviewRows,ReviewTotals,PaidRows,Recipients,AccountRecipients,Destination,TokenAmounts,TokenList,AmountField,AdaInput,HandleWarning,StakedWarning,HistoriesNote,LeftOut,SessionLeft,SessionRefused,StaleReview,SendButton}.tsx (7,054 lines). Followed, reading the parts that matter: ui/format.ts (formatQuantity, parseQuantity, sanitizeAmount, unlocked, withRewards, spentRewards, formatFiat), ui/tokens.ts (all), ui/activity.ts (all), ui/accounts.tsx, ui/background.ts call, preferences useAmounts, ExplorerLink, QrCode, RefreshRow; the MoveIn/Withdraw/Transfer review token rows; background/send.ts (all), destination.ts (all), activity.ts (sent, withDecimals, cardano, describe, matcher), incoming.ts (incomingOf, summed), balances.ts (get, reading, seede…

## E9b (3 findings, 13 guards)

- `e9b#1` low (stranger): Greek capitals Ν Μ Η Υ, and Cherokee or Lisu letters, slip past the check for tokens named like ADA or a listed token `format.ts:80` · verified **confirmed, low**
- `e9b#2` low (nobody): Anti-impersonation warnings in warning colour are left out of the accuracy-critical translation set `i18n-critical.mjs:84` · verified **confirmed, low**
- `e9b#3` nit (nobody): PlutusTree's Copy JSON isn't the detailed schema cardano-cli reads: ints are strings, and an unknown tag's constructor is null `PlutusTree.tsx:167`

*Coverage:* Read in full: ui/format.ts, tokens.ts, App.tsx, view.ts, history.ts, activity.ts, background.ts, accounts.tsx, preferences.tsx, lovejoin-pools.ts, nft-images.ts, network.ts, sentence.ts and main.tsx; shared/open-in.ts; i18n/core.ts, index.tsx, i18next.d.ts and translations/index.ts. Also read in full every component not listed for E8a or E9a: MiddleEllipsis, PhraseGrid, PoolAvatar, ActionButton, CopyButton, Callout, NetworkBadge, CopyField, QrCode, GivemeNote, BuildStage, Choice, PasswordField, RefreshRow, Tabs, Clearable, Modal, AccountPicker, RadioCards, ExplorerLink, Splash, NetworkPicker, SetPassword, Hint, LockCountdown, NftImage, Contacts, PlutusTree, PhraseInput and Screen. Icons.tsx was skimmed (static SVG paths only).  Translations: read all 485 critical bases in en, es and ja (the _other or base form, plus every es _one). Mechanical scans with python over all 3,195 keys compare…

## B1 (5 findings, 9 guards)

- `b1#1` low (user): The store zip's third-party notices sort in the builder's locale, so the same commit gives another zip in cs, sk, et, lt and lv `third-party.mjs:225` · verified **confirmed, low**
- `b1#2` low (user): build.sh never checks or records which Rust built the module, and the second build shares the first's shell, so the record's "same toolchain" can be false `build.sh:61` · verified **partly, low**
- `b1#3` low (nobody): release.yml's CLI build jobs hold the GPG release key, its passphrase and a write token beside every crate's build code `release.yml:24` · verified **confirmed, low**
- `b1#4` low (nobody): The Windows release job prints the armored GPG secret key into the public Actions log `release.yml:108`
- `b1#5` low (nobody): Every workflow pins its third-party actions by tag or branch, never by commit, in the jobs that sign the CLI and build the data layer's binary too `release.yml:18` · verified **confirmed, low**

*Coverage:* Read every line of these files: .github/workflows/web-wallet.yml, release.yml, continuous-integration.yml, data-layer.yml and data-layer-deploy.yml; wasm/build.sh; extension/scripts/package.mjs, third-party.mjs (+.d.mts), tokens.mjs, dreps.mjs, lovejoin-registry.mjs (+.d.mts), i18n-critical.mjs (all 1,327 lines, read for gaps rather than traced key by key) and i18n-critical.d.mts; extension/vite.config.ts, package.json, playwright.config.ts, tsconfig.json and index.html; seedelf-platform/Cargo.toml, rust-toolchain.toml and wasm/Cargo.toml; the .gitignore files in extension/, wasm/ and seedelf-platform/; development.md's release sections in full, plus releases.md and release-records.md' headers; SECURITY.md and RELEASE.md.  Followed out of those paths: src/manifest.ts, networks.ts, env.d.ts, the content scripts' imports, data-layer.ts's DEV path, sw.ts's and App.tsx's uses of the defines,…

## D1 (7 findings, 8 guards)

- `d1#1` low (site): The privacy policy and privacy.md say the CIP-30 entry goes only on https pages, but it also goes on every http://localhost and http://127.0.0.1 page, at any port `privacy-policy.md:79`
- `d1#2` low (user): privacy.md says every open session's account is read together only from the Swaps screen; the dApps page does it every time it opens, and the policy never says so `privacy.md:369`
- `d1#3` low (site): A site's payment into the Seedelf contract under a register-shaped datum that can't be spent is shown as 'without a register: anyone can take', when no one can ever take it `privacy.md:336`
- `d1#4` nit (nobody): The root README's collateral rule has an exception it doesn't name: a session's 5 ₳ collateral mix spends the session's account under giveme.my's collateral `README.md:276`
- `d1#5` nit (user): privacy.md says the recovery phrase can't be copied, but once revealed it's ordinary selectable text `privacy.md:276`
- `d1#6` nit (stranger): The root README's troll attack says Bob pays more to spend the UTxO; Seedelf Wallet can't spend it at all `README.md:187`
- `d1#7` nit (user): The privacy policy's ADA Handle row covers only a withdrawal, but a public Send to a $handle asks the server too `privacy-policy.md:19`

*Coverage:* Read every line of seedelf-platform/seedelf-web-wallet/README.md, docs/privacy.md (502 lines), docs/keys-and-accounts.md, docs/store/privacy-policy.md, SECURITY.md and the root README.md. Read docs/architecture.md lines 1-783. The densest Lovejoin paragraphs (681, 739-757) and the swap-runner paragraphs (642-674) were read through, but only their figures, constants and privacy statements were checked against code, not every behavioural clause. The UI component inventory (477-497) and Lace's table were skimmed. Checked against code: every fetch site, the manifest builder and the built dist/manifest.json, networks.ts, preferences defaults, the reset and wipe paths and every local storage write, private-store padding and kept records, the vault and secret-box KDF, the password and back-off, destination and own-address matching, NFT image ordering, every Ogmios evaluate caller, koiosAlone, t…

## V1 (0 findings, 7 guards)

- none

*Coverage:* I read all of definitions.lean (lines 1-113) and all of wallet.ak, seedelf.ak, schnorr.ak (types, fiat_shamir_heuristic, prove), token_name.ak (seedelf, generate), logic.ak, always_false.ak and aiken.toml. From stdlib v2.2.0: list.has, assets.flatten, dict.foldr, bytearray take/slice/push/concat, scalar new/from_bytearray_big_endian/field_prime, g1 decompress/scale/add/equal, crypto.blake2b_224, and the Transaction and ScriptContext types. From the Lean libraries: ByteString (structure, the Coe from String with no UTF-8, cons, append, slice, consByteStringV2), byteStringToInteger and its Opaque alias, the G1 builtins and the uncompress model, blake2b_224, the encodings of V3 ScriptContext, ScriptInfo, TxInfo, TxInInfo, TxOutRef and TxId, the Option, ByteString and Integer IsData instances, the signatories list, Value and MintValue, and the V2 Datum and Redeemer aliases. I decoded the thr…

## V2 (2 findings, 3 guards)

- `v2#1` nit (nobody): ownerContext's docstring reads as serialising each input reference separately; the source serialises the list once `definitions.lean:445`
- `v2#2` nit (nobody): ReadableLaunch's module doc reads as if the output search also requires an inline ReferenceDatum `definitions.lean:759`

*Coverage:* I compared every clause of mix_logic.ak (withdraw, publish, else, validate_owner, validate_mix, walk_outputs, collect_well_formed_mix_inputs, pairs_match_and_all), one_shot_mint.ak (mint, token_sane, else) and mix_box.ak (spend, else). That includes the helpers they call in reference.ak, mixbox.ak, value.ak, schnorr.ak, sigma_or.ak, hash.ak and bls.ak, and the stdlib v4.0.0 code behind them: list filter, filter_map, find, any, foldl, reverse, length and map; dict get_or_else, do_get, insert_with, singleton and to_pairs; assets from_asset, from_lovelace, add, quantity_of and tokens; bytearray concat, length and from_int_big_endian; scalar and bitwise from_int; g1 scale, add and equal; pairs.has_key; and the Transaction, Output, Datum, Address, Credential, Certificate and ScriptInfo types. I compared them against every definition in definitions.lean (lines 50-150, 299-458, 528-742, 783-805…

## V3 (3 findings, 4 guards)

- `v3#1` low (nobody): tally.py and Audit/count.py report a module ok from its last good build's trace after its rebuild fails `tally.py:68` · verified **confirmed, low**
- `v3#2` low (nobody): CI skips the proven-bytes test on a PR that changes only the proven .hex files it reads `web-wallet.yml:67` · verified **known, low**
- `v3#3` nit (nobody): tally.py's docstring says check.sh's ok can't tell Valid from Undetermined, but since #372 check.sh can `tally.py:10`

*Coverage:* Read in full: extract.sh, extract-lovejoin.sh, extract-lovejoin-v2.sh, the five Scripts.lean modules (Seedelf, Lovejoin, Lovejoin/V2, Lovejoin/Template, Slice/Slice), lakefile.lean, lake-manifest.json, lean-toolchain, Slice/lakefile.lean, Slice/lake-manifest.json, Slice/modules.txt, check.sh, tally.py, Audit/count.py, Audit/run-all.sh, and all nine gen-*.py. I also ran the nine generators in a scratch copy and diffed their output against the tree. The 13 .hex files were not read by eye: each was hashed and compared by script against 5b82530's contracts, references.rs, constants.rs, templates.rs (both sets), Lovejoin c1239fb's artifacts and lovejoin-pools.json. Followed out of my paths:\n- lovejoin_proven_bytes_test.rs (in full);\n- templates.rs (its code in full, its hex by script);\n- Protocol::of in lovejoin/mod.rs;\n- verify_pool's entry in pool.rs;\n- the frozen-template tests in lov…

## V4a (2 findings, 8 guards)

- `v4a#1` low (nobody): The wallet's every-transaction Blaster families have no Falsified control: 307 Valid theorems with nothing that would flag a vacuous Valid `WalletAnyTx.lean:43` · verified **partly, low**
- `v4a#2` nit (nobody): PolicyLinesAnyTx's header says mints of six lines or more 'aren't proved', though PolicyLinesAll proves every length in the kernel `PolicyLinesAnyTx.lean:22`

*Coverage:* **Read in full:** - Every top-level module in seedelf-verification/Seedelf/ (39 files): the root Seedelf.lean, Scripts, Scenario, Steps, Wallet, Policy, AlwaysFalse, WalletPurpose, WalletNoLock, WalletRegister, PolicyAmount, PolicyForeign, PolicyBurn, PolicyMint, AnyTx, AnyTxCover, AnyTxSteps, AlwaysFalseAnyTx, WalletPurposeAnyTx, WalletNoLockAnyTx, WalletRedeemerAnyTx, WalletAnyTx, WalletAnyTxTwo, WalletAnyTxThree, AnyTxShapes, PolicyAnyTx, PolicyAnyTxSteps, PolicyPurposeAnyTx, PolicyRedeemerAnyTx, PolicyLinesAnyTx, PolicyLinesFourAnyTx, LinesAllCek, LinesAllLoops, PolicyLinesAll, LinesAllAnyMint, PolicyShapes and Signers.lean. In PolicyLinesFiveAnyTx I read the header, guards, theorems and control by eye; its builders and examples were checked by script. - In Signers/: Keys.lean and Control128.lean in full; Signers4, 5, 9 and 128 by eye; all 125 by script, plus a regeneration diff. - I…

## V4b (2 findings, 11 guards)

- `v4b#1` low (nobody): AnyTx's output, reference and launch failure families have no passing control on their own builders `MixOutputControls.lean:124` · verified **partly, low**
- `v4b#2` nit (nobody): AnyTx README understates the ledger hypotheses of LogicBoxComposition and of the _valid forms `README.md:195`

*Coverage:* Read in full: - All 25 classic top-level Lovejoin/*.lean files: Scripts, Box, Logic, Steps, Owner, ReferenceHolder, MixBox{Purpose,Gate,NoLock}, MixLogicPurpose, OwnClassic1-3 with Boxes, Passes, Spec and Steps. - V2's hand-written files: Scripts, Logic, Steps, Owner, Mix, MixSpec, MixSplit, MixChallenges, MixFirst, MixSecond, MixPasses, MixOutputs, MixDatums, Mix3 with Spec, Steps, First, Second, Third and Passes, MixAny with Spec, First, Second, Passes and Steps, MixAny3 with Spec, Box1, Passes and Steps, MixAnyOut with Outputs, Datums and OutSteps, and MixTok2 with Spec, Passes and Steps. - AnyTx: README.md, Common, CekCase, PurposesKernel, LogicPublishKernel, BoxPurposesAll, BoxSemantics, BoxCover, BoxInlineAll, BoxMalformed, BoxGate, BoxBoundary, BoxSuffix, BoxDatum, BoxControls, BoxAllControls, OwnerOne, OwnerControls, OwnerLayouts, OwnerTwo, Owner3, OwnerOtherInputs, OwnerIff, Own…

## V5 (3 findings, 2 guards)

- `v5#1` low (nobody): CLAIMS.md's Blaster cross-check of the policy reads as covering every mint layout, but Blaster stops at five lines `CLAIMS.md:23` · verified **confirmed, low**
- `v5#2` low (nobody): README says the LinesAll kernel theorems list Lean's axioms alone, but nothing guards them, so a sorry there passes check.sh `README.md:86` · verified **confirmed, low**
- `v5#3` nit (nobody): CLAIMS.md puts 'an input in every transaction' among Lovejoin's assumed ledger rules, but none of Lovejoin's theorems uses it `CLAIMS.md:31`

*Coverage:* Read in full: seedelf-verification/CLAIMS.md, README.md, Seedelf/Every/README.md, Lovejoin/Every/README.md, Lovejoin/AnyTx/README.md and Audit/README.md; the root README.md; the wallet README. Also read in full: check.sh, lakefile.lean, both lake-manifest.json files, Seedelf.lean, and the cited theorem files: Seedelf/Every/Typed.lean, PolicyTyped.lean and AlwaysFalse.lean; Lovejoin/Every/Readable.lean, Typed.lean and MintTyped.lean; Lovejoin/AnyTx/BoxPurposesAll.lean, BoxSemantics.lean, PurposesKernel.lean and LogicPublishKernel.lean. Plus Lovejoin/Template/Scripts.lean, Lovejoin/Scripts.lean, Seedelf/Scripts.lean, extract.sh, extract-lovejoin.sh, Audit/Checks/FlatDecodeCheck.lean, the wasm crate's lovejoin_proven_bytes_test.rs, and templates.rs's first 240 lines. Diffed CLAIMS.md and README.md from chunk 48 (363acdf3) to HEAD, and traced each changed wording to its commit. Skimmed: Poli…

## L3cli (4 findings, 0 guards)

- `l3cli#1` low (stranger): The window ranks every ADA-only UTxO ahead of any token UTxO, so 20 small ones (anyone's) shut a large token UTxO out and transfer and sweep -l are refused `rows.rs:221`
- `l3cli#2` low (stranger): fund's new holders_of takes the holder with the most of the sent token first, so a stranger's UTxO holding more of it leads, and fund refuses or carries its junk `utxos.rs:220`
- `l3cli#3` low (stranger): The window runs core's fitting over every owned UTxO, quadratic in their token kinds, so a stranger's piles slow every transfer, sweep -l and util mint `rows.rs:257`
- `l3cli#4` nit (user): README says transfer, sweep and util mint can't spend a UTxO holding a reference script, but sweep --all sweeps them and --utxo spends them `README.md:195`

*Coverage:* Read in full on FIXTREE (and diffed against the CLI branch): - seedelf-cli/src/commands: rows.rs, sweep.rs, transfer.rs, external/sweep.rs, spend.rs, fund.rs, and util/mint.rs's run body. - seedelf-core/src/utxos.rs. - seedelf-koios register_of_datum and point_bytes. - All three round-two diffs on both branches, and the branch diff of core, crypto and koios sources. - README.md lines 149-195 and the root README's diff.  Read in the parts that matter, in seedelf-core: - build.rs: max_inputs/max_inputs_by/holding/quantity_in; select_script_inputs (blind path and apart); deposit_output(s), token_chunks, minimum_deposit and change_outputs; remainder and stage; the mint, transfer, sweep and external_sweep builders; minimum_address_payment; the build.rs diff between branches. - assets.rs add/merge, and eval.rs refusal.  Review records: COMMON.md, fix-branches.md, RESUME.md and owner-calls.md; …

## L3money (3 findings, 0 guards)

- `l3money#1` low (user): fund's holders_of leads with the UTxO holding the most of the token sent, whatever else it holds and however little ADA: a fund main builds is refused again, and a smaller one spends an extra UTxO `utxos.rs:220` · merged into l3cli#2
- `l3money#2` low (stranger): The CLI's new window ranks every UTxO of ADA alone above every token UTxO: twenty small ones, a stranger's dust or the user's own receipts, shut out the ADA a CLI spend leaves in token change `rows.rs:221` · merged into l3cli#1
- `l3money#3` low (stranger): The CLI's window adds up every owned UTxO's tokens in core's fitting, quadratic in the kinds: a stranger's piles make each transfer, sweep -l and util mint take minutes `rows.rs:257` · merged into l3cli#3

*Coverage:* Read in full: - The diffs of b3687869 (build.rs, lib.rs and the new tests in merge_test, mint_test and session_test), e6d6a18d (rows.rs, sweep.rs, transfer.rs, util/mint.rs, external/sweep.rs, README), af022a6f (utxos.rs, selection_integration.rs), 53780f85 (koios.rs, rows_test.rs), 81516188 (chain.ts, contract-scan.ts, cip30.rs, decode.rs, register_spellings_test.rs), e4d97bea (balances.ts, withdraw.ts) and 61a4d717's worker and screen changes (dapp.ts moreThanNote, tx-view.ts withDecimals, rpc.ts, DappApprovals.tsx, SiteSessions.tsx, TxDetail.tsx). - FIXTREE's rows.rs, fund.rs and utxos.rs select, do_select, fitting and collect_*. - core's ScriptSpend: with_account, draft, finalize, estimate, measure_locally, measuring_draft, most_fee and stage's account branch. - AccountMint (draft, finalize, estimate, settle, stage), account_inputs, account_collateral, account_mint, and AccountLaunch…

## L3screens (3 findings, 0 guards)

- `l3screens#1` low (user): The run ad8c3ce4 adds after every order reads spent leaves the page saying "Waiting for the order to fill … Stop cancels it." and keeps Stop, whose dialog describes and prices a cancel that never happens `sessions.ts:3986`
- `l3screens#2` low (nobody): Where 7b6881f7 meets ad8c3ce4: a late leg's direct return now writes the session's skip reason, and the last step says "Directly: Lovejoin was left out" under its link to the swap's own return, which went through Lovejoin `Swaps.tsx:3106`
- `l3screens#3` low (stranger): ad8c3ce4's landedAfter dates a stranger's payment against the swap's chain's last transaction: a payment landing while that chain is sent reads as the swap's own, and its skip reason takes over the swap's page (e2b#2 again) `sessions.ts:4728` · merged into l3still#2

*Coverage:* Read in full (FIXTREE): - The diffs of 2d639df8, 7b6881f7 (Swaps.tsx, flows.md, swap-page and swap-form-review tests), 61a4d717 (DappApprovals.tsx, SiteSessions.tsx, TxDetail.tsx, rpc.ts, dapp.ts, tx-view.ts, en.json) and ad8c3ce4 (lovejoin.ts, sessions.ts, pending.ts, activity.ts, account.ts, wallet.ts). - The cip30.rs part of 81516188 (the hash flag). - The round's en.json diff, and the es and ja values of its new keys.  Read in context: - sessions.ts: act (3760-4030), step, advance and stop, stopCost (3504-3570), runAll, view and autoView (6020-6100, 6729-6770), the start of buildBack and its strangers rule (4671-4800), sendBack and sendChain (5250-5440), pump, sendStep and sendRecorded (5468-5760). - Swaps.tsx: tagOf, subOf, stoppable, stopReading (230-345), NewSwap's quote and buildOut (700-900), the Session page (2150-2600), StopDialog (2867-3004), backStepText, ownReturnAt and Tim…

## L3sign (2 findings, 0 guards)

- `l3sign#1` low (site): A site's payment under the user's register that carries a reference script reads as a plain Seedelf payment, and Transaction details says "Yours, in your private balance", though the balance leaves it out and no web-wallet spend takes it `tx-view.ts:332`
- `l3sign#2` low (site): The sign window shows a held token off the wallet's list in raw units, while the Transaction details it opens scale it: 10^6 apart for a 6-decimal token `DappApprovals.tsx:1069`

*Coverage:* Read in full: - The round's commit list. - The diffs of 81516188, 61a4d717, 53780f85, e4d97bea and ca970760's dapp.ts line, plus every other round-two commit's file list, to rule out the sign window. - FIXTREE code in the parts that matter:   - cip30.rs: Paid, output_parts, Spender/register_fields/spender/inline_data, note_of, datum_names_key, and inspect from 1038 to 1420.   - decode.rs: DetailAddress/DetailRegister/DetailOutput/DetailDatum, output_detail, register_detail, address_detail, auxiliary, and the witness datums.   - tx-view.ts: from its head through markYours.   - TxDetail.tsx: Output and YoursTag.   - DappApprovals.tsx: ConnectRequest (560-1000) and SignTx (1040-1390).   - ui/dapp.ts: paidTo and signingTies.   - SiteSessions.tsx: TopUp, with its form and review.   - format.ts: unlocked, lockedAside and tokenKey. tokens.ts: tokenDecimals.   - chain.ts: headAt, pointAt and reg…

## L3still (5 findings, 0 guards)

- `l3still#1` low (user): r2still#2's one-run wait shows a filled swap as still filling: the private-swap e2e fails on both builds, and Stop is offered after the fill `sessions.ts:3986` · merged into l3screens#1
- `l3still#2` low (stranger): r2still#2's landedAfter cutoff takes a stranger's payment made while the swap's own return chain is being sent for the swap's own: its 'Lovejoin was left out' replaces how the swap came back (e2b#2 reopened) `sessions.ts:4728`
- `l3still#3` nit (nobody): The swap's last step says 'Directly: Lovejoin was left out' while it links the first return, which went through Lovejoin, once a later return of its own came back directly (r2docs#1 meets r2still#2) `Swaps.tsx:3106` · merged into l3screens#2
- `l3still#4` low (user): r2screens#1 is fixed only in part: the swap form and Send privately's too-much line still call the unlocked side 'your private balance', with nothing about the lock `Swaps.tsx:1152`
- `l3still#5` low (user): r2sign#3's class is fixed only in part: a session's return review shows a token off the wallet's list in raw units `SiteSessions.tsx:282`

*Coverage:* Read in full: - COMMON.md, FIX.md, RESUME.md and fix-branches.md. - INDEX.md's R2 sections and the round-two first items. - lanes/R2time.md and R2sign.md, and R2still.md's r2still#2 and its checked-and-holds. - verify/r2still-2.md's fix notes, verify/r2screens-1.md's notes and class, and verify/r2sign-3.md's class. - data/status.json for every round-two id. - Every round-two commit's diffstat. - Full diffs: ad8c3ce4 (all source and the edited tests), 7b6881f7, 61a4d717 (source and two test files), e66a6a16 (lovejoin.ts and docs), 81516188 (source), b3687869 (source), e6d6a18d (source), af022a6f, ca970760 (code), 2d639df8, f88560c4 (claim-all), 853d5779, e4d97bea, 04616cf6, the ja part of 02f73991, and ddc17685's README parts.  Read at HEAD around the changes: - sessions.ts: step/act, spentSeen, apart, sendBack, sendChain, sendStep/sendRecorded, serial/save/update, autoView. - lovejoin.ts…

## L3tests (4 findings, 0 guards)

- `l3tests#1` low (nobody): The e2e private swap fails on both builds since ad8c3ce4: one Refresh after the fill now only notes the order spent `extension.spec.ts:2948` · merged into l3screens#1
- `l3tests#2` low (nobody): count.py's new exit status fails a full audit run for modules Lake replays: they read STALE by mtime, and no check.sh run can clear that `count.py:153`
- `l3tests#3` low (nobody): check.sh's family runs no longer fail on an import's own sorry or Undetermined, and lovejoin-any-tx's 34 V2/Template imports were judged by none of the final runs `check.sh:275`
- `l3tests#4` low (nobody): test-tools.sh still passes with three of the rules it claims to hold dropped: check.sh's own sorry, its NO TRACE, and count.py's exit status `test-tools.sh:8`

*Coverage:* Read in full: - COMMON.md, FIX.md, RESUME.md, fix-branches.md and LIVE.md; lanes/R2tests.md and lanes/R2verif.md; owner-calls.md. - ddc17685's whole diff: check.sh, tally.py, count.py, run-all.sh and scan-diag.py as files; test-tools.sh; the README changes. - The test diffs of 853d5779, 2d639df8, e4d97bea, 7b6881f7, 459d4cf8, 61a4d717 (dapp-datum-hash, dapp-prompt), e66a6a16 (lovejoin-accounts, lovejoin-restore) and ad8c3ce4 (swap-page, swap-session, and the pastSpent edits to eight runner tests), with the source changes each pins. The UI diffs of round two; the en, es and ja and docs/i18n diffs. - The failing e2e test and the final checks' logs: e2e on both builds, both Vitest legs, cargo, and the four Lean runs.  Skimmed: - f88560c4's 17 tests (CSV cells read closely); e66a6a16's sessions submit-check tests; 81516188's Rust side; b3687869, e6d6a18d and af022a6f's Rust tests. Only apart…

## L3time (2 findings, 0 guards)

- `l3time#1` low (user): Bring one back takes its phrase pin only after giveme.my answers, and its watch isn't pinned at all: a Remove and a restore in that window put the first phrase's withdraw into the restored phrase's schedule, private history and Home watch `lovejoin.ts:7886`
- `l3time#2` low (user): r2still#2's wait counts runs, not time: a Refresh, Stop or Resume seconds after the run that read every order spent tells the outcome and builds the first return from listings no newer than that run's `sessions.ts:3986`

*Coverage:* FIXTREE at ad8c3ce4. Line numbers in findings are FIXTREE's.  Read in full: - COMMON.md. - The source diffs of ad8c3ce4 and e66a6a16. - wallet.ts 180-700. - account.ts. - pending.ts 378-960 and 1055-1141. - activity.ts sent, arrived and update. - lovejoin.ts: publicStart, publicSubmit, the head of pumpPublicNow, recordChain, sortOut, found, made, lookUp, madeBy, fartherIn, rejudge, inputsOf, accountKeys and accountIndexes, readSet, read(), update(), withdrawDueNow, withdrawNowNow, withdrawOne, dropWithdrawing, settleWithdrawing, resends, bringAllBackNow's loop, the head of publicAgainBuild, reserving and inTurn. - sessions.ts: step, act (3733-4033), stop, advance, resume, runAll, stopCost, the head of buildBack with its strangers rule, sendChain, listNow's write path, freshIndex, stillUnused, book, save, update, atStake, clearMixes, serial and reset. - handlers.ts restore and reset, and …

## R2cli (2 findings, 20 guards)

- `r2cli#1` high (stranger): Twenty of a stranger's token piles, sorted first under Koios's new tx_hash order, take every slot of the 20 UTxOs a CLI spend draws on: sweep --all, sweep, transfer and util mint then fail on every run `sweep.rs:166` · verified **confirmed, high**
- `r2cli#2` low (user): fund's new order takes a second holder of the sent token for its ADA before any ADA-only UTxO: a fund main made is refused, and others spend a token UTxO they don't need `utxos.rs:251` · verified **confirmed, low**

*Coverage:* Read in full, in FIXTREE: - seedelf-cli/src: commands/rows.rs, submit.rs, spend.rs, sweep.rs, external/{sweep,balance,mod}.rs, balance.rs, fund.rs, util/extract.rs, util/history.rs, web_server.rs. - seedelf-cli/static: index.js, index.html. - The diffs of create.rs (plus its selection and collateral code), remove.rs, transfer.rs (selection and --utxo), util/{mint,find,statistics}.rs, fee.rs, seedelf-display display.rs, and both READMEs' changes. - seedelf-koios koios.rs: the whole diff, covering utxo_pages, SubmitError and its helpers, submit_tx, TxInfoOutput.at_script, script_transactions and transaction_pages. - seedelf-core utxos.rs: the diff, plus select/do_select, assets_of, fitting, reference_script_size and filter_utxos. - seedelf-core build.rs, in part: TooLarge and fewer, settle and check_fee, external_sweep, minimum_deposit, change_outputs, minimum_address_payment and pay_addre…

## R2docs (6 findings, 13 guards)

- `r2docs#1` low (stranger): flows.md says a stranger's later swap return never changes what the page says of the swap's own, but the timeline's last step still follows the latest return `flows.md:478` · verified **confirmed, low**
- `r2docs#2` low (site): flows.md says a site's transaction note shows "as what's signed reads", but the sign window reads the metadata the site carries, never what the body's auxiliary_data_hash commits to `flows.md:431` · verified **confirmed, low**
- `r2docs#3` nit (nobody): The Lovejoin AnyTx README gives LogicLedgerUniqueness a weaker hypothesis than it has, and counts four of LogicBoxComposition's five theorems `README.md:203`
- `r2docs#4` nit (nobody): architecture.md calls core's check_nesting "the one walk for every transaction from outside the wallet", but the worker's cbor.ts walk is the one guarding ogmiosUtxos on a site's transaction `architecture.md:195`
- `r2docs#5` nit (user): privacy.md and architecture.md don't say that this release re-reads the private index from a snapshot and every pool copy once more, or that a reader version is now stored `privacy.md:230`
- `r2docs#6` nit (stranger): flows.md's Collateral page still describes the automatic pick as any 5 ₳ of ADA, and two code comments cite a collateralFits in sessions.ts that no longer exists `flows.md:142`

*Coverage:* Read in full: COMMON.md, FIX.md, fix-branches.md, RESUME.md and fixes/G1-G6.md. G7-G10 have no report in fixes/, so I worked from their commit messages (8fd738ff, c8003eda, 10a06db6, c4b7a906, 40883a55). I read every changed .md line of the round, sentence by sentence, from `git diff main..HEAD` over all 13 files: architecture.md, flows.md, privacy.md, keys-and-accounts.md, lovejoin-mix-width.md, wasm/README.md, README.md, seedelf-platform/README.md, CLAIMS.md, the seedelf-verification README, Audit/README.md, and Lovejoin/AnyTx and Lovejoin/Every READMEs. For each line I read the code it names.\n- Web wallet: balances.ts (atContract, spendableOwned, seedelfSide), contract-scan.ts's diff and utxoOf, private-index.ts utxoOf, coin-control.ts (collateralFits, collateralOf, listed), destination.ts's diff, chain.ts registerOf, cip30.rs (spender, register_fields, the paid loop, note_of), decod…

## R2money (2 findings, 22 guards)

- `r2money#1` low (user): A session's merged return whose only collateral is the 2 ₳ fallback is refused at a heavy fee, and the plain sweep of the same UTxOs, which builds, is never tried `lib.rs:1479` · verified **confirmed, low**
- `r2money#2` low (user): ScriptSpend::stage holds the collateral's return to its least at the estimate's guessed fee too, so a merged return whose settled fee leaves that least is newly refused `build.rs:2210` · verified **confirmed, low**

*Coverage:* Read in full: - The diffs of: core build.rs, lovejoin/mod.rs and utxos.rs; wasm lovejoin.rs and lib.rs (non-test parts); sessions.ts (all 619 diff lines); lovejoin-pools.ts, balances.ts, contract-scan.ts, coin-control.ts, collateral.ts, incoming.ts and destination.ts; the CLI's balance, fund, create, extract, remove, transfer, history and external balance. - The CLI's rows.rs, sweep.rs and external/sweep.rs, in full.  Read around the fixes: - core: apart, select_script_inputs, grow and one_more; ScriptSpend's draft, estimate, measure_locally, measuring_draft, settle, split, remainder and stage; settle; withdraw_declaring whole; mix_with's stage and loop; the deposit's change; carried(); fitting; the CLI's select; utxo_pages. - WASM: session_collateral, plan_return, built_or_without_strangers, merged_return, session_return, planned_return, direct_tail, collateral_mix, holdings_of, withdra…

## R2screens (3 findings, 9 guards)

- `r2screens#1` low (user): The connect window's private session now calls the unlocked side what's "in your private balance", with nothing about the lock `DappApprovals.tsx:994` · verified **confirmed, low**
- `r2screens#2` nit (user): Review swap's re-ask still overwrites a quote for the token picked meanwhile; after Back the form is stuck on "Getting a quote…" `Swaps.tsx:836`
- `r2screens#3` nit (user): Bring everything back's button reads "Sending…" while its switch rebuilds the returns `ClaimAll.tsx:199`

*Coverage:* Read in full, the diffs main..HEAD: - every file under extension/src/ui (34 files); - the screen-facing worker files: coin-control.ts, destination.ts, tx-view.ts, balances.ts (atContract, ownedUtxos, the seedelf card's tokens), handlers.ts (dapp-approvals); - shared/rpc.ts, scripts/i18n-critical.mjs, en.json, critical-keys.json, and the es and ja values of every new key.  Read in context in FIXTREE: - Swaps.tsx: NewSwap, SwapApproval, nowLine and subOf (669-1470, 283-310, 3300-3345); - ClaimAll.tsx, all of it; - DappApprovals.tsx: DappApprovals and ConnectRequest (76-1000), and SignTx and SignData's changed parts; - CardanoSend's form and review; MoveIn; CreateSeedelf's state and handlers; Collateral's handlers; - Lovejoin.tsx: publicPick, publicMixAda, publicBoxesAffordable, publicSideOf, HeldOnSide, mixMost, PoolPage's review build and render, anywayAccountsOf, privateTies, stoppedKey,…

## R2sign (3 findings, 12 guards)

- `r2sign#1` medium (site): The sign window now calls two register shapes a Seedelf payment, with no warning, though no Seedelf Wallet ever reads them: a datum kept by hash that the unsigned witness set carries, and the general form with an indefinite pair `cip30.rs:1288` · verified **confirmed, low**
- `r2sign#2` low (site): A second "msg" under label 674 is signed and published, but the window shows only the first and says nothing of the rest: x1a#3's otherMetadata check passes it as part of the note `dapp.ts:2996` · verified **confirmed, low**
- `r2sign#3` low (stranger): Remove's new token rows show a token off the wallet's list in raw units: the decimals the Seedelf's UTxO carries never reach the review `withdraw.ts:188` · verified **confirmed, low**

*Coverage:* Read in full: - This round's diffs (main..HEAD) of wasm cip30.rs, decode.rs, background dapp.ts, ui/dapp.ts, DappApprovals.tsx, tx-view.ts, destination.ts, StakedWarning.tsx, CardanoSend.tsx, Withdraw.tsx, RemoveSeedelf.tsx, Swaps.tsx (NewSwap and nowLine), PlutusTree.tsx and TxDetail.tsx. - Core's cbor.rs and orders.rs check_cancels, and en.json's changed strings. - cip30.rs from 1 to 1860: inspect end to end, note_of, row_address, network_of, spender and register_fields. - The surrounding code these call: chain.ts registerOf, seedelf-koios register_of_datum, private-index utxoOf, account.ts readAccountUtxos, withdraw.ts buildRemove, PaidRows, tokens.ts tokenQuantity, format.ts formatQuantity/unlocked, ReviewTotals homeBalance, dapp.ts ties/keysOf/siteTitle/view, and spent.ts reservations with lovejoin.ts ChainReservation. - The deployed wallet.ak and schnorr.ak at 5b82530, and Lean's S…

## R2still (3 findings, 20 guards)

- `r2still#1` low (site): x1a#3's fix is partial: a 674 map with a second "msg" key publishes lines the sign window never shows, and no line says there's more metadata `dapp.ts:2996` · merged into r2sign#2
- `r2still#2` low (nobody): gap-g4#1 is fixed only for a leg the second listing holds; a leg both listings miss still comes back alone and directly, and since e2b#2's strangers rule the swap's page no longer says so `sessions.ts:4704` · verified **confirmed, low**
- `r2still#3` low (nobody): This round's e7a#1, t1k#9 and t1j#6 tests fail on CI's preprod-only Vitest leg, so the fix PR's unit (preprod-only) job goes red and e7a#1's fix is pinned on one build only `swap-form-review.test.ts:309`

*Coverage:* Brief and record: read COMMON.md, FIX.md, RESUME.md, BASELINE.md, fix-branches.md and all six fixer reports. Read the INDEX table (all 323 lines, parsed) and the verify records of r3a#1, x2#1, r4#1, r4#2, e1a#1, e3a#1, e3a#2, e7a#1, x3#1, x4#1, gap-g4#1, gap-g4#2, gap-g5#1 and gap-g6#1, plus owner flags across every verify file. Read every fix commit's message in f87c3e77..HEAD.  Read in full in FIXTREE: the round's diffs of rpc.ts, dapp.ts, DappApprovals.tsx, ui/dapp.ts, coin-control.ts, balances.ts, contract-scan.ts, incoming.ts, pending.ts, sessions.ts (whole diff, plus act, inspect, buildBack and sendChain around it), lovejoin.ts (whole diff, plus withdrawOne and withdrawDue), lovejoin-pools.ts, wallet.ts, account.ts, accounts.ts, handlers.ts, App.tsx, tx-view.ts, destination.ts, collateral.ts, Swaps.tsx's NewSwap part, ClaimAll.tsx, SiteSessions.tsx, Collateral.tsx, format.ts, token…

## R2tests (10 findings, 27 guards)

- `r2tests#1` low (site): d1#3's sign-window warning for a payment into Seedelf under a dead register has no test: drop it and the whole Vitest suite passes `DappApprovals.tsx:1212`
- `r2tests#2` low (stranger): x1a#1/e9a#3's form notes on Send and Make public (stake works elsewhere) have no test; only the reviews' lines are pinned `CardanoSend.tsx:312`
- `r2tests#3` low (user): e8b#2's sibling: Create Seedelf's review line for withdrawn rewards has no test `CreateSeedelf.tsx:150`
- `r2tests#4` low (user): e4a#1's accounts.ts siblings: the merge's and check()'s phrase pins have no test, though the fixer's report says each sibling fails its own case `accounts.ts:288`
- `r2tests#5` low (stranger): r2a#2's error half (failed && !short_whole) is caught by no suite, the ignored parts suite included `build.rs:2874`
- `r2tests#6` low (nobody): v3#1's fix (a failed rebuild never reads as ok) has no committed test: drop tally.py's traceless-import rule and nothing notices `tally.py:113`
- `r2tests#7` low (nobody): New test private-index.test.ts 'is neither the wallet's nor a Seedelf's place' runs 3 to 6.4 s in its own file against Vitest's default 5 s, and times out with nothing wrong `private-index.test.ts:344`
- `r2tests#8` low (user): The CLI's two new 'Tx Hash' lines (r4#4's id before sending, and the signing page's id in the terminal) have no test `submit.rs:26`
- `r2tests#9` nit (stranger): e2b#2's 'nor clears' half (a strangers-only return leaves the skip reason alone) has no test `sessions.ts:5361`
- `r2tests#10` nit (nobody): decode_test's big-number test asserts a real-clock bound that adds nothing to the check before it `decode_test.rs:1979`

*Coverage:* Every fix commit from f87c3e77 to HEAD (10a06db6) was read and had its main change reverted in my copy; most commits had several sub-fixes reverted one at a time (about 168 mutants). Survivors were confirmed against the whole crate suite (Rust) or the whole default Vitest suite (TypeScript: four full runs of 3,554 tests each); for r2a#2 also the ignored release parts suite, run three times. Test-only commits (cc7440c9, 46975c50, 1d509df7, 3b755369, f1da256d, a9b5a3bb, 0a7d493e, 1dc64e1d, 5c5bc3c1, b27f0160) were checked only for behaviour-preserving seams; T1's lens owns their guards. 40883a55: only tally.py's rule was exercised, on a fake package. Its Lean parts (controls, SORRY verdict, #guard_msgs) and count.py's and check.sh's halves were read, not run (no Lean build allowed). Docs commits (10a06db6, README parts of c4b7a906 and 48a4c977) have no test to expect. Not reverted one by o…

## R2time (2 findings, 11 guards)

- `r2time#1` low (user): Bring one back paid by the public account: the watch's paysAccounts is read at the press, but the build pays and signs with whichever account is active after the reward-account read `lovejoin.ts:7155` · verified **confirmed, low**
- `r2time#2` low (user): e4a#1's class, left after the phrase-pin fix: the writes after a submit (the watch's take, Lovejoin's box-back history, a session return's landing) still go to whichever phrase is in when the network answers `lovejoin.ts:7814` · verified **confirmed, low**

*Coverage:* Lines are FIXTREE's (web-wallet/whole-review-fixes at 10a06db6). Paths are relative to the repository root, as in TREE.  Read in full: COMMON.md, FIX.md, RESUME.md, fix-branches.md, the six fixer reports (G1–G6), lanes X4 (both findings and every note), E4a and the head of E2b. I also read this round's diffs (main..HEAD) of wallet.ts, contract-scan.ts (and the whole file), lovejoin-pools.ts (1-470), balances.ts, account.ts, accounts.ts, pending.ts, handlers.ts, collateral.ts, lovejoin.ts, sessions.ts, dapp.ts, coin-control.ts, incoming.ts, staking.ts, shared/rpc.ts and ui/App.tsx.  Read in the parts that matter: - lovejoin.ts: the quiet constants and refusesEvery (1690-1790), withdrawDue/withdrawDueNow (6800-7000), withdrawNow/withdrawNowNow (7030-7170), bringAllBackNow and bringNoted (7265-7540), withdrawOne (7590-7830), dropWithdrawing/neverWent/dropRefused, reserve/release/holdOnly/re…

## R2verif (6 findings, 6 guards)

- `r2verif#1` low (nobody): check.sh's new SORRY verdict depends on PlutusCoreBlaster's sorry sitting at CekMachine.lean:309; on IOG's main it is at 317, so every module reads SORRY and hides real Undetermined results `check.sh:233` · verified **confirmed, low**
- `r2verif#2` low (nobody): check.sh reads #print axioms one line at a time, but Lean breaks a list over 120 columns into one axiom per line, so a native_decide (or a sorryAx listed after propext) reads ok `check.sh:240` · verified **confirmed, low**
- `r2verif#3` low (nobody): A failed rebuild still reads ok when the module that fails is in a dependency package: check.sh removes nothing, and tally.py and count.py count the old builds `check.sh:250` · verified **confirmed, low**
- `r2verif#4` low (nobody): run-all.sh's new failure list can never name `diag` for a LOOK or INCONCLUSIVE replay, because scan-diag.py exits 0 whatever it finds `run-all.sh:28` · verified **confirmed, low**
- `r2verif#5` low (nobody): README's new Controls bullet says each every-transaction family has a control over its own builder, but most builders have none, and Template.AnyTxPurposes has none and isn't listed as an exception `README.md:95` · verified **confirmed, low**
- `r2verif#6` nit (nobody): AnyTx README's new sentence says LogicLedgerUniqueness needs only the reference inputs' value rule, but its theorems take validReferenceInputs, which also requires them strictly ascending `README.md:203` · merged into r2docs#3

*Coverage:* Read in full: COMMON.md, FIX.md, fix-branches.md; lanes V3, V4a, V4b and V5; verify v3-1, v4a-1, v4b-1, v5-2 and v5-1's head; the fixer reports' heads (no verification fixer report exists in fixes/).  From 40883a55, read in full: - the whole diff under seedelf-verification; - check.sh, tally.py and Audit/count.py as files; - AnyTxControls, WalletAnyTxControls, Control4, Control64, FalsifiedBox and FalsifiedOwner.  Read the diffs of: run-all.sh, the Audit README, CLAIMS.md, the README (plus README lines 20-66 and 186-204), the AnyTx and Every READMEs, the three Readable docstrings, the six Output, Reference and Launch control modules, both generators, the LinesAll modules, PolicyLinesAnyTx and PolicyShapes (plus PolicyShapes 236-268).  Read where it mattered: - the statement of every twinned theorem; WalletAnyTx, Two and Three; Signers4; Control128's head; - LogicLedgerUniqueness' and Log…

## T1a (18 findings, 67 guards)

- `t1a#1` low (nobody): A proof for a register outside the prime-order subgroup: no test fails without it `schnorr.rs:106`
- `t1a#2` low (stranger): Re-randomizing a register outside the prime-order subgroup, which writes a locked UTxO: no test fails without it `register.rs:119`
- `t1a#3` low (nobody): A zero mix witness, whose output box anyone can withdraw: no test fails without it `lovejoin.rs:256`
- `t1a#4` low (nobody): A zero secret in an owner's Lovejoin Schnorr proof: no test fails without it `lovejoin.rs:200`
- `t1a#5` low (nobody): A sigma-OR with N outside [2, 255], whose 1-byte N wouldn't match the validator's: no test fails without it `lovejoin.rs:179`
- `t1a#6` low (nobody): The proof nonce's hedge against a failing random source: no test fails without it `schnorr.rs:62`
- `t1a#7` low (nobody): A minting script that doesn't hash to its policy: no test fails without it `build.rs:1726`
- `t1a#8` low (user): A payment output read back as the carry: no test fails without it `build.rs:2267`
- `t1a#9` low (nobody): Signing that changes the transaction's body: no test fails without it `build.rs:1193`
- `t1a#10` low (stranger): Max and parts taking a UTxO the wallet's evaluator can't take: no test fails without it `build.rs:2911`
- `t1a#11` low (stranger): An account-paid mint or launch spending tokens whose total passes a u64: no test fails without it `build.rs:3808`
- `t1a#12` low (user): An account mint's collateral return under its least: no test fails without it `build.rs:3747`
- `t1a#13` low (nobody): Bytes that aren't one complete datum read as a register (two of register_of_datum's checks): no test fails without either `koios.rs:373`
- `t1a#14` low (nobody): A Seedelf UTxO holding a quantity other than 1 taken for remove: no test fails without it `build.rs:3559`
- `t1a#15` low (user): A zero amount of a token paid to an address (Pallas's unwrap would trap): no test fails without it `build.rs:3337`
- `t1a#16` low (nobody): An account input or collateral on the other network: no test fails without that part of with_account's check `build.rs:1601`
- `t1a#17` low (nobody): A burn of a token the spent UTxOs don't hold: no test fails without remainder's check `build.rs:2105`
- `t1a#18` low (user): A fee whose 3/2 an account's collateral can't cover: no test fails without that check `build.rs:2197`

*Coverage:* Tried every guard in R1's (17) and R2a's (29) lists, none merged (the lanes don't overlap): 46 guards as 84 mutants (crypto 18, Koios 14, core 52), with a guard's sub-checks mutated one by one where it has several. Two extra mutants: WebAssembly's own giveme.my signature checks (lib.rs:5183, lovejoin.rs:3028), the production form of R2a's build.rs:1167. For each mutant: the lane's named test file, then the crate's tests; every survivor then ran the crates that depend on it (for crypto and Koios, the whole workspace, 790 tests; for core, seedelf-wasm and seedelf-cli, 351). Order: the guards with no named test first (schnorr.rs:106, register.rs:119, lovejoin.rs:256, 200, 179, schnorr.rs:62, build.rs:278, 441, 1726, 2058, 2264, 1193, 2553/2911, 2556 and the other fitting sites, 3747), then a stranger's or a site's input (koios.rs:361, 139, 157, register.rs:190, build.rs:3107, 3290), then th…

## T1b (12 findings, 45 guards)

- `t1b#1` low (nobody): A note patched after signing: no test fails without it `note.rs:83`
- `t1b#2` low (nobody): Overwriting another account's withdrawal in the withdraw-zero patch: no test fails without it `withdraw_zero.rs:108`
- `t1b#3` low (nobody): A script data hash recomputed without the witness datums: no test fails without the refusal `withdraw_zero.rs:114`
- `t1b#4` low (nobody): Map-form redeemers rewritten as a list: no test fails without the refusal `withdraw_zero.rs:120`
- `t1b#5` low (user): An odd fee whose 3/2 × fee collateral falls under the ledger's 150%: no CLI test fails without the even rounding `create.rs:226`
- `t1b#6` low (user): A change or output wrapping below zero at the CLI's checked_lovelace calls: no test fails without them `fund.rs:246`
- `t1b#7` low (user): Extracting a datum'd, a foreign or a spent UTxO: no test fails without util extract's refusals `extract.rs:60`
- `t1b#8` low (user): Removing a Seedelf the key doesn't own: no test fails without the refusal `remove.rs:68`
- `t1b#9` low (user): Paying a script, stake or other-network address from remove (and sweep): no test fails without the CLI's check `remove.rs:45`
- `t1b#10` low (user): Minting a Seedelf under an invalid or identity register: no test fails without util mint's check or the identity half of mint_from's `mint.rs:80`
- `t1b#11` low (user): Signing with a wallet on the other network: no test fails without the signing page's check `index.js:27`
- `t1b#12` low (stranger): A one-time key that isn't fresh, or proofs not bound to its hash: no CLI test fails without them `spend.rs:26`

*Coverage:* Every guard in both lists was tried: R2b's 28 and R4's 14, with R2b#26 and R4#7 (transaction.rs:130) merged, so 41 distinct guards. That took 61 mutants. Multi-site guards got one mutant per site, multi-condition guards one per condition, and two faithful variants were added for spend.rs (a fixed key; another 28-byte hash). 3 prepared panicking variants (M16p, M19p, M20p) were not run, because their wrapping versions were caught. Crates run per mutant: seedelf-core (named test, then all 356), seedelf-wasm native (305) for core guards, and seedelf-cli (46) for CLI guards and for core guards the CLI calls. Not run: the extension's Vitest (it reaches Rust only through the prebuilt wasm/pkg; WebAssembly wasn't rebuilt, per the brief), the CLI's 4 ignored live Koios tests, Playwright, and the parts suite. No guard left untried.

## T1c (16 findings, 43 guards)

- `t1c#1` low (stranger): A stranger's box with an identity point counted and drawn into the user's mixes: no test fails without it `mod.rs:453`
- `t1c#2` low (pool-launcher): A pool's box ADA times a deposit's boxes wrapping past a u64: no test fails without the checked product `mod.rs:775`
- `t1c#3` low (pool-launcher): A launch's token quantity of 0 reaching the box-value probes (check_token): no test fails without it, since value.rs gives the same words `box_value.rs:193`
- `t1c#4` low (nobody): A token box of 0 of its token reaching pallas through BoxValue::output: no test fails without value.rs's refusal `value.rs:108`
- `t1c#5` low (user): A paid withdraw's account change under an output's least: no test fails without it `mod.rs:1560`
- `t1c#6` low (nobody): Boxes coming back into an identity or invalid destination register: no test fails without it `mod.rs:1433`
- `t1c#7` low (nobody): A deposit's box paid under an identity or invalid register: no test fails without it `mod.rs:732`
- `t1c#8` low (nobody): A token-holding UTxO paying for Lovejoin (Coin::from_row): no test fails without its refusal `mod.rs:479`
- `t1c#9` low (nobody): A pool row away from mix_box's payment credential read as a box: no test fails without the credential check `mod.rs:416`
- `t1c#10` low (nobody): A deposit's inputs' ADA summed past a u64: no test fails without the checked sum `mod.rs:762`
- `t1c#11` low (nobody): One box mixed twice in a transaction: no test fails without the refusal `mod.rs:992`
- `t1c#12` low (nobody): A mix of fewer than two boxes: no test fails without the refusal, since its test asserts only is_err `mod.rs:985`
- `t1c#13` low (nobody): A chain that mixes without collateral: no test fails without chain_across's refusal, since mix() refuses in near words `mod.rs:2309`
- `t1c#14` low (nobody): A fan-out deeper than three waves: no test fails without fresh_for's depth bound `mod.rs:2520`
- `t1c#15` low (nobody): A withdraw whose declared budgets are under what its own proof measured: no test fails without the covers check `mod.rs:1686`
- `t1c#16` low (nobody): A withdraw whose fee never settled: no test fails without the 'did not settle' refusal `mod.rs:1740`

*Coverage:* I tried all 31 of R3a's guard entries. Five entries name more than one guard, so I split them: 415 into the value check, the credential check and from_resolved's twin; 760 into the inputs' sum, the boxes' product and the paid sum; 985 into the box count and the duplicate check; 1212 into the mix's and the withdraw's (1721); 2529 into PoolShort and the depth bound. I added from_row's points() use (426), the read the 333 entry describes (757) and the settle test behind 1740 (1696). That makes 46 mutant runs, including the 1105 and 1582 variants and the value.rs and box_value.rs pair.  How each was run, in T1c's copy only, each command capped: - The lane's named test file first, where it had one. - Then seedelf-core's Lovejoin set: lovejoin_test, lovejoin_pools_test, lovejoin_planner_test, lovejoin_box_value_test, lovejoin_vectors_test, lovejoin_width_test, lovejoin_mainnet_test, lovejoin_l…

## T1d (9 findings, 61 guards)

- `t1d#1` low (user): An account launch whose collateral can't come back as an output: no test fails without the refusal `launch.rs:503`
- `t1d#2` low (stranger): A cancel's collateral holding a token or a datum: no test fails without the refusal `orders.rs:736`
- `t1d#3` low (nobody): A cancel built on a datum other than the one its order holds: no test fails without the check `orders.rs:762`
- `t1d#4` low (stranger): A cancel spending a session row that holds a datum or a script: no test fails without the refusal `orders.rs:894`
- `t1d#5` low (nobody): A reference holding two lovejoin NFTs, or its policy's one token under another name: no test fails without the check `pool.rs:318`
- `t1d#6` low (pool-launcher): A v2 pool whose datum names another mix_logic: no test fails without the L check `pool.rs:415`
- `t1d#7` low (nobody): A finished launch that isn't the pool meant: no test fails without launched_pool's checks `launch.rs:699`
- `t1d#8` low (nobody): The bundled order table's load checks: no test fails without them, and as written none can `orders.rs:225`
- `t1d#9` low (user): A cancel declaring less than its finished bytes measure: no test fails without the check `orders.rs:1102`

*Coverage:* I tried all 30 of R3b's guards (none repeats), as 84 mutants, each of a different check. 78 of them ran one at a time in my copy of seedelf-platform. Each ran its named test file first, then, if nothing failed, the whole seedelf-core crate (--lib --tests: 31 targets, 356 tests, 6 ignored). The exception is the last 11 orders.rs mutants, which ran --lib plus orders_test only (28 tests), since nothing else in the crate reaches orders.rs. Five more were never run apart, as their results are implied: g21's token and datum parts and g22's three arms, because removing each whole check failed nothing. g1de (the NFT's name and quantity together) ran only in the combined wasm runs. 27 checks that failed no seedelf-core test (the survivors and the equivalent ones) also ran in two combined runs of seedelf-wasm's native suite (305 tests); in the second, 305 passed. 9 probe tests (the tests a fix wou…

## T1e (15 findings, 59 guards)

- `t1e#1` low (site): A session's sign and inspect calls forcing governance off, so the one-time accounts' DRep key never signs: no test fails without it `lib.rs:6453`
- `t1e#2` low (stranger): A session's collateral never being a UTxO the evaluator refuses (L20): no test fails without it `lib.rs:989`
- `t1e#3` low (user): Several recipients (not a funding) being split into parts: no test fails without it `lib.rs:4793`
- `t1e#4` low (user): An amount going out as more than MAX_PARTS (25) transactions: no test fails without it `lib.rs:4138`
- `t1e#5` low (user): The part sending the last tokens paying anything but exactly what's owed when its ADA covers it: no test fails without it `lib.rs:4152`
- `t1e#6` low (user): A part after the payment was paid in full, in parts that each pay their own fee: no test fails without it `lib.rs:4184`
- `t1e#7` low (user): An amount (with a funding's collateral) more than the UTxOs hold being planned into parts at all: no test fails without it `lib.rs:4133`
- `t1e#8` low (user): A carry's amount being retried on the largest UTxOs: no test fails without it `lib.rs:3571`
- `t1e#9` low (user): A chained part spending only its carry (a fee for nothing): no test fails without it `lib.rs:4335`
- `t1e#10` low (user): A second plan that takes as much as the first replacing it: no test fails without it `lib.rs:4390`
- `t1e#11` low (user): Re-planning a payment whose first plan pays no more than asked: no test fails without it `lib.rs:4372`
- `t1e#12` low (user): A carry read back from an output that isn't it (two outputs could be the carry): no test fails without it `build.rs:2267`
- `t1e#13` low (nobody): A spent input with no key path being skipped, not refused, when the account signs: no test fails without it `lib.rs:333`
- `t1e#14` low (nobody): A return merging into more than MAX_MERGE (4) of the funding's UTxOs: no test fails without it `lib.rs:1367`
- `t1e#15` low (nobody): An order cancel's funds or collateral not at the session's account: no test fails without it `lib.rs:807`

*Coverage:* I tried all 37 distinct guards in W1a (17) and W1b (21, with W1b's 3642 merged into W1a's 4133), as 59 mutants: each guard's sub-checks separately, plus 2 siblings of the same class. 41 mutants were caught and 18 were not; the 18 are the 15 findings, three of which cover two mutants each. For each mutant I ran the lane's named test file in full (or its module filter: parts_of_any_shape, chain_end_tests, return_plan_tests). If nothing failed, I ran the crate's whole default suite: seedelf-wasm's 16 targets (305 tests); for core mutants seedelf-core's 31 targets (356 tests) first; for the register mutant seedelf-crypto's suite first. I added the ignored payment_parts_shapes_test in release where the lane named it (4152, 4184, 3050) and for the planner's bounds (4335, 4138). What I didn't run: Vitest and the wasm .mjs tests against mutants, since they load the prebuilt wasm/pkg and the brie…

## T1f (12 findings, 41 guards)

- `t1f#1` low (site): A withdrawal on the other network, which would tie a stake-key certificate to it: no test fails without it `cip30.rs:1641`
- `t1f#2` low (pool-launcher): A launch's unreadable datum beside a script at the holder making the whole pool unreadable: no test fails without it `lovejoin.rs:195`
- `t1f#3` low (site): Overflowing ADA and token sums wrapping instead of being refused: no test fails without the checks `cip30.rs:137`
- `t1f#4` low (site): Collateral at risk counted with the site's collateral as if it were the account's: no test fails without the own-only sum `cip30.rs:1321`
- `t1f#5` low (stranger): A stranger's 5 ₳ UTxO with a datum, a token, a reference script or another value taken as the session's collateral for its mix: no test fails without fits_collateral's checks `lovejoin.rs:286`
- `t1f#6` low (stranger): Chain change sent to a stranger's row's address (the session's key under the stranger's stake key): no test fails without the own-row preference `lovejoin.rs:1059`
- `t1f#7` low (nobody): The session's collateral put into a pool that isn't 5 ₳ boxes of ADA: no test fails without collateral_protocol's check `lovejoin.rs:340`
- `t1f#8` low (nobody): A row not under the session's payment key built into a chain's deposit: no test fails without holdings_of's key check `lovejoin.rs:1025`
- `t1f#9` low (user): A token total past u64 wrapping the count of token boxes: no test fails without the u128 sum `lovejoin.rs:950`
- `t1f#10` low (pool-launcher): A public mix's ADA need plus the token change's least ADA wrapping: no test fails without the checked_add `lovejoin.rs:2273`
- `t1f#11` low (nobody): The public account's collateral spent by a public mix's deposit, its Mix again or a paid withdraw: no test fails without not_collateral `lovejoin.rs:2209`
- `t1f#12` low (nobody): A chain across pools naming one ADA pool twice, or two pools of one token: no test fails without either check alone `lovejoin.rs:1247`

*Coverage:* I tried every guard in W2 (23 entries, cip30.rs and decode.rs) and W3 (18 entries, wasm lovejoin.rs and extension lovejoin.ts). The two lanes share no guard, so there were no duplicates to merge; 41 guards in all. Several were split into sub-mutants, one per condition: at_risk ×2, owner ×2, own_address ×3, old dereg ×2, unfound inputs ×2, net ×4, checked sums ×3, raw_map/raw_vkeys ×2, fits_collateral ×4, draws ×2, not_collateral ×3, min(ours.len()) ×2, withdraw_private_in ×5 (one in core), protocols_of ×2, reward balance ×2, verify_pool ×3 (two in core), retired pool ×9.  Order: the guards with no named test first (cip30.rs:137, 1321's mixed case, 1641; lovejoin.rs:286, 1025, 1039, 1059, 950, 2273, 2209, 1620, 2898, 3028, 1247, 239; lovejoin.ts:4232). Then the site and stranger inputs, then the rest.  Tests run per mutant: - cip30 mutants: every native binary that reaches cip30 (cip30_te…

## T1g (14 findings, 68 guards)

- `t1g#1` low (user): A due box that a reviewed or sending chain has reserved, withdrawn by the due run: no test fails without it `lovejoin.ts:6876`
- `t1g#2` low (nobody): A withdraw whose signed hash differs from the reviewed build, sent anyway: no test fails without the hash check `lovejoin.ts:7643`
- `t1g#3` low (pool-launcher): A copy of the 5 ₳ pool taken as a return's ADA and collateral pool: no test fails without adaPoolOf's copy check `lovejoin.ts:702`
- `t1g#4` low (user): A token pool named on the review taken even though it can't take a box now: no test fails without acrossOf's 'works' check `lovejoin.ts:3974`
- `t1g#5` low (pool-launcher): A data-layer pool of an unlisted token (or a 10 ₳ ADA pool) kept: no test fails without verified()'s listedValue check `lovejoin-pools.ts:530`
- `t1g#6` low (user): A pool's bare private start spending UTxOs its review never showed: no test fails without the 'only' filter `lovejoin-launch.ts:337`
- `t1g#7` low (user): withdrawDueNow's early return while a chain is mixing: no test fails without it `lovejoin.ts:6796`
- `t1g#8` low (nobody): giveme.my's coin put up for a collateral mix the network measures higher: no test fails without tailWitness's budget check `lovejoin.ts:4546`
- `t1g#9` low (user): A session chain keeps its reservation after the network's check refused it: no test fails without the unreserve (both copies) `lovejoin.ts:3865`
- `t1g#10` low (user): A return across pools reserving its boxes only after the network's check: no test fails `lovejoin.ts:4098`
- `t1g#11` low (nobody): Only the first leg's first mix measured in a return across pools: no test fails without crossCheck's per-leg indexes `lovejoin.ts:4808`
- `t1g#12` low (user): An ADA pool start at the classic pool's 10 ₳: no test fails without the worker's own refusal `lovejoin-launch.ts:237`
- `t1g#13` low (user): A token start of more than one output holds (over 2^64−1 a box): no test fails without the worker's cap `lovejoin-launch.ts:235`
- `t1g#14` low (user): Mix again's boxes paid by an account switched to during its build: no test fails without the account check `lovejoin.ts:5082`

*Coverage:* Tried every guard in E1a's and E1b's lists, after merging the duplicates (a1/b13, a4/b18, a5/b22, a6/b24, a7/b25, and a9 with b14). That is 37 guards and 71 mutants, run in the order asked: no named test first, then a stranger's or site's input, then the rest. Every mutant ran against its lane-named tests where the lane named any. Every survivor then ran against each test where the fire marker showed its guard acting; for M01, M02, M03, M09, M14, M62 and M68, against every test that reaches the line as well. Not fire-checked: 43 of the 192 reaching test files, which reach the modules only through handlers, sessions, sw or dapp and never call a Lovejoin flow (accounts*, dapp-*, governance, swap-*, wallet, worker and similar). Their runs could miss a firing, but none of them calls a Lovejoin flow. Two runs were cut short. M24's extra reach-set run (65 tests) was stopped after 15 minutes un…

## T1h (12 findings, 50 guards)

- `t1h#1` low (site): A runner-signed session transaction carrying a governance proposal, a certificate, a vote or a non-direct withdrawal: no test fails without it `sessions.ts:6867`
- `t1h#2` low (site): A fee-sized output carrying the session's tokens taken as Minswap's fee: no test fails without it `sessions.ts:6697`
- `t1h#3` low (site): An order swap paying out more of a token than was funded: no test fails without it `sessions.ts:6581`
- `t1h#4` low (site): A second fee-sized output taken as Minswap's fee: no test fails without it `sessions.ts:6697`
- `t1h#5` low (site): A session transaction that mints or burns: no test fails without it `sessions.ts:6870`
- `t1h#6` low (stranger): A stranger's exactly-5-ADA UTxO carrying tokens put up as a chain's collateral: no test fails without it `sessions.ts:1053`
- `t1h#7` low (stranger): A stranger's 5 ADA with a datum by hash put up as a chain's collateral: no test fails without it `sessions.ts:1053`
- `t1h#8` low (user): A second 'Mix my boxes again' sent while one may still spend the same boxes: no test fails without the Send-time check `sessions.ts:2322`
- `t1h#9` low (user): A top-up review older than BUILT_TTL_MS recorded before Send refuses it: no test fails without it `sessions.ts:2406`
- `t1h#10` low (nobody): A funding or top-up that Koios answered with another transaction's id marked never sent: no test fails without markUnsent's maybe-sent exception `sessions.ts:3030`
- `t1h#11` low (nobody): A swap signed when WebAssembly answers its cancel dry run for fewer orders than asked: no test fails without the length check `sessions.ts:4288`
- `t1h#12` low (nobody): A session swap or cancel sent whose signed bytes don't hash to the transaction inspected: no test fails without either check `sessions.ts:4477`

*Coverage:* All 50 unique guards in E2a's and E2b's lists were tried: E2a's 25 and E2b's 26, with E2a#11 and E2b#19 merged. Every sub-check a lane named by line or clause is a mutant of its own, 140 in all, each in a copy, never in TREE. Every mutant has a verdict: 127 caught and 13 not caught. The 13 fall under 9 lane guards: E2a#8, E2a#11/E2b#19, E2a#19, E2a#22, E2b#0, E2b#1, E2b#6, E2b#8 and E2b#11. They are reported as 12 findings, since both signAndSend checks are one. No guard was left untried. Run scope: phase 1 ran a03 and a22 against their named or candidate files. Every other mutant ran against the tests the probes show its guard firing in, out of the 194 test files whose imports reach the four guarded modules. All 194 ran once with probes. The unreached ones were confirmed by a combined run over their named files. a11h also ran its one reaching file whole without -t. The whole suite wasn'…

## T1i (18 findings, 46 guards)

- `t1i#1` low (site): An approval whose request left the queue during the password check, signing nothing else: no test fails without it `dapp.ts:685`
- `t1i#2` low (site): A site's ADA-only contract release, waiting for the user's yes: no test fails without it `dapp.ts:34`
- `t1i#3` low (site): A site's port from an iframe, a non-https page or another extension, refused: no test fails without it `sw.ts:364`
- `t1i#4` low (site): A site's transaction the wallet can't sign whole, without partialSign, refused: no test fails without it `dapp.ts:2087`
- `t1i#5` low (site): After a worker restart, only read calls are asked again, and only once: no test fails without it `bridge.ts:56`
- `t1i#6` low (site): A site's private-session funding sent only for the origin and network it was reviewed for, within 10 minutes: no test fails without three of its four checks `sessions.ts:2134`
- `t1i#7` low (user): A top-up sent only as reviewed (same hash and network), within 10 minutes: no test fails without either check `sessions.ts:2398`
- `t1i#8` low (user): A balance reading of the account the user switched from, kept as the new account's: no test fails without the check `balances.ts:392`
- `t1i#9` low (user): A contract read that spans another wallet's keys, ended: no test fails without either same() check `contract-scan.ts:137`
- `t1i#10` low (user): An account switch while a payment that may still go through is open, refused: no test fails without it `handlers.ts:380`
- `t1i#11` low (user): Decline all, or any answer, refused for a private session's funding that's already sent: no test fails without either side's check `DappApprovals.tsx:197`
- `t1i#12` low (user): The sign window's answer refused while busy, during the hold, or without the password: no test fails without those conditions `DappApprovals.tsx:154`
- `t1i#13` low (user): A private session's funding sent again while its refusal is shown: no test fails without the check `DappApprovals.tsx:715`
- `t1i#14` low (user): A private session's amount over the private balance, refused in the connect window: no test fails without the check `DappApprovals.tsx:687`
- `t1i#15` low (user): A top-up over the spendable private balance, refused in its form: no test fails without the check `SiteSessions.tsx:572`
- `t1i#16` low (user): A site session's Disconnect kept off until its account is read: no test fails without the wait `SiteSessions.tsx:120`
- `t1i#17` low (user): A dApp account index past 2^31 - 1 kept in the preferences: no test fails without the bound `preferences.ts:72`
- `t1i#18` low (nobody): A private session's signature carrying no governance (DRep key): no test fails without the check, which no flow can reach `dapp.ts:2061`

*Coverage:* All 46 lane guards tried: E3a's 20, E3b's 18 and E4a's 9, with dapp.ts:2183 (E3a#7 and E3b#14) merged. That came to 100 distinct mutants, since most guards were split into their conditions; the specs are in SCRATCH/r51/work/T1i/specs, which is tmpfs. Order: no test or an unknown test first (sw.ts:364, tx-view.ts:344, DappApprovals.tsx:197 and :687, and the guards named only by e2e), then a site's input (the rest of E3a, plus ui/dapp.ts and Connect), then the rest. Each mutant ran first against the lane's named Vitest cases by file:line, then against the named files in full plus that source file's importing or calling tests: 31 dapp files, 11 DappApprovals files, 9 SiteSessions files, and 16 to 20 sessions files per function. I ran in four copies: one per batch (UI, and two sharing the worker specs), plus a pristine one for baselines. 45 caught; 18 findings are uncaught guards or conditio…

## T1j (14 findings, 68 guards)

- `t1j#1` low (site): The connector serving a port from an iframe, another extension, a non-tab page or a plain-http page: no test fails without it `sw.ts:364`
- `t1j#2` low (site): A site hearing the worker's own error text, in the user's language, instead of SITE_TRAPPED in English: no test fails without it `sw.ts:427`
- `t1j#3` low (site): Site requests asked on the network the wallet just left still answered after Settings' switch: no test fails without handlers.ts:405 `handlers.ts:405`
- `t1j#4` low (site): A site's 5-byte transaction hanging the worker's CBOR reader: no test fails without cbor.ts:33's length-bytes bound `cbor.ts:33`
- `t1j#5` low (stranger): A stranger's 5 ₳ UTxO that also holds a token picked as the account's collateral: no test fails without isCollateralShaped's token check `coin-control.ts:184`
- `t1j#6` low (stranger): The wallet staying unlocked on a WebAssembly instance that trapped under one of its pages' requests: no test fails without sw.ts:382 `sw.ts:382`
- `t1j#7` low (user): A payment in parts going in part when a later kept part is missing or another review's: no test fails without laterParts' check `script-spend.ts:585`
- `t1j#8` low (user): A second payment written ahead beside one that may still go through, when both pass settleMaybeSent: no test fails without writeAhead's check `pending.ts:599`
- `t1j#9` low (user): A new payment checked against one that may still go through only after giveme.my was asked: no test fails without settleMaybeSent at Send `script-spend.ts:397`
- `t1j#10` low (user): A payment sent although its maybe-sent copy couldn't be sealed: no test fails without writeAhead's seal check `pending.ts:621`
- `t1j#11` low (user): A payment in parts whose later part spends what another chain being sent reserves going in part: no test fails without the later parts' reservation check `script-spend.ts:438`
- `t1j#12` low (user): Switching public accounts while a payment Koios didn't answer may still go through: no test fails without account-use's maybe-sent half `handlers.ts:380`
- `t1j#13` low (user): Two background runs at once, the alarm's and the unlock's, sending two withdraws seconds apart: no test fails without sw.ts's one-run-at-a-time guard `sw.ts:113`
- `t1j#14` low (user): A payment to no one or to more than 20, refused only by WebAssembly in English after every destination was resolved: no test fails without checkRecipients `recipients.ts:11`

*Coverage:* Every guard was tried: 42 guards from E4b's (12) and E5's (30) lists, with no duplicates between the lanes. That took 80 mutants, splitting a guard into its sub-checks where it has several. On top of that: a follow-up for handlers.ts:149, a second pass of the 9 survivors over 19 more test files, two unmutated control runs of the timed-out catches, and one probe test (cbor 84a1009f58) in a copy only. Every mutant ran in copies under ~/.cache/seedelf-review-51/T1j (four copies in all), never in TREE. I added no test to TREE. The copies and T1j-target (unused: these lanes have no Rust guard) are removed. Not tried: nothing on the lists. Not mutated: the Rust behind WebAssembly that backs four of the TS guards, since the copy has the prebuilt wasm/pkg (listed in notes). The first runner's lane outputs and every mutant's JSON report and log are in SCRATCH/r51/work/T1j/ (logs/, logs2/, results…

## T1k (14 findings, 53 guards)

- `t1k#1` low (stranger): A stranger's datum that realigns into a register (a field that isn't a 48-byte byte string): no test fails without registerOf's length or type check `chain.ts:49`
- `t1k#2` low (user): A Seedelf name located at a row without that token, or at one this wallet has just spent: no test fails without the names loop's two checks `contract-scan.ts:335`
- `t1k#3` low (user): A contract read whose keys change between batches kept as one wallet's: no test fails without `same`'s check `contract-scan.ts:137`
- `t1k#4` low (user): A watch reading the feed from a cursor newer than its transaction's first try: no test fails without cover's choice of cursor `feed.ts:143`
- `t1k#5` low (stranger): A session swap or cancel carrying certificates, withdrawals, votes, proposals, mints, a missing witness or unknown inputs: no test fails without refuseOddities' refusals of them `sessions.ts:6867`
- `t1k#6` low (stranger): Minswap's order build with a second fee output, or a fee output carrying a token: no test fails without checkOrder's one-ADA-only-fee rule `sessions.ts:6697`
- `t1k#7` low (stranger): Minswap's order build paying out more of a token than was funded, or a token that wasn't: no test fails without withinFunding's token limit `sessions.ts:6581`
- `t1k#8` low (stranger): A token Minswap lists by its exact ID but marks unverified, treated as verified: no test fails without the is_verified check `sessions.ts:1902`
- `t1k#9` low (user): Review offered on the swap form when the private balance can't fund the quote, the amount is more than what's held, or the token is unverified: no test fails without Swaps.tsx's ready gate `Swaps.tsx:761`
- `t1k#10` low (user): A staking review's 'Public account after' off by the fee, the deposit, the refund or the rewards: no test fails without its sum `Staking.tsx:1021`
- `t1k#11` low (user): Stop staking offered while the rewards are locked: no test fails without the button's locked gate `Staking.tsx:645`
- `t1k#12` low (user): Staking with a retired pool offered: no test fails without the pool page's retired check `Pools.tsx:356`
- `t1k#13` low (user): A DRep retirement built without Koios's deposit: no Vitest test fails without the worker's check `staking.ts:523`
- `t1k#14` low (nobody): A transaction Minswap built that the wallet can't read (not 4 items, no outputs, an output without a value, an inline datum not wrapped in tag 24): no test fails without builtOutputs' refusals `minswap.ts:509`

*Coverage:* Tried all 53 lane guards: E6's 15, E7a's 20 and E7b's 18. None was duplicated across lanes, since the three lanes cover different files. Order followed the brief: first the guards whose test was none or unknown (E6#2, E6#8, E7b#8, #10, #12, #15, #16, #17), then those on a stranger's input (E6#0, #1, #3, #4, #5 and the Minswap checks), then the rest. In all I ran 168 mutants: E6 43, E7a 93, E7b 32. That is 155 Vitest and 13 cargo staking_test, plus 3 crypto and 1 wasm Rust mutants run by hand. On top came 30 wide-pass reruns and 11 demonstration runs. Not tried: the 'reads token by token' performance property of chain.ts:84 (no simple mutant); blstrs's own torsion refusal (third-party code); koios.ts submitTx's TxSubmitConnectionError retry and paged()'s 'nothing new' stop (a hang guard, not the money one); stake()'s own call to check_paths apart from the shared check; refuseSent and late…

## T1l (23 findings, 117 guards)

- `t1l#1` low (stranger): A stranger's token name, a pool's ticker and a DRep's name kept from running as a CSV formula: no test fails without it `activity.ts:228`
- `t1l#2` low (user): Send publicly's Total leaving counting a payment to another of the user's own accounts as leaving: no test fails without it `CardanoSend.tsx:165`
- `t1l#3` low (user): Send privately's Total leaving leaving out a payment to the user's own Seedelf: no test fails without it `Transfer.tsx:178`
- `t1l#4` low (user): Start a pool's 'Private balance after' counted from Home's figure: no test fails without it `LovejoinLaunch.tsx:456`
- `t1l#5` low (user): A locked UTxO's tokens kept out of what a form may send: no test fails without it `format.ts:380`
- `t1l#6` low (user): A review's '… after' held at 0 ₳: no test fails without it `ReviewTotals.tsx:100`
- `t1l#7` low (user): A pasted recovery phrase cleared from the clipboard: no test fails without it `PhraseInput.tsx:91`
- `t1l#8` low (user): Send publicly's warning before an ADA Handle goes into someone's Seedelf: no test fails without it `CardanoSend.tsx:338`
- `t1l#9` low (user): A token amount the form can't read ('1.2.3') refused before Review: no test fails without it `TokenAmounts.tsx:72`
- `t1l#10` low (user): Bring everything back building and signing its returns once, for the list it opened with: no test fails without it `ClaimAll.tsx:100`
- `t1l#11` low (user): Home holding payments past 10 minutes while a maybe-sent one may still land: no test fails without it `Home.tsx:502`
- `t1l#12` low (user): The browser's Back pressing a disabled screen Back (a transaction being sent): no test fails without it `history.ts:65`
- `t1l#13` low (user): Stop offered on a mix card once its chain exists: no test fails without it `Lovejoin.tsx:862`
- `t1l#14` low (user): Bring everything back refusing returns built more than 10 minutes ago: no test fails without it `sessions.ts:3363`
- `t1l#15` low (user): Set collateral held on an empty account, or while Home holds a payment: no test fails without it `Collateral.tsx:265`
- `t1l#16` low (user): Make public's early stop on more than the private balance: no test fails without it `Withdraw.tsx:94`
- `t1l#17` low (user): Send publicly's early stop on more than the account can pay: no test fails without it `CardanoSend.tsx:110`
- `t1l#18` low (user): Make public's Max sending no token amounts, and its hidden token boxes not holding Review: no test fails without them `Withdraw.tsx:128`
- `t1l#19` low (user): Send privately's Max turned off by Add recipient: no test fails without it `Transfer.tsx:379`
- `t1l#20` low (user): Start a pool's checks before Review (a quantity, the box's least and most, a copy, the classic 10 ₳): no test fails without them `LovejoinLaunch.tsx:153`
- `t1l#21` low (user): A Bootstrap's count held to its most: no test fails without it `Lovejoin.tsx:3734`
- `t1l#22` low (user): A private Bootstrap held where the balance holds too little of the pool's token: no test fails without it `Lovejoin.tsx:3736`
- `t1l#23` low (user): Bring everything back leaving out a session that runs itself, or one holding nothing: no test fails without it `ClaimAll.tsx:43`

*Coverage:* I tried all 63 guard entries in E8a (15), E8b (19), E9a (16) and E9b (13). Merging duplicates left 59 distinct guards: E9a and E9b share format.ts unlocked() and activity.ts csvCell, and E9a's format.ts:166 and :288 are E9b's :168-170 and :279-292 sites. These ran as 117 mutants: one per site or condition, plus Send privately's Max tried alone and combined with :105. Each ran its three stages unless caught earlier. Order: first the guards with no named test or only an e2e one, then those on a stranger's or a site's input, then the rest. Not done: (1) Playwright isn't run by this lens, so the 11 e2e-only pins are traced, not run. (2) Per-condition mutants of Start a pool's six checks: removing all six at once fails nothing, so none can be pinned alone. (3) No Rust guards fell in these lanes, so there was no cargo build and no WebAssembly limit to hit. Stage 3 covers every committed test t…

## X1a (3 findings, 16 guards)

- `x1a#1` low (stranger): Send and Make public call the user's payment key under someone else's stake key "your own public account: it comes back", where the sign window says its staking rewards aren't yours `destination.ts:122` · verified **confirmed, low**
- `x1a#2` low (site): The sign window says a site's payment into a Seedelf hides whose it is without checking its register: a register written as found shows on chain whose it is `cip30.rs:1386` · verified **confirmed, low**
- `x1a#3` low (site): The sign window leaves out "It carries metadata" whenever a note is shown, so a site's other metadata beside a CIP-20 note is never mentioned `DappApprovals.tsx:1083` · verified **confirmed, low**

*Coverage:* Read in full: ui/screens/CardanoSend.tsx, MoveIn.tsx, CreateSeedelf.tsx and Collateral.tsx; background/send.ts, move-in.ts, mint.ts, destination.ts, tx-view.ts and account.ts; ui/dapp.ts; components/ReviewTotals.tsx, ReviewRows.tsx and PaidRows.tsx; seedelf-core/src/note.rs.  Read in the parts named: - DappApprovals.tsx 998-1378 (SignTx, SignData); - dapp.ts 1960-2520 (stakeDeposit, readTx, signTx, waitingCbor, ties, publicKeys, remember, the head of signData); - cip30.rs 1-540, 690-2008 and 2150-2384: types, Amount, keys, inspect, sign_tx, signData; - wasm lib.rs:   - 60-620: move_in, check_paths, sign_with_paths, withdrawing, sign_staking;   - 1536-2100: SendRequest/account_send, stake, drep_transaction;   - 2725-2925: account mint;   - 5085-5180: is_own_address, carries_stake_key; - core build.rs 90-490 (settle, Patches, outputs, minimums), 580-1100 (Payee, account builders, account_p…

## X1b (2 findings, 14 guards)

- `x1b#1` low (user): A site session's Bring it back review through Lovejoin opens Transaction details on the chain's last transaction, unnamed, not the deposit `SiteSessions.tsx:299` · verified **confirmed, low**
- `x1b#2` nit (nobody): withdraw.ts says a shortfall's `most` is one transaction, but WebAssembly builds it in parts, up to 25 `withdraw.ts:104`

*Coverage:* Read in full: - extension/src/background: transfer.ts, withdraw.ts, mint.ts, script-spend.ts (all 644 lines). - extension/src/ui/screens: Transfer.tsx, Withdraw.tsx, RemoveSeedelf.tsx, CreateSeedelf.tsx. - extension/src/ui/components: ReviewTotals.tsx, LovejoinReturn.tsx (all 578 lines), HistoriesNote.tsx.  Read in part: - parts.ts 1-260: the header, reviewParts, splitParts, letGo's head. - sessions.ts: siteOutBuild 2031-2080; mixOutBuild, againBuild, mixFunding and mixOutSubmit 2155-2345; buildFunding and outSubmit's head 3000-3150; buildBack's chain call and summary 4577-4760; sendChain 5170-5250; wayOf, pricedClassic and fillsOf 6412-6447. - lovejoin.ts: againBoxes 3476-3580; chain and fanOut 3642-3900; unstale 4598-4612; bringAllBackNow's loop 7340-7420; grep-level reads of withdrawOne 7542-7700. - wasm lib.rs: classes_mixed 2221; the stealth mint 2396-2475; withdrawal_of, amounts_of…

## X2 (2 findings, 14 guards)

- `x2#1` medium (stranger): A stranger's 5 ₳ at a KEY address whose hash is a pool's mix_box script hash counts as a pool box: it counts toward the floor, gets drawn, and every chain that draws it fails, so returns come back directly `mod.rs:416` · verified **confirmed, medium**
- `x2#2` low (stranger): A UTxO at a KEY address whose hash is the Seedelf contract's, under the user's register, counts in the private balance, and any spend that takes it fails: Max always fails for wallets of up to 20 private UTxOs `balances.ts:489` · verified **confirmed, low**

*Coverage:* Read in full: the brief (COMMON.md), INDEX.md, LANES.md, RESUME.md and BASELINE.md, R3a's full report and r3a-1's verification. I also read E6's checked list and notes, the notes of W1b, W2, W3, E1a and E1b, and W2's w2#2.  Code read for the traces: - seedelf-core: lovejoin/mod.rs 330-520, 920-1170 and 2282-2605; eval.rs 1-200 and 290-380; utxos.rs 1-130 and 315-432; build.rs 2530-2880 (select_script_inputs, one_more, grow, apart); lovejoin/value.rs is_row and is_value; orders.rs 1275-1300. - seedelf-koios: koios.rs 354-372. - wasm: lovejoin.rs 355-500 and 2580-2680; lib.rs 960-1010, 1160-1215, 2290-2360, 2995-3017, 4033-4081 and 4458-4553. - extension, in full: contract-scan.ts, chain.ts, shared/seedelf-name.ts. - extension, in part: balances.ts 80-90, 250-265 and 478-506; private-index.ts 1-80 and 370-413; koios.ts 780-940; lovejoin.ts 3220-3350, 3642-3700, 6227-6356, 6778-6960 and 751…

## X3 (1 findings, 13 guards)

- `x3#1` low (site): The sign window's register reader takes only tag 121, so a site's valid Seedelf payment spelled in constructor 0's general form (tag 102) reads 'without a register: anyone can take' and 'Your private balance isn't in it' `cip30.rs:1011` · verified **confirmed, low**

*Coverage:* Read in full: extension background/chain.ts, destination.ts, short.ts, minted-by.ts, account.ts; shared/recipients.ts, seedelf-name.ts, histories.ts, preferences.ts; seedelf-core address.rs, constants.rs, transaction.rs, cbor.rs.  Read in the parts this lens needed: - seedelf-koios koios.rs: InlineDatum, ReferenceScript, UtxoResponse, extract_bytes_with_logging, register_of_datum, point_bytes, TxInfoOutput. - wasm cip30.rs: network_flag, network_of, keys_of, own_address, has_payment_key, MAX_TX_BYTES, MAX_NESTING, output_parts, register_datum, datum_names_key, released_from_contracts, inspect's output loop. - wasm decode.rs: register_detail, output_detail. - wasm lib.rs: LeftOut and left_out; lovelace_of and MAX_SUPPLY_LOVELACE; payment_key_of; MAX_MERGE and session_collateral; NOTHING_PAYS; plan_return; built_or_without_strangers; merged_return; session_return; planned_return; MAX_RECIP…

## X4 (2 findings, 16 guards)

- `x4#1` low (user): A due box's withdraw reads the five-minute quiet rule before its Koios reads and giveme.my, never again before its submit, so a send that starts in between is followed seconds later `lovejoin.ts:6901` · verified **confirmed, low**
- `x4#2` low (user): The sessions runner checks the unlock's wait once, before a step's Minswap and Koios calls: a lock and unlock during them sends the step seconds after the unlock `sessions.ts:3807` · verified **confirmed, low**

*Coverage:* Read in full: background/pending.ts, spent.ts, sent-txs.ts, wallet.ts, runs.ts, collateral.ts, dapp-window.ts, account.ts, storage.ts and private-store.ts's record lists. Read in the parts that cross time: sessions.ts (reset, runAll, settleReturns, markCut, step, act, waits, advance, order, cancel's head, signAndSend, sendRecorded, submit, disconnect, the session-key constants); lovejoin.ts (header and timing constants 1-40 and 1685-1760, withdrawDue/withdrawDueNow 6760-6960, withdrawOne 7540-7760, settleWithdrawing/resends 7820-7912, keepOnReset/adoptKept/cuts/chainsSending, keptMaybe/keptUnsettled, rewardsIn/readRewards, made, publicReady/checked/keep, pumpPublicNow's send loop 5290-5345); dapp.ts (stateChanged, closeWindow, windowClosed, networkChanged, ask, unlocked, fundPrivate, watchFunding, holder/funded, submitTx/send/sentFor/keepSent/settle); handlers.ts (create/restore/reset-wa…

## critic (0 findings, 0 guards)

- none

*Coverage:* 

## fixed-in (0 findings, 0 guards)

- none

*Coverage:* 

## gap-G1 (2 findings, 11 guards)

- `gap-g1#1` medium (stranger): A stranger's payment under a register already on chain (a Seedelf's own, d = 1, or a copied datum) is classed Received, and the stealth mint, every session funding and the private pool start take it first, tying them publicly to that Seedelf and, by the default mint, to the public account `activity.ts:389` · verified **confirmed, medium**
- `gap-g1#2` low (site): A payment the user's own public account, or a private session, makes into the user's Seedelf through a site is classed Received, so the stealth mint and fundings take it as money others paid `dapp.ts:2644` · verified **confirmed, low**

*Coverage:* Read in full: the brief (COMMON.md), INDEX.md and LANES.md; X1a's report, E1a's e1a#1, and the parts of RESUME.md and FIX.md that bear on this lane. Code read in full: - extension/src/shared/histories.ts, background/mint.ts, background/chain.ts, background/contract-scan.ts; - seedelf-crypto/src/register.rs; - seedelf-core/src/build.rs 2290-3100 (Histories, Purpose ranks and tiers, select_script_inputs, one_more, grow, apart, max_inputs_by, holding, the mint builders), plus 320-480 (deposit_output(s), change_outputs), 2085-2175 (remainder, stage) and 3427-3450 (sweep_many_apart); - wasm/src/lib.rs 2080-2480 (ClassIn, histories, origin_of, merged_class, Carried, classes_mixed, MintRequest, check_spendable, mint_spend, build_mint, mint_result) and 3640-3905 (Worth, by_history_first, same_order).  Read in the ranges named or needed: - activity.ts 1-260 (header and types, skimmed past the acc…

## gap-G10 (4 findings, 9 guards)

- `gap-g10#1` low (stranger): A name padded with wide spaces before one last letter passes the lookalike and shared-name checks, and the one-line lists cut it to the name it copies `tokens.ts:116` · verified **confirmed, low**
- `gap-g10#2` low (stranger): Activity cuts a counterparty's address to its first 3 to 10 characters and its last 6, and the last 6 are a bech32 checksum anyone can solve for `Activity.tsx:415` · verified **partly, low**
- `gap-g10#3` low (stranger): The Add tokens picker cuts a lookalike token's warning to "Calls itself SNEK, not on the…" in grey; Home's list shows it whole in amber (H-9), and the swap's picker cuts its mark too `TokenAmounts.tsx:269` · verified **confirmed, low**
- `gap-g10#4` nit (user): Amount boxes on the forms clip their own figures at the side panel's width: a token's box after Max, the swap's two amounts, Send's "Max, up to …" `styles.css:3449`

*Coverage:* Read in full: ui/styles.css (all 4,179 lines; every text-overflow, overflow: hidden, white-space: nowrap or pre, max-width and max-height rule listed by script and checked; there is no line-clamp) and ui/format.ts (all 479 lines). Every place a truncating class sits in components/ and screens/ (found by grep) was read in context: - token-row__label, __amount and __sub; - list__name and list__value; - middle-ellipsis; - review__row--id; - account-picker; - amount and its size classes; - menu-row__sub and menu-row__figure; - modal__title; - swap-card__amount, swap-token and swap-token__name; - amount-box__shown; - pool-name and pool-tile__name; - activity__sub-lead and activity__more; - note-part, chip, swap-tag and timeline__link.  Components read in full: ReviewRows, MiddleEllipsis, TokenAmounts (picker and box), TokenList (TokenRow, TokenDetails, TokenAmountText), RadioCards, AccountRec…

## gap-G2 (4 findings, 17 guards)

- `gap-g2#1` low (user): Mix again from my public account refuses unless one ADA-only UTxO pays for every mix of every box it takes, never takes fewer, and the page offers no count `lovejoin.rs:2495` · verified **confirmed, low**
- `gap-g2#2` low (user): The escape hatch's question names no other account while the account on screen's own boxes are held by a reservation, and the worker then takes another account's box: Pay from my public account ties the two unannounced `Lovejoin.tsx:1128` · verified **partly, low**
- `gap-g2#3` low (stranger): The Mix and Bootstrap forms count public UTxOs the build refuses (any reference script, a datum too deep to read), so 'What Lovejoin can spend' and the stepper offer boxes Review then refuses `Lovejoin.tsx:410` · verified **confirmed, low**
- `gap-g2#4` nit (user): Mix again from my public account's review says 'N boxes your public account put in' where the account has more there, with no 'N of your M' or 'Mix the rest once this is done' `Lovejoin.tsx:4113`

*Coverage:* Read in full: - ui/screens/Lovejoin.tsx, all 4,125 lines. The brief's ranges were read line by line: 1-500, 1045-1660, 2650-3760 and 3790-4125. The hub, MixList and the cards were read at pace. - ui/screens/LovejoinLaunch.tsx and ui/components/ReviewTotals.tsx. - background/: lovejoin-launch.ts, spent.ts, account.ts, coin-control.ts and lovejoin-rewards.ts. - seedelf-core/src/lovejoin/launch.rs.  lovejoin.ts, read in these ranges: - the helpers 1920-2260; - progress 2950-3010 and ours 3318-3350; - againBoxes, funding, chain and fanOut 3470-3910; - unstale through pumpPublicNow 4590-5460, including publicBuild, publicReady, checked, keep, publicAgainBuild, publicSubmit and publicStart; - draw and recordChain's head 5485-5550; - publicUnsettledNow, publicMaybe, cuts, chainsMixing and publicChainsSending 5743-5940; - madeBy, inputsOf, accountKeys, keysOf and status 6140-6510; - withdrawNow …

## gap-G3 (2 findings, 24 guards)

- `gap-g3#2` low (user): A site session's chain whose deposit Koios never answered keeps that deposit as sent for good: its money is hidden two hours, then the rest comes back directly with no word of Lovejoin `sessions.ts:1311` · verified **confirmed, low**
- `gap-g3#1` low (user): Only a withdraw waits after the wallet's own send: the runner's next send goes a minute or less after a box's withdraw, though privacy.md says the way back never lines up with anything else the wallet does `privacy.md:440` · verified **confirmed, low**

*Coverage:* Read in full, every line: - background/spent.ts, pending.ts, wallet.ts, runs.ts, sw.ts. - lovejoin.ts:   - 1-1883: the header, constants, pumpChain, ChainProgress and the types;   - 1882-2211: the helpers to ripeAt;   - 2811-2872: the class fields;   - 2953-3006: progress and lookDue;   - 3600-3909: chain and fanOut;   - 4300-4613: retireOnce's end, the collateral pool helpers, tailOf, tailChain, tailWitness, tailLanded, tailHeld, tailOver and unstale;   - 4614-5450: rewards, reserve and the reservation helpers, crossCheck, publicBuild, publicReady, checked, keep, publicAgainBuild, publicSubmit, publicStart, pumpPublic, publicLook and pumpPublicNow;   - 5450-5884: sendingOf through adoptKept;   - 5884-6523: cuts through status and chains;   - 6560-6760: clearMixes, releaseBootstrap, landedDeposit, rows, inChain, chainTxs, held and returning;   - 6760-7220: withdrawDue and withdrawDueNow,…

## gap-G4 (2 findings, 18 guards)

- `gap-g4#1` medium (user): A split route's leg paid between the runner's two reads of the account comes back alone, in a later return, directly, though its approval sent it through Lovejoin `sessions.ts:3904` · verified **confirmed, low**
- `gap-g4#2` medium (user): Nothing stops a swap Minswap builds from spending the session's 5 ₳ collateral, and then its return leaves out Lovejoin and the collateral's mix (NO_COLLATERAL) `sessions.ts:4170` · verified **confirmed, low**

*Coverage:* **Read in full:**\n- sessions.ts:\n  - 3380-4840: advance, stop, stopCost, resume, runAll, settleReturns, markCut, step, act, noteOrderOpen, waits, ordersSpent, placed, ordersOpen, liveOrders, remnantsFrom, order, cancel, cancelOf, cancelsChecked, referenceRows, bringBack, inspect, review, signAndSend, buildBack, collateralIntoPool.\n  - 4884-5160: throughLovejoin, collateralWanted, lovejoinWantsCollateral, nothingBack, leaveBehind, leftBy, fundingChange, sendBack, noteLanded, refuseParts.\n  - 5170-5270: sendChain's head.\n  - 5621-6000: listNow, view, listing, utxosOf, spentStates, landed.\n  - 6395-6872: spareOf, wayOf, pricedClassic, fillsOf, leftBehindView, chainView, autoView, outcomeOf, paidOut, withinFunding, dexOrderAt, checkOrder, directSpends, checkDirect, checkProceeds, withinNet, refuseOddities.\n  - Helpers 180-300, 880-1110, 1303-1312, 1880-2025 (outBuild).\n- minswap.ts, …

## gap-G5 (1 findings, 19 guards)

- `gap-g5#1` medium (pool-launcher): A pool someone else launched with a box under S0d's least is shown, picked by default and offered with no word, and what comes back from it can't pay part of itself without other money, so spending it undoes the mix `lovejoin-pools.ts:530` · verified **confirmed, low**

*Coverage:* Read in full, every line: - background/lovejoin-pools.ts (687) - ui/lovejoin-pools.ts (182) - background/lovejoin-launch.ts (460) - seedelf-core lovejoin/pool.rs (645), box_value.rs (403) and value.rs (131) - src/lovejoin-pools.json, decoded pool by pool with one python3 -I summary - Lovejoin 29573c5 via git show: one_shot_mint.ak, mix_logic.ak and lib/lovejoin/reference.ak, plus types.ak, value.ak, mixbox.ak, mix_box.ak and reference_holder.ak  Read in the ranges named: - lovejoin.ts: 600-940 (isRetired, adaPoolOf, valuesOf, poolChoice); 2800-3420 (readSet, verifiedPool, unreadCopies, progress, watchOf, poolNamed, cantComeBack, privateBootstrapMost/Bounds, poolsOf, usable, stuck, mixBoxes, listing, poolRows, lookForPools, wouldRead, ours, plan, fits' head); 3905-4000 (acrossOf's token pool choice); 4140-4380 (planAcross, usableNow, takesNewBoxes, adaPool, retiredIds, retireOnce, collate…

## gap-G6 (2 findings, 19 guards)

- `gap-g6#1` low (nobody): Kept verdicts carry no version of the rule that made them, so a fix to what counts as the wallet's never reaches rows and boxes an older release already judged `contract-scan.ts:264` · verified **confirmed, low**
- `gap-g6#2` low (user): After a restore, what made a box is kept with only the accounts then known, so a custom account's (index 24 or more) deposit boxes read as the private balance's for good `lovejoin.ts:6324` · verified **confirmed, low**

*Coverage:* Method: for every chrome.storage.local record (sealed or not), I extracted its types at each tag (web-wallet/1.6.0, 1.7.0, 1.7.1, 1.7.2, 1.8.0, 1.8.1, 1.9.0, 1.9.1) and diffed them against HEAD. I diffed the record-bearing modules tag to tag (lovejoin.ts, sessions.ts, spent.ts, pending.ts, parts.ts, dapp.ts, lovejoin-pools.ts), and handlers.ts, minswap.ts, rpc.ts and core orders.rs since 1.6.0. I mapped sessions.ts's changed hunks since 1.6.0 to their methods and read the record readers among them. For ChainRecord, Withdrawing, SessionRecord, AutoRecord and PRIVATE_RECORDS I also compared 1.0.0, 1.2.0, 1.3.0, 1.4.0 and 1.5.0. I compared every release's local-key writes against reset's list, the bundled pools' head start and token list at every tag, and the history of registerOf, ownedUtxos, register.rs and accountKeys.  Read in full: private-store.ts, vault.ts, storage.ts, storage-access…

## gap-G7 (4 findings, 11 guards)

- `gap-g7#1` low (stranger): A DRep that names itself Always abstain (or Always no confidence, Not delegated, Your own DRep) reads as that choice on the vote review's main row, and in Activity and Delegations afterwards `format.ts:438` · verified **confirmed, low**
- `gap-g7#2` low (user): The wallet's own DRep list ignores CIP-119's doNotList, which the wallet's profile form turns on by default, so a user's DRep that asked directories not to list it is listed by name in every Seedelf Wallet `dreps.mjs:96` · verified **confirmed, low**
- `gap-g7#3` nit (stranger): Activity and Delegations show the bundled DRep names without plainName, which Voting applies to the same entries; the generator keeps bidi and zero-width characters `activity.ts:119`
- `gap-g7#4` nit (nobody): networks.ts's lovejoin.mixCost is read by nothing, and its doc still says it's for the settings' words `networks.ts:20`

*Coverage:* Read in full: networks.ts (203 lines), seedelf-core constants.rs (98), tokens/list.json, registry.preprod.json, scripts/dreps.mjs (131) and scripts/tokens.mjs (127).  Checked by script, every entry: lovejoin-pools.json (each pool's datum decoded and cross-checked); registry.mainnet.json (every field; logos by type and size only, not viewed as images); dreps/mainnet.json and dreps/preprod.json (every ID and name, plus the head read by eye). Scripts: scratch r51/work/gap-G7/g7_pools_check.py and g7_dreps_scan.py, plus inline python -I and node checks.  Followed out of the lane, read in the ranges that matter: - seedelf-core: lovejoin/mod.rs Protocol::of (150-330), eval.rs slot_config and slot_at (240-345), address.rs, transaction.rs collateral_input. - seedelf-koios: koios.rs URL builders (40-90). - wasm: the three network_flag copies, the Network enum, the slotAt export, lovejoin.rs proto…

## gap-G8 (9 findings, 15 guards)

- `gap-g8#1` low (user): Create Seedelf refuses any tag with a character outside printable ASCII (an accent, kana), though the deployed policy takes any bytes and keeps the first 15 `label.ts:10` · verified **confirmed, low**
- `gap-g8#2` low (user): Public Send refuses the user's own Seedelf, alone or among other recipients, though the ledger takes it and core and WebAssembly build it `send.ts:179` · verified **confirmed, low**
- `gap-g8#3` low (user): Send's note is cut to 64 characters and core refuses more, though CIP-20's message holds as many 64-byte lines as fit, which core already splits into `note.rs:49` · verified **confirmed, low**
- `gap-g8#4` low (user): A payment pays at most 20 recipients, on either side, though the ledger takes as many outputs as fit 16 KiB, which core already checks `recipients.ts:7` · verified **confirmed, low**
- `gap-g8#5` low (site): signTx and submitTx refuse a site's transaction whose outer array or body map is written indefinite-length, which the ledger and the WebAssembly decoder both take `cbor.ts:123` · verified **partly, low**
- `gap-g8#6` low (user): A pool's start refuses a box value between the box's own minimum and S0d's least (3.45 ₳ for ADA), though one_shot_mint takes any box over its fee cap, and the wallet shows and mixes into such pools others launch `lovejoin-launch.ts:258` · verified **partly, low**
- `gap-g8#7` low (user): Swaps refuse a slippage outside 0.1% to 20%, though the order is valid at any minimum and the form already warns from 5% `sessions.ts:836` · verified **confirmed, low**
- `gap-g8#8` low (user): A swap into a token that's neither on the wallet's list nor verified by Minswap is refused outright, though the DEX's contracts and the order take any token: a warning would do `sessions.ts:1919` · verified **confirmed, low**
- `gap-g8#9` low (user): A Seedelf mint from the public account fails outright when its largest ADA-only UTxO is past output #255, though a mint whose first input has a smaller index is one the policy takes `build.rs:3898` · verified **known, low**

*Coverage:* **Read in full, line by line:** - extension: background/destination.ts, contacts.ts, send.ts, mint.ts, cbor.ts; shared/label.ts, handles.ts, recipients.ts; ui/screens/CreateSeedelf.tsx. - seedelf-core/src/note.rs. - build.rs, around its refusals: 1-1300, 1500-2340, 2530-2980 and 3040-3922. Not read there: 1300-1500 (budgets and Chain) and 2340-2530 (Histories' ranks).  **Read by refusal, every one found by grep, each with its context read:** - wasm: every bail! in lib.rs (49), cip30.rs (~35) and lovejoin.rs (~20). Read in full around them: lib.rs 170-510, 600-720, 790-830, 1520-1700, 1870-2010, 2060-2145, 2300-2345, 2790-2830, 2965-3075, 3255-3440 and 5010-5030; cip30.rs 280-395, 672-700, 1136-1380, 1490-1525, 1600-1720, 1780-1830, 1940-2110 and 2284-2345; lovejoin.rs 2040-2060, 2190-2310 and 2953-2965. - extension background: every `throw` line listed by grep across the folder (477), wi…

## gap-G9 (2 findings, 14 guards)

- `gap-g9#1` medium (user): With the phrase open in a second profile, every private transaction made there reads here as a payment received, so this profile's session fundings take the other profile's session money first, tie the two sessions on chain and say nothing `activity.ts:445` · verified **confirmed, low**
- `gap-g9#2` low (user): Lovejoin's way-back rules are per profile: with the phrase unlocked in two, each brings back the other's boxes on its own schedule, right after the other's sends and withdraws, oldest first, and over the other's chains `lovejoin.ts:6852` · verified **confirmed, low**

*Coverage:* Read in full, every line: background/spent.ts (248), runs.ts (105), pending.ts (1068) and docs/privacy.md (501).  lovejoin.ts (8048), read line by line: - 1-4850: the header, timing constants, pumpChain, the types and sealed schedule, every helper to withinDepth, the class fields, readSet, progress, onChain, watchOf, poolsOf, listing, poolRows, ours, plan, fits, room(s), againBoxes, funding, chain, fanOut, acrossOf, planAcross, usableNow, takesNewBoxes, adaPool, retireOnce, collateralPool, tailOf, tailChain, tailWitness, unstale, rewards, reserve and its helpers, crossCheck. - 5132-5884: publicSubmit, publicStart, pumpPublic, pumpPublicNow, schedule, scheduleFound, draw, recordChain, chainSent, chainEnded, restBack, the marks, publicUnsettledNow, lookFor, keptMaybe, keepOnReset, adoptKept. - 5884-6420: cuts, chainsSending, sortOut, found, made, lookUp, madeBy, inputsOf, accountKeys, keys…

## lead (1 findings, 0 guards)

- `lead#1` medium (stranger): A session's collateral tail takes the first 5 ₳ that fits the collateral rule, whoever's it is, so a stranger's plain 5 ₳ listed first is boxed and the session's own collateral comes back unmixed `lovejoin.rs:0` · verified **refuted, nit**

*Coverage:* One lead, not a lane.

## status (0 findings, 0 guards)

- none

*Coverage:* 
