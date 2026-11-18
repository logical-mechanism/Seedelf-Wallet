# Lane gap G9

Returned by the workflow's agent `af17b71d60a14e213`, written here by the lead from its structured answer.

## Findings (2)

### gap-g9#1 · medium · With the phrase open in a second profile, every private transaction made there reads here as a payment received, so this profile's session fundings take the other profile's session money first, tie the two sessions on chain and say nothing

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/activity.ts:445`
- **Who:** user · **Since:** ade9dd1a (2026-09-24, arrivals noted as received) with 366cd5c6 (2026-09-27, privacy review §2.3 ranks); the separate-profile advice since 2570c2f1 (2026-09-28). Before web-wallet/1.0.0, in 1.9.1 (its privacy.md:84-89 and :179-180 say the same) · **Confidence:** traced
- **Needs the owner:** It changes which money selection takes first for fundings and the stealth mint (a privacy default), how Activity and the CSV name such rows, and privacy.md's wording.

**Scenario:**

The user follows privacy.md:349 ('A separate Chrome profile keeps cookies apart'). Profile A is the main one, and profile B (the same phrase, restored there) is used for sites. Profile A made 500 ₳ (U) and 60 ₳ (O) private from account 0, so both are A's own money, public:0. (1) On B, the user connects a dApp through a private session S_B (index 7). Its funding F_B spends U, pays the one-time account 105 ₳ plus reserve, and returns about 394.6 ₳ of change C to the contract under a fresh register. On B, C is session 7's money: origin session, Fund rank 5, tier 1. (2) A's next balance reading finds U gone and C new. arrived() notes C as kind 'received' with no origin, because F_B isn't in A's history, so classOf gives received:<F_B>. A's private Activity now shows 'Received 394.6 ₳' and nothing for U's spend, and its Save as CSV exports that as a receipt. The UTxOs screen tags C 'Received'. (3) On A, the user starts a private swap whose funding needs about 37 ₳. buildFunding uses Purpose::Fund. one_more tries single UTxOs by (rank, lovelace): C at rank 1 (Received) before O at rank 4 (Own). C pays alone, so F_A spends C. On chain F_B -> C -> F_A, so swap session S_A and site session S_B are tied to one owner. The site that saw S_B's account can follow C to S_A and its Minswap order. A's review shows no note: spentHistories gives [received:<F_B>], one class and no session, so historiesNote says nothing. One device holding the same UTxOs would have taken O first (rank 4 before session 5). Had it taken C, its review would say 'It spends money that <session> left, so anyone can tie that session to this one' (en.json:760). The same misclass makes the stealth mint take the other profile's session or change money first (Mint: Received 0, Session 4), under mint.privacy.fromPrivate's 'Only money others paid you keeps the Seedelf apart'. It also makes B's Lovejoin box-backs (withdraws) read on A as payments received. Send then merges them at tier 0 instead of boxes' tier 2 (last, one at a time). Its review counts them as 'payments you received' and never adds the 'largely undoes the mix' sentence (histories.ts:184-185, :210). The other profile's session returns and every private Send's change read here as receipts too.

**Evidence:**

activity.ts:427-470 arrived(): `const ours = new Set(h.entries.filter((e) => e.kind !== "received").map((e) => e.txHash));` then every fresh owned UTxO not in `ours` (and not a Seedelf token) becomes `kind: "received"`, with origin Unknown only when `h.first && before(u)` (:449), the first reading. activity.ts:646-669 classOf: `case "received": return receivedIn(entry.txHash);`. The history is sealed per profile (`history.<network>`, activity.ts:390). build.rs:2401-2411 Fund ranks: Received 1, Lovejoin 2, Unknown 3, Own 4, Session 5. :2394-2399 Mint: Received 0 ... Session 4. :2419-2425 tier: Lovejoin 2, another session's (Fund) 1, else 0. :2603-2628 one_more sorts `(rank(u), lovelace_of(u))` and returns the first that builds. sessions.ts:3071 `funding: { session: sessionClass(index).id }` (Purpose::Fund), :3090-3093 summaryOf/spentHistories. script-spend.ts:201-205 spentHistories returns `all.slice(0, 1)` for a single input. shared/histories.ts:173-219 historiesNote: no note for one class; :216-218 the session note only when the spent classes name another session; :210 `lovejoin = boxes ? t("histories.privacy.lovejoinUndone") : ""` counts only `box:` parts. histories.ts:81 REACH puts 'session' first, so on the profile that made it the funding's change (sessions.ts:3093 `merged([changeHistory(...), sessionClass(index)])`) is origin session. Promises: privacy.md:170 'a session's funding takes received money or a single box, and another session's money last'; :171 'A funding also names money another session left'; :107 received money 'hides the payer'; :173 limits the other-browser caveat to 'whatever its first reading finds'; :349 recommends the separate profile; flows.md:110 'the wallet's own change ... don't count' as arrivals. tests/history-classes.test.ts:31-57 pins 'what arrives after as received' for a stranger's payment. The device has what it needs on mainnet: private-index.ts:44 and :50-53 give each spent row's spender (`spent.by`, IndexSpent.by), and contract-scan.ts:300 reads changes.spent but keeps only the refs (`gone`), dropping `by`. Read by hand, no command run (finder).

**Fix:**

Tell the other profile's own transactions from payments received. On mainnet, contract-scan already gets, for each of the wallet's rows spent since the cursor, the transaction that spent it (`since.spent[].by`, `created[].spent.by`). Keep those spenders and hand them to activity.arrived(). An arrival made by a transaction that spent one of the wallet's own rows is the phrase's own spend made elsewhere: note it with origin Unknown (or an 'elsewhere' class ranked with Unknown), never received, titled so in Activity and left out of a CSV's receipts. Do the same for box-backs: an arrival whose transaction spent one of the wallet's boxes (the pool feed's spent.by) is boxFrom(tx). On Koios, which gives no spender: a reading in which an owned UTxO vanished that this device didn't spend classes that reading's arrivals Unknown. Whatever the code does, privacy.md:173 and :349 should say what another profile's later transactions read as here. The family, one root (arrived() takes everything not in this device's history for received): gap-g1#1 (a payer who reveals d), gap-g1#2 (site-signed own payments), G1's note (Make private in another browser), and this (every private transaction of another profile).

**Known check:**

Searched backlog.md and docs/archive/plans/*.md for 'another profile', 'another browser', 'other device', 'two profiles', 'same phrase', 'received', 'as received', 'read as received', 'history of its own', L38, M7, F3. Read the hits: L38 covers only the first reading; M7 and F3 are an own return read as received on one device, rated medium there; chunk-26/26b are about the view, not the class. Searched the review-51 lanes and verify/ for the same words. G1's note (lanes/gap-G1.md:104, :156) raises the Make private case only, as wording for the owner; gap-g1#2 is site-signed payments. Not in INDEX.md.

### gap-g9#2 · low · Lovejoin's way-back rules are per profile: with the phrase unlocked in two, each brings back the other's boxes on its own schedule, right after the other's sends and withdraws, oldest first, and over the other's chains

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:6852`
- **Who:** user · **Since:** d74677a9 (2026-09-27, privacy review §3.1: the quiet rule and one box a run) and 5364a60d (2026-09-27, §3.6), with the separate-profile advice from 2570c2f1 (2026-09-28). Every rule reads only the profile's own storage. In 1.9.1 (its privacy.md:179, :221-226) · **Confidence:** traced
- **Needs the owner:** Either a timing default for the withdraws changes (wait after activity this profile didn't make) or privacy.md's timing promise and the separate-profile advice change: both are the owner's.

**Scenario:**

Profiles A and B hold one phrase on one machine (one IP), as privacy.md:349 suggests for sites, and both are unlocked. B has used Lovejoin once: a site session's return goes through it by default. So at each unlock B reads the pool, finds the wallet's boxes no record of its own accounts for (moreThanDue, then found), learns from made_by or tx_info that a mix made them, and gives each its own due time from now (scheduleFound/draw). A's swap return put 6 boxes in the 5 ₳ pool 3 h ago: A drew 6 due times, and B drew 6 more for the same boxes when it found them. (a) At 14:00:10 A's alarm withdraws box 1, its quiet rule happy. At 14:00:40 B's alarm finds a ripe due time. B's sends() has nothing (seedelf.sends and the spent marks are in B's own session storage), it has no `withdrawing`, and chainsMixing is false, so it withdraws box 2 at 14:00:50. Two of the wallet's boxes come back into Seedelf in consecutive blocks from one IP. privacy.md:443 says one at a time, 5 to 60 minutes apart; :449 says back-to-back withdraws tell anyone they're one person's; lovejoin.ts:6797 says 'two a minute apart say they're one owner's'. Likewise, A's Make public at 14:00:00 is followed by B's withdraw at 14:00:30 (:442: never within 5 minutes of the wallet's own send). (b) If both profiles go for the same box, the one Koios refuses runs neverWent: its due time goes back, still due, and its next run, a minute on, takes another box, at once after the other's. (c) While A sends a Mix my boxes again chain, which takes A's mixed boxes too, B's due withdraw can take one of them. A's mix that spends that box is refused, the chain stops after its spent retries, A's mix session's rest comes back directly, the fees of what went are spent, and the boxes it didn't reach wait not mixed yet. One device withdraws nothing while a mix again or any chain is mixing (lovejoin.ts:51, :6793-6796). (d) B has none of A's leaves, so backOrder puts the oldest box first. That is usually A's last mix's leaf, still where A's mix left it, which points straight back at A's session: privacy.md:444 and §3.6 say a box someone else's mix moved goes first. (e) Each box has two due times, and line 6831 keeps the earliest, so boxes come back at the first of two schedules. (f) B's Bring every box back now can't see A's chains (madeSince, tailBoxes), so it takes a mix A sent after the ask minutes after its mixes, and A's collateral's box while A's tail waits. privacy.md:446 says a mix sent after the ask keeps its waits. No money is lost or misdirected.

**Evidence:**

Per-profile inputs to every gate: wallet.ts:80 SESSION_SENDS ('seedelf.sends', chrome.storage.session); spent.ts:29-30 and :137-140 lastSpentAt over SESSION_SPENT in chrome.storage.session; the schedule `lovejoin.<network>` sealed in the profile's local storage (lovejoin.ts:7912-8019); reservations in session storage (spent.ts:183-224). The gates: lovejoin.ts:6793 `if (await this.deps.mixingAgain?.(network)) return [];` (sessions.ts's own book); :6796 chainsMixing (own records); :6798 settleWithdrawing (own `withdrawing`); :6852-6858 one box a run and :6926-6934 the others' WITHDRAW_SPREAD_MS (own due times); :6901-6912 `const { sent, forgotten } = await this.deps.wallet.sends(); ... quiet(now, sent, forgotten)`. Found boxes: :6129-6153 found() asks when moreThanDue (:2042-2062); :6827 scheduleFound -> :5467-5490 draw from `now`; :6831 `setDue(s, p, [...].sort(...).slice(0, inPool(back, p).length))` keeps the earliest. Box order: :2108-2113 backOrder `own(b) = leaves.has(ref(b))`, with :2297 ownLeaves from the profile's own chains and `s.leaves`. Refusal: :7698-7704 `refused` -> neverWent (due time back) and forgetWithdraw; :6939-6944 'It never went: its due time is back, and it's tried again at the next unlock or alarm.' Bring every box back: :2226-2234 madeSince reads only own chains; :7276 tailBoxes from own records. runs.ts:93-102 run per profile's alarm. Promises: privacy.md:440-446 (timing, one at a time, the box that goes, Bring every box back's 'A mix sent after it's asked keeps its boxes' waits'); lovejoin.ts:51 'While any chain is being sent, no box is withdrawn at all.' Read by hand, no command run (finder).

**Fix:**

At least say it: privacy.md:440-446 and architecture.md's Withdraws should say the rules hold per browser profile. With the phrase unlocked in two, each brings back the boxes the other mixed on its own schedule (the second with none of the first's records, oldest first), and neither keeps away from the other's sends, withdraws or chains. privacy.md:349's advice should carry that. To make the rules hold, treat the wallet's own activity on chain that this profile didn't send as a send, from what it already reads: a contract row of the wallet's spent, or a new one arrived, within QUIET_AFTER_SEND_MS by block time (the private index's since answer gives both, with spenders), or a box of the wallet's in the pool spent or newly made by a transaction this profile has no record of (the pool read lists the wallet's boxes). Push the withdraw a fresh spread then, as for an own send. The class: every per-profile gate (the quiet rule :6901, one box a run :6852/:6926, the holds :6793-6798, §3.6's leaves :2108/:2297, Bring every box back's madeSince :2226 and tailBoxes :1493).

**Known check:**

Searched backlog.md and docs/archive/plans/*.md for quiet, QUIET_AFTER, 'one a run', 'one at a time', burst, 'back to back', 'another device', 'other device', 'two devices', 'another browser', 'two profiles', §3.1, §3.6, M10, M11, L8. Read privacy-review §3.1 and §3.6, independent-review M10 and M14, chunk-34's 'Left, low, two devices only' (a Bootstrap's entry, not timing) and chunk-44's second-device note (the retired pools' run only). Checked INDEX.md: x4#1 is a send during one profile's withdraw build; gap-g3#1 is the runner after one profile's withdraw. Neither is about two profiles. Nothing records the rules being per profile.

## Guards (14)

| Where | What it stops | Test |
|---|---|---|
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:6228` | A new session funded on a one-time account another profile, or a reset, funded since its review: stake key and payment key asked again just before Send, and next moved past it | tests/session-index.test.ts:66 'isn't sent to an account another browser funded after it was reviewed' |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:6201` | A new session's index taken blindly from this profile's book: next is asked alone, then 20 at a time once used | tests/session-index.test.ts:156 'asks about the one account it's about to use, and no other' |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:1331` | A funding sent twice from a page that missed the answer, or a stale review funding a second session on an index taken since | none found by name |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:2818` | The restore scan writing 'nothing found' from a Koios backend behind the one that showed an account used (and :2787 pin: never into another phrase's book) | tests/restore-scan.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/pending.ts:572` | A submit cut off by a lock, a closed browser or a stopped worker being forgotten and the payment built and paid again: watched as maybe sent and sealed before Koios is asked | tests/write-ahead.test.ts; tests/maybe-sent.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/pending.ts:969` | A new payment built beside one that may still go through, on this profile, across a lock too | tests/maybe-sent.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/pending.ts:915` | A maybe-sent payment let go on age while it waits in a mempool, or held for good once what it spends is spent by another (the other profile's conflicting spend included) | tests/mempool-watch.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/spent.ts:113` | Freeing a refused transaction's input that another transaction of this profile spent since (forgetSpent's `at`) | tests/maybe-sent.test.ts (by name) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4718` | Two of this profile's chains spending one pool box or input; the one that reserves second is built again without them (L27) | tests/chain-reservations.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:7698` | A withdraw Koios refused (the box taken by another profile's withdraw, say) left held as sent: its record goes, its box is freed and its due time is back | tests/withdraw-refused-locked.test.ts:98 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:6798` | A second withdraw while one that may have gone through is unsettled (looked for, resent, dropped after SPENT_KEEP_MS) | none found by name for withdrawDue's hold |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:5195` | A second mix from the public account built while one that may have gone through is unsettled, so the account never pays for one twice (L5), within one profile | tests/public-mix-start.test.ts; tests/public-mix-unsure.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:7644` | A withdraw built across a lock and an unlock being sent | tests/lovejoin-withdraw-submit.test.ts:178 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:5584` | A return merged into a funding's change another profile spent: refused, its contract view is read in full next time rather than built on again | none found by name |

## Checked and holds

- Session indices across profiles: every funding path takes freshIndex (sessions.ts:1920, 2032, 2242) and calls stillUnused at Send (2140, 2323, 3151). The scan moves next past every used index (2837). Only near-simultaneous fundings can share an account, as documented (privacy.md:350, :370, :372).
- A profile whose book is behind skips what the other used. freshIndex asks the chain at the book's next. stillUnused also checks the payment key and moves next past a used index (6236-6240).
- pending.ts across profiles, maybe-sent case. A maybe-sent payment whose input the other profile spends is let go as unseen after 20 minutes: a resend is refused, mempool() sees the input spent, inMempool goes false. Its history is never written, since a maybe-sent one is written only once seen (:773). No money moves wrongly.
- pending.ts across profiles, refused case. The other profile's conflicting submit refused by a node that holds this profile's transaction is refused cleanly: submitWatched takes back what it wrote ahead and forgets the contract view (:479-494).
- A withdraw refused because the other profile took the box frees the box and gives its due time back (lovejoin.ts:7698-7704). Nothing stays held but in the maybe-sent case (notes).
- Boxes are found the same way on both profiles (lovejoin.ts:3318-3361). Deposit-made boxes are held as not mixed yet, a public account's for that account, a Bootstrap's as deposit-made. No box is stranded and no box is spent twice: only one withdraw of a box can land.
- A public mix's maybe step settles when the other profile's spend takes one of its inputs ('spent', lovejoin.ts:5797-5806), so no mix from the account waits for good.
- Reservations are per profile, so the other profile's chain can draw a stranger's box this one reserved. That is the same collision any other user's mix makes: the chain stops after its spent retries, the rest comes back directly, and no money is lost.
- runs.ts runs per profile. A failure on one network never stops another's. Withdraws go last within the profile.
- spent.ts: what the other profile spent shows at once through the data layer's since answer (contract-scan.ts:300). On Koios it shows at the next full read, as documented (architecture.md:342).
- Profile B's restore scan never writes into another phrase's book (pin), and found sessions end by themselves once emptied elsewhere (sessions.ts:1264, 5710).
- The other profile can't spend this profile's session accounts unless its scan found them and the user brings them back by hand. Then C18 applies (backlog line 122).

## Notes

- E9a's note, traced for the critic. A private Send whose submit Koios answered gets its history entry at once (pending.ts:533). If the other profile's spend of the same UTxO reaches another mempool at about the same time and wins the block, this one is dropped. The watch removes it after WATCH_MS, unseen, and never marks it never landed (pending.ts:891-899). Home's banner just goes. Private activity and its CSV keep a payment that never happened, and with gap-g9#1 the winner's change reads as 'Received'. It needs two conflicting answered submits in different mempools at once (one profile on Koios only, or the data layer's submit part held on Koios), so it's a note. The same goes for both profiles withdrawing one box: the loser's 'Back from Lovejoin' entry is written when its submit was answered (lovejoin.ts:7740).
- New trigger for G3's F5 note. A withdraw on one profile that Koios didn't answer and that never reached a node, whose box the other profile then withdraws, is looked for and resent every 3 minutes. The refusal is swallowed (lovejoin.ts:7871), and every way back on that network is held for SPENT_KEEP_MS (2 h): withdrawDueNow :6798, Bring one back now's 'lj.lastBoxMaybe' (:7011-7012), and Bring every box back's 'withdraw' wait (:7230). Not stuck for good.
- A consequence of gap-g9#1's misclass meeting per-profile reservations. One profile's session return merges into its funding's change, which it keeps out of its own spends while the chain is sent (script-spend.ts readContract `returning`). On the other profile that change reads as received, so a funding or stealth mint there takes it first. The return is then refused at its last step: sessions.ts:5583-5584 handles it, and the rest comes back as a sweep, which leaves the session two private UTxOs, not one. The same goes for a payment in parts: the carry between parts reads as received on the other profile and is preferred there, which stops this profile's remaining parts. The window is narrow.
- Locks and the chosen collateral are sealed per profile (privacy.md:264). The other profile's Max, coin selection or Send can spend a UTxO the user locked here, or the collateral chosen here. privacy.md:172 says 'A locked UTxO stays out of every spend, Max included' without saying it's this browser's. For the owner: wording.
- Custom-numbered public accounts past MAX_PROBE used in one profile alone aren't known to the other's madeBy (lovejoin.ts:6316-6337). There, a public mix's deposit boxes from such an account read as not mixed yet, and Mix my boxes again from the private balance takes them, which privacy review §2.10 avoids. It's the restore class, partly said ('the active one and the first 24', privacy.md:452). Narrow.
- Documented blind spot with a figure. On preprod and Koios-only, the other profile's spend stays in this profile's view until the next full read (architecture.md:342), while its change arrives at the catch-up. For up to 30 minutes the private balance shows both, the spent input and the change, so it overstates by the input's value.
- The documented index race (two profiles funding at about the same time) has consequences the docs don't name. Two sessions share one account and one stake key. A swap's runner or a return on one profile sweeps the other's site-session money as a stranger's pure-ADA rows, and the site's transactions there fail. No money is lost: it all comes back into the private balance.

## Coverage

Read in full, every line: background/spent.ts (248), runs.ts (105), pending.ts (1068) and docs/privacy.md (501).

lovejoin.ts (8048), read line by line:
- 1-4850: the header, timing constants, pumpChain, the types and sealed schedule, every helper to withinDepth, the class fields, readSet, progress, onChain, watchOf, poolsOf, listing, poolRows, ours, plan, fits, room(s), againBoxes, funding, chain, fanOut, acrossOf, planAcross, usableNow, takesNewBoxes, adaPool, retireOnce, collateralPool, tailOf, tailChain, tailWitness, unstale, rewards, reserve and its helpers, crossCheck.
- 5132-5884: publicSubmit, publicStart, pumpPublic, pumpPublicNow, schedule, scheduleFound, draw, recordChain, chainSent, chainEnded, restBack, the marks, publicUnsettledNow, lookFor, keptMaybe, keepOnReset, adoptKept.
- 5884-6420: cuts, chainsSending, sortOut, found, made, lookUp, madeBy, inputsOf, accountKeys, keysOf, reservedBoxes, status's head.
- 6751-7140: returning, withdrawDue(Now), unlockDraws, withdrawNowNow.
- 7211-7300: bringAllBackNow's head.
- 7470-8048: split, splitAll, real, ownership, withdrawOne, dropWithdrawing, neverWent, dropRefused, settleWithdrawing, resends, read, update.

lovejoin.ts, skimmed or not reached:
- 4850-5132 (publicBuild, publicReady, keep, publicAgainBuild);
- 6420-6751 (status's rest, chains, mixes, launches, clearMixes, releaseBootstrap, landedDeposit, rows, inChain, chainTxs, held);
- 7140-7211 and 7300-7470 (the rest of bringAllBack, bringNoted, bringSays).

sessions.ts (6872), read line by line:
- 1-500: the header, constants, RecordedTx, AutoRecord;
- 1186-1480: markListed through fundingsListed, the class's fields;
- 2700-3135: indices, scan, markUnscanned, scanDue, scanNow, recoveredRecords, accountUtxos, markUnsent, buildFunding, keepFunding;
- 3526-3700: resume, runAll, settleReturns, markCut, step, act's head;
- 4324-4625: bringBack, inspect, review, signAndSend, buildBack's head;
- 5490-5625: sendRecorded, submit;
- 5999-6330: fundingRecords, sendFunding, partsStopped, partsMayGo, returning, stillWaiting, outRecord, accounts, freshIndex, stillUnused, book, save, update, atStake, clearMixes, serial, clearKept.

sessions.ts, not reached: 500-1186, 1480-2700, 3135-3526, 3700-4324, 4625-5490, 5625-5999 and 6330-6872. For those I relied on E2a's, E2b's and G3's coverage, plus a grep of the file for its multi-device comments and every freshIndex/stillUnused/refuseStarted call.

Followed out of my paths, read in the parts named:
- activity.ts 80-130, 380-470, 640-680;
- seedelf-core build.rs 2330-2640 (ranks, tiers, select_script_inputs, one_more);
- shared/histories.ts 41-126 and 173-219;
- script-spend.ts 201-226;
- private-index.ts 1-60;
- contract-scan.ts 280-330;
- wallet.ts sends/noteSend (80-125);
- mint.ts's history lines;
- en.json's histories and mint privacy keys;
- the heads of tests/history-classes.test.ts and the test names in session-index and withdraw-refused-locked.
- In git: 1.9.1's privacy.md (lines 84-89, 179-180, 221-226), blame of today's lines, and the commits named.

Docs searched: backlog.md, archive/plans/*.md (independent-review, privacy-review §3.1, §3.6, §5.7, chunk-26/26b/27/34/44), architecture.md 700-720, keys-and-accounts.md, flows.md:110.

Lanes read: the brief, INDEX.md, critic.md, X4, gap-G3 in full; E2a's and gap-G1's notes; greps of every lane and verify file for multi-device words.

I ran only read-only commands (cat, sed, awk, grep, git log/show/blame), built nothing and ran no test.
