#!/usr/bin/env bash
# Build one module at a time, each in a memory-capped scope: past the cap the
# kernel kills that build (and everything it started), never the desktop.
# Every module runs, cheapest first; the summary at the end says how each went.
#   ./check.sh                       every module
#   ./check.sh Seedelf.PolicyMint    some modules
#   CAP=12G LIMIT=20m ./check.sh     other limits
cd "$(dirname "$0")" || exit 1
CAP=${CAP:-8G}
LIMIT=${LIMIT:-10m}
mods=("$@")
# WalletRegister is left out until byteStringToInteger is opaque (see its module).
[ ${#mods[@]} -eq 0 ] && mods=(Seedelf.Scripts Seedelf.Scenario Seedelf.Steps Seedelf.AlwaysFalse
  Seedelf.WalletPurpose Seedelf.WalletNoLock Seedelf.PolicyAmount Seedelf.PolicyForeign
  Seedelf.PolicyBurn Seedelf.PolicyMint)
summary=()
for m in "${mods[@]}"; do
  echo "== $m (cap $CAP, limit $LIMIT)"
  start=$SECONDS
  systemd-run --user --scope -q -p MemoryMax="$CAP" -p MemorySwapMax=0 -p OOMPolicy=kill \
    timeout "$LIMIT" lake build "$m" 2>&1 | grep -v -E 'Replayed|CekMachine.lean:309|Successfully decoded|^trace: \.> LEAN_PATH'
  rc=${PIPESTATUS[0]}
  took=$((SECONDS - start))s
  case $rc in
    0) summary+=("ok        $m ($took)") ;;
    124) summary+=("TIMEOUT   $m (past $LIMIT)") ;;
    137) summary+=("KILLED    $m (over $CAP, $took)") ;;
    *) summary+=("FAILED    $m (exit $rc, $took)") ;;
  esac
done
echo
echo "== summary"
printf '%s\n' "${summary[@]}"
