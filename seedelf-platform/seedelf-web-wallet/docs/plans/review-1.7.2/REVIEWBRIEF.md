# 1.7.2's release review: the shared brief

You are one reviewer in the release gate for Seedelf Wallet 1.7.2, the Chrome web wallet in `seedelf-platform/seedelf-web-wallet/`. 1.7.1 was packaged from `f31758b0` (tag `web-wallet/1.7.1`). `main` is now `133d598b`, after seven PRs:

| PR | Kind | What |
|---|---|---|
| #353 | docs | 1.7.1's release record (one line, then in `docs/roadmap.md`, now `docs/archive/roadmap.md`) |
| #354 | docs | chunk 38's plan: Midnight beside the private and public sides (`docs/plans/chunk-38-midnight.md`) |
| #355 | docs | chunk 39's plan: whose stake key a proposal's deposit goes back to |
| #356 | docs | the roadmaps archived; `docs/backlog.md` and `docs/releases.md` in their place (46 files) |
| #357 | code | a site's sign window says whose stake key a proposal's deposit goes back to (chunk 39, from a bounty report) |
| #358 | code | a UTxO at the stake or DRep key's own address is the account's (bounty report, Low) |
| #359 | code | an address is the account's by its payment key, never its stake key alone (bounty report, Medium) |

1.7.2 is a patch: these three fixes and the docs. This review is the gate. Worthy findings get fixed on `web-wallet/release-1.7.2` before the owner builds the zip.

## The tree

- **The main checkout is read-only for you:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet`, on branch `web-wallet/release-1.7.2`. The lead commits the version and the bundled lists there during the review. Never edit, stage, commit, build or run tests in it.
- **The baseline is `133d598b`.** Use `git show 133d598b:<path>`, `git diff f31758b0 133d598b -- <path>`, `gh pr view <n>`, `gh pr diff <n>`. Each code PR's description says what it claims; check the claims.
- **Code reviewers get a sandbox worktree,** detached at `133d598b`, with `node_modules`, `wasm/pkg` and a warm cargo target copied in. Use it to revert a fix or try a mutant and watch the tests. **Restore it before you finish:** `git -C <sandbox> checkout -- . && git -C <sandbox> clean -fd`. That leaves the ignored build state alone. A verifier may later reuse your sandbox, so leave it clean.

## Running tests (in a sandbox only)

- **Rust, on the host:** `cd <sandbox>/seedelf-platform && cargo test -p seedelf-wasm --locked --test cip30_test` (or `--test api_test`, `--lib`, and so on). A sandbox's first build recompiles only the workspace crates, which takes a couple of minutes. Two runs in one sandbox wait on cargo's lock, which is safe.
- **Vitest:** `cd <sandbox>/seedelf-platform/seedelf-web-wallet/extension && npx vitest run tests/<file>.test.ts`. The whole suite takes about 14 minutes on CI, so run files, not the suite. `VITE_ENABLE_MAINNET=false` gives the preprod-only build. Typecheck: `npm run typecheck`.
- **Vitest loads `wasm/pkg` as built at `133d598b`.** A Rust change does not reach Vitest unless pkg is rebuilt (`wasm/build.sh`, slow: don't). Test Rust with cargo, and TypeScript with Vitest.
- **Not allowed:**
  - Playwright/e2e, `npm run build`, `npm run package`, live runs;
  - anything from `seedelf-data/target`, or `cargo run` under `seedelf-data/`: it reads `.env` and hits the owner's mainnet services;
  - prettier or any formatter;
  - writing to GitHub (no comments, no PRs).
  - A handful of read-only Koios GETs (`https://preprod.koios.rest/api/v1/...` or mainnet) are fine if a finding can only be settled against chain data.
- **Scratch files:** name them with your label (for example `tests/zz-r172-pr359-own.test.ts`, `wasm/tests/zz_r172_pr358.rs`, `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/<label>-*`). Delete them from the sandbox before you finish.

## What a finding is

- **A finding is a real defect** in what #353 to #359 shipped, or in what 1.7.2 needs. It can be:
  - a fix that misses a reachable path of the bug it fixes;
  - a regression a fix caused, often where two features meet;
  - a test that doesn't pin what it claims (show it: revert the fix or try a mutant, and the test still passes);
  - user-facing text (en/es/ja) that's wrong or misleading;
  - a doc that states something false about the code;
  - a release step that's missing.
- **Not a finding:**
  - style preferences, or a formatter's opinion;
  - re-arguing one of the owner's calls (below);
  - anything that needs the data source (Koios or the owner's data layer) to lie or leave rows out. SECURITY.md puts that out of scope, and the owner's rule is that the data source is trusted, with no cross-check;
  - a proposal for a new refusal or guard. The owner: refuse only what the ledger or the contracts refuse. A warning or a disclosure is fine.
- **Severity:**
  - **high:** money can be lost, or a key or privacy promise broken, on a reachable path;
  - **medium:** a security-relevant screen still tells the user something false on a reachable path, or a fix misses a path of its own report, or a feature regressed;
  - **low:** an edge-case inaccuracy, a fix no test pins, or a doc that misleads a developer;
  - **nit:** wording, a comment, a test's name.
- **Evidence:** cite `file:line` at `133d598b` and say how you verified it: you read the code path, ran a test, reverted the fix and watched a test fail, or tried a mutant that survived. If you couldn't verify a claim, say "unverified", and rate it low at most.
- **One finding per defect,** with a concrete failure scenario: this input or state gives that wrong output. If you find nothing, return an empty list and say what you checked.

## The owner's standing calls (don't re-raise them)

- **No paternalistic guards:** refuse only what the ledger or contracts refuse. A user's mistakes are theirs.
- **Private by default,** and **UI text short:** one line per note, never an essay.
- **Names:** Seedelf, a Seedelf, Seedelfs, Seedelf Wallet (`tests/words.test.ts` enforces them).
- **Numbers stay en-US** in every language. Dates are localised.
- **Chrome Translate stays on.** `media/` is a posted record, so it's out of scope.
- **#357:** a stranger's certificate alone leaves the staking callout info-toned. The PR body leaves it to the owner.
- **#358:** no new refusal for unknown inputs when only the stake key signs. Chunk 29 kept that path on purpose, for a site's delegation paid from a UTxO not on chain yet, and a row left out is a data-source omission.
- **#359:** nothing is refused. Paying an address that only carries the account's stake key is the user's call.
- **Translations:** es and ja have no native reader, which the owner accepted. Critical keys (`docs/i18n/critical-keys.json`) are back-translated blind and recorded in `docs/i18n/verified-critical-{es,ja}.json`.
- **Never compare, parse or persist translated text.** A module-level `const X = t("key")` is a bug, because it binds English at import.
