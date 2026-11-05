#!/usr/bin/env bash
# Owner-run. Host: the workstation that holds ~/Documents/LogicalMechanism/Seedelf-Wallet.
# Re-runs Blaster on each proved theorem's statement with (only-smt-lib: 1) (dump-smt-lib: 1):
# no Z3 process, no proof, nothing written in the repository. Each file is run with
# `lake env lean`, in its own memory-capped scope (as check.sh does), and its output (the
# optimizer's verdict and the SMT query) lands in diag/out/. Then scan-diag.py summarises and
# replays the queries through z3.
#   bash run-diag.sh quick     9 theorems, one per script family (start here)
#   bash run-diag.sh modules   the first theorem of each of the 78 modules
#   bash run-diag.sh all       every blaster theorem with an olean (304)
#   SCAN_TIMEOUT=1800 …        a longer Z3 limit for each replay (default 600 s)
#   CAP=12G LIMIT=30m bash run-diag.sh quick
D=$(cd "$(dirname "$0")" && pwd)
SV=/home/logic/Documents/LogicalMechanism/Seedelf-Wallet/seedelf-verification
mode=${1:-quick}
CAP=${CAP:-8G}
LIMIT=${LIMIT:-20m}
list="$D/list-$mode.txt"
[ -f "$list" ] || { echo "no list $list (quick, modules or all)"; exit 1; }
cd "$SV" || exit 1
mkdir -p "$D/out"
command -v z3 >/dev/null || { echo "no z3 on PATH: the replays need it"; exit 1; }
z3 -version
while read -r f || [ -n "$f" ]; do
  [ -n "$f" ] || continue
  base=$(basename "$f" .lean)
  [ -s "$D/out/$base.txt" ] && grep -q '^rc=0$' "$D/out/$base.txt" && { echo "== $base (done)"; continue; }
  echo "== $base"
  start=$SECONDS
  systemd-run --user --scope -q -p MemoryMax="$CAP" -p MemorySwapMax=0 -p OOMPolicy=kill \
    timeout "$LIMIT" lake env lean "$f" > "$D/out/$base.txt" 2>&1
  rc=$?
  echo "rc=$rc" >> "$D/out/$base.txt"
  echo "   rc=$rc $((SECONDS - start))s"
done < "$list"
python3 -I "$D/scan-diag.py" "$D/out" --list "$list" --alt --timeout "${SCAN_TIMEOUT:-600}"
