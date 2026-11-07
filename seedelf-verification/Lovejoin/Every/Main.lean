import Lovejoin.Every.Owner

/-! # The main body

i_30's delay: the helpers (i_72 to i_80), the reference datum (i_81), the boxes (i_105), the
scalar decoder (i_106) and the length (i_107), then the Owner or the Mix by the redeemer's tag. -/

namespace Lovejoin.Every
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term Const)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.Template (nftName)

set_option maxHeartbeats 0

/-- i_107, `i_77(i_77)`: the length. -/
theorem len_ap (σ : Environment) (hCL : List.get?Internal σ 17 = some vChooseList)
    (hTail : List.get?Internal σ 20 = some vTail) (l : List Data) :
    Ap default (.VLam lenBody (.VLam lenLoop σ :: σ)) (.VCon (.ConstDataList l))
      (some (.VCon (.Integer (countOf l)))) := by
  apply ap_lam
  exact len_loop σ hCL hTail l

/-- The main body, i_30's delay. -/
def mainBody : Term := sub [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0]

/-- An Owner withdrawal past the redeemer's checks: the reference datum, the boxes, then
`validate_owner`. -/
def ownerMain (P : ByteString) (info red : Data) : Option Bool :=
  match referenceDatum P nftName info with
  | some rd =>
    match boxesOf rd info with
    | some boxes => ownerResult rd info red boxes
    | none => none
  | none => none

theorem main_owner (P : ByteString) (info : Data) (fs : List Data) (c0 c1 c3 c8 c9 c10 c11 : CekValue)
    (rest : Environment) :
    Ev default mainBody (env29 c0 c1 c3 c8 c9 c10 c11 info (.Constr 0 fs) P rest)
      ((ownerMain P info (.Constr 0 fs)).map fun b => .VCon (.Bool b)) := by
  simp only [ownerMain]
  cases hrd : referenceDatum P nftName info with
  | none =>
    ev_go [reference_datum, nth1_ap, nth2_ap] [hrd, Option.map_none]
  | some rd =>
    cases hb : boxesOf rd info with
    | none =>
      ev_go [reference_datum, boxes_of, nth1_ap, nth2_ap, nth5_ap] [hrd, hb, Option.map_none, Option.map_some]
    | some boxes =>
      have hob := fun ρ σ78 => owner_branch ρ σ78 rd info (.Constr 0 fs) boxes
      ev_go [reference_datum, boxes_of, hob, nth1_ap, nth2_ap, nth5_ap, scalar_ap, scalarMod_ap,
        len_ap, values_nil_any] [hrd, hb, Option.map_none, Option.map_some]

end Lovejoin.Every
