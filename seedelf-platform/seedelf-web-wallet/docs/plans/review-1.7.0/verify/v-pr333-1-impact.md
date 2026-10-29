# v-pr333-1-impact: the page's wiring of the worker's `back` has no test

**Finding:** `pr333#1` (pr333's report, finding 2). **Role:** impact and the fix. **Tree:** HEAD `6bca8bec`.

**Verdict: confirmed. Severity: low** (the low end of it). **Fix: right in substance, wrong vehicle.** Use the house seam, not a client render.

## What I checked

### The gap is real

HEAD wires the worker's figure correctly:

- `Lovejoin.tsx:2683-2694`: the effect sets `privateBack` from the `lovejoin-bootstrap-most` answer.
- `Lovejoin.tsx:3115`: `bootstrapLimits(pool, source, seedelf, privateMost, bootstrapBoxes, privateBack)`.

But nothing in the committed tests can see that wiring:

- **No committed test answers `lovejoin-bootstrap-most`.** A grep of `tests/` finds only another agent's scratch file.
- **e2e runs at 4,310 lovelace a byte.** The e2e fakes answer `epoch_params` from `seedelf-core/tests/fixtures/epoch_params.json` (4,310; `min_fee_a` 44; `min_fee_b` 155,381), and no e2e test changes them. At that price `back` is `"1500000"`, the same as the stand-in `BOOTSTRAP_BACK_LEAST`.

Mutations, in a copy outside the tree:

| Mutation | The six committed files that render `PoolPage` or call `bootstrapLimits`* | The seam test below |
|---|---|---|
| M1: line 3115 drops `privateBack` | **6 files, 121 tests pass** | fails (`expected false to be true`, the why note) |
| M2: the effect stops calling `setPrivateBack(back)` | not run (same effect as M1) | fails |
| M3: line 3115 drops `privateMost` (1.6.0's MONEY-6 wiring) | **6 files, 121 tests pass** | fails (no "at most 20") |

\* `lovejoin-held-balance`, `lovejoin-screens-review`, `lovejoin-release-rules`, `lovejoin-merged-screens`, `lovejoin-session5-screens`, `screens-wiring-review-fixes`.

PR #333's description says "If the form ignores `back`, the test fails". That holds for the helper (`lovejoin-release-rules.test.ts:503-506`), not for the page. Only the PR description says it; no doc in the tree repeats it.

### One premise needs correcting

The finding says "the screen tests render static markup, where the effect that sets privateBack never runs". That's true of most of the 76 screen tests, but not all of them. `tests/screens-wiring-review-fixes.test.ts` (1.6.0's R3-20) runs a named component's effects *during* `renderToStaticMarkup`:

- through `vi.mock("react")` (`seamEffect`, line 180);
- with `call` answering synchronously;
- and it already drives `PoolPage` (`seam.effects.add("PoolPage")` at lines 378, 391, 407, 438, 474 and 498).

Its header gives the reason: "the line that makes the screen use it had none, since Vitest has no DOM … with no new dependency". So nothing stopped this test from being written: no case in that file answers the Bootstrap bounds.

## Impact

### No user can reach it on the shipped build

HEAD's wiring is right. The scenario is a later edit, so what's at stake is the regression net, not a user.

### If the regression landed, nothing on screen changes at today's price

The test WebAssembly's `lovejoinBootstrapReserve`, scanned on the fixture row, gives:

| Price of a byte (lovelace) | `back` |
|---|---|
| 4,310 to 5,691 | 1.5 ₳, the stand-in |
| 5,692 | 1.6 ₳ |
| 6,465 | 1.8 ₳ |
| 8,000 | 2.3 ₳ |

So below 5,692, a rise of 32% over today's 4,310 that only a protocol-parameter change makes, intact and broken wiring render the same form, on mainnet and preprod alike.

### Above that price, the harm is small and bounded

- The form would pass a balance up to `back − 1.5 ₳` short of what the funding takes: 0.1 ₳ at 5,692, 0.3 ₳ at 6,465, 0.8 ₳ at 8,000.
- Pressing Bootstrap calls `lovejoin-mix-private-build` (line 2944).
- The worker's `mixOutBuild` refuses at build, in the screens' words, before `mixOutSubmit` records anything, and before anything is signed or sent. `act` puts the message in the page's error line (lines 2801-2813).
- So no money moves and no fee is paid. The worker's own priced funding is pinned: pr333's reviewer showed that `mixFunding` on a fixed 1.5 ₳ fails `lovejoin-flows`.

### At those prices the form is already off for another reason

pr333#0 found that the fixed 2 ₳ `FEE_ROOM` already under-counts by about 0.415 ₳ at 6,465. So this regression would only widen an existing band where the form passes and Review refuses; it wouldn't open a new one.

### Severity

- **Not medium.** The form's `short` is advisory: it is not the "critical guard" the medium row means. The worker, the builder and the ledger decide.
- **Low is right.** It's the brief's "a missing test on a minor path", plus a PR description that overstates its coverage.
- **Not refuted.** The missing test is real and proven by mutation.

## The fix

### The vehicle

**A client render is not available, and shouldn't be added.** Vitest runs with no DOM, and `package.json` has no jsdom, happy-dom or testing-library. Bringing one in would mean a new dev dependency the house seam was built to avoid.

**Put the test in `screens-wiring-review-fixes.test.ts` instead,** as a new `describe` on the existing seam. The case I wrote passes on HEAD 5/5 (both Vitest builds, about 70 ms) and fails under M1, M2 and M3:

- **Setup:**
  - pool: `{ box: { lovelace: "10000000" }, others: 0, free: 0, floor: 30, … }`, so the form leads and 30 boxes are needed;
  - the private side (the default);
  - `seam.effects.add("PoolPage")`, then `answer("lovejoin-bootstrap-most", { most, back })`.
- **Checks:**
  - It asks once, with `{}` (the classic pool).
  - `{ most: 96, back: "1500000" }` with 305 ₳: no `lovejoin-bootstrap-why`, and the button is enabled.
  - `{ most: 96, back: "1800000" }` with 305 ₳: the why note shows `lovejoin.bootstrap.cantAfford` (held 305 ₳), and the button is `disabled`.
  - `{ most: 96, back: "1800000" }` with 305.3 ₳: no why note.
  - `{ most: 20, back: "1500000" }`: the cost note contains `lovejoin.bootstrap.atMostPrivate` with 20, and the count field shows 20. This pins `privateMost`'s wiring too: it has had no test since 1.6.0's MONEY-6, and M3 survives every committed file.

### What else the fix touches

- **It's test-only.** No `src/` change, no strings, no critical keys, no guard, no privacy note, no e2e. It is within the owner's rules.
- **It doesn't depend on `PoolPage`'s state order.** It uses no seeds, so a state added to the page won't break it. Like every seam case, it does rely on the name `PoolPage` showing in the stack.
- **It hard-codes today's form arithmetic.** The thresholds 305 and 305.3 ₳ assume `FEE_ROOM` = 2 ₳. pr333#0's fix, if it's taken, replaces that room with a priced change least, which moves the thresholds. It would also add a field to the same `lovejoin-bootstrap-most` answer, read by the same effect. So:
  - best, land both in one PR, with this test pinning every field of the answer;
  - otherwise, write the balances relative to the stand-in's figure, not as literals.
- **An e2e at a dearer byte isn't worth it.** It needs a new knob in the e2e fakes and a stress run under load, for no more coverage than the seam case.

## Scratch

- **Record of both scratch tests** (deleted from the tree):
  - `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/review/v-pr333-1-impact/record/zz-review-v-pr333-1-impact-1.test.ts`: the seam's lines 13-294 verbatim, then the Bootstrap case.
  - `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/review/v-pr333-1-impact/record/zz-review-v-pr333-1-impact-2.test.ts`: the price scan.
- **The mutation copy** under the same folder is deleted. Its symlinks to `node_modules`, `seedelf-core` and `seedelf-crypto` were unlinked first, and the copied `.preprod-test-wallet.txt` was removed before any run.

## Not checked

- No e2e run.
- The pr333 reviewer's full 24-file, 471-test run under M1: I reran only the six files that touch the form.
