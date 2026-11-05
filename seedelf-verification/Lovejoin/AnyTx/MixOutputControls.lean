import Lovejoin.AnyTx.MixOutputs
import Lovejoin.AnyTx.MixTwoControls

/-! Known-good Mix proof against changed prefix outputs. -/
namespace Lovejoin.AnyTx.MixOutputControls
open Seedelf.V1 (endsInError)
open Lovejoin.AnyTx (adaValue testL)
open Lovejoin.AnyTx.OwnerMoreControls (fields box2)
open Lovejoin.AnyTx.MixTwoControls (tail kat)
open Lovejoin.AnyTx.MixOutputs
open Lovejoin.V2

#guard endsInError (mixBadValue.exec nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2
  outA1 outB1 outA2 outB2 userKey (fields 1000000) box2 tail kat (adaValue 9999999) true)
#guard endsInError (mixBadValue.exec nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2
  outA1 outB1 outA2 outB2 userKey (fields 1000000) box2 tail kat (adaValue 9999999) false)
#guard endsInError (mixBadCredential.exec nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2
  outA1 outB1 outA2 outB2 userKey (fields 1000000) box2 tail kat testL true)
#guard endsInError (mixBadDatum.exec nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2
  outA1 outB1 outA2 outB2 userKey (fields 1000000) box2 tail kat (.Constr 0 []) false)

#guard endsInError (mixBadStake.exec nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2
  outA1 outB1 outA2 outB2 userKey (fields 1000000) box2 tail kat (.Constr 0 [.B userKey]) true)
#guard endsInError (mixBadReference.exec nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2
  outA1 outB1 outA2 outB2 userKey (fields 1000000) box2 tail kat (.B userKey) false)
#guard endsInError (mixBadKey.exec nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2
  outA1 outB1 outA2 outB2 userKey (fields 1000000) box2 tail kat mixBoxHash true)
#guard endsInError (mixExtraBox.exec nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2
  outA1 outB1 outA2 outB2 userKey outA1 outB1 (fields 1000000) box2 tail kat)

end Lovejoin.AnyTx.MixOutputControls
