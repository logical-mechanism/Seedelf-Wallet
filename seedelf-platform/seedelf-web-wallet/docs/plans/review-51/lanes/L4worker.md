# Lane L4worker

Returned by the workflow's agent `ac0dcf259a27e1a56`, written here by the lead from its structured answer.

## Findings (2)

### l4worker#1 · low · laterSkip treats any deposit or mix before the swap's first return as 'it went through Lovejoin'. So once anything comes back after a direct own return that had only its collateral's mix before it (the default), the page says the swap's own reason was a later part's and that the swap came back through Lovejoin

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx:3153`
- **Who:** stranger · **Since:** abcf2ffe · **Confidence:** confirmed-by-run

**Scenario:**

Lines are FIXTREE's (0dce8a6b). A private swap of ADA for MIN comes back through Lovejoin, as approved. Its spare ADA is too little for a 5 ₳ box: here the swap's change is 3 ₳, which is common for an ADA-to-token swap whose token has no pool. With Settings' collateral switch on (the default), buildBack sends a three-transaction chain: the 5 ₳ collateral's deposit, its mix, then the return directly. It writes lovejoinSkipped = 'its spare ADA is too little for a box' (sessions.ts:5035-5036, sendChain :5432). Without anything after that return, the finished page is right: 'Directly: Lovejoin was left out', and the callout says 'Lovejoin was left out of its return: its spare ADA is too little for a box. So it comes back directly, tied to the session on chain.'

Then a stranger pays the session's account 2 ₳ before the session closes. The address has been on chain since the funding. A second return brings it back. It is a strangers-only return (firstReturnBuilt, sessions.ts:4770), so it writes no reason, and lovejoinSkipped is still the swap's own.

laterSkip (Swaps.tsx:3153-3156) then reads: own return at index 4, a deposit and a mix before it (the collateral's tail), a back after it. So it returns true. The finished page now says:
- Callout: 'Lovejoin was left out of a later return: its spare ADA is too little for a box. That part comes back directly, tied to the session on chain.'
- Last step (backStepText skips directLeftOut, then the s.chain branch at :3129): 'What goes into Lovejoin boxes comes back later, each box by itself; the rest at once, under fresh registers'.

The swap's own proceeds, 2 ₳, 906.59 MIN and 3 ₳ less fees, came back directly, tied to the session on chain. Only its 5 ₳ collateral went into a box. The page now tells the user that only a later part is tied. privacy.md:458 promises that such a session 'comes back directly, and says Lovejoin was left out and why'. At abcf2ffe's parent the same run reads 'Directly: Lovejoin was left out' with 'Lovejoin was left out of its return: …'.

No money moves wrongly: the words, a privacy statement, are false. The same root cause without a stranger: a late leg (r2still#2) after such a return writes NO_COLLATERAL, and the last step again says 'through Lovejoin' for a return that came back directly.

**Evidence:**

Code (FIXTREE 0dce8a6b):
- Swaps.tsx:3153-3156: `function laterSkip(s) { const own = ownReturnAt(s); return !!s.lovejoinSkipped && own >= 0 && s.txs.slice(0, own).some(mixed) && s.txs.slice(own + 1).some((x) => x.kind === "back"); }`. A collateral-only tail before a direct own return passes `slice(0, own).some(mixed)`.
- Swaps.tsx:3123: `if (s.lovejoinSkipped && !laterSkip(s)) return t("swaps.step.directLeftOut");`, then :3129 `if (s.chain) return s.chain.cut || s.chain.stopped ? chainText(s.chain) : t("swaps.step.throughLovejoin");`.
- Swaps.tsx:2572-2577 shows swaps.warn.skippedLater when laterSkip is true.
- sessions.ts:5035-5036/5044-5052: a direct return with a collateral tail carries `said` (lovejoinSkipped) and `chain: chainOf(result)`. sendChain :5432 writes it. sendBack :5309/:5312 and sendChain :5429 write nothing for a strangers return.
- The fixer's own comment above laterSkip names the case ('a reason of the swap's own, its collateral's mix alone gone in, read as a later part's once a stranger's return comes after it'). It isn't in INDEX, FINDINGS or owner-calls, and its test (swap-page.test.ts, l3screens#2 block) covers the tail only with nothing after it.

Run (FIXTREE untouched; git status clean before and after):
- Probe: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/scratchpad/r51/work/L4worker/l4worker-1-tail-stranger.test.ts.
- How it runs: real worker and WebAssembly over the fakes, the e2b#2 harness from swap-page.test.ts with the change set to 3 ₳ and the collateral switch at its default. giveme.my's tail witness is stood in for as lovejoin-planner's `pooled` does.
- Mirrors: copied into scratch mirrors at r51/work/L4worker/head (git archive of HEAD's extension) and r51/work/L4worker/parent (abcf2ffe^ = 5be0b1b4, whose extension equals 7921367f's). node_modules, wasm, docs and the sibling crates are symlinked to FIXTREE.
- Command, from each mirror's extension/: `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 15m nice -n 10 npx vitest run tests/l4worker-1-tail-stranger.test.ts --reporter=verbose`.

HEAD output:
- `L4W first return {"kinds":["out","swap","deposit","mix","back"],"lovejoinSkipped":"its spare ADA is too little for a box"}`
- `L4W own return alone {"backStep":"Directly: Lovejoin was left out","callout":"Lovejoin was left out of its return: its spare ADA is too little for a box. So it comes back directly, tied to the session on chain."}`
- `L4W after the stranger's return {"kinds":[...,"back","back"],"lovejoinSkipped":"its spare ADA is too little for a box"}`
- `L4W finished page {..."backStep":"What goes into Lovejoin boxes comes back later, each box by itself; the rest at once, under fresh registers","callout":"Lovejoin was left out of a later return: its spare ADA is too little for a box. That part comes back directly, tied to the session on chain."}`

Parent output, the same run: `L4W finished page {..."backStep":"Directly: Lovejoin was left out","callout":"Lovejoin was left out of its return: its spare ADA is too little for a box. So it comes back directly, tied to the session on chain."}`. Both runs: 1 passed.

**Fix:**

The view can't tell a collateral-only tail before a direct return from a one-box chain: both are deposit, mix, back, total 3. So the worker has to record which return the reason belongs to.

- Recording it: in sendBack's `after` and sendChain's update, keep the hash of the return that wrote lovejoinSkipped (for example `lovejoinSkippedBy: built.txHash`), or keep the reason on that return's RecordedTx, as L3screens' 'sturdier option' had it.
- Carrying it: put it in the SessionView.
- Using it: laterSkip is true only when that hash isn't the own return's (`s.txs[ownReturnAt(s)]`). backStepText uses the same test. A record from before the field reads the reason as the own return's, which is what the parent did.
- Class: privacy.md:458's sentence and flows.md:478 stay true then.
- Test: this probe, flipped. The finished page reads 'Directly: Lovejoin was left out' and 'Lovejoin was left out of its return', with the l3screens#2 late-leg case still reading 'a later return'.

**Known check:**

Searched review-51 (INDEX.md, FINDINGS.md, owner-calls.md, lanes/*.md, verify/*.md), docs/backlog.md and docs/archive/plans/*.md for laterSkip, skippedLater, 'collateral's mix alone', 'later part's' and 'a later return'. The only hits are e2b#2, gap-g4#1, l3still#3 and l3screens#2's own text, which proposed the rule and the per-return option. Nothing records the tail-only case. The limitation exists only in the code comment above laterSkip.

### l4worker#2 · nit · In the spent step of a stopped swap, the timeline's third step still says 'Cancelled: The order's funds back at the account' though no cancel goes and the order was filled; abcf2ffe flagged spent for the line, sub-line, tag and Stop but not the timeline's `cancelled`

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx:3180`
- **Who:** user · **Since:** abcf2ffe · **Confidence:** confirmed-by-run

**Scenario:**

Lines are FIXTREE's. The user presses Stop soon after the order goes out, while Koios can't find the order yet: the record is stopping, with orderOpen (L16). The batcher then fills it. The run that first reads every order spent only notes it (spentSeen). Its gate clears orderOpen and builds no cancel. Until a run READ_EVERY_MS on tells the fill, which is 15 s to a minute, the page says 'It all comes back to your private balance next, by itself.'. Its timeline's third step, shown as the current step, says 'Cancelled' and 'The order's funds back at the account'. Nothing was cancelled, and the order was filled. The told run then flips it to 'Filled'. At the parent, the same state read 'Waiting on an order: One is still open at a DEX', l3screens#1's wrong words. The fix swapped one wrong line for another in the timeline. The same appears after a Stop pressed on a page that hadn't yet shown the spent flag. Words only, for one run.

**Evidence:**

Swaps.tsx:3180: `const cancelled = !!tx("cancel") || (auto.stopping && !auto.filled && !auto.refunded && !auto.againstPools);` ignores `auto.spent`. :3176 `open` was given `!auto.spent`, and nowLine/subOf/tagOf/stoppable were too.

Run: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/scratchpad/r51/work/L4worker/l4worker-2-spent-timeline.test.ts, in both mirrors. The record is stopping with orderOpen, then the order is spent with the proceeds at the account, then one asked advance from the real worker, then the real Session page rendered.
- HEAD: `{"auto":{"step":"cancelling","stopping":true,"filled":false,"spent":true},"nowLine":"It all comes back to your private balance next, by itself.","third":{"title":"Cancelled","sub":"The order's funds back at the account","state":"now"},"kinds":["out","swap"],"submitted":0}`.
- Parent: `"third":{"title":"Waiting on an order","sub":"One is still open at a DEX, and the server can't find it yet"...}`.
- Command as for l4worker#1. 1 passed on each.

**Fix:**

Make the timeline read the noted step as the page now does elsewhere. With `auto.spent`, `cancelled` is false unless a cancel transaction is in the record. The third step then shows the outcome to be told rather than 'Cancelled': for example the plan's 'Filled' title with a short neutral line, or a new short line saying the order is spent and its fill or refund is read next. Pin it in swap-page.test.ts's l3screens#1 test with the stopping variant it already builds.

**Known check:**

Searched review-51 (INDEX, FINDINGS, owner-calls, lanes L3*/R2*), docs/backlog.md and docs/archive/plans for 'Cancelled', swaps.step.cancelled and the timeline in the spent state: nothing. l3screens#1's fix list names nowLine, stoppable, subOf, stopCost and noteOrderOpen, not the timeline.

## Checked and holds

- The time gate holds for every run kind. sessions.ts:4010-4019 notes spentSeen when it's missing or ahead of the device clock, and returns while now()-seen < READ_EVERY_MS, Refresh/Stop/Resume included. Nothing is told or sent in that window. The told update deletes spentSeen (:4034). FIXTREE's swap-runner block 'a swap whose every order a run just read spent' ran: 4 passed.
- No swap comes back twice. Every step goes through serial (advance, stop, resume, runAll). The noted run returns before `go`. The only exception to the arrived check needs filled or refunded. So no return is built between the note and the told run.
- No swap is left without a way back. While spent, every order is spent, so a cancel has nothing to take, and the next run 15 s to a minute on tells it. A failed read sets retry, which the page offers as Try now. An order read open again clears the note (notSpentAfterAll at :3965 and :3998) and brings Stop back. A stopped swap's Stop already went. The Stop dialog closes when the record reads spent (stopReading/useEffect).
- stopCost with spentSeen (:3532) prices the told return. out is false, counted = held, and keeps is true. funded is unused once told. The new test shows the noted price equals the filled price.
- The gate's noteOrderOpen(false) clears a stopped swap's Order open in the same run. tagOf, nowLine and the timeline's `open` add !spent as belt and braces.
- firstReturnBuilt (:6772) looks at the first sent, unreplaced back only, and walks back over that return's own deposits and mixes. Math.min covers a re-sent copy whose `at` moved. It's undefined before any return, and apart guards `builtAt !== undefined` before landedAfter runs. A late leg lands before the orders read spent, which is before the told run's build and its first send.
- Decimals are applied once. Every screen scales through tokenDecimals (the wallet's list, then t.decimals, then 0). heldText overrides only the swap's tokenOut, with the quote's decimals. inUnits prefers a token's own decimals, which WebAssembly lists never carry.
- Decimals keys agree everywhere: `${policyId}.${assetName}` with hex names in decimalsOf, inUnits, withTokenDecimals and decimalsIn. No code compares token lists by equality. dapp.ts remember() writes signed.summary (WebAssembly's), not the window's.
- withTokenDecimals covers all six DappTxSummary token lists (netTokens, paid, ownOutputs, mint, contractTokens, releasedTokens). ties() keeps them. The Waiting entry's map is the same heldDecimals map, rows included, that tx-view uses for that hash. Other hashes use heldDecimals plus the kept record's tokens.
- No deadlock in the new code:
- withdrawNowNow's press pin and withdrawOne's start check are top-level withKeys awaits, and no withdrawOne caller (:7105, :7284, :7570, the retry :7933) is inside a wallet task.
- take checks its pin synchronously inside its own withKeys.
- readTx's heldDecimals runs in a fresh withKeys, after withViewKeys has resolved.
- tx-view's withKeys wraps only session reads, as before.
- Pins never refuse the same phrase. phraseOf is oneTime.keyHash(0), the same after a lock and unlock and on any account. A given pin is re-checked at withdrawOne's start, and the RewardsChangedError retry passes the same pin. The Withdrawing update is checked before its read and before its write (update :8290). submitWatched's pin, moved into take, is equivalent: restoreNow under another phrase touches only that phrase's own sealed record.
- publicStart's pin is returned through the public turn and checked in the watch's take after pumpPublic.
- Transfer's too-much line (7921367f) uses withdraw.tooMuch with available or inPrivate over Home's unlocked side, and that string exists in en, es and ja. transfer.tooMuch has no reader left in src, tests or e2e.
- Swaps' someLocked words: Balances.seedelf.locked is required (rpc.ts:341), and Home hands Dapps → Swaps the unlocked side with locked kept. The new keys exist in en, es and ja.
- 0dce8a6b's e2e reads the spent step's line and checks Stop is gone, then refreshes until the return. It's a test-only change.

## Notes

- Guards I met (the schema has no field for them):
- sessions.ts:4010-4019, the time gate: pinned by swap-runner's spent block and by lovejoin-planner's r2still#2 cases via pastSpent.
- sessions.ts:3965/:3998, notSpentAfterAll: pinned by swap-runner's 'notes it afresh once an order reads open again'.
- sessions.ts:3532, `told` in stopCost: pinned by swap-runner's 'prices Stop as the return that comes'.
- Swaps.tsx:334, stoppable's !spent: pinned by swap-page's l3screens#1 test.
- sessions.ts:4770, firstReturnBuilt: pinned by swap-page's l3still#2 test.
- lovejoin.ts:7176, the press's pin, and pending.ts:420, take's pin: pinned by lovejoin-withdraw-submit's two l3time#1 tests.
- dapp.ts:2184-2190, the window's decimals: pinned by tx-detail-decimals.test.ts.
- sessions.ts:4728 and :981, inUnits: pinned by session-back-decimals.test.ts.
- A known issue with a new fact: since l3still#2's fix moved the cut from a chain's last send to its first, the slack against a slow device clock is much smaller. A late leg (r2still#2) is read as a stranger's only when the device clock runs behind by more than the gap from its block to the first return's first send, which can be as little as READ_EVERY_MS plus the reads. Before, a chain's return allowed minutes. A stranger's return writes no reason, so the late leg's direct return says nothing. L3time's notes already record the clock-skew direction. Words only.
- A pre-existing issue that undercuts abcf2ffe's clock claim:
- step's readAt gate (sessions.ts:3758) is in memory and cleared only by reset(). After the device clock is set back, every alarm, poll and unlock run is turned away until the clock passes the last run's time, because at - readAt is negative.
- So 'taken afresh after a clock set back' holds only for asked runs (Refresh, Stop, Resume). The new test 'notes it afresh where the device's clock went back' uses only asked advances.
- This predates chunk 51 and heals itself (an hour's stall for an hour set back, or a worker restart). It isn't recorded anywhere I found.
- A race: Transaction details opened from a sign window across an auto-lock shows a token off the list in raw units. tx-view's withDecimals reads the waiting entry's in-memory map inside withKeys, which throws when locked. The window's rows were scaled at read time. dapp-approvals is refused while locked (e4b#2), so this needs the window still on screen as the lock lands.
- Bring one back across a Remove and restore during Koios's submit ends in 'The wallet is locked.' though the first phrase's withdraw went. lovejoin-withdraw-submit's second l3time#1 test pins that outcome. It's harmless, since the first phrase is gone, but the words aren't quite true.
- laterSkip's limitation (l4worker#1) is stated in the fixer's own code comment, but it was traded for l3screens#2's fix without a record. The owner may want it in owner-calls even if it's fixed.

## Coverage

Read in full:
- COMMON.md, RESUME.md, FIX.md, fix-branches.md, owner-calls.md.
- lanes/L3time.md, L3still.md, L3screens.md and L3sign.md; the INDEX and FINDINGS lines for the L3 lanes.
- The full diffs of abcf2ffe (sessions.ts, lovejoin.ts, pending.ts, dapp.ts, tx-view.ts, rpc.ts, Swaps.tsx, en.json, the new tests in swap-runner, swap-page and lovejoin-withdraw-submit, swap-session.ts's pastSpent) and of 7921367f and 0dce8a6b's e2e.

Read at FIXTREE HEAD around the changes:
- sessions.ts: step, act (3753-4060), noteOrderOpen and notSpentAfterAll, waits, ordersSpent, ordersOpen, liveOrders' head, stop, stopCost, resume, runAll, advance, the head of buildBack with apart, its chain and direct returns, sendBack, noteLanded, sendChain, pump, sendStep, sendRecorded, chainSoFar, running, holdingOf/inUnits, firstReturnBuilt, chainView, autoView, receivedOf.
- lovejoin.ts: withdrawNow, withdrawNowNow, withdrawOne, update, publicSubmit, publicStart's signature; the withdrawOne callers at 7105 and 7570.
- pending.ts: restoreNow, take, watchSent, submitWatched's take.
- wallet.ts: Keys, phraseOf, phrasePin, withKeys, withAccount.
- dapp.ts: the header notes, readTx, signTx, ask's decimals, waitingCbor/waitingDecimals, ties' return, remember, withTokenDecimals, stateChanged.
- tx-view.ts: txView, heldDecimals, withDecimals, decimalsIn. balances.ts decimalsOf. ui/tokens.ts tokenDecimals/tokenQuantity/tokenAmountText.
- Swaps.tsx: tagOf, subOf, stoppable, stopReading, NewSwap's held lines, the Session page's poll and callouts, backStepText, ownReturnAt, laterSkip, Timeline, heldText, nowLine. Transfer.tsx's too-much line. handlers.ts tx-detail and dapp-approvals.

Ran:
- Two probes, each in two scratch mirrors (HEAD and abcf2ffe^), described in the findings.
- FIXTREE's swap-runner.test.ts with -t 'every order a run just read spent' (4 passed).
- FIXTREE's git status is clean throughout.

Skimmed: lovejoin-planner's tail tests, for the harness; swap-page's e2b#2/r2docs#1/l3screens#2 tests; session-back-decimals.test.ts; the l3time#1 tests.

Not reached:
- tx-detail-decimals.test.ts's body.
- swap-form-review's new case.
- The i18n back-translation files.
- architecture.md's edit.
- DappApprovals.tsx's rendering of the new DappToken.decimals beyond its amount() helper.
- Playwright.
- Rust: abcf2ffe has no Rust changes.
