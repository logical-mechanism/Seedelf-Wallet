import Seedelf.Signers.Signers4
import Blaster

/-! A negative control for `Signers4` (gen-seedelf-signers.py writes this file), expected
Falsified (README rule 8): a control that comes back Valid prints "❌ Unexpected Valid" and fails
the build. It is the module's iff with the last signatory left out of the disjunction, over
`Signers4`'s own builder: a proof that checks, signed by s4 alone, passes, so the solver must
see the key found last of 4. Were that builder's background contradictory (Lean-blaster #194),
both of `Signers4`'s theorems would come back Valid whatever the bytes do, and so would this. -/

namespace Seedelf.V1
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Utils

-- The last signatory, s4, left out.
#blaster (gen-cex: 0) (solve-result: 1)
  [∀ (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 s4 : ByteString),
    isSuccessful (appliedSig4.prop r ref g u z gr vkh s1 s2 s3 s4) ↔
      (schnorrAccepts g u z gr vkh = true ∧ (vkh = s1 ∨ vkh = s2 ∨ vkh = s3))]

end Seedelf.V1
