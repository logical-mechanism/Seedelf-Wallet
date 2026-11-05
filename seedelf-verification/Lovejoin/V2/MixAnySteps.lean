import Lovejoin.V2.MixAnySpec
import Lovejoin.Template.Steps

/-! The general Mix (`V2.MixAny`) against the KAT's (`V2.Mix`), concretely, on mix_logic's
template applied as `Template.Steps` applies one:

- At the test launch's `P` (`abab…`), `M` (`5555…`) and `bl` (10 ₳) with the KAT's points
  and proofs, the template must halt, in about the KAT's 11497 steps, and
  `mixAcceptsAny` must be `true`. That's the passing run the general theorems pair with,
  and it shows the general scenario and spec are the KAT's at those values.
- With z11 changed, or the same proofs in a 5 ₳ pool (its `ctx` hashes another box
  value), the template must error and the spec say `false`. -/

namespace Lovejoin.V2.Any
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open Lovejoin.Template (stepsWith nftName)

def zOneAny : ByteString := Seedelf.V1.ofHex "0000000000000000000000000000000000000000000000000000000000000001"

def atTestLaunch := [toTerm nftPolicy, toTerm nftName]

#eval s!"template mix_logic, the KAT:            {stepsWith mixLogicTemplate atTestLaunch (mixCtxAny nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 katRedeemer) 30000}"
#eval s!"mixAcceptsAny, the KAT:                 {mixAcceptsAny mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22}"
#eval s!"template mix_logic, z11 changed:        {stepsWith mixLogicTemplate atTestLaunch (mixCtxAny nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 (proofsRedeemer katT011 katT111 katC11 zOneAny katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22)) 30000}, spec {mixAcceptsAny mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 katT011 katT111 katC11 zOneAny katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22}"
#eval s!"template mix_logic, KAT in a 5 ₳ pool:   {stepsWith mixLogicTemplate atTestLaunch (mixCtxAny nftPolicy mixBoxHash 5000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 katRedeemer) 30000}, spec {mixAcceptsAny mixBoxHash 5000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22}"

end Lovejoin.V2.Any
