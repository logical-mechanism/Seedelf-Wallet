import Lovejoin.V2.Mix
import Seedelf.Steps

/-! How many steps Blaster's CEK machine takes on concrete Mix runs of v2 mix_logic, to
size `MixChallenges`' limit (see `Seedelf.Steps`). The KAT's Mix must halt: it's the
passing run the failure property pairs with (README rule 3), and it shows the scenario
serialises the outputs as Lovejoin's prover did. Its first box a lovelace over must
error, by the exact box-value rule, as the KAT's own negatives do. -/

namespace Lovejoin.V2
open Seedelf.V1 (stepsUsed)

#eval s!"v2 mix_logic, Mix, the KAT:              {stepsUsed mixLogic katMix 60000}"
#eval s!"v2 mix_logic, Mix, first box +1 lovelace: {stepsUsed mixLogic (mixCtx (mixRedeemer (katProofs katC11 katC12 katC21 katC22)) (boxesOut 10000001 ++ [change])) 60000}"

end Lovejoin.V2
