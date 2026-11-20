#!/usr/bin/env bash
# Each file development.md:13 names as one that runs web-wallet.yml's check, run through the changes job's
# `covered` awk program as a PR into main changing only that file (one row, so awk alone decides).
T=.
covered() { git -C "$T" show "$1:.github/workflows/web-wallet.yml" | sed -n "s/^ *covered='\(.*\)'\$/\1/p"; }
doc=$(git -C "$T" show HEAD:seedelf-platform/seedelf-web-wallet/docs/development.md | sed -n 13p)
grep -o 'or a Rust file under `seedelf-data/`' <<<"$doc" >/dev/null && echo "development.md:13 at HEAD names: a Rust file under seedelf-data/ (as running the check)"
fail=0
for rev in 51e66221 HEAD; do
  prog=$(covered "$rev")
  echo "== $rev"
  for path in \
    seedelf-platform/seedelf-core/src/build.rs \
    seedelf-platform/seedelf-web-wallet/wasm/README.md \
    .github/workflows/release.yml \
    seedelf-verification/test-tools.sh \
    seedelf-data/api/src/main.rs \
    seedelf-data/api/src/public/utxos.rs \
    seedelf-verification/Lovejoin/Template/Scripts/mix_box.hex; do
    if awk "$prog" <<<"$path"; then p=true; else p=false; fi
    # The required job's verdict for that platform value: five jobs run, or five skipped and green.
    if [ $p = true ]; then jobs="rust wasm unit e2e store run"; else jobs="all five skipped; Web Wallet required exits 0 (green)"; fi
    printf '  %-62s platform=%-5s  %s\n' "$path" "$p" "$jobs"
    if [ "$rev" = HEAD ] && [ $p = false ]; then echo "  FAIL: development.md:13 says this file runs the check; on HEAD it doesn't"; fail=1; fi
  done
done
exit $fail
