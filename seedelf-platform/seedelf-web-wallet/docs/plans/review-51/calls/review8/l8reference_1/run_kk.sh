#!/bin/bash
# l8reference#1: the whole seedelf-core suite (release) with the Known.kept flag as built, forced false, forced true.
W=calls/review8/l8reference_1
cd "$W/seedelf-platform" || exit 1
mkdir -p "$W/logs"
for m in "$@"; do
  start=$(date +%s)
  if [ "$m" = "unset" ]; then
    env -u L8REF1_KK RUST_TEST_THREADS=6 CARGO_TARGET_DIR=$HOME/.cache/seedelf-calls/r8-target-l8reference_1 \
      nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 40m \
      cargo test --release --offline --locked -p seedelf-core --no-fail-fast > "$W/logs/core_$m.log" 2>&1
  else
    L8REF1_KK=$m RUST_TEST_THREADS=6 CARGO_TARGET_DIR=$HOME/.cache/seedelf-calls/r8-target-l8reference_1 \
      nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 40m \
      cargo test --release --offline --locked -p seedelf-core --no-fail-fast > "$W/logs/core_$m.log" 2>&1
  fi
  code=$?
  end=$(date +%s)
  passed=$(grep -E "^test result" "$W/logs/core_$m.log" | awk '{p+=$4} END {print p}')
  failed=$(grep -E "^test result" "$W/logs/core_$m.log" | awk '{f+=$6} END {print f}')
  ignored=$(grep -E "^test result" "$W/logs/core_$m.log" | awk '{f+=$8} END {print f}')
  echo "== $m: exit $code, passed $passed, failed $failed, ignored $ignored ($((end-start)) s)"
  grep -E "^test .* FAILED$" "$W/logs/core_$m.log" | sed 's/^test /   /'
done
echo "== done"
