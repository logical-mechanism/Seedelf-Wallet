# Fixer deep-datum (Lane R): 314-wasm#0

## 314-wasm#0 (high): **fixed**

The Rust half shows in the extension only after the lead rebuilds `wasm/pkg`. The TypeScript half (`wasm.ts`) works now.

### What changed

- **Core, `eval.rs`.** The datum half of `refusal()` is now `pub fn unreadable_datum(row)`, with the same predicate and words. `resolve_reference` refuses a row whose datum is nested past `cbor::MAX_DEPTH` or isn't one CBOR item, as `resolve_row` already did.
  - orders.rs's path (pinned DEX references) is checked: none of the recorded rows carries a datum (`order_cancels.json`, `reference_script_utxo.json`), and `orders_test` passes.
- **Core, `cbor.rs`.** New `output_within_depth(output, max)`. It checks the output, then checks each item the output embeds (inline datum, reference script) against `max` on its own.
  - The plan's plain `within_depth` before `post_alonzo` would not have worked. The datum sits in a byte string under tag 24, so the walk sees it as one item. The mutation check below shows it.
- **Core, `pool.rs`.** `post_alonzo`, which `held()` and `candidate()` both use, refuses such an output before decoding it.
  - Side effect: `candidate()` given a reference output with a datum that's too deep now answers `Rejected::Unreadable` instead of `BadDatum("nested too deeply")`.
  - Nobody sees this through WebAssembly: `resolve_row` refuses that reference row in words first, as before.
- **WebAssembly, `protocol_of`.** It skips (`continue`) a script row whose datum the wallet can't read.
  - The script is then carried, so `scriptsInline` ≥ 1, and discovery never keeps the pool. Both discovery paths require 0.
  - A request naming the pool still reads.
  - `lovejoinLaunchCheck`, the Koios path, goes through `protocol_of`.
- **Data layer.**
  - `datum.rs` gets `MAX_DEPTH` (128) and `within_depth`, its own iterative copy of core's walk, mirroring minicbor 0.25.1 item by item.
  - `standard.rs` takes a launch's script row only when its datum, if any, is within that depth.
  - If every row carrying the script's hash is too deep, the pool is rejected: "its launch put a script at the holder under a datum the wallet can't read".
  - If a readable copy sits beside a deep row, the readable one is listed. The wallet's `held()` would take that same row.
  - The module header now states the rule.
- **Shared vectors, re-recorded on purpose** (`RECORD_LOVEJOIN_VECTORS=1`).
  - New section `scriptRowDatums`: `maxDepth` 128 and 28 datums, each with `readable` from core's `cbor::within_depth`.
  - The datums cover every kind of nesting at 128 and 129 levels, an empty list at the 128th and 129th level, chunks, text, invalid UTF-8, floats and simple values, and each malformed case.
  - The `//` line now names `cbor::within_depth`. Nothing else in the file changed: the git diff is 146 insertions and 1 deletion (the comment line).
  - `lovejoin-shown.json` is unchanged. It holds only the earliest-of-each-value step, over pools that are already standard. The new rule is a standardness check.
- **`wasm.ts`.** `isTrap` now counts a RangeError thrown inside WebAssembly, or passed up through it, as a trap.
  - How it tells: the error's stack holds a WebAssembly frame. V8's own format, as in Chrome's worker, is `…:wasm-function[N]:0x…`. A test runner's formatter writes `wasm://wasm/<hash>` instead.
  - JavaScript's own overflow is still not a trap (JSON.stringify, plain recursion, a synthetic `new RangeError`).
  - So `tried()` and `verifiedPool` rethrow such an error. answerUi, `wallet.serial`, dapp.ts and sessions.ts's trap handlers then lock and reset the instance at once. Before, a broken instance stayed in use and trapped at some later call.
  - `tried()` and `verifiedPool` need no change: their JSON.stringify RangeError has no WebAssembly frame, so it stays a non-trap.

### The rule: only a datum past `MAX_DEPTH`, not any datum

This is the predicate `refusal()` already applies to every row the wallet evaluates: nested past 128 levels, or not one CBOR item.

**What I checked:**
- **Bundled head start** (`WW/extension/src/lovejoin-pools.json`): preprod has 2 pools (`dfa1f845…`, `18c4df77…`) with 4 script rows, none carrying a datum. Mainnet has 0 pools.
- **`WW/wasm/tests/fixtures/lovejoin-token-pool-preprod.json`:** 2 script rows, no datum.
- **`seedelf-core/tests/fixtures/lovejoin-token-preprod.json` and `lovejoin-token-preprod-runs.json`:** I decoded the recorded transactions' CBOR. The mix_box and mix_logic reference-script outputs carry no datum option.
- **`order_cancels.json` and `reference_script_utxo.json`:** the DEX rows `resolve_reference` reads carry no datum.
- **Extension fixtures** (`lovejoin-pool-preprod.json`, `lovejoin-shown.json`, `pool-history.json`): no script row with a datum.
- **Preprod chain:** one Koios `credential_utxos` read of the holder `288fea77…` on 2026-10-25.
  - 94 rows up to block 5,327,101. 14 carry a reference script, and none has an inline datum or a datum hash.
  - 6 NFT candidates. 3 were launched with their scripts at the holder: the head start's two (blocks 5,307,966 and 5,308,081) and `389ff2d3…` (block 5,311,850). All three are datum-free.
- **Mainnet:** not touched, per the brief. HANDOFF records no token pools on mainnet as of 2026-10-24, and mainnet's head start lists none.

**Why this rule.** Neither rule hides any existing pool. The depth rule refuses only what the wallet can't decode safely, and it is the limit the wallet already holds every untrusted datum to. Under "any datum", a genuine pool from a launch tool that leaves a small datum beside its scripts would never be shown, for no safety gain. A datum hash needs no ruling at all.

### Tests

| Test | Fail before | Mutation check |
|---|---|---|
| node `WW/wasm/tests/lovejoin-pools.test.mjs`, "a launch's script row under a datum too deep to read is no reference, and leaves the module whole (1.6.0's release review, 314-wasm#0)". Covers `lovejoinVerifyPool` (rows named by hash, and rows with bytes) and `lovejoinLaunchCheck` (Koios rows) at 3,000 and 100,000 levels, each called twice, so `scriptsInline` 1. At 128 levels it's 0, at 129 it's 1. Then a clean pool verifies as `tokenV1`. | Private pkg from the baseline: `RangeError: Maximum call stack size exceeded at wasm://wasm/00c315c2:wasm-function[4633]…` | Without `protocol_of`'s skip: `Error: UTxO eeee…#1 holds a datum the wallet can't read` (core's refusal fails the whole request), so the test fails. Restored: 56/56 node tests pass. |
| Rust `seedelf-core/tests/lovejoin_pools_test.rs`, `a_script_at_the_holder_under_a_datum_too_deep_to_read_is_no_reference` | `assertion left == right failed, left: 3, right: 2` (`held()` took the 129-level row) | Without `post_alonzo`'s guard: the same failure. With `output_within_depth` reduced to the outer walk: it fails too. |
| Rust `seedelf-core/tests/cbor_test.rs`, `a_reference_scripts_row_is_never_resolved_under_a_datum_too_deep_to_read` | `called Result::unwrap_err() on an Ok value: Resolved {…}` | Without `resolve_reference`'s refusal: fails. |
| Rust `cbor_test.rs`, `an_outputs_datum_and_script_are_each_held_to_the_limit` | new API | Without the embedded check: fails. |
| Rust `seedelf-core/tests/lovejoin_vectors_test.rs`, `the_script_row_datums_try_what_they_say` and `the_data_layers_vectors_are_this_crates_own` | The second failed until re-recorded (the committed file lacked the section) | — |
| Data layer `standard.rs`, `a_script_under_a_datum_too_deep_for_the_wallet_isnt_one_it_reads` | `left: Ok(true), right: Err("its launch put a script at the holder under a datum the wallet can't read")` | With the readable filter forced true: fails. |
| Data layer `datum.rs`, `every_script_rows_datum_is_held_to_seedelf_cores_depth` | new | With `open.len() == max` changed to `> max`: fails at "lists 129 deep" (true against false), and the `standard.rs` test fails too. |
| Vitest `WW/extension/tests/wasm-review-fixes.test.ts`, 3 tests under "a stack overflow inside WebAssembly (1.6.0's release review, 314-wasm#0)". The overflow is a real V8 RangeError from a 33-byte self-calling module, checked in both stack formats. The tests check that it's a trap, that the wallet locks at once and unlocks on a fresh instance, and that discovery hands it on. | `expected false to be true`; `…to throw error including 'The wallet's core stopped working…' but got 'Maximum call stack size exceeded'`; `promise resolved "undefined" instead of rejecting` | Without `isTrap`'s RangeError line: all 3 fail. |
| Vitest `WW/extension/tests/lovejoin-discovery-review-fixes.test.ts`, 2 tests under "a launch's script under a datum too deep to read (1.6.0's release review, 314-wasm#0)". Covers the data layer's list and the Koios look at 3,000 levels, each twice. Then a clean pool is kept. **Needs the pkg rebuilt.** | Today's shared pkg: `RangeError: Maximum call stack size exceeded`, then `RuntimeError: memory access out of bounds` from the instance it broke | Passes against my private pkg built from the fixed tree, run from a throwaway copy (since deleted), with `VITE_ENABLE_MAINNET` on and off. |

## Files touched

- `seedelf-platform/seedelf-core/src/cbor.rs`, `src/eval.rs`, `src/lovejoin/pool.rs`
- `seedelf-platform/seedelf-core/tests/cbor_test.rs`, `tests/lovejoin_pools_test.rs`, `tests/lovejoin_vectors_test.rs`, `tests/fixtures/lovejoin-pool-vectors.json` (re-recorded)
- `seedelf-platform/seedelf-web-wallet/wasm/src/lovejoin.rs`, `wasm/tests/lovejoin-pools.test.mjs`
- `seedelf-data/api/src/lovejoin/datum.rs`, `standard.rs`
- `seedelf-platform/seedelf-web-wallet/extension/src/background/wasm.ts`
- `seedelf-platform/seedelf-web-wallet/extension/tests/wasm-review-fixes.test.ts` (new)
- `seedelf-platform/seedelf-web-wallet/extension/tests/lovejoin-discovery-review-fixes.test.ts` (new)

## Keys

None added or changed. Nothing new is shown to users. Core's "holds a datum the wallet can't read" existed already, and the data layer's new reason is never shown.

## Docs to update

1. **`WW/docs/architecture.md`, line ~730, "Which pools are shown":**
   - Finished by its launch now means: that transaction puts mix_box and mix_logic at the holder, each under no datum or one nested within 128 levels (`cbor::MAX_DEPTH`), and registers L.
   - A script row under a deeper datum is no reference. WebAssembly's `protocol_of` passes it over and the script is carried (`scriptsInline` ≥ 1), so the pool is never kept, and the data layer leaves it out.
   - The vectors now hold the depth walk too (`scriptRowDatums`).
2. **`WW/docs/architecture.md`, line ~52, "A call that traps (`isTrap`…)":** this now includes a RangeError thrown inside WebAssembly. V8's stack overflow there leaves Rust's stack pointer behind. It is told from JavaScript's own overflow by a WebAssembly frame on its stack.
3. **`seedelf-data/README.md`, "Standard means:", last bullet:** the launch's mix_box and mix_logic at the holder are each under no datum or one nested within 128 levels, the wallet's limit. A deeper one is no reference to it. The offline-tests line (~67) can add "the depth walk, against the wallet's vectors".
4. **`seedelf-platform/CLAUDE.md`, the "Lovejoin's token-pool templates are pinned" bullet:**
   - The data layer's copy also holds the depth walk for a script row's datum (`datum.rs` `within_depth`).
   - `lovejoin_vectors_test.rs` writes the vectors from core's derive, its decoder and `cbor::within_depth`.
5. **`WW/docs/plans/chunk-34-token-pools.md`, item 22 ("Only standard pools are shown") and 34g's record of this review:** "scripts at the holder" now leaves out a row under a datum past 128 levels.
6. **No `privacy.md` change:** nothing new is asked or sent.

## Calls the owner might overturn

- **The rule is depth only (past 128 levels, or not one CBOR item), not "any datum".** Neither hides any existing pool (checked above).
- **A WebAssembly stack overflow now locks the wallet at once,** with a fresh instance, wherever a trap does. Before, it was swallowed. With the Rust fix, the hostile pool no longer causes one; this covers any other path that might. It refuses nothing the user does.
- **Detection reads the stack's WebAssembly frame** (V8's format).
  - Alternative considered: probing wasm-bindgen's `__wbindgen_add_to_stack_pointer`. It is precise, but tied to the glue's internals and stale after a reset.
  - What goes wrong if detection misses: the error is swallowed, as before the fix.
  - A RangeError with a WebAssembly frame really did unwind Rust frames, so it can't be counted wrongly.
- **Core's `candidate()` reason changes** (`Unreadable` instead of `BadDatum`) for a reference output with a datum that's too deep. Not visible through WebAssembly.

## Notes for the lead and other fixers

- **The pkg rebuild** is needed for `tests/lovejoin-discovery-review-fixes.test.ts` (2 tests) and for the new node test in `wasm/tests/lovejoin-pools.test.mjs`.
  - Against today's pkg the Vitest file fails as described.
  - It is a file of its own, so the instance it breaks doesn't spill into other files' tests.
  - `tests/wasm-review-fixes.test.ts` passes on today's pkg.
- **Traps are still swallowed in two places outside my files** (the finding's fix note 5). Both catches take everything: traps, and now RangeErrors from inside WebAssembly too. Neither calls `wallet.trapped()`, so a broken instance shows up only at the next UI request or queued key use.
  - `lovejoin.ts` readSet: `this.deps.pools?.(network).catch(() => this.handed.get(network) ?? [])`, around line 2262 (Lane L).
  - `runs.ts`: `ctx.lovejoin.withdrawDue(...).catch(() => undefined)`, around line 68.
  - Suggestion: rethrow `isTrap(e)` errors there, or call `wallet.trapped()`. With the Rust fix the deep datum no longer causes a trap, so this is defence in depth.
- **`seedelf-data` changed** (the rule, and its tests on the vectors). The API must be redeployed after the merge, which phase A's data fixes already require. Verdicts are kept in memory, so a new process checks every candidate again under the new rule.
- **No i18n changes.**
- **Cleanup:** the private pkg (`wasm/pkg-deep-datum/`, `wasm/tests-deep-datum/`) and the extension copy (`extension/tests-deep-datum/`, with its config) are deleted.

## Checks run

- **`seedelf-platform`:**
  - `cargo test -p seedelf-core --locked` (whole offline suite): pass.
  - `cargo test -p seedelf-wasm --locked` (native): pass.
  - `cargo clippy --locked -p seedelf-crypto -p seedelf-wasm -p seedelf-core --all-targets -- -D warnings`: clean.
  - `cargo fmt --all -- --check`: clean.
- **`seedelf-data`:** `cargo test --locked` (offline): pass. `cargo clippy --locked --all-targets -- -D warnings`: clean. `cargo fmt --all -- --check`: clean.
- **Node against the private pkg built from the fixed tree:** `node --test` on every `wasm/tests/*.test.mjs`, 56/56 pass.
- **Vitest on the shared pkg,** with `VITE_ENABLE_MAINNET=false` and without: pass.
  - The new files: `wasm-review-fixes`.
  - The 1.5.0 gate, unedited: `lovejoin-1-5-0`.
  - Trap handling: `wallet`, `session-trap`, `contacts`.
  - Pool discovery: `lovejoin-discovery`, `lovejoin-pools`, `lovejoin-pools-head-start`.
  - Strings: `words`.
  - Suites that use deep datums: `splash-remnant`, `chain`, `move-in`, `session-collateral`, `koios`, `cbor`.
- **Vitest against the private pkg** (throwaway copy): `lovejoin-discovery-review-fixes` and `wasm-review-fixes` pass, with `VITE_ENABLE_MAINNET` on and off.
- **`npm run typecheck`:** clean. One error in `Lovejoin.tsx` appeared mid-round; it was another lane's edit in progress and was gone on the rerun.
