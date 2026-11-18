import Seedelf.WalletAnyTxTwo
import Seedelf.WalletAnyTxThree
import Blaster

/-! Negative controls for the Register families in every transaction (`WalletAnyTx`,
`WalletAnyTxTwo`, `WalletAnyTxThree`), each expected Falsified (README rule 8): a control that
comes back Valid prints "❌ Unexpected Valid" and fails the build. Each is one of its family's
theorems with a condition left out, or its outcome turned around, over the family's own builder,
so the solver meets the same script as the theorems do. Were that background contradictory
(Lean-blaster #194), every statement over it would come back Valid, these too.
- One signer, the iff without `vkh = signer`: a proof that checks, signed by another key, errors.
- One signer, the iff without the Schnorr check: the one-time key's signature on a proof that
  fails errors.
- No signer, said to return unit: it errors.
- Two signers, the iff without the second: the key second passes.
- Three signers, the iff without the third: the key third passes. -/

namespace Seedelf.V1
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Utils

#blaster (gen-cex: 0) (solve-result: 1)
  [∀ (r : TxRest) (ref : Data) (g u z gr vkh signer : ByteString),
    isSuccessful (appliedAnyTxRegister.prop r ref g u z gr vkh signer) ↔
      schnorrAccepts g u z gr vkh = true]

#blaster (gen-cex: 0) (solve-result: 1)
  [∀ (r : TxRest) (ref : Data) (g u z gr vkh signer : ByteString),
    isSuccessful (appliedAnyTxRegister.prop r ref g u z gr vkh signer) ↔ vkh = signer]

#blaster (gen-cex: 0) (solve-result: 1)
  [∀ (r : TxRest) (ref : Data) (g u z gr vkh : ByteString),
    returnsUnit (appliedAnyTxRegister0.prop r ref g u z gr vkh)]

#blaster (gen-cex: 0) (solve-result: 1)
  [∀ (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 : ByteString),
    isSuccessful (appliedAnyTxRegister2.prop r ref g u z gr vkh s1 s2) ↔
      (schnorrAccepts g u z gr vkh = true ∧ vkh = s1)]

#blaster (gen-cex: 0) (solve-result: 1)
  [∀ (r : TxRest) (ref : Data) (g u z gr vkh s1 s2 s3 : ByteString),
    isSuccessful (appliedAnyTxRegister3.prop r ref g u z gr vkh s1 s2 s3) ↔
      (schnorrAccepts g u z gr vkh = true ∧ (vkh = s1 ∨ vkh = s2))]

end Seedelf.V1
