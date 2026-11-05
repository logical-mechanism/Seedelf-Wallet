import Lovejoin.AnyTx.BoxSearch

/-! The list-length loop in the compiled mix_logic template. It is used by the
withdrawal handler to count lists; the statement applies to arbitrary Data lists
and is about a subterm of the imported script, not a source-level reimplementation. -/
namespace Lovejoin.AnyTx.LogicLength
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term Program)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.BoxSearch (subterm)

def templateBody : Term := match mixLogicTemplate.script with | .Program _ b => b

def lengthAt : List Nat := [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,0,5]
def lengthSelf : Term := subterm templateBody lengthAt
def lengthLoop : Term := subterm templateBody (lengthAt ++ [0])
def lengthBody : Term := subterm templateBody (lengthAt ++ [0,0])

theorem self_shape : lengthSelf = .Lam lengthLoop := rfl
theorem loop_shape : lengthLoop = .Lam lengthBody := rfl

/-- Arbitrary unused closure slots, with the two builtins the loop reads. -/
def lengthEnv (c0 c1 c2 c3 c4 c5 c6 c7 c8 c9 c10 c11 c12 c13 c14 c15 c16 c17 c18 : CekValue) (rest : Environment) : Environment :=
  c16 :: c15 :: c14 :: c13 :: c12 :: c11 :: c10 :: c9 :: c8 :: c7 :: c6 :: c5 :: c4 :: c3 :: c2 :: c1 :: c0 ::
  .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
  c18 :: c17 :: .VBuiltin .TailList [] (.One .ArgV) :: rest

set_option maxHeartbeats 0

/-- The compiled length loop counts any number of data elements. -/
theorem length_all (c0 c1 c2 c3 c4 c5 c6 c7 c8 c9 c10 c11 c12 c13 c14 c15 c16 c17 c18 : CekValue) (rest : Environment) (xs : List Data) :
    Ev default lengthBody
      (.VCon (.ConstDataList xs) :: .VLam lengthLoop (lengthEnv c0 c1 c2 c3 c4 c5 c6 c7 c8 c9 c10 c11 c12 c13 c14 c15 c16 c17 c18 rest) ::
        lengthEnv c0 c1 c2 c3 c4 c5 c6 c7 c8 c9 c10 c11 c12 c13 c14 c15 c16 c17 c18 rest)
      (some (.VCon (.Integer (Int.ofNat xs.length)))) := by
  induction xs with
  | nil => cek_v3
  | cons x xs ih =>
    simp only [List.length_cons]
    cek_v3_using [ih]
    apply ap_builtin
    change (some (CekValue.VCon (.Integer (1 + Int.ofNat xs.length))) : Option CekValue) = _
    congr 3
    simp [Int.add_comm]

end Lovejoin.AnyTx.LogicLength

/-- info: 'Lovejoin.AnyTx.LogicLength.length_all' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicLength.length_all
