import Lovejoin.AnyTx.BoxCover

/-! The one-shot mint policy's compiled search for its seed input. -/
namespace Lovejoin.AnyTx.LaunchSeedSearch
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term Program)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open CardanoLedgerApi.IsData.Class (IsData)
open CardanoLedgerApi.V3
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.BoxSearch (subterm inputData inputList)

def templateBody : Term := match oneShotMintTemplate.script with | .Program _ b => b
def searchAt : List Nat :=
  [0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,1]
def searchLoop : Term := subterm templateBody (searchAt ++ [0])
def searchBody : Term := subterm templateBody (searchAt ++ [0,0])

theorem self_shape : subterm templateBody searchAt = .Lam searchLoop := rfl
theorem loop_shape : searchLoop = .Lam searchBody := rfl

def searchEnv (before : Fin 28 → CekValue) (seed : Data) (middle : Fin 10 → CekValue)
    (c9 c6 : CekValue) (rest : Environment) : Environment :=
  List.ofFn before ++ .VCon (.Data seed) :: List.ofFn middle ++
  .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) :: c9 ::
  .VBuiltin .SndPair [] (.One .ArgV) ::
  .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) :: c6 ::
  .VBuiltin .HeadList [] (.One .ArgV) :: .VBuiltin .TailList [] (.One .ArgV) :: rest

def containsSeed (seed : Data) (xs : List (Data × Data)) : Bool :=
  xs.any fun pair => decide (pair.1 = seed)

set_option maxHeartbeats 0

/-- For any list of well-encoded inputs, the compiled seed search returns
whether an input reference equals the policy's seed. -/
theorem search_all (seed : Data) (before : Fin 28 → CekValue) (middle : Fin 10 → CekValue)
    (c9 c6 : CekValue) (rest : Environment) (xs : List (Data × Data)) :
    let env := searchEnv before seed middle c9 c6 rest
    Ev default searchBody
      (.VCon (.ConstDataList (inputList xs)) :: .VLam searchLoop env :: env)
      (some (.VCon (.Bool (containsSeed seed xs)))) := by
  induction xs with
  | nil =>
    simp only [inputList, List.map_nil, containsSeed, List.any_nil]
    cek_v3
  | cons pair xs ih =>
    rcases pair with ⟨ref, out⟩
    by_cases h : ref = seed
    · subst ref
      have he : PlutusCore.Data.equalsData seed seed = true := by simp [PlutusCore.Data.equalsData]
      simp only [inputList, List.map_cons, containsSeed, List.any_cons, decide_true, Bool.true_or]
      cek_v3
      all_goals try rw [he]
      cek_v3
    · have he : PlutusCore.Data.equalsData ref seed = false := by simp [PlutusCore.Data.equalsData, h]
      simp only [inputList, List.map_cons, containsSeed, List.any_cons, h, decide_false, Bool.false_or]
      cek_v3_using [ih]
      all_goals try rw [he]
      cek_v3_using [ih]

/-- Encoded output references preserve and reflect equality. -/
theorem reference_encoding_injective (a b : TxOutRef) :
    IsData.toData a = IsData.toData b ↔ a = b := by
  cases a with
  | mk aid aidx =>
    cases b with
    | mk bid bidx =>
      change Data.Constr 0 [.B aid, .I aidx] = Data.Constr 0 [.B bid, .I bidx] ↔ _
      simp

/-- The search result has the ledger meaning: the seed is a spent input. -/
theorem contains_seed_iff (seed : TxOutRef) (inputs : List TxInInfo) :
    containsSeed (IsData.toData seed) (Lovejoin.AnyTx.BoxCover.inputPairs inputs) = true ↔
      ∃ input ∈ inputs, input.txInInfoOutRef = seed := by
  simp [containsSeed, Lovejoin.AnyTx.BoxCover.inputPairs, reference_encoding_injective]

/-- The compiled search on any typed V3 input list returns the ledger seed
membership test, including arbitrary nonmatching inputs before and after it. -/
theorem search_ledger (seed : TxOutRef) (before : Fin 28 → CekValue) (middle : Fin 10 → CekValue)
    (c9 c6 : CekValue) (rest : Environment) (inputs : List TxInInfo) :
    let env := searchEnv before (IsData.toData seed) middle c9 c6 rest
    Ev default searchBody
      (.VCon (.ConstDataList (inputList (Lovejoin.AnyTx.BoxCover.inputPairs inputs))) :: .VLam searchLoop env :: env)
      (some (.VCon (.Bool (inputs.any fun input => decide (input.txInInfoOutRef = seed))))) := by
  have hEq : containsSeed (IsData.toData seed) (Lovejoin.AnyTx.BoxCover.inputPairs inputs) =
      (inputs.any fun input => decide (input.txInInfoOutRef = seed)) := by
    apply Bool.eq_iff_iff.mpr
    rw [contains_seed_iff]
    simp
  simpa [hEq] using search_all (IsData.toData seed) before middle c9 c6 rest
    (Lovejoin.AnyTx.BoxCover.inputPairs inputs)

end Lovejoin.AnyTx.LaunchSeedSearch

/-- info: 'Lovejoin.AnyTx.LaunchSeedSearch.search_all' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LaunchSeedSearch.search_all
/-- info: 'Lovejoin.AnyTx.LaunchSeedSearch.search_ledger' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LaunchSeedSearch.search_ledger
