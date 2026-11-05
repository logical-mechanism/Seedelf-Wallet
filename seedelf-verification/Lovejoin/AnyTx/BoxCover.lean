import Lovejoin.AnyTx.BoxComplete
import Seedelf.AnyTxCover

/-! Kernel-checked bridge between the raw-data gate theorems and the ledger model's
V3 spending contexts. The two lists below cover every typed input and withdrawal list;
no length or ledger-validity assumption is used. -/
namespace Lovejoin.AnyTx.BoxCover
open CardanoLedgerApi.IsData.Class (IsData)
open CardanoLedgerApi.V3
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open Seedelf.V1 (TxRest)
open Lovejoin.AnyTx
open Lovejoin.AnyTx.BoxSearch (inputData inputList)

def inputPairs (xs : List TxInInfo) : List (Data × Data) :=
  xs.map fun x => (IsData.toData x.txInInfoOutRef, IsData.toData x.txInInfoResolved)

def withdrawalPairs (xs : Withdrawals) : List (Data × Data) :=
  xs.map fun x => (IsData.toData x.1, .I x.2)

/-- Every typed input list has the raw shape used by the unbounded search. -/
theorem inputs_encoding (xs : List TxInInfo) :
    IsData.toData xs = .List (inputList (inputPairs xs)) := by
  change Data.List (CardanoLedgerApi.V3.Contexts.txInfoInputsToListData xs) = _
  congr 1
  induction xs with
  | nil => rfl
  | cons x xs ih =>
    change IsData.toData x :: CardanoLedgerApi.V3.Contexts.txInfoInputsToListData xs =
      inputData (IsData.toData x.txInInfoOutRef) (IsData.toData x.txInInfoResolved) :: inputList (inputPairs xs)
    rw [ih]
    cases x
    rfl

/-- Every typed withdrawal list has the map shape used by the unbounded search. -/
theorem withdrawals_encoding (xs : Withdrawals) :
    IsData.toData xs = .Map (withdrawalPairs xs) := by
  change Data.Map (CardanoLedgerApi.V3.Governance.withdrawalsToListPairData xs) = _
  congr 1
  induction xs with
  | nil => rfl
  | cons x xs ih =>
    rcases x with ⟨cred, amount⟩
    change (IsData.toData cred, .I amount) :: CardanoLedgerApi.V3.Governance.withdrawalsToListPairData xs =
      (IsData.toData cred, .I amount) :: withdrawalPairs xs
    rw [ih]

/-- Every V3 spend is one of the raw contexts consumed by the gate proofs. -/
theorem spend_encoding (tx : TxInfo) (red : Data) (ref : TxOutRef) (resolved : Option Data) :
    IsData.toData (⟨tx, red, .SpendingScript ref resolved⟩ : ScriptContext) =
      boxSpendCtx (TxRest.ofTxInfo tx) (.List (inputList (inputPairs tx.txInfoInputs)))
        (.Map (withdrawalPairs tx.txInfoWdrl)) (IsData.toData tx.txInfoSignatories)
        red (IsData.toData ref) (IsData.toData resolved) := by
  rw [Seedelf.V1.spendIn_of_spend]
  rw [← inputs_encoding tx.txInfoInputs, ← withdrawals_encoding tx.txInfoWdrl]
  rfl

/-- Every typed output's datum has exactly one of the three ledger encodings. -/
theorem output_datum_shape (d : OutputDatum) :
    IsData.toData d = .Constr 0 [] ∨
    (∃ hash : ByteString, IsData.toData d = .Constr 1 [.B hash]) ∨
    ∃ inline : Data, IsData.toData d = .Constr 2 [inline] := by
  cases d with
  | NoOutputDatum => exact Or.inl rfl
  | OutputDatumHash h => exact Or.inr (Or.inl ⟨h, rfl⟩)
  | OutputDatum d => exact Or.inr (Or.inr ⟨d, rfl⟩)

/-- Every raw input list either has no matching reference or splits at its first match. -/
theorem first_match_split (ref : Data) (xs : List (Data × Data)) :
    (∀ pair ∈ xs, pair.1 ≠ ref) ∨
    ∃ before out after, xs = before ++ (ref, out) :: after ∧
      ∀ pair ∈ before, pair.1 ≠ ref := by
  induction xs with
  | nil => exact Or.inl (by simp)
  | cons x xs ih =>
    rcases x with ⟨key, out⟩
    by_cases h : key = ref
    · subst key
      exact Or.inr ⟨[], out, xs, rfl, by simp⟩
    · rcases ih with hNone | ⟨before, found, after, hx, hBefore⟩
      · exact Or.inl (by intro pair hp; simp only [List.mem_cons] at hp; rcases hp with rfl | hp; exact h; exact hNone pair hp)
      · exact Or.inr ⟨(key, out) :: before, found, after, by simp [hx], by
          intro pair hp
          simp only [List.mem_cons] at hp
          rcases hp with rfl | hp
          · exact h
          · exact hBefore pair hp⟩

/-- The raw withdrawal key is exactly the ledger's script credential, not a key
credential with the same bytes. -/
theorem credential_encoding_eq (L : ByteString) (credential : Credential) :
    IsData.toData credential = logicKey L ↔ credential = .ScriptCredential L := by
  cases credential with
  | PubKeyCredential h =>
    change Data.Constr 0 [.B h] = .Constr 1 [.B L] ↔ _
    simp
  | ScriptCredential h =>
    change Data.Constr 1 [.B h] = .Constr 1 [.B L] ↔ _
    simp

/-- Membership of the raw key is exactly a script withdrawal in the ledger type. -/
theorem withdrawal_membership (L : ByteString) (xs : List (Credential × Integer)) :
    (∃ amount, (logicKey L, amount) ∈ withdrawalPairs xs) ↔
      ∃ amount : Integer, ((.ScriptCredential L : Credential), amount) ∈ xs := by
  constructor
  · rintro ⟨amount, hm⟩
    obtain ⟨⟨credential, n⟩, hin, heq⟩ := List.mem_map.mp hm
    have hc : IsData.toData credential = logicKey L := (Prod.mk.inj heq).1
    have hc' := (credential_encoding_eq L credential).mp hc
    subst credential
    exact ⟨n, hin⟩
  · rintro ⟨n, hin⟩
    exact ⟨.I n, List.mem_map.mpr ⟨(.ScriptCredential L, n), hin, rfl⟩⟩

end Lovejoin.AnyTx.BoxCover

#print axioms Lovejoin.AnyTx.BoxCover.spend_encoding
#print axioms Lovejoin.AnyTx.BoxCover.first_match_split
