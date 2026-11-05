import Lovejoin.Template.OneShotMint
import Seedelf.AnyTx
import Blaster

/-! one_shot_mint on its one-input, one-output launch layout, with arbitrary
uninspected transaction fields and mint redeemer. This does not cover all possible
input, output or mint-map layouts. -/
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

def withRest (ctx : ScriptContext) (r : TxRest) (sigs red : Data) : Data :=
  match IsData.toData ctx with
  | .Constr 0 [.Constr 0 [ins, _, outs, _, mint, _, _, _, _, _, _, _, _, _, _, _], _, purpose] =>
    .Constr 0 [.Constr 0 [ins, r.referenceInputs, outs, r.fee, mint, r.certs, r.withdrawals,
      r.validRange, sigs, r.redeemers, r.datums, r.txId, r.votes, r.proposals, r.treasury, r.donation], red, purpose]
  | other => other

def seedArgs (s : ByteString) (i : Integer) (rh P s' : ByteString) (i' : Integer)
    (r : TxRest) (sigs red : Data) : List Term :=
  [toTerm s, toTerm i, toTerm rh, toTerm (withRest
    (launchCtx ⟨s', i'⟩ P (mintOf P nftName 1) (refAt rh P)) r sigs red)]

def amountArgs (s : ByteString) (i : Integer) (rh P nm : ByteString) (qty : Integer)
    (r : TxRest) (sigs red : Data) : List Term :=
  [toTerm s, toTerm i, toTerm rh, toTerm (withRest
    (launchCtx ⟨s, i⟩ P (mintOf P nm qty) (refOut (.ScriptCredential rh) none P nm saneDatum none)) r sigs red)]

def twoNamesArgs (s : ByteString) (i : Integer) (rh P n1 n2 : ByteString) (q1 q2 : Integer)
    (r : TxRest) (sigs red : Data) : List Term :=
  [toTerm s, toTerm i, toTerm rh, toTerm (withRest
    (launchCtx ⟨s, i⟩ P [(.B P, .Map [(.B n1, .I q1), (.B n2, .I q2)])] (refAt rh P)) r sigs red)]

def placeArgs (s : ByteString) (i : Integer) (rh P : ByteString) (c : Credential)
    (stake : Option StakingCredential) (script : Option ByteString) (r : TxRest) (sigs red : Data) : List Term :=
  [toTerm s, toTerm i, toTerm rh, toTerm (withRest
    (launchCtx ⟨s, i⟩ P (mintOf P nftName 1) (refOut c stake P nftName saneDatum script)) r sigs red)]

def datumArgs (s : ByteString) (i : Integer) (rh P : ByteString) (bl : Integer)
    (tp tn : ByteString) (tq mf : Integer) (r : TxRest) (sigs red : Data) : List Term :=
  [toTerm s, toTerm i, toTerm rh, toTerm (withRest
    (launchCtx ⟨s, i⟩ P (mintOf P nftName 1) (refAt rh P (refDatum bl tp tn tq mf "m" "l" "f"))) r sigs red)]

#prep_uplc launchSeedAny oneShotMintTemplate seedArgs 6000
#prep_uplc launchAmountAny oneShotMintTemplate amountArgs 6000
#prep_uplc launchTwoNamesAny oneShotMintTemplate twoNamesArgs 6000
#prep_uplc launchPlaceAny oneShotMintTemplate placeArgs 6000
#prep_uplc launchDatumAny oneShotMintTemplate datumArgs 6000

theorem needs_seed (s : ByteString) (i : Integer) (rh P s' : ByteString) (i' : Integer) (r : TxRest) (sigs red : Data) :
  (s' ≠ s ∨ i' ≠ i) → isUnsuccessful (launchSeedAny.prop s i rh P s' i' r sigs red) := by blaster

theorem correct_launch (s : ByteString) (i : Integer) (rh P : ByteString) (r : TxRest) (sigs red : Data) :
  P ≠ "" → returnsUnit (launchSeedAny.prop s i rh P s i r sigs red) := by blaster

theorem wrong_name_or_quantity (s : ByteString) (i : Integer) (rh P nm : ByteString) (qty : Integer) (r : TxRest) (sigs red : Data) :
  (nm ≠ nftName ∨ qty ≠ 1) → isUnsuccessful (launchAmountAny.prop s i rh P nm qty r sigs red) := by blaster

theorem second_name (s : ByteString) (i : Integer) (rh P n1 n2 : ByteString) (q1 q2 : Integer) (r : TxRest) (sigs red : Data) :
  isUnsuccessful (launchTwoNamesAny.prop s i rh P n1 n2 q1 q2 r sigs red) := by blaster

theorem wrong_destination (s : ByteString) (i : Integer) (rh P : ByteString) (c : Credential)
    (stake : Option StakingCredential) (script : Option ByteString) (r : TxRest) (sigs red : Data) :
  (c ≠ .ScriptCredential rh ∨ stake ≠ none ∨ script ≠ none) →
  isUnsuccessful (launchPlaceAny.prop s i rh P c stake script r sigs red) := by blaster

theorem invalid_reference_datum (s : ByteString) (i : Integer) (rh P : ByteString) (bl : Integer)
    (tp tn : ByteString) (tq mf : Integer) (r : TxRest) (sigs red : Data) :
  ¬ (bl > 0 ∧ mf > 0 ∧ mf < bl ∧
    ((tp = "" ∧ tn = "" ∧ tq = 0) ∨
      (tp ≠ "" ∧ lengthOfByteString tp = 28 ∧ lengthOfByteString tn ≤ 32 ∧ tq > 0 ∧ tq ≤ 18446744073709551615))) →
  isUnsuccessful (launchDatumAny.prop s i rh P bl tp tn tq mf r sigs red) := by blaster

end Lovejoin.AnyTx.Launch
