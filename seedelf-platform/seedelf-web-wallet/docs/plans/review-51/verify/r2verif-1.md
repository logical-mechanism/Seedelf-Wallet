# r2verif#1: verification

From lane R2verif, graded low by its finder.

## Trace: confirmed, low

Confirmed as described. Running the committed check.sh byte for byte shows it. The only qualifier is that "every module" means every module that builds and imports CekMachine. That is all but Upstream.ExceptParams, and FAILED or TIMEOUT verdicts stay what they are.

The trace, in FIXTREE HEAD:
- check.sh is unmodified in the working copy, and its blob is 6983f6a7.
- check.sh:233 drops only console lines containing `CekMachine.lean:309`.
- :240 counts every other `^warning: .*declaration uses 'sorry'`.
- :242 tests SORRY before UNDETERM.

Where the warning comes from:
- The one sorry in the dependencies' import closure is PlutusCoreBlaster's `runStepsWithBudget` (`decreasing_by sorry`). Of 552 dependency traces in FIXTREE's .lake, only CekMachine.trace holds a warning.
- Lean logs that warning at the declaration's name. The real trace reads `PlutusCore/UPLC/CekMachine.lean:309:4: declaration uses 'sorry'` (the def is at 309, the sorry itself at 324).
- Lake 4.24 replays an up-to-date job's saved log (Build/Common.lean:186-197, `updateAction .replay; data.log.replay`). It then prints any job whose log reaches info as `warning: <message>` (Build/Run.lean:112-143; Util/Log.lean:136-142 and 215-217; no ANSI on a pipe).
- So the line reaches every build whose closure holds CekMachine:
  - 675 of the 676 module names check.sh can build (default list, families, signers, audit families);
  - all 10 of Slice/'s;
  - only Upstream.ExceptParams (imports Blaster alone) is outside.
- The filter dates from the first verification commit 83ae8c2c, which added it to hide exactly this line.

On IOG's main the warning moves:
- At upstream/main 79fce4a the def is at 317 and the sorry at 333. #78's merge 2396bfc is the only commit since 68c5399 that touched the file.
- The toolchain is the same 4.24.0, and no `warn.sorry` option is set at either revision. So the warning becomes 317:4, passes the filter, and unsound=1.
- Every module that builds then reads SORRY and check.sh exits 1. A module whose own check is Undetermined also reads SORRY.
- Chunk 46 step 4 does this move ("require PlutusCore from IOG at that commit … run … ./check.sh, ./check.sh seedelf-slice, the Lovejoin families and audit-quick; compare against … today's counts") and never mentions the filter.

Nothing the finder missed stops it:
- The SORRY test runs only when rc=0, which is the scenario.
- No project file is named CekMachine.lean, so the filter can't hide a real sorry of ours.
- Lean-blaster main still words its proved-goal warning `declaration uses 'blasterProven' …`, which the regex doesn't match, so there is no second misfire on the Blaster move.

Grade: low.
- Who: nobody today. Only the owner, at chunk 46 step 4's planned pin move.
- It fails closed: never a false ok, only a false SORRY on everything. Undetermined is hidden in the summary only.
- It is visible: the 317 warning prints in each module's console output.
- There is a way out: tally.py and Audit/count.py read each module's own trace and are unaffected.
- The cost: the counts that step 4 compares are wrong in check.sh's summary, and run-all.sh records every audit family as failed (exit 1).

Not settled. The finder missed a relative: review-1.9.0's docs-prep#1, left for a verification pass, is the same class for UNDETERM. The SORRY verdict (40883a55) and its line pin are new.

**Evidence:**

FIXTREE: `git status --short` doesn't list seedelf-verification/check.sh. HEAD blob 6983f6a762a88ce774c21f7e60ba2a49e20dac4c.

The lines:
- check.sh:233 `| grep -v -E 'Replayed|CekMachine.lean:309|Successfully decoded|^trace: \.> LEAN_PATH' \`
- :240 `unsound=$(grep -cE "^warning: .*declaration uses 'sorry'|depends on axioms: \[.*(sorryAx|Lean\.ofReduceBool|Lean\.trustCompiler)" "$outf")`
- :241-243 `if [ "$rc" = 0 ]; then if [ "$unsound" -gt 0 ]; then rc=sorry; elif [ "$undet" -gt 0 ]; then rc=undetermined; fi; fi`
- :252 `[ "$rc" = 0 ] || check_failed=1`
- README.md:198 "every one but PlutusCoreBlaster's own, at `CekMachine.lean:309` (`SORRY`)"
- check.sh:238 says the same.

The real dependency trace (read-only), FIXTREE seedelf-verification/.lake/packages/PlutusCore at 68c5399, `.lake/build/lib/lean/PlutusCore/UPLC/CekMachine.trace` log:
`{'message': "PlutusCore/UPLC/CekMachine.lean:309:4: declaration uses 'sorry'", 'level': 'warning'}`
It is the only trace with a warning among 552 dependency traces.

A project trace holds only its own log. Seedelf/WalletRegister.trace: `✅ Valid` (info), `declaration uses 'blasterProven' (SMT-verified, no proof term)` (warning), and the trace-level command line.

Line numbers, read-only `git show` in ../blaster-forks/PlutusCoreBlaster:
- 68c5399 (main pin), 96261cc (Slice pin), cae98df (#77+#73): `309:def runStepsWithBudget`, `324: sorry`.
- upstream/main 79fce4a (2026-11-13): `317:def runStepsWithBudget`, `333: sorry`, under `decreasing_by`.
- `git log 68c5399..upstream/main -- PlutusCore/UPLC/CekMachine.lean` = `2396bfc Merge pull request #78`.
- lean-toolchain is 4.24.0 at both, and no warn.sorry option in either lakefile or file.
- The other library sorries (Bitwise/String Lemmas) sit at both revisions.

Lake 4.24 source (~/.elan/toolchains/leanprover--lean4---v4.24.0/src/lean/lake/Lake):
- Build/Common.lean:192-196 `if (← inline <| checkHashUpToDate …) then updateAction .replay; data.log.replay`.
- Build/Run.lean:122 `let hasOutput := failed || (log.hasEntries && maxLv ≥ outLv)` … :140 `log.replay (logger := .stream out outLv useAnsi)`.
- Util/Log.lean:126-129 normal = info; :142 `s!"{self.level}: {self.message}"`; :54 ANSI only on a TTY.

Import closure (r2v1_closure.py, source `import` lines only, nothing built): of the 676 module names check.sh can build, only Upstream.ExceptParams lacks PlutusCore.UPLC.CekMachine. All 10 of Slice/modules.txt reach it.

Chunk 46 plan, step 4: "#73 and #77 on main: require PlutusCore from IOG at that commit, in both lakefiles … After each one: run ./extract.sh and the Lovejoin extracts, ./check.sh, ./check.sh seedelf-slice, the Lovejoin families and audit-quick; compare against chunk 40's baseline and today's counts". Its "upstream check of 2026-11-12" lists other things to change on the move (`isErrorState`, `blasterProven`'s private name for PrintAxioms/count.py), but not this filter.

The other readers:
- tally.py:101-117 and Audit/count.py:108-119 read only the module's own trace log.
- Audit/run-all.sh:33-36 takes check.sh's exit status per family (`failed+=("$f (exit $rc)")`) and exits nonzero.

The run is quoted in test_result: committed check.sh and tally.py, blob hashes matched, real systemd-run, only `lake` faked. At :309 it gives ok / UNDETERM / SORRY. At :317 it gives SORRY / SORRY / SORRY (counts 1, 1, 2) and exit 1 even for the clean module. tally.py on the same builds' own traces calls the clean module ok and tells the other two apart.

**Known:** Not settled; nothing records the line pin, and the SORRY verdict is new in 40883a55.

Searched:
- backlog.md, docs/archive/plans/, chunk-46 and chunk-49 plans, SECURITY.md;
- seedelf-verification README.md, CLAIMS.md, Audit/README.md, Audit/review/findings.md and findings.json;
- review-51's owner-calls.md, INDEX.md, FINDINGS.md, FIX.md and verify/v5-2.md.
Terms: CekMachine, 309/317, runStepsWithBudget, Replayed, "declaration uses 'sorry'", SORRY, importer, replayed.

What the search found:
- review-1.9.0.md:67, "Left for a verification pass: #372's check.sh counts an import's replayed Undetermined warning as the importer's own (docs-prep#1)". That is the same class, console verdicts carrying imports' replayed logs, for UNDETERM. The finder's known-check missed it.
- The audit's `checksh-cannot-tell-replay` (low) cites the same grep, but for another symptom: a replay reads like a fresh build.
- Chunk 46 step 4 and its "upstream check of 2026-11-12" list other items to change on the move (`isErrorState`, `blasterProven`'s private name), not this filter.
- owner-calls.md has nothing on it.

**Fix notes:**

What to change, in FIXTREE seedelf-verification/:

1. Decide SORRY and UNDETERM from the module's own log, not the whole console.
   - After a build with rc=0, read `.lake/build/lib/lean/<path>.trace`'s `log`, as tally.py:101-118 and Audit/count.py:108-119 do. That trace is this run's: Lake writes it when the build ends, and check.sh now forgets a failed one.
   - Count on that log: `declaration uses 'sorry'`, the axiom names, and `Undetermined`.
   - This drops PlutusCoreBlaster's sorry, which lives in PlutusCore's own trace, whatever line it moves to. It also fixes docs-prep#1: an in-package import's replayed Undetermined or sorry stops being charged to the importer.
2. If a console-only patch is wanted for now, stop keying on the line.
   - Drop `declaration uses 'sorry'` lines whose path is a dependency's: `^warning: (PlutusCore|Blaster|CardanoLedgerApi|Cryptograph)/` or anything under `.lake/packages/`. The project has no such top-level folder, and no file named CekMachine.lean.
   - At the very least, use `CekMachine.lean:[0-9]+:[0-9]+: declaration uses 'sorry'`.
   - Keep the console filter for display only.
   - The `#guard_msgs` axiom guards on the CLAIMS theorems still catch a dependency sorry that actually reaches a theorem.
3. Report both counts when both are non-zero, e.g. `SORRY M (1 sorry, 2 Undetermined …)`, so one verdict never hides the other.
4. Reword README.md:198 and check.sh:236-238 to match.
5. Add "check.sh's sorry filter" to chunk 46's on-the-move list, beside `blasterProven`'s private name for PrintAxioms and count.py.

Check it: rerun /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/scratchpad/r51/work/verify-r2verif_1-trace/r2v1_fixture.sh. With option 1 the fake needs a real trace per module, as in its tally half. At 317 the summary should read ok / UNDETERM / SORRY, as it does at 309.

Class: check.sh's verdicts read a console that carries every import's replayed log. Members:
- this one, a dependency's sorry masked only by a source-line pin;
- review-1.9.0's docs-prep#1, the UNDETERM verdict, left for a verification pass;
- R2verif's own note (R2verif.md:175), an in-package import's sorry.

Kin: tooling keyed on an upstream artefact that moves with the pin, which chunk 46 step 4 must sweep.

No refusal, privacy default or screen change, so no owner call beyond review.

**Test:** `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/scratchpad/r51/work/verify-r2verif_1-trace/r2v1_fixture.sh`

Result: Run as `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 5m bash ./r2v1_fixture.sh`. The output is saved in /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/scratchpad/r51/work/verify-r2verif_1-trace/r2v1_run.txt. Each module's console lines are trimmed here; the full output is in that file.

check.sh: HEAD blob 6983f6a762a88ce774c21f7e60ba2a49e20dac4c, copy 6983f6a762a88ce774c21f7e60ba2a49e20dac4c
tally.py: HEAD blob 56fc2baa5ab8c19af064173c6d810c73cf54c1a4, copy 56fc2baa5ab8c19af064173c6d810c73cf54c1a4

$ ./check.sh Fx.At309.Clean
  == Fx.At309.Clean (cap 8G, limit 10m)
  ⚠ [80/80] Built Fx.At309.Clean
  info: Fx/At309/Clean.lean:9:0: ✅ Valid
  ...
  == summary
  ok        Fx.At309.Clean (0s, peak 4 MB)
  exit 0

$ ./check.sh Fx.At317.Clean
  == Fx.At317.Clean (cap 8G, limit 10m)
  warning: PlutusCore/UPLC/CekMachine.lean:317:4: declaration uses 'sorry'
  ⚠ [80/80] Built Fx.At317.Clean
  info: Fx/At317/Clean.lean:9:0: ✅ Valid
  ...
  == summary
  SORRY     Fx.At317.Clean (1 sorry or native_decide, 0s, peak 3 MB)
  exit 1

$ ./check.sh Fx.At309.Clean Fx.At309.Undet Fx.At309.OwnSorry
  == summary
  ok        Fx.At309.Clean (0s, peak 4 MB)
  UNDETERM  Fx.At309.Undet (1 Undetermined, 0s, peak 3 MB)
  SORRY     Fx.At309.OwnSorry (1 sorry or native_decide, 0s, peak 4 MB)
  exit 1

$ ./check.sh Fx.At317.Clean Fx.At317.Undet Fx.At317.OwnSorry
  (each module's console starts with: warning: PlutusCore/UPLC/CekMachine.lean:317:4: declaration uses 'sorry')
  == summary
  SORRY     Fx.At317.Clean (1 sorry or native_decide, 0s, peak 4 MB)
  SORRY     Fx.At317.Undet (1 sorry or native_decide, 0s, peak 4 MB)
  SORRY     Fx.At317.OwnSorry (2 sorry or native_decide, 0s, peak 3 MB)
  exit 1

$ python3 -I tally.py Fx      (the same three builds at 317, from their own traces)
  NOT OK   Fx.At317.OwnSorry: a sorry
  NOT OK   Fx.At317.Undet: Undetermined, 0 Valid where it expects 1
  == Fx: 3 modules, 2 Valid, 0 Expected Falsified, 2 not ok

What the run shows:
- At 309, today's pins, the filter works: ok, UNDETERM and SORRY each land where they belong.
- At 317, IOG's main, the dependency's warning passes the filter. A clean module reads SORRY and check.sh exits 1. An Undetermined module reads SORRY. A real sorry differs only by its count (2, not 1).
- tally.py, reading each module's own trace, calls the clean module ok and tells Undetermined from sorry.

```
#!/usr/bin/env bash
# r2verif#1: does check.sh's SORRY verdict key on PlutusCoreBlaster's sorry sitting at CekMachine.lean:309?
# Runs FIXTREE's committed check.sh byte for byte (blob hash checked), with only `lake` faked. The fake
# prints what Lake 4.24 prints, piped (no ANSI), for a module whose import closure holds
# PlutusCore.UPLC.CekMachine: that job's replayed caption and its saved warning, worded exactly as
# .lake/packages/PlutusCore/.lake/build/lib/lean/PlutusCore/UPLC/CekMachine.trace logs it, at line 309
# (68c5399, 96261cc and cae98df: every pin today) or 317 (IOG's main 79fce4a, after #78). Then the
# module's own job. systemd-run is the real one. Then tally.py (committed, byte for byte) on the same
# builds' own traces, which never hold an import's log. Nothing here runs Lean or Lake.
FIX=/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51-fixes
S=$(cd "$(dirname "$0")" && pwd)
W=$S/r2v1_fx
rm -rf "$W"; mkdir -p "$W/sv/Seedelf/Signers" "$W/bin" "$W/tmp"
git -C "$FIX" show HEAD:seedelf-verification/check.sh > "$W/sv/check.sh"
git -C "$FIX" show HEAD:seedelf-verification/tally.py > "$W/sv/tally.py"
git -C "$FIX" show HEAD:seedelf-verification/Seedelf/Signers/modules.txt > "$W/sv/Seedelf/Signers/modules.txt"
echo "check.sh: HEAD blob $(git -C "$FIX" rev-parse HEAD:seedelf-verification/check.sh), copy $(git hash-object "$W/sv/check.sh")"
echo "tally.py: HEAD blob $(git -C "$FIX" rev-parse HEAD:seedelf-verification/tally.py), copy $(git hash-object "$W/sv/tally.py")"
cat > "$W/bin/lake" <<'EOF'
#!/usr/bin/env bash
# Fake `lake build Fx.<At309|At317>.<Clean|Undet|OwnSorry>`.
[ "$1" = build ] || exit 2
m=$2; IFS=. read -r _ at kind <<<"$m"; line=${at#At}; f="Fx/$at/$kind.lean"
echo "⚠ [41/80] Replayed PlutusCore.UPLC.CekMachine"
echo "warning: PlutusCore/UPLC/CekMachine.lean:$line:4: declaration uses 'sorry'"
echo "⚠ [80/80] Built $m"
case $kind in
  Clean)    echo "info: $f:9:0: ✅ Valid"
            echo "warning: $f:9:0: declaration uses 'blasterProven' (SMT-verified, no proof term)" ;;
  Undet)    echo "warning: $f:9:0: ⚠️ Undetermined" ;;
  OwnSorry) echo "info: $f:9:0: ✅ Valid"
            echo "warning: $f:9:0: declaration uses 'blasterProven' (SMT-verified, no proof term)"
            echo "warning: $f:12:8: declaration uses 'sorry'" ;;
esac
echo "Build completed successfully."
exit 0
EOF
chmod +x "$W/bin/lake" "$W/sv/check.sh"
run() {
  echo; echo "\$ ./check.sh $*"
  ( cd "$W/sv" && PATH="$W/bin:$PATH" TMPDIR="$W/tmp" ./check.sh "$@" ) | sed 's/^/  /'
  echo "  exit ${PIPESTATUS[0]}"
}
run Fx.At309.Clean
run Fx.At317.Clean
run Fx.At309.Clean Fx.At309.Undet Fx.At309.OwnSorry
run Fx.At317.Clean Fx.At317.Undet Fx.At317.OwnSorry

# The same three builds as tally.py reads them: each module's own trace, as Lake writes it (the real
# FIXTREE Seedelf/WalletRegister.trace holds exactly a trace line, ✅ Valid and the blasterProven warning).
for kind in Clean Undet OwnSorry; do
  mkdir -p "$W/sv/Fx/At317" "$W/sv/.lake/build/lib/lean/Fx/At317"
  printf 'import PlutusCore.UPLC\n\n#blaster [∀ x : Nat, x = x]\n' > "$W/sv/Fx/At317/$kind.lean"
done
f=Fx/At317
python3 -I - "$W/sv/.lake/build/lib/lean/$f" "$f" <<'EOF'
import json, sys
d, f = sys.argv[1], sys.argv[2]
own = {
  "Clean":    [("info", "✅ Valid"), ("warning", "declaration uses 'blasterProven' (SMT-verified, no proof term)")],
  "Undet":    [("warning", "⚠️ Undetermined")],
  "OwnSorry": [("info", "✅ Valid"), ("warning", "declaration uses 'blasterProven' (SMT-verified, no proof term)"),
               ("warning", "declaration uses 'sorry'")],
}
for kind, entries in own.items():
    log = [{"level": "trace", "message": f".> LEAN_PATH=… lean {f}/{kind}.lean --json"}]
    log += [{"level": lv, "message": f"{f}/{kind}.lean:9:0: {msg}"} for lv, msg in entries]
    json.dump({"depHash": "0", "inputs": [], "outputs": {}, "synthetic": False, "log": log},
              open(f"{d}/{kind}.trace", "w", encoding="utf-8"))
EOF
touch -d "@$(( $(date +%s) + 60 ))" "$W/sv/.lake/build/lib/lean/$f"/*.trace
echo; echo "\$ python3 -I tally.py Fx      (the same three builds at 317, from their own traces)"
( cd "$W/sv" && python3 -I tally.py Fx ) | sed 's/^/  /'
```
