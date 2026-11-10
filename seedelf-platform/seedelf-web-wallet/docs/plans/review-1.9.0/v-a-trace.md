# 1.9.0's release review: the v-a-trace verifier

The verification, told to refute. Verbatim from its structured report; full addresses of third parties shortened.

## Coverage

Read at 8d7c4b0c:
- wasm/src/cip30.rs: keys_of and of_hash (448-492), the TxSummary contract fields (936-946), at_script, datum_names_key, MOST_FEE_ALLOWED and released_from_contracts (1074-1136), inspect's input loop that builds contract_held and names_key (1248-1275), required signers (1335-1344), the outputs loop (1352-1410), released and key_releases (1822-1838).
- extension/src/ui/dapp.ts releasesContractFunds (28-35).
- DappApprovals.tsx: mustAck and ack (121-126), the answer() guard (154), the switch (288-301), Sign's disabled state (318), SignTx's released rows and callout (1065-1144).
- The en/es/ja strings, rpc.ts:1156-1169, and PR #373's body (gh pr view 373, read-only).
- architecture.md:563, flows.md:430, and the docs/i18n provenance and verified-critical files.
- #373's own tests: cip30_test.rs 2132-2440, the dapp-prompt.test.ts diff and the e2e diff.

Ran, in my own worktree (since removed), with target $HOME/.cache/seedelf-review-1.9.0/target-v-a-trace and a MemoryMax=8G scope:
- My Rust probe: `cargo test -j 4 --locked -p seedelf-wasm --test review_v_a_trace_test -- --nocapture --test-threads=1`, 12 passed. It covers top-up, partial withdrawal, borrow-more with a shared pool, partial cancel, reprice, the attacker's relist, the datum-scan bypass, a naive kept split, the DRep key with and without governance, a royalty purchase, r11 and r19.
- The cip30-rust finder's probe, re-run: 20 passed, 1 ignored.
- The i18n finder's probe, re-run: 6 passed.
- Vitest render of SignTx for 9 of my summaries in en/es/ja (`REVIEW_SUMMARIES=... npx vitest run tests/review-v-a-trace.test.ts --silent=false`): passed.
- A same-window comparison (`tests/review-v-a-trace-same.test.ts`): the honest reprice and the attacker's relist render identical HTML, 3,310 chars each.

Not done:
- No real dApp's datums or transactions (Indigo, jpg.store, Levvy, Lenfi), so whether a real builder lists the user's key on a shared pool spend (r9) is plausible, not traced.
- No Koios reads, no e2e.
- The switch is in DappApprovals' foot, outside SignTx, so it wasn't rendered. Its gating was read (124, 154, 318) and is reproduced by releasesContractFunds.
- The proposed wordings weren't back-translated.

## Verdicts

### cip30-rust#1: partly, low (confirmed-by-run)

**Why.** The mechanics hold, confirmed by run.
- released_from_contracts never looks at outputs to contracts: only the account's own inputs (put_in) and own outputs (returned), net. So value re-created at the same script counts in full.
- With the owner's key a required signer and its hash in the datum, every honest same-owner re-creation gets the row, contractYours and the switch.
- In every case the figure equals what stays at the contract, capped at what it held:
  - top-up: the whole 10,000 ₳ and the token
  - partial withdrawal: the 9,000 ₳ left
  - borrow-more: position plus pool, 50,900 ₳
  - partial cancel: the 30 ₳ left
  - reprice: 2 ₳ and the NFT

What doesn't hold, or is overstated:
(1) The grade. Nothing is refused: one switch per request. An overstatement gives a site nothing to exploit. Counting same-contract value as gone is the owner's stated, accepted trade-off. What's left is misleading text (the callout, and the row's 'Leaves') plus docs that don't name the class: low by the table, not medium.
(2) 'Beside a false figure' fails for r19: the 1 ₳ service fee really goes to a third party. That figure is true; only the callout's 'It doesn't come back to you' overstates, since 48.8 ₳ comes back.
(3) 'The PR names only a listing's reprice and a net spender repaying a loan' is true of the PR body. But architecture.md's 'a loan's repayment can read as releasing the ADA paid on' is general and covers r11's net receiver.
(4) r9's 5,000,000 ₳ pool needs a builder that lists the user's key on a pool spend. Plausible, not traced against a real dApp.
(5) r14 and r21 match the wallet's account model, not a defect: another account, or the account's key under no stake part, is 'not you' (C01/M12), and Pays names them.

The real gap, stated nowhere: positions (top-up, partial withdrawal, a loan action), shared-state UTxOs spent under the user's key (the whole pool in the row), partial cancels, and a closed position's burnt token (r10, in the finder's own probe file). Also missing: that contractYours then says 'your own order or listing... doesn't come back to you'. In a partial withdrawal that sits right under 'Total coming into your public account 999.8 ₳'.

**Evidence.** Code:
- cip30.rs:1105-1106 "Money that stays at the same contract counts as gone: a listing can stay where it is under a new owner's datum."
- cip30.rs:1125 `let gone = q.saturating_sub(back);`
- cip30.rs:1130-1133 `contract.lovelace.saturating_sub(came_in).saturating_sub(fee.min(MOST_FEE_ALLOWED).saturating_sub(went_out))`
- cip30.rs:1264-1270: contract_held and names_key from every found script input.
- cip30.rs:1832-1838: key_releases = names_key || a required signer is ours || (contract input && no script_data_hash).
- dapp.ts:33-35 `!!s.keyReleases && (BigInt(s.releasedLovelace ?? "0") > 0n || (s.releasedTokens?.length ?? 0) > 0)`
- DappApprovals.tsx:124 mustAck; :154 and :318 (Sign and Enter both wait for ack); :1106-1122 the rows; :1142 the callout.

Run 1, my Rust probe (in my worktree's seedelf-platform/): `REVIEW_OUT=.../summaries.json CARGO_TARGET_DIR=$HOME/.cache/seedelf-review-1.9.0/target-v-a-trace systemd-run --user --scope -p MemoryMax=8G -- cargo test -j 4 --locked -p seedelf-wasm --test review_v_a_trace_test -- --nocapture --test-threads=1` gave 12 passed:
- `topUp: net -100200000 | contract holds 10000000000 | released 10000000000 lovelace, 1 token(s) | key_releases true names_key true | pays ["contract(data) 10100000000+1tok"] -> row ... + callout contractYours + switch`
- `partialWithdrawal: net 999800000 | released 9000000000 lovelace, 1 token(s) ... -> ... contractYours + switch`
- `borrowMore: net 99800000 | contract holds 51000000000 | released 50900000000 lovelace, 1 token(s) ... -> ... contractYours + switch`
- `partialCancel: net 19800000 | released 30000000 ... -> ... contractYours + switch`
- `reprice: net -200000 | released 2000000 lovelace, 1 token(s) ... -> ... contractYours + switch`

Run 2, the Vitest render (`REVIEW_SUMMARIES=.../summaries.json npx vitest run tests/review-v-a-trace.test.ts --silent=false`), en:
- topUp: "Total leaving your public account 100.2 ₳ Leaves a contract, not to you 10,000 ₳ Leaves a contract, not to you 1 cdp". Callout: "Your signature releases your own order or listing from a contract. It doesn't come back to you." Pays: "A contract, with data 10,100 ₳ 1 cdp".
- partialWithdrawal: "Total coming into your public account 999.8 ₳ Leaves a contract, not to you 9,000 ₳ ...", with the same callout.

Run 3, the finder's probe re-run (`--test review_cip30_rust_test`) gave 20 passed, 1 ignored:
- r8 released=10000000000
- r9 released=5000000000000, tokens [("706f6f6c","1"),("74657374","999800")] (contractMaybe)
- r10 'close, token burnt: released=0 tokens=["1"] mint=["-1"] -> warning (contractYours)'
- r11 net=499700000 released=500000000
- r13 released=2000000 (contractMaybe)
- r14 and r21 released=49800000
- r19 net=48800000 released=1000000
- r20 released=30000000

**Documented.** - PR #373's body, under 'Honest requests that also get the warning and the switch': "Repricing a listing, which pays back to the same contract." and "A net spender repaying a loan, which can read as releasing the ADA paid on. Crediting the account's own spending here would let a site hide a contract's ADA inside it."
- architecture.md:563: "money kept at the same contract counted as gone, since a listing can stay there under a new owner's datum". And: "An account that spends more than it gets is credited nothing against what's released ... so a loan's repayment can read as releasing the ADA paid on. Nothing is refused: the ledger takes these, and an honest listing update needs them."
- flows.md:430 says only "what leaves a contract and doesn't reach the user when one of the account's keys releases it (a row under the total, a warning before who it pays, stronger when the contract UTxO's datum names the account's key, and a switch Sign waits for...)", with nothing on honest flows.

The rule and the switch on honest updates are stated and accepted: not a bug. Not stated anywhere: positions, shared-state pools, partial cancels and withdrawals, a burnt position token, and the callout's words in those flows.

**The fix.** No: from the transaction alone, the wallet can't tell an honest re-creation from the attacker's.

Option (a), a kept figure for same-script value:
- As an exemption it's unsafe. The honest reprice and the attacker's relist at the same contract render byte-identical windows (`npx vitest run tests/review-v-a-trace-same.test.ts`: "reprice html 3310 chars, attack html 3310 chars, identical: true"). Anything that takes same-contract value off the switch takes the attack off with it.
- As a split that still gates the switch, it inherits the fungibility problem the owner already named. In q4b the site pays the victim's 50 ₳ order to the attacker and 50 ₳ of the victim's own into the same contract under the attacker's datum. Today the window shows Total leaving 50.2 ₳ and released 50 ₳: the whole 100.2 ₳ lost. A naive split prints "kept at the same contract 50000000, not to you elsewhere 0".
- So a split would need the account's own outflow taken off first, and words that never say the value stays the user's. Not a 1.9.0 change.

A gate on 'the new datum names the account's key' is bypassable at no cost. datum_names_key is a 28-byte window scan, and the owner-cancel paths put no limit on outputs. q4 printed "names the account = true" for the attacker's datum with the victim as a 1 ₳ payee, with the victim's stake key in an address, and with the victim's key in a spare field. Only a datum free of the account's hashes gave false.

The only sound structural signal for an unknown contract is a byte-identical re-creation: the same full address, the identical datum option, matched one output to one input, holding at least the input's value per asset. Pooled matching would let two same-datum listings be merged and bought for one price. It would exempt none of these flows: a reprice, a CDP or loan action, a partial cancel and a pool all change the datum.

So the fix is wording plus docs:
- Option (b), never contractYours for re-created value, is safe: wording only, the switch stays. It needs one flag for an output at a spent contract input's script hash, and contractMaybe still misleads for a same-owner re-creation.
- Option (c) is right and safe: name positions, pools spent under the user's key, partial cancels and withdrawals, any repayment whatever the net, and a burnt position token in architecture.md:563 and flows.md:430.

None of these needs a request or refuses anything.

### dapp-ui#2: confirmed, low (confirmed-by-run)

**Why.** The row 'Leaves a contract, not to you' and the switch 'I expect this to leave the contract' say the money goes out of the contract. In the honest reprice PR #373 names, it goes back into the same contract, and the same window's Pays list says so. Sign stays off until the user affirms something that isn't happening.

In the attack the design exists for, the relist at the same contract under the attacker's datum, 'leaves' is false too; only 'not to you' holds. A victim led to think it's a reprice could decline on the switch's literal words. But that 'protection' is the same falseness the honest repricer meets: the two windows are identical. contractYours is true in substance in that attack.

Misleading text in a flow the PR names: low. Same strings and flow as i18n#1: a duplicate, to be merged.

**Evidence.** Code:
- en.json:511 "dappUi.warn.contractAck": "I expect this to leave the contract"
- en.json:513 "dappUi.warn.contractRow": "Leaves a contract, not to you"
- DappApprovals.tsx:290-292: the switch, under mustAck. :1106-1122: the row label on the ADA row and on each token.
- cip30_test.rs:2235-2244 paying_the_same_contract_still_counts_as_released: "the money stays there", released_lovelace "49800000".

Render (`npx vitest run tests/review-v-a-trace.test.ts`), [reprice] en: figures "Total leaving your public account 0.2 ₳ Leaves a contract, not to you 2 ₳ Leaves a contract, not to you 1 nft ...". Callout: "Your signature releases your own order or listing from a contract. It doesn't come back to you." Switch: "I expect this to leave the contract". Pays: "A contract, with data 2 ₳ 1 nft".

The attacker's relist (q2a: listing re-created at the same market, owner and payee the attacker): `attackRelist: net -200000 | released 2000000 lovelace, 1 token(s) | names_key true -> ... contractYours + switch`. Its HTML is identical to the reprice's (`tests/review-v-a-trace-same.test.ts`: "identical: true").

**Documented.** - PR #373's body: "Repricing a listing, which pays back to the same contract" accepts the warning and the switch for a reprice, not the words.
- architecture.md:563: "money kept at the same contract counted as gone" and "an honest listing update needs them".

Nowhere states or accepts that the row and switch say 'leave' for money that stays.

**The fix.** Wording only and safe: the switch and the figure stay, nothing is refused, no request.
- "Released, not to you" works for the row.
- "I expect this to be released" fixes the reprice, but the switch still never asks 'not to you'. A victim told to cancel their order expects a release and would affirm it, exactly as they would 'leave the contract' today. So it's no regression, but no help for the bounty's main attack.
- i18n#1's "I expect this not to come back to me" carries the row's 'not to you' into what the user affirms. A cancel-redirect victim answers no; a repricer or a top-up honestly answers yes. That's the better switch.

Either way:
- Redraft es and ja and back-translate them: these are critical .warn. keys.
- Update dapp-prompt.test.ts:107 and e2e extension.spec.ts:5845/5851.

No wording can tell an honest reprice from a fake one: the windows are identical.

### i18n#1: confirmed, low (confirmed-by-run)

**Why.** Same defect as dapp-ui#2, plus es/ja and the top-up, all confirmed by run. es says 'Sale de un contrato, no hacia ti' and 'Sé que esto sale del contrato'. ja says 'コントラクトから出ていき、あなたには届かない分' and 'これがコントラクトから出ていくことは想定どおりです'. Both carry the same 'leaves the contract' claim.

The released figure in a top-up is the whole vault, re-created at the same contract. 'Only the callout's It doesn't come back to you matches what is computed' holds for the figure: 'doesn't reach the account's addresses'.

One small misattribution: PR #373 lists the reprice, not a top-up, which is in neither the PR body nor the docs.

Misleading text: low. A duplicate of dapp-ui#2.

**Evidence.** Code:
- es.json:535 "Sé que esto sale del contrato"; es.json:537 "Sale de un contrato, no hacia ti"
- ja.json:487 "これがコントラクトから出ていくことは想定どおりです"; ja.json:489 "コントラクトから出ていき、あなたには届かない分"
- DappApprovals.tsx:124 mustAck; :318 Sign `disabled={... || (mustAck && !ack)}`; :154 the same guard for Enter.

Render (`npx vitest run tests/review-v-a-trace.test.ts`):
- [topUp] es "Sale de un contrato, no hacia ti 10,000 ₳", switch "Sé que esto sale del contrato"
- [topUp] ja "コントラクトから出ていき、あなたには届かない分 10,000 ₳", switch "これがコントラクトから出ていくことは想定どおりです"
- In both, Pays: 10,100 ₳ to "Un contrato, con datos" or "コントラクト（データ付き）".

The finder's Rust probe re-run (`--test review_i18n_373_test`) gave 6 passed: `reprice: net -200000 | ... released 2000000 lovelace + 1 token(s) ... callout contractYours` and `top-up: net -100200000 | ... released 1000000000 lovelace`.

**Documented.** - PR #373's body: "Repricing a listing, which pays back to the same contract". A top-up is not named.
- architecture.md:563: "money kept at the same contract counted as gone".
- docs/i18n verified-critical-es.json and verified-critical-ja.json list the four keys as back-translated. Their meaning ('leaves the contract') was carried faithfully, so the problem is the English source.

Nowhere accepts the words.

**The fix.** "From a contract, not to you" is literally true in every case: the figure is contract-held value that doesn't reach the account's addresses, including the fungibility cases.

"I expect this not to come back to me" is true of a reprice, a top-up and a partial cancel's remainder. It's the question a cancel-redirect victim answers no to, so it's the better of the two proposals; dapp-ui#2's 'to be released' is not.

Wording only and safe: the switch and the figure unchanged, nothing refused, no request. Still to do:
- Redraft es and ja and back-translate them; mind the negation word-list checks for a translated value.
- Update dapp-prompt.test.ts:107 and e2e extension.spec.ts:5845/5851.

No wording can separate an honest reprice from a fake one: identical windows, see cip30-rust#1.

### i18n#2: confirmed, low (confirmed-by-run)

**Why.** namesKey is computed as follows:
- an OR over every found contract input (cip30.rs:1270)
- of a 28-byte window scan of the datum's CBOR bytes: inline, or the carried datum by hash (1083-1097)
- against the stake key, the payment keys in range and, only with governance, the DRep key.

So it matches the key in any role: owner, co-signer, payee or royalty address, or the stake part of any address. And one named input marks them all.

contractYours states three things as fact: ownership ('your own'), the contract's kind ('order or listing'), and that 'it' doesn't come back. None of these is computed; the code's own comments say 'likely'.

Confirmed by run, contractYours is shown for:
- a co-signed multisig treasury payout
- a loan repaid, where the 2 ₳ shown came back with the collateral
- the user's own order refunded beside someone else's UTxO paid on
- my case: buying someone else's listing whose payouts include the account's royalty address

Corrections:
(1) The critic's note holds: the DRep key counts only with governance (keys_of 466-470, of_hash 484-491; run: false without, true with).
(2) contractMaybe is not 'true in every one of these cases'. In the loan repayment the released 2 ₳ is a fungibility artifact, so 'If any are yours, they don't come back to you' misleads there too. It is true for the treasury and the mixed case.

Not exploitable: a site gains nothing from the stronger callout, and the attack cases (own order paid away, relist) get true words. Misleading text: low.

**Evidence.** Code:
- cip30.rs:1094-1095 `b.windows(28).any(|w| <[u8; 28]>::try_from(w).is_ok_and(|h| keys.of_hash(&Hash::new(h)).is_some()))`
- cip30.rs:1270 `names_key |= datum_names_key(row, &carried, &keys);`
- cip30.rs:466-470 `drep: if governance { Some(account.key_hash(Role::Drep, 0)?) } else { None }`
- cip30.rs:484-491 of_hash: stake, then `self.drep == Some(*hash)`, then payment.
- cip30.rs:944 and rpc.ts:1168: "it's likely the user's own order or listing"
- cip30.rs:1081-1082: "Says which UTxO is likely the user's, not what the contract does with it."
- DappApprovals.tsx:1142 `tr(s.namesKey ? "dappUi.warn.contractYours" : "dappUi.warn.contractMaybe")`
- en.json:514

My probe (`--test review_v_a_trace_test`, 12 passed):
- q5a "datum naming the DRep key: names_key without governance false, with true"
- q5b `royaltyPurchase: net -50200000 | released 2000000 lovelace | names_key true -> ... contractYours + switch`
- q4: honest, attack_payee, attack_stake and attack_spare all "names the account = true"; only_attacker false.

The finder's probe re-run (6 passed):
- `treasury: net 0 | ... released 999800000 ... names_key true -> ... contractYours`
- `loan repaid: net -98200000 | ... released 2000000 lovelace + 0 token(s) ... contractYours`
- `own refunded + another's paid on: net 49800000 | contract_inputs 2 ... released 30000000 ... contractYours`

Render, [repayNetReceiver] en: "Total coming into your public account 499.7 ₳ Leaves a contract, not to you 500 ₳" under "Your signature releases your own order or listing from a contract. It doesn't come back to you."

**Documented.** - flows.md:430: "a warning before who it pays, stronger when the contract UTxO's datum names the account's key".
- architecture.md:563: "`namesKey`, one of the account's key hashes in a contract UTxO's datum", and, said of the total, "a contract UTxO may be someone else's, with the key only co-signing".
- The code comments call it 'likely'.

The docs present namesKey as a hint; nothing states or accepts the callout asserting it as fact.

**The fix.** Both options are wording only and safe: the switch stays, nothing is refused, no request.
- Using contractMaybe for namesKey too drops flows.md's documented stronger variant, so that sentence must change too. It also leaves the fungibility cases misleading, since contractMaybe says 'they don't come back' there as well.
- The reword "Funds from a contract that names your key don't come back to you." is closer and keeps the stronger tone. It still overstates when the named UTxO isn't the one paid away.
- A version that claims only what's computed, about as short: "This contract's data names your key. What your signature releases here doesn't come back to you."

Either way:
- Redraft es and ja and back-translate them.
- Update dapp-prompt.test.ts:108 and :116 (it asserts `not.toContain("your own order or listing")`). The e2e text at extension.spec.ts:5853 is contractMaybe's and is unaffected by the reword.

