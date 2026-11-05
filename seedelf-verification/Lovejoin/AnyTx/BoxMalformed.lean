import Lovejoin.AnyTx.BoxAll

/-! A malformed inline pair is recoverable, with arbitrary input-list lengths and
all withdrawals arbitrary Data. These three cases cover byte pairs whose first or
second length is wrong, or whose points are equal. -/
namespace Lovejoin.AnyTx.BoxMalformed
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

theorem first_length_recovers
    (L a b : ByteString) (r : TxRest) (sigs red ref rd wdrl addr value script : Data)
    (before after : List (Data × Data)) (hBefore : ∀ pair ∈ before, pair.1 ≠ ref) (ha : lengthOfByteString a ≠ 48) :
    ∃ n, cekExecuteProgram mixBoxTemplate.script
      [toTerm L, toTerm (boxSpendCtx r
        (.List (inputList (before ++ (ref, .Constr 0 [addr, value, .Constr 2 [.Constr 0 [.B a, .B b]], script]) :: after)))
        wdrl sigs red ref rd)] n = .Halt (.VCon .Unit) := by
  let out : Data := .Constr 0 [addr, value, .Constr 2 [.Constr 0 [.B a, .B b]], script]
  have hInput : ∀ (c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 : CekValue) (rest : Environment),
      Ev default searchBody
        (.VCon (.ConstDataList (inputList (before ++ (ref, out) :: after))) ::
          .VLam searchLoop (searchEnv ref c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest) ::
          searchEnv ref c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest)
        (some (.VCon (.Data (.Constr 0 [inputData ref out])))) := by
    intro c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest
    exact search_matched ref out before after hBefore c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest
  dsimp only [out] at hInput
  have he : PlutusCore.Integer.equalsInteger 48 (lengthOfByteString a) = false := by
    simp [PlutusCore.Integer.equalsInteger, Ne.symm ha]
  apply exec_halt_of_ev
  cek_v3_using [hInput]
  all_goals try rw [he]
  cek_v3_using [hInput]

theorem second_length_recovers
    (L a b : ByteString) (r : TxRest) (sigs red ref rd wdrl addr value script : Data)
    (before after : List (Data × Data)) (hBefore : ∀ pair ∈ before, pair.1 ≠ ref) (ha : lengthOfByteString a = 48) (hb : lengthOfByteString b ≠ 48) :
    ∃ n, cekExecuteProgram mixBoxTemplate.script
      [toTerm L, toTerm (boxSpendCtx r
        (.List (inputList (before ++ (ref, .Constr 0 [addr, value, .Constr 2 [.Constr 0 [.B a, .B b]], script]) :: after)))
        wdrl sigs red ref rd)] n = .Halt (.VCon .Unit) := by
  let out : Data := .Constr 0 [addr, value, .Constr 2 [.Constr 0 [.B a, .B b]], script]
  have hInput : ∀ (c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 : CekValue) (rest : Environment),
      Ev default searchBody
        (.VCon (.ConstDataList (inputList (before ++ (ref, out) :: after))) ::
          .VLam searchLoop (searchEnv ref c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest) ::
          searchEnv ref c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest)
        (some (.VCon (.Data (.Constr 0 [inputData ref out])))) := by
    intro c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest
    exact search_matched ref out before after hBefore c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest
  dsimp only [out] at hInput
  have he1 : PlutusCore.Integer.equalsInteger 48 (lengthOfByteString a) = true := by
    simp [PlutusCore.Integer.equalsInteger, ha]
  have he2 : PlutusCore.Integer.equalsInteger 48 (lengthOfByteString b) = false := by
    simp [PlutusCore.Integer.equalsInteger, Ne.symm hb]
  apply exec_halt_of_ev
  cek_v3_using [hInput]
  all_goals try rw [he1]
  cek_v3_using [hInput]
  all_goals try rw [he2]
  cek_v3_using [hInput]

theorem equal_points_recovers
    (L a b : ByteString) (r : TxRest) (sigs red ref rd wdrl addr value script : Data)
    (before after : List (Data × Data)) (hBefore : ∀ pair ∈ before, pair.1 ≠ ref) (ha : lengthOfByteString a = 48) (hb : lengthOfByteString b = 48) (hab : a = b) :
    ∃ n, cekExecuteProgram mixBoxTemplate.script
      [toTerm L, toTerm (boxSpendCtx r
        (.List (inputList (before ++ (ref, .Constr 0 [addr, value, .Constr 2 [.Constr 0 [.B a, .B b]], script]) :: after)))
        wdrl sigs red ref rd)] n = .Halt (.VCon .Unit) := by
  let out : Data := .Constr 0 [addr, value, .Constr 2 [.Constr 0 [.B a, .B b]], script]
  have hInput : ∀ (c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 : CekValue) (rest : Environment),
      Ev default searchBody
        (.VCon (.ConstDataList (inputList (before ++ (ref, out) :: after))) ::
          .VLam searchLoop (searchEnv ref c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest) ::
          searchEnv ref c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest)
        (some (.VCon (.Data (.Constr 0 [inputData ref out])))) := by
    intro c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest
    exact search_matched ref out before after hBefore c0 c1 c2 c10 c11 c12 c13 c14 c15 c16 rest
  dsimp only [out] at hInput
  have he1 : PlutusCore.Integer.equalsInteger 48 (lengthOfByteString a) = true := by
    simp [PlutusCore.Integer.equalsInteger, ha]
  have he2 : PlutusCore.Integer.equalsInteger 48 (lengthOfByteString b) = true := by
    simp [PlutusCore.Integer.equalsInteger, hb]
  have heq : PlutusCore.ByteString.equalsByteString a b = true := by
    simp [PlutusCore.ByteString.equalsByteString, hab]
  have heq' : PlutusCore.ByteString.equalsByteString b a = true := by
    simp [PlutusCore.ByteString.equalsByteString, hab]
  apply exec_halt_of_ev
  cek_v3_using [hInput]
  all_goals try rw [he1]
  cek_v3_using [hInput]
  all_goals try rw [he2]
  cek_v3_using [hInput]
  all_goals try rw [heq]
  all_goals try rw [heq']
  cek_v3_using [hInput]

end Lovejoin.AnyTx.BoxMalformed
