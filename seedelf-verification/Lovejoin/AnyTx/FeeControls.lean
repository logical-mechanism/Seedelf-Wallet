import Lovejoin.AnyTx.FeeSpend
import Lovejoin.AnyTx.FeeRecovery
import Lovejoin.AnyTx.OwnerMoreControls
import Lovejoin.Template.Steps

/-! Concrete controls for the generalized fee-spend contexts. -/
namespace Lovejoin.AnyTx.FeeControls
open PlutusCore.Data (Data)
open Seedelf.V1 (endsWithUnit endsInError)
open Lovejoin.Template (pool5Policy)
open Lovejoin.AnyTx.FeeSpend
open Lovejoin.AnyTx.OwnerMoreControls (fields)

#guard endsWithUnit (feePayAny.exec pool5Policy 1000000 5000000 4200000 800000 (fields 1000000).tx (.I 77))
#guard endsInError (feePayAny.exec pool5Policy 1000000 5000000 4199999 800000 (fields 1000000).tx (.I 77))
#guard endsInError (feePayAny.exec pool5Policy 799999 5000000 4200000 800000 (fields 1000000).tx (.I 77))
#guard endsInError (feeTwoAny.exec pool5Policy 1000000 5000000 4200000 800000 (fields 1000000).tx (.I 77))
#guard endsInError (feeOwnerAny.exec pool5Policy 1000000 5000000 4200000 800000 (fields 1000000).tx (.I 77))
#guard endsInError (feeNoMixAny.exec pool5Policy 1000000 5000000 4200000 800000 (fields 1000000).tx (.I 77))
#guard endsWithUnit (feeReplenishAny.exec pool5Policy 5000000 6000000 (fields 1000000).tx (.I 77))
#guard endsInError (feeReplenishAny.exec pool5Policy 5000000 5000000 (fields 1000000).tx (.I 77))

#guard endsWithUnit (feeRecoverPayNone.exec pool5Policy (fields 1000000).tx (.I 77) (.I 1))
#guard endsWithUnit (feeRecoverGrowNone.exec pool5Policy (fields 1000000).tx (.I 77) (.I 1))
#guard endsWithUnit (feeRecoverPayBytes.exec pool5Policy (fields 1000000).tx (.I 77) (.I 1) "invalid")
#guard endsWithUnit (feeRecoverGrowBytes.exec pool5Policy (fields 1000000).tx (.I 77) (.I 1) "invalid")

/-- Read the mint field of a raw V3 context for the builder check. -/
private def mintField : Data → Option Data
  | .Constr 0 [.Constr 0 [_, _, _, _, mint, _, _, _, _, _, _, _, _, _, _, _], _, _] => some mint
  | _ => none

/-- The transformation really changes the transaction field, rather than returning the original. -/
example : mintField (withRest (Lovejoin.Template.feeCtx pool5Policy 1000000 5000000
    Lovejoin.Template.threeBoxes 4200000 800000 (some Lovejoin.Template.mixRedeemerData)
    Lovejoin.Template.payMixFee) { (fields 1000000).tx with mint := .I 77 } (.I 88)) = some (.I 77) := rfl

end Lovejoin.AnyTx.FeeControls
