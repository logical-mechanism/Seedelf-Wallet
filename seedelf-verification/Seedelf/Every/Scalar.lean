import Seedelf.Every.Base

/-! # The scalar decode (i_45)

`scalar.from_bytearray_big_endian` as compiled: `byteStringToInteger(True, b)`, then
`Some(n)` as `Constr 0 [I n]` when `0 ≤ n < q`, else `None` as `Constr 1 []`. It never errors.
`Seedelf.V1.scalarOf` (Wallet.lean) is the same decode as an `Option`, the one the Blaster
modules state; `scalarData` is it as the Data the program builds. -/

namespace Seedelf.Every
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open PlutusCore.UPLC.BuiltinFunctions.Bitwise (byteStringToIntegerOpaque)
open Seedelf.V1.LinesAll

/-- The integer `byteStringToInteger(True, b)` makes of `b`. -/
abbrev bigEndian (b : ByteString) : Integer := .ofNat (byteStringToIntegerOpaque true b.data)

/-- What i_45 returns: `Some(n)` or `None`, as Aiken builds them, in the program's own tests.
Never reduce it with `b` symbolic: deciding `n < q` by reduction unfolds the subtraction from
`q` one unit at a time. Case on the two tests instead. -/
def scalarData (b : ByteString) : Data :=
  if PlutusCore.Integer.lessThanEqualsInteger 0 (bigEndian b) then
    if PlutusCore.Integer.lessThanInteger (bigEndian b) Seedelf.V1.q then .Constr 0 [.I (bigEndian b)]
    else .Constr (Int.ofNat 1) []
  else .Constr (Int.ofNat 1) []

/-- `λ i_45. …`'s body. -/
def decBody : Term := sub (regAt ++ [0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1,0])

set_option maxHeartbeats 0

/-- i_45 applied to any bytes, in its closure's environment σ (levels i_35 to i_0). -/
theorem dec_ap (σ : Environment) (hIte : List.get?Internal σ 28 = some vIte)
    (hMk : List.get?Internal σ 32 = some vMkCons) (b : ByteString) :
    Ap default (.VLam decBody σ) (.VCon (.ByteString b)) (some (.VCon (.Data (scalarData b)))) := by
  apply ap_lam
  simp only [scalarData]
  cases h0 : PlutusCore.Integer.lessThanEqualsInteger 0 (bigEndian b)
  · simp only [Bool.false_eq_true, ↓reduceIte]
    have hL := ap_lessThanEquals _ _ _ h0
    clear h0
    w_go [hL] []
  · cases hq : PlutusCore.Integer.lessThanInteger (bigEndian b) Seedelf.V1.q
    · simp only [Bool.false_eq_true, ↓reduceIte]
      have hL := ap_lessThanEquals _ _ _ h0
      have hL2 := ap_lessThan _ _ _ hq
      clear h0 hq
      w_go [hL, hL2] []
    · simp only [↓reduceIte]
      have hL := ap_lessThanEquals _ _ _ h0
      have hL2 := ap_lessThan _ _ _ hq
      clear h0 hq
      w_go [hL, hL2] []

/-! The decode at a result the proof has cased on, so no goal holds `scalarData` itself. -/

theorem dec_some (σ : Environment) (hIte : List.get?Internal σ 28 = some vIte)
    (hMk : List.get?Internal σ 32 = some vMkCons) {b : ByteString}
    (h0 : PlutusCore.Integer.lessThanEqualsInteger 0 (bigEndian b) = true)
    (hq : PlutusCore.Integer.lessThanInteger (bigEndian b) Seedelf.V1.q = true) :
    Ap default (.VLam decBody σ) (.VCon (.ByteString b)) (some (.VCon (.Data (.Constr 0 [.I (bigEndian b)])))) := by
  have h := dec_ap σ hIte hMk b
  simp only [scalarData, h0, hq, ↓reduceIte] at h
  exact h

theorem dec_none_le (σ : Environment) (hIte : List.get?Internal σ 28 = some vIte)
    (hMk : List.get?Internal σ 32 = some vMkCons) {b : ByteString}
    (h0 : PlutusCore.Integer.lessThanEqualsInteger 0 (bigEndian b) = false) :
    Ap default (.VLam decBody σ) (.VCon (.ByteString b)) (some (.VCon (.Data (.Constr (Int.ofNat 1) [])))) := by
  have h := dec_ap σ hIte hMk b
  simp only [scalarData, h0, Bool.false_eq_true, ↓reduceIte] at h
  exact h

theorem dec_none_lt (σ : Environment) (hIte : List.get?Internal σ 28 = some vIte)
    (hMk : List.get?Internal σ 32 = some vMkCons) {b : ByteString}
    (h0 : PlutusCore.Integer.lessThanEqualsInteger 0 (bigEndian b) = true)
    (hq : PlutusCore.Integer.lessThanInteger (bigEndian b) Seedelf.V1.q = false) :
    Ap default (.VLam decBody σ) (.VCon (.ByteString b)) (some (.VCon (.Data (.Constr (Int.ofNat 1) [])))) := by
  have h := dec_ap σ hIte hMk b
  simp only [scalarData, h0, hq, Bool.false_eq_true, ↓reduceIte] at h
  exact h

end Seedelf.Every
