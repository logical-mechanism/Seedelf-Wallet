# x-ui: the screens and the words across #325–#338

Cross-PR lens, label `x-ui`. Reviewed on HEAD `6bca8bec`. The PRs with screens or words are #333 (the Bootstrap form), #335 (the stepper in Transaction details) and #337 (*Bring the rest back now* and the new stop reason). #336 adds no UI text. #330–#332 and the docs and deps PRs touch no screen.

## Verdict

**The words are sound, and the gates hold.**

- **Six new keys:** `tx.partOf`, `tx.partPrevious`, `tx.partNext`, `lj.tail.skipped`, `lj.tail.wayOut` and `lj.tail.privacy.wayOut`. Each exists in en, es and ja with the same placeholders, and in the right order: ja's `全 {{total}} 件中 {{n}} 件目` follows the house's `lj.step.transaction`. The tone matches the strings around them (`lj.tail.refused`/`tooLong` use the same "so the chain stopped there" frame). The verbs match too: es *traer… de vuelta*, ja *取り戻す*, as `swaps.foot.bringBack` has them.
- **My own reading of the critical line's es and ja** (not blind) keeps every clause: still waiting, without it, unmixed, tied to this session, until mixed again.
- **The critical set:** I derived it read-only (`node scripts/i18n-critical.mjs`, no `--write`). It is 463 keys, equal to `critical-keys.json`. `verified-critical-{es,ja}.json` list exactly those 463 each, `lj.tail.privacy.wayOut` among them. Every new key has its provenance in both languages.
- **No eager `t()`:** every added `t`/`tr` call is inside a function or component.
- **The name rule holds.**
- **Nothing was renamed.** No e2e, store-image or copy selector changed meaning. The only new testids are `*-parts`, `*-part`, `*-part-previous`, `*-part-next`, `collateral-held` and `collateral-held-skip`.
- **I ran 15 test files alone, 235 tests, and all pass:** `i18n`, `i18n-critical-helpers`, `i18n-worker-reasons`, `i18n-screens`, `i18n-values-in-place`, `i18n-joins`, `i18n-assembly`, `i18n-review-fixes`, `words`, `worker-words`, `store-images-copy`, `live-runs-copy`, `chain-stopped-copy`, `collateral-held` and `tx-view-screen`.

**#335's stepper is right on all five reviews that can go in parts:** Send, Make public, a swap's funding, Lovejoin's private mix and a site's funding. Every other review is built `inParts: false` or is one transaction. I add nothing to pr335's findings.

**#333's Bootstrap form never states a figure.** Short, it says "…not enough for that many, with the fees and returning the rest on top". Its review shows the priced reserve (`lovejoin.review.returnRest` with `summary.bootstrapReserve`).

- Before the worker answers, and when the request fails, it counts 1.5 ₳ for the way back. After, it counts `back`, which is the same at today's parameters.
- I concur with pr333 #1 (the fixed `FEE_ROOM`) and #6 (optimistic until the answer). There is nothing new to add.

**#337 has two mismatches between the text and what happens, plus nits.** I proved each with a scratch test that ran the real worker and WebAssembly.

- **F1:** the critical line says the mix "is still waiting for giveme.my" where it's waiting for boxes, next to the page's own reason saying so.
- **F2:** on a session brought back by hand, *Bring the rest back now* brings nothing back. The stop reason then says "You brought the rest back", while the page says the rest stays at the account.

pr337 found F2, and F1 in passing, independently. My evidence below is separate.

## Findings

### F1. low · ux/i18n · #337: the way out's critical line blames giveme.my where the mix waits for the pool

**Where:**
- `extension/src/background/lovejoin.ts:4131`: `if (!tailWaits(c) && !tailBuildable(c, this.deps.now())) return undefined;`
- `extension/src/background/sessions.ts:4390`: `if (typeof resumed === "string") throw new Error(tailWaiting(resumed));`
- `extension/src/i18n/translations/en.json:922`: "The collateral's mix is still waiting for giveme.my. Bring the rest back without it, …"
- `en.json:915-916`: `lj.tail.fewBoxes` and `lj.tail.noPool`.
- `docs/flows.md:522`: "while the mix still waits (for giveme.my, or to be built again)".

**Scenario:**
1. A swap that runs itself, a mix, or a site's session has a return chain stopped at its collateral's mix: giveme.my refused past its wait (`lj.tail.refused`), or a lock cut the chain after the deposit landed.
2. The mix is now to be built again (`tailBuildable`), and the 5 ₳ pool's two free boxes have been drawn by other people's mixes, or the pool can't be read.

From an hour after the deposit landed, each page carries two reasons that contradict each other:

- **The swap's timeline (retry line):** "Lovejoin's pool of 5 ₳ boxes hasn't enough of other people's boxes free for its collateral's mix yet. The rest waits for that mix, a day at most." The privacy callout under it says "The collateral's mix is still waiting for giveme.my."
- **The mix's card:** "Why it stopped: giveme.my wouldn't back the collateral's mix…" and "It tries again at …: Lovejoin's pool of 5 ₳ boxes hasn't enough…". Both sit above the same callout.
- **A site's page:** *Bring it back* errors with the fewBoxes sentence, beside the callout.

**Evidence:** a scratch test (stoppedAtMix, the pool's other boxes spent, `landed` moved back an hour). The return's reason was "Lovejoin's pool of 5 ₳ boxes hasn't enough of other people's boxes free for its collateral's mix yet. The rest waits for that mix, a day at most." The view had `collateralHeld {"offerAt":1800000000000}`. The rendered component read "…The collateral's mix is still waiting for giveme.my. Bring the rest back without it, …". The chain's own reason was "giveme.my wouldn't back the collateral's mix, so the chain stopped there."

**Fix (owner's wording):** say it for both states, for example "The collateral's mix hasn't gone yet. Without it, its 5 ₳ box stays in the pool unmixed, tied to this session, until you mix it again." That is shorter too (rule 4). It's a critical key, so:
- back-translate es and ja blind;
- note the round in `verified-critical-{es,ja}.json`.

**Test:** the scratch's case, asserting the rendered line doesn't name giveme.my while the reason is `lj.tail.fewBoxes`. It fails today.

**Confidence:** high.

### F2. low · ux/docs · #337: by hand, *Bring the rest back now* brings nothing back, and its stop reason says it did

**Where:**
- `sessions.ts:5537`: `return this.advance(network, index, true);`
- `sessions.ts:3446`: `if (!s || !running(s)) return;`
- `sessions.ts:1230-1232`: `running` needs `s.auto`.
- `SiteSessions.tsx:416-417`: `await call("session-skip-collateral-mix", …); onRefresh();`
- `en.json:920-921`.
- `flows.md:522`: "…and the rest comes back directly".
- The PR's own test builds the return by hand after the skip (`tests/lovejoin-planner.test.ts:1825`).

**Scenario:**
1. A site's session (or a swap brought back by hand) has a chain waiting at the collateral's mix, past the hour.
2. The user presses **Bring the rest back now**.
3. The chain stops, and nothing is sent.
4. The site's page then reads "Through Lovejoin: Stopped after 3 of 5 transactions; the rest stays at the account until you bring it back". The user must press *Bring it back*, then Send on its review.
5. Meanwhile the Lovejoin page's Chains row says "Why it stopped: You brought the rest back without waiting for the collateral's mix, so the chain stopped there. Mix my boxes again mixes the boxes it didn't." That stays true only if the user later brings the rest back.

**Evidence:** a scratch test on a site's session, as the PR's test sets it up. After the skip and an alarm run:
- stage `open`;
- transactions `["out","deposit","mix","deposit"]`, with no return;
- `chain.stopped` = `lj.tail.skipped`;
- `chainText(chain, true)` = "…the rest stays at the account until you bring it back".

**Fix:**
- On the by-hand pages (`SiteSessions.tsx` onSkip, `Swaps.tsx`'s by-hand branch), open the return's review after the skip (`buildBack(true)`). The button then does what it says, as *Bring it back* does.
- Reword `lj.tail.skipped` so it doesn't claim the return, for example "You chose not to wait for the collateral's mix, so the chain stopped there." That key is a machine draft, not critical.
- Say in flows.md that a session brought back by hand opens its review.

**Test:** on a site's session, after `session-skip-collateral-mix`, the page shows the return's review; or the reason doesn't assert a return that wasn't sent.

**Confidence:** high.

### F3. nit · ux · #337: in the mix's card the button is 12 px, and its wrapper row renders before the offer

**Where:**
- `Lovejoin.tsx:2586-2590` (`<div className="token-row__detail"><CollateralHeldWayOut …/></div>`);
- `styles.css:3777-3786` (`.token-row__detail { font-size: 12px; color: var(--warn); … }`);
- `styles.css:136-137` (`button { font: inherit; }`).

**Scenario:** in the card, the 48 px pill's label inherits 12 px. On the swap and site pages it is 14 px. During the hour before the offer, the wrapper renders an empty grid row with a 4 px margin, because the component inside returns null (pr337 #6 saw this too).

**Evidence:** I rendered the component's static markup with `src/ui/styles.css` in Chromium (Playwright), 400 px wide, dark scheme. The computed `font-size` of `collateral-held-skip` was 14 px on a page and 12 px in the card. The screenshot is at `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/x-ui-visual/card.png`.

**Fix:** move the condition's `offerAt` check up to the card, and render the way out in a plain grid cell (`grid-column: 2 / -1`), not under `.token-row__detail`. Or give the button its own `font-size`.

**Confidence:** high.

### F4. nit · i18n · #337: the critical line has a plain space before ₳ in all three languages

**Where:**
- `en.json:922` and es/ja `lj.tail.privacy.wayOut`: "5 ₳" with U+0020;
- `docs/i18n/glossary.md:151`: "an amount in ₳ | a no-break space (U+00A0) before ₳ | … the house's rule in every language".

Its siblings `lj.tail.waiting`, `lj.tail.fewBoxes` and `swaps.review.privacy.collateralMix` use U+00A0. About 48 older keys slip the same way; this one is new in the range.

**Scenario:** at some width, or in es or ja, the line wraps between "5" and "₳".

**Fix:** use `5 ₳` in all three values. The meaning doesn't change, so record it in the verified files' reviewer note rather than redo the back-translation. Better still, fold it into F1's rewording.

**Confidence:** high.

### F5. nit · ux · #337: on pages that don't poll, the way out appears at its hour only after a refresh

**Where:** `LovejoinReturn.tsx:540` (`now = Date.now()`) and `:548` (`if (!held || now < held.offerAt) return null;`).

**Scenario:**
- The site's page and a by-hand swap's page have no timer. A user who opens either before the hour sees no way out until they press Refresh.
- The view already carries `collateralHeld` from when the deposit landed. Nothing on the page says a way out is coming.
- A swap that runs itself re-reads every 20 s, and the Lovejoin page every 2 s, so neither has this problem.

pr337 #6 found this too.

**Fix:** a one-shot `setTimeout` in `CollateralHeldWayOut` that re-renders at `offerAt`.

**Confidence:** high.

### F6. nit · docs · #337: privacy.md doesn't record the user's new way out

**Where:** `docs/privacy.md:217`. It still has the box wait unmixed only "past that, or a day after the deposit landed". #337 changed flows.md and architecture.md but not the design doc for the same ground (rule 3). pr337 #5 found this too.

**Scenario:** someone reading privacy.md for what can leave a collateral's box unmixed and tied to its session misses the user's own choice from the hour.

**Fix:** one clause: "…or sooner, an hour after the deposit landed, if the user brings the rest back without it (*Bring the rest back now*; 1.7.0)."

**Confidence:** high.

## Coverage

**Read:**
- The brief.
- Each UI PR's description and diff (#333, #335, #336, #337), and #330's.
- On HEAD:
  - `LovejoinReturn.tsx`: `CollateralHeldWayOut`, `chainText`, `CollateralTailNote` and `CollateralMixLine`;
  - `SiteSessions.tsx`: `SiteSession`, its foot, `moving`, why-notes and review;
  - `Swaps.tsx`: `Session` in both its forms, `rows`, `nextStep`, `backStepText`, the retry line, `stoppable`;
  - `Lovejoin.tsx`: `MixList`/`MixCard`, `subOf`, `detailOf`, `Chains`, the polling, `skipCollateralMix`, the Bootstrap form and `bootstrapLimits`;
  - `TxDetail.tsx`, and every `TxDetailButton` caller against the summary types that carry `parts`;
  - worker: `lovejoin.ts` (`tailWaits`, `tailBuildable`, `tailOf`, `tailChain`, `tailHeld`, `tailIsOver`, `tailOver`, `privateBootstrapBounds`);
  - worker: `sessions.ts` (`witnessTail`, `pump`, `skipCollateralMix`, `advance`, `step`, `running`, `runAll`, `buildBack`'s tail path, `buildFunding`'s `inParts`);
  - `styles.css`: callout, buttons, token-row, stepper.
- The i18n values of the six new keys and their neighbours in all three languages, and `glossary.md`.
- `scripts/i18n-critical.mjs`: its mode switch, so I ran it without `--write`.
- `verified-critical-{es,ja}.json`: their key lists and reviewer notes, against `babb8e76`.
- The provenance files.
- `flows.md:522` and the architecture.md and privacy.md paragraphs.
- The e2e stepper test and the `tx-detail-parts` screenshot.
- `store-images.spec.ts`, for the changed screens.
- pr333, pr335 and pr337's reports, after doing my own pass.

**Ran:**
- The critical derivation, read-only. It matched (463).
- The 15 test files listed above, alone: 235 pass.
- A scratch Vitest file (`tests/zz-review-x-ui-1.test.ts`, real WebAssembly and the planner's fakes), with two tests: F1's state and F2's state. Both demonstrated. The file is deleted from the tree; a copy is at `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/review/x-ui/`.
- A Playwright render of the way out's static markup with the real stylesheet, for F3.

## Not checked

- **e2e:** I didn't run it (forbidden), and its fakes can't reach the held state. My visual check is a static render with the stylesheet, not the running extension.
- **es and ja on screen, and native reading:** I didn't render es or ja on screen. No native speaker read them. I read the critical line's es and ja myself with the English in view, so mine wasn't blind. I can't verify the PR's two blind rounds.
- **The connector window:** I didn't check the stepper's layout there.
- **#333 at a dearer byte:** I didn't run the form at a dearer byte myself (pr333 measured it).
- **Races:** I didn't trace a press racing the runner (pr337 #4 covers it).
- **`e2e/support.ts`:** I didn't open it, per the owner's rule.

## CLI notes

None.
