# v-pr325-1-trace: pr325#1, the C compiler line paraphrased

**Verdict: partly. Severity: nit.** Confidence: high.

## What holds

The 1.6.0 record leaves out the package revision that the build printed. The docs say to keep the line itself.

- `wasm/build.sh:77`: `echo "C compiler: $("$CC_wasm32_unknown_unknown" --version 2>/dev/null | sed -n 1p || echo unknown)"`
- Both 1.6.0 builds printed `C compiler: Ubuntu clang version 21.1.8 (6ubuntu1)`: the owner's build (`09bbfc44…/scratchpad/owner-package-1.6.0.log:283`) and the build in a separate clone (`clone-package.log:197`).
- `docs/development.md:246-248`: "**Keep for the release record** … `wasm/build.sh`'s last line, `C compiler: <first line of clang --version>`". Lines `:262` and `:291` also say to record "the C compiler, Node and zlib lines".
- `docs/roadmap.md:63` (PR #325, `a2765e8e`) says only "Ubuntu clang 21.1.8 (18.1.3 at 1.5.0: …)". PR #325's description says the same.
- **Only the compiler line loses information.** The build printed `Zipped with Node v24.19.0, zlib 1.3.2.1-motley-3246f1b`, and the record keeps both versions in full: "Node 24.19.0 (its own zlib, 1.3.2.1-motley-3246f1b)".
- **The record is now the only lasting copy.** `/tmp` is `tmpfs`, so both logs that hold the full line disappear at the next reboot. Today the revision can still be recovered: `dpkg-query` shows `clang-21 1:21.1.8-6ubuntu1`, and running `clang --version` now prints the same line.

## Narrower or different than stated

1. **It isn't a slip in #325. Every record has done it since the line was added.** `build.sh`'s line and development.md's "keep" rule both came in `4279db80` (the 1.2.0 review fixes). The records for 1.2.0, 1.3.0, 1.4.0, 1.4.1 and 1.5.0 (`roadmap.md:136,133,116,115,90`) all say "Ubuntu clang 18.1.3". Every one of those builds came before the 2026-10-13 14:38 PDT apt run:
   - #307, 1.5.0's record, merged at 09:00 PDT that day.
   - `clang-18 1:18.1.3-1ubuntu1` had been installed since 2026-06-16.

   So each of those builds printed `… 18.1.3 (1ubuntu1)`, which I inferred from `dpkg.log`; no log of them survives. No record in roadmap.md carries a revision. The finding says "1.5.0's record shortened its line the same way", which understates it: this is the house convention. The 1.7.0 record will follow it too unless the rule changes.
2. **The stated purpose of recording the compiler is already met.** `docs/architecture.md:81` says "another major version gives other code, so `build.sh` ends by printing it (`C compiler: …`) for the release record". The record "Ubuntu clang 21.1.8" carries the major version, and the 1.6.0 record does note the move from 18 to 21. `build.sh:75-76` says "for the release record, never a check": the zip's SHA-256 is the check.
3. **Only half of the scenario holds.**
   - **The "another distribution" half mostly fails.** A non-Ubuntu clang puts its own vendor in `clang --version` (Debian's says "Debian clang version …"), and the record names Ubuntu.
   - **The "another revision" half holds.** The record can't tell this build apart from another Ubuntu-packaged 21.1.8: a different revision or series, or LLVM's own apt.llvm.org packages, which also say "Ubuntu clang version". This only matters when a rebuild's hash differs.
4. **The cited apt evidence is the wrong example.** The move from clang-18 `1:18.1.3-1ubuntu1` to `1:18.1.8-20ubuntu8` changes the upstream version too, and the record's version number already catches that. The same run does have a change of revision alone: `2026-10-13 14:39:59 upgrade libllvm17t64:amd64 1:17.0.6-9ubuntu1 1:17.0.6-23ubuntu7`. So the point stands, but on that line.

## Repro

I ran a scratch test, `extension/tests/zz-review-v-pr325-1-trace-1.test.ts` (Vitest, alone). It read `docs/roadmap.md` and the 1.6.0 log. Result: **1 failed, 3 passed.** I deleted it afterwards.

- Passed: the log holds exactly one compiler line, `C compiler: Ubuntu clang version 21.1.8 (6ubuntu1)`.
- Passed: the record keeps the Node and zlib versions in full.
- **Failed:** the record does not contain `Ubuntu clang version 21.1.8 (6ubuntu1)`. It holds "Ubuntu clang 21.1.8".
- Passed: five earlier records say "… and Ubuntu clang 18.1.3:", and none in roadmap.md contains `1ubuntu1`, `6ubuntu1` or `clang version`.

## Fix advice

- **1.6.0's record:** at `roadmap.md:63`, write the line as printed: `C compiler: Ubuntu clang version 21.1.8 (6ubuntu1)`. Take it from the log before a reboot, or from `clang --version` while `clang-21 1:21.1.8-6ubuntu1` is still installed.
- **The rule:** add "copy it as printed" to `development.md:248` (and to `:262`/`:291`). Without that, 1.7.0's record will likely paraphrase again, as six records have.
- **The 1.2.0–1.5.0 records:** leave them alone. Their revision (`1ubuntu1`) is inferred from `dpkg.log`, not printed in any surviving log.
- **Out of scope here:** whether the record needs the revision at all, given that architecture.md:81 names the major version as what matters. That is a matter of wording; nothing is wrong with the zip or the code.
