# The ci lane's report (1.7.0's release review)

**One file changed:** `W/.github/workflows/web-wallet.yml` (+25 −6). Nothing else, and `data-layer.yml` is untouched.

**Still a job that always reports:**
- `on: pull_request` has no filters or types.
- `required` keeps `if: always()`, `needs: [changes, check]` and its script, byte for byte.
- Its decision table passes 18 of 18, before and after.

## How it was tested (Actions can't run here)

**The scratch test:** `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/ci-lane/test_web_wallet_ci.py`
- Run it with `…/ci-lane/venv/bin/python -I …/ci-lane/test_web_wallet_ci.py <workflow.yml>`.
- It takes the `changes` step's script and the `required` job's script from the YAML, verbatim.
- It runs them under both shells GitHub uses on Linux: `bash -e {0}` (no shell named, this workflow's case) and `bash --noprofile --norc -eo pipefail {0}`.
- A fake `gh` (`…/ci-lane/fake-gh/gh`) pages fixture rows through the real `jq`, one page at a time, as `gh --jq` does. The rows have the PR files API's shape, as on #329 (a rename is one row with `previous_filename`).
- It also checks the YAML's structure: the token, the checkout, and the always-reports shape.

**Before and after:**
- **HEAD's copy** (`…/ci-lane/web-wallet.HEAD.yml`): 62 pass, 16 fail. The 16 are exactly the defect cases below, each failing for the finding's reason (platform=false where the check must run, no `per_page`, no top-level `permissions`, no `persist-credentials`).
- **The fixed file:** 78 of 78 pass. That includes 36 controls that held before and still hold: skips, runs, anchoring, deletions, paging, paths with spaces, and a failed lookup failing the step.
- **Mutation checks** (`…/ci-lane/mutants/`): undoing each piece of the fix in a copy turns its own group red and nothing else. The seven pieces are: the old path, the base rule, the count rule, counting paths instead of rows, `per_page`, the top-level token, and `persist-credentials`.
- **The real `gh` (gojq), read-only:** the fixed step run verbatim against #329, #327, #324 and #321 matches an independent jq answer on all four.

**Linters:**
- The YAML parses (PyYAML 6.0.3).
- `actionlint` 1.7.7 with `shellcheck` 0.10.0 is clean. HEAD had one SC2153 note, from the env `FILES` beside the local `files`. It's gone, because the local is now `rows`/`paths`.
- All three were installed in a scratchpad venv, since none was on the box.

## Findings

### pr331#1: a rename out of seedelf-platform/ skipped the check (low): **fixed**
- **The fix:** the step now reads `previous_filename` as well, using `.[] | [.filename, (.previous_filename // empty)] | @tsv`, then splits the tab.
- **Test:** group pr331#1, 3 cases × 2 shells:
  - the scenario's move of the core vectors to `fixtures/`;
  - renaming the workflow itself;
  - an old path holding a tab.
  - All were platform=false on HEAD and are true now.
- **Left:** the grep still names `web-wallet.yml` literally. A PR that renames the workflow now runs the check, but it must also update that path, or later edits to the renamed file skip. Unchanged; a renamer would grep for it.

### pr331#2: a change of base re-ran nothing, so a skip-green from the old base stood (low): **fixed in the workflow**
- **The fix:** a PR whose base isn't `main` now always runs the check (`[ "$BASE" != main ]`, with `BASE` taken from `github.event.pull_request.base.ref` through `env`). No skip-green computed against another base can survive a retarget to main.
- **Cost:** none in practice. Every PR since #266 targeted main.
- **Test:** pr331#2, "b into a (only CLAUDE.md against a) runs the check", ×2 shells. It was false on HEAD and is true now.
- **Left:** after a retarget, the run that stands is the one on the merge into the old base. That differs only if the old base had commits the head lacks. The doc line below is optional.

### pr331#3: a write-all token, persisted in .git, while check runs every dependency's code (low): **fixed**
- **The fix:**
  - a top-level `permissions: contents: read`, so `check` and `required` get read-only (`changes` keeps its own `pull-requests: read`);
  - `with: persist-credentials: false` on check's checkout, with the data layer's comment.
- **Nothing in `check` needs the token:**
  - no `gh` or networked git in `wasm/build.sh`, `scripts/*.mjs` or the npm scripts;
  - no git-sourced crates in `Cargo.lock` and no git-sourced npm packages;
  - rust-cache and setup-node's cache use the runtime token.
- **Test:** pr331#3, "a read-only token at the top" and "every checkout leaves no token in .git". Both failed on HEAD and pass now.
- **Left, the owner's (C56):** actions on moving refs (`dtolnay/rust-toolchain@master`, `@v4`, `@v2`). With this fix, a compromised one gets a read-only token.

### pr331#4: a PR over the API's 3,000 files could skip silently (nit): **fixed**
- **The fail-safe:** platform=true when the API listed fewer rows than the event's `changed_files` (`CHANGED`). It counts rows, not paths, so renames can't hide a cut.
- **Fewer calls:** `?per_page=100` cuts a 3,000-file lookup from 100 calls to 30.
- **It doesn't fire on ordinary PRs:** the row count equals `changed_files` on real PRs, a rename counting once (#329: 6 = 6 with one rename; #324: 155 = 155 over two pages).
- **It degrades safely:** with `CHANGED` empty, the step falls back to the path test and doesn't fail (checked under both shells).
- **Test:** group pr331#4:
  - 3,001 files with the seedelf-core line cut;
  - the same with 3,000 renames listed;
  - 100 files a page.
  - All failed on HEAD and pass now.

### pr331#5: the docs say main's protection requires the job; it requires nothing (nit): **partly (the workflow's half)**
- **The workflow comment now reads:** "The one check for main's branch protection to require, *Web Wallet required* … Requiring it is the owner's step in GitHub's settings (1.7.0's item 2)."
- **Left:** `development.md:13` is docs-design's, under the same id (and x-docs#4, pr329#5). Suggested words are below.
- **Test:** none, it's a comment. Checked live: `required_status_checks` has `contexts []` and `checks []`, `enforcement_level` is `non_admins`, and there are no rulesets and no rules on main.

### pr331#6: a PR that edits web-wallet.yml decides its own Web Wallet required (nit): **deferred to docs**
- This is inherent to `pull_request`: the PR's own copy of the workflow runs, so no change to the file can bind it.
- The fix is a reading rule in development.md's Branching. That file isn't mine; the sentence is below.

### pr331#0: the required check is skipped by the owner's own merge path, the admin bypass (medium): **owner's call**
- **Reproduced live:**
  - one approving review is required, with `enforce_admins` false;
  - all 14 PRs from #325 to #338 had 0 reviews (`REVIEW_REQUIRED`) and were merged by the owner, so every one was an admin bypass;
  - 12 of the 13 with a Web Wallet check merged before it finished (only #325 waited).
- **The owner's steps** are below.

### x-rel#2: item 2's owner step, as written, won't gate the release PR (medium, was UNVERIFIED): **owner's call; verified**
- **Verified, every fact true:**
  - main's protection and its rulesets: no required check, one approval, `enforce_admins` off, `[]` rulesets;
  - the merge times, to the second;
  - HEAD's tree `8bd149a8` = #338's head tree, cut from main's head at the time (11e249d2). So #338's green run did check today's tree as one.
- **The comment half** is fixed under pr331#5.
- **Left, for the docs lanes:** `development.md:13`/`:15` and `roadmap:36`.
- **Until the setting is in:** merge the release PR only once its check is green on every step (development.md:15).

### pr331#7: data-layer.yml never reports, and its job name collides with web-wallet's `check` (owner-call, was UNVERIFIED): **owner's call; reproduced**
- **The shape:** `data-layer.yml:5-22` still has a workflow-level `paths` filter, so it never reports on a PR outside its paths.
- **The collision:** #324's head carries two check runs both named `"check"`, one from *Data layer* and one from *Web Wallet*. Since #331, web-wallet's `check` reports skipped on every PR outside seedelf-platform/.
- **Not changed:** data-layer.yml, as the brief says. I didn't give web-wallet's `check` a `name:` either, because that's part of this owner's call.

## The owner's steps in GitHub (pr331#0, x-rel#2, pr331#7)

**Recommended, (b): a ruleset.** It binds the check for everyone and keeps today's classic rule, and its review bypass, as they are.

1. Repository → **Settings** → **Rules** → **Rulesets** → **New ruleset** → **New branch ruleset**.
2. **Ruleset Name:** `main: Web Wallet required`. **Enforcement status:** **Active**.
3. **Bypass list:** leave it **empty**. Don't add *Repository admin*.
4. **Target branches** → **Add target** → **Include default branch**.
5. **Branch rules:**
   - Keep the defaults *Restrict deletions* and *Block force pushes*.
   - Tick **Require status checks to pass** → **Add checks** → type `Web Wallet required` → select it (with *GitHub Actions* as its source, if offered).
   - Leave **Require branches to be up to date before merging** unticked, unless you want main's combined tree tested. That costs every open PR a fresh ~1 h run after each merge.
6. **Create**.

It also stops direct pushes to main, which your flow doesn't use (development.md: go through a PR even for docs).

**Or (a): the classic rule.**
1. **Settings** → **Branches** → *Branch protection rules* → **Edit** on `main`.
2. Under *Require a pull request before merging*, untick **Require approvals**. That makes the count 0: an author can't approve their own PR, which is what made the bypass routine.
3. Under **Require status checks to pass before merging**, keep **Require branches to be up to date before merging** ticked. Search `Web Wallet required` and add it.
4. Tick **Do not allow bypassing the above settings**. **Save changes**.
5. The cost: with up to date on and no bypass, every PR re-runs its hour after each other merge.

**Optional with either:** **Settings** → **General** → *Pull Requests* → tick **Allow auto-merge**. Then **Enable auto-merge** on a PR lands it the moment it's green.

**How you'll know it works:** on the next PR that touches seedelf-platform/ (the release PR will), the merge button must be disabled, with no bypass checkbox, while its check runs. Under (b), once it's green, the review rule's bypass may still show; that's expected.

**pr331#7's step:** when you add required checks, add **only** `Web Wallet required`, never a bare `check`.
- Two workflows report a run by that name.
- The data layer's never reports outside its paths, so requiring it would hold every wallet-only PR pending for good.
- If you want the data layer gated too, that's a workflow change first: data-layer.yml in #331's three-job shape with its own name (*Data layer required*), and a `name:` on web-wallet's `check`. Then require that name.

## For the docs lanes (so the words follow the code)

- **development.md:13, when the check runs:** "Its check runs when the PR touches `seedelf-platform/` or the workflow (a file moved out of the folder counts), when the PR has more files than the API lists (3,000), and on every PR into a branch other than `main`."
- **development.md:13, the requirement:** replace "That job is the one `main`'s branch protection requires" with "That job is the one for `main`'s branch protection to require; requiring it is the owner's step (1.7.0's item 2)", matching the workflow comment.
- **development.md Branching (pr331#6):** "A PR that edits `.github/workflows/web-wallet.yml` runs its own copy of it, so it decides its own *Web Wallet required*: read that diff before trusting the green."
- **Optional (pr331#2's leftover):** "After changing a PR's base, push to it, or close and reopen it, so its check runs against the new base."
- **roadmap:36 (item 2):** the owner's step has to be one their own merges can't bypass: a ruleset with an empty bypass list, or approvals 0 with *Do not allow bypassing*. docs-roadmap's pr329#1 covers the same.
- **No privacy-policy entry:** this is CI only, with no data-handling change. No doc describes the CI token, so nothing else changes.

## Not built: the cost of docs-only PRs (the user's note), the owner's call

- **The cost:** 5 of the last 14 merged PRs were docs-only markdown (#325, #326, #329, #334, #338). Each ran the full check, for 51–67 minutes, because the wallet's docs sit under seedelf-platform/.
- **Nothing the check runs reads `seedelf-platform/seedelf-web-wallet/docs/**/*.md`.** Only `docs/i18n/` is read, by the i18n tests, plus `wasm/README.md` by `readme_test.rs`.
- **The idea (mine):** `changes` could leave those markdown files out, and a docs-only PR would then report in about a minute.
- **Not built:** it narrows what the gate covers. It matters more once the check binds, since each docs PR would then wait an hour.

## Nothing else

- No UI strings, no critical keys, no e2e specs, no WebAssembly node tests.
- No scratch files in the tree. Everything is under `…/scratchpad/ci-lane/`.
- GitHub reads were GETs only: protection, rulesets, PRs and check runs.
