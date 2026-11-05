import Lovejoin.Template.Steps
import Blaster

/-! Audit (templates), not part of the suite: where a shard's value goes. In every
`Template.FeeContract` scenario the transaction's one output is the shard again, at
fee_contract with its unit datum, and the shard is the only input at fee_contract. So the
five theorems never vary the checks that keep a shard's value in the contract:

- `expect fee_input_count == 1` (PayMixFee) and `list.count(input_at_fee) == 1` (Replenish):
  without them two equal shards could pay one fee output and the rest walk away;
- `output_at_fee` (the fee output at fee_contract, no stake credential, no reference script);
- `is_unit_inline_datum(fee_output.datum)`: a shard paid back with any other datum is Rule 2's,
  sweepable by anyone.

Each scenario is `feeCtx`'s with one thing changed, for PayMixFee (a Mix's fee) and for
Replenish. Built in place as `Audit.Gaps.Template.AuditFeeOutputs`, in `./check.sh audit-gaps`,
or alone, `./check.sh Audit.Gaps.Template.AuditFeeOutputs`. Expected: seven `✅ Valid`, and the `#eval`s as written beside them. If
Blaster can't settle a symbolic `OutputDatum`, split it by shape as `Lovejoin.MixBoxNoLock` does. -/

namespace Lovejoin.Template.AuditFeeOutputs
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Lovejoin.Template

/-- `feeCtx`, with `extra` inputs after the boxes and `outs` as the outputs. -/
def feeCtxO (cap fi : Integer) (P : ByteString) (boxes extra : List TxInInfo) (outs : List TxOut) (f : Integer)
    (mixRed : Option Data) (red : Data) : ScriptContext :=
  let redeemers : RedeemerMap := match mixRed with
    | some r => [(.Rewarding (.ScriptCredential lHash), r)]
    | none => []
  let tx := { Seedelf.V1.emptyTx with
    txInfoInputs          := ⟨shardRef, shard fi⟩ :: (boxes ++ extra),
    txInfoReferenceInputs := [feeRefInput P cap],
    txInfoOutputs         := outs,
    txInfoFee             := f,
    txInfoRedeemers       := redeemers }
  ⟨tx, red, .SpendingScript shardRef (some unitData)⟩

/-- A second shard of `n`, unit datum inline, at fee_contract. -/
def secondShard (n : Integer) : TxInInfo := ⟨⟨"t", 0⟩, shard n⟩

/-- An output of `n` lovelace at `(c, st)`, with the datum `d` and the reference script `r`. -/
def outAt (c : Credential) (st : Option StakingCredential) (n : Integer) (d : OutputDatum) (r : Option ByteString) :
    TxOut := ⟨⟨c, st⟩, ada n, d, r⟩

def args (P : ByteString) (ctx : ScriptContext) : List Term := [toTerm P, toTerm nftName, toTerm ctx]

-- PayMixFee
def payTwoShardsArgs (P : ByteString) (cap fi fi2 fo f : Integer) : List Term :=
  args P (feeCtxO cap fi P threeBoxes [secondShard fi2] [shard fo] f (some mixRedeemerData) payMixFee)
def payElsewhereArgs (P : ByteString) (cap fi fo f : Integer) (c : Credential) (st : Option StakingCredential)
    (r : Option ByteString) : List Term :=
  args P (feeCtxO cap fi P threeBoxes [] [outAt c st fo (.OutputDatum unitData) r] f (some mixRedeemerData) payMixFee)
def payDatumArgs (P : ByteString) (cap fi fo f : Integer) (d : OutputDatum) : List Term :=
  args P (feeCtxO cap fi P threeBoxes [] [outAt (.ScriptCredential fHash) none fo d none] f (some mixRedeemerData) payMixFee)
def payTwoOutputsArgs (P : ByteString) (cap fi fo fo2 f : Integer) : List Term :=
  args P (feeCtxO cap fi P threeBoxes [] [shard fo, shard fo2] f (some mixRedeemerData) payMixFee)
-- Replenish
def growTwoShardsArgs (P : ByteString) (fi fi2 fo : Integer) : List Term :=
  args P (feeCtxO 1000000 fi P [] [secondShard fi2] [shard fo] 0 none replenish)
def growElsewhereArgs (P : ByteString) (fi fo : Integer) (c : Credential) (st : Option StakingCredential)
    (r : Option ByteString) : List Term :=
  args P (feeCtxO 1000000 fi P [] [] [outAt c st fo (.OutputDatum unitData) r] 0 none replenish)
def growDatumArgs (P : ByteString) (fi fo : Integer) (d : OutputDatum) : List Term :=
  args P (feeCtxO 1000000 fi P [] [] [outAt (.ScriptCredential fHash) none fo d none] 0 none replenish)

#prep_uplc appliedAuditPayTwoShards feeContractTemplate payTwoShardsArgs 8000
#prep_uplc appliedAuditPayElsewhere feeContractTemplate payElsewhereArgs 8000
#prep_uplc appliedAuditPayDatum feeContractTemplate payDatumArgs 8000
#prep_uplc appliedAuditPayTwoOutputs feeContractTemplate payTwoOutputsArgs 8000
#prep_uplc appliedAuditGrowTwoShards feeContractTemplate growTwoShardsArgs 8000
#prep_uplc appliedAuditGrowElsewhere feeContractTemplate growElsewhereArgs 8000
#prep_uplc appliedAuditGrowDatum feeContractTemplate growDatumArgs 8000

/-- A Mix's fee with a second shard spent beside this one fails, whatever the amounts. -/
theorem pay_refuses_a_second_shard : ∀ (P : ByteString) (cap fi fi2 fo f : Integer),
    isUnsuccessful (appliedAuditPayTwoShards.prop P cap fi fi2 fo f) := by blaster

/-- A Mix's fee whose one output isn't at fee_contract, or has a stake credential or a
reference script, fails. -/
theorem pay_keeps_the_shard_at_fee_contract : ∀ (P : ByteString) (cap fi fo f : Integer) (c : Credential)
    (st : Option StakingCredential) (r : Option ByteString),
    (c ≠ .ScriptCredential fHash ∨ st ≠ none ∨ r ≠ none) →
      isUnsuccessful (appliedAuditPayElsewhere.prop P cap fi fo f c st r) := by blaster

/-- A Mix's fee whose fee output carries anything but the unit datum inline fails. -/
theorem pay_keeps_the_unit_datum : ∀ (P : ByteString) (cap fi fo f : Integer) (d : OutputDatum),
    d ≠ .OutputDatum unitData → isUnsuccessful (appliedAuditPayDatum.prop P cap fi fo f d) := by blaster

/-- A Mix's fee with two fee outputs fails. -/
theorem pay_refuses_two_fee_outputs : ∀ (P : ByteString) (cap fi fo fo2 f : Integer),
    isUnsuccessful (appliedAuditPayTwoOutputs.prop P cap fi fo fo2 f) := by blaster

/-- A replenish with a second shard spent beside this one fails, whatever the amounts. -/
theorem grow_refuses_a_second_shard : ∀ (P : ByteString) (fi fi2 fo : Integer),
    isUnsuccessful (appliedAuditGrowTwoShards.prop P fi fi2 fo) := by blaster

/-- A replenish whose one output isn't at fee_contract, or has a stake credential or a
reference script, fails. -/
theorem grow_keeps_the_shard_at_fee_contract : ∀ (P : ByteString) (fi fo : Integer) (c : Credential)
    (st : Option StakingCredential) (r : Option ByteString),
    (c ≠ .ScriptCredential fHash ∨ st ≠ none ∨ r ≠ none) →
      isUnsuccessful (appliedAuditGrowElsewhere.prop P fi fo c st r) := by blaster

/-- A replenish whose fee output carries anything but the unit datum inline fails. -/
theorem grow_keeps_the_unit_datum : ∀ (P : ByteString) (fi fo : Integer) (d : OutputDatum),
    d ≠ .OutputDatum unitData → isUnsuccessful (appliedAuditGrowDatum.prop P fi fo d) := by blaster

-- Rule 3: each family at its honest point is `Template.Steps`' run (`halt after 4393`, and
-- `halt after 2933` replenished); each changed point errors.
#eval s!"audit pay, honest:        {stepsWith feeContractTemplate atPool5Fee (feeCtxO 1000000 5000000 pool5Policy threeBoxes [] [outAt (.ScriptCredential fHash) none 4200000 (.OutputDatum unitData) none] 800000 (some mixRedeemerData) payMixFee)}"
#eval s!"audit pay, second shard:  {stepsWith feeContractTemplate atPool5Fee (feeCtxO 1000000 5000000 pool5Policy threeBoxes [secondShard 5000000] [shard 4200000] 800000 (some mixRedeemerData) payMixFee)}"
#eval s!"audit pay, to a key:      {stepsWith feeContractTemplate atPool5Fee (feeCtxO 1000000 5000000 pool5Policy threeBoxes [] [outAt (.PubKeyCredential fHash) none 4200000 (.OutputDatum unitData) none] 800000 (some mixRedeemerData) payMixFee)}"
#eval s!"audit pay, no datum:      {stepsWith feeContractTemplate atPool5Fee (feeCtxO 1000000 5000000 pool5Policy threeBoxes [] [outAt (.ScriptCredential fHash) none 4200000 .NoOutputDatum none] 800000 (some mixRedeemerData) payMixFee)}"
#eval s!"audit grow, honest:       {stepsWith feeContractTemplate atPool5Fee (feeCtxO 1000000 5000000 pool5Policy [] [] [outAt (.ScriptCredential fHash) none 6000000 (.OutputDatum unitData) none] 0 none replenish)}"
#eval s!"audit grow, second shard: {stepsWith feeContractTemplate atPool5Fee (feeCtxO 1000000 5000000 pool5Policy [] [secondShard 5000000] [shard 6000000] 0 none replenish)}"
#eval s!"audit grow, other datum:  {stepsWith feeContractTemplate atPool5Fee (feeCtxO 1000000 5000000 pool5Policy [] [] [outAt (.ScriptCredential fHash) none 6000000 (.OutputDatum (Data.I 0)) none] 0 none replenish)}"

end Lovejoin.Template.AuditFeeOutputs
