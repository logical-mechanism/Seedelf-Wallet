# v-pr335-3-trace: pr335#3, the e2e's checks after Next and the stale commit

**Verdict: confirmed.** **Severity: low** (the finding says nit).

The mechanism, the three assertion gaps and the scenario all hold on HEAD (`6bca8bec`). I reproduced the scenario with the real component in Playwright's Chromium.

The finding's one hedge is wrong. "In practice the queued render usually wins" does not hold. Chromium runs React's clearing render only after the next frame following the click. So the stale state is painted for one frame, and Playwright's checks land inside it often, not rarely.

What limits the harm: the worker-side lookup has its own deterministic Vitest test. What's left is a test that doesn't reliably guard item 7's path through the stepper, plus a one-frame cosmetic mismatch.

## The trace on HEAD

1. **Next only changes the index.** The handler is `onClick={() => setShown((i) => i + 1)}` (`src/ui/components/TxDetail.tsx:166`, and Previous at `:153`). The clear happens only inside the effect (`:129-141`): `setView(undefined); setError(undefined); call("tx-detail", { txHash: hash })`.
2. **React 19.3.0 is installed** (`node_modules/react-dom`, the e2e's production build).
   - A click is a SyncLane render. At the end of its commit, the passive effects are flushed synchronously: `0 !== (pendingEffectsLanes & 3) && flushPendingEffects();` (`react-dom-client.production.js:13204`).
   - Inside that flush, updates get Default priority: `ReactDOMSharedInternals.p = 32 > renderPriority ? 32 : renderPriority;` (`:13238`; dev build `:20069`).
   - A Default lane isn't in `& 3`. So `scheduleTaskForRootDuringMicrotask` hands it to the Scheduler (`:13524`), and in a browser the Scheduler posts a MessageChannel task.
3. **So one commit shows the new label over the old part.** It shows "Transaction 2 of 2" over part 1's body. Its id is `data-value={view?.detail.txHash ?? hash}` (`:181`), which is still part 1's, i.e. `first`.
4. **The e2e after Next** (`e2e/extension.spec.ts:2668-2672`):
   - `toHaveText("Transaction 2 of 2")` passes on that commit.
   - `toContainText("Pays")` can pass on it too.
   - `not.toHaveAttribute("data-value", first)` passes once the view is cleared, because the id is then `hash` from the parts list, whether part 2 is loading or failed. It never needs part 2's bytes.
   - Next is disabled from the first commit.
   - `withdraw-tx-error` `toHaveCount(0)` passes if part 2's answer hasn't arrived yet.
   - Previous then shows `first` at once (`hash` is `first`).

   Nothing after Next is tied to part 2's read.

## Repro: the real component in Chromium

**Setup** (a scratchpad harness, deleted after; nothing in the tree touched):
- Vite 8 bundled `TxDetailButton` from HEAD's `src/ui/components/TxDetail.tsx` with `styles.css`, as production React 19.3. It used `testId="withdraw-tx"` and two parts, whose views were two real preprod transactions decoded by the tree's WebAssembly.
- `chrome.runtime.connect` was stubbed to answer `tx-detail` after a set delay: part 1 always answers; part 2 answers in the healthy mode and fails in the scenario.
- Playwright 1.63 drove it with `chromium.launch({ channel: "chromium" })`, as the e2e does. Pages were fulfilled with `page.route`, so no network was used.
- It ran the e2e's own steps (`extension.spec.ts:2660-2674`), with only the "Pays"-after-Next timeout cut to 1.5 s. A MutationObserver plus `requestAnimationFrame` timeline ran in the page.

**Scenario: HEAD, part 2's read fails.** Each cell is "Pays passed on part 1's body" / "the whole sequence passed, regression unseen":

| failing reply after | batch A (heavier load) | batch B (load ≈ 1.2) |
|---|---|---|
| 10 ms | 11/40 / **0/40** | — |
| 30 ms | 4/25 / **3/25** | 6/25 / **6/25** |
| 60 ms | 22/25 / **22/25** | 1/25 / **1/25** |
| 120 ms | 24/25 / **24/25** | — |
| 250 ms | 25/25 / **25/25** | 12/25 / **12/25** |

- **Probe:** two raw `page.evaluate`s straight after Next both saw the stale commit in 40/40 runs (batch A) and in 7/25 and 4/25 runs (batch B).
- **Healthy (part 2 answers):** 5/5 and 10/10 passed.
- **Window length:** 2.8 to 14.2 ms from the stale commit to the clearing commit.
- **The stale state is painted.** An animation frame runs inside the window: stale 115.4 ms → rAF 116.4 → clear 119.7; stale 141.3 → rAF 142.2 → clear 146.0.
- **A false "Pays" pass, traced** (10 ms reply): stale commit 236.5 ms; `click()` resolved 238.4; "2 of 2" passed 239.7; "Pays" passed 241.1; clearing commit 248.2.

**Reading it:**
- Whether the test passes is a race. On one side: the click's resolution plus two checks, about 1.5 to 2 ms each. On the other: a clear that waits for the next frame.
- Whether the regression then slips through depends on whether part 2's error arrives before `toHaveCount(0)`.
- The real worker's failing read is slower than 10 ms. It reads the chain keys, every `BUILT_KEYS` entry (each an encrypted session read) and `inChain`, all before `NOT_HELD` (`tx-view.ts:134-177`).
- The real page is heavier than the harness, so its window is no shorter.
- PR #335 says "The e2e step found this". That is consistent with these numbers, but a rerun can pass.

## What limits it

- **The worker-side lookup is caught deterministically elsewhere.** `tests/parts-send-review-fixes.test.ts:1337-1358` calls `txView` for every part of a transfer in parts. `keepParts` keeps part *i* under `partKey(key, i)`, and only part 1's record (with `partHashes` strings) sits under the base key (`script-spend.ts:562-565`). So `cborOf` can't find part 2 without the lookup, and the test fails. The PR says the same.
- **Withdraw shares that storage:** `keepParts` at `withdraw.ts:144`, as in `transfer.ts:158`.
- **What only the e2e covers is stepping through the worker.** `tx-view-screen.test.ts` renders with `renderToStaticMarkup`, which runs no effects.
  - Some regressions still fail the e2e every time:
    - `parts` not passed (no stepper).
    - The effect left on `[txHash]`: the id stays `first`, so `not.toHaveAttribute` fails.
  - One whose part-2 read errors passes the e2e at the rates above. Examples: the modal asking the wrong hash, or a later part's route failing.
- **No money or privacy effect.** The stale frame's id and body agree with each other (both part 1's). Only the label is one frame ahead.

## Fixes, both checked in the harness (scenario, part 2 failing)

- **Component (preferred; it also removes the painted frame).** Clear in the stepper's handlers, in the same discrete batch as the index:
  `onClick={() => { setView(undefined); setError(undefined); setShown((i) => i + 1); }}`, and the same for Previous.
  - With the e2e's steps unchanged: 0/25 at 60 ms and 0/25 at 250 ms.
  - No stale commit was ever recorded (probe 0/25), and healthy passed 10/10.
  - The finding's version, rendering the body only when `view.detail.txHash === hash`, compares the decoder's hash with the review summary's. If those ever differed in form, the modal would show neither "Reading it…" nor the body, since `!view` is false. Clearing in the handler, or storing the view with the hash it was asked for, avoids that.
- **Test.** After `not.toHaveAttribute("data-value", first)`, wait for `withdraw-tx-loading` to have count 0, then check the error.
  - 0/25 at 60 ms and at 250 ms; healthy passed 10/10.
  - It must come after the id check, as the finding says. Straight after "2 of 2" it would also pass on the stale commit, where the view is still set.
  - Put the "Pays" check after it too, so "Pays" is part 2's.

## Scratch

- `extension/tests/zz-review-v-pr335-3-trace-1.test.ts` decoded the two fixture transactions and was deleted.
- The harness lived in my scratchpad folder: the entry, the Vite build and the Playwright driver, plus a `src` copy for the component fix. All of it was deleted.
- Nothing in the tree was edited. `dist/`, `wasm/pkg` and `node_modules/.vite` were untouched.
