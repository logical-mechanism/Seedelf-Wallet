# Lane R2a

Returned by the workflow's agent `ac38a1a7901e56994`, written here by the lead from its structured answer.

## Findings (3)

### r2a#3 · medium · A stranger's many-token UTxO costs several times its ADA once re-made as change 20 tokens an output, and history-aware selection takes it ahead of money that pays without it

- **Where:** `seedelf-platform/seedelf-core/src/build.rs:353`
- **Who:** stranger · **Since:** cf5ef7ff (2026-09-23, chunk 7: change and deposits 20 tokens an output; the CLI had the same rule before). The history order that takes a Received bundle ahead of boxes dates from 366cd5c6/769049b3 (2026-09-27). Present at web-wallet/1.9.1 (core and wasm sources unchanged since). · **Confidence:** traced
- **Needs the owner:** Max spending every UTxO, bundles included, is the owner's 1.6.0 call. Changing how many tokens go to an output changes the CLI's transactions too.

**Scenario:**

A stranger mints 200 tokens (one policy, 1-byte names) and pays them to the user's Seedelf in one output. Anyone can do this by re-randomizing the Seedelf's public register. The output holds the ledger's least for it at the contract's enterprise address: 4,068,640 lovelace. The wallet lists it as Received (D). The user's private balance also holds O1, 20 ₳ made private (Own), and four Lovejoin boxes B1-B4 of 9.71 ₳ each.

The user makes 35 ₳ public to an address (Purpose::Pay, sweep_many_apart):
- Steps 1-3 try nothing that pays: no single UTxO is over 35 ₳, and every class has one UTxO.
- Order a is [O1, D, B1, B2, B3, B4]: D is tier 0, so it comes before the boxes (tier 2).
- [O1, D, B1, B2] (43.49 ₳) and [O1, D, B1, B2, B3] (53.20 ₳) are Short. Their change must carry D's 200 tokens, which token_chunks/deposit_outputs re-make as 10 outputs of 20. Each needs (160 + 271 bytes) x 4,310 = 1,857,610 lovelace, 18.58 ₳ in all (17.37 ₳ even at the ledger's exact enterprise sizing), against the 4.07 ₳ D brings.
- [O1, D, B1..B4] (62.91 ₳) builds. Its change, about 27.3 ₳, goes back as 10 contract outputs holding D's tokens, nine of them at exactly their least.

O1 + B1 + B2 alone pay the 35 ₳ with about 4.08 ₳ of ADA-only change, leaving B3 and B4 unmerged and D untouched.

Outcome:
- About 14.5 ₳ of the user's own ADA becomes the least of junk outputs the stranger chose. Within Seedelf Wallet it can be used only by sending the tokens away with it (whoever receives them gets that least), because every Seedelf builder re-splits 20 tokens an output. Getting it back means making the tokens public and re-packing them in another wallet, at Make public's privacy cost.
- Two more Lovejoin boxes are merged than the payment needed (privacy.md:170: boxes come last, one at a time).
- The stranger spent about 4.1 ₳. About 800 two-byte-named tokens (about 15.3 ₳, a 3.2 kB value) bind about 77.7 ₳ as 40 outputs the same way.
- As far as the worker's summary goes, the review shows the payment, the fee, the histories merged and a count of tokens kept (script-spend.ts:521 changeTokens). Nothing says the user's ADA now sits as those tokens' least.

The same bundle also:
- makes payments refused (r2a#2);
- makes Max keep 18.58 ₳ with it (Max spends every UTxO, and WebAssembly's Worth::adds saturates at 0, so the bundle ranks as adding nothing rather than as a cost);
- comes first in a session's funding (a swap), whose Purpose::Fund ranks Received money first (rank 1).

Graded medium, not high: the ADA stays in the user's balance, and it needs this selection shape or a Max.

**Evidence:**

Chunking:
- build.rs:353-359 token_chunks: `tokens.split(MAXIMUM_TOKENS_PER_UTXO as usize)`.
- build.rs:365-389 deposit_outputs: every chunk gets its own output and least.
- build.rs:2152-2161: a contract change goes through deposit_outputs.
- build.rs:2067-2075 change_minimum = minimum_deposit.
- constants.rs:93-95: MAXIMUM_TOKENS_PER_UTXO = 20 ("these maximums are estimated"), while one output may hold 5,000 bytes (build.rs:138, MAX_VALUE_SIZE).

Selection:
- build.rs:2774-2782: order a sorts by (tier, !joins_base, rank, holds_tokens, Reverse(lovelace)) and never by what a UTxO's tokens cost.
- build.rs:2386-2411 ranks: Pay has Received 2, ahead of Unknown 3 and boxes (tier 2); Fund has Received 1.
- wasm lib.rs:3720-3731 Worth::adds: `lovelace.saturating_sub(kept)`.
- extension background/script-spend.ts:310-313 spendable passes every owned UTxO except a Seedelf's or one carrying a reference script.

Figures, from the fixture parameters (tests/fixtures/epoch_params.json: coins_per_utxo_size 4,310, min_fee_a 44, min_fee_b 155,381), with Pallas's PostAlonzo map encoding (build_babbage_raw):
- D's output is 1 + 1 + 31 (enterprise address) + 1 + 639 (value: 1 + 5 + 1 + 30 + 2 + 200 x 3) + 1 + 110 (inline register datum) = 784 bytes, so its least is (160 + 784) x 4,310 = 4,068,640.
- A 20-token change chunk, sized as the wallet sizes it (dummy base address), is 1 + 1 + 59 + 1 + 98 + 1 + 110 = 271 bytes, so 1,857,610 each, x 10 = 18,576,100.
- One output holding all 200 tokens would need 4,189,320.
- The guessed fee for six inputs and eleven outputs is about 0.57 ₳.

Trace: sweep_many_apart, then select_script_inputs. Histories aren't blind, so apart runs. try_with([]) skips; one_more skips every single UTxO (lovelace <= floor of 35 ₳); the classes step has no class with 2 or more rows; base is empty, so step 3 is skipped. Order a's grow returns Short, Short, then Built at k = 6.

**Fix:**

Fix the class in three places.

1. Pack change and deposit tokens by value size (≤ MAX_VALUE_SIZE with a margin) rather than 20 an output. Keep each spent UTxO's bundle together: it fit one output once, so it fits again. A bundle then costs about its own least plus 0.12 ₳ and its spend's fee, and every payment of many tokens pays fewer leasts. MAXIMUM_TOKENS_PER_UTXO lives in the frozen constants.rs, so build.rs would pack by size itself.
2. In selection, price what a UTxO adds as ADA less the change its tokens need, with its sign. Take one that adds less than nothing only when it holds a token being sent, and last in every order (apart's orders a to d, the blind path at build.rs:2567, max_inputs by lovelace, which WebAssembly's measured_or_more uses). Keep the sign in WebAssembly's Worth.
3. Max's every-UTxO rule is the owner's: offer to leave out a UTxO that costs more than it holds, as Max already leaves out one that won't fit.

The rest of the family:
- the public side's change_outputs (build.rs:430-434: account Max keeps about 13.8 ₳ for 200 tokens);
- external_sweep's deposits (a session's return);
- Lovejoin's builders;
- the CLI.

Test (seedelf-core): apart_test.rs's world, with the six UTxOs and pay(35 ₳). Today sweep_many_apart is Ok, spends D and 4 boxes, and its change holds 200 tokens in 10 outputs. sweep_many_from on [O1, B1, B2] then estimate() also pays.

**Known check:**

Searched backlog.md, docs/ and every docs/archive/plans/ review and chunk plan for junk, dust, spam, airdrop, bundle(s), "20 to an output", MAXIMUM_TOKENS_PER_UTXO, "adds no ADA", "adds nothing", "more than it", worth, "tokens a stranger", grief.

Found only:
- privacy.md:114 (Max spends bundles that add no ADA);
- chunk-34's owner call for Max ("split the tokens off with their min ada going back as change");
- the known 0.12 ₳ base-address premium (seedelf-core/tests/lovejoin_box_value_test.rs:32-37).

None covers a bundle whose tokens need more change than it holds, or selection taking it ahead of money that pays without it.

### r2a#2 · low · apart ends the search at the first order grown whole that's short, so it refuses payments a subset pays and the CLI's order would make

- **Where:** `seedelf-platform/seedelf-core/src/build.rs:2843`
- **Who:** stranger · **Since:** 769049b3 / 9c48db21 (2026-09-27, independent review M6) · **Confidence:** traced

**Scenario:**

Private balance with histories known:
- O1: 20 ₳ made private (Own);
- B1, B2: two Lovejoin boxes of 9.71 ₳;
- D: a stranger's payment holding 200 tokens at its least, 4,068,640 lovelace (Received; see r2a#3).

The user makes 35 ₳ public to an address:
- Steps 1-3 build nothing.
- Order a is [O1, D, B1, B2], and its whole set (43.49 ₳) is Short: its change of about 8 ₳ must carry D's tokens as 10 outputs (18.58 ₳).
- `Grown::Short if whole` sets failed = false and breaks out of the order loop. Orders b, c (as few boxes as pay) and d (the CLI's own order) never run, and the spend is refused "Not enough ADA".
- O1 + B1 + B2 (39.42 ₳) pay it with about 4.08 ₳ of ADA-only change, and sweep_many's CLI order (pure ADA, largest first) builds exactly that.
- WebAssembly's fallback, measured_or_more (max_inputs by lovelace), takes D too and is short. The user is refused, and told from a Max build that they can pay up to about 24.4 ₳, since 18.58 ₳ has to stay with the tokens.

The shortcut assumes spending is monotone: if everything together is short, every subset is. That fails whenever a UTxO adds less than it costs. Even with r2a#3 fixed, a bundle at its least still costs its 0.12 ₳ base-address premium and its spend's fee, so a window of about 0.16 ₳ stays refused. The same holds when a UTxO turns an exact change of 0 into dust.

privacy.md:171 promises "It never refuses a payment the CLI's order would make", and so do build.rs:2318-2319 and 2533-2534 (independent review M6).

**Evidence:**

build.rs:2754-2757: "short with everything is short in any order (independent review M6)".

build.rs:2840-2846:
```
let whole = order.len() == rest.len();
match grow(&order, j, &mut try_with) {
    Grown::Built(built) => return Ok(built),
    Grown::Short if whole => { failed = false; break; }
```

build.rs:2759-2771: orders c and d, which would find [B1, B2, O1] (c, j = 2) and [O1, B1, B2] (d).

build.rs:2828-2831: order a runs first.

The promise: build.rs:2318-2319 and 2533-2534, privacy.md:171.

WebAssembly: lib.rs:3165-3182 build_transfer, and lib.rs:3198-3214 measured_or_more, which uses max_inputs (lovelace) and returns `short`.

Trace: try_with([]) skips; one_more skips every single UTxO (≤ 35 ₳); no class has 2 or more rows; base is empty. grow(a): [O1] skip, [O1, D] skip, [O1, D, B1] skip (33.78 ≤ 35), [O1, D, B1, B2] attempted and NotEnough, so Grown::Short with whole = true, and the loop breaks.

**Fix:**

Don't end the search on a short whole order. At least grow the CLI's order (d) before refusing, since privacy.md promises it. Or drop the break and keep `grown_before`'s dedup, at the cost of a few more estimates.

r2a#3's fix shrinks the window from about 14.6 ₳ to about 0.16 ₳ but doesn't close it.

Test (seedelf-core, apart_test.rs style): `both()` on [O1, B1, B2, D] with pay(35 ₳). Today sweep_many_apart is Err(is_short) while sweep_many is Ok, spending O1, B1, B2.

**Known check:**

Searched backlog.md, independent-review.md (M6, L39, Disputed, Checked and fine), and review-1.6.0 to review-1.9.1 for "short with everything", monoton, whole, apart, "never refuses". M6's fix introduced the break. No record of a UTxO that costs more than it adds, nor of this refusal.

### r2a#1 · low · is_payable_address refuses a key-payment address whose stake part is a script, and the screen calls it a script's address

- **Where:** `seedelf-platform/seedelf-core/src/build.rs:3280`
- **Who:** user · **Since:** 6daafe6f (2026-09-23, chunk 10), before web-wallet 1.0.0. The CLI's is_not_a_script rule is older. · **Confidence:** traced
- **Needs the owner:** Chunk 10 chose "no script in the payment or the delegation part" deliberately, and a test pins it. Accepting addr1y (and maybe Byron) changes what Send, Make public, contacts and handles accept.

**Scenario:**

A user wants to pay a mainnet base address whose payment part is a key hash and whose stake part is a script hash (header type 2, addr1y…), for example a key-held address delegating through a native multisig stake script. The ledger takes a payment there, only that payment key spends it, and no datum is involved.

All of these refuse it:
- public Send (account_send_many, then check_payable);
- Make public and private Send to an address (address_payment; Max through pay_rest(RestTo::Address));
- Remove's ADA to an address;
- contacts and ADA Handles (extension checkPayable, then checkPayableAddress, then is_payable_address).

The user is told "That's a script's address. Seedelf Wallet pays only ordinary addresses: a payment to a script could be locked there for good." That is false for this address. The user can't pay that recipient from either side of the wallet.

**Evidence:**

build.rs:3280-3284:
```
matches!(addr, Address::Shelley(_)) && is_not_a_script(addr.clone()) && is_on_correct_network(..)
```

address.rs:63-65: `!Address::has_script(&addr)`.

pallas-addresses 0.35.1 src/lib.rs:519-521, ShelleyAddress::has_script: `self.payment().is_script() || self.delegation().is_script()`.

seedelf-core/tests/mint_test.rs:2484-2501 asserts that `script_stake` (a Key payment with a Script delegation) is refused.

The design: chunk-10-withdraw.md:45 sets "no script in the payment or the delegation part". Its only reason (chunk-10-withdraw.md:36; flows.md:398: "its output would carry no datum") concerns a script payment part.

The extension: background/destination.ts:84-99 maps any WebAssembly refusal on this network's prefix to t("worker.address.script") (en.json above).

The owner's rule: the wallet refuses only what the ledger or the contracts refuse (2026-10-19).

**Fix:**

Test the payment part only: `matches!(addr, Address::Shelley(s) if !s.payment().is_script())` plus the network check. Keep "a script's address" for a script payment part.

The same class:
- the CLI's create.rs:50, fund.rs:85 and util/extract.rs:48 call is_not_a_script directly;
- `matches!(addr, Address::Shelley(_))` refuses Byron addresses, which are key-spendable too (the owner's call).

mint_test.rs:2484-2501 changes with the fix.

**Known check:**

Searched backlog.md, docs/ and docs/archive/plans/ for addr1y, addr_test1y, "script stake", "stake part is a script", is_payable_address, is_not_a_script, has_script, Byron. Found only chunk-10-withdraw.md's design lines and roadmap-v1.md:423. There is no leftover, Not fixed entry or owner call on it, and nothing since the 2026-10-19 rule.

## Guards (29)

| Where | What it stops | Test |
|---|---|---|
| `seedelf-platform/seedelf-core/src/build.rs:103` | check_fee: refuses a fee over MAX_FEE (10 ₳) that wrong protocol parameters would produce, before anything is signed | seedelf-core/tests/build_test.rs a_fee_over_the_limit_is_refused_in_words |
| `seedelf-platform/seedelf-core/src/build.rs:269` | settle: refuses an output whose value is over MAX_VALUE_SIZE, which the node would refuse | seedelf-core/tests/build_test.rs an_output_holding_more_than_the_ledger_takes_is_refused_as_too_large |
| `seedelf-platform/seedelf-core/src/build.rs:273` | settle: refuses a signed draft over MAX_TX_SIZE (16,384 bytes) | seedelf-core/tests/build_test.rs a_transaction_over_the_size_limit_is_refused_in_words |
| `seedelf-platform/seedelf-core/src/build.rs:278` | settle returns only a draft whose own signed, patched size its fee covers (FeeTooSmallUTxO otherwise) | none found by name: every fee assertion (build_test.rs assert_paid) relies on it |
| `seedelf-platform/seedelf-core/src/build.rs:70` | reference_script_fee: prices Conway's tiered reference-script fee, so a fee isn't short, and refuses over 204,800 bytes | seedelf-core/tests/build_test.rs reference_scripts_are_priced_in_conways_tiers |
| `seedelf-platform/seedelf-core/src/build.rs:379` | deposit_outputs: refuses a contract output under its least (TooLittle) | seedelf-core/tests/mint_test.rs refuses_what_would_lose_money |
| `seedelf-platform/seedelf-core/src/build.rs:441` | change_outputs: refuses key-address change under its least (NotEnough, so selection takes more) | seedelf-core/tests/build_test.rs ("needs at least"); none found by name |
| `seedelf-platform/seedelf-core/src/build.rs:854` | account_payment: Max with several recipients is refused | seedelf-web-wallet/wasm/tests/api_test.rs sends_to_several_addresses_in_one_payment |
| `seedelf-platform/seedelf-core/src/build.rs:894` | account_payment: refuses a token the account doesn't hold, or more of it than it holds (counted over fitting's set) | seedelf-core/tests/build_test.rs ("holds only", "more than none") |
| `seedelf-platform/seedelf-core/src/build.rs:3107` | is_payable, through check_register (804), payment_outputs (3227), mint_from (3047) and account_mint (3876): no payment or Seedelf under an undecodable, torsion or identity point | seedelf-core/tests/mint_test.rs refuses_what_would_lose_money |
| `seedelf-platform/seedelf-core/src/build.rs:3290` | check_payable / is_payable_address: no payment to a script address with no datum, a stake address or the other network (over-wide: r2a#1) | seedelf-core/tests/mint_test.rs refuses_what_would_lose_money; seedelf-core/tests/most_test.rs max_to_an_address_keeps_the_tokens_it_isnt_sending |
| `seedelf-platform/seedelf-core/src/build.rs:1589` | with_account: refuses the account key as the one-time key, an input or collateral not under the account's key on this network, a UTxO spent twice, and a collateral holding tokens | seedelf-core/tests/merge_test.rs an_account_under_another_key_or_a_token_collateral_is_refused |
| `seedelf-platform/seedelf-core/src/build.rs:1760` | with_staking: refuses any certificate the Seedelf spend can't witness (only a script's cert-0 registration) | seedelf-core/tests/staking_test.rs a_seedelf_spend_takes_no_certificate_whose_witness_it_never_adds |
| `seedelf-platform/seedelf-core/src/build.rs:1726` | mint_inline: refuses a minting script that doesn't hash to the policy | none found |
| `seedelf-platform/seedelf-core/src/build.rs:1995` | ScriptSpend::settle: refuses budgets over MAX_TX_BUDGET as TooMany, so the caller splits rather than send what the node refuses | seedelf-core/tests/apart_test.rs what_no_order_pays_is_still_refused |
| `seedelf-platform/seedelf-core/src/build.rs:2058` | split: pay_rest/carry refused when what's left can't carry its tokens' least; kept tokens get exactly their least | none found by name (most_test.rs covers Max's kept tokens) |
| `seedelf-platform/seedelf-core/src/build.rs:2152` | stage: contract change under minimum_deposit is refused, never sent under its least | seedelf-core/tests/mint_test.rs assert_sound (min-UTxO floors) |
| `seedelf-platform/seedelf-core/src/build.rs:2108` | remainder: checked lovelace and token separation (a spend can't pay out more than its inputs, refund and mint hold); burn needs the token | seedelf-core/tests/mint_test.rs refuses_what_would_lose_money |
| `seedelf-platform/seedelf-core/src/build.rs:1145` | collateral_output, and the account branch at 2197: refuses a fee whose 3/2 the collateral can't cover; even() at 1137 keeps 3/2 x fee whole | seedelf-core/tests/mint_test.rs assert_sound (5 ₳ − 3/2 x fee); lovejoin_pools_test.rs collateral_back |
| `seedelf-platform/seedelf-core/src/build.rs:2264` | carried: refuses when no output, or more than one, could be the carry, so a payment output isn't read back as the user's | none found by name (api_test.rs a_part_of_tokens_with_no_ada_left_spends_what_the_part_before_carried exercises it) |
| `seedelf-platform/seedelf-core/src/build.rs:1193` | add_witnesses: refuses if adding signatures changed the body's hash (what was reviewed) | none found |
| `seedelf-platform/seedelf-core/src/build.rs:1167` | is_collateral_signature: only giveme.my's key's signature over the tx hash is attached | seedelf-core/tests/mint_test.rs (is_collateral_signature) |
| `seedelf-platform/seedelf-core/src/build.rs:2672` | apart: lovelace sums in u128, so a lying index's rows can't wrap or trap the module | seedelf-core/tests/apart_test.rs lovelace_past_what_a_u64_holds_is_never_summed_into_a_trap_when_choosing |
| `seedelf-platform/seedelf-core/src/build.rs:2843` | apart: refuses what no order pays (the shortcut is over-wide: r2a#2) | seedelf-core/tests/apart_test.rs what_no_order_pays_is_still_refused |
| `seedelf-platform/seedelf-core/src/build.rs:2553` | select_script_inputs and max_inputs_by (2911): never pick a UTxO the evaluator can't take (a reference script, a datum past the depth limit) | none found by name |
| `seedelf-platform/seedelf-core/src/build.rs:2556` | fitting at 881, 2556, 2914 and 3808: leaves out UTxOs whose tokens would total past a u64, which also bounds holding's and held's plain sums | none found by name in build tests (fitting's own in utxos_test.rs) |
| `seedelf-platform/seedelf-core/src/build.rs:3747` | AccountMint::stage: refuses a collateral whose return would fall under its least | none found |
| `seedelf-platform/seedelf-core/src/build.rs:3558` | seedelf_in: remove burns only a UTxO holding exactly one Seedelf | seedelf-core/tests/mint_test.rs refuses_what_would_lose_money |
| `seedelf-platform/seedelf-core/src/build.rs:3337` | pay_address and payment_outputs (3232): refuse a payment under its least or of zero of a token, which would trap Pallas's PositiveCoin unwrap | seedelf-core/tests/mint_test.rs refuses_what_would_lose_money |

## Checked and holds

- Redeemer indexes match: Pallas 0.35.1 sorts inputs by (tx id, index) and indexes Spend redeemers into that sort (pallas-txbuilder conway.rs:47, 184-195). ledger_order sorts the owned and the account's inputs the same way, so positions(), stage's per-redeemer budgets and settle's lookups agree, with with_account's inputs counted. The mint index 0 matches Pallas's sorted mint policies (one policy a spend).
- Budgets::from_ogmios keys every budget by purpose and index and never reads answer order. covers() compares per redeemer. measure_locally declares the measured budgets, measures the finished transaction again, and settles with a 1% margin only where the finished one used more.
- settle returns only the staged draft whose own signed, patched size its fee covers. The fake signatures are real-sized. The values the build closure captures (paid, change, outputs) belong to that returned draft. Convergence holds because the fee's CBOR stays 5 bytes.
- Fees: computation_fee is summed per redeemer (≥ the ledger's ceiling over the total). reference_script_fee matches Conway's tierRefScriptFee (25,600-byte tiers, x6/5, floor). The 629 + 519-byte references are counted exactly when read. The collateral's and the account mint's collateral's reference scripts are rightly not counted.
- Collateral: even() keeps 3/2 x fee whole. giveme.my's 5 ₳ return stays above its least at the largest fee a spend reaches (about 2.4 ₳, return of about 1.4 ₳).
- Placeholder proofs in estimate() are the real proofs' sizes (z 32 bytes from to_bytes_be, g_r 48, vkh 28), so estimated and final sizes agree.
- Minimums are sized with build_babbage_raw, the encoding the transaction uses. change_outputs, pay_address and deposit_outputs give every chunk but the last exactly its least and the last the rest, never under it. Contract outputs are sized at a base address (+0.12 ₳, known).
- value_size matches the ledger's MaryValue encoding. With 20 tokens to a chunk no build.rs output nears 5,000 bytes.
- most_fee is odd only when nothing stays, so the measured draft never leaves 1 lovelace of change, and the collateral's checked_sub keeps a too-large most_fee from being drafted.
- split, stage and remainder: the rest is never under rest_minimum, contract change never under minimum_deposit, and lovelace and token arithmetic is all checked.
- carried() reads exactly the carry (the wallet address, rest_lovelace, no tokens) and refuses ambiguity.
- is_payable refuses undecodable, non-prime-order and identity points. Every payee-register path checks it: transfer payments, Payee::Seedelf, RestTo::Seedelf and both mints. change_owner is always the user's own register.
- Overflow: the 1.7.0 sweep of build.rs (git e8b007f8, ovf-sweep-build-a/b) still holds, since build.rs hasn't changed since 088ffd64 and core/wasm are identical to web-wallet/1.9.1. The latent budget fold at 1989-1994 is still reached only by the non-exported finish_mint, finish_transfer, finish_withdraw and finish_remove (lib.rs 2442, 3145, 3539, 5042). finishAccountMint goes through AccountMint::settle, which has no fold.
- account_payment: the picked totals saturate. held and holding's have see only fitting's set. staying = held − asked never underflows. Every UTxO holding a picked token is spent (documented), so recipients get exactly what they asked.
- with_account: the account key isn't the one-time key; every input and the collateral are under the account's key on this network; nothing is spent twice; the collateral is ADA-only; settle counts both signatures.
- Patches (certificates, withdrawal, votes, note) go into every draft settle prices (signed_size → built_with) and into the final build, before any signing. Staking deposits and refunds enter account_payment through net(); the launch's cert 0 deposit enters ScriptSpend through deposit_at(key_deposit).
- Signers for account payments are counted by payment_cred. account.ts keeps only rows whose payment_cred maps to a derived path, so the count isn't short.
- Remove (wasm remove_spend → payable_address; CLI remove.rs:45) and sweep_all check the destination before change_to.
- The output shuffle is Fisher-Yates over OsRng (lovejoin/mod.rs:2600).
- measure_locally resolves only inputs and reference inputs, which is all eval::evaluate_with needs; collateral needs no row.

## Notes

- No new fact on the latent budget fold (build.rs:1989-1994): it stays unreachable, as 1.7.0's sweep recorded.
- SPEND_BUDGET_GUESS (450M steps) makes estimate() call 23 or more owned inputs TooMany (23 x 450M > 10G), where the measured about 338M each would let about 29 go. The web wallet then splits into parts at one extra fee, and its parts take 20 or fewer anyway, so this isn't a refusal.
- FIRST_DRAFT_FEE (200,000) is above an account payment's real fee (about 168k to 190k). Change that is dust at 200k but valid at the real fee is called short, a window of about 0.03 ₳. Selection then adds an input, or refuses if there's none. The constant's doc comment states it.
- is_payable accepts a register whose discrete log is public, e.g. public value = generator (x = 1). Anyone could take a payment to it, just as with the identity it refuses. Only the recipient can make such a Seedelf, so the risk is theirs; for the owner this is consistency only.
- account_payment spends every UTxO holding a picked token (move_in's documented rule). A token spread over a few hundred account UTxOs (per-epoch token rewards, say) makes any send of it TooLarge, and a hundred or so costs about 0.24 ₳ more fee. Coin control's locks are the way out.
- The 0.12 ₳ base-address premium on contract minimums is known (lovejoin_box_value_test.rs:32-37). It accounts for 1.2 ₳ of r2a#3's 18.58 ₳; the rest comes from the count of outputs.
- A stranger's bundle too big to re-make as change (about 900+ tokens, TooLarge) is handled better than a 200-token one, because apart moves past Failed orders. The blind path (the CLI, and a web wallet after a restore) returns the error at once (build.rs:2577, `Err(e) => return Err(e)`) when its lovelace order reaches the bundle before a paying set, so the CLI fails a payment its other UTxOs pay. This is r2a#3's class; the callers are R4's and W1a's.
- Pallas's build_babbage_raw unwraps PositiveCoin::try_from(amount), so a zero token amount would trap. Every build.rs path refuses a zero amount from its callers, and honest rows never list one.
- Cross-lane, for W1a/W1b: WebAssembly's Worth::adds (lib.rs:3720-3731) saturates a UTxO's worth at 0, so a bundle whose tokens need more than it holds ranks with bundles at their least rather than last. measured_or_more (lib.rs:3198) re-picks by lovelace with max_inputs, which takes such a bundle too (r2a#2, r2a#3).

## Coverage

Read in full, line by line:
- seedelf-platform/seedelf-core/src/build.rs, all 3,922 lines (identical to web-wallet/1.9.1);
- seedelf-core's transaction.rs, utxos.rs, assets.rs, address.rs, data_structures.rs and constants.rs.

Read where build.rs calls them:
- staking.rs: the Staking methods none, withdraw, of, drep, is_empty, registers_scripts_alone, signers, deposit, deposit_at, refund, net and patch, plus is_scripts and vote_delegation;
- eval.rs lines 1-330: refusal, unreadable_datum, resolve_row, resolve, resolve_outputs, seedelf_references, evaluate_with's resolving;
- lovejoin::shuffle;
- seedelf-crypto: register.rs's is_valid, rerandomize and is_owned; schnorr.rs's z encoding;
- pallas-txbuilder 0.35.1's conway.rs (input sorting, redeemer indexes, output encoding) and pallas-addresses 0.35.1's has_script.

Followed out of build.rs:
- WebAssembly lib.rs: move_in (532-583), merged_return (1345-1385), transfer_spend, build_transfer and measured_or_more (3075-3230), payable_address (3263), Worth (3702-3733), remove_spend (5011-5055), checkPayableAddress (6729), and the finish_* exports;
- the extension: background/destination.ts (checkPayable), move-in.ts build, account.ts rows, script-spend.ts (readContract, spendable, tokensKept);
- the tests apart_test.rs (fixtures and three tests), mint_test.rs (the payable-address block) and lovejoin_box_value_test.rs's header.

Settled lists checked:
- backlog.md in full;
- review-1.9.1.md in full;
- review-1.7.0.md's review and sweep sections, and its two build.rs overflow-sweep reports from git e8b007f8;
- independent-review M6 and L39;
- privacy.md's co-spending section;
- chunk-10-withdraw.md;
- searches across docs/archive/plans for each candidate.

The figures in r2a#2 and r2a#3 are worked out by hand from the fixture parameters and Pallas's encoding, not run. Fees are estimates (±0.05 ₳), and nothing turns on them.

Skimmed or not reached:
- eval.rs past the cost models;
- note.rs, withdraw_zero.rs, cbor.rs, orders.rs;
- the Lovejoin builders that chunk tokens the same way (R3a);
- WebAssembly's parts planner (W1a);
- the CLI's commands (R4);
- the review screens that show the figures (E8b, E9a).
