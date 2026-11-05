#!/usr/bin/env bash
# The deployed wallet and its three mutants (negative controls, never deployed) on
# concrete/wallet_register.sh's honest vectors, through Aiken's evaluator.
SV=$(cd "$(dirname "$0")/../../.." && pwd)
G=97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb
U=8c6b52ee4dab0d5bbe9905261753022cfa56d7cb44ecb06789b9442127eb470500e83cd45290cf9ce1b1851450df5de8
GR=a7f480453dd21e986b306ed60ec433614afcd6c17022ba52b07edd42296519c17b1862350c396f8fbdeb7fdced92711e
Z=056ef908426282c4880583e64182838825d5d1de34eef032d26ac5b4244ad9a6
VKH=00112233445566778899aabbccddeeff00112233445566778899aabb
OTHER=ffffffffffffffffffffffffffffffffffffffffffffffffffffffff
ctx() { # $1 z, $2 the proof's vkh, $3.. the signers
  local z=$1 v=$2; shift 2; local sigs=""; for s in "$@"; do sigs="$sigs${sigs:+, }B #$s"; done
  echo "(con data (Constr 0 [Constr 0 [List [], List [], List [], I 0, Map [], List [], Map [], I 0, List [$sigs], Map [], Map [], B #00, Map [], List [], Constr 1 [], Constr 1 []], Constr 0 [B #$z, B #$GR, B #$v], Constr 1 [Constr 0 [B #00, I 0], Constr 0 [Constr 0 [B #$G, B #$U]]]]))"
}
run() { local f=$1 label=$2; shift 2; printf '  %-36s ' "$label"; ~/.aiken/bin/aiken uplc eval -f "$f" "$(ctx "$@")" 2>&1 | tr -s ' \n' ' ' | grep -o -E '"result": "[^"]{0,16}|crashed' | head -1; }
for f in $SV/concrete/build/wallet.flat wallet_no_signer.flat wallet_no_schnorr.flat wallet_no_vkh_in_challenge.flat; do
  echo "== $(basename $f)"
  run $f "valid proof"                "$Z" "$VKH" "$VKH"
  run $f "z changed"                  "${Z%?}7" "$VKH" "$VKH"
  run $f "signed by another key"      "$Z" "$VKH" "$OTHER"
  run $f "proof bound to another key" "$Z" "$OTHER" "$OTHER"
  run $f "valid, signers [other, vkh]" "$Z" "$VKH" "$OTHER" "$VKH"
  run $f "valid, signers [vkh, other]" "$Z" "$VKH" "$VKH" "$OTHER"
  run $f "valid, no signers"          "$Z" "$VKH"
done
