# v-pr331-0-trace: pr331#0, the required check the owner's own merge skips

**Verdict: confirmed. Severity: low** (the finding says medium).

Every fact I could check holds, to the second. The mechanism is GitHub's own rule: with `enforce_admins` off, a required status check isn't enforced for an admin. The owner is an admin, and has merged every PR in the range through the bypass, since none had the one approving review main requires. So requiring *Web Wallet required* the way #331's body describes won't stop the owner merging while the check runs.

I rate it low rather than medium for two reasons:
- Nothing in the tree misbehaves. What's wrong is the owner's remaining step as written, plus four lines of HEAD text that talk as if the requirement were already on and would bind.
- A red `main` still has to get past the release procedure's own gates, and those are what caught #323.

Which remedy to pick is the owner's call.

## Checked (read-only `gh` and read-only git only)

1. **main's classic protection** (`gh api repos/logical-mechanism/Seedelf-Wallet/branches/main/protection`):
   - `"required_status_checks":{"strict":true,"contexts":[],"checks":[]}`
   - `"required_approving_review_count":1`, `"bypass_pull_request_allowances":null`
   - `"enforce_admins":{"enabled":false}`
   - `gh api …/branches/main` reports `"required_status_checks":{"checks":[],"contexts":[],"enforcement_level":"non_admins"}`. That is GitHub saying outright that required checks bind non-admins only.
2. **No ruleset.** `gh api …/rulesets` returns `[]`. `gh api …/rules/branches/main` also returns `[]`, and that endpoint lists every active ruleset rule on main.
3. **The people.**
   - `collaborators/logicalmechanism/permission` is `admin`.
   - One other collaborator: `quinn-logicalmechanism` (write).
   - The repo is public and owned by an organization, with `allow_auto_merge: false`.
4. **Reviews.**
   - #323 to #338 were all authored and merged by `logicalmechanism`, and `pulls/<n>/reviews` is empty for every one.
   - `gh pr view 331` gives `reviewDecision: REVIEW_REQUIRED`.
5. **Merge time against the Web Wallet check on each PR's head** (check-runs on the head SHA):
   - #326 to #338 match the finding's list exactly.
   - #325 waited: its check finished 17:16:55 and it merged 17:36:00.
   - #327 has no Web Wallet run: it touched only the contracts, before #331 removed the path filter.
   - Outside the range, #324 (1.6.0's gate) merged at 02:44:10. The check on its last head, `ef6af2bc` (a docs-only commit), finished at 03:01:02.
6. **PRs merged while behind main** (`git merge-base --is-ancestor`):
   - #331's head `c5d19d3f` lacks #332's merge `4610555a`, which landed 19 s before it.
   - #337's head `aa6f5fc2` lacks #336's merge `473b7f1a`, which landed 15 s before it.
   - Also behind: #335's head lacks #334's merge, and #333's head lacks both #334's and #335's.
7. **GitHub's docs:**
   - about-protected-branches: "By default, the restrictions of a branch protection rule don't apply to people with admin permissions to the repository".
   - REST, branch protection, `enforce_admins`: "Set to true to enforce required status checks for repository administrators."
   - REST, `required_approving_review_count`: "Use a number between 1 and 6 or 0 to not require reviewers."
   - about-rulesets: "They work alongside each other, and all applicable rules are enforced". Bypass covers only the actors a ruleset lists.
8. **Nothing runs the wallet's check on main.**
   - `web-wallet.yml:9-10` triggers on `pull_request:` alone.
   - `continuous-integration.yml` runs on a push to main, but its only job is `aiken fmt --check`, `aiken check -D` and `aiken build`.
9. **The owner's step as written.**
   - #331's body says: "After merging (yours): require **Web Wallet required** on `main`, under Settings → Branches → main → *Require status checks to pass*. "Require branches to be up to date" is already on."
   - It says nothing about bypassing.
   - `git grep` finds no mention of bypass or `enforce_admins` anywhere in the tree.

## The scratch check (it failed on the live settings, which is what the finding predicts)

This is a settings question, so no Vitest or Rust test can decide it. Instead, a read-only shell check in my scratchpad, `zz-review-v-pr331-0-trace-1.sh`:
- read the live protection;
- added "Web Wallet required" to the required contexts, as the owner's step does;
- asked whether the result binds an admin's merge, which needs either `enforce_admins` on or a ruleset requiring the check.

I deleted it after the run.

```
owner permission: admin
enforce_admins: false  status checks enforcement_level: non_admins
required approvals: 1  strict: true  required contexts today: []
repo rulesets: 0  ruleset rules requiring 'Web Wallet required' on main: 0
after the owner's step, required contexts: ["Web Wallet required"]
owner's self-authored PR needs the bypass for the review rule anyway: true
the required check binds an admin's merge after the step: false
FAIL: an admin's bypass still merges while 'Web Wallet required' is pending
exit=1
```

## Corrections to the finding

- **"A self-authored PR can never meet that rule" is too strong.** `quinn-logicalmechanism` has write access and could approve. That changes nothing in practice: no PR in the range has a review, and even an approved PR still offers an admin the bypass for a pending check while `enforce_admins` is off.
- **"Nothing runs on main to show it" is true of main itself, but there is a late signal.** The next PR that touches `seedelf-platform/` runs its check on its merge with main, so it would go red for the break it inherited. That signal comes late and points at the wrong PR.
- **Severity.** The harm is to the merge process.
  - #323's break was caught by the release review.
  - development.md's release procedure runs both `npm test` builds and `npm run e2e` on the release branch (§1), then e2e on the store package on main (§2).
  - So a red `main` reaches a user only if those gates are skipped too. That makes this low: a misleading doc, plus the owner's call on the settings.
- **Merge timing alone proves less than it seems.** Before the owner's step, no check was required, so merging mid-check needed no bypass for the check. What forced the bypass was the review rule. The finding's conclusion still holds, because a classic rule's bypass is all or nothing.

**The HEAD text that overstates:**
- `web-wallet.yml:3-5`: "always reports and main can require it (1.6.0's release review: #323 merged while its check was still running…)". This ties the requirement to stopping #323's mid-check merge.
- `web-wallet.yml:135`: "The one check main requires (its branch protection names *Web Wallet required*…". It isn't required today (contexts are `[]`), and once it is, it still won't bind the owner.
- `development.md:13`: "That job is the one `main`'s branch protection requires". Same problem.
- `post-release-roadmap.md:36`: "left, the owner's: requiring it." Requiring it alone isn't enough.

## Fix advice (the owner's call)

**Option (a) works:** required approvals 0, then "Do not allow bypassing the above settings", then require *Web Wallet required*, with "up to date" kept on. The REST docs confirm 0 approvals is allowed and that `enforce_admins` makes required checks bind admins. Three caveats:
- **Auto-merge** is off for the repo today, and turning it on is a repo setting. With "up to date" on, auto-merge lands a PR only while it's still up to date: GitHub doesn't update the branch for you. After any other merge, the PR needs *Update branch* and a fresh run of about an hour.
- **A merge queue** is the tool that lines PRs up without those manual updates, and this repo can have one (it's public and organization-owned). But `web-wallet.yml` would need a `merge_group:` trigger, and `changes` reads `github.event.pull_request.number`, which a merge_group event doesn't carry.
- **`enforce_admins`** also takes away the owner's emergency override on every other rule. A hotfix means turning it off for a moment.

**Option (b) works:** a branch ruleset on main that requires *Web Wallet required*, with an empty bypass list. Rulesets layer on top of the classic rule and "all applicable rules are enforced", so the classic review bypass no longer gets past the check.

**Option (c) shows the break; it doesn't prevent it.** Run the check on a push to main:
- `on: push: branches: [main]`
- `changes` must treat a push as `platform=true`. On a push, `pulls//files` fails, `changes` fails, and *Web Wallet required* goes red.

**Whichever the owner picks:**
- Fix the four lines above, in the same PR.
- If the owner keeps merging by bypass, development.md:15's "Merge only once its check is green" stays the only real gate. The docs should say that plainly.

**What it costs (my idea, the owner's call).** Under any enforced option, every PR waits about an hour, docs PRs included:
- `changes` counts everything under `seedelf-platform/`, docs too. #338 changed only `post-release-roadmap.md` and still ran the full check, 22:30:50 to 23:28:25.
- The only docs that anything in CI reads are under `docs/i18n` (`tests/i18n.test.ts:16`, `scripts/i18n-critical.mjs:63`). `words.test.ts` reads only `extension/src`, and `store-images.spec.ts` writes into `docs/store/images` but CI doesn't run it.
- So `changes` could skip the rest of `seedelf-platform/seedelf-web-wallet/docs/`, which would make an enforced check cheap for docs PRs.

## On #338 (the user's note)

#338 is docs only: `post-release-roadmap.md`, 6 lines in and 6 out. Merging it 33 minutes before its check finished put nothing at risk, and the check passed. It's still an instance of the pattern, and it shows the cost above: a docs PR runs the full hour-long check.
