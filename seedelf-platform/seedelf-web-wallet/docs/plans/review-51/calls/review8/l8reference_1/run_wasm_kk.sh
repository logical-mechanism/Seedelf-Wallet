#!/bin/bash
# l8reference#1: seedelf-wasm's native suite (release) with the Known.kept flag forced false and forced true.
W=calls/review8/l8reference_1
cd "$W/seedelf-platform" || exit 1
mkdir -p "$W/logs"
for m in "$@"; do
  start=$(date +%s)
  L8REF1_KK=$m RUST_TEST_THREADS=6 CARGO_TARGET_DIR=$HOME/.cache/seedelf-calls/r8-target-l8reference_1 \
    nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 40m \
    cargo test --release --offline --locked -p seedelf-wasm --no-fail-fast > "$W/logs/wasm_$m.log" 2>&1
  code=$?
  end=$(date +%s)
  passed=$(grep -E "^test result" "$W/logs/wasm_$m.log" | awk '{p+=$4} END {print p}')
  failed=$(grep -E "^test result" "$W/logs/wasm_$m.log" | awk '{f+=$6} END {print f}')
  ignored=$(grep -E "^test result" "$W/logs/wasm_$m.log" | awk '{f+=$8} END {print f}')
  echo "== wasm $m: exit $code, passed $passed, failed $failed, ignored $ignored ($((end-start)) s)"
  grep -E "^test .* FAILED$" "$W/logs/wasm_$m.log" | sed 's/^test /   /'
done
echo "== done"
