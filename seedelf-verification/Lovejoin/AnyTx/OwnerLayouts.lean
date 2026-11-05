import Lovejoin.AnyTx.OwnerOne
import Blaster

/-! Owner withdrawals with arbitrary outputs and input references. A single box may be
spent alone, or after a key input. The one pool reference has the same fixed value and
datum shape as `OwnerOne`; other uninspected fields remain arbitrary. -/

namespace Lovejoin.AnyTx.OwnerLayouts
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (returnsUnit)
open Lovejoin.Classic (wellFormed)
open Lovejoin.Template (nftName)
open Lovejoin.AnyTx
open Lovejoin.AnyTx.OwnerOne (Fields)

private def carrier (P M : ByteString) (f : Fields) :=
  carrierRef f.carrierRef f.carrierAddr (.Map [(.B "", .I 2000000)]) f.carrierScript
    P M 10000000 "" "" 0 800000 testL testL

private def oneBox (M a b : ByteString) (f : Fields) :=
  boxIn f.boxRef M f.boxStake f.boxValue f.boxScript a b

private def keyInput (key : ByteString) (f : Fields) :=
  otherIn f.keyRef 0 key f.keyStake f.keyValue f.keyDatum f.keyScript

def soloArgs (P M a b t z : ByteString) (f : Fields) : List Term :=
  [toTerm P, toTerm nftName, toTerm (ownerCtx f.tx (.List [oneBox M a b f])
    (.List [carrier P M f]) f.sigs f.acct [proofData t z])]

def keyFirstArgs (P M a b t z key : ByteString) (f : Fields) : List Term :=
  [toTerm P, toTerm nftName, toTerm (ownerCtx f.tx (.List [keyInput key f, oneBox M a b f])
    (.List [carrier P M f]) f.sigs f.acct [proofData t z])]

#prep_uplc soloOwner mixLogicTemplate soloArgs 10000
#prep_uplc keyFirstOwner mixLogicTemplate keyFirstArgs 10000

theorem solo_needs_proof (P M a b t z : ByteString) (f : Fields) :
    wellFormed a b = true → ownProof M f.tx.outputs [f.boxRef] a b t z = false →
    isUnsuccessful (soloOwner.prop P M a b t z f) := by blaster (timeout: 540)

theorem solo_valid_proof (P M a b t z : ByteString) (f : Fields) :
    P ≠ "" → wellFormed a b = true → ownProof M f.tx.outputs [f.boxRef] a b t z = true →
    returnsUnit (soloOwner.prop P M a b t z f) := by blaster (timeout: 540)

theorem key_first_needs_proof (P M a b t z key : ByteString) (f : Fields) :
    wellFormed a b = true → ownProof M f.tx.outputs [f.keyRef, f.boxRef] a b t z = false →
    isUnsuccessful (keyFirstOwner.prop P M a b t z key f) := by blaster (timeout: 540)

theorem key_first_valid_proof (P M a b t z key : ByteString) (f : Fields) :
    P ≠ "" → wellFormed a b = true → ownProof M f.tx.outputs [f.keyRef, f.boxRef] a b t z = true →
    returnsUnit (keyFirstOwner.prop P M a b t z key f) := by blaster (timeout: 540)

end Lovejoin.AnyTx.OwnerLayouts
