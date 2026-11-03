import Lovejoin.V2.Mix
import Blaster

/-! xor32's fix, on v2's bytes: a Mix succeeds only if every branch of every proof carries
a challenge `c` of exactly 32 bytes. The scenario is the KAT's Mix with its four `c`s
symbolic and everything else its own: if any of them isn't 32 bytes long, the script
errors.

`c` reaches two builtins: `xor_bytearray`, through xor32, and `bytearray_to_integer`,
through `scalar_from_bytes_mod`. Both run through opaque aliases (PlutusCoreBlaster
`local/opaque-xor`, and chunk 41's), so the solver sees uninterpreted functions. The
theorem holds whatever they return, so it holds for what they really return. The step
limit sits above the KAT's run in `Steps`. -/

namespace Lovejoin.V2
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

def challengeArgs (c11 c12 c21 c22 : ByteString) : List Term :=
  [toTerm (mixCtx (mixRedeemer (katProofs c11 c12 c21 c22)))]

#prep_uplc appliedChallenges mixLogic challengeArgs 30000

/-- A challenge of any other length, in any branch of either proof, fails the Mix. -/
theorem mix_refuses_a_challenge_not_32_bytes : ∀ (c11 c12 c21 c22 : ByteString),
    (lengthOfByteString c11 ≠ 32 ∨ lengthOfByteString c12 ≠ 32 ∨
      lengthOfByteString c21 ≠ 32 ∨ lengthOfByteString c22 ≠ 32) →
      isUnsuccessful (appliedChallenges.prop c11 c12 c21 c22) := by blaster

end Lovejoin.V2
