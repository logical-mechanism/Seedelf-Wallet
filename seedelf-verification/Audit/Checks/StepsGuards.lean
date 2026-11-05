import Seedelf.Steps
import Seedelf.PolicyAmount
import Seedelf.PolicyForeign
import Lovejoin.Template.Steps
import Lovejoin.Template.OneShotMint
import Lovejoin.Template.FeeContract
import Lovejoin.V2.Steps
import Lovejoin.V2.MixChallenges
import Lovejoin.V2.MixOutputs
import Lovejoin.V2.MixDatums

/-! Impact judge, finding `steps-runs-printed-not-guarded` (scratch, not part of the repo).

Every passing run that README rule 3 pairs with a failure-only theorem, as a `#guard`, so a
run that stopped passing fails the build instead of printing. Two kinds:

- **The cheap fix:** the `Steps` lines themselves (`stepsUsed` / `stepsWith`, as printed today).
- **The fix that matters:** the theorem's OWN argument function and step limit, through
  `NAME.exec` (the same `cekExecuteProgram` term `NAME.prop` optimises), at the point where
  the property's hypothesis is false. Halting means halting with unit, as a V3 node requires.

`Seedelf.PolicyBurn` is left out: it has no .olean (its two success theorems don't prove), so
importing it stops the file. Its burn half at #0 is `appliedAmount.exec (-1)`'s context below.

Run with `./check.sh audit-quick`, after `LIMIT=30m ./check.sh audit-refresh`: `lake build`
brings any stale import up to date inside this module's own limit (Seedelf.PolicyAmount's
.olean predates Seedelf.Policy's).

Expected: exit 0, no error, and one info line `"StepsGuards: done"` (a passing `#guard` prints
nothing). A failing one is an error, `Expression … did not evaluate to `true``, at its line:
that pairing doesn't hold. Aiken's evaluator agrees on the passing points (the audit scratch
folder's `template_pairs.sh`, `fee_pairs.sh`, `policy_pairs.sh`). -/

namespace StepsGuards
open PlutusCore.UPLC.CekMachine (State)

/-- What a Plutus V3 node accepts: a halt with unit. -/
def accepted : State → Bool
  | .Halt (.VCon .Unit) => true
  | _ => false

/-- A `Steps` line's outcome, as `stepsUsed` / `stepsWith` print it. -/
def halted (r : String) : Bool := r.startsWith "halt after"
def errored (r : String) : Bool := r.startsWith "error after"

end StepsGuards

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term Program)
open PlutusCore.UPLC.CekMachine
open PlutusCore.UPLC.PlutusScript (PlutusScript)

-- Steps.lean's lines (README rule 7's spec check, and the policy's pairs).
#guard schnorrAccepts g1 u0 z0 gr0 vkh0
#guard !(schnorrAccepts g1 u0 (ofHex "056ef908426282c4880583e64182838825d5d1de34eef032d26ac5b4244ad9a7") gr0 vkh0)
#guard StepsGuards.halted (stepsUsed wallet (spendCtx (some (.Constr 0 [.B g1, .B u0])) z0 gr0 vkh0 vkh0))
#guard StepsGuards.errored (stepsUsed wallet (spendCtx (some (.Constr 0 [.B g1, .B u0])) z0 gr0 vkh0 "k"))
#guard StepsGuards.halted (stepsUsed seedelf (mintCtx "p" "p" nameAt0 txid "" 0 1))
#guard StepsGuards.halted (stepsUsed seedelf (mintCtx "p" "p" "\x5e\xed\x0e\x1f\x01" txid "" 0 (-1)))
#guard StepsGuards.errored (stepsUsed seedelf (mintCtx "p" "p" "\x5e\xed\x0e\x1f\x01" txid "" 256 (-1)))
#guard StepsGuards.errored (stepsUsed seedelf (mintCtx "p" "p" nameAt0 txid "" 0 7))
-- The theorems' own builders: the burn halves pass (their mint halves don't: StepsGuardsBite.lean).
#guard StepsGuards.accepted (appliedAmount.exec (-1))
#guard StepsGuards.accepted (appliedForeignBurn.exec "p")

end Seedelf.V1

namespace Lovejoin.Template
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term Program)
open PlutusCore.UPLC.CekMachine
open PlutusCore.UPLC.PlutusScript (PlutusScript)

-- Template.Steps' lines.
#guard StepsGuards.halted (stepsWith oneShotMintTemplate atPool5 (launchCtx ⟨pool5Seed, 0⟩ pool5Policy (mintOf pool5Policy nftName 1) (refAt rhHash pool5Policy pool5Datum)))
#guard StepsGuards.errored (stepsWith oneShotMintTemplate atPool5 (launchCtx ⟨pool5Seed, 0⟩ pool5Policy (mintOf pool5Policy nftName 2) (refAt rhHash pool5Policy pool5Datum)))
#guard StepsGuards.halted (stepsWith feeContractTemplate atPool5Fee (feeCtx pool5Policy 1000000 5000000 threeBoxes 4200000 800000 (some mixRedeemerData) payMixFee))
#guard StepsGuards.errored (stepsWith feeContractTemplate atPool5Fee (feeCtx pool5Policy 1000000 5000000 threeBoxes 4199999 800000 (some mixRedeemerData) payMixFee))
#guard StepsGuards.halted (stepsWith feeContractTemplate atPool5Fee (feeCtx pool5Policy 1000000 5000000 [] 6000000 0 none replenish))

-- OneShotMint's builders at their passing points (saneDatum, as the theorems have it; the
-- Steps line above has the 5 ₳ pool's own datum). All four are the same honest launch.
-- nft_is_alone_under_its_policy (two names) has none: its pair is appliedNftAmount's.
#guard StepsGuards.accepted (appliedNftAmount.exec pool5Seed 0 rhHash pool5Policy nftName 1)
#guard StepsGuards.accepted (appliedNftSeed.exec pool5Seed 0 rhHash pool5Policy pool5Seed 0)
#guard StepsGuards.accepted (appliedNftPlace.exec pool5Seed 0 rhHash pool5Policy (.ScriptCredential rhHash) none none)
#guard StepsGuards.accepted (appliedNftDatum.exec pool5Seed 0 rhHash pool5Policy 10000000 "" "" 0 1000000)

-- FeeContract's. shard_needs_three_boxes, shard_pays_no_withdrawal and shard_needs_mix_logic
-- (always Error) each change one field of appliedFeePay's passing run.
#guard StepsGuards.accepted (appliedFeePay.exec pool5Policy 1000000 5000000 4200000 800000)
#guard StepsGuards.accepted (appliedFeeReplenish.exec pool5Policy 5000000 6000000)

end Lovejoin.Template

namespace Lovejoin.V2
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open Seedelf.V1 (stepsUsed g1)

-- V2.Steps' lines: the KAT halts and the spec accepts it (the real crypto's half of the pairing;
-- MixPasses proves the rest for every interpretation of the opaque builtins).
#guard StepsGuards.halted (stepsUsed mixLogicV2 katMix 60000)
#guard mixAccepts katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22
#guard StepsGuards.halted (stepsUsed mixLogicV2 (outputsCtx (katBoxOut outA1 outB1) (katBoxOut outA2 outB2)) 60000)

-- The test launch's failure-only modules, through their own builders and 30000-step limit.
#guard StepsGuards.accepted (appliedChallenges.exec katC11 katC12 katC21 katC22)
#guard StepsGuards.accepted (appliedAddress.exec (.ScriptCredential mixBoxHash) (.ScriptCredential mixBoxHash) none none none none)
#guard StepsGuards.accepted (appliedBoxValue.exec 10000000 10000000)
#guard StepsGuards.accepted (appliedDatums.exec outA1 outB1 outA2 outB2)

end Lovejoin.V2

#eval "StepsGuards: done"
