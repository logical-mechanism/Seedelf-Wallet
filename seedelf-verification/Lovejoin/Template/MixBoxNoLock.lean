import Lovejoin.Template.Scripts
import Lovejoin.MixBoxNoLock
import Blaster

/-! `Lovejoin.MixBoxNoLock` on mix_box's template, for every mix_logic hash L: no
accidental locks. A box whose typed datum isn't an inline `Constr 0 [B _, B _]` moves with
no withdrawal at all, over the same shapes, which with `Template.MixBoxGate` cover every
datum. `Lovejoin.Classic`'s scenarios, with L the program's first argument. -/

namespace Lovejoin.Template
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (boxNoDatumArgs boxByHashArgs boxBytesArgs boxIntArgs boxListArgs boxMapArgs
  boxConstrPosArgs boxConstrNegArgs boxFields0Args boxFields1Args boxFields3Args boxFirstConstrArgs
  boxFirstMapArgs boxFirstListArgs boxFirstIArgs boxSecondConstrArgs boxSecondMapArgs boxSecondListArgs
  boxSecondIArgs)

def boxNoDatumArgsT (L : ByteString) (r : Data) : List Term := toTerm L :: boxNoDatumArgs r
def boxByHashArgsT (L h a b : ByteString) : List Term := toTerm L :: boxByHashArgs h a b
def boxBytesArgsT (L s : ByteString) : List Term := toTerm L :: boxBytesArgs s
def boxIntArgsT (L : ByteString) (i : Integer) : List Term := toTerm L :: boxIntArgs i
def boxListArgsT (L : ByteString) (l : List Data) : List Term := toTerm L :: boxListArgs l
def boxMapArgsT (L : ByteString) (m : List (Data × Data)) : List Term := toTerm L :: boxMapArgs m
def boxConstrPosArgsT (L : ByteString) (n : Nat) (fs : List Data) : List Term := toTerm L :: boxConstrPosArgs n fs
def boxConstrNegArgsT (L : ByteString) (n : Nat) (fs : List Data) : List Term := toTerm L :: boxConstrNegArgs n fs
def boxFields0ArgsT (L : ByteString) (r : Data) : List Term := toTerm L :: boxFields0Args r
def boxFields1ArgsT (L : ByteString) (x : Data) : List Term := toTerm L :: boxFields1Args x
def boxFields3ArgsT (L : ByteString) (x y w : Data) (rest : List Data) : List Term :=
  toTerm L :: boxFields3Args x y w rest
def boxFirstConstrArgsT (L : ByteString) (k : Integer) (fs : List Data) (y : Data) : List Term :=
  toTerm L :: boxFirstConstrArgs k fs y
def boxFirstMapArgsT (L : ByteString) (m : List (Data × Data)) (y : Data) : List Term := toTerm L :: boxFirstMapArgs m y
def boxFirstListArgsT (L : ByteString) (l : List Data) (y : Data) : List Term := toTerm L :: boxFirstListArgs l y
def boxFirstIArgsT (L : ByteString) (i : Integer) (y : Data) : List Term := toTerm L :: boxFirstIArgs i y
def boxSecondConstrArgsT (L a : ByteString) (k : Integer) (fs : List Data) : List Term :=
  toTerm L :: boxSecondConstrArgs a k fs
def boxSecondMapArgsT (L a : ByteString) (m : List (Data × Data)) : List Term := toTerm L :: boxSecondMapArgs a m
def boxSecondListArgsT (L a : ByteString) (l : List Data) : List Term := toTerm L :: boxSecondListArgs a l
def boxSecondIArgsT (L a : ByteString) (i : Integer) : List Term := toTerm L :: boxSecondIArgs a i

#prep_uplc appliedBoxNoDatumT mixBoxTemplate boxNoDatumArgsT 1500
#prep_uplc appliedBoxByHashT mixBoxTemplate boxByHashArgsT 1500
#prep_uplc appliedBoxBytesT mixBoxTemplate boxBytesArgsT 1500
#prep_uplc appliedBoxIntT mixBoxTemplate boxIntArgsT 1500
#prep_uplc appliedBoxListT mixBoxTemplate boxListArgsT 1500
#prep_uplc appliedBoxMapT mixBoxTemplate boxMapArgsT 1500
#prep_uplc appliedBoxConstrPosT mixBoxTemplate boxConstrPosArgsT 1500
#prep_uplc appliedBoxConstrNegT mixBoxTemplate boxConstrNegArgsT 1500
#prep_uplc appliedBoxFields0T mixBoxTemplate boxFields0ArgsT 1500
#prep_uplc appliedBoxFields1T mixBoxTemplate boxFields1ArgsT 1500
#prep_uplc appliedBoxFields3T mixBoxTemplate boxFields3ArgsT 1500
#prep_uplc appliedBoxFirstConstrT mixBoxTemplate boxFirstConstrArgsT 1500
#prep_uplc appliedBoxFirstMapT mixBoxTemplate boxFirstMapArgsT 1500
#prep_uplc appliedBoxFirstListT mixBoxTemplate boxFirstListArgsT 1500
#prep_uplc appliedBoxFirstIT mixBoxTemplate boxFirstIArgsT 1500
#prep_uplc appliedBoxSecondConstrT mixBoxTemplate boxSecondConstrArgsT 1500
#prep_uplc appliedBoxSecondMapT mixBoxTemplate boxSecondMapArgsT 1500
#prep_uplc appliedBoxSecondListT mixBoxTemplate boxSecondListArgsT 1500
#prep_uplc appliedBoxSecondIT mixBoxTemplate boxSecondIArgsT 1500

theorem box_no_datum_moves : ∀ L r, isSuccessful (appliedBoxNoDatumT.prop L r) := by blaster
theorem box_by_hash_moves : ∀ L h a b, isSuccessful (appliedBoxByHashT.prop L h a b) := by blaster
theorem box_bytes_moves : ∀ L s, isSuccessful (appliedBoxBytesT.prop L s) := by blaster
theorem box_int_moves : ∀ L i, isSuccessful (appliedBoxIntT.prop L i) := by blaster
theorem box_list_moves : ∀ L l, isSuccessful (appliedBoxListT.prop L l) := by blaster
theorem box_map_moves : ∀ L m, isSuccessful (appliedBoxMapT.prop L m) := by blaster
theorem box_constr_pos_moves : ∀ L n fs, isSuccessful (appliedBoxConstrPosT.prop L n fs) := by blaster
theorem box_constr_neg_moves : ∀ L n fs, isSuccessful (appliedBoxConstrNegT.prop L n fs) := by blaster
theorem box_fields0_moves : ∀ L r, isSuccessful (appliedBoxFields0T.prop L r) := by blaster
theorem box_fields1_moves : ∀ L x, isSuccessful (appliedBoxFields1T.prop L x) := by blaster
theorem box_fields3_moves : ∀ L x y w rest, isSuccessful (appliedBoxFields3T.prop L x y w rest) := by blaster
theorem box_first_constr_moves : ∀ L k fs y, isSuccessful (appliedBoxFirstConstrT.prop L k fs y) := by blaster
theorem box_first_map_moves : ∀ L m y, isSuccessful (appliedBoxFirstMapT.prop L m y) := by blaster
theorem box_first_list_moves : ∀ L l y, isSuccessful (appliedBoxFirstListT.prop L l y) := by blaster
theorem box_first_i_moves : ∀ L i y, isSuccessful (appliedBoxFirstIT.prop L i y) := by blaster
theorem box_second_constr_moves : ∀ L a k fs, isSuccessful (appliedBoxSecondConstrT.prop L a k fs) := by blaster
theorem box_second_map_moves : ∀ L a m, isSuccessful (appliedBoxSecondMapT.prop L a m) := by blaster
theorem box_second_list_moves : ∀ L a l, isSuccessful (appliedBoxSecondListT.prop L a l) := by blaster
theorem box_second_i_moves : ∀ L a i, isSuccessful (appliedBoxSecondIT.prop L a i) := by blaster

end Lovejoin.Template
