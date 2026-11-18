import Lovejoin.AnyTx.OwnerOne
import Lovejoin.AnyTx.OwnerTwo
import Lovejoin.AnyTx.OwnerLayouts
import Lovejoin.AnyTx.OwnerOtherInputs
import Blaster

/-! Negative controls for the one- and two-box Owner families in every transaction: `OwnerOne`,
`OwnerTwo`, `OwnerLayouts` and `OwnerOtherInputs`, each expected Falsified (README rule 8): a
control that comes back Valid prints "❌ Unexpected Valid" and fails the build. Each is its family's
first theorem with the outcome turned around, over the family's own builder, in its own namespace
and opens, so the solver meets the same script as the theorems do. Were that background
contradictory (Lean-blaster #194), every statement over it would come back Valid, these too. -/

-- OwnerOne's `box_needs_proof`, `isUnsuccessful` turned to `returnsUnit`.
namespace Lovejoin.AnyTx.OwnerOne
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (TxRest returnsUnit)
open Lovejoin.Classic (wellFormed)
open Lovejoin.Template (nftName)
open Lovejoin.AnyTx
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 540)
  [∀ (P M a b t z key : ByteString) (f : Fields), wellFormed a b = true → ownProof M f.tx.outputs [f.boxRef, f.keyRef] a b t z = false → returnsUnit (ownerOne.prop P M a b t z key f)]
end Lovejoin.AnyTx.OwnerOne

-- OwnerTwo's `first_box_needs_proof`, `isUnsuccessful` turned to `returnsUnit`.
namespace Lovejoin.AnyTx.OwnerTwo
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (returnsUnit)
open Lovejoin.Classic (wellFormed)
open Lovejoin.Template (nftName)
open Lovejoin.AnyTx
open Lovejoin.AnyTx.OwnerOne (Fields)
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 540)
  [∀ (P M a1 b1 a2 b2 t1 z1 t2 z2 key : ByteString) (f : Fields) (b : BoxFields), wellFormed a1 b1 = true → wellFormed a2 b2 = true → ownProof M f.tx.outputs [f.boxRef, b.ref, f.keyRef] a1 b1 t1 z1 = false → returnsUnit (twoOwners.prop P M a1 b1 a2 b2 t1 z1 t2 z2 key f b)]
end Lovejoin.AnyTx.OwnerTwo

-- OwnerLayouts's `solo_needs_proof`, `isUnsuccessful` turned to `returnsUnit`.
namespace Lovejoin.AnyTx.OwnerLayouts
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (returnsUnit)
open Lovejoin.Classic (wellFormed)
open Lovejoin.Template (nftName)
open Lovejoin.AnyTx
open Lovejoin.AnyTx.OwnerOne (Fields)
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 540)
  [∀ (P M a b t z : ByteString) (f : Fields), wellFormed a b = true → ownProof M f.tx.outputs [f.boxRef] a b t z = false → returnsUnit (soloOwner.prop P M a b t z f)]
end Lovejoin.AnyTx.OwnerLayouts

-- OwnerOtherInputs's `invalid_proof_fails`, `isUnsuccessful` turned to `returnsUnit`.
namespace Lovejoin.AnyTx.OwnerOtherInputs
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (returnsUnit)
open Lovejoin.Classic (wellFormed)
open Lovejoin.Template (nftName)
open Lovejoin.AnyTx
open Lovejoin.AnyTx.OwnerOne (Fields)
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 540)
  [∀ (P M a b t z other : ByteString) (f : Fields) (hash : Data) (first : Bool), wellFormed a b = true → ownProof M f.tx.outputs (inputRefs f first) a b t z = false → returnsUnit (ownerOtherInputs.prop P M a b t z other f hash first)]
end Lovejoin.AnyTx.OwnerOtherInputs
