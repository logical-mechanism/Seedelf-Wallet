# 1.8.0's release review: the reviewers' brief

You are one of nine reviewers of Seedelf Wallet 1.8.0, the gate before it's packaged for the Chrome Web Store. Each reviewer has one area (your prompt names yours). This brief is shared: read it all before you start.

## What's reviewed

Every PR since `web-wallet/1.7.2` (`6b70c1f8`, the commit 1.7.2's zip was built from) that ships in the extension or the data layer, as one tree at **`a6c94743`** (`main` after #364):

| PR | What | Diff |
|---|---|---|
| #361 | Docs: 1.7.2's release record in `docs/releases.md` | `git diff ae9f59b5^1 ae9f59b5` |
| #363 | Chunk 44a: Lovejoin v2's pools recognised, and launches on v2 alone. Core, WebAssembly, the data layer's copy, the extension's discovery and launch | `git diff c15603d5 c441881e` |
| #364 | Chunk 44b: the old pools withdraw-only, returns into v2's 5 ₳ pool, the first unlock's bring-back, the screens and words, and about 400 worker tests moved onto v2 pools | `git diff c441881e a6c94743` |

**The plan is `seedelf-platform/seedelf-web-wallet/docs/plans/chunk-44-lovejoin-v2.md`.** Read it first: it says what each part does and why, and what 44c and 44d (not built yet) still owe. The design docs for the area are `docs/architecture.md` (its Lovejoin section), `docs/flows.md` and `docs/privacy.md`; the Rust workspace's rules are in `seedelf-platform/CLAUDE.md` (you have it).

**Out of scope:** #362, the formal verification. That's everything under `seedelf-verification/`, the chunk 40–43 plans in `docs/plans/`, and the lines of the root `CLAUDE.md` it changed. Don't open, run, review or judge any of it. To check the wallet's pinned v2 `mix_logic` bytes, compare them with Lovejoin's own repository at its commit `29573c5`, read-only: `git -C /home/logic/Documents/LogicalMechanism/lovejoin show 29573c5:<path>`. The CLI isn't reviewed either: this is a wallet pass.

## The owner's calls

Judge the code against them. Don't re-argue them: "the owner should have chosen otherwise" isn't a finding. A finding is the code failing a call, a consequence of a call that loses money, privacy or a user's way out and that nobody foresaw, or words that misstate a call.

- **2026-11-03, the game plan:** 1.8.0 allows no mixing into the old pools, and returns every box in them as soon as it can. The UI hides the old pools, shown for withdrawal alone. v2 is integrated, and the owner launches a new 5 ₳ ADA pool, the only pool for now.
- **2026-11-05, four calls:**
  1. **The pool list is v2's alone.** The earliest pool of each value among v2 pools is shown. Classic and 8131b1d pools appear only where the wallet holds a box, marked withdraw-only.
  2. **Withdraw only.** No deposit, mix, Mix again or Bootstrap in a retired pool. Scheduled returns, Bring one back now and Bring every box back stay.
  3. **Right away.** At the first unlock on 1.8.0, Bring every box back runs for the retired pools. Back-to-back withdraws are easier to match; the owner chose speed.
  4. **The earliest v2 5 ₳ ADA pool** takes a return's spare ADA and the session's 5 ₳ collateral, by the rule the collateral pool already uses. Until it holds 30 other boxes (the mainnet floor), returns come back direct; Bootstrap fills it.
- **Kept as they are:** no ADA pool of exactly 10 ₳ on the new scripts (the launch refuses it), and the floor of 30.
- **2026-11-06:** "no mixing in retired pools withdraw only. period": nothing in a retired pool is held for Mix again, a Bootstrap or Koios's word on what made a box. And the first unlock's bring-back doesn't wait for the unlock delay: the owner saw it live and accepted it.

## The rules this release is judged by

- **Money first.** No box is ever stranded: every box in every pool, retired or not, can still come back, by itself on its schedule and by hand. Nothing deposits or mixes into a retired pool. No path spends what isn't the wallet's, pays a fee it didn't say, or leaves a UTxO the ledger or the contracts can't spend.
- **No paternalistic guards.** The wallet refuses only what the ledger or the contracts refuse, and what the owner chose to refuse (retirement is such a choice). A protective rule nobody asked for is a finding, not a fix.
- **Private by default:** the most private option is the default, with a control to turn it down.
- **The copies.** The shown-pool rule and the derivation exist three times (core, the data layer's hand-applied copy in `seedelf-data/api/src/lovejoin/`, the extension's `lovejoin-pools.ts`), held together by `seedelf-core/tests/fixtures/lovejoin-pool-vectors.json` and `extension/tests/fixtures/lovejoin-shown.json`. A rule in one copy and not another is a finding.
- **Sums of outside values** (a row, a datum, a token amount) are checked or done in u128 (`seedelf-platform/CLAUDE.md`, the overflow note). A trap locks the wallet; a wrapped sum is a false figure.
- **The words:**
  - UI text is short: one line, no essays around buttons.
  - Always *Seedelf*, and *Seedelf Wallet* for the app.
  - The worker never compares, parses or saves translated text.
  - A module-level `const X = t("key")` binds English at import.
  - A key named `.warn.` or `.privacy.` is critical: `docs/i18n/critical-keys.json`, and `verified-critical-{es,ja}.json` list the keys back-translated blind. Those list keys, not values, so a critical key whose es or ja value changed since its back-translation needs a fresh one, and CI can't see that it's stale.
  - A worker's reason saved with a session (e.g. `sess.skip.warn.*`) is shown again later in a past-tense frame (`lovejoin.warn.skippedIts`, "Lovejoin was left out of its return: {{why}}") as well as the review's present-tense one: it must read true in every frame, later too.
  - Numbers stay en-US; dates follow the language.
- **The docs never date a release or say what the store is doing.** A change to what the wallet sends or stores owes a dated entry under the privacy policy's *Changes* in the same PR.
- **Which button still works?** For every state 1.8.0 makes reachable (a retired pool with boxes, a released Bootstrap, a collateral's tail ended, the retired pools' bring-back running or stopped, no 5 ₳ pool yet, the floor not reached), say what the user can still do. A state whose every button fails is a finding.

## Severity

- **High:** money lost, locked or stranded; a spend of what isn't the wallet's; privacy broken where the wallet promises it; a crash or trap that locks the wallet; a deposit into a retired pool.
- **Medium:** a wrong outcome a user can meet in normal use: a box that never comes back by itself, a refusal that blocks the only way out, a false statement in a critical (`.warn.`/`.privacy.`) string, a release that can't ship as built.
- **Low:** an edge case, a crafted-only case, words that mislead outside the critical set, a new guard no test pins, a doc that's now false.
- **Nit:** wording, style, a typo, a comment.

Say for each whether 1.8.0 **introduced** it (`new`), **made reachable** something older (`reachable`), or it's **older** and 1.8.0 didn't touch it (`old`). Report `old` ones only when they bear on what 1.8.0 changed.

## What to report

For each finding:
- **title**, **where** (`path:line` at `a6c94743`), **claim** (what's wrong, in a sentence or two);
- **scenario:** concrete state and inputs, then the wrong outcome;
- **evidence:** the trace through the code, and wherever you can, a test that fails at `a6c94743` or a mutation the tests miss. Give the exact command and its result;
- **fix:** what you'd change (don't change it outside your sandbox).

**Confirm each finding in your sandbox before you report it.** Don't report what you couldn't trace, and say so when a claim rests on reading alone. Then list what you checked and found sound (*covered*), and what you didn't get to (*not checked*): a completeness critic reads both after you.

**Mutation checks:** for each new guard or rule in your area, mutate or revert it in your sandbox and run the tests that should catch it. A guard no test catches is a low finding ("untested guard"); give the mutation and the command.

## Your sandbox, and what you must never do

- **Your sandbox** is a git worktree at `a6c94743`: `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/wt/<your lens>`, with `extension/node_modules` and `wasm/pkg` copied in (both are gitignored). Read, mutate, add scratch tests and run tests there, and only there. Name any scratch file with your lens in it. Leave the sandbox as you like; the lead removes it.
- **The main tree** (`/home/logic/Documents/LogicalMechanism/Seedelf-Wallet`) is read-only for you, except for your report. It's on the release branch and will change under you, so read the code in your sandbox. Run no git command that changes state anywhere: no commit, checkout, switch, stash, reset, clean, worktree add/remove, or push.
- **Unit tests:** from `<sandbox>/seedelf-platform/seedelf-web-wallet/extension`, `npx vitest run tests/<file> --maxWorkers=2`, and `VITE_ENABLE_MAINNET=false npx vitest run tests/<file> --maxWorkers=2` for the preprod-only build. Run targeted files only: nine reviewers share 12 CPUs. `npx tsc --noEmit -p .` for types.
- **Rust (the pr363 reviewer only):** from `<sandbox>/seedelf-platform`, `CARGO_TARGET_DIR=<scratchpad>/target-pr363 cargo test -p seedelf-core --test <name>` (or `-p seedelf-wasm`); the data layer from `<sandbox>/seedelf-data` with `CARGO_TARGET_DIR=<scratchpad>/target-pr363-data cargo test <filter>`. Never share a target folder with another tree. A WebAssembly rebuild (`wasm/build.sh`) is the lead's: native tests are enough.
- **The data layer: only `cargo test`, offline. Never run a binary from any `target/` folder, never `cargo run`, never `cargo test -- --ignored`.** The server's binary sits in `deps/` beside the test binaries with the same name prefix, and in the main tree it reads `seedelf-data/.env` and reaches the owner's production mainnet services (a reviewer did this once). Your sandbox has no `.env`; keep it that way.
- **No network.** No Koios, no data layer, no giveme.my, no transactions on any network. Never `npm run tokens`, `dreps`, `lovejoin-pools`, `lovejoin-registry`, `package`, `store:images` or `build` (the last rebuilds the WebAssembly), and no live test (`LIVE_KOIOS`, `e2e/live/`).
- **Playwright (the tests-e2e reviewer only):** `npm run build:ext` in your sandbox, then `npx playwright test --project=extension -g "<title pattern>" --workers=2`. Never in the main tree.
- **Never open** `extension/e2e/support.ts`, `seedelf-crypto/tests/vectors/*.json`, `extension/.preprod-test-wallet.txt` or any `.env`. They hold test phrases and credentials. Use `support.ts` only as a black box, through the specs that import it. Recorded data in `extension/tests/fixtures/*.json` is fine to read.
- **No formatter:** no prettier, and no `cargo fmt` that writes.

## Your report

Write it to the main tree before you return, so a crash keeps it: `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet/seedelf-platform/seedelf-web-wallet/docs/plans/review-1.8.0/find/<your lens>.md`. Put each finding in full under `### <lens>#<n>`, numbered from 0, then *Covered*, then *Not checked*. Then return the same as your structured output, the findings numbered the same way.
