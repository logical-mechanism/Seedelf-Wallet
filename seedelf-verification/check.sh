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
#   ./check.sh lovejoin-v2-pools     v2's general Mix alone, for every pool kind and n = 2 to 4
#   ./check.sh lovejoin-owner        Owner withdrawals of several boxes, v2 and the classic pool
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
# Owner withdrawals of several boxes, a payer's input and two outputs (gen-lovejoin-owner.py):
# v2 through mix_logic's template, 1 to 4 boxes; the deployed classic pool, 1 to 3.
owners_v2=(
  Lovejoin.V2.OwnAny1 Lovejoin.V2.OwnAny1Spec Lovejoin.V2.OwnAny1Steps Lovejoin.V2.OwnAny1Boxes
  Lovejoin.V2.OwnAny1Passes Lovejoin.V2.OwnAny2 Lovejoin.V2.OwnAny2Spec Lovejoin.V2.OwnAny2Steps
  Lovejoin.V2.OwnAny2Boxes Lovejoin.V2.OwnAny2Passes Lovejoin.V2.OwnAny3 Lovejoin.V2.OwnAny3Spec
  Lovejoin.V2.OwnAny3Steps Lovejoin.V2.OwnAny3Boxes Lovejoin.V2.OwnAny3Passes Lovejoin.V2.OwnAny4
  Lovejoin.V2.OwnAny4Spec Lovejoin.V2.OwnAny4Steps Lovejoin.V2.OwnAny4Boxes Lovejoin.V2.OwnAny4Passes)
owners_classic=(
  Lovejoin.OwnClassic1 Lovejoin.OwnClassic1Spec Lovejoin.OwnClassic1Steps Lovejoin.OwnClassic1Boxes
  Lovejoin.OwnClassic1Passes Lovejoin.OwnClassic2 Lovejoin.OwnClassic2Spec Lovejoin.OwnClassic2Steps
  Lovejoin.OwnClassic2Boxes Lovejoin.OwnClassic2Passes Lovejoin.OwnClassic3 Lovejoin.OwnClassic3Spec
  Lovejoin.OwnClassic3Steps Lovejoin.OwnClassic3Boxes Lovejoin.OwnClassic3Passes)
[ "${mods[0]}" = lovejoin-owner ] && mods=("${owners_v2[@]}" "${owners_classic[@]}")
# Lovejoin's classic mainnet pool (chunk 42), after ./extract-lovejoin.sh.
[ "${mods[0]}" = lovejoin ] && mods=(Lovejoin.Scripts Lovejoin.Box Lovejoin.Steps Lovejoin.ReferenceHolder
  Lovejoin.MixBoxPurpose Lovejoin.MixBoxGate Lovejoin.MixBoxNoLock Lovejoin.MixLogicPurpose Lovejoin.Logic
  Lovejoin.Owner "${owners_classic[@]}")
# v2's general Mix: mix_logic's template, every pool parameter, box point and proof field symbolic.
# MixAny is ADA pools at n = 2; the rest gen-lovejoin-mix.py writes (ADA n = 3, 4; token n = 2, 3, 4).
pools=(
  Lovejoin.V2.MixAny Lovejoin.V2.MixAnySpec Lovejoin.V2.MixAnySteps Lovejoin.V2.MixAnyFirst
  Lovejoin.V2.MixAnySecond Lovejoin.V2.MixAnyPasses Lovejoin.V2.MixAny3 Lovejoin.V2.MixAny3Spec
  Lovejoin.V2.MixAny3Steps Lovejoin.V2.MixAny3Box1 Lovejoin.V2.MixAny3Box2 Lovejoin.V2.MixAny3Box3
  Lovejoin.V2.MixAny3Passes Lovejoin.V2.MixAny4 Lovejoin.V2.MixAny4Spec Lovejoin.V2.MixAny4Steps
  Lovejoin.V2.MixAny4Box1 Lovejoin.V2.MixAny4Box2 Lovejoin.V2.MixAny4Box3 Lovejoin.V2.MixAny4Box4
  Lovejoin.V2.MixAny4Passes Lovejoin.V2.MixTok2 Lovejoin.V2.MixTok2Spec Lovejoin.V2.MixTok2Steps
  Lovejoin.V2.MixTok2Box1 Lovejoin.V2.MixTok2Box2 Lovejoin.V2.MixTok2Passes Lovejoin.V2.MixTok3
  Lovejoin.V2.MixTok3Spec Lovejoin.V2.MixTok3Steps Lovejoin.V2.MixTok3Box1 Lovejoin.V2.MixTok3Box2
  Lovejoin.V2.MixTok3Box3 Lovejoin.V2.MixTok3Passes Lovejoin.V2.MixTok4 Lovejoin.V2.MixTok4Spec
  Lovejoin.V2.MixTok4Steps Lovejoin.V2.MixTok4Box1 Lovejoin.V2.MixTok4Box2 Lovejoin.V2.MixTok4Box3
  Lovejoin.V2.MixTok4Box4 Lovejoin.V2.MixTok4Passes)
[ "${mods[0]}" = lovejoin-v2-pools ] && mods=("${pools[@]}")
# v2: the token-pool templates with xor32's length checks (chunk 42), after ./extract-lovejoin-v2.sh.
[ "${mods[0]}" = lovejoin-v2 ] && mods=(Lovejoin.V2.Scripts Lovejoin.V2.Mix Lovejoin.V2.Logic
  Lovejoin.V2.Steps Lovejoin.V2.MixChallenges Lovejoin.V2.Owner Lovejoin.V2.MixOutputs Lovejoin.V2.MixDatums
  Lovejoin.V2.MixSpec Lovejoin.V2.MixSplit Lovejoin.V2.MixFirst Lovejoin.V2.MixSecond Lovejoin.V2.MixPasses
  Lovejoin.Template.Scripts Lovejoin.Template.Steps
  Lovejoin.Template.MixBoxPurpose Lovejoin.Template.MixBoxGate Lovejoin.Template.MixBoxNoLock
  Lovejoin.Template.Launch Lovejoin.Template.OneShotMint Lovejoin.Template.Fee Lovejoin.Template.FeeContract
  Lovejoin.V2.Mix3 Lovejoin.V2.Mix3Spec Lovejoin.V2.Mix3Steps Lovejoin.V2.Mix3First Lovejoin.V2.Mix3Second
  Lovejoin.V2.Mix3Third Lovejoin.V2.Mix3Passes "${pools[@]}" "${owners_v2[@]}")
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
