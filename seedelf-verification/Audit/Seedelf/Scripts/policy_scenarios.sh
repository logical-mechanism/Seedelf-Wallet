#!/usr/bin/env bash
# The deployed Seedelf policy (concrete/build/seedelf.flat) on PolicyAmount's and
# PolicyForeign's Lean scenarios, through Aiken's evaluator: own "p" (0x70), one
# mint line (cs, tn, n), first input "\x01"#0, personal tag "" (Data.B "").
D=$(cd "$(dirname "$0")/../../../concrete/build" && pwd)
ctx() { # $1 cs hex, $2 token name hex, $3 amount, $4 own hex
  echo "(con data (Constr 0 [Constr 0 [List [Constr 0 [Constr 0 [B #01, I 0], Constr 0 [Constr 0 [Constr 0 [B #], Constr 1 []], Map [], Constr 0 [], Constr 1 []]]], List [], List [], I 0, Map [(B #$1, Map [(B #$2, I $3)])], List [], Map [], Constr 0 [Constr 0 [Constr 0 [], Constr 1 []], Constr 0 [Constr 2 [], Constr 1 []]], List [], Map [], Map [], B #, Map [], List [], Constr 1 [], Constr 1 []], B #, Constr 0 [B #$4]]))"
}
run() { printf '%-50s ' "$1"; ~/.aiken/bin/aiken uplc eval -f "$D/seedelf.flat" "$(ctx "$2" "$3" "$4" "$5")" 2>&1 | tr -s ' \n' ' ' | grep -o -E '"result": "[^"]{0,20}|[Ee]rror[^"]{0,40}|crashed' | head -1; }
P=70
BAD=5eed0e1f01       # PolicyAmount/PolicyForeign's token name
GOOD=5eed0e1f0001    # generate("\x01", 0, 5eed0e1f, "")
run "amount scenario, n=1 (name 5eed0e1f01)"    $P $BAD 1 $P
run "amount scenario, n=-1"                     $P $BAD -1 $P
run "amount scenario, n=2"                      $P $BAD 2 $P
run "good name, n=1"                            $P $GOOD 1 $P
run "good name, n=-1"                           $P $GOOD -1 $P
run "good name, n=2"                            $P $GOOD 2 $P
run "good name, n=0"                            $P $GOOD 0 $P
run "foreign mint, cs=q (name 5eed0e1f01)"      71 $BAD 1 $P
run "foreign mint, cs=p (name 5eed0e1f01)"      $P $BAD 1 $P
run "foreign mint, cs=q, good name"             71 $GOOD 1 $P
run "foreign mint, cs=p, good name"             $P $GOOD 1 $P
run "foreign burn, cs=q"                        71 $BAD -1 $P
run "foreign burn, cs=p"                        $P $BAD -1 $P
