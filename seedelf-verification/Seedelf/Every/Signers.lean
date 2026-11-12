import Seedelf.Every.Base

/-! # The signatories (i_51)

`list.has(self.extra_signatories, vkh)` as compiled: a walk over the signatory list, each entry
read with `unBData`, that stops at the first equal to vkh. An entry before the match that isn't
a `B` is an error; entries after it aren't read. Any length, by induction. -/

namespace Seedelf.Every
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll

/-- The walk: whether vkh is among the signatories, or `none` at an entry that isn't a `B`. -/
def signedBy (vkh : ByteString) : List Data → Option Bool
  | [] => some false
  | .B b :: xs => if PlutusCore.ByteString.equalsByteString b vkh then some true else signedBy vkh xs
  | _ :: _ => none

/-- `λ i_53. …`, the closure i_51 holds once applied to itself, and its body. -/
def loopM : Term := sub (regAt ++ [0,0,0,0,1,0,0,0,0,0,1,0])
def loopBody : Term := sub (regAt ++ [0,0,0,0,1,0,0,0,0,0,1,0,0])

theorem loopM_shape : loopM = .Lam loopBody := rfl

set_option maxHeartbeats 0

/-- The walk over any list, in i_51's closure environment σ (i_50 = vkh, i_49, then levels
i_33 to i_0). -/
theorem signer_loop (σ : Environment) (vkh : ByteString)
    (hV : List.get?Internal σ 0 = some (.VCon (.ByteString vkh)))
    (hIte : List.get?Internal σ 28 = some vIte) (hCL : List.get?Internal σ 31 = some vChooseList)
    (hHead : List.get?Internal σ 33 = some vHead) (hTail : List.get?Internal σ 34 = some vTail)
    (l : List Data) :
    Ev default loopBody (.VCon (.ConstDataList l) :: .VLam loopM σ :: σ)
      ((signedBy vkh l).map fun b => .VCon (.Bool b)) := by
  induction l with
  | nil => w_go [] []
  | cons x xs ih =>
    rcases x with ⟨_, _⟩ | _ | _ | _ | b
    all_goals try (simp only [signedBy, Option.map_none]; w_go [] []; done)
    cases hb : PlutusCore.ByteString.equalsByteString b vkh
    · simp only [signedBy, hb, Bool.false_eq_true, ↓reduceIte]
      w_go [ih] [hb]
    · simp only [signedBy, hb, ↓reduceIte, Option.map_some]
      w_go [] [hb]

end Seedelf.Every
