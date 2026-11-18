# Chunk 51 · The fixers' brief

You fix confirmed findings of chunk 51's whole-code review, by file ownership, in a shared tree. [COMMON.md](COMMON.md) still holds for everything this file doesn't change: the owner's rules, the settled lists, the caps on anything you run.

## The tree

- **FIXTREE** = `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51-fixes`, branch `web-wallet/whole-review-fixes`, from the chunk's branch with the two high fixes already in (r3a#1's box datum spelling and the CLI's stranger rows, r4#1 and r4#2). **Edit only there.** Other fixers work in the same tree at the same time, each on files of their own.
- **Read the findings in the review's folder,** never edit it: `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/docs/plans/review-51/`. A finding's full text is in `lanes/<lane>.md`; its verdicts, the verifiers' fix notes and their failing test in `verify/<id>.md`; every finding on one line in `INDEX.md`.
- **The verifiers' tests** are copied into FIXTREE under their own names (`r51_*.rs`, `r51-*.test.ts`). Each fails on the unfixed code. Make it pass, then move what it checks into the right test file under a name that says what it checks, and delete the `r51` file. Keep the comment that cites the finding's id.

## How you fix

- **Test first.** A finding a test can show gets one that fails before the fix and passes after it: run it both ways and quote both in your answer. Where no test can show it (words on a screen, a race), say how you checked it.
- **Fix the class, not the shape.** If the bug has siblings in your files, fix them too and say so. If a sibling is in another fixer's files, name it in your answer instead of editing it.
- **Your files only.** Your brief lists them. A shared file (the translations `extension/src/i18n/translations/{en,es,ja}.json`, the design docs) gets small anchored edits only (the Edit tool, a unique old string), never a rewrite, since others edit it too. Never reformat a file: there's no prettier config, and `cargo fmt` only on the Rust files you changed.
- **Never** fix a finding marked for the owner, change a frozen thing (COMMON.md), add a refusal of something the ledger and the contracts accept, or change a privacy default.
- **Words the wallet shows:** short, the house style, and always Seedelf and Seedelf Wallet. A new or changed string goes in `en.json`, with `es.json` and `ja.json` given your best translation. A string that warns or makes a privacy statement goes under a key containing `.warn.` or `.privacy.`. List every string you added or changed, with its key, in your answer: the lead has the critical ones back-translated blind.
- **Don't commit.** List the files you changed; the lead commits each group's files by path.

## Commands

From `FIXTREE/seedelf-platform`, each under a cap (`systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 30m nice -n 10 …`):
- Rust: `cargo test -j 4 --locked -p <package> --test <file>` or `--lib`, then the crate's whole suite. The target is shared with the other fixers, so cargo may wait on its lock.
- The extension, from `seedelf-web-wallet/extension`: `npx vitest run <files>`, then the files your change could touch; `npx tsc --noEmit -p .` before you finish.
- **Never** run `wasm/build.sh`, `npm run build`, `npm run package`, `npm ci` or Playwright: the lead rebuilds the WebAssembly between stages. If your TypeScript test needs a Rust change of yours in WebAssembly, say so; the lead runs it after the rebuild.
- **Never** build `seedelf-verification/` (Lean) unless your brief says you may, and then only through `./check.sh <module>`, one at a time.

## Your answer

For each finding: what you changed (file:line), the test (its name, its failing run, its passing run), the siblings you fixed or named, and anything you couldn't do. Then the strings you added or changed, with their keys, and every file you changed.
