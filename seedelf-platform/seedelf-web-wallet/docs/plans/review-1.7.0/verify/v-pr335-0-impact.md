# v-pr335-0-impact: the stepper's index outlives a review rebuilt in place

**Verdict: confirmed. Severity: low** (as filed). **The fix is right as a whole, but its clamp half is incomplete:** the arrows must step from the clamped index. The key alone is the minimal fix.

## Is it reachable in the shipped build?

Yes, through one narrow sequence. I checked every link on HEAD (`6bca8bec`).

1. **A rebuild can only start before the view opens.** `Modal.tsx:30` opens the view with `dialog.showModal()`, so the page behind it is inert. In the harness below, a press on the foot's button behind the open view timed out, and none reached it. Every rebuild of a review with `parts` comes from a press on that page:
   - Refresh and review again: Withdraw `:206` and Transfer, through `againOrForm`.
   - A swap's switch or Change (`Swaps.tsx:928-929` → `rebuild` `:832`), and its Build again (`:862`).
   - Lovejoin's Build again (`:2978`) and its width switch (`againAt` `:2911`, `AgainSwitch` `:3067`). The finding didn't list the width switch.
   - A site's Build again (`DappApprovals.tsx:719` → `buildReview` `:654`).
   - Nothing rebuilds on a timer.
2. **The chip stays live while the rebuild runs.** `TxDetailButton` (`TxDetail.tsx:72`) has no `disabled`, and `Screen` (`:144-147`) neither disables nor inerts its body. Each screen keeps the old review mounted until the new one lands: `Withdraw.tsx:129` `setSummary(await call("withdraw-build", …))`, `Transfer.tsx:141`, `Swaps.tsx:824`, `Lovejoin.tsx:2882/2984`, `DappApprovals.tsx:659`.
3. **The old view still works mid-rebuild.** `withdraw.ts:144` runs `keepParts` only after `readContract` (`:91`) and `measureLocally` (`:106-116`), so the worker still holds the old parts. The `BuildStage` foot shows the rebuild's seconds.
4. **The view outlives the rebuild.** `TxDetailButton` stays at the same position in the tree, so React keeps its `open` state. `TxDetailModal` has no key (`:77-79`), so `shown` (`:126`) survives into the new props.
5. **The part count has to shrink, to two or more.** That happens when the private balance's UTxOs or the amount change between builds. A stale refusal after something it spent went elsewhere does it, and so do a swap's switch or Change and Lovejoin's width. Three or more parts is realistic for a balance of many small returns: up to 25 parts are designed for.

## Repro (real Chromium, React 19.3.0, the real component)

The harness was a scratch copy outside the tree. It bundled the real `TxDetailButton` with Vite (iife), with `call` stubbed to record what's asked and never answer. Playwright's headless Chromium drove it with no network. The steps: open a 3-part review, step to "3 of 3", press the foot behind the view, land a rebuilt 2-part review under the open view, press Next ×2 and Previous ×3, then Escape and reopen.

| Variant | After the rebuild lands | Then |
|---|---|---|
| HEAD | **"Transaction 3 of 2"**, Previous and Next both on, shows the new first (d4) | Next → **"4 of 2"**, **"5 of 2"** (no new reads); Previous ×3 → "2 of 2" (e5); Escape and reopen → "1 of 2" |
| clamp as proposed (arrows still `setShown((i) => i ± 1)`) | "2 of 2" (e5), Next off | **The first Previous press does nothing** (index 2 → 1, clamped 1 → 1); the second → "1 of 2" |
| clamp + `key={txHash}` (the full proposal) | "1 of 2" (d4). The dialog stays open (one dialog, `:modal`) and focus goes to Close | Stepping is right; no dead press |
| `key={txHash}` alone | the same as clamp + key | the same |
| clamp, arrows `setShown(at ± 1)` | "2 of 2" (e5), Next off | Previous → "1 of 2" at once |

Foot behind the open view: "not pressable: Timeout 800ms exceeded; presses reached it: 0".

The scratch Vitest SSR test, `tests/zz-review-v-pr335-0-impact-1.test.ts` (the finding's proposed test as written, run alone on HEAD, since deleted), passed. It rendered `<output class="stepper__value" data-testid="tx-part">Transaction 3 of 2</output>` with neither arrow disabled and `data-value` the first hash. Its `useState(0)` mock caught 4 calls: the index, plus three `useT` redraw counters whose value is ignored (`i18n/index.tsx:22`). The same test against the copy's variants:
- **fails** on HEAD and on key-only;
- **passes** with either clamp, so it can't see the dead press.

## Impact

- The label is self-evidently impossible ("3 of 2"), and Next runs on without bound.
- What's shown is a real transaction of the new review, the first, with its own hash correct. So it's a wrong index over true content, not a false money statement.
- Send sits behind the view and sends `summary.txHash`'s parts as before. No money or privacy is affected.
- There are ways out: Previous comes back into range, and closing and reopening the view starts at "1 of N".
- That is an edge case and a small UX defect, which is **low** on the brief's scale. It isn't medium: nothing is stuck, and nothing misstates money or privacy.

## The fix

- **The full proposal (clamp + key) works.** The harness showed no dead press, and the view stays open, restarting at "1 of N".
- **The clamp half, alone, is incomplete.** It keeps the arrows' `setShown((i) => i ± 1)` on the raw index, so after a shrink one Previous press does nothing. If the clamp ships, step from it: `onClick={() => setShown(at - 1)}` and `onClick={() => setShown(at + 1)}`.
- **The minimal fix is the key alone:** one line in `TxDetailButton`, `<TxDetailModal key={txHash} …/>`.
  - Every rebuild gives the first part a new hash, because each part is built under a fresh one-time key. In wasm, `build_withdraw` has `lib.rs:3554` `let seed = new_seed();` (OsRng) and `:3558` `let signer = key_hash(&one_time_key(&sk, &seed));`, and `build_transfer` draws its own at `:3159`. The signer goes into the body through `ScriptSpend::new(…, signer)` → `disclosed_signer(self.signer)` (core `build.rs:2193`). So an open view always restarts at the new review's first.
  - It re-mounts the dialog. Focus moves to Close, and the tab and scroll reset, which suits a different transaction.
  - The old dialog's queued `close` event doesn't close the new one: React 19.3 detaches the deleted instance.
- **The owner's rules are kept.** There's no new guard or refusal, no text, no i18n key, and no privacy note touched.
- **Nothing in range changes:**
  - Inside the range, `at === shown`, and `>=` behaves as `===`.
  - With no parts, `at = 0` and the view falls back to `txHash` as before.
  - The e2e "withdraw: more UTxOs than one transaction spends" stepping, and both tests in `tx-view-screen.test.ts`, behave the same.
- **On the proposed test:**
  - It pins the clamp's label and disabled state. It fails today and passes with the clamp.
  - It can't see the arrows' step: there's no DOM in the node test environment.
  - It says nothing about the key, because it renders `TxDetailModal` directly.
  - Its mock intercepts every `useState(0)` in the render: three `useT` counters today, harmless but brittle.
  - So it's fine for the clamp variant with arrows from `at`. A key-only fix has no cheap node test; an e2e would need fakes that rebuild into fewer parts.

## Aside (separate from this finding; nit)

On HEAD, stepping by keyboard onto the last part disables Next while it has focus, and focus falls to `<body>`. The harness, keyboard only: "Enter twice (last): BODY | Transaction 3 of 3", and a Tab then lands on "Copy the transaction's id". The same happens at the first part with Previous. A keyboard user loses their place at each end of the stepper. Escape still closes the view.

All scratch files are deleted: the tree's scratch test, and the scratchpad copy with its harness.
