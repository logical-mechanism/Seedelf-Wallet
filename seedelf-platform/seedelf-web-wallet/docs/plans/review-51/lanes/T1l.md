# Lane T1l

Returned by the workflow's agent `af3aa43386e86c297`, written here by the lead from its structured answer.

## Findings (23)

### t1l#1 · low · A stranger's token name, a pool's ticker and a DRep's name kept from running as a CSV formula: no test fails without it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/activity.ts:228`
- **Who:** stranger · **Since:** 2185c4b3 (2026-09-25) for the pool and DRep columns; :228 as it is now since f823fda3 (2026-10-04) · **Confidence:** confirmed-by-run

**Scenario:**

Drop the `true` that marks a column as free text: the tokens column (activity.ts:228), the pool column (:231) or the DRep column (:232). A stranger sends the wallet a token whose asset name reads `=HYPERLINK("http://x","y")`. It's unlisted, readable and like no listed ticker, so tokenText labels it by that name, and csvName puts the name first in the cell (:158-162). Save as CSV then writes a cell starting with `=`, which a spreadsheet opening the file runs. A pool's ticker or a DRep's name in the user's staking rows works the same way. All three pass `true` today, so nothing is wrong now. The gap: reverting any of the three passes every test, because the formula test builds its case from a note and a detail only (activity.test.ts:995-1004).

**Evidence:**

Three mutants, each in a copy only. activity.ts:228 `csvCell(tokens || (e.tokens ? t("activity.csv.tokenKinds", { count: e.tokens }) : ""), true),` became the same without `, true`. :231 `csvCell(s.pool ? `${s.ticker ? `${s.ticker} ` : ""}${s.pool}` : "", true),` became the same without `, true`. :232 `csvCell(s.drep ? (voteOf(network, s) ?? s.drep) : "", true),` became the same without `, true`. Each run: tests/activity.test.ts (the lanes' named test) 55 passed, 0 failed. The 4 other tests importing activity.ts: 94 passed. The rest of activity.ts's import closure plus the 28 tests that read source files as text (48 files): 761 passed. The pinned siblings fail as they should: csvCell's own check (:170) fails activity.test.ts:997, and the note (:230) and detail (:229) flags fail :1003. e2e's CSV check (e2e/extension.spec.ts:1606-1613) reads only the header and the row count.

**Fix:**

In activity.test.ts's 'never lets someone else's words run as a spreadsheet formula', add an entry with an unlisted token named `=HYPERLINK(1)` (assetName in hex), plus staking { pool, ticker: '=1+1', drep } whose vote name starts with `@`. Expect each of those cells to start with `'`. A stronger form pins every column at once, future ones included: assert that no cell of activityCsv's output starts with [=+\-@\t\r] once its quotes are stripped.

**Known check:**

grep -i 'csvCell|formula' in docs/backlog.md: none. In docs/archive/plans/: launch-review.md:381 'A CSV formula guard', the original fix, and nothing on these columns or their tests. Lanes E9a/E9b named activity.test.ts for csvCell.

### t1l#2 · low · Send publicly's Total leaving counting a payment to another of the user's own accounts as leaving: no test fails without it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/CardanoSend.tsx:165`
- **Who:** user · **Since:** d423b79a (2026-10-05) · **Confidence:** confirmed-by-run

**Scenario:**

Loosen :165's `p.own && p.ownAccount === active` to `p.own`, and :170's token filter the same way. A payment from Public account 1 to the user's own Public account 2 (own true, ownAccount 1) then counts as coming back. A 50 ₳ payment's review would say 'Total leaving your public account 0.2 ₳', and 'Public account after' would be 50 ₳ too high, though the 50 ₳ leaves this account. The code is right today. The gap is in its test: screens-wiring-review-fixes.test.ts:1212-1224 pins a stranger's key under our stake key (counted) and the active account's own address (not counted), but never another own account.

**Evidence:**

Two mutants. :165 `(sum, p) => (p.own && p.ownAccount === active ? sum : sum + BigInt(p.lovelace)),` became `(sum, p) => (p.own ? sum : sum + BigInt(p.lovelace)),`. :170 `summary.payments.filter((p) => !(p.own && p.ownAccount === active))` became `summary.payments.filter((p) => !p.own)`. Each run: screens-wiring-review-fixes.test.ts (named) 48 passed. The 2 other direct importers: 8 passed. Closure (40 files): 653 passed. Dropping the exclusion altogether is caught at screens-wiring-review-fixes.test.ts:1223 ('5.2 ₳' for '0.2 ₳'). e2e/extension.spec.ts:1418-1433 picks Account 2 on Send publicly, then clears the field without opening the review.

**Fix:**

In the same describe, add sendReview([{ address, own: true, ownAccount: 1, ...paid }], 2) and expect the total row to read 5.2 ₳ and 1 token. Send privately's toSelf (t1l#3) is the same family.

**Known check:**

grep 'ownAccount', 'Total leaving' and 'toSelf' in docs/backlog.md: none. In docs/archive/plans/: review-1.7.2 has the staked-key case, which is pinned, and nothing on another own account's total.

### t1l#3 · low · Send privately's Total leaving leaving out a payment to the user's own Seedelf: no test fails without it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Transfer.tsx:178`
- **Who:** user · **Since:** d423b79a (2026-10-05) · **Confidence:** confirmed-by-run

**Scenario:**

Remove `p.toSelf ? sum :` at Transfer.tsx:178. A private Send of 5 ₳ to someone and 2 ₳ to one of the user's own Seedelfs then says 'Total leaving your private balance 7.27 ₳', and 'Private balance after' comes out 2 ₳ low, though the 2 ₳ comes back. The lane named review-totals-incoming.test.ts, but that test doesn't render Transfer's review.

**Evidence:**

Mutant: `const leaving = summary.payments.reduce((sum, p) => (p.toSelf ? sum : sum + BigInt(p.lovelace)), BigInt(summary.fee.total));` became `const leaving = summary.payments.reduce((sum, p) => sum + BigInt(p.lovelace), BigInt(summary.fee.total));`. review-totals-incoming.test.ts: 3 passed. The 2 direct importers: 54 passed. Closure (39): 650 passed. e2e/extension.spec.ts:2433-2438 reviews exactly this payment (5 ₳ to 'This is a test.' and 2 ₳ to the user's own 'web-wallet'), but asserts only 'To all recipients7 ₳' and the to-self note, never the total.

**Fix:**

At e2e/extension.spec.ts:2438, expect transfer-review to contain /Total leaving your private balance5\.27\d*\s₳/. Or write a seam test that seeds Transfer's summary with a toSelf payment and reads the total row. Its token line (:179) is the same family.

**Known check:**

grep 'toSelf' in docs/backlog.md: none. In docs/archive/plans/: chunk-09-transfer.md:60 and :95 only describe paying yourself; no record of the total's test.

### t1l#4 · low · Start a pool's 'Private balance after' counted from Home's figure: no test fails without it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/LovejoinLaunch.tsx:456`
- **Who:** user · **Since:** 8cc00445 (2026-10-19) · **Confidence:** confirmed-by-run

**Scenario:**

Replace homeBalance(seedelf) at :456 with seedelf.lovelace, the spendable side alone. A pool started from the private balance while 25 ₳ is locked or on its way back then says 'Private balance after' 25 ₳ low. The fee part of the same row (:455) is pinned.

**Evidence:**

Mutant: `return <TotalRows side={review.from} leaving={leaving} before={review.from === "private" ? homeBalance(seedelf) : publicTotal} />;` became the same with `seedelf.lovelace` for `homeBalance(seedelf)`. lovejoin-merged-screens.test.ts (named): 22 passed. 2 direct importers: 32 passed. Closure (56): 910 passed. Dropping the fee from :455 fails lovejoin-merged-screens.test.ts:289. No e2e test opens Start a pool.

**Fix:**

In lovejoin-merged-screens.test.ts's 'on a pool's start paid from the public account, as from the private balance', give the private side locked and incoming lovelace. Expect review-after-private to equal spendable + locked + incoming − (locked.total + fee).

**Known check:**

grep 'LaunchTotals' in docs/backlog.md and docs/archive/plans/: none.

### t1l#5 · low · A locked UTxO's tokens kept out of what a form may send: no test fails without it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/format.ts:380`
- **Who:** user · **Since:** 97d7cdd7 (2026-09-24) · **Confidence:** confirmed-by-run

**Scenario:**

Without :380's subtraction, unlocked() hands the forms every token held, a locked UTxO's included. Say a locked UTxO holds the only 100 MIN. Send's or Make public's token picker then offers 100 MIN. After Review, the build refuses for lack of the token, because coin selection leaves locked UTxOs out (coin-control.ts:254-255). The ADA part (:382) and the whole function (:377) are pinned.

**Evidence:**

Mutant: `.map((t) => ({ ...t, quantity: (BigInt(t.quantity) - (locked.get(tokenKey(t)) ?? 0n)).toString() }))` became `.map((t) => ({ ...t }))`. review-totals-incoming.test.ts and home-review-fixes.test.ts (named): 11 passed. 15 direct importers: 327 passed. Closure (97): 1599 passed. The :382 and :377 mutants fail review-totals-incoming.test.ts:72 ('516000000' for '513000000'). e2e/extension.spec.ts:1862-1886 locks a UTxO that holds tokens but checks only the ADA line.

**Fix:**

In format.test.ts: unlocked({ lovelace: '10000000', tokens: [100 MIN, 5 X], utxos: 2, locked: { utxos: 1, lovelace: '2000000', tokens: [100 MIN] } }) should give tokens [5 X]. A lock of 40 MIN should leave 60 MIN.

**Known check:**

grep 'unlocked(' in docs/backlog.md: none. In docs/archive/plans/: privacy-review.md:385 is about the worker's unlocked(), a different function.

### t1l#6 · low · A review's '… after' held at 0 ₳: no test fails without it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/ReviewTotals.tsx:100`
- **Who:** user · **Since:** d423b79a (2026-10-05) · **Confidence:** confirmed-by-run

**Scenario:**

Without :100's clamp, a review whose leaving is more than the before figure handed down shows a negative after: 'Private balance after -3 ₳'. That can happen where a stale or spendable-only figure is passed in. No money moves on this line. The subtraction itself (:63) and both of homeBalance's parts (:81) are pinned.

**Evidence:**

Mutant: `const after = lovelace > 0n ? lovelace : 0n;` became `const after = lovelace;`. review-totals-incoming.test.ts (named): 3 passed. 3 direct importers: 26 passed. Closure (86): 1393 passed.

**Fix:**

In review-totals-incoming.test.ts, render TotalRows with before '1000000' and leaving 3000000n, and expect review-after-private to read 0 ₳.

**Known check:**

grep 'AfterRow|clamp' in docs/backlog.md and docs/archive/plans/: none.

### t1l#7 · low · A pasted recovery phrase cleared from the clipboard: no test fails without it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/PhraseInput.tsx:91`
- **Who:** user · **Since:** db18375c (2026-09-24) · **Confidence:** confirmed-by-run

**Scenario:**

Delete PhraseInput.tsx:91. Pasting a recovery phrase into the restore boxes then fills them and leaves all 12 or 24 words on the system clipboard. Clipboard history, other apps and any page with clipboard access can read them there later. The privacy review lists 'a paste clears the clipboard' among the phrase's protections (docs/archive/plans/privacy-review.md:944). No test pins it.

**Evidence:**

Mutant: the line `navigator.clipboard?.writeText("").catch(() => undefined);` deleted. No test imports PhraseInput.tsx directly. The 10 tests in its import closure: 201 passed. With the 28 source readers added (25 files): 250 passed. e2e pastes a phrase through a synthetic ClipboardEvent (e2e/support.ts:679; extension.spec.ts:1313, :1342) and never reads the clipboard afterwards. Its clipboard-read grants are in other tests (:1104, :2565).

**Fix:**

Over the screens-wiring seam: stub navigator.clipboard.writeText with vi.fn(), add on('WordBox', (p) => (p.onPaste as (t: string) => boolean)(phrase)), render PhraseInput, and expect writeText toHaveBeenCalledWith(''). Or in e2e with clipboard-read granted: write the phrase to the clipboard, paste it into the first box, and expect navigator.clipboard.readText() to be ''.

**Known check:**

grep 'clipboard' in docs/backlog.md: none. In docs/archive/plans/: privacy-review.md:870-875 and :944 are the design (no timed clear, a paste clears it); blind-task-usability-test.md has a harness note that the paste tip went untested. No record of this guard's test.

### t1l#8 · low · Send publicly's warning before an ADA Handle goes into someone's Seedelf: no test fails without it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/CardanoSend.tsx:338`
- **Who:** user · **Since:** 2185c4b3 (2026-09-25) · **Confidence:** confirmed-by-run

**Scenario:**

Remove the HandleWarning at :338. Send publicly to a Seedelf's name, with an ADA Handle among the tokens, then says nothing. Once the Handle sits at the Seedelf contract, a wallet paying `$name` pays the contract with no register, and anyone can take what it pays (HandleWarning.tsx:1-6). The owner's rule makes this a warning, never a refusal, so the warning is all there is. Send privately's own HandleWarning (Transfer.tsx:372) wasn't in the lanes' lists.

**Evidence:**

Mutant: `{read.state === "seedelf" && <HandleWarning tokens={amounts.each[i]?.tokens.sent ?? []} />}` became `{false && <HandleWarning tokens={amounts.each[i]?.tokens.sent ?? []} />}`. The 3 direct importers: 56 passed. Closure (40): 653 passed. No e2e test names handle-into-seedelf.

**Fix:**

Over the screens-wiring seam: seed the To read as { state: 'seedelf', seedelf } with seedInitial, and give cardano.tokens a $handle (ADA_HANDLE_POLICY, the name in hex) picked with amount '1'. Render CardanoSend and expect data-testid='handle-into-seedelf'. With an address read, expect none.

**Known check:**

grep 'HandleWarning|handle-into-seedelf' in docs/backlog.md: none. In docs/archive/plans/: launch-review.md:282 (#57, the warning's origin on returns); nothing on this form's test.

### t1l#9 · low · A token amount the form can't read ('1.2.3') refused before Review: no test fails without it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/TokenAmounts.tsx:72`
- **Who:** user · **Since:** 1e802e13 (2026-10-03) · **Confidence:** confirmed-by-run

**Scenario:**

Delete :72's problem. sanitizeAmount keeps text it can't read as typed (format.ts:274-277), and :69's letter test lets digits and points through. So a token box holding '1.2.3' ends up neither a problem nor a token sent. `ok` stays true, Review is on, and the payment is built without that token. The review's rows simply list no such token. With the line, Review waits on 'has at most 6 decimal places' (or 'a whole number'). The zero case (:66) is pinned only by e2e. Over-held (:73) is pinned by token-amounts-hidden.test.ts:20.

**Evidence:**

Mutant: `problems[key(token)] = decimals ? t("token.amount.atMostDecimals", { decimals }) : t("token.amount.wholeNumber");` deleted. token-amounts-hidden.test.ts and payment-forms.test.ts (named): 8 passed. The direct importer: 5 passed. Closure (56): 918 passed. e2e/extension.spec.ts:2599-2601 types 1.1234567, which sanitizeAmount cuts to 1.123456 before tokenChoices ever sees it.

**Fix:**

In payment-forms.test.ts or a tokenChoices case: tokenChoices('preprod', [a token of 100 with 6 decimals], { [key]: '1.2.3' }) should give ok false, problems[key] set and sent []. Do the same for a 0-decimal token with '1.5'.

**Known check:**

grep 'atMostDecimals' in docs/backlog.md and docs/archive/plans/: none.

### t1l#10 · low · Bring everything back building and signing its returns once, for the list it opened with: no test fails without it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/ClaimAll.tsx:100`
- **Who:** user · **Since:** 5cc61e55 (2026-09-25) · **Confidence:** confirmed-by-run

**Scenario:**

Drop the effect's `[]` at :100, and every render runs session-claim-build again. Each answer sets `built` and resets `chosen` to every return (:90-91), which renders again. So while the page is open, the wallet builds and signs every session's return in a loop. Each pass reads every session's account (sessions.ts:3335), and a return the user took off comes back on. The lane found no test, and the run agrees.

**Evidence:**

Mutant: `    // Built once, for the list it opened with: building again would sign again.\n  }, []);` became the same ending `  });`. The 6 direct importers: 161 passed. Closure (38): 564 passed. The screens-wiring seam runs effects only for components a test names in seam.effects, and no test names ClaimAll. e2e/extension.spec.ts:817-830 opens this page and toggles a return off. Under the mutant the next rebuild turns it back on, so that test may fail, but only by a race, and nothing in it counts the builds.

**Fix:**

Over the screens-wiring seam: seam.effects.add('ClaimAll') and answer session-claim-build with two returns. Render with an on() that toggles one return. Expect asked().filter((x) => x === 'session-claim-build') to have length 1, and the toggled return to stay off.

**Known check:**

grep 'session-claim-build|built once|sign again' in docs/backlog.md: none. In docs/archive/plans/: chunk-15c-private-cip30.md:85 and privacy-review.md:708 describe the call only.

### t1l#11 · low · Home holding payments past 10 minutes while a maybe-sent one may still land: no test fails without it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Home.tsx:502`
- **Who:** user · **Since:** a0d3226a (2026-09-27) · **Confidence:** confirmed-by-run

**Scenario:**

Drop `!!pending.maybeSent ||` from :502. A payment Koios didn't answer then holds new payments for HOLD_MS (10 minutes) only. After that, Send, Make public, Make private and the rest come back while the first payment may still land. Behind it, the worker settles a maybe-sent payment before each send (script-spend.ts:396, move-in.ts:144). The hold as a whole, and Move in's use of it, are pinned by e2e only (see checked_ok).

**Evidence:**

Mutant: `const watching = pending !== null && unsettled(pending) && (!!pending.maybeSent || now - pending.submittedAt < HOLD_MS);` became `const watching = pending !== null && unsettled(pending) && now - pending.submittedAt < HOLD_MS;`. home-review-fixes.test.ts and home-says.test.ts (named): 32 passed. 10 direct importers: 285 passed. Closure (28): 336 passed. e2e's maybe-sent case (e2e/extension.spec.ts:2276-2296) asserts the hold right after the send, inside the 10 minutes.

**Fix:**

A seam render of Home with pending { maybeSent: true, submittedAt: now − 11 minutes, confirmations: null }: expect Send privately and Make public disabled, with home.busy.maybe's title. The same pending without maybeSent should leave them on.

**Known check:**

grep 'HOLD_MS|maybeSent' in docs/backlog.md and docs/archive/plans/: no record of this test.

### t1l#12 · low · The browser's Back pressing a disabled screen Back (a transaction being sent): no test fails without it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/history.ts:65`
- **Who:** user · **Since:** 8645072e (2026-10-06) · **Confidence:** confirmed-by-run

**Scenario:**

Loosen `if (top && !top.disabled())` at :65 to `if (top)`. The browser's Back (Alt+←, a mouse's back button) then runs a screen's own Back while that Back is disabled, as Screen disables it while a transaction is being sent (backDisabled={busy}). A review can then be left while its Send is in flight: the very press the disabled button refuses.

**Evidence:**

Mutant: `if (top && !top.disabled()) {` became `if (top) {`. No test imports history.ts directly. The 80 tests in its import closure: 1389 passed. The remaining source readers (16): 98 passed. e2e/extension.spec.ts:502-524 presses page.goBack() only on screens whose Back is on.

**Fix:**

In e2e's 'the browser's Back is the screen's own Back': hold a Send's answer (koios.submitAnswer pending), press Send, call page.goBack(), and expect the review still showing. Or in Vitest, with window and history stubbed: run useBrowserBack(onBack, true) through the seam's effects, fire the popstate listener, and expect onBack not called.

**Known check:**

grep 'useBrowserBack|history.ts|browser's Back' in docs/backlog.md: none. In docs/archive/plans/: usability-review.md and blind-task-usability-test.md:1257 cover the Back feature, not this test.

### t1l#13 · low · Stop offered on a mix card once its chain exists: no test fails without it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:862`
- **Who:** user · **Since:** ca56d4fb (2026-09-27) · **Confidence:** confirmed-by-run

**Scenario:**

Drop `!s.chain &&` from stoppable. A private mix whose chain is being sent, or is already on chain, then shows Stop on its card in Your mixes. The worker's stop() (sessions.ts:3409-3426) doesn't look at the chain: it marks the session stopping and steps it. What that does to a chain partway through wasn't traced here. The sibling at :865 (retryable) is pinned.

**Evidence:**

Mutant: `const stoppable = (s: SessionView) => !isOver(s) && !s.chain && !s.auto?.stopping;` became `const stoppable = (s: SessionView) => !isOver(s) && !s.auto?.stopping;`. lovejoin-hub.test.ts: 36 passed. 26 direct importers: 516 passed. Closure (32): 412 passed. lovejoin-hub.test.ts:290-301 renders a running mix with a chain, but reads it with toContain, which a Stop at the end doesn't break, and no test counts data-testid='lovejoin-mix-stop'. No e2e test presses a mix card's Stop. The retryable mutant fails lovejoin-hub.test.ts:279.

**Fix:**

In lovejoin-hub.test.ts's 'keeps a private mix's own stage once its chain is sent', expect count(markup, 'lovejoin-mix-stop') to be 0. In 'names a private mix by its session, with its stage and Stop while it runs', expect it to be 1.

**Known check:**

grep 'stoppable|mix-stop' in docs/backlog.md and docs/archive/plans/: none. The 'Stop.*chain' hits in the backlog (:55, :58, :61, :95) are other items.

### t1l#14 · low · Bring everything back refusing returns built more than 10 minutes ago: no test fails without it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:3363`
- **Who:** user · **Since:** 5cc61e55 (2026-09-25) · **Confidence:** confirmed-by-run

**Scenario:**

Delete :3363-3365. A Bring everything back review left open past BUILT_TTL_MS (10 minutes) then still sends its kept returns, one after another. With the check, all of them are refused before any goes: 'Those returns were built more than 10 minutes ago. Review them again.' Meanwhile a return's inputs may have moved: the node refuses that return, but the rest still go. The not-kept check just above (:3362) is pinned.

**Evidence:**

Mutant: `      if (chosen.some((c) => now() - c!.builtAt > BUILT_TTL_MS)) {\n        throw new Error(t("sess.claimTooOld"));\n      }` deleted. The 61 tests importing sessions.ts: 1186 passed. The rest of its closure with the source readers (57): 490 passed. The not-kept mutant (:3362) fails sessions.test.ts:1780 with a TypeError where 'aren't ready to send' is expected. Its siblings are pinned: script-spend.ts:394 by transfer.test.ts, move-in.ts:142 by move-in.test.ts.

**Fix:**

In sessions.test.ts's 'bring everything back returns each session that holds something…': after claimBuild, move t.clock on by 10 minutes and a second. Expect claimSubmit to reject with t('sess.claimTooOld'), and koios.submitted to stay empty.

**Known check:**

grep 'claimTooOld|more than 10 minutes ago' in docs/backlog.md and docs/archive/plans/: none.

### t1l#15 · low · Set collateral held on an empty account, or while Home holds a payment: no test fails without it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Collateral.tsx:265`
- **Who:** user · **Since:** 8c0d8c62 (2026-10-14) · **Confidence:** confirmed-by-run

**Scenario:**

(a) Drop `empty ? t("collateral.fundFirst") :`. Set collateral is then on for an empty public account, and the press reaches collateral-build, which has nothing to pay the 5 ₳ with. (b) Drop `blocked` instead. Set collateral is then pressable while Home holds a sent payment (Home.tsx:671 passes blocked while it watches), and it builds a payment beside the one on its way, which every other action waits for. WaitingFoot's own blocked is pinned (collateral-again-review-fixes.test.ts); this foot's isn't.

**Evidence:**

Two mutants of `const why = status.candidate ? undefined : empty ? t("collateral.fundFirst") : blocked;`. (a) became `const why = status.candidate ? undefined : blocked;`. (b) became `const why = status.candidate ? undefined : empty ? t("collateral.fundFirst") : undefined;`. Each run: collateral-again-review-fixes.test.ts (named) 5 passed. 2 other direct importers: 56 passed. Closure (60): 958 passed. No e2e test asserts Set collateral disabled: its presses (e2e/extension.spec.ts:1918, 1973, 1998, 2041, 3529) are all on funded accounts with nothing pending.

**Fix:**

In screens-wiring-review-fixes.test.ts's Collateral describe (:308-339): answer 'collateral' with a not-set status and 'balances' with an empty cardano side. Expect collateral-why to be t('collateral.fundFirst') and the button disabled. Then render a funded account with blocked set, and expect blocked's words and the button disabled.

**Known check:**

grep 'fundFirst|fund it first' in docs/backlog.md and docs/archive/plans/: none.

### t1l#16 · low · Make public's early stop on more than the private balance: no test fails without it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Withdraw.tsx:94`
- **Who:** user · **Since:** c3bc3930 (2026-09-25) · **Confidence:** confirmed-by-run

**Scenario:**

Set tooMuch at :94 to false. Make public of 900 ₳ from 800 ₳ spendable then keeps Review on and never says 'That's more than the 800 ₳ …'. The press reaches withdraw-build, which refuses the shortfall in words (withdraw.ts:110-115), so this is an early stop only. The lane found no test, and the run agrees.

**Evidence:**

Mutant: `const tooMuch = !maxed && amounts.total > BigInt(seedelf.lovelace);` became `const tooMuch = false;`. The 3 direct importers: 59 passed. Closure (41): 659 passed. e2e's 'That's more than the' checks are on Make private (:1660), tokens (:1704, :2596) and a swap (:2779), never Make public.

**Fix:**

In screens-wiring-review-fixes.test.ts, as its staked-key form tests do (:1189-1209): seed the To read, render Withdraw with `to` and amount '900', and expect withdraw.tooMuch's words, the submit disabled and no withdraw-build asked. Send privately's and Make private's twins are pinned only in e2e (:2431-2432, :1660-1661). Send publicly's twin is t1l#17.

**Known check:**

grep 'tooMuch' in docs/backlog.md and docs/archive/plans/: none.

### t1l#17 · low · Send publicly's early stop on more than the account can pay: no test fails without it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/CardanoSend.tsx:110`
- **Who:** user · **Since:** c3bc3930 (2026-09-25) · **Confidence:** confirmed-by-run

**Scenario:**

Set tooMuch at :110 to false. Send publicly of more than the account can pay (rewards included) then keeps Review on, without the moveIn.tooMuch line (:319-321). The press reaches send-build, whose builder refuses the shortfall, so this is an early stop only. The lane found no test.

**Evidence:**

Mutant: `const tooMuch = !maxed && amounts.total > BigInt(cardano.lovelace);` became `const tooMuch = false;`. The 3 direct importers: 56 passed. Closure (40): 653 passed. No e2e test asserts Send publicly's too-much line.

**Fix:**

Over the screens-wiring seam: seed the To read, render CardanoSend with an amount over cardano.lovelace, and expect moveIn.tooMuch's words under the amount and the submit disabled.

**Known check:**

grep 'tooMuch' in docs/backlog.md and docs/archive/plans/: none.

### t1l#18 · low · Make public's Max sending no token amounts, and its hidden token boxes not holding Review: no test fails without them

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Withdraw.tsx:128`
- **Who:** user · **Since:** c3bc3930 (2026-09-25) for :128; d423b79a (2026-10-05) for :89 · **Confidence:** confirmed-by-run

**Scenario:**

(a) Change :128 so the payment carries tokens.sent under Max too. Pick a token, type 1, then press Max, which hides the token box. Review then builds with that amount beside Max's null lovelace, and WebAssembly refuses: 'Max sends every token, so it takes no token amounts' (wasm/src/lib.rs:3403). The refusal is about a box the user can't see. (b) Count :89's token boxes under Max after all. Pick a token, leave its box empty and press Max: Review stays off, and the reason it gives is the hidden box.

**Evidence:**

Two mutants. (a) :128 `tokens: maxed ? [] : tokens.sent,` became `tokens: tokens.sent,`. (b) :89 `maxed ? list.drafts.map((d) => ({ ...d, tokens: {} })) : list.drafts, maxed);` became `list.drafts, maxed);`. Each run: 3 direct importers 59 passed. Closure (41): 659 passed. e2e/extension.spec.ts:2707-2713 checks that Max hides the token boxes, then turns Max off before Review.

**Fix:**

Over the screens-wiring seam: render Withdraw with picked { [key]: '1' }, Max seeded on and the To read seeded. Act the form's onSubmit and expect payloads('withdraw-build')[0].payments[0].tokens toEqual []. Then render with picked { [key]: '' } and Max on, and expect the submit enabled.

**Known check:**

grep 'Max sends every token' and 'withdraw-max' in docs/backlog.md and docs/archive/plans/: no record of these tests.

### t1l#19 · low · Send privately's Max turned off by Add recipient: no test fails without it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Transfer.tsx:379`
- **Who:** user · **Since:** 8de4dc64 (2026-10-06) · **Confidence:** confirmed-by-run

**Scenario:**

Delete setMax(false) from Add recipient (:378-381). Turn Max on, add a recipient, take it off again, and the form is back on Max, though the user never pressed it again. Also drop `&& !list.several` from :105, and Max stays on with several recipients. WebAssembly's transfer_plan then refuses: 'Max pays a single recipient: give each of several an amount' (wasm/src/lib.rs:3052; core build.rs:855). Send publicly's twin is pinned in e2e (e2e/extension.spec.ts:2372-2376).

**Evidence:**

Mutants: `onAdd={() => {\n          setMax(false);\n          list.add();\n        }}` became `onAdd={() => {\n          list.add();\n        }}`, run alone and again with `const maxed = max && !list.several;` changed to `const maxed = max;`. Each run: the 2 direct importers 54 passed. Closure (40): 653 passed.

**Fix:**

In e2e's 'several recipients: Send to a Seedelf pays two' (e2e/extension.spec.ts:2415): press Max before Add recipient and expect the chip gone. Once the second card is taken off, expect Max not pressed, as :2372-2376 does for Send publicly.

**Known check:**

grep 'setMax(false)' and 'Max pays a single recipient' in docs/backlog.md and docs/archive/plans/: none.

### t1l#20 · low · Start a pool's checks before Review (a quantity, the box's least and most, a copy, the classic 10 ₳): no test fails without them

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/LovejoinLaunch.tsx:153`
- **Who:** user · **Since:** 0affa5b4 (2026-10-18) · **Confidence:** confirmed-by-run

**Scenario:**

With `why` at :153 always undefined, Start a pool's Review is on for every bad case: a box under terms.least, a box over terms.most, a copy of a shown v2 pool, an ADA pool at the classic 10 ₳, or a token pool with no quantity. The press reaches lovejoin-launch-build, which checks them again (lovejoin-launch.ts:247-266, per lane E8a). So each refusal comes after the press instead of before it.

**Evidence:**

Mutant: `  const why = !terms\n    ? undefined` became `  const why = true\n    ? undefined`, removing all six checks at once. lovejoin-merged-review.test.ts (named): 41 passed. 3 direct importers: 54 passed. Closure (55): 869 passed. Since removing all six fails nothing, none is pinned on its own, so per-condition mutants weren't run. No e2e test opens Start a pool.

**Fix:**

A seam test of LovejoinLaunch: answer lovejoin-launch-terms with { least, most, suggested }. For each case (a box under least, a box over most, 10 ₳ with no token, a shown v2 pool's values, a token with no quantity), expect its lj.launch.* or lovejoin.launch.* line and Review disabled.

**Known check:**

grep 'lj.launch|needQuantity|classicCopy' in docs/backlog.md: none. docs/archive/plans/ hold the checks' origins (chunk-34) and no record of their tests.

### t1l#21 · low · A Bootstrap's count held to its most: no test fails without it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:3734`
- **Who:** user · **Since:** 8cc00445 (2026-10-19) · **Confidence:** confirmed-by-run

**Scenario:**

Change :3734 to drop the cap at most. The count is a number box with max={bootstrapMost} (:3442), but that doesn't stop anyone typing 200. The form then shows and sends 'Bootstrap the pool with 200 boxes' where one deposit takes 64, and the worker refuses it. The most itself is pinned (:3729-3730).

**Evidence:**

Mutant: `  const putting = Math.min(Math.max(asked ?? needed, 1), most);` became `  const putting = Math.max(asked ?? needed, 1);`. lovejoin-release-rules.test.ts (named): 18 passed. 26 direct importers: 534 passed. Closure (32): 412 passed. The :3729 and :3730 mutants fail lovejoin-release-rules.test.ts:482 and :484. e2e/extension.spec.ts:3583-3597 types 12, which is within the most.

**Fix:**

In lovejoin-release-rules.test.ts's bootstrapLimits cases: bootstrapLimits({ id: A, box }, 'public', ada(10_000_000_000n), undefined, 200).putting should be 64, and asked 0 should give 1.

**Known check:**

grep 'bootstrapLimits' in docs/backlog.md: none. In docs/archive/plans/: chunk-34-token-pools.md:1029 is about collateral, not this cap.

### t1l#22 · low · A private Bootstrap held where the balance holds too little of the pool's token: no test fails without it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:3736`
- **Who:** user · **Since:** 8cc00445 (2026-10-19) · **Confidence:** confirmed-by-run

**Scenario:**

Set tokenShort at :3736 to false. In a token pool, a Bootstrap of 30 boxes of 100 MIN from a private balance holding 500 MIN then has its button on, with no 'can't afford' line (:3477-3480). The build refuses for lack of the token, after the press. The ADA side (:3739) is pinned.

**Evidence:**

Mutant: `  const tokenShort = source === "private" && !!token && tokenBoxes(seedelf.tokens, token) < putting;` became `  const tokenShort = false;`. lovejoin-release-rules.test.ts (named): 18 passed. 26 direct importers: 534 passed. Closure (32): 412 passed. The :3739 mutant fails lovejoin-release-rules.test.ts:500. e2e's Bootstrap case (:3545-3598) is an ADA pool.

**Fix:**

In lovejoin-release-rules.test.ts: bootstrapLimits({ id: A, box: MIN_100, floor: 30, others: 0 }, 'private', { lovelace: plenty, tokens: [500 MIN] }, 96) should have tokenShort and short true. With 3,000 MIN, both should be false.

**Known check:**

grep 'bootstrapLimits|cantAffordToken' in docs/backlog.md and docs/archive/plans/: no record of this test.

### t1l#23 · low · Bring everything back leaving out a session that runs itself, or one holding nothing: no test fails without it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/ClaimAll.tsx:43`
- **Who:** user · **Since:** aaf2e068 (2026-10-13) · **Confidence:** confirmed-by-run

**Scenario:**

Drop `!s.auto &&` or `(s.holding?.utxos ?? 0) > 0` from isClaimable. The dApps page's card (Dapps.tsx:218) then offers Bring everything back for a swap that brings itself back, or for a session holding nothing. The worker's claimBuild skips each with its reason (sessions.ts:3330, :3336), so the review has nothing to send. The chain part is pinned (swap-page.test.ts:369).

**Evidence:**

Two mutants of `export const isClaimable = (s: SessionView) => s.stage === "open" && !s.auto && !chainGoing(s) && (s.holding?.utxos ?? 0) > 0;`: one without `!s.auto && `, one without ` && (s.holding?.utxos ?? 0) > 0`. Each run: swap-page.test.ts and restore-scan-lovejoin.test.ts (named) 27 passed. 4 other direct importers: 134 passed. Closure (38): 564 passed. e2e/extension.spec.ts:1017-1021 empties a found session's account, but that session ends there, so the stage check hides the card either way.

**Fix:**

In swap-page.test.ts beside :369, expect isClaimable to be false for an open session with auto set holding 1 UTxO, and false for an open session holding 0 UTxOs.

**Known check:**

grep 'isClaimable' in docs/backlog.md and docs/archive/plans/: none.

## Guards (117)

| Where | What it stops | Test |
|---|---|---|
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:862` | Stop on a mix card only before its chain exists (stoppable) | none |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:865` | Try again/Try now only where a retry or an unseen funding is (retryable) | tests/lovejoin-hub.test.ts:279 'names a private mix by its session, with its stage and Stop while it runs' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Withdraw.tsx:94` | Make public's Review held on more than the spendable private ADA (tooMuch) | none |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Withdraw.tsx:92` | Make public: a To read counts only for the exact text it read (readOf) | none (near-equivalent: see notes) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Withdraw.tsx:128` | Make public's Max sends no token amounts (tokens []) | none |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Withdraw.tsx:89` | Make public's Max: the token boxes it hides don't hold Review | none |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Transfer.tsx:379` | Send privately: Add recipient turns Max off | none |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Transfer.tsx:105` | Send privately: Max never with several recipients (with :379's mutant, maxed = max) | none |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/ClaimAll.tsx:100` | Bring everything back builds and signs its returns once, for the list it opened with | none |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:3362` | claimSubmit refuses returns not kept (all before any goes) | tests/sessions.test.ts:1780 'returns each session that holds something in its own transaction, and says why it left out the rest' |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:3363` | claimSubmit refuses returns built more than BUILT_TTL_MS ago | none |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Collateral.tsx:265` | Set collateral off on an empty public account (collateral.fundFirst) | none |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Collateral.tsx:265` | Set collateral off while Home holds a payment on its way (blocked) | none |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/Recipients.tsx:61` | heldFor: one token split across recipients can't add up to more than is held | e2e/extension.spec.ts:2386 'of 2,999,999,000' (traced, not run); no Vitest test fails |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/CardanoSend.tsx:110` | Send publicly's Review held on more than the account can pay (tooMuch) | none |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/format.ts:377` | unlocked(): locked UTxOs out of what a form may spend (all of it) | tests/review-totals-incoming.test.ts:72 'from a spendable side, as the dApps page, a site's session and the connect window give it' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/format.ts:382` | unlocked(): locked UTxOs' ADA out of what a form may spend | tests/review-totals-incoming.test.ts:72 (same test) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/format.ts:380` | unlocked(): locked UTxOs' tokens out of what a form may send | none |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Utxos.tsx:54` | lockable: no Lock toggle on a Seedelf's UTxO, the collateral or an unspendable UTxO (all three) | tests/ui-safety.test.ts:95 'marks a UTxO no payment can take, and says why on each side' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Utxos.tsx:54` | lockable: no Lock on an unspendable UTxO | tests/ui-safety.test.ts:95 (same test) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Utxos.tsx:54` | lockable: no Lock on a Seedelf's UTxO (the worker refuses too) | e2e/extension.spec.ts:1851 no Lock in a Seedelf UTxO's dialog (traced, not run); no Vitest test fails |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Utxos.tsx:54` | lockable: no Lock on the collateral (the worker refuses too) | e2e/extension.spec.ts:2052 no Lock in the collateral's dialog (traced, not run); no Vitest test fails |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/Destination.tsx:63` | Part of a Seedelf name refused with the name's rule, never read as an address | e2e/extension.spec.ts:2328-2329 the name rule for a 40-character name (traced, not run); no Vitest test fails |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/CardanoSend.tsx:96` | Send publicly: a To read counts only for the exact text it read (readOf) | none (near-equivalent: see notes) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/CardanoSend.tsx:338` | HandleWarning before an ADA Handle goes to a Seedelf from Send publicly | none |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/format.ts:405` | spentRewards: rewards payable only with the vote delegated to a DRep | e2e/extension.spec.ts:4734 no 'of rewards' with the vote undelegated (traced, not run); no Vitest test fails |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/format.ts:405` | spentRewards: rewards payable only when the user spends rewards (the setting) | e2e/extension.spec.ts:4774 no 'of rewards' with the setting off (traced, not run); no Vitest test fails |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/PhraseInput.tsx:91` | A pasted recovery phrase is cleared from the clipboard | none |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/history.ts:65` | The browser's Back never fires a disabled screen Back (a transaction being sent) | none |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Transfer.tsx:109` | Send privately's Review held on more than the private balance (tooMuch, several recipients too) | e2e/extension.spec.ts:2431-2432 Review disabled at 35 of 28 ₳ (traced, not run); no Vitest test fails |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/MoveIn.tsx:60` | Make private's Review held on more than the account can pay (tooMuch) | e2e/extension.spec.ts:1660-1661 move-in-too-much and Review disabled (traced, not run); no Vitest test fails |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/activity.ts:243` | exported: pending rows stay out of the CSV | tests/activity.test.ts:1139 'lists the payment the wallet sent before Koios does, pending, from what the device keeps' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/activity.ts:170` | csvCell: free text starting =, +, -, @, tab or CR gets a leading ' | tests/activity.test.ts:997 'never lets someone else's words run as a spreadsheet formula' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/activity.ts:230` | CSV note column marked free text (a stranger's note) | tests/activity.test.ts:1003 (same test) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/activity.ts:229` | CSV detail column marked free text | tests/activity.test.ts:1003 (same test) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/activity.ts:228` | CSV tokens column marked free text (a stranger's token name) | none |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/activity.ts:231` | CSV pool column marked free text (a pool's ticker) | none |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/activity.ts:232` | CSV DRep column marked free text (a DRep's name) | none |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/tokens.ts:116` | tokenText: an unlisted token named like ADA or a listed token goes by its fingerprint | tests/token-text.test.ts 'never lets one named ₳ or ADA read as ADA' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/tokens.ts:115` | tokenText: an unreadable or hidden-character name goes by its fingerprint | tests/token-text.test.ts:72 'never lets one named like a listed token read as it: its ticker, its name, or a lookalike' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/tokens.ts:67` | tokenDecimals: the wallet's list's decimals over Koios's | tests/token-text.test.ts:166 'takes the wallet's list's decimals over Koios's, then Koios's, then none' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/CardanoSend.tsx:165` | Send publicly's Total leaving: the active account's own address doesn't count as leaving | tests/screens-wiring-review-fixes.test.ts:1223 'Send's review warns, and counts the payment and its token as leaving, where the account's own address leaves the fee alone' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/CardanoSend.tsx:165` | Send publicly's Total leaving: a payment to another own account leaves | none |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/CardanoSend.tsx:170` | Send publicly's token count leaving: another own account's payment leaves | none |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:286` | boxesAffordable: the stepper keeps 5 ₳ collateral and 2 ₳ FEE_ROOM aside | tests/screens.test.ts:1325 'offers no more boxes than the private balance pays for, with the collateral and the fee aside' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:284` | boxesAffordable: each box costs its ADA and its mixes | tests/lovejoin-form-review-fixes.test.ts 'stops the stepper where the balance stops without the reserve, and counts it at each count that leaves room for it' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:318` | mixMost: no more boxes than the side's ADA or token pays | tests/lovejoin-held-balance.test.ts 'the public account's ADA too, which it never did' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:318` | mixMost: no more boxes than the pool's room | tests/lovejoin-held-balance.test.ts:74 'the token held, and the pool's room, and ten at most' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:229` | poolRoom: need = boxes × mixesPerBox × (width − 1) | tests/lovejoin-screens-review.test.ts:354 'stops at four's room where the pool is short for four, and names three's' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:261` | formRoom: the stepper capped at the pool's room (fits) | tests/lovejoin-screens-review.test.ts:354 (same test) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:364` | mixOffer: the collateral's reserve never caps or refuses a count | tests/lovejoin-form-review-fixes.test.ts 'offers the box the balance pays without the reserve, counting none in its figures and saying so; the reserve where it fits' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:334` | tailReserveOf: the form's totals count the collateral's reserve where its pool takes it | tests/lovejoin-form-review-fixes.test.ts:98 'while the 5 ₳ pool it names holds its floor, two of its boxes free, and takes new boxes, as the worker builds it' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:3729` | bootstrapLimits: one deposit's most (64 in a token pool) | tests/lovejoin-release-rules.test.ts:482 'caps every pool but the classic at a token deposit's 64, and the private side at what its reserve pays for' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:3730` | bootstrapLimits: the private side's reserves-paid most | tests/lovejoin-release-rules.test.ts:484 (same test) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:3734` | bootstrapLimits: the count held to its most (putting) | none |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:3736` | bootstrapLimits: short where the private balance holds too little of the token | none |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:3738` | bootstrapLimits: the reserves counted in what the private balance must hold | tests/lovejoin-release-rules.test.ts:500 'counts the funding's reserves, the deposit's and its way back's, in what the private balance must hold' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:3739` | bootstrapLimits: short where the private balance can't pay the boxes, reserves and fee | tests/lovejoin-release-rules.test.ts:500 (same test) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:1605` | Mix again from the public account off in a pool that takes no new box | tests/lovejoin-merged-screens.test.ts:147 'turns every Mix again off in a pool that takes no new box, saying why under them as Mix does' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:1616` | Mix again from the private balance off in a pool that takes no new box | tests/lovejoin-merged-screens.test.ts:147 (same test) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:1639` | Pay anyway off in a pool that takes no new box | tests/lovejoin-merged-screens.test.ts:147 (same test) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:1594` | Bring one back now hidden where every box is held or unmixed while mixing again is refused (nowRefused) | tests/lovejoin-merged-screens.test.ts:554 'never sends the user to Mix again where it's refused (SCREENS-3)' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:1630` | Bring one back now hidden in a stuck pool | tests/lovejoin-session5-screens.test.ts:188 'leaves both Mix again on there, and the words around them send the user to them' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:3167` | hatchTakes: the escape hatch offered only where a mixed unheld box exists | tests/lovejoin-merged-screens.test.ts:534 'brings a box not mixed yet back paid in a stuck pool, saying who pays first (SCREENS-1; the owner's call 36)' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:1105` | anywayRequest sends the payer its button named | tests/lovejoin-session5-screens.test.ts:319 'asks Bring it back anyway in a stuck pool with both payers, and elsewhere as before' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:1114` | heldRequest sends the payer its button named | tests/lovejoin-session5-screens.test.ts:301 'asks Bring one back of a Bootstrap's box in a stuck pool with both payers, and elsewhere as before' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:1119` | hatchRequest sends the payer its button named | tests/lovejoin-session5-screens.test.ts:277 'asks the escape hatch's question with both payers' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:3830` | lessReserve: 'For the boxes' leaves out the collateral's and the Bootstrap's reserves | tests/lovejoin-screens-review.test.ts:93 'says what returning the rest takes beside the boxes, and that what it doesn't use comes back' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:3830` | lessReserve: 'For the boxes' leaves out the Bootstrap's way-back reserve | tests/lovejoin-screens-review.test.ts:93 (same test) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:4012` | publicAfter: 'Public account after' counts the reward balance the first mix takes | tests/lovejoin-merged-screens.test.ts:277 'with what its first mix takes of its pool's reward balance, which its change brings in' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:2454` | clearable: a mix session in flight can't be cleared | tests/lovejoin-hub.test.ts:335 'offers Clear on each mix not in flight, and Clear all for them, never on one running or being sent' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:2455` | clearable: a chain being sent can't be cleared | tests/lovejoin-hub.test.ts:335 (same test) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/LovejoinLaunch.tsx:153` | Start a pool's checks before Review: no quantity, a box under the least or over the most, a copy, the classic 10 ₳ | none |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/LovejoinLaunch.tsx:455` | LaunchTotals: Total leaving = locked.total + fee | tests/lovejoin-merged-screens.test.ts:289 'on a pool's start paid from the public account, as from the private balance' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/LovejoinLaunch.tsx:456` | LaunchTotals: 'Private balance after' from Home's figure (homeBalance) | none |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/BringAllBack.tsx:110` | bringFollower drops a read sent before a press | tests/lovejoin-bring-screen-review-fixes.test.ts:89 'never says Done for the run the user stopped, though a read sent while Stop went answers with it still going' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/BringAllBack.tsx:137` | bringFollower drops a read sent while a press went | tests/lovejoin-bring-screen-review-fixes.test.ts:89 (same test) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Transfer.tsx:64` | handedOnAmount: Max isn't carried to the other form | tests/address-routes.test.ts:82 'hands on the amount typed, and nothing with Max on: never the figure the box kept under it' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Transfer.tsx:139` | Send privately pays the name looked up (f.seedelf.name) | none (near-equivalent: see notes) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Transfer.tsx:178` | Send privately's Total leaving: a payment to your own Seedelf comes back | none |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/StaleReview.tsx:111` | againOrForm: a stale review rebuilds only when the form is ready, else goes back to the form | tests/review-stale-form.test.ts:24 'builds the review again while the form can be built, and goes back to the form when it can't' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/RemoveSeedelf.tsx:186` | Remove a Seedelf: no default destination where another account paid or the payer is unknown | tests/minted-by.test.ts:261 'says on the account's card, as the note under it does, that another account paying ties the two accounts' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/RemoveSeedelf.tsx:197` | Remove a Seedelf: build refuses with no destination | none (equivalent: the submit is disabled without a destination, :282) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/ClaimAll.tsx:43` | isClaimable: not a session whose return's chain is being sent | tests/swap-page.test.ts:369 'reads its return's chain through Lovejoin as a site's page does: coming back while it's sent, then where it stopped' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/ClaimAll.tsx:43` | isClaimable: not a session that runs itself | none |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/ClaimAll.tsx:43` | isClaimable: not a session holding nothing | none |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Collateral.tsx:46` | lookAgain: the Collateral page opened in place asks only for the status, never taking Home's landing notice | tests/screens-wiring-review-fixes.test.ts:315 'opened in place, from Home or a pool's page, asks only for the status: Home's watch asks about the payment' |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/script-spend.ts:388` | script-spend send: only the review kept (its hash and network) | tests/minted-by.test.ts 'a mint that isn't the one built isn't kept' |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/script-spend.ts:394` | script-spend send: not a review older than BUILT_TTL_MS | tests/transfer.test.ts 'transfer refuses to send anything but the reviewed transaction' |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/script-spend.ts:405` | script-spend send: a payment's later parts gathered and checked before its first goes | tests/parts-send-review-fixes.test.ts 'refuses, sending nothing, a review whose later part spends what another of the wallet's transactions spent since' |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/script-spend.ts:410` | script-spend send: nothing spent since the review | tests/parts-send-review-fixes.test.ts (same test) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/script-spend.ts:410` | script-spend send: the later parts checked for spent-since too, before the first goes | tests/parts-send-review-fixes.test.ts (same test) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/script-spend.ts:436` | script-spend send: nothing a chain reserves | tests/parts-send-review-fixes.test.ts:780 'doesn't send a waiting part that spends what another chain of the wallet's reserved since' |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/script-spend.ts:438` | script-spend send: nothing a payment's later parts' reservation holds | tests/parts-send-review-fixes.test.ts 'refuses, sending nothing, a review whose later part spends what a chain being sent holds' |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/move-in.ts:135` | move-in submit: only the review kept | tests/move-in.test.ts 'move-in refuses to send anything but the reviewed transaction' |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/move-in.ts:142` | move-in submit: not a review older than 10 minutes | tests/move-in.test.ts (same test) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/coin-control.ts:254` | coin-control: the collateral kept out of spendable (lane's :205 is the pick by shape) | tests/coin-control.test.ts:56 'is the oldest pure 5 ₳ UTxO the account holds, kept out of every payment; the other 5 ₳ ones are spent' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/TokenAmounts.tsx:73` | tokenChoices: a token amount over what's held refused | tests/token-amounts-hidden.test.ts:20 'says what's left, and masks it while balances are hidden' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/TokenAmounts.tsx:66` | tokenChoices: a zero or empty token amount refused | e2e/extension.spec.ts:588-589 Review disabled with 'Give each token an amount, or take it off.' (traced, not run); no Vitest test fails |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/TokenAmounts.tsx:72` | tokenChoices: an amount it can't read (too many decimals, '1.2.3') refused | none |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/format.ts:168` | parseQuantity: a decimal comma ('12,5') read as the point, never 125 | tests/format.test.ts:136 'reads a comma as a thousands separator only where one belongs, and a decimal comma as the point' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/format.ts:169` | parseQuantity: misplaced commas, and anything but ASCII digits, a point and well-placed commas, refused | tests/format.test.ts:142 (same test) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/format.ts:170` | parseQuantity: more decimal places than the unit has refused | tests/format.test.ts:115 'reads typed ADA amounts exactly' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/format.ts:279` | sanitizeAmount: a Spanish d,ddd paste changes nothing and shows both readings | tests/lovejoin-launch-review-fixes.test.ts:136 'in Spanish, says both readings of a pasted '1,125' and changes nothing, for the token and the box's ADA' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/format.ts:281` | sanitizeAmount: a comma that doesn't group thousands refused, the previous value kept | tests/format.test.ts:223 'takes a comma typed or pasted as a thousands separator only where one belongs' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/format.ts:284` | sanitizeAmount: decimal places past the unit's dropped, never rounded | tests/format.test.ts:150 'keeps at most 6 decimals, dropping the rest rather than rounding' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/format.ts:292` | sanitizeAmount: more than the ADA supply or the token held keeps the previous value | tests/format.test.ts:186 'refuses more than the 45 billion ADA that exist' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/AdaInput.tsx:21` | lovelaceToSend: 0 ADA with no token isn't an amount | tests/payment-forms.test.ts:34 'names the first thing missing, in the form's own order' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/AdaInput.tsx:19` | lovelaceToSend: empty with tokens asks only the minimum | tests/payment-forms.test.ts:38 (same test) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/ReviewTotals.tsx:63` | ReviewTotals: '… after' = Home's figure less what leaves | tests/review-totals-incoming.test.ts:64 'reads Home's figure less what leaves, not 0 ₳' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/ReviewTotals.tsx:81` | homeBalance: what's on its way back counted | tests/review-totals-incoming.test.ts:72 'from a spendable side, as the dApps page, a site's session and the connect window give it' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/ReviewTotals.tsx:81` | homeBalance: what's locked counted | tests/review-totals-incoming.test.ts:72 (same test) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/ReviewTotals.tsx:100` | AfterRow: '… after' clamped at 0 | none |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Home.tsx:502` | Home holds every payment action while a sent transaction is watched (watching) | e2e/extension.spec.ts:2288-2292 Send publicly and Make private disabled with the maybe-sent title (traced, not run); no Vitest test fails |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Home.tsx:502` | Home's hold lasts past 10 minutes while a maybe-sent payment may land | none |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Home.tsx:529` | Make private and Send publicly held while watching (canMoveIn) | e2e/extension.spec.ts:2290 and :1743 Make private disabled while watching (traced, not run); no Vitest test fails |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/PendingBanner.tsx:302` | A maybe-sent payment's banner has no Dismiss | tests/maybe-sent.test.ts:544 'says plainly not to pay it again, that it may have gone through, and that sending it again is safe' |

## Checked and holds

- Lovejoin.tsx:865 retryable: caught by lovejoin-hub.test.ts:279. 'Try now' lands between the running line and Stop, so the card no longer reads '…being funded Stop'.
- sessions.ts:3362 claimSubmit, not-kept returns: caught by sessions.test.ts:1780. It throws a TypeError where 'aren't ready to send' is expected.
- format.ts:377 and :382 unlocked(), whole and ADA: caught by review-totals-incoming.test.ts:72 ('516000000' for '513000000').
- Utxos.tsx:54 lockable, its unspendable part and all three together: caught by ui-safety.test.ts:95, where the details dialog shows '>Lock<' for an unspendable UTxO. Its Seedelf and collateral parts are pinned only by e2e (e2e/extension.spec.ts:1851 and :2052, traced, not run), and the worker refuses both too (coin-control.ts:340-341).
- activity.ts:243 exported: caught by activity.test.ts:1139, where the pending payment's hash shows up in the CSV. The lane's e2e (:1615) wouldn't catch it: no row is pending there.
- activity.ts:170 csvCell: caught by activity.test.ts:997 ('=HYPERLINK(1)' left unquoted). The note column's flag (:230) and the detail column's (:229) are caught by activity.test.ts:1003.
- tokens.ts:116 lookalike and :115 unreadable: caught by token-text.test.ts ('never lets one named ₳ or ADA read as ADA', with label '₳' where the fingerprint was expected; and :72). tokens.ts:67 tokenDecimals: caught by token-text.test.ts:166 (0 for 6).
- CardanoSend.tsx:165, the active account's own address not leaving: caught by screens-wiring-review-fixes.test.ts:1223 ('5.2 ₳' for '0.2 ₳').
- Lovejoin.tsx:286 boxesAffordable's aside: caught by screens.test.ts:1325 (1 box where 0 was expected). Its mixes part (:284): caught by lovejoin-form-review-fixes.test.ts ('stops the stepper where the balance stops without the reserve…').
- Lovejoin.tsx:318 mixMost: the ADA cap is caught by lovejoin-held-balance.test.ts ('the public account's ADA too'), the room cap by :74 (10 for 2).
- Lovejoin.tsx:229 poolRoom and :261 formRoom: caught by lovejoin-screens-review.test.ts:354 ({most: 7, three: 9} and {most: 10} where {most: 2, three: 4} was expected).
- Lovejoin.tsx:364 mixOffer (the reserve never caps): caught by lovejoin-form-review-fixes.test.ts (adaMost 0 for 1). :334 tailReserveOf: caught by lovejoin-form-review-fixes.test.ts:98 (0n for 1500000n).
- Lovejoin.tsx bootstrapLimits: :3729 is caught by lovejoin-release-rules.test.ts:482 (96 for 64), :3730 by :484 (96 for 53), and :3738 and :3739 by :500 (short false where true was expected).
- Lovejoin.tsx:1605, :1616 and :1639 (Mix again on both sides, and Pay anyway, off where the pool takes no new box): each caught by lovejoin-merged-screens.test.ts:147 (no disabled attribute). :1594 nowRefused: caught by lovejoin-merged-screens.test.ts:554. :1630 (the stuck pool): caught by lovejoin-session5-screens.test.ts:188 (lovejoin-now offered).
- Lovejoin.tsx:3167 hatchTakes: caught by lovejoin-merged-screens.test.ts:534 (lovejoin-paid offered with no mixed box).
- Lovejoin.tsx:1105, :1114 and :1119, the payer sent with anyway, held and hatch requests: caught by lovejoin-session5-screens.test.ts:319, :301 and :277 (requests without paid).
- Lovejoin.tsx:3830 lessReserve, both reserves: caught by lovejoin-screens-review.test.ts:93 (the 'For the boxes' row counts the reserve twice). :4012 publicAfter: caught by lovejoin-merged-screens.test.ts:277.
- Lovejoin.tsx:2454 and :2455 clearable: caught by lovejoin-hub.test.ts:335 (session.4 or p1 clearable while in flight).
- LovejoinLaunch.tsx:455 LaunchTotals' fee: caught by lovejoin-merged-screens.test.ts:289.
- BringAllBack.tsx:110 and :137 bringFollower: caught by lovejoin-bring-screen-review-fixes.test.ts:89 (Done [3] said for a stopped run).
- Transfer.tsx:64 handedOnAmount: caught by address-routes.test.ts:82 ('12' for '').
- StaleReview.tsx:111 againOrForm: caught by review-stale-form.test.ts:24 (['build','build'] where ['build','form'] was expected).
- RemoveSeedelf.tsx:186, no default where another account paid: caught by minted-by.test.ts:261 (the account card checked).
- ClaimAll.tsx:43 isClaimable's chainGoing part: caught by swap-page.test.ts:369.
- Collateral.tsx:46 lookAgain in place: caught by screens-wiring-review-fixes.test.ts:315, which sees pending-tx asked in place. The lane named collateral-again-review-fixes instead.
- script-spend.ts send: :388 (the review kept) is caught by minted-by.test.ts ('a mint that isn't the one built isn't kept') and :394 (too old) by transfer.test.ts ('refuses to send anything but the reviewed transaction'), both only at the import-closure stage, never by the lane's payment-parts tests. :405, :410 (both mutants) and :438 are caught by parts-send-review-fixes.test.ts; :436 by its :780.
- move-in.ts:135 and :142: both caught by move-in.test.ts ('refuses to send anything but the reviewed transaction').
- coin-control.ts:254, the collateral kept out of spendable: caught by coin-control.test.ts:56 (12 spendable where 11 were expected). The lane cited :205.
- TokenAmounts.tsx:73, over held: caught by token-amounts-hidden.test.ts:20. :66, zero or empty: pinned only by e2e (e2e/extension.spec.ts:588-589, traced, not run). Under the mutant the review-wait line goes once the read lands.
- format.ts parseQuantity: :168 is caught by format.test.ts:136, :169 by :142 and :170 by :115. sanitizeAmount: :279 is caught by lovejoin-launch-review-fixes.test.ts:136, :281 by format.test.ts:223, :284 by :150 and :292 by :186.
- AdaInput.tsx:21 and :19 lovelaceToSend: caught by payment-forms.test.ts:34 and :38.
- ReviewTotals.tsx:63 (after less leaving): caught by review-totals-incoming.test.ts:64. Both homeBalance parts (:81) are caught by its :72.
- PendingBanner.tsx:302, no Dismiss on a maybe-sent payment: caught by maybe-sent.test.ts:544 (Dismiss shown).
- Pinned only by CI's e2e job, each assertion traced against its mutant but not run. Recipients.tsx:61 heldFor (e2e/extension.spec.ts:2386 'of 2,999,999,000'). Destination.tsx:63 partial names (:2328-2329: resolveDestination would answer 'isn't a Cardano address'). format.ts:405 spentRewards, both parts (:4734 with the vote undelegated, :4774 with the setting off). Transfer.tsx:109 (:2431-2432 Review disabled). MoveIn.tsx:60 (:1660-1661). Home.tsx:502 watching (:2288-2292 disabled with the maybe-sent title). Home.tsx:529 canMoveIn (:2290, :1743). No Vitest test fails for any of them.
- TREE was never written: git status shows 0 tracked changes. Each copy's file was restored from TREE and compared byte for byte after every stage, and all four copies matched TREE's src when the last run ended.

## Notes

- Method: four copies of seedelf-platform/, rsynced from TREE, with node_modules symlinked to TREE's. The verifiers' 38 untracked r51-* tests were moved out of each copy before any run, so every result is the committed suite's. Each mutant was checked against TREE before it was applied. Tests then ran in up to three stages, stopping at the first failure: (1) the lanes' named tests; (2) the other tests importing the module directly; (3) the rest of the tests whose static import closure reaches the module, plus the 28 tests that read source files as text. Every run: `systemd-run --user --scope -q -p MemoryMax=6G -p MemorySwapMax=0 timeout 40m npx vitest run --maxWorkers=3 --testTimeout=300000 --hookTimeout=300000 --bail=1 --reporter=json`. The copies are removed (no CARGO_TARGET_DIR was used: there were no Rust guards).
- Departures from the given commands, said plainly. `nice -n 10` (given for cargo) starved Vitest at load ~70: workers got ~13% of a core, and one 27-file stage ran past 10 minutes. So the Vitest runs went without it, as the brief's TypeScript command has it. A full-suite baseline was started and then stopped: under that load the default 5 s test timeout failed tests (11 in the first ~380), hence the 300 s timeout. Instead of a baseline, every catch in checked_ok was checked to be an assertion on the mutated value (the expected/actual pairs quoted), not a timeout or a flake.
- Pinned only by e2e, for the owner. Eleven mutants are caught only by CI's Playwright job (traced, not run; see checked_ok): heldFor, the partial-name rule, spentRewards ×2, Send privately's and Make private's tooMuch, Home's watching and canMoveIn, lockable's Seedelf and collateral parts, and the zero token amount. They hold, but only in the slow job; a Vitest twin would catch a revert in seconds. Lane E8b named e2e for Transfer.tsx:109 and MoveIn.tsx:60, and those traces agree. Lane E9a's e2e for activity.ts:243 (e2e/extension.spec.ts:1615) would not catch its mutant, but activity.test.ts:1139 does.
- Near-equivalent mutants, put here rather than among the findings because no reachable state shows them. (1) Withdraw.tsx:92 and CardanoSend.tsx:96 readOf's exact-text check: DestinationInput reports {to, read} on every change of its text (Destination.tsx:112), so the record's text matches the field's outside a single render, and the build sends draft.to, which the worker resolves again (destination.ts:41-71). (2) Transfer.tsx:139 pays f.seedelf.name: `found` follows the field's normalized name (Transfer.tsx:436-450), and transfer.ts:186-187 normalizes draft.to the same way, so either pays the same Seedelf. (3) RemoveSeedelf.tsx:197's `!to`: the submit is disabled without a destination (:282), and implicit submission doesn't fire on a disabled default button.
- A doubt, too thin for a finding. DestinationInput's report effect runs in the same flush as useDestination's setRead({ state: 'reading' }) (Destination.tsx:56-60, then :112). So the first report after an edit pairs the new text with the previous read, and for one render readOf's text check counts the old read for the new text. A person can't press inside that render in practice, and the build pays the new text.
- Line corrections against the lanes, at cd764fba (src is unchanged at TREE's c8782f0e). E8b's coin-control.ts:205 guard is the filter at :254 (:205 is collateralOf's pick by shape). E8b's sessions.ts:3360 is :3362 (not kept) and :3363 (too old). E9a's Recipients.tsx:53 is :61. TokenAmounts.tsx's parts: zero :66, unreadable :72, over held :73. format.ts:376 is :377/:380/:382. activity.ts:166/:177 are csvCell at :170 and the column flags at :228-232. E8a's Lovejoin.tsx lines: 226→229, 278→284/286, 301→318, 329→334, 352→364, 3721→3729-3739, 3829→3830, 4011→4012, 1103→1105, 1113→1114. LovejoinLaunch.tsx:446→455-456, PendingBanner.tsx:297→302, tokens.ts:66→67, BringAllBack.tsx:107→110 and :137, StaleReview.tsx:117→111, Collateral.tsx:45→46.
- Where the catching test wasn't the lane's named test: script-spend.ts:388 and :394 (minted-by.test.ts, transfer.test.ts); Collateral.tsx:46 (screens-wiring-review-fixes.test.ts:315); Lovejoin.tsx:284, :1630, :3830 and :4012 (other screen tests, at the direct-importer stage). Transfer.tsx:178's named review-totals-incoming.test.ts doesn't render Transfer at all (t1l#3).
- privacy-review.md:944 lists 'a paste clears the clipboard' among the recovery phrase's protections. t1l#7 is that line's only test gap, and the one finding here that touches a secret.
- Severity: every finding is low per this lens (a test gap). Under the T1 rule, none needs the owner: each fix is a test only.

## Coverage

I tried all 63 guard entries in E8a (15), E8b (19), E9a (16) and E9b (13). Merging duplicates left 59 distinct guards: E9a and E9b share format.ts unlocked() and activity.ts csvCell, and E9a's format.ts:166 and :288 are E9b's :168-170 and :279-292 sites. These ran as 117 mutants: one per site or condition, plus Send privately's Max tried alone and combined with :105. Each ran its three stages unless caught earlier. Order: first the guards with no named test or only an e2e one, then those on a stranger's or a site's input, then the rest. Not done: (1) Playwright isn't run by this lens, so the 11 e2e-only pins are traced, not run. (2) Per-condition mutants of Start a pool's six checks: removing all six at once fails nothing, so none can be pinned alone. (3) No Rust guards fell in these lanes, so there was no cargo build and no WebAssembly limit to hit. Stage 3 covers every committed test that can statically import the module, plus every test that reads source text. A test that reaches the code some other way would be missed; none was found. Results: 72 mutants caught by Vitest, 11 caught only by e2e (traced), 4 near-equivalent (notes), and 30 uncaught, reported as 23 findings with parts of one guard merged.
