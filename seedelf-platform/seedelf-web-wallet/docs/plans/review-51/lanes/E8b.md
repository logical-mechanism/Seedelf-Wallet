# Lane E8b

Returned by the workflow's agent `a8e5da0e20dd1b7c2`, written here by the lead from its structured answer.

## Findings (6)

### e8b#1 · low · A stranger's 5 ₳ carrying a reference script or an unreadable datum becomes the public account's collateral, public Lovejoin mixes then fail, and the Collateral page can only pick it again

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/coin-control.ts:184`
- **Who:** stranger · **Since:** 97d7cdd7 (chunk 12's collateral pick); it bites since the public mix resolved its collateral row through eval::resolve_row (launch review #12's fix) · **Confidence:** traced
- **Needs the owner:** It changes which UTxO the wallet takes by itself and what the Collateral page offers. Refusing such a UTxO in use() would refuse a collateral the ledger accepts for a site's transaction, against the refuse-only-what-the-ledger-refuses rule, so the owner picks between skipping it in the automatic pick and candidate only, and refusing it outright.

**Scenario:**

A user has no collateral chosen and no older 5 ₳ ADA-only UTxO (a new wallet, or one that reclaimed). A stranger sends exactly 5 ₳, no tokens, with a reference script (a ~0.5 KB script needs ~3 ₳ of min-UTxO, so 5 ₳ fits), or with an inline datum nested past 128 levels, to the account's public 0/0 address. collateralOf takes it by itself, and the Collateral page says 'Set: 5 ₳, set by the wallet'. Every Lovejoin mix from the public account then fails to build: 'UTxO …#0 holds a reference script, which the wallet can't evaluate with yet' (or '…holds a datum the wallet can't read'). Reclaim, then Set collateral, takes the same UTxO again, because the page's Set uses status.candidate (the oldest 5 ₳ UTxO), locks don't exclude it, and use() unlocks it. Nothing on the page picks another UTxO or pays a new 5 ₳ while a candidate exists, and a self-paid 5 ₳ is newer, so the wallet still picks the stranger's. If Koios gives no bytes for that script (unmeasurable), no payment can spend it either (it's left out as 'script'), so nothing in the wallet ends this. Otherwise the only way out is to spend it in some payment, which nothing suggests. No funds are lost: the 5 ₳ is the stranger's gift. The account-paid mint and a site's getCollateral are unaffected, since the ledger and Ogmios accept such a collateral.

**Evidence:**

coin-control.ts:184 `export const isCollateralShaped = (u: KoiosUtxo) => BigInt(u.value) === COLLATERAL_LOVELACE && !u.asset_list?.length;` (no reference_script, inline_datum or datum_hash check). coin-control.ts:205 (collateralOf) `const oldest = utxos.map((p) => p.utxo).filter(isCollateralShaped).sort(oldestFirst)[0];` returns it `by: "wallet"`. account.ts:183 `const { spendable, collateral } = await deps.coins.account(network, utxos);`. lovejoin.ts:4862 `const { params, utxos, collateral, held } = await readAccount(this.deps, network);` → :4891 `collateral: collateral ?? null`. wasm/src/lovejoin.rs:2358 `Some(c) => Some(Coin::from_row(&c.utxo)?)` → seedelf-core/src/lovejoin/mod.rs:487 `utxo: eval::resolve_row(row)?` → seedelf-core/src/eval.rs:63 `if row.reference_script.is_some() { return Some("…holds a reference script, which the wallet can't evaluate with yet") }`, then unreadable_datum. The page: Collateral.tsx:162-164 `if (status?.state === "none" && status.candidate) { … call("collateral-use", { utxo: … }) }`. coin-control.ts:377 `const candidate = lists.cardano.filter((u) => isCollateralShaped(asKoios(u))).sort(oldestInfoFirst)[0];` (UtxoInfo carries no script or datum, and locked UTxOs aren't excluded). coin-control.ts:391 use() checks only isCollateralShaped(asKoios(found)), and :397 removes the lock. The one caller of collateral-use is Collateral.tsx:164 (grep). Contrast sessions.ts:1052-1053 `collateralFits`: `… && !u.reference_script && !u.inline_datum && !u.datum_hash`, the same class fixed for a session's chain (independent review L20). tests/coin-control.test.ts:279-297 shows a 3 ₳ UTxO with an unmeasurable reference script is left out of Max as 'script', so a 5 ₳ one is unspendable too.

**Fix:**

One predicate for a collateral the wallet can put up, as sessions.ts collateralFits has it: 5 ₳, ADA alone, no reference script, no datum (inline or hash). Use it in collateralOf's own pick and in collateral()'s candidate, which must read the raw rows (the kept PathedUtxo rows), not UtxoInfo. The family: collateralOf (coin-control.ts:205, which feeds readAccount, the public mix and launch, and dapp.ts:1675/1852 getCollateral), the candidate (:377), use() (:391), and sessions.ts collateralFits; one shared helper keeps them from drifting. A test: a stranger's 5 ₳ row with reference_script (and one with a deep inline datum) beside no other 5 ₳ isn't the collateral, isn't the candidate, and Set pays 5 ₳ instead.

**Known check:**

Searched backlog.md for 'reference script', 'collateral', 'stranger' and the 5 ₳ collateral; archive/plans for isCollateralShaped, 'collateral-shaped', "stranger's 5" and 'reference script'. Found: independent-review.md L20 (fixed for a session chain's fallback collateral only, via collateralFits), launch-review.md #12 (reference-script UTxOs priced or left out of payments; the collateral pick not covered), chunk-12 row 21 (the pick's design: the oldest pure 5 ₳). Nothing about the public account's pick or the page's candidate.

### e8b#2 · low · The collateral payment's review doesn't show that it withdraws all the account's staking rewards

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Collateral.tsx:194`
- **Who:** user · **Since:** 756a646e (chunk 13: rewards ride along every account payment, buildCollateral among them through SendService.pay) · **Confidence:** traced

**Scenario:**

Settings' 'Use staking rewards when spending' is on (the default, preferences.ts:165), the stake key is registered and the vote delegated, and 57 ₳ of rewards sit in the reward account. The account holds no 5 ₳ UTxO, so Set collateral builds a payment. The review lists To (your public account), Address, Set aside 5 ₳, Fee 0.17 ₳ and UTxOs spent. The signed transaction also withdraws the whole 57 ₳ into the account's change, and nothing on the review says so. Make private, Send and Create Seedelf all show that withdrawal (RewardsRow). Nothing leaves the user: Home's public total already counts the rewards, and 'Only the fee leaves your account' stays true. But the review omits part of what it signs, and rewards the user may have meant to leave in the reward account (to withdraw by hand for a site) are moved without a word.

**Evidence:**

send.ts:85-90 `buildCollateral` → `return this.pay(network, [{ address, own: true }], [payment], SESSION_COLLATERAL);`. send.ts:118 `readAccount(this.deps, network)` gives `withdrawal`. account.ts:194-203 `const withdrawable = spendRewards && stake?.status === "registered" && stake.delegated_drep && BigInt(stake.rewards_available) > 0n && !onTheWay; … ...(withdrawable ? { withdrawal: stake.rewards_available } : {})`. send.ts:131-139 passes `withdrawal` to the request. wasm/src/lib.rs account_send: `let rewards = withdrawing(account, network_flag, request.withdrawal.as_deref())?;`, `sign_staking(signed, account, &rewards)`, and `withdrawal: rewards.withdrawn().to_string()` in SendResult, which reaches SendSummary.withdrawal through send.ts:162-170. Collateral.tsx:194-200 renders only destination.to, utxos.address, collateral.setAside, review.fee and send.review.spent. A grep for RewardsRow/RewardsSetting finds MoveIn.tsx:130,140, CardanoSend.tsx:215,219 and CreateSeedelf.tsx:148 (the row, no setting note), and nothing in Collateral.tsx.

**Fix:**

Show `<RewardsRow withdrawal={summary.withdrawal} />` in the collateral review's rows and `<RewardsSetting withdrawal={summary.withdrawal} />` under them, as Make private and Send do. Same family: CreateSeedelf's account-paid review shows the row but not RewardsSetting (CreateSeedelf.tsx:148). Either way, every public review whose transaction can carry a withdrawal (MoveIn, CardanoSend, CreateSeedelf, Collateral) says so in one way. A test: buildCollateral with spendRewards on and rewards available, its review showing the row.

**Known check:**

Searched backlog.md and archive/plans for RewardsRow, 'rewards row' with collateral, collateral with withdrawal or reward, 'withdrawal riding' and 'rides along'. chunk-13-staking.md:38 records the ride-along on 'a send, move-in or account-paid mint'. The blind-test items (rows reworded) are about the rows that exist. Nothing about the collateral review.

### e8b#3 · low · Bring everything back: a session left out while the switch rebuilds is chosen again when the rebuild lands

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/ClaimAll.tsx:111`
- **Who:** user · **Since:** 40f7c3f4 (Bring everything back can bring them back directly instead) · **Confidence:** traced

**Scenario:**

Three sessions are built and picked, one of them a site's session the user still uses. The user turns the Lovejoin switch off: rebuild builds every session's return again, several seconds for three. While it builds, they tap the site's session to leave it out, and its check clears. When the rebuild answers, the old choice is put back: the site's session is checked again and the button reads 'Send 3 returns'. A press then brings that session back too: its fee is paid, and its one-time account is emptied under the connected site ('stays connected, to an empty account'). The rows stay pressable during the rebuild, while the switch, Back and Send are all off.

**Evidence:**

ClaimAll.tsx:104-118 `async function rebuild(straight: boolean) { … const again = await call("session-claim-build", …); setBuilt(again); setChosen(new Set(again.returns.map((r) => r.index).filter((i) => chosen.has(i)))); …`. `chosen` is the render's value captured when the switch was pressed (onDirect at :210 calls that render's rebuild), so a toggle made during the await (:179-184, a functional update) is overwritten. ClaimAll.tsx:315-320: the row's `<button type="button" … aria-pressed={on} onClick={() => onToggle(r.index)}>` has no `disabled`. `busy` reaches ClaimReview but only the switch uses it (:302 `disabled={busy}`), while Back (:192) and Send (:196) are off while busy.

**Fix:**

Keep the user's choice as it stands when the rebuild lands: `setChosen((now) => new Set(again.returns.map((r) => r.index).filter((i) => now.has(i))))`. Or turn the rows off while busy (`disabled={busy}` on the row button), as the switch, Back and Send are. A Vitest test: render ClaimAll with `call` mocked, press the switch, toggle a row before the rebuild resolves, and expect the row still left out afterwards.

**Known check:**

Searched backlog.md for 'Bring everything back' (lines 23, 40, 58, 89: the reward-balance race, the privacy controls, the resumed tail's reservation) and archive/plans for 'leave it out', 'chosen', claim with toggle or busy, and claim-way. Nothing about a toggle lost to the rebuild.

### e8b#4 · nit · Bring everything back's total counts a token once per session, not once per kind

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/ClaimAll.tsx:259`
- **Who:** user · **Since:** 5cc61e55 (Bring everything back) · **Confidence:** traced

**Scenario:**

Two picked sessions each bring back some MIN. Each row says 'and 1 token', and the total under 'Into your private balance' says 'and 2 tokens' for one kind. Send's and Make public's reviews count kinds.

**Evidence:**

ClaimAll.tsx:259 `const tokens = picked.reduce((sum, r) => sum + r.tokens.length, 0);` → :394 `<Row label="" value={t("claim.andTokens", { count: tokens })} />`. Contrast Transfer.tsx:179 `new Set(summary.payments.filter((p) => !p.toSelf).flatMap((p) => p.tokens.map(key))).size` and Withdraw.tsx:162.

**Fix:**

`new Set(picked.flatMap((r) => r.tokens.map(tokenKey))).size`, as the other reviews count.

**Known check:**

Searched archive/plans and backlog.md for the claim token count and 'and N tokens' with claim. Nothing found.

### e8b#5 · nit · Make private keeps a refusal on the form after the amount changes and after Back from its review, and Collateral keeps the review's error after Back

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/MoveIn.tsx:105`
- **Who:** user · **Since:** unknown; the clean-Back and clear-on-change rule came in d423b79a without these two screens · **Confidence:** traced

**Scenario:**

Make private refuses an amount as too much ('up to X'). The user lowers the amount, and the refusal stays under the form as if it answered the new one until Review is pressed again. Likewise, a Send refused as 'built more than 10 minutes ago' stays on the form after Back. On Collateral, an error from the review's Send stays on the status page after Back. Send and Make public clear both, a rule chunk 23's fixes brought in (T05, 'the form it goes back to starts clean').

**Evidence:**

MoveIn.tsx:105 `onBack={() => setSummary(undefined)}` (error kept), and no effect clearing `error` when amount, max or tokenAmounts change. Contrast Transfer.tsx:102 `useEffect(() => setError(undefined), [list.drafts, max]);` and :169-173 toForm, and Withdraw.tsx:84 and :153-157. Collateral.tsx:184 `onBack={() => setSummary(undefined)}` with `error` shown by the Screen at :286.

**Fix:**

On MoveIn, clear the error on Back and when the form changes (`useEffect(() => setError(undefined), [amount, max, tokenAmounts])`). On Collateral, clear it on Back from the review.

**Known check:**

usability-review.md:1165 says 'a review's error no longer follows Back to the form', fixed in d423b79a for Send, Make public, Create and Remove. Searched backlog.md for setError, 'error stays' and T05. MoveIn and Collateral aren't recorded.

### e8b#6 · nit · A token picked from its details but not spendable (all in locked UTxOs) is dropped silently, and Review waits with no reason

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/Recipients.tsx:167`
- **Who:** user · **Since:** d423b79a (waitingFor's tokensPicked, PY-9) · **Confidence:** traced

**Scenario:**

The user has locked the only UTxO holding a token, opens that token's details on Home (which offer Send and Make public/private for every listed token, TokenList.tsx:168) and presses Send. The form starts with that token picked, but its box isn't shown, because it isn't among the spendable tokens. Review stays off once a Seedelf name is in, and the line under it says nothing: waitingFor counts the picked key as tokens being sent, so an empty amount reads as fine. Only typing an ADA amount turns Review on, and the review then sends ADA alone. Make private and Make public behave the same.

**Evidence:**

Transfer.tsx:124 `tokensPicked: Object.keys(e.draft.tokens).length > 0` (Withdraw.tsx:108, MoveIn.tsx:62 the same). Recipients.tsx:167 `if (!max && lovelaceToSend(amount, tokensPicked) === undefined) return "review.why.amount";` → lovelaceToSend("", true) is "0", so no reason. Recipients.tsx:70-71: the real amount comes from `tokenChoices(network, heldFor(...), d.tokens)`, whose loop (TokenAmounts.tsx:61-62 `for (const token of held) { if (!(key(token) in typed)) continue;`) never sees a token not held, so `sent` is [] and `lovelaceToSend("", false)` is undefined, which leaves ok false. Home passes free (unlocked) tokens to the forms (Home.tsx:518-522) but lists every token (withComing(balances.seedelf), Home.tsx:793).

**Fix:**

Count only picked tokens the form can send as tokensPicked (`e.tokens.sent.length > 0`, or the keys that are held), so the empty amount gets its reason. Or have tokenChoices report a picked token that isn't spendable as a problem ('locked'), so Review says why.

**Known check:**

Searched backlog.md and archive/plans for tokensPicked, PY-9 and locked tokens in a token's details. PY-9 fixed reasons for empty boxes, not a picked token that isn't held. Nothing found.

## Guards (19)

| Where | What it stops | Test |
|---|---|---|
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Transfer.tsx:109` | Reviewing a Send from the private balance for more than its spendable ADA (several recipients: TooMuchTogether) | e2e/extension.spec.ts:2431 |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Withdraw.tsx:94` | Reviewing a Make public for more than the spendable private ADA | none found (Send's and Make private's are in e2e) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/MoveIn.tsx:60` | Reviewing a Make private for more than the account (rewards included) can pay | e2e/extension.spec.ts:1660 |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Withdraw.tsx:91` | A destination read for other text counting as read (paying an address the field no longer shows) | none found |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Withdraw.tsx:128` | Max mixing typed token amounts into Everything: Max sends tokens [] and its hidden boxes can't hold Review back (:89) | none found |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Transfer.tsx:139` | Paying a name other than the one looked up: the build pays f.seedelf.name, and the review shows the whole name (:185-191) | tests/transfer.test.ts (worker lookup and build) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Transfer.tsx:178` | Total leaving counting a payment to your own Seedelf, which comes back (Withdraw.tsx:161 counts every payment); after = Home's total minus leaving (ReviewTotals.tsx:63) | tests/review-totals-incoming.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Transfer.tsx:380` | Max with several recipients: Add turns Max off, the chip hides with several (:348), and wasm transfer_plan refuses 'Max pays a single recipient' | none found in UI; wasm api tests |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Transfer.tsx:64` | Max carried to the other form (another balance), which would send every token | tests/address-routes.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/StaleReview.tsx:117` | A stale review rebuilt past a form guard (a token no longer sendable quietly left out): rebuilds only when ready, else back to the form | tests/review-stale-form.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/RemoveSeedelf.tsx:186` | A default destination where another account paid or the payer is unknown (an unchosen link); build refuses with no destination (:197) | tests/minted-by.test.ts, tests/own-account-names.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/ClaimAll.tsx:43` | Bringing back a session whose chain is still being sent, one running by itself, or one holding nothing | tests/swap-page.test.ts:369-380, tests/restore-scan-lovejoin.test.ts:259-275 |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/ClaimAll.tsx:100` | Building and signing the returns again on every render: built once, for the list it opened with | none found |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:3360` | claimSubmit sending returns not kept or older than BUILT_TTL_MS: refuses all before any goes | none found |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Collateral.tsx:265` | Paying 5 ₳ from an empty account, or while Home has a payment on its way (unless a 5 ₳ UTxO held makes it with no transaction) | none found for the empty case; WaitingFoot's blocked: tests/collateral-again-review-fixes.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Collateral.tsx:45` | The page taking Home's landing notice (Home then held every payment for 10 minutes on 'sent') | tests/collateral-again-review-fixes.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/script-spend.ts:388` | Send of a review not kept, too old, or spending what went out since or what a chain or a payment's later parts reserve; a payment's later parts are checked before its first goes (:405-438) | tests/payment-parts.test.ts, tests/parts-send-review-fixes.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/move-in.ts:135` | Submitting a Make private other than the one reviewed, or older than 10 minutes | tests/move-in.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/coin-control.ts:205` | Payments spending the collateral: it's kept out of spendable (:241); but see e8b#1 for what it accepts as one | tests/coin-control.test.ts |

## Checked and holds

- Send from the private balance: Total leaving = payments not to your own Seedelf + fee.total, and the after row = Home's private total (locked and incoming in) minus that; the parts' figures are summed by whole(), whose payments[0] alone is right because several recipients never go in parts (build_transfer_parts/build_withdraw_parts send them as one transaction)
- Make public: leaving = every payment + fee; Max sends every token (tokens [] asked, wasm Everything); the token count is by kind; the Everything row shows the parts' summed lovelace
- Max's 'stays with the tokens you keep' figure (changeLovelace) excludes carries: a carry is rest_lovelace, apart from change_lovelace; amount parts add a kept carry in carry_kept; max_chained spends every carry
- MaxLeftNote's reasons match wasm LeftWhy, and MAX_PARTS is 25 in Withdraw.tsx, script-spend.ts and wasm lib.rs
- amountText/MinimumNote say 'raised' only when lovelace === minimum and 0 < asked < minimum; whole() sums the parts' minimums only when every part sends tokens, and Max's minimum is null
- Make private: leaving = lovelace + fee against Home's public total (rewards in), private after = private total + lovelace; lovelace is core's total into the contract over every deposit output
- Create Seedelf: leaving = locked ADA + fee.total against the paying side's Home total; a Seedelf's UTxO isn't in the private balance, so a stealth mint's after is right
- Remove Seedelf: the review's amount is the one input's change (locked ADA less fee), to the active account's 0/0 or under the wallet's register; WebAssembly refuses a Seedelf that isn't this wallet's
- Bring everything back: each r.fee includes its chain's and its collateral tail's fees (buildBack adds made.fee on the direct path; ChainResult.fees adds t.fee() and every step), so Network fees is complete and the collateral row adds no figure; the transaction count matches all three shapes (chain incl. tail, direct + tail = 3, resumed tail = 2)
- Bring everything back sends only the returns built and kept (by txHash, network, TTL); each in its own transaction; one that fails doesn't stop the rest; a trap locks
- Collateral: the payment is 5 ₳ to the account's own 0/0, output #0 recorded as the collateral after submit (on the account it was built on); Pay it again goes through settleMaybeSent
- Send's lookup never asks Koios about the recipient's token; the review shows the whole name; toSelf (wasm register.is_owned) agrees with the form's own (outpoint in owned)
- Every review's Send/Remove/Create is off while busy; a second press after a submit is refused by the worker (refuseSent: sent already), so no payment goes twice; stale reviews rebuild (Send, Make public, Create, Remove), and Make private and Collateral show the error with Back working: no stuck review
- Max is offered only with one recipient, Add turns it off, and the worker/wasm refuse Max with several
- handedOnAmount drops Max when an address goes to the other form; tokens picked from the private side aren't handed to the public Send

## Notes

- For lanes E7a/E3b (Swaps.tsx:2311-2317, SiteSessions.tsx:284-290): a single return's review shows 'Network fees' = back.fee, which already includes the collateral tail's fee (sessions.ts buildBack `fee: back.fee + made.fee`; wasm lovejoin.rs ChainResult `fees += t.fee()`), and then 'Its 5 ₳ collateral: Mixed once … for {{fee}} ₳' with that same fee. A reader adding the rows counts the tail's ~1 ₳ twice. Bring everything back's collateral row gives no figure, so it doesn't.
- RemoveSeedelf's default destination relies on AccountsProvider having read the accounts. If that read failed (accounts.tsx: 'Locked, or the worker restarting: the screens carry on with account 0'), `several` is false and `active` 0, so otherAccountPaid can't fire and the default sends the freed ADA to the worker's active account, which may not be the one that paid. That's a transient degenerate state, so not a finding.
- ClaimAll's `sessions` prop is Dapps' `sessions.filter(isClaimable)` at each render. A site broadcast (reread) can change it while the review is open: a rebuild then builds for the new list (new sessions unchosen), and a return whose session left the list is named 'A session'. Benign.
- Collateral review shows the address shortened (16/8); it's the account's own 0/0, from the worker, so the lookalike rule (S-4) doesn't apply.
- For e8b#1 the severity hangs on Koios: with a reference script Koios gives no bytes for (measurable false), the stranger's UTxO is unspendable by every payment, and nothing in the wallet frees the public account's collateral. With a measurable script or a deep datum, spending it in a payment is a way out the wallet never suggests. The owner may weigh that as medium (a stranger-caused stuck state for public mixes).
- TokenList.tsx:168 offers Send and Make public/private for every token Home lists, those only in locked UTxOs included (e8b#6's entry point; E9a's lane).

## Coverage

Read in full: ClaimAll.tsx, Transfer.tsx, Withdraw.tsx, MoveIn.tsx, CreateSeedelf.tsx, RemoveSeedelf.tsx, Collateral.tsx. Followed into the worker, read in full: transfer.ts, withdraw.ts, move-in.ts, mint.ts, send.ts, script-spend.ts, coin-control.ts. Followed in part: sessions.ts (claimBuild/claimBuildNow/claimSubmit, backBuild/backSubmit, buildBack in full, sendBack, pendingChain, collateralFits, tailReserve); parts.ts (reviewParts, sendParts head); pending.ts (refuseSent, settleMaybeSent); account.ts (readAccount, readAccountUtxos); lovejoin.ts (LovejoinChain type, the public mix build's collateral); handlers.ts dispatch. WebAssembly and core, read in part: lib.rs (build_transfer_parts, build_withdraw_parts head, transfer plan/spend/result, carry_kept, max_in_parts, max_chained, remove, MoveInResult/move_in, SendRequest/SendResult/account_send); wasm lovejoin.rs (the public mix's collateral, chain fees with the tail); core build.rs (remove, carry, carried), eval.rs refusal, lovejoin/mod.rs Coin/PoolBox. UI components, in full: AdaInput, Recipients, ReviewTotals, StaleReview, LeftOut, SessionLeft, HistoriesNote, HandleWarning, accounts.tsx, shared/label.ts, shared/seedelf-name.ts. In part: LovejoinReturn (most of it), TokenAmounts (tokenChoices), TokenList (TokenDetails), format.ts (parseAda, unlocked, withRewards), Home.tsx (the routing to these screens, privateWhy, reviewTotals), Dapps.tsx (ClaimAll's wiring), Swaps.tsx (the single return's review), and the English strings for these screens. Not reached: Destination.tsx (DestinationInput) and destination.ts internals, TxDetail.tsx, Screen and RadioCards; wasm's in_parts, fit_part, chained, reserving and buildSessionReturn internals (W1a/W1b); core build.rs fee and selection internals (R2a); sessions.ts beyond the claim and return paths; parts.ts pump and split. Ran only reads (grep, sed, git log, git blame); no tests, no builds.
