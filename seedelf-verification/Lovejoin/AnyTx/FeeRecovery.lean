import Lovejoin.Template.Scripts
import Lovejoin.Template.Launch
import Seedelf.AnyTx
import Blaster

/-! fee_contract's Rule 2 recovery: absent datum or a resolved bytestring datum
is recoverable for each recognized redeemer. The V3 transaction has arbitrary Data
fields. The handler receives a resolved datum, so these checks do not distinguish an
inline datum from a hash with a witness. -/
namespace Lovejoin.AnyTx.FeeRecovery
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (TxRest spendIn returnsUnit)
open Lovejoin.Template (nftName)

def payNoneArgs (P : ByteString) (r : TxRest) (sigs ref : Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (spendIn (r.infoWith sigs) (.Constr 0 []) ref (.Constr 1 []))]
def replenishNoneArgs (P : ByteString) (r : TxRest) (sigs ref : Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (spendIn (r.infoWith sigs) (.Constr 1 []) ref (.Constr 1 []))]
def payBytesArgs (P : ByteString) (r : TxRest) (sigs ref : Data) (d : ByteString) : List Term :=
  [toTerm P, toTerm nftName, toTerm (spendIn (r.infoWith sigs) (.Constr 0 []) ref (.Constr 0 [.B d]))]
def replenishBytesArgs (P : ByteString) (r : TxRest) (sigs ref : Data) (d : ByteString) : List Term :=
  [toTerm P, toTerm nftName, toTerm (spendIn (r.infoWith sigs) (.Constr 1 []) ref (.Constr 0 [.B d]))]

#prep_uplc feeRecoverPayNone feeContractTemplate payNoneArgs 2000
#prep_uplc feeRecoverGrowNone feeContractTemplate replenishNoneArgs 2000
#prep_uplc feeRecoverPayBytes feeContractTemplate payBytesArgs 2000
#prep_uplc feeRecoverGrowBytes feeContractTemplate replenishBytesArgs 2000

theorem no_datum_pay (P : ByteString) (r : TxRest) (sigs ref : Data) :
  returnsUnit (feeRecoverPayNone.prop P r sigs ref) := by blaster
theorem no_datum_replenish (P : ByteString) (r : TxRest) (sigs ref : Data) :
  returnsUnit (feeRecoverGrowNone.prop P r sigs ref) := by blaster
theorem bytes_pay (P : ByteString) (r : TxRest) (sigs ref : Data) (d : ByteString) :
  returnsUnit (feeRecoverPayBytes.prop P r sigs ref d) := by blaster
theorem bytes_replenish (P : ByteString) (r : TxRest) (sigs ref : Data) (d : ByteString) :
  returnsUnit (feeRecoverGrowBytes.prop P r sigs ref d) := by blaster

end Lovejoin.AnyTx.FeeRecovery
