import Lovejoin.AnyTx.OwnerLayouts
import Blaster

/-! Owner with one valid box and one script input with no inline datum. The other
script hash may equal mix_box: the non-inline input is skipped in either case. The
input reference is still included in the proof hash. -/
namespace Lovejoin.AnyTx.OwnerOtherInputs
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (returnsUnit)
open Lovejoin.Classic (wellFormed)
open Lovejoin.Template (nftName)
open Lovejoin.AnyTx
open Lovejoin.AnyTx.OwnerOne (Fields)

def args (P M a b t z other : ByteString) (f : Fields) (hash : Data) (first : Bool) : List Term :=
  let box := boxIn f.boxRef M f.boxStake f.boxValue f.boxScript a b
  let junk := otherIn f.keyRef 1 other f.keyStake f.keyValue (.Constr 1 [hash]) f.keyScript
  let ins := if first then [junk, box] else [box, junk]
  [toTerm P, toTerm nftName, toTerm (ownerCtx f.tx (.List ins)
    (.List [carrierRef f.carrierRef f.carrierAddr (.Map [(.B "", .I 2000000)]) f.carrierScript
      P M 10000000 "" "" 0 800000 testL testL]) f.sigs f.acct [proofData t z])]

def inputRefs (f : Fields) (first : Bool) : List Data :=
  if first then [f.keyRef, f.boxRef] else [f.boxRef, f.keyRef]

#prep_uplc ownerOtherInputs mixLogicTemplate args 12000

theorem invalid_proof_fails (P M a b t z other : ByteString) (f : Fields) (hash : Data) (first : Bool) :
  wellFormed a b = true → ownProof M f.tx.outputs (inputRefs f first) a b t z = false →
  isUnsuccessful (ownerOtherInputs.prop P M a b t z other f hash first) := by blaster (timeout: 540)

theorem valid_proof_passes (P M a b t z other : ByteString) (f : Fields) (hash : Data) (first : Bool) :
  P ≠ "" → wellFormed a b = true → ownProof M f.tx.outputs (inputRefs f first) a b t z = true →
  returnsUnit (ownerOtherInputs.prop P M a b t z other f hash first) := by blaster (timeout: 540)

end Lovejoin.AnyTx.OwnerOtherInputs
