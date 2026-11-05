import Lovejoin.AnyTx.LogicOwnerScalar

/-! Isolated steps for the Owner proof-scalar helper. -/
namespace Lovejoin.AnyTx.LogicOwnerScalarSteps
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.BuiltinFunctions.Bitwise (byteStringToIntegerOpaque)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.LogicOwnerScalar
open Lovejoin.Classic (q)
set_option maxHeartbeats 0

theorem comparison_passes (n : Integer) (hRange : n < q) :
    Ap default (.VBuiltin .LessThanInteger [.VCon (.Integer n)] (.One .ArgV))
      (.VCon (.Integer q)) (some (.VCon (.Bool true))) := by
  apply ap_builtin
  change (some (.VCon (.Bool (PlutusCore.Integer.lessThanInteger n q))) : Option CekValue) = _
  have he : PlutusCore.Integer.lessThanInteger n q = true := by
    change decide (n < q) = true
    exact decide_eq_true hRange
  rw [he]

theorem comparison_fails (n : Integer) (hRange : ¬ n < q) :
    Ap default (.VBuiltin .LessThanInteger [.VCon (.Integer n)] (.One .ArgV))
      (.VCon (.Integer q)) (some (.VCon (.Bool false))) := by
  apply ap_builtin
  change (some (.VCon (.Bool (PlutusCore.Integer.lessThanInteger n q))) : Option CekValue) = _
  have he : PlutusCore.Integer.lessThanInteger n q = false := by
    change decide (n < q) = false
    exact decide_eq_false hRange
  rw [he]

theorem reduction_runs (n : Integer) :
    Ap default (.VBuiltin .ModInteger [.VCon (.Integer n)] (.One .ArgV))
      (.VCon (.Integer q)) (some (.VCon (.Integer (Int.fmod n q)))) := by
  apply ap_builtin
  rfl

theorem scalar_inner_valid (top : Fin 2 → CekValue) (middle : Fin 21 → CekValue) (rest : Environment)
    (z : ByteString) (n : Integer) (hRange : n < q) :
    Ev default scalarInnerBody
      (.VCon (.Integer n) :: .VCon (.ByteString z) :: scalarEnv top middle rest)
      (some (.VCon (.Integer (Int.fmod n q)))) := by
  have hCmp := comparison_passes n hRange
  have hMod := reduction_runs n
  cek_v3_using [hCmp, hMod]

/-- A scalar outside the field is rejected by the compiled inner check. -/
theorem scalar_inner_invalid (top : Fin 2 → CekValue) (middle : Fin 21 → CekValue) (rest : Environment)
    (z : ByteString) (n : Integer) (hRange : ¬ n < q) :
    Ev default scalarInnerBody
      (.VCon (.Integer n) :: .VCon (.ByteString z) :: scalarEnv top middle rest) none := by
  have hCmp := comparison_fails n hRange
  cek_v3_using [hCmp]

/-- A correctly sized, in-range Owner scalar is decoded by the compiled helper. -/
theorem scalar_valid (top : Fin 2 → CekValue) (middle : Fin 21 → CekValue) (rest : Environment) (z : ByteString)
    (hLen : PlutusCore.ByteString.lengthOfByteString z = 32)
    (hRange : (Int.ofNat (byteStringToIntegerOpaque true z.data) : Integer) < q) :
    Ap default (scalarValue top middle rest) (.VCon (.ByteString z))
      (some (.VCon (.Integer (Int.fmod (.ofNat (byteStringToIntegerOpaque true z.data)) q)))) := by
  let n : Integer := .ofNat (byteStringToIntegerOpaque true z.data)
  have hLenCheck : Ap default (.VBuiltin .EqualsInteger [.VCon (.Integer 32)] (.One .ArgV))
      (.VCon (.Integer (PlutusCore.ByteString.lengthOfByteString z))) (some (.VCon (.Bool true))) := by
    rw [hLen]
    apply ap_builtin
    rfl
  have hParse : Ap default (.VBuiltin .ByteStringToInteger [.VCon (.Bool true)] (.One .ArgV))
      (.VCon (.ByteString z)) (some (.VCon (.Integer n))) := by
    apply ap_builtin
    rfl
  have hInner : Ap default (.VLam scalarInnerBody (.VCon (.ByteString z) :: scalarEnv top middle rest))
      (.VCon (.Integer n)) (some (.VCon (.Integer (Int.fmod n q)))) := by
    apply ap_lam
    exact scalar_inner_valid top middle rest z n hRange
  apply ap_lam
  cek_v3_using [hLenCheck, hParse, hInner]

/-- Proof scalars with the wrong byte length cause an error. -/
theorem scalar_bad_length (top : Fin 2 → CekValue) (middle : Fin 21 → CekValue) (rest : Environment) (z : ByteString)
    (hLen : PlutusCore.ByteString.lengthOfByteString z ≠ 32) :
    Ap default (scalarValue top middle rest) (.VCon (.ByteString z)) none := by
  have hLenCheck : Ap default (.VBuiltin .EqualsInteger [.VCon (.Integer 32)] (.One .ArgV))
      (.VCon (.Integer (PlutusCore.ByteString.lengthOfByteString z))) (some (.VCon (.Bool false))) := by
    apply ap_builtin
    change (some (.VCon (.Bool (PlutusCore.Integer.equalsInteger 32
      (PlutusCore.ByteString.lengthOfByteString z)))) : Option CekValue) = _
    have he : PlutusCore.Integer.equalsInteger 32 (PlutusCore.ByteString.lengthOfByteString z) = false := by
      change decide ((32 : Integer) = PlutusCore.ByteString.lengthOfByteString z) = false
      exact decide_eq_false (Ne.symm hLen)
    rw [he]
  apply ap_lam
  cek_v3_using [hLenCheck]

/-- Correctly sized scalars outside the field cause an error. -/
theorem scalar_bad_range (top : Fin 2 → CekValue) (middle : Fin 21 → CekValue) (rest : Environment) (z : ByteString)
    (hLen : PlutusCore.ByteString.lengthOfByteString z = 32)
    (hRange : ¬ (Int.ofNat (byteStringToIntegerOpaque true z.data) : Integer) < q) :
    Ap default (scalarValue top middle rest) (.VCon (.ByteString z)) none := by
  let n : Integer := .ofNat (byteStringToIntegerOpaque true z.data)
  have hLenCheck : Ap default (.VBuiltin .EqualsInteger [.VCon (.Integer 32)] (.One .ArgV))
      (.VCon (.Integer (PlutusCore.ByteString.lengthOfByteString z))) (some (.VCon (.Bool true))) := by
    rw [hLen]
    apply ap_builtin
    rfl
  have hParse : Ap default (.VBuiltin .ByteStringToInteger [.VCon (.Bool true)] (.One .ArgV))
      (.VCon (.ByteString z)) (some (.VCon (.Integer n))) := by
    apply ap_builtin
    rfl
  have hInner : Ap default (.VLam scalarInnerBody (.VCon (.ByteString z) :: scalarEnv top middle rest))
      (.VCon (.Integer n)) none := by
    apply ap_lam
    exact scalar_inner_invalid top middle rest z n hRange
  apply ap_lam
  cek_v3_using [hLenCheck, hParse, hInner]

end Lovejoin.AnyTx.LogicOwnerScalarSteps

#print axioms Lovejoin.AnyTx.LogicOwnerScalarSteps.scalar_inner_valid
#print axioms Lovejoin.AnyTx.LogicOwnerScalarSteps.scalar_valid
#print axioms Lovejoin.AnyTx.LogicOwnerScalarSteps.scalar_bad_length
#print axioms Lovejoin.AnyTx.LogicOwnerScalarSteps.scalar_bad_range
