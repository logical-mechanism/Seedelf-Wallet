# Lane L3time

Returned by the workflow's agent `ad717bb22c21ff34d`, written here by the lead from its structured answer.

## Findings (2)

### l3time#1 · low · Bring one back takes its phrase pin only after giveme.my answers, and its watch isn't pinned at all: a Remove and a restore in that window put the first phrase's withdraw into the restored phrase's schedule, private history and Home watch

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:7886`
- **Who:** user · **Since:** ad8c3ce4 (the pin placed after the build's waits; watchSent left unpinned). Bring one back's missing `unlocked` predates it. · **Confidence:** confirmed-by-run

**Scenario:**

Lines are FIXTREE's (ad8c3ce4). Wallet A is unlocked and the user presses Bring one back on a box (the default path, giveme.my's collateral). withdrawOne builds and proves the withdraw under A's keys (:7833), then waits for giveme.my's witness (:7834; collateral.ts TIMEOUT_MS is 20 s). During that wait the user removes wallet A and restores wallet B. Remove wallet lists nothing open, because no Withdrawing exists yet (the run returned listed = []), so it asks no second yes.

Bring one back passes no `unlocked` (:7276), so the runner's guard at :7841 doesn't stop it. Then:
1. The Withdrawing record, A's signed CBOR, is written into B's sealed schedule (:7863). That write isn't pinned.
2. `phrasePin()` (:7886) pins on its first call, so it pins B.
3. A's valid withdraw is submitted from B's session.
4. Every post-submit write is pinned to B, so every check passes. A's box-back entry (amount, tx hash, ties) is sealed into B's private Activity for good (`historyOfOther` contains the hash). dropWithdrawing counts the box back in B's mix list. watchSent (:7289) puts A's withdraw in B's Home banner.

No money moves wrongly: A's box goes back to A's Seedelf. The harm is exactly r2time#2's, which ad8c3ce4 says it closed.

Sibling, after the pin: a Remove and a restore during Koios's submit (429 hold plus submit timeout, up to about 90 s) now stays out of B's history. But withdrawNowNow's watchSent (:7289) and publicSubmit's watchSent (:5239, after pumpPublic's submit) are unpinned. pending.ts take writes the watch under whatever keys are in, so A's withdraw or mix shows in B's Home banner until it lands (confirmed by run).

The same change before the build is refused by WebAssembly, so the window is giveme.my's answer.

**Evidence:**

lovejoin.ts:7158-7172: withdrawNow → withdrawNowNow reads `pressedOn` and takes no unlock time and no pin.
lovejoin.ts:7276: `const pending = await this.withdrawOne(network, read, chosen, { due, ...held, ...(paid ? { paid } : {}), ...(payer !== undefined ? { payer } : {}) });` passes no `unlocked`. withdrawDueNow (:7103) and bringAllBackNow (:7561) both pass it.
lovejoin.ts:7833-7834: `built = await wallet.withKeys((keys) => JSON.parse(wasm.buildLovejoinWithdraw(keys.seedelf, ...)))` then `const collateral = await this.deps.collateral(network).witness(built.txCbor);`.
lovejoin.ts:7841: `if (unlocked !== undefined && (await wallet.unlockedAt()) !== unlocked) throw ... lj.lockedWhileBuilding`, which is skipped here.
lovejoin.ts:7863-7882: `await this.update(network, (s) => { ... s.withdrawing = { txHash, txCbor: finished.txCbor, ... } })`, with no pin.
lovejoin.ts:7886-7890: `const pin = phrasePin(); ... await wallet.withKeys((keys) => { pin(keys); return rememberSpent(...) })`. wallet.ts phrasePin's `(pinned ??= id)` pins whatever phrase is in at the first call.
lovejoin.ts:7944-7958: stale, `activity?.sent(network, pending, back, pin)` and `dropWithdrawing(..., pin)`, all checked against that pin.
lovejoin.ts:7289 and :5239: `await watchSent(this.deps, pending, {...})`. pending.ts:411-427 take: `session.set(key, record)` under the current keys, with no phrase check.

Run in a scratch mirror: symlinks to FIXTREE's src, test helpers, node_modules and wasm. FIXTREE is untouched (`git status` clean at ad8c3ce4). The file is /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/scratchpad/r51/work/L3time/ext/tests/r51-l3time-1.test.ts. Its harness is lovejoin-withdraw-submit.test.ts's due() and removedForOther(): real WebAssembly, the v2 5 ₳ pool, fake Koios and giveme.my. Core:
```
t.collateral.fetch = async (url, init) => { if (listed === undefined) listed = await removedForOther(t, lovejoin); return real(url, init); };
await lovejoin.withdrawNow("preprod", { txHash: "e1".repeat(32), txIndex: 0, pool: ADA });
// history = t.activity.seedelf("preprod") (the restored phrase's), watch = session "seedelf.pendingTx.preprod"
```
Command: `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 15m nice -n 10 npx vitest run tests/r51-l3time-1.test.ts --reporter=verbose`.

Output:
- Control: `control sent 1 ... in history true`.
- Across giveme.my's answer: `l3time#1 {"listed":[],"otherIsIn":true,"result":{"ok":"f9c3…1c62"},"sent":["f9c3…1c62"],"historyOfOther":["f9c3…1c62"],"watchInOther":"f9c3…1c62"}`.
- Across Koios's submit: `l3time#1 sibling {"listed":[],"result":{"ok":"3bf9…8949"},"sent":["3bf9…8949"],"historyOfOther":[],"watchInOther":"3bf9…8949"}`.
- Across account_info, before the build: `{"result":{"error":"That box isn't in the pool as this wallet's anymore"},"sent":[],"asked":0}`.

All 4 tests passed as written, showing today's behaviour.

**Fix:**

Take the phrase pin where Bring one back is pressed, beside `pressedOn` and before any network wait, and hand it to withdrawOne. Check it in the Withdrawing update (`this.update(..., pin)`) and in the rememberSpent turn before the submit. Make the post-submit steps use that same pin. Give watchSent/take an optional pin and check it inside take's turn, next to the session write. For publicSubmit, return publicStart's pin and pass it to watchSent.

Fix the class too: a pin must be created before the first network wait of the flow whose data it writes. Grep every `phrasePin()` that sits after an await. Two do: withdrawOne :7886, and lookUp :6275, which is taken at its origins turn's start, after the caller's pool read (see notes).

Passing `unlocked` from withdrawNowNow, as the runner does, would also close it. It would, however, refuse a Bring one back that spans a lock and unlock of the same phrase, so the pin is the narrower fix.

**Known check:**

Searched docs/backlog.md, docs/archive/plans/*.md and review-51 (INDEX.md, FINDINGS.md, owner-calls.md, lanes/*.md, verify/*.md) for watchSent, lockedWhileBuilding, withdrawNow with unlocked, Bring one back with Remove, and giveme.my with Remove wallet. r2time#2 (lanes/R2time.md) names the post-submit writers and the due runner's case. Nothing names Bring one back's missing unlock, a pin taken after the build's waits, or the watch take.

### l3time#2 · low · r2still#2's wait counts runs, not time: a Refresh, Stop or Resume seconds after the run that read every order spent tells the outcome and builds the first return from listings no newer than that run's

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:3986`
- **Who:** user · **Since:** ad8c3ce4 · **Confidence:** confirmed-by-run

**Scenario:**

Lines are FIXTREE's. This is r2still#2's swap: MIN for ADA through Lovejoin, split by Minswap into two legs paid in blocks N and N+1. utxo_info's backend has N+1, while the account listings' backend is still at N.
1. The alarm's run reads both orders spent. It records `auto.spentSeen` and returns, as the fix intends.
2. One second later the user presses Refresh on the swap's page (Swaps.tsx:2515, advance with now=true), or Stop (:3462), or Resume (:3579), or the advance after a step sent by hand (Swaps.tsx:2279). That step runs as "asked", which skips step's READ_EVERY_MS gate (:3738).
3. act checks only whether spentSeen is present (:3986), so this run tells the outcome and the fills.
4. It builds the first return from its own two listings, which are one second newer and still at block N. Leg 2 is left out, and the chain puts the 5 ₳ collateral in the pool.
5. Leg 2 (20 ₳ in the test) then comes back alone, directly, at one more fee, tied on chain to the session. The page says "its 5 ₳ collateral isn't at its account anymore, and the mixes need it".

This is the leg r2still#2 set out to bring back in the first return. Its verify note costed the fix as "one READ_EVERY_MS cycle", and an asked run in that cycle skips it.

Traced, not run: spentSeen also isn't cleared when a later run reads an order open again (:3943-3947), through a backend behind or a rollback that re-includes the fill later. The run that next reads every order spent then tells the outcome at once, with no wait.

**Evidence:**

sessions.ts:3738: `if (run !== "asked" && ((s.auto!.retry && at < s.auto!.retry.at) || at - (this.readAt.get(key) ?? 0) < READ_EVERY_MS)) return;`. Asked runs aren't spaced.
sessions.ts:3986-3991: `if (auto.spentSeen === undefined) { await this.update(network, s.index, (r) => { r.auto!.spentSeen = now(); }); return; }`. After that, only presence counts. The comment at :3983 claims "The next run's listings, READ_EVERY_MS on, tell it".
sessions.ts:3462-3476: stop sets stopping, then `await this.step(network, index, "asked")`. resume does the same (:3579-3592).
sessions.ts:3943-3947: an order read open → noteOrderOpen/cancel → return, with spentSeen left as it is.

Run in the same scratch mirror (FIXTREE untouched): /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/scratchpad/r51/work/L3time/ext/tests/r51-l3time-2.test.ts. It reuses lovejoin-planner.test.ts's helpers and r2still#2's split() unchanged. Core:
```
await sessions.advance("preprod", 0, false);           // the alarm's run: spentSeen = now, nothing sent
t.clock.now += 1_000;
await sessions.advance("preprod", 0, true);            // Refresh a second later
first = await firstReturn();
late(); await toTheEnd();
```
Command: `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 20m nice -n 10 npx vitest run tests/r51-l3time-2.test.ts -t "Refresh a second after" --reporter=verbose`.

Output:
- `l3time#2 asked run {"sinceSpentSeenMs":1000,"firstReturnBuilt":true,"firstTakesLate":false}`
- `l3time#2 end {"firstReturnBuiltAtOneSecond":true,"firstTakesLate":false,"returns":2,"lovejoinSkipped":"its 5 ₳ collateral isn't at its account anymore, and the mixes need it"}`

1 passed, asserting today's behaviour.

**Fix:**

Gate on time, not on presence, for every run including asked ones: record spentSeen if it's missing, and return while `now() - auto.spentSeen < READ_EVERY_MS`. Delete spentSeen wherever liveOrders reads an order open or ordersSpent is false, so a later sighting waits afresh.

Tests: swap-session.ts pastSpent and the planner's r2still#2 cases then advance the clock by READ_EVERY_MS between the two runs. Add the probe above, flipped, as the test: the asked run a second later builds nothing.

Stop then answers with the session stopping, and its return goes at the next run, a minute at most.

**Known check:**

Searched docs/backlog.md, docs/archive/plans/*.md and review-51 (lanes/R2still.md, verify/r2still-2.md, INDEX.md, FINDINGS.md, owner-calls.md) for spentSeen, asked run, READ_EVERY_MS, Refresh near every order spent, and split route. r2still#2 and its verify note say "the next run" and "one READ_EVERY_MS cycle". Neither considers asked runs or a spentSeen left from an earlier sighting.

## Checked and holds

- No deadlock found. Every withKeys or withAccount the round added is awaited outside any wallet task: activity update ×2, Lovejoin update ×2, sessions serial and save, submitWatched ×2, lookUp, settleWithdrawing, publicStart, withdrawOne, readAccount's withAccount, the paid build's withAccount, and pressedOn. The store calls these writers already made go through withStoreKey (private-store.ts:138,151), so any caller inside a wallet task would already have deadlocked.
- No cycle between turns. rejudge (the origins turn) and lookUp take the lovejoin turn only through update, whose change is synchronous. No lovejoin, activity, pending or reserved turn awaits the origins, withdraw, public or sessions queue. Sessions turns reach Lovejoin turns, never the reverse: mixingAgain reads the book outside serial. No wallet task awaits a sessions serial method: dapp.ts:2272 siteSigned runs after withViewKeys has resolved.
- rejudge's callers hold no origins or lovejoin turn when they call it: sortOut (from status, withdrawDueNow and withdrawNowNow), made (from againBoxes, fanOut and withdrawDueNow), and publicAgainBuild.
- Auto-lock isn't held up. Each added wallet task is short: a key hash, or fartherKeys's at most 960 derivations, once per newly known account. None awaits the network.
- A lock and unlock of the same phrase, or an account switch, never trips a pin. phraseOf is oneTime.keyHash(0), which withAccount passes through unchanged and load() re-derives identically.
- A real lock at each newly pinned writer throws WalletLocked where the store call threw it before: activity update, Lovejoin update, sessions save, submitWatched before take, and settleWithdrawing's landing. withdrawOne's post-submit steps still swallow it as best effort.
- turnPin is set after the turn's withKeys and cleared in its finally. No sessions book write runs outside a serial turn: listNow writes only with refresh, inside serial, and stillUnused, markUnsent, buildBack and sendFunding are only called from serial tasks. No detached promise writes after a turn ends.
- submitWatched: the pin comes right after writeAhead, with no network wait between them. stillMaybeSent and takeBack compare against the watched record, so under another phrase they write nothing.
- publicStart pins before its first network wait. pumpPublicNow's progress writes are guarded by ours(): the progress went with Remove.
- settleWithdrawing pins before onChain. Under another phrase its landed branch writes nothing, and the resend's update is pinned.
- A Remove and restore before withdrawOne's build is refused by WebAssembly. Run: "That box isn't in the pool as this wallet's anymore", nothing sent, giveme.my not asked.
- Bring one back's single payer holds. pressedOn feeds hatchOrder, readAccount({account}) (into readAccountUtxos and coins.account(…, account)), the build under withAccount, the RewardsChangedError retry, and paysAccounts.
- recordChain under another phrase writes no record and never runs start. Its catch's unpinned cleanup removes nothing of the restored phrase's.
- rejudge can't loop: madeBy keeps judged = accountKeys' indexes, built the same way as rejudge's accountIndexes. A 1.9.1 origin (no judged) is asked again once, and only when an account ≥ 24 is known. read() keeps inputs and judged only when they're well formed, otherwise the origin reads as one kept before. A stranger's input can't set `public`: only payment keys count, and fartherIn derives only the wallet's own keys.
- spentSeen: it's optional and absent from 1.9.1 records, and the outcome update clears it. Once an arrival is listed and the orders read spent, a run always reaches the outcome. A return by hand closes the session through the back branch, so nothing gets stuck.
- Cross-checked against the round's own tests: lovejoin-withdraw-submit.test.ts's r2time#2 cases (the due runner, the submit and tx_info windows) and remove-wallet.test.ts's submitWatched and sessions-refresh cases match the code.

## Notes

- The commit message lists activity.arrived among the pinned writers, but nothing passes its new pin: balances.ts:303 and :437 call it after their pinned turns. The window between that turn and activity's queue has no network wait in it, so nothing is reachable. It is a claim the code doesn't keep.
- lookUp's pin (:6275) is taken at the start of its origins turn, after the caller's pool read (ours). A Remove and restore during that read pins the restored phrase. Since e66a6a16, a non-public origin keeps its making transaction's input payment and stake key hashes, so the first phrase's deposit inputs (its public account's key hashes) get sealed into the restored phrase's Lovejoin record. Nothing shows them, and they drop out RECORD_KEEP_MS after no read lists that tx. sortOut's own write after the pool read is unpinned. It squares the restored phrase's due times to the first phrase's box count, sets notMixed and unsure from them, and filters leaves by the other's listing. That is transient and corrects itself at the next pool read; it is e4a#1's class and predates this round. The round's third r2time#2 test changes the phrase only during tx_info.
- landedAfter (sessions.ts:4728) compares a block's time with the device's clock (firstBack.at). On a device whose clock runs minutes fast, a stranger's payment that landed minutes after the first return reads as before it: e2b#2's strangers word is lost and the page says Lovejoin was left out. On a slow clock, r2still#2's own late leg reads as after the first return (a stranger's), and the page again says nothing. This is display only.
- While spentSeen is set and the outcome isn't told, stopCost (Stop's dialog) still counts the swap as an open order (`out`, its cancel model). The same window existed before, between the fill and the runner's next run. It is now at least one run longer, and across an auto-lock it lasts until the next unlock, since the runner doesn't run while locked.
- rejudge's kept inputs aren't deduplicated. A deposit under the wallet's register with hundreds of inputs from one address stores each one (about 100 bytes) in the sealed schedule, until RECORD_KEEP_MS after its box was last listed. The cost is bounded by the box the depositor pays the wallet.
- Predates this round: the sessions-refresh pin test shows restore-wallet waiting behind the old phrase's in-flight sessions turn (markUnscanned is serial) for as long as that turn's network calls take.

## Coverage

FIXTREE at ad8c3ce4. Line numbers in findings are FIXTREE's.

Read in full:
- COMMON.md.
- The source diffs of ad8c3ce4 and e66a6a16.
- wallet.ts 180-700.
- account.ts.
- pending.ts 378-960 and 1055-1141.
- activity.ts sent, arrived and update.
- lovejoin.ts: publicStart, publicSubmit, the head of pumpPublicNow, recordChain, sortOut, found, made, lookUp, madeBy, fartherIn, rejudge, inputsOf, accountKeys and accountIndexes, readSet, read(), update(), withdrawDueNow, withdrawNowNow, withdrawOne, dropWithdrawing, settleWithdrawing, resends, bringAllBackNow's loop, the head of publicAgainBuild, reserving and inTurn.
- sessions.ts: step, act (3733-4033), stop, advance, resume, runAll, stopCost, the head of buildBack with its strangers rule, sendChain, listNow's write path, freshIndex, stillUnused, book, save, update, atStake, clearMixes, serial and reset.
- handlers.ts restore and reset, and sw.ts's wiring.
- The review's R2time and R2still lane reports, owner-calls.md, and the r2still-2 verify excerpts.
- ad8c3ce4's new tests (lovejoin-withdraw-submit, remove-wallet, the planner's r2still#2 block, swap-session pastSpent).

Skimmed: the rest of lovejoin.ts and sessions.ts; private-store get and set; accounts.known; coin-control.account; collateral.ts's timeout; chain.ts fartherKeys; Swaps.tsx's advance callers; dapp.ts's sessions calls.

Not reached:
- The other round-two commits (61a4d717, b3687869, 81516188, e4b's, 2d639df8, 7b6881f7, the CLI, koios and verification commits).
- The e2e tests.
- parts.ts.
- dapp.ts beyond its sessions calls.

Ran (my two probe files only, no whole suite or build):
- A scratch mirror at /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/scratchpad/r51/work/L3time/ext, made of symlinks to FIXTREE's src, test helpers, node_modules, configs and ../wasm.
- r51-l3time-1.test.ts: 4 tests passed.
- r51-l3time-2.test.ts: 1 test passed (-t filter).
- FIXTREE's `git status` is clean.
