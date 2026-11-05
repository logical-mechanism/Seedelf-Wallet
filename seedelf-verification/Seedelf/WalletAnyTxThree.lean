import Seedelf.WalletAnyTx
import Blaster

/-! `WalletAnyTx` with three signers, every other field still any `Data`: more than any spend
seedelf-core builds, and the longest run here (the key looked for and missed among three). -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

def anyTxRegister3Args (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 : ByteString) : List Term :=
  [toTerm (anyTxRegisterSpend r ref g u z gr vkh [.B s1, .B s2, .B s3])]

#prep_uplc appliedAnyTxRegister3 wallet anyTxRegister3Args 2500

-- The builder's own run at its own limit: the key third passes; missed among three, the
-- longest run here, it reaches Error inside 2500 (about 1450 steps, AnyTxSteps).
#guard endsWithUnit (appliedAnyTxRegister3.exec busyTx spentRef g1 u0 z0 gr0 vkh0 keyA keyB vkh0)
#guard endsInError (appliedAnyTxRegister3.exec busyTx spentRef g1 u0 z0 gr0 vkh0 keyA keyB keyC)

/-- With three signers, a Register UTxO moves iff the proof checks and the one-time key is one
of them. -/
theorem wallet_register_spend_iff_any_tx_three_signers :
  ∀ (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 : ByteString),
    isSuccessful (appliedAnyTxRegister3.prop r ref g u z gr vkh s1 s2 s3) ↔
      (schnorrAccepts g u z gr vkh = true ∧ (vkh = s1 ∨ vkh = s2 ∨ vkh = s3)) := by blaster

theorem wallet_any_tx_three_signers_fails_without_the_proof :
  ∀ (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 : ByteString),
    schnorrAccepts g u z gr vkh = false →
      isUnsuccessful (appliedAnyTxRegister3.prop r ref g u z gr vkh s1 s2 s3) := by blaster

theorem wallet_any_tx_three_signers_fails_without_the_signer :
  ∀ (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 : ByteString),
    vkh ≠ s1 → vkh ≠ s2 → vkh ≠ s3 →
      isUnsuccessful (appliedAnyTxRegister3.prop r ref g u z gr vkh s1 s2 s3) := by blaster

theorem wallet_any_tx_three_signers_unit_or_error :
  ∀ (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 : ByteString),
    returnsUnit (appliedAnyTxRegister3.prop r ref g u z gr vkh s1 s2 s3) ∨
      isUnsuccessful (appliedAnyTxRegister3.prop r ref g u z gr vkh s1 s2 s3) := by blaster

end Seedelf.V1
