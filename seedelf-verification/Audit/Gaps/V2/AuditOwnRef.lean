import Lovejoin.V2.OwnAny1Spec
import Blaster

/-! Audit (templates), not part of the suite: mix_logic's reference lookup, the anchor
every v2 theorem stands on. In every v2 scenario the one reference input holds the
pool's own NFT, so no theorem varies `read_reference_datum`'s filter
(`assets.quantity_of(input.output.value, policy, name) == 1`) or its
`expect [Input { output, .. }] = carriers`. mix_logic calls it before it looks at the
redeemer, so the Owner withdrawal of one box (`V2.OwnAny1`, every field symbolic) pins it
for the Mix too. With `own_any1_passes_with_every_proof` (the pool's own reference passes),
these say the reference datum mix_logic trusts is the pool's.

Built in place as `Audit.Gaps.V2.AuditOwnRef`, in `./check.sh audit-gaps`, or alone,
`./check.sh Audit.Gaps.V2.AuditOwnRef`. Expected: two `✅ Valid`. -/

namespace Lovejoin.V2.Own1.AuditOwnRef
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Lovejoin.Template (nftName)
open Seedelf.V1 (emptyTx ofHex)

/-- `ownCtx` with the reference inputs `refs`. -/
def ownCtxRefs (refs : List TxInInfo) (M : ByteString) (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer)
    (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer) : ScriptContext :=
  let tx := { emptyTx with
    txInfoInputs          := [⟨ref1, boxOwn M a1 b1⟩,
                              ⟨payerRef, ⟨⟨.PubKeyCredential kp, none⟩, adaOwn pin, .NoOutputDatum, none⟩⟩],
    txInfoReferenceInputs := refs,
    txInfoOutputs         := ownOutputs s g u amt kc ch,
    txInfoWdrl            := [(.ScriptCredential mixLogicHash, 0)] }
  ⟨tx, .Constr 0 [.List [.Constr 0 [.B t1, .B z1]]], .RewardingScript (.ScriptCredential mixLogicHash)⟩

/-- `refInputOwn P M`'s output, at another UTxO. -/
def refInputOwn' (P M : ByteString) : TxInInfo :=
  ⟨⟨ofHex "efefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef", 0⟩,
   ⟨⟨.ScriptCredential referenceHolderHash, none⟩,
    [(Data.B "", Data.Map [(Data.B "", Data.I 2000000)]), (Data.B P, Data.Map [(Data.B nftName, Data.I 1)])],
    .OutputDatum (refDatumOwn M), none⟩⟩

/-- mix_logic's template applied to the pool `P`; its reference input holds `Q`'s NFT. -/
def foreignArgs (P Q M : ByteString) (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString)
    (amt : Integer) (kc : ByteString) (ch : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (ownCtxRefs [refInputOwn Q M] M a1 b1 t1 z1 kp pin s g u amt kc ch)]

/-- Two reference inputs hold the pool's NFT. -/
def twoRefsArgs (P M : ByteString) (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString)
    (amt : Integer) (kc : ByteString) (ch : Integer) : List Term :=
  [toTerm P, toTerm nftName, toTerm (ownCtxRefs [refInputOwn P M, refInputOwn' P M] M a1 b1 t1 z1 kp pin s g u amt kc ch)]

#prep_uplc appliedAuditOwnForeignRef mixLogicTemplate foreignArgs 10000
#prep_uplc appliedAuditOwnTwoRefs mixLogicTemplate twoRefsArgs 10000

/-- A reference input with another policy's `lovejoin` isn't the pool's: the withdrawal
fails whatever the box, its proof and the outputs. -/
theorem owner_refuses_a_foreign_reference :
    ∀ (P Q M : ByteString) (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString)
      (amt : Integer) (kc : ByteString) (ch : Integer),
      Q ≠ P → isUnsuccessful (appliedAuditOwnForeignRef.prop P Q M a1 b1 t1 z1 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

/-- Two reference inputs holding the pool's NFT fail too. -/
theorem owner_refuses_two_references :
    ∀ (P M : ByteString) (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer) (s g u : ByteString)
      (amt : Integer) (kc : ByteString) (ch : Integer),
      isUnsuccessful (appliedAuditOwnTwoRefs.prop P M a1 b1 t1 z1 kp pin s g u amt kc ch) := by
  blaster (timeout: 540)

end Lovejoin.V2.Own1.AuditOwnRef
