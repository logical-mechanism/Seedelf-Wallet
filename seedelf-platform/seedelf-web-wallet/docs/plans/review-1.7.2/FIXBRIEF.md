# 1.7.2's release review: the fixers' shared brief

You are one of three fixers in the 1.7.2 release gate for Seedelf Wallet, the Chrome web wallet in `seedelf-platform/seedelf-web-wallet/`. A review of #353–#359 found defects, which the lead triaged; you fix one area of them. The findings, with each verifier's trace, evidence and fix note, are in `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/findings/<reviewer>.md`. Read the ones your prompt names, in full, before you start: the fix notes carry corrections to the reviewers' first suggestions, and the lead's design in your prompt settles the rest.

## Your tree

- **You work in your own git worktree only** (your prompt names it). It is detached at `dd22e2b2`, the head of `web-wallet/release-1.7.2`, with `extension/node_modules`, `wasm/pkg` and a warm cargo target in place.
- **The main checkout is read-only for you:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet`. Never edit, stage, commit, build or run tests in it. The other two fixers' worktrees are theirs: don't touch them.
- **Don't commit, push or open anything on GitHub.** Leave your changes uncommitted in your worktree: the lead integrates them.
- **Your output is a patch.** When you're done, run `git -C <worktree> add -N <each new file, by path>` and then `git -C <worktree> diff --binary > /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/fix-<your label>.patch`. Never `git add -A`. Leave the worktree as it is afterwards (don't clean it).

## How to fix

- **Test first where a test can show the defect.** Write the test, watch it fail against the current code, fix, and watch it pass. Then prove each new test pins the fix: undo your fix (keep the tests), watch the tests fail, and put the fix back. Report each of these with the command and its result.
- **Match the surrounding code.** Its comments say why, at about the density around them, and cite the finding the way the code cites reviews: `(1.7.2's release review, pr358#0)`. Its names and idioms are the house's. Keep diffs to what the fix needs.
- **No formatter on TypeScript or JSON** (there's no prettier config: it would rewrap files to 80 columns). Rust follows `rustfmt.toml`: `cargo fmt -p seedelf-wasm` is fine, and CI runs `cargo clippy -p seedelf-crypto -p seedelf-wasm --all-targets -- -D warnings`.
- **No new refusals.** The owner: refuse only what the ledger or the contracts refuse. A warning or a disclosure is fine.
- **Never compare, parse or persist translated text.** A module-level `const X = t("key")` is a bug (it binds English at import). Pass `t()` a literal key: write `cond ? t("a.b", v) : t("a.c", v)`, never `t(cond ? "a.b" : "a.c", v)`.
- **UI text is short:** what the lead gives you, word for word, in English.

## Translations

- **en:** the lead's text, exactly. Copy the U+00A0 (no-break space) before `₳` from the sibling keys, and match their quotes and apostrophes (U+2019 where they use it).
- **es and ja:** draft them yourself. Follow `docs/i18n/glossary.md`, and reuse the wording of the verified sibling keys for any clause they share, word for word (the lead names the siblings). Record each new key as `"machine"` in `docs/i18n/es-provenance.json` and `docs/i18n/ja-provenance.json`, in the files' own order.
- **Run `node scripts/i18n-critical.mjs --write`** from `extension/` after adding keys, to update `docs/i18n/critical-keys.json`.
- **Don't add your new keys to `docs/i18n/verified-critical-*.json`:** the lead has them back-translated blind afterwards. So `tests/i18n.test.ts`'s "has no unchecked machine draft among them" fails for your new keys, and only for them. Report that, and say which keys.

## Running tests (in your worktree only)

- **Vitest:** `cd <worktree>/seedelf-platform/seedelf-web-wallet/extension && npx vitest run tests/<file>.test.ts`. The whole suite takes about 14 minutes, so run your files plus the guards your prompt lists, not the suite. Typecheck: `npm run typecheck`.
- **Rust:** `cd <worktree>/seedelf-platform && cargo test -p seedelf-wasm --locked --test cip30_test`.
- **Vitest loads `wasm/pkg`.** A Rust change reaches Vitest only after `wasm/build.sh` rebuilds pkg in your worktree (`cd <worktree>/seedelf-platform/seedelf-web-wallet/wasm && ./build.sh`; it takes a few minutes). Only the fixer whose prompt says so changes Rust.
- **Not allowed:** Playwright/e2e, `npm run build`, `npm run package`, anything from `seedelf-data/target` or `cargo run` under `seedelf-data/`, live network runs, prettier, and GitHub writes.
- **Scratch files:** in your worktree's tests as `zz-r172-fix-<label>-*.test.ts`, or under the scratchpad's `review/work/`. Delete the ones in your worktree before you make the patch.

## Docs

The lead writes the docs (`docs/**/*.md`) in the main tree while you work, so leave them alone. Code comments, and the i18n records named above, are yours. If a doc should say something your fix changes, put the sentence in your report.

## Your report (the return value)

- the patch's path, and the files it changes;
- per finding: what you changed, and the tests that pin it (file and test name);
- the evidence: each new test failing before your fix and passing after, the revert check, and the commands with their pass/fail counts;
- typecheck and the guard tests' results, with every failure explained;
- anything you couldn't do, or did differently from the design, and why;
- anything you noticed outside your scope (don't fix it), and any doc sentence your fix needs.
