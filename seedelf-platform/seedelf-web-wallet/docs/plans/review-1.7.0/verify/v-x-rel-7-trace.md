# v-x-rel-7-trace: x-rel#7, the release-prep docs

**Verdict: partly. Severity: nit.**

The finding's three facts are all true on HEAD (`6bca8bec`). But none of them is a defect in what was merged. They describe a release prep that hasn't started yet, and the review is the step before it. The scenario's harm doesn't happen: if part 2's clean-tree check fails, that's the check doing its job, and waving it through can't change the zip. What's real is narrower than the finding says. Before release prep, `main`'s status list and its *Kept in mind* lines lag behind the code, by agreement. They need ticking, and also rewriting, in the release-prep commit.

## The facts, checked on HEAD

1. **The list's ticks.** Item 4 is 🚧 (`post-release-roadmap.md:38`), and items 5, 6 and 7 are ⬜ (`:39`, `:40`, `:41`). Each item's code is on HEAD:
   - item 4's Bootstrap half: `seedelf-core/src/lovejoin/mod.rs:1744` `pub fn bootstrap_back_reserve(params: &ProtocolParameters)`, with `BOOTSTRAP_BACK_RESERVE` now its floor (`:1733`, `:1750`);
   - item 5, both halves: `lovejoin-pools.ts:522` `launched()` asks `tx_info` for the launch, and `:551` asks `firstRegistrations` for L;
   - item 6: `lovejoin.ts:335` `TAIL_OFFER_MS = 60 * 60_000`;
   - item 7: `script-spend.ts:565` `partHashes`, which `parts.ts:624` follows.

   The deferral is by agreement. #333's description says: "As agreed, the 1.7.0 list's tick waits for the release-prep docs commit." The PRs weren't consistent about it, though. #330, #331, #332 and #338 ticked their own items in `post-release-roadmap.md`. #333, #335, #336 and #337 didn't touch the file.
2. **No 1.7.0 handoff note.** True, but nothing exists for it to record yet:
   - `extension/package.json` is still `1.6.0`, so part 1 (the bump, then `npm run tokens`, `dreps` and `lovejoin-pools`, `development.md:171-189`) hasn't run. Steps 2 and 3 (`development.md:273`, `:275`, `:276`) put each refresh's outcome in the note *after* that refresh, and the brief forbids running them during the review.
   - 1.6.0's gate note was first written on its gate branch, in round 3c, after its review (`677715db`, which also added its *Lists* line). The package record (`development.md:262`, `:291`) comes after the upload.
3. **The untracked review folder.** `git status --porcelain` shows `?? seedelf-platform/seedelf-web-wallet/docs/plans/review-1.7.0/`, and the folder isn't gitignored. It's this review's own working folder, and the brief makes it untracked on purpose (REVIEWBRIEF.md:95). 1.6.0's precedent is the plan: the review folder was committed into the gate branch (`d5fa7ede`, 2026-10-24) and archived before the merge (`ef6af2bc`, "the review's working folder archived"). At `babb8e76`, `docs/plans/` holds only `README.md` and `chunk-34-token-pools.md`, plus the archive `docs/archive/plans/review-1.6.0.md` (roadmap.md:61).

## The scenario's harm, refuted

- **"The clean-tree check fails."** That's the guard working. `development.md:219` says part 2 runs "with nothing changed or added (`git status --porcelain` prints nothing)", and `:224` prints that status for the owner to read. A `??` line there is exactly what it's meant to catch.
- **"It's waved through and the recorded commit no longer describes the tree the zip was built in."** The zip can't see `docs/`:
  - `scripts/package.mjs:22` `const dist = join(extension, "dist");`, `:116` `const paths = files(dist);`, `:117` `const archive = zip(dist, paths);`;
  - Vite reads `src/`, `public/` and `../wasm/pkg/` (`vite.config.ts:10`), and nothing in `src/` or `public/` imports or reads `docs/`.

  So the recorded commit still gives the same zip, which is all `development.md:167` asks for ("so the commit the handoff note records gives the same zip"). No local test walks `docs/plans/` either: `words.test.ts` reads `src/` alone, and `i18n.test.ts` reads `docs/i18n` alone.
- **"The list keeps saying ⬜ for items that shipped."** True on `main` now, by agreement, until the release-prep commit. Users never see it, since `docs/` isn't in the zip.

## The scratch test

`extension/tests/zz-review-v-x-rel-7-trace-1.test.ts`, run alone, then deleted.

**4 failed, 6 passed, as predicted.**

- **Failed:** `item 4/5/6/7 is ticked` read `4. 🚧` (the slice shows "4. �", half a surrogate pair), then `5. ⬜`, `6. ⬜` and `7. ⬜`. The list's facts are real.
- **Passed:**
  - each item's code is on HEAD;
  - `package.json` is `1.6.0`, so part 1 hasn't run;
  - `package.mjs` zips `dist/` alone;
  - nothing the build compiles reaches `docs/`;
  - the folder is untracked and not ignored;
  - `babb8e76` carries no review folder, only its archive.

## Fix advice (for the release-prep commit)

The finding's fix is right on items 4 to 7. #336 covers both of item 5's halves, so it gets a full ✅. When the lines are ticked, rewrite them, don't just add a ✅. Several *Kept in mind* lines still describe their gaps in the present tense, and HEAD has closed them:

| Line | Still says | HEAD |
|---|---|---|
| `:378` | "`BOOTSTRAP_BACK_RESERVE` is a fixed 1.5 ₳, so a dearer byte lowers the cap" | it's the floor of `bootstrap_back_reserve(params)` |
| `:379` | "Without it a lying server, or a deep rollback, can show a pool that isn't on chain" | `launched()` checks it |
| `:374` | "a review opens only the first part's" | `parts.ts:624` follows `partHashes` |
| `:373` | the way out as still to build | it's built |
| `:38` | `BOOTSTRAP_BACK_RESERVE` as the thing being priced | the function `bootstrap_back_reserve` prices it |

Write each as a ✅ entry the way `:387` and `:388` are. The review folder needs nothing beyond 1.6.0's way: commit it on the gate branch and compress it into `docs/archive/plans/review-1.7.0.md` before the PR. Write the handoff note on the gate branch once part 1's refreshes have run, as 1.6.0's was.
