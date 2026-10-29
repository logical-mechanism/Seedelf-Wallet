# v-pr331-1-trace: pr331#1, a rename out of seedelf-platform/ skips the check

**Verdict: confirmed. Severity: low.** Checked on HEAD `6bca8bec`. The workflow there is byte-identical to #331's merge `3b32b92e`, and #338 changed only `post-release-roadmap.md`.

## Trace

1. `.github/workflows/web-wallet.yml:27`: `files=$(gh api --paginate "$FILES" --jq '.[].filename')`. For a renamed entry, `.filename` is the **new** path. The old path is in `previous_filename`, which the filter drops.
   - The API's shape, read from PR #329 on 2026-10-28: `{"filename":"seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-34-token-pools.md","previous_filename":"seedelf-platform/seedelf-web-wallet/docs/plans/chunk-34-token-pools.md","status":"renamed"}`.
2. `web-wallet.yml:28`: `grep -q -E '^(seedelf-platform/|\.github/workflows/web-wallet\.yml$)'`. With the fixture moved to `fixtures/…` plus a `seedelf-data/` file, no line matches, so `platform=false`.
3. `web-wallet.yml:36`: `if: needs.changes.outputs.platform == 'true'` skips `check`.
4. `web-wallet.yml:154`: `if [ "$CHECK" = skipped ] && [ "$PLATFORM" = false ]; then exit 0; fi`. *Web Wallet required* goes green.
5. After the merge, both readers of the old path fail on `main`:
   - `seedelf-core/tests/lovejoin_vectors_test.rs:17-19,478` (`FILE` = `CARGO_MANIFEST_DIR/tests/fixtures/lovejoin-pool-vectors.json`, `std::fs::read_to_string(FILE).unwrap()`) panics.
   - `extension/tests/lovejoin-planner.test.ts:503` (`readFileSync(new URL("../../../seedelf-core/tests/fixtures/lovejoin-pool-vectors.json", …))`) throws ENOENT.
   - The data layer's check passes, because the scenario updates its `include_str!` at `seedelf-data/api/src/lovejoin/templates.rs:267`.
   - Nothing of the wallet runs on `main` after a merge (`continuous-integration.yml` checks only Aiken), so `main` stays red with nothing to show it. That is the failure #331 was built to stop.

Nothing else catches this. A deletion is handled (`status: removed` keeps the old path in `filename`, so it gives true), and so is a rename within the folder. Only a rename *out* of the folder slips through. That's inconsistent with the job's own stated intent at `web-wallet.yml:13-14` ("touches what the check covers: seedelf-platform/ and this file") and with `development.md:13` ("Its check runs when the PR touches `seedelf-platform/`").

## Repro

Scratch test `extension/tests/zz-review-v-pr331-1-trace-1.test.ts` (deleted after the run):
- It cut the `changes` and `required` steps' `run: |` blocks out of HEAD's workflow, and asserted the cut held the exact lines.
- It ran them under `bash -e`, as Actions does with no `shell:`, with a fake `gh` on PATH. The fake logged its arguments and applied the step's own `--jq` to a fake page with real jq 1.8.1.

Result: 5 tests, 2 failed (the finding's), 3 passed.
- Rename out (the fixture to `fixtures/`, plus a `seedelf-data/` file): `platform=false`, *Web Wallet required* exits 0. **Fails on HEAD.**
- `web-wallet.yml` renamed to `wallet.yml`: `platform=false`, required exits 0. **Fails on HEAD.**
- Controls pass: deletion true, #329's real rename-within true, data-layer-only false, required exits 0 on false.
- The proposed fix, swapped into the step's text in memory: both renames true, deletion and rename-within still true, data-only still false. So the skip path still works.
- `gh`'s own jq engine takes the fix's filter. A read-only `gh api --paginate …/pulls/329/files --jq '.[] | .filename, (.previous_filename // empty)'` printed 7 lines, with the old path right after its new one.

## Narrower than it reads

- **Likelihood is low.** In `git log --all -M --diff-filter=R`, 59 renames had their old path in `seedelf-platform/`, and none left the folder.
  - It bites only when a PR moves a file out *and* touches nothing else in `seedelf-platform/`. That is exactly the broken PR the check should catch: update the readers inside, and the check runs.
- **The workflow-rename half is narrow.** A pure rename changes no step. With the fix, the renaming PR runs the check, but the stale self-path at line 28 would still miss later edits to the renamed file unless that PR updates it.
- **Today nothing is required on `main`.** `gh api …/branches/main/protection/required_status_checks` gives `"contexts":[],"checks":[]`; rulesets and branch rules are `[]`. That matches the roadmap's item 2: requiring the check is still the owner's step. So for now the harm is a misleading green, not a passed gate; once the owner requires it, the gap is in the gate.
- **Not shown to be a regression.** I didn't establish how the old `paths:` filter treated renames.

## Fix

Line 27: `--jq '.[] | .filename, (.previous_filename // empty)'`, tested as above. Optionally also update `development.md:13` and the comment at lines 13-14 so they say "or moves a file out of it".

To cover a renamed workflow for good, the line-28 pattern could match `^\.github/workflows/` instead of the file's own name. That would also run the check on data-layer-only workflow edits: an owner's call, not needed for this finding.
