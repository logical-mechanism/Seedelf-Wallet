#!/usr/bin/env bash
# Lovejoin's classic mainnet mix_logic (0dad3046…) on an Owner withdrawal of one box,
# through Aiken's evaluator. The proof is built here, independently of the Lean side:
# the curve points and serialise_data by Aiken's evaluator, the hashes in Python. The box
# is (g1, x·g1) with x = 0x5eed0e1f, the nonce 0x1234567, and the proof is bound to a
# 9 ₳ payout. It must return unit; the same proof with the payout a lovelace more, or
# with z changed, must crash. Lovejoin/Steps.lean's ownerVector computes the same proof
# in Lean and should print the same z. Needs ../extract-lovejoin.sh first.
cd "$(dirname "$0")" || exit 1
python3 -I - "$PWD/build" <<'EOF'
import hashlib, re, subprocess, sys, tempfile, os
BUILD = sys.argv[1]
G = "97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb"
MIX_BOX = "c145c10ff4bcaef7f5a4dbb3fcbfddca4b6c7b08191b0690b12f1fad"
MIX_LOGIC = "0dad3046f90d9cf8354eb8b743d50fb2c25d581269b94ffcdf59499e"
FEE = "a072c7e839ab9ddf24344d0b2f70f56971f187fee8089f5f64212406"
REF_HOLDER = "288fea77a0f674c6080aadd8ed3ca42cd5a920bf1f00c0d3e63306e4"
POLICY = "f5592689c7ab35553a3234a54c0ee118090a5762c696819a53a5a826"
REF_TX = "f89cb43a55eed378fe90fe954a9d86566280e6416d97f9008937ab492b37175c"
PKH = "00112233445566778899aabbccddeeff00112233445566778899aabb"
Q = 52435875175126190479447740508185965837690552500527637822603658699938581184513
X, R = 0x5eed0e1f, 0x1234567

def aiken_eval(*args):
    """`aiken uplc eval`'s answer on one line (its JSON escapes the term's newlines)."""
    out = subprocess.run(["aiken", "uplc", "eval", *args], capture_output=True, text=True).stdout
    return " ".join(out.replace("\\n", " ").split())

def eval_uplc(program):
    with tempfile.NamedTemporaryFile("w", suffix=".uplc", delete=False) as f:
        f.write(program)
    try:
        return aiken_eval(f.name)
    finally:
        os.unlink(f.name)

def bytes_result(program):
    m = re.search(r'"result": "\(con bytestring #([0-9a-f]*) ?\)', eval_uplc(program))
    return m.group(1)

def scale(k):
    return bytes_result(f"(program 1.1.0 [ (builtin bls12_381_G1_compress) [ [ (builtin bls12_381_G1_scalarMul) (con integer {k}) ] [ (builtin bls12_381_G1_uncompress) (con bytestring #{G}) ] ] ])")

def serialise(data):
    return bytes_result(f"(program 1.1.0 [ (builtin serialiseData) (con data ({data})) ])")

def payout(amt):
    return f"Constr 0 [Constr 0 [Constr 0 [B #{PKH}], Constr 1 []], Map [(B #, Map [(B #, I {amt})])], Constr 0 [], Constr 1 []]"

b, t = scale(X), scale(R)
box_ref = "Constr 0 [B #, I 0]"
outputs = f"List [{payout(9000000)}]"
refs = f"List [{box_ref}]"
ctx = hashlib.blake2b(bytes.fromhex(serialise(outputs) + serialise(refs) + MIX_BOX), digest_size=32).digest()
fs = hashlib.blake2b(b"lovejoin/sigmajoin/v1/" + b"\x01" + bytes.fromhex(G + b + t) + ctx, digest_size=32).digest()
c = int.from_bytes(fs, "big") % Q
z = format((R + c * X) % Q, "064x")
print(f"owner vector: b {b} t {t} z {z}")

ref_out = (f"Constr 0 [Constr 0 [Constr 1 [B #{REF_HOLDER}], Constr 1 []], "
           f"Map [(B #, Map [(B #, I 1521430)]), (B #{POLICY}, Map [(B #6c6f76656a6f696e, I 1)])], "
           f"Constr 2 [Constr 0 [I 10000000, I 1000000, B #{MIX_BOX}, B #{MIX_LOGIC}, B #{FEE}]], Constr 1 []]")
box_out = (f"Constr 0 [Constr 0 [Constr 1 [B #{MIX_BOX}], Constr 1 []], Map [(B #, Map [(B #, I 10000000)])], "
           f"Constr 2 [Constr 0 [B #{G}, B #{b}]], Constr 1 []]")

def run(name, zz, amt):
    info = (f"Constr 0 [List [Constr 0 [{box_ref}, {box_out}]], List [Constr 0 [Constr 0 [B #{REF_TX}, I 0], {ref_out}]], "
            f"List [{payout(amt)}], I 0, Map [], List [], Map [(Constr 1 [B #{MIX_LOGIC}], I 0)], "
            "Constr 0 [Constr 0 [Constr 0 [], Constr 1 []], Constr 0 [Constr 2 [], Constr 1 []]], "
            "List [], Map [], Map [], B #, Map [], List [], Constr 1 [], Constr 1 []]")
    ctx_data = f"(con data (Constr 0 [{info}, Constr 0 [List [Constr 0 [B #{t}, B #{zz}]]], Constr 2 [Constr 1 [B #{MIX_LOGIC}]]]))"
    out = aiken_eval("-f", f"{BUILD}/lovejoin_mix_logic.flat", ctx_data)
    m = re.search(r'"result": "(\(con unit \(\)\))', out)
    print(f"{name:<30} {m.group(1) if m else 'crashed'}")

run("valid proof", z, 9000000)
run("payout a lovelace more", z, 9000001)
run("z changed", "00" * 31 + "01", 9000000)
EOF
