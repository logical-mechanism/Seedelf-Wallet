import Lovejoin.AnyTx.OwnerOtherInputs
import Lovejoin.AnyTx.OwnerMoreControls

/-! A hash-datum script input at mix_box is not counted as a well-formed box, but
its reference is bound into the Owner proof. -/
namespace Lovejoin.AnyTx.OwnerOtherControls
open Seedelf.V1 (g1 endsWithUnit endsInError)
open Lovejoin.AnyTx (refAt)
open Lovejoin.AnyTx.OwnerMoreControls (fields proofForRefs)
open Lovejoin.V2 (nftPolicy mixBoxHash)

#guard match proofForRefs [(fields 1000000).keyRef, (fields 1000000).boxRef] with
  | some (b,t,z) => endsWithUnit (ownerOtherInputs.exec nftPolicy mixBoxHash g1 b t z mixBoxHash
      (fields 1000000) (.B "hash") true)
  | _ => false
#guard match proofForRefs [(fields 1000000).boxRef, (fields 1000000).keyRef] with
  | some (b,t,z) => endsWithUnit (ownerOtherInputs.exec nftPolicy mixBoxHash g1 b t z mixBoxHash
      (fields 1000000) (.B "hash") false)
  | _ => false
#guard match proofForRefs [(fields 1000000).boxRef, (fields 1000000).keyRef] with
  | some (b,t,z) => endsInError (ownerOtherInputs.exec nftPolicy mixBoxHash g1 b t z mixBoxHash
      { fields 1000000 with keyRef := refAt 4 } (.B "hash") false)
  | _ => false

end Lovejoin.AnyTx.OwnerOtherControls
