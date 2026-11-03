import Seedelf.Wallet
import Blaster

/-! No accidental locks: a UTxO whose datum isn't exactly
`Some(Constr 0 [B _, B _])` is spendable with any well-formed proof.

One scenario per datum shape, and the shapes cover every datum but a Register:
a single symbolic datum keeps the Register branch in the symbolic run, and it
reaches the crypto builtins (`Except` and `BitVec`, which this Blaster can't
translate). Concrete runs halt within 597 steps (Steps.lean).

  none                                  noDatum
  some (B _ | I _ | List _ | Map _)     bytes, int, list, map
  some (Constr k _), k ≠ 0              constrPos (k = n+1), constrNeg (k = -(n+1))
  some (Constr 0 fs), |fs| ≠ 2          fields0, fields1, fields3
  some (Constr 0 [x, y]), x not B       first{Constr,Map,List,I}
  some (Constr 0 [B _, y]), y not B     second{Constr,Map,List,I} -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

/-- A spend with datum `d` and the proof `z, gr, vkh`, signed by `signer`. -/
def withDatum (d : Option Data) (z gr vkh signer : ByteString) : List Term :=
  [toTerm (spendCtx d z gr vkh signer)]

def noDatumArgs := withDatum none
def bytesArgs (b : ByteString) := withDatum (some (.B b))
def intArgs (i : Integer) := withDatum (some (.I i))
def listArgs (l : List Data) := withDatum (some (.List l))
def mapArgs (m : List (Data × Data)) := withDatum (some (.Map m))
def constrPosArgs (n : Nat) (fs : List Data) := withDatum (some (.Constr (Int.ofNat (n + 1)) fs))
def constrNegArgs (n : Nat) (fs : List Data) := withDatum (some (.Constr (Int.negSucc n) fs))
def fields0Args := withDatum (some (.Constr 0 []))
def fields1Args (x : Data) := withDatum (some (.Constr 0 [x]))
def fields3Args (x y w : Data) (rest : List Data) := withDatum (some (.Constr 0 (x :: y :: w :: rest)))
def firstConstrArgs (k : Integer) (fs : List Data) (y : Data) := withDatum (some (.Constr 0 [.Constr k fs, y]))
def firstMapArgs (m : List (Data × Data)) (y : Data) := withDatum (some (.Constr 0 [.Map m, y]))
def firstListArgs (l : List Data) (y : Data) := withDatum (some (.Constr 0 [.List l, y]))
def firstIArgs (i : Integer) (y : Data) := withDatum (some (.Constr 0 [.I i, y]))
def secondConstrArgs (g : ByteString) (k : Integer) (fs : List Data) := withDatum (some (.Constr 0 [.B g, .Constr k fs]))
def secondMapArgs (g : ByteString) (m : List (Data × Data)) := withDatum (some (.Constr 0 [.B g, .Map m]))
def secondListArgs (g : ByteString) (l : List Data) := withDatum (some (.Constr 0 [.B g, .List l]))
def secondIArgs (g : ByteString) (i : Integer) := withDatum (some (.Constr 0 [.B g, .I i]))

#prep_uplc appliedNoDatum wallet noDatumArgs 800
#prep_uplc appliedBytes wallet bytesArgs 800
#prep_uplc appliedInt wallet intArgs 800
#prep_uplc appliedList wallet listArgs 800
#prep_uplc appliedMap wallet mapArgs 800
#prep_uplc appliedConstrPos wallet constrPosArgs 800
#prep_uplc appliedConstrNeg wallet constrNegArgs 800
#prep_uplc appliedFields0 wallet fields0Args 800
#prep_uplc appliedFields1 wallet fields1Args 800
#prep_uplc appliedFields3 wallet fields3Args 800
#prep_uplc appliedFirstConstr wallet firstConstrArgs 800
#prep_uplc appliedFirstMap wallet firstMapArgs 800
#prep_uplc appliedFirstList wallet firstListArgs 800
#prep_uplc appliedFirstI wallet firstIArgs 800
#prep_uplc appliedSecondConstr wallet secondConstrArgs 800
#prep_uplc appliedSecondMap wallet secondMapArgs 800
#prep_uplc appliedSecondList wallet secondListArgs 800
#prep_uplc appliedSecondI wallet secondIArgs 800

theorem spendable_no_datum : ∀ z gr vkh s, isSuccessful (appliedNoDatum.prop z gr vkh s) := by blaster
theorem spendable_bytes : ∀ b z gr vkh s, isSuccessful (appliedBytes.prop b z gr vkh s) := by blaster
theorem spendable_int : ∀ i z gr vkh s, isSuccessful (appliedInt.prop i z gr vkh s) := by blaster
theorem spendable_list : ∀ l z gr vkh s, isSuccessful (appliedList.prop l z gr vkh s) := by blaster
theorem spendable_map : ∀ m z gr vkh s, isSuccessful (appliedMap.prop m z gr vkh s) := by blaster
theorem spendable_constr_pos : ∀ n fs z gr vkh s, isSuccessful (appliedConstrPos.prop n fs z gr vkh s) := by blaster
theorem spendable_constr_neg : ∀ n fs z gr vkh s, isSuccessful (appliedConstrNeg.prop n fs z gr vkh s) := by blaster
theorem spendable_fields0 : ∀ z gr vkh s, isSuccessful (appliedFields0.prop z gr vkh s) := by blaster
theorem spendable_fields1 : ∀ x z gr vkh s, isSuccessful (appliedFields1.prop x z gr vkh s) := by blaster
theorem spendable_fields3 : ∀ x y w rest z gr vkh s, isSuccessful (appliedFields3.prop x y w rest z gr vkh s) := by blaster
theorem spendable_first_constr : ∀ k fs y z gr vkh s, isSuccessful (appliedFirstConstr.prop k fs y z gr vkh s) := by blaster
theorem spendable_first_map : ∀ m y z gr vkh s, isSuccessful (appliedFirstMap.prop m y z gr vkh s) := by blaster
theorem spendable_first_list : ∀ l y z gr vkh s, isSuccessful (appliedFirstList.prop l y z gr vkh s) := by blaster
theorem spendable_first_i : ∀ i y z gr vkh s, isSuccessful (appliedFirstI.prop i y z gr vkh s) := by blaster
theorem spendable_second_constr : ∀ g k fs z gr vkh s, isSuccessful (appliedSecondConstr.prop g k fs z gr vkh s) := by blaster
theorem spendable_second_map : ∀ g m z gr vkh s, isSuccessful (appliedSecondMap.prop g m z gr vkh s) := by blaster
theorem spendable_second_list : ∀ g l z gr vkh s, isSuccessful (appliedSecondList.prop g l z gr vkh s) := by blaster
theorem spendable_second_i : ∀ g i z gr vkh s, isSuccessful (appliedSecondI.prop g i z gr vkh s) := by blaster

end Seedelf.V1
