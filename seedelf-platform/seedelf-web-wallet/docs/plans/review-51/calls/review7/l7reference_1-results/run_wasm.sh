#!/bin/bash
# Runs every seedelf-wasm native test binary (default tests) under each mutation switch.
D=$HOME/.cache/seedelf-calls/r7-target-l7reference_1/release/deps
R=calls/review7/l7reference_1
cd "$R/seedelf-platform/seedelf-web-wallet/wasm" || exit 1
mapfile -t bins < "$R/logs/wasm-bins.txt"
for v in "$@"; do
  echo "== $v"
  tp=0; tf=0
  for b in "${bins[@]}"; do
    if [ "$v" = NONE ]; then out=$(nice -n 10 timeout 900 "$D/$b" 2>&1); else out=$(env "$v=1" nice -n 10 timeout 900 "$D/$b" 2>&1); fi
    r=$(echo "$out" | grep -E "^test result" | head -1)
    p=$(echo "$r" | sed -E 's/.* ([0-9]+) passed.*/\1/')
    f=$(echo "$r" | sed -E 's/.* ([0-9]+) failed.*/\1/')
    tp=$((tp + ${p:-0})); tf=$((tf + ${f:-0}))
    [ -z "$r" ] && echo "  ${b%-*}: no result line"
    echo "$out" | grep -E "\.\.\. FAILED" | sed "s#^#  ${b%-*}: #"
  done
  echo "  total passed $tp failed $tf over ${#bins[@]} binaries"
done
