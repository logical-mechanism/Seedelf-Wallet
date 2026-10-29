# v-pr332-1-trace: pr332#1, nothing fails if the wasm-release overflow overrides are removed

**Verdict: confirmed. Severity: low.** Confidence: high.

The finding is true as stated, and its numbers hold. I removed the three sections in a copy, rebuilt the module there, and ran the tests on it. A control build from the same copy matched the tree's module byte for byte.

## How I checked it

- **The copy.** `seedelf-platform/` went to my scratch folder without `target/`, `_reference/` or the extension's `node_modules`, `dist`, `release` and `test-results`. `node_modules` is a symlink back to the tree's.
- **The mutation.** I deleted `Cargo.toml:44-58` in the copy: the comment and the three `[profile.wasm-release.package.*]` sections.
- **The build.** I ran build.sh's own steps by hand: `cargo build --locked --offline … --target wasm32-unknown-unknown --profile wasm-release`, with build.sh's `--remap-path-prefix` flags and `CARGO_TARGET_DIR` in scratch, then `wasm-bindgen --target web --experimental-reset-state-function`. That was rustc 1.98.1 and wasm-bindgen 0.2.128, 171 crates.
- **The control.** I put HEAD's `Cargo.toml` back and rebuilt. Only 4 crates recompiled: crypto, koios, core and seedelf-wasm.
  - The control module is byte-identical to the tree's `wasm/pkg/seedelf_wasm_bg.wasm`: sha256 `12dcf333…3bc`, 3,209,441 bytes. Its JS glue is identical too.
  - So the three sections are the only difference between the two scratch modules.

## Results

| | HEAD's module (and the control) | Without the three sections |
|---|---|---|
| Size | 3,209,441 | 3,201,619 (−7,822) |
| sha256 | `12dcf333…` | `4103aa3a…` |
| "attempt to add with overflow" | 1 | 0 |
| "attempt to subtract with overflow" | 1 | 0 |
| "attempt to multiply with overflow" | 1 | 0 |

The counts are real occurrences (`grep -ao … | wc -l`). The finding's `grep -aoc` counts lines, but it gives the same numbers here.

- **The WebAssembly node tests pass on the module without the overrides.** `node --test "seedelf-web-wallet/wasm/tests/*.test.mjs"`, run in the copy: 57 pass, 0 fail.
- **The Vitest files changed since #332 pass on it too.** I ran, in the copy, the nine files that #333 to #337 changed:
  - `lovejoin-flows`, `lovejoin-release-rules`, `lovejoin`
  - `parts-send-review-fixes`, `tx-view-screen`
  - `lovejoin-discovery`, `lovejoin-merged-review`
  - `collateral-held`, `lovejoin-planner`
  - Result: 9 files, 364 tests, all pass. I didn't run the whole suite, since the brief forbids it.
- **Every older test already passed on an unchecked module.** CI's `check` passed on #330 (58m25s) and #331 (57m40s) per `gh pr checks`, and neither branch had the overrides. That check covers build.sh, the node tests, Vitest on both builds, and the three e2e runs.
- **#335's e2e addition can't depend on overflow.** It is a Transaction details stepper over normal amounts (`e2e/extension.spec.ts`, +20 lines).
- **The Rust tests are unaffected by construction.**
  - `cargo test --workspace --locked` uses the test profile, which takes dev's settings, so overflow checks are on.
  - The overrides sit under `profile.wasm-release`.
  - There is no `[profile.dev]` or `[profile.test]`, and no `seedelf-platform/.cargo/config.toml`.
- **Nothing reads the overrides or checks the module.**
  - `git grep "overflow-checks"` hits only `Cargo.toml:52,55,58`.
  - `git grep -E "attempt to (add|subtract|multiply)"` finds nothing outside the module.
  - `scripts/package.mjs:125` prints the zip's sha256 but compares it with nothing.
  - `wasm/build.sh:68-73` checks only for local paths.
- **#332 changed one test file, and only a comment in it** (`seedelf-core/tests/lovejoin_planner_test.rs`). Its probe "was a throwaway export, built and removed, never committed" (the PR body).
- **The proposed check behaves as described.** A scratch Vitest test made the same check on the module's bytes (`extension/tests/zz-review-v-pr332-1-trace-1.test.ts`, now deleted).
  - In the tree, on HEAD's module, it passed.
  - In the copy, on the module without the overrides, it failed: `{ add: false, subtract: false, multiply: false }`.
  - The finding's build.sh line, run on its own, exits 0 on HEAD's module and on the control. On the module without the overrides it exits 1 and prints its message.

## A behavioural test isn't at hand

1.6.0's x-release#7 suggested a WebAssembly node test that sends an overflowing request and expects an error. So I looked for an existing export on which HEAD's module traps and the other one wraps.

- **`buildTransfer` behaves the same on both modules.** I used the owned fixture with its rows' `value` set to 18446744073709551000:
  - A Max, or one huge row next to a normal one: both modules give core's own "Lovelace sum overflow".
  - Two huge rows paying 5 ₳: both modules build a transaction with one input.
- **The other paths I checked can't overflow either:**
  - `slotAt` saturates (`seedelf-core/src/eval.rs:260`).
  - `from_koios` bounds the protocol parameters (`seedelf-koios/src/koios.rs:1004-1025`).
  - `linear_fee` saturates (`seedelf-core/src/build.rs:49-54`).

The overrides are a backstop for sums nobody has found yet. A regression test therefore needs either a probe export, which would ship in the module, or a look at the module's bytes. That is why the finding's check is the practical one.

## The proposed fix

- **It works as stated.** See the results above.
- **build.sh is the right place for it.** A Vitest or node test that reads `wasm/pkg` would guard CI only. build.sh guards both CI and packaging:
  - CI's *Build WebAssembly* step runs it.
  - So does `npm run package` (`build:store` → `build` → `build:wasm` = `../wasm/build.sh`), so the store's module couldn't be packaged without the checks.
- **Where to put it:** after the local-path check (line 73), before the "Built …" line.
- **What it misses.** The finding already says it shows that some code is checked, not which. Concretely:
  - **One section removed.** If only koios's or crypto's section goes, the other crates' checks still put the shared message in the module, so the check stays green.
  - **A partial loss like F1's.** Code compiled in seedelf-wasm's crate would lose its checks while core's own sites keep the message. So the scenario's second half, a toolchain bump that moves more of core into seedelf-wasm, is caught only if every checked site goes. I didn't verify F1 itself.
  - **A false pass.** The check would also pass if a dependency started using a panic with the same message, as `strict_add` does. None does today: the module without the overrides has 0.

## Cleanup

The scratch test is deleted from the tree, and so is the scratch folder: the copy, its `target/`, the two modules, the probe and the logs. No tracked file was touched.
