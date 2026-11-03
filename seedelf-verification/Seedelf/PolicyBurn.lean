import Seedelf.Policy
import Blaster

/-! Burns of any 5eed0e1f token (`prefixed rest`, rest symbolic) under policy
`p`, first input `01#i`, no tag. The index is fixed per scenario: a run with a
symbolic index (and symbolic names) failed on `BitVec`, which Upstream/ByteStrings
later traced to the slicing, not to `consByteString`'s byte, so a symbolic
index is worth retrying. `xor` takes both blocks, so a burn builds the mint's name too: first seen
running the deployed bytes with `aiken uplc eval`. -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

def burnAt0Args (rest : ByteString) : List Term := [toTerm (mintCtx "p" "p" (prefixed rest) "\x01" "" 0 (-1))]
def burnAt255Args (rest : ByteString) : List Term := [toTerm (mintCtx "p" "p" (prefixed rest) "\x01" "" 255 (-1))]
def burnAt256Args (rest : ByteString) : List Term := [toTerm (mintCtx "p" "p" (prefixed rest) "\x01" "" 256 (-1))]
def burnAtNeg1Args (rest : ByteString) : List Term := [toTerm (mintCtx "p" "p" (prefixed rest) "\x01" "" (-1) (-1))]

#prep_uplc appliedBurnAt0 seedelf burnAt0Args 1500
#prep_uplc appliedBurnAt255 seedelf burnAt255Args 1500
#prep_uplc appliedBurnAt256 seedelf burnAt256Args 1500
#prep_uplc appliedBurnAtNeg1 seedelf burnAtNeg1Args 1500

/-- Any 5eed0e1f token burns off `#0`. -/
theorem burn_at_0 : ∀ (rest : ByteString), isSuccessful (appliedBurnAt0.prop rest) := by blaster

/-- And off `#255`. -/
theorem burn_at_255 : ∀ (rest : ByteString), isSuccessful (appliedBurnAt255.prop rest) := by blaster

/-- But none burns off `#256`: the burn reaches `Error`. -/
theorem burn_at_256_fails : ∀ (rest : ByteString), isUnsuccessful (appliedBurnAt256.prop rest) := by blaster

/-- Nor off index -1 (no such output, but nothing in the bytes stops it). -/
theorem burn_at_neg1_fails : ∀ (rest : ByteString), isUnsuccessful (appliedBurnAtNeg1.prop rest) := by blaster

end Seedelf.V1
