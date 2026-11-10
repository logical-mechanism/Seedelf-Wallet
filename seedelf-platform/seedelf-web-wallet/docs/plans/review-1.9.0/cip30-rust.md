# 1.9.0's release review: the cip30-rust lane's report

Round one, a finder. Verbatim from its structured report; full addresses of third parties shortened.

## Coverage

Read in full: inspect and every helper it calls in seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs, including Amount, Keys, owner, output_parts, the certificate, withdrawal, proposal and vote loops, released_from_contracts, datum_names_key, at_script, the carried map, key_releases and the summary. Also read: #373's diffs of cip30.rs and wasm/tests/cip30_test.rs; the TS code that consumes the new fields (dapp.ts releasesContractFunds; DappApprovals.tsx's rows, callout, switch and note; rpc.ts; the en.json strings); the worker's resolve() and koios.ts utxoInfo/trimmed; seedelf-data's utxo_info row shape; Pallas 0.35's Set, NonEmptySet, KeepRaw and MintedTx decoders; and the ledger's mkScriptIntegrity and supplemental-datum rules, in the local cardano-ledger checkout (ledger-54e24ba4) left by 1.8.1's review.

Ran: `cd seedelf-platform && CARGO_TARGET_DIR=$HOME/.cache/seedelf-review-1.9.0/target systemd-run --user --scope -p MemoryMax=8G -- cargo test -j 4 -p seedelf-wasm --test cip30_test`. Result: ok, 65 passed, 0 failed, 13.54 s.

Also ran 21 probes of my own, r1 to r21, in a worktree at 8d7c4b0c with its own target ($HOME/.cache/seedelf-review-1.9.0/target-cip30-rust). All 20 that run by default passed. r17, the timing probe, ran with --release --include-ignored. The worktree is removed. The full probe file is at /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/6637f822-1e93-462d-9b5e-5bd103fc4b4b/scratchpad/review-1.9.0/cip30-rust/review_cip30_rust_test.rs. In it, window() mirrors dapp.ts releasesContractFunds and DappApprovals' note condition.

Not done:
- The window was not driven in Vitest or e2e; that's the TS lane.
- The scan was timed natively only, not in the opt-level "z" wasm build.
- Which named DeFi dApps' builders list the owner's key was not checked against those dApps. Finding 1's prevalence rests on one fact: a Plutus script sees a signature only through required_signers.
- tx-view.ts yourSigners and TxDetail.tsx were not reviewed.
- No network calls were made.

## Findings

### cip30-rust#1 (medium, #373, confirmed-by-run): Honest position and shared-state actions read as whole contracts leaving, with "It doesn't come back to you"

**Files:** seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:1103, seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:1129, seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/en.json:513, seedelf-platform/seedelf-web-wallet/docs/architecture.md:563

**Claim.** `releasedLovelace` and `releasedTokens` count every spent contract UTxO's value that doesn't come back to the account. This applies once one of the account's keys is a required signer, or is named in a contract UTxO's datum. The count includes value re-created at the same contract.

That is the norm for position-style dApps: a CDP, a loan, a stake vault, a partial cancel. Their validators check the owner's signature, which a Plutus script sees only through required_signers. It also covers a shared state UTxO, such as a pool, when the builder lists the user's key. The row then shows the whole position or pool. With the owner's key in the datum, the callout reads "Your signature releases your own order or listing from a contract. It doesn't come back to you." That is false for a position re-created under the same owner.

The PR names only a listing's reprice and "a net spender repaying a loan". The repayment case also fires for a net receiver (r11), and so does an honest cancel that pays a 1 ₳ service fee (r19). Nothing is refused, but a user of such a dApp has to flip the switch on every action, beside a false figure.

**Evidence.** cip30.rs:1105-1106: "Money that stays at the same contract counts as gone: a listing can stay where it is under a new owner's datum."

cip30.rs:1125: `let gone = q.saturating_sub(back);`

cip30.rs:1130-1133: `lovelace: contract.lovelace.saturating_sub(came_in).saturating_sub(fee.min(MOST_FEE_ALLOWED).saturating_sub(went_out))`

en.json:514: "Your signature releases your own order or listing from a contract. It doesn't come back to you."

Probes run with `cargo test -j 4 -p seedelf-wasm --test review_cip30_rust_test -- --nocapture --test-threads=1`. Each line is the probe's printed output:
- r8: `position +100 ₳: net=-100200000 released=10000000000 tokens=[636470:1] names_key=true -> warning (contractYours) + rows + switch`
- r9: `swap 100 ₳ through a 5M ₳ pool: net=-100200000 released=5000000000000 tokens=[("706f6f6c","1"),("74657374","999800")] -> warning (contractMaybe) + rows + switch`
- r11: `repay 500, collateral back: net=499700000 released=500000000 -> warning (contractYours)`
- r20: `partial cancel, 30 ₳ left as the order: released=30000000 -> warning (contractYours)`
- r19: `cancel + 1 ₳ service fee: net=48800000 released=1000000 -> warning (contractYours)`
- r13: `purchase, buyer's key listed: net=-49200000 released=2000000 -> warning (contractMaybe)`
- r14 (refund to Account 2) and r21 (refund to 0/0's enterprise address): `released=49800000 -> warning`

r8's shape:
- Inputs: a 150 ₳ UTxO of 0/0, and the position row at script 0x55 holding 10,000 ₳ and 1 token, with inline datum `d8799f581c<0/0>ff`.
- Outputs: the same script with 10,100 ₳, the token and the same datum; 49.8 ₳ to 1/0.
- `required_signers = [0/0]`, script data hash set.

**Scenario.** A user adds 100 ₳ to a 10,000 ₳ CDP whose validator checks the owner's signature. The window shows "Total leaving your public account 100.2 ₳", then "Leaves a contract, not to you 10,000 ₳" and "Leaves a contract, not to you 1 <position token>". The callout says the user's own order doesn't come back, and Sign stays off until the switch is flipped.

A swap through a 5,000,000 ₳ pool, whose builder lists the user's key, reads "Leaves a contract, not to you 5,000,000 ₳". It also lists 999,800 of the pool's reserve token.

A user who learns to flip the switch on every action flips it on the real attack too.

**Fix.** This is the owner's trade-off: counting same-contract value as gone is what catches a re-listing under a new owner's datum.

Options:
- Return value re-created at the same script hash as its own figure (`keptLovelace`/`keptTokens`). Show it as staying at the contract, not in the "not to you" row.
- Never use contractYours for re-created value.
- At least, state the wider class in architecture.md and flows.md: positions, shared state UTxOs, partial cancels, and any repayment, whatever the account's net.

### cip30-rust#2 (low, #373, confirmed-by-run): The native-script clause is the site's to switch off: one witness datum gives the body a script data hash

**Files:** seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:1838, seedelf-platform/seedelf-web-wallet/docs/architecture.md:563, seedelf-platform/seedelf-web-wallet/wasm/tests/cip30_test.rs:2412

**Claim.** The inference holds one way. With no script data hash, every contract input is a native script's.

But the site decides whether the body carries the hash, and nothing needs to run Plutus. One output with a datum hash is enough, with that datum in the witness set, added after signing. It is a supplemental datum, which the ledger allows, and the ledger then requires a script data hash. After that, a native-script UTxO that only the account's key unlocks gets only the neutral note.

The documented limit, "a native script's input in a transaction that also runs Plutus", understates this. The clause only catches a site that doesn't add a datum. The PR's own test pins the opt-out (cip30_test.rs:2412). The severity table puts "a check that can be bypassed" at medium. Low here because native-script UTxOs that only the user's key unlocks are rare.

**Evidence.** cip30.rs:1838: `|| (contract_inputs > 0 && body.script_data_hash.is_none());`

Ledger source, from the local checkout ledger-54e24ba4:
- eras/alonzo/impl/src/Cardano/Ledger/Alonzo/Tx.hs:466-470: `mkScriptIntegrity pp tx langs | null (txRedeemers ^. unRedeemersL), null langViews, null (txDats ^. unTxDatsL) = SNothing | otherwise = SJust ...`
- eras/babbage/impl/src/Cardano/Ledger/Babbage/UTxO.hs:79-84: supplemental datum hashes are the datum hashes of every output, and of every reference input.
- conway.cddl:610-612: "in the case that a transaction includes datums but does not include the redeemers field, the script data format becomes ... [ A0 | datums | A0 ]"

Probe r1:
- Inputs: 0/0's 2 ₳ and a contract UTxO of 50 ₳.
- Outputs: 2 ₳ back to 0/0; 49.8 ₳ to a stranger, carrying `PseudoDatumOption::Hash(blake2b("d87980"))`.
- No required signer.

Results:
- `native alone: key_releases=true released=49800000 -> warning (contractMaybe) + rows + switch`
- With `b.script_data_hash = Some(Hash::new([1; 32]))`: `native + datum: key_releases=false released=49800000 -> neutral note only`

**Scenario.** A native-script vault, `all [sig(0/0), after(t)]`, holds 50 ₳. A site asks for a signature on a transaction that does the following:
- spends the vault, with a 2 ₳ UTxO of 0/0 paid back whole;
- pays itself 49.8 ₳ on an output with a datum hash;
- sets the body's script data hash, and adds the datum after signing.

The window shows a total of 0 ₳, "It spends 1 contract UTxO holding 50 ₳." and Pays "An address 49.8 ₳". There is no warning and no switch.

**Fix.** Read each spent contract input's script type from the chain: Koios script_info gives `type`, and the data layer would need the same. Then treat a native script's input as key-released whether or not the body has a hash.

Otherwise, change the docs' limit to "any transaction with a script data hash, which a site can always add".

### cip30-rust#3 (low, #373, confirmed-by-run): A token the transaction burns reads as leaving a contract "not to you"

**Files:** seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:1116, seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:1758

**Claim.** `releasedTokens` takes a contract UTxO's token that the transaction burns as gone. A burnt token goes to no one, so it can't be what a site takes. Closing a position or an order that burns its state or auth token still gets the release row, the warning and the switch. Meanwhile the mint row already shows the same token burnt.

**Evidence.** cip30.rs:1116-1128 computes `gone` from the contract, `returned` and `put_in` only. The `burn` map at cip30.rs:1758-1767 is never consulted.

Probe r10:
- Contract input: 50 ₳ and 1 token, its datum naming 0/0.
- Mint: −1 of that token.
- Output: 49.8 ₳ to 0/0.
- Required signer: 0/0.

Result: `close, token burnt: released=0 tokens=["1"] mint=["-1"] -> warning (contractYours) + rows + switch`

**Scenario.** A user closes a loan or a vault whose position NFT is burnt, and every ₳ comes back. The window shows "Leaves a contract, not to you: 1 <token>" and "Your signature releases your own order or listing … It doesn't come back to you." Sign waits for the switch.

**Fix.** Subtract the transaction's burn of each asset from that asset's `gone` in released_from_contracts. Nothing a site can gain is hidden by this.

### cip30-rust#4 (low, #373, confirmed-by-run): A contract input the worker couldn't find, signed for by the stake key alone, gets no contract warning

**Files:** seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:1273, seedelf-platform/seedelf-web-wallet/extension/src/ui/dapp.ts:33, seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:1301, seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/en.json:520

**Claim.** When only the stake key signs, inspect still allows inputs it couldn't find. An unfound contract input never reaches contract_held, so `releasedLovelace` is 0 while `keyReleases` is true: the stake key is a required signer. The window shows no rows, no switch and no contract note. It shows only "It spends 1 UTxO the wallet couldn't find, so what it holds can't be shown. Only your stake key signs here." That reads as reassurance, though here the stake key is exactly what the contract asks for. With a payment or DRep key signing, such a transaction is refused before the window, as in 1.8.1.

**Evidence.** cip30.rs:1273: `None => unknown.push(format!("{}#{}", key.0, key.1)),` — the input is never counted in contract_held.

dapp.ts:33-35: `return !!s.keyReleases && (BigInt(s.releasedLovelace ?? "0") > 0n || (s.releasedTokens?.length ?? 0) > 0);`

Probe r2:
- The transaction spends TX_B#0, and there is no row for it.
- `required_signers = [stake 2/0]`, script data hash set, partialSign true.

Result: `unknown=["2222…#0"] contract_inputs=0 key_releases=true released=0 -> nothing`

**Scenario.** SundaeSwap V3/V4 orders can name any key as their owner. The wallet's own session swaps name the session's stake key (sessions.ts refuseOddities, `stakeSigns`).

A site spends such an order seconds after it's made, before Koios or the data layer lists it. It sends signTx with partialSign. The window shows only the couldn't-find line and the partial-sign note.

**Fix.** When keyReleases and unknownInputs are both set, show the contract warning and the switch, saying what it holds can't be shown. Otherwise, drop "Only your stake key signs here" in that case.

### cip30-rust#5 (low, #373, confirmed-by-run): The datum scan runs again for every contract input: about a second natively on a crafted 62 KB transaction

**Files:** seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:1270, seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:1093, seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:525

**Claim.** datum_names_key runs once for each found contract input, even after names_key is already true. Each run slides a 28-byte window over the whole datum and does a hash-map lookup at every position.

N inputs that keep one large datum by hash, carried once, cost N times the datum's length. The module is built at opt-level "z" and runs synchronously in the service worker. sign_tx then runs inspect again. MAX_TX_BYTES' own comment budgets a read "well under a second".

**Evidence.** cip30.rs:1270: `names_key |= datum_names_key(row, &carried, &keys);`

cip30.rs:1093-1096: `b.windows(28).any(|w| ... keys.of_hash(&Hash::new(h)).is_some())`

cip30.rs:526-528: "Reading checks every register datum's points, about a millisecond each, so this keeps a read well under a second."

Probe r17: 880 contract inputs, each keeping blake2b of one 30,000-byte BoundedBytes datum, carried once. Run with `cargo test --release -j 4 -p seedelf-wasm --test review_cip30_rust_test -- --nocapture --include-ignored r17`.

Output:
- `tx bytes: 62788`
- `contract_inputs=880 names_key=false with the datum: 1.023334301s, without: 18.082043ms`

This is native opt-level 3. The wasm build is opt-level "z", so expect it to be slower.

**Scenario.** A site keeps 880 UTxOs at its own always-true script, each with one shared datum hash. That is about 1 ₳ each, which it can take back. It asks the user to sign a transaction spending all of them. The worker blocks for a second or more, natively more than 50 times the 18 ms the same read takes with no datum, and then again at sign time.

**Fix.** Scan each distinct datum once, memoized by datum hash or by the inline bytes. Skip the scan once names_key is set.

### cip30-rust#6 (low, #373, confirmed-by-run): A contract holding up to 10 ₳ can be burnt as fee with only the note

**Files:** seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:1101, seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:1133

**Claim.** The fee credit takes up to 10 ₳ of the fee off what's released. So an order of up to 10 ₳, plus the fee's share, can be burnt under the account's key with only the neutral note and the fee row.

The PR says "a contract burned as fee still warns". That holds only above 10 ₳. The burn is griefing, and nobody gains from it. The cap itself is justified: the largest real fee today is about 2.4 ₳, plus up to about 6.3 ₳ of reference-script fees.

**Evidence.** cip30.rs:1101: `const MOST_FEE_ALLOWED: u64 = 10_000_000;`

cip30.rs:1133: `.saturating_sub(fee.min(MOST_FEE_ALLOWED).saturating_sub(went_out))`

Probe r4: a 5 ₳ contract input, `required_signers = [0/0]`, fee 5 ₳, no outputs.

Result: `fee 5 ₳ from a 5 ₳ order: released=0 -> neutral note only`

**Scenario.** A site burns each of the user's small orders, 10 ₳ or less each, as fees, with one signature per order. Each window shows the note and the fee, and no switch.

**Fix.** Accept it and say so in architecture.md. Or, when the account puts nothing in, credit only a fee in line with the transaction's size: 44 × bytes + 155,381, plus the most its scripts can cost.

### cip30-rust#7 (low, #373, traced): The new tests don't pin the shapes most likely to regress

**Files:** seedelf-platform/seedelf-web-wallet/wasm/tests/cip30_test.rs:2366, seedelf-platform/seedelf-web-wallet/wasm/tests/cip30_test.rs:2405

**Claim.** All 16 new tests use synthetic transactions. Several shapes have no test:
- a DRep required signer;
- a contract input the worker couldn't find;
- a witness datum whose bytes differ from Pallas's re-encoding;
- an untagged witness-datum list;
- a real transaction from chain;
- any honest DeFi shape beyond the listing.

`by_hash` can't fail if the carried map hashed a re-encoding instead of the raw bytes. Its datum `d8799f581c…ff` re-encodes to the same bytes, and its transaction is written by Pallas: decoded as a Tx, then encoded.

**Evidence.** cip30_test.rs:2367-2368:
```
let data = PlutusData::decode_fragment(&hex::decode(datum).unwrap()).unwrap();
let hash = pallas_crypto::hash::Hasher::<256>::hash(&data.encode_fragment().unwrap());
```

Probes that fill these gaps, all passing at 8d7c4b0c:
- r3: a DRep required signer with governance gives `signs=["drep"]` and keyReleases.
- r2: the unknown-input case.
- r6: the raw datum `d8799f581c<key>1a00000001ff`, which Pallas re-encodes as `…01ff`. It is hashed as written, so names_key is true in both a tagged set and a plain list. The transaction is written by hand as `[body, {4: 258([raw])}, true, null]`.
- r7: the real Minswap V1 cancel 4044b9cc… from seedelf-core's cancel_integrity.json. Its carried hashes are `["dae9e5dc57ea9bffde02bc74139c97797808118a8ef492bbb6e5888143230a94"]`, the order 74db9b06…#0's datum_hash. inspect_tx gives `contract_inputs=1 contract_lovelace=4000000`.
- r18: MintedTx and Tx decodes agree on 48 recorded transactions, with 3 witness datums.

The PR's own suite: `cargo test -j 4 -p seedelf-wasm --test cip30_test` → 65 passed.

**Scenario.** Suppose a later change builds the carried map from `conway::Tx` with re-encoded datums, or decodes the witness set some other way. Every existing test still passes, while a real Plutus V1 order whose datum isn't Pallas-canonical stops being recognised as the user's.

**Fix.** Add r3, r2, r6 and r7 to cip30_test.rs. r7 reads seedelf-core/tests/fixtures/cancel_integrity.json. If the owner keeps the behaviour in finding 1, also pin those figures.

### cip30-rust#8 (nit, #373, confirmed-by-run): The key scan misses a key split across byte-string chunks

**Files:** seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:1093

**Claim.** datum_names_key scans the datum's raw CBOR. Plutus data writes byte strings over 64 bytes as 64-byte chunks, and an encoder may chunk shorter ones.

It misses a key that straddles a chunk header: a field over 64 bytes with the key at offset 37–63, or a datum chunked on purpose. This only matters without a required signer, for a contract that takes the owner's input as proof. The datum's encoding is fixed when the order is made.

**Evidence.** Probe r5. Each datum is inline, with no required signer and the script data hash set:
- plain: `names_key=true key_releases=true -> warning (contractYours)`
- chunked (`d8799f5f4e<14>4e<14>ffff`): `names_key=false key_releases=false -> neutral note only`
- long (a 70-byte field, the key at offset 40, written `5f 5840<64> 46<6> ff`): `names_key=false`

Pallas decodes all three as valid PlutusData.

**Scenario.** A contract keeps its owner inside a field longer than 64 bytes and takes the owner's input as proof. The window shows only the note.

**Fix.** Decode the datum as PlutusData, where Pallas's BoundedBytes joins the chunks, and scan each byte string whole. Fall back to the raw scan when it doesn't decode. Or document the limit.

### cip30-rust#9 (nit, #373, traced): Contract token totals saturate where the workspace rule says checked or u128

**Files:** seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:156, seedelf-platform/CLAUDE.md:96, seedelf-platform/seedelf-web-wallet/wasm/tests/cip30_test.rs:2438

**Claim.** add_saturating sums contract tokens with saturating_add. seedelf-platform/CLAUDE.md says "A new u64 sum of token quantities must be checked", or summed in u128 where the total is only compared.

Saturating meets the PR's aim of never refusing, but past a u64 it shows a false figure, and the PR's test pins it. Only a token minted past a u64 across several UTxOs reaches it, and the warning still shows.

**Evidence.** cip30.rs:157-162:
```
self.lovelace = self.lovelace.saturating_add(other.lovelace);
... *held = held.saturating_add(*q);
```

cip30_test.rs:2438, with two UTxOs of u64::MAX each: `assert_eq!(s.contract_tokens[0].quantity, u64::MAX.to_string());`

**Scenario.** Two contract UTxOs each hold 18,446,744,073,709,551,615 of a token someone minted. The window says that amount leaves, half the real figure.

**Fix.** Keep the contract and released token totals in u128, which gives true figures and still never refuses. Or record the exception beside the rule in CLAUDE.md.

## What holds

- Q1: the payment key as a required signer over a found contract input sets keyReleases. released = what the contract held, less what reaches the account, less at most 10 ₳ of fee. The window shows the rows, the warning and the switch (cip30_test.rs:2193).
- Q1: the stake key as a required signer (cip30_test.rs:2279) and the DRep key with governance granted (probe r3, signs=[drep], 49.8 ₳ released) both get the warning and the switch. Without governance the DRep key is a stranger's and never signs.
- Q1: an inline datum naming the payment key or the stake key, with no required signer, sets keyReleases and shows contractYours (cip30_test.rs:2339, 2357).
- Q1/Q4: a datum kept by hash and carried is found. blake2b-256 of the witness datum's raw bytes is the ledger's hash: the real Minswap V1 cancel 4044b9cc… gives dae9e5dc… (r7). A non-minimal encoding is matched as written, in a tagged set and in a plain list (r6).
- Q1: a datum kept by hash and not carried is still covered when the account's key is a required signer. Otherwise it gets the note only, which is the PR's documented limit.
- Q1: money split over many contract inputs is summed (cip30_test.rs:2247). Money kept at the same contract counts as gone (2236). A payment to another of the wallet's accounts, or to the account's key with no stake part or another stake part, counts as released, beside Pays' own line (r14, r21).
- Q1/Q3: the account's own ADA going out never lowers released, because went_out only reduces the fee credit. r16: 100 ₳ of the account's out and the order's 50 ₳ in gives net −50 and released 50.
- Q1/Q3: tokens are counted per asset, net of what the account puts in. r15 gives released 5 and net −5. ADA paid back never stands in for a token taken (cip30_test.rs:2223).
- Q1: a fee above 10 ₳ taken from a contract is counted beyond 10 ₳ (cip30_test.rs:2415). The cap is above any real fee: about 2.4 ₳ for a 16 KiB transaction at maximum execution units, plus about 6.3 ₳ of reference-script fees at 200 KiB.
- Q1: an input the worker didn't find, with a payment or DRep key signing, is refused before the window, unchanged from 1.8.1 (cip30.rs:1788-1801).
- Q2: an honest cancel releases 0 ₳ and gets only the neutral note, with no switch. This holds with the fee taken from the order or from a UTxO the account adds, and the refund to the account's own address (cip30_test.rs:2212, r12).
- Q2: a purchase or a direct swap whose builder doesn't list the user's key gets keyReleases false and only the neutral note, which states the contract UTxO's true holdings.
- Q3: every subtraction in released_from_contracts saturates, and several contract inputs add up. The fee credit is min(fee, 10 ₳) less the account's net outflow, so when the account pays the fee, all of the contract counts (cip30_test.rs:2261).
- Q4: in Pallas 0.35, MintedTx and Tx share one grammar; the minted types only add KeepRaw wrappers. NonEmptySet takes an optional 258 tag. The two decodes agree on 48 recorded transactions (r18). If the second decode fails, the map is simply empty (cip30.rs:1246); nothing is refused.
- Q4: Koios and the data layer both return inline_datum.bytes and datum_hash. koios.ts trimmed keeps the bytes, and seedelf-data's utxos.rs read_utxo fills both fields. So namesKey works through mainnet's data layer too. An inline datum is read first, and the hash lookup is lowercased.
- Q5: a false match needs a datum that holds the account's key hash, such as a destination naming the user or a site writing it in, and it only picks the stronger wording. Chance collisions are negligible.
- Q6: 'no script data hash means a native script' holds in Babbage and Conway. Every Plutus purpose needs a redeemer, and redeemers need the hash. A native reference script needs neither; a Plutus reference script still needs a redeemer.
- Q7: nothing new refuses in Rust. Every new step is infallible: of_row sits behind if let Ok, sums saturate, and the second decode falls back with unwrap_or_default. The PR's test what_a_contract_utxo_holds_is_never_a_reason_to_refuse covers this (cip30_test.rs:2426).
- Q8: `cargo test -j 4 -p seedelf-wasm --test cip30_test`, with CARGO_TARGET_DIR=$HOME/.cache/seedelf-review-1.9.0/target: ok, 65 passed, 0 failed, 13.54 s.
- at_script counts any Shelley address whose payment part is a script, whatever its stake part. owner() refuses other-network rows before at_script runs.
