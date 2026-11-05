import Lovejoin.AnyTx.Reference
import Lovejoin.AnyTx.OwnerMoreControls
import Lovejoin.V2.OwnAny1Steps

/-! The same known-good Owner proof with varied NFT carrier inputs. -/
namespace Lovejoin.AnyTx.ReferenceControls
open PlutusCore.Data (Data)
open Seedelf.V1 (endsWithUnit endsInError g1)
open Lovejoin.AnyTx
open Lovejoin.AnyTx.Reference
open Lovejoin.AnyTx.OwnerOne
open Lovejoin.AnyTx.OwnerMoreControls (fields)
open Lovejoin.V2 (nftPolicy mixBoxHash)
open Lovejoin.V2.Own1

#guard match honest with
  | some [b,t,z] => endsWithUnit (ownerOne.exec nftPolicy mixBoxHash g1 b t z kP (fields 1000000))
  | _ => false
#guard match honest with
  | some [b,t,z] => endsInError (refAbsent.exec nftPolicy mixBoxHash g1 b t z kP (fields 1000000))
  | _ => false
#guard match honest with
  | some [b,t,z] => endsInError (refForeign.exec nftPolicy mixBoxHash g1 b t z kP testL (fields 1000000))
  | _ => false
#guard match honest with
  | some [b,t,z] => endsInError (refName.exec nftPolicy mixBoxHash g1 b t z kP "other" (fields 1000000))
  | _ => false
#guard match honest with
  | some [b,t,z] => endsInError (refQty.exec nftPolicy mixBoxHash g1 b t z kP 2 (fields 1000000))
  | _ => false
#guard match honest with
  | some [b,t,z] => endsInError (refDatum.exec nftPolicy mixBoxHash g1 b t z kP (.Constr 0 []) (fields 1000000))
  | _ => false
#guard match honest with
  | some [b,t,z] => endsInError (refDatum.exec nftPolicy mixBoxHash g1 b t z kP (.Constr 1 [.B "hash"]) (fields 1000000))
  | _ => false
#guard match honest with
  | some [b,t,z] => endsInError (refDouble.exec nftPolicy mixBoxHash g1 b t z kP (fields 1000000) (refAt 4))
  | _ => false
#guard match honest with
  | some [b,t,z] => endsWithUnit (refOtherBefore.exec nftPolicy mixBoxHash g1 b t z kP (fields 1000000)
      (refAt 4) (.Constr 0 [.Constr 0 [.B testKey], .Constr 1 []]) (.Constr 0 []) (.Constr 1 []))
  | _ => false
#guard match honest with
  | some [b,t,z] => endsWithUnit (refOtherAfter.exec nftPolicy mixBoxHash g1 b t z kP (fields 1000000)
      (refAt 4) (.Constr 0 [.Constr 0 [.B testKey], .Constr 1 []]) (.Constr 0 []) (.Constr 1 []))
  | _ => false

end Lovejoin.AnyTx.ReferenceControls
