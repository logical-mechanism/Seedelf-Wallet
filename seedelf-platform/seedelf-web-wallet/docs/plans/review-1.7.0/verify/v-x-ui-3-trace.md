# v-x-ui-3-trace: x-ui#3, a plain space before ₳ in the new critical line

**Verdict: confirmed. Severity: nit** (the finding's own). I couldn't refute it. One side claim is off: the count of older keys is 54, not about 48. English splits only under page zoom.

## What HEAD has (6bca8bec)

- **The new key has U+0020 before ₳ in all three bundles.**
  - `en.json:922`: "…and its 5 ₳ box stays in the pool unmixed…"
  - `es.json:969`: "…su caja de 5 ₳ se queda…"
  - `ja.json:875`: "…取り戻すと、5 ₳ のボックス…"
- **The siblings have U+00A0** in en, es and ja: `lj.tail.waiting`, `lj.tail.fewBoxes`, `lj.tail.noPool` and `swaps.review.privacy.collateralMix`. The last one has the same phrase, "its 5 ₳ box".
- **It's new in the range.** The key is missing from babb8e76 and 473b7f1a, and present from 11e249d2 (#337). #337's diff adds all three values with U+0020.
- **It's critical:** `docs/i18n/critical-keys.json:144`.
- **The rule is real.**
  - `glossary.md:151`: "| an amount in ₳ | a no-break space (U+00A0) before ₳ | the same | the house's rule in every language (usability review V-7)…"
  - `usability-review.md:858`: "₳ wraps onto its own line in review totals ("1.153067 / ₳") and in "500 ₳": use a no-break space." Line 1108 marks V-7 Fixed: "A no-break space before every ₳, in the screens and the three languages."
  - Both verified files' reviewer note says 1.6.0's rounds "gave every changed value the no-break space before ₳". Their 1.7.0 entry for this key doesn't mention the space.
- **Nothing between the bundle and the screen changes the space.**
  - `LovejoinReturn.tsx:551` renders `<Callout tone="privacy">{tr("lj.tail.privacy.wayOut")}</Callout>`.
  - `t()` (`i18n/core.ts`) returns i18next's text unchanged.
  - `.callout__body` (`styles.css:863`) wraps normally.
  - It's shown on `SiteSessions.tsx:411`, `Swaps.tsx:2513` and `:2567`, and in a Lovejoin row (`Lovejoin.tsx:2588`, inside `.token-row__detail`).
- **Why it can wrap:** in UAX #14, ₳ (U+20B3) is class PR. A line may break after a space (LB18), so "5 ₳" can break before ₳. U+00A0 is class GL (LB12/12a), which forbids that break.
- **No test enforces the rule.** No test or script scans the bundles for it. `collateral-held.test.ts:27` matches the value through `t()`, so the space never mattered to it.

## Scratch test (deleted)

`extension/tests/zz-review-v-x-ui-3-trace-1.test.ts` switched the language to en, es and ja. For each, it rendered `CollateralHeldWayOut` and listed the character before every ₳. Control: the four siblings, through `t()`.

Result on HEAD: **3 failed, 3 passed.** The new line fails in en, es and ja ("expected [ 'U+0020' ] to deeply equal [ 'U+00A0' ]"). The siblings pass in all three.

## Layout probe (outside the tree)

Headless Chromium (Playwright 1.63, already installed), with every request blocked. The page used the wallet's real `styles.css` with Inter inlined, and a `.callout.callout--privacy` holding the value. It swept the callout's width from 120 to 1400 px in 1 px steps and recorded each width where "5" ends a line and ₳ starts the next.

| | HEAD (U+0020) | with U+00A0 |
|---|---|---|
| en | 165–175, 567–577 | none |
| es | 173–175, 266–278, 657–669 | none |
| ja | 120–123, 137–141, 154–155, 195–201, 249–253, 333–343, 611–623 | none |

**Which of these widths a user can reach:**
- `.app--panel` and `.app--tab` cap the page at 520 px, with 16 px of padding each side (`styles.css:528–546`). So the callout is at most 488 px on SiteSessions and Swaps.
- A Lovejoin row's detail is 44 px narrower: a 32 px avatar plus a 12 px gap (`styles.css:1688`, `1777`, `3777`).
- At 100% zoom, the panel is about the callout's width plus 32 px (SiteSessions, Swaps) or plus 76 px (a Lovejoin row), give or take a scrollbar.

**What that gives:**
- **Spanish** splits in a side panel about 298–310 px wide (SiteSessions, Swaps), or 342–354 px (a Lovejoin row).
- **Japanese** splits at about 365–375 px (SiteSessions, Swaps), or 325–329 and 409–419 px (a Lovejoin row). These widths depend on the machine's CJK font, since Inter is Latin only. en and es use the bundled Inter, so their widths hold on any machine.
- **English** can't split at 100% zoom. 567–577 is past the 488 px cap, and 165–175 needs a panel about 200 px wide, which takes roughly 160% page zoom or more.
- **A full tab** (a 488 px callout) splits in no language.

So the scenario holds: "at some width, or in es or ja". With U+00A0 the split never happens.

## Correction: the count

- At babb8e76, **54** distinct keys had a plain space before ₳ in at least one bundle (en 50, es 54, ja 43). 9 of them were critical.
- At HEAD it's 55 (en 51, es 55, ja 44), 10 of them critical. This key is the only one the range added.
- The critical ones at HEAD: `lj.tail.privacy.wayOut`, `lovejoin.launch.warn.cost`, `lovejoin.start.warn.cost`, `lovejoin.stuck.warn.lead`, `review.privacy.giveme`, `review.privacy.givemeFunding`, `sess.skip.warn.collateralComing`, `settings.lovejoin.privacy.collateralOff`, `settings.lovejoin.privacy.fourOff` and `settings.lovejoin.privacy.fourOn`.

## Fix advice

- **The fix is right as written.** Its "5 ₳" in x-ui's report really is U+00A0 (`5\xa0₳`). Change only that one character in `en.json:922`, `es.json:969` and `ja.json:875`.
- **Recording it:** add a line to the 1.7.0 entry of the reviewer note in `verified-critical-es.json` and `-ja.json`, as 1.6.0's rounds did for their 15. The words don't change, so it needs no new back-translation. If F1 rewords this key, write its new value with U+00A0, and F1's blind back-translation covers both.
- **No test breaks:** none pins the plain space, so `collateral-held.test.ts` keeps passing.
- **A test for the whole rule** is an option, and the owner's call. Over all three bundles it would also flag the 54 older keys, so those need fixing or listing first: a separate cleanup.

## Scratch files

Deleted from the tree: `extension/tests/zz-review-v-x-ui-3-trace-1.test.ts`. I also deleted the probe and the byte-count scripts from the scratchpad.
