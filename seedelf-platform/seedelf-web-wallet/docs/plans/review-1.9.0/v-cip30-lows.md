# 1.9.0's release review: the v-cip30-lows verifier

The verification, told to refute. Verbatim from its structured report; full addresses of third parties shortened.

## Coverage

Read at 8d7c4b0c: COMMON.md; the claims file; PR #373's body (gh pr view 373 --json body, saved as pr373-body.md). In cip30.rs: inspect (1138-1925), released_from_contracts, datum_names_key, Keys, KoiosRow, MAX_TX_BYTES and sign_tx. Also #373's tests in cip30_test.rs (2130-2440); ui/dapp.ts releasesContractFunds; DappApprovals.tsx SignTx (998-1320); the en.json strings. In background/dapp.ts: readTx, resolve, remember, keepSent, txBytes, MAX_SITE_BYTES and the per-site limits. In sessions.ts: siteAccount, refuseOddities and stakeSigns. Also koios.ts utxoInfo; seedelf-core orders.rs integrity_hash and orders_test.rs:455; architecture.md:555-569; flows.md:430; the data layer's route list. In the local cardano-ledger checkout ledger-54e24ba4 (read only): Alonzo Tx.hs, Rules/Utxow.hs and UTxO.hs; Babbage Rules/Utxow.hs, Rules/Utxo.hs and UTxO.hs; Conway Rules/Utxow.hs, Rules/Ledger.hs, UTxO.hs, TxInfo.hs and conway.cddl.

Ran, all in my own worktree at 8d7c4b0c (now removed with git worktree remove --force, after unlinking the node_modules symlink; the main tree is clean and still at 8d7c4b0c). Every Rust run used CARGO_TARGET_DIR=$HOME/.cache/seedelf-review-1.9.0/target-v-cip30-lows, -j 4 and MemoryMax=8G.
(1) The finder's probes: r1, r2, r4 and r10, then all 20 for comparisons, and r17 --release four times.
(2) The critic's probes: 11 passed, and p8-p11 print what the claims file says.
(3) My v_cip30_lows_test.rs: 13 tests plus 2 ignored timing ones, logged in v-probes-shipped.log.
(4) Three scratch mutants of cip30.rs (burn credit naive and refined, uncarried datum, memoised scan). Each ran against cip30_test, where all 65 pass, and against the finder's suite, diffed.
(5) A Vitest render, tests/v-cip30-lows.test.ts, of 11 windows. Each request is read by the main tree's built wasm (sha256 96b450a4…, copied) and rendered through SignTx. Output in v-render.txt.
(6) WebAssembly timing under Node v24.19.0 (timing/time-wasm.mjs).
(7) One Koios request: tx_cbor for 3 mainnet order placements, saved in koios/ as data.

Not done:
- No Playwright or e2e run, no es/ja rendering, no live preprod run.
- The full script-data-hash check with redeemers (cost models) wasn't prototyped. Only its no-redeemer form was checked on real transactions.
- I didn't survey real dApps for whether they show the wallet a complete witness set.
- I didn't check whether the connector's path has the cost models at hand.

Asides I noticed but didn't check:
- An 880-input request makes utxoInfo send one request per 60 outpoints (koios.ts:445, 825-832), so 15 Koios or data-layer requests per read.
- The fee row says "0.2 ₳, counted in the total" when the account has an input even though the contract paid the fee (v2 render). This predates #373.

The cargo target is left in place.

## Verdicts

### cip30-rust#2: confirmed, low (confirmed-by-run)

**Why.** The claim holds.

The native clause is `contract_inputs > 0 && body.script_data_hash.is_none()` (cip30.rs:1838). The site sets the body's hash, and a supplemental datum alone makes the ledger require it: no Plutus and no collateral are needed. In the ledger checkout ledger-54e24ba4:
- mkScriptIntegrity returns SNothing only when redeemers, language views and datums are all empty (eras/alonzo/.../Alonzo/Tx.hs:466-471).
- checkScriptIntegrityHash needs the supplied hash to equal the computed one (Alonzo/Rules/Utxow.hs:285-298).
- A witness datum whose hash is on an output or a reference input is allowed: missingRequiredDatums (Alonzo/Rules/Utxow.hs:231-246) and getBabbageSupplementalDataHashes (Babbage/UTxO.hs:79-84). Conway uses both (Conway/UTxO.hs:137; Conway/Rules/Utxow.hs:209 runs Babbage's transition; Babbage/Rules/Utxow.hs:372, 376, 404).
- Collateral is needed only with redeemers (Babbage/Rules/Utxo.hs:209).

On chain, 4 distinct real transactions carry datums and a script data hash with no redeemer: Minswap V1, SundaeSwap V1 and WingRiders V1 order placements on mainnet, and a Minswap swap on preprod. Each one's hash is blake2b-256(A0‖datums‖A0). The code says the same at cip30.rs:1774-1775: "A script data hash alone only covers datums in the witness set, as a DEX order's is: nothing runs."

Two more ways in: a reference input's datum works as well as an output's, and a sig(stake) vault spent through a zero withdrawal behaves the same.

Grade: low, not medium. The documented limit already gives every site a way past this clause: also run Plutus, for example by spending its own always-true UTxO. The datum is only a cheaper way in. What's wrong is the doc's stated trigger and the test's premise (cip30_test.rs:2410: "With the hash, a script runs"). Native vaults that only the user's key unlocks are also rare.

**Evidence.** Re-ran the finder's r1 (`cargo test -j 4 -p seedelf-wasm --test review_cip30_rust_test r1_`):
- "native alone: key_releases=true released=49800000 -> warning (contractMaybe) + rows + switch"
- "native + datum: key_releases=false released=49800000 -> neutral note only"

My v_cip30_lows_test.rs:
- v2a with the real hash (datums field d9010281d87980, hash 264ea21d…4a1f): with no hash, key_releases=true. With the real hash, whether the datum is withheld or shown, key_releases=false and scripts=false.
- v2b, a reference input instead of an output datum: key_releases=false.
- v2c, a sig(stake) vault through a zero withdrawal: no hash true, hash false.
- v2d, over every fixture plus Koios tx_cbor for 74db9b06…, 5ca5794c… and cafd8357…: "transactions read: 57; with redeemers: 34; hash and no redeemer: 5; [A0|datums|A0] matched: 5".

Rendered through the built wasm and SignTx (v2-native-hash): "Total coming into your public account 0 ₳ … It signs for 1 of your addresses Pays … An address, with data 49.8 ₳ It spends 1 contract UTxO holding 50 ₳." No warning, and releasesContractFunds is false. Without the hash, the same body gets the warning and the switch.

**Documented.** architecture.md:563: "That note is all there is for what the wallet can't tie to the account's key: a position released by a token the account holds, a native script's input in a transaction that also runs Plutus, and …".

PR #373 body, Known limits: "A native script's input in a transaction that also runs Plutus."

So the bypass is stated and accepted in substance, since a site can always also run Plutus. The trigger is stated wrongly: the code's trigger is any script data hash.

**The fix.** The script-type lookup needs a new request:
- The wallet never calls Koios script_info, and the data layer has no such route (seedelf-data/api/src/public/mod.rs:45-77). So it means a data-layer change and deploy, plus a dated privacy-policy Changes entry.
- A script never seen on chain, such as a native vault's first spend, has no type there, so the fix would still need a rule for "unknown".
- It refuses nothing.

Data the wallet already has doesn't tell native from Plutus:
- The address: no. It carries only the script hash, and the language tag is inside the hash.
- The row's reference_script: no. It's the script the UTxO carries for others to use, not the script that locks it. cip30.rs's KoiosRow doesn't even read it (cip30.rs:46-59).

What does tell, with no request, is the body's signed script data hash, checked against the witness set the wallet is shown:
- With no redeemer, the hash is blake2b-256(A0‖datums‖A0) and needs no parameters. It matched all 5 transactions above. A match proves nothing runs Plutus, so every contract input is a native script's.
- With redeemers, seedelf-core's orders::integrity_hash (orders.rs:1374, already checked against real V1-V3 cancels in orders_test.rs:455) plus the cost models would authenticate the redeemer set. A script input with no Spend redeemer can only be native (hasExactSetOfRedeemers, Babbage/Rules/Utxow.hs:376). That would also close the documented "also runs Plutus" limit.
- A witness set that doesn't verify is one the site will change after signing, so its contract inputs read as key-released.

I only prototyped the no-redeemer form. The cost is the switch for a dApp that shows an incomplete witness set; it never refuses.

The docs-only fix ("any transaction with a script data hash, which a site can always add") is right and safe.

### cip30-rust#3: confirmed, low (confirmed-by-run)

**Why.** The claim holds.

released_from_contracts counts each contract token against what reaches the account only (cip30.rs:1116-1128). The burn map (cip30.rs:1758-1766) feeds only the mint row (cip30.rs:1767). So an honest close that burns its position token gets the release row, the warning and the switch, while the mint row shows the same token burnt. This close isn't in the PR's list of honest requests that also warn.

Low: an honest flow gets a misleading row and one extra switch, and nothing is refused.

**Evidence.** Re-ran r10: "close, token burnt: released=0 tokens=[\"1\"] mint=[\"-1\"] -> warning (contractYours) + rows + switch".

Rendered through the built wasm (v3-close): "Total coming into your public account 49.8 ₳ Leaves a contract, not to you 1 cdp … Network fee 0.2 ₳ … It signs for 1 of your addresses Your signature releases your own order or listing from a contract. It doesn't come back to you. Burns 1 cdp … It runs smart contracts." mustAck is true.

So yes, the burn is already shown in the mint row ("Burns 1 cdp"), right beside a row saying the same token "Leaves a contract, not to you".

**Documented.** Nowhere. The PR body's "Honest requests that also get the warning and the switch" lists only repricing a listing and a net spender repaying a loan.

**The fix.** The fix as stated isn't safe, and "Nothing a site can gain is hidden by this" doesn't hold.

Tested as a mutant (V_BURN_FIX=naive, gone minus burn; v3-burn-modes.log):
- (a) The honest close goes quiet, as intended.
- (b) The user's order holds 100 of a token the site can burn. The site takes those 100 and burns 100 of its own from a key-address input of its own. Result: "released_tokens=[] … -> neutral note only". The site gains nothing net in that token, unless it can mint it freely, in which case the taking costs it nothing.
- (c) The account burns 5 of its own units of the token (shown as "Sends 5" and "Burns 5") while the order's 1 unit goes to the site. Result: "-> neutral note only". That hides a real gain for the site. It needs the token's policy to allow that burn, for example a receipt token the site issued.

Tokens are fungible, so the wallet can't tell that a burn comes from the contract.

The safe version (V_BURN_FIX=refined): credit the burn only beyond what the account's net put-in and the found strangers' inputs hold of that asset, and give no credit at all when an input couldn't be found.
- (a) stays quiet; (b), (c) and (d) all warn.
- The PR's 65 cip30_test tests pass. Of the finder's 20 probes, only r10 changes.
- It needs no request, refuses nothing, and the mint row keeps showing the burn.

### cip30-rust#4: partly, low (confirmed-by-run)

**Why.** The code path and the window text are as claimed. The finder's scenario can't happen, and the critic's narrowing holds.

Confirmed:
- With only the stake key signing, inspect lets an unfound input through. The refusal covers payment and DRep keys only (cip30.rs:1792-1806).
- An unfound contract input never reaches contract_held (cip30.rs:1273).
- A stake-key required signer sets keyReleases with nothing released, so releasesContractFunds is false (ui/dapp.ts:33-35).
- With the payment key in the transaction, it's refused before any window.

Refuted: "The wallet's own session swaps name the session's stake key … A site spends such an order."
- A site's holder is always a site session: sessions.ts:2614 has `if (!s.site) throw`, and sessions.ts:498-499 says "A site's private session … rather than a swap".
- The stake key that signs for a site is that session's own (dapp.ts:2058: `stakeIndex: holder?.index ?? 0`).
- So a swap session's order, owned by 2/j, leaves the site's session nothing to sign. My probe gives signs=[], and the worker refuses with dapp.nothingToSign (dapp.ts:2085-2087).

Narrowed: every output of a transaction the wallet signs for the account is kept for 20 minutes (dapp.ts:2464-2476, read at 1804-1806). So an order placed through the connector is found and does warn. That's the critic's narrowing, with one detail: signed transactions are kept per account, and only site-sent ones per origin.

What's left: an order naming the public account's stake key, made outside this wallet (for example, in another wallet restored from the same phrase, through Minswap's aggregator, which per chunk 24 names the stake key for SundaeSwap V3/V4), and spent in the seconds before Koios or the data layer lists it.

Low: misleading text in a narrow, timed edge case.

**Evidence.** Probes:
- "v4 order unknown: contract_inputs=0 released_lovelace=0 key_releases=true signs=[\"stake\"] unknown=1 -> nothing"
- "v4 order found: … released_lovelace=49800000 released_tokens=[\"1\"] -> warning (contractMaybe) + rows + switch"
- "v4 with the payment key too: refused: This transaction spends a UTxO the wallet can't find yet (2222…#0)…"
- In a session (one-time account 0x5EED, keys 0/1, stake index 1), the same results.
- "v4 site session 1, swap session 2's order: … signs=[]"

The window, rendered from the built wasm through SignTx with partialSign (v4-unknown), reads exactly:
"Total coming into your public account 0 ₳ | Network fee 0.2 ₳ | Expires 20 Aug 2025, 02:47 | It signs for your staking | Pays addr_test1qzpj…wq0kl2 An address 52.8 ₳ 1 test (Not on the wallet's list, asset1pzd3…uptwqm.) | It runs smart contracts. | You sign your part only. Others sign too before it's sent. | It spends 1 UTxO the wallet couldn't find, so what it holds can't be shown. Only your stake key signs here. | Signing ties this transaction to your public account. | Transaction details"

There's no contract row, warning, note or switch (mustAck false). The unknown-input callout is warn-toned.

In a site's session, the first and last lines read "Total coming into your private session 0 ₳" and "Signing ties this transaction to the session's one-time account."

The found variant shows "Leaves a contract, not to you 49.8 ₳", "Leaves a contract, not to you 1 test" and "Your signature helps release funds from a contract…", and mustAck is true.

**Documented.** architecture.md:567: "The stake key's still signs over those (chunk 29): no wallet hands out or pays an address paid to its hash, so a UTxO there the wallet can't find is one its data source left out." That covers a UTxO at the stake key's own address, not a contract whose script asks for the stake key.

architecture.md:563 says inspect "reads each contract input it found".

The sentence "Only your stake key signs here" predates #373 (commit 7cc3f363).

**The fix.** The finder's fix is right and safe.
- "keyReleases && unknownInputs" is never set in chunk 29's honest case: a site's delegation paid from an unlisted UTxO has the stake key sign through the certificate, with no required signer and no found contract input. So that window is unchanged.
- It adds a warning and the switch, refuses nothing, and needs no request.
- It's a new user-facing string, so it needs a .warn. key with es/ja back-translated.

Dropping the sentence on its own is the smaller fix, and also safe.

### cip30-rust#5: confirmed, nit (confirmed-by-run)

**Why.** The mechanism and the size hold:
- The scan runs once per found contract input: `|=` always calls it (cip30.rs:1270).
- Each run slides a 28-byte window with a map lookup at every position (cip30.rs:1093-1096).
- The module is built at opt-level "z" (seedelf-platform/Cargo.toml:37-42) and runs synchronously in the worker.
- sign_tx runs inspect again (cip30.rs:1947-1952).

Timing: natively on this machine it's about 0.45 s, not a second; the finder's 1.02 s was on a loaded machine. In the built WebAssembly it's about 0.85-0.9 s per read, and 1.7-1.8 s per approved request.

But the transaction is 62.8 KB, and the ledger's max_tx_size is 16,384 bytes (epoch 658's parameters; sent-txs.ts:45 says the same). It can never go on chain.

Yes, the wallet reads transactions larger than 16 KiB, on purpose: cip30.rs:525-529 says "four times the ledger's limit today (16 KiB), so a raise of it breaks no site" (also dapp.ts:214 and 2868-2877). The cost grows with the square of the size: the same shape kept to 16,159 bytes costs about 70 ms in wasm.

So what a site gets is its own window opening about 0.9 s late and its own Sign taking as long, with the worker busy meanwhile. At most 5 requests wait per site (dapp.ts:202), and the site parks about 880 ₳ of its own in UTxOs to do it. Nothing is lost or misstated. That's a site freezing its own window: nit.

**Evidence.** r17 --release, 4 runs: "with the datum: 446.7ms / 459.2ms / 410.8ms / 452.2ms, without: 8.8-9.1ms".

v5 --release:
- "v5-16k: tx 16159 bytes, 215 inputs x 8000 datum bytes: with the datum 40.98ms, without 8.90ms"
- "v5-62k: tx 62788 bytes … with the datum 481.6ms, without 9.9ms"

WebAssembly (the main tree's wasm/pkg, sha256 96b450a4…, Node v24.19.0, timing/time-wasm.mjs):
- "large-with-datum tx 62807 bytes": inspect 875 / 840 / 835 ms, sign 833 / 858 / 833 ms.
- "large-without-datum": inspect 20 / 6 ms, sign 9 / 6 ms.
- "v5-16k": inspect 76 / 65 / 71 ms, sign 69 / 64 / 64 ms.
- "v5-62k": inspect 914 / 892 ms, sign 912 / 894 ms.

These match the critic's 837 / 828 ms with the datum and 23 / 7 ms without.

**Documented.** cip30.rs:526-528: "Reading checks every register datum's points, about a millisecond each, so this keeps a read well under a second." The datum scan isn't budgeted anywhere. architecture.md:565 states only the 64 KiB cap.

**The fix.** Right and safe. I prototyped it: scan each distinct datum's bytes once, and skip the scan once names_key is set.
- The PR's 65 cip30_test tests pass.
- The finder's 20 probes print the same output.
- The 62,788-byte case drops from about 480 ms to 15 ms natively (9 ms with no datum).

Same answers, no request, nothing refused. Capping reads at the ledger's current limit would also cut the cost about 13×, but it goes against the owner's stated headroom. The memo is enough.

### cip30-rust#6: confirmed, low (confirmed-by-run)

**Why.** The claim holds.

The fee credit is min(fee, 10 ₳) less what the account put out (cip30.rs:1101, 1133). So a contract holding up to 10 ₳, burnt whole as fee under the account's key, reads as released 0: only the note and the fee row show.

Above 10 ₳ the warning does show, but it understates by 10 ₳: 15 ₳ burnt reads "Leaves a contract, not to you 5 ₳", with a 15 ₳ fee row. The PR body's "a contract burned as fee still warns" holds only past 10 ₳.

Low: each burn needs its own signature, the fee row shows the unusual fee, and the fee goes to the reward pot, so nobody gains. It's an edge case plus an overstated line in the PR body.

The cap itself is sound. Epoch 658's mainnet parameters give a largest possible fee of 0.876 ₳ (size) + 1.673 ₳ (execution units) + 6.336 ₳ (200 KiB of reference scripts), about 8.9 ₳.

**Evidence.** Re-ran r4: "fee 5 ₳ from a 5 ₳ order: released=0 -> neutral note only".

v6 (contract held / fee):
- 5 / 5 ₳: released 0, note only.
- 10 / 10 ₳: released 0, note only.
- 10.000001 / 10.000001 ₳: 1 lovelace, warning.
- 15 / 15 ₳: 5000000, warning.
- 50 / 2 ₳, with 48 ₳ to a stranger: 48000000, warning.

Rendered:
- v6-fee-5: "Total coming into your public account 0 ₳ Network fee 5 ₳ … It signs for 1 of your addresses It spends 1 contract UTxO holding 5 ₳." No switch.
- v6-fee-15: "Leaves a contract, not to you 5 ₳ Network fee 15 ₳ … Your signature helps release funds from a contract…" Switch on.

**Documented.** PR #373 body: "The fee comes off what's released only up to 10 ₳, so a contract burned as fee still warns."

cip30.rs:1099-1100: "…well over what the largest transaction costs. A fee can be set to anything, and a contract's money burned that way is still gone."

architecture.md:563 says nothing of the fee credit or its cap.

**The fix.** Fix 1 (accept it and say so in architecture.md) is right and safe.

Fix 2 buys little:
- The size and execution-unit part of a fee is at most about 2.55 ₳.
- Reference-script fees can reach about 6.3 ₳, and the wallet can't size them without looking up reference inputs, which would be a new request.
- So with any reference input it must allow about 8.9 ₳, and a site that wants to burn just adds one.
- It would also need the protocol parameters passed into inspect. That's no new request, since the wallet already reads epoch_params.

Neither fix refuses anything.

### critic#1: confirmed, nit (confirmed-by-run)

**Why.** The claim holds.

key_releases has exactly those three sources (cip30.rs:1832-1838). And yes, a Plutus script sees more than required signers:
- V1 and V2 get txInfoWdrl and txInfoDCert; V3 gets txInfoWdrl, txInfoTxCerts and txInfoVotes (Conway/TxInfo.hs:445-446, 484-485, 527-534).
- A key credential's withdrawal, most certificates and a DRep key's vote each need that key's witness, so each can serve as an owner's proof.
- The code comment "A required signer is what a Plutus script can see" (cip30.rs:1827) understates in the same way.

No: architecture.md's limits name no proof other than the owner's input.

On chain, the withdrawal route needs the stake key registered, an empty reward balance (Conway withdraws only the whole balance) and, for a key credential, a DRep delegation (validateWithdrawalsDelegated, Conway/Rules/Ledger.hs:483-498, applied after bootstrap, :394-395). The delegation route needs the key registered.

With an inline datum naming the key, the window does warn (p11), so the gap is only a datum kept by hash and withheld. Known key-owner contracts check signatories: nit.

**Evidence.** The critic's p8-p11 re-ran with identical output.

Rendered (v7-withdrawal): "Total coming into your public account 0 ₳ Network fee 0.2 ₳ … It signs for your staking Pays … An address 49.8 ₳ 1 test … Withdraws your staking rewards, 0 ₳, into your public account. It runs smart contracts. It spends 1 contract UTxO holding 50 ₳ and tokens. You sign your part only. …" No warning and no switch.

v7-delegation shows the same, with "Stakes with pool1242…xxqj2t." in place of the withdrawal line.

**Documented.** architecture.md:563 lists only "a contract taking the owner's input as its proof whose datum is kept by hash and left out". PR #373 body: "A contract that takes the owner's input as proof, with its datum kept by hash and withheld." Nothing names a withdrawal, a certificate or a vote.

**The fix.** Widening the doc line is right and safe.

A code fix needs no request either. A contract input whose datum is kept by hash, and isn't in the witness set the wallet is shown, can only be completed after signing, or is a native script's: the ledger requires that datum for any Plutus-locked input (Alonzo/UTxO.hs:274-275 with missingRequiredDatums, Alonzo/Rules/Utxow.hs:231-246). Counting such an input as key-released covers the documented owner-input limit and every proof here at once.

Prototyped:
- p8, p9 and p10 flip to key_releases=true.
- The PR's 65 tests pass, and the finder's 20 probes print the same output.
- The only cost: a dApp that shows the wallet a transaction without its datums gets the switch.
- It refuses nothing.

### dispute: the mutants lane's checked_ok on a native input beside a script data hash: confirmed, none (confirmed-by-run)

**Why.** The critic is right.

The mutants line is right on the facts: only the note shows, key_releases is false, and 50 ₳ is released. It's wrong to call that the documented limit. The doc's trigger is "a transaction that also runs Plutus". The code's trigger is a body with any script data hash, and a datum alone gives one. The evidence is under cip30-rust#2: the ledger rules, the 5 real transactions, and the code's own comment at cip30.rs:1774-1775.

It changes no grade. The doc already lets a site add Plutus, so this is cip30-rust#2's doc line (low), not a separate hole.

The line's side remark, that a single-key native script (ScriptPubkey) could be matched from the key with no request, is plausible (blake2b-224 over 0x00 and the script's CBOR [0, key]). I didn't run it. A vault with a time lock can't be matched that way.

**Evidence.** v2a, v2b and v2c, and the finder's r1, as quoted under cip30-rust#2.

The mutants line (find-full.txt:985): "A native-script UTxO unlocked by the account's key, spent in a body that also has a script data hash, gets only the note … This matches the limitation architecture.md:563 documents ('a native script's input in a transaction that also runs Plutus')."

**Documented.** architecture.md:563 and the PR #373 body both say "a transaction that also runs Plutus".

**The fix.** Settle it as cip30-rust#2's doc fix: name the trigger as any script data hash, which a site can always add with a datum alone. The no-request hash check under cip30-rust#2 would make the clause hold regardless.

