import Seedelf.WalletNoLock

/-! Audit · Seedelf, WalletNoLock's coverage, which the README says is "checked by reading them,
not by a Lean theorem tying them together". Here it is a Lean theorem, kernel-checked, no blaster:

- `NoLockShape d`: the 18 datums WalletNoLock's scenarios pass, one constructor each, in its order.
- `NoLockShape.args_eq`: each shape's argument function is `withDatum` of that datum (by `rfl`).
- `noLockShapeOf` / `audit_no_lock_shapes_cover`: every `d` with `registerOf d = none` is a shape.
- `audit_no_lock_every_datum_halts`: so for every datum but a Register, its scenario's run halts,
  composed from the 18 `spendable_*` theorems themselves (it inherits their `blasterProven`).

If this module fails to elaborate, the fault is in this file's proof script, not in the bytes. -/

namespace SeedelfAudit
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.CekMachine (State)
open PlutusCore.UPLC.Utils
open Seedelf.V1

/-- WalletNoLock's 18 datums. -/
inductive NoLockShape : Option Data → Type
  | noDatum : NoLockShape none
  | bytes (b : ByteString) : NoLockShape (some (.B b))
  | int (i : Integer) : NoLockShape (some (.I i))
  | list (l : List Data) : NoLockShape (some (.List l))
  | map (m : List (Data × Data)) : NoLockShape (some (.Map m))
  | constrPos (n : Nat) (fs : List Data) : NoLockShape (some (.Constr (Int.ofNat (n + 1)) fs))
  | constrNeg (n : Nat) (fs : List Data) : NoLockShape (some (.Constr (Int.negSucc n) fs))
  | fields0 : NoLockShape (some (.Constr 0 []))
  | fields1 (x : Data) : NoLockShape (some (.Constr 0 [x]))
  | fields3 (x y w : Data) (rest : List Data) : NoLockShape (some (.Constr 0 (x :: y :: w :: rest)))
  | firstConstr (k : Integer) (fs : List Data) (y : Data) : NoLockShape (some (.Constr 0 [.Constr k fs, y]))
  | firstMap (m : List (Data × Data)) (y : Data) : NoLockShape (some (.Constr 0 [.Map m, y]))
  | firstList (l : List Data) (y : Data) : NoLockShape (some (.Constr 0 [.List l, y]))
  | firstI (i : Integer) (y : Data) : NoLockShape (some (.Constr 0 [.I i, y]))
  | secondConstr (g : ByteString) (k : Integer) (fs : List Data) : NoLockShape (some (.Constr 0 [.B g, .Constr k fs]))
  | secondMap (g : ByteString) (m : List (Data × Data)) : NoLockShape (some (.Constr 0 [.B g, .Map m]))
  | secondList (g : ByteString) (l : List Data) : NoLockShape (some (.Constr 0 [.B g, .List l]))
  | secondI (g : ByteString) (i : Integer) : NoLockShape (some (.Constr 0 [.B g, .I i]))

/-- Each shape's WalletNoLock argument function, applied to the shape's fields. -/
def NoLockShape.args {d : Option Data} : NoLockShape d → ByteString → ByteString → ByteString → ByteString → List Term
  | .noDatum => noDatumArgs
  | .bytes b => bytesArgs b
  | .int i => intArgs i
  | .list l => listArgs l
  | .map m => mapArgs m
  | .constrPos n fs => constrPosArgs n fs
  | .constrNeg n fs => constrNegArgs n fs
  | .fields0 => fields0Args
  | .fields1 x => fields1Args x
  | .fields3 x y w rest => fields3Args x y w rest
  | .firstConstr k fs y => firstConstrArgs k fs y
  | .firstMap m y => firstMapArgs m y
  | .firstList l y => firstListArgs l y
  | .firstI i y => firstIArgs i y
  | .secondConstr g k fs => secondConstrArgs g k fs
  | .secondMap g m => secondMapArgs g m
  | .secondList g l => secondListArgs g l
  | .secondI g i => secondIArgs g i

/-- CV1: that function is the spend of `d` itself. -/
theorem NoLockShape.args_eq {d : Option Data} (sh : NoLockShape d) : sh.args = withDatum d := by
  cases sh <;> rfl

/-- Every datum but a Register, as its shape. -/
def noLockShapeOf : (d : Option Data) → registerOf d = none → NoLockShape d
  | none, _ => .noDatum
  | some (.B b), _ => .bytes b
  | some (.I i), _ => .int i
  | some (.List l), _ => .list l
  | some (.Map m), _ => .map m
  | some (.Constr (Int.ofNat (n + 1)) fs), _ => .constrPos n fs
  | some (.Constr (Int.negSucc n) fs), _ => .constrNeg n fs
  | some (.Constr (Int.ofNat 0) []), _ => .fields0
  | some (.Constr (Int.ofNat 0) [x]), _ => .fields1 x
  | some (.Constr (Int.ofNat 0) (x :: y :: w :: rest)), _ => .fields3 x y w rest
  | some (.Constr (Int.ofNat 0) [.Constr k fs, y]), _ => .firstConstr k fs y
  | some (.Constr (Int.ofNat 0) [.Map m, y]), _ => .firstMap m y
  | some (.Constr (Int.ofNat 0) [.List l, y]), _ => .firstList l y
  | some (.Constr (Int.ofNat 0) [.I i, y]), _ => .firstI i y
  | some (.Constr (Int.ofNat 0) [.B g, .Constr k fs]), _ => .secondConstr g k fs
  | some (.Constr (Int.ofNat 0) [.B g, .Map m]), _ => .secondMap g m
  | some (.Constr (Int.ofNat 0) [.B g, .List l]), _ => .secondList g l
  | some (.Constr (Int.ofNat 0) [.B g, .I i]), _ => .secondI g i
  | some (.Constr (Int.ofNat 0) [.B _, .B _]), h => nomatch h

/-- CV2: the 18 shapes cover every datum but a Register. -/
theorem audit_no_lock_shapes_cover : ∀ (d : Option Data), registerOf d = none → Nonempty (NoLockShape d) :=
  fun d h => ⟨noLockShapeOf d h⟩

/-- CV3: and the spend of such a datum is its shape's scenario. -/
theorem audit_no_lock_spend_is_its_scenario : ∀ (d : Option Data) (h : registerOf d = none),
    (noLockShapeOf d h).args = withDatum d :=
  fun d h => (noLockShapeOf d h).args_eq

/-- Each shape's WalletNoLock run (its `#prep_uplc`'s prop). -/
noncomputable def NoLockShape.run {d : Option Data} : NoLockShape d → ByteString → ByteString → ByteString → ByteString → State
  | .noDatum => appliedNoDatum.prop
  | .bytes b => appliedBytes.prop b
  | .int i => appliedInt.prop i
  | .list l => appliedList.prop l
  | .map m => appliedMap.prop m
  | .constrPos n fs => appliedConstrPos.prop n fs
  | .constrNeg n fs => appliedConstrNeg.prop n fs
  | .fields0 => appliedFields0.prop
  | .fields1 x => appliedFields1.prop x
  | .fields3 x y w rest => appliedFields3.prop x y w rest
  | .firstConstr k fs y => appliedFirstConstr.prop k fs y
  | .firstMap m y => appliedFirstMap.prop m y
  | .firstList l y => appliedFirstList.prop l y
  | .firstI i y => appliedFirstI.prop i y
  | .secondConstr g k fs => appliedSecondConstr.prop g k fs
  | .secondMap g m => appliedSecondMap.prop g m
  | .secondList g l => appliedSecondList.prop g l
  | .secondI g i => appliedSecondI.prop g i

/-- Each shape's run halts: the 18 `spendable_*`, one per constructor. -/
theorem NoLockShape.run_halts {d : Option Data} (sh : NoLockShape d) (z gr vkh s : ByteString) :
    isSuccessful (sh.run z gr vkh s) := by
  cases sh with
  | noDatum => exact spendable_no_datum z gr vkh s
  | bytes b => exact spendable_bytes b z gr vkh s
  | int i => exact spendable_int i z gr vkh s
  | list l => exact spendable_list l z gr vkh s
  | map m => exact spendable_map m z gr vkh s
  | constrPos n fs => exact spendable_constr_pos n fs z gr vkh s
  | constrNeg n fs => exact spendable_constr_neg n fs z gr vkh s
  | fields0 => exact spendable_fields0 z gr vkh s
  | fields1 x => exact spendable_fields1 x z gr vkh s
  | fields3 x y w rest => exact spendable_fields3 x y w rest z gr vkh s
  | firstConstr k fs y => exact spendable_first_constr k fs y z gr vkh s
  | firstMap m y => exact spendable_first_map m y z gr vkh s
  | firstList l y => exact spendable_first_list l y z gr vkh s
  | firstI i y => exact spendable_first_i i y z gr vkh s
  | secondConstr g k fs => exact spendable_second_constr g k fs z gr vkh s
  | secondMap g m => exact spendable_second_map g m z gr vkh s
  | secondList g l => exact spendable_second_list g l z gr vkh s
  | secondI g i => exact spendable_second_i g i z gr vkh s

/-- CV4: for every datum but a Register, its scenario's run halts. -/
theorem audit_no_lock_every_datum_halts : ∀ (d : Option Data) (h : registerOf d = none) (z gr vkh s : ByteString),
    isSuccessful ((noLockShapeOf d h).run z gr vkh s) :=
  fun d h z gr vkh s => (noLockShapeOf d h).run_halts z gr vkh s

end SeedelfAudit
