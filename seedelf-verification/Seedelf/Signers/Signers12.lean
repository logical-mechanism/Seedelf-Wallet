import Seedelf.WalletAnyTx
import Seedelf.Signers.Keys
import Blaster

/-! `WalletAnyTx` with 12 signatories, every other field still any `Data`: a Register UTxO moves
iff the proof checks and the one-time key is one of them, and every run returns unit or reaches
`Error`. One of gen-seedelf-signers.py's lengths, 4 to 128 (`Signers4` says why 128). -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

def anyTxRegister12Args (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11
    s12 : ByteString) : List Term :=
  [toTerm (anyTxRegisterSpend r ref g u z gr vkh [.B s1, .B s2, .B s3, .B s4, .B s5, .B s6, .B s7,
    .B s8, .B s9, .B s10, .B s11, .B s12])]

#prep_uplc appliedSig12 wallet anyTxRegister12Args 3340

-- The builder's own run at its own limit: the key last of 12 passes (after 2051 steps);
-- missed among 12, the longest run, it reaches Error (after 2076).
#guard endsWithUnit (appliedSig12.exec busyTx spentRef g1 u0 z0 gr0 vkh0 (signerKey 1) (signerKey 2)
    (signerKey 3) (signerKey 4) (signerKey 5) (signerKey 6) (signerKey 7) (signerKey 8)
    (signerKey 9) (signerKey 10) (signerKey 11) vkh0)
#guard endsInError (appliedSig12.exec busyTx spentRef g1 u0 z0 gr0 vkh0 (signerKey 1) (signerKey 2)
    (signerKey 3) (signerKey 4) (signerKey 5) (signerKey 6) (signerKey 7) (signerKey 8)
    (signerKey 9) (signerKey 10) (signerKey 11) (signerKey 12))

/-- With 12 signatories, a Register UTxO moves iff the proof checks and the one-time key is
one of them. -/
theorem wallet_register_spend_iff_any_tx_12_signers :
  ∀ (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12 : ByteString),
    isSuccessful (appliedSig12.prop r ref g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12) ↔
      (schnorrAccepts g u z gr vkh = true ∧ (vkh = s1 ∨ vkh = s2 ∨ vkh = s3 ∨ vkh = s4 ∨ vkh = s5 ∨
        vkh = s6 ∨ vkh = s7 ∨ vkh = s8 ∨ vkh = s9 ∨ vkh = s10 ∨ vkh = s11 ∨ vkh = s12))
        := by blaster

/-- Every run returns unit, which the ledger accepts, or reaches `Error`. -/
theorem wallet_any_tx_12_signers_unit_or_error :
  ∀ (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12 : ByteString),
    returnsUnit (appliedSig12.prop r ref g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12) ∨
      isUnsuccessful (appliedSig12.prop r ref g u z gr vkh s1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12)
        := by blaster

end Seedelf.V1
