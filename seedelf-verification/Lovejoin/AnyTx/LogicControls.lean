import Lovejoin.AnyTx.LogicEmpty
import Lovejoin.Template.AnyTxPurposes
/-! A concrete version of the solver's one-box, long-proof counterexample. It is a
malformed context (including a one-byte policy); the 5000-step run is unfinished, while
the 20000-step run errors. This does not prove the arbitrary-proof case. -/
namespace Lovejoin.AnyTx.LogicControls
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.Data (Data)
open Seedelf.V1 (TxRest g1)
open Lovejoin.AnyTx
open Lovejoin.Template (nftName)
open Lovejoin.Template.AnyTx (endWith)
private def rest : TxRest := ⟨.I 0,.I 0,.I 0,.I 0,.I 0,.I 0,.I 0,.I 0,.I 0,.I 0,.I 0,.I 0,.I 0,.I 0,.I 0⟩
private def normal : Data := .Constr 0 [.B "A", .B "A", .B "A", .B "A"]
private def special : Data := .Constr 0 [.B "A", .B "A", .B "", .B "A"]
private def proof : Data := .Constr 0 [.List ([normal, normal, special] ++ List.replicate 12 normal)]
private def ctx : Data := .Constr 0 [
  withInputs rest (.List [boxIn (refAt 0) testM (.I 0) (.I 0) (.I 0) g1 otherPoint])
    (.List [carrierRef (refAt 2) (.Constr 0 [.Constr 1 [.B testL], .Constr 1 []])
      (.Map [(.B "", .I 2000000)]) (.Constr 1 []) "A" testM 10000000 "" "" 0 800000 testL testL]) (.List []),
  .Constr 1 [.List [proof]], .Constr 2 [.Constr 1 [.B testL]]]
#guard endWith mixLogicTemplate [toTerm ("A" : PlutusCore.ByteString.ByteString), toTerm nftName] ctx 5000 == "exhausted"
#guard endWith mixLogicTemplate [toTerm ("A" : PlutusCore.ByteString.ByteString), toTerm nftName] ctx 20000 == "error"
end Lovejoin.AnyTx.LogicControls
