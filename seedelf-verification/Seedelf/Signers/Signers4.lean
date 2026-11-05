import Seedelf.WalletAnyTx
import Seedelf.Signers.Keys
import Blaster

/-! `WalletAnyTx` with 4 signatories, every other field still any `Data`: a Register UTxO moves
iff the proof checks and the one-time key is one of them, and every run returns unit or reaches
`Error`. The wallet looks for the key among all of them (`list.has`), so each length is a run of
its own (README rule 4): gen-seedelf-signers.py writes one module a length, 4 to 128, beside
`WalletAnyTx`, `WalletAnyTxTwo` and `WalletAnyTxThree`'s none to three.

Up to 128 is every length the chain allows, and a few more. The ledger bounds the signatories
only by the transaction's size: each needs its 28-byte key hash in the body (30 bytes as CBOR)
and a vkey witness (101 bytes: an array of a 32-byte key and a 64-byte signature), so a
16,384-byte transaction (mainnet's maxTxSize) carries at most 125 of them (125 × 131 = 16,375
bytes), before counting anything else in it.

Each signatory adds 70 steps: the key last among k passes after 1211 + 70k, and missed among k,
the longest run, it reaches `Error` after 1236 + 70k. The limit is 2500 + 70k. -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

def anyTxRegister4Args (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 s4 : ByteString)
    : List Term :=
  [toTerm (anyTxRegisterSpend r ref g u z gr vkh [.B s1, .B s2, .B s3, .B s4])]

#prep_uplc appliedSig4 wallet anyTxRegister4Args 2780

-- The builder's own run at its own limit: the key last of 4 passes (after 1491 steps);
-- missed among 4, the longest run, it reaches Error (after 1516).
#guard endsWithUnit (appliedSig4.exec busyTx spentRef g1 u0 z0 gr0 vkh0 (signerKey 1) (signerKey 2)
    (signerKey 3) vkh0)
#guard endsInError (appliedSig4.exec busyTx spentRef g1 u0 z0 gr0 vkh0 (signerKey 1) (signerKey 2)
    (signerKey 3) (signerKey 4))

/-- With 4 signatories, a Register UTxO moves iff the proof checks and the one-time key is
one of them. -/
theorem wallet_register_spend_iff_any_tx_4_signers :
  ∀ (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 s4 : ByteString),
    isSuccessful (appliedSig4.prop r ref g u z gr vkh s1 s2 s3 s4) ↔
      (schnorrAccepts g u z gr vkh = true ∧ (vkh = s1 ∨ vkh = s2 ∨ vkh = s3 ∨ vkh = s4))
        := by blaster

/-- Every run returns unit, which the ledger accepts, or reaches `Error`. -/
theorem wallet_any_tx_4_signers_unit_or_error :
  ∀ (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 s4 : ByteString),
    returnsUnit (appliedSig4.prop r ref g u z gr vkh s1 s2 s3 s4) ∨
      isUnsuccessful (appliedSig4.prop r ref g u z gr vkh s1 s2 s3 s4) := by blaster

end Seedelf.V1
