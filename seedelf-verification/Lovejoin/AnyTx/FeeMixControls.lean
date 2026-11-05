import Lovejoin.AnyTx.FeeMix
import Lovejoin.AnyTx.MixAda3Controls
import Lovejoin.Template.Fee

/-! Both validators on the same transaction. A bad fee is rejected by the fee script;
a bad proof is rejected by mix_logic, while the other validator can still pass. -/
namespace Lovejoin.AnyTx.FeeMixControls
open Seedelf.V1 (endsWithUnit endsInError)
open Lovejoin.AnyTx.MixAda3Controls (f bx2 bx3 proof)
open Lovejoin.V2 (nftPolicy mixBoxHash mixLogicHash)
open Lovejoin.V2.Any3
open Lovejoin.Template (fHash)

#guard endsWithUnit (composedMix.exec nftPolicy mixBoxHash mixLogicHash fHash 10000000 1000000 5000000 4200000 800000
  katA1 katB1 katA2 katB2 katA3 katB3 katOA1 katOB1 katOA2 katOB2 katOA3 katOB3 f bx2 bx3 proof)
#guard endsWithUnit (composedFee.exec nftPolicy mixBoxHash mixLogicHash fHash 10000000 1000000 5000000 4200000 800000
  katA1 katB1 katA2 katB2 katA3 katB3 katOA1 katOB1 katOA2 katOB2 katOA3 katOB3 f bx2 bx3 proof)
#guard endsInError (composedFee.exec nftPolicy mixBoxHash mixLogicHash fHash 10000000 1000000 5000000 4199999 800000
  katA1 katB1 katA2 katB2 katA3 katB3 katOA1 katOB1 katOA2 katOB2 katOA3 katOB3 f bx2 bx3 proof)
#guard endsWithUnit (composedMix.exec nftPolicy mixBoxHash mixLogicHash fHash 10000000 1000000 5000000 4199999 800000
  katA1 katB1 katA2 katB2 katA3 katB3 katOA1 katOB1 katOA2 katOB2 katOA3 katOB3 f bx2 bx3 proof)
#guard endsInError (composedMix.exec nftPolicy mixBoxHash mixLogicHash fHash 10000000 1000000 5000000 4200000 800000
  katA1 katB1 katA2 katB2 katA3 katB3 katOA1 katOB1 katOA2 katOB2 katOA3 katOB3 f bx2 bx3 { proof with c11 := "" })
#guard endsWithUnit (composedFee.exec nftPolicy mixBoxHash mixLogicHash fHash 10000000 1000000 5000000 4200000 800000
  katA1 katB1 katA2 katB2 katA3 katB3 katOA1 katOB1 katOA2 katOB2 katOA3 katOB3 f bx2 bx3 { proof with c11 := "" })

#guard endsInError (composedMix.exec nftPolicy mixBoxHash mixLogicHash fHash 10000000 1000000 5000000 4200000 800000
  katA1 katB1 katA2 katB2 katA3 katB3 katOA1 katOB1 katOA2 katOB2 katOA3 katOB3 f bx2 bx3 { proof with z11 := "" })
#guard endsWithUnit (composedFee.exec nftPolicy mixBoxHash mixLogicHash fHash 10000000 1000000 5000000 4200000 800000
  katA1 katB1 katA2 katB2 katA3 katB3 katOA1 katOB1 katOA2 katOB2 katOA3 katOB3 f bx2 bx3 { proof with z11 := "" })

end Lovejoin.AnyTx.FeeMixControls
