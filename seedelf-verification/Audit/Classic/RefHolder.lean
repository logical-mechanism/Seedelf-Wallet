import Lovejoin.ReferenceHolder
import Lovejoin.Box
import Audit.Classic.MutantScripts
import Audit.Classic.Common
import Blaster

/-! Controls for `Lovejoin.Classic.reference_holder_always_fails`:
`∀ redeemer info, isUnsuccessful (appliedReferenceHolder.prop redeemer info)`. Expected:
2 `#guard`s pass, **3 "✅ Expected Falsified" lines and 1 "✅ Valid" line**.

The theorem has no spec and no hypothesis, so the spec, hypothesis and vacuity mutants don't
apply; it says `isUnsuccessful`, which a run cut off at the limit isn't, so it needs no
no-exhaustion theorem, and it never halts, so no unit-result one.

- [E-G1..2] Concretely, through `exec`: a spend errors, and so does a mint.
- [E-F1] The conclusion flipped: that it always succeeds.
- [E-L1] The step limit one below the spend's run (`Lovejoin.Steps`: errors after 178). A Valid
  result would mean the model counts a run cut off at the limit as `Error`: every failure
  theorem in the suite would then hold for nothing.
- [E-W1] The same arguments on `always_true.uplc`, which accepts anything.
- `audit_reference_holder_fails_on_exec`: the theorem over `appliedReferenceHolder.exec`. -/

namespace Audit.Classic
open CardanoLedgerApi.V3
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (boxRef)

#prep_uplc auditClassicRefHolderAt177 referenceHolder Lovejoin.Classic.anyPurposeArgs 177
#prep_uplc auditClassicAnyPurposeOnTrue auditClassicAlwaysTrue Lovejoin.Classic.anyPurposeArgs 500

-- [E-G1] A spend errors.
#guard erroredB (appliedReferenceHolder.exec (Data.I 0) (.SpendingScript boxRef none))
-- [E-G2] A mint errors.
#guard erroredB (appliedReferenceHolder.exec (Data.I 0) (.MintingScript ""))

-- [E-F1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (redeemer : Data) (info : ScriptInfo),
  isSuccessful (appliedReferenceHolder.prop redeemer info)]

-- [E-L1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (redeemer : Data) (info : ScriptInfo),
  isUnsuccessful (auditClassicRefHolderAt177.prop redeemer info)]

-- [E-W1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (redeemer : Data) (info : ScriptInfo),
  isUnsuccessful (auditClassicAnyPurposeOnTrue.prop redeemer info)]

theorem audit_reference_holder_fails_on_exec : ∀ (redeemer : Data) (info : ScriptInfo),
    isUnsuccessful (appliedReferenceHolder.exec redeemer info) := by
  blaster (timeout: 540)

end Audit.Classic
