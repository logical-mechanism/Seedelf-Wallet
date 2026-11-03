import Seedelf.Wallet
import Blaster

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

/-- A Register datum `(g, u)`, any well-formed proof, one signer. -/
def registerArgs (g u z gr vkh signer : ByteString) : List Term :=
  [toTerm (spendCtx (some (.Constr 0 [.B g, .B u])) z gr vkh signer)]

-- Blocked twice (Upstream/): `byteStringToInteger` (z and the challenge) folds
-- `Char.toNat`, so a symbolic input reaches `Char`'s `BitVec`, unless it's made
-- `opaque` in PlutusCoreBlaster as the crypto builtins are; and the pinned
-- Blaster declares `bls12_381_G1_uncompress`'s `Except` with `Prod`'s parameter
-- names. Not in check.sh's default list.
#prep_uplc appliedRegister wallet registerArgs 2500

/-- A Register UTxO moves iff the proof checks and the one-time key signed. -/
theorem wallet_register_spend_iff :
  ∀ (g u z gr vkh signer : ByteString),
    isSuccessful (appliedRegister.prop g u z gr vkh signer) ↔
      (schnorrAccepts g u z gr vkh = true ∧ vkh = signer) := by blaster

end Seedelf.V1
