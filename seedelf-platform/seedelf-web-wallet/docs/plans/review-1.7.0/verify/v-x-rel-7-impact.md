# v-x-rel-7-impact: x-rel#7, the release-prep docs

**Verdict: partly. Severity: nit** (x-rel rated it low). Every fact in the finding is right. None of it is a defect in the tree under review. It is release-prep work, which the process puts after the review. Its failure scenario does no harm in either branch. The fix is right in substance but needs four corrections, below.

## What holds (HEAD `6bca8bec`)

- `post-release-roadmap.md:38` item 4 is still 🚧, and `:39`–`:41` items 5, 6 and 7 are still ⬜. #333, #336, #337 and #335 merged that work.
- The *Kept in mind* entries at `:373`, `:374` and `:378`–`:380` are still open. `:387`–`:388` show the ✅ form.
- `grep -n 1.7.0 roadmap.md` prints nothing. The newest handoff note is `:49`, 1.6.0's gate.
- `git status --porcelain` prints `?? seedelf-platform/seedelf-web-wallet/docs/plans/review-1.7.0/`. While the review runs, it also prints other agents' `extension/tests/zz-review-*.test.ts`. `development.md:219` and `:281` want it to print nothing.

## Why it isn't a defect

- **By design, and by precedent.**
  - #333's body says: "As agreed, the 1.7.0 list's tick waits for the release-prep docs commit."
  - #330, #331 and #332 marked their own items (`81397dc4`, `3b32b92e`, `4610555a`). The four that merged in parallel left theirs: #333 and #335 a minute apart, #336 and #337 fifteen seconds apart. They would have conflicted on the same lines.
  - The handoff note has always gone into the release PR, after the review:
    - 1.5.0: `a01deb23` ("1.5.0's release review, as built, and its handoff note"), then `05a13116`, the package record.
    - 1.6.0: `677715db`…`ef6af2bc` in #324, then `a2765e8e`, the package record, in #325.
- **No user, site or attacker can reach it.**
  - `package.mjs` zips `dist/` only.
  - Vite reads `src/`, `public/` and `../wasm/pkg/`.
  - No test, script or workflow reads `roadmap.md`, `post-release-roadmap.md` or `docs/plans/`. The tests read only `docs/i18n` (`i18n.test.ts:16`). `activity.test.ts` names the roadmap only in comments.
- **The clean-tree scenario has no harmful branch.**
  - If the folder is still there at part 2, the check prints it and the procedure stops. That is the check working.
  - If someone waves it through, the zip is still byte-for-byte the recorded commit's, because nothing that builds or packages reads `docs/plans/`. An untracked folder changes the working tree, not the zip.
  - `git switch main` and `git pull --ff-only` aren't blocked by it.
- **"Items that shipped" is wrong.** They are merged into `main`. 1.7.0 isn't packaged yet.

## Duplicates

The list's ticks are already reported four times:

| Report | Finding | Severity |
|---|---|---|
| x-docs | #1 | low |
| pr335 | #2 | low |
| pr336 | F8 | nit |
| pr337 | #5 | nit |

The handoff note's refresh outcomes are x-rel's own F4. Only one part is unique to x-rel#7: the review folder against part 2's clean-tree check.

## The fix: right in substance, with corrections

1. **The ticks.**
   - Mark items 4–7 ✅. Item 2 stays 🚧.
   - Item 6 still says "The owner's calls first: after how long it's offered, and its words." Replace that with the calls made:
     - **The delay:** an hour (`lovejoin.ts:335`, `TAIL_OFFER_MS = 60 * 60_000`).
     - **The words:** *Bring the rest back now*.
2. **The *Kept in mind* entries** (`:373`, `:374`, `:378`–`:380`). Turn each into "✅ **1.7.0:** … ~~old text~~", as `:387`–`:388` are. Write what was built, not what was planned:
   - `:379` planned "one `utxo_info`", and `:380` "One batched `account_info`".
   - #336 sends one `tx_info` for each launch, and one `account_update_history` only for an L its launch didn't register. The doc comment at `lovejoin-pools.ts:520` says exactly that.
   - `confirmed()` checks only a pool new to the device: the `fresh` filter at `lovejoin-pools.ts:568`. A launch rolled back after that first look stays kept. So the entry shouldn't claim the check covers every deep rollback (x-docs#1's nuance, which the code confirms).
3. **The handoff note.**
   - **Where:** newest first, above `roadmap.md:49`, written on the release branch and merged in the release PR, as 1.6.0's was.
   - **The refreshes:** it gives each one's outcome: tokens, decimals, DReps and lovejoin-pools (development.md's *Releasing* steps 2 and 3, and the note on the pools' head start).
   - **The API's deploy:** step 7 calls for one only if the release changes `seedelf-data/` or `src/tokens/list.json`. `git diff --stat babb8e76..6bca8bec` over both paths is empty, so only a changed `token-decimals.json` from the refresh could need one.
   - **The package record** (the commit, the SHA-256 and the toolchain lines) goes later, in the record PR, as #325 did for 1.6.0.
   - **Rule 7:** the note dates the work, never the release or the store's state.
4. **The review folder.** Archive it as 1.6.0's was:
   - **The steps:** commit it first, then compress it into `docs/archive/plans/review-1.7.0.md`. Add a row to `archive/plans/README.md`, and an *IDs* section naming the commit that holds the full text.
   - **Stage by path, never `-A`:** the tree holds other agents' scratch tests while the review runs.
   - **Why plain removal isn't enough:** the fix commits will cite this review's IDs (`x-rel#7`, …). 1.6.0's archive exists so such IDs resolve (`git show 7e2d89ed:…`). Removed without a commit, they point at nothing.
   - **What committing costs:** it puts the reports in a public repo's history for good. The owner accepted that for 1.6.0 (`ef6af2bc`: "archive / compress the docs for the review since we dont need it"), so confirm it with them for 1.7.0.
   - **What it touches:** nothing reads `docs/plans/`, so committing changes no check. `plans/README.md`'s "live specs only" is why the folder has to leave `plans/` in the same PR.
5. **Side effects:** none. Every step is docs only, with no code, test or zip change.

## What I ran (read-only)

- `git status --porcelain`, `grep -n 1.7.0` over the docs, and `sed` over the lines cited.
- `gh pr view` for #333 and #335–#338.
- `git diff <merge>^1 <merge>` of the docs, for #330–#333 and #335–#338.
- `git log` over `roadmap.md` and the 1.6.0 review folder's archive (`7e2d89ed`, `ef6af2bc`, `a2765e8e`).
- `grep` over tests, e2e, scripts, `vite.config.ts`, `package.mjs` and the workflows for anything that reads the docs: only `docs/i18n`.
- `git check-ignore` on `dist/`, `release/` and `test-results/`: all ignored.
- `gh repo view`: the repository is PUBLIC.

No scratch files.
