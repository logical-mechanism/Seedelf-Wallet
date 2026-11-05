import Lovejoin.AnyTx.LogicReferenceFilter
import Lovejoin.AnyTx.Common

/-! The compiled Mix redeemer's proof-list validation loop for empty branch lists. -/
namespace Lovejoin.AnyTx.LogicMixParse
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term Program)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.BoxSearch (subterm)

def templateBody : Term := match mixLogicTemplate.script with | .Program _ b => b
def loopAt : List Nat := [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,2,0,0,1]
def loopLoop : Term := subterm templateBody (loopAt ++ [0])
def loopBody : Term := subterm templateBody (loopAt ++ [0,0])
def predAt : List Nat := [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,2,0,0,0,1,0,0,0,0,0,1,0,1]
def predLoop : Term := subterm templateBody (predAt ++ [0])

def iteratorAt : List Nat := [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,2]
def iteratorLoop : Term := subterm templateBody (iteratorAt ++ [0])
def iteratorValue (rest : Environment) : CekValue := .VLam iteratorLoop rest

def predEnv (continuation : CekValue) (iteratorRest : Environment) (c31 c29 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 : CekValue) (rest : Environment) : Environment :=
  c31 :: continuation :: c29 :: iteratorValue iteratorRest :: c27 :: c26 :: c20 :: c19 ::
  .VBuiltin .EqualsInteger [.VCon (.Integer 0)] (.One .ArgV) :: c17 :: c16 :: c15 :: c14 :: c13 :: c12 :: c11 ::
  .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
  .VBuiltin .FstPair [] (.One .ArgV) :: .VBuiltin .SndPair [] (.One .ArgV) ::
  .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) :: c6 ::
  .VBuiltin .HeadList [] (.One .ArgV) :: .VBuiltin .TailList [] (.One .ArgV) :: rest

def proofList (n : Nat) : List Data :=
  List.replicate n (.Constr 0 [.List []])

set_option maxHeartbeats 0

theorem mix_empty_branches_validate (continuation : CekValue) (c31 c29 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 : CekValue)
    (iteratorRest predRest loopRest : Environment) (originalList : CekValue) (result : Option CekValue)
    (hContinuation : Fo default continuation result) (n : Nat) :
    Ev default loopBody
      (.VCon (.ConstDataList (proofList n)) ::
        .VLam loopLoop (.VLam predLoop (predEnv continuation iteratorRest c31 c29 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 predRest) :: originalList :: loopRest) ::
        .VLam predLoop (predEnv continuation iteratorRest c31 c29 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 predRest) :: originalList :: loopRest)
      result := by
  induction n with
  | zero =>
    simp only [proofList, List.replicate_zero]
    cek_v3_using [hContinuation]
  | succ n ih =>
    simp only [proofList, List.replicate_succ]
    cek_v3_using [ih, hContinuation]

/-- A Mix branch has four byte-string fields in constructor zero. -/
abbrev Branch := ByteString × ByteString × ByteString × ByteString

def branchData (b : Branch) : Data :=
  .Constr 0 [.B b.1, .B b.2.1, .B b.2.2.1, .B b.2.2.2]

def branchList (xs : List Branch) : List Data := xs.map branchData

def innerPredAt : List Nat := [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,2,0,0,0,1,0,0,0,0,0,1,0,1,0,0,0,0,2,0,0,0,0,0,1,0,0,0,0,0,1,0,1]
def innerPredLoop : Term := subterm templateBody (innerPredAt ++ [0])

/-- The nested branch loop checks every branch, then continues with the next proof. -/
theorem mix_branch_list_validates (continuation : CekValue)
    (c39 c29 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 : CekValue)
    (iteratorRest predRest loopRest : Environment) (c43 c42 outerRec : CekValue)
    (outerHead : Data) (outerTail : List Data) (originalList : CekValue) (result : Option CekValue)
    (hOuter : Ap default outerRec (.VCon (.ConstDataList outerTail)) result) (branches : List Branch) :
    Ev default loopBody
      (.VCon (.ConstDataList (branchList branches)) ::
        .VLam loopLoop (.VLam innerPredLoop (c43 :: c42 :: outerRec ::
          .VCon (.ConstDataList (outerHead :: outerTail)) ::
          predEnv continuation iteratorRest c39 c29 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 predRest) :: originalList :: loopRest) ::
        .VLam innerPredLoop (c43 :: c42 :: outerRec :: .VCon (.ConstDataList (outerHead :: outerTail)) ::
          predEnv continuation iteratorRest c39 c29 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 predRest) :: originalList :: loopRest)
      result := by
  induction branches with
  | nil =>
    simp only [branchList, List.map_nil]
    cek_v3_using [hOuter]
  | cons branch branches ih =>
    rcases branch with ⟨t0, t1, c, z⟩
    simp only [branchList, List.map_cons]
    cek_v3_using [ih, hOuter]
    cases result <;> cek_v3

/-- A valid branch prefix leaves the next branch and its suffix unchanged. -/
theorem mix_branch_valid_prefix (continuation : CekValue)
    (c39 c29 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 : CekValue)
    (iteratorRest predRest loopRest : Environment) (c43 c42 outerRec : CekValue)
    (outerHead : Data) (outerTail : List Data) (originalList : CekValue) (result : Option CekValue)
    (suffix : List Data) (branches : List Branch)
    (hSuffix : Ev default loopBody
      (.VCon (.ConstDataList suffix) ::
        .VLam loopLoop (.VLam innerPredLoop (c43 :: c42 :: outerRec ::
          .VCon (.ConstDataList (outerHead :: outerTail)) ::
          predEnv continuation iteratorRest c39 c29 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 predRest) :: originalList :: loopRest) ::
        .VLam innerPredLoop (c43 :: c42 :: outerRec :: .VCon (.ConstDataList (outerHead :: outerTail)) ::
          predEnv continuation iteratorRest c39 c29 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 predRest) :: originalList :: loopRest) result) :
    Ev default loopBody
      (.VCon (.ConstDataList (branchList branches ++ suffix)) ::
        .VLam loopLoop (.VLam innerPredLoop (c43 :: c42 :: outerRec ::
          .VCon (.ConstDataList (outerHead :: outerTail)) ::
          predEnv continuation iteratorRest c39 c29 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 predRest) :: originalList :: loopRest) ::
        .VLam innerPredLoop (c43 :: c42 :: outerRec :: .VCon (.ConstDataList (outerHead :: outerTail)) ::
          predEnv continuation iteratorRest c39 c29 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 predRest) :: originalList :: loopRest)
      result := by
  induction branches with
  | nil =>
    simpa [branchList] using hSuffix
  | cons branch branches ih =>
    rcases branch with ⟨t0, t1, c, z⟩
    simp only [branchList, List.map_cons, List.cons_append]
    cek_v3_using [ih]
    cases result <;> cek_v3

/-- Mix proofs each contain an arbitrary list of four-field branches. -/
def fullProofList (proofs : List (List Branch)) : List Data :=
  proofs.map fun branches => .Constr 0 [.List (branchList branches)]

/-- Both nested compiled loops validate any number of structurally formed Mix
proofs, with any number of branches each, before continuing. -/
theorem mix_full_proof_list_validates (continuation : CekValue)
    (c31 c29 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 : CekValue)
    (iteratorRest predRest loopRest : Environment) (originalList : CekValue) (result : Option CekValue)
    (hContinuation : Fo default continuation result) (proofs : List (List Branch)) :
    Ev default loopBody
      (.VCon (.ConstDataList (fullProofList proofs)) ::
        .VLam loopLoop (.VLam predLoop (predEnv continuation iteratorRest c31 c29 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 predRest) :: originalList :: loopRest) ::
        .VLam predLoop (predEnv continuation iteratorRest c31 c29 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 predRest) :: originalList :: loopRest)
      result := by
  induction proofs with
  | nil =>
    simp only [fullProofList, List.map_nil]
    cek_v3_using [hContinuation]
  | cons branches proofs ih =>
    simp only [fullProofList, List.map_cons]
    cek_v3_using [mix_branch_list_validates, ih, hContinuation]
    all_goals try (apply ap_lam; exact ih)
    all_goals try (cases result <;> cek_v3)

/-- A structurally valid Mix proof prefix leaves the suffix behavior unchanged. -/
theorem mix_valid_prefix (continuation : CekValue)
    (c31 c29 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 : CekValue)
    (iteratorRest predRest loopRest : Environment) (originalList : CekValue) (result : Option CekValue)
    (suffix : List Data) (proofs : List (List Branch))
    (hSuffix : Ev default loopBody
      (.VCon (.ConstDataList suffix) ::
        .VLam loopLoop (.VLam predLoop (predEnv continuation iteratorRest c31 c29 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 predRest) :: originalList :: loopRest) ::
        .VLam predLoop (predEnv continuation iteratorRest c31 c29 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 predRest) :: originalList :: loopRest) result) :
    Ev default loopBody
      (.VCon (.ConstDataList (fullProofList proofs ++ suffix)) ::
        .VLam loopLoop (.VLam predLoop (predEnv continuation iteratorRest c31 c29 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 predRest) :: originalList :: loopRest) ::
        .VLam predLoop (predEnv continuation iteratorRest c31 c29 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 predRest) :: originalList :: loopRest)
      result := by
  induction proofs with
  | nil =>
    simpa [fullProofList] using hSuffix
  | cons branches proofs ih =>
    simp only [fullProofList, List.map_cons, List.cons_append]
    cek_v3_using [mix_branch_list_validates, ih]
    all_goals try (apply ap_lam; exact ih)
    all_goals try (cases result <;> cek_v3)

/-- Any raw branch list leads to error if its continuation does. -/
theorem mix_arbitrary_branch_list_errors (continuation : CekValue)
    (c39 c29 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 : CekValue)
    (iteratorRest predRest loopRest : Environment) (c43 c42 outerRec : CekValue)
    (outerHead : Data) (outerTail : List Data) (originalList : CekValue) (hOuter : Ap default outerRec (.VCon (.ConstDataList outerTail)) none) (branches : List Data) :
    Ev default loopBody
      (.VCon (.ConstDataList branches) ::
        .VLam loopLoop (.VLam innerPredLoop (c43 :: c42 :: outerRec ::
          .VCon (.ConstDataList (outerHead :: outerTail)) ::
          predEnv continuation iteratorRest c39 c29 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 predRest) :: originalList :: loopRest) ::
        .VLam innerPredLoop (c43 :: c42 :: outerRec :: .VCon (.ConstDataList (outerHead :: outerTail)) ::
          predEnv continuation iteratorRest c39 c29 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 predRest) :: originalList :: loopRest)
      none := by
  induction branches with
  | nil => cek_v3_using [hOuter]
  | cons branch branches ih =>
    cases branch with
    | B b => cek_v3_using [ih, hOuter]
    | I i => cek_v3_using [ih, hOuter]
    | List l => cek_v3_using [ih, hOuter]
    | Map m => cek_v3_using [ih, hOuter]
    | Constr tag fields =>
      by_cases h : tag = 0
      · subst tag
        cases fields with
        | nil => cek_v3_using [ih, hOuter]
        | cons a fsa =>
          cases fsa with
          | nil => cek_v3_using [ih, hOuter]
          | cons b fsb =>
            cases fsb with
            | nil => cek_v3_using [ih, hOuter]
            | cons c fsc =>
              cases fsc with
              | nil => cek_v3_using [ih, hOuter]
              | cons d tail =>
                cases d with
                | B byte_d =>
                  cases a with
                  | B byte_a =>
                    cases b with
                    | B byte_b =>
                      cases c with
                      | B byte_c =>
                        cases tail <;> cek_v3_using [ih, hOuter]
                      | I int_c =>
                        cek_v3_using [ih, hOuter]
                      | List lst_c =>
                        cek_v3_using [ih, hOuter]
                      | Map mp_c =>
                        cek_v3_using [ih, hOuter]
                      | Constr tag_c fs_c =>
                        cek_v3_using [ih, hOuter]
                    | I int_b =>
                      cek_v3_using [ih, hOuter]
                    | List lst_b =>
                      cek_v3_using [ih, hOuter]
                    | Map mp_b =>
                      cek_v3_using [ih, hOuter]
                    | Constr tag_b fs_b =>
                      cek_v3_using [ih, hOuter]
                  | I int_a =>
                    cek_v3_using [ih, hOuter]
                  | List lst_a =>
                    cek_v3_using [ih, hOuter]
                  | Map mp_a =>
                    cek_v3_using [ih, hOuter]
                  | Constr tag_a fs_a =>
                    cek_v3_using [ih, hOuter]
                | I int_d =>
                  cek_v3_using [ih, hOuter]
                | List lst_d =>
                  cek_v3_using [ih, hOuter]
                | Map mp_d =>
                  cek_v3_using [ih, hOuter]
                | Constr tag_d fs_d =>
                  cek_v3_using [ih, hOuter]
      · have he : PlutusCore.Integer.equalsInteger 0 tag = false := by
          simp [PlutusCore.Integer.equalsInteger, Ne.symm h]
        cek_v3_using [ih, hOuter]
        all_goals try rw [he]
        cek_v3_using [ih, hOuter]

/-- Every raw Mix proof list errors if the validator continuation errors. -/
theorem mix_arbitrary_proof_list_errors (continuation : CekValue)
    (c31 c29 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 : CekValue)
    (iteratorRest predRest loopRest : Environment) (originalList : CekValue) (hContinuation : Fo default continuation none) (proofs : List Data) :
    Ev default loopBody
      (.VCon (.ConstDataList proofs) ::
        .VLam loopLoop (.VLam predLoop (predEnv continuation iteratorRest c31 c29 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 predRest) :: originalList :: loopRest) ::
        .VLam predLoop (predEnv continuation iteratorRest c31 c29 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 predRest) :: originalList :: loopRest)
      none := by
  induction proofs with
  | nil => cek_v3_using [hContinuation]
  | cons proof proofs ih =>
    cases proof with
    | B b => cek_v3_using [ih, hContinuation]
    | I i => cek_v3_using [ih, hContinuation]
    | List l => cek_v3_using [ih, hContinuation]
    | Map m => cek_v3_using [ih, hContinuation]
    | Constr tag fields =>
      by_cases h : tag = 0
      · subst tag
        cases fields with
        | nil => cek_v3_using [ih, hContinuation]
        | cons field tail =>
          cases tail with
          | cons extra rest => cek_v3_using [ih, hContinuation]
          | nil =>
            cases field with
            | B b => cek_v3_using [ih, hContinuation]
            | I i => cek_v3_using [ih, hContinuation]
            | Map m => cek_v3_using [ih, hContinuation]
            | Constr k fs => cek_v3_using [ih, hContinuation]
            | List branches =>
              cek_v3_using [mix_arbitrary_branch_list_errors, ih, hContinuation]
              all_goals try (apply ap_lam; exact ih)
              all_goals try cek_v3
      · have he : PlutusCore.Integer.equalsInteger 0 tag = false := by
          simp [PlutusCore.Integer.equalsInteger, Ne.symm h]
        cek_v3_using [ih, hContinuation]
        all_goals try rw [he]
        cek_v3_using [ih, hContinuation]


/-- Any raw Mix proof prefix preserves a suffix that reaches an error. -/
theorem mix_arbitrary_prefix_errors (continuation : CekValue)
    (c31 c29 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 : CekValue)
    (iteratorRest predRest loopRest : Environment) (originalList : CekValue) (proofs suffix : List Data)
    (hSuffix : Ev default loopBody
      (.VCon (.ConstDataList suffix) ::
        .VLam loopLoop (.VLam predLoop (predEnv continuation iteratorRest c31 c29 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 predRest) :: originalList :: loopRest) ::
        .VLam predLoop (predEnv continuation iteratorRest c31 c29 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 predRest) :: originalList :: loopRest) none) :
    Ev default loopBody
      (.VCon (.ConstDataList (proofs ++ suffix)) ::
        .VLam loopLoop (.VLam predLoop (predEnv continuation iteratorRest c31 c29 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 predRest) :: originalList :: loopRest) ::
        .VLam predLoop (predEnv continuation iteratorRest c31 c29 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 predRest) :: originalList :: loopRest)
      none := by
  induction proofs with
  | nil => simpa using hSuffix
  | cons proof proofs ih =>
    simp only [List.cons_append]
    cases proof with
    | B b => cek_v3_using [ih]
    | I i => cek_v3_using [ih]
    | List l => cek_v3_using [ih]
    | Map m => cek_v3_using [ih]
    | Constr tag fields =>
      by_cases h : tag = 0
      · subst tag
        cases fields with
        | nil => cek_v3_using [ih]
        | cons field tail =>
          cases tail with
          | cons extra rest => cek_v3_using [ih]
          | nil =>
            cases field with
            | B b => cek_v3_using [ih]
            | I i => cek_v3_using [ih]
            | Map m => cek_v3_using [ih]
            | Constr k fs => cek_v3_using [ih]
            | List branches =>
              cek_v3_using [mix_arbitrary_branch_list_errors, ih]
              all_goals try (apply ap_lam; exact ih)
              all_goals try cek_v3
      · have he : PlutusCore.Integer.equalsInteger 0 tag = false := by
          simp [PlutusCore.Integer.equalsInteger, Ne.symm h]
        cek_v3_using [ih]
        all_goals try rw [he]
        cek_v3_using [ih]

end Lovejoin.AnyTx.LogicMixParse

#print axioms Lovejoin.AnyTx.LogicMixParse.mix_empty_branches_validate

#print axioms Lovejoin.AnyTx.LogicMixParse.mix_branch_list_validates

#print axioms Lovejoin.AnyTx.LogicMixParse.mix_full_proof_list_validates

#print axioms Lovejoin.AnyTx.LogicMixParse.mix_valid_prefix

#print axioms Lovejoin.AnyTx.LogicMixParse.mix_branch_valid_prefix

#print axioms Lovejoin.AnyTx.LogicMixParse.mix_arbitrary_branch_list_errors

#print axioms Lovejoin.AnyTx.LogicMixParse.mix_arbitrary_proof_list_errors
