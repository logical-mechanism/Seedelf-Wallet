import Lovejoin.OwnClassic3Boxes
import Lovejoin.OwnClassic3Passes
import Lovejoin.OwnClassic3Steps
import Audit.Classic.Common

/-! The classic pool's Owner withdrawal of three boxes (`Lovejoin.OwnClassic3*`), concretely,
through the `exec` twin of `Passes`' prop, on `OwnClassic3Steps`' honest proofs and its
changes. Expected: 4 `#guard`s pass, no output. -/

namespace Audit.Classic.Own3
open Audit.Classic (haltedUnitB erroredB)
open Lovejoin.Classic.Own3 (honest ownerAcceptsOwn kP kS kC kG kU zOneOwn)
open Seedelf.V1 (g1)

-- [C-G1] The honest proofs halt with unit and the spec says true.
#guard match honest with
  | some [b1, t1, z1, b2, t2, z2, b3, t3, z3] =>
      haltedUnitB (appliedOwnClassic3Passes.exec g1 b1 g1 b2 g1 b3 t1 z1 t2 z2 t3 z3 kP 3000000 kS kG kU 20000000 kC 1000000) &&
        ownerAcceptsOwn g1 b1 g1 b2 g1 b3 t1 z1 t2 z2 t3 z3 kS kG kU 20000000 kC 1000000
  | _ => false

-- [C-G2] Box 1's z changed: errors, spec false.
#guard match honest with
  | some [b1, t1, _, b2, t2, z2, b3, t3, z3] =>
      erroredB (appliedOwnClassic3Passes.exec g1 b1 g1 b2 g1 b3 t1 zOneOwn t2 z2 t3 z3 kP 3000000 kS kG kU 20000000 kC 1000000) &&
        !ownerAcceptsOwn g1 b1 g1 b2 g1 b3 t1 zOneOwn t2 z2 t3 z3 kS kG kU 20000000 kC 1000000
  | _ => false

-- [C-G3] The change a lovelace more: errors, spec false.
#guard match honest with
  | some [b1, t1, z1, b2, t2, z2, b3, t3, z3] =>
      erroredB (appliedOwnClassic3Passes.exec g1 b1 g1 b2 g1 b3 t1 z1 t2 z2 t3 z3 kP 3000000 kS kG kU 20000000 kC 1000001) &&
        !ownerAcceptsOwn g1 b1 g1 b2 g1 b3 t1 z1 t2 z2 t3 z3 kS kG kU 20000000 kC 1000001
  | _ => false

-- [C-G4] The first two boxes' proofs swapped: errors, spec false.
#guard match honest with
  | some [b1, t1, z1, b2, t2, z2, b3, t3, z3] =>
      erroredB (appliedOwnClassic3Passes.exec g1 b1 g1 b2 g1 b3 t2 z2 t1 z1 t3 z3 kP 3000000 kS kG kU 20000000 kC 1000000) &&
        !ownerAcceptsOwn g1 b1 g1 b2 g1 b3 t2 z2 t1 z1 t3 z3 kS kG kU 20000000 kC 1000000
  | _ => false

end Audit.Classic.Own3
