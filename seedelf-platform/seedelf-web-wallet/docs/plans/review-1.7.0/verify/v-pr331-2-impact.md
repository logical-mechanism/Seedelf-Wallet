# v-pr331-2-impact: a base change leaves a stale skip-green

**Verdict:** partly. The mechanism is real: a base change runs nothing, and the last run's *Web Wallet required* stays on the head commit. But "a re-run doesn't help" is wrong for this workflow. And the gap can't change any merge today, or after the owner's step as roadmap item 2 words it: it bites only once the gate binds the merger (pr331's F1), and then only on a hand retarget, which none of the last 100 PRs had.

**Severity:** low, as filed. It's an edge case in a CI gate, with no path through the shipped build, and pr331's F1 dominates it. It doesn't block 1.7.0.

**Confidence:** high on the mechanism and on the re-run correction (GitHub's docs, the live API, a scratch repro). Medium on how GitHub breaks a tie between two same-named check runs, which matters only for the `edited` warning below.

## What holds

- **No event on a base change.** `web-wallet.yml:9-10` is `on:` / `  pull_request:`, with no `types`. GitHub's docs: "By default, a workflow only runs when a `pull_request` event's activity type is `opened`, `synchronize`, or `reopened`." The webhook docs file a base change under `edited`: "The title or body of a pull request was edited, or the base branch of a pull request was changed."
- **The result sits on the head SHA.** The check runs on #338's head `62be5bc4d688…` are `changes`, `check` and *Web Wallet required*, all in suite 110542431430, each with `head_sha` 62be5bc4. The run's own `head_sha` is the PR's head, not the merge commit. A retarget changes neither, so the old answer is what the merge box reads.
- **The decision depends on the base.** In a scratch repo (main → a with a `seedelf-platform/` change → b with only a `CLAUDE.md` line), the `changes` step, run verbatim with a fake `gh` that answers three-dot like the API, gives:
  - into a: `[CLAUDE.md]`, so `platform=false`;
  - into main: `[CLAUDE.md, seedelf-platform/…]`, so `platform=true`.
  - The `required` script, verbatim, on `success/false/skipped` exits 0. That's the stale green.
- **"Skipped counts as passing"** is GitHub's wording: "Required status checks must have a `successful`, `skipped`, or `neutral` status". So the finding's warning against an `if` that can skip `required` is right. HEAD's `required` has `if: always()` (`:143`).

## What doesn't: "a re-run doesn't help either"

- **`changes` reads the PR's files at run time.** `:25` `FILES: repos/${{ github.repository }}/pulls/${{ github.event.pull_request.number }}/files` and `:27` `files=$(gh api --paginate "$FILES" --jq '.[].filename')`. The number survives a retarget, and the API answers against the current base.
- **So *Re-run all jobs* decides again.** It gets `platform=true` and runs `check`. The pr331 report says as much in its own §5 ("while `changes` reads the PR's current files").
- **What a re-run does keep** is `GITHUB_SHA`: "The workflow will also use the same `GITHUB_SHA` (commit SHA) and `GITHUB_REF` (git ref) of the original event". So `check` tests the old merge commit, b into a.
- **In the finding's own scenario, that's the same tree.** `git merge-tree --write-tree` gives `a5f4d2c4…` for b into a, for b into main, and for `b^{tree}`. b contains a, and a contains main.
- **Only re-running *Web Wallet required* alone** reuses the stale `needs` and gives the stale answer.
- **A push, or a close and reopen, is still the cleaner advice:** it makes a fresh merge commit against the new base.

## Reachability

None of this is reachable through the shipped build. Only someone who can change a PR's base can reach it, and every precondition below has to hold:

1. **The gate must bind the merger.** Today it doesn't exist: `main`'s protection has `required_status_checks {strict: true, contexts: [], checks: []}`. Once required as item 2 says, it still doesn't bind the owner: `enforce_admins: false`, and GitHub says "By default, the restrictions of a branch protection rule do not apply to people with admin permissions". The pr331 report's F1 shows every merge in the range went through that bypass. Until F1's fix lands, a stale green changes nothing that the bypass doesn't already allow.
2. **A hand retarget to `main`.**
   - All 72 PRs after #266 targeted `main`.
   - GraphQL finds no `BaseRefChangedEvent` and no automatic base change on #238–#338. A control query of the same form returns #338's `MergedEvent`, so the empty answer is real.
   - No doc in the tree describes stacking or retargeting. development.md:12 says "Open PRs into `main`."
3. **The automatic retarget is safe.**
   - It needs the parent branch deleted, and `delete_branch_on_merge` is `false`.
   - After a merge-commit merge, which is the repo's practice (`6bca8bec` "Merge pull request #338"), the child's three-dot diff no longer holds the parent's commits, so the skip is right.
   - After a squash merge, `main` gains a commit the child lacks. Strict then forces an update, which pushes and runs afresh.
4. **`main` must not have moved** since the child's last push, or strict forces an update, and the update's push re-runs against `main`.
5. **The parent's `seedelf-platform/` change must be unchecked.** If PR a→main ran green on a's head, b's tree differs from a's only by files the check doesn't cover.

## The fix

**The finding's line is right, minimal and within the owner's rules.** It's a doc line, not a guard, and it's short. `reopened` and `synchronize` are both default types, so either makes a fresh run on the new merge commit. Suggested wording for development.md's *Branching*:

> Changing a PR's base runs nothing: close and reopen it, or push, so its check reads the new base.

Drop the finding's "a re-run doesn't help". It's true only for re-running *Web Wallet required* alone.

Word it together with F6 and F1 (pr331 report), which rewrite the same line, development.md:13. That line says "That job is the one `main`'s branch protection requires", which is untrue today.

**If the owner prefers a mechanism over a rule to remember,** two lines in `changes` close the skip-green hole:

```yaml
          BASE: ${{ github.event.pull_request.base.ref }}
        run: |
          files=$(gh api --paginate "$FILES" --jq '.[].filename')
          if [ "$BASE" != main ] || grep -q -E '^(seedelf-platform/|\.github/workflows/web-wallet\.yml$)' <<<"$files"; then
```

- **Ran verbatim in the scratch repo:**
  - into a gives `platform=true`;
  - into main gives `platform=true`;
  - a `CLAUDE.md`-only PR into main gives `platform=false`.
- **A PR into any other branch runs the full check,** so whatever survives a retarget to `main` is a real check, never a skip. That costs nothing in this repo's practice.
- **Line 13 and the comment at `:13-14`** would gain "or isn't into `main`".
- **What's left** is the generic staleness of a check that ran against the old base. Under strict, with the head up to date, that's the same tree (shown above).

**Never take the finding's second option half-way.** Adding `edited` and re-running fully on every edit is correct, but each title or body edit then re-runs the hour-long check and holds the required check pending meanwhile. Cheapening it with an `if` breaks the gate:

- **Gate `changes` on `github.event.changes.base`,** and a body edit skips it. `required` then sees `CHANGES=skipped` and exits 1 (run verbatim), so every body edit turns a green PR red.
- **Gate `required` too,** and it reports *skipped*, which passes, so a body edit turns a red PR mergeable. I'm assuming, from how re-runs behave, that GitHub reads the latest check run of a name on the head.

## Runs

These ran in the scratchpad, outside the tree, and are now deleted (`…/scratchpad/review/v-pr331-2-impact/`).

- **The `changes` step** (`web-wallet.yml:27-32`) and **the `required` step** (`:151-155`), extracted with `sed` and run under `bash -e`.
- **A fake `gh`** that prints `git diff --name-only <PR base>...web-wallet/b`.
- **Results:**
  - base a: `platform=false`; base main: `platform=true`.
  - `required`:
    - `success/false/skipped`: exit 0
    - `skipped/''/skipped`: exit 1
    - `success/true/success`: exit 0
    - `success/true/failure`: exit 1
  - The trees of b into a, b into main and `b^{tree}`: all `a5f4d2c4b21e06944eecf3012b7d30588eaf7384`.
  - The base-aware variant: a: `true`, main: `true`, a `CLAUDE.md`-only PR into main: `false`.

**Read-only GitHub:**
- `branches/main/protection`
- `rulesets` and `rules/branches/main`: both empty
- the repo's settings
- `pulls?state=all`
- GraphQL `timelineItems` for base-change events on the last 100 PRs
- the check runs on #338's head and the last six Web Wallet runs

**GitHub docs read:** *Events that trigger workflows* (`pull_request`), *Webhook events* (`pull_request`, `edited`), *Re-running workflows and jobs*, *About protected branches*.

## Not checked

- **No live retarget.** I didn't retarget a real PR, which would write to the repo. That a retarget leaves the head's check runs as they were rests on the docs (no event) and on check runs being keyed to the head SHA.
- **How GitHub picks between two same-named check runs** from different workflow runs on one head. It matters only for the gated-`edited` warning.
