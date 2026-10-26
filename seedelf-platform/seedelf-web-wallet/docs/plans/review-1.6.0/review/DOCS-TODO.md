# Docs to update: every fixer's list (fix rounds 1, 2 and 3b)

Generated from the fixers' structured results. Each item names the doc, the place, and what is now true. Verify each against the code before writing it: a later round may have changed it again (each fixer's report in `../fixes/<id>.md` has the detail). Round 3's L6 items, and the doc points in its questions, are in `QUESTIONS.md`.

## Round 1

### bootstrap

- flows.md:522 (the Bootstrap bullet): from the private balance, one payment of the boxes plus the deposit's 1.5 ₳ reserve plus 1.5 ₳ for returning the rest (a sweep with no collateral). The cap is what both pay the deposit and the sweep for, measured by building both: one deposit's most today (96, or 64 in a token pool), 68 at 1.5× coins_per_utxo_size. '53 … 35 to 40' and 'fixed 1.5 ₳' are stale. The review has a 'For returning the rest' row. 'What comes back later is a sweep into new private UTxOs' is now true.
- privacy.md:198: funded with the boxes, 1.5 ₳ for the deposit's fee and 1.5 ₳ for its way back; the wallet builds the deposit and the sweep to find how many (one deposit's most today).
- architecture.md:671: privateBootstrapMost is held to what the reserves pay the deposit and its sweep back for (core's BOOTSTRAP_BACK_RESERVE, read through lovejoinBootstrapReserve and added in mixFunding, never in funding_for); the record carries mix.noCollateral; a Bootstrap funded between 62162483 and this fix goes in with one box fewer, and a one-box one comes back directly. architecture.md:611: the cap is what a deposit and its sweep back, from one funding UTxO, leave room for. architecture.md:632: a Bootstrap's return never takes a collateral (mix.noCollateral, 323-worker#4).
- plans/chunk-34-token-pools.md:711 (34d review 3's '53 classic boxes, 40 of LJTEST') and Session 11's item 4: record the release review's fix.
- wasm/README.md's export table: add lovejoinBootstrapReserve(), and say lovejoinBootstrapMost builds the deposit and its sweep back (overlaps rust-rest's 321-lj-rust-data#2).

### wlj-1

- privacy.md:198 (a Bootstrap's held boxes): each box brought back by hand counts against the Bootstrap that held it. That's the one whose deposit put it there, or, for a box someone else's mix moved, the one it was moved from, so one Bootstrap's boxes still at its deposit stay held whichever box goes first. A box another device brought back is squared up against the Bootstrap whose deposit no longer lists it. Nothing is held in a Bootstrap's place before its deposit is known to be in (a read lists a box there, or a watch sees it land).
- privacy.md:208 and flows.md:524 (Pay from my private balance): one back from Lovejoin first; then, for a box a public account's deposit made, one made private from no other public account (another's would tie the two accounts); then the smallest that pays.
- privacy.md:210: the tie is kept by the deposit once its chain's record and mix are gone (depositors), so every box of a public Bootstrap or seed is the account's however its mix's count closes. 'A 1.5.0 public seed's' holds only for a seed whose record 1.6.0 still found; say so unless the owner picks the lookup (owner's call 1).
- privacy.md:235 (on this device), optional: after a public seed's or Bootstrap's chain record goes, which account made its deposit is kept by that deposit, sealed, until 3 hours after a read last listed a box there. No new request. The existing 'the account that paid it, kept while their boxes sit unmoved' arguably covers it; the docs lane decides whether the privacy policy needs a Changes entry.
- architecture.md:684 (token pools' records): a held box counts against the Bootstrap that held it (holderOf, kept on the withdraw as holder). squareUp credits Bootstraps by what their deposits no longer list. bootstrapOf's stand-ins apply only to a landed Bootstrap. depositors keeps a public deposit's account after its record. A chain with no box of its own gets its entry when its collateral's mix is sent.
- plans/chunk-34-token-pools.md:569 (34a′'s 'against the pool's oldest Bootstrap') and :926 (the tail's entry): record this review's change.

### wlj-2

- flows.md:527 (Bring every box back now):
- Once a chain it waited for is all sent, the run waits for that chain's boxes to reach their pools, 15 min at most. That means a read listing one or every box of it, or Home's or the session's watch seeing it land.
- It never says 'Nothing of yours was left' meanwhile. It takes those boxes if the chain was there at the ask, and otherwise keeps their due times.
- It no longer waits for a session's return whose collateral's mix waits for giveme.my or Koios. It takes everything else, and only the collateral's box waits for that mix (a day at most), said so.
- Each wait is kept as a word (bringing.waiting).
- Once none is left to send, a withdraw not on chain 10 min after it was sent makes the run late, and Stop is offered (after the screens round).
- flows.md:521, privacy.md:217, architecture.md:632 (the collateral's mix waiting up to a day): boxes due, Bring one back now and Bring every box back now go meanwhile, each under its usual rules. Only the collateral's box waits. The lock countdown and Remove wallet still count the chain as being sent.
- flows.md / architecture.md (a box's own run): no run drops a chain's due times, or sends a box, while that chain, all sent, may still be landing (15 min at most). This was a gap since 1.5.0.
- architecture.md:424 (lovejoin.<network>):
- chains keep `landed` (all sent and known in);
- bringing keeps `waiting` and `late`.
No new request. I believe no privacy-policy Changes entry is needed; the docs lane decides.
- architecture.md (the worker's withdraws):
- chainsMixing/mixing (the withdraws' gate, which excludes tailWaits) versus chainsSending (the lock countdown and Remove wallet);
- mayLand, LANDING_MS, landedBy, and landedDeposit's new mark;
- BRING_LATE_MS, computed from spent.ts' spent marks.
- plans/chunk-34-token-pools.md:
- Session 11's call 2 and the owner's calls item 1: withdraws no longer wait for a chain stalled at its collateral's mix (x-scenarios-lj#1);
- item 7 ('no Stop'): the worker's late flag (321-lj-worker#4);
- item 5: the bring waits for a just-sent chain to land (321-lj-worker#0).

### wlj-3

- architecture.md:632 (the collateral's mix bullet). Each wait says why and how long: lj.tail.waiting (a box not listed, an hour at most), lj.tail.noPool and lj.tail.fewBoxes (a day at most). Koios not answering throws Koios's own error. A box whose deposit is in but isn't listed is taken for moved only LANDING_MS after the deposit was first known in, or at once when the wallet's own send spent it. A rebuilt tail chain records SessionRecord.chain.from, so chainSoFar counts the chain it continues, and a second stop's return is plain, with no 'left out' reason.
- privacy.md:217: a box whose deposit is on chain, but which the pool's listing doesn't show yet, is waited for up to 15 minutes from when its deposit was first known in. Only then is it taken as moved by someone else's mix, and the rest comes back.
- flows.md:154 (Switching): refused only for something of the account's, a payment that may still go through or a mix from the public account being sent. A private session's chain, its collateral's mix waiting for giveme.my included, never holds a switch. The lock countdown and Remove wallet still count it.
- plans/chunk-34-token-pools.md:926 and Session 11 (:953): record 323-worker#2 (the words; Koios not answering still waits, in Koios's words), #5 (the listing grace), #8 (the tests and chain.from) and gap-1#0.

### wlj-4

- flows.md:528 (Start a pool): the review warns when this device sent a start of the same values in the last day that no look has found yet: if both go through, the later one is a copy, never shown, what it locks gone for good. Nothing is refused. Send pressed again for a review whose start went as the build without the certificate says it went already. One parameters read per review.
- architecture.md:424 (sealed lovejoin.<network> record): launches entries keep the pool's values (box: lovelace and the token with its quantity) and, where Send sent the bare build, the hash its review showed (reviewed). On the device, sealed; no request.
- privacy.md:205 and the policy's Lovejoin line: 'whether the wallet started one' is now kept with that pool's values (device only, sealed, no new request). The docs lane decides whether a dated Changes entry is needed; I think the existing words cover it.
- architecture.md:483 (TxBanner, Home's pending banner): a public Bootstrap's watch carries PendingTx.bootstrap, and Home's banner words it apart after the screens round. flows.md:522 (Bootstrap): the banner's words once the screens round lands them.
- lovejoin-mix-width.md:16 and :150: wayOver gives no reason where three takes no box either (no room at either width); a swap's approval then records the width asked, for its return to decide (before: three); a chain still goes three, so its refusal quotes three's need.
- plans/chunk-34-token-pools.md:545 (the gate): it also runs with the bundled head start's pools handed over, compared against the same record, leaving out only what a shown pool adds; record mode refuses unless package.json is 1.5.0. 34g's record of this review: 318-worker#0, #1, #3, 319-worker#0, #3, x-compat#2.
- architecture.md:684 (token pools' records): the gate holds the classic pool to 1.5.0's record with no pool shown and with the bundled head start's.

### deep-datum

- WW/docs/architecture.md ~line 730 'Which pools are shown': a launch is finished only if its mix_box and mix_logic sit at the holder each under no datum, or one nested within 128 levels (cbor::MAX_DEPTH). A deeper script row is no reference: protocol_of passes it over and the script is carried (scriptsInline >= 1), so the pool is never kept, and the data layer leaves it out. The vectors now hold the depth walk too (scriptRowDatums). (314-wasm#0)
- WW/docs/architecture.md ~line 52 'A call that traps (isTrap…)': this now includes a RangeError thrown inside WebAssembly, which leaves Rust's stack pointer behind. It is told from JavaScript's own overflow by a WebAssembly frame on its stack.
- seedelf-data/README.md 'Standard means:' last bullet: mix_box and mix_logic at the holder each under no datum or one within 128 levels, the wallet's limit. Offline-tests line ~67: the depth walk is held to the wallet's vectors.
- seedelf-platform/CLAUDE.md 'Lovejoin's token-pool templates are pinned': the data layer's copy also holds the depth walk for a script row's datum (datum.rs within_depth), and lovejoin_vectors_test.rs writes the vectors from derive, the decoder and cbor::within_depth.
- WW/docs/plans/chunk-34-token-pools.md item 22 and 34g's record of this review: 'scripts at the holder' now leaves out a row under a datum past 128 levels.

### pool-exists

- WW/docs/architecture.md ~730 'Which pools are shown': a listed pool is also left out unless its launch and both script rows are the reference row's own transaction (refresh). Whether a pool is on chain is the ledger's to judge, not the server's word: a token pool's deposit reads its reference UTxO (core deposit_across), so a deposit into a pool that isn't on chain is refused at submit (BadInputsUTxO, which stops the chain) instead of locking its boxes for good.
- WW/docs/architecture.md ~632, the collateral's tail: its deposit reads the 5 ₳ pool's reference UTxO, 1,804 lovelace more.
- WW/docs/architecture.md ~671, Bootstrapping: a Bootstrap's deposit into a token pool reads the pool's reference UTxO; still no script and no collateral.
- WW/docs/plans/chunk-34-token-pools.md:473: 'can't make one look real' is false. What's true: the server can't pass off other scripts as a pool's; it could name a pool that isn't on chain, and the ledger refuses any deposit into one, since each reads the pool's reference UTxO (1.6.0's release review, 317-wallet#0). Also :737 (deposit_across): it reads the reference UTxO of each token pool a box goes into.
- Optional, seedelf-platform/CLAUDE.md, the 'Lovejoin's token-pool templates are pinned' bullet: a token pool's deposit reads its reference UTxO, so the ledger refuses one into a pool that isn't on chain.
- No change: privacy.md (no policy entry) and seedelf-data/README.md. Nothing new is asked or sent; the reference input names the pool the mix_box output already names, and Lovejoin's own deposit builder always reads it (cb5a5a3, offchain/src/tx/deposit.ts:563-569).

### max-left

- docs/flows.md, Send privately's Max (about line 368). Replace 'past 500, a token that wouldn't fit…' with: the review says how many private UTxOs stay and why, as the last part says (leftWhy). The reasons are past 25 transactions ('a payment goes as 25 transactions at most'), too little ADA to pay for spending them (a part couldn't pay its fee and no chain could bring it ADA), or a token that won't fit in one output. The reference script and what a chain being sent holds are still listed by LeftOutNote.
- docs/flows.md, Make public's Max (about line 401). Replace 'how many are left (past 500)' with: how many are left and why (past 25 transactions, too little ADA to pay for spending them, or a token that won't fit).
- docs/architecture.md, Max on private Send (about line 163). The last part answers left and leftWhy (tokens, fee or limit; lib.rs LeftWhy), absent when none is left. Max in parts over no UTxOs is refused as one transaction's Max is, in its words.
- docs/architecture.md, A payment in parts > The plan (about line 168), optional: what max_in_parts leaves and why. limit once 25 parts went; fee where a part couldn't pay its fee and no chain went, a chain past 25 parts included; tokens otherwise.
- wasm/README.md: the buildTransferParts/buildWithdrawParts rows (missing, 321-lj-rust-data#2, rust-rest's) should say the last part carries left and leftWhy, and that Max over no UTxOs throws one transaction's 'There's nothing in the Seedelf balance to send/withdraw'.
- seedelf-platform/CLAUDE.md, the 'web wallet's Max takes every UTxO, in parts' bullet: add that the last part says how many it left and why (LeftWhy: a token that won't fit, too little ADA to pay its fee even chained, or past 25 parts).

### reserve

- architecture.md:632 (the collateral's mix bullet, 'A funding that pays a collateral adds COLLATERAL_TAIL_RESERVE (1.5 ₳)…'): a mix's and a swap's funding add 1.5 ₳ (the collateral's deposit and its mix). On a chain, DEPOSIT_RESERVE's leftover pays the sweep's least, about 0.29 ₳ over for one box; a swap's SWAP_MARGIN less the order's fee comes back beside it, its fill carrying that least. A site's funding and a top-up that pays a new collateral add lovejoinDirectCollateralReserve(params), core's direct_tail_reserve: 2.8 ₳ at 4,310 lovelace a byte, 3.6 ₳ at 6,465. Each of the four builds again without the reserve where the private balance doesn't pay for it too (orWithoutReserve: no collateralReserve on the record or the review); a swap leaves it out before its token's boxes. lovejoin-funding names collateralReserve and collateralPool.
- privacy.md:217: 'pays a little more for that mix (COLLATERAL_TAIL_RESERVE, 1.5 ₳)' becomes 1.5 ₳ for a mix or a swap, and for a site's session or its top-up what a direct return takes (2.8 ₳ today). Where the private balance doesn't pay for that too, the session is funded without it; add that case to the 'can't be built' list (mixed only if what's left at the return pays).
- flows.md:513 (Mix from the private balance, For its collateral's mix): 1.5 ₳, left out where the private balance doesn't pay for it too.
- flows.md:477, 489-493 and 521 (docs-1's note): the For its collateral's mix row shows 1.5 ₳ on a swap's or a mix's funding, what a direct return takes on a site's and a top-up's (2.8 ₳ today), and no row where the balance doesn't pay for it too.
- wasm/README.md export table: add lovejoinDirectCollateralReserve(paramsJson): one Koios epoch_params row in, a lovelace string out (what a site's session or its top-up adds for its collateral's mix); parameters it can't read are refused. Add lovejoinCollateralReserve() too if missing (no argument; 1.5 ₳; a mix's and a swap's). Overlaps bootstrap's lovejoinBootstrapReserve and 321-lj-rust-data#2.
- plans/chunk-34-token-pools.md Session 11: 'adds about 1 ₳' is now 1.5 ₳ for mixes and swaps and 2.8 ₳ for site sessions and top-ups, with the fallback; record this review's fix.
- seedelf-platform/CLAUDE.md, the giveme.my Lovejoin-mix bullet (optional): direct_tail_reserve sizes a direct return's tail.

### rr-1

- WW/docs/lovejoin-mix-width.md 'That it's the wallet's mix' (~l.38): the test now compares declared budgets redeemer by redeemer (besides use, fee, size) on the classic pools and the token pool by reference at 3 and 4 boxes; inline, the token pool's mix declares what its scripts use. Five boxes are refused at measurement. A 4-box mix whose scripts each fit but whose sum passes MAX_TX_BUDGET is refused by the sum (the_wallet_refuses_four_boxes_once_together_they_pass_a_transactions_computation, cost model 2% dearer, 10.08B steps).
- WW/docs/lovejoin-mix-width.md ~l.139: eval::MEASURE_LIMIT (14B steps) caps a transaction's scripts together, not each (uplc runs each redeemer on what the ones before left).
- WW/docs/architecture.md:685: owner_context is in seedelf-core/src/lovejoin/mod.rs (seedelf-core/src/lovejoin.rs is 1.5.0's path); same stale path at post-release-roadmap.md:366.
- WW/docs/architecture.md (return across pools) or chunk-34 34g record: a token leg planned no box takes none of its token, in plan and deposit (319-rust#0). A pool whose box ADA makes a sum pass u64 gets no box and no Bootstrap, and a quote or deposit is refused in words: 'These boxes cost more ADA than there is' (314-core#1).
- WW/docs/plans/chunk-34-token-pools.md 34g record: private launch makes each seed's pool once, measures usable once on the chosen pool, and uses what a launch locks as the selection floor (314-core#0). An account launch never spends a UTxO carrying a reference script (318-rust#1).
- Optional wasm/README.md lovejoinFunding: throws 'These boxes cost more ADA than there is' for such a pool. No privacy.md or policy change.

### rr-2

- WW/docs/plans/chunk-34-token-pools.md, 34g's record of this review (and the Session 10 line :967 if history is annotated): external_sweep_with folded back into external_sweep (unused since #323, never published); core's external_sweep is 1.5.0's again.
- WW/docs/plans/chunk-34-token-pools.md:490 and 34g's record: with_staking takes only a script's registration with cert 0; any other certificate, a withdrawal or a vote is refused in words, since the spend adds no witness for it (314-core#2).
- seedelf-platform/CLAUDE.md:61 (optional): pay_rest(RestTo, tokens) pays what's left with its tokens 20 to an output.
- wasm/README.md: done in this round by rr-2 (bootstrap's, reserve's, max-left's and rr-1's README items are in it); the docs lane needn't touch it.
- No privacy.md change and no policy entry: nothing new is sent, asked or shown.

### docs-1

- flows.md:512 (Mix form): once the screens round adds the reserve to Total leaving and drops the 5 ₳ from 'Comes back once it's mixed' where the tail applies (gap-3#2, 323-worker#1), say so there.
- architecture.md:632 ('COLLATERAL_TAIL_RESERVE (1.5 ₳)') and flows.md:521: rewrite from Lane R's 'reserve' report, which changes the reserve's sizing and the fundings' fallback. My edits describe 9978654a only.
- keys-and-accounts.md:91: 'the 5 ₳ comes back with the return' (Put in 5 ₳ to cancel). With a 5 ₳ pool shown it may be mixed first and come back later as a box. That's Session 10's call 2 class; leave it until the owner rules on it, with gap-3#2's by-hand notes.

### docs-2

- privacy-policy.md header: the 'updated for …' list doesn't name the collateral mix. It's left with the Effective date for the owner's call (x-privacy#4, x-release#4); one edit covers both.
- At the 1.6.0 upload, paste store/README.md's changed alarms justification and the merged host-permission box (996 characters) into the dashboard.

### wss-1

- docs/flows.md:104 Remove wallet's list: add a payment still being sent in parts, which removing the wallet stops partway, what's still to go staying in the private balance; a session's funding in parts is its session's line.
- docs/flows.md:369 Parts that wait: after 'A lock wipes what waits', the lock countdown says 'A payment is being sent in parts: locking now stops it partway.' (parts-waiting); Remove wallet lists them and needs Remove it anyway; Send pressed again on a first part that may have gone, once the rest wait, sends only that first again and answers how far the payment went.
- docs/flows.md:370 Home's banner: 'never confirmed' now holds after a lock too: the watched part keeps how far the payment went, sealed, so once it lands it reads '… only partly sent', 'N of M didn't go' (a funding never 'funded'); a later part never seen counts with those that didn't go ('2 of 3').
- docs/flows.md:381 Send's checks: for a payment in parts every later part is checked as the first goes; one spent since is a stale review, one a chain being sent holds refuses it whole, nothing sent.
- docs/architecture.md:170 The worker: the first part's send checks every later part (laterParts: spent since; reservations but its own parts.<first>; a missing part is a stale review); Send again with the pump holding the rest resends only the first (pumpHolds).
- docs/architecture.md:171 The pump: each part sent with more to go carries parts {sent,total} on its watch record, written ahead and sealed (Sending.parts; nameParts seals again; holdWaiting names a funding's); pending-tx turns a chain-named watch with no parts' record into parts.stopped 'locked'.
- docs/architecture.md:430 seedelf.waiting.<network> row: 'Only while unlocked: a lock stops the rest' + the lock countdown and Remove wallet say so first.
- docs/architecture.md:441 Remove wallet's list: add a payment whose parts still wait to go, from session storage (seedelf.waiting.<network>, partsWaiting), not the sealed records; a session's funding is its session's.
- docs/architecture.md:450 the countdown: also asks parts-waiting and says the parts line (data-parts-waiting).
- docs/plans/chunk-34-token-pools.md 10b call 1 and HANDOFF.md's owner's calls: the lock still cuts the rest, now said first in the countdown and Remove wallet, and Home no longer calls it confirmed after an unlock; a sealed record Home reads after an unlock is still not built.

### wss-2

- keys-and-accounts.md, Accounts → The restore scan. In "Reads the used ones": every other transaction its key didn't sign that spent a UTxO at the wallet contract has its first such input read with utxo_info (spent or not, in the same request as the orders). It counts as the session's own when this phrase owns that register: a funding's other parts, a top-up. In "A server that's behind": the scan also fails when utxo_info has no row for such an input. In "Adds each account": recovered.own is what the key signed plus what the phrase's private balance paid beside the funding, and those tokens come back as the session's own; a stranger's payment, even from their own Seedelf UTxOs, stays a stranger's. Cost line: those inputs are in the same utxo_info, 60 a request.
- architecture.md:606 (the restore scan): replace "what its key signed" with "its own transactions beside the funding: what its key signed, and what this phrase's private balance paid it (a funding's other parts, a top-up)".
- architecture.md:626 (What one return takes): for a found session, its own UTxOs include recovered.own's, every part and top-up included.
- architecture.md:366 (the collateral): "waiting" lasts 10 minutes from when it was sent, then while the wallet keeps it as sent (heldSent: up to two hours, its slot), as Home's banner says. After a lock, only the 10 minutes. The payment is recorded on the public account its review was built on, whichever is active when Send returns (309#2).
- flows.md:139 and :143 (Collateral): "Waiting for the network to confirm it" lasts while the payment can still land (up to two hours, as Home's banner says), the same on the row, Lovejoin's form and the page; no second payment is offered meanwhile. A payment reviewed on one account is that account's collateral even if another window switched accounts.
- flows.md:113 (Public activity): a box the account paid to bring back (the escape hatch) reads Paid for a box back from Lovejoin, at what the account made up, fee apart, on the paying device as on any other.
- flows.md:116 (Pending): a box the account paid to bring back isn't listed while pending; it appears once Koios lists it.
- architecture.md:171 (The pump, wss-1's item): a session's funding also writes how far it went ahead with its last part that goes at Send (sendFunding, as sendParts).

## Round 2

### sc-lj-1

- flows.md:512 (Mix): where a 5 ₳ pool would take the collateral (floor held, two boxes free), the private form counts the funding's 1.5 ₳ for that mix. It shows in Into a one-time account (with 'For its collateral's mix' set in), in the total, and in the costs ('Its collateral's mix, about' 1.5 ₳). 'Comes back once it's mixed' leaves out the 5 ₳, and a row 'Its 5 ₳ collateral' says it's back later as a box, about 4.7 ₳. The stepper keeps that reserve aside, and 2 ₳ for the funding's fee and its change's least. From the public account, the held figure and the stepper count only the ADA a mix can spend (ADA alone, plus a token pool's token UTxOs), not ADA held with other tokens or rewards.
- flows.md:516 and :520 (Mix my boxes again; Four boxes a mix): the review's switch says the width the review was built at, three where four went three. A rebuild that fails leaves the switch, the review and Send's build as they were, with the error.
- flows.md, Your mixes: a Bootstrap of one box reads 'held until you bring it back' / 'coming back by itself'.
- flows.md:522 (Bootstrap): from the private balance, the form's shortfall is the boxes plus 3 ₳ of reserves plus 2 ₳ for the fee and the change.
- privacy.md:217 (the collateral's mix): where the funding pays for that mix, the private mix's and Mix my boxes again's reviews say giveme.my backs and sees it, and that a mix that can't go leaves the box tied to the session. privacy.md:121's rule now holds for them.

### sc-lj-2

- flows.md:527 (Bring every box back now). Each wait is said in one short line, and Stop shows through every wait. 'Waiting for the chain to confirm' shows only while it truly confirms, and Stop is offered once a withdraw is 10 minutes late. A page never says Done after its own Stop. Settings says 'Nothing of yours was left in that pool.' for a pool's run. A stuck pool's private-payer refusal now says to make ADA private, or to bring the box back from its pool's page, paid from the public account.
- flows.md:528 (Start a pool). The token amount and the box's ADA are the wallet's amount fields: the token's decimals, at most 2^64−1 raw a box, the Spanish d,ddd guard, and ₳ on the box's ADA field.
- flows.md:506-507 (the hub's started line). After 30 minutes it says the pool hasn't shown, and why: the start didn't go through, or an earlier start of the same values did, making it a copy that is never shown, its locked ADA gone for good. The line still goes after a day.
- privacy.md:207-210, checked against :92/:97. With several public accounts, the held, Bring them all back and anyway questions name the box's account where it isn't the one on screen. Paying from this account for another's box says it ties the two. The private payer avoids money made private from another account where it can.
- flows.md:524 (the stuck pool's questions): the same account naming.

### sc-o-1

- flows.md:463 (You pay, Max): ADA's Max leaves the costs, the collateral, 2 ₳ for the funding's fee and change's least, and, where a 5 ₳ pool is shown and Settings has the collateral go in, the 1.5 ₳ collateral-mix reserve (quote collateralReserve, asking nobody). The note names it. Example becomes 'Max is 15 ₳. The other 13 ₳'. A typed amount past it is funded without the reserve.
- flows.md:468 (Review the swap): 'Its collateral's mix, about 1.5 ₳' (deposit, giveme.my mix, box's way back) is a part of Costs in all, not counted as coming back. The last step says the 5 ₳ comes back later in a Lovejoin box; the no-box line says all but the 5 ₳ comes back at once. A line under giveme.my's says it backs and sees that mix, and if it can't go the box waits unmixed. The width note shows only where something goes through Lovejoin. Start swap reads Building… while the switch or Change rebuilds.
- flows.md:481 (retry): Details says whoever you send the transaction to can tie the swap's one-time account and the private UTxOs that funded it to you. The live region holds only the line's words, never the hex.
- flows.md:489 (site funding review): Later, to bring it back adds 'Its collateral's mix, about 1.5 ₳' to the fees both ways. Its note says the 5 ₳ is mixed once in a box of its own and comes back hours later, the rest at once.
- flows.md:493 (Top up, Bring it back): a top-up paying a new collateral and its mix says it's mixed once at the next return, then comes back by itself. Return reviews' Send reads Building… while the switch or Change rebuilds.
- flows.md:521: the swap's costs and the site's way back count about 1.5 ₳ for the collateral's mix where the funding pays the reserve.
- flows.md (Mix my boxes again): Start mix reads Building… while the Four boxes switch rebuilds; a public mix's progress shows only on a public review.
- privacy.md:121: a swap's approval also says giveme.my backs and sees its collateral's mix, since that return runs by itself. Sites and top-ups say it on the return's own review.
- privacy.md:145: the swap retry's Details says what sending its transaction on ties.
- architecture.md:632 and wherever the docs keep ui/swap.ts: SwapQuote.collateralReserve, set by SessionService.quote via LovejoinService.collateralPoolShown (quiet readSet). maxAdaIn keeps it aside, FEE_ROOM is 2 ₳, adaShort doesn't count it. swapCosts' collateral uses COLLATERAL_MIX_COST (LovejoinReturn.tsx), as FundingWayBack does.
- architecture.md:646: the retry's cbor under Details carries a privacy line; the retry line's live region holds only its words.

### sc-o-2

- flows.md:143 (Collateral → Set collateral): opened again from Home's row while its payment waits, the page reads only its status and leaves the question to Home's watch, which reads the balances again once it lands. The page then says Set within 15 s, and Home's banner goes on to 'Collateral set', so the line 'Sent from Home or Lovejoin, it goes to Home's banner, which follows it to Collateral set' is true again on that path. From Settings the page asks as before.
- Home's pending banner (flows.md near :216 or architecture.md beside the pending watch :308–320): the worker tells only the first page to ask of a landing. When Home holds an ordinary payment still inside its 10-minute hold and hears the worker watches nothing, another page or window saw it land: Home lets it go with no banner, reads the balances again, and payments go again. Past the hold it still says 'not confirmed yet'; a maybe-sent one is let go as before.
- architecture.md:483 (TxBanner, Home's pending banner) and flows.md:522 (Bootstrap), completing wlj-4's item 4: a Bootstrap from the public account carries PendingTx.bootstrap. Home's banner names it 'A Bootstrap' ('A Bootstrap sent. Waiting for the network…'), and once its deposit is in, 'In Lovejoin, held there until you bring them back'. A mix keeps 'Mixes into Lovejoin' and 'In Lovejoin, on their way to your private balance'.

### w-left

- architecture.md:52 (a call that traps): the worker's runs (runs.ts) lock the wallet on a trap from any step, stop the alarm and end the run. Lovejoin's pool read hands a trap from discovery on. Bring every box back now's pool read and withdraws, and a box's own withdraw, hand a trap on and never keep it as a run's reason.
- architecture.md:231 (the worker's runs): one network's failure never stops the other's, but a trap ends the run and locks the wallet.
- architecture.md:323 (a chain kept for Send is refused at Send): it's also refused when a payment's parts still to go reserve something it spends, such as a return reviewed before that payment's Send that merges the funding change a waiting part spends. The refusal comes before its chain or the session's record is touched, in worker.spend.partsConflict.return's words. Before, reserve()'s overlap check refused it as 'Lovejoin's pool changed while the wallet read it.' Same for flows.md:381 if it covers a return's Send.
- architecture.md:728 (a return's tokens through their own pools): a token on a session's own UTxO that WebAssembly's evaluator can't take (a reference script on it, or a datum past 128 levels or not one CBOR item) is no pool's token for that return. It gets no way and comes back with the return, and a session brought back by hand isn't offered 5 ₳ of collateral for it. The worker reads such a datum as core does (lovejoin.ts withinDepth, held to the shared vectors' scriptRowDatums).
- seedelf-platform/CLAUDE.md, the 'Lovejoin's token-pool templates are pinned' bullet, beside deep-datum's note: the worker has its own copy of the depth walk too (lovejoin.ts withinDepth), tested against the same vectors.
- flows.md:527 (Bring every box back now): a box whose withdraw a node dropped is taken again once it's free, 2 hours on. It counts as one box back, in Settings' count and in the list of mixes, and takes no other box's due time. After Stop, or when the run stops itself after three runs that sent nothing, the pools are read once 2 hours on, so such a box gets its due time back and comes back by itself.
- architecture.md:424 (lovejoin.<network>'s contents): `counted` (each box Bring every box back now's withdraws went for, with its pool and when, kept while a read of that pool lists it) and `recheck` (when Stop's one read is due). Both are sealed and on the device; the read is the pool read every wallet makes.
- architecture.md:711 (a withdraw is written ahead): Bring every box back now's withdraws carry `bring`.
- privacy.md and the privacy policy: probably no change, since there's no new kind of request (one more pool read 2 hours after Stop). The docs lane decides.

## Round 3b

### fx-reserve-1

- flows.md:463 (You pay, Max). ADA's Max keeps the 1.5 ₳ reserve aside in two cases: where a 5 ₳ pool takes the collateral as last read (a pool read within 5 minutes, the data layer's crowds against the floor, whether it takes new boxes), or where nothing read lately says. In the second case the note says what the mix 'may take'. Max keeps no reserve for a swap against Danogo's pools whose return comes back directly with its token. Max pressed before any quote follows Max down. Example note: 'Max is 15 ₳. The other 13 ₳ pays the swap's costs and network fee, or comes back: what's kept aside for contracts, and the change.'
- flows.md:468–469 (Review the swap). The 5 ₳'s words show where the reserve is paid, or where a 5 ₳ pool takes the collateral without the reserve if the fill is ADA. An ADA-to-token swap without the reserve says the 5 ₳ comes back with the rest. The cost row shows only where the reserve is paid. A swap against the pools coming back directly with its token takes no reserve and says nothing of the mix.
- flows.md:479 (Stop). The dialog prices its boxes on the account's ADA less the reserve its funding paid, as the return sets it aside. Where the collateral goes into the 5 ₳ pool first, it says giveme.my backs that mix too, unless Stop brings it back directly.
- flows.md:489 and :493 (a site's funding review; Top up). The note says the 5 ₳ is mixed once wherever a pool takes the collateral, reserve or not. The mix row and the both-ways total count only where the reserve is paid.
- architecture.md:632, and wherever sc-o-1's docs item 10 lands, whose collateralPoolShown is now collateralPoolTakes. collateralPoolTakes answers yes/no/maybe by collateralPool's rule from what the wallet last read, asking nobody. On 'maybe', the quote keeps the reserve and adds collateralMaybe. outBuild takes no reserve where tailUnpaid holds. The summaries' collateralPool drives the words, while collateralReserve drives the costs. stopCost sets the reserve aside where the collateral goes into the pool (tail_reserve) and returns collateralMix.
- privacy.md:217. Reviews say the collateral is mixed also where a pool takes it without the reserve (an ADA fill, or what a site leaves, then pays). Stop's dialog says giveme.my backs that mix. privacy.md:121 can name Stop's dialog among the reviews that say it.
- The owner's list of calls: sc-o-1's call 1 should read 'funded without the reserve, not without the mix'. Its collateral is still mixed at the return where what's left pays. reserve's call 4 is accurate.
- Privacy policy: no change. Nothing new leaves the device.

### fx-reserve-2

- flows.md, Mix form, private side (with L6's flows.md:512): the stepper and Review never count the collateral's 1.5 ₳ reserve. A count the balance pays without it goes, funded without it. The figures count the reserve only where that many boxes leave room for it too. Otherwise one line under the stepper: 'At this many, its 5 ₳ collateral is mixed only if enough is left when it comes back.'
- flows.md, Mix form, public side in a token pool: the held figure and the stepper count the UTxOs the chain picks for that many boxes: the fewest holding the pool's token that hold the boxes' worth, most first, less the least ADA of the output that gives back their tokens beyond that, then every UTxO of ADA alone. The stepper stops below the first count that pick can't pay. The Bootstrap form's held figure is at its own count.
- architecture.md, the collateral's mix reserve (orWithoutReserve): a funding goes without the reserve on too little ADA, or on more of the private balance's UTxOs than one transaction spends or holds (core's TooMany and TooLarge). That reaches a top-up and Mix my boxes again, which are one transaction each.
- architecture.md / flows.md, payments in parts: a session's return reviewed before a payment's Send is refused at its own Send where it spends what a waiting part spends. That holds for a return that comes back directly as much as for a chain, and for Bring it back and Bring everything back alike. A new review leaves that UTxO out.
- The owner's list of calls: sc-lj-1's call 2 ('It's not a refusal: Review and the worker's fallback are unchanged') is now true, since the form never refuses on the reserve and says so in a line instead. Its call 3's 'where the funding refused it at Review' no longer applies.
- Privacy policy: no change. Nothing new leaves the device.

### fx-lj-1

- privacy.md:208, flows.md:524, architecture.md:733 (supersedes wlj-1's item for :208): the private payer's order is box-back first; then, for a box a public account put in (its deposit's, a box a mix of its left not mixed yet, or its mix's leaf still where that mix left it), one made private from no other public account; then the smallest. The history still ties only a deposit's account (privacy.md:210 unchanged).
- privacy.md:207 and flows.md:523: the escape hatch's Bring one back takes the account on screen's own boxes and those no public account put in first. It takes another account's box only where nothing else is, the lowest account first, and its question then names that account.
- privacy.md:207–210 and flows.md:524 (sc-lj-2's items 4 and 5): the questions name the accounts inside each payer's note; the private note ends '…else one that ties no other account'.
- flows.md:527: Bring every box back now also waits, LANDING_MS at most, for the boxes of a return whose collateral's mix waits for giveme.my, counted from when that chain's earlier transactions were first known in a block. A box's own run sends nothing meanwhile and keeps their due times. After Stop, a Bootstrap's box whose withdraw a node dropped comes back by itself, counted once, and the Bootstrap keeps holding the boxes it still has out.
- architecture.md: mayLand covers tailWaits chains, LANDING_MS from Tail.landed, held the whole time since landedBy never marks them in. No Bootstrap holds a box in `counted` (holdable). hatchOrder, and the payer order above.
- privacy policy: no change, I think (no new request or party, and the policy doesn't describe the order). The docs lane's call.

### fx-lj-2

- flows.md:527 (Bring every box back now): a Stop pressed on one page reads 'Stopped: N sent back.' on every page that saw the run go, the pressing one included, never Done; the worker keeps the stop, sealed, until it's asked again. Late: one line beside Stop ('One isn't on chain after 10 minutes. If a node dropped it, it's sent again within 2 hours while the wallet is unlocked, or after its own wait if you stop.'), the unlocked line folded in. After a lock cut a session's return at its collateral's mix, the run leaves the 5 ₳ box to that mix while its return may build it again (two builds, a day from its deposit), saying it waits for its mix; after that it brings it back, not mixed.
- architecture.md:424 (lovejoin.<network> contents): bringStopped (sealed; the last run's count and pool after Stop, until asked again); LovejoinHeld.bringStopped.
- architecture.md:52 (a call that traps): watchOf's and mixBoxes' pool reads, Activity's read of the pools' mix boxes, the Lovejoin page's progress (sending, and looking for a maybe-sent mix: lookFor), and the 5 ₳ pool's read (collateralPool's split, a funding's tailReserve) hand traps on; a withdraw's post-submit bookkeeping and a public mix's Home watch run first.
- architecture.md (spent marks, spent.ts): Lovejoin's and the sessions' services write and read marks on their own clock (now); pending.ts still writes on the device's clock (the same clock in the worker).
- architecture.md (the worker's withdraws / the collateral's tail): tailBuildable is tailOf's rule; tailBoxes is what Bring every box back now leaves to a session's collateral's mix.
- privacy.md (Bring every box back now): a session's collateral's box waits for its mix, a day at most, rather than come back unmixed, a lock-cut chain's too.
- Privacy policy: no change, I think (no new request or party; the stop mark is on the device, sealed). It's the docs lane's call.

### fx-misc

- seedelf-data/README.md:177 (Kept): the stable cursor is read once a tip; a cursor read that fails or runs past 5 s also gets the last list, as a failed list does; 503 only before the first (R3-15)
- seedelf-data/README.md:172 (L6): each read gathers only the holder's outputs above the highest output id and transaction id it has gathered by its block, candidates or not (321-lj-rust-data#0)
- seedelf-data/README.md:165-169 Standard means (L6, deep-datum's 3): a launch's script row carries a datum nested no deeper than the wallet reads (128 levels, datum.rs MAX_DEPTH); past that the wallet passes the row over and never shows the pool (314-wasm#0)
- development.md §2 after the curl block (:216): a restarted API works out its first pool list off the request for up to a minute, so the token routes can print 503 meanwhile: ask again before taking it for a failed deploy
- flows.md:139/:143 (Collateral): 10 minutes after sending, the waiting page (from Home's row or Settings) offers 'Pay it again anyway' with 'If both land, the first 5 ₳ goes back into your balance.' It pays what Set collateral pays, from other UTxOs; if both land the newer is kept aside and the first is ordinary balance. Lovejoin's form has no button to it.
- architecture.md:366 (the collateral): the waiting status carries `late` past WAIT_MS while heldSent holds the payment
- architecture.md:483 / flows.md:522 (Home's banner): a public mix's or Bootstrap's done title counts its boxes. One box reads 'held there until you bring it back' or 'on its way to your private balance'; plural for more, and for a watch with no count
- flows.md:512 (Mix form, public side, and Bootstrap form): once the UTxOs answer, the held figure is labelled 'What Lovejoin can spend from your public account' and the can't-afford line says 'has X ₳ a mix can spend'. Before that, or for a reading too large to keep: Home's figure, 'In your public account', and 'holds X ₳'
- flows.md:522 (Bootstrap): the private Bootstrap's review hint says it's funded first, the account deposits the boxes and what's left comes back; the public one says the deposit goes now, in one transaction
- flows.md:521 and privacy.md (Settings' collateral switch, L6): the On note is one line now; the docs carry what it dropped (a box in the 5 ₳ pool, mixed once with two other people's boxes; what the mix doesn't use comes back; the mixed box comes back by itself)
- No privacy-policy Changes entry needed: nothing new leaves the device

### fx-tests

- architecture.md:684 (token pools' records): tests/lovejoin-1-5-0.test.ts holds the classic pool's plans to 1.5.0's, to the lovelace; only what a return's chain measures keeps its slack. With the head start's pools shown, it holds the classic pool's Koios requests to 1.5.0's too, but what a shown pool asks of its own.
- development.md, Testing layers, the TypeScript row: the screens are rendered to markup (renderToStaticMarkup). A screen's wiring is tested with its effects and handlers run, over tests/screens-wiring-review-fixes.test.ts's seam: effects in the render, synchronous answers, on, seed. What a press does after an await is its rule's test's.
- Fixers' reports, in the docs round: wlj-4's 'every other figure … matched exactly' (x-compat#2): the funding grid was compared within 0.5% until R3-18. w-left's 'each hunk was mutation-checked' (314-wasm#0): four runs.ts catches had no test until R3-19.
- For the lead's e2e list: Home's two-window watch (309#0's hardening, Home.tsx:367–368) has a test at no level. One e2e case would cover it: Collateral open in a second window and its payment landing, then Home reading the balances again rather than holding its payments.

