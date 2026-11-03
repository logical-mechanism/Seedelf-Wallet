#!/usr/bin/env bash
# Lovejoin's classic mainnet mix_box (c145c10f…) on one-input spends of a box,
# through Aiken's evaluator. A well-formed inline MixDatum (Constr 0 [B a, B b],
# both 48 bytes, a ≠ b) needs mix_logic's withdrawal; any other datum, or none, is
# Rule 2's recovery and returns unit. Needs ../extract-lovejoin.sh first.
D=$(dirname "$0")/build
MIX_LOGIC=0dad3046f90d9cf8354eb8b743d50fb2c25d581269b94ffcdf59499e
A=97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb  # G1 generator, compressed
B=a09d99e02f7200526dc55ef722cc171e7aa14fc732614c02ac58d59d7026a7eb18d8798f6928ea2b513f3a4feb0c94d1
TXID=00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff
ctx() { # $1 the box's datum (an OutputDatum), $2 the withdrawals map, $3 the spend's Option datum
  local ref="Constr 0 [B #$TXID, I 0]"
  local box="Constr 0 [Constr 0 [Constr 1 [B #c145c10ff4bcaef7f5a4dbb3fcbfddca4b6c7b08191b0690b12f1fad], Constr 1 []], Map [(B #, Map [(B #, I 10000000)])], $1, Constr 1 []]"
  echo "(con data (Constr 0 [Constr 0 [List [Constr 0 [$ref, $box]], List [], List [], I 0, Map [], List [], $2, Constr 0 [Constr 0 [Constr 0 [], Constr 1 []], Constr 0 [Constr 2 [], Constr 1 []]], List [], Map [], Map [], B #00, Map [], List [], Constr 1 [], Constr 1 []], Constr 0 [], Constr 1 [$ref, $3]]))"
}
run() { printf '%-36s ' "$1"; aiken uplc eval -f "$D/lovejoin_mix_box.flat" "$(ctx "$2" "$3" "$4")" 2>&1 | tr -s ' \n' ' ' | grep -o -E '"result": "[^"]{0,20}|crashed' | head -1; }
WELL="Constr 0 [B #$A, B #$B]"
NONE="Map []"
LOGIC="Map [(Constr 1 [B #$MIX_LOGIC], I 0)]"
OTHER="Map [(Constr 1 [B #00112233445566778899aabbccddeeff00112233445566778899aabb], I 0)]"
run "well-formed, no withdrawal"           "Constr 2 [$WELL]" "$NONE"  "Constr 0 [$WELL]"
run "well-formed, mix_logic withdraws"     "Constr 2 [$WELL]" "$LOGIC" "Constr 0 [$WELL]"
run "well-formed, another withdraws"       "Constr 2 [$WELL]" "$OTHER" "Constr 0 [$WELL]"
run "a = b"                                "Constr 2 [Constr 0 [B #$A, B #$A]]" "$NONE" "Constr 0 [Constr 0 [B #$A, B #$A]]"
run "a 47 bytes"                           "Constr 2 [Constr 0 [B #${A:2}, B #$B]]" "$NONE" "Constr 0 [Constr 0 [B #${A:2}, B #$B]]"
run "Constr 1 [B, B]"                      "Constr 2 [Constr 1 [B #$A, B #$B]]" "$NONE" "Constr 0 [Constr 1 [B #$A, B #$B]]"
run "three fields"                         "Constr 2 [Constr 0 [B #$A, B #$B, B #$A]]" "$NONE" "Constr 0 [Constr 0 [B #$A, B #$B, B #$A]]"
run "I 7"                                  "Constr 2 [I 7]" "$NONE" "Constr 0 [I 7]"
run "no datum"                             "Constr 0 []" "$NONE" "Constr 1 []"
run "well-formed by hash (F-2)"            "Constr 1 [B #$TXID]" "$NONE" "Constr 0 [$WELL]"
