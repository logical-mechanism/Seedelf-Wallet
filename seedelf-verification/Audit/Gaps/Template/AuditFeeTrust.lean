import Lovejoin.Template.Steps
import Blaster

/-! Audit (templates), not part of the suite: what fee_contract trusts that
`Template.FeeContract`'s five theorems never vary. Each scenario is `feeCtx`'s Mix (PayMixFee,
one shard, three inputs at mix_box, one fee output) with one thing changed:

- the reference input holds another policy's `lovejoin` (read_reference_datum's policy check);
- two reference inputs hold the pool's NFT (`expect [Input { .. }] = carriers`);
- mix_logic's `Mix` redeemer sits under another script's withdrawal, or a key's
  (`pairs.get_first(self.redeemers, Withdraw(Script(mix_logic_script_hash)))`);
- the three box-shaped inputs sit at another script, or at a key whose hash is mix_box's
  (`input_at_script`).

Built in place as `Audit.Gaps.Template.AuditFeeTrust`, in `./check.sh audit-gaps`, or alone,
`./check.sh Audit.Gaps.Template.AuditFeeTrust`. Expected: six `✅ Valid`, and
the `#eval`s as written beside them. -/

namespace Lovejoin.Template.AuditFeeTrust
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Lovejoin.Template

/-- `feeCtx`'s Mix with the reference inputs `refs`, mix_logic's `Mix` redeemer under the
purpose `purp`, and `boxes` beside the shard. -/
def feeCtxT (refs : List TxInInfo) (purp : ScriptPurpose) (boxes : List TxInInfo) (fi fo f : Integer) :
    ScriptContext :=
  let tx := { Seedelf.V1.emptyTx with
    txInfoInputs          := ⟨shardRef, shard fi⟩ :: boxes,
    txInfoReferenceInputs := refs,
    txInfoOutputs         := [shard fo],
    txInfoFee             := f,
    txInfoRedeemers       := [(purp, mixRedeemerData)] }
  ⟨tx, payMixFee, .SpendingScript shardRef (some unitData)⟩

/-- `feeRefInput`, at `ref` and with the NFT under the policy `Q`. -/
def refInAt (ref : TxOutRef) (Q : ByteString) (cap : Integer) : TxInInfo :=
  ⟨ref, refOut (.ScriptCredential "rh") none Q nftName (refDatum 10000000 "" "" 0 cap mHash lHash fHash) none⟩

/-- `boxIn`'s input, at the credential `c`. -/
def inputAt (c : Credential) (k : Integer) : TxInInfo :=
  ⟨⟨"b", k⟩, ⟨⟨c, none⟩, ada 10000000, .OutputDatum unitData, none⟩⟩

def threeAt (c : Credential) : List TxInInfo := [inputAt c 0, inputAt c 1, inputAt c 2]

/-- mix_logic's withdrawal, as `feeCtx` keys it. -/
def atL : ScriptPurpose := .Rewarding (.ScriptCredential lHash)

def args (P : ByteString) (ctx : ScriptContext) : List Term := [toTerm P, toTerm nftName, toTerm ctx]

def foreignRefArgs (P Q : ByteString) (cap fi fo f : Integer) : List Term :=
  args P (feeCtxT [refInAt ⟨"r", 0⟩ Q cap] atL threeBoxes fi fo f)
def twoRefsArgs (P : ByteString) (cap fi fo f : Integer) : List Term :=
  args P (feeCtxT [refInAt ⟨"q", 0⟩ P cap, refInAt ⟨"r", 0⟩ P cap] atL threeBoxes fi fo f)
def otherScriptArgs (P c : ByteString) (cap fi fo f : Integer) : List Term :=
  args P (feeCtxT [feeRefInput P cap] (.Rewarding (.ScriptCredential c)) threeBoxes fi fo f)
def keyRedeemerArgs (P c : ByteString) (cap fi fo f : Integer) : List Term :=
  args P (feeCtxT [feeRefInput P cap] (.Rewarding (.PubKeyCredential c)) threeBoxes fi fo f)
def boxesElsewhereArgs (P c : ByteString) (cap fi fo f : Integer) : List Term :=
  args P (feeCtxT [feeRefInput P cap] atL (threeAt (.ScriptCredential c)) fi fo f)
def keyBoxesArgs (P : ByteString) (cap fi fo f : Integer) : List Term :=
  args P (feeCtxT [feeRefInput P cap] atL (threeAt (.PubKeyCredential mHash)) fi fo f)

#prep_uplc appliedAuditFeeForeignRef feeContractTemplate foreignRefArgs 8000
#prep_uplc appliedAuditFeeTwoRefs feeContractTemplate twoRefsArgs 8000
#prep_uplc appliedAuditFeeOtherScript feeContractTemplate otherScriptArgs 8000
#prep_uplc appliedAuditFeeKeyRedeemer feeContractTemplate keyRedeemerArgs 8000
#prep_uplc appliedAuditFeeBoxesElsewhere feeContractTemplate boxesElsewhereArgs 8000
#prep_uplc appliedAuditFeeKeyBoxes feeContractTemplate keyBoxesArgs 8000

/-- A reference input with another policy's `lovejoin` isn't the pool's. -/
theorem shard_refuses_a_foreign_reference : ∀ (P Q : ByteString) (cap fi fo f : Integer),
    Q ≠ P → isUnsuccessful (appliedAuditFeeForeignRef.prop P Q cap fi fo f) := by blaster

/-- Two reference inputs holding the pool's NFT fail. -/
theorem shard_refuses_two_references : ∀ (P : ByteString) (cap fi fo f : Integer),
    isUnsuccessful (appliedAuditFeeTwoRefs.prop P cap fi fo f) := by blaster

/-- A `Mix` redeemer under any other script's withdrawal isn't mix_logic's. -/
theorem shard_needs_mix_logics_own_redeemer : ∀ (P c : ByteString) (cap fi fo f : Integer),
    c ≠ lHash → isUnsuccessful (appliedAuditFeeOtherScript.prop P c cap fi fo f) := by blaster

/-- Nor under a key's withdrawal, whatever its hash. -/
theorem shard_refuses_a_keys_redeemer : ∀ (P c : ByteString) (cap fi fo f : Integer),
    isUnsuccessful (appliedAuditFeeKeyRedeemer.prop P c cap fi fo f) := by blaster

/-- Three inputs at any other script than mix_box aren't boxes. -/
theorem shard_counts_only_mix_box_inputs : ∀ (P c : ByteString) (cap fi fo f : Integer),
    c ≠ mHash → isUnsuccessful (appliedAuditFeeBoxesElsewhere.prop P c cap fi fo f) := by blaster

/-- Nor three inputs at a key whose hash is mix_box's. -/
theorem shard_counts_no_key_inputs : ∀ (P : ByteString) (cap fi fo f : Integer),
    isUnsuccessful (appliedAuditFeeKeyBoxes.prop P cap fi fo f) := by blaster

-- Rule 3. The honest point of `feeCtxT` is `Template.Steps`' "a Mix's fee" context, so it
-- must print `halt after 4393`; each changed one must print `error after …`.
def honest (Q : ByteString) : ScriptContext := feeCtxT [refInAt ⟨"r", 0⟩ Q 1000000] atL threeBoxes 5000000 4200000 800000
#eval s!"audit fee, honest:            {stepsWith feeContractTemplate atPool5Fee (honest pool5Policy)}"
#eval s!"audit fee, foreign reference: {stepsWith feeContractTemplate atPool5Fee (honest rhHash)}"
#eval s!"audit fee, two references:    {stepsWith feeContractTemplate atPool5Fee (feeCtxT [refInAt ⟨"q", 0⟩ pool5Policy 1000000, refInAt ⟨"r", 0⟩ pool5Policy 1000000] atL threeBoxes 5000000 4200000 800000)}"
#eval s!"audit fee, other script:      {stepsWith feeContractTemplate atPool5Fee (feeCtxT [feeRefInput pool5Policy 1000000] (.Rewarding (.ScriptCredential mHash)) threeBoxes 5000000 4200000 800000)}"
#eval s!"audit fee, key redeemer:      {stepsWith feeContractTemplate atPool5Fee (feeCtxT [feeRefInput pool5Policy 1000000] (.Rewarding (.PubKeyCredential lHash)) threeBoxes 5000000 4200000 800000)}"
#eval s!"audit fee, boxes elsewhere:   {stepsWith feeContractTemplate atPool5Fee (feeCtxT [feeRefInput pool5Policy 1000000] atL (threeAt (.ScriptCredential lHash)) 5000000 4200000 800000)}"
#eval s!"audit fee, key boxes:         {stepsWith feeContractTemplate atPool5Fee (feeCtxT [feeRefInput pool5Policy 1000000] atL (threeAt (.PubKeyCredential mHash)) 5000000 4200000 800000)}"

end Lovejoin.Template.AuditFeeTrust
