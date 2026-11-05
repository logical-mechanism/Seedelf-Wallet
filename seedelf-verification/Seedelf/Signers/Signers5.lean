import Seedelf.WalletAnyTx
import Seedelf.Signers.Keys
import Blaster

/-! `WalletAnyTx` with 5 signatories, every other field still any `Data`: a Register UTxO moves
iff the proof checks and the one-time key is one of them, and every run returns unit or reaches
`Error`. One of gen-seedelf-signers.py's lengths, 4 to 128 (`Signers4` says why 128). -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

def anyTxRegister5Args (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 s4 s5 : ByteString)
    : List Term :=
  [toTerm (anyTxRegisterSpend r ref g u z gr vkh [.B s1, .B s2, .B s3, .B s4, .B s5])]

#prep_uplc appliedSig5 wallet anyTxRegister5Args 2850

-- The builder's own run at its own limit: the key last of 5 passes (after 1561 steps);
-- missed among 5, the longest run, it reaches Error (after 1586).
#guard endsWithUnit (appliedSig5.exec busyTx spentRef g1 u0 z0 gr0 vkh0 (signerKey 1) (signerKey 2)
    (signerKey 3) (signerKey 4) vkh0)
#guard endsInError (appliedSig5.exec busyTx spentRef g1 u0 z0 gr0 vkh0 (signerKey 1) (signerKey 2)
    (signerKey 3) (signerKey 4) (signerKey 5))

/-- With 5 signatories, a Register UTxO moves iff the proof checks and the one-time key is
one of them. -/
theorem wallet_register_spend_iff_any_tx_5_signers :
  ∀ (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 s4 s5 : ByteString),
    isSuccessful (appliedSig5.prop r ref g u z gr vkh s1 s2 s3 s4 s5) ↔
      (schnorrAccepts g u z gr vkh = true ∧ (vkh = s1 ∨ vkh = s2 ∨ vkh = s3 ∨ vkh = s4 ∨ vkh = s5))
        := by blaster

/-- Every run returns unit, which the ledger accepts, or reaches `Error`. -/
theorem wallet_any_tx_5_signers_unit_or_error :
  ∀ (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 s4 s5 : ByteString),
    returnsUnit (appliedSig5.prop r ref g u z gr vkh s1 s2 s3 s4 s5) ∨
      isUnsuccessful (appliedSig5.prop r ref g u z gr vkh s1 s2 s3 s4 s5) := by blaster

end Seedelf.V1
