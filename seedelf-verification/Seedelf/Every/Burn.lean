import Seedelf.Every.PolicyBase

/-! # The policy's burn check (`let i_19 …`)

The TxInfo's field 4 flattened by i_16 (the flatten closure, given by its behaviour), exactly one
line `[B pid, B tkn, I amt, …]`, else an error; then pid = own, `slice(0, 4, tkn) = 5eed0e1f`
and amt = -1. Any mint `Data`, any line count. -/

namespace Seedelf.Every
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString sliceByteString equalsByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll

set_option maxHeartbeats 0

/-- The burn check over levels i_16 to i_0 (σ): i_16 the flatten, i_14 the policy, i_11 the
TxInfo. -/
theorem burn_ev (σ : Environment) (info : Data) (own : ByteString) (v16 : CekValue)
    (h16 : List.get?Internal σ 0 = some v16)
    (hfl : ∀ ps, Ap default v16 (.VCon (.ConstPairDataList ps))
      ((flatPairs ps).map fun L => .VCon (.ConstDataList L)))
    (hOwn : List.get?Internal σ 2 = some (.VCon (.ByteString own)))
    (hI : List.get?Internal σ 5 = some (.VCon (.Data info)))
    (hIte : List.get?Internal σ 10 = some vIte) (hSnd : List.get?Internal σ 12 = some vSnd)
    (hCL : List.get?Internal σ 13 = some vChooseList) (hHead : List.get?Internal σ 15 = some vHead)
    (hTail : List.get?Internal σ 16 = some vTail) :
    Ev default burnBody σ ((burnOpt info own).map fun b => .VCon (.Bool b)) := by
  rcases info with ⟨ti, _ | ⟨f0, _ | ⟨f1, _ | ⟨f2, _ | ⟨f3, _ | ⟨mint, fs⟩⟩⟩⟩⟩⟩ | _ | _ | _ | _
  all_goals try (simp only [burnOpt, lineFields, Option.map_none]; w_go [hfl] []; done)
  rcases mint with ⟨_, _⟩ | ps | _ | _ | _
  all_goals try (simp only [burnOpt, lineFields, Option.map_none]; w_go [hfl] []; done)
  cases hf : flatPairs ps with
  | none => simp only [burnOpt, lineFields, hf, Option.map_none]; w_go [hfl] [hf, Option.map_none]
  | some L =>
  rcases L with _ | ⟨x, _ | ⟨y, L⟩⟩
  · -- No line: the head errors.
    simp only [burnOpt, lineFields, hf, Option.map_none]; w_go [hfl] [hf, Option.map_some]
  · -- One line.
    rcases x with ⟨_, _⟩ | _ | l | _ | _
    all_goals try (simp only [burnOpt, lineFields, hf, Option.map_none]; w_go [hfl] [hf, Option.map_some]; done)
    -- In the program's order: the name (unBData of the second field), then the amount
    -- (unIData of the third), then the policy (unBData of the first, at its comparison).
    rcases l with _ | ⟨p, _ | ⟨t, rest⟩⟩
    all_goals try (simp only [burnOpt, lineFields, hf, Option.map_none]; w_go [hfl] [hf, Option.map_some]; done)
    rcases t with ⟨_, _⟩ | _ | _ | _ | tkn
    all_goals try (simp only [burnOpt, lineFields, hf, Option.map_none]; w_go [hfl] [hf, Option.map_some]; done)
    rcases rest with _ | ⟨a, l⟩
    all_goals try (simp only [burnOpt, lineFields, hf, Option.map_none]; w_go [hfl] [hf, Option.map_some]; done)
    rcases a with ⟨_, _⟩ | _ | _ | amt | _
    all_goals try (simp only [burnOpt, lineFields, hf, Option.map_none]; w_go [hfl] [hf, Option.map_some]; done)
    rcases p with ⟨_, _⟩ | _ | _ | _ | pid
    all_goals try (simp only [burnOpt, lineFields, hf, Option.map_none]; w_go [hfl] [hf, Option.map_some]; done)
    simp only [burnOpt, lineFields, hf]
    cases hp : equalsByteString pid own
    · have h1 := ap_eqBS _ _ _ hp
      simp only [Bool.false_eq_true, ↓reduceIte]
      w_go [hfl, h1] [hf, Option.map_some]
    cases hs : equalsByteString (sliceByteString 0 4 tkn) Seedelf.V1.seedelfPrefix
    · have h1 := ap_eqBS _ _ _ hp
      have h2 := ap_eqBS _ _ _ hs
      simp only [Bool.false_eq_true, ↓reduceIte]
      w_go [hfl, h1, h2] [hf, Option.map_some]
    have h1 := ap_eqBS _ _ _ hp
    have h2 := ap_eqBS _ _ _ hs
    have h3 := ap_eqInt amt (-1) _ rfl
    simp only [↓reduceIte]
    w_go [hfl, h1, h2, h3] [hf, Option.map_some]
  · -- Two lines or more: the first must be a list, then the tail isn't empty.
    rcases x with ⟨_, _⟩ | _ | l | _ | _ <;>
      simp only [burnOpt, lineFields, hf, Option.map_none] <;> w_go [hfl] [hf, Option.map_some]

end Seedelf.Every
