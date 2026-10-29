# v-pr331-1-impact: pr331#1, a rename out of seedelf-platform/ skips the check

**Verdict: confirmed. Severity: low (agreed).** The fix is right, minimal, and changes nothing else.

## Is it real?

Yes. `.github/workflows/web-wallet.yml:27`:

```
files=$(gh api --paginate "$FILES" --jq '.[].filename')
```

For a renamed row, the PR files API's `filename` is the new path, and the old path is only in `previous_filename`. I checked this with a read-only GET of PR #329's files through the real `gh` (2.46, gojq):

```
{"changes":26,"filename":"seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-34-token-pools.md","previous_filename":"seedelf-platform/seedelf-web-wallet/docs/plans/chunk-34-token-pools.md","status":"renamed"}
```

GitHub reports a rename even with edits (`changes: 26`). A deletion is reported as `removed`, with `filename` set to the old path, so a deletion is already caught.

## Who can reach it

- **No user, site or attacker.** The gap is in CI's `changes` job, not in the shipped build.
  - A rename out of the folder gives no attacker an edge. It removes files from `seedelf-platform/` and adds nothing there.
  - Removing a test gives a green check whether or not the check runs.
- **A PR author can.** The PR's only change under `seedelf-platform/` must be moving files out of it.
  - If the PR also updates a reader in that folder, `platform=true` already.
  - So the gap catches only the PR that forgot a reader in `seedelf-platform/`, which is the PR the check exists to stop.
  - Examples:
    - The finding's move of the shared fixture. Both readers fail on a missing file: `seedelf-core/tests/lovejoin_vectors_test.rs:478` (`read_to_string(FILE).unwrap()`) and `extension/tests/lovejoin-planner.test.ts:503` (`readFileSync`).
    - A crate moved out without editing `seedelf-platform/Cargo.toml`.
- **It has never happened here.** Across every branch, `git log --all --diff-filter=R` shows no rename out of `seedelf-platform/` or `seedelf-data/`. The only workflow rename is `tests.yml` to `continuous-integration.yml` (`fdf5b519`), long ago.
- **The harm is bounded.**
  - `main` goes red without anyone seeing it. The next PR that touches `seedelf-platform/` runs the check on `main`'s tree ("up to date" is required), and fails on a change that isn't its own.
  - Every release PR bumps `extension/package.json`, which is under `seedelf-platform/`. #294, #296, #306 and #324 all did. So the check runs on the tree a zip is packaged from.
  - Every PR since #331 (#332 to #338) touched `seedelf-platform/`, so the skip path hasn't run on a real PR yet.
  - #338, the docs-only PR, ran the full check: `changes` pass, `check` pass in 57m35s, `Web Wallet required` pass.
- **The workflow-rename half is true for a pure rename** (the grep left unchanged), and harmless on that PR.
  - The file's content is the same, and `required` running shows the renamed file works.
  - The effect that lasts is that later PRs touching only the renamed workflow skip the check, because the grep still names `web-wallet.yml`. The fix doesn't cover that: a rename of the workflow has to update its grep.

## Severity

**Low.** It's an edge case in CI with a concrete failure: a red `main`, and *Web Wallet required* green on a PR that broke it.

It's also against the documented design:
- `docs/development.md:13` says the check "runs when the PR touches `seedelf-platform/`", and a move out of the folder touches it.
- So does the workflow's comment at `web-wallet.yml:13-14`.

It isn't medium: no user is harmed, nothing broken ships unnoticed, and the next platform PR shows it. It isn't a nit: it's a real hole in the guarantee item 2 was built for.

## The fix

**Right and minimal.** At `web-wallet.yml:27`: `--jq '.[] | .filename, (.previous_filename // empty)'`.

- **The real `gh`** on PR #329's files prints the renamed row's old and new paths, and every other row once, as before.
- **The step run verbatim** (extracted from HEAD's YAML with PyYAML), under `bash -e` as GitHub runs a `run:` with no `shell:`, against a fake `gh`.
  - The fake applies `--jq` to each page on its own, as `gh --paginate` does.
  - Its outcome was fed to the `required` step's own text, wired as the jobs are.

| Case | HEAD | Fixed |
|---|---|---|
| The finding's scenario (fixture renamed out + a `seedelf-data/` edit; the tree is broken) | platform=false, check skipped, **required green** | platform=true, check fails, required red |
| The same rename on page 2, behind 30 rows outside the folder | false, **green** | true, red |
| A pure rename of `web-wallet.yml` to `wallet.yml` | false, green | true, check runs |
| A rename out plus an edit inside `seedelf-platform/` | true, red | true, red |
| A deletion in `seedelf-platform/` | true | true |
| A rename into, or within, `seedelf-platform/` | true | true |
| A rename outside to outside; `README.md` only; `seedelf-data/` only | false | false |
| Lookalike paths (`seedelf-platformx/`, `.../web-wallet.yml.bak`) | false | false |
| `previous_filename: null`, or `""` | false | false |
| The `gh` call fails | step exits 1, required red | the same |
| A `copied` row from `seedelf-platform/` to outside | false | true (the check runs for nothing: harmless; whether GitHub's PR file lists ever report `copied` is unverified) |

**What else it changes:**
- Only PRs with a renamed (or copied) row whose old path is under `seedelf-platform/`, or is the workflow file. They now run the full check, about 58 minutes, as any docs PR inside the folder already does.
- It makes the same API call with the same `pull-requests: read`, and leaves `required` untouched.

**Docs:** none needed. `development.md:13` and the comment at `web-wallet.yml:13-14` already say what the fix makes true. If wanted, line 13's comment could add "(a rename by both its paths)".

**Owner's rules:** CI only. It adds no product guard or refusal, touches no privacy surface and no UI text, and it's the web wallet's own workflow.

## Regression?

Unknown, as the finding says.
- GitHub's docs on `on.pull_request.paths` say nothing about renames.
- This repository's history has no rename out of any filtered folder to read the old filter's behaviour from.
- Two web searches found only third-party filters. Those (dorny/paths-filter, getsentry/action-filter-paths) deliberately count a rename as a delete of the old path plus an add of the new one, which is what the fix does.

## Asides (not findings)

- `data-layer.yml:20-22` lists `nft-images.json` so that "a move or a rename breaks the build" there. That relies on GitHub's built-in `paths` matching a rename's old path, which is the same unknown.
  - It's out of this range: `data-layer.yml` last changed in `fc8561c7`, which is in 1.6.0.
  - That workflow isn't the required check.
- The PR files API returns at most 3000 files. A larger PR could miss its `seedelf-platform/` rows. The fix doesn't change that, and it's far beyond any PR here.

Scratch: the fake `gh`, the 15 cases and the runner were in `scratchpad/review/v-pr331-1-impact/`, and have been deleted. Nothing was written to the tree but this report.
