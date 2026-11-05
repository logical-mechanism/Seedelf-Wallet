#!/usr/bin/env bash
# Writes v2 mix_logic, the token-pool templates with xor32's two length checks, where
# the proofs read it. v2 is Lovejoin's main at 29573c5 (PRs #165 and #166): 8131b1d (the
# templates seedelf-core pins) plus the fix, built with Aiken v1.1.24. A Lovejoin clone,
# ../../lovejoin by default, checked out there (git checkout 29573c5).
# Checks every template's unapplied hash first: the four the fix leaves alone must be
# templates_are_frozen's, and mix_logic the new one. Then applies mix_logic to the test
# launch Lovejoin's own KATs use (test_fixtures.ak: the NFT policy abab…, `lovejoin`)
# and checks that hash too. Last, mix_box's template, unapplied, for the theorems that hold
# for every L: applied to the classic pool's mix_logic hash it must be the classic pool's
# mix_box, c145c10f…, as it sits on chain. And one_shot_mint's: applied to the mainnet
# 5 ₳ pool's seed it must be that pool's NFT policy, dc6abe3b…. And fee_contract's: at that
# pool's policy it must be that pool's fee_contract, 20aae476…. mix_logic's own template too,
# unapplied (7fb45b75…), for the theorems that hold for every v2 launch.
#   Lovejoin/V2/Scripts/mix_logic.hex             one CBOR layer, as the ledger hashes it
#   Lovejoin/Template/Scripts/mix_logic.hex       the same, unapplied
#   Lovejoin/Template/Scripts/mix_box.hex         the same, unapplied
#   Lovejoin/Template/Scripts/one_shot_mint.hex   the same, unapplied
#   Lovejoin/Template/Scripts/fee_contract.hex    the same, unapplied
# LOVEJOIN_V2= points elsewhere. Anything that doesn't match writes nothing and exits 1.
cd "$(dirname "$0")" || exit 1
LOVEJOIN_V2=${LOVEJOIN_V2:-../../lovejoin}
COMMIT=29573c5
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
  aiken blueprint apply -i "$out/policy.json" -m mix_logic -v mix_logic "$name" > "$out/applied.json" 2>/dev/null &&
  aiken blueprint apply -i "$out/unapplied.json" -m mix_box -v mix_box 581c0dad3046f90d9cf8354eb8b743d50fb2c25d581269b94ffcdf59499e \
    > "$out/mix_box_classic.json" 2>/dev/null &&
  aiken blueprint apply -i "$out/unapplied.json" -m one_shot_mint -v one_shot_mint \
    5820d4c72bc25582a0e5caff6395f708cfd173535fae3c61d8ecbccbd1ad447add22 > "$out/osm1.json" 2>/dev/null &&
  aiken blueprint apply -i "$out/osm1.json" -m one_shot_mint -v one_shot_mint 00 > "$out/osm2.json" 2>/dev/null &&
  aiken blueprint apply -i "$out/osm2.json" -m one_shot_mint -v one_shot_mint \
    581c288fea77a0f674c6080aadd8ed3ca42cd5a920bf1f00c0d3e63306e4 > "$out/one_shot_mint_pool5.json" 2>/dev/null &&
  aiken blueprint apply -i "$out/unapplied.json" -m fee_contract -v fee_contract \
    581cdc6abe3b0b184e09d11cfa918f7b57cde9ea1f61c49700894d3fe117 > "$out/fc1.json" 2>/dev/null &&
  aiken blueprint apply -i "$out/fc1.json" -m fee_contract -v fee_contract "$name" > "$out/fee_contract_pool5.json" 2>/dev/null) ||
  { echo "aiken blueprint apply failed"; exit 1; }
mkdir -p Lovejoin/V2/Scripts Lovejoin/Template/Scripts
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
# The classic pool's mix_box on chain (seedelf-core's lovejoin::Protocol::of, mainnet).
CLASSIC_MIX_BOX = "c145c10ff4bcaef7f5a4dbb3fcbfddca4b6c7b08191b0690b12f1fad"
# The mainnet 5 ₳ pool's NFT policy (extension/src/lovejoin-pools.json), seed d4c72bc2…#0.
POOL5_POLICY = "dc6abe3b0b184e09d11cfa918f7b57cde9ea1f61c49700894d3fe117"
POOL5_FEE = "20aae4761e1b54e852fa7067aa0e51eee2d991346c6c9579373c330d"

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
ok &= got == APPLIED_MIX_LOGIC
classic = scripts(f"{out}/mix_box_classic.json")["mix_box"][0]
print(f"mix_box: the template at the classic L {classic} {'ok' if classic == CLASSIC_MIX_BOX else 'expected ' + CLASSIC_MIX_BOX}")
ok &= classic == CLASSIC_MIX_BOX
pool5 = scripts(f"{out}/one_shot_mint_pool5.json")["one_shot_mint"][0]
print(f"one_shot_mint: the template at the 5 ₳ pool's seed {pool5} {'ok' if pool5 == POOL5_POLICY else 'expected ' + POOL5_POLICY}")
ok &= pool5 == POOL5_POLICY
fee5 = scripts(f"{out}/fee_contract_pool5.json")["fee_contract"][0]
print(f"fee_contract: the template at the 5 ₳ pool's policy {fee5} {'ok' if fee5 == POOL5_FEE else 'expected ' + POOL5_FEE}")
ok &= fee5 == POOL5_FEE
if ok:
    open("Lovejoin/V2/Scripts/mix_logic.hex", "w").write(code.hex())
    open("Lovejoin/Template/Scripts/mix_logic.hex", "w").write(unapplied["mix_logic"][1].hex())
    open("Lovejoin/Template/Scripts/mix_box.hex", "w").write(unapplied["mix_box"][1].hex())
    open("Lovejoin/Template/Scripts/one_shot_mint.hex", "w").write(unapplied["one_shot_mint"][1].hex())
    open("Lovejoin/Template/Scripts/fee_contract.hex", "w").write(unapplied["fee_contract"][1].hex())
    sys.exit(0)
sys.exit(1)
EOF
rc=$?
rm -rf "$out"
exit $rc
