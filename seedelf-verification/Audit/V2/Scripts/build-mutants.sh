#!/usr/bin/env bash
# Rebuilds Audit.V2's three mix_logic mutants and checks each against the hex beside this
# script: lovejoin-v2 5cc3631 (read with `git archive`, never checked out), one diff applied,
# built with Aiken v1.1.24 in a temporary copy. The clone itself is only read: its commit, and
# its contracts/build/packages (the stdlib and fuzz Aiken would otherwise download).
# Run from anywhere; LOVEJOIN_V2= points elsewhere.
cd "$(dirname "$0")" || exit 1
here=$(pwd)
LOVEJOIN_V2=${LOVEJOIN_V2:-$here/../../../../../lovejoin-v2}
aiken --version | grep -q "v1.1.24" || { echo "needs Aiken v1.1.24, found $(aiken --version)"; exit 1; }
[ -d "$LOVEJOIN_V2/contracts/build/packages" ] || { echo "no $LOVEJOIN_V2/contracts/build/packages"; exit 1; }
tmp=$(mktemp -d)
rc=0
for name in mix_logic_one_equation mix_logic_no_value_check mix_logic_owner_first_proof_only; do
  mkdir -p "$tmp/$name"
  git -C "$LOVEJOIN_V2" archive 5cc3631 contracts | tar -x -C "$tmp/$name" || { rc=1; continue; }
  mkdir -p "$tmp/$name/contracts/build" && cp -r "$LOVEJOIN_V2/contracts/build/packages" "$tmp/$name/contracts/build/"
  patch -s -p1 -d "$tmp/$name" < "$name.diff" || { echo "$name: patch failed"; rc=1; continue; }
  (cd "$tmp/$name/contracts" && aiken build > /dev/null 2>&1) || { echo "$name: aiken build failed"; rc=1; continue; }
  python3 -I - "$tmp/$name/contracts/plutus.json" "$name.hex" "$name" <<'PY' || rc=1
import hashlib, json, sys
code = next(v["compiledCode"] for v in json.load(open(sys.argv[1]))["validators"] if v["title"] == "mix_logic.mix_logic.withdraw")
h = hashlib.blake2b(b"\x03" + bytes.fromhex(code), digest_size=28).hexdigest()
same = code == open(sys.argv[2]).read().strip()
print(f"{sys.argv[3]}: unapplied {h}, {'matches' if same else 'DIFFERS FROM'} {sys.argv[2]}")
sys.exit(0 if same else 1)
PY
done
rm -rf "$tmp"
exit $rc
