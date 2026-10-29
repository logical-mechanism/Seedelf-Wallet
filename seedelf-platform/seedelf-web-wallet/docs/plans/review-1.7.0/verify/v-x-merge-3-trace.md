# v-x-merge-3-trace: x-merge#3, privacy.md and the new way out of the collateral's mix

**Verdict: confirmed.** **Severity: low** (a design doc that leaves out a privacy trade-off the user can now choose).

On HEAD, a user can leave a session's 5 ₳ collateral box unmixed and tied to the session from an hour after its deposit landed. `docs/privacy.md` still gives only the automatic cutoffs: an hour where the deposit isn't on chain, and a day after it landed. #337 updated `architecture.md` and `flows.md`, but not `privacy.md`. The finding's one overstatement is the word "only", which isn't in the doc. The doc lists the cutoffs, though, and that is how a reader takes them, so it doesn't change the verdict.

## What I traced (HEAD `6bca8bec`)

1. **The doc.**
   - `docs/privacy.md:217`, the collateral bullet: "...the rest held back meanwhile so nothing sweeps what pays for that mix, but for an hour at most where the deposit isn't on chain (most likely dropped); past that, or a day after the deposit landed, the box waits not mixed yet, tied to the session as any deposit's box is, and Mix my boxes again takes it first."
   - A search of the whole file finds none of *Bring the rest back now*, `TAIL_OFFER_MS`, `skipCollateralMix`, `session-skip-collateral-mix`, `offerAt` or "rest back".
   - `git log babb8e76..6bca8bec -- docs/privacy.md` finds only `f40ed2fc` (#336, the pool confirmation paragraph at line 200).
   - `git diff 11e249d2^1 11e249d2 --stat` touches `architecture.md` and `flows.md`, not `privacy.md`.
2. **The code gives the user the same outcome sooner.**
   - `lovejoin.ts:335`: `TAIL_OFFER_MS = 60 * 60_000`, against `TAIL_KEEP_MS = 24 * 60 * 60_000` at `:327`.
   - `lovejoin.ts:4127-4133` `tailHeld`: covers a tail that isn't over and whose deposit landed, with its mix either waiting for giveme.my (`tailWaits`) or to be built again (`tailBuildable`). It returns `offerAt: c.tail.landed + TAIL_OFFER_MS` (`:4132`).
   - `sessions.ts:5526-5538` `skipCollateralMix`: `if (held && this.deps.now() >= held.offerAt)` (`:5528`) calls `tailOver(network, held.id)` (`:5529`). It then pumps a chain still being sent, and advances the session.
   - `lovejoin.ts:4140-4146` `tailOver` sets `tail.over = true`. Its doc comment: "its box waits, not mixed yet, and the session's rest comes back". That is the same mark the day's end leaves (`tailOf` calls `tailOver` once `tailBuildable` fails).
   - `sessions.ts:5144` `witnessTail`: on an over tail, `throw new Error(t("lj.tail.skipped"))`, so the chain stops before giveme.my is asked again.
   - The UI: `LovejoinReturn.tsx:536-557` `CollateralHeldWayOut` returns null before `offerAt` (`:548`). From then on it shows a privacy callout (`:551`) and the button. It appears on a swap's page, a site's page and a mix's card on the Lovejoin page.
   - `en.json:922` `lj.tail.privacy.wayOut`: "...Bring the rest back without it, and its 5 ₳ box stays in the pool unmixed, tied to this session, until you mix it again." It is critical (`docs/i18n/critical-keys.json:144`).
3. **The same bullet also lists which screens say the box waits unmixed.** "They say it's mixed, giveme.my backing and seeing that mix and, if it can't go, its box waiting unmixed, tied to the session, only where…", followed by the "one line" places. The new critical line on the session's page isn't among them. This is the same gap.
4. **The docs rule.** `post-release-roadmap.md:324`: the design docs, `privacy.md` among them, "describe the wallet as it is, and are read by users, by people judging whether to trust it, and by the Web Store reviewer".
5. **No policy entry is needed, which agrees with the finding.**
   - `store/privacy-policy.md:28` says only "If the mix can't go, the box waits there, and can be tied to the session until it's mixed, as any box at its deposit can." It gives no wait period.
   - Nothing new is sent or kept:
     - `tailHeld` reads from the device alone.
     - `tail.over` was already in the record.
     - `collateralHeld` is a field in the view only.
     - The rest's return is the same one the day's end sends.
   - #337's body says "No privacy policy entry. Nothing new is sent to anyone." It doesn't mention `privacy.md`, so leaving it out wasn't a stated decision.
6. **Side note, no defect.** `privacy.md:226`, *Bring every box back now*, still holds: it "leaves a session's 5 ₳ collateral's box to that collateral's mix, a day at most". A day is still the most, and the user can now end it sooner.

## Repro

1. **Scratch test** `extension/tests/zz-review-v-x-merge-3-trace-1.test.ts`, run alone. Result: **3 passed, 1 failed**. The test is deleted.
   - Passed: `TAIL_OFFER_MS` (1 h) < `TAIL_KEEP_MS` (24 h), and `lj.tail.privacy.wayOut` contains "unmixed, tied to this session".
   - Passed: `flows.md` contains "Bring the rest back now", and `architecture.md` contains `TAIL_OFFER_MS`.
   - Passed: `privacy.md`'s collateral bullet contains "past that, or a day after the deposit landed, the box waits not mixed yet, tied to the session".
   - **Failed on HEAD:** `privacy.md` matches none of `/Bring the rest back now|TAIL_OFFER_MS|skipCollateralMix|session-skip-collateral-mix/` ("privacy.md mentions the user-chosen way out: expected false to be true").
2. **#337's own worker test**, run alone: `npx vitest run tests/lovejoin-planner.test.ts -t "offers the rest back without its collateral's mix an hour after"`, **1 passed** on HEAD. Before the hour nothing changes. At the hour the tail is over, the chain stops with `lj.tail.skipped`, giveme.my isn't asked again, and the return is built without the mix.

## Fix

Use the finding's clause, at the same place in `privacy.md:217`, written a little more fully so it also covers the line the page shows. For example, after "past that, or a day after the deposit landed":

> or sooner at the user's word: from an hour after the deposit landed (`TAIL_OFFER_MS`), while the mix still waits (for giveme.my, or to be built again), the session's page (a swap's, a site's, or the mix's card on the Lovejoin page) offers *Bring the rest back now*, whose line says the 5 ₳ box stays in the pool unmixed, tied to the session (1.7.0);

The sentence then continues "...the box waits not mixed yet, tied to the session as any deposit's box is, and Mix my boxes again takes it first." This is doc-only, with no policy entry and no i18n change.
