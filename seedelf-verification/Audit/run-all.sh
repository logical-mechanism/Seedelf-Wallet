#!/usr/bin/env bash
# The whole audit, family by family, cheapest first (Audit/README.md), each through check.sh's
# capped scopes. Each family's console output goes to Audit/logs/<family>.log (the `diag`
# family's to diag-quick.log), and count.py's
# verdict to Audit/logs/count.txt, with the families whose run failed, a diag scan that flagged
# a row (LOOK, INCONCLUSIVE, FAILED) among them; then it exits nonzero, as a full run also does
# when count.py finds a module not ok. A run that stops (Ctrl-C, a reboot) resumes where it left
# off: Lake keeps every module that built.
#   bash Audit/run-all.sh                     everything (hours: run it overnight)
#   bash Audit/run-all.sh audit-v2 diag       some families
#   bash Audit/run-all.sh diag-all            the diagnostic over every theorem, not just 9
cd "$(dirname "$0")/.." || exit 1
mkdir -p Audit/logs
fams=("$@")
[ ${#fams[@]} -eq 0 ] && fams=(audit-refresh audit-quick audit-seedelf audit-v2 audit-template
  audit-classic audit-gaps audit-last diag)
failed=()
for f in "${fams[@]}"; do
  # Several #blaster commands in one module run at once, each with its own Z3: hence 16G.
  case $f in
    audit-refresh|audit-quick|audit-last) cap=8G; limit=30m ;;
    diag) cap=12G; limit=30m ;;
    diag-all) cap=16G; limit=60m ;;
    *) cap=16G; limit=60m ;;
  esac
  echo "==== $f (cap $cap, limit $limit) $(date '+%F %T')"
  if [ "$f" = diag ]; then
    CAP=$cap LIMIT=$limit bash Audit/diag/run-diag.sh quick 2>&1 | tee Audit/logs/diag-quick.log
    rc=${PIPESTATUS[0]}
  elif [ "$f" = diag-all ]; then
    CAP=$cap LIMIT=$limit SCAN_TIMEOUT=1800 bash Audit/diag/run-diag.sh all 2>&1 | tee Audit/logs/diag-all.log
    rc=${PIPESTATUS[0]}
  else
    CAP=$cap LIMIT=$limit ./check.sh "$f" 2>&1 | tee "Audit/logs/$f.log"
    rc=${PIPESTATUS[0]}
  fi
  [ "$rc" = 0 ] || failed+=("$f (exit $rc)")
done
echo "==== count $(date '+%F %T')"
# count.py reads what the builds left, and exits 1 for a module not ok; a family's own run's
# verdict (check.sh's, or the diag scan's) is only in its log, so the list says it here.
python3 -I Audit/count.py > Audit/logs/count.txt 2>&1; counted=$?
[ ${#failed[@]} -eq 0 ] || printf '\n== check.sh or run-diag.sh failed: %s (Audit/logs/)\n' "${failed[*]}" >> Audit/logs/count.txt
cat Audit/logs/count.txt
# A run of some families ends on their status alone; a full run on count.py's too, whose count is
# then the run's.
[ ${#failed[@]} -eq 0 ] && { [ $# -gt 0 ] || [ "$counted" = 0 ]; }
