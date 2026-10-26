# The review of the fixes: confirmed findings (round 3)

Ten lenses reviewed both fix rounds (`git diff 499768f6`), a merge clustered their findings, and skeptics tried to refute each one (two for those rated high or medium). 31 confirmed, none contested, none refuted. Each lens's own report is in this folder (`<lens>.md`). `grep -n '^## R3-<n>'` finds one.

## R3-1

**low** (found as medium) · lenses: tests-mutation · `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:764`

**The site funding review's and the top-up's collateral-mix wiring has no test: both can be reverted with every test green**

**Scenario.** Drop the prop `collateral={!!review.collateralReserve}` (DappApprovals.tsx:764) or `mixed={!!review.collateralReserve}` (SiteSessions.tsx:633), or rename `collateralReserve` in a refactor, and every test stays green. A site funding that pays the collateral-mix reserve then reviews with no 'Its collateral's mix, about' row, with 'Network fees both ways' about 1.5 ₳ short, and with the critical privacy note back to dappUi.back.privacy.noteLovejoin ('…the 5 ₳ come back at once'), which is false when the collateral is mixed. The top-up then says its new 5 ₳ 'comes back with the next return'.

**Evidence.** Mutations run in a copy. o1a, `collateral={false && !!review.collateralReserve}`: approvals-review-fixes, every dapp*, review-totals* and screens, 23 files, 271 tests pass. o1c, `<TopUpCollateralNote mixed={false && …} />`: approvals-review-fixes, every site*, session*, dapp* and screens, 39 files, 424 tests pass. The named tests miss it because they hand the flag in: they render FundingWayBack with `collateral: true` and TopUpCollateralNote with `mixed: true`, which stubs away the decision the fix makes. Those tests are 'a site's funding review counts the collateral's mix in the way back', 'a site's funding review never says the 5 ₳ comes back at once' and 'a site's top-up never says its new 5 ₳ comes back with the next return'. Nothing else covers it: sc-o-1's report says e2e site fundings carry no reserve. The swap approval's half is wired and tested: o1b (`collateralMixed && false` in Swaps.tsx:1286) fails 'says so on the approval…'. It's medium by the brief's rule, since the untested wiring carries a money total and a .privacy. note. Only this lens rated it.

**Concerns.** sc-o-1: 323-worker#1 (the site half), and 323-worker#6 / gap-3#2 (the site's and the top-up's notes). Related: R3-9 proposes keying these same two notes (FundingWayBack, TopUpCollateralNote) on whether a 5 ₳ pool takes the collateral, rather than on the reserve. The new tests should pin whichever key is chosen. R3-20 is the same class (a screen wiring reverted with every test green) for eight other fixes, rated low.

**Suggested fix.** Export the funding review's body, or a `FundingReview({ review })`, and the top-up's review. Render each with a SessionOutSummary carrying collateralReserve, and assert the mix row, the both-ways total and the *Mixed note. Render one without it, and assert the old words. Tests only; no behaviour change.

**Skeptic 1 (held, low).** The gap is real and reproducible, but it is a missing test, not a current defect, so medium is too high. With the funding review's wiring dropped and the top-up's set to false (typecheck clean), all 2762 existing vitest tests stay green, and e2e's site funding carries no reserve. On the current tree the real screens render the mix row, the 2.23 ₳ both-ways total and both mixed notes correctly. The brief's scale puts 'a missing test' at low. Medium needs a misleading warning or a failing flow now, and this is a hazard for a future edit. The same lens rated this exact class (screen wiring reverted with every test green) low in R3-20, including Lovejoin.tsx:2558, which also moves a figure by 1.5 ₳. The scenario is also partly overstated. Dropping `mixed` outright fails CI's typecheck (TS2741, since `mixed` is required), and a partial rename of `collateralReserve` is caught by the typecheck. Only dropping FundingWayBack's optional `collateral`, or a wrong expression at either call site (e.g. `mixed={false}`), slips through.

*Its fix:* Tests plus a type-level change, with no behaviour change:
1. Move the decision into the two components. FundingWayBack and TopUpCollateralNote each take a required `reserve: string | undefined` (no `?`) and work out `collateral` / `mixed` as `!!reserve` themselves. The call sites become `reserve={review.collateralReserve}`. Dropping the prop then fails CI's typecheck, as dropping `mixed` already does, and the existing approvals-review-fixes tests render the components with a summary's reserve (`'1500000'` vs `undefined`), which pins the rule. If R3-9 changes the key (a 5 ₳ pool taking the collateral), these tests should pin that key instead.
2. Update the callers that omit the prop today: dapp-prompt.test.ts:152 and approvals-review-fixes.test.ts:134-165.
3. For a check that covers the whole screen, add one e2e site funding with a 5 ₳ pool shown in the fakes. It would assert the mix row, 'Network fees both ways, about 2.2x ₳' and the noteLovejoinMixed words, plus a top-up that puts a new 5 ₳ back. The finding's 'export FundingReview({ review })' would mean pulling the review out of ConnectRequest and TopUp, a larger refactor of a money screen just before release, so it isn't 'tests only'.

**Skeptic 2 (held, low).** The core claim holds. The site funding review's `collateral={!!review.collateralReserve}` (DappApprovals.tsx:764) can be dropped and CI's typecheck and every Vitest test stay green. The same goes for an explicitly wrong value on either that prop or the top-up's `mixed` (SiteSessions.tsx:633). Two of the three routes the scenario names don't hold, though. Dropping the top-up's `mixed` prop fails CI's typecheck, because the prop is required. Renaming `collateralReserve` also fails it, with 38 errors, both screens among them.

On impact, the right rating is low, not medium:
- **The code is correct today.** No user sees wrong words or figures; the gap only weakens protection against a future regression.
- **The brief's scale puts this at low.** It rates "a missing test for a guard" low. Medium needs a flow that fails, a fix that doesn't fix its finding, or a misleading warning; none of those is true now. The brief has no rule that makes untested wiring medium because it carries a money total or a .privacy. note.
- **Even the regression it guards against would be small:**
  - It can't show on mainnet at release. Mainnet's bundled pool list is empty, so it has no 5 ₳ pool until someone starts one, and then the pool needs 30 other people's boxes. Today only preprod's test ADA can reach it.
  - The signed figures would stay right. The reserve row and "Total leaving your private balance" don't read either prop. Only the "about" mix row, the "both ways, about" estimate (1.5 ₳ low) and the note would change.
  - The note's error goes toward less privacy than the user actually gets.
- **The original review rated these same words low** (323-worker#6, gap-3#2). 323-worker#1's medium rests on the swap approval's consent-screen totals, and that half is wired and tested (o1b).
- **The same lens rated this exact class low** in R3-20, including a revert with worse impact: Lovejoin.tsx:2558, where the funding becomes quietly less private.

The suggested fix breaks no owner rule: it adds no refusal, no UI text and no behaviour change. It is a refactor in two screens at the release gate, though, and a smaller change closes the realistic regressions.

*Its fix:* Tests and typing only. No refusal, no UI text, and no change to what the wallet does.

**The minimal fix:**
- FundingWayBack and TopUpCollateralNote take the summary's reserve as a required prop, `reserve: string | undefined`, and decide `!!reserve` inside. That is CollateralReserveRow's and CollateralMixNote's pattern, except that it's required.
- The call sites become `reserve={review.collateralReserve}`.
- approvals-review-fixes' three tests pass `reserve: "2800000"` and `reserve: undefined`, and assert:
  - the mix row;
  - "Network fees both ways, about 2.23 ₳";
  - noteLovejoinMixed and sites.topUp.collateralMixed, against the old words.

A dropped prop or a renamed field is then a CI typecheck error, and the decision sits under tests that already exist.

**If the lead also wants #323's untested reserve row and the `forSite`/`paid` subtractions covered:** take the finding's route. Export the two review bodies, keeping the test ids and markup identical, since the e2e reads `dapp-funding-rows` and `dapp-funding-back`. Render each with a SessionOutSummary that carries `collateralReserve`, and one without.

**R3-9:** if R3-9 re-keys these notes on "a 5 ₳ pool takes the collateral", carry that field instead and fold this fix into it.

## R3-2

**low** (found as low) · lenses: privacy-words, cross-area · `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:6667`

**Bring one back anyway of a half-mixed public box: the private payer's note says it avoids another account's money, then the worker pays with it**

**Scenario.** The wallet has two or more public accounts and a stuck token pool: the fees rose, so its boxes can't pay their own way back. Account 0's public mix into it, two waves deep (the default), stopped after its first wave when a lock cut it. So the first wave's box is in notMixed (unmixedOf) and in fromPublic (originOf gives the chain's owner). On Bring one back anyway, the question warns 'Its mix from your public account stopped before mixing it. Brought back now, anyone can tie your public account to your private balance.' PayerNotes, given box = the active account through fromPublic (Lovejoin.tsx:1021), adds lovejoin.stuck.privacy.privateAccounts: 'It avoids one made private from another public account where it can: that would tie the two accounts.' The user keeps Pay from my private balance. withdrawOne ranks the payers by depositAccountOf, which names an account only for a deposit's box (c.deposit === b.txHash). So `deposited` is undefined, `another` ranks every UTxO 0, and the smallest pays: a UTxO made private from account 1. The withdraw spends account 0's box beside account 1's money, which is the tie the line had just said it avoids. The UTxO it comes back into carries box:…+public:1, and its history names account 1 alone (`ties` is empty). HeldQuestion is unaffected: its held public boxes are always deposit boxes.

**Evidence.** Two throwaway tests, both deleted, both failing on the tree.
- privacy-words' test 1: recordChain for account 0 [deposit b1, mix c1, mix c2], 2 of 3 sent, ended cut. status's notMixed and fromPublic contain c1#0. withdrawNow(c1#0, anyway, 'private') with d1 (50 ₳, madePrivate(0)) and d2 (3 ₳, madePrivate(1)): expected [c1#0, d1#0], received [c1#0, d2#0].
- cross-area's zz-review-cross-area-3, on wlj-1's x-privacy#0 setup with a recorded public chain deposit→mix→mix stopped after the first mix. status lists a1#0 in fromPublic and notMixed, with the pool stuck. The withdraw spent a1…#0 and d2…#0 (account 1's 3 ₳, not account 0's 50 ₳), origin box:…+public:1: 'AssertionError: paid with account 1's money beside account 0's box: expected [ …(2) ] to deeply equal [ …(2) ]'. With cross-area's candidate fix in a copy it passes, and lovejoin-crediting-review-fixes.test.ts's 10 tests still pass.
Code: lovejoin.ts:6667-6668 (`another` only when depositAccountOf is defined); :1977 depositAccountOf; :1728 unmixedOf; Lovejoin.tsx:1021 (account = other ?? (fromPublic ? active)) and :980-983 (privateAccounts shown whenever there are several accounts and a box). Both lenses rate it low. privacy-words' open question 3 bears on it: otherAccounts and C01 treat a public mix's box as that account's, while PRIV-3's ties and the new payer order treat only a box at a deposit as tied. Which model the owner wants decides this fix and R3-3's.

**Concerns.** Two fixes disagree. wlj-1 (x-privacy#0, the worker half) keys the payer order on depositAccountOf, the deposit alone. sc-lj-2 (x-privacy#0, the page half) shows PayerNotes' privateAccounts for any fromPublic box, the chain's owner. R3-3 is the escape hatch's variant of the same root.

**Suggested fix.** In withdrawOne, rank the private payers by the account the page names: deposited = depositAccountOf(s, box) ?? accountOf(originOf(box, s)). The two lenses differ on the details. privacy-words narrows the fallback to a box not mixed yet (unmixedOf(s.chains, [box]).length ? … : undefined). cross-area applies it unconditionally, which would also rank R3-3's fully mixed box. On `ties`, privacy-words would arguably record that account there too, since the anyway warning already says the box ties it; cross-area keeps ties as they are. Alternative: have status mark which public boxes a deposit made, and show privateAccounts only for those. No refusal either way.

**Skeptic 1 (held, low).** The finding holds, and I reproduced it on the current tree. The setup: a stuck token pool, and active account 0's public mix [deposit b1, mix c1, mix c2] cut after c1. The box c1#0 is in the status's notMixed and fromPublic lists. On a wallet with two accounts, AnywayQuestion shows the line "It avoids one made private from another public account where it can: that would tie the two accounts." It shows it right after "Its mix from your public account stopped before mixing it. Brought back now, anyone can tie your public account to your private balance." Then withdrawNow(c1#0, anyway, 'private') pays with d2 (3 ₳, made private from account 1) and not d1 (50 ₳, from account 0), and d1 pays. The control case passes: the same setup cut at the deposit picks d1, with origin box+public:0. So x-privacy#0's own case is fixed.

The cause is two fixes that disagree:
- wlj-1 ranks the payers by depositAccountOf, which covers a deposit's box only. That matches PRIV-3 and privacy.md:210.
- sc-lj-2 shows the line for any fromPublic box, using originOf (the chain's owner). AnywayQuestion's box is always a notMixed box.

I keep it at low, not medium:
- It's a narrow edge case. It needs several public accounts and a stuck token pool. The active account's public mix into that pool must be cut between its first and last mix. The user must pick Bring one back anyway with the private payer. No box-back UTxO may pay, and the smallest UTxO that pays must be another account's while one of the box's own account pays.
- The box has had one wave (1 of 3 or 4), so the tie between the two accounts is probabilistic.
- The question does say that the paying UTxO "and where it came from" is tied to the box. What misleads is only the promise to avoid another account's money.
- x-privacy#0's own scenario (a deposit's box) is fixed, so this isn't "a fix that doesn't fix its finding".

*Its fix:* In withdrawOne's private-payer branch (lovejoin.ts:6667), rank the payers by the account the question names, for a box the wallet calls not mixed yet:

```ts
const schedule = await this.read(network);
const deposited =
  depositAccountOf(schedule, box) ?? (unmixedOf(schedule.chains, [box]).length ? accountOf(originOf(box, schedule)) : undefined);
```

What this keeps:
- A fully mixed box (a leaf, or one someone else's mix moved since) stays a box back from Lovejoin, as PRIV-3 and privacy.md:210 have it, so R3-3's hatch case isn't swept in silently.
- A session's chain gives no account (originOf gives "session.N", so accountOf is undefined).
- There's no refusal: where only another account's UTxO pays, it's used as before.
- No record format changes. The classic pool's own withdraws are untouched.

Add the mid-chain case as a test in lovejoin-crediting-review-fixes.test.ts's x-privacy#0 describe: chain [deposit, mix, mix] sent 2 of 3 and cut, expecting [c1#0, d1#0]. It fails on the current tree and passes with the fix. Also update the comment above the order, which says "whose deposit made the box".

Leave `ties` (the history) as it is unless the owner decides the "not mixed yet = the account's" model applies there too (privacy-words' open question 3). With the fix, account 0's money normally pays, so the origin names account 0 through the payer's class anyway.

The alternative, page-only, is to show privateAccounts only for a box a deposit put in. It's weaker under private-by-default: the wallet would still make the cross-account tie where it needn't.

## R3-3

**low** (found as low) · lenses: privacy-words · `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:1062`

**The escape hatch can take another account's mixed box and pay with this account's money, naming neither**

**Scenario.** Two public accounts each made a public mix into a token pool, and the fees rise so its boxes can't pay their own way back. On account 0, the escape hatch (hatchRequest, PaidQuestion) names no box. The worker picks by backOrder among the wallet's mixed boxes, and can pick account 1's box. status lists that box in otherAccounts, which rpc.ts documents as 'Paid from this one, they'd tie the two accounts together'. The private payer doesn't rank account 0's money last, because depositAccountOf is undefined for a mixed box; the public payer is account 0 itself. PaidQuestion renders <PayerNotes /> with no box, so nothing is named, and the history it keeps names account 0 only.

**Evidence.** Code: Lovejoin.tsx:945 and 1053-1064 (PaidQuestion renders <PayerNotes /> with no box); lovejoin.ts:6196-6198 (backOrder over the wallet's mixed boxes) and 6667-6668; rpc.ts:2210-2214. Throwaway test 4 (deleted): recordChain for account 1 [deposit b1, mix c1], its box c1#0, done. status.otherAccounts contains c1#0:1. withdrawNow(undefined, false, 'private', TOKEN) with d1 (50 ₳, madePrivate(1)) and d2 (3 ₳, madePrivate(0)) spent [c1#0, d2#0]. It shares R3-2's root: the worker ranks on depositAccountOf, the status on the chain's owner. privacy-words' open question 3 (which model the owner wants) decides both.

**Concerns.** sc-lj-2 and wlj-1 (x-privacy#0): the fix covers Bring one back and Bring one back anyway, not the escape hatch. The flow is pre-existing, the same class as the finding.

**Suggested fix.** An order, not a refusal. The escape hatch takes the active account's own boxes, or private ones, first. Where it takes another account's box, the worker ranks that account's money first, and PaidQuestion names the account as PayerNotes does. If R3-2's unconditional originOf fallback is taken, the ranking half comes with it.

**Skeptic 1 (held, low).** Reproduced on the current tree. When no box is named, the escape hatch chooses one without looking at accounts (lovejoin.ts:6166/6198, backOrder). It took account 1's public-mix leaf, which is older, even though account 0's own newer leaf was there. The private payer then paid with account 0's money (3 ₳) instead of account 1's (50 ₳): depositAccountOf is undefined for a box a mix made, so `another` scores every UTxO 0 (6667-6668). The public payer is account 0 (6654). PaidQuestion renders `<PayerNotes />` with no box (Lovejoin.tsx:1062), so it names no account. The history it keeps names account 0 only.

The same worker's status puts that box in otherAccounts. rpc.ts:2212 and the worker's header (lovejoin.ts:68-73) both say that another account paying for such a box ties the two accounts, and C01 avoids exactly that tie for Mix again. So the hatch breaks the code's own rule. The wallet, not the user, picks the box, so this is a link the wallet makes for the user.

Why low and not high:
- The tie is probabilistic: the box is one of a public mix's leaves, and those leaves are public anyway.
- It needs several accounts with public mixes in the same token pool, that pool stuck, and the hatch pressed on the other account.
- It's pre-existing. PaidQuestion is byte-identical to 499768f6, and the box pick is unchanged. wlj-1 and sc-lj-2 scoped x-privacy#0 to held and not-mixed boxes.
- The page's OtherAccounts line does name account 2 as the source of some boxes, though only to mix them again.
- x-privacy#0's own case, a definite deposit-box tie, was rated low.

The question's words aren't false: without a box, the "avoids another account" line isn't shown. Under the documented way-back model (PRIV-3; privacy.md:210/:229, where only a deposit box or one that didn't finish mixing is the account's), a finished leaf ties no account, and nothing here is wrong. The owner's answer to privacy-words' open question 3 decides between a low defect and a consistency nit in rpc.ts and the worker header.

*Its fix:* An order, never a refusal (the owner's rules), in three parts:
1. **The hatch's pick.** In withdrawNowNow's no-box branch, only when `paid` is set, put another account's public boxes (`accountOf(originOf(b, s))` defined and not the active account) after the active account's own boxes and boxes with no public origin. Do it after backOrder's `early` key, so the timing rule (§3.6) still comes first. A box-paid Bring one back now stays as it is: no payer, so no tie between accounts.
2. **The private payer's order.** In withdrawOne, rank with `depositAccountOf(s, box) ?? accountOf(originOf(box, s))`: R3-2's fallback, used for the ranking only. Keep `ties` as PRIV-3 has them.
3. **The question.** When every box the hatch can take is in `otherAccounts`, PaidQuestion passes that account to `<PayerNotes box={…} />`. That reuses `lovejoin.stuck.privacy.publicNamed` and `privateAccounts`: no new strings, one sentence each.

If the owner settles open question 3 on PRIV-3's model (a finished leaf ties no account), drop the three parts. Then correct rpc.ts:2210-2214 and the worker header at lovejoin.ts:68-73, which today claim the tie for every public box.

## R3-4

**low** (found as low) · lenses: money-state · `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4663`

**A direct return reviewed before a payment's Send still takes what a waiting part spends; only a chain is refused**

**Scenario.** 1. Session 0's funding change F is a token bundle.
2. The user reviews Bring it back. It comes back directly (Lovejoin off, the spare pays no box, or the review's switch) and merges into F.
3. In another window the user sends Max in parts. F is in the second part, which waits for the first, so F is now reserved as parts.<first>.
4. The return's Send goes through. sendBack's direct path (sendRecorded) never checks the parts' reservation, and fundingChange left reserved UTxOs out only at build time, before the reservation existed.
5. When part 1 lands, the pump's send() refuses part 2 as spent since and calls stopWaiting('refused').
6. The payment ends partly sent: the recipient gets part 1 only, and Home says 'only partly sent'.
For a chain, w-left's new check (sessions.ts:4741-4751) refuses the same return whole, and a fresh review leaves F out. Bring everything back (SESSION_CLAIM) goes through the same direct path.

**Evidence.** Throwaway test zz-review-money-state-1, built on w-left's 'refuses, sending none of it, a return through Lovejoin…' test with backBuild('preprod', 0, true). It printed 'direct return merged: 1', 'direct return spends F: true', 'direct return's Send refused: NO, it went' and order: [ 'part1', 'return', 'part2' ]. Then it failed: 'AssertionError: a direct return reviewed before the payment's Send, merging into what a waiting part spends, went: expected undefined to be defined'. In the test, part 2 was even submitted: rememberSpent stamps Date.now() while the test clock runs ahead (L4's clock gap, test-only). In the worker the clocks agree, so refuseSpentSince refuses part 2, which then stops as 'refused' (parts.ts step). Code: sessions.ts:4663 sends only built.chain to sendChain's check; sessions.ts:4741-4751 is the chain's parts check.

**Concerns.** w-left, 321-parts-worker#3's second half. That finding says 'A Bring it back reviewed before the payment went gives the same result', which covers a return that comes back directly as much as a chain. The fix is incomplete, not a regression.

**Suggested fix.** Run the same parts-reservation check in sendBack before sendRecorded, for every return kind (Bring it back, Bring everything back), with the same words, worker.spend.partsConflict.return. Ideally one helper serves both sendChain and sendBack, and nothing is sent or recorded before it. Add the direct case to w-left's test.

**Skeptic 1 (held, low).** The finding holds on the current tree, and I reproduced it with the worker's clocks. A Bring it back reviewed before a payment's Send can merge into the session's funding change F. If F sits in a later part that waits for the one before it, nothing refuses that return at its Send when it comes back directly (no chain). Bring everything back is the same. sendBack (sessions.ts:4663) sends only a chain to sendChain, and only sendChain has the parts check (4745-4751). The direct branch goes straight to sendRecorded (4666) and then submit (5162-5171), and neither looks at reservations. fundingChange (4636-4652) leaves reserved UTxOs out, but only when the return is built, and here that is before the parts' reservation exists. The network takes the return, because the waiting part hasn't gone. When part 1 lands, the pump's send() refuses part 2 as spent since, and step() calls stopWaiting('refused'). The payment ends partly sent.

Severity stays low:
- **No money lost or locked.** F's value comes back merged into the return, part 1 reaches the recipient, and Home says the payment went only in part.
- **An edge case.** It needs two windows: a direct return reviewed before a payment-in-parts Send and sent after it, within the 10-minute review limit, while F is in a part that waits.
- **Same impact as 321-parts-worker#3**, which was low.

It is an incomplete fix, not a regression. wss-1's handoff and w-left's report scoped "the second half" to sendChain only. The original finding's scenario, though, said "A Bring it back reviewed before the payment went gives the same result", which covers a direct return too. The direct path never had a check, and w-left's test pins only the chain case.

*Its fix:* In sessions.ts, move sendChain's parts check into one SessionService helper and also run it in sendBack's direct branch. It checks the return's transactions before anything is recorded or sent:

```ts
/** Refuses a return any of whose `txs` spends what a payment's parts still to go will spend (parts.ts reserves it). */
private async refuseParts(network: NetworkName, txs: Array<{ txCbor: string }>): Promise<void> {
  const held = await this.deps.wallet.withKeys(() => reservations(this.deps.session, network, this.deps.now()));
  const parts = new Set(Object.entries(held).flatMap(([owner, r]) => (owner.startsWith(PARTS_RESERVED) && r.until === undefined ? r.inputs : [])));
  if (txs.some((tx) => txInputs(hexBytes(tx.txCbor)).some((o) => parts.has(o)))) throw new Error(t("worker.spend.partsConflict.return"));
}
```

- In sendBack, after `if (built.chain) return this.sendChain(...)`, add `await this.refuseParts(network, [built]);` before sendRecorded.
- In sendChain, replace the inline block at 4745-4751 with `await this.refuseParts(network, txs!);`.
- This covers Bring it back and Bring everything back (claimSubmit already lists a refusal under `failed`).
- It reuses the existing short words, so there is no new i18n key and no L5 back-translation.
- It keeps to the owner's rules. It refuses only the wallet's own transaction that conflicts with a payment the user already approved: two transactions that can't both land, the same family as refuseReserved and sendChain's check. It is not a guard on the user's choice.
- Add the direct case to w-left's describe in parts-send-review-fixes.test.ts: backBuild with direct=true, and claimBuild with direct=true. Assert the words, that nothing of the return is submitted, and that part 2 goes once part 1 lands. Make Date.now follow the test clock there, or the spent mark reads as expired (L4's gap).

I checked this exact change in a scratch copy. It passes the new cases and the 345 return, chain, parts and Lovejoin tests I ran, and tsc is clean.

## R3-5

**low** (found as low) · lenses: lovejoin-records · `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:6812`

**After a dropped withdraw of Bring every box back now and a Stop, a Bootstrap never closes and holds another of the wallet's boxes for good**

**Scenario.** A held Bootstrap B1 has three boxes at its deposit.
1. Bring every box back now sends b1#0's withdraw, which is counted back against B1 at the send and recorded in `counted`.
2. The run is stopped (by Stop, or by itself after three runs that sent nothing) before it takes b1#1 and b1#2.
3. A node drops that withdraw, so b1#0 stays in the pool.
4. Stop's recheck reads the pools 2 h on. bootstrapOf holds, by count (2 out), the first two deposit boxes listed: b1#0 and b1#1.
5. b1#2 is left free, gets a due time and comes back by itself. countBack's path for a box no Bootstrap holds credits it to nobody.
6. The user brings b1#0 and b1#1 back by hand. b1#0 is in `counted`, so its countBack is skipped.
All three boxes have left the pool, but B1's entry says 2 of 3 back. If the pool then lists a box of the wallet's that no record accounts for (one someone else's mix moved), squareUp finds the counts balanced and bootstrapOf holds that box in B1's place. It gets no due time and never comes back by itself, and Home counts it as a Bootstrap's held box, until the user brings it back by hand.

**Evidence.** Throwaway test zz-review-lovejoin-records-1.test.ts (run in the tree, then deleted) fails on the tree: `AssertionError: expected [ [ …(2) ] ] to deeply equal []`, received ['b1…', [{ back: 2, boxes: 3, pool: TOKEN }]].

Exploratory log:
- after the recheck, held [b1#0, b1#1] with one due time;
- b1#2 came back by itself while the entry stayed at back 1;
- after the by-hand returns, back 2;
- then held [f9#0] with due [], f9 not withdrawn in 8 runs over 24 h, and held().pools[0].bootstrap === 1.

With dropWithdrawing's `counted` skip disabled (the behaviour before w-left), the same test passes: B1 closes and f9 comes back by itself.

Code:
- dropWithdrawing's skip (:6812-6815);
- bootstrapOf takes deposit boxes in listing order up to the count (:2258);
- countBack credits a deposit box only to a released Bootstrap (:2149);
- Stop sets recheck (:6271), whose read gives the freed box a due time (:5943, :5965).

Related but unproven: money-state's report asks whether the same `counted` field double-counts in another case. Someone else's mix moves a dropped Bring-all withdraw's box, the read prunes `counted`, and the wallet's new box from that mix may then be counted against a mix entry again.

**Concerns.** Two fixes meeting. w-left: wlj-2's notes (a), the `counted` skip, and (b), Stop's recheck. wlj-1: 316#0's bootstrapOf hold by count, and countBack's rule for a box no Bootstrap holds. Before w-left, b1#0's second credit made up for the substitution.

**Suggested fix.** In bootstrapOf, hold a deposit box that's in `counted` last, since it was counted back already: `mine.filter(at a deposit).sort(counted last)`. The dropped withdraw's own box then comes back (by itself after Stop, counted once), and the Bootstrap keeps holding its other boxes. No refusal is added. Checked in a copy: the throwaway test passes, and lovejoin-crediting-review-fixes, lovejoin-bring-review-fixes, lovejoin-bring-all-back, lovejoin-pools and lovejoin-release-rules (89 tests) still pass.

**Skeptic 1 (held, low).** Reproduced with an independent throwaway test on the current tree. The finding holds step for step. After a dropped withdraw of Bring every box back now and a Stop, bootstrapOf (wlj-1, 316#0) holds by count the box that was already counted back (b1#0, in w-left's `counted`). It frees a sibling (b1#2), which comes back by itself counted against nobody (countBack :2149). Bringing b1#0 back by hand then skips its credit (:6812), so B1's entry keeps one box out after all its boxes left the pool. squareUp fixes this only when the pool lists none of the wallet's other boxes. When it lists one no record accounts for (f9, moved by someone else's mix), that box is held in B1's place: no due time, never back by itself, and Home counts it as a Bootstrap's held box until it's brought back by hand. With the `counted` skip turned off (before w-left) the same test passes, so it is two fixes meeting: w-left (wlj-2's notes a and b) and wlj-1's hold-by-count and countBack rules. Low by the brief's scale: an edge case needing a node-dropped withdraw plus Stop or the auto-stop partway through a Bootstrap's boxes. No money is lost or locked: the box is listed on the pool's page and one Bring one back clears it. The finding's own suggested fix (sort counted boxes last) is incomplete: it fails a variant where one of B1's boxes was moved by someone else's mix before the run.

*Its fix:* Keep a box that's in `counted` out of what any Bootstrap holds, since it was counted back already. Do it in bootstrapOf and in holderOf, rather than only sorting it last:
- lovejoin.ts:2255 (bootstrapOf): `const mine = inPool(owned, p).filter((b) => s.counted?.[ref(b)] === undefined);`
- lovejoin.ts:2167 (holderOf): the same filter, so its count of boxes still at the deposit agrees with bootstrapOf's.

The dropped withdraw's own box then comes back by itself after Stop, counted once, as w-left's (b) intends. The Bootstrap keeps holding its genuinely-out boxes, one someone else's mix moved included, which "counted last" misses. It adds no refusal. Classic-pool transactions are unchanged, since bootstrapOf returns [] with no Bootstrap open. 1.5.0 vaults and the 1.5.0 gate are unaffected, since `counted` is only written by Bring every box back now's withdraws. A withdraw's tie is unchanged, since depositAccountOf goes by where the box sits, not by the held flag. Add both scenarios (all boxes at the deposit, and one moved by a stranger's mix) as a test in lovejoin-bring-review-fixes.test.ts. A comment on the new filter can point to wlj-2's notes.

## R3-6

**low** (found as low) · lenses: cross-area · `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:1312`

**A return waiting at its collateral's mix can end Bring every box back now, and drop its boxes' due times, while the pool listing lags**

**Scenario.** A session's return through Lovejoin has a collateral tail (preprod's 5 ₳ pool today; mainnet once one holds its floor). The user presses Bring every box back now while that chain mixes, so the run waits on `chain`.
1. Every transaction before the collateral's mix reaches a block, and pumpChain asks giveme.my. witnessTail sets Tail.landed, so `tailWaits` holds and `mixing` is false.
2. The pool listing (another Koios backend, C14) doesn't show the chain's leaf or the collateral's box yet.
3. The next run takes nothing and confirms nothing, and `mayLand` is false because the chain isn't `done`. So the run ends: it deletes `bringing`, trims the pool's due times to what's listed (the leaf's goes), and the page says 'Nothing of yours was left in Lovejoin.' (doneOf 0).
4. A minute later the leaf is listed. Nothing gives it a due time back, and returning() is false. So it waits for the next unlock, a Lovejoin page read, or the collateral box's own due time hours later.
That is 321-lj-worker#0's own symptom. A box's own run that reads in that window (an unlock, or another box due) trims the same due time (line 5968).

**Evidence.** Code: lovejoin.ts:1304 `mixing = !c.ended && !tailWaits(c)`; :1312 `mayLand` needs `c.done`. Both the bring's end (:6400, :6404) and withdrawDueNow's trim (:5968) key on mixing and mayLand only.

Throwaway test zz-review-cross-area-2, on wlj-2's waitingTail setup, with the chain's boxes not listed yet:
- Bring case: 'AssertionError: Bring every box back now ended before the chain's box was listed: expected undefined to be defined', with state `bringing undefined due [] doneOf 0`.
- Box's own run case (c1 due): c1 sent, then 'AssertionError: d1#0's due time went in the run's trim: expected 0 to be greater than or equal to 1'.

With the candidate fix in a scratch copy, both pass: the run waits on `landing`, keeps the due time, and takes d1#0 once listed. lovejoin-bring-review-fixes.test.ts (16) and the planner's x-scenarios-lj#1 and tail tests (14) still pass.

The release review rated 321-lj-worker#0 medium. This is its symptom by another route (a chain waiting at its tail, not a just-sent one). The lens rated it low: preprod's 5 ₳ pool today, mainnet once one holds its floor, and only while the listing lags.

**Concerns.** Two fixes meeting. wlj-2's x-scenarios-lj#1 leaves tailWaits out of `mixing`, and 321-lj-worker#0's `mayLand` covers only done chains.

**Suggested fix.** Count such a chain as landing too, bounded as a done chain is, with no new request: `const mayLand = (c, now) => ((!!c.done && c.ended !== undefined && now - c.ended < LANDING_MS) || (tailWaits(c) && now - c.tail!.landed! < LANDING_MS)) && !c.landed && makers(c).length > 0;`. landedBy's every-leaf rule then marks the chain in once its leaves are listed.

**Skeptic 1 (held, low).** Reproduced on the current tree. A chain waiting at its collateral's mix (tailWaits) counts neither as `mixing` (1304, x-scenarios-lj#1 left it out) nor as `mayLand` (1312, 321-lj-worker#0 covers only a done chain). Both the bring's end (6400/6404) and a box's own run's trim (5968) check only those two. witnessTail sets Tail.landed from tx_status (sessions.ts:4975), not from the listing. So while Koios's credential_utxos lags tx_status, the bring ends with a false "Nothing of yours was left in Lovejoin." (settings.lovejoin.bringNone, doneOf 0), and the trim drops the chain's boxes' due times. Home's held() then drops the box, because it counts due times only. Nothing brings it back until the next unlock or Lovejoin page read draws a fresh due time, hours away. At 499768f6 both checks were `!c.ended`, so this is a regression where wlj-2's two fixes meet; it is not an owner call or a known leftover (L1–L6). The window is real but narrow. One alarm tick runs sessions.runAll before withdrawDue (runs.ts:84–95), so when giveme.my or Koios's Ogmios declines the first ask, the bring's run reads the listing seconds after tx_status first said the chain was in. It still needs a collateral tail (a 5 ₳ pool: preprod today, mainnet only once one holds its floor), giveme.my declining, and the listing lagging at that moment. No money is lost, nothing ties the user's accounts, and it heals at the next read with the box late. So low, as the lens rated it. One correction to the finding: its claim that landedBy "then marks the chain in once its leaves are listed" is wrong for a chain waiting at its tail. c.leaves includes the tail leaf, which can't exist before the tail's mix is sent, and makers(c).at(-1) is that mix. So the suggested fix always holds for the full LANDING_MS (15 min).

*Its fix:* Take the suggested change in lovejoin.ts:
`const mayLand = (c, now) => ((!!c.done && c.ended !== undefined && now - c.ended < LANDING_MS) || (tailWaits(c) && now - c.tail!.landed! < LANDING_MS)) && !c.landed && makers(c).length > 0;`

It adds no request, refusal or words: the bring says the existing `landing` wait. Correct its comment, because landedBy never marks a chain waiting at its tail in. The hold therefore runs the full LANDING_MS (15 min) from Tail.landed, and a box's own run sends nothing for those 15 minutes even once the listing has caught up. That is the same cost a done chain already has (wlj-2's note 4).

Optional, tighter: end that hold once a read lists a box of `c.tail.deposit`, since every transaction before it is in by then. That needs a mark of its own (an optional Tail field, backward-compatible), never `c.landed`, which must still wait for the tail leaf after the chain ends.

Add both cases (the bring, and a box's own run with c1 due) to lovejoin-bring-review-fixes.test.ts's x-scenarios-lj#1 describe, on waitingTail with the chain's boxes unlisted. Both fail on today's tree and pass with the fix.

## R3-7

**low** (found as low) · lenses: screens-states · `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:304`

**The Mix form refuses one box, and stops its stepper one box low, where the worker funds it without the collateral's reserve**

**Scenario.** Preprod (on mainnet, once a 5 ₳ pool holds its floor), with a 5 ₳ pool shown that takes the collateral. Classic pool, depth 1, private balance 19.45 ₳.
- The worker funds one box without the 1.5 ₳ reserve (orWithoutReserve): it pays 12.45 ₳ and 5 ₳, fee 0.233 ₳, about 1.77 ₳ change.
- The form's mixMost(…, tail) keeps the reserve aside, so adaMost is 0. stuckForm says 'Your private balance can't pay for one box.', notNow becomes cantAfford, and Review is disabled.
The window is 19.45 to 20.95 ₳ at one box. At n boxes the stepper stops at n−1 and says it pays for n−1 at most. sc-lj-1's call 2 names Settings' collateral switch as the way out. With returns off (a supported setting) that switch is greyed (Settings.tsx:852), yet funding() still names the reserve and mixFunding still pays it (tailReserve(network, true)).

**Evidence.** Code: sessions.ts:4492-4494, orWithoutReserve's doc: 'no form that decides what can be funded counts it, so it's never what refuses a funding (1.6.0's release review, 323-worker#0)'. sc-o-1 kept the reserve out of the swap form's adaShort for that reason (its call 1). sc-lj-1 counts it in mixMost, which also decides notNow (Lovejoin.tsx:2558, :2916-2925, :2947-2949).

Throwaway test (real WebAssembly, preprod's 5 ₳ pool with two strangers' boxes):
- At held = funding.lovelace + 7 ₳ = 19.45 ₳, mixMost(…, 0n).adaMost is 1.
- runner(wallet(19.45 ₳)).mixOutBuild('preprod', 1) builds, paying ['12450000', '5000000'] with fee 233208 and no collateralReserve.
- Asserting the form offers that box fails: 'AssertionError: the form should offer the box the worker funds: expected +0 to be 1'.

A second case, with lovejoinReturns false and lovejoinCollateral true: lj.funding still names collateralReserve '1500000', tailReserveOf gives 1.5 ₳, and a rich mixOutBuild pays it. settings.test.ts:230 already pins the switch as disabled there.

Tension with R3-20, which lists this tail wiring (Lovejoin.tsx:2558) as revertible with every test green. This cluster says the tail shouldn't set the cap or the refusal at all.

**Concerns.** sc-lj-1: 323-worker#0 (form half), 320-screens#2. It disagrees with sc-o-1's adaShort (call 1) and with reserve's orWithoutReserve contract: two fixes disagree, and this one adds a refusal the chain wouldn't make. R3-8 breaks the same contract from the worker's side.

**Suggested fix.** Keep adaMost, stuckForm, capBalance and notNow on COLLATERAL + FEE_ROOM, never refusing on the reserve. Use the tail only for the figures. Where the chosen count is more than the balance pays with the reserve, take the form's tail as 0, as the worker then builds it, so the totals still match the review. Add one short line, e.g. 'At this many, its collateral isn't mixed: there isn't 1.5 ₳ more for it.' That's a warning, not a refusal. A test for this wiring (R3-20) should then pin the figures, not the cap.

**Skeptic 1 (held, low).** The finding holds on the current tree. sc-lj-1 added the collateral's 1.5 ₳ reserve (`tail`) to mixMost's aside. That one number sets three things: the stepper's cap, the stuckForm line and notNow (so `cannot`, so Review). Meanwhile mixFunding goes through orWithoutReserve, which funds the same count without the reserve, so the form refuses mixes the chain takes.

- At one box, Review is disabled and the form says "Your private balance can't pay for one box.", which is false.
- At n boxes, the stepper stops at n−1 and says the balance pays for n−1 at most, also false.
- sc-lj-1's call 2 says "It's not a refusal: Review and the worker's fallback are unchanged". At one box that's wrong: Review is off.
- Two fixes disagree. The reserve fixer's orWithoutReserve contract says "never what refuses a funding", and sc-o-1 kept the reserve out of adaShort for that reason.

The brief's rule makes a fix-added refusal the chain wouldn't make a finding. It stays low:
- the band is 1.5 ₳ at each count's edge;
- it's live on preprod only, and dormant on mainnet until a 5 ₳ pool holds 30 other people's boxes;
- nothing is lost or locked;
- there's a way out: Settings' collateral switch while returns are on, or more ADA made private.

With returns off that switch is greyed, yet the mix still pays the reserve. That greying predates the review, so it's context: it removes call 2's way out, but it isn't a new bug.

*Its fix:* In PoolPage, set the cap and the refusal without the reserve, as sc-o-1's adaShort does. Count the reserve in the figures only where the chosen count leaves room for it, which is what the worker builds:

```ts
const asked = tailReserveOf(funding, source, pools);
const { tokenMost, adaMost, affordable, most } = mixMost(source, side, token, funding, box, roomMost);
const tail = asked && mixMost(source, side, token, funding, box, roomMost, asked).adaMost >= boxes ? asked : 0n;
```

- **Figures:** firstBox, mixCosts and MixMoves keep reading `tail`, so the form's totals match the review in both cases.
- **One short line** where `asked && !tail`, under a `.privacy.` key so the critical set picks it up (es/ja and back-translation follow): "At this many, its 5 ₳ collateral is mixed only if enough is left when it comes back."
  - The finding's own wording, "isn't mixed", says too much: orWithoutReserve still mixes it at the return if what's left pays.
- **Tests:**
  - Change sc-lj-1's "offers a box only where … the reserve too where it's paid for": it pins the refusal at 23_799_999 with the tail.
  - Pin the figures instead, with the real WebAssembly. At funding + 7 ₳, the form offers the box with tail 0, and its `leaving` matches mixOutBuild's (no reserve) within the fee's estimate. At funding + 8.5 ₳, the tail is 1.5 ₳ and the review's collateralReserve is 1500000.
- **Owner calls:** correct sc-lj-1's call 2 in the list. Call 3's "where the funding refused it at Review" isn't true from 19.152 to 19.45 ₳ either: the funding builds there.

## R3-8

**low** (found as low) · lenses: money-state, cross-area · `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4502`

**orWithoutReserve falls back only on NotEnoughPrivate, so a one-transaction top-up or Mix my boxes again that the reserve alone pushes past one transaction's computation is refused**

**Scenario.** A site's session has no collateral left, so its top-up pays a new 5 ₳. Where a 5 ₳ pool would take the collateral and Settings' switch is on, it also pays the direct reserve (2.8 ₳ since 323-rust#1). The private balance is spread over many small UTxOs, as it is after Lovejoin boxes come back one UTxO each.
- topUpBuild builds one transaction ({ inParts: false }, sessions.ts:2147).
- Without the reserve the top-up takes 17 to 20 UTxOs and builds. With it, it takes 23, past one transaction's computation (about 22).
- WebAssembly throws 'Spending 23 UTxOs at once needs more computation than a transaction may use' (from buildWithdraw via sessions.ts:2839). orWithoutReserve rethrows it, since it isn't NotEnoughPrivate.
The user sees that error, which doesn't name the reserve, though the same top-up builds without it. The only way out is Settings' collateral switch. Mix my boxes again from the private balance (againBuild → mixFunding, inParts false, sessions.ts:2055) meets the same edge with 1.5 ₳, and TooLarge falls in the same gap. Nothing is sent or lost. But it refuses a funding the chain takes without the wallet's own extra, against the helper's doc ('it's never what refuses a funding').

**Evidence.** Two throwaway tests, both deleted, both failing on the tree.
- money-state's zz-review-money-state-4, on collateral-reserve-review-fixes' harness: DIRECT stubbed at 2.8 ₳, 40 UTxOs of 0.7 ₳, topUpBuild('preprod', 0, '6000000', []). It printed '6 ₳: with 5 ₳ pool -> refused: Spending 23 UTxOs at once needs more computation than a transaction may use | no pool -> ok(reserve=none, inputs=20)', then failed: 'AssertionError: a top-up refused with the reserve that goes without it'.
- cross-area's zz-review-cross-area-1: 40 UTxOs of 0.5 ₳, a 3 ₳ top-up. With no 5 ₳ pool it builds. With the pool shown it throws 'Error: Spending 23 UTxOs at once needs more computation than a transaction may use'. With orWithoutReserve also falling back on that error, in a scratch copy, the test passes.
Code: sessions.ts:4498-4505 (`if (!reserve || !(e instanceof NotEnoughPrivate)) throw e;`), topUpBuild :2147, mixFunding :2055.

**Concerns.** reserve, 323-worker#0 ('nothing falls back without it'): the fix covers only the too-little-ADA case, and 323-rust#1's larger direct figure widens the gap. R3-7 breaks the same contract from the form's side.

**Suggested fix.** In orWithoutReserve, also build without the reserve when the error is one transaction's computation or size limit. Match sessions.ts's own TOO_MANY pattern (/needs more computation than a transaction may use/), or a typed TooMany/TooLarge. 'Too many UTxOs with the reserve' then gets the same quiet fallback as 'too little ADA with the reserve' (reserve's call 4). A Bootstrap never reaches it, since its asked reserve is 0. It adds a build the ledger takes, not a guard.

**Skeptic 1 (held, low).** The finding holds on the current tree (e43eef7f, no tracked changes). orWithoutReserve (sessions.ts:4498-4505) only builds again without the reserve on NotEnoughPrivate, which buildFunding (around :2843) makes only from core's NotEnough message. Core's TooMany ('Spending N UTxOs at once needs more computation than a transaction may use', build.rs settle :1994-1995) is rethrown unchanged. So a one-transaction funding that the reserve alone pushes past one transaction's computation is refused, though the chain takes it without the wallet's own extra. Two builds are exposed: topUpBuild (inParts false, :2147, 2.8 ₳ direct reserve) and Mix my boxes again (mixFunding, inParts false for mix.again, :2055, 1.5 ₳ reserve). A swap's and a site's funding go in parts, and collateralTopUp has no reserve. I reproduced both, and the suggested fallback closes both. The finding's own evidence uses UTxOs of 0.7 ₳ and 0.5 ₳, below a Seedelf output's least (1,456,780 lovelace at 4,310 a byte, per fixes/reserve.md), so those exact states can't exist on chain. The gap shows up at real UTxO sizes too: 1.5 ₳ UTxOs, and 5 ₳ boxes back from the 5 ₳ pool. It stays low under the brief's scale: nothing is sent, lost or locked. It's a narrow band about as wide as the reserve (2.8 ₳ for a top-up, 1.5 ₳ for an again), just under one transaction's limit. It needs at least 23 UTxOs in the private balance, and a shown 5 ₳ pool past the network's floor with 2 free boxes (collateralPool, lovejoin.ts:3807-3816): live on preprod, dormant on mainnet until a mainnet 5 ₳ ADA pool holds 30 strangers' boxes. It also needs Settings' collateral switch and Lovejoin returns on, and for a top-up a site session with no 5 ₳ at its account. The user's ways out: either of those switches off, or about 3 ₳ less, though the raw core English never names the reserve. It breaks the helper's doc ('never what refuses a funding') and the reserve fixer's claim that the reserve can no longer be what refuses at Review. The 323-worker#0 fix still fixes its own finding, the NotEnoughPrivate gap. Not medium. Two corrections to the finding: 'the only way out is Settings' collateral switch' is overstated (a smaller amount, or Lovejoin returns off, also works). Mix my boxes again needs a big pool to reach the edge: in the fixtures' 20-box classic pool it tops out at 8 mixes (15.6 ₳), 12 UTxOs of 1.5 ₳.

*Its fix:* In SessionService.orWithoutReserve (sessions.ts:4498), also build without the reserve when the build with it hits one transaction's computation limit:
`const roomless = e instanceof Error && TOO_MANY.test(e.message); if (!reserve || !(e instanceof NotEnoughPrivate || roomless)) throw e;`
Optionally also match core's TooLarge wording, which my tests didn't reach since the reserve adds ADA, not tokens. A typed error is also possible: buildFunding could turn TOO_MANY into a typed TooManyPrivate as it does NotEnoughPrivate, provided mixFunding's Bootstrap catch at :2057, which tests the message, is moved to the type.

This drops a refusal the chain wouldn't make and adds no guard. The collateral is still mixed at the return if what's left pays, otherwise it comes back with the rest, the same quiet fallback as reserve's call 4. Fix its doc to say 'too little ADA, or more UTxOs than one transaction spends'.

Add a test in collateral-reserve-review-fixes.test.ts: 40 private UTxOs of 1.5 ₳ and a 24 ₳ topUpBuild with the 5 ₳ pool shown should build with collateralReserve undefined. It fails today with 'Spending 23 UTxOs at once…'.

Separate and older than this fix round: topUpBuild could map a remaining TOO_MANY to the user's words through short.ts's tooMany(), as withdraw.ts and transfer.ts do.

## R3-9

**low** (found as low) · lenses: privacy-words · `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx:1285`

**A swap funded without the collateral's reserve still mixes its collateral through giveme.my at its return, and its approval says nothing of it**

**Scenario.** Preprod, a 5 ₳ pool shown with two boxes free, defaults on. The balance pays the swap and its 5 ₳ but not 1.5 ₳ more: for example, an amount typed between Max and the balance (adaShort doesn't count the reserve).
1. orWithoutReserve builds the funding without the reserve, so summary.collateralReserve is unset.
2. The approval then shows the Plan line without 'Mixed' ('The proceeds and everything left, directly') or noBox ('so it all comes back at once'), and no swaps.review.privacy.collateralMix line.
3. The return that runs by itself (after a refund, a Stop through Lovejoin, or a fill that's ADA) still deposits the 5 ₳ and mixes it under giveme.my's collateral: buildBack's intoPool never reads record.collateralReserve, and WebAssembly builds the tail when what's left pays.
So giveme.my sees a mix no screen named, and the approval said the 5 ₳ comes back directly. Stop's dialog says nothing either. A site's funding note in the same state says 'The rest and the 5 ₳ come back at once', though its return review does show CollateralTailNote.

**Evidence.** Code: Swaps.tsx:1285 `collateralMixed = !!summary.collateralReserve` gates :1362, :1380 and :1390-1394; DappApprovals.tsx:481 and SiteSessions.tsx:633 gate the same way. sessions.ts:4241-4249: intoPool ignores the record's reserve. lovejoin.ts:691: '...when what the chain leaves pays for it'. reserve's own test comment says the collateral 'may still be mixed with what's left'.

Throwaway test 2 (deleted): outBuild with a balance of the fund plus 7.5 ₳ gave collateralReserve undefined. outSubmit recorded no collateralReserve and auto.direct false. With the funding's outputs at the account, backBuild returned collateralTail {box, leaf, fee 1005095, pool 18c4df77…, txs 2} and lovejoin {boxes 1, depth 1}.

The money side is the owner's decided call 323-worker#7 (HANDOFF: 'A session funded without the reserve pays its collateral's mix from what was coming back', Leave), and x-compat#3 is its 1.5.0 variant. This cluster isn't that. Reserve's 323-worker#0 fallback now makes the state common wherever a usable 5 ₳ pool meets a balance short of 1.5 ₳ more. The approval's words, keyed on the reserve, then say the 5 ₳ comes back directly. And the owner's list (reserve's call 4, sc-o-1's call 1) describes the fallback as 'funded without the collateral's mix'. R3-12 (Max before any quote) lands in the same state.

**Concerns.** sc-o-1 (x-privacy#1, 323-worker#6, gap-3#2) keys its words on the reserve, and reserve (323-worker#0's fallback) makes the unreserved state common. reserve's call 4 and sc-o-1's call 1 put the fallback to the owner as 'funded without the collateral's mix'. The code doesn't do that. R3-10 is the opposite mismatch on the same words: a mix the approval names but the return can't build. One rule for when the approval names the collateral's mix should settle both.

**Suggested fix.** Have the worker keep on the summary that tailReserve found a pool (e.g. collateralPool), even when orWithoutReserve dropped the reserve. Key the giveme.my line and the 'Mixed' Plan and no-box words on that, and keep the cost row on the reserve. Do the same in FundingWayBack and TopUpCollateralNote (R3-1's tests should then pin that key). Add one short line to Stop's dialog where its return goes through Lovejoin. Correct reserve's call 4 and sc-o-1's call 1 in the owner's list. No refusal.

**Skeptic 1 (held, low).** The finding holds. I reproduced it end to end on the current tree with the real WebAssembly, preprod's 5 ₳ pool holding two strangers' boxes, and default settings.

When the balance is short of the 1.5 ₳ reserve, orWithoutReserve drops it. The summary and the record then carry no collateralReserve, and the approval falls back to the plain words: "The proceeds and everything left, directly" and, where there is no box, "…so it all comes back at once". It shows no giveme.my line. buildBack's intoPool never reads record.collateralReserve, so the return still mixes the 5 ₳ under giveme.my wherever what's left pays for it.

Where it bites:
- **A token→ADA swap:** the tail builds on its normal fill, with no Stop needed.
- **An ADA-in swap:** the tail builds on a stop or a refund.
- **An ADA→token fill:** no tail is built without the reserve, so the Plan's fill words are true there.

The most realistic way in isn't "typed past Max" but a token→ADA swap by a user short of ADA. For a token-in swap, adaShort counts only fund.lovelace plus 5 ₳, and Max doesn't apply to ADA.

This isn't the decided 323-worker#7. That call covered sessions funded while no pool was shown, and 1.5.0's. Here the pool was shown and usable at approval. Before the fix round this funding was refused; now its approval says something false: "so it all comes back at once", while the return mixes the 5 ₳. x-privacy#1's fix keys the giveme.my line on the reserve, so it's incomplete in this state.

Corrections to the finding:
1. Reserve's call 4 is accurate ("whether the collateral is mixed is decided at the return"). Only sc-o-1's call 1 says "funded without the collateral's mix".
2. Stop's dialog never names the collateral's mix in any state, reserved or not. With no box it says "everything comes back…, less the return's network fee". That gap isn't specific to the fallback.
3. The site and top-up part is a nit: their returns are reviewed by hand with CollateralTailNote before anything is sent.
4. The suggested fix, keyed only on "a pool was found", would make the common ADA→token swap's approval promise a box its fill never builds. That's R3-10's mismatch.

Low:
- preprod only at release;
- no loss or lock;
- the money side is the owner's Leave;
- giveme.my's view of the mix is disclosed in the policy and Settings (x-privacy#1 was itself low);
- the false line understates the privacy the 5 ₳ gets, and costs about 1 ₳ from what comes back plus a delay of hours.

*Its fix:* 1. **The flag.** Keep on the summary that tailReserve found a usable pool even when orWithoutReserve dropped the reserve (e.g. `collateralPool: true`).
2. **The words, by what each path can pay.** With that flag and no reserve:
   - **An ADA-out swap:** its fill is ADA and pays for the tail, so it gets the *Mixed Plan and noBoxMixed words and swaps.review.privacy.collateralMix, as a reserved swap does.
   - **An ADA-in swap:** keep the plain fill words, since its fill can't pay for the tail without the reserve. Name the collateral's mix in one short clause on the ifStopped/stop line, or leave that to the owner.
   - Don't key on the flag alone, or every ADA→token approval names a mix its fill never builds.
3. **The cost row** stays keyed on the reserve.
4. **The owner's list.** Correct sc-o-1's call 1: the fallback is funded without the reserve, not without the mix. Its collateral is still mixed at the return wherever what's left pays (an ADA fill, a stop or a refund), while the approval says it all comes back at once. Reserve's call 4 is already accurate.
5. **Stop's dialog** never names the mix, in any state. Treat it with L1's Stop work rather than here.
6. **The site and top-up notes** may follow the same flag (nit).
7. **Tests.** Render SwapApproval from an outBuild that fell back with a pool found: MIN→ADA expects the giveme.my line, ADA→MIN its plain fill words.

No refusal and no behaviour change, since 323-worker#7 stays the owner's Leave.

## R3-10

**low** (found as low) · lenses: money-state · `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx:1285`

**A swap against the pools is charged the collateral's mix reserve and its approval promises that mix, though its direct return can't build it**

**Scenario.** 1. A 5 ₳ pool is shown (preprod today) and Settings' collateral switch is on.
2. The user swaps ADA for a token with no Lovejoin pool, or one set to come back directly, and Minswap routes it against Danogo's pools.
3. outBuild takes the 1.5 ₳ reserve whatever quote.againstPools says (sessions.ts:1786).
4. The pool swap pays the session one output: the token plus all the ADA left over, the reserve included. That's pool-swap-landing.test.ts's model of Minswap's build: 'output 2: the change, and the MIN bought'.
5. At the return the spare pays no box, so it comes back directly. Apart from the collateral, the only ADA is in that token output, and WebAssembly's direct_tail pays only from UTxOs of ADA alone (wasm/src/lovejoin.rs:369). So it bails, and the collateral comes back with the rest, unmixed.
6. Everything the approval said is false here: 'Its collateral's mix, about 1.5 ₳' counted in Costs in all; Comes back 1.5 ₳ lower; the Plan's 'The proceeds and the rest directly; its 5 ₳ collateral in a Lovejoin box, later'; 'Too little spare ADA for a Lovejoin box, so all but its 5 ₳ collateral comes back at once.'; and 'giveme.my backs its collateral's mix too, so it sees that mix.'
No money is lost (the reserve comes back in the change), but the privacy assurance and the cost lines are wrong. An order swap is unaffected: its order transaction's change is ADA alone. A site session whose dApp leaves its ADA beside tokens meets the same limit under noteLovejoinMixed and topUp.collateralMixed. It's dormant on mainnet until a 5 ₳ pool there holds its floor.

**Evidence.** Throwaway test zz-review-money-state-2, on collateral-reserve-review-fixes' harness. Session 0, a site's, has collateralReserve: true. Its account holds 3.1 ₳ and the 5 ₳ collateral, and a 5 ₳ pool holds two strangers' boxes.
- With the 3.1 ₳ as ADA alone, backBuild's collateralTail is built (passed).
- With the same 3.1 ₳ beside 906 MIN in one UTxO, it printed 'withToken=true: lovejoin=null tail=null skipped=its spare ADA is too little for a box' and failed: 'AssertionError: the collateral's mix, its funding having paid the reserve (token UTxO): expected undefined to be defined'.
The approval's words key off summary.collateralReserve alone (Swaps.tsx:1285-1290, 1362, 1380, 1391). The lens notes the brief's 'misleading … about privacy' could argue medium, and rates it low for mainnet dormancy and the narrow route. money-state's report asks the same of site sessions: is charging the 2.8 ₳ direct reserve, and saying the 5 ₳ is mixed once, the intended trade where direct_tail can't pay?

**Concerns.** sc-o-1 (323-worker#1, 323-worker#6, x-privacy#1). Its words sit over reserve's open call 6 (direct_tail pays only from UTxOs of ADA alone), which isn't among the brief's known leftovers. R3-9 is the opposite mismatch on the same words.

**Suggested fix.** Either (a) take reserve's call 6: let direct_tail pay from a token UTxO's ADA, its tokens going back as the deposit's token change (Rust, then a rebuild). Or (b) in outBuild, take no reserve for a swap against the pools whose return would come back directly (no token boxes), so none of the mix rows show. Either way, show the mix's cost, Plan step and giveme.my line only where the return can build the mix, one rule shared with R3-9's fix. (b) is a worker change with no new string.

**Skeptic 1 (held, low).** The finding holds, and I reproduced it end to end on the current tree. The test used the real worker, the real WebAssembly (pkg built 13:37 today, after the last Rust edit at 12:45) and the real approval component.

What happens:
- A swap quoted against Danogo's pools is funded with the 1.5 ₳ collateral reserve.
- Its approval, rendered from the worker's own summary, shows the collateral's mix in four places: the reserve row, the cost line, the Plan step and the giveme.my line.
- Once the pool swap lands in Minswap's shape (one output: the MIN and all the ADA left), the runner's own return sends a single direct transaction. It spends the 5 ₳ collateral together with the MIN output, with no deposit into the 5 ₳ pool.
- The control is the same run with the swap's ADA in an output of its own. That return does build the collateral's deposit, mix and return (a chain of 3). So the cause is `direct_tail` paying only from UTxOs of ADA alone, as the finding says.

Why it's new: the fixer `reserve` named this limit as its open call 6 (fixes/reserve.md:139). It is not among REVIEWBRIEF's L1–L6 or HANDOFF's owner calls. sc-o-1's round-2 words never considered pool swaps. Before those words, the approval said "Kept aside for contracts 5 ₳, comes back", which was true on this route. So the new words are a regression here.

One imprecision in the finding: the line "Too little spare ADA for a Lovejoin box, so all but its 5 ₳ collateral comes back at once." did not show in my run. The 16.85 ₳ funding would pay a 10 ₳ box if the swap were stopped (`ifStopped`), so `any` is true and LovejoinChoice shows instead. That line appears only on a smaller swap. The other false lines all showed.

Severity stays low:
- No money is lost: the reserve sat inside the MIN output, and the return swept it back.
- No new link is made: the 5 ₳ comes back in the same direct return that the Plan already announces for "the proceeds and the rest". What's lost is that 5 ₳ isn't mixed as promised. The cost and "Comes back" lines are off by 1.5 ₳, both on the cautious side, and the giveme.my line over-discloses.
- It's dormant on mainnet: the bundled mainnet list is empty, so nothing charges the reserve there. It would go live without a release once a 5 ₳ pool there holds its floor.

Medium is arguable only under "misleading … about privacy", and the privacy effect is nil beyond the direct return already disclosed.

*Its fix:* Preferred is (a), reserve's call 6, in Rust: let `direct_tail` take a token UTxO's ADA as a payer.
- The deposit returns that UTxO's tokens to the session with their least ADA.
- It also makes a change output of ADA alone, because `collateral_mix` pays the mix's fee from the session's largest UTxO of ADA alone.

This keeps the private default, needs no new words, and covers every case:
- swaps quoted against the pools;
- swaps quoted as an order that Minswap builds against the pools at run time;
- site sessions whose dApp leaves its ADA beside tokens.

It needs a pkg rebuild by the lead.

If the gate won't take a Rust change now, (b): in `outBuild`, take no reserve where `quote.againstPools` and no token boxes are funded (no `lovejoin.ways` entry with boxes). Then none of the mix rows show, with no new string.
- (b) still misses a swap approved as an order that Minswap routes to the pools at build time. Note that as a leftover.
- Either way, share one rule with R3-9's fix for when the approval shows the mix's cost, Plan step and giveme.my line.
- Add no hedge paragraph (keep UI text short).

Add a regression test of this run's shape: a Danogo route, a 5 ₳ pool shown, MIN in no pool, one session output holding MIN and all the ADA left. After the fix, it should expect the collateral's deposit into the 5 ₳ pool, or for (b) no reserve and no mix rows.

## R3-11

**low** (found as low) · lenses: privacy-words, screens-states · `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:1541`

**Max keeps 1.5 ₳ aside and its note names 'its collateral's mix' wherever a 5 ₳ pool is shown, though the funding pays none while that pool can't take the collateral**

**Scenario.** On mainnet, the first 5 ₳ ADA pool anyone starts is shown at once and sits under its 30-box floor for a long time. On preprod the same happens whenever the pool has fewer than two boxes free (TAIL_DRAWS).
1. The quote's collateralReserve comes from collateralPoolShown (lovejoin.ts:3823-3825), which checks only that the pool is shown.
2. Max keeps 1.5 ₳ aside (25 against 27 ₳ on 40 ₳, after rounding), and swaps.maxNoteMixed says '…pays the swap's costs and network fee, its collateral's mix, and what's kept aside for contracts…'.
3. At Review, tailReserve's collateralPool refuses the pool (floorShort, free < TAIL_DRAWS, usableNow). So the funding adds no reserve, the approval shows no collateral's mix, and its Plan brings the 5 ₳ back with the rest.
The 1.5 ₳ just stays in the private balance, but the note told the user their collateral would be mixed.

**Evidence.** Code: sessions.ts:1541 sets the reserve from collateralPoolShown alone; lovejoin.ts:3823-3825 checks shown only, against collateralPool (:3812-3816: floorShort, TAIL_DRAWS); Swaps.tsx:1087 is the note. Lovejoin.tsx's tailReserveOf checks others ≥ floor, free ≥ 2 and unusable from its own read.

Two throwaway tests, both deleted, both on a 5 ₳ pool holding one stranger's box:
- privacy-words' test 3, balance 1,000 ₳: quote.collateralReserve was '1500000', and outBuild's summary.collateralReserve was undefined.
- screens-states': quote.collateralReserve '1500000'; outBuild gives no collateralReserve; maxAdaIn gives 25 ₳ with it and 27 ₳ without. 'AssertionError: Max should keep aside only what the approval then funds: expected '1500000' to be undefined'.

The lenses disagree on the fix. privacy-words keeps the aside (the private default) and hedges the words. screens-states drops the reserve from Max where the pool's state isn't known.

**Concerns.** sc-o-1's call 2 (a Claude call, not an owner's) and 323-worker#0's form half. Call 2 covers the money (Max 1.5 ₳ short), not these words. It also disagrees with sc-lj-1's tailReserveOf rule for the same pool. R3-25 is a different defect in the same notes.

**Suggested fix.** Decide the quote's reserve by tailReserveOf's rule, from what the worker last read, asking nobody: the network's floor against the last kept listing or the rooms cache, free boxes, unusable. Where that isn't known, either keep the aside and word the note as a possibility ('…what its collateral's mix may take'), as privacy-words suggests, or leave the reserve out of Max and 'its collateral's mix' out of the note, as screens-states suggests. No refusal.

**Skeptic 1 (held, low).** Reproduced on the current tree with real WebAssembly.

**The gap:**
- The swap quote sets `collateralReserve` when the 5 ₳ pool is shown and nothing else (`collateralPoolShown`).
- The funding adds the reserve only through `tailReserve` → `collateralPool`, which also checks `usableNow`, the floor and the free boxes (at least TAIL_DRAWS = 2).
- Where the pool is shown but `collateralPool` refuses it, Max keeps 1.5 ₳ aside: 25 ₳ against 27 ₳ on 40 ₳, after rounding.
- The note at Max is `swaps.maxNoteMixed` ("…pays the swap's costs and network fee, its collateral's mix…").
- `outBuild` then funds no reserve: its first payment is exactly the quote's fund.

**Why low, not medium:**
- The approval keys everything on `summary.collateralReserve` (`collateralMixed`). The user sees no mix cost row, and a Plan line without "its 5 ₳ collateral", before signing.
- Nothing is lost: the 1.5 ₳ stays in the private balance.
- What stays wrong: words on the form that mildly mislead about a privacy step, and Max sitting 2 ₳ under what the funding takes.

**When it happens:**
- Mainnet today: never. `lovejoin-pools.json` bundles no mainnet pool.
- Mainnet later: as soon as anyone starts a 5 ₳ ADA pool. It's shown at once (no crowd threshold in the shown rule) and sits under its floor of 30.
  - A launch puts no boxes in, and Bootstrap is offered, never forced.
  - A launcher's own boxes never count as others for that launcher, so their wallet stays in this state longest.
- Preprod: whenever its bundled 5 ₳ pool has fewer than 2 free boxes.

**Disagreements:**
- The money half is sc-o-1's call 2, a Claude call listed under "calls the owner might overturn", not an owner call in HANDOFF.md. The words aren't covered by it.
- It disagrees with sc-lj-1's `tailReserveOf` (Lovejoin.tsx:317-326). The Mix form filters the same reserve by its page's pool read: `unusable`, `others < floor`, `free < COLLATERAL_MIX_DRAWS`. The swap form doesn't.

*Its fix:* Keep Max's aside where the pool's state is unknown: it's the private default. Dropping the reserve from Max, as screens-states suggests, would lose the mix even where the pool takes it, because at that amount `orWithoutReserve` falls back to building the funding without the reserve. No refusal.

1. **Drop the reserve only where the worker already knows, with no request, that the pool can't take it.** Make the quote's check (`collateralPoolShown`, or a sibling of it) return false in either case:
   - The data layer's last crowds (`private-index` `crowdsOf(network)`, mainnet) count the 5 ₳ pool's boxes under `NETWORKS[network].lovejoin.poolFloor`. Boxes are at least others, so under the floor is certain.
   - `roomsRead` within `POOL_ROOM_MS` shows `others < floor` or `free < TAIL_DRAWS`.

   That covers mainnet's realistic case, a new pool under its floor, and agrees with `tailReserveOf`'s rule.
2. **Elsewhere, word the note as a possibility, in one short line.** For example, `swaps.maxNoteMixed`: "Max is {{max}} ₳. The other {{aside}} ₳ pays the swap's costs and network fee, what its collateral's mix may take, and what's kept aside for contracts, which comes back." Change es and ja to match; their back-translation goes to round 4.
3. **Test it.** Use preprod's 5 ₳ pool with one stranger's box:
   - With the rooms read primed, `quote.collateralReserve` is undefined and Max equals `maxAdaIn` without the reserve.
   - Unprimed, the note uses the hedged wording.
   - The existing two-box test still funds 1.5 ₳.

## R3-12

**low** (found as low) · lenses: screens-states · `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx:751`

**Max pressed before any quote leaves the collateral's reserve out, so the swap goes without its collateral's mix, unsaid**

**Scenario.** The swap form opens. The user picks MIN and presses Max first, the usual first press. `quoted` is set only after a quote, and a quote needs an amount, so Max is worked out with no quote: on 24.5 ₳ it's 24.5 − 6 − 5 − 2 = 11 ₳ (USUAL_COSTS, no reserve). The quote for 11 ₳ names collateralReserve 1.5 ₳, so Max becomes 10 ₳. The typed 11 ₳ is no longer Max, and the Max note (raw === max) goes. Review funds the 11 ₳ without the reserve (orWithoutReserve), so the 5 ₳ comes back unmixed, tied to the session, and neither form nor approval says the mix was left out. Rounding Max to whole ₳ leaves under 1 ₳, never the reserve. So this happens on nearly every first press where the swap's costs are the usual 6 ₳.

**Evidence.** Code: Swaps.tsx:751 works max out from quoted?.quote; swap.ts:134 adds the reserve only from a quote. sc-o-1's test (collateral-reserve-review-fixes.test.ts:274) works Max out after a quote only.

Throwaway test (real WebAssembly, the recorded Minswap estimate): the first Max is 11 ₳, and Max after the quote is 10 ₳. quote.collateralReserve is '1500000', and outBuild of the 11 ₳ quote builds. Asserting it's funded with the reserve fails: 'AssertionError: Max's amount should be funded with the collateral's mix: expected undefined to be '1500000''.

The two lenses disagree on what then happens to the 5 ₳. R3-9 shows that a funding without the reserve can still have its collateral mixed at the return, under giveme.my, when what's left there pays for the tail. So this swap's 5 ₳ either comes back unmixed (as here) or is mixed unannounced (as in R3-9), depending on what the swap leaves. Either way, neither the form nor the approval says so. sc-o-1's call 1 put only an amount typed past Max to the owner; this reaches the fallback on Max's first press.

**Concerns.** sc-o-1: 323-worker#0 (form half). Max keeps the most private way aside only when a quote happened to come first.

**Suggested fix.** Remember that Max was pressed (cleared when the user types), and fill the new Max when max changes. Or ask on open whether a 5 ₳ pool is shown (as the quote's collateralPoolShown does, asking nobody), and keep the reserve aside in the no-quote Max too. Either way, settle R3-11 alongside, so the aside follows a pool that takes the collateral.

**Skeptic 1 (held, low).** The finding holds; I couldn't refute it. A throwaway test with the real WebAssembly, preprod's bundled 5 ₳ pool holding two strangers' boxes, and the recorded Minswap estimate followed every step. Max pressed before any quote gives 11 ₳ on 24.5 ₳. The quote for 11 ₳ names collateralReserve 1.5 ₳, so Max drops to 10 ₳ and the Max note (raw === max) goes. Review funds the 11 ₳ without the reserve. At the return after the order fills, that session builds no collateral tail, so the 5 ₳ comes back directly, unmixed; the 10 ₳ funding does mix it. So sc-o-1's "Max keeps the reserve aside, the most private way as the default" works only when a quote came first.

It stays low, not medium or high:
- 323-worker#0's own defect, Review refusing Max, is fixed: the 11 ₳ is funded.
- The approval doesn't hide where the 5 ₳ goes. Its Plan says "The proceeds and everything left, directly", and the privacy callout says the account "links to Minswap and back". What nobody says is that the mix was dropped, or that 1 ₳ less would have kept it.
- Nothing is lost or locked, and pressing Max again after the quote gives the private amount.
- It's dormant on mainnet: no bundled pools and a floor of 30, so tailReserve adds no reserve there whatever Max says. It's live on preprod (floor 0).

One correction to the finding: with the usual 6 ₳ of costs it happens on every first press, not nearly every. After the reserve, the room left is 0.5 ₳ plus under 1 ₳ of rounding, always short of the fee and the change's least (about 1.69 ₳). On mainnet, if real costs come under about 4.8 ₳, it would happen only sometimes. The other half of the finding's hedge (R3-9, mixed unannounced) doesn't arise on this fill. It arises only where more is left at the account, such as after a Stop or a refund.

*Its fix:* A UI-only fix in NewSwap (Swaps.tsx). Concerns sc-o-1, 323-worker#0's form half.
- Remember that Max set the amount: a `maxed` flag, set by the Max button and cleared by typing, Half, flip and a change of the pay token.
- While it's set and the token paid is ADA, fill the new Max whenever it drops below the amount: `useEffect(() => { if (maxed && pay.id === "lovelace" && BigInt(max) < BigInt(raw ?? "0")) fill(max); }, [maxed, max])`.
- Follow it down only, so a fee that scales with the amount can't make it flip back and forth. The 10 ₳ quote then settles it, and the Max note (maxNoteMixed) shows.

Alternatively, ask the worker once when the form opens, asking nobody, for the reserve the quote would name, and pass it to maxAdaIn while there's no quote. Settle R3-11 in the same change, so that rule matches what tailReserve's collateralPool will take (floor, free boxes, usable). Otherwise the first-press Max keeps 1.5 ₳ aside needlessly on mainnet once a 5 ₳ pool is shown but under its floor.

Neither option refuses anything or adds text.

Test: a worker-level case beside collateral-reserve-review-fixes.test.ts:274.
- Hold 24.5 ₳.
- Work out the no-quote Max, then quote it.
- Apply the follow-down rule as a pure helper exported from ui/swap.ts.
- Assert that the amount Review is asked for is funded with collateralReserve 1500000.

## R3-14

**low** (found as low) · lenses: screens-states · `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:340`

**The public Mix form's cap in a token pool still offers boxes the build refuses**

**Scenario.** PR #163's LJTEST pool. The public account holds 9 ₳ of ADA alone and one 5.4 ₳ UTxO holding three boxes' worth of LJTEST. publicMixAda gives 14.4 ₳, at least two boxes' funding of 14.3 ₳, so the stepper offers 2, and Review's build refuses it. The chain returns the token the boxes don't take in an output of its own, whose least ADA (about 1.2 ₳) it adds to what's needed. It also takes only as many token UTxOs as hold enough, where publicMixAda counts every pool-token UTxO's ADA (wasm/src/lovejoin.rs:2104-2160). So whenever the user holds more of the token than the boxes take (the usual case), the form offers what the build refuses. That's the class 321-lj-screens#1 fixed for rewards and other tokens.

**Evidence.** Throwaway test (real WebAssembly): t.coins.lists gives [10338.5 ₳ + 2 tokens, 5.4 ₳ + LJTEST, 5 ₳ collateral, 3 ₳, 3 ₳ + 4 tokens, 2 ₳ × 3]. held is 14.4 ₳ and mixMost gives adaMost 2. lj.publicBuild('preprod', 2, { pool }) throws: 'Error: Your public account's ADA doesn't pay for 2 boxes of 2 ₳ and their mixes: that takes 11 ₳ in UTxOs of ADA alone, besides the collateral'. The same fix's words are R3-26 and R3-27, and its wiring (Lovejoin.tsx:2554) is in R3-20's list.

**Concerns.** sc-lj-1: 321-lj-screens#1, incomplete for token pools.

**Suggested fix.** Count only the ADA of the token UTxOs the chain would pick (the fewest that hold enough, most first), less an output's least where they hold more than the boxes take or other tokens. Or let WebAssembly give the public cap, as lovejoinBootstrapMost gives the private Bootstrap's.

**Skeptic 1 (held, low).** The finding holds. In a token pool, the public Mix form's stepper offers a box count that Review's build then refuses. There are two causes, both in the build's pick: (1) the tokens the boxes don't take come back in an output of their own, and the build adds that output's least ADA (about 1.2 ₳) to what it needs, but the form doesn't count it; (2) the build takes only the fewest pool-token UTxOs that hold enough, most first, while publicMixAda counts every pool-token UTxO's ADA.

It concerns sc-lj-1's fix of 321-lj-screens#1, and that fix is incomplete rather than a regression. The build's pick and its kept-token reserve were already in place at 499768f6; the fix rounds only made the sum checked. Before the fix the form used Home's figure, which counts even more ADA. The fixer's report says publicMixAda "is WebAssembly's buildLovejoinFromAccount rule", and so does the code comment ("as WebAssembly's chain spends it"). It isn't, and the fix's test checks the sum alone, never a build in a token pool.

Sharpened:
- The finding's "whenever the user holds more of the token than the boxes take (the usual case)" overstates cause 1. It only bites at the top of the stepper, when the balance is within the kept output's least (about 1.2 ₳) of the next box. One box costs 6.4 ₳ at depth 2, so roughly one balance in five.
- Cause 2 has no bound: it over-counts the whole ADA of every pool-token UTxO the build doesn't pick.
- The build's own pick is not monotone (case D: 1 and 3 boxes build, 2 is refused). So the finding's first fix, a copy of the pick in TypeScript, can't give one correct cap.

Why low: no money or privacy is at stake and nothing is signed. The refusal is honest and names the ADA alone it needs, and one box fewer builds. The cap note ("pays for 2 boxes at most") and the held figure mislead mildly. This is the same class and severity as 321-lj-screens#1.

*Its fix:* 1. Fix the build first (wasm/src/lovejoin.rs chain_from_account_at). Once the token pick holds enough, if ADA-only UTxOs still don't cover `needed`, take further pool-token UTxOs, most ADA first, before refusing. Their tokens join `kept`, so recompute its least ADA. This removes a refusal the chain wouldn't make and makes larger counts never easier to build than smaller ones. It touches token pools only, so the classic pool's transactions stay byte-identical, and token-pool builds are new in 1.6.0.
2. Give the form an exact cap from WebAssembly, as lovejoinBootstrapMost does for the private Bootstrap: a lovejoinPublicMost that runs the same pick and `needed` (minimum_address_payment included) for 1 to 10 boxes over the account's spendable UTxOs and params. The page uses it instead of publicMixAda's sum in mixMost and cantAffordPublic. No new UI text.
3. Correct publicMixAda's comment, and HeldOnSide's figure if it stays.
4. Add a real-WebAssembly test that, in a token pool where the account holds more token than the boxes take, the stepper's most builds and most+1 doesn't.

The lead rebuilds pkg/.

## R3-15

**low** (found as low) · lenses: data-layer · `seedelf-data/api/src/lovejoin/routes.rs:242`

**A failed or slow stable-cursor read answers 503 though the cursor's own list and LATEST are kept**

**Scenario.** A block arrives while both private connections are busy, for example while the pools task works out a new cursor's list beside a tokens/since or classic since read. The first lovejoin/pools requests at that tip must read the stable cursor, because 317-data#2 keeps it only once a read succeeds. The read waits out the pool's 2 s WAIT and fails with Unavailable, or runs past the request's 5 s deadline. The `?` at line 244 then answers 503 before the route looks at anything it keeps. The cursor moves only every 200 slots, so at about 9 of 10 tips the list for that very cursor is kept (for an hour), and LATEST is kept too. The wallet takes the 503 as TokensDown (private-index.ts:341). Discovery then drops the hub's crowd counts (lovejoin-pools.ts:426), look() scans Koios's holder when the Lovejoin page opens, and the data layer isn't asked again for 5 minutes.

**Evidence.** Code: routes.rs:242-244 (timeout_at(deadline, state.stable_cursor(..)) ... ?), state.rs:307-328, and chain.rs block_before (the private pool's get(), WAIT 2 s, which becomes ApiError::Unavailable). The fix's own comment says the last list 'is a better answer than a 503 that sends the wallet to Koios', but it applies that only to the task. Two throwaway unit tests in a copy of seedelf-data (since deleted) both fail on HEAD:
1. zz_review_a_failed_cursor_read_answers_503_with_its_list_kept: tip aa works out cursor C's list, then the same cursor's read fails at tip bb. Output: 'answered Err(Unavailable(no connection within 2 s)) with the cursor's list and LATEST kept'.
2. zz_review_a_slow_cursor_read_answers_503_with_latest_kept, on a paused clock with a 6 s read. Output: 'answered Err(Unavailable(timed out)) with LATEST kept'.

**Concerns.** 317-data#0 (phase A): its fix answers LATEST when the list fails, not when the cursor read before it fails. 317-data#2 (phase A): its skeptic named this side effect and expected caching to remove it, but caching removes it only after the first successful read at each tip.

**Suggested fix.** On the cursor read's error or timeout, answer state.kept(LATEST) when there is one, with the same throttled warn as a failed list; otherwise return the error. Keep the two tests above. This refuses nothing, and before the first list the route still answers 503.

**Skeptic 1 (held, low).** The finding holds, and I reproduced it on the current tree twice. Through the pools_with seam, a failed cursor read and a slow one both answer Err(Unavailable), while the cursor's own list and LATEST are kept. Through the real private pool (2 connections, 2 s WAIT) against a throwaway local Postgres, the route answered HTTP 503 after 2.002 s with both still kept.

The fix answers LATEST instead of a 503 only for the list task. The `?` on the cursor read at routes.rs:244 returns before anything kept is looked at.

This is pre-existing rather than a regression. At 499768f6 the same `?` sat on a stable() read made at every request. 317-data#2's cache per tip narrows the gap only to the first request(s) at each tip. The wallet asks lovejoin/pools at most once per 5 minutes per worker, and the tip moves about every 20 s. Under light traffic, nearly every request is the first at its tip, so the narrowing is small. 317-data#2's skeptic expected the cache to remove this side effect, and it doesn't.

Severity is low (an edge case). It needs both private connections held for more than 2 s at that moment: the list task's db::ever, the hourly holder read, a since from an old cursor, or a query a timed-out request left running (Fast recycling, no statement_timeout).

What happens then:
- the hub's crowd line drops to boxes alone for 5 minutes;
- the Lovejoin page scans Koios's holder when it opens;
- the data layer isn't asked again for 5 minutes.

No money, signature or flow is affected. The Koios fallback is the documented one, so there's no new privacy tie. It isn't medium: 317-data#0's two named parts (the 10 s double wait, and the task's error passed on) and 317-data#2's query on every request are all fixed.

*Its fix:* In `pools_with` (`seedelf-data/api/src/lovejoin/routes.rs`), drop the `?` on the cursor read. Send its error into the existing `failed` value, and let it fall through to the existing `(state.kept(LATEST), failed)` match.

```rust
let read = tokio::time::timeout_at(deadline, state.stable_cursor(tip, stable)).await
    .unwrap_or_else(|_| Err(ApiError::Unavailable(anyhow::anyhow!("timed out"))));
let failed = match read {
    Err(error) => Some(error),
    Ok((cursor, block)) => {
        let key = format!("lovejoin/pools/{cursor}");
        if let Some(answer) = state.kept(&key) { return Ok(answer); }
        match state.start(&key) { /* the task, as now */ }
    }
};
// then the existing LATEST / throttled-warn / error match, unchanged
```

What it changes:
- A failed or slow cursor read answers LATEST when there is one, with the same throttled warn.
- Before the first list it still returns the error (503), as now.
- It refuses nothing, and LATEST was already the answer when the list task fails or is slow, so it adds no staleness the route doesn't already serve.

Keep two tests in routes.rs: a cursor read that fails at a second tip with LATEST kept, and a 6 s cursor read on a paused clock. Both fail on HEAD and pass with this change.

## R3-16

**low** (found as low) · lenses: data-layer · `seedelf-data/api/src/lovejoin/db.rs:95`

**GATHERED's slot bound, which keeps a read on from skipping new pools, has no test**

**Scenario.** Suppose `where b.slot_no <= $2` is lost from GATHERED, for example in a refactor that shares its CTE with found_sql. Its max then covers holder outputs above the read's block, up to db-sync's tip. Every later read then starts above candidates launched in the last 200 to 400 slots. Each new pool is listed only at the first hourly read from the start after it's that old, so every mainnet wallet sees new pools up to an hour late, with no error. Nothing catches it. The offline suite tests found_sql's text, and discovery only through a model (read_among). The live every_candidate_at_the_holder_is_checked compares candidates, and the mainnet holder has none until a pool launches.

**Evidence.** Mutation in a copy, `where b.slot_no <= $2` changed to `... or true`: all 123 offline tests pass (103 lib, 5 edge, 12 public_grammar, 3 scripted_kupo). The same mutation through the real db::found, against a throwaway Postgres 16 with db-sync's tables and domains: Gathered jumps to the candidate at slot 500 when reading at 250. Output: 'assertion left == right failed: Gathered { id: 6, tx: 5 } left: 6 right: 3', so later reads would never gather the candidates at slots 300 and 500. Unmutated, the same scratch test passes.

**Concerns.** 321-lj-rust-data#0 (phase A).

**Suggested fix.** Add a text test beside a_read_on_gathers_only_the_outputs_above_its_ids: GATHERED's outer where holds `b.slot_no <= $2`, and its CTE's bounds are found_sql's (`o.id > $3 and o.tx_id > $4`). Or build both queries from one CTE string so the two can't drift.

**Skeptic 1 (held, low).** The finding holds; I reproduced it on the current tree (HEAD e43eef7f, seedelf-data clean). GATHERED's outer `where b.slot_no <= $2` (seedelf-data/api/src/lovejoin/db.rs:95) is load-bearing, and no offline test touches GATHERED's text or the real SQL.

- The only SQL text test, `a_read_on_gathers_only_the_outputs_above_its_ids` (db.rs:330), reads found_sql alone.
- Discovery's tests (discovery.rs:384-517) go through the `read_among` model, which applies its own slot filter (`id * 20 <= at`).
- The live test is `#[ignore]`d. CI runs only `cargo test --locked`, with no Postgres service (.github/workflows/data-layer.yml:58). Even when run, the live test catches this only if a candidate landed at the holder in the 30 days before the run. That is slightly wider than the finding's "has none until a pool launches", but the conclusion is the same.

The clause matters in production. Every caller of `shown` passes a stable block's slot, which lags db-sync's tip:
- routes.rs:159, 301 pass the stable cursor's block;
- routes.rs:356 passes an older `from` block;
- cursor.rs:65 is `stable_slot = ((tip-200)/200)*200`, so the lag is 200 to 399 slots, as the finding says.

Without the clause, `Gathered` (and so `Seen.high`, discovery.rs:181-185 and 196) reaches past every holder output up to the tip. Each read on then skips candidates in that window until the hourly read from the start (READ_AGAIN, discovery.rs:34). New token pools would reach wallets up to an hour late, with no error.

Severity: the brief lists "a missing test for a guard" as low. Nothing is broken today, and the regression it guards against costs a listing delay, not money or privacy. Low stands.

*Its fix:* Add one text test in db.rs's tests module, beside `a_read_on_gathers_only_the_outputs_above_its_ids`. It's the house pattern, since CI has no Postgres:

```rust
#[test]
fn what_a_read_gathered_is_bounded_by_its_block() {
    let (gather, rest) = GATHERED.split_at(GATHERED.find(") select").expect("a gather"));
    assert!(gather.contains("o.id > $3") && gather.contains("o.tx_id > $4"), "{gather}");
    assert!(rest.trim_end().ends_with("where b.slot_no <= $2"), "{rest}");
}
```

It fails without the bound (checked above) and refuses nothing.

A sturdier option: build both queries from one CTE string, with the parameters renumbered so the holder, slot, id and tx are $1-$4 in both and the name is $5. Then the existing test covers both, and the two can't drift. That option changes code, not just tests.

## R3-17

**low** (found as low) · lenses: lovejoin-records · `seedelf-platform/seedelf-web-wallet/extension/tests/lovejoin-1-5-0.test.ts:696`

**The 1.5.0 gate's head-start case compares no Koios requests**

**Scenario.** A change makes the wallet ask Koios something more, such as a request naming the wallet's own boxes, but only when a token pool is in the read set. All four gate cases still pass: the two original cases read the classic pool alone, and classicAfter deletes every step's `calls` and `restored.calls`. The test claims sends, schedules and the restore, and those are compared. But no case guards what a 1.5.0 vault asks with pools shown, which every preprod wallet has.

**Evidence.** Probe in a copy with the strips taken out. The plans differ only in funding[].collateralReserve/collateralPool (36 each), swap.quote.{ways, values, fund, ifStopped.*} and swap.review.ways, so classicPlans is tight. The after-update trace (36 steps, same count) differs only in calls and status.pools: each credential_utxos names the two head-start mix boxes, status and the restore make one more epoch_params call, and the return makes one more pool read. Every tx_status, tx_info and submittx matched 1.5.0's exactly. Mutation in the copy: ours() sends a utxo_info naming every one of the wallet's boxes whenever a non-classic pool is read. `npx vitest run tests/lovejoin-1-5-0.test.ts` gave 4 of 4 passed, and the probe showed 12 such requests in the head-start replay. R3-18 is a second, separate looseness in the same gate.

**Concerns.** wlj-4 x-compat#2 (the gate's new cases; classicAfter).

**Suggested fix.** Normalize the requests instead of deleting them: drop the two head-start mix-box credentials from each credential_utxos, drop epoch_params, and drop the return's extra read of the pools alone. Then compare what's left with 1.5.0's exactly, step by step. Today that's every tx_status, tx_info, utxo_info, submittx and read of the wallet's own credentials, and it matches.

**Skeptic 1 (held, low).** Reproduced on the current tree. A request naming every one of the wallet's boxes whenever a token pool is read passes all four gate cases. It passes the rest of the suite too: nothing in 976 suites and 2,765 tests catches it.

Why it slips:
- The head-start case deletes every step's `calls` and `restored.calls`.
- The original unwired case compares calls, but it reads the classic pool alone.
- `plans()` records no calls.

One correction to the title. The gate isn't blind to requests: a request added to runs that asked nothing in 1.5.0 grows the trace and fails it. What slips is anything asked beside a request a step already makes, and every pool read is such a request.

Severity is low, a missing test for a guard:
- Today's requests match 1.5.0's exactly once normalized, so nothing behaves wrongly now.
- The fix did what x-compat#2's own suggestion asked ("comparing the trace without calls"), so it isn't a fix that misses its finding.
- It isn't a nit either: what slips would be an untold privacy tie on every preprod wallet, and no other test catches it.

*Its fix:* A test-only change in `lovejoin-1-5-0.test.ts`: normalize `calls` in `classicAfter` instead of deleting them.

1. Derive the token pools' mix boxes from the bundled head start with `wasm.lovejoinVerifyPool`, so the release's refresh of `lovejoin-pools.json` carries over.
2. For each step and for `restored.calls`:
   - drop `epoch_params` (or only the extra one in status and in the restore);
   - remove the token mix boxes from each `credential_utxos`;
   - in "bring session 0 back", drop the `credential_utxos` that named a token mix box (the collateral's 5 ₳ pool read).
3. Compare the rest exactly, step by step, and keep the existing strip of `pools`.

Today that gives 0 differences, and the `ours()` mutation gives 12.

## R3-18

**low** (found as low) · lenses: tests-mutation · `seedelf-platform/seedelf-web-wallet/extension/tests/lovejoin-1-5-0.test.ts:229`

**The 1.5.0 gate lets a classic funding plan drift up to 0.5%, and x-compat#2's new case inherits it**

**Scenario.** MEASURED includes 'lovelace', so nearly() compares lovejoin-funding's planned lovelace within MEASURED_SLACK (0.5%), at lines 729 and 745. A change that makes the classic pool's funding plan dearer by less than 0.5% passes all four gate cases. That's up to 4.48 ₳ on the gate's own largest recorded plan (895.5 ₳: 40 boxes at depth 3). The owner's rule is byte-identical to 1.5.0. Several fixes cite the gate as pinning these plans: bootstrap's 'never in funding_for, which the 1.5.0 gate pins', and reserve's funding() change.

**Evidence.** - xc1, +1 lovelace on every classic funding when a 5 ₳ pool is shown: 4 of 4 pass.
- gp1, every classic funding plan ×1.004: 4 of 4 pass.
- gp2, an exact check of funding[*].funding.lovelace added to the original plans case: passes on HEAD. These figures are planned, not measured.
- gp3, the same exact check under gp1: fails with 'expected [ Array(84) ] to deeply equal [ Array(84) ]'.
- wlj-4's own +1.5 ₳ mutation is caught: it exceeds the slack.
R3-17 is a second, separate looseness in the same gate.

**Concerns.** wlj-4: x-compat#2, whose report says 'every other figure … matched exactly'. Pre-existing in chunk 34's gate design.

**Suggested fix.** Keep MEASURED_SLACK for what chains measure (fee, fees, outputs' measured), and compare plan figures (lovejoin-funding's lovelace) exactly. gp2 shows that passes today. Test only.

**Skeptic 1 (held, low).** The finding holds. I reproduced it on the current tree, both in a throwaway test and with full-gate mutation runs in a copy.

**Why the slack applies to the funding plan.** `nearly()` gives the slack to any field named `lovelace`, whether the figure is planned or measured:
- `MEASURED` (line 229) includes "lovelace".
- The test at lines 234-236 keys on the field's name, not on what the figure is.

The funding grid's `lovelace` is planned arithmetic, nothing measured: `DEPOSIT_RESERVE + boxes × (denom + mixes × mix_fee_estimate)`. So its 84 values get 0.5% slack (at least 1 lovelace) they don't need. That contradicts the gate's own header ("plans … to be met exactly", lines 12-14) and its comment at lines 222-228.

**Results.**
- Each small drift of the classic plan passes all four gate cases: ×1.004, +10,000 lovelace, +1 everywhere, and xc1 (+1 only where a 5 ₳ pool is shown).
- A +1.5 ₳ drift fails both plans cases, so the gate isn't vacuous.
- On HEAD, an exact compare of the funding grid passes in both wirings.
- The line has been there since chunk 34 (fa36ec995, before 499768f6). wlj-4's new case at line 745 inherits it, so x-compat#2's case can't catch a sub-0.5% drift that only appears with pools shown, which is the class that case exists for.

**Two sharpenings.**
1. **The gate misses it, but the suite catches a uniform drift.** gp1's ×1.004 is caught by `lovejoin-planner.test.ts:763-764`, which pins 1 box at depth 2 exactly. What escapes the gate and the rest of the suite (as far as I ran it) is a drift that misses that one pinned point. Under xc1, the planner pin passes, and so do the four collateral-pool test files and six Lovejoin files (55 and 248 tests).
2. **The suggested fix, read literally, breaks the gate.** "Keep slack for fee, fees, measured" drops `lovelace` from the set. But `returns[*].review.lovelace` is measured too: it's what a return's fees leave. With `lovelace` removed, both plans cases fail on HEAD.

**Severity: low.** It's a missing exact test in the guard for the owner's byte-identical rule. Nothing drifts today, and no money is at risk.

*Its fix:* Test only, in `tests/lovejoin-1-5-0.test.ts`.

Keep `MEASURED` as it is: a return's review `lovelace` is measured and needs the slack. Instead, compare the all-planned funding grid exactly, beside `nearly()`:
- **Line 729:** `const got = (await plans()) as Plans; expect(got.funding).toEqual((recorded.plans as Plans).funding); expect(nearly(got, recorded.plans)).toEqual([]);`
- **Line 745:** add `expect((classicPlans(got) as Plans).funding).toEqual((classicPlans(recorded.plans) as Plans).funding);` before its `nearly()`.

An equivalent alternative is to give `nearly()` no slack under paths starting `.funding`.

Both pass on HEAD, and both catch every small drift tried here (×1.004, +10,000, +1, xc1). The second line is what catches xc1.

Fix the comment at lines 222-228 so it names the `lovelace` that really is measured (a return's review). wlj-4's "matched exactly" line can be corrected in the docs round.

## R3-19

**low** (found as low) · lenses: tests-mutation · `seedelf-platform/seedelf-web-wallet/extension/src/background/runs.ts:83`

**runs.ts: four of the six new trap rethrows (runAll, pumpPublic, parts.pump, returning) have no test**

**Scenario.** Any of these four catches can go back to `() => false` / `() => true` with every test green: `ctx.sessions.runAll(...).catch(unlessTrap(false))` (:83), `pumpPublic` (:86), `parts.pump` (:91) and `returning` (:101). A trap from that step is then swallowed again, and the run goes on on a broken instance, which locks only at some later call. parts.pump really rethrows traps (parts.ts:465, 520, 648), so its catch is live. sessions.runAll catches its own steps, so that one matters least.

**Evidence.** - Mutations wr1 to wr4: run-traps-review-fixes plus runs.test.ts pass 12 of 12 under each.
- Only withdrawDue's and pending.watch's catches are tested: wr5 fails with 'watch: expected "vi.fn()" to be called 1 times, but got 0 times'.
- A throwaway tests/zz-review-tests-mutation-1.test.ts (in the copy, since deleted) has 4 cases. Each throws a WebAssembly.RuntimeError from one step on mainnet, then expects wallet.trapped() once and alarm.stop(). It passes on HEAD and fails under each of wr1 to wr4: 'expected "vi.fn()" to be called 1 times, but got 0 times'.
Not L3: L3's 'progress()'s pumpPublic catch' is another catch that still swallows traps. These runs.ts catches do rethrow; only their tests are missing.

**Concerns.** w-left: 314-wasm#0's defence in depth (runs.ts unlessTrap). Its test name, 'locks the wallet … and runs nothing more on the broken instance', covers withdrawDue and the pending watch only.

**Suggested fix.** Add the four steps to run-traps-review-fixes' 'a trap under the worker's runs' loop (its runner() already stubs each step), as the throwaway did. Test only.

**Skeptic 1 (held, low).** The missing tests are real, and the gap reproduces exactly. Revert any of runs.ts's four catches (runAll :83, pumpPublic :86, parts.pump :91, returning :101) to a plain catch-all and every test that can reach runs.ts stays green. A 4-case throwaway test catches each revert. But the finding overstates how live these guards are: on today's tree no raw trap can reach any of the four. So a silent revert changes nothing yet, and the test only protects against later changes. By the brief that is "a missing test for a guard": low, at the bottom of low. A few of the finding's details are wrong (see evidence), but none of them refutes the gap.

*Its fix:* Test only, in tests/run-traps-review-fixes.test.ts, describe "a trap under the worker's runs":
1. Add `parts: { pump: vi.fn(async () => false) }` to runner().
2. Loop `at` over all six steps: runAll, pumpPublic, watch, parts.pump, withdrawDue, returning.
3. For the second loop's steps (withdrawDue, returning), expect runAll called on both networks and withdrawDue on mainnet only.
4. For the first loop's steps, expect runAll on mainnet only and no withdrawDue.
5. Keep the trapped()-once and alarm-off checks.
6. Mutation-check each of the four hunks: each revert must fail its own case.

No source change, no new keys, and no owner rule is touched. When the docs round runs, correct w-left's line "each hunk was mutation-checked".

## R3-20

**low** (found as low) · lenses: tests-mutation · `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Collateral.tsx:98`

**Screen fixes proven only through extracted helpers: their wiring can be reverted with every Vitest test green**

**Scenario.** Each fixer extracted the rule and tested it, and each rule's mutation fails. But no Vitest test exercises the line that makes the screen use the rule (there's no DOM), so it can regress silently. Most fixers disclosed this. The worst case is the Lovejoin form's tail. Reverted, the form's figures go 1.5 ₳ off the review, and in a window of about 1.5 ₳ the stepper offers a count whose funding quietly falls back without the collateral's mix.

**Evidence.** Each revert below left its suites green:
- Collateral.tsx:98, `const inPlace = false && !!onSent` (309#0): 11 files, 287 tests pass. Only the new e2e (not run here) drives it, and sc-o-2 says HEAD failed that e2e 'in nearly every run'.
- Home.tsx:367-368, the `unwatched` wiring put back to the old line (309#0's two-window hardening): 287 pass. No test at any level.
- Lovejoin.tsx:2558, `tail = 0n` (320-screens#2, 321-lj-screens#3, 323-worker#0's form half): 8 files, 206 pass.
- Lovejoin.tsx:2554, the public side back on Home's figure (321-lj-screens#1): 206 pass.
- Lovejoin.tsx:2680, againAt taking the width before the rebuild (320-screens#4): 206 pass.
- BringAllBack.tsx:147, the ask bypassing follow.current.press (321-lj-screens#0): 5 files, 166 pass.
- LockCountdown.tsx:86, never asking parts-waiting (gap-3#6): 4 files, 116 pass.
- Swaps.tsx:905, `rebuilding={false && rebuilding}` (320-screens#3): 11 files, 218 pass.
Tension with R3-7, which argues the tail at Lovejoin.tsx:2558 shouldn't set the cap or the refusal at all. So a test for that wiring should pin the figures and the review's totals, not the cap. R3-1 is the same class, rated medium for the site funding review's money total and .privacy. note.

**Concerns.** sc-o-2: 309#0. sc-lj-1: 320-screens#2, 321-lj-screens#1, #3, 320-screens#4, 323-worker#0's form half. sc-lj-2: 321-lj-screens#0. wss-1: gap-3#6. sc-o-1: 320-screens#3.

**Suggested fix.** Add a small jsdom (or react-test-renderer) harness for these few components, covering open in place, press and rebuild. Or add one e2e case for the Lovejoin form with a 5 ₳ pool shown, and one for the countdown's parts line. No code change.

**Skeptic 1 (held, low).** The finding holds, and it holds more strongly than the review showed. The review ran a few named test files per mutation. I ran the whole Vitest suite with all eight wiring reverts applied at once, in both of CI's modes, and nothing failed except L5's known pair. Forms of the reverts that pass the typecheck exist for all eight, so CI's Vitest and typecheck steps both stay green. HEAD behaves correctly: the throwaway test confirms three of the wirings work today. So this is a missing test with no defect, which is "a missing test for a guard": low.

Three corrections to the finding:
- **Two mutation forms fail the typecheck as written.** The review's lj1a and lj1b forms fail `tsc` (and so CI's typecheck). Forms that pass it exist, so the claim survives.
- **A DOM isn't needed.** The house's existing `vi.mock("react")` seam can drive the wiring in Vitest, so a new jsdom or react-test-renderer dependency isn't required.
- **BringAllBack.tsx:147 probably has some e2e cover**, as Collateral.tsx:98 does. Neither is fully deterministic.

*Its fix:* No code change. Add one Vitest file built on the house's `vi.mock("react")` seam (as lovejoin-launch-review-fixes uses it), with no new devDependency:
- Run useEffect and useLayoutEffect during `renderToStaticMarkup`: deps-aware, and limited to the effects of the component under test.
- Mock `../src/ui/background`'s `call` to answer with synchronous thenables.

The cases:
1. **Collateral:** opened with `onSent` while its payment waits, it never asks pending-tx; from Settings, it does.
2. **LockCountdown:** it asks parts-waiting, and shows `data-parts-waiting="true"` and the parts line.
3. **PoolPage, private side:** with a 5 ₳ pool shown that takes the reserve, it shows the review's figures (16.8 ₳ in, the reserve row, 22.05 ₳ total). Pin the figures and totals, not the cap, per R3-7.
4. **PoolPage, public side:** with the source seeded to public and an account UTxO holding other tokens, the held line shows `publicMixAda`'s figure.
5. **Swaps:** capture SendButton's props with a mocked SendButton (as that test captures AmountField's `clean`) and assert `rebuilding` reaches it.
6. **The handlers:** capture AgainSwitch's `onFour` and BringAllBackView's `onStop` the same way.
   - A failed rebuild keeps the width.
   - A Stop says no "Done".

Home's two-window watch (367–368) is easier as one e2e case.

## R3-13

**nit** (found as low) · lenses: screens-states · `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx:1366`

**A swap approval whose only part through Lovejoin is its collateral's mix shows that mix's 1.5 ₳ cost with no switch to turn it down**

**Scenario.** A swap whose spare ADA pays for no box, and whose funding pays for none if stopped (a small swap, or token→ADA with small proceeds). Settings are as by default, and a 5 ₳ pool takes the collateral. The approval shows 'Its collateral's mix, about 1.5 ₳' in Costs in all (15% of a 10 ₳ swap), and 'Too little spare ADA for a Lovejoin box, so all but its 5 ₳ collateral comes back at once'. There's no switch, since LovejoinChoice needs `any`, which counts boxes only. Turning the mix down takes Settings, which the note doesn't name, unlike the site funding's note. That goes against private by default with a visible control where it costs fees, and against choices, not links.

**Evidence.** Throwaway render of SwapApproval with sc-o-1's own fixture (funding(true), noBox): the text has the cost row and the no-box line. Asserting a switch fails: 'AssertionError: a costed choice should have its switch: expected '<div class="swap-summary" data-testid…' to contain 'role="switch"''. The rebuild with through: false drops the reserve (outBuild → tailReserve(network, false)), so a switch would work. This is sc-o-1's open call 7 ('Choices-not-links may want one'), not a decided owner's call in HANDOFF.md.

**Concerns.** Pre-existing since #323. sc-o-1's fixes for 323-worker#1 and #6 now put its cost on screen (sc-o-1's call 7).

**Suggested fix.** Show the switch wherever collateralMixed holds, with a one-line note naming the collateral. Off rebuilds with through: false, as the switch does today.

**Skeptic 1 (held, nit).** The trace reproduces the finding through the worker's own output, not only through a hand-made fixture. With default settings and preprod's 5 ₳ pool shown, a small ADA→token swap is funded with the 1.5 ₳ reserve and a `lovejoin` of `boxes: 0` with no `of`, `ifStopped` or `ways`. So `any` is false, and the approval shows "Its collateral's mix, about 1.5 ₳" with no switch and no mention of Settings. A switch would work: built with `through: false` there's no reserve, `outSubmit` records `auto.direct`, and `buildBack` builds no tail.

Four things bring it down from low to nit:
1. **The owner already decided where this control lives.** Asked about a switch for the collateral's mix, the owner answered "its own in Settings" (chunk-34-token-pools.md, Session 10, 2026-10-22), and call 1 there reads it at build time, not at approval. Session 11 added the reserve without moving it.
   - The owner's private-by-default rule says to "add a control to turn it down, and explain the trade-off in Settings or in the flow". That holds: `settings.lovejoin.collateralOn` names the cost.
   - "Choices, not links" is about an alternative offered as a text link under the costs. Nothing is offered here.
   - So the claim that this "goes against private by default … and choices, not links" is overstated.
2. **It's already on the owner's list.** It's word for word sc-o-1's open call 7, and sc-lj-1's call 2 takes the same Settings line for the Mix form.
3. **It can't happen on mainnet in 1.6.0.** Mainnet bundles no pools, and `collateralPool` needs a 5 ₳ pool holding 30 other people's boxes. It's preprod only.
4. **It isn't a regression.** It dates from #323. sc-o-1's 323-worker#1 fix only made the cost visible, and correctly.

The finding's example is also off. A 10 ₳ ADA→token swap does show the switch, because its funding would pay for one box if stopped. The gap covers ADA→token fundings under 15.3 ₳ (one box at depth 2) and token→ADA swaps whose proceeds plus 4 ₳ are under that.

What's left is a small inconsistency:
- the `any` gate's own comment ("Lovejoin would take something … the approval says which way it comes back") stopped covering the collateral's mix with #323;
- the site funding's note names Settings, and this approval doesn't;
- the same mix has a switch on a 10 ₳ swap and none on a 9 ₳ one.

*Its fix:* Don't block 1.6.0 on it. Put it to the owner as sc-o-1's call 7, and build only one of these:

(a) **Keeps the owner's decision that the switch lives in Settings, in the fewest words.**
- End `swaps.review.noBoxMixed` with "Settings → Lovejoin turns that off.", as `dappUi.back.privacy.noteLovejoinMixed` does, in en, es and ja. It isn't a critical key.
- Add a render test that the approval of a no-box swap with the collateral's mix names Settings.

(b) **Only if the owner wants the switch on the approval.**
- Work out `collateralMixed` before `any`, and add `|| collateralMixed` to `any`.
- In `LovejoinChoice`, use a new short on-note where only the collateral goes through Lovejoin. `swaps.lovejoin.privacy.on` ("Its spare ADA is mixed…") would be false there. For example: "Its 5 ₳ collateral is mixed once on the way back, so it's harder to tie to this session."
- Off rebuilds with `through: false` as today. Traced: no reserve, `auto.direct` recorded, `buildBack` builds no tail. `turnedOff` keeps the switch shown so it can be turned back on.
- Add a test: the approval built from the worker's 2 ₳ swap shows the switch, and built with it off there's no `collateralReserve`.

## R3-21

**nit** (found as nit) · lenses: money-state, privacy-words, screens-states, complete-a · `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:172`

**A private Bootstrap's review hint still says 'The deposit goes in now, in one transaction'**

**Scenario.** A user reviews a Bootstrap from the private balance, which is the form's default side. The review's rows show 'First, a one-time account is funded', bootstrap's new 'For returning the rest, 1.5 ₳' row, and 'Then it runs by itself'. Its ⓘ hint says 'The deposit goes in now, in one transaction.' (reviewHint returns lovejoin.review.bootstrapNote for both sides). In fact it's three transactions with three fees: the funding now, the deposit once the funding lands while the wallet is unlocked, then the sweep back of what's left. Nothing on that review says to stay unlocked.

**Evidence.** Code: Lovejoin.tsx:171-172, where reviewHint returns lovejoin.review.bootstrapNote for bootstraps(r) on either side; it's rendered as the review's hint at Lovejoin.tsx:2789. The English is at en.json:1148, 'The deposit goes in now, in one transaction. …', added in 84c2775f (#318).

screens-states' throwaway: reviewHint({ source: 'private', summary: { mix: { bootstrap: true, … }, bootstrapReserve: '1500000' } }) returns lovejoin.review.bootstrapNote. Asserting it doesn't say 'now, in one transaction' fails: 'expected 'The deposit goes in now, in one trans…' not to contain 'now, in one transaction''.

fixes/bootstrap.md, call 5, flagged it for the screens round: 'shown for a private Bootstrap too … That's for the screens round.' fixes/sc-lj-1.md says it was left untouched, and sc-lj-2 didn't take it either. It isn't in L1-L6. Four lenses found it, all at nit.

**Concerns.** bootstrap (the 318-rust#0 family): its open point, call 5, which neither screens fixer (sc-lj-1, sc-lj-2) took. The wording predates this round (84c2775f) and fell between the rounds.

**Suggested fix.** Give a private Bootstrap its own short hint and keep the public one. The lenses offer three wordings:
- 'Funded now; the deposit goes once the funding lands, and what's left comes back after.' (complete-a)
- 'Funded now; the deposit and the way back of what's left follow by themselves.' (money-state)
- 'Once funded, the account deposits the boxes and returns what's left. The boxes stay in the pool …' (screens-states)
Or drop 'in one transaction' on the private side. Words only, with no refusal and no new critical key. A new key goes into en, es and ja with machine provenance.

**Skeptic 1 (held, nit).** The finding holds. I reproduced it on the current tree with a throwaway test.

**Why it holds:**
- `reviewHint` returns `lovejoin.review.bootstrapNote` for any Bootstrap, on either side. That note says "The deposit goes in now, in one transaction."
- A Bootstrap from the private balance is three transactions:
  - the funding (`out`), sent at Send;
  - the `deposit` and the `back` sweep, which the worker sends only after the funding lands, and only while the wallet is unlocked.
- The same review's rows say the opposite: "First, a one-time account is funded … For returning the rest 1.5 ₳ … Then it runs by itself."

**Severity stays nit.**
- It's words only, in the secondary ⓘ hint.
- The rows show the right order and every amount, and the total leaving the balance is right. Nothing about money or privacy is misstated.
- It's arguably low ("words that mislead mildly"), but the screen corrects it in its own rows.

**It's pre-existing.**
- The sentence is 1.5.0's `seedNote` (45e4fea8, which is in 1.5.0's merge 63f87b8). 1.5.0 showed it for a private seed too, which was also funding, deposit and back.
- 84c2775f carried it into `bootstrapNote`.
- Round 1's fix for 318-rust#0 added the "For returning the rest" row. That puts the contradiction on the same screen.
- The bootstrap fixer flagged it (bootstrap.md call 5), and sc-lj-1 left it untouched. It isn't in L1–L6 or in HANDOFF's owner calls.

**One correction to the scenario:** "Nothing says to stay unlocked" isn't specific to Bootstrap. A private mix's review (`privateNote`) doesn't say its deposit waits for an unlock either. It shouldn't justify a longer note, since UI text must stay short.

*Its fix:* Words only, with no refusal. Give the private side its own hint and keep the public one, which is accurate there.

1. In `Lovejoin.tsx:172`: `if (bootstraps(r)) return t(r.source === "private" ? "lovejoin.review.bootstrapNotePrivate" : "lovejoin.review.bootstrapNote");`
2. The new English, which opens the way `privateNote` does and keeps the second sentence, so it stays true in a stuck pool: "Once funded, the account deposits the boxes, and what's left comes back. The boxes stay in the pool, for other people to mix with, until you bring them back: one at a time, or all of them, spaced out."
3. Add the es and ja values, with "machine" entries in `docs/i18n/es-provenance.json` and `ja-provenance.json`. It isn't a critical key: no `.warn.` or `.privacy.` in its name.
4. Update `tests/lovejoin-session5-screens.test.ts:437`. It pins the private Bootstrap's hint to `bootstrapNote`, so it has to expect the new key.
5. Add a test that a private Bootstrap's hint doesn't say "in one transaction" and that the public one is unchanged.

Don't add an unlock sentence: UI text stays short.

## R3-22

**nit** (found as nit) · lenses: complete-b · `seedelf-platform/seedelf-web-wallet/docs/i18n/verified-critical-ja.json:168`

**x-i18n-ja#4's fix changed a verified critical value, and the es/ja gate passes on the stale verification**

**Scenario.** i18n-existing changed the ja value of the critical key lovejoin.launch.warn.atMost from クレデンシャル to 資格情報. Its 2026-10-02 blind back-translation is of the old value, and the key is still listed as verified. The gate keys on names alone, so it stays green. L5 sends only the new critical keys (3 + 11) to the next blind batch, so nothing makes this one go again. The risk is low: one word, and the wallet's own term since 1.5.0. But any later edit to a verified value would slip past the same way.

**Evidence.** A node diff of every key in verified-critical-{es,ja}.json whose value changed since 499768f6. es: none. ja: this one key alone (old '…プールのクレデンシャルが…', new '…プールの資格情報が…'). tests/i18n.test.ts:194-208 filters with `.filter((k) => !ok.has(baseOf(k)))`, names only. i18n-existing's report flags it under Notes for the lead, but L5's list doesn't name it.

**Concerns.** i18n-existing, x-i18n-ja#4. It sharpens L5 with a key its list doesn't name: a changed value of an already verified key, not a new key.

**Suggested fix.** Put lovejoin.launch.warn.atMost (ja) into the round's blind batch beside L5's 14. Or drop it from verified-critical-ja.json until then, so the gate asks for it. Later, consider recording a hash of the verified value, so a changed value reads as unchecked.

**Skeptic 1 (held, nit).** The finding holds and reproduces on the current tree. ja `lovejoin.launch.warn.atMost` is a critical key with provenance `machine`, and it is still listed in verified-critical-ja.json. Its value changed after the back-translation (クレデンシャル to 資格情報). The gate matches on key names alone, so it treats the key as checked. Once round 4 back-translates L5's 14 new keys, which are exactly what the gate fails on today, the gate goes green with this verification still stale.

It is the only stale entry: no es value changed, and no English value of a verified key changed.

Two corrections that don't change the verdict:
- **The date is wrong.** The finding says the back-translation was done on 2026-10-02, but that is only the first round's date at the head of the reviewer field. This key was added and verified in 0affa5b4 (2026-10-18), in 34f's post-review round ("back-translated twice more, blind").
- **"Nothing makes this one go again" overstates it.** HANDOFF.md:80 (lane F) plans a blind pass of "every key this round added or changed", and i18n-existing's report tells the lead the entry is stale. What's missing is a trigger in code, and a mention in the newest lists: L5 and both fix commits count only "14 new critical keys".

The risk to meaning is negligible. Both words mean "credential", 資格情報 is now the glossary's word (glossary.md:141), and the rest of the sentence is unchanged. So this is a stale record rather than a misleading warning: nit, as the finding rated it.

*Its fix:* For 1.6.0, the simplest fix enforces itself: remove `lovejoin.launch.warn.atMost` from verified-critical-ja.json until round 4's blind pass. The ja gate then lists it beside L5's 14 (15 in all), and round 4 works from that red list. After a fresh agent back-translates the new 資格情報 value blind, put the key back and add a line to the reviewer field. Alternatively, name it in round 4's batch beside L5's 14.

No code or wording change is needed.

Later, not for this release: record what was verified, for example a hash of each value next to the key, so the gate flags a changed value as unchecked.

## R3-23

**nit** (found as nit) · lenses: privacy-words · `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:977`

**x-privacy#0 made the stuck pool's questions longer, where the owner's rule asks to compress them**

**Scenario.** A stuck pool, and Bring one back anyway of account 2's box from account 1. The question's body runs to 8 sentences, about 140 words:
- the named warning (2 sentences) and hidesNamed;
- the private payer's note (2) plus privateAccounts;
- the public payer's note plus publicNamed.
The fix appended two sentences rather than folding the names in.

**Evidence.** PayerNotes :977-991; anywayWarning :888-913; the en.json values of lovejoin.stuck.privacy.* and lovejoin.anyway.privacy.*Named.

**Concerns.** sc-lj-2 (x-privacy#0, the page half). If R3-2's alternative is taken (privateAccounts only for deposit-made boxes), the private sentence changes anyway.

**Suggested fix.** Fold the names into the existing sentences. Private: 'Where it can, the wallet takes one that came back from Lovejoin, else one that ties no other account.' Public: 'Paid from {{active}}, … so anyone can tie {{active}} to the box, {{account}}'s, and to the private UTxO it comes back into.' Every tie stays.

**Skeptic 1 (held, nit).** Reproduced on the current tree, and against a render of 499768f6's own components. x-privacy#0's page half (sc-lj-2) added two separate sentences, `lovejoin.stuck.privacy.privateAccounts` and `lovejoin.stuck.privacy.publicNamed`. It did not fold the account names into the existing ones. So both stuck-pool questions that pay for a box went from 6 sentences to 8:
- Bring one back anyway: 122 → 155 words (153 for the deposit variant).
- Bring one back of a held Bootstrap box: 148 → 179 words.

The fixers' own brief (FIXBRIEF.md:60) carries the owner's rule: "a question's body a few short sentences … A privacy note may be compressed, but never drop what it ties." So the premise holds.

It stays a nit, not low:
- Most of the length predates the fix: both bodies were already 6 sentences at 499768f6.
- The fix's share is 2 sentences, about 31–33 words.
- Every sentence is true, and the fix was needed to state a tie nobody had told the user about.

The finding's "about 140 words" undercounts: it is 155 in its own state. The direction and the 8 sentences are exact. The scenario can happen: status puts another account's public box into `notMixed` + `fromPublic` + `otherAccounts`; NotMixed counts it (`elsewhere`) and offers Bring one back anyway; and the page passes `stuck` as `!!cantComeBack && owned > 0`. No owner call covers the length: the fixer's call 5 is about naming style, and HANDOFF rates x-privacy#0 confirmed, not owner-call. It isn't a duplicate either: cross-area.md:44-58 is R3-2's payer order.

*Its fix:* Fold the names in and keep every tie, with no refusal (concerns sc-lj-2, x-privacy#0's page half). Use named variants of the whole notes in place of the two appended sentences, only where PayerNotes appends today:
- `lovejoin.stuck.privacy.privateNamed`, where `named`: the current private note, with its last sentence changed to "Where it can, the wallet takes one that came back from Lovejoin, else one that ties no other account." This matches lovejoin.ts:6666-6670's order.
- `lovejoin.stuck.privacy.publicNamed`, reworded as the whole note, where `named && box !== active`: "Paid from {{active}}, one of its UTxOs goes into the box's own transaction, so anyone can tie {{active}} to {{account}}, whose box it is, and to the private UTxO it comes back into." This keeps the account-to-account tie explicit; the finding's wording ("to the box, {{account}}'s") leaves it to inference.
- Keep the generic `private`/`public` keys for one-account wallets, the active account's own box (public note) and PaidQuestion.
- Drop `privateAccounts`.

Both questions go back to 6 sentences (anyway ≈129 words).

Update tests/lovejoin-accounts-review-fixes.test.ts's AVOIDS and "That box is…" expectations. The keys are L5 machine drafts, so round 4 back-translates the new values instead of the old. If R3-2's alternative is taken (the private line only for boxes a deposit made), the private variant follows the same gate. The 6-sentence body from before the fix is still over "a few short sentences"; compressing it further is outside R3-23 (the owner's call on scope).

## R3-24

**nit** (found as nit) · lenses: privacy-words · `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Settings.tsx:841`

**The collateral switch's note is still a three-sentence paragraph**

**Scenario.** settings.lovejoin.collateralOn was reordered but not shortened. It's about 70 words under one switch, against the owner's one-short-line rule.

**Evidence.** en.json settings.lovejoin.collateralOn; Settings.tsx:841.

**Concerns.** i18n-existing (x-i18n-es#1).

**Suggested fix.** One short line, with the detail in the docs.

**Skeptic 1 (held, nit).** The finding holds, and it reproduces. In the default state (returns on, collateral on), the note beside the collateral switch is 74 words, 3 sentences and 390 characters. That makes it the longest string on Settings → Lovejoin, six times the 12-word, one-sentence note beside the returns switch just above it. The switch is a role="switch" button whose aria-describedby names this note. The brief's own rule is "A paragraph around a button is a finding (nit or low)".

Nothing exempts it:
- **Not decided.** HANDOFF lists x-i18n-es#1 as confirmed, not owner-call.
- **The owner never approved the text.** The owner asked only for a switch of its own (chunk-34 plan, Session 10). The note grew from 2 sentences (4d5bf583, 2026-10-22) to 4 (24c5c62a, PR #323, 2026-10-23), three days after the owner's 2026-10-20 text cut.
- **The CSS doesn't sanction it.** The setting-row comment about "a note of five to nine lines" dates from 2026-10-05, before that rule.

The fix touched this code. i18n-existing (x-i18n-es#1) rewrote the value in en, es and ja, with FIXBRIEF:60's "Keep UI text short" in its brief, and made it longer in all three: en 383→390 characters, es 390→426, ja 219→246. Merging "If not" into the first sentence took it from 4 sentences to 3.

It stays a nit, not low:
- The paragraph came in with PR #323. The fix lengthened it only slightly.
- Every claim in the note is true. The collateral mix is always three wide (lovejoin.ts:319-320, TAIL_DRAWS = 2), so "two other people's boxes" holds even with Four boxes a mix on.
- No money or privacy effect: the cost of keeping it is clutter that buries the switch.

*Its fix:* Cut settings.lovejoin.collateralOn to one short line. The label above it already says what the switch does: "Mix a session's 5 ₳ collateral in Lovejoin as it's brought back".

**What it keeps**
- The cost, since the On default costs fees and private-by-default wants the trade-off visible.
- The condition under which it happens.

For example: "Costs a little more at funding, and only where a pool of 5 ₳ boxes holds enough of other people's." That's 20 words, one sentence. "Only where" already says the collateral otherwise comes back as before.

**What it drops** (each is already said elsewhere)
- "What the mix doesn't use comes back": the funding reviews show it in lovejoin.collateralReserve.value ("{{ada}} ₳, and what it doesn't use comes back").
- "The mixed box comes back by itself": the return reviews' CollateralBoxRow and its .privacy. note cover it.
- The rest of the detail goes to flows.md:521 and privacy.md in the docs round (L6).

**What follows**
- Make es and ja match.
- The key isn't critical (privacy.collateralOff is the critical one), but put the new values in round 4's blind back-translation batch, as i18n-existing asked.
- Update tests/settings.test.ts:228-236. Its two `toContain` assertions pin the old wording: assert the new line instead, and keep the on-by-default and disabled-with-returns-off checks.
- Leave privacy.collateralOff alone: one sentence, and it states the tie.

No guard or refusal is involved.

## R3-25

**nit** (found as nit) · lenses: privacy-words · `seedelf-platform/seedelf-web-wallet/extension/src/ui/swap.ts:114`

**Max's note puts the change's least under 'network fee'**

**Scenario.** FEE_ROOM is now 2 ₳: the funding's fee plus its change's least. swaps.maxNote and swaps.maxNoteMixed still say the aside 'pays the swap's costs and network fee'. About 1.46 ₳ of it is change that stays in the private balance.

**Evidence.** swap.ts:114; en.json swaps.maxNote and swaps.maxNoteMixed. Same notes as R3-11, a different defect.

**Concerns.** sc-o-1 (323-worker#0).

**Suggested fix.** Name the room for the change, or count it with what's kept aside. Word it together with R3-11's change to maxNoteMixed.

**Skeptic 1 (held, nit).** The finding holds. I reproduced it with the real WebAssembly. When the user taps Max, the note says the aside "pays the swap's costs and network fee, [its collateral's mix,] and what's kept aside for contracts". But 1.766792 ₳ of that aside is the funding's change, which goes straight back into the private balance and is never spent. The note doesn't name it.

Two corrections to how the finding frames it:
- **It isn't a regression of the fix; the wording was already wrong in 1.5.0.** With 1.5.0's FEE_ROOM of 1 ₳, any Max funding that built at all had change of at least the minimum (1.45678 ₳) inside the aside. A funding whose change is under that minimum is refused (sess.notEnoughPrivate, "...its fee and the change").
- **What sc-o-1 (323-worker#0) did:**
  - it made the hidden change 1 ₳ larger;
  - it rewrote FEE_ROOM's code comment to "the fee and its change", so the comment and the note now disagree;
  - it copied the old wording into its new swaps.maxNoteMixed.

"About 1.46 ₳" is only the floor. At a whole-₳ Max funded from one UTxO the change is 1.77 ₳, and with rounding it reaches about 2.77 ₳.

The error points the harmless way. The note overstates what is spent and never understates it. The approval's exact figures are right, because swapCosts counts leaving as paid + fee and never counts the change as leaving. Nothing tests the note's text. By the brief's scale this is a small inconsistency in words, so it stays a nit, not a low.

*Its fix:* Change the words only. Keep the 2 ₳ room, which is the fix's whole point, and add no refusal. Reword both notes in one short line, so the change is counted with what's kept aside, and fold in R3-11's "may":
- swaps.maxNote: "Max is {{max}} ₳. The other {{aside}} ₳ pays the swap's costs and network fee, and what's kept aside for contracts and change, which you get back."
- swaps.maxNoteMixed: "Max is {{max}} ₳. The other {{aside}} ₳ pays the swap's costs and network fee, what its collateral's mix may take, and what's kept aside for contracts and change, which you get back."

"Change" also covers the rounding remainder, which stays in the private balance as well. Move es and ja in the same PR, since maxNote is an existing translated value; grep the tests for the key and its regex forms first. Neither key is a .warn. or .privacy. key, so the back-translation gate doesn't apply. Mark it as pre-existing in swaps.maxNote, repeated in sc-o-1's new swaps.maxNoteMixed.

## R3-26

**nit** (found as nit) · lenses: privacy-words · `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:2950`

**lovejoin.mix.cantAffordPublic says 'a mix can spend' over Home's figure**

**Scenario.** Before the utxos answer, or for 'a reading too large to keep', publicSide falls back to Home's figure, which counts rewards, ADA held with tokens and the collateral. The line still says 'Your public account has X ₳ a mix can spend'.

**Evidence.** Lovejoin.tsx:2554 (publicSide falls back to cardano when accountUtxos is undefined), :2950. This is the mirror of R3-27: here the new words sit over the old figure, there the old label sits over the new one.

**Concerns.** sc-lj-1 (321-lj-screens#1).

**Suggested fix.** Keep the old 'holds' wording when accountUtxos is undefined. One rule fixes this and R3-27: word both the label and the line by which figure feeds publicSide.

**Skeptic 1 (held, nit).** The finding holds; I reproduced it on the current tree through PoolPage's real code path. Fix round 2 (sc-lj-1, for 321-lj-screens#1) changed `lovejoin.mix.cantAffordPublic` from "holds {{held}} ₳" to "has {{held}} ₳ a mix can spend" for every state. But `publicSide` still falls back to Home's figure in two cases: before the `utxos` answer arrives, and when the reading is too large to keep. In both cases the new words sit over a figure that is not what a mix can spend. The fixer's own report (fixes/sc-lj-1.md:13) says the fallback is "Home's figure, as before", yet the wording was not kept for it.

One part of the scenario is wrong: Home's figure does not count the collateral. Home passes down `withRewards(unlocked(balances.cardano), rewards)`, and `locked.cardano` includes the collateral, so it is subtracted. The rest is right. Home's figure counts ADA held with other tokens, the rewards (spendRewards defaults to true, once the vote is delegated) and reference-script UTxOs, and publicMixAda leaves all of these out.

It stays a nit by the brief's scale:
- The line's conclusion is right in every state. Home's figure is never below the mix figure, so "can't pay for one box" on Home's figure means the same on the real one. Only the number is too high.
- The "before the answer" case is one worker round trip, usually session reads only, and corrects itself. It takes longer only when the private side is stale or nothing is kept, because `get()` then reads the network.
- The lasting case needs a reading too large to keep and, at the same time, a public account below one box's cost. That combination is unusual, since a too-large account usually holds a lot of min-ADA, and then the line does not show at all. It is reachable if a dust attack on the private side fills the session quota.
- With balances hidden, no figure shows.
- No test covers the line in any state.

*Its fix:* Choose the key by which figure feeds `publicSide`, as the finding suggests:
- Add `const fromList = !!(cardano && accountUtxos);` next to line 2554.
- At line 2950, use `fromList ? "lovejoin.mix.cantAffordPublic" : "lovejoin.mix.cantAffordPublicHolds"`.
- The new key `lovejoin.mix.cantAffordPublicHolds` carries the 1.5.0 text verbatim from 499768f6:
  - en: "One box needs about {{first}} ₳ with its mixes and the fee. Your public account holds {{held}} ₳."
  - es: "Una caja necesita unos {{first}} ₳ con sus mezclas y la comisión. Tu cuenta pública tiene {{held}} ₳."
  - ja: "ボックス 1 件にはミックスと手数料を含めて約 {{first}} ₳ が必要です。公開アカウントは {{held}} ₳ です。"
- These were already back-translated, so the change adds no translation work and keeps the line one sentence.
- Pass the same `fromList` to HeldOnSide's label so one rule covers R3-27 as well.
- Add a test for both states. Either put the key choice in an exported pure helper, or render PoolPage with `utxos` answered and unanswered, as the throwaway did.

Optional: for the "before the answer" case alone, hold back the public figures until the first `utxos` answer on a fresh page. The too-large fallback stays Home's figure, which the fixer chose on purpose.

## R3-27

**nit** (found as nit) · lenses: screens-states · `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:447`

**The public Mix form's held figure keeps the label 'In your public account'**

**Scenario.** From the public account, the stepper's held figure is now publicMixAda, what a mix can spend. For the account in R3-14 that's 14.4 ₳, where Home's Public tab shows about 10,370 ₳. Its title and screen-reader text still say 'In your public account' (lovejoin.mix.inPublic), on the Mix and Bootstrap forms. cantAffordPublic was reworded ('…has {{held}} ₳ a mix can spend'), but the label beside the number wasn't.

**Evidence.** Lovejoin.tsx:447 (HeldOnSide's where) and :2554-2555 (publicSide from publicMixAda); the figures are from R3-14's test. This is the mirror of R3-26.

**Concerns.** sc-lj-1: 321-lj-screens#1 (its call 4).

**Suggested fix.** Where publicMixAda feeds it, label the figure as what a mix can spend from the public account. The private side is unchanged. Settle it with R3-26 under one rule.

**Skeptic 1 (held, nit).** The finding holds. I reproduced it through the real PoolPage on the public tab, using the worker's real `utxos` answer and the balance Home hands down. Once the UTxO list is in, the Mix and Bootstrap forms both show publicMixAda's figure, which is 9 ₳ for the stock 12-word fixture account. Its tooltip and screen-reader label still say "In your public account", while Home's Public tab shows 10,408.014036 ₳. Before the list arrives, or for a reading too large to keep, the figure is Home's and the label is right, so it's wrong only on the usual path.

It isn't an owner call. HANDOFF.md:180 lists 321-lj-screens#1 as confirmed, not owner-call. sc-lj-1's call 4 settles the figure and cantAffordPublic's new words ("…a mix can spend"), and says nothing about the label.

Severity stays nit. The label appears only as a tooltip and as screen-reader text. The visible amount, the stepper's cap and the visible shortfall line are all right, and nothing about money or privacy changes. It's the same small inconsistency as its mirror, R3-26 (privacy-words #6), from the other side.

One correction to the scenario: "about 10,370 ₳" is loose. The stock fixture gives 10,408.01 ₳ (UTxOs plus 57.48 ₳ rewards), and with R3-14's added collateral and LJTEST UTxO it would be about 10,418 ₳. This doesn't change the substance.

*Its fix:* One rule, settled together with R3-26: the words follow whichever figure feeds the number.
1. In PoolPage, define `const mixable = source === "public" && !!accountUtxos;`. This is the same condition that picks publicMixAda at :2554.
2. Give HeldOnSide an optional `mixable` prop, and pass it on both the Mix and Bootstrap forms. Where it's set, `where` uses a new short non-critical key, e.g. `lovejoin.mix.inPublicMix`: "What a mix can spend from your public account". Add es and ja translations, with "machine" provenance entries. Without the prop, keep `lovejoin.mix.inPublic`. The private side doesn't change.
3. Use the same `mixable` for cantAffordPublic: keep "a mix can spend" only when it's set, and fall back to the old "holds" wording otherwise (R3-26 / privacy-words #6).
4. Add a public `mixable: true` case to `lovejoin-held-balance.test.ts` next to the existing one at :103.

This adds no refusal, and the text stays one short label (tooltip and screen-reader only), so it keeps to the owner's rules.

## R3-28

**nit** (found as nit) · lenses: data-layer · `seedelf-data/deploy/README.md:143`

**The runbook's rollback note doesn't say what rolling back to 68150b39's build costs**

**Scenario.** After 1.6.0's deploy, .prev is 68150b39's build, which has every route and request shape 1.6.0 calls. So the note's costs, sorted by 404 and 400, don't apply, and read that way a rollback looks free. It isn't, for two reasons.
- It brings back 317-data#0's two 5 s waits. A slow cursor read plus a list still being worked out answer at about 10 s, when the wallet aborts. The abort holds the wallet's whole private part on Koios for 5 minutes (private-index.ts:336-338 failed()), not just TokensDown.
- It brings back the old shown-pool rule, which lists a pool whose launch put its scripts under a datum past 128 levels. The fixed wallet refuses that pool (scriptsInline >= 1). If it's the earliest of its values, the genuine later pool isn't listed while the old build runs.

**Evidence.** README.md:143-146 sort a rollback's costs by 404 and 400, and keep the rest under 'every fix since goes with them'. git diff 68150b39 HEAD -- seedelf-data/api/src touches only lovejoin/* and state.rs, so 68150b39 serves every token route and there's no 404 or 400 to sort by. data-layer.ts:49 DATA_READ_TIMEOUT_MS is 10 s; private-index.ts:336-338. docs-2's own report noted 'Rolled back, the server could list a pool the fixed wallet's own check refuses', but that isn't in the note. This isn't L6's lag: the note is docs-2's own fix text (rewritten to stay true across deploys), and what it leaves out is the rollback's cost.

**Concerns.** docs-2 (310#0, 311#1, x-compat#1, x-release#6).

**Suggested fix.** One line that stays true across deploys: a token route that answers after the wallet's 10 s holds the private part like any private route; a .prev older than 1.6.0's review answers lovejoin/pools that slowly when db-sync is slow, and lists pools the wallet then refuses.

**Skeptic 1 (held, nit).** The finding holds as a nit. Every code fact it relies on is true on the current tree, and a throwaway test reproduced each one. After 1.6.0's deploy, `.prev` is 68150b39's build. That build serves every route and request shape 1.6.0 calls, so neither of the note's 404 and 400 bullets ever applies. Rolling back to it does cost two things:
- `lovejoin/pools` can again answer at about 10 s, and the wallet's abort then holds its whole private part on Koios for 5 minutes. It doesn't throw TokensDown.
- The old shown-pool rule comes back. It lists a pool launched under a datum deeper than 128 levels, which the fixed wallet refuses. While that list answers, the wallet never looks at Koios's holder for the real pool.

The note names neither cost.

Its framing goes too far, though, and that keeps this at nit:
- The note doesn't make a rollback look free. It says "roll back only as a stopgap, and fix forward", and it says "every fix since goes with them".
- The `git diff <.prev> <running>` it prescribes shows both costs in the fixes' own comments. routes.rs says "two waits of 5 s each took the wallet's 10 s, and a wallet that gets no answer takes its private part to Koios for 5 minutes (317-data#0)". standard.rs carries the 314-wasm#0 comment.

Both costs are also narrow:
- The timing window is the one 317-data#0's skeptic already called narrow, and it's how production runs today, since 68150b39 is live now.
- The deep-datum case needs a hostile token pool on mainnet, which has none. It also needs that pool to be the earliest of a listed token's values, and a later genuine pool that a wallet hasn't already kept or received in the release's head start.

The note is an operator runbook. The wallet doesn't serve it, and nothing in it is false. It is docs-2's own text from this round, and no fixer listed it under docs to update, so it isn't the known L6 lag.

*Its fix:* Add one line to seedelf-data/deploy/README.md after the token-routes bullet (line 145) that stays true across deploys, for example: "A slow answer costs more than a refusal: any route, a token route too, that answers after the wallet's 10 s holds that whole part on Koios for 5 minutes. And a `.prev` built before 1.6.0's review (68150b39's, `.prev` once 1.6.0's API is deployed) can take that long on `lovejoin/pools` when db-sync is slow. Its shown-pool rule also lists a pool launched under a datum the wallet refuses, which hides a later genuine pool of the same values from a wallet that hasn't kept it." This is ops docs only: no UI words, no keys, and no change to the wallet or the server.

Optional, not needed for 1.6.0: 317-data#0's own wallet-side suggestion. private-index.ts `get()` would throw TokensDown for an aborted token-route fetch, as it does for a 503 or 404, so no server build, past or future, can turn a slow token route into a 5-minute private hold. That changes a deliberate fallback design, so it's the owner's call and not a gate fix.

## R3-29

**nit** (found as nit) · lenses: lovejoin-records · `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:5704`

**recordLaunch's comment says launches are never read by a rule, but two rules now read them**

**Scenario.** Since 318-worker#1, two rules read launches: lovejoin-launch.ts startedBefore (the start review's warning), and submit(), whose `reviewed` check throws worker.spend.sentAlready. The comment still says 'for the hub, never read by a rule'.

**Evidence.** lovejoin.ts:5704 comment; lovejoin-launch.ts startedBefore and submit() read `this.deps.lovejoin.launches(network)`.

**Concerns.** wlj-4 318-worker#1 (LaunchRecord.box, reviewed).

**Suggested fix.** Say it feeds the hub, the start review's same-values warning, and Send's sent-already check.

**Skeptic 1 (held, nit).** The finding holds. The doc comment on recordLaunch (lovejoin.ts:5703-5706) says the launch record is kept "for the hub, never read by a rule". Fixer wlj-4's change for 318-worker#1 added two rules in lovejoin-launch.ts that read that record through LovejoinService.launches(), and the comment was never updated. A throwaway test confirmed it: a record written by recordLaunch alone, with nothing sent, changes both what the start review returns and what Send does. Only a comment is wrong, so this is a nit on the brief's scale ("comments, names, small inconsistencies"). The real risk is upkeep. Someone who trusts the comment might prune or clear `launches`, or drop `box` and `reviewed` from the migration, and that would quietly turn off the same-values warning and the sent-already check.

*Its fix:* Change the comment only, in lovejoin.ts:5703-5706. No code changes and no new keys. For example:
  /**
   * Keeps, sealed, that the wallet started pool `launch.id` (chunk 34's 34d), with its values and the hash its review
   * showed: for the hub, and for two checks in lovejoin-launch.ts. A start of the same values before a look finds this
   * one says so on its review (startedBefore), and Send asked again for a review whose start went without the
   * certificate says it went already (submit's `reviewed`; 1.6.0's release review, 318-worker#1). The pool itself is
   * read from once discovery finds it, as every wallet's is.
   */
LaunchDeps.lovejoin's comment (lovejoin-launch.ts:143) could also mention the Send check beside the same-values warning, because it names only the warning today.

## R3-30

**nit** (found as nit) · lenses: rust-core · `seedelf-platform/seedelf-web-wallet/wasm/src/lovejoin.rs:2009`

**The WebAssembly's Bootstrap cap still describes the cap from before 318-rust#0**

**Scenario.** bootstrap_most_in's doc says the cap is 'what its funding's reserve pays the deposit's fee and change for'. Since 318-rust#0 there are two reserves (DEPOSIT_RESERVE and BOOTSTRAP_BACK_RESERVE), and core builds both the deposit and the sweep back. At a dearer byte the sweep, not the deposit, sets the cap. At 6,465 lovelace a byte the probe gives 68 boxes in the classic pool and 51 in LJTEST's, where the deposit alone builds at 69. A Lane R reader of the wrapper is told the old rule.

**Evidence.** The doc text at wasm/src/lovejoin.rs:2009-2012, against core's updated doc at seedelf-core/src/lovejoin/mod.rs:1929-1939. A throwaway wasm test (deleted) ran the cap through chain_in at 6,465 lovelace a byte: 'dear classic most=68 boxes=69: ERR A Seedelf deposit of these tokens needs at least 2.185170 ADA', while core's deposit_from builds at 69.

**Concerns.** bootstrap (phase A, 318-rust#0). rr-2's 323-rust#2 checked only core's bootstrap_most doc.

**Suggested fix.** Say 'what its funding's two reserves, the deposit's and the way back's, pay the deposit and its sweep back for (lovejoin::bootstrap_most, which builds both)'. Comment only.

**Skeptic 1 (held, nit).** The finding holds. bootstrap_most_in's doc (wasm/src/lovejoin.rs:2009-2012) has the same text as at 499768f6. It still describes the rule from before 318-rust#0: one reserve pays the deposit's fee and change. The function is a passthrough to core's lovejoin::bootstrap_most, which since phase A funds two reserves (DEPOSIT_RESERVE plus BOOTSTRAP_BACK_RESERVE) and builds both the deposit and its sweep back. At a dearer byte the sweep sets the cap, not the deposit. A throwaway test against the shipped wasm pkg reproduces every number in the finding. The doc is also wrong at today's byte: per FINDINGS.md 318-rust#0, the rule it describes gave 53 under preprod's parameters, and the wrapper now returns 96. L6 doesn't cover it: FIXBRIEF.md:72 says "Code comments are yours to fix", and the docs round is WW/docs and the READMEs only. No fixer report names this comment: rr-2's 323-rust#2 checked only core's bootstrap_most doc. It stays a nit. It is a comment only, and no user is affected. The TS caller's doc (lovejoin.ts:2796-2806, privateBootstrapMost) is already correct. The wrapper's link to core's bootstrap_most also leads to the right doc.

*Its fix:* Comment only, in wasm/src/lovejoin.rs:2009-2012:

```rust
/// The most boxes, of `request.most`, a Bootstrap paid from the private
/// balance puts into the pool under `request.params`: what its funding's two
/// reserves, the deposit's and the way back's, pay the deposit and its sweep
/// back for, each count built ([`lovejoin::bootstrap_most`], chunk 34's 34d
/// review, 3; 1.6.0's release review, 318-rust#0).
```

No code, test or UI text changes, and the pkg needs no rebuild for it.

## R3-31

**nit** (found as nit) · lenses: rust-core · `seedelf-platform/seedelf-core/src/eval.rs:27`

**rr-1's MEASURE_LIMIT comment overstates which builders check MAX_TX_BUDGET, and its 16.5M memory figure contradicts build.rs's MAX_TX_BUDGET doc**

**Scenario.** Two problems in rr-1's new comment.
1. It says 'each builder refuses it by checking the total against MAX_TX_BUDGET'. Only ScriptSpend, the DEX cancels and mix_with do. lovejoin::withdraw_with measures but never compares its total. That's harmless today, since every WebAssembly withdraw passes one box, but a later multi-box withdraw would trust the comment.
2. It gives the ledger's limit as 16.5 million memory units, while build::MAX_TX_BUDGET's doc still says 'They have only gone up since (17.5M memory at epoch 315)'.

**Evidence.** grep MAX_TX_BUDGET finds only build.rs:1994 (ScriptSpend), orders.rs:1022 and lovejoin/mod.rs:1077 (mix_with). withdraw_with (mod.rs:1299 on) has no check. The wasm withdraws pass std::slice::from_ref(&chosen) at lovejoin.rs:2565, 2662 and 2775. build.rs:1108-1110 says '17.5M memory at epoch 315', while both fixtures carry max_tx_ex_mem 16500000 (preprod at epoch 290, mainnet at epoch 658).

**Concerns.** rr-1 (312#0).

**Suggested fix.** Narrow the sentence to 'the builders that run several scripts (a mix, a Seedelf spend, a DEX cancel)', and correct or drop build.rs's 'only gone up since (17.5M …)' line. Comments only.

**Skeptic 1 (held, nit).** The finding holds as a nit, but half of it points the wrong way.

Scenario 1 holds. I reproduced it with a throwaway test that fails. `lovejoin::withdraw_with` measures the transaction and never compares the total against MAX_TX_BUDGET. So eval.rs's "each builder refuses it by checking the total against MAX_TX_BUDGET" is false. Withdraws of 25 to 34 boxes are built at 10.01 to 13.99 billion steps, and the ledger refuses anything over 10 billion. No shipped path can reach this: every caller passes exactly one box, which uses about 0.42 billion steps. So it stays a comment nit.

Scenario 2 is backwards. The two comments do disagree, but build.rs is the one that's right:
- Preprod's live limit today (epoch 321) is 17,500,000 memory units. That matches build.rs:1110's "17.5M memory at epoch 315", which is a preprod epoch: the line dates from 2026-09-23 and the fixture's epoch 290 from about May.
- rr-1's new eval.rs:30 says "16.5 million memory units, on preprod and mainnet in 2026". That is wrong for preprod. The old comment's 17.5M was wrong for mainnet, so rr-1 only moved the error to the other network. Its fixer report relied on "both fixtures", but the preprod fixture is from epoch 290, before preprod raised the limit.
- The finding's fix, "drop or correct build.rs's line", would delete a true statement.

The finding's suggested rewording is also off. "The builders that run several scripts (a mix, a Seedelf spend, a DEX cancel)" doesn't fit, because a withdraw runs several scripts too: 26 redeemers at 25 boxes in my test, all through the same unchecked path.

*Its fix:* A comment-only change in eval.rs:27-34. Keep build.rs:1108-1110, which is correct; at most, add there that 16.5M is mainnet's limit exactly. Suggested wording:

"The most a transaction's scripts may use together while measured, not each of them: `uplc` runs each redeemer on what the ones before it left (1.6.0's release review, 312#0). It's above the ledger's own limit for a transaction (10 billion steps; 16.5 million memory units on mainnet, 17.5 million on preprod, in 2026), so a transaction over that is still measured whole. A Seedelf spend ([`crate::build::ScriptSpend`]), a mix and a DEX cancel refuse it by checking the total against [`crate::build::MAX_TX_BUDGET`]. A Lovejoin withdraw doesn't: the wallet withdraws one box at a time, and it takes 25 to pass the limit. Past this, the measure fails first: a script \"went over budget\"."

An optional code alternative, not needed for 1.6.0: give `withdraw_with` mix_with's total check after its measure. It refuses only what mainnet's ledger refuses, so it's within the no-paternalistic-guards rule, and it would make the original sentence true.

