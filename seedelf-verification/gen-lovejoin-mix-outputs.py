#!/usr/bin/env python3
"""Writes what v2's Mix must pay, for every pool (chunk 42): `V2/MixOutputs` and `V2/MixDatums`
take it at the test launch with two boxes; these take it to mix_logic's template, at every
family `V2/MixAny*` and `gen-lovejoin-mix.py` cover (ADA and token pools, n = 2 to 4).

Each theorem keeps the pool's parameters, every box's points and every proof field symbolic,
so it holds whatever the proofs say, in every pool of that kind. A Mix of n fails if one of
its first n outputs isn't at mix_box with no stake credential or reference script, holds
other than exactly the box value, or carries no well-formed inline datum; if it has fewer
than n outputs; or if a later output is another box at mix_box. That's walk_outputs.

Per family: the builders (`Mix{tag}Out`: the scenario's Mix with its outputs given, which
is the scenario's own with its outputs, by `rfl`), their concrete runs (`Mix{tag}OutSteps`)
and the theorems (`Mix{tag}Outputs`, `Mix{tag}Datums`).

    ./gen-lovejoin-mix-outputs.py   writes the modules and prints their names for check.sh
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
FAMILIES = [("ada", 2), ("ada", 3), ("ada", 4), ("tok", 2), ("tok", 3), ("tok", 4)]
# The families' step limits: MixAny's (by hand) and gen-lovejoin-mix.py's.
LIMITS = {("ada", 2): 20000, ("ada", 3): 40000, ("ada", 4): 60000,
          ("tok", 2): 25000, ("tok", 3): 45000, ("tok", 4): 70000}
WORDS = {1: "first", 2: "second", 3: "third", 4: "fourth"}
# The KATs' launches (test_fixtures.ak): boxes of 10 ₳, or 2 ₳ and 1,000,000 of 3434…'s TOKEN.
KAT_POOL = {"ada": ("10000000",), "tok": ("2000000", "tokPolicy", "tokName", "1000000")}


def write(path, text):
    open(os.path.join(HERE, path), "w").write(text)


def pool(kind):
    """The pool's parameters, as binders and as arguments."""
    if kind == "ada":
        return "(bl : Integer)", "bl"
    return "(bl : Integer) (tp tn : ByteString) (tq : Integer)", "bl tp tn tq"


def value(kind, bl, tp="tp", tn="tn", tq="tq", extra=None):
    """A box out's value: `bl` lovelace, `tq` of `(tp, tn)` in a token pool, then `extra`."""
    pairs = [f'(Data.B "", Data.Map [(Data.B "", Data.I {bl})])']
    if kind == "tok":
        pairs.append(f"(Data.B {tp}, Data.Map [(Data.B {tn}, Data.I {tq})])")
    if extra:
        pairs.append(extra)
    return "[" + ", ".join(pairs) + "]"


def family(kind, n):
    hand = (kind, n) == ("ada", 2)
    tag = "Any" if hand else f"{'Any' if kind == 'ada' else 'Tok'}{n}"
    tl = tag.lower()
    mod = f"Lovejoin.V2.Mix{tag}"
    sfx = "Any" if hand else "Pool"
    box, ctx, ref = f"box{sfx}", f"mixCtx{sfx}", f"refInput{sfx}"
    red = "proofsRedeemer" if hand else "proofsRedeemerPool"
    args = "anyArgs" if hand else "argsPool"
    limit = LIMITS[(kind, n)]
    what = "ADA pool" if kind == "ada" else "token pool"
    pbind, pargs = pool(kind)
    rng = range(1, n + 1)
    inpts = " ".join(f"a{i} b{i}" for i in rng)
    outpts = " ".join(f"oa{j} ob{j}" for j in rng)
    fields = " ".join(f"t0{i}{j} t1{i}{j} c{i}{j} z{i}{j}" for i in rng for j in rng)
    without = lambda j: " ".join(f"oa{k} ob{k}" for k in rng if k != j)
    scen = lambda j: f"{box} M {pargs} oa{j} ob{j}"
    head = f"(P M : ByteString) {pbind} ({inpts}"
    redeemer = f"({red} {fields})"
    inputs = ",\n                              ".join(
        f'⟨⟨ofHex "{("a%d" % i) * 32}", 0⟩, {box} M {pargs} a{i + 1} b{i + 1}⟩' for i in range(n))
    applied = lambda outs: f"[toTerm P, toTerm nftName, toTerm (mixCtxOuts P M {pargs} {inpts}\n    {outs}\n    {redeemer})]"
    boxes = lambda f: "[" + ", ".join(f(j) for j in rng) + ", change]"
    defs = []
    defs.append(f'''/-- The Mix with box out j at `cj`, stake `sj` and reference script `rj`. -/
def addressArgs {head} {outpts} {fields} : ByteString)
    ({" ".join(f"c{j}" for j in rng)} : Credential) ({" ".join(f"s{j}" for j in rng)} : Option StakingCredential)
    ({" ".join(f"r{j}" for j in rng)} : Option ByteString) : List Term :=
  {applied(boxes(lambda j: f"outWith c{j} s{j} (boxPairs {pargs}) (.OutputDatum (mixDatum oa{j} ob{j})) r{j}"))}''')
    if kind == "ada":
        vbind = f"({' '.join(f'l{j}' for j in rng)} : Integer)"
        vval = lambda j: value(kind, f"l{j}")
    else:
        vbind = f"({' '.join(f'l{j}' for j in rng)} {' '.join(f'q{j}' for j in rng)} : Integer)"
        vval = lambda j: value(kind, f"l{j}", tq=f"q{j}")
    defs.append(f'''/-- The Mix with box out j holding `lj` lovelace{" and `qj` of the pool's token" if kind == "tok" else ""}. -/
def valueArgs {head} {outpts} {fields} : ByteString) {vbind} : List Term :=
  {applied(boxes(lambda j: f"outWith (.ScriptCredential M) none {vval(j)} (.OutputDatum (mixDatum oa{j} ob{j})) none"))}''')
    extra = "(Data.B p, Data.Map [(Data.B nm, Data.I q)])"
    for j in rng:
        tok = lambda k, j=j: (f"outWith (.ScriptCredential M) none {value(kind, 'bl', extra=extra)} (.OutputDatum (mixDatum oa{k} ob{k})) none"
                              if k == j else scen(k))
        defs.append(f'''/-- The Mix with its {WORDS[j]} box out holding `q` of `(p, nm)` beside the box value. -/
def tokenArgs{j} {head} {outpts} {fields} : ByteString) (p nm : ByteString) (q : Integer) : List Term :=
  {applied(boxes(tok))}''')
    defs.append(f'''/-- The Mix with only its first {'box' if n == 2 else str(n - 1) + ' boxes'} out, and no other output. -/
def fewerArgs {head} {without(n)} {fields} : ByteString) : List Term :=
  {applied("[" + ", ".join(scen(j) for j in range(1, n)) + "]")}''')
    defs.append(f'''/-- The Mix with another box at mix_box, `(xa, xb)`, after its {n} boxes out. -/
def tailArgs {head} {outpts} {fields} : ByteString) (xa xb : ByteString) : List Term :=
  {applied("[" + ", ".join(scen(j) for j in rng) + f", {box} M {pargs} xa xb, change]")}''')
    for j in rng:
        inl = lambda k, j=j: f"outWith (.ScriptCredential M) none (boxPairs {pargs}) od none" if k == j else scen(k)
        defs.append(f'''/-- The Mix with its {WORDS[j]} box out's datum `od`. -/
def inlineArgs{j} {head} {without(j)} {fields} : ByteString) (od : OutputDatum) : List Term :=
  {applied(boxes(inl))}''')
    write(f"Lovejoin/V2/Mix{tag}Out.lean", f'''import {mod}Spec

/-! v2's Mix of {n}, for any v2 {what}, with its outputs given: the builders for
`V2.Mix{tag}Outputs` and `V2.Mix{tag}Datums`. With the scenario's outputs, `mixCtxOuts` is
`{ctx}` (`mixCtxOuts_is_the_mix`), so each theorem changes one thing in the Mix whose
iff the `V2.Mix{tag}` modules prove, and keeps the pool's parameters, every box's points and
every proof field symbolic. Written by `gen-lovejoin-mix-outputs.py`. -/

namespace Lovejoin.V2.{tag}
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open Seedelf.V1 (emptyTx ofHex)
open Lovejoin.Template (nftName)

/-- An output at `c` with stake `s`, holding `v`, its datum `d` and reference script `r`. -/
def outWith (c : Credential) (s : Option StakingCredential) (v : Value) (d : OutputDatum) (r : Option ByteString) : TxOut :=
  ⟨⟨c, s⟩, v, d, r⟩

/-- The box value as a box out holds it. -/
def boxPairs {pbind} : Value := {value(kind, "bl")}

/-- A datum that isn't inline: none, or by hash. -/
def notInline : OutputDatum → Bool
  | .OutputDatum _ => false
  | _ => true

/-- `{ctx}`'s Mix with its outputs given. -/
def mixCtxOuts {head} : ByteString) (outs : List TxOut) (redeemer : Data) : ScriptContext :=
  let tx := {{ emptyTx with
    txInfoInputs          := [{inputs}],
    txInfoReferenceInputs := [{ref} P {pargs} M],
    txInfoOutputs         := outs,
    txInfoFee             := 200000,
    txInfoWdrl            := [(.ScriptCredential mixLogicHash, 0)] }}
  ⟨tx, redeemer, .RewardingScript (.ScriptCredential mixLogicHash)⟩

/-- With the scenario's outputs, it's the scenario's Mix. -/
theorem mixCtxOuts_is_the_mix {head} {outpts} : ByteString) (redeemer : Data) :
    mixCtxOuts P M {pargs} {inpts} {boxes(scen)} redeemer = {ctx} P M {pargs} {inpts} {outpts} redeemer := rfl

{chr(10).join(chr(10).join([d, ""]) for d in defs).rstrip()}

end Lovejoin.V2.{tag}
''')
    # the concrete runs, at the test launch with the KAT's points and proofs
    kp = KAT_POOL[kind]
    kpool = " ".join(kp)
    if hand:
        kins = "inA1 inB1 inA2 inB2"
        kouts = [("outA1", "outB1"), ("outA2", "outB2")]
    else:
        kins = " ".join(f"katA{i} katB{i}" for i in rng)
        kouts = [(f"katOA{j}", f"katOB{j}") for j in rng]
    kfields = " ".join(f"katT0{i}{j} katT1{i}{j} katC{i}{j} katZ{i}{j}" for i in rng for j in rng)
    kbox = lambda j: f"{box} mixBoxHash {kpool} {kouts[j - 1][0]} {kouts[j - 1][1]}"
    kval = lambda **kw: value(kind, kp[0], *(kp[1:] if kind == "tok" else ()), **kw)
    kout = lambda j, v, d: f"outWith (.ScriptCredential mixBoxHash) none {v} {d} none"
    inline = lambda j: f"(.OutputDatum (mixDatum {kouts[j - 1][0]} {kouts[j - 1][1]}))"
    lst = lambda xs: "[" + ", ".join(xs) + "]"
    every = [kbox(j) for j in rng]
    more = str(int(kp[0]) + 1)
    lovelace_more = (value(kind, more) if kind == "ada" else value(kind, more, kp[1], kp[2], kp[3]))
    runs = [
        ("honest", lst(every + ["change"])),
        ("box 1 at a key", lst([f"outWith (.PubKeyCredential userKey) none (boxPairs {kpool}) {inline(1)} none"] + every[1:] + ["change"])),
        (f"box {n} a lovelace more", lst(every[:-1] + [kout(n, lovelace_more, inline(n))] + ["change"])),
        ("box 1 another token", lst([kout(1, kval(extra='(Data.B (ofHex "' + "77" * 28 + '"), Data.Map [(Data.B "X", Data.I 1)])'), inline(1))] + every[1:] + ["change"])),
        (f"only {n - 1} output{'s' if n > 2 else ''}", lst(every[:-1])),
        ("another box after", lst(every + [kbox(1), "change"])),
        ("box 1 by hash", lst([kout(1, f"(boxPairs {kpool})", '(.OutputDatumHash (ofHex "' + "00" * 32 + '"))')] + every[1:] + ["change"])),
        (f"box {n} no datum", lst(every[:-1] + [kout(n, f"(boxPairs {kpool})", ".NoOutputDatum")] + ["change"])),
        ("box 1 a = b", lst([f"{box} mixBoxHash {kpool} {kouts[0][1]} {kouts[0][1]}"] + every[1:] + ["change"])),
    ]
    width = max(len(r[0]) for r in runs) + 2
    evals = "\n".join(f'#eval "{tag} out, {(name + ":").ljust(width)}" ++ runOut {outs}' for name, outs in runs)
    write(f"Lovejoin/V2/Mix{tag}OutSteps.lean", f'''import Lovejoin.V2.Mix{tag}Out
import Lovejoin.Template.Steps

/-! `V2.Mix{tag}Out`'s builders against Lovejoin's KAT, concretely, on mix_logic's template at
the test launch: with the scenario's outputs (`honest`) the Mix must halt, the passing run
the theorems pair with. Each line after changes one output, as a theorem in
`V2.Mix{tag}Outputs` or `V2.Mix{tag}Datums` does, and must error. Written by
`gen-lovejoin-mix-outputs.py`. -/

namespace Lovejoin.V2.{tag}
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open Seedelf.V1 (ofHex)
open Lovejoin.Template (stepsWith nftName)

/-- The KAT's Mix at the test launch, with its outputs given. -/
def runOut (outs : List TxOut) : String :=
  stepsWith mixLogicTemplate [toTerm nftPolicy, toTerm nftName]
    (mixCtxOuts nftPolicy mixBoxHash {kpool} {kins} outs ({red} {kfields})) 120000

{evals}

end Lovejoin.V2.{tag}
''')
    # the theorems
    binder = lambda pts, rest="": f"∀ {head} {pts} {fields} : ByteString){rest}"
    allargs = lambda pts, rest="": f"P M {pargs} {inpts} {pts} {fields}{rest}"
    cs, ss, rs = (" ".join(f"{x}{j}" for j in rng) for x in "csr")
    addr = " ∨ ".join(f"c{j} ≠ .ScriptCredential M ∨ s{j} ≠ none ∨ r{j} ≠ none" for j in rng)
    if kind == "ada":
        vals = " ∨ ".join(f"l{j} ≠ bl" for j in rng)
        vargs = " " + " ".join(f"l{j}" for j in rng)
    else:
        vals = " ∨ ".join(f"l{j} ≠ bl ∨ q{j} ≠ tq" for j in rng)
        vargs = " " + " ".join(f"l{j}" for j in rng) + " " + " ".join(f"q{j}" for j in rng)
    preps = [f"#prep_uplc appliedMix{tag}Address mixLogicTemplate addressArgs {limit}",
             f"#prep_uplc appliedMix{tag}Value mixLogicTemplate valueArgs {limit}"]
    preps += [f"#prep_uplc appliedMix{tag}Token{j} mixLogicTemplate tokenArgs{j} {limit}" for j in rng]
    preps += [f"#prep_uplc appliedMix{tag}Fewer mixLogicTemplate fewerArgs {limit}",
              f"#prep_uplc appliedMix{tag}Tail mixLogicTemplate tailArgs {limit}"]
    thms = [f'''/-- A Mix whose box out is anywhere but mix_box, or has a stake credential or a
reference script, fails: a key's address, another script's, mix_box's with a stake part. -/
theorem mix{tl}_pays_its_boxes_to_mix_box :
    {binder(outpts, f" ({cs} : Credential) ({ss} : Option StakingCredential) ({rs} : Option ByteString)")},
      ({addr}) →
        isUnsuccessful (appliedMix{tag}Address.prop {allargs(outpts, f" {cs} {ss} {rs}")}) := by
  blaster (timeout: 540)''',
            f'''/-- So does one whose box out holds other than the box value's {"lovelace" if kind == "ada" else "lovelace and token quantity"}. -/
theorem mix{tl}_boxes_hold_the_box_value :
    {binder(outpts, " " + vbind)},
      ({vals}) →
        isUnsuccessful (appliedMix{tag}Value.prop {allargs(outpts, vargs)}) := by
  blaster (timeout: 540)''']
    for j in rng:
        thms.append(f'''/-- Or whose {WORDS[j]} box out holds any token beside the box value. -/
theorem mix{tl}_{WORDS[j]}_box_holds_no_other_token :
    {binder(outpts, " (p nm : ByteString) (q : Integer)")},
      isUnsuccessful (appliedMix{tag}Token{j}.prop {allargs(outpts, " p nm q")}) := by
  blaster (timeout: 540)''')
    thms.append(f'''/-- A Mix of {n} with only {n - 1} output{'s' if n > 2 else ''} fails: walk_outputs needs a box out for each box in. -/
theorem mix{tl}_needs_every_box_out :
    {binder(without(n))},
      isUnsuccessful (appliedMix{tag}Fewer.prop {allargs(without(n))}) := by
  blaster (timeout: 540)''')
    thms.append(f'''/-- So does one paying another box to mix_box after its {n}: a box enters the pool only
with a proof. -/
theorem mix{tl}_pays_no_other_box_to_mix_box :
    {binder(outpts, " (xa xb : ByteString)")},
      isUnsuccessful (appliedMix{tag}Tail.prop {allargs(outpts, " xa xb")}) := by
  blaster (timeout: 540)''')
    write(f"Lovejoin/V2/Mix{tag}Outputs.lean", f'''import Lovejoin.V2.Mix{tag}Out
import Blaster

/-! No value leaves the pool in a Mix of {n}, for any v2 {what}: `V2.MixOutputs`, there at the
test launch with two boxes, here on mix_logic's template. Whatever the pool's parameters,
the boxes' points and the proofs are, a Mix fails unless its first {n} outputs are each at
mix_box, with no stake credential or reference script, holding exactly the box value, and
no later output is another box there. The passing run is `V2.Mix{tag}OutSteps`' honest
one, and `V2.Mix{tag}`'s iff is the same Mix (`mixCtxOuts_is_the_mix`). Written by
`gen-lovejoin-mix-outputs.py`. -/

namespace Lovejoin.V2.{tag}
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils

{chr(10).join(preps)}

{(chr(10) * 2).join(thms)}

end Lovejoin.V2.{tag}
''')
    wfs = " ∨ ".join(f"wellFormed oa{j} ob{j} = false" for j in rng)
    dpreps = [f"#prep_uplc appliedMix{tag}Datums mixLogicTemplate {args} {limit}"]
    dpreps += [f"#prep_uplc appliedMix{tag}Inline{j} mixLogicTemplate inlineArgs{j} {limit}" for j in rng]
    dthms = [f'''/-- A Mix whose box out's datum isn't two unequal 48-byte points fails. -/
theorem mix{tl}_boxes_carry_well_formed_datums :
    {binder(outpts)},
      ({wfs}) →
        isUnsuccessful (appliedMix{tag}Datums.prop {allargs(outpts)}) := by
  blaster (timeout: 540)''']
    for j in rng:
        dthms.append(f'''/-- So does one whose {WORDS[j]} box out's datum isn't inline. -/
theorem mix{tl}_{WORDS[j]}_box_datum_inline :
    {binder(without(j), " (od : OutputDatum)")},
      notInline od = true →
        isUnsuccessful (appliedMix{tag}Inline{j}.prop {allargs(without(j), " od")}) := by
  blaster (timeout: 540)''')
    write(f"Lovejoin/V2/Mix{tag}Datums.lean", f'''import Lovejoin.V2.Mix{tag}Out
import Blaster

/-! A Mix of {n}'s boxes out carry well-formed inline datums, for any v2 {what}: `V2.MixDatums`,
there at the test launch with two boxes, here on mix_logic's template, with every other
field symbolic. So every box the pool pays out is one a key can later withdraw. The
passing run is `V2.Mix{tag}OutSteps`' honest one. Written by `gen-lovejoin-mix-outputs.py`. -/

namespace Lovejoin.V2.{tag}
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)

{chr(10).join(dpreps)}

{(chr(10) * 2).join(dthms)}

end Lovejoin.V2.{tag}
''')
    return [f"{mod}Out", f"{mod}OutSteps", f"{mod}Outputs", f"{mod}Datums"]


all_mods = []
for kind, n in FAMILIES:
    all_mods += family(kind, n)
print(" ".join(all_mods))
