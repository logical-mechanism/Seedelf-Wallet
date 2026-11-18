import Lovejoin.AnyTx.MixOutputs
import Lovejoin.AnyTx.MixTwoControls

/-! Known-good Mix proof against changed prefix outputs, and the same builders at their passing
point (README rule 3). -/
namespace Lovejoin.AnyTx.MixOutputControls
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open Seedelf.V1 (endsWithUnit endsInError)
open Lovejoin.AnyTx (adaValue testL)
open Lovejoin.AnyTx.OwnerMoreControls (fields box2)
open Lovejoin.AnyTx.MixTwoControls (tail kat)
open Lovejoin.AnyTx.MixOutputs
open Lovejoin.V2

-- Each builder that can pass, at its passing point: the box value, mix_box's credential, the
-- inline datum the box carries. The changed output is then the honest one, and the same Mix
-- returns unit, as MixTwoControls' honest run does; so the failures below fail on the change.
#guard endsWithUnit (mixBadValue.exec nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2
  outA1 outB1 outA2 outB2 userKey (fields 1000000) box2 tail kat (adaValue 10000000) true)
#guard endsWithUnit (mixBadValue.exec nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2
  outA1 outB1 outA2 outB2 userKey (fields 1000000) box2 tail kat (adaValue 10000000) false)
#guard endsWithUnit (mixBadCredential.exec nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2
  outA1 outB1 outA2 outB2 userKey (fields 1000000) box2 tail kat mixBoxHash true)
#guard endsWithUnit (mixBadDatum.exec nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2
  outA1 outB1 outA2 outB2 userKey (fields 1000000) box2 tail kat (.Constr 2 [.Constr 0 [.B outA2, .B outB2]]) false)

-- The builders that can't pass (a stake part, a reference script, a key's credential, a third
-- box) change one field of `output`, or add a box, in the honest layout: `output` with the honest
-- fields is MixTwo's box, and `replaceOne` puts the changed output at the place it names.
example (M : ByteString) (bl : Integer) (a b : ByteString) :
    output (.Constr 1 [.B M]) (.Constr 1 []) (.Map [(.B "", .Map [(.B "", .I bl)])])
      (.Constr 2 [.Constr 0 [.B a, .B b]]) (.Constr 1 []) = MixTwo.boxOut M bl a b := rfl
example (g1 g2 t : Data) : replaceOne true g1 g1 g2 t = [g1, g2, t] := rfl
example (g1 g2 t : Data) : replaceOne false g2 g1 g2 t = [g1, g2, t] := rfl

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
