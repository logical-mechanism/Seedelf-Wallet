# v-pr333-1-trace: verify pr333#1 (trace)

**Finding:** nothing tests that the pool page passes the worker's `back` to `bootstrapLimits`.

**Verdict:** partly. **Severity:** low.

The gap is real. Nothing tests the page's wiring from the worker's `lovejoin-bootstrap-most` answer to the form's shortfall. It is narrower than the finding says, in three ways:

1. **The finding's own mutation is caught by CI, by tsc rather than a test.** Dropping `privateBack` from the call at `Lovejoin.tsx:3115` leaves the state unread. `noUnusedLocals` (`tsconfig.json`) then fails CI's *Extension typecheck* step (`.github/workflows/web-wallet.yml:89-91`, `npm run typecheck`):
   `src/ui/screens/Lovejoin.tsx(2676,10): error TS6133: 'privateBack' is declared but its value is never read.`
2. **The mutation that gets through is the finding's other half:** the page stops setting `back` from the answer. tsc passes and so does every related test.
3. **"The screen tests render static markup, where the effect never runs" is only partly right.** `tests/screens-wiring-review-fixes.test.ts` runs PoolPage's effects over the house's `vi.mock("react")` seam. But none of its tests opens the Bootstrap form on the private side, and nothing answers `lovejoin-bootstrap-most`: `grep -rn "lovejoin-bootstrap-most" tests e2e` finds no test.

## What happens on HEAD

The wiring on HEAD is correct:

- **Worker:** `handlers.ts:591-592` answers `lovejoin-bootstrap-most` with `ctx.lovejoin.privateBootstrapBounds(...)`. In `lovejoin.ts:2966-2970`, that is `{ most, back: lovejoinBootstrapReserve(params) }`.
- **Page:** the effect at `Lovejoin.tsx:2680-2698` runs while the form shows on the private side. It sets `privateMost` and `privateBack`.
- **Form:** `Lovejoin.tsx:3115` calls `bootstrapLimits(pool, source, seedelf, privateMost, bootstrapBoxes, privateBack)`. Inside it, `reserves = DEPOSIT_RESERVE + (back === undefined ? BOOTSTRAP_BACK_LEAST : BigInt(back))` (`:3662`).

What each layer of tests covers:

- **The PR's form test** (`lovejoin-release-rules.test.ts`) calls the pure `bootstrapLimits(..., dear)` directly. So "if the form ignores back, the test fails" holds for the helper only.
- **e2e** reads `seedelf-core/tests/fixtures/epoch_params.json`, where `coins_per_utxo_size` is `4310`. There, `back` is `"1500000"`, the same as the stand-in. Its Bootstrap test (`e2e/extension.spec.ts:3368-3419`) also compares 300 ₳ to a 28 ₳ balance, nowhere near a 0.3 ₳ margin.

## Mutation runs

All runs were in a copy outside the tree.

- **The finding's mutation:** `bootstrapLimits(pool, source, seedelf, privateMost, bootstrapBoxes)`. tsc fails with TS6133, as quoted above.
- **The second mutation:** the success handler becomes `({ most }) => { if (!live) return; setPrivateMost(most); }`. tsc exits 0. `npx vitest related src/ui/screens/Lovejoin.tsx --run` covers every test file that imports Lovejoin.tsx, and all of it passes: **30 files, 557 passed, 0 failed.** That set includes:
  - `screens-wiring-review-fixes` (28 tests)
  - `screens` (72)
  - `lovejoin-release-rules` (18)
  - `lovejoin-session5-screens` (19)
  - `lovejoin-merged-screens`, `lovejoin-screens-review` and `lovejoin-held-balance`

## The deciding scratch test

There were two scratch tests, both since deleted:

- `tests/zz-review-v-pr333-1-trace-1.test.ts`, standalone, with a copy of the seam.
- `-2`, a copy of `screens-wiring-review-fixes.test.ts` with one `it` added to the *pool's Mix form* describe.

Both set up the same case:

- **The pool:** classic, under its floor (`others: 0`, floor 30), so the form leads with 30 boxes.
- **The worker's answer:** `lovejoin-bootstrap-most` answers `{ most: 96, back: "1800000" }`.
- **The balance:** 305 ₳ private. That is 30 × 10 ₳ + 1.5 ₳ + 1.5 ₳ + 2 ₳, and short of 305.3 ₳.

What they check:

- **The shortfall:** `lovejoin-bootstrap-why` says `cantAfford`, and Bootstrap is disabled.
- **Controls:** with `back` 1.5 ₳ and 305 ₳, there's no note. With `back` 1.8 ₳ and 305.3 ₳, no note either.

Results:

| Tree | Result |
|---|---|
| HEAD, in the tree | `-1`: 3/3 pass. `-2`: 1 passed, 28 skipped (`-t "pr333#1"`) |
| The finding's mutation | **fails**: `AssertionError: expected '' to be 'Your private balance holds 305 ₳: not…'` |
| The second mutation | **fails**, with the same assertion |
| HEAD restored in the copy | passes |

The house-style version that passed:

```ts
it("counts the way back's reserve the worker priced in what the Bootstrap form says the private balance must hold, never the 1.5 ₳ stand-in", () => {
  const formOf = (lovelace: string, back: string) => {
    seam.reset();
    seam.effects.add("PoolPage");
    answer("lovejoin-bootstrap-most", { most: 96, back });
    return page({ seedelf: seedelf(lovelace), pool: { ...classic, others: 0, free: 0 } });
  };
  const dear = formOf("305000000", "1800000");
  expect(payloads("lovejoin-bootstrap-most")).toEqual([{}]);
  expect(words(dear.match(/data-testid="lovejoin-bootstrap-why">(.*?)<\/p>/)?.[1] ?? "")).toBe(words(t("lovejoin.bootstrap.cantAfford", { held: formatAda("305000000") })));
  expect(has(formOf("305000000", "1500000"), "lovejoin-bootstrap-why")).toBe(false);
  expect(has(formOf("305300000", "1800000"), "lovejoin-bootstrap-why")).toBe(false);
});
```

## Severity

Low. HEAD is right, and this is only a missing test.

A regression would show nothing at today's price, where `back` is the 1.5 ₳ floor. At a dearer byte, the form would pass a balance up to `back − 1.5 ₳` short. The worker's funding counts the real reserve (`sessions.ts mixFunding`), so the build refuses after Review is pressed. That is MONEY-6's confusing refusal, and no money moves.

## Fix advice

**Add the test, with the house's seam.** Put the `it` above into `tests/screens-wiring-review-fixes.test.ts`, in the *pool's Mix form* describe, which already has `classic`, `seedelf`, `page`, `answer`, `payloads`, `has`, `words` and `formatAda`.

**Not a client render.** The finding asks for one, but there's no jsdom, happy-dom or `@testing-library` in `node_modules`. Vitest runs `environment: "node"`, and that file's header rules out a new dependency.

**Cover the setter.** The test should exercise the setter side, which tsc can't catch, not only the call's argument, which `noUnusedLocals` already guards.

## Cleanup

Deleted both scratch tests and the copy outside the tree. No tracked file was touched.
