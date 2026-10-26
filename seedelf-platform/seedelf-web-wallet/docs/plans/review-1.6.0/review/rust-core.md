# Review of the fixes: rust-core (seedelf-core, seedelf-wasm)

Lens: every Rust change since `499768f6` in `seedelf-core` and `seedelf-wasm`: phase A's private Bootstrap, and deep-datum, pool-exists, reserve, max-left, rr-1 and rr-2. There's no Rust in round 2: `git diff fc8561c7 e43eef7f -- '*.rs'` is empty. The shared `wasm/pkg`, built at 13:37, carries round 1's strings (rr-2's `with_staking` words, rr-1's `MORE_THAN_THERE_IS`, pool-exists' script guard).

**Verdict: no high, medium or low finding in this lens.** Every fix does what its report says, the classic pool is still byte for byte 1.5.0's, every new refusal is one the ledger makes, and CI's Rust checks pass. I found two stale comments (nits). I proved the cross-fix claims with probes, listed under Checks.

## Findings

### 1. nit: the WebAssembly's Bootstrap cap still describes the cap from before 318-rust#0

- **File:** `seedelf-platform/seedelf-web-wallet/wasm/src/lovejoin.rs:2009`. Concerns bootstrap (phase A, 318-rust#0). rr-2's 323-rust#2 checked only core's `bootstrap_most` doc.
- **Scenario:** `bootstrap_most_in`'s doc says the cap is "what its funding's reserve pays the deposit's fee and change for".
  - Since 318-rust#0 there are two reserves, `DEPOSIT_RESERVE` and `BOOTSTRAP_BACK_RESERVE`, and core builds the deposit *and* the sweep back.
  - At a dearer byte it's the sweep that sets the cap. My probe at 6,465 lovelace a byte gives 68 boxes in the classic pool and 51 in LJTEST's, and the deposit alone builds at 69.
  - A Lane R reader of the wrapper is told the old rule.
- **Evidence:**
  - The doc text at lovejoin.rs:2009-2012.
  - Core's doc, updated, at `seedelf-core/src/lovejoin/mod.rs:1929-1939`.
  - The probe's output, under Checks.
- **Fix:** say "what its funding's two reserves, the deposit's and the way back's, pay the deposit and its sweep back for (`lovejoin::bootstrap_most`, which builds both)". It's a comment only.

### 2. nit: rr-1's `MEASURE_LIMIT` comment overstates which builders check `MAX_TX_BUDGET`, and its memory figure contradicts `build.rs`

- **File:** `seedelf-platform/seedelf-core/src/eval.rs:27-35`. Concerns rr-1 (312#0).
- **Scenario 1:** the new comment says "each builder refuses it by checking the total against `MAX_TX_BUDGET`".
  - Only three builders do:
    - `ScriptSpend` (build.rs:1994);
    - the DEX cancels (orders.rs:1022);
    - `mix_with` (lovejoin/mod.rs:1077).
  - `lovejoin::withdraw_with` (mod.rs:1299 on) measures but never compares its total.
  - That's harmless today: every WebAssembly withdraw passes one box (`std::slice::from_ref(&chosen)` at lovejoin.rs:2565, 2662 and 2775).
  - A later multi-box withdraw would trust the comment.
- **Scenario 2:** the comment now says "16.5 million memory units". `build::MAX_TX_BUDGET`'s doc (build.rs:1108-1110) still says "They have only gone up since (17.5M memory at epoch 315)". Both fixtures carry `max_tx_ex_mem` 16,500,000: preprod at epoch 290, mainnet at epoch 658.
- **Evidence:** `grep -n MAX_TX_BUDGET` over `seedelf-core/src` and `wasm/src`, and the two `epoch_params` fixtures.
- **Fix:**
  - Narrow the sentence to "the builders that run several scripts (a mix, a Seedelf spend, a DEX cancel)".
  - Drop or correct build.rs's "only gone up since (17.5M …)" line.
  - Comments only.

## Checks

### What I ran, all passing

- **Core:** `cargo test -p seedelf-core --locked` for these binaries:
  - `lovejoin_pools_test` (31);
  - `lovejoin_planner_test` (12);
  - `lovejoin_launch_test` (8);
  - `cbor_test`;
  - `staking_test` (20);
  - `most_test` (5);
  - `lovejoin_vectors_test` (3);
  - `lovejoin_width_test` (4, 1 ignored live);
  - `lovejoin_test` (22);
  - `lovejoin_mainnet_test`;
  - the lib's unit tests.
- **WebAssembly:** `cargo test -p seedelf-wasm --locked --no-fail-fast`, every binary: api 85, lovejoin 23, lovejoin_flows 14, lovejoin_across 4, readme 1, and the rest. Only the shapes harness is ignored.
- **The CLI:**
  - `cargo build -p seedelf-cli --locked` builds, so `funding_for`, `per_box_in` and `funding_for_in` becoming a `Result`, and `external_sweep_with` going, break nothing. Neither the CLI, display nor koios uses them (grepped).
  - `cargo check --workspace --locked --all-targets` is clean.
  - The CLI's offline harness, `cargo test -p seedelf-cli --test cli`: 18/18, its two external sweeps included.
- **CI's Rust checks:** `cargo fmt --all -- --check` and `cargo clippy --locked -p seedelf-crypto -p seedelf-wasm --all-targets -- -D warnings` are clean.
- **Node:** `node --test "seedelf-web-wallet/wasm/tests/*.test.mjs"` on the shared pkg passes 57/57. That includes deep-datum's 3,000- and 100,000-level pool test and reserve's `lovejoin-reserve.test.mjs`.
- **The 1.5.0 gate:** `npx vitest run tests/lovejoin-1-5-0.test.ts` passes 4/4. Rust's `classic_deposits_are_byte_for_byte_one_point_fives` and `the_classic_pool_plans_three_wide_exactly_as_before` pass too.
- **The data layer:** `cargo test -p seedelf-data-api --lib lovejoin` (offline) passes 31/31, `every_script_rows_datum_is_held_to_seedelf_cores_depth` and `a_script_under_a_datum_too_deep_for_the_wallet_isnt_one_it_reads` included.

### Probes and mutations, in a copy with its own `CARGO_TARGET_DIR`, since deleted

1. **The private Bootstrap's cap against the chain the worker really builds.** A throwaway wasm test ran `bootstrap_most_in`'s cap through `chain_in` → `with_return` → `plan_return` → `external_sweep`. It funded the session as `mixFunding` does: `lovejoinFunding` at depth 0, plus `BOOTSTRAP_BACK_RESERVE`, plus the token.

   | Byte price | Pool | Cap | 1 box | At the cap | Cap + 1 |
   |---|---|---|---|---|---|
   | 4,310 | classic | 96 | `[deposit, back]` | `[deposit, back]` | `[deposit, back]` |
   | 4,310 | LJTEST | 64 | `[deposit, back]` | `[deposit, back]` | `[deposit, back]` |
   | 6,465 | classic | 68 | `[deposit, back]` | `[deposit, back]` | refused |
   | 6,465 | LJTEST | 51 | `[deposit, back]` | `[deposit, back]` | refused |

   - At 4,310, one deposit's most is what binds (97 and 65 still build).
   - At 6,465, cap + 1 is refused with "A Seedelf deposit of these tokens needs at least 2.185170 ADA".
   - So core's model, the deposit plus the sweep of its change at a base address under one key, matches the real return exactly. The reference input pool-exists added is included.
2. **Mutation of `bootstrap_most`'s sweep**, which became `Ok(true)` after the deposit. `a_private_bootstrap_is_held_to_what_its_funding_pays_its_deposit_and_way_back_for` fails at lovejoin_pools_test.rs:1778, so the test needs the fix.
3. **Is the launch split (`shaped`/`made`/`check_usable`/`spending`) behaviour-preserving?**
   - Method: I put 499768f6's `launch_apart` (every choice through `launch()` and its `usable`) into a unit test beside today's. I compared the seed and inputs chosen across 5 UTxO sets × 3 terms × `register` on and off, 30 runs. The sets:
     - 12 received classes;
     - mixed own, received, session and Lovejoin classes;
     - boxes only;
     - blind;
     - too little.
   - Result: 28 of 30 runs are identical, inputs and errors alike.
   - The 2 that differ are "too little ADA plus unusable terms": today says "Not enough ADA in the Seedelf balance…" where 499768f6 said "…couldn't be used". That's exactly rr-1's call #3, and nothing else changed.
   - `launch()` and `launch_from_account()` run the same checks. `usable` now runs after the outputs and staking are made, and those steps can't fail by themselves.
   - `locked.total()` is the same for every seed: a seed reaches the outputs only through fixed-size hashes (`templates::derive`). So the floor skips only choices that would have failed with `NotEnough`. Those carry `SEEDELF_SHORT`'s own words, the same as the fallback's.
4. **The four-box `MAX_TX_BUDGET` guard test**, run 4 more times: stable. The sum is about 0.8% over 10 billion steps, and `mix_logic` about 0.3% under.

### Read and confirmed against the code

- **pool-exists:**
  - Every output paid to a `mix_box` is one of these: `deposit_across` (the only deposit), `mix_with`'s outputs (which read every reference already), or the synthetic boxes of `usable`/`lovejoinBoxValue`. So every TokenV1 deposit path reads `references[0]`.
  - Only `pool_of` builds a TokenV1 `Protocol`, and it puts the reference first.
  - The classic pool reads nothing.
  - The tail's 500 priced bytes cover the 454 measured. `direct_tail` pays with every ADA-only UTxO, and each one brings more than its bytes cost.
  - `DEPOSIT_RESERVE` absorbs the 1,804 lovelace, and `bootstrap_most` builds, so it adapts.
- **deep-datum:**
  - `output_within_depth`/`embedded` matches how `eval::resolve` and Pallas encode an output.
  - `protocol_of` skips an unreadable script row before `resolve_reference`.
  - A reference row with an unreadable datum is refused by `resolve_row` first, as before.
  - The vectors' predicate is `unreadable_datum`'s own (`cbor::within_depth`).
  - The one malformed datum both walks accept, `bf 00 ff`, fails Pallas's decode in `post_alonzo`. So the wallet only carries that script, harmlessly.
- **reserve:** `direct_tail_reserve` = 0.177 (the deposit at 500 B) + max(1 + 0.97, 0.95 + 0.2 + 1.457), rounded up to 2.8 ₳ at 4,310.
  - That matches what `CollateralTail::build` drafts: the deposit at `FIRST_DRAFT_FEE`, the mix at `MIX_DRAFT_FEE` keeping its change's least, then the sweep's first draft.
  - The WebAssembly's `tail_reserve(bool)` sets aside 1.5 ₳ even for a session funded 2.8 ₳. That's fine on a chain: about 2.95 ₳ is left after the chain against about 2.78 ₳ needed, and the extra counts as spare.
  - `FIRST_DRAFT_FEE` and `MIX_DRAFT_FEE` replace their literals byte for byte. No other literal for those drafts remains.
- **max-left:** `LeftWhy` serializes as `"tokens"`, `"fee"` and `"limit"`. `Limit` happens only when no part failed. A chain resets the reason to `Tokens`, which is right: after a chain, only `fitting`'s overflow can stay. Over no UTxOs, it fails in one transaction's words.
- **rr-1:**
  - Every caller of the now-fallible planner functions uses `?` or `.ok()`, and none unwraps (grepped).
  - `chain_across_pools` drops zero legs before `chain_across`.
  - `plan_across` and `deposit_across` skip them byte for byte.
- **rr-2:**
  - `external_sweep` is identical to 1.5.0's (`63f87b8`, diffed).
  - `with_staking`'s only caller is the launch: script cert 0, or nothing.
  - The rule refuses only what the node refuses, Conway's cert 7 and every other certificate with no witness. A key's cert 0 was refused before this round too.
- **Overflow in wasm-release (no overflow checks):**
  - Every new sum on a pool's box ADA is checked: the planner, `funding`/`affordable`, `deposit_across`, `bootstrap_most` and `chain_from_account_at`.
  - Two unchecked products remain: `owned_in`'s `boxes.len() × denom` (wasm lovejoin.rs:2488) and `withdraw_with`'s `denom × n` (mod.rs:1338). Both need boxes on chain that hold that ADA, which can't exist. `usable`'s synthetic withdraw is one box and uses `saturating_sub`.
  - So I found no reachable wrap for x-release#7, the owner's call.
- **Every refusal is the ledger's:**
  - `MORE_THAN_THERE_IS` (more ADA than exists);
  - the deposit's script guard, unreachable for a verified pool;
  - `with_staking` (a missing witness);
  - the Bootstrap cap (the sweep's Seedelf output would be under its least);
  - the deep row, which isn't refused: its script is carried instead.
  - The launch's evaluable filter matches what `measure_locally` already refused.
- **Records from 1.5.0 and earlier 1.6.0 states:**
  - No request struct gained a required field this round.
  - A Bootstrap funded with its 5 ₳ still merges through `mixes_collateral`.
  - A record funded with neither builds with one box fewer and sweeps.

## Questions

- `BOOTSTRAP_BACK_RESERVE` is a fixed 1.5 ₳. So at a dearer byte the private Bootstrap's cap falls: 68 classic and 51 LJTEST at 6,465 lovelace a byte, from probe 1. Should it instead be priced from the parameters, as `direct_tail_reserve` is, so the cap stays one deposit's most? That's bootstrap's call 1, for the owner. It isn't a bug.
