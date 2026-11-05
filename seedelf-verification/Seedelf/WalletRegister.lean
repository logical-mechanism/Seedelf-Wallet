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

-- Needs the forks lakefile.lean pins (chunk 41), for four gaps upstream: Blaster
-- declared `bls12_381_G1_uncompress`'s `Except` with `Prod`'s parameter names
-- (Lean-blaster #454); `byteStringToInteger` (z and the challenge) folds `Char.toNat`
-- into `Char`'s `BitVec`, so the builtin runs an `opaque` alias; a G1 coordinate was a
-- `Fin`; and the BLS12-381 builtins applied their operands swapped, so this spec, in
-- the script's order, was Falsified.
-- 2500 steps: `Steps.lean` measures a valid spend at 1281.
#prep_uplc appliedRegister wallet registerArgs 2500

/-- A Register UTxO moves iff the proof checks and the one-time key signed. -/
theorem wallet_register_spend_iff :
  ∀ (g u z gr vkh signer : ByteString),
    isSuccessful (appliedRegister.prop g u z gr vkh signer) ↔
      (schnorrAccepts g u z gr vkh = true ∧ vkh = signer) := by blaster

end Seedelf.V1
