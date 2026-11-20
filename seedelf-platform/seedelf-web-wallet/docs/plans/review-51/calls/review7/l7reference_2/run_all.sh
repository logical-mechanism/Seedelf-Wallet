#!/bin/bash
# Runs every core and wasm test binary (default tests) with L7R2_W unset and set to each mode given.
D=calls/review7/l7reference_2
T=$HOME/.cache/seedelf-calls/r7-target-l7reference_2/release/deps
out=$D/logs/all
for mode in "$@"; do
  while read -r dir bin; do
    if [ "$mode" = head ]; then
      (cd "$dir" && "$T/$bin" --test-threads 6 > "$out/$mode-$bin.log" 2>&1)
    else
      (cd "$dir" && L7R2_W=$mode "$T/$bin" --test-threads 6 > "$out/$mode-$bin.log" 2>&1)
    fi
    code=$?
    echo "$mode $bin exit $code $(grep -E '^test result' "$out/$mode-$bin.log" | tail -1)"
  done < "$out/map2.txt"
done
