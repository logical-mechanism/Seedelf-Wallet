import Lovejoin.AnyTx.LogicOwnerScalarSteps

/-! Connect the compiled Owner predicate to the unbounded compiled pair loop. -/
namespace Lovejoin.AnyTx.LogicOwnerPairing
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Crypto.BLS12_381.G1
open PlutusCore.UPLC.BuiltinFunctions.Bitwise (byteStringToIntegerOpaque)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.LogicProofPairs
open Lovejoin.Classic (q schnorrVerifies)

/-- Schnorr verification on the exact box and Owner-proof encodings. -/
def ownerCheck (ctx : ByteString) : Data → Data → Option Bool
  | .Constr 0 [.B a, .B b], .Constr 0 [.B t, .B z] => some (schnorrVerifies a b t z ctx)
  | _, _ => none

def ownerNext (slots : Fin 41 → CekValue) (rest : Environment) (datum : Data) : CekValue :=
  .VLam LogicOwnerVerifier.predicateBody (.VCon (.Data datum) :: LogicOwnerVerifier.predicateEnv slots rest)

/-- Conditions under which the compiled Owner verifier is characterized by
the current Schnorr model. These are not assumed by the whole validator. -/
def supportedPair (scalar : CekValue) (datum proof : Data) : Prop :=
  ∃ (a b t z : ByteString) (base pubPoint commitment : BLS12_381_G1_Element),
    datum = .Constr 0 [.B a, .B b] ∧ proof = .Constr 0 [.B t, .B z] ∧
    PlutusCore.ByteString.lengthOfByteString z = 32 ∧
    (Int.ofNat (byteStringToIntegerOpaque true z.data) : Integer) < q ∧
    Ap default scalar (.VCon (.ByteString z))
      (some (.VCon (.Integer (Int.fmod (.ofNat (byteStringToIntegerOpaque true z.data)) q)))) ∧
    bls12_381_G1_uncompress a = .ok base ∧
    bls12_381_G1_uncompress b = .ok pubPoint ∧
    bls12_381_G1_uncompress t = .ok commitment

/-- Conditions on a pair without assuming the scalar helper's result. -/
def supportedConcretePair (datum proof : Data) : Prop :=
  ∃ (a b t z : ByteString) (base pubPoint commitment : BLS12_381_G1_Element),
    datum = .Constr 0 [.B a, .B b] ∧ proof = .Constr 0 [.B t, .B z] ∧
    PlutusCore.ByteString.lengthOfByteString z = 32 ∧
    (Int.ofNat (byteStringToIntegerOpaque true z.data) : Integer) < q ∧
    bls12_381_G1_uncompress a = .ok base ∧
    bls12_381_G1_uncompress b = .ok pubPoint ∧
    bls12_381_G1_uncompress t = .ok commitment

/-- With supported aligned pairs, the compiled Owner pair wrapper runs the
actual Schnorr predicate on every pair, for lists of any length. This theorem
is at the internal call boundary, not yet the full transaction validator. -/
theorem wrapper_checks_schnorr (slots : Fin 41 → CekValue) (predRest scalarRest challengeRest : Environment)
    (scalar : CekValue) (selectorSlots : Fin 19 → CekValue) (ctx : ByteString)
    (c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 : CekValue)
    (rest : Environment) (boxes proofs : List Data)
    (hCtx : slots ⟨0, by decide⟩ = .VCon (.ByteString ctx))
    (hScalarSlot : slots ⟨4, by decide⟩ = scalar)
    (hChallengeSlot : slots ⟨7, by decide⟩ = LogicOwnerScalar.challengeValue challengeRest)
    (hSelectorSlot : slots ⟨14, by decide⟩ = LogicReferenceFilter.selectorValue selectorSlots scalarRest)
    (hSnd : slots ⟨32, by decide⟩ = .VBuiltin .SndPair [] (.One .ArgV))
    (hHead : slots ⟨35, by decide⟩ = .VBuiltin .HeadList [] (.One .ArgV))
    (hPairs : ∀ datum proof, (datum, proof) ∈ boxes.zip proofs → supportedPair scalar datum proof) :
    Ev default wrapperBody
      (LogicOwnerVerifier.predicateValue slots predRest :: .VCon (.ConstDataList proofs) :: .VCon (.ConstDataList boxes) ::
        c29 :: c28 :: c27 :: c26 :: c20 :: c19 :: c18 :: c17 :: c16 :: c15 :: c14 :: c13 :: c12 :: c11 ::
        .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) :: c9 :: c8 ::
        .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
        .VBuiltin .MkCons [] (.More .ArgV (.One .ArgV)) ::
        .VBuiltin .HeadList [] (.One .ArgV) :: .VBuiltin .TailList [] (.One .ArgV) ::
        c3 :: c2 :: c1 :: c0 :: rest)
      ((allPairsPartial (ownerCheck ctx) boxes proofs).map fun result => .VCon (.Bool result)) := by
  apply wrapper_all_aligned (LogicOwnerVerifier.predicateValue slots predRest) (ownerNext slots predRest) (ownerCheck ctx)
    c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest
  · intro datum
    exact LogicOwnerVerifier.predicate_first slots predRest datum
  · intro datum proof hp
    obtain ⟨a, b, t, z, base, pubPoint, commitment, hd, hp', hLen, hRange, hScalar, hBase, hPublic, hCommit⟩ :=
      hPairs datum proof hp
    subst datum
    subst proof
    simp only [ownerCheck, Option.map_some, ownerNext]
    apply ap_lam
    exact LogicOwnerScalar.predicate_matches_schnorr slots predRest scalarRest challengeRest scalar selectorSlots
      a b t z ctx base pubPoint commitment hCtx hScalarSlot hChallengeSlot hSelectorSlot hSnd hHead
      hLen hRange hScalar hBase hPublic hCommit

/-- The pairwise result using the actual compiled scalar and challenge helpers,
for arbitrary aligned inputs whose point encodings decode and whose scalars are
32-byte, in-range values. This remains a compiled subterm result. -/
theorem wrapper_checks_compiled_schnorr (slots : Fin 41 → CekValue)
    (predRest selectorRest challengeRest scalarRest : Environment)
    (selectorSlots : Fin 19 → CekValue) (scalarTop : Fin 2 → CekValue) (scalarMiddle : Fin 21 → CekValue)
    (ctx : ByteString)
    (c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 : CekValue)
    (rest : Environment) (boxes proofs : List Data)
    (hCtx : slots ⟨0, by decide⟩ = .VCon (.ByteString ctx))
    (hScalarSlot : slots ⟨4, by decide⟩ = LogicOwnerScalar.scalarValue scalarTop scalarMiddle scalarRest)
    (hChallengeSlot : slots ⟨7, by decide⟩ = LogicOwnerScalar.challengeValue challengeRest)
    (hSelectorSlot : slots ⟨14, by decide⟩ = LogicReferenceFilter.selectorValue selectorSlots selectorRest)
    (hSnd : slots ⟨32, by decide⟩ = .VBuiltin .SndPair [] (.One .ArgV))
    (hHead : slots ⟨35, by decide⟩ = .VBuiltin .HeadList [] (.One .ArgV))
    (hPairs : ∀ datum proof, (datum, proof) ∈ boxes.zip proofs → supportedConcretePair datum proof) :
    Ev default wrapperBody
      (LogicOwnerVerifier.predicateValue slots predRest :: .VCon (.ConstDataList proofs) :: .VCon (.ConstDataList boxes) ::
        c29 :: c28 :: c27 :: c26 :: c20 :: c19 :: c18 :: c17 :: c16 :: c15 :: c14 :: c13 :: c12 :: c11 ::
        .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) :: c9 :: c8 ::
        .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
        .VBuiltin .MkCons [] (.More .ArgV (.One .ArgV)) ::
        .VBuiltin .HeadList [] (.One .ArgV) :: .VBuiltin .TailList [] (.One .ArgV) ::
        c3 :: c2 :: c1 :: c0 :: rest)
      ((allPairsPartial (ownerCheck ctx) boxes proofs).map fun result => .VCon (.Bool result)) := by
  apply wrapper_checks_schnorr slots predRest selectorRest challengeRest
    (LogicOwnerScalar.scalarValue scalarTop scalarMiddle scalarRest) selectorSlots ctx
    c29 c28 c27 c26 c20 c19 c18 c17 c16 c15 c14 c13 c12 c11 c9 c8 c3 c2 c1 c0 rest boxes proofs
    hCtx hScalarSlot hChallengeSlot hSelectorSlot hSnd hHead
  intro datum proof hp
  obtain ⟨a, b, t, z, base, pubPoint, commitment, hd, hpr, hLen, hRange, hBase, hPublic, hCommit⟩ :=
    hPairs datum proof hp
  exact ⟨a, b, t, z, base, pubPoint, commitment, hd, hpr, hLen, hRange,
    LogicOwnerScalarSteps.scalar_valid scalarTop scalarMiddle scalarRest z hLen hRange,
    hBase, hPublic, hCommit⟩

end Lovejoin.AnyTx.LogicOwnerPairing

#print axioms Lovejoin.AnyTx.LogicOwnerPairing.wrapper_checks_schnorr
#print axioms Lovejoin.AnyTx.LogicOwnerPairing.wrapper_checks_compiled_schnorr
