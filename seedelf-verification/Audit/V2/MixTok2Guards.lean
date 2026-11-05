import Lovejoin.V2.MixTok2Box1
import Lovejoin.V2.MixTok2Box2
import Lovejoin.V2.MixTok2Passes
import Lovejoin.V2.MixTok2Steps
import Audit.V2.Common

/-! Concrete cross-checks for v2's general Mix of two in a token pool (`V2.MixTok2*`), as
`#guard`s on the theorems' own preparations, with Lovejoin's token KAT (2 ₳ and 1,000,000 of
3434…'s TOKEN): the KAT halts with unit and its spec and side conditions hold; z11 changed
and `MixTok2Box1`'s run errors; z22 changed and `MixTok2Box2`'s run errors. -/

namespace Lovejoin.V2.Tok2
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Lovejoin.Classic (wellFormed)
open Audit.V2

#guard auditHaltsUnit (appliedMixTok2Passes.exec nftPolicy mixBoxHash 2000000 tokPolicy tokName 1000000 katA1 katB1 katA2 katB2 katOA1 katOB1 katOA2 katOB2 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22)
#guard mixAcceptsPool mixBoxHash 2000000 tokPolicy tokName 1000000 katA1 katB1 katA2 katB2 katOA1 katOB1 katOA2 katOB2 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22
#guard nftPolicy != "" && tokPolicy != "" && wellFormed katA1 katB1 && wellFormed katA2 katB2 && wellFormed katOA1 katOB1 && wellFormed katOA2 katOB2

#guard !(branchHolds katA1 katB1 katOA1 katOB1 katT011 katT111 katC11 zOnePool)
#guard auditErrors (appliedMixTok2Box1.exec nftPolicy mixBoxHash 2000000 tokPolicy tokName 1000000 katA1 katB1 katA2 katB2 katOA1 katOB1 katOA2 katOB2 katT011 katT111 katC11 zOnePool katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22)
#guard !(mixAcceptsPool mixBoxHash 2000000 tokPolicy tokName 1000000 katA1 katB1 katA2 katB2 katOA1 katOB1 katOA2 katOB2 katT011 katT111 katC11 zOnePool katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22)

#guard !(branchHolds katA2 katB2 katOA2 katOB2 katT022 katT122 katC22 zOnePool)
#guard auditErrors (appliedMixTok2Box2.exec nftPolicy mixBoxHash 2000000 tokPolicy tokName 1000000 katA1 katB1 katA2 katB2 katOA1 katOB1 katOA2 katOB2 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 zOnePool)
#guard !(mixAcceptsPool mixBoxHash 2000000 tokPolicy tokName 1000000 katA1 katB1 katA2 katB2 katOA1 katOB1 katOA2 katOB2 katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 zOnePool)

end Lovejoin.V2.Tok2
