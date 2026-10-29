# v-pr335-2-impact: only Make public's stepper wiring is tested

**Finding:** `pr335#2` (pr335's report, finding 3). **Role:** impact and the fix. **Tree:** HEAD `6bca8bec`.

**Verdict: confirmed. Severity: low.** This is a missing test on a minor path. It doesn't block the release: HEAD wires all five reviews correctly.

**Fix: right aim, wrong vehicle.** Add the wiring test to the house seam in `tests/screens-wiring-review-fixes.test.ts`, not as a source scan or an e2e step. The finding's own test would miss its own "passes the wrong array" scenario.

## What I checked

### The gap is real

HEAD passes `parts` on all five reviews:

- `Transfer.tsx:236`
- `Withdraw.tsx:223`
- `Swaps.tsx:935`, in `NewSwap`
- `Lovejoin.tsx:3075`, in `PoolPage`
- `DappApprovals.tsx:772`, in `ConnectRequest`

But nothing except Withdraw's e2e can see any of these lines:

- **The prop is optional.** `TxDetail.tsx:61` declares `parts?: ReadonlyArray<{ txHash: string }>`, so dropping it type-checks.
- **The modal is never rendered statically.** `TxDetailButton` renders the modal only once it's open (`TxDetail.tsx:77-78`). A static render of a screen therefore never shows where `parts` goes.
- **No test captures the button's props.** The only seam test that names `TxDetailButton` stubs it (`screens-wiring-review-fixes.test.ts:645`).
- **The stepper's own test bypasses the screens.** `tx-view-screen.test.ts:613-641` renders `TxDetailModal` directly.
- **The e2e opens Withdraw's details only.** A grep of `e2e/` for `transfer-tx`, `swap-out-tx`, `lovejoin-tx` and `dapp-funding-tx` finds nothing. The only review in parts any e2e reaches is Make public's (`extension.spec.ts:2654-2675`).

### Mutations

All ran in a copy outside the tree, with the scratch test described under *The fix*.

| Mutation | Committed tests | `tsc` | Scratch seam test |
|---|---|---|---|
| **M1:** `parts={…}` dropped from Transfer, Swaps, Lovejoin and DappApprovals | **78 files, 1,205 tests pass.** That's every test file that imports, reads or names a screen or `TxDetail`, the PR's two tests included. | 0 errors outside the scratch file | fails 4 of 4. Withdraw, which is untouched, passes. |
| **M2:** M1, plus Withdraw's prop dropped, plus the swap given the wrong array (`parts={out.summary.parts?.slice(0, 1)}`) | not rerun; nothing new can see it | 0 errors outside the scratch file | fails 5 of 5 |

On HEAD the scratch test passes 5 of 5, in about 0.8 s.

So the claim holds exactly as stated: any of the four could be dropped, or handed another array, and every Vitest test and `tsc` would stay green.

## Impact

**No user reaches it on the shipped build.** HEAD is right. The scenario is a later edit, so what's at stake is the regression net, not a user.

**If such a regression landed, the flow is reachable on the store build.** Each of the four reviews really does go in parts:

- **A swap's funding:** `outBuild` calls `buildFunding` with the default `inParts = true` (`sessions.ts:1834`, `:2893`).
- **A site's funding:** `siteOutBuild`, the same default (`:1940`).
- **Lovejoin's private mix:** `mixFunding` uses `{ inParts: !mix.again && !mix.bootstrap }` (`:2120`).
- **Send privately:** `transfer.ts` builds in parts.

**What the regression would cost.** A payment in parts would again open only its first transaction's details. That is 1.6.0's shipped behaviour, the 321-parts-worker#5 gap. The view is read-only and only reads session storage, and Send never reads it. So there is no money, privacy or lock effect.

**Why low.** It matches the brief's "a missing test on a minor path": a viewing aid, on an uncommon path (a payment over 20 UTxOs or 16 KiB). It is not a critical guard, so medium doesn't apply. It is more than a nit:

- It is release item 7's whole user-visible effect on four of the five reviews.
- `Swaps.tsx` and `Lovejoin.tsx` are 3,000-line screens that every release edits.

## The fix

**Recommended: one table of wiring tests in `tests/screens-wiring-review-fixes.test.ts`.** That file is 1.6.0's R3-20 seam, built for exactly this ("the line that makes the screen use it had none, since Vitest has no DOM: each could be reverted with every test green").

- **It already holds three of the five review states:**
  - `NewSwap`'s approval: `seed([null], …)`.
  - `PoolPage`'s review: `seed(["private", 1, undefined, undefined], …)`.
  - `ConnectRequest`'s funding: `seed(["", {}], …)`.
- **Transfer and Withdraw take `seed([{}, false], summary)`.** Their states run: `useRecipients`' one array, then `{}`, then `false`, then the review.
- **Each case:**
  - Stub `TxDetailButton`.
  - Capture its props with `on`, matched by `testId`.
  - Expect `props.parts` `toBe` the summary's own `parts`, and `props.txHash` the first's.
- **The identity check matters.** It is what catches the wrong array as well as the dropped prop.

What I ran, appended after the seam with Transfer and Withdraw imported:

```ts
const { Transfer } = await import("../src/ui/screens/Transfer");
const { Withdraw } = await import("../src/ui/screens/Withdraw");

describe("each review that can go in parts hands its own parts to Transaction details (pr335#2)", () => {
  const parts = [{ txHash: TX, fee: "200000", inputs: 20 }, { txHash: "cd".repeat(32), fee: "190000", inputs: 5 }];
  const seedelf = { lovelace: "80000000", tokens: [], utxos: 25, seedelfs: [], locked: { lovelace: "0", tokens: [], utxos: 0 } };
  function chip(testId: string, page: () => string) {
    let seen: Record<string, unknown> | undefined;
    seam.stubbed.add("TxDetailButton");
    on((name, props) => name === "TxDetailButton" && props.testId === testId, (props) => (seen = props));
    page();
    return seen;
  }
  const paid = { network: "preprod", max: false, fee: { size: "390000", compute: "0", scriptReference: "0", total: "390000" },
    changeLovelace: "0", changeTokens: 0, changeOutputs: 0, changeMinimum: "0", inputs: 25, left: 0 };
  // Send privately; Make public is the same with Withdraw and "withdraw-tx".
  it("Send privately", () => {
    seed([{}, false], { ...paid, txHash: TX, payments: [], parts });
    const props = chip("transfer-tx", () => render(createElement(Transfer, { seedelf, total: "80000000", onCancel: noop, onSent: noop } as never)));
    expect(props?.txHash).toBe(TX);
    expect(props?.parts).toBe(parts);
  });
  it("a swap's funding", () => {
    seed([(v: unknown) => (v as { id?: string } | undefined)?.id === "lovelace"], { id: "e16c…494e", side: { label: "MIN", decimals: 6 } });
    seed([null], { summary: { txHash: TX, index: 0, parts }, quote: {} });
    seam.stubbed.add("SwapApproval");
    expect(chip("swap-out-tx", () => render(createElement(NewSwap, { seedelf, onCancel: noop, onStarted: noop } as never)))?.parts).toBe(parts);
  });
  // Lovejoin: seam.effects.add("PoolPage"); answer("lovejoin-funding", …);
  //   seed(["private", 1, undefined, undefined], { source: "private", summary: { …paid, txHash: TX, index: 0, payments: [], parts, mix: { again: false, … } }, again: noop });
  //   stub PrivateReview and PublicReview; chip("lovejoin-tx", …).
  // A site's: seed(["", {}], { …paid, txHash: TX, index: 0, address, payments: [...], parts });
  //   chip("dapp-funding-tx", () => render(ConnectRequest …, { lovejoinReturns: true })).
});
```

**Why not the finding's two options:**

- **The source scan** ("expects `parts={` on each TxDetailButton …") still passes M2's `parts={out.summary.parts?.slice(0, 1)}`. That's the "passes the wrong array" case in the finding's own scenario. It also breaks when someone splits the JSX over two lines. If a scan is wanted anyway, require the same object on both props: `txHash={X.txHash} parts={X.parts}`.
- **An e2e step on Send privately in parts** needs a new e2e test with a transfer-in-parts fake. The house's rule is a stress run under `taskset` on the dev and store builds for any new e2e test. And it would cover Transfer only: no e2e fake reaches a swap, a Lovejoin mix or a site's funding in parts.

**Don't key the rule on the summary type,** as the finding's fix wording does ("every screen whose summary type has `parts`").

- The site's top-up (`SiteSessions.tsx:558`, chip at `:647`) and the collateral top-up (`Swaps.tsx:2701`, chip at `:2750`) review a `SessionOutSummary`. That type inherits `parts?` from `WithdrawSummary` (`rpc.ts:1944`).
- Yet the worker builds both with `inParts: false` (`sessions.ts:2217`, `:2340-2342`), so the field is always empty there.
- A type-keyed rule would therefore demand a prop on those two that is always undefined. Name the five reviews instead.

**A structural alternative:** `TxDetailButton` could take the summary itself (`of={summary}`), so `parts` can't be left behind. That changes the component's API, though, which is too much for a release gate.

**What the fix changes:** tests only.

- No `src/`, no UI text, no privacy note, no guard or refusal, no new request. It's within every owner's rule.
- It can land in 1.7.0 or after, since HEAD is correct.
- **One cost:** the seeds are keyed on state order, as that whole file's are. A state added before a review's makes the seed throw loudly ("a seed after … met a state starting …"). The file already accepts that.

## Not checked

- I didn't run the e2e: the brief forbids it. Its coverage of Withdraw is from reading `extension.spec.ts:2657-2675` and pr335's report.
- I checked M1 against the 78 UI-touching test files, not the whole suite. The other roughly 170 files can't reach the four screens:
  - Only `src/ui/App.tsx` imports them.
  - The only tests that import `App` (`lock-screens`, `i18n-assembly`) were in the run.
  - The rest import UI helpers and components such as `BringAllBack`, `PendingBanner` and `TokenList`, or none at all.
- The scratch snippet above trims two cases to comments. The full version (all five) is what ran.

All scratch files are deleted: `extension/tests/zz-review-v-pr335-2-impact-1.test.ts`, and the copy under `scratchpad/review/v-pr335-2-impact/`.

## CLI notes

None.
