import Lovejoin.AnyTx.BoxGate
import Lovejoin.AnyTx.BoxBoundary
import Lovejoin.AnyTx.BoxSuffix
import Lovejoin.AnyTx.BoxDatum
import Lovejoin.AnyTx.LogicEmpty
import Lovejoin.AnyTx.Reference
import Lovejoin.AnyTx.Launch
import Blaster

/-! Negative controls for the box, reference and launch families in every transaction: `BoxGate`,
`BoxBoundary`, `BoxSuffix`, `BoxDatum`, `LogicEmpty`, `Reference` and `Launch`, each expected
Falsified (README rule 8): a control that comes back Valid prints "❌ Unexpected Valid" and fails the
build. Each is its family's first theorem with the outcome turned around, over the family's own
builder, in its own namespace and opens, so the solver meets the same script as the theorems do.
Were that background contradictory (Lean-blaster #194), every statement over it would come back
Valid, these too. -/

-- BoxGate's `no_withdrawal`, `isUnsuccessful` turned to `returnsUnit`.
namespace Lovejoin.AnyTx.BoxGate
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (TxRest returnsUnit)
open Lovejoin.AnyTx
#blaster (gen-cex: 0) (solve-result: 1)
  [∀ (L : ByteString) (r : TxRest) (sigs red ref rd p po addr v rs : Data) (a b : ByteString), p ≠ ref → lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b → returnsUnit (boxNone.prop L r sigs red ref rd p po addr v rs a b)]
end Lovejoin.AnyTx.BoxGate

-- BoxBoundary's `missing_input`, `isUnsuccessful` turned to `returnsUnit`.
namespace Lovejoin.AnyTx.BoxBoundary
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (TxRest returnsUnit)
open Lovejoin.AnyTx
#blaster (gen-cex: 0) (solve-result: 1)
  [∀ (L : ByteString) (r : TxRest) (sigs red ref rd p po q qo wdrl : Data), p ≠ ref → q ≠ ref → returnsUnit (boxMissing.prop L r sigs red ref rd p po q qo wdrl)]
end Lovejoin.AnyTx.BoxBoundary

-- BoxSuffix's `matches_after_other_entries`, `returnsUnit` turned to `isUnsuccessful`.
namespace Lovejoin.AnyTx.BoxSuffix
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (TxRest returnsUnit)
open Lovejoin.AnyTx
#blaster (gen-cex: 0) (solve-result: 1)
  [∀ (L a b c : ByteString) (r : TxRest) (sigs red ref rd p po addr v rs amount1 amount2 : Data) (ins : List Data) (wdrl : List (Data × Data)), p ≠ ref → c ≠ L → lengthOfByteString a = 48 → lengthOfByteString b = 48 → a ≠ b → isUnsuccessful (boxSuffixAfter.prop L a b c r sigs red ref rd p po addr v rs amount1 amount2 ins wdrl)]
end Lovejoin.AnyTx.BoxSuffix

-- BoxDatum's `inline_iff_not_box`, its iff with the datum test reversed.
namespace Lovejoin.AnyTx.BoxDatum
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (TxRest returnsUnit)
open Lovejoin.AnyTx
#blaster (gen-cex: 0) (solve-result: 1)
  [∀ (L : ByteString) (r : TxRest) (sigs red ref rd p po addr v rs datum : Data), p ≠ ref → (returnsUnit (boxInlineAny.prop L r sigs red ref rd p po addr v rs datum) ↔ isBoxDatum datum = true)]
end Lovejoin.AnyTx.BoxDatum

-- LogicEmpty's `owner_without_boxes`, `isUnsuccessful` turned to `returnsUnit`.
namespace Lovejoin.AnyTx.LogicEmpty
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (TxRest returnsUnit)
open Lovejoin.Template (nftName)
open Lovejoin.AnyTx
#blaster (gen-cex: 0) (solve-result: 1)
  [∀ (P M key : ByteString) (f : TxRest) (sigs acct ref stake value datum script : Data), returnsUnit (emptyOwner.prop P M key f sigs acct ref stake value datum script)]
end Lovejoin.AnyTx.LogicEmpty

-- Reference's `absent_fails`, `isUnsuccessful` turned to `returnsUnit`.
namespace Lovejoin.AnyTx.Reference
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (returnsUnit)
open Lovejoin.Classic (wellFormed)
open Lovejoin.Template (nftName)
open Lovejoin.AnyTx
open Lovejoin.AnyTx.OwnerOne (Fields)
#blaster (gen-cex: 0) (solve-result: 1)
  [∀ (P M a b t z key : ByteString) (f : Fields), returnsUnit (refAbsent.prop P M a b t z key f)]
end Lovejoin.AnyTx.Reference

-- Launch's `needs_seed`, `isUnsuccessful` turned to `returnsUnit`.
namespace Lovejoin.AnyTx.Launch
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (TxRest returnsUnit)
open Lovejoin.Template
#blaster (gen-cex: 0) (solve-result: 1)
  [∀ (s : ByteString) (i : Integer) (rh P s' : ByteString) (i' : Integer) (r : TxRest) (sigs red : Data), (s' ≠ s ∨ i' ≠ i) → returnsUnit (launchSeedAny.prop s i rh P s' i' r sigs red)]
end Lovejoin.AnyTx.Launch
