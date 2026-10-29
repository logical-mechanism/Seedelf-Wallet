# v-pr331-3-trace: pr331#3 (the write-all token in `check`)

**Verdict: confirmed, low.** The defect is real on HEAD (`6bca8bec`) and predates #331. Three points are narrower than the finding says, and the blast radius is wider than it says.

## What I traced

| Claim | On HEAD / live | Evidence |
|---|---|---|
| No top-level `permissions` | True | `.github/workflows/web-wallet.yml:9-12` is `on:` / `pull_request:` / `jobs:`. The only `permissions` is `changes`' own (`:17-18`, `pull-requests: read`). |
| Repository default is write | True | `gh api repos/logical-mechanism/Seedelf-Wallet/actions/permissions/workflow` returns `{"default_workflow_permissions":"write","can_approve_pull_request_reviews":false}`. |
| `check` and `required` get write-all | True | Run 40725597266 (#331's own run, same-repo head). Jobs 122947931189 (`check`) and 122981073437 (`Web Wallet required`) each list `Actions/Contents/Issues/PullRequests/Statuses: write`, among others. `changes` (122947867480) lists only `Metadata: read`, `PullRequests: read`. Run 40780509816 (#338, on HEAD's workflow) shows the same for `check` 123140775452. |
| checkout v4 leaves the token in `.git` | True | Job 122947931189 log, line 60: `persist-credentials: true`. Line 109: `git config --local http.https://github.com/.extraheader AUTHORIZATION: basic ***`. It is removed only in post-job cleanup (line 8203), so every step between can read it. |
| `check` runs dependencies' code | True | The same log has 681 `Compiling` lines after line 109, including build scripts (`blst`, `ring`, `libc`, `typenum`, `wasm-bindgen-shared`, `cc`) and proc macros (`serde_derive`, `thiserror-impl`, `wasm-bindgen-macro`). It also runs `cargo install wasm-bindgen-cli v0.2.128` (lines 2390-2699), `dtolnay/rust-toolchain@master` (resolved to `683b588c` at run time), `npm ci`, Vitest, Vite and Playwright. |
| `npm ci` runs lifecycle scripts | True, nothing runs today | No `.npmrc` governs the extension (the only two are in gitignored `_reference/`). But in today's `package-lock.json` the only `hasInstallScript` package is `fsevents@2.3.3` (optional, darwin-only), so on the Linux runner no install script runs now. A compromised bump would add one. |
| `data-layer.yml` drops both | True | `:24-25` `permissions: contents: read`. `:34-37` `persist-credentials: false` under "No token left in .git: the build runs every dependency's build script." |
| #331 scoped only `changes` | True | `git diff 3b32b92e^1 3b32b92e`: it added `changes` with `pull-requests: read` and `required` with no permissions. The pre-#331 file had none either, so it predates the PR. |
| Entry point: a same-repo lockfile bump | True, in this very range | #328 (rustls in `Cargo.lock`) came from the owner's branch `deps/rustls-0.23.46` (`isCrossRepository: false`) and ran the Web Wallet check (run 40556115481). There is no Dependabot config and there are no Dependabot PRs, so Dependabot's read-only token never applies. |

## Scratch test (deleted)

`extension/tests/zz-review-v-pr331-3-trace-1.test.ts` parses the workflow and applies GitHub's rule: a job's own `permissions`, else the workflow's, else the repository default (write, from the API above). It also finds each checkout's `persist-credentials`.

- **On HEAD:** 2 failed, 4 passed.
  - Failed, as the finding predicts: `FINDING: check's token can't write` (`{"from":"repository default","perms":"write-all"}`) and `FINDING: check's checkout leaves no token in .git` (`- uses: actions/checkout@v4`).
  - Passed: the parser sanity check on `data-layer.yml`, `changes` scoped down, `check` runs third-party code, and the `required` narrowing below.
- **On a scratch copy with the proposed fix** (top-level `permissions: contents: read`, plus `persist-credentials: false`): 6 of 6 passed. The test tells the two apart.

## Where it's narrower

1. **`required`'s write token reaches nothing.**
   - The job has no checkout, no `uses:` and no dependency step. Its one `run:` reads `needs.*` only through `env:`, with no `${{ }}` in the script.
   - So the exposure is `check` alone, and #331 didn't widen it.
   - The title's "and the new required job" is true of the token's scopes, not of the risk.
2. **"Faking the gate" can't happen today.** `gh api repos/.../branches/main/protection` shows `required_status_checks` with `contexts: []` and `checks: []`, and there are no rulesets. `main` requires no status check at all yet: #331's "After merging (yours): require **Web Wallet required**" is still the owner's open step (`post-release-roadmap.md:36`, item 2 marked in progress).
   - Once the owner requires it, a commit status posted with this token (the GitHub Actions app's) would plausibly satisfy it. I didn't verify that, because it needs a write.
   - The scenario's other branches are real today: pushing to any branch but `main`, and editing PRs and issues.
   - Separately, `development.md:13` and the workflow comment at `web-wallet.yml:135` already say `main`'s protection requires the job. That isn't true yet.
3. **No npm install script runs today** (see the table). The npm exposure today is dependency code run by Vitest, Vite and Playwright. The Rust build-time exposure is concrete today.

## Where it's wider

- **Entry without any lockfile bump.**
  - Every action is on a mutable ref (`@master`, `@v4`, `@v2`), and the repository doesn't require SHA pinning (`"sha_pinning_required": false`).
  - Every PR touching `seedelf-platform/` runs the full `check`, docs included: #338 changed only `post-release-roadmap.md` and ran it (job 123140775452).
- **The CLI's published release can be altered.** `releases/latest` is `0.5.0` with 8 assets and `"immutable": false`. A `Contents: write` token can replace or delete them. The GPG signatures would expose a swap to anyone who verifies.
- **Contained:**
  - `main` needs a PR and one review, and the token can't approve (`can_approve_pull_request_reviews: false`).
  - `GITHUB_TOKEN` can't edit workflow files. Its tag pushes don't trigger `release.yml`.
  - A dispatched `data-layer-deploy.yml` waits on the `data-layer` environment: required reviewer `logicalmechanism` and a custom branch policy.

## The fix (checked)

The fix as proposed is correct. Nothing in `check` needs the token to write or git credentials:

- There are no git sources in `Cargo.lock` or `package-lock.json`.
- No git calls needing auth in `wasm/build.sh` or `extension/scripts/*.mjs`.
- checkout and setup-node (`token: ***`) use the token read-only, which `contents: read` covers on this public repository.
- `changes`' job-level `pull-requests: read` still replaces the top-level value.

Two notes:

- **The `permissions` line is the half that matters.** On GitHub-hosted runners the job has passwordless sudo, and the token sits in Runner.Worker's memory (the tj-actions/changed-files compromise of March 2025 dumped secrets that way). So `persist-credentials: false` is defence in depth: it stops the trivial `.git/config` read.
- `required` needs no permission at all, and could take `permissions: {}`.
