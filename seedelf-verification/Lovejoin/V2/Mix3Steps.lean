import Lovejoin.V2.Mix3Spec
import Seedelf.Steps

/-! How many steps Blaster's CEK machine takes on v2 mix_logic's Mix at n = 3, to size the
n = 3 modules' limits (see `Seedelf.Steps`).

- The KAT's Mix must halt: the passing run the n = 3 properties pair with.
- `mixAccepts3` on the KAT's own proofs must be `true`: the spec computes the challenge as
  Lovejoin's prover did, for three boxes.
- With box in 1's first `z` changed, or box in 3's last, the script must error and the
  spec say `false`. -/

namespace Lovejoin.V2.N3
open PlutusCore.ByteString (ByteString)
open Seedelf.V1 (stepsUsed)

def zOne3 : ByteString := Seedelf.V1.ofHex "0000000000000000000000000000000000000000000000000000000000000001"

#eval s!"v2 mix_logic, Mix n=3, the KAT:       {stepsUsed mixLogicV2 kat3Mix 100000}"
#eval s!"v2 mixAccepts3, the KAT:              {mixAccepts3 kat3T011 kat3T111 kat3C11 kat3Z11 kat3T012 kat3T112 kat3C12 kat3Z12 kat3T013 kat3T113 kat3C13 kat3Z13 kat3T021 kat3T121 kat3C21 kat3Z21 kat3T022 kat3T122 kat3C22 kat3Z22 kat3T023 kat3T123 kat3C23 kat3Z23 kat3T031 kat3T131 kat3C31 kat3Z31 kat3T032 kat3T132 kat3C32 kat3Z32 kat3T033 kat3T133 kat3C33 kat3Z33}"
#eval s!"v2 mix_logic, Mix n=3, z11 changed:   {stepsUsed mixLogicV2 (mixCtx3 (proofs3Redeemer kat3T011 kat3T111 kat3C11 zOne3 kat3T012 kat3T112 kat3C12 kat3Z12 kat3T013 kat3T113 kat3C13 kat3Z13 kat3T021 kat3T121 kat3C21 kat3Z21 kat3T022 kat3T122 kat3C22 kat3Z22 kat3T023 kat3T123 kat3C23 kat3Z23 kat3T031 kat3T131 kat3C31 kat3Z31 kat3T032 kat3T132 kat3C32 kat3Z32 kat3T033 kat3T133 kat3C33 kat3Z33)) 100000}, spec {mixAccepts3 kat3T011 kat3T111 kat3C11 zOne3 kat3T012 kat3T112 kat3C12 kat3Z12 kat3T013 kat3T113 kat3C13 kat3Z13 kat3T021 kat3T121 kat3C21 kat3Z21 kat3T022 kat3T122 kat3C22 kat3Z22 kat3T023 kat3T123 kat3C23 kat3Z23 kat3T031 kat3T131 kat3C31 kat3Z31 kat3T032 kat3T132 kat3C32 kat3Z32 kat3T033 kat3T133 kat3C33 kat3Z33}"
#eval s!"v2 mix_logic, Mix n=3, z33 changed:   {stepsUsed mixLogicV2 (mixCtx3 (proofs3Redeemer kat3T011 kat3T111 kat3C11 kat3Z11 kat3T012 kat3T112 kat3C12 kat3Z12 kat3T013 kat3T113 kat3C13 kat3Z13 kat3T021 kat3T121 kat3C21 kat3Z21 kat3T022 kat3T122 kat3C22 kat3Z22 kat3T023 kat3T123 kat3C23 kat3Z23 kat3T031 kat3T131 kat3C31 kat3Z31 kat3T032 kat3T132 kat3C32 kat3Z32 kat3T033 kat3T133 kat3C33 zOne3)) 100000}, spec {mixAccepts3 kat3T011 kat3T111 kat3C11 kat3Z11 kat3T012 kat3T112 kat3C12 kat3Z12 kat3T013 kat3T113 kat3C13 kat3Z13 kat3T021 kat3T121 kat3C21 kat3Z21 kat3T022 kat3T122 kat3C22 kat3Z22 kat3T023 kat3T123 kat3C23 kat3Z23 kat3T031 kat3T131 kat3C31 kat3Z31 kat3T032 kat3T132 kat3C32 kat3Z32 kat3T033 kat3T133 kat3C33 zOne3}"

end Lovejoin.V2.N3
