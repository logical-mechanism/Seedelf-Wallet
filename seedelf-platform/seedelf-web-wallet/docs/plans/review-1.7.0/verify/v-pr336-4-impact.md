# v-pr336-4-impact: pr336#4, `confirmed()`'s trap rethrow has no test

**Verdict: confirmed. Severity: low** (as filed). Confidence: high.

- **The gap is real, and wider than the finding measured.** Mutation M5 survives every test file that wires discovery: 19 files and 385 tests, not just the 62 tests in the 2 files the finding ran.
- **HEAD (`6bca8bec`) is correct.** The rethrow is there, and a trap that reaches it locks the wallet. Only the test is missing.
- **The guarded event is rare in practice.** Short of a Rust bug, an out-of-memory, or an instance some other swallowed trap already broke, I found no input that makes the code inside that `try` trap.
- **The proposed test is right.** It passes on HEAD in both CI builds and fails on M5. Two corrections, on where it goes and how it's set up, are under *The fix*.

## Is it reachable in the shipped build?

### The path: yes, on mainnet's default path

- `confirmed()` runs only from `refresh()` (`lovejoin-pools.ts:454`), once the data layer has answered.
- The worker gives discovery the private index (`sw.ts:236`, `new PoolDiscovery({ local, wasm, koios, index, now: Date.now })`). That index returns nothing on preprod, with Koios-only on, or with the private part down (`private-index.ts:368`, `if (!at || (await deps.koiosOnly()) || !(await deps.parts.up("private"))) return undefined;`). So the path runs on mainnet, with the data layer up.
- `launched()` runs only for a listed pool the device hasn't kept (`:566-569`). The bundled mainnet head start has `"pools": []` (`src/lovejoin-pools.json:277-279`), so that's any token pool the data layer lists on mainnet. It runs at the first non-quiet pool read after the pool is listed.

### A trap at `:578`: no known trigger

- **What runs inside the `try`:**
  - **Koios:** `koios.launches` and `koios.firstRegistrations`, plain JavaScript with no WebAssembly.
  - **WebAssembly, twice,** both times through `tried()`, which rethrows a trap (`:250`) into this catch:
    - `lovejoinLaunchCheck` (`:537-539`);
    - `launched()`'s own `verified()` (`:542`), a second `lovejoinVerifyPool`.
- **`launch_check` mostly repeats work that has already run** (`wasm/src/lovejoin.rs:705-736`).
  - It does `verify_pool`'s work again on the same server rows: `resolve_row`, `candidate`, `protocol_of` and `PoolView::of`.
  - `refresh()`'s first `verified()` (`:450`) already ran that work, outside this `try`, and its trap rethrow is tested (`wasm-review-fixes.test.ts`, "is handed on by pool discovery"). Any trap that the data could trigger fires there first.
- **What it adds can't panic on its input:**
  - The hex decode of Koios's inputs fails with an error, not a panic: `hex::decode(&i.tx_hash)?.try_into().map_err(...)`.
  - In `find_seed`, `policy_of` is `templates::one_shot_mint(&seed.0, seed.1).ok()` (`seedelf-core/src/lovejoin/pool.rs:484-497`), so a failure is just `None`.
  - The stake address is a fixed 29 bytes, encoded to bech32.
- **The second verify repeats the first.** It runs with the seed `find_seed` found, which makes the same policy, so the same scripts.
- **314-wasm#0's real trigger is closed.** That was a deep datum on a script row, now refused in Rust (`pool.rs:152`, `:280`, `within_depth`). It would hit the first verify anyway.
- **What's left to reach `:578`:** a trap with no input behind it, from an out-of-memory or an instance already broken by a trap swallowed elsewhere. That's rare.

### The regression: plausible, and likely sooner than "a later edit" suggests

- The fixes proposed for F2 (pr336#1) and F3 (pr336#2) both restructure this code.
- `v-pr336-1-impact` already warns that F2's second option, starting the check without awaiting it, "would drop a WebAssembly trap unless it gets a route to `wallet.trapped()`".
- Today no test would catch that.

### The harm if it regressed

- The trap is taken for Koios being down, and the pool is left out until the next list.
- The wallet stays unlocked on a broken instance, whose "later calls fail or misbehave" (`wasm.ts:4-6`).
  - 1.6.0's skeptic for 314-wasm#0 measured the instance breaking again "within a refresh or two".
  - It then locked at some unrelated call, with the cause hidden.
- If the trap repeats, it does so at every list, every 5 minutes.
- 314-wasm#0's fix and #330 (`unawaited`, `handlers.ts:48-52`) removed exactly this behaviour.
- No money moves because of it alone.

### Severity: low

It is "a missing test on a minor path".

- **Not medium:**
  - HEAD is right.
  - Nothing known triggers the guarded event.
  - The trap sites ahead of it, on the same data, are tested.
  - What it guards is the lock, not money or privacy directly.
- **Not a nit:** this is new behaviour from #336 without a test, which the brief's "does each new behaviour's test fail without it?" covers.

## The fix

**Test-only, and within the owner's rules.**
- It adds no guard, refusal, text, privacy note or doc.
- It changes nothing at runtime, so it breaks nothing.

**Checked** with the scratch test `tests/zz-review-v-pr336-4-impact-1.test.ts`, 6 cases, now deleted:

- **On HEAD:** 6/6 pass in both CI builds, `npx vitest run` and `VITE_ENABLE_MAINNET=false npx vitest run`.
- **On M5, in a copy:** the finding's case fails with `AssertionError: promise resolved "undefined" instead of rejecting`, at `await expect(a.d.refresh("preprod")).rejects.toBe(trap)`.
  - The two extra trap cases fail too.
  - The sanity case and the refusal control still pass.

**Corrections to the proposed test:**

1. **Where it goes:** `lovejoin-discovery.test.ts`, in #336's own describe ("a pool the data layer lists, confirmed from Koios before it's kept").
   - That file already has `koiosOf([], [launch()])`, `onIndex()`, `listed()` and the real WebAssembly.
   - It needs `serviceDeps` imported, and a way to override `lovejoinLaunchCheck`: a `wasm` option on `discovery()`, or a direct `new PoolDiscovery({...})` as "starts from the bundled head start's height and pools" does.
   - **Not `wasm-review-fixes.test.ts`'s `listing()` as it stands** (the finding's `:118`):
     - It lists `scripts: []`. With the real verify, the scripts are then read inline (checked: `scriptsInline > 0`), so the pool never reaches `confirmed()`.
     - Its Koios fake throws in `koiosAlone()` (`:570`), which is outside the `try`.
2. **Koios must answer `tx_info` with the launch's inputs.** Otherwise the candidate goes to `unknown` and `lovejoinLaunchCheck` never runs. Assert that `tx_info` was asked, so the trap is known to come from inside the `try`.
3. **Assert `serviceDeps(d).pools()` on a fresh discovery.** A second `refresh()` on the same one asks the data layer again (F3's path).
4. **Optional and cheap:**
   - A trap in `launched()`'s second `lovejoinVerifyPool`: let the first call pass and the second trap. `:579` covers both calls.
   - A `RangeError` thrown inside WebAssembly (`wasm-review-fixes`' `overflowing()`), the class 314-wasm#0 hit.
   - Both pass on HEAD and fail on M5.
5. **If F2 takes its background option,** the trap would travel through `unawaited` or `wallet.trapped()`.
   - This test should then assert the lock rather than a rejection: `WASM_BROKEN`, or `locked` with `lockReason() === "trap"`.
   - Land it before or with F2's and F3's fixes.

## Runs

**M5:** in `scratchpad/review/v-pr336-4-impact/`, with `if (isTrap(e)) throw e;` removed at `lovejoin-pools.ts:579` (the diff is that one line). These 19 files: storage-privacy, lovejoin-planner, lovejoin-discovery-review-fixes, run-traps-review-fixes, lovejoin-hub, collateral-reserve-review-fixes, wasm-review-fixes, lovejoin-discovery, lovejoin-pools-head-start, lovejoin-form-review-fixes, lovejoin-merged-review, lovejoin-crediting-review-fixes, lovejoin-flows, lovejoin-merged-screens, lovejoin-held-balance, lovejoin-screens-review, lovejoin-1-5-0, lovejoin-session5-screens and worker-language.
  - **Result:** `Test Files 19 passed (19)`, `Tests 385 passed | 2 skipped (387)`.
  - **Why no test catches it:** the other trap tests stub `pools`, `readSet` or `lovejoinVerifyPool`, and none drives `confirmed()` with a trap.

**Scratch test cases:**
- **Sanity:** the pool is kept, after one `tx_info`.
- **The finding's case:** `lovejoinLaunchCheck` throws `new WebAssembly.RuntimeError("unreachable")`, Koios answers the launch, and `refresh()` and `serviceDeps(d).pools()` both `rejects.toBe(trap)`.
- **Second verify:** a trap in the second verify is handed on.
- **RangeError in WebAssembly:** handed on as well, and `isTrap` is true for it.
- **Detail:** `listing()` with `scripts: []` gives `scriptsInline > 0`.
- **Control:** a refusal in words leaves the pool out and resolves.

**Cleanup:** the scratch test and the copy are deleted. Nothing in the tree was edited but this file.
