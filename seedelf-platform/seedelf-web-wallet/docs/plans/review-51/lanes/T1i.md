# Lane T1i

Returned by the workflow's agent `a32468c555337a06c`, written here by the lead from its structured answer.

## Findings (18)

### t1i#1 · low · An approval whose request left the queue during the password check, signing nothing else: no test fails without it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:685`
- **Who:** site · **Since:** a4d08a83 (2026-10-02), before the first web-wallet/ tag (1.6.0) · **Confidence:** confirmed-by-run

**Scenario:**

Guard: answer() finds the request again after checkPassword and returns 'The site stopped waiting for this.' if it's gone (dapp.ts:684-685). Mutant: delete :685. A request can leave the queue during the check: its page closes, or a network or account change declines it. The next line then runs `this.waiting.splice(-1, 1)` (:686), which removes the queue's last request, and `w!.resolve(await w!.approve(...))` (:701) signs that one. So the user's Sign on request X signs request Y, for example a second tab's request from the same site. The guard holds today; no test fails without it.

**Evidence:**

Mutant, in my copy only: deleted `    if (i < 0) return { error: t("dapp.stoppedWaiting") };` (dapp.ts:685). The lane's dapp-account-change.test.ts:177 and :189 pass. So do all 31 dapp test files (357 tests). Four tests override checkPassword (dapp-declined.test.ts:180, dapp-site-english.test.ts:180, dapp-sign-data-race.test.ts:45, dapp-account-change.test.ts:194), and all four change the account or the connector during the check; none removes the asked request. The window's own guard against a double submit (DappApprovals.tsx:154 `busy`, t1i#12) is also untested, so a duplicate approve reaches this line too.

**Fix:**

Add to dapp-declined.test.ts: queue two signTx requests from two pages of one site. Override t.wallet.checkPassword so it ends the first page's session (as dapp-gone.test.ts closes a page) before it resolves. Approve the first with the password. Expect { error: 'The site stopped waiting for this.' }, the second request still in t.dapp.approvals(), and its signing promise still pending.

**Known check:**

Searched backlog.md and docs/archive/plans/ for stoppedWaiting, 'stopped waiting for this' and 'while the password (is|was) checked': no hits. No archived review records this as untested.

### t1i#2 · low · A site's ADA-only contract release, waiting for the user's yes: no test fails without it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/dapp.ts:34`
- **Who:** site · **Since:** 766e1c1d (2026-11-08), web-wallet/1.9.0 · **Confidence:** confirmed-by-run

**Scenario:**

Guard: releasesContractFunds (ui/dapp.ts:33-35) is true when the account's key releases contract money that doesn't reach it, as ADA (releasedLovelace > 0) or as tokens. When it is, the sign window shows the release warning and Sign waits for the user's switch (DappApprovals.tsx:124). Mutant: ignore the ADA. A site's transaction that sends, say, 49.8 ₳ of pure ADA from an order under the account's key to someone else then gets no warning and no yes. That is the shape of the 1.8.1 bounty report. No test fails.

**Evidence:**

Mutant, in my copy only: `return !!s.keyReleases && (BigInt(s.releasedLovelace ?? "0") > 0n || (s.releasedTokens?.length ?? 0) > 0);` became `return !!s.keyReleases && (s.releasedTokens?.length ?? 0) > 0;`. The lane's dapp-prompt.test.ts:87-200 (9 cases) pass, and so do the ui/dapp.ts and DappApprovals importers (354 tests). The shared fixture `taken` (dapp-prompt.test.ts:89-102) always releases a token along with the ADA. The e2e test at e2e/extension.spec.ts:5833 releases koios-preprod.json's contract_utxos[0], which holds a Seedelf token, so it takes the token branch as well. Mutants that drop the whole check (b8-all), the token half (b8-tokens) or keyReleases (b8-keyreleases) are all caught by dapp-prompt.test.ts.

**Fix:**

In dapp-prompt.test.ts's 'a contract UTxO the account's key releases' block, add a case with releasedTokens: [], contractTokens: [] and the paid row carrying no tokens. Expect releasesContractFunds(...) to be true and the render to contain data-testid="dapp-contract-release".

**Known check:**

Searched for releasedLovelace, releasesContractFunds, keyReleases and mutants#3. review-1.9.0.md:42 lists the three missing tests its mutants found, including a yes carried to a queued request, but not the ADA-only release. Nothing in backlog.md.

### t1i#3 · low · A site's port from an iframe, a non-https page or another extension, refused: no test fails without it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/sw.ts:364`
- **Who:** site · **Since:** fe8b7748 (2026-09-24), before web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

Guard: dappSession (sw.ts:363-369) accepts a dApp port only from this extension (sender.id), from a tab's top frame (frameId 0), on https or localhost, and takes the origin from Chrome. Any other port is disconnected (sw.ts:388-390). Three mutants each survive: dropping the frameId check, deleting the https/localhost line (:367), and dropping the extension-id check. Today the bridge is registered only on DAPP_ORIGINS with allFrames: false (connector.ts:45-49), so this check is the second line of defence. If that registration ever changed, no test would notice.

**Evidence:**

Mutants, in my copy only: (a) `!sender.tab || sender.frameId !== 0 || !sender.origin` became `!sender.tab || !sender.origin`; (b) deleted `  if (url.protocol !== "https:" && !local) return undefined;`; (c) `if (sender?.id !== chrome.runtime.id || !sender.tab` became `if (!sender?.tab`. Under each, tests/worker-language.test.ts (the only test that loads sw.ts) and tests/dapp-reach.test.ts pass 7/7. worker-language's site sender is always { frameId: 0, origin: 'https://app.example', tab }. No e2e test opens a dApp in an iframe or over http (grep of extension.spec.ts).

**Fix:**

In worker-language.test.ts's harness (the real sw.ts with a fake chrome), connect DAPP_PORT ports whose sender has frameId 1, origin 'http://app.example', or id 'other'. Expect each port's disconnect to be called and nothing posted. Also connect one from 'http://localhost:5173' and expect it accepted.

**Known check:**

Searched for frameId, iframe, 'top frame', sender.origin and dappSession. Only design statements came up (chunk-15-dapp-connector.md:44-45, launch-review.md:341, privacy-review.md:923); no test gap is recorded.

### t1i#4 · low · A site's transaction the wallet can't sign whole, without partialSign, refused: no test fails without it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:2087`
- **Who:** site · **Since:** fe8b7748 (2026-09-24), before web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

Guard: readTx refuses, with ProofGeneration and 'This transaction needs signatures the wallet can't give…', a transaction that needs other keys when the site didn't pass partialSign (dapp.ts:2087-2089). This is CIP-30's rule. Mutant `if (false) {`: such a transaction goes to the prompt, and if approved, the site gets a partial witness set it never asked for. No test fails.

**Evidence:**

Mutant, in my copy only: `    if (!partialSign && !summary.complete) {` became `    if (false) {`. The lane's dapp.test.ts:449-520 (the tests at :445, :480 and :503) pass, because they sign incomplete transactions with partialSign set to true. The 31 dapp test files pass 354 tests. Three tests timed out at their own 30 s limits (dapp-account-change.test.ts:276, :367 and dapp.test.ts:368); with those limits raised to 120 s they pass under the mutant. No test contains the refusal's words. dapp.test.ts:490's refusal of a foreign input comes from nothingToSign, not from this check.

**Fix:**

In dapp.test.ts: signTx with [siteTx({ inputs: [an own input, a stranger's resolved input] }), false] should reject with { code: TxSignError.ProofGeneration, info: containing "signatures the wallet can't give" } and leave no approval. With true it should prompt, as the existing case does.

**Known check:**

Searched for partialSign, needsOtherKeys and "signatures the wallet can't give". chunk-15-dapp-connector.md:63 states the rule; launch-review.md:233 (#13) is about unresolved inputs with partialSign. No test gap is recorded.

### t1i#5 · low · After a worker restart, only read calls are asked again, and only once: no test fails without it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/content/bridge.ts:56`
- **Who:** site · **Since:** fe8b7748 (2026-09-24), before web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

Guard: when the worker restarts, the bridge's onDisconnect (bridge.ts:48-58) sends READ_METHODS calls again once. A signTx or signData fails with 'nothing was signed', and a submitTx says it may have gone through (cutOff). Two mutants survive. (a) Re-send every method: a restart mid-prompt asks for the signature again and re-submits a transaction the wallet may already have sent. (b) Drop `!w.retried`: a read is re-sent after every restart, without end.

**Evidence:**

Mutants, in my copy only, on bridge.ts:56: (a) `if (READ_METHODS.has(w.call.method) && !w.retried) send(w.call, true);` became `if (!w.retried) send(w.call, true);`; (b) it became `if (READ_METHODS.has(w.call.method)) send(w.call, true);`. The lane's dapp-maybe-sent.test.ts:210 (it checks cutOff's words) and dapp-reach.test.ts:127 (the bridge loaded twice) pass, as do the 4 files that touch the bridge, READ_METHODS or cutOff (54 tests). dapp-reach.test.ts:126-153 loads bridge.ts with a fake port whose onDisconnect never fires. No e2e test restarts the worker mid-call.

**Fix:**

In dapp-reach.test.ts: load bridge.ts with a fake chrome.runtime.connect that records postMessage and keeps the onDisconnect listener. Relay getBalance, signTx and submitTx, then fire onDisconnect. Expect getBalance posted again on a new port, and signTx and submitTx answered with cutOff(method)'s words. Fire it again and expect getBalance failed, not re-sent.

**Known check:**

Searched for READ_METHODS, 'asked again', cutOff and 'nothing was signed'. chunk-15-dapp-connector.md:46 states the design and chunk-19-language.md:326-330 covers cutOff's language. No test gap is recorded.

### t1i#6 · low · A site's private-session funding sent only for the origin and network it was reviewed for, within 10 minutes: no test fails without three of its four checks

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:2134`
- **Who:** site · **Since:** b134a737 (2026-09-25), before web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

Guard: siteOutSubmit (sessions.ts:2134-2139) sends the kept funding only if its txHash, network and site origin match the request, and only if it was built less than BUILT_TTL_MS (10 minutes) ago. Mutants that drop the origin match, the network match or the age check each survive; only the hash match is caught. Without the origin check, a funding reviewed for site A's connect could be recorded and sent for site B's waiting connect, from two windows. Without the age check, a review hours old goes out with the fee and pool state it was built on.

**Evidence:**

Mutants, in my copy only: dropped `|| built.site?.origin !== origin` from :2134; dropped `|| built.network !== network` from :2134; deleted the age check at :2137-2139. Under each, site-funding-parts.test.ts and site-funding-seen.test.ts (8 tests) pass, and so do the 16 other files that call siteOutSubmit or fund a site (374 tests). restore-scan.test.ts:1035 and sessions.test.ts:1228 at first timed out under load at their own 20 s and 30 s limits, unmutated as well; with 120 s they pass under all four mutants. Dropping the hash match is caught by session-index.test.ts:66 (:84). Every test submits right away, with the origin and network it built with (e.g. restore-scan.test.ts:1041-1042).

**Fix:**

In site-funding-seen.test.ts or sessions-sent-twice.test.ts: build with siteOutBuild for https://a.example, then call siteOutSubmit three ways. With https://b.example, expect StaleReviewError 'That payment isn't ready to send'. With 'mainnet', expect the same. After clock.now += 10 min + 1 s, expect 'built more than 10 minutes ago'. In each case expect nothing recorded and nothing submitted.

**Known check:**

Searched for outNotReady, outTooOld and BUILT_TTL. The only hit, chunk-43-lovejoin-reward-balance.md:139, mentions the TTL exists. Nothing says siteOutSubmit's checks are untested.

### t1i#7 · low · A top-up sent only as reviewed (same hash and network), within 10 minutes: no test fails without either check

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:2398`
- **Who:** user · **Since:** d423b79a (2026-10-05), before web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

Guard: topUpSubmit sends the kept top-up only if the page's txHash and network match it (`ours`, sessions.ts:2398) and, unless it is a resend, only if it was built less than BUILT_TTL_MS ago (:2406). Mutants `const ours = !!built;` and the age check as `if (false) {` survive. With the first, Send on a page holding an older review X sends the top-up kept now (Y, built in another window) while recording X's hash (outRecord(network, built.index, txHash, built.txCbor), :2418). The record and the bytes sent disagree.

**Evidence:**

Mutants, in my copy only: `      const ours = !!built && built.txHash === txHash && built.network === network;` became `      const ours = !!built;`; `      if (!again && now() - built.builtAt > BUILT_TTL_MS) {` became `      if (false) {`. The lane's restore-scan.test.ts:1215 and :1295 (C29) pass, as do the 20 files that call topUpSubmit or a top-up (382 tests). The sent-already check is pinned (sessions-sent-twice.test.ts:92) and so are C29's checks for a session brought back by hand (restore-scan.test.ts:1215 and :1295).

**Fix:**

In session-top-up-again.test.ts: build top-up X, then build Y, which replaces the kept one. session-top-up-submit with X should throw StaleReviewError 'That top-up isn't ready to send'. Y on mainnet should throw the same. Y after clock.now += 10 min + 1 s should throw 'built more than 10 minutes ago'. koios.submitted should stay empty throughout.

**Known check:**

Searched for topUpNotReady, topUpTooOld, BUILT_TTL and C29. C29's by-hand checks are recorded, and pinned. Nothing covers the hash and network match or the age check.

### t1i#8 · low · A balance reading of the account the user switched from, kept as the new account's: no test fails without the check

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/balances.ts:392`
- **Who:** user · **Since:** 4279db80 (2026-10-06), before web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

Guard: a reading returns unkept when keys.account !== index (balances.ts:392), so a reading of account 1 that ends after a switch to account 2 is never kept. Mutant (line deleted) survives the lane's named test. That test releases the old reading (accounts-switch-reading.test.ts:106) before account 2's reading can be kept, so account 2's keep() runs last either way. In the other order, keep() (balances.ts:447, no account check) would leave account 1's balance and UTxOs kept, and account 2's Home, UTxOs screen and Activity would show them until a Refresh.

**Evidence:**

Mutant, in my copy only: deleted `      if (keys.account !== index) return { balances, unkept };`. The lane's accounts-switch-reading.test.ts:96 passes, and so do the 7 files that import balances (117 tests, 2 skipped).

**Fix:**

In accounts-switch-reading.test.ts: hold account 1's reading before it keeps, switch to account 2, let account 2's reading finish and keep, then release account 1's. Expect the kept SESSION_ACCOUNT_ADDRESSES stake and SESSION_ACCOUNT_UTXOS to still be account 2's.

**Known check:**

Searched for 'keys.account !== index' and C11 (the 1.2.0 release-review item the check came from). No test gap is recorded. This run's e4a#1 is a different hole in the same check: it compares the index only, so a Remove wallet race gets through.

### t1i#9 · low · A contract read that spans another wallet's keys, ended: no test fails without either same() check

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/contract-scan.ts:137`
- **Who:** user · **Since:** 2fa91556 (2026-09-27) for :137; c8573d5f (2026-10-09) for :233; both before web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

Guard: readKoiosView (contract-scan.ts:135-138) and readIndexView (:231-234) end, with WalletLocked, any read whose keys changed partway. That happens when another wallet is restored mid-read; a plain lock already throws in withKeys. The point is that rows judged with one wallet's register checks are never kept for another's. Mutants that delete either throw survive. A read started before Remove wallet and a restore of another phrase could then finish under the new keys and keep a contract view built partly from the old wallet's checks.

**Evidence:**

Mutants, in my copy only: deleted `    if (keys !== started) throw new WalletLocked(t("worker.locked"));` at :137, then separately at :233. The lane's accounts-switch-reading.test.ts:123 ('gives the new account its own reading when the switch lands while the contract is read, never locked') passes. An account switch doesn't change the Seedelf keys, so that test never reaches the throw. The 8 contract-scan files pass (123 tests).

**Fix:**

In contract-scan.test.ts: hold Koios's credential_utxos for the contract read, then remove the wallet and restore another phrase (or swap the Keys object that wallet.withKeys hands out), then release. Expect the read to reject with WalletLocked and SESSION_CONTRACT_PREFIX + network to stay unset. Do the same for the private index's read.

**Known check:**

Searched for 'same(keys)' and 'keys !== started': no hits in backlog.md or the archive.

### t1i#10 · low · An account switch while a payment that may still go through is open, refused: no test fails without it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/handlers.ts:380`
- **Who:** user · **Since:** fc8561c7 (2026-10-25), web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

Guard: account-use (handlers.ts:378-380) refuses a switch in three cases: a payment Koios didn't answer is open (maybeSent), a public mix that may have gone through is open (mixMaybeSent), or a public chain is being sent. Mutant dropping `open.length ||` survives; only the chain half is pinned. After a switch, that payment's watch would follow the wrong account (accounts.ts use; 1.6.0's release review, gap-1#0).

**Evidence:**

Mutant, in my copy only: `if (open.length || mixing.some(Boolean)) throw new Error(SWITCH_AT_STAKE());` became `if (mixing.some(Boolean)) throw new Error(SWITCH_AT_STAKE());`. The lane's lovejoin-planner.test.ts:2239, which sends a public mix, passes, and so do the 8 files that test account-use (177 tests). Dropping the whole check (c4-all) or the chain half (c4-mixing) is caught by lovejoin-planner.test.ts:2239.

**Fix:**

In accounts.test.ts or maybe-sent.test.ts: leave a Send maybe-sent (Koios answers 504 on submit, as maybe-sent.test.ts does). Then handle({ type: 'account-use', index: 1 }) should reject with SWITCH_AT_STAKE() and the active account should stay 0.

**Known check:**

Searched for SWITCH_AT_STAKE, gap-1#0 and account-use. Nothing records the payment half as untested.

### t1i#11 · low · Decline all, or any answer, refused for a private session's funding that's already sent: no test fails without either side's check

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:197`
- **Who:** user · **Since:** d423b79a (2026-10-05) for DappApprovals.tsx:197; a4d08a83 (2026-10-02) for dapp.ts:661; both before web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

Guard: declineAll skips a connect whose funding is sent (DappApprovals.tsx:197), and the worker's answer() refuses any answer to one: 'Its private session is funded already.' (dapp.ts:661). Both mutants survive. With both gone, Decline all, or any answer, rejects a site whose session the user just funded. The site hears 'declined', and its funded one-time account waits for Bring it back. An approve without `fund` would go on to connect the site to the public account. The window offers no button for that, so only a crafted call could do it.

**Evidence:**

Mutants, in my copy only. Deleting DappApprovals.tsx:197 `        if (a.kind === "connect" && a.funding) continue;`: the 11 DappApprovals test files pass (286 tests). Deleting dapp.ts:661 `    if (approval.kind === "connect" && approval.funding) return { error: t("dapp.alreadyFunded") };`: dapp-declined.test.ts and connector-lovejoin-review-fixes.test.ts pass (29 tests), and so do the 9 files that answer a funded connect (176 tests). No test contains 'Its private session is funded already.', and no e2e test presses Decline all.

**Fix:**

Worker side, in dapp-declined.test.ts: fund a connect through dapp-private-build and answer(fund). Then answer(id, false) and answer(id, true) should both return { error: 'Its private session is funded already.' }, and the request should still be waiting. The window's skip needs an e2e step, or a harness render of DappApprovals with one funded and one ordinary request, checking that Decline all sends dapp-answer for the ordinary one only.

**Known check:**

Searched for 'Decline all', declineAll, CW-7, alreadyFunded and 'funded already'. usability-review.md CW-7 is where Decline all was added. Nothing says the skip or the worker's refusal is untested.

### t1i#12 · low · The sign window's answer refused while busy, during the hold, or without the password: no test fails without those conditions

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:154`
- **Who:** user · **Since:** 766e1c1d (2026-11-08) for the line as it stands, web-wallet/1.9.0 · **Confidence:** confirmed-by-run

**Scenario:**

Guard: the window's answer() (DappApprovals.tsx:154) returns early in four cases: while busy, while held (another request has just taken the shown one's place), without the password, or without the release yes. Mutants that drop the busy, held or password condition survive every Vitest test. No e2e test reaches them either: the buttons are disabled in those states, and the browser's Enter-to-submit stops at a disabled default button. Only form.requestSubmit() gets past, and e2e 5833 uses it for the yes alone. Backstops: the worker requires the password, which dapp.test.ts:945 pins. A second approve is caught by answer()'s re-check at dapp.ts:685, which is itself unpinned (t1i#1).

**Evidence:**

Mutants, in my copy only, on DappApprovals.tsx:154: drop `busy ||`; drop `held ||`; drop `(approve && needsPassword && !password) ||`. Under each, the 11 DappApprovals files pass (286 tests). Nothing in Vitest renders the default DappApprovals() component; the UI tests use renderToStaticMarkup on its sub-components. The yes condition `(approve && mustAck && !ack)` also passes every Vitest test, but e2e/extension.spec.ts:5895-5897 calls requestSubmit with the switch off and expects secondAnswered to be false (read, not run).

**Fix:**

In e2e's replaced-request test (around :6022): while 'The request you were reading is gone' holds the buttons, call form.requestSubmit() and expect no answer. In the sign step, call requestSubmit twice at once and expect the site to get exactly one answer.

**Known check:**

Searched for HOLD_MS, held, busy, mutants#3 and requestSubmit. review-1.9.0.md:42 and :92 record the carried-over yes and the Enter checks (r2-window#1, #2), now pinned by e2e. Nothing covers busy, held or the password inside answer().

### t1i#13 · low · A private session's funding sent again while its refusal is shown: no test fails without the check

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:715`
- **Who:** user · **Since:** d423b79a (2026-10-05), before web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

Guard: the funding review's send() returns early while a refusal is pending (DappApprovals.tsx:715). So after giveme.my refuses, Enter in the password box can't send the funding again. Mutant dropping `refusal ||` survives. The worker refuses the resend anyway (refuseStarted, sessions.ts:1338-1344: started already, or the index taken), so it costs one more round trip and a second refusal.

**Evidence:**

Mutant, in my copy only: `if (!review || refusal || busy || (approval.password && !password)) return;` became `if (!review || busy || (approval.password && !password)) return;`. The 11 DappApprovals files pass (286 tests). The e2e funding test (around :5389) checks that Send is gone after the refusal, not the Enter path into send().

**Fix:**

In the e2e funding-refusal step (around :5389): after the refusal, type the password and press Enter in its box. Expect koios.submitted still empty and no second dapp-answer.

**Known check:**

Searched for DX-1, refuseStarted and "Send can't go again". The refusal design is DX-1 from chunk 23's second review; no test gap is recorded.

### t1i#14 · low · A private session's amount over the private balance, refused in the connect window: no test fails without the check

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:687`
- **Who:** user · **Since:** b134a737 (2026-09-25), before web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

Guard: tooMuch (DappApprovals.tsx:687) keeps Review off and shows a note when the amount is more than the private balance. Mutant `const tooMuch = false;` survives. The worker refuses the build anyway (NotEnoughPrivate, sessions.ts:1033), so the user sees the worker's refusal after pressing Review instead of the field's note.

**Evidence:**

Mutant, in my copy only: `  const tooMuch = !!seedelf && !!lovelace && BigInt(lovelace) > BigInt(seedelf.lovelace);` became `  const tooMuch = false;`. The 11 DappApprovals files pass (286 tests). No e2e test types more than the balance into the connect form (grep). The form's state can't be reached by the static renders.

**Fix:**

Either move the amount check (tooMuch and canReview) into a function and unit-test it, or add an e2e step that types the balance plus 1 ₳: Review disabled and the field note shown.

**Known check:**

Searched for tooMuch, 'more than you hold' and sites.topUp.tooMuch: no hits. Related: this run's e3b#2 (the check compares against the raw private balance, not the unlocked one).

### t1i#15 · low · A top-up over the spendable private balance, refused in its form: no test fails without the check

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/SiteSessions.tsx:572`
- **Who:** user · **Since:** b134a737 (2026-09-25), before web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

Guard: TopUp's tooMuch (SiteSessions.tsx:572) keeps Review off and shows 'more than you hold' over the private balance. Mutant `const tooMuch = false;` survives. The worker refuses the build anyway (NotEnoughPrivate), so it costs a round trip, not money.

**Evidence:**

Mutant, in my copy only: `  const tooMuch = !!lovelace && BigInt(lovelace) > BigInt(seedelf.lovelace);` became `  const tooMuch = false;`. The lane's hide-balances-forms.test.ts:59 only reads the source text, and passes. The 9 SiteSessions files pass too (216 tests). No e2e top-up case goes over the balance.

**Fix:**

Same as t1i#14: a unit-tested amount check shared by both forms, or an e2e step typing more than the balance.

**Known check:**

Same searches as t1i#14: no hits.

### t1i#16 · low · A site session's Disconnect kept off until its account is read: no test fails without the wait

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/SiteSessions.tsx:120`
- **Who:** user · **Since:** 7cc3f363 (2026-10-02), before web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

Guard: on the session's own screen, disconnectWait returns 'Refresh to read what it holds' for an account not yet read (SiteSessions.tsx:120), so Disconnect stays off. Mutant `if (!s.holding) return undefined;` survives. screens.test.ts:844 still sees the sentence because Bring back's own reason produces it (backWhy, :328; deduplicated at :330), and no test checks Disconnect's disabled state for holding: null. The worker reads the account itself before closing a session (sessions.ts:2560, pinned by session-site-outs.test.ts), so a premature press is refused there.

**Evidence:**

Mutant, in my copy only: `  if (!s.holding) return canRefresh ? t("sites.wait.refresh") : undefined;` became `  if (!s.holding) return undefined;`. The lane's screens.test.ts:782 passes, as do the 9 SiteSessions and ConnectedSites files (278 tests). The funding, moving and holding branches are each caught (screens.test.ts:783, :784, :789).

**Fix:**

In screens.test.ts's test at :782, add expect(disconnectWait(siteSession({ holding: null }))).toBe('Refresh to read what it holds'), and check that disconnect(markup(siteSession({ holding: null }), true)) contains 'disabled'.

**Known check:**

Searched for sites.wait.refresh, 'Refresh to read what it holds' and disconnectWait: no hits in backlog.md or the archive.

### t1i#17 · low · A dApp account index past 2^31 - 1 kept in the preferences: no test fails without the bound

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/shared/preferences.ts:72`
- **Who:** user · **Since:** 631c5b02 (2026-10-04), before web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

Guard: isAccountIndex bounds an index at 0x7fff_ffff (preferences.ts:72). Mutant dropping the bound survives. accounts.ts applies the same bound again (isIndex, :377, MAX_INDEX), so choosing, adding and checking accounts still refuse a larger index. But background/preferences.ts:122 and :142 check dappAccount with isAccountIndex alone, so a dappAccount of 2^31 would be kept, and the dApp account derived from an index that can't be hardened. Only the wallet's own pages send preferences-set, and Settings offers only known accounts.

**Evidence:**

Mutant, in my copy only: deleted `  value <= 0x7fff_ffff &&` (preferences.ts:72). accounts.test.ts:177 and 14 related files pass (303 tests). accounts.test.ts:41, :157 and :174 test MAX_INDEX + 1 only through isIndex, and preferences.test.ts only ever sets dappAccount to 0. Dropping isIndex's own bound instead (accounts.ts:377) is an equivalent mutant, because the same bound stays in isAccountIndex.

**Fix:**

In preferences.test.ts: both set({ dappAccount: 0x8000_0000 }) and a stored 0x8000_0000 should read back as DEFAULT_PREFERENCES.dappAccount.

**Known check:**

Searched for 0x7fff_ffff, MAX_INDEX, 2^31 and 0x8000_0000. chunk-18-several-accounts.md:365 and :469 describe the bound; no test gap is recorded.

### t1i#18 · low · A private session's signature carrying no governance (DRep key): no test fails without the check, which no flow can reach

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:2061`
- **Who:** nobody · **Since:** 5969dd7a (2026-10-04), before web-wallet/1.6.0 · **Confidence:** confirmed-by-run

**Scenario:**

Guard: signTx's request sets governance only `&& !holder` (dapp.ts:2061; signData has the same at :2506). Through call(), governed() (dapp.ts:345) is already false for any site on a session. No flow records cip95 on a session site either: connect() returns a session's record before it looks at governance (dapp.ts:985-986), and grantGovernance and declineGovernance only touch records with session === undefined. So the mutant alone is equivalent. Even with governed()'s session check dropped as well, nothing fails; a test would need a hand-crafted session record with cip95.

**Evidence:**

Mutants, in my copy only: `governance: governance && !holder` became `governance: governance` at :2061; then at :2506; then both of those plus dropping `&& site.session === undefined` from governed() (:345). Under each, dapp-governance.test.ts (6 tests) and the 31 dapp files (351 tests) pass.

**Fix:**

Optional, since it's defence in depth: a dapp-governance.test.ts case that writes a session site record with cip95: true and expects getPubDRepKey refused, and a session signTx whose request has no governance.

**Known check:**

Searched for 'governance && !holder' and governed(. chunk-21-governance.md:138 states the DRep rule; no test gap is recorded.

## Guards (46)

| Where | What it stops | Test |
|---|---|---|
| `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:1838` | keptApart: on the public account, a site's transaction that spends a locked UTxO, puts one up as collateral, or spends the collateral; on a session, flags a spend of the collateral | dapp.test.ts:640 and dapp-account-coins.test.ts:61 hang to their limits under the lock, lock-as-collateral and collateral-as-input mutants (unmutated 2.8 s and 3.0 s); dapp.test.ts:1347 catches the session flag |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:1896` | heldForLovejoin: a site's transaction using, or putting up as collateral, what the holder's Lovejoin chain needs | dapp-declined.test.ts:188 (assertion) and dapp.test.ts:671, :1363, :1375 (hang) for the whole check; dapp.test.ts:671 for the site's-collateral half and for the chain's-collateral half |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:1725` | getCollateral offers nothing while the holder's chain holds the collateral | dapp-chain-collateral.test.ts:37 (fails at :66: expected null) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:1729` | getCollateral answers nothing for an amount over 5 ₳ or over the collateral UTxO | dapp.test.ts:253 (:267) with both halves dropped; each half alone is an equivalent mutant, since the collateral is always exactly 5 ₳ |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:2087` | refuses a transaction the wallet can't sign whole unless partialSign | none (t1i#4) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:2093` | refuses registering or delegating a session's stake key | dapp.test.ts:1483 (hangs; unmutated 10.4 s) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:2099` | refuses a payment into a Lovejoin pool's mix_logic reward account | dapp-lovejoin-rewards.test.ts:208 (:216) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:2183` | at approval: still connected to the same holder, connector still on, no chain or lock started meanwhile, same dApp account (E3a's and E3b's guard, merged) | all 7 sub-mutants caught by dapp-declined.test.ts:159 (:168), :173 (:184), :188 and dapp-account-change.test.ts:341 (:358) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:2163` | the last look before ask: a read for a dApp account or network Settings has left is refused | account half: dapp-account-change.test.ts:252 and :276; network half: dapp.test.ts:337 (:360) and :368 (:411), not the lane's named tests |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:1311` | withViewKeys signs only with the keys of the account the request was read for | dapp-account-change.test.ts:367 ('expected [ 1 ] to not include 1') |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:663` | answer() refuses an approval asked on a network or dApp account since changed, and finds the request again after the password | network: dapp.test.ts:301 (:311); account: dapp-account-change.test.ts:177 (hangs; unmutated 4.1 s); the re-check after the password (:685): none (t1i#1) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:2569` | submitTx: a resend during a send gets the first send's answer; one kept as sent hears its id | dapp-maybe-sent.test.ts:134 (in-flight share); dapp-resend-refused.test.ts:106 (sentFor past the limit) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:2588` | a maybe-sent submit is answered with its id, kept as sent, and looked for and sent again | all 4 sub-mutants: dapp-maybe-sent.test.ts:81 (:88, :94) and :134 (:139); dapp-resend-refused.test.ts:106 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:2776` | keeps a session's 5 ₳ collateral out of what a site may spend | dapp.test.ts:1293 (length 2, not 1) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:1935` | sentOutputs answers only with recent outputs that pay the site's own holder | dapp.test.ts:1409 (:1433) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:2874` | refuses unread a transaction over 64 KiB, an amount over 8 KiB (:1738), an address over 512 characters (:2492), a payload over 64 KiB (:2493) | transaction: dapp.test.ts:717; amount: dapp-caps.test.ts:57; address: dapp-caps.test.ts:98; payload: dapp.test.ts:752, hanging at :787 (unmutated 8.0 s) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sw.ts:364` | a site's origin taken from Chrome, top frames only, https or localhost only | none (t1i#3) |
| `seedelf-platform/seedelf-web-wallet/extension/src/content/bridge.ts:56` | after a worker restart, only read calls are asked again, once | none (t1i#5) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:2061` | the DRep key signs only for a site given governance on the public account | none; equivalent through call() (t1i#18) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/tx-view.ts:344` | a kept record naming another network isn't shown in the transaction view | tx-view.test.ts:220 (resolves instead of rejecting on mainnet); parts-send-review-fixes.test.ts 'opens each part by its hash … nothing that isn't one' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:154` | answer() refuses while busy or held, and an approve without the password or the release yes | busy, held, password: none (t1i#12); the yes: none in Vitest, but e2e/extension.spec.ts:5895-5897 asserts it (read, not run) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:318` | Sign disabled until the password and, for a release, the switch | none in Vitest; e2e/extension.spec.ts:5872 and :5892 (yes) and :5199 and :6155 (password) assert it (read, not run) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:126` | the release yes is held by request id, so it never carries over | none in Vitest; e2e/extension.spec.ts:5880-5892 asserts it (read, not run) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:138` | the HOLD_MS hold when another request takes the shown one's place | none in Vitest; e2e/extension.spec.ts:5883 and :6043-6044 assert it (read, not run) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:197` | Decline all skips a private session's funding that's already sent (worker side: dapp.ts:661) | none, either side (t1i#11) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:715` | the funding's Send refuses with a refusal pending, while busy, or without the password | none for the refusal condition (t1i#13) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:687` | the private-session amount capped at what the private balance holds | none (t1i#14) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:869` | Connect only once the public account is chosen | dapp-prompt.test.ts:479 (:484) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/dapp.ts:33` | releasesContractFunds: whether Sign waits for the yes and the release warning shows | dapp-prompt.test.ts :104, :120, :126 (:128), :141 (:144), :149 (:156) for the whole check, the token half and keyReleases; the ADA half: none (t1i#2) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/dapp.ts:24` | stakingComesBack: the staking callout warns when withdrawn rewards or a refund leave | dapp.test.ts:503 (:526) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/SiteSessions.tsx:116` | disconnectWait: Disconnect waits while a funding, a return or its chain is under way, or while the account holds anything | screens.test.ts:782 for the funding (:783), moving (:784) and holding (:789) branches; the unread branch (:120): none (t1i#16) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/SiteSessions.tsx:370` | a site session's Disconnect disabled while waiting | screens.test.ts:799 (also e2e 5614 and 5668) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/SiteSessions.tsx:572` | top-up amount capped at the spendable private balance | none (t1i#15) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/ConnectedSites.tsx:104` | Settings' Disconnect off while sessions are unread or a session's wait applies | unread: settings.test.ts:289 (:301); wait: settings.test.ts:260 (:269), :276 (:283), :289 (:296) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:2134` | siteOutSubmit sends only the kept funding whose txHash, network and origin match, within its TTL | txHash: session-index.test.ts:66 (:84); origin, network, TTL: none (t1i#6) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:2405` | topUpSubmit sends only the top-up reviewed, never one already sent | sent already: sessions-sent-twice.test.ts (:92); C29 by hand: restore-scan.test.ts:1215 and :1295; hash and network match, TTL: none (t1i#7) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:2560` | a session's Disconnect refused while a fresh read shows its account holding anything | session-site-outs.test.ts ('holds the session open while Koios knows that transaction spent its funding…') |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/wallet.ts:261` | a second create or restore overwriting the vault | wallet.test.ts:74 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/wallet.ts:476` | Remove wallet and Forgot password deleting maybeSent.* or lovejoinMaybe.* (KEPT_ON_RESET) | remove-wallet.test.ts:139 (:143) and :155 (:160); the lovejoinMaybe entries: remove-wallet-mix.test.ts (:70, and 'builds no other mix … until the network settles it') |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/pending.ts:1033` | adoptKept: another phrase's maybe-sent record left behind, or this phrase's dropped (also lovejoin.ts adoptKept) | never removing: remove-wallet.test.ts:167 (:172); always removing: remove-wallet.test.ts:139; lovejoin.ts's remove: remove-wallet-mix.test.ts (:93) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/handlers.ts:259` | Remove wallet while a payment, session, chain or parts are open, without a second yes | remove-wallet.test.ts:80 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/handlers.ts:378` | switching public account while a maybe-sent payment or public mix is under way | lovejoin-planner.test.ts:2239 for the whole check and the chain half; the payment half: none (t1i#10) |
| `seedelf-platform/seedelf-web-wallet/extension/src/shared/preferences.ts:68` | the one-time accounts' index 24301' used as a public account; the 2^31 bound (accounts.ts:376-378) | 24301': accounts.test.ts:177; the bound on dappAccount: none (t1i#17); isIndex's own bound is an equivalent mutant |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/private-store.ts:143` | a record that won't open read as empty and then written over | contacts.test.ts:33; sessions.test.ts:201 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/balances.ts:392` | a reading of the account switched from, kept as the new account's | none (t1i#8) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/contract-scan.ts:135` | a contract read spanning a lock or another wallet keeping rows judged with other keys (also :231) | none, either site (t1i#9) |

## Checked and holds

- tx-view.ts:344 `here`: deleting it fails tx-view.test.ts:220 (a preprod-built hash read on mainnet resolves instead of rejecting) and parts-send-review-fixes.test.ts 'opens each part by its hash, … and nothing that isn't one'.
- dapp.ts:1838 keptApart, 4 mutants (lock check off; collateral left out of the lock check; collateral-as-input off; session flag false): dapp.test.ts:640 and dapp-account-coins.test.ts:61 hang to their limits (unmutated 2.8 s and 3.0 s in a pristine copy); dapp.test.ts:1347 fails its toMatchObject for the session flag.
- dapp.ts:1896 heldForLovejoin, 3 mutants: dapp-declined.test.ts:188 fails an assertion and dapp.test.ts:671, :1363 and :1375 hang (unmutated 8.5 s and 6.9 s); dropping the chain's collateral makes dapp.test.ts:671 get keptApart's refusal instead of the chain's.
- dapp.ts:1725 chain collateral not offered: dapp-chain-collateral.test.ts:37 fails at :66 (expected null).
- dapp.ts:1729 collateral cap: dropping both halves fails dapp.test.ts:253 (:267). Each half alone is an equivalent mutant, because the collateral is always a pure 5 ₳ UTxO (coin-control.ts:391 exactlyFive; sessionCollateral takes only 5 ₳).
- dapp.ts:2093 a session's stake key: dapp.test.ts:1483 hangs (unmutated 10.4 s).
- dapp.ts:2099 mix_logic reward account: dapp-lovejoin-rewards.test.ts:208 fails at :216.
- dapp.ts:2183 re-checks at approval, 7 mutants (stillConnected, the second heldForLovejoin, the second keptApart, the last sameAccount, sameAccount in both places, the connector check, the site check): dapp-declined.test.ts:159 (:168), :173 (:184) and :188; dapp-account-change.test.ts:341 (:358).
- dapp.ts:2163 last look before ask: the account half fails dapp-account-change.test.ts:252 and :276; the network half fails dapp.test.ts:337 (:360, the prompt is shown) and :368 (:411).
- dapp.ts:1311 withViewKeys re-reading Settings: dapp-account-change.test.ts:367 ('expected [ 1 ] to not include 1').
- dapp.ts:663 answer(): the network check fails dapp.test.ts:301 (:311); the account check makes dapp-account-change.test.ts:177 hang (unmutated 4.1 s), because the waiting signData never settles.
- dapp.ts:2569 submitTx: without the in-flight share, dapp-maybe-sent.test.ts:134 gets 'already spent'; without sentFor, dapp-resend-refused.test.ts:106 gets 'too often'.
- dapp.ts:2588 maybe-sent, 4 mutants (the branch, keepSent, settle, the catch's sentFor): dapp-maybe-sent.test.ts:81 (:88, :94) and :134 (:139); dapp-resend-refused.test.ts:106.
- dapp.ts:2776 a session's collateral: dapp.test.ts:1293 (length 2, not 1).
- dapp.ts:1935 sentOutputs filter: dapp.test.ts:1409 fails at :1433.
- dapp.ts size caps: transaction by dapp.test.ts:717; amount by dapp-caps.test.ts:57; address by dapp-caps.test.ts:98; payload by dapp.test.ts:752, hanging at :787 (unmutated 8.0 s).
- DappApprovals.tsx:869 Connect waits for a choice: dapp-prompt.test.ts:479 (:484).
- ui/dapp.ts:33 releasesContractFunds: the whole check, the token half and keyReleases each fail dapp-prompt.test.ts (:104, :120, :126 at :128, :141 at :144, :149 at :156).
- ui/dapp.ts:24 stakingComesBack: dapp.test.ts:503 (:526).
- SiteSessions.tsx:116 disconnectWait's funding, moving and holding branches: screens.test.ts:782 (:783, :784, :789).
- SiteSessions.tsx:370 Disconnect disabled while waiting: screens.test.ts:799.
- ConnectedSites.tsx:104: unread fails settings.test.ts:289 (:301); wait fails :260 (:269), :276 (:283) and :289 (:296).
- sessions.ts:2134 hash match: session-index.test.ts:66 (:84; unmutated 7.0 s).
- sessions.ts topUpSubmit: sent-already fails sessions-sent-twice.test.ts (:92); C29's by-hand checks fail restore-scan.test.ts:1215 and :1295.
- sessions.ts:2560 Disconnect while holding: session-site-outs.test.ts (resolves instead of refusing).
- wallet.ts:261 a second wallet: wallet.test.ts:74.
- wallet.ts:476 KEPT_ON_RESET: remove-wallet.test.ts:139 (:143) and :155 (:160); its lovejoinMaybe entries: remove-wallet-mix.test.ts (:70 and 'builds no other mix…').
- pending.ts:1033 adoptKept: never removing fails remove-wallet.test.ts:167 (:172); always removing fails :139; lovejoin.ts adoptKept's remove fails remove-wallet-mix.test.ts (:93).
- handlers.ts:259 Remove wallet's second yes: remove-wallet.test.ts:80.
- handlers.ts:378 account switch, whole check and chain half: lovejoin-planner.test.ts:2239.
- preferences.ts:73 index 24301' never public: accounts.test.ts:177.
- private-store.ts:143 unreadable record: contacts.test.ts:33 and sessions.test.ts:201.

## Notes

- How I measured: the machine ran at load average 37 to 50 (other T1 agents' suites), and some tests failed their own 5, 20, 30 and 60 s limits unmutated. For example, dapp.test.ts:368 took over 30 s, and dapp-account-change.test.ts:276 took 27.4 s against its 30 s. So I ran Vitest with --testTimeout=120000, and in my copies only (assertions untouched) raised the tests' own `{ timeout: 10_000|30_000|60_000 }` (20 places) and their trailing `}, 20_000|30_000|60_000);` limits (14 places, each checked to close an it()) to 120 s. I counted a timeout under a mutant as caught only when the same test passed unmutated, well inside its limit, in a pristine copy. That applied to a0, a1, a5, a10-account and a15-payload.
- Pinned only by e2e, read but not run (Playwright is outside the brief): the yes condition in DappApprovals.tsx:154 (e2e 5895-5897), DappApprovals.tsx:318 (5872 and 5892; 5199 and 6155), :126 (5880-5892) and :138 (5883 and 6043-6044). Vitest can't reach them: the UI tests render statically, and nothing renders the default DappApprovals() component.
- Equivalent mutants (no test can fail them through the public API): each half of dapp.ts:1729's cap alone; accounts.ts:377's bound (isAccountIndex keeps the same one); dapp.ts:2061 and :2506's `&& !holder` given governed() (t1i#18).
- Lane-named tests that didn't pin their guard, where another test did: the network halves of A8 and A10 are pinned by dapp.test.ts:301, :337 and :368, not the named account-change tests. A15's transaction and payload caps are pinned by dapp.test.ts:717 and :752, not dapp-caps.test.ts. B16's sent check is pinned by sessions-sent-twice.test.ts:92, not restore-scan's C29 cases. B15's hash check is pinned by session-index.test.ts:66. The lovejoinMaybe halves of C1 and C2 are pinned by remove-wallet-mix.test.ts. And with no other test: A4's named cases never test the refusal (t1i#4), C7's named test passes under its mutant (t1i#8), and C8's named test can't reach the throw (t1i#9).
- Two untested guards together stand against a double approve: the window's `busy` (DappApprovals.tsx:154) and answer()'s re-check (dapp.ts:685). If both regressed, a second approve would take the queue's last request (t1i#1, t1i#12).
- The uncaught UI checks in t1i#12 to #16 all have backstops in the worker: the password (pinned by dapp.test.ts:945), NotEnoughPrivate, refuseStarted, and the fresh read before Disconnect (sessions.ts:2560, pinned). Each one costs a round trip, not money.
- I narrowed b4-worker's wider run (dapp.ts:661) to the 9 files that answer a funded connect (176 tests), after a first 46-file run was cut short by --bail on a load timeout.
- TREE shows ` M seedelf-platform/seedelf-web-wallet/docs/plans/review-51/fixes/G5.md`. That isn't mine: I wrote only to my copies under $HOME/.cache/seedelf-review-51/T1i, now removed. The brief says TREE is at cd764fba; its HEAD is be7d1dbd, which adds only review-51 docs on top (git diff --name-only shows nothing outside review-51).

## Coverage

All 46 lane guards tried: E3a's 20, E3b's 18 and E4a's 9, with dapp.ts:2183 (E3a#7 and E3b#14) merged. That came to 100 distinct mutants, since most guards were split into their conditions; the specs are in SCRATCH/r51/work/T1i/specs, which is tmpfs. Order: no test or an unknown test first (sw.ts:364, tx-view.ts:344, DappApprovals.tsx:197 and :687, and the guards named only by e2e), then a site's input (the rest of E3a, plus ui/dapp.ts and Connect), then the rest. Each mutant ran first against the lane's named Vitest cases by file:line, then against the named files in full plus that source file's importing or calling tests: 31 dapp files, 11 DappApprovals files, 9 SiteSessions files, and 16 to 20 sessions files per function. I ran in four copies: one per batch (UI, and two sharing the worker specs), plus a pristine one for baselines. 45 caught; 18 findings are uncaught guards or conditions (t1i#1 to #18). Not run: Playwright e2e (outside the brief; read for 5 guards instead) and the whole suite. None of these guards is in Rust, so no Rust ran and no WebAssembly guard was involved. Nothing was left untried. Copies removed: rm -rf $HOME/.cache/seedelf-review-51/T1i (there was no T1i-target).
