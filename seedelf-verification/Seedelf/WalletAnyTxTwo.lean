import Seedelf.WalletAnyTx
import Blaster

/-! `WalletAnyTx` with two signers, every other field still any `Data`. The wallet looks for the
one-time key among all of them (`list.has`), so each length is a run of its own. seedelf-core's
spends carry one signer or two: giveme.my's collateral key beside the one-time key, in the
ledger's sorted order, so the key is first or second. -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

def anyTxRegister2Args (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 : ByteString) : List Term :=
  [toTerm (anyTxRegisterSpend r ref g u z gr vkh [.B s1, .B s2])]

#prep_uplc appliedAnyTxRegister2 wallet anyTxRegister2Args 2500

-- The builder's own run at its own limit: the key second passes, neither key fails.
#guard endsWithUnit (appliedAnyTxRegister2.exec busyTx spentRef g1 u0 z0 gr0 vkh0 keyA vkh0)
#guard endsInError (appliedAnyTxRegister2.exec busyTx spentRef g1 u0 z0 gr0 vkh0 keyA keyB)

/-- With two signers, a Register UTxO moves iff the proof checks and the one-time key is either
one. -/
theorem wallet_register_spend_iff_any_tx_two_signers :
  ∀ (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 : ByteString),
    isSuccessful (appliedAnyTxRegister2.prop r ref g u z gr vkh s1 s2) ↔
      (schnorrAccepts g u z gr vkh = true ∧ (vkh = s1 ∨ vkh = s2)) := by blaster

theorem wallet_any_tx_two_signers_fails_without_the_proof :
  ∀ (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 : ByteString),
    schnorrAccepts g u z gr vkh = false →
      isUnsuccessful (appliedAnyTxRegister2.prop r ref g u z gr vkh s1 s2) := by blaster

theorem wallet_any_tx_two_signers_fails_without_the_signer :
  ∀ (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 : ByteString),
    vkh ≠ s1 → vkh ≠ s2 →
      isUnsuccessful (appliedAnyTxRegister2.prop r ref g u z gr vkh s1 s2) := by blaster

theorem wallet_any_tx_two_signers_unit_or_error :
  ∀ (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 : ByteString),
    returnsUnit (appliedAnyTxRegister2.prop r ref g u z gr vkh s1 s2) ∨
      isUnsuccessful (appliedAnyTxRegister2.prop r ref g u z gr vkh s1 s2) := by blaster

end Seedelf.V1
