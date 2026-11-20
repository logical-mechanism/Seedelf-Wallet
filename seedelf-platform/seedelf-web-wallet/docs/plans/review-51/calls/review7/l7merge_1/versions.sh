#!/usr/bin/env bash
# Runs the l7merge#1 pin against round six's (88e1c84d) and 1e1b0647's build.rs, then restores HEAD's.
D=calls/review7/l7merge_1
FIX=.
cd "$D/seedelf-platform" || exit 1
for v in 88e1c84d 1e1b0647; do
  git -C "$FIX" show "$v:seedelf-platform/seedelf-core/src/build.rs" > seedelf-core/src/build.rs
  CARGO_TARGET_DIR=$HOME/.cache/seedelf-calls/r7-target-l7merge_1 nice -n 10 systemd-run --user --scope -q \
    -p MemoryMax=8G -p MemorySwapMax=0 timeout 40m \
    cargo test --offline --locked -j 6 -p seedelf-core --test mint_test inside_the_weights_margin -- --nocapture \
    > "$D/logs/run-$v.log" 2>&1
  echo "exit $?" >> "$D/logs/run-$v.log"
done
cp "$D/build-head.rs" seedelf-core/src/build.rs
cmp -s seedelf-core/src/build.rs "$FIX/seedelf-platform/seedelf-core/src/build.rs" && echo "restored HEAD's build.rs"
for v in 88e1c84d 1e1b0647; do
  echo "== $v"
  grep -E '^(A|B) with|^(A|B) without|^error|^exit|test result|panicked' "$D/logs/run-$v.log" | head -20
done
