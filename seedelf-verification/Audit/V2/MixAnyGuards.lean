import Lovejoin.V2.MixAnyFirst
import Lovejoin.V2.MixAnySecond
import Lovejoin.V2.MixAnyPasses
import Lovejoin.V2.MixAnySteps
import Audit.V2.Common

/-! Concrete cross-checks for v2's general Mix of two in an ADA pool (`V2.MixAny*`), as
`#guard`s, so a wrong result fails the build instead of printing. Each runs one of the
theorems' own preparations (its `exec`: the CEK machine with the same arguments function
and step limit) on Lovejoin's KAT at the test launch, and the spec on the same values.

- The KAT halts with unit within `MixAnyPasses`' limit, the spec is `true`, and the Passes
  theorem's side conditions hold: its hypotheses hold with the real builtins.
- z11 changed is an instance of `mix_any_needs_the_first_proofs_first_branch`'s hypothesis,
  and `MixAnyFirst`'s run errors; z22 changed, of the second box's second branch, and
  `MixAnySecond`'s run errors. The KAT in a 5 ₳ pool errors with the spec `false`. -/

namespace Lovejoin.V2.Any
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Audit.V2

#guard auditHaltsUnit (appliedMixAnyPasses.exec nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22)
#guard mixAcceptsAny mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22
#guard nftPolicy != "" && wellFormed inA1 inB1 && wellFormed inA2 inB2 && wellFormed outA1 outB1 && wellFormed outA2 outB2

#guard !(branchHolds inA1 inB1 outA1 outB1 katT011 katT111 katC11 zOneAny)
#guard auditErrors (appliedMixAnyFirst.exec nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 katT011 katT111 katC11 zOneAny katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22)
#guard !(mixAcceptsAny mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 katT011 katT111 katC11 zOneAny katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22)

#guard !(branchHolds inA2 inB2 outA2 outB2 katT022 katT122 katC22 zOneAny)
#guard auditErrors (appliedMixAnySecond.exec nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 zOneAny)
#guard !(mixAcceptsAny mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 zOneAny)

#guard auditErrors (appliedMixAnyPasses.exec nftPolicy mixBoxHash 5000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22)
#guard !(mixAcceptsAny mixBoxHash 5000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22)

end Lovejoin.V2.Any
