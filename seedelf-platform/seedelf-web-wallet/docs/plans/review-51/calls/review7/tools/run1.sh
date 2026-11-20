#!/bin/bash
out=calls/review7/logs
mkdir -p "$out"
ref=$HOME/.cache/seedelf-calls/r7-target-ref/release/deps/box_rule_reference_test-9474744ad5dc6b1c
mint=$HOME/.cache/seedelf-calls/r7-target-ref/release/deps/mint_test-44806d8c35c00937
cd calls/review7/ref/seedelf-platform/seedelf-core
echo "start $(date +%T) load $(cut -d' ' -f1-3 /proc/loadavg)"
"$ref" --include-ignored --test-threads 4 --nocapture > "$out/base-ref.log" 2>&1; echo "base-ref exit $? $(date +%T)"
R7REF_NO_D=1 "$ref" --include-ignored --test-threads 4 > "$out/nod-ref.log" 2>&1; echo "nod-ref exit $? $(date +%T)"
R7REF_W_ADA=1 "$ref" --include-ignored --test-threads 4 > "$out/wada-ref.log" 2>&1; echo "wada-ref exit $? $(date +%T)"
R7REF_NO_D=1 "$mint" apart:: > "$out/nod-mint.log" 2>&1; echo "nod-mint exit $? $(date +%T)"
R7REF_NO_OLD_ASKED=1 "$mint" > "$out/nooldasked-mint.log" 2>&1; echo "nooldasked-mint exit $? $(date +%T)"
R7REF_NO_OLD_ASKED=1 "$ref" --include-ignored --test-threads 4 > "$out/nooldasked-ref.log" 2>&1; echo "nooldasked-ref exit $? $(date +%T)"
echo "done $(date +%T) load $(cut -d' ' -f1-3 /proc/loadavg)"
