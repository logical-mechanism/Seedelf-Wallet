#!/usr/bin/env bash
# Writes Lovejoin's classic mainnet pool, as Lovejoin's commit c1239fb records it
# (artifacts/mainnet/, the 2026-09-26 deployment, Aiken v1.1.24), where the proofs
# and the concrete runs read it, after checking each script against the hash
# seedelf-core pins (lovejoin::Protocol::of, mainnet). mix_box and mix_logic are
# also checked against the reference outputs seedelf-core holds as they sit on
# chain (references.rs): the bytes the wallet spends against.
#   Lovejoin/Scripts/<name>.hex           one CBOR layer, as the ledger hashes it
#   concrete/build/lovejoin_<name>.flat   the flat program (aiken uplc eval -f)
# Needs the Lovejoin checkout beside this repo (LOVEJOIN= to point elsewhere).
# A script that doesn't match writes nothing for it and exits 1.
cd "$(dirname "$0")" || exit 1
LOVEJOIN=${LOVEJOIN:-../../lovejoin}
mkdir -p concrete/build Lovejoin/Scripts
for n in mix_box mix_logic fee_contract one_shot_mint reference_holder; do
  git -C "$LOVEJOIN" show "c1239fb:artifacts/mainnet/$n.plutus" > "concrete/build/lovejoin_$n.plutus" || exit 1
done
python3 - <<'EOF'
import hashlib, json, re, sys

# Mainnet's classic pool: seedelf-core's lovejoin::Protocol::of (the `else` side
# of network_flag) and templates.rs's REFERENCE_HOLDER_HASH.
ON_CHAIN = {
    "mix_box": "c145c10ff4bcaef7f5a4dbb3fcbfddca4b6c7b08191b0690b12f1fad",
    "mix_logic": "0dad3046f90d9cf8354eb8b743d50fb2c25d581269b94ffcdf59499e",
    "fee_contract": "a072c7e839ab9ddf24344d0b2f70f56971f187fee8089f5f64212406",
    "one_shot_mint": "f5592689c7ab35553a3234a54c0ee118090a5762c696819a53a5a826",
    "reference_holder": "288fea77a0f674c6080aadd8ed3ca42cd5a920bf1f00c0d3e63306e4",
}
REFERENCE_OUTPUT = {"mix_box": "LOVEJOIN_MAINNET_MIX_BOX", "mix_logic": "LOVEJOIN_MAINNET_MIX_LOGIC"}

references = open("../seedelf-platform/seedelf-core/src/references.rs").read()
def reference_output(const):
    """The hex a `pub const NAME: &str = concat!("…", …);` joins."""
    body = re.search(rf"pub const {const}: &str = concat!\((.*?)\);", references, re.S).group(1)
    return "".join(re.findall(r'"([0-9a-f]*)"', body))

def unwrap(b):
    """Strips one CBOR bytestring header."""
    if b[0] == 0x58:
        return b[2:2 + b[1]]
    if b[0] == 0x59:
        return b[3:3 + int.from_bytes(b[1:3], "big")]
    raise ValueError(f"unexpected CBOR header {b[0]:#x}")

ok = True
for name, expected in ON_CHAIN.items():
    envelope = json.load(open(f"concrete/build/lovejoin_{name}.plutus"))
    script = unwrap(bytes.fromhex(envelope["cborHex"]))  # what the ledger hashes
    got = hashlib.blake2b(b"\x03" + script, digest_size=28).hexdigest()
    if got != expected:
        print(f"{name}: hash {got}, expected {expected}")
        ok = False
        continue
    note = ""
    if name in REFERENCE_OUTPUT:
        if script.hex() not in reference_output(REFERENCE_OUTPUT[name]):
            print(f"{name}: not in seedelf-core's {REFERENCE_OUTPUT[name]}")
            ok = False
            continue
        note = ", in the on-chain reference output"
    open(f"Lovejoin/Scripts/{name}.hex", "w").write(script.hex())
    open(f"concrete/build/lovejoin_{name}.flat", "wb").write(unwrap(script))
    print(f"{name}: {got} ok{note}")
sys.exit(0 if ok else 1)
EOF
