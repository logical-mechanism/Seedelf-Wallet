# v-pr332-0-trace: pr332#0, "the overflow-check line isn't the crate line the docs draw"

## Verdict

**Confirmed, low (docs).** The finding's mechanism and its measurements all reproduce on HEAD (`6bca8bec`), with rustc 1.98.1 and the store build's own command. Overflow checks follow the crate whose rustc invocation compiles the code, not the crate that defines it:

- Some of core's code is compiled in seedelf-wasm's codegen, and there it wraps.
- seedelf-wasm's own slice sum of u64 runs core's checked copy, and there it traps.

The five doc statements that draw the line at the crate are wrong for both cases. There is no live case today, as the finding says.

Two corrections to its scenario, and one to its premise. None of them changes the verdict.

1. **`slot_at` and `mix_fee_estimate` aren't compiled in seedelf-wasm.** Both call std methods: `slot_config`, `saturating_sub` and `u64::from` in one, `Vec::is_empty` in the other. So both are compiled in core and checked: `llvm-nm` shows them `T` in core's rlib and `U` in seedelf-wasm's. In the two-crate model, functions of their shapes trapped. Of the finding's three named leaf helpers, only `Locked::total` wraps.
2. **"Some seedelf-wasm sums now trap" (the title) is potential, not actual, on HEAD.** In seedelf-wasm's IR, the only callers of core's shared `<slice::Iter<u64> as Iterator>::sum::<u64>` are my probes. Every real seedelf-wasm sum is one of:
   - over its own closures: its own instance, unchecked;
   - over usize slices: `<usize as Sum<&usize>>::sum` is defined in seedelf-wasm's own rlib;
   - in u128.

   The finding's scenario already says as much ("seedelf-wasm's plain sums go through its own closures or add usize counts").
3. **"Fat LTO" is not what the store build does.** Cargo doesn't LTO a package whose lib is `cdylib` + `rlib`: `cargo build -v` shows no `-C lto` on any crate. This doesn't matter here. The model, built with fat LTO, and HEAD's build, built with none, give the same results.

## What decided it

### 1. HEAD's crates, the store build's command, probes in seedelf-wasm

How it was built:

- I copied `seedelf-platform/` without `target/` into scratch and added `src/zz_probe.rs` to the copy's seedelf-wasm. The source is kept in scratch as `zz_probe.rs.txt`.
- I built it with `cargo build --locked --target wasm32-unknown-unknown --profile wasm-release`, as `build.sh` does, then ran wasm-bindgen into scratch.
- I called each probe from node, in a fresh process each time.

| Probe | Code | Result |
|---|---|---|
| `Locked { reference: 2^64−1, mix_box: 1, .. }.total()` | core, `launch.rs:90-92`, which seedelf-wasm calls at `lib.rs:2627` and `2713` | **returned 0** (wrapped) |
| `total_computation_fee(&params, vec![(2^64−1, 2^64−1); 20])` | core, `transaction.rs:189-194` (holds calls) | `RuntimeError: unreachable` |
| `vec![2^64−1, 1].iter().sum::<u64>()`, and the same over an array | seedelf-wasm | **`RuntimeError: unreachable`** (checked) |
| `vec![2^32−1, 1].iter().sum::<usize>()` | seedelf-wasm | returned 0 |
| `.iter().map(\|(c, _)\| *c).sum::<u64>()` | seedelf-wasm closure | returned 0 |
| `2^64−1 + 1` | seedelf-wasm | returned 0 |

The `-v` flags confirm the setup:

- `seedelf_core`, `seedelf_crypto` and `seedelf_koios` get `-C overflow-checks=on -C opt-level=z -C codegen-units=1`.
- `seedelf_wasm` gets `--crate-type cdylib --crate-type rlib -C opt-level=z -C codegen-units=1`, with no overflow checks and no `-C lto`.

### 2. Fidelity check

I removed the probes from the copy and built it again with `build.sh`'s exact `CARGO_ENCODED_RUSTFLAGS` remaps and the same wasm-bindgen flags. The result is **byte-identical to the tree's `wasm/pkg/seedelf_wasm_bg.wasm`**: sha256 `12dcf3339f0f7ed5261b8c930bfa2d7059a4a0c806694d9d5c425bb3d70739bc`, 3,209,441 bytes. So the scratch toolchain is the store build's. The probes don't change core's compilation, so their results describe the shipped module.

### 3. Where each function is compiled

**The symbols.** Core's rlib defines (`T`) `eval::slot_at`, `build::linear_fee`, `lovejoin::mixes_per_box_at` and `lovejoin::mix_fee_estimate`, and seedelf-wasm's rlib only references them (`U`). `Locked::total` is neither: no symbol in core, so seedelf-wasm compiles its own copy.

**The shared instance.** The only rlib that defines `<u64 as Sum<&u64>>::sum::<slice::Iter<u64>>` is `libseedelf_core`. In seedelf-wasm's IR, the probe's call target ends in `…Cs9u17sRyfo1_12seedelf_core`, which names the crate that instantiated it. That's share-generics, which is on at opt-level z.

**The full set.** seedelf-wasm's unoptimised IR (`cargo rustc … --crate-type rlib -- --emit=llvm-ir -C no-prepopulate-passes`, in the copy) lists every function of seedelf-core that seedelf-wasm's session compiles. The list is kept in scratch as `core_fns_compiled_in_seedelf_wasm.txt`:

- **`<Locked>::total`**: the only one with value arithmetic. Its fields are minimum-UTxO amounts from capped parameters (`MAX_COINS_PER_UTXO_SIZE` 20,000) and the key deposit (≤ `MAX_KEY_DEPOSIT`, 10 ₳), so it can't reach 2^64.
- **`build::max_inputs_by::<(bool, u32, u64), Room::picks::{closure}>`, and the `utxos::fitting` it instantiates**:
  - usize bookkeeping (`at_most - taken.len()` after its own `bail!`, `available.len() - taken.len()`);
  - token totals through `Assets::merge`'s explicit `checked_add`, which is compiled in core.
- **`ScriptSpend::proven::<prove_with closure>`**: no arithmetic.
- **Accessors**: `AccountMint::collateral`, `AccountLaunch::collateral`, `orders::Protocol::name` and `signs_with_stake`, `DrepKey::new` and `hash`, `orders::unspendable`. None does arithmetic.
- **crypto and koios**: `Register::new`, `Ratio::whole` and serde deserializers. None does arithmetic.

### 4. A two-crate wasm32 model on 1.98.1

The tree's profile is copied verbatim, with crate `a` (checks on) in core's place and cdylib `c` in seedelf-wasm's.

- **Wrapped:** `Locked::total`'s body verbatim, a plain leaf `+`, a leaf `*`, an `#[inline]` fn, a generic fn, an `impl Fn` fn, `c`'s own `+`, and `c`'s `[x, y].into_iter().sum()`.
- **Trapped:**
  - `#[inline(never)]`;
  - a fn holding a call;
  - the shapes of `slot_at` and `mix_fee_estimate`;
  - a call-free leaf over the cross-crate threshold;
  - `a`'s own sums;
  - `c`'s `.iter().sum()` and `vec.into_iter().sum()`, both instances `a` also makes.

### 5. The scratch test, named per the brief

The file was `seedelf-web-wallet/wasm/tests/zz_review_v-pr332-0-trace_1.rs`. Its two assertions state what the docs say. It was run under the store's profile as `cargo test --locked -p seedelf-wasm --profile wasm-release --test zz_review_v-pr332-0-trace_1`, with `CARGO_TARGET_DIR` in scratch.

- **On HEAD, 2 failed and 1 passed:**
  - `cores_locked_total_past_a_u64_panics_as_the_docs_say`: FAILED, "core's Locked::total wrapped to Some(0) rather than panicking".
  - `the_wasm_packages_own_slice_sum_wraps_as_the_docs_say`: FAILED, panicked at `core/src/iter/traits/accum.rs:206:1: attempt to add with overflow`.
  - `control_a_core_function_that_holds_calls_panics`: ok.
- **The brief's plain command** (the test profile, which checks every crate): 3 passed. So the test isolates exactly the `wasm-release` line.

The file was deleted after both runs.

## Where the docs draw the crate line (HEAD)

| Place | What it says |
|---|---|
| `seedelf-platform/Cargo.toml:44` | "Core, crypto and koios check integer overflow in the module, as every test build does … Not seedelf-wasm" |
| `seedelf-platform/CLAUDE.md:94` | "Its per-package overrides check integer overflow in `seedelf-core`, `-crypto` and `-koios` (a trap that locks the wallet, not a wrapped sum), but not in `seedelf-wasm`" |
| `post-release-roadmap.md:38` (item 4) | "✅ The overflow half: core's, crypto's and koios's arithmetic is checked in the module … seedelf-wasm's own isn't". **The finding misses this one.** |
| `post-release-roadmap.md:387` | "core's, crypto's and koios's overflow is checked in the module too … so a sum past its type traps and locks the wallet rather than wrapping" |
| `seedelf-core/src/lovejoin/mod.rs:1758-1760` (`MORE_THAN_THERE_IS`) | "Since 1.7.0 the module checks core's …, so one missed would trap and lock the wallet" |

`wasm/src/lovejoin.rs:2155-2157` ("the module doesn't check this crate's overflow") holds for that site, whose sum is an explicit `checked_add`.

## Severity

Low, as filed:

- The statements are for developers (CLAUDE.md, a Cargo.toml comment, a code comment, the roadmap). They aren't money statements a user reads.
- No value the ledger allows reaches an unchecked core sum today.
- The harm is the next change made by the documented rule: a small core helper on a datum value, left unchecked because "core traps", wraps in the store's module while every test build panics. That is the 314-core#1 shape. The reverse case, a seedelf-wasm u64 slice sum, would trap and lock the wallet where its comment says it wraps.

## Fix advice

The finding's fix is right. Refinements:

- **Fix five places, not four:** add `post-release-roadmap.md:38`.
- **Keep the rule short and say what to do.** Suggested text: *"Overflow checks follow the crate rustc compiles the code in, not the crate it's written in. A core function that calls something is compiled in core and traps. A small call-free one (`Locked::total`), an `#[inline]` one, or a generic one seedelf-wasm gives its own closure (`max_inputs_by`) is compiled in seedelf-wasm and wraps. A seedelf-wasm sum over a type core also sums (`slice::Iter<u64>`) runs core's checked copy and traps. The line moves with the toolchain: sum values from outside the wallet with `checked_*` in every crate, and rely on neither the trap nor the wrap."*
- **Drop the named examples.** Don't cite `slot_at` or `mix_fee_estimate` as wrapping helpers: they're checked.
- **No code change is needed for `Locked::total`:** it's bounded.
- **F2's `build.sh` grep** (pr332 report) guards the overrides' presence, not this line. It's still worth having.

## Outside this finding (for the lead)

- **`lto = true` in `[profile.wasm-release]` is inert for the module.** Cargo skips LTO for a package whose lib is `cdylib` + `rlib`, as seedelf-wasm's is (`wasm/Cargo.toml` `[lib] crate-type = ["cdylib", "rlib"]`, the rlib for its Rust tests). `cargo build -v` passes `-C lto` to no crate. `architecture.md:99` and `wasm/README.md:115` say the profile builds with "LTO". The measured sizes stand, since they came from builds made this way. It's a nit, docs only.
- **Roadmap item 4 (line 38) still shows 🚧**, though #333 merged its other half. That's the docs reviewers' ground.

## Scratch left

Everything is in `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/review/v-pr332-0-trace/`. The target dirs are removed.

- `repro/`: the two-crate model.
- `zz_probe.rs.txt` and `pkg/`: the probe module, so `node probe.mjs <pkg> zzLockedTotal` reruns without building.
- `core_fns_compiled_in_seedelf_wasm.txt`: the IR listing.
- `native-test.log`: the failing run.

No file in the tree was touched. The scratch test was deleted.
