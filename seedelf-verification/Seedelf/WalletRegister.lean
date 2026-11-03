import Seedelf.Wallet
import Blaster

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open PlutusCore.Crypto.BLS12_381.G1
open PlutusCore.Crypto.Hash

/-- A Register datum `(g, u)`, any well-formed proof, one signer. -/
def registerArgs (g u z gr vkh signer : ByteString) : List Term :=
  [toTerm (spendCtx (some (.Constr 0 [.B g, .B u])) z gr vkh signer)]

-- Needs the forks lakefile.lean pins (chunk 41), for three gaps upstream (Upstream/):
-- Blaster declared `bls12_381_G1_uncompress`'s `Except` with `Prod`'s parameter
-- names (Lean-blaster #454); `byteStringToInteger` (z and the challenge) folds
-- `Char.toNat` into `Char`'s `BitVec`, so the builtin runs an `opaque` alias; and a
-- G1 coordinate was a `Fin`. Not in check.sh's default list until it proves.
-- 2500 steps: `Steps.lean` measures a valid spend at 1281.
#prep_uplc appliedRegister wallet registerArgs 2500

/-- `schnorrAccepts` with `add`'s and `equal`'s operands in the order PlutusCoreBlaster's
dispatch applies them. The CEK machine hands a builtin its arguments last-first, and
`bls12381G1Add` and `bls12381G1Equal` match that list as `[x, y]` and call `f x y`, so
the script's `equal(g^z, add(g_r, u^c))` runs as `equal(add(u^c, g_r), g^z)`. That's the
same for real points, since both are commutative, but not to the solver, which sees
opaque functions. -/
def schnorrAcceptsAsModelled (g u z gr vkh : ByteString) : Bool :=
  match scalarOf z,
        scalarOf (blake2b_224 (appendByteString (appendByteString (appendByteString g gr) u) vkh)),
        bls12_381_G1_uncompress g, bls12_381_G1_uncompress u, bls12_381_G1_uncompress gr with
  | some zi, some c, .ok G, .ok U, .ok R =>
      bls12_381_G1_equal (bls12_381_G1_add (bls12_381_G1_scalarMul c U) R) (bls12_381_G1_scalarMul zi G)
  | _, _, _, _, _ => false

/-- A Register UTxO moves iff the proof checks and the one-time key signed. -/
theorem wallet_register_spend_iff :
  ∀ (g u z gr vkh signer : ByteString),
    isSuccessful (appliedRegister.prop g u z gr vkh signer) ↔
      (schnorrAcceptsAsModelled g u z gr vkh = true ∧ vkh = signer) := by blaster

-- The same with the operands in the script's order: Falsified (2026-11-03, every input
-- empty), since the model swaps them. Valid once the dispatch passes them in order.
#blaster (gen-cex: 0) (solve-result: 1) [∀ (g u z gr vkh signer : ByteString),
    isSuccessful (appliedRegister.prop g u z gr vkh signer) ↔
      (schnorrAccepts g u z gr vkh = true ∧ vkh = signer)]

end Seedelf.V1
