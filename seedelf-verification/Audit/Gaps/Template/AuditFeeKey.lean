import Lovejoin.Template.Steps
import Blaster

/-! Audit (fee-mix-recognition-partial), not part of the suite. fee_contract's PayMixFee
finds mix_logic's redeemer by its purpose, `Withdraw(Script(mix_logic_script_hash))`
(fee_contract.ak:112-117), and counts boxes with `input_at_script(input, mix_script_hash)`
(:142). `Template.FeeContract`'s five theorems fix both: the redeemer is always under
`.Rewarding (.ScriptCredential lHash)` or absent, and every box is at
`.ScriptCredential mHash`. Each scenario here is `feeCtx`'s Mix (PayMixFee, one shard,
three inputs at mix_box, a `Mix`-shaped redeemer, one fee output) with one of the two
changed; `ctxK_is_feeCtx` says that with neither changed it is `feeCtx`'s.

Built in place as `Audit.Gaps.Template.AuditFeeKey`, in `./check.sh audit-gaps`, or alone,
`./check.sh Audit.Gaps.Template.AuditFeeKey`. Expected: `ok`, five
`✅ Valid` (lines of the five `by blaster`), `ctxK_is_feeCtx` silent, and the `#eval`s:
`honest` prints `halt after 4393` (Template.Steps' "a Mix's fee"), each other line
`error after` some count below 4393. -/

namespace Lovejoin.Template.AuditFeeKey
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Lovejoin.Template

/-- mix_logic's withdrawal, as `feeCtx` keys its redeemer. -/
def atL : ScriptPurpose := .Rewarding (.ScriptCredential lHash)

/-- `feeCtx`'s Mix with mix_logic's `Mix` redeemer under the purpose `purp`, and `boxes`
beside the shard. -/
def ctxK (P : ByteString) (cap : Integer) (purp : ScriptPurpose) (boxes : List TxInInfo) (fi fo f : Integer) :
    ScriptContext :=
  let redeemers : RedeemerMap := [(purp, mixRedeemerData)]
  let tx := { Seedelf.V1.emptyTx with
    txInfoInputs          := ⟨shardRef, shard fi⟩ :: boxes,
    txInfoReferenceInputs := [feeRefInput P cap],
    txInfoOutputs         := [shard fo],
    txInfoFee             := f,
    txInfoRedeemers       := redeemers }
  ⟨tx, payMixFee, .SpendingScript shardRef (some unitData)⟩

/-- With mix_logic's own purpose and the boxes at mix_box, it is the suite's context. -/
theorem ctxK_is_feeCtx (P : ByteString) (cap fi fo f : Integer) :
    ctxK P cap atL threeBoxes fi fo f = feeCtx P cap fi threeBoxes fo f (some mixRedeemerData) payMixFee :=
  rfl

/-- `boxIn`'s input (10 ₳, datum unit inline) at the credential `c`. -/
def inputAt (c : Credential) (k : Integer) : TxInInfo :=
  ⟨⟨"b", k⟩, ⟨⟨c, none⟩, ada 10000000, .OutputDatum unitData, none⟩⟩

def threeAt (c : Credential) : List TxInInfo := [inputAt c 0, inputAt c 1, inputAt c 2]

def argsK (P : ByteString) (ctx : ScriptContext) : List Term := [toTerm P, toTerm nftName, toTerm ctx]

def otherScriptArgsK (P c : ByteString) (cap fi fo f : Integer) : List Term :=
  argsK P (ctxK P cap (.Rewarding (.ScriptCredential c)) threeBoxes fi fo f)
def keyWithdrawalArgsK (P c : ByteString) (cap fi fo f : Integer) : List Term :=
  argsK P (ctxK P cap (.Rewarding (.PubKeyCredential c)) threeBoxes fi fo f)
def mintArgsK (P c : ByteString) (cap fi fo f : Integer) : List Term :=
  argsK P (ctxK P cap (.Minting c) threeBoxes fi fo f)
def boxesAtScriptArgsK (P c : ByteString) (cap fi fo f : Integer) : List Term :=
  argsK P (ctxK P cap atL (threeAt (.ScriptCredential c)) fi fo f)
def boxesAtKeyArgsK (P c : ByteString) (cap fi fo f : Integer) : List Term :=
  argsK P (ctxK P cap atL (threeAt (.PubKeyCredential c)) fi fo f)

#prep_uplc appliedFeeKeyOtherScript feeContractTemplate otherScriptArgsK 8000
#prep_uplc appliedFeeKeyKeyWithdrawal feeContractTemplate keyWithdrawalArgsK 8000
#prep_uplc appliedFeeKeyMint feeContractTemplate mintArgsK 8000
#prep_uplc appliedFeeKeyBoxesAtScript feeContractTemplate boxesAtScriptArgsK 8000
#prep_uplc appliedFeeKeyBoxesAtKey feeContractTemplate boxesAtKeyArgsK 8000

/-- A `Mix` redeemer under any other script's withdrawal isn't mix_logic's. -/
theorem shard_needs_mix_logics_withdrawal : ∀ (P c : ByteString) (cap fi fo f : Integer),
    c ≠ lHash → isUnsuccessful (appliedFeeKeyOtherScript.prop P c cap fi fo f) := by blaster

/-- Nor under a key's withdrawal, whatever its hash (mix_logic's included). -/
theorem shard_refuses_a_key_withdrawals_redeemer : ∀ (P c : ByteString) (cap fi fo f : Integer),
    isUnsuccessful (appliedFeeKeyKeyWithdrawal.prop P c cap fi fo f) := by blaster

/-- Nor under a mint, whatever its policy (mix_logic's hash included). -/
theorem shard_refuses_a_mints_redeemer : ∀ (P c : ByteString) (cap fi fo f : Integer),
    isUnsuccessful (appliedFeeKeyMint.prop P c cap fi fo f) := by blaster

/-- Three inputs at any script but mix_box aren't boxes (fee_contract's own included). -/
theorem shard_counts_only_mix_box_inputs : ∀ (P c : ByteString) (cap fi fo f : Integer),
    c ≠ mHash → isUnsuccessful (appliedFeeKeyBoxesAtScript.prop P c cap fi fo f) := by blaster

/-- Nor three inputs at a key, whatever its hash (mix_box's included). -/
theorem shard_counts_no_key_inputs : ∀ (P c : ByteString) (cap fi fo f : Integer),
    isUnsuccessful (appliedFeeKeyBoxesAtKey.prop P c cap fi fo f) := by blaster

-- Rule 3: the honest point is Template.Steps' "a Mix's fee" (by `ctxK_is_feeCtx`), so it
-- must print `halt after 4393`; each changed one must print `error after …`.
#eval s!"audit fee key, honest:              {stepsWith feeContractTemplate atPool5Fee (ctxK pool5Policy 1000000 atL threeBoxes 5000000 4200000 800000)}"
#eval s!"audit fee key, another script's:    {stepsWith feeContractTemplate atPool5Fee (ctxK pool5Policy 1000000 (.Rewarding (.ScriptCredential mHash)) threeBoxes 5000000 4200000 800000)}"
#eval s!"audit fee key, a key's withdrawal:  {stepsWith feeContractTemplate atPool5Fee (ctxK pool5Policy 1000000 (.Rewarding (.PubKeyCredential lHash)) threeBoxes 5000000 4200000 800000)}"
#eval s!"audit fee key, a mint's:            {stepsWith feeContractTemplate atPool5Fee (ctxK pool5Policy 1000000 (.Minting lHash) threeBoxes 5000000 4200000 800000)}"
#eval s!"audit fee key, three inputs at L:   {stepsWith feeContractTemplate atPool5Fee (ctxK pool5Policy 1000000 atL (threeAt (.ScriptCredential lHash)) 5000000 4200000 800000)}"
#eval s!"audit fee key, three keys at M:     {stepsWith feeContractTemplate atPool5Fee (ctxK pool5Policy 1000000 atL (threeAt (.PubKeyCredential mHash)) 5000000 4200000 800000)}"

end Lovejoin.Template.AuditFeeKey
