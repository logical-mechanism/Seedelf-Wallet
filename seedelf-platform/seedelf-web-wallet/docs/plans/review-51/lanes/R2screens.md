# Lane R2screens

Returned by the workflow's agent `ac0386c37ec784648`, written here by the lead from its structured answer.

## Findings (3)

### r2screens#1 · low · The connect window's private session now calls the unlocked side what's "in your private balance", with nothing about the lock

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:994`
- **Who:** user · **Since:** d9e015fb (e3b#2's fix, DappApprovals.tsx:623); the words since 4279db80 · **Confidence:** confirmed-by-run

**Scenario:**

The private balance holds 100 ₳ and the user has locked 60 ₳ of it, with a token, on the UTxOs screen. A site asks to connect and the user picks A private session. Since e3b#2's fix, the window reads "40 ₳ in your private balance. 5 ₳ more goes in, kept aside for contracts, and comes back." If they type 50 it says "That's more than the 40 ₳ in your private balance." Home shows 100 ₳, and nothing in the window mentions a lock. The cap is now right, but the line puts a figure 60 ₳ under the balance and calls it the balance. If everything is locked, the window says "0 ₳ in your private balance" and Review stays off for any amount. Before the fix, these lines said 100 ₳, which was true, though the cap was wrong. No money moves.

**Evidence:**

Lines are FIXTREE's.
- DappApprovals.tsx:623 `(b) => setSeedelf(unlocked(b.seedelf))`.
- :994 `tr("dappUi.heldAndCollateral", { ada: amounts.ada(seedelf.lovelace) })`.
- :998 `tr("sites.topUp.tooMuch", { held: amounts.ada(seedelf.lovelace) })`.
- en.json "dappUi.heldAndCollateral": "{{ada}} ₳ in your private balance. 5 ₳ more goes in, …"; "sites.topUp.tooMuch": "That's more than the {{held}} ₳ in your private balance."
- format.ts:454-462: unlocked() lowers lovelace and tokens and keeps `locked`. lockedAside (format.ts:468) is never called in DappApprovals.tsx.
- The verifier's fix note asked for it (verify/e3b-2.md:77): "Say what is locked beside the held line with `lockedAside(seedelf, amounts.ada)`, as the other forms do." G5's report lists only the cap.
- The fixer's own test pins the words (screens-wiring-review-fixes.test.ts:936).

Run: a copy of the fix tree under ~/.cache (removed after), with a Vitest case on screens-wiring-review-fixes.test.ts's seam. ConnectRequest got balances {lovelace 100 ₳, locked {60 ₳, a token, 1 UTxO}}, a private session chosen and 50 typed. Output:
`R2SCREENS1 HELD: 40 ₳ in your private balance. 5 ₳ more goes in, kept aside for contracts, and comes back.`
`R2SCREENS1 TOOMUCH: That's more than the 40 ₳ in your private balance.`
`R2SCREENS1 MENTIONS LOCKED: false`

Siblings with the same words over Home's unlocked side, from before this round: SiteSessions.tsx:672 (sites.topUp.aside) and :689 (sites.topUp.tooMuch); swaps.short ("Your private balance has {{held}} ₳"), swaps.tooMuch, and the swaps.inPrivate and lovejoin.mix.inPrivate titles. Send, Make private, private Send and Make public instead say "{{amount}} ₳ available" plus lockedAside.

**Fix:**

Say what's locked beside the held line, as the verifier's note asked and as Send and Make private do. For example "{{ada}} ₳ available" (withdraw.asideAvailable) plus lockedAside(seedelf, amounts.ada), or a held-line string with a locked slot. The tooMuch note needs the same. The class is every form that labels Home's unlocked side as "in your private balance": TopUp (sites.topUp.aside, tooMuch), the swap form (swaps.short, swaps.tooMuch, swaps.inPrivate) and the Lovejoin form (lovejoin.mix.inPrivate). The new strings go in en with es and ja drafts.

**Known check:**

Searched docs/backlog.md and docs/archive/plans/ for heldAndCollateral, topUp.aside, lockedAside, and 'in your private balance' with lock or locked. Nothing settles it. In review-51, only e3b#2's own record turned up: verify/e3b-2.md:77's fix note, which this round left undone.

### r2screens#2 · nit · Review swap's re-ask still overwrites a quote for the token picked meanwhile; after Back the form is stuck on "Getting a quote…"

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx:836`
- **Who:** user · **Since:** c8003eda (the guard). The overwrite itself dates from d423b79a, when the re-ask at Review replaced the form's quote unconditionally. · **Confidence:** confirmed-by-run

**Scenario:**

The user sets 100 ₳ → MIN and the quote lands. More than a minute later they press Review swap, so buildOut asks Minswap again first. While that re-ask is out, they switch You receive to SNEK, and SNEK's own quote lands on the form first. Then the re-ask answers. e7a#1's fix added a guard so a fresh quote doesn't replace the form's quote once a pick has changed: `if (ask && sameAsk(quote.ask, ask)) setQuoted(...)`. But `ask` is the one captured when Review was pressed, so on a first review the test always passes, and MIN's quote replaces SNEK's. The MIN build lands and the approval is right (e7a#1 holds). When they press Back, the form shows 100 ₳ → SNEK with "Getting a quote…" and Review off. Nothing asks Minswap again: the quote effect waits for a change of ask, and Ask again shows only for the same pair. It stays that way until they edit the amount, the slippage or a token.

**Evidence:**

Lines are FIXTREE's.
- Swaps.tsx:829: `const from = keepWay && out ? out : current && quoted && get ? { quote: current, at: quoted.at, pay, get } : undefined;`
- :832-837: past QUOTE_FRESH_MS (60 s) it re-asks, then `if (ask && sameAsk(quote.ask, ask)) setQuoted({ quote, at });`
- `ask` is the closure of the render Review was pressed in. On a first review `current` exists only when sameAsk(quoted.quote.ask, ask) (:768), so the test can't fail there. Only the approval's rebuilds, drawn after a pick change, see a different ask.
- :740-766: the quote effect runs only on [ask, again].
- :979: the call to action is "Getting a quote…" while !current.
- :1157: the details, and Ask again, show only while `shown` is the same pair.

Run: a copy under ~/.cache (removed after), with a case added to swap-form-review.test.ts's hook runner. 100 ₳ → MIN quoted, 61 s on, Review swap with its re-ask held, You receive → SNEK and SNEK's quote lands, then the re-ask answers and the build lands. Output:
`R2SCREENS2 APPROVAL: {"pay":"100 ₳","receive":"≈ 906.5941 MIN","least":"897.61792 MIN"}`
Then Back, 5 s on:
`R2SCREENS2 FORM FOOT: {"label":"Getting a quote…","disabled":true}`
`R2SCREENS2 QUOTES ASKED AFTER BACK: 0`
`R2SCREENS2 RECEIVE BUTTON: SNEK`

**Fix:**

Decide against the state as it is now, not the render's ask: `setQuoted((was) => (!was || sameAsk(was.quote.ask, quote.ask) ? { quote, at } : was))`, or compare with a ref that holds the live ask. That covers the first review and the rebuilds alike. A test on swap-form-review's runner: the sequence above, then Back shows SNEK's quote and Review on.

**Known check:**

Searched docs/backlog.md, docs/archive/plans/ and review-51 (INDEX, lanes, verify) for 'Getting a quote', setQuoted, 'stale quote' and 'asked again at Review'. The only related item is t1k#9's test, for a re-ask the balance can't pay with no pick change. Not reported.

### r2screens#3 · nit · Bring everything back's button reads "Sending…" while its switch rebuilds the returns

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/ClaimAll.tsx:199`
- **Who:** user · **Since:** 40f7c3f4 (the switch's rebuild), with 8b9c3cd7's label · **Confidence:** traced

**Scenario:**

The user has three returns built and turns the Lovejoin switch off. rebuild sets busy while every return is built again, which takes several seconds. In that state, the one e8b#3's fix now keeps the rows off for, the foot button reads "Sending…" though nothing is sent, and it's off. Swaps' approval says "Building…" in the same case (SendButton's `rebuilding`, from 1.6.0's 320-screens#3). Words only, and it predates this round. It sits in the state this round's fix touched.

**Evidence:**

Lines are FIXTREE's.
- ClaimAll.tsx:104-120: rebuild() sets busy around session-claim-build.
- :199: `{busy ? t("common.sending") : picked.length ? t("claim.sendReturns", …) : t("claim.chooseSession")}`.
- :305 and :324: the switch, and since e8b#3 the rows, take `disabled={busy}`.
- SendButton.tsx:31: `{!busy ? label : rebuilding ? t("common.building") : (sending ?? t("common.sending"))}`. Swaps passes `rebuilding` (Swaps.tsx:945), ClaimAll has no such state.

**Fix:**

Keep a `rebuilding` flag as NewSwap does (set in rebuild, not in send) and say common.building then. Or use SendButton with `rebuilding`.

**Known check:**

Searched docs/backlog.md and docs/archive/plans/ for claim with Sending, rebuilding, and 320-screens#3. Also E8b's lane, verify/e8b-3.md and T1k/T1l. Not reported.

## Guards (9)

| Where | What it stops | Test |
|---|---|---|
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx:911` | Start swap sending a funding other than the one the approval names. It submits out.summary.txHash, and the approval (:950-955) draws pay, get and quote from `out`, never from the form's live picks (e7a#1). | tests/swap-form-review.test.ts 'a pick changed while the swap's review builds (chunk 51, e7a#1)' (4 cases) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx:829` | The approval's switch, Change or Build again building the form's newer pair under the same approval: keepWay builds from `out` (its quote, its picks and its own time). | tests/swap-form-review.test.ts 'the approval's switch, a minute on, builds the swap the approval shows again, never the form's SNEK' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx:837` | Building a funding the private balance can't pay once Review's re-ask raised the costs | tests/swap-form-review.test.ts 'builds nothing on a quote asked again at Review that the balance can't pay, and says so' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:413` | The Mix and Bootstrap forms counting a public UTxO the chain's pick refuses (any reference script, a datum past MAX_DEPTH), using the flag from coin-control.ts:361 (gap-g2#3) | tests/lovejoin-public-pick-refused.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:731` | A private session's refused funding being sent again by Enter in the password box while its refusal shows (t1i#13) | tests/screens-wiring-review-fixes.test.ts 'a private session's funding, refused, never sent again from its review (chunk 51, t1i#13)' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:703` | A connect's private-session funding passing the form for more than the unlocked private side the build can spend (e3b#2, with :623's unlocked()) | tests/screens-wiring-review-fixes.test.ts 'the connect window's private session, held to what its funding can spend (chunk 51, e3b#2)' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/ClaimAll.tsx:113` | A session the user left out being brought back by Bring everything back after its rebuild: its fee paid, and its one-time account emptied under a connected site. The functional setChosen and the rows' `disabled={busy}` (:324) do this (e8b#3). | tests/claim-all-review.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/coin-control.ts:219` | A stranger's 5 ₳ with a reference script or a datum becoming the account's automatic collateral, after which every public Lovejoin mix fails (collateralFits, e8b#1). The Collateral page's candidate (:419) follows the same rule. | tests/coin-control.test.ts (G6's cases) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/CardanoSend.tsx:168` | Send's Total leaving counting a payment to the account on screen as leaving. A stake-elsewhere payment stays the account's money and still counts as not leaving, as before. | tests/stake-elsewhere-screens.test.ts (the Send review) |

## Checked and holds

- e7a#1: the approval takes summary, quote, lovejoin, pay and get from `out`. Start swap submits out.summary.txHash. The switch, Change and Build again rebuild from `out`, using its own quote time out.at. Back returns to the live form. `if (out)` can't render without picks, since `from` always has get.
- gap-g2#3: coin-control flags `unmixable` with lovejoin.ts evaluable, the same rule as core's eval::refusal (any reference script; an inline datum past MAX_DEPTH). publicPick leaves those UTxOs out, and through it publicMixAda, publicBoxesAffordable's `enough`, mixMost and publicSideOf, for both the Mix and the Bootstrap forms.
- gap-g2#3 and e8b#1 agree: collateralFits refuses the same shapes, so a stranger's 5 ₳ with a script is neither the automatic collateral nor counted by the forms.
- The new coin-control ↔ lovejoin import cycle is harmless: no top-level code reads either side's bindings (COLLATERAL_LOVELACE is read only inside adaPoolOf, evaluable only inside listed()).
- e8b#3: ClaimAll's rows are off while busy (rebuild and send). The rebuild keeps the choice as it stands when the build lands. Back, Send and the switch already waited.
- e8b#5: MoveIn, CardanoSend and CreateSeedelf clear their error on a form change. Every dependency is useState state (useRecipients' drafts, max, note, amount, tokenAmounts, label, from), so the effect fires only on a real change, never right after an error is set. Back clears the error on MoveIn, Collateral and CardanoSend.
- e3b#4: an error is tied to the request it answers (`asked`) and shows on that request or once the list is empty. The close timer still waits on any error. load()'s errors carry no request and always show. connectError is memoized per currentId and ConnectRequest is keyed by current.id, so an old request's late onError stays tied to it. A wrong password, whose request stays, shows on that request.
- e3b#2: the form and its token picker use unlocked(b.seedelf). The review's before is homeBalance(seedelf), which is the unlocked lovelace plus locked plus incoming, Home's figure. unlocked() keeps `locked`, so nothing is subtracted twice.
- t1i#13: the refusal guard (DappApprovals.tsx:731) stands and is now pinned by a test. Build again (buildReview) still runs after a refusal.
- x1a#1 and e9a#3, the stake-elsewhere notes:
- destination.ts keeps `own` by payment key and sets stakeElsewhere only when no known account's stake key is the address's. Send (send.ts `{...shown, ...p}`) and Make public (withdraw.ts `{...destinations[i], ...p}`) carry it into their summaries, and the form and review show StakeElsewhereNote under OwnNote, OtherAccountNote or OwnWarning.
- Transaction details tags an account output whose base stake key is none of the accounts'. It reads other accounts' stake keys only when one might be it.
- UTxO details' warning replaces 'the one Receive shows' when a row lacks the active account's stake key.
- The wallet's own outputs don't trip these notes: change goes to the base receive address, and collateral returns go to giveme.my's address or the collateral's own.
- The critical-set rule's five renamed keys (pools.tag.warn.keepsAll, pools.tag.warn.oversaturated, tokens.warn.callsItself, tokens.mark.warn.posesAs, tokens.warn.theListed): nothing under src, tests, e2e, scripts or docs still uses the old names.
- en, es, ja, critical-keys.json, both provenance files and both verified-critical files carry the five new names and none of the old ones. Every key in critical-keys.json is in both verified lists. No worker path persists or compares these keys.
- New strings: every new warning or privacy line sits under .warn. or .privacy. (deadRegister, hiddenChars, note.privacy.otherMetadata, send.warn.stakeElsewhere(Nth), tx.yours.warn.stakeElsewhere, tx.out.warn.anyoneCanSpend, utxos.addressWhose.warn.stakeElsewhere, and the four Lovejoin ties lines). The rest are status or row text. They say 'Seedelf Wallet's contract' as the house does, and es and ja exist for each, with es _many for depositTokens.
- deadRegister and anyoneCanSpend match the deployed wallet.ak at 5b82530: no datum or a non-Register datum can be spent by anyone; a Register whose fields aren't valid points by no one; an identity public value by anyone.
- The swap waiting lines (swaps.now.waiting, swaps.sub.waiting) are bounded by UNLOCK_WAIT_MS's 20-minute cap.
- e8a#3: anywayAccountsOf names every account with boxes the funding may take. The chain picks its boxes later, against the pool as it is then, so naming every candidate account is the conservative reading. The useAccounts hooks it adds sit before Chains' early return.
- e4b#1: the connector window no longer resets the lock timer when it opens. A site's request waits through a lock, App shows Unlock, and DappApprovals remounts and reloads on unlock, so Sign still works.
- In a copy of the fix tree (removed after), the fixes' screen tests pass: 10 files, 93 tests (stake-elsewhere-screens, claim-all-review, review-back-clean, dapp-window-answer-error, lovejoin-public-pick-refused, swap-form-review, i18n-warn-classes, screens-wiring-review-fixes, lovejoin-anyway-accounts, collateral-review).
- In the same copy, the wider screen suites pass: 17 files, 478 tests (dapp-prompt, i18n-screens, every Lovejoin screens suite, screens, swap-page-words, tx-view and tx-view-screen, i18n-critical-helpers, i18n-values-in-place). i18n.test.ts and words.test.ts pass too.
- My runs wrote nothing into FIXTREE: node_modules was linked package by package, so Vite's temp and cache stayed in the copy.

## Notes

- gap-g2#3's fix corrects the ADA figure and the stepper's token `enough`, but not the token part of the label. HeldOnSide still shows Home's tokens (publicSideOf passes cardano.tokens) under 'What Lovejoin can spend from your public account'. So a stranger's pool token sitting in an unmixable UTxO shows as spendable. The stepper itself is right.
- The stake-elsewhere words say 'a stake part that isn't yours' for an enterprise address too, which has no stake part. That's the existing house wording (dappUi.paid.ownPaymentKey).
- plainName now strips U+FE0F, so mainnet's listed DRep 'hix_coffeepool☕️' shows as 'hix_coffeepool☕', drawn as text in some fonts.
- A future list entry made only of invisible characters would become an empty name. Delegations falls back to the ID (`|| undefined`), but Activity's voteOf (activity.ts:129, voteLabel's `??`) and the Voting list would show it empty. Before this round it was invisible anyway, so this isn't a regression.
- For the owner, another case of G5's 'hidden error' note: the connect window's dapp.fundedButConnected reply ('funded as session N, but connected meanwhile', money waiting on the dApps page) is tied to its request. It's hidden while another request is on screen, and cleared when that one is answered. Reaching it needs the site connected in the same worker while its funding submits, with a second request queued, so it's close to unreachable.
- A rebuild from the swap approval (switch or Change, a minute on) whose re-ask the balance can't pay closes the approval. If a pick changed while the first review built, the form then shows the other pair with no word on why the approval closed. Nit.
- e7a#1's class, in reviews the fix didn't touch: the Send, private Send, Make public and Make private reviews write 'raised from X ₳' (amountText) from the form's live amount. Those inputs stay editable while the review builds, so an edit during the build can put another amount beside the built one. Words only, and only when a minimum raise applies.
- e8a#3's names come from the page's pool read. If another public account's chain finishes in the background after that read, the review can say 'your public account' where the later chain may also draw that account's boxes. Narrow.
- The PublicAgainReview's new 'some of' note reuses lovejoin.review.asManyAsOneGo ('The pool has room for N…'). The count is also capped by one chain's MAX_CHAIN_MIXES, so the stated reason can be the chain's length rather than the pool's room. The private review's existing use has the same wording.

## Coverage

Read in full, the diffs main..HEAD:
- every file under extension/src/ui (34 files);
- the screen-facing worker files: coin-control.ts, destination.ts, tx-view.ts, balances.ts (atContract, ownedUtxos, the seedelf card's tokens), handlers.ts (dapp-approvals);
- shared/rpc.ts, scripts/i18n-critical.mjs, en.json, critical-keys.json, and the es and ja values of every new key.

Read in context in FIXTREE:
- Swaps.tsx: NewSwap, SwapApproval, nowLine and subOf (669-1470, 283-310, 3300-3345);
- ClaimAll.tsx, all of it;
- DappApprovals.tsx: DappApprovals and ConnectRequest (76-1000), and SignTx and SignData's changed parts;
- CardanoSend's form and review; MoveIn; CreateSeedelf's state and handlers; Collateral's handlers;
- Lovejoin.tsx: publicPick, publicMixAda, publicBoxesAffordable, publicSideOf, HeldOnSide, mixMost, PoolPage's review build and render, anywayAccountsOf, privateTies, stoppedKey, PublicAgainReview;
- dapp.ts: answer and fundPrivate; sessions.ts: waits and the runner's go; lovejoin.ts: againBoxes, publicAgainBuild's count, evaluable;
- core's eval::refusal; the deployed wallet.ak at 5b82530; Recipients.tsx useRecipients; format.ts unlocked, lockedAside and shortCounterparty; ReviewTotals' homeBalance and RewardsRow.

Records read: COMMON.md, FIX.md, fix-branches.md, RESUME.md, the G1-G6 reports, INDEX.md for my lens's ids, the original findings (data/*.json), verify/e3b-2.md.

Ran, in a copy under ~/.cache (removed after): 27 existing test files and two cases of my own, which confirm r2screens#1 and #2.

Not reached:
- the Rust and WebAssembly diffs, the worker's Lovejoin and sessions diffs beyond the lines named, the CLI, e2e;
- the CSS changes' effect at the panel's width (the token-amount row, activity__who), not checked in a browser;
- the es and ja translations, not back-translated;
- G7's own report, which isn't in fixes/, so the screens fixes were read from their commits (8fd738ff, c8003eda) and the tests they added.
