# Lane T1c

Returned by the workflow's agent `ac1e7d1c6dfd6a4db`, written here by the lead from its structured answer.

## Findings (16)

### t1c#1 · low · A stranger's box with an identity point counted and drawn into the user's mixes: no test fails without it

- **Where:** `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:453`
- **Who:** stranger · **Since:** 354ddccb (chunk 16, 2026-09-25); first tag web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

Anyone can pay a pool's mix_box a box of exactly its value whose datum is Constr 0 [c0 00…00, P] or [P, c0 00…00], with P any G1 point (so a ≠ b holds). crypto::point_from_bytes decodes c0 00… as the identity, which is in the subgroup. So PoolBox::points' identity check (mod.rs:453-455) is all that keeps such a box out. With it removed:
- PoolBox::from_resolved reads both shapes as pool boxes.
- The wallet builds a mix of one with two recorded pool boxes, and its own evaluator passes it (fee 820,583).
- owned() would count such boxes among the `others` that the pool floor counts (30 on mainnet), and fresh_for would draw them.
- A mix that draws one leaves an output whose a or b is c0 00… on chain, so the user's box hides among one fewer box than the wallet counted.
With the check removed, every Rust test of both crates passed.

**Evidence:**

Change, in T1c's copy only: deleted mod.rs:453-455 `if bool::from(a.is_identity()) || bool::from(b.is_identity()) { bail!("A box's points can't be the identity"); }`.

Runs, in T1c's copy (rsync of TREE's seedelf-platform, CARGO_TARGET_DIR under ~/.cache; each command capped: systemd-run MemoryMax=6G, timeout 30m, -j 3, --locked):
- seedelf-core --test lovejoin_test lovejoin_pools_test lovejoin_planner_test lovejoin_box_value_test lovejoin_vectors_test lovejoin_width_test lovejoin_mainnet_test lovejoin_launch_test cbor_test --lib: 120 passed.
- seedelf-wasm --test lovejoin_flows_test lovejoin_test lovejoin_pools_test lovejoin_across_test lovejoin_mainnet_test lovejoin_v2_fixture_test lovejoin_proven_bytes_test return_cost_test api_test: 171 passed.
- seedelf-core's other 21 test files: 236 passed.
- seedelf-wasm's other 6 files: 127 passed.
- 0 failed.

Probe: a test file in the copy, removed with it. It built a box at mix_box from `box_value().output(..).set_inline_datum(mix_datum(identity, P))` and the reverse. At baseline, `from_resolved` returned None for both. With the check removed it returned Some for both, and `lovejoin::mix` of the box with pool_boxes()[..2] returned `Ok: fee 820583`.

The wasm junk() rows (wasm/tests/lovejoin_test.rs:1362-1396) cover a token, no datum, off-curve points and 12 ₳, but never the identity. Removing from_row's whole points() check (mod.rs:426 → `Some(boxed)`) does fail junk_at_mix_box_is_not_counted_among_the_boxes_to_mix_with (others 15 vs 14).

**Fix:**

Add two rows to junk() in seedelf-web-wallet/wasm/tests/lovejoin_test.rs. Each holds the pool's exact value, and their datums are mix_datum(identity, P) and mix_datum(P, identity), where identity is c0 followed by 47 zero bytes and P is a register's public value. junk_at_mix_box_is_not_counted_among_the_boxes_to_mix_with then fails without the check. Alternatively, add a core test that PoolBox::from_row and PoolBox::from_resolved return None for such a box.

**Known check:**

Searched backlog.md, docs/archive/plans/ and docs/plans/ for 'mutant', 'untested', 'no test', "can't be the identity", 'is_identity', 'PoolBox::points' and 'identity point'. Nothing records this gap. The only reliance on the check is this chunk's E1b checked_ok: 'PoolBox::points refuses identity points, so no stranger's box reads as every wallet's' (see notes).

### t1c#2 · low · A pool's box ADA times a deposit's boxes wrapping past a u64: no test fails without the checked product

- **Where:** `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:775`
- **Who:** pool-launcher · **Since:** b9c35f066 (chunk 34e) and fc8561c75 (1.6.0's review); first tag web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

A pool's box_lovelace comes from its datum and can be anything up to 2^64 − 1. deposit_across multiplies it by a leg's boxes with checked_mul and checked_add (mod.rs:775-779, 'Too many boxes'). Replaced with wrapping arithmetic, every test passed. The 314-core#1 test deposits a single box of u64::MAX, which doesn't overflow this product. Its refusal comes from the later paid sum (mod.rs:804-807), and removing that one instead does fail the test (:632). Two boxes of 2^63 lovelace would wrap the product here to 0. The planner offers no box in such a pool (boxes_affordable_in returns 0), so today only a direct deposit call reaches it.

**Evidence:**

Change: mod.rs:775-779 `boxed = box_value.lovelace.checked_mul(owners.len() as u64).and_then(|b| boxed.checked_add(b)).context("Too many boxes")?;` became `boxed = Some(box_value.lovelace.wrapping_mul(owners.len() as u64).wrapping_add(boxed)).context("Too many boxes")?;`.

Runs, in order:
- lovejoin_planner_test: 13 passed.
- The core Lovejoin set: 120 passed.
- The wasm Lovejoin set without api_test: 79 passed.
- api_test: 92 passed.
- Core's other 21 files: 236 passed.
- Wasm's other 6 files: 127 passed.
- 0 failed.

**Fix:**

In lovejoin_planner_test.rs's a_pools_box_ada_past_what_a_sum_holds_is_refused_in_words_never_wrapped, also call lovejoin::deposit with two owners in the `half` pool (ada_pool_of(1 << 63)). Assert it is refused in words, never built.

**Known check:**

Searched backlog.md, docs/archive/plans/ and docs/plans/ for 'mutant', 'untested', 'Too many boxes' and '314-core#1'. The archive records 314-core#1's fix and its test, not this product. In docs/plans the only hits are this chunk's R3a and gap-G5 lanes.

### t1c#3 · low · A launch's token quantity of 0 reaching the box-value probes (check_token): no test fails without it, since value.rs gives the same words

- **Where:** `seedelf-platform/seedelf-core/src/lovejoin/box_value.rs:193`
- **Who:** pool-launcher · **Since:** 8cc00445a (1.6.0's release review, MONEY-2); first tag web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

The launch form asks wasm::box_value for the least box value of the quantity Q the pool's creator types. least_box_lovelace and way_back call check_token (box_value.rs:191-198), which refuses Q = 0 with 'A token pool's box must hold at least one of its token'. With that arm deleted, the probes reach BoxValue::output, whose own arm (value.rs:108-110) refuses Q = 0 in the same words. So every test passes, the two named by the lane included. Only with both arms gone does pallas-txbuilder panic on an output of 0 of a token: the MONEY-2 trap that locks the wallet. The pair is pinned; this check alone isn't.

**Evidence:**

Change: deleted box_value.rs:193-195 `Some(t) if t.quantity == 0 => { Err("A token pool's box must hold at least one of its token".to_string()) }`.

Runs:
- lovejoin_box_value_test: 2 passed, a_pool_of_one_token_a_box_has_a_box_value among them.
- The core Lovejoin set: 120 passed.
- The wasm Lovejoin set: 79 passed.
- api_test: 92 passed.
- Core's other files: 236 passed.
- Wasm's other files: 127 passed.

With value.rs:108-110 deleted as well (the pair), lovejoin_box_value_test a_pool_of_one_token_a_box_has_a_box_value failed: panic at pallas-txbuilder-0.35.1/src/conway.rs:312 `PositiveCoin::try_from(*x).unwrap()` on Err(0).

**Fix:**

Pin each layer on its own. Either give check_token's refusal words or a type of its own, and assert those in lovejoin_box_value_test's a_pool_of_one_token_a_box_has_a_box_value and in the wasm a_box_of_one_token_has_a_box_value_and_none_is_refused. Or keep the words and test BoxValue::output directly (t1c#4), so each check fails a test when it's alone.

**Known check:**

Searched backlog.md, docs/archive/plans/ and docs/plans/ for 'mutant', 'MONEY-2', 'at least one of its token' and 'check_token'. The only hit is chunk-34-token-pools.md:1328, which records the MONEY-2 fix and not this gap.

### t1c#4 · low · A token box of 0 of its token reaching pallas through BoxValue::output: no test fails without value.rs's refusal

- **Where:** `seedelf-platform/seedelf-core/src/lovejoin/value.rs:108`
- **Who:** nobody · **Since:** 8cc00445a (1.6.0's release review); first tag web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

BoxValue::output refuses Q = 0 (value.rs:108-110) before pallas, which panics on an output of 0 of a token: a trap in WebAssembly (MONEY-2). It is backed twice:
- ReferenceDatum::decode refuses a pool datum whose token_quantity is 0 (pool.rs:200-203), so no pool read from chain has Q = 0.
- box_value.rs's check_token refuses Q = 0 in the same words before the launch form's probes.
So nobody reaches it today. With it deleted, every test passed, including both tests the lane named. The pair is pinned (t1c#3).

**Evidence:**

Change: deleted value.rs:108-110 `Some(token) if token.quantity == 0 => { bail!("A token pool's box must hold at least one of its token") }`.

Runs, all passed, 0 failed:
- lovejoin_box_value_test: 2.
- seedelf-wasm lovejoin_flows_test a_box_of_one_token_has_a_box_value_and_none_is_refused: 1.
- The core Lovejoin set: 120.
- The wasm Lovejoin set: 79.
- api_test: 92.
- Core's other files: 236.
- Wasm's other files: 127.

The wasm test's words come from check_token, which runs first.

**Fix:**

Add a core test of BoxValue::output itself. BoxValue { lovelace: 2_000_000, token: Some(BoxToken { quantity: 0, .. }) }.output(addr) must be Err with 'at least one of its token'. That fails without value.rs's arm whatever check_token does.

**Known check:**

Searched backlog.md, docs/archive/plans/ and docs/plans/ for 'mutant', 'MONEY-2' and 'at least one of its token'. The only hit is chunk-34-token-pools.md:1328, which records the fix.

### t1c#5 · low · A paid withdraw's account change under an output's least: no test fails without it

- **Where:** `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1560`
- **Who:** user · **Since:** 4550b9ef0 (chunk 34a); first tag web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

Bring it back paid by the public account takes the account's largest ADA-only UTxO (wasm/src/lovejoin.rs:2772-2778). The fee and any top-up come out of it, and the rest is its change. `.filter(|c| *c >= least)` (mod.rs:1560) refuses a change under the ledger's least ('There isn't enough ADA left to pay this withdraw's fee and keep the change').

Take an account whose largest ADA-only UTxO is 1.2 ₳ and a fee of about 0.29 ₳. Its change is 0.91 ₳, under the roughly 0.97 ₳ an ADA output at a base address needs. With the check the wallet refuses in words; without it, the wallet builds a withdraw the ledger refuses. Removed, every test passed, because every withdraw_paid test pays from a 20 ₳ UTxO.

**Evidence:**

Change: mod.rs:1559-1560 `.checked_sub(fee + topped).filter(|c| *c >= least)` became `.checked_sub(fee + topped)`.

Runs:
- lovejoin_pools_test: 41 passed.
- The core Lovejoin set: 120 passed.
- The wasm Lovejoin set: 79 passed.
- api_test: 92 passed.
- Core's other files: 236 passed.
- Wasm's other files: 127 passed.

Every withdraw_paid call in the tests (lovejoin_pools_test.rs:1015, 1050, 1350, 1416, 1813; wasm lovejoin_flows_test.rs:657; wasm lovejoin_test.rs:2624) uses a payer of 20 ₳ or more.

**Fix:**

Add a core test. Build withdraw_paid once with a generous payer to learn its fee. Then build it again with a payer coin of fee + topped + least − 1, and assert Err containing 'keep the change'.

**Known check:**

Searched backlog.md, docs/archive/plans/ and docs/plans/ for 'mutant', 'untested' and 'keep the change'. The only hit is usability-review.md, which is about a screen, not this check.

### t1c#6 · low · Boxes coming back into an identity or invalid destination register: no test fails without it

- **Where:** `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1433`
- **Who:** nobody · **Since:** 354ddccb (chunk 16); first tag web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

withdraw_with refuses a destination that build::is_payable rejects (mod.rs:1433-1435). Every caller passes Register::create(sk)?.rerandomize()? (wasm/src/lovejoin.rs:2691, 2793, 2892), so nobody reaches it today. Removed, the probe's withdraw of the wallet's 10 ₳ box into Register::new(G, c0 00…) built: 9,710,388 lovelace into a register whose public value is the identity. Per the root CLAUDE.md's register invariant, anyone can spend such a register. Every test passed.

**Evidence:**

Change: deleted mod.rs:1433-1435 `if !crate::build::is_payable(&destination) { bail!("The destination register must be a valid, non-identity register"); }`.

Runs:
- The core Lovejoin set: 120 passed.
- The wasm Lovejoin set with api_test: 171 passed.
- Core's other 21 files: 236 passed.
- Wasm's other 6 files: 127 passed.

Probe (a test in the copy): at baseline, `Err: The destination register must be a valid, non-identity register`. Mutated: `Ok: 9710388 lovelace into it, fee 289612`.

**Fix:**

Add a core test: lovejoin::withdraw of our_boxes(sk, 1) with destination Register::new(Register::create(sk).generator, c0 followed by 47 zero bytes) must be Err with 'valid, non-identity register'. Add the same with a destination whose bytes aren't a point.

**Known check:**

Searched backlog.md, docs/archive/plans/ and docs/plans/ for 'mutant', 'non-identity register' and 'destination register'. The only hit is this chunk's R3a guard list.

### t1c#7 · low · A deposit's box paid under an identity or invalid register: no test fails without it

- **Where:** `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:732`
- **Who:** nobody · **Since:** b9c35f066 (chunk 34e); first tag web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

deposit_across refuses an owner that build::is_payable rejects (mod.rs:732-734). Owners are always rerandomized from the wallet's own register (wasm/src/lovejoin.rs:1655-1658, 1753-1760, 2319-2322), so nobody reaches it today. Removed, the probe's deposit under Register::new(G, c0 00…) built a box (fee 170,737). A box under an invalid register could never come back, and one whose public value is the identity could be taken by anyone. Every test passed.

**Evidence:**

Change: deleted mod.rs:732-734 `if !crate::build::is_payable(r) { bail!("A box's register must be a valid, non-identity register"); }`.

Runs:
- The core Lovejoin set: 120 passed.
- The wasm Lovejoin set with api_test: 171 passed.
- Core's other files: 236 passed.
- Wasm's other files: 127 passed.

Probe: at baseline, `Err: A box's register must be a valid, non-identity register`. Mutated: `Ok: 1 box, fee 170737`.

**Fix:**

Add a core test: lovejoin::deposit with owners [Register::new(G, identity)] must be Err with 'valid, non-identity register'. Add the same for a register of non-point bytes.

**Known check:**

Searched backlog.md, docs/archive/plans/ and docs/plans/ for 'mutant', 'non-identity register' and 'is_payable' near Lovejoin. Nothing records this gap besides this chunk's R3a guard list.

### t1c#8 · low · A token-holding UTxO paying for Lovejoin (Coin::from_row): no test fails without its refusal

- **Where:** `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:479`
- **Who:** nobody · **Since:** 354ddccb (chunk 16); first tag web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

Coin::from_row refuses a row that holds tokens (mod.rs:479-485). Without that refusal, a token UTxO would become a Coin whose tokens no output carries: a mix's or withdraw's change of ADA alone, or a collateral return of ADA alone, both of which the ledger refuses. Every WebAssembly caller filters to ADA-only UTxOs first (wasm/src/lovejoin.rs:444, 1036, 2282, 2774), and the collateral is the session's own ADA coin. So nobody reaches it today. With it deleted, every test passed.

**Evidence:**

Change: deleted mod.rs:479-485 `if row.asset_list.as_ref().is_some_and(|a| !a.is_empty()) { bail!("UTxO {}#{} holds tokens; only ADA pays for Lovejoin", ..) }`.

Runs:
- The core Lovejoin set: 120 passed.
- The wasm Lovejoin set with api_test: 171 passed.
- Core's other files: 236 passed.
- Wasm's other files: 127 passed.
- 0 failed.

**Fix:**

Add a core test: Coin::from_row of a row whose asset_list holds one token must be Err with 'holds tokens; only ADA pays for Lovejoin'.

**Known check:**

Searched backlog.md, docs/archive/plans/ and docs/plans/ for 'mutant', 'only ADA pays', 'holds tokens' and 'Coin::from_row'. chunk-34-token-pools.md:229 only describes it, and R3b's 'holds tokens' is launch.rs's own guard.

### t1c#9 · low · A pool row away from mix_box's payment credential read as a box: no test fails without the credential check

- **Where:** `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:416`
- **Who:** nobody · **Since:** 354ddccb (chunk 16); first tag web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

PoolBox::from_row also requires row.payment_cred to be mix_box's hash (mod.rs:416). Every row it gets already has it, so nobody reaches the check today:
- The worker reads each pool by mix_box's credential, and splits a shared answer by credential (extension/src/background/lovejoin.ts:3269-3276).
- The data layer's adapter fills payment_cred with the mix box (chunk-26b-data-layer-wallet.md:180).
With the check dropped, every test passed: every test row at a pool, the wasm junk() rows included, carries the pool's credential.

**Evidence:**

Change: mod.rs:415-417 `if !protocol.box_value().is_row(row) || row.payment_cred != hex::encode(protocol.mix_box_hash) {` became `if !protocol.box_value().is_row(row) {`.

Runs:
- lovejoin_pools_test: 41 passed.
- The core Lovejoin set: 120 passed.
- The wasm Lovejoin set: 79 passed.
- api_test: 92 passed.
- Core's other files: 236 passed.
- Wasm's other files: 127 passed.

By contrast, dropping the is_row half fails junk_at_mix_box_is_not_counted_among_the_boxes_to_mix_with (others 16 vs 14).

**Fix:**

Add a row to junk() in wasm/tests/lovejoin_test.rs that holds the exact box value and a box's datum but whose payment_cred is another script's or a key's. The junk test then fails without the check.

**Known check:**

Searched backlog.md, docs/archive/plans/ and docs/plans/ for 'mutant', 'payment_cred' and 'payment credential'. The only hit is chunk-26b-data-layer-wallet.md:180, which says the adapter fills payment_cred and that from_row checks it. It records no gap.

### t1c#10 · low · A deposit's inputs' ADA summed past a u64: no test fails without the checked sum

- **Where:** `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:762`
- **Who:** nobody · **Since:** 4550b9ef0 (chunk 34a); first tag web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

deposit_across sums its inputs' ADA with checked_add (mod.rs:760-763, "The inputs' ADA overflows"). Real UTxOs can't sum past the supply, about 4.5 × 10^16 lovelace against 2^64 ≈ 1.8 × 10^19. Only a data source reporting more could pass it, and that is out of scope. So nobody reaches it. With wrapping arithmetic every test passed.

**Evidence:**

Change: mod.rs:762 `.try_fold(0u64, |sum, h| sum.checked_add(h.lovelace))` became `.try_fold(0u64, |sum, h| Some(sum.wrapping_add(h.lovelace)))`.

Runs:
- lovejoin_planner_test: 13 passed.
- The core Lovejoin set: 120 passed.
- The wasm Lovejoin set: 79 passed.
- api_test: 92 passed.
- Core's other files: 236 passed.
- Wasm's other files: 127 passed.

**Fix:**

Add a core test: deposit_from with two Holdings of 2^63 lovelace each must be Err with "The inputs' ADA overflows".

**Known check:**

Searched backlog.md, docs/archive/plans/ and docs/plans/ for 'mutant', "inputs' ADA overflows" and '314-core#1'. There are no hits for this sum.

### t1c#11 · low · One box mixed twice in a transaction: no test fails without the refusal

- **Where:** `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:992`
- **Who:** nobody · **Since:** 354ddccb (chunk 16); first tag web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

mix_with refuses boxes that dedup shortens (mod.rs:992-994). The draws never repeat a box: fresh_for draws without replacement and leaves ours out. So nobody reaches it today. Removed, the probe's mix of [b0, b1, b0] still failed, but only in the wallet's evaluator: 'A script refused this transaction (withdraw 0: the validator crashed / exited prematurely)'. Every test passed.

**Evidence:**

Change: deleted mod.rs:992-994 `if sorted.len() != n { bail!("A box can't be mixed twice in one transaction"); }`.

Runs:
- The core Lovejoin set: 120 passed.
- The wasm Lovejoin set with api_test: 171 passed.
- Core's other files: 236 passed.
- Wasm's other files: 127 passed.

Probe: at baseline, `Err: A box can't be mixed twice in one transaction`. Mutated, the evaluator's refusal above.

**Fix:**

Add a core test in lovejoin_test.rs: lovejoin::mix of [pool_boxes[0], pool_boxes[1], pool_boxes[0]] must be Err with "can't be mixed twice".

**Known check:**

Searched backlog.md, docs/archive/plans/ and docs/plans/ for 'mutant', 'mixed twice' and 'duplicate'. There are no Lovejoin hits besides this chunk's R3a guard list.

### t1c#12 · low · A mix of fewer than two boxes: no test fails without the refusal, since its test asserts only is_err

- **Where:** `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:985`
- **Who:** nobody · **Since:** 354ddccb (chunk 16); first tag web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

mix_with refuses n < 2 (mod.rs:985-987). The wallet's mixes are three or four wide, so nobody reaches it today. Removed, a one-box mix still fails, in seedelf-crypto: 'A sigma-OR needs at least two statements'. a_mix_needs_two_boxes_and_a_payer_who_can_pay asserts only `.is_err()` for the one-box case, so it passes, and so does every other test.

**Evidence:**

Change: deleted mod.rs:985-987 `if n < 2 { bail!("A mix needs at least two boxes"); }`.

Runs:
- lovejoin_test: 31 passed, the named test among them.
- The core Lovejoin set: 120 passed.
- The wasm Lovejoin set: 79 passed.
- api_test: 92 passed.
- Core's other files: 236 passed.
- Wasm's other files: 127 passed.

Probe: at baseline, `Err: A mix needs at least two boxes`. Mutated, `Err: A sigma-OR needs at least two statements`.

**Fix:**

In lovejoin_test.rs's a_mix_needs_two_boxes_and_a_payer_who_can_pay (line 254), assert that the one-box error contains 'at least two boxes' rather than just is_err().

**Known check:**

Searched backlog.md, docs/archive/plans/ and docs/plans/ for 'mutant', 'at least two boxes' and 'sigma-OR needs'. There are no hits.

### t1c#13 · low · A chain that mixes without collateral: no test fails without chain_across's refusal, since mix() refuses in near words

- **Where:** `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:2309`
- **Who:** nobody · **Since:** 0f3ee1c1f (2026-09-28); first tag web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

chain_across refuses depth > 0 with no collateral (mod.rs:2309-2311), after it builds the deposit. Removed, the chain fails at its first mix with mix()'s own 'A mix needs collateral' (mod.rs:929-932). a_seed_is_the_deposit_alone_and_needs_no_pool_and_no_collateral asserts contains("needs collateral"), which both messages match, so every test passes. The outcome is the same either way: an error before anything is signed. That makes this a third layer behind the WebAssembly's mixes_collateral, which T1f's note leans on.

**Evidence:**

Change: deleted mod.rs:2309-2311 `if depth > 0 && collateral.is_none() { bail!("A chain that mixes needs collateral"); }`.

Runs:
- lovejoin_test: 31 passed.
- The core Lovejoin set: 120 passed.
- The wasm Lovejoin set: 79 passed.
- api_test: 92 passed.
- Core's other files: 236 passed.
- Wasm's other files: 127 passed.

Probe: at baseline, `Err: A chain that mixes needs collateral`. Mutated, `Err: A mix needs collateral`.

**Fix:**

In lovejoin_test.rs:803, assert the chain's own words ('A chain that mixes needs collateral'). Or drop the check as redundant with mix()'s.

**Known check:**

Searched backlog.md, docs/archive/plans/ and docs/plans/ for 'mutant' and 'needs collateral'. The hits are chunk-35-small-fixes.md, about a different collateral message, and this chunk's T1f and gap-G4 notes on the WebAssembly's mixes_collateral, which cite this check as its backstop.

### t1c#14 · low · A fan-out deeper than three waves: no test fails without fresh_for's depth bound

- **Where:** `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:2520`
- **Who:** nobody · **Since:** 9fc12060c (2026-09-28); first tag web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

fresh_for refuses a depth outside 0 to 3 (mod.rs:2520-2522). The WebAssembly's check_depth (wasm/src/lovejoin.rs:2047-2055) bounds depth first on its chain entry points, so nobody reaches it today. Without the bound, core would plan chain(depth 4) at 40 mixes a box. From depth 21, three wide, mixes_per_box_at's `width.pow(depth)` overflows usize on wasm32, which traps. Removed, every test passed.

**Evidence:**

Change: deleted mod.rs:2520-2522 `if !(0..=3).contains(&depth) { bail!("The fan-out is 0 to 3 waves deep"); }`.

Runs:
- The core Lovejoin set: 120 passed.
- The wasm Lovejoin set with api_test: 171 passed.
- Core's other files: 236 passed.
- Wasm's other files: 127 passed.

**Fix:**

Add a core test in lovejoin_test.rs beside a_chain_needs_enough_pool_boxes: lovejoin::chain with depth 4 must be Err with '0 to 3 waves deep'.

**Known check:**

Searched backlog.md, docs/archive/plans/ and docs/plans/ for 'mutant', '0 to 3 waves deep' and 'fresh_for'. Nothing records this gap besides R3a's list. r3a#2 notes that plan_at skips check_depth.

### t1c#15 · low · A withdraw whose declared budgets are under what its own proof measured: no test fails without the covers check

- **Where:** `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1686`
- **Who:** nobody · **Since:** 354ddccb (chunk 16); first tag web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

withdraw_with takes a round only when the budgets it declares cover that round's measure (mod.rs:1686). Each round's proof is new and moves the budget by a hair. The 1% margin (with_margin(1), mod.rs:1736) has always covered it, so with `if d.covers(&measured)` dropped, every test passed: none makes a round measure past the margin. If that ever happened, the declared budgets would be under what the scripts use. The ledger would then fail the scripts in phase 2 and take the collateral: giveme.my's, or the account's own for withdraw_paid.

**Evidence:**

Change: mod.rs:1686 `Some(d) if d.covers(&measured) => {` became `Some(d) => {`.

Runs:
- The core Lovejoin set: 120 passed.
- The wasm Lovejoin set with api_test: 171 passed.
- Core's other files: 236 passed.
- Wasm's other files: 127 passed.

lovejoin_pools_test's declares_what_it_uses (:1638) does check the returned transaction, but the mutant never changes the outcome in any test.

**Fix:**

This needs a seam: for example, a #[cfg(test)] margin of 0 or below, plus a test that withdraw_with never returns a transaction that declares_what_it_uses refuses. Without a seam, only a property test over many proofs could catch it, and only by chance.

**Known check:**

Searched backlog.md, docs/archive/plans/ and docs/plans/ for 'mutant', 'covers(' and 'with_margin'. The hits are chunk-16-lovejoin.md:239, which introduces covers and with_margin, and this chunk's R2a checked_ok on measure_locally. There's no gap record.

### t1c#16 · low · A withdraw whose fee never settled: no test fails without the 'did not settle' refusal

- **Where:** `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1740`
- **Who:** nobody · **Since:** 354ddccb (chunk 16); first tag web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

withdraw_with bails after eight rounds without a settled fee (mod.rs:1740). In the mutant, the eighth round returns whatever fee it has. Every test passed, since every withdraw settles by its third round: only CBOR length jumps move the fee, by 176 lovelace, well inside the 5,000 tolerance. So nobody reaches it. The settle test it backs (mod.rs:1696) is well pinned: replaced with `if true`, it fails 11 tests.

**Evidence:**

Change: mod.rs:1680 `for _ in 0..8 {` became `for round in 0..8 {`, and mod.rs:1696 `if needed <= fee && fee - needed < 5_000 {` became `if (needed <= fee && fee - needed < 5_000) || round == 7 {`.

Runs:
- The core Lovejoin set: 120 passed.
- The wasm Lovejoin set with api_test: 171 passed.
- Core's other files: 236 passed.
- Wasm's other files: 127 passed.

Separately, the settle test replaced with `if true` failed 11 core tests, among them lovejoin_mainnet_test.rs:350 'fee 500000 over 289685' and lovejoin_box_value_test.rs:146 (4,310,000 vs 4,110,000).

**Fix:**

Pinning it needs a seam, such as a #[cfg(test)] round limit of 1 with a test asserting Err('did not settle'). It's of little value: the settle test itself is what keeps money right, and it is pinned.

**Known check:**

Searched backlog.md, docs/archive/plans/ and docs/plans/ for 'mutant', 'did not settle' and 'fee never settled'. The only hits are this chunk's R3a lane: its guard list and the note on mix_with's loop.

## Guards (43)

| Where | What it stops | Test |
|---|---|---|
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:415` | A pool row that isn't exactly the box value read as a box (from_row's is_row) | seedelf-wasm tests/lovejoin_test.rs junk_at_mix_box_is_not_counted_among_the_boxes_to_mix_with (:1417, others 16 vs 14) and a_pool_too_small_for_a_sessions_chain_skips_lovejoin (:1458). The lane's named core tests passed. |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:416` | A row away from mix_box's payment credential read as a box | none (t1c#9) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:438` | from_resolved: an output that isn't exactly the box value read as a box | lovejoin_pools_test a_token_box_is_read_from_a_row_and_its_bytes_alike (:898) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:381` | A stranger's datum nested too deep decoded, overflowing the stack | cbor_test a_box_too_deep_to_read_is_skipped (stack overflow, SIGABRT of the whole binary). The lane's named lovejoin_vectors_test passed. |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:453` | A box with an identity point counted and drawn as a pool box | none (t1c#1) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:426` | A box whose points are off the curve or outside the subgroup read as a pool box (from_row's points()) | seedelf-wasm lovejoin_test junk_at_mix_box_is_not_counted_among_the_boxes_to_mix_with (others 15 vs 14) and a_pool_too_small_for_a_sessions_chain_skips_lovejoin ('Not a point of G1's prime-order subgroup') |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:479` | A token-holding UTxO paying for Lovejoin | none (t1c#8) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:333` | A token pool's reference UTxO that carries a script | lovejoin_pools_test a_token_pools_deposit_reads_its_reference_utxo (:2330) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:757` | A token pool's deposit that doesn't read its reference UTxO (317-wallet#0) | lovejoin_pools_test a_token_pools_deposit_reads_its_reference_utxo (:2293, reads [] vs the reference) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:732` | A deposit's box under an identity or invalid register | none (t1c#7) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:762` | The deposit's inputs' ADA summed past a u64 | none (t1c#10) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:775` | A pool's box ADA times the boxes past a u64 | none (t1c#2) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:804` | The deposit's paid sum past a u64 (314-core#1) | lovejoin_planner_test a_pools_box_ada_past_what_a_sum_holds_is_refused_in_words_never_wrapped (:632) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:810` | A deposit's ADA change under its least, refused as the typed shortfall (MONEY-5) | seedelf-wasm lovejoin_flows_test a_large_bootstrap_from_the_public_account_takes_another_utxo_for_its_fee (:862, 3 inputs vs 4) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:985` | A mix of fewer than two boxes | none (t1c#12: seedelf-crypto refuses anyway, and the named test asserts is_err only) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:992` | One box mixed twice in a transaction | none (t1c#11) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1056` | The payer's ADA plus the reward balance past a u64 | lovejoin_test a_reward_balance_past_what_a_u64_holds_is_refused_in_words (:1215) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1070` | A mix change under its least | lovejoin_test a_mix_never_leaves_change_under_an_outputs_least (:900) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1069` | A mix fee past the payer's ADA | lovejoin_test a_mix_needs_two_boxes_and_a_payer_who_can_pay (overflow panic at mod.rs:1200) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1105` | An own-collateral mix return leaving less than ceil(3/2 × fee) | lovejoin_test's collateral_is_enough helper (:122), failing in a_mix_under_givemes_collateral_passes_mix_logic, a_mix_takes_the_reward_balance_whole_into_its_change, deposit_mix_and_withdraw_chain_before_anything_is_on_chain and boxes_of_ours_in_the_pool_fan_out_again_with_no_deposit |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1181` | An odd mix fee under giveme.my's collateral | lovejoin_test a_mix_under_givemes_collateral_passes_mix_logic, a_mix_under_givemes_collateral_takes_it_into_the_payers_change, a_sessions_collateral_goes_into_a_box_and_is_mixed_once (:458) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1167` | A mix over a transaction's computation | lovejoin_width_test the_wallet_refuses_four_boxes_once_together_they_pass_a_transactions_computation (:904) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1175` | A mix fee over the wallet's 10 ₳ limit | lovejoin_test a_mix_never_pays_a_fee_over_the_limit (:293) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1212` | A mix taking the pool's reward balance before its build succeeds | lovejoin_test a_build_that_fails_takes_nothing (:1186) and a_reward_balance_past_what_a_u64_holds_is_refused_in_words (:1227) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1721` | A withdraw taking the reward balance before its build succeeds | lovejoin_pools_test a_withdraw_refused_after_it_read_the_balance_takes_none (:1150) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1433` | Boxes coming back into an identity or invalid destination register | none (t1c#6) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1439` | A withdraw of a box the wallet's key doesn't own | lovejoin_test someone_elses_box_is_not_withdrawn (:613, through its words: without the check the evaluator refuses) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1516` | A private payer's ADA summed with the boxes past a u64 | lovejoin_pools_test a_private_payer_holding_more_ada_than_there_is_is_refused_in_words (:1331) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1560` | A paid withdraw's account change under its least | none (t1c#5) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1582` | A paid withdraw's own-collateral return short of 3/2 × fee | lovejoin_pools_test the_classic_pools_take_a_reward_balance_in_every_kind_too and v2_pools_take_a_reward_balance_in_every_kind_and_pay_the_ledgers_fee (every_kind_takes's exact return, :1835). The lane had none. |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1686` | A withdraw whose declared budgets are under its own measure | none (t1c#15) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1699` | A register output under its minimum, typed CantPayBack or PrivateTooSmall | lovejoin_pools_test a_box_too_poor_to_come_back_says_so_and_an_account_can_pay (:1008), a_box_worth_less_than_the_fee_cant_pay_its_way_back (:1088), a_box_too_poor_to_come_back_is_paid_for_from_the_private_balance, a_box_already_there_is_asked_only_about_its_way_back (:2566), a_pool_isnt_usable_unregistered_too_small_or_unable_to_come_back, a_withdraw_refused_after_it_read_the_balance_takes_none |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1740` | A withdraw returned whose fee never settled in eight rounds | none (t1c#16) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1696` | A withdraw returned before its fee settled (the test the 1740 bail backs) | 11 core tests, e.g. lovejoin_mainnet_test a_mainnet_mix_and_withdraw_pay_the_ledgers_minimum (:350 'fee 500000 over 289685') |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1759` | A mix width other than 3 or 4 | lovejoin_planner_test four_wide_fans_a_box_out_over_more_mixes (:233) and token_boxes_come_first_and_ada_boxes_take_what_they_leave (:415). The lane had none. |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1913` | Funding sums past a u64, refused as MORE_THAN_THERE_IS | lovejoin_planner_test a_pools_box_ada_past_what_a_sum_holds_is_refused_in_words_never_wrapped (:568, Ok(1,499,999)) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1937` | per_box_in's sum past a u64 | lovejoin_planner_test a_pools_box_ada_past_what_a_sum_holds_is_refused_in_words_never_wrapped (:564, Ok(1,099,999)) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:2309` | A chain that mixes without collateral | none (t1c#13: mix() refuses in near words) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:2529` | A fan-out drawing more pool boxes than exist (PoolShort) | lovejoin_test a_chain_needs_enough_pool_boxes, a_sessions_collateral_goes_into_a_box_and_is_mixed_once, mixing_again_needs_a_box_and_enough_others (two of them by fan_out's expect at mod.rs:2568) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:2520` | A fan-out depth outside 0 to 3 | none (t1c#14) |
| `seedelf-platform/seedelf-core/src/lovejoin/value.rs:108` | A token box of 0 of its token reaching pallas (BoxValue::output, MONEY-2) | none alone (t1c#4). With box_value.rs:193 also gone: lovejoin_box_value_test a_pool_of_one_token_a_box_has_a_box_value (pallas panic) |
| `seedelf-platform/seedelf-core/src/lovejoin/value.rs:124` | A token total for n boxes past 2^64 − 1 | lovejoin_pools_test a_box_value_checks_values_exactly (:235). The lane named only the wasm .mjs test. |
| `seedelf-platform/seedelf-core/src/lovejoin/box_value.rs:193` | Q = 0 reaching the box-value probes (check_token, MONEY-2) | none alone (t1c#3). The pair with value.rs:108 is caught by lovejoin_box_value_test a_pool_of_one_token_a_box_has_a_box_value. |

## Checked and holds

- mod.rs:415 from_row's exact box value. Mutant: `!is_row(row) ||` dropped. Caught by seedelf-wasm tests/lovejoin_test.rs junk_at_mix_box_is_not_counted_among_the_boxes_to_mix_with (others 16 vs 14) and a_pool_too_small_for_a_sessions_chain_skips_lovejoin (a chain built on junk). The lane's named core tests passed: they test is_value and from_resolved, not from_row.
- mod.rs:438 from_resolved's exact value. Mutant: `|| !is_value` dropped. Caught by lovejoin_pools_test a_token_box_is_read_from_a_row_and_its_bytes_alike (:898).
- mod.rs:381 parse_mix_datum's depth walk, deleted. Caught by cbor_test a_box_too_deep_to_read_is_skipped: the thread overflows its stack and the cbor_test binary aborts (SIGABRT).
- mod.rs:426 from_row's points() check. Mutant: `Some(boxed)`. Caught by the wasm junk test (others 15 vs 14) and a_pool_too_small_for_a_sessions_chain_skips_lovejoin ('Not a point of G1's prime-order subgroup').
- mod.rs:333 the refusal of a script-carrying token reference, deleted. Caught by lovejoin_pools_test a_token_pools_deposit_reads_its_reference_utxo (:2330).
- mod.rs:757 the deposit reading its token pool's reference. Mutant: reads.push dropped. Caught by the same test (:2293).
- mod.rs:810 the deposit change's least, dropped. Caught by seedelf-wasm lovejoin_flows_test a_large_bootstrap_from_the_public_account_takes_another_utxo_for_its_fee (:862, 3 inputs vs 4).
- mod.rs:804-807 the deposit's paid sum. Mutant: wrapping. Caught by lovejoin_planner_test a_pools_box_ada_past_what_a_sum_holds_is_refused_in_words_never_wrapped (:632).
- mod.rs:1056 payer plus reward balance. Mutant: wrapping. Caught by lovejoin_test a_reward_balance_past_what_a_u64_holds_is_refused_in_words (:1215).
- mod.rs:1070 the mix change's least, dropped. Caught by lovejoin_test a_mix_never_leaves_change_under_an_outputs_least (:900).
- mod.rs:1069 the mix change past the payer's ADA. Mutant: wrapping_sub. Caught by a_mix_needs_two_boxes_and_a_payer_who_can_pay (overflow panic at mod.rs:1200).
- mod.rs:1105 the own-collateral mix's `+ 1`, dropped, and the return made one lovelace larger again (`- 1`). Both caught by collateral_is_enough (lovejoin_test.rs:122) in 4 tests, e.g. 'fee 820583: 1230874 put up, 1230875 needed'.
- mod.rs:1181 giveme.my's even fee. Mutant: `needed`. Caught by 3 lovejoin_test tests at :458 ('an even fee, so 3/2 of it is whole').
- mod.rs:1167 the transaction's computation cap, deleted. Caught by lovejoin_width_test the_wallet_refuses_four_boxes_once_together_they_pass_a_transactions_computation (:904).
- mod.rs:1175 check_fee, deleted. Caught by lovejoin_test a_mix_never_pays_a_fee_over_the_limit (:293).
- mod.rs:1212 the mix taking the balance only after its build, moved before it. Caught by lovejoin_test a_build_that_fails_takes_nothing (:1186: 0 left of 500,000,000).
- mod.rs:1721 the withdraw taking the balance only after its build, moved before it. Caught by lovejoin_pools_test a_withdraw_refused_after_it_read_the_balance_takes_none (:1150).
- mod.rs:1439 only the wallet's own boxes are withdrawn, deleted. Caught by lovejoin_test someone_elses_box_is_not_withdrawn (:613), through its words: the evaluator still refused.
- mod.rs:1516 a private payer's ADA summed with the boxes. Mutant: wrapping. Caught by lovejoin_pools_test a_private_payer_holding_more_ada_than_there_is_is_refused_in_words (:1331).
- mod.rs:1582 the paid withdraw's own collateral, both `- 1` and `+ 1` dropped. Caught by lovejoin_pools_test the_classic_pools_take_a_reward_balance_in_every_kind_too and v2_pools_take_a_reward_balance_in_every_kind_and_pay_the_ledgers_fee (:1835, 4,555,392 vs 4,555,390).
- mod.rs:1699 the register output's typed minimum, deleted. Caught by 6 lovejoin_pools_test tests, both of the lane's named tests among them.
- mod.rs:1696 the withdraw's settle test. Mutant: `if true`. Caught by 11 core tests in lovejoin_mainnet_test, lovejoin_box_value_test and lovejoin_pools_test.
- mod.rs:1759 check_width, deleted. Caught by lovejoin_planner_test four_wide_fans_a_box_out_over_more_mixes (:233) and token_boxes_come_first_and_ada_boxes_take_what_they_leave (:415).
- mod.rs:1913 funding's sums, and mod.rs:1937 per_box_in's, both made wrapping. Caught by lovejoin_planner_test a_pools_box_ada_past_what_a_sum_holds_is_refused_in_words_never_wrapped (:568 and :564).
- mod.rs:2529 PoolShort, deleted. Caught by lovejoin_test a_chain_needs_enough_pool_boxes and 2 more. Without it, fan_out's expect('counted by fresh_for') at mod.rs:2568 panics, which would trap in WebAssembly.
- value.rs:124 token_total's overflow. Mutant: wrapping_mul. Caught by lovejoin_pools_test a_box_value_checks_values_exactly (:235).
- value.rs:108 and box_value.rs:193, deleted together. Caught by lovejoin_box_value_test a_pool_of_one_token_a_box_has_a_box_value: pallas-txbuilder 0.35.1 conway.rs:312 panics on PositiveCoin::try_from(0), the MONEY-2 trap.

## Notes

- Some of the lane's test pointers were wrong though the guard is pinned. from_row's value check (mod.rs:415) isn't caught by the named lovejoin_pools_test tests, which test is_value and from_resolved; the wasm junk test pins it. The depth walk (mod.rs:381) isn't caught by lovejoin_vectors_test; cbor_test pins it, by crashing its whole binary, which hides the results of the file's other tests. The 'none found' at mod.rs:1582 and mod.rs:1759 do have tests. token_total (value.rs:124) is pinned by a core test, not only by the wasm .mjs.
- R3a's guard text for mod.rs:453 says 'no mix or withdraw of it can pass'. In the probe, a mix of an identity-point box passed the wallet's own evaluator (fee 820,583). So the check's value is what it keeps out of the count and the draws, not a failing mix (t1c#1). E1b's checked_ok ('PoolBox::points refuses identity points, so no stranger's box reads as every wallet's') also rests on parse_mix_datum's a ≠ b: (identity, identity) is the only datum every key owns, and a ≠ b refuses it as long as the identity has one encoding.
- MONEY-2's two Q = 0 refusals (value.rs:108, box_value.rs:193) carry the same words, so each alone is unpinned and only the pair is pinned (t1c#3, t1c#4).
- Three mutants still end in an error, so no money is at stake: mod.rs:985 (seedelf-crypto's 'A sigma-OR needs at least two statements'), mod.rs:992 (mix_logic refuses in the evaluator) and mod.rs:2309 (mix()'s 'A mix needs collateral'). They're findings only because the instructions make every uncaught guard one.
- With mod.rs:453, mod.rs:732 or mod.rs:1433 removed, the wallet built transactions it shouldn't: a mix of an identity box, a deposit under (G, identity) at fee 170,737, and a withdraw paying 9,710,388 lovelace into (G, identity). No actor reaches the last two today.
- The exact-value collateral asserts in lovejoin_pools_test.rs:1835 pin the formula, not the ledger's rule. Dropping withdraw_paid's `+ 1` fails them, though a withdraw's fee is always even (it's set from even(needed)) and the ledger would take it.
- Setup: wasm/tests/lovejoin_proven_bytes_test.rs include_str!s four hex files from seedelf-verification/ (outside seedelf-platform). A copy of seedelf-platform/ alone doesn't compile that test; I copied the four files beside the copy.
- The Rust guards reach the extension's Vitest and the wasm/tests/*.test.mjs files only through the tree's prebuilt wasm/pkg. So none of those tests could see a mutant, including R3a's named lovejoin-pools.test.mjs.
- The machine's load reached 85 on 12 cores during the run (the other T1 lanes), so a mutant took up to 25 minutes. After G17 I skipped the non-Lovejoin test files and after G28 api_test, then ran all of them again against every uncaught mutant once the load fell (see coverage).

## Coverage

I tried all 31 of R3a's guard entries. Five entries name more than one guard, so I split them: 415 into the value check, the credential check and from_resolved's twin; 760 into the inputs' sum, the boxes' product and the paid sum; 985 into the box count and the duplicate check; 1212 into the mix's and the withdraw's (1721); 2529 into PoolShort and the depth bound. I added from_row's points() use (426), the read the 333 entry describes (757) and the settle test behind 1740 (1696). That makes 46 mutant runs, including the 1105 and 1582 variants and the value.rs and box_value.rs pair.

How each was run, in T1c's copy only, each command capped:
- The lane's named test file first, where it had one.
- Then seedelf-core's Lovejoin set: lovejoin_test, lovejoin_pools_test, lovejoin_planner_test, lovejoin_box_value_test, lovejoin_vectors_test, lovejoin_width_test, lovejoin_mainnet_test, lovejoin_launch_test, cbor_test and the lib unit tests: 120 tests.
- Then seedelf-wasm's Lovejoin set: lovejoin_flows_test, lovejoin_test, lovejoin_pools_test, lovejoin_across_test, lovejoin_mainnet_test, lovejoin_v2_fixture_test, lovejoin_proven_bytes_test and return_cost_test (79), plus api_test (92) up to G28.
- A run stopped at the first failing set, so a caught mutant may not have met the later sets.
- Every uncaught mutant also ran against seedelf-core's other 21 test files (236) and seedelf-wasm's other 6 (127), and api_test where it had missed it: 654 tests, 0 failures each.

Probes for t1c#1, #6, #7, #11, #12 and #13 ran from a test file in the copy, removed with it. TREE was never written to; its git status shows only other lanes' files. The copy and target are removed.

Not run:
- seedelf-wasm's 7 lib unit tests (chain_end, return_plan, dex_order, none about Lovejoin's builders).
- The #[ignore]d live tests.
- The r51_* verifier test files.
- seedelf-cli's tests (the CLI has no Lovejoin code).
- The extension's Vitest and the wasm .mjs tests, which run the prebuilt pkg.
