#!/usr/bin/env bash
# The tools' own test, on fake packages and traces made in a temp dir: no Lean, no Lake, no
# systemd, a few seconds. A stand-in `lake` prints a case's console and exits as Lake would; a
# stand-in `systemd-run` runs the command it's given; the traces are Lake's JSON.
#   bash test-tools.sh                 the tools beside it
#   TOOLS=<folder> bash test-tools.sh  another copy of check.sh, tally.py and Audit/
# What it holds them to:
# - check.sh decides SORRY and UNDETERM from the module's own trace, never from the console (which
#   replays every import's log, a dependency's sorry included), and reads a wrapped
#   `#print axioms` list whole;
# - a failed build loses its old build files, the module's own or a dependency's (forget()), and a
#   timeout's goes too;
# - tally.py and Audit/count.py call a module not ok when it rests on one with no trace, here or
#   in a dependency, and when its trace doesn't read or holds a sorry;
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
cat > "$T/bin/lake" <<'EOF'
#!/usr/bin/env bash
[ "$1" = build ] || exit 2
cat "$TT_CONSOLE"; exit "$TT_CODE"
EOF
cat > "$T/bin/systemd-run" <<'EOF'
#!/usr/bin/env bash
while [ $# -gt 0 ]; do case $1 in --user|--scope|-q) shift ;; -p) shift 2 ;; *) break ;; esac; done
exec "$@"
EOF
chmod +x "$T/bin/lake" "$T/bin/systemd-run"

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
# The package: Demo.Top imports the dependency's Dep.Base, Demo.Down imports Demo.Top, Demo.Side
# imports Dep.Base alone. All of it built and ok: sources older than their builds.
make_pkg() {
  P=$T/pkg; rm -rf "$P"; mkdir -p "$P/Demo" "$P/Audit" "$P/Seedelf/Signers"
  : > "$P/Seedelf/Signers/modules.txt"
  cp "$TOOLS/check.sh" "$TOOLS/tally.py" "$P/"; cp "$TOOLS/Audit/count.py" "$P/Audit/"
  printf 'Demo.Top\nDemo.Down\nDemo.Side\n' > "$P/Audit/audit-t.txt"
  printf 'import Dep.Base\nimport Blaster\n\ntheorem Demo.top : True := by blaster\n' > "$P/Demo/Top.lean"
  printf 'import Demo.Top\n\ntheorem Demo.down : True := by blaster\n' > "$P/Demo/Down.lean"
  printf 'import Dep.Base\n\ntheorem Demo.side : True := by blaster\n' > "$P/Demo/Side.lean"
  for m in Top Down Side; do
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
console() { printf '%s\n' "$@" > "$T/console"; }
check() {  # lake's exit code, then the modules asked for: check.sh's output in $T/check.out
  local code=$1; shift
  (cd "$P" && TT_CONSOLE=$T/console TT_CODE=$code PATH="$T/bin:$PATH" TMPDIR=$T ./check.sh "$@") > "$T/check.out" 2>&1
}
readers() { (cd "$P" && python3 -I tally.py Demo > "$T/tally.out" 2>&1; python3 -I Audit/count.py audit-t > "$T/count.out" 2>&1); }
verdict() { grep -E "^[A-Za-z ]{10}$1 " "$T/check.out" | cut -c1-10 | tr -d ' '; }
tally_says() { grep -q "^NOT OK   $1: .*$2" "$T/tally.out"; }
tally_ok() { ! grep -q "^NOT OK   $1:" "$T/tally.out"; }
count_says() { grep -qE "^  $2 +$1: .*$3" "$T/count.out"; }

echo "== the readers on a good build"
make_pkg; readers
tally_ok Demo.Top && tally_ok Demo.Down && tally_ok Demo.Side && grep -q '3 ok' "$T/count.out" \
  && ok "every module ok" || no "a good build doesn't read ok"

echo "== the readers: a module resting on one with no trace"
make_pkg; rm "$P/.lake/build/lib/lean/Demo/Top.trace"; readers
tally_says Demo.Down 'rests on Demo.Top, which has no trace' && ok "tally.py: Demo.Down rests on Demo.Top" \
  || no "tally.py reads Demo.Down ok over Demo.Top's missing trace"
count_says Demo.Down STALE 'rests on Demo.Top' && ok "count.py: Demo.Down is STALE" \
  || no "count.py reads Demo.Down ok over Demo.Top's missing trace"
tally_ok Demo.Side && ok "tally.py: Demo.Side, resting on neither, still ok" || no "tally.py: Demo.Side isn't ok"

echo "== the readers: a dependency's module with no trace"
make_pkg; rm "$P/.lake/packages/Dep/.lake/build/lib/lean/Dep/Base.trace"; readers
tally_says Demo.Side 'rests on Dep.Base' && tally_says Demo.Down 'rests on Dep.Base' \
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
make_pkg
console "warning: PlutusCore/UPLC/CekMachine.lean:317:4: declaration uses 'sorry'" \
  'warning: Demo/Top.lean:4:0: ⚠️ Undetermined' "warning: Demo/Top.lean:6:8: declaration uses 'sorry'" \
  'info: Demo/Down.lean:4:0: ✅ Valid'
check 0 Demo.Down
[ "$(verdict Demo.Down)" = ok ] && ok "an import's replayed sorry and Undetermined, a dependency's at any line, aren't the module's" \
  || no "Demo.Down reads $(verdict Demo.Down) for others' logs"
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
