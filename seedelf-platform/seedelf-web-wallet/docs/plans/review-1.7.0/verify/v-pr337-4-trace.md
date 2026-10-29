# Verify `pr337#4` (label `v-pr337-4-trace`)

**Verdict: partly. Severity: nit.**

- **The privacy.md half is real.** The design doc never mentions the user's way out.
- **The roadmap half is not a defect.** It is the agreed process: item PRs don't tick the list, and one docs commit at release prep ticks it. That commit has to tick more than the finding lists.

Traced on HEAD `6bca8bec`.

## What the code does (the finding's premise holds)

- `lovejoin.ts:335`: `export const TAIL_OFFER_MS = 60 * 60_000;`
- `lovejoin.ts:4127-4133` (`tailHeld`):
  - It returns nothing until the deposit has landed (`if (!c?.tail || c.tail.landed === undefined) return undefined;`).
  - It returns nothing unless the mix waits for giveme.my or to be built again (`if (!tailWaits(c) && !tailBuildable(c, this.deps.now())) return undefined;`).
  - Otherwise it returns `{ id: c.id, offerAt: c.tail.landed + TAIL_OFFER_MS }`.
- `sessions.ts:5526-5537` (`skipCollateralMix`): from `offerAt`, it calls `tailOver(network, held.id)`, pumps a chain still being sent, then `advance`s the session.
- `lovejoin.ts:4141-4146` (`tailOver`): it sets only `tail.over = true`. The day's end sets the same state:
  - `tailOf` → `tailBuildable` false → `tailOver` (`lovejoin.ts:4011-4014`);
  - `witnessTail`'s `lj.tail.tooLong` (`sessions.ts:5148`).
- So the outcome is the day's end, reached sooner by the user's choice. The box waits in the pool, not mixed yet, tied to the session, for *Mix my boxes again*.
  - `witnessTail` stops a chain still being sent: `if (await lovejoin.tailIsOver(...)) throw new Error(t("lj.tail.skipped"));` (`sessions.ts:5144`).
  - #337's own test drives it at the hour (`lovejoin-planner.test.ts:1791-1828`).
- The screen says so before the press. `en.json:922` `lj.tail.privacy.wayOut`: "…its 5 ₳ box stays in the pool unmixed, tied to this session, until you mix it again."

## Half 1: privacy.md (confirmed, nit)

- `privacy.md:217`, the collateral paragraph, last touched by `22acd30e` in 1.6.0's review: "…the rest held back meanwhile so nothing sweeps what pays for that mix, but for an hour at most where the deposit isn't on chain (most likely dropped); past that, or a day after the deposit landed, the box waits not mixed yet, tied to the session…"
- No line of privacy.md names the way out. A grep for `rest back now`, `TAIL_OFFER`, `skipCollateralMix` and "an hour after" (in this sense) finds nothing.
- #337 updated `architecture.md:633` ("Sooner on the user's word: `TAIL_OFFER_MS` (an hour) after the deposit landed…") and `flows.md:522`, but not privacy.md.
- There was no conflict to avoid: #336 changed privacy.md at line 200 only.
- The harm is small. The doc already states the privacy outcome (the box unmixed and tied to the session), and the UI line discloses it. What's missing is a trigger: the doc says the rest is held up to a day, but the user can release it from the hour on.

## Half 2: the roadmap (not a defect: it's the agreed process)

- The facts are right. `post-release-roadmap.md:40` reads "6. ⬜ **An "unmixed, now" way out** … The owner's calls first", and items 5 (`:39`) and 7 (`:41`) are ⬜ too.
- **But item PRs don't tick the list, by agreement.** The list's lines are next to each other, so ticks conflicted across #330–#332. The ticks go in one docs commit at release prep instead (the owner, 2026-10-28).
  - #333's description: "As agreed, the 1.7.0 list's tick waits for the release-prep docs commit."
  - #333, #335, #336 and #337 all left the list alone. #338, a pure docs PR and item 8's only landing, ticked item 8 alone (`git diff 6bca8bec^1 6bca8bec`: lines 42 and 405 only), as the owner's note on this run says.
- The finding's own fix ("when the list is next updated") is that commit, so this half asks for nothing beyond the plan.
- **The finding's list is incomplete.** The release-prep commit should also tick:
  - item 4 (`:38`, still 🚧 with only "✅ The overflow half"), since #333 landed the Bootstrap half;
  - the *Kept in mind* entries `:373` (item 6), `:374` (item 7), `:378` (item 4's Bootstrap half), and `:379`–`:380` (item 5).
- Item 6's line should state the calls as made (`TAIL_OFFER_MS`, *Bring the rest back now*). v-pr334-2, v-pr329-0 and pr338 already cover that.

## Repro

`extension/tests/zz-review-v-pr337-4-trace-1.test.ts` was run alone and then deleted. Result: 2 passed, 2 failed.

- ✓ control: `TAIL_OFFER_MS = 60 * 60_000`, `offerAt: c.tail.landed + TAIL_OFFER_MS`, and `lj.tail.wayOut` = "Bring the rest back now".
- ✓ control: flows.md and architecture.md describe the way out.
- × privacy.md mentions none of `Bring the rest back now|TAIL_OFFER_MS|skipCollateralMix`, and its paragraph still reads "a day after the deposit landed, the box waits not mixed yet". **Finding real.**
- × item 6's line doesn't start with "6. ✅". This is true, but it's the deferred tick.

## Fix advice

- **privacy.md:217.** After "past that, or a day after the deposit landed," add: "or sooner, from an hour after it landed, at the user's word (*Bring the rest back now*; 1.7.0),".
  - Don't word it as the user "brings the rest back". For a session brought back by hand (a site's, or a swap brought back by hand), the press only ends the wait. `step` returns at once when `!running(s)` (`sessions.ts:3446`; `running` needs `s.auto`), so the rest stays at the account until *Bring it back* (pr337#2).
  - What's true for every session is the box's outcome and the hold's end, and that is what the doc is about.
  - No privacy policy entry is needed: nothing new is sent, and `over` is an existing field.
- **The roadmap.** In the release-prep docs commit, tick items 4–7 and their *Kept in mind* entries, as listed above.
