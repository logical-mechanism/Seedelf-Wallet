# Calls for the owner: every fixer's list (fix rounds 1, 2 and 3b)

Claude-made choices the owner may overturn, warnings put in place of refusals, and what was left and why. HANDOFF.md's own list of owner's calls is separate.

## Round 1

### bootstrap

- The way back's reserve is 1.5 ₳ (phase A's choice in core), so a private Bootstrap is funded with its boxes plus 3 ₳. The least that works is about 0.3 ₳ at 1 box and about 0.65 ₳ at 96. What the sweep doesn't spend comes back.
- A Bootstrap funded between 62162483 and this fix (dev builds only) goes in with one box fewer, that box's ADA paying the way back. A one-box one comes back directly with mixCannotPay, where it used to come back with the confusing chainFailed text. A Claude-made choice.
- The review shows the way back as its own row, 'For returning the rest: 1.5 ₳, and what it doesn't use comes back', rather than folding it into 'For the boxes and network fees'. The form's refusal now reads '…with the fees and returning the rest on top'.
- The private cap rises from 53 (40 in a token pool) to one deposit's most under today's parameters: 96, or 64 in a token pool.
- Not fixed, existing before this round: lovejoin.review.bootstrapNote ('The deposit goes in now, in one transaction.') is also shown for a private Bootstrap, which takes three transactions. For the screens round.
- Not taken: restoring the 5 ₳, which the owner turned down on 2026-10-23.

### wlj-1

- 316#1 case (a), not fixed. A 1.5.0 public seed whose record went before the update can't be told from a public mix's last box without a lookup. Option 1: ask once before such a box goes back (free from the data layer's made_by on mainnet, otherwise a Koios tx_info the policy must name). Option 2: correct privacy.md:210. Recommendation: correct the doc for 1.6.0, since the case is narrow and 1.5.0 recorded no ties at all.
- 316#0 (the fix notes' item 4): nothing is held in place of a Bootstrap whose deposit isn't known to be in. Rare case: other people's mixes move all its boxes before any read lists one, and no watch sees it land. Those moved boxes then come back by themselves; they're mixed, so they tie nothing, but they leave the pool. Today's rule instead lets a box brought back before landing free one of the Bootstrap's own deposit boxes later, unmixed. Claude's call, following the review.
- 316#1: the tie is kept in a separate sealed field (Schedule.depositors) rather than the Origin {mixed:false} the review suggested, so how boxes come back is unchanged. One more sealed field, gone 3 h after its boxes leave the deposit.
- x-privacy#0: the private payer's order (box-back, then a UTxO that ties no other account, then the smallest) is Claude's default, not a refusal. Naming the accounts on the questions is left to the screens round.
- 316#3: the collateral's box shows as a mix of its own in Your mixes. With an older mix open in the same pool, its box still counts against the oldest open mix first (decision 5: mixed boxes are interchangeable), so the older card closes first. That's the hub's existing rule.

### wlj-2

- LANDING_MS = 15 min is how long the bring and a box's own run wait for a chain that is all sent. The long cases are rare: a stranger's mix moving the chain's last box before any read lists it, with no watch having seen it land, or a node dropping the last mixes. Claude chose no new request over asking Koios or the feed each run.
- The late confirming wait (BRING_LATE_MS, 10 min) only reports late and offers Stop. It does not retake the box: a retake would double-count back and countBack if the first withdraw lands after all, and could free a Bootstrap's held box. A dropped withdraw's box returns after SPENT_KEEP_MS (2 h), and the run takes it then.
- The bring waits on the collateral's box as long as its mix waits (a day at most, per 323-worker#3), reading every pool each minute while the wallet stays unlocked. It never cuts the mix; the 'unmixed, now' way out stays for after 1.6.0. No 5 ₳ pool exists on mainnet at release, so this is preprod only today.
- A box's own run now sends nothing while a chain that is all sent may be landing (usually a block or two). Before, it trimmed that chain's due times and sent.
- A wait clears an older run's `why`, as the kept-review wait already did. `fails` is untouched.

### wlj-3

- The listing grace reuses LANDING_MS (15 min), counted from when the deposit was first known in. The alternative is a utxo_info spent check: one more Koios request naming the box. A box someone else's mix really moved now holds the return up to 15 minutes.
- A box one of the wallet's own sends spent is taken for moved at once (Claude's call).
- The bounds in the words ('an hour at most', 'a day at most') are upper bounds from now.
- Koios not answering now says Koios's error rather than tail words. The return is held exactly as before.
- Not done, the owner's (323-worker#3): a direct way out of a held return, or Settings' collateral switch releasing a started tail. buildBack(direct=true) already skips the tail, so it would be a screen and words.
- chain.from is a behaviour change in Lane D's sessions.ts. After a rebuilt tail chain stops having sent nothing, the session counts as started: its next return is plain, no 5 ₳ offer, and a mix session is no longer marked 'Not mixed'.
- gap-1#0 unblocks the switch for every private session's chain, as the finding suggested. The optional countdown words are left for the screens round.
- Seen, not changed: the switch's maybeSent check covers the payment watch, which can hold a private transfer or withdraw, where 'from this account' may also be inexact.

### wlj-4

- 318-worker#1 is a warning, not a refusal (the owner's rule). It knows only this device's starts, is said for a day (STARTED_SAID_MS), names no time on screen, and the form's Review stays on.
- 319-worker#0 changes what a swap's approval records. Where the classic pool has room for a box at neither width and four is asked, it now records width 4 (as asked), for the return to decide; before, FOUR_SHORT made it record three. No figure shown changes. The alternative is to drop the reason in lovejoinCost/priced and keep three.
- 318-worker#3 reads the parameters up front in a private mix's and Mix my boxes again's review, as outBuild does. A classic mix refused at the pool read now has made one generic epoch_params request where it made none; every review that goes through makes fewer.
- x-compat#2 edits the gate file additively: a case, an optional handed parameter on wire/plans/afterUpdate, and the record guard. The original cases and the fixture are byte-for-byte unchanged. The optional populated-5 ₳-pool case isn't done: it can't meet 1.5.0's record without re-recording.
- 318-worker#0's banner words aren't done (the screens round's). Until then, a public Bootstrap's done banner still says 'In Lovejoin, on their way to your private balance'.

### deep-datum

- **The rule:** only a datum past MAX_DEPTH (128) or not one CBOR item, not 'any datum on a script row'. Neither rule hides any existing pool. The depth rule refuses only what the wallet can't decode, and is the limit it holds every untrusted datum to.
- **Immediate lock:** a WebAssembly stack overflow now locks the wallet at once with a fresh instance, wherever a trap does. Before, it was swallowed and the broken instance trapped at some later call.
- **How a WebAssembly overflow is detected:** by a WebAssembly frame on the RangeError's stack (V8's format). Probing wasm-bindgen's stack pointer was rejected as tied to the glue's internals. If detection misses, the error is swallowed as before.
- **candidate() reason:** core's candidate() now answers Rejected::Unreadable (not BadDatum) for a reference output whose datum is too deep. Not visible through WebAssembly, where resolve_row refuses that row first.

### pool-exists

- The classic pool's deposits read nothing, byte for byte 1.5.0's (the 1.5.0 gate passes unedited). That pool is bundled and on chain, so it can't be faked.
- Every token-pool deposit costs 1,804 lovelace more, the 5 ₳ collateral tail's included.
- Not done: confirming a listed pool exists before hand-over (one Koios utxo_info per newly listed pool, the same for every wallet). Without it, a lying server or a deep rollback can still make a pool that isn't on chain show on the hub, kept for good (STATE-2), with Bootstrap offered. No money goes in now: the deposit is refused at submit.
- The refusal's words fit poorly. BadInputsUTxO is read as SpentInputError, which shows koios.spentInput ('a UTxO it spends is already spent…'), not that the pool isn't on chain. The chain stops as for any refused deposit (chainRetryMs) and the session comes back directly. koios.ts isn't this lane's, so it's left as is.
- The refresh guard leaves out a listed pool whose launch or script rows aren't the reference row's own transaction. It refuses an inconsistent server answer, never a user action, and the data layer's standard rule demands the same.
- Core refuses a deposit into a hand-made token Protocol whose first reference carries a script, rather than building it under-priced. It can't happen for a verified pool.

### max-left

- A blocked chain reads as fee, not limit. This covers a chain that would pass 25 parts, or fail otherwise, after a part couldn't pay its fee. The review then shows fewer than 25 transactions, so 'goes as 25 transactions at most' would contradict it; 'too little ADA to pay for spending them' is true of what stays. Claude's call; the alternative is a typed past-the-cap error from max_chained, mapped to limit.
- The wording: the new fee line, and the cap line now counted in transactions, without 1.5.0's 'and some tokens won't fit in one output'.
- The fee case keeps the existing lead-in 'N private UTxOs stay for another payment:', though another Max over them is refused until more ADA comes in.
- Max over no UTxOs reuses one transaction's refusal rather than words of its own.
- MaxLeftNote lives in Withdraw.tsx, imported by Transfer.tsx, to stay within my files. ui/components/LeftOut.tsx, beside LeftOutNote, would be the more natural home if the screens round wants to move it.

### reserve

- The money: a site's session and a top-up that pays a new collateral now add 2.8 ₳ (today's parameters) instead of 1.5 ₳ where a 5 ₳ pool would take the collateral. It's live on preprod, and dormant on mainnet until a 5 ₳ pool holds 30 other people's boxes. What isn't used comes back. The alternative: keep 1.5 ₳ and say the collateral is mixed only where enough is left at the return.
- Swaps keep 1.5 ₳, relying on SWAP_MARGIN less the order's fee coming back beside the reserve, with the fill carrying the sweep's least (measured at both byte prices). If SWAP_MARGIN is lowered, revisit; its doc now says so.
- In a swap the reserve is left out before the token's boxes; at 9978654a the boxes went first.
- The fallback says nothing: a funding without the reserve shows no For its collateral's mix row, as with Settings' switch off. Words, if wanted, are the screens round's.
- Rounding up to 0.1 ₳ and planning the tail's mix on MIX_FEE_ESTIMATE leave the figure 0.137 ₳ over the least that builds today.
- Not fixed (a WebAssembly change beyond these findings): a direct return whose ADA sits only in token UTxOs has no ADA-only UTxO to pay for the collateral's mix, whatever the reserve. For example, a swap against the pools whose transaction puts the token and the change in one output.
- Not fixed (screens round): 323-worker#0's form half (swap Max and shortfall, the Mix stepper, FEE_ROOM), and counting lovejoin-funding's new field (320-screens#2, 321-lj-screens#3, with 321-lj-screens#4).

### rr-1

- 314-core#1: checked sums refusing in words, rather than bounding box_lovelace at read time. Refuses nothing the chain takes (such a launch still builds, per 'no upper limit') and leaves the decoders, the shared vectors and the data layer alone. The words are Claude's.
- 312#0: the five-box test asserts the measurement's refusal, not the guard's words. Reaching the guard at five needs MEASURE_LIMIT raised past 15B, which bounds every local measure; left alone.
- 314-core#0: an unusable pool's launch from too little balance now says 'Not enough ADA in the Seedelf balance…' first (selection runs before usable). Before, every choice failed with 'couldn't be used'. The form's least-box-value check makes this all but unreachable.
- 314-core#0: test-only (cfg(test)) counters in templates.rs and pool.rs, compiled out elsewhere. The template bytes are untouched and templates_are_frozen passes.
- 318-rust#1: an account whose only big-enough UTxO carries a reference script is refused with the existing 'There's nothing in the public account to pay for a launch'.
- 319-rust#0: a token WebAssembly can't spend now gets a 0-box leg (instead of failing the plan), and the worker's way says sess.skip.warn.noBox, which isn't the reason. Fix belongs in acrossOf (Lane L).

### rr-2

- Removed external_sweep_with rather than checking `extra` (the brief preferred keeping public functions): no caller anywhere incl. the CLI, never in a published seedelf-core (0.5.0 lacks it), and external_sweep is back to 1.5.0's code.
- New native test wasm/tests/readme_test.rs makes cargo test --workspace (CI) fail when an export lacks a README row (names only).
- with_staking still refuses a key's cert 0, as the old rule did via signers(): the ledger asks no witness for any cert 0, but no caller wants it and taking it would need signers() changed for the fee; not a user-facing refusal (the only caller is a launch).
- The with_staking refusal's words are Claude's.
- Edited wasm lib.rs Room::after's stale comment, outside my findings (named by gap-2#0's skeptic), since no later lane edits Rust comments.

### docs-1

- gap-3#7: documented as the code behaves (the switch is greyed with returns off but still applies to a return through Lovejoin, such as a mix from the tile). If the owner meant 'off', the worker would treat lovejoinCollateral as off while lovejoinReturns is off (a sessions.ts change).
- docs-small#1: the optional one-time check of L when the data layer first hands a pool over (one batched account_info per listed pool's L). Not built: it's code, and the skeptic left it to the owner.
- 312#3 part 2: refuted, so no table change; one clarifying sentence was added about the fixture's key-address script references.
- Extras beyond the findings' lines, each the same stale claim: plan :328, flows.md:493 (Top up's reserve row), architecture.md:109, and preferences.ts lovejoinDepth's 'three wide' comment.

### docs-2

- The live harness fixes (network pick, card lookup, Manage, radios, vote label, keyword, per-run tags) were never run live: fixers can't send transactions. Under the owner's rule, someone allowed to should run `node e2e/live/run.mjs all` and `staking` on preprod before the owner relies on them.
- Checklist item 6 says to send a Start a pool only when testing a change to it, since each pool started shows to every preprod wallet for good. That rule is my call.
- The deploy check uses seedelf-data's live-test mainnet pool and stake address (public, on chain); the owner may prefer their own pool.
- The policy's Cardano-server bullet got one extra sentence (it measures the collateral mix), beyond the finding's lines. It's the same omission, already recorded in the 18 October entry.
- Adding nft-images.json to data-layer.yml's paths (a compile-only dependency) is my call; drop it if it's noise.

### i18n-existing

- x-i18n-ja#4's direction: the critical lovejoin.launch.warn.atMost took Lace's and 1.5.0's 資格情報, rather than the non-critical lj.launch.otherPool taking クレデンシャル.
- Glossary: change recorded as 釣り銭 (8 values since 1.5.0), not the finding's おつり. おつり is left in drep.register.short and the critical lovejoin.launch.privacy.private.
- Glossary: a 'the server' row added to the owner's table, recording the owner's 2026-10-09 call, which until now lived only in flows.md and privacy.md.
- Spanish wordings chosen: 'Retenidas por un arranque: {{n}}' (a heading and its count), 'Nueva mezcla de {{what}}', 'con cargo a esta financiación' and 'Poniéndose en marcha'.
- x-scenarios-sessions#2 (b), a worker-sess finding, done in the same edit: partlyMaybe now says the rest didn't go, in en, es and ja.

### wss-1

- Remove wallet needs its existing second yes (Remove it anyway) while a payment's parts wait, as for a Lovejoin chain being sent: the existing question gaining a line, not a new refusal.
- The countdown only warns: waiting parts don't put auto-lock off (no new refusal, as asked); Stay unlocked is there.
- A session's funding in parts gets no line of its own in Remove wallet (its session's line covers it), but the countdown counts it.
- New reason 'locked' in PendingTx.parts.stopped; no screen tells reasons apart (the banner says 'only partly sent').
- Remove wallet's line counts payments rather than saying 'N of M sent', to keep the text short; AtStake.partsWaiting carries {sent,total} for the screens round.
- 321-parts-worker#3: a later part missing from Send's keeping is now refused as a stale review before anything goes (was: the first went, then the rest were refused); giveme.my is still asked before the reservation check, as for one transaction.
- 321-parts-worker#3's second half (sendChain in sessions.ts refusing what a waiting part reserved) not done: not my file.

### wss-2

- 309#1: the collateral reads "waiting" for up to two hours while its payment can still land, so Set collateral isn't offered meanwhile, even if a mempool dropped the payment. This matches Home's banner and the balance. It is a state, not a refusal: collateral-build isn't refused. Alternatives: the old 10 minutes, or a "set it again anyway" control (screens round, needs words).
- 309#1: heldSent (sent-txs) is the source rather than the pending watch the finding suggested. The watch holds only the network's latest Send, so a later public payment would flip the collateral to Not set while it can still land. Edge case: a public payment that can no longer land (its inputs spent by another) still reads "waiting" until its two hours pass; the balance counts it as on its way too.
- 318-worker#2: the pending row is left out rather than shown as back-paid at an amount, because the device can't price it once the next balance reading drops the spent coin. Showing it pending at the right amount needs Lane L (withdrawOne paid: pass the payer to rememberSpent and keep WebAssembly's `paid` on the private entry). A validity interval on buildLovejoinWithdrawPaid would change its bytes. Neither was done.
- x-scenarios-sessions#0: if utxo_info has no row for such an input, the whole scan fails as not caught up (C14), and Find leftovers asks again. The alternative would write a record that leaves that part's tokens out for good.
- x-scenarios-sessions#0: a transaction counts as the session's own when its first UTxO spent at the wallet contract carries this phrase's register. Nothing else is checked, including whether it paid the account, which can't matter since only outputs at the account are taken.

## Round 2

### sc-lj-1

- The collateral's mix counts as a cost on the form, where it applies: 'Mixing 10 ₳ costs about 6.35 ₳ (63.5%)', with its own part row, so the rows still add up.
- The stepper keeps the reserve aside (private by default): in a ~1.5 ₳ window it offers one box fewer than a funding without the collateral's mix would pay for. Settings' collateral switch turns that off. It's not a refusal: Review and the worker's fallback are unchanged.
- FEE_ROOM is 2 ₳ (the fee and the change's least) for the Mix stepper and the Bootstrap form alike: a 1 ₳ bend on classic-only screens, now said before Review where the funding refused it at Review.
- The public side's held figure and cap show what a mix can spend, not Home's public figure. cantAffordPublic's words changed to match.
- The review hints change only where the collateral is mixed (*NoteMixed); the general wording waits for Session 10's call 2.
- The x-privacy#1 note reuses sc-o-1's swap note (one critical key for both approvals), short, under the giveme.my note.
- The again switch shows the built width: where four was asked and it went three, it shows three, with the WidthNote.
- 321-lj-screens#4 is fixed in the tail case only; without a 5 ₳ pool the form still counts the 5 ₳ as coming back once it's mixed (call 2).
- The e2e setup change in the 'without its collateral' test.

### sc-lj-2

- Stop now shows during every wait after sends, and once a withdraw is late. Owner's item 7 ('no Stop') now holds only for the plain confirming minute. The late line's '10 minutes' and '2 hours' are written into the words, matching BRING_LATE_MS and SPENT_KEEP_MS.
- 320-screens#0: a start becomes 'hasn't shown' after 30 minutes. The line still goes after a day (STARTED_SAID_MS). There is no link to the launch transaction, because the wallet doesn't link out.
- 320-screens#0: the Send-time re-check is not done. Refusing there would be a refusal the chain wouldn't make, and it couldn't catch the race anyway, since discovery sees a launch only once its block has settled.
- 320-screens#1: the box ADA field now shows a ₳ unit (AdaInput). The quantity's too-much note reuses swaps.rules.tooMuch.
- x-privacy#0: accounts are named 'Account N' (nameOf), not 'Public account N', because the critical-helpers guard allows only accounts.numbered in a privacy note's placeholders. Names show only on wallets with several accounts. No refusal.
- 321-lj-screens#5: the worker hunk relies on Lane W's bring flag. The new reason key is named .warn. because it fills the stopped warning's {{why}}.

### sc-o-1

- adaShort doesn't count the collateral's reserve: a balance short of it is funded without it, and refusing would be a guard the chain doesn't make. Max keeps it aside by default. An amount typed past it silently loses the collateral's mix (round-1 reserve call 4). Option: a note when the quote names a reserve but the summary has none.
- Max keeps the reserve aside wherever a 5 ₳ pool is shown in discovery's set, without checking its floor or free boxes (no pool read as the user types). Where a shown pool is under its floor, Max leaves 1.5 ₳ more than the funding takes.
- FEE_ROOM is 2 ₳. A Max over many UTxOs, or whose change holds many tokens, can still need more, and Review says so.
- The costs notes (swaps.costs.note*) are unchanged: the collateral's mix is its own labelled row instead. Option: name its deposit and mix in the note.
- COLLATERAL_MIX_COST is 1.5 ₳ (0.25+0.95+0.3) against 1.29 ₳ measured; on a swap, Comes back then equals the no-reserve figure.
- By-hand 5 ₳ notes (swaps.collateral.note, swaps.backCollateral.note) are not reworded: their reviews pay no reserve, and they're Session 10's call-2 class.
- A swap approval whose only Lovejoin part is the collateral's mix (no box) shows no switch; that mix can be turned off only in Settings. Not changed.
- No giveme.my line on site and top-up funding reviews: their returns are reviewed by hand, where CollateralTailNote says it first.
- Not fixed (Lane W's worker logic): stopCost prices Stop's boxes on spare with the reserve in, so at the boundary it names one box more. Suggested: held = spare - (s.collateralReserve ? lovejoinCollateralReserve() : 0), plus a planner boundary test.
- Small anchored edit in S1's Lovejoin.tsx (the Start mix button) for 320-screens#3; sc-lj-1's scope doesn't include it.

### sc-o-2

- Home lets go, with no banner, of an ordinary payment another page saw land inside its hold. It can't say 'Collateral set' without the confirmations the worker gave the other asker. This matches chunk 35's rule for Settings' page. The alternative, a worker answer to an asker naming its txHash, is Lane W's and not done.
- The rule stops at Home's 10-minute hold, as the finding advised. A public payment that lands after 10 minutes and is seen first by another window still leaves 'not confirmed yet… If it hasn't by then, nothing was sent' (with Dismiss, holding nothing back). Extending to the slot's 2 hours for a payment with a slot would cover it, at the cost of dropping a true banner in a rarer case. Not done.
- pending.confirmed.lovejoin_bootstrap is not critical: it's a status title like its pending.confirmed.* siblings, none of them critical, and the critical set is warnings, privacy notes and errors. The finding suggested critical; to do that, rename it with .warn. and back-translate it.
- Words are wlj-4's suggestion: 'A Bootstrap' and 'In Lovejoin, held there until you bring them back'. es 'Un arranque' / 'En Lovejoin, retenidas allí hasta que las traigas de vuelta'; ja 'ブートストラップ' / 'Lovejoin 内にあり、あなたが戻すまでそこに保持されます'.
- The Collateral page opened in place says Set up to 15 s after Home's watch saw the landing, not at once. Home's banner isn't on screen meanwhile. Handing Home's reading down, as Lovejoin's form has it for R6, would make it immediate.

### w-left

- A box's own dropped withdraw, taken again later, still counts back twice. This was there before 1.6.0's review, in the regular flow. Fixing it means recording every classic withdraw's box in the sealed schedule, which changes the records the 1.5.0 gate pins. So `counted` is kept only for Bring every box back now's withdraws. Fixing the regular flow too would need the gate's fixture re-recorded.
- A box taken again within Bring every box back now takes no due time (rather than the pool's earliest). If a page's read had already given it one, that one is left over until the next read trims it. The other way would take another box's due time.
- Stop's recheck is one pool read 2 hours after Stop (the same read every wallet makes), and the alarm keeps going until then. The run stopping itself sets one too.
- The runner locks the wallet on a trap from any of its steps (not only withdrawDue's) and ends the run there. Four more Lovejoin catches hand traps on: the run's pool read, its per-box catch, a box's own withdraw, and readSet's `known`.
- sendChain refuses up front only for a payment's parts. A Lovejoin chain being sent that holds one of the return's inputs is left to reserve()'s existing refusal ('Lovejoin's pool changed…'), a case build-time reservations make all but unreachable.
- withinDepth is a third copy of core's datum rule, after core and the data layer. Its test against core's vectors fails loudly on a change. Asking WebAssembly instead needs a Rust export, which this round doesn't allow.

## Round 3b

### fx-reserve-1

- R3-10 option (a), not taken per the brief: WebAssembly's direct_tail would pay the collateral's mix from a token UTxO's ADA, its tokens going back as the deposit's token change. That needs Rust and a pkg rebuild. It would cover the pools' direct return, a swap approved as an order that Minswap routes to the pools at build time (option (b) still misses that one: the reserve is taken and the mix can't be built), and site sessions whose dApp leaves its ADA beside tokens.
- An ADA-out swap funded without the reserve gets the mixed words but no cost row, since the cost row stays on the reserve. The mix's fees, about 1.2 ₳, come out of what comes back, so 'Comes back' reads high by about that much.
- An ADA-in swap without the reserve never names the collateral's mix for its stop or refund path, whose return could build it. Stop's dialog now says it when stopping. The skeptic's short clause on the approval's ifStopped line is left to the owner.
- A site's funding or top-up without the reserve, with a pool taking the collateral, says the 5 ₳ is mixed once. That's true where the site leaves ADA alone to pay for it, and the return's own review (CollateralTailNote) says whether it is before anything is sent. The alternative was keying on the reserve alone.
- R3-11: 'maybe' keeps the reserve (the private default). A pool read older than 5 minutes counts as unknown, never as a refusal. The data layer's crowd count is trusted whatever its age, since it refreshes with each pool read. On preprod, 'maybe' is the swap form's usual state until a review reads the pools.
- R3-12: Max's flag survives a change of the token received; only the pay token clears it, as the skeptic suggested. It follows Max down only.
- Stop's dialog shows the line on 'maybe' (when the dialog's pool read failed), as a disclosure. It also shows with no box, because then there's no switch and Stop isn't direct.
- The Stop line reuses swaps.review.privacy.collateralMix ('giveme.my backs its collateral's mix too…') rather than a new key, which would need its own back-translation.

### fx-reserve-2

- R3-7's line hedges ('mixed only if enough is left when it comes back') rather than the lead's 'isn't mixed', which the code shows is sometimes false: buildBack's intoPool and WebAssembly's with_return still build the collateral's tail from the chain's change where it pays. It's a .privacy. key, so critical.
- R3-7's band: where the balance pays the reserve but the form's FEE_ROOM (2 ₳) says it doesn't, about 0.3 ₳ wide, the form's figures leave the reserve out and the line shows, though the review then counts it. The review is right; the form is conservative by FEE_ROOM's own design.
- The Mix reviews (PrivateReview, AgainReview) say nothing new for a mix funded without the reserve where a 5 ₳ pool takes its collateral. Session 10's call 2 kept their notes, and their giveme.my note stays tied to the reserve. fx-reserve-1 offered collateralPool on mixFunding's summary and the same line on the review; not done, since it would reopen that call.
- R3-14's Rust half, not made: chain_from_account_at taking more UTxOs holding the token before refusing, where ADA alone doesn't cover the need. It would make the pick monotone, so the stepper could offer a count above a gap (today, where one and three pay but two doesn't, it stops at one), and it removes a refusal the chain wouldn't make. Token pools only, so the classic pool stays byte-identical; needs a pkg rebuild.
- R3-14 prices the output that gives tokens back at today's 4,310 lovelace a byte (LEAST_PER_BYTE), as FEE_ROOM's comment does. A dearer byte would let the stepper offer at most one count that the build then honestly refuses, until the constant moves.
- R3-14's ties: between UTxOs holding as much of the token, the form picks the one with less ADA first, while the build takes Koios's order. The form may offer a box fewer, never more.
- R3-14: the public held figure in a token pool now follows the stepper's count on the Mix form, and the Bootstrap form's own count there.
- R3-8's TooLarge half is matched on core's two TooLarge sentences, not on the shared 'over the network's limit' phrase. The reserve adds ADA, not tokens, so only more inputs can reach it.
- Left as they were: Settings' collateral switch is greyed while returns are off even though a mix still pays the reserve (R3-7's context, older than this round, Settings' lane). A top-up that is still too many UTxOs without the reserve still shows core's raw words; mapping them through short.ts's tooMany() is older and separate.

### fx-lj-1

- The payer order covers every public account's box, own mix leaves included: the R3-3 skeptic's rule, a superset of the lead's narrowed R3-2 formula, so a box is ranked the same whichever account is on screen. Narrowing it is one line (given in the report), and the R3-3 own-box test's payer then flips to d1.
- The hatch ranks the account before backOrder's early key, so the page can name the account exactly. An own box a mix moved within the delay's least can go before another account's box that has waited longer.
- PaidQuestion names an account only when every box the hatch can take is another account's (the lowest of them). The page can't see reservations, so in one rare case it names nobody while the worker takes another account's box: the account's own box held by a kept review.
- R3-6 holds the whole LANDING_MS (15 min) from Tail.landed. Meanwhile no box comes back by itself and the bring says it's waiting. The tighter end (a new Tail mark) is not done.
- R3-5: after Stop, the box the dropped withdraw went for comes back by itself at its due time, tying its deposit as Bring every box back now's question said (w-left's (b)). Before this fix, a box the run never sent came back by itself instead.
- R3-23: both stuck questions are back to 6 sentences, still over 'a few short sentences'. The skeptic left further compression out of scope.

### fx-lj-2

- The page that pressed Stop also says 'Stopped: N sent back.' (a new line there; it said nothing before).
- The Stop mark has no time bound: it goes at the next ask, or with the wallet (a background tab may read only once a minute).
- The late line's wording, and the unlocked line folded into it in the late state only.
- A cut collateral's mix: Bring every box back now waits up to a day for the session's return to build that mix again. A swap's runner builds it by itself; a site's session, or one stopped to come back directly, may never, and the run then waits the whole day ('a day at most') before bringing the box back unmixed. Stop ends it at any time. Private by default, as the lead asked.
- L4 goes past the named sites: sessions.ts's five spentSet reads moved too, to keep the file on one clock; pending.ts's three rememberSpent calls (:351, :523, :875) stay on the device's clock.
- L3 goes past the list: lookFor, progress()'s two publicUnsettled catches, and publicSubmit's watch, so that watchOf's rethrow reaches a handler.

### fx-misc

- R3-24's Settings line is two short sentences (26 words), not the skeptic's one of 20: it keeps 'if not, it comes back with the rest' (the tie) and the cost
- R3-27's label says 'What Lovejoin can spend from your public account', not '…a mix can spend…', because the Bootstrap form shows the same figure
- The banner counts a mix's boxes too, so a one-box public mix (the classic pool's included) now reads 'on its way'. These are 1.5.0's words for that case, changed; e2e updated
- Pay it again anyway is offered only once the payment is late (10 minutes), on the Collateral page only; its line is a .warn. key (critical). Lovejoin's form still has no button while the payment waits; a one-line offerCollateral change in lane X's Mix form could add it (not done)
- tokens/since/{C} stays outside ALWAYS_KEPT (parity with the classic since since 1.5.0, whose failure costs more). Changing it is a cache design change, and a flood that fills the budget holds the 2 private connections anyway
- R3-16 is a text test, not one shared CTE string (production SQL nothing offline can run)
- R3-31: build.rs's MAX_TX_BUDGET doc is kept with mainnet's epoch added. withdraw_with's optional total check (the skeptic's code alternative) isn't done

### fx-tests

- The gate's four case bodies are untouched. R3-18 lives in nearly() (slack only under '.returns['), so the original plans case is now exact on its funding grid through its helper. That's the skeptic's equivalent route, in its positive form.
- R3-17 sets aside only what a shown pool asks of its own, by name: the shown boxes in each read, the return's one pool read and the status read's one epoch_params. Any other new read fails the case, so a refresh that changes how pools are read fails loudly and classicCalls needs adjusting.
- The harness seeds await-only states (reviews) by position. A state added before the seeded slot fails the test with 'a seed … met a state starting …' rather than passing.
- Not covered: Home's two-window watch (behind an await; needs e2e), and what any press does after its await (Stop's halted, widthTurned's take, Collateral's onSent). Those stay with their rules' tests: bringFollower, widthTurned, lookAgain.

