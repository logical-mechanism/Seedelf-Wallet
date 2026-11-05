import Lovejoin.AnyTx.Common
import Lovejoin.Template.AnyTxPurposes

/-! Concrete six-box withdrawal controls. These are evaluator checks over constructed
contexts, not a proof of ledger validity or a substitute for the unbounded loop proofs. -/
namespace Lovejoin.AnyTx.LogicLongControls
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.Data (Data)
open Seedelf.V1 (TxRest g1)
open Lovejoin.AnyTx
open Lovejoin.Template (nftName)
open Lovejoin.Template.AnyTx (endWith)

private def tx (outputs : Data) : TxRest :=
  ⟨.List [], .List [], outputs, .I 0, .Map [], .List [], .Map [], .I 0,
    .Map [], .Map [], .B "", .Map [], .List [], .I 0, .I 0⟩
private def refs : List Data := (List.range 6).map fun n => refAt (Int.ofNat n)
private def boxInputs (b : PlutusCore.ByteString.ByteString) : List Data :=
  refs.map fun r => boxIn r testM (.Constr 1 []) (adaValue 10000000) (.Constr 1 []) g1 b
private def carrier : Data :=
  carrierRef (refAt 20) (.Constr 0 [.Constr 1 [.B testL], .Constr 1 []])
    (.Map [(.B "", .I 2000000)]) (.Constr 1 []) testP testM 10000000 "" "" 0 800000 testL testL
private def outputs : Data := .List []
private def vector : Option (PlutusCore.ByteString.ByteString × Data) := do
  let b ← honestB 0x5eed0e20
  let h ← ownerHash testM outputs refs
  let (t,z) ← proveFor 0x5eed0e20 0x1234568 b h
  pure (b, proofData t z)
private def run (branch : PlutusCore.Integer.Integer) (ins : List Data) (outs : Data) (proofs : List Data) : String :=
  endWith mixLogicTemplate [toTerm testP, toTerm nftName]
    (.Constr 0 [withInputs (tx outs) (.List ins) (.List [carrier]) (.List []),
      .Constr branch [.List proofs], .Constr 2 [.Constr 1 [.B testL]]]) 300000

-- Six correctly bound Owner proofs pass; changed outputs or input references fail.
#guard match vector with
  | some (b,p) => run 0 (boxInputs b) outputs (List.replicate 6 p) == "unit"
  | none => false
#guard match vector with
  | some (b,p) => run 0 (boxInputs b) (.List [.I 1]) (List.replicate 6 p) == "error"
  | none => false
#guard match vector with
  | some (b,p) => run 0 (boxInputs b ++ [otherIn (refAt 10) 0 testKey (.Constr 1 [])
      (adaValue 3000000) (.Constr 0 []) (.Constr 1 [])]) outputs (List.replicate 6 p) == "error"
  | none => false
-- Both branches reject too few proofs for six boxes.
#guard match vector with
  | some (b,p) => run 0 (boxInputs b) outputs (List.replicate 5 p) == "error"
  | none => false
#guard match vector with
  | some (b,_) => run 1 (boxInputs b) outputs [] == "error"
  | none => false

-- A malformed first proof rejects without inspecting a long suffix.
#guard match vector with
  | some (b,_) => run 0 (boxInputs b) outputs (.I 42 :: List.replicate 50 (.I 1)) == "error"
  | none => false
#guard match vector with
  | some (b,_) => run 1 (boxInputs b) outputs (.I 42 :: List.replicate 50 (.I 1)) == "error"
  | none => false

-- A malformed proof or Mix branch also fails after long well-shaped prefixes.
#guard match vector with
  | some (b,p) => run 0 (boxInputs b) outputs (List.replicate 12 p ++ [.I 42, .I 1]) == "error"
  | none => false
#guard match vector with
  | some (b,_) => run 1 (boxInputs b) outputs
      (List.replicate 12 (.Constr 0 [.List []]) ++ [.I 42, .I 1]) == "error"
  | none => false
#guard match vector with
  | some (b,_) =>
    let validBranch : Data := .Constr 0 [.B "", .B "", .B "", .B ""]
    let badProof : Data := .Constr 0 [.List (List.replicate 12 validBranch ++ [.I 42])]
    run 1 (boxInputs b) outputs (List.replicate 12 (.Constr 0 [.List []]) ++ [badProof]) == "error"
  | none => false

end Lovejoin.AnyTx.LogicLongControls
