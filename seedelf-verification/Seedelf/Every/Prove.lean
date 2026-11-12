import Seedelf.Every.Scalar

/-! # The Schnorr check (i_36 … i_41)

`schnorr.prove` as compiled, applied to the decode i_45 and to g, u, z, g_r and vkh: z must
decode into the scalar field, g must decompress, the challenge c = blake2b_224(g ‖ g_r ‖ u ‖ vkh)
must decode, g_r and u must decompress (each failure is an error), and then the answer is
whether g^z = g_r · u^c. The crypto stays opaque: this is what the bytes check, for any
interpretation of the builtins. -/

namespace Seedelf.Every
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString appendByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open PlutusCore.Crypto.BLS12_381.G1
open PlutusCore.Crypto.Hash (blake2b_224)
open Seedelf.V1.LinesAll

/-- The challenge's bytes: blake2b_224(g ‖ g_r ‖ u ‖ vkh), as the program appends them. -/
abbrev challenge (g u gr vkh : ByteString) : ByteString :=
  blake2b_224 (appendByteString (appendByteString (appendByteString g gr) u) vkh)

/-- i_36 … i_41's body, in the program's order: `none` is its error. -/
def proveOpt (g u z gr vkh : ByteString) : Option Bool :=
  if PlutusCore.Integer.lessThanEqualsInteger 0 (bigEndian z) then
    if PlutusCore.Integer.lessThanInteger (bigEndian z) Seedelf.V1.q then
      match bls12_381_G1_uncompress g with
      | .error _ => none
      | .ok G =>
        if PlutusCore.Integer.lessThanEqualsInteger 0 (bigEndian (challenge g u gr vkh)) then
          if PlutusCore.Integer.lessThanInteger (bigEndian (challenge g u gr vkh)) Seedelf.V1.q then
            match bls12_381_G1_uncompress gr with
            | .error _ => none
            | .ok R =>
              match bls12_381_G1_uncompress u with
              | .error _ => none
              | .ok U => some (bls12_381_G1_equal (bls12_381_G1_scalarMul (bigEndian z) G)
                  (bls12_381_G1_add R (bls12_381_G1_scalarMul (bigEndian (challenge g u gr vkh)) U)))
          else none
        else none
    else none
  else none

/-- `λ i_36 i_37 i_38 i_39 i_40 i_41. …`'s body. -/
def proveBody : Term := sub (regAt ++ [0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0])

set_option maxHeartbeats 0

/-- The check, in the environment its closure and i_45's share (σ: levels i_35 to i_0), with
i_36 = i_45 and i_37 … i_41 = g, u, z, g_r, vkh. -/
theorem prove_ev (σ : Environment) (h18 : List.get?Internal σ 17 = some (vEq 0))
    (hIte : List.get?Internal σ 28 = some vIte) (hFst : List.get?Internal σ 29 = some vFst)
    (hSnd : List.get?Internal σ 30 = some vSnd) (hMk : List.get?Internal σ 32 = some vMkCons)
    (hHead : List.get?Internal σ 33 = some vHead) (g u z gr vkh : ByteString) :
    Ev default proveBody (.VCon (.ByteString vkh) :: .VCon (.ByteString gr) :: .VCon (.ByteString z) ::
        .VCon (.ByteString u) :: .VCon (.ByteString g) :: .VLam decBody σ :: σ)
      ((proveOpt g u z gr vkh).map fun b => .VCon (.Bool b)) := by
  simp only [proveOpt]
  cases h0 : PlutusCore.Integer.lessThanEqualsInteger 0 (bigEndian z)
  · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_none]
    have hd := dec_none_le σ hIte hMk h0
    clear h0
    w_go [hd] []
  cases hq : PlutusCore.Integer.lessThanInteger (bigEndian z) Seedelf.V1.q
  · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_none]
    have hd := dec_none_lt σ hIte hMk h0 hq
    clear h0 hq
    w_go [hd] []
  simp only [↓reduceIte]
  have hd := dec_some σ hIte hMk h0 hq
  clear h0 hq
  cases hG : bls12_381_G1_uncompress g with
  | error e => simp only [Option.map_none]; w_go [hd] [hG]
  | ok G =>
  simp only []
  cases h0c : PlutusCore.Integer.lessThanEqualsInteger 0 (bigEndian (challenge g u gr vkh))
  · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_none]
    have hdc := dec_none_le σ hIte hMk h0c
    clear h0c
    w_go [hd, hdc] [hG]
  cases hqc : PlutusCore.Integer.lessThanInteger (bigEndian (challenge g u gr vkh)) Seedelf.V1.q
  · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_none]
    have hdc := dec_none_lt σ hIte hMk h0c hqc
    clear h0c hqc
    w_go [hd, hdc] [hG]
  simp only [↓reduceIte]
  have hdc := dec_some σ hIte hMk h0c hqc
  clear h0c hqc
  cases hR : bls12_381_G1_uncompress gr with
  | error e => simp only [Option.map_none]; w_go [hd, hdc] [hG, hR]
  | ok R =>
  cases hU : bls12_381_G1_uncompress u with
  | error e => simp only [Option.map_none]; w_go [hd, hdc] [hG, hR, hU]
  | ok U => simp only [Option.map_some]; w_go [hd, hdc] [hG, hR, hU]

-- From here on, unification never reduces `proveOpt …`: with its arguments symbolic it would
-- go on to decide `n < q` by reduction. Its users rewrite it with a cased value instead;
-- `simp only [proveOpt]` still unfolds it by its equation.
attribute [irreducible] proveOpt

end Seedelf.Every
