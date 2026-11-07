import Lovejoin.Every.ReadableOwner

/-! # The launch, typed

one_shot_mint's `mint` handler in the Aiken source's terms, over a typed `TxInfo`: the seed
spent, exactly one token under the policy, the first output that passes reference.ak's
`output_at_reference_holder` with an inline `ReferenceDatum`, and `datum_sane` with
`token_sane`. Proved equal to the raw `launchResult` on `IsData.toData` of the typed value, for a
mint and outputs the ledger accepts. -/

namespace Lovejoin.Every.Readable
open CardanoLedgerApi.IsData.Class (IsData)
open CardanoLedgerApi.V3
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString lengthOfByteString)
open PlutusCore.Integer (Integer)
open CardanoLedgerApi.V1.Value (valueOf)
open Lovejoin.Every

/-- reference.ak's `output_at_reference_holder`: the payment credential is the reference
holder's script, with no stake credential and no reference script, and the output holds exactly
one `(P, name)`. -/
def outputAtReferenceHolder (o : TxOut) (rh P name : ByteString) : Bool :=
  match o.txOutAddress.addressCredential with
  | .ScriptCredential h => h == rh && o.txOutAddress.addressStakingCredential.isNone &&
      o.txOutReferenceScript.isNone && valueOf P name o.txOutValue == 1
  | .PubKeyCredential _ => false

/-- one_shot_mint.ak's `datum_sane` and `token_sane`. -/
def datumSane (rd : RefDatum) : Prop :=
  0 < rd.boxLovelace ∧ 0 < rd.maxFeePerMixLovelace ∧ rd.maxFeePerMixLovelace < rd.boxLovelace ∧
    if rd.tokenPolicy = ⟨""⟩ then rd.tokenName = ⟨""⟩ ∧ rd.tokenQuantity = 0
    else lengthOfByteString rd.tokenPolicy = 28 ∧ lengthOfByteString rd.tokenName ≤ 32 ∧
      0 < rd.tokenQuantity ∧ rd.tokenQuantity ≤ 18446744073709551615

/-- one_shot_mint.ak's `mint`: exactly one token under the policy, `(name, quantity)`; the first
output that passes `output_at_reference_holder` for `(P, name)` (`list.find`: an earlier output
at the holder that fails the test is skipped); its inline datum a `ReferenceDatum`; and
the seed spent, the name `lovejoin`, the quantity 1 and the datum sane. -/
def launchOk (seedTx : ByteString) (seedIx : Integer) (rh P : ByteString) (tx : TxInfo) : Prop :=
  ∃ name q, tokensUnder P tx.txInfoMint = [(.B name, .I q)] ∧
  ∃ target, tx.txInfoOutputs.find? (fun o => outputAtReferenceHolder o rh P name) = some target ∧
  ∃ rd, inlineRefDatum target = some rd ∧
    tx.txInfoInputs.any (fun i => i.txInInfoOutRef == ⟨seedTx, seedIx⟩) = true ∧
    name = lovejoinName ∧ q = 1 ∧ datumSane rd

theorem outCond_typed (rh P nm : ByteString) (o : TxOut)
    (hv : CardanoLedgerApi.V1.Contexts.validTxOutValue o.txOutValue = true) :
    outCond rh P nm (IsData.toData o) = some (outputAtReferenceHolder o rh P nm) := by
  rcases o with ⟨⟨cred, stake⟩, value, datum, rs⟩
  have hs := valid_value_shape value hv
  change outCond rh P nm (.Constr 0 [.Constr 0 [IsData.toData cred, IsData.toData stake], .Map value,
    IsData.toData datum, IsData.toData rs]) = _
  rcases cred with pk | h
  · rfl
  · have hq : (match tokensOf P value with
        | some toks => (qtyOf nm toks).map (PlutusCore.Integer.equalsInteger 1)
        | none => none) = some (valueOf P nm value == 1) := by
      rw [tokensOf_eq, policy_search P value hs]
      simp only [qtyOf_eq, name_search P nm value hs, Option.map_some, PlutusCore.Integer.equalsInteger]
      congr 1
      exact Bool.beq_comm
    rcases stake with _ | s <;> rcases rs with _ | r <;> cases hh : (h == rh) <;>
      simp [cred_data, none_data, some_data, outCond, outputAtReferenceHolder, hh,
        PlutusCore.ByteString.equalsByteString, PlutusCore.Integer.equalsInteger, PlutusCore.Data.equalsData] <;>
      exact hq

theorem findOut_typed (rh P nm : ByteString) :
    ∀ (outs : List TxOut), (∀ o ∈ outs, CardanoLedgerApi.V1.Contexts.validTxOutValue o.txOutValue = true) →
      findOut rh P nm (outs.map IsData.toData) =
        some ((outs.find? fun o => outputAtReferenceHolder o rh P nm).map IsData.toData)
  | [], _ => rfl
  | o :: os, hv => by
    simp only [List.map_cons, findOut, outCond_typed rh P nm o (hv o (by simp)), List.find?_cons]
    cases outputAtReferenceHolder o rh P nm
    · exact findOut_typed rh P nm os (fun o' h' => hv o' (by simp [h']))
    · rfl

theorem seedIn_typed (seedTx : ByteString) (seedIx : Integer) :
    ∀ (ins : List TxInInfo),
      seedIn (.Constr 0 [.B seedTx, .I seedIx]) (ins.map IsData.toData) =
        some (ins.any fun i => i.txInInfoOutRef == ⟨seedTx, seedIx⟩)
  | [] => rfl
  | ⟨⟨tid, idx⟩, out⟩ :: is => by
    show (if PlutusCore.Data.equalsData (.Constr 0 [.B tid, .I idx]) (.Constr 0 [.B seedTx, .I seedIx])
      then some true else seedIn _ (is.map IsData.toData)) = _
    rw [seedIn_typed seedTx seedIx is]
    simp only [List.any_cons, PlutusCore.Data.equalsData]
    by_cases he : tid = seedTx ∧ idx = seedIx
    · obtain ⟨rfl, rfl⟩ := he
      simp
    · have hd : (Data.Constr 0 [.B tid, .I idx] == Data.Constr 0 [.B seedTx, .I seedIx]) = false := by
        simp only [beq_eq_false_iff_ne, ne_eq, Data.Constr.injEq, List.cons.injEq, Data.B.injEq,
          Data.I.injEq, and_true, true_and]
        exact he
      have hr : ((⟨tid, idx⟩ : TxOutRef) == ⟨seedTx, seedIx⟩) = false := by
        rw [beq_eq_false_iff_ne]; intro h; cases h; exact he ⟨rfl, rfl⟩
      simp [hd, hr]

theorem outDatum_typed (o : TxOut) :
    outDatum (IsData.toData o) = (inlineRefDatum o).map RefDatum.toData := by
  rcases o with ⟨addr, value, datum, rs⟩
  change outDatum (.Constr 0 [IsData.toData addr, .Map value, IsData.toData datum, IsData.toData rs]) = _
  rcases datum with _ | h | x
  · rfl
  · rfl
  · simp only [outDatum, datum_data, inlineRefDatum, PlutusCore.Integer.equalsInteger, beq_self_eq_true,
      if_true]
    rcases x with ⟨xt, xs⟩ | _ | _ | _ | _
    · exact refFields_eq xt xs
    all_goals rfl

/-- The datum's ranges, as the program checks them, are `datum_sane`. -/
theorem launchDatumOk_typed (rd : RefDatum) : launchDatumOk rd.toData = true ↔ datumSane rd := by
  rcases rd with ⟨bl, pol, nm, tq, fee, msh, lh, fh⟩
  simp only [launchDatumOk, RefDatum.toData, RefDatum.fields, datumSane, Bool.and_eq_true,
    PlutusCore.Integer.lessThanInteger, PlutusCore.Integer.lessThanEqualsInteger,
    PlutusCore.Integer.equalsInteger, PlutusCore.ByteString.equalsByteString, decide_eq_true_eq]
  by_cases hp : pol = ⟨""⟩
  · subst hp
    simp only [beq_self_eq_true, if_true, Bool.and_eq_true, beq_iff_eq, @eq_comm ByteString ⟨""⟩,
      @eq_comm Integer 0]
  · have hp' : ((⟨""⟩ : ByteString) == pol) = false := by simp [Ne.symm hp]
    simp only [hp', hp, Bool.false_eq_true, if_false, Bool.and_eq_true, beq_iff_eq, @eq_comm Integer 28,
      decide_eq_true_eq]

/-- **The launch, typed:** for a mint and outputs the ledger accepts, the program's
`launchResult` is one_shot_mint's `mint` handler. -/
theorem launchResult_typed (seedTx : ByteString) (seedIx : Integer) (rh P : ByteString) (tx : TxInfo)
    (hmint : CardanoLedgerApi.V3.Contexts.validMintValue tx.txInfoMint = true)
    (houts : ∀ o ∈ tx.txInfoOutputs, CardanoLedgerApi.V1.Contexts.validTxOutValue o.txOutValue = true) :
    launchResult seedTx seedIx rh (IsData.toData tx) P = some true ↔ launchOk seedTx seedIx rh P tx := by
  have hs := valid_mint_shape tx.txInfoMint hmint
  have hinfo : IsData.toData tx = .Constr 0 [.List (tx.txInfoInputs.map IsData.toData),
      IsData.toData tx.txInfoReferenceInputs, .List (tx.txInfoOutputs.map IsData.toData), .I tx.txInfoFee,
      .Map tx.txInfoMint, IsData.toData tx.txInfoTxCerts, IsData.toData tx.txInfoWdrl,
      IsData.toData tx.txInfoValidRange, IsData.toData tx.txInfoSignatories, IsData.toData tx.txInfoRedeemers,
      IsData.toData tx.txInfoData, IsData.toData tx.txInfoId, IsData.toData tx.txInfoVotes,
      IsData.toData tx.txInfoProposalProcedures, IsData.toData tx.txInfoCurrentTreasuryAmount,
      IsData.toData tx.txInfoTreasuryDonation] := by
    rw [← inputs_data, ← outputs_data]; rfl
  have hsearch : tokensOf P tx.txInfoMint = some (tokensUnder P tx.txInfoMint) := by
    rw [tokensOf_eq, policy_search P _ hs]
  obtain ⟨tasc, tints⟩ := tokensUnder_shape P _ hs
  rw [hinfo]
  simp only [launchResult, hsearch, launchOk]
  generalize tokensUnder P tx.txInfoMint = toks at tasc tints
  rcases toks with _ | ⟨⟨k, v⟩, _ | ⟨t2, ts⟩⟩
  · simp
  · rcases k with ⟨_, _⟩ | _ | _ | _ | nm
    all_goals try exact tasc.elim
    obtain ⟨q, rfl⟩ := tints (.B nm, v) (by simp)
    simp only [List.cons.injEq, Prod.mk.injEq, Data.B.injEq, Data.I.injEq, and_true, and_assoc,
      exists_and_left, exists_eq_left', findOut_typed rh P nm _ houts]
    cases hf : tx.txInfoOutputs.find? (fun o => outputAtReferenceHolder o rh P nm) with
    | none => simp
    | some target =>
      simp only [Option.map_some, Option.some.injEq, exists_eq_left', launchCheck, outDatum_typed]
      cases hr : inlineRefDatum target with
      | none => simp
      | some rd =>
        simp only [Option.map_some, Option.some.injEq, exists_eq_left', launchConds,
          seedIn_typed seedTx seedIx tx.txInfoInputs]
        cases hseed : tx.txInfoInputs.any (fun i => i.txInInfoOutRef == ⟨seedTx, seedIx⟩)
        · simp
        · simp only [PlutusCore.ByteString.equalsByteString, PlutusCore.Integer.equalsInteger, true_and]
          by_cases hn : nm = lovejoinName
          · subst hn
            simp only [beq_self_eq_true, if_true, true_and]
            by_cases h1 : q = 1
            · subst h1
              simp only [beq_self_eq_true, if_true, Option.some.injEq, true_and]
              exact launchDatumOk_typed rd
            · have h1' : ((1 : Integer) == q) = false := by simp [Ne.symm h1]
              simp [h1', h1]
          · have hn' : (lovejoinName == nm) = false := by simp [Ne.symm hn]
            simp [hn', hn]
  · simp

end Lovejoin.Every.Readable
