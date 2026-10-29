# v-x-docs-4-trace: x-docs#4, the protection the docs say main has

**Verdict: confirmed. Severity: low** (the same as the finding's). **Confidence: high.**

I tried to refute it three ways. All three failed:
- a ruleset might require the check where the classic protection doesn't;
- the two lines might be conditional;
- the lines might have changed after #331.

Two lines on HEAD say, in the present tense, that `main`'s protection requires *Web Wallet required*. Nothing on `main` requires any status check: neither the classic protection nor any ruleset. The scenario isn't hypothetical either. Every PR from #330 to #338 merged while its own check was still running.

## The lines (HEAD `6bca8bec`)

- `docs/development.md:13`: "That job is the one `main`'s branch protection requires, so no path filter can leave a PR waiting on a check that never comes (1.7.0)."
- `.github/workflows/web-wallet.yml:135-136`: "# The one check main requires (its branch protection names *Web Wallet # required*; data-layer.yml's job is called `check` too, so not that name)."
- **Both lines are still #331's own.** `git blame` gives `c5d19d3f9` (#331's head) for all three lines: dev :13, yml :135 and roadmap :36. `git diff 3b32b92e 6bca8bec` on the two files is empty. #338, the user's docs PR, touches `post-release-roadmap.md` alone (6+/6−, item 8).
- **The other mentions are right:**
  - `web-wallet.yml:3-4` is conditional: "always reports and main can require it". That's true.
  - `post-release-roadmap.md:36`: "The job is in (...); left, the owner's: requiring it."
  - #331's own description: "**After merging (yours):** require **Web Wallet required** on `main`, under Settings → Branches → main → *Require status checks to pass*."

  So one commit wrote "requires" in two places and "left, the owner's: requiring it" in a third.
- `git grep` over HEAD (outside `docs/archive`) finds no other line making the claim.

## The settings (read-only `gh api` GETs)

- **Classic protection** (`branches/main/protection`):
  - `"required_status_checks":{"strict":true,"contexts":[],"checks":[]}`
  - `"required_approving_review_count":1`
  - `"enforce_admins":{"enabled":false}`
- **Branch summary** (`branches/main`): `"required_status_checks":{"checks":[],"contexts":[],"enforcement_level":"non_admins"}`.
- **Rulesets, my refutation attempt.** The finding checked only the classic endpoint. All three ruleset queries come back empty:
  - `rulesets` returns `[]`.
  - `rulesets?includes_parents=true` returns `[]`.
  - `rules/branches/main` returns `[]`. That endpoint lists every active rule on the branch, at whatever level it was set.
  - `orgs/logical-mechanism/rulesets` needs `admin:org`, but the two endpoints above already cover org rules that apply here.
- **Nothing requires a status check on `main`.** The `strict: true` setting therefore holds nothing either. #331's head `c5d19d3f` lacks #332's merge, which landed 19 s earlier, and #337's head `aa6f5fc2` lacks #336's merge, which landed 15 s earlier (`git merge-base --is-ancestor`).

## The scratch check (failed on HEAD, as the finding predicts)

No Vitest or Rust test can decide a GitHub setting. So I wrote a read-only shell check in my scratchpad, `scratchpad/review/v-x-docs-4-trace/zz-review-v-x-docs-4-trace-1.sh`. It reads the two lines from `6bca8bec` with `git show`, then reads the required contexts from the classic protection and from `rules/branches/main`. It fails if a line claims the requirement and neither source has *Web Wallet required*. I deleted it after the run.

```
development.md:13 says: the job is the one main's branch protection requires
web-wallet.yml:135 says: the one check main requires, its protection names it
classic required checks: []; ruleset required checks: []; enforce_admins: false
FAIL: 2 line(s) claim a requirement main's protection doesn't have
exit=1
```

## The scenario happened in this range

The workflow's runs are all `run_attempt` 1, with no re-runs. I compared each PR's `mergedAt` with the `check` job on its final head SHA and found the step running at the merge:

| PR | check job | merged | running at the merge |
|---|---|---|---|
| #330 | 16:00:10 to 16:58:35 | 16:22:22 | Extension unit tests |
| #331 | 16:24:17 to 17:21:57 | 16:26:02 | Rust tests (its earlier head's run was also still going) |
| #332 | 16:24:30 to 17:23:49 | 16:25:43 | Rust tests (its earlier head's run was also still going) |
| #333 | 16:47:11 to 17:27:32 | 17:14:44 | Extension end-to-end |
| #334 | 16:50:19 to 17:42:09 | 17:13:35 | Extension unit tests (preprod-only build) |
| #335 | 17:03:11 to 18:02:53 | 17:14:00 | Extension unit tests |
| #336 | 17:59:44 to 18:39:08 | 18:30:13 | Data layer end-to-end |
| #337 | 18:15:56 to 19:14:32 | 18:30:28 | Extension unit tests |
| #338 | 22:30:50 to 23:28:25 | 22:55:43 | Extension unit tests (preprod-only build) |

- **Earlier in the range:** #326, #328 and #329 merged mid-check too. Only #325 waited (finished 17:16:56, merged 17:36:00). #327 had no Web Wallet run.
- **Every run ended `success`.** Nothing red was merged, but no PR from #326 on waited for its check. That is what `development.md:15` rules out ("never while it's still running").
- **A reader who trusts :13 believes GitHub held those merges.** It didn't.

## Correction to the fix

**The finding's first option is right.** Word both lines as the job for `main`'s protection to require. Its suggested text, "the one for `main`'s protection to require (1.7.0's item 2)", works.
- Only the comment at yml :135-136 changes. `name: Web Wallet required` (:141) must stay exactly as it is.

**Its second option makes the lines true but doesn't make them hold.** That option is "the owner requires the check, and the item and both lines then agree".
- All of #325 to #338 show `reviewDecision: REVIEW_REQUIRED` with 0 reviews, merged by `logicalmechanism` (admin). With `enforce_admins` off, each merge was therefore an admin bypass of the one-approval rule.
- `enforcement_level: non_admins` is GitHub saying that required checks bind non-admins only. The same bypass would skip a required *Web Wallet required*.
- For the requirement to hold a PR, the owner would also need "Do not allow bypassing the above settings", with approvals at 0 (or a second reviewer), or a ruleset with an empty bypass list. That is the owner's call, and my idea.

**This overlaps pr331#0** (`verify/v-pr331-0-trace.md`), which covers the same bypass and the same two lines. Fix them in one PR.

## Scratch files

- None in the tree.
- The scratchpad script and its folder are deleted.
