# v-pr329-1-trace: pr329#1, the required check against the admin bypass

**Verdict: confirmed.** **Severity: low.** Item 2's text promises a gate that wouldn't hold any merge. Which settings to change is the owner's call.

Requiring *Web Wallet required* on its own would not have held a single merge in this range. Each one was already an admin bypass: one approval is required, no PR ever had a review, and admins aren't enforced. GitHub's bypass skips required status checks along with the review rule. The pattern is wider than the finding lists. A few of its numbers are off, and its second fix doesn't work (see the end).

## What I traced (all read-only `gh`, on 2026-10-28)

1. **`main`'s protection** (`gh api repos/logical-mechanism/Seedelf-Wallet/branches/main/protection`):
   - `required_status_checks`: `"strict": true, "contexts": [], "checks": []`
   - `required_approving_review_count`: `1`
   - `enforce_admins`: `"enabled": false`
   - `rulesets` and `rules/branches/main` are both `[]`.
   - The repo has `allow_auto_merge: false`.
   - The finding's evidence matches exactly.
2. **What the bypass covers, in GitHub's words.**
   - REST *Update branch protection*, `enforce_admins`: "Enforce all configured restrictions for administrators. Set to true to enforce required status checks for repository administrators." With it off, a required check doesn't hold an admin.
   - `gh pr merge --help`: `--admin` "Use administrator privileges to merge a pull request that does not meet requirements". That is one bypass for every unmet requirement.
3. **Reviews.**
   - #323 to #338: every one authored and merged by `logicalmechanism`, `reviews` 0, `reviewDecision` `REVIEW_REQUIRED`.
   - The last 100 PRs merged into `main`: none had any review, and all were merged by `logicalmechanism`.
   - So every merge is one the review rule refuses, which makes it a bypass. A required check would be one more requirement that the same bypass skips.
4. **Each merge against the end of its merged head's own Web Wallet run** (each job's `completedAt`):

| PR | merged | run ended | result | merged |
|---|---|---|---|---|
| #323 | 10-24 16:02:25 | 16:14:33 | failure | 12m08s before |
| #324 (1.6.0's gate) | 10-27 02:44:10 | 03:01:02 | success | 16m52s before |
| #325 | 17:36:00 | 17:16:55 | success | 19m after |
| #326 | 17:36:12 | 18:10:20 | success | 34m08s before |
| #327 | 17:49:34 | no run (the path filter, before #331) | | |
| #328 | 18:11:17 | 18:47:05 | success | 35m48s before |
| #329 | 10-28 15:49:28 | 16:42:21 | success | 52m53s before |
| #330 | 16:22:22 | 16:58:35 | success | 36m13s before |
| #331 | 16:26:02 | 17:22:03 | success | 56m01s before |
| #332 | 16:25:43 | 17:23:49 | success | 58m06s before |
| #333 | 17:14:44 | 17:27:39 | success | 12m55s before |
| #334 | 17:13:35 | 17:42:14 | success | 28m39s before |
| #335 | 17:14:00 | 18:03:00 | success | 49m00s before |
| #336 | 18:30:13 | 18:39:14 | success | 9m01s before |
| #337 | 18:30:28 | 19:14:39 | success | 44m11s before |
| #338 | 22:55:43 | 23:28:29 | success | 32m46s before |

5. **What tests `main`.**
   - `web-wallet.yml:9-10` is `on:` / `pull_request:` and nothing else.
   - `continuous-integration.yml:3-6` does run on `push` to `main`, but its job checks only the Aiken contracts (`aiken fmt --check`, `aiken check -D`, `aiken build`).
   - So the wallet's check never runs on `main`'s merged tree.
6. **The written rule these merges broke.** `development.md:15`: "**Merge only once its check is green on every step,** never while it's still running." It has been on `main` since `22acd30e`, which shipped in #324. #326, #328 and #329 to #338 all merged against it.

## Corrections to the finding

- **"9–53 minutes"** should be 9–58. By the finding's own times, #331 merged 56m01s and #332 58m06s before their runs ended.
- **It's broader than listed.**
  - #326 (34m), #328 (36m) and #334 (29m) also merged before their runs ended.
  - So did #324, 1.6.0's gate PR, 16m52s before the run on its last head ended. An earlier head's run had passed.
  - In 1.7.0's range only #325 merged after its run. #327 had none.
- **#338's run has since finished green**: at 23:28:29Z, 32m46s after the merge. The owner notes #338 is docs only.
- **"a sole maintainer can never approve their own PR" isn't quite right.** A second collaborator with write access exists (`quinn-logicalmechanism`), and that approval would count. In practice it has never happened, so the bypass is routine all the same.
- **"`main`'s merged tree is never tested"** holds for the wallet. `continuous-integration.yml` runs on `main`, but for the contracts only, which `development.md:15` already says.

## Also stale on the same point (adjacent, from #331's `c5d19d3f`)

Both texts below state as fact a requirement that doesn't exist yet: the protection shows `contexts: []`, `checks: []`.
- `development.md:13`: "That job is the one `main`'s branch protection requires, so no path filter can leave a PR waiting…"
- `web-wallet.yml:135-136`: "The one check main requires (its branch protection names *Web Wallet required*…)"

## The fix

- **Option 1 works.**
  - REST allows `required_approving_review_count: 0` ("Use a number between 1 and 6 or 0 to not require reviewers"). Then add *Web Wallet required* and set `enforce_admins: true`.
  - **The cost:** `strict` is already `true`. Once the check is required and can't be bypassed, every PR must be up to date with `main`, with its check re-run on that, before it merges. A burst like #330–#332 (four minutes) becomes one PR after another, about 40–60 minutes each.
  - **The gain:** that is also what makes `main`'s tree the tested tree. The brief says this release's tree was "never CI-tested as one".
  - Setting `strict: false` keeps merges fast but loses that.
  - `enforce_admins` also refuses direct pushes to `main`. There have been none since `e350a0aa` (2026-05-19); the CLI's 2025 tagging chores were direct pushes.
- **Option 2 doesn't work as written.**
  - Auto-merge is off for the repo (`allow_auto_merge: false`). GitHub's docs: "Before you use auto-merge, it must be enabled for the repository."
  - Auto-merge "merges a pull request automatically after all required reviews and status checks pass". With one approval required and nobody approving, it never fires.
  - It needs approvals at 0 (or that second account's approval) and auto-merge allowed in the repo's settings.
  - It is also voluntary: a bypass merge still goes through.
- **Option 3 keeps the owner's unreviewed merges.**
  - Add a ruleset on `main` that requires *Web Wallet required*, with an empty bypass list.
  - GitHub's docs: rulesets "layer with protection rules targeting the same branch", and "the most restrictive version of the rule applies". Only actors added to a ruleset's bypass list can bypass it.
  - The classic review rule stays bypassable, and the check no longer is.
- Then item 2 (`post-release-roadmap.md:36`), `development.md:13` and the workflow's comment should name what it actually takes.

## Repro

- One read-only scratch script (`gh pr view`, `gh run list`, `gh run view`) computed the table above. It's deleted.
- There's no in-tree test. GitHub's merge gate can't be exercised without writing to GitHub (opening a PR, changing the protection), which the brief forbids.
- No tracked file was touched.
