import Lovejoin.AnyTx.OwnerLayouts
import Lovejoin.AnyTx.OwnerTwo
import Lovejoin.V2.OwnAny2Steps

/-! Concrete passing and tampered runs for the new Owner layouts. -/
namespace Lovejoin.AnyTx.OwnerMoreControls
open CardanoLedgerApi.IsData.Class (IsData)
open PlutusCore.Data (Data)
open Seedelf.V1 (TxRest g1 endsWithUnit endsInError)
open Lovejoin.AnyTx
open Lovejoin.AnyTx.OwnerOne (Fields)
open Lovejoin.AnyTx.OwnerLayouts
open Lovejoin.AnyTx.OwnerTwo
open Lovejoin.V2 (mixLogicHash referenceHolderHash nftPolicy mixBoxHash)
open Lovejoin.V2.Own2

private def rest (change : PlutusCore.Integer.Integer) : TxRest :=
  ⟨.List [], .List [], IsData.toData (ownOutputs kS kG kU 20000000 kC change),
    .I 0, .Map [], .List [], .Map [], .I 0, .Map [], .Map [], .B "", .Map [], .List [], .I 0, .I 0⟩

def fields (change : PlutusCore.Integer.Integer) : Fields :=
  { tx := rest change
    sigs := .List []
    acct := .Constr 1 [.B mixLogicHash]
    boxRef := IsData.toData ref1
    boxStake := .Constr 1 []
    boxValue := adaValue 10000000
    boxScript := .Constr 1 []
    keyRef := IsData.toData payerRef
    keyStake := .Constr 1 []
    keyValue := adaValue 3000000
    keyDatum := .Constr 0 []
    keyScript := .Constr 1 []
    carrierRef := refAt 2
    carrierAddr := .Constr 0 [.Constr 1 [.B referenceHolderHash], .Constr 1 []]
    carrierScript := .Constr 1 [] }
def box2 : BoxFields :=
  { ref := IsData.toData ref2, stake := .Constr 1 [], value := adaValue 10000000, script := .Constr 1 [] }

def proofForRefs (refs : List Data) := do
  let b ← honestB (0x5eed0e1f + 1)
  let h ← ownerHash mixBoxHash (fields 1000000).tx.outputs refs
  let (t,z) ← proveFor (0x5eed0e1f + 1) (0x1234567 + 1) b h
  pure (b,t,z)

#guard match proofForRefs [(fields 1000000).boxRef] with
  | some (b,t,z) => endsWithUnit (soloOwner.exec nftPolicy mixBoxHash g1 b t z (fields 1000000))
  | _ => false
#guard match proofForRefs [(fields 1000000).boxRef] with
  | some (b,t,z) => endsInError (soloOwner.exec nftPolicy mixBoxHash g1 b t z (fields 1000001))
  | _ => false
#guard match proofForRefs [(fields 1000000).keyRef, (fields 1000000).boxRef] with
  | some (b,t,z) => endsWithUnit (keyFirstOwner.exec nftPolicy mixBoxHash g1 b t z kP (fields 1000000))
  | _ => false
#guard match proofForRefs [(fields 1000000).keyRef, (fields 1000000).boxRef] with
  | some (b,t,z) => endsInError (keyFirstOwner.exec nftPolicy mixBoxHash g1 b t z kP
      { fields 1000000 with keyRef := refAt 3 })
  | _ => false
#guard match honest with
  | some [b1,t1,z1,b2,t2,z2] => endsWithUnit
      (twoOwners.exec nftPolicy mixBoxHash g1 b1 g1 b2 t1 z1 t2 z2 kP (fields 1000000) box2)
  | _ => false
#guard match honest with
  | some [b1,t1,z1,b2,t2,z2] => endsInError
      (twoOwners.exec nftPolicy mixBoxHash g1 b1 g1 b2 t2 z2 t1 z1 kP (fields 1000000) box2)
  | _ => false
#guard match honest with
  | some [b1,t1,z1,b2,_,_] => endsInError
      (missingProof.exec nftPolicy mixBoxHash g1 b1 g1 b2 t1 z1 kP (fields 1000000) box2)
  | _ => false

end Lovejoin.AnyTx.OwnerMoreControls
