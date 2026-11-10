# 1.9.0 gate review: the common brief

You are one reviewer in the gate review of Seedelf Wallet 1.9.0 (the Chrome web wallet). The owner asked for a code review of the release branch. **Review only: never fix, commit, push, or edit a tracked file.**

SCRATCH = `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/6637f822-1e93-462d-9b5e-5bd103fc4b4b/scratchpad`

## The tree

- The main working tree `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet` is at a detached HEAD, `8d7c4b0c`, which is `origin/web-wallet/release-1.9.0` (PR #378 into `main`). Never switch branches, stash, reset or check out files there.
- Another Claude session works on the same branch in its own worktree under `/tmp/claude-1000/.../8aabf08c-91b0-4a73-9c73-6083c6ad5cae/`. Never touch it, nor any other worktree (`git worktree list`), nor `~/.cache/seedelf-release-1.9.0` (its build).
- Your scratch folder is `SCRATCH/review-1.9.0/<your lane>/`; create it. Every scratch file goes there, with a unique name. Downloaded third-party material goes in its own empty subfolder: never execute it, and run any Python that reads it with `python3 -I`.

## What 1.9.0 carries since `web-wallet/1.8.1` (`f77aa5c1`)

| PR | Merge | What | Scope |
|---|---|---|---|
| #370 | `e422921c` | 1.8.1's record in `docs/releases.md` | docs, light |
| #371 | `22e6cd65` | chunk 46's plan (verification on upstream), chunks 40/41 archived, `seedelf-verification/README.md` | docs, light |
| #372 | `ce08e89b` | `seedelf-verification/check.sh`, `Audit/count.py`: "undetermined" | tooling, light |
| #373 | `75600ed6` | The sign window says what a contract releases under the account's key (a bounty report against 1.8.1): `wasm/src/cip30.rs` `inspect`, `DappApprovals.tsx`'s Sign switch, `tx-view.ts` `yourSigners`, `TxDetail.tsx`, i18n en/es/ja | **code, deep** |
| #374 | `5e6a12ac` | CLI wallet prompts | out of scope (CLI) |
| #375 | `6148411e` | Minswap's API stopped taking `ChakraBondingCurve`, so every quote failed; `routeOf` asks again without a DEX the wallet doesn't check; V4 kept out; chunk 47's plan | **code** |
| #376 | `cda19571` | CLI 0.7.0's version bumps (`Cargo.toml`, `Cargo.lock`, `aiken.toml`) | out of scope, except whether it changes what the extension builds |
| #377 | `845383da` | SundaeSwap V4 on mainnet: `seedelf-core` `orders.rs`/`orders.json` read and cancel V4 orders, `MAINNET_PROTOCOLS`, tests, docs | **code, deep** |
| prep | `ed14af7b` | version 1.9.0, the DRep lists, `development.md` | light |
| docs | `8d7c4b0c` | chunk 47's Part B gate, answered on chain; `backlog.md` | docs, light |

- One PR's diff: `git diff <merge>^1 <merge>`.
- The release's: `git diff web-wallet/1.8.1 8d7c4b0c -- <paths>`.
- A PR's description: `gh pr view <n> --json body --jq .body` (read-only `gh` only).
- Paths below are relative to `seedelf-platform/seedelf-web-wallet/` unless they start with `seedelf-platform/` or another top-level folder.

## Background

- **#373** answers a bounty report against 1.8.1: a site builds a transaction that spends a contract UTxO whose script asks only for one of the account's keys (an order's cancel, a listing's withdrawal) and sends the money elsewhere, and 1.8.1's window read 0 ₳ leaving. The owner's fix is a warning plus a Sign switch, refusing nothing. The owner's rule: the witness set isn't signed, so never trust it for a security signal.
- **#377** rests on chunk 47's plan, `docs/archive/plans/chunk-47-minswap-new-routes.md`. Read it if your lane touches swaps. V4's validators aren't public, and preprod has no V4.
- **The owner's standing rules:**
  - The most private option is the default.
  - Refuse only what the ledger or the contracts refuse: no paternalistic guards. A user's mistakes are their own.
  - UI text stays short.
  - Never put a mainnet test spend on the owner's list.
  - A lying data source (Koios, or the data layer) swapping data is out of scope: that's an infrastructure compromise.
  - Always "Seedelf" and "Seedelf Wallet" in what the wallet shows.
  - i18n: critical keys are named `.warn.` or `.privacy.`, and es/ja are back-translated. No module-level `t()`. Numbers stay en-US.
  - Docs never date releases or state store status. No release notes. A data-handling change gets a dated privacy-policy Changes entry in the same PR.
- **The design docs:** `docs/architecture.md`, `docs/flows.md`, `docs/privacy.md` and `wasm/README.md`.
- **CI on PR #378 is green:** rust, wasm, unit on both builds, e2e and store. Look for logic, design and coverage problems, not build breaks.

## Commands and limits

- **Vitest:** fine from the extension folder: `cd seedelf-platform/seedelf-web-wallet/extension && npx vitest run tests/<file>.test.ts`. Its `wasm/pkg` matches this tree's Rust.
  - Never run `npm run build`, `npm run package`, `npm ci`, `wasm/build.sh` or Playwright in the main tree: the owner's Chrome loads its `dist/`.
- **Cargo:** always from `seedelf-platform/`, with `CARGO_TARGET_DIR=$HOME/.cache/seedelf-review-1.9.0/target` and `-j 4`. Never put a target under `/tmp`: it's a 31 GB tmpfs.
  - Agents share that target, so cargo may wait on its lock. That's fine.
  - Run one test file at a time (`cargo test -j 4 -p seedelf-core --test orders_test`, `cargo test -j 4 -p seedelf-wasm --test cip30_test`), never the whole workspace.
- **Anything you run:** finite input only (never `yes |`). Cap memory for heavy runs: `systemd-run --user --scope -p MemoryMax=8G -- <cmd>`.
- **Network:**
  - Reading public Koios is allowed: `https://api.koios.rest/api/v1` and `https://preprod.koios.rest/api/v1`. At most about 20 requests, at least 1 s apart, with user agent `seedelf-review`.
  - Minswap's public aggregator API: at most a handful of read-only `estimate` calls, if your lane needs them.
  - Never send a transaction, never `cargo run` anything in `seedelf-data/`, and never touch home's services or the VPS.
- **A test written to prove a finding, or a mutant, never goes in the main tree.** Make your own worktree instead:
  - `git -C /home/logic/Documents/LogicalMechanism/Seedelf-Wallet worktree add --detach SCRATCH/review-1.9.0/<lane>/tree 8d7c4b0c`
  - For Vitest there: symlink `seedelf-platform/seedelf-web-wallet/extension/node_modules` to the main tree's, and copy the main tree's `seedelf-platform/seedelf-web-wallet/wasm/pkg` in. That `pkg` is this tree's Rust as built: a change you make to `wasm/src` or `seedelf-core` doesn't reach Vitest. Test Rust natively with cargo.
  - For cargo there: `CARGO_TARGET_DIR=$HOME/.cache/seedelf-review-1.9.0/target-<lane>`, never the shared one. Worktrees sharing a target leave stale libraries.
  - When you're done: `git -C /home/logic/Documents/LogicalMechanism/Seedelf-Wallet worktree remove --force <path>`. Put the test's code in your report.

## Severity

| Grade | Means |
|---|---|
| high | Money lost, locked or taken; a key or privacy leak; a sign window that misstates money in a way a site can exploit; a swap or Stop that can't bring funds back |
| medium | Wrong behaviour a real user hits, at a cost: an honest flow refused, a warning missing in a case the fix is meant to cover, a failed quote; or a check that can be bypassed |
| low | An edge case wrong, misleading text, a real path with no test |
| nit | Wording, style, comments |

Grade by what a user or an attacker can actually reach. Say plainly when something is fine.

## Report

- Return your findings through the StructuredOutput schema.
- Each finding needs concrete evidence: code quoted with `path:line`, and the commands you ran with their output. Give a concrete failure scenario too.
- Put what you checked that holds in `checked_ok`, one line each, and in `coverage` what you didn't get to.
- Don't pad. A short, honest report beats a long, speculative one.
- Mark each finding's confidence: `confirmed-by-run` (you ran something that shows it), `traced` (you followed the code end to end) or `plausible` (reasoned, not traced).
