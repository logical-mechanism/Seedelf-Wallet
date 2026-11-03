#!/usr/bin/env bash
# The deployed wallet script on spends whose datum isn't a Register, through
# Aiken's evaluator: every one should return unit. Cross-checks WalletNoLock,
# and showed its first counterexample (a step limit too small) was spurious.
# Needs ../extract.sh first.
D=$(dirname "$0")/build
G=97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb  # G1 generator, compressed
VKH=00112233445566778899aabbccddeeff00112233445566778899aabb
ctx() { # $1 the spend's Option datum
  echo "(con data (Constr 0 [Constr 0 [List [], List [], List [], I 0, Map [], List [], Map [], I 0, List [B #$VKH], Map [], Map [], B #00, Map [], List [], Constr 1 [], Constr 1 []], Constr 0 [B #01, B #$G, B #$VKH], Constr 1 [Constr 0 [B #00, I 0], $1]]))"
}
run() { printf '%-28s ' "$1"; aiken uplc eval -f "$D/wallet.flat" "$(ctx "$2")" 2>&1 | tr -s ' \n' ' ' | grep -o -E '"result": "[^"]{0,20}|crashed' | head -1; }
run "None"                     "Constr 1 []"
run "Some(B 213021)"           "Constr 0 [B #213021]"
run "Some(B #)"                "Constr 0 [B #]"
run "Some(I 7)"                "Constr 0 [I 7]"
run "Some(List [])"            "Constr 0 [List []]"
run "Some(Map [])"             "Constr 0 [Map []]"
run "Some(Constr 1 [])"        "Constr 0 [Constr 1 []]"
run "Some(Constr 0 [])"        "Constr 0 [Constr 0 []]"
run "Some(Constr 0 [B])"       "Constr 0 [Constr 0 [B #$G]]"
run "Some(Constr 0 [I, I])"    "Constr 0 [Constr 0 [I 1, I 2]]"
run "Some(Constr 0 [B, I])"    "Constr 0 [Constr 0 [B #$G, I 2]]"
run "Some(Constr 0 [B, B, B])" "Constr 0 [Constr 0 [B #$G, B #$G, B #$G]]"
