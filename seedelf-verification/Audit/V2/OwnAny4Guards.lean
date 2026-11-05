import Lovejoin.V2.OwnAny4Boxes
import Lovejoin.V2.OwnAny4Passes
import Lovejoin.V2.OwnAny4Steps
import Audit.V2.Common

/-! Concrete cross-checks for v2's Owner withdrawal of four boxes (`V2.OwnAny4*`), as
`#guard`s on the theorems' own preparations: the honest proofs halt with unit and the spec
holds; z1 changed, the change a lovelace more, and the first two proofs swapped each error,
each an instance of a Boxes theorem's hypothesis. -/

namespace Lovejoin.V2.Own4
open PlutusCore.ByteString (ByteString)
open Seedelf.V1 (g1)
open Audit.V2

#guard match honest with
  | some [b1, t1, z1, b2, t2, z2, b3, t3, z3, b4, t4, z4] => auditHaltsUnit (appliedOwnAny4Passes.exec nftPolicy mixBoxHash g1 b1 g1 b2 g1 b3 g1 b4 t1 z1 t2 z2 t3 z3 t4 z4 kP 3000000 kS kG kU 20000000 kC 1000000) && ownerAcceptsOwn mixBoxHash g1 b1 g1 b2 g1 b3 g1 b4 t1 z1 t2 z2 t3 z3 t4 z4 kS kG kU 20000000 kC 1000000
  | _ => false
#guard match honest with
  | some [b1, t1, _, b2, t2, z2, b3, t3, z3, b4, t4, z4] => auditErrors (appliedOwnAny4Boxes.exec nftPolicy mixBoxHash g1 b1 g1 b2 g1 b3 g1 b4 t1 zOneOwn t2 z2 t3 z3 t4 z4 kP 3000000 kS kG kU 20000000 kC 1000000) && !(proofHolds mixBoxHash kS kG kU 20000000 kC 1000000 g1 b1 t1 zOneOwn)
  | _ => false
#guard match honest with
  | some [b1, t1, z1, b2, t2, z2, b3, t3, z3, b4, t4, z4] => auditErrors (appliedOwnAny4Boxes.exec nftPolicy mixBoxHash g1 b1 g1 b2 g1 b3 g1 b4 t1 z1 t2 z2 t3 z3 t4 z4 kP 3000000 kS kG kU 20000000 kC 1000001) && !(proofHolds mixBoxHash kS kG kU 20000000 kC 1000001 g1 b1 t1 z1)
  | _ => false
#guard match honest with
  | some [b1, t1, z1, b2, t2, z2, b3, t3, z3, b4, t4, z4] => auditErrors (appliedOwnAny4Boxes.exec nftPolicy mixBoxHash g1 b1 g1 b2 g1 b3 g1 b4 t2 z2 t1 z1 t3 z3 t4 z4 kP 3000000 kS kG kU 20000000 kC 1000000) && !(proofHolds mixBoxHash kS kG kU 20000000 kC 1000000 g1 b1 t2 z2)
  | _ => false

end Lovejoin.V2.Own4
