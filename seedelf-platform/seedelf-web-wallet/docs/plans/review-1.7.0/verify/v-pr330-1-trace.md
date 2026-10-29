# v-pr330-1-trace: pr330#1, tx-view's `ownRegister` and a trap from `isOwned`

**Verdict: refuted. Severity: nit** (only a clarity and consistency point is left). Confidence: high.

## Summary

The finding reads the source correctly. `ownRegister`'s bare `catch {}` would swallow a trap-classified error thrown by `keys.seedelf.isOwned`. Its outcome is wrong for a **real** trap, though: the wallet does lock, with `lockedBy: "trap"`.

- A trap inside WebAssembly never drops wasm-bindgen's anchor for the `&WasmRegister` argument, so the `Register` stays borrowed.
- `ownRegister`'s `finally { r.free(); }` then throws `Error("attempted to take ownership of Rust value while it was borrowed")`.
- That throw replaces the catch's `return false`. `isTrap` counts it as a trap, so `serial` locks.

The finding's repro spies `isOwned` to throw a `RuntimeError` from JavaScript. That never enters WebAssembly and leaves nothing borrowed, so it shows a state production can't reach.

## The trace on HEAD (6bca8bec)

1. `tx-view.ts:239`: `const active = await wallet.withKeys(async (keys) => {`. `tx-view.ts:247` calls `ownRegister(wasm, keys, o.register)` inside it.
2. `tx-view.ts:214-224`:
   ```ts
   const r = new wasm.Register(register.generator, register.publicValue);
   try { return keys.seedelf.isOwned(r); } catch { return false; } finally { r.free(); }
   ```
3. The glue, `wasm/pkg/seedelf_wasm.js:980`: `wasm.seedelfkey_isOwned(retptr, this.__wbg_ptr, register.__wbg_ptr)`. Both arguments are borrowed through `RefFromWasmAbi`.
4. wasm-bindgen is 0.2.128 (`seedelf-platform/Cargo.lock:3320-3321`). In `wasm-bindgen-macro-support-0.2.128/src/codegen.rs`:
   - **Borrowing an argument (510-518):** `ref_from_abi` does `Rc::increment_strong_count(js); … RcRef::new(rc)`. `RcRef` (`wasm-bindgen-0.2.128/src/rt/mod.rs:613-632`) holds a `Ref` and an `Rc`, and releases them only when it is dropped.
   - **What a trap does to that:** a trap (`unreachable`, a stack overflow, OOM) unwinds the module without running any Rust drops, so the extra strong count stays.
   - **Freeing (488-499):** the free function with `allow_delayed == 0` (`seedelf_wasm.js:708`: `wasm.__wbg_register_free(ptr, 0)`) runs `from_abi`.
   - **Why that throws (435-446):** `from_abi` does `match Rc::try_unwrap(rc) { … Err(_) => throw_str("attempted to take ownership of Rust value while it was borrowed") }`. The glue rethrows it as `new Error(…)` (`seedelf_wasm.js:3598-3600`).
5. A throw in `finally` replaces the catch's `return false`, so `ownRegister` throws that error.
6. `wasm.ts:49`: `return e instanceof Error && /Rust value while it was borrowed|recursive use of an object detected/.test(e.message);`. That is true here.
7. `wallet.ts:582-584` (`serial`): `if (!isTrap(e)) throw e; await this.broken(); throw new WalletLocked(WASM_BROKEN());`.
   - `wallet.ts:599`: `this.lockedBy = "trap";`, then `wipe()`.
   - `freeQuietly` (771-779) swallows the borrowed key's own failing `free()`, so the lock completes.
8. `tx-view.ts:184-186` swallows the resulting `WalletLocked`. "The wallet's core stopped working…" doesn't match `isTrap`, which is as line 183 intends. `changed()` tells the pages, which follow the lock.

**What could still be swallowed.** Only a trap thrown before `ref_from_abi(register)` runs leaves `r` free and gets lost. Two cases exist:

- A stack overflow at the export's very entry. That needs a nearly full JavaScript stack, and the `withKeys` task runs on a shallow microtask stack.
- "recursive use" on borrowing `keys.seedelf`. `SeedelfKey` has no `&mut self` method and no re-entry (`wasm/src/lib.rs:5352-5418`).

Neither can happen in production.

## Repro

The scratch test was `extension/tests/zz-review-v-pr330-1-trace-1.test.ts`, run alone. It is deleted. It built a private payment as `tx-view.test.ts:113` does.

To make a real trap, `trapInside` runs the **real** `isOwned` under deep JavaScript recursion, binary-searched until V8 runs out of stack at the call's deepest point inside the module. The result is a `RangeError` with `wasm://wasm/00c3e386:1:1092215` frames, at about 13,900 frames, and `isTrap` is true.

Results on HEAD (3 of 3 passed):

1. **The finding's own repro** (the spy throws a `RuntimeError` from JavaScript): seedelf outputs `theirs,theirs`, `state()` `unlocked`, `lockReason()` undefined. This matches the finding.
2. **A real trap, called directly:** after the trap, `r.free()` threw `Error: attempted to take ownership of Rust value while it was borrowed`, and `isTrap` called it a trap. An untouched `Register` freed quietly on the same instance.
3. **A real trap under `txView`:** one `isOwned` call ran. `Register.prototype.free` threw that borrowed error, once. `state()` was **`locked`** and `lockReason()` was **`"trap"`**. The view still answered, with nothing marked.

I applied the finding's fix (`catch (e) { if (isTrap(e)) throw e; … }`) in a copy outside the tree (`scratchpad/review/v-pr330-1-trace/`, deleted):

- Test 1 now fails: the simulated trap locks.
- Tests 2 and 3 pass unchanged: a real trap locks either way.
- `tx-view.test.ts`'s 10 tests still pass.

## Fix advice

The fix is harmless. It matches `balances.ts:496-499` (`ownedUtxos`, e69697b4, the 26b review), which rethrows explicitly because its "not ours" answer is sealed for good. Tx-view persists nothing.

- **It is not a lock fix.** With a real trap, the error that reaches `serial` is still `r.free()`'s, because the `finally`'s throw replaces the rethrow.
- **What it buys:** robustness. Today the lock depends on `finally { r.free(); }` throwing. If that line became a quiet free, or a wasm-bindgen upgrade deferred freeing a borrowed object, the rethrow would be what locks. Keep `r.free()` in the `finally` either way.
- **The proposed test:** a spy throwing a `RuntimeError` from JavaScript fails on HEAD and passes with the fix, but it exercises an unreachable state. A real-trap test like test 3 pins the behaviour that matters, and it passes on HEAD and with the fix.

The finding's "pre-existing (8de4dc64)" is right: blame gives 8de4dc64 for lines 213-224, and 8de4dc64 is an ancestor of babb8e76.
