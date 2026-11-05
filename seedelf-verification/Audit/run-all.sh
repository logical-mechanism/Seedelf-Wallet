#!/usr/bin/env bash
# The whole audit, family by family, cheapest first (Audit/README.md), each through check.sh's
# capped scopes. Each family's console output goes to Audit/logs/<family>.log (the `diag`
# family's to diag-quick.log), and count.py's
# verdict to Audit/logs/count.txt. A run that stops (Ctrl-C, a reboot) resumes where it left
# off: Lake keeps every module that built.
#   bash Audit/run-all.sh                     everything (hours: run it overnight)
#   bash Audit/run-all.sh audit-v2 diag       some families
#   bash Audit/run-all.sh diag-all            the diagnostic over every theorem, not just 9
cd "$(dirname "$0")/.." || exit 1
mkdir -p Audit/logs
fams=("$@")
[ ${#fams[@]} -eq 0 ] && fams=(audit-refresh audit-quick audit-seedelf audit-v2 audit-template
  audit-classic audit-gaps audit-last diag)
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
  elif [ "$f" = diag-all ]; then
    CAP=$cap LIMIT=$limit SCAN_TIMEOUT=1800 bash Audit/diag/run-diag.sh all 2>&1 | tee Audit/logs/diag-all.log
  else
    CAP=$cap LIMIT=$limit ./check.sh "$f" 2>&1 | tee "Audit/logs/$f.log"
  fi
done
echo "==== count $(date '+%F %T')"
python3 -I Audit/count.py 2>&1 | tee Audit/logs/count.txt
