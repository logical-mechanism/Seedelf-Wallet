import Lovejoin.Owner
import Blaster

/-! Audit (impact judge, trust-anchor-unpinned), not part of the suite: the classic pool's
reference lookup, which 1.8.0's returns (the classic Owner withdrawals) stand on. In every
classic scenario the one reference input is the deployed one, so no theorem varies
`read_reference_datum`'s policy filter. This is `Lovejoin.Owner`'s scenario with the
reference input's NFT under a policy `Q` instead of the pool's `nftPolicy`; at `Q = nftPolicy`
it is that scenario exactly (`ownerCtxQ_at_the_pool`, by `rfl`), whose iff is
`owner_withdraws_iff_proof` and whose honest run halts after 3099 steps (`Lovejoin.Steps`),
so the failure below is the policy's, not the scenario's (README rule 3).

Runs with `./check.sh audit-gaps` (alone, `./check.sh Audit.Gaps.Classic.AuditClassicRef`).
Expected: `ok`, one `✅ Valid` (`classic_owner_refuses_a_foreign_reference`), and
`ownerCtxQ_at_the_pool` elaborating. -/

namespace Lovejoin.Classic.AuditClassicRef
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (emptyTx ofHex)

/-- The deployed reference UTxO, its `lovejoin` token under the policy `Q`. -/
def referenceInputQ (Q : ByteString) : TxInInfo :=
  ⟨⟨ofHex "f89cb43a55eed378fe90fe954a9d86566280e6416d97f9008937ab492b37175c", 0⟩,
   ⟨⟨.ScriptCredential referenceHolderHash, none⟩,
    [(Data.B "", Data.Map [(Data.B "", Data.I 1521430)]), (Data.B Q, Data.Map [(Data.B "lovejoin", Data.I 1)])],
    .OutputDatum referenceDatum, none⟩⟩

/-- `ownerCtx`, its reference input `referenceInputQ Q`. -/
def ownerCtxQ (Q a b t z : ByteString) (out : TxOut) : ScriptContext :=
  let tx := { emptyTx with
    txInfoInputs          := [⟨boxRef, box (.OutputDatum (mixDatum a b))⟩],
    txInfoReferenceInputs := [referenceInputQ Q],
    txInfoOutputs         := [out],
    txInfoWdrl            := [(.ScriptCredential mixLogicHash, 0)] }
  ⟨tx, .Constr 0 [.List [.Constr 0 [.B t, .B z]]], .RewardingScript (.ScriptCredential mixLogicHash)⟩

/-- At the pool's own policy it is `Lovejoin.Owner`'s scenario. -/
theorem ownerCtxQ_at_the_pool : ∀ (a b t z : ByteString) (out : TxOut),
    ownerCtxQ nftPolicy a b t z out = ownerCtx a b t z out := fun _ _ _ _ _ => rfl

def foreignArgs (Q a b t z pkh : ByteString) (amt : Integer) : List Term :=
  [toTerm (ownerCtxQ Q a b t z (payout pkh amt))]

#prep_uplc appliedAuditClassicForeignRef mixLogic foreignArgs 10000

/-- A reference input whose `lovejoin` is another policy's isn't the pool's: the withdrawal
fails whatever the box, its proof and the payout. -/
theorem classic_owner_refuses_a_foreign_reference : ∀ (Q a b t z pkh : ByteString) (amt : Integer),
    Q ≠ nftPolicy → isUnsuccessful (appliedAuditClassicForeignRef.prop Q a b t z pkh amt) := by
  blaster

end Lovejoin.Classic.AuditClassicRef
