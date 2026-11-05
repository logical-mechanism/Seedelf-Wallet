import Lovejoin.Template.FeeContract
import Seedelf.AnyTx
import Blaster

/-! Fee-shard spend scenarios with arbitrary uninspected transaction fields. The
inputs, reference input, outputs, fee and redeemers retain `Template.Fee`'s layouts;
their relevant amounts and pool policy are symbolic. -/
namespace Lovejoin.AnyTx.FeeSpend
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3 (ScriptContext)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (TxRest returnsUnit)
open Lovejoin.Template

/-- Preserve the fields fee_contract reads from the typed scenario; replace the rest. -/
def withRest (ctx : ScriptContext) (r : TxRest) (sigs : Data) : Data :=
  match IsData.toData ctx with
  | .Constr 0 [.Constr 0 [ins, refs, outs, fee, _, _, _, _, _, redeemers, _, _, _, _, _, _], red, purpose] =>
    .Constr 0 [.Constr 0 [ins, refs, outs, fee, r.mint, r.certs, r.withdrawals, r.validRange,
      sigs, redeemers, r.datums, r.txId, r.votes, r.proposals, r.treasury, r.donation], red, purpose]
  | other => other

def payArgs (P : ByteString) (cap fi fo fee : Integer) (r : TxRest) (sigs : Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (withRest (feeCtx P cap fi threeBoxes fo fee (some mixRedeemerData) payMixFee) r sigs)]
def twoArgs (P : ByteString) (cap fi fo fee : Integer) (r : TxRest) (sigs : Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (withRest (feeCtx P cap fi twoBoxes fo fee (some mixRedeemerData) payMixFee) r sigs)]
def ownerArgs (P : ByteString) (cap fi fo fee : Integer) (r : TxRest) (sigs : Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (withRest (feeCtx P cap fi threeBoxes fo fee (some ownerRedeemerData) payMixFee) r sigs)]
def noMixArgs (P : ByteString) (cap fi fo fee : Integer) (r : TxRest) (sigs : Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (withRest (feeCtx P cap fi threeBoxes fo fee none payMixFee) r sigs)]
def replenishArgs (P : ByteString) (fi fo : Integer) (r : TxRest) (sigs : Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (withRest (feeCtx P 1000000 fi [] fo 0 none replenish) r sigs)]

#prep_uplc feePayAny feeContractTemplate payArgs 9000
#prep_uplc feeTwoAny feeContractTemplate twoArgs 9000
#prep_uplc feeOwnerAny feeContractTemplate ownerArgs 9000
#prep_uplc feeNoMixAny feeContractTemplate noMixArgs 9000
#prep_uplc feeReplenishAny feeContractTemplate replenishArgs 9000

theorem wrong_fee_or_cap (P : ByteString) (cap fi fo fee : Integer) (r : TxRest) (sigs : Data) :
  (fi - fo ≠ fee ∨ fee > cap) → isUnsuccessful (feePayAny.prop P cap fi fo fee r sigs) := by blaster

theorem valid_fee_passes (P : ByteString) (cap fi fo fee : Integer) (r : TxRest) (sigs : Data) :
  P ≠ "" → fi - fo = fee → fee ≤ cap → returnsUnit (feePayAny.prop P cap fi fo fee r sigs) := by blaster

theorem two_boxes_rejected (P : ByteString) (cap fi fo fee : Integer) (r : TxRest) (sigs : Data) :
  isUnsuccessful (feeTwoAny.prop P cap fi fo fee r sigs) := by blaster

theorem owner_redeemer_rejected (P : ByteString) (cap fi fo fee : Integer) (r : TxRest) (sigs : Data) :
  isUnsuccessful (feeOwnerAny.prop P cap fi fo fee r sigs) := by blaster

theorem missing_mix_rejected (P : ByteString) (cap fi fo fee : Integer) (r : TxRest) (sigs : Data) :
  isUnsuccessful (feeNoMixAny.prop P cap fi fo fee r sigs) := by blaster

theorem replenish_must_grow (P : ByteString) (fi fo : Integer) (r : TxRest) (sigs : Data) :
  fo ≤ fi → isUnsuccessful (feeReplenishAny.prop P fi fo r sigs) := by blaster

theorem growing_replenish_passes (P : ByteString) (fi fo : Integer) (r : TxRest) (sigs : Data) :
  P ≠ "" → fi < fo → returnsUnit (feeReplenishAny.prop P fi fo r sigs) := by blaster

end Lovejoin.AnyTx.FeeSpend
