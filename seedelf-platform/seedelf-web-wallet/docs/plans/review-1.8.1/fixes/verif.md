# 1.8.1's fix round · verif

Lane `verif`, worktree `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-r181-verif` at `2a8060d3`. Everything is uncommitted. Nothing was built: no `lake`, `lean` or `check.sh` run (rule 4). The checks were `bash -n`, a parse-only copy of `check.sh`, an import-closure script, and a Python test of the tools, all in `SCRATCH/fixes/verif/`.

**In short:** every finding in the lane is fixed. Four calls differ from the brief, each with its reason below:

- **The standard command** puts `./check.sh lovejoin-every` before `seedelf-slice && ./check.sh`, not at the end. `./check.sh` always exits 1, since PolicyBurn and PolicyMint fail on `BitVec` by design (README *Not proved*, chunk 42:32, the audit's `policyburn-policymint-no-trace`). Anything chained after it with `&&` never runs.
- **Chunk 42 is archived.** Its one live part, the rule for a property that comes back Falsified (who to tell, nothing posted), moved first into seedelf-verification's README.
- **The audit's scope.** It covers none of the every-transaction modules CLAIMS.md cites, not only chunk 45's, so critic#1's "up to 2026-11-05" would also be wrong. README:7 and Audit/README.md:3 now say what it reviewed.
- **The Lovejoin pool's name in extract-lovejoin-v2.sh.** Its comments and two printed lines call `dc6abe3b…` "the mainnet 5 ₳ pool". They now say *retired* (claims#2's second half). No logic changed.

## The findings

### claims#1 (medium), trust#4, critic#2: CLAIMS.md's *Where it stops*, in one rewrite · fixed

- **`CLAIMS.md:5`:** "IOG's model of the Plutus machine (our fork of it)".
- **`CLAIMS.md:23–27`:** three new bullets, and the ledger's rules restated (claims#10):
  - **Seedelf's Blaster results are Z3's word** (critic#2). This covers `blasterProven` with no proof check, the step limit and each family's returns-unit-or-error theorem, #389 and the bytestrings, and what is kernel-checked instead.
  - **The machine is IOG's model, on our fork** (claims#1). In PlutusCoreBlaster's own words, it is "working toward conformance": the suite runs apart from its CI and leaves out what isn't implemented yet. It isn't proved equal to the node. The bullet names the three fork changes upstream doesn't have yet, none of which changes evaluation.
  - **The bytes and the context, as read** (trust#4). It covers the flat decoder and CardanoLedgerApiBlaster's encodings, neither proved to match the node, and says the decoder was checked against Aiken once, by `FlatDecodeCheck`, not in every build.
- **Checked against the sources:**
  - The PlutusCoreBlaster README at the pin (`.lake/packages/PlutusCore` in the main tree, read only) has the conformance wording claims#1 quotes.
  - `lakefile.lean:7–12` lists #27's `serialise_data` among the fork's changes.
- **Kept consistent elsewhere:**
  - `README.md:34` now lists #27's `opaque` `serialise_data`, which it had left out.
  - `:36` says #71 and #72 have merged and the rest haven't.
  - `:100`'s machine bullet says "working toward conformance", and that the suite never runs the flat decoder; its `ByteStringToInteger` is "#71's alias, on our fork and upstream since".
  - `Lovejoin/AnyTx/README.md:104–109` gives the aliases as claims#1 says: `serialise_data` and xor through the fork, `byteStringToInteger` upstream's too. It adds "on our fork" and a pointer to CLAIMS.md.
- **Tests:** none. Wording only.

### claims#10 (nit): the hypotheses, summarized too narrowly · fixed

- **`CLAIMS.md:27`:** "A value as the ledger forms it (ADA first, sorted, every quantity positive), a mint likewise (no ADA, no zero quantity), and an input in every transaction."
- Checked against `validTxOutValue` (V1 `Contexts.lean:808`) and V3's `validMintValue` (`:869`).
- `README.md:78` is fidelity#1's, below.

### claims#2 (low): the live pool's line · fixed

- **`CLAIMS.md:19`:** "Mainnet's live v2 pool (`fcb3f5ec…`) runs exactly those templates applied: a test in the wallet's WebAssembly crate holds the template files to the bytes the wallet derives pools from, and derives that pool's policy, mix_logic and mix_box from them, hash for hash."
- That test is the rust lane's. Its file isn't named here, since it didn't exist yet when I wrote this; check the line against what lands (*For the lead*).
- **`extract-lovejoin-v2.sh:11–16`, `:65–66`, `:92`, `:95`:** `dc6abe3b…` is mainnet's first 5 ₳ pool, on 8131b1d's templates and retired since 1.8.0. The live v2 pool is these templates applied.
  - `bash -n` passes, and its Python heredoc parses (`ast`).
  - Not run: it needs Aiken and `../lovejoin` checked out at 29573c5.

### fidelity#1 (low): README:68's hypotheses · fixed

- **`README.md:78`** now says each result characterizes its script in every typed V3 context:
  - reference_holder errors in all of them;
  - mix_box's is an iff with no hypothesis;
  - mix_logic's and one_shot_mint's are iffs under the ledger's value rules: on the reference inputs' values for mix_logic, on the mint and the outputs' for one_shot_mint (CLAIMS.md, *Where it stops*).
- **Tests:** none. Wording only.

### fidelity#2 and claims#3 (low): the standard command · fixed, in another place

- **`README.md:46`:** `… && ./check.sh lovejoin-any-tx && ./check.sh lovejoin-every && ./check.sh seedelf-slice && ./check.sh`.
- **`:49–51`:** the family builds the 51 imported modules first, then its 25, at 16 GB and 30 minutes a module. `./check.sh` goes last, because it ends nonzero (see *In short*).
- **`:40`:** the caps line now says "8 GB and 10 minutes; `lovejoin-every` and its modules 16 GB and 30 minutes" (claims#5's README half).

### claims#8 (low): the *Next* line · fixed

- **`README.md:162`:** "Every script in scope is characterized in every transaction, mix_logic's and one_shot_mint's in the Aiken source's terms". Its chunk 45 link now points to the archive.
- **`:163`, beyond the finding:** "four PRs from our forks" now says where they stand: #71 and #72 merged, #455 and #73 open, the xor and slice aliases never offered, #27 a draft. These are chunk 45's checks of 2026-11-06.

### critic#1 (low): the audit's scope · fixed, worded otherwise

- **`README.md:7`:** "`Audit/` is a review of the proofs as they stood on 2026-11-03, before the every-transaction modules".
- **`Audit/README.md:3`:** it reviews the scenario families. It doesn't cover Seedelf's `*AnyTx*`, `Signers/`, `LinesAll` and `Shapes` modules, `Slice/`, `Lovejoin/AnyTx/` or `Lovejoin/Every/`.
- **Checked:**
  - No `Audit/*.lean` imports any of them, and no `Audit/audit-*.txt` lists one.
  - `Audit.Checks.PrintAxioms` imports scenario modules only.
  - So "up to 2026-11-05" would be wrong too.

### claims#7 (low): README:7's pointer, and chunk 42's plan · fixed, archived

- **`README.md:7`:** "CLAIMS.md and Lovejoin/AnyTx/README.md say what they cover and what they leave out; chunk 42 is the record" (the link now points to the archive).
- **Chunk 42's plan, now `docs/archive/plans/chunk-42-lovejoin-verification.md`:**
  - a status line;
  - rows 9 (1.8.0, chunk 44, #363 and #364; the live pool) and 10 marked ✅;
  - next steps 2–4 marked ✅;
  - "Not lifted" replaced by what lifted it (`BoxPurposesAll`, chunk 45), with a pointer to CLAIMS.md;
  - "What the claim can say" now points to CLAIMS.md and says the old draft's limits (4 boxes, the scenario layouts) are lifted. Its results paragraph stays, as "The wallet's own code isn't covered, but what a wrong Mix does is";
  - "Where everything is, for a new session" becomes "Where everything was";
  - step 9's heading marked ✅;
  - *What its PRs did* at the end: #362 (`c15603d5`), #363 and #364, #368, and this round.
- **The Falsified rule** was the plan's only live part. It moved, word for word, into `README.md:147–158` (*When a Lovejoin property comes back Falsified*). Only its stale last bullet ("This branch merges into `verification`…") was dropped. The plan points there.

### claims#6 (low): chunk 45's plan · fixed, archived

- **New `Lovejoin/Every/README.md`** holds what still holds, moved out of the plan:
  - building, with the caps, the 51 imports, and which modules pass 8 GB;
  - the method, with `bsimp` and `rsimp`;
  - every pitfall: the plan's list, the launch's (its line 119), the two more at 121, the readable layer's (188), and the tail-position walk (171);
  - the tools;
  - the module table, made one table: the plan's blank lines had split it into fragments with no header, which render as text.
- **The AnyTx README links it** (`Lovejoin/AnyTx/README.md:70`).
- **The plan's upstream checks** of 2026-11-06 went into chunk 41's *Where upstream stands* (`chunk-41-blaster-fixes.md:266–279`), word for word.
- **`mv`'d to `docs/archive/plans/chunk-45-lovejoin-every-tx.md`:**
  - *Where things are* rewritten. The worktree is now history, and "nothing is committed, ask the owner" is gone. The "11 minutes" run is "with everything the family imports already built". The limits are the owner's, and six of the 25 pass 8 GB.
  - The dates are the owner's: 2026-11-07 (UTC) becomes 2026-11-06 in four places. #368's commits are 2026-11-06 20:47 −0800.
  - The moved sections are replaced by a pointer.
  - "What's left, in order" becomes "The steps, in order (all done)", and "The original list" becomes "…, all done".
  - It ends with *What its PR did*: #368, `d190f717`, `32f80205` and `e6897cde`, then this round.
- **Checked:**
  - A sentence-by-sentence script finds every sentence of the old plan in the record, the README or chunk 41, except the lines rewritten on purpose (the stale ones, the dates, the corrected peaks).
  - Every relative link in the eight changed Markdown files resolves (0 broken).
  - No tracked file links to `docs/plans/chunk-42…` or `chunk-45…` any more. The audit's JSONs cite them by name with old line numbers, as evidence, and stay.

### critic#4 (nit): the AnyTx README's opening · fixed

- **`Lovejoin/AnyTx/README.md:3–5`:** "its modules are also imported by `Lovejoin.lean` (the `Lovejoin/Every/` ones below aren't: run `./check.sh lovejoin-every`)".
- **Checked:**
  - All 141 `lovejoin-any-tx` modules are reached from `Lovejoin.lean` (128 directly), and no Every module is.
  - Two AnyTx files, `LogicOwnerPrefix` and `LogicOwnerParserReach`, are in no family and not imported (*For the lead*).

### claims#5 (low): an Every module named alone gets 8 GB · fixed

- **`check.sh:26`:** `for a in "$@"; do case $a in lovejoin-every|Lovejoin.Every.*) CAP=${CAP:-16G}; LIMIT=${LIMIT:-30m} ;; esac; done`.
- **Comments:** `:19–20` and `:22` (the header) and `:25`.
- **Test** (a parse-only copy of `check.sh`, cut before its build loop, run from the worktree's folder): `SCRATCH/fixes/verif/parse-only.sh` and `cases.sh`. The outputs are `cases.before.txt` and `cases.after.txt`.
  - Before: `./check.sh Lovejoin.Every.Collect` gives `CAP=8G LIMIT=10m`. Collect peaks at 12,782 MB, so it is killed.
  - After: `CAP=16G LIMIT=30m`.
  - `Seedelf.PolicyMint` keeps 8G/10m, `CAP=12G` still wins, and `CAP=` falls back to 16G.
  - Every other family's list and caps are byte-identical before and after (17 cases).
  - A run naming an Every module beside others gives all of them 16G/30m, since the caps are per run.

### claims#4 (low): the family lists none of its 51 imports · fixed

- **`check.sh:144–166`:** `every_imports=(…51…)`, then `every=("${every_imports[@]}" …the 25…)`.
- **Test:**
  - My own closure script (`SCRATCH/fixes/verif/imports.py`, which strips comments and reads every name on an import line) finds the same 51 as the claims lens, in the same order.
  - Before: 4 of the 25 scopes build others first: Base 9, Withdraw 3, Typed 2, Readable 37.
  - After: the parse-only copy gives `n=76 first=Seedelf.LinesAllCek last=Lovejoin.Every.Readable`, the 51 and then the 25. The closure script finds 76 scopes, none building more than its own module.
  - `bash -n check.sh` passes.
- **Blaster:** only `Lovejoin.Template.AnyTxPurposes` among the 51 runs it (17 calls). The Every README says so.

### fidelity#3, trust#3, claims#9 (nit): guards on the cited theorems · fixed, not built

- **`Lovejoin/Every/Readable.lean:303–309`:** `#guard_msgs in #print axioms` for `mix_logic_accepts_iff` and `one_shot_mint_accepts_iff`, each expecting `[propext, Classical.choice, Quot.sound]`. They are copied from the `_valid` guards' form, in the same file.
- **Why they pass:**
  - Each base iff starts `rw [every_context_iff]` or `rw [mint_every_context_iff]`, both guarded at exactly those three. So its axioms are at least those.
  - Each `_valid` form is proved by its base and guarded at those three. So they are at most those.
  - The messages are 106 and 110 characters, under Lean's 120-column width. The longest guard passing today in that file is 116.
- **The test is the guard.** Not run (rule 4). A `sorry` or `blasterProven` behind either cited theorem would change the message and fail the build, whatever the `_valid` proofs do.
- **The lead's build:** `./check.sh Lovejoin.Every.Readable` (16 GB and 30 minutes by default now).

### claims#11 (nit): the tools' path parsers · fixed

- **Changed:** `tools/fillpaths.py:13–21`, `pp.py:4–14` and `lpath.py:1–5`. Each reads a step as `\(\d+\)|\d`, as `scope.py`'s `P` does.
  - fillpaths' `PATH(n, -k)` drops k steps, not k characters.
  - pp compares the base by steps.
- **Test:** `SCRATCH/fixes/verif/test_tool_paths.py`, on a pseudo file with steps of 10 and more, checked against `scope.py`'s parser.
  - Before: 7 checks fail. fillpaths stops at `(`, giving `[0]` for `@0(12)3`. pp and lpath print `(,1,2,)`.
  - After: 0 fail.
- **No regression:** over the claims lens's real pseudo files (mix_logic's 899 lines with a path, one_shot_mint's 275), pp and fillpaths give byte-identical output to the originals. lpath gives the same on all 1,174 real paths.
- **Bytecode:** the run left a `__pycache__` in the worktree's `tools/` (gitignored). I deleted it.

### trust#2 (low): the `.hex` files aren't Lake inputs · open again, with the manual step

- **`README.md:25–29`, in *Running it*, beside the extract commands:** after an extract run, `rm -f .lake/build/lib/lean/{Seedelf,Lovejoin,Lovejoin/V2,Lovejoin/Template}/Scripts.{olean,trace} Slice/.lake/build/lib/lean/Slice/Scripts.{olean,trace}`. The Slice part is beyond the finding: `Slice/Slice/Scripts.lean:15` reads `../Seedelf/Scripts/seedelf.hex` the same way.
- **`Audit/review/findings.md:91`:** "**Open** (found again by 1.8.1's release review)", with the step.
- **`findings.json:186`:** a `"status"` on that entry. The file has no status field anywhere else, and nothing reads it. It still parses (51 entries).
- **The real fix** (an `input_dir` per Scripts folder, plus `needs`) waits for the next full run, as trust#2 says.

## Files

- **Changed:**
  - `seedelf-verification/CLAIMS.md`
  - `seedelf-verification/README.md`
  - `seedelf-verification/Audit/README.md`
  - `seedelf-verification/Audit/review/findings.md`
  - `seedelf-verification/Audit/review/findings.json`
  - `seedelf-verification/Lovejoin/AnyTx/README.md`
  - `seedelf-verification/Lovejoin/Every/Readable.lean`
  - `seedelf-verification/Lovejoin/Every/tools/fillpaths.py`, `lpath.py` and `pp.py`
  - `seedelf-verification/check.sh`
  - `seedelf-verification/extract-lovejoin-v2.sh`
  - `seedelf-platform/seedelf-web-wallet/docs/plans/chunk-41-blaster-fixes.md`
- **New:** `seedelf-verification/Lovejoin/Every/README.md`.
- **Moved with `mv`, then edited:**
  - `seedelf-platform/seedelf-web-wallet/docs/plans/chunk-42-lovejoin-verification.md` to `docs/archive/plans/chunk-42-lovejoin-verification.md`;
  - `seedelf-platform/seedelf-web-wallet/docs/plans/chunk-45-lovejoin-every-tx.md` to `docs/archive/plans/chunk-45-lovejoin-every-tx.md`.
- **i18n keys:** none.

## For the lead

- **The rust lane's test is described, not named.** CLAIMS.md:19 and extract-lovejoin-v2.sh:15–16 say a WebAssembly test holds the template files to the wallet's v2 bytes and derives the live pool's three hashes. If what lands does less, or lives elsewhere, change those two lines. Once it lands, its name could go in CLAIMS.md:19 (the docs lane says the same for `seedelf-platform/CLAUDE.md:86`).
- **Chunk 41's status table is stale.** Step 2's row says PR #71 is open (🚧). The upstream list I moved in says #71 merged on 2026-11-05. The table is outside my part of that plan. One cell, if you want it: "✅ merged 2026-11-05 (`6b4260a`)".
- **The guards are unbuilt.** `./check.sh Lovejoin.Every.Readable`. With claims#5's fix it gets 16 GB and 30 minutes alone.
- **Two stray AnyTx modules.** `Lovejoin/AnyTx/LogicOwnerPrefix.lean` and `LogicOwnerParserReach.lean` (from `a04ca256`, #362) are in no `check.sh` family and not imported by `Lovejoin.lean`, so no documented command builds them. Nothing cites them. I left them alone, and the call is the owner's.
- **CI (the owner's, trust#1's note):** web-wallet.yml's changes filter skips the Rust job for a pull request that touches only `seedelf-verification/`. A `.hex`-only edit would fail the rust lane's tie only after merge.
- **Memory, outside the repository:** the chunk-45 and chunk-42 lines in MEMORY.md still call #368 unmerged and the plans live.
- **Scratch:** `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/cfcbd3c7-4fba-46f9-8be7-526fb876c645/scratchpad/fixes/verif/`.
  - Scripts: `parse-only.sh`, `cases.sh`, `imports.py`, `closure-run.sh` and `test_tool_paths.py`.
  - The original `check.sh` and tools: `check.before.sh` and `tools.before/`.
  - Outputs: `cases.before.txt`, `cases.after.txt`, `family.after.txt` and `outside.txt`.

## What I ran last

- `bash -n seedelf-verification/check.sh`: ok. `bash -n seedelf-verification/extract-lovejoin-v2.sh`: ok, and its heredoc parses.
- `bash cases.sh <check.sh> <dir>`, before and after:
  - only the `lovejoin-every` and Every-module cases differ;
  - `lovejoin-every` gives `n=76 first=Seedelf.LinesAllCek`;
  - `Lovejoin.Every.Collect` gives `CAP=16G LIMIT=30m`.
- `imports.py scopes` over the new family: 76 scopes, 0 building more than their own module.
- `python3 -I -B test_tool_paths.py`: the original tools fail 7 checks; the fixed ones pass on both real pseudo files.
- `python3 -I -m py_compile` on all seven tools: ok.
- The link check over the eight changed Markdown files: 0 broken.
- `python3 -I` `json.load` of `findings.json`: ok, 51 entries.
