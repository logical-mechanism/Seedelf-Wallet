import Lovejoin.AnyTx.LogicOwnerVerifier
import Lovejoin.AnyTx.LogicInputHelpers

/-! The compiled scalar helpers called by the Owner Schnorr verifier. -/
namespace Lovejoin.AnyTx.LogicOwnerScalar
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.Crypto.BLS12_381.G1
open PlutusCore.UPLC.BuiltinFunctions.Bitwise (byteStringToIntegerOpaque)
open PlutusCore.UPLC.Term (Term Program)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.BoxSearch (subterm)
open Lovejoin.Classic (q)

def templateBody : Term := match mixLogicTemplate.script with | .Program _ b => b
def challengeAt : List Nat := [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,0,8]
def challengeBody : Term := subterm templateBody (challengeAt ++ [0])
def challengeValue (env : Environment) : CekValue := .VLam challengeBody env

def scalarAt : List Nat := [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,0,0,0,0,1]
def scalarBody : Term := subterm templateBody (scalarAt ++ [0])
def scalarInnerBody : Term := subterm templateBody (scalarAt ++ [0,0,0,1,0,0,0])
def scalarEnv (top : Fin 2 → CekValue) (middle : Fin 21 → CekValue) (rest : Environment) : Environment :=
  List.ofFn top ++ .VBuiltin .EqualsInteger [.VCon (.Integer 32)] (.One .ArgV) :: List.ofFn middle ++
  .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) :: rest
def scalarValue (top : Fin 2 → CekValue) (middle : Fin 21 → CekValue) (rest : Environment) : CekValue :=
  .VLam scalarBody (scalarEnv top middle rest)

set_option maxHeartbeats 0

/-- The compiled challenge helper reduces the hash-derived integer modulo q. -/
theorem challenge_reduces (env : Environment) (hash : ByteString) :
    Ap default (challengeValue env) (.VCon (.ByteString hash))
      (some (.VCon (.Integer (Int.fmod (.ofNat (byteStringToIntegerOpaque true hash.data)) q)))) := by
  apply ap_lam
  cek_v3

/-- The verifier's domain-separated hash is the existing Schnorr specification's hash. -/
theorem challenge_hash_agrees (a b t ctx : ByteString) :
    LogicOwnerVerifier.challengeHash a b t ctx = Lovejoin.Classic.fsHashSchnorr a b t ctx := by
  rfl

/-- With the compiled challenge and selector helpers, the extracted Owner
closure agrees with the Schnorr specification for decoded points and a valid
scalar. The scalar helper's result is still an explicit premise. -/
theorem predicate_matches_schnorr (slots : Fin 41 → CekValue) (rest scalarRest challengeRest : Environment)
    (scalar : CekValue) (selectorSlots : Fin 19 → CekValue)
    (a b t z ctx : ByteString) (base pubPoint commitment : BLS12_381_G1_Element)
    (hCtx : slots ⟨0, by decide⟩ = .VCon (.ByteString ctx))
    (hScalarSlot : slots ⟨4, by decide⟩ = scalar)
    (hChallengeSlot : slots ⟨7, by decide⟩ = challengeValue challengeRest)
    (hSelectorSlot : slots ⟨14, by decide⟩ = LogicReferenceFilter.selectorValue selectorSlots scalarRest)
    (hSnd : slots ⟨32, by decide⟩ = .VBuiltin .SndPair [] (.One .ArgV))
    (hHead : slots ⟨35, by decide⟩ = .VBuiltin .HeadList [] (.One .ArgV))
    (hLen : PlutusCore.ByteString.lengthOfByteString z = 32)
    (hRange : (Int.ofNat (byteStringToIntegerOpaque true z.data) : Integer) < q)
    (hScalar : Ap default scalar (.VCon (.ByteString z))
      (some (.VCon (.Integer (Int.fmod (.ofNat (byteStringToIntegerOpaque true z.data)) q)))))
    (hBase : bls12_381_G1_uncompress a = .ok base)
    (hPublic : bls12_381_G1_uncompress b = .ok pubPoint)
    (hCommit : bls12_381_G1_uncompress t = .ok commitment) :
    Ev default LogicOwnerVerifier.predicateBody
      (.VCon (.Data (.Constr 0 [.B t, .B z])) :: .VCon (.Data (.Constr 0 [.B a, .B b])) ::
        LogicOwnerVerifier.predicateEnv slots rest)
      (some (.VCon (.Bool (Lovejoin.Classic.schnorrVerifies a b t z ctx)))) := by
  have hExpr : Lovejoin.Classic.schnorrVerifies a b t z ctx =
      bls12_381_G1_equal (bls12_381_G1_scalarMul (Int.fmod (.ofNat (byteStringToIntegerOpaque true z.data)) q) base)
        (bls12_381_G1_add commitment (bls12_381_G1_scalarMul
          (Int.fmod (.ofNat (byteStringToIntegerOpaque true (LogicOwnerVerifier.challengeHash a b t ctx).data)) q) pubPoint)) := by
    simp [Lovejoin.Classic.schnorrVerifies, hBase, hPublic, hCommit, hLen, hRange,
      challenge_hash_agrees]
    exact fun _ => hRange
  rw [hExpr]
  apply LogicOwnerVerifier.predicate_equation_builtins slots rest scalar (challengeValue challengeRest)
    (LogicReferenceFilter.selectorValue selectorSlots scalarRest) a b t z ctx
    (Int.fmod (.ofNat (byteStringToIntegerOpaque true z.data)) q)
    (Int.fmod (.ofNat (byteStringToIntegerOpaque true (LogicOwnerVerifier.challengeHash a b t ctx).data)) q)
    base pubPoint commitment hCtx hScalarSlot hChallengeSlot hSelectorSlot hSnd hHead
  · exact LogicReferenceFilter.selector_second selectorSlots scalarRest
  · exact hScalar
  · exact challenge_reduces challengeRest _
  · exact hBase
  · exact hPublic
  · exact hCommit

end Lovejoin.AnyTx.LogicOwnerScalar

#print axioms Lovejoin.AnyTx.LogicOwnerScalar.challenge_reduces
#print axioms Lovejoin.AnyTx.LogicOwnerScalar.predicate_matches_schnorr
