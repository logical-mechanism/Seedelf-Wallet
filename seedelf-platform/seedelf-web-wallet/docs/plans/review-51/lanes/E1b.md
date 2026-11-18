# Lane E1b

Returned by the workflow's agent `a6283ba98ae0a2090`, written here by the lead from its structured answer.

## Findings (1)

### e1b#1 · low · Bring every box back meets a service-wide refusal box by box: a build, an account_info and a giveme.my request for every box, three runs over

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:7412`
- **Who:** user · **Since:** web-wallet/1.6.0 (ad03ff78, the loop's catch); the per-box account_info since 1.8.1 (7a8c9eeb) · **Confidence:** traced

**Scenario:**

The user has 40 boxes in the v2 5 ₳ pool and presses Settings → Bring every box back while giveme.my is answering 429 (or is unreachable, each request waiting out its 20 s timeout), or while Koios's submit is answering 429. Each run of bringAllBackNow walks `takes` box after box for up to BRING_RUN_MS (2 min): for every box withdrawOne reads the pool's mix_logic account (account_info), builds and proves the withdraw in WebAssembly, and asks giveme.my to sign it. Every attempt fails the same way, the catch records `why` and goes on to the next box, so one run asks giveme.my 40 times (with Koios at 429, giveme.my signs 40 withdraws that are then all refused). The alarm's next run a minute later does the same, and only the third run with nothing sent stops it (BRING_FAILED_RUNS). That's about 120 giveme.my requests and 120 account_info reads in roughly three minutes while the service is asking the wallet to slow down. That can stretch giveme.my's limit on this IP, and the user's other private spends depend on giveme.my too. The regular runner takes one box a run, so only this loop does it. Nothing is lost: the cost is the requests, the CPU and a longer outage for the user's own spends.

**Evidence:**

lovejoin.ts:7368 `for (const box of [...inPool(takes, CLASSIC), ...takes.filter(...)])` with `if (now() >= until || !(await this.read(network)).bringing) break;` (until = now + BRING_RUN_MS, :7352).
lovejoin.ts:7407-7414: `} catch (e) { if (isTrap(e)) throw e; if (e instanceof WithdrawMaybeSent || (await locked())) break; why = e instanceof Error ? e.message : String(e); }`: any other failure moves on to the next box.
withdrawOne per box: :7572 `const rewards = rewardsField(await this.rewardsIn(network, [pool]));` (one account_info, readRewards :4672); :7636 `buildLovejoinWithdraw`; :7637 `await this.deps.collateral(network).witness(built.txCbor)` (private-paid path :7625, after a readContract :7601).
collateral.ts:82-90: a 5xx or 429 throws `CollateralRefusedError(..., busy)`, and a fetch failure throws `CollateralError` (:64-68, 20 s TIMEOUT_MS). Neither is WithdrawMaybeSent, so the loop goes on.
Koios 429 at submit: :7698 `const refused = e instanceof KoiosError && !(e instanceof KoiosBusyError && e.maybeSent);` → :7703-7712 neverWent, forgetWithdraw, `throw e`. That's a plain KoiosBusyError back in the loop, after giveme.my already signed.
bringNoted (:7426-7448) counts a run only once it ends, so three runs go by before `b.stopped` (BRING_FAILED_RUNS = 3, :1707).
By contrast withdrawDueNow (:6936-6945) takes one box a run.
No test drives Bring every box back with giveme.my busy (grep of tests for Bring + 429/busy found none).

**Fix:**

In bringAllBackNow's catch, end the run (break) on a failure that isn't the box's own, as it already does for WithdrawMaybeSent. That covers a CollateralRefusedError with `busy`, a CollateralError that isn't a refusal (unreachable or timed out), and a KoiosBusyError refused at submit. Keep `why`, so the count of runs that sent nothing still stops it after three. A box-specific failure (NO_PRIVATE_PAYS, a refusal naming that box) still passes that box over. withdrawDueNow already takes one box a run, so this loop is the only member of the class. Optionally read each pool's reward account once per run and hand it to withdrawOne (takingFrom already makes every later box read as taken). Test: a Vitest with three boxes and giveme.my answering 429 that asserts one witness request per run.

**Known check:**

Searched docs/backlog.md and docs/archive/plans/*.md for 'Bring every box back' together with giveme/429/busy/rate, and for 'passed over' and 'run that sent nothing'. Also read review-1.8.1.md (reward race, Not fixed, Left open) and the backlog's Lovejoin section. None of them covers a service-wide refusal met box by box.

## Guards (28)

| Where | What it stops | Test |
|---|---|---|
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:227` | a pool's start paid from the public account without the user saying so (who pays must be named) | tests/lovejoin-flows.test.ts 'never pays from the public account unless asked to (34d's review 8)' |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:237` | an ADA pool at the classic pool's 10 ₳, which no wallet shows, its launch's locked ADA buying nothing | tests/lovejoin-flows.test.ts 'refuses what isn't a pool to start' (classic pool's value) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:246` | a start copying a shown v2 pool's values (never shown), read after discovery's look | tests/lovejoin-flows.test.ts 'refuses what isn't a pool to start' and 'looks for pools launched since before it calls a start a copy' |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:258` | boxes too small to come back and pay part of themselves under today's parameters, and (259) a token box over its most | tests/lovejoin-flows.test.ts 'refuses what isn't a pool to start' ('at least', 'at most 9') |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:235` | a token quantity of 0 or past what one output holds (2^64−1) | tests/lovejoin-launch-review-fixes.test.ts (MAX_QUANTITY), tests/lovejoin-flows.test.ts ('whole number above zero') |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:390` | Send asked again for a review whose bare build went: said sent, never rebuilt into a copy of the pool sent | tests/lovejoin-flows.test.ts 'says a start Send sent in its review's place went already' |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:429` | sending the build without the certificate when it makes another pool whose credential nothing registered (never shown, ADA locked for good) | tests/lovejoin-flows.test.ts 'never sends another pool than the one reviewed, unless its credential is registered too' |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:337` | the bare private build picking UTxOs (and histories) the review never showed: it spends only the reviewed build's inputs | none found by name (lovejoin-flows 'starts a pool from the private balance' checks the same pool only) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-rewards.ts:35` | a balance that isn't a whole number, or exceeds all the ADA there is, being taken (read as none) | tests/lovejoin-reward-balance.test.ts 'reads a balance that's no whole number, or past all the ADA there is, as none' |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-rewards.ts:87` | a second take of a balance the wallet's own transaction on its way already takes | tests/lovejoin-reward-balance.test.ts 'takes none while the wallet's own transaction on its way takes it' and the mutants#5 block |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:5184` | sending a public mix (or Mix again) whose pool's reward balance moved since review: rebuilt instead, nothing sent | tests/lovejoin-reward-balance.test.ts 'is a review to make again when the balance moved before Send, with nothing sent' |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4722` | a public mix built or kept while the last one from the account is still being sent (the account paying twice) | tests/public-mix-start.test.ts, tests/collateral-held.test.ts ('still being sent') |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4723` | sending a public mix whose review reservation another build replaced (its boxes may be drawn twice) | tests/public-mix-start.test.ts, tests/handlers.test.ts ('isn't ready to send') |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4726` | two of the wallet's chains spending one box (the second reserver is refused and rebuilt) | none found by name |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4824` | sending a chain whose first mix (each leg's first) the network measures higher than the wallet: collateral at risk | tests/lovejoin-flows.test.ts, tests/lovejoin-1-5-0.test.ts (evaluate answers) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4546` | giveme.my's coin put up for a collateral mix the network measures higher, or one a drawn box of is gone | tests/lovejoin-chain-review-fixes.test.ts (tail), approximate |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:5082` | Mix again's boxes paid by an account other than the one they were picked for, after a switch (ties two accounts) | tests/lovejoin-accounts.test.ts, tests/lovejoin-accounts-review-fixes.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:5318` | a public mix's first transaction (spending the account) forgotten across a lock: marked maybe-sent before its first submit | tests/public-mix-unsure.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:6873` | withdrawing a box that a built chain or review of the wallet's will spend | tests/lovejoin-bring-review-fixes.test.ts (boxReserved), approximate |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:6921` | a box of unknown making (possibly a deposit's) coming back by itself and showing where it went in | tests/lovejoin-restore.test.ts, approximate |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:7047` | Bring one back taking an unmixed, untold or chain-stopped box without the user's 'anyway' | tests/lovejoin.test.ts, tests/lovejoin-restore.test.ts, approximate |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:7277` | Bring every box back taking a box a chain or review will spend, or a session's collateral box its mix still waits for (unmixed tie) | tests/lovejoin-bring-review-fixes.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:7643` | sending a withdraw whose hash changed in finishing or signing | none found |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:7644` | sending a withdraw built across a lock and unlock (outside the new unlock's draw) | tests/lovejoin-withdraw-submit.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:7666` | a withdraw sent but forgotten (lock, closed browser): kept sealed and its box held as spent before submit, so it's never sent twice or lost | tests/lovejoin-withdraw-submit.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:7698` | freeing a box whose withdraw may have reached a node: only Koios's refusal (not a maybe-sent 429/5xx) lets it go | tests/lovejoin-withdraw-submit.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:7709` | a withdraw refused for a moved reward balance retried endlessly in one call: rebuilt once, then given up with its due time back | tests/lovejoin-reward-balance.test.ts 'a way back built again after a refusal for a moved balance' |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4383` | a session's 5 ₳ collateral mixed into a pool under its floor or with fewer than two other boxes free | none found by name |

## Checked and holds

- lovejoin-rewards.ts holds together: readBalance, takesOf, takingFrom, balanceAfter, rewardsField, readsFor and moved agree with each other and with spent.ts reservationOf's `takes`.
- The reward account the worker names (rewardsIn: header f1 on mainnet, f0 on preprod, plus the mix_logic hash) is the same lowercase hex that cbor.ts txWithdrawals returns, so in-flight takes are matched.
- rewardsIn/readRewards/rewardsOf: one account_info per pool per build, reused across unstale tries and four's fall to three. An unanswered read builds on none and says nothing at Send.
- publicStart checks rewardsMoved, the copy, a maybe-sent payment and an unsettled mix before it records or reserves anything. holdOnly keeps a maybe-sent step's `takes` held.
- acrossOf (4000–4143): `firsts` index each leg's first mix exactly as core's chain_across orders the chain (one deposit, then each leg's mixes). Each leg's leaves are named by its pool, the ways' boxes come from `built.legs`, and a failed cross-check unreserves.
- crossCheck's additional UTxOs (the chain's deposit and the transaction before) are exactly what a leg's first mix spends that isn't on chain. The collateral tail is never cross-checked there; tailWitness measures it.
- lovejoin-launch.ts: the copy checks (v2 values, the classic 10 ₳), box least/most, maxFee under the box, choose()'s registered/other-pool rule and the 'sent already' answer for the reviewed hash all hold. The bare private build gets only the reviewed inputs, and recordLaunch records v2 with `reviewed`.
- withdrawOne: the due time it takes is put back on any refusal and again across the RewardsChangedError retry. Hash and unlock checks run before submit. The history's figures are right: the private-paid lovelace is the output less the paying UTxO, and the public-paid one has no fee.
- WASM backs the worker where it matters: PoolBox::points refuses identity points, so no stranger's box reads as every wallet's; chain_from_account_at's check_paths refuses another account's UTxOs (publicBuild has no account check of its own); finish_withdraw checks giveme.my's signature over the unchanged body.
- withdrawDueNow's due times are counts per pool and heal themselves (scheduleFound, setDue). A box Koios says a deposit made becomes held at the next read, never stuck as first. Ripe, waited and quiet pushes all move its due time.
- Bring every box back's end conditions hold as 1.8.0's review left them: mayLand, confirming once it sent one, chains recorded or scheduled since. So do its widening rules (every pool's over a pool's, the retired pools' over a retired pool's), the Stop and failed-runs recheck, and the `counted` once-only countBack.
- retireOnce decides only with every named pool known, writes nothing for a wallet with nothing in a retired pool, and never runs over a v2 pool's going run.
- The tail rules hold: sessions passes tries + 1 to recordChain; TAIL_KEEP_MS runs from the deposit's landing (`landed` carried on); a retired pool's tail is over; tailOf marks cut chains first.
- pumpPublicNow handles a write that fails after a successful first send (marked, next 0, not refused → maybe), holdOnly vs release, and ChainGone (no write back) correctly.
- madeBy/keysOf parse CIP-19 headers right for payment credentials (types 0–7) and stake keys (types 0, 1, 14). A stake key alone never makes an input an account's, and Koios alone (koiosAlone) is asked for boxes the index doesn't cover.
- The figures check out: status() and held() multiply box counts by box values and token quantities by box counts. A public mix's `taken` is counted once in Lovejoin.tsx publicAfter (before − boxes − fees + taken), not again through `change`.
- The WASM wordings the worker matches are current: NO_PRIVATE_PAYS (wasm lovejoin.rs:2828) and 'pool has N boxes' (core lovejoin/mod.rs:2498).
- No module-level eager t(). Translated `stopped` and `why` are only displayed and read for truthiness; wasCut compares the legacy English alone.

## Notes

- For the owner, a new fact on the backlog's reward-race line (readers#2: 'a take that landed counts as on its way for up to two hours, so a new balance as large reads as none'). withdrawDueNow only ever tries the earliest due box across every pool read, and it retries that box every minute with no backoff when its withdraw fails before it's kept (lovejoin.ts:6857-6862, 6936-6945). So a refusal across one whole pool, such as readers#2's balance read as none for two hours, also holds every other pool's due boxes for as long as it lasts, at two builds and two giveme.my requests a minute. I found no other trigger: a stuck pool's box moves its due time (STUCK_WAIT_MS), and giveme.my down blocks every withdraw anyway.
- LovejoinService.schedule() (lovejoin.ts:5455) has no caller in src/; only tests call it (lovejoin.test.ts, lovejoin-pools.test.ts, lovejoin-1-5-0.test.ts, run-traps-review-fixes.test.ts). Test-only API in the worker, a nit.
- Wording nit in publicStart: the kept review's reservation gets `until` in checked() (:4978), before the network's check, while `builtAt` is set after it (:4944). A Send in the last seconds of the ten minutes therefore gets 'That mix isn't ready to send' (NOT_READY from reserve's held check, :4723) instead of 'built more than 10 minutes ago'. Both end in a fresh review.
- held() (:6717) shows a token pool's boxes on their way back at 0 ₳ when the kept read set lacks that pool. It's marked retired: true there, which only happens when discovery's kept record can't be read. Display only.
- publicBuild (:4845-4917) has none of publicAgainBuild's `keys.account !== account` check (:5082). A switch of account mid-build can't sign another account's UTxOs, because WASM's check_paths refuses them, so nothing wrong is signed.
- Bring every box back also reads the pool's mix_logic account once per box (withdrawOne → rewardsIn, :7572), though after the first take every later box in the pool reads as taken. One read per pool per run would do. That's in e1b#1's fix.
- The backlog's reward-race lines (worker#2, readers#2, readers#3, worker#3), the 'Koios behind' naming line, the collateral mix's way out, TAIL_TRIES counting a lock, a box's dropped withdraw counting back twice and the resumed tail not reserving at build all still hold as written. None of my three files changed since 1.8.1 (96f9b40d), and I saw nothing new beyond the first note.
- Out of my lane, for whoever owns sessions.ts: after tailWitness, sessions.ts:5429-5430 swaps in the finished CBOR without comparing hashes. That's safe today, because finish_withdraw only adds a witness after checking giveme.my's signature over the same body hash.

## Coverage

Read every line: seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts lines 4000-8048, lovejoin-launch.ts (all 460 lines) and lovejoin-rewards.ts (all 122 lines).

Read for context in lovejoin.ts (E1a's half, not reviewed line by line for findings):
- the header and constants (1-640);
- the types and the sealed schedule (640-1610);
- the helpers my half calls (1676-2600: unmixedOf, recorded, knownOf, mixedOf, depositsOf, moreThanDue, unschedule, backOrder, originOf, carriedOf, ripeAt, madeSince, depositAccountOf, moveDue, takeDue, empty, countBack, holderOf, moveOn, squareUp, bootstrapOf, stillIn);
- narrower and withinDepth (2600-2811);
- the class's fields, readSet, verifiedPool, progress, onChain, watchOf, cantComeBack, listing, poolRows, ours and plan (2811-3410);
- acrossOf's head (3899-4000).

Followed out of my paths:
- spent.ts reservationOf and reservedSet; sent-txs.ts (whole); incoming.ts goingOut; cbor.ts txWithdrawals;
- script-spend.ts keep, send and readContract; contract-scan.ts readContractView's head; collateral.ts (whole);
- sessions.ts recordChain's record, tailWitness, tailReserve and the reward reads; lovejoin-pools.ts serviceDeps and the shown rule's classic value; koios.ts accountInfo;
- wasm lovejoin.rs owned_in, our_box, withdraw_in, finish_withdraw, chain_across_pools, with_return's head and again_from_account_at;
- core lovejoin/mod.rs PoolBox::from_row, points, is_owned, chain_across and Rewards;
- Lovejoin.tsx publicAfter.

Docs: backlog.md's Lovejoin section, review-1.8.1.md, privacy.md's Lovejoin lines, chunk 34's launch-measurement notes.

Tests: grepped for test names and phrases to pin guards; I didn't read their bodies, beyond lovejoin-flows.test.ts's launch block (820-1065).

Not reached: E1a's half in detail (fanOut, chain, againBoxes, funding, fits, room/rooms), lovejoin-pools.ts beyond serviceDeps, and the screens. Ran nothing but read-only greps, git log and git blame.
