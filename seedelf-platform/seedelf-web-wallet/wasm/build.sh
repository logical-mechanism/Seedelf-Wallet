#!/usr/bin/env bash
# Build the seedelf-wasm crate into an ES module under ./pkg.
#
# Needs: the wasm32-unknown-unknown Rust target, clang with a wasm32 backend
# (blst is C code), llvm-ar, and wasm-bindgen-cli at the exact version of the
# wasm-bindgen crate in Cargo.lock.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
workspace="$(cd "$here/../.." && pwd)"

export CC_wasm32_unknown_unknown="${CC_wasm32_unknown_unknown:-clang}"
if [[ -z "${AR_wasm32_unknown_unknown:-}" ]]; then
  # Ubuntu ships llvm-ar with a version suffix.
  AR_wasm32_unknown_unknown="$(command -v llvm-ar || compgen -c llvm-ar- | sort -V | tail -1 || true)"
  export AR_wasm32_unknown_unknown
fi
if [[ -z "$AR_wasm32_unknown_unknown" ]]; then
  echo "llvm-ar not found; install llvm or set AR_wasm32_unknown_unknown" >&2
  exit 1
fi

wanted="$(grep -A1 '^name = "wasm-bindgen"$' "$workspace/Cargo.lock" | sed -n 's/^version = "\(.*\)"$/\1/p')"
have="$(wasm-bindgen --version 2>/dev/null | awk '{print $2}' || true)"
if [[ "$have" != "$wanted" ]]; then
  echo "wasm-bindgen-cli $wanted required (found: ${have:-none})." >&2
  echo "Install it with: cargo install wasm-bindgen-cli --version $wanted --locked" >&2
  exit 1
fi

# wasm-release (the workspace Cargo.toml) is release built for size.
cargo build --manifest-path "$here/Cargo.toml" --target wasm32-unknown-unknown --profile wasm-release
wasm-bindgen --target web --out-dir "$here/pkg" \
  "$workspace/target/wasm32-unknown-unknown/wasm-release/seedelf_wasm.wasm"

wasm="$here/pkg/seedelf_wasm_bg.wasm"
echo "Built $(du -h "$wasm" | cut -f1) ($(gzip -9 -c "$wasm" | wc -c | awk '{printf "%d KB", $1 / 1024}') gzipped) -> $here/pkg"
