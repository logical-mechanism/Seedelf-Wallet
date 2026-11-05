import Lovejoin.AnyTx.Common
import Blaster

/-! Owner withdrawal with one well-formed box and an unrelated key input. The output
Data, input references, box value, stake part, and other transaction fields are symbolic.
The only reference input is the pool carrier. This is one transaction layout, not a
claim about arbitrary input and reference-input lists. -/

namespace Lovejoin.AnyTx.OwnerOne
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (TxRest returnsUnit)
open Lovejoin.Classic (wellFormed)
open Lovejoin.Template (nftName)
open Lovejoin.AnyTx

structure Fields where
  tx : TxRest
  sigs : Data
  acct : Data
  boxRef : Data
  boxStake : Data
  boxValue : Data
  boxScript : Data
  keyRef : Data
  keyStake : Data
  keyValue : Data
  keyDatum : Data
  keyScript : Data
  carrierRef : Data
  carrierAddr : Data
  carrierScript : Data

def args (P M a b t z key : ByteString) (f : Fields) : List Term :=
  [toTerm P, toTerm nftName, toTerm (ownerCtx f.tx
    (.List [boxIn f.boxRef M f.boxStake f.boxValue f.boxScript a b,
      otherIn f.keyRef 0 key f.keyStake f.keyValue f.keyDatum f.keyScript])
    (.List [carrierRef f.carrierRef f.carrierAddr (.Map [(.B "", .I 2000000)]) f.carrierScript P M 10000000 "" "" 0 800000 testL testL])
    f.sigs f.acct [proofData t z])]

#prep_uplc ownerOne mixLogicTemplate args 10000

/-- An invalid Owner proof cannot consume the well-formed box in this layout. -/
theorem box_needs_proof (P M a b t z key : ByteString) (f : Fields) :
    wellFormed a b = true → ownProof M f.tx.outputs [f.boxRef, f.keyRef] a b t z = false →
    isUnsuccessful (ownerOne.prop P M a b t z key f) := by
  blaster (timeout: 540)

/-- For a non-ADA NFT policy, a valid proof also permits this withdrawal layout. -/
theorem valid_proof_passes (P M a b t z key : ByteString) (f : Fields) :
    P ≠ "" → wellFormed a b = true →
    ownProof M f.tx.outputs [f.boxRef, f.keyRef] a b t z = true →
    returnsUnit (ownerOne.prop P M a b t z key f) := by
  blaster (timeout: 540)

end Lovejoin.AnyTx.OwnerOne
