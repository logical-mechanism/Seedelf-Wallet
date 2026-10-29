# v-pr335-0-trace: pr335#0, the stepper's index outlives a review rebuilt in place

**Verdict: confirmed. Severity: low.** It's real, as described, on HEAD `6bca8bec`. One correction to the fix: a clamp alone, with the handlers left on `i ± 1`, makes the first Previous press after a clamp do nothing. Details under *Fix advice*.

## The trace on HEAD

1. **The stepper's index is TxDetailModal's own state, and nothing clamps or resets it.**
   - `TxDetail.tsx:125` `const many = parts && parts.length > 1 ? parts : undefined;`
   - `:126` `const [shown, setShown] = useState(0);`
   - `:127` `const hash = many?.[shown] ?? txHash;`
   - `:159` `{tr("tx.partOf", { n: shown + 1, total: many.length })}`
   - Previous is `:152` `disabled={shown === 0}` and Next is `:165` `disabled={shown === many.length - 1}`, an exact equality.
2. **The view lives in TxDetailButton's own state, with no key.** `:68` `const [open, setOpen] = useState(false);`, and `:77-78` `{open && (<TxDetailModal txHash={txHash} parts={parts?.map((p) => p.txHash)} … />)}`. Only the chip and `onClose` change `open`.
3. **A stale Send leaves the review on screen, and so does its rebuild.**
   - The worker's `StaleReviewError` and `CollateralRefusedError` cross the port as `code: "stale"` (`ui-port.ts:13`). `Withdraw.tsx:145` `if (isStale(err)) stale.refused(err)` then puts the review on its stale foot.
   - The foot's button runs `againOrForm(ready, build, toForm)` (`:206`, `StaleReview.tsx:111`). `build()` (`Withdraw.tsx:118-136`) sets `busy` and keeps `summary` until `:129` `setSummary(await call("withdraw-build", { payments }))`.
   - Meanwhile the chip (`:223`) is live: TxDetailButton's `<button>` (`TxDetail.tsx:72`) has no `disabled`.
4. **The chip keeps its place in the tree.** In the review it's always the second child of `<Screen>`, after `<ReviewRecipients>` (`Withdraw.tsx:217-223`). Screen renders `{children}` at a fixed place in `.screen__body` (`Screen.tsx:146`), and the review is always a `<section>`. So React keeps the same TxDetailButton and TxDetailModal, with `open` and `shown`, across `setSummary`.
5. **The worker holds the old parts until the new build keeps its own.**
   - No stale path drops a kept record: `refuseSent` (`pending.ts:959`) only throws, and `send` (`script-spend.ts:377-446`) throws without removing anything.
   - `withdraw-build` clears nothing when it starts (`withdraw.ts:82-91`).
   - `keepParts` (`withdraw.ts:144`, `script-spend.ts:562`) overwrites the records only at the end.
6. **The other paths the finding names are the same shape.**
   - Each keeps its review mounted while it rebuilds, and its chip passes `parts` with no `disabled`:
     - Swaps' `rebuild()` and `buildAgain()`: `Swaps.tsx:834-866`, chip at `:935`.
     - Lovejoin's `buildAgain`: `Lovejoin.tsx:2978-2994`, chip at `:3075`.
     - The site funding's `buildReview`: `DappApprovals.tsx:653-670`, chip at `:772`.
     - Transfer's stale foot: `Transfer.tsx:132-150`, chip at `:236`.
   - Lovejoin's width switch (`againAt`, `:2911`) also rebuilds in place. I didn't trace whether its review comes in parts.

A payment in parts can be refused as stale at Send in several ways:
- `TOO_OLD` (`script-spend.ts:395`)
- `laterParts`'s `NOT_READY` (`:582`)
- `refuseSpentSince` (`:614`)
- `refuseReserved` (`:639`)
- giveme.my

A rebuild "from the chain as it is" can need fewer parts. For example, a Max with fewer UTxOs once some were spent elsewhere, or a fixed amount that a larger UTxO that has since arrived now covers in fewer parts.

## The scratch test that decided it

`extension/tests/zz-review-v-pr335-0-trace-1.test.ts` (run alone, then deleted):
- **What it rendered:** the real TxDetailButton, through `react-dom/client` over a minimal fake DOM, inside a review shaped like Withdraw's (the summary in React state, the chip second). It didn't mock `useState`; it stubbed only `call`, recording which hashes the view asked for.
- **What it did:** open the view, press Next twice, then `setSummary` with a new review in 2 parts.

Results:

- **3 parts to 2 (failed on HEAD, as the finding predicts).**
  - Before the rebuild: "Transaction 3 of 3", Next off, the id the old third's (`c3…`).
  - After it: the view still open, **"Transaction 3 of 2"**, Previous and Next both enabled, and `data-value` the **new first's** (`d4…`), which is what the view then asked the worker for (asked: `a1,b2,c3,d4`).
  - One more Next: **"Transaction 4 of 2"**, both still enabled, still `d4…`.
  - The assertion `n <= m` failed: "expected 3 to be less than or equal to 2".
- **3 parts to 3 (control, passed):** "Transaction 3 of 3" over the new review's own third, with Next off.

## How narrow it is

It needs all three of these:
1. The user opens Transaction details during the few seconds a rebuild runs: Refresh and review again, Build again, or a swap's switch or Change. The modal blocks the page, so a rebuild can't start while the view is open.
2. They step past the count the new build will have.
3. The new build has fewer parts, but more than one.

The way out is there: one Previous gives "2 of 2" over the new second part, and Close works. No money is at risk:
- Send sends `summary.txHash` (`Withdraw.tsx:143`) and never reads the view.
- The `<dialog>` is opened with `showModal()` (`Modal.tsx:30`), so Send can't be pressed while it's open.

That's a low-severity UX defect, as the finding says.

## Fix advice

I ran each variant in a copy outside the tree, with the same flow plus one Previous press after the rebuild:

| Variant | After the rebuild | After one Previous |
|---|---|---|
| HEAD | "3 of 2" over the first, both live | "2 of 2" over the second |
| A: the finding's fix (clamp + `key={txHash}`) | "1 of 2" over the first, Previous off | (off) |
| B: the clamp alone, handlers `setShown((i) => i ± 1)` | "2 of 2" over the second, Next off | **still "2 of 2": a dead press** |
| C: the clamp, handlers `setShown(at - 1)` / `setShown(at + 1)` | "2 of 2" over the second | "1 of 2" over the first |
| D: `key` by every part's hash, no clamp | "1 of 2" over the first | (off) |

- **The fix as proposed (A) works** for every TxDetailButton.
- **If the clamp stays, step from the clamped index.** Make both handlers use `setShown(at - 1)` and `setShown(at + 1)`, not `(i) => i ± 1`. Otherwise `shown` stays past the end while `at` shows the last, and the first Previous press only moves `shown` back to `at` (variant B).
- **Key by the whole list, not the first hash.** Keying the modal by every part's hash (`[txHash, ...parts].join()`) covers a list that changes while its first hash doesn't. `key={txHash}` relies on a rebuild always changing the first hash. It does in practice: a new one-time key, or a new session account, per build.
- **The test the finding proposes,** with `useState` mocked to 2, checks only the clamp. A test like the one above, a real render with a review rebuilt under an open view, checks the reset too. Mock `call`, and either keep a fake DOM in a helper or add a DOM library to the devDependencies.

Scratch files: the test above and the copy under the scratchpad's `review/v-pr335-0-trace/` are deleted. No tracked file was touched.
