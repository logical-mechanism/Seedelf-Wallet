# 1.9.0's release review: the v-v4-build verifier

The verification, told to refute. Verbatim from its structured report; full addresses of third parties shortened.

## Coverage

Read: COMMON.md and claims-v4-build.md. minswap.ts: estimate, buildTx, routed, excludedProtocols, MAINNET_PROTOCOLS, builtOutputs. sessions.ts: routeOf, quoteOf, order() at 4119-4161, inspect, refuseOddities, checkOrder at 6644-6686, withinFunding at 6556-6568, dexOrderAt, and approved's type at 394. seedelf-core orders.rs: read, fills_once, the V4 arm at 504-514, Session::owns. orders.json's V4 entry and order_cancels.json's V4 fixture. wasm lib.rs: read_dex_order and check_order_cancels. cip30.rs inspect_tx: signers, required signers, own_address at 499-511. Also the chunk-47 plan, PR #377's body (gh pr view, read-only), architecture.md 644-669, privacy.md:108, flows.md 469-475, the cost rows in Swaps.tsx, and the SDK text the v4-orders lane saved.

Ran:
- (1) Koios x2, UA seedelf-review. address_info for the ten senders of Minswap-built V4 orders in the v4-orders lane's saved chain data; the repo fixture's own sender holds nothing now. Then account_info for their stake keys.
- (2) The real Minswap class with a capturing fetch, in a Vitest probe in my own worktree, so the request bodies are exactly the runner's.
- (3) Minswap estimate x2 and build-tx x2, POST to https://agg-api.minswap.org/aggregator/{estimate,build-tx}. Nothing was signed or sent, and no key was used.
- (4) Decoded both builds with python3 -I scripts.
- (5) The wallet's own checks in Vitest, over the main tree's wasm/pkg: builtOutputs, quotesTheAsk, uncheckedProtocols, outOfPlace, readDexOrder via dexOrderAt, checkOrder, checkOrderCancels (V4's real script from the pinned reference, with core's mainnet params fixture), and withinFunding's arithmetic (copied, as it isn't exported).
- (6) Three cap mutations of build A through the same checks.
- (7) Re-ran the finder's v4_fees.py over the saved Koios data, offline.
- Worktree removed; the main tree is untouched.

Not done:
- I didn't drive the runner end to end (sessions.advance with the build re-keyed to a test session). So for these builds, refuseOddities, inspectSessionTx and signAndSend are traced from the body, not run: body keys 0,1,2,3,7 only, both inputs the sender's, no required signer, mint, certificate, withdrawal, vote, proposal, donation or collateral.
- No ADA-in pair tried. Plan line 32 says Sundae lists no V4 ADA pool, and all 113 V4 orders in the saved sample are stablecoin-to-stablecoin. One estimate is left unused.
- Not checked: whether MinswapV2's batcher fee is taken in full (if so, v4-orders#1's class predates 1.9.0).
- The finder's ~2.5 ₳ bound with the deposit shaved is traced, not run.

Aside, not a claim under test: the repo's V4 fixture order (92eeb8cc…#0) asks at least 392,747,000 sUSDr for 400,000 USDr, about 982x its input. That probably explains its owner's cancel. Both fresh builds carry the estimate's own minimum.

## Verdicts

### routes#4: partly, none (confirmed-by-run)

**Why.** The facts in the claim hold:
- With the wallet's exact mainnet list, V4 wins live routes today.
- Every check of an order's shape runs on build-tx's answer, which exists only after funding (sessions.ts:4152). That's by design, and true of every DEX.
- Part A's evidence was orders read from chain, not a build-tx answer for a sender.

The impact doesn't hold. The free check the finder asked for has now run, and it passes. Two fresh unsigned build-tx answers, made with the runner's exact bodies, for a public mainnet sender whose stake key is unregistered (as a session's 2/i is), have exactly the shape the reader takes:
- type 1 under the sender's own staking part;
- owner Signature(stake key);
- Fixed to the sender's base address with None;
- exactly basic_order.withdraw then fee_constraint.withdraw.

They pass readDexOrder, checkOrder, the dry-run cancel through V4's real script, and withinFunding. refuseOddities' conditions hold in the body (traced). So on today's API no V4-routed swap pauses after funding, and the finder's 'different shape' doesn't occur. Six of the ten chain-read Minswap V4 senders also have unregistered stake keys, all in the same shape.

What's left is that Minswap could change its build later. That is true of every DEX, and the design handles it: the swap pauses before signing and Stop brings the funding back, so no money is lost (the finder agrees). Grade none: the step that hadn't been seen is now seen and clean.

**Evidence.** Exclude list and bodies, captured from the real Minswap class (probe-tests/review-v4-bodies.test.ts):
- exclude_protocols ["OpenDjedV1","VyFinance","MuesliSwap","SplashStable","SundaeSwapStable","CswapV1","WingRidersStableV1"]
- estimate {amount, token_in, token_out, slippage:1, exclude_protocols, allow_multi_hops:false, amount_in_decimal:false}
- build-tx {sender, min_amount_out:<est.min_amount_out>, estimate:{same, without amount_in_decimal}, amount_in_decimal:false}

Sender: addr1qxughslh…a3jp64. It placed Minswap V4 order 7b94e92b…#0 (block 14152048, USDCx to USDr). Koios: 37,798.8 ₳, 3,863,857 USDr, 7,597,001 USDCx; stake1u8awm8uq… "not registered".

Estimate A, USDr to sUSDr, 1,000,000:
- paths [[SundaeSwapV4, pool 10aceb43…]], amount_out 986007, min 976244
- total_dex_fee 1280000, deposits 2000000, aggregator_fee 1000000

Estimate B, USDCx to USDr, 5,000,000: [[SundaeSwapV4, pool 062ed639…]], min 4948019, same fees. Both answered build-tx with 200.

Build A decoded (scripts/tx_dump.py):
- body keys [0,1,2,3,7]; both inputs are in the sender's utxo_set
- out0: header 0x11, pay 07eb2fb0…, stake faed9f80… (the sender's); 3,280,000 + 1 USDr; inline datum, no script
- out1: header 0x61, 1,000,000, ADA alone (the quoted fee)
- out2-3: the sender's change
- fee 220,897; metadata 674 "Minswap: Aggregator Market Order", dexFee 1280000, deposit 2000000

Build A's datum:
- owner: Constr0[faed9f80…]
- destination: Constr0[Addr(Key b88bc3f7…, Some(Inline(Key faed9f80…))), Constr1[]]
- service_budget 1280000; max_per_execution 1280000
- config_token 012dd204…d0fb
- constraints: [[30f1fac0…, Constr2[[[USDr,1000000]],[[sUSDr,976244]]]], [267eabb9…, Constr0[]]]
- extension: Constr0[]

Build B is identical, with 5 USDCx in for at least 4,948,019 USDr.

The wallet's checks (check-a.json, check-b.json):
- quotesTheAsk true; uncheckedProtocols []; outOfPlace []
- readDexOrder(out0): {known:true, protocol:SundaeSwapV4, ours:true, stakeSigns:true, reference:c1ecddd6…#0, why:null}
- checkOrder with ownStake:true: placed [0]
- with ownStake:false it is refused 'it places a SundaeSwap order this session couldn't cancel…' (sessions.ts:6673; only pre-ownStake sessions)
- checkOrderCancels: cancels true, fee 234,928 (B: 234,972), under the 3 ₳ cap
- withinFunding: 4,500,897 (B: 4,501,029) of 6,280,000 funded; tokens 1,000,000 of 1,000,000 (B: 5,000,000 of 5,000,000)

The staking rule at sessions.ts:6675-6678, `if (!(type === 7 || (type === 1 && (part === stake || minswaps))))`, takes it with part === stake. cip30.rs:499-511 own_address takes only a key payment part, so the V4 order counts as paid out.

**Documented.** PR #377: "No live V4 swap or Stop has run. Preprod has no V4, and no mainnet test spend is planned. The first real swaps are the live run. architecture.md says so."

Chunk-47 plan step 7 (line 46): "⛔ Live, for free. Preprod can't: it has no V4. On mainnet the dry-run cancel is the check, and the first real swaps are the live one". Line 99: "Left open: V4's first live mainnet swap and Stop".

Post-funding checking is the stated design. architecture.md:669: "What stays trusted: build-tx routes again on Minswap's side… checkOrder refuses that before anything is signed". flows.md:475: "The order, once the funding is on chain: a fresh quote and Minswap's swap for the account".

The plan missed only the unsigned build-tx check, which is now done.

**The fix.** The finder's free check is right and safe:
- unsigned, never signed or sent, with no key;
- a public address that Minswap already shows on chain;
- no new request in the wallet, so no privacy-policy entry.

It has now run and passed, so nothing in the wallet needs to change, and no guard should be added.

Optional records:
- a line in architecture.md's V4 paragraph or the chunk-47 record, saying an unsigned build-tx for a public mainnet sender (USDr to sUSDr, USDCx to USDr) reads and checks clean;
- build A re-keyed to the test session, as order-cancel-check.test.ts re-keys its fixtures, as a whole-transaction regression fixture for the runner's V4 path. The existing V4 fixture already has the same datum shape.

### v4-orders#1: confirmed, low (confirmed-by-run)

**Why.** Each part of the mechanism holds, by run:
- The reader reads fields 0, 1 and 5 only.
- V4's cancel ignores the cap: the dry run passes with a 2.78 ₳ and a 3.06 ₳ cap alike.
- withinFunding bounds only the total.
- On chain the fill keeps exactly max_per_execution, including the 15 orders with a 3 ₳ budget against a 1.28 ₳ cap.

A build of A with budget = cap = 2.78 ₳ (order 4.78 ₳) passes every check. The bound is exact: a 3,059,103 cap passes and 3,059,104 is refused moreAda. That's 1,779,103 lovelace over the approved 1.28 ₳: SWAP_MARGIN less this build's network fee, taken out of what the review says comes back, while its 'DEX fee' row shows 1.28 ₳.

Impact today is nil. Both fresh Minswap builds set service_budget = max_per_execution = 1,280,000 = the estimate's total_dex_fee, and the order's ADA = DEX fee + deposits exactly.

Only Minswap, or whoever controls its answers, can reach it. The docs accept a far larger trust in Minswap (the order's minimum, 'up to the funded swap amount'). So it stays low (an edge case that can understate a cost, within a stated trust) and isn't a release blocker.

**Evidence.** Today's builds: est-a and est-b both give total_dex_fee 1280000 and deposits 2000000; both datums have service_budget 0x138800 = max_per_execution 0x138800 = 1,280,000; both orders hold 3,280,000.

Mutations (scripts/mutate_cap.py; the change is lowered by the same amount, so the transaction stays balanced), through the probe test:
- cap 2,780,000: read ours, checkOrder [0], cancel (true, 234928), withinFunding 6,000,897 of 6,280,000, passes
- cap 3,059,103: 6,280,000, passes
- cap 3,059,104: "moreAda: 6280001 > 6280000"

Chain, `python3 -I v4-orders/scripts/v4_fees.py koios/r05_recent*.json`:
- (1280000,1280000): n 71, kept 1280000
- (3000000,1280000): n 15, kept 1280000
- (2780000,2780000): n 13, kept 2780000
- (4280000,4280000): n 1, kept 4280000

SDK TxBuilder.V4.class.ts.txt:138: "Flat per-scoop fee cap (`max_per_execution`), in lovelace — also the terminal-settlement amount".

Code:
- orders.rs:511-514: `if option(datum)?.is_some() || !fills_once(fields.get(5)?) { return None; } Some((key(owner)?, vec![address(to)?]))`
- sessions.ts:394: `approved: { minAmountOut: string; fund: SwapQuote["fund"]; aggregatorFee?: string; againstPools?: boolean }`, which keeps no DEX fee
- Swaps.tsx:1451: `<Row label={tr("swaps.detail.dexFee")} value={adaText(quote.dexFee)} part />`

**Documented.** Accepted in kind, though the fee field isn't named anywhere.

sessions.ts checkOrder's comment: "The reader vouches for who cancels an order and whom it pays, not for the rest of its datum".

architecture.md:646: "the cancel's dry run through the order's own script holds the rest of the datum to what that script can spend … not a wrong minimum. That trust in Minswap stays: an aggregator acting in bad faith could take up to the funded swap amount either way (final review sessions-5)."

Plan line 48 and PR #377: "V4's cancel reads the owner alone … so nothing else in the datum can stop one."

**The fix.** Right and safe, with three adjustments:
(a) Hold the cap, not the budget. Fills take the cap, and a 3 ₳ budget over a 1.28 ₳ cap is a good order (15 in the sample).
(b) The approved record keeps no DEX fee today (sessions.ts:394). It has to be added beside aggregatorFee, with older sessions falling back to the funding bound.
(c) For a split route, hold the sum of the V4 caps to the V4 legs' dex_fee, or to total_dex_fee for a V4-only route.

This holds a third party to what the user approved, as the aggregator-fee hold does, so it isn't a paternalistic guard. A rise in Sundae's fee settings between approval and order would then pause rather than overpay, which is the intent.

Holding the extension to Void matches every order seen and both builds. It is optional, and it adds a refusal of an unseen shape that may be valid.

No new request and no privacy-policy entry.

