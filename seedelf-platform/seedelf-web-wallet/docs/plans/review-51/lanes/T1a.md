# Lane T1a

Returned by the workflow's agent `a582504f335fb961d`, written here by the lead from its structured answer.

## Findings (18)

### t1a#1 · low · A proof for a register outside the prime-order subgroup: no test fails without it

- **Where:** `seedelf-platform/seedelf-crypto/src/schnorr.rs:106`
- **Who:** nobody · **Since:** 87889ec0 (2026-05-20, implement medium-severity review fixes) · **Confidence:** confirmed-by-run

**Scenario:**

Deleting create_proof's subgroup check leaves all 790 workspace tests passing. create_proof then proves any register whose generator decodes, whatever its public value: a torsion point, the identity or 48 bytes of garbage (it's only hashed, never decoded) gets a proof instead of an error. No harm is reachable today: every caller proves only a register that is_owned accepted, which decodes the generator with the subgroup check and compares the public value with g^sk. The check is there for a future direct caller, and nothing pins it.

**Evidence:**

Change: deleted schnorr.rs:106-108 `if !datum.is_valid()? { anyhow::bail!("Register points are not in the prime-order subgroup"); }`. `cargo test -p seedelf-crypto`: 61 passed, 0 failed. `cargo test --workspace`: 790 passed, 0 failed, 12 ignored. (In a copy, never TREE; restored from TREE after. Not run against it: wasm/tests/*.test.mjs and the extension's Vitest, which see this Rust only through a rebuilt wasm/pkg, not rebuilt per the brief; see notes.)

**Fix:**

Add to seedelf-crypto/tests/schnorr_test.rs: create_proof(Register::new(G, torsion), sk, vkh) and create_proof(Register::new(G, "00"x48), sk, vkh) are Err. A torsion point can be found as seedelf-core/tests/utxos_test.rs:494 finds one (from_compressed_unchecked succeeds, is_torsion_free is false).

**Known check:**

Searched docs/backlog.md and docs/archive/plans/*.md for 'mutant', 'no test', and this guard's function name and error words (create_proof, is_valid, 'prime-order subgroup'): the earlier mutant lenses (reviews 1.7.1 to 1.9.1) mutated only their diffs' new tests, and nothing records this check as untested or declined.

### t1a#2 · low · Re-randomizing a register outside the prime-order subgroup, which writes a locked UTxO: no test fails without it

- **Where:** `seedelf-platform/seedelf-crypto/src/register.rs:119`
- **Who:** stranger · **Since:** decoding 64d799dc (2024-12-10); explicit check 87889ec0 (2026-05-20) · **Confidence:** confirmed-by-run

**Scenario:**

With rerandomize decoding both points by from_compressed_unchecked and its explicit check (141-147) deleted, all 790 workspace tests pass. A register holding an on-curve torsion point (a Seedelf's register is chosen by whoever minted it, and paying a Seedelf re-randomizes that register in build.rs deposit_output) would come back as a new torsion register, and a payment under it is locked for good: the validator refuses non-prime-order points. Today build.rs is_payable refuses such a payee before rerandomize runs, and that one is pinned (mint_test transfer::refuses_what_would_lose_money fails without each of its three checks), so no money is reachable. Deleting only the explicit check (141-147) is an equivalent mutant, as R1 noted: from_compressed already refuses those points, so those lines can never fail.

**Evidence:**

m02b: in rerandomize, `G1Affine::from_compressed(` became `G1Affine::from_compressed_unchecked(` for the generator (register.rs:119) and the public value (:128), and lines 141-147 were deleted: crypto 61/61, workspace 790/790. m02a: lines 141-147 alone deleted: crypto 61/61. (In a copy, never TREE; restored from TREE after. Not run against it: wasm/tests/*.test.mjs and the extension's Vitest, which see this Rust only through a rebuilt wasm/pkg, not rebuilt per the brief; see notes.)

**Fix:**

Add to seedelf-crypto/tests/register_test.rs: Register::new(torsion, G).rerandomize() and Register::new(G, torsion).rerandomize() are Err, plus one with an encoding off the curve. Then the dead explicit check can go, or stay as documentation.

**Known check:**

Searched docs/backlog.md and docs/archive/plans/*.md for 'mutant', 'no test', and this guard's function name and error words (rerandomize, 'prime-order subgroup', torsion): the earlier mutant lenses (reviews 1.7.1 to 1.9.1) mutated only their diffs' new tests, and nothing records this check as untested or declined.

### t1a#3 · low · A zero mix witness, whose output box anyone can withdraw: no test fails without it

- **Where:** `seedelf-platform/seedelf-crypto/src/lovejoin.rs:256`
- **Who:** nobody · **Since:** 1837bb0a (2026-09-25, chunk 16 step 4) · **Confidence:** confirmed-by-run

**Scenario:**

Deleting prove_sigma_or's zero check (256-258) passes every test: derive_nonce (131-133) still refuses a zero scalar, in its own words. Deleting both passes every test too: prove_sigma_or(a, b, statements, i, 0, ctx) then proves the identity pair (0·a, 0·b) as the box's output, which anyone can withdraw. Unreachable today: seedelf-core draws every mix witness with nonzero_scalar.

**Evidence:**

m03a: lovejoin.rs:256-258 deleted: crypto 61/61, workspace 790/790. m03b: 256-258 and 131-133 deleted: crypto 61/61, workspace 790/790. (In a copy, never TREE; restored from TREE after. Not run against it: wasm/tests/*.test.mjs and the extension's Vitest, which see this Rust only through a rebuilt wasm/pkg, not rebuilt per the brief; see notes.)

**Fix:**

Add to seedelf-crypto/tests/lovejoin_test.rs: prove_sigma_or with &Scalar::ZERO is Err, and derive_nonce(&Scalar::ZERO, msg) is Err.

**Known check:**

Searched docs/backlog.md and docs/archive/plans/*.md for 'mutant', 'no test', and this guard's function name and error words (prove_sigma_or, derive_nonce, nonzero_scalar, 'must be in [1, r)'): the earlier mutant lenses (reviews 1.7.1 to 1.9.1) mutated only their diffs' new tests, and nothing records this check as untested or declined.

### t1a#4 · low · A zero secret in an owner's Lovejoin Schnorr proof: no test fails without it

- **Where:** `seedelf-platform/seedelf-crypto/src/lovejoin.rs:200`
- **Who:** nobody · **Since:** 1837bb0a (2026-09-25, chunk 16 step 4) · **Confidence:** confirmed-by-run

**Scenario:**

Deleting prove_schnorr's zero check (200-202) alone is an equivalent mutant: derive_nonce refuses with the same words. Deleting it with derive_nonce's (131-133) passes all 790 tests: prove_schnorr(base, 0, ctx) then proves u = identity. Unreachable: the secret is the Seedelf key, which is never zero.

**Evidence:**

m04a: lovejoin.rs:200-202 deleted: crypto 61/61, workspace 790/790. m04b: 200-202 and 131-133 deleted: crypto 61/61, workspace 790/790. (In a copy, never TREE; restored from TREE after. Not run against it: wasm/tests/*.test.mjs and the extension's Vitest, which see this Rust only through a rebuilt wasm/pkg, not rebuilt per the brief; see notes.)

**Fix:**

Add to lovejoin_test.rs: prove_schnorr(&base, &Scalar::ZERO, ctx) is Err (one test with the previous finding's derive_nonce case covers both).

**Known check:**

Searched docs/backlog.md and docs/archive/plans/*.md for 'mutant', 'no test', and this guard's function name and error words (prove_schnorr, derive_nonce, 'must be in [1, r)'): the earlier mutant lenses (reviews 1.7.1 to 1.9.1) mutated only their diffs' new tests, and nothing records this check as untested or declined.

### t1a#5 · low · A sigma-OR with N outside [2, 255], whose 1-byte N wouldn't match the validator's: no test fails without it

- **Where:** `seedelf-platform/seedelf-crypto/src/lovejoin.rs:179`
- **Who:** nobody · **Since:** 1837bb0a (2026-09-25, chunk 16 step 4) · **Confidence:** confirmed-by-run

**Scenario:**

Dropping `|| !(2..=255).contains(&n)` from fs_hash_sigma_or passes all 790 tests. With 256 statements `n as u8` would wrap to 0 and hash an N the validator never computes, and one statement would be hashed; prove_sigma_or and verify_sigma_or still refuse n < 2 themselves. Unreachable: a mix has 3 or 4 outputs.

**Evidence:**

m05: lovejoin.rs:179 `if n != commitments.len() || !(2..=255).contains(&n) {` became `if n != commitments.len() {`: crypto 61/61, workspace 790/790. (In a copy, never TREE; restored from TREE after. Not run against it: wasm/tests/*.test.mjs and the extension's Vitest, which see this Rust only through a rebuilt wasm/pkg, not rebuilt per the brief; see notes.)

**Fix:**

Add to lovejoin_test.rs: fs_hash_sigma_or with 1 and with 256 (statement, commitment) pairs is Err, and prove_sigma_or with 256 statements is Err.

**Known check:**

Searched docs/backlog.md and docs/archive/plans/*.md for 'mutant', 'no test', and this guard's function name and error words (fs_hash_sigma_or, 'between 2 and 255'): the earlier mutant lenses (reviews 1.7.1 to 1.9.1) mutated only their diffs' new tests, and nothing records this check as untested or declined.

### t1a#6 · low · The proof nonce's hedge against a failing random source: no test fails without it

- **Where:** `seedelf-platform/seedelf-crypto/src/schnorr.rs:62`
- **Who:** nobody · **Since:** 58820241 (2026-09-25, crypto review #3) · **Confidence:** confirmed-by-run

**Scenario:**

Dropping the statement (generator, public value, vkh) from the nonce's HMAC input, or keying the HMAC with zeros instead of sk, passes all 790 tests. Only freshness is tested: create_proof_draws_a_new_nonce_each_time catches dropping the 32 random bytes (m06c), as R1 said. With either mutant, a random source that repeats gives two different statements one nonce, which reveals the Seedelf key and with it every private UTxO and Lovejoin box; unkeyed, a predictable source makes the nonce anyone's to compute. Reaching it needs the OS random source to fail.

**Evidence:**

m06a: schnorr.rs:67 `for part in [NONCE_TAG, generator, public_value, vkh, &aux]` became `[NONCE_TAG, &aux]`: crypto 61/61, workspace 790/790. m06b: schnorr.rs:65 `Hmac::new(Sha512::new(), &key)` became `Hmac::new(Sha512::new(), &[0u8; 32])`: crypto 61/61, workspace 790/790. m06c (aux dropped): caught, schnorr_test.rs:102 `assert_ne!(g_r1, g_r2)` fails. (In a copy, never TREE; restored from TREE after. Not run against it: wasm/tests/*.test.mjs and the extension's Vitest, which see this Rust only through a rebuilt wasm/pkg, not rebuilt per the brief; see notes.)

**Fix:**

Give proof_nonce a seam that takes aux (a private proof_nonce_with(sk, g, u, vkh, aux)) and unit-test it in schnorr.rs: with one aux, two statements (another vkh) give two nonces and two keys give two nonces, and one statement with one key gives one nonce.

**Known check:**

Searched docs/backlog.md and docs/archive/plans/*.md for 'mutant', 'no test', and this guard's function name and error words (proof_nonce, hedge, nonce): the earlier mutant lenses (reviews 1.7.1 to 1.9.1) mutated only their diffs' new tests, and nothing records this check as untested or declined. crypto-review.md #3 records the hedge's design, not a test of it.

### t1a#7 · low · A minting script that doesn't hash to its policy: no test fails without it

- **Where:** `seedelf-platform/seedelf-core/src/build.rs:1726`
- **Who:** nobody · **Since:** 02239cef (2026-10-17, chunk 34b) · **Confidence:** confirmed-by-run

**Scenario:**

Deleting mint_inline's hash check passes every test that reaches core. A launch whose script and policy disagreed would then be built and measured, and refused only by the node for a missing script witness; no money moves. Unreachable today: launch.rs:335-341 passes made.policy and made.derived.one_shot_mint, made together.

**Evidence:**

c31: build.rs:1726-1728 `if *Hasher::<224>::hash_tagged(&script, 3) != *policy { bail!("The minting script isn't the policy's"); }` deleted. lovejoin_launch_test 8/8; seedelf-core (every test target) 356/356; seedelf-wasm and seedelf-cli (every target) 351/351. (In a copy, never TREE; restored from TREE after. Not run against it: wasm/tests/*.test.mjs and the extension's Vitest, which see this Rust only through a rebuilt wasm/pkg, not rebuilt per the brief; see notes.)

**Fix:**

Add to seedelf-core/tests/lovejoin_launch_test.rs: ScriptSpend::new(...).mint_inline(another policy, script, ...) is Err("The minting script isn't the policy's").

**Known check:**

Searched docs/backlog.md and docs/archive/plans/*.md for 'mutant', 'no test', and this guard's function name and error words (mint_inline, "minting script isn't the policy's"): the earlier mutant lenses (reviews 1.7.1 to 1.9.1) mutated only their diffs' new tests, and nothing records this check as untested or declined.

### t1a#8 · low · A payment output read back as the carry: no test fails without it

- **Where:** `seedelf-platform/seedelf-core/src/build.rs:2267`
- **Who:** user · **Since:** 0e34b740 (2026-10-21) · **Confidence:** confirmed-by-run

**Scenario:**

Deleting carried's 'two outputs could carry' refusal passes every test that reaches core (R2a listed it at 2264). A carrying part that also pays a Seedelf exactly the lovelace it carries forward, with no tokens, has two outputs at the wallet contract with that coin and no tokens. carried then takes the first in the shuffled order, so half the time the next part is built on the recipient's output, which the user's key can't prove: the next part fails when it's measured. No money is lost, but the chain stops with an error that doesn't say why.

**Evidence:**

c37: build.rs:2267-2269 `if carries.next().is_some() { bail!("The transaction has two outputs that could carry its ADA forward"); }` deleted. wasm api_test 92/92 (including a_part_of_tokens_with_no_ada_left_spends_what_the_part_before_carried); seedelf-core (every test target) 356/356; seedelf-wasm and seedelf-cli (every target) 351/351. (In a copy, never TREE; restored from TREE after. Not run against it: wasm/tests/*.test.mjs and the extension's Vitest, which see this Rust only through a rebuilt wasm/pkg, not rebuilt per the brief; see notes.)

**Fix:**

Add a core or wasm test: a carrying part with a Seedelf payment equal to its carry, where carried(...) is Err("two outputs that could carry").

**Known check:**

Searched docs/backlog.md and docs/archive/plans/*.md for 'mutant', 'no test', and this guard's function name and error words (carried, 'two outputs that could carry', carry): the earlier mutant lenses (reviews 1.7.1 to 1.9.1) mutated only their diffs' new tests, and nothing records this check as untested or declined.

### t1a#9 · low · Signing that changes the transaction's body: no test fails without it

- **Where:** `seedelf-platform/seedelf-core/src/build.rs:1193`
- **Who:** nobody · **Since:** 97be888f (2026-09-23) · **Confidence:** confirmed-by-run

**Scenario:**

Deleting add_witnesses' body-hash check passes every test that reaches core. add_witnesses decodes into pallas's conway::Tx, which keeps no raw body (PseudoTx<TransactionBody, ...>; MintedTx is the KeepRaw form), and encodes it again. A body Pallas writes differently (a fee in a 9-byte integer, say) would come back with a new body and the old body's signatures, which the node refuses. Unreachable today: both callers (wasm lib.rs:5188 sign_script_spend, lovejoin.rs:3033 finish_withdraw) sign bodies the wallet's own Pallas wrote.

**Evidence:**

c38: build.rs:1193-1195 `if tx_id(&signed)? != hash { bail!("Signing changed the transaction"); }` became `let _ = hash;`. seedelf-core (every test target) 356/356; seedelf-wasm and seedelf-cli (every target) 351/351. pallas-primitives 0.35.1 conway/model.rs:1604 `pub type Tx = PseudoTx<TransactionBody, WitnessSet, AuxiliaryData>`. (In a copy, never TREE; restored from TREE after. Not run against it: wasm/tests/*.test.mjs and the extension's Vitest, which see this Rust only through a rebuilt wasm/pkg, not rebuilt per the brief; see notes.)

**Fix:**

Add a core test: add_witnesses on a transaction whose body has a non-minimal integer head (the fee as 1b 00 00 00 00 ..) is Err("Signing changed the transaction").

**Known check:**

Searched docs/backlog.md and docs/archive/plans/*.md for 'mutant', 'no test', and this guard's function name and error words (add_witnesses, 'Signing changed the transaction'): the earlier mutant lenses (reviews 1.7.1 to 1.9.1) mutated only their diffs' new tests, and nothing records this check as untested or declined. chunk-13-staking.md only records why add_witnesses exists.

### t1a#10 · low · Max and parts taking a UTxO the wallet's evaluator can't take: no test fails without it

- **Where:** `seedelf-platform/seedelf-core/src/build.rs:2911`
- **Who:** stranger · **Since:** 8de4dc64 (2026-10-05) · **Confidence:** confirmed-by-run

**Scenario:**

Removing max_inputs_by's `.filter(|u| crate::eval::refusal(u).is_none())` passes every test that reaches core. The same filter in select_script_inputs (2553) is pinned (mint_test withdraw::never_picks_a_utxo_the_wallets_evaluator_cant_take fails without it). Anyone can pay a Seedelf an output carrying a reference script; without this filter Max and the parts planner (WebAssembly's max_inputs and max_inputs_by, lib.rs:3116, 3204, 3495, 3499, 3929) would take it, and the spend would be refused when measured rather than built without it. Today the extension drops such rows first (script-spend.ts:310-313, spendable), so this filter is a second line.

**Evidence:**

c42b: build.rs:2911 `.filter(|u| crate::eval::refusal(u).is_none())` removed from max_inputs_by. eval_test 8/8; seedelf-core (every test target) 356/356; seedelf-wasm and seedelf-cli (every target) 351/351. (In a copy, never TREE; restored from TREE after. Not run against it: wasm/tests/*.test.mjs and the extension's Vitest, which see this Rust only through a rebuilt wasm/pkg, not rebuilt per the brief; see notes.)

**Fix:**

Add the same case mint_test has for select_script_inputs, for build::max_inputs: a reference-script row among the available is never returned.

**Known check:**

Searched docs/backlog.md and docs/archive/plans/*.md for 'mutant', 'no test', and this guard's function name and error words (max_inputs_by, eval::refusal, 'reference script'): the earlier mutant lenses (reviews 1.7.1 to 1.9.1) mutated only their diffs' new tests, and nothing records this check as untested or declined. launch-review #1 (0334db01) added the select_script_inputs filter with its test.

### t1a#11 · low · An account-paid mint or launch spending tokens whose total passes a u64: no test fails without it

- **Where:** `seedelf-platform/seedelf-core/src/build.rs:3808`
- **Who:** stranger · **Since:** 84c2775f (2026-10-17, chunk 34d) · **Confidence:** confirmed-by-run

**Scenario:**

Replacing account_inputs' fitting call with the UTxOs as given passes every test that reaches core; fitting's other three sites are pinned (881 by build_test max_leaves_out_a_utxo_whose_tokens_would_overflow_the_rest, 2556 by mint_test withdraw::never_picks_a_utxo_whose_tokens_would_overflow_the_rest, 2914 by wasm api_test withdraw::max_leaves_out_a_utxo_whose_tokens_would_overflow_the_rest). A stranger can pay the Cardano account two UTxOs each holding 2^63 of their own token; an account mint (or a launch from the account, launch.rs:646) whose selection reaches both then fails 'Can't Merge Assets' instead of leaving one out. No money moves.

**Evidence:**

c43d: build.rs:3808 `let (mut spendable, _) = fitting(&spendable, &Assets::new(), |_| false)?;` became `let mut spendable: Vec<UtxoResponse> = spendable;`. utxos_test 18/18; seedelf-core (every test target) 356/356; seedelf-wasm and seedelf-cli (every target) 351/351. (In a copy, never TREE; restored from TREE after. Not run against it: wasm/tests/*.test.mjs and the extension's Vitest, which see this Rust only through a rebuilt wasm/pkg, not rebuilt per the brief; see notes.)

**Fix:**

Add to mint_test's account module: an account mint over two token UTxOs of 2^63 each, plus ADA, builds and spends at most one of them.

**Known check:**

Searched docs/backlog.md and docs/archive/plans/*.md for 'mutant', 'no test', and this guard's function name and error words (account_inputs, fitting, "Can't Merge Assets", overflow): the earlier mutant lenses (reviews 1.7.1 to 1.9.1) mutated only their diffs' new tests, and nothing records this check as untested or declined.

### t1a#12 · low · An account mint's collateral return under its least: no test fails without it

- **Where:** `seedelf-platform/seedelf-core/src/build.rs:3747`
- **Who:** user · **Since:** 719b1538 (2026-09-23, roadmap chunk 8b) · **Confidence:** confirmed-by-run

**Scenario:**

Deleting AccountMint::stage's check passes every test that reaches core. account_collateral prefers a UTxO of 2 ₳ or more but falls back to the largest, so a Cardano account holding only small UTxOs (say 1.2 ₳, a fee near 0.3 ₳, so a 0.75 ₳ return under a base address's least of about 0.98 ₳) builds a mint the node refuses for its collateral return, where the check says 'too small to put up as collateral'. No money is lost.

**Evidence:**

c44: build.rs:3747-3755 `if collateral_back < address_minimum_lovelace_with_assets(...)? { bail!("The Cardano account's UTxOs are too small to put up as collateral"); }` deleted. mint_test 40/40; seedelf-core (every test target) 356/356; seedelf-wasm and seedelf-cli (every target) 351/351. (In a copy, never TREE; restored from TREE after. Not run against it: wasm/tests/*.test.mjs and the extension's Vitest, which see this Rust only through a rebuilt wasm/pkg, not rebuilt per the brief; see notes.)

**Fix:**

Add to mint_test's account module: an account whose only UTxO is about 1.2 ₳ (and so is the collateral) is refused 'too small to put up as collateral'.

**Known check:**

Searched docs/backlog.md and docs/archive/plans/*.md for 'mutant', 'no test', and this guard's function name and error words (AccountMint, 'too small to put up as collateral', account_collateral): the earlier mutant lenses (reviews 1.7.1 to 1.9.1) mutated only their diffs' new tests, and nothing records this check as untested or declined.

### t1a#13 · low · Bytes that aren't one complete datum read as a register (two of register_of_datum's checks): no test fails without either

- **Where:** `seedelf-platform/seedelf-koios/src/koios.rs:373`
- **Who:** nobody · **Since:** 01f89534 (2026-09-26) · **Confidence:** confirmed-by-run

**Scenario:**

register_of_datum (R1's guard at 361) is pinned for the tag, constructor 102's index, the trailing-bytes check and the 48-byte length (rows_test nothing_but_constructor_0_with_two_48_byte_fields_is_a_register fails without each). Two checks aren't: the field count (373) and the indefinite list's break (380). Without the count, constructor 0 with one field followed by a second item, d8 79 81 58 30 <g> 58 30 <u>, reads as (g, u); without the break check, an indefinite list cut after the fields and one byte, d8 79 9f <g> <u> 00, does. Neither is one complete CBOR item, and an inline datum on chain is one, so a stranger can't put either at an address: for every single item the count check is backed by the trailing check.

**Evidence:**

k15c: koios.rs:373-375 `if fields.is_some_and(|n| n != 2) { return None; }` deleted: koios 10/10, workspace 790/790. k15f: koios.rs:380-382 `if d.datatype().ok()? != Type::Break { return None; }` deleted: koios 10/10, workspace 790/790. (In a copy, never TREE; restored from TREE after. Not run against it: wasm/tests/*.test.mjs and the extension's Vitest, which see this Rust only through a rebuilt wasm/pkg, not rebuilt per the brief; see notes.)

**Fix:**

Add both byte strings to rows_test's not_registers list.

**Known check:**

Searched docs/backlog.md and docs/archive/plans/*.md for 'mutant', 'no test', and this guard's function name and error words (register_of_datum, 'not a register', indefinite): the earlier mutant lenses (reviews 1.7.1 to 1.9.1) mutated only their diffs' new tests, and nothing records this check as untested or declined.

### t1a#14 · low · A Seedelf UTxO holding a quantity other than 1 taken for remove: no test fails without it

- **Where:** `seedelf-platform/seedelf-core/src/build.rs:3559`
- **Who:** nobody · **Since:** 6daafe6f (2026-09-23) · **Confidence:** confirmed-by-run

**Scenario:**

seedelf_in's `[one]` (exactly one Seedelf in the UTxO) is pinned (mint_test withdraw::refuses_what_would_lose_money fails when it takes [one, ..]), but its `if one.quantity == "1"` isn't: without it every test passes. Unreachable: the deployed policy (5b82530 validators/seedelf.ak) mints exactly 1 under a name made from an input, and burns only -1.

**Evidence:**

c45a: build.rs:3559 `[one] if one.quantity == "1" => {` became `[one] => {`. mint_test 40/40; seedelf-core's other 29 targets 350/350, then lovejoin_box_value_test and lovejoin_width_test 6/6; seedelf-wasm and seedelf-cli (every target) 351/351. (In a copy, never TREE; restored from TREE after. Not run against it: wasm/tests/*.test.mjs and the extension's Vitest, which see this Rust only through a rebuilt wasm/pkg, not rebuilt per the brief; see notes.)

**Fix:**

Add to mint_test's remove cases: a UTxO listing one Seedelf with quantity "2" is refused "exactly one Seedelf".

**Known check:**

Searched docs/backlog.md and docs/archive/plans/*.md for 'mutant', 'no test', and this guard's function name and error words (seedelf_in, 'exactly one Seedelf'): the earlier mutant lenses (reviews 1.7.1 to 1.9.1) mutated only their diffs' new tests, and nothing records this check as untested or declined.

### t1a#15 · low · A zero amount of a token paid to an address (Pallas's unwrap would trap): no test fails without it

- **Where:** `seedelf-platform/seedelf-core/src/build.rs:3337`
- **Who:** user · **Since:** 6daafe6f (2026-09-23) · **Confidence:** confirmed-by-run

**Scenario:**

Deleting pay_address's zero-amount check passes every test that reaches core; payment_outputs' twin (3232) is pinned (mint_test transfer::refuses_what_would_lose_money, 'none of a token'). Without it, an address payment from the Seedelf balance asking for 0 of a token reaches pallas-txbuilder's `PositiveCoin::try_from(*x).unwrap()` (conway.rs:312), which panics: in WebAssembly a trap rather than "A payment can't send none of a token". No money moves.

**Evidence:**

c46a: build.rs:3337-3339 `if tokens.items.iter().any(|a| a.amount == 0) { bail!("A payment can't send none of a token"); }` deleted. mint_test 40/40; seedelf-core's other 29 targets 350/350, then lovejoin_box_value_test and lovejoin_width_test 6/6; seedelf-wasm and seedelf-cli (every target) 351/351. (In a copy, never TREE; restored from TREE after. Not run against it: wasm/tests/*.test.mjs and the extension's Vitest, which see this Rust only through a rebuilt wasm/pkg, not rebuilt per the brief; see notes.)

**Fix:**

Add to mint_test's withdraw cases the transfer cases' zero line: an address payment of 0 of a token is Err("none of a token").

**Known check:**

Searched docs/backlog.md and docs/archive/plans/*.md for 'mutant', 'no test', and this guard's function name and error words (pay_address, 'none of a token', PositiveCoin): the earlier mutant lenses (reviews 1.7.1 to 1.9.1) mutated only their diffs' new tests, and nothing records this check as untested or declined.

### t1a#16 · low · An account input or collateral on the other network: no test fails without that part of with_account's check

- **Where:** `seedelf-platform/seedelf-core/src/build.rs:1601`
- **Who:** nobody · **Since:** 7db81171 (2026-09-25, chunk 16) · **Confidence:** confirmed-by-run

**Scenario:**

with_account's four refusals are pinned (merge_test an_account_under_another_key_or_a_token_collateral_is_refused fails without each), but dropping `if is_on_correct_network(addr.clone(), network_flag)` from at_signer's match passes every test. An account row under the same key hash on the other network would then be taken as an input or the collateral, and the node would refuse an input that isn't on its chain. Unreachable: the account's rows come from this network's data source.

**Evidence:**

c29e: build.rs:1601 `Address::Shelley(s) if is_on_correct_network(addr.clone(), network_flag) => {` became `Address::Shelley(s) => {`. merge_test 2/2; seedelf-core's other 29 targets 350/350, then lovejoin_box_value_test and lovejoin_width_test 6/6; seedelf-wasm and seedelf-cli (every target) 351/351. (In a copy, never TREE; restored from TREE after. Not run against it: wasm/tests/*.test.mjs and the extension's Vitest, which see this Rust only through a rebuilt wasm/pkg, not rebuilt per the brief; see notes.)

**Fix:**

Add to merge_test: a row whose address is the account's key on the other network is refused "isn't under the account's key".

**Known check:**

Searched docs/backlog.md and docs/archive/plans/*.md for 'mutant', 'no test', and this guard's function name and error words (with_account, "isn't under the account's key", is_on_correct_network): the earlier mutant lenses (reviews 1.7.1 to 1.9.1) mutated only their diffs' new tests, and nothing records this check as untested or declined.

### t1a#17 · low · A burn of a token the spent UTxOs don't hold: no test fails without remainder's check

- **Where:** `seedelf-platform/seedelf-core/src/build.rs:2105`
- **Who:** nobody · **Since:** 97be888f (2026-09-23) · **Confidence:** confirmed-by-run

**Scenario:**

Making remainder's burn fall back to the tokens unchanged, instead of refusing 'The UTxOs spent don't hold the token to burn', passes every test that reaches core. A burn of a token no input holds would then be built, and the node would refuse it (value not conserved). Unreachable: remove takes the Seedelf's name from seedelf_in, which requires the UTxO to hold exactly one (pinned).

**Evidence:**

c35c: build.rs:2103-2105 `tokens.sub(asset).context("The UTxOs spent don't hold the token to burn")?` became `tokens.sub(asset).unwrap_or_else(|_| tokens.clone())`. mint_test 40/40; seedelf-core's other 29 targets 350/350, then lovejoin_box_value_test and lovejoin_width_test 6/6; seedelf-wasm and seedelf-cli (every target) 351/351. (In a copy, never TREE; restored from TREE after. Not run against it: wasm/tests/*.test.mjs and the extension's Vitest, which see this Rust only through a rebuilt wasm/pkg, not rebuilt per the brief; see notes.)

**Fix:**

Add to mint_test: ScriptSpend::new(inputs without the Seedelf).mint(its name, -1, ...) then draft() is Err("don't hold the token to burn").

**Known check:**

Searched docs/backlog.md and docs/archive/plans/*.md for 'mutant', 'no test', and this guard's function name and error words (remainder, "don't hold the token to burn"): the earlier mutant lenses (reviews 1.7.1 to 1.9.1) mutated only their diffs' new tests, and nothing records this check as untested or declined.

### t1a#18 · low · A fee whose 3/2 an account's collateral can't cover: no test fails without that check

- **Where:** `seedelf-platform/seedelf-core/src/build.rs:2197`
- **Who:** user · **Since:** 7db81171 (2026-09-25, chunk 16) · **Confidence:** confirmed-by-run

**Scenario:**

When the Cardano account puts up the collateral (with_account: a session's merged return), saturating the collateral return at 0, instead of refusing 'The collateral can't cover this transaction's fee', passes every test that reaches core, R2a's named lovejoin_pools_test included. A collateral smaller than 3/2 of the fee would then be built with a 0 ₳ return, which the node refuses. No money is lost.

**Evidence:**

c36c: build.rs:2197-2200 `account.collateral_lovelace.checked_sub(fee * 3 / 2).context("The collateral can't cover this transaction's fee")?` became `.saturating_sub(fee * 3 / 2)`. lovejoin_pools_test 41/41; seedelf-core's other 29 targets 350/350, then lovejoin_box_value_test and lovejoin_width_test 6/6; seedelf-wasm and seedelf-cli (every target) 351/351. (In a copy, never TREE; restored from TREE after. Not run against it: wasm/tests/*.test.mjs and the extension's Vitest, which see this Rust only through a rebuilt wasm/pkg, not rebuilt per the brief; see notes.)

**Fix:**

Add to merge_test: with_account with a 1 ₳ collateral on a spend whose fee is over 0.67 ₳ is Err("can't cover this transaction's fee").

**Known check:**

Searched docs/backlog.md and docs/archive/plans/*.md for 'mutant', 'no test', and this guard's function name and error words (collateral_lovelace, "can't cover this transaction's fee"): the earlier mutant lenses (reviews 1.7.1 to 1.9.1) mutated only their diffs' new tests, and nothing records this check as untested or declined.

## Guards (67)

| Where | What it stops | Test |
|---|---|---|
| `seedelf-platform/seedelf-crypto/src/schnorr.rs:114` | create_proof refuses a vkh that isn't 28 bytes (rollback replay) [m08] | seedelf-crypto/tests/schnorr_test.rs create_proof_rejects_non_vkh_bound |
| `seedelf-platform/seedelf-crypto/src/schnorr.rs:67` | the nonce takes 32 fresh random bytes (freshness) [m06c] | seedelf-crypto/tests/schnorr_test.rs create_proof_draws_a_new_nonce_each_time (:102) |
| `seedelf-platform/seedelf-crypto/src/schnorr.rs:67` | the nonce's HMAC covers the statement, so a repeated random source can't give two statements one nonce [m06a] | none (t1a#6) |
| `seedelf-platform/seedelf-crypto/src/schnorr.rs:65` | the nonce's HMAC is keyed by sk, so a predictable random source doesn't make the nonce public [m06b] | none (t1a#6) |
| `seedelf-platform/seedelf-crypto/src/schnorr.rs:106` | create_proof refuses a register outside the prime-order subgroup [m01] | none (t1a#1) |
| `seedelf-platform/seedelf-crypto/src/register.rs:119` | rerandomize refuses an off-curve or torsion register (from_compressed and the check at 141-147) [m02b] | none (t1a#2) |
| `seedelf-platform/seedelf-crypto/src/register.rs:141` | rerandomize's explicit subgroup check [m02a] | none: equivalent mutant, from_compressed refuses first (R1's note) |
| `seedelf-platform/seedelf-crypto/src/register.rs:153` | the same d on both points [m09] | seedelf-crypto/tests/proptest_crypto.rs rerandomized_register_stays_owned_and_valid, schnorr_proof_round_trips_after_rerandomize; register_test valid_is_owned; schnorr_test create_random_proof_rerandomize_it_and_test_it, create_proof_draws_a_new_nonce_each_time; lovejoin_test a_seedelf_register_owns_a_box |
| `seedelf-platform/seedelf-crypto/src/register.rs:190` | is_owned: no key owns a register with an identity point [m07, m07c] | seedelf-crypto/tests/register_test.rs identity_register_is_owned_by_no_key, identity_public_value_is_owned_by_no_key, identity_generator_is_owned_by_no_key |
| `seedelf-platform/seedelf-crypto/src/register.rs:190` | is_owned's generator half alone [m07b] | none: equivalent mutant (an identity generator gives g*sk = identity, which only an identity public value matches, refused by the other half) |
| `seedelf-platform/seedelf-crypto/src/lovejoin.rs:256` | prove_sigma_or refuses a zero mix witness (with derive_nonce's at 131) [m03a, m03b] | none (t1a#3) |
| `seedelf-platform/seedelf-crypto/src/lovejoin.rs:200` | prove_schnorr refuses a zero secret (with derive_nonce's at 131) [m04a, m04b] | none (t1a#4) |
| `seedelf-platform/seedelf-crypto/src/lovejoin.rs:179` | fs_hash_sigma_or refuses N outside [2, 255] [m05] | none (t1a#5) |
| `seedelf-platform/seedelf-koios/src/koios.rs:1009` | lovelace parameters above MAX_* refused [k11] | seedelf-koios/tests/params_test.rs a_parameter_far_off_the_networks_is_refused (also a_drep_deposit_missing_or_off_is_none_not_a_guess) |
| `seedelf-platform/seedelf-koios/src/koios.rs:1018` | price_mem and price_step outside [0, MAX] refused [k12] | seedelf-koios/tests/params_test.rs a_parameter_far_off_the_networks_is_refused |
| `seedelf-platform/seedelf-koios/src/koios.rs:1044` | a reference-script price above 150 a byte refused [k13a] | seedelf-koios/tests/params_test.rs a_parameter_far_off_the_networks_is_refused |
| `seedelf-platform/seedelf-koios/src/koios.rs:1033` | a negative reference-script price refused in its own words [k13b] | seedelf-koios/tests/params_test.rs a_parameter_far_off_the_networks_is_refused (:108, by its message: Ratio::exact refuses -15 as 'Missing' anyway) |
| `seedelf-platform/seedelf-koios/src/koios.rs:1031` | a missing or out-of-range DRep deposit reads as None, never a guess [k14a cap, k14b guess] | seedelf-koios/tests/params_test.rs a_drep_deposit_missing_or_off_is_none_not_a_guess |
| `seedelf-platform/seedelf-koios/src/koios.rs:366` | register_of_datum: the tag (370), constructor 102's index (366), the trailing bytes (385) and the 48-byte length (398) [k15a, k15b, k15d, k15e] | seedelf-koios/tests/rows_test.rs nothing_but_constructor_0_with_two_48_byte_fields_is_a_register (:248) |
| `seedelf-platform/seedelf-koios/src/koios.rs:373` | register_of_datum: the field count (373) and the indefinite list's break (380) [k15c, k15f] | none (t1a#13) |
| `seedelf-platform/seedelf-koios/src/koios.rs:139` | a token with decimals null reads as 0, not an unreadable response [k16] | seedelf-koios/tests/rows_test.rs a_token_koios_has_no_decimals_for_reads_as_zero |
| `seedelf-platform/seedelf-koios/src/koios.rs:157` | a deep datum's JSON is dropped, not an unreadable response [k17] | koios.rs unit test a_deep_datum_or_script_in_a_transaction_leaves_the_history_readable; rows_test one_deep_row_leaves_the_rest_of_a_response_readable |
| `seedelf-platform/seedelf-crypto/src/cardano.rs:93` | an address index of 2^31 or more refused [m10a]; an account of 2^31 or more (check_account, 134) [m10b] | seedelf-crypto/tests/cardano_test.rs rejects_bad_input (:75); m10b also accounts_from_entropy_match_cardano_sdk |
| `seedelf-platform/seedelf-core/src/build.rs:103` | check_fee: a fee over MAX_FEE refused [c18] | seedelf-core/tests/build_test.rs a_fee_over_the_limit_is_refused_in_words |
| `seedelf-platform/seedelf-core/src/build.rs:269` | settle: an output value over MAX_VALUE_SIZE refused [c19] | seedelf-core/tests/build_test.rs an_output_holding_more_than_the_ledger_takes_is_refused_as_too_large (:1505) |
| `seedelf-platform/seedelf-core/src/build.rs:273` | settle: a signed draft over MAX_TX_SIZE refused [c20] | seedelf-core/tests/build_test.rs a_transaction_over_the_size_limit_is_refused_in_words |
| `seedelf-platform/seedelf-core/src/build.rs:278` | settle: `needed <= fee`, a draft's fee never under its own price [c21a: fee.abs_diff(needed) < 1_000] | seedelf-core/tests/mint_test.rs account::spends_as_few_as_it_can_and_can_put_up_a_spent_utxo (:1125 'fee 200000 covers 200900'); validity_test an_account_mint_is_measured_and_finished_with_the_slot (:297), without_a_slot_the_transactions_are_byte_for_byte_as_before (:315). build_test (the lane's) passes |
| `seedelf-platform/seedelf-core/src/build.rs:289` | settle prices the draft signed by every signer [c21b: no fake signatures] | seedelf-core/tests/build_test.rs 15 tests via assert_paid (:230 'fee 168889 < 177997') |
| `seedelf-platform/seedelf-core/src/build.rs:71` | reference_script_fee: over 204,800 bytes refused [c22a]; Conway's 6/5 tiers [c22b: flat price] | seedelf-core/tests/build_test.rs reference_scripts_are_priced_in_conways_tiers |
| `seedelf-platform/seedelf-core/src/build.rs:379` | deposit_outputs: a contract output under its least refused [c23] | seedelf-core/tests/build_test.rs explains_what_is_wrong (:552), paying_a_seedelf_refuses_a_register_that_would_lose_the_money (:1202); lovejoin_pools_test a_private_bootstrap_is_held_to_what_its_funding_pays_its_deposit_and_way_back_for. mint_test refuses_what_would_lose_money (the lane's) passes |
| `seedelf-platform/seedelf-core/src/build.rs:441` | change_outputs: key-address change under its least is NotEnough [c24] | seedelf-core/tests/build_test.rs adds_inputs_until_the_change_is_valid, a_payment_of_exactly_the_minimum_is_valid (:239) |
| `seedelf-platform/seedelf-core/src/build.rs:854` | account_payment: Max with several recipients refused [c25] | seedelf-web-wallet/wasm/tests/api_test.rs move_in::sends_to_several_addresses_in_one_payment |
| `seedelf-platform/seedelf-core/src/build.rs:897` | account_payment: more of a token than held [c26a]; a token not held, in its own words (894) [c26b] | seedelf-core/tests/build_test.rs explains_what_is_wrong (c26a also several_recipients_refuse_max_too_much_and_no_one) |
| `seedelf-platform/seedelf-core/src/build.rs:3112` | is_payable: undecodable or torsion (3112), identity generator (3113), identity public value (3114) [c27a-c] | seedelf-core/tests/mint_test.rs transfer::refuses_what_would_lose_money (c27a also explains_what_is_wrong, account::explains_what_is_wrong, transfer::max_pays_one_seedelf_everything_but_the_fee_and_what_kept_tokens_need) |
| `seedelf-platform/seedelf-core/src/build.rs:3281` | is_payable_address: Shelley only (3281), no script (3282), this network (3283) [c28a-c] | seedelf-core/tests/mint_test.rs withdraw::refuses_what_would_lose_money |
| `seedelf-platform/seedelf-core/src/build.rs:1589` | with_account: the account key isn't the one-time key (1589), inputs and collateral under the account's key (1609), nothing spent twice (1627), an ADA-only collateral (1637) [c29a-d] | seedelf-core/tests/merge_test.rs an_account_under_another_key_or_a_token_collateral_is_refused |
| `seedelf-platform/seedelf-core/src/build.rs:1601` | with_account: inputs and collateral on this network [c29e] | none (t1a#16) |
| `seedelf-platform/seedelf-core/src/build.rs:1760` | with_staking: only a script's cert-0 registration [c30] | seedelf-core/tests/staking_test.rs a_seedelf_spend_takes_no_certificate_whose_witness_it_never_adds |
| `seedelf-platform/seedelf-core/src/build.rs:1726` | mint_inline: the script must hash to the policy [c31] | none (t1a#7) |
| `seedelf-platform/seedelf-core/src/build.rs:1995` | ScriptSpend::settle: budgets over MAX_TX_BUDGET are TooMany [c32] | seedelf-core/tests/apart_test.rs what_no_order_pays_is_still_refused, and 6 more apart tests |
| `seedelf-platform/seedelf-core/src/build.rs:2059` | split: a pay_rest/carry under its least is NotEnough (SEEDELF_SHORT) [c33] | no core test (core 356/356 pass); seedelf-wasm api_test parts_of_any_shape (10 tests, e.g. a_carry_no_later_part_spends_counts_as_its_parts_change :4906) and wasm unit test api::chain_end_tests::a_chain_its_carries_paid_ends_on_the_last_carry (lib.rs:5378) |
| `seedelf-platform/seedelf-core/src/build.rs:2152` | stage: contract change under minimum_deposit is NotEnough [c34] | seedelf-core/tests/mint_test.rs explains_what_is_wrong, picks_pure_ada_first_and_as_few_inputs_as_it_can, transfer::refuses_what_would_lose_money, transfer::sends_part_of_a_token_from_the_utxos_holding_it |
| `seedelf-platform/seedelf-core/src/build.rs:2108` | remainder: checked lovelace (refund, paid, fee, deposit) [c35a] | seedelf-core/tests/mint_test.rs apart::two_boxes_are_never_spent_together_while_a_token_bearing_main_utxo_pays, withdraw::never_picks_a_utxo_the_wallets_evaluator_cant_take, withdraw::never_picks_a_utxo_whose_tokens_would_overflow_the_rest |
| `seedelf-platform/seedelf-core/src/build.rs:2118` | remainder: the tokens paid must be in the inputs [c35b] | seedelf-core/tests/mint_test.rs transfer::refuses_what_would_lose_money |
| `seedelf-platform/seedelf-core/src/build.rs:2105` | remainder: a burn needs the token [c35c] | none (t1a#17) |
| `seedelf-platform/seedelf-core/src/build.rs:1145` | collateral_output: a fee whose 3/2 the 5 ₳ can't cover refused [c36a] | seedelf-core/tests/mint_test.rs collateral_return_and_even_rounding |
| `seedelf-platform/seedelf-core/src/build.rs:1138` | even(): the fee rounded so 3/2 of it is whole [c36b] | seedelf-core/tests/mint_test.rs collateral_return_and_even_rounding (:916), and 5 more mint tests |
| `seedelf-platform/seedelf-core/src/build.rs:2197` | the account branch's collateral: a fee whose 3/2 it can't cover refused [c36c] | none (t1a#18) |
| `seedelf-platform/seedelf-core/src/build.rs:2267` | carried: refuses two outputs that could be the carry [c37] | none (t1a#8) |
| `seedelf-platform/seedelf-core/src/build.rs:1193` | add_witnesses: signing mustn't change the body's hash [c38] | none (t1a#9) |
| `seedelf-platform/seedelf-core/src/build.rs:1168` | is_collateral_signature: only giveme.my's key over the tx hash [c39] | seedelf-core/tests/mint_test.rs signed_by_the_one_time_key_and_giveme_my (no production caller: see notes) |
| `seedelf-platform/seedelf-core/src/build.rs:2672` | apart: lovelace sums in u128 [c40: u64] | seedelf-core/tests/apart_test.rs lovelace_past_what_a_u64_holds_is_never_summed_into_a_trap_when_choosing ('attempt to add with overflow') |
| `seedelf-platform/seedelf-core/src/build.rs:2843` | apart: refuses what no order pays; the line holds the 'short with everything' shortcut [c41: arm deleted] | none, and none needed: the refusal holds by construction (every Ok comes from attempt), and deleting the shortcut, r2a#2's fix, fails no test (see notes) |
| `seedelf-platform/seedelf-core/src/build.rs:2553` | select_script_inputs: never picks a UTxO the evaluator can't take [c42a] | seedelf-core/tests/mint_test.rs withdraw::never_picks_a_utxo_the_wallets_evaluator_cant_take (:2342) |
| `seedelf-platform/seedelf-core/src/build.rs:2911` | max_inputs_by: the same filter [c42b] | none (t1a#10) |
| `seedelf-platform/seedelf-core/src/build.rs:2556` | fitting in select_script_inputs [c43a] | seedelf-core/tests/mint_test.rs withdraw::never_picks_a_utxo_whose_tokens_would_overflow_the_rest (:2311 'Can't Merge Assets') |
| `seedelf-platform/seedelf-core/src/build.rs:881` | fitting in account_payment [c43b] | seedelf-core/tests/build_test.rs max_leaves_out_a_utxo_whose_tokens_would_overflow_the_rest (:821) |
| `seedelf-platform/seedelf-core/src/build.rs:2914` | fitting in max_inputs_by [c43c] | no core test; seedelf-wasm api_test withdraw::max_leaves_out_a_utxo_whose_tokens_would_overflow_the_rest (:2714), parts_of_any_shape::max_says_what_a_chains_last_part_left_holds_a_token_that_would_not_fit (:5197) |
| `seedelf-platform/seedelf-core/src/build.rs:3808` | fitting in account_inputs [c43d] | none (t1a#11) |
| `seedelf-platform/seedelf-core/src/build.rs:3747` | AccountMint::stage: a collateral return under its least refused [c44] | none (t1a#12) |
| `seedelf-platform/seedelf-core/src/build.rs:3559` | seedelf_in: exactly one Seedelf entry [c45b: [one, ..]] | seedelf-core/tests/mint_test.rs withdraw::refuses_what_would_lose_money |
| `seedelf-platform/seedelf-core/src/build.rs:3559` | seedelf_in: its quantity is 1 [c45a] | none (t1a#14) |
| `seedelf-platform/seedelf-core/src/build.rs:3337` | pay_address: zero of a token refused [c46a] | none (t1a#15) |
| `seedelf-platform/seedelf-core/src/build.rs:3341` | pay_address: a payment under its least refused [c46b] | seedelf-core/tests/mint_test.rs withdraw::refuses_what_would_lose_money |
| `seedelf-platform/seedelf-core/src/build.rs:3232` | payment_outputs: zero of a token (3232) and a payment under its least (3236) refused [c46c, c46d] | seedelf-core/tests/mint_test.rs transfer::refuses_what_would_lose_money (:1980 'none of a token') |
| `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:5183` | (extra, R2a's 1167 in production) sign_with_collateral_key refuses a signature not giveme.my's [w39a] | seedelf-web-wallet/wasm/tests/api_test.rs mint::signs_once_the_collateral_signature_checks_out (:998) |
| `seedelf-platform/seedelf-web-wallet/wasm/src/lovejoin.rs:3028` | (extra) finish_with_collateral_key: the same for a withdraw [w39b] | seedelf-web-wallet/wasm/tests/lovejoin_test.rs the_boxes_come_back_one_by_one_through_giveme_my |

## Checked and holds

- schnorr.rs:114, a vkh of 28 bytes: deleting the check fails schnorr_test create_proof_rejects_non_vkh_bound.
- schnorr.rs:67, the nonce's 32 fresh random bytes: dropping them fails schnorr_test create_proof_draws_a_new_nonce_each_time (:102, two equal commitments).
- register.rs:153, one d on both points: another d on the public value fails 6 crypto tests, among them proptest_crypto rerandomized_register_stays_owned_and_valid and schnorr_proof_round_trips_after_rerandomize.
- register.rs:190, is_owned's identity check: deleting it fails register_test's three identity tests; dropping its public-value half fails identity_public_value_is_owned_by_no_key (key 0 owns (G, identity)). Its generator half is redundant (an equivalent mutant).
- koios.rs:1009, 1018, 1044 and 1033: each cap or range deleted fails params_test a_parameter_far_off_the_networks_is_refused. The negative reference-script price at 1033 is pinned only by its words, since Ratio::exact refuses -15 as 'Missing' anyway.
- koios.rs:1031, the DRep deposit: dropping its cap, or guessing 500 ₳ for a missing one, fails params_test a_drep_deposit_missing_or_off_is_none_not_a_guess.
- koios.rs:366-398, register_of_datum: reading any tag, any constructor in 102's form, bytes after the datum, or a field of another length each fails rows_test nothing_but_constructor_0_with_two_48_byte_fields_is_a_register (:248).
- koios.rs:139, decimals null: reading a strict u8 fails rows_test a_token_koios_has_no_decimals_for_reads_as_zero.
- koios.rs:157, a deep datum's JSON: deserializing a Value directly fails rows_test one_deep_row_leaves_the_rest_of_a_response_readable and koios.rs's unit test a_deep_datum_or_script_in_a_transaction_leaves_the_history_readable.
- cardano.rs:93 (index) and :134 (account), below 2^31: each deleted fails cardano_test rejects_bad_input (:75).
- build.rs:103, check_fee: disabling it fails build_test a_fee_over_the_limit_is_refused_in_words.
- build.rs:269, MAX_VALUE_SIZE: deleting the check fails build_test an_output_holding_more_than_the_ledger_takes_is_refused_as_too_large (:1505).
- build.rs:273, MAX_TX_SIZE: deleting the check fails build_test a_transaction_over_the_size_limit_is_refused_in_words.
- build.rs:278, settle's `needed <= fee`: with `fee.abs_diff(needed) < 1_000` the lane's build_test passes, but mint_test account::spends_as_few_as_it_can_and_can_put_up_a_spent_utxo fails (:1125, 'fee 200000 covers 200900': an account mint kept at the first draft's fee), as do validity_test an_account_mint_is_measured_and_finished_with_the_slot and without_a_slot_the_transactions_are_byte_for_byte_as_before.
- build.rs:289, settle prices the signed draft: pricing it unsigned fails 15 build_test tests through assert_paid (:230, 'fee 168889 < 177997').
- build.rs:71 and :84, reference_script_fee: dropping the 204,800-byte cap, or flattening Conway's 6/5 tiers, fails build_test reference_scripts_are_priced_in_conways_tiers.
- build.rs:379, deposit_outputs' least: the lane's mint_test passes, but build_test explains_what_is_wrong (:552) and paying_a_seedelf_refuses_a_register_that_would_lose_the_money (:1202) fail, and so does lovejoin_pools_test a_private_bootstrap_is_held_to_what_its_funding_pays_its_deposit_and_way_back_for.
- build.rs:441, change_outputs' least: dropping it fails build_test adds_inputs_until_the_change_is_valid and a_payment_of_exactly_the_minimum_is_valid (:239, 'output 328031 below its minimum 978370').
- build.rs:854, Max with several recipients: allowing it fails wasm api_test move_in::sends_to_several_addresses_in_one_payment.
- build.rs:894 and :897, a token not held or more than held: each deleted fails build_test explains_what_is_wrong; more than held also fails several_recipients_refuse_max_too_much_and_no_one.
- build.rs:3112-3114, is_payable's three checks: each dropped fails mint_test transfer::refuses_what_would_lose_money.
- build.rs:3281-3283, is_payable_address's three checks: each dropped fails mint_test withdraw::refuses_what_would_lose_money.
- build.rs:1589, 1609, 1627 and 1637, with_account's four refusals: each deleted fails merge_test an_account_under_another_key_or_a_token_collateral_is_refused.
- build.rs:1760, with_staking: disabling it fails staking_test a_seedelf_spend_takes_no_certificate_whose_witness_it_never_adds.
- build.rs:1995, the budget limit in ScriptSpend::settle (which estimate() reaches with guessed budgets): deleting it fails apart_test what_no_order_pays_is_still_refused and 6 more apart tests.
- build.rs:2059, split's least for the rest: no seedelf-core test fails (356 pass), but 11 WebAssembly tests do: api_test's parts_of_any_shape tests (e.g. a_carry_no_later_part_spends_counts_as_its_parts_change, 'A payment to that address with these tokens needs at least 68.485900 ADA') and the wasm unit test api::chain_end_tests::a_chain_its_carries_paid_ends_on_the_last_carry. The parts planner needs NotEnough here, not deposit_outputs' or pay_address's own refusal.
- build.rs:2152, stage's least for contract change: deleting it fails 4 mint_test tests (explains_what_is_wrong, picks_pure_ada_first_and_as_few_inputs_as_it_can, transfer::refuses_what_would_lose_money, transfer::sends_part_of_a_token_from_the_utxos_holding_it).
- build.rs:2108-2115 and :2118, remainder: saturating its lovelace fails 3 mint_test tests; dropping its token separation fails transfer::refuses_what_would_lose_money.
- build.rs:1145 and :1138, collateral_output's checked_sub and even(): each fails mint_test collateral_return_and_even_rounding (even() 5 more mint tests too).
- build.rs:1168, is_collateral_signature: returning true fails mint_test signed_by_the_one_time_key_and_giveme_my. The production checks are WebAssembly's own (lib.rs:5183, lovejoin.rs:3028): disabling them fails api_test mint::signs_once_the_collateral_signature_checks_out (:998) and wasm lovejoin_test the_boxes_come_back_one_by_one_through_giveme_my.
- build.rs:2672, apart's u128 sums: u64 sums fail apart_test lovelace_past_what_a_u64_holds_is_never_summed_into_a_trap_when_choosing ('attempt to add with overflow').
- build.rs:2553, select_script_inputs' evaluator filter: removing it fails mint_test withdraw::never_picks_a_utxo_the_wallets_evaluator_cant_take (:2342).
- build.rs:2556, 881 and 2914, fitting: each removed fails a test (mint_test withdraw::never_picks_a_utxo_whose_tokens_would_overflow_the_rest; build_test max_leaves_out_a_utxo_whose_tokens_would_overflow_the_rest; for 2914 only the WebAssembly crate's api_test withdraw::max_leaves_out_a_utxo_whose_tokens_would_overflow_the_rest).
- build.rs:3559, seedelf_in's single entry: taking [one, ..] fails mint_test withdraw::refuses_what_would_lose_money.
- build.rs:3341 (pay_address's least) and :3232 and :3236 (payment_outputs' zero amount and least): each fails a mint_test refusal test.
- build.rs:2843: the refusal of what no order pays holds by construction (every Ok comes from attempt), and what_no_order_pays_is_still_refused still passes with the 'short with everything' shortcut deleted.
- The copies' baseline: the whole workspace passed 790 tests, 0 failed, 12 ignored, with full debug info and again with CARGO_PROFILE_DEV_DEBUG=0.

## Notes

- The worst gap is t1a#6: the nonce hedge is the one guard here whose loss could leak a key (with a failing random source), and a test needs a seam, since proof_nonce draws OsRng itself. The rest guard states nobody reaches today, or a refusal the node would make anyway.
- Equivalent mutants, so no test could catch them: register.rs:141-147 (rerandomize's explicit check, after from_compressed), register.rs:190's generator half, lovejoin.rs:200 and :256 alone (derive_nonce refuses at 131 too), and koios.rs:1033's negative check, which changes only the error's words. koios.rs:373 (the field count) is equivalent on every single CBOR item. Deleting any of them is a cleanup, not a risk.
- is_collateral_signature (build.rs:1167) has no production caller: only mint_test uses it. WebAssembly checks giveme.my's signature itself (lib.rs:5183, lovejoin.rs:3028), and both are pinned (extras w39a, w39b). The CLI attaches giveme.my's witness unchecked (seedelf-cli/src/commands/spend.rs:76-83). That's harmless: a wrong signature is refused at the node, from a trusted source.
- Two guards were caught only by tests the lane didn't name: build.rs:278 (build_test passes; mint_test and validity_test fail) and build.rs:379 (mint_test passes; build_test and lovejoin_pools_test fail). build.rs:2059 and fitting at :2914 are pinned only by the WebAssembly crate's tests: `cargo test -p seedelf-core` alone passes with either removed, and the workspace run CI does (web-wallet.yml:109) catches both.
- For r2a#2: deleting apart's `Grown::Short if whole => { failed = false; break; }` (build.rs:2843), its suggested fix, fails no test anywhere: every core target, seedelf-wasm and seedelf-cli all pass. A fix there needs its own test (r2a#2's apart_test case).
- Method: every mutant was applied in a copy ($HOME/.cache/seedelf-review-51/T1a, and a second copy T1a-b for parallel runs under a load average of 50 to 75), never TREE, and restored from TREE after each (checked byte for byte). The other verifiers' untracked r51_* tests were left out of the copies; four .hex files that wasm/tests/lovejoin_proven_bytes_test.rs includes from seedelf-verification/ were copied beside them. After the first nine crypto mutants the runs set CARGO_PROFILE_DEV_DEBUG=0 (debug info only: debug assertions and overflow checks unchanged, and the baseline passed 790 again). A crate step stopped at the first step with a failing test; a mutant that survived its crate ran every crate that depends on it (crypto and Koios: --workspace; core: seedelf-wasm and seedelf-cli, plus core's two slowest targets, lovejoin_box_value_test and lovejoin_width_test, moved there for batches 2 and 3).
- Not covered by these runs: CI also builds the WebAssembly and runs wasm/tests/*.test.mjs (14 node tests) and the extension's Vitest against it (web-wallet.yml:144-154, and fakes.ts imports @seedelf/wasm). Those see a Rust mutant only through a rebuilt wasm/pkg, which the brief rules out, so every survivor above is 'no Rust test fails'. A grep of extension/tests and wasm/tests/*.mjs for each survivor's words (prime-order, torsion, 'must be in [1, r)', 'between 2 and 255', 'minting script', 'two outputs that could carry', 'Signing changed', 'too small to put up as collateral', 'none of a token', 'hold the token to burn', "can't cover this transaction's fee", "isn't under the account's key", 'exactly one Seedelf', "Can't Merge") finds two hits, neither on these checks: mint.test.ts:172's 'Signing changed the transaction' is the worker's own check against a faked signer, and withdraw.test.mjs:66's 'exactly one Seedelf' is a UTxO without one. No guard in R1's or R2a's lists is TypeScript, so no Vitest mutant was needed.

## Coverage

Tried every guard in R1's (17) and R2a's (29) lists, none merged (the lanes don't overlap): 46 guards as 84 mutants (crypto 18, Koios 14, core 52), with a guard's sub-checks mutated one by one where it has several. Two extra mutants: WebAssembly's own giveme.my signature checks (lib.rs:5183, lovejoin.rs:3028), the production form of R2a's build.rs:1167. For each mutant: the lane's named test file, then the crate's tests; every survivor then ran the crates that depend on it (for crypto and Koios, the whole workspace, 790 tests; for core, seedelf-wasm and seedelf-cli, 351). Order: the guards with no named test first (schnorr.rs:106, register.rs:119, lovejoin.rs:256, 200, 179, schnorr.rs:62, build.rs:278, 441, 1726, 2058, 2264, 1193, 2553/2911, 2556 and the other fitting sites, 3747), then a stranger's or a site's input (koios.rs:361, 139, 157, register.rs:190, build.rs:3107, 3290), then the rest. Nothing was left untried. Not done: no WebAssembly rebuild, so wasm/tests/*.test.mjs and the extension's Vitest never ran against a mutant (a grep finds none naming a survivor's check; see notes); no Vitest mutant, since no guard is TypeScript. The copies and their targets are removed.
