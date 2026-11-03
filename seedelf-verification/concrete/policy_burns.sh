#!/usr/bin/env bash
# The deployed Seedelf policy on one-input, one-line mints and burns, through
# Aiken's evaluator. The burns past #255 fail: `xor` takes both blocks, so a
# burn builds the mint's name too, and consByteString refuses an index past a
# byte (PolicyBurn proves it). Needs ../extract.sh first.
D=$(dirname "$0")/build
POL=84967d911e1a10d5b4a38441879f374a07f340945bcf9e7697485255
TXID=4172bf875e341da9ecc0f1f84bfb7b6e6bb8b022b17205b5ce23617fc1641880
# ScriptContext: Constr 0 [txInfo, redeemer (personal tag), MintingScript(policy)].
# txInfo has 16 fields; the policy reads only inputs (0) and mint (4).
ctx() { # $1 first input's index, $2 amount, $3 token name
  echo "(con data (Constr 0 [Constr 0 [List [Constr 0 [Constr 0 [B #$TXID, I $1], I 0]], List [], List [], I 0, Map [(B #$POL, Map [(B #$3, I $2)])], List [], Map [], I 0, List [], Map [], Map [], B #00, Map [], List [], Constr 1 [], Constr 1 []], B #, Constr 0 [B #$POL]]))"
}
name_for() { # the name generate() gives for first input (TXID, $1) and an empty tag
  printf '5eed0e1f%02x%s' "$1" "${TXID:0:54}"
}
run() { # label idx amt name
  printf '%-32s ' "$1"
  aiken uplc eval -f "$D/seedelf.flat" "$(ctx "$2" "$3" "$4")" 2>&1 | tr -s ' \n' ' ' | grep -o -E '"result": "[^"]{0,40}|[Ee]rror[^"]{0,60}' | head -1
}
OWN=5eed0e1fabcdef00000000000000000000000000000000000000000000000000
run "mint, first input #0"           0   1 "$(name_for 0)"
run "mint, wrong name"               0   1 "$OWN"
run "burn, first input #0"           0  -1 "$OWN"
run "burn, first input #255"         255 -1 "$OWN"
run "burn, first input #256"         256 -1 "$OWN"
run "burn, first input #300"         300 -1 "$OWN"
