import Lovejoin.AnyTx.LogicProofPairs
import Lovejoin.AnyTx.Common

/-! The Owner branch's compiled Schnorr-verifier closure. -/
namespace Lovejoin.AnyTx.LogicOwnerVerifier
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString appendByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Crypto.BLS12_381.G1
open PlutusCore.Crypto.Hash (blake2b_256)
open PlutusCore.UPLC.Term (Term Program)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.BoxSearch (subterm)

def templateBody : Term := match mixLogicTemplate.script with | .Program _ b => b
def predicateAt : List Nat :=
  [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,2]
def predicateLoop : Term := subterm templateBody (predicateAt ++ [0])
def predicateBody : Term := subterm templateBody (predicateAt ++ [0,0])
def predicateEnv (slots : Fin 41 → CekValue) (rest : Environment) : Environment := List.ofFn slots ++ rest
def predicateValue (slots : Fin 41 → CekValue) (rest : Environment) : CekValue :=
  .VLam predicateLoop (predicateEnv slots rest)

theorem predicate_shape : subterm templateBody predicateAt = .Lam predicateLoop := rfl
theorem loop_shape : predicateLoop = .Lam predicateBody := rfl

set_option maxHeartbeats 0

/-- The first application captures the box datum and yields the proof checker. -/
theorem predicate_first (slots : Fin 41 → CekValue) (rest : Environment) (datum : Data) :
    Ap default (predicateValue slots rest) (.VCon (.Data datum))
      (some (.VLam predicateBody (.VCon (.Data datum) :: predicateEnv slots rest))) := by
  apply ap_lam
  cek_v3

/-- An error in proof-scalar decoding propagates through the Owner predicate. -/
theorem predicate_scalar_error (slots : Fin 41 → CekValue) (rest : Environment)
    (scalar selector : CekValue) (a b t z : ByteString)
    (hScalarSlot : slots ⟨4, by decide⟩ = scalar)
    (hSelectorSlot : slots ⟨14, by decide⟩ = selector)
    (hSnd : slots ⟨32, by decide⟩ = .VBuiltin .SndPair [] (.One .ArgV))
    (hHead : slots ⟨35, by decide⟩ = .VBuiltin .HeadList [] (.One .ArgV))
    (hSelect : ∀ x y : Data, ∀ tail : List Data,
      Ap default selector (.VCon (.ConstDataList (x :: y :: tail))) (some (.VCon (.Data y))))
    (hScalar : Ap default scalar (.VCon (.ByteString z)) none) :
    Ev default predicateBody
      (.VCon (.Data (.Constr 0 [.B t, .B z])) :: .VCon (.Data (.Constr 0 [.B a, .B b])) :: predicateEnv slots rest)
      none := by
  repeat' first
    | rw [hScalarSlot]
    | rw [hSelectorSlot]
    | rw [hSnd]
    | rw [hHead]
    | apply hSelect
    | apply hScalar
    | cek_v3_step

/-- A malformed compressed base point makes the Owner predicate error. -/
theorem predicate_base_error (slots : Fin 41 → CekValue) (rest : Environment)
    (scalar selector : CekValue) (a b t z : ByteString) (za : Integer)
    (hScalarSlot : slots ⟨4, by decide⟩ = scalar)
    (hSelectorSlot : slots ⟨14, by decide⟩ = selector)
    (hSnd : slots ⟨32, by decide⟩ = .VBuiltin .SndPair [] (.One .ArgV))
    (hHead : slots ⟨35, by decide⟩ = .VBuiltin .HeadList [] (.One .ArgV))
    (hSelect : ∀ x y : Data, ∀ tail : List Data,
      Ap default selector (.VCon (.ConstDataList (x :: y :: tail))) (some (.VCon (.Data y))))
    (hScalar : Ap default scalar (.VCon (.ByteString z)) (some (.VCon (.Integer za))))
    (hBase : Ap default (.VBuiltin .Bls12_381_G1_uncompress [] (.One .ArgV)) (.VCon (.ByteString a)) none) :
    Ev default predicateBody
      (.VCon (.Data (.Constr 0 [.B t, .B z])) :: .VCon (.Data (.Constr 0 [.B a, .B b])) :: predicateEnv slots rest)
      none := by
  repeat' first
    | rw [hScalarSlot]
    | rw [hSelectorSlot]
    | rw [hSnd]
    | rw [hHead]
    | apply hSelect
    | apply hScalar
    | apply hBase
    | cek_v3_step

/-- A malformed compressed commitment makes the Owner predicate error after
the scalar and base point have decoded. -/
theorem predicate_commit_error (slots : Fin 41 → CekValue) (rest : Environment)
    (scalar selector : CekValue) (a b t z : ByteString) (za : Integer) (base : BLS12_381_G1_Element)
    (hScalarSlot : slots ⟨4, by decide⟩ = scalar)
    (hSelectorSlot : slots ⟨14, by decide⟩ = selector)
    (hSnd : slots ⟨32, by decide⟩ = .VBuiltin .SndPair [] (.One .ArgV))
    (hHead : slots ⟨35, by decide⟩ = .VBuiltin .HeadList [] (.One .ArgV))
    (hSelect : ∀ x y : Data, ∀ tail : List Data,
      Ap default selector (.VCon (.ConstDataList (x :: y :: tail))) (some (.VCon (.Data y))))
    (hScalar : Ap default scalar (.VCon (.ByteString z)) (some (.VCon (.Integer za))))
    (hBase : Ap default (.VBuiltin .Bls12_381_G1_uncompress [] (.One .ArgV)) (.VCon (.ByteString a))
      (some (.VCon (.Bls12_381_G1_element base))))
    (hCommit : Ap default (.VBuiltin .Bls12_381_G1_uncompress [] (.One .ArgV)) (.VCon (.ByteString t)) none) :
    Ev default predicateBody
      (.VCon (.Data (.Constr 0 [.B t, .B z])) :: .VCon (.Data (.Constr 0 [.B a, .B b])) :: predicateEnv slots rest)
      none := by
  repeat' first
    | rw [hScalarSlot]
    | rw [hSelectorSlot]
    | rw [hSnd]
    | rw [hHead]
    | apply hSelect
    | apply hScalar
    | apply hBase
    | apply hCommit
    | cek_v3_step

/-- The bytes hashed by the Owner predicate for its Fiat-Shamir challenge. -/
def challengeHash (a b t ctx : ByteString) : ByteString :=
  blake2b_256 (appendByteString (appendByteString (appendByteString
    (appendByteString ("lovejoin/sigmajoin/v1/\x01" : ByteString) a) b) t) ctx)

/-- A malformed compressed public point makes the Owner predicate error after
the scalar, base point and commitment have decoded. -/
theorem predicate_public_error (slots : Fin 41 → CekValue) (rest : Environment)
    (scalar challenge selector : CekValue) (a b t z ctx : ByteString) (za ca : Integer)
    (base commitment : BLS12_381_G1_Element)
    (hCtx : slots ⟨0, by decide⟩ = .VCon (.ByteString ctx))
    (hScalarSlot : slots ⟨4, by decide⟩ = scalar)
    (hChallengeSlot : slots ⟨7, by decide⟩ = challenge)
    (hSelectorSlot : slots ⟨14, by decide⟩ = selector)
    (hSnd : slots ⟨32, by decide⟩ = .VBuiltin .SndPair [] (.One .ArgV))
    (hHead : slots ⟨35, by decide⟩ = .VBuiltin .HeadList [] (.One .ArgV))
    (hSelect : ∀ x y : Data, ∀ tail : List Data,
      Ap default selector (.VCon (.ConstDataList (x :: y :: tail))) (some (.VCon (.Data y))))
    (hScalar : Ap default scalar (.VCon (.ByteString z)) (some (.VCon (.Integer za))))
    (hChallenge : Ap default challenge (.VCon (.ByteString (challengeHash a b t ctx))) (some (.VCon (.Integer ca))))
    (hBase : Ap default (.VBuiltin .Bls12_381_G1_uncompress [] (.One .ArgV)) (.VCon (.ByteString a))
      (some (.VCon (.Bls12_381_G1_element base))))
    (hCommit : Ap default (.VBuiltin .Bls12_381_G1_uncompress [] (.One .ArgV)) (.VCon (.ByteString t))
      (some (.VCon (.Bls12_381_G1_element commitment))))
    (hPublic : Ap default (.VBuiltin .Bls12_381_G1_uncompress [] (.One .ArgV)) (.VCon (.ByteString b)) none) :
    Ev default predicateBody
      (.VCon (.Data (.Constr 0 [.B t, .B z])) :: .VCon (.Data (.Constr 0 [.B a, .B b])) :: predicateEnv slots rest)
      none := by
  repeat' first
    | rw [hCtx]
    | rw [hScalarSlot]
    | rw [hChallengeSlot]
    | rw [hSelectorSlot]
    | rw [hSnd]
    | rw [hHead]
    | apply hSelect
    | apply hScalar
    | apply hChallenge
    | apply hBase
    | apply hCommit
    | apply hPublic
    | cek_v3_step

/-- On decoded points, the extracted Owner closure evaluates the Schnorr
equation using the supplied scalar and challenge closures. The premises name
the corresponding CEK builtins and permit their behavior to be proved once. -/
theorem predicate_equation (slots : Fin 41 → CekValue) (rest : Environment)
    (scalar challenge selector : CekValue) (a b t z ctx : ByteString)
    (za ca : Integer) (base pubPoint commitment left right product : BLS12_381_G1_Element) (result : Bool)
    (hCtx : slots ⟨0, by decide⟩ = .VCon (.ByteString ctx))
    (hScalarSlot : slots ⟨4, by decide⟩ = scalar)
    (hChallengeSlot : slots ⟨7, by decide⟩ = challenge)
    (hSelectorSlot : slots ⟨14, by decide⟩ = selector)
    (hSnd : slots ⟨32, by decide⟩ = .VBuiltin .SndPair [] (.One .ArgV))
    (hHead : slots ⟨35, by decide⟩ = .VBuiltin .HeadList [] (.One .ArgV))
    (hSelect : ∀ x y : Data, ∀ tail : List Data,
      Ap default selector (.VCon (.ConstDataList (x :: y :: tail))) (some (.VCon (.Data y))))
    (hScalar : Ap default scalar (.VCon (.ByteString z)) (some (.VCon (.Integer za))))
    (hChallenge : Ap default challenge (.VCon (.ByteString (challengeHash a b t ctx))) (some (.VCon (.Integer ca))))
    (hBase : Ap default (.VBuiltin .Bls12_381_G1_uncompress [] (.One .ArgV)) (.VCon (.ByteString a)) (some (.VCon (.Bls12_381_G1_element base))))
    (hPublic : Ap default (.VBuiltin .Bls12_381_G1_uncompress [] (.One .ArgV)) (.VCon (.ByteString b)) (some (.VCon (.Bls12_381_G1_element pubPoint))))
    (hCommit : Ap default (.VBuiltin .Bls12_381_G1_uncompress [] (.One .ArgV)) (.VCon (.ByteString t)) (some (.VCon (.Bls12_381_G1_element commitment))))
    (hLeft : Ap default (.VBuiltin .Bls12_381_G1_scalarMul [.VCon (.Integer za)] (.One .ArgV)) (.VCon (.Bls12_381_G1_element base)) (some (.VCon (.Bls12_381_G1_element left))))
    (hProduct : Ap default (.VBuiltin .Bls12_381_G1_scalarMul [.VCon (.Integer ca)] (.One .ArgV)) (.VCon (.Bls12_381_G1_element pubPoint)) (some (.VCon (.Bls12_381_G1_element product))))
    (hRight : Ap default (.VBuiltin .Bls12_381_G1_add [.VCon (.Bls12_381_G1_element commitment)] (.One .ArgV)) (.VCon (.Bls12_381_G1_element product)) (some (.VCon (.Bls12_381_G1_element right))))
    (hEqual : Ap default (.VBuiltin .Bls12_381_G1_equal [.VCon (.Bls12_381_G1_element left)] (.One .ArgV)) (.VCon (.Bls12_381_G1_element right)) (some (.VCon (.Bool result)))) :
    Ev default predicateBody
      (.VCon (.Data (.Constr 0 [.B t, .B z])) :: .VCon (.Data (.Constr 0 [.B a, .B b])) :: predicateEnv slots rest)
      (some (.VCon (.Bool result))) := by
  repeat' first
    | rw [hCtx]
    | rw [hScalarSlot]
    | rw [hChallengeSlot]
    | rw [hSelectorSlot]
    | rw [hSnd]
    | rw [hHead]
    | apply hSelect
    | apply hScalar
    | apply hChallenge
    | apply hBase
    | apply hPublic
    | apply hCommit
    | apply hLeft
    | apply hProduct
    | apply hRight
    | apply hEqual
    | cek_v3_step

/-- The Owner predicate evaluates the Schnorr group equation whenever the
three point decompressions succeed and the two scalar helpers have the stated
results. Group operations are the actual Plutus builtin model. -/
theorem predicate_equation_builtins (slots : Fin 41 → CekValue) (rest : Environment)
    (scalar challenge selector : CekValue) (a b t z ctx : ByteString)
    (za ca : Integer) (base pubPoint commitment : BLS12_381_G1_Element)
    (hCtx : slots ⟨0, by decide⟩ = .VCon (.ByteString ctx))
    (hScalarSlot : slots ⟨4, by decide⟩ = scalar)
    (hChallengeSlot : slots ⟨7, by decide⟩ = challenge)
    (hSelectorSlot : slots ⟨14, by decide⟩ = selector)
    (hSnd : slots ⟨32, by decide⟩ = .VBuiltin .SndPair [] (.One .ArgV))
    (hHead : slots ⟨35, by decide⟩ = .VBuiltin .HeadList [] (.One .ArgV))
    (hSelect : ∀ x y : Data, ∀ tail : List Data,
      Ap default selector (.VCon (.ConstDataList (x :: y :: tail))) (some (.VCon (.Data y))))
    (hScalar : Ap default scalar (.VCon (.ByteString z)) (some (.VCon (.Integer za))))
    (hChallenge : Ap default challenge (.VCon (.ByteString (challengeHash a b t ctx))) (some (.VCon (.Integer ca))))
    (hBase : bls12_381_G1_uncompress a = .ok base)
    (hPublic : bls12_381_G1_uncompress b = .ok pubPoint)
    (hCommit : bls12_381_G1_uncompress t = .ok commitment) :
    Ev default predicateBody
      (.VCon (.Data (.Constr 0 [.B t, .B z])) :: .VCon (.Data (.Constr 0 [.B a, .B b])) :: predicateEnv slots rest)
      (some (.VCon (.Bool (bls12_381_G1_equal (bls12_381_G1_scalarMul za base)
        (bls12_381_G1_add commitment (bls12_381_G1_scalarMul ca pubPoint)))))) := by
  apply predicate_equation slots rest scalar challenge selector a b t z ctx za ca base pubPoint commitment
    (bls12_381_G1_scalarMul za base)
    (bls12_381_G1_add commitment (bls12_381_G1_scalarMul ca pubPoint))
    (bls12_381_G1_scalarMul ca pubPoint)
    (bls12_381_G1_equal (bls12_381_G1_scalarMul za base)
      (bls12_381_G1_add commitment (bls12_381_G1_scalarMul ca pubPoint)))
    hCtx hScalarSlot hChallengeSlot hSelectorSlot hSnd hHead hSelect hScalar hChallenge
  · apply ap_builtin
    simp [PlutusCore.UPLC.BuiltinFunctions.Evaluate.evaluateBuiltinFunction,
      PlutusCore.UPLC.BuiltinFunctions.Crypto.bls12381G1Uncompress, hBase]
    rfl
  · apply ap_builtin
    simp [PlutusCore.UPLC.BuiltinFunctions.Evaluate.evaluateBuiltinFunction,
      PlutusCore.UPLC.BuiltinFunctions.Crypto.bls12381G1Uncompress, hPublic]
    rfl
  · apply ap_builtin
    simp [PlutusCore.UPLC.BuiltinFunctions.Evaluate.evaluateBuiltinFunction,
      PlutusCore.UPLC.BuiltinFunctions.Crypto.bls12381G1Uncompress, hCommit]
    rfl
  all_goals apply ap_builtin
  all_goals rfl


end Lovejoin.AnyTx.LogicOwnerVerifier

#print axioms Lovejoin.AnyTx.LogicOwnerVerifier.predicate_first
#print axioms Lovejoin.AnyTx.LogicOwnerVerifier.predicate_equation
#print axioms Lovejoin.AnyTx.LogicOwnerVerifier.predicate_equation_builtins
