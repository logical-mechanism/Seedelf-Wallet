# r2verif#4: verification

From lane R2verif, graded low by its finder.

## Trace: confirmed, low

It holds as described, and it is a little wider than the title says.

**The path:**
- run-all.sh:27-28 takes run-diag.sh's PIPESTATUS[0].
- run-diag.sh never exits from its loop, so its status is its last command's: scan-diag.py (:36).
- scan-diag.py counts LOOK and INCONCLUSIVE (:282-297), prints them (:298-300) and ends with a bare `main()` (:302). Its only sys.exit calls are for a missing z3 (:211, :223). It has ended that way since a04ca256.

**No guard the finder missed:**
- count.py reads only the Audit/audit*.txt families (:131), never diag/out. So the failure line is count.txt's only word on diag.
- The control shows the plumbing works: when run-diag.sh does exit 1, diag is listed. The gap is only that a verdict never becomes a status.

**Run on byte-identical copies of FIXTREE HEAD's tools**, with stubs so no Lean could run:
- A LOOK (bg=unsat: #194's vacuous ✅) plus an INCONCLUSIVE leave run-diag.sh at 0. count.txt reads `== 1 ok` with no failure line, and run-all exits 0.

**Wider than stated:**
- A theorem whose Lean run fails, times out or is killed is a FAILED row. The scan counts it as neither flagged nor inconclusive, and run-diag.sh drops each run's rc. So even a plain run failure never reaches the list, which falsifies Audit/README.md:56 and run-all.sh:4-5 under their narrowest reading.
- The finder's fix (`flags or incon`) misses this case (mutant run D).
- diag-all (:29-31) has the same gap.
- The check.sh families' status does carry their not-proved verdicts (UNDETERM and SORRY set check_failed, check.sh:241-252 and :269). So a reader would expect the same of diag.

**Not known:** not in the backlog, the archived reviews, the chunk 46 or 49 plans, the audit's findings, owner-calls.md or the review's own folders.

**Why low:**
- Nobody can reach it: it is the owner's own audit tooling.
- There is a way out: each LOOK, INCONCLUSIVE and FAILED row is still printed in diag-quick.log and on the console.
- No diag run's outcome is recorded today (v4a-1 note 5), and CLAIMS.md rests on the kernel theorems. So there is no reachable harm today: a missing check, with a documented promise it doesn't keep.

**Evidence:**

Traced in FIXTREE at HEAD f88560c4. `git status` shows nothing modified under seedelf-verification. The fix branch didn't touch Audit/diag (`git diff main..HEAD --stat -- seedelf-verification/Audit/diag/` is empty).

**run-all.sh**
- :26-28 `if [ "$f" = diag ]; then CAP=$cap LIMIT=$limit bash Audit/diag/run-diag.sh quick 2>&1 | tee Audit/logs/diag-quick.log` / `rc=${PIPESTATUS[0]}`
- :29-31 diag-all: the same run-diag.sh, with `all`
- :36 `[ "$rc" = 0 ] || failed+=("$f (exit $rc)")`
- :40-43 `{ python3 -I Audit/count.py; [ ${#failed[@]} -eq 0 ] || printf '\n== check.sh or run-diag.sh failed: %s (Audit/logs/)\n' ...; } 2>&1 | tee Audit/logs/count.txt` then `[ ${#failed[@]} -eq 0 ]`
- :4-5 "count.py's verdict to Audit/logs/count.txt, with the families whose run failed; then it exits nonzero."
- All of this came in 40883a55. Before it, count.txt was `python3 -I Audit/count.py 2>&1 | tee` and claimed nothing about families.

**Audit/README.md**
- :56 "Last, `count.py`, whose output goes to `Audit/logs/count.txt`, with the families whose run failed; `run-all.sh` then exits nonzero."
- :45 "A replay that settles nothing is flagged INCONCLUSIVE, never counted clean."

**run-diag.sh**
- :19, :20 and :22 are the only explicit exits (no list, a failed cd, no z3).
- :30-34 write each Lean run's rc into out/<thm>.txt and echo it; it isn't kept.
- :36, the last line, runs scan-diag.py.

**scan-diag.py**
- :117-120 verdict() returns FAILED for a run with no ✅ and no query.
- :233 extracts a dump only for Z3 rows.
- :287-294: only LOOK, INCONCLUSIVE and a Z3 row with no query are counted, so FAILED rows are counted in neither.
- :296-297 MISSING rows; :298-300 the summary.
- :302 `main()`. The sys.exit calls are only at :211 and :223. The same holds at 97e168bf and a04ca256.

**count.py**
- :131 reads only `audit*.txt` families.
- :143-144: main() always exits 0.

**check.sh** (for contrast): :241-243 set rc=sorry or undetermined, :252 `[ "$rc" = 0 ] || check_failed=1`, :269 `exit "$check_failed"`.

**The audit's own record** (findings.json, blaster-unguarded-axioms-unmeasured) expects rows that need a hand look: "Any `<-- LOOK` row needs a look".

**The run**
- Command: `nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 20m bash r51_r2verif_4_repro.sh`
- The copies matched HEAD's blobs: run-diag.sh 279ec8e6…, scan-diag.py 389861a7…, count.py 56dcfc7b…. run-all.sh's lines 12-43 came from blob 65118863….
- Part 0, the scan's own committed self-test fixtures with --no-z3: `Z3 S1_fake … recNat=1 … <-- LOOK`, `FAILED S3_fail`, `… 1 failed; 1 flagged; 0 inconclusive`. Exit status 0.
- Case A: `Z3 D901_vacuous_bg … full=unsat bg=unsat prem=unsat alt=unsat <-- LOOK` and `Z3 D902_prem_timeout … full=unsat bg=sat prem=timeout alt=unsat <-- INCONCLUSIVE`, summary `… 1 flagged; 1 inconclusive`. count.txt: `== audit-quick (1 modules)` / `ok Audit.Fake: …` / `== 1 ok`, with no failure line. run-all's exit status: 0.
- Case B: the Lean run is killed (stub rc=137): `FAILED D905_killed`, `… 1 failed; 0 flagged; 0 inconclusive`. count.txt `== 1 ok`. run-all's exit status: 0.
- Case C, the control (no --alt z3): `scan-diag.py: no --alt z3 at /nonexistent/z3`, then count.txt `== check.sh or run-diag.sh failed: diag (exit 1) (Audit/logs/)`, exit 1.
- Case D, mutants of the scratch copy only:
  - returning 1 on `flags or incon`: A exits 1 and is listed; B still exits 0 with `== 1 ok`.
  - adding FAILED rows: both are listed and exit 1.
- Lake was called 0 times, and no check.sh exists in the harness.

**Known:** Not known. Searched for 'scan-diag', 'run-diag', 'run-all', 'diag-quick', 'count.txt', 'INCONCLUSIVE', 'PIPESTATUS', 'exits nonzero', 'exit status', 'Audit/diag', 'diag', 'vacuous' and '#194' in these places:
- docs/backlog.md and docs/archive/plans/
- the chunk 46 and chunk 49 plans
- seedelf-verification/Audit/review/findings.md and seedelf-verification/README.md, including Not proved
- SECURITY.md and review-51/owner-calls.md
- review-51's INDEX.md, lanes/, verify/ and fixes/

**Related but different:**
- verify/v3-1.md asked run-all.sh to carry each check.sh family's status into count.txt, the origin of this list. It also says "count.py itself always exits 0". It says nothing about diag.
- verify/v4a-1.md note 5 says no full diag run's outcome is recorded.

**Fix notes:**

**What to change.**
1. **scan-diag.py:** have main() return a status, and end the file with `sys.exit(main())`. Return 1 when any row is LOOK, INCONCLUSIVE (MISSING included) or FAILED.
   - The finder's `sys.exit(1 if flags or incon else 0)` leaves out a theorem whose Lean run failed, timed out or was killed. Mutant case B still exits 0 with it.
   - The cleanest form is to count a FAILED row as INCONCLUSIVE in the scan itself. It has no verdict, and Audit/README.md:45 says nothing unsettled counts clean. The summary line and the status then agree.
   - verdict() ignores each run's `rc=` line, so also treat a nonzero rc as not clean. Either the scan reads it, or run-diag.sh remembers any nonzero rc from :32 and exits nonzero.
2. **No edit needed in run-all.sh.** Both diag branches (:27-28 and :30-31) then list diag, since the control shows its plumbing works.
3. **Docs:**
   - run-all.sh:4-5 and Audit/README.md:56 should say that diag is listed when its scan flags any row. The printf label could read "failed or flagged".
   - The scan's docstring should state its exit status.
4. **Accepted LOOKs:** the audit's record accepts some LOOK rows after a hand check ("only Nat recursions checked by hand", findings.json). If the owner wants those to pass, list the reviewed theorems in a file the scan reads. Don't exit 0 for every LOOK.

**Class.** A runner whose exit status doesn't carry its verdict: the same class as v3#1, where a result that proved nothing read as ok. Its members:
- scan-diag.py's status;
- run-diag.sh's per-theorem rc (:30-34);
- both diag branches of run-all.sh.

A sibling worth folding into the same change: count.py's main() always exits 0 (count.py:143-144), and run-all.sh never takes its status. So a WRONG, STALE or NO TRACE row in count.txt, for example a count that's off while check.sh said ok, doesn't reach run-all's status either. check.sh already does it right (:241-252, :269).

The fix touches only the verification tooling, with no refusal, privacy default or screen, so it doesn't need the owner. Whether accepted LOOKs need a reviewed list is the owner's call.

**Test:** `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/scratchpad/r51/work/verify-r2verif_4-trace/r51_r2verif_4_repro.sh`

Result: The harness exited 1: the finding holds. The output, abridged:
```
## Copies from FIXTREE's committed HEAD (f88560c4)
  Audit/diag/run-diag.sh  sha256 279ec8e6cb726d34  (HEAD blob 279ec8e6cb726d34)
  Audit/diag/scan-diag.py  sha256 389861a7da945be7  (HEAD blob 389861a7da945be7)
  Audit/count.py  sha256 56dcfc7b68fa78e0  (HEAD blob 56dcfc7b68fa78e0)
  Audit/run-all.sh  sha256 65118863f697f1ff: its lines 12-43 run below
## 0. scan-diag.py alone, on its own self-test fixtures, no replays
    | Z3       S1_fake  lam=0 rec=1 recNat=1 ext=0 coe=0 sorts=0  <-- LOOK
    | OPT-ONLY S2_opt
    | FAILED   S3_fail
    | 3 theorems; 1 closed by the optimizer alone; 1 needed Z3; 1 failed; 1 flagged; 0 inconclusive; no replays run (--no-z3)
  scan-diag.py's exit status: 0
## A. The finding
    | Z3       D901_vacuous_bg  ... full=unsat bg=unsat prem=unsat alt=unsat  <-- LOOK
    | Z3       D902_prem_timeout  ... full=unsat bg=sat prem=timeout alt=unsat  <-- INCONCLUSIVE
    | Z3       D903_clean  ... full=unsat bg=sat prem=sat alt=unsat
    | OPT-ONLY D904_optimizer
    | 4 theorems; 1 closed by the optimizer alone; 3 needed Z3; 0 failed; 1 flagged; 1 inconclusive
  count.txt:  == audit-quick (1 modules) / ok Audit.Fake: 0 Valid, 0 Expected Falsified, 1 #guard / == 1 ok
  run-all's exit status: 0
  FAIL  count.txt names no family and run-all exits 0, though the scan found 1 LOOK (bg=unsat, a vacuous ✅) and 1 INCONCLUSIVE
## B. Wider: a Lean run that's killed (FAILED)
    | FAILED   D905_killed
    | 3 theorems; 1 closed by the optimizer alone; 1 needed Z3; 1 failed; 0 flagged; 0 inconclusive
  count.txt: ... == 1 ok          run-all's exit status: 0
  out/D905_killed.txt: Killed (stub: a Lean run over its memory cap) rc=137
  FAIL  count.txt names no family and run-all exits 0, though the scan found a theorem whose Lean run was killed (rc=137)
## C. Control (no --alt z3)
  the scan said: scan-diag.py: no --alt z3 at /nonexistent/z3
  count.txt: ... == check.sh or run-diag.sh failed: diag (exit 1) (Audit/logs/)     run-all's exit status: 1
  ok    the failure list and the status carry run-diag.sh's own exit
## D. The fix, scratch copy only
  scan-diag.py returns 1 on: flags or incon
    case A: run-all exits 1; count.txt's last line: == check.sh or run-diag.sh failed: diag (exit 1) (Audit/logs/)
    case B: run-all exits 0; count.txt's last line: == 1 ok
  scan-diag.py returns 1 on: flags or incon or any(r['verdict'] == 'FAILED' for r in rows)
    case A: run-all exits 1; ... failed: diag (exit 1)
    case B: run-all exits 1; ... failed: diag (exit 1)
## Lean, Lake or check.sh reached: 0 lake calls (stub), and no check.sh exists under .../run/sv
RESULT: finding holds: a diag run's LOOK, INCONCLUSIVE or FAILED never reaches count.txt or run-all's status
```
Nothing was written into FIXTREE: `git status --short -- seedelf-verification` there is empty.

```
#!/usr/bin/env bash
# r51_r2verif_4_repro.sh: chunk 51, finding r2verif#4 (trace verifier).
#
# The claim: Audit/run-all.sh's new failure list (count.txt's "== check.sh or run-diag.sh
# failed: ..." line, and run-all.sh's exit status) never names `diag` when the replay flags a
# LOOK or an INCONCLUSIVE, because run-diag.sh's status is scan-diag.py's and scan-diag.py exits
# 0 whatever it finds.
#
# No Lean, no Lake, no check.sh. A fake seedelf-verification under ./run holds byte-identical
# copies of FIXTREE HEAD's Audit/diag/run-diag.sh, Audit/diag/scan-diag.py and Audit/count.py.
# run-all.sh's own lines 12-43 (everything but its shebang, comments and `cd`) run with the one
# family `diag`, as `bash Audit/run-all.sh diag` would. Stubs for `lake` and `systemd-run` sit
# ahead on PATH, so no Lean can start: the systemd-run stub plays a Lean run killed over its cap.
# The replays use the real z3 (5.3.1 on PATH, 4.15.2 under ~/tools for --alt) on small fixture
# queries. SCAN_TIMEOUT=3 (run-all.sh's diag branch leaves it to run-diag.sh's 600 s default)
# only bounds the one premise replay that can't settle.
#
# It asserts what Audit/README.md:56 and run-all.sh:4-5 promise: a diag run that found a LOOK, an
# INCONCLUSIVE or a failed Lean run puts diag in count.txt's failure line, and run-all exits
# nonzero. Exits 1 while the finding holds, 0 once it's fixed, 2 if the harness itself is off.
# Run: systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 20m bash <this>
set -u
FIX=/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51-fixes
W=$(cd "$(dirname "$0")" && pwd)
R=$W/run
SV=$R/sv
D=$SV/Audit/diag
rm -rf "$R"
mkdir -p "$R/stubs" "$D/out" "$SV/Audit/logs" "$SV/.lake/build/lib/lean/Audit"
fail=0
die() { echo "HARNESS: $*"; exit 2; }

echo "## Copies from FIXTREE's committed HEAD ($(git -C "$FIX" rev-parse --short HEAD))"
for p in Audit/diag/run-diag.sh Audit/diag/scan-diag.py Audit/count.py; do
  git -C "$FIX" show "HEAD:seedelf-verification/$p" > "$SV/$p" || die "no $p at HEAD"
  echo "  $p  sha256 $(sha256sum < "$SV/$p" | cut -c1-16)  (HEAD blob $(git -C "$FIX" show "HEAD:seedelf-verification/$p" | sha256sum | cut -c1-16))"
done
git -C "$FIX" show HEAD:seedelf-verification/Audit/run-all.sh > "$R/run-all.sh.orig"
echo "  Audit/run-all.sh  sha256 $(sha256sum < "$R/run-all.sh.orig" | cut -c1-16): its lines 12-43 run below"
[ "$(sed -n 12p "$R/run-all.sh.orig")" = 'mkdir -p Audit/logs' ] \
  && [ "$(sed -n 43p "$R/run-all.sh.orig")" = '[ ${#failed[@]} -eq 0 ]' ] \
  || die "run-all.sh's lines moved: re-check the extraction"
{ echo 'set -- diag   # as: bash Audit/run-all.sh diag'; sed -n '12,43p' "$R/run-all.sh.orig"; } > "$R/run-all-body.sh"

# Stubs: nothing named lake or systemd-run that this harness reaches is real.
export STUBLOG=$R/stub-calls.log
: > "$STUBLOG"
cat > "$R/stubs/lake" <<'EOF'
#!/usr/bin/env bash
echo "lake $*" >> "$STUBLOG"; echo "stub lake: no Lean runs here"; exit 97
EOF
cat > "$R/stubs/systemd-run" <<'EOF'
#!/usr/bin/env bash
echo "systemd-run $*" >> "$STUBLOG"
echo "Killed (stub: a Lean run over its memory cap)"; exit 137
EOF
chmod +x "$R/stubs/lake" "$R/stubs/systemd-run"
( PATH="$R/stubs:$PATH"
  [ "$(command -v lake)" = "$R/stubs/lake" ] && [ "$(command -v systemd-run)" = "$R/stubs/systemd-run" ] ) \
  || die "the stubs don't shadow lake and systemd-run"

# count.py's side: one audit family with one module that reads ok, so count.txt reads clean.
printf 'Audit.Fake\n' > "$SV/Audit/audit-quick.txt"
printf '#guard true\n' > "$SV/Audit/Fake.lean"
printf '{"log": []}\n' > "$SV/.lake/build/lib/lean/Audit/Fake.trace"
touch -d '2026-11-18 01:00' "$SV/Audit/Fake.lean"
touch -d '2026-11-18 02:00' "$SV/.lake/build/lib/lean/Audit/Fake.trace"

# Diag fixtures, in Blaster's dump format (Smt Query:, the commands, the Undetermined warning).
w_vacuous() { cat > "$D/out/D901_vacuous_bg.txt" <<'EOF'
Smt Query:
(set-option :print-success true)
(set-option :produce-models true)
(declare-fun @f (Int) Int)
(assert (forall ((x Int)) (! (> (@f x) x) :pattern ((@f x)))))
(assert (< (@f 0) 0))
(declare-const $0 Int)
(assert (not (=> (> $0 0) (>= $0 0))))
Audit/diag/lean/D901_vacuous_bg.lean:3:0: warning: ⚠️ Undetermined
rc=0
EOF
}
w_timeout() { cat > "$D/out/D902_prem_timeout.txt" <<'EOF'
Smt Query:
(set-option :print-success true)
(declare-const $0 Int)
(declare-const $1 Int)
(declare-const $2 Int)
(assert (not (=> (= (+ (* $0 $0 $0) (* $1 $1 $1) (* $2 $2 $2)) 33) (= $0 $0))))
Audit/diag/lean/D902_prem_timeout.lean:3:0: warning: ⚠️ Undetermined
rc=0
EOF
}
w_clean() { cat > "$D/out/D903_clean.txt" <<'EOF'
Smt Query:
(set-option :print-success true)
(declare-const $0 Int)
(declare-const $1 Int)
(assert (not (=> (> $0 0) (=> (= $1 (+ $0 1)) (> $1 1)))))
Audit/diag/lean/D903_clean.lean:3:0: warning: ⚠️ Undetermined
rc=0
EOF
printf 'Audit/diag/lean/D904_optimizer.lean:3:0: ✅ Valid\nrc=0\n' > "$D/out/D904_optimizer.txt"
}
setup() {  # $1: the theorems listed, by D-number
  rm -rf "$D/out" "$SV/Audit/logs"; mkdir -p "$D/out" "$SV/Audit/logs"; : > "$D/list-quick.txt"
  for n in "$@"; do
    case $n in
      901) w_vacuous; echo Audit/diag/lean/D901_vacuous_bg.lean ;;
      902) w_timeout; echo Audit/diag/lean/D902_prem_timeout.lean ;;
      903) w_clean; echo Audit/diag/lean/D903_clean.lean ;;
      904) echo Audit/diag/lean/D904_optimizer.lean ;;
      905) echo Audit/diag/lean/D905_killed.lean ;;  # no output yet: run-diag.sh runs "Lean"
    esac >> "$D/list-quick.txt"
  done
}
run_all() {  # run-all.sh's lines with the family diag; sets $st and shows count.txt
  ( cd "$SV" && PATH="$R/stubs:$PATH" bash "$R/run-all-body.sh" ) > "$R/console.$1" 2>&1
  st=$?
  echo "  diag-quick.log, the scan's rows and summary:"
  grep -E '^(OPT-ONLY|Z3|FAILED|MISSING) |theorems;' "$SV/Audit/logs/diag-quick.log" | sed 's/^/    | /'
  echo "  count.txt:"; sed 's/^/    | /' "$SV/Audit/logs/count.txt"
  echo "  run-all's exit status: $st"
}
want_named() {  # $1: what the scan found
  if grep -q 'failed: diag' "$SV/Audit/logs/count.txt" && [ "$st" != 0 ]; then
    echo "  ok    count.txt names diag and run-all exits $st: $1"
  else
    echo "  FAIL  count.txt names no family and run-all exits $st, though the scan found $1"; fail=1
  fi
}

echo
echo "## 0. scan-diag.py alone, on its own self-test fixtures (selftest/S1_fake, S2_opt, S3_fail), no replays"
mkdir -p "$R/selftest"
for s in S1_fake S2_opt S3_fail; do
  git -C "$FIX" show "HEAD:seedelf-verification/Audit/diag/selftest/$s.txt" > "$R/selftest/$s.txt"
done
python3 -I "$D/scan-diag.py" "$R/selftest" --no-z3 2>&1 | sed 's/^/    | /'
echo "  scan-diag.py's exit status: ${PIPESTATUS[0]}"

export SCAN_TIMEOUT=3
echo
echo "## A. The finding: the replay flags a vacuous background (LOOK) and an unsettled premise (INCONCLUSIVE)"
setup 901 902 903 904
run_all A
grep -q 'D901_vacuous_bg.*<-- LOOK' "$SV/Audit/logs/diag-quick.log" \
  && grep -q 'D902_prem_timeout.*<-- INCONCLUSIVE' "$SV/Audit/logs/diag-quick.log" \
  && grep -q '1 flagged; 1 inconclusive' "$SV/Audit/logs/diag-quick.log" || die "fixtures A didn't flag as meant"
want_named "1 LOOK (bg=unsat, a vacuous ✅) and 1 INCONCLUSIVE"

echo
echo "## B. Wider: a Lean run that's killed (FAILED), and nothing else wrong"
setup 903 904 905
: > "$STUBLOG"
run_all B
grep -q '^FAILED   D905_killed' "$SV/Audit/logs/diag-quick.log" && grep -q '; 1 failed;' "$SV/Audit/logs/diag-quick.log" \
  || die "fixture B didn't fail as meant"
echo "  out/D905_killed.txt: $(tr '\n' ' ' < "$D/out/D905_killed.txt")"
echo "  stub calls: $(wc -l < "$STUBLOG") systemd-run, $(grep -c '^lake' "$STUBLOG") lake (the stub stands in for: $(cut -c1-140 "$STUBLOG"))"
want_named "a theorem whose Lean run was killed (rc=137)"

echo
echo "## C. Control: when run-diag.sh does exit nonzero (no --alt z3), the list names diag"
setup 901 902 903 904
export Z3_ALT=/nonexistent/z3
run_all C
unset Z3_ALT
echo "  the scan said: $(grep -m1 'scan-diag.py:' "$SV/Audit/logs/diag-quick.log")"
if grep -q '== check.sh or run-diag.sh failed: diag (exit 1)' "$SV/Audit/logs/count.txt" && [ "$st" = 1 ]; then
  echo "  ok    the failure list and the status carry run-diag.sh's own exit"
else die "control C: the list didn't name diag on run-diag.sh's exit 1"; fi

echo
echo "## D. The fix, in this scratch copy only: scan-diag.py's verdict becomes its exit status"
cp "$D/scan-diag.py" "$R/scan-diag.py.head"
mutate() {  # $1: the condition main() returns 1 on
  cp "$R/scan-diag.py.head" "$D/scan-diag.py"
  python3 -I - "$D/scan-diag.py" "$1" <<'EOF'
import sys
p, cond = sys.argv[1], sys.argv[2]
s = open(p, encoding='utf-8').read()
tail = "+ ('' if use_z3 else '; no replays run (--no-z3)'))\n"
assert s.count(tail) == 1 and s.endswith('\nmain()\n')
s = s.replace(tail, tail + f"    return 1 if ({cond}) else 0\n")
s = s[:-len('main()\n')] + 'sys.exit(main())\n'
open(p, 'w', encoding='utf-8').write(s)
EOF
  [ $? = 0 ] || die "the fix mutant didn't apply"
}
for variant in "flags or incon" "flags or incon or any(r['verdict'] == 'FAILED' for r in rows)"; do
  mutate "$variant"
  echo "  scan-diag.py returns 1 on: $variant"
  for case in "A 901 902 903 904" "B 903 904 905"; do
    set -- $case; c=$1; shift; setup "$@"
    ( cd "$SV" && PATH="$R/stubs:$PATH" bash "$R/run-all-body.sh" ) > "$R/console.D$c" 2>&1; st=$?
    echo "    case $c: run-all exits $st; count.txt's last line: $(tail -n 1 "$SV/Audit/logs/count.txt")"
  done
done
cp "$R/scan-diag.py.head" "$D/scan-diag.py"

echo
echo "## Lean, Lake or check.sh reached: $(grep -c '^lake' "$STUBLOG") lake calls (stub), and no check.sh exists under $SV"
[ "$fail" = 0 ] && echo "RESULT: the failure list names diag whenever the scan finds something (finding refuted)" \
  || echo "RESULT: finding holds: a diag run's LOOK, INCONCLUSIVE or FAILED never reaches count.txt or run-all's status"
exit "$fail"
```
