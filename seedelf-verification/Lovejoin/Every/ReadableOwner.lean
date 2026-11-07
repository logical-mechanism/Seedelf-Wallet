import Lovejoin.Every.ReadableBase

/-! # The reference datum, the boxes and the Owner, typed

The first half of mix_logic's withdrawal in the Aiken source's terms, over a typed `TxInfo`:
`read_reference_datum` (reference.ak), `collect_well_formed_mix_inputs` (mix_logic.ak, with
mixbox.ak's helpers), the redeemer's decode, and `validate_owner` with schnorr.ak's `verify`.
Each is proved equal to the raw spec the CEK theorems use, on `IsData.toData` of the typed
value. -/

namespace Lovejoin.Every.Readable
open CardanoLedgerApi.IsData.Class (IsData)
open CardanoLedgerApi.V3
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString appendByteString lengthOfByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Crypto.BLS12_381.G1
open PlutusCore.Crypto.Hash (blake2b_256)
open PlutusCore.UPLC.BuiltinFunctions.Bitwise (byteStringToIntegerOpaque)
open CardanoLedgerApi.V1.Value (valueOf)
open Lovejoin.Template (nftName)
open Lovejoin.Every

/-! ### The reference datum -/

/-- types.ak's `ReferenceDatum`. -/
structure RefDatum where
  boxLovelace : Integer
  tokenPolicy : ByteString
  tokenName : ByteString
  tokenQuantity : Integer
  maxFeePerMixLovelace : Integer
  mixScriptHash : ByteString
  mixLogicScriptHash : ByteString
  feeScriptHash : ByteString

/-- A `ReferenceDatum`'s eight fields, as `Data`. -/
def RefDatum.fields (r : RefDatum) : List Data :=
  [.I r.boxLovelace, .B r.tokenPolicy, .B r.tokenName, .I r.tokenQuantity, .I r.maxFeePerMixLovelace,
    .B r.mixScriptHash, .B r.mixLogicScriptHash, .B r.feeScriptHash]

def RefDatum.toData (r : RefDatum) : Data := .Constr 0 r.fields

/-- `expect parsed: ReferenceDatum = d`: constructor 0 and exactly the eight fields, typed. -/
def RefDatum.ofData : Data → Option RefDatum
  | .Constr t [.I bl, .B pol, .B nm, .I tq, .I fee, .B msh, .B lh, .B fh] =>
    if t = 0 then some ⟨bl, pol, nm, tq, fee, msh, lh, fh⟩ else none
  | _ => none

/-- `expect InlineDatum(d) = output.datum`, then `expect parsed: ReferenceDatum = d`. -/
def inlineRefDatum (o : TxOut) : Option RefDatum :=
  match o.txOutDatum with
  | .OutputDatum d => RefDatum.ofData d
  | _ => none

/-- reference.ak's `holds_reference_nft`: `quantity_of(input.output.value, P, N) == 1`. -/
def holdsReferenceNft (P N : ByteString) (i : TxInInfo) : Bool :=
  valueOf P N i.txInInfoResolved.txOutValue == 1

/-- reference.ak's `read_reference_datum`: exactly one reference input holds one of the pool's
NFT, `(P, "lovejoin")` (`nftName`: mix_logic's name parameter, which every v2 launch pins), and
its datum is an inline `ReferenceDatum`. -/
def readReferenceDatum (P : ByteString) (tx : TxInfo) : Option RefDatum :=
  match tx.txInfoReferenceInputs.filter (holdsReferenceNft P nftName) with
  | [c] => inlineRefDatum c.txInInfoResolved
  | _ => none

theorem ofData_some {d : Data} {r : RefDatum} (h : RefDatum.ofData d = some r) : d = r.toData := by
  unfold RefDatum.ofData at h
  split at h
  · split at h
    · cases h; subst_vars; rfl
    · contradiction
  · contradiction

theorem refFields_some {x y : Data} {xs : List Data} (h : refFields x xs = some y) :
    y = x ∧ ∃ r : RefDatum, xs = r.fields := by
  rcases xs with _ | ⟨f0, _ | ⟨f1, _ | ⟨f2, _ | ⟨f3, _ | ⟨f4, _ | ⟨f5, _ | ⟨f6, _ | ⟨f7, rest⟩⟩⟩⟩⟩⟩⟩⟩
  all_goals try (simp [refFields] at h; done)
  rcases f7 with _ | _ | _ | _ | b7 <;> try (simp [refFields, bytesOf] at h; done)
  rcases f0 with _ | _ | _ | i0 | _ <;> try (simp [refFields, bytesOf, intOf] at h; done)
  rcases f1 with _ | _ | _ | _ | b1 <;> try (simp [refFields, bytesOf, intOf] at h; done)
  rcases f2 with _ | _ | _ | _ | b2 <;> try (simp [refFields, bytesOf, intOf] at h; done)
  rcases f3 with _ | _ | _ | i3 | _ <;> try (simp [refFields, bytesOf, intOf] at h; done)
  rcases f4 with _ | _ | _ | i4 | _ <;> try (simp [refFields, bytesOf, intOf] at h; done)
  rcases f5 with _ | _ | _ | _ | b5 <;> try (simp [refFields, bytesOf, intOf] at h; done)
  rcases f6 with _ | _ | _ | _ | b6 <;> try (simp [refFields, bytesOf, intOf] at h; done)
  rcases rest with _ | ⟨_, _⟩ <;> simp [refFields, bytesOf, intOf] at h
  exact ⟨h.symm, ⟨i0, b1, b2, i3, i4, b5, b6, b7⟩, rfl⟩

/-- The datum check the compiled code runs (`refFields`, after the tag) is `RefDatum.ofData`. -/
theorem refFields_eq (t : Integer) (xs : List Data) :
    (if PlutusCore.Integer.equalsInteger 0 t then refFields (.Constr t xs) xs else none) =
      (RefDatum.ofData (.Constr t xs)).map RefDatum.toData := by
  cases hr : RefDatum.ofData (.Constr t xs) with
  | some r =>
    have hd := ofData_some hr
    simp only [RefDatum.toData, Data.Constr.injEq] at hd
    obtain ⟨rfl, rfl⟩ := hd
    rfl
  | none =>
    cases hf : refFields (.Constr t xs) xs with
    | none => simp
    | some y =>
      obtain ⟨_, r, rfl⟩ := refFields_some hf
      by_cases ht : t = 0
      · subst ht
        simp [RefDatum.ofData, RefDatum.fields] at hr
      · simp [PlutusCore.Integer.equalsInteger, Ne.symm ht]

theorem datum_data (d : OutputDatum) :
    IsData.toData d = match d with
      | .NoOutputDatum => .Constr 0 []
      | .OutputDatumHash h => .Constr 1 [.B h]
      | .OutputDatum x => .Constr 2 [x] := by
  cases d <;> rfl

theorem carrierDatum_typed (c : TxInInfo) :
    carrierDatum (IsData.toData c) = (inlineRefDatum c.txInInfoResolved).map RefDatum.toData := by
  rcases c with ⟨ref, ⟨addr, value, datum, rs⟩⟩
  change carrierDatum (.Constr 0 [IsData.toData ref, .Constr 0 [IsData.toData addr, .Map value,
    IsData.toData datum, IsData.toData rs]]) = _
  rcases datum with _ | h | x
  · rfl
  · rfl
  · simp only [carrierDatum, datum_data, inlineRefDatum, List.getElem?_cons_succ, List.getElem?_cons_zero]
    rcases x with ⟨xt, xs⟩ | _ | _ | _ | _
    · simp only [PlutusCore.Integer.equalsInteger]
      exact refFields_eq xt xs
    all_goals rfl

theorem holdsNft_typed (P N : ByteString) (i : TxInInfo)
    (hv : CardanoLedgerApi.V1.Contexts.validTxOutValue i.txInInfoResolved.txOutValue = true) :
    holdsNft P N (IsData.toData i) = some (holdsReferenceNft P N i) := by
  rcases i with ⟨ref, ⟨addr, value, datum, rs⟩⟩
  have hs := valid_value_shape value hv
  change holdsNft P N (.Constr 0 [IsData.toData ref, .Constr 0 [IsData.toData addr, .Map value,
    IsData.toData datum, IsData.toData rs]]) = _
  simp only [holdsNft, List.getElem?_cons_succ, List.getElem?_cons_zero, policy_search P value hs,
    name_search P N value hs, Option.map_some, holdsReferenceNft, PlutusCore.Integer.equalsInteger]
  congr 1
  exact Bool.beq_comm

theorem carriers_typed (P N : ByteString) :
    ∀ (refs : List TxInInfo),
      (∀ i ∈ refs, CardanoLedgerApi.V1.Contexts.validTxOutValue i.txInInfoResolved.txOutValue = true) →
      carriers P N (refs.map IsData.toData) = some ((refs.filter (holdsReferenceNft P N)).map IsData.toData)
  | [], _ => rfl
  | i :: is, hv => by
    simp only [List.map_cons, carriers, holdsNft_typed P N i (hv i (by simp)),
      carriers_typed P N is (fun j hj => hv j (by simp [hj])), List.filter_cons]
    cases holdsReferenceNft P N i <;> rfl

/-- **The reference datum, typed:** on reference inputs whose values the ledger accepts, the
program's `referenceDatum` is `read_reference_datum`. -/
theorem referenceDatum_typed (P : ByteString) (tx : TxInfo)
    (hv : ∀ i ∈ tx.txInfoReferenceInputs,
      CardanoLedgerApi.V1.Contexts.validTxOutValue i.txInInfoResolved.txOutValue = true) :
    referenceDatum P nftName (IsData.toData tx) = (readReferenceDatum P tx).map RefDatum.toData := by
  have hinfo : IsData.toData tx = .Constr 0 (IsData.toData tx.txInfoInputs ::
      IsData.toData tx.txInfoReferenceInputs :: _) := rfl
  rw [hinfo, inputs_data tx.txInfoReferenceInputs]
  simp only [referenceDatum, List.getElem?_cons_succ, List.getElem?_cons_zero,
    carriers_typed P nftName _ hv, readReferenceDatum]
  rcases tx.txInfoReferenceInputs.filter (holdsReferenceNft P nftName) with _ | ⟨c, _ | ⟨c', cs⟩⟩
  · rfl
  · exact carrierDatum_typed c
  · rfl

/-! ### The boxes -/

/-- types.ak's `MixDatum`. -/
structure MixDatum where
  a : ByteString
  b : ByteString

def MixDatum.toData (m : MixDatum) : Data := .Constr 0 [.B m.a, .B m.b]

/-- mixbox.ak's `try_decode_well_formed_data`: constructor 0 with two 48-byte strings that
differ; anything else is `None`. -/
def tryDecodeWellFormedData : Data → Option MixDatum
  | .Constr t [.B a, .B b] =>
    if t = 0 ∧ lengthOfByteString a = 48 ∧ lengthOfByteString b = 48 ∧ a ≠ b then some ⟨a, b⟩ else none
  | _ => none

/-- `try_decode_well_formed_inline`: an inline datum, decoded; no datum or a hash is `None`. -/
def tryDecodeWellFormedInline : OutputDatum → Option MixDatum
  | .OutputDatum d => tryDecodeWellFormedData d
  | _ => none

/-- mixbox.ak's `input_at_script`: the input's payment credential is the script. -/
def inputAtScript (i : TxInInfo) (msh : ByteString) : Bool :=
  match i.txInInfoResolved.txOutAddress.addressCredential with
  | .ScriptCredential h => h == msh
  | .PubKeyCredential _ => false

/-- mix_logic.ak's `collect_well_formed_mix_inputs`: in input order, each input at the script
whose datum decodes as a well-formed `MixDatum`. -/
def collectWellFormedMixInputs (tx : TxInfo) (msh : ByteString) : List MixDatum :=
  tx.txInfoInputs.filterMap fun i =>
    if inputAtScript i msh then tryDecodeWellFormedInline i.txInInfoResolved.txOutDatum else none

theorem boxDatum_typed (d : Data) : boxDatum d = (tryDecodeWellFormedData d).map MixDatum.toData := by
  rcases d with ⟨t, _ | ⟨f0, _ | ⟨f1, _ | ⟨f2, fs⟩⟩⟩⟩ | _ | _ | _ | _
  all_goals try (simp [boxDatum, tryDecodeWellFormedData]; done)
  rcases f0 with ⟨_, _⟩ | _ | _ | _ | a <;> rcases f1 with ⟨_, _⟩ | _ | _ | _ | b
  all_goals try (simp [boxDatum, tryDecodeWellFormedData]; done)
  simp only [boxDatum, tryDecodeWellFormedData, PlutusCore.Integer.equalsInteger,
    PlutusCore.ByteString.equalsByteString]
  by_cases ht : t = 0
  · subst ht
    by_cases ha : lengthOfByteString a = 48 <;> by_cases hb : lengthOfByteString b = 48 <;>
      by_cases hab : a = b <;> simp [ha, hb, hab, MixDatum.toData, @eq_comm Integer 48]
  · have ht' : ((0 : Integer) == t) = false := by simp [Ne.symm ht]
    simp [ht', ht]

theorem boxIn_typed (msh : ByteString) (i : TxInInfo) :
    boxIn msh (IsData.toData i) =
      some ((if inputAtScript i msh then tryDecodeWellFormedInline i.txInInfoResolved.txOutDatum
        else none).map MixDatum.toData) := by
  rcases i with ⟨ref, ⟨⟨cred, stake⟩, value, datum, rs⟩⟩
  change boxIn msh (.Constr 0 [IsData.toData ref, .Constr 0 [.Constr 0 [IsData.toData cred,
    IsData.toData stake], .Map value, IsData.toData datum, IsData.toData rs]]) = _
  rcases cred with pk | h
  · rfl
  · simp only [boxIn, inputAtScript, List.getElem?_cons_succ, List.getElem?_cons_zero]
    change (match (if PlutusCore.Integer.equalsInteger 1 1 then
        some (PlutusCore.ByteString.equalsByteString h msh) else some false) with
      | some true => _ | some false => _ | none => _) = _
    simp only [PlutusCore.Integer.equalsInteger, beq_self_eq_true, if_true,
      PlutusCore.ByteString.equalsByteString]
    cases hh : (h == msh)
    · rfl
    · rcases datum with _ | dh | x
      · rfl
      · rfl
      · simp only [datum_data, tryDecodeWellFormedInline, if_true, List.getElem?_cons_zero]
        change some (boxDatum x) = _
        rw [boxDatum_typed]

theorem collect_typed (msh : ByteString) :
    ∀ (ins : List TxInInfo),
      collect msh (ins.map IsData.toData) =
        some ((ins.filterMap fun i => if inputAtScript i msh then
          tryDecodeWellFormedInline i.txInInfoResolved.txOutDatum else none).map MixDatum.toData)
  | [] => rfl
  | i :: is => by
    simp only [List.map_cons, collect, boxIn_typed, collect_typed msh is, List.filterMap_cons]
    cases (if inputAtScript i msh then tryDecodeWellFormedInline i.txInInfoResolved.txOutDatum else none) <;> rfl

/-- **The boxes, typed:** the program's `boxesOf` is `collect_well_formed_mix_inputs`, at the
reference datum's mix_box hash. Every input list, no ledger assumption. -/
theorem boxesOf_typed (rd : RefDatum) (tx : TxInfo) :
    boxesOf rd.toData (IsData.toData tx) =
      some ((collectWellFormedMixInputs tx rd.mixScriptHash).map MixDatum.toData) := by
  have hinfo : IsData.toData tx = .Constr 0 (IsData.toData tx.txInfoInputs :: _) := rfl
  rw [hinfo, inputs_data tx.txInfoInputs]
  exact collect_typed rd.mixScriptHash tx.txInfoInputs

/-! ### The Owner -/

/-- schnorr.ak's `SchnorrProof`. -/
structure SchnorrProof where
  t : ByteString
  z : ByteString

def SchnorrProof.toData (p : SchnorrProof) : Data := .Constr 0 [.B p.t, .B p.z]

/-- validate_owner's `ctx`: `blake2b_256(serialise_data(self.outputs) ‖ serialise_data(each
input's output_reference) ‖ mix_script_hash)`. -/
def ownerContext (tx : TxInfo) (msh : ByteString) : Option ByteString := do
  let o ← Lovejoin.Classic.serialised (IsData.toData tx.txInfoOutputs)
  let r ← Lovejoin.Classic.serialised (.List (tx.txInfoInputs.map fun i => IsData.toData i.txInInfoOutRef))
  pure (blake2b_256 (appendByteString (appendByteString o r) msh))

/-- mix_logic.ak's `validate_owner`: at least one box, and the boxes and proofs pair up, each
box's proof passing schnorr.ak's `verify` (`Lovejoin.Classic.schnorrVerifies`) against `ctx`. -/
def validateOwner (tx : TxInfo) (rd : RefDatum) (proofs : List SchnorrProof) : Prop :=
  collectWellFormedMixInputs tx rd.mixScriptHash ≠ [] ∧
    ∃ ctx, ownerContext tx rd.mixScriptHash = some ctx ∧
      AllPairs (fun m p => Lovejoin.Classic.schnorrVerifies m.a m.b p.t p.z ctx = true)
        (collectWellFormedMixInputs tx rd.mixScriptHash) proofs

theorem inputRefs_typed : ∀ (ins : List TxInInfo),
    inputRefs (ins.map IsData.toData) = some (ins.map fun i => IsData.toData i.txInInfoOutRef)
  | [] => rfl
  | ⟨ref, out⟩ :: is => by
    show inputRefs (.Constr 0 [IsData.toData ref, IsData.toData out] :: is.map IsData.toData) = _
    simp only [inputRefs, inputRefs_typed is, Option.map_some, List.map_cons]

theorem ownerHash_typed (rd : RefDatum) (tx : TxInfo) :
    ownerHash rd.toData (IsData.toData tx) = ownerContext tx rd.mixScriptHash := by
  have hinfo : IsData.toData tx = .Constr 0 (IsData.toData tx.txInfoInputs ::
      IsData.toData tx.txInfoReferenceInputs :: IsData.toData tx.txInfoOutputs :: _) := rfl
  rw [hinfo, inputs_data tx.txInfoInputs]
  simp only [ownerHash, ownerContext, fieldsOf, listOf, bytesOf, List.getElem?_cons_succ,
    List.getElem?_cons_zero, inputRefs_typed, RefDatum.toData, RefDatum.fields, Option.bind_eq_bind,
    Option.bind_some, Option.pure_def]

/-- The program's Schnorr prefix is hash.ak's `domain_tag_v1 ‖ statement_id_prove_dlog`. -/
theorem prefix01_eq : prefix01 = appendByteString ("lovejoin/sigmajoin/v1/" : ByteString) "\x01" := by
  decide

/-- **Each Owner proof:** the program's check of a box and its proof is schnorr.ak's `verify`,
with `z` 32 bytes below the field order and every point decompressing (else an error). -/
theorem ownerPred_typed (ctx : ByteString) (m : MixDatum) (p : SchnorrProof) :
    ownerPred ctx m.toData p.toData = some true ↔
      Lovejoin.Classic.schnorrVerifies m.a m.b p.t p.z ctx = true := by
  rcases m with ⟨a, b⟩
  rcases p with ⟨t, z⟩
  simp only [ownerPred, MixDatum.toData, SchnorrProof.toData, fieldsOf, bytesOf,
    List.getElem?_cons_succ, List.getElem?_cons_zero, Option.bind_eq_bind, Option.bind_some,
    Lovejoin.Classic.schnorrVerifies, Lovejoin.Classic.fsHashSchnorr, ← prefix01_eq,
    scalarOf, scalarMod]
  generalize hzi : (Int.ofNat (byteStringToIntegerOpaque true z.data) : Integer) = zi
  cases hz : PlutusCore.Integer.equalsInteger 32 (lengthOfByteString z) <;>
  cases hq : PlutusCore.Integer.lessThanInteger zi Lovejoin.Classic.q <;>
  cases ha : bls12_381_G1_uncompress a <;> cases hb : bls12_381_G1_uncompress b <;>
  cases ht : bls12_381_G1_uncompress t <;>
  simp_all [Except.toOption, PlutusCore.Integer.equalsInteger, PlutusCore.Integer.lessThanInteger,
    @eq_comm Integer 32] <;> intro h <;> exact absurd h (Int.not_lt.2 hq)

/-- **The Owner, typed:** past the reference datum and the boxes, the program's
`validate_owner` is `validateOwner`. Every transaction, no ledger assumption. -/
theorem ownerResult_typed (rd : RefDatum) (tx : TxInfo) (ps : List SchnorrProof) :
    ownerResult rd.toData (IsData.toData tx) (.Constr 0 [.List (ps.map SchnorrProof.toData)])
        ((collectWellFormedMixInputs tx rd.mixScriptHash).map MixDatum.toData) = some true ↔
      validateOwner tx rd ps := by
  simp only [ownerResult, countOf_map, ownerHash_typed, validateOwner, PlutusCore.Integer.lessThanEqualsInteger,
    PlutusCore.Integer.equalsInteger]
  generalize collectWellFormedMixInputs tx rd.mixScriptHash = boxes
  cases hctx : ownerContext tx rd.mixScriptHash with
  | none =>
    simp only [reduceCtorEq, false_and, exists_false, and_false, iff_false]
    split <;> (try split) <;> simp
  | some ctx =>
    simp only [Option.some.injEq, exists_eq_left']
    rw [← allPairs_congr (fun m p => ownerPred_typed ctx m p) boxes ps, ← pairsAll_map]
    by_cases h1 : (1 : Int) ≤ (boxes.length : Int)
    · have hne : boxes ≠ [] := by intro h; subst h; simp at h1
      by_cases hl : ((ps.length : Int) == (boxes.length : Int)) = true
      · simp only [h1, hl, decide_true, if_true, ne_eq, hne, not_false_eq_true, true_and]
      · simp only [h1, hl, decide_true, if_true, Bool.false_eq_true, if_false, reduceCtorEq, false_iff,
          ne_eq, hne, not_false_eq_true, true_and]
        intro hp
        have := allPairs_length ((pairsAll_map _ _ _ boxes ps).1 hp)
        simp [this] at hl
    · have he : boxes = [] := by
        rcases boxes with _ | ⟨_, _⟩
        · rfl
        · simp at h1; omega
      subst he
      simp

end Lovejoin.Every.Readable
