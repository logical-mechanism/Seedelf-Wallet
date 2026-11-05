import Lovejoin.V2.MixSpec

/-! Helpers for the V2 audit suite: mutation and negative controls for v2's general Mix and
Owner families.

- Result predicates on a run's last `State`, each a match (README rule 6): halted with the
  unit constant, which is what the ledger accepts from a V3 script, as a `Prop` for Blaster
  and a `Bool` for `#guard`; and reached `Error`.
- Two trivial scripts of three arguments, for wrong-script controls: one returns unit
  whatever it's given, one fails.
- Spec mutants, one term changed each: `V2.MixSpec`'s `branchHolds`, `Lovejoin.Classic`'s
  `schnorrVerifies` and `wellFormed`.
- Three mutants of mix_logic's v2 template, `Scripts/<name>.diff`: lovejoin-v2 5cc3631 with
  one change each, built with Aiken v1.1.24 in a scratch copy whose unmodified build gave
  `Template/Scripts/mix_logic.hex` byte for byte (7fb45b75…). M1 checks one equation per
  sigma-OR branch (c3fd53d2…), M2 drops walk_outputs' `output.value == box_value`
  (fcf9d0c3…), M3 has validate_owner verify only the first proof (38d6f055…).
  `Scripts/build-mutants.sh` rebuilds each and compares; `Scripts/cross-check.py` runs the
  template and each mutant through Aiken's evaluator on the KAT and on box out 2 a lovelace
  more (template, M1, M3: unit then crashed; M2: unit both). -/

namespace Audit.V2
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Crypto.BLS12_381.G1
open PlutusCore.UPLC.BuiltinFunctions.Bitwise (byteStringToIntegerOpaque)
open PlutusCore.UPLC.CekMachine (State)
open PlutusCore.UPLC.PlutusScript (PlutusScript)
open Lovejoin.Classic (q fsHashSchnorr)

/-- The run halted with the unit constant. -/
def auditHaltsWithUnit (s : State) : Prop :=
  match s with
  | .Halt (.VCon .Unit) => True
  | _ => False

/-- `auditHaltsWithUnit`, computable, for `#guard`. -/
def auditHaltsUnit (s : State) : Bool :=
  match s with
  | .Halt (.VCon .Unit) => true
  | _ => false

/-- The run reached `Error`, for `#guard`. -/
def auditErrors (s : State) : Bool :=
  match s with
  | .Error => true
  | _ => false

/-- Three arguments, then unit: accepts every transaction. -/
def auditAcceptAll : PlutusScript :=
  { lang := .PlutusV3
    script := .Program (.Version 1 1 0) (.Lam (.Lam (.Lam (.Const .Unit)))) }

/-- Three arguments, then `Error`. -/
def auditRejectAll : PlutusScript :=
  { lang := .PlutusV3
    script := .Program (.Version 1 1 0) (.Lam (.Lam (.Lam .Error))) }

/-- `Lovejoin.V2.branchHolds` with one term changed: the first equation adds `T1` where the
script adds `T0`. -/
def auditBranchHoldsT1 (a b ap bp t0 t1 c z : ByteString) : Bool :=
  match bls12_381_G1_uncompress a, bls12_381_G1_uncompress b, bls12_381_G1_uncompress ap,
        bls12_381_G1_uncompress bp, bls12_381_G1_uncompress t0, bls12_381_G1_uncompress t1 with
  | .ok A, .ok B, .ok AP0, .ok BP0, .ok _, .ok T1 =>
      match bls12_381_G1_uncompress (bls12_381_G1_compress AP0),
            bls12_381_G1_uncompress (bls12_381_G1_compress BP0) with
      | .ok AP, .ok BP =>
          let zi : Integer := .ofNat (byteStringToIntegerOpaque true z.data)
          if lengthOfByteString z == 32 && decide (zi < q) then
            let zs := Int.fmod zi q
            let cs := Int.fmod (.ofNat (byteStringToIntegerOpaque true c.data)) q
            bls12_381_G1_equal (bls12_381_G1_scalarMul zs A) (bls12_381_G1_add T1 (bls12_381_G1_scalarMul cs AP)) &&
              bls12_381_G1_equal (bls12_381_G1_scalarMul zs B) (bls12_381_G1_add T1 (bls12_381_G1_scalarMul cs BP))
          else false
      | _, _ => false
  | _, _, _, _, _, _ => false

/-- `Lovejoin.Classic.schnorrVerifies` with one term changed: `z·base = t + c·base`, where
schnorr.ak has `c·u`. -/
def auditSchnorrCBase (base u t z ctx : ByteString) : Bool :=
  match bls12_381_G1_uncompress base, bls12_381_G1_uncompress u, bls12_381_G1_uncompress t with
  | .ok B, .ok _, .ok T =>
      let zi : Integer := .ofNat (byteStringToIntegerOpaque true z.data)
      if lengthOfByteString z == 32 && decide (zi < q) then
        let c := Int.fmod (.ofNat (byteStringToIntegerOpaque true (fsHashSchnorr base u t ctx).data)) q
        bls12_381_G1_equal (bls12_381_G1_scalarMul (Int.fmod zi q) B)
          (bls12_381_G1_add T (bls12_381_G1_scalarMul c B))
      else false
  | _, _, _ => false

/-- `Lovejoin.Classic.wellFormed` with one term changed: 47-byte points where the script wants 48. -/
def auditWellFormed47 (a b : ByteString) : Bool :=
  lengthOfByteString a == 47 && lengthOfByteString b == 47 && a != b

end Audit.V2

#import_uplc auditV2MixLogicOneEq PlutusV3 single_cbor_hex "Audit/V2/Scripts/mix_logic_one_equation.hex"
#import_uplc auditV2MixLogicNoValue PlutusV3 single_cbor_hex "Audit/V2/Scripts/mix_logic_no_value_check.hex"
#import_uplc auditV2MixLogicOwnerFirst PlutusV3 single_cbor_hex "Audit/V2/Scripts/mix_logic_owner_first_proof_only.hex"
