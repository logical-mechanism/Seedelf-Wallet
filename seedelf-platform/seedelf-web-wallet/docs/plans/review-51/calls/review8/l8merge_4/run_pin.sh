#!/usr/bin/env bash
# Runs the l8merge#4 pin in the copy with the given build.rs and transaction.rs. Usage: run_pin.sh <build.rs> <transaction.rs> <release|debug> <times>
D=calls/review8/l8merge_4
cp "$D/$1" "$D/seedelf-platform/seedelf-core/src/build.rs"
cp "$D/$2" "$D/seedelf-platform/seedelf-core/src/transaction.rs"
flag=""; [ "$3" = release ] && flag="--release"
cd "$D/seedelf-platform" || exit 1
for i in $(seq 1 "$4"); do
  echo "--- $1 $2 $3 run $i: $(uptime | sed 's/.*load/load/')"
  CARGO_TARGET_DIR=$HOME/.cache/seedelf-calls/r8-target-l8merge_4 nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 40m \
    cargo test --offline --locked $flag -j 6 -p seedelf-core --test box_rule_reference_test token_boxes_beside_money_holding_many_kinds -- --nocapture 2>&1 \
    | grep -E "inputs in|refused \(|slowest|panicked|test result|^error"
done
