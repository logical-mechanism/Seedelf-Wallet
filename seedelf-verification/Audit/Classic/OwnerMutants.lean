import Lovejoin.Owner
import Lovejoin.Steps
import Audit.Classic.MutantScripts
import Audit.Classic.OwnerSpecs
import Audit.Classic.Common
import Blaster

/-! Mutation tests for `Lovejoin.Classic.owner_withdraws_iff_proof`: the same arguments
(`ownerArgs`, 10000 steps) on two mutants of the deployed mix_logic, each with one line of
validate_owner's `ctx` removed (`Audit.Classic.MutantScripts`). With the deployed script and
the deployed spec Valid, the four cells together show the iff tracks exactly what the bytes hash:

|                      | deployed spec           | the mutant's own spec |
|----------------------|-------------------------|-----------------------|
| deployed script      | Valid (the theorem)     | Falsified ([A-S2], [A-S3], in `OwnerSpecA`) |
| a mutant script      | Falsified ([A-M1..2])   | Valid ([A-M3..4])     |

Expected: 2 `#guard`s pass, **2 "✅ Expected Falsified" lines, and 2 "✅ Valid" lines**.

- [A-M0a..b] Concretely, the honest vector, which the deployed script accepts, errors on both
  mutants: they hash a different `ctx`.
- [A-M1..2] A Valid result would mean the proof can't tell a mix_logic that leaves the input
  refs (F-4's fix) or the payout out of `ctx` from the deployed one: the binding claims would
  rest on the spec alone.
- [A-M3..4] Each mutant against the spec that says what it does. A "Goal was falsified" here is
  most likely a mismatch between that spec and the mutant's bytes (my reading of them), not a
  flaw in the deployed pool; a counterexample (`gen-cex`) says where. -/

namespace Audit.Classic
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (ownerVector ownerAccepts payout)
open Seedelf.V1 (g1 ofHex)

#prep_uplc auditClassicOwnerNoRefs auditClassicMixLogicNoRefs Lovejoin.Classic.ownerArgs 10000
#prep_uplc auditClassicOwnerNoOutputs auditClassicMixLogicNoOutputs Lovejoin.Classic.ownerArgs 10000

def mutantPkh0 : ByteString := ofHex "00112233445566778899aabbccddeeff00112233445566778899aabb"

-- [A-M0a] The honest vector errors on the no-refs mutant.
#guard match ownerVector with
  | some (b, t, z) => erroredB (auditClassicOwnerNoRefs.exec g1 b t z mutantPkh0 9000000)
  | none => false

-- [A-M0b] And on the no-outputs mutant.
#guard match ownerVector with
  | some (b, t, z) => erroredB (auditClassicOwnerNoOutputs.exec g1 b t z mutantPkh0 9000000)
  | none => false

-- [A-M1] The no-refs mutant against the deployed spec.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a b t z pkh : ByteString) (amt : Integer),
  isSuccessful (auditClassicOwnerNoRefs.prop a b t z pkh amt) ↔ ownerAccepts a b t z (payout pkh amt) = true]

-- [A-M2] The no-outputs mutant against the deployed spec.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a b t z pkh : ByteString) (amt : Integer),
  isSuccessful (auditClassicOwnerNoOutputs.prop a b t z pkh amt) ↔ ownerAccepts a b t z (payout pkh amt) = true]

/-- [A-M3] The no-refs mutant is exactly `ownerAcceptsNoRefs`. -/
theorem audit_owner_no_refs_mutant_iff : ∀ (a b t z pkh : ByteString) (amt : Integer),
    isSuccessful (auditClassicOwnerNoRefs.prop a b t z pkh amt) ↔ ownerAcceptsNoRefs a b t z (payout pkh amt) = true := by
  blaster (timeout: 540)

/-- [A-M4] The no-outputs mutant is exactly `ownerAcceptsNoOutputs`. -/
theorem audit_owner_no_outputs_mutant_iff : ∀ (a b t z pkh : ByteString) (amt : Integer),
    isSuccessful (auditClassicOwnerNoOutputs.prop a b t z pkh amt) ↔ ownerAcceptsNoOutputs a b t z (payout pkh amt) = true := by
  blaster (timeout: 540)

end Audit.Classic
