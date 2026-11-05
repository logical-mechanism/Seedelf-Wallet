import Lovejoin.AnyTx.OwnerOne
import Blaster

/-! Two boxes followed by a key input: every box must have its own proof over the
arbitrary output data and all three arbitrary input references. The carrier layout is
`OwnerOne`'s; the other transaction fields are arbitrary. -/

namespace Lovejoin.AnyTx.OwnerTwo
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

structure BoxFields where
  ref : Data
  stake : Data
  value : Data
  script : Data

def argsWithProofs (P M a1 b1 a2 b2 key : ByteString) (f : Fields) (b : BoxFields)
    (proofs : List Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (ownerCtx f.tx
    (.List [boxIn f.boxRef M f.boxStake f.boxValue f.boxScript a1 b1,
      boxIn b.ref M b.stake b.value b.script a2 b2,
      otherIn f.keyRef 0 key f.keyStake f.keyValue f.keyDatum f.keyScript])
    (.List [carrierRef f.carrierRef f.carrierAddr (.Map [(.B "", .I 2000000)]) f.carrierScript
      P M 10000000 "" "" 0 800000 testL testL]) f.sigs f.acct proofs)]

def args (P M a1 b1 a2 b2 t1 z1 t2 z2 key : ByteString) (f : Fields) (b : BoxFields) : List Term :=
  argsWithProofs P M a1 b1 a2 b2 key f b [proofData t1 z1, proofData t2 z2]

def missingArgs (P M a1 b1 a2 b2 t1 z1 key : ByteString) (f : Fields) (b : BoxFields) : List Term :=
  argsWithProofs P M a1 b1 a2 b2 key f b [proofData t1 z1]

#prep_uplc twoOwners mixLogicTemplate args 15000
#prep_uplc missingProof mixLogicTemplate missingArgs 12000

theorem first_box_needs_proof (P M a1 b1 a2 b2 t1 z1 t2 z2 key : ByteString) (f : Fields) (b : BoxFields) :
    wellFormed a1 b1 = true → wellFormed a2 b2 = true →
    ownProof M f.tx.outputs [f.boxRef, b.ref, f.keyRef] a1 b1 t1 z1 = false →
    isUnsuccessful (twoOwners.prop P M a1 b1 a2 b2 t1 z1 t2 z2 key f b) := by blaster (timeout: 540)

theorem second_box_needs_proof (P M a1 b1 a2 b2 t1 z1 t2 z2 key : ByteString) (f : Fields) (b : BoxFields) :
    wellFormed a1 b1 = true → wellFormed a2 b2 = true →
    ownProof M f.tx.outputs [f.boxRef, b.ref, f.keyRef] a2 b2 t2 z2 = false →
    isUnsuccessful (twoOwners.prop P M a1 b1 a2 b2 t1 z1 t2 z2 key f b) := by blaster (timeout: 540)

theorem both_valid_proofs_pass (P M a1 b1 a2 b2 t1 z1 t2 z2 key : ByteString) (f : Fields) (b : BoxFields) :
    P ≠ "" → wellFormed a1 b1 = true → wellFormed a2 b2 = true →
    ownProof M f.tx.outputs [f.boxRef, b.ref, f.keyRef] a1 b1 t1 z1 = true →
    ownProof M f.tx.outputs [f.boxRef, b.ref, f.keyRef] a2 b2 t2 z2 = true →
    returnsUnit (twoOwners.prop P M a1 b1 a2 b2 t1 z1 t2 z2 key f b) := by blaster (timeout: 540)

theorem two_boxes_reject_one_proof (P M a1 b1 a2 b2 t1 z1 key : ByteString) (f : Fields) (b : BoxFields) :
    wellFormed a1 b1 = true → wellFormed a2 b2 = true →
    isUnsuccessful (missingProof.prop P M a1 b1 a2 b2 t1 z1 key f b) := by blaster (timeout: 540)

end Lovejoin.AnyTx.OwnerTwo
