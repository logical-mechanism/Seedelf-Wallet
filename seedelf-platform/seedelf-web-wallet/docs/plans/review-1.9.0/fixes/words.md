# 1.9.0's release review: the words fixer

A fix lane, in a worktree of `8d7c4b0c`, test first. Verbatim from its structured report.

**Branch:** `review-1.9.0/fix-words`, commit `923b1974`.

**Files:** `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/en.json`, `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/es.json`, `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/ja.json`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx`, `seedelf-platform/seedelf-web-wallet/extension/tests/dapp-prompt.test.ts`, `seedelf-platform/seedelf-web-wallet/extension/e2e/extension.spec.ts`, `seedelf-platform/seedelf-web-wallet/docs/i18n/es-provenance.json`, `seedelf-platform/seedelf-web-wallet/docs/i18n/ja-provenance.json`, `seedelf-platform/seedelf-web-wallet/docs/i18n/critical-keys.json`

## Fixed

### M1 (cip30-rust#1, dapp-ui#2, i18n#1, i18n#2)

**What.** The sign window's words in en/es/ja, as the lead decided. dappUi.warn.contractRow is now "From a contract, not to you" (en.json:513, es.json:537, ja.json:489). dappUi.warn.contractAck is now "I expect this not to come back to me" (en.json:511, es.json:535, ja.json:487). dappUi.warn.contractYours is now "Your signature releases funds from a contract that names your key. They may be yours, and they don't come back to you." (en.json:514, es.json:538, ja.json:490). contractMaybe is unchanged. The released figure and the switch are unchanged, since no safe exemption exists. The docs part of M1 belongs to the docs lane.

**Tests.** extension/tests/dapp-prompt.test.ts:
- "says what comes from a contract, not to the user, under the total, and that the contract names the key, before who it pays": the new row and callout, and neither "Leaves a contract" nor "your own order or listing".
- "says less when no datum names the account's key": no "names your key".

extension/e2e/extension.spec.ts:5833, "a site's request that releases a contract UTxO under the account's key says so, and Sign waits for the user's yes (a bounty report against 1.8.1)": the row's text, and the switch found by its new name.

**Evidence.** The tests were written first and run on the base's words: `npx vitest run tests/dapp-prompt.test.ts` gave "Tests 4 failed | 27 passed (31)". This one failed at `expect(page).toContain("From a contract, not to you 49.8 ₳")`. After the fix: "Tests 31 passed (31)". The e2e passed 4/4 on the dev build and 4/4 on the store build (see commands). Logs are in R/fix/words/logs/vitest-dapp-prompt-base.log and vitest-dapp-prompt-fixed.log.

### L5 (i18n#3 and the blind check)

**What.** Redrafted es and ja for the switch, the row and contractYours.
- es switch: "Tengo previsto que esto no vuelva a mí". It states the user's own plan, with no "Sé" (I know) and no "Espero" (I hope).
- ja switch: "これは自分に戻ってこないと想定しています". It is first person: 自分 plus the speaker's state 想定しています. It replaces 想定どおりです.
- es contractYours says "libera fondos", which has no ERP "liberar una orden" reading.
- ja notes (ja.json:411-412): 消費します for "spends", and その中身は X ₳ (とトークン)です in place of 保持額は… .
- Every negation is kept.

**Tests.** tests/i18n.test.ts:
- "keeps a negation where English has one, for every critical key"
- the {{token}} and plural-form checks

The e2e finds the switch by its English name. The blind back-translation is the lead's next step.

**Evidence.** The i18n guards pass except the expected unchecked-draft gate (see notes).

A temporary layout probe, not committed, ran at 400×605 in en/es/ja. The spec was restored and checked by sha256. Results:
- No sideways overflow and no clipping anywhere.
- Each switch label is one line: es at y 889-910; ja at 912-932, where it was two lines before.
- The ja callout now starts at y=572, above the 605 fold; it was at 592.

Screenshots: R/fix/words/shots/sign-release-{en,es,ja}-400x605-full.png. Log: R/fix/words/logs/e2e-layout-probe-dev.log.

### L3 (cip30-rust#4)

**What.** New key dappUi.warn.unknownInputsKeyReleases_* (en.json:522-523, es.json:547-549, ja.json:497). Its value is each language's existing unknownInputs first sentence alone, reused exactly, without the stake-key sentence. DappApprovals.tsx:1305 shows it when s.keyReleases is set; otherwise dappUi.warn.unknownInputs stays.

**Tests.** extension/tests/dapp-prompt.test.ts:
- New: "never says only the stake key signs when that key is what a contract here may ask for (1.9.0's release review, L3)". It checks exact en for 1 and 2. In es and ja, at 1, 2 and 1,000,000, the new value is a strict first-sentence prefix of the old one. es has no "clave de stake" and ja no ステーク鍵.
- Existing: "says what it can't show of inputs it couldn't find, and that only the stake key signs, word for word (1.7.2's release review, i18n#0)" still passes with keyReleases unset.

**Evidence.** On the base it failed with: "Expected: It spends 1 UTxO the wallet couldn't find, so what it holds can't be shown. Received: …can't be shown. Only your stake key signs here." After the fix it passes.

### L11 (i18n#4)

**What.** Renamed dappUi.note.contractInputs_* to dappUi.note.warn.contractInputs_*, and dappUi.note.contractInputsTokens_* to dappUi.note.warn.contractInputsTokens_*, in en/es/ja (en.json:430-433, es.json:449-454, ja.json:411-412) and at DappApprovals.tsx:1074. The provenance entries are renamed, labelled machine. critical-keys.json was regenerated with `node scripts/i18n-critical.mjs --write`: 482 to 485 keys, adding the two notes and the new unfound-input key.

**Tests.** - extension/tests/dapp-prompt.test.ts "holds the notes, the row, the switch and both callouts to a back-translation (1.9.0's release review, L11)": criticalKeys() contains each note, the row, the switch, both callouts and both unfound-input keys.
- tests/i18n.test.ts "is derived from the source, and the checked-in list matches".

**Evidence.** On the base it failed with "dappUi.note.warn.contractInputs: expected [ …(482) ] to include 'dappUi.note.warn.contractInputs'". After the fix it passes. As the brief expects, the unchecked-draft gate now fails for these keys until the lead lists them.

### i18n#5

**What.** U+00A0 before ₳ in all 12 note values: 4 en, 6 es and 2 ja. The released row at DappApprovals.tsx:1109 already had it.

**Tests.** extension/tests/dapp-prompt.test.ts "keeps each note's ₳ by its number, in every language (1.9.0's release review, i18n#5)": the dapp-notes list of an honest cancel and of an unkeyed contract, in en/es/ja, contains "50 ₳" and never "50 ₳".

**Evidence.** On the base it failed with "en: expected '…It spends 1 contract UTxO holding 50 ₳ and tokens.…' to contain '50 ₳'". After the fix it passes in all three languages.

### mutants#3 (the #373 e2e)

**What.** extension/e2e/extension.spec.ts:5833-5902. The step that couldn't fail, "A yes is for one request: the next starts over", is rewritten into the queued form.
- A second signTx is sent while the first is shown, and "1 of 2 waiting" is checked.
- The first request is signed with its own yes. Its password-alone and Enter checks are kept.
- In the same window, it waits for "The next request." and for the queue to go before reading the switch, which must be aria-checked "false" (line 5884).
- The password box must be empty.
- Past the hold, Sign stays disabled, and Enter signs nothing: the second request is still unanswered after 1 s and the heading is still shown.
- No new view=dapp page opens.
- The request's own yes enables Sign. It is then declined and awaited (error code 2).
- The old switch and row words are replaced.

**Tests.** extension/e2e/extension.spec.ts:5833 "a site's request that releases a contract UTxO under the account's key says so, and Sign waits for the user's yes (a bounty report against 1.8.1)"

**Evidence.** Every run used `systemd-run --user --scope -p MemoryMax=8G -- taskset -c 0,1 xvfb-run -a npx playwright test --project=extension -g "releases a contract UTxO under the account's key says so" --repeat-each=4 --workers=4`.
- Dev build (`npx vite build`): 4 passed (21.1s).
- Store build (`VITE_ENABLE_MAINNET=true VITE_STORE_BUILD=true npx vite build`; its manifest has no key and has mainnet hosts): 4 passed (19.5s).
- Mutant m (`const ack = ackFor !== undefined;`) on a dev rebuild: 4 failed, each at extension.spec.ts:5884:52 `expect(await yes.getAttribute("aria-checked")).toBe("false")` with "Expected: \"false\" Received: \"true\"".
- Restored from a backup copy (`sha256sum -c` OK, f1ecc3fd…), then rebuilt for dev: 4 passed (20.7s).

Logs: R/fix/words/logs/e2e-dev-x4.log, e2e-store-x4.log, e2e-dev-mutant-m-x4.log, e2e-dev-restored-x4.log.

## Commands

All runs were in the worktree's seedelf-platform/seedelf-web-wallet/extension/. Logs are in R/fix/words/logs/, where R is /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/6637f822-1e93-462d-9b5e-5bd103fc4b4b/scratchpad/review-1.9.0.

**Vitest**
- `npx vitest run tests/dapp-prompt.test.ts`, on the base with the new tests: "Tests 4 failed | 27 passed (31)". The 4 failures are M1's words, i18n#5, L11 and L3.
- The same after the fix: "Tests 31 passed (31)".
- `node scripts/i18n-critical.mjs --write`: "critical-keys.json: 485 keys".
- The guards (dapp-prompt, i18n, i18n-critical-helpers, words, i18n-worker-reasons, i18n-values-in-place, i18n-screens): "Test Files 1 failed | 6 passed (7); Tests 2 failed | 180 passed (182)". The 2 are i18n.test.ts "es.json/ja.json has no unchecked machine draft among them", expected per the brief.
- Related files (i18n-joins, i18n-assembly, i18n-review-fixes, approvals-review-fixes, dapp-ties, dapp-ties-accounts, screens-wiring-review-fixes, hide-balances-forms, paid-rows, connector-lovejoin-review-fixes, collateral-reserve-review-fixes, worker-words, swap-page-words, dapp): "Test Files 14 passed (14); Tests 296 passed (296)".
- The full suite, `systemd-run --user --scope -p MemoryMax=8G -- nice -n 10 npx vitest run --maxWorkers=4`: "Test Files 1 failed | 262 passed | 1 skipped (264); Tests 2 failed | 3277 passed | 4 skipped (3283)". The only failures are the same 2 expected ones.

**Typecheck**
- `npx tsc --noEmit -p .` (covers src, tests and e2e): exit 0.

**Builds**
- `npx vite build` (dev): ok.
- `VITE_ENABLE_MAINNET=true VITE_STORE_BUILD=true npx vite build` (store): ok. The manifest has no key and has api.koios.rest.

**The #373 e2e**, each under `systemd-run --user --scope -p MemoryMax=8G -- taskset -c 0,1 xvfb-run -a npx playwright test --project=extension -g "releases a contract UTxO under the account's key says so" --repeat-each=4 --workers=4`:
- dev: "4 passed (21.1s)";
- store: "4 passed (19.5s)";
- mutant m on dev: "4 failed", all at 5884:52 (Expected "false", Received "true");
- restored, rebuilt dev: "4 passed (20.7s)".

**Load comparison**
- A neighbouring siteOnAccount1 test under the same 4-on-2 load (`-g "never calls someone else's address under another account's stake key"`, store build): "4 passed (17.4s)", 15.0-15.2 s each.
- The #373 test takes 16.7-18.9 s each, against a 30 s timeout.

**Whole connector block**
- `-g "the dApp connector"` on dev, taskset 0,1: "16 passed (2.3m)", 1 skipped (the mainnet-only test).

**Layout probe**
- Temporary, inserted with v-e2e-queue/insert-probe.py and removed; the spec was restored and `sha256sum -c` OK.
- "1 passed (6.7s)". en/es/ja at 400×605: overflowX false, sides [], cut [], every switch label one line.

**Cleanup**
- The worktree is clean after commit 923b1974.
- The node_modules symlink is removed; the main tree's node_modules is intact.
- The main tree's git status is clean.

## Notes for the lead

**1. Expected failure.** tests/i18n.test.ts "es.json/ja.json has no unchecked machine draft among them" fails for:
- es (9): dappUi.note.warn.contractInputs_{one,many,other}, dappUi.note.warn.contractInputsTokens_{one,many,other}, dappUi.warn.unknownInputsKeyReleases_{one,many,other};
- ja (3): the `_other` of each.

It clears once verified-critical-{es,ja}.json list dappUi.note.warn.contractInputs, dappUi.note.warn.contractInputsTokens and dappUi.warn.unknownInputsKeyReleases after the blind round. I didn't touch the verified files or work around the gate.

**2. A silent pass to watch.** dappUi.warn.contractAck, contractRow and contractYours are already listed in verified-critical-{es,ja}.json from #373's round. So the gate passes for them even though their es and ja values are new, unchecked drafts.
- They must go through the blind round; they're in changed_strings.
- The record should say they were redrafted and checked again.

**3. Provenance.** Every new, renamed or redrafted es/ja entry is labelled `machine`, glossary.md's label for a draft not checked value by value. That includes the new key, whose values reuse the existing mtpe first sentences exactly.

**4. The ja new key.** It reuses unknownInputs' first sentence exactly, as the brief says, so it keeps 使用する ("uses"), as dappUi.warn.unknownInputs does. The notes now say 消費します. Making the unknown-input pair say "spends" too would change a verified mtpe value outside this brief.

**5. Choices the blind round can compare against.**
- es switch: "Tengo previsto que…". Not "Espero" (hope), and not "Cuento con que…", since "contar con" also means "bear in mind", which is awareness.
- ja switch: 自分 is the house's first-person reflexive (自分で確認する, 自分の DRep); ja.json never uses 私. 想定しています is the speaker's own state.
- es contractYours: "libera fondos" avoids "liberar una orden". "Puede que sean tuyos" avoids "Pueden ser tuyos", which can read as an offer.
- ja contractYours: 署名すると drops one of four あなた. かもしれませんが ("may be…, but") renders en's "and".
- ja notes: 中身, the glossary's word for what a box holds, so "₳ and tokens" no longer predicates a sum (額).

**6. changed_strings.** ja has only `_other` and en has no `_many`, so those cells repeat the form each language actually uses for that count. Note values carry U+00A0 before ₳.

**7. What each test layer covers.**
- The e2e checks the switch by its English name. contractYours isn't on screen in the e2e, because its contract UTxO's datum doesn't name the key; Vitest covers it.
- When an earlier step fails, the e2e also lists "page.evaluate: Target page, context or browser has been closed", from the second request still pending, as the verifier saw. A passing run has none.

**8. For the docs lane.** No file outside docs/i18n quotes the old words (grepped architecture.md, flows.md and the READMEs). shared/rpc.ts:1168's comment still says "likely the user's own order or listing". It isn't a lane file and isn't shown to users.

**9. Worktree state.**
- dist/ holds the dev build of this commit.
- wasm/pkg is copied in and ignored.
- The scratch backups (DappApprovals.tsx.fixed, extension.spec.ts.fixed) and the probe are in R/fix/words/.

## The strings it wrote

| Key | en | es | ja |
|---|---|---|---|
| dappUi.warn.contractRow | From a contract, not to you | Desde un contrato, no hacia ti | コントラクトから、あなたには届かない分 |
| dappUi.warn.contractAck | I expect this not to come back to me | Tengo previsto que esto no vuelva a mí | これは自分に戻ってこないと想定しています |
| dappUi.warn.contractYours | Your signature releases funds from a contract that names your key. They may be yours, and they don't come back to you. | Tu firma libera fondos de un contrato que menciona tu clave. Puede que sean tuyos, y no vuelven a ti. | 署名すると、あなたの鍵が記載されたコントラクトから資金が解放されます。あなたのものかもしれませんが、あなたには戻ってきません。 |
| dappUi.warn.unknownInputsKeyReleases_one | It spends {{count}} UTxO the wallet couldn't find, so what it holds can't be shown. | Gasta {{count}} UTxO que la billetera no pudo encontrar, así que no se puede mostrar lo que contiene. | ウォレットが見つけられなかった UTxO を {{count}} 件使用するため、その内容は表示できません。 |
| dappUi.warn.unknownInputsKeyReleases_other | It spends {{count}} UTxOs the wallet couldn't find, so what they hold can't be shown. | Gasta {{count}} UTxOs que la billetera no pudo encontrar, así que no se puede mostrar lo que contienen. | ウォレットが見つけられなかった UTxO を {{count}} 件使用するため、その内容は表示できません。 |
| dappUi.warn.unknownInputsKeyReleases_many | It spends {{count}} UTxOs the wallet couldn't find, so what they hold can't be shown. | Gasta {{count}} UTxOs que la billetera no pudo encontrar, así que no se puede mostrar lo que contienen. | ウォレットが見つけられなかった UTxO を {{count}} 件使用するため、その内容は表示できません。 |
| dappUi.note.warn.contractInputs_one | It spends {{count}} contract UTxO holding {{ada}} ₳. | Gasta {{count}} UTxO de contrato que contiene {{ada}} ₳. | コントラクトの UTxO を {{count}} 件消費します。その中身は {{ada}} ₳ です。 |
| dappUi.note.warn.contractInputs_other | It spends {{count}} contract UTxOs holding {{ada}} ₳. | Gasta {{count}} UTxOs de contrato que contienen {{ada}} ₳. | コントラクトの UTxO を {{count}} 件消費します。その中身は {{ada}} ₳ です。 |
| dappUi.note.warn.contractInputs_many | It spends {{count}} contract UTxOs holding {{ada}} ₳. | Gasta {{count}} UTxOs de contrato que contienen {{ada}} ₳. | コントラクトの UTxO を {{count}} 件消費します。その中身は {{ada}} ₳ です。 |
| dappUi.note.warn.contractInputsTokens_one | It spends {{count}} contract UTxO holding {{ada}} ₳ and tokens. | Gasta {{count}} UTxO de contrato que contiene {{ada}} ₳ y tokens. | コントラクトの UTxO を {{count}} 件消費します。その中身は {{ada}} ₳ とトークンです。 |
| dappUi.note.warn.contractInputsTokens_other | It spends {{count}} contract UTxOs holding {{ada}} ₳ and tokens. | Gasta {{count}} UTxOs de contrato que contienen {{ada}} ₳ y tokens. | コントラクトの UTxO を {{count}} 件消費します。その中身は {{ada}} ₳ とトークンです。 |
| dappUi.note.warn.contractInputsTokens_many | It spends {{count}} contract UTxOs holding {{ada}} ₳ and tokens. | Gasta {{count}} UTxOs de contrato que contienen {{ada}} ₳ y tokens. | コントラクトの UTxO を {{count}} 件消費します。その中身は {{ada}} ₳ とトークンです。 |

