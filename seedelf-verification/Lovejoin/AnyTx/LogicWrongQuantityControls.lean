import Lovejoin.AnyTx.LogicWrongQuantity
import Lovejoin.AnyTx.OwnerMoreControls
import Lovejoin.Template.AnyTxPurposes

/-! Concrete controls for multiple candidate reference inputs. -/
namespace Lovejoin.AnyTx.LogicWrongQuantityControls
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open Seedelf.V1 (g1)
open Lovejoin.AnyTx
open Lovejoin.AnyTx.LogicCarrierPredicate (quantityInput)
open Lovejoin.AnyTx.OwnerMoreControls (fields proofForRefs)
open Lovejoin.Template (nftName)
open Lovejoin.Template.AnyTx (endWith)
open Lovejoin.V2 (nftPolicy mixBoxHash)

def refDatum : Data := .Constr 2 [.Constr 0 [.I 10000000, .B "", .B "", .I 0, .I 800000,
  .B mixBoxHash, .B testL, .B testL]]

def candidate (i qty : Integer) : Data :=
  quantityInput (refAt i) (fields 1000000).carrierAddr refDatum (fields 1000000).carrierScript
    nftPolicy nftName qty [("", .Map [(.B "", .I 2000000)])] [] [] []

/-- A different candidate with an extra earlier policy and token name. -/
def candidateWithExtra (i qty : Integer) : Data :=
  quantityInput (refAt i) (fields 1000000).carrierAddr refDatum (fields 1000000).carrierScript
    nftPolicy nftName qty [("", .Map [(.B "", .I 2000000)]), ("a", .Map [])]
    [("", .I 9)] [] []

def candidateWithDatum (i : Integer) (datum : Data) : Data :=
  quantityInput (refAt i) (fields 1000000).carrierAddr datum (fields 1000000).carrierScript
    nftPolicy nftName 1 [("", .Map [(.B "", .I 2000000)])] [] [] []

def run (refs : List Data) : String :=
  match proofForRefs [(fields 1000000).boxRef] with
  | none => "no proof"
  | some (b,t,z) =>
    let f := fields 1000000
    let ins := [boxIn f.boxRef mixBoxHash f.boxStake f.boxValue f.boxScript g1 b]
    endWith mixLogicTemplate [toTerm nftPolicy, toTerm nftName]
      (ownerCtx f.tx (.List ins) (.List refs) f.sigs f.acct [proofData t z]) 100000

#guard run [candidate 1 0, candidate 2 2] == "error"
#guard run [candidate 1 0, candidate 2 1, candidate 3 2] == "unit"
#guard run [candidate 1 1, candidate 2 1] == "error"
#guard run [candidate 1 2, candidateWithExtra 2 1] == "unit"
#guard run [candidate 1 1, candidateWithExtra 2 1] == "error"
#guard run [candidate 1 0, candidateWithDatum 2 (.Constr 0 [])] == "error"
#guard run [candidate 1 0, candidateWithDatum 2 (.Constr 1 [.B "hash"])] == "error"

end Lovejoin.AnyTx.LogicWrongQuantityControls
