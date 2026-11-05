import Lovejoin.AnyTx.BoxCover

/-! A complete raw-data spend rule: every validly encoded output datum and every
length of input/withdrawal lists, including a missing input and duplicate references.
The first matching input is the one the compiled validator inspects. -/
namespace Lovejoin.AnyTx.BoxSemantics
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekValue (CekValue)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1 (TxRest)
open Seedelf.V1.LinesAll (exec_never_halts)
open Lovejoin.AnyTx
open Lovejoin.AnyTx.BoxSearch (inputList)
open Lovejoin.AnyTx.BoxCover

/-- An output datum passes the gate when it is not an inline, well-formed box,
or when the mix_logic withdrawal is present. -/
def datumPasses (L : ByteString) (wdrl : List (Data × Data)) : OutputDatum → Prop
  | .NoOutputDatum => True
  | .OutputDatumHash _ => True
  | .OutputDatum d => isBoxDatum d = false ∨ ∃ amount, (logicKey L, amount) ∈ wdrl

/-- `mix_box`'s gate rule, including its requirement that its own input be found. -/
def spendPasses (L : ByteString) (ref : Data) (ins wdrl : List (Data × Data)) : Prop :=
  ∃ (before after : List (Data × Data)) (addr value script : Data) (datum : OutputDatum),
    ins = before ++ (ref, .Constr 0 [addr, value, IsData.toData datum, script]) :: after ∧
    (∀ pair ∈ before, pair.1 ≠ ref) ∧ datumPasses L wdrl datum

/-- Once the first matching input is known, the rule covers all three ledger datums. -/
theorem found_iff (L : ByteString) (r : TxRest) (sigs red ref rd addr value script : Data)
    (before after wdrl : List (Data × Data)) (hBefore : ∀ pair ∈ before, pair.1 ≠ ref)
    (datum : OutputDatum) :
    (∃ n, cekExecuteProgram mixBoxTemplate.script
      [toTerm L, toTerm (boxSpendCtx r
        (.List (inputList (before ++ (ref, .Constr 0 [addr, value, IsData.toData datum, script]) :: after)))
        (.Map wdrl) sigs red ref rd)] n = .Halt (.VCon .Unit)) ↔ datumPasses L wdrl datum := by
  cases datum with
  | NoOutputDatum =>
    constructor
    · intro _; trivial
    · intro _; exact BoxAll.no_datum_recovers L r sigs red ref rd (.Map wdrl) addr value script before after hBefore
  | OutputDatumHash hash =>
    constructor
    · intro _; trivial
    · intro _; exact BoxAll.datum_hash_recovers L r sigs red ref rd (.Map wdrl) addr value script (.B hash) before after hBefore
  | OutputDatum d =>
    exact BoxComplete.inline_gate_iff L r sigs red ref rd addr value script before after wdrl hBefore d

/-- Every encoded output in a typed input list has the shape used by `found_iff`. -/
theorem typed_outputs_have_shape (xs : List TxInInfo) :
    ∀ pair ∈ inputPairs xs, ∃ (addr value : Data) (datum : OutputDatum) (script : Data),
      pair.2 = .Constr 0 [addr, value, IsData.toData datum, script] := by
  intro pair hp
  obtain ⟨input, _, he⟩ := List.mem_map.mp hp
  subst pair
  cases input with
  | mk ref out =>
    cases out with
    | mk addr value datum script => exact ⟨IsData.toData addr, IsData.toData value, datum, IsData.toData script, rfl⟩

/-- The complete rule for any list of inputs whose outputs have ledger datum shapes. -/
theorem raw_spend_iff (L : ByteString) (r : TxRest) (sigs red ref rd : Data)
    (ins wdrl : List (Data × Data))
    (hShape : ∀ pair ∈ ins, ∃ (addr value : Data) (datum : OutputDatum) (script : Data),
      pair.2 = .Constr 0 [addr, value, IsData.toData datum, script]) :
    (∃ n, cekExecuteProgram mixBoxTemplate.script
      [toTerm L, toTerm (boxSpendCtx r (.List (inputList ins)) (.Map wdrl) sigs red ref rd)] n = .Halt (.VCon .Unit)) ↔
      spendPasses L ref ins wdrl := by
  constructor
  · intro hs
    rcases first_match_split ref ins with hNone | ⟨before, out, after, hIns, hBefore⟩
    · obtain ⟨n₀, he⟩ := BoxAll.missing_input_errors L r sigs red ref rd (.Map wdrl) ins hNone
      obtain ⟨n, hn⟩ := hs
      exact False.elim ((exec_never_halts he n (.VCon .Unit)) hn)
    · have hout : (ref, out) ∈ ins := by rw [hIns]; simp
      obtain ⟨addr, value, datum, script, hOut⟩ := hShape (ref, out) hout
      dsimp only at hOut
      subst out
      have hs' := hs
      rw [hIns] at hs'
      have hp := (found_iff L r sigs red ref rd addr value script before after wdrl hBefore datum).mp hs'
      exact ⟨before, after, addr, value, script, datum, hIns, hBefore, hp⟩
  · rintro ⟨before, after, addr, value, script, datum, hIns, hBefore, hp⟩
    rw [hIns]
    exact (found_iff L r sigs red ref rd addr value script before after wdrl hBefore datum).mpr hp

/-- Every V3 spending context obeys the rule, without a transaction-size bound. -/
theorem every_spend_iff (L : ByteString) (tx : TxInfo) (red : Data) (ref : TxOutRef) (resolved : Option Data) :
    (∃ n, cekExecuteProgram mixBoxTemplate.script
      [toTerm L, toTerm (IsData.toData (⟨tx, red, .SpendingScript ref resolved⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) ↔
      spendPasses L (IsData.toData ref) (inputPairs tx.txInfoInputs) (withdrawalPairs tx.txInfoWdrl) := by
  rw [spend_encoding]
  exact raw_spend_iff L (TxRest.ofTxInfo tx) (IsData.toData tx.txInfoSignatories) red
    (IsData.toData ref) (IsData.toData resolved) (inputPairs tx.txInfoInputs) (withdrawalPairs tx.txInfoWdrl)
    (typed_outputs_have_shape tx.txInfoInputs)

/-- The same rule stated with the ledger's typed withdrawal credentials. -/
def datumPassesLedger (L : ByteString) (wdrl : List (Credential × Integer)) : OutputDatum → Prop
  | .NoOutputDatum => True
  | .OutputDatumHash _ => True
  | .OutputDatum d => isBoxDatum d = false ∨ ∃ amount, ((.ScriptCredential L : Credential), amount) ∈ wdrl

theorem datumPasses_ledger (L : ByteString) (wdrl : List (Credential × Integer)) (datum : OutputDatum) :
    datumPasses L (withdrawalPairs wdrl) datum ↔ datumPassesLedger L wdrl datum := by
  cases datum with
  | NoOutputDatum => rfl
  | OutputDatumHash _ => rfl
  | OutputDatum d =>
    simp only [datumPasses, datumPassesLedger, withdrawal_membership]

/-- The complete rule expressed using typed ledger withdrawals. -/
theorem every_spend_ledger_iff (L : ByteString) (tx : TxInfo) (red : Data) (ref : TxOutRef) (resolved : Option Data) :
    (∃ n, cekExecuteProgram mixBoxTemplate.script
      [toTerm L, toTerm (IsData.toData (⟨tx, red, .SpendingScript ref resolved⟩ : ScriptContext))] n = .Halt (.VCon .Unit)) ↔
    ∃ (before after : List (Data × Data)) (addr value script : Data) (datum : OutputDatum),
      inputPairs tx.txInfoInputs = before ++ (IsData.toData ref, .Constr 0 [addr, value, IsData.toData datum, script]) :: after ∧
      (∀ pair ∈ before, pair.1 ≠ IsData.toData ref) ∧ datumPassesLedger L tx.txInfoWdrl datum := by
  rw [every_spend_iff]
  simp only [spendPasses, datumPasses_ledger]

end Lovejoin.AnyTx.BoxSemantics

#print axioms Lovejoin.AnyTx.BoxSemantics.every_spend_iff

#print axioms Lovejoin.AnyTx.BoxSemantics.every_spend_ledger_iff
