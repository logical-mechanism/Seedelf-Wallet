import Seedelf.Wallet
import Seedelf.Policy

/-! Audit · Seedelf (mutation and negative-control suite): what the other `Audit.Seedelf`
modules share. Definitions only: no `#prep_uplc`, no `blaster`.

- Result predicates, read through a match (README rule 6): `haltsWithUnit` for the solver;
  `haltsUnitB`, `errorsB` and `exhaustedB` for `#guard`'s compiled evaluation.
- Mutated specs: `scalarOf` and `schnorrAccepts` (Wallet.lean) with exactly one thing changed.
- Arguments for new scenarios: two signers; the policy's amount and foreign-mint scenarios with
  the token name `generate` gives for their input.
- Two of concrete/wallet_register.sh's honest negative vectors. -/

set_option linter.unusedVariables false

namespace SeedelfAudit
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.Crypto.BLS12_381.G1
open PlutusCore.Crypto.Hash
open PlutusCore.UPLC.BuiltinFunctions.Bitwise (byteStringToIntegerOpaque)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.CekMachine (State)
open Seedelf.V1

/-! ### Results -/

/-- The run halted with the unit constant: what the ledger accepts from a V3 script.
`isSuccessful` is a halt with any value. -/
def haltsWithUnit (s : State) : Prop :=
  match s with
  | .Halt (.VCon .Unit) => True
  | _ => False

/-- `haltsWithUnit`, as a `Bool`, for `#guard`. -/
def haltsUnitB (s : State) : Bool :=
  match s with
  | .Halt (.VCon .Unit) => true
  | _ => false

/-- `isUnsuccessful`, as a `Bool`. -/
def errorsB (s : State) : Bool :=
  match s with
  | .Error => true
  | _ => false

/-- `isExhausted` (cut off at the step limit), as a `Bool`. -/
def exhaustedB (s : State) : Bool :=
  match s with
  | .Eval .. => true
  | .Return .. => true
  | _ => false

/-! ### Mutated scalar decodes (`scalarOf`, one change each) -/

/-- `scalarOf` without its upper bound q. -/
def scalarOfNoBound (b : ByteString) : Option Integer :=
  let n : Integer := .ofNat (byteStringToIntegerOpaque true b.data)
  if 0 ≤ n then some n else none

/-- `scalarOf` with the bound off by one: `n ≤ q`. -/
def scalarOfBoundLe (b : ByteString) : Option Integer :=
  let n : Integer := .ofNat (byteStringToIntegerOpaque true b.data)
  if 0 ≤ n ∧ n ≤ q then some n else none

/-- `scalarOf` without `0 ≤ n`: an equivalent mutant, since the alias returns a `Nat`. -/
def scalarOfNoZeroTest (b : ByteString) : Option Integer :=
  let n : Integer := .ofNat (byteStringToIntegerOpaque true b.data)
  if n < q then some n else none

/-- `scalarOf` decoding little-endian (`byteStringToInteger False`). -/
def scalarOfLittleEndian (b : ByteString) : Option Integer :=
  let n : Integer := .ofNat (byteStringToIntegerOpaque false b.data)
  if 0 ≤ n ∧ n < q then some n else none

/-! ### Mutated specs (`schnorrAccepts`, one change each) -/

/-- z and c decoded with no upper bound. -/
def acceptsNoBound (g u z gr vkh : ByteString) : Bool :=
  match scalarOfNoBound z,
        scalarOfNoBound (blake2b_224 (appendByteString (appendByteString (appendByteString g gr) u) vkh)),
        bls12_381_G1_uncompress g, bls12_381_G1_uncompress u, bls12_381_G1_uncompress gr with
  | some zi, some c, .ok G, .ok U, .ok R =>
      bls12_381_G1_equal (bls12_381_G1_scalarMul zi G) (bls12_381_G1_add R (bls12_381_G1_scalarMul c U))
  | _, _, _, _, _ => false

/-- z and c decoded with `n ≤ q`. -/
def acceptsBoundLe (g u z gr vkh : ByteString) : Bool :=
  match scalarOfBoundLe z,
        scalarOfBoundLe (blake2b_224 (appendByteString (appendByteString (appendByteString g gr) u) vkh)),
        bls12_381_G1_uncompress g, bls12_381_G1_uncompress u, bls12_381_G1_uncompress gr with
  | some zi, some c, .ok G, .ok U, .ok R =>
      bls12_381_G1_equal (bls12_381_G1_scalarMul zi G) (bls12_381_G1_add R (bls12_381_G1_scalarMul c U))
  | _, _, _, _, _ => false

/-- z and c decoded without `0 ≤ n` (equivalent to `schnorrAccepts`). -/
def acceptsNoZeroTest (g u z gr vkh : ByteString) : Bool :=
  match scalarOfNoZeroTest z,
        scalarOfNoZeroTest (blake2b_224 (appendByteString (appendByteString (appendByteString g gr) u) vkh)),
        bls12_381_G1_uncompress g, bls12_381_G1_uncompress u, bls12_381_G1_uncompress gr with
  | some zi, some c, .ok G, .ok U, .ok R =>
      bls12_381_G1_equal (bls12_381_G1_scalarMul zi G) (bls12_381_G1_add R (bls12_381_G1_scalarMul c U))
  | _, _, _, _, _ => false

/-- z and c decoded little-endian. -/
def acceptsLittleEndian (g u z gr vkh : ByteString) : Bool :=
  match scalarOfLittleEndian z,
        scalarOfLittleEndian (blake2b_224 (appendByteString (appendByteString (appendByteString g gr) u) vkh)),
        bls12_381_G1_uncompress g, bls12_381_G1_uncompress u, bls12_381_G1_uncompress gr with
  | some zi, some c, .ok G, .ok U, .ok R =>
      bls12_381_G1_equal (bls12_381_G1_scalarMul zi G) (bls12_381_G1_add R (bls12_381_G1_scalarMul c U))
  | _, _, _, _, _ => false

/-- The challenge over g ‖ u ‖ g_r ‖ vkh: u and g_r swapped. -/
def acceptsHashGURV (g u z gr vkh : ByteString) : Bool :=
  match scalarOf z,
        scalarOf (blake2b_224 (appendByteString (appendByteString (appendByteString g u) gr) vkh)),
        bls12_381_G1_uncompress g, bls12_381_G1_uncompress u, bls12_381_G1_uncompress gr with
  | some zi, some c, .ok G, .ok U, .ok R =>
      bls12_381_G1_equal (bls12_381_G1_scalarMul zi G) (bls12_381_G1_add R (bls12_381_G1_scalarMul c U))
  | _, _, _, _, _ => false

/-- The challenge without the one-time key hash: blake2b_224(g ‖ g_r ‖ u). -/
def acceptsNoVkh (g u z gr vkh : ByteString) : Bool :=
  match scalarOf z,
        scalarOf (blake2b_224 (appendByteString (appendByteString g gr) u)),
        bls12_381_G1_uncompress g, bls12_381_G1_uncompress u, bls12_381_G1_uncompress gr with
  | some zi, some c, .ok G, .ok U, .ok R =>
      bls12_381_G1_equal (bls12_381_G1_scalarMul zi G) (bls12_381_G1_add R (bls12_381_G1_scalarMul c U))
  | _, _, _, _, _ => false

/-- The challenge through blake2b_256. -/
def acceptsBlake256 (g u z gr vkh : ByteString) : Bool :=
  match scalarOf z,
        scalarOf (blake2b_256 (appendByteString (appendByteString (appendByteString g gr) u) vkh)),
        bls12_381_G1_uncompress g, bls12_381_G1_uncompress u, bls12_381_G1_uncompress gr with
  | some zi, some c, .ok G, .ok U, .ok R =>
      bls12_381_G1_equal (bls12_381_G1_scalarMul zi G) (bls12_381_G1_add R (bls12_381_G1_scalarMul c U))
  | _, _, _, _, _ => false

/-- The equation without u^c: g^z = g_r (c and U still decoded, as the script decodes them). -/
def acceptsNoUc (g u z gr vkh : ByteString) : Bool :=
  match scalarOf z,
        scalarOf (blake2b_224 (appendByteString (appendByteString (appendByteString g gr) u) vkh)),
        bls12_381_G1_uncompress g, bls12_381_G1_uncompress u, bls12_381_G1_uncompress gr with
  | some zi, some c, .ok G, .ok U, .ok R =>
      bls12_381_G1_equal (bls12_381_G1_scalarMul zi G) R
  | _, _, _, _, _ => false

/-- `add`'s operands swapped, u^c · g_r: the order the model applied before the fork's Fix 4. -/
def acceptsAddSwapped (g u z gr vkh : ByteString) : Bool :=
  match scalarOf z,
        scalarOf (blake2b_224 (appendByteString (appendByteString (appendByteString g gr) u) vkh)),
        bls12_381_G1_uncompress g, bls12_381_G1_uncompress u, bls12_381_G1_uncompress gr with
  | some zi, some c, .ok G, .ok U, .ok R =>
      bls12_381_G1_equal (bls12_381_G1_scalarMul zi G) (bls12_381_G1_add (bls12_381_G1_scalarMul c U) R)
  | _, _, _, _, _ => false

/-! ### New scenarios -/

/-- `spendCtx` with two signers. -/
def twoSignerCtx (datum : Option Data) (z gr vkh s1 s2 : ByteString) : ScriptContext :=
  let tx := { emptyTx with txInfoSignatories := [s1, s2] }
  ⟨tx, Data.Constr 0 [Data.B z, Data.B gr, Data.B vkh], .SpendingScript ⟨"", 0⟩ datum⟩

/-- A Register datum `(g, u)`, any well-formed proof, signed by `s1` and `s2`. -/
def register2Args (g u z gr vkh s1 s2 : ByteString) : List Term :=
  [toTerm (twoSignerCtx (some (.Constr 0 [.B g, .B u])) z gr vkh s1 s2)]

/-- The name `generate` gives for first input `"\x01"#0` and no tag: 5eed0e1f ‖ 00 ‖ 01.
GuardsCheap checks it against `seedelfName`; Scripts/policy_scenarios.sh, against the bytes. -/
def goodName : ByteString := "\x5e\xed\x0e\x1f\x00\x01"

/-- PolicyAmount's `amountArgs` with `goodName` in place of 5eed0e1f01, so a mint can pass. -/
def amountGoodArgs (n : Integer) : List Term :=
  [toTerm (mintCtx "p" "p" goodName "\x01" "" 0 n)]

/-- PolicyForeign's `foreignMintArgs` with `goodName`. -/
def foreignMintGoodArgs (cs : ByteString) : List Term :=
  [toTerm (mintCtx "p" cs goodName "\x01" "" 0 1)]

/-! ### Honest negative vectors (concrete/wallet_register.sh) -/

/-- Steps.lean's `z0`, its last nibble changed: wallet_register.sh's "z changed". -/
def zChanged : ByteString := ofHex "056ef908426282c4880583e64182838825d5d1de34eef032d26ac5b4244ad9a7"

/-- Another 28-byte key hash: wallet_register.sh's OTHER. -/
def otherKey : ByteString := ofHex "ffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

end SeedelfAudit
