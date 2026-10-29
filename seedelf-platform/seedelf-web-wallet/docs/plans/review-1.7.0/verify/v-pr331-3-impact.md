# v-pr331-3-impact: impact and fix check of `pr331#3`

**Verdict: confirmed. Severity: low** (unchanged).

- Every fact the finding rests on holds on the live repo and in the cited run.
- The scenario needs two corrections:
  - The "faked gate" fakes nothing today.
  - The dependency route goes through the owner's own machine first.
- The real escalation is repository writes outside `main`: pushes to PR branches, tags, the CLI's release assets, statuses, PR and issue edits.
- The fix is right, minimal and breaks nothing. Its `permissions` line is the half that matters.
- CI only: nothing in the store zip changes, so it doesn't block packaging.
- No user or site can reach this through the shipped build. Only a supply-chain compromise of something `check` runs can.

## The facts, re-checked (read-only `gh`)

- **The default is write.** `gh api repos/logical-mechanism/Seedelf-Wallet/actions/permissions/workflow` returns `{"default_workflow_permissions":"write","can_approve_pull_request_reviews":false}`.
- **No top-level `permissions` in web-wallet.yml.** Only `changes` scopes itself (`web-wallet.yml:17-18`, `pull-requests: read`).
- **What run 40725597266 (PR #331's head `c5d19d3f`) shows:**
  - `changes` (job 122947867480): `Metadata: read`, `PullRequests: read`.
  - `check` (job 122947931189) and *Web Wallet required* (job 122981073437): `Actions: write … Checks: write … Contents: write … Issues: write … Pages: write … PullRequests: write … Statuses: write`.
- **The token stays in `.git` for the whole job.**
  - The `check` log shows `persist-credentials: true`.
  - It sets `http.https://github.com/.extraheader AUTHORIZATION: basic ***` at 16:24:21. Post-job cleanup unsets it at 17:21:55.
  - Clippy (16:24:43), `cargo test --workspace` (16:25:19), `npm ci` (16:32:10), `npm test` and both e2e passes all run in between.
- **data-layer.yml does both, with the reason stated.** `data-layer.yml:24-25` has `permissions: contents: read`. `:34-37` has "No token left in .git: the build runs every dependency's build script" and `persist-credentials: false`. data-layer-deploy.yml does the same.
- **#331 changed nothing about `check`'s token.** Its diff adds `changes` (scoped) and `required` (unscoped), so the exposure predates it, as the finding says.

## Who can get a write-token run, and what it runs

- **Fork PRs get a read-only token** (a public repo on `pull_request`). First-time contributors also wait for approval (`approval_policy: first_time_contributors`). An outsider can't reach the write token with a PR.
- **No Dependabot.** There's no `.github/dependabot.yml`, and `automated-security-fixes` is `{"enabled":false}`. Dependabot runs would get a read-only token by default anyway.
- **Same-repo PRs come only from the two collaborators,** `logicalmechanism` (admin) and `quinn-logicalmechanism` (write). The last 20 merged PRs (#319–#338) are all `logicalmechanism`'s, `isCrossRepository=false`. So every wallet PR's `check` runs write-all.
- **The third-party code `check` runs:**
  - Every crate's build script and proc macro (`cargo clippy`, `cargo test --workspace`, `wasm/build.sh`).
  - The npm dev tooling (Vitest, Vite, Playwright).
  - Four actions on moving refs: `dtolnay/rust-toolchain@master`, `Swatinem/rust-cache@v2`, `actions/setup-node@v4`, `actions/checkout@v4`.
  - Today the lockfile's only `hasInstallScript` entry is `fsevents@2.3.3`, which is macOS-only and optional. So `npm ci` runs no install script on Linux yet, but a bumped version could add one.
- **The dependency route** (a bad version in Cargo.lock or package-lock.json) means the owner's own session bumped it. That code runs on the owner's machine first, in the local CI list, where `gh auth token` is an admin token: a far bigger prize than the CI token, and one that npm worms in the wild have taken. The CI token adds little on that route.
- **The route only CI has** is a compromised action ref. Such an action gets the token in-band (an input defaulting to `github.token`), so `persist-credentials` doesn't matter there. Only `permissions` limits it.
- **A determined payload can also read the token from Runner.Worker's memory.** GitHub's hosted runners give the runner user passwordless sudo. So `persist-credentials: false` alone stops only the generic `.git/config` scrapers.

## What the write token reaches, and what it doesn't

**Can't:**
- **Write `main`.** Branch protection requires a PR with 1 approving review. `enforce_admins` is false, the token isn't an admin, and `can_approve_pull_request_reviews` is false, so the token can neither push to `main` nor merge into it.
- **Change Pages.** It's built from `main`'s root (`build_type: legacy`, `source.branch: main`).
- **Ship a deploy.** data-layer-deploy waits for the owner's approval in the `data-layer` environment, which takes `main` alone.
- **Edit workflow files.** `GITHUB_TOKEN` never gets the `workflows` permission.
- **Read a secret.** `check` references none.

**Can:**
- **Push commits to any other branch, the PR's own head included.** A push made with `GITHUB_TOKEN` starts no workflow run, so the new head carries no check. The owner merges every PR by admin bypass: #331, #336, #337 and #338 have no reviews at all. So an injected commit by `github-actions[bot]` reaches `main`, and then the zip the owner builds from it, only if the owner misses it in the PR timeline.
- **Push tags.** No `web-wallet/<version>` tag has been cut, and a token-pushed tag doesn't start release.yml.
- **Create releases or replace release assets.** The repo's releases are the CLI's: 0.5.0, 0.4.10 and so on, GPG-signed `.asc` files beside them. A swapped binary hurts only CLI users who don't verify. That belongs in the CLI notes.
- **Post statuses and check runs; edit PRs, issues and comments; cancel runs, delete caches, dispatch workflows.**

**"Faking the gate" fakes nothing today.**
- `branches/main/protection` has `required_status_checks.contexts: []` and `checks: []`. *Web Wallet required* isn't required yet: that's item 2's remaining owner step.
- Once it is, a fake matters only together with a pushed commit, to cover the check that never ran on the new head.
- On the head `check` itself runs on, a payload could simply let the check pass.

**The `required` job's write-all is immaterial.** It runs no `uses:` and no third-party code, and its env holds only job results and the `changes` output (`true`/`false`). The exposure is `check`'s alone.

## Severity: low

The harm needs an independent supply-chain compromise of a CI component. For the wallet's users it also needs an injected commit to pass unseen at merge, because CI never builds the zip: the owner packages it locally from `main`. That fits the brief's "low", not "medium" ("wrong behaviour in a reachable state with real harm"). It's still worth doing: it's the least-privilege rule the owner already applies to both data-layer workflows, and `web-wallet.yml` is the one wallet-facing workflow that runs the wallet's whole graph.

## The fix: right, minimal, breaks nothing

- **The top-level `permissions: contents: read` is the half that matters.** It removes the write scope from `check` and `required` however a payload gets the token: from `.git`, in-band, or from memory.
- **`persist-credentials: false` on `check`'s checkout is the cheap second line.** It matches data-layer.yml and keeps the token off disk. Nothing needs it on disk:
  - Neither `Cargo.lock` nor `package-lock.json` has a git source.
  - `wasm/build.sh` and `scripts/package.mjs` run no git remote command.
  - The repo is public anyway.
- **`changes` is unchanged.** A job-level `permissions` block replaces the workflow's, as its log shows today (only `Metadata` and `PullRequests` read under a write-all default).
- **Caching keeps working under `contents: read`.** Data-layer run 40436528222 (job 121966385574) shows `Contents: read`, `Metadata: read`, then `Cache mode: write`, `Cache hit for: v0-rust-check-…`, `Cache restored successfully`. setup-node's `cache: npm` uses the same cache service.
- **The check runs still report.** Actions creates each job's check run itself, not the token (`changes` reports fine with its narrowed token). *Web Wallet required* keeps its name, so the owner's coming branch-protection step is unaffected.
- **One correction to the finding's rationale.** "Nothing in check uses the token" isn't quite right: `actions/checkout` fetches with it, and `setup-node` may read its version manifest with it. Both need only read, which the fix keeps.
- **Within the owner's rules.** It's CI only: no product guard or refusal, no UI text, no privacy note, no i18n, no zip change.
- **Optional, not needed:** `permissions: {}` on `required`.
- **Pinning `dtolnay/rust-toolchain@master` by SHA** is the other half of the old C56 and the owner's call. data-layer.yml keeps `@master` too.
- **It proves itself.** The fix's own PR touches `web-wallet.yml`, so `changes` sets `platform=true` and the full `check` runs. Its log should show `Contents: read` / `Metadata: read` and `persist-credentials: false`.

## Scope note for the lead

At 1.2.0 this surfaced as **C56**, "CI token permissions and action pinning", in #282's *Your decisions*. It was left with the owner as a CLI/CI decision, "out of a wallet pass's scope" (memory, web-wallet-branching / web-wallet-pass-scope).

Now `web-wallet.yml` is the wallet's own CI, and #331 (1.7.0's item 2) changed it in this range. So the two lines fit as item 2's follow-up. Whether they ride 1.7.0 or a separate CI PR is the owner's call, and either way they don't block packaging.

## CLI notes (out of this pass, rule 9)

- **release.yml has the default write-all token too, plus the CLI's signing key.**
  - In `build-linux`, `cargo build --release --locked --bin seedelf-cli` (`release.yml:22`, the CLI's whole build-script graph, on `dtolnay/rust-toolchain@master` at `:18`) runs before *Import GPG Key* (`:30-32`, `secrets.RELEASE_GPG_KEY`).
  - The signing steps put the passphrase into their scripts' text (`:38`, `:53`).
  - A process a build script leaves running survives into those steps; only the end of the job kills it ("Cleaning up orphan processes").
  - That's the higher-value target, for a CLI pass.
- **continuous-integration.yml (the contracts)** runs on every PR and on `main`, write-all, with `actions/checkout@v3` persisting the token and `aiken-lang/setup-aiken@v1`.

## Repro (all read-only)

- The `gh api` calls above:
  - `actions/permissions/workflow`
  - `actions/permissions`: `{"enabled":true,"allowed_actions":"all","sha_pinning_required":false}`
  - `actions/permissions/fork-pr-contributor-approval`
  - `branches/main/protection`
  - `rulesets`: `[]`
  - `collaborators`
  - `automated-security-fixes`
  - `pages`
  - `environments`
  - `releases`
  - `pulls/{331,336,337,338}/reviews`: all empty
  - `gh pr list --state merged`
- The job logs of runs 40725597266 and 40436528222.
- A `node` read of `package-lock.json` for `hasInstallScript`.
- No scratch test was needed, and nothing in the tree was written apart from this report.
