#!/usr/bin/env bash
# usage: run_variant.sh <variant build.rs> <label> <profile: debug|release> <filter or ALL> [extra test args]
S=calls/review7/l7reference_3
variant="$1"; label="$2"; profile="$3"; filter="$4"; shift 4
cp "$variant" "$S/seedelf-platform/seedelf-core/src/build.rs"
cd "$S/seedelf-platform" || exit 1
export CARGO_TARGET_DIR=$HOME/.cache/seedelf-calls/r7-target-l7reference_3
rel=""
[ "$profile" = release ] && rel="--release"
f="$filter"
[ "$filter" = ALL ] && f=""
echo "### $label $profile $filter :: $(uptime)"
nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 40m cargo test --locked -q $rel -p seedelf-core --test box_rule_reference_test $f -- --nocapture "$@" 2>&1
echo "### end $label :: $(uptime)"
