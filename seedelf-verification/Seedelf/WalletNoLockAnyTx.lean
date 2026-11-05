import Seedelf.WalletNoLock
import Seedelf.AnyTx
import Seedelf.AnyTxSteps
import Blaster

/-! WalletNoLock in every transaction. A UTxO whose datum isn't exactly `Some(Constr 0 [B _, B _])`
is spendable with any well-formed proof, whatever the transaction around it: its run returns
unit, which is what the ledger accepts. Here the whole TxInfo is one `Data`, any value at all,
and so is the spent output's reference. The bytes never read the TxInfo off the Register branch
(`aiken uplc decode`), and these say so of every transaction. The same 18 datum shapes as
WalletNoLock, which with a Register are every datum (its doc lists them); 800 steps, as there.
The longest run is 597 (AnyTxSteps). -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

/-- A spend of `ref` with the datum `d` (encoded) and the proof `z, gr, vkh`, in the
transaction `info`. -/
def anyTxWithDatum (d : Data) (info ref : Data) (z gr vkh : ByteString) : List Term :=
  [toTerm (spendIn info (.Constr 0 [.B z, .B gr, .B vkh]) ref d)]

def anyTxNoDatumArgs := anyTxWithDatum datumNone
def anyTxBytesArgs (b : ByteString) := anyTxWithDatum (datumSome (.B b))
def anyTxIntArgs (i : Integer) := anyTxWithDatum (datumSome (.I i))
def anyTxListArgs (l : List Data) := anyTxWithDatum (datumSome (.List l))
def anyTxMapArgs (m : List (Data × Data)) := anyTxWithDatum (datumSome (.Map m))
def anyTxConstrPosArgs (n : Nat) (fs : List Data) := anyTxWithDatum (datumSome (.Constr (Int.ofNat (n + 1)) fs))
def anyTxConstrNegArgs (n : Nat) (fs : List Data) := anyTxWithDatum (datumSome (.Constr (Int.negSucc n) fs))
def anyTxFields0Args := anyTxWithDatum (datumSome (.Constr 0 []))
def anyTxFields1Args (x : Data) := anyTxWithDatum (datumSome (.Constr 0 [x]))
def anyTxFields3Args (x y w : Data) (rest : List Data) := anyTxWithDatum (datumSome (.Constr 0 (x :: y :: w :: rest)))
def anyTxFirstConstrArgs (k : Integer) (fs : List Data) (y : Data) := anyTxWithDatum (datumSome (.Constr 0 [.Constr k fs, y]))
def anyTxFirstMapArgs (m : List (Data × Data)) (y : Data) := anyTxWithDatum (datumSome (.Constr 0 [.Map m, y]))
def anyTxFirstListArgs (l : List Data) (y : Data) := anyTxWithDatum (datumSome (.Constr 0 [.List l, y]))
def anyTxFirstIArgs (i : Integer) (y : Data) := anyTxWithDatum (datumSome (.Constr 0 [.I i, y]))
def anyTxSecondConstrArgs (g : ByteString) (k : Integer) (fs : List Data) := anyTxWithDatum (datumSome (.Constr 0 [.B g, .Constr k fs]))
def anyTxSecondMapArgs (g : ByteString) (m : List (Data × Data)) := anyTxWithDatum (datumSome (.Constr 0 [.B g, .Map m]))
def anyTxSecondListArgs (g : ByteString) (l : List Data) := anyTxWithDatum (datumSome (.Constr 0 [.B g, .List l]))
def anyTxSecondIArgs (g : ByteString) (i : Integer) := anyTxWithDatum (datumSome (.Constr 0 [.B g, .I i]))

#prep_uplc appliedAnyTxNoDatum wallet anyTxNoDatumArgs 800
#prep_uplc appliedAnyTxBytes wallet anyTxBytesArgs 800
#prep_uplc appliedAnyTxInt wallet anyTxIntArgs 800
#prep_uplc appliedAnyTxList wallet anyTxListArgs 800
#prep_uplc appliedAnyTxMap wallet anyTxMapArgs 800
#prep_uplc appliedAnyTxConstrPos wallet anyTxConstrPosArgs 800
#prep_uplc appliedAnyTxConstrNeg wallet anyTxConstrNegArgs 800
#prep_uplc appliedAnyTxFields0 wallet anyTxFields0Args 800
#prep_uplc appliedAnyTxFields1 wallet anyTxFields1Args 800
#prep_uplc appliedAnyTxFields3 wallet anyTxFields3Args 800
#prep_uplc appliedAnyTxFirstConstr wallet anyTxFirstConstrArgs 800
#prep_uplc appliedAnyTxFirstMap wallet anyTxFirstMapArgs 800
#prep_uplc appliedAnyTxFirstList wallet anyTxFirstListArgs 800
#prep_uplc appliedAnyTxFirstI wallet anyTxFirstIArgs 800
#prep_uplc appliedAnyTxSecondConstr wallet anyTxSecondConstrArgs 800
#prep_uplc appliedAnyTxSecondMap wallet anyTxSecondMapArgs 800
#prep_uplc appliedAnyTxSecondList wallet anyTxSecondListArgs 800
#prep_uplc appliedAnyTxSecondI wallet anyTxSecondIArgs 800

-- Each builder's own run at its own limit (README rule 3): no datum, and a datum of three Bs,
-- the longest; neither run reads its TxInfo, here not even a TxInfo.
#guard endsWithUnit (appliedAnyTxNoDatum.exec (.I 7) spentRef z0 gr0 vkh0)
#guard endsWithUnit (appliedAnyTxFields3.exec (.B g1) (.B g1) (.B g1) [] (.I 7) spentRef z0 gr0 vkh0)
#guard endsWithUnit (appliedAnyTxSecondI.exec g1 5 (busyTx.info []) spentRef z0 gr0 vkh0)

theorem spendable_no_datum_any_tx : ∀ info ref z gr vkh, returnsUnit (appliedAnyTxNoDatum.prop info ref z gr vkh) := by blaster
theorem spendable_bytes_any_tx : ∀ b info ref z gr vkh, returnsUnit (appliedAnyTxBytes.prop b info ref z gr vkh) := by blaster
theorem spendable_int_any_tx : ∀ i info ref z gr vkh, returnsUnit (appliedAnyTxInt.prop i info ref z gr vkh) := by blaster
theorem spendable_list_any_tx : ∀ l info ref z gr vkh, returnsUnit (appliedAnyTxList.prop l info ref z gr vkh) := by blaster
theorem spendable_map_any_tx : ∀ m info ref z gr vkh, returnsUnit (appliedAnyTxMap.prop m info ref z gr vkh) := by blaster
theorem spendable_constr_pos_any_tx : ∀ n fs info ref z gr vkh, returnsUnit (appliedAnyTxConstrPos.prop n fs info ref z gr vkh) := by blaster
theorem spendable_constr_neg_any_tx : ∀ n fs info ref z gr vkh, returnsUnit (appliedAnyTxConstrNeg.prop n fs info ref z gr vkh) := by blaster
theorem spendable_fields0_any_tx : ∀ info ref z gr vkh, returnsUnit (appliedAnyTxFields0.prop info ref z gr vkh) := by blaster
theorem spendable_fields1_any_tx : ∀ x info ref z gr vkh, returnsUnit (appliedAnyTxFields1.prop x info ref z gr vkh) := by blaster
theorem spendable_fields3_any_tx : ∀ x y w rest info ref z gr vkh, returnsUnit (appliedAnyTxFields3.prop x y w rest info ref z gr vkh) := by blaster
theorem spendable_first_constr_any_tx : ∀ k fs y info ref z gr vkh, returnsUnit (appliedAnyTxFirstConstr.prop k fs y info ref z gr vkh) := by blaster
theorem spendable_first_map_any_tx : ∀ m y info ref z gr vkh, returnsUnit (appliedAnyTxFirstMap.prop m y info ref z gr vkh) := by blaster
theorem spendable_first_list_any_tx : ∀ l y info ref z gr vkh, returnsUnit (appliedAnyTxFirstList.prop l y info ref z gr vkh) := by blaster
theorem spendable_first_i_any_tx : ∀ i y info ref z gr vkh, returnsUnit (appliedAnyTxFirstI.prop i y info ref z gr vkh) := by blaster
theorem spendable_second_constr_any_tx : ∀ g k fs info ref z gr vkh, returnsUnit (appliedAnyTxSecondConstr.prop g k fs info ref z gr vkh) := by blaster
theorem spendable_second_map_any_tx : ∀ g m info ref z gr vkh, returnsUnit (appliedAnyTxSecondMap.prop g m info ref z gr vkh) := by blaster
theorem spendable_second_list_any_tx : ∀ g l info ref z gr vkh, returnsUnit (appliedAnyTxSecondList.prop g l info ref z gr vkh) := by blaster
theorem spendable_second_i_any_tx : ∀ g i info ref z gr vkh, returnsUnit (appliedAnyTxSecondI.prop g i info ref z gr vkh) := by blaster

end Seedelf.V1
