# v-pr331-2-trace: pr331#2, a base change after a skip-green

**Verdict: confirmed. Severity: low.**

The finding's title, mechanism and scenario hold on HEAD (`6bca8bec`). Three corrections:

- **The re-run sentence is wrong for the finding's own scenario.** In that scenario, a full re-run would check exactly the tree that merges.
- **The gate isn't on yet.** `main`'s protection requires no checks today, so this is a hole in the gate as #331 designed it, not in today's behaviour.
- **#331 made nothing worse.** The old `paths`-filtered trigger didn't run on a base change either.

## The path on HEAD

1. **The trigger.** `.github/workflows/web-wallet.yml:9-10` is `on:` / `  pull_request:`, with no `types`.
   - GitHub's docs (events-that-trigger-workflows, `pull_request`): "By default, a workflow only runs when a `pull_request` event's activity type is `opened`, `synchronize`, or `reopened`."
   - The webhook docs describe `edited` as "The title or body of a pull request was edited, or the base branch of a pull request was changed." `synchronize` is only "A pull request's head branch was updated."
   - So a base change fires `edited`, and nothing runs.
2. **The skip decision depends on the base.**
   - `:25` reads `FILES: repos/${{ github.repository }}/pulls/${{ github.event.pull_request.number }}/files`, and `:27` reads `files=$(gh api --paginate "$FILES" --jq '.[].filename')`. That is the PR's diff against its base at that moment.
   - `:36`: `if: needs.changes.outputs.platform == 'true'`.
   - `:143` (`if: always()`) and `:154` (`if [ "$CHECK" = skipped ] && [ "$PLATFORM" = false ]; then exit 0; fi`) turn a skip into green.
3. **The green sits on the head commit.** The check runs land on the PR's head SHA, not the merge commit:
   - #338's head `62be5bc4` carries `Web Wallet required  success  62be5bc4d6  github-actions`, and so does #331's head `c5d19d3f`.
   - GitHub (troubleshooting required status checks): "Required checks must pass on the latest commit SHA."
   - A base change doesn't move the head, so the old green still satisfies the requirement.
4. **The up-to-date rule doesn't catch it.** `main`'s protection (`gh api .../branches/main/protection`) has `required_status_checks: {strict: true, contexts: [], checks: []}`. Strict mode asks only that `main`'s head is in the PR's head, which holds in step 4.

## Scratch test

The scratch test was `extension/tests/zz-review-v-pr331-2-trace-1.test.ts`, run alone and since deleted. It does two things:

- It extracts the workflow's own `changes` and `required` scripts from the YAML and runs them in bash, with a fake `gh` that prints the PR's files.
- It builds the scenario in a throwaway git repo outside the tree:
  - `main` has one commit.
  - `a` adds `seedelf-platform/x.rs`.
  - `b` is cut from `a` and adds `CLAUDE.md`.
  - Three-dot diffs stand in for the files API.

Result: 6 tests, 5 passed, and 1 failed, the one built to fail if the finding is real.

- **The scripts are real.** The `required` step is red for a failed check, and red for a skip when platform is true.
- **The trigger has no `types`.**
- **Step 2.** `a...b` gives `[CLAUDE.md]`, so the step outputs `platform=false` and `required` exits 0 (green).
- **Steps 3–4.** `main...b` gives `[CLAUDE.md, seedelf-platform/x.rs]`, so the step outputs `platform=true`. `git merge-base --is-ancestor main b` gives 0, so strict mode passes.
- **The re-run** (see Corrections). The step outputs `platform=true` from the live list. `merge-tree a b` equals `merge-tree main b` equals `b^{tree}`.
- **FAILED, as designed:** "the standing result is the one the PR's current base calls for": `expected 'platform=false' to be 'platform=true'`.

## Corrections to the finding

- **"A re-run doesn't help either" is wrong in the scenario as written.**
  - `changes` uses the event payload only for the PR number. It asks the API for the files live, so "Re-run all jobs" recomputes `platform=true` against `main` and runs `check`.
  - That run is on the original `GITHUB_SHA` (`b` merged into `a`). Re-run docs: "The workflow will also use the same `GITHUB_SHA` … and `GITHUB_REF` … of the original event".
  - In the scenario, `b` contains `a`'s head and `main`'s head, so the old merge tree is `b`'s tree, the same as `b` merged into `main` (the scratch test shows it).
  - So a re-run checks exactly what merges. It goes stale only when `a`, at the time of the event, had commits `b` lacked.
  - The finding's recommendation (close and reopen, or push) is still the better instruction, since either one tests a fresh merge commit.
- **The gate is latent today.**
  - `contexts: []` and `checks: []`: *Web Wallet required* isn't required yet. That is the owner's step left in roadmap item 2, which is 🚧 on HEAD.
  - `enforce_admins: false`.
  - Until the owner adds the check, nothing is required at all, base change or not. The harm once it's on is a misleading green: a `seedelf-platform/` change reaches `main` unchecked, as #323's did.
  - The next PR that touches `seedelf-platform/` (a release PR always does) would run the full check on the merged tree, so it wouldn't reach the store unseen.
- **Likelihood is low, as the finding says.**
  - No PR from #266 on has a non-`main` base (`gh api pulls?state=all`, 234 rows).
  - The only base change in the repository's history is #82, on 2025-01-12, from `main` to `dapp-integration` (GraphQL `BaseRefChangedEvent`).
  - GitHub's own auto-retarget, when a merged PR's base branch is deleted, is benign here. `a`'s PR ran the full check, and with merge commits `b`'s files against `main` are then `[CLAUDE.md]`, which is correct.
- **This is not a regression.** Before #331, a `paths`-filtered `pull_request` on default types didn't run on a base change either, and no check was required.

## Fix advice

- **The finding's doc line works.** Add to development.md's *Branching*: "after changing a PR's base, close and reopen it (or push) so its check runs against the new base."
- **A cheaper code fix that closes the skip-specific hole: make the skip decision safe for a non-`main` base.**
  - In `changes`, add `BASE: ${{ github.event.pull_request.base.ref }}` to the env.
  - Output `platform=true` when `[ "$BASE" != main ]`, or when the grep matches.
  - Cost: nothing in the usual flow (no non-`main` base since #266). The standing result for a PR into another branch is then a full check of `b` merged into `a`. That is `b`'s tree whenever `a`'s head is in `b`, the same tree that merges into `main` under strict mode.
  - What's left is GitHub's general per-head-SHA behaviour, which the doc line covers.
  - Change development.md:13's "Its check runs when the PR touches `seedelf-platform/` or the workflow" to match.
- **Don't add `edited` with a job-level `if`.**
  - Skipping only `changes` and `check` on a body edit makes `required` see `CHANGES=skipped`, so it fails: a green PR turns red.
  - Skipping `required` too reports "Success": "The job reports 'Success'" (GitHub, troubleshooting required status checks), so a red PR turns green.
  - With `edited`, the whole decision must run on every edit: the 1 h cost the finding names.

Confidence: high on the mechanism. The GitHub-side behaviour is from GitHub's docs, and is consistent with the check runs observed on #331 and #338.
