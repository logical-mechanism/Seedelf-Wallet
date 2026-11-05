import Lovejoin.MixBoxGate
import Lovejoin.Steps
import Audit.Classic.Common

/-! The classic mix_box's gate (`Lovejoin.MixBoxGate`), concretely, through the `exec` twins of
its props, on `Lovejoin.Steps`' box `(g1, notG1)`. Expected: 6 `#guard`s pass, no output. -/

namespace Audit.Classic
open Lovejoin.Classic (notG1)
open Seedelf.V1 (g1)

-- [D-G1] A well-formed box with mix_logic's withdrawal of 0 halts with unit.
#guard haltedUnitB (appliedGateLogic.exec g1 notG1 0)
-- [D-G2] Of any amount: 5 lovelace.
#guard haltedUnitB (appliedGateLogic.exec g1 notG1 5)
-- [D-G3] With no withdrawal it errors.
#guard erroredB (appliedGateNone.exec g1 notG1)
-- [D-G4] With another script's withdrawal it errors.
#guard erroredB (appliedGateScript.exec g1 notG1 "o" 0)
-- [D-G5] With a key's withdrawal it errors.
#guard erroredB (appliedGateKey.exec g1 notG1 "o" 0)
-- [D-G6] A box with a = b moves with no withdrawal (Rule 2's recovery).
#guard haltedUnitB (appliedGateNone.exec g1 g1)

end Audit.Classic
