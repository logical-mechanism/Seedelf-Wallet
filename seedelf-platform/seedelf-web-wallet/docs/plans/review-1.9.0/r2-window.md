# 1.9.0's review of its fixes: the window lens

Round two, on the merged fixes at `204c7a93`. Verbatim from its structured report.

## Coverage

Read: R2BRIEF, COMMON, FINDINGS, FIXBRIEF, fix-full.txt (all five lanes), folder/back-translation.md, and the merged diff for DappApprovals.tsx (mustAck/ack 122-126, the guard 154, the foot 287-324, SignTx 998-1328), ui/dapp.ts releasesContractFunds, en/es/ja, dapp-prompt.test.ts, the #373 e2e (extension.spec.ts:5833-5902) against 8d7c4b0c's, the new cip30_test.rs and session_test.rs tests, cip30.rs inspect (key_releases 1833-1839, names_key, released_from_contracts, the unknown-input refusal 1788-1801), dapp.ts's signTx path (2084) and answer() (646-720), dapp-window.ts, wallet.ts's back-off, architecture.md:560-571, flows.md:262/275/430, wasm/README, backlog, and the i18n records.

Ran, in my own worktree (R/r2/window/tree at 204c7a93, node_modules symlinked, wasm/pkg copied; removed at the end):
- Cargo: CARGO_TARGET_DIR=~/.cache/seedelf-review-1.9.0/target-r2-window, seeded from target-integrate, -j 4, under an 8G cap. Two scratch tests dumped the TxSummary JSON of:
  - v-a-impact's 7 real Indigo transactions, re-read at this tree: 3 passed;
  - 10 shapes: the bounty's (datum naming 0/0, and plain), the honest cancel, L3, chunk 29's, the unkeyed contract, and four Q3 shapes: 3 passed.
- A Vitest probe rendered 27 summaries (those 17 and v-a-trace's 10) in en/es/ja: 81 renders, in R/r2/window/work/renders.txt.
- The guards plus dapp-prompt: 7 files, 182 passed. tsc --noEmit is clean.
- Playwright, on the dev build under taskset 0,1 and the cap:
  - the #373 test: 2/2;
  - mutants e1, e2, b1, p1, m, s1, h1, d1 (DappApprovals.tsx) and w1 (dapp-window.ts);
  - probes for a wrong password, Enter after the yes, Settings' password off, and the three edits in R/r2/window/scripts/e2e-probes.diff, on dev and store.

Scripts are in R/r2/window/scripts. Some e2e logs in R/r2/window/work were overwritten by later runs; the outputs quoted here are the ones each command printed.

Considered and not raised:
- dappUi.partial's "Others sign too before it's sent" is false only for an unfound native-script input that the stake key alone releases. In the Plutus shape the site's collateral makes it true.
- The reviewer note is dated 2026-11-10 against a local 2026-11-09. The house mixes UTC and local dates.
- No e2e in the suite runs the connector with Settings' password off; my probe is the only run.

Not done: the full e2e and Vitest suites (the integration's own Vitest run passed, 3302 tests), and the 400×605 layout of the lead's reworded contractYours. The words lane's layout probe predates that change, though the new values are no longer. No network calls. The 11 GB cargo target is left in place.

## Findings

### r2-window#1 (low, confirmed-by-run): The rewritten #373 e2e no longer declines a release with its switch off, so a Decline that waits for the yes passes

**Files:** seedelf-platform/seedelf-web-wallet/extension/e2e/extension.spec.ts, seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx

**Claim.** Before the rewrite, the only test of declining a contract release without the yes was the old step. It declined a request whose switch was still off. The rewritten step turns the second request's switch on before it declines. That follows the brief's recipe ('decline the second request ... then that the switch enables Sign'), and the verifier's probe does the same. So a guard that makes Decline wait for the yes too passes every test. No other test drives the switch: only this e2e names it, and Vitest renders SignTx, never DappApprovals' answer().

**Evidence.** The integration tree's ending, extension.spec.ts:5896-5901: `await yes.click(); await expect(yes).toHaveAttribute("aria-checked", "true"); await expect(button).toBeEnabled(); await decline.click(); expect((await second).error?.code).toBe(2);`

The base's step, 8d7c4b0c extension.spec.ts:5874-5878: switch "false", Sign disabled, then `next.getByRole("button", { name: "Decline" }).click(); expect((await second).error?.code).toBe(2);`

The guard, DappApprovals.tsx:154: `if (!current || busy || held || (approve && needsPassword && !password) || (approve && mustAck && !ack)) return false;`. Mutant d1 drops the last term's `approve &&`.

Runs (R/r2/window/scripts, dev build, taskset 0,1, 8G cap):
- `run-mutant.sh d1 "releases a contract UTxO under the account's key says so" 2 2` gives "2 passed (11.7s)".
- The base's step, with only the two new English strings swapped in, gives "1 passed" clean. Under d1 it gives "1 failed": the 30 s test timeout, with `second` never answered.
- The rewritten step with the fix below gives "4 passed (19.4s)" clean, "4 failed" under d1, and "4 passed (18.6s)" on the store build (VITE_ENABLE_MAINNET=true VITE_STORE_BUILD=true).

`grep -rn "I expect this not to come back to me\|dapp-contract-ack" e2e/ tests/` finds only extension.spec.ts:5849.

**Scenario.** A later refactor folds the release check into answer()'s shared guard without `approve &&`. The person the switch exists for, someone talked into a 'cancel' that pays a stranger, won't turn on 'I expect this not to come back to me'. For them Decline then does nothing, and the only way out is to close the window. CI stays green.

**Fix.** Turn the switch back off before Decline. Three lines, in R/r2/window/scripts/e2e-probes.diff:
```
    // Decline never waits for it: someone talked into a "cancel" answers no.
    await yes.click();
    await expect(button).toBeDisabled();
```
They go before `await decline.click();` at extension.spec.ts:5900. The other option is to decline a request whose switch was never turned on.

### r2-window#2 (low, confirmed-by-run): The step's 'Enter signs nothing' checks can't fail on their own, and the switch's hold has no test

**Files:** seedelf-platform/seedelf-web-wallet/extension/e2e/extension.spec.ts, seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx

**Claim.** (a) The Enter checks can fail only together with the toBeDisabled check before them:
- extension.spec.ts:5873-5874, and the verifier's new 5891-5894 (Enter, `secondAnswered` false, heading shown).
- Sign is the form's only submit button (DappApprovals.tsx:315 `type={needsPassword ? "submit" : "button"}`). Chrome never implicitly submits a form whose default button is disabled.
- So Enter never reaches onSubmit, and answer()'s `(approve && mustAck && !ack)` (DappApprovals.tsx:154) is reached by no test. Any change that enables Sign fails 5872 or 5890 first.
- In the queued form, 5874's heading check can't tell request 1 from request 2 either.

(b) The switch's hold, `disabled={busy || held}` at DappApprovals.tsx:300, is pinned by no test.

**Evidence.** Mutants (R/r2/window/scripts/mutate.py), on the #373 test, dev build:
- e1 (the guard's mustAck term dropped): "1 passed (15.9s)".
- e2 (`!ackFor` for `!ack`): "1 passed (18.7s)".
- h1 (the switch `disabled={busy}`): "1 passed (19.3s)".
- The 11 Vitest files that import DappApprovals give "Tests 286 passed (286)" under each.

A scan of every `<button` in src/ui finds none without a type in the window's components.

Probes:
- `await sign.locator("form").evaluate((f) => (f as HTMLFormElement).requestSubmit());` after the Enter at 5891: clean 2/2 passed. e1 and e2 each fail 2/2 at `expect(secondAnswered).toBe(false)`.
- `await expect(yes).toBeDisabled();` right after 5881's "The next request.": clean 4/4 passed (4 workers on 2 CPUs). h1 fails 4/4.
- Both, with r2-window#1's edit (one diff): 4/4 on dev and 4/4 on store. d1, e1, h1 and m each fail.

**Scenario.** (a) answer()'s guard can be loosened or deleted with every test green. Today it guards only what the disabled button already does, so this is a test that can't fail, not a reachable bug.

(b) Request B takes request A's place (A answered, or A's page went away). A click aimed at A's switch lands on B's and turns on B's yes before B is read. The hold exists for exactly that (DappApprovals.tsx:132-147), and h1 removes it unseen.

**Fix.** Add both probe lines to the step. They are in R/r2/window/scripts/e2e-probes.diff, tested on both builds. Or reword the Enter comments to say what they test: the button, through the browser's rule.

### r2-window#3 (nit, traced): L3's line keys on keyReleases, which a stake-key withdrawal or certificate never sets; the docs' limits don't say the reassurance stays there

**Files:** seedelf-platform/seedelf-web-wallet/docs/architecture.md, seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx

**Claim.** key_releases is set by three things only (cip30.rs:1833-1839): names_key, an account key as a required signer, or a found contract input with no script data hash. The stake key signing for a withdrawal or a certificate is not among them. Yet cip30.rs:1827-1829 now says a contract may take either as its owner's proof, and architecture.md:566 lists them.

So beside an input the wallet couldn't find, such a release still reads 'Only your stake key signs here.', the reassurance L3 removed. architecture.md:566 says only the note shows what the wallet can't tie to the key, but an unfound input has no note: what shows is that line. architecture.md:568 gives as its reason 'since that key may be what a contract asks for', which is just as true of those proofs.

**Evidence.** DappApprovals.tsx:1305: `tr(s.keyReleases ? "dappUi.warn.unknownInputsKeyReleases" : "dappUi.warn.unknownInputs", ...)`.

The Rust dump of chunk 29's shape (a zero withdrawal by the stake key, input TX_B#7 not found): keyReleases false, signs [stake], contractInputs 0.

Its render, R/r2/window/work/renders.txt:
- 'Withdraws your staking rewards, 0 ₳, into your public account.'
- 'It spends 1 UTxO the wallet couldn't find, so what it holds can't be shown. Only your stake key signs here.'
- The same in es ('Solo tu clave de stake firma aquí.') and ja (ここで署名するのはあなたのステーク鍵だけです).

The shape q3WithdrawalProof (a found contract input released through the withdrawal) shows only the note and the same line.

**Scenario.** Someone holds an order made outside this wallet whose validator takes a zero withdrawal from the owner's stake key as its proof. A site spends it, paid to a stranger, before the data source lists it. The window reads 'Total coming into your public account 0 ₳', the withdrawal line, and '…Only your stake key signs here.' That is byte for byte chunk 29's honest delegation shape, so no code can tell them apart. The docs only say this for found inputs.

**Fix.** Add one clause to architecture.md:566 or 568: an input the wallet couldn't find, released by a withdrawal or a certificate of the stake key, keeps 'Only your stake key signs here', since that shape is chunk 29's. Or, the owner's call, drop the sentence wherever the stake key signs beside an unfound input (L3's other option). Chunk 29's line would go too.

### r2-window#4 (nit, traced): flows.md and two doc comments keep words this round retired

**Files:** seedelf-platform/seedelf-web-wallet/docs/flows.md, seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs, seedelf-platform/seedelf-web-wallet/extension/src/shared/rpc.ts

**Claim.** flows.md:430 still describes the warning as 'naming the account's key when the contract UTxO's datum does'. The lead's contractYours now says 'a contract that names you', and the lead updated architecture.md:563 to 'says the contract names the user', but not flows.md.

cip30.rs:944 and rpc.ts:1168 still document namesKey as "it's likely the user's own order or listing". M1 refuted that reading: the 28-byte scan matches the key in any role, such as a royalty payee or a position. The words lane flagged rpc.ts:1168, and it is still there.

**Evidence.** - flows.md:430: '…a warning before who it pays, naming the account's key when the contract UTxO's datum does;…'
- cip30.rs:944: `/// A contract UTxO's datum names one of the account's keys: it's likely the user's own order or listing.`
- rpc.ts:1168: the same sentence.
- en.json:514: 'Your signature releases funds from a contract that names you. They may be yours, but they don't come back to you.'
- `git show review-1.9.0/fix-docs:…/flows.md` has the same clause, so the lead's rewording didn't reach it.

**Scenario.** A reader of flows.md expects the warning to mention a key. A developer reading the doc comments re-derives the retired 'your own order or listing' wording.

**Fix.** - flows.md:430: '…a warning before who it pays, saying the contract names the user when its datum names one of the account's keys;…'
- Both comments: '…names one of the account's keys, in whatever role: not whose the UTxO is.'

### r2-window#5 (nit, traced): The verified-critical reviewer note miscounts the keys, overstates the rounds, and records none of round one's readings it keeps

**Files:** seedelf-platform/seedelf-web-wallet/docs/i18n/verified-critical-es.json, seedelf-platform/seedelf-web-wallet/docs/i18n/verified-critical-ja.json

**Claim.** The note says what was done, with three slips:
- 'Two keys are new here' introduces three: one new (unknownInputsKeyReleases) and two renamed (the notes).
- 'Each was back-translated blind … in three rounds': only contractYours had rounds two and three.
- 1.8.1's entry says 'Its notes hold of the English, and stay: …'. This note records none of round one's readings that stay:
  - ja's two unfound-input lines say 使用する ('uses'), while the notes now say 消費します ('consumes'). The blind ja round flagged the pair, and both can show in one window.
  - ja's row 届かない分 was read as a shortfall, 'money due to you'.
  - es's 'no hacia ti' was read as 'not meant for you', against 'Puede que sean tuyos'.

**Evidence.** The appended note (es; ja is parallel): "Two keys are new here: dappUi.warn.unknownInputsKeyReleases, …; and the contract notes, renamed critical, dappUi.note.warn.contractInputs and dappUi.note.warn.contractInputsTokens. Each was back-translated blind, a fresh agent a language with no English in view, in three rounds."

The verified lists gain three keys, by a script diff against 8d7c4b0c.

R/folder/back-translation.md: 'Round one is the words lane's drafts; round two and three are dappUi.warn.contractYours alone'. Its round-one ja notes: 'Two different verbs for spending an input: unknownInputsKeyReleases says 使用する ("uses"), contractInputs … say 消費します'.

The ja render q3WithdrawalProof (renders.txt) shows 'コントラクトの UTxO を 1 件消費します。…' beside 'ウォレットが見つけられなかった UTxO を 1 件使用するため、…'.

**Scenario.** A later reviewer reading the record takes it that every key went through three blind rounds and that nothing was left as read. The ja verb split, introduced when L5 fixed only the notes, isn't on record as a choice.

**Fix.** - 'One key is new and two are renamed critical: …'
- 'Each was back-translated blind in round one, and contractYours again in rounds two and three.'
- Add a sentence: 'Its notes hold of the English, and stay: …'. List the ja 使用する beside 消費します (kept so the new key reuses unknownInputs' mtpe first sentence word for word), the row's 分, and es 'no hacia ti'.

## What holds

- Q1: SignTx was rendered in en, es and ja the way dapp-prompt.test.ts renders it, for 27 summaries (81 renders). Every sentence holds for its shape:
- the bounty's (0/0 a required signer under a script data hash, the site's collateral, the order to a stranger; datum naming 0/0 and not);
- v-a-trace's 10 synthetic summaries: top-up, partial withdrawal, borrow-more, partial cancel, reprice, the attacker's relist, royalty purchase, repay, cancel with a fee, fungible;
- the 7 real Indigo transactions (A1-A4, C1-C2, S1), re-read at this tree.
- Q1: the row ('From a contract, not to you' / 'Desde un contrato, no hacia ti' / 'コントラクトから、あなたには届かない分') is always what doesn't reach the account. contractYours shows only with namesKey, contractMaybe without it, and the switch only when releasesContractFunds holds.
- Q1: the honest cancel (released 0) and the unkeyed contract input show only the note ('It spends 1 contract UTxO holding 50 ₳ and tokens.' / 'Gasta 1 UTxO de contrato que contiene…' / '…件消費します。その中身は…'), with no row, callout or switch.
- Q1: in the L3 shape (Rust: unknown [TX_B#0], signs [stake], contract_inputs 0, key_releases true, released 0), the unfound line drops 'Only your stake key signs here' in all three languages, and there is no switch. Chunk 29's shape (key_releases false) keeps the old line.
- No render carries the old words: Leaves a contract, your own order or listing, Sé que, 想定どおり, Sale de un contrato, 出ていき. In the tree, outside the strings, only the two comments in r2-window#4 keep them.
- U+00A0 sits before ₳ in all 12 note values (4 en, 6 es, 2 ja) and on the released row (DappApprovals.tsx:1109, bytes c2 a0).
- Q3: keyReleases can be true beside an unfound input for reasons other than the stake key: a found contract UTxO's datum naming the payment or the stake key, or a found contract input with no script data hash (Rust dumps q3DatumNamesPayment, q3DatumNamesStake, q3NativeScript).
- Q3: in every window that shows an unfound input, the stake key is the only signer. A payment key as required signer beside an unfound input is refused in inspect (run: 'This transaction spends a UTxO the wallet can't find yet…'); the same code refuses a DRep key (cip30.rs:1788-1801). An empty signs list is refused before the window (dapp.ts:2084). So the dropped sentence would still be literally true, 'Signs with' still says 'your staking', and the line that remains is true: nothing false shows.
- The new key reuses each language's first sentence of unknownInputs exactly, in every plural form: en one/other, es one/many/other, ja other.
- Q2: DappApprovals' diff changes only the note keys and the unfound line's key. Every state keeps the base's buttons; the L3 and note states have no switch, so Sign, Enter and Decline work as for any request.
- Q2, run: Sign after the switch works (e2e). Enter after the yes signs (probe). A queued request starts with its switch off, an empty box and the 1 s hold, and no second window opens (e2e).
- Q2, run: a wrong password leaves the request waiting with its queue and its yes, shows 'Wrong password.' and clears the box (probe 2/2). Within the 1 s back-off a retry is refused by design (wallet.ts:736-739).
- Q2, run: with Settings' password off there is no form and no box. Sign waits for the switch alone, and the next request, declined with its switch off, answers code 2 (probe 2/2).
- Q5: the rewritten step's other assertions can fail: m and s1 at 5884, p1 (no password reset) at 5885, b1 (Sign held by ackFor) at 5890, w1 (a window for each request, dapp-window.ts) at 5895.
- Q4: the six guards (i18n, i18n-critical-helpers, words, i18n-worker-reasons, i18n-values-in-place, i18n-screens) and dapp-prompt pass: 7 files, 182 tests. tsc --noEmit is clean on the merged tree.
- Q4, provenance: every new or renamed key is labelled machine (es: the 6 note.warn forms and 3 unknownInputsKeyReleases forms; ja: the 3 _other forms), as #373's contract keys were. The redrafted contractRow, contractAck and contractYours keep machine and are listed verified, which is the house's practice (361 es and 318 ja verified keys are machine).
- Q4: critical-keys.json has 485 keys, including the three new ones, and matches the derivation. The verified lists add exactly those three, so all 485 critical keys are listed, contractMaybe and tx.privacy.inputsHintSite among them.
- Q4: the final es and ja contractYours are round three's back-translated values ('en el que figuras'; 'あなたが記載されている…手元には戻りません'), and the note's quoted English matches en.json.
- Docs: architecture.md:563-568 matches the code. The ADA row shows only when ADA is released, and token rows otherwise. The callout follows namesKey, the switch holds for one request, the note shows otherwise, the fee credit is 10 ₳, and the unfound bullet is right. wasm/README's inspectDappTx row names the seven fields.
- The rust lane's new tests pin what the window reads: the L3 shape, and the session's own cancel (key_releases true, released 0, so no switch). They pass at the integration tree (integrate/logs/rust.log: cip30_test 73, session_test 14).
- No button in the window lacks a type, so Enter can't trigger any button but Sign.
- r2-window#1's and #2's probe edits together pass 4/4 on dev and 4/4 on store (4 workers on taskset 0,1), and fail under each of d1, e1, h1 and m.
