import Lovejoin.AnyTx.LogicOwnerPartial
import Lovejoin.AnyTx.LogicOwnerPairing
import Lovejoin.AnyTx.LogicProofPairs

/-! Arbitrary Owner proof bytes through the compiled pairwise verifier. -/
namespace Lovejoin.AnyTx.LogicOwnerPairingPartial
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.LogicProofPairs
open Lovejoin.AnyTx.LogicOwnerPairing (ownerNext)

def ownerCheck (ctx : ByteString) : Data → Data → Option Bool
  | .Constr 0 [.B a, .B b], .Constr 0 [.B t, .B z] => LogicOwnerPartial.checkedSchnorr a b t z ctx
  | _, _ => none

/-- A true modeled result is a true Schnorr check, even if malformed scalar or
point encodings were possible before evaluation. -/
theorem checked_true (a b t z ctx : ByteString)
    (h : LogicOwnerPartial.checkedSchnorr a b t z ctx = some true) :
    Lovejoin.Classic.schnorrVerifies a b t z ctx = true := by
  unfold LogicOwnerPartial.checkedSchnorr at h
  split at h
  · cases ha : PlutusCore.Crypto.BLS12_381.G1.bls12_381_G1_uncompress a with
    | error msg => simp only [ha] at h; cases h
    | ok base =>
      cases ht : PlutusCore.Crypto.BLS12_381.G1.bls12_381_G1_uncompress t with
      | error msg => simp only [ha, ht] at h; cases h
      | ok commitment =>
        cases hb : PlutusCore.Crypto.BLS12_381.G1.bls12_381_G1_uncompress b with
        | error msg => simp only [ha, ht, hb] at h; cases h
        | ok publicPoint =>
          simp only [ha, ht, hb, Option.some.injEq] at h
          exact h
  · cases h

/-- The compiled pair wrapper runs the actual Owner verifier for arbitrary
proof bytes, provided each aligned item has the datum/proof constructor shape.
Invalid points or scalars are represented as errors, not assumed valid. -/
theorem wrapper_checks_all_bytes (slots : Fin 41 → CekValue)
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
    (hShapes : ∀ datum proof, (datum, proof) ∈ boxes.zip proofs →
      ∃ a b t z : ByteString, datum = .Constr 0 [.B a, .B b] ∧ proof = .Constr 0 [.B t, .B z]) :
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
    obtain ⟨a, b, t, z, hd, hp'⟩ := hShapes datum proof hp
    subst datum
    subst proof
    simp only [ownerCheck, ownerNext]
    apply ap_lam
    exact LogicOwnerPartial.predicate_matches_partial slots predRest selectorRest challengeRest scalarRest
      selectorSlots scalarTop scalarMiddle a b t z ctx hCtx hScalarSlot hChallengeSlot hSelectorSlot hSnd hHead

/-- If the modeled Owner pair computation returns true, all aligned, encoded
Schnorr checks are true and the list lengths match. -/
theorem true_requires_schnorr (body : PlutusCore.UPLC.Term.Term) (env : Environment) (ctx : ByteString)
    (boxes proofs : List Data)
    (hModel : Ev default body env
      ((allPairsPartial (ownerCheck ctx) boxes proofs).map fun result => .VCon (.Bool result)))
    (hTrue : Ev default body env (some (.VCon (.Bool true)))) :
    boxes.length = proofs.length ∧
      ∀ a b t z : ByteString,
        ((Data.Constr 0 [.B a, .B b], Data.Constr 0 [.B t, .B z]) : Data × Data) ∈ boxes.zip proofs →
        Lovejoin.Classic.schnorrVerifies a b t z ctx = true := by
  have hResult := ev_true_of_model body env _ hModel hTrue
  have hAll := (allPairsPartial_true_iff (ownerCheck ctx) boxes proofs).mp hResult
  refine ⟨hAll.1, ?_⟩
  intro a b t z hp
  have hv := hAll.2 _ hp
  exact checked_true a b t z ctx (by simpa [ownerCheck] using hv)

end Lovejoin.AnyTx.LogicOwnerPairingPartial

#print axioms Lovejoin.AnyTx.LogicOwnerPairingPartial.wrapper_checks_all_bytes
#print axioms Lovejoin.AnyTx.LogicOwnerPairingPartial.true_requires_schnorr
