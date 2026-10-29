# 1.7.0's release review: the brief

You are one of several agents reviewing everything merged into `main` since 1.6.0. This review is the gate before Seedelf Wallet 1.7.0 is packaged and published on the Chrome Web Store. Real people run this wallet on Cardano mainnet with real money, so a defect found here is worth far more than one found after the upload.

## The tree

- Repository: `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet`. Branch `web-wallet/release-1.7.0`, which is `origin/main` at `6bca8bec`. **Review the code as it stands on this tree (HEAD)**, not only each PR's diff: later PRs may have changed what an earlier one touched.
- 1.6.0 shipped from `babb8e76` (PR #324). The range under review is `babb8e76..6bca8bec`: PRs #325 to #338.
- The web wallet is `seedelf-platform/seedelf-web-wallet/`: `extension/` (the MV3 extension, TypeScript and React; the worker is `src/background/`, the screens `src/ui/`), `wasm/` (the `seedelf-wasm` crate), `docs/`. Shared Rust: `seedelf-platform/seedelf-core`, `seedelf-crypto` and `seedelf-koios`, as compiled into the WebAssembly. The data layer (`seedelf-data/`) didn't change in this range.
- The WebAssembly is built and current in `wasm/pkg`, and `extension/node_modules` is installed. Don't rebuild either.
- The lead ran the CI list bar the e2e on this tree before the review: fmt, clippy, Rust tests, the WebAssembly's node tests and `tsc` pass; Vitest's two builds were still running when the review started.

## The PRs

The diff of each is `git diff <merge>^1 <merge>`, and its description `gh pr view <n>`.

| PR | Merge | What |
|---|---|---|
| #325 | `a5fc6576` | docs: 1.6.0's package record (`docs/roadmap.md`) |
| #326 | `5abd5470` | docs: Tor through tor-js, parked with the spike's findings (`post-release-roadmap.md`) |
| #327 | `8d876588` | deps: certifi 2026.10.23 in the contracts' happy-path pins, without emSign's G3 root (not the wallet) |
| #328 | `641f751c` | deps: rustls 0.23.46 in `seedelf-platform/Cargo.lock` |
| #329 | `d67f8054` | docs: 1.7.0's list; chunk 34's plan archived, what it left carried into *Kept in mind* |
| #330 | `81397dc4` | fix: a trap under a run a page's request starts without waiting for it locks the wallet (`unawaited` in `handlers.ts`). List item 3 |
| #331 | `3b32b92e` | ci: *Web Wallet required*, a job that always reports, for `main` to require (`.github/workflows/web-wallet.yml`). Item 2 |
| #332 | `4610555a` | fix: overflow checks for core, crypto and koios in `[profile.wasm-release]`; not `seedelf-wasm`'s own crate. Item 4, its overflow half |
| #333 | `b2c3940f` | fix: a private Bootstrap's way back priced from the protocol parameters (`bootstrap_back_reserve`, `privateBootstrapBounds`, the Bootstrap form). Item 4, its other half |
| #334 | `ae610284` | docs: the list gains a headless Leios run (item 8) |
| #335 | `0bad0d52` | feat: Transaction details for every part of a payment in parts (a stepper in the view; `tx-view.ts` follows `partHashes`). Item 7 |
| #336 | `473b7f1a` | fix: a pool the data layer lists is confirmed from Koios first (`launched()` in `lovejoin-pools.ts`), with a privacy policy entry. Item 5 |
| #337 | `11e249d2` | feat: *Bring the rest back now*, a session's return without its collateral's mix, offered an hour after that mix's deposit (`TAIL_OFFER_MS`, `session-skip-collateral-mix`; one new critical key). Item 6 |
| #338 | `6bca8bec` | docs: item 8, the Leios run on Musashi, done. The run's own branch, `web-wallet/leios-musashi`, stays unmerged on purpose: it is **not** part of this release or this review |

**This tree was never CI-tested as one.** Each PR's check ran on its own branch, and several merged minutes apart: #330 to #332 within four minutes, #333 and #335 within a minute, #336 and #337 fifteen seconds apart. How they meet is unverified.

**Where the work came from:** 1.7.0's list in `docs/post-release-roadmap.md` (*The order*, "Then 1.7.0"), each item's detail under *Kept in mind*, marked **(1.7.0)**. The IDs the PRs cite (`323-worker#3`, `321-parts-worker#5`, `pool-exists`, `docs-small#1`, `x-release#7`, "bootstrap's call 1", …) are 1.6.0's release review's. `docs/archive/plans/review-1.6.0.md` → *The IDs* says where each one's full text is in git, for example `git show 7e2d89ed:seedelf-platform/seedelf-web-wallet/docs/plans/review-1.6.0/FINDINGS.md`, or `.../fixes/<name>.md`. The token pools' design and sessions are in `docs/archive/plans/chunk-34-token-pools.md`.

## The owner's rules

These decide what counts as a defect.

1. **Refuse only what the ledger or the contracts refuse.** A user's mistake is theirs. A new guard, refusal or "safety" check on top of the contracts is never a fix: report it as an owner's call, marked as your idea.
2. **Private by default.** The most private option is the default, with a visible control to turn it down where it costs fees, time or lookups. "Default" never means "only". A costed alternative is a visible switch or button, never a link under text.
3. **Every privacy note stays.** A change may move or shorten one, never drop it. Nothing new phones home without its own decision, and a data-handling change gets a dated entry under the privacy policy's *Changes* (`docs/store/privacy-policy.md`) in the same PR. `docs/privacy.md` is the design doc for the same ground.
4. **UI text is short:** one short line, one-line confirm buttons, no essays around buttons.
5. **The name:** always "Seedelf" (a Seedelf, Seedelfs) and "Seedelf Wallet" for the app. Lowercase only in code (`extension/tests/words.test.ts`).
6. **The languages are en, es and ja.**
   - A module-level `const X = t("key")` binds English at import: every one must be a function.
   - A key named `.privacy.` or `.warn.`, and whatever a privacy or warning callout shows, is critical (`docs/i18n/critical-keys.json`, derived by `extension/scripts/i18n-critical.mjs`). A new or changed critical value needs a blind back-translation, recorded in `docs/i18n/verified-critical-{es,ja}.json`. Other keys' Spanish and Japanese are machine drafts, recorded in `docs/i18n/{es,ja}-provenance.json`.
   - Never compare, parse or persist translated text.
7. **Docs never date a release or state the store's status** (live, in review). The wallet publishes no release notes.
8. **Koios is the public tier,** shared per IP address: the wallet keeps to 40 requests every 10 s (`RateLimit` in `background/koios.ts`), every feature states its Koios cost, and anything paged scales with the contract's size. On mainnet the wallet reads its own data layer first, and Koios for any part that's down or with Settings' *Read Cardano through Koios only* on. Preprod reads Koios alone.
9. **This pass is the web wallet's.** A CLI-only issue goes in `cli_notes`, not in the findings.
10. **Content scripts** (`page.ts` and whatever it imports) never touch `chrome` or i18n at load.

## Safety in this shared tree

Other agents work in the same tree at the same time.

- **Never edit a tracked file.** Never run a git command that changes state (checkout, switch, stash, reset, commit, add, merge, rebase, clean, restore). Read-only git (log, show, diff, blame, grep) is fine, and so is read-only `gh` (no comments, no edits).
- **Scratch tests:**
  - TypeScript: only as `extension/tests/zz-review-<your label>-<n>.test.ts`, run alone (`cd extension && npx vitest run tests/zz-review-<your label>-<n>.test.ts`).
  - Rust: only as `seedelf-platform/<crate dir>/tests/zz_review_<label>_<n>.rs`, run with `cargo test --locked -p <crate> --test zz_review_<label>_<n>`. Cargo may wait on the build lock while another agent builds: let it.
  - Delete every scratch file before you return.
- **Never** run the whole Vitest suite, `npm run build` or any `build:*`, `npm run e2e*`, `npm run package*`, `npm run tokens`, `dreps` or `lovejoin-pools`, or `wasm/build.sh`. Never write to `dist/`, `wasm/pkg/`, `release/` or `src/`. No prettier, no formatter.
- **Mutation checks** (undo a fix to see whether its test fails) go in a copy outside the tree only, under `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/review/<your label>/`.
  - For the extension, copy `seedelf-web-wallet/` without `extension/node_modules`, `extension/dist`, `extension/release` and `extension/test-results`, then symlink `extension/node_modules` back to the tree's. `wasm/pkg` comes with it at the right relative place, and so does `docs/i18n`, which some tests read.
  - For Rust, copy `seedelf-platform/` without `target/`, and build it with its own `CARGO_TARGET_DIR` inside your folder.
- **Nothing that writes to a network.** Never submit a transaction, never run `e2e/live/`, never ask giveme.my anything, never touch mainnet. A read-only Koios GET is allowed only where a finding needs chain data, and sparingly: the owner's IP address shares the public tier.
- **The data layer:** never run anything in `seedelf-data/target/`, never `cargo run` in `seedelf-data/` (it reads `.env` and connects to the owner's mainnet services), never `--ignored` tests, never psql.
- Name every scratch file with your label, so no agent clobbers another's.

## What to look for

**Correctness first:**
- **State machines:** sessions, Lovejoin chains, the collateral's mix and its tail, payments in parts, the Lovejoin records.
- **Races:** a lock or a trap mid-run, two windows open, the alarm's run against a page's request.
- **Error paths:** a failed read, Koios down, the data layer down, Koios-only on.
- **Money:** amounts, reserves, fees, minimums, and what a review promises against what's built.
- **Privacy:** what goes where, and what ties what together.
- **The screens:** every state a change makes reachable (which button still works there?), and whether the text says what happens.
- **The words:** en, es and ja, and the critical set.
- **The tests:** does each new behaviour's test fail without it?
- **The docs:** do they say what the code does?

**Severity:**
- **high:** loses or locks money, breaks a flow for everyone, leaks against what the privacy policy says, locks the wallet in a loop, or blocks the release.
- **medium:** wrong behaviour in a reachable state with real harm (a stuck state with no way out, a misleading money or privacy statement, a lock that doesn't happen), or a critical guard with no test.
- **low:** an edge case, a misleading doc, a missing test on a minor path, a small UX defect.
- **nit:** style, wording, trivia.
- **owner-call:** a product decision rather than a defect, including any new guard you would propose.

Every finding needs a **concrete failure scenario** (this state, these inputs, then this wrong outcome) and **evidence** (file and line on HEAD, quoted). Without a scenario it is a nit at most. Say how confident you are. One well-proven finding beats five guesses, but report everything real, however small.

**Before you return,** write your report as markdown to `seedelf-platform/seedelf-web-wallet/docs/plans/review-1.7.0/<reports or verify>/<your label>.md`, as your prompt says. That file is the one exception to "never edit": it's untracked, and it's the backup if the session crashes.
