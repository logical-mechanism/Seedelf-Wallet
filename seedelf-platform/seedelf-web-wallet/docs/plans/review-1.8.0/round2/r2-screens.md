# 1.8.0's release review, round two: r2-screens

*Written by the lead from the reviewer's structured output (workflow `wf_af158591-549`); the harness refused the reviewer's own file.*

## r2-screens#0: Settings' question before Try again on the retired pools' run: a static render can reach it, and no test pins its wiring

**Severity:** low · **Kind:** test · **Introduced:** new · **Lanes:** lead, retire · **Proven:** mutation

**Where:**
- extension/src/ui/components/BringAllBack.tsx:256
- extension/src/ui/components/BringAllBack.tsx:444
- extension/src/ui/components/BringAllBack.tsx:216

**Claim:** R2BRIEF lists `retired={!!bringAsk(pool, bringing).retired}` (a990deb8) as untested because no static render reaches BringAllBack's `asking` state. One does. The house's vi.mock("react") seam (the `seed`/`seedInitial` of tests/lovejoin-screens-review-fixes-1-8-0.test.ts) can seed BringAllBack's first state, `bringing`, with the run as the worker keeps it, and its first state that starts false, `asking`, with true. With those seeds, three mutants of the line are caught. Every house test file that names BringAllBack passes under them.

**Scenario:** A later edit drops the prop, or reads it from the run as shown rather than as asked (`retired={!!bringing?.retired}`). A press in Settings while the retired pools' run goes widens it to every pool's, but its question then says "Bring the retired pools' boxes back now?" and every pool's boxes come back. Or the stopped run's Try again asks "Bring every box back now?" again, the overstatement the retire lane's For the lead, 3 removed. No test fails.

**Evidence:** From the sandbox's extension/: `npx vitest run tests/r2-screens-bring-question.test.ts --maxWorkers=2` gives 3 passed (en, es, ja), with four cases each. The retired run stopped gives settings.lovejoin.bringRetiredTitle. Every pool's run stopped, the first press, and a press while the retired run goes each give settings.lovejoin.bringTitle. A retired pool's page gives lovejoin.bring.title. Each mutant was applied by exact replacement of the line, and the file was restored afterwards (sha256 42f21e61… checked). `retired={false}`: 3 failed. `retired={!!bringing?.retired}`: 3 failed. `retired={!!bringAsk(pool, undefined).retired}`: 3 failed. The house's tests under `retired={!!bringing?.retired}`: `npx vitest run tests/lovejoin-retired.test.ts tests/lovejoin-bring-review-fixes.test.ts tests/lovejoin-screens-review-fixes-1-8-0.test.ts tests/lovejoin-bring-all-back.test.ts tests/lovejoin-retire-review-fixes.test.ts tests/screens-wiring-review-fixes.test.ts tests/settings.test.ts tests/lovejoin-bring-screen-review-fixes.test.ts --maxWorkers=2` gives 8 files, 203 passed. Under `retired={false}`, five of those files give 131 passed.

**Fix:** Adopt the sandbox's tests/r2-screens-bring-question.test.ts, or its `question()` helper, beside the retire lane's BringAllBack tests. It's 60 lines, with the seam inline.

## r2-screens#1: es lj.skip.warn.floorShort opens with a capital after every frame's colon, where every other es reason opens lowercase

**Severity:** nit · **Kind:** words · **Introduced:** reachable · **Lanes:** find · **Proven:** test

**Where:**
- extension/src/i18n/translations/es.json:987
- extension/src/i18n/translations/es.json:988
- extension/src/i18n/translations/es.json:989
- extension/src/i18n/translations/es.json:993
- extension/src/i18n/translations/en.json:946
- extension/src/ui/components/LovejoinReturn.tsx:417
- extension/src/ui/components/LovejoinReturn.tsx:451
- extension/src/ui/screens/Lovejoin.tsx:913
- extension/src/ui/screens/ClaimAll.tsx:363
- extension/src/background/lovejoin.ts:553
- extension/src/background/sessions.ts:6289

**Claim:** floorShort reaches only colon frames: lovejoin.warn.skippedThis, lovejoin.warn.skippedIts, claim.warn.skippedItem, lj.leftOut, and LovejoinSkipped's own message (also lj.leftOut) on the page's error line. It never opens a sentence: priced's `skipped`, which Swaps.tsx's `opening` capitalises, is only noAdaPool, poolFloor or poolFree. Every other es reason given there opens lowercase, as clauseOf's rule has it ("Where the language starts a clause in lowercase, as sess.skip.warn.chainFailed itself does in English and Spanish, the message's capital goes"), its sibling needsMore ("el pool de Lovejoin tiene…") included. critic#0's rewording kept 1.7's "El pool…" in all three forms. In Spanish a clause after a colon in running text is lowercase. The en and es lj.skip.warn.untoldAll ("The server…", "El servidor…") have the same capital. They're 1.7.2's, and only Mix my boxes again from the private balance meets them. ja has no case, and every reason there is a polite-form sentence, consistently.

**Scenario:** Mainnet, v2's 5 ₳ pool under its floor with 20 others. Every return's review in es reads "Lovejoin se deja fuera de esta devolución: El pool de Lovejoin tenía 20 cajas que no son tuyas cuando la billetera lo leyó, y la billetera solo mezcla a partir de 30. Todo vuelve directamente, sin mezclar." With no pool at all, the same frame reads "…: la billetera no conocía ningún pool…". Under the floor, that's every mainnet return (critic#0), and collateralWanted now gives it too (critic#1). The same capital shows on the session's page later ("Lovejoin se dejó fuera de su devolución: El pool…"), in Bring everything back ("Sesión privada 1: El pool…") and on a tile Mix's card ("Lovejoin se dejó fuera: El pool…").

**Evidence:** `npx vitest run tests/r2-screens-openings.test.ts --maxWorkers=2` gives 2 failed. The test checks, for the 13 reasons the worker-reasons scan finds given to a LovejoinSkipped or saved as lovejoinSkipped, that each opens lowercase unless it starts with a name (clauseOf's NAMED). es received [lj.skip.warn.floorShort_many, _one, _other, lj.skip.warn.untoldAll]; en received [lj.skip.warn.untoldAll]. The reason list came from the house's own scan: a copy of tests/i18n-worker-reasons.test.ts that dumps FOUND (tests/r2-screens-reasons-dump.test.ts). The frames are rendered in en, es and ja by tests/r2-screens-render.test.ts ("the colon frames"): 15 reasons in 4 frames each. Base: `git show 6b70c1f8:…/es.json` already had "El pool de Lovejoin tiene…".

**Fix:** es floorShort's three forms: "el pool de Lovejoin tenía…". The key is awaiting its blind back-translation already (critic#0), so this edit joins that round at no cost. Update the es pin at tests/lovejoin-found-later.test.ts:761. If the lead takes the older one too, untoldAll becomes "the server hasn't said…" / "el servidor no ha dicho…"; it's critical, so es needs a round.

## r2-screens#2: "the 5 ₳ kept aside once": W5 put "kept aside" before the mix's "once", which then reads as kept aside once (en and es)

**Severity:** nit · **Kind:** words · **Introduced:** new · **Lanes:** connector · **Proven:** reading

**Where:**
- extension/src/i18n/translations/en.json:349
- extension/src/i18n/translations/es.json:367
- extension/src/ui/screens/DappApprovals.tsx:494

**Claim:** Before W5, dappUi.back.privacy.noteLovejoinMixed said "…and the 5 ₳ once, in a box of its own, only if enough is left", where "once" could only be the mix's. Now it says "and the 5 ₳ kept aside once, in a box of its own", and "once" follows the participle: it reads first as kept aside one time. es is the same: "y los 5 ₳ apartados una vez, en una caja propia". ja is fine: "確保分の 5 ₳ は…専用のボックスで 1 回ミックスします" keeps the count with the verb. The house's own e2e comment shows the misreading (e2e/extension.spec.ts:5328, "the 5 ₳ kept aside once only if enough is left"). Judged for naturalness alone: the value is critical, and its meaning is the translators'.

**Scenario:** A site's private-session funding where Review read v2's 5 ₳ pool taking a box and the collateral's mix may go (lovejoinRoom and collateralMix). The review's note under "Later, to bring it back".

**Evidence:** Rendered by tests/r2-screens-render.test.ts ("review, marked, collateral mixed"). en: "Lovejoin mixes the spare ADA in 5 ₳ boxes, and the 5 ₳ kept aside once, in a box of its own, only if enough is left, so they're harder to tie to this session; they come back hours later." es: "…y los 5 ₳ apartados una vez, en una caja propia, solo si queda lo suficiente…". The base value is from `git diff 1beba3fb 4b4628e9 -- …/en.json`. Pins that follow the words: tests/approvals-review-fixes.test.ts:163, :329, :575; tests/connector-lovejoin-review-fixes.test.ts:74; e2e/extension.spec.ts:5333.

**Fix:** Keep the count with the verb. en: "…in 5 ₳ boxes, and mixes once the 5 ₳ kept aside, in a box of its own, only if enough is left…". es: "…en cajas de 5 ₳, y mezcla una vez los 5 ₳ apartados, en una caja propia, solo si queda lo suficiente…". W5's values are owed a fresh blind round already (W6, the connector lane's keys 2 and 3), so the reorder joins it. Update the pins listed.

## r2-screens#3: O6's "takes boxes" counts a pool below the network's minimum, so the hub neither says "No pool to mix in yet." nor keeps its 5 ₳ aside

**Severity:** nit · **Kind:** code · **Introduced:** new · **Lanes:** screens · **Proven:** test

**Where:**
- extension/src/ui/screens/Lovejoin.tsx:1944
- extension/src/ui/screens/Lovejoin.tsx:1945
- extension/src/ui/screens/Lovejoin.tsx:1946
- extension/src/ui/screens/Lovejoin.tsx:1954
- extension/src/ui/screens/Lovejoin.tsx:2031

**Claim:** `takes = (p) => !isRetired(p) && !isCopy(p)` still counts a pool whose `unusable` is `belowMinimum` as taking boxes. The wallet puts no new box there (lj.unusable.warn.belowMinimum), and Mix and Bootstrap say so under them. So where every listed pool is retired or below the minimum, "No pool to mix in yet." isn't said. And a v2 token pool below the minimum turns the aside to "A mixer for ADA and tokens".

**Scenario:** A v2 token pool whose box holds less ADA than today's parameters ask, because it was launched that way or coinsPerUTxOByte rose. Alone, or beside the classic pool's boxes, the hub shows its row with the below-minimum reason, no none-line, and the aside "A mixer for ADA and tokens" (es "Un mezclador de ADA y tokens", ja "ADA とトークンをミックスするサービス").

**Evidence:** `npx vitest run tests/r2-screens-render.test.ts -t "more states" --maxWorkers=2` gives 6 passed, writing the renders to …/scratchpad/r2-screens-render.md. In en, es and ja: aside "A mixer for ADA and tokens" and none-line "(none)", alone and with 2 classic boxes. I then applied `const takes = (p: ShownPool) => !p.unusable;` and ran `npx vitest run tests/lovejoin-screens-review-fixes-1-8-0.test.ts tests/r2-screens-render.test.ts --maxWorkers=2`: 64 passed, the house's O6 tests included. The case then says "No pool to mix in yet." with the 5 ₳ aside in all three languages. The file was restored (sha256 3f8c43a3… checked).

**Fix:** `const takes = (p: ShownPool) => !p.unusable;`. `unusable` is retired, superseded or belowMinimum, and none of them takes a new box. Add a below-minimum case to the O6 test.

## r2-screens#4: The hub's aside "A mixer for ADA, in 5 ₳ boxes" stands above a v2 ADA pool of another box value

**Severity:** nit · **Kind:** words · **Introduced:** new · **Lanes:** screens · **Proven:** test

**Where:**
- extension/src/ui/screens/Lovejoin.tsx:1945
- extension/src/ui/screens/Lovejoin.tsx:1954
- extension/src/i18n/translations/en.json:983
- extension/src/i18n/translations/es.json:1030
- extension/src/i18n/translations/ja.json:936

**Claim:** O6 keys the aside on a token pool that takes boxes. Anyone can start a v2 ADA pool at any box value but 10 ₳: the hub's Start a pool offers it, and the shown rule lists the earliest pool of each value. Such a pool gets the 5 ₳ aside. Alone, the hub says Lovejoin mixes ADA "in 5 ₳ boxes" above only a 20 ₳ pool, with no 5 ₳ pool anywhere. Beside the 5 ₳ pool, the aside leaves the other value out. At the base the aside said "and tokens" here, which was wrong too.

**Scenario:** Someone starts a v2 ADA pool of 20 ₳ on mainnet before the owner's 5 ₳ pool. Every wallet's hub then reads "A mixer for ADA, in 5 ₳ boxes" above "ADA ₳ 20 ₳ 40 boxes not yours". es and ja read the same.

**Evidence:** `npx vitest run tests/r2-screens-render.test.ts -t "another box value" --maxWorkers=2` gives 3 passed. A 20 ₳ ADA pool alone, and the 5 ₳ pool with a 20 ₳ one, give the aside "A mixer for ADA, in 5 ₳ boxes" (es "Un mezclador de ADA, en cajas de 5 ₳", ja "5 ₳ のボックスで ADA をミックスするサービス") above the 20 ₳ row.

**Fix:** Say "in 5 ₳ boxes" only where every ADA pool that takes boxes holds 5 ₳, or none does. Otherwise use a plain "A mixer for ADA": a new non-critical key in en, es and ja. Or leave it, since the owner's 5 ₳ pool is the only one planned.

## r2-screens#5: A v2 pool's page during the retired pools' run says "Another pool's boxes are coming back now. Stop that first…"

**Severity:** nit · **Kind:** words · **Introduced:** new · **Lanes:** retire · **Proven:** test

**Where:**
- extension/src/ui/components/BringAllBack.tsx:231
- extension/src/ui/components/BringAllBack.tsx:377
- extension/src/i18n/translations/en.json:2004
- extension/src/i18n/translations/es.json:2134
- extension/src/i18n/translations/ja.json:1874

**Claim:** This is words#2's optional half, which W2's fix (goingText alone) left. The retired pools' run, over several pools, is "another pool's" on a v2 pool's page (`other`: coversRun is false for the retired run on a page not retired). The line also asks the user to stop it first, though the owner's call 3 wants it right away. The worker's own refusal, lj.bringOtherPool, uses the same words.

**Scenario:** The retired pools' run goes, asked again from Settings after it stopped or running long at the first unlock, while the wallet has boxes in v2's 5 ₳ pool (a return mixed there). That pool's page shows "Another pool's boxes are coming back now. Stop that first, or use Settings for every pool." with its link off. es: "Las cajas de otro pool…". ja: "ほかのプールのボックス…".

**Evidence:** `npx vitest run tests/r2-screens-render.test.ts -t "more states" --maxWorkers=2` rendered BringAllBack on the 5 ₳ pool's page (pool FIVE, retired false) with `bringing` seeded {back: 1, left: 2, retired: true}. It gives exactly those lines in en, es and ja. A retired pool's page in the same state gives settings.lovejoin.bringingRetired (W2), as intended.

**Fix:** A retired variant where `going.retired`, non-critical, in en, es and ja. For example: "The retired pools' boxes are coming back now. This pool's can come back once that's done, or use Settings for every pool."

## Covered

- The method: every screen rendered statically through the house's vi.mock("react") seam, in en, es and ja, in the owner's call's states. The scratch tests are in the sandbox's extension/tests (r2-screens-render, r2-screens-openings, r2-screens-bring-question, r2-screens-reasons-dump); renders go to …/scratchpad/r2-screens-render.md. tsc is clean with them in.
- W1: every form of swaps.cost.boxesLabel, swaps.boxes.atMost_* and roomFor_* (en 5, es 7, ja 3) says 5 ₳ with its U+00A0. I rendered them in the cost rows (at most, and room for), the approval's stop line and Stop's dialog, in all three languages; each reads naturally and matches the English. A swap's ADA boxes are the 5 ₳ pool's by rule (adaPoolOf), so 5 ₳ is true, including for a 1.7.2-approved swap whose Stop is capped at its classic count.
- settings.lovejoin.bringRetiredTitle: es "¿Traer de vuelta ahora las cajas de los pools retirados?" and ja "廃止されたプールのボックスを今すぐ戻しますか？" are natural, match the English, and follow their siblings lovejoin.bring.title and bringNoneRetired. Their provenance is machine in es and ja. I rendered the question through Settings' BringAllBack in each run state and language (see r2-screens#0).
- O6 and S1, the hub, in seven states and three languages: no pool at all; the classic pool's boxes only; the classic and a retired token pool; v2's 5 ₳ pool found later under its floor; past its floor; under its floor beside classic boxes; a v2 token pool alone. The aside and "No pool to mix in yet." are true in each, except the two edges in #3 and #4. The search hides with its groups. Start a pool's critical cost note keeps its gate, and its words ("ADA at a box value other than 10 ₳") still hold under v2.
- v2's 5 ₳ pool's page under its floor (12 of 30) and past it, in three languages. Under the floor: Help start, the Bootstrap form with its 18 boxes, and Mix's floor sentence pointing to it. Past the floor: Mix with the Bootstrap link. True for the owner's call 4.
- W8: a stopped chain's row with `retired` says why it stopped alone (lovejoin.detail.whyStopped); without it, it adds Mix my boxes again. Natural in es and ja.
- S2, keptPage: the hub keeps a retired token pool's page once a read lists it no more. Its words are "Your boxes in the pool: None", Mix's Review off with the retired reason, the private launch link, and BringAllBack's Done lines (its own run, the retired pools' run, none sent) in three languages. Nothing on the kept page is false. Its Bring link can run again and says nothing was left.
- O3, the connect card: en and es join with a space, ja with none, as joinSentences does. staysLovejoin plus onPoolShort reads as a qualifier of the line's mixing in all three. "when it comes back" after "back hours later" could be read as the boxes' arrival, but the card's first sentence ("Bring it back from the dApps page") anchors it; I judged it acceptable and made no finding. staysDirect losing `{box}` is right (no placeholder).
- O3 and W5, the funding review's note in five states and three languages: marked with the collateral's mix, marked, hedged, hedged with the collateral, direct. Never the direct words where it hedges.
- O4, Swaps.tsx's `opening`: only swaps.lovejoin.warn.pool and swaps.stop.poolShort open a sentence with a reason, which I checked against every en/es/ja value starting with {{why}}, {{reason}}, {{detail}} or {{error}}. Both now capitalise. es noAdaPool becomes "La billetera no conocía…"; poolFloor and poolFree already open "Ahora mismo"/"Right now"; ja is unaffected. Stop's dialog with no pool reads right with the switch on and off.
- The colon frames: 15 reasons in skippedThis, skippedIts, lj.leftOut and claim.warn.skippedItem, in three languages. ja reasons are all full polite-form sentences, consistent. en and es are lowercase but for names, except #1's. The retired sentence's capital is W3's accepted case, a 1.7 mix card alone.
- The critical values changed this round, judged for naturalness and register in es and ja only, since their meaning is the translators' (being back-translated blind): noteLovejoin (es "los 5 ₳ apartados", ja "確保分の 5 ₳"), noteLovejoinMixed (see #2), noteLovejoinPoolShort (es "si el pool de Lovejoin tiene sitio para entonces", ja "戻る時点で…空きがあれば"), floorShort (natural; see #1 for es's capital), noAdaPool (es imperfect subjunctive, ja polite past), and lj.unusable.warn.retired (its first sentence, unchanged). All natural, and the register matches their siblings. The past tense "knew" in the present-tense frames (the approval, Stop, skippedThis) reads a little oddly but stays true later, which was O4's purpose.
- Settings' Bring every box back in three languages. The retired run going shows bringingRetired with the widen button and bringNote. Stopped by itself, it shows the callout and Try again with no bringNote (R4), and its question carries the retired title (the lead's 3). Every pool's run stopped, and the first press, show bringTitle. The ja callout's "すべてのボックスの引き戻しが止まりました" is 1.6.0's verified value, the feature's name, also used on pool pages; it's old and acceptable.
- W2 on a retired pool's page while the retired run goes (bringingRetired, three languages). R4's bringAsk and doneShown read right. W9: `why` is againRefused, so OtherAccounts hides exactly where Mix again is refused.
- The glossary: "pool of 5 ₳ boxes" (es "pool … de cajas de 5 ₳", ja "5 ₳ ボックスの … プール") in noAdaPool; "kept aside" as noteDirect has it; W1's ja forms follow ボックス N 件. W11 (retired) is item 10 of the docs writer's brief. U+00A0 sits before every ₳ in every changed value. No new value names Seedelf, and words.test.ts passes.
- The rpc.ts merge (LovejoinChainView.retired, SessionOutSummary.lovejoinRoom, DappAsk's lovejoinRoom, lovejoin-bring-all-back's retired) is clean. Home.tsx and preferences.tsx are comment-only, and the comments are accurate.
- Suites at 4b4628e9, all --maxWorkers=2. Default build: tests/i18n*.test.ts, words, worker-words, screens, lovejoin-screens-review-fixes-1-8-0 and screens-wiring-review-fixes give 13 files, 339 passed. connector-lovejoin-review-fixes, lovejoin-retire-review-fixes, approvals-review-fixes, dapp-prompt and collateral-reserve-review-fixes give 5 files, 132 passed. lovejoin-found-later and lovejoin-share-review-fixes give 2 files, 59 passed. VITE_ENABLE_MAINNET=false, the i18n, words and screen files with the connector and retire files: 15 files, 391 passed.

## Not checked

- Anything after an await, or an effect, in a real DOM: Chrome's order of reads, BringAllBack's Done arriving inside the kept page in one live render, and a real press of Try again. Static renders only; no Playwright.
- Layout and wrapping at the side panel's width, including the card's longer hedged line.
- The worker's figures behind each state (priced, lovejoinRoomNow/Kept, collateralWanted, stopCost's classic cap): r2-worker's lens. I took the summaries as given.
- The meaning of the critical values changed this round in es and ja: the translators' blind round, per the brief.
- The share lane's P1 line (lovejoin.mix.privacy.collateralIfLeft) in its new draw-short state: read, not rendered in three languages.
- Home's In Lovejoin in the retired states after critic#3's worker change: Home.tsx changed only a comment, and I didn't re-render it.
- The store listing's words (D5) and the other docs: the docs writer's.
- Chrome Translate over the pages.
