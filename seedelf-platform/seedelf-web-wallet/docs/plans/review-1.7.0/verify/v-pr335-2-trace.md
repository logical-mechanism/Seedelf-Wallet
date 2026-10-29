# v-pr335-2-trace: pr335#2, only Make public's stepper is tested

**Verdict: confirmed. Severity: low.**

I tried to refute it five ways:

1. A Vitest test renders one of the four reviews and would notice the missing prop. The seam harness in `screens-wiring-review-fixes.test.ts` does render `NewSwap`'s approval, `PoolPage` and `ConnectRequest`'s funding review for real.
2. A source scan reads the screens and would catch it.
3. `tsc` refuses a review in parts that doesn't pass them.
4. An e2e test reaches one of the four reviews in parts.
5. The four reviews never carry `parts`, so the scenario can't happen.

None of these holds. With all five `parts={…}` props dropped in a copy, every affected Vitest file and `tsc` still pass. Only the e2e's Make public test (not run, per the brief) would notice, and only for Withdraw.

## The path, on HEAD (`6bca8bec`)

**The five wirings** are one line each:

- `Transfer.tsx:236`: `<TxDetailButton txHash={summary.txHash} parts={summary.parts} testId="transfer-tx" />`
- `Withdraw.tsx:223`: `<TxDetailButton txHash={summary.txHash} parts={summary.parts} testId="withdraw-tx" />`
- `Swaps.tsx:935`: `<TxDetailButton txHash={out.summary.txHash} parts={out.summary.parts} testId="swap-out-tx" />`
- `Lovejoin.tsx:3075`: `<TxDetailButton txHash={review.summary.txHash} parts={review.summary.parts} testId="lovejoin-tx" />`
- `DappApprovals.tsx:772`: `<TxDetailButton txHash={review.txHash} parts={review.parts} testId="dapp-funding-tx" />`

**Without the prop, there's no stepper.**

- `parts` is optional on the button (`TxDetail.tsx:61`, `parts?: ReadonlyArray<{ txHash: string }>`), which passes `parts?.map((p) => p.txHash)` to the modal (`:78`).
- The modal's stepper needs `const many = parts && parts.length > 1 ? parts : undefined;` (`:125`). With no `parts`, the view shows `txHash` alone, the first transaction's. That is the 321-parts-worker#5 gap, as the scenario says.

**All four reviews can carry parts**, and the worker serves every part, so each screen's prop alone decides whether its stepper shows.

- **The types:**
  - `TransferSummary.parts` (`rpc.ts:776`) and `WithdrawSummary.parts` (`:831`).
  - `SessionOutSummary extends WithdrawSummary` (`:1944`). It is the swap's `out.summary` (`Swaps.tsx:692`), a site's funding `review` (`DappApprovals.tsx:540`), and Lovejoin's `PrivateSummary = SessionOutSummary & { mix }` (`Lovejoin.tsx:150`).
- **The builds:**
  - Session fundings are built in parts at `sessions.ts:2946`: `summary: parts.length > 1 ? { ...summary, parts: reviewParts(parts) } : summary`.
  - They are kept per part by `keepFunding` for `SESSION_OUT` (`:1911`), `SESSION_SITE_OUT` (`:1958`) and `SESSION_MIX_OUT` (`:2134`).
  - A private mix goes in parts when it's new (`{ inParts: !mix.again && !mix.bootstrap }`, `:2120`).
- **The view:** `tx-view.ts`'s `BUILT_KEYS` (`:83-100`) holds all five keys, and the lookup follows `partHashes` to `partKey(key, part)` (`:158-162`).

## What tests there are

- `grep` over `tests/` and `e2e/` (recursive, `e2e/live/` included) for `tx-part`, `Next transaction`, `Previous transaction`, `Transaction 1 of`, and the ids `transfer-tx*`, `swap-out-tx*`, `lovejoin-tx*` and `dapp-funding-tx*` finds only two places:
  - `tests/tx-view-screen.test.ts:613-642`, which renders `TxDetailModal` directly (`:620`) with string hashes;
  - `e2e/extension.spec.ts:2660-2674`, which covers `withdraw-tx-*` only.
- The seam harness renders three of the four screens, but it only names `TxDetailButton` to stub it (`screens-wiring-review-fixes.test.ts:645`, in the Session and SiteSession return test). No test reads the button's props or seeds it open.
- E2e reaches no review in parts except Make public's: `withdraw-parts` (`:2655`) is the only `*-parts` id there.

## Repro: a mutation check in a copy (then deleted)

**The copy** was at `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/review/v-pr335-2-trace/`, made as the brief says.

- It also needed `seedelf-platform/seedelf-core/tests/fixtures/` and `seedelf-crypto/tests/vectors/` at their relative places. `tests/fakes.ts:294` and others read `../../../seedelf-core/...`.
- **Note for other mutation checks:** without those, 31 test files fail at import with `ENOENT`. That can pass for a mutation being "caught".

**The mutation:** `parts={…}` removed from all five lines above.

**The run** covered 70 files, Vitest 5.0.3, default build:

- 53 files reach any of the five screens through relative imports: static, `await import(...)` and `vi.mock`. Among them are `screens-wiring-review-fixes`, `screens`, `swap-page`, `dapp-prompt`, `lovejoin-screens-review`, `max-left-review-fixes` and `approvals-review-fixes`.
- The other 17 are tests that read screen sources as text. Among them are `tx-view-screen`, `parts-send-review-fixes`, `i18n-screens` and the critical-helper scans.

| Check on the mutated copy | Result |
|---|---|
| 70 affected Vitest files, default build | **70 passed, 1125 tests, 0 failed** |
| 10 screen-level files, `VITE_ENABLE_MAINNET=false` | **10 passed, 270 tests** |
| `tsc --noEmit -p .` | **exit 0** |

## The fix works: two guards, run on HEAD and on the mutation (both deleted)

| Scratch test | HEAD (in tree, run alone) | Mutated copy |
|---|---|---|
| `zz-review-v-pr335-2-trace-1`, a source guard: on each screen, the line with `<TxDetailButton`, `txHash={S.txHash}` and `testId="<id>"` must contain `parts={S.parts}` | 5 passed | **5 failed**, each naming its screen |
| `zz-review-v-pr335-2-trace-2`, the house's seam: a copy of `screens-wiring-review-fixes.test.ts` plus one block. It seeds the swap's `out` and a site's funding `review` with two parts, and reads the button's props with `on((name, props) => name === "TxDetailButton" && props.testId === …)` | 2 passed | **2 failed**: `expected undefined to deeply equal [ { …(3) }, { …(4) } ]` |

## Where the claim is looser than the code (none changes the verdict)

- **Rendered, but not asserted.** The finding says no test goes "through TxDetailButton or a screen". The seam harness already renders `NewSwap`'s approval, `PoolPage` and `ConnectRequest`'s funding from seeds. The gap is in what's asserted, not what's rendered, so the fix is cheaper than the finding implies.
- **E2e is no one-step fix.** "An e2e step on Send privately in parts" isn't a step. E2e builds no review in parts there, so it needs a new test with its own many-UTxO setup, as Make public's adds 40 UTxOs at `:2644`.
- **The button's own mapping.** `parts?.map((p) => p.txHash)` (`TxDetail.tsx:78`) has no unit test either. Only Make public's e2e covers it.
- **No defect on HEAD.** All five screens are wired right today. This is a regression guard on a minor path, so it stays low.

## Fix advice

1. **House style, cheapest.** In `screens-wiring-review-fixes.test.ts`, seed a two-part summary into the reviews it already renders: the swap approval, `PoolPage`'s private review and `ConnectRequest`'s funding. Assert the button's `parts` equal the summary's, with the `on(...)` matcher above. Transfer and Withdraw need a seeded review render of their own, or the source guard.
2. **Source guard.** Pin `txHash={S.txHash} parts={S.parts}` per screen, as the scratch test did.
   - It catches a drop, and an array taken from another object.
   - It breaks on a multi-line reformat, loudly, and doesn't cover a new review in parts.
3. **An owner's call: make the class impossible.** `TxDetailButton` could take the summary, for example `of={summary}` typed `{ txHash: string; parts?: ReadonlyArray<{ txHash: string }> }`, instead of two props.
   - Then a screen can't forget or mismatch the parts, and `tsc` guards it.
   - Lovejoin's public branch keeps `txHash={review.summary.entry}`.
   - It touches five call sites and the component.

## Clean-up

My two in-tree scratch tests are deleted. The copy and its tools folder under the scratchpad are deleted too. No tracked file was touched.
