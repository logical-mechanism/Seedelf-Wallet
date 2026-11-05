import Lovejoin.AnyTx.LogicOwnerScalarSteps

/-! Owner verifier behavior when a scalar or curve point is invalid. -/
namespace Lovejoin.AnyTx.LogicOwnerPartial
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Crypto.BLS12_381.G1
open PlutusCore.UPLC.BuiltinFunctions.Bitwise (byteStringToIntegerOpaque)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.Classic (q schnorrVerifies)

def checkedSchnorr (a b t z ctx : ByteString) : Option Bool :=
  if PlutusCore.ByteString.lengthOfByteString z = 32 ∧
      (Int.ofNat (byteStringToIntegerOpaque true z.data) : Integer) < q then
    match bls12_381_G1_uncompress a, bls12_381_G1_uncompress t, bls12_381_G1_uncompress b with
    | .ok _, .ok _, .ok _ => some (schnorrVerifies a b t z ctx)
    | _, _, _ => none
  else none

theorem uncompress_error (x : ByteString) (message : String)
    (h : bls12_381_G1_uncompress x = .error message) :
    Ap default (.VBuiltin .Bls12_381_G1_uncompress [] (.One .ArgV)) (.VCon (.ByteString x)) none := by
  apply ap_builtin
  simp [PlutusCore.UPLC.BuiltinFunctions.Evaluate.evaluateBuiltinFunction,
    PlutusCore.UPLC.BuiltinFunctions.Crypto.bls12381G1Uncompress, h]
  rfl

theorem uncompress_ok (x : ByteString) (point : BLS12_381_G1_Element)
    (h : bls12_381_G1_uncompress x = .ok point) :
    Ap default (.VBuiltin .Bls12_381_G1_uncompress [] (.One .ArgV)) (.VCon (.ByteString x))
      (some (.VCon (.Bls12_381_G1_element point))) := by
  apply ap_builtin
  simp [PlutusCore.UPLC.BuiltinFunctions.Evaluate.evaluateBuiltinFunction,
    PlutusCore.UPLC.BuiltinFunctions.Crypto.bls12381G1Uncompress, h]
  rfl

/-- For any encoded box and proof bytes, the actual Owner closure either
errors on invalid scalar/points or returns the modeled Schnorr boolean. -/
theorem predicate_matches_partial (slots : Fin 41 → CekValue)
    (rest selectorRest challengeRest scalarRest : Environment)
    (selectorSlots : Fin 19 → CekValue) (scalarTop : Fin 2 → CekValue) (scalarMiddle : Fin 21 → CekValue)
    (a b t z ctx : ByteString)
    (hCtx : slots ⟨0, by decide⟩ = .VCon (.ByteString ctx))
    (hScalarSlot : slots ⟨4, by decide⟩ = LogicOwnerScalar.scalarValue scalarTop scalarMiddle scalarRest)
    (hChallengeSlot : slots ⟨7, by decide⟩ = LogicOwnerScalar.challengeValue challengeRest)
    (hSelectorSlot : slots ⟨14, by decide⟩ = LogicReferenceFilter.selectorValue selectorSlots selectorRest)
    (hSnd : slots ⟨32, by decide⟩ = .VBuiltin .SndPair [] (.One .ArgV))
    (hHead : slots ⟨35, by decide⟩ = .VBuiltin .HeadList [] (.One .ArgV)) :
    Ev default LogicOwnerVerifier.predicateBody
      (.VCon (.Data (.Constr 0 [.B t, .B z])) :: .VCon (.Data (.Constr 0 [.B a, .B b])) ::
        LogicOwnerVerifier.predicateEnv slots rest)
      ((checkedSchnorr a b t z ctx).map fun result => .VCon (.Bool result)) := by
  let scalar := LogicOwnerScalar.scalarValue scalarTop scalarMiddle scalarRest
  let selector := LogicReferenceFilter.selectorValue selectorSlots selectorRest
  have hSelect := LogicReferenceFilter.selector_second selectorSlots selectorRest
  by_cases hLen : PlutusCore.ByteString.lengthOfByteString z = 32
  · by_cases hRange : (Int.ofNat (byteStringToIntegerOpaque true z.data) : Integer) < q
    · have hScalar := LogicOwnerScalarSteps.scalar_valid scalarTop scalarMiddle scalarRest z hLen hRange
      cases ha : bls12_381_G1_uncompress a with
      | error msg =>
        have hErr := LogicOwnerVerifier.predicate_base_error slots rest scalar selector a b t z _
          hScalarSlot hSelectorSlot hSnd hHead hSelect hScalar (uncompress_error a msg ha)
        simpa only [checkedSchnorr, hLen, hRange, and_self, ↓reduceIte, ha, Option.map_none] using hErr
      | ok base =>
        cases ht : bls12_381_G1_uncompress t with
        | error msg =>
          have hErr := LogicOwnerVerifier.predicate_commit_error slots rest scalar selector a b t z _ base
            hScalarSlot hSelectorSlot hSnd hHead hSelect hScalar (uncompress_ok a base ha) (uncompress_error t msg ht)
          simpa only [checkedSchnorr, hLen, hRange, and_self, ↓reduceIte, ha, ht, Option.map_none] using hErr
        | ok commitment =>
          cases hb : bls12_381_G1_uncompress b with
          | error msg =>
            have hErr := LogicOwnerVerifier.predicate_public_error slots rest scalar
              (LogicOwnerScalar.challengeValue challengeRest) selector a b t z ctx _ _ base commitment
              hCtx hScalarSlot hChallengeSlot hSelectorSlot hSnd hHead hSelect hScalar
              (LogicOwnerScalar.challenge_reduces challengeRest _) (uncompress_ok a base ha)
              (uncompress_ok t commitment ht) (uncompress_error b msg hb)
            simpa only [checkedSchnorr, hLen, hRange, and_self, ↓reduceIte, ha, ht, hb, Option.map_none] using hErr
          | ok pubPoint =>
            have hRun := LogicOwnerScalar.predicate_matches_schnorr slots rest selectorRest challengeRest scalar selectorSlots
              a b t z ctx base pubPoint commitment hCtx hScalarSlot hChallengeSlot hSelectorSlot hSnd hHead
              hLen hRange hScalar ha hb ht
            simpa only [checkedSchnorr, hLen, hRange, and_self, ↓reduceIte, ha, ht, hb, Option.map_some] using hRun
    · have hErr := LogicOwnerVerifier.predicate_scalar_error slots rest scalar selector a b t z
        hScalarSlot hSelectorSlot hSnd hHead hSelect
        (LogicOwnerScalarSteps.scalar_bad_range scalarTop scalarMiddle scalarRest z hLen hRange)
      simpa only [checkedSchnorr, hLen, hRange, and_self, Bool.false_eq_true, ↓reduceIte, Option.map_none] using hErr
  · have hErr := LogicOwnerVerifier.predicate_scalar_error slots rest scalar selector a b t z
      hScalarSlot hSelectorSlot hSnd hHead hSelect
      (LogicOwnerScalarSteps.scalar_bad_length scalarTop scalarMiddle scalarRest z hLen)
    simpa only [checkedSchnorr, hLen, false_and, ↓reduceIte, Option.map_none] using hErr

end Lovejoin.AnyTx.LogicOwnerPartial

#print axioms Lovejoin.AnyTx.LogicOwnerPartial.predicate_matches_partial
