# v-pr329-1-impact: requiring *Web Wallet required* wouldn't hold the owner's merges, because every one bypasses `main`'s protection

**Verdict:** confirmed. **Severity:** low, as filed: a misleading doc, with the remedy the owner's settings call. It isn't medium, as pr331 F1 and x-rel F3 rate it. **Confidence:** high on the facts. On GitHub's bypass rules it's high too, from GitHub's own docs, but I didn't try it live: a test PR writes to GitHub.

## Attribution and duplicates

- **Who wrote the text.** Item 2's step, "then the owner turns the required check on in the branch's protection", is #329's (`d67f8054`). #331 (`c5d19d3f`, per `git blame -L 36,36`) added "The job is in (…); left, the owner's: requiring it."
- **The same defect, filed twice more:** `reports/pr331.md` F1 (medium) and `reports/x-rel.md` F3 (medium). Merge the three.
- **Its sibling:** the docs say `main` requires the job *now* (`development.md:13`, `web-wallet.yml:135-136`). That's pr329's finding 6 and pr331's F6. One edit should fix both findings.

## The facts, checked

I used read-only `gh api`, `git`, and GitHub's docs.

- **`main`'s protection:**
  - `required_status_checks {strict: true, contexts: [], checks: []}`
  - `required_approving_review_count: 1`
  - `enforce_admins.enabled: false`
  - `rulesets` and `rules/branches/main` are both `[]`.
  - The repository has `allow_auto_merge: false`.
- **The merges.** Every PR from #323 to #338 was authored by logicalmechanism, merged by logicalmechanism, based on `main`, and has `reviews` = 0. The last approved PR in the repository is #141 (2025-05-01). So every merge for roughly 200 PRs has gone through the admin bypass.
- **Not a sole maintainer.** `collaborators` lists logicalmechanism as admin and quinn-logicalmechanism as **write**. That account authored 19 PRs and reviewed 50, the last in May 2025. The bypass is routine because nobody reviews, not because nobody could.
- **What the bypass covers.** GitHub: "By default, the restrictions of a branch protection rule do not apply to people with admin permissions to the repository." *Do not allow bypassing the above settings* is what applies them to admins. The classic rule is a single rule, so the bypass that waves through the missing review waves through a pending or red required check as well.
- **The CLI agrees.** gh 2.46.0's strings include "the base branch policy prohibits the merge", "To have the pull request merged after all the requirements have been met, add the `--auto` flag." and "To use administrator privileges to immediately merge the pull request, add the `--admin` flag."
- **Merged against run end** (each head's check runs):

  | PR | Merged | Web Wallet run ended | Early by |
  |---|---|---|---|
  | #329 | 15:49:28 | 16:42:22 | 53 min |
  | #330 | 16:22:22 | 16:58:35 | 36 min |
  | #331 | 16:26:02 | 17:22:04 | 56 min |
  | #332 | 16:25:43 | 17:23:50 | 58 min |
  | #333 | 17:14:44 | 17:27:39 | 13 min |
  | #334 | 17:13:35 | 17:42:14 | 29 min |
  | #335 | 17:14:00 | 18:03:01 | 49 min |
  | #336 | 18:30:13 | 18:39:15 | 9 min |
  | #337 | 18:30:28 | 19:14:40 | 44 min |
  | #338 | 22:55:43 | 23:28:30 (run 40780509816, success) | 33 min |

  - The range is 9 to 58 minutes, not "9–53": #331 and #332 were 56 and 58.
  - #338's run, still in progress in the finding, has since finished green.
  - 12 of the 13 PRs in #325–#338 that had a Web Wallet run merged before it ended. #325 is the one that waited.
- **Heads merged out of date** (`git merge-base --is-ancestor`): #331's head lacks #332's merge, #335's lacks #333's, and #337's lacks #336's. `strict: true` has nothing to enforce while no check is named.
- **The workflow** runs on pull requests only (`web-wallet.yml:9-10` `on:` / `pull_request:`), as `development.md:15` says. No workflow pushes to `main`: `grep` finds only `continuous-integration.yml`'s push trigger (Aiken only) and `release.yml`'s tag trigger.

## Impact

- **No user, site or attacker can reach this.** It's the repository's merge path, and nothing in `.github/` or the roadmap ships.
- **The owner can, and likely will:** the bypass is part of every merge they make.
- **The cost when it happens** is a red `main` until something reads it. #323 is the precedent: it broke every private Bootstrap on `main`, and the 1.6.0 release review found it before the upload.
- **Between a red `main` and users stand three things:**
  - Before the release PR merges, the release procedure runs the whole automated layer locally (`development.md:277` → `:115`: `cargo test`, both Vitest builds, `npm run e2e`, the live runs).
  - After it, the store build's e2e (`:288`).
  - The release review.

  So this is "a misleading doc" by the brief's scale: **low**. It isn't medium, because no state a user reaches behaves wrongly.
- **For 1.7.0 itself, the point is moot.**
  - HEAD's tree (`8bd149a8`) is #338's head tree: its head sits directly on #337's merge, and nothing merged in between. Its run is green on every step.
  - #338 is a pure markdown docs PR (the owner's note). Nothing in the check reads markdown outside `docs/i18n/`: `words.test.ts` scans `extension/src` only, and `i18n.test.ts` and `i18n-critical.mjs` read `docs/i18n/`. So merging it early risked nothing.

## The proposed fix

The substance is right: change the owner's settings, then have item 2 say what it actually takes. Four corrections follow.

1. **Option 1 (approvals 0, require the check, *Do not allow bypassing*) works, but it changes more than it says:**
   - **The review rule comes off the other writer.** quinn-logicalmechanism (write) could then merge their own PR into `main`, unreviewed, once its check is green. Today the rule holds them, since only admins bypass.
   - **`strict: true` becomes live, and binds the owner.** Every PR must be up to date with `main` before it merges, so each merge sends the next PR back for *Update branch* and another 40–60-minute run.
     - This range's bursts would each have taken about an hour a PR: #330–#332 merged within 4 minutes, #333–#335 within 70 seconds, #336–#337 within 15 seconds.
     - That's also what would have tested `main`'s tree as one. It's the owner's choice to make knowingly, or to turn strict off.
   - **Docs PRs wait too.** Every PR that touches `seedelf-platform/` waits its full run, the pure docs ones included. That's #325, #326, #329, #334 and #338: 5 of this range's 14.
   - **A mainnet hotfix waits** (as 1.4.1 did), unless the owner turns the setting off for it.
   - **What it doesn't break:** no automation. It also stops admin direct pushes, and `development.md:14` already asks for a PR even for docs.
2. **Option 2 (keep the bypass, `gh pr merge --auto`) doesn't work as written:**
   - `allow_auto_merge` is false, so `--auto` is refused ("Before you use auto-merge, it must be enabled for the repository").
   - Auto-merge "merges a pull request automatically after all required reviews and status checks pass". With one approval required and none ever given, it never merges.
   - It works only as: approvals 0, *Allow auto-merge* on, then `--auto`. Even then, with the bypass kept, nothing holds the owner. It's a habit, like `development.md:15`'s existing "Merge only once its check is green on every step", which 12 of the 13 PRs with a run didn't wait for.
3. **A smaller fix that does what item 2 is for: a branch ruleset on `main`.**
   - Make it active, with an empty bypass list and one rule: *Require status checks to pass*, naming *Web Wallet required* from GitHub Actions.
   - Leave *Require branches to be up to date* off unless the owner wants the serial runs.
   - Leave the classic rule exactly as it is. The other writer still needs a review, and the owner's admin bypass then covers only the review.
   - GitHub says rulesets "layer with protection rules targeting the same branch", with the most restrictive version applying, and grants bypass per ruleset. Its docs don't say outright that an admin's classic bypass leaves a ruleset's check in force, so the test below settles that.
4. **If the owner would rather keep merging early** (docs PRs especially, as the note on #338 suggests), item 2 should say so honestly and drop the requirement. A `push: branches: [main]` run, with `changes` setting `platform=true` on a push (today it reads `github.event.pull_request.number`, which a push lacks), would at least show a red `main`. That's the owner's call.

**The doc fix, short.** On `post-release-roadmap.md:36`:

> "left, the owner's: requiring it."

becomes

> "left, the owner's: requiring it in a branch ruleset with no bypass, since every merge goes through the classic rule's admin bypass, which skips checks too."

In the same edit, `development.md:13` and `web-wallet.yml:135-136` should say "requires" only once it's true. `development.md:15` stays.

## The test

**The finding's test passes today, before any fix.** The review rule already keeps the merge button behind the bypass, and gh already refuses without `--admin`. So it can't tell fixed from unfixed.

Use this instead. It's the owner's to run, since opening a PR writes to GitHub.

1. Open a PR with a comment-only change under `seedelf-platform/`.
2. While its check runs, merge with the bypass ticked, or with `gh pr merge --admin`. Both must be refused.
3. Once it's green, it must merge: with the ruleset, through the review bypass alone; with option 1, with no bypass at all.
4. With strict on, merge another PR first. This one must then ask for an update.

## Scratch

None was needed. Everything above came from read-only `gh api` GETs, `git log`/`blame`/`diff`/`merge-base`, `strings` on the local gh binary, and GitHub's docs pages on protected branches, auto-merge and rulesets.
