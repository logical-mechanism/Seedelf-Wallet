# Lane E3b

Returned by the workflow's agent `af28d4feff93e42ae`, written here by the lead from its structured answer.

## Findings (5)

### e3b#1 · low · The sign window shows a site's CIP-8 message and CIP-20 note with direction overrides and invisible characters still active, and the note isn't checked against the body

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:1369`
- **Who:** site · **Since:** fe8b7748 (the connector's first commit, 2026-09-24); chunk 17's CBOR review (2026-10-01) fixed the transaction view only · **Confidence:** traced

**Scenario:**

A connected site calls signData(addr, hex of 'Pay 1' + U+202E + '0001' + U+202C + ' ADA to stake1…'). The window shows 'The message: Pay 11000 ADA to stake1…', but the bytes the key signs read 'Pay 10001 ADA…'. A plain U+202E + 'drowssap' shows as 'password'. The same happens in signTx's 'Its note, which anyone can read' (a CIP-20 msg line). The note has a second gap: inspect reads tx.auxiliary_data without comparing it to body.auxiliary_data_hash. So a site can send signTx metadata the body doesn't commit to, show the user a note, get the signature (over the body alone), then submit with the committed metadata. The window showed a note that never reaches the chain. No ADA moves through the text itself. Harm needs someone to act on the signed message's words (a verifier of free-form CIP-8 text), or it misleads about the on-chain record. Every other place the wallet shows a site's text strips or escapes these characters.

**Evidence:**

extension/src/background/dapp.ts:2892-2900, readableText: `const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) ? undefined : text;`. Only C0 controls and DEL are refused; U+061C, U+200B–U+200F, U+202A–U+202E, U+2066–U+2069 and U+FEFF pass. The worker puts `text` on the approval (dapp.ts:2527-2530, `...(text === undefined ? {} : { text })`). DappApprovals.tsx:1369-1371 renders `<pre className="dapp-message">{text ?? payload}</pre>`. wasm/src/cip30.rs:1050-1061, note_of: `Metadatum::Text(t) => Some(t.clone())`, unfiltered. cip30.rs:1770-1773: `let (metadata, note) = match &tx.auxiliary_data { Nullable::Some(aux) => note_of(aux), ... }`, with no auxiliary_data_hash check. DappApprovals.tsx:1282-1284 renders `<pre className="dapp-message" data-testid="dapp-note">{s.note.join("\n")}</pre>`. styles.css:3705 `unicode-bidi: isolate` only keeps the direction inside the element: an explicit RLO inside the text still reverses what follows it. Already fixed elsewhere: dapp.ts:465-472 siteTitle strips exactly these characters ('one starting with U+202E reversed the origin'); cip30.rs:1903-1917 anchor_url filters is_bidi (C14); decode.rs:853-884 `shown()` writes them as \u{...} and decode.rs:809-821 `metadata_hash_matches` checks the hash, for the transaction view. tests/dapp.test.ts:925 checks only plain text; tests/dapp-site-title.test.ts covers titles alone. A verifier's test: renderToStaticMarkup(<SignData text={'Pay 1'+'‮'+'0001'+'‬ ADA'} .../>) and expect no raw U+202E in the markup (it's there today). A cargo test on cip30::inspect_tx with a 674 msg holding U+202E shows summary.note carrying it raw.

**Fix:**

Escape the text the way decode.rs's `shown()` does, writing each hidden character as \u{XXXX}, for every site-supplied text in the sign window: CIP-20 note lines (cip30.rs note_of, or decode::shown at note_of) and the CIP-8 text (dapp.ts readableText, or show the hex when the payload holds one, as it does for a C0 control). In inspect, read the note only when the aux data hashes to body.auxiliary_data_hash, as decode.rs metadata_hash_matches does. Otherwise show nothing, or a line saying the metadata isn't what the body commits to (new words). The family is site text in the connector window. Fixed already: titles (siteTitle), DRep anchors (anchor_url), governance texts (governance.ts shownText), token names (ui/tokens.ts HIDDEN). These two are the members left.

**Known check:**

Searched backlog.md and docs/archive/plans/ for bidi, 202e, U+202, invisible, readableText, itsNote, dapp-note, dapp-data-message, 'the message', 'CIP-20'. Found only chunk-17's CBOR review (fixed for the transaction view), siteTitle's fix and C14 (anchors). Nothing on the sign window's note or the CIP-8 text.

### e3b#2 · low · The connector's private-session form counts locked private UTxOs as available

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:607`
- **Who:** user · **Since:** b134a737 (chunk 15c, 2026-09-25); locks existed since 97d7cdd7 (2026-09-24) · **Confidence:** traced

**Scenario:**

The private balance holds 100 ₳, and the user has locked 60 ₳ of it (UTxOs screen). A site asks to connect and the user picks A private session. The window says '100 ₳ in your private balance. 5 ₳ more goes in…'. The user types 50: the form raises no 'more than' note and Review is enabled. The worker's build leaves locked UTxOs out and refuses: 'Not enough ADA in your private balance for this, its fee and the change.' This contradicts the 100 ₳ just shown, and the window never mentions the lock. On the dApps page, Top up for the same balance says 40 ₳. A token held only in a locked UTxO is also offered at its full quantity, and its build fails the same way. No money is lost: the refusal is in words, but the figure is off by everything locked.

**Evidence:**

DappApprovals.tsx:605-611: `call("balances", {}).then((b) => setSeedelf(b.seedelf), …)` is the raw reading. balances.ts:420-422 sums every spendable owned UTxO into `lovelace`, with the locks reported apart (balances.ts:295-297 withLocked). format.ts:376-385 `unlocked()` is what takes the locked out. DappApprovals.tsx:684-688: `tokenChoices(network, seedelf.tokens, typed)`, `tooMuch = … BigInt(lovelace) > BigInt(seedelf.lovelace)`, canReview from those. :976-983: 'heldAndCollateral' and 'sites.topUp.tooMuch' with `amounts.ada(seedelf.lovelace)`. :986: `<TokenAmounts held={seedelf.tokens} …>`. The build leaves locks out: script-spend.ts:243 `const utxos = await deps.coins.seedelf(network, free);` → coin-control.ts:259-262 filters `choices.seedelf`. Every other form gets the spendable side: Home.tsx:518-521 `free = { …, seedelf: unlocked(balances.seedelf), … }` → Dapps → SiteSession → TopUp (SiteSessions.tsx:569-573). The same window already unlocks it for its 'after' row (DappApprovals.tsx:804, `homeBalance(unlocked(seedelf))`).

**Fix:**

Hold the form to `unlocked(b.seedelf)`, as Home hands every other form, and keep `homeBalance(…)` for the review's 'before' as now. Where something is locked, say so beside the line as the forms do (format.ts lockedAside). Check the other screens that call `balances` themselves rather than taking Home's `free` (grep `call("balances"` under src/ui): none of them should cap an amount at the raw side.

**Known check:**

Searched backlog.md and archive/plans for heldAndCollateral, 'locked' with connector, 'unlocked(seedelf', 'in your private balance', CW-2. Nothing found.

### e3b#3 · low · While a sent private-session funding waits, every request behind it is hidden: no count, no Decline all, and closing the window declines them unseen

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:626`
- **Who:** user · **Since:** d423b79a (chunk 23's fixes, CW-7, 2026-10-05) gave every other screen the queue; the funding screen is b134a737 · **Confidence:** traced
- **Needs the owner:** It changes what the funding screen offers (a queue line and Decline all), or the order the window shows requests in.

**Scenario:**

The user funds a private session for site A. Funded in parts, each part waits a block for the one before it, so it takes several minutes, and up to FUNDING_WAIT_MS (20 min) if it's slow. Meanwhile site B, connected to the public account, asks to sign, and site C asks to connect. ask() brings the window to the front, but it still shows 'Funding a private session…' with no '1 of 3 waiting' and no Decline all, because the funding is approvals[0] and stays there until it lands. B and C wait unseen. If the user closes the window, as the screen invites ('closing this window doesn't undo it'), windowClosed declines B and C without the user ever seeing them, and refuseFor turns C away (10 s, then 1 min, then 5). That breaks the worker's own rule that a request is never declined unseen.

**Evidence:**

DappApprovals.tsx:246 builds `queue` and passes it to ConnectRequest. :626-649, the `approval.funding` branch, renders only `{site}`, the spinner, the ExplorerLink and `tr("dappUi.canClose")`: no `{queue}`, no `<Changed>`. Compare :672 (governance) and :879 (connect), which render `{queue}`. The worker keeps the funding first: dapp.ts:633 lists approvals in `waiting` order, and the funding is sent from `current`, which is approvals[0]. dapp.ts:1454 `w.approval = { ...w.approval, funding: { index, txHash } }` leaves it in place. watchFunding (dapp.ts:1456-1505) removes it only when the funding has landed, is short or never landed, or after FUNDING_WAIT_MS (dapp.ts:206, 20 min). windowClosed (dapp.ts:769-805) declines everything but fundings (`closed = this.waiting.filter((x) => !funding(x))`, :782) and calls refuseFor on connects. e2e covers the funding flow (extension.spec.ts ~5366-5420) but never a request arriving while it waits. A verifier's Vitest: renderToStaticMarkup(<ConnectRequest approval={{…, kind:'connect', funding:{index:0, txHash:'aa…'}}} queue={<p data-testid="dapp-queue"/>} …/>) has no 'dapp-queue'.

**Fix:**

Render `{queue}` on the funding screen, its Decline all already skipping fundings (DappApprovals.tsx:197). Or have approvals() list a sent funding after the requests still to answer, so they show first and the funding's screen comes back once nothing else waits. Either way the window says what waits behind the funding before its 'you can close this' line is acted on.

**Known check:**

Searched backlog.md and archive/plans for 'behind the funding', 'waits behind', 'funding screen', waitingForFunding, 'funding.*queue', 'queue.*funding', 'Decline all', 'second window'. CW-7 (usability-review.md:715) asked for '1 of N' with Decline all, and its fix (d423b79a) left this screen out. Nothing records the gap.

### e3b#4 · low · An approved request's failure stays on screen over the next request, right above its Sign

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:169`
- **Who:** user · **Since:** fe8b7748 (2026-09-24) · **Confidence:** traced

**Scenario:**

Request A (site X's signTx) is approved. From the main window, the user has meanwhile locked one of its UTxOs, so approve() throws at keptApart ('…spends a UTxO you locked…'). The worker had already taken A out of the list, so it's gone. B (site Y's signTx) becomes current, showing 'The next request.', and A's error sits in B's foot as role=alert, directly above B's Decline and Sign. Nothing says the error was A's, so the user can take it for B's. The same happens for any failure after approval: a Lovejoin chain started meanwhile (heldForLovejoin), the site disconnected (stillConnected), or a signing failure. Only confusion, no money; the safe reading is to decline B.

**Evidence:**

DappApprovals.tsx:165-170: `if (result.error) { setPassword(""); if (extra.fund) return {…}; setError(result.error); return false; }`, and :174-176 the same for a throw. :178-180 `finally { setBusy(false); load(); }` reloads the list. dapp.ts:686 `const [w] = this.waiting.splice(i, 1);` runs before approve (dapp.ts:701), and a failure rejects w and returns `{ error: error.message }` (dapp.ts:713-715), so A is gone by the reload. The effects keyed on currentId (DappApprovals.tsx:120-121, 128-130, 138-147) clear the password, `declined` and the hold, never `error`. Screen.tsx:148-154 renders `error` in the foot above `foot` (the buttons), role="alert". The empty-list case keeps the error on purpose (the close timer waits on `!error`, :103), and that case is right.

**Fix:**

Tie the error to the request it came from: keep `{ id, text }` and show it only while `currentId === id`, or clear it when currentId changes to another request, but keep it once the list is empty. setError from load() failures has no id and can stay as it is.

**Known check:**

Searched backlog.md and archive/plans for 'error.*next request', 'stale error', 'error stays', nextRequest, 'request's error'. Nothing found.

### e3b#5 · nit · A sent funding's Cardanoscan link follows the wallet to the other network

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:642`
- **Who:** user · **Since:** cb5109b8 (2026-09-27) · **Confidence:** traced

**Scenario:**

A mainnet funding is sent and its window shows 'The funding on Cardanoscan'. The user switches to preprod in the side panel. networkChanged keeps a sent funding, App remounts the window on preprod, and its strip says Preprod. The link now opens preprod.cardanoscan.io/transaction/<the mainnet hash>, which isn't found there.

**Evidence:**

DappApprovals.tsx:559 `const network = useNetwork();` is the wallet's current network. :642 `<ExplorerLink network={network} tx={approval.funding.txHash} private>`. dapp.ts:818 `const left = this.waiting.filter((w) => w.network !== network && !funding(w));` keeps the funding across the switch. App.tsx:279-283 ScreenForAccount keys every screen, the connector window's included, by network.

**Fix:**

Carry the funding's network on the approval (the Waiting's `network`) and link with it. The window's strip could name it too while the wallet is on the other network.

**Known check:**

Searched backlog.md and archive/plans for 'explorer.*network', 'link.*other network', 'wrong network'. Nothing found.

## Guards (18)

| Where | What it stops | Test |
|---|---|---|
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:154` | answer() refuses while busy or held, and refuses an approve without the password or, where contract funds are released, without the user's yes (the Enter path too) | e2e/extension.spec.ts 'a site's request that releases a contract UTxO under the account's key says so, and Sign waits for the user's yes' (~5833); the replaced-request test (~6022) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:318` | Sign disabled until the password and, for a release, the switch | same e2e (~5833) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:126` | the release yes is held by request id, so it never carries over to the next request | same e2e: 'A yes is for one request' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:138` | HOLD_MS hold when another request takes the shown one's place, so a click meant for one can't answer the other (set in an effect: see notes) | e2e/extension.spec.ts 'Its page closes before it's answered' (~6022) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:197` | Decline all skips a private session's funding that's already sent (the worker refuses it too, dapp.ts:661) | none found |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:715` | the funding's Send refuses with a refusal pending, while busy, or with no password | e2e funding refusal (~5389) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:687` | the private-session amount capped at what's held (against the raw side: e3b#2) | none found for locks |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:869` | Connect only once the public account is chosen, never one press from the window opening | tests/dapp-prompt.test.ts 'chooses nothing for the user: Connect waits for a choice' |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/dapp.ts:33` | releasesContractFunds: whether Sign waits for the yes and the release rows and warning show | tests/dapp-prompt.test.ts 'a contract UTxO the account's key releases' (87-200) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/dapp.ts:24` | stakingComesBack: the staking callout is a warning and says 'not all back' when withdrawn rewards or a refund leave | tests/dapp.test.ts:526-534 |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/SiteSessions.tsx:116` | disconnectWait: Disconnect waits while a funding, a return or its chain is on its way, or while the account holds anything | tests/screens.test.ts:783-788 |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/SiteSessions.tsx:370` | a site session's Disconnect disabled while waiting, with why | e2e site session (~5416-5421) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/SiteSessions.tsx:572` | top-up amount capped at the spendable private balance (Home's unlocked side) | tests/hide-balances-forms.test.ts:59 (source text only) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/ConnectedSites.tsx:104` | Settings' Disconnect off while sessions are unread or a session's wait applies | tests/settings.test.ts:258-293 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:2183` | on approval: still connected to the same holder, a Lovejoin chain's held UTxOs, the user's locks and collateral, and the dApp account re-checked before signing with the view's account's keys | tests/dapp-account-change.test.ts, tests/dapp.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:2134` | siteOutSubmit sends only the kept funding whose txHash, network and origin match, within its TTL | e2e funding flow; tests/site-funding-*.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:2405` | topUpSubmit sends only the top-up reviewed (txHash, network), not one already sent | tests/restore-scan.test.ts (C29) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:2560` | a session's Disconnect refused while a fresh read shows its account holding anything | tests/session-site-outs.test.ts (M4) |

## Checked and holds

- The sign window's figures (Total, token rows, released rows, From staking, fee, collateral at risk, validity, It signs for, Pays, Mints) all come from one inspect of one request string. On approval, signDappTx/signSessionTx re-run inspect on that same string (cip30.rs sign_tx) and sign the same body hash. ties only adds `yours` fields.
- The release switch is per request (ackFor === currentId), off while busy or held, enforced on the button and in answer() (the Enter path), and reset on remount. Its condition is the same function SignTx shows the warning by.
- Password: emptied for each request. The window's needsPassword and the worker's check both read the `password` flag the request was asked with, so they agree.
- Network change: the worker declines requests except a sent funding, App remounts the window on a network or active-account change, and answer() re-checks network and dApp account before the password.
- dApp account change: a public-side signature is declined with AccountChange, and the keys that sign are always the view's account's (withViewKeys). The window's account label follows prefs.
- A second request: the screen and ConnectRequest are keyed by request id, so no choice, review, governance switch or yes carries over. 'replaced' or 'next' is said, and the buttons hold for 1 s.
- A double-click on Sign or Send can't answer twice: busy is set inside the click's handler and React flushes it before the next click.
- Decline all never declines a sent funding, and the worker refuses that anyway (alreadyFunded).
- The funding review's rows match what's sent: forSite = payments[0] less the reserve, the reserve on its own row; Total leaving = Σpayments + fee; 'before' = Home's figure (raw + incoming). Send sends only the kept build with that txHash, network and origin.
- Top up builds and sends by txHash. Only a site's session can be topped up (onlySiteTopUp), and its form caps at the spendable side.
- A site session's Disconnect: the page waits as the worker does, and the worker re-reads the account and refuses one holding money. A 'failed' stage can't coexist with a read holding (view(): funded = out.confirmed || utxos.length), so a failed page never hides Bring it back from money it holds.
- Settings' Disconnect for a session's site goes through the same worker check (forget → sessions.disconnect).
- paidTo, tiedName, withdrawalLine, proposalLine and certificateLine handle session index 0 and account objects. `yours` is only set where the item isn't the signer's own.
- signingTies says the other side isn't in it only when the worker checked (ties empty), and never says the private balance isn't in it when a Seedelf is paid.
- CIP-8: the address shown is target.shown() of the same DataFor whose bytes go in the COSE header, and the key named is the one that signs.
- CIP-95 switch on the connect window: off by default, sent only with a public connect, and the worker records granted or declined by it. A private session never gets governance. A connected site's governance-alone ask: Allow grants it; Decline, closing or Decline all keep the connection without it.
- useConnectorSwitch asks Chrome from the click itself, and 'on' needs both the setting and Chrome's grant.
- useDeclined re-reads the worker every 5 s while it ticks, and Let it ask now goes only from the wallet's own pages.
- Token rows take decimals only from the token list (by policy and name), and a lookalike is shown by its fingerprint and warned about.
- Dapps' reread keeps the last read holdings without asking Koios. Every Disconnect and Bring it back the page enables is checked again by the worker.

## Notes

- HOLD_MS and the password clear run in useEffect, after the commit that shows a new request. For the frame between that commit and the effects, the new request's Sign is enabled (held false) and the box still holds the previous request's password, so a click landing in that frame answers the new request. The e2e's toBeDisabled polls past that frame. It's practically unreachable: a site can't time it to the user's click. A sound version works out `held` during render (currentId !== the last shown id) and keys the password by request id.
- For E3a (dapp-window.ts, dapp.ts): ask() doesn't await window.show(), and show() has no in-flight guard. Two requests in one tick (two sites, or a site's signData beside its signTx) can each find no page and each open a popup. Then closeWindow() closes whichever page openPage() finds first, possibly the other one, leaving the caller's window on 'Nothing's waiting.'. windowClosed() then sees a page still open and leaves `closing` true, so the user's later manual close of the remaining window, with requests waiting, re-shows a window instead of declining them. Not traced end to end.
- Fee row wording: 'X ₳, counted in the total' whenever the account has any input (`s.ownInputs`), even when another party's input pays the fee and the account's Total is 0 ₳. And it's plain when the account's rewards withdrawal pays it and the Total does include it. A wording nit (DappApprovals.tsx:1127-1130).
- stakingComesBack treats the fee as the account's. A site that pays a large fee from its own input can take up to that fee from the account's withdrawn rewards, while the callout (info tone) says the rewards go 'into your public account'. Total leaving and the fee row still show the amount. This is the documented heuristic, and there's no high-fee warning anywhere: the owner's call if one is wanted.
- The connector's private-session form reads the balances once, when the private card is chosen, and never again. The review's 'Private balance after' can be stale if the window sits open.
- dappPassword turned on while a request waits: that request still signs without the password, since the window and the worker both use the flag it was asked with. Harmless, noted.
- With the list empty and an error showing, the window stays open on purpose, but offers no in-window Close (only the declined state has one), so the user closes it with the window frame.
- Backlog items met and not re-reported: the worker doesn't check the release switch (⬜, 1.9.0 dapp-ui#1); a burned token reads as released (⬜ L1); the connect card keeps the approval's mark (⬜, 1.8.0 O3); the release-warning limits (❓ L2); Show image and the CIP-95 switch never through a findings round (⬜). For that last one, this lane read the CIP-95 switch end to end and found nothing wrong (see checked_ok).

## Coverage

Read every line of: ui/dapp.ts, ui/sites.ts, ui/screens/DappApprovals.tsx, SiteSessions.tsx, ConnectedSites.tsx, Dapps.tsx. Followed into, read in the parts that matter:
- background/dapp.ts: lines 1-1505 in full; signTx, readTx, ties, publicKeys, remember, signData, submitTx, send and helpers (1755-2949) in full; 1520-1700 (view, read, available, balance) skimmed.
- wasm/src/cip30.rs: Amount and difference (110-290), keys_of and own_address (436-520), output_parts and register_datum (960-1066), released_from_contracts and inspect (1100-1892), anchor_url and is_bidi, sign_tx, CIP-8 data_key, data_signer and sign_data (2185-2400).
- wasm/src/lib.rs: the session and dApp tx and data bindings.
- wasm/src/decode.rs: shown, hidden and metadata_hash_matches.
- background/sessions.ts: siteOutBuild, siteOutSubmit, topUpBuild, topUpSubmit, backBuild, backSubmit, claimBuild, disconnect, view() stage logic, listNow in part, buildFunding.
- Also: script-spend.ts (readContract, whole), coin-control.ts seedelf(), balances.ts seedelfSide and withLocked, dapp-window.ts, handlers.ts (preferences-set, network-set, the dapp cases), sw.ts broadcasts, App.tsx (ScreenForAccount), ui/preferences.tsx, Screen.tsx foot, ReviewTotals.tsx, SessionRefused.tsx, AdaInput and TokenAmounts helpers, ExplorerLink, en.json's dappUi.* strings, and the e2e connector tests cited.
Not reached: the components LovejoinReturn, TxDetail, TokenList, PaidRows, RadioCards and HistoriesNote (other lanes); Swaps.tsx's Session page; Lovejoin.tsx; ClaimAll.tsx; tx-view.ts. No tests were run; every finding is traced from code.
