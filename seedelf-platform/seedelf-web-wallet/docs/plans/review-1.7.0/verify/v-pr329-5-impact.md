# v-pr329-5-impact: pr329#5, impact and the fix

**Finding:** `development.md:13` and `web-wallet.yml:135` say `main`'s branch protection requires *Web Wallet required*. It requires no check. (pr329 rated it low. The report numbers it 6.)

**Verdict:** confirmed. **Severity: low**, at the bottom of low. It's a false statement in a contributor doc and a CI comment, and it contradicts item 2. Nothing shipped is affected. The fix is right, but one wording change makes it hold whether or not the owner turns the check on.

**Duplicate:** pr331 F6 found the same defect and rated it a nit. Fold the two into one finding.

## What holds (HEAD `6bca8bec`, and the live settings)

- **The two lines state it as fact:**
  - `docs/development.md:13`: "That job is the one `main`'s branch protection requires, so no path filter can leave a PR waiting on a check that never comes (1.7.0)."
  - `.github/workflows/web-wallet.yml:135–136`: "The one check main requires (its branch protection names *Web Wallet required*; data-layer.yml's job is called `check` too, so not that name)."
- **Both came from #331** (`git diff 3b32b92e^1 3b32b92e`).
  - #331's own description leaves the step to the owner: "**After merging (yours):** require **Web Wallet required** on `main`…".
  - So does the roadmap's item 2 (`post-release-roadmap.md:36`): "left, the owner's: requiring it".
  - So does the workflow's header (`web-wallet.yml:3–4`): "main can require it".
  - `git grep` finds no other line that claims it.
- **Nothing requires the check, by either mechanism** (read-only `gh api`, live):
  - The classic protection: `"required_status_checks":{"strict":true,"contexts":[],"checks":[]}`, `required_approving_review_count: 1`, `enforce_admins: false`.
  - `repos/…/rulesets?includes_parents=true` → `[]`.
  - `repos/…/rules/branches/main` → `[]`. This endpoint returns every active rule on the branch, an organisation's included.
- **No memory note or handoff says the owner turned it on**, or decided against it.

## Can it happen in practice?

**Scenario A holds: the release record closes item 2 falsely.**
- The release-prep docs commit sets the 1.7.0 list's ticks (pr329#0).
- Item 2 links to `development.md#branching`, which says the protection already requires the job.
- A session that follows the link and believes it ticks item 2 ✅. The owner's step, the purpose of Session 12's call 6 after #323's red merge, then drops silently while the record says `main` is guarded.
- That's a misleading doc with a concrete wrong outcome, which is low on the brief's scale.

**Scenario B can't change a merge today.**
- Every PR from #325 to #338 was merged by `logicalmechanism`, with 0 reviews.
- With one approval required and `enforce_admins` off, every merge already uses the admin bypass. That bypass skips required checks too (finding 2, and pr331 F1).
- Nobody without the bypass merges. And `development.md:15` still says "Merge only once its check is green on every step".

**No user, site or attacker can reach it.** Neither file is in the store build, and no test or script reads either line (`git grep` over `extension/tests`, `scripts`, `e2e` and `.github`).

## The fix

**Rewording (the first option) is right, minimal and docs only.** It touches no guard, no privacy note, no date and no store status. One refinement:
- "is to require … (the owner's step) until the owner turns it on" needs a second edit when the owner turns it on, or it goes stale the other way.
- Instead, word it by its purpose. That's true in both states, and the status stays in item 2 alone:
  - `development.md:13`: "That job is the one for `main`'s branch protection to require (1.7.0's item 2), so no path filter can leave a PR waiting on a check that never comes."
    - Drop the trailing "(1.7.0)", since the item now names it.
  - `web-wallet.yml:135–136`: "The one check for main to require, by this name (data-layer.yml's job is called `check` too, so not that one)."
    - This matches the header's "main can require it".
- **Put it in the release-prep docs commit.**
  - Editing `web-wallet.yml` sends its PR down the full check path, since `changes` matches the file itself.
  - That commit touches `seedelf-platform/` anyway, so the edit costs no extra run.
- `development.md#branching`'s anchor is unchanged.

**Turning it on (the second option) also makes the words true, with no edit.** If the owner adds the check before packaging, both lines stand as written. Three caveats:
- **Don't strengthen any line to "main refuses a red PR".** The owner's bypass still skips the check (finding 2).
- **Strict mode starts to apply.** *Require branches to be up to date* is already on but does nothing while no check is required. Once one is, it bites on any merge that doesn't bypass. If finding 2's fix also closes the bypass, the release's PRs merge one at a time: each is updated with `main` and waits for its own check. Those runs took 40 to 60 minutes each in this range (`gh run list --workflow web-wallet.yml`, #329 to #338).
- **The skip path has never run on GitHub.** Every PR since #331 touched `seedelf-platform/` (pr331's *Not checked*). The first PR outside it is that path's first live run.

## Trace

- Reads of `development.md:1–30`, `web-wallet.yml:1–60` and `:120–155`, and `post-release-roadmap.md:25–50` on HEAD.
- `git diff 3b32b92e^1 3b32b92e`, and `gh pr view 331`.
- `git grep` for the protection and required-check wording, repo-wide.
- `gh api` GETs only: the classic protection and its `required_status_checks`, the repository's rulesets and the branch's effective rules. The organisation's rulesets returned 404 (the token lacks `admin:org`), but the branch's effective rules already cover them.
- `gh pr view` of #325–#338: who merged each one, and its review count.
- `gh run list --workflow web-wallet.yml`: the runs' start and end times.
- Searched the memory notes for "protection", "required" and "bypass".
- No scratch test was needed, and no file was created besides this report.

**Confidence:** high.
