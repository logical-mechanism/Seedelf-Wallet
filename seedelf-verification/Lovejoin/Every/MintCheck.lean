import Lovejoin.Every.MintConds

/-! # one_shot_mint's check, once the output to the reference holder is found -/

namespace Lovejoin.Every
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term Const)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.Template.AnyTx (purposeCtx)


set_option maxHeartbeats 0

theorem launch_check (ρ : Environment) (seed : Data) (nm : ByteString) (v info : Data)
    (t : Integer) (a vo d rs : Data) (os : List Data) (v31 v38 v39 v40 : CekValue)
    (h43 : List.get?Internal ρ 0 = some (.VCon (.Data (.Constr 0 [.Constr t (a :: vo :: d :: rs :: os)]))))
    (h42 : List.get?Internal ρ 1 = some (.VCon (.ByteString nm)))
    (h41 : List.get?Internal ρ 2 = some (vEq 1))
    (h40 : List.get?Internal ρ 3 = some v40)
    (hv40 : ∀ l : List Data, Ap default v40 (.VCon (.ConstDataList l)) (l[3]?.map fun d => .VCon (.Data d)))
    (h39 : List.get?Internal ρ 4 = some v39)
    (hv39 : ∀ l : List Data, Ap default v39 (.VCon (.ConstDataList l)) (l[1]?.map fun d => .VCon (.Data d)))
    (h38 : List.get?Internal ρ 5 = some v38)
    (hv38 : ∀ l : List Data, Ap default v38 (.VCon (.ConstDataList l)) (l[2]?.map fun d => .VCon (.Data d)))
    (h37 : List.get?Internal ρ 6 = some (.VCon (.PairData (.B nm, v))))
    (h31 : List.get?Internal ρ 9 = some v31)
    (hv31 : ∀ l : List Data, Ap default v31 (.VCon (.ConstDataList l)) (l[4]?.map fun d => .VCon (.Data d)))
    (h30 : List.get?Internal ρ 10 = some (.VCon (.Data seed)))
    (h19 : List.get?Internal ρ 12 = some (.VCon (.Data info)))
    (h18 : List.get?Internal ρ 13 = some (vEq 0))
    (hIte : List.get?Internal ρ 21 = some vIte) (hFst : List.get?Internal ρ 22 = some vFst)
    (hSnd : List.get?Internal ρ 23 = some vSnd) (hCL : List.get?Internal ρ 24 = some vChooseList)
    (hHead : List.get?Internal ρ 26 = some vHead) (hTail : List.get?Internal ρ 27 = some vTail) :
    Ev default checkTerm ρ
      ((launchCheck seed nm v (.Constr t (a :: vo :: d :: rs :: os)) info).map fun b => .VCon (.Bool b)) := by
  rcases d with ⟨dt, dfs⟩ | _ | _ | _ | _
  all_goals try (simp only [launchCheck, outDatum, Option.map_none]; ev_go [hv38] []; done)
  simp only [launchCheck, outDatum]
  cases h2 : PlutusCore.Integer.equalsInteger 2 dt
  · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_none]; ev_go [hv38] [h2]
  try simp only [↓reduceIte]
  rcases dfs with _ | ⟨x, dfs⟩
  · simp only [Option.map_none]; ev_go [hv38] [h2]
  rcases x with ⟨xt, xs⟩ | _ | _ | _ | _
  all_goals try (simp only [Option.map_none]; ev_go [hv38] [h2]; done)
  try dsimp only
  cases h0 : PlutusCore.Integer.equalsInteger 0 xt
  · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_none]; ev_go [hv38] [h2, h0]
  try simp only [↓reduceIte]
  -- The eight fields, in the order the decode reads them (the last first), and no ninth.
  rcases xs with _ | ⟨f0, _ | ⟨f1, _ | ⟨f2, _ | ⟨f3, _ | ⟨f4, _ | ⟨f5, _ | ⟨f6, _ | ⟨f7, rest⟩⟩⟩⟩⟩⟩⟩⟩
  all_goals try (simp only [refFields, Option.map_none]; ev_go [hv38] [h2, h0]; done)
  all_goals (cases f7 <;> try (simp only [refFields, bytesOf, intOf, Option.bind_eq_bind, Option.bind_none,
    Option.bind_some, Option.map_none]; ev_go [hv38] [h2, h0]; done))
  all_goals (cases f0 <;> try (simp only [refFields, bytesOf, intOf, Option.bind_eq_bind, Option.bind_none,
    Option.bind_some, Option.map_none]; ev_go [hv38] [h2, h0]; done))
  all_goals (cases f1 <;> try (simp only [refFields, bytesOf, intOf, Option.bind_eq_bind, Option.bind_none,
    Option.bind_some, Option.map_none]; ev_go [hv38] [h2, h0]; done))
  all_goals (cases f2 <;> try (simp only [refFields, bytesOf, intOf, Option.bind_eq_bind, Option.bind_none,
    Option.bind_some, Option.map_none]; ev_go [hv38] [h2, h0]; done))
  all_goals (cases f3 <;> try (simp only [refFields, bytesOf, intOf, Option.bind_eq_bind, Option.bind_none,
    Option.bind_some, Option.map_none]; ev_go [hv38] [h2, h0]; done))
  all_goals (cases f4 <;> try (simp only [refFields, bytesOf, intOf, Option.bind_eq_bind, Option.bind_none,
    Option.bind_some, Option.map_none]; ev_go [hv38] [h2, h0]; done))
  all_goals (cases f5 <;> try (simp only [refFields, bytesOf, intOf, Option.bind_eq_bind, Option.bind_none,
    Option.bind_some, Option.map_none]; ev_go [hv38] [h2, h0]; done))
  all_goals (cases f6 <;> try (simp only [refFields, bytesOf, intOf, Option.bind_eq_bind, Option.bind_none,
    Option.bind_some, Option.map_none]; ev_go [hv38] [h2, h0]; done))
  all_goals rcases rest with _ | ⟨r, rest⟩
  all_goals try (simp only [refFields, bytesOf, intOf, Option.bind_eq_bind,
    Option.bind_none, Option.bind_some, Option.map_none]; ev_go [hv38] [h2, h0]; done)
  rename_i f7 bl pol tnm tq fee f5 f6
  simp only [refFields, bytesOf, intOf, Option.bind_eq_bind, Option.bind_some, ↓reduceIte, if_pos trivial]
  have hc := fun ρ' => conds_region ρ' seed nm v info xt bl pol tnm tq fee f5 f6 f7
  cases hr : launchConds seed nm v info (.Constr xt [.I bl, .B pol, .B tnm, .I tq, .I fee, .B f5, .B f6, .B f7]) with
  | none =>
    try simp only [Option.map_none]
    ev_go [hv38, hc, hv31, hv39, hv40] [h2, h0, hr, Option.map_none]
  | some b =>
    try simp only [Option.map_some]
    ev_go [hv38, hc, hv31, hv39, hv40] [h2, h0, hr, Option.map_some]

end Lovejoin.Every
