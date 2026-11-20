#!/usr/bin/env bash
# Dumps every pick (and plain pick) the reference's default parts and its sweep ask for, on HEAD and under each
# mutation, to compare. In the scratch copy only.
R=calls/review6/l6reference_6
export CARGO_TARGET_DIR="$HOME/.cache/seedelf-calls/r6-target-l6reference_6"
cd "$R/seedelf-platform" || exit 1
python3 -I "$R/dump.py" seedelf-core/tests/box_rule_reference_test.rs seedelf-core/tests/box_rule_reference_dump_test.rs || exit 1
for m in none fund-session-tier-0 c-largest-ignores-tier; do
  python3 -I "$R/mut.py" "$m"
  nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 30m \
    cargo test --locked --offline -j 6 -p seedelf-core --test box_rule_reference_dump_test -- \
    --test-threads=1 --nocapture selection_picks > "$R/runs/dump-$m.log" 2>&1
  echo "exit $?" >> "$R/runs/dump-$m.log"
  grep -E "^(PICK|PLAIN) " "$R/runs/dump-$m.log" > "$R/runs/dump-$m.picks"
done
python3 -I "$R/mut.py" none
for m in fund-session-tier-0 c-largest-ignores-tier; do
  echo "== $m: $(wc -l < "$R/runs/dump-$m.picks") picks, $(diff "$R/runs/dump-none.picks" "$R/runs/dump-$m.picks" | grep -c '^[<>]') lines differ from HEAD"
done
echo "HEAD picks: $(wc -l < "$R/runs/dump-none.picks"); with another session's money: $(grep -c OtherSession "$R/runs/dump-none.picks"); of those past the limit: $(grep OtherSession "$R/runs/dump-none.picks" | grep -c 'received of 2')"
grep -E "^test result|^exit" "$R/runs/dump-"*.log
echo DUMPDONE
