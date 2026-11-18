# Lane L3sign

Returned by the workflow's agent `a80e894ed344b778b`, written here by the lead from its structured answer.

## Findings (2)

### l3sign#1 · low · A site's payment under the user's register that carries a reference script reads as a plain Seedelf payment, and Transaction details says "Yours, in your private balance", though the balance leaves it out and no web-wallet spend takes it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/tx-view.ts:332`
- **Who:** site · **Since:** unknown, before web-wallet/1.6.0: Transaction details' mark came with 8de4dc64, the balance's exclusion with 0334db01 (launch review #12, which fixed the balance and the UTxOs page only) · **Confidence:** confirmed-by-run
- **Needs the owner:** It adds a warning to the sign window and changes Transaction details' words for the user's own output: new critical strings.

**Scenario:**

A site's signTx pays 4 ₳ (or 100 ₳) from the dApp account into Seedelf Wallet's contract under the user's own register. The datum is inline and canonical (tag 121), and the same output carries a reference script: any script, for example the 5-byte native script [1, []].

What the window shows:
- paid[0] = {datum: "inline", script: true, seedelf: "register"}.
- Pays: "Seedelf Wallet's contract, with data".
- Only the privacy note "It pays a Seedelf. Nothing on chain says whose, but it comes from your public account in the open."
- No warning of any kind. Nothing in the window mentions the script.

What Transaction details, opened from the same window, shows: "Yours, in your private balance" · Seedelf Wallet's contract · under a register · carries a native script.

Once the output is on chain:
- The private balance leaves the row out (balances.ts spendableOwned; script-spend.ts spendable gives 0 rows, unspendable 1).
- No web-wallet Seedelf spend takes it: eval::refusal refuses any row with a reference script.
- The UTxOs page says "It stays yours, left out of payments and your private balance."

So the money the window called a Seedelf payment, and Transaction details placed in the private balance, is in no balance the web wallet shows. Only the CLI's `sweep --all`, which Ogmios evaluates, can bring it back.

This is a sibling that r2sign#1's class fix missed. That fix's rules: call a payment a Seedelf's only where its wallet reads it, and never say "Yours, in your private balance" for what the balance can't show. Nothing is lost, and the money is stranded only for web-wallet users.

**Evidence:**

Lines are FIXTREE's (web-wallet/whole-review-fixes at ad8c3ce4).

The code:
- cip30.rs:1307 `match spender(inline_data(out)) { Spender::Owner => "register", … }` reads the datum alone. The output's script_ref is never looked at.
- DappApprovals.tsx:1245-1247 shows the paysSeedelf privacy callout for "register". The noRegister, deadRegister and datumByHash warnings are for the other readings only.
- decode.rs:1306-1309 reads the register from the inline datum, whatever the output carries.
- tx-view.ts:332 `else if (o.address.seedelf && o.register?.payable && ownRegister(wasm, keys, o.register)) { … o.yours = { kind: seedelf ? "seedelf" : "private" }` gives en.json "tx.yours.private": "Yours, in your private balance".
- The balance's rule: balances.ts:516-517 spendableOwned `!utxo.reference_script`; script-spend.ts:312 spendable and :318 unspendable.
- seedelf-core eval.rs:62-67 refusal: "holds a reference script, which the wallet can't evaluate with yet… Nothing measured in the wallet (a Seedelf spend, …) can spend such a UTxO."
- en.json:2971 utxos.warn.unspendablePrivate: "It holds a reference script the wallet can't spend yet. It stays yours, left out of payments and your private balance."

Run:
- Test file: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/scratchpad/r51/work/L3sign/tests/l3sign-refscript.test.ts. An earlier, interrupted run of this lens wrote it; I read it in full and re-ran it.
- Harness: tests/dapp-datum-hash.test.ts's, unchanged. It drives the real worker and FIXTREE's built WebAssembly: enable, signTx, SignTx rendered, txView, TxDetailBody rendered.
- Command, from FIXTREE's extension/ with node_modules symlinked into the scratch folder: `npx vitest run --dir <scratch>/r51/work/L3sign --reporter=verbose`.

Output with the script:
`L3SIGN withScript=true {"paid":[["inline",true,"register"]],"privacyNote":true,"anyWarnOnSeedelf":false,"notPrivateLine":false,"detailsScriptRef":{"kind":"native",…,"source":"output"},"detailsPayable":true,"detailsYours":{"kind":"private"},"detailsSaysPrivate":true}`
and `row: in the private balance (spendable) 0, unspendable 1`.

The control, without the script, reads the same in the window and in Transaction details, and gives `spendable 1, unspendable 0`. 1 test passed.

**Fix:**

Use the rule spendableOwned, spendable and eval::refusal already share (an owned contract row with a reference script is the user's, but no web-wallet spend takes it), and say it wherever a payment is read.
- Sign window: in cip30.rs inspect, a contract output with a script_ref gets its own reading or flag. The window then warns in the UTxOs page's terms, for example "It pays a Seedelf with a reference script: Seedelf Wallet can't spend it yet."
- Transaction details: in tx-view.ts markYours, such an output is still yours (decode.rs's DetailOutput already carries script_ref), but its tag uses the UTxOs page's "Can't spend" words, never "in your private balance".
- Pin both in register-spellings-style vectors beside the datum shapes, so the window, Transaction details and the balance can't drift apart.

**Known check:**

- docs/backlog.md: searched for 'reference script', "can't spend", 'evaluate with', 'carries a script'. No hits.
- docs/archive/plans/: searched the same terms. Only launch-review.md #12 (commit 0334db01) is about this rule, and it fixed the balance, selection and the UTxOs page, not the window or Transaction details.
- review-51 INDEX.md, FINDINGS.md and owner-calls.md: searched for 'reference script', 'script_ref' and 'Yours, in your private balance'. The hits are w2#4 (getUtxos drops a script), e8b#1 and t1f#5 (collateral), gap-g2#3 (Lovejoin forms) and the CLI fixer's note (3). None is the sign window or Transaction details.
- r2sign#1 and its verify cover the datum shapes (hash, indefinite pair) only.

### l3sign#2 · low · The sign window shows a held token off the wallet's list in raw units, while the Transaction details it opens scale it: 10^6 apart for a 6-decimal token

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:1069`
- **Who:** site · **Since:** 8fd738ff (e9a#2's fix made Transaction details scale); 61a4d717's sibling sweep left the window out · **Confidence:** confirmed-by-run

**Scenario:**

The public account holds 100 FOO, a token off the wallet's list that Koios gives 6 decimals. Home shows 100 FOO.

A site asks to sign a transaction that sends 1.5 FOO (1,500,000 raw units) and 2 ₳ to another address, with the rest back to the account.

What the window shows, each row marked "Not on the wallet's list":
- "Sends 1,500,000 FOO"
- Pays: "An address 2 ₳ 1,500,000 FOO"

What Transaction details shows, opened from the same window: "1.5 FOO" to that address and "98.5 FOO" back to the account. The same output carries two figures 10^6 apart in one window, and only the view's agrees with Home.

How it came about:
- Round one's e9a#2 fix (8fd738ff, tx-view.ts withDecimals) made the view scale.
- Round two's r2sign#3 sweep (61a4d717) gave decimals to the dApp funding row, the top-up review and Remove. It also widened the view's decimals to the account's and the Seedelf's rows, which scales more tokens there.
- It left SignTx's own rows on DappToken, which carries no decimals: netTokens, paid[].tokens, mint and releasedTokens.

No money moves wrongly, since the raw figure only ever overstates. But the window the user signs from contradicts its own view and Home by a factor of 10^decimals.

**Evidence:**

The code:
- DappApprovals.tsx:1069-1072 `const amount = (t: DappToken) => { … formatQuantity(…, tokenDecimals(network, t)) }`.
- tokens.ts:66-67 `tokenInfo(network, t)?.decimals ?? t.decimals ?? 0`.
- rpc.ts:1037-1041 DappToken is {policyId, assetName, quantity}, with no decimals. dapp.ts adds none to the summary.
- tx-view.ts:204-224 withDecimals sets `a.decimals` on every output's, the collateral return's and the mint's assets, from balances.ts decimalsOf. Since 61a4d717 that covers SESSION_ACCOUNT_UTXOS, the kept contract view's owned rows and the reading's tokens.
- 61a4d717 gave decimals to the funding row (DappApprovals.tsx:750-755), the top-up review (SiteSessions.tsx:625-629) and Remove (withdraw.ts), but not to SignTx.

Run:
- Test file: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/scratchpad/r51/work/L3sign/tests/l3sign-window-units.test.ts.
- Harness: tx-detail-decimals.test.ts's and dapp-datum-hash.test.ts's. It drives the real worker and WebAssembly over the fake Koios: 100 FOO at 6 decimals, the reading taken, then a hand-written signTx paying 1,500,000 FOO.
- Command, from FIXTREE's extension/: `npx vitest run --dir <scratch>/r51/work/L3sign --reporter=verbose l3sign-window-units`.

Output: `L3SIGN units {"netTokens":[{…"quantity":"-1500000"}],…,"window1":["17 ₳ Sends 1,500,000 FOO Not on the wallet's","… An address 2 ₳ 1,500,000 FOO Not on the wallet's"],"details1":["1.5 FOO","98.5 FOO"]}`.

The assertions held: held.decimals is 6, Home shows "100", the window contains "1,500,000", and the details contain "1.5 FOO" but not "1,500,000 FOO". 1 passed.

**Fix:**

Give the summary's tokens the decimals the device holds for them, as tx-view's withDecimals does.
- Where: in dapp.ts, after inspectDappTx or inspectSessionTx and inside withKeys. Use balances.ts decimalsOf over SESSION_ACCOUNT_UTXOS, the kept contract view's owned rows and the reading's tokens, and set them on netTokens, paid[].tokens, mint and releasedTokens. DappToken gains `decimals?`.
- SignTx's amount() then scales through tokenDecimals as every review does, with the wallet's list first.
- A token the user doesn't hold keeps showing raw, with its mark.
- One helper should serve tx-view and dapp.ts, so the window and its view can't part again.

**Known check:**

- e9a#2's verify (verify/e9a-2.md:25 and :72) noted the window's rows are raw. While the view was raw too, it said they agreed, and its fix notes asked to attach decimals to the summary's four lists. 8fd738ff fixed only the view. X1a's note (lanes/X1a.md:113) is the same observation. Neither is a finding.
- r2sign#3 and its sibling sweep (61a4d717) list the funding row, the top-up and Remove, not SignTx.
- docs/backlog.md for 'decimals' and 'raw units': only the usability review's ADA 'two decimals' call.
- archive/plans/ for the same: blind-test notes about Activity (fixed earlier) and chunk-26b's intent that an unlisted token takes its decimals from the rows. No decision keeps the window raw.

## Checked and holds

- cip30.rs inspect (1290-1313): every contract output kept by hash reads "hash", the PostAlonzo datum-hash option and a Legacy output's datum_hash alike, carried or not. Inline readings (register/none/dead) are unchanged and go through register_fields/spender only. The witness set's datums now feed datum_names_key alone, for contract inputs.
- DappApprovals SignTx: each reading has exactly one callout (none→noRegister, dead→deadRegister, hash→datumByHash warn, register→paysSeedelf privacy), session and account alike. paidTo says "Seedelf Wallet's contract, with data" for "hash". The fixer's dapp-datum-hash.test.ts passes 3/3 on FIXTREE's built wasm.
- The signing note's Seedelf flag (DappApprovals.tsx:1379) is "register" alone. For "hash", "Your private balance isn't in it" is true: no Seedelf Wallet reads the payment, so it never enters the balance.
- Transaction details: the "no Seedelf Wallet finds it" fragment shows only where address.seedelf and datumHash are both set. decode.rs reads a register from the inline datum alone, and DetailDatum (witness datums) is never read as a register, so a hash output gets no register and no Yours tag.
- The register readers agree on every spelling in tests/fixtures/register-spellings.json: chain.ts registerOf, seedelf-koios register_of_datum and cip30 register_fields over Pallas. The indefinite pair's break is checked after the fields' break, and a missing break, a third item, trailing bytes or another constructor are refused. Every consumer goes through these readers: ownedUtxos, locatorOf, check_spendable, remove_spend, ScriptSpend::new, lovejoin.rs, the CLI's fund/remove and seedelf-display.
- The private index hands every contract row's raw datum to the device (utxoOf), so the data layer's own parser never decides ownership. SETTLED_RULE 3 forces sealed verdicts to be judged again, so a row sealed as not the user's before the reader change is read again.
- moreThanNote (dapp.ts:2998): only a single 674 label holding a single "msg" entry of text lines counts as the note alone. A second msg, a second label, another key, a non-text line or a non-map value brings the 'other metadata' line. cip30's note_of and decode.rs read the same three auxiliary-data forms, and an unreadable decode counts as more.
- The connect window and the top-up form take the same side as the cap and the build: unlocked() keeps `locked`. "X ₳ available · Y ₳ locked" and "That's more than the X ₳ available" use the same figure as tooMuch. The reviews' homeBalance adds the lock back. Every figure masks under hidden balances, and es/ja strings exist for every new key.
- The funding and top-up token rows spread the held token under WebAssembly's (quantity from the build, decimals and fingerprint from the reading). Their Transaction details read the same Koios decimals (decimalsOf), so a review and its own view agree.
- tx-view withDecimals runs inside withKeys; a lock or a missing view adds nothing and only a trap propagates. The private index's view is kept under the same session key, so keptContractView gives Remove's view its decimals on mainnet too.
- A site's submitted transaction is kept under SESSION_DAPP_SIGNED, never SESSION_SENT, so incomingOf never counts a site's payment into the contract as on its way to the private balance.

## Notes

- The fix-ups weakened one warning. A datum kept by hash whose carried preimage is a register no one can ever spend now reads "hash" ("no Seedelf Wallet finds such a payment"), where round one read it "dead" ("locked for good"). Whatever the site does with the witness set, only that preimage opens the output, so locked for good is the exact truth. r2sign#1's verify allowed keeping "dead" for this case. The new words are true and still a warning, so this is the owner's call on wording, not a finding. The same holds for a carried anyone-can-spend datum: the window no longer says who can take it.
- Transaction details says nothing like "anyone can take" for a contract output with no datum, or with an inline datum that isn't a register. Only an identity public value gets tx.out.warn.anyoneCanSpend. The sign window above it warns for both, and the wallet never writes such outputs, so this is pre-existing and harmless. privacy.md's "the window and Transaction details warn" for a hash payment is a slight stretch: Transaction details' fragment is plain note text, as its other "warn" fragments are.
- l3sign#1's harm is bounded by the CLI. Its `sweep --all` spends reference-script rows through Ogmios (owner-calls §7, the CLI fixer's note 3), so such a payment is recoverable with the CLI today.
- Guards met: cip30.rs:1300-1305 (a hash output is never a register; dapp-datum-hash.test.ts, cip30_test); DappApprovals.tsx:1240 (the hash callout; dapp-prompt.test.ts's r2tests#1 block); chain.ts registerOf and koios.rs register_of_datum on the indefinite pair (register_spellings_test.rs, chain.test.ts, rows_test.rs); dapp.ts:2998 moreThanNote (dapp-prompt.test.ts r2sign#2 tests).
- How I ran scratch Vitest without touching FIXTREE: from FIXTREE's extension/, `npx vitest run --dir <scratch>/r51/work/L3sign`, with the test under <scratch>/r51/work/L3sign/tests/ (the config's include is tests/**) and a node_modules symlink in the scratch folder. Imports are absolute paths into FIXTREE.
- Lines in this report are FIXTREE's (web-wallet/whole-review-fixes at ad8c3ce4). TREE doesn't hold the fix-ups.

## Coverage

Read in full:
- The round's commit list.
- The diffs of 81516188, 61a4d717, 53780f85, e4d97bea and ca970760's dapp.ts line, plus every other round-two commit's file list, to rule out the sign window.
- FIXTREE code in the parts that matter:
  - cip30.rs: Paid, output_parts, Spender/register_fields/spender/inline_data, note_of, datum_names_key, and inspect from 1038 to 1420.
  - decode.rs: DetailAddress/DetailRegister/DetailOutput/DetailDatum, output_detail, register_detail, address_detail, auxiliary, and the witness datums.
  - tx-view.ts: from its head through markYours.
  - TxDetail.tsx: Output and YoursTag.
  - DappApprovals.tsx: ConnectRequest (560-1000) and SignTx (1040-1390).
  - ui/dapp.ts: paidTo and signingTies.
  - SiteSessions.tsx: TopUp, with its form and review.
  - format.ts: unlocked, lockedAside and tokenKey. tokens.ts: tokenDecimals.
  - chain.ts: headAt, pointAt and registerOf. koios.rs: register_of_datum and point_bytes.
  - contract-scan.ts: its head, SETTLED_RULE, the index view's keep, keptContractView, viewOf and seedelfRow.
  - private-index.ts: IndexRow and utxoOf.
  - balances.ts: spendableOwned, decimalsOf, atContract, ownedUtxos and withIncoming.
  - incoming.ts: incomingOf.
  - dapp.ts: the summary's tail, besideNote, moreThanNote and keepSent.
  - coin-control.ts: locked and listed. eval.rs: refusal. script-spend.ts: spendable and unspendable.
  - Utxos.tsx: lockable.
  - Home.tsx: the free sides.
  - sessions.ts: topUpBuild.
- The en/es/ja strings for every new or reused key.
- The register-spellings vectors and the new dapp-datum-hash and dapp-prompt tests.
- The review records: COMMON.md, RESUME.md, fix-branches.md, owner-calls.md, lanes/R2sign.md, and verify/r2sign-1.md, r2screens-1.md and e9a-2.md, plus searches of INDEX.md, FINDINGS.md, the backlog and the archive.

Ran: the earlier attempt's reference-script test and my window-units test (both described in the findings), and FIXTREE's tests/dapp-datum-hash.test.ts (3 passed).

Skimmed: seedelf-data/README.md's feed section (read only, to confirm the feed carries raw datums); severity-tiebreaks.json's r2sign#1 entry.

Not reached:
- register_spellings_test.rs and cip30_test.rs's round-two changes, in full.
- The e2e specs.
- SiteSessions.tsx beyond TopUp.
- The session sign window's own wiring past SignTx, which is shared.
- Transfer.tsx's tooMuch sibling that r2screens-1's verifier named (the screens lens's).
- The data layer's code.
