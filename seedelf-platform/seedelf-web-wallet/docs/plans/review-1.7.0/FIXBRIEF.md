# 1.7.0's release review: the fixers' brief

You fix findings from 1.7.0's release review of Seedelf Wallet, a Cardano privacy wallet (a Chrome MV3 extension: TypeScript and React, its logic in WebAssembly built from Rust). Real people run it on mainnet with real money. This is the gate before 1.7.0 is packaged for the Chrome Web Store.

## The tree: a worktree, shared with the other fixers

- **Work only in** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-wt/release-1.7.0` (call it `W`), on branch `web-wallet/release-1.7.0-fixes`, cut from `main` at `6bca8bec`.
- **Never touch** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet`, the main checkout. The review's own agents are still reading it.
- The web wallet is `W/seedelf-platform/seedelf-web-wallet/`: `extension/` (the worker is `src/background/`, the screens `src/ui/`, the locales `src/locales/{en,es,ja}.json`), `wasm/` (the `seedelf-wasm` crate), `docs/`. Shared Rust: `W/seedelf-platform/seedelf-core`, `seedelf-crypto` and `seedelf-koios`.
- The release prep is already applied. **Don't edit** these files: `extension/package.json`, `package-lock.json`, `src/tokens/`, `src/dreps/`, `src/lovejoin-pools.json` and anything in `seedelf-data/`.
- `extension/node_modules` and `wasm/pkg` are in place. Don't rebuild either. The lead rebuilds `wasm/pkg` after the Rust changes.
- **Other fixers edit the same tree at the same time,** sometimes the same file in another place (`sessions.ts`, `lovejoin.ts`, `Lovejoin.tsx`, `Swaps.tsx` and the locale and provenance files are shared).
  - Make small, anchored `Edit`s. Re-read a file before you edit it again, and never rewrite a whole file.
  - Never undo a change you didn't make. If another fixer's change breaks your test, say so in your report rather than reverting it.
- **Git:** read-only only (log, show, diff, blame, grep). Never commit, add, stash, checkout, reset or restore. The lead commits.

## The owner's rules

Read "The owner's rules" in `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet/seedelf-platform/seedelf-web-wallet/docs/plans/review-1.7.0/REVIEWBRIEF.md` (read only that file from the main checkout). They decide what's a fix.
- **Refuse only what the ledger or the contracts refuse.** A new guard is never a fix. Report it as an owner's call.
- **Private by default; every privacy note stays.** A data-handling change needs a dated entry in the privacy policy's *Changes*. Leave that to the docs lane, but say so in your report.
- **UI text is short:** one short line, one-line confirm buttons.
- **"Seedelf" style;** en, es and ja; no module-level `const X = t(...)`; never compare, parse or persist translated text.

## How to fix

1. **Reproduce first.** For each finding, write the test that shows the defect and run it: it must fail for the reason the finding gives.
   - A finding marked `UNVERIFIED` hasn't been checked by anyone, so this step is its check.
   - If you can't make it fail, read the code again. If the finding is wrong, change nothing and report it as `not-a-bug`, with why.
   - Docs-only findings need no test: check the claim against the code and fix the words.
2. **Fix it** with the smallest change that keeps the rest of the behaviour, in the code's own style and comment density. Then run the test again: it must pass.
3. **Run your area's existing tests too** (the test files next to what you changed), and `npm run typecheck` in `extension/` for TypeScript.
4. **Owner's calls** (severity `owner-call`, or a fix that would add a guard or change a product decision): don't build them. Report each one with your recommendation, in one line.

## Commands

- **Vitest, one file at a time:** `cd W/seedelf-platform/seedelf-web-wallet/extension && npx vitest run tests/<file>.test.ts`.
  - Never run the whole suite, `npm run build`, any `build:*`, `e2e*`, `package*`, `tokens`, `dreps`, `lovejoin-pools` or `wasm/build.sh`.
  - You may edit `e2e/*.spec.ts`, but you can't run it. Say so in your report, and the lead runs it.
- **Rust:** `cd W/seedelf-platform && cargo test --locked -p <crate> --test <file>`.
  - Crates: `seedelf-core`, `seedelf-crypto`, `seedelf-koios`, and `seedelf-wasm` for `wasm/`.
  - The worktree's `target/` is cold: the first build takes minutes, and you'll wait on the lock while another fixer builds. Let it.
  - Never use `--ignored`. Run `cargo fmt -p <crate>` on what you changed, and `cargo clippy --locked -p <crate> --all-targets -- -D warnings` if you changed `seedelf-crypto` or `seedelf-wasm` (CI lints those two).
- **WebAssembly node tests** (`wasm/tests/*.mjs`) run against `wasm/pkg`, which won't hold your Rust change until the lead rebuilds it. Write them, and say so.
- **Formatting:** no prettier and no formatter for TypeScript. Match the file's style by hand.
- **Nothing that writes to a network.** No transactions, no `e2e/live/`, no giveme.my and no mainnet. A few read-only Koios GETs are fine where a fix needs chain data.

## The words

- Every new or changed UI string goes in en, es and ja.
- es and ja are machine drafts, each recorded in `docs/i18n/{es,ja}-provenance.json`. Read the existing entries to copy the format.
- A **critical** key is one named `.privacy.` or `.warn.`, or anything a privacy or warning callout shows (`docs/i18n/critical-keys.json`). If you change one, change en, es and ja, and **list the key in your report**.
  - Don't touch `docs/i18n/verified-critical-*.json`. The lead has each new value back-translated blind and records it.
  - A test will fail until that's done. That's expected; name it.
- Put a no-break space (U+00A0) before ₳, as the house does.
- After you change a translated value, grep the tests for the key and for the old wording, regex forms included (`wasn.t`).

## Your report

Before you return, write it as markdown to `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/fix/reports/<lane>.md`.
- For each finding: its outcome, the test that failed before and passes now, and the files changed.
- Also: every string you added or changed (keys), every critical key changed, e2e specs edited, WebAssembly node tests added, and anything the docs must now say differently, so the docs lanes can follow the code.
