# v-pr330-0-impact: pr330#0, the restore scan handing its own trap on

**Verdict: confirmed. Severity: low. Confidence: high.**

The gap is real, and it's wider than the finding says. The proposed test pins only one of the three catches the finding's scenario names, so two of its three regressions would still pass every test.

Reviewed on HEAD `6bca8bec`. #338 is docs only (`post-release-roadmap.md`), as the owner says. Nothing merged after #330 touched the lines in question: sessions.ts changed only at 2090, 4445 and 5139–5613, and handlers.ts only at 509 and 586.

## Can it happen with the shipped build?

**Not as a defect.** On HEAD, all three catches the scan's WebAssembly calls outside the wallet's queue go through hand a trap on:

- `read` → `readDexOrder`, at sessions.ts:2727-2734;
- `hexOf` → `cip30Address`, at 2735-2742;
- `liveOrders`' `read` → `dexOrder`, at 3860-3868.

A real restore whose real scan traps ends `{ state: "locked", lockedBy: "trap" }`. My test B shows this on both Vitest builds. Only a test is missing.

For a user to be hurt, two things would both have to happen:

1. **A later edit drops one of the rethrows.** They have been there since the code was written: `aef01f72` (2026-10-07) for `liveOrders`, and `ce86c647` (2026-10-11) for `read` and `hexOf`. That makes the scenario's "as such catches did before 1.6.0" wrong for these three. It would be a new edit, not a revert.
2. **WebAssembly traps in the scan's reads.** No trigger is known:
   - The deep datum that once overflowed WebAssembly's stack at a spent Splash order's address is now refused unread (release review C06, splash-remnant.test.ts:264-299).
   - x-overflow checked orders.rs's sums under #332.

**If both happened:**

- Site 1 would be back in the state 1.6.0 shipped with: the wallet unlocked on the broken instance until something else traps.
- There is also a quieter loss. The scan resolves `{ used: 1, found: [] }` instead of finding the session's open order. It also clears the restore's `unscanned` mark, so the dApps page stops pointing to Find leftovers.
- No money moves. The order stays cancellable, and Find leftovers looks at that index again.

The same rethrows also serve Find leftovers (`session-scan`, handlers.ts:506-507). That request is awaited, so `answerUi` locks on the trap, and no test pins that either.

## Severity: low

By the brief's scale this is "a missing test on a minor path". It is not "a critical guard with no test" (medium):

- **The guard's handler half is pinned.** #330's own `it.each` fails when site 1 is reverted (M3 below).
- **The unpinned half is old defence in depth.** It predates #330 and has no known trigger.
- **The worst case is the state 1.6.0 shipped with.** The owner listed it as a 1.7.0 item, not a blocker.

## What I ran

I wrote three scratch tests on the real WebAssembly. In each, one function on the SessionService's own wasm (`signing(t, { wasm })`, or a `SessionService` given it) throws `new WebAssembly.RuntimeError("unreachable")`:

- **A** (`restore-scan.test.ts`'s "finds an order still open…" setup: `usedWith`, `swapped`, `orderRow`): `sessions.scan("preprod")` rejects with the trap itself (`rejects.toBe(trap)`, with the stub reached once).
  - A1 traps in `cip30Address`.
  - A2 traps in `readDexOrder`.
  - A control without a trap resolves `{ used: 1, found: [0] }`.
- **B**: `handle({ type: "restore-wallet", … })` with the 12-word phrase on a fresh `testBalances()`. Session 0's stake is used, with the same swap fixture. `vi.waitFor` sees `{ state: "locked", lockedBy: "trap" }`.
  - B1 traps in `cip30Address`.
  - B2 traps in `readDexOrder`.
  - A control without a trap ends unlocked, with the session found.
- **C**: a mainnet session whose Splash order (inline datum, made out to session 0) is spent, with `readDexOrder` trapping. `sessions.orders("mainnet", 0)` rejects with the trap itself, with the stub reached once. A control resolves `[]`.

**On the tree, run alone:** all 8 cases pass under `npx vitest run`, and again with `VITE_ENABLE_MAINNET=false` (CI's second build). `tsc` is clean on all three files with the project's own options. Under the brief's mutation rules, I made the mutations in a copy at `scratchpad/review/v-pr330-0-impact/`, outside the tree:

| Mutation | A1 | A2 | B1 | B2 | C | Existing tests |
|---|---|---|---|---|---|---|
| copy, unmutated | pass | pass | pass | pass | pass | restore-scan + handlers: 63 pass |
| **M3:** handlers.ts:166 back to `.catch(() => undefined)` | pass | pass | **fail** | **fail** | – | **#330's "locks … under a restore's scan" fails**; the other 62 pass |
| **M4a:** `hexOf`'s rethrow (2739) → `void e;` | **fail** | pass | **fail** | pass | – | 63 pass |
| **M4b:** `read`'s rethrow (2731) → `void e;` | pass | **fail** | pass | **fail** | – | 63 pass |
| **M4c:** `liveOrders`' rethrow (3865) → `void e;` | pass | pass | pass | pass | **fail** | 63 pass; splash-remnant, sundae-orders, order-cancel-check: 48 pass |
| **M4** (a + b, the finding's) | **fail** | **fail** | **fail** | **fail** | – | 63 pass |

"–" means not run: C reaches none of those lines.

I also grepped `extension/tests/` for anything that would catch M4a, M4b or M4c without running the whole suite:

- **Trap stubs.** Every `WebAssembly.RuntimeError` in the tests sits in 11 files. None throws into the sessions' `cip30Address` or `readDexOrder`. handlers.test.ts:130 mocks `scan` whole, and splash-remnant.test.ts:280 wraps `readDexOrder` but never throws.
- **Source-reading tests.** None looks at the catches' shape.

This matches the trace verifier's run: 181 existing tests across 13 files under M4 + M6.

## The fix

**What it can't break.** The finding's fix is tests only. It adds no guard, no text, no privacy note, no Koios cost, and changes nothing shipped. It is within the owner's rules.

**What's wrong with it:**

1. **It pins one catch of three.** A trap in `cip30Address` reaches only `hexOf`, so under M4b and M4c the proposed test stays green. Run the same case over `cip30Address` and `readDexOrder`, and both of `recoveredRecords`' catches are held.
2. **`liveOrders`' catch needs a test of its own.** It is the one that matters most. Anyone can put an output at a spent Splash order's address under the session's stake key, and `liveOrders` reads it (sessions.ts:3871-3874). That is how C06's trap got in. A test through `sessions.orders()` (C) pins the catch for every caller, the scan included, without arming a stub on its Nth call.
3. **B is redundant.**
   - #330's own `it.each` already fails under M3. Test A plus that test hold both halves of site 1.
   - That is the same shape site 3 has. run-traps-review-fixes.test.ts:261 and :277 call `withdrawDue` directly, so they hold the service half, and "end to end" overstates them. #330's test holds the handler half.
   - B costs a restore's key derivation and a `vi.waitFor` timing dependence, and it catches no mutation that A plus #330's test miss.
4. **Small points in the snippet:**
   - **`as typeof wasm` would fail `npm run typecheck`.** It names nothing in scope in restore-scan.test.ts, and tsc covers `tests/` (tsconfig.json:22). Write `const real = loadTestWasm()` and `as typeof real`.
   - **Use `rejects.toBe(trap)`, not "a RuntimeError",** as run-traps-review-fixes.test.ts does. Then a wrapped error, which `isTrap` wouldn't count, also fails the test.
   - **Don't assert the wallet is still unlocked after the scan.** Which caller locks is not the scan's business.

**The better fix: two tests, beside what they pin.**

In restore-scan.test.ts, after "finds an order still open…" (it has `usedWith`, `swapped`, `orderRow`, `signing`, `loadTestWasm`):

```ts
it.each(["cip30Address", "readDexOrder"] as const)("hands a trap in %s on, for its caller to lock on (#330)", async (call) => {
  const t = await unlocked();
  const real = loadTestWasm();
  const trap = new WebAssembly.RuntimeError("unreachable");
  const sessions = signing(t, { wasm: { ...real, [call]: () => { throw trap; } } as typeof real });
  await usedWith(t, 0, [
    [SWAP_TX, 5_000_100],
    [FUNDING_TX, 5_000_000],
  ]);
  swapped(t);
  t.koios.addedToAccounts.push(orderRow(SWAP_TX));
  await expect(sessions.scan("preprod")).rejects.toBe(trap);
});
```

In splash-remnant.test.ts, beside C06's deep-datum case (it has `mainnetSession`; add `loadTestWasm` to its import from `./fakes`):

```ts
it("hands a trap in reading the order's address on, rather than take it for no order", async () => {
  const t = await unlocked();
  const real = loadTestWasm();
  const trap = new WebAssembly.RuntimeError("unreachable");
  const sessions = signing(t, { wasm: { ...real, readDexOrder: () => { throw trap; } } as typeof real });
  await mainnetSession(t);
  await expect(sessions.orders("mainnet", 0)).rejects.toBe(trap);
});
```

**What these change:** nothing outside the tests. They are three cases of about 0.3 s each, on both builds, and tsc is clean. If the owner wants one test of the whole path anyway, B as the finding describes it is correct, but it needs `swapped(t)`: with only session 0's stake marked used, `cip30Address` is never called.

## Corrections to the finding

- **"as such catches did before 1.6.0":** these three always rethrew (see the history above).
- **"Site 3 is pinned end to end":** the cited tests hold its service half only. The handler half is #330's own test.
- **"Add one end-to-end test":** the finding describes two tests, and the restore-scan one is not end to end.
- **The scenario's three catches:** the proposed test holds only `hexOf`'s.

## Cleanup

I deleted `extension/tests/zz-review-v-pr330-0-impact-1.test.ts`, `-2` and `-3`, and the whole mutation copy. I touched no tracked file.
