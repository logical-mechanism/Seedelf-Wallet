import Seedelf.PolicyAnyTx
import Seedelf.LinesAllCek

/-! # The policy's flatten, for every mint

The policy (84967d91…) flattens the mint with Aiken's `assets.flatten`: a self-applied loop over
the outer map's policies (`i_41`/`i_42` in the decoded bytes), which decodes each policy and its
inner map, flattens the rest of the mint first, and then runs a second self-applied loop over the
policy's names (`i_48`/`i_49`), consing `listData [bData policy, name, amount]` for each onto the
flattened rest. Both loops are proved here for every list, by induction, with the machine's
stack free (LinesAllCek): the inner loop for any names and amounts, the outer loop and the
flatten closure for any mint the ledger encodes (`pairsOf lines`; LinesAllAnyMint has them for
any pairs at all). The loops' bodies are named by their paths in the program, so each statement
is about the deployed bytes' own subterms. Kernel-checked, no Blaster. -/

namespace Seedelf.V1.LinesAll
open Seedelf.V1
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term Const BuiltinFun Program)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open PlutusCore.UPLC.Builtins (ExpectedBuiltinArg ExpectedBuiltinArgs)

/-! ## The loops' subterms -/

/-- The subterm at `p`: a step `0` goes into a lambda's, delay's or force's body and to an
application's function, any other step to an application's argument. -/
def subterm (t : Term) (p : List Nat) : Term :=
  match p, t with
  | [], t => t
  | _ :: p, .Lam b => subterm b p
  | _ :: p, .Delay b => subterm b p
  | _ :: p, .Force b => subterm b p
  | 0 :: p, .Apply f _ => subterm f p
  | _ :: p, .Apply _ a => subterm a p
  | _ :: _, t => t
termination_by structural p

/-- The policy's body, under its parameter and builtins. -/
def policyBody : Term := match seedelf.script with | .Program _ b => b

/-- Where the flatten function `(lam i_39 …)` sits in the decoded bytes. -/
def flattenAt : List Nat :=
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    0, 0, 0, 0, 0, 1]

/-- The flatten function's body: `[(lam i_40 [[i_40 i_40] i_39]) (lam i_41 (lam i_42 …))]`. -/
def flattenBody : Term := subterm policyBody (flattenAt ++ [0])

/-- The outer loop, `(lam i_42 …)`, a step over the mint's policies. -/
def outerLoop : Term := subterm policyBody (flattenAt ++ [0, 1, 0])

/-- Its body. -/
def outerBody : Term := subterm policyBody (flattenAt ++ [0, 1, 0, 0])

/-- The inner loop, `(lam i_49 …)`, a step over one policy's names. -/
def innerLoop : Term :=
  subterm policyBody (flattenAt ++ [0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0])

/-- Its body. -/
def innerBody : Term :=
  subterm policyBody (flattenAt ++ [0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0])

theorem outerLoop_eq : outerLoop = .Lam outerBody := rfl

theorem innerLoop_eq : innerLoop = .Lam innerBody := rfl

/-! ## The environments they run in -/

/-- The seven builtins the policy binds first, forced, as its environment holds them: `i_6`
(ifThenElse) down to `i_0` (tailList). -/
def builtinsEnv (rest : Environment) : Environment :=
  .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
  .VBuiltin .FstPair [] (.One .ArgV) ::
  .VBuiltin .SndPair [] (.One .ArgV) ::
  .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) ::
  .VBuiltin .MkCons [] (.More .ArgV (.One .ArgV)) ::
  .VBuiltin .HeadList [] (.One .ArgV) ::
  .VBuiltin .TailList [] (.One .ArgV) :: rest

/-- The outer loop's closure environment: `i_39`, the nine values `i_15` down to `i_7`, which the
loop never reads, and the builtins. -/
def outerEnv (a0 a1 a2 a3 a4 a5 a6 a7 a8 a9 : CekValue) (rest : Environment) : Environment :=
  a0 :: a1 :: a2 :: a3 :: a4 :: a5 :: a6 :: a7 :: a8 :: a9 :: builtinsEnv rest

/-- The inner loop's closure environment: the lines flattened so far (`i_46`), `i_45`, the
policy (`i_44`), thirteen values the loop never reads, and the builtins. -/
def innerEnv (acc : List Data) (pid : ByteString)
    (c1 c3 c4 c5 c6 c7 c8 c9 c10 c11 c12 c13 c14 c15 : CekValue) (rest : Environment) :
    Environment :=
  .VCon (.ConstDataList acc) :: c1 :: .VCon (.ByteString pid) :: c3 :: c4 :: c5 :: c6 :: c7 ::
    c8 :: c9 :: c10 :: c11 :: c12 :: c13 :: c14 :: c15 :: builtinsEnv rest

/-! ## What they compute -/

/-- The line the inner loop makes of a name and amount `t` under the policy `pid`. -/
def lineOf (pid : ByteString) (t : Data × Data) : Data := .List [.B pid, t.1, t.2]

/-- A mint's pairs, as the ledger encodes them (`mintOf`'s map). -/
def pairsOf (lines : List (ByteString × List (ByteString × Integer))) : List (Data × Data) :=
  lines.map fun l => (.B l.1, .Map (l.2.map fun t => (.B t.1, .I t.2)))

theorem mintOf_eq (lines : List (ByteString × List (ByteString × Integer))) :
    mintOf lines = .Map (pairsOf lines) := rfl

/-- The mint flattened: every policy's names in order, a line each. -/
def flatLines : List (ByteString × List (ByteString × Integer)) → List Data
  | [] => []
  | l :: ls => (l.2.map fun t => ((Data.B t.1 : Data), (Data.I t.2 : Data))).map (lineOf l.1) ++
      flatLines ls

/-! ## The loops, for every list -/

set_option maxHeartbeats 0

/-- The inner loop conses a line for each of `toks` onto `acc`, whatever `toks` is. -/
theorem inner_loop (pid : ByteString) (acc : List Data)
    (c1 c3 c4 c5 c6 c7 c8 c9 c10 c11 c12 c13 c14 c15 : CekValue) (rest : Environment)
    (toks : List (Data × Data)) :
    Ev default innerBody
      (.VCon (.ConstPairDataList toks) ::
        .VLam innerLoop (innerEnv acc pid c1 c3 c4 c5 c6 c7 c8 c9 c10 c11 c12 c13 c14 c15 rest) ::
        innerEnv acc pid c1 c3 c4 c5 c6 c7 c8 c9 c10 c11 c12 c13 c14 c15 rest)
      (some (.VCon (.ConstDataList (toks.map (lineOf pid) ++ acc)))) := by
  induction toks with
  | nil => cek
  | cons t ts ih => cek_using [ih]

/-- The outer loop flattens any mint. -/
theorem outer_loop (a0 a1 a2 a3 a4 a5 a6 a7 a8 a9 : CekValue) (rest : Environment)
    (lines : List (ByteString × List (ByteString × Integer))) :
    Ev default outerBody
      (.VCon (.ConstPairDataList (pairsOf lines)) ::
        .VLam outerLoop (outerEnv a0 a1 a2 a3 a4 a5 a6 a7 a8 a9 rest) ::
        outerEnv a0 a1 a2 a3 a4 a5 a6 a7 a8 a9 rest)
      (some (.VCon (.ConstDataList (flatLines lines)))) := by
  induction lines with
  | nil => cek
  | cons l ls ih => cek_using [ih, inner_loop]

/-- The flatten closure, applied to any mint, returns it flattened. -/
theorem flatten_apply (a1 a2 a3 a4 a5 a6 a7 a8 a9 : CekValue) (rest : Environment)
    (lines : List (ByteString × List (ByteString × Integer))) :
    Ap default (.VLam flattenBody (a1 :: a2 :: a3 :: a4 :: a5 :: a6 :: a7 :: a8 :: a9 ::
        builtinsEnv rest))
      (.VCon (.ConstPairDataList (pairsOf lines)))
      (some (.VCon (.ConstDataList (flatLines lines)))) := by
  apply ap_lam
  cek_using [outer_loop]

end Seedelf.V1.LinesAll

#print axioms Seedelf.V1.LinesAll.flatten_apply
