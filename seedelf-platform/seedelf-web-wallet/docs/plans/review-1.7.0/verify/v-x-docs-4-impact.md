# v-x-docs-4-impact: x-docs#4, impact and the fix

**Verdict: confirmed. Severity: low** (the same as the finding's). **Confidence: high.**

The claim is true on HEAD (`6bca8bec`). It affects only the release procedure: nothing reaches the shipped build. The finding's first fix is right. Its second fix ("the owner requires the check") would make the lines literally true. It would not stop what the finding is worried about, because every merge into `main` already bypasses its protection.

## The facts

- `docs/development.md:13`: "That job is the one `main`'s branch protection requires, so no path filter can leave a PR waiting on a check that never comes (1.7.0)."
- `.github/workflows/web-wallet.yml:135`: "# The one check main requires (its branch protection names *Web Wallet". The top comment (:3–8, "main can require it") is accurate. Only :135 is wrong.
- `gh api repos/logical-mechanism/Seedelf-Wallet/branches/main/protection` (read-only):
  - `required_status_checks`: `{"strict": true, "contexts": [], "checks": []}`
  - `required_pull_request_reviews.required_approving_review_count`: 1
  - `enforce_admins.enabled`: false
- No repository rulesets exist (`/rulesets` and `/rules/branches/main` both return `[]`).
- `strict` has no effect while no check is required.
- `post-release-roadmap.md:36` is right: "left, the owner's: requiring it."
- #331's own description is right too: "**After merging (yours):** require **Web Wallet required** on `main`".
- No other file makes the claim (`git grep`).

## Is it reachable?

**Not for a user.** The store zip is `dist/` alone (`scripts/package.mjs:116-118`). Neither file ships.

**For a reader, yes.** CLAUDE.md sends readers to `development.md` for the release procedure. Someone who trusts :13 would believe:
- GitHub holds a PR until *Web Wallet required* is green.
- With `strict` on, every merge was checked up to date with `main`, so `main` has been CI-tested as a whole.

Both are false. The second is exactly what this brief says isn't so ("never CI-tested as one").

**The hazard happened in this range.** All nine of #330–#338 merged while their Web Wallet check was still running. The times below are check-run start and finish times on each PR's head SHA. #338 is the docs-only PR the user mentioned: it touches `seedelf-platform/`, so it ran the full check too.

| PR | check started | merged | check finished |
|---|---|---|---|
| #330 | 16:00:10 | 16:22:22 | 16:58:35 |
| #331 | 16:24:17 | 16:26:02 | 17:21:57 (*required* 17:22:03) |
| #332 | 16:24:30 | 16:25:43 | 17:23:49 |
| #333 | 16:47:11 | 17:14:44 | 17:27:32 |
| #334 | 16:50:19 | 17:13:35 | 17:42:09 |
| #335 | 17:03:11 | 17:14:00 | 18:02:53 |
| #336 | 17:59:44 | 18:30:13 | 18:39:08 |
| #337 | 18:15:56 | 18:30:28 | 19:14:32 |
| #338 | 22:30:50 | 22:55:43 | 23:28:25 |

Every one of these checks passed on its own branch, so no harm came of it. The combined tree is still checked only by the release PR's own run.

## Severity

**Low.** The brief's scale puts "a misleading doc" at low.
- No money, privacy, user or store-build impact.
- It doesn't block the release.
- The procedure's real gate is a rule the reader is told directly: :15, "Merge only once its check is green on every step". The false line doesn't change that rule.
- Not a nit: it is a false statement about a release safeguard, not wording.

## The fix

**Option A, edit the two lines: right and minimal.** One improvement: drop "(1.7.0's item 2)" and use wording that stays true before and after the owner's step, so ticking item 2 needs no second edit.
- `development.md:13`: "That job is the one for `main`'s branch protection to require, so no path filter can leave a PR waiting on a check that never comes (1.7.0)."
- `web-wallet.yml:135-136`: "# The one check for main to require, by this name (data-layer.yml's job is called `check` too, so not that name)."
- Change only the comments. `name: Web Wallet required` must stay exactly as it is: renaming it after it's required would hold every PR, which is the comment's own warning (:8).

**Option B, the owner requires the check: makes the lines true, but holds nothing in practice.**
- All 15 PRs in the range (#324–#338) were opened and merged by `logicalmechanism`, with `reviewDecision=REVIEW_REQUIRED` and no reviews.
- `main` requires one approval, `enforce_admins` is off, and that account has `admin: true`. So every merge was an admin bypass ("Merge without waiting for requirements to be met", or `gh pr merge --admin`).
- That one bypass skips every unmet requirement at once, required checks included. With the check required, #330–#338 would have merged exactly as they did.
- To make the check actually hold a PR, the owner would need "Do not allow bypassing the above settings" and an approval count a single maintainer can meet (0). With `strict` on, each PR would then re-run up to date with `main` before it merges: about 40–60 minutes each, by these runs.
- **That is an owner's call, and my idea, not part of this fix.** Until then, :13 should not suggest that GitHub enforces anything.

**What either change affects:**
- The PR that carries the edit touches the workflow and `seedelf-platform/`, so it runs the full check, e2e included. Nothing else changes.
- No test reads these lines. `tests/live-runs-copy.test.ts` and `scripts/dreps.mjs` cite other sections of `development.md`.
- The `#branching` anchor that roadmap item 2 links to is unchanged.
- No i18n, words, privacy-policy or date rule is involved.

No scratch files were made.
