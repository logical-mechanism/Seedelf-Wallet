#!/usr/bin/env bash
# Runs each probe binary in turn, the order rotated each pass. Usage: run_reps.sh <first rep> <order>...
D=calls/review8/l8merge_4
rep=$1; shift
for order in "$@"; do
  for v in $order; do
    (cd "$D/seedelf-platform/seedelf-core" && REPEATS=${REPEATS:-5} nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 40m "$D/bins/$v" ${FILTER:-} --nocapture --test-threads=1 > "$D/logs/rep$rep-$v.log" 2>&1) || echo "$v rep $rep failed"
  done
  echo "rep $rep done: $(uptime)"
  rep=$((rep+1))
done
