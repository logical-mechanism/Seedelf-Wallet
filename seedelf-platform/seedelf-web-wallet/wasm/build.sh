#!/usr/bin/env bash
# Build the seedelf-wasm crate into an ES module under ./pkg.
#
# Needs: the Rust toolchain seedelf-platform/rust-toolchain.toml pins, with
# its wasm32-unknown-unknown target, clang with a wasm32 backend (blst is C
# code), llvm-ar, and wasm-bindgen-cli at the exact version of the
# wasm-bindgen crate in Cargo.lock.
#
# The crates are the ones Cargo.lock records (--locked: the build stops rather
# than resolve others), and no path on this machine goes into the module
# (--remap-path-prefix), so the same commit and toolchain give the same bytes
# on any machine (launch review #61).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
workspace="$(cd "$here/../.." && pwd)"
target="${CARGO_TARGET_DIR:-$workspace/target}"

if [[ ! -f "$workspace/Cargo.lock" ]]; then
  echo "$workspace/Cargo.lock is missing: it's tracked in git, and the build uses only the crates it records." >&2
  exit 1
fi

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

# Panic messages carry source paths: each is named from where it sits under
# these stand-ins, never from this machine's disk (the last match wins, so the
# target folder, inside the workspace by default, comes after it).
cargo_home="${CARGO_HOME:-$HOME/.cargo}"
sysroot="$(rustc --print sysroot)"
remap=(
  "--remap-path-prefix=$workspace=/seedelf-platform"
  "--remap-path-prefix=$target=/target"
  "--remap-path-prefix=$cargo_home/registry/src=/cargo/registry/src"
  "--remap-path-prefix=$cargo_home/git/checkouts=/cargo/git/checkouts"
  "--remap-path-prefix=$sysroot=/rustc/sysroot"
)
# The encoded form keeps a path with a space whole; it replaces RUSTFLAGS.
CARGO_ENCODED_RUSTFLAGS="$(IFS=$'\x1f'; echo "${remap[*]}")"
export CARGO_ENCODED_RUSTFLAGS

# wasm-release (the workspace Cargo.toml) is release built for size.
cargo build --locked --manifest-path "$here/Cargo.toml" --target wasm32-unknown-unknown --profile wasm-release
# The reset function lets the extension replace an instance that trapped
# (extension/src/background/wasm.ts).
wasm-bindgen --target web --experimental-reset-state-function --out-dir "$here/pkg" \
  "$target/wasm32-unknown-unknown/wasm-release/seedelf_wasm.wasm"

wasm="$here/pkg/seedelf_wasm_bg.wasm"
# The check the remapping is for: nothing under a home folder.
if grep -aq -e "$HOME/" -e "/home/" "$wasm"; then
  echo "The module still carries a local path:" >&2
  grep -ao -e "$HOME/[[:print:]]*" -e "/home/[[:print:]]*" "$wasm" | sort -u | head -5 >&2
  exit 1
fi
echo "Built $(du -h "$wasm" | cut -f1) ($(gzip -9 -c "$wasm" | wc -c | awk '{printf "%d KB", $1 / 1024}') gzipped) -> $here/pkg"
