import Lovejoin.Box
import Blaster

/-! No accidental locks: a box whose typed datum isn't an inline `Constr 0 [B _, B _]`
moves with no withdrawal at all, so anyone can sweep it (Rule 2). With
`MixBoxGate.box_moves_alone_iff_malformed`, which covers `Constr 0 [B a, B b]`, the
shapes cover every datum, as `Seedelf.WalletNoLock`'s do:

  no datum                               noDatum
  by hash, whatever its witness          byHash (audit finding F-2)
  inline B _ | I _ | List _ | Map _      bytes, int, list, map
  inline Constr k _, k ≠ 0               constrPos (k = n+1), constrNeg (k = -(n+1))
  inline Constr 0 fs, |fs| ≠ 2           fields0, fields1, fields3
  inline Constr 0 [x, y], x not B        first{Constr,Map,List,I}
  inline Constr 0 [B _, y], y not B      second{Constr,Map,List,I} -/

namespace Lovejoin.Classic
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

def inlineArgs (d : Data) : List Term := [toTerm (inlineBoxCtx d [])]

/-- With any redeemer: mix_box ignores it, and the scenario needs a symbolic input. -/
def boxNoDatumArgs (r : Data) : List Term := [toTerm (spendBoxCtx .NoOutputDatum none [] r)]
/-- A box stored by hash, whose witness is a well-formed `MixDatum`. -/
def boxByHashArgs (h a b : ByteString) : List Term :=
  [toTerm (spendBoxCtx (.OutputDatumHash h) (some (mixDatum a b)) [])]
def boxBytesArgs (s : ByteString) := inlineArgs (.B s)
def boxIntArgs (i : Integer) := inlineArgs (.I i)
def boxListArgs (l : List Data) := inlineArgs (.List l)
def boxMapArgs (m : List (Data × Data)) := inlineArgs (.Map m)
def boxConstrPosArgs (n : Nat) (fs : List Data) := inlineArgs (.Constr (Int.ofNat (n + 1)) fs)
def boxConstrNegArgs (n : Nat) (fs : List Data) := inlineArgs (.Constr (Int.negSucc n) fs)
def boxFields0Args (r : Data) : List Term := [toTerm (inlineBoxCtx (.Constr 0 []) [] r)]
def boxFields1Args (x : Data) := inlineArgs (.Constr 0 [x])
def boxFields3Args (x y w : Data) (rest : List Data) := inlineArgs (.Constr 0 (x :: y :: w :: rest))
def boxFirstConstrArgs (k : Integer) (fs : List Data) (y : Data) := inlineArgs (.Constr 0 [.Constr k fs, y])
def boxFirstMapArgs (m : List (Data × Data)) (y : Data) := inlineArgs (.Constr 0 [.Map m, y])
def boxFirstListArgs (l : List Data) (y : Data) := inlineArgs (.Constr 0 [.List l, y])
def boxFirstIArgs (i : Integer) (y : Data) := inlineArgs (.Constr 0 [.I i, y])
def boxSecondConstrArgs (a : ByteString) (k : Integer) (fs : List Data) := inlineArgs (.Constr 0 [.B a, .Constr k fs])
def boxSecondMapArgs (a : ByteString) (m : List (Data × Data)) := inlineArgs (.Constr 0 [.B a, .Map m])
def boxSecondListArgs (a : ByteString) (l : List Data) := inlineArgs (.Constr 0 [.B a, .List l])
def boxSecondIArgs (a : ByteString) (i : Integer) := inlineArgs (.Constr 0 [.B a, .I i])

#prep_uplc appliedBoxNoDatum mixBox boxNoDatumArgs 1500
#prep_uplc appliedBoxByHash mixBox boxByHashArgs 1500
#prep_uplc appliedBoxBytes mixBox boxBytesArgs 1500
#prep_uplc appliedBoxInt mixBox boxIntArgs 1500
#prep_uplc appliedBoxList mixBox boxListArgs 1500
#prep_uplc appliedBoxMap mixBox boxMapArgs 1500
#prep_uplc appliedBoxConstrPos mixBox boxConstrPosArgs 1500
#prep_uplc appliedBoxConstrNeg mixBox boxConstrNegArgs 1500
#prep_uplc appliedBoxFields0 mixBox boxFields0Args 1500
#prep_uplc appliedBoxFields1 mixBox boxFields1Args 1500
#prep_uplc appliedBoxFields3 mixBox boxFields3Args 1500
#prep_uplc appliedBoxFirstConstr mixBox boxFirstConstrArgs 1500
#prep_uplc appliedBoxFirstMap mixBox boxFirstMapArgs 1500
#prep_uplc appliedBoxFirstList mixBox boxFirstListArgs 1500
#prep_uplc appliedBoxFirstI mixBox boxFirstIArgs 1500
#prep_uplc appliedBoxSecondConstr mixBox boxSecondConstrArgs 1500
#prep_uplc appliedBoxSecondMap mixBox boxSecondMapArgs 1500
#prep_uplc appliedBoxSecondList mixBox boxSecondListArgs 1500
#prep_uplc appliedBoxSecondI mixBox boxSecondIArgs 1500

theorem box_no_datum_moves : ∀ r, isSuccessful (appliedBoxNoDatum.prop r) := by blaster
theorem box_by_hash_moves : ∀ h a b, isSuccessful (appliedBoxByHash.prop h a b) := by blaster
theorem box_bytes_moves : ∀ s, isSuccessful (appliedBoxBytes.prop s) := by blaster
theorem box_int_moves : ∀ i, isSuccessful (appliedBoxInt.prop i) := by blaster
theorem box_list_moves : ∀ l, isSuccessful (appliedBoxList.prop l) := by blaster
theorem box_map_moves : ∀ m, isSuccessful (appliedBoxMap.prop m) := by blaster
theorem box_constr_pos_moves : ∀ n fs, isSuccessful (appliedBoxConstrPos.prop n fs) := by blaster
theorem box_constr_neg_moves : ∀ n fs, isSuccessful (appliedBoxConstrNeg.prop n fs) := by blaster
theorem box_fields0_moves : ∀ r, isSuccessful (appliedBoxFields0.prop r) := by blaster
theorem box_fields1_moves : ∀ x, isSuccessful (appliedBoxFields1.prop x) := by blaster
theorem box_fields3_moves : ∀ x y w rest, isSuccessful (appliedBoxFields3.prop x y w rest) := by blaster
theorem box_first_constr_moves : ∀ k fs y, isSuccessful (appliedBoxFirstConstr.prop k fs y) := by blaster
theorem box_first_map_moves : ∀ m y, isSuccessful (appliedBoxFirstMap.prop m y) := by blaster
theorem box_first_list_moves : ∀ l y, isSuccessful (appliedBoxFirstList.prop l y) := by blaster
theorem box_first_i_moves : ∀ i y, isSuccessful (appliedBoxFirstI.prop i y) := by blaster
theorem box_second_constr_moves : ∀ a k fs, isSuccessful (appliedBoxSecondConstr.prop a k fs) := by blaster
theorem box_second_map_moves : ∀ a m, isSuccessful (appliedBoxSecondMap.prop a m) := by blaster
theorem box_second_list_moves : ∀ a l, isSuccessful (appliedBoxSecondList.prop a l) := by blaster
theorem box_second_i_moves : ∀ a i, isSuccessful (appliedBoxSecondI.prop a i) := by blaster

end Lovejoin.Classic
