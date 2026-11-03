#!/usr/bin/env bash
# Writes v2 mix_logic, the token-pool templates with xor32's two length checks, where
# the proofs read it. v2 is the local-only Lovejoin clone ../../lovejoin-v2 at 5cc3631:
# 8131b1d (the templates seedelf-core pins) plus the fix, built with Aiken v1.1.24.
# Checks every template's unapplied hash first: the four the fix leaves alone must be
# templates_are_frozen's, and mix_logic the new one. Then applies mix_logic to the test
# launch Lovejoin's own KATs use (test_fixtures.ak: the NFT policy abab…, `lovejoin`)
# and checks that hash too.
#   Lovejoin/V2/Scripts/mix_logic.hex   one CBOR layer, as the ledger hashes it
# LOVEJOIN_V2= points elsewhere. Anything that doesn't match writes nothing and exits 1.
cd "$(dirname "$0")" || exit 1
LOVEJOIN_V2=${LOVEJOIN_V2:-../../lovejoin-v2}
COMMIT=5cc3631
[ "$(git -C "$LOVEJOIN_V2" rev-parse --short=7 HEAD)" = "$COMMIT" ] || { echo "$LOVEJOIN_V2 isn't at $COMMIT"; exit 1; }
git -C "$LOVEJOIN_V2" diff --quiet HEAD -- contracts || { echo "$LOVEJOIN_V2/contracts has changes"; exit 1; }
aiken --version | grep -q "v1.1.24" || { echo "needs Aiken v1.1.24, found $(aiken --version)"; exit 1; }
out=$(mktemp -d)
(cd "$LOVEJOIN_V2/contracts" && aiken build > /dev/null 2>&1) || { echo "aiken build failed"; exit 1; }
cp "$LOVEJOIN_V2/contracts/plutus.json" "$out/unapplied.json"
policy=581c$(printf 'ab%.0s' $(seq 28))
name=48$(printf lovejoin | od -An -tx1 | tr -d ' \n')
(cd "$LOVEJOIN_V2/contracts" &&
  aiken blueprint apply -i "$out/unapplied.json" -m mix_logic -v mix_logic "$policy" > "$out/policy.json" 2>/dev/null &&
  aiken blueprint apply -i "$out/policy.json" -m mix_logic -v mix_logic "$name" > "$out/applied.json" 2>/dev/null) ||
  { echo "aiken blueprint apply failed"; exit 1; }
mkdir -p Lovejoin/V2/Scripts
python3 - "$out" <<'EOF'
import hashlib, json, sys

out = sys.argv[1]
# templates_are_frozen (seedelf-core/tests/lovejoin_pools_test.rs) for the four the
# fix leaves alone; mix_logic's is the fix's own.
UNAPPLIED = {
    "one_shot_mint": "6878ed6f8fc90297645c0f26e014c1aa46625b65bdb2fa8f57e3e9c6",
    "mix_logic": "7fb45b750754a0fc92006db42d9fdf44af3fb842a3ed16a2cdf0c81a",
    "mix_box": "2365a62d5bdf9b2bc2d95a727c86e1fe165b5a8f14e1e2af5e84f0e4",
    "fee_contract": "3698bbfd9e1dca5a5bc0c33bb7bc8b8c02f9dfef1c84aa8e3aa7d67f",
    "reference_holder": "288fea77a0f674c6080aadd8ed3ca42cd5a920bf1f00c0d3e63306e4",
}
APPLIED_MIX_LOGIC = "60294352f5eaeb0ca3e0f3de623707fee54c0fdd66b343f3203fcbd7"

def scripts(path):
    """Each validator's compiled code (one CBOR layer), by module, checked against its hash."""
    found = {}
    for v in json.load(open(path))["validators"]:
        code = bytes.fromhex(v["compiledCode"])
        assert hashlib.blake2b(b"\x03" + code, digest_size=28).hexdigest() == v["hash"], v["title"]
        found.setdefault(v["title"].split(".")[0], (v["hash"], code))
    return found

ok = True
unapplied = scripts(f"{out}/unapplied.json")
for name, expected in UNAPPLIED.items():
    got = unapplied[name][0]
    print(f"{name}: unapplied {got} {'ok' if got == expected else 'expected ' + expected}")
    ok &= got == expected
got, code = scripts(f"{out}/applied.json")["mix_logic"]
print(f"mix_logic: applied to the test launch {got} {'ok' if got == APPLIED_MIX_LOGIC else 'expected ' + APPLIED_MIX_LOGIC}")
if ok and got == APPLIED_MIX_LOGIC:
    open("Lovejoin/V2/Scripts/mix_logic.hex", "w").write(code.hex())
    sys.exit(0)
sys.exit(1)
EOF
rc=$?
rm -rf "$out"
exit $rc
