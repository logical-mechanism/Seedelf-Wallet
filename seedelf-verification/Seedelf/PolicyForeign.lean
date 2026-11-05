import Seedelf.Policy
import Blaster

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

/-- The policy runs as `p` while the one mint line, of a 5eed0e1f token, is under `cs`. -/
def foreignMintArgs (cs : ByteString) : List Term :=
  [toTerm (mintCtx "p" cs "\x5e\xed\x0e\x1f\x01" "\x01" "" 0 1)]
def foreignBurnArgs (cs : ByteString) : List Term :=
  [toTerm (mintCtx "p" cs "\x5e\xed\x0e\x1f\x01" "\x01" "" 0 (-1))]

#prep_uplc appliedForeignMint seedelf foreignMintArgs 1500
#prep_uplc appliedForeignBurn seedelf foreignBurnArgs 1500

/-- A mint whose one line is another policy's reaches `Error`. -/
theorem foreign_mint_fails :
  ∀ (cs : ByteString), cs ≠ "p" → isUnsuccessful (appliedForeignMint.prop cs) := by blaster

/-- So does a burn. -/
theorem foreign_burn_fails :
  ∀ (cs : ByteString), cs ≠ "p" → isUnsuccessful (appliedForeignBurn.prop cs) := by blaster

end Seedelf.V1
