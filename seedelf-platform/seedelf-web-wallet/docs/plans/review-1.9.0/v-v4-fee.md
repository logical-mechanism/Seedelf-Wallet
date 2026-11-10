# 1.9.0's release review: the v-v4-fee verifier

The verification, told to refute. Verbatim from its structured report; full addresses of third parties shortened.

## Coverage

Read at 8d7c4b0c: seedelf-core/src/orders.rs (the V3, V4 and other readers, fills_once, check_cancels), orders_test.rs; sessions.ts (quoteOf, the Start swap approval, order(), inspect(), checkOrder, withinFunding, withinNet, SWAP_MARGIN); minswap.ts; ui/swap.ts swapCosts; Swaps.tsx:1451; chunk 47's plan; PR #377's body; architecture.md 644-647 and 667; flows.md 466-469; wasm/README.md readDexOrder. Third-party sources: SundaeSwap's SDK (the v4-orders lane's clone, read with git show), and SundaeSwap's public V3 contracts, cloned into v-v4-fee/third-party with no checkout, read only, never run.

Chain: 5 mainnet Koios requests, user agent seedelf-review, at least 1.5 s apart (koios.sh).
- credential_txs and tx_info for the 14 newest transactions at 07eb2f…, and tx_info for 4 saved fills whose caps aren't 1.28 ₳.
- credential_txs and tx_info for 16 V3 transactions.
- All decoded from Koios's own JSON (v4_fills_json.py, v3_fees_json.py, python3 -I on saved files), not with the finder's CBOR decoder.
- Also reran the finder's v4_fees.py and v4_orders.py on their saved files.

Minswap: 3 read-only estimate calls for USDCx → USDr: 1,000 USDCx, 300,000 USDCx, and 1,000 USDCx with V4 left out.

Probes, in my own worktree, since removed (the diffs are kept):
- cargo test -j 4 -p seedelf-core --test orders_test with CARGO_TARGET_DIR=target-v-v4-fee, under an 8G cap: the cap probe; the new module variant on 8d7c4b0c; z9 with the variant; z9 with the unchanged suite.
- npx vitest run tests/order-cancel-check.test.ts -t "review probe", run against the main tree's wasm/pkg.

The main tree was never touched; it's clean at 8d7c4b0c. I left the cargo target at ~/.cache/seedelf-review-1.9.0/target-v-v4-fee.

Not done:
- V4's validators aren't public. Whether a fill takes min(budget, cap) when service_budget < max_per_execution is unknown: no order seen had that.
- Whether other DEXes' unread fee fields are taken whole wasn't checked: Minswap V1's batcher fee, SundaeSwap V1's scooper fee, Splash's cost per step and fee.
- config_token (field 4), also unread, wasn't examined.
- Review it myself's UI wasn't driven.

## Verdicts

### v4-orders#1: confirmed, low (confirmed-by-run)

**Why.** Every part holds.

**The fee a V4 fill takes.** On chain, a V4 basic fill takes exactly max_per_execution.
- 11 of 11 fills I measured from Koios's own JSON kept exactly the cap, from orders holding 1.28, 2.78 and 4.28 ₳ caps. Two of those fills are newer than the finder's sample.
- Two orders with a 3 ₳ budget and a 1.28 ₳ cap kept 1.28 ₳, and the payout got 1.72 ₳ of the budget back. So the budget isn't taken.
- SundaeSwap's SDK agrees: max_per_execution is "the flat cap on lovelace deducted in a single scoop — also the terminal-settlement amount".

**V3's field is only a ceiling.** V3's source charges amortized_base_fee + simple_fee and only checks `max_protocol_fee >= fee`. On chain, a two-order V3 scoop took 0.974 ₳ against a 1.28 ₳ max, with the 0.306 ₳ rebate in the payout, and a one-order scoop took exactly 1.28 ₳. Writing a larger V3 max costs the user nothing. Writing a larger V4 cap costs the whole difference.

**The wallet reads neither field.** The V4 reader reads fields 0, 1 and 5, and OrderRead carries no fee. My probes show the order passes everything:
- The reader takes a cap of up to 50 ₳ as the session's own, and the dry-run cancel still passes. The cancel reads the owner alone.
- The real runner, through the real WebAssembly, signs and submits orders with caps of 2.78, 4.28 and 12 ₳.
- withinFunding is the only bound on what goes into the order.

**Money at stake.** Live quotes (1,000 and 300,000 USDCx → USDr) come back as one V4 path: dex_fee 1.28 ₳, deposits 2 ₳, Minswap's fee 1 ₳. That funds 6.28 ₳ for a token-in swap. The most a cap can take beyond the approved fee:
- about 1.77 ₳: the 2 ₳ room less the swap's fee of about 0.23 ₳;
- about 2.6 ₳ if the deposit is shaved to the payout's least ADA, about 1.18 ₳ for a one-token output;
- one V4 order per swap.

**Who can cause it.** Only Minswap's build-tx, or whoever controls its answers. A scooper can't rewrite the datum. Nothing like it is seen today: all 16 Minswap-built V4 orders have budget = cap = 1.28 ₳, and their metadata says "dexFee":1280000.

**Grade: low.** This sits inside the trust the docs state and accept. architecture.md:646 says a bad-faith aggregator "could take up to the funded swap amount either way", and 2.6 ₳ is far below that. What isn't stated anywhere is V4's own point: the cap is taken whole, unlike V3's ceiling. So the review's DEX fee row and its "what comes back" row are Minswap's word. That makes this misleading figures in an edge case only a trusted party can reach, which is low on COMMON.md's table, as the finder graded it. No real user reaches it today.

**Evidence.** **Chain, from Koios's JSON** (`python3 -I scripts/v4_fills_json.py koios/k02_tx_info.json koios/k03_tx_info_caps.json`, saved in log-v4-fills.txt):
- 84fc1426 (block 14180868, after the finder's sample): order 3,280,000 + USDCx, payout 2,000,000. KEPT 1,280,000 (cap 1,280,000, budget 1,280,000).
- bd485a38: order 5,000,000, payout 3,720,000. KEPT 1,280,000 (cap 1,280,000, budget 3,000,000).
- 0a66cca0: order 4,780,000, payout 2,000,000. KEPT 2,780,000 (cap 2,780,000).
- 8975a85f: order 7,280,000, payout 3,000,000. KEPT 4,280,000 (cap 4,280,000).
- 11 lines read `== cap`, 0 read `!= cap`.

**V3, from Koios's JSON** (`v3_fees_json.py koios/k05_v3_tx_info.json`, log-v3-fees.txt):
- a55a55a9, one order: fee taken 1,280,000 vs max_protocol_fee 1,280,000.
- 47e6fc6a, two orders: fee taken 974,000 vs max 1,280,000, below the max.
- Source, sundae-contracts lib/calculation/process.ak:191-192: `let fee = amortized_base_fee + simple_fee` and `expect max_protocol_fee >= fee`. Its own comment: "The max protocol fee that *can* be charged... some may be returned as a rebate".

**SDK** (DatumBuilder.V4.class.ts:58): "The flat cap on lovelace deducted in a single scoop — also the terminal-settlement amount".

**The reader.** orders.rs:500-515 (V4): `if option(datum)?.is_some() || !fills_once(fields.get(5)?) { return None; } Some((key(owner)?, vec![address(to)?]))`. orders.rs:274-280: OrderRead has `{ protocol, signer, pays }`, no fee. orders.rs:486-499 (V3) reads fields 1 and 3 only, skipping "max fee".

**The checks.**
- sessions.ts:6556-6563 (withinFunding): `if (lovelace > BigInt(fund.lovelace)) throw ...moreAda`.
- sessions.ts:893: `costs = total_dex_fee + deposits + aggregator_fee + SWAP_MARGIN`.
- sessions.ts:4154: the runner's quote is `quoteOf(network, asked, est)` with only aggregatorFee replaced by the approved one, so its dexFee is the fresh estimate's.
- sessions.ts:1957-1962: `approved` is `{ minAmountOut, fund, aggregatorFee, againstPools? }`, with no dexFee.
- ui/swap.ts:93-96: `cost = networkFees + dexFee + aggregatorFee ...`, `back = leaving - swapped - cost + proceeds`.
- Swaps.tsx:1451 shows quote.dexFee.

**Probe 1** (`cargo test -p seedelf-core --test orders_test review_probe_v4_cap_is_never_read`, log-probe-cap.txt). Budget/cap of 1.28/1.28, 2.78/2.78, 3/1.28, 1.28/50 and 50/50 ₳ all print `owns true ... dry-run cancel fee Some(234928) why None`. Result: ok, 1 passed.

**Probe 2** (`npx vitest run tests/order-cancel-check.test.ts -t "review probe"`, log-probe-runner.txt). A 14 ₳ order against an approved 16 ₳ funding. For caps of 1a00138800, 1a002a6b60, 1a00414ec0 and 1a00b71b00, each case prints `paused undefined ... kinds out,swap submitted 1`. Result: 4 passed.

**Minswap estimates.**
- e01, 1,000 USDCx: `total_dex_fee 1280000, deposits 2000000, aggregator_fee 1000000`, one leg SundaeSwapV4 with dex_fee 1280000.
- e02, 300,000 USDCx: the same single V4 leg, 1280000.
- e03, with V4 left out: 404 "Quote not found."

**The finder's saved files.** v4_fees.py reproduces their table. minswap_md.py finds Minswap-built orders with budget 1280000, cap 1280000, and metadata `"dexFee":{"$bigint":"1280000"`.

**Documented.** **The trust is stated and accepted.**
- architecture.md:646: "Minswap builds the order, and the wallet doesn't read its minimum back... That trust in Minswap stays: an aggregator acting in bad faith could take up to the funded swap amount either way (final review sessions-5)."
- sessions.ts:6633-6634 (checkOrder): "The reader vouches for who cancels an order and whom it pays, not for the rest of its datum".
- architecture.md:644: "no more paid out, fee included, than was funded for the swap (`withinFunding`)".
- flows.md:469: the review's warning that "the wallet relies on Minswap for that minimum ... reading it would mean decoding each DEX's order datum".

**V4's funding was checked, its cap wasn't.** PR #377 says "Funding holds without changes: Minswap quotes V4 at a 1.28 ₳ fee plus a 2 ₳ deposit, the 3.28 ₳ a real order holds." Chunk 47's step 5 says "`withinFunding` holds".

**Not stated:**
- V4's cap is the fee a fill takes whole, unlike V3's ceiling.
- The review's "DEX's fee" and "what comes back" rows rest on Minswap writing the fee it quoted. SWAP_MARGIN's own comment (sessions.ts:212) says the room "all comes back".

**The fix.** The direction is right, but it doesn't work as worded.

**The approved dexFee isn't recorded.** The runner has no approved dexFee: `approved` holds `minAmountOut, fund, aggregatorFee, againstPools`, and the quote at order time is the fresh one (sessions.ts:4154). The fix needs a new `approved.dexFee`, written at Start swap. Sessions approved before it would skip the check, as `aggregatorFee` handles sessions that predate it.

**Against the fresh quote it catches nothing hostile.** Minswap would write the same figure in its estimate as in its build.

**Use ≤, against the sum.** total_dex_fee is the sum of every leg's dex_fee, so hold the sum of the V4 orders' caps ≤ the approved figure. Equality, or a per-path match, would refuse a split route, and Minswap doesn't say which order is which leg. Two live quotes, including one for 300,000 USDCx, came back as a single V4 path, so splits aren't seen.

**It can refuse honest builds.**
- The runner re-routes at order time and lets the route change, and build-tx re-routes again (sessions.ts:4156). A re-route to V4 from a route whose DEX fee was lower, or a rise in V4's fee settings between approval and the order, would pause a swap the funding covers. Both are rare, and for USDCx → USDr there's no non-V4 route at all.
- "A larger cap it never takes": every fill seen took the cap, but all had budget ≥ cap. If budget < cap, a fill might take only the budget. That's unknown, since the validators are private, and no such order was seen.

**Its reach is V4 only.** It refuses an order the V4 contract would take, as the aggregatorFee check does, which guards the approval rather than second-guessing the user. It needs no new network request and no privacy-policy entry.

**It leaves the same exposure elsewhere.** orders.rs reads no fee field for any DEX: Minswap's "batcher fee" (line 451), Splash's cost per step and fee (lines 558 and 562, typed but not bounded).

**Drop the extension-to-Void part.** Nothing shows the extension moves money, and the plan found the cancel ignores extra datum fields.

**The proportionate option.** Since the docs accept the trust in Minswap, add one doc line: the DEX's fee, like the minimum, is what Minswap writes in the order, bounded by the funding. The check stays the owner's call.

### mutants#6: confirmed, low (confirmed-by-run)

**Why.** **The code is correct.** fills_once compares both modules by hash, in order, and the length (orders.rs:405-426).

**The tests don't cover the second module.** orders_test's V4 variants only replace the first module's hash ("another order module"), pop the second ("no fee constraint"), or push a third ("a third constraint").

**z9 survives, and the variant kills it.**
- With z9 (`.take(1)` after `.zip(SUNDAE_V4_ONE_FILL)`), the unchanged suite passes all 26 tests.
- The finder's "another second module" variant passes on 8d7c4b0c and fails under z9 with the finder's exact message. Under z9 the variant's datum reads, so any second entry is taken.

**Vitest can't stand in.** It runs a prebuilt wasm/pkg, so a Rust mutant never reaches it, and its V4 coverage is only the real order.

**Grade: low,** "a real path with no test". The finder's scenario, a non-basic module read as one fill, happens only if fills_once regresses. V4's cancel reads the owner alone, so even then Stop would bring the order back.

**Evidence.** Commands run in my worktree, with CARGO_TARGET_DIR=~/.cache/seedelf-review-1.9.0/target-v-v4-fee:
- The variant on 8d7c4b0c (log-m6-a-variant-on-8d7c4b0c.txt): `test result: ok. 27 passed`, which is the 26 tests plus my cap probe.
- z9 applied (mutant-z9.diff: `+            .take(1)`), with the variant (log-m6-b-z9-with-variant.txt): `test an_order_is_the_sessions_only_when_its_canceller_and_every_payee_are ... FAILED`, panicking at orders_test.rs:1267 with `"SundaeSwapV4" on "mainnet", another second module`; `test result: FAILED. 26 passed; 1 failed`.
- z9 with the unchanged suite (log-m6-c-z9-original-suite.txt): `test result: ok. 26 passed; 0 failed`. This matches mutants/log-z9-orders.txt.

The existing variants, at orders_test.rs:1174-1199: `items(first)[0] = bytes(&OTHER)` on `items(&mut fields(d)[5])[0]`; `items(&mut fields(d)[5]).pop()`; and `constraints.push(extra)`.

`git grep` finds V4's module hashes only in orders.rs, orders.json, the fixture, orders_test.rs and three Vitest files. None of the Vitest files varies the modules.

**Documented.** Nowhere as a gap. Chunk 47's step 6 lists "Variants for another owner or destination, a chained leg, `Self`, every other `MultisigScript`, another module, a missing or third constraint". Its "another module" covers only the first position.

**The fix.** Adding the "another second module" variant is right and safe. It's test-only, changes no behaviour, refuses nothing, and needs no network. It kills z9.

One optional addition in the same edit: mutant z5 (`pair.len() == 2` → `!pair.is_empty()`) also survives (mutants/log-z5-orders.txt, `ok. 26 passed`). A variant whose constraint entry holds three items would close it.

