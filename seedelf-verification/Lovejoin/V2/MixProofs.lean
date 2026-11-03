import Lovejoin.V2.MixSpec
import Blaster

/-! v2's Mix, n = 2: the KAT's transaction succeeds iff each box in's sigma-OR proof
verifies against the boxes out (`mixAccepts`, line for line with `verify_pre`). Every
field of both proofs is symbolic: 4 branches of `(t0, t1, c, z)`. So a Mix moves boxes
only with a proof for each, bound to the outputs it pays, and nothing else gets it
through.

With `MixOutputs` and `MixDatums` (what a Mix must pay) and `MixChallenges` (the fix),
this is step 5's (b) on v2. The crypto is opaque: the theorem says the script checks
exactly these equations, not that they're hard to fake. The step limit sits above the
KAT's run in `V2.Steps`, where `mixAccepts` is `true` on the KAT's own proofs. -/

namespace Lovejoin.V2
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

def proofArgs (t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) : List Term :=
  [toTerm (mixCtx (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

#prep_uplc appliedMixProofs mixLogicV2 proofArgs 30000

/-- A Mix of the KAT's two boxes succeeds iff both boxes' proofs verify. -/
theorem mix_iff_every_proof_verifies :
    ∀ (t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      isSuccessful (appliedMixProofs.prop t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22) ↔
        mixAccepts t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 = true := by
  blaster

end Lovejoin.V2
