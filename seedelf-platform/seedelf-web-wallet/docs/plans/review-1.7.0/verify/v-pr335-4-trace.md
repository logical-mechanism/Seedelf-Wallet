# v-pr335-4-trace: pr335#4, focus drops to `<body>` when an arrow disables itself at an end

**Verdict: confirmed.** **Severity: low** (the finder said nit, which is defensible). A small keyboard and assistive-tech defect with no dead end. It doesn't block the release.

## What HEAD does (6bca8bec)

- `TxDetail.tsx:152`: `disabled={shown === 0}`, with `onClick={() => setShown((i) => i - 1)}` (:153).
- `TxDetail.tsx:165`: `disabled={shown === many.length - 1}`, with `onClick={() => setShown((i) => i + 1)}` (:166).
- The arrow pressed onto an end therefore gets the native `disabled` attribute while it holds focus.
- Nothing puts focus back:
  - `Modal.tsx:28-32` only calls `dialog.showModal()`.
  - The one `.focus()` in the view's components is `Tabs.tsx:41`, and it runs only on ArrowLeft or ArrowRight inside the tablist.
  - The UI has no app-level focus recovery. A grep for focusout, focusin, blur, focus, activeElement, onBlur and onFocus in `src/ui` finds only an input's caret, a touched flag, PhraseInput's own state, and LockCountdown's `window` focus.
- It's reachable from every review in parts that passes `parts`:
  - Withdraw.tsx:223
  - Transfer.tsx:236
  - Swaps.tsx:935
  - Lovejoin.tsx:3075
  - DappApprovals.tsx:772
- The finding's side claims hold:
  - The aria-labels are at :151 and :164.
  - The SVGs carry `aria-hidden="true"` (Icons.tsx:16).
  - Chromium exposes the `<output>` as `status`, live=polite, atomic=true (accessibility tree below).
- The box stepper does the same thing: `Lovejoin.tsx:3232` `disabled={boxes <= 1}` and `:3238` `disabled={boxes >= most}`.
  - That pattern dates from chunk 16 (`7db81171`), and those lines were last touched in `0affa5b4`, which shipped in 1.6.0.
  - So PR #335 copied an existing house pattern. It didn't introduce a new kind of defect.
- No test exercises focus:
  - `tests/tx-view-screen.test.ts` renders static markup only and checks `/aria-label="Previous transaction" disabled=""/`.
  - The e2e withdraw test (extension.spec.ts, the block PR #335 added) uses `.click()` and `toBeDisabled()`.

## Repro: the real component, in real Chromium

The harness was built with Vite and `@vitejs/plugin-react` in my scratch folder, outside the tree.

- It renders HEAD's own `TxDetailButton` → `TxDetailModal` → `Modal`, with HEAD's `styles.css`, as Withdraw does.
- `chrome.runtime.connect` was stubbed to answer `tx-detail` after 50 ms.
- Playwright 1.63, Chromium 153.0.8010.12. The build was served through `page.route` only, with no network.
- I opened the chip with Enter and then used the keyboard only.

| Step (2 parts) | focus right after | after 400 ms | stepper |
|---|---|---|---|
| opened with Enter | Close | | 1 of 2 |
| Tab | Next | Next | 1 of 2 |
| Enter on Next | **BODY** | **BODY** | 2 of 2 |
| Enter again | BODY | BODY | 2 of 2 (no-op) |
| Space | BODY | BODY | 2 of 2 (no-op) |
| Shift+Tab | Previous | Previous | 2 of 2 |
| Enter on Previous | **BODY** | **BODY** | 1 of 2 |
| Tab | Next | Next | 1 of 2 |
| Escape | | | dialog closed |

- **With 3 parts:** Enter at 1 of 3 keeps focus on Next (2 of 3). Only the step onto an end, 3 of 3 or back to 1 of 3, drops it.
- **Accessibility tree (CDP):**
  - Before: focused = `button "Next transaction"`.
  - After Enter: focused = only `RootWebArea`. A screen reader is moved to the document itself.
  - The `<output>` is a polite status, so "Transaction 2 of 2" is still announced.
- **Recovery takes one key.** Chromium keeps the sequential-navigation starting point, so Shift+Tab lands on Previous and Tab on the next control.

## Fix (owner's call; tested in mutated copies of `src`, outside the tree)

- **A. `aria-disabled` (works):**
  - Change: `aria-disabled={shown === 0}` with `onClick={() => setShown((i) => Math.max(0, i - 1))}`, and the same with `Math.min` for Next.
  - Result: focus stays on the arrow, now `aria-disabled`, at both ends. Extra Enters are no-ops, and the opacity is still 0.45.
  - Cost: the arrow at an end stays in the tab order, so reaching Next at 1 of 2 takes 2 Tabs instead of 1.
  - CSS it needs, since nothing in the UI uses `aria-disabled` yet:
    - `.icon-button[aria-disabled="true"]` beside `.icon-button:disabled` (styles.css:245).
    - `button[aria-disabled="true"]` beside `button:disabled { cursor: default }` (:145).
    - `:not([aria-disabled="true"])` added to `.icon-button:not(:disabled):hover` (:240).
  - Tests: Playwright's `isDisabled()` counts `aria-disabled="true"` (checked: true at each end), so the e2e's `toBeDisabled()` checks hold. Only the unit test's `disabled=""` regex needs to become `aria-disabled="true"`.
- **B. Move focus to the other arrow (works, but worse):**
  - Change: `flushSync(() => setShown(to))`, then `.focus()` on the other arrow.
  - Result: focus doesn't drop, but a second Enter goes straight back: with 2 parts, Enter, Enter goes 1 → 2 → 1. A user who presses once too often lands one part off.
- **Recommendation:** A. If the owner wants consistency, apply it to Lovejoin's box stepper too. That stepper's behaviour is from chunk 16, not this release.

## Safety

- The only file I wrote in the tree is this report.
- The harness, the two mutated copies and the drivers lived in `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/review/v-pr335-4-trace/` and were deleted before returning.
- Nothing touched a network.
