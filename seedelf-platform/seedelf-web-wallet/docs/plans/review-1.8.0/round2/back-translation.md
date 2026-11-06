# 1.8.0's release review: the blind back-translation

**What was back-translated:** every critical key whose es or ja value is new or changed since 1.7.2's release (`6b70c1f8`), computed from `critical-keys.json` and the three JSON files at the merged tree (`4b4628e9`), not listed by hand. Eight keys:
- `dappUi.private.privacy.staysLovejoin` (10 ₳ → 5 ₳);
- `dappUi.back.privacy.noteLovejoin` and `noteLovejoinMixed` (10 ₳ → 5 ₳; "the 5 ₳ kept aside", W5);
- `dappUi.back.privacy.noteLovejoinPoolShort` (new, O3);
- `lj.unusable.warn.retired` (new in #364; its last sentence dropped, W3 and W4);
- `sess.skip.warn.noAdaPool` (new in #364; reworded, O4);
- `lj.skip.warn.floorShort` (reworded, critic#0), every plural form: es `_one`, `_many` and `_other`; ja `_other`.

**How:** a fresh agent a language, with no tools and no English in view, each item exactly as the screen shows it: inside its frame (`lovejoin.warn.skippedThis`, `skippedIts`, `claim.warn.skippedItem`, `swaps.lovejoin.warn.pool`, `swaps.stop.poolShort`, `lj.leftOut`, the connect card's join with `swaps.lovejoin.privacy.onPoolShort`, the funding review under `dappUi.back.title`), its placeholders filled as the screens fill them ("Sesión privada 1", プライベートセッション 1, a count of 20 and of 1, a floor of 30, `{{box}}` 1.7). The items said where each is shown, never what it means. The lead compared each back-translation with the English for meaning. The inputs are `scratchpad/lead/bt-{en,es,ja}.txt`, and the answers are in workflow `wf_af158591-549`'s journal. Each translator's transcript holds one tool call, its answer: neither opened a file, so neither saw the English.

## The verdict

**Nothing drifted, in either language.** Every clause of every item held: who does what, the conditions and their scope, every negation, and the tenses as the English has them.

What the translators flagged, and what came of it:

| Note | Language | Outcome |
|---|---|---|
| floorShort opens with a capital ("…devolución: El pool…") inside colon frames, where noAdaPool opens lower-case and Spanish wants lower case after a colon; and "tenía … que no son tuyas cuando … leyó" lets the *cuando* clause attach to *son* | es | **Fixed:** "el pool de Lovejoin tenía {{count}} cajas que no eran tuyas cuando la billetera lo leyó, …" (`_one`: "caja que no era tuya"). A blind round for the new value follows. |
| "no conocía", 把握していませんでした: a past tense on a screen shown before anything is sent | es, ja | As the English says it, on purpose: the reason says what the wallet knew when it read, which stays true once a pool exists (O4). |
| "si el pool de Lovejoin tiene sitio…", 空きがあれば: the scope of "if its pool has room" can be read as covering the money's return, not only the mixing | es, ja | The English has the same scope; the next sentence ("What isn't mixed comes back at once") settles it in all three. |
| "sitio" is also a website, on the screen where a site connects | es | "tener sitio" is the house's word for a pool's room in every Lovejoin string (`lovejoin.mix.capPool`, `capFour`, `review.asManyAsOneGo`); kept for consistency. |
| "retirados" can read as withdrawn, in a wallet | es | The glossary's choice (W11: "los scripts retirados de Lovejoin", bound to the scripts). The back-translation itself read "retired". |
| "Lovejoin se dejó fuera:" / 除外されました on Lovejoin's own page: left out of what? | es, ja | The verified frame `lj.leftOut`, unchanged; the English says the same. |
| 廃止済み, "ni vuelve a mezclar ninguna": what of the boxes already there? | es, ja | The English says no more since W3 and W4 dropped "Your boxes in it come back by themselves", false for a stuck token pool. The page beside it keeps Bring one back now and Bring every box back. |
| the capital "Este" after "Lovejoin se dejó fuera:" | es | The retired reason is a whole sentence shown alone too (under Mix's button); one value can't open both ways. A nit, as it was. |
| "devolución" also means a refund; 返却 a return of something borrowed | es, ja | The house's word for a session's return in every verified string. |
| 件 as a counter for boxes; ミックス for mixing | ja | The house's words throughout. |
| "vinculado a" (`skippedIts`) beside "vinculado con" (the swaps' frames) | es | Verified frames, older than 1.8.0; a nit. |
| numbers in en-US form (1.7, 1,000,000) | es | The owner's call (O8). The 1,000,000 was the lead's test of es `_many`, not a state the wallet reaches (the count is under the floor). |

## Round two's values

**What was back-translated:** what round two changed, and the store listing's changed bullet (D5), which the listing's own rule says is back-translated too:
- es `lj.skip.warn.floorShort`, every form (`_one`, `_many` and `_other` are now "el pool de Lovejoin tenía … que no eran tuyas …"): r2-screens#1 and the round-one translators' notes above;
- es `dappUi.back.privacy.noteLovejoinMixed` ("y mezcla una vez los 5 ₳ apartados", r2-screens#2); en is reordered the same way, and ja already kept "once" with the verb, so it's unchanged;
- the listing's sentence on which pools take new boxes, in es and ja.

**How:** as above: a fresh agent a language, no English in view, each item in its frame, its placeholders filled as the screens fill them (a count of 20 and of 1, a floor of 30, "Sesión privada 1"). The inputs are `scratchpad/lead/bt2-{es,ja}.txt`, the English to compare `bt2-en.txt`, and the answers are in workflow `wf_8cc4fbd4-5d7`'s journal. Each translator's transcript holds one tool call, its answer.

**The verdict: no drift.** Every clause of every item held: floorShort in all four frames (the colon frames now open lower-case, and "cuando … leyó" now ties to *tenía*), noteLovejoinMixed with "once" on the mix, and the listing's ja sentences.

| Note | Language | Outcome |
|---|---|---|
| The listing's es "el primer pool que se inició para cada valor de caja con los contratos actuales de Lovejoin" can be read as the first pool ever started for each value; "sus contratos anteriores" as the pools' own earlier contracts, or the formal "your" | es | **Fixed** in docs/store/README.md: "el primer pool que se inició con los contratos actuales de Lovejoin para cada valor de caja; los pools con los contratos anteriores de Lovejoin no reciben ninguna", back-translated blind again (below) |
| "solo si queda lo suficiente" could limit the box or both mixes; "sean", "vuelven" cover both or the 5 ₳ | es | The English has the same scope ("…only if enough is left, so they're harder to tie…; they come back hours later"). Kept |
| "su devolución" (Lovejoin's, the session's, or the formal "your") and "se dejó … vuelve" (past and present) | es | `lovejoin.warn.skippedIts`, a verified frame older than 1.8.0, whose English has the same tenses ("was left out of its return … So it comes back"). Kept, as round one kept it |
| "devolución" as a refund; the passive "se deja fuera"; "a partir de 30" leaving "boxes not yours" implied; "Lovejoin se dejó fuera" on Lovejoin's own page | es | Round one's notes again, on the verified frames; the English says the same. Kept |
| "中身（…）が同じもの" doesn't say the same as what, and 中身 could be a pool's total; 開始 a little unusual for a pool; a long nested sentence | ja | The listing's older text, verified before 1.8.0; the parenthesis names a box's token, its amount and its ADA, and 開始 is the UI's own word for Start a pool. Kept |

**The listing's es sentence, back-translated blind again, twice** (a fresh agent each time, one item, no English):
1. "…el primer pool que se inició con los contratos actuales de Lovejoin para cada valor de caja; los pools con los contratos anteriores de Lovejoin…": every clause held. Its one note: "para cada valor de caja" at the end could attach three ways. Taken: the translator's own wording puts it first.
2. "…y, para cada valor de caja, pone cajas nuevas solo en el primer pool que se inició con los contratos actuales de Lovejoin; los pools con los contratos anteriores de Lovejoin no reciben ninguna.": read back as "…and, for each box value, it puts new boxes only in the first pool that was started with Lovejoin's current contracts; the pools with Lovejoin's previous contracts receive none." Every clause held. Its notes ("valor de caja" could briefly read as a cash value; "el primer pool" not tied to the value in so many words; "no reciben ninguna" from anyone) hold of the English too, or of the listing's older terms (*valor de caja*, *billetera*), and stay. This is the sentence the upload pastes.
