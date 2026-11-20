#!/usr/bin/env bash
# HEAD: the two new test targets; then the three mutations over both crates' Rust suites.
R=calls/review6/l6reference_6
export CARGO_TARGET_DIR="$HOME/.cache/seedelf-calls/r6-target-l6reference_6"
cd "$R/seedelf-platform" || exit 1
python3 -I "$R/mut.py" none
nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 30m \
  cargo test --locked --offline -j 6 -p seedelf-core --test box_rule_reference_own_table_test \
  --test l6reference_6_probe_test --test box_rule_reference_test -- --test-threads=4 --nocapture \
  > "$R/runs/head-new.log" 2>&1
echo "head-new exit $?" >> "$R/runs/head-new.log"
for m in pay-rank-swap fund-session-tier-0 c-largest-ignores-tier; do
  bash "$R/suite.sh" "$m" both > "$R/runs/$m.summary" 2>&1
done
echo ALLDONE > "$R/runs/all.done"
