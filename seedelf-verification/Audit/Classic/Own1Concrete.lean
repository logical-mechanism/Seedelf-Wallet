import Lovejoin.OwnClassic1Boxes
import Lovejoin.OwnClassic1Passes
import Lovejoin.OwnClassic1Steps
import Audit.Classic.Common

/-! The classic pool's Owner withdrawal of one box (`Lovejoin.OwnClassic1*`), concretely,
through the `exec` twins of the props its theorems are over, on `OwnClassic1Steps`' honest
proof and its changes. `OwnClassic1Steps` only prints these (`#eval`); here a wrong answer fails
the build. Expected: 4 `#guard`s pass, no output. -/

namespace Audit.Classic.Own1
open Audit.Classic (haltedUnitB erroredB)
open Lovejoin.Classic.Own1 (honest ownerAcceptsOwn kP kS kC kG kU zOneOwn)
open Seedelf.V1 (g1)

-- [B-G1] The honest proof halts with unit and the spec says true: `Passes`' hypotheses hold
-- under the real builtins.
#guard match honest with
  | some [b1, t1, z1] =>
      haltedUnitB (appliedOwnClassic1Passes.exec g1 b1 t1 z1 kP 3000000 kS kG kU 20000000 kC 1000000) &&
        ownerAcceptsOwn g1 b1 t1 z1 kS kG kU 20000000 kC 1000000
  | _ => false

-- [B-G2] z1 changed errors, and the spec says false.
#guard match honest with
  | some [b1, t1, _] =>
      erroredB (appliedOwnClassic1Passes.exec g1 b1 t1 zOneOwn kP 3000000 kS kG kU 20000000 kC 1000000) &&
        !ownerAcceptsOwn g1 b1 t1 zOneOwn kS kG kU 20000000 kC 1000000
  | _ => false

-- [B-G3] The change a lovelace more (the proof bound to other outputs) errors, spec false.
#guard match honest with
  | some [b1, t1, z1] =>
      erroredB (appliedOwnClassic1Passes.exec g1 b1 t1 z1 kP 3000000 kS kG kU 20000000 kC 1000001) &&
        !ownerAcceptsOwn g1 b1 t1 z1 kS kG kU 20000000 kC 1000001
  | _ => false

-- [B-G4] The honest proof on `Boxes`' own preparation halts too (same script, arguments, limit).
#guard match honest with
  | some [b1, t1, z1] => haltedUnitB (appliedOwnClassic1Boxes.exec g1 b1 t1 z1 kP 3000000 kS kG kU 20000000 kC 1000000)
  | _ => false

end Audit.Classic.Own1
