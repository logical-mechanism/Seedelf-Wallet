#!/usr/bin/env bash
# Build one module at a time, each in a memory-capped scope: past the cap the
# kernel kills that build (and everything it started), never the desktop.
# Every module runs, cheapest first; the summary says how each went and the
# most memory its scope used.
#   ./check.sh                       every Seedelf module
#   ./check.sh upstream              the upstream reproductions (Upstream/)
#   ./check.sh upstream-main         ExceptParams against Lean-blaster main
#   ./check.sh lovejoin              Lovejoin's classic pool (chunk 42)
#   ./check.sh lovejoin-v2           v2, the templates with xor32's length checks (chunk 42)
#   ./check.sh Seedelf.PolicyMint    some modules
#   CAP=12G LIMIT=20m ./check.sh     other limits
cd "$(dirname "$0")" || exit 1
CAP=${CAP:-8G}
LIMIT=${LIMIT:-10m}
mods=("$@")
[ ${#mods[@]} -eq 0 ] && mods=(Seedelf.Scripts Seedelf.Scenario Seedelf.Steps Seedelf.AlwaysFalse
  Seedelf.WalletPurpose Seedelf.WalletNoLock Seedelf.WalletRegister Seedelf.PolicyAmount
  Seedelf.PolicyForeign Seedelf.PolicyBurn Seedelf.PolicyMint)
[ "${mods[0]}" = upstream ] && mods=(Upstream.ExceptParams Upstream.ByteStrings Upstream.Fq1Fin Upstream.SlicePrograms
  Upstream.SliceNone Upstream.Slice1 Upstream.Slice4 Upstream.Slice16 Upstream.Slice32)
# Lovejoin's classic mainnet pool (chunk 42), after ./extract-lovejoin.sh.
[ "${mods[0]}" = lovejoin ] && mods=(Lovejoin.Scripts Lovejoin.Box Lovejoin.Steps Lovejoin.ReferenceHolder
  Lovejoin.MixBoxPurpose Lovejoin.MixBoxGate Lovejoin.MixBoxNoLock Lovejoin.MixLogicPurpose Lovejoin.Logic
  Lovejoin.Owner)
# v2: the token-pool templates with xor32's length checks (chunk 42), after ./extract-lovejoin-v2.sh.
[ "${mods[0]}" = lovejoin-v2 ] && mods=(Lovejoin.V2.Scripts Lovejoin.V2.Mix Lovejoin.V2.Logic
  Lovejoin.V2.Steps Lovejoin.V2.MixChallenges Lovejoin.V2.Owner Lovejoin.V2.MixOutputs Lovejoin.V2.MixDatums
  Lovejoin.V2.MixSpec Lovejoin.V2.MixSplit Lovejoin.V2.MixFirst Lovejoin.V2.MixSecond Lovejoin.V2.MixPasses
  Lovejoin.Template.Scripts Lovejoin.Template.Steps
  Lovejoin.Template.MixBoxPurpose Lovejoin.Template.MixBoxGate Lovejoin.Template.MixBoxNoLock
  Lovejoin.Template.Launch Lovejoin.Template.OneShotMint Lovejoin.Template.Fee Lovejoin.Template.FeeContract)
# The same ExceptParams file in its own package, against Lean-blaster main.
[ "${mods[0]}" = upstream-main ] && { cd Upstream/blaster-main || exit 1; mods=(BlasterMain.ExceptParams); }
peakf=$(mktemp)
summary=()
for m in "${mods[@]}"; do
  echo "== $m (cap $CAP, limit $LIMIT)"
  start=$SECONDS
  : > "$peakf"
  # The scope's own cgroup records its peak; a killed scope never writes it.
  systemd-run --user --scope -q -p MemoryMax="$CAP" -p MemorySwapMax=0 -p OOMPolicy=kill \
    bash -c 'timeout "$1" lake build "$2"; rc=$?
      cat "/sys/fs/cgroup$(cut -d: -f3 /proc/self/cgroup)/memory.peak" > "$3" 2>/dev/null
      exit $rc' _ "$LIMIT" "$m" "$peakf" 2>&1 \
    | grep -v -E 'Replayed|CekMachine.lean:309|Successfully decoded|^trace: \.> LEAN_PATH'
  rc=${PIPESTATUS[0]}
  took=$((SECONDS - start))s
  peak=$(cat "$peakf")
  [ -n "$peak" ] && peak=", peak $((peak / 1048576)) MB"
  case $rc in
    0) summary+=("ok        $m ($took$peak)") ;;
    124) summary+=("TIMEOUT   $m (past $LIMIT$peak)") ;;
    137) summary+=("KILLED    $m (over $CAP, $took)") ;;
    *) summary+=("FAILED    $m (exit $rc, $took$peak)") ;;
  esac
done
rm -f "$peakf"
echo
echo "== summary"
printf '%s\n' "${summary[@]}"
