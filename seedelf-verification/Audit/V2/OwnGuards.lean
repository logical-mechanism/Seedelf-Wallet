import Lovejoin.V2.Owner
import Lovejoin.V2.Steps
import Lovejoin.V2.OwnAny1Boxes
import Lovejoin.V2.OwnAny1Passes
import Lovejoin.V2.OwnAny1Steps
import Audit.V2.Common

/-! Concrete cross-checks for v2's Owner withdrawals of one box, as `#guard`s on the
theorems' own preparations: `V2.Owner`'s real proof (`V2.Steps`' `ownerVector`) halts with
unit and its spec holds; the other payout and z changed error with the spec `false`. Then
`V2.OwnAny1`'s honest proofs halt, and z1 changed or the change a lovelace more error. -/

namespace Lovejoin.V2
open PlutusCore.ByteString (ByteString)
open Lovejoin.Classic (payout payout0)
open Seedelf.V1 (g1 ofHex)
open Audit.V2

#guard match ownerVector with
  | some (b, t, z) => auditHaltsUnit (appliedOwnerV2.exec g1 b t z (ofHex "00112233445566778899aabbccddeeff00112233445566778899aabb") 9000000) && ownerAccepts g1 b t z payout0
  | none => false
#guard match ownerVector with
  | some (b, t, z) => auditErrors (appliedOwnerV2.exec g1 b t z (ofHex "00112233445566778899aabbccddeeff00112233445566778899aabb") 9000001) && !(ownerAccepts g1 b t z (payout (ofHex "00112233445566778899aabbccddeeff00112233445566778899aabb") 9000001))
  | none => false
#guard match ownerVector with
  | some (b, t, _) => auditErrors (appliedOwnerV2.exec g1 b t zOne (ofHex "00112233445566778899aabbccddeeff00112233445566778899aabb") 9000000) && !(ownerAccepts g1 b t zOne payout0)
  | none => false

end Lovejoin.V2

namespace Lovejoin.V2.Own1
open PlutusCore.ByteString (ByteString)
open Seedelf.V1 (g1)
open Audit.V2

#guard match honest with
  | some [b1, t1, z1] => auditHaltsUnit (appliedOwnAny1Passes.exec nftPolicy mixBoxHash g1 b1 t1 z1 kP 3000000 kS kG kU 20000000 kC 1000000) && ownerAcceptsOwn mixBoxHash g1 b1 t1 z1 kS kG kU 20000000 kC 1000000
  | _ => false
#guard match honest with
  | some [b1, t1, _] => auditErrors (appliedOwnAny1Boxes.exec nftPolicy mixBoxHash g1 b1 t1 zOneOwn kP 3000000 kS kG kU 20000000 kC 1000000) && !(proofHolds mixBoxHash kS kG kU 20000000 kC 1000000 g1 b1 t1 zOneOwn)
  | _ => false
#guard match honest with
  | some [b1, t1, z1] => auditErrors (appliedOwnAny1Boxes.exec nftPolicy mixBoxHash g1 b1 t1 z1 kP 3000000 kS kG kU 20000000 kC 1000001) && !(proofHolds mixBoxHash kS kG kU 20000000 kC 1000001 g1 b1 t1 z1)
  | _ => false

end Lovejoin.V2.Own1
