# v-pr331-6-trace: pr331#6 (the report's F7), a PR that edits `web-wallet.yml` decides its own *Web Wallet required*

**Verdict: partly. Severity: nit.**

**The mechanism is real, and this repo's own runs prove it.** But the scenario as written is the loud case: `check` shows red on the PR, and development.md:15's existing rule already stops a hand merge of it.

The case the proposed reading rule is really for is a different one. A PR can edit `changes`' grep or `check` itself so that `check` is skipped or does nothing, and leave `required` alone. HEAD's own gate then goes green and nothing on the PR shows red.

It isn't new in #331, and nothing is required on `main` today. Auto-merge is off, the repository has no forks, and no fork has ever opened a PR.

## The mechanism, from this repo's own runs (read-only `gh`)

- **Run 40725597266** (*Web Wallet*, event `pull_request`, `.github/workflows/web-wallet.yml`) was created at 16:24:08Z on #331's head, `c5d19d3f`. It ran three jobs, all in check suite 110389822105:
  - `changes`, 16:24:11 to 16:24:15;
  - `check`, 16:24:17 to 17:21:57;
  - `Web Wallet required`, 17:22:00 to 17:22:03.
- **At 16:24:08Z, `main` was `81397dc4`** (#330, merged 16:22:21Z). Its `web-wallet.yml` has the workflow-level `paths:` filter (line 5) and a single job, `check:` (line 10). `changes:` and `required:` existed only on the PR's branch (`c5d19d3f`: lines 15, 34 and 140-141) until `3b32b92e` merged it.
- **So the run's jobs came from the PR's own copy of the workflow.** A PR can rewrite any of its jobs, `required` included.
- **Forks:** the repository is `public`, with `allow_forking: true` and `approval_policy: first_time_contributors`.
  - A first-time contributor's run waits for the owner's approval, and the check stays pending until then.
  - Once approved, or straight away for a returning contributor, it runs the fork's copy.
- **Nothing outside the PR pins the gate:**
  - `gh api …/rules/branches/main` is `[]`, so no rule is active at any level.
  - `…/rulesets` is `[]`.
  - No CODEOWNERS file is tracked.

## The trace (scratch, deleted)

**The setup:** HEAD's `changes` script (`web-wallet.yml:27-32`) and `required` script (`:151-155`), verbatim, run under `bash -e` as the runner runs them. A fake `gh` answers with the scenario's files: `seedelf-platform/seedelf-core/src/build.rs` and `.github/workflows/web-wallet.yml`.

| Case | What the PR does | Result |
|---|---|---|
| A | Nothing to the workflow; seedelf-core broken | `platform=true`; with `CHECK=failure`, `required` exits 1. HEAD's gate is right. |
| B | The finding's scenario: `required`'s script is `exit 0` | exit 0 with `CHECK=failure`. `check` still runs and fails, because the grep at `:28` matches the workflow file. |
| C | Changes only the grep at `:28`, to `^(seedelf-platform-x/)`; `required` untouched | `platform=false`, so `check` is skipped (`if: needs.changes.outputs.platform == 'true'`), and HEAD's own `required` exits 0 (`success / false / skipped`). |

## Where the finding is narrower or different

1. **The scenario is the loud case.**
   - In B, `check`'s red X is on the PR and in the merge box.
   - development.md:15 already says "**Merge only once its check is green on every step,** never while it's still running", which stops a hand merge of exactly this PR.
   - Only auto-merge would merge it unseen, since auto-merge waits on required checks alone. Auto-merge is off (`allow_auto_merge: false`). F1's fix (a) suggests turning it on: if the owner does, B merges by itself once auto-merge is enabled on the PR.
2. **The quiet case is what the reading rule is for, and the finding doesn't name it.**
   - In C, every job is green or skipped, and "green on every step" holds.
   - The same goes for `|| true` added to a step, or a step deleted.
   - `required` is never touched in any of these.
3. **It isn't new in #331.**
   - Before #331, the PR's own copy of `check` decided the only check there was, and nothing was required.
   - #331 adds a gate with the same property. It doesn't create the property.
4. **It's a rule for a later state.**
   - Today `required_status_checks` has `contexts: []` and `checks: []`.
   - `forks_count` is 0.
   - The collaborators are `logicalmechanism` (admin) and `quinn-logicalmechanism` (write).
   - The last 60 PRs are all the owner's, from the repository's own branches.
   - For a fork PR, the owner can give the one required approval, since they aren't its author. So once the check is required, a fork PR merges through the rule, not the admin bypass, and the scenario's "enforced rule" doesn't depend on F1's fix.

## Fix advice

- **Keep the documentation line, worded for the whole check rather than `required` alone,** under development.md:15. For example:

  > A PR that touches `.github/workflows/` runs its own copy of them: its green, *Web Wallet required* included, means nothing until that diff is read.

- **If auto-merge is ever turned on:** read that diff before enabling auto-merge on such a PR.
- **There's no code fix.**
  - `pull_request_target` would run `main`'s copy, but `check` has to build the PR's code. Doing that with a write token and secrets is the known unsafe pattern.
  - A gate pinned outside the PR would take a ruleset that requires a workflow from a fixed ref. I haven't checked whether this account can have one.

## Not checked

- **How GitHub breaks a tie between two check runs named *Web Wallet required*.** A PR could add a second workflow with that job name. The documentation line's `.github/workflows/` covers it either way.
- **How the merge box looks when only a check that isn't required fails.** This is from GitHub's docs, not tried on this repository.
