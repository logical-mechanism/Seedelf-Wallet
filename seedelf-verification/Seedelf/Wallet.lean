import Seedelf.Scripts
import Seedelf.Scenario

/-! The wallet (94bca9c0…): what its modules share. A concrete spend takes at
most about 233 CEK steps when the datum isn't a Register, and 432 when it is
(23,295 and 43,204 memory units, `aiken uplc eval`). The crypto builtins are
`opaque` in PlutusCoreBlaster, so the properties say what the bytes check, not
that the check is hard to fool. -/

namespace Seedelf.V1
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.Crypto.BLS12_381.G1
open PlutusCore.Crypto.Hash
open PlutusCore.UPLC.BuiltinFunctions.Bitwise (byteStringToIntegerOpaque)

/-- Spending `#0` of an empty id, with `datum` and the redeemer
`Proof { z_b, g_r_b, vkh }`, signed by `signer` alone. -/
def spendCtx (datum : Option Data) (z gr vkh signer : ByteString) : ScriptContext :=
  let tx := { emptyTx with txInfoSignatories := [signer] }
  ⟨tx, Data.Constr 0 [Data.B z, Data.B gr, Data.B vkh], .SpendingScript ⟨"", 0⟩ datum⟩

def isSpending : ScriptInfo → Bool
  | .SpendingScript .. => true
  | _ => false

/-- The datum, when it's exactly a `Register { generator, public_value }`. -/
def registerOf : Option Data → Option (ByteString × ByteString)
  | some (.Constr 0 [.B g, .B u]) => some (g, u)
  | _ => none

/-- BLS12-381's scalar field order, `scalar.from_bytearray_big_endian`'s bound. -/
def q : Integer := 52435875175126190479447740508185965837690552500527637822603658699938581184513

/-- `scalar.from_bytearray_big_endian`, through the alias the `ByteStringToInteger`
builtin runs (our PlutusCoreBlaster fork), so the spec and the script share one
uninterpreted conversion. -/
def scalarOf (b : ByteString) : Option Integer :=
  let n : Integer := .ofNat (byteStringToIntegerOpaque true b.data)
  if 0 ≤ n ∧ n < q then some n else none

/-- `schnorr.prove`, over the builtins themselves:
g^z = g_r · u^c with c = blake2b_224(g ‖ g_r ‖ u ‖ vkh). -/
def schnorrAccepts (g u z gr vkh : ByteString) : Bool :=
  match scalarOf z,
        scalarOf (blake2b_224 (appendByteString (appendByteString (appendByteString g gr) u) vkh)),
        bls12_381_G1_uncompress g, bls12_381_G1_uncompress u, bls12_381_G1_uncompress gr with
  | some zi, some c, .ok G, .ok U, .ok R =>
      bls12_381_G1_equal (bls12_381_G1_scalarMul zi G) (bls12_381_G1_add R (bls12_381_G1_scalarMul c U))
  | _, _, _, _, _ => false

end Seedelf.V1
