#!/usr/bin/env bash
# Runs seedelf-core's tests (lib and every integration test) and seedelf-wasm's (lib and every Rust integration
# test) under one mutation, in the scratch copy only. Usage: suite.sh NAME [core|wasm|both]
R=calls/review6/l6reference_6
NAME="$1"
PARTS="${2:-both}"
export CARGO_TARGET_DIR="$HOME/.cache/seedelf-calls/r6-target-l6reference_6"
cd "$R/seedelf-platform" || exit 1
python3 -I "$R/mut.py" "$NAME" || exit 1
LOG="$R/runs/$NAME"
if [ "$PARTS" != wasm ]; then
  nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 30m \
    cargo test --locked --offline -j 6 -p seedelf-core --lib --tests --no-fail-fast -- --test-threads=4 \
    > "$LOG.core.log" 2>&1
  echo "core exit $?" >> "$LOG.core.log"
fi
if [ "$PARTS" != core ]; then
  nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 30m \
    cargo test --locked --offline -j 6 -p seedelf-wasm --lib --tests --no-fail-fast -- --test-threads=4 \
    > "$LOG.wasm.log" 2>&1
  echo "wasm exit $?" >> "$LOG.wasm.log"
fi
python3 -I "$R/mut.py" none
for f in "$LOG.core.log" "$LOG.wasm.log"; do
  [ -f "$f" ] || continue
  echo "== $f"
  echo "ok tests: $(grep -c '^test .* ok$' "$f")"
  grep -E "^test .* FAILED|exit [0-9]+$|^error" "$f" | head -150
  grep -E "^test result" "$f" | grep -v "0 failed" | head -40
done
