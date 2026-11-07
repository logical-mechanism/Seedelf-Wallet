import Lovejoin.Every.Main

/-! # The Mix's fold

`list.foldl` as the compiled code builds it (i_131), and the three steps the Mix folds with:
the statements' and the branches' bytes (each `acc ‖ f0 ‖ f1`), and the branches' challenges,
each 32 bytes and xor'd into a 32-byte accumulator (xor32's fix). Every list any length. -/

namespace Lovejoin.Every
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString appendByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term Const)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open PlutusCore.UPLC.BuiltinFunctions.Bitwise (xorByteStringOpaque)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase

/-- The Mix branch of the main body, a redeemer of tag other than 0. -/
def mixAt : List Nat :=
  [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,0,0,
   0,0,0,0,0,0,1,0,0,0,0,0,2,0]

/-! ### Where the Mix runs

The branch binds five lets at once (i_128 to i_132), all in the main body's environment, then
i_133. -/

/-- i_129, `λ name qty. [(B name, I qty)]`, under its first lambda. -/
def pairFn : Term := sub (mixAt ++ [0,1,0])
/-- i_130, `λ l. l[3]`'s body. -/
def nth3Fn : Term := sub (mixAt ++ [0,2,0])
/-- i_131, `λ list init f. …`, under its first lambda. -/
def foldFn : Term := sub (mixAt ++ [0,3,0])
/-- i_133, `output_at_script(out, msh)`, under its first lambda. -/
def atFn : Term := sub (mixAt ++ [1,0,0,0,0,0,1,0])

/-- The branch's first lets over the main body's environment `ρ`: the box count `n` (i_132),
the fold, `nth3`, the pair builder, and the proofs `ps` (i_128). -/
abbrev envL (ps : List Data) (n : Integer) (ρ : Environment) : Environment :=
  .VCon (.Integer n) :: .VLam foldFn ρ :: .VLam nth3Fn ρ :: .VLam pairFn ρ :: .VCon (.ConstDataList ps) :: ρ

/-- `envL` and i_133. -/
abbrev envA (ps : List Data) (n : Integer) (ρ : Environment) : Environment :=
  .VLam atFn (envL ps n ρ) :: envL ps n ρ

/-- The reference datum as `referenceDatum` returns it: its first six fields typed as the Mix
reads them (the box's ADA, the token's policy, name and quantity, and the mix_box hash). -/
abbrev refD (t bl : Integer) (pol nm : ByteString) (tq : Integer) (f4 : Data) (msh : ByteString)
    (rest : List Data) : Data :=
  .Constr t (.I bl :: .B pol :: .B nm :: .I tq :: f4 :: .B msh :: rest)

/-- The builders' values, as the builtins build them, for rewriting a result the machine left
unreduced. -/
theorem mkCons_eq {α : Type} (x : α) (xs : List α) : PlutusCore.List.mkCons x xs = x :: xs := rfl
theorem mkPairData_eq (a b : Data) : PlutusCore.Data.mkPairData a b = (a, b) := rfl
theorem bData_eq (b : ByteString) : PlutusCore.Data.bData b = .B b := rfl
theorem iData_eq (i : Integer) : PlutusCore.Data.iData i = .I i := rfl
theorem mapData_eq (xs : List (Data × Data)) : PlutusCore.Data.mapData xs = .Map xs := rfl

/-- `foldl(list, init, f)` (i_131) builds the loop i_124, `λ self l acc`, which calls
`f(head, acc)` before it recurses. -/
def foldEntry : Term := sub (mixAt ++ [0,3,0,0,0])
def foldLoop : Term := sub (mixAt ++ [0,3,0,0,0,1,0])
def foldBody : Term := sub (mixAt ++ [0,3,0,0,0,1,0,0,0])

theorem foldLoop_shape : foldLoop = .Lam (.Lam foldBody) := rfl

/-- The fold, where an error in `f` is the script's. -/
def foldOpt (f : Data → ByteString → Option ByteString) : List Data → ByteString → Option ByteString
  | [], acc => some acc
  | x :: xs, acc =>
    match f x acc with
    | some acc' => foldOpt f xs acc'
    | none => none

set_option maxHeartbeats 0

/-- The loop, for any list and a step `λ x acc. …` given by what it returns. -/
theorem fold_loop (σ σf : Environment) (fBody : Term) (f : Data → ByteString → Option ByteString)
    (hF : List.get?Internal σ 0 = some (.VLam (.Lam fBody) σf))
    (hf : ∀ (x : Data) (acc : ByteString), Ev default fBody (.VCon (.ByteString acc) :: .VCon (.Data x) :: σf)
      ((f x acc).map fun b => .VCon (.ByteString b)))
    (hCL : List.get?Internal σ 33 = some vChooseList)
    (hHead : List.get?Internal σ 35 = some vHead) (hTail : List.get?Internal σ 36 = some vTail)
    (l : List Data) (acc : ByteString) :
    Ev default foldBody (.VCon (.ByteString acc) :: .VCon (.ConstDataList l) :: .VLam foldLoop σ :: σ)
      ((foldOpt f l acc).map fun b => .VCon (.ByteString b)) := by
  induction l generalizing acc with
  | nil => ev_go [] []
  | cons x xs ih =>
    cases hx : f x acc with
    | none =>
      simp only [foldOpt, hx, Option.map_none]
      ev_go [hf] [hx, Option.map_none]
    | some acc' =>
      simp only [foldOpt, hx]
      ev_go [hf, ih, values_nil_any] [hx, Option.map_some]

/-- i_131 applied: its body, with the list, the start and the step in place. -/
theorem fold_apply (ρ σf : Environment) (fBody : Term) (f : Data → ByteString → Option ByteString)
    (hf : ∀ (x : Data) (acc : ByteString), Ev default fBody (.VCon (.ByteString acc) :: .VCon (.Data x) :: σf)
      ((f x acc).map fun b => .VCon (.ByteString b)))
    (hCL : List.get?Internal ρ 30 = some vChooseList)
    (hHead : List.get?Internal ρ 32 = some vHead) (hTail : List.get?Internal ρ 33 = some vTail)
    (l : List Data) (init : ByteString) :
    Ev default foldEntry
      (.VLam (.Lam fBody) σf :: .VCon (.ByteString init) :: .VCon (.ConstDataList l) :: ρ)
      ((foldOpt f l init).map fun b => .VCon (.ByteString b)) := by
  ev_go [fold_loop, hf, values_nil_any] []

/-! ### The steps -/

/-- The Mix predicate's body under `λ i_142 i_143`, the box's two points. -/
def predAt : List Nat :=
  mixAt ++ [1,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,2,0,0,0,0,0,0]

/-- `λ x acc. acc ‖ unB(x.f0) ‖ unB(x.f1)`'s body, the statements' step (f1). -/
def catBody : Term := sub (predAt ++ [0,0,2,0,0,0,0,0,1,1,0,1,0,1,0,2,0,0])
/-- The branches' step (f2), the same term. -/
def catBody' : Term := sub (predAt ++ [0,0,2,0,0,0,0,0,1,1,0,1,0,2,0,0])
/-- `λ br acc. …`'s body, the challenges' step (fx). -/
def xorBody : Term := sub (predAt ++ [0,0,2,0,0,0,0,1,0,2,0,0])

theorem catBody'_eq : catBody' = catBody := rfl

/-- `acc ‖ unB(x.f0) ‖ unB(x.f1)`, in the compiled order. -/
def catStep (x : Data) (acc : ByteString) : Option ByteString :=
  match x with
  | .Constr _ (f0 :: fs) =>
    match f0 with
    | .B a =>
      match fs with
      | .B b :: _ => some (appendByteString (appendByteString acc a) b)
      | _ => none
    | _ => none
  | _ => none

/-- The challenge `c = unB(br.f2)`, then both 32 bytes, then `acc xor c`. -/
def xorStep (br : Data) (acc : ByteString) : Option ByteString :=
  match br with
  | .Constr _ fs =>
    match (fs[2]? : Option Data) with
    | some (.B c) =>
      if PlutusCore.Integer.equalsInteger 32 (PlutusCore.ByteString.lengthOfByteString acc) then
        if PlutusCore.Integer.equalsInteger 32 (PlutusCore.ByteString.lengthOfByteString c) then
          some ⟨xorByteStringOpaque false acc.data c.data⟩
        else none
      else none
    | _ => none
  | _ => none

theorem cat_ev (σ : Environment) (v73 : CekValue)
    (h73 : List.get?Internal σ 27 = some v73)
    (hv73 : ∀ l : List Data, Ap default v73 (.VCon (.ConstDataList l)) (l[1]?.map fun d => .VCon (.Data d)))
    (hSnd : List.get?Internal σ 45 = some vSnd) (hHead : List.get?Internal σ 48 = some vHead)
    (x : Data) (acc : ByteString) :
    Ev default catBody (.VCon (.ByteString acc) :: .VCon (.Data x) :: σ)
      ((catStep x acc).map fun b => .VCon (.ByteString b)) := by
  rcases x with ⟨t, fs⟩ | _ | _ | _ | _
  all_goals try (ev_go [hv73] []; done)
  rcases fs with _ | ⟨f0, fs⟩
  all_goals try (ev_go [hv73] []; done)
  rcases f0 with _ | _ | _ | _ | a
  all_goals try (ev_go [hv73] []; done)
  rcases fs with _ | ⟨f1, fs⟩
  all_goals try (ev_go [hv73] []; done)
  rcases f1 with _ | _ | _ | _ | b
  all_goals ev_go [hv73] []

theorem xor_ev (σ : Environment) (v72 : CekValue)
    (h79 : List.get?Internal σ 21 = some (vEq 32))
    (h72 : List.get?Internal σ 28 = some v72)
    (hv72 : ∀ l : List Data, Ap default v72 (.VCon (.ConstDataList l)) (l[2]?.map fun d => .VCon (.Data d)))
    (hIte : List.get?Internal σ 43 = some vIte) (hSnd : List.get?Internal σ 45 = some vSnd)
    (br : Data) (acc : ByteString) :
    Ev default xorBody (.VCon (.ByteString acc) :: .VCon (.Data br) :: σ)
      ((xorStep br acc).map fun b => .VCon (.ByteString b)) := by
  rcases br with ⟨t, _ | ⟨f0, _ | ⟨f1, _ | ⟨c, fs⟩⟩⟩⟩ | _ | _ | _ | _
  all_goals try (ev_go [hv72] []; done)
  rcases c with _ | _ | _ | _ | c
  all_goals try (ev_go [hv72] []; done)
  simp only [xorStep, List.getElem?_cons_succ, List.getElem?_cons_zero]
  cases ha : PlutusCore.Integer.equalsInteger 32 (PlutusCore.ByteString.lengthOfByteString acc)
  · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_none]; ev_go [hv72] [ha]
  cases hc : PlutusCore.Integer.equalsInteger 32 (PlutusCore.ByteString.lengthOfByteString c)
  · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_none]; ev_go [hv72] [ha, hc]
  simp only [↓reduceIte, Option.map_some]
  ev_go [hv72] [ha, hc]

end Lovejoin.Every
