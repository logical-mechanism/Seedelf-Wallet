import Lovejoin.AnyTx.Owner3
import Lovejoin.AnyTx.Owner4
import Lovejoin.AnyTx.OwnerMoreControls
import Lovejoin.V2.OwnAny3Steps
import Lovejoin.V2.OwnAny4Steps

/-! Passing and missing/altered-proof controls from independently generated Owner vectors. -/
namespace Lovejoin.AnyTx.OwnerManyControls
open CardanoLedgerApi.IsData.Class (IsData)
open Seedelf.V1 (g1 endsWithUnit endsInError)
open Lovejoin.AnyTx.OwnerMoreControls (fields box2)
open Lovejoin.V2 (nftPolicy mixBoxHash)

private def box3 : Lovejoin.AnyTx.OwnerTwo.BoxFields :=
  { box2 with ref := IsData.toData Lovejoin.V2.Own3.ref3 }
private def box4 : Lovejoin.AnyTx.OwnerTwo.BoxFields :=
  { box2 with ref := IsData.toData Lovejoin.V2.Own4.ref4 }

#guard match Lovejoin.V2.Own3.honest with
  | some [b1,t1,z1,b2,t2,z2,b3,t3,z3] =>
    let p : Lovejoin.AnyTx.Owner3.Proofs := ⟨t1,z1,t2,z2,t3,z3⟩
    endsWithUnit (owner3Tx.exec nftPolicy mixBoxHash g1 b1 g1 b2 g1 b3 Lovejoin.V2.Own3.kP
      (fields 1000000) box2 box3 p)
  | _ => false
#guard match Lovejoin.V2.Own3.honest with
  | some [b1,t1,z1,b2,t2,z2,b3,t3,z3] =>
    let p : Lovejoin.AnyTx.Owner3.Proofs := ⟨t1,z1,t2,z2,t3,z3⟩
    endsInError (owner3Tx.exec nftPolicy mixBoxHash g1 b1 g1 b2 g1 b3 Lovejoin.V2.Own3.kP
      (fields 1000000) box2 box3 { p with z3 := "" })
  | _ => false
#guard match Lovejoin.V2.Own3.honest with
  | some [b1,t1,z1,b2,t2,z2,b3,t3,z3] =>
    let p : Lovejoin.AnyTx.Owner3.Proofs := ⟨t1,z1,t2,z2,t3,z3⟩
    endsInError (owner3Missing.exec nftPolicy mixBoxHash g1 b1 g1 b2 g1 b3 Lovejoin.V2.Own3.kP
      (fields 1000000) box2 box3 p)
  | _ => false
#guard match Lovejoin.V2.Own4.honest with
  | some [b1,t1,z1,b2,t2,z2,b3,t3,z3,b4,t4,z4] =>
    let p : Lovejoin.AnyTx.Owner4.Proofs := ⟨t1,z1,t2,z2,t3,z3,t4,z4⟩
    endsWithUnit (owner4Tx.exec nftPolicy mixBoxHash g1 b1 g1 b2 g1 b3 g1 b4 Lovejoin.V2.Own4.kP
      (fields 1000000) box2 box3 box4 p)
  | _ => false
#guard match Lovejoin.V2.Own4.honest with
  | some [b1,t1,z1,b2,t2,z2,b3,t3,z3,b4,t4,z4] =>
    let p : Lovejoin.AnyTx.Owner4.Proofs := ⟨t1,z1,t2,z2,t3,z3,t4,z4⟩
    endsInError (owner4Tx.exec nftPolicy mixBoxHash g1 b1 g1 b2 g1 b3 g1 b4 Lovejoin.V2.Own4.kP
      (fields 1000000) box2 box3 box4 { p with z4 := "" })
  | _ => false
#guard match Lovejoin.V2.Own4.honest with
  | some [b1,t1,z1,b2,t2,z2,b3,t3,z3,b4,t4,z4] =>
    let p : Lovejoin.AnyTx.Owner4.Proofs := ⟨t1,z1,t2,z2,t3,z3,t4,z4⟩
    endsInError (owner4Missing.exec nftPolicy mixBoxHash g1 b1 g1 b2 g1 b3 g1 b4 Lovejoin.V2.Own4.kP
      (fields 1000000) box2 box3 box4 p)
  | _ => false

end Lovejoin.AnyTx.OwnerManyControls
