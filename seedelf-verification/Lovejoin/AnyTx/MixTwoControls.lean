import Lovejoin.AnyTx.MixTwo
import Lovejoin.AnyTx.OwnerMoreControls
import Lovejoin.V2.MixAnySteps

/-! The independent two-box Mix KAT, now with a key input and arbitrary trailing
output fields. Change a scalar, challenge, or pool value and the same proof fails. -/
namespace Lovejoin.AnyTx.MixTwoControls
open Seedelf.V1 (endsWithUnit endsInError)
open Lovejoin.AnyTx
open Lovejoin.AnyTx.MixTwo
open Lovejoin.AnyTx.OwnerMoreControls (fields box2)
open Lovejoin.V2

def tail : Tail :=
  { key := userKey, stake := .Constr 1 [], value := adaValue 5000000,
    datum := .Constr 0 [], script := .Constr 1 [] }
def kat : Proof :=
  ⟨katT011, katT111, katC11, katZ11, katT012, katT112, katC12, katZ12,
   katT021, katT121, katC21, katZ21, katT022, katT122, katC22, katZ22⟩

#guard endsWithUnit (mixTwo.exec nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2
  outA1 outB1 outA2 outB2 userKey (fields 1000000) box2 tail kat)
#guard endsInError (mixTwo.exec nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2
  outA1 outB1 outA2 outB2 userKey (fields 1000000) box2 tail { kat with z11 := "" })
#guard endsInError (mixTwo.exec nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2
  outA1 outB1 outA2 outB2 userKey (fields 1000000) box2 tail { kat with c22 := "" })
#guard endsInError (mixTwo.exec nftPolicy mixBoxHash 5000000 inA1 inB1 inA2 inB2
  outA1 outB1 outA2 outB2 userKey (fields 1000000) box2 tail kat)

end Lovejoin.AnyTx.MixTwoControls
