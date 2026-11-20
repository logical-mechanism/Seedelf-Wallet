#!/bin/bash
# Runs every core test binary (default tests) under each mutation switch; prints failures and totals.
D=$HOME/.cache/seedelf-calls/r7-target-l7reference_1/release/deps
cd calls/review7/l7reference_1/seedelf-platform/seedelf-core || exit 1
mapfile -t bins < <(ls "$D" | grep -E '^[a-z_]+-[0-9a-f]{16}$')
for v in "$@"; do
  echo "== $v"
  tp=0; tf=0
  for b in "${bins[@]}"; do
    if [ "$v" = NONE ]; then out=$(nice -n 10 timeout 600 "$D/$b" 2>&1); else out=$(env "$v=1" nice -n 10 timeout 600 "$D/$b" 2>&1); fi
    r=$(echo "$out" | grep -E "^test result" | head -1)
    p=$(echo "$r" | sed -E 's/.* ([0-9]+) passed.*/\1/')
    f=$(echo "$r" | sed -E 's/.* ([0-9]+) failed.*/\1/')
    tp=$((tp + ${p:-0})); tf=$((tf + ${f:-0}))
    echo "$out" | grep -E "\.\.\. FAILED" | sed "s#^#  ${b%-*}: #"
  done
  echo "  total passed $tp failed $tf over ${#bins[@]} binaries"
done
