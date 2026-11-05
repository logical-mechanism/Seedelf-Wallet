import Lovejoin.V2.MixAnySteps
import Audit.V2.Common

/-! A generalization of v2's general Mix of two in an ADA pool (`V2.MixAny`): the same Mix
with one more input, a payer's 5 ₳ at a key, placed before, between and after the two boxes
(its reference sorting there, as the ledger orders inputs). mix_logic counts only inputs at
mix_box (`collect_well_formed_mix_inputs`), and a Mix's `ctx` hashes no input, so the iff
should hold unchanged; `Audit.V2.MixAnyPayer{Before,Between,After}` prove its first
"needs" theorem and Passes for each placement.

Here: the builders, the check that without the payer `auditMixCtxIns` is `mixCtxAny`
(`rfl`), the KAT's step count for each placement (printed), and `#guard`s that each halts
with unit within the modules' limit, 30000. -/

namespace Lovejoin.V2.Any
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.CekMachine (cekExecuteProgram)
open Seedelf.V1 (emptyTx ofHex)
open Lovejoin.Template (stepsWith nftName)
open Audit.V2

/-- The payer's output: 5 ₳ at a key, no datum. -/
def auditPayerOut : TxOut :=
  ⟨⟨.PubKeyCredential userKey, none⟩, [(Data.B "", Data.Map [(Data.B "", Data.I 5000000)])], .NoOutputDatum, none⟩

/-- The two boxes in, at `mixCtxAny`'s references. -/
def auditBoxIn1 (M : ByteString) (bl : Integer) (a b : ByteString) : TxInInfo :=
  ⟨⟨ofHex "a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0", 0⟩, boxAny M bl a b⟩
def auditBoxIn2 (M : ByteString) (bl : Integer) (a b : ByteString) : TxInInfo :=
  ⟨⟨ofHex "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1", 0⟩, boxAny M bl a b⟩

/-- The payer's input, its reference sorting before the boxes', between them, or after. -/
def auditPayerBefore : TxInInfo := ⟨⟨ofHex "0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f", 0⟩, auditPayerOut⟩
def auditPayerBetween : TxInInfo := ⟨⟨ofHex "a0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0", 0⟩, auditPayerOut⟩
def auditPayerAfter : TxInInfo := ⟨⟨ofHex "f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0", 0⟩, auditPayerOut⟩

/-- `mixCtxAny`'s Mix with its inputs given. -/
def auditMixCtxIns (P M : ByteString) (bl : Integer) (ins : List TxInInfo) (oa1 ob1 oa2 ob2 : ByteString) (redeemer : Data) : ScriptContext :=
  let tx := { emptyTx with
    txInfoInputs          := ins,
    txInfoReferenceInputs := [refInputAny P bl M],
    txInfoOutputs         := [boxAny M bl oa1 ob1, boxAny M bl oa2 ob2, change],
    txInfoFee             := 200000,
    txInfoWdrl            := [(.ScriptCredential mixLogicHash, 0)] }
  ⟨tx, redeemer, .RewardingScript (.ScriptCredential mixLogicHash)⟩

/-- Without the payer, it's the scenario's Mix. -/
theorem auditMixCtxIns_is_the_mix (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 : ByteString) (redeemer : Data) :
    auditMixCtxIns P M bl [auditBoxIn1 M bl a1 b1, auditBoxIn2 M bl a2 b2] oa1 ob1 oa2 ob2 redeemer = mixCtxAny P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 redeemer := rfl

/-- The template's arguments, the payer before the boxes. -/
def auditArgsBefore (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) : List Term :=
  [toTerm P, toTerm nftName, toTerm (auditMixCtxIns P M bl [auditPayerBefore, auditBoxIn1 M bl a1 b1, auditBoxIn2 M bl a2 b2] oa1 ob1 oa2 ob2
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

/-- Between them. -/
def auditArgsBetween (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) : List Term :=
  [toTerm P, toTerm nftName, toTerm (auditMixCtxIns P M bl [auditBoxIn1 M bl a1 b1, auditPayerBetween, auditBoxIn2 M bl a2 b2] oa1 ob1 oa2 ob2
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

/-- After them. -/
def auditArgsAfter (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) : List Term :=
  [toTerm P, toTerm nftName, toTerm (auditMixCtxIns P M bl [auditBoxIn1 M bl a1 b1, auditBoxIn2 M bl a2 b2, auditPayerAfter] oa1 ob1 oa2 ob2
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

#eval s!"payer before, the KAT:  {stepsWith mixLogicTemplate [toTerm nftPolicy, toTerm nftName] (auditMixCtxIns nftPolicy mixBoxHash 10000000 [auditPayerBefore, auditBoxIn1 mixBoxHash 10000000 inA1 inB1, auditBoxIn2 mixBoxHash 10000000 inA2 inB2] outA1 outB1 outA2 outB2 katRedeemer) 60000}"
#eval s!"payer between, the KAT: {stepsWith mixLogicTemplate [toTerm nftPolicy, toTerm nftName] (auditMixCtxIns nftPolicy mixBoxHash 10000000 [auditBoxIn1 mixBoxHash 10000000 inA1 inB1, auditPayerBetween, auditBoxIn2 mixBoxHash 10000000 inA2 inB2] outA1 outB1 outA2 outB2 katRedeemer) 60000}"
#eval s!"payer after, the KAT:   {stepsWith mixLogicTemplate [toTerm nftPolicy, toTerm nftName] (auditMixCtxIns nftPolicy mixBoxHash 10000000 [auditBoxIn1 mixBoxHash 10000000 inA1 inB1, auditBoxIn2 mixBoxHash 10000000 inA2 inB2, auditPayerAfter] outA1 outB1 outA2 outB2 katRedeemer) 60000}"

#guard auditHaltsUnit (cekExecuteProgram mixLogicTemplate.script (auditArgsBefore nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22) 30000)
#guard auditHaltsUnit (cekExecuteProgram mixLogicTemplate.script (auditArgsBetween nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22) 30000)
#guard auditHaltsUnit (cekExecuteProgram mixLogicTemplate.script (auditArgsAfter nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22) 30000)
#guard auditErrors (cekExecuteProgram mixLogicTemplate.script (auditArgsBetween nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 katT011 katT111 katC11 zOneAny katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22) 30000)

end Lovejoin.V2.Any
