# v-pr331-4-trace: pr331#4, the files API's 3,000 cap

**Verdict: confirmed. Severity: nit.** Confidence: high on the mechanism, which I checked on the real API. The PR shape it needs is very unlikely in this repository.

The finding: a PR of over 3,000 files can skip the check silently, because of the API's cap and because `seedelf-platform/` sorts late. File: `.github/workflows/web-wallet.yml:27`.

## The path on HEAD (6bca8bec)

- `.github/workflows/web-wallet.yml:27`: `files=$(gh api --paginate "$FILES" --jq '.[].filename')`
- `:28`: `if grep -q -E '^(seedelf-platform/|\.github/workflows/web-wallet\.yml$)' <<<"$files"; then` writes `platform=true`, else `platform=false`.
- `:36`: `check` runs only `if: needs.changes.outputs.platform == 'true'`, so with `platform=false` it is `skipped`.
- The `required` job has `if [ "$CHECK" = skipped ] && [ "$PLATFORM" = false ]; then exit 0; fi`, so *Web Wallet required* is green.
- No other workflow tests `seedelf-platform/` on such a PR:
  - `data-layer.yml` runs on `seedelf-data/**` but tests the data layer only.
  - `continuous-integration.yml` checks the contracts.

## Each premise, checked

1. **The cap is 3,000.** GitHub's REST docs, *List pull requests files*: "Responses include a maximum of 3000 files. The paginated response returns 30 files per page by default"; `per_page` goes up to 100.
2. **The truncation is silent.** I ran the workflow's own command form on nodejs/node#65161, which has `changed_files=8161`:
   - `gh api --paginate ".../pulls/65161/files?per_page=100" --jq '.[].filename'` returned **3000 lines with exit 0**.
   - Page 30's `Link` header carries only `rel="prev"` and `rel="first"`, with no `next`. Page 31 is `[]`, exit 0.
3. **The cut keeps the first 3,000 in path order.**
   - Those 3,000 are in C byte order: `common.gypi`, then 2,999 under `deps/`, ending at `deps/v8/test/mjsunit/asm/asm-stdlib.js`.
   - Files the PR's own commits change, all sorting after that, are missing: `doc/abi_version_registry.json` and `src/node_version.h` (commit aa1d7b53ac86), and `tools/v8_gypfiles/abseil.gyp` (6d854b7338bb).
   - This repository's PRs come back in byte order too. #324 has 155 files over two pages (`.github/`, then `README.md`, then `seedelf-data/`, then `seedelf-platform/` from entry 12). #279, #329 and #331 match as well.
4. **`seedelf-platform/` sorts late.** In C order the top level is `.github`, `CLAUDE.md`, `LICENSE`, `README.md`, `RELEASE.md`, `SECURITY.md`, `seedelf-contracts`, `seedelf-data`, `seedelf-platform`, `util`. 137 tracked files sort before `seedelf-platform/`: 5 in `.github/`, 5 at the root, 53 in `seedelf-contracts/` and 74 in `seedelf-data/`.
5. **The scenario is mechanically real.**
   - Nothing ignores `seedelf-data/vendor/`: `git check-ignore` matches nothing, and `seedelf-data/.gitignore` lists only `.env*`, `/target/` and `/_reference/`.
   - Its 176 registry crates come to about 8,829 files as unpacked in `~/.cargo/registry`. That is about the size of the node PR, which the API answered without error.
6. **Not a regression.** GitHub's workflow-syntax docs say of the old path filter: "If the generated diff contains more than 3,000 files and the files the workflow filter matches are not in the first 3,000 returned by the filter, the workflow will **not** run."

## Scratch test (deleted)

`extension/tests/zz-review-v-pr331-4-trace-1.test.ts` took HEAD's `changes` and `required` scripts out of the workflow and ran them under `bash -e`, GitHub's default shell. A fake `gh` on PATH answered the files endpoint as the real API did: the first 3,000 entries in byte order, exit 0.

- A control, 3 vendor files plus `seedelf-platform/seedelf-core/src/build.rs` with a check that would fail: `platform=true`, required red. **Pass.**
- A control at exactly 3,000 files, 2,999 vendored plus the core change: the core change is seen, required red. **Pass.**
- The scenario, 3,000 vendored files plus the core change: **fails on HEAD**, `{"platform":"false","check":"skipped","requiredGreen":true,"log":"changes: success, touches seedelf-platform: false, check: skipped"}`.

## Why only a nit

- It needs 3,000 or more changed files that sort before `seedelf-platform/`. Only 137 such files exist today, so it takes vendoring or a mass import.
- The old path filter had the same limit.
- `main` doesn't require the job yet. `gh api repos/.../branches/main` gives `"protected":true` with `required_status_checks.contexts: []`, matching item 2: "left, the owner's: requiring it".
- The job's log line says `check: skipped` in plain words.
- It is CI, not the wallet: no money, privacy or flow is touched.

One doc line overstates it in the same way. `development.md:13` says "Its check runs when the PR touches `seedelf-platform/` or the workflow", which is untrue past the cap.

## Fix advice

The finding's fix works. In a scratchpad simulation it gives `platform=true` for 3,001 files and stays `false` for 4 files outside `seedelf-platform/` and for 0 files. Some refinements:

- **`changed_files`.** It is on the REST PR object; I read it for #324, #329, #331, #279 and node#65161. The event carries that object, but the webhook docs don't list its nested fields. Two forms need nothing from the payload:
  - `[ "$(wc -l <<<"$files")" -ge 3000 ]`, then `platform=true`. A PR of exactly 3,000 files would run the check for nothing, which is harmless.
  - Or read `changed_files` with one more `gh api` call on the PR.
- **`?per_page=100`** works with `--paginate`; I used it throughout. A capped lookup takes 30 calls instead of 100.
- **Renames, a separate gap.** This is not part of the verdict, and I haven't checked whether the old filter saw renames. The API reports a rename as one entry: `filename` is the new path and `previous_filename` the old (PR #329: `renamed .../docs/archive/plans/chunk-34-token-pools.md` from `.../docs/plans/chunk-34-token-pools.md`). Since `--jq '.[].filename'` drops the old path, a PR that only moves a file out of `seedelf-platform/` gets `platform=false`. An example is a test fixture moved into `seedelf-data/`.
  - A form that closes both gaps and keeps one line per entry, so the count still compares:
    - jq: `--jq '.[] | "\(.filename)\t\(.previous_filename // "")"'`
    - grep: `'(^|\t)(seedelf-platform/|\.github/workflows/web-wallet\.yml(\t|$))'` (a literal tab)
    - Checked: 6 lines for #329's 6 files. In the simulation it gives `platform=true` for 3,001 files and for a rename out, and stays `false` for the small cases.
  - Don't add `previous_filename` as extra lines next to a `wc -l < changed_files` test: the extra lines can hide a cut.
- **The doc line.** If it's fixed, `development.md:13` can drop its implied "always".
