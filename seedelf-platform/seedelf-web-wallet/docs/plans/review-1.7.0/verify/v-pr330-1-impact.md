# v-pr330-1-impact: tx-view's `ownRegister` and a trap under it

**Verdict:** refuted. With the shipped module, a real trap in `isOwned` still locks the wallet. **Severity:** nit. The one-line rethrow is an optional consistency change, not a defect fix. **Confidence:** high. I checked it against the real WebAssembly module with genuine traps, not mocks.

## Why HEAD already locks

- **The catch.** `ownRegister`'s bare `catch {}` does return `false` for a `RuntimeError` (tx-view.ts:214-224). But its own `finally { r.free(); }` throws after a real trap, and a throw in `finally` replaces the catch's `return false`.
- **wasm-bindgen 0.2.128** (Cargo.lock:3320-3321) anchors both objects before the body runs. An export taking `&self` and `&WasmRegister` takes an `RcRef` on each first: the `arg_conversions` call `Rc::increment_strong_count(js)` then `RcRef::new(rc)` (wasm-bindgen-macro-support 0.2.128, `src/codegen.rs:510-518`, `:930-960`, `:1027-1040`). Each object's strong count goes to 2 for the call.
- **No destructors run on a trap.** The module is built panic=abort: stable 1.98.1 (`rust-toolchain.toml`), wasm32-unknown-unknown, no `-Zbuild-std` in `build.sh`, and no panic or unwind support in the glue. Every trap inside `is_owned` skips the destructors: a panic, an out-of-memory abort, an out-of-bounds read, or a stack overflow in Rust. Both counts stay at 2.
- **The free throws.** The glue's `free()` is `wasm.__wbg_register_free(ptr, 0)` (pkg/seedelf_wasm.js:705-709). With `allow_delayed == 0` it claims ownership: `from_abi`, then `Rc::try_unwrap`. On `Err` it calls `throw_str("attempted to take ownership of Rust value while it was borrowed")` (codegen.rs:434-449, 486-500).
- **isTrap counts that message:** `/Rust value while it was borrowed|…/` (wasm.ts:49). So `serial`'s guard (wallet.ts:577-590) runs `broken()`, which sets `lockedBy = "trap"`.

## Runs

`extension/tests/zz-review-v-pr330-1-impact-1.test.ts`, run alone on HEAD, then deleted:

1. **An out-of-bounds trap.** The scratch test pointed the Register's generator String at an address past the end of WebAssembly memory, so the clone in `Register::from(&WasmRegister)` reads out of bounds.
   - `isOwned` threw `RuntimeError: memory access out of bounds`, and the strong count was 2 afterwards.
   - `r.free()` threw `Error: attempted to take ownership of Rust value while it was borrowed`, and `isTrap` was `true`.
2. **A panic.** The String's cap and len words were set past `isize::MAX`, so the clone panics on capacity overflow.
   - `isOwned` threw `RuntimeError: unreachable`, the count was 2, and the free threw the same borrow error (`isTrap` `true`).
3. **End to end through `txView`, with HEAD's tx-view.ts unchanged.** It built a private payment the way tx-view.test.ts:113 does. A spy on `isOwned` corrupts the register, calls the real method, then restores the pointer.
   - Result: `calls: 1`, error `RuntimeError: memory access out of bounds`. The view answered with contract outputs `theirs, theirs`, then `state: locked`, `lockReason: trap`.
   - Run alone (`-t`), the result was the same.
4. **The finding's own mock** (a `RuntimeError` thrown in JavaScript, never entering WebAssembly) gave `state: unlocked`, `lockReason: undefined`. That reproduces the finding's result. The shipped glue can't produce it: its `isOwned` (pkg/seedelf_wasm.js:969-991) throws a `RuntimeError` only from inside `wasm.seedelfkey_isOwned`, after the anchors are taken.

**Mutation copy,** outside the tree, with the proposed fix applied:
- Run 3: locked, trap. Same as HEAD.
- Run 4: locked, trap. This is the only run that differs from HEAD.
- `tests/tx-view.test.ts`: 10 passed.

## Reachability

- **There's no trigger anyway.** `ownRegister` runs only when `o.register?.payable` (tx-view.ts:247). `payable` is `build::is_payable` (wasm/src/decode.rs:1219): both points decode, are in the subgroup, and neither is the identity. So `is_owned` (seedelf-crypto/src/register.rs:176-197) can't return an `Err` on these points. It could only trap by running out of memory or on a heap already broken. The finding says as much ("No trigger is known").
- **Paths that would leave `r` unborrowed** don't arise:
  - **A stack overflow at the call's entry,** before Rust runs. `markYours` runs after an `await` on a shallow stack, and an overflow there would break nothing in the instance.
  - **"recursive use" on `keys.seedelf`.** `SeedelfKey` has no `&mut self` method, so nothing can hold it mutably.

## The fix

- **Right and minimal,** and within the owner's rules: no guard, no UI text, no privacy or Koios change.
- **It changes nothing in the shipped build.** On a real trap the free's borrow error replaces the rethrown `RuntimeError`. Both are traps, and the wallet locks either way.
- **What it buys.**
  - The lock no longer depends on wasm-bindgen's `free()` refusing a borrowed value, which is a detail of the 0.2.128 glue (`allow_delayed = 0`). A later glue that frees leniently would make the bare catch matter.
  - It matches `ownedUtxos` in balances.ts:489-505, the same shape with the explicit rethrow (`if (isTrap(e)) throw e;`).
  - Worth taking as a nit; nothing is lost if it waits.
- **The proposed test** fails on HEAD only because its mock skips WebAssembly. This is the house's way of testing a rethrow: private-index.test.ts:144-151 mocks `ownedUtxos`' check the same way. Taken with the fix, it pins the explicit rethrow. It should not be described as catching a lock that HEAD misses.
- **Nothing else moves.**
  - No test in the tree mocks `isOwned` to throw: contract-scan.test.ts:213 wraps the real one.
  - The view still answers, with or without the fix. Line 184's catch takes the `WalletLocked`, whose text (`worker.wallet.trapped`, "The wallet's core stopped working, so the wallet locked itself. …") doesn't match `isTrap`. What the details show is the same both ways (`theirs, theirs`), and the page follows the lock.

## Attribution

- **Pre-existing.** `git blame -L 213,224` puts all of `ownRegister` at 8de4dc64 (2026-10-05, an ancestor of babb8e76, so it shipped in 1.6.0).
- **The 1.7.0 PRs don't touch it.**
  - #330 (81397dc4) changed only `handlers.ts` in `src/`.
  - #335 (0bad0d52) added `partOf` and the parts lookup in `txView`, and nothing in `markYours` or `ownRegister`. It does run `ownRegister` on more transactions now (every part of a payment in parts), which changes nothing above.
