import Audit.Gaps.V2.GapMixIns
import Lovejoin.V2.MixAny3
import Lovejoin.Template.Steps

/-! `V2.GapMixIns`' builders on the KAT, concretely, on mix_logic's template at the test
launch (`abab…`, mix_box `5555…`, 10 ₳). The KAT's proofs bind only the boxes out, so with
an input that isn't a box beside the boxes they still verify, and the run must halt; a
third well-formed box with two proofs, or a proof or a branch too many or too few, must
error. Aiken's evaluator, on the same bytes (60294352…) and contexts, agrees on every line
(the audit's harness: `run_mix_ins_exact.py`). Expected:
  KAT, its own inputs: halt after 11497
  a payer's key input before: halt
  a payer's key input between: halt
  a payer's key input after: halt
  no-datum UTxO at mix_box between: halt
  a = b UTxO at mix_box between: halt
  a key's input, datum, between: halt
  a third box before, two proofs: error
  a third box between, two proofs: error
  a third box after, two proofs: error
  a fee shard's output in the tail: halt
  a tail output at mix_box, staked: halt
  a tail output at mix_box, a box: error
  two reference-script UTxOs: halt
  three proofs: error
  one proof: error
  box 1's proof, three branches: error
  box 1's proof, one branch: error -/

namespace Lovejoin.V2.Any
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open Lovejoin.Template (stepsWith nftName)

def gapLaunch := [toTerm nftPolicy, toTerm nftName]

#eval "gap ins, KAT, its own inputs:              " ++ stepsWith mixLogicTemplate gapLaunch (mixCtxIns nftPolicy mixBoxHash 10000000 [gapBoxIn1 mixBoxHash 10000000 inA1 inB1, gapBoxIn2 mixBoxHash 10000000 inA2 inB2] outA1 outB1 outA2 outB2 katRedeemer) 30000
#eval "gap ins, a payer's key input before:       " ++ stepsWith mixLogicTemplate gapLaunch (gapOtherBeforeCtx nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 (.PubKeyCredential userKey) 50000000 katRedeemer) 30000
#eval "gap ins, a payer's key input between:      " ++ stepsWith mixLogicTemplate gapLaunch (gapOtherBetweenCtx nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 (.PubKeyCredential userKey) 50000000 katRedeemer) 30000
#eval "gap ins, a payer's key input after:        " ++ stepsWith mixLogicTemplate gapLaunch (gapOtherAfterCtx nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 (.PubKeyCredential userKey) 50000000 katRedeemer) 30000
#eval "gap ins, no-datum UTxO at mix_box between: " ++ stepsWith mixLogicTemplate gapLaunch (gapOtherBetweenCtx nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 (.ScriptCredential mixBoxHash) 1500000 katRedeemer) 30000
#eval "gap ins, a = b UTxO at mix_box between:    " ++ stepsWith mixLogicTemplate gapLaunch (gapDatumBetweenCtx nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 (.ScriptCredential mixBoxHash) inA1 inA1 katRedeemer) 30000
#eval "gap ins, a key's input, datum, between:    " ++ stepsWith mixLogicTemplate gapLaunch (gapDatumBetweenCtx nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 (.PubKeyCredential userKey) Any3.katA3 Any3.katB3 katRedeemer) 30000
#eval "gap ins, a third box before, two proofs:   " ++ stepsWith mixLogicTemplate gapLaunch (gapThirdBeforeCtx nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 Any3.katA3 Any3.katB3 katRedeemer) 30000
#eval "gap ins, a third box between, two proofs:  " ++ stepsWith mixLogicTemplate gapLaunch (gapThirdBetweenCtx nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 Any3.katA3 Any3.katB3 katRedeemer) 30000
#eval "gap ins, a third box after, two proofs:    " ++ stepsWith mixLogicTemplate gapLaunch (gapThirdAfterCtx nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 Any3.katA3 Any3.katB3 katRedeemer) 30000
#eval "gap ins, a fee shard's output in the tail: " ++ stepsWith mixLogicTemplate gapLaunch (gapTailCtx nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 (.ScriptCredential feeHash) none 4800000 (.OutputDatum (.Constr 0 [])) none katRedeemer) 30000
#eval "gap ins, a tail output at mix_box, staked: " ++ stepsWith mixLogicTemplate gapLaunch (gapTailCtx nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 (.ScriptCredential mixBoxHash) (some (.StakingHash (.PubKeyCredential userKey))) 10000000 (.OutputDatum (mixDatum outA1 outB1)) none katRedeemer) 30000
#eval "gap ins, a tail output at mix_box, a box:  " ++ stepsWith mixLogicTemplate gapLaunch (gapTailCtx nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 (.ScriptCredential mixBoxHash) none 10000000 (.OutputDatum (mixDatum outA1 outB1)) none katRedeemer) 30000
#eval "gap ins, two reference-script UTxOs:       " ++ stepsWith mixLogicTemplate gapLaunch (gapRefsCtx nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 20000000 20000000 mixLogicHash mixBoxHash katRedeemer) 30000
#eval "gap ins, three proofs:                     " ++ stepsWith mixLogicTemplate gapLaunch (mixCtxAny nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 (gapThreeProofs katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12)) 30000
#eval "gap ins, one proof:                        " ++ stepsWith mixLogicTemplate gapLaunch (mixCtxAny nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 (gapOneProof katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12)) 30000
#eval "gap ins, box 1's proof, three branches:    " ++ stepsWith mixLogicTemplate gapLaunch (mixCtxAny nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 (gapThreeBranches katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 katT011 katT111 katC11 katZ11)) 30000
#eval "gap ins, box 1's proof, one branch:        " ++ stepsWith mixLogicTemplate gapLaunch (mixCtxAny nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 (gapOneBranch katT011 katT111 katC11 katZ11 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22)) 30000

end Lovejoin.V2.Any
