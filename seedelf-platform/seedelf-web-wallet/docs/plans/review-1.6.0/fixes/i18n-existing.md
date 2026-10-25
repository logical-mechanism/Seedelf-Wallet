# i18n-existing: the fix round's report

The translation findings on existing keys (x-i18n-es#0 to #5, x-i18n-ja#0 to #6) and `glossary.md`'s 1.6.0 words. These are wording changes in the three locales and the glossary. Three existing tests now pin the new words, and one new guard test covers the owner's naming rule. Every claim below was checked against the code first. Line numbers are as they stood today, and other lanes are moving them.

## Findings

### x-i18n-es#0: fixed
- es `lovejoin.pools.starting`: "En marcha: …" (in this file, "running") is now "Poniéndose en marcha: {{have}} de {{floor}} cajas".
  - It says the pool is still getting going.
  - It uses the verb of the page the flag leads to (`lovejoin.bootstrap.title`, "Ayuda a poner en marcha este pool").
- Not "Arrancando", the finding's other option: arranque/arrancar is the Bootstrap itself (`home.lovejoin.bootstrapping_*`, "Arranque · …"), and a pool short of its floor may have no one bootstrapping it.
- The flag shows only while the pool holds fewer boxes that aren't yours than its floor (`bootstrapProgress`, lovejoin-pools.ts:173-176; Lovejoin.tsx:1781-1783).
- Test: none (wording). No test pins the es value.

### x-i18n-es#1: fixed, in en, es and ja
- The rule:
  - At funding, the reserve is added only where the return goes through Lovejoin, Settings has the collateral go in, and a 5 ₳ pool would take it now (`tailReserve`, sessions.ts:4366, through `collateralPool` in lovejoin.ts: shown, not short of its floor, two boxes free).
  - At return, the collateral goes in whenever that pool qualifies at that moment (`intoPool`, sessions.ts:4135). Otherwise it comes back with the rest.
- en:
  - Before: "…holds enough of theirs. A session funded while it does pays a little more … If not, the collateral comes back with the rest."
  - After: "…holds enough of theirs; if not, the collateral comes back with the rest. A session funded while that pool does pays a little more…".
  - "If not" now sits next to the condition it denies.
  - "it" became "that pool": after the reorder, "it" would have named the collateral.
- es:
  - The same order.
  - "mientras lo tenga", whose "lo" pointed at nothing, became "Mientras ese pool exista y tenga suficientes, financiar una sesión cuesta un poco más por esa mezcla…".
  - "vuelve sola" became "vuelve por sí sola". This is the fix 1.6.0's release round made where "sola" read as "alone" (verified-critical-es.json).
- ja:
  - そうでなければ came after the funding sentence. It is now an explicit 「プールがないか、ボックスが足りなければ、…」 straight after the condition.
  - The funding sentence now states the whole condition (「プールがあってボックスが足りている間に」), where it said only 「プールがある間に」.
  - ほかの人 became ほかの人たち. Round eleven made the same fix to the same words in `lovejoin.collateralBox.privacy.note`, where they read as one person.
- Test: tests/settings.test.ts, "has the collateral's own switch, on by default, off with the returns', saying what each way does".
  - It now expects "if that pool exists and holds enough of theirs; if not, the collateral comes back with the rest." and "A session funded while that pool does pays a little more for that mix, and what the mix doesn't use comes back".
  - Fail before: `expected ' Lovejoin Private sessions bring thei…' to contain 'if that pool exists and holds enough …'`.
  - Mutation check: with the en hunk undone, the test fails. Restored, it passes.

### x-i18n-ja#0: fixed, in en, es and ja
- "Koios didn't answer" is now "the server didn't answer" in `worker.parts.partlyMaybe` and `worker.parts.fundingPartlyMaybe`, in all three languages. es says "el servidor no respondió", ja 「サーバーが応答しなかった」. This follows `koios.dataNoAnswer`, `worker.pending.maybeSentWait`, `lj.boxMaybeSent` and `swaps.retry.koiosSilent`.
- How other strings name the source per network: they don't switch by network.
  - Since the owner's call of 2026-10-09 (privacy.md:119, flows.md:23), every string about an answer either server may give says "the server".
  - Koios is named only where Koios alone is meant:
    - Chrome's access to it (`koios.notAllowed`, `serviceAccess.warn.*`);
    - the Koios-only switch and Settings' server status (`settings.koiosOnly*`, `settings.server.*`);
    - a DRep profile (`drep.privacy.profile`).
  - These two keys were the only send-state values that named Koios.
- The path, checked:
  - `sendParts` (parts.ts:599) and the funding's send (sessions.ts:5422) throw them;
  - pending.ts sends through `deps.koios(network)`, which on mainnet is `DataLayerKoios` (sw.ts:181).
- Tests:
  - New, tests/i18n-review-fixes.test.ts, "a send no server answered, in every language (1.6.0's release review, x-i18n-ja#0)".
    - In en, es and ja, no value may say "Koios didn't answer", "Koios no respondió" or 「Koios が応答」.
    - Fail before, in each language: `expected [ 'worker.parts.partlyMaybe', …(1) ] to deeply equal []`.
  - tests/sessions-review-fixes.test.ts, "untested-stopped-hook-notsent: …" (the skeptic's line 703).
    - It now expects `/the server didn't answer for the last one sent, so the rest didn't go/`, where it expected `/Koios didn't answer for the last one sent/`.
    - Fail before: `… but got '2 of 4 transactions of its funding we…'`.
  - tests/parts-send-review-fixes.test.ts, "says a part Koios never answered at Send, …".
    - It now expects `/^1 of 2 transactions went, but the server didn't answer for the last one, so the rest didn't go\./`, where it expected `/Koios didn't answer/`.
    - Fail before: `… but got '1 of 2 transactions went, but Koios d…'`.
- Mutation checks:
  - Batch A undid four hunks: en partlyMaybe, es partlyMaybe, ja fundingPartlyMaybe and en collateralOn. The guard's en, es and ja cases failed, and so did the parts-send test and the settings test. The sessions test, whose hunk stayed, passed.
  - Batch B undid en fundingPartlyMaybe alone. The guard's en case and the sessions test failed.
  - Each was restored with Edit, and all pass.

### x-i18n-ja#1: fixed
- ja partlyMaybe:
  - 「それが確定したら」 ("once it lands", one outcome only) became 「その 1 件が確定するか、確定できなくなったら」. That covers both outcomes, as 1.5.0's `worker.pending.maybeSentWait` says them.
  - 「{{total}} 件のうち」 became 「{{total}} 件のトランザクションのうち」, as `worker.parts.partly` says it.
- This is the same edit as x-i18n-ja#0's.
- 「残りは待機しています」 also became 「残りは送られませんでした」. See x-scenarios-sessions#2 below.
- Test: the guard above covers this value's server. The rest is wording.

### x-i18n-ja#2: fixed
- ja `lovejoin.ways.fundedInto`: 入金 (paying into the public account) became 資金提供. That is the glossary's word for a private session's funding, and the one every swap screen uses.
- It shows only on a swap's review (LovejoinReturn.tsx:241, `funded`).
- Test: none (wording).

### x-i18n-es#2: partly
- These are es-only changes. The English is number-free, but no count is passed (Lovejoin.tsx:1785 and :2015, LovejoinReturn.tsx:241), so the Spanish participles stayed plural for one box.
  - `lovejoin.pools.flag.held`: "{{n}} retenidas por un arranque" became "Retenidas por un arranque: {{n}}". That is a heading with its count, which Spanish uses for any number ("Pendientes: 1"), and it matches ja's 「ブートストラップで保持 {{n}}」.
  - `lovejoin.mixes.againOf`: "{{what}}, mezcladas otra vez" became "Nueva mezcla de {{what}}", as 1.5.0's `lovejoin.mixes.again` already words it ("Nueva mezcla de {{boxes}}").
  - `lovejoin.ways.fundedInto`: "…, financiadas ahora" became "…, con cargo a esta financiación" ("charged to this funding"). The ja now says the same.
  - `lovejoin.tag.held`: "Retenidas" became "Retenida". It now agrees with the mix, as the other tags do (Completada, Detenida).
- Not done: the skeptic added `lovejoin.mixes.held`, and `.released` sits on the same row. Their English is plural for one box too ("held until you bring them back", "coming back by themselves").
  - The fix passes `count` at Lovejoin.tsx:2053 and adds `_one` forms in en and es.
  - That is screen code, for the screens round (Notes).
- Test: none (wording). No test pins these es values.

### x-i18n-es#3: fixed
- es `lovejoin.launch.needBox` and `needQuantity`: "Escribe…" became "Ingresa cuánto ADA tiene cada caja." and "Ingresa cuánto del token tiene cada caja.". This follows the glossary's "Enter (a value) | Ingresa".
- A script check: all 18 en values that start with "Enter " now start with "Ingresa" in es.
- Test: none (wording).

### x-i18n-es#4: fixed
- es partlyMaybe:
  - "no respondió por la última" ("responder por" means to vouch for) became "no respondió a la última enviada", as the funding sibling says it.
  - "Cuando se resuelva" became "Cuando esa se resuelva", which names the transaction that may still land.
- This is the same edit as x-i18n-ja#0's.

### x-i18n-es#5: fixed
- es `lovejoin.bootstrap.atMost`: "Como máximo caben {{most}} en una." became "Como máximo caben {{most}} a la vez.".
  - The bare "una" could name the account or a box.
  - "a la vez" is how its sibling `atMostPrivate` and `lj.boxRange.bootstrap` say it.
- Test: none (wording).

### x-i18n-ja#3: fixed
- ja `worker.parts.tooMany`: 受取人を 1 人ずつ became 宛先を 1 件ずつ.
  - The glossary gives 宛先 for a recipient.
  - A recipient is an address or a Seedelf, counted in 件, as `shared.recipients.tooMany` counts them.
- Test: none (wording).

### x-i18n-ja#4: fixed, from the other side (a critical key)
- The finding suggested making the non-critical `lj.launch.otherPool` say クレデンシャル. I changed the critical `lovejoin.launch.warn.atMost` to 資格情報 instead.
- Why:
  - 資格情報 is Lace 2.4.2's word: 7 uses and no クレデンシャル (`_reference/lace` ja.json).
  - It has been the wallet's word since 1.5.0 (`tx.certField.credential`, `.cold`, `.hot`).
  - クレデンシャル was its only use in ja.json, and the 34f note records no choice of it.
  - The app now says a credential one way, which is what the glossary asks.
- Cost: one critical key to back-translate again (Notes). Only that one word changed.
- Test: none (wording).

### x-i18n-ja#5: fixed
- ja `lovejoin.pools.starting`: 「立ち上げ中：{{floor}} 件中 {{have}} 件」 became 「立ち上げ中：ボックス {{floor}} 件中 {{have}} 件」. This follows the glossary's ボックス N 件, and names the boxes as `lovejoin.bootstrap.progress` does.
- Test: none (wording).

### x-i18n-ja#6: fixed
- I edited `docs/i18n/glossary.md` myself: lane D owns `WW/docs/**`, and the HANDOFF gives this group the glossary's 1.6.0 words.
- New section, "Chosen for 1.6.0 (the release review, 2026-10-25)".
  - It takes the form of the 2026-10-03 section: Claude's choices, the owner's to overrule.
  - It has one en/es/ja/note table:
    - the token, ADA and classic pools;
    - box value;
    - Start a pool, and its start;
    - Help start and Being started, with why never a bare "En marcha";
    - Bootstrap, and held;
    - the floor;
    - four boxes a mix;
    - the pool of 5 ₳ boxes, and the collateral's mix;
    - a pool's copy, and a pool's credential (資格情報);
    - sent in parts, and only partly sent;
    - settled (確定するか、確定できなくなる, x-i18n-ja#1's test idea);
    - Bring every box back now;
    - change.
- Each row is the values as they stand, checked by script over en, es and ja: the Bootstrap words in all 24 en keys, the pools, four wide, the collateral's mix, "in parts" and the pool of 5 ₳ boxes. No strays are left after this round's fixes.
- change is recorded as 釣り銭, not the finding's おつり.
  - 釣り銭 is the wallet's word in 8 values, since 1.5.0.
  - おつり is in 2: `drep.register.short`, and the critical `lovejoin.launch.privacy.private` (34f's pick over 残り).
  - The row's note says so. I changed neither value (owner's calls).
- In the owner's table ("The terms"), a row for "the server" (el servidor, サーバー).
  - It records the owner's 2026-10-09 call, which lived only in flows.md:23 and privacy.md:119.
  - 1.6.0's parts keys broke that rule because the glossary didn't carry it.

### x-scenarios-sessions#2 (b), worker-sess's finding: its wording is done here
- `worker.parts.partlyMaybe` said "so the rest wait" (es "el resto espera", ja 「残りは待機しています」). That isn't what happens:
  - `letGo`, called through `unsplit`, frees the held parts and stops the record as "refused" (parts.ts:236, :277), and nothing sends them.
  - The code's own doc says "those that would have waited never go" (parts.ts:570), and flows.md:369 already says the rest don't go.
- I was rewriting that value for x-i18n-ja#0, #1 and es#4, so I made it say so in all three languages: "so the rest didn't go", "así que el resto no se envió", 「残りは送られませんでした」. These are the funding sibling's words.
- parts-send-review-fixes.test.ts pins it.
- Part (a) is untouched and still worker-sess's.

## Files touched
- `extension/src/i18n/translations/en.json`, `es.json`, `ja.json` (small anchored edits).
- `docs/i18n/glossary.md`.
- `extension/tests/i18n-review-fixes.test.ts` (new).
- `extension/tests/settings.test.ts`, `sessions-review-fixes.test.ts`, `parts-send-review-fixes.test.ts`.
- `docs/i18n/{es,ja}-provenance.json`: not touched. Every es and ja value I changed was already `machine`.

## Keys
- **Critical keys changed:**
  - `lovejoin.launch.warn.atMost`, ja only. One word changed: クレデンシャル to 資格情報.
  - Its provenance was already `machine`, and it's still listed in verified-critical-ja.json, so i18n.test.ts stays green. But that verification is of the old value: back-translate it blind with this round's batch.
- **Not critical by the rule, but worth adding to the blind batch:** `settings.lovejoin.collateralOn` (en, es, ja).
  - It's a plain note, and its Off sibling is the `.privacy.` one.
  - It says when the collateral is mixed and what that costs.
- **Other keys changed.** No keys were added.
  - en: `settings.lovejoin.collateralOn`, `worker.parts.partlyMaybe`, `worker.parts.fundingPartlyMaybe`.
  - es: `settings.lovejoin.collateralOn`, `worker.parts.partlyMaybe`, `worker.parts.fundingPartlyMaybe`, `lovejoin.pools.starting`, `lovejoin.pools.flag.held`, `lovejoin.mixes.againOf`, `lovejoin.tag.held`, `lovejoin.ways.fundedInto`, `lovejoin.launch.needBox`, `lovejoin.launch.needQuantity`, `lovejoin.bootstrap.atMost`.
  - ja: `settings.lovejoin.collateralOn`, `worker.parts.partlyMaybe`, `worker.parts.fundingPartlyMaybe`, `lovejoin.pools.starting`, `lovejoin.ways.fundedInto`, `worker.parts.tooMany`, and `lovejoin.launch.warn.atMost` (above).

## Docs to update
- None.
  - flows.md:369 already says partlyMaybe's rest don't go.
  - flows.md uses "Koios" to mean the server, by its own convention (:23).
  - The glossary is done here.

## Calls the owner might overturn
1. x-i18n-ja#4's direction. The critical key took Lace's 資格情報, rather than the non-critical key taking クレデンシャル.
2. The glossary:
   - change is recorded as 釣り銭 (the majority), with おつり left in two values;
   - a "the server" row was added to the owner's table, recording the call of 2026-10-09.
3. Spanish wordings chosen: "Retenidas por un arranque: {{n}}" (a heading and its count), "Nueva mezcla de {{what}}", "con cargo a esta financiación" and "Poniéndose en marcha".
4. x-scenarios-sessions#2 (b)'s words, a worker-sess finding, done in the same edit.

## Notes for other fixers and the lead
- **wss-1, wss-2:** x-scenarios-sessions#2 (b) is done (above). If you change the behaviour so the rest do wait, the three values and parts-send-review-fixes.test.ts's assertion (in "says a part Koios never answered at Send…") must change back.
- **The screens round:** `lovejoin.mixes.held` and `.released` are plural in en and es for a Bootstrap of one box: "held until you bring them back", "retenidas hasta que las traigas de vuelta", "volviendo solas". Pass `count` at Lovejoin.tsx:2053 and add the plural forms: `_one` in en, `_one` and `_many` in es.
- **The lead:** `lovejoin.launch.warn.atMost`'s verified entry is stale (Keys).
- **i18n-new:** every value above is a machine draft for your read.
- **WebAssembly:** no rebuild needed. Nothing here touches Rust or the pkg.

## Checks
- The four files I touched or added (i18n-review-fixes, settings, sessions-review-fixes, parts-send-review-fixes):
  - before the fixes, 6 failed, each on the old words, and 78 passed;
  - after, 84 passed;
  - the mutation checks are above.
- 15 files, 302 tests passed: i18n, i18n-assembly, i18n-critical-helpers, i18n-joins, i18n-screens, i18n-values-in-place, i18n-worker-reasons, i18n-review-fixes, words, worker-words, swap-page-words, date-locale, lovejoin-hub, lovejoin-merged-screens and settings.
- With `VITE_ENABLE_MAINNET=false`, 8 files, 182 tests passed: i18n, i18n-review-fixes, settings, sessions-review-fixes, parts-send-review-fixes, lovejoin-hub, lovejoin-merged-screens and i18n-assembly.
- shown-text.test.ts: 2 passed.
- `npm run typecheck`: clean (its tsconfig includes `tests/`).
- `node scripts/i18n-critical.mjs`, print only: the set is the same before and after.
- All three locale files parse.
