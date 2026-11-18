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

## gap-G1 (2 findings, 11 guards)

- `gap-g1#1` medium (stranger): A stranger's payment under a register already on chain (a Seedelf's own, d = 1, or a copied datum) is classed Received, and the stealth mint, every session funding and the private pool start take it first, tying them publicly to that Seedelf and, by the default mint, to the public account `activity.ts:389` · verified **confirmed, low**
- `gap-g1#2` low (site): A payment the user's own public account, or a private session, makes into the user's Seedelf through a site is classed Received, so the stealth mint and fundings take it as money others paid `dapp.ts:2644` · verified **confirmed, low**

*Coverage:* Read in full: the brief (COMMON.md), INDEX.md and LANES.md; X1a's report, E1a's e1a#1, and the parts of RESUME.md and FIX.md that bear on this lane. Code read in full: - extension/src/shared/histories.ts, background/mint.ts, background/chain.ts, background/contract-scan.ts; - seedelf-crypto/src/register.rs; - seedelf-core/src/build.rs 2290-3100 (Histories, Purpose ranks and tiers, select_script_inputs, one_more, grow, apart, max_inputs_by, holding, the mint builders), plus 320-480 (deposit_output(s), change_outputs), 2085-2175 (remainder, stage) and 3427-3450 (sweep_many_apart); - wasm/src/lib.rs 2080-2480 (ClassIn, histories, origin_of, merged_class, Carried, classes_mixed, MintRequest, check_spendable, mint_spend, build_mint, mint_result) and 3640-3905 (Worth, by_history_first, same_order).  Read in the ranges named or needed: - activity.ts 1-260 (header and types, skimmed past the acc…

## gap-G10 (4 findings, 9 guards)

- `gap-g10#1` low (stranger): A name padded with wide spaces before one last letter passes the lookalike and shared-name checks, and the one-line lists cut it to the name it copies `tokens.ts:116`
- `gap-g10#2` low (stranger): Activity cuts a counterparty's address to its first 3 to 10 characters and its last 6, and the last 6 are a bech32 checksum anyone can solve for `Activity.tsx:415`
- `gap-g10#3` low (stranger): The Add tokens picker cuts a lookalike token's warning to "Calls itself SNEK, not on the…" in grey; Home's list shows it whole in amber (H-9), and the swap's picker cuts its mark too `TokenAmounts.tsx:269`
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

- `gap-g6#1` low (nobody): Kept verdicts carry no version of the rule that made them, so a fix to what counts as the wallet's never reaches rows and boxes an older release already judged `contract-scan.ts:264`
- `gap-g6#2` low (user): After a restore, what made a box is kept with only the accounts then known, so a custom account's (index 24 or more) deposit boxes read as the private balance's for good `lovejoin.ts:6324`

*Coverage:* Method: for every chrome.storage.local record (sealed or not), I extracted its types at each tag (web-wallet/1.6.0, 1.7.0, 1.7.1, 1.7.2, 1.8.0, 1.8.1, 1.9.0, 1.9.1) and diffed them against HEAD. I diffed the record-bearing modules tag to tag (lovejoin.ts, sessions.ts, spent.ts, pending.ts, parts.ts, dapp.ts, lovejoin-pools.ts), and handlers.ts, minswap.ts, rpc.ts and core orders.rs since 1.6.0. I mapped sessions.ts's changed hunks since 1.6.0 to their methods and read the record readers among them. For ChainRecord, Withdrawing, SessionRecord, AutoRecord and PRIVATE_RECORDS I also compared 1.0.0, 1.2.0, 1.3.0, 1.4.0 and 1.5.0. I compared every release's local-key writes against reset's list, the bundled pools' head start and token list at every tag, and the history of registerOf, ownedUtxos, register.rs and accountKeys.  Read in full: private-store.ts, vault.ts, storage.ts, storage-access…

## gap-G7 (4 findings, 11 guards)

- `gap-g7#1` low (stranger): A DRep that names itself Always abstain (or Always no confidence, Not delegated, Your own DRep) reads as that choice on the vote review's main row, and in Activity and Delegations afterwards `format.ts:438`
- `gap-g7#2` low (user): The wallet's own DRep list ignores CIP-119's doNotList, which the wallet's profile form turns on by default, so a user's DRep that asked directories not to list it is listed by name in every Seedelf Wallet `dreps.mjs:96`
- `gap-g7#3` nit (stranger): Activity and Delegations show the bundled DRep names without plainName, which Voting applies to the same entries; the generator keeps bidi and zero-width characters `activity.ts:119`
- `gap-g7#4` nit (nobody): networks.ts's lovejoin.mixCost is read by nothing, and its doc still says it's for the settings' words `networks.ts:20`

*Coverage:* Read in full: networks.ts (203 lines), seedelf-core constants.rs (98), tokens/list.json, registry.preprod.json, scripts/dreps.mjs (131) and scripts/tokens.mjs (127).  Checked by script, every entry: lovejoin-pools.json (each pool's datum decoded and cross-checked); registry.mainnet.json (every field; logos by type and size only, not viewed as images); dreps/mainnet.json and dreps/preprod.json (every ID and name, plus the head read by eye). Scripts: scratch r51/work/gap-G7/g7_pools_check.py and g7_dreps_scan.py, plus inline python -I and node checks.  Followed out of the lane, read in the ranges that matter: - seedelf-core: lovejoin/mod.rs Protocol::of (150-330), eval.rs slot_config and slot_at (240-345), address.rs, transaction.rs collateral_input. - seedelf-koios: koios.rs URL builders (40-90). - wasm: the three network_flag copies, the Network enum, the slotAt export, lovejoin.rs proto…

## gap-G8 (9 findings, 15 guards)

- `gap-g8#1` low (user): Create Seedelf refuses any tag with a character outside printable ASCII (an accent, kana), though the deployed policy takes any bytes and keeps the first 15 `label.ts:10`
- `gap-g8#2` low (user): Public Send refuses the user's own Seedelf, alone or among other recipients, though the ledger takes it and core and WebAssembly build it `send.ts:179`
- `gap-g8#3` low (user): Send's note is cut to 64 characters and core refuses more, though CIP-20's message holds as many 64-byte lines as fit, which core already splits into `note.rs:49`
- `gap-g8#4` low (user): A payment pays at most 20 recipients, on either side, though the ledger takes as many outputs as fit 16 KiB, which core already checks `recipients.ts:7`
- `gap-g8#5` low (site): signTx and submitTx refuse a site's transaction whose outer array or body map is written indefinite-length, which the ledger and the WebAssembly decoder both take `cbor.ts:123`
- `gap-g8#6` low (user): A pool's start refuses a box value between the box's own minimum and S0d's least (3.45 ₳ for ADA), though one_shot_mint takes any box over its fee cap, and the wallet shows and mixes into such pools others launch `lovejoin-launch.ts:258`
- `gap-g8#7` low (user): Swaps refuse a slippage outside 0.1% to 20%, though the order is valid at any minimum and the form already warns from 5% `sessions.ts:836`
- `gap-g8#8` low (user): A swap into a token that's neither on the wallet's list nor verified by Minswap is refused outright, though the DEX's contracts and the order take any token: a warning would do `sessions.ts:1919`
- `gap-g8#9` low (user): A Seedelf mint from the public account fails outright when its largest ADA-only UTxO is past output #255, though a mint whose first input has a smaller index is one the policy takes `build.rs:3898`

*Coverage:* **Read in full, line by line:** - extension: background/destination.ts, contacts.ts, send.ts, mint.ts, cbor.ts; shared/label.ts, handles.ts, recipients.ts; ui/screens/CreateSeedelf.tsx. - seedelf-core/src/note.rs. - build.rs, around its refusals: 1-1300, 1500-2340, 2530-2980 and 3040-3922. Not read there: 1300-1500 (budgets and Chain) and 2340-2530 (Histories' ranks).  **Read by refusal, every one found by grep, each with its context read:** - wasm: every bail! in lib.rs (49), cip30.rs (~35) and lovejoin.rs (~20). Read in full around them: lib.rs 170-510, 600-720, 790-830, 1520-1700, 1870-2010, 2060-2145, 2300-2345, 2790-2830, 2965-3075, 3255-3440 and 5010-5030; cip30.rs 280-395, 672-700, 1136-1380, 1490-1525, 1600-1720, 1780-1830, 1940-2110 and 2284-2345; lovejoin.rs 2040-2060, 2190-2310 and 2953-2965. - extension background: every `throw` line listed by grep across the folder (477), wi…

## gap-G9 (2 findings, 14 guards)

- `gap-g9#1` medium (user): With the phrase open in a second profile, every private transaction made there reads here as a payment received, so this profile's session fundings take the other profile's session money first, tie the two sessions on chain and say nothing `activity.ts:445`
- `gap-g9#2` low (user): Lovejoin's way-back rules are per profile: with the phrase unlocked in two, each brings back the other's boxes on its own schedule, right after the other's sends and withdraws, oldest first, and over the other's chains `lovejoin.ts:6852`

*Coverage:* Read in full, every line: background/spent.ts (248), runs.ts (105), pending.ts (1068) and docs/privacy.md (501).  lovejoin.ts (8048), read line by line: - 1-4850: the header, timing constants, pumpChain, the types and sealed schedule, every helper to withinDepth, the class fields, readSet, progress, onChain, watchOf, poolsOf, listing, poolRows, ours, plan, fits, room(s), againBoxes, funding, chain, fanOut, acrossOf, planAcross, usableNow, takesNewBoxes, adaPool, retireOnce, collateralPool, tailOf, tailChain, tailWitness, unstale, rewards, reserve and its helpers, crossCheck. - 5132-5884: publicSubmit, publicStart, pumpPublic, pumpPublicNow, schedule, scheduleFound, draw, recordChain, chainSent, chainEnded, restBack, the marks, publicUnsettledNow, lookFor, keptMaybe, keepOnReset, adoptKept. - 5884-6420: cuts, chainsSending, sortOut, found, made, lookUp, madeBy, inputsOf, accountKeys, keys…
