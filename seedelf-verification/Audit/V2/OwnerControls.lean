import Lovejoin.V2.Owner
import Audit.V2.Common
import Blaster

/-! Negative controls and mutants for v2's Owner withdrawal of one box,
`owner_withdraws_iff_proof`. Five `✅ Expected Falsified`, two theorems `✅ Valid`.

1. Some withdrawal succeeds, and 2. some satisfies `ownerAccepts`: the iff isn't
   `False ↔ False`.
3. The iff with `wellFormed` dropped from the right-hand side, and 4. with the equation's
   `c·u` replaced by `c·a` (`auditSchnorrCBase`): it pins the spec.
5. The iff with its right-hand side negated.
6. No run is cut off at the limit, 10000: the iff covers every run, not only those that
   finish. 7. Every halt is the unit constant. -/

namespace Lovejoin.V2
open CardanoLedgerApi.IsData.Class (IsData)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (payout schnorrVerifies wellFormed)
open Audit.V2

/-- `ownerAccepts` without `wellFormed`. -/
def auditOwnerAcceptsNoWellFormed (a b t z : ByteString) (out : TxOut) : Bool :=
  match ownerContext (IsData.toData ([out] : List TxOut)) (Data.List [IsData.toData boxRef]) with
  | some ctx => schnorrVerifies a b t z ctx
  | none => false

/-- `ownerAccepts` over `auditSchnorrCBase`. -/
def auditOwnerAcceptsCBase (a b t z : ByteString) (out : TxOut) : Bool :=
  wellFormed a b &&
    match ownerContext (IsData.toData ([out] : List TxOut)) (Data.List [IsData.toData boxRef]) with
    | some ctx => auditSchnorrCBase a b t z ctx
    | none => false

-- 1. Some withdrawal succeeds.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (a b t z pkh : ByteString) (amt : Integer),
    ¬ isSuccessful (appliedOwnerV2.prop a b t z pkh amt)]

-- 2. Some withdrawal satisfies the spec.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (a b t z pkh : ByteString) (amt : Integer),
    ownerAccepts a b t z (payout pkh amt) = false]

-- 3. The iff without wellFormed.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (a b t z pkh : ByteString) (amt : Integer),
    isSuccessful (appliedOwnerV2.prop a b t z pkh amt) ↔ auditOwnerAcceptsNoWellFormed a b t z (payout pkh amt) = true]

-- 4. The iff over a wrong equation (c·a for c·u).
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (a b t z pkh : ByteString) (amt : Integer),
    isSuccessful (appliedOwnerV2.prop a b t z pkh amt) ↔ auditOwnerAcceptsCBase a b t z (payout pkh amt) = true]

-- 5. The iff, its right-hand side negated.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300)
  [∀ (a b t z pkh : ByteString) (amt : Integer),
    isSuccessful (appliedOwnerV2.prop a b t z pkh amt) ↔ ownerAccepts a b t z (payout pkh amt) = false]

/-- 6. Every run of `V2.Owner`'s preparation halts or errors within 10000 steps. -/
theorem audit_owner_run_ends :
    ∀ (a b t z pkh : ByteString) (amt : Integer),
      isSuccessful (appliedOwnerV2.prop a b t z pkh amt) ∨ isUnsuccessful (appliedOwnerV2.prop a b t z pkh amt) := by
  blaster (timeout: 540)

/-- 7. Every halt of `V2.Owner`'s preparation is the unit constant. -/
theorem audit_owner_halts_with_unit :
    ∀ (a b t z pkh : ByteString) (amt : Integer),
      isSuccessful (appliedOwnerV2.prop a b t z pkh amt) → auditHaltsWithUnit (appliedOwnerV2.prop a b t z pkh amt) := by
  blaster (timeout: 540)

end Lovejoin.V2
