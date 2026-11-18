# r2verif#3: verification

From lane R2verif, graded low by its finder.

## Trace: confirmed, low

The finding holds as described, and I couldn't make the path miss. I traced it in FIXTREE's committed code (its seedelf-verification has no uncommitted changes) and in Lake 4.24's own source.

1. When a module in a dependency package fails to compile, Lake prints exactly one line for it, `✖ [n/m] Building <bare module name> (time)`. Its in-package dependents print no line at all.
2. check.sh:249 picks that name up. forget() returns at check.sh:218, because `PlutusCore/UPLC/CekMachine.lean` isn't under seedelf-verification/.
3. check.sh:250 then skips forgetting the module asked for, because a name was found.
4. So nothing is removed. tally.py and count.py follow only in-package imports (tally.py:80, count.py:85), and they read the last pin's traces as ok.

My fixture run shows it with check.sh's own lines (:215-223, :233, :239-263, verbatim from HEAD f88560c4) and HEAD's tally.py and count.py:
- check.sh's summary says FAILED for both modules;
- all 20 build files are unchanged;
- tally.py says '0 not ok';
- count.py says '2 ok'.

The in-package control behaves as 40883a55 intends (NO TRACE, then STALE). The finder's simplest fix closes the case (both readers report NO TRACE).

Grade: low, as the finder said.
- **Who:** nobody. Only the owner's proof tooling is affected, after a re-pin (chunk 46 step 4, plan:131-132, with plan:45's note that both upstream mains now require Lean-blaster main) or with a path-required local PlutusCoreBlaster branch.
- **Cost:** a Valid count taken from tally.py or count.py could include modules that don't build on the new pin.
- **Way out:** check.sh's summary lists FAILED for every module and exits 1. Under run-all.sh, count.txt also names the failed family.
- **Today:** no dependency fails to compile.

Corrections and additions to the finding:
- The `Building` arm of `JobAction.verb` is Job/Basic.lean:54, not :52.
- Under a pipe the ✖ line ends with a time, e.g. ` (4.2s)` (Run.lean:131-132). That is harmless to the `grep -o`.
- Dependents aren't printed as 'Running' either in check.sh's non-verbose run: they print no line at all.
- check.sh's own header (:9-11) and its comment at :244-247 overclaim too.
- The same mechanism applies under Slice/ and Upstream/blaster-main, which have their own dependency packages.

**Evidence:**

FIXTREE = /home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51-fixes at HEAD f88560c4. `git status --short` shows no changes under seedelf-verification, and my script cmp-checks check.sh, tally.py and Audit/count.py against HEAD. Only commit 40883a55 on main..HEAD touches them.

**check.sh (HEAD):**
- :215-223 forget(). :218 `[ -f "$p.lean" ] || return 0` is relative to the package root (check.sh:34 `cd "$(dirname "$0")"`).
- :249 `failed=$(grep -aoE '✖ \[[0-9]+/[0-9]+\] Building [A-Za-z0-9_.]+' "$outf" | awk '{print $NF}')`.
- :250 `[ "$rc" = 1 ] && [ -n "$failed" ] || failed="$failed $m"`. With rc=1 and a name found, $m isn't added.
- :233's filter doesn't drop the ✖ line.
- Overclaims: :9-11 "A build that fails, times out or is killed loses its last good build's files, so no reader (tally.py, Audit/count.py) takes that build for this one". :244-246 "A module whose import failed … keeps its build: the readers see that what it imports has none". That second one is false when the import is in a dependency.

**The readers:**
- tally.py:80 and count.py:85 follow an import only if `<root>/<path>.lean` exists.
- tally.py:81 and count.py:86 test only that the trace exists.
- tally.py:112 and count.py:102 compare the trace's age only with the module's own source.
- Docstrings: tally.py:14-17, count.py:16-19.

**Other claims:**
- README.md:176 and Audit/README.md:46 say as the finder quotes.
- run-all.sh:41 adds a 'check.sh or run-diag.sh failed: <family>' line to count.txt, but count.py's own lines still say ok.

**The real layout:** TREE's .lake/packages/PlutusCore/PlutusCore/UPLC/CekMachine.lean, with its builds under .lake/packages/PlutusCore/.lake/build/. seedelf-verification/ has no PlutusCore/, Blaster/ or CardanoLedgerApi/ folder. Slice/lakefile.lean requires its own PlutusCore (96261cc), so the same gap applies there.

**Lake 4.24** (~/.elan/toolchains/leanprover--lean4---v4.24.0/src/lean/lake/Lake, read only):
- Build/Module.lean:660 `withRegisterJob mod.name.toString`: the bare name, in any package.
- Build/Common.lean `buildAction`: `updateAction action` (.build) runs before the build, and `writeBuildTrace` only after it returns, so a failed build keeps its old trace.
- Job/Basic.lean:50-54, `.build => if failed then "Building"`.
- Util/Log.lean:92, `.error => '✖'`.
- Run.lean:118 `failed := strictAnd log.hasEntries (maxLv ≥ failLv)`, :124-126 showJob, :132 the line's format.
- Job/Register.lean:44 `return job.renew`, :20-21: renew keeps only the trace, so log and action reset.
- So a dependent whose import failed has no log and action .unknown. It prints nothing (no 'Building' line) and isn't in the failures list.
- Module.lean:100-105's 'bad import' fires only when an import's header graph fails, never on its compile.
- Util/Log.lean:50 `.auto => out.isTty`, so there's no ANSI under check.sh's pipe.

**Plan:** chunk-46-verification-on-upstream.md:45 and :131-136 (step 4: re-pin, run ./check.sh …, compare counts).

**Run (my script, under systemd-run MemoryMax=8G, timeout 20m), exit=1:**
- Case A, a dependency's module fails:
  - check.sh: 'FAILED    Demo.Top (exit 1, 0s)' and 'FAILED    Demo.Down (exit 1, 0s)';
  - files: 'every build file before and after is the same: 20 files, none removed, none changed';
  - tally.py: '== Demo: 2 modules, 2 Valid, 0 Expected Falsified, 0 not ok';
  - count.py: '  ok        Demo.Top: 1 Valid…', '  ok        Demo.Down: 1 Valid…', '== 2 ok'.
- Control B, the in-package Demo.Top fails:
  - forget() printed '== Demo.Top failed: its last good build removed';
  - Top's 8 build files were removed;
  - tally.py: 'Demo.Down: rests on Demo.Top, which has no trace', 'Demo.Top: no trace', '2 not ok';
  - count.py: '0 ok, 1 NO TRACE, 1 STALE'.
- Case C, :250 changed to `failed="$failed $m"`, then A again: tally.py says '2 not ok', count.py '0 ok, 2 NO TRACE'.

**Known:** Not known. I searched for 'dependency package', '.lake/packages', 'failed rebuild', 'last good', 'old trace', 'NO TRACE', 'tally.py', 'forget(' and 'one package over' in:
- docs/backlog.md (check.sh, tally, count.py and trace all checked too);
- docs/archive/plans/ (every review and chunk plan);
- docs/plans/chunk-46-verification-on-upstream.md and chunk-49-no-locked-funds.md;
- seedelf-verification/README.md (including *Not proved*), CLAIMS.md and Audit/review/findings.md;
- review-51's owner-calls.md, FIX.md, INDEX.md, verify/v3-1.md and data/fixed-in.json.

The nearest items are different mechanisms:
- script-hex-not-lake-inputs: a replay reads as ok, with no failure;
- checksh-cannot-tell-replay;
- lovejoin-traces-predate-edits;
- seedelf-evidence-predates-pin (refuted).

v3#1 (fixed in 40883a55) and its verification cover only an in-package module failing. That repro's step 2 makes Demo.Top itself fail. This is a gap in that fix, not a settled item. The finder's own R2verif notes also record the related timeout-inside-another-scope case, which isn't settled either.

**Fix notes:**

**Class:** check.sh blames a failed build on the modules a `✖ … Building M` line names, and treats only those whose .lean is under the package root. The readers follow only in-package imports. So a failure that can't be pinned on an in-package file removes nothing, and the readers count the last builds.

Members:
1. A dependency package's module fails to compile. This is the finding, in the root package, in Slice/ (its own PlutusCore at 96261cc) and in Upstream/blaster-main.
2. A timeout or kill while Lake builds an in-package import inside another module's scope. Only $m goes, and the import keeps its old trace. This is in R2verif's notes.

What to change:
1. **check.sh:250.** Forget the module asked for on every nonzero rc: replace `[ "$rc" = 1 ] && [ -n "$failed" ] || failed="$failed $m"` with `failed="$failed $m"`. Run C shows this makes both readers report NO TRACE in the finding's case. It costs at most one rebuild of $m, which its failed import forces anyway.
   - Optionally, have forget() say when a ✖ name has no .lean in the package, e.g. "== PlutusCore.UPLC.CekMachine failed in a dependency package". That way, check.sh's output says why every module failed.
2. **More robust, the v3#1 verifier's option (c).** check.sh records each run's verdict per module, under .lake and outside any tracked path. tally.py and count.py then refuse a module whose last recorded verdict isn't ok, or whose trace changed since it was recorded. That also closes member 2.
3. **Correct the texts that say a failed rebuild never reads as ok:**
   - check.sh:9-11 (header) and :244-247. The latter says "the readers see that what it imports has none", which is false for an import in a dependency.
   - README.md:176 and Audit/README.md:46.
   - tally.py:14-17 and count.py:16-19.

No owner call needed: this is verification tooling only, with no refusal, privacy default or screen change. Test it as above: check.sh's lines run on a fixture console and fixture build files. Never with lake.

**Test:** `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/scratchpad/r51/work/verify-r2verif_3-trace/r51_r2verif_3_fixture.sh`

Result: Ran from the scratch folder: `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 20m bash r51_r2verif_3_fixture.sh`, exit=1. No Lean, no Lake, nothing written in either tree. Output (console echo trimmed):

```
FIXTREE HEAD f88560c4; working copy vs HEAD:
  same: check.sh 760776a75d6bdc23
  same: tally.py 83971ba508d184f0
  same: Audit/count.py 56dcfc7b68fa78e0
check.sh:218 [ -f "$p.lean" ] || return 0
check.sh:233 grep -v -E 'Replayed|CekMachine.lean:309|Successfully decoded|^trace: \.> LEAN_PATH'
check.sh:249 failed=$(grep -aoE '✖ \[[0-9]+/[0-9]+\] Building [A-Za-z0-9_.]+' "$outf" | awk '{print $NF}')
check.sh:250 [ "$rc" = 1 ] && [ -n "$failed" ] || failed="$failed $m"
===== 0. the last pin's builds, read before any rebuild
== Demo: 2 modules, 2 Valid, 0 Expected Falsified, 0 not ok
== 2 ok
===== A. the re-pin: PlutusCore.UPLC.CekMachine (dependency package) fails; check.sh runs Demo.Top, Demo.Down
== Demo.Top (cap 8G, limit 10m)
   | ✖ [57/130] Building PlutusCore.UPLC.CekMachine (4.2s)
   | error: ./.lake/packages/PlutusCore/./PlutusCore/UPLC/CekMachine.lean:1:15: unknown identifier 'Blaster.gone'
   ...
== summary
FAILED    Demo.Top (exit 1, 0s)
FAILED    Demo.Down (exit 1, 0s)
check_failed=1
-- every build file before and after is the same: 20 files, none removed, none changed
-- python3 -I tally.py Demo
== Demo: 2 modules, 2 Valid, 0 Expected Falsified, 0 not ok
-- python3 -I Audit/count.py audit-quick
  ok        Demo.Top: 1 Valid, 0 Expected Falsified, 0 #guard
  ok        Demo.Down: 1 Valid, 0 Expected Falsified, 0 #guard
== 2 ok
===== B. control: the in-package Demo.Top fails (40883a55's case), same modules
== Demo.Top failed: its last good build removed, so it reads as not built
FAILED    Demo.Top (exit 1, 0s)
FAILED    Demo.Down (exit 1, 0s)
-- removed: Top.c, Top.c.hash, Top.setup.json, Top.ilean(.hash), Top.olean(.hash), Top.trace
NOT OK   Demo.Down: rests on Demo.Top, which has no trace
NOT OK   Demo.Top: no trace (failed, or never built)
== Demo: 2 modules, 1 Valid, 0 Expected Falsified, 2 not ok
  NO TRACE  Demo.Top: never built, or its build failed: see check.sh's output
  STALE     Demo.Down: rests on Demo.Top, which has no trace: see check.sh's output
== 0 ok, 1 NO TRACE, 1 STALE
===== C. the finder's simplest fix in a copy of :250 (forget $m on every nonzero rc), then A again
   <     [ "$rc" = 1 ] && [ -n "$failed" ] || failed="$failed $m"
   >     failed="$failed $m"
   == Demo.Top failed: its last good build removed, so it reads as not built
   == Demo.Down failed: its last good build removed, so it reads as not built
== Demo: 2 modules, 0 Valid, 0 Expected Falsified, 2 not ok
== 0 ok, 2 NO TRACE
===== assertions
ok   control: check.sh's summary says FAILED for both modules in A
ok   control: B (in-package failure) reads not ok in both readers, as 40883a55 intends
FAIL tally.py calls both modules ok after A's failed rebuild: == Demo: 2 modules, 2 Valid, 0 Expected Falsified, 0 not ok
FAIL count.py calls A's modules ok: 2 ok
info C: with $m forgotten on every nonzero rc, A reads not ok: == Demo: 2 modules, 0 Valid, 0 Expected Falsified, 2 not ok
BUG REPRODUCED: a failed rebuild in a dependency package reads as ok
exit=1
```

The console is a fixture, since Lake can't be run here. Its lines follow Lake 4.24's own format: Run.lean:132, Module.lean:660, Common.lean buildAction, Log.lean:92. Dependents print nothing, per Register.lean:44 and :20-21 and Run.lean:118 and :124-126.

```
#!/usr/bin/env bash
# r51 r2verif#3 (trace verifier): when the module that fails a rebuild sits in a dependency
# package (.lake/packages/...), check.sh removes nothing, and tally.py and Audit/count.py read the
# last pin's builds as ok.
#
# No Lean and no Lake. It runs check.sh's own lines, verbatim from FIXTREE's HEAD:
#   :215-223  forget()
#   :233      the console filter, run on the raw console
#   :239-263  everything after the build: SORRY/UNDETERM, the failure block, the summary
# It runs them on a fixture package whose build files have the shape Lake 4.24 writes (trace JSON,
# .olean/.ilean and their .hash files, ir .c/.c.hash/.setup.json), and on a fixture console with
# the line Lake 4.24 prints for a module job that ran Lean and failed (Run.lean:132,
# `{icon} [{jobNo}/{totalJobs}] {verb} {caption}{time}`, caption = mod.name.toString,
# Module.lean:660). A dependent whose import failed gets a renewed state (Register.lean:44, :20-21)
# with no log, so it prints no line at all (Run.lean:118, :126). Then it runs FIXTREE HEAD's
# tally.py and Audit/count.py, unchanged.
#   A. the finding: PlutusCore.UPLC.CekMachine (a dependency) fails, check.sh runs Demo.Top, Demo.Down
#   B. control: the in-package Demo.Top fails instead (the case 40883a55 fixed)
#   C. the finder's simplest fix (forget $m on every nonzero rc) applied to a copy of :250, then A
# Exits 1 while A reads as ok (the bug), 0 once fixed; 2 if a control misbehaves.
#   systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 20m bash r51_r2verif_3_fixture.sh
set -u
FIX=/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51-fixes
HERE=$(cd "$(dirname "$0")" && pwd)
W=$HERE/r2v3-work
rm -rf "$W"; mkdir -p "$W"

# --- the tools, from the committed tree (other fixers edit FIXTREE's working copy)
git -C "$FIX" show HEAD:seedelf-verification/check.sh > "$W/check.sh.head" || exit 2
git -C "$FIX" show HEAD:seedelf-verification/tally.py > "$W/tally.py.head" || exit 2
git -C "$FIX" show HEAD:seedelf-verification/Audit/count.py > "$W/count.py.head" || exit 2
echo "FIXTREE HEAD $(git -C "$FIX" rev-parse --short HEAD); working copy vs HEAD:"
for f in check.sh tally.py Audit/count.py; do
  b=$(basename "$f"); cmp -s "$W/$b.head" "$FIX/seedelf-verification/$f" \
    && echo "  same: $f $(sha256sum < "$W/$b.head" | cut -c1-16)" || echo "  DIFFERS (HEAD used): $f"
done
sed -n '215,223p' "$W/check.sh.head" > "$W/forget.sh"
sed -n '239,263p' "$W/check.sh.head" > "$W/tail.sh"
# :233 is a pipeline stage: drop its leading `| ` and trailing ` \`, keep the grep as written.
filter=$(sed -n '233p' "$W/check.sh.head" | sed -E 's/^[[:space:]]*\|[[:space:]]*//; s/[[:space:]]*\\$//')
echo "check.sh:215 $(sed -n 1p "$W/forget.sh")"
echo "check.sh:218 $(sed -n 4p "$W/forget.sh" | sed 's/^ *//')"
echo "check.sh:233 $filter"
echo "check.sh:249 $(sed -n 11p "$W/tail.sh" | sed 's/^ *//')"
echo "check.sh:250 $(sed -n 12p "$W/tail.sh" | sed 's/^ *//')"
grep -qF '[ "$rc" = 1 ] && [ -n "$failed" ] || failed="$failed $m"' "$W/tail.sh" || { echo "line 250 moved"; exit 2; }

# --- the fixture package: Demo.Top imports the dependency's module, Demo.Down imports Demo.Top.
# Both built ok on the last pin; their sources are older than their builds.
make_pkg() {
  P=$W/pkg; rm -rf "$P"; mkdir -p "$P/Demo" "$P/Audit"
  cp "$W/tally.py.head" "$P/tally.py"; cp "$W/count.py.head" "$P/Audit/count.py"
  printf 'Demo.Top\nDemo.Down\n' > "$P/Audit/audit-quick.txt"
  printf 'import PlutusCore.UPLC.CekMachine\nimport Blaster\n\ntheorem Demo.top : True := by blaster\n' > "$P/Demo/Top.lean"
  printf 'import Demo.Top\n\ntheorem Demo.down : True := by blaster\n' > "$P/Demo/Down.lean"
  for m in Top Down; do
    L=$P/.lake/build/lib/lean/Demo; I=$P/.lake/build/ir/Demo; mkdir -p "$L" "$I"
    printf '{"depHash":"1","inputs":[],"log":[{"level":"trace","message":".> LEAN_PATH=..."},{"level":"info","message":"Demo/%s.lean:4:28: \\u2705 Valid"},{"level":"warning","message":"Demo/%s.lean:4:28: declaration uses '"'"'blasterProven'"'"' (SMT-verified, no proof term)"}],"outputs":{},"synthetic":false}\n' "$m" "$m" > "$L/$m.trace"
    for e in olean olean.hash ilean ilean.hash; do echo old-pin > "$L/$m.$e"; done
    for e in c c.hash setup.json; do echo old-pin > "$I/$m.$e"; done
  done
  D=$P/.lake/packages/PlutusCore; mkdir -p "$D/PlutusCore/UPLC" "$D/.lake/build/lib/lean/PlutusCore/UPLC"
  echo 'def old := 1' > "$D/PlutusCore/UPLC/CekMachine.lean"
  for e in trace olean ilean; do echo old-pin > "$D/.lake/build/lib/lean/PlutusCore/UPLC/CekMachine.$e"; done
  find "$P" -name '*.lean' -not -path '*/.lake/*' -exec touch -d '2026-11-10 10:00:00' {} +
  find "$P/.lake" -type f -exec touch -d '2026-11-10 11:00:00' {} +
  # the re-pin: the dependency's source changes; ours doesn't
  echo 'def new := Blaster.gone' > "$D/PlutusCore/UPLC/CekMachine.lean"
}
snapshot() { (cd "$W/pkg" && find .lake -type f | sort | while read -r f; do echo "$f $(md5sum < "$f" | cut -c1-8)"; done); }

# --- Lake 4.24's console for `lake build <m>` (no TTY, so no ANSI and a time suffix, Run.lean:132)
dep_console=$W/console-dep.txt
cat > "$dep_console" <<'EOF'
✖ [57/130] Building PlutusCore.UPLC.CekMachine (4.2s)
trace: .> LEAN_PATH=/x/.lake/packages/PlutusCore/.lake/build/lib/lean:/x/.lake/build/lib/lean lean ./.lake/packages/PlutusCore/./PlutusCore/UPLC/CekMachine.lean
error: ./.lake/packages/PlutusCore/./PlutusCore/UPLC/CekMachine.lean:1:15: unknown identifier 'Blaster.gone'
error: Lean exited with code 1
Some required targets logged failures:
- PlutusCore.UPLC.CekMachine
error: build failed
EOF
own_console=$W/console-own.txt
cat > "$own_console" <<'EOF'
✖ [129/130] Building Demo.Top (2.1s)
trace: .> LEAN_PATH=/x/.lake/packages/PlutusCore/.lake/build/lib/lean:/x/.lake/build/lib/lean lean ./././Demo/Top.lean
error: ./././Demo/Top.lean:4:28: Blaster: ❌ Falsified
error: Lean exited with code 1
Some required targets logged failures:
- Demo.Top
error: build failed
EOF

# --- check.sh's loop after its `lake build`, per module: filter (:233), then :239-263 verbatim.
CAP=8G; LIMIT=10m
run_check() {  # $1 console, $2 lake's exit code, $3 the tail to source, then the modules asked for
  local raw=$1 code=$2 tail=$3; shift 3
  summary=(); check_failed=0
  peakf=$(mktemp -p "$W"); outf=$(mktemp -p "$W")
  cd "$W/pkg" || exit 2
  source "$W/forget.sh"
  for m in "$@"; do
    echo "== $m (cap $CAP, limit $LIMIT)"
    start=$SECONDS; : > "$peakf"
    eval "$filter" < "$raw" | tee "$outf" | sed 's/^/   | /'
    rc=$code
    source "$tail"
  done
  cd "$HERE" || exit 2
  echo "== summary"; printf '%s\n' "${summary[@]}"; echo "check_failed=$check_failed"
}
readers() {  # $1 tag
  (cd "$W/pkg" && echo "-- python3 -I tally.py Demo" && python3 -I tally.py Demo | tee "$W/tally-$1.out" \
    && echo "-- python3 -I Audit/count.py audit-quick" && python3 -I Audit/count.py audit-quick | tee "$W/count-$1.out")
}

fail=0
echo; echo "===== 0. the last pin's builds, read before any rebuild"
make_pkg; readers 0

echo; echo "===== A. the re-pin: PlutusCore.UPLC.CekMachine (dependency package) fails; check.sh runs Demo.Top, Demo.Down"
make_pkg; snapshot > "$W/snap-A-before"
run_check "$dep_console" 1 "$W/tail.sh" Demo.Top Demo.Down | tee "$W/check-A.out"
snapshot > "$W/snap-A-after"
if cmp -s "$W/snap-A-before" "$W/snap-A-after"; then
  echo "-- every build file before and after is the same: $(wc -l < "$W/snap-A-after") files, none removed, none changed"
else echo "-- build files changed:"; diff "$W/snap-A-before" "$W/snap-A-after"; fi
readers A

echo; echo "===== B. control: the in-package Demo.Top fails (40883a55's case), same modules"
make_pkg; snapshot > "$W/snap-B-before"
run_check "$own_console" 1 "$W/tail.sh" Demo.Top Demo.Down | tee "$W/check-B.out"
snapshot > "$W/snap-B-after"
echo "-- removed:"; diff "$W/snap-B-before" "$W/snap-B-after" | sed -n 's/^< /   /p'
readers B

echo; echo "===== C. the finder's simplest fix in a copy of :250 (forget \$m on every nonzero rc), then A again"
sed 's/\[ "\$rc" = 1 \] && \[ -n "\$failed" \] || failed="\$failed \$m"/failed="$failed $m"/' "$W/tail.sh" > "$W/tail-fixed.sh"
diff "$W/tail.sh" "$W/tail-fixed.sh" | sed 's/^/   /'
make_pkg; snapshot > "$W/snap-C-before"
run_check "$dep_console" 1 "$W/tail-fixed.sh" Demo.Top Demo.Down > "$W/check-C.out"
grep -E '^(== Demo.* failed|FAILED)' "$W/check-C.out" | sed 's/^/   /'
readers C

echo; echo "===== assertions"
grep -q '^FAILED    Demo.Top (exit 1' "$W/check-A.out" && grep -q '^FAILED    Demo.Down (exit 1' "$W/check-A.out" \
  && echo "ok   control: check.sh's summary says FAILED for both modules in A" \
  || { echo "??   check.sh's lines didn't fail A's modules: this run shows nothing"; exit 2; }
grep -q 'no trace' "$W/tally-B.out" && grep -q 'NO TRACE' "$W/count-B.out" \
  && echo "ok   control: B (in-package failure) reads not ok in both readers, as 40883a55 intends" \
  || { echo "??   control B didn't read as not built: the harness is wrong"; exit 2; }
if grep -q ', 0 not ok$' "$W/tally-A.out"; then
  echo "FAIL tally.py calls both modules ok after A's failed rebuild: $(tail -1 "$W/tally-A.out")"; fail=1
else echo "ok   tally.py doesn't call A's modules ok"; fi
if grep -qE '^  ok +Demo\.(Top|Down):' "$W/count-A.out"; then
  echo "FAIL count.py calls A's modules ok: $(tail -1 "$W/count-A.out" | sed 's/^== //')"; fail=1
else echo "ok   count.py doesn't call A's modules ok"; fi
grep -q ', 2 not ok$' "$W/tally-C.out" && echo "info C: with \$m forgotten on every nonzero rc, A reads not ok: $(tail -1 "$W/tally-C.out")"
echo
[ $fail = 0 ] && echo "PASS: a dependency's failed module doesn't read as ok" \
  || echo "BUG REPRODUCED: a failed rebuild in a dependency package reads as ok"
exit $fail
```
