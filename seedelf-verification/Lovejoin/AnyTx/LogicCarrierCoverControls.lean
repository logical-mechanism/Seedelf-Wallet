import Lovejoin.AnyTx.LogicLedgerCarrier
import Lovejoin.AnyTx.LogicWrongQuantityControls

/-! Concrete checks for interleaved present and absent reference assets. -/
namespace Lovejoin.AnyTx.LogicCarrierCoverControls
open PlutusCore.Data (Data)
open Seedelf.V1 (ofHex)
open Lovejoin.AnyTx
open Lovejoin.AnyTx.OwnerMoreControls (fields)
open Lovejoin.AnyTx.LogicWrongQuantityControls (run candidate refDatum)
open Lovejoin.V2 (nftPolicy)

private def ada : Data := .Map [(.B "", .I 2000000)]
private def address : Data := (fields 1000000).carrierAddr
private def script : Data := (fields 1000000).carrierScript
private def noPolicy : Data :=
  LogicAbsentPolicy.absentPolicyInput (refAt 20) address refDatum script [("", ada)]
private def noPolicyWithLater : Data :=
  LogicAbsentPolicyAfter.absentPolicyInput (refAt 21) address refDatum script [("", ada)]
    (ofHex "ffffffffffffffffffffffffffffffffffffffffffffffffffffffff") (.Map []) []
private def noName : Data :=
  LogicAbsentName.absentNameInput (refAt 22) address refDatum script nftPolicy [("", ada)] [("", .I 2)] []
private def noNameWithLater : Data :=
  LogicAbsentNameAfter.absentNameInput (refAt 23) address refDatum script nftPolicy [("", ada)] [("", .I 2)] []
    "z" (.I 3) []

#guard run [noPolicy, noPolicyWithLater, noName, noNameWithLater] == "error"
#guard run [noPolicy, noNameWithLater, candidate 2 1, noName, noPolicyWithLater] == "unit"
#guard run [noPolicy, candidate 1 1, noName, candidate 2 1, noPolicyWithLater] == "error"

end Lovejoin.AnyTx.LogicCarrierCoverControls
