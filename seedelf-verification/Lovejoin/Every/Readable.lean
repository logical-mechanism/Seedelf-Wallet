import Lovejoin.Every.ReadableMix
import Lovejoin.Every.ReadableLaunch
import Lovejoin.AnyTx.LogicLedgerCarrier

/-! # mix_logic and one_shot_mint in every transaction, as the Aiken source reads

The top theorems in the source's terms. `mix_logic_accepts_iff`: for every typed V3 context whose
reference inputs' values the ledger accepts, mix_logic, at any pool policy `P` and the name
`lovejoin` (`nftName`, the one every v2 launch mints), returns `()` exactly when its `withdraw`
handler passes (`withdrawOk`: the redeemer `Owner` or `Mix`, `read_reference_datum`, then
`validate_owner` or `validate_mix`) or its `publish` handler does (a `RegisterCredential`).
`one_shot_mint_accepts_iff`: for every typed V3 context whose mint and outputs the ledger
accepts, one_shot_mint returns `()` exactly when its `mint` handler passes (`launchOk`).

Those two are the headline: their hypotheses are value rules the ledger enforces. The `_valid`
forms take the ledger model's whole `validScriptContext` instead, which is stricter than the
ledger: its `isBalanced` has no term for deposits, refunds or withdrawals, so it rejects every
real `RegisterCredential` (a deposit) and every withdrawal of a non-zero reward balance. They say
nothing about those transactions; the forms above do.

These compose `every_context_iff` and `mint_every_context_iff` (the CEK theorems, `Typed.lean`
and `MintTyped.lean`) with the restatements (`Readable*.lean`). The crypto builtins,
`serialise_data` (`encodeDataOpaque`), `bytearray_to_integer` and `xor_bytearray` stay opaque, so
each result holds for any interpretation of them. -/

namespace Lovejoin.Every.Readable
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.CekMachine
open Lovejoin.Template (nftName)
open Lovejoin.Every

/-! ### The redeemer -/

/-- types.ak's `MixLogicRedeemer`. -/
inductive MixLogicRedeemer
  | owner (proofs : List SchnorrProof)
  | mix (proofs : List SigmaOrProof)

def MixLogicRedeemer.toData : MixLogicRedeemer → Data
  | .owner ps => .Constr 0 [.List (ps.map SchnorrProof.toData)]
  | .mix ps => .Constr 1 [.List (ps.map SigmaOrProof.toData)]

/-- mix_logic.ak's `withdraw` handler: the redeemer is an `Owner` or a `Mix`, the reference datum
reads, and that branch's rule holds. -/
def withdrawOk (P : ByteString) (tx : TxInfo) (red : Data) : Prop :=
  ∃ r : MixLogicRedeemer, red = r.toData ∧ ∃ rd, readReferenceDatum P tx = some rd ∧
    match r with
    | .owner ps => validateOwner tx rd ps
    | .mix ps => validateMix tx rd ps

theorem ownerProof_iff (p : Data) : ownerProof p = true ↔ ∃ sp : SchnorrProof, p = sp.toData := by
  constructor
  · intro h
    rcases p with ⟨tp, _ | ⟨f0, _ | ⟨f1, rest⟩⟩⟩ | _ | _ | _ | _
    all_goals try (simp [ownerProof] at h; done)
    rcases f1 with ⟨_, _⟩ | _ | _ | _ | z <;> try (simp [ownerProof] at h; done)
    rcases f0 with ⟨_, _⟩ | _ | _ | _ | t <;> try (simp [ownerProof] at h; done)
    rcases rest with _ | ⟨_, _⟩ <;> simp [ownerProof, PlutusCore.Integer.equalsInteger] at h
    subst h
    exact ⟨⟨t, z⟩, rfl⟩
  · rintro ⟨⟨t, z⟩, rfl⟩; rfl

theorem mixBranchOk_iff (b : Data) : mixBranchOk b = true ↔ ∃ br : SigmaOrBranch, b = br.toData := by
  constructor
  · intro h
    rcases b with ⟨tb, _ | ⟨f0, _ | ⟨f1, _ | ⟨f2, _ | ⟨f3, rest⟩⟩⟩⟩⟩ | _ | _ | _ | _
    all_goals try (simp [mixBranchOk] at h; done)
    rcases f3 with ⟨_, _⟩ | _ | _ | _ | z <;> try (simp [mixBranchOk] at h; done)
    rcases f0 with ⟨_, _⟩ | _ | _ | _ | t0 <;> try (simp [mixBranchOk] at h; done)
    rcases f1 with ⟨_, _⟩ | _ | _ | _ | t1 <;> try (simp [mixBranchOk] at h; done)
    rcases f2 with ⟨_, _⟩ | _ | _ | _ | c <;> try (simp [mixBranchOk] at h; done)
    rcases rest with _ | ⟨_, _⟩ <;> simp [mixBranchOk, PlutusCore.Integer.equalsInteger] at h
    subst h
    exact ⟨⟨t0, t1, c, z⟩, rfl⟩
  · rintro ⟨⟨t0, t1, c, z⟩, rfl⟩; rfl

theorem allOwnerProofs_iff : ∀ (ps : List Data),
    allOwnerProofs ps = true ↔ ∃ tps : List SchnorrProof, ps = tps.map SchnorrProof.toData
  | [] => ⟨fun _ => ⟨[], rfl⟩, fun _ => rfl⟩
  | p :: ps => by
    simp only [allOwnerProofs, Bool.and_eq_true, ownerProof_iff, allOwnerProofs_iff ps]
    constructor
    · rintro ⟨⟨sp, rfl⟩, ⟨tps, rfl⟩⟩; exact ⟨sp :: tps, rfl⟩
    · rintro ⟨_ | ⟨sp, tps⟩, h⟩
      · cases h
      · simp only [List.map_cons, List.cons.injEq] at h
        exact ⟨⟨sp, h.1⟩, ⟨tps, h.2⟩⟩

theorem allMixBranches_iff : ∀ (bs : List Data),
    allMixBranches bs = true ↔ ∃ tbs : List SigmaOrBranch, bs = tbs.map SigmaOrBranch.toData
  | [] => ⟨fun _ => ⟨[], rfl⟩, fun _ => rfl⟩
  | b :: bs => by
    simp only [allMixBranches, Bool.and_eq_true, mixBranchOk_iff, allMixBranches_iff bs]
    constructor
    · rintro ⟨⟨br, rfl⟩, ⟨tbs, rfl⟩⟩; exact ⟨br :: tbs, rfl⟩
    · rintro ⟨_ | ⟨br, tbs⟩, h⟩
      · cases h
      · simp only [List.map_cons, List.cons.injEq] at h
        exact ⟨⟨br, h.1⟩, ⟨tbs, h.2⟩⟩

theorem mixProof_iff (p : Data) : mixProof p = true ↔ ∃ sp : SigmaOrProof, p = sp.toData := by
  constructor
  · intro h
    rcases p with ⟨tp, _ | ⟨f0, _ | ⟨f1, rest⟩⟩⟩ | _ | _ | _ | _
    all_goals try (simp [mixProof] at h; done)
    rcases f0 with ⟨_, _⟩ | _ | brs | _ | _ <;> try (simp [mixProof] at h; done)
    simp only [mixProof, PlutusCore.Integer.equalsInteger] at h
    split at h
    · rename_i h0
      obtain ⟨tbs, rfl⟩ := (allMixBranches_iff brs).1 h
      have : tp = 0 := (beq_iff_eq.1 h0).symm
      subst this
      exact ⟨⟨tbs⟩, rfl⟩
    · contradiction
  · rintro ⟨⟨tbs⟩, rfl⟩
    simp only [mixProof, SigmaOrProof.toData, PlutusCore.Integer.equalsInteger, beq_self_eq_true, if_true]
    exact (allMixBranches_iff _).2 ⟨tbs, rfl⟩

theorem allMixProofs_iff : ∀ (ps : List Data),
    allMixProofs ps = true ↔ ∃ tps : List SigmaOrProof, ps = tps.map SigmaOrProof.toData
  | [] => ⟨fun _ => ⟨[], rfl⟩, fun _ => rfl⟩
  | p :: ps => by
    simp only [allMixProofs, Bool.and_eq_true, mixProof_iff, allMixProofs_iff ps]
    constructor
    · rintro ⟨⟨sp, rfl⟩, ⟨tps, rfl⟩⟩; exact ⟨sp :: tps, rfl⟩
    · rintro ⟨_ | ⟨sp, tps⟩, h⟩
      · cases h
      · simp only [List.map_cons, List.cons.injEq] at h
        exact ⟨⟨sp, h.1⟩, ⟨tps, h.2⟩⟩

theorem ownerMain_typed (P : ByteString) (tx : TxInfo) (ps : List SchnorrProof)
    (hv : ∀ i ∈ tx.txInfoReferenceInputs,
      CardanoLedgerApi.V1.Contexts.validTxOutValue i.txInInfoResolved.txOutValue = true) :
    ownerMain P (IsData.toData tx) (.Constr 0 [.List (ps.map SchnorrProof.toData)]) = some true ↔
      ∃ rd, readReferenceDatum P tx = some rd ∧ validateOwner tx rd ps := by
  simp only [ownerMain, referenceDatum_typed P tx hv]
  cases readReferenceDatum P tx with
  | none => simp
  | some rd =>
    simp only [Option.map_some, boxesOf_typed, Option.some.injEq, exists_eq_left']
    exact ownerResult_typed rd tx ps

theorem mixMain_typed (P : ByteString) (tx : TxInfo) (ps : List SigmaOrProof)
    (hv : ∀ i ∈ tx.txInfoReferenceInputs,
      CardanoLedgerApi.V1.Contexts.validTxOutValue i.txInInfoResolved.txOutValue = true) :
    mixMain P (IsData.toData tx) (.Constr 1 [.List (ps.map SigmaOrProof.toData)]) = some true ↔
      ∃ rd, readReferenceDatum P tx = some rd ∧ validateMix tx rd ps := by
  simp only [mixMain, referenceDatum_typed P tx hv]
  cases readReferenceDatum P tx with
  | none => simp
  | some rd =>
    simp only [Option.map_some, boxesOf_typed, Option.some.injEq, exists_eq_left']
    exact mixResult_typed rd tx ps

/-- **The withdrawal, typed:** for reference inputs whose values the ledger accepts, the
program's `withdrawResult` is the `withdraw` handler. -/
theorem withdrawResult_typed (P : ByteString) (tx : TxInfo) (red : Data)
    (hv : ∀ i ∈ tx.txInfoReferenceInputs,
      CardanoLedgerApi.V1.Contexts.validTxOutValue i.txInInfoResolved.txOutValue = true) :
    withdrawResult P (IsData.toData tx) red = some true ↔ withdrawOk P tx red := by
  constructor
  · intro h
    rcases red with ⟨tr, _ | ⟨f0, _ | ⟨_, _⟩⟩⟩ | _ | _ | _ | _
    all_goals try (simp [withdrawResult] at h; done)
    rcases f0 with ⟨_, _⟩ | _ | ps | _ | _ <;> try (simp [withdrawResult] at h; done)
    simp only [withdrawResult, PlutusCore.Integer.equalsInteger] at h
    by_cases h0 : tr = 0
    · subst h0
      simp only [beq_self_eq_true, if_true] at h
      split at h
      · rename_i hps
        obtain ⟨tps, rfl⟩ := (allOwnerProofs_iff ps).1 hps
        obtain ⟨rd, hrd, hok⟩ := (ownerMain_typed P tx tps hv).1 h
        exact ⟨.owner tps, rfl, rd, hrd, hok⟩
      · contradiction
    · have h0' : ((0 : Integer) == tr) = false := by simp [Ne.symm h0]
      by_cases h1 : tr = 1
      · subst h1
        simp only [h0', Bool.false_eq_true, if_false, beq_self_eq_true, if_true] at h
        split at h
        · rename_i hps
          obtain ⟨tps, rfl⟩ := (allMixProofs_iff ps).1 hps
          obtain ⟨rd, hrd, hok⟩ := (mixMain_typed P tx tps hv).1 h
          exact ⟨.mix tps, rfl, rd, hrd, hok⟩
        · contradiction
      · have h1' : ((1 : Integer) == tr) = false := by simp [Ne.symm h1]
        simp [h0', h1'] at h
  · rintro ⟨r, rfl, rd, hrd, hok⟩
    cases r with
    | owner tps =>
      have hps : allOwnerProofs (tps.map SchnorrProof.toData) = true := (allOwnerProofs_iff _).2 ⟨tps, rfl⟩
      simp only [MixLogicRedeemer.toData, withdrawResult, PlutusCore.Integer.equalsInteger, beq_self_eq_true,
        if_true, hps]
      exact (ownerMain_typed P tx tps hv).2 ⟨rd, hrd, hok⟩
    | mix tps =>
      have hps : allMixProofs (tps.map SigmaOrProof.toData) = true := (allMixProofs_iff _).2 ⟨tps, rfl⟩
      have h0 : ((0 : Integer) == 1) = false := rfl
      simp only [MixLogicRedeemer.toData, withdrawResult, PlutusCore.Integer.equalsInteger, h0,
        Bool.false_eq_true, if_false, beq_self_eq_true, if_true, hps]
      exact (mixMain_typed P tx tps hv).2 ⟨rd, hrd, hok⟩

/-! ### mix_logic -/

/-- mix_logic.ak, every handler: `withdraw` by `withdrawOk`, `publish` only a
`RegisterCredential` (V3's `TxCertRegStaking`), and `else(_) { fail }`. -/
def mixLogicAccepts (P : ByteString) (ctx : ScriptContext) : Prop :=
  match ctx.scriptContextScriptInfo with
  | .RewardingScript _ => withdrawOk P ctx.scriptContextTxInfo ctx.scriptContextRedeemer
  | .CertifyingScript _ cert => ∃ cred dep, cert = .TxCertRegStaking cred dep
  | _ => False

theorem registration_iff (cert : TxCert) :
    Lovejoin.Template.AnyTx.isRegistrationData (IsData.toData cert) = true ↔
      ∃ cred dep, cert = .TxCertRegStaking cred dep := by
  cases cert <;> simp [Lovejoin.Template.AnyTx.isRegistrationData, IsData.toData,
    CardanoLedgerApi.IsData.Class.mkDataConstr]

/-- **mix_logic, every typed V3 context, as the source reads:** for reference inputs whose values
the ledger accepts, the program returns `()` exactly when `mixLogicAccepts` holds. -/
theorem mix_logic_accepts_iff (P : ByteString) (ctx : ScriptContext)
    (hv : ∀ i ∈ ctx.scriptContextTxInfo.txInfoReferenceInputs,
      CardanoLedgerApi.V1.Contexts.validTxOutValue i.txInInfoResolved.txOutValue = true) :
    (∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData ctx)] n = .Halt (.VCon .Unit)) ↔
      mixLogicAccepts P ctx := by
  rw [every_context_iff]
  rcases ctx with ⟨tx, red, si⟩
  cases si with
  | RewardingScript cred => exact withdrawResult_typed P tx red hv
  | CertifyingScript idx cert => exact registration_iff cert
  | _ => exact Iff.rfl

/-- The same, for every context the ledger model accepts (`validScriptContext`). Narrower than
`mix_logic_accepts_iff`: the model's balance rule rejects a deposit or a non-zero withdrawal. -/
theorem mix_logic_accepts_iff_valid (P : ByteString) (ctx : ScriptContext)
    (hctx : CardanoLedgerApi.V3.Contexts.validScriptContext ctx = true) :
    (∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (IsData.toData ctx)] n = .Halt (.VCon .Unit)) ↔
      mixLogicAccepts P ctx :=
  mix_logic_accepts_iff P ctx (Lovejoin.AnyTx.LogicLedgerValueCover.valid_reference_inputs_values ctx
    (Lovejoin.AnyTx.LogicLedgerCarrier.valid_reference_inputs_of_valid_context ctx hctx))

/-! ### one_shot_mint -/

/-- one_shot_mint.ak, every handler: `mint` by `launchOk`, and `else(_) { fail }`. -/
def oneShotMintAccepts (seedTx : ByteString) (seedIx : Integer) (rh : ByteString) (ctx : ScriptContext) : Prop :=
  match ctx.scriptContextScriptInfo with
  | .MintingScript P => launchOk seedTx seedIx rh P ctx.scriptContextTxInfo
  | _ => False

/-- **one_shot_mint, every typed V3 context, as the source reads:** for a mint and outputs the
ledger accepts, the program returns `()` exactly when `oneShotMintAccepts` holds. -/
theorem one_shot_mint_accepts_iff (seedTx : ByteString) (seedIx : Integer) (rh : ByteString)
    (ctx : ScriptContext)
    (hmint : CardanoLedgerApi.V3.Contexts.validMintValue ctx.scriptContextTxInfo.txInfoMint = true)
    (houts : ∀ o ∈ ctx.scriptContextTxInfo.txInfoOutputs,
      CardanoLedgerApi.V1.Contexts.validTxOutValue o.txOutValue = true) :
    (∃ n, cekExecuteProgram oneShotMintTemplate.script
      [toTerm seedTx, toTerm seedIx, toTerm rh, toTerm (IsData.toData ctx)] n = .Halt (.VCon .Unit)) ↔
      oneShotMintAccepts seedTx seedIx rh ctx := by
  rw [mint_every_context_iff]
  rcases ctx with ⟨tx, red, si⟩
  cases si with
  | MintingScript P => exact launchResult_typed seedTx seedIx rh P tx hmint houts
  | _ => exact Iff.rfl

theorem outputs_valid : ∀ (outs : List TxOut),
    CardanoLedgerApi.V2.Contexts.validOutputs outs = true →
      ∀ o ∈ outs, CardanoLedgerApi.V1.Contexts.validTxOutValue o.txOutValue = true
  | [], _ => by simp
  | o :: os, h => by
    have hc : CardanoLedgerApi.V2.Contexts.validOutputs (o :: os) =
        (CardanoLedgerApi.V1.Contexts.validTxOutValue o.txOutValue && CardanoLedgerApi.V2.Contexts.validOutputs os) :=
      rfl
    have h' : CardanoLedgerApi.V1.Contexts.validTxOutValue o.txOutValue = true ∧
        CardanoLedgerApi.V2.Contexts.validOutputs os = true := by
      rw [hc, Bool.and_eq_true] at h; exact h
    intro x hx
    simp only [List.mem_cons] at hx
    rcases hx with rfl | hx
    · exact h'.1
    · exact outputs_valid os h'.2 x hx

/-- The same, for every context the ledger model accepts (`validScriptContext`). Narrower than
`one_shot_mint_accepts_iff`, for the same reason. -/
theorem one_shot_mint_accepts_iff_valid (seedTx : ByteString) (seedIx : Integer) (rh : ByteString)
    (ctx : ScriptContext) (hctx : CardanoLedgerApi.V3.Contexts.validScriptContext ctx = true) :
    (∃ n, cekExecuteProgram oneShotMintTemplate.script
      [toTerm seedTx, toTerm seedIx, toTerm rh, toTerm (IsData.toData ctx)] n = .Halt (.VCon .Unit)) ↔
      oneShotMintAccepts seedTx seedIx rh ctx := by
  simp only [CardanoLedgerApi.V3.Contexts.validScriptContext, CardanoLedgerApi.V3.Contexts.validTxInfo,
    Bool.and_eq_true] at hctx
  -- validTxInfo's fourteen conjuncts: the outputs are the third, the mint the fifth.
  exact one_shot_mint_accepts_iff seedTx seedIx rh ctx hctx.2.1.1.1.1.1.1.1.1.1.2
    (outputs_valid _ hctx.2.1.1.1.1.1.1.1.1.1.1.1.2)

end Lovejoin.Every.Readable

/-- info: 'Lovejoin.Every.Readable.mix_logic_accepts_iff_valid' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms Lovejoin.Every.Readable.mix_logic_accepts_iff_valid

/-- info: 'Lovejoin.Every.Readable.one_shot_mint_accepts_iff_valid' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms Lovejoin.Every.Readable.one_shot_mint_accepts_iff_valid
