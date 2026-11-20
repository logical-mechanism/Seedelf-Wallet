#!/bin/bash
out=calls/review7/logs
d=$HOME/.cache/seedelf-calls/r7-target-ref/release/deps
cd calls/review7/ref/seedelf-platform/seedelf-web-wallet/wasm
bins="seedelf_wasm-5a9d06f8c18c2b46 adds_less_than_nothing_test-9ae0537a6b02c853 api_test-37d3688232ce5ebb max_in_parts_tokens_test-1c6016fe1f7719b5 payment_parts_shapes_test-6ac0f3260dcc71a8 recipients_limit_test-02e4e59b2f1b3d52"
for mode in base NO_D PARTS_INONE; do
  for b in $bins; do
    case $mode in
      base) env_args="" ;;
      NO_D) env_args="R7REF_NO_D=1" ;;
      PARTS_INONE) env_args="R7REF_PARTS_INONE=1" ;;
    esac
    env $env_args "$d/$b" --test-threads 4 > "$out/wasm-$mode-$b.log" 2>&1
    echo "$mode $b exit $? $(grep -E '^test result' "$out/wasm-$mode-$b.log" | tail -1)"
  done
done
R7REF_NO_D=1 "$d/payment_parts_shapes_test-6ac0f3260dcc71a8" --ignored --nocapture > "$out/wasm-NO_D-shapes-ignored.log" 2>&1
echo "NO_D shapes --ignored exit $? $(grep -E '^test result' "$out/wasm-NO_D-shapes-ignored.log" | tail -1)"
R7REF_PARTS_INONE=1 "$d/payment_parts_shapes_test-6ac0f3260dcc71a8" --ignored --nocapture > "$out/wasm-PARTS_INONE-shapes-ignored.log" 2>&1
echo "PARTS_INONE shapes --ignored exit $? $(grep -E '^test result' "$out/wasm-PARTS_INONE-shapes-ignored.log" | tail -1)"
echo done
