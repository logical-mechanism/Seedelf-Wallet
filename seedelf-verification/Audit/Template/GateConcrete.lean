import Lovejoin.Template.MixBoxGate
import Lovejoin.Template.Steps
import Audit.Classic.Common

/-! mix_box's template gate (`Lovejoin.Template.MixBoxGate`), concretely, through the `exec`
twins of its props, at the classic L and at v2's test L (`6666…`). Expected: 6 `#guard`s pass,
no output. -/

namespace Audit.Template
open Audit.Classic (haltedUnitB erroredB)
open Lovejoin.Classic (notG1 mixLogicHash)
open Lovejoin.Template (v2L)
open Seedelf.V1 (g1)

-- [H-G1] At the classic L, the classic mix_logic's withdrawal opens a well-formed box.
#guard haltedUnitB (appliedGateLogicT.exec mixLogicHash g1 notG1 0)
-- [H-G2] At v2's L, v2's withdrawal does.
#guard haltedUnitB (appliedGateLogicT.exec v2L g1 notG1 0)
-- [H-G3] At v2's L, the classic mix_logic's withdrawal doesn't.
#guard erroredB (appliedGateScriptT.exec v2L g1 notG1 mixLogicHash 0)
-- [H-G4] At v2's L, no withdrawal doesn't.
#guard erroredB (appliedGateNoneT.exec v2L g1 notG1)
-- [H-G5] At v2's L, a key's withdrawal (with L's own hash) doesn't.
#guard erroredB (appliedGateKeyT.exec v2L g1 notG1 v2L 0)
-- [H-G6] At v2's L, a box with a = b moves alone.
#guard haltedUnitB (appliedGateNoneT.exec v2L g1 g1)

end Audit.Template
