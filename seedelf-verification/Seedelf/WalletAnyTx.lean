import Seedelf.Wallet
import Seedelf.AnyTx
import Seedelf.AnyTxSteps
import Blaster

/-! WalletRegister in every transaction. A Register `(g, u)` is spent with the proof
`z, g_r, vkh`, and every other TxInfo field and the spent output's reference are any `Data`
(AnyTx.lean). The deployed bytes read the TxInfo only for its signatories, after the Schnorr
check (`aiken uplc decode`), so the transaction around the spend changes nothing. These
theorems prove that of every transaction, with one signer or none. Two signers and three are
`WalletAnyTxTwo` and `WalletAnyTxThree`.

2500 steps, as WalletRegister: the extra fields add none (AnyTxSteps). -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

/-- A Register `(g, u)` spent with `Proof { z, g_r, vkh }`, signed by `sigs`. -/
def anyTxRegisterSpend (r : TxRest) (ref : Data) (g u z gr vkh : ByteString) (sigs : List Data) : Data :=
  spendIn (r.info sigs) (.Constr 0 [.B z, .B gr, .B vkh]) ref (datumSome (.Constr 0 [.B g, .B u]))

def anyTxRegisterArgs (r : TxRest) (ref : Data) (g u z gr vkh signer : ByteString) : List Term :=
  [toTerm (anyTxRegisterSpend r ref g u z gr vkh [.B signer])]

def anyTxRegister0Args (r : TxRest) (ref : Data) (g u z gr vkh : ByteString) : List Term :=
  [toTerm (anyTxRegisterSpend r ref g u z gr vkh [])]

#prep_uplc appliedAnyTxRegister wallet anyTxRegisterArgs 2500
#prep_uplc appliedAnyTxRegister0 wallet anyTxRegister0Args 2500

-- Each builder's own run at its own limit (README rule 3), in AnyTxSteps' busy transaction:
-- the valid spend returns unit; another signer, or none, reaches Error.
#guard endsWithUnit (appliedAnyTxRegister.exec busyTx spentRef g1 u0 z0 gr0 vkh0 vkh0)
#guard endsInError (appliedAnyTxRegister.exec busyTx spentRef g1 u0 z0 gr0 vkh0 keyA)
#guard endsInError (appliedAnyTxRegister0.exec busyTx spentRef g1 u0 z0 gr0 vkh0)

/-- In every transaction, a Register UTxO moves iff the proof checks and the one-time key
signed. -/
theorem wallet_register_spend_iff_any_tx :
  ∀ (r : TxRest) (ref : Data) (g u z gr vkh signer : ByteString),
    isSuccessful (appliedAnyTxRegister.prop r ref g u z gr vkh signer) ↔
      (schnorrAccepts g u z gr vkh = true ∧ vkh = signer) := by blaster

/-- Without the proof it reaches `Error`: a run cut off by the step limit is no way out. -/
theorem wallet_any_tx_fails_without_the_proof :
  ∀ (r : TxRest) (ref : Data) (g u z gr vkh signer : ByteString),
    schnorrAccepts g u z gr vkh = false →
      isUnsuccessful (appliedAnyTxRegister.prop r ref g u z gr vkh signer) := by blaster

/-- Nor without the one-time key's signature. -/
theorem wallet_any_tx_fails_without_the_signer :
  ∀ (r : TxRest) (ref : Data) (g u z gr vkh signer : ByteString),
    vkh ≠ signer → isUnsuccessful (appliedAnyTxRegister.prop r ref g u z gr vkh signer) := by
  blaster

/-- Every run returns unit, which the ledger accepts, or reaches `Error`. -/
theorem wallet_any_tx_unit_or_error :
  ∀ (r : TxRest) (ref : Data) (g u z gr vkh signer : ByteString),
    returnsUnit (appliedAnyTxRegister.prop r ref g u z gr vkh signer) ∨
      isUnsuccessful (appliedAnyTxRegister.prop r ref g u z gr vkh signer) := by blaster

/-- With no signer at all, nothing moves. -/
theorem wallet_any_tx_no_signer_fails :
  ∀ (r : TxRest) (ref : Data) (g u z gr vkh : ByteString),
    isUnsuccessful (appliedAnyTxRegister0.prop r ref g u z gr vkh) := by blaster

end Seedelf.V1
