# Lane E8a

Returned by the workflow's agent `a76117162bb2685aa`, written here by the lead from its structured answer.

## Findings (3)

### e8a#1 · low · A mix from the private balance, and Mix my boxes again, build their chain at Settings' depth and wait when the runner builds it, not the reviewed ones

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4667`
- **Who:** user · **Since:** 7db81171 (chunk 16, the tile's mix from the private balance, before web-wallet/1.0.0); L21's fix 52044817 kept the approved depth and wait for swaps only · **Confidence:** traced

**Scenario:**

5 ₳ pool, Settings at 1 wave deep. The user reviews Mix with 1 box: funding 1.5 + 5 + 0.95 = 7.45 ₳, and the review says '1 wave deep, 1 mix' and 'after 1 to 6 hours'. They press Start mix. Before the runner builds the chain, they set Settings to 3 waves (13 mixes, 18.85 ₳ a box). That window runs from Send until the funding lands and the next step runs. It is up to 20 minutes after an unlock, and it opens again whenever a lock cuts the chain before its first send, after which the chain is rebuilt. The chain is then planned at depth 3. 5.95 ₳ of spare pays no 18.85 ₳ box, so the mix is skipped ('its ADA doesn't pay for a box and its mixes anymore'). Everything comes back directly, unmixed, and the funding's and the return's fees (about 0.4 to 0.5 ₳) are spent for nothing. Other cases: (a) a review of 3 boxes at 3 waves (53.55 ₳, 39 mixes, each box 'one of up to 27'), then Settings set to 1 wave: the chain mixes 3 boxes once each, each one of up to 3, and about 34 ₳ of mix fees comes back directly; (b) a review of 10 boxes at 1 wave (61 ₳), then 3 waves: only about 3 boxes go in, the rest back directly. The wait follows Settings at build time too (6 to 24 h, or the reverse), and so does the collateral switch. No screen says the reviewed mix changed.

**Evidence:**

The review shows the depth and wait it was funded at: Lovejoin.tsx:3883 `mixedValue(mix)` and :3888 `delayText(mix.delay)` (AgainReview :3966-3967). Both come from lovejoin.ts funding() at Settings then (lovejoin.ts:3591 `const depth = fixed ?? set.depth;`). mixOutSubmit records neither (sessions.ts:2330-2339): `mix: { boxes, again?, publicToo?, bootstrap?, noCollateral?, pool?, width? }`, `auto: { approved: { minAmountOut: "0", fund: {...} } }`. Only a swap sets `auto.lovejoin` (sessions.ts:3156, 52044817). buildBack passes `record?.mix?.seed || record?.mix?.bootstrap ? 0 : record?.auto?.lovejoin?.depth` (sessions.ts:4667), which is undefined for a mix session. chain() then takes `const depth = fixed ?? set.depth;` (lovejoin.ts:3701), and countAt calls plan(..., fixed, ...) (:3743), where plan reads `fixed ?? (await this.settings()).depth` (:3379). A chain whose countAt is under 1 returns undefined (lovejoin.ts:3750), and buildBack sets `sess.skip.warn.mixCannotPay` (sessions.ts:4680). The wait: `const delay = record?.auto?.lovejoin?.delay` (sessions.ts:4577) is undefined, so `chainDelay = delay ?? (await lovejoin.settings()).delay` (:4695) goes into the chain's record. The width is kept (wayOf, sessions.ts:6413) and the depth is not. A chain cut before its first send is built again (the comment in Lovejoin.tsx:890-893). The swap's sibling, independent review L21 (low), is tested in lovejoin-chain-review-fixes.test.ts:309-325. I found no such test for a mix session.

**Fix:**

Keep what the review was funded at, as L21 did for swaps: record the funding's depth and delay with the mix session (for example `mix.depth` and `mix.delay`, or `auto.lovejoin: { depth, delay }`) in mixOutSubmit, and pass them as `fixed` to chain() and as the chain's delay in buildBack. That covers the tile's Mix, Mix my boxes again and a private Bootstrap's 0. The collateral switch read at build (collateralIntoPool) belongs to the same family: record `collateralReserve`'s intent with the session. Test: in the style of lovejoin-chain-review-fixes.test.ts, mixOutBuild and mixOutSubmit 1 box at lovejoinDepth 1, set lovejoinDepth 3, land the funding, advance, and expect a chain with one mix (today: skipped).

**Known check:**

Searched backlog.md and archive/plans/*.md for 'depth', 'L21', 'approved depth', 'mix session', 'Settings since'; only the swap case (independent review L21, 52044817) is recorded and fixed. Nothing on the tile's mix or Mix my boxes again.

### e8a#3 · low · Pay from my private balance anyway warns of a tie to 'your public account' when the boxes it takes are another account's

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:3649`
- **Who:** user · **Since:** 1c054c3b (the question, 2026-09-27), before several accounts (chunk 18); not reached by 1.6.0's x-privacy#0 naming · **Confidence:** traced

**Scenario:**

Two public accounts. Account 2's public mix left 2 boxes in the 5 ₳ pool, and account 1 is on screen. On the pool's page, AgainActions shows 'Pay from my private balance anyway', because anyAccount counts every account's public boxes. Its question says: 'Some boxes came from your public account. Paying their mixes from your private balance ties the private UTxOs it spends to that account. Mix again from my public account doesn't.' The review that follows says 'Some of these boxes came from your public account, so this ties the private UTxOs it spends to that account.' Start mix ties the private UTxOs it spends to account 2, an account neither screen names. Elsewhere the page treats 'your public account' as the one on screen (x-privacy#0's reasoning in anywayWarning and PayerNotes). Account 1's 'Mix again from my public account' doesn't take account 2's boxes either.

**Evidence:**

The link is offered at Lovejoin.tsx:1635-1645 when `anyAccount > 0` (`unheld(theirs)`, where theirs = `publicBoxesOf(pool).all` holds every account's boxes, :1563, :1576). The question at :3633-3651 says `tr("lovejoin.privacy.privateAnyway.privacy.ties")`. The key is `lovejoin.privateAnyway.privacy.ties` = "Some boxes came from your public account. Paying their mixes from your private balance ties the private UTxOs it spends to that account. Mix again from my public account doesn't." Confirm calls `again(true)` → `lovejoin-again-build` with anyway → againBoxes: `const owned = publicToo ? split.owned : this.privately(...)` (lovejoin.ts:3501), so every account's boxes are taken. AgainReview (:3979) adds `lovejoin.review.privacy.publicToo` = "Some of these boxes came from your public account, so this ties the private UTxOs it spends to that account." Neither names an account. The named forms exist only for anyway, held and payer (anywayWarning :1064-1090, HeldQuestion :1476, PayerNotes :1167-1181).

**Fix:**

Name the accounts in both the question and the review: the active account's boxes (`publicBoxesOf(pool).mine`) and the others (`.accounts`), and have againBoxes return which accounts `publicToo` pulled in (for example `mix.publicAccounts`), so the review names exactly those. New `.privacy.` keys, back-translated blind in es and ja. Same family: Chains' chainName (e8a#2), and any other line that says 'your public account' for a box that may be another account's.

**Known check:**

Searched backlog.md and archive/plans/*.md for 'privateAnyway', 'payPrivateAnyway', 'Pay from my private balance anyway', 'publicToo', 'x-privacy'. The privacy review §2.10 and chunk 16 record the warning, and chunk 34's session 5 notes an older other-account wording in the anyway question, since fixed with hidesNamed. Nothing on this question or the review's publicToo line with several accounts.

### e8a#2 · nit · A public account's stopped chain on the hub says 'Mix my boxes again mixes the boxes it didn't', and doesn't name which account

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:973`
- **Who:** user · **Since:** 1211a5d2 or earlier (the words; before web-wallet/1.6.0) · **Confidence:** traced

**Scenario:**

A public mix in pool A stops partway (for example a lock cut it), leaving boxes not mixed yet. Later a public chain in pool B, or from another account, is all sent. progress() now returns null, because the newest public chain isn't stopped, so `sending` is null and the hub's Chains lists A's row. The row reads 'From your public account, N boxes · Stopped … Why it stopped: …. Mix my boxes again mixes the boxes it didn't.' Mix my boxes again leaves a public mix's boxes out (privacy review §2.10). The button that takes them is Mix again from my public account, on the account that paid, which the row doesn't name. The pool's page words it right (NotMixed's takes.public, OtherAccounts).

**Evidence:**

Lovejoin.tsx:972-976: `c.stopped ? tr(c.retired ? "lovejoin.detail.whyStopped" : "lovejoin.chains.whyStopped", ...)`, with no check of `c.session`. chainName :930-931 gives `t("lovejoin.chain.fromPublic")` for any public chain, whichever account. The hub hides public rows only while `sending` is set (:1935). progress() returns null when the newest public chain isn't stopped (lovejoin.ts:2985-2992, `lastOf()` = `.at(-1)` of every public chain). rows() lists stopped public chains while boxes are left (lovejoin.ts:2179-2180, :6623-6645). tests/screens.test.ts:1098 pins these very words for a public chain (`{ boxes: 2, total: 9, sent: 4, at: 2, stopped: ... }`, no session).

**Fix:**

For a row with no `session`, say why it stopped and point to Mix again from my public account, on the account that paid (the chain view would need its `account`, as LovejoinMixView has), or say why alone, as for a retired pool. Name the account in chainName with several accounts, as MixCard's `whose` does. Update screens.test.ts:1098.

**Known check:**

Searched archive/plans/*.md for 'whyStopped', 'Mix my boxes again mixes', 'W8'. 1.8.0's W8 fixed the retired-pool case only, and chunk 34's LIVE-1 is about a cut chain read as stopped. Nothing on public rows.

## Guards (15)

| Where | What it stops | Test |
|---|---|---|
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:278` | boxesAffordable: the stepper offering boxes the private balance can't pay (box + its mixes, beside 5 ₳ collateral and 2 ₳ FEE_ROOM) | tests/screens.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:301` | mixMost: offering more boxes than ten, the pool's room, the side's ADA or token (public token pools count by count via publicBoxesAffordable :458) | tests/lovejoin-form-review-fixes.test.ts, tests/lovejoin-held-balance.test.ts, tests/lovejoin-public-cap-review-fixes.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:226` | poolRoom/formRoom (:259): offering a count the pool can't mix at the depth and width (need = boxes × mixesPerBox × (width−1), as the worker's enough()) | tests/lovejoin-screens-review.test.ts, tests/lovejoin-share-review-fixes.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:352` | mixOffer/tailReserveOf (:329): the form's totals leaving out the collateral's reserve, and the reserve capping or refusing a count the worker funds | tests/lovejoin-form-review-fixes.test.ts, tests/lovejoin-share-review-fixes.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:3721` | bootstrapLimits: a Bootstrap past one deposit's most, the private side's reserves-paid most, or one the private balance/token can't pay | tests/lovejoin-release-rules.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:1605` | AgainActions: Mix again (both sides, :1616) and Pay anyway (:1639) off in a pool that takes no new box (againRefused); Bring one back now hidden where every box is held or unmixed while mixing again is refused (nowRefused :1594), hidden in a stuck pool | tests/lovejoin-screens-review-fixes-1-8-0.test.ts, tests/lovejoin-merged-screens.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:3167` | hatchTakes: the escape hatch offered where no mixed unheld box exists (worker would refuse) | tests/lovejoin-merged-screens.test.ts:534-538 |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:1103` | anywayRequest/heldRequest (:1113)/hatchRequest (:1119): in a stuck pool a box-paid withdraw core refuses; the payer named by the button is sent | tests/lovejoin-session5-screens.test.ts, tests/lovejoin-merged-screens.test.ts, tests/lovejoin-crediting-review-fixes.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:3829` | lessReserve: the private review's 'For the boxes' row counting the collateral's and Bootstrap's reserves twice | tests/collateral-reserve-review-fixes.test.ts, tests/lovejoin-form-review-fixes.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:4011` | publicAfter: Public account after short by the reward balance the first mix takes (taken) | tests/lovejoin-reward-balance.test.ts (readers#1) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:2452` | clearable: clearing a mix still in flight from Your mixes | tests/lovejoin-hub.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:862` | stoppable/retryable (:865): Stop offered only before a chain exists, Try again only where a retry or an unseen funding is | none found by grep (no test names lovejoin-mix-stop) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/LovejoinLaunch.tsx:153` | the launch form's checks before build: no quantity, box under the least or over the most, a copy of a shown v2 pool, an ADA pool at the classic 10 ₳ (worker re-checks, lovejoin-launch.ts:247-266) | tests/lovejoin-merged-review.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/LovejoinLaunch.tsx:446` | LaunchTotals: total leaving = locked.total + fee, after from Home's figure | tests/lovejoin-merged-screens.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/BringAllBack.tsx:107` | bringFollower: a read sent before or during a press speaking for after it (Done said for a stopped run, None said before the run) | tests/lovejoin-bring-screen-review-fixes.test.ts, tests/lovejoin-retire-review-fixes.test.ts, tests/screens-wiring-review-fixes.test.ts |

## Checked and holds

- The Mix form's private rows add up. 'Into a one-time account' is the boxes, the mix fees, the 1.5 ₳ room (funding.lovelace − boxes − mixFees is core's DEPOSIT_RESERVE exactly) and the collateral reserve. The total adds 5 ₳ and one fee. The cost rows add up to the cost, and soon + later + tailBack + cost = leaving. COLLATERAL_MIX_COST (0.25 + 0.95 + 0.3 ₳) is counted once: its box's way back is in the cost and out of tailBack.
- The private review's 'For the boxes' row is payments[0] less collateralReserve and bootstrapReserve, which is mix.lovelace. That holds for a funding in parts too: whole() keeps one combined first payment, and the first part's collateral stays second. FundingTotals = payments + fee, and after = homeBalance − total.
- The public reviews: Total leaving = boxes × box + every fee, with no boxes on a mix-again. The after line adds `taken`. A Bootstrap's after has no `taken`, which is right, since deposits don't run mix_logic.
- LaunchTotals' locked.total + fee matches WebAssembly's LockedOut (reference + both scripts + deposit), from either side. A public launch with no collateral set puts up one of its inputs.
- The UI constants match the worker and core: MAX_BOXES 10, MAX_CHAIN_MIXES 130, the Bootstrap caps 96/64, COLLATERAL 5 ₳ = SESSION_COLLATERAL, COLLATERAL_MIX_DRAWS 2 = TAIL_DRAWS, DEPOSIT_RESERVE and BOOTSTRAP_BACK_LEAST 1.5 ₳, MIX_FEE_ESTIMATE 0.95/1.35 ₳, BOX_BACK_ESTIMATE 0.3 ₳ = LOVEJOIN_WITHDRAW_ESTIMATE, MAX_QUANTITY 2^64−1, and CLASSIC_ID 'classic' = CLASSIC.
- formRoom's chain cap at four matches widthFor's MAX_CHAIN_MIXES rule. At three it never caps below ten, so capPool's words hold.
- Retired pool: Mix and Bootstrap are off with the reason, both Mix again buttons and Pay anyway are off, and Bring one back now and Bring every box back are on. sortOut holds nothing in a retired pool, so no NotMixed 'never come back' or held callout can show there.
- Copy, belowMinimum, stuck and readFailed pools: each button is on or off as the worker would answer. In a stuck pool Bring one back now is hidden, and the anyway and held questions ask who pays.
- anywayRequest, heldRequest and hatchRequest send the box their question describes (the same anywayBox and bootstrap.at(-1)). The handler passes `paid` only as 'private' or true.
- core's datum decode refuses token_quantity 0 and box_lovelace 0, so a pool-launcher can't make tokenBoxes divide by zero. An absurd box ADA only makes lovejoin-funding refuse (MORE_THAN_THERE_IS).
- No hook follows an early return in Lovejoin, PoolPage, MixList, BringAllBack or LovejoinLaunch.
- The launch form's copy and classic comparisons use parseAda and parseQuantity, which give BigInt-normalised strings, so string equality is sound.
- BringAllBack's follower drops stale reads around a press, and tells Stopped from Done by bringStopped.
- isMixingAgain in the UI and the worker's mixingAgain agree on what the view carries: the view leaves unsent and replaced transactions out.

## Notes

- Bootstrap's count field shows what was typed (200, or 0) while the button, the cost note and the review use `putting`, clamped to 1..most (Lovejoin.tsx:3445 against :3734). A nit with no money in it; the review is right.
- When `lovejoin-funding` fails, the PoolPage effect swallows it (Lovejoin.tsx:2812-2813). Review then stays off with no reason under it and no cost rows. Two ways to get there: a pool whose box value overflows core's funding sum, or a pool no longer in the read set. No money at stake, nit.
- Bootstrap from the public account gets no affordability or token check before Review; bootstrapLimits' `short` is private-only. The worker refuses at build, in words.
- Settled, with no new fact: in a floor-short pool, Mix my boxes again stays on and NotMixed still says it 'takes them first', while the worker refuses with 'Try again later' (chunk 34, fix round two, R3's 'Left open').
- Same family as e8a#1: the collateral's mix switch (collateralIntoPool, sessions.ts:4824) is read when the return is built, not when the mix was reviewed. The review said 'mixed once' (privateNoteMixed), and the reserve comes back if the user turns the switch off meanwhile.
- While the newest public chain's progress is kept (`sending` set), the hub hides every public chain row (Lovejoin.tsx:1935). An older stopped public chain then shows only as its card in Your mixes. Harmless, but it narrows e8a#2's reach to the case where that progress is null.
- screens.test.ts:1098 pins e8a#2's words. A fix has to update that test, and a verifier writing the regression test should expect it to fail today.

## Coverage

Read every line of ui/screens/Lovejoin.tsx (4,125), ui/screens/LovejoinLaunch.tsx (460), ui/components/LovejoinReturn.tsx (578) and ui/components/BringAllBack.tsx (471). Followed the values out: handlers.ts' Lovejoin dispatch; rpc.ts's Lovejoin and session types; ui/lovejoin-pools.ts, ui/swap.ts' estimates and ReviewTotals.tsx in full; lovejoin-launch.ts in full. In lovejoin.ts: funding, plan, fits, room, againBoxes, the mix bounds and constants, widthFor/wayOver/againWay, status, part of sortOut, withdrawDueNow, withdrawNowNow, bringAllBack and part of bringAllBackNow, stopBringingAllBack, progress, rows/shown, chain() and its countAt, hatchOrder, cantComeBack. In sessions.ts: mixOutBuild, againBuild, mixFunding, mixOutSubmit, buildFunding, tailReserve, orWithoutReserve, collateralIntoPool, buildBack's chain call and delay, mixingAgain, resume, fundingState and the view's stage, wayOf. Also script-spend.ts whole(); core lovejoin/mod.rs 1770-2000 (estimates, reserves, funding_for_in); wasm lovejoin.rs funding_at and lib.rs' funding and launch bindings; core pool.rs' datum decode. Checked the i18n en.json values for the keys these screens use, and the backlog and archive for known items. Skimmed: the rest of lovejoin.ts and sessions.ts. Not reached: the shared components (Callout, Modal, ReviewRows, SendButton, SessionRefused, TxDetail, HistoriesNote, GivemeNote), the Collateral screen, es and ja, background/lovejoin-pools.ts discovery, core's chain building, publicBuild and publicAgainBuild internals, whether accountLeast matches core's minimum_address_payment byte for byte (R3-14, known), and the e2e specs. I ran no tests.
