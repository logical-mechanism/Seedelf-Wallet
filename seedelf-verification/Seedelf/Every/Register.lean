import Seedelf.Every.Prove
import Seedelf.Every.Signers

/-! # A Register's spend (the delay at `regAt`)

The datum is exactly `Constr _ [B g, B u]` and the redeemer `Constr _ [B z, B gr, B vkh]`. The
Schnorr check runs first; only if it holds does the program read the TxInfo, for its
signatories (field 8, a list), and walk them for vkh. -/

namespace Seedelf.Every
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll

/-- The signatories' check: the TxInfo's field 8 must be a list, walked by `signedBy`. -/
def signedOpt (info : Data) (vkh : ByteString) : Option Bool :=
  match info with
  | .Constr _ (_ :: _ :: _ :: _ :: _ :: _ :: _ :: _ :: .List sigs :: _) => signedBy vkh sigs
  | _ => none

/-- After the proof: its error, its `False`, or the signatories' check. -/
def afterProve (info : Data) (vkh : ByteString) : Option Bool → Option Bool
  | none => none
  | some false => some false
  | some true => signedOpt info vkh

/-- The Register's spend, in the program's order: the proof, then the signatories. Never unfold
it with the proof's arguments symbolic: a `match` on `proveOpt …` makes simp reduce it, down to
deciding `n < q`. Rewrite `proveOpt …` with its cased value first (`afterProve`). -/
def registerOpt (info : Data) (g u z gr vkh : ByteString) : Option Bool :=
  afterProve info vkh (proveOpt g u z gr vkh)

def regBody : Term := sub regAt

set_option maxHeartbeats 0

/-- The region, over levels i_32 to i_0 (σ): i_25 the datum, i_13 the redeemer, i_12 the
TxInfo. -/
theorem register_ev (σ : Environment) (info : Data) (dt rt : Integer) (g u z gr vkh : ByteString)
    (hD : List.get?Internal σ 7 = some (.VCon (.Data (.Constr dt [.B g, .B u]))))
    (h18 : List.get?Internal σ 14 = some (vEq 0))
    (hR : List.get?Internal σ 19 = some (.VCon (.Data (.Constr rt [.B z, .B gr, .B vkh]))))
    (hI : List.get?Internal σ 20 = some (.VCon (.Data info)))
    (hIte : List.get?Internal σ 25 = some vIte) (hFst : List.get?Internal σ 26 = some vFst)
    (hSnd : List.get?Internal σ 27 = some vSnd) (hCL : List.get?Internal σ 28 = some vChooseList)
    (hMk : List.get?Internal σ 29 = some vMkCons) (hHead : List.get?Internal σ 30 = some vHead)
    (hTail : List.get?Internal σ 31 = some vTail) :
    Ev default regBody σ ((registerOpt info g u z gr vkh).map fun b => .VCon (.Bool b)) := by
  show Ev default regBody σ ((afterProve info vkh (proveOpt g u z gr vkh)).map fun b => .VCon (.Bool b))
  cases hp : proveOpt g u z gr vkh with
  | none =>
    simp only [afterProve, Option.map_none]
    w_go [prove_ev] [hp, Option.map_none]
  | some b =>
  cases b with
  | false =>
    simp only [afterProve, Option.map_some]
    w_go [prove_ev] [hp, Option.map_some]
  | true =>
  simp only [afterProve]
  rcases info with ⟨ti, _ | ⟨f0, _ | ⟨f1, _ | ⟨f2, _ | ⟨f3, _ | ⟨f4, _ | ⟨f5, _ | ⟨f6, _ | ⟨f7, _ |
    ⟨f8, ifs⟩⟩⟩⟩⟩⟩⟩⟩⟩⟩ | _ | _ | _ | _
  all_goals try (simp only [signedOpt, Option.map_none]
                 w_go [prove_ev] [hp, Option.map_some]; done)
  rcases f8 with ⟨_, _⟩ | _ | sigs | _ | _
  all_goals try (simp only [signedOpt, Option.map_none]
                 w_go [prove_ev] [hp, Option.map_some]; done)
  simp only [signedOpt]
  w_go [prove_ev, signer_loop] [hp, Option.map_some]

end Seedelf.Every
