import Lovejoin.Every.MintSpec

/-! # one_shot_mint's conditions, once the reference datum decodes -/

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

/-- `equalsInteger` at a result the proof has cased on. -/
theorem ap_equalsInteger (v w : Integer) (b : Bool) (h : PlutusCore.Integer.equalsInteger v w = b) :
    Ap default (.VBuiltin .EqualsInteger [.VCon (.Integer v)] (.One .ArgV)) (.VCon (.Integer w))
      (some (.VCon (.Bool b))) := by
  subst h
  exact ap_builtin rfl

theorem conds_region (ρ : Environment) (seed : Data) (nm : ByteString) (v info : Data) (xt bl : Integer)
    (pol tnm : ByteString) (tq fee : Integer) (f5 f6 f7 : ByteString) (v31 v38 v39 v40 : CekValue)
    (h45 : List.get?Internal ρ 16 =
      some (.VCon (.Data (.Constr xt [.I bl, .B pol, .B tnm, .I tq, .I fee, .B f5, .B f6, .B f7]))))
    (h42 : List.get?Internal ρ 19 = some (.VCon (.ByteString nm)))
    (h41 : List.get?Internal ρ 20 = some (vEq 1))
    (h40 : List.get?Internal ρ 21 = some v40)
    (hv40 : ∀ l : List Data, Ap default v40 (.VCon (.ConstDataList l)) (l[3]?.map fun d => .VCon (.Data d)))
    (h39 : List.get?Internal ρ 22 = some v39)
    (hv39 : ∀ l : List Data, Ap default v39 (.VCon (.ConstDataList l)) (l[1]?.map fun d => .VCon (.Data d)))
    (h38 : List.get?Internal ρ 23 = some v38)
    (hv38 : ∀ l : List Data, Ap default v38 (.VCon (.ConstDataList l)) (l[2]?.map fun d => .VCon (.Data d)))
    (h37 : List.get?Internal ρ 24 = some (.VCon (.PairData (.B nm, v))))
    (h31 : List.get?Internal ρ 27 = some v31)
    (hv31 : ∀ l : List Data, Ap default v31 (.VCon (.ConstDataList l)) (l[4]?.map fun d => .VCon (.Data d)))
    (h30 : List.get?Internal ρ 28 = some (.VCon (.Data seed)))
    (h19 : List.get?Internal ρ 30 = some (.VCon (.Data info)))
    (h18 : List.get?Internal ρ 31 = some (vEq 0))
    (hIte : List.get?Internal ρ 39 = some vIte) (hSnd : List.get?Internal ρ 41 = some vSnd)
    (hCL : List.get?Internal ρ 42 = some vChooseList)
    (hHead : List.get?Internal ρ 44 = some vHead) (hTail : List.get?Internal ρ 45 = some vTail) :
    Ev default condsTerm ρ
      ((launchConds seed nm v info (.Constr xt [.I bl, .B pol, .B tnm, .I tq, .I fee, .B f5, .B f6, .B f7])).map
        fun b => .VCon (.Bool b)) := by
  have hsd := fun σ => seed_loop σ seed
  rcases info with ⟨ti, _ | ⟨i0, ifs⟩⟩ | _ | _ | _ | _
  all_goals try (simp only [launchConds, Option.map_none]; ev_go [] []; done)
  rcases i0 with _ | _ | ins | _ | _
  all_goals try (simp only [launchConds, Option.map_none]; ev_go [] []; done)
  simp only [launchConds]
  cases hs : seedIn seed ins with
  | none => simp only [Option.map_none]; ev_go [hsd, values_nil_any] [hs, Option.map_none]
  | some b =>
  cases b with
  | false => simp only [Option.map_some]; ev_go [hsd, values_nil_any] [hs, Option.map_some]
  | true =>
  cases hn : PlutusCore.ByteString.equalsByteString lovejoinName nm
  · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_some]
    ev_go [hsd, values_nil_any] [hs, hn, Option.map_some]
  try simp only [↓reduceIte]
  rcases v with _ | _ | _ | q | _
  all_goals try (simp only [Option.map_none]; ev_go [hsd, values_nil_any] [hs, hn, Option.map_some]; done)
  cases h1 : PlutusCore.Integer.equalsInteger 1 q
  · simp only [Bool.false_eq_true, ↓reduceIte, Option.map_some]
    ev_go [hsd, values_nil_any] [hs, hn, h1, Option.map_some]
  simp only [↓reduceIte, Option.map_some, launchDatumOk]
  cases hb : PlutusCore.Integer.lessThanInteger 0 bl
  · simp only [Bool.false_and]
    ev_go [ap_lessThan _ _ _ hb, hv38, hv39, hv40, hv31, hsd, values_nil_any] [hs, hn, h1, Option.map_some]
  cases hf : PlutusCore.Integer.lessThanInteger 0 fee
  · simp only [Bool.true_and, Bool.false_and]
    ev_go [ap_lessThan _ _ _ hb, ap_lessThan _ _ _ hf, hv38, hv39, hv40, hv31, hsd, values_nil_any]
      [hs, hn, h1, Option.map_some]
  cases hl : PlutusCore.Integer.lessThanInteger fee bl
  · simp only [Bool.true_and, Bool.false_and]
    ev_go [ap_lessThan _ _ _ hb, ap_lessThan _ _ _ hf, ap_lessThan _ _ _ hl, hv38, hv39, hv40, hv31, hsd,
      values_nil_any] [hs, hn, h1, Option.map_some]
  simp only [Bool.true_and]
  cases hp : PlutusCore.ByteString.equalsByteString ⟨""⟩ pol
  · simp only [Bool.false_eq_true, ↓reduceIte]
    cases h28 : PlutusCore.Integer.equalsInteger 28 (PlutusCore.ByteString.lengthOfByteString pol)
    · simp only [Bool.false_and]
      ev_go [ap_lessThan _ _ _ hb, ap_lessThan _ _ _ hf, ap_lessThan _ _ _ hl, hv38, hv39, hv40, hv31, hsd,
        values_nil_any] [hs, hn, h1, hp, h28, Option.map_some]
    cases h32 : PlutusCore.Integer.lessThanEqualsInteger (PlutusCore.ByteString.lengthOfByteString tnm) 32
    · simp only [Bool.true_and, Bool.false_and]
      ev_go [ap_lessThan _ _ _ hb, ap_lessThan _ _ _ hf, ap_lessThan _ _ _ hl, ap_lessThanEquals _ _ _ h32,
        hv38, hv39, hv40, hv31, hsd, values_nil_any] [hs, hn, h1, hp, h28, Option.map_some]
    cases hq : PlutusCore.Integer.lessThanInteger 0 tq
    · simp only [Bool.true_and, Bool.false_and]
      ev_go [ap_lessThan _ _ _ hb, ap_lessThan _ _ _ hf, ap_lessThan _ _ _ hl, ap_lessThanEquals _ _ _ h32,
        ap_lessThan _ _ _ hq, hv38, hv39, hv40, hv31, hsd, values_nil_any] [hs, hn, h1, hp, h28, Option.map_some]
    cases hm : PlutusCore.Integer.lessThanEqualsInteger tq 18446744073709551615 <;>
      simp only [Bool.true_and] <;>
      ev_go [ap_lessThan _ _ _ hb, ap_lessThan _ _ _ hf, ap_lessThan _ _ _ hl, ap_lessThanEquals _ _ _ h32,
        ap_lessThan _ _ _ hq, ap_lessThanEquals _ _ _ hm, hv38, hv39, hv40, hv31, hsd, values_nil_any]
        [hs, hn, h1, hp, h28, Option.map_some]
  · simp only [↓reduceIte, ite_true]
    cases hnm : PlutusCore.ByteString.equalsByteString ⟨""⟩ tnm
    · simp only [Bool.false_and]
      ev_go [ap_lessThan _ _ _ hb, ap_lessThan _ _ _ hf, ap_lessThan _ _ _ hl, hv38, hv39, hv40, hv31, hsd,
        values_nil_any] [hs, hn, h1, hp, hnm, Option.map_some]
    cases hz : PlutusCore.Integer.equalsInteger 0 tq <;>
      simp only [Bool.true_and, Bool.and_false, Bool.and_true, ↓reduceIte, ite_true] <;>
      ev_go [ap_lessThan _ _ _ hb, ap_lessThan _ _ _ hf, ap_lessThan _ _ _ hl, ap_equalsInteger _ _ _ hz, hv38,
        hv39, hv40, hv31, hsd, values_nil_any] [hs, hn, h1, hp, hnm, hz, Option.map_some]

end Lovejoin.Every
