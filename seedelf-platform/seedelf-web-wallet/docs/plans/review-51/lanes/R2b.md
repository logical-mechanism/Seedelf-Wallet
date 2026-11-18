# Lane R2b

Returned by the workflow's agent `ae506aa292ac876de`, written here by the lead from its structured answer.

## Findings (4)

### r2b#1 · low · A key address whose stake part is a script is refused as "a script's address", though the ledger takes it and only its key can spend it

- **Where:** `seedelf-platform/seedelf-core/src/build.rs:3282`
- **Who:** user · **Since:** 6daafe6f (2026-09-23, before 1.0.0); `is_not_a_script` is the CLI's rule from 61d1dcd6 (2024-12-05) · **Confidence:** traced
- **Needs the owner:** It removes a refusal that chunk 10's plan wrote down ("no script in the payment or the delegation part") and that mint_test pins, so it changes which addresses Send and Make public accept. The owner's 2026-10-19 rule (refuse only what the ledger refuses) came after that plan.

**Scenario:**

The user pastes a mainnet address `addr1y…` (CIP-19 type 0b0010: payment key hash, stake script hash; for example a payee whose staking is a multisig or protocol script) into public Send, Make public, or a private Send to an address. `checkPayable` calls WebAssembly's `checkPayableAddress`, `is_payable_address` returns false, and the screen says: "That's a script's address. Seedelf Wallet pays only ordinary addresses: a payment to a script could be locked there for good." The payment is refused. The ledger takes an output to that address, it needs no datum, and only the payee's payment key can spend it, so nothing could be locked. The CLI's sweep and remove refuse the same address, and its create, fund and util extract refuse it as the payer's own address.

**Evidence:**

build.rs:3277-3284: `/// … A script output would carry no datum, which locks it at most scripts.` `pub fn is_payable_address(addr, network_flag) -> bool { matches!(addr, Address::Shelley(_)) && is_not_a_script(addr.clone()) && is_on_correct_network(addr.clone(), network_flag) }`. address.rs:63-65: `is_not_a_script(addr) = !Address::has_script(&addr)`. pallas-addresses 0.35.1 lib.rs:519-521: `ShelleyAddress::has_script = self.payment().is_script() || self.delegation().is_script()`, so a script stake part alone makes it "a script". Reached through account_send_many (build.rs:787 `Payee::Address(to) => check_payable(to, network_flag)?`), check_address (build.rs:3286, used at 3324 and 3545 for Make public and paying an address from the private side), wasm lib.rs:3263-3273 `payable_address`, and extension background/destination.ts:84-98 `checkPayable`. That function maps every refusal on the right network's prefix to `worker.address.script` (en.json:3034, the text quoted in the scenario). In the CLI: sweep.rs:139 and remove.rs:45 call `is_payable_address`; create.rs:50, fund.rs:85 and util/extract.rs:48 call `is_not_a_script` on the payer. seedelf-core/tests/mint_test.rs:2484-2501 pins this exact shape as refused (`script_stake`: `ShelleyPaymentPart::Key([7;28])`, `ShelleyDelegationPart::Script([9;28])`, asserted `!is_payable_address`).

**Fix:**

Check the payment part, not the whole address: `matches!(addr, Address::Shelley(s) if matches!(s.payment(), ShelleyPaymentPart::Key(_))) && is_on_correct_network(..)`. Stake addresses (`Address::Stake`) and the other network stay refused, as the ledger and chunk 10's reason (no datum) require. Move mint_test's `script_stake` case to the accepted side. Other members of the class: the CLI's payer checks (create.rs:50, fund.rs:85, util/extract.rs:48) use the same `is_not_a_script`. Byron addresses never parse in `Address::from_bech32`, so they read as "That isn't a Cardano address", though the ledger takes them too (lower priority). Whether a stake part that is a Lovejoin pool's `mix_logic` should be refused stays the backlog's open call (chunk 43's Step 5), separate from this one.

**Known check:**

Read backlog.md whole. Grepped docs/ and docs/archive/plans/ for is_payable_address, has_script, is_not_a_script, "script stake", "stake part is a script", "staking part is a script", franken. Only chunk-10-withdraw.md:28 (the decision row "Script addresses are refused, as in the CLI (the output carries no datum)") and :45/:123 (work item "no script in the payment or the delegation part"), architecture.md:112 ("no script in it"), and launch-review #42 (a franken address shown as change, which is a different issue). Nothing is in Declined, any review's Not fixed list, or a chunk's leftovers. The backlog's ❓ on a pool's mix_logic stake part is about a site's payment.

### r2b#2 · low · CLI `fund` says "Not Enough Lovelace/Tokens" when its ADA sits in token UTxOs larger than the one holding the token being sent

- **Where:** `seedelf-platform/seedelf-core/src/utxos.rs:258`
- **Who:** user · **Since:** 199ed4af (2024-12-12, the CLI's selector); the same skip survived the rework in 73762b4a (2026-05-20); every CLI release · **Confidence:** traced

**Scenario:**

A CLI user's CIP-30 address holds UTxO A (50 ₳ and 1 of an unrelated token X) and UTxO B (1.5 ₳ and 100 of token Y). It has no ADA-only UTxO, or only ones of exactly 5 ₳, which `collect_address_utxos` drops as an assumed collateral. `seedelf-cli fund --lovelace 10000000 --assets <Y>=100` calls `utxos::select`. A sorts first (token UTxOs, largest first) and is skipped, because it doesn't hold Y and Y hasn't been found yet. B is taken, giving 1.5 ₳ and Y. The loop ends below 10 ₳, `select` returns an empty list, and fund bails "Not Enough Lovelace/Tokens". The address holds 51.5 ₳ and Y, enough for a payment the ledger would take. Wallets that put tokens into their change make this layout common.

**Evidence:**

utxos.rs:202-208 sorts no-token UTxOs first, then by lovelace, largest first. :238 `if utxo_assets.any(tokens.clone()) && !found_assets.contains(tokens.clone())` takes a token UTxO only if it holds a needed token. :258 `if !added && current_lovelace_sum < lovelace && found_assets.contains(tokens.clone())` takes one for its ADA only once every token is found. A UTxO passed before that point is never visited again. :269 needs `current_lovelace_sum >= lovelace`; otherwise :305-311 `Ok(Vec::new())`. fund.rs:133-142 `utxos::select(&params, every_non_collatreal_utxo, lovelace, selected_tokens.clone())?; if usable_utxos.is_empty() { bail!("Not Enough Lovelace/Tokens") }`. The trace above: A gives any(Y)=false and contains(Y)=false, so it's skipped; B gives current=1.5 ₳ < 10 ₳; then the end, and an empty list. create.rs:78 and util/extract.rs:130 pass no tokens, so the :258 branch reaches every token UTxO for them and they are unaffected. A test that would show it, in seedelf-core/tests/utxos_test.rs with its helpers: `utxos::select(&fixture_params(), vec![token_utxo(0x01, 50_000_000, &[(PID_EXTRA, "bb", 1)]), token_utxo(0x02, 1_500_000, &[(PID_NEEDED, "aa", 1)])], 10_000_000, need_token())` returns an empty Vec today.

**Fix:**

Take every UTxO holding a needed token first, then add ADA from the rest (ADA-only before token UTxOs, largest first) until the goal and the change floor are met. That is `build::account_payment`'s order (mandatory holders, then the rest sorted). A smaller fix is a second pass over the UTxOs skipped before the tokens were found. Or move `fund` onto the web wallet's network-free `build::move_in` / `account_send_many` with a `Payee::Seedelf`, which would also retire `select` (its only callers are the CLI's create, fund and util extract). The class is any one-pass selector that drops a UTxO for good before a later condition becomes true.

**Known check:**

Grepped docs/ and archive/plans for do_select, utxos::select, "largest first", "Not Enough Lovelace": only descriptions of the CLI's order (chunk-09 plan item 4, privacy.md:173, architecture.md:137). The backlog's "The CLI" section names only sweep's 21-token default. git log on utxos.rs: 73762b4a fixed two other select bugs (None vs empty asset lists, unsorted parse failures), not this one.

### r2b#3 · nit · A failing certifying script would be labelled "propose": uplc 1.1.23 names a Cert redeemer "Publish", which `ogmios_purpose` doesn't map

- **Where:** `seedelf-platform/seedelf-core/src/eval.rs:378`
- **Who:** nobody · **Since:** 4bcf0964 (2026-09-25) · **Confidence:** traced

**Scenario:**

A transaction measured in the wallet whose Cert redeemer fails would come back as Ogmios's error naming `{purpose: "propose"}` instead of "publish". No transaction the wallet builds has a Cert redeemer, so nothing reaches this today.

**Evidence:**

eval.rs:374-383: `match tag.to_ascii_lowercase().as_str() { "spend" => "spend", "mint" => "mint", "cert" => "publish", "reward" | "withdraw" => "withdraw", "vote" => "vote", _ => "propose" }`. uplc 1.1.23 src/tx/phase_one.rs:403-412 `redeemer_tag_to_string`: `RedeemerTag::Reward => "Withdraw"` (mapped) and `RedeemerTag::Cert => "Publish"` (falls to `_`). eval.rs:355-363 passes that string. `ScriptSpend::with_staking` (build.rs:1758) takes only `registers_scripts_alone` certificates, which need no redeemer.

**Fix:**

`"cert" | "publish" => "publish"`.

**Known check:**

No mention of ogmios_purpose or "Publish" in docs/ or archive/plans.

### r2b#4 · nit · `asset_id_to_asset` is dead code that panics on a short or non-ASCII id

- **Where:** `seedelf-platform/seedelf-core/src/assets.rs:367`
- **Who:** nobody · **Since:** unknown · **Confidence:** traced

**Scenario:**

Nothing calls it. A future caller passing an asset id under 56 bytes, or one with a multi-byte character at byte 56, would panic: a trap in WebAssembly.

**Evidence:**

assets.rs:367-370 `Asset::new(asset_id[..56].to_string(), asset_id[56..].to_string(), 1)` slices without a length or boundary check ("Assume NFT for now"). grep for asset_id_to_asset finds no caller in seedelf-core, seedelf-wasm or seedelf-cli.

**Fix:**

Delete it, or use `get(..56)` and refuse in words.

**Known check:**

grep across seedelf-platform: the definition is the only hit.

## Guards (28)

| Where | What it stops | Test |
|---|---|---|
| `seedelf-platform/seedelf-core/src/note.rs:83` | A note patched after signing, which would leave signatures over the old body hash | None isolating it. note_test.rs:211-212 asserts is_err on a transaction that already holds the note, so note.rs:88's metadata guard fails it first, and reverting :83 would leave that test green. |
| `seedelf-platform/seedelf-core/src/note.rs:88` | Overwriting existing metadata or its hash | note_test.rs:208-209 |
| `seedelf-platform/seedelf-core/src/staking.rs:457` | Certificates, withdrawals or votes patched after signing | staking_test.rs:772-773 ("never after signing") |
| `seedelf-platform/seedelf-core/src/staking.rs:463` | A second patch overwriting certificates, withdrawals or votes already in the body | staking_test.rs:771 ("only once") |
| `seedelf-platform/seedelf-core/src/staking.rs:211` | Building a withdrawal Conway refuses (the vote isn't delegated) | staking_test.rs:404-417 |
| `seedelf-platform/seedelf-core/src/staking.rs:309` | A DRep retirement with a guessed refund of 0 | staking_test.rs:1020 |
| `seedelf-platform/seedelf-core/src/staking.rs:330` | Two votes on one governance action | staking_test.rs:1026 |
| `seedelf-platform/seedelf-core/src/staking.rs:443` | A deposit larger than inputs plus rewards plus refund underflowing the transaction's balance | staking_test.rs:552 (a_staking_transaction_still_spends_a_utxo_and_explains_a_shortfall) |
| `seedelf-platform/seedelf-core/src/withdraw_zero.rs:96` | A withdraw-zero patched after signing | withdraw_zero_test.rs:155 |
| `seedelf-platform/seedelf-core/src/withdraw_zero.rs:108` | Overwriting another account's withdrawal, which would also make the Reward index-0 redeemer point at the wrong account | none found |
| `seedelf-platform/seedelf-core/src/withdraw_zero.rs:114` | A script data hash recomputed without the witness datums (the node would refuse it) | none found |
| `seedelf-platform/seedelf-core/src/withdraw_zero.rs:120` | Rewriting map-form redeemers as a list, with a hash over the wrong bytes | none found |
| `seedelf-platform/seedelf-core/src/withdraw_zero.rs:135` | A stale script data hash after the Reward redeemer and its budget change | withdraw_zero_test.rs:30 (the_script_data_hash_is_the_chains), :85 |
| `seedelf-platform/seedelf-core/src/eval.rs:63` | Measuring a row whose reference script isn't carried over, which gives a wrong evaluation | mint_test.rs:2321 area; wasm lovejoin_flows_test.rs:1070 |
| `seedelf-platform/seedelf-core/src/eval.rs:82` | A datum nested thousands deep overflowing the WebAssembly stack in Pallas or uplc (a trap) | cbor_test.rs:111, :135 |
| `seedelf-platform/seedelf-core/src/eval.rs:157` | A token listed twice past a u64 trapping the module | eval_test.rs:247 |
| `seedelf-platform/seedelf-core/src/cbor.rs:102` | Untrusted CBOR deeper than MAX_DEPTH reaching a recursive decoder | cbor_test.rs:45, :57 |
| `seedelf-platform/seedelf-core/src/cbor.rs:113` | Trailing bytes after one item passing as readable | cbor_test.rs:68 |
| `seedelf-platform/seedelf-core/src/assets.rs:68` | A token total wrapping past a u64 | Indirect: utxos_test.rs:333 (fitting relies on merge failing) |
| `seedelf-platform/seedelf-core/src/assets.rs:93` | A token amount underflowing in separate/sub | none isolating found |
| `seedelf-platform/seedelf-core/src/assets.rs:240` | Subtracting an absent token inserting a phantom positive amount into the change | assets_test.rs:249 |
| `seedelf-platform/seedelf-core/src/assets.rs:156` | A zero-quantity token in a CLI ask | assets_test.rs:197 |
| `seedelf-platform/seedelf-core/src/utxos.rs:423` | A transaction whose token totals pass a u64 (a stranger's three UTxOs of 2^63-1) | utxos_test.rs:333 |
| `seedelf-platform/seedelf-core/src/utxos.rs:363` | Pricing a reference script it can't measure as 0 bytes, which gives a short fee | utxos_test.rs:442 |
| `seedelf-platform/seedelf-core/src/utxos.rs:44` | An undecodable or identity register stopping the CLI's scan, or being counted as owned (also :124) | utxos_test.rs:507, :527 |
| `seedelf-platform/seedelf-core/src/transaction.rs:93` | Change wrapping when deductions exceed the selected lovelace | proptest_core.rs (the checked-subtraction property) |
| `seedelf-platform/seedelf-core/src/transaction.rs:130` | A mint the deployed policy refuses (an index past one byte) | transaction_test.rs:145 |
| `seedelf-platform/seedelf-core/src/build.rs:3280` | A payment to a script payment part with no datum (it also refuses a script stake part: r2b#1) | mint_test.rs:2484-2510 |

## Checked and holds

- All three patches (staking, note, withdraw-zero) refuse a signed transaction. Each sets `tx_hash` from the patched bytes (`build::tx_id` hashes the body as encoded), so `BuiltTransaction::sign` signs the patched body.
- `settle` prices every draft on the patched, fake-signed transaction (`signed_size` → `built_with(staged, patches)`, with the payment signers plus `Staking::signers()`). The final transaction is built from the same staged transaction and patches, so the note's and the certificates' bytes are paid for. ScriptSpend::settle and AccountMint::settle price with patches too.
- WithdrawZero recomputes the script data hash from the exact redeemers it writes (a definite list, V3 view `{2: cost model}`, as the ledger encodes it). The Lovejoin mix and withdraw fee loops price `signed_size` on the patched transaction and measure the finished one before returning it.
- The staking patch leaves redeemers, datums and cost models alone, so Pallas's script data hash stays valid on a ScriptSpend carrying a script's cert 0, and with_staking accepts nothing else.
- The note's auxiliary-data hash is the hash of the same Pallas encoding written into the transaction. Lines stay within 64 bytes at char boundaries and are never empty; Patches applies staking, then the note.
- Staking certificates carry the deposits and refunds the ledger requires. Conway certificates hold explicit deposits; cert 0's implicit deposit is counted by deposit_at only where cert 0 is built. `net` is checked, and a withdrawal takes the whole balance. RewardsLocked matches Conway, which checks withdrawals before the transaction's certificates. A DRep is registered before the vote is delegated to it, retiring moves the account's own vote to abstain, and votes are sorted with duplicates refused.
- CIP-129 and CIP-105 DRep IDs (header 0x22/0x23) and pool IDs parse correctly, and drep_id round-trips.
- stake_signs and drep_signs are right: a script's cert 0 needs no key. pallas-txbuilder's sign keys signatures by public key, so a stake key that is also an input's payment credential adds one witness (the fee then counts it twice, a harmless overestimate).
- eval.rs: uplc 1.1.23 sorts each output value itself (script_context.rs sort_value), so `resolve`'s bytewise BTreeMap order can't change a script context. Every input and reference input must be in `known`; phase one doesn't need the collateral. Budgets come back per redeemer by tag and index; MEASURE_LIMIT's (cpu, mem) order matches eval_phase_two_raw's `initial_budget`.
- slot_config is the Shelley start on both networks: mainnet 1596059091000 ms at slot 4492800, preprod 1655769600000 ms at slot 86400. slot_at saturates below it.
- cbor::walk doesn't recurse. It checks depth before pushing, counts an empty definite container as done, lets a break close only an indefinite container, uses checked_mul on map counts, and refuses trailing bytes. minicbor 0.25's skip, used on scalars and by `embedded`, doesn't recurse either (alloc feature).
- blstrs 0.7.1 `G1Affine::from_compressed` checks both on-curve and subgroup membership, so `is_owned` can't take a stranger's torsion register as ours, and identity points are refused. koios's register_of_datum reads token by token, so a deep datum at the contract is only "not a register".
- seedelf_token_name matches 5b82530's token_name.generate: a 15-byte label, one index byte (Rust refuses past 255, as V3's consByteString does), 32 bytes, the smallest input by (tx hash, index), which is the ledger's first input.
- constants.rs sizes the scripts at 629 and 519 bytes, matching references.rs's script refs as the ledger counts PlutusBinary (the CBOR-wrapped flat).
- computation_fee's f64 prices can't under-charge at mainnet sizes: the f64 error is about 1e-10 against exact prices' 1e-7 granularity. Ceiling per redeemer over-charges by under 1 lovelace each, and every caller passes (mem, steps) in order.
- Assets: add and sub are checked, sub of a missing token is refused, and zeros are dropped after sub. WebAssembly's assets_of and account_payment's picked map merge duplicates and refuse zero. `fitting` (always given an empty base) bounds every token total to a u64 before account_payment's plain `held` sum.
- calculate_min_required_utxo's 5 ₳ placeholder encodes in the same 5 bytes as any real minimum. Only a coin of 4294.97 ₳ or more encodes longer, far above any minimum.
- Every UtxoResponse the local evaluator takes goes through resolve_row or resolve_reference, or is the wallet's own output (resolve_outputs) or the bundled references. Selection paths filter `eval::refusal` before building.

## Notes

- Settled, with a new fact for the owner: the Seedelf minimum is sized at a 57-byte base address (`wallet_minimum_lovelace_with_assets` → `address::dummy_base_address`), but contract outputs have gone to the 29-byte enterprise address since 2c67e94c (2026-05-19). That is 28 × coins_per_utxo_size = 120,680 lovelace an output too high (transaction_test pins 1,456,780; the ledger's figure for the enterprise output is 1,336,100). Chunk 34 (session 1, call 28, 2026-10-17) kept it. The new fact: it is also a refusal, and the owner's refuse-only-what-the-ledger-refuses rule came two days later (2026-10-19). build.rs:3235-3241 (`payment_outputs`) refuses "A payment to a Seedelf needs at least 1.456780 ADA" for any ADA-only payment between 1.336100 and 1.456779 ₳, `deposit_outputs` (build.rs:377-384) does the same, and the CLI's fund refuses `--lovelace` below it (fund.rs:76-80). The web wallet raises a smaller amount to it, so the payer gives the recipient up to 0.12 ₳ more than the ledger requires, per output.
- Settled (chunk 40, 2026-11-02: the burn at #256, "a narrow edge of the wallet's input selection. No fix requested"), with the mint side as a new fact. `account_mint` (build.rs:3895-3898) calls `seedelf_token_name(..)?` for each k, and its refusal is not NotEnough, so the first k whose smallest input is output #256 or later ends the whole account-paid mint. It doesn't try the next k or leave that UTxO out. If the account's largest ADA-only UTxO is such an output (an exchange batch to enterprise addresses, or a stranger's 257-output transaction, which fits 16 KiB), every account-paid mint is refused until that UTxO is spent or locked. The CLI's create (create.rs:99) behaves the same. A private mint can't hit it: a contract output with a register datum is about 150 bytes, so #256 can't fit in 16 KiB.
- Dependency behaviour, not a finding: uplc 1.1.23's transaction path (tx/eval.rs do_eval_redeemer) treats a script as passing when `eval_result.result()` is Ok. It never applies V3's unit-return rule (`EvalResult::failed(false, V3)`), so a V3 script that returns False or another non-unit value passes locally and fails on chain. Every Seedelf and Lovejoin script is Aiken, which errors instead, so it doesn't bite today. It would weaken `check_cancels`' dry run only for a V3 order script from another compiler that returns rather than errors. Recheck if orders.json ever pins one.
- For X3 and T1: pallas-txbuilder 0.35's `Output::add_asset` sums a repeated (policy, name) with a plain `+=`. Pallas isn't among the wasm-release packages with overflow checks (Cargo.toml:59-66), so it would wrap silently. Every core caller passes deduplicated Assets (`Assets::add` merges with checked_add) or a single token, so it holds today. A new caller adding one token twice to one output would not.
- utxos::fitting's doc says every UTxO fits on its own, so spending again from `left` always takes one. That holds only because every caller passes an empty base (build.rs:881, 2556, 2914, 3808). A non-empty base could leave a UTxO out for good.
- transaction::extract_budgets returns budgets in answer order. Its one caller, the CLI's util extract, has a single redeemer, so order can't matter there. Any new caller should use build::Budgets::from_ogmios, which matches by purpose and index.
- CLI only, possibly deliberate: collect_address_utxos (utxos.rs:153) drops every ADA-only UTxO of exactly 5 ₳ as "probably the collateral". fund runs no script and needs no collateral, so there it can turn a payable fund into "Not Enough Lovelace/Tokens" when the user's ADA sits in 5 ₳ UTxOs. The owner's no-paternalistic-guards rule may or may not want it kept.
- For T1: withdraw_zero.rs:108, :114 and :120 have no test, and note.rs:83 has none that isolates it (note_test.rs:211 fails at the metadata guard first). See guards.

## Coverage

Read in full, every line: transaction.rs, eval.rs, cbor.rs, note.rs, staking.rs, withdraw_zero.rs, utxos.rs, assets.rs, address.rs, constants.rs, data_structures.rs, lib.rs. references.rs: read its structure and the script-ref headers (sizes 629/519); the frozen hex bodies were skimmed, not decoded. Followed values into: build.rs (linear_fee, reference_script_fee, settle, Patches::apply, signed_size, built_with, tx_id, account_payment and build_account_payment, deposit_outputs, change_outputs, minimum_deposit/seedelf/address payments, payment_outputs, is_payable_address/check_payable, ScriptSpend::with_staking, with_account's at_signer, measure_locally, measuring_draft, the head of settle, account_mint, mint_from); lovejoin/mod.rs's mix and withdraw stage and measure loops (the WithdrawZero callers); wasm lib.rs (payable_address, assets_of, picked_of, withdrawing, sign_staking, shared_stake_address); extension background/destination.ts checkPayable and en.json's message; CLI fund.rs and util/extract.rs selection, plus the create/sweep/remove payable checks; seedelf-crypto register.rs (is_owned, rerandomize, is_valid); koios register_of_datum; the core tests for these modules (names and the lines cited). Third-party code read: uplc 1.1.23 tx.rs, tx/eval.rs, tx/phase_one.rs and script_context sorting; pallas-addresses has_script and network; pallas-txbuilder add_asset and sign; minicbor 0.25 skip; blstrs 0.7.1 from_compressed. Not reached: Budgets internals and the full body of ScriptSpend::settle (R2a), orders.rs's evaluation and check_cancels (R3b), the Lovejoin launch's cert-0 path beyond deposit_at (R3b), the data layer's copy of the depth walk (out of scope) and the extension's copy beyond a glance, and any test files other than those named. Nothing was run: no tests, no builds, no network.
