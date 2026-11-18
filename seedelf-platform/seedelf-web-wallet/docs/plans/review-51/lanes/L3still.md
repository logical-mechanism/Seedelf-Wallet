# Lane L3still

Returned by the workflow's agent `a189082c7e10d0012`, written here by the lead from its structured answer.

## Findings (5)

### l3still#1 · low · r2still#2's one-run wait shows a filled swap as still filling: the private-swap e2e fails on both builds, and Stop is offered after the fill

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:3986`
- **Who:** user · **Since:** ad8c3ce4 · **Confidence:** confirmed-by-run

**Scenario:**

A private swap's order fills. The runner run that first reads every order spent (the alarm's, the page's poll or Refresh) now only records auto.spentSeen and returns. Until the next run, the view stays at step "filling" with filled false. With the page open, that next run is the page's 20 s poll, gated at 15 s. Without the page, it's the alarm's minute. Meanwhile the page says "Waiting for the order to fill. Then it all comes back by itself; Stop cancels it." and still offers Stop. Stop's dialog then speaks of cancelling an order that's gone, which is what stoppable's DX-5 rule is there to prevent. The e2e 'a private swap: Minswap's quote, a one-time account funded, and then it runs itself: the order, the fill, everything back' presses Refresh once after the fill and expects 'Coming back into your private balance'. It fails on both the dev build and the store build in the lead's final checks at ad8c3ce4, so CI's e2e job goes red. Nothing is lost: the return comes one run later.

**Evidence:**

- sessions.ts:3986-3991 (HEAD): `if (auto.spentSeen === undefined) { await this.update(network, s.index, (r) => { r.auto!.spentSeen = now(); }); return; }`.
- autoView, sessions.ts:6733-6745: step is "filling" while the swap is confirmed with no back or deposit, and filled = !!auto.filled, so false.
- Swaps.tsx:325-330: `stoppable` is `!a.stopping && !a.filled && !a.refunded && !a.againstPools && (… || a.step === "filling")`. Its doc: once filled, 'Stop's dialog would speak of cancelling an order that's gone (chunk 23's second review, DX-5)'.
- ad8c3ce4's own unit test, sessions.test.ts:800-803, expects `{ step: "filling", filled: false }` after that run.
- e2e/extension.spec.ts:2947-2948 (not touched by ad8c3ce4): one `Refresh` click, then `toContainText("Coming back into your private balance")`.
- The lead's final checks, in SCRATCH final/:
  - ext-summary.txt: `e2e-dev exit 1  1 failed  1 skipped  108 passed` and `e2e-store exit 1  1 failed  1 skipped  108 passed`.
  - ext-e2e-dev.log:123-128 and ext-e2e-store.log:121-128: `Expected substring: "Coming back into your private balance" Received string: "Waiting for the order to fill. Then it all comes back by itself; Stop cancels it."`.
  - Round one's run had 6 e2e failures; this is the one left, and its text is the spentSeen state.
- .github/workflows/web-wallet.yml: the e2e job runs `npm run e2e` (line 240 and on).
- Refresh is advance(now=true), an 'asked' run, which skips step's READ_EVERY_MS gate (sessions.ts:3738), so a second click would go on. The page's own poll is advance(false) every ADVANCE_EVERY_MS = 20 s (Swaps.tsx:2108); READ_EVERY_MS is 15 s (sessions.ts:254).

**Fix:**

- Make the e2e take the extra run, as the unit tests' `pastSpent` does: press Refresh a second time, or wait for the next run.
- Show a noted fill as seen: let autoView carry spentSeen, have `stoppable` return false while it's set, and have the line say the fill is being read, not waited for.
- Clear spentSeen when liveOrders finds an order open again (a rollback).
- See notes: if the wait is meant to give a lagging backend time, hold asked runs too.

**Known check:**

- Searched review-51's RESUME.md, FINDINGS.md, INDEX.md, owner-calls.md, LIVE.md and fix-branches.md for spentSeen, 'Coming back into your private balance', the e2e's title and extension.spec.ts:2748. No hit. The failure is only in the scratchpad's final/ext-e2e-*.log.
- DX-5 (archive/plans/usability-review.md:628) is the rule this reopens for one run.

### l3still#2 · low · r2still#2's landedAfter cutoff takes a stranger's payment made while the swap's own return chain is being sent for the swap's own: its 'Lovejoin was left out' replaces how the swap came back (e2b#2 reopened)

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4728`
- **Who:** stranger · **Since:** ad8c3ce4 · **Confidence:** confirmed-by-run

**Scenario:**

A swap comes back through Lovejoin, the default.
1. Its chain is built from one listing, and its deposit is sent.
2. With the collateral's mix on (the default), that mix waits for giveme.my, which signs only once every transaction before it is on chain. The return goes after the mix, so a block or more after the deposit. The return's `at` is when it is sent.
3. A stranger watching the session's account pays it 2 ₳ as the deposit appears. The account's address is on chain since the funding.
4. That UTxO isn't in the chain and lands before the return goes. So `u.block_time * 1000 > firstBack.at` is false, and the next return, of the stranger's 2 ₳ alone, isn't marked `strangers`.
5. That return goes directly with 'its spare ADA is too little for a box', and sendBack writes this into the session's lovejoinSkipped.
6. The finished swap's page says 'Directly: Lovejoin was left out', with that reason, though its own return went through Lovejoin.

This is e2b#2's harm, words only. It contradicts flows.md:478's new sentence (r2docs#1). The other direction, r2tests#9's 'nor clears': a stranger's chain return clears a direct own return's 'left out' word when the payment landed while that return was built (seconds). A device clock ahead of the chain widens both windows by its skew, since `at` is the device's clock.

**Evidence:**

Code at HEAD:
- sessions.ts:4727-4735: `const firstBack = record?.txs.find((t) => t.kind === "back" && !t.unsent && !t.replaced); const landedAfter = (u: KoiosUtxo) => typeof u.block_time !== "number" || u.block_time * 1000 > firstBack!.at;` … `rows.every((u) => !own.includes(u.tx_hash) && !fills.has(u.tx_hash) && landedAfter(u)) ? { strangers: true } : {}`.
- Each chain transaction is recorded with `at: now()` as it's sent: sessions.ts:5735-5738, from sendStep. The return is last.
- lovejoin.ts:509-534, pumpChain: a transaction giveme.my witnesses waits until nothing is in flight (`if (chain.flying.length) break;`).
- sendBack, sessions.ts:5265-5269: `const skipped = built.strangers ? undefined : built.lovejoinSkipped; … if (skipped && !s.mix) s.lovejoinSkipped = skipped;`.
- Swaps.tsx:3106: `if (s.lovejoinSkipped) return t("swaps.step.directLeftOut");`.
- ad8c3ce4 moved e2b#2's stranger in swap-page.test.ts:202 to `block_time: … + 60`. atSession's default block_time is the test clock's own second, so the e2b#2 tests would have read that stranger as the swap's own.

Run: SCRATCH/r51/work/L3still/mirror/seedelf-platform/seedelf-web-wallet/extension/tests/l3still-strangers-chain.test.ts, in a scratch copy of the extension.
- It is swap-page.test.ts's 'never says Lovejoin was left out of its return, which went through Lovejoin…' test, with two changes. Koios's submittx moves the clock 20 s per transaction. The stranger's 2 ₳ has block_time = the deposit's at + 5 s, which is 35 s before the return went. A control puts it 60 s after the return.
- Command: `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 15m nice -n 10 npx vitest run tests/l3still-strangers-chain.test.ts`.
- HEAD (ad8c3ce4):
  - `deposit at 1800000000000 back at 1800000040000 chain [out, swap, deposit, mix, back]`
  - control: `lovejoinSkipped: undefined | page says left out: false`
  - during the chain: `lovejoinSkipped: "its spare ADA is too little for a box" | page says left out: true`
  - Both expectations pass: the second asserts the regression.
- 76c1df4b, ad8c3ce4's parent (git archive; pastSpent replaced by one advance): during the chain, `lovejoinSkipped: undefined | page says left out: false`, and the regression's expectation fails (`expected undefined to be defined`).

**Fix:**

- Cut at when the swap's own first return was built, not when its last transaction went. Use the time, or better the block, of the listing that return was built from (KeptBack's builtAt), or the first transaction of that return (the chain's deposit).
- Compare by block height where possible, which avoids the device's clock.
- sendChain's `if (strangers) return;` takes the same rule.
- Test: the probe's 'during the chain' case must read strangers, with r2still#2's two late-leg tests still passing.

**Known check:**

- verify/r2still-2.md:90 proposed this rule ('block_time * 1000 later than that back's at'), without considering that a chain's return goes a block or more after its build. e2b#2's verify and the swap-page.test.ts e2b#2 tests cover only a stranger paying a minute after the return.
- Searched backlog.md and archive/plans for strangers, lovejoinSkipped and late leg: nothing on this cutoff.

### l3still#3 · nit · The swap's last step says 'Directly: Lovejoin was left out' while it links the first return, which went through Lovejoin, once a later return of its own came back directly (r2docs#1 meets r2still#2)

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx:3106`
- **Who:** nobody · **Since:** ad8c3ce4 · **Confidence:** confirmed-by-run

**Scenario:**

r2still#2's late leg is one no listing held until the first return, a chain through Lovejoin, had gone (its own test: lovejoin-planner.test.ts 'comes back alone after it, directly…'). Since ad8c3ce4 that leg is the swap's own, not a stranger's, so its direct return sets lovejoinSkipped. backStepText reads lovejoinSkipped before anything else. The last step therefore says 'Directly: Lovejoin was left out' while it links the first return (ownReturnAt), the chain's own, which went through Lovejoin. flows.md:478 (7b6881f7) says the last step 'links the swap's own return, its first, and says how that came back: a later one never takes its place there, nor a chain sent after it, nor why Lovejoin was left out of it.' The warning itself is true for the late leg; it's the step's words for the linked return that are wrong.

**Evidence:**

- Swaps.tsx:3106: `if (s.lovejoinSkipped) return t("swaps.step.directLeftOut");` comes before r2docs#1's ownReturnAt logic (:3107-3112).
- Swaps.tsx:3125: `ownReturnAt` is the first back.
- Run: SCRATCH/r51/work/L3still/mirror/seedelf-platform/seedelf-web-wallet/extension/tests/l3still-last-step.test.ts renders Session for the view r2still#2's second test ends in: txs out, swap, deposit, mix, back b1, back b2; the chain 3/3 sent; lovejoinSkipped = sess.skip.warn.noCollateral.
- Output: `l3still last step: "Directly: Lovejoin was left out" links b1b1`. The step links b1, the Lovejoin return. 1 passed.

**Fix:**

Make backStepText speak for the return it links:
- through Lovejoin when a deposit or mix comes before ownReturnAt;
- the skip reason only when it belongs to that return. Record which return set lovejoinSkipped, or keep a later own return's reason as a line of its own.

Or say in flows.md:478 that a later return of the swap's own sets the step's words.

**Known check:**

Searched review-51 (INDEX, FINDINGS, owner-calls) and flows.md for directLeftOut and backStepText. r2docs#1's fix records only the stranger's case; the late leg's interplay isn't recorded.

### l3still#4 · low · r2screens#1 is fixed only in part: the swap form and Send privately's too-much line still call the unlocked side 'your private balance', with nothing about the lock

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx:1152`
- **Who:** user · **Since:** unknown (predates chunk 51; left by 61a4d717) · **Confidence:** traced

**Scenario:**

The private balance is 100 ₳, with a 60 ₳ UTxO locked on the UTxOs screen. Swaps gets Home's unlocked side. The swap form then shows:
- the held figure, 40 ₳, under the title 'In your private balance';
- with 50 ₳ typed, 'That's more than the 40 ₳ in your private balance.';
- when its funding is short, 'Your private balance has 40 ₳.'

Nothing on the form mentions the lock. Send privately's too-much note says 'That's more than the 40 ₳ in your private balance.' too, though its aside already says 'available · locked'.

These are two of the four members of r2screens#1's class that its verifier named (verify/r2screens-1.md:109-112). 61a4d717 fixed the other two, the connect window and the top-up form, which now say '40 ₳ available · 60 ₳ locked'.

**Evidence:**

- Home.tsx:753 passes `seedelf={free.seedelf}` (Home.tsx:518-521, `unlocked(balances.seedelf)`) to Dapps, and Dapps.tsx:206 passes it to Swaps.
- Swaps.tsx:730: `const held = heldOf(seedelf, pay.id)`.
- Swaps.tsx:1130: `tr("swaps.tooMuch", { held: … })`.
- Swaps.tsx:1152-1156: `tr("swaps.short", { …, held: amounts.ada(seedelf.lovelace) })`.
- Swaps.tsx:1081, :1119 and :1966: the title or heading `swaps.inPrivate`.
- `grep locked Swaps.tsx`: no mention of locked UTxOs.
- en.json:2354 'In your private balance'; :2510 '… Your private balance has {{held}} ₳.'; :2594 "That's more than the {{held}} in your private balance."
- Transfer.tsx:356: `t("transfer.tooMuch", { amount: shown.ada(seedelf.lovelace) })`, with en.json:2703 "That's more than the {{amount}} ₳ in your private balance."
- 61a4d717 changed only DappApprovals.tsx's ConnectRequest and SiteSessions.tsx's TopUp. Its status note: 'sibling fixed: a session's top-up form'.

**Fix:**

As 61a4d717 did for the connect window and top-up:
- When `seedelf.locked.utxos`, say 'available' plus lockedAside.
- Use withdraw.tooMuch with `available: t(locked ? "withdraw.available" : "withdraw.inPrivate")` for swaps.tooMuch and transfer.tooMuch.
- Give swaps.short and the held title or heading an 'available' form.

Keep amounts.ada on every figure (HM-9).

**Known check:**

verify/r2screens-1.md:77 and :109-112 name these siblings. FINDINGS.md:223 records r2screens#1 as fixed by 61a4d717 with no left-over line, and owner-calls.md doesn't mention them. Searched backlog.md and archive/plans for 'in your private balance' and swaps.short: nothing.

### l3still#5 · low · r2sign#3's class is fixed only in part: a session's return review shows a token off the wallet's list in raw units

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/SiteSessions.tsx:282`
- **Who:** user · **Since:** unknown (predates chunk 51) · **Confidence:** traced

**Scenario:**

A site's private session holds 1,000,000 raw units of a token off the wallet's list, which Koios reports with 6 decimals: bought through the session on a DEX site, or paid to its account by anyone. Bring it back's review lists that token as '1,000,000 X'. Home shows '1 X' once it lands.

The swap page does the same for any token at its account other than the swap's own tokenOut, a stranger's for instance, in two places:
- its return review;
- its 'Received' row.

This is e9a#2's class, which r2sign#3's verifier described as 'a token list made from WebAssembly's TokenAmount, which has no decimals, shown with no held fallback'. 61a4d717 and e4d97bea fixed four members: Remove's review, Remove's Transaction details, the dApp funding's row and the top-up review. Session returns weren't among them.

**Evidence:**

- SiteSessions.tsx:281-282: `{back.tokens.map((t) => (<TokenAmountRow … amount={tokenQuantity(network, t)} />))}`.
- tokens.ts:66-67: tokenDecimals is `tokenInfo(network, t)?.decimals ?? t.decimals ?? 0`.
- back.tokens comes from WebAssembly through backBuild (sessions.ts:5270 `summary: { …, tokens: built.tokens, … }`) and carries no decimals. sessions.ts sets decimals nowhere but Minswap's token search (:1629).
- Swaps.tsx:2339-2340 (the return review) and :2429 (Received) use heldText (Swaps.tsx:3026-3030), which adds decimals only for `s.swap.tokenOut`.
- verify/r2sign-3.md:84-88 names the class: 'One worker helper that gives a summary's tokens their decimals from one decimalsOf map would cover the whole class.'

**Fix:**

In buildBack, give each return summary token the decimals its account rows carry, `decimalsOf(rows)` (balances.ts, exported by e4d97bea), as e4d97bea does for Remove. The swap's 'Received' (brought) and the return's Transaction details then follow.

**Known check:**

FINDINGS.md:184 and :216 (r2sign#3, e9a#2) list only their own screens. verify/r2sign-3.md:84-88 named Remove's Transaction details and PaidRows's callers, all fixed. Searched backlog.md and archive/plans for 'raw units' and decimals: only blind-task-usability-test.md:1933, which is about Activity.

## Checked and holds

- r2time#1 holds at HEAD. With `payer` not passed to withdrawOne (in a scratch copy), lovejoin-release-rules.test.ts 'pays from the account it was pressed on…' fails (1 failed); unmutated it passes. readAccount and coins.account take the account (account.ts:191-198, coin-control.ts:261-266).
- r2time#2 holds at each writer. Each pin removed in turn in a scratch copy, and each mutant fails its test:
- activity.update's two checks: lovejoin-withdraw-submit 'none of it in the other phrase's history';
- lovejoin.update's two checks: lovejoin-withdraw-submit r2time#2;
- sessions save's turnPin: remove-wallet 'writes none of the first phrase's sessions into the other's book';
- submitWatched's `pinned`: remove-wallet 'goes into nothing of that phrase's'.

All pass unmutated. No sessions turn awaits save inside a wallet key turn, so the new withKeys(turnPin) can't deadlock (sessions.ts:5658 and :5793, the only async key turns, write no book).
- t1i#6 (origin, network, age), t1i#7 (ours, age) and t1l#14 still pinned after ad8c3ce4's sessions.ts changes: each guard reverted in a scratch copy fails its e66a6a16 test (sessions-sent-twice, session-top-up-again, sessions.test.ts 'sends none of the returns its review built more than 10 minutes before').
- e66a6a16's four sibling checks still pinned: the mix funding's age and network (lovejoin-planner), the swap funding's age (sessions.test.ts), Review it myself's age and kind (order-cancel-check), and a kept return's age and network (sessions.test.ts). Each mutant fails 1 test.
- gap-g6#2 holds. rejudge made a no-op in a scratch copy fails 2 of lovejoin-accounts.test.ts's 3 gap-g6#2 tests; unmutated, 3 pass. ad8c3ce4's pin in lookUp shares rejudge's origins turn without changing it.
- r2sign#1 holds:
- cip30.rs inspect reads 'hash' for any output keeping its datum by hash, carried or not (cip30.rs:1295-1312).
- chain.ts registerOf and koios register_of_datum take `102([_ 0, [g, u]])`.
- SETTLED_RULE is 3, so sealed rows are judged again.
- DappApprovals shows dapp-seedelf-hash, and TxDetail adds tx.out.warn.seedelfByHash.
- paidTo still names the contract for 'hash'.
- Tests: dapp-datum-hash, dapp-prompt, register_spellings_test, chain.test.ts and stake-elsewhere-screens. The latter two were only added to by 61a4d717.
- r2sign#2 holds: moreThanNote counts more than one label, or a 674 map with anything but one msg entry. dapp-prompt.test.ts:596-622 pins both shapes and the plain-note control.
- r2sign#3 and the three siblings its verifier named hold:
- withdraw.ts:190-198, decimalsOf([utxo]);
- tx-view.ts withDecimals over account rows, owned rows and the reading;
- DappApprovals forSite;
- SiteSessions' top-up review.

x1b#2's withdraw.ts comment survived e4d97bea's later edit and matches the code (withdraw.ts:104-117).
- r2screens#1's two fixed members hold: ConnectRequest and TopUp get the unlocked side with `locked` kept (DappApprovals.tsx:623 and Home.tsx:518-521), so 'available · locked' is right. r2screens#2: Swaps.tsx:839 keeps an answer only for the ask the form holds. r2screens#3: ClaimAll's `rebuilding` state; t1l#10's build-once effect (ClaimAll.tsx:90-104) is unchanged by 2d639df8.
- r2money#1/#2 and r2tests#5:
- build.rs collateral_back runs at finalize for the fee that's sent;
- with_account's only caller, lib.rs:1377's merged return, falls back to the plain sweep on CollateralShort;
- AccountMint keeps the old message.

The final cargo run passed apart_test, merge_test, mint_test and session_test.
- r2cli#1/#2 and r2tests#8:
- rows::window ranks by worth for transfer, sweep and util mint;
- sweep --all ranks before sweepable;
- external sweep ranks by worth too;
- af022a6f's holders_of leads with only the holders needed.

window.rs, sweep.rs, submit.rs, signing_page.rs and selection_integration.rs ran in the final cargo run (951 passed).
- r2verif#1-#5, r2docs#3 and r2tests#6: `bash test-tools.sh` (TMPDIR in scratch, no Lean) prints 'PASS: the tools hold' on HEAD. That covers:
- verdicts from a module's own trace;
- a wrapped axiom list;
- forget() for own and dependency failures;
- STALE readers;
- scan-diag exit codes.

No later commit touched seedelf-verification.
- r2docs#2, #4, #5 and #6: the words are on HEAD, and later commits added to flows.md and privacy.md without touching them. No comment anywhere still cites a collateralFits in sessions.ts.
- r2tests#1, #2, #3, #4, #7, #9 and #10: each test is present in the named file and passed in the final runs. 61a4d717's edits to stake-elsewhere-screens.test.ts and hide-balances-forms.test.ts add or retarget pins and weaken none. decode_test's clock bound is gone (decode_test.rs:1974-1976).
- Translations: 02f73991's ja rewording of tx.out.warn.anyoneCanSpend is intact. 61a4d717 only added keys and removed sites.topUp.tooMuch, which nothing references any more. The i18n and critical-set tests pass on both builds.
- t1l round-two tests (f88560c4) are present. Apart from ClaimAll's busy state, no later round-two commit touched those guards' screens.
- The lead's final checks at ad8c3ce4 are clean except l3still#1's e2e: Vitest 3617 passed on the default build and 3607 passed with 14 skipped preprod-only, cargo 951 passed, and clippy, fmt and tsc are clean. FIXTREE stayed clean throughout (git status empty).

## Notes

- r2still#2's wait isn't held to time for asked runs. The comment at sessions.ts:3981-3985 says 'The next run's listings, READ_EVERY_MS on', but Refresh, Stop and Try now are 'asked' runs and skip step's gate (sessions.ts:3738). The unit tests themselves run two asked advances back to back. So two Refresh presses seconds apart give the original case: a leg the listings still miss comes back alone, directly. The fallback holds (the page now says Lovejoin was left out), so this is a note, not a finding. If the wait is meant for a lagging backend, hold `now() - auto.spentSeen < READ_EVERY_MS` for every run kind, or compare by block.
- r2still#3: the e7a#1, t1k#9 and r2screens#2 describes run only where __MAINNET_ENABLED__ (swap-form-review.test.ts:437, 480 and 525). CI's preprod-only leg skips them: 14 skipped against the default build's 4. The red job is fixed. 'Pinned on one build only' remains by design.
- ad8c3ce4 gave activity.arrived a pin parameter, but neither caller passes one (balances.ts:303 and :437). Its guard is still the reading's pinned turn just before it, a window of microseconds, as round one had it. The commit message says the writers 'check the phrase themselves: activity's sent and arrived'.
- turnPin is a single field on SessionService. A book write made outside the queue (listNow without refresh, scan) while a turn runs checks that turn's pin. With one phrase that's harmless. Across Remove plus a restore, such a write is refused until the old turn ends. Not a finding.
- 19 guard reverts, all caught on HEAD: 5 r2time, 3 t1i#6, 2 t1i#7, 1 t1l#14, 7 siblings and gap-g6#2's rejudge. Each ran in a scratch copy of the extension under SCRATCH/r51/work/L3still/mirror, and each file was restored and diffed equal to FIXTREE. The scripts are mutants.py, mutants2.py and mutants3.py in SCRATCH/r51/work/L3still/.
- l3still#1 and l3still#2 share a root: r2still#2's fix. Fixing l3still#2's cutoff (the first return's build time or block) wouldn't touch the e2e; fixing the e2e by a second Refresh wouldn't touch the strangers rule.

## Coverage

Read in full:
- COMMON.md, FIX.md, RESUME.md and fix-branches.md.
- INDEX.md's R2 sections and the round-two first items.
- lanes/R2time.md and R2sign.md, and R2still.md's r2still#2 and its checked-and-holds.
- verify/r2still-2.md's fix notes, verify/r2screens-1.md's notes and class, and verify/r2sign-3.md's class.
- data/status.json for every round-two id.
- Every round-two commit's diffstat.
- Full diffs: ad8c3ce4 (all source and the edited tests), 7b6881f7, 61a4d717 (source and two test files), e66a6a16 (lovejoin.ts and docs), 81516188 (source), b3687869 (source), e6d6a18d (source), af022a6f, ca970760 (code), 2d639df8, f88560c4 (claim-all), 853d5779, e4d97bea, 04616cf6, the ja part of 02f73991, and ddc17685's README parts.

Read at HEAD around the changes:
- sessions.ts: step/act, spentSeen, apart, sendBack, sendChain, sendStep/sendRecorded, serial/save/update, autoView.
- lovejoin.ts: pumpChain, publicStart, withdrawNow/withdrawOne, settleWithdrawing, update, rejudge.
- activity.ts update, pending.ts submitWatched, account.ts readAccount.
- coin-control.ts account(); wallet.ts withKeys/serial/phrasePin.
- Swaps.tsx: backStepText, stoppable, the form's held lines; Transfer.tsx's too-much line.
- DappApprovals ConnectRequest and SignTx callouts; SiteSessions TopUp and back review; ClaimAll; ui/dapp.ts paidTo; dapp.ts moreThanNote; withdraw.ts.
- The e2e test at extension.spec.ts:2880-2970.

Ran:
- Two probes in a scratch copy of the extension. The strangers-during-chain probe ran on HEAD and on ad8c3ce4's parent via git archive; the last-step probe ran on HEAD.
- Three mutant scripts (19 reverts) and their controls.
- test-tools.sh.

Not run: Playwright and the Rust suites. For those I relied on the lead's final logs at ad8c3ce4.

Skimmed, from INDEX and the status notes rather than their lanes: R2cli, R2docs, R2money, R2screens, R2tests and R2verif.

Not reached:
- The CLI tests' bodies.
- The Lean docstring edits in ddc17685.
- Each t1l guard reverted again on HEAD. Only t1l#10 and t1l#14 were checked, plus the claim that no later commit touched the other guards' lines.
