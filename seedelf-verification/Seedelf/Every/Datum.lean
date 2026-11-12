import Seedelf.Every.Register

/-! # `Some(d)`: the datum (the delay that binds i_25)

The spent output's datum is `Some(d)`, `d` the option's first field. Exactly
`Constr 0 [B g, B u]` is a Register, spent by `registerOpt`; any other `d` accepts. The tag
is tested before the fields, as compiled. -/

namespace Seedelf.Every
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll

/-- `Some(d)`'s `d`: exactly `Constr 0 [B g, B u]` is a Register; anything else accepts. -/
def datumOpt (info : Data) (z gr vkh : ByteString) : Data → Option Bool
  | .Constr dt dfs =>
    if PlutusCore.Integer.equalsInteger 0 dt then
      match dfs with
      | [.B g, .B u] => registerOpt info g u z gr vkh
      | _ => some true
    else some true
  | _ => some true

/-- The option's fields: the first is `d`; none is an error. -/
def someOpt (info : Data) (z gr vkh : ByteString) : List Data → Option Bool
  | d :: _ => datumOpt info z gr vkh d
  | [] => none

def datumAt : List Nat :=
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,
   1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0]
def datumBody : Term := sub datumAt

set_option maxHeartbeats 0

/-- The region, over levels i_24 to i_0 (σ): i_17 the datum option `Constr ot ofs`, i_13 the
redeemer, i_12 the TxInfo. -/
theorem datum_ev (σ : Environment) (info : Data) (ot rt : Integer) (ofs : List Data)
    (z gr vkh : ByteString)
    (h18 : List.get?Internal σ 6 = some (vEq 0))
    (hO : List.get?Internal σ 7 = some (.VCon (.Data (.Constr ot ofs))))
    (hR : List.get?Internal σ 11 = some (.VCon (.Data (.Constr rt [.B z, .B gr, .B vkh]))))
    (hI : List.get?Internal σ 12 = some (.VCon (.Data info)))
    (hIte : List.get?Internal σ 17 = some vIte) (hFst : List.get?Internal σ 18 = some vFst)
    (hSnd : List.get?Internal σ 19 = some vSnd) (hCL : List.get?Internal σ 20 = some vChooseList)
    (hMk : List.get?Internal σ 21 = some vMkCons) (hHead : List.get?Internal σ 22 = some vHead)
    (hTail : List.get?Internal σ 23 = some vTail) (hCD : List.get?Internal σ 24 = some vChooseData) :
    Ev default datumBody σ ((someOpt info z gr vkh ofs).map fun b => .VCon (.Bool b)) := by
  rcases ofs with _ | ⟨d, ofs⟩
  · simp only [someOpt, Option.map_none]; w_go [] []
  simp only [someOpt]
  rcases d with ⟨dt, dfs⟩ | _ | _ | _ | _
  all_goals try (simp only [datumOpt, Option.map_some]; w_go [] []; done)
  cases h3 : PlutusCore.Integer.equalsInteger 0 dt
  · simp only [datumOpt, h3, Bool.false_eq_true, ↓reduceIte, Option.map_some]; w_go [] [h3]
  rcases dfs with _ | ⟨x, dfs⟩
  all_goals try (simp only [datumOpt, h3, ↓reduceIte, Option.map_some]; w_go [] [h3]; done)
  rcases x with ⟨_, _⟩ | _ | _ | _ | g
  all_goals try (simp only [datumOpt, h3, ↓reduceIte, Option.map_some]; w_go [] [h3]; done)
  rcases dfs with _ | ⟨x, dfs⟩
  all_goals try (simp only [datumOpt, h3, ↓reduceIte, Option.map_some]; w_go [] [h3]; done)
  rcases x with ⟨_, _⟩ | _ | _ | _ | u
  all_goals try (simp only [datumOpt, h3, ↓reduceIte, Option.map_some]; w_go [] [h3]; done)
  -- A third field accepts; exactly two is a Register. Each goal by itself: a `try` around the
  -- Register's goal would run into its region with no lemma, and decide `n < q` by reduction,
  -- which no `try` catches.
  rcases dfs with _ | ⟨w, dfs⟩
  · simp only [datumOpt, h3, ↓reduceIte]
    have hreg := register_ev (info := info) (dt := dt) (rt := rt) (g := g) (u := u) (z := z) (gr := gr)
      (vkh := vkh)
    w_go [hreg] [h3]
  · simp only [datumOpt, h3, ↓reduceIte, Option.map_some]; w_go [] [h3]

end Seedelf.Every
