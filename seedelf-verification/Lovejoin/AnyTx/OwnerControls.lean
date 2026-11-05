import Lovejoin.AnyTx.OwnerOne
import Lovejoin.V2.OwnAny1Steps

/-! Non-vacuity controls: an independently generated Schnorr proof for the existing
Owner vector succeeds in the generalized context; changing its scalar or an output fails. -/

namespace Lovejoin.AnyTx.OwnerControls
open CardanoLedgerApi.IsData.Class (IsData)
open PlutusCore.Data (Data)
open Seedelf.V1 (TxRest g1 endsWithUnit endsInError)
open Lovejoin.AnyTx
open Lovejoin.AnyTx.OwnerOne
open Lovejoin.V2.Own1
open Lovejoin.V2 (mixLogicHash referenceHolderHash nftPolicy mixBoxHash)

private def rest (change : PlutusCore.Integer.Integer) : TxRest :=
  ⟨.List [], .List [], IsData.toData (ownOutputs kS kG kU 20000000 kC change),
   .I 0, .Map [], .List [], .Map [], .I 0, .Map [], .Map [], .B "", .Map [], .List [], .I 0, .I 0⟩

private def fields (change : PlutusCore.Integer.Integer) : Fields :=
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

#guard match honest with
  | some [b, t, z] => endsWithUnit (ownerOne.exec nftPolicy mixBoxHash g1 b t z kP (fields 1000000))
  | _ => false
#guard match honest with
  | some [b, t, _] => endsInError (ownerOne.exec nftPolicy mixBoxHash g1 b t zOneOwn kP (fields 1000000))
  | _ => false
#guard match honest with
  | some [b, t, z] => endsInError (ownerOne.exec nftPolicy mixBoxHash g1 b t z kP (fields 1000001))
  | _ => false

#guard match honest with
  | some [b, t, z] =>
    endsInError (ownerOne.exec nftPolicy mixBoxHash g1 b t z kP
      { fields 1000000 with keyRef := refAt 3 })
  | _ => false

end Lovejoin.AnyTx.OwnerControls
