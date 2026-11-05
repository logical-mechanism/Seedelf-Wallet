import Audit.Gaps.V2.GapMixIns
import Blaster

/-! v2's Mix of two for any ADA pool: what `V2.MixAny`'s fixed redeemer can't say. It must
hold exactly a proof a box, each with exactly a branch a box out. The runs are `V2.GapMixInsSteps`'. Written by the v2-scenario audit's
`gen-gaps.py`. -/

namespace Lovejoin.V2.Any
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)

#prep_uplc appliedGapMixThreeProofs mixLogicTemplate gapThreeProofsArgs 20000
#prep_uplc appliedGapMixOneProof mixLogicTemplate gapOneProofArgs 20000
#prep_uplc appliedGapMixThreeBranches mixLogicTemplate gapThreeBranchesArgs 20000
#prep_uplc appliedGapMixOneBranch mixLogicTemplate gapOneBranchArgs 20000

/-- Three proofs for two boxes fail. -/
theorem gap_mix_refuses_three_proofs :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (t031 t131 c31 z31 t032 t132 c32 z32 : ByteString),
      isUnsuccessful (appliedGapMixThreeProofs.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 t031 t131 c31 z31 t032 t132 c32 z32) := by
  blaster (timeout: 540)

/-- One proof for two boxes fails. -/
theorem gap_mix_refuses_one_proof :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 : ByteString),
      isUnsuccessful (appliedGapMixOneProof.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12) := by
  blaster (timeout: 540)

/-- A proof with a branch more than the boxes out fails. -/
theorem gap_mix_refuses_three_branches :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString) (t013 t113 c13 z13 : ByteString),
      isUnsuccessful (appliedGapMixThreeBranches.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 t013 t113 c13 z13) := by
  blaster (timeout: 540)

/-- A proof with a branch fewer than the boxes out fails. -/
theorem gap_mix_refuses_one_branch :
    ∀ (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString),
      isUnsuccessful (appliedGapMixOneBranch.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t021 t121 c21 z21 t022 t122 c22 z22) := by
  blaster (timeout: 540)

end Lovejoin.V2.Any
