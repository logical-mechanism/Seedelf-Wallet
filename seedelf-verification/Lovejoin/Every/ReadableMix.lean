import Lovejoin.Every.ReadableOwner

/-! # The Mix, typed

mix_logic's `validate_mix` in the Aiken source's terms, over a typed `TxInfo`: value.ak's
`box_value`, mixbox.ak's `output_at_script` and `decode_mix_datum_strict`, `walk_outputs`, and
sigma_or.ak's `verify_pre`. Each is proved equal to the raw spec the CEK theorems use, on
`IsData.toData` of the typed value.

One place reads differently from the source, as the program has it: a statement's points are
stored compressed, so each branch's equations use `uncompress(compress(A'))`, not `A'`. No crypto
fact is assumed to remove it. -/

namespace Lovejoin.Every.Readable
open CardanoLedgerApi.IsData.Class (IsData)
open CardanoLedgerApi.V3
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString appendByteString lengthOfByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Crypto.BLS12_381.G1
open PlutusCore.Crypto.Hash (blake2b_256)
open PlutusCore.UPLC.BuiltinFunctions.Bitwise (byteStringToIntegerOpaque xorByteStringOpaque)
open PlutusCore.UPLC.BuiltinFunctions.Data (encodeDataOpaque)
open Lovejoin.Every

/-! ### The box value -/

/-- value.ak's `box_value`, as the program builds it: `box_lovelace` of ADA (no entry at 0),
then `token_quantity` of the pool token, unless the policy is empty or the quantity 0. -/
def RefDatum.boxValue (rd : RefDatum) : List (Data × Data) :=
  let ada : List (Data × Data) :=
    if rd.boxLovelace = 0 then [] else [(.B ⟨""⟩, .Map [(.B ⟨""⟩, .I rd.boxLovelace)])]
  if rd.tokenPolicy = ⟨""⟩ ∨ rd.tokenQuantity = 0 then ada
  else ada ++ [(.B rd.tokenPolicy, .Map [(.B rd.tokenName, .I rd.tokenQuantity)])]

theorem empty_lt_bytes {pol : ByteString} (h : pol ≠ ⟨""⟩) : (⟨""⟩ : ByteString) < pol := by
  rcases pol with ⟨⟨_ | ⟨c, cs⟩⟩⟩
  · exact (h rfl).elim
  · change ([] : List Char) < c :: cs
    exact List.nil_lt_cons c cs

/-- **The box value:** the program's i_134 is `box_value`. -/
theorem boxValue_typed (rd : RefDatum) :
    boxValue rd.boxLovelace rd.tokenPolicy rd.tokenName rd.tokenQuantity = some rd.boxValue := by
  rcases rd with ⟨bl, pol, nm, tq, fee, msh, lh, fh⟩
  simp only [boxValue, RefDatum.boxValue, adaPart, PlutusCore.ByteString.equalsByteString,
    PlutusCore.Integer.equalsInteger]
  by_cases hp : pol = ⟨""⟩
  · subst hp; simp [@eq_comm Integer 0]
  · have hp' : ((⟨""⟩ : ByteString) == pol) = false := by simp [Ne.symm hp]
    by_cases hq : tq = 0
    · subst hq; simp [hp', @eq_comm Integer 0]
    · have hq' : ((0 : Integer) == tq) = false := by simp [Ne.symm hq]
      have hle : PlutusCore.ByteString.lessThanEqualsByteString pol ⟨""⟩ = false :=
        decide_eq_false (fun h => h (empty_lt_bytes hp))
      by_cases hb : bl = 0
      · subst hb; simp [hp', hq', hp, hq, insertPolicy]
      · have hb' : ((0 : Integer) == bl) = false := by simp [Ne.symm hb]
        simp [hp', hq', hb', hp, hq, hb, insertPolicy, hle]

/-! ### The outputs -/

/-- mixbox.ak's `output_at_script`: the payment credential is the script, with no stake
credential and no reference script. -/
def outputAtScript (o : TxOut) (msh : ByteString) : Bool :=
  match o.txOutAddress.addressCredential with
  | .ScriptCredential h => h == msh && o.txOutAddress.addressStakingCredential.isNone &&
      o.txOutReferenceScript.isNone
  | .PubKeyCredential _ => false

/-- sigma_or.ak's `DHTupleStatementPt`: a box out's two points, as bytes and decompressed. -/
structure Stmt where
  ap : ByteString
  bp : ByteString
  apPt : BLS12_381_G1_Element
  bpPt : BLS12_381_G1_Element

/-- A statement as the program keeps it: the points compressed again. -/
def Stmt.toData (s : Stmt) : Data :=
  .Constr 0 [.B s.ap, .B s.bp, .B (bls12_381_G1_compress s.apPt), .B (bls12_381_G1_compress s.bpPt)]

/-- `walk_outputs`' prefix step on one output: at the script, its value exactly the box value,
an inline datum that decodes as `decode_mix_datum_strict` decodes it (the well-formed
`MixDatum`s, the same set `try_decode_well_formed_data` accepts), and both points decompressing.
Its statement, and the datum the context hashes. -/
def boxOut (msh : ByteString) (val : List (Data × Data)) (o : TxOut) : Option (Stmt × Data) :=
  if outputAtScript o msh = true ∧ (o.txOutValue : List (Data × Data)) = val then
    match o.txOutDatum with
    | .OutputDatum x =>
      match tryDecodeWellFormedData x with
      | some m =>
        match bls12_381_G1_uncompress m.a, bls12_381_G1_uncompress m.b with
        | .ok A, .ok B => some (⟨m.a, m.b, A, B⟩, x)
        | _, _ => none
      | none => none
    | _ => none
  else none

/-- mix_logic.ak's `walk_outputs`: `k` box outs still to come, then none that passes
`output_at_script`; the
statements so far (last first), the datums' bytes and the box value's bytes `bv`, once a box. -/
def walkOutputs (msh : ByteString) (val : List (Data × Data)) (bv : ByteString) :
    List TxOut → Integer → List Stmt → ByteString → ByteString → Option (List Stmt × ByteString × ByteString)
  | [], k, sts, ds, vs => if k = 0 then some (sts, ds, vs) else none
  | o :: os, k, sts, ds, vs =>
    if 0 < k then
      match boxOut msh val o with
      | some (st, x) =>
        match Lovejoin.Classic.serialised x with
        | some sx => walkOutputs msh val bv os (k - 1) (st :: sts) (appendByteString ds sx) (appendByteString vs bv)
        | none => none
      | none => none
    else if outputAtScript o msh then none else walkOutputs msh val bv os 0 sts ds vs

theorem atScript_typed (msh : ByteString) (o : TxOut) :
    atScript msh (IsData.toData o) = some (outputAtScript o msh) := by
  rcases o with ⟨⟨cred, stake⟩, value, datum, rs⟩
  change atScript msh (.Constr 0 [.Constr 0 [IsData.toData cred, IsData.toData stake], .Map value,
    IsData.toData datum, IsData.toData rs]) = _
  rcases cred with pk | h
  · rfl
  · rcases stake with _ | s <;> rcases rs with _ | r <;> cases hh : (h == msh) <;>
      simp [cred_data, none_data, some_data, atScript, outputAtScript, hh,
        PlutusCore.ByteString.equalsByteString, PlutusCore.Integer.equalsInteger, PlutusCore.Data.equalsData]

theorem stmtDatum_typed (x : Data) :
    stmtDatum x = (tryDecodeWellFormedData x).map fun m => (m.a, m.b) := by
  rcases x with ⟨t, _ | ⟨f0, _ | ⟨f1, _ | ⟨f2, fs⟩⟩⟩⟩ | _ | _ | _ | _
  all_goals try (simp [stmtDatum, tryDecodeWellFormedData]; done)
  · rcases f0 with ⟨_, _⟩ | _ | _ | _ | a <;> rcases f1 with ⟨_, _⟩ | _ | _ | _ | b
    all_goals try (simp [stmtDatum, tryDecodeWellFormedData]; done)
    simp only [stmtDatum, tryDecodeWellFormedData, PlutusCore.Integer.equalsInteger,
      PlutusCore.ByteString.equalsByteString]
    by_cases ht : t = 0
    · subst ht
      by_cases ha : lengthOfByteString a = 48 <;> by_cases hb : lengthOfByteString b = 48 <;>
        by_cases hab : a = b <;> simp [ha, hb, hab, @eq_comm Integer 48]
    · have ht' : ((0 : Integer) == t) = false := by simp [Ne.symm ht]
      simp [ht', ht]

theorem prefixOut_typed (msh : ByteString) (val : List (Data × Data)) (o : TxOut) :
    prefixOut msh (.Map val) (IsData.toData o) = (boxOut msh val o).map fun r => (r.1.toData, r.2) := by
  unfold prefixOut
  rw [atScript_typed]
  rcases o with ⟨addr, value, datum, rs⟩
  simp only [boxOut]
  cases hs : outputAtScript ⟨addr, value, datum, rs⟩ msh
  · simp
  · change (match (some (.Map value) : Option Data) with
      | some v => if PlutusCore.Data.equalsData v (.Map val) then _ else none | none => none) = _
    simp only [PlutusCore.Data.equalsData, true_and]
    by_cases hv : (value : List (Data × Data)) = val
    · subst hv
      simp only [beq_self_eq_true, if_true]
      change (match (some (IsData.toData datum) : Option Data) with
        | some (.Constr dt (x :: _)) => _ | _ => none) = _
      rcases datum with _ | dh | x
      · rfl
      · rfl
      · simp only [datum_data, PlutusCore.Integer.equalsInteger, beq_self_eq_true, if_true,
          stmtDatum_typed]
        cases hm : tryDecodeWellFormedData x with
        | none => rfl
        | some m =>
          simp only [Option.map_some]
          cases ha : bls12_381_G1_uncompress m.a <;> cases hb : bls12_381_G1_uncompress m.b <;> rfl
    · have hv' : (Data.Map value == Data.Map val) = false := by
        simp only [beq_eq_false_iff_ne, ne_eq, Data.Map.injEq]; exact hv
      simp [hv', hv]

/-- **The walk, typed:** the program's `walk` over the encoded outputs is `walk_outputs`. -/
theorem walk_typed (msh : ByteString) (val : List (Data × Data)) (bv : ByteString) :
    ∀ (outs : List TxOut) (k : Integer) (sts : List Stmt) (ds vs : ByteString),
      walk msh bv (.Map val) (outs.map IsData.toData) k (sts.map Stmt.toData) ds vs =
        (walkOutputs msh val bv outs k sts ds vs).map fun r => (r.1.map Stmt.toData, r.2)
  | [], k, sts, ds, vs => by
    simp only [List.map_nil, walk, walkOutputs, PlutusCore.Integer.equalsInteger]
    by_cases hk : k = 0
    · subst hk; simp
    · have hk' : ((0 : Integer) == k) = false := by simp [Ne.symm hk]
      simp [hk', hk]
  | o :: os, k, sts, ds, vs => by
    simp only [List.map_cons, walk, walkOutputs, PlutusCore.Integer.lessThanInteger]
    by_cases hk : (0 : Integer) < k
    · simp only [hk, decide_true, if_true, prefixOut_typed]
      cases hb : boxOut msh val o with
      | none => rfl
      | some r =>
        rcases r with ⟨st, x⟩
        simp only [Option.map_some, Lovejoin.Classic.serialised]
        cases hx : encodeDataOpaque x with
        | none => rfl
        | some sx =>
          have hk1 : PlutusCore.Integer.addInteger (-1) k = k - 1 := by
            show (-1 : Int) + k = k - 1; omega
          rw [hk1]
          simp only [Option.map_eq_map, Option.map_some]
          exact walk_typed msh val bv os (k - 1) (st :: sts) _ _
    · simp only [hk, decide_false, if_false, Bool.false_eq_true, atScript_typed]
      cases outputAtScript o msh
      · simp only [Bool.false_eq_true, if_false]
        exact walk_typed msh val bv os 0 sts ds vs
      · rfl

theorem walkFrom_typed (msh : ByteString) (val : List (Data × Data)) (tx : TxInfo) (n : Integer) :
    walkFrom msh val (IsData.toData tx) n =
      (Lovejoin.Classic.serialised (.Map val)).bind fun bv =>
        (walkOutputs msh val bv tx.txInfoOutputs n [] ⟨""⟩ ⟨""⟩).map fun r => (r.1.map Stmt.toData, r.2) := by
  have hinfo : IsData.toData tx = .Constr 0 (IsData.toData tx.txInfoInputs ::
      IsData.toData tx.txInfoReferenceInputs :: IsData.toData tx.txInfoOutputs :: _) := rfl
  simp only [walkFrom, Lovejoin.Classic.serialised]
  cases hv : encodeDataOpaque (.Map val) with
  | none => rfl
  | some bv =>
    rw [hinfo, outputs_data]
    simp only [List.getElem?_cons_succ, List.getElem?_cons_zero]
    exact walk_typed msh val ⟨bv⟩ tx.txInfoOutputs n [] ⟨""⟩ ⟨""⟩

/-! ### Each box's Mix proof -/

/-- sigma_or.ak's `SigmaOrBranch`. -/
structure SigmaOrBranch where
  t0 : ByteString
  t1 : ByteString
  c : ByteString
  z : ByteString

def SigmaOrBranch.toData (br : SigmaOrBranch) : Data := .Constr 0 [.B br.t0, .B br.t1, .B br.c, .B br.z]

/-- sigma_or.ak's `SigmaOrProof`. -/
structure SigmaOrProof where
  branches : List SigmaOrBranch

def SigmaOrProof.toData (p : SigmaOrProof) : Data := .Constr 0 [.List (p.branches.map SigmaOrBranch.toData)]

/-- sigma_or.ak's `xor32`: both 32 bytes, else a failure; the xor is the builtin's own. -/
def xor32 (left right : ByteString) : Option ByteString :=
  if lengthOfByteString left = 32 ∧ lengthOfByteString right = 32 then
    some ⟨xorByteStringOpaque false left.data right.data⟩
  else none

/-- `parallel_all`'s predicate for one statement and its branch: `z` 32 bytes below the field
order, the commitments decompressing, and `z·A = t0 + c·A'` and `z·B = t1 + c·B'`, with `c`
reduced into the field. `A'` and `B'` are the statement's points as the program reads them back,
`uncompress(compress(·))`. -/
def branchHolds (A B : BLS12_381_G1_Element) (st : Stmt) (br : SigmaOrBranch) : Prop :=
  ∃ z, scalarOf br.z = some z ∧
  ∃ T0 T1 A' B', bls12_381_G1_uncompress br.t0 = .ok T0 ∧ bls12_381_G1_uncompress br.t1 = .ok T1 ∧
    bls12_381_G1_uncompress (bls12_381_G1_compress st.apPt) = .ok A' ∧
    bls12_381_G1_uncompress (bls12_381_G1_compress st.bpPt) = .ok B' ∧
    bls12_381_G1_equal (bls12_381_G1_scalarMul z A)
      (bls12_381_G1_add T0 (bls12_381_G1_scalarMul (scalarMod br.c) A')) = true ∧
    bls12_381_G1_equal (bls12_381_G1_scalarMul z B)
      (bls12_381_G1_add T1 (bls12_381_G1_scalarMul (scalarMod br.c) B')) = true

/-- sigma_or.ak's `verify_pre` for the box `(a, b)`: at least two statements; the Fiat-Shamir
hash of `header ‖ a ‖ b`, each statement's `ap ‖ bp`, each branch's `t0 ‖ t1` and `ctx` equals
the xor of the branches' challenges (each challenge, and each running xor, 32 bytes: `xor32`);
both points decompress; and every statement and branch pair up and pass. -/
def verifyPre (a b : ByteString) (stmts : List Stmt) (p : SigmaOrProof) (ctx header : ByteString) : Prop :=
  2 ≤ stmts.length ∧
  (∃ cx, p.branches.foldlM (fun acc br => xor32 acc br.c) zero32 = some cx ∧
    blake2b_256 (appendByteString
      (p.branches.foldl (fun acc br => appendByteString (appendByteString acc br.t0) br.t1)
        (stmts.foldl (fun acc s => appendByteString (appendByteString acc s.ap) s.bp)
          (appendByteString (appendByteString header a) b))) ctx) = cx) ∧
  ∃ A B, bls12_381_G1_uncompress a = .ok A ∧ bls12_381_G1_uncompress b = .ok B ∧
    AllPairs (branchHolds A B) stmts p.branches

/-- **`walk_outputs` read whole:** it succeeds exactly when there are at least `k` outputs, none
after the first `k` passes `output_at_script` (an output there with a stake credential or a
reference script doesn't, as in the source), each of the first `k` is a box out (`boxOut`), and each box
out's datum serialises. Then the statements are the box outs' in output order (reversed onto
`sts`), the datums' bytes are joined onto `ds`, and the box value's bytes `k` times onto `vs`. -/
theorem walkOutputs_eq (msh : ByteString) (val : List (Data × Data)) (bv : ByteString) :
    ∀ (outs : List TxOut) (k : Nat) (sts : List Stmt) (ds vs : ByteString),
      walkOutputs msh val bv outs k sts ds vs =
        if k ≤ outs.length ∧ ∀ o ∈ outs.drop k, outputAtScript o msh = false then
          ((outs.take k).mapM (boxOut msh val)).bind fun bs =>
            (bs.mapM fun b => Lovejoin.Classic.serialised b.2).map fun dss =>
              ((bs.map Prod.fst).reverse ++ sts, dss.foldl appendByteString ds,
                (List.replicate k bv).foldl appendByteString vs)
        else none
  | [], k, sts, ds, vs => by
    simp only [walkOutputs, List.length_nil, Nat.le_zero, List.drop_nil, List.not_mem_nil,
      false_imp_iff, implies_true, and_true]
    by_cases hk : k = 0
    · subst hk; simp
    · simp [hk]
  | o :: os, 0, sts, ds, vs => by
    have ih := walkOutputs_eq msh val bv os 0 sts ds vs
    have h0 : ((0 : Nat) : Integer) = 0 := rfl
    have hlt : ¬ ((0 : Integer) < 0) := Int.lt_irrefl 0
    simp only [h0] at ih ⊢
    simp only [List.drop_zero, List.take_zero, Nat.zero_le, true_and, List.mapM_nil, Option.pure_def,
      Option.bind_some, List.map_nil, List.reverse_nil, List.nil_append, List.foldl_nil, List.replicate_zero,
      Option.map_some] at ih ⊢
    simp only [walkOutputs, hlt, if_false, List.mem_cons, forall_eq_or_imp]
    cases outputAtScript o msh <;> simp [ih]
  | o :: os, k + 1, sts, ds, vs => by
    have ih := walkOutputs_eq msh val bv os k
    have hk : (0 : Integer) < ((k + 1 : Nat) : Integer) := by
      show (0 : Int) < ((k + 1 : Nat) : Int); omega
    have hk1 : ((k + 1 : Nat) : Integer) - 1 = (k : Integer) := by
      show ((k + 1 : Nat) : Int) - 1 = (k : Int); omega
    simp only [walkOutputs, hk, if_true, hk1, List.length_cons, Nat.add_le_add_iff_right,
      List.drop_succ_cons, List.take_succ_cons, List.mapM_cons]
    cases hb : boxOut msh val o with
    | none => simp
    | some b =>
      rcases b with ⟨st, x⟩
      dsimp only
      simp only [Option.bind_eq_bind, Option.bind_some, Option.pure_def]
      by_cases hc : k ≤ os.length ∧ ∀ o ∈ os.drop k, outputAtScript o msh = false
      · rw [if_pos hc]
        cases hm : (os.take k).mapM (boxOut msh val) with
        | none =>
          cases hx : Lovejoin.Classic.serialised x with
          | none => rfl
          | some sx => dsimp only; rw [ih, if_pos hc, hm]; rfl
        | some bs =>
          simp only [Option.bind_some, List.mapM_cons, Option.bind_eq_bind, Option.pure_def]
          cases hx : Lovejoin.Classic.serialised x with
          | none => rfl
          | some sx =>
            dsimp only
            rw [ih, if_pos hc, hm]
            simp only [Option.bind_some]
            cases bs.mapM (fun b => Lovejoin.Classic.serialised b.2) with
            | none => rfl
            | some dss =>
              simp [List.replicate_succ, List.foldl_cons, List.reverse_cons, List.append_assoc]
      · rw [if_neg hc]
        cases hx : Lovejoin.Classic.serialised x with
        | none => rfl
        | some sx => dsimp only; rw [ih, if_neg hc]

theorem cat_stmts : ∀ (stmts : List Stmt) (acc : ByteString),
    foldOpt catStep (stmts.map Stmt.toData) acc =
      some (stmts.foldl (fun acc s => appendByteString (appendByteString acc s.ap) s.bp) acc)
  | [], _ => rfl
  | s :: ss, acc => by
    simp only [List.map_cons, foldOpt, Stmt.toData, catStep, List.foldl_cons]
    exact cat_stmts ss _

theorem cat_branches : ∀ (brs : List SigmaOrBranch) (acc : ByteString),
    foldOpt catStep (brs.map SigmaOrBranch.toData) acc =
      some (brs.foldl (fun acc br => appendByteString (appendByteString acc br.t0) br.t1) acc)
  | [], _ => rfl
  | br :: bs, acc => by
    simp only [List.map_cons, foldOpt, SigmaOrBranch.toData, catStep, List.foldl_cons]
    exact cat_branches bs _

theorem xor_branches : ∀ (brs : List SigmaOrBranch) (acc : ByteString),
    foldOpt xorStep (brs.map SigmaOrBranch.toData) acc = brs.foldlM (fun acc br => xor32 acc br.c) acc
  | [], _ => rfl
  | br :: bs, acc => by
    simp only [List.map_cons, foldOpt, List.foldlM_cons]
    have hx : xorStep br.toData acc = xor32 acc br.c := by
      simp only [xorStep, SigmaOrBranch.toData, List.getElem?_cons_succ, List.getElem?_cons_zero, xor32,
        PlutusCore.Integer.equalsInteger]
      by_cases ha : lengthOfByteString acc = 32 <;> by_cases hc : lengthOfByteString br.c = 32 <;>
        simp [ha, hc, @eq_comm Integer 32]
    rw [hx]
    cases xor32 acc br.c with
    | none => rfl
    | some acc' => exact xor_branches bs acc'

/-- One branch, typed: the program's `branchOk` is `branchHolds`. -/
theorem branchOk_typed (A B : BLS12_381_G1_Element) (st : Stmt) (br : SigmaOrBranch) :
    branchOk A B st.toData br.toData = some true ↔ branchHolds A B st br := by
  rcases st with ⟨ap, bp, P, Q⟩
  rcases br with ⟨t0, t1, c, z⟩
  simp only [branchOk, Stmt.toData, SigmaOrBranch.toData, fieldsOf, bytesOf, List.getElem?_cons_succ,
    List.getElem?_cons_zero, Option.bind_eq_bind, Option.bind_some, branchHolds]
  cases hz : scalarOf z with
  | none => simp
  | some zs =>
    simp only [Option.bind_some, Option.some.injEq, exists_eq_left']
    cases h0 : bls12_381_G1_uncompress t0 <;> cases h1 : bls12_381_G1_uncompress t1 <;>
    cases hp : bls12_381_G1_uncompress (bls12_381_G1_compress P) <;>
    cases hq : bls12_381_G1_uncompress (bls12_381_G1_compress Q) <;>
    simp [Except.toOption]
    all_goals split <;> simp_all

/-- **Each Mix proof, typed:** the program's check of a box and its proof is `verify_pre`. -/
theorem mixPred_typed (pre ctx : ByteString) (stmts : List Stmt) (m : MixDatum) (p : SigmaOrProof) :
    mixPred pre ctx (stmts.map Stmt.toData) m.toData p.toData = some true ↔
      verifyPre m.a m.b stmts p ctx pre := by
  rcases m with ⟨a, b⟩
  rcases p with ⟨brs⟩
  simp only [mixPred, MixDatum.toData, fieldsOf, bytesOf, List.getElem?_cons_succ, List.getElem?_cons_zero,
    Option.bind_eq_bind, Option.bind_some, verifyPre]
  rcases stmts with _ | ⟨s0, _ | ⟨s1, ss⟩⟩
  · simp [mixCheck]
  · simp [mixCheck]
  · simp only [mixCheck, List.length_cons, Nat.le_add_left, true_and]
    split
    · simp only [SigmaOrProof.toData, fieldsOf, listOf, List.getElem?_cons_zero, Option.bind_some,
        Option.bind_eq_bind, cat_stmts, cat_branches, xor_branches]
      cases hx : brs.foldlM (fun acc br => xor32 acc br.c) zero32 with
      | none => simp
      | some cx =>
        simp only [Option.bind_some, Option.some.injEq, exists_eq_left', PlutusCore.ByteString.equalsByteString]
        split
        · rename_i heq
          have he := beq_iff_eq.1 heq
          simp only [he, true_and]
          cases ha : bls12_381_G1_uncompress a <;> cases hb : bls12_381_G1_uncompress b <;>
            simp [Except.toOption]
          rw [← List.map_cons, ← List.map_cons, pairsAll_map]
          exact allPairs_congr (fun st br => branchOk_typed _ _ st br) _ _
        · rename_i hne
          simp only [reduceCtorEq, false_iff, not_and]
          intro hh
          rw [hh] at hne
          exact (hne (beq_self_eq_true cx)).elim
    · rename_i hne
      exact (hne _ _ _ rfl).elim

/-! ### validate_mix -/

/-- mix_logic.ak's `validate_mix`: at least two boxes and as many proofs; the outputs walked for
that many box outs (`walk_outputs`, with the box value's bytes); at most 255 boxes; then each
box's proof passes `verify_pre` against the statements in output order, `ctx =
blake2b_256(datums ‖ values ‖ mix_script_hash)`, and the header `DOMAIN ‖ 0x03 ‖ n`, `n` as one
byte (`integerToByteString(True, 1, n)`, the builtin's own). -/
def validateMix (tx : TxInfo) (rd : RefDatum) (proofs : List SigmaOrProof) : Prop :=
  let boxes := collectWellFormedMixInputs tx rd.mixScriptHash
  2 ≤ boxes.length ∧ proofs.length = boxes.length ∧
  ∃ bv, Lovejoin.Classic.serialised (.Map rd.boxValue) = some bv ∧
  ∃ sts ds vs, walkOutputs rd.mixScriptHash rd.boxValue bv tx.txInfoOutputs boxes.length [] ⟨""⟩ ⟨""⟩ =
      some (sts, ds, vs) ∧
    boxes.length ≤ 255 ∧
    ∃ nb, i2b boxes.length = some nb ∧
      AllPairs (fun m p => verifyPre m.a m.b sts.reverse p
          (blake2b_256 (appendByteString (appendByteString ds vs) rd.mixScriptHash))
          (appendByteString prefix03 nb)) boxes proofs

/-- **The Mix, typed:** past the reference datum and the boxes, the program's `validate_mix` is
`validateMix`. Every transaction, no ledger assumption. -/
theorem mixResult_typed (rd : RefDatum) (tx : TxInfo) (ps : List SigmaOrProof) :
    mixResult rd.toData (IsData.toData tx) (.Constr 1 [.List (ps.map SigmaOrProof.toData)])
        ((collectWellFormedMixInputs tx rd.mixScriptHash).map MixDatum.toData) = some true ↔
      validateMix tx rd ps := by
  simp only [mixResult, RefDatum.toData, RefDatum.fields, countOf_map, boxValue_typed, walkFrom_typed,
    validateMix, PlutusCore.Integer.lessThanEqualsInteger, PlutusCore.Integer.equalsInteger]
  generalize collectWellFormedMixInputs tx rd.mixScriptHash = boxes
  by_cases h2 : (2 : Int) ≤ (boxes.length : Int)
  · have h2' : 2 ≤ boxes.length := by omega
    by_cases hl : ps.length = boxes.length
    · simp only [h2, decide_true, if_true, hl, beq_self_eq_true, h2', true_and]
      cases hbv : Lovejoin.Classic.serialised (.Map rd.boxValue) with
      | none => simp
      | some bv =>
        simp only [Option.bind_some, Option.some.injEq, exists_eq_left']
        cases hw : walkOutputs rd.mixScriptHash rd.boxValue bv tx.txInfoOutputs (boxes.length : Integer) [] ⟨""⟩ ⟨""⟩ with
        | none => simp
        | some r =>
          rcases r with ⟨sts, ds, vs⟩
          simp only [Option.map_some, Option.some.injEq, Prod.mk.injEq, and_assoc, exists_and_left,
            exists_eq_left']
          by_cases h255 : (boxes.length : Integer) ≤ 255
          · have h255' : boxes.length ≤ 255 := by have : (boxes.length : Int) ≤ 255 := h255; omega
            simp only [h255, decide_true, if_true, h255', true_and]
            cases hnb : i2b (boxes.length : Integer) with
            | none => simp
            | some nb =>
              simp only [Option.some.injEq, exists_eq_left']
              have hrev : (sts.map Stmt.toData).reverseAux [] = sts.reverse.map Stmt.toData := by
                rw [List.reverseAux_eq, List.append_nil, List.map_reverse]
              rw [hrev, pairsAll_map]
              exact allPairs_congr (fun m p => mixPred_typed _ _ _ m p) _ _
          · have h255' : ¬ boxes.length ≤ 255 := by
              have : ¬ (boxes.length : Int) ≤ 255 := h255; omega
            simp [h255, h255']
    · have hl' : ((ps.length : Int) == (boxes.length : Int)) = false := by simp; omega
      simp [h2, hl', hl]
  · have h2' : ¬ 2 ≤ boxes.length := by omega
    simp [h2, h2']

end Lovejoin.Every.Readable
