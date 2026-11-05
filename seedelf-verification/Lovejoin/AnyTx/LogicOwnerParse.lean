import Lovejoin.AnyTx.LogicReferenceFilter
import Lovejoin.AnyTx.Common

/-! The compiled Owner redeemer's proof-list validation loop. -/
namespace Lovejoin.AnyTx.LogicOwnerParse
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
def predAt : List Nat := [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,1,0,0,0,0,0,1,0,1]
def predLoop : Term := subterm templateBody (predAt ++ [0])

def predEnv (continuation : CekValue) (c31 c29 c28 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 : CekValue) (rest : Environment) : Environment :=
  c31 :: continuation :: c29 :: c28 :: c27 :: c26 :: c20 :: c19 ::
  .VBuiltin .EqualsInteger [.VCon (.Integer 0)] (.One .ArgV) :: c17 :: c16 :: c15 :: c14 :: c13 :: c12 :: c11 ::
  .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
  .VBuiltin .FstPair [] (.One .ArgV) :: .VBuiltin .SndPair [] (.One .ArgV) ::
  .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) :: c6 ::
  .VBuiltin .HeadList [] (.One .ArgV) :: .VBuiltin .TailList [] (.One .ArgV) :: rest

def proofList (xs : List (ByteString × ByteString)) : List Data :=
  xs.map fun p => proofData p.1 p.2

set_option maxHeartbeats 0

theorem owner_proof_list_validates (continuation : CekValue) (c31 c29 c28 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 : CekValue)
    (predRest loopRest : Environment) (originalList : CekValue) (result : Option CekValue)
    (hContinuation : Fo default continuation result) (xs : List (ByteString × ByteString)) :
    Ev default loopBody
      (.VCon (.ConstDataList (proofList xs)) ::
        .VLam loopLoop (.VLam predLoop (predEnv continuation c31 c29 c28 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 predRest) :: originalList :: loopRest) ::
        .VLam predLoop (predEnv continuation c31 c29 c28 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 predRest) :: originalList :: loopRest)
      result := by
  induction xs with
  | nil =>
    simp only [proofList, List.map_nil]
    cek_v3_using [hContinuation]
  | cons x xs ih =>
    rcases x with ⟨t, z⟩
    simp only [proofList, List.map_cons]
    cek_v3_using [ih, hContinuation]

/-- A validated prefix leaves the suffix and its eventual result unchanged. -/
theorem owner_valid_prefix (continuation : CekValue) (c31 c29 c28 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 : CekValue)
    (predRest loopRest : Environment) (originalList : CekValue) (result : Option CekValue)
    (suffix : List Data) (xs : List (ByteString × ByteString))
    (hSuffix : Ev default loopBody
      (.VCon (.ConstDataList suffix) ::
        .VLam loopLoop (.VLam predLoop (predEnv continuation c31 c29 c28 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 predRest) :: originalList :: loopRest) ::
        .VLam predLoop (predEnv continuation c31 c29 c28 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 predRest) :: originalList :: loopRest) result) :
    Ev default loopBody
      (.VCon (.ConstDataList (proofList xs ++ suffix)) ::
        .VLam loopLoop (.VLam predLoop (predEnv continuation c31 c29 c28 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 predRest) :: originalList :: loopRest) ::
        .VLam predLoop (predEnv continuation c31 c29 c28 c27 c26 c20 c19 c17 c16 c15 c14 c13 c12 c11 c6 predRest) :: originalList :: loopRest)
      result := by
  induction xs with
  | nil =>
    simpa [proofList] using hSuffix
  | cons x xs ih =>
    rcases x with ⟨t, z⟩
    simp only [proofList, List.map_cons, List.cons_append]
    cek_v3_using [ih]

end Lovejoin.AnyTx.LogicOwnerParse

#print axioms Lovejoin.AnyTx.LogicOwnerParse.owner_proof_list_validates

#print axioms Lovejoin.AnyTx.LogicOwnerParse.owner_valid_prefix
