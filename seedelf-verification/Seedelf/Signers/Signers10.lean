import Seedelf.WalletAnyTx
import Seedelf.Signers.Keys
import Blaster

/-! `WalletAnyTx` with 10 signatories, every other field still any `Data`: a Register UTxO moves
iff the proof checks and the one-time key is one of them, and every run returns unit or reaches
`Error`. One of gen-seedelf-signers.py's lengths, 4 to 128 (`Signers4` says why 128). -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

def anyTxRegister10Args (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9
    s10 : ByteString) : List Term :=
  [toTerm (anyTxRegisterSpend r ref g u z gr vkh [.B s1, .B s2, .B s3, .B s4, .B s5, .B s6, .B s7,
    .B s8, .B s9, .B s10])]

#prep_uplc appliedSig10 wallet anyTxRegister10Args 3200

-- The builder's own run at its own limit: the key last of 10 passes (after 1911 steps);
-- missed among 10, the longest run, it reaches Error (after 1936).
#guard endsWithUnit (appliedSig10.exec busyTx spentRef g1 u0 z0 gr0 vkh0 (signerKey 1) (signerKey 2)
    (signerKey 3) (signerKey 4) (signerKey 5) (signerKey 6) (signerKey 7) (signerKey 8)
    (signerKey 9) vkh0)
#guard endsInError (appliedSig10.exec busyTx spentRef g1 u0 z0 gr0 vkh0 (signerKey 1) (signerKey 2)
    (signerKey 3) (signerKey 4) (signerKey 5) (signerKey 6) (signerKey 7) (signerKey 8)
    (signerKey 9) (signerKey 10))

/-- With 10 signatories, a Register UTxO moves iff the proof checks and the one-time key is
one of them. -/
theorem wallet_register_spend_iff_any_tx_10_signers :
  ∀ (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 : ByteString),
    isSuccessful (appliedSig10.prop r ref g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10) ↔
      (schnorrAccepts g u z gr vkh = true ∧ (vkh = s1 ∨ vkh = s2 ∨ vkh = s3 ∨ vkh = s4 ∨ vkh = s5 ∨
        vkh = s6 ∨ vkh = s7 ∨ vkh = s8 ∨ vkh = s9 ∨ vkh = s10)) := by blaster

/-- Every run returns unit, which the ledger accepts, or reaches `Error`. -/
theorem wallet_any_tx_10_signers_unit_or_error :
  ∀ (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 : ByteString),
    returnsUnit (appliedSig10.prop r ref g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10) ∨
      isUnsuccessful (appliedSig10.prop r ref g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10)
        := by blaster

end Seedelf.V1
