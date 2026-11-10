# 1.9.0's release review: the v4-orders lane's report

Round one, a finder. Verbatim from its structured report; full addresses of third parties shortened.

## Coverage

Read: seedelf-core orders.rs (all), orders.json, orders_test.rs (V4 tests and the helpers they use), the fixture's V4 entry; seedelf-wasm lib.rs (readDexOrder, buildOrderCancel, checkOrderCancels and dex_order_tests); in sessions.ts: checkOrder, dexOrder, withinFunding, withinNet, quoteOf, order(), cancel(), cancelOf, cancelsChecked, referenceRows, inspect, liveOrders and scanNow; in minswap.ts: MAINNET_PROTOCOLS, excludedProtocols, outOfPlace, routed. SundaeSwap's SDK was cloned read-only (GitHub e32b6e2, 2026-10-27) and never run: Contract.v4.ts, TxBuilder.V4.class.ts, DatumBuilder.V4.class.ts, Contract.v3.ts and TxBuilder.V3's fee. 

Ran:
- cargo test -p seedelf-core --test orders_test: 26 passed.
- cargo test -p seedelf-wasm --lib dex_order_tests: 3 passed.
- npx vitest run tests/order-cancel-check.test.ts: 27 passed.
- Three mutants in my own worktree, since removed. The main tree was untouched and stays clean.
- Two probe tests, saved at /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/6637f822-1e93-462d-9b5e-5bd103fc4b4b/scratchpad/review-1.9.0/v4-orders/probe_tests.diff:
  - review_probe_print_the_v4_cancel prints build(&fixture("SundaeSwapV4","mainnet")).cancel as hex, which I decoded beside the real cancel.
  - review_probe_v4_and_stableswaps_share_a_cancel takes the Stableswaps fixture's datum, re-keys it with rekeyed() to the V4 session, moves the order to 0x02…#0, cancels it together with the V4 order through cancel_with(..., V4 and Stableswaps references), and asserts both are covered.
- Mutants: the guard `if option(datum)?.is_some() || !fills_once(fields.get(5)?)` was replaced by `if option(datum)?.is_some()`, by `if !fills_once(..)`, and by `if option(datum).is_none() || !fills_once(..)`.

Koios: 10 requests, at least 1.5 s apart, with user agent seedelf-review. Three of them got a 413 (the public tier caps a request body at 5,120 bytes). Data covers the 225 latest transactions at V4's order script (blocks 14,141,743 to 14,179,971, about 9 days), plus the reference, the fixture's two transactions and utxo_info on 4 orders. My scripts (CBOR decoder, tabulators) are in .../v4-orders/scripts, and the raw answers in .../v4-orders/koios.

Not done:
- The names of the module hashes, against Sundae's API. I only have the SDK's names and the withdrawals that scoops make.
- Preprod's V4.
- V3's actual scooper take. That comparison rests on the SDK's `maxProtocolFee` naming.
- Any Minswap API call.
- V4's validators are unpublished, so what `extension` and `config_token` do on the scoop path can't be known. All 113 orders carry extension Void; 112 carry one config token.

Remaining risk, not graded: config_token/OrderConfig lets Sundae swap modules without a new order script. If it did, Minswap's V4 orders would stop reading, and V4 swaps would be refused after funding, until SUNDAE_V4_ONE_FILL is updated.

## Findings

### v4-orders#1 (low, #377, traced): V4's max_per_execution is the fee the scooper takes, and nothing holds it to the approved DEX fee

**Files:** seedelf-platform/seedelf-core/src/orders.rs:504, seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:6556, seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:893, seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4159, seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx:1451

**Claim.** On chain, every V4 fill took exactly the order's max_per_execution from the order's ADA. It never took the service budget, and V3's field is only a ceiling (maxProtocolFee). Three things don't hold the cap to what the user approved:
- The reader skips fields 2–4.
- The dry-run cancel can't see the cap: the Cancel path reads only the owner.
- withinFunding (withinNet applies only to direct swaps) only caps the session's total outflow at the funding, and the review says the funding's 2 ₳ room comes back.
So a V4 order built with a cap above the quote's DEX fee passes every check, and the difference is lost.

**Evidence.** orders.rs:511-514 reads fields 0, 1 and 5 only:
`if option(datum)?.is_some() || !fills_once(fields.get(5)?) { return None; }  Some((key(owner)?, vec![address(to)?]))`

sessions.ts:
- line 893: `costs = total_dex_fee + deposits + aggregator_fee + SWAP_MARGIN`
- line 216: `SWAP_MARGIN = 2_000_000n`
- line 6563 (withinFunding): `if (lovelace > BigInt(fund.lovelace)) throw ...moreAda`
Swaps.tsx:1451 shows `swaps.detail.dexFee` = quote.dexFee.

Measured with `python3 -I scripts/v4_fees.py koios/r05_recent*.json` over Koios tx_cbor of the 225 latest transactions at 07eb2f…. For every token-to-token fill, kept = order ADA − payout ADA:
- budget 1,280,000, cap 1,280,000: n 71, kept 1,280,000
- budget 3,000,000, cap 1,280,000: n 15, kept 1,280,000
- budget 2,780,000, cap 2,780,000: n 13, kept 2,780,000
- budget 4,280,000, cap 4,280,000: n 1, kept 4,280,000

Sundae's SDK (TxBuilder.V4.class.ts) agrees: "DEFAULT_MAX_PER_EXECUTION is the per-scoop cap — the flat fee a terminal fill settles at". V3's SDK has `maxProtocolFee: Type.BigInt()`, which TxBuilder.V3's getMaxScooperFeeAmount sets to the settings' baseFee + simpleFee: a ceiling.

All 16 Minswap-built V4 orders in the sample have budget = cap = 1,280,000, which matches their metadata `dexFee 1280000`.

**Scenario.** A token-in V4 quote: total_dex_fee 1.28 ₳ and deposits 2 ₳, so the funding is 5.28 ₳ plus the aggregator fee. Minswap's build-tx writes service_budget = max_per_execution = 2.78 ₳, as 13 orders from other builders in the sample carry.
- The order holds 4.78 ₳. The amount paid out is 4.78 + about 0.23 (swap fee) + the aggregator fee, under 5.28 + the aggregator fee, so withinFunding passes.
- readDexOrder reads it as the session's, and checkOrderCancels passes.
- At the fill the scooper keeps 2.78 ₳: the user pays 1.5 ₳ more than the DEX fee they approved, out of the room the review said comes back, and nothing says so.

Bound: about 1.75 ₳ (the 2 ₳ margin less the fee). About 2.5 ₳ if the deposit is shaved too, since the payout must keep its least ADA. Only Minswap, or whoever controls its answer, can do this. It is smaller than the order's minimum, which the design already trusts Minswap for. There's no sign of it today.

**Fix.** Have read() return V4's max_per_execution, and hold it to the approved quote's dexFee in checkOrder, the way Minswap's own fee output is held to aggregatorFee. Optionally do the same for the extension, holding it to Void as every order seen carries.

### v4-orders#2 (nit, #377, traced): Two module headers date the cancel facts to 2026-10-07 and to 'each DEX's source or bytecode', which V4's aren't

**Files:** seedelf-platform/seedelf-core/src/orders.rs:20, seedelf-platform/seedelf-core/tests/orders_test.rs:4

**Claim.** orders.rs says every cancel's needs were read from real cancels and each DEX's source or bytecode on 2026-10-07. orders_test.rs says the fixtures were read on 2026-10-07. V4's entry was read on 2026-11-09, from one real cancel and the SDK; its validators aren't public. The facts listed (no validity interval, withdrawal or mint; the canceller a required signer) do hold for V4. Only the date and the basis are wrong.

**Evidence.** orders.rs:20-23: `What each cancel needs was read from real owner cancels on chain, and each DEX's source or bytecode, on 2026-10-07: no validity interval, withdrawal or mint; the canceller's key a required signer`
orders_test.rs:4-5: `The fixtures were read from chain on 2026-10-07`
chunk-47 plan: `V4's validators aren't public`

**Scenario.** A later reviewer reads the header and assumes V4's cancel was checked against source, when it rests on the SDK, one real cancel and the dry run.

**Fix.** Add V4's date (2026-11-09) and its basis (the SDK and one real owner cancel, validators unpublished) to both headers.

## What holds

- Q1 layout: the SDK's OrderDatum (Contract.v4.ts) is Constr 0 [owner, destination, service_budget, max_per_execution, config_token, constraints, extension]. The reader's indexes 0, 1 and 5 match, and all 113 datums on chain have 7 fields.
- Q1 owner: MultisigScript tags are Signature 0, AllOf 1, AnyOf 2, AtLeast 3, Before 4, After 5, Script 6. The reader takes only Constr 0 [28-byte key], and the variant test covers 1..=6.
- Q1 destination: Fixed is Constr 0 [address, Option datum] and Self is Constr 1 []. On chain, None is Constr 1 [] (d87a80) and Some is Constr 0 [x], as option() expects.
- Q1 address: address(to) reads the one form Minswap writes for a direct order, (key, Some(Inline(key))), in all 15 direct Minswap orders. Pointer, Self and script-with-datum are refused.
- Q2 reference: c1ecddd…#0 is unspent (Koios utxo_info, 2026-11-09), plutusV3, 3,128 bytes. blake2b-224(0x03||bytes) = 07eb2fb0…07ec, and its bytes equal the fixture's. It sits at a key address; if it's spent later, the carried path covers it.
- Q2 fixture: the order 92eeb8cc… (block 14,176,791, Minswap orderOptions source SundaeSwapV4, dexFee 1.28, deposit 2) and the cancel 8dc9ee14… (block 14,176,792, 'Minswap: Aggregator Cancel Order') are real mainnet transactions. Both hashes recompute from their bodies.
- Q2 modules: of the 113 V4 orders in the 225 latest transactions, 112 name [30f1fac0… basic, 267eabb9… fee]. One, not Minswap's, names [35a9eebb…, fee] under another config token (015e3f54…). All 16 Minswap orders are [basic, fee] with budget = cap = 1.28 ₳.
- Q2 Minswap shapes: one Minswap V4 order the reader refuses was seen, eb86b5ba…#0. It is a two-hop forward-adapter first leg (USDR→USDCx→USDM) with a Some datum, paying script 0e56d46a…. Both estimate and build-tx send allow_multi_hops false. outOfPlace re-asks without the DEX before funding and again in order() before building. Only a build-tx that ignored this would be refused after funding: the swap pauses and Stop returns the funding, with no order placed.
- Q2 one fill: 111 scoops in the sample each spent exactly one order and put nothing back at the script. That includes 3 ₳ budgets, whose rest came back. No fill in parts was seen.
- Q4 cancel: the wallet's V4 cancel matches the real one (decoded side by side): the order input spent with Constr 0 [] at index 0, the same reference input, the stake key 903ac01d a required signer (the wallet adds the payment key), no withdrawal, no settings or config UTxO, no validity interval (the real TTL is Minswap's own). Budget 37,471 / 11.2M against the real 34,341 / 10.3M.
- Q4 script data hash: the real cancel's 435dd19e… recomputes from its own redeemers plus the 350-entry Plutus V3 cost model (fixture epoch 658). That is the method with_integrity uses.
- Q4 sharing: V4 is Plutus V3. SundaeSwapV3 is Plutus V2, so it never shares a cancel with V4. Splash goes alone. Stableswaps is Plutus V3 but isn't routed on mainnet. V4+V4 runs through the real script (several_orders_…), and my probe ran V4 + Stableswaps through both real scripts (redeemers d87a80 and d87980). It's safe: each Cancel path needs only the session's stake key, and the wallet writes every output to the session.
- Q4 cancel is gated: without_the_cancellers_signature_every_script_refuses runs V4's script, which refuses with no signers.
- Q3 dry run: it proves the deployed script accepts the session's cancel of this exact output (Stop can bring it back). It doesn't prove the scoop path pays only the destination, honours the minimum or takes only the cap: those rest on the SDK and chain observation.
- Koios utxo_info (_extended), which liveOrders, cancelOf and restore use, gives V4 orders' inline datum bytes (4 orders checked). The plan's tx_info trap doesn't reach the cancel.
- Q5 tests: orders_test 26 passed, seedelf-wasm dex_order_tests 3 passed, Vitest order-cancel-check 27 passed (V4's real order through the runner).
- Q5 mutants: with fills_once dropped, the variant test fails at 'another order module'. With option(datum) dropped, or held to shape only, it fails at 'a datum for the destination'. Not covered: module order and duplicates, which are harmless because such an order can't meet its OrderConfig and stays cancellable.
- Preprod: the table has no V4 entry, excludedProtocols('preprod') keeps it out, and a test asserts both.
- WebAssembly bindings are thin. readDexOrder takes stakeSigns from signs_with_stake. checkOrder refuses V4 for a session without its own stake key, and takes an order of type 1 under the session's stake part, or of type 7.
