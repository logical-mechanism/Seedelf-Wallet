#!/usr/bin/env bash
# Writes variant 1's deployed scripts, as commit 5b82530 holds them, where the
# proofs and the concrete runs read them, after checking each against its
# on-chain hash:
#   Seedelf/Scripts/<name>.hex   one CBOR layer, as the ledger hashes it (#import_uplc)
#   concrete/build/<name>.flat   the flat program (aiken uplc eval -f)
# A hash that doesn't match writes nothing for that script and exits 1.
cd "$(dirname "$0")" || exit 1
mkdir -p concrete/build
for n in wallet seedelf always_false; do
  git show "5b82530:seedelf-contracts/contracts/${n}_contract.plutus" > "concrete/build/$n.plutus" || exit 1
done
python3 - <<'EOF'
import hashlib, json, sys

# Variant 1's script hashes (seedelf-contracts/README.md, seedelf-core's constants).
ON_CHAIN = {
    "wallet": "94bca9c099e84ffd90d150316bb44c31a78702239076a0a80ea4a469",
    "seedelf": "84967d911e1a10d5b4a38441879f374a07f340945bcf9e7697485255",
    "always_false": "6777ba4dc8c3043377201624502d92636381144700d49983258b75db",
}

def unwrap(b):
    """Strips one CBOR bytestring header."""
    if b[0] == 0x58:
        return b[2:2 + b[1]]
    if b[0] == 0x59:
        return b[3:3 + int.from_bytes(b[1:3], "big")]
    raise ValueError(f"unexpected CBOR header {b[0]:#x}")

ok = True
for name, expected in ON_CHAIN.items():
    envelope = json.load(open(f"concrete/build/{name}.plutus"))
    script = unwrap(bytes.fromhex(envelope["cborHex"]))  # what the ledger hashes
    got = hashlib.blake2b(b"\x03" + script, digest_size=28).hexdigest()
    if got != expected:
        print(f"{name}: hash {got}, expected {expected}")
        ok = False
        continue
    open(f"Seedelf/Scripts/{name}.hex", "w").write(script.hex())
    open(f"concrete/build/{name}.flat", "wb").write(unwrap(script))
    print(f"{name}: {got} ok")
sys.exit(0 if ok else 1)
EOF
