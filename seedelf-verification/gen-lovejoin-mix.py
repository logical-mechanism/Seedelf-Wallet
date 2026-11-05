#!/usr/bin/env python3
"""Writes v2's general Mix modules (chunk 42) for ADA pools at n = 3 and 4 and token pools at
n = 2, 3 and 4. n = 2 for ADA pools is `Lovejoin/V2/MixAny*`, written by hand first.

Each family runs mix_logic's template (`Template.Scripts`) applied to a symbolic NFT policy,
with the pool's mix_box, box value (and token), every box's points and every proof field
symbolic, so its theorems hold for every v2 pool of that kind and every set of n boxes.
Per family: the scenario (with the KAT's values for the concrete runs), the spec, the
concrete runs, one theorem module per box in (its challenge, then each branch) and the
converse. The KAT values come from Lovejoin's own `mix_kat.test.ak` in ../../lovejoin-v2
and are checked against it, value for value.

    ./gen-lovejoin-mix.py         writes the modules and prints their names for check.sh
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
KAT = os.path.join(HERE, "../../lovejoin-v2/contracts/validators/mix_kat.test.ak")
FAMILIES = [("ada", 3), ("ada", 4), ("tok", 2), ("tok", 3), ("tok", 4)]
LIMITS = {("ada", 3): 40000, ("ada", 4): 60000, ("tok", 2): 25000, ("tok", 3): 45000, ("tok", 4): 70000}
WORDS = {1: "first", 2: "second", 3: "third", 4: "fourth"}
# The KATs' launches (test_fixtures.ak): boxes of 10 ₳, or 2 ₳ and 1,000,000 of 3434…'s TOKEN.
KAT_POOL = {"ada": "10000000", "tok": "2000000 tokPolicy tokName 1000000"}

src = open(KAT).read()


def block(name):
    start = src.index(f"const {name}")
    ends = [i for i in (src.find("\nconst ", start + 1), src.find("\ntest ", start + 1), src.find("\n// ---", start + 1)) if i > 0]
    return src[start:min(ends)]


def hexes(text):
    return re.findall(r'#"([0-9a-f]+)"', text)


def kat(kind, n):
    pre = "ada" if kind == "ada" else "token"
    ins, outs, prf = hexes(block(f"{pre}_n{n}_inputs")), hexes(block(f"{pre}_n{n}_outputs")), hexes(block(f"{pre}_n{n}_proofs"))
    txids = re.findall(r"mix_box_input_with_value\(\s*0x([0-9a-f]{2}),\s*(\d+)", block(f"{pre}_n{n}_inputs"))
    assert len(ins) == 2 * n and len(outs) == 2 * n and len(prf) == 4 * n * n, (kind, n)
    assert txids == [(f"a{i}", "0") for i in range(n)], txids
    assert all(len(h) == 96 for h in ins + outs)
    assert all(len(prf[k]) == (96 if k % 4 < 2 else 64) for k in range(len(prf)))
    return ins, outs, prf


def names(n):
    pts = " ".join(f"a{i} b{i}" for i in range(1, n + 1)) + " " + " ".join(f"oa{j} ob{j}" for j in range(1, n + 1))
    fields = " ".join(f"t0{i}{j} t1{i}{j} c{i}{j} z{i}{j}" for i in range(1, n + 1) for j in range(1, n + 1))
    return pts, fields


def pool(kind):
    """The pool's parameters: as binders, as arguments, and its box value's pairs."""
    if kind == "ada":
        return "(bl : Integer)", "bl", "[(Data.B \"\", Data.Map [(Data.B \"\", Data.I bl)])]"
    return ("(bl : Integer) (tp tn : ByteString) (tq : Integer)", "bl tp tn tq",
            "[(Data.B \"\", Data.Map [(Data.B \"\", Data.I bl)]), (Data.B tp, Data.Map [(Data.B tn, Data.I tq)])]")


def xor_fold(n, j=1, acc="zero32", ind="  "):
    """The fold of xor32 over c1 .. cn as nested matches, as `xorOfChallenges` has it at n = 2."""
    if j == n:
        return f"{ind}xor32 {acc} c{j}"
    return (f"{ind}match xor32 {acc} c{j} with\n{ind}| some x{j} =>\n"
            + xor_fold(n, j + 1, f"x{j}", ind + "    ") + f"\n{ind}| none => none")


def write(path, text):
    open(os.path.join(HERE, path), "w").write(text)


def family(kind, n):
    ns = f"{'Any' if kind == 'ada' else 'Tok'}{n}"
    mod = f"Lovejoin.V2.Mix{ns}"
    pts, fields = names(n)
    pbind, pargs, pvalue = pool(kind)
    what = "ADA pool" if kind == "ada" else "token pool"
    ins, outs, prf = kat(kind, n)
    rd = ('.Constr 0 [.I bl, .B "", .B "", .I 0, .I 800000, .B M, .B mixLogicHash, .B feeHash]' if kind == "ada"
          else ".Constr 0 [.I bl, .B tp, .B tn, .I tq, .I 800000, .B M, .B mixLogicHash, .B feeHash]")
    inputs = ",\n                              ".join(
        f'⟨⟨ofHex "{("a%d" % i) * 32}", 0⟩, boxPool M {pargs} a{i + 1} b{i + 1}⟩' for i in range(n))
    outputs = ", ".join(f"boxPool M {pargs} oa{j} ob{j}" for j in range(1, n + 1))
    redeemer = ",\n   ".join("[" + ", ".join(f"branch t0{i}{j} t1{i}{j} c{i}{j} z{i}{j}" for j in range(1, n + 1)) + "]"
                             for i in range(1, n + 1))
    katdefs = []
    for i in range(n):
        katdefs.append(f'def katA{i + 1} : ByteString := ofHex "{ins[2 * i]}"')
        katdefs.append(f'def katB{i + 1} : ByteString := ofHex "{ins[2 * i + 1]}"')
    for j in range(n):
        katdefs.append(f'def katOA{j + 1} : ByteString := ofHex "{outs[2 * j]}"')
        katdefs.append(f'def katOB{j + 1} : ByteString := ofHex "{outs[2 * j + 1]}"')
    for i in range(n):
        for j in range(n):
            t0, t1, c, z = prf[4 * (n * i + j):4 * (n * i + j) + 4]
            ij = f"{i + 1}{j + 1}"
            katdefs += [f'def katT0{ij} : ByteString := ofHex "{t0}"', f'def katT1{ij} : ByteString := ofHex "{t1}"',
                        f'def katC{ij} : ByteString := ofHex "{c}"', f'def katZ{ij} : ByteString := ofHex "{z}"']
    tokdef = ('\n/-- The token-pool KAT launch\'s token policy (`test_fixtures.ak`). -/\n'
              'def tokPolicy : ByteString := ofHex "34343434343434343434343434343434343434343434343434343434"\n'
              'def tokName : ByteString := "TOKEN"\n'
              if kind == "tok" else "")
    katpts = " ".join(f"katA{i} katB{i}" for i in range(1, n + 1)) + " " + " ".join(f"katOA{j} katOB{j}" for j in range(1, n + 1))
    katfields = " ".join(f"katT0{i}{j} katT1{i}{j} katC{i}{j} katZ{i}{j}" for i in range(1, n + 1) for j in range(1, n + 1))
    write(f"Lovejoin/V2/Mix{ns}.lean", f'''import Lovejoin.V2.Mix
import Lovejoin.Template.Launch

/-! v2's Mix of {n} boxes, for any v2 {what} and any boxes: `V2.MixAny`'s scenario at
n = {n}{", its boxes holding the pool's token too" if kind == "tok" else ""}. The pool's NFT policy `P`, its mix_box `M`, its
box value{" (lovelace `bl`, and `tq` of the token `(tp, tn)`)" if kind == "tok" else " `bl`"} and every box's points are parameters.
The KAT's values below (`mix_kat.test.ak`'s `{"ada" if kind == "ada" else "token"}_n{n}_*`, written out by
`gen-lovejoin-mix.py`, which checks them against that file) are for `V2.Mix{ns}Steps`. -/

namespace Lovejoin.V2.{ns}
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open CardanoLedgerApi.V3
open Seedelf.V1 (emptyTx ofHex)
open Lovejoin.Template (nftName)

/-- The pool's `ReferenceDatum`. -/
def refDatumPool {pbind} (M : ByteString) : Data :=
  {rd}

/-- The pool's reference UTxO: 2 ₳ and its NFT `(P, lovejoin)` at reference_holder. -/
def refInputPool (P : ByteString) {pbind} (M : ByteString) : TxInInfo :=
  ⟨⟨ofHex "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", 0⟩,
   ⟨⟨.ScriptCredential referenceHolderHash, none⟩,
    [(Data.B "", Data.Map [(Data.B "", Data.I 2000000)]), (Data.B P, Data.Map [(Data.B nftName, Data.I 1)])],
    .OutputDatum (refDatumPool {pargs} M), none⟩⟩

/-- A box at mix_box `M` holding the box value, its datum `(a, b)` inline. -/
def boxPool (M : ByteString) {pbind} (a b : ByteString) : TxOut :=
  ⟨⟨.ScriptCredential M, none⟩, {pvalue}, .OutputDatum (mixDatum a b), none⟩

/-- A Mix of {n} boxes in, `(a1, b1)` to `(a{n}, b{n})`, into {n} out, `(oa1, ob1)` to `(oa{n}, ob{n})`, then
`V2.Mix`'s change. -/
def mixCtxPool (P M : ByteString) {pbind} ({pts} : ByteString) (redeemer : Data) : ScriptContext :=
  let tx := {{ emptyTx with
    txInfoInputs          := [{inputs}],
    txInfoReferenceInputs := [refInputPool P {pargs} M],
    txInfoOutputs         := [{outputs}, change],
    txInfoFee             := 200000,
    txInfoWdrl            := [(.ScriptCredential mixLogicHash, 0)] }}
  ⟨tx, redeemer, .RewardingScript (.ScriptCredential mixLogicHash)⟩

/-- `Mix {{ proofs }}`, input i's branch j `(t0ij, t1ij, cij, zij)`. -/
def proofsRedeemerPool ({fields} : ByteString) : Data :=
  mixRedeemer
  [{redeemer}]
{tokdef}
/-- The KAT's points and proofs. -/
{chr(10).join(katdefs)}

end Lovejoin.V2.{ns}
''')
    # the spec
    if kind == "ada":
        boxvalue = '''/-- `value.box_value` for an ADA pool: `assets.from_lovelace(bl)`, `zero` for 0. -/
def boxValuePool (bl : Integer) : Data :=
  if bl == 0 then .Map [] else .Map [(.B "", .Map [(.B "", .I bl)])]'''
    else:
        boxvalue = '''/-- `value.box_value`: `assets.from_lovelace(bl)` (`zero` for 0), then for a token policy
other than ADA's, `assets.add`, which leaves the value as it is for a quantity of 0 and
otherwise puts the token's policy after ADA's (`""` sorts first). -/
def boxValuePool (bl : Integer) (tp tn : ByteString) (tq : Integer) : Data :=
  let lovelace : List (Data × Data) := if bl == 0 then [] else [(.B "", .Map [(.B "", .I bl)])]
  if tp == "" then .Map lovelace
  else if tq == 0 then .Map lovelace
  else .Map (lovelace ++ [(.B tp, .Map [(.B tn, .I tq)])])'''
    datums = '""'
    for j in range(1, n + 1):
        datums = f"(appendByteString {datums} d{j})"
    values = '""'
    for _ in range(n):
        values = f"(appendByteString {values} v)"
    sers = ", ".join(f"serialised (mixDatum oa{j} ob{j})" for j in range(1, n + 1)) + f", serialised (boxValuePool {pargs})"
    somes = ", ".join(f"some d{j}" for j in range(1, n + 1)) + ", some v"
    unders = ", ".join("_" for _ in range(n + 1))
    outpts = " ".join(f"oa{j} ob{j}" for j in range(1, n + 1))
    wb = "(sigmaOrHeaderPool a b)"
    for j in range(1, n + 1):
        wb = f"(appendByteString (appendByteString {wb} oa{j}) ob{j})"
    wc = "withBranches"
    for j in range(1, n + 1):
        wc = f"(appendByteString (appendByteString {wc} t0{j}) t1{j})"
    tparams = " ".join(f"t0{j} t1{j}" for j in range(1, n + 1))
    cparams = " ".join(f"c{j}" for j in range(1, n + 1))
    xorbody = xor_fold(n)
    chparams = " ".join(f"t0{j} t1{j} c{j}" for j in range(1, n + 1))
    inparams = " ".join(f"t0{j} t1{j} c{j} z{j}" for j in range(1, n + 1))
    branches = " &&\n    ".join(f"branchHolds a b oa{j} ob{j} t0{j} t1{j} c{j} z{j}" for j in range(1, n + 1))
    accepts = " &&\n    ".join(
        f"inputAcceptsPool M {pargs} {outpts} a{i} b{i} " + " ".join(f"t0{i}{j} t1{i}{j} c{i}{j} z{i}{j}" for j in range(1, n + 1))
        for i in range(1, n + 1))
    write(f"Lovejoin/V2/Mix{ns}Spec.lean", f'''import Lovejoin.V2.Mix{ns}
import Lovejoin.V2.MixSpec

/-! v2's Mix of {n}, for any v2 {what} and any boxes, its spec: `V2.MixAnySpec`'s at n = {n}.
`branchHolds` (a box out's point as the script stores it), `xor32` and `zero32` are
`MixSpec`'s. Written by `gen-lovejoin-mix.py`.

`mixAcceptsPool` is the `&&` of each box's `inputAcceptsPool`, and each of those the `&&`
of its challenge and its branches, so the theorems on each check cover every way a Mix
can fail, with no tie-in lemma. -/

namespace Lovejoin.V2.{ns}
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.Crypto.Hash
open PlutusCore.UPLC.Term (Term)
open Lovejoin.Classic (serialised)
open Lovejoin.Template (nftName)

{boxvalue}

/-- validate_mix's `ctx`: the boxes out's datums, the box value's {n} times, then `M`, hashed. -/
def mixContextPool (M : ByteString) {pbind} ({outpts} : ByteString) : Option ByteString :=
  match {sers} with
  | {somes} =>
      some (blake2b_256 (appendByteString (appendByteString {datums} {values}) M))
  | {unders} => none

/-- hash.ak's header with its prefix: `domain_tag_v1 ‖ #03 ‖ n (1 byte) ‖ a ‖ b`, n = {n}. -/
def sigmaOrHeaderPool (a b : ByteString) : ByteString :=
  appendByteString (appendByteString (appendByteString (appendByteString
    ("lovejoin/sigmajoin/v1/" : ByteString) "\\x03") "\\x0{n}") a) b

/-- verify_pre's `c_global` for the box in `(a, b)`. -/
def challengePool (a b {outpts} {tparams} ctx : ByteString) : ByteString :=
  let withBranches := {wb}
  let withCommitments := {wc}
  blake2b_256 (appendByteString withCommitments ctx)

/-- The fold of xor32 over the branches' `c`s, from 32 zero bytes. -/
def xorOfChallengesPool ({cparams} : ByteString) : Option ByteString :=
{xorbody}

/-- A box in's challenge: its branches' `c`s xor to `c_global`. -/
def challengeHoldsPool (M : ByteString) {pbind} ({outpts} a b {chparams} : ByteString) : Bool :=
  match mixContextPool M {pargs} {outpts}, xorOfChallengesPool {cparams} with
  | some ctx, some x => challengePool a b {outpts} {tparams} ctx == x
  | _, _ => false

/-- verify_pre for the box in `(a, b)`: the challenge, then each branch against its box out. -/
def inputAcceptsPool (M : ByteString) {pbind} ({outpts} a b {inparams} : ByteString) : Bool :=
  challengeHoldsPool M {pargs} {outpts} a b {chparams} &&
    {branches}

/-- validate_mix: each box in's proof verifies. -/
def mixAcceptsPool (M : ByteString) {pbind} ({pts} {fields} : ByteString) : Bool :=
  {accepts}

/-- mix_logic's template's arguments: the pool's NFT, then the Mix. -/
def argsPool (P M : ByteString) {pbind} ({pts} {fields} : ByteString) : List Term :=
  [toTerm P, toTerm nftName, toTerm (mixCtxPool P M {pargs} {pts} (proofsRedeemerPool {fields}))]

end Lovejoin.V2.{ns}
''')
    # the concrete runs
    kz11 = katfields.replace("katZ11", "zOnePool", 1)
    knn = katfields.replace(f"katZ{n}{n}", "zOnePool", 1)
    run = lambda fs: (f"stepsWith mixLogicTemplate atTestLaunch (mixCtxPool nftPolicy mixBoxHash {KAT_POOL[kind]} {katpts} "
                      f"(proofsRedeemerPool {fs})) 120000")
    spec = lambda fs: f"mixAcceptsPool mixBoxHash {KAT_POOL[kind]} {katpts} {fs}"
    write(f"Lovejoin/V2/Mix{ns}Steps.lean", f'''import Lovejoin.V2.Mix{ns}Spec
import Lovejoin.Template.Steps

/-! The general Mix of {n} in a {what} (`V2.Mix{ns}`) against Lovejoin's KAT, concretely, on
mix_logic's template at the test launch (`abab…`, mix_box `5555…`){", its token `3434…`'s TOKEN" if kind == "tok" else ""}:

- The KAT must halt: the passing run the theorems pair with. Its step count sizes
  their limit, {LIMITS[(kind, n)]}. `mixAcceptsPool` on it must be `true`.
- With box in 1's first `z` changed, or box in {n}'s last, the template must error and
  the spec say `false`. -/

namespace Lovejoin.V2.{ns}
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open Lovejoin.Template (stepsWith nftName)

def zOnePool : ByteString := Seedelf.V1.ofHex "0000000000000000000000000000000000000000000000000000000000000001"

def atTestLaunch := [toTerm nftPolicy, toTerm nftName]

#eval s!"{ns}, the KAT:            {{{run(katfields)}}}"
#eval s!"{ns}, mixAcceptsPool:     {{{spec(katfields)}}}"
#eval s!"{ns}, z11 changed:        {{{run(kz11)}}}, spec {{{spec(kz11)}}}"
#eval s!"{ns}, z{n}{n} changed:        {{{run(knn)}}}, spec {{{spec(knn)}}}"

end Lovejoin.V2.{ns}
''')
    # the theorems
    allargs = f"P M {pargs} {pts} {fields}"
    binder = f"∀ (P M : ByteString) {pbind} ({pts} {fields} : ByteString)"
    mods = [mod, f"{mod}Spec", f"{mod}Steps"]
    for i in range(1, n + 1):
        prop = f"appliedMix{ns}Box{i}"
        w = WORDS[i]
        ch = " ".join(f"t0{i}{j} t1{i}{j} c{i}{j}" for j in range(1, n + 1))
        thms = [f'''/-- A Mix whose {w} box's `c`s don't xor to its `c_global` fails. -/
theorem mix{ns.lower()}_needs_the_{w}_challenge :
    {binder},
      challengeHoldsPool M {pargs} {outpts} a{i} b{i} {ch} = false →
        isUnsuccessful ({prop}.prop {allargs}) := by
  blaster (timeout: 540)''']
        for j in range(1, n + 1):
            thms.append(f'''/-- So does one whose {w} box's {WORDS[j]} branch doesn't hold against the {WORDS[j]} box out. -/
theorem mix{ns.lower()}_needs_the_{w}_proofs_{WORDS[j]}_branch :
    {binder},
      branchHolds a{i} b{i} oa{j} ob{j} t0{i}{j} t1{i}{j} c{i}{j} z{i}{j} = false →
        isUnsuccessful ({prop}.prop {allargs}) := by
  blaster (timeout: 540)''')
        body = "\n\n".join(thms)
        write(f"Lovejoin/V2/Mix{ns}Box{i}.lean", f'''import Lovejoin.V2.Mix{ns}Spec
import Blaster

/-! v2's Mix of {n}, for any v2 {what} and any boxes, box in {i}: if its proof doesn't verify, the
Mix fails, whatever the pool's parameters, every box's points and every proof field are.
Its {n + 1} checks are {n + 1} theorems: the challenge, then each branch. With the other boxes'
modules and `Mix{ns}Passes`, a Mix of {n} succeeds iff `mixAcceptsPool`. The passing run is
`V2.Mix{ns}Steps`'. Written by `gen-lovejoin-mix.py`. -/

namespace Lovejoin.V2.{ns}
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils

#prep_uplc {prop} mixLogicTemplate argsPool {LIMITS[(kind, n)]}

{body}

end Lovejoin.V2.{ns}
''')
        mods.append(f"{mod}Box{i}")
    wf = " → ".join([f"wellFormed a{i} b{i} = true" for i in range(1, n + 1)] +
                    [f"wellFormed oa{j} ob{j} = true" for j in range(1, n + 1)])
    sane = 'P ≠ "" → bl ≠ 0 →' + (' tp ≠ "" → tq ≠ 0 →' if kind == "tok" else "")
    write(f"Lovejoin/V2/Mix{ns}Passes.lean", f'''import Lovejoin.V2.Mix{ns}Spec
import Blaster

/-! v2's Mix of {n}, for any v2 {what} and any boxes, its last part: with every proof verifying it
succeeds, given what the script needs of the pool and the boxes (as in `V2.MixAnyPasses`):
the NFT's policy isn't ADA's, the box value isn't 0{", the token isn't ADA and its quantity isn't 0" if kind == "tok" else ""},
and every box's datum is two unequal 48-byte points. A pool's datum is always so
(`Template.OneShotMint`'s `nft_needs_a_sane_datum`). Written by `gen-lovejoin-mix.py`. -/

namespace Lovejoin.V2.{ns}
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)

#prep_uplc appliedMix{ns}Passes mixLogicTemplate argsPool {LIMITS[(kind, n)]}

/-- A Mix of {n} in a sane v2 {what}, its boxes well-formed and every proof verifying, succeeds. -/
theorem mix{ns.lower()}_passes_with_every_proof :
    {binder},
      {sane}
      {wf} →
      mixAcceptsPool M {pargs} {pts} {fields} = true →
        isSuccessful (appliedMix{ns}Passes.prop {allargs}) := by
  blaster (timeout: 540)

end Lovejoin.V2.{ns}
''')
    mods.append(f"{mod}Passes")
    # check the generated KAT values against the file
    gen = re.findall(r'ofHex "([0-9a-f]+)"', open(os.path.join(HERE, f"Lovejoin/V2/Mix{ns}.lean")).read())
    expected = ["ee" * 32] + [("a%d" % i) * 32 for i in range(n)] + (["34" * 28] if kind == "tok" else []) + ins + outs + prf
    assert gen == expected, f"{ns}: the scenario's values aren't the KAT's"
    return mods


all_mods = []
for kind, n in FAMILIES:
    all_mods += family(kind, n)
print(" ".join(all_mods))
