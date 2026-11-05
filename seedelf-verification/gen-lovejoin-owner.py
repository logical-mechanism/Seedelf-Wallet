#!/usr/bin/env python3
"""Writes Lovejoin's general Owner withdrawal modules (chunk 42): v2 through mix_logic's
template, for any pool, with 1 to 4 boxes, and the deployed classic pool with 1 to 3.

The wallet withdraws one box at a time (seedelf-wasm's `withdraw_in`), but a withdrawal's
safety is about what anyone can build: several boxes, a payer's input beside them, and
outputs of their choosing. So each scenario spends n boxes at mix_box, every box's points
and proof symbolic, with a key input beside them, and pays two outputs: a Seedelf register
at a wallet contract and a change output, every field symbolic. The theorems: a
well-formed box whose proof doesn't verify against this transaction's `ctx` fails the
withdrawal, one per box, and the converse. The concrete runs build honest proofs with the
builtins' own implementations: box i is `(g1, x·g1)`, x = 0x5eed0e1f + i.

    ./gen-lovejoin-owner.py       writes the modules and prints their names for check.sh
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
WORDS = {1: "first", 2: "second", 3: "third", 4: "fourth"}
FAMILIES = [("v2", n) for n in (1, 2, 3, 4)] + [("classic", n) for n in (1, 2, 3)]


def write(path, text):
    open(os.path.join(HERE, path), "w").write(text)


def family(kind, n):
    v2 = kind == "v2"
    prefix = f"Lovejoin/V2/OwnAny{n}" if v2 else f"Lovejoin/OwnClassic{n}"
    mod = prefix.replace("/", ".")
    ns = f"Lovejoin.V2.Own{n}" if v2 else f"Lovejoin.Classic.Own{n}"
    tag = f"own_any{n}" if v2 else f"own_classic{n}"
    prop = f"appliedOwn{'Any' if v2 else 'Classic'}{n}"
    script = "mixLogicTemplate" if v2 else "mixLogic"
    limit = 5000 * n + 5000
    pts = " ".join(f"a{i} b{i}" for i in range(1, n + 1))
    prf = " ".join(f"t{i} z{i}" for i in range(1, n + 1))
    pool = "P M " if v2 else ""
    poolbind = "(P M : ByteString) " if v2 else ""
    mparam = "M " if v2 else ""
    mbind = "(M : ByteString) " if v2 else ""
    outbind = "(kp : ByteString) (pin : Integer) (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer)"
    outargs = "kp pin s g u amt kc ch"
    ctxargs = "s g u amt kc ch"
    ctxbind = "(s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer)"
    what = "any v2 pool" if v2 else "the classic pool"
    refs = "\n".join(f'def ref{i} : TxOutRef := ⟨ofHex "{("a%d" % (i - 1)) * 32}", 0⟩' for i in range(1, n + 1))
    inputs = ",\n                              ".join(f"⟨ref{i}, boxOwn {mparam}a{i} b{i}⟩" for i in range(1, n + 1))
    redeemer = ", ".join(f".Constr 0 [.B t{i}, .B z{i}]" for i in range(1, n + 1))
    refin = "refInputOwn P M" if v2 else "referenceInput"
    pooldefs = ('''/-- The pool's `ReferenceDatum`, boxes of 10 ₳ at mix_box `M`: validate_owner reads only `M`. -/
def refDatumOwn (M : ByteString) : Data :=
  .Constr 0 [.I 10000000, .B "", .B "", .I 0, .I 800000, .B M, .B mixLogicHash, .B feeHash]

/-- The pool's reference UTxO: 2 ₳ and its NFT `(P, lovejoin)` at reference_holder. -/
def refInputOwn (P M : ByteString) : TxInInfo :=
  ⟨⟨ofHex "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", 0⟩,
   ⟨⟨.ScriptCredential referenceHolderHash, none⟩,
    [(Data.B "", Data.Map [(Data.B "", Data.I 2000000)]), (Data.B P, Data.Map [(Data.B nftName, Data.I 1)])],
    .OutputDatum (refDatumOwn M), none⟩⟩

''' if v2 else "")
    boxdef = (f'''/-- A box of 10 ₳ at mix_box{" `M`" if v2 else ""}, its datum `(a, b)` inline. -/
def boxOwn {mbind}(a b : ByteString) : TxOut :=
  ⟨⟨.ScriptCredential {"M" if v2 else "mixBoxHash"}, none⟩, adaOwn 10000000, .OutputDatum (mixDatum a b), none⟩''')
    header = ("import Lovejoin.V2.Mix\nimport Lovejoin.Template.Launch" if v2 else "import Lovejoin.Logic")
    opens = ("open Lovejoin.Template (nftName)\n" if v2 else "")
    write(f"{prefix}.lean", f'''{header}

/-! {"v2" if v2 else "The classic pool"}'s Owner withdrawal of {n} box{"es" if n > 1 else ""}, for {what}: the boxes `(a1, b1)`{f" to `(a{n}, b{n})`" if n > 1 else ""}
at mix_box, a payer's key input beside them, and two outputs, a Seedelf register `(g, u)`
of `amt` at the wallet contract `s` and `ch` of change to the key `kc`.{" The pool's NFT policy `P` and mix_box `M` are parameters too, for mix_logic's template." if v2 else " The classic pool's own bytes, reference input and mix_box."}
Written by `gen-lovejoin-owner.py`. -/

namespace {ns}
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open CardanoLedgerApi.V3
open Seedelf.V1 (emptyTx ofHex)
{opens}
/-- `n` lovelace alone. -/
def adaOwn (n : Integer) : Value := [(Data.B "", Data.Map [(Data.B "", Data.I n)])]

{pooldefs}{boxdef}

/-- The boxes' references, then the payer's. -/
{refs}
def payerRef : TxOutRef := ⟨ofHex "{"f0" * 32}", 0⟩

/-- The withdrawal's outputs: a Seedelf register `(g, u)` of `amt` at the wallet contract
`s`, then `ch` of change to `kc`. -/
def ownOutputs {ctxbind} : List TxOut :=
  [⟨⟨.ScriptCredential s, none⟩, adaOwn amt, .OutputDatum (.Constr 0 [.B g, .B u]), none⟩,
   ⟨⟨.PubKeyCredential kc, none⟩, adaOwn ch, .NoOutputDatum, none⟩]

/-- The withdrawal: the boxes, then `pin` lovelace at the key `kp`; box i's proof `(ti, zi)`. -/
def ownCtx {poolbind}({pts} {prf} : ByteString) {outbind} : ScriptContext :=
  let tx := {{ emptyTx with
    txInfoInputs          := [{inputs},
                              ⟨payerRef, ⟨⟨.PubKeyCredential kp, none⟩, adaOwn pin, .NoOutputDatum, none⟩⟩],
    txInfoReferenceInputs := [{refin}],
    txInfoOutputs         := ownOutputs {ctxargs},
    txInfoWdrl            := [(.ScriptCredential mixLogicHash, 0)] }}
  ⟨tx, .Constr 0 [.List [{redeemer}]], .RewardingScript (.ScriptCredential mixLogicHash)⟩

end {ns}
''')
    reflist = ", ".join(f"IsData.toData ref{i}" for i in range(1, n + 1)) + ", IsData.toData payerRef"
    accepts = " &&\n    ".join(f"(wellFormed a{i} b{i} && proofHolds {mparam}{ctxargs} a{i} b{i} t{i} z{i})" for i in range(1, n + 1))
    argsbody = (f"[toTerm P, toTerm nftName, toTerm (ownCtx P M {pts} {prf} {outargs})]" if v2
                else f"[toTerm (ownCtx {pts} {prf} {outargs})]")
    write(f"{prefix}Spec.lean", f'''import {mod}
import Lovejoin.Logic

/-! {"v2" if v2 else "The classic pool"}'s Owner withdrawal of {n}, for {what}, its spec: validate_owner's `ctx`
over this transaction's outputs and every input's reference{", with `M` as the pool's" if v2 else ""}, then each
box's Schnorr proof against it (`Lovejoin.Classic.schnorrVerifies`). A malformed box isn't
one of validate_owner's (`collect_well_formed_mix_inputs` skips it), so each box's check is
`wellFormed` and its proof. Written by `gen-lovejoin-owner.py`. -/

namespace {ns}
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.Crypto.Hash
open PlutusCore.UPLC.Term (Term)
open Lovejoin.Classic (schnorrVerifies wellFormed serialised)
{opens}
/-- validate_owner's `ctx`: `blake2b_256(serialise(outputs) ‖ serialise(input refs) ‖ mix_box)`. -/
def ctxOwn {mbind}{ctxbind} : Option ByteString :=
  match serialised (IsData.toData (ownOutputs {ctxargs})), serialised (Data.List [{reflist}]) with
  | some o, some r => some (blake2b_256 (appendByteString (appendByteString o r) {"M" if v2 else "mixBoxHash"}))
  | _, _ => none

/-- A box's proof verifies against this transaction's `ctx`. -/
def proofHolds {mbind}{ctxbind} (a b t z : ByteString) : Bool :=
  match ctxOwn {mparam}{ctxargs} with
  | some ctx => schnorrVerifies a b t z ctx
  | none => false

/-- validate_owner: every box well-formed, and its proof verifies. -/
def ownerAcceptsOwn {mbind}({pts} {prf} : ByteString) {ctxbind} : Bool :=
  {accepts}

def argsOwn {poolbind}({pts} {prf} : ByteString) {outbind} : List Term :=
  {argsbody}

end {ns}
''')
    # the concrete runs: honest proofs
    lets = []
    for i in range(1, n + 1):
        lets.append(f"  let b{i} := bls12_381_G1_compress (bls12_381_G1_scalarMul (0x5eed0e1f + {i}) G)")
    lets.append(f"  let ctx ← ctxOwn {'mixBoxHash ' if v2 else ''}{'kS kG kU 20000000 kC 1000000'}")
    for i in range(1, n + 1):
        lets.append(f"  let (t{i}, z{i}) ← prove (0x5eed0e1f + {i}) (0x1234567 + {i}) b{i} ctx")
    hpts = " ".join(f"g1 b{i}" for i in range(1, n + 1))
    hlist = ", ".join(f"b{i}, t{i}, z{i}" for i in range(1, n + 1))
    hpat = ", ".join(f"b{i}, t{i}, z{i}" for i in range(1, n + 1))
    hprf = " ".join(f"t{i} z{i}" for i in range(1, n + 1))
    hprf_z = hprf.replace("z1", "zOneOwn", 1)
    hpat_z = hpat.replace("z1", "_", 1)
    hprf_sw = (" ".join([f"t2 z2", f"t1 z1"] + [f"t{i} z{i}" for i in range(3, n + 1)]) if n >= 2 else None)
    pool_c = "nftPolicy mixBoxHash " if v2 else ""
    m_c = "mixBoxHash " if v2 else ""
    if v2:
        run = lambda prfs, ch: f"stepsWith mixLogicTemplate [toTerm nftPolicy, toTerm nftName] (ownCtx {pool_c}{hpts} {prfs} kP 3000000 kS kG kU 20000000 kC {ch}) 60000"
    else:
        run = lambda prfs, ch: f"stepsUsed mixLogic (ownCtx {hpts} {prfs} kP 3000000 kS kG kU 20000000 kC {ch}) 60000"
    spec = lambda prfs, ch: f"ownerAcceptsOwn {m_c}{hpts} {prfs} kS kG kU 20000000 kC {ch}"
    evals = [f'| some [{hpat}] => s!"{tag}, honest:          {{{run(hprf, "1000000")}}}, spec {{{spec(hprf, "1000000")}}}"',
             f'| some [{hpat_z}] => s!"{tag}, z1 changed:      {{{run(hprf_z, "1000000")}}}, spec {{{spec(hprf_z, "1000000")}}}"',
             f'| some [{hpat}] => s!"{tag}, change + 1:      {{{run(hprf, "1000001")}}}, spec {{{spec(hprf, "1000001")}}}"']
    if hprf_sw:
        evals.append(f'| some [{hpat}] => s!"{tag}, proofs swapped:  {{{run(hprf_sw, "1000000")}}}, spec {{{spec(hprf_sw, "1000000")}}}"')
    evaltext = "\n\n".join(f"#eval match honest with\n  {e}\n  | _ => \"{tag}: no honest proofs\"" for e in evals)
    stepsimports = "import Lovejoin.Template.Steps" if v2 else "import Lovejoin.Steps"
    stepsopen = "open Lovejoin.Template (stepsWith nftName)\n" if v2 else "open Seedelf.V1 (stepsUsed)\n"
    write(f"{prefix}Steps.lean", f'''import {mod}Spec
{stepsimports}

/-! {"v2" if v2 else "The classic pool"}'s Owner withdrawal of {n}, concretely, {"on mix_logic's template at the test launch" if v2 else "on the classic pool's own bytes"}:
honest proofs, made with the builtins' own implementations (box i is `(g1, x·g1)`,
x = 0x5eed0e1f + i, nonce 0x1234567 + i, every proof bound to this transaction), must
halt with the spec `true`. That's the passing run the theorems pair with, and its step
count sizes their limit, {limit}. With box 1's `z` changed, the change a lovelace more (the
same proofs, so they're bound to other outputs){", or the first two boxes' proofs swapped" if n >= 2 else ""}, it
must error and the spec say `false`. Written by `gen-lovejoin-owner.py`. -/

namespace {ns}
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Crypto.BLS12_381.G1
open PlutusCore.UPLC.BuiltinFunctions.Bitwise (byteStringToIntegerOpaque)
open Lovejoin.Classic (fsHashSchnorr q)
open Seedelf.V1 (g1 ofHex)
{stepsopen}
def kP : ByteString := ofHex "{"11" * 28}"
def kS : ByteString := ofHex "{"22" * 28}"
def kC : ByteString := ofHex "{"33" * 28}"
/-- The Seedelf register's points: any two 48-byte strings (validate_owner only hashes them). -/
def kG : ByteString := g1
def kU : ByteString := ofHex "{"a5" * 48}"
def zOneOwn : ByteString := ofHex "{"00" * 31}01"

/-- The Schnorr proof `(t, z)` for the box `(g1, x·g1)` with nonce `r`, bound to `ctx`. -/
def prove (x r : Integer) (b ctx : ByteString) : Option (ByteString × ByteString) := do
  let G ← (bls12_381_G1_uncompress g1).toOption
  let t := bls12_381_G1_compress (bls12_381_G1_scalarMul r G)
  let c := Int.fmod (.ofNat (byteStringToIntegerOpaque true (fsHashSchnorr g1 b t ctx).data)) q
  let z ← (PlutusCore.Bitwise.integerToByteString true 32 (Int.fmod (r + c * x) q)).toOption
  pure (t, ⟨z⟩)

/-- The boxes' points and honest proofs, box by box. -/
def honest : Option (List ByteString) := do
  let G ← (bls12_381_G1_uncompress g1).toOption
{chr(10).join(lets)}
  pure [{hlist}]

{evaltext}

end {ns}
''')
    binder = f"∀ {poolbind}({pts} {prf} : ByteString) {outbind}"
    allargs = f"{pool}{pts} {prf} {outargs}"
    thms = []
    for i in range(1, n + 1):
        thms.append(f'''/-- A withdrawal whose {WORDS[i]} box is well-formed and its proof doesn't verify fails. -/
theorem {tag}_needs_the_{WORDS[i]}_box_proof :
    {binder},
      wellFormed a{i} b{i} = true → proofHolds {mparam}{ctxargs} a{i} b{i} t{i} z{i} = false →
        isUnsuccessful ({prop}Boxes.prop {allargs}) := by
  blaster (timeout: 540)''')
    write(f"{prefix}Boxes.lean", f'''import {mod}Spec
import Blaster

/-! {"v2" if v2 else "The classic pool"}'s Owner withdrawal of {n}, for {what}: no well-formed box leaves
without its own proof, bound to this transaction's outputs and inputs, whatever{" the pool," if v2 else ""}
the boxes' points, the proofs, the payer's input and both outputs are. One theorem per
box. The passing run is `{mod}Steps`'. Written by `gen-lovejoin-owner.py`. -/

namespace {ns}
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)

#prep_uplc {prop}Boxes {script} argsOwn {limit}

{chr(10).join([chr(10) + t if k else t for k, t in enumerate(thms)])}

end {ns}
''')
    wf = " → ".join(f"wellFormed a{i} b{i} = true" for i in range(1, n + 1))
    sane = 'P ≠ "" → ' if v2 else ""
    write(f"{prefix}Passes.lean", f'''import {mod}Spec
import Blaster

/-! {"v2" if v2 else "The classic pool"}'s Owner withdrawal of {n}, for {what}, the converse: well-formed boxes
whose proofs all verify leave{", given the NFT's policy isn't ADA's (`read_reference_datum` can't find it there)" if v2 else ""}.
With `{mod}Boxes`, a withdrawal of {n} well-formed boxes succeeds iff
`ownerAcceptsOwn`. Written by `gen-lovejoin-owner.py`. -/

namespace {ns}
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)

#prep_uplc {prop}Passes {script} argsOwn {limit}

/-- A withdrawal of {n} well-formed box{"es" if n > 1 else ""} whose proofs all verify succeeds. -/
theorem {tag}_passes_with_every_proof :
    {binder},
      {sane}{wf} →
      ownerAcceptsOwn {mparam}{pts} {prf} {ctxargs} = true →
        isSuccessful ({prop}Passes.prop {allargs}) := by
  blaster (timeout: 540)

end {ns}
''')
    return [mod, f"{mod}Spec", f"{mod}Steps", f"{mod}Boxes", f"{mod}Passes"]


mods = []
for kind, n in FAMILIES:
    mods += family(kind, n)
print(" ".join(mods))
