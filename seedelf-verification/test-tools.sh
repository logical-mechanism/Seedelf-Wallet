#!/usr/bin/env bash
# The tools' own test, on fake packages and traces made in a temp dir: no Lean, no Lake, no
# systemd, about ten seconds. A stand-in `lake` prints a case's console and exits as Lake would; a
# stand-in `systemd-run` runs the command it's given; the traces are Lake's JSON.
#   bash test-tools.sh                 the tools beside it
#   TOOLS=<folder> bash test-tools.sh  another copy of check.sh, tally.py and Audit/
# What it holds them to:
# - check.sh decides SORRY, UNDETERM and NO TRACE from the module's own trace, never from the
#   console (which replays every import's log, a dependency's sorry included): a sorry, or a
#   `#print axioms` naming sorryAx or the compiler's axioms, read whole when it wraps, is SORRY; a
#   warning's Undetermined is UNDETERM, an info line's "✅ Expected Undetermined" isn't; a
#   reading that stops halfway gives no verdict; and it exits 1 for any of them;
# - it reads each module of this package that a listed module imports, directly or not (Demo.Leaf
#   is two deep), and the run doesn't list, from its own trace, under its own name ("an import
#   of"), once a run, and fails the run for one not ok; a listed import only under its own entry,
#   and a dependency's module never;
# - it dates each trace it reads to the build's start, and only once a build passes: a module Lake
#   replays over a source written again since reads fresh, an import two deep too; one whose source
#   is written during the build doesn't, nor does an import's after a build that times out or fails;
# - a failed build loses its old build files, the module's own or a dependency's (forget()), and a
#   timeout's goes too;
# - tally.py and Audit/count.py call a module not ok when it rests on one with no trace, here or
#   in a dependency, when its trace is older than its source, and when its trace doesn't read or
#   holds a sorry; count.py exits 1 then, and 0 when every module is ok;
# - tally.py names the step that reads a module again for the package it reads: seedelf-slice's
#   for Slice/'s;
# - Audit/run-all.sh: a run of some families ends on their status alone, a full run on count.py's
#   too;
# - Audit/diag/scan-diag.py exits nonzero for a LOOK, an INCONCLUSIVE or a failed Lean run.
# Exits 0 when every case holds, 1 otherwise.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
TOOLS=${TOOLS:-$HERE}
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
fails=0
ok() { echo "ok   $1"; }
no() { echo "FAIL $1"; fails=$((fails + 1)); }

mkdir -p "$T/bin"
# With TT_EDIT, the build writes that source while it runs, a moment after it starts.
cat > "$T/bin/lake" <<'EOF'
#!/usr/bin/env bash
[ "$1" = build ] || exit 2
if [ -n "${TT_EDIT:-}" ]; then sleep 0.05; touch "$TT_EDIT"; sleep 0.05; fi
cat "$TT_CONSOLE"; exit "$TT_CODE"
EOF
cat > "$T/bin/systemd-run" <<'EOF'
#!/usr/bin/env bash
while [ $# -gt 0 ]; do case $1 in --user|--scope|-q) shift ;; -p) shift 2 ;; *) break ;; esac; done
exec "$@"
EOF
# A python3 that stops after a module's own counts, as a judge that errors halfway would.
mkdir -p "$T/halt"; printf '#!/usr/bin/env bash\necho "0 0"; exit 1\n' > "$T/halt/python3"
chmod +x "$T/bin/lake" "$T/bin/systemd-run" "$T/halt/python3"

# trace FILE [level message]...: a Lake trace whose log holds those entries.
trace() {
  local f=$1; shift; mkdir -p "$(dirname "$f")"
  python3 -I - "$f" "$@" <<'PY'
import json, sys
f, rest = sys.argv[1], sys.argv[2:]
log = [{"level": rest[i], "message": rest[i + 1]} for i in range(0, len(rest), 2)]
json.dump({"depHash": "1", "inputs": [], "outputs": {}, "synthetic": False, "log": log}, open(f, "w", encoding="utf-8"))
PY
}
# The package: Demo.Top imports Demo.Leaf and the dependency's Dep.Base, Demo.Down imports
# Demo.Top (so Demo.Leaf two deep), Demo.Side imports Dep.Base alone. All of it built and ok:
# sources older than their builds.
make_pkg() {
  P=$T/pkg; rm -rf "$P"; mkdir -p "$P/Demo" "$P/Audit" "$P/Seedelf/Signers"
  : > "$P/Seedelf/Signers/modules.txt"
  cp "$TOOLS/check.sh" "$TOOLS/tally.py" "$P/"; cp "$TOOLS/Audit/count.py" "$P/Audit/"
  printf 'Demo.Top\nDemo.Down\nDemo.Side\nDemo.Leaf\n' > "$P/Audit/audit-t.txt"
  printf 'theorem Demo.leaf : True := by blaster\n' > "$P/Demo/Leaf.lean"
  printf 'import Demo.Leaf\nimport Dep.Base\nimport Blaster\n\ntheorem Demo.top : True := by blaster\n' > "$P/Demo/Top.lean"
  printf 'import Demo.Top\n\ntheorem Demo.down : True := by blaster\n' > "$P/Demo/Down.lean"
  printf 'import Dep.Base\n\ntheorem Demo.side : True := by blaster\n' > "$P/Demo/Side.lean"
  for m in Top Down Side Leaf; do
    trace "$P/.lake/build/lib/lean/Demo/$m.trace" info "Demo/$m.lean:4:0: ✅ Valid" \
      warning "Demo/$m.lean:4:0: declaration uses 'blasterProven' (SMT-verified, no proof term)"
    for e in olean olean.hash ilean ilean.hash; do echo old > "$P/.lake/build/lib/lean/Demo/$m.$e"; done
    mkdir -p "$P/.lake/build/ir/Demo"; for e in c c.hash setup.json; do echo old > "$P/.lake/build/ir/Demo/$m.$e"; done
  done
  D=$P/.lake/packages/Dep; mkdir -p "$D/Dep"; echo 'def Dep.base := 1' > "$D/Dep/Base.lean"
  trace "$D/.lake/build/lib/lean/Dep/Base.trace"; echo old > "$D/.lake/build/lib/lean/Dep/Base.olean"
  find "$P" -name '*.lean' -exec touch -d '2026-11-10 10:00' {} +
  find "$P/.lake" -type f -exec touch -d '2026-11-10 11:00' {} +
}
# The package, with Audit/run-all.sh, a stand-in diag that exits $TT_DIAG, and the full run's
# eight families, each of Demo.Side alone.
make_audit() {
  make_pkg; cp "$TOOLS/Audit/run-all.sh" "$P/Audit/"; mkdir -p "$P/Audit/diag"
  printf '#!/usr/bin/env bash\necho "diag: a stand-in"; exit "$TT_DIAG"\n' > "$P/Audit/diag/run-diag.sh"
  for f in refresh quick seedelf v2 template classic gaps last; do echo Demo.Side > "$P/Audit/audit-$f.txt"; done
}
console() { printf '%s\n' "$@" > "$T/console"; }
check() {  # lake's exit code, then the modules asked for: check.sh's output in $T/check.out, its status in $crc
  local code=$1; shift
  (cd "$P" && TT_EDIT=${TT_EDIT:-} TT_CONSOLE=$T/console TT_CODE=$code PATH="${TT_PATH:-}$T/bin:$PATH" TMPDIR=$T \
    ./check.sh "$@") > "$T/check.out" 2>&1
  crc=$?
}
readers() {  # tally.py's and count.py's output; count.py's status in $counted
  (cd "$P" && python3 -I tally.py Demo > "$T/tally.out" 2>&1; python3 -I Audit/count.py audit-t > "$T/count.out" 2>&1)
  counted=$?
}
run_all() {  # lake's exit code, then the families: run-all.sh's output in $T/run-all.out, its status in $arc
  local code=$1; shift
  (cd "$P" && TT_DIAG=${TT_DIAG:-0} TT_CONSOLE=$T/console TT_CODE=$code PATH="$T/bin:$PATH" TMPDIR=$T \
    bash Audit/run-all.sh "$@") > "$T/run-all.out" 2>&1
  arc=$?
}
verdict() { grep -E "^[A-Za-z ]{10}$1 " "$T/check.out" | grep -v '(an import of ' | cut -c1-10 | tr -d ' '; }
import_verdict() { grep -E "^[A-Za-z ]{10}$1 \(an import of $2," "$T/check.out" | cut -c1-10 | tr -d ' '; }
tally_says() { grep -q "^NOT OK   $1: .*$2" "$T/tally.out"; }
tally_ok() { ! grep -q "^NOT OK   $1:" "$T/tally.out"; }
count_says() { grep -qE "^  $2 +$1: .*$3" "$T/count.out"; }

echo "== the readers on a good build"
make_pkg; readers
tally_ok Demo.Top && tally_ok Demo.Down && tally_ok Demo.Side && tally_ok Demo.Leaf && grep -q '4 ok' "$T/count.out" \
  && ok "every module ok" || no "a good build doesn't read ok"
[ "$counted" = 0 ] && ok "count.py exits 0" || no "count.py exits $counted on a good build"

echo "== the readers: a module resting on one with no trace"
make_pkg; rm "$P/.lake/build/lib/lean/Demo/Top.trace"; readers
tally_says Demo.Down 'rests on Demo.Top, which has no trace' && ok "tally.py: Demo.Down rests on Demo.Top" \
  || no "tally.py reads Demo.Down ok over Demo.Top's missing trace"
count_says Demo.Down STALE 'rests on Demo.Top' && ok "count.py: Demo.Down is STALE" \
  || no "count.py reads Demo.Down ok over Demo.Top's missing trace"
tally_ok Demo.Side && ok "tally.py: Demo.Side, resting on neither, still ok" || no "tally.py: Demo.Side isn't ok"
[ "$counted" = 1 ] && ok "count.py exits 1 once a module isn't ok" || no "count.py exits $counted with a module not ok"

echo "== the readers: a dependency's module with no trace"
make_pkg; rm "$P/.lake/packages/Dep/.lake/build/lib/lean/Dep/Base.trace"; readers
tally_says Demo.Side 'rests on Dep.Base' && tally_says Demo.Top 'rests on Dep.Base' && tally_says Demo.Down 'rests on Dep.Base' \
  && ok "tally.py: everything over Dep.Base rests on it" || no "tally.py doesn't follow an import into a dependency"
count_says Demo.Side STALE 'rests on Dep.Base' && ok "count.py: Demo.Side is STALE" \
  || no "count.py doesn't follow an import into a dependency"

echo "== the readers: a trace that doesn't read, and one with a sorry"
make_pkg; echo '{"log": [' > "$P/.lake/build/lib/lean/Demo/Top.trace"
trace "$P/.lake/build/lib/lean/Demo/Side.trace" info "Demo/Side.lean:4:0: ✅ Valid" warning "Demo/Side.lean:6:8: declaration uses 'sorry'"
find "$P/.lake" -type f -exec touch -d '2026-11-10 11:00' {} +; readers
tally_says Demo.Top "trace doesn't read" && count_says Demo.Top STALE "trace doesn't read" \
  && ok "both: Demo.Top's trace doesn't read" || no "an unreadable trace reads ok"
tally_says Demo.Side 'a sorry' && count_says Demo.Side WRONG "declaration uses 'sorry'" \
  && ok "both: Demo.Side has a sorry" || no "a sorry reads ok"

echo "== check.sh: a module's own build fails"
make_pkg; console '✖ [9/9] Building Demo.Top (2.1s)' 'error: Demo/Top.lean:4:28: ❌ Falsified' 'error: build failed'
check 1 Demo.Top Demo.Down; readers
[ "$(verdict Demo.Top)" = FAILED ] || { no "check.sh didn't fail Demo.Top: the case shows nothing"; }
[ -z "$(ls "$P"/.lake/build/lib/lean/Demo/Top.* "$P"/.lake/build/ir/Demo/Top.* 2>/dev/null)" ] \
  && ok "forget(): Demo.Top's old build is gone" || no "forget() left Demo.Top's old build"
[ -e "$P/.lake/build/lib/lean/Demo/Down.trace" ] && ok "Demo.Down, which never started, keeps its build" \
  || no "Demo.Down's build was removed"
tally_says Demo.Top 'no trace' && tally_says Demo.Down 'rests on Demo.Top' && count_says Demo.Top 'NO TRACE' '' \
  && ok "both readers: Demo.Top not built, Demo.Down resting on it" || no "the failed module reads ok"

echo "== check.sh: a dependency's module fails"
make_pkg; console '✖ [57/130] Building Dep.Base (4.2s)' "error: ./.lake/packages/Dep/./Dep/Base.lean:1:15: unknown identifier 'x'" 'error: build failed'
check 1 Demo.Top; readers
[ -z "$(ls "$P"/.lake/packages/Dep/.lake/build/lib/lean/Dep/Base.* 2>/dev/null)" ] \
  && ok "forget(): Dep.Base's old build is gone" || no "forget() left the dependency's old build"
tally_says Demo.Top 'rests on Dep.Base' && tally_says Demo.Side 'rests on Dep.Base' && count_says Demo.Side STALE 'rests on Dep.Base' \
  && ok "both readers: every module over Dep.Base is not ok, in the run or not" || no "a dependency's failed module reads ok"

echo "== check.sh: a timeout, with no word of what was building"
make_pkg; console; check 124 Demo.Down; readers
[ "$(verdict Demo.Down)" = TIMEOUT ] && [ ! -e "$P/.lake/build/lib/lean/Demo/Down.trace" ] && tally_says Demo.Down 'no trace' \
  && ok "the module asked for goes" || no "a timed-out module keeps its old build"

echo "== check.sh: verdicts from the module's own trace"
make_pkg; console; check 0 Demo.Top Demo.Down Demo.Side
[ "$(verdict Demo.Top)$(verdict Demo.Down)$(verdict Demo.Side)" = okokok ] && [ "$crc" = 0 ] \
  && ok "a good run: every module ok, exit 0" || no "a good run reads $(verdict Demo.Top) $(verdict Demo.Down) $(verdict Demo.Side), exit $crc"
console "warning: PlutusCore/UPLC/CekMachine.lean:317:4: declaration uses 'sorry'" \
  'warning: Demo/Top.lean:4:0: ⚠️ Undetermined' "warning: Demo/Top.lean:6:8: declaration uses 'sorry'" \
  'info: Demo/Down.lean:4:0: ✅ Valid'
check 0 Demo.Down
[ "$(verdict Demo.Down)" = ok ] && [ "$(import_verdict Demo.Top Demo.Down)" = "" ] && [ "$crc" = 0 ] \
  && ok "an import's replayed sorry and Undetermined, a dependency's at any line, are no one's but in their own traces" \
  || no "Demo.Down reads $(verdict Demo.Down), exit $crc, for others' logs on the console"
trace "$P/.lake/build/lib/lean/Demo/Top.trace" info "Demo/Top.lean:4:0: ✅ Valid" \
  info "Demo/Top.lean:9:0: 'Demo.top' depends on axioms: [propext,
 Classical.choice,
 Lean.ofReduceBool,
 Lean.trustCompiler,
 Quot.sound]"
trace "$P/.lake/build/lib/lean/Demo/Side.trace" warning 'Demo/Side.lean:4:0: ⚠️ Undetermined'
console; check 0 Demo.Top Demo.Side
[ "$(verdict Demo.Top)" = SORRY ] && ok "a native_decide in a wrapped axiom list is SORRY" || no "a wrapped axiom list reads $(verdict Demo.Top)"
[ "$(verdict Demo.Side)" = UNDETERM ] && ok "its own Undetermined is UNDETERM" || no "an Undetermined reads $(verdict Demo.Side)"
[ "$crc" = 1 ] && ok "and the run exits 1" || no "a SORRY and an UNDETERM run exits $crc"
make_pkg; trace "$P/.lake/build/lib/lean/Demo/Side.trace" info "Demo/Side.lean:4:0: ✅ Valid" \
  warning "Demo/Side.lean:6:8: declaration uses 'sorry'"
console; check 0 Demo.Side
[ "$(verdict Demo.Side)" = SORRY ] && [ "$crc" = 1 ] && ok "its own sorry is SORRY, exit 1" \
  || no "a module's own sorry reads $(verdict Demo.Side), exit $crc"
rm "$P/.lake/build/lib/lean/Demo/Side.trace"; check 0 Demo.Side
[ "$(verdict Demo.Side)" = NOTRACE ] && [ "$crc" = 1 ] && ok "a passed build with no trace to read is NO TRACE, exit 1" \
  || no "a passed build with no trace reads $(verdict Demo.Side), exit $crc"
make_pkg; trace "$P/.lake/build/lib/lean/Demo/Side.trace" info "Demo/Side.lean:4:0: ✅ Valid" \
  info "Demo/Side.lean:9:0: 'Demo.side' depends on axioms: [propext, sorryAx, Classical.choice, Quot.sound]"
console; check 0 Demo.Side
[ "$(verdict Demo.Side)" = SORRY ] && [ "$crc" = 1 ] && ok "a #print axioms naming sorryAx alone is SORRY, exit 1" \
  || no "an axiom list with sorryAx reads $(verdict Demo.Side), exit $crc"
trace "$P/.lake/build/lib/lean/Demo/Side.trace" info "Demo/Side.lean:4:0: ✅ Valid" \
  info "Demo/Side.lean:6:0: ✅ Expected Undetermined"
check 0 Demo.Side
[ "$(verdict Demo.Side)" = ok ] && [ "$crc" = 0 ] && ok "an info line's ✅ Expected Undetermined is ok" \
  || no "an Expected Undetermined reads $(verdict Demo.Side), exit $crc"
make_pkg; console; TT_PATH=$T/halt: check 0 Demo.Down
[ "$(verdict Demo.Down)" = NOTRACE ] && [ "$crc" = 1 ] && ok "a judge that stops halfway leaves no verdict: NO TRACE, exit 1" \
  || no "a judge that stops halfway reads $(verdict Demo.Down), exit $crc"

echo "== check.sh: an import the run doesn't list, from its own trace, under its own name"
make_pkg; console; check 0 Demo.Down
[ "$(import_verdict Demo.Top Demo.Down)" = "" ] && grep -q 'each read from its own trace: 2 of 2 ok' "$T/check.out" && [ "$crc" = 0 ] \
  && ok "a clean import: counted ok, exit 0" || no "a clean import: '$(import_verdict Demo.Top Demo.Down)', exit $crc"
trace "$P/.lake/build/lib/lean/Demo/Top.trace" info "Demo/Top.lean:4:0: ✅ Valid" warning "Demo/Top.lean:6:8: declaration uses 'sorry'"
check 0 Demo.Down
[ "$(verdict Demo.Down)" = ok ] && [ "$(import_verdict Demo.Top Demo.Down)" = SORRY ] && [ "$crc" = 1 ] \
  && ok "its own sorry: SORRY Demo.Top (an import of Demo.Down), Demo.Down ok, exit 1" \
  || no "an import's own sorry: Demo.Down $(verdict Demo.Down), Demo.Top '$(import_verdict Demo.Top Demo.Down)', exit $crc"
trace "$P/.lake/build/lib/lean/Demo/Top.trace" warning 'Demo/Top.lean:4:0: ⚠️ Undetermined'
check 0 Demo.Down
[ "$(import_verdict Demo.Top Demo.Down)" = UNDETERM ] && [ "$crc" = 1 ] && ok "its own Undetermined: UNDETERM, exit 1" \
  || no "an import's own Undetermined reads '$(import_verdict Demo.Top Demo.Down)', exit $crc"
rm "$P/.lake/build/lib/lean/Demo/Top.trace"; check 0 Demo.Down
[ "$(import_verdict Demo.Top Demo.Down)" = NOTRACE ] && [ "$crc" = 1 ] && ok "no trace to read: NO TRACE, exit 1" \
  || no "an import with no trace reads '$(import_verdict Demo.Top Demo.Down)', exit $crc"
make_pkg; trace "$P/.lake/build/lib/lean/Demo/Leaf.trace" info "Demo/Leaf.lean:1:0: ✅ Valid" \
  warning "Demo/Leaf.lean:3:8: declaration uses 'sorry'"
console; check 0 Demo.Down
[ "$(verdict Demo.Down)" = ok ] && [ "$(import_verdict Demo.Leaf Demo.Down)" = SORRY ] && [ "$crc" = 1 ] \
  && ok "an import two deep: SORRY Demo.Leaf (an import of Demo.Down), exit 1" \
  || no "an import two deep: Demo.Leaf '$(import_verdict Demo.Leaf Demo.Down)', exit $crc"
check 0 Demo.Top Demo.Down
[ "$(grep -c '^SORRY     Demo.Leaf (an import of ' "$T/check.out")" = 1 ] \
  && grep -q 'each read from its own trace: 0 of 1 ok' "$T/check.out" \
  && ok "an import two listed modules share: one line, counted once" \
  || no "a shared import: $(grep -c '^SORRY     Demo.Leaf (an import of ' "$T/check.out") lines, $(grep -o '[0-9]* of [0-9]* ok' "$T/check.out")"
make_pkg; trace "$P/.lake/build/lib/lean/Demo/Top.trace" warning "Demo/Top.lean:6:8: declaration uses 'sorry'"
console; check 0 Demo.Down Demo.Top
[ "$(verdict Demo.Top)" = SORRY ] && [ "$(import_verdict Demo.Top Demo.Down)" = "" ] \
  && ok "an import the run lists reads under its own entry alone" || no "a listed import is read as an import too"
make_pkg; trace "$P/.lake/packages/Dep/.lake/build/lib/lean/Dep/Base.trace" warning "Dep/Base.lean:1:0: declaration uses 'sorry'"
console; check 0 Demo.Side
[ "$(verdict Demo.Side)" = ok ] && [ "$crc" = 0 ] && ok "a dependency's module isn't judged" \
  || no "a dependency's own sorry: Demo.Side $(verdict Demo.Side), exit $crc"

echo "== check.sh dates each trace it reads to the build's start"
make_pkg; touch -d '2026-11-12 10:00' "$P/Demo/Top.lean" "$P/Demo/Down.lean"; readers
tally_says Demo.Down 'a trace older than its source (run ./check.sh Demo.Down)' \
  && count_says Demo.Down STALE 'trace older than the source: run ./check.sh on it' \
  && ok "sources written again after their build: both readers say to run check.sh" || no "a source newer than its trace reads ok"
console '✔ [3/3] Replayed Demo.Down'; check 0 Demo.Down; readers
tally_ok Demo.Down && tally_ok Demo.Top && count_says Demo.Down ok '' && count_says Demo.Top ok '' && [ "$counted" = 0 ] \
  && ok "once check.sh replays Demo.Down, it and its import Demo.Top read ok" || no "a replayed module still reads stale"
make_pkg; console; TT_EDIT=$P/Demo/Side.lean check 0 Demo.Side; readers
tally_says Demo.Side 'a trace older than its source' && count_says Demo.Side STALE 'older than the source' \
  && ok "a source written during its build reads stale after it" || no "a source written during its build reads fresh"
make_pkg; touch -d '2026-11-12 10:00' "$P/Demo/Leaf.lean"; readers
tally_says Demo.Leaf 'a trace older than its source' && count_says Demo.Leaf STALE 'older than the source' \
  || no "the case shows nothing: Demo.Leaf, written again since its build, reads fresh"
console '✔ [5/5] Replayed Demo.Down'; check 0 Demo.Down; readers
tally_ok Demo.Leaf && count_says Demo.Leaf ok '' && ok "once check.sh replays Demo.Down, its import two deep, Demo.Leaf, reads ok" \
  || no "an import two deep still reads stale after a replay"
make_pkg; touch -d '2026-11-12 10:00' "$P/Demo/Top.lean"; console; check 124 Demo.Down; readers
[ "$(verdict Demo.Down)" = TIMEOUT ] && tally_says Demo.Top 'a trace older than its source' && count_says Demo.Top STALE 'older than the source' \
  && ok "a build that times out dates nothing: its import Demo.Top, written again since its build, reads stale" \
  || no "after a timeout, Demo.Top, written again since its build, reads fresh"
make_pkg; touch -d '2026-11-12 10:00' "$P/Demo/Top.lean"
console '✖ [9/9] Building Demo.Down (2.1s)' 'error: build failed'; check 1 Demo.Down; readers
[ "$(verdict Demo.Down)" = FAILED ] && tally_says Demo.Top 'a trace older than its source' && count_says Demo.Top STALE 'older than the source' \
  && ok "nor does a build that fails" || no "after a failed build, Demo.Top, written again since its build, reads fresh"

echo "== tally.py names the step that reads a module again, for the package it reads"
make_pkg; touch -d '2026-11-12 10:00' "$P/Demo/Side.lean"
mkdir -p "$P/Slice/Slice"; printf 'Slice.Rule\n' > "$P/Slice/modules.txt"
printf 'theorem Slice.rule : True := by blaster\n' > "$P/Slice/Slice/Rule.lean"
trace "$P/Slice/.lake/build/lib/lean/Slice/Rule.trace" info "Slice/Rule.lean:1:0: ✅ Valid"
touch -d '2026-11-10 11:00' "$P/Slice/.lake/build/lib/lean/Slice/Rule.trace"   # its source is newer: written again since
(cd "$P" && python3 -I tally.py Demo > "$T/tally.out" 2>&1; python3 -I tally.py Slice/Slice > "$T/slice.out" 2>&1)
tally_says Demo.Side 'a trace older than its source (run ./check.sh Demo.Side)' \
  && grep -q "^NOT OK   Slice.Rule: a trace older than its source (run ./check.sh seedelf-slice Slice.Rule)" "$T/slice.out" \
  && ok "./check.sh Demo.Side here, ./check.sh seedelf-slice Slice.Rule for Slice/'s" \
  || no "tally.py's step: $(grep -ho '(run [^)]*)' "$T/tally.out" "$T/slice.out" | paste -sd ' ' -)"
console; check 0 seedelf-slice Slice.Rule; (cd "$P" && python3 -I tally.py Slice/Slice > "$T/slice.out" 2>&1)
[ "$(verdict Slice.Rule)" = ok ] && ! grep -q '^NOT OK' "$T/slice.out" && ok "and that step reads Slice.Rule again: ok" \
  || no "./check.sh seedelf-slice Slice.Rule leaves it $(verdict Slice.Rule), tally.py $(tail -1 "$T/slice.out")"

echo "== run-all.sh's exit status"
make_audit; console; run_all 0
[ "$arc" = 0 ] && ok "a full run, every family and count.py clean, exits 0" || no "a clean full run exits $arc"
# Demo.Side's source now expects two ✅ where its log has one: count.py's WRONG, no check.sh's.
printf 'import Dep.Base\n\ntheorem Demo.side : True := by blaster\n\ntheorem Demo.side2 : True := by blaster\n' > "$P/Demo/Side.lean"
touch -d '2026-11-10 10:00' "$P/Demo/Side.lean"
run_all 0 audit-t
[ "$arc" = 0 ] && grep -q WRONG "$P/Audit/logs/count.txt" \
  && ok "a run of some families ends on theirs alone, count.py's WRONG aside" || no "a partial run exits $arc over count.py's WRONG"
run_all 0
[ "$arc" != 0 ] && grep -q WRONG "$P/Audit/logs/count.txt" && ok "a full run ends on count.py's status too" \
  || no "a full run exits $arc over count.py's WRONG"
make_audit; console '✖ [9/9] Building Demo.Top (2.1s)' 'error: build failed'; run_all 1 audit-t
[ "$arc" != 0 ] && ok "a family's failed check.sh fails a run of some families" || no "a partial run passed over a failed family"
make_audit; console; TT_DIAG=1 run_all 0
[ "$arc" != 0 ] && ok "a diag scan that flags a row fails a full run" || no "a full run passed over a failed diag scan"

echo "== the diag scan's exit status"
S=$T/diag; mkdir -p "$S/clean" "$S/killed" "$S/selftest"
cp "$TOOLS"/Audit/diag/selftest/*.txt "$S/selftest/"   # the scan writes its replays beside each dump
printf 'Audit/diag/lean/D1.lean:3:0: ✅ Valid\nrc=0\n' > "$S/clean/D1.txt"
printf 'Audit/diag/lean/D2.lean:3:0: ✅ Valid\nKilled\nrc=137\n' > "$S/killed/D2.txt"
python3 -I "$TOOLS/Audit/diag/scan-diag.py" "$S/clean" --no-z3 > "$S/out" 2>&1 && ok "a clean scan exits 0" || no "a clean scan exits nonzero"
python3 -I "$TOOLS/Audit/diag/scan-diag.py" "$S/killed" --no-z3 > "$S/out" 2>&1 \
  && no "a killed Lean run scans clean" || ok "a killed Lean run is FAILED, exit 1"
python3 -I "$TOOLS/Audit/diag/scan-diag.py" "$S/selftest" --no-z3 > "$S/out" 2>&1 \
  && no "the self-test's LOOK and FAILED rows scan clean" || ok "the self-test's LOOK and FAILED rows exit 1"

echo
[ "$fails" = 0 ] && echo "PASS: the tools hold" || echo "$fails FAILED"
[ "$fails" = 0 ]
