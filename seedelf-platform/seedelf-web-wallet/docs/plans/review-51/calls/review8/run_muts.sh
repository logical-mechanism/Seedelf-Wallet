#!/bin/bash
# Review eight's mutation runner: the whole seedelf-core suite (release, already built) per switch.
W=calls/review8
cd $W/ref/seedelf-platform || exit 1
mkdir -p $W/mutlogs
for m in "$@"; do
  start=$(date +%s)
  R8REF_MUT=$m RUST_TEST_THREADS=6 CARGO_TARGET_DIR=$HOME/.cache/seedelf-calls/r8-target-ref \
    nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 40m \
    cargo test --release --offline --locked -p seedelf-core --no-fail-fast -- --nocapture > $W/mutlogs/$m.log 2>&1
  end=$(date +%s)
  passed=$(grep -E "^test result" $W/mutlogs/$m.log | awk '{p+=$4} END {print p}')
  failed=$(grep -E "^test result" $W/mutlogs/$m.log | awk '{f+=$6} END {print f}')
  echo "== $m: passed $passed failed $failed ($((end-start)) s)"
  grep -E "^test .* FAILED$" $W/mutlogs/$m.log | sed 's/^test /   /'
done
