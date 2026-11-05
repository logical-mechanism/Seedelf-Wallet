import Lovejoin.AnyTx.MixTokenOutputs
import Lovejoin.AnyTx.MixTokenControls

/-! Alter one token quantity, name or policy while retaining the known-good proof. -/
namespace Lovejoin.AnyTx.MixTokenOutputControls
open PlutusCore.Data (Data)
open Seedelf.V1 (endsInError)
open Lovejoin.AnyTx (testL)
open Lovejoin.AnyTx.OwnerMoreControls (fields box2)
open Lovejoin.AnyTx.MixTwoControls (tail)
open Lovejoin.AnyTx.MixTokenControls (kat)
open Lovejoin.V2 (nftPolicy mixBoxHash userKey)
open Lovejoin.V2.Tok2

private def value (policy name : PlutusCore.ByteString.ByteString) (qty : PlutusCore.Integer.Integer) : Data :=
  .Map [(.B "", .Map [(.B "", .I 2000000)]), (.B policy, .Map [(.B name, .I qty)])]

#guard endsInError (mixTokenBadValue.exec nftPolicy mixBoxHash 2000000 tokPolicy tokName 1000000
  katA1 katB1 katA2 katB2 katOA1 katOB1 katOA2 katOB2 userKey (fields 1000000) box2 tail kat (value tokPolicy tokName 999999) true)
#guard endsInError (mixTokenBadValue.exec nftPolicy mixBoxHash 2000000 tokPolicy tokName 1000000
  katA1 katB1 katA2 katB2 katOA1 katOB1 katOA2 katOB2 userKey (fields 1000000) box2 tail kat (value tokPolicy "OTHER" 1000000) false)
#guard endsInError (mixTokenBadValue.exec nftPolicy mixBoxHash 2000000 tokPolicy tokName 1000000
  katA1 katB1 katA2 katB2 katOA1 katOB1 katOA2 katOB2 userKey (fields 1000000) box2 tail kat (value testL tokName 1000000) true)

end Lovejoin.AnyTx.MixTokenOutputControls
