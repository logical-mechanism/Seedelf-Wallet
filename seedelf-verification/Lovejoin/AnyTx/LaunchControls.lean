import Lovejoin.AnyTx.Launch
import Lovejoin.AnyTx.OwnerMoreControls
import Lovejoin.Template.Steps

/-! Launch controls with arbitrary uninspected fields and mint redeemer: each builder at its
passing point (README rule 3), and changed. -/
namespace Lovejoin.AnyTx.LaunchControls
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V1.Value (Value)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open Seedelf.V1 (TxRest endsWithUnit endsInError)
open Lovejoin.Template (pool5Seed rhHash pool5Policy nftName launchCtx mintOf refAt)
open Lovejoin.AnyTx.OwnerMoreControls (fields)
open Lovejoin.AnyTx.Launch

#guard endsWithUnit (launchSeedAny.exec pool5Seed 0 rhHash pool5Policy pool5Seed 0 (fields 1000000).tx (.I 88) (.I 77))
-- The name and amount, the place and the datum at the launch's own: each is then seedArgs'
-- launch, and returns unit; so the failures below fail on what each changes.
#guard endsWithUnit (launchAmountAny.exec pool5Seed 0 rhHash pool5Policy nftName 1 (fields 1000000).tx (.I 88) (.I 77))
#guard endsWithUnit (launchPlaceAny.exec pool5Seed 0 rhHash pool5Policy (.ScriptCredential rhHash) none none (fields 1000000).tx (.I 88) (.I 77))
#guard endsWithUnit (launchDatumAny.exec pool5Seed 0 rhHash pool5Policy 10000000 "" "" 0 1000000 (fields 1000000).tx (.I 88) (.I 77))
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

/-- The launch at its seed, with any mint. -/
private def launchWith (s : ByteString) (i : Integer) (rh P : ByteString) (mint : Value)
    (r : TxRest) (sigs red : Data) : List Term :=
  [toTerm s, toTerm i, toTerm rh,
    toTerm (withRest (launchCtx ⟨s, i⟩ P mint (Lovejoin.Template.refAt rh P)) r sigs red)]

-- launchTwoNamesAny can't pass, since a second name under the policy fails: it is seedArgs'
-- passing launch with only the mint changed.
example (s : ByteString) (i : Integer) (rh P : ByteString) (r : TxRest) (sigs red : Data) :
    seedArgs s i rh P s i r sigs red = launchWith s i rh P (mintOf P nftName 1) r sigs red := rfl
example (s : ByteString) (i : Integer) (rh P n1 n2 : ByteString) (q1 q2 : Integer) (r : TxRest)
    (sigs red : Data) :
    twoNamesArgs s i rh P n1 n2 q1 q2 r sigs red =
      launchWith s i rh P [(.B P, .Map [(.B n1, .I q1), (.B n2, .I q2)])] r sigs red := rfl

end Lovejoin.AnyTx.LaunchControls
