import Lovejoin.V2.MixAny4Box1
import Lovejoin.V2.MixAny4Box4
import Lovejoin.V2.MixAny4Passes
import Lovejoin.V2.MixAny4Steps
import Audit.V2.Common

/-! Concrete cross-checks for v2's general Mix of four in an ADA pool (`V2.MixAny4*`), as
`#guard`s on the theorems' own preparations, with Lovejoin's n = 4 KAT at the test launch:
the KAT halts with unit and its spec and side conditions hold; z11 changed is an instance
of box 1's first-branch hypothesis and `MixAny4Box1`'s run errors; z44 changed, of box 4's
fourth branch, and `MixAny4Box4`'s run errors; and the KAT refutes the general forms of
`Audit.V2.MixAny4Mutants` 3 to 6, which that module asks at one collapsed instance. -/

namespace Lovejoin.V2.Any4
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Audit.V2

#guard auditHaltsUnit (appliedMixAny4Passes.exec nftPolicy mixBoxHash 10000000 katA1 katB1 katA2 katB2 katA3 katB3 katA4 katB4 katOA1 katOB1 katOA2 katOB2 katOA3 katOB3 katOA4 katOB4 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT013 katT113 katC13 katZ13 katT014 katT114 katC14 katZ14 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 katT023 katT123 katC23 katZ23 katT024 katT124 katC24 katZ24 katT031 katT131 katC31 katZ31 katT032 katT132 katC32 katZ32 katT033 katT133 katC33 katZ33 katT034 katT134 katC34 katZ34 katT041 katT141 katC41 katZ41 katT042 katT142 katC42 katZ42 katT043 katT143 katC43 katZ43 katT044 katT144 katC44 katZ44)
#guard mixAcceptsPool mixBoxHash 10000000 katA1 katB1 katA2 katB2 katA3 katB3 katA4 katB4 katOA1 katOB1 katOA2 katOB2 katOA3 katOB3 katOA4 katOB4 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT013 katT113 katC13 katZ13 katT014 katT114 katC14 katZ14 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 katT023 katT123 katC23 katZ23 katT024 katT124 katC24 katZ24 katT031 katT131 katC31 katZ31 katT032 katT132 katC32 katZ32 katT033 katT133 katC33 katZ33 katT034 katT134 katC34 katZ34 katT041 katT141 katC41 katZ41 katT042 katT142 katC42 katZ42 katT043 katT143 katC43 katZ43 katT044 katT144 katC44 katZ44
#guard nftPolicy != "" && wellFormed katA1 katB1 && wellFormed katA2 katB2 && wellFormed katA3 katB3 && wellFormed katA4 katB4 && wellFormed katOA1 katOB1 && wellFormed katOA2 katOB2 && wellFormed katOA3 katOB3 && wellFormed katOA4 katOB4

-- The general forms of `Audit.V2.MixAny4Mutants` 3 to 6, refuted on the real builtins: the KAT
-- halts in its `.exec` run (above), and each changed theorem's hypothesis holds of it.
#guard !(branchHolds katA1 katB1 katOA4 katOB4 katT013 katT113 katC13 katZ13)
#guard !(auditBranchHoldsT1 katA1 katB1 katOA1 katOB1 katT011 katT111 katC11 katZ11)
#guard katZ11 != katZ44
#guard katOA1 != katOA4

#guard !(branchHolds katA1 katB1 katOA1 katOB1 katT011 katT111 katC11 zOnePool)
#guard auditErrors (appliedMixAny4Box1.exec nftPolicy mixBoxHash 10000000 katA1 katB1 katA2 katB2 katA3 katB3 katA4 katB4 katOA1 katOB1 katOA2 katOB2 katOA3 katOB3 katOA4 katOB4 katT011 katT111 katC11 zOnePool katT012 katT112 katC12 katZ12 katT013 katT113 katC13 katZ13 katT014 katT114 katC14 katZ14 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 katT023 katT123 katC23 katZ23 katT024 katT124 katC24 katZ24 katT031 katT131 katC31 katZ31 katT032 katT132 katC32 katZ32 katT033 katT133 katC33 katZ33 katT034 katT134 katC34 katZ34 katT041 katT141 katC41 katZ41 katT042 katT142 katC42 katZ42 katT043 katT143 katC43 katZ43 katT044 katT144 katC44 katZ44)
#guard !(mixAcceptsPool mixBoxHash 10000000 katA1 katB1 katA2 katB2 katA3 katB3 katA4 katB4 katOA1 katOB1 katOA2 katOB2 katOA3 katOB3 katOA4 katOB4 katT011 katT111 katC11 zOnePool katT012 katT112 katC12 katZ12 katT013 katT113 katC13 katZ13 katT014 katT114 katC14 katZ14 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 katT023 katT123 katC23 katZ23 katT024 katT124 katC24 katZ24 katT031 katT131 katC31 katZ31 katT032 katT132 katC32 katZ32 katT033 katT133 katC33 katZ33 katT034 katT134 katC34 katZ34 katT041 katT141 katC41 katZ41 katT042 katT142 katC42 katZ42 katT043 katT143 katC43 katZ43 katT044 katT144 katC44 katZ44)

#guard !(branchHolds katA4 katB4 katOA4 katOB4 katT044 katT144 katC44 zOnePool)
#guard auditErrors (appliedMixAny4Box4.exec nftPolicy mixBoxHash 10000000 katA1 katB1 katA2 katB2 katA3 katB3 katA4 katB4 katOA1 katOB1 katOA2 katOB2 katOA3 katOB3 katOA4 katOB4 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT013 katT113 katC13 katZ13 katT014 katT114 katC14 katZ14 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 katT023 katT123 katC23 katZ23 katT024 katT124 katC24 katZ24 katT031 katT131 katC31 katZ31 katT032 katT132 katC32 katZ32 katT033 katT133 katC33 katZ33 katT034 katT134 katC34 katZ34 katT041 katT141 katC41 katZ41 katT042 katT142 katC42 katZ42 katT043 katT143 katC43 katZ43 katT044 katT144 katC44 zOnePool)
#guard !(mixAcceptsPool mixBoxHash 10000000 katA1 katB1 katA2 katB2 katA3 katB3 katA4 katB4 katOA1 katOB1 katOA2 katOB2 katOA3 katOB3 katOA4 katOB4 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT013 katT113 katC13 katZ13 katT014 katT114 katC14 katZ14 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 katT023 katT123 katC23 katZ23 katT024 katT124 katC24 katZ24 katT031 katT131 katC31 katZ31 katT032 katT132 katC32 katZ32 katT033 katT133 katC33 katZ33 katT034 katT134 katC34 katZ34 katT041 katT141 katC41 katZ41 katT042 katT142 katC42 katZ42 katT043 katT143 katC43 katZ43 katT044 katT144 katC44 zOnePool)

end Lovejoin.V2.Any4
