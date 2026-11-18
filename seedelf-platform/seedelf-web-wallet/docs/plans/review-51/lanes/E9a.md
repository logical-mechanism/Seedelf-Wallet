# Lane E9a

Returned by the workflow's agent `abb0cdd6629a2128a`, written here by the lead from its structured answer.

## Findings (6)

### e9a#1 · low · A token's details offer Send or Make private/public for a token with no spendable units, and the form silently drops it, with Review greyed and no reason

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Home.tsx:572`
- **Who:** user · **Since:** web-wallet/1.2.0 (d423b79a) · **Confidence:** traced
- **Needs the owner:** The fix changes what a token's details offer, or adds a line to the forms.

**Scenario:**

Say the public account holds UTxO A (2 ₳ + 100 FOO), which the user locked on UTxOs, and UTxO B (50 ₳), which is free. Home's token list shows 100 FOO, because it lists every token, locked ones included. The token's details offer Send, because canMoveIn is true while B is free. Pressing Send opens the public Send with FOO picked, but the form shows no FOO box. Once a recipient is read, Review stays greyed and nothing under it says why. Typing an ADA amount turns Review on, and the payment goes out without FOO. The same happens when all of a token's units are on their way back with a pending payment's change and Home's 10-minute hold is over. It also happens on the private side (Transfer, Withdraw) and in Make private (MoveIn.tsx:56-62). No money is lost, but the flow is a dead end with no reason given, for exactly the token the user asked to pay.

**Evidence:**

Home.tsx:794-795 builds the token lists from withComing(balances.<side>), the whole side with locked and incoming tokens. Home.tsx:572-578: tokenAction is offered whenever canMoveIn/canSpend holds, and setPicked({[tokenKey(token)]: ""}). Home.tsx:650-653 gives CardanoSend cardano={free.cardano}, which is unlocked(), so a fully locked token isn't in it. Recipients.tsx:53-65: heldFor maps only `held`, so the picked key with no held token is dropped. TokenAmounts.tsx:61-62: tokenChoices loops over held and skips it, so sent=[] and ok=true. TokenAmounts.tsx:108 picked = held.filter(...), so no box is drawn. CardanoSend.tsx:121-129 calls waitingFor with tokensPicked = Object.keys(draft.tokens).length > 0, which is true. Recipients.tsx:166-167 then gets lovelaceToSend("", true) = "0" (AdaInput.tsx:19), so no amount reason. But Recipients.tsx:71 computes lovelaceToSend("", tokens.sent.length > 0) = parseAda("") = undefined, so ok=false. CardanoSend.tsx:111 makes ready false, and ReviewWait (Recipients.tsx:177-187) shows nothing because every reason is undefined and tooMuch is false. MoveIn.tsx:56-62 follows the same pattern (tokensPicked from tokenAmounts' keys, withTokens from tokens.sent).

**Fix:**

Pick a token in the form only from the side's free tokens. A token the side holds but can't spend now gets a field note in the form ('locked' or 'on its way back') and a ReviewWait reason. Alternatively, TokenDetails omits Send/Make private there and says why. Fix it at the family's root: waitingFor's tokensPicked should come from tokenChoices(...).sent plus the problems, not from the typed keys. Do it in CardanoSend, Transfer, Withdraw and MoveIn together. A Vitest can show it: recipientAmounts('preprod', [], [{id:0,to:'x',amount:'',tokens:{'p.a':''}}], false).ok === false, while waitingFor({to:'ok',amount:'',tokensPicked:true,tokensOk:true}) === undefined.

**Known check:**

Searched backlog.md and docs/archive/plans/*.md for "token's details", "token details", "picked token", "locked token", T-1 and PY-9. PY-9 fixed Review waiting silently for typed problems, not for a picked token with nothing held. Nothing recorded.

### e9a#2 · low · Transaction details show an unlisted token in raw units, while the review above them and Home scale it by Koios's decimals

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/TxDetail.tsx:351`
- **Who:** user · **Since:** web-wallet/1.1.0 (c406d69c, the transaction view) · **Confidence:** traced

**Scenario:**

Take an unlisted token FOO (not in the wallet's 32-token list) whose decimals Koios or the data layer knows: 6, from the registry file of 1,176 tokens. Home shows 1.5 FOO. The user sends 1.5 FOO on the public Send. The review row says "1.5 FOO", but the output under Transaction details reads "1,500,000 FOO". Activity and Home agree with the review, so only the transaction view is off, by 10^decimals. The same view opens under every review, including Make private, Transfer and Withdraw. It is also the connector's sign-window detail (site=true). It always overstates and never understates, so no money moves wrongly, but the one view meant to show 'the transaction itself' contradicts the review it sits under. The blind test saw this ('1,234,560,000 asset1aetp…'), and only Activity got the fix.

**Evidence:**

TxDetail.tsx:351-354: amount = formatQuantity(abs, tokenDecimals(network, t)), with t a TxAsset. rpc.ts:1186-1195: TxAsset is {policyId, assetName, nameText, quantity}, with no decimals. tokens.ts:66-68: tokenDecimals = registry ?? t.decimals ?? 0, which gives 0 for an unlisted token. Against that, CardanoSend.tsx:183-191 builds review rows with tokenQuantity(network, {...held, ...tk}), where held = cardano.tokens with the reading's Koios decimals. Withdraw.tsx:182-189, Transfer.tsx:194-201 and MoveIn.tsx:118-125 do the same. background/activity.ts:286-299 (withDecimals) fixed blind test E01 for Activity only. blind-task-usability-test.md:499 records the tester seeing '#1 2.728014 ₳ plus 1,234,560,000 asset1aetp…kf6dul' in Transaction details. DappApprovals.tsx:1035 uses the same tokenDecimals on decoded assets (lane E3b).

**Fix:**

Give the transaction view the reading's decimals. The worker's tx-view.ts can attach decimals to each TxAsset from the kept Balances, as activity.ts withDecimals does, or the UI can pass a decimals map from Home's balances into TxDetailBody and DappApprovals. Then every view formats through tokenQuantity with the same TokenRef & {decimals}. Do DappApprovals' summary in the same change (E3b's lane).

**Known check:**

Searched backlog.md and archive/plans for decimals, "raw units", tokenDecimals, TxAsset and "transaction view" with token or unit. launch-review.md #55 unified the forms and lists only. blind-task-usability-test.md:1933 and :2536 record the scaling mismatch, and the fix carried decimals onto Activity entries only. Nothing settles the transaction view.

### e9a#3 · low · UTxO details call any address under payment key 0/0 'Your receive address, the one Receive shows', whatever its stake part

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Utxos.tsx:411`
- **Who:** stranger · **Since:** web-wallet/1.2.0 (d423b79a) · **Confidence:** traced

**Scenario:**

A stranger reads the user's Receive address on chain. They pay 1 ₳ to a base address built from the account's 0/0 payment key hash and the stranger's own stake key hash. The wallet counts it, since it matches by payment key, and spends it later like any other UTxO. In UTxOs, opening that row shows the address with Copy, shortened to 16…8. Its head matches Receive's address, while the stake part and the checksum tail differ. Under it the screen says "Your receive address, the one Receive shows." A user who copies the address from there for an exchange withdrawal or an invoice sends those payments to an address staked to the stranger. The stranger gets the rewards and voting power on that ADA until the wallet next spends it. An enterprise address under the same key reads the same and earns nothing. The '.other' and '.change' notes make the same kind of claim for 0/i and 1/i keys.

**Evidence:**

Utxos.tsx:411-420 picks the note from utxo.path alone: role 1 gives change; index 0 gives 'utxos.addressWhose.receive'; anything else gives other. en.json:2906 has 'utxos.addressWhose.receive' = "Your receive address, the one Receive shows." coin-control.ts:318-322 sets path: { role: p.role, index: p.index }, which is the payment key's place only, with nothing about the stake part. Utxos.tsx:401-409 puts CopyField value={utxo.address} display={shortHex(utxo.address, 16, 8)} beside it. Receive shows wallet.ts:489 receiveAddress(net, 0), the base address with the account's 2/0 stake key (seedelf-crypto/src/cardano.rs:108-119). docs/keys-and-accounts.md rule 1: 'our key with someone else's stake key, are found and spent too'.

**Fix:**

Have the worker mark the one UTxO whose address equals the account's receiveAddress(net, 0), or that carries the account's own stake key (carriesStakeKey). Say 'the one Receive shows' only then. For the same key under another stake part, say it's the user's key with someone else's stake key (or no stake key), and that Receive's address is the one to share. Reword the .other/.change lines the same way.

**Known check:**

Searched backlog.md and archive/plans for "someone else's stake", "stranger's stake", addressWhose, "the one Receive shows" and AC-4. AC-4 added this note, and the 2026-11-02 bounty (#359) covered the reverse shape (a stranger's payment key under our stake key). chunk-28 covers listing such UTxOs, not this wording. Nothing recorded.

### e9a#4 · low · Public activity's Save as CSV note says the file holds nothing the chain doesn't, but its rows name the user's own Make private and Make public

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Activity.tsx:126`
- **Who:** user · **Since:** web-wallet/1.0.0 (the note from 2185c4b3, kept by c06572dd; the named public rows from ade9dd1a) · **Confidence:** traced
- **Needs the owner:** The fix changes a privacy note's words, or what the export writes.

**Scenario:**

On the device that made them, Public activity names a Make private "Made private" and a Make public to the account "Made public". These are the private history's own kinds. The user saves Public activity as CSV for an accountant or a tax tool. The note under the button says "The file isn't encrypted, though everything in it is on the chain anyway." On chain, though, a Make private reads the same as paying someone else's Seedelf (privacy.md, Making money private), and a Make public reads as anyone's Seedelf spend paying the account. The file's Type column tells whoever gets it that those deposit outputs, and those spent contract UTxOs, were the user's own. From there, the user's later private spends of that money can be followed. The privacy note the user decides on says the opposite.

**Evidence:**

Activity.tsx:120-130: ExportNote uses 'activity.export.privacy.public' for the public side, and en.json:70 gives "The file isn't encrypted, though everything in it is on the chain anyway." background/activity.ts:492: own = the private history's entries except 'received'. activity.ts:834 sets mine = own.get(tx.tx_hash), and :862-863 makes kind = named.kind. So a move-in is 'move-in' and a withdraw to the account is 'withdraw', titled 'Made private' and 'Made public' by ui/activity.ts:29-47. ui/activity.ts:223 writes csvCell(activityTitle(e)) in every row, along with the private history's detail (activity.ts:347-354, the addresses a Make public paid). privacy.md 'In short' says who owns each private UTxO is hidden from people reading the chain. privacy-review.md §2.21 reworded the private side's note only. privacy-notes.test.ts:39-42 pins the public wording as it stands.

**Fix:**

Either say on the public note that rows the wallet names from its own records (Made private, Made public) tell whoever has the file that this was the user's own private balance, or write those rows in the public CSV as the chain reads them (Sent/Received to the contract). Update privacy-notes.test.ts and privacy.md's Save as CSV section with it.

**Known check:**

Searched backlog.md and archive/plans for "on the chain anyway", export.privacy, "Save as CSV", 2.21 and "public csv". privacy-review.md §2.21 fixed the private note only. §4.6 mentions 'the public Activity's labels on old move-ins' as a cost, not the CSV note. Nothing settles it.

### e9a#5 · nit · Private activity's CSV includes a private payment still marked Pending, against exported()'s own promise

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Activity.tsx:305`
- **Who:** user · **Since:** web-wallet/1.2.0 (8de4dc64) · **Confidence:** traced

**Scenario:**

The user uses Send privately. Koios answers the submit, and the private history writes the entry at once. While Home watches the payment, Private activity lists it as Pending. Save as CSV writes it as a sent payment and counts it in 'Saved N transactions', even though the code next to the button says pending rows stay out because they aren't on chain yet. If that transaction never lands (a mempool drop, or a conflicting spend from another device with the phrase), the file, and the list, keep a payment that never happened.

**Evidence:**

Activity.tsx:221: pending(e) = !!e.pending || e.txHash === pendingHash, so the private side is Pending through pendingHash alone. Activity.tsx:301-305 comments "What's pending isn't in the file: it isn't on chain yet", then calls download(activityCsv(...)) and setSaved(exported(entries).length). ui/activity.ts:243: exported filters only e.pending. rpc.ts says ActivityEntry.pending is 'The Cardano account's only'. background/pending.ts:533 writes the private entry after an answered submit, before it's in a block.

**Fix:**

Pass the watched hash into the export (exported(entries, pendingHash)), or have the worker mark private entries pending until their landing is seen. A private history entry whose transaction is let go as never landed could also be marked or dropped (see notes).

**Known check:**

Searched archive/plans for exported, "pending" together with CSV, and blind test §9.3. §9.3 added public pending rows and kept them out of the file. The private side's pendingHash marking was never matched in exported. Not recorded.

### e9a#6 · nit · Activity's details label a private session's funding or return, and a box back from Lovejoin, as 'Seedelf'

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Activity.tsx:428`
- **Who:** user · **Since:** web-wallet/1.2.0 (d423b79a) · **Confidence:** traced

**Scenario:**

In Private activity, opening an 'Into a private session' entry shows the row "Seedelf: Private session 3". 'Back from a private session' reads the same way, and 'Back from Lovejoin' reads "Seedelf: Lovejoin". None of these names a Seedelf. The comment says the label is for the Seedelf a mint made or a removal removed.

**Evidence:**

Activity.tsx:337: <Row label={t(detailLabel(open.kind))} value={openDetail} />. Activity.tsx:428-432: detailLabel returns 'activity.row.from' for received, 'activity.row.to' for sent/send/withdraw/transfer, and 'activity.row.seedelf' for every other kind. en.json:100 gives 'activity.row.seedelf' = "Seedelf". ui/activity.ts:89-94: activityDetail gives t('claim.session', …) for session-out and session-back. background/activity.ts:347 sets detail "Lovejoin" for lovejoin-withdraw.

**Fix:**

Add labels for session-out and session-back (the session: 'To'/'From') and lovejoin-withdraw ('From'), and keep 'Seedelf' for mint and remove only.

**Known check:**

Searched archive/plans for detailLabel, row.seedelf and 'labelled "Seedelf"'. A-1 (chunk 23) fixed a public Send's recipient labelled Seedelf, not these kinds. Nothing recorded.

## Guards (16)

| Where | What it stops | Test |
|---|---|---|
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/Recipients.tsx:53` | heldFor: one token split across several recipients can't add up to more than is held (each box's max is what the others leave) | none found by name; screens-wiring-review-fixes.test.ts renders the forms |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/TokenAmounts.tsx:73` | tokenChoices refuses a token amount over what's held, a zero, or more decimals than the token has, before Review | token-amounts-hidden.test.ts; payment-forms.test.ts (waitingFor) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/format.ts:288` | sanitizeAmount keeps the previous value past max (all ADA there is, or the token held), and drops extra decimals rather than rounding, so an amount never grows | format.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/format.ts:166` | parseQuantity rejects misplaced commas and reads a decimal comma ('12,5' is 12.5, never 125) | format.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/AdaInput.tsx:18` | lovelaceToSend: 0 ADA with no token isn't an amount; empty with tokens asks only the minimum | payment-forms.test.ts ('why Review waits') |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/CardanoSend.tsx:110` | tooMuch: an early stop on asking more than the account can pay (the builder decides exactly) | none found by name |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/CardanoSend.tsx:164` | Total leaving counts every payment and token but those to the active account's own address; a stranger's key under our stake key counts as leaving | screens-wiring-review-fixes.test.ts ('counts the payment and its token as leaving') |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/ReviewTotals.tsx:63` | '… after' = Home's figure (locked, rewards, incoming in) less what leaves, clamped at 0 (line 100) | review-totals-incoming.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Home.tsx:502` | watching: while a sent transaction is held (10 min, or until a maybe-sent one settles), every payment action, token details' actions, Remove, Staking, Collateral and dApps are held, with the reason said | home-review-fixes.test.ts (unwatched); home-says.test.ts (privateWhy) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/PendingBanner.tsx:297` | A payment that may have gone through has no Dismiss, so it can't be hidden and paid again | maybe-sent.test.ts, home-review-fixes.test.ts (not run) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/format.ts:376` | unlocked(): locked UTxOs and the collateral are out of what a form may spend | covered through the forms' tests (home-review-fixes.test.ts); none by name |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Utxos.tsx:54` | lockable: a Seedelf's UTxO, the collateral and an unspendable one get no lock toggle (the worker refuses the first two, coin-control.ts setLocked) | none found by name |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/activity.ts:243` | exported: the public account's pending rows stay out of the CSV (but see e9a#5 for the private side) | e2e/extension.spec.ts:1615 (export-saved count) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/activity.ts:177` | csvCell: a stranger's note, a token name or a detail can't run as a spreadsheet formula | activity.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/Destination.tsx:63` | Part of a Seedelf name is refused with the name's rule, never read as an address; a read counts only for the exact text it read (CardanoSend.tsx:95-96) | none found by name |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/CardanoSend.tsx:338` | HandleWarning before an ADA Handle goes to someone's Seedelf (anyone can take what's paid to it there) | none found by name |

## Checked and holds

- Receive hands out the active account's base address 0/0 with that account's own stake key 2/0 (wallet.ts:489, cardano.rs base_address), plus that account's stake address behind a disclosure. No other account's key is in it, so it ties no accounts. Home remounts on every account or network switch (App.tsx ScreenForAccount), so the address and the named account always match.
- The QR code on both Receive screens encodes exactly the string shown and copied (QrCode uqr encode of the same text). A Seedelf card's name is the whole hex token name.
- Home's public figure is UTxOs + rewards + what's on its way, and the private figure is UTxOs + what's on its way. reviewTotals passes the same figures to every review's '… after', so a review's 'after' matches Home.
- The public Send's Total leaving counts the fee and every payment except one to the active account's own address. It counts a stranger's key under our stake key, and another of the user's accounts. Rewards a send withdraws aren't counted as leaving, since Home's total already holds them.
- summary.payments[i] lines up with drafts[i]: send.ts pay() maps destinations[i] onto the WebAssembly result in request order, so each review row's 'raised from' compares against its own recipient's ask.
- The worker resolves each recipient again at build (send.ts build), and the review shows the whole resolved address, handle and Seedelf name, never shortened.
- Review token rows use the held token's Koios decimals, the same decimals the form parsed with, so typed and reviewed amounts agree. Tokens on their way back get decimals from the reading (incoming.ts decimalsOf), so Home's list scales them right.
- Amount parsing: commas are grouped or refused, never dropped silently. Extra decimals are truncated, never rounded up. ADA is capped at the supply and a token at what's held. 0 ADA alone is no amount. Max is a single-recipient mode and turns off when a recipient is added.
- Notes are cut by code points, as core counts characters, and core splits anything over 64 bytes into CIP-20 lines (note.rs MAX_LINE_BYTES).
- Home's hold disables every new payment while a sent transaction is watched. A maybe-sent payment holds everything until the worker settles it and has no Dismiss. Each disabled action says why under it.
- Public activity rows show the account's net change less withdrawn rewards plus the fee, with the fee apart. Fee-only rows (collateral, a vote, rewards withdrawn) show the fee. Sent never carries a plus. The CSV's ADA less the fee is what the balance did.
- Activity, Utxos, Tokens, the forms' aside lines and the token boxes all mask amounts while balances are hidden.
- Home's re-reads after a send come from the kept reading with no request. A private spend's landing re-reads only the private side, and the collateral status asks no one beyond the kept reading.
- Explorer links carry the 'tells Cardanoscan' note for private kinds, stealth mints and private-paid pool starts (PendingBanner privateBanner).
- TxDetail shows the hash worked out from the bytes it shows. It shows each output address whole and marks a dead register (o.register.payable). The decoder refuses CBOR nested past 128 levels, so a site's metadata can't blow up the tree.
- The Utxos screen offers no lock for a Seedelf's UTxO, the collateral or an unspendable UTxO, and each change re-reads Home from the kept reading.
- SessionRefused's refusalOf watches a funding whose record may have gone out, rather than building a second one, and matches the record by the reviewed txHash.

## Notes

- The private history keeps an entry for a send whose answered submit never lands (pending.ts:533 writes it at submit; only maybe-sent ones wait to be seen, :773). After a mempool drop or a conflicting spend from another device with the phrase, Private activity, and its CSV, keep a payment that never happened, while the balance gets the money back once the spent hold ends. It needs an outside event, so it isn't a finding.
- Home fetches the account (call('account')) once at mount and never retries. If that one call fails transiently while the balances succeed, 'Receive publicly' stays disabled. The Private tab's 'Show my public address' and Get started's first step then set screen 'receive', which can't render without the account, so the press seems to do nothing until Home remounts.
- coin-control.ts setLocked refuses a Seedelf's UTxO and the collateral, but not an `unspendable` (reference-script) one. On the private side, locked() would then count it while seedelf.lovelace (spendableOwned) leaves it out, so unlocked() subtracts it twice. No UI path locks one today (Utxos lockable), so this is a guard gap with no reach.
- PendingBanner validUntil says a public payment can land until submittedAt + 2 h, but its slot is build time + 2 h, so the figure is late by however long the review sat. pending.ts also waits age > VALID_FOR_MS from submittedAt before calling it expired. Both are conservative, with no money effect.
- Private Receive says "Only someone using Seedelf Wallet can pay this." privacy.md and the Words section say the CLI can too. Wording only.
- Activity's Refresh isn't disabled while Load more reads. The two can race on the kept pages in session storage, and the later write wins, so the list can drop the page just loaded. Cosmetic.
- e9a#2's units problem is shared by DappApprovals.tsx:1035, the sign window's own rows (lane E3b).
- Home's Get started 'Make private' step enables on balances.cardano.utxos rather than the free count. With every UTxO locked it opens Make private with nothing to spend. It's minor, and the form says it's empty.

## Coverage

Read in full, every line: screens/{Activity,CardanoSend,Home,Onboarding,Receive,Tokens,Utxos}.tsx and components/{TxDetail,PendingBanner,TxBanner,ReviewRows,ReviewTotals,PaidRows,Recipients,AccountRecipients,Destination,TokenAmounts,TokenList,AmountField,AdaInput,HandleWarning,StakedWarning,HistoriesNote,LeftOut,SessionLeft,SessionRefused,StaleReview,SendButton}.tsx (7,054 lines). Followed, reading the parts that matter: ui/format.ts (formatQuantity, parseQuantity, sanitizeAmount, unlocked, withRewards, spentRewards, formatFiat), ui/tokens.ts (all), ui/activity.ts (all), ui/accounts.tsx, ui/background.ts call, preferences useAmounts, ExplorerLink, QrCode, RefreshRow; the MoveIn/Withdraw/Transfer review token rows; background/send.ts (all), destination.ts (all), activity.ts (sent, withDecimals, cardano, describe, matcher), incoming.ts (incomingOf, summed), balances.ts (get, reading, seedelfSide, withLocked, withIncoming), coin-control.ts (locked, lists, setLocked, collateral), handlers.ts (history, utxos, collateral), pending.ts (the submit and watch paths that write history), wallet.ts account(); shared/rpc.ts types; seedelf-crypto cardano.rs base/stake address; wasm lib.rs receiveAddress and buildAccountSend bindings; core note.rs limits; decode.rs nesting check; en.json for the strings each screen shows; privacy.md and keys-and-accounts.md sections on Receive, accounts, the Network section and CSV; the backlog and archived reviews for each candidate. Not reached: WebAssembly's api::account_send itself (W1b), tx-view.ts, the screens Home opens but other lanes own (Staking, Collateral, CreateSeedelf, Dapps, Swaps, Lovejoin, RemoveSeedelf, DappApprovals beyond its token units), the e2e spec, and the es/ja strings. Ran nothing but reads and git.
