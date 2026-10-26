# 1.6.0's review: the Spanish and Japanese of every key it added or changed

The i18n-new pass (phase F). Its input is [i18n-changed.json](i18n-changed.json): 92 entries, 76 keys, 8 of them plural, 23 entries critical. Each es and ja value was read against its English and the code that shows it.

## Changed

32 values, all `machine` before and after. 30 are the space before ₳ alone; 2 are Spanish wordings.

- **lovejoin.pools.warn.startedCopy** (es)
  - Before: Puede que su inicio no se haya completado, o que se completara antes otro inicio con los mismos valores: entonces el tuyo es una copia, nunca se muestra, y lo que bloqueó se pierde para siempre.
  - After: Puede que su inicio no se haya completado, o que se completara antes otro inicio con los mismos valores: en este último caso, el tuyo es una copia, nunca se muestra, y lo que bloqueó se pierde para siempre.
  - Why: "entonces" could read as following either alternative, though only an earlier start of the same values makes yours a copy whose lock is gone (a start that didn't go through locked nothing). Now "en este último caso", as ja's 後者の場合 already says it.
- **sites.topUp.collateralMixed** (es)
  - Before: A la cuenta no le queda colateral, así que esto repone 5 ₳ para los contratos del sitio y las mezclas de Lovejoin. En la siguiente devolución se mezclan una vez, en una caja propia, solo si queda lo suficiente, y luego vuelven solos; si no, vuelven con esa devolución.
  - After: A la cuenta no le queda colateral, así que esto repone 5 ₳ para los contratos del sitio y las mezclas de Lovejoin. En la siguiente devolución se mezclan una vez, en una caja propia, solo si queda lo suficiente, y luego vuelven por sí solos; si no, vuelven con esa devolución.
  - Why: "vuelven solos", right after "solo si", reads as "come back alone", the reading 1.6.0's blind passes corrected elsewhere ("vuelve sola" to "por sí sola"). Now "vuelven por sí solos", as lovejoin.mixes.released says "por sí sola(s)".
- **The space before ₳**, 30 values: The house's no-break space before ₳ (usability review V-7): the value had a plain space before each ₳, as its English still does. Only that character changed.
  - es: `collateral.warn.bothLand`, `lj.tail.fewBoxes`, `lj.tail.noPool`, `lj.tail.waiting`, `lovejoin.collateralMix.privacy.ifLeft`, `lovejoin.launch.warn.atMost`, `lovejoin.mix.cantAffordPublic`, `lovejoin.mix.cantAffordPublicHolds`, `lovejoin.mix.privacy.collateralIfLeft`, `settings.lovejoin.bringWait.collateral`, `settings.lovejoin.collateralOn`, `swaps.stop.cancelledMixed`, `swaps.stop.notPlacedMixed`, `swaps.stop.notSwappedMixed`, `swaps.stop.privacy.collateralMix`.
  - ja: `collateral.warn.bothLand`, `lj.tail.fewBoxes`, `lj.tail.noPool`, `lj.tail.waiting`, `lovejoin.collateralMix.privacy.ifLeft`, `lovejoin.launch.warn.atMost`, `lovejoin.mix.cantAffordPublic`, `lovejoin.mix.cantAffordPublicHolds`, `lovejoin.mix.privacy.collateralIfLeft`, `settings.lovejoin.bringWait.collateral`, `settings.lovejoin.collateralOn`, `swaps.stop.cancelledMixed`, `swaps.stop.notPlacedMixed`, `swaps.stop.notSwappedMixed`, `swaps.stop.privacy.collateralMix`.

## Critical keys, their final values

An entry with no such form says so: English shows `_other` where Spanish shows `_many`, and Japanese shows `_other` for every count.

- **collateral.warn.bothLand**
  - en: If both land, the first 5 ₳ goes back into your balance.
  - es: Si llegan los dos, los primeros 5 ₳ vuelven a tu saldo.
  - ja: 両方が届いた場合、最初の 5 ₳ は残高に戻ります。
- **dappUi.back.privacy.noteLovejoinMixed**
  - en: From the dApps page. Lovejoin mixes the spare ADA in 10 ₳ boxes, and the 5 ₳ once, in a box of its own, only if enough is left, so they're harder to tie to this session; they come back hours later. The rest comes back at once. Settings → Lovejoin turns that off.
  - es: Desde la página de dApps. Lovejoin mezcla el ADA sobrante en cajas de 10 ₳, y los 5 ₳ una vez, en una caja propia, solo si queda lo suficiente, para que sean más difíciles de vincular con esta sesión; vuelven horas más tarde. El resto vuelve de una vez. Se desactiva en Configuración → Lovejoin.
  - ja: dApps ページから行います。余った ADA は 10 ₳ のボックスで、5 ₳ は十分残っている場合にだけ専用のボックスで 1 回、Lovejoin でミックスされるため、このセッションと結び付けにくくなり、数時間後に戻ります。残りはまとめてすぐに戻ります。「設定」の Lovejoin でオフにできます。
- **lj.bring.warn.privatePayNone**
  - en: Your private balance has no UTxO of ADA alone that can pay for this box's way back. Make some ADA private, or bring it back from its pool's page, paid from your public account.
  - es: Tu saldo privado no tiene ningún UTxO solo de ADA que pueda pagar el regreso de esta caja. Haz privado algo de ADA, o tráela de vuelta desde la página de su pool, pagando con tu cuenta pública.
  - ja: プライベート残高に、このボックスが戻る費用を払える ADA だけの UTxO がありません。ADA をプライベートにするか、そのプールのページから公開アカウントで支払って戻してください。
- **lock.warn.partsWaiting**
  - en: A payment is being sent in parts: locking now stops it partway.
  - es: Se está enviando un pago por partes: si la billetera se bloquea ahora, el pago se detiene a medias.
  - ja: 支払いを分けて送信中です。今ロックされると、支払いは途中で止まります。
- **lovejoin.anyway.privacy.hidesNamed**
  - en: On {{account}}, Mix again from my public account hides it first.
  - es: En {{account}}, Mezclar otra vez desde mi cuenta pública la oculta primero.
  - ja: {{account}} で「公開アカウントから再ミックス」を使えば、先に隠せます。
- **lovejoin.anyway.privacy.publicDepositNamed**
  - en: The server says {{account}} deposited it. Brought back now, anyone can tie that account to your private balance.
  - es: El servidor dice que {{account}} la depositó. Si la traes de vuelta ahora, cualquiera puede vincular esa cuenta con tu saldo privado.
  - ja: サーバーによると、これは {{account}} がデポジットしたものです。今戻すと、そのアカウントとプライベート残高を誰でも結び付けられます。
- **lovejoin.anyway.privacy.publicStoppedNamed**
  - en: Its mix from {{account}} stopped before mixing it. Brought back now, anyone can tie that account to your private balance.
  - es: Su mezcla desde {{account}} se detuvo antes de mezclarla. Si la traes de vuelta ahora, cualquiera puede vincular esa cuenta con tu saldo privado.
  - ja: {{account}} からのミックスが、それをミックスする前に止まりました。今戻すと、そのアカウントとプライベート残高を誰でも結び付けられます。
- **lovejoin.bootstrap.privacy.accountNamed_many**
  - en: (no such form)
  - es: Esos arranques los pagaron {{account}}, así que una caja así también vincula esas cuentas con tu saldo privado.
  - ja: (no such form)
- **lovejoin.bootstrap.privacy.accountNamed_one**
  - en: {{account}} paid for that Bootstrap, so such a box ties that account to your private balance too.
  - es: Ese arranque lo pagó {{account}}, así que una caja así también vincula esa cuenta con tu saldo privado.
  - ja: (no such form)
- **lovejoin.bootstrap.privacy.accountNamed_other**
  - en: {{account}} paid for those Bootstraps, so such a box ties those accounts to your private balance too.
  - es: Esos arranques los pagaron {{account}}, así que una caja así también vincula esas cuentas con tu saldo privado.
  - ja: そのブートストラップは {{account}} が支払ったため、そうしたボックスは支払ったアカウントもプライベート残高と結び付けます。
- **lovejoin.collateralMix.privacy.ifLeft**
  - en: Its 5 ₳ collateral is mixed only if enough is left when it comes back. If it is, giveme.my backs that mix, so it sees it; if that mix can't go, its 5 ₳ box waits unmixed, tied to this session. [The English then lost its second "it", as reported below: "If it is, giveme.my backs that mix, and so sees it; …".]
  - es: Su colateral de 5 ₳ solo se mezcla si queda lo suficiente cuando vuelve. Si se mezcla, giveme.my respalda esa mezcla, así que giveme.my la ve; si esa mezcla no puede hacerse, su caja de 5 ₳ espera sin mezclar, vinculada con esta sesión.
  - ja: 5 ₳ のコラテラルは、戻るときに十分残っている場合にだけミックスされます。ミックスされる場合は giveme.my がそのミックスを支えるため、giveme.my はそのミックスを見ます。そのミックスができない場合、5 ₳ のボックスはミックスされないまま、このセッションと結び付いた状態で待ちます。
- **lovejoin.launch.warn.atMost**
  - en: That's the most that's locked: if the pool's credential is registered already when the start is sent, its {{deposit}} ₳ deposit isn't needed.
  - es: Es lo máximo que queda bloqueado: si la credencial del pool ya está registrada cuando se envíe la transacción que inicia el pool, no hará falta pagar el depósito de {{deposit}} ₳.
  - ja: これは永久にロックされる額の最大です。開始トランザクションを送信する時点でプールの資格情報がすでに登録されている場合、{{deposit}} ₳ のステークデポジットを支払う必要はありません。
- **lovejoin.launch.warn.startedBefore**
  - en: You started a pool of these values earlier, and no look has found it yet. If both starts go through, the later one is a copy: never shown, and what it locks is gone for good.
  - es: Ya iniciaste antes un pool con estos valores, y ninguna búsqueda lo ha encontrado todavía. Si ambos inicios se completan, el posterior es una copia: nunca se muestra, y lo que bloquea se pierde para siempre.
  - ja: 同じ値のプールを先に開始していますが、まだ検索で見つかっていません。両方の開始が完了すると、後のほうは複製になります。表示されることはなく、ロックされた額は永久に戻りません。
- **lovejoin.mix.privacy.collateralIfLeft**
  - en: At this many, its 5 ₳ collateral is mixed only if enough is left when it comes back.
  - es: Con tantas cajas, su colateral de 5 ₳ solo se mezcla si queda lo suficiente cuando vuelve.
  - ja: この数では、5 ₳ のコラテラルは、戻るときに十分残っている場合にだけミックスされます。
- **lovejoin.pools.warn.startedCopy**
  - en: Its start may not have gone through, or an earlier start of the same values did: then yours is a copy, never shown, and what it locked is gone for good. [The English then said which case makes a copy, as reported below: "Its start may not have gone through, or an earlier start of the same values did. If an earlier one did, yours is a copy, never shown, and what it locked is gone for good."]
  - es: Puede que su inicio no se haya completado, o que se completara antes otro inicio con los mismos valores: en este último caso, el tuyo es una copia, nunca se muestra, y lo que bloqueó se pierde para siempre.
  - ja: 開始が完了しなかったか、同じ値の先の開始が完了した可能性があります。後者の場合、あなたのプールは複製で、表示されることはなく、ロックされた額は永久に戻りません。
- **lovejoin.stuck.privacy.privateNamed**
  - en: Paid from your private balance, one of its UTxOs of ADA alone goes into the box's own transaction, and its ADA comes back with the box, less the fee, so anyone can tie that UTxO, and where it came from, to the box. Where it can, the wallet takes one that came back from Lovejoin, else one that ties no other account.
  - es: Si pagas con tu saldo privado, uno de sus UTxO solo de ADA entra en la propia transacción de la caja, y su ADA vuelve con la caja, menos la comisión, así que cualquiera puede vincular ese UTxO, y de dónde vino, con la caja. Siempre que puede, la billetera usa uno que haya vuelto de Lovejoin; si no, uno que no vincule ninguna otra cuenta.
  - ja: プライベート残高で支払う場合、残高のうち ADA だけの UTxO の 1 つがボックス自体のトランザクションに入り、その ADA は手数料を引いてボックスと一緒に戻ります。そのため誰でも、その UTxO とその出どころを、そのボックスに結び付けることができます。可能な場合、ウォレットは Lovejoin から戻った UTxO を使い、なければほかのアカウントを結び付けない UTxO を使います。
- **lovejoin.stuck.privacy.publicNamed**
  - en: Paid from {{active}}, one of its UTxOs goes into the box's own transaction, so anyone can tie {{active}} to the box, to {{account}}, whose box it is, and to the private UTxO it comes back into.
  - es: Si pagas desde {{active}}, uno de sus UTxO entra en la propia transacción de la caja, así que cualquiera puede vincular {{active}} con la caja, con {{account}}, a la que pertenece, y con el UTxO privado al que vuelve.
  - ja: {{active}} で支払う場合、その UTxO の 1 つがボックス自体のトランザクションに入るため、誰でも {{active}} を、そのボックスと、その持ち主の {{account}} と、ボックスの戻り先のプライベート UTxO に結び付けることができます。
- **settings.remove.warn.partsWaiting_many**
  - en: (no such form)
  - es: {{network}}: {{count}} pagos todavía se están enviando por partes. Eliminar la billetera los detiene a medias: lo que falta por enviar sigue en tu saldo privado.
  - ja: (no such form)
- **settings.remove.warn.partsWaiting_one**
  - en: {{network}}: a payment is still being sent in parts. Removing the wallet stops it partway: what's still to go stays in your private balance.
  - es: {{network}}: un pago todavía se está enviando por partes. Eliminar la billetera lo detiene a medias: lo que falta por enviar sigue en tu saldo privado.
  - ja: (no such form)
- **settings.remove.warn.partsWaiting_other**
  - en: {{network}}: {{count}} payments are still being sent in parts. Removing the wallet stops them partway: what's still to go stays in your private balance.
  - es: {{network}}: {{count}} pagos todavía se están enviando por partes. Eliminar la billetera los detiene a medias: lo que falta por enviar sigue en tu saldo privado.
  - ja: {{network}}: 分けて送信中の支払いが {{count}} 件あります。ウォレットを削除すると途中で止まり、まだ送られていない分はプライベート残高に残ります。
- **swaps.retry.privacy.cbor**
  - en: Whoever you send it to can tie this swap's one-time account, and the private UTxOs that funded it, to you.
  - es: Quien la reciba de ti puede vincular contigo la cuenta de un solo uso de este intercambio y los UTxOs privados que la financiaron.
  - ja: これを送った相手は、このスワップの使い捨てアカウントと、その資金となったプライベート UTxO を、あなたと結び付けられます。
- **swaps.review.privacy.collateralMix**
  - en: giveme.my backs its collateral's mix too, so it sees that mix. If that mix can't go, its 5 ₳ box waits unmixed, tied to this session.
  - es: giveme.my también respalda la mezcla de su colateral, así que giveme.my ve esa mezcla. Si esa mezcla no puede hacerse, su caja de 5 ₳ espera sin mezclar, vinculada con esta sesión.
  - ja: コラテラルのミックスも giveme.my が支えるため、giveme.my はそのミックスを見ます。そのミックスができない場合、5 ₳ のボックスはミックスされないまま、このセッションと結び付いた状態で待ちます。
- **swaps.stop.privacy.collateralMix**
  - en: giveme.my backs its collateral's mix, so it sees that mix. If that mix can't go, its 5 ₳ box waits unmixed, tied to this session.
  - es: giveme.my respalda la mezcla de su colateral, así que giveme.my ve esa mezcla. Si esa mezcla no puede hacerse, su caja de 5 ₳ espera sin mezclar, vinculada con esta sesión.
  - ja: コラテラルのミックスは giveme.my が支えるため、giveme.my はそのミックスを見ます。そのミックスができない場合、5 ₳ のボックスはミックスされないまま、このセッションと結び付いた状態で待ちます。

## English issues

- No-break space before ₳ (the house's rule, usability review V-7) missing in 15 English values, each with a plain U+0020: collateral.warn.bothLand, lj.tail.fewBoxes, lj.tail.noPool, lj.tail.waiting, lovejoin.collateralMix.privacy.ifLeft (both), lovejoin.launch.warn.atMost, lovejoin.mix.cantAffordPublic (both), lovejoin.mix.cantAffordPublicHolds (both), lovejoin.mix.privacy.collateralIfLeft, settings.lovejoin.bringWait.collateral, settings.lovejoin.collateralOn, swaps.stop.cancelledMixed (both), swaps.stop.notPlacedMixed (both), swaps.stop.notSwappedMixed (both), swaps.stop.privacy.collateralMix. Their es and ja now have it; lovejoin.mix.cantAfford, their sibling, shows the form.
- lovejoin.pools.warn.startedCopy (critical): "then yours is a copy" can be read as following both alternatives, though only an earlier start of the same values makes a copy and loses what it locked; a start that didn't go through locked nothing. ja says 後者の場合 and es now "en este último caso". The English could say "if the latter, yours is a copy".
- lovejoin.collateralMix.privacy.ifLeft (critical): "giveme.my backs that mix, so it sees it" stacks two "it"s (giveme.my, then the mix). Its siblings swaps.review.privacy.collateralMix and swaps.stop.privacy.collateralMix say "so it sees that mix"; es and ja name giveme.my.

## Checks

- Read: all 92 entries (76 keys, 8 of them plural; 23 entries critical, from 19 keys) in en, es and ja, against the code that shows each: what each "it" and "its" names, which account each Named variant means ({{account}} against {{active}}, the public account against the private balance), and what fills each placeholder ({{why}} from sess.skip.warn.pool*, {{boxes}} from amount.boxes with count 2 while balances are hidden, {{what}} in the pending banner's frames, {{account}} lists joined by histories.list.and).
- Meaning: no dropped clause, inverted negation, or lost only, if or instead in any of the 168 values (92 es, 76 ja).
- Glossary: a script found none of its strays in them (fondear, Ajustes, Introduce, coste, Escribe, a bare En marcha, usted forms; クレデンシャル, ボックス額, 入金 for a session's funding, 受取人, 既に, キー, あなたの before 公開アカウント or プライベート残高, Koios for the server, “ ” quotes), and Max is Máx and 「最大」.
- Register: tú throughout es; です/ます in ja sentences, plain labels and banner titles as their siblings have.
- Plurals: each of the 8 plural keys has es _one, _many and _other and ja _other alone; es gender and number agree with the boxes or payments counted. Placeholders: identical sets in every value.
- ₳: 15 keys had a plain space before ₳ in all three languages. es and ja fixed (30 values); the English reported.
- Short: nothing runs past its English's shape. The longest es ratios mirror an established sibling (lock.warn.partsWaiting, as lock.warn.chainSending) or avoid an agreement no count reaches (lovejoin.ways.fundedInto).
- Changed: 32 values. 30 are the space before ₳, put in by a line-anchored exact-substring script (each key's line asserted to occur once, its count of plain spaces asserted, every other key asserted unchanged, then parsed; no JSON round trip). 2 are es wordings, by Edit: lovejoin.pools.warn.startedCopy and sites.topUp.collateralMixed.
- Provenance: all 17 keys touched were already machine in es and ja, so neither provenance file changed. lovejoin.launch.warn.atMost, the one listed key already in verified-critical-{es,ja}.json, changed only by that space; its ja entry was already stale from 資格情報 (fixes/i18n-existing.md), so it belongs in the blind batch.
- Left alone, with reasons: ja sites.topUp.collateralMixed's 5 ₳ を戻します (its next sentence fixes the direction, and sites.topUp.collateral says the same); ja lovejoin.mix.cantAffordPublicHolds' 公開アカウントは {{held}} ₳ です (1.5.0's words, read in the whole-locale review); es unos for about in a sentence, where the 2026-10-03 row says aproximadamente (about 36 sentence values use unos, 18 aproximadamente; not a 1.6.0 row).
- glossary.md's 1.6.0 table, checked by script against every value in the locales: two rows corrected to the values as now used (its start: es has el inicio as often as la puesta en marcha, and el inicio wherever starts are counted; ボックス額 stands once, for an ADA pool's box value, which is an amount of ADA), and four added (in a box of its own: en una caja propia, 専用のボックスで; giveme.my backs: respaldar, 支える, where 1.5.0's collateral backing its own mixes is 裏付ける; a look: una búsqueda, 検索; the no-break space before ₳).
- Tests: npx vitest on 29 files (the i18n suites, words, worker-words, screens-wiring-review-fixes, settings, sessions, approvals, collateral-reserve, lovejoin-form, lovejoin-launch, lovejoin-hub, the merged screens, swap-page-words, shown-text and the other screens that render es or ja): 610 tests, all passing but i18n.test.ts's two "no unchecked machine draft" cases, which failed the same way before any edit: the 22 es and 18 ja critical values awaiting this round's blind back-translation. All three locale files parse.
- In 'critical', an empty en or ja means that language has no such form: English shows _other where Spanish shows _many, and Japanese shows _other for every count.
