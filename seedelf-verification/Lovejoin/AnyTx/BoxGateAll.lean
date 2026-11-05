import Lovejoin.AnyTx.BoxAll
import Lovejoin.AnyTx.WithdrawSearch

/-! Whole-validator mix_box gate, using both compiled list-search loops at any length.
The prefix inputs do not match the spent reference; all suffixes and withdrawal keys
and values may be arbitrary Data. -/
namespace Lovejoin.AnyTx.BoxGateAll
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1 (TxRest)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.BoxSearch

set_option maxHeartbeats 0

/-- A well-formed box with no matching mix_logic withdrawal fails, no matter how
many input or withdrawal entries the script must traverse. -/
theorem wellformed_without_logic_errors (L a b : ByteString) (r : TxRest)
    (sigs red ref rd addr value script : Data) (before after wdrl : List (Data × Data))
    (hBefore : ∀ pair ∈ before, pair.1 ≠ ref)
    (ha : lengthOfByteString a = 48) (hb : lengthOfByteString b = 48) (hne : a ≠ b)
    (hWdrl : WithdrawSearch.hasKey (logicKey L) wdrl = false) :
    ∃ n, cekExecuteProgram mixBoxTemplate.script
      [toTerm L, toTerm (boxSpendCtx r
        (.List (inputList (before ++ (ref, .Constr 0 [addr, value, .Constr 2 [.Constr 0 [.B a, .B b]], script]) :: after)))
        (.Map wdrl) sigs red ref rd)] n = .Error := by
  let out : Data := .Constr 0 [addr, value, .Constr 2 [.Constr 0 [.B a, .B b]], script]
  have hn : searchResult ref (before ++ (ref, out) :: after) = .Constr 0 [inputData ref out] :=
    searchResult_split ref out before after hBefore
  have hInput : ∀ (c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 : CekValue) (rest : Environment),
      Ev default searchBody
        (.VCon (.ConstDataList (inputList (before ++ (ref, out) :: after))) ::
          .VLam searchLoop (searchEnv ref c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest) ::
          searchEnv ref c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest)
        (some (.VCon (.Data (.Constr 0 [inputData ref out])))) := by
    intro c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest
    simpa [hn] using search_all ref c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest (before ++ (ref, out) :: after)
  have hWithdrawal : ∀ (c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 c17 c18 c23 c24 c25 c26 c27 : CekValue) (rest : Environment),
      Ev default WithdrawSearch.searchBody
        (.VCon (.ConstPairDataList wdrl) ::
          .VLam WithdrawSearch.searchLoop (WithdrawSearch.searchEnv (logicKey L) c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 c17 c18 c23 c24 c25 c26 c27 rest) ::
          WithdrawSearch.searchEnv (logicKey L) c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 c17 c18 c23 c24 c25 c26 c27 rest)
        (some (.VCon (.Bool false))) := by
    intro c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 c17 c18 c23 c24 c25 c26 c27 rest
    simpa [hWdrl] using WithdrawSearch.search_all (logicKey L) c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 c17 c18 c23 c24 c25 c26 c27 rest wdrl
  have ha' : PlutusCore.Integer.equalsInteger 48 (lengthOfByteString a) = true := by
    simp [PlutusCore.Integer.equalsInteger, ha]
  have hb' : PlutusCore.Integer.equalsInteger 48 (lengthOfByteString b) = true := by
    simp [PlutusCore.Integer.equalsInteger, hb]
  have hab : PlutusCore.ByteString.equalsByteString a b = false := by
    simp [PlutusCore.ByteString.equalsByteString, hne]
  have hba : PlutusCore.ByteString.equalsByteString b a = false := by
    simp [PlutusCore.ByteString.equalsByteString, Ne.symm hne]
  dsimp only [out] at hInput
  apply exec_error_of_ev
  cek_v3_using [hInput, hWithdrawal]
  all_goals try rw [ha']
  cek_v3_using [hInput, hWithdrawal]
  all_goals try rw [hb']
  cek_v3_using [hInput, hWithdrawal]
  all_goals try rw [hab]
  all_goals try rw [hba]
  cek_v3_using [hInput, hWithdrawal]


/-- A well-formed box with a matching mix_logic withdrawal passes, no matter how
many input or withdrawal entries the script must traverse. -/
theorem wellformed_with_logic_passes (L a b : ByteString) (r : TxRest)
    (sigs red ref rd addr value script : Data) (before after wdrl : List (Data × Data))
    (hBefore : ∀ pair ∈ before, pair.1 ≠ ref)
    (ha : lengthOfByteString a = 48) (hb : lengthOfByteString b = 48) (hne : a ≠ b)
    (hWdrl : WithdrawSearch.hasKey (logicKey L) wdrl = true) :
    ∃ n, cekExecuteProgram mixBoxTemplate.script
      [toTerm L, toTerm (boxSpendCtx r
        (.List (inputList (before ++ (ref, .Constr 0 [addr, value, .Constr 2 [.Constr 0 [.B a, .B b]], script]) :: after)))
        (.Map wdrl) sigs red ref rd)] n = .Halt (.VCon .Unit) := by
  let out : Data := .Constr 0 [addr, value, .Constr 2 [.Constr 0 [.B a, .B b]], script]
  have hn : searchResult ref (before ++ (ref, out) :: after) = .Constr 0 [inputData ref out] :=
    searchResult_split ref out before after hBefore
  have hInput : ∀ (c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 : CekValue) (rest : Environment),
      Ev default searchBody
        (.VCon (.ConstDataList (inputList (before ++ (ref, out) :: after))) ::
          .VLam searchLoop (searchEnv ref c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest) ::
          searchEnv ref c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest)
        (some (.VCon (.Data (.Constr 0 [inputData ref out])))) := by
    intro c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest
    simpa [hn] using search_all ref c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest (before ++ (ref, out) :: after)
  have hWithdrawal : ∀ (c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 c17 c18 c23 c24 c25 c26 c27 : CekValue) (rest : Environment),
      Ev default WithdrawSearch.searchBody
        (.VCon (.ConstPairDataList wdrl) ::
          .VLam WithdrawSearch.searchLoop (WithdrawSearch.searchEnv (logicKey L) c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 c17 c18 c23 c24 c25 c26 c27 rest) ::
          WithdrawSearch.searchEnv (logicKey L) c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 c17 c18 c23 c24 c25 c26 c27 rest)
        (some (.VCon (.Bool true))) := by
    intro c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 c17 c18 c23 c24 c25 c26 c27 rest
    simpa [hWdrl] using WithdrawSearch.search_all (logicKey L) c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 c17 c18 c23 c24 c25 c26 c27 rest wdrl
  have ha' : PlutusCore.Integer.equalsInteger 48 (lengthOfByteString a) = true := by
    simp [PlutusCore.Integer.equalsInteger, ha]
  have hb' : PlutusCore.Integer.equalsInteger 48 (lengthOfByteString b) = true := by
    simp [PlutusCore.Integer.equalsInteger, hb]
  have hab : PlutusCore.ByteString.equalsByteString a b = false := by
    simp [PlutusCore.ByteString.equalsByteString, hne]
  have hba : PlutusCore.ByteString.equalsByteString b a = false := by
    simp [PlutusCore.ByteString.equalsByteString, Ne.symm hne]
  dsimp only [out] at hInput
  apply exec_halt_of_ev
  cek_v3_using [hInput, hWithdrawal]
  all_goals try rw [ha']
  cek_v3_using [hInput, hWithdrawal]
  all_goals try rw [hb']
  cek_v3_using [hInput, hWithdrawal]
  all_goals try rw [hab]
  all_goals try rw [hba]
  cek_v3_using [hInput, hWithdrawal]

/-- The complete well-formed-box gate for arbitrary list lengths: the script halts
with unit exactly when mix_logic's script credential occurs in the withdrawals. -/
theorem wellformed_gate_iff (L a b : ByteString) (r : TxRest)
    (sigs red ref rd addr value script : Data) (before after wdrl : List (Data × Data))
    (hBefore : ∀ pair ∈ before, pair.1 ≠ ref)
    (ha : lengthOfByteString a = 48) (hb : lengthOfByteString b = 48) (hne : a ≠ b) :
    (∃ n, cekExecuteProgram mixBoxTemplate.script
      [toTerm L, toTerm (boxSpendCtx r
        (.List (inputList (before ++ (ref, .Constr 0 [addr, value, .Constr 2 [.Constr 0 [.B a, .B b]], script]) :: after)))
        (.Map wdrl) sigs red ref rd)] n = .Halt (.VCon .Unit)) ↔
      ∃ amount, (logicKey L, amount) ∈ wdrl := by
  constructor
  · rintro ⟨n, hn⟩
    cases hw : WithdrawSearch.hasKey (logicKey L) wdrl with
    | true => exact (WithdrawSearch.hasKey_iff (logicKey L) wdrl).mp hw
    | false =>
      obtain ⟨n₀, he⟩ := wellformed_without_logic_errors L a b r sigs red ref rd addr value script
        before after wdrl hBefore ha hb hne hw
      exact False.elim ((exec_never_halts he n (.VCon .Unit)) hn)
  · intro hw
    have has := (WithdrawSearch.hasKey_iff (logicKey L) wdrl).mpr hw
    exact wellformed_with_logic_passes L a b r sigs red ref rd addr value script before after wdrl
      hBefore ha hb hne has

end Lovejoin.AnyTx.BoxGateAll

#print axioms Lovejoin.AnyTx.BoxGateAll.wellformed_gate_iff
