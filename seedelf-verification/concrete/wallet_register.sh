#!/usr/bin/env bash
# The deployed wallet script on a Register spend, through Aiken's evaluator: a
# real proof (seedelf-crypto's create_proof for the secret 0x5eed0e1f, bound to
# VKH) returns unit, and each change of it crashes. Steps.lean measures the same
# spend for WalletRegister's step limit. Needs ../extract.sh first.
D=$(dirname "$0")/build
G=97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb  # G1 generator, compressed
U=8c6b52ee4dab0d5bbe9905261753022cfa56d7cb44ecb06789b9442127eb470500e83cd45290cf9ce1b1851450df5de8  # g^0x5eed0e1f
GR=a7f480453dd21e986b306ed60ec433614afcd6c17022ba52b07edd42296519c17b1862350c396f8fbdeb7fdced92711e
Z=056ef908426282c4880583e64182838825d5d1de34eef032d26ac5b4244ad9a6
VKH=00112233445566778899aabbccddeeff00112233445566778899aabb
OTHER=ffffffffffffffffffffffffffffffffffffffffffffffffffffffff
ctx() { # $1 z, $2 the proof's vkh, $3 the signer
  echo "(con data (Constr 0 [Constr 0 [List [], List [], List [], I 0, Map [], List [], Map [], I 0, List [B #$3], Map [], Map [], B #00, Map [], List [], Constr 1 [], Constr 1 []], Constr 0 [B #$1, B #$GR, B #$2], Constr 1 [Constr 0 [B #00, I 0], Constr 0 [Constr 0 [B #$G, B #$U]]]]))"
}
run() { printf '%-28s ' "$1"; aiken uplc eval -f "$D/wallet.flat" "$(ctx "$2" "$3" "$4")" 2>&1 | tr -s ' \n' ' ' | grep -o -E '"result": "[^"]{0,20}|crashed' | head -1; }
run "valid proof"                "$Z" "$VKH" "$VKH"
run "z changed"                  "${Z%?}7" "$VKH" "$VKH"
run "signed by another key"      "$Z" "$VKH" "$OTHER"
run "proof bound to another key" "$Z" "$OTHER" "$OTHER"
