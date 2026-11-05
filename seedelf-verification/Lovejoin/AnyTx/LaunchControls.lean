import Lovejoin.AnyTx.Launch
import Lovejoin.AnyTx.OwnerMoreControls
import Lovejoin.Template.Steps

/-! Launch controls with arbitrary uninspected fields and mint redeemer. -/
namespace Lovejoin.AnyTx.LaunchControls
open PlutusCore.Data (Data)
open Seedelf.V1 (endsWithUnit endsInError)
open Lovejoin.Template (pool5Seed rhHash pool5Policy nftName launchCtx mintOf refAt)
open Lovejoin.AnyTx.OwnerMoreControls (fields)
open Lovejoin.AnyTx.Launch

#guard endsWithUnit (launchSeedAny.exec pool5Seed 0 rhHash pool5Policy pool5Seed 0 (fields 1000000).tx (.I 88) (.I 77))
#guard endsInError (launchSeedAny.exec pool5Seed 0 rhHash pool5Policy pool5Seed 1 (fields 1000000).tx (.I 88) (.I 77))
#guard endsInError (launchAmountAny.exec pool5Seed 0 rhHash pool5Policy nftName 2 (fields 1000000).tx (.I 88) (.I 77))
#guard endsInError (launchAmountAny.exec pool5Seed 0 rhHash pool5Policy "other" 1 (fields 1000000).tx (.I 88) (.I 77))
#guard endsInError (launchPlaceAny.exec pool5Seed 0 rhHash pool5Policy (.PubKeyCredential rhHash) none none (fields 1000000).tx (.I 88) (.I 77))
#guard endsInError (launchDatumAny.exec pool5Seed 0 rhHash pool5Policy 1000000 "" "" 0 1000000 (fields 1000000).tx (.I 88) (.I 77))

private def feeField : Data → Option Data
  | .Constr 0 [.Constr 0 [_, _, _, fee, _, _, _, _, _, _, _, _, _, _, _, _], _, _] => some fee
  | _ => none

example : feeField (withRest (launchCtx ⟨pool5Seed, 0⟩ pool5Policy (mintOf pool5Policy nftName 1)
    (Lovejoin.Template.refAt rhHash pool5Policy)) { (fields 1000000).tx with fee := .I 77 } (.I 88) (.I 99)) = some (.I 77) := rfl

end Lovejoin.AnyTx.LaunchControls
