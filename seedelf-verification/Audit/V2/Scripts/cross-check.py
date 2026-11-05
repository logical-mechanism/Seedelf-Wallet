#!/usr/bin/env python3
"""Aiken's evaluator on the same runs `Audit.V2`'s `#guard`s make on the mutants, outside the
Lean model: mix_logic's v2 template (`Lovejoin/Template/Scripts/mix_logic.hex`) and the three
mutants beside this script, each applied to the test launch's NFT (`abab…`, `lovejoin`), on
`V2.MixAny`'s KAT Mix of two (`V2/Mix.lean`'s values) and on the same Mix with box out 2 a
lovelace more. Expected:

    template  KAT unit,  box 2 +1 crashed
    M1        KAT unit,  box 2 +1 crashed   (M1 changes only the sigma-OR branch check)
    M2        KAT unit,  box 2 +1 unit      (M2 drops the box-value check)
    M3        KAT unit,  box 2 +1 crashed   (M3 changes only validate_owner)

Run from seedelf-verification with Aiken v1.1.24 on PATH:  python3 -I Audit/V2/Scripts/cross-check.py"""
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SV = os.environ.get("SV") or os.path.normpath(os.path.join(HERE, "../../.."))
MIX = open(os.path.join(SV, "Lovejoin/V2/Mix.lean")).read()


def hexdef(name):
    return re.search(rf'^def {name} : ByteString := ofHex "([0-9a-f]+)"', MIX, re.M).group(1)


P = hexdef("nftPolicy"); M = hexdef("mixBoxHash"); L = hexdef("mixLogicHash"); FEE = hexdef("feeHash")
RH = hexdef("referenceHolderHash"); USER = hexdef("userKey")
pts = {n: hexdef(n) for n in ["inA1", "inB1", "inA2", "inB2", "outA1", "outB1", "outA2", "outB2"]}
kat = {n: hexdef(n) for n in [f"kat{x}{i}{j}" for i in (1, 2) for j in (1, 2) for x in ("T0", "T1", "C", "Z")]
       if re.search(rf"^def {n} ", MIX, re.M)}
kat = {k.replace("katT0", "t0").replace("katT1", "t1").replace("katC", "c").replace("katZ", "z"): v for k, v in kat.items()}
assert len(kat) == 16, kat.keys()


def ada(n):
    return f"Map [(B #, Map [(B #, I {n})])]"


def box(a, b, lovelace=10000000):
    return f"Constr 0 [Constr 0 [Constr 1 [B #{M}], Constr 1 []], {ada(lovelace)}, Constr 2 [Constr 0 [B #{a}, B #{b}]], Constr 1 []]"


ref_in = (f"Constr 0 [Constr 0 [B #{'ee' * 32}, I 0], Constr 0 [Constr 0 [Constr 1 [B #{RH}], Constr 1 []], "
          f"Map [(B #, Map [(B #, I 2000000)]), (B #{P}, Map [(B #6c6f76656a6f696e, I 1)])], "
          f"Constr 2 [Constr 0 [I 10000000, B #, B #, I 0, I 800000, B #{M}, B #{L}, B #{FEE}]], Constr 1 []]]")
change = f"Constr 0 [Constr 0 [Constr 0 [B #{USER}], Constr 1 []], {ada(5000000)}, Constr 0 [], Constr 1 []]"


def branch(i, j):
    return f"Constr 0 [B #{kat[f't0{i}{j}']}, B #{kat[f't1{i}{j}']}, B #{kat[f'c{i}{j}']}, B #{kat[f'z{i}{j}']}]"


redeemer = "Constr 1 [List [" + ", ".join(f"Constr 0 [List [{branch(i, 1)}, {branch(i, 2)}]]" for i in (1, 2)) + "]]"


def ctx(second_out_lovelace):
    ins = (f"List [Constr 0 [Constr 0 [B #{'a0' * 32}, I 0], {box(pts['inA1'], pts['inB1'])}], "
           f"Constr 0 [Constr 0 [B #{'a1' * 32}, I 0], {box(pts['inA2'], pts['inB2'])}]]")
    outs = f"List [{box(pts['outA1'], pts['outB1'])}, {box(pts['outA2'], pts['outB2'], second_out_lovelace)}, {change}]"
    info = (f"Constr 0 [{ins}, List [{ref_in}], {outs}, I 200000, Map [], List [], Map [(Constr 1 [B #{L}], I 0)], "
            "Constr 0 [Constr 0 [Constr 0 [], Constr 1 []], Constr 0 [Constr 2 [], Constr 1 []]], "
            "List [], Map [], Map [], B #, Map [], List [], Constr 1 [], Constr 1 []]")
    return f"(con data (Constr 0 [{info}, {redeemer}, Constr 2 [Constr 1 [B #{L}]]]))"


def run(hexfile, context):
    code = bytes.fromhex(open(hexfile).read().strip())
    # One CBOR layer: a bytestring header, then the flat bytes.
    n = code[0] & 0x1f
    flat = code[1 + {24: 1, 25: 2, 26: 4}.get(n, 0):] if code[0] >> 5 == 2 else None
    assert flat is not None, "not a CBOR bytestring"
    with tempfile.NamedTemporaryFile("wb", suffix=".flat", delete=False) as f:
        f.write(flat)
    try:
        out = subprocess.run(["aiken", "uplc", "eval", "-f", f.name, f"(con data (B #{P}))",
                              "(con data (B #6c6f76656a6f696e))", context], capture_output=True, text=True).stdout
    finally:
        os.unlink(f.name)
    out = " ".join(out.replace("\\n", " ").split())
    return "unit" if re.search(r'"result": "\(con unit \(\)\)', out) else "crashed"


scripts = [("template", os.path.join(SV, "Lovejoin/Template/Scripts/mix_logic.hex")),
           ("M1", os.path.join(HERE, "mix_logic_one_equation.hex")),
           ("M2", os.path.join(HERE, "mix_logic_no_value_check.hex")),
           ("M3", os.path.join(HERE, "mix_logic_owner_first_proof_only.hex"))]
want = {"template": ("unit", "crashed"), "M1": ("unit", "crashed"), "M2": ("unit", "unit"), "M3": ("unit", "crashed")}
bad = 0
for name, path in scripts:
    got = (run(path, ctx(10000000)), run(path, ctx(10000001)))
    ok = got == want[name]
    bad += not ok
    print(f"{name:<9} KAT {got[0]:<8} box 2 +1 {got[1]:<8} {'ok' if ok else 'EXPECTED ' + str(want[name])}")
sys.exit(1 if bad else 0)
