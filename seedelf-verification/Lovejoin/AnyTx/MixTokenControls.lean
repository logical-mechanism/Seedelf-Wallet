import Lovejoin.AnyTx.MixTokenTwo
import Lovejoin.AnyTx.MixTwoControls
import Lovejoin.V2.MixTok2Steps

/-! Known-good token Mix proof in the expanded context, and altered variants. -/
namespace Lovejoin.AnyTx.MixTokenControls
open Seedelf.V1 (endsWithUnit endsInError)
open Lovejoin.AnyTx.OwnerMoreControls (fields box2)
open Lovejoin.AnyTx.MixTwo (Proof)
open Lovejoin.AnyTx.MixTwoControls (tail)
open Lovejoin.V2 (nftPolicy mixBoxHash userKey)
open Lovejoin.V2.Tok2

def kat : Proof :=
  ⟨katT011, katT111, katC11, katZ11, katT012, katT112, katC12, katZ12,
   katT021, katT121, katC21, katZ21, katT022, katT122, katC22, katZ22⟩

#guard endsWithUnit (mixTokenTwo.exec nftPolicy mixBoxHash 2000000 tokPolicy tokName 1000000
  katA1 katB1 katA2 katB2 katOA1 katOB1 katOA2 katOB2 userKey (fields 1000000) box2 tail kat)
#guard endsInError (mixTokenTwo.exec nftPolicy mixBoxHash 2000000 tokPolicy tokName 1000000
  katA1 katB1 katA2 katB2 katOA1 katOB1 katOA2 katOB2 userKey (fields 1000000) box2 tail { kat with z11 := "" })
#guard endsInError (mixTokenTwo.exec nftPolicy mixBoxHash 2000000 tokPolicy tokName 1000001
  katA1 katB1 katA2 katB2 katOA1 katOB1 katOA2 katOB2 userKey (fields 1000000) box2 tail kat)
#guard endsInError (mixTokenTwo.exec nftPolicy mixBoxHash 2000000 tokPolicy "OTHER" 1000000
  katA1 katB1 katA2 katB2 katOA1 katOB1 katOA2 katOB2 userKey (fields 1000000) box2 tail kat)

end Lovejoin.AnyTx.MixTokenControls
