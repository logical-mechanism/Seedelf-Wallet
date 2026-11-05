import Lovejoin.AnyTx.MixAda3
import Blaster

/-! Composition of the two validators on the same three-box ADA Mix transaction.
The transaction spends one fee shard, pays exactly three box outputs and one fee
output, includes mix_logic's zero withdrawal and both redeemers. Other TxInfo fields
are arbitrary. This verifies this layout; ledger routing and budget remain assumptions. -/
namespace Lovejoin.AnyTx.FeeMix
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (returnsUnit spendIn)
open Lovejoin.Classic (wellFormed)
open Lovejoin.Template (nftName)
open Lovejoin.AnyTx
open Lovejoin.AnyTx.OwnerOne (Fields)
open Lovejoin.AnyTx.OwnerTwo (BoxFields)
open Lovejoin.AnyTx.MixAda3 (Proofs boxOut)
open Lovejoin.V2 (branchHolds)
open Lovejoin.V2.Any3 (proofsRedeemerPool challengeHoldsPool mixAcceptsPool)

-- The redeemer-map keys below are the ledger model's encodings, checked by reduction.
example (L : ByteString) :
    Data.Constr 2 [.Constr 1 [.B L]] =
      IsData.toData (show CardanoLedgerApi.V3.ScriptPurpose from .Rewarding (.ScriptCredential L)) := rfl
example (ref : CardanoLedgerApi.V3.TxOutRef) :
    Data.Constr 1 [IsData.toData ref] =
      IsData.toData (show CardanoLedgerApi.V3.ScriptPurpose from .Spending ref) := rfl

/-- The exact same TxInfo is supplied to both scripts. -/
def info (P M L F : ByteString) (bl cap fi fo fee : Integer)
    (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 : ByteString)
    (f : Fields) (bx2 bx3 : BoxFields) (p : Proofs) : Data :=
  let red := proofsRedeemerPool p.t011 p.t111 p.c11 p.z11 p.t012 p.t112 p.c12 p.z12 p.t013 p.t113 p.c13 p.z13
    p.t021 p.t121 p.c21 p.z21 p.t022 p.t122 p.c22 p.z22 p.t023 p.t123 p.c23 p.z23
    p.t031 p.t131 p.c31 p.z31 p.t032 p.t132 p.c32 p.z32 p.t033 p.t133 p.c33 p.z33
  let feeInput := input f.keyRef (.Constr 1 [.B F]) (.Constr 1 []) (adaValue fi) (.Constr 2 [.Constr 0 []]) (.Constr 1 [])
  let feeOut := .Constr 0 [.Constr 0 [.Constr 1 [.B F], .Constr 1 []], adaValue fo, .Constr 2 [.Constr 0 []], .Constr 1 []]
  let ins := .List [boxIn f.boxRef M f.boxStake f.boxValue f.boxScript a1 b1,
    boxIn bx2.ref M bx2.stake bx2.value bx2.script a2 b2,
    boxIn bx3.ref M bx3.stake bx3.value bx3.script a3 b3, feeInput]
  let refs := .List [carrierRef f.carrierRef f.carrierAddr (.Map [(.B "", .I 2000000)]) f.carrierScript
    P M bl "" "" 0 cap L F]
  let outputs := .List [boxOut M bl oa1 ob1, boxOut M bl oa2 ob2, boxOut M bl oa3 ob3, feeOut]
  .Constr 0 [ins, refs, outputs, .I fee, f.tx.mint, f.tx.certs,
    .Map [(.Constr 1 [.B L], .I 0)], f.tx.validRange, f.sigs,
    .Map [(.Constr 1 [f.keyRef], .Constr 0 []), (.Constr 2 [.Constr 1 [.B L]], red)],
    f.tx.datums, f.tx.txId, f.tx.votes, f.tx.proposals, f.tx.treasury, f.tx.donation]

def mixArgs (P M L F : ByteString) (bl cap fi fo fee : Integer)
    (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 : ByteString)
    (f : Fields) (bx2 bx3 : BoxFields) (p : Proofs) : List Term :=
  let red := proofsRedeemerPool p.t011 p.t111 p.c11 p.z11 p.t012 p.t112 p.c12 p.z12 p.t013 p.t113 p.c13 p.z13
    p.t021 p.t121 p.c21 p.z21 p.t022 p.t122 p.c22 p.z22 p.t023 p.t123 p.c23 p.z23
    p.t031 p.t131 p.c31 p.z31 p.t032 p.t132 p.c32 p.z32 p.t033 p.t133 p.c33 p.z33
  [toTerm P, toTerm nftName, toTerm (.Constr 0 [info P M L F bl cap fi fo fee a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 f bx2 bx3 p,
    red, .Constr 2 [.Constr 1 [.B L]]] : Data)]

def feeArgs (P M L F : ByteString) (bl cap fi fo fee : Integer)
    (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 : ByteString)
    (f : Fields) (bx2 bx3 : BoxFields) (p : Proofs) : List Term :=
  [toTerm P, toTerm nftName, toTerm (spendIn (info P M L F bl cap fi fo fee a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 f bx2 bx3 p)
    (.Constr 0 []) f.keyRef (.Constr 0 [.Constr 0 []]))]

#prep_uplc composedMix mixLogicTemplate mixArgs 60000
#prep_uplc composedFee feeContractTemplate feeArgs 20000

theorem incorrect_fee_fails (P M L F : ByteString) (bl cap fi fo fee : Integer)
    (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 : ByteString) (f : Fields) (bx2 bx3 : BoxFields) (p : Proofs) :
  (fi - fo ≠ fee ∨ fee > cap) →
  isUnsuccessful (composedFee.prop P M L F bl cap fi fo fee a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 f bx2 bx3 p) := by blaster (timeout: 540)

theorem correct_fee_passes (P M L F : ByteString) (bl cap fi fo fee : Integer)
    (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 : ByteString) (f : Fields) (bx2 bx3 : BoxFields) (p : Proofs) :
  P ≠ "" → M ≠ F → f.boxRef ≠ f.keyRef → bx2.ref ≠ f.keyRef → bx3.ref ≠ f.keyRef →
  fi - fo = fee → fee ≤ cap →
  returnsUnit (composedFee.prop P M L F bl cap fi fo fee a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 f bx2 bx3 p) := by blaster (timeout: 540)

theorem invalid_first_challenge_fails (P M L F : ByteString) (bl cap fi fo fee : Integer)
    (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 : ByteString) (f : Fields) (bx2 bx3 : BoxFields) (p : Proofs) :
  challengeHoldsPool M bl oa1 ob1 oa2 ob2 oa3 ob3 a1 b1 p.t011 p.t111 p.c11 p.t012 p.t112 p.c12 p.t013 p.t113 p.c13 = false →
  isUnsuccessful (composedMix.prop P M L F bl cap fi fo fee a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 f bx2 bx3 p) := by blaster (timeout: 540)

theorem valid_mix_passes (P M L F : ByteString) (bl cap fi fo fee : Integer)
    (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 : ByteString) (f : Fields) (bx2 bx3 : BoxFields) (p : Proofs) :
  P ≠ "" → M ≠ F → bl ≠ 0 → wellFormed a1 b1 = true → wellFormed a2 b2 = true → wellFormed a3 b3 = true →
  wellFormed oa1 ob1 = true → wellFormed oa2 ob2 = true → wellFormed oa3 ob3 = true →
  mixAcceptsPool M bl a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 p.t011 p.t111 p.c11 p.z11 p.t012 p.t112 p.c12 p.z12 p.t013 p.t113 p.c13 p.z13
    p.t021 p.t121 p.c21 p.z21 p.t022 p.t122 p.c22 p.z22 p.t023 p.t123 p.c23 p.z23
    p.t031 p.t131 p.c31 p.z31 p.t032 p.t132 p.c32 p.z32 p.t033 p.t133 p.c33 p.z33 = true →
  returnsUnit (composedMix.prop P M L F bl cap fi fo fee a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 f bx2 bx3 p) := by blaster (timeout: 540)

theorem invalid_box1_branch1 (P M L F : ByteString) (bl cap fi fo fee : Integer)
    (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 : ByteString) (f : Fields) (bx2 bx3 : BoxFields) (p : Proofs) :
  branchHolds a1 b1 oa1 ob1 p.t011 p.t111 p.c11 p.z11 = false →
  isUnsuccessful (composedMix.prop P M L F bl cap fi fo fee a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 f bx2 bx3 p) := by blaster (timeout: 540)

theorem invalid_box1_branch2 (P M L F : ByteString) (bl cap fi fo fee : Integer)
    (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 : ByteString) (f : Fields) (bx2 bx3 : BoxFields) (p : Proofs) :
  branchHolds a1 b1 oa2 ob2 p.t012 p.t112 p.c12 p.z12 = false →
  isUnsuccessful (composedMix.prop P M L F bl cap fi fo fee a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 f bx2 bx3 p) := by blaster (timeout: 540)

theorem invalid_box1_branch3 (P M L F : ByteString) (bl cap fi fo fee : Integer)
    (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 : ByteString) (f : Fields) (bx2 bx3 : BoxFields) (p : Proofs) :
  branchHolds a1 b1 oa3 ob3 p.t013 p.t113 p.c13 p.z13 = false →
  isUnsuccessful (composedMix.prop P M L F bl cap fi fo fee a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 f bx2 bx3 p) := by blaster (timeout: 540)

theorem invalid_box2_challenge (P M L F : ByteString) (bl cap fi fo fee : Integer)
    (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 : ByteString) (f : Fields) (bx2 bx3 : BoxFields) (p : Proofs) :
  challengeHoldsPool M bl oa1 ob1 oa2 ob2 oa3 ob3 a2 b2 p.t021 p.t121 p.c21 p.t022 p.t122 p.c22 p.t023 p.t123 p.c23 = false →
  isUnsuccessful (composedMix.prop P M L F bl cap fi fo fee a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 f bx2 bx3 p) := by blaster (timeout: 540)

theorem invalid_box2_branch1 (P M L F : ByteString) (bl cap fi fo fee : Integer)
    (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 : ByteString) (f : Fields) (bx2 bx3 : BoxFields) (p : Proofs) :
  branchHolds a2 b2 oa1 ob1 p.t021 p.t121 p.c21 p.z21 = false →
  isUnsuccessful (composedMix.prop P M L F bl cap fi fo fee a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 f bx2 bx3 p) := by blaster (timeout: 540)

theorem invalid_box2_branch2 (P M L F : ByteString) (bl cap fi fo fee : Integer)
    (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 : ByteString) (f : Fields) (bx2 bx3 : BoxFields) (p : Proofs) :
  branchHolds a2 b2 oa2 ob2 p.t022 p.t122 p.c22 p.z22 = false →
  isUnsuccessful (composedMix.prop P M L F bl cap fi fo fee a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 f bx2 bx3 p) := by blaster (timeout: 540)

theorem invalid_box2_branch3 (P M L F : ByteString) (bl cap fi fo fee : Integer)
    (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 : ByteString) (f : Fields) (bx2 bx3 : BoxFields) (p : Proofs) :
  branchHolds a2 b2 oa3 ob3 p.t023 p.t123 p.c23 p.z23 = false →
  isUnsuccessful (composedMix.prop P M L F bl cap fi fo fee a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 f bx2 bx3 p) := by blaster (timeout: 540)

theorem invalid_box3_challenge (P M L F : ByteString) (bl cap fi fo fee : Integer)
    (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 : ByteString) (f : Fields) (bx2 bx3 : BoxFields) (p : Proofs) :
  challengeHoldsPool M bl oa1 ob1 oa2 ob2 oa3 ob3 a3 b3 p.t031 p.t131 p.c31 p.t032 p.t132 p.c32 p.t033 p.t133 p.c33 = false →
  isUnsuccessful (composedMix.prop P M L F bl cap fi fo fee a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 f bx2 bx3 p) := by blaster (timeout: 540)

theorem invalid_box3_branch1 (P M L F : ByteString) (bl cap fi fo fee : Integer)
    (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 : ByteString) (f : Fields) (bx2 bx3 : BoxFields) (p : Proofs) :
  branchHolds a3 b3 oa1 ob1 p.t031 p.t131 p.c31 p.z31 = false →
  isUnsuccessful (composedMix.prop P M L F bl cap fi fo fee a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 f bx2 bx3 p) := by blaster (timeout: 540)

theorem invalid_box3_branch2 (P M L F : ByteString) (bl cap fi fo fee : Integer)
    (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 : ByteString) (f : Fields) (bx2 bx3 : BoxFields) (p : Proofs) :
  branchHolds a3 b3 oa2 ob2 p.t032 p.t132 p.c32 p.z32 = false →
  isUnsuccessful (composedMix.prop P M L F bl cap fi fo fee a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 f bx2 bx3 p) := by blaster (timeout: 540)

theorem invalid_box3_branch3 (P M L F : ByteString) (bl cap fi fo fee : Integer)
    (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 : ByteString) (f : Fields) (bx2 bx3 : BoxFields) (p : Proofs) :
  branchHolds a3 b3 oa3 ob3 p.t033 p.t133 p.c33 p.z33 = false →
  isUnsuccessful (composedMix.prop P M L F bl cap fi fo fee a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 f bx2 bx3 p) := by blaster (timeout: 540)


/-- Under the individual validators' preconditions, both accept the shared TxInfo. -/
theorem both_accept (P M L F : ByteString) (bl cap fi fo fee : Integer)
    (a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 : ByteString) (f : Fields) (bx2 bx3 : BoxFields) (p : Proofs)
    (hP : P ≠ "") (hMF : M ≠ F) (hr1 : f.boxRef ≠ f.keyRef)
    (hr2 : bx2.ref ≠ f.keyRef) (hr3 : bx3.ref ≠ f.keyRef)
    (hfee : fi - fo = fee) (hcap : fee ≤ cap) (hbl : bl ≠ 0)
    (w1 : wellFormed a1 b1 = true) (w2 : wellFormed a2 b2 = true) (w3 : wellFormed a3 b3 = true)
    (o1 : wellFormed oa1 ob1 = true) (o2 : wellFormed oa2 ob2 = true) (o3 : wellFormed oa3 ob3 = true)
    (proofs : mixAcceptsPool M bl a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3
      p.t011 p.t111 p.c11 p.z11 p.t012 p.t112 p.c12 p.z12 p.t013 p.t113 p.c13 p.z13
      p.t021 p.t121 p.c21 p.z21 p.t022 p.t122 p.c22 p.z22 p.t023 p.t123 p.c23 p.z23
      p.t031 p.t131 p.c31 p.z31 p.t032 p.t132 p.c32 p.z32 p.t033 p.t133 p.c33 p.z33 = true) :
    returnsUnit (composedFee.prop P M L F bl cap fi fo fee a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 f bx2 bx3 p) ∧
    returnsUnit (composedMix.prop P M L F bl cap fi fo fee a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 f bx2 bx3 p) :=
  ⟨correct_fee_passes P M L F bl cap fi fo fee a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 f bx2 bx3 p hP hMF hr1 hr2 hr3 hfee hcap,
   valid_mix_passes P M L F bl cap fi fo fee a1 b1 a2 b2 a3 b3 oa1 ob1 oa2 ob2 oa3 ob3 f bx2 bx3 p hP hMF hbl w1 w2 w3 o1 o2 o3 proofs⟩

end Lovejoin.AnyTx.FeeMix
