import Lovejoin.V2.MixAnyOutputs
import Lovejoin.V2.MixAnyDatums
import Audit.V2.Common

/-! Concrete cross-checks for what a Mix of two must pay (`V2.MixAnyOutputs`,
`V2.MixAnyDatums`), as `#guard`s on each theorem's own preparation, with Lovejoin's KAT at
the test launch: each builder with the honest field halts with unit (the run each failure
theorem pairs with, through the same preparation), and with `V2.MixAnyOutSteps`' changed
output errors. -/

namespace Lovejoin.V2.Any
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open Seedelf.V1 (ofHex)
open Audit.V2

#guard auditHaltsUnit (appliedMixAnyAddress.exec nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 (.ScriptCredential mixBoxHash) (.ScriptCredential mixBoxHash) none none none none)
#guard auditErrors (appliedMixAnyAddress.exec nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 (.PubKeyCredential userKey) (.ScriptCredential mixBoxHash) none none none none)
#guard auditHaltsUnit (appliedMixAnyValue.exec nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 10000000 10000000)
#guard auditErrors (appliedMixAnyValue.exec nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 10000000 10000001)
#guard auditErrors (appliedMixAnyToken1.exec nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 (ofHex "77777777777777777777777777777777777777777777777777777777") "X" 1)
#guard auditErrors (appliedMixAnyFewer.exec nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22)
#guard auditErrors (appliedMixAnyTail.exec nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 outA1 outB1)
#guard auditHaltsUnit (appliedMixAnyDatums.exec nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22)
#guard auditErrors (appliedMixAnyDatums.exec nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outB1 outB1 outA2 outB2 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22)
#guard auditHaltsUnit (appliedMixAnyInline1.exec nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA2 outB2 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 (.OutputDatum (mixDatum outA1 outB1)))
#guard auditErrors (appliedMixAnyInline1.exec nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA2 outB2 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 (.OutputDatumHash (ofHex "0000000000000000000000000000000000000000000000000000000000000000")))
#guard auditErrors (appliedMixAnyInline2.exec nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 .NoOutputDatum)

end Lovejoin.V2.Any
